/**
 * Which move a Maia rung plays, from its net's distribution (13.0 H) —
 * shared by engine.js (through chunk-human.js) and the calibration
 * (scripts/lib/ladder-player.mjs), like pickCandidate: the scripts that
 * measure a rung call the rule, they do not carry a copy of it.
 * @module human/pick
 */

/**
 * The draw. Moves under 1% are never played (the long tail is noise, not
 * people); the rest are drawn with weights p^(1/temp), a temperature under
 * 1 being stronger than the band, over 1 weaker. A style (persona.js) then
 * chooses, among the moves at least half as likely as the one drawn (and 5%
 * at least), the one it likes best — the draw decides how good the move is,
 * the style only which of the likely ones, as pickByWinLoss.
 * @param {Array<{uci: string, p: number}>} pol most likely first
 * @param {{temp?: number}} tier
 * @param {() => number} rng
 * @param {((uci: string) => number|null)|null} styleOf
 * @returns {string|null}
 */
export function pickHuman(pol, tier, rng, styleOf) {
  if (!pol || !pol.length) return null;
  let rows = pol.filter((r) => r.p >= 0.01);
  if (!rows.length) rows = pol.slice(0, 1);
  const inv = 1 / Math.max(0.05, tier.temp || 1);
  const w = rows.map((r) => Math.pow(r.p, inv));
  let x = rng() * w.reduce((a, b) => a + b, 0), drawn = rows[rows.length - 1];
  for (let i = 0; i < rows.length; i++) { x -= w[i]; if (x <= 0) { drawn = rows[i]; break; } }
  if (!styleOf) return drawn.uci;
  let best = drawn, bestS = styleOf(drawn.uci);
  if (bestS == null) bestS = -Infinity;
  for (const r of rows) {
    if (r.p < Math.max(0.05, drawn.p / 2)) continue;
    const sc = styleOf(r.uci);
    if (sc != null && sc > bestS) { best = r; bestS = sc; }
  }
  return best.uci;
}

/** The moves a guarded rung asks Stockfish about: what the draw could play, at most eight. */
export function guardMoves(pol) {
  const rows = pol.filter((r) => r.p >= 0.01).slice(0, 8);
  return (rows.length ? rows : pol.slice(0, 1)).map((r) => r.uci);
}

/**
 * The guard (`tier.guard`, centipawns): the two strongest rungs Maia plays
 * are stronger than any of its nets on its own (the 13.0 calibration: the
 * 1900 net drawn at temperature 0.35 measured ~1680 on the ladder), so they
 * drop, before the draw, the moves a shallow full-strength look scores more
 * than `guard` below the best of them — the person's move, without the
 * blunders a player of that rating would see. `scores`: uci → centipawns
 * from the side to move (a MultiPV search restricted to guardMoves).
 * @returns {Array<{uci: string, p: number}>} the moves kept, most likely first
 */
export function guardPolicy(pol, scores, guard) {
  let best = -Infinity;
  for (const s of scores.values()) if (s != null && s > best) best = s;
  if (!Number.isFinite(best)) return pol;
  const kept = pol.filter((r) => scores.has(r.uci) && scores.get(r.uci) != null && scores.get(r.uci) >= best - guard);
  return kept.length ? kept : pol;
}
