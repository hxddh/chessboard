/**
 * 一组固定的对局，给「我的」页的跨局指标做单元测试（v8-0-plan B5 验收）。
 *
 * Library-entry shaped (side, outcome, an.scalars / an.tags, clk, fen) and
 * written out by hand, so every expected figure in test-progress-metrics.mjs
 * can be counted off this file with a finger. Scalars are white's view in
 * centipawns, one per position; only their extremes matter to the metrics.
 */

/** A game whose evaluation passes through `path` (white's view). */
const g = (id, side, outcome, path, extra) => Object.assign({
  id, side, outcome, fen: "", an: { scalars: path, tags: new Array(Math.max(0, path.length - 1)).fill(null) },
}, extra || {});

/**
 * Advantage fixtures. From the player's chair:
 *   reached ≥ +2: a1 a2 a3 a4 a5 a6 a9 a11 a12 (a12 exactly +2.00)  → 9, won 6
 *   reached ≤ −2: a4 a7 a8 a9 a10                                   → 5, saved 2 (a8 drew, a9 won)
 *   a13 peaks at +1.99 and counts for neither.
 */
export const ADVANTAGE_GAMES = [
  g("a1", "w", "win", [0, 120, 350, 900]),
  g("a2", "w", "win", [0, 250, 400]),
  g("a3", "w", "draw", [0, 300, -50, 0]),            // an advantage let go
  g("a4", "w", "loss", [0, 220, 0, -900]),           // up, then down, then lost
  g("a5", "w", "win", [0, 210, 600]),
  g("a6", "w", "win", [30, 500, 10000]),
  g("a7", "w", "loss", [0, 50, -400, -10000]),
  g("a8", "w", "draw", [0, -300, -100, 0]),          // saved
  g("a9", "w", "win", [0, -250, 100, 600]),          // saved and converted
  g("a10", "w", "loss", [0, -1000]),
  g("a11", "b", "win", [0, -80, -300, -10000]),      // black: −300 for white is +3 for us
  g("a12", "w", "draw", [0, 200, 0]),                // exactly +2.00 counts
  g("a13", "w", "draw", [0, 199, -199, 0]),          // just short both ways
];

/**
 * Clock fixtures: ten 40-ply games, the player white on a 3-minute clock.
 * White's reading after move j: 170 − 10j for j < 16 (down to 20 s), then
 * 15, 12, 8, 4. The first reading, 170 s, sets the bar at 17 s, so the moves
 * made with less than that on the clock *before* them are j = 17, 18, 19:
 * three a game, thirty in all. Every game blunders at j = 18 (on the low
 * clock); games 0–4 also blunder at j = 5 (on a calm one). Black's plies
 * carry a ?? of their own that must not be counted as ours.
 *   pressure: 30 moves, 10 ??  → 33.3%
 *   calm:    170 moves,  5 ??  →  2.9%
 */
export const CLOCK_GAMES = Array.from({ length: 10 }, (_, k) => {
  const clk = [], tags = [];
  for (let j = 0; j < 20; j++) {
    clk.push(j < 16 ? 170 - 10 * j : [15, 12, 8, 4][j - 16]);
    clk.push(180);
    tags.push(j === 18 || (k < 5 && j === 5) ? "??" : null);
    tags.push(j === 3 ? "??" : null);
  }
  return { id: "c" + k, side: "w", outcome: "loss", fen: "", clk,
    an: { scalars: new Array(41).fill(0), tags } };
});

/**
 * One game where black moves first (a `[FEN]` start with "b" to move) and
 * the player is black: ply 0 is ours. Readings 60, 60, 5, 60: the bar is
 * 6 s, and the second of our moves (ply 2) is made on 60 s — calm — while a
 * third (ply 4) would be made on 5 s.
 */
export const BLACK_FIRST = {
  id: "bf", side: "b", outcome: "draw",
  fen: "4k3/8/8/8/8/8/8/4K3 b - - 0 1",
  clk: [60, 60, 5, 60, 4],
  an: { scalars: [0, 0, 0, 0, 0, 0], tags: ["??", null, null, "??", "??"] },
};
