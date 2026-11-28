/**
 * Which move a Maia rung plays, from its net's distribution (13.0 H) —
 * shared by engine.js (through chunk-human.js) and the calibration
 * (scripts/lib/ladder-player.mjs), like pickCandidate: the scripts that
 * measure a rung call the rule, they do not carry a copy of it.
 * @module human/pick
 */

/**
 * The draw. Moves under 1% are never played (the long tail is noise, not
 * people) — under `floor` on a rung that sets one (19.0 T5: the rungs below
 * 1100, whose players do hang pieces); the rest are drawn with weights p^(1/temp), a temperature under
 * 1 being stronger than the band, over 1 weaker. A style (persona.js) then
 * chooses, among the moves at least half as likely as the one drawn (and 5%
 * at least), the one it likes best — the draw decides how good the move is,
 * the style only which of the likely ones, as pickByWinLoss.
 * @param {Array<{uci: string, p: number}>} pol most likely first
 * @param {{temp?: number, floor?: number}} tier
 * @param {() => number} rng
 * @param {((uci: string) => number|null)|null} styleOf
 * @param {string[]} [free] freeTakes() of the position: on a rung drawn
 *   hotter than its band (temp > 1, the low rungs), a free queen or rook is
 *   taken whatever the draw said — see freeTakes
 * @returns {string|null}
 */
export function pickHuman(pol, tier, rng, styleOf, free) {
  if (!pol || !pol.length) return null;
  // 25.4: the draw runs first either way, so the generator advances the same
  // and a game without a hung major piece is the game it always was
  const uci = draw(pol, tier, rng, styleOf);
  if (!free || !free.length || !((tier.temp || 1) > 1) || free.includes(uci)) return uci;
  return free.find((u) => pol.some((r) => r.uci === u)) || uci;
}

function draw(pol, tier, rng, styleOf) {
  let rows = pol.filter((r) => r.p >= (tier.floor || 0.01));
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

/**
 * 25.4: the captures of an enemy queen or rook that cost nothing — after the
 * capture nothing can take back on that square, and the opponent has no mate
 * in one. A hot draw (a low rung, temp 4–5) spreads its weight so wide that
 * it often walked past a queen hung for nothing — the one
 * blunder of the opponent's that every beginner sees, and the bot missing it
 * read as broken, not as weak. A defended piece, or a capture that loses to
 * mate, is left to the draw: that is where a beginner's misses are real.
 * @returns {string[]} UCI, the most valuable piece first
 */
export function freeTakes(fen, Chess) {
  const out = [];
  let g;
  try { g = new Chess(fen); } catch (_) { return out; }
  const caps = g.moves({ verbose: true }).filter((m) => m.captured === "q" || m.captured === "r")
    .sort((a, b) => (b.captured === "q") - (a.captured === "q"));
  for (const m of caps) {
    g.move(m);
    const replies = g.moves({ verbose: true });
    const safe = !replies.some((r) => r.to === m.to) && !replies.some((r) => { g.move(r); const mate = g.in_checkmate(); g.undo(); return mate; });
    g.undo();
    if (safe) out.push(m.from + m.to + (m.promotion || ""));
  }
  return out;
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
