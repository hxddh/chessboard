/**
 * 摸得到的复盘 — the positions a preview shows.
 *
 * A preview is a board model that is not the committed position: the move
 * under the pointer, the engine line up to the focused chip. Two rules decide
 * what such a model contains and they used to live inline in the two hover
 * handlers, which is how the PV walk and the ply walk came to disagree about
 * check marking. Extracted in 5.1 (work package A) so the walk is one
 * function with a unit test, and app.js keeps only the question of who is
 * holding the preview and when it lets go.
 *
 * Pure: a Chess constructor and positions in, plain objects out. No store,
 * no DOM.
 * @module preview
 */

/** Where `color`'s king stands in `g`, as a square name, or null. */
function kingSquare(g, color) {
  const bd = g.board();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = bd[r][c];
    if (p && p.type === "k" && p.color === color) return "abcdefgh"[c] + (8 - r);
  }
  return null;
}

/** The model for a game replayed to ply n. `last` is the verbose move that
    reached it (null at the start). */
function plyPreview(g, last, n) {
  return {
    kind: "ply", ply: n,
    position: g.board(),
    last: last ? { from: last.from, to: last.to } : null,
    check: g.in_check() ? kingSquare(g, g.turn()) : null,
  };
}

/**
 * The model for an engine line played k+1 moves deep from `fen`, on a
 * scratch game — never on the game itself: these moves were not played.
 * Stops early at the first move the scratch game refuses (a stale line).
 * @param {Function} Chess
 * @param {string} fen the position the line starts from
 * @param {string} pv the line in SAN, space-separated
 * @param {number} k index of the last chip to include
 * @returns {object|null} null when the line is empty
 */
function pvPreview(Chess, fen, pv, k) {
  if (typeof pv !== "string" || !pv.length) return null;
  const g = new Chess(fen);
  let last = null;
  const sans = pv.split(" ");
  for (let i = 0; i <= k && i < sans.length; i++) {
    const m = g.move(sans[i]);
    if (!m) break;
    last = { from: m.from, to: m.to };
  }
  return {
    kind: "pv", k,
    position: g.board(), last,
    check: g.in_check() ? kingSquare(g, g.turn()) : null,
  };
}

export const ChessPreview = { kingSquare, plyPreview, pvPreview };
