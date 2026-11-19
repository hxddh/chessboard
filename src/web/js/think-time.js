/**
 * 25.0 N13 (对手用时像人): how long an unclocked opponent holds its reply.
 *
 * Through 24.0 every reply took the rung's `minMs` (engine.js TIERS) — Pip
 * ~365 ms, Vera ~615 ms, Leo ~765 ms — the same for an only move, a
 * recapture and a quiet middlegame decision, which is what makes a bot read
 * as a bot. Here the rung's minimum becomes a mean: a forced or obvious reply
 * comes quicker, a position with many moves, captures on offer or the
 * material out of balance takes longer, and a bounded jitter drawn from the
 * position (not a random draw: the same FEN is held the same time, so tests
 * can say what it is) keeps two similar moves from taking identical time.
 *
 * Only the hold: which move is played is decided before this runs, and a
 * clocked game keeps its own pace (opponents.js thinkPlan) — the clock is
 * the time manager there. In the opponents chunk, not the bundle: until it
 * lands, a reply holds `minMs` as before.
 * @module think-time
 */

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9 };
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR";
/** a person plays the first moves of a game from memory */
const BOOK_PLIES = 10;

/** the FEN's placement as 64 characters, a8 first, "." for empty */
const squares = (fen) => fen.split(" ")[0].replace(/\d/g, (n) => ".".repeat(+n)).replace(/\//g, "");
const index = (sq) => (8 - Number(sq[1])) * 8 + (sq.charCodeAt(0) - 97);
/** 32-bit FNV-1a: a stable [0, 1) from a string */
function unit(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return (h >>> 0) / 4294967296;
}

/**
 * The hold as a multiple of the rung's minimum, 0.35–1.7.
 * @param {string} fen the position the opponent moves from
 * @param {string|null} to the square its chosen move lands on
 * @param {Function} Chess chess.js
 * @param {string[]} [fens] the game's positions from its start (app.js gameFens)
 */
export function thinkFactor(fen, to, Chess, fens) {
  const g = new Chess(fen);
  if (g.fen().split(" ")[0] !== String(fen).split(" ")[0]) return 1; // not a position chess.js read
  const legal = g.moves({ verbose: true });
  const hist = fens && fens.length ? (fens[fens.length - 1] === fen ? fens : fens.concat([fen])) : [fen];
  let f;
  if (legal.length <= 1) f = 0.4;                       // the only move
  else {
    const us = g.turn(), cur = squares(fen);
    const ours = (c) => c !== "." && (c === c.toUpperCase()) === (us === "w");
    const prev = hist.length > 1 ? squares(hist[hist.length - 2]) : null;
    const i = to && /^[a-h][1-8]$/.test(to) ? index(to) : -1;
    if (g.in_check()) f = 0.6;                          // answering a check
    else if (prev && i >= 0 && ours(prev[i]) && cur[i] !== "." && !ours(cur[i])) f = 0.55; // taking back
    else if (hist.length <= BOOK_PLIES && hist[0].split(" ")[0] === START) f = 0.55; // the opening, by heart
    else {
      let mat = 0;
      for (const c of cur) { const v = VAL[c.toLowerCase()]; if (v) mat += ours(c) ? v : -v; }
      const caps = legal.filter((m) => m.captured).length;
      f = 0.55 + 0.014 * Math.min(legal.length, 50) + 0.06 * Math.min(caps, 4) + (Math.abs(mat) >= 2 ? 0.12 : 0);
    }
  }
  return Math.min(1.7, Math.max(0.35, f * (0.85 + 0.3 * unit(fen))));
}

/**
 * How long to hold the reply, in ms; `minMs` itself when anything is off.
 * @param {number} minMs the rung's own minimum (engine.js TIERS)
 */
export function thinkMs(minMs, fen, to, Chess, fens) {
  try { return Math.round(minMs * thinkFactor(fen, to, Chess, fens)); } catch (_) { return minMs; }
}
