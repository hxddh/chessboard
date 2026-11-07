/**
 * Imported games reviewed in the background (v20-0-plan §2 L2: "your own
 * games" are evidence), at the lowest priority: one game at a time, in idle
 * time, never while the engine is somebody else's.
 *
 *   const bg = startAutoReview({ engine, db, busy, onDone })
 *   bg.wake()     the library changed (an import, 「这是你吗」): look again now
 *   bg.stop()
 *
 * Which games (pickGames): the AUTO_RECENT most recent imported games whose
 * side is known (yours: the file said, the name was inferred, or 「这是你吗」
 * named it) and that have AUTO_MIN_PLIES moves or more; the ones already
 * analysed are skipped, newest first. At most AUTO_PER_DAY a day: each game
 * leaves up to three review cards (learn/model.js CARDS_PER_GAME) and a day
 * takes at most fifteen new ones, so five games a day never crowd out what
 * the player's own play and lessons bring.
 *
 * Priority: `busy()` is asked before every search — while it says yes (下 or
 * 学 on screen: the opponent, the coach, the hints, the play review and the
 * drills all ask the engine) the pass waits where it is and keeps what it has;
 * when it says no, the next search waits for an idle moment. The review is
 * review/review.js reviewQuietly — the same pass, turning points and
 * `review.finding` events as the review on the board, marked `auto`.
 * @module library/autoreview
 */
import { reviewQuietly } from "../review/review.js";
import { pickGames, gameOfRecord } from "./records.js";

export { AUTO_RECENT, AUTO_PER_DAY, AUTO_MIN_PLIES, pickGames, gameOfRecord, dateOf } from "./records.js";

/** How long to wait between looks when there is nothing to do (a wake() cuts it short). */
const REST_MS = 60000;
const POLL_MS = 400;

/**
 * @param {object} o
 * @param {object} o.engine            EngineService
 * @param {object} o.db                the db service
 * @param {() => boolean} o.busy       is the engine somebody else's right now
 * @param {(gameId: string, r: object) => void} [o.onDone]  after each game
 * @param {object|number} [o.budget]   review/review.js REVIEW_BUDGET (default), or ms (tests)
 * @param {() => number} [o.now]
 * @param {number} [o.tz]
 */
export function startAutoReview({ engine, db, busy, onDone = () => {}, budget, now = () => Date.now(), tz = new Date().getTimezoneOffset(),
  idle = globalThis.requestIdleCallback ? (f) => globalThis.requestIdleCallback(f, { timeout: 2000 }) : (f) => setTimeout(f, 50) }) {
  let stopped = false, wakeUp = null, running = null;
  const status = { phase: "idle", gameId: null, reviewed: 0, paused: false };
  const sleep = (ms) => new Promise((r) => { const id = setTimeout(() => { wakeUp = null; r(); }, ms); wakeUp = () => { clearTimeout(id); wakeUp = null; r(); }; });

  /** Before every search: wait while the engine is busy, then for an idle moment. */
  async function gate() {
    while (!stopped && busy()) { status.paused = true; await new Promise((r) => setTimeout(r, POLL_MS)); }
    status.paused = false;
    if (!stopped) await new Promise((r) => idle(() => r()));
  }

  async function loop() {
    while (!stopped) {
      let rows = [];
      try { rows = await db.query("library.all"); } catch { rows = []; }
      const todo = pickGames(rows, now(), tz);
      if (!todo.length) { status.phase = "idle"; status.gameId = null; await sleep(REST_MS); continue; }
      for (const rec of todo) {
        if (stopped) return;
        const game = gameOfRecord(rec);
        if (!game || !game.moves.length) continue;
        status.phase = "running"; status.gameId = rec.id;
        await gate();
        let r = null;
        try {
          r = await reviewQuietly({ engine, db, game, sides: [rec.you], budget, gate, halt: () => (stopped ? "stopped" : null) });
        } catch (e) {
          // an engine that cannot answer: try again later, not in a loop
          console.warn("autoreview:", e && e.message);
          status.phase = "failed";
          await sleep(REST_MS);
          break;
        }
        if (stopped || !r) return;
        status.reviewed++;
        onDone(rec.id, r);
      }
    }
  }
  running = loop();
  return {
    status,
    wake() { if (wakeUp) wakeUp(); },
    stop() { stopped = true; if (wakeUp) wakeUp(); return running; },
    /** tests: resolves once nothing is left to do now */
    async settled() {
      for (;;) {
        await new Promise((r) => setTimeout(r, 50));
        if (status.phase !== "running" && !status.paused) {
          const rows = await db.query("library.all");
          if (!pickGames(rows, now(), tz).length) return status;
        }
      }
    },
  };
}
