/**
 * Move mini-games (v20-0-plan §2 L1: 「前几课是走子小游戏」): one white man
 * walks the board and collects every target — a star on an empty square or
 * a black man standing there. Nothing replies, nothing checks: other men are
 * walls (your own, and the kings), black men other than the king can be
 * taken. A pawn that reaches the last rank becomes a queen and walks on.
 *
 * The same code generates and proves the positions (scripts/gen-skills.mjs:
 * a breadth-first search finds the fewest moves, `par`) and runs them on the
 * learn page, so what the page accepts is what was proved.
 *
 *   start(fen, targets, only) → game        play(game, from, to) → game | null
 *   destsOf(game) → Map(from → [to])         solve(fen, targets, only) → { par, path } | null
 * @module learn/minigame
 */

const FILES = "abcdefgh";
const sqOf = (f, r) => FILES[f] + (r + 1);
const fOf = (sq) => sq.charCodeAt(0) - 97;
const rOf = (sq) => Number(sq[1]) - 1;

/** FEN board → { sq: letter } */
export function boardOf(fen) {
  const out = {};
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, i) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) f += Number(ch);
      else { out[sqOf(f, 7 - i)] = ch; f++; }
    }
  });
  return out;
}

/** { sq: letter } → a FEN with White to move (no castling, no en passant). */
export function fenOf(board) {
  const rows = [];
  for (let r = 7; r >= 0; r--) {
    let row = "", empty = 0;
    for (let f = 0; f < 8; f++) {
      const p = board[sqOf(f, r)];
      if (!p) { empty++; continue; }
      if (empty) { row += empty; empty = 0; }
      row += p;
    }
    rows.push(row + (empty || ""));
  }
  return rows.join("/") + " w - - 0 1";
}

const RAYS = {
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
};
RAYS.q = [...RAYS.r, ...RAYS.b];
const STEPS = {
  n: [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]],
  k: [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]],
};
const isBlack = (p) => !!p && p === p.toLowerCase();
const takeable = (p) => isBlack(p) && p !== "k";

/** Where the white man on `from` may go on `board`. */
export function movesFrom(board, from) {
  const p = board[from];
  if (!p || isBlack(p)) return [];
  const t = p.toLowerCase(), f0 = fOf(from), r0 = rOf(from), out = [];
  const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
  if (RAYS[t]) {
    for (const [df, dr] of RAYS[t]) {
      for (let f = f0 + df, r = r0 + dr; on(f, r); f += df, r += dr) {
        const q = board[sqOf(f, r)];
        if (!q) { out.push(sqOf(f, r)); continue; }
        if (takeable(q)) out.push(sqOf(f, r));
        break;
      }
    }
  } else if (STEPS[t]) {
    for (const [df, dr] of STEPS[t]) {
      const f = f0 + df, r = r0 + dr;
      if (!on(f, r)) continue;
      const q = board[sqOf(f, r)];
      if (!q || takeable(q)) out.push(sqOf(f, r));
    }
  } else if (t === "p") {
    if (r0 < 7 && !board[sqOf(f0, r0 + 1)]) {
      out.push(sqOf(f0, r0 + 1));
      if (r0 === 1 && !board[sqOf(f0, 3)]) out.push(sqOf(f0, 3));
    }
    for (const df of [-1, 1]) if (on(f0 + df, r0 + 1) && takeable(board[sqOf(f0 + df, r0 + 1)])) out.push(sqOf(f0 + df, r0 + 1));
  }
  return out;
}

/** The square of the white man that walks: the first of type `only`. */
function walkerOf(board, only) {
  return Object.keys(board).sort().find((sq) => board[sq] === only.toUpperCase()) || null;
}

export function start(fen, targets, only) {
  const board = boardOf(fen);
  const at = walkerOf(board, only);
  if (!at) throw new Error("minigame: no white " + only + " in " + fen);
  return { board, at, left: targets.filter((t) => t !== at), moves: 0, done: false };
}

/** One move of the walker, or null when it is not one. */
export function play(game, from, to) {
  if (game.done || from !== game.at || !movesFrom(game.board, from).includes(to)) return null;
  const board = { ...game.board };
  let p = board[from];
  delete board[from];
  if (p === "P" && to[1] === "8") p = "Q";
  board[to] = p;
  const left = game.left.filter((t) => t !== to);
  return { board, at: to, left, moves: game.moves + 1, done: left.length === 0 };
}

export const fenOfGame = (game) => fenOf(game.board);
export const destsOf = (game) => new Map(game.done ? [] : [[game.at, movesFrom(game.board, game.at)]]);

/**
 * The fewest moves that collect every target (breadth-first over the
 * walker's square, its kind and the targets left), with one shortest path
 * as UCI moves; null when some target cannot be reached.
 */
export function solve(fen, targets, only, { maxMoves = 16 } = {}) {
  const g0 = start(fen, targets, only);
  if (!g0.left.length) return { par: 0, path: [] };
  const key = (g) => fenOf(g.board) + g.left.join("");
  const seen = new Set([key(g0)]);
  let frontier = [{ g: g0, path: [] }];
  for (let depth = 1; depth <= maxMoves && frontier.length; depth++) {
    const next = [];
    for (const { g, path } of frontier) {
      for (const to of movesFrom(g.board, g.at)) {
        const h = play(g, g.at, to);
        const p = [...path, g.at + to];
        if (h.done) return { par: depth, path: p };
        const k = key(h);
        if (seen.has(k)) continue;
        seen.add(k);
        next.push({ g: h, path: p });
      }
    }
    frontier = next;
  }
  return null;
}
