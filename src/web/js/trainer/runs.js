/**
 * 冲刺与连胜：两种限时 / 限错的做题玩法的规则（v8-0-plan B1）。
 *
 *   冲刺 rush    three minutes on the clock; a wrong move is a strike and
 *                the third ends the run. Lichess calls it Storm.
 *   连胜 streak  no clock; the first wrong move ends it.
 *
 * Both serve puzzles that get harder as the run goes on: the k-th puzzle is
 * the unused one nearest `base + k·step`, picked at random among those within
 * `SPREAD` of that so two runs do not serve the same sequence. The score is
 * the number solved; the best of each kind is kept with the puzzle state.
 *
 *   定级 place   v10-0-plan T1, the first-run placement: six puzzles, no
 *                clock and no strikes; each answer moves the aim up or down
 *                by a step that halves as it goes (300, 200, 150, 100, 75,
 *                50), so the aim after the sixth is the estimate the
 *                puzzle rating starts from.
 *
 * Pure: the caller owns the clock (passes `now`), the pool and the board. A
 * run neither moves the ratings nor fills the review queue — a miss against
 * the clock is haste, not a gap in what the player knows, and the practice
 * rails are where that is measured.
 * @module trainer/runs
 */

export const RUN_RULES = {
  rush: { ms: 180000, strikes: 3, base: 600, step: 50 },
  streak: { ms: 0, strikes: 1, base: 800, step: 40 },
  place: { ms: 0, strikes: Infinity, base: 1000, steps: [300, 200, 150, 100, 75, 50] },
};
/** The modes the puzzle panel offers as buttons — placement is first-run only. */
export const RUN_KINDS = ["rush", "streak"];
/** A placed rating's deviation: six answers are a start, not a measurement. */
export const PLACE_RD = 150;
const PLACE_MIN = 400, PLACE_MAX = 2800;
/** How far from the target rating a pick may land and still be a random one. */
export const SPREAD = 100;

/** A seeded generator, so a run's picks can be replayed from its seed. */
function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}

/**
 * @param {number} [base] where a placement starts (its rule's base otherwise)
 * @returns {object} a run that has not served its first puzzle yet
 */
export function newRun(kind, now, seed, base) {
  const rule = RUN_RULES[kind];
  if (!rule) return null;
  const run = { kind, seed: (seed >>> 0) || 1, score: 0, strikes: 0, k: 0, used: [],
    startedAt: now, endsAt: rule.ms ? now + rule.ms : 0, over: false, last: null };
  if (kind === "place") run.est = Number.isFinite(base) ? base : rule.base;
  return run;
}

/** The rating the next puzzle is aimed at. */
export function targetOf(run) {
  const rule = RUN_RULES[run.kind];
  return run.kind === "place" ? run.est : rule.base + run.k * rule.step;
}

/** A placement answer moves the aim by this round's step, and the sixth ends it. */
function placeStep(run, dir) {
  const steps = RUN_RULES.place.steps;
  // kept on the scale the bank and the rungs cover
  run.est = Math.max(PLACE_MIN, Math.min(PLACE_MAX, run.est + dir * steps[Math.min(run.k, steps.length - 1)]));
  run.k++;
  if (run.k >= steps.length) { run.over = true; run.why = "placed"; }
}

/**
 * The next puzzle for `run`, or null when the pool is spent.
 * @param {object} run
 * @param {object[]} pool puzzles that may be served
 * @param {(p:object) => number} ratingOf
 */
export function pickNext(run, pool, ratingOf) {
  const used = new Set(run.used);
  const free = pool.filter((p) => p && !used.has(p.id));
  if (!free.length) return null;
  const want = targetOf(run);
  const near = free.filter((p) => Math.abs(ratingOf(p) - want) <= SPREAD);
  if (near.length) {
    const r = rng(run.seed + run.k * 7919);
    return near[Math.floor(r() * near.length)];
  }
  let best = free[0];
  for (const p of free) if (Math.abs(ratingOf(p) - want) < Math.abs(ratingOf(best) - want)) best = p;
  return best;
}

/** A puzzle has been put on the board for this run. */
export function served(run, p) { run.used.push(p.id); }

/** The puzzle was solved. */
export function onSolve(run) {
  if (run.over) return;
  run.score++;
  run.last = "ok";
  if (run.kind === "place") { placeStep(run, 1); return; }
  run.k++;
}

/** A wrong move: a strike, and the run is over once the strikes are spent. */
export function onMiss(run) {
  if (run.over) return;
  run.strikes++;
  run.last = "miss";
  if (run.kind === "place") { placeStep(run, -1); return; }
  run.k++;
  if (run.strikes >= RUN_RULES[run.kind].strikes) { run.over = true; run.why = run.kind === "streak" ? "streak" : "strikes"; }
}

/** Milliseconds left on the clock (Infinity for a run without one). */
export function timeLeft(run, now) {
  return run.endsAt ? Math.max(0, run.endsAt - now) : Infinity;
}

/** End the run when the clock has run out. @returns {boolean} whether it is over */
export function checkClock(run, now) {
  if (!run.over && run.endsAt && now >= run.endsAt) { run.over = true; run.why = "time"; }
  return run.over;
}

/**
 * File the finished run's score. @param {object} st the puzzle state
 * @returns {boolean} whether it is a new best
 */
export function recordBest(st, run) {
  if (run.kind === "place") return false; // a placement is not a score
  if (!st.runs || typeof st.runs !== "object") st.runs = {};
  const had = st.runs[run.kind] || { best: 0 };
  if (run.score <= (had.best || 0)) return false;
  st.runs[run.kind] = { best: run.score, at: Date.now() };
  return true;
}

/** The best score filed for `kind` (0 when there is none). */
export function bestOf(st, kind) {
  return (st && st.runs && st.runs[kind] && st.runs[kind].best) || 0;
}

export const ChessRuns = { RUN_RULES, RUN_KINDS, PLACE_RD, SPREAD, newRun, targetOf, pickNext, served, onSolve, onMiss, timeLeft, checkClock, recordBest, bestOf };
