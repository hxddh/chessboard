/**
 * Win percentage: the one scale the review grades on. Lichess's curve from a
 * White-view scalar (centipawns; a mate is ±(10000 − 10·n)), drops measured
 * from the mover's side, and the game-accuracy formula. Extracted from 19.0's
 * review.js unchanged in value (scripts/app/grade.test.mjs holds the parity);
 * the reasons for each cut-off are in docs/measured.json and the 19.0 file.
 * @module core/winpct
 */

/** `?!` `?` `??` cut-offs, in the mover's win-percentage points. */
export const WIN_INACCURACY = 5, WIN_MISTAKE = 10, WIN_BLUNDER = 20;

/** White's win % for a White-view scalar; null for a missing one. */
export function winPct(cp) {
  if (cp == null || !Number.isFinite(cp)) return null;
  if (cp >= 9000) return 100;
  if (cp <= -9000) return 0;
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** What the move cost `side` (≥ 0), or null. */
export function winPctDrop(before, after, side) {
  const a = winPct(before), b = winPct(after);
  if (a == null || b == null) return null;
  return Math.max(0, side === "w" ? a - b : b - a);
}

/** Win % for `side` from a White-view scalar. */
export function sideWin(scalar, side) {
  const w = winPct(scalar);
  return w == null ? null : side === "w" ? w : 100 - w;
}

export function classifyByWinPct(drop) {
  if (!Number.isFinite(drop)) return null;
  if (drop >= WIN_BLUNDER) return "??";
  if (drop >= WIN_MISTAKE) return "?";
  if (drop >= WIN_INACCURACY) return "?!";
  return null;
}

/** Lichess's per-move accuracy from two win percentages of the mover. */
export function accuracyFromWinPct(before, after) {
  if (before == null || after == null) return null;
  if (after >= before) return 100;
  const raw = 103.1668100711649 * Math.exp(-0.04354415386753951 * (before - after)) - 3.166924740191411 + 1;
  return Math.max(0, Math.min(100, raw));
}

/** The win % the accuracy formula reads: a scalar clamped to ±1000 first. */
export function accuracyWinPct(cp) {
  if (cp == null || !Number.isFinite(cp)) return null;
  const c = Math.max(-1000, Math.min(1000, cp));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
}

/**
 * Each side's game accuracy (lichess): volatility-weighted mean and harmonic
 * mean of the per-move accuracies, averaged. { w, b }, null where unmeasured.
 */
export function gameAccuracy(scalars, firstMover) {
  const out = { w: null, b: null };
  if (!scalars || scalars.length < 2) return out;
  const wins = scalars.map(accuracyWinPct);
  const moves = wins.length - 1;
  const size = Math.max(2, Math.min(8, Math.floor(moves / 10)));
  const windows = [];
  for (let k = 0; k < Math.min(size, wins.length) - 2; k++) windows.push(wins.slice(0, size));
  if (wins.length <= size) windows.push(wins.slice());
  else for (let k = 0; k + size <= wins.length; k++) windows.push(wins.slice(k, k + size));
  const weightOf = (xs) => {
    if (xs.some((x) => x == null)) return null;
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, x) => a + (x - mean) * (x - mean), 0) / xs.length);
    return Math.max(0.5, Math.min(12, sd));
  };
  const per = { w: [], b: [] };
  for (let i = 0; i < moves && i < windows.length; i++) {
    const p = wins[i], n = wins[i + 1], w = weightOf(windows[i]);
    if (p == null || n == null || w == null) continue;
    const white = (i % 2 === 0) === (firstMover !== "b");
    per[white ? "w" : "b"].push([white ? accuracyFromWinPct(p, n) : accuracyFromWinPct(n, p), w]);
  }
  for (const s of ["w", "b"]) {
    const xs = per[s];
    if (!xs.length) continue;
    const sw = xs.reduce((a, [, w]) => a + w, 0);
    const weighted = xs.reduce((a, [acc, w]) => a + acc * w, 0) / sw;
    const harmonic = xs.length / xs.reduce((a, [acc]) => a + 1 / Math.max(1, acc), 0);
    out[s] = (weighted + harmonic) / 2;
  }
  return out;
}

/** The printed move number of ply `i`. */
export function moveNumber(i, firstMover, startNo = 1) {
  const base = Number.isFinite(startNo) && startNo >= 1 ? Math.floor(startNo) : 1;
  return base + Math.floor((i + (firstMover === "b" ? 1 : 0)) / 2);
}

/**
 * An engine score as the review's scalar: White-view centipawns, a mate as
 * ±(10000 − 10·min(n, 50)) — 19.0's evalScalar, on the engine service's
 * White-view scores ({ cp } | { mate }).
 */
export function scalarOf(score) {
  if (!score) return null;
  if (score.mate != null) {
    if (score.mate === 0) return null;
    const mag = 10000 - Math.min(Math.abs(score.mate), 50) * 10;
    return score.mate > 0 ? mag : -mag;
  }
  return Number.isFinite(score.cp) ? score.cp : null;
}
