/**
 * 对局流程：悔棋、新局、从这里续下、认输、提和与失着提醒。
 *
 * v8-1-plan F3: app.js's game-flow region, moved whole — taking a move back,
 * the new-game dialog (the settings page's own rows, hosted while it is
 * open) and the start it leads to, 从这里续下, resigning and the record an
 * app-level ending files, the blunder coach's quiet second look, draw offers
 * and FIDE claims, and the result token a file writes and the [Result] tag a
 * file brings. Moved, not rewritten: the bodies are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createGameController()`, createLibraryUI's shape; nothing here reaches
 * back into app.js. The pure modules are imported, not passed, because they
 * are the same objects app.js imports (patching ChessEngine through the test
 * seam patches this file's copy too).
 * @module game-controller
 */
import { ChessAudio } from "./audio.js";
import { Chess } from "./chess.js";
import { ChessDialog } from "./dialog.js";
import { ChessEngine } from "./engine.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createGameController(d) {
  const {
    t, tf, sideName, game, store, gameUndo, gameReset, switchLine, sanHistory, isLive, baseGame,
    clearPreview, toast, confirmNative, saveSettings, saveGame, OppUI, invalidateEngine, retryEngine,
    engineOut, engineDownToast, maybeEngineTurn, tcTag, resetClocks, learnUndo, evalScalar, newRecordId,
    saveStats, loadStats, renderStats, afterPress, checkNewAchievements, timeoutIsDraw, ruleTerminated,
    claimableDrawReason, naturalGameOver, appGameOver, el, playEnding, sync, syncSettingsUI, syncAutoFlip,
    goLive, stopEditor, refusePgnEdit, Shell, switchMode,
  } = d;
  const Audio2 = ChessAudio;
  const Dlg = ChessDialog;

  /**
   * v8-0-plan §5: 悔棋 is for a game being played here. A game that is over
   * (mate, stalemate, a flag, a resignation, a draw) has nothing to take back
   * into — 重下 / 再来一盘 are the ways on — and a game opened from the
   * library or a file is somebody's record, not a move of yours. The key and
   * the menu stop at the same rule the button is drawn by.
   */
  function canTakeBack() {
    return sanHistory().length > 0 && isLive() && !appGameOver() && !store.game.imported;
  }

  function undo() {
    if (store.session.mode === "learn" && store.session.learn) { learnUndo(); return; }
    if (!sanHistory().length || appGameOver() || store.game.imported) return;
    if (!isLive()) { goLive(); return; }
    if (refusePgnEdit()) return;
    invalidateEngine();
    gameUndo();
    // in AI mode take back the engine reply too, so it's the human's turn again
    if (store.session.mode === "ai") {
      while (sanHistory().length && game.turn() !== store.session.humanColor) gameUndo();
    }
    store.game.selection = null;
    store.game.viewIndex = sanHistory().length;
    syncAutoFlip();
    store.commit("game", "action");
    saveGame();
    maybeEngineTurn();
  }

  /**
   * 新局 / N / 再来一盘 / 换个对手 (v7-8-plan §4).
   *
   * In the two playing modes this is one dialog: the opponent, the side and
   * the clock, then 开始. It used to be a bare 「清空当前对局？」 that restarted
   * with whatever the settings page held, so changing opponent meant three
   * places — the settings tab, the fold, back to 新局. The question the
   * confirm asked is now one line at the top of the dialog, and only when
   * there is something to lose: moves on the board and the game not over
   * (7.7's 再来一盘 already skipped it for a finished game; that is now the
   * rule for every entry). One step, not two.
   *
   * The teaching modes have no opponent to choose and keep the confirm.
   */
  async function requestNewGame(opts) {
    stopEditor(t("msg.editor.exited"));
    const mode = store.session.mode;
    if (mode === "ai" || mode === "pvp") { openNewGame(opts); return; }
    if (sanHistory().length && !appGameOver() &&
        !(await confirmNative(t("dlg.newGame"), t("chrome.new"), { ok: t("chrome.new"), cancel: t("act.cancel") }))) {
      return;
    }
    startNewGame();
  }

  // The dialog hosts the settings page's own rows while it is open — the
  // same four DOM nodes, moved, not a second copy that could drift from the
  // first (their handlers, labels, tooltips and i18n all come along). They
  // go back in front of 失着提醒 when it closes. Moving them is safe with
  // respect to 7.6's rule because it never happens under a press: opening is
  // a click (after pointerup) and closing waits for any press to end.
  const NG_ROWS = ["row-difficulty", "row-persona", "row-color", "row-clock"];
  function hostNewGameRows(inDialog) {
    const host = el("ng-host");
    const home = el("row-coach");
    if (!host || !home) return;
    for (const id of NG_ROWS) {
      const row = el(id);
      if (!row) continue;
      // v8-0-plan B4: rung and style sit in the dialog's 自定义 fold, under the personas
      const dest = id === "row-difficulty" || id === "row-persona" ? el("ng-custom-body") || host : host;
      if (inDialog) { if (row.parentNode !== dest) dest.appendChild(row); }
      else if (row.parentNode !== home.parentNode) home.parentNode.insertBefore(row, home);
    }
  }

  function openNewGame(opts) {
    const modal = el("newgame-modal");
    if (!modal) { startNewGame(); return; }
    const pvp = store.session.mode === "pvp";
    const side = pvp ? (store.game.flipped ? "b" : "w") : store.session.humanColor;
    // the last choices, so Enter alone is 「再来一盘同样的」
    store.ui.newGame = {
      mode: pvp ? "pvp" : "ai", difficulty: store.session.difficulty, personaId: store.session.personaId,
      color: store.session.colorRandom ? "random" : side, timeControl: store.game.timeControl,
    };
    const warn = el("ng-warn");
    if (warn) warn.hidden = !(sanHistory().length && !appGameOver());
    if (opts && opts.switchOpponent) OppUI.applyAdvice();
    hostNewGameRows(true);
    syncSettingsUI();
    // 换个对手 lands on the opponent (its persona card); everything else on 开始
    const card = OppUI.onOpen();
    const first = opts && opts.switchOpponent && !pvp
      ? card || modal.querySelector("#row-difficulty button.active") : el("ng-start");
    Dlg.open(modal, first || undefined);
  }

  function closeNewGame() {
    const modal = el("newgame-modal");
    store.ui.newGame = null;
    Dlg.close(modal);
    // the seg rows read the store again, and go home once no button is held
    syncSettingsUI();
    afterPress(() => { if (!store.ui.newGame) hostNewGameRows(false); });
  }

  /** 开始: the draft becomes the settings, then the game starts. */
  function startFromDialog() {
    const d = store.ui.newGame;
    if (!d) return;
    const pvp = d.mode === "pvp";
    const side = d.color === "random" ? (Math.random() < 0.5 ? "w" : "b") : d.color;
    store.session.colorRandom = d.color === "random";
    if (!pvp) {
      store.session.difficulty = d.difficulty;
      store.session.personaId = d.personaId;
      store.session.humanColor = side;
    }
    store.game.flipped = side === "b";
    store.game.timeControl = d.timeControl;
    closeNewGame();
    switchMode(d.mode);
    Shell.toBoard();
    saveSettings();
    startNewGame();
  }

  function startNewGame() {
    // 7.5: a new game is also the natural moment to try a dead engine again —
    // once, through retryEngine(), so a second failure is the same notice
    // again and not a toast per press
    const wasDown = engineOut();
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    gameReset();
    store.game.selection = null;
    store.game.viewIndex = 0;
    store.game.imported = false;
    clearEndingFlags();
    // Both of these key off the PGN, and a PGN does not identify a game — play
    // the same seven moves twice in one session and the second game carried
    // the first one's signature. It was then read as "already recorded" and
    // never reached the stats, and the first game's analysis would have been
    // filed against it. A new game is a new game.
    store.session.analysis = null;
    store.game.recordedId = null;
    resetClocks();
    syncAutoFlip();
    sync();
    saveGame();
    Audio2.playStart();
    if (wasDown) retryEngine();
    else maybeEngineTurn();
  }

  /** Truncate the game to the replay cursor and continue playing from there. */
  async function retryFromHere() {
    if (isLive() || refusePgnEdit()) return;
    const keep = store.game.viewIndex;
    const drop = sanHistory().length - keep;
    if (!(await confirmNative(tf("dlg.retryHere", [keep, drop]), t("act.retryHere"),
        { ok: t("act.retryHere"), cancel: t("act.cancel") }))) {
      return;
    }
    // the line is cut at the cursor, not the tree: what was played from here
    // stays as a variation, and the next move played becomes the mainline at
    // this node (treeFollow) — 重下 keeps the game it replaces (Q2.3)
    if (store.ui.preview) clearPreview();
    if (!switchLine(store.game.line.slice(0, keep + 1))) return;
    store.game.selection = null;
    store.game.viewIndex = keep;
    // continuing a finished game (flag / resignation) gets fresh clocks
    if (ruleTerminated()) resetClocks();
    clearEndingFlags();
    // the continuation is the same game under the same record (recordedId),
    // filed once, at its first ending: its own ending is not filed, and the
    // card must not show the first one's rating line and advice (#89 review)
    store.session.filed = null;
    syncAutoFlip();
    store.commit("game", "action");
    saveGame();
    toast(tf("mm.backToMove", [keep]));
    maybeEngineTurn();
  }

  // --- resignation (terminal, like mate; AI games count as a loss) ---
  async function doResign() {
    if (store.session.mode === "learn" || !isLive() || !sanHistory().length || naturalGameOver() || ruleTerminated()) return;
    let side;
    if (store.session.mode === "ai") {
      side = store.session.humanColor;
      if (!(await confirmNative(tf("dlg.resign", [sideName(side)]),
        t("act.resign"), { ok: t("act.resign"), cancel: t("act.cancel"), destructive: true }))) return;
    } else {
      // pvp: either player may resign at any time (FIDE) — pick the side
      const pick = await confirmNative(t("dlg.whoResigns"), t("act.resign"),
        { ok: t("dlg.whiteResigns"), alt: t("dlg.blackResigns"), cancel: t("act.cancel"), destructive: true });
      if (!pick) return;
      side = pick === "alt" ? "b" : "w";
    }
    invalidateEngine();
    store.game.resigned = side;
    forgetFileResult();
    // resigning is losing, whatever the previous six years of this file said
    playEnding(side === "w" ? "b" : "w");
    if (store.session.mode === "ai") recordResign();
    saveGame();
    store.commit("game", "action");
  }

  /** Record an AI-game outcome decided by an app-level rule (not by mate). */
  function recordOutcome(result, ending) {
    if (store.game.recordedId) return; // this game is already filed
    const s = loadStats();
    // the id ties the record to the exact game it came from, so a later
    // analysis can only annotate the game it actually measured
    const id = newRecordId();
    store.game.recordedId = id;
    // #89 review: diff and style are the game's own opponent; an `unrated` one is recorded, not rated
    const rec = Object.assign({ id, t: Date.now(), color: store.session.humanColor, result, moves: sanHistory().length, pgn: game.pgn(), ending, tc: tcTag() }, OppUI.opponent());
    // v8-0-plan B4: every rated game moves the rating (a late one is saved by OppUI); the card repaints after this task
    if (!rec.unrated) OppUI.file(s, rec, (f, late) => { store.session.filed = f; if (late) store.commit("game", "action"); else queueMicrotask(() => store.commit("game", "action")); });
    s.games.push(rec);
    if (s.games.length > 500) s.games = s.games.slice(-500);
    saveStats(s);
    renderStats();
    checkNewAchievements();
  }

  function recordResign() { recordOutcome("loss", "resigned"); }

  // --- blunder coach (AI mode): after the engine replies, quietly evaluate
  // the human's last move; a ??-level swing earns a "consider undoing" nudge.
// {before, after, san, len}

  function coachRemember(mv) {
    store.session.coachPending = null;
    if (store.session.mode !== "ai" || !store.session.coachOn || !ChessEngine) return;
    const h = sanHistory();
    const g = baseGame();
    for (let i = 0; i < h.length - 1; i++) g.move(h[i]);
    store.session.coachPending = { before: g.fen(), after: game.fen(), san: mv.san, len: h.length };
  }

  const PIECE_VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  /**
   * Cheap static screen for the coach: did this move plausibly lose material?
   * Two engine searches per move is real latency on the shared worker, so only
   * moves that hang something (or that the engine answered with a capture)
   * are worth checking properly.
   */
  function coachWorthChecking(beforeFen, afterFen) {
    try {
      const g = new Chess(afterFen);
      // opponent to move: is there a capture that wins material outright?
      for (const m of g.moves({ verbose: true })) {
        if (!m.captured) continue;
        const probe = new Chess(afterFen);
        probe.move(m);
        const recapture = probe.moves({ verbose: true }).some((r) => r.to === m.to);
        const net = PIECE_VALUE[m.captured] - (recapture ? PIECE_VALUE[m.piece] : 0);
        if (net >= 2) return true;
      }
      // ...or did the move walk into a check that was not there before?
      return g.in_check() && !new Chess(beforeFen).in_check();
    } catch (_) {
      return true; // never suppress the coach because of a probe failure
    }
  }

  async function coachAfterEngineReply() {
    const p = store.session.coachPending;
    store.session.coachPending = null;
    if (!p || !store.session.coachOn || store.session.mode !== "ai" || appGameOver()) return;
    if (!coachWorthChecking(p.before, p.after)) return;
    let a = null, b = null;
    try {
      a = await ChessEngine.analyze(p.before, 120);
      b = await ChessEngine.analyze(p.after, 120);
    } catch (_) { return; }
    const sa = evalScalar(a), sb = evalScalar(b);
    if (sa == null || sb == null) return;
    // the move must still be part of the live game (no undo / new game since)
    const h = sanHistory();
    if (h.length < p.len || h[p.len - 1] !== p.san) return;
    const moverIsWhite = p.before.split(" ")[1] === "w";
    const loss = moverIsWhite ? sa - sb : sb - sa;
    // "fix", not the default "ok": it is a warning that asks for Z, and 2.2 s
    // of success-green was gone before it could be read (7.5)
    if (loss >= 300) toast(tf("mm.blunder", [p.san]), "fix");
  }

  // --- draw offer: pvp = both agree on the spot; ai = engine judges the eval ---
  async function doOfferDraw() {
    if (store.session.mode === "learn" || store.session.mode === "puzzle" || !isLive() || !sanHistory().length ||
        appGameOver() || store.session.drawOfferPending) return;
    if (store.session.mode === "pvp") {
      if (!(await confirmNative(t("dlg.drawBoth"), t("act.offerDraw"),
        { ok: t("dlg.drawAgree"), cancel: t("dlg.drawPlayOn") }))) return;
      acceptDraw();
      return;
    }
    // ai mode: offer on your own turn; the engine accepts unless it is winning
    if (store.session.engineThinking || game.turn() !== store.session.humanColor) { toast(t("msg.draw.offerOnYourTurn"), "fix"); return; }
    if (sanHistory().length < 20) { toast(t("msg.draw.offerTooEarly"), "fix"); return; }
    if (!ChessEngine) { toast(t("msg.engine.unavailable"), "fault"); return; }
    if (engineOut()) { engineDownToast(); return; }
    store.session.drawOfferPending = true;
    toast(t("msg.draw.offerSent"));
    let e = null;
    const sig = game.fen();
    try { e = await ChessEngine.analyze(sig, 300); } catch (_) {}
    store.session.drawOfferPending = false;
    if (game.fen() !== sig || appGameOver()) return;
    // e.cp is from the side to move (the human here); engine eval = -cp
    const engineCp = e && e.cp != null ? -e.cp : e && e.mate != null ? (e.mate > 0 ? -10000 : 10000) : null;
    if (engineCp != null && engineCp < 60) {
      acceptDraw();
    } else {
      store.commit("session", "sync");
      toast(t("msg.draw.offerDeclined"));
    }
  }

  function acceptDraw() {
    invalidateEngine();
    store.game.drawAgreed = true;
    forgetFileResult();
    Audio2.playDraw();
    if (store.session.mode === "ai") recordAgreedDraw();
    saveGame();
    store.commit("game", "action");
  }

  function recordAgreedDraw() { recordOutcome("draw", "drawAgreed"); }

  /** FIDE arts. 9.2/9.3: claim the draw at threefold repetition / 50 moves. */
  function doClaimDraw() {
    if (store.session.mode === "learn" || store.session.mode === "puzzle" || !isLive() || appGameOver()) return;
    const reason = claimableDrawReason();
    if (!reason) { toast(t("msg.draw.claimUnavailable"), "fix"); return; }
    invalidateEngine();
    store.game.drawClaimed = reason;
    Audio2.playDraw();
    if (store.session.mode === "ai") recordOutcome("draw", "claimed");
    saveGame();
    store.commit("game", "action");
  }

  // --- the result: the token a file writes, and the tag a file brings ---
  // (the reading and writing around it live in io.js, v8-1-plan F3)
  function gameResultToken() {
    if (game.in_checkmate()) return game.turn() === "w" ? "0-1" : "1-0";
    if (store.game.resigned) return store.game.resigned === "w" ? "0-1" : "1-0";
    if (store.game.drawAgreed || store.game.drawClaimed) return "1/2-1/2";
    if (store.game.flagFall) {
      if (timeoutIsDraw()) return "1/2-1/2";
      return store.game.flagFall === "w" ? "0-1" : "1-0";
    }
    if (naturalGameOver()) return "1/2-1/2"; // stalemate + the auto draw rules
    return "*";
  }

  /**
   * Is the ending on the board the one adoptHeaderResult() read off the
   * file's [Result] tag, rather than something played out here? An imported
   * game's tag names a result and no reason. A resignation or an agreed draw
   * played here clears the tag (forgetFileResult), so it is never mistaken
   * for one read off the file.
   */
  function resultFromFile() {
    if (!store.game.imported || !(store.game.resigned || store.game.drawAgreed)) return false;
    const r = (game.header() || {}).Result;
    return (r === "1-0" || r === "0-1" || r === "1/2-1/2") && r === gameResultToken();
  }

  /** None of the three app-level endings: resigned, agreed, claimed. */
  function clearEndingFlags() { store.game.resigned = null; store.game.drawAgreed = false; store.game.drawClaimed = null; }

  /** An ending played out here replaces whatever the file's tag said. */
  function forgetFileResult() {
    const r = (game.header() || {}).Result;
    if (r && r !== "*") game.header("Result", "*");
  }

  /** Read the [Result] tag of the loaded game into the terminal flags. */
  function adoptHeaderResult() {
    const r = (game.header() || {}).Result;
    if (!r || r === "*" || naturalGameOver()) return;
    if (r === "1-0" || r === "0-1") store.game.resigned = r === "1-0" ? "b" : "w";
    else if (r === "1/2-1/2") store.game.drawAgreed = true;
  }

  return {
    canTakeBack, undo, requestNewGame, openNewGame, closeNewGame, startFromDialog, retryFromHere, doResign,
    recordOutcome, coachRemember, coachAfterEngineReply, doOfferDraw, acceptDraw, doClaimDraw,
    gameResultToken, resultFromFile, clearEndingFlags, forgetFileResult, adoptHeaderResult,
  };
}
