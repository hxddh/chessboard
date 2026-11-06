/**
 * The coach's facts at the board, pure and engine-free: what the opponent
 * threatens now, what a move leaves en prise or allows, the checks and
 * captures to look at. The page combines them with a quick engine check
 * (core/winpct) before it says anything (v20-0-plan §3 P2, P3).
 *
 * Every fact is proved on the board: a mate is a checkmate after the move; a
 * man "hangs" when the capture wins material outright — nobody can take back,
 * or the taker is worth less than what it took.
 * @module core/coach
 */
import { Chess } from "./chess.js";
import { parseUci } from "./rules.js";
import { winPctDrop, WIN_MISTAKE } from "./winpct.js";

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** The same position with the other side to move (no en passant, no check allowed). */
export function passTurn(fen) {
  const f = fen.split(" ");
  f[1] = f[1] === "w" ? "b" : "w";
  f[3] = "-";
  try {
    const g = new Chess(f.join(" "));
    return g.fen().split(" ")[0] === f[0] ? f.join(" ") : null;
  } catch { return null; }
}

/**
 * The most the side to move of `fen` wins with one move: a mate, or the
 * capture that nets the most. { kind: "mate"|"material", san, from, to, piece, by, gain } or null.
 */
export function bestShot(fen) {
  let g;
  try { g = new Chess(fen); } catch { return null; }
  let best = null;
  for (const m of g.moves({ verbose: true })) {
    g.move(m);
    if (g.in_checkmate()) { g.undo(); return { kind: "mate", san: m.san, from: m.from, to: m.to, piece: null, by: m.piece, gain: 100 }; }
    if (m.captured) {
      const takenBack = g.moves({ verbose: true }).some((r) => r.to === m.to && r.captured);
      const gain = VALUE[m.captured] - (takenBack ? VALUE[m.piece] : 0);
      if (gain > 0 && (!best || gain > best.gain)) best = { kind: "material", san: m.san, from: m.from, to: m.to, piece: m.captured, by: m.piece, gain };
    }
    g.undo();
  }
  return best;
}

/**
 * What the opponent threatens in `fen` (the player to move): the shot it
 * would have if it were its turn. Null when there is none worth a word
 * (less than a minor piece's worth, or the player is in check — the check
 * is the threat, and the board already shows it).
 */
export function threatNow(fen) {
  const g = new Chess(fen);
  if (g.in_check()) return { kind: "check" };
  const flipped = passTurn(fen);
  if (!flipped) return null;
  const s = bestShot(flipped);
  if (!s) return null;
  if (s.kind === "mate" || s.gain >= 2 || (s.gain >= 1 && s.piece !== "p")) return s;
  return null;
}

/** The checks and captures the side to move has, SAN, checks first. */
export function checksAndCaptures(fen) {
  const ms = new Chess(fen).moves({ verbose: true });
  const checks = ms.filter((m) => /[+#]$/.test(m.san));
  const caps = ms.filter((m) => m.captured && !/[+#]$/.test(m.san));
  return { checks: checks.map((m) => ({ san: m.san, from: m.from, to: m.to })), captures: caps.map((m) => ({ san: m.san, from: m.from, to: m.to })) };
}

/**
 * What playing `uci` in `fen` hands the opponent at once: a mate, or a man
 * it wins outright. { kind, san, piece, gain, fenAfter } or null.
 */
export function dangerAfter(fen, uci) {
  const p = parseUci(uci);
  if (!p) return null;
  const g = new Chess(fen);
  const mv = g.move({ from: p.from, to: p.to, promotion: p.promotion || "q" });
  if (!mv) return null;
  const s = bestShot(g.fen());
  if (!s) return null;
  // a capture the move itself paid for is a trade, not a loss
  const credit = mv.captured ? VALUE[mv.captured] : 0;
  if (s.kind === "mate") return { ...s, fenAfter: g.fen() };
  const net = s.gain - credit;
  return net >= 2 ? { ...s, gain: net, fenAfter: g.fen() } : null;
}

/**
 * Whether the coach should ask before the move is committed.
 * @param {object} o
 * @param {object|null} o.rule    dangerAfter()
 * @param {object|null} o.facts   explainMistake() for the move, when the engine answered
 * @param {number|null} o.before  scalar before the move (the engine's best), White view
 * @param {number|null} o.after   scalar after the move, White view
 * @param {"w"|"b"} o.side        the mover
 * @returns {{ ask: boolean, why: "mate"|"material"|null, drop: number|null }}
 */
export function shouldAsk({ rule, facts, before, after, side }) {
  const drop = before != null && after != null ? winPctDrop(before, after, side) : null;
  const mates = (rule && rule.kind === "mate") || !!(facts && facts.refute && facts.refute.mate);
  const hangs = (rule && rule.kind === "material") ||
    !!(facts && ((facts.lost && facts.lost.net >= 2) || (facts.refute && facts.refute.motif === "hanging")));
  const why = mates ? "mate" : hangs ? "material" : null;
  if (!why) return { ask: false, why: null, drop };
  // without the engine, only what the board proves outright: a mate, or a rook's worth
  if (drop == null) return { ask: mates || (rule && rule.gain >= 3) || false, why, drop };
  return { ask: drop >= WIN_MISTAKE, why, drop };
}
