/**
 * Squares, coordinates and placements, pure.
 *
 * Board space: file 0–7 (a–h) and rank 0–7 (1–8). Screen space: column and
 * row 0–7 from the top left, after orientation. Piece codes are chess.js's
 * colour + type, as the SVG sets name them: "wk", "bp".
 * @module board/geometry
 */
export const FILES = "abcdefgh";

export const sqFile = (sq) => sq.charCodeAt(0) - 97;
export const sqRank = (sq) => sq.charCodeAt(1) - 49;
export const sqName = (file, rank) => FILES[file] + (rank + 1);
export const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Board space → screen cell, for an orientation of "white" or "black". */
export function toScreen(file, rank, orientation) {
  return orientation === "black" ? { col: 7 - file, row: rank } : { col: file, row: 7 - rank };
}

/** Screen cell → square name. */
export function fromScreen(col, row, orientation) {
  return orientation === "black" ? sqName(7 - col, row) : sqName(col, 7 - row);
}

/** FEN placement → Map(square → code). */
export function readFen(fen) {
  const out = new Map();
  const rows = String(fen).split(" ")[0].split("/");
  for (let i = 0; i < 8; i++) {
    let f = 0;
    for (const ch of rows[i] || "") {
      if (ch >= "1" && ch <= "8") { f += Number(ch); continue; }
      const color = ch === ch.toUpperCase() ? "w" : "b";
      out.set(sqName(f, 7 - i), color + ch.toLowerCase());
      f++;
    }
  }
  return out;
}

const STEPS = {
  n: [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]],
  k: [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]],
};
const RAYS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
RAYS.q = [...RAYS.b, ...RAYS.r];

/**
 * Where the piece on `sq` might go once the opponent has moved: its moves on
 * an empty board, pawn captures included, and castling from the home square.
 * The real legality is checked when the premove is played.
 */
export function premoveDests(pieces, sq) {
  const code = pieces.get(sq);
  if (!code) return [];
  const color = code[0], type = code[1];
  const f = sqFile(sq), r = sqRank(sq);
  const out = [];
  const add = (df, dr) => { if (onBoard(f + df, r + dr)) out.push(sqName(f + df, r + dr)); };
  if (type === "p") {
    const dir = color === "w" ? 1 : -1;
    add(0, dir);
    if (r === (color === "w" ? 1 : 6)) add(0, 2 * dir);
    add(-1, dir); add(1, dir);
  } else if (STEPS[type]) {
    for (const [df, dr] of STEPS[type]) add(df, dr);
    if (type === "k" && f === 4 && r === (color === "w" ? 0 : 7)) { add(2, 0); add(-2, 0); }
  } else {
    for (const [df, dr] of RAYS[type]) for (let k = 1; k < 8; k++) add(df * k, dr * k);
  }
  return out;
}
