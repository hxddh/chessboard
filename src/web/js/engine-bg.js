/**
 * A second Stockfish for background passes only (v8-1-plan F4 part 3).
 *
 * **Off by default** (v8-1-plan §8.7): the scheduler (engine-sched.js) already
 * gets the game's reply out from under a library pass within one `stop`, and
 * this costs a whole second wasm instance — its own heap, its own copy of the
 * network, its own transposition table at the Hash the player chose. The
 * measured price is in docs/measured.json `engineScheduler.secondWorker`.
 * What it buys is a pass that keeps going while a game is played, on a
 * machine with a core to spare; turned on with the `bgWorker` setting
 * (engine.js setOptions), never by this module.
 *
 * Only `go nodes` analysis runs here, and it runs exactly as engine.js
 * analyzeInner does on the main worker — `ucinewgame`, the same full-strength
 * options, the same node count — so a position analysed here and one analysed
 * there come back the same. Nothing here preempts or is preempted: this
 * worker has one kind of customer. Any failure (a boot that does not finish,
 * a search that does not come back) rejects, and engine.js stops using the
 * lane and goes back to the shared worker; the pass itself never notices.
 * @module engine-bg
 */

/**
 * @param {object} d
 * @param {Function} d.spawn        () => a Worker running the engine source
 * @param {Function} d.wasm         () => an ArrayBuffer copy of the wasm
 * @param {Function} d.optionCmds   (multipv) => the setoption lines analyzeInner sends
 * @param {Function} d.readInfo     engine.js readInfo(line, slots)
 */
export function createBgLane(d) {
  let worker = null;
  let booting = null;
  let handlers = [];
  let chain = Promise.resolve();
  const live = new Set(); // waits to fail if the lane is closed under them

  function send(cmd) { if (worker) worker.postMessage(cmd); }

  function waitFor(pred, ms) {
    return new Promise((resolve, reject) => {
      const w = { reject };
      const done = () => { clearTimeout(w.timer); live.delete(w); handlers = handlers.filter((h) => h !== handler); };
      w.timer = setTimeout(() => { done(); reject(new Error("engine timeout")); }, ms);
      live.add(w);
      function handler(line) { if (pred(line)) { done(); resolve(line); } }
      handlers.push(handler);
    });
  }

  function boot() {
    if (booting) return booting;
    booting = (async () => {
      worker = d.spawn();
      worker.onmessage = (ev) => { for (const h of handlers.slice()) h(ev.data); };
      worker.onerror = () => close();
      const ready = waitFor((l) => l === "__sf_ready__" || (typeof l === "string" && l.startsWith("__sf_fail__")), 30000);
      const payload = d.wasm();
      worker.postMessage({ type: "init", wasm: payload }, [payload]);
      if ((await ready) !== "__sf_ready__") throw new Error("engine boot failed");
      const ok = waitFor((l) => l === "uciok", 10000);
      send("uci");
      await ok;
    })();
    return booting;
  }

  async function search(fen, nodes, multipv) {
    await boot();
    send("ucinewgame");
    const drain = waitFor((l) => l === "readyok", 5000);
    send("isready");
    await drain;
    for (const c of d.optionCmds(multipv)) send(c);
    send("position fen " + fen);
    const slots = new Map();
    const collect = (line) => { if (typeof line === "string") d.readInfo(line, slots); };
    handlers.push(collect);
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), nodes / 50 + 15000);
    send("go nodes " + nodes);
    try {
      const line = await wait;
      return { uci: line.split(/\s+/)[1], slots };
    } finally { handlers = handlers.filter((h) => h !== collect); }
  }

  /** One analysis, after whatever this lane is already doing. */
  function analyze(fen, nodes, multipv) {
    const run = chain.then(() => search(fen, nodes, multipv));
    chain = run.then(() => {}, () => {});
    return run;
  }

  /** Terminate the worker; whatever was waiting on it rejects. */
  function close() {
    if (worker) { try { worker.terminate(); } catch (_) { /* already gone */ } }
    worker = null;
    booting = null;
    handlers = [];
    const orphans = [...live];
    live.clear();
    for (const w of orphans) { clearTimeout(w.timer); w.reject(new Error("engine lane closed")); }
  }

  return { analyze, close, up: () => !!worker };
}
