/**
 * Glicko-2 — one rating per player, one per puzzle.
 *
 * Why a rating at all: "easy / mid / hard" tiers are a claim the author makes
 * about a puzzle; a rating is a claim the *players* make, one answer at a
 * time. A 2 000-puzzle set imported from Lichess arrives with ratings already
 * fitted to millions of answers, and the player needs a number on the same
 * scale to be served puzzles near their level (Q3.1: pick within ±150).
 *
 * Why Glicko-2 rather than Elo: a puzzle is answered a few dozen times a year
 * and a player may leave for a month. Elo has no memory of *how sure* it is,
 * so it moves a stale rating as slowly as a fresh one. Glicko carries the
 * deviation (`rd`) and Glicko-2 adds the volatility (`vol`), which is what
 * lets a returning player's rating move quickly again.
 *
 * This is Glickman's paper (2012, "Example of the Glicko-2 system") step by
 * step, and `scripts/test-learning.mjs` reproduces its worked example to the
 * printed precision. Pure: numbers in, numbers out. No clock, no store.
 * @module rating
 */

/** Glicko-2 works on an internal scale; 173.7178 is the paper's constant. */
const SCALE = 173.7178;
/** Convergence for the volatility iteration (paper: ε = 0.000001). */
const EPS = 0.000001;
/** A brand-new player: the paper's defaults. */
const DEFAULT = { r: 1500, rd: 350, vol: 0.06 };
/**
 * A puzzle's difficulty is a fact about the position, not a form on the day,
 * so its volatility is pinned low and its deviation is never allowed to
 * collapse below a floor: a puzzle answered 5 000 times by others should still
 * move a little when this player's answers disagree with its rating.
 */
const PUZZLE = { vol: 0.01, rdFloor: 30, tau: 0.2 };

/** @returns {{r:number, rd:number, vol:number}} a fresh rating */
function newRating() {
  return { r: DEFAULT.r, rd: DEFAULT.rd, vol: DEFAULT.vol };
}

function g(phi) {
  return 1 / Math.sqrt(1 + 3 * phi * phi / (Math.PI * Math.PI));
}

function E(mu, muj, phij) {
  return 1 / (1 + Math.exp(-g(phij) * (mu - muj)));
}

/**
 * Step 5 of the paper: the new volatility, by the Illinois variant of
 * regula falsi. Written out rather than as a generic root finder because the
 * bracket setup (B from the "delta² > phi² + v" branch or from walking down
 * by tau) is half the algorithm.
 */
function newVolatility(phi, vol, v, delta, tau) {
  const a = Math.log(vol * vol);
  const phi2 = phi * phi;
  const d2 = delta * delta;
  const f = (x) => {
    const ex = Math.exp(x);
    return ex * (d2 - phi2 - v - ex) / (2 * (phi2 + v + ex) * (phi2 + v + ex)) - (x - a) / (tau * tau);
  };
  let A = a;
  let B;
  if (d2 > phi2 + v) {
    B = Math.log(d2 - phi2 - v);
  } else {
    let k = 1;
    while (f(a - k * tau) < 0) k++;
    B = a - k * tau;
  }
  let fA = f(A), fB = f(B);
  // guard against a pathological input looping forever: 100 steps is far
  // beyond what ε = 1e-6 needs on real data (the paper's example takes 3)
  for (let i = 0; i < 100 && Math.abs(B - A) > EPS; i++) {
    const C = A + (A - B) * fA / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) { A = B; fA = fB; } else { fA /= 2; }
    B = C; fB = fC;
  }
  return Math.exp(A / 2);
}

/**
 * Rate one player against a batch of results (steps 2–8 of the paper).
 *
 * @param {{r:number, rd:number, vol:number}} player
 * @param {Array<{r:number, rd:number, score:number}>} results opponents and
 *        the score against each: 1 win, 0.5 draw, 0 loss
 * @param {object} [opt]
 * @param {number} [opt.tau=0.5] how much volatility may move per period;
 *        smaller = more conservative (paper suggests 0.3–1.2)
 * @param {number} [opt.fixedVol] pin the volatility instead of re-estimating
 * @param {number} [opt.rdFloor=0] never let the deviation drop below this
 * @returns {{r:number, rd:number, vol:number}} a new object; input untouched
 */
function update(player, results, opt) {
  const tau = opt && Number.isFinite(opt.tau) ? opt.tau : 0.5;
  const rdFloor = opt && Number.isFinite(opt.rdFloor) ? opt.rdFloor : 0;
  const mu = (player.r - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const vol = player.vol;
  const fixedVol = opt && Number.isFinite(opt.fixedVol) ? opt.fixedVol : null;

  if (!results || !results.length) {
    // no games: only the uncertainty grows (paper step 6, no step 3–5)
    const phiStar = Math.sqrt(phi * phi + vol * vol);
    return { r: player.r, rd: Math.max(rdFloor, phiStar * SCALE), vol };
  }

  let v = 0, sum = 0;
  for (const o of results) {
    const muj = (o.r - 1500) / SCALE;
    const phij = o.rd / SCALE;
    const e = E(mu, muj, phij);
    const gj = g(phij);
    v += gj * gj * e * (1 - e);
    sum += gj * (o.score - e);
  }
  v = 1 / v;
  const delta = v * sum;
  const vol2 = fixedVol != null ? fixedVol : newVolatility(phi, vol, v, delta, tau);
  const phiStar = Math.sqrt(phi * phi + vol2 * vol2);
  const phi2 = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const mu2 = mu + phi2 * phi2 * sum;
  return { r: 1500 + SCALE * mu2, rd: Math.max(rdFloor, SCALE * phi2), vol: vol2 };
}

/**
 * One answer to one puzzle, rated as a game: both sides move, the puzzle
 * side on its pinned volatility so a single player's bad day cannot
 * re-price a puzzle rated by thousands.
 *
 * @param {object} player
 * @param {object} puzzle
 * @param {number} score 1 solved clean, 0 missed (0.5 allowed: solved with help)
 * @returns {{player:object, puzzle:object}}
 */
function rate1v1(player, puzzle, score) {
  return {
    player: update(player, [{ r: puzzle.r, rd: puzzle.rd, score }]),
    puzzle: update(puzzle, [{ r: player.r, rd: player.rd, score: 1 - score }],
      { tau: PUZZLE.tau, fixedVol: PUZZLE.vol, rdFloor: PUZZLE.rdFloor }),
  };
}

/**
 * Probability that `a` beats `b`. Both deviations count, so a fresh player
 * against a fresh puzzle sits near 0.5 however far the point estimates are
 * apart — the numbers do not yet know enough to promise otherwise.
 */
function expectedScore(a, b) {
  const mua = (a.r - 1500) / SCALE, mub = (b.r - 1500) / SCALE;
  const phia = a.rd / SCALE, phib = b.rd / SCALE;
  return 1 / (1 + Math.exp(-g(Math.sqrt(phia * phia + phib * phib)) * (mua - mub)));
}

/**
 * The band to pick puzzles from (Q3.1: ±150). Widened by the deviation, so a
 * player the system is unsure about gets a broader sweep rather than a narrow
 * band around a guess.
 * @returns {{lo:number, hi:number}}
 */
function pickRange(rating, width) {
  const w = Number.isFinite(width) ? width : 150;
  const slack = Math.max(0, (rating.rd || 0) - 50) / 2;
  return { lo: Math.round(rating.r - w - slack), hi: Math.round(rating.r + w + slack) };
}

export const ChessRating = { DEFAULT, PUZZLE, newRating, update, rate1v1, expectedScore, pickRange };
