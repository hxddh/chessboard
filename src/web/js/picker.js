/**
 * 为你出一题 — which puzzle should this player see next?
 *
 * The book used to have no opinion: 下一题 walked the current category in
 * book order, and switching categories was entirely manual. The signals for
 * something better were already half-there — the SRS queue knows what you owe,
 * and misses are recorded per puzzle — but the one signal an adaptive picker
 * actually needs, *which kind of puzzle this player gets wrong*, was thrown
 * away at the moment it became true: a graduated puzzle is deleted from
 * `missed`, taking its history with it. That deletion is right for the queue
 * (owing nothing means owing nothing) and wrong as a memory, so the memory is
 * kept separately: `state.tally[cat] = { miss, solve }`, written at the same
 * two moments the queue is written, and never deleted.
 *
 * Three rungs, each with a reason the interface can say out loud:
 *
 *   1. review  — the queue is not empty. Unfinished business beats novelty,
 *                and the queue's own order (least-learned first) picks the id.
 *   2. weak    — some category has enough history (≥ MIN_ATTEMPTS answers)
 *                and a miss rate above the others. Serve its easiest unsolved
 *                puzzle (caller-supplied tier, book order within a tier): a
 *                player who is missing in this category should climb from the
 *                bottom, not be handed its hardest member first.
 *   3. explore — not enough history anywhere: serve the category the player
 *                has touched least (lowest solved fraction). A recommender
 *                with no data should widen coverage, not fake confidence.
 *
 * A rung only speaks when its condition is really true, so the reason shown
 * is never a guess. All pure: state and book in, a decision out. No DOM, no
 * store, no i18n — the caller renders the reason.
 * @module picker
 */

/** History below this many answers in a category is noise, not a weakness. */
const MIN_ATTEMPTS = 3;

/** The lifetime record for one category, however sparse. */
function catTally(state, cat) {
  const t = (state.tally || {})[cat];
  const miss = t && Number.isFinite(t.miss) ? t.miss : 0;
  const solve = t && Number.isFinite(t.solve) ? t.solve : 0;
  return { miss, solve, attempts: miss + solve };
}

/**
 * Record an answer into the lifetime tally. Returns the same state object,
 * mutated — matching how the rest of puzzleState is updated in place.
 */
function recordAnswer(state, cat, missed) {
  if (!state.tally) state.tally = {};
  if (!state.tally[cat]) state.tally[cat] = { miss: 0, solve: 0 };
  state.tally[cat][missed ? "miss" : "solve"]++;
  return state;
}

/**
 * The category this history condemns, by the one rule everybody shares.
 *
 * Exported because two surfaces speak about weakness — the 为你出一题 toast
 * and the record page's 做题战绩 marker — and two copies of this loop is how
 * they would eventually name two different categories in the same breath.
 */
function weakest(state, cats) {
  let weak = null;
  for (const c of cats) {
    const t = catTally(state, c);
    if (t.attempts < MIN_ATTEMPTS || t.miss === 0) continue;
    const rate = t.miss / t.attempts;
    if (!weak || rate > weak.rate) weak = { cat: c, rate, attempts: t.attempts };
  }
  return weak;
}

/**
 * Decide the next puzzle.
 *
 * @param {object} state puzzleState: { solved, missed, tally? }
 * @param {object[]} all the whole book, each { id, cat, ... }
 * @param {object} srs the ChessSrs module (isDue / order)
 * @param {function} [tierOf] puzzle → "easy" | "mid" | "hard", for the weak
 *        rung's easy-first climb; without it every rung stays in book order
 * @returns {{kind: "review"|"weak"|"explore"|"done", cat?: string, id?: string,
 *            due?: number, rate?: number, attempts?: number}}
 */
function pickNext(state, all, srs, tierOf) {
  // 1. the queue
  const due = all.filter((p) => srs.isDue(state.missed[p.id]));
  if (due.length) {
    const first = srs.order(due.map((p) => p.id), state.missed)[0];
    return { kind: "review", cat: "review", id: first, due: due.length };
  }

  // categories in book order, only those with something left to serve
  const cats = [];
  for (const p of all) if (!cats.includes(p.cat)) cats.push(p.cat);
  const open = cats.filter((c) => all.some((p) => p.cat === c && !state.solved[p.id]));
  if (!open.length) return { kind: "done" };

  const firstUnsolved = (c) => all.find((p) => p.cat === c && !state.solved[p.id]).id;

  // 2. a real weakness: enough answers, and misses among them
  const weak = weakest(state, open);
  if (weak) {
    // easiest first: this is the one rung that has just told the player they
    // are struggling here, and the wrong next move is the category's hardest
    // member. Stable within a tier — book order — so it stays predictable.
    let id = firstUnsolved(weak.cat);
    if (tierOf) {
      const rank = { easy: 0, mid: 1, hard: 2 };
      let best = Infinity;
      for (const p of all) {
        if (p.cat !== weak.cat || state.solved[p.id]) continue;
        const r = rank[tierOf(p)] ?? 1;
        if (r < best) { best = r; id = p.id; }
      }
    }
    return { kind: "weak", cat: weak.cat, id,
             rate: weak.rate, attempts: weak.attempts };
  }

  // 3. no usable history: the least-covered category
  let pick = open[0], best = Infinity;
  for (const c of open) {
    const inCat = all.filter((p) => p.cat === c);
    const frac = inCat.filter((p) => state.solved[p.id]).length / inCat.length;
    if (frac < best) { best = frac; pick = c; }
  }
  return { kind: "explore", cat: pick, id: firstUnsolved(pick) };
}

export const ChessPicker = { MIN_ATTEMPTS, pickNext, recordAnswer, catTally, weakest };
