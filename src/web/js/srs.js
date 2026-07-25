/**
 * Review scheduling for the puzzle queue.
 *
 * Until 1.7 the queue was a set: miss a puzzle and it went in, solve it once
 * and it came straight back out. One correct answer right after seeing the
 * solution proves very little, so puzzles graduated the moment they were least
 * likely to have stuck.
 *
 * The replacement is deliberately the smallest thing that fixes that: a puzzle
 * needs `GRADUATE` clean solves in a row to leave, a miss resets the streak,
 * and the queue is ordered so a puzzle just answered goes to the back rather
 * than being asked again immediately.
 *
 * Progress is counted in solves rather than wall-clock time: this is a local,
 * offline app people open irregularly, and a date-based schedule would either
 * dump everything at once after a fortnight away or hide the queue entirely
 * during a long session.
 * @module srs
 */
(function (global) {
  /** consecutive clean solves needed before a puzzle leaves the review queue */
  const GRADUATE = 2;

  /**
   * Normalise a stored entry. 1.6 and earlier stored `true`, so anything
   * truthy that is not an object means "missed once, never re-solved".
   */
  function entry(v) {
    if (!v) return null;
    if (typeof v === "object") {
      const s = Number(v.s);
      const seen = Number(v.n);
      return { s: Number.isFinite(s) && s > 0 ? Math.floor(s) : 0, n: Number.isFinite(seen) && seen > 0 ? Math.floor(seen) : 0 };
    }
    return { s: 0, n: 0 };
  }

  /** a miss puts the puzzle in the queue and resets any progress towards leaving */
  function onMiss(v) {
    const e = entry(v) || { s: 0, n: 0 };
    return { s: 0, n: e.n + 1 };
  }

  /**
   * A clean solve advances the streak.
   * @returns {object|null} the new entry, or null once it has graduated
   */
  function onSolve(v) {
    const e = entry(v);
    if (!e) return null; // not in the queue at all
    const s = e.s + 1;
    return s >= GRADUATE ? null : { s, n: e.n + 1 };
  }

  /** true when this puzzle still owes the queue some correct answers */
  function isDue(v) {
    return !!entry(v);
  }

  /**
   * Queue order: least-learned first, so the puzzle just answered correctly
   * drops behind the ones still at streak 0.
   * @param {string[]} ids
   * @param {object} state map of id → stored entry
   */
  function order(ids, state) {
    return ids.slice().sort((a, b) => {
      const ea = entry(state[a]) || { s: 0, n: 0 };
      const eb = entry(state[b]) || { s: 0, n: 0 };
      return ea.s - eb.s || eb.n - ea.n;
    });
  }

  /** how far a puzzle is towards graduating, for display */
  function progress(v) {
    const e = entry(v);
    return e ? [e.s, GRADUATE] : [GRADUATE, GRADUATE];
  }

  global.ChessSrs = { GRADUATE, entry, onMiss, onSolve, isDue, order, progress };
})(typeof window !== "undefined" ? window : globalThis);
