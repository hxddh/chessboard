/**
 * Maia-3's view of a position, and its move vocabulary (Monroe et al.,
 * "Chessformer", ICLR 2026, §3; inputs as the released 5M net expects them).
 *
 *   input   64 square tokens × (12 pieces × 8 positions): the current
 *           position and the 7 before it, oldest first, the earliest repeated
 *           when fewer are known. Each position is seen from the side to move
 *           *in that position*: when Black is to move the board is flipped
 *           top to bottom and the colours swapped, so "own" pieces are always
 *           channels 0–5 (P N B R Q K) and the opponent's 6–11.
 *           No castling rights, en-passant square or move counters.
 *   output  4352 move logits in the mover's frame: 64 × 64 from→to
 *           (from·64 + to, a1 = 0, h8 = 63), then 256 promotions from the
 *           seventh rank to the eighth, (fromFile·8 + toFile)·4 + q/r/b/n.
 *
 * Pure; no chess rules beyond reading a FEN. Legal moves come from the caller.
 * @module services/maia3/encode
 */

export const HISTORY = 8;
export const MOVES = 4352;
const PIECES = "pnbrqk";

/** FEN → { squares: Int8Array(64) (0 empty, 1–6 white P…K, −1…−6 black), black } */
export function readFen(fen) {
  const [place, turn] = String(fen).trim().split(/\s+/);
  const squares = new Int8Array(64);
  const rows = place.split("/");
  if (rows.length !== 8) throw new Error("maia3: bad FEN " + fen);
  for (let r = 0; r < 8; r++) {
    let file = 0;
    for (const c of rows[r]) {
      if (c >= "1" && c <= "8") { file += Number(c); continue; }
      const t = PIECES.indexOf(c.toLowerCase()) + 1;
      if (!t || file > 7) throw new Error("maia3: bad FEN " + fen);
      squares[(7 - r) * 8 + file] = c === c.toLowerCase() ? -t : t;
      file++;
    }
  }
  return { squares, black: turn === "b" };
}

/**
 * The active input features of a position and its history, as
 * Int32Array([square, channel, square, channel, …]); channel 0–95.
 * @param {string[]} fens oldest first, the current position last
 */
export function features(fens) {
  const last = fens.slice(-HISTORY);
  const slots = Array.from({ length: HISTORY - last.length }, () => last[0]).concat(last);
  const out = [];
  slots.forEach((fen, t) => {
    const { squares, black } = readFen(fen);
    for (let s = 0; s < 64; s++) {
      const p = squares[s];
      if (!p) continue;
      const own = black ? p < 0 : p > 0;
      out.push(black ? s ^ 56 : s, t * 12 + Math.abs(p) - 1 + (own ? 0 : 6));
    }
  });
  return Int32Array.from(out);
}

const sq = (name) => name.charCodeAt(0) - 97 + 8 * (name.charCodeAt(1) - 49);
const flip = (name) => name[0] + String(9 - Number(name[1]));

/** The logit index of a UCI move played by `black` or White. */
export function moveIndex(uci, black) {
  let from = uci.slice(0, 2), to = uci.slice(2, 4);
  if (black) { from = flip(from); to = flip(to); }
  const promo = uci[4];
  if (promo) return 4096 + ((from.charCodeAt(0) - 97) * 8 + to.charCodeAt(0) - 97) * 4 + "qrbn".indexOf(promo);
  return sq(from) * 64 + sq(to);
}

/**
 * Softmax over the legal moves only.
 * @param {Float32Array} logits 4352
 * @param {string[]} legal UCI
 * @returns {{ move: string, p: number }[]} most likely first
 */
export function legalPolicy(logits, legal, black) {
  const xs = legal.map((m) => logits[moveIndex(m, black)]);
  const top = Math.max(...xs);
  const w = xs.map((x) => Math.exp(x - top));
  const sum = w.reduce((a, b) => a + b, 0);
  return legal.map((move, i) => ({ move, p: w[i] / sum })).sort((a, b) => b.p - a.p);
}

/** Value logits [loss, draw, win] (side to move) → { win, draw, loss } probabilities. */
export function wdl(value) {
  const top = Math.max(value[0], value[1], value[2]);
  const e = [0, 1, 2].map((i) => Math.exp(value[i] - top));
  const s = e[0] + e[1] + e[2];
  return { win: e[2] / s, draw: e[1] / s, loss: e[0] / s };
}
