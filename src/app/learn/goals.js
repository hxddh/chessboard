/**
 * One-move goals (19.0 lessons' `move` tasks, and the generated positions
 * for castling, en passant, check and the basic mates): does this move do
 * what the task asks? Shared by the learn page and scripts/gen-skills.mjs,
 * which proves every task's own solution meets its goal.
 *
 *   any | check | mate | capture (target) | one-of (accept) | safe |
 *   castle | castle-k | castle-q | ep | promote | draw-insufficient
 * @module learn/goals
 */
import { Chess } from "../core/chess.js";

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Is the man on `sq` attacked by the side to move in `g`'s position? */
function attacked(g, sq) {
  return g.moves({ verbose: true }).some((m) => m.to === sq);
}

/**
 * @param {string} fen  the task's position
 * @param {string} move SAN or UCI
 * @param {object} task { goal, accept?, target? }
 * @returns {null | { ok: boolean, san: string, fen: string, uci: string }} null when the move is illegal
 */
export function judge(fen, move, task) {
  const g = new Chess(fen);
  const mv = /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(move)
    ? g.move({ from: move.slice(0, 2), to: move.slice(2, 4), promotion: move[4] || "q" })
    : g.move(move);
  if (!mv) return null;
  const out = { san: mv.san, fen: g.fen(), uci: mv.from + mv.to + (mv.promotion || "") };
  const flags = mv.flags || "";
  let ok;
  switch (task.goal) {
    case "any": ok = true; break;
    case "check": ok = g.in_check(); break;
    case "mate": ok = g.in_checkmate(); break;
    case "capture": ok = !!mv.captured && (!task.target || mv.to === task.target); break;
    case "one-of": ok = (task.accept || []).includes(mv.san) || (task.accept || []).includes(mv.san.replace(/[+#]$/, "")); break;
    case "castle": ok = flags.includes("k") || flags.includes("q"); break;
    case "castle-k": ok = flags.includes("k"); break;
    case "castle-q": ok = flags.includes("q"); break;
    case "ep": ok = flags.includes("e"); break;
    case "promote": ok = !!mv.promotion; break;
    case "draw-insufficient": ok = g.insufficient_material(); break;
    case "safe": {
      // the man that moved is not left to be taken for less than it is worth
      const takers = g.moves({ verbose: true }).filter((m) => m.to === mv.to);
      ok = !takers.length || takers.every((m) => VALUE[m.piece] >= VALUE[mv.piece] && !undefendedAfter(g, m));
      if (task.accept && task.accept.includes(mv.san)) ok = true;
      break;
    }
    default: throw new Error("goals: unknown goal " + task.goal);
  }
  return { ...out, ok };
}

function undefendedAfter(g, take) {
  g.move(take);
  const back = attacked(g, take.to);
  g.undo();
  return !back;
}
