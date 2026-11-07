/**
 * The ladder fit (v8-0-plan B4), shared by the 19.0 ladder (scripts/test-ladder.mjs)
 * and the 20.0 one (scripts/ladder20.mjs): Bradley–Terry by maximum
 * likelihood in Elo units, with virtual draws between neighbours as the prior.
 */
/**
 * Bradley–Terry MLE (Elo units), with `prior` virtual draws between
 * neighbours. `pairs` are {a, b, games, scoreA}: the likelihood is linear in
 * each game's score, so a pairing's total is all the fit needs of it — which
 * is also what lets a run carry games it did not play (fit, below).
 * @returns {{R: number[], se: number[], cov: number[][]}} cov with the first rung pinned
 */
export function fitBT(ids, pairs, prior) {
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const obs = pairs.map((g) => ({ i: idx[g.a], j: idx[g.b], s: g.scoreA / g.games, w: g.games }));
  for (let i = 0; i + 1 < ids.length; i++) obs.push({ i, j: i + 1, s: 0.5, w: prior });
  const K = Math.log(10) / 400;
  const R = ids.map(() => 0);
  for (let it = 0; it < 500; it++) {
    // Newton on all but the first rating (pinned at 0)
    const n = ids.length;
    const grad = new Array(n).fill(0);
    const H = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const o of obs) {
      const p = 1 / (1 + Math.exp(-K * (R[o.i] - R[o.j])));
      const d = o.w * K * (o.s - p);
      grad[o.i] += d; grad[o.j] -= d;
      const h = o.w * K * K * p * (1 - p);
      H[o.i][o.i] += h; H[o.j][o.j] += h; H[o.i][o.j] -= h; H[o.j][o.i] -= h;
    }
    const m = n - 1;
    const A = Array.from({ length: m }, (_, r) => H[r + 1].slice(1).concat([grad[r + 1]]));
    const step = solve(A);
    let moved = 0;
    // (a step at most 200 at a time: a 24–0 pairing far from the start overshoots)
    const cut = Math.min(1, 200 / Math.max(...step.map(Math.abs), 1e-9));
    for (let r = 0; r < m; r++) { R[r + 1] += cut * step[r]; moved = Math.max(moved, Math.abs(cut * step[r])); }
    if (moved < 1e-6) {
      const inv = invert(H.slice(1).map((row) => row.slice(1)));
      const se = [0].concat(inv.map((row, r) => Math.sqrt(Math.max(0, row[r]))));
      const cov = ids.map((_, a) => ids.map((__, b) => (a && b ? inv[a - 1][b - 1] : 0)));
      return { R, se, cov };
    }
  }
  throw new Error("fit did not converge");
}
function solve(A) {
  const m = A.length;
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, r) => row[m] / row[r]);
}
function invert(M) {
  const m = M.length;
  const A = M.map((row, r) => row.concat(Array.from({ length: m }, (_, k) => (k === r ? 1 : 0))));
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let k = 0; k < 2 * m; k++) A[c][k] /= d;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = 0; k < 2 * m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row) => row.slice(m));
}

