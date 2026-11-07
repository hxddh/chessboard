/**
 * Small, pure helpers over chess.js for the app: legal destinations, applying
 * a move given as UCI, and how a game ends.
 * @module core/rules
 */
import { Chess, ChessFide } from "./chess.js";

export const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/** Legal moves of the side to move, as Map(from → [to…]). */
export function legalDests(fen) {
  const out = new Map();
  for (const m of new Chess(fen).moves({ verbose: true })) {
    const list = out.get(m.from);
    if (list) { if (!list.includes(m.to)) list.push(m.to); } else out.set(m.from, [m.to]);
  }
  return out;
}

/** "e7e8q" → { from, to, promotion } */
export function parseUci(uci) {
  const m = /^([a-h][1-8])([a-h][1-8])([qrbn])?$/.exec(String(uci));
  return m ? { from: m[1], to: m[2], promotion: m[3] } : null;
}

/**
 * Play `uci` on `fen`. A pawn reaching the last rank without a piece named
 * becomes a queen. Returns null for an illegal move.
 * @returns {{ uci: string, san: string, fen: string, captured: string|null, check: boolean } | null}
 */
export function applyMove(fen, uci) {
  const p = parseUci(uci);
  if (!p) return null;
  const g = new Chess(fen);
  const legal = g.moves({ verbose: true }).find((m) => m.from === p.from && m.to === p.to &&
    (!m.promotion || m.promotion === (p.promotion || "q")));
  if (!legal) return null;
  const mv = g.move(legal);
  return { uci: mv.from + mv.to + (mv.promotion || ""), san: mv.san, fen: g.fen(),
    captured: mv.captured || null, check: g.in_check() };
}

/** Side to move: "w" | "b". */
export const turnOf = (fen) => String(fen).split(" ")[1] === "b" ? "b" : "w";

/** Square of the king of the side to move when it is in check, else null. */
export function checkSquare(fen) {
  const g = new Chess(fen);
  if (!g.in_check()) return null;
  const t = g.turn();
  const b = g.board();
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const p = b[r][c];
    if (p && p.type === "k" && p.color === t) return "abcdefgh"[c] + (8 - r);
  }
  return null;
}

/**
 * How the game stands after the last of `fens` (start included): null while it
 * goes on, else { result: "1-0"|"0-1"|"1/2-1/2", reason }. Only the endings the
 * laws make automatic (FIDE 9.6): threefold and fifty moves are claims.
 */
export function outcome(fens) {
  const fen = fens[fens.length - 1];
  const g = new Chess(fen);
  if (g.in_checkmate()) return { result: g.turn() === "w" ? "0-1" : "1-0", reason: "checkmate" };
  if (g.in_stalemate()) return { result: "1/2-1/2", reason: "stalemate" };
  if (g.insufficient_material()) return { result: "1/2-1/2", reason: "insufficient" };
  const key = ChessFide.positionKey(fen, g);
  let reps = 0;
  for (const f of fens) if (ChessFide.positionKey(f, null, Chess) === key) reps++;
  if (reps >= 5) return { result: "1/2-1/2", reason: "fivefold" };
  if (ChessFide.halfmoveClock(fen) >= 150) return { result: "1/2-1/2", reason: "seventy-five" };
  return null;
}

/**
 * A draw the player to move may claim (FIDE 9.2, 9.3) after the last of
 * `fens`: "threefold" | "fifty" | null.
 */
export function claimable(fens) {
  const fen = fens[fens.length - 1];
  const key = ChessFide.positionKey(fen, null, Chess);
  let reps = 0;
  for (const f of fens) if (ChessFide.positionKey(f, null, Chess) === key) reps++;
  if (reps >= 3) return "threefold";
  if (ChessFide.halfmoveClock(fen) >= 100) return "fifty";
  return null;
}

/** FIDE 6.9: `color` ran out of time; does the other side still have mating material? */
export function canMateAfterFlag(fen, color) {
  return ChessFide.hasMatingMaterial(new Chess(fen).board(), color === "w" ? "b" : "w");
}
