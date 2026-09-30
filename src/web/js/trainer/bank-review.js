/**
 * 题库题进复习队列（v8-1-plan T6）.
 *
 * B1 rated a missed Lichess puzzle but kept it out of the review queue: its
 * band is a chunk that may not be loaded when the queue is read, and a review
 * nothing can serve is a review owed for ever (7.4 D5). Now the queue holds a
 * bank puzzle's id like any other id, and when one is due the review first
 * waits for the band it lives in — the same move a theme makes for the index
 * (puzzle-modes.js withIndex).
 *
 * Which band: the id alone does not say (Lichess ids are random), so the
 * puzzle state keeps a side table `bank` (id → band, the importer's
 * floor(rating / 200) × 200 of the rating the puzzle shipped with). A side
 * table and not a field on the queue entry: srs.js rebuilds entries from
 * their four numbers (entry()), so a fifth would not survive the first
 * solve. A queue from 6.x–8.0 has no bank ids and loads as it did; an older
 * build reading this queue leaves the lc- ids alone (drills.js forgetRetired
 * keeps them: "bands load on demand").
 *
 * Without the table (an entry merged in from elsewhere), the puzzle's own
 * rating in `pr` is the guess, with the bands either side of it — the first
 * answer moves that rating by up to STEP_CAP. An id no band it could be in
 * holds is retired from the queue once those bands are here, as forgetRetired
 * does for the mined set.
 *
 * @module trainer/bank-review
 */

/** Is this a puzzle-bank id (puzzle-db.js decodeRow: "lc-" + the Lichess id)? */
export const isBankId = (id) => typeof id === "string" && id.startsWith("lc-");
/** The band a rating falls in — scripts/import-puzzles.mjs bandOf. */
export const bandOfRating = (r) => (Number.isFinite(Number(r)) ? Math.floor(Number(r) / 200) * 200 : null);

/**
 * @param {object} d
 * @param {object} d.Db   ChessPuzzleDb: band(b) (null until loaded), ensureBand(b),
 *   and bandFor(rating) (the bands there are; null before the index is here)
 * @param {object} d.Srs  ChessSrs
 */
export function createBankReview({ Db, Srs }) {
  /** band → Map(id → puzzle), built once per band */
  const byBand = new Map();
  /**
   * band → {p, done, ok}: each band is asked for once a session. A second
   * wait while it is still on its way chains onto the same load instead of
   * going on without it (M3 评审); one that failed is not asked again.
   */
  const loads = new Map();
  function load(b) {
    let l = loads.get(b);
    if (!l) {
      l = { done: false, ok: false };
      l.p = Promise.resolve().then(() => Db.ensureBand(b))
        .then((list) => { l.done = true; l.ok = !!list; return list || null; }, () => { l.done = true; return null; });
      loads.set(b, l);
    }
    return l.p;
  }
  /** A band the bank has, or null (M3 评审: a guess past either end is the end band). */
  function clamp(b) {
    // before the index is here there is nothing to clamp to: the guess stands
    return typeof Db.bandFor === "function" && Db.indexReady && Db.indexReady() ? Db.bandFor(b) : b;
  }

  /** The bands bank puzzle `id` can be in, most likely first. */
  function bandsOf(st, id) {
    const b = st.bank ? st.bank[id] : undefined;
    if (Number.isFinite(b)) return [b];
    const g = bandOfRating(st.pr && st.pr[id] ? st.pr[id].r : NaN);
    if (g == null) return [];
    const out = [];
    for (const x of [g, g - 200, g + 200]) { const c = x >= 0 ? clamp(x) : null; if (c != null && !out.includes(c)) out.push(c); }
    return out;
  }
  function inBand(b, id) {
    let m = byBand.get(b);
    if (!m) {
      const list = Db.band(b);
      if (!list) return undefined;          // not here yet: unknown
      m = new Map(list.map((p) => [p.id, p]));
      byBand.set(b, m);
    }
    return m.get(id) || null;
  }

  /** The queued bank puzzle `id`, or null while its band is not here. */
  function resolve(st, id) {
    for (const b of bandsOf(st, id)) { const p = inBand(b, id); if (p) return p; }
    return null;
  }

  /** A bank puzzle was missed: remember its band beside the queue entry. */
  function note(st, p) {
    const b = bandOfRating(p && p.rating);
    if (b == null) return;
    if (!st.bank) st.bank = {};
    st.bank[p.id] = b;
  }
  /** It left the queue: its band is no longer needed. */
  function forget(st, id) {
    if (st.bank && id in st.bank) delete st.bank[id];
  }

  /**
   * Bands the bank puzzles due by `now` need that have not arrived yet (a
   * band on its way counts: a wait chains onto it). Ids that every band they
   * could be in has come without are pruned first (M3 评审).
   */
  function pending(st, now) {
    prune(st);
    const out = new Set();
    for (const id of Object.keys(st.missed || {})) {
      if (!isBankId(id) || !Srs.dueBy(st.missed[id], now)) continue;
      for (const b of bandsOf(st, id)) {
        if (Db.band(b)) { if (inBand(b, id)) break; continue; }
        const l = loads.get(b);
        if (!l || !l.done) out.add(b);
        break;                              // the likelier band first
      }
    }
    return [...out];
  }

  /**
   * Drop the queued bank ids that no band they could be in holds, once all of
   * those bands are here — a puzzle the bank no longer has (a later import)
   * or an id with no band at all. @returns {number} how many were dropped
   */
  function prune(st) {
    let n = 0;
    for (const id of Object.keys(st.missed || {})) {
      if (!isBankId(id)) continue;
      const bands = bandsOf(st, id);
      const found = bands.map((b) => inBand(b, id));
      if (found.some((x) => x)) continue;
      if (found.some((x) => x === undefined)) continue;   // a band not here: cannot tell yet
      delete st.missed[id];
      forget(st, id);
      n++;
    }
    return n;
  }

  /**
   * Run `then` once every band the due bank puzzles need is here. Returns
   * false when nothing had to be waited for (the caller goes on at once),
   * true when `then` will run later. A band is asked for once a session: a
   * second wait on one that loaded without the puzzle does not loop, and one
   * that failed is reported (`failed`) and the review goes on with what is
   * here — waiting again would only fail again.
   */
  function wait(st, now, then, failed) {
    const bands = pending(st, now);
    if (!bands.length) return false;
    Promise.all(bands.map(load)).then((lists) => {
      prune(st);
      if (failed && lists.some((l) => !l)) failed();
      then();
    });
    return true;
  }

  /**
   * The 复习 list: today's dose (srs.js dueQueue, `cap` a day) of the
   * entries that can be served now — `find(id)` for the book's, the loaded
   * bands for bank ids. An id nothing can serve yet (its band not here, a
   * mined drill before its chunk) does not take one of the day's slots, and
   * is not pushed to a later day for it either (M3 评审).
   * @returns {object[]} puzzles
   */
  function reviewList(st, now, cap, find) {
    const servable = {}, got = new Map();
    for (const id of Object.keys(st.missed || {})) {
      const p = isBankId(id) ? resolve(st, id) : find(id);
      if (p) { servable[id] = st.missed[id]; got.set(id, p); }
    }
    const today = Srs.dueQueue(servable, now, cap);
    // dueQueue moved the overflow to later days on the copy: the queue keeps that
    for (const id of Object.keys(servable)) st.missed[id] = servable[id];
    return today.map((id) => got.get(id));
  }

  return { resolve, note, forget, pending, prune, wait, bandsOf, reviewList };
}
