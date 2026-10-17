/**
 * 谜题的提示，两级（14.0 A2, docs/v14-0-plan.md §1）。
 *
 * The chrome's one key used to be 「答案」: the move as an arrow, and the
 * puzzle counted wrong. Now the first press says which piece moves — a ring
 * on its square, 「提示」 — and the puzzle still counts, at half the rating
 * gain; the second press is the answer, as before: a miss, and the puzzle is
 * not marked solved when it is played out. Each step of a longer line starts
 * again at the first level (the move clears both marks).
 *
 * The plan's three levels (piece, square, answer) are two here: for one move
 * the square it goes to is the answer.
 * @module trainer/puzzle-hint
 */
import { Chess } from "../chess.js";
import { blackForcedLost } from "./puzzle-mate.js";

/**
 * @param {object} d store, t, toast, markMissed, puzzleHumanSide,
 *   runAnswer (a run's own answer), stored(pz) (the stored move of this
 *   step, or null), movesLeft(pz) (for a mate puzzle off its stored line)
 */
export function createPuzzleHint(d) {
  const { store, t, toast, markMissed, puzzleHumanSide, runAnswer, stored, movesLeft } = d;

  /** The move that solves this step: the stored one, else any that still forces mate. */
  function answerMove(pz) {
    const g = pz.g;
    const s = stored(pz);
    if (s) {
      const mv = new Chess(g.fen()).move(s);
      if (mv) return { from: mv.from, to: mv.to };
    }
    const remaining = movesLeft(pz);
    for (const m of g.moves({ verbose: true })) {
      g.move(m);
      const ok = g.in_checkmate() || (remaining > 1 && !g.game_over() && blackForcedLost(g, remaining - 1));
      g.undo();
      if (ok) return { from: m.from, to: m.to };
    }
    return null;
  }

  /** The key: the piece first, the answer after it. */
  function show() {
    const pz = store.session.puzzle;
    if (!pz || pz.done) return;
    if (pz.run) { runAnswer(); return; }
    if (pz.g.turn() !== puzzleHumanSide() || pz.g.game_over()) return;
    const mv = answerMove(pz);
    if (!mv) return;
    if (!pz.helpPiece && !pz.helpArrow) {
      pz.helpPiece = mv.from;
      pz.usedHint = true;
      toast(t("pz.hintPiece"));
    } else {
      pz.helpArrow = mv;
      pz.usedAnswer = true;
      markMissed(pz.p.id); // relying on the answer counts as a miss
    }
    store.commit("session", "sync");
  }

  /** The board's mark for the first level: a ring on the piece to move. */
  function shapes(pz) {
    return pz && pz.helpPiece && !pz.helpArrow ? { arrows: [], circles: [{ sq: pz.helpPiece, color: "G" }] } : undefined;
  }

  /** What the key says now: 提示 until the piece is shown, then 答案. */
  function level(pz) {
    return pz && !pz.run && !pz.helpPiece && !pz.helpArrow ? "hint" : "answer";
  }

  return { show, shapes, level, answerMove };
}
