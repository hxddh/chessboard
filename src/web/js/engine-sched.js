/**
 * Who gets the one engine next (v8-1-plan F4).
 *
 * Through 8.0 every search queued on one promise chain, first come first
 * served (engine.js `exclusive()`). That was fair and it was wrong: a library
 * pass is hundreds of `go nodes` searches in a row, and the engine's reply in
 * the game on the board queued behind whichever of them was running — and
 * since v8-0-plan B2 deepened the review and C1 let the library grow to ten
 * thousand games, what it queued behind kept getting longer.
 *
 * Three levels now, lowest number first:
 *
 *   PLAY   the game's move, a hint, the coach, a draw offer — someone is
 *          waiting on the answer
 *   LIVE   持续分析: `go infinite` on the position the board shows
 *   BATCH  a library pass, a review pass: many positions, nobody waiting on
 *          any one of them
 *
 * Within a level it is still first come first served, so every caller that
 * relied on `exclusive()` serialising its searches still gets exactly that.
 * Across levels a request jumps the queue, and if a lower level is *running*
 * it is preempted: `preempt(job)` stops its search (engine.js sends `stop`
 * only when that job's own search is on the worker), whatever it returns is
 * thrown away, and the job goes back to the head of its own level. Its caller
 * never sees the interruption — the promise settles once, with the result of
 * a run nobody cut short. A batch is one position per request, so "resume
 * from where it was preempted" is simply the next run of the same request:
 * the positions already answered are not asked again.
 *
 * Throwing the cut result away is the whole of the determinism argument:
 * every analysis search starts from `ucinewgame` and runs a fixed node count
 * (engine.js NODES_PER_MS), so a rerun is the same search the uninterrupted
 * one would have been, and a truncated one is never returned.
 * @module engine-sched
 */

export const PRIO = { PLAY: 0, LIVE: 1, BATCH: 2 };

/**
 * @param {{preempt: Function, started?: Function}} hooks
 *   preempt(job) — stop the running job's search (it is lower priority than
 *   something that just arrived); started(job) — a job is about to run
 */
export function createScheduler(hooks) {
  const queue = []; // waiting jobs, by level then arrival
  let running = null;
  let seq = 0;

  function insert(job) {
    let i = queue.length;
    while (i > 0 && (queue[i - 1].prio > job.prio || (queue[i - 1].prio === job.prio && queue[i - 1].seq > job.seq))) i--;
    queue.splice(i, 0, job);
  }

  function pump() {
    if (running || !queue.length) return;
    const job = queue.shift();
    running = job;
    job.runs++;
    if (hooks.started) hooks.started(job);
    const done = (ok, value) => {
      running = null;
      // a preempted run's result is never delivered, whatever it was: a
      // search that finished just before its `stop` landed is still thrown
      // away rather than trusted, because nothing here can tell the two apart
      if (ok && job.preempted) {
        job.preempted = false;
        job.searching = false;
        insert(job); // its original arrival: the head of its level
      } else if (ok) job.resolve(value);
      else job.reject(value);
      pump();
    };
    Promise.resolve().then(() => job.body(job)).then((v) => done(true, v), (e) => done(false, e));
  }

  /**
   * Queue `body(job)` at level `prio`. The body may check `job.preempted`
   * between its awaits, and sets `job.searching` while its own `go` is on the
   * worker (so a preemption knows whether there is a search to stop).
   * @returns {Promise} what the body returned on its one uninterrupted run
   */
  function submit(prio, body, kind) {
    return new Promise((resolve, reject) => {
      const job = { prio, body, kind, resolve, reject, seq: ++seq, asked: Date.now(), runs: 0, preempted: false, searching: false };
      insert(job);
      if (running && prio < running.prio && !running.preempted) {
        running.preempted = true;
        hooks.preempt(running);
      }
      pump();
    });
  }

  return { submit, running: () => running, waiting: () => queue.length };
}
