/**
 * 终局：这盘棋怎么结束的，和结果卡。
 *
 * v8-0-plan F4 (M4): the ending of the live game (gameEnding: the result
 * token, the winner and the reason in words) and the result card that says
 * it (renderGameOverCard, 7.7 §4), moved out of app.js ahead of A5, which
 * draws the ending on the board as well. Moved, not rewritten: the bodies
 * are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createGameEnd()`, createLibraryUI's shape; nothing here reaches back
 * into app.js. The pure modules are imported, not passed.
 * @module game-end
 */
import { ChessEngine } from "./engine.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createGameEnd(d) {
  const {
    store, t, tf, sideName, game, el, setText, avail, toast, sanHistory, analysisFor,
    appGameOver, resultFromFile, gameResultToken, timeoutIsDraw, autoDrawReason, isPanelOpen,
  } = d;

  /**
   * How the live game ended, or null while it is still going (7.7 §4).
   * Only the two game modes have an ending to report; the trainers have
   * their own cards.
   */
  function gameEnding() {
    const mode = store.session.mode;
    if ((mode !== "ai" && mode !== "pvp") || store.session.editor) return null;
    if (!appGameOver() && !resultFromFile()) return null;
    const token = gameResultToken();
    const winner = token === "1-0" ? "w" : token === "0-1" ? "b" : null;
    let reason;
    if (resultFromFile()) reason = t("go.r.file");
    else if (game.in_checkmate()) reason = t("go.r.mate");
    else if (store.game.flagFall) reason = timeoutIsDraw() ? t("go.r.flagDraw") : tf("go.r.flag", [sideName(store.game.flagFall)]);
    else if (store.game.resigned) reason = tf("go.r.resign", [sideName(store.game.resigned)]);
    else if (store.game.drawAgreed) reason = t("go.r.agreed");
    else if (store.game.drawClaimed) reason = t(store.game.drawClaimed === "threefold" ? "go.r.threefold" : "go.r.fifty");
    else if (game.in_stalemate()) reason = t("go.r.stalemate");
    else if (game.insufficient_material()) reason = t("go.r.insufficient");
    else reason = t(autoDrawReason() === "fivefold" ? "go.r.fivefold" : "go.r.seventyfive");
    return { token, winner, reason, sig: sanHistory().length + "|" + game.fen() + "|" + token };
  }

  /**
   * The result card (7.7, v7-7-plan §4): the result in large type, how it
   * came about, and what to do next — 分析这盘 filled while the game is not
   * analysed, 再来一盘 and 换个对手 beside it. It replaces the toast that
   * used to be the whole of the ending. Non-modal and in the panel, so it can
   * never cover the board; ✕ puts it away for this ending.
   */
  function renderGameOverCard() {
    const card = el("go-card");
    if (!card) return;
    const end = gameEnding();
    // An ending's ✕ and its announcement belong to that ending. The signature
    // (plies, final FEN, result) cannot tell a replay of the same short mate
    // from the one already put away (Codex on #82), so whenever the game is
    // not over — every new game, undo, or load of an unfinished one passes
    // through that — both are forgotten.
    if (!end) { store.session.goDismissed = null; store.session.goAnnounced = null; }
    const show = !!end && store.session.goDismissed !== end.sig;
    card.hidden = !show;
    if (!show) return;
    const mode = store.session.mode;
    const mine = mode === "ai" ? store.session.humanColor : null;
    const result = !end.winner ? t("go.draw")
      : mine ? t(end.winner === mine ? "go.youWin" : "go.youLose")
      : t(end.winner === "w" ? "go.whiteWins" : "go.blackWins");
    // The card lives in the panel. With the panel shut it is off-screen, the
    // ending no longer toasts, and #status is for screen readers only — so a
    // mate would pass with nothing on screen but the strips' 1 / 0 (Codex on
    // #82). Say it once, beside the board (§1d keeps toasts off it), for a
    // game that ended here rather than one opened already finished.
    if (store.session.goAnnounced !== end.sig) {
      store.session.goAnnounced = end.sig;
      if (!isPanelOpen() && !resultFromFile()) toast(result + " · " + end.reason, "fix");
    }
    setText(el("go-result"), result);
    setText(el("go-reason"), end.reason);
    setText(el("go-mark"), end.token === "1/2-1/2" ? "½–½" : end.token.replace("-", "–"));
    card.classList.toggle("won", !!end.winner && (!mine || end.winner === mine));
    const engineDown = !ChessEngine || !!store.session.engineDown;
    // A position loaded already over (a mated FEN, a result-only PGN) has an
    // ending but no moves, and analyzeGame() refuses an empty history — the
    // review row's 分析 already asks for one (Codex on #82)
    const canAnalyse = !engineDown && sanHistory().length > 0 && !analysisFor() && !store.session.analyzing;
    avail(el("go-analyse"), canAnalyse);
    avail(el("go-switch"), mode === "ai");
    // v8-0-plan §5: a finished game from the library or a file is a record,
    // and 再来一盘 of a game you did not play is not a rematch
    avail(el("go-again"), !store.game.imported);
    // …which can leave the row empty (an analysed library game)
    const acts = card.querySelector(".go-acts");
    if (acts) acts.hidden = ![...acts.children].some((b) => !b.hidden);
  }

  return { gameEnding, renderGameOverCard };
}
