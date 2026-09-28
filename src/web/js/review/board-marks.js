/**
 * 复盘在棋盘上的标记：引擎线的箭头、错着的最佳着箭头和着法标记角标。
 *
 * v8-0-plan F4 (M3): what the board draws from the analysis, moved out of
 * app.js — the engine lines' first moves as arrows (engineArrows, 持续分析
 * or the review's lines), the engine's choice where a move was marked
 * (bestArrowAt, the board model's hint) and the mark's badge on the square
 * the move landed on (annotationAt). All of it derived from the analysis and
 * the replay cursor, nothing stored. Moved, not rewritten: the bodies are
 * the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createBoardMarks()`, createLibraryUI's shape; nothing here reaches back
 * into app.js. The pure modules are imported, not passed.
 * @module review/board-marks
 */
import { Chess } from "../chess.js";
import { ChessReview } from "../review.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createBoardMarks(d) {
  const {
    store, viewGame, isLive, appGameOver, analysisFor, reviewLines, softFiltered,
  } = d;
  const Review = ChessReview;

  /**
   * 7.8 §2: the first move of each engine line, as board arrows — line 1 in
   * the engine's colour (letter E, --engine-arrow), lines 2 and 3 lighter
   * (e, --engine-arrow-alt). Through the same shapes channel as the player's
   * arrows, never stored in the tree: derived from what the desk shows.
   *
   * 持续分析 on this position wins; otherwise the review's lines, but not at
   * the live position of an engine game still being played — that would be
   * an answer key, the same reason bestArrowAt keeps out of live play. The
   * principal arrow is left out where the review's mistake arrow already
   * draws that move. 「显示引擎箭头」 turns all of it off.
   */
  function engineArrows() {
    if (!store.ui.engineArrows) return [];
    const g = viewGame();
    const fen = g.fen();
    const live = store.session.live;
    let firsts = [];
    // the arrow the board model already draws as its hint (same expression)
    const hint = isLive() ? store.session.hintMove : bestArrowAt(store.game.viewIndex);
    if (live && live.fen === fen) {
      if (live.info) firsts = live.info.lines.slice(0, 3).map((l) => uciArrow(Array.isArray(l.pv) ? l.pv[0] : null));
    } else {
      const a = analysisFor();
      const inGame = isLive() && store.session.mode === "ai" && !appGameOver() && !store.game.imported;
      if (!a || inGame || store.session.analyzing) return [];
      const vi = store.game.viewIndex;
      const memo = store.session._engineArrows;
      if (memo && memo.a === a && memo.vi === vi && memo.fen === fen) firsts = memo.firsts;
      else {
        const lines = reviewLines(a, vi, g.turn());
        firsts = lines.slice(0, 3).map((l, i) => {
          if (i === 0 && a.bests && a.bests[vi]) return uciArrow(a.bests[vi]);
          const m = l.sans[0] ? new Chess(fen).move(l.sans[0]) : null;
          return m ? { from: m.from, to: m.to } : null;
        });
        store.session._engineArrows = { a, vi, fen, firsts };
      }
    }
    const out = [];
    firsts.forEach((m, i) => {
      if (!m) return;
      if (i === 0 && hint && hint.from === m.from && hint.to === m.to) return;
      // two lines can open with the same move; one arrow says it
      if (out.some((o) => o.from === m.from && o.to === m.to)) return;
      out.push({ from: m.from, to: m.to, color: i === 0 ? "E" : "e" });
    });
    return out;
  }
  function uciArrow(u) {
    return typeof u === "string" && u.length >= 4 ? { from: u.slice(0, 2), to: u.slice(2, 4) } : null;
  }

  /**
   * The engine's choice at the position `i` plies in, as a board arrow —
   * derived from the analysis and the replay cursor, never stored. Nothing to
   * clear on a new game, nothing to migrate, nothing that can fall out of step
   * with the board because it *is* a function of the board.
   */
  function bestArrowAt(i) {
    const a = analysisFor();
    if (!a || !a.bests || !a.tags) return null;
    if (!Review.isMistake(a.tags[i])) return null;
    const uci = a.bests[i];
    if (!uci || uci.length < 4) return null;
    return { from: uci.slice(0, 2), to: uci.slice(2, 4) };
  }

  /**
   * The badge for the move that produced the position `i` plies in: its
   * destination square and its mark, or null. The mark is the one the move
   * list shows (softFiltered — `?!` only when 存疑标注 is on), so the board
   * and the notation cannot disagree about whether a move was a mistake.
   * Derived like bestArrowAt: nothing stored, nothing to clear.
   */
  function annotationAt(i, last) {
    if (!last || i < 1) return null;
    const a = analysisFor();
    if (!a || !a.tags) return null;
    const tag = softFiltered(a.tags[i - 1]);
    if (!Review.isMistake(tag)) return null;
    return { sq: last.to, tag };
  }

  return { engineArrows, bestArrowAt, annotationAt };
}
