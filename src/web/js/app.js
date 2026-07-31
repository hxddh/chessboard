import { CHESS_ACHIEVEMENTS } from "./achievements.js";
import { ChessAudio } from "./audio.js";
import { ChessBoardView } from "./board.js";
import { Chess } from "./chess.js";
import { ChessDialog } from "./dialog.js";
import { ChessDrills } from "./drills.js";
import { ChessEditor } from "./editor.js";
import { ChessEngine } from "./engine.js";
import { ChessFide } from "./fide.js";
import { ChessHost } from "./host.js";
import { ChessI18n } from "./i18n.js";
import { CHESS_LESSONS_EN } from "./lessons-en.js";
import { CHESS_LESSONS_JA } from "./lessons-ja.js";
import { CHESS_LESSONS } from "./lessons.js";
import { ChessMaterial } from "./material.js";
import { ChessOpeningCoach } from "./opening-coach.js";
import { CHESS_OPENINGS_EN, CHESS_OPENING_IDEAS_EN } from "./openings-en.js";
import { CHESS_OPENINGS_JA, CHESS_OPENING_IDEAS_JA } from "./openings-ja.js";
import { CHESS_OPENINGS, CHESS_OPENING_NAMES } from "./openings.js";
import { ChessPersona } from "./persona.js";
import { ChessPgn } from "./pgn.js";
import { CHESS_PIECE_SVGS } from "./pieces.js";
import { CHESS_PUZZLES_EN } from "./puzzles-en.js";
import { CHESS_PUZZLES_JA } from "./puzzles-ja.js";
import { CHESS_PUZZLES } from "./puzzles.js";
import { ChessReview } from "./review.js";
import { ChessSrs } from "./srs.js";
import { createPersist } from "./persist.js";
import { reconcile } from "./keyed.js";
import { createStore } from "./store.js";

  /**
   * The one deliberate global: the seam the browser tests reach through.
   *
   * Until 1.25 all 29 modules were on `window`, so a test could reach any of
   * them and nobody had to say which ones were fair game. They are bundled
   * now and nothing is reachable by default — which is the point, and which
   * also took away the hook `test-review-e2e.mjs` uses to hand the app a
   * scripted engine (a real search would make the evaluation-bar numbers
   * unrepeatable). So the hook is declared instead of assumed: one name, one
   * purpose, and the modules on it are the object identities the app itself
   * holds, so patching a method here is patching the app's engine.
   */
  window.__chess = { engine: ChessEngine };

  const Host = ChessHost;
  const Review = ChessReview;
  const BoardView = ChessBoardView;
  const Audio2 = ChessAudio;

  /** Shared dialog behaviour: focus trap, focus return, aria-modal. */
  const Dlg = ChessDialog || {
    open: (el, f) => { if (el) { el.classList.add("show"); if (f) f.focus(); } },
    close: (el) => { if (el) el.classList.remove("show"); },
    handleTab: () => false,
  };

  /**
   * Is any dialog on screen?
   *
   * The game's own keys — P, N, Z, H, F, R, the replay arrows — act on the
   * position behind the backdrop, which is never what someone reading a dialog
   * meant. Measured on 1.11: with the shortcut sheet, the save slots or the
   * game history open, all of P / F / N still fired, so pressing N over the
   * history list stacked a "start a new game?" box on top of it.
   *
   * dialog.js answers it, because dialog.js is what opens them. This used to
   * be its own DOM query — a second copy of a list that also existed as a
   * seven-branch if-chain in the Escape handler. 缺陷 19.
   */
  function dialogOpen() {
    return Dlg.anyOpen();
  }

  const I18n = ChessI18n;
  const t = I18n ? I18n.t : (k) => k;
  /** t() with {0}/{1} placeholders filled in — see i18n.tf */
  const tf = I18n ? I18n.tf : (k) => k;

  /**
   * Stored state, behind one door. See persist.js.
   *
   * The failure hook is the point of it: host.js has always returned
   * true/false from storageSet(), and all eleven call sites here dropped that
   * value inside an empty catch. A full quota therefore looked exactly like a
   * successful save — the app kept showing lesson progress, puzzle progress,
   * statistics and achievements all session, and lost the lot at the next
   * launch. 缺陷 3. It says so now, once, and keeps saying it: the pill is not
   * a toast because a toast that has gone is a warning nobody got.
   */
  const Persist = createPersist(Host, () => {
    showStorageFault();
    toast(t("msg.storage.failed"), "fault");
  });
  // One pass over storage, before anything reads from it: migrations get to
  // see a whole profile, and no later reader has to wonder whether some other
  // key moved under it.
  Persist.load();

  const canvas = document.getElementById("board");
  const appEl = document.getElementById("app");

  /**
   * The rook's half of a castle, or null.
   *
   * chess.js reports castling as the king's move alone, so an animation fed
   * `mv.from`/`mv.to` slides the king and teleports the rook — the one move
   * that shifts two men showed only the half nobody was confused about.
   * @param {object} mv chess.js verbose move
   */
  function castleRook(mv) {
    if (!mv || !mv.flags) return null;
    const rank = mv.color === "w" ? "1" : "8";
    if (mv.flags.includes("k")) return { from: "h" + rank, to: "f" + rank };
    if (mv.flags.includes("q")) return { from: "a" + rank, to: "d" + rank };
    return null;
  }

  /**
   * Slide a move that the player did not make.
   *
   * Motion on a chess board should answer exactly one question: what changed
   * that I did not do myself? Up to 1.10 the rule was the opposite of that —
   * every move the *player* made was animated (a dragged piece even snapped
   * back to its origin and slid forward again, undoing the drag the player had
   * just performed by hand), while three of the four opponent replies —
   * lesson drills, scripted puzzle lines, mate-puzzle defences — appeared
   * instantly on their new square. The one place it was right was the engine
   * in a normal game.
   *
   * So the glide is spent only where it buys something: on the reply you did
   * not choose and have to read off the board.
   */
  function animateReply(mv) {
    if (!mv) return;
    BoardView.animateMove(mv.from, mv.to, castleRook(mv));
  }

  /** a game restored from the save that was already filed — see recordedId */
  const RESTORED_AND_FILED = "restored";

  /** The live game — single source of truth (chess.js keeps full history). */
  const game = new Chess();

  /**
   * Everything else that changes, in one place.
   *
   * These were 56 module-level `let`s spread down this file. Same values, same
   * defaults, same comments — what moved is only *where they are declared*, so
   * that "what is the state of this app" becomes a question with an address.
   * The three slices are described in store.js; the short version is: `game`
   * is true of the chess, `session` is what the user is doing, `ui` is what
   * the screen looks like.
   *
   * `game` the chess.js instance above and `store.game` the slice are
   * different things, deliberately: one is the rules, the other is everything
   * the rules do not know — where the replay cursor is, whose flag fell,
   * whether somebody resigned.
   */
  const store = createStore({
    game: {
      /** Replay cursor: 0..sanHistory().length; live when === length. */
      viewIndex: 0,
      flipped: false,
      /** @type {{sq:string, targets:string[]}|null} click-move selection */
      selection: null,
      /** bumped on every game mutation; stale engine replies are dropped */
      engineToken: 0,
      /** pgn of the last game recorded into stats (double-count guard) */
      /**
       * id of the stats record this game was filed under, or null when it has
       * not been filed. RESTORED_AND_FILED when a finished game came back from
       * the save file and its id is not to hand.
       */
      recordedId: null,
      /** clock preset: 'off' | a key of TCS (e.g. '5', '3+2') */
      timeControl: "off",
      /** remaining ms per side; null when no clock */
      clock: null,
      /** side whose flag fell ('w'|'b') — terminal for the game, like mate */
      flagFall: null,
      clockTimer: null,
      clockTickAt: 0,
      /** side that resigned ('w'|'b') — terminal for the game, like mate */
      resigned: null,
      /** draw agreed (pvp: both players; ai: engine accepted the offer) */
      drawAgreed: false,
      /** claimed draw: 'threefold' | 'fifty' | null — terminal once claimed */
      drawClaimed: null,
      /** how many times the current live position has occurred (incl. start) */
      repMemo: { sig: null, count: 1 },
      /** one walk of the game per mutation; the game commit clears them */
      _vh: null,
      _san: null,
      /** chess.js instance for the currently VIEWED position (live or replay). */
      _view: null,
    },
    session: {
      /** @type {'ai'|'pvp'} */
      mode: "ai",
      /** @type {'easy'|'normal'|'hard'|'extreme'} */
      difficulty: "normal",
      /** @type {'w'|'b'} human side in AI mode */
      humanColor: "w",
      engineThinking: false,
      /** review analysis: {sig, scalars[n+1], tags[n]}; stale when sig ≠ pgn */
      analysis: null,
      analyzing: false,
      /** set by the stop button; the analysis loop bails at the next position */
      analyzeAbort: false,
      analyzeProgress: "",
      /** engine hint arrow {from,to}; cleared whenever the game mutates */
      hintMove: null,
      hintPending: false,
      /** blunder coach: warn after ??-level moves in AI games */
      coachOn: true,
      personaId: "off",
      /** learn-mode runtime; null unless mode === 'learn' */
      learn: null,
      /** puzzle-mode runtime; null unless mode === 'puzzle' */
      puzzle: null,
      learnState: null,  // filled in below, where it can first be computed
      puzzleState: null,  // filled in below, where it can first be computed
      /** active difficulty filter: "all" | "easy" | "mid" | "hard" */
      puzzleTierFilter: "all",
      /** editor runtime: {board, turn, castling, brush} | null */
      editor: null,
      coachPending: null,
      drawOfferPending: false,
      _analysisTick: null,
      /** the newest-first list the rendered rows index into */
      histCache: [],
      achSeen: null,  // filled in below, where it can first be computed
    },
    ui: {
      soundOn: true,
      /** @type {'wood'|'night'|'day'|'notebook'} */
      themeId: "wood",
      /** pvp: flip the board to face the side to move after every move */
      autoFlipPvp: false,
      /** which panel tab is showing: "play" | "setup" | "record" */
      sideTab: "play",
      /** UI language id (see i18n.js); lesson/puzzle content stays Chinese */
      langId: null,  // filled in below, where it can first be computed
      /** Is the app in front of somebody? Kept by the app:activate/deactivate
       *  lifecycle pair; the clock and the analysis notification both read it. */
      appForeground: true,
      /** keyboard play: focused square, shown only while the board has focus */
      keyboardCursor: null,
      boardFocused: false,
      toastTimer: null,
      confirmResolver: null,
      histFilter: { result: "all", color: "all" },
      promoResolver: null,
      /** Modal list picker → index of the chosen entry, or null when cancelled. */
      pickResolver: null,
      dragging: null,
      /** editor paint stroke: the square last painted while the pointer is down */
      painting: null,
    },
  });
  /** sparring personality — see persona.js; "off" is plain engine play */
  const PERSONA_IDS = (ChessPersona && ChessPersona.IDS) ||
    ["off", "greedy", "principled", "attacker"];
  store.ui.langId = I18n ? I18n.getLang() : "zh-CN";

  Audio2.init(() => store.ui.soundOn);

  // --- the game's moves, and the one door they change through ------------
  //
  // Rebuilding the board model means replaying the game: chess.js 0.13 has no
  // move list to read, only a history() that walks the game and regenerates
  // moves as it goes. The model is rebuilt on EVERY draw(), and draw() runs on
  // every animation frame and every pointermove of a drag — so the cost of a
  // repaint grew with the length of the game. Measured before this cache:
  //
  //     0 plies 1.28ms · 40 plies 5.35ms · 80 plies 10.4ms · 120 plies 19.3ms
  //
  // Past ~110 plies a single repaint no longer fit in a 60fps frame, and
  // dragging a piece in a long game visibly dragged. Not a regression — it had
  // always been this way, which is why it was never reported as one.
  //
  // So the histories are cached, and every mutation of `game` goes through one
  // of the five doors below. A raw game.move() elsewhere would leave the caches
  // describing the previous position; scripts/test-chess.mjs fails the build if
  // one appears.
  //
  // The doors are the game slice's *actions*: they are the only five events
  // that can change what is true of the chess, so they are the only five places
  // that announce it. Up to 1.25 they instead bumped a `gameVersion` counter
  // and each cache compared itself against it — a hand-rolled invalidation
  // signal, which is what a store's commit already is. Same one-walk-per-
  // mutation cost, one fewer number to keep honest.
  function gameMove(m) { const r = game.move(m); if (r) store.commit("game", "move"); return r; }
  function gameUndo() { const r = game.undo(); if (r) store.commit("game", "undo"); return r; }
  function gameLoad(fen) { const r = game.load(fen); store.commit("game", "load"); return r; }
  function gameLoadPgn(pgn, opts) { const r = game.load_pgn(pgn, opts); store.commit("game", "loadPgn"); return r; }
  function gameReset() { game.reset(); store.commit("game", "reset"); }

  // The caches those five doors feed. Cleared by the commit rather than
  // compared against it: "this is stale now" is a thing the store can say, and
  // saying it is cheaper and harder to get wrong than every reader remembering
  // to ask.
  store.subscribe("game", () => {
    store.game._vh = null;
    store.game._san = null;
    store.game._view = null;
    // the analysis is a session fact, but whether it still describes *this*
    // game is a game fact — see analysisFor()
    store.session._analysisTick = null;
  });

  function verboseHistory() {
    if (!store.game._vh) store.game._vh = game.history({ verbose: true });
    return store.game._vh;
  }
  // derived from the verbose list rather than asking chess.js twice: one walk
  // of the game per mutation, not two per repaint
  function sanHistory() {
    if (!store.game._san) store.game._san = verboseHistory().map((m) => m.san);
    return store.game._san;
  }
  function isLive() { return store.game.viewIndex === sanHistory().length; }

  /** Custom start FEN when the game was imported from a [SetUp]/[FEN] PGN. */
  function startFen() {
    const h = game.header();
    return h && h.SetUp === "1" && h.FEN ? h.FEN : null;
  }

  /** Fresh instance at this game's starting position (default or FEN header). */
  function baseGame() {
    const sf = startFen();
    return sf ? new Chess(sf) : new Chess();
  }

  /** Reset `game` itself to its starting position, keeping any FEN header. */
  function resetGameToStart() {
    const sf = startFen();
    if (sf) {
      gameLoad(sf);
      game.header("SetUp", "1", "FEN", sf);
    } else {
      gameReset();
    }
  }

  function viewGame() {
    if (isLive()) return game;
    // keyed on the cursor and dropped whenever the game itself moves: the two
    // things that can make a replayed position wrong
    if (store.game._view && store.game._view.i === store.game.viewIndex) return store.game._view.g;
    const g = baseGame();
    const h = sanHistory();
    for (let i = 0; i < store.game.viewIndex; i++) g.move(h[i]);
    // every caller reads (.board/.fen/.turn/.get/.in_check) and none mutates,
    // so one instance per cursor position can be shared
    store.game._view = { i: store.game.viewIndex, g };
    return g;
  }

  /** Verbose move objects for the whole game (for last-move highlight). */

  function kingSquare(g, color) {
    const bd = g.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (p && p.type === "k" && p.color === color) return "abcdefgh"[c] + (8 - r);
    }
    return null;
  }

  const cursorSquare = () => (store.ui.boardFocused ? store.ui.keyboardCursor : null);

  BoardView.attach(canvas, () => {
    if (store.session.editor) return editorModel();
    if (store.session.mode === "learn" && store.session.learn) return learnModel();
    if (store.session.mode === "puzzle" && store.session.puzzle) return puzzleModel();
    const g = viewGame();
    const vh = verboseHistory();
    const last = store.game.viewIndex > 0 ? vh[store.game.viewIndex - 1] : null;
    return {
      position: g.board(),
      flipped: store.game.flipped,
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: last ? { from: last.from, to: last.to } : null,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      // Live: the hint the player asked for. Replaying an analysed game: the
      // move the engine would have played, but only where the move actually
      // played was a mistake — that is the moment the question "so what should
      // I have done" is being asked, and drawing it everywhere else is just an
      // arrow permanently on the board. Never during live play, where it would
      // be an answer key rather than a review.
      hintMove: isLive() ? store.session.hintMove : bestArrowAt(store.game.viewIndex),
      stars: [],
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  });

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

  function draw() { BoardView.draw(); }

  // --- toast + promise-based in-app confirm ---
  /**
   * A storage failure is permanent for the session, so its notice is too.
   *
   * It keeps a banner of its own even now that toasts have a fault tier
   * (P2.6). The tier is right for "the engine did not start" — bad, dismissible,
   * over. This one is different in kind: every later autosave will fail too, so
   * the statement "nothing you do is being kept" stays true for the rest of the
   * session, and a notice the user has clicked away would be a lie by the time
   * they close the app. The toast fires as well, once, because a banner that
   * appears silently at the top of the screen is easy not to notice.
   */
  function showStorageFault() {
    let el = document.getElementById("storage-fault");
    if (!el) {
      el = document.createElement("div");
      el.id = "storage-fault";
      el.className = "storage-fault";
      el.setAttribute("role", "alert");
      document.body.appendChild(el);
    }
    el.textContent = t("msg.storage.failed");
    el.hidden = false;
  }

  /**
   * Three tiers, because 110 toasts were saying three different kinds of thing
   * in one voice.
   *
   * "已复制 PGN", "你违背了开局原则" and "引擎启动失败" shared a background, a
   * size and a 2.2-second life. The first is a receipt you may ignore; the
   * second is the app correcting you, which is the whole point of the teaching
   * modes and deserves to be read; the third means a feature is gone until you
   * restart, and 2.2 seconds later there was no evidence it had ever happened.
   * 缺陷 20.
   *
   *   ok      a receipt — it happened, carry on. Short.
   *   fix     the app is correcting you. Longer, because it is a sentence with
   *           something to learn in it, and accented so it does not read as
   *           another receipt.
   *   fault   something is broken. Does NOT dismiss itself: a fault that
   *           disappears is a fault nobody was told about. It gets a close
   *           button instead, which is also what makes it safe to keep.
   *
   * @param {string} msg
   * @param {"ok"|"fix"|"fault"} [tier]
   */
  const TOAST_MS = { ok: 2200, fix: 4200, fault: 0 };
  function toast(msg, tier) {
    const el = document.getElementById("toast");
    if (!el) return;
    const kind = TOAST_MS[tier] === undefined ? "ok" : tier;
    el.textContent = msg;
    el.classList.remove("t-ok", "t-fix", "t-fault");
    el.classList.add("show", "t-" + kind);
    if (store.ui.toastTimer) clearTimeout(store.ui.toastTimer);
    store.ui.toastTimer = null;
    const ms = TOAST_MS[kind];
    if (ms) store.ui.toastTimer = setTimeout(() => el.classList.remove("show"), ms);
    // a fault stays until it is dismissed, so it needs a way out that is not
    // "wait" — clicking it anywhere will do
    el.onclick = ms ? null : () => el.classList.remove("show");
    el.style.cursor = ms ? "" : "pointer";
  }

  /**
   * In-app confirm. Resolves true (ok) / false (cancel), and "alt" when the
   * optional third button (buttons.alt) was offered and chosen.
   */
  function confirmNative(message, title, buttons) {
    const okLabel = (buttons && buttons.ok) || t("act.ok");
    const cancelLabel = (buttons && buttons.cancel) || t("act.cancel");
    const altLabel = buttons && buttons.alt;
    const modal = document.getElementById("confirm-modal");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    const altBtn = document.getElementById("confirm-alt");
    if (!modal || !okBtn || !cancelBtn) {
      try { return Promise.resolve(!!window.confirm(message)); }
      catch (_) { return Promise.resolve(true); }
    }
    if (titleEl) titleEl.textContent = title || t("aria.confirm");
    if (msgEl) msgEl.textContent = message;
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
    if (altBtn) {
      altBtn.hidden = !altLabel;
      if (altLabel) altBtn.textContent = altLabel;
    }
    Dlg.open(modal, okBtn);
    return new Promise((resolve) => { store.ui.confirmResolver = resolve; });
  }
  function finishConfirm(val) {
    const modal = document.getElementById("confirm-modal");
    Dlg.close(modal);
    if (store.ui.confirmResolver) { store.ui.confirmResolver(val); store.ui.confirmResolver = null; }
  }

  // --- settings + autosave ---
  function loadSettings() {
    try {
      const raw = Persist.get("settings");
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.soundOn === "boolean") store.ui.soundOn = s.soundOn;
      if (typeof s.flipped === "boolean") store.game.flipped = s.flipped;
      if (["wood", "night", "day", "notebook"].includes(s.themeId)) store.ui.themeId = s.themeId;
      if (["ai", "pvp", "learn", "puzzle"].includes(s.mode)) store.session.mode = s.mode;
      // DIFF_IDS, not a second copy of it — this list was written out by hand
      // and adding the 1.19 "casual" rung to the ladder without it here would
      // have thrown the choice away on the next launch, silently.
      if (DIFF_IDS.includes(s.difficulty)) store.session.difficulty = s.difficulty;
      if (["w", "b"].includes(s.humanColor)) store.session.humanColor = s.humanColor;
      if (s.timeControl === "off" || TCS[s.timeControl]) store.game.timeControl = s.timeControl;
      if (typeof s.coachOn === "boolean") store.session.coachOn = s.coachOn;
      if (typeof s.autoFlipPvp === "boolean") store.ui.autoFlipPvp = s.autoFlipPvp;
      if (I18n && typeof s.langId === "string") store.ui.langId = I18n.setLang(s.langId);
      if (["all", "easy", "mid", "hard"].includes(s.puzzleTier)) store.session.puzzleTierFilter = s.puzzleTier;
      if (["play", "setup", "record"].includes(s.sideTab)) store.ui.sideTab = s.sideTab;
      if (PERSONA_IDS.includes(s.personaId)) store.session.personaId = s.personaId;
    } catch (_) {}
  }
  function saveSettings() {
    try {
      Persist.setJson("settings", ({ soundOn: store.ui.soundOn, flipped: store.game.flipped, themeId: store.ui.themeId, mode: store.session.mode, difficulty: store.session.difficulty, humanColor: store.session.humanColor, timeControl: store.game.timeControl, coachOn: store.session.coachOn, autoFlipPvp: store.ui.autoFlipPvp, langId: store.ui.langId, puzzleTier: store.session.puzzleTierFilter, sideTab: store.ui.sideTab, personaId: store.session.personaId }));
    } catch (_) {}
  }
  function saveGame() {
    try {
      const payload = { v: 1, pgn: game.pgn(), savedAt: Date.now() };
      if (store.game.timeControl !== "off" && store.game.clock) {
        payload.clock = { tc: store.game.timeControl, w: Math.round(store.game.clock.w), b: Math.round(store.game.clock.b), flag: store.game.flagFall };
      }
      if (store.game.resigned) payload.resigned = store.game.resigned;
      if (store.game.drawAgreed) payload.drawAgreed = true;
      if (store.game.drawClaimed) payload.drawClaimed = store.game.drawClaimed;
      Persist.setJson("save", payload);
    } catch (_) {}
  }
  function tryLoadSave() {
    try {
      const raw = Persist.get("save");
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || typeof s.pgn !== "string" || !s.pgn) return false;
      if (!gameLoadPgn(s.pgn)) {
        // A position from the editor or from 载入 FEN is saved the moment it
        // is loaded, before its first move, so its PGN is tag pairs and
        // nothing else. load_pgn wants movetext and refuses — and the launch
        // path then took "no save" at face value and overwrote the position
        // with the standard array. Closing the app after setting up a study
        // position, before playing into it, lost it without a word.
        const sf = ChessPgn ? ChessPgn.startFen(s.pgn) : null;
        if (!sf || !gameLoad(sf)) return false;
        game.header("SetUp", "1", "FEN", sf);
      }
      store.game.viewIndex = sanHistory().length;
      if (s.clock && TCS[s.clock.tc] &&
          typeof s.clock.w === "number" && typeof s.clock.b === "number") {
        store.game.timeControl = s.clock.tc;
        store.game.clock = { w: Math.max(0, s.clock.w), b: Math.max(0, s.clock.b) };
        store.game.flagFall = s.clock.flag === "w" || s.clock.flag === "b" ? s.clock.flag : null;
      }
      if (s.resigned === "w" || s.resigned === "b") store.game.resigned = s.resigned;
      if (s.drawAgreed === true) store.game.drawAgreed = true;
      if (s.drawClaimed === "threefold" || s.drawClaimed === "fifty") store.game.drawClaimed = s.drawClaimed;
      // a custom starting position is worth resuming on its own, with or
      // without moves played into it
      return sanHistory().length > 0 || !!startFen();
    } catch (_) {
      return false;
    }
  }

  // --- engine (AI mode) ---
  const DIFF_IDS = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
  const diffName = (id) => t("diff." + id);
  /** legacy alias kept for the many call sites that read it like a map */
  const DIFF_NAMES = new Proxy({}, {
    get: (_, k) => (DIFF_IDS.includes(k) ? diffName(k) : undefined),
    has: (_, k) => DIFF_IDS.includes(k),
  });

  /** Drop any in-flight engine search; call before every game mutation. */
  function invalidateEngine() {
    store.game.engineToken++;
    store.session.engineThinking = false;
    store.session.hintMove = null;
    if (ChessEngine) ChessEngine.cancel();
  }

  /** If it's the engine's turn in AI mode, think and play its reply. */
  async function maybeEngineTurn() {
    if (store.session.mode !== "ai" || !ChessEngine) return;
    if (appGameOver() || game.turn() === store.session.humanColor) return;
    const token = ++store.game.engineToken;
    store.session.engineThinking = true;
    sync();
    // clocked AI games: the engine budgets its think time from its clock
    const engineSide = store.session.humanColor === "w" ? "b" : "w";
    const budget = store.game.clock && store.game.timeControl !== "off" ? Math.max(150, store.game.clock[engineSide] / 30) : null;
    let mv = null;
    // the personality only ever colours a real game against the engine; the
    // lesson drills need the engine defending honestly or the drill is a lie
    try { mv = await ChessEngine.bestMove(game.fen(), store.session.difficulty, budget, { id: store.session.personaId, Chess }); }
    catch (_) { mv = null; }
    if (token !== store.game.engineToken) return; // game changed while thinking
    store.session.engineThinking = false;
    if (!mv) { sync(); toast(t("msg.engine.noMove"), "fault"); return; }
    const played = gameMove({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    if (played) {
      store.game.viewIndex = sanHistory().length;
      store.game.selection = null;
      store.session.hintMove = null;
      applyIncrement(played.color);
      animateReply(played);
      moveSound(played, game);
      if (game.in_checkmate()) playEnding(game.turn() === "w" ? "b" : "w");
      else if (naturalGameOver()) playEnding(null);
      saveGame();
      recordGameIfOver();
      coachAfterEngineReply();
    }
    sync();
  }

  // --- engine hint: full-strength best move drawn as an arrow ---

  async function requestHint() {
    if (store.session.mode === "learn") { learnHint(); return; }
    if (store.session.mode === "puzzle") { showPuzzleAnswer(); return; }
    if (!ChessEngine) { toast(t("msg.engine.unavailable"), "fault"); return; }
    if (!isLive()) { toast(t("msg.replay.returnToLive"), "fix"); return; }
    if (appGameOver()) return;
    if (store.session.mode === "ai" && (store.session.engineThinking || game.turn() !== store.session.humanColor)) return;
    if (store.session.hintPending || store.session.analyzing) return;
    const sig = game.fen();
    store.session.hintPending = true;
    sync();
    let e = null;
    try { e = await ChessEngine.analyze(sig, 400); } catch (_) {}
    store.session.hintPending = false;
    if (!isLive() || game.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("msg.engine.noHint"), "fault"); return; }
    const from = e.best.slice(0, 2);
    const to = e.best.slice(2, 4);
    const vmv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    store.session.hintMove = { from, to };
    sync();
    toast(t("chrome.hint") + " · " + (vmv ? vmv.san : from + " → " + to));
  }

  // --- two-player clock (base + Fischer increment; flag fall is terminal) ---
  /** time control id → base seconds + increment seconds credited per move */
  const TCS = {
    "3": { base: 180, inc: 0 }, "3+2": { base: 180, inc: 2 },
    "5": { base: 300, inc: 0 }, "5+3": { base: 300, inc: 3 },
    "10": { base: 600, inc: 0 },
  };
  const TC_IDS = Object.keys(TCS);
  function parseTc(tc) { return TCS[tc] || null; }

  function resetClocks() {
    const tc = parseTc(store.game.timeControl);
    store.game.clock = tc ? { w: tc.base * 1000, b: tc.base * 1000 } : null;
    store.game.flagFall = null;
    syncClockTimer();
    renderClocks();
  }

  /** Fischer increment: credit the mover once their move is completed. */
  function applyIncrement(mover) {
    const tc = parseTc(store.game.timeControl);
    if (!store.game.clock || !tc || !tc.inc || store.game.flagFall) return;
    store.game.clock[mover] += tc.inc * 1000;
    renderClocks();
  }

  /**
   * Is anyone actually in front of the board?
   *
   * Two signals because neither covers the other: `app:deactivate` is the
   * native one (another app came forward, or the window was hidden), and
   * `visibilityState` is the web one (which is all a plain browser has). Away
   * by either measure counts as away.
   */
  function appAwake() {
    if (!store.ui.appForeground) return false;
    try { return document.visibilityState !== "hidden"; } catch (_) { return true; }
  }

  /**
   * Ticking starts at the first move so nobody drains on the start screen —
   * and stops whenever the app is not in front of somebody.
   *
   * The tick charges `Date.now()` elapsed, so a backgrounded app was billing
   * wall-clock time to a player who could not see the board: measured at 1.17,
   * 8.4 seconds in the background cost 9 seconds of clock with nobody playing.
   * That was reachable by switching away; from 1.18 macOS closes the window to
   * a hidden app, which would have made it the normal case rather than the
   * unlucky one. A local unrated game has nothing to protect here — thinking
   * time you spend in another window is not time your opponent is waiting.
   */
  function clockRunning() {
    return (store.session.mode === "pvp" || store.session.mode === "ai") && !!store.game.clock &&
      !appGameOver() && sanHistory().length >= 1 && appAwake();
  }

  function syncClockTimer() {
    const want = clockRunning();
    if (want && !store.game.clockTimer) {
      store.game.clockTickAt = Date.now();
      store.game.clockTimer = setInterval(clockTick, 200);
    } else if (!want && store.game.clockTimer) {
      clearInterval(store.game.clockTimer);
      store.game.clockTimer = null;
    }
  }

  function clockTick() {
    if (!clockRunning()) { syncClockTimer(); return; }
    const now = Date.now();
    const side = game.turn();
    store.game.clock[side] = Math.max(0, store.game.clock[side] - (now - store.game.clockTickAt));
    store.game.clockTickAt = now;
    if (store.game.clock[side] === 0) {
      store.game.flagFall = side;
      syncClockTimer();
      invalidateEngine();
      const isDraw = timeoutIsDraw();
      // the side whose flag fell lost; a draw only when the other side cannot mate
      playEnding(isDraw ? null : (side === "w" ? "b" : "w"));
      if (store.session.mode === "ai") {
        recordOutcome(isDraw ? "draw" : side === store.session.humanColor ? "loss" : "win", "flag");
      }
      saveGame();
      store.commit("game", "action");
      const who = side === "w" ? t("side.white") : t("side.black");
      toast(isDraw ? who + t("msg.clock.flagDrawNoMaterial") :
        tf("mm.flagWin", [who, side === "w" ? t("side.black") : t("side.white")]));
      return;
    }
    renderClocks();
  }

  function fmtClock(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
  }

  function renderClocks() {
    const wEl = document.getElementById("clock-w");
    const bEl = document.getElementById("clock-b");
    if (!wEl || !bEl) return;
    const show = (store.session.mode === "pvp" || store.session.mode === "ai") && store.game.timeControl !== "off" && !!store.game.clock;
    wEl.hidden = !show;
    bEl.hidden = !show;
    if (!show) return;
    const active = clockRunning() ? game.turn() : null;
    for (const [el, side] of [[wEl, "w"], [bEl, "b"]]) {
      el.textContent = fmtClock(store.game.clock[side]);
      el.classList.toggle("active", active === side);
      el.classList.toggle("low", store.game.clock[side] < 20000);
    }
  }

  // --- opening book: deepest SAN-prefix match wins ---
  const OPENING_BOOK = (() => {
    const map = new Map();
    let maxPly = 0;
    for (const [eco, nameId, seq] of CHESS_OPENINGS || []) {
      // store the parts, not the joined label: the name is localised at render
      // time so switching language relabels the line already on screen
      map.set(seq, [eco, nameId]);
      maxPly = Math.max(maxPly, seq.split(" ").length);
    }
    return { map, maxPly };
  })();

  function openingFor(prefixLen) {
    if (startFen()) return null; // the book only applies from the standard start
    const h = sanHistory();
    const n = Math.min(prefixLen, h.length, OPENING_BOOK.maxPly);
    for (let i = n; i >= 1; i--) {
      const hit = OPENING_BOOK.map.get(h.slice(0, i).join(" "));
      if (hit) return hit;
    }
    return null;
  }

  function renderOpening() {
    const el = document.getElementById("opening-line");
    if (!el) return;
    const hit = store.session.mode === "learn" || store.session.mode === "puzzle" ? null : openingFor(store.game.viewIndex);
    el.hidden = !hit;
    el.textContent = hit ? hit[0] + " · " + openingName(hit[1]) : "";
  }

  // --- learn mode: zero-basis interactive lessons (data in lessons.js) ---
  const LESSONS = CHESS_LESSONS || [];

  /**
   * Content tables per language. Chinese is the source and lives in
   * lessons.js / puzzles.js / openings.js; every other language gets a
   * translation file holding words only.
   *
   * Through 1.20 the lookup was `langId !== "zh-CN" ? …_EN : null` — one
   * branch, so the interface had three languages and the teaching had two,
   * and a Japanese player read a Japanese interface wrapped around English
   * lessons. Now each language names its own tables and the lookup walks a
   * chain: the active language, then English as a bridge, then the Chinese
   * original. The chain is per *field*, so a half-finished translation
   * degrades sentence by sentence instead of dropping a whole lesson.
   */
  const CONTENT_TABLES = {
    en: () => ({
      lessons: CHESS_LESSONS_EN, puzzles: CHESS_PUZZLES_EN,
      openings: CHESS_OPENINGS_EN, ideas: CHESS_OPENING_IDEAS_EN,
    }),
    ja: () => ({
      lessons: CHESS_LESSONS_JA, puzzles: CHESS_PUZZLES_JA,
      openings: CHESS_OPENINGS_JA, ideas: CHESS_OPENING_IDEAS_JA,
    }),
  };
  /** tables to consult for `kind`, best match first (empty when reading source) */
  function contentTables(kind) {
    const out = [];
    if (store.ui.langId === "zh-CN") return out;
    for (const id of [store.ui.langId, "en"]) {
      const get = CONTENT_TABLES[id];
      const tbl = get && get()[kind];
      if (tbl && out.indexOf(tbl) < 0) out.push(tbl);
    }
    return out;
  }
  /** first translated `field` of entry `key`, or null to use the source */
  function contentField(kind, key, field) {
    for (const tbl of contentTables(kind)) {
      const entry = tbl[key];
      if (entry && entry[field]) return entry[field];
    }
    return null;
  }

  /**
   * Lesson prose in the active language, falling back to the authored Chinese.
   * Only text is localised — positions, goals and solutions always come from
   * lessons.js, so a translation can never change what a lesson teaches.
   */
  function lessonText(lesson) {
    return {
      part: contentField("lessons", lesson.id, "part") || lesson.part,
      title: contentField("lessons", lesson.id, "title") || lesson.title,
      text: contentField("lessons", lesson.id, "text") || lesson.text,
    };
  }
  /** localised prose for task `ti` of `lesson` (prompt / retry / tap tips) */
  function taskText(lesson, ti) {
    const task = lesson.tasks[ti];
    const taskField = (field) => {
      for (const tbl of contentTables("lessons")) {
        const entry = tbl[lesson.id];
        const tt = entry && entry.tasks && entry.tasks[ti];
        if (tt && tt[field]) return tt[field];
      }
      return null;
    };
    return {
      prompt: taskField("prompt") || task.prompt,
      retry: taskField("retry") || task.retry,
      step: (i) => {
        for (const tbl of contentTables("lessons")) {
          const entry = tbl[lesson.id];
          const tt = entry && entry.tasks && entry.tasks[ti];
          if (tt && tt.steps && tt.steps[i]) return tt.steps[i];
        }
        return task.steps && task.steps[i] && task.steps[i].tip;
      },
    };
  }

  /**
   * Localised puzzle prose. Same split as the lessons: puzzles.js owns the
   * chess (fen, solution, gain), puzzles-en.js owns only the words, so a
   * translation can never disagree with what the puzzle actually is.
   */
  function puzzleName(p) {
    // opening drills are named by the book, not by the puzzle tables
    if (p.cat === "op" && p.nameId) return p.eco + " " + openingName(p.nameId);
    return contentField("puzzles", p.id, "name") || p.name;
  }
  function puzzleMotif(p) {
    return contentField("puzzles", p.id, "motif") || p.motif || t("pz.forcing");
  }
  function puzzleIdea(p) {
    if (p.cat === "op" && p.nameId) return openingIdea(p.nameId) || p.idea || "";
    return contentField("puzzles", p.id, "idea") || p.idea || "";
  }
  /**
   * Localised opening name, looked up by the line's id.
   *
   * Up to 1.25 the lookup key was the Chinese name itself, in every table. So
   * renaming one opening in openings.js silently unkeyed both translations at
   * once and every language quietly fell back to the Chinese string — a
   * content edit with no failing test and no visible symptom until someone
   * opened the app in English. The id makes a rename a rename.
   */
  function openingName(id) {
    for (const tbl of contentTables("openings")) if (tbl[id]) return tbl[id];
    return CHESS_OPENING_NAMES[id] || id;
  }
  /** …and the sentence explaining what the line is trying to do. */
  function openingIdea(id) {
    for (const tbl of contentTables("ideas")) if (tbl[id]) return tbl[id];
    return "";
  }

  function loadLearnState() {
    try {
      const s = JSON.parse(Persist.get("learn") || "null");
      if (s && s.v === 1 && s.done) return s;
    } catch (_) {}
    return { v: 1, done: {}, last: 0 };
  }
  store.session.learnState = loadLearnState();
  function saveLearnState() {
    Persist.setJson("learn", store.session.learnState);
  }

  function startLearn() {
    startLesson(Math.max(0, Math.min(store.session.learnState.last || 0, LESSONS.length - 1)));
  }
  function stopLearn() { if (store.session.learn) store.session.learn.token++; store.session.learn = null; }

  function curLesson() { return LESSONS[store.session.learn.li]; }
  function curTask() { return curLesson().tasks[store.session.learn.ti]; }

  function startLesson(i) {
    if (!LESSONS[i]) return;
    store.session.learnState.last = i;
    saveLearnState();
    store.session.learn = { li: i, ti: 0, g: null, stars: new Set(), tapStep: 0, last: null, done: false, engineBusy: false, token: 0, misses: 0, helpOn: false, helpArrow: null, flash: null, demoing: false, wantDemo: !store.session.learnState.done[LESSONS[i].id] };
    startLearnTask();
  }

  function startLearnTask() {
    const task = curTask();
    store.session.learn.token++;
    BoardView.cancelAnim();
    store.session.learn.g = new Chess(task.fen);
    store.session.learn.stars = new Set(task.stars || []);
    store.session.learn.tapStep = 0;
    store.session.learn.last = null;
    store.session.learn.done = false;
    store.session.learn.engineBusy = false;
    store.session.learn.misses = 0;
    store.session.learn.helpOn = false;
    store.session.learn.helpArrow = null;
    store.session.learn.flash = null;
    store.session.learn.demoing = false;
    store.game.selection = null;
    // first visit to an unfinished lesson: show the solution once, then reset
    if (store.session.learn.wantDemo && task.solution && (task.type === "stars" || task.type === "move")) {
      store.session.learn.wantDemo = false;
      runLessonDemo();
      return;
    }
    sync();
  }

  /** Auto-play the task's solution as a watch-first demo; any board click skips. */
  function runLessonDemo() {
    const task = curTask();
    const sol = task.solution;
    store.session.learn.demoing = true;
    const token = store.session.learn.token;
    let i = 0;
    toast(t("lm.demoIntro"));
    sync();
    const step = () => {
      if (!store.session.learn || store.session.learn.token !== token) return;
      if (i >= sol.length) {
        setTimeout(() => {
          if (!store.session.learn || store.session.learn.token !== token) return;
          endLessonDemo();
        }, 800);
        return;
      }
      const s = sol[i++];
      const g = store.session.learn.g;
      const mv = /^[a-h][1-8][a-h][1-8]$/.test(s)
        ? g.move({ from: s.slice(0, 2), to: s.slice(2, 4), promotion: "q" })
        : g.move(s);
      if (!mv) { endLessonDemo(); return; }
      store.session.learn.last = { from: mv.from, to: mv.to };
      if (task.type === "stars") {
        if (store.session.learn.stars.has(mv.to)) store.session.learn.stars.delete(mv.to);
        // hand the turn back, exactly like real star play
        const f = g.fen().split(" ");
        f[1] = "w"; f[3] = "-";
        store.session.learn.g = new Chess(f.join(" "));
      }
      Audio2.playMove("w");
      sync();
      setTimeout(step, 800);
    };
    setTimeout(step, 700);
  }

  function endLessonDemo() {
    const task = curTask();
    store.session.learn.demoing = false;
    store.session.learn.g = new Chess(task.fen);
    store.session.learn.stars = new Set(task.stars || []);
    store.session.learn.last = null;
    store.game.selection = null;
    sync();
    toast(t("lm.yourTurn"), "fix");
  }

  function skipLessonDemo() {
    store.session.learn.token++; // kill the pending demo timers
    endLessonDemo();
  }

  function learnModel() {
    const g = store.session.learn.g;
    const task = curTask();
    let stars = Array.from(store.session.learn.stars);
    // stuck-help: after repeated misses, highlight the tap answer with stars
    if (store.session.learn.helpOn && task.type === "tap" && store.session.learn.tapStep < task.steps.length) {
      stars = task.steps[store.session.learn.tapStep].squares;
    }
    return {
      position: g.board(),
      flipped: false, // lessons are authored from the white side
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: store.session.learn.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      hintMove: store.session.learn.helpArrow,
      flashSquare: store.session.learn.flash,
      stars,
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  /** Two misses on the same task → show the answer (stars for taps, arrow for moves). */
  function learnRegisterMiss() {
    store.session.learn.misses++;
    if (store.session.learn.misses < 2 || store.session.learn.helpOn) return;
    store.session.learn.helpOn = true;
    const task = curTask();
    if (task.type === "move" && task.solution && task.solution.length) {
      try {
        const probe = new Chess(task.fen);
        const mv = probe.move(task.solution[0]);
        if (mv) store.session.learn.helpArrow = { from: mv.from, to: mv.to };
      } catch (_) {}
    }
    toast(t("lm.answerShown"), "fix");
    sync();
  }

  function learnFlash(sq) {
    store.session.learn.flash = sq;
    draw();
    const token = store.session.learn.token;
    setTimeout(() => {
      if (store.session.learn && store.session.learn.token === token && store.session.learn.flash === sq) { store.session.learn.flash = null; draw(); }
    }, 380);
  }

  function learnTaskText() {
    const task = curTask();
    if (store.session.learn.demoing) return t("lm.demoing");
    if (store.session.learn.done) return t("lm.taskDone") + (store.session.learn.li + 1 < LESSONS.length ? t("lm.tapNext") : t("lm.allDone"));
    const tx = taskText(curLesson(), store.session.learn.ti);
    if (task.type === "tap") return tx.step(store.session.learn.tapStep) + " (" + (store.session.learn.tapStep + 1) + "/" + task.steps.length + ")";
    if (task.type === "drill" && store.session.learn.engineBusy) return t("lm.sparThinking");
    // tx, not task: reading the prompt straight off the lesson showed every
    // move/stars/drill task in Chinese to English readers — the translations
    // were sitting in lessons-en.js unused, and only the tap tasks (which go
    // through tx.step above) ever looked translated
    return tx.prompt;
  }

  function learnClick(sq) {
    if (!store.session.learn || store.session.learn.done) return;
    if (store.session.learn.demoing) { skipLessonDemo(); return; }
    const task = curTask();
    if (task.type === "tap") {
      if (task.steps[store.session.learn.tapStep].squares.includes(sq)) {
        store.session.learn.tapStep++;
        store.session.learn.helpOn = false;
        store.session.learn.misses = 0;
        Audio2.playStar();
        learnFlash(sq);
        if (store.session.learn.tapStep >= task.steps.length) learnTaskDone();
        else sync();
      } else {
        // the localised tip, not the authored one — same reason as learnTaskText
        toast(tf("lm.wrongSquare", [taskText(curLesson(), store.session.learn.ti).step(store.session.learn.tapStep)]));
        learnRegisterMiss();
      }
      return;
    }
    if (task.type === "drill" && store.session.learn.engineBusy) return;
    const g = store.session.learn.g;
    if (g.game_over()) return;
    const piece = g.get(sq);
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        choosePromotion(g.turn()).then((p) => { if (p) learnMove(from, sq, p); });
        return;
      }
      learnMove(from, sq, "q");
      return;
    }
    if (piece && piece.color === "w" && g.turn() === "w" && (!task.only || piece.type === task.only)) {
      const targets = g.moves({ square: sq, verbose: true }).map((m) => m.to);
      store.game.selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (task.only && piece && piece.color === "w" && piece.type !== task.only) {
      toast(tf("lm.onlyPiece", [PIECE_NAMES[task.only]]));
      return;
    }
    if (store.game.selection) { store.game.selection = null; draw(); }
  }

  const PIECE_NAMES = new Proxy({}, { get: (_, k) => t("piece." + String(k)) });

  function learnRetryTask(msg) {
    toast(msg, "fix");
    const token = store.session.learn.token;
    setTimeout(() => { if (store.session.learn && store.session.learn.token === token) startLearnTask(); }, 1400);
  }

  function learnMove(from, to, promotion) {
    const task = curTask();
    const g = store.session.learn.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    store.session.learn.last = { from: mv.from, to: mv.to };
    store.session.learn.helpArrow = null;
    BoardView.cancelAnim(); // the student's own move — see animateReply
    moveSound(mv, g);
    if (task.type === "stars") {
      if (store.session.learn.stars.has(mv.to)) {
        store.session.learn.stars.delete(mv.to);
        Audio2.playStar();
        learnFlash(mv.to);
      }
      if (store.session.learn.stars.size === 0) { learnTaskDone(); return; }
      // hand the turn straight back to the student — the opponent never replies
      const f = g.fen().split(" ");
      f[1] = "w"; f[3] = "-";
      store.session.learn.g = new Chess(f.join(" "));
      sync();
      return;
    }
    if (task.type === "move") {
      const okByGoal =
        task.goal === "any" ? true :
        task.goal === "check" ? g.in_check() :
        task.goal === "mate" ? g.in_checkmate() :
        task.goal === "castle-k" ? mv.flags.includes("k") :
        task.goal === "castle-q" ? mv.flags.includes("q") :
        task.goal === "ep" ? mv.flags.includes("e") :
        task.goal === "promote" ? !!mv.promotion :
        task.goal === "capture" ? (mv.to === task.target && !!mv.captured) :
        task.goal === "one-of" ? (Array.isArray(task.accept) && task.accept.includes(mv.san)) :
        // safe: the moved piece cannot be captured by any reply
        task.goal === "safe" ? !g.moves({ verbose: true }).some((m) => m.to === mv.to) :
        task.goal === "draw-insufficient" ? g.insufficient_material() : false;
      if (okByGoal) {
        if (mv.promotion) toast(tf("mm.promoted", [PROMO_NAMES[mv.promotion]]));
        learnTaskDone();
        return;
      }
      if (task.failOnStalemate && g.in_stalemate()) {
        sync();
        learnRetryTask(t("lm.stalemateFail"));
        return;
      }
      g.undo();
      store.session.learn.last = null;
      // the translated retry hint, not the raw Chinese one on the task
      // a lesson retry is a correction, not a receipt
      toast(taskText(curLesson(), store.session.learn.ti).retry || t("lm.retry"), "fix");
      learnRegisterMiss();
      sync();
      return;
    }
    if (task.type === "drill") {
      if (task.winOn === "promote" && mv.promotion) {
        toast(t("lm.promoWin"));
        learnTaskDone();
        return;
      }
      sync();
      const done = drillOutcome(g, task);
      if (done === "win") { learnTaskDone(); return; }
      if (done) { learnRetryTask(done); return; }
      learnEngineReply();
    }
  }

  /**
   * How a drill position stands after a move.
   * @returns {"win"|string|null} "win", a retry message, or null to play on.
   * Defensive drills (`winOn: "draw"`) invert the usual verdict: reaching a
   * draw *is* the goal, and being mated is the failure.
   */
  function drillOutcome(g, task) {
    if (task.winOn === "draw") {
      if (g.in_checkmate()) return t("lm.mateDefLost");
      if (g.game_over()) return "win"; // stalemate / 50-move / insufficient
      // black queening means the defence has already collapsed
      for (const row of g.board()) for (const p of row) {
        if (p && p.color === "b" && p.type === "q") return t("lm.blackQueened");
      }
      return null;
    }
    if (g.in_checkmate()) return g.turn() === "b" ? "win" : t("lm.mated");
    if (g.game_over()) return g.in_stalemate() ? t("lm.stalemated") : t("lm.drawn");
    return null;
  }

  /** White still has winning material for this drill (health check). */
  function learnHasHeavy(g) {
    for (const row of g.board()) for (const p of row) {
      if (p && p.color === "w" && (p.type === "q" || p.type === "r" || p.type === "p")) return true;
    }
    return false;
  }

  async function learnEngineReply() {
    if (!ChessEngine) { toast(t("lm.noEngine"), "fault"); return; }
    const g = store.session.learn.g;
    const token = store.session.learn.token;
    // drills default to the weakest tier: the sparring partner is there to
    // teach the technique, not to punish a beginner with perfect defense
    const tier = curTask().engine || "beginner";
    store.session.learn.engineBusy = true;
    sync();
    let mv = null;
    try { mv = await ChessEngine.bestMove(g.fen(), tier); } catch (_) {}
    if (!store.session.learn || token !== store.session.learn.token) return;
    store.session.learn.engineBusy = false;
    if (mv) {
      const played = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
      if (played) {
        store.session.learn.last = { from: played.from, to: played.to };
        animateReply(played);
        moveSound(played, g);
      }
    }
    const task = curTask();
    const done = drillOutcome(g, task);
    if (done === "win") { sync(); learnTaskDone(); return; }
    if (done) { sync(); learnRetryTask(done); return; }
    // attacking drills need the material that makes the win possible; the
    // defensive one is *expected* to be down material, so skip the check
    if (task.winOn !== "draw" && !learnHasHeavy(g)) {
      sync();
      learnRetryTask(t("lm.lostMaterial"));
      return;
    }
    sync();
  }

  /** Drill-only: take back the last white move (and the engine reply with it). */
  function learnUndo() {
    if (!store.session.learn || store.session.learn.done || curTask().type !== "drill") return;
    const g = store.session.learn.g;
    if (!g.history().length) return;
    store.session.learn.token++; // drop any in-flight engine reply
    store.session.learn.engineBusy = false;
    if (ChessEngine) ChessEngine.cancel();
    g.undo();
    if (g.history().length && g.turn() !== "w") g.undo();
    store.session.learn.last = null;
    store.session.learn.helpArrow = null;
    store.game.selection = null;
    sync();
  }

  /** Drill-only engine hint, drawn as an arrow (full strength, brief think). */
  async function learnHint() {
    if (!store.session.learn || store.session.learn.done || curTask().type !== "drill" || store.session.learn.engineBusy) return;
    if (!ChessEngine) { toast(t("msg.engine.unavailable"), "fault"); return; }
    const g = store.session.learn.g;
    if (g.game_over() || g.turn() !== "w") return;
    if (store.session.hintPending) return;
    const token = store.session.learn.token;
    const sig = g.fen();
    store.session.hintPending = true;
    sync();
    let e = null;
    try { e = await ChessEngine.analyze(sig, 400); } catch (_) {}
    store.session.hintPending = false;
    if (!store.session.learn || token !== store.session.learn.token || store.session.learn.g.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("msg.engine.noHint"), "fault"); return; }
    store.session.learn.helpArrow = { from: e.best.slice(0, 2), to: e.best.slice(2, 4) };
    sync();
  }

  function learnTaskDone() {
    const L = curLesson();
    store.game.selection = null;
    if (store.session.learn.ti + 1 < L.tasks.length) {
      Audio2.playMove("b");
      toast(t("lm.nextSubtask"), "fix");
      store.session.learn.ti++;
      // startLearnTask resets the per-task cursors, but it runs 900ms later —
      // and the board and prompt are redrawn now. A tap task followed by
      // another tap task would spend that gap reading step[3] of a 1-step task.
      store.session.learn.tapStep = 0;
      store.session.learn.helpOn = false;
      const token = ++store.session.learn.token;
      setTimeout(() => { if (store.session.learn && store.session.learn.token === token) startLearnTask(); }, 900);
      sync();
      return;
    }
    store.session.learn.done = true;
    Audio2.playWin();
    if (!store.session.learnState.done[L.id]) {
      store.session.learnState.done[L.id] = true;
      saveLearnState();
      checkNewAchievements();
    }
    toast(tf("lm.lessonDone", [lessonText(L).title]));
    sync();
  }

  /**
   * One lesson paragraph as a <p>, with `**…**` rendered bold.
   *
   * The course has emphasised its key sentences with `**…**` since 1.4 — the
   * one line in each lesson a beginner should carry away. The renderer set
   * `textContent`, so every reader saw the asterisks instead of the emphasis;
   * 24 paragraphs in the Chinese course and 17 in the English one. Split
   * rather than parsed, and assembled from text nodes rather than markup, so
   * lesson prose can never become HTML.
   * @param {string} src
   * @returns {HTMLParagraphElement}
   */
  function lessonParagraph(src) {
    const el = document.createElement("p");
    // odd indices are the bold runs; an unpaired ** leaves its text alone
    const parts = String(src).split("**");
    parts.forEach((chunk, i) => {
      if (!chunk) return;
      if (i % 2 === 1 && i < parts.length - 1) {
        const b = document.createElement("strong");
        b.textContent = chunk;
        el.appendChild(b);
      } else {
        el.appendChild(document.createTextNode(i % 2 === 1 ? "**" + chunk : chunk));
      }
    });
    return el;
  }

  function syncLearnUI() {
    const sec = document.getElementById("sec-learn");
    if (!sec) return;
    sec.hidden = store.session.mode !== "learn";
    if (store.session.mode !== "learn" || !store.session.learn) return;
    const L = curLesson();
    const doneCount = LESSONS.filter((x) => store.session.learnState.done[x.id]).length;
    const prog = document.getElementById("learn-progress");
    // "完成 3/72" reads differently from the header chip's "4/72", which is
    // where you ARE. Two bare N/72 on one screen meant two different things.
    if (prog) prog.textContent = t("learn.donePre") + doneCount + "/" + LESSONS.length;
    const loc = lessonText(L);
    const title = document.getElementById("lesson-title");
    if (title) title.textContent = t("learn.lessonPre") + (store.session.learn.li + 1) + t("learn.lessonPost") + " · " + loc.part + " · " + loc.title;
    const textEl = document.getElementById("lesson-text");
    if (textEl) {
      textEl.replaceChildren();
      for (const p of loc.text) {
        textEl.appendChild(lessonParagraph(p));
      }
    }
    const task = document.getElementById("lesson-task");
    if (task) task.textContent = learnTaskText();
    const demoBtn = document.getElementById("lesson-demo");
    if (demoBtn) {
      const curT = curTask();
      // Most tasks have nothing to demonstrate. Greying the button out on
      // those lessons said "this is unavailable" without ever saying when it
      // would be available — for a lesson with no solution to replay, the
      // answer is never. It is hidden there and shown where it works; the
      // disabled state is now only "a demo is playing right now", which the
      // moving pieces already explain.
      const canDemo = !!curT.solution && (curT.type === "stars" || curT.type === "move");
      demoBtn.hidden = !canDemo;
      demoBtn.disabled = store.session.learn.demoing;
    }
    const next = document.getElementById("lesson-next");
    if (next) {
      const isLast = store.session.learn.li + 1 >= LESSONS.length;
      next.textContent = isLast ? t("lm.toBeginnerAi") : t("act.next");
      // `learn.done` only records whether the tasks were finished *this
      // session*, so someone returning to a course they already completed
      // found the graduation button greyed out — the one button the whole
      // teaching track exists to reach. The saved progress counts too.
      const everDone = !!store.session.learnState.done[LESSONS[store.session.learn.li].id];
      next.disabled = isLast && !store.session.learn.done && !everDone;
      next.classList.toggle("primary", store.session.learn.done || (isLast && everDone));
    }
    const list = document.getElementById("lesson-list");
    if (list) {
      list.replaceChildren();
      let lastPart = null;
      LESSONS.forEach((x, i) => {
        const xl = lessonText(x);
        if (xl.part !== lastPart) {
          lastPart = xl.part;
          const h = document.createElement("div");
          h.className = "lesson-part";
          h.textContent = xl.part;
          list.appendChild(h);
        }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === store.session.learn.li ? " current" : "");
        b.dataset.i = String(i);
        const mark = store.session.learnState.done[x.id] ? "✓ " : "";
        b.textContent = mark + (i + 1) + ". " + xl.title;
        list.appendChild(b);
      });
    }
  }

  // --- puzzle mode: tactics trainer (data in puzzles.js, pure chess.js) ---
  const PUZZLES = CHESS_PUZZLES || [];
  const PUZZLE_CAT_IDS = ["m1", "m2", "m3", "win", "tac", "real", "def", "draw", "op", "review"];
  const PUZZLE_MOVES = { m1: 1, m2: 2, m3: 3 };
  /** scripted-line categories: exact-line play, opponent replies from the script */
  const SCRIPTED_CATS = { win: true, op: true, tac: true, draw: true, real: true };

  /** A mate in one for whoever is to move in `g`, or null. */
  function mateInOne(g) {
    for (const m of g.moves()) {
      g.move(m);
      const done = g.in_checkmate();
      g.undo();
      if (done) return m;
    }
    return null;
  }

  /** Opening trainer drills, generated from the vendored ECO book (≥6 plies). */
  const Drills = ChessDrills;
  const OPENING_DRILLS = Drills.drillLines(CHESS_OPENINGS || [])
    // The id is derived from the ECO code and the moves, NOT from the row's
    // position — see drills.js. With a positional id, adding a single deep
    // line to the book moved 108 of the 109 ids onto a different drill and
    // quietly wiped everyone's opening progress and review queue.
    .map(([eco, nameId, seq, idea]) => ({
      id: Drills.drillId(eco, seq),
      cat: "op",
      // `nameId` keys all three name tables; the displayed name is built at
      // render time so a language switch relabels the whole drill list
      nameId,
      eco,
      name: eco + " " + (CHESS_OPENING_NAMES[nameId] || nameId),
      line: seq.split(" "),
      idea: idea || "",
    }))
    // ECO order, so the list reads A→E: flank, then semi-open, then open, then
    // queen's-pawn, then Indian. The book is authored in family order inside
    // each letter, which put A57 next to A08 once 1.15 added the deep lines,
    // and 109 rows in no order at all is a list nobody scrolls twice.
    // sorted by the Chinese name, not the displayed one: the list order must
    // not shuffle when the interface language changes
    .sort((a, b) => (a.eco < b.eco ? -1 : a.eco > b.eco ? 1
      : (CHESS_OPENING_NAMES[a.nameId] || "").localeCompare(CHESS_OPENING_NAMES[b.nameId] || "", "zh")));
  const ALL_PUZZLES = PUZZLES.concat(OPENING_DRILLS);

  /**
   * Rough difficulty tier for a puzzle, derived rather than hand-tagged so it
   * cannot drift out of sync as the set grows: how many moves the solution
   * runs, how crowded the board is, and whether the key move is a quiet one
   * (no check, no capture — the hardest kind to spot).
   * @returns {"easy"|"mid"|"hard"}
   */
  const PUZZLE_TIER_CACHE = new Map();
  function puzzleTier(p) {
    if (PUZZLE_TIER_CACHE.has(p.id)) return PUZZLE_TIER_CACHE.get(p.id);
    let score = 0;
    const line = p.line || p.solution || [];
    const plies = { m1: 1, m2: 3, m3: 5 }[p.cat] || line.length;
    // An opening drill is not a tactic and does not belong on the tactic
    // scale. It has no `fen`, so every term below (men on the board, quiet key
    // move, no capture) silently never ran, leaving score = (plies-1)*1.5 + 3
    // — which is ≥10.5 for the shortest line in the book. Measured on 1.14:
    // all 38 drillable lines scored "hard", and the difficulty filter had
    // therefore never done anything at all in this category. What actually
    // makes a rote line harder is how much of it there is to remember.
    if (p.cat === "op") {
      const tier = plies <= 8 ? "easy" : plies <= 16 ? "mid" : "hard";
      PUZZLE_TIER_CACHE.set(p.id, tier);
      return tier;
    }
    // A real-game tactic is not on the diagram scale either: every one of them
    // has 20+ men, so the crowding term below would land the whole category in
    // the same band. What separates them is how loud the winning move is — a
    // big capture announces itself, a quiet move on a full board does not.
    if (p.cat === "real") {
      const first = line[0] || "";
      const loud = /[+#x]/.test(first);
      const tier = !loud ? "hard" : p.gain >= 5 ? "easy" : p.gain >= 3 ? "mid" : "hard";
      PUZZLE_TIER_CACHE.set(p.id, tier);
      return tier;
    }
    score += (plies - 1) * 1.5;                    // longer forcing lines dominate
    if (p.cat === "tac") score += 1.5;
    if (p.cat === "win" && typeof p.gain === "number" && p.gain <= 3) score += 1; // small wins hide better
    // A defence is as hard as it is narrow. Deriving the tier from the number
    // of moves that hold — rather than from the solution's length, which is
    // always one — is what makes the difficulty filter mean anything here:
    // before this every defensive puzzle landed in the same middle band.
    if (p.cat === "def" && typeof p.saves === "number") {
      score += p.saves <= 1 ? 5 : p.saves <= 3 ? 3 : 1;
    }
    try {
      if (p.fen) {
        const men = (p.fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
        if (men >= 14) score += 2.5; else if (men >= 9) score += 1.5; else if (men >= 6) score += 0.5;
        const first = line[0] || "";
        if (first && !/[+#]/.test(first)) score += 1.5;   // quiet key move
        if (first && !/x/.test(first)) score += 0.5;      // no capture to point the way
        // a lone king opposite has fewer defences to calculate
        const blackMen = (p.fen.split(" ")[0].match(/[a-z]/g) || []).length;
        if (blackMen <= 1) score -= 1;
      }
    } catch (_) {}
    const tier = score >= 6 ? "hard" : score >= 3 ? "mid" : "easy";
    PUZZLE_TIER_CACHE.set(p.id, tier);
    return tier;
  }

  /**
   * Move a pre-1.21.3 save off the positional opening-drill ids.
   *
   * Runs once, marked by `idv`. It reads the book as it stands to work out
   * which row each old index named, so it is only correct while the book is
   * the one those indexes were written against — which is why the release
   * carrying this migration must not also change the book.
   */
  function migrateDrillIds(s) {
    if (!s || s.idv >= 2) return s;
    // frozen table, NOT read from the live book — see drills.js. Deriving it
    // meant the migration was only correct for someone upgrading from the
    // exact book it was generated against, which said nothing about a player
    // who skips this release entirely.
    const map = ChessDrills.legacyIdMap();
    ChessDrills.migrateIds(s.solved, map);
    ChessDrills.migrateIds(s.missed, map);
    s.idv = 2;
    return s;
  }

  function loadPuzzleState() {
    try {
      const s = JSON.parse(Persist.get("puzzles") || "null");
      if (s && s.v === 1 && s.solved) {
        if (!s.missed) s.missed = {};
        return migrateDrillIds(s);
      }
    } catch (_) {}
    return { v: 1, idv: 2, solved: {}, missed: {}, cat: "m1" };
  }
  store.session.puzzleState = loadPuzzleState();
  // persist the rewritten ids straight away — a migration that only lives in
  // memory runs again on every launch, and once the book does change it would
  // then be reading positions that no longer mean what they meant
  if (store.session.puzzleState.idv === 2) { Persist.setJson("puzzles", store.session.puzzleState); }
  function savePuzzleState() {
    Persist.setJson("puzzles", store.session.puzzleState);
  }
  const Srs = ChessSrs;
  function markMissed(id) {
    store.session.puzzleState.missed[id] = Srs.onMiss(store.session.puzzleState.missed[id]);
    savePuzzleState();
  }
  /**
   * A clean solve advances the puzzle towards leaving the review queue — it no
   * longer graduates on the first correct answer, which was usually given
   * moments after reading the solution.
   */
  function clearMissed(id) {
    if (!Srs.isDue(store.session.puzzleState.missed[id])) return;
    const next = Srs.onSolve(store.session.puzzleState.missed[id]);
    if (next) store.session.puzzleState.missed[id] = next; else delete store.session.puzzleState.missed[id];
    savePuzzleState();
  }

  /** "review" is a virtual category: every puzzle currently in the missed set. */
  function puzzlesInCat(cat) {
    const base = cat === "review"
      // least-learned first, so a puzzle just answered goes to the back of the
      // queue instead of being asked again on the very next click
      ? Srs.order(ALL_PUZZLES.filter((p) => Srs.isDue(store.session.puzzleState.missed[p.id])).map((p) => p.id),
        store.session.puzzleState.missed).map((id) => ALL_PUZZLES.find((p) => p.id === id))
      : ALL_PUZZLES.filter((p) => p.cat === cat);
    // "Review" is not a difficulty band — it is exactly the set of puzzles this
    // player got wrong. Filtering it by an automatically derived tier hides the
    // very puzzles they asked to redo (a queue of three could show as empty),
    // so the tier row does not apply here.
    if (cat === "review" || store.session.puzzleTierFilter === "all") return base;
    return base.filter((p) => puzzleTier(p) === store.session.puzzleTierFilter);
  }

  /** the scripted line of the current puzzle (openings: line; win: solution) */
  function puzzleScript(p) { return p.line || p.solution; }

  function startPuzzleAt(cat, idx) {
    const list = puzzlesInCat(cat);
    if (!list.length) {
      // no puzzle survives the filter: clear the board and the counters too,
      // otherwise the previous puzzle stays on screen and the "n/N" chip keeps
      // counting a set that is no longer being shown
      store.session.puzzle = null;
      store.game.selection = null;
      BoardView.cancelAnim();
      sync();
      toast(t("pz.noneInTier"));
      return;
    }
    idx = ((idx % list.length) + list.length) % list.length;
    store.session.puzzleState.cat = cat;
    savePuzzleState();
    const p = list[idx];
    store.session.puzzle = { cat, idx, p, g: p.fen ? new Chess(p.fen) : new Chess(), stage: 0, done: false, misses: 0, usedAnswer: false, helpArrow: null, last: null };
    store.game.selection = null;
    BoardView.cancelAnim();
    sync();
  }

  function startPuzzles() {
    let cat = PUZZLE_CAT_IDS.includes(store.session.puzzleState.cat) ? store.session.puzzleState.cat : "m1";
    // don't strand the user on an empty review tab
    if (cat === "review" && !puzzlesInCat("review").length) cat = "m1";
    const list = puzzlesInCat(cat);
    let idx = list.findIndex((p) => !store.session.puzzleState.solved[p.id]);
    if (idx < 0) idx = 0;
    startPuzzleAt(cat, idx);
  }
  function stopPuzzles() { store.session.puzzle = null; }

  function puzzleModel() {
    const g = store.session.puzzle.g;
    return {
      position: g.board(),
      flipped: false, // all puzzles are white to move
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: store.session.puzzle.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      hintMove: store.session.puzzle.helpArrow,
      stars: [],
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  function matingMovesOf(g) {
    return g.moves({ verbose: true }).filter((m) => {
      g.move(m); const mate = g.in_checkmate(); g.undo(); return mate;
    });
  }

  /** White to move: some move forces mate within n white moves. */
  function whiteHasForcedMate(g, n) {
    for (const m of g.moves()) {
      g.move(m);
      const mate = g.in_checkmate();
      const deeper = !mate && n > 1 && !g.game_over() && blackForcedLost(g, n - 1);
      g.undo();
      if (mate || deeper) return true;
    }
    return false;
  }

  /** Black to move: EVERY reply loses to a forced mate within n white moves. */
  function blackForcedLost(g, n) {
    const replies = g.moves();
    if (!replies.length) return false; // stalemate/over — black escaped
    for (const r of replies) {
      g.move(r);
      const lost = whiteHasForcedMate(g, n);
      g.undo();
      if (!lost) return false;
    }
    return true;
  }

  /** A black reply that refutes the mate threat within n, or null if none. */
  function findRefutation(g, n) {
    for (const r of g.moves()) {
      g.move(r);
      const lost = whiteHasForcedMate(g, n);
      g.undo();
      if (!lost) return r;
    }
    return null;
  }

  /** Black's toughest defense: needs the deepest mate (ties: fewest maters). */
  function bestDefense(g, n) {
    let best = null, bestDepth = -1, bestMaters = Infinity;
    for (const r of g.moves()) {
      g.move(r);
      let d = 1;
      while (d < n && !whiteHasForcedMate(g, d)) d++;
      const maters = matingMovesOf(g).length;
      g.undo();
      if (d > bestDepth || (d === bestDepth && maters < bestMaters)) {
        bestDepth = d; bestMaters = maters; best = r;
      }
    }
    return best;
  }

  function puzzleGoalText() {
    const p = store.session.puzzle.p;
    if (p.cat === "op") return tf("pz.goalOp", [puzzleName(p), Math.ceil(p.line.length / 2)]);
    if (p.cat === "win") return tf("pz.goalWin", [puzzleName(p), p.gain]);
    if (p.cat === "tac") return tf("pz.goalTac", [puzzleName(p), puzzleMotif(p), p.gain]);
    if (p.cat === "real") return tf("pz.goalReal", [puzzleName(p), p.men, p.gain]);
    if (p.cat === "def") return tf("pz.goalDef", [puzzleName(p)]);
    if (p.cat === "draw") return tf("pz.goalDraw", [puzzleName(p)]);
    // the count is a word in Chinese ("一步"), a numeral in English — so it
    // goes through the dictionary rather than being interpolated raw
    return tf("pz.goalMate", [puzzleName(p), t("pz.n." + (PUZZLE_MOVES[p.cat] || 1))]);
  }

  function puzzleClick(sq) {
    if (!store.session.puzzle || store.session.puzzle.done) return;
    const g = store.session.puzzle.g;
    if (g.game_over() || g.turn() !== "w") return;
    const piece = g.get(sq);
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        choosePromotion(g.turn()).then((p) => { if (p) puzzleMove(from, sq, p); });
        return;
      }
      puzzleMove(from, sq, "q");
      return;
    }
    if (piece && piece.color === "w") {
      const targets = g.moves({ square: sq, verbose: true }).map((m) => m.to);
      store.game.selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (store.game.selection) { store.game.selection = null; draw(); }
  }

  function puzzleMove(from, to, promotion) {
    const g = store.session.puzzle.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    store.session.puzzle.helpArrow = null;
    store.session.puzzle.last = { from: mv.from, to: mv.to };
    BoardView.cancelAnim(); // the solver's own move — see animateReply
    moveSound(mv, g);
    // A real-game tactic grades the key move and nothing else. The two plies
    // after it are a demonstration, not a second question: in a 25-piece
    // position the follow-up usually has several equally good moves, and
    // marking one of them wrong would teach the opposite of the lesson. The
    // point of this category is finding the one move that wins — once it is
    // found, the rest is there to show what it won.
    if (store.session.puzzle.p.cat === "real") {
      const script = puzzleScript(store.session.puzzle.p);
      if (mv.san !== script[0]) { puzzleWrong(t("pz.notTheMove")); return; }
      store.session.puzzle.stage = 1;
      for (let i = 1; i < script.length; i++) {
        const m = g.move(script[i]);
        if (!m) break;
        store.session.puzzle.last = { from: m.from, to: m.to };
        store.session.puzzle.stage = i + 1;
      }
      puzzleSolved();
      return;
    }
    if (SCRIPTED_CATS[store.session.puzzle.p.cat]) {
      // scripted line: exact match, opponent replies straight from the script
      const script = puzzleScript(store.session.puzzle.p);
      if (mv.san !== script[store.session.puzzle.stage]) {
        const c = store.session.puzzle.p.cat;
        puzzleWrong(
          c === "win" ? (mv.captured ? t("pz.wrongCapture") : t("pz.biggerPrize")) :
          c === "tac" ? (store.session.puzzle.stage === 0 ? tf("pz.findMotif", [puzzleMotif(store.session.puzzle.p)]) : t("pz.takeTarget")) :
          c === "draw" ? t("pz.notDrawn") :
          openingWhy(g, mv, script[store.session.puzzle.stage]));
        return;
      }
      store.session.puzzle.stage++;
      if (store.session.puzzle.stage < script.length) {
        const rm = g.move(script[store.session.puzzle.stage]);
        if (rm) {
          store.session.puzzle.last = { from: rm.from, to: rm.to };
          animateReply(rm);
          moveSound(rm, g);
          store.session.puzzle.stage++;
        }
      }
      if (store.session.puzzle.stage >= script.length) { puzzleSolved(); return; }
      sync();
      return;
    }
    // Defensive puzzles are graded on the position, not on matching a script.
    // The question they ask is "is the mate still there?" — so any move that
    // answers no is right, exactly as it would be in a real game. Insisting on
    // one stored move would mark a perfectly good defence wrong.
    if (store.session.puzzle.p.cat === "def") {
      if (!g.game_over() && mateInOne(g)) {
        const still = mateInOne(g);
        puzzleWrong(tf("pz.stillMate", [still]));
        return;
      }
      puzzleSolved();
      return;
    }
    if (g.in_checkmate()) { puzzleSolved(); return; }
    const totalMoves = PUZZLE_MOVES[store.session.puzzle.p.cat] || 1;
    const remaining = totalMoves - (store.session.puzzle.stage + 1);
    if (remaining <= 0) {
      // used the last move without mating — explain what black gets to play
      const escape = g.moves()[0];
      puzzleWrong(escape ? tf("pz.notMateYetMove", [escape]) : t("pz.notMateYet"));
      return;
    }
    // midpoint: the stored line, or any alternate that still forces mate
    const onLine = mv.san === store.session.puzzle.p.solution[store.session.puzzle.stage * 2];
    if (!onLine) {
      const refutation = findRefutation(g, remaining);
      if (refutation) {
        puzzleWrong(tf("pz.refuted", [refutation]));
        return;
      }
    }
    store.session.puzzle.stage++;
    const reply = onLine ? store.session.puzzle.p.solution[store.session.puzzle.stage * 2 - 1] : bestDefense(g, remaining);
    const rm = reply ? g.move(reply) : null;
    if (rm) {
      store.session.puzzle.last = { from: rm.from, to: rm.to };
      animateReply(rm);
      moveSound(rm, g);
    }
    sync();
  }

  /**
   * Say why an opening move is wrong, not merely that it is.
   *
   * "这不是谱着" is a fact about a line the player has not memorised yet, which
   * is exactly what they came here to learn — it teaches nothing. The coach
   * names the principle instead. `g` already has the move on the board, so
   * everything before it is the drill so far.
   */
  function openingWhy(g, mv, bookSan) {
    const Coach = ChessOpeningCoach;
    if (!Coach || !bookSan) return t("pz.offBook");
    let r = null;
    try { r = Coach.critique(store.session.puzzle.p.fen || "", g.history().slice(0, -1), mv.san, bookSan, Chess); }
    catch (_) { r = null; }
    if (!r) return t("pz.offBook");
    // the coach knows nothing about the dictionary, so a piece comes back as
    // its key ("piece.n") and is turned into a word here
    const vals = r.vals.map((v) => (typeof v === "string" && v.startsWith("piece.") ? t(v) : v));
    return tf(r.key, vals);
  }

  function puzzleWrong(reason) {
    store.session.puzzle.g.undo();
    store.session.puzzle.last = null;
    store.session.puzzle.misses++;
    markMissed(store.session.puzzle.p.id); // a missed puzzle joins the review queue
    // the correction tier: this is the app telling you what you got wrong,
    // which in the puzzle and opening modes is the entire product
    toast((reason || t("pz.noForcedMate")) +
      (store.session.puzzle.misses >= 2 ? t("pz.seeAnswer") : t("pz.tryAgain")), "fix");
    sync();
  }

  /** Arrow for the correct move at the current stage. */
  function showPuzzleAnswer() {
    if (!store.session.puzzle || store.session.puzzle.done) return;
    const g = store.session.puzzle.g;
    if (g.turn() !== "w" || g.game_over()) return;
    let from = null, to = null;
    // on the stored line the stored move is always valid here
    const stored = SCRIPTED_CATS[store.session.puzzle.p.cat]
      ? puzzleScript(store.session.puzzle.p)[store.session.puzzle.stage]
      : store.session.puzzle.p.solution[store.session.puzzle.stage * 2];
    if (stored) {
      const probe = new Chess(g.fen());
      const mv = probe.move(stored);
      if (mv) { from = mv.from; to = mv.to; }
    }
    if (!from) {
      // off the stored line — search for any move that still forces mate
      const remaining = (PUZZLE_MOVES[store.session.puzzle.p.cat] || 1) - store.session.puzzle.stage;
      for (const m of g.moves({ verbose: true })) {
        g.move(m);
        const ok = g.in_checkmate() ||
          (remaining > 1 && !g.game_over() && blackForcedLost(g, remaining - 1));
        g.undo();
        if (ok) { from = m.from; to = m.to; break; }
      }
    }
    if (from) {
      store.session.puzzle.helpArrow = { from, to };
      store.session.puzzle.usedAnswer = true;
      markMissed(store.session.puzzle.p.id); // relying on the answer counts as a miss
      sync();
    }
  }

  function puzzleSolved() {
    store.session.puzzle.done = true;
    store.game.selection = null;
    Audio2.playWin();
    // a clean first-try solve retires the puzzle from review; a shaky one keeps it
    if (store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer) clearMissed(store.session.puzzle.p.id);
    if (!store.session.puzzleState.solved[store.session.puzzle.p.id]) {
      store.session.puzzleState.solved[store.session.puzzle.p.id] = true;
      savePuzzleState();
      checkNewAchievements();
    }
    const verb = store.session.puzzle.p.cat === "op" ? t("pz.doneOp") :
      store.session.puzzle.p.cat === "def" ? t("pz.doneDef") :
      store.session.puzzle.p.cat === "draw" ? t("pz.doneDraw") :
      store.session.puzzle.p.cat === "real" ? t("pz.doneReal") :
      store.session.puzzle.p.cat === "win" || store.session.puzzle.p.cat === "tac" ? t("pz.doneWin") : t("pz.doneMate");
    toast("✅ " + verb + " · " + puzzleName(store.session.puzzle.p));
    sync();
  }

  /**
   * Carry a finished opening drill into a real game.
   *
   * Rehearsing six plies and then being handed the next drill is where the
   * opening trainer stopped being about openings: a line is only worth
   * knowing for the game it leads to, and that game was never reachable from
   * here. This hands the drilled position to the engine with the moves
   * intact, from the White side the player just rehearsed.
   */
  function playOnFromPuzzle() {
    if (!store.session.puzzle || !store.session.puzzle.done || store.session.puzzle.p.cat !== "op") return;
    const line = store.session.puzzle.g.pgn();
    const name = puzzleName(store.session.puzzle.p);
    if (!line.trim()) return;
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    stopPuzzles();
    store.session.mode = "ai";
    store.session.humanColor = "w"; // every opening drill is played from White's side
    store.game.flipped = false;
    store.game.flagFall = null;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
    store.session.analysis = null;
    store.game.recordedId = null;
    gameReset();
    gameLoadPgn(line, { sloppy: true });
    store.game.selection = null;
    store.session.hintMove = null;
    store.game.viewIndex = sanHistory().length;
    resetClocks();
    saveSettings();
    saveGame();
    sync();
    toast(tf("pz.playOn", [name]));
    maybeEngineTurn();
  }

  function nextPuzzle() {
    if (!store.session.puzzle) return;
    let list = puzzlesInCat(store.session.puzzle.cat);
    if (store.session.puzzle.cat === "review") {
      // a clean re-solve shrinks the queue; graduate to m1 when it empties
      if (!list.length) {
        toast(t("pz.reviewEmptyDone"));
        store.session.puzzleState.cat = "m1"; savePuzzleState();
        startPuzzles();
        return;
      }
      startPuzzleAt("review", store.session.puzzle.idx % list.length);
      return;
    }
    // prefer the next unsolved one, wrapping around
    for (let d = 1; d <= list.length; d++) {
      const i = (store.session.puzzle.idx + d) % list.length;
      if (!store.session.puzzleState.solved[list[i].id]) { startPuzzleAt(store.session.puzzle.cat, i); return; }
    }
    startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx + 1);
  }

  function syncPuzzleUI() {
    const sec = document.getElementById("sec-puzzle");
    if (!sec) return;
    sec.hidden = store.session.mode !== "puzzle";
    if (store.session.mode !== "puzzle") return;
    // an empty difficulty filter leaves no puzzle loaded — keep the filter row
    // usable so the user can pick their way back out
    if (!store.session.puzzle) {
      document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.tier === store.session.puzzleTierFilter);
        b.disabled = false; // no puzzle loaded means we are not in review
      });
      document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.cat === store.session.puzzleState.cat);
      });
      const emptyProg = document.getElementById("puzzle-progress");
      if (emptyProg) emptyProg.textContent = tf("pz.solvedCount",
        [ALL_PUZZLES.filter((p) => store.session.puzzleState.solved[p.id]).length, ALL_PUZZLES.length]);
      const emptyTask = document.getElementById("puzzle-task");
      if (emptyTask) emptyTask.textContent = t("pz.noneInTier");
      const emptyList = document.getElementById("puzzle-list");
      if (emptyList) emptyList.replaceChildren();
      return;
    }
    const list = puzzlesInCat(store.session.puzzle.cat);
    const solvedAll = ALL_PUZZLES.filter((p) => store.session.puzzleState.solved[p.id]).length;
    const missedCount = puzzlesInCat("review").length;
    const prog = document.getElementById("puzzle-progress");
    if (prog) {
      prog.textContent = store.session.puzzle.cat === "review"
        ? tf("pz.missedCount", [missedCount])
        : tf("pz.solvedCount", [solvedAll, ALL_PUZZLES.length]);
    }
    // the tier row does nothing in the review queue — grey it out rather than
    // leaving buttons that look live but change nothing
    const inReview = store.session.puzzle.cat === "review";
    document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
      b.classList.toggle("active", !inReview && b.dataset.tier === store.session.puzzleTierFilter);
      b.disabled = inReview;
    });
    const tierRow = document.getElementById("row-puzzle-tier");
    if (tierRow) tierRow.classList.toggle("muted-row", inReview);
    document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === store.session.puzzle.cat);
      // surface how many are queued for review right on the tab
      if (b.dataset.cat === "review") b.textContent = t("pz.cat.review") + (missedCount ? "·" + missedCount : "");
    });
    const task = document.getElementById("puzzle-task");
    if (task) {
      task.textContent = store.session.puzzle.done
        ? t("pz.solvedNext")
        : tf("pz.nth", [store.session.puzzle.idx + 1]) + " · " + puzzleGoalText();
    }
    // opening drills are rote memorisation without the "why" — show the idea
    const ideaEl = document.getElementById("puzzle-idea");
    if (ideaEl) {
      const idea = puzzleIdea(store.session.puzzle.p);
      ideaEl.hidden = !idea;
      ideaEl.textContent = idea ? t("pz.idea") + " · " + idea : "";
    }
    // a finished opening line offers the game it was drilled for; that is the
    // reward, so it takes the primary emphasis from "next puzzle"
    const canPlayOn = !!store.session.puzzle.done && store.session.puzzle.p.cat === "op";
    const playOn = document.getElementById("puzzle-playon");
    if (playOn) {
      playOn.hidden = !canPlayOn;
      playOn.classList.toggle("primary", canPlayOn);
    }
    const next = document.getElementById("puzzle-next");
    if (next) next.classList.toggle("primary", store.session.puzzle.done && !canPlayOn);
    const listEl = document.getElementById("puzzle-list");
    if (listEl) {
      listEl.replaceChildren();
      list.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === store.session.puzzle.idx ? " current" : "");
        b.dataset.i = String(i);
        // opening drills carry their length: "how much is there to remember"
        // is the first thing anyone wants to know before starting one
        const len = p.cat === "op" ? "  " + Math.ceil(p.line.length / 2) + t("pz.moveUnit") : "";
        b.textContent = (store.session.puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + puzzleName(p) + len;
        listEl.appendChild(b);
      });
    }
  }

  // --- review analysis: full-strength eval per position → curve + move tags ---

  /** White-perspective centipawns; mates mapped to ±(10000 − plies·10). */
  function evalScalar(e) {
    if (!e) return null;
    const sign = e.turn === "w" ? 1 : -1;
    if (e.mate != null) {
      const mag = 10000 - Math.min(Math.abs(e.mate), 50) * 10;
      return e.mate > 0 ? sign * mag : -sign * mag;
    }
    if (e.cp != null) return sign * e.cp;
    return null;
  }

  /**
   * The analysis, if it still belongs to the game on the board.
   *
   * Memoised for one sync-and-paint cycle, because the check is not cheap and
   * this sits in the render path. `analysis.sig` is a PGN, and on an 80-move
   * game `game.pgn()` costs ~3.3ms — a fifth of a 60fps frame. 1.22 put the
   * best-move arrow in the board model, which is rebuilt on EVERY draw()
   * including every animation frame, so a 12-frame replay slide was spending
   * ~40ms serialising the same PGN twelve times.
   *
   * The memo is exact rather than merely fast: it is dropped whenever the game
   * commits, so a frame can never be looking at an analysis of a different
   * position. Up to 1.25 it was dropped at the top of sync() instead, which
   * was correct only for as long as "sync() runs after every state change"
   * stayed true — an invariant held by hand at 65 call sites.
   */
  function analysisFor() {
    // Keyed on the analysis object too, so replacing it invalidates the memo
    // without every one of the seven assignment sites having to remember. The
    // game commit covers the other direction: the game changing underneath an
    // unchanged analysis.
    if (store.session._analysisTick && store.session._analysisTick.a === store.session.analysis) return store.session._analysisTick.v;
    store.session._analysisTick = { a: store.session.analysis, v: store.session.analysis && store.session.analysis.sig === game.pgn() ? store.session.analysis : null };
    return store.session._analysisTick.v;
  }

  /**
   * Is the app the window the player is actually looking at?
   *
   * The lifecycle events were already wired (1.2 uses deactivate to flush the
   * save); this just remembers the answer, so work that finishes off-screen
   * can say so instead of dropping a toast nobody sees. Declared with the rest
   * of the module state above — the clock reads it from `clockRunning`, far
   * earlier in the file, and a `let` down here would sit in the temporal dead
   * zone for everything before it.
   */

  async function analyzeGame(movetime) {
    if (store.session.analyzing || !ChessEngine) return;
    const perMove = movetime || 120;
    const h = sanHistory();
    if (!h.length) { toast(t("msg.analysis.noGame"), "fix"); return; }
    const sig = game.pgn();
    const g = baseGame();
    const fens = [g.fen()];
    for (const san of h) { g.move(san); fens.push(g.fen()); }
    store.session.analyzing = true;
    store.session.analyzeAbort = false;
    store.session.analyzeProgress = "0/" + fens.length;
    setAnalyzeUI();
    const scalars = new Array(fens.length).fill(null);
    const pvs = new Array(fens.length).fill(null);
    // the engine's own choice at each position, UCI — this is what the board
    // draws an arrow for when the move actually played was a mistake
    const bests = new Array(fens.length).fill(null);
    // Repetition count per position as the replay walks forward, so the
    // terminal test below can tell fivefold (art. 9.6, the game is over) from
    // threefold (art. 9.2, a player may claim and the game otherwise goes on).
    const repSeen = new Map();
    for (let i = 0; i < fens.length; i++) {
      if (store.session.analyzeAbort) {
        store.session.analyzing = false; store.session.analyzeAbort = false; store.session.analyzeProgress = "";
        // keep whatever was already measured — a partial curve still helps
        if (i > 1) {
          store.session.analysis = { sig, scalars, tags: h.map(() => null), pvs, bests };
          toast(t("msg.analysis.keptPrefix") + (i - 1) + t("msg.analysis.keptSuffix"));
        } else toast(t("msg.analysis.stopped"));
        sync();
        return;
      }
      if (game.pgn() !== sig) { store.session.analyzing = false; store.session.analyzeProgress = ""; setAnalyzeUI(); return; }
      const probe = new Chess(fens[i]);
      const repKey = Fide.positionKey(fens[i], probe);
      const reps = (repSeen.get(repKey) || 0) + 1;
      repSeen.set(repKey, reps);
      // NOT probe.game_over(): chess.js ends the game at threefold and at the
      // 50-move mark, both of which are only claimable under FIDE and which
      // this app plays through everywhere else. Scoring those plies a flat 0
      // dropped the curve to the axis mid-game and mis-tagged every move after
      // it — the accuracy figure included. Same rule as naturalGameOver().
      if (probe.in_checkmate()) scalars[i] = probe.turn() === "w" ? -10000 : 10000;
      else if (Fide.positionFinished(probe, reps)) scalars[i] = 0;
      else {
        let e = null;
        try { e = await ChessEngine.analyze(fens[i], perMove); } catch (_) {}
        if (game.pgn() !== sig) { store.session.analyzing = false; store.session.analyzeProgress = ""; setAnalyzeUI(); return; }
        scalars[i] = evalScalar(e);
        if (e && typeof e.best === "string" && e.best.length >= 4) bests[i] = e.best;
        // principal variation, converted to SAN for display
        if (e && e.pv && e.pv.length) {
          const pvProbe = new Chess(fens[i]);
          const sans = [];
          for (const uci of e.pv.slice(0, 5)) {
            const m = pvProbe.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
            if (!m) break;
            sans.push(m.san);
          }
          if (sans.length) pvs[i] = sans.join(" ");
        }
      }
      store.session.analyzeProgress = (i + 1) + "/" + fens.length;
      setAnalyzeUI();
    }
    // centipawn loss from the mover's perspective — the mover of ply i is the
    // side to move in fens[i] (FEN-start games may begin with black)
    const tags = h.map((_, i) => {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) return null;
      const moverIsWhite = fens[i].split(" ")[1] === "w";
      const loss = moverIsWhite ? a - b : b - a;
      // one source for the thresholds: the move list, the curve markers and
      // the best-move arrow all read the same call. This used to be a fourth
      // hand-written copy of 300/100/50 sitting next to review.js's constants.
      return Review.markFor(loss);
    });
    store.session.analysis = { sig, scalars, tags, pvs, bests, acc: accuracyFrom(fens, scalars) };
    store.session.analyzing = false;
    store.session.analyzeProgress = "";
    recordAccuracy();
    sync();
    const bad = tags.filter((tag) => tag === "?" || tag === "??").length;
    const done = bad ? t("msg.analysis.donePrefix") + bad + t("msg.analysis.doneSuffix") : t("msg.analysis.doneClean");
    toast(done);
    // A deep pass is 400ms a ply — over half a minute on a long game, which is
    // long enough that people go and do something else. A toast behind another
    // window is a message that was never delivered.
    if (!store.ui.appForeground) Host.notify({ title: t("ntf.analysisDone"), body: done });
  }

  /**
   * Per-side average centipawn loss and an accuracy score derived from it.
   *
   * The arithmetic is review.js's — the clamp, the mean and the exponential
   * lived here as well until 1.25, identical in every respect except how each
   * copy decided whose move a ply was. review.js's own header says three
   * copies are how they start to drift; two was not better. 缺陷 6.
   *
   * What stays here is only the part that is genuinely this caller's: the side
   * rule. The analyser already holds the FEN of every position, so it reads
   * the side to move off that instead of deriving it from the first mover and
   * the parity of the ply. Both rules must give the same answer, and
   * scripts/test-chess.mjs now checks that on a real game.
   */
  function accuracyFrom(fens, scalars) {
    const loss = Review.lossesBySide(scalars, (i) => (fens[i].split(" ")[1] === "w" ? "w" : "b"));
    const w = Review.accuracyOf(loss.w);
    const b = Review.accuracyOf(loss.b);
    return { w: w.acc, b: b.acc, wAcpl: w.acpl, bAcpl: b.acpl };
  }

  /**
   * The judgement colours, from the same tokens the stylesheet reads.
   *
   * The eval curve painted `?` and `??` markers as two hard-coded hexes while
   * the move list's `?!` `?` `??` annotations used two *different* hard-coded
   * hexes plus --danger — three copies of one idea, none of which any theme
   * could reach. 缺陷 8. Now there is one scale (--judge-soft / -mid / -bad),
   * each board palette answers for it, and the canvas asks the document for
   * the same value the CSS uses. Read per call: a theme change is exactly when
   * these move, and this runs once per repaint of a chart, not per frame.
   */
  function judgeColours() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      soft: pick("--judge-soft", "#c9b458"),
      mid: pick("--judge-mid", "#e0a03c"),
      bad: pick("--judge-bad", "#e05252"),
    };
  }

  /**
   * Attach the human's accuracy to the stats record of the game just analysed.
   *
   * Matched by the record's stored `sig`, never by "the most recent record":
   * analysing an imported or replayed game would otherwise stamp its accuracy
   * onto an unrelated game the user really did play.
   */
  function recordAccuracy() {
    if (store.session.mode !== "ai" || !store.session.analysis || !store.session.analysis.acc) return;
    if (!(naturalGameOver() || ruleTerminated())) return;
    const mine = store.session.humanColor === "w" ? store.session.analysis.acc.w : store.session.analysis.acc.b;
    const acpl = store.session.humanColor === "w" ? store.session.analysis.acc.wAcpl : store.session.analysis.acc.bAcpl;
    if (mine == null) return;
    const s = loadStats();
    // By id. Until 1.25 the key was the PGN, so two games played the same way
    // were the same record, and this had to walk to the LAST unannotated match
    // and hope — a heuristic covering for a missing identity. With an id there
    // is nothing to guess: either this game was filed, or it was not.
    const rec = store.game.recordedId
      ? s.games.find((g) => g.id === store.game.recordedId) : null;
    if (!rec) return;
    rec.acc = mine;
    rec.acpl = acpl;
    Persist.setJson("stats", s);
    renderStats();
  }

  function setAnalyzeUI() {
    const btn = document.getElementById("an-run");
    // while a run is in flight the primary button becomes the stop control —
    // a deep pass over a long game is a minute of engine time to be stuck in
    if (btn) {
      btn.disabled = !store.session.analyzing && !sanHistory().length;
      btn.textContent = store.session.analyzing ? t("act.stop") + " " + store.session.analyzeProgress : t("act.analyze");
      btn.title = t(store.session.analyzing ? "tipRun.stop" : "tipRun.analyze");
    }
    const deep = document.getElementById("an-deep");
    if (deep) deep.disabled = store.session.analyzing || !sanHistory().length;
    const wrap = document.getElementById("eval-wrap");
    if (wrap) {
      wrap.hidden = !analysisFor();
      if (!wrap.hidden) { drawEvalCurve(); drawEvalBar(); }
    }
    const pvEl = document.getElementById("pv-line");
    if (pvEl) {
      const a = analysisFor();
      const pv = a && a.pvs ? a.pvs[store.game.viewIndex] : null;
      pvEl.hidden = !pv;
      pvEl.textContent = pv ? t("an.pv") + " · " + pv : "";
    }
    renderReview();
    const accEl = document.getElementById("acc-line");
    if (accEl) {
      const a = analysisFor();
      const acc = a && a.acc;
      const has = acc && (acc.w != null || acc.b != null);
      accEl.hidden = !has;
      if (has) {
        const part = (side, name) =>
          acc[side] == null ? name + " —"
            : name + " " + acc[side] + "% (" + t("acc.loss") + " " + acc[side === "w" ? "wAcpl" : "bAcpl"] + ")";
        accEl.textContent = t("acc.label") + " · " + part("w", t("vs.white")) + " · " + part("b", t("vs.black"));
      }
    }
  }

  /**
   * The post-game report: what the analysis actually says, in words.
   *
   * The eval curve already shows *where* things went wrong; this answers the
   * questions a learner asks next — how well did I play, how many of those
   * marks were mine, and which single move decided the game. The turning-point
   * row jumps the replay to that move, so the answer is one click from the
   * position that caused it.
   */
  function renderReview() {
    const el = document.getElementById("review-body");
    if (!el) return;
    const R = ChessReview;
    const a = analysisFor();
    const sum = R && a ? R.summarize(a.scalars, sanHistory(), startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w") : null;
    el.hidden = !sum;
    el.replaceChildren();
    if (!sum) return;

    const line = (cls) => { const d = document.createElement("div"); d.className = cls; el.appendChild(d); return d; };
    const head = line("review-h");
    head.textContent = t("rv.title");
    const opening = openingFor(sanHistory().length);
    if (opening) {
      const o = line("review-row muted");
      o.textContent = t("rv.opening") + " · " + opening[0] + " " + openingName(opening[1]);
    }
    for (const side of ["w", "b"]) {
      if (sum.acc[side] == null) continue;
      const c = sum.counts[side];
      const row = line("review-row");
      const who = document.createElement("span");
      who.className = "review-k";
      // the full word, not the one-letter clock label — "W Accuracy 64%" reads
      // like a typo in a report meant to be read as prose
      who.textContent = t(side === "w" ? "side.white" : "side.black");
      const val = document.createElement("span");
      val.className = "review-v num";
      val.textContent = tf("rv.sideLine", [sum.acc[side], sum.acpl[side], c.inaccuracy, c.mistake, c.blunder]);
      row.append(who, val);
      const vk = R.verdictKey(sum, side);
      if (vk) {
        const note = document.createElement("div");
        note.className = "review-note muted";
        note.textContent = t(vk);
        row.appendChild(note);
      }
    }
    if (sum.worst) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "review-jump";
      btn.textContent = tf("rv.turningPoint",
        [sum.worst.moveNo, t(sum.worst.side === "w" ? "side.white" : "side.black"), sum.worst.san,
         (sum.worst.loss / 100).toFixed(1)]);
      btn.title = t("rv.jumpTip");
      // land on the position *after* the move, so the damage is on the board
      btn.onclick = () => setViewIndex(sum.worst.ply + 1);
      el.appendChild(btn);
    }
  }

  /**
   * The eval bar for the position the board is standing on.
   *
   * Pure rendering of `analysis.scalars[viewIndex]` — no engine call, which is
   * the whole reason this is review-only. During a live game `analysisFor()`
   * is null (the signature is the PGN, and that changes every move), so the
   * bar hides itself without needing a mode check, and there is no way for it
   * to become an answer key while somebody is still playing.
   */
  function drawEvalBar() {
    const row = document.getElementById("eval-bar-row");
    const bar = document.getElementById("eval-bar");
    const fill = document.getElementById("eval-bar-fill");
    const text = document.getElementById("eval-bar-text");
    if (!row || !bar || !fill || !text) return;
    const a = analysisFor();
    if (!a) { row.hidden = true; return; }
    row.hidden = false;
    const cp = a.scalars[store.game.viewIndex];
    const frac = Review.evalBar(cp);
    if (frac == null) {
      // measured and level is not the same thing as never measured
      bar.classList.add("is-unmeasured");
      fill.style.width = "50%";
      text.textContent = t("rv.evalNone");
      return;
    }
    bar.classList.remove("is-unmeasured");
    fill.style.width = (frac * 100).toFixed(1) + "%";
    // a forced mate has no meaningful pawn count — say so instead of "+100.0"
    text.textContent = Math.abs(cp) >= 5000
      ? (cp > 0 ? "+#" : "−#")
      : (cp > 0 ? "+" : cp < 0 ? "−" : "") + (Math.abs(cp) / 100).toFixed(1);
  }

  function drawEvalCurve() {
    const cv = document.getElementById("eval-curve");
    const a = analysisFor();
    if (!cv || !a) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    const H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const n = a.scalars.length - 1;
    const CAP = 500; // ±5 pawns fills the curve height
    const x = (i) => (n ? (i / n) * (W - 8 * dpr) + 4 * dpr : W / 2);
    const y = (s) => H / 2 - (Math.max(-CAP, Math.min(CAP, s)) / CAP) * (H / 2 - 4 * dpr);
    const css = getComputedStyle(document.documentElement);
    const cMuted = css.getPropertyValue("--muted").trim() || "#999";
    const cAccent = css.getPropertyValue("--accent").trim() || "#e8c39e";
    const JC = judgeColours();
    // midline
    ctx.strokeStyle = cMuted;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, H / 2); ctx.lineTo(W, H / 2); ctx.stroke();
    ctx.globalAlpha = 1;
    // eval line (skip null gaps)
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const s = a.scalars[i];
      if (s == null) { pen = false; continue; }
      if (pen) ctx.lineTo(x(i), y(s));
      else { ctx.moveTo(x(i), y(s)); pen = true; }
    }
    ctx.stroke();
    // blunder markers at the position after the tagged move
    for (let i = 0; i < n; i++) {
      const tagCh = a.tags[i];
      if (tagCh !== "?" && tagCh !== "??") continue;
      const s = a.scalars[i + 1];
      if (s == null) continue;
      ctx.fillStyle = tagCh === "??" ? JC.bad : JC.mid;
      ctx.beginPath();
      ctx.arc(x(i + 1), y(s), 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    // current view marker
    ctx.strokeStyle = cAccent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(x(store.game.viewIndex), 2 * dpr); ctx.lineTo(x(store.game.viewIndex), H - 2 * dpr); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- stats (AI-mode finished games) ---
  /**
   * A record's identity, issued once and never derived from its content.
   *
   * Up to 1.25 the primary key was `game.pgn()` — with a "#resigned"-style
   * suffix glued on for app-level endings, so one string was doing three jobs
   * at once: identity, the playable movetext, and how the game finished. Two
   * games played the same way collided, which for a short mate is not a remote
   * possibility, and recordAccuracy() had to defend itself by walking to the
   * *last* unannotated match — a heuristic standing in for an id. 缺陷 13.
   *
   * Wall-clock plus a counter: two games can finish in the same millisecond
   * (importing a history record and analysing it, say), and an id that is only
   * probably unique is the bug this replaces.
   */
  let _recSeq = 0;
  function newRecordId() { return Date.now().toString(36) + "-" + (_recSeq++).toString(36); }

  function loadStats() {
    try {
      const s = JSON.parse(Persist.get("stats") || "null");
      if (s && s.v === 2 && Array.isArray(s.games)) return s;
      // v1 → v2: split the overloaded `sig` into the three things it was.
      // Reading it apart is safe — unlike an id remap, this derives nothing
      // about *which* game a record is, it only unpacks what was already
      // stored in it.
      if (s && s.v === 1 && Array.isArray(s.games)) {
        return {
          v: 2,
          games: s.games.map((g, i) => {
            const sig = String(g.sig || "");
            const m = /#([a-zA-Z]+)$/.exec(sig);
            return Object.assign({}, g, {
              id: g.id || ("v1-" + (g.t || 0).toString(36) + "-" + i.toString(36)),
              pgn: g.pgn != null ? g.pgn : sig.replace(/#[a-zA-Z]+$/, ""),
              ending: g.ending != null ? g.ending : (m ? m[1] : ""),
              sig: undefined,
            });
          }),
        };
      }
    } catch (_) {}
    return { v: 2, games: [] };
  }

  /** Record an AI game the moment it finishes on a live move (not on import). */
  function recordGameIfOver() {
    if (store.session.mode !== "ai" || !naturalGameOver()) return;
    if (store.game.recordedId) return; // this game is already filed
    let result = "draw";
    if (game.in_checkmate()) result = game.turn() === store.session.humanColor ? "loss" : "win";
    const s = loadStats();
    // the id ties the record to the exact game it came from, so a later
    // analysis can only annotate the game it actually measured
    const id = newRecordId();
    store.game.recordedId = id;
    s.games.push({ id, t: Date.now(), diff: store.session.difficulty, color: store.session.humanColor, result, moves: sanHistory().length, pgn: game.pgn(), ending: "" });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    Persist.setJson("stats", s);
    renderStats();
    checkNewAchievements();
    offerReview();
  }

  /**
   * Nudge towards the post-game report once a game is actually over.
   *
   * The review is the most useful thing the app can tell a learner, and until
   * 1.7 it was only reachable by knowing to press "分析" afterwards — so the
   * feature shipped in 1.6 and most players never saw it. Only a hint: running
   * the engine over a whole game is a real wait, so it stays opt-in.
   */
  function offerReview() {
    if (store.session.mode !== "ai" || !ChessEngine || store.session.analyzing) return;
    if (analysisFor()) return; // already analysed — the report is on screen
    if (sanHistory().length < 6) return; // too short to say anything useful
    setTimeout(() => {
      if (store.session.mode === "ai" && !store.session.analyzing && !analysisFor() && appGameOver()) toast(t("rv.offer"));
    }, 2200);
  }

  function renderStats() {
    const el = document.getElementById("stats-body");
    if (!el) return;
    const s = loadStats();
    const agg = {};
    for (const g of s.games) {
      const k = DIFF_NAMES[g.diff] ? g.diff : "normal";
      const a = (agg[k] = agg[k] || { win: 0, loss: 0, draw: 0 });
      a[g.result] = (a[g.result] || 0) + 1;
    }
    // accuracy of the most recent analysed games (only games the user analysed
    // carry it, so this stays empty until they use 分析/精析)
    const withAcc = s.games.filter((g) => typeof g.acc === "number");
    el.replaceChildren();
    let total = 0;
    for (const k of DIFF_IDS) {
      const a = agg[k];
      if (!a) continue;
      total += a.win + a.loss + a.draw;
      const row = document.createElement("div");
      row.className = "stat-row";
      const name = document.createElement("span");
      name.className = "stat-k";
      name.textContent = DIFF_NAMES[k];
      const val = document.createElement("span");
      val.className = "stat-v num";
      val.textContent = tf("stats.wld", [a.win, a.loss, a.draw]);
      row.append(name, val);
      el.appendChild(row);
    }
    if (withAcc.length) {
      const recent = withAcc.slice(-10);
      const avg = Math.round(recent.reduce((n, g) => n + g.acc, 0) / recent.length);
      const row = document.createElement("div");
      row.className = "stat-row";
      const name = document.createElement("span");
      name.className = "stat-k";
      name.textContent = t("stats.recentAcc") + recent.length + t("stats.recentAccSuffix");
      const val = document.createElement("span");
      val.className = "stat-v num";
      val.textContent = avg + "% · " + t("stats.latest") + recent[recent.length - 1].acc + "%";
      row.append(name, val);
      el.appendChild(row);
    }
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = total
      ? t("stats.games") + total + t("stats.gamesSuffix") + " · " + t("stats.hint") +
        (withAcc.length ? t("stats.hintAcc") : t("stats.hintNoAcc"))
      : t("stats.emptyHint");
    el.appendChild(hint);
    const rec = recommendation();
    if (rec) {
      const line = document.createElement("div");
      line.className = "stat-hint stat-rec";
      line.textContent = rec;
      el.appendChild(line);
    }
    const clearBtn = document.getElementById("stats-clear");
    if (clearBtn) clearBtn.disabled = !total;
    renderHistory();
  }

  // --- game history ---
  //
  // Every finished engine game has been stored with its full movetext since
  // 1.4 (the `sig` field, which also ties an analysis to the game it measured),
  // and up to 500 of them are kept — but until 1.8 there was no way to open
  // one. The whole feature is therefore a reader over data that was already
  // there: pick a game, put it back on the board, and every existing tool
  // (分析 / 回顾报告 / 导出 PGN / 存档槽) works on it unchanged.

  /** how many games the sidebar shows before deferring to the full list */
  const HIST_PREVIEW = 5;

  function historyGames() {
    return loadStats().games.filter((g) => g && typeof g.pgn === "string" && g.pgn.trim()).reverse();
  }

  /**
   * The playable PGN of a record.
   *
   * Its own field since 1.25. It used to be `sig` with a "#resigned"-style
   * marker stripped off the end — one string carrying the identity, the
   * movetext and the ending at once, and only safe because a checkmate PGN
   * ends in a bare "#" so the regex could not eat a move. 缺陷 13.
   */
  function historyPgn(rec) {
    return String(rec.pgn || "");
  }

  /** the app-level ending marker of a record, or "" for mate/stalemate */
  function historyEnding(rec) {
    return String(rec.ending || "");
  }

  /** "today 14:03" for recent games, a plain date for older ones */
  function historyWhen(ts) {
    if (!ts) return "";
    const d = new Date(ts);
    const now = new Date();
    const midnight = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
    const clock2 = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    if (midnight(d) === midnight(now)) return t("hist.today") + " " + clock2;
    if (midnight(d) === midnight(yesterday)) return t("hist.yesterday") + " " + clock2;
    return d.toLocaleDateString();
  }

  /** everything is localised at render time, so a language switch relabels it */
  function historyLabel(rec) {
    const res = t(rec.result === "win" ? "hist.win" : rec.result === "loss" ? "hist.loss" : "hist.draw");
    return [res, diffName(rec.diff), t(rec.color === "b" ? "hist.black" : "hist.white")].join(" · ");
  }

  function historySub(rec) {
    const parts = [historyWhen(rec.t)];
    if (rec.moves) parts.push(moveCount(Math.ceil(rec.moves / 2)));
    if (typeof rec.acc === "number") parts.push(tf("hist.acc", [rec.acc]));
    return parts.filter(Boolean).join(" · ");
  }

  function historyRow(rec, i, withPgn) {
    const row = document.createElement("div");
    row.className = "hist-row";
    const load = document.createElement("button");
    load.type = "button";
    load.className = "pick-item";
    load.dataset.hist = String(i);
    load.textContent = historyLabel(rec);
    const sub = document.createElement("span");
    sub.className = "pick-sub";
    sub.textContent = historySub(rec);
    load.appendChild(sub);
    row.appendChild(load);
    if (withPgn) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "tool-btn";
      copy.dataset.histPgn = String(i);
      copy.textContent = t("hist.pgn");
      row.appendChild(copy);
    }
    return row;
  }

  /**
   * Which slice of the history the modal is showing.
   *
   * Kept out of `histCache`: the row buttons carry their index into the full
   * list, and re-indexing a filtered array would make "load this game" load a
   * different one the moment a filter was on.
   */
  function histMatches(rec) {
    if (store.ui.histFilter.result !== "all" && rec.result !== store.ui.histFilter.result) return false;
    if (store.ui.histFilter.color !== "all") {
      const col = rec.color === "b" ? "b" : "w";
      if (col !== store.ui.histFilter.color) return false;
    }
    return true;
  }

  function renderHistory() {
    store.session.histCache = historyGames();
    const body = document.getElementById("hist-body");
    if (body) {
      body.replaceChildren();
      if (!store.session.histCache.length) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = t("hist.empty");
        body.appendChild(p);
      } else {
        store.session.histCache.slice(0, HIST_PREVIEW).forEach((rec, i) => body.appendChild(historyRow(rec, i, false)));
      }
    }
    const btn = document.getElementById("hist-open");
    if (btn) {
      btn.hidden = !store.session.histCache.length;
      btn.textContent = tf("hist.all", [store.session.histCache.length]);
    }
    const list = document.getElementById("hist-list");
    if (list) {
      // Up to 500 rows, re-rendered whenever a filter changes or a game ends.
      // Keyed by the record id, so flipping "wins only" on and off keeps the
      // rows that were already on screen — and with them the scroll position
      // and any focus inside the list. See keyed.js.
      const rows = store.session.histCache
        .map((rec, i) => ({ rec, i }))
        .filter(({ rec }) => histMatches(rec));
      const shown = rows.length;
      reconcile(list, rows,
        ({ rec, i }) => rec.id || ("i" + i),
        ({ rec }) => [rec.result, rec.diff, rec.color, rec.moves, rec.acc, rec.t].join("|"),
        ({ rec, i }) => historyRow(rec, i, true));
      if (!shown) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = t("hist.noneMatch");
        list.appendChild(p);
      }
      const count = document.getElementById("hist-count");
      if (count) {
        const filtered = store.ui.histFilter.result !== "all" || store.ui.histFilter.color !== "all";
        count.hidden = !filtered;
        count.textContent = tf("hist.showing", [shown, store.session.histCache.length]);
      }
    }
    document.querySelectorAll("#hist-result-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.hres === store.ui.histFilter.result);
    });
    document.querySelectorAll("#hist-color-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.hcol === store.ui.histFilter.color);
    });
  }

  function openHistory() {
    renderHistory();
    Dlg.open(document.getElementById("hist-modal"));
  }
  function closeHistory() {
    Dlg.close(document.getElementById("hist-modal"));
  }

  /**
   * Put back the ending the moves alone cannot express.
   *
   * A resignation or an agreed draw leaves a position that is not over, and
   * the import path clears every terminal flag — so without this, opening a
   * resigned game from the history would hand the position to the engine and
   * quietly carry on playing it.
   */
  function restoreEnding(rec) {
    const end = historyEnding(rec);
    if (!end) return;
    if (end === "resigned") {
      store.game.resigned = rec.color; // in an engine game only the human can resign
    } else if (end === "drawAgreed") {
      store.game.drawAgreed = true;
    } else if (end === "claimed") {
      // the record does not say which rule was claimed; the halfmove clock does
      store.game.drawClaimed = Number(game.fen().split(" ")[4]) >= 100 ? "fifty" : "threefold";
    } else if (end === "flag") {
      const other = rec.color === "w" ? "b" : "w";
      store.game.flagFall = rec.result === "win" ? other : rec.result === "loss" ? rec.color
        : sideHasMatingMaterial(other) ? other : rec.color;
      // the record does not keep the clocks; zeroing the side that ran out is
      // enough to stop a full clock sitting next to "flag fall". With the time
      // control since switched off there is no clock to correct.
      if (store.game.clock) { store.game.clock[store.game.flagFall] = 0; renderClocks(); }
      syncClockTimer();
    }
  }

  async function loadFromHistory(i) {
    const rec = store.session.histCache[i];
    if (!rec) return;
    closeHistory();
    const ok = await importPgnText(historyPgn(rec), t("hist.title"),
      { msg: t("dlg.loadHist"), title: t("dlg.loadHistTitle"), ok: t("dlg.loadHistOk") });
    if (!ok) return;
    // Restore the context the game was played in. Orientation and difficulty
    // are what the board and the review report mean by "you", and pinning the
    // record id lets a fresh 分析 file its accuracy back onto the very game it
    // just measured.
    store.session.mode = "ai";
    if (DIFF_NAMES[rec.diff]) store.session.difficulty = rec.diff;
    if (rec.color === "w" || rec.color === "b") { store.session.humanColor = rec.color; store.game.flipped = store.session.humanColor === "b"; }
    store.game.recordedId = rec.id;
    restoreEnding(rec);
    // the import ends by offering the position to the engine; a game that ended
    // in resignation is not over by its moves, so call off that search now that
    // the ending is back in place
    invalidateEngine();
    store.session.analysis = null;
    saveSettings();
    saveGame();
    sync();
    toast(tf("hist.loaded", [historyLabel(rec)]));
  }

  /**
   * One sentence saying what to do next, from what the player has actually
   * done. The app has four modes, 38 lessons and 145 puzzles and, until 1.7,
   * nothing anywhere that answered "so what should I play now?".
   *
   * Deliberately conservative: it only speaks when there is enough evidence
   * (three games at one level, or a clear score), and it suggests rather than
   * changes anything.
   * @returns {string|null}
   */
  function recommendation() {
    const st = loadStats();
    const cur = st.games.filter((g) => g.diff === store.session.difficulty);
    const recent = cur.slice(-6);
    const idx = DIFF_IDS.indexOf(store.session.difficulty);
    // an unfinished course outranks any difficulty advice
    const done = LESSONS.filter((l) => store.session.learnState.done[l.id]).length;
    if (done > 0 && done < LESSONS.length && st.games.length >= 2) {
      return tf("rec.lessons", [done, LESSONS.length]);
    }
    if (recent.length < 3) return null;
    const wins = recent.filter((g) => g.result === "win").length;
    const losses = recent.filter((g) => g.result === "loss").length;
    if (wins >= recent.length - 1 && idx + 1 < DIFF_IDS.length) {
      return tf("rec.harder", [diffName(DIFF_IDS[idx + 1])]);
    }
    if (losses === recent.length && idx > 0) {
      return tf("rec.easier", [diffName(DIFF_IDS[idx - 1])]);
    }
    // losing most games but not all: tactics are usually the cheapest fix
    if (losses > wins) {
      const missed = ALL_PUZZLES.filter((p) => ChessSrs.isDue(store.session.puzzleState.missed[p.id])).length;
      return missed ? tf("rec.review", [missed]) : t("rec.puzzles");
    }
    return null;
  }

  // --- achievements: pure derivations of stats + lesson/puzzle progress ---
  const ACH = CHESS_ACHIEVEMENTS || [];
  function loadAchSeen() {
    try {
      const s = JSON.parse(Persist.get("achievements") || "null");
      if (s && Array.isArray(s.seen)) return new Set(s.seen);
    } catch (_) {}
    return new Set();
  }
  store.session.achSeen = loadAchSeen();

  function achSummary() {
    const st = loadStats();
    let wins = 0, losses = 0, draws = 0, extremeWins = 0;
    for (const g of st.games) {
      if (g.result === "win") { wins++; if (g.diff === "extreme") extremeWins++; }
      else if (g.result === "loss") losses++;
      else draws++;
    }
    const solved = store.session.puzzleState.solved || {};
    const solvedIn = (cat) => ALL_PUZZLES.filter((p) => p.cat === cat && solved[p.id]).length;
    const countIn = (cat) => ALL_PUZZLES.filter((p) => p.cat === cat).length;
    const mateCats = ["m1", "m2", "m3"];
    return {
      lessonsDone: LESSONS.filter((l) => store.session.learnState.done[l.id]).length,
      lessonsTotal: LESSONS.length,
      puzzleSolvedCount: ALL_PUZZLES.filter((p) => solved[p.id]).length,
      matesSolved: mateCats.reduce((n, c) => n + solvedIn(c), 0),
      matesTotal: mateCats.reduce((n, c) => n + countIn(c), 0),
      tacSolved: solvedIn("tac"), tacTotal: countIn("tac"),
      realSolved: solvedIn("real"), realTotal: countIn("real"),
      opSolved: solvedIn("op"), opTotal: countIn("op"),
      wins, losses, draws, games: st.games.length, extremeWins,
    };
  }

  /**
   * [{ach, unlocked}] with the meta "completionist" resolved in a 2nd pass.
   * Once earned, a badge stays earned (achSeen): otherwise adding lessons or
   * puzzles in an update would silently revoke a veteran's 全部完成 badges.
   */
  function evalAch() {
    const s = achSummary();
    const base = ACH.filter((a) => a.id !== "completionist");
    const baseRes = base.map((a) => ({ ach: a, unlocked: !!a.test(s) || store.session.achSeen.has(a.id) }));
    s.otherUnlocked = baseRes.filter((r) => r.unlocked).length;
    s.otherTotal = base.length;
    const out = ACH.map((a) =>
      a.id === "completionist" ? { ach: a, unlocked: !!a.test(s) || store.session.achSeen.has(a.id) }
        : baseRes.find((r) => r.ach.id === a.id));
    // the badges' progress() reads the same summary the tests ran against
    out.summary = s;
    return out;
  }

  /** Toast any achievement newly unlocked since last check; persist seen set. */
  function checkNewAchievements() {
    const res = evalAch();
    const fresh = res.filter((r) => r.unlocked && !store.session.achSeen.has(r.ach.id));
    for (const r of res) if (r.unlocked) store.session.achSeen.add(r.ach.id);
    if (fresh.length) {
      Persist.setJson("achievements", { seen: Array.from(store.session.achSeen) });
      // one toast per unlock, staggered so several don't collide
      fresh.forEach((r, i) => setTimeout(() => toast("🎉 " + t("ach.unlocked") + " · " + r.ach.icon + " " + (r.ach.nameKey ? t(r.ach.nameKey) : r.ach.name)), i * 1600));
    }
    renderAchievements();
  }

  function renderAchievements() {
    const el = document.getElementById("ach-body");
    if (!el) return;
    const res = evalAch();
    const got = res.filter((r) => r.unlocked).length;
    el.replaceChildren();
    const head = document.getElementById("ach-count");
    if (head) head.textContent = got + "/" + res.length;

    // A new player used to open this and see fourteen padlocks in a row: no
    // grouping, and nothing to say which one is one game away versus seventy
    // puzzles away. Unlocked ones come first, then the locked ones ordered by
    // how close they are, and the closest gets called out by name.
    const frac = (r) => {
      if (!r.ach.progress) return 0.5; // no counter: neither near nor far
      const [done, total] = r.ach.progress(res.summary);
      return total > 0 ? Math.min(1, done / total) : 0;
    };
    const unlocked = res.filter((r) => r.unlocked);
    const locked = res.filter((r) => !r.unlocked).sort((a, b) => frac(b) - frac(a));
    const next = locked[0];
    if (next) {
      const tip = document.createElement("div");
      tip.className = "ach-next";
      const nm = next.ach.nameKey ? t(next.ach.nameKey) : next.ach.name;
      const desc = next.ach.descKey ? t(next.ach.descKey) : next.ach.desc;
      tip.textContent = t("ach.next") + nm + " · " + desc;
      el.appendChild(tip);
    }
    const groups = [];
    if (unlocked.length) groups.push(["ach.got", unlocked]);
    if (locked.length) groups.push(["ach.locked", locked]);
    for (const [key, rows] of groups) {
      const h = document.createElement("div");
      h.className = "ach-group";
      h.textContent = t(key) + " " + rows.length;
      el.appendChild(h);
      renderAchRows(rows, res, el);
    }
  }

  function renderAchRows(rows, res, el) {
    for (const r of rows) {
      const b = document.createElement("div");
      b.className = "ach-item" + (r.unlocked ? " got" : "");
      b.title = r.ach.descKey ? t(r.ach.descKey) : r.ach.desc;
      const ic = document.createElement("span");
      ic.className = "ach-ic";
      ic.textContent = r.unlocked ? r.ach.icon : "🔒";
      const nm = document.createElement("span");
      nm.className = "ach-nm";
      nm.textContent = r.ach.nameKey ? t(r.ach.nameKey) : r.ach.name;
      b.append(ic, nm);
      // "12/53" on a locked counting badge — the puzzle set nearly doubled in
      // 1.6, so "solve every mate" silently got much longer with nothing on
      // screen to say how far along you were
      if (!r.unlocked && r.ach.progress) {
        const [done, total] = r.ach.progress(res.summary);
        if (total > 0 && done < total) {
          const pg = document.createElement("span");
          pg.className = "ach-pg num";
          pg.textContent = done + "/" + total;
          b.appendChild(pg);
        }
      }
      el.appendChild(b);
    }
  }

  // --- game flow ---

  /** FIDE 6.9 material test for the side that must deliver mate (see fide.js). */
  function sideHasMatingMaterial(color) {
    return Fide.hasMatingMaterial(game.board(), color);
  }

  function timeoutIsDraw() {
    return store.game.flagFall && !sideHasMatingMaterial(store.game.flagFall === "w" ? "b" : "w");
  }

  function statusText() {
    if (store.session.editor) {
      const reason = ChessEditor.validate(store.session.editor, Chess);
      return t("st.editing") + " · " + (reason ? t(reason) : t("st.editingReady"));
    }
    if (store.session.mode === "learn") {
      if (!store.session.learn) return t("st.learn");
      if (store.session.learn.done) return t("st.lessonDone");
      // The lesson name, open panel or shut. The full task text used to appear
      // here when the panel was closed — a whole instruction in a chip, clipped
      // at 44vw with an ellipsis. A chip that gets truncated is a chip holding
      // a sentence that belongs somewhere else: the task is spelled out on its
      // task card, and what the closed panel needed was not this sentence but
      // the game itself, which is what the spine shows now.
      return lessonText(curLesson()).title;
    }
    if (store.session.mode === "puzzle") {
      if (!store.session.puzzle) return t("st.puzzle");
      if (store.session.puzzle.done) return t("st.puzzleDone");
      return puzzleGoalText();
    }
    const g = viewGame();
    if (!isLive()) return t("st.replay") + " " + store.game.viewIndex + "/" + sanHistory().length;
    if (store.game.flagFall) {
      if (timeoutIsDraw()) return t("st.flagDraw");
      return t(store.game.flagFall === "w" ? "st.flagWhite" : "st.flagBlack");
    }
    if (store.game.resigned) return t(store.game.resigned === "w" ? "st.resignWhite" : "st.resignBlack");
    if (store.game.drawAgreed) return t("st.drawAgreed");
    if (store.game.drawClaimed) return t(store.game.drawClaimed === "threefold" ? "st.claimThreefold" : "st.claimFifty");
    if (store.session.engineThinking && !naturalGameOver()) return t("st.thinking");
    if (g.in_checkmate()) return t(g.turn() === "w" ? "st.mateBlack" : "st.mateWhite");
    if (g.in_stalemate()) return t("st.stalemate");
    if (g.insufficient_material()) return t("st.insufficient");
    const auto = autoDrawReason();
    if (auto) return t(auto === "fivefold" ? "st.autoFivefold" : "st.autoSeventyfive");
    const side = g.turn() === "w" ? t("turn.white") : t("turn.black");
    const base = g.in_check() ? side + " · " + t("turn.check") : side;
    if (claimableDrawReason()) return base + " · " + t("st.claimable");
    // The 50-move rule arrives without warning: nothing on screen changes until
    // the move it becomes claimable, so a player grinding a rook ending has no
    // idea they are on move 43 of it. Start counting once it is close enough to
    // matter — early enough to change how you play, late enough not to be noise
    // in the twenty quiet moves every game has.
    const quiet = halfmoveClock();
    if (quiet >= FIFTY_WARN_PLIES) return base + " · " + tf("st.quietMoves", [Math.floor(quiet / 2)]);
    return base;
  }

  function renderMoveList() {
    const el = document.getElementById("move-list");
    if (!el) return;
    const h = sanHistory();
    // A position edited to start with Black opens at "1…", so its first row
    // holds a single black move and White's reply belongs to move 2. Pairing
    // from ply 0 would file them together under move 1 — and the review
    // report's turning-point line would then disagree with this list.
    const blackFirst = startFen() ? startFen().split(" ")[1] === "b" : false;
    const firstMover = blackFirst ? "b" : "w";
    const moveNo = (i) => (ChessReview
      ? ChessReview.moveNumber(i, firstMover)
      : Math.floor(i / 2) + 1);
    const a = analysisFor();

    // one entry per row: which plies it holds, and whether it opens with the
    // "1. …" gap of a black-first game
    const rows = [];
    for (let i = blackFirst ? -1 : 0; i < h.length; i += 2) {
      const plies = (i < 0 ? [0] : [i, i + 1]).filter((j) => j < h.length);
      rows.push({ i, no: moveNo(Math.max(0, i)), gap: i < 0, plies });
    }

    // Keyed, so a move rebuilds one row instead of the game. The signature is
    // everything a row shows — the moves, their annotations, and which one is
    // current — so an ordinary move dirties exactly one row (two when the
    // cursor leaves another). See keyed.js for why this is worth doing: the
    // scroll position and the focus are properties of the nodes, and rebuilding
    // the list threw both away every time the clock ticked.
    reconcile(el, rows,
      (r) => r.i,
      (r) => r.no + "|" + r.plies.map((j) =>
        h[j] + "/" + ((a && a.tags[j]) || "") + "/" + (store.game.viewIndex === j + 1 ? "*" : "")).join(","),
      (r, _idx, reuse) => {
        const row = reuse || document.createElement("div");
        row.className = "mlrow";
        const kids = [];
        const num = document.createElement("span");
        num.className = "mlnum num";
        num.textContent = r.no + ".";
        kids.push(num);
        // the opening row of a black-first game shows "1. … Qh4"
        if (r.gap) {
          const gap = document.createElement("span");
          gap.className = "mlmove mlgap";
          gap.textContent = "…";
          kids.push(gap);
        }
        for (const j of r.plies) {
          const b = document.createElement("button");
          b.type = "button";
          b.dataset.i = String(j + 1);
          b.textContent = h[j];
          b.className = "mlmove" + (store.game.viewIndex === j + 1 ? " current" : "");
          const tag = a && a.tags[j];
          if (tag) {
            const span = document.createElement("span");
            span.className = "mvtag " + (tag === "??" ? "t-bad" : tag === "?" ? "t-mid" : "t-soft");
            span.textContent = tag;
            b.appendChild(span);
          }
          kids.push(b);
        }
        row.replaceChildren(...kids);
        return row;
      });

    const cur = el.querySelector(".current");
    // At the start of the game there is no current move to centre on, and the
    // list used to stay wherever the last jump had left it — pressing Home on
    // a long game put the board at move 0 while the notation still showed
    // move 20. "Before the first move" is the top of the list.
    if (!cur) el.scrollTop = 0;
    else if (cur.scrollIntoView) {
      // scroll only within the list container
      el.scrollTop = cur.offsetTop - el.clientHeight / 2;
    }
  }

  /** Live game finished by an app-level rule (flag / resignation / agreed or claimed draw). */
  function ruleTerminated() { return !!store.game.flagFall || !!store.game.resigned || store.game.drawAgreed || !!store.game.drawClaimed; }

  // --- FIDE draw plumbing ---
  // chess.js's game_over() ends the game at threefold repetition and at the
  // 50-move mark, but under FIDE those are CLAIMABLE draws (arts. 9.2/9.3);
  // only fivefold repetition and 75 moves end the game automatically
  // (arts. 9.6). The app therefore never consults game_over() for
  // terminal-ness — it derives its own claimable/auto states here.

  const Fide = ChessFide;

  function halfmoveClock(g) { return Fide.halfmoveClock((g || game).fen()); }

  function repetitionCount() {
    const h = sanHistory();
    const sig = h.join(" ");
    if (store.game.repMemo.sig === sig) return store.game.repMemo.count;
    store.game.repMemo = { sig, count: Fide.repetitionCount(startFen(), h, Chess) };
    return store.game.repMemo.count;
  }

  /** 'fivefold' | 'seventyfive' | null — draws that end the game by law */
  function autoDrawReason() {
    if (game.in_checkmate()) return null; // a mating move trumps the 75-move rule
    if (repetitionCount() >= 5) return "fivefold";
    if (halfmoveClock() >= 150) return "seventyfive";
    return null;
  }

  /**
   * When the status line starts counting quiet moves toward the 50-move rule.
   * 60 plies = 30 moves: two thirds of the way, which in a rook ending is the
   * point where "am I actually making progress" becomes the question.
   */
  const FIFTY_WARN_PLIES = 60;

  /** 'threefold' | 'fifty' | null — draws the player may claim right now */
  function claimableDrawReason() {
    if (naturalGameOver()) return null;
    if (repetitionCount() >= 3) return "threefold";
    if (halfmoveClock() >= 100) return "fifty";
    return null;
  }

  /** Game over by the laws of chess alone (no clocks/resignation/claims). */
  function naturalGameOver() {
    return game.in_checkmate() || game.in_stalemate() ||
      game.insufficient_material() || !!autoDrawReason();
  }

  /** Every way the live game can be finished. */
  function appGameOver() { return naturalGameOver() || ruleTerminated(); }

  // --- the views -----------------------------------------------------------
  //
  // Up to 1.25 all of this was one function, sync(), called from 65 places.
  // Playing a move, switching a tab, taking a move back and the clock ticking
  // one second all ran the same full rebuild — nine sub-syncs, thirty-odd
  // getElementById calls (`status` looked up twice in the same pass), every
  // list re-rendered — because the one thing sync() never knew was what had
  // actually changed.
  //
  // It is split by *what a view is about*, and each half subscribes to the
  // slice it reads. The three groups below are the whole of what sync() used
  // to do inline; the nine sub-syncs it called are subscribed the same way.
  //
  // A view may read more than one slice — the game-action buttons need the
  // position and the mode — in which case it subscribes to both and is
  // idempotent. What it must never do is *write* one, which is what the
  // store's re-entrancy cap is there to catch.

  /**
   * getElementById, memoised.
   *
   * These ids are in index.html, which is loaded once and never rewritten, so
   * a lookup can only ever return the same node. sync() did thirty-odd of them
   * per pass on a path that ran on every clock tick.
   */
  const _nodes = new Map();
  function el(id) {
    if (!_nodes.has(id)) _nodes.set(id, document.getElementById(id));
    return _nodes.get(id);
  }

  /** Is a trainer or the editor standing in front of the ordinary game UI? */
  function inModal() {
    return store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
  }

  /**
   * The spine — the game, readable with the panel shut.
   *
   * Whose move, the clock, the last move, the material difference. Closing the
   * panel used to take all four away and leave the board on a plain colour,
   * which is the state a small window plays in permanently.
   */
  function renderSpine() {
    const bar = el("spine");
    if (!bar) return;
    // with the panel open every one of these is on screen already, in more
    // detail — a second copy would be the duplication rule broken twice
    if (isPanelOpen() || inModal()) { bar.hidden = true; return; }
    bar.hidden = false;
    const g = viewGame();
    el("spine-turn").textContent = statusText();

    const clockEl = el("spine-clock");
    const showClock = store.game.timeControl !== "off" && !!store.game.clock;
    clockEl.hidden = !showClock;
    if (showClock) {
      clockEl.textContent = fmtClock(store.game.clock.w) + " · " + fmtClock(store.game.clock.b);
    }

    const lastEl = el("spine-last");
    const h = sanHistory();
    const at = store.game.viewIndex;
    lastEl.hidden = at <= 0;
    if (at > 0) {
      const no = ChessReview ? ChessReview.moveNumber(at - 1, "w") : Math.ceil(at / 2);
      lastEl.textContent = no + (at % 2 ? ". " : "… ") + h[at - 1];
    }

    const matEl = el("spine-mat");
    const Mat = ChessMaterial;
    let diff = 0;
    if (Mat) {
      const promos = verboseHistory().slice(0, at)
        .filter((m) => m.promotion).map((m) => ({ color: m.color, promotion: m.promotion }));
      diff = Mat.summary(baseGame().board(), g.board(), promos).diff;
    }
    matEl.hidden = !diff;
    if (diff) matEl.textContent = (diff > 0 ? "+" : "−") + Math.abs(diff);
  }

  /**
   * The sound one move makes.
   *
   * Castling and promotion are not ordinary placements: castling moves two
   * pieces (the one move on the board that does, and the hardest to follow),
   * and promotion turns a pawn into something heavier. Both used to make the
   * same tap as pushing a pawn one square.
   */
  function moveSound(mv, g) {
    if (!mv) return;
    const check = g.in_check();
    if (mv.flags && /[kq]/.test(mv.flags)) { Audio2.playCastle(mv.color); return; }
    if (mv.promotion) { Audio2.playPromote(mv.color); return; }
    Audio2.playMove(mv.color, { captured: !!mv.captured, check });
  }

  /**
   * The sound a finished game makes, decided by WHO WON.
   *
   * Until 1.26 the question asked at every ending was "is the game over" —
   * checkmate played the victory fanfare, flag-fall played it, and
   * *resigning* played it. Being checkmated by Stockfish and resigning to it
   * both sounded like you had won something. 缺陷 1.
   *
   * @param {"w"|"b"|null} winner  null for a draw
   */
  function playEnding(winner) {
    if (!winner) { Audio2.playDraw(); return; }
    // Two players at one board: somebody in the room won, so it is a win. In
    // an engine game and in the trainers there is a "you", and it is the human.
    const mine = store.session.mode === "ai" ? store.session.humanColor
      : store.session.mode === "pvp" ? winner
      : "w"; // learn and puzzle: the student always plays White
    if (winner === mine) Audio2.playWin(); else Audio2.playLoss();
  }

  /** The status pill: whose move, or how it ended, or that we are replaying. */
  function renderStatusPill() {
    const modal = inModal();
    const status = el("status");
    status.textContent = statusText();
    const g = viewGame();
    const decisiveEnd = g.in_checkmate() || !!store.game.resigned || (store.game.flagFall && !timeoutIsDraw());
    status.classList.toggle("win", !modal && isLive() && decisiveEnd);
    status.classList.toggle("replay", !modal && !isLive());
    // "思考中" with nothing moving reads as a hang at the higher levels, where
    // a search can run for seconds; the pill breathes while the engine works
    const busy = store.session.engineThinking || store.session.analyzing || !!(store.session.learn && store.session.learn.engineBusy);
    status.classList.toggle("thinking", busy);
    // …and a pulse on the board itself, where the player is actually looking
    const dot = el("think-dot");
    if (dot) dot.hidden = !busy;
    const showTurn = !modal && isLive() && !appGameOver();
    el("white-turn").hidden = !(showTurn && game.turn() === "w");
    el("black-turn").hidden = !(showTurn && game.turn() === "b");
  }

  /**
   * Availability, expressed as presence.
   *
   * `disabled` is a promise the interface is not keeping: the control takes up
   * the layout, names an action, and does nothing. At 0 moves fourteen visible
   * controls were disabled at once — take back, the five replay keys, resume,
   * PGN, export, offer draw, claim draw, resign, analyse, deep-analyse — which
   * is most of the panel telling you about things you cannot do yet. P3.3.
   *
   * So: a control that does not apply is not there. The exception is a control
   * that is *momentarily* busy rather than inapplicable — those get a label
   * change, not a vanishing act, because a button that disappears while you
   * are reaching for it is worse than one that greys.
   */
  function avail(node, ok) { if (node) node.hidden = !ok; }

  /** Hide a group whose whole row went away, so no empty heading is left. */
  function collapseEmptyGroups() {
    for (const group of document.querySelectorAll(".act-group")) {
      const live = [...group.querySelectorAll("button")].some((b) => !b.hidden);
      group.hidden = !live;
    }
  }

  /** The replay bar and the move counter chip beside it. */
  function renderReplayBar() {
    const h = sanHistory();
    el("moves").textContent =
      store.session.mode === "learn" ? (store.session.learn ? (store.session.learn.li + 1) + "/" + LESSONS.length : "—") :
      store.session.mode === "puzzle" ? (store.session.puzzle ? tf("pz.chip", [store.session.puzzle.idx + 1, puzzlesInCat(store.session.puzzle.cat).length]) : "—") :
      store.game.viewIndex + "/" + h.length;
    el("replay-pos").textContent = store.game.viewIndex + " / " + h.length;
    // Nothing played yet is nothing to replay: the whole transport goes.
    avail(el("replay-seg"), h.length > 0);
    const back = store.game.viewIndex > 0;
    const fwd = store.game.viewIndex < h.length;
    avail(el("rep-start"), back);
    avail(el("rep-prev"), back);
    avail(el("rep-next"), fwd);
    avail(el("rep-end"), fwd);
    avail(el("rep-live"), !isLive());
    // "resume from here" is a replay action, and it only exists off the live
    // position — where it used to sit greyed out with a tooltip explaining
    // that it only exists off the live position
    avail(el("retry-here"), !isLive());
  }

  /** Everything you can do to the game in progress. */
  function renderGameActions() {
    const h = sanHistory();
    const modal = inModal();
    const inDrill = store.session.mode === "learn" && store.session.learn && !store.session.learn.done && curTask().type === "drill";
    const over = appGameOver();

    // Take back: in a drill it is the drill's own history; otherwise it needs
    // a move to take back, the live position, and a game still running.
    avail(el("undo"), modal
      ? !!(inDrill && store.session.learn.g && store.session.learn.g.history().length)
      : h.length > 0 && isLive() && !ruleTerminated());
    avail(el("btn-new"), !modal);
    avail(el("btn-flip"), !modal);

    // Hint is the one control that stays put while it is busy: it is in the
    // chrome, under the pointer, and it says what it is doing.
    const hintBtn = el("btn-hint");
    if (hintBtn) {
      const canHint =
        store.session.mode === "learn"
          ? !!(inDrill && store.session.learn.g && !store.session.learn.g.game_over() && store.session.learn.g.turn() === "w")
        : store.session.mode === "puzzle"
          ? !!(store.session.puzzle && !store.session.puzzle.done && !store.session.puzzle.g.game_over() && store.session.puzzle.g.turn() === "w")
        : !store.session.editor && isLive() && !over &&
          !(store.session.mode === "ai" && game.turn() !== store.session.humanColor);
      avail(hintBtn, canHint);
      const busy = store.session.hintPending || store.session.analyzing ||
        !!(store.session.learn && store.session.learn.engineBusy) || store.session.engineThinking;
      hintBtn.disabled = false;
      hintBtn.textContent = store.session.mode === "puzzle" ? t("chrome.answer")
        : busy ? t("chrome.thinking") : t("chrome.hint");
      hintBtn.classList.toggle("busy", busy);
    }

    const live = !modal && isLive() && h.length > 0 && !over;
    avail(el("btn-resign"), live);
    avail(el("btn-offerdraw"), live && !store.session.drawOfferPending);
    // Claim: it exists exactly when a rule says it may be claimed. It used to
    // sit greyed with a tooltip explaining which rule would have to hold.
    const reason = live ? claimableDrawReason() : null;
    const claimBtn = el("btn-claimdraw");
    avail(claimBtn, !!reason);
    if (claimBtn && reason) {
      claimBtn.title = t(reason === "threefold" ? "tipRun.claimThreefold" : "tipRun.claimFifty");
    }

    // A game with no moves has no PGN to copy, export or analyse.
    const hasGame = h.length > 0;
    avail(el("pgn-copy"), hasGame);
    avail(el("pgn-download"), hasGame);
    avail(el("an-run"), hasGame || store.session.analyzing);
    avail(el("an-deep"), hasGame && !store.session.analyzing);
    collapseEmptyGroups();
  }

  /**
   * Which view listens to which slice.
   *
   * Registered in one block so the wiring can be read at a glance rather than
   * hunted for beside each view. Order within a slice is paint order: the
   * board first, because it is what the player is looking at.
   */
  function wireViews() {
    store.subscribe("game", draw);
    store.subscribe("game", renderStatusPill);
    store.subscribe("game", renderReplayBar);
    store.subscribe("game", renderGameActions);
    store.subscribe("game", renderMoveList);
    store.subscribe("game", renderOpening);
    store.subscribe("game", renderClocks);
    store.subscribe("game", syncClockTimer);
    store.subscribe("game", setAnalyzeUI);

    // the trainers own the board while they are running, so a session change
    // repaints it too
    store.subscribe("session", draw);
    store.subscribe("session", renderStatusPill);
    store.subscribe("session", renderReplayBar);
    store.subscribe("session", renderGameActions);
    store.subscribe("session", setAnalyzeUI);
    store.subscribe("session", syncLearnUI);
    store.subscribe("session", syncPuzzleUI);
    store.subscribe("session", syncEditorUI);
    store.subscribe("session", syncSettingsUI);

    // …and the two views that were living inside syncSettingsUI while reading
    // the *game*. The captured-piece strip follows the replay cursor — it shows
    // the material as it stood at the move you are looking at, not as it stands
    // now — so it belongs to the game slice, and filing it under settings is
    // exactly the mis-slotting that makes narrowing a call site dangerous:
    // commit("game") would have moved the board and left the strip behind.
    store.subscribe("game", renderMaterial);
    store.subscribe("session", renderMaterial);
    store.subscribe("game", renderIdleCard);
    store.subscribe("session", renderIdleCard);

    // the settings panel reads the game too (the clock preset is a game fact),
    // so it hears about all three
    store.subscribe("game", renderSpine);
    store.subscribe("session", renderSpine);
    store.subscribe("ui", renderSpine);
    store.subscribe("game", syncSettingsUI);
    store.subscribe("ui", syncSettingsUI);
    store.subscribe("ui", draw);
  }

  /**
   * Everything, in one go.
   *
   * The 65 call sites that used to say sync() still say it, and it still means
   * "something changed, work out what that does to the screen". What changed
   * is that it is no longer a *function that knows how to draw the app* — it
   * is three commits, and the views decide for themselves whether they are
   * concerned. Narrowing a call site to the one slice it actually touches is
   * now a local edit rather than a rewrite; renderClocks() below is the first
   * one done that way, because the clock ticks four times a second and had no
   * business rebuilding the settings panel each time.
   */
  function sync() {
    store.commit("game", "sync");
    store.commit("session", "sync");
    store.commit("ui", "sync");
  }

  function syncSettingsUI() {
    document.querySelectorAll("#theme-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === store.ui.themeId);
    });
    const sb = document.getElementById("opt-sound");
    if (sb) {
      sb.classList.toggle("active", store.ui.soundOn);
      sb.setAttribute("aria-pressed", store.ui.soundOn ? "true" : "false");
    }
    document.querySelectorAll("#mode-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === store.session.mode);
    });
    // two rows now: sparring tiers and engine-strength tiers (see index.html)
    document.querySelectorAll("#diff-seg button, #diff-seg-engine button").forEach((b) => {
      b.classList.toggle("active", b.dataset.diff === store.session.difficulty);
    });
    document.querySelectorAll("#persona-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.persona === store.session.personaId);
    });
    document.querySelectorAll("#color-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.color === store.session.humanColor);
    });
    document.querySelectorAll("#clock-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tc === store.game.timeControl);
    });
    const diffRow = document.getElementById("row-difficulty");
    const colorRow = document.getElementById("row-color");
    const clockRow = document.getElementById("row-clock");
    if (diffRow) diffRow.hidden = store.session.mode !== "ai";
    const personaRow = document.getElementById("row-persona");
    if (personaRow) personaRow.hidden = store.session.mode !== "ai";
    if (colorRow) colorRow.hidden = store.session.mode !== "ai";
    if (clockRow) clockRow.hidden = store.session.mode !== "pvp" && store.session.mode !== "ai";
    const coachRow = document.getElementById("row-coach");
    if (coachRow) coachRow.hidden = store.session.mode !== "ai";
    const coachSwitch = document.getElementById("opt-coach");
    if (coachSwitch) coachSwitch.setAttribute("aria-pressed", store.session.coachOn ? "true" : "false");
    const flipRow = document.getElementById("row-autoflip");
    if (flipRow) flipRow.hidden = store.session.mode !== "pvp";
    const flipSwitch = document.getElementById("opt-autoflip");
    if (flipSwitch) flipSwitch.setAttribute("aria-pressed", store.ui.autoFlipPvp ? "true" : "false");
    // The one line that answers "what am I set to" without opening anything.
    // Only the rows that apply in this mode are in it — a summary that lists a
    // clock in lesson mode is a summary of a different app.
    const sum = el("game-summary");
    if (sum) {
      const parts = [];
      if (store.session.mode === "ai") {
        parts.push(DIFF_NAMES[store.session.difficulty] || store.session.difficulty);
        if (store.session.personaId !== "off") parts.push(t("persona." + store.session.personaId));
        parts.push(t(store.session.humanColor === "w" ? "color.white" : "color.black"));
      }
      if (store.session.mode === "ai" || store.session.mode === "pvp") {
        parts.push(store.game.timeControl === "off" ? t("clock.off") : store.game.timeControl);
      }
      sum.textContent = parts.join(" · ");
    }
    // the reading modes get a wider column — see styles.css [data-mode]
    appEl.setAttribute("data-mode", store.session.mode);
    const foldGame = el("fold-game");
    if (foldGame) foldGame.hidden = store.session.mode === "learn" || store.session.mode === "puzzle";

    const secMoves = document.getElementById("sec-moves");
    const trainer = store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
    if (secMoves) secMoves.hidden = trainer;
    // 统计/历史/成就 used to be hidden in the trainer modes because they sat in
    // the same scroll and got in the way. They now live behind their own tab,
    // which nobody opens by accident — and puzzle badges are earned right there.
    const engineName = "Stockfish · " + (DIFF_NAMES[store.session.difficulty] || store.session.difficulty);
    const wRole = document.getElementById("white-role");
    const bRole = document.getElementById("black-role");
    // A lesson that is not a drill has no opponent. Writing "—" into the black
    // role left an empty card at the top of the panel; the whole half is now
    // hidden instead (see .vs.solo).
    const solo = store.session.mode === "learn" && !(store.session.learn && curTask().type === "drill");
    const vsBar = document.getElementById("vs-bar");
    if (vsBar) vsBar.classList.toggle("solo", solo);
    if (wRole && bRole) {
      if (store.session.mode === "ai") {
        wRole.textContent = store.session.humanColor === "w" ? t("vs.player") : engineName;
        bRole.textContent = store.session.humanColor === "b" ? t("vs.player") : engineName;
      } else if (store.session.mode === "learn") {
        wRole.textContent = t("role.student");
        bRole.textContent = solo ? "" : t("role.sparring");
      } else if (store.session.mode === "puzzle") {
        wRole.textContent = t("role.you");
        bRole.textContent = t("role.puzzle");
      } else {
        wRole.textContent = t("vs.p1");
        bRole.textContent = t("vs.p2");
      }
    }
  }

  /**
   * Point the board at whoever is on move (pvp auto-flip).
   * Every path that changes whose turn it is must go through here — a move,
   * an undo, a replay jump, a fresh game, or restoring a save — otherwise the
   * board keeps facing the player who just moved.
   * @returns {boolean} true when the orientation changed
   */
  function syncAutoFlip() {
    if (!store.ui.autoFlipPvp || store.session.mode !== "pvp") return false;
    const want = viewGame().turn() === "b";
    if (store.game.flipped === want) return false;
    store.game.flipped = want;
    saveSettings(); // otherwise a reload mid-game faces the wrong player
    return true;
  }

  function setViewIndex(n) {
    store.game.viewIndex = Math.max(0, Math.min(n, sanHistory().length));
    store.game.selection = null;
    BoardView.cancelAnim();
    syncAutoFlip();
    store.commit("game", "action");
  }

  function goLive() { setViewIndex(sanHistory().length); }

  /** localised promotion piece names — read through t() so a language switch
   * takes effect without rebuilding the table */
  const PROMO_NAMES = new Proxy({}, { get: (_, k) => t("piece." + String(k)) });
  const PROMO_GLYPHS = {
    w: { q: "♕", r: "♖", b: "♗", n: "♘" },
    b: { q: "♛", r: "♜", b: "♝", n: "♞" },
  };

  /** Modal chooser for pawn promotion → 'q'|'r'|'b'|'n', or null on cancel. */
  function choosePromotion(color) {
    const modal = document.getElementById("promo-modal");
    if (!modal) return Promise.resolve("q");
    modal.querySelectorAll("button[data-p]").forEach((b) => {
      const gl = b.querySelector(".promo-glyph");
      if (gl) gl.textContent = PROMO_GLYPHS[color][b.dataset.p];
    });
    Dlg.open(modal, modal.querySelector('button[data-p="q"]'));
    return new Promise((resolve) => { store.ui.promoResolver = resolve; });
  }
  function finishPromotion(p) {
    const modal = document.getElementById("promo-modal");
    Dlg.close(modal);
    if (store.ui.promoResolver) { store.ui.promoResolver(p); store.ui.promoResolver = null; }
  }

  function playHumanMove(from, to, promotion) {
    const mv = gameMove({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    store.session.hintMove = null;
    store.game.viewIndex = sanHistory().length;
    applyIncrement(mv.color);
    // no animation: the player just clicked or dragged this piece here, and
    // sliding it in from the square they took it off replays something they
    // did themselves — for a drag it visibly snaps back first
    BoardView.cancelAnim();
    moveSound(mv, game);
    if (mv.promotion) toast(tf("mm.promoted", [PROMO_NAMES[mv.promotion]]));
    if (game.in_checkmate()) playEnding(game.turn() === "w" ? "b" : "w");
    else if (naturalGameOver()) playEnding(null);
    if (!appGameOver()) syncAutoFlip();
    coachRemember(mv);
    sync();
    saveGame();
    recordGameIfOver();
    maybeEngineTurn();
  }

  function onSquareClick(sq) {
    if (store.session.editor) { editorClick(sq); return; }
    if (store.session.mode === "learn") { learnClick(sq); return; }
    if (store.session.mode === "puzzle") { puzzleClick(sq); return; }
    if (!isLive()) { toast(t("mm.goLiveFirst"), "fix"); return; }
    if (naturalGameOver()) return;
    if (store.game.flagFall) { toast(t("msg.over.flagged"), "fix"); return; }
    if (store.game.resigned) { toast(t("msg.over.resigned"), "fix"); return; }
    if (store.game.drawAgreed) { toast(t("msg.over.drawAgreed"), "fix"); return; }
    if (store.game.drawClaimed) { toast(t("msg.over.drawClaimed"), "fix"); return; }
    if (store.session.mode === "ai" && game.turn() !== store.session.humanColor) return; // engine's move
    const piece = game.get(sq);
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = game.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        // cancelling keeps the selection so the player can pick another square
        choosePromotion(game.turn()).then((p) => { if (p) playHumanMove(from, sq, p); });
        return;
      }
      playHumanMove(from, sq, "q");
      return;
    }
    if (piece && piece.color === game.turn()) {
      const targets = game.moves({ square: sq, verbose: true }).map((m) => m.to);
      store.game.selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (store.game.selection) { store.game.selection = null; draw(); }
  }

  function undo() {
    if (store.session.mode === "learn") { learnUndo(); return; }
    if (!sanHistory().length || ruleTerminated()) return;
    if (!isLive()) { goLive(); return; }
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

  async function requestNewGame() {
    stopEditor(t("msg.editor.exited"));
    if (sanHistory().length &&
        !(await confirmNative(t("dlg.newGame"), t("chrome.new"), { ok: t("chrome.new"), cancel: t("act.cancel") }))) {
      return;
    }
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    gameReset();
    store.game.selection = null;
    store.game.viewIndex = 0;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
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
    toast(t("msg.game.started"));
    maybeEngineTurn();
  }

  /** Truncate the game to the replay cursor and continue playing from there. */
  async function retryFromHere() {
    if (isLive()) return;
    const keep = store.game.viewIndex;
    const drop = sanHistory().length - keep;
    if (!(await confirmNative(tf("dlg.retryHere", [keep, drop]), t("act.retryHere"),
        { ok: t("act.retryHere"), cancel: t("act.cancel") }))) {
      return;
    }
    const h = sanHistory().slice(0, keep);
    invalidateEngine();
    resetGameToStart();
    for (const san of h) gameMove(san);
    store.game.selection = null;
    store.game.viewIndex = h.length;
    // continuing a finished game (flag / resignation) gets fresh clocks
    if (ruleTerminated()) resetClocks();
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
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
      if (!(await confirmNative(tf("dlg.resign", [side === "w" ? t("side.white") : t("side.black")]),
        t("act.resign"), { ok: t("act.resign"), cancel: t("act.cancel") }))) return;
    } else {
      // pvp: either player may resign at any time (FIDE) — pick the side
      const pick = await confirmNative(t("dlg.whoResigns"), t("act.resign"),
        { ok: t("dlg.whiteResigns"), alt: t("dlg.blackResigns"), cancel: t("act.cancel") });
      if (!pick) return;
      side = pick === "alt" ? "b" : "w";
    }
    const who = side === "w" ? t("side.white") : t("side.black");
    invalidateEngine();
    store.game.resigned = side;
    // resigning is losing, whatever the previous six years of this file said
    playEnding(side === "w" ? "b" : "w");
    if (store.session.mode === "ai") recordResign();
    saveGame();
    store.commit("game", "action");
    toast(tf("mm.resignWin", [who, side === "w" ? t("side.black") : t("side.white")]));
  }

  /** Record an AI-game outcome decided by an app-level rule (not by mate). */
  function recordOutcome(result, ending) {
    if (store.game.recordedId) return; // this game is already filed
    const s = loadStats();
    const id = newRecordId();
    store.game.recordedId = id;
    s.games.push({ id, t: Date.now(), diff: store.session.difficulty, color: store.session.humanColor, result, moves: sanHistory().length, pgn: game.pgn(), ending });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    Persist.setJson("stats", s);
    renderStats();
    checkNewAchievements();
    offerReview(); // resignation and flag-fall end a game just as much as mate
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
    if (loss >= 300) toast(tf("mm.blunder", [p.san]));
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
      sync();
      toast(t("msg.draw.offerDeclined"));
    }
  }

  function acceptDraw() {
    invalidateEngine();
    store.game.drawAgreed = true;
    Audio2.playDraw();
    if (store.session.mode === "ai") recordAgreedDraw();
    saveGame();
    store.commit("game", "action");
    toast(t("msg.draw.agreed"));
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
    toast(reason === "threefold" ? t("msg.draw.claimedRepetition") : t("msg.draw.claimedFiftyMove"));
  }

  // --- FEN / PGN I/O ---
  async function copyText(text, okMsg) {
    try { await Host.writeClipboard(text); toast(okMsg); }
    catch (_) { toast(t("msg.copy.failed"), "fault"); }
  }

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

  /** Standard-conforming PGN: Seven Tag Roster + result token appended. */
  function pgnForExport() {
    // Names for the PGN tag, one per DIFF_IDS rung. This was a hand-written
    // object that predated the 1.19 "casual" rung and never grew one, so a
    // casual game exported as "Stockfish 18 (casual)" — the raw id leaking into
    // a file other programs read. The self-check now requires an entry here for
    // every rung, so the next tier cannot slip through the same way.
    const DIFF_EN = {
      beginner: "Beginner", casual: "Casual", easy: "Easy",
      normal: "Normal", hard: "Hard", extreme: "Max",
    };
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const engineName = "Stockfish 18 (" + (DIFF_EN[store.session.difficulty] || store.session.difficulty) + ")";
    const white = store.session.mode === "ai" ? (store.session.humanColor === "w" ? "Player" : engineName) : "Player 1";
    const black = store.session.mode === "ai" ? (store.session.humanColor === "b" ? "Player" : engineName) : "Player 2";
    const result = gameResultToken();
    const tagPairs = [
      ["Event", "Casual game"],
      ["Site", "Chessboard"],
      ["Date", d.getFullYear() + "." + p(d.getMonth() + 1) + "." + p(d.getDate())],
      ["Round", "-"],
      ["White", white],
      ["Black", black],
      ["Result", result],
    ];
    const tc = parseTc(store.game.timeControl);
    tagPairs.push(["TimeControl", tc ? tc.base + (tc.inc ? "+" + tc.inc : "") : "-"]);
    if (result !== "*") {
      tagPairs.push(["Termination", store.game.flagFall ? "time forfeit" : "normal"]);
    }
    const sf = startFen();
    if (sf) tagPairs.push(["SetUp", "1"], ["FEN", sf]);
    const tags = tagPairs.map(([k, v]) => "[" + k + " \"" + v + "\"]").join("\n");
    // game.pgn() may itself carry SetUp/FEN headers — keep only its movetext,
    // wrapped to the PGN-recommended 80 columns
    const tokens = (game.pgn().split("\n\n").pop() + " " + result).split(/\s+/).filter(Boolean);
    const lines = [];
    let line = "";
    for (const tk of tokens) {
      if (line && line.length + 1 + tk.length > 80) { lines.push(line); line = tk; }
      else line = line ? line + " " + tk : tk;
    }
    if (line) lines.push(line);
    return tags + "\n\n" + lines.join("\n") + "\n";
  }

  function pgnFileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return "chess-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".pgn";
  }

  async function downloadPgn() {
    if (!sanHistory().length) { toast(t("msg.export.noGame"), "fix"); return; }
    const pgn = pgnForExport();
    const name = pgnFileName();
    if (Host.hasZero()) {
      try {
        const path = await Host.saveFileDialog({ title: t("dlg.exportPgn"), defaultName: name });
        if (path == null) { toast(t("msg.export.cancelled")); return; }
        await Host.writeTextFile(path, pgn);
        await Host.revealPath(path);
        Host.addRecentDocument(path);
        toast(t("msg.export.done") + name);
        return;
      } catch (_) {}
    }
    try {
      const blob = new Blob([pgn], { type: "application/x-chess-pgn" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast(t("msg.export.done") + name);
    } catch (_) {
      copyText(pgn, t("msg.export.restrictedCopied"));
    }
  }

  // --- taking the review away ---------------------------------------------
  // The report is the most useful thing this app produces, and until now it
  // could only be looked at. Exporting the PGN hands somebody a move list and
  // makes them find their own software before they can see which move you mean.
  // A picture carries the conclusion.

  /** Draw the finished review onto an offscreen canvas. @returns {HTMLCanvasElement|null} */
  /**
   * The exported review image.
   *
   * Three things this is not allowed to be, each of which it was:
   *
   * **Theme-coloured.** It used to paint on `--card` — a 3–4% white overlay in
   * the wood and night themes — with `--text` on top. Exported from either, the
   * PNG is near-white text on near-white, and dropping it into any document
   * with a white background produced a blank rectangle. An exported file leaves
   * the app; it cannot inherit the app's assumptions about what is behind it.
   * So the palette here is opaque, fixed, and the same from all four themes.
   * 缺陷 2.
   *
   * **Written for the screen.** The turning-point line ended "—— 点此跳转",
   * true of the panel and nonsense in a file, and it was removed by a regex
   * that only worked because Chinese and Japanese use a full-width dash: the
   * English build shipped "tap to jump" printed on the image. Two keys now, no
   * regex. 缺陷 5.
   *
   * **Unmeasured.** Nine fillText calls, no measureText, no wrapping, on a
   * fixed 820px canvas. The Japanese side line runs about a third longer than
   * the Chinese one, and over-long text did not ellipsize — it left the canvas
   * and was gone. 缺陷 21.
   */
  const REPORT_FONT = "system-ui, -apple-system, 'Helvetica Neue', 'PingFang SC', 'Hiragino Kaku Gothic ProN', sans-serif";
  /**
   * Fixed, opaque, and nothing to do with the interface theme.
   *
   * Light, because a shared image lands on a white page far more often than a
   * dark one, and because these values can then be checked for contrast once
   * rather than four times.
   */
  const REPORT_INK = {
    bg: "#fbfaf7", fg: "#1b1a17", muted: "#6b675e",
    accent: "#8a5a1e", line: "#d9d4c8",
  };

  function renderReportCanvas() {
    const a = analysisFor();
    const R = ChessReview;
    if (!a || !R) return null;
    const first = startFen() && startFen().split(" ")[1] === "b" ? "b" : "w";
    const sum = R.summarize(a.scalars, sanHistory(), first);
    if (!sum) return null;

    const S = 2; // fixed scale: the file should not depend on the player's screen
    const W = 900, H = 520;
    const cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);
    const { bg, fg, muted, accent, line } = REPORT_INK;
    const font = (spec) => { ctx.font = spec + " " + REPORT_FONT; };

    /**
     * Draw text that is guaranteed to be inside the image.
     *
     * Wraps at `maxW` and, if it still does not fit in `maxLines`, ends the
     * last line with an ellipsis. Returns the y after the last line, so the
     * caller can lay out what comes next instead of assuming a height.
     */
    function text(str, x, y, maxW, maxLines, lh) {
      const words = String(str).split(/(\s+)/);
      const lines = [];
      let cur = "";
      for (const w of words) {
        const next = cur + w;
        // CJK has no spaces to break on, so fall back to breaking per character
        if (ctx.measureText(next).width <= maxW || !cur) { cur = next; continue; }
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      }
      if (cur) lines.push(cur.trimEnd());
      const out = [];
      for (const l of lines) {
        if (ctx.measureText(l).width <= maxW) { out.push(l); continue; }
        let piece = "";
        for (const ch of l) {
          if (ctx.measureText(piece + ch).width > maxW) { out.push(piece); piece = ch; }
          else piece += ch;
        }
        if (piece) out.push(piece);
      }
      const shown = out.slice(0, maxLines || out.length);
      if (out.length > shown.length && shown.length) {
        let last = shown[shown.length - 1];
        while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
        shown[shown.length - 1] = last + "…";
      }
      shown.forEach((l, i) => ctx.fillText(l, x, y + i * (lh || 20)));
      return y + shown.length * (lh || 20);
    }

    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = fg;
    font("600 26px");
    ctx.fillText(t("rv.title"), 40, 56);

    font("15px");
    ctx.fillStyle = muted;
    const opening = openingFor(sanHistory().length);
    const head = [opening ? openingName(opening[1]) : null, statusText(),
      tf("mm.plies", [sanHistory().length])].filter(Boolean).join("  ·  ");
    text(head, 40, 84, W - 80, 2, 20);

    // one line of context: which level, which colour, when
    font("13px");
    const when = new Date().toISOString().slice(0, 10);
    const ctxLine = [DIFF_NAMES[store.session.difficulty] || store.session.difficulty,
      t(store.session.humanColor === "w" ? "color.white" : "color.black"), when]
      .filter(Boolean).join("  ·  ");
    ctx.fillStyle = muted;
    text(ctxLine, 40, 106, W - 80, 1, 18);

    // the curve, same shape and cut-off as the one on screen
    const cx0 = 40, cy0 = 130, cw = W - 80, ch = 150;
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, cy0 + ch / 2); ctx.lineTo(cx0 + cw, cy0 + ch / 2); ctx.stroke();
    const n = a.scalars.length - 1, CAP = 500;
    const JC = judgeColours();
    const px = (i) => (n ? cx0 + (i / n) * cw : cx0 + cw / 2);
    const py = (sv) => cy0 + ch / 2 - (Math.max(-CAP, Math.min(CAP, sv)) / CAP) * (ch / 2 - 4);
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const sv = a.scalars[i];
      if (sv == null) { pen = false; continue; }
      if (pen) ctx.lineTo(px(i), py(sv)); else { ctx.moveTo(px(i), py(sv)); pen = true; }
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      if (!R.isMistake(a.tags[i]) || a.tags[i] === "?!") continue;
      const sv = a.scalars[i + 1];
      if (sv == null) continue;
      ctx.fillStyle = a.tags[i] === "??" ? JC.bad : JC.mid;
      ctx.beginPath(); ctx.arc(px(i + 1), py(sv), 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // the numbers, one column per side — each column measured, so the longer
    // Japanese line wraps inside its column instead of into the other one
    const rowY = cy0 + ch + 46;
    const colW = cw / 2 - 20;
    for (const [k, side] of [[0, "w"], [1, "b"]]) {
      const x = 40 + k * (cw / 2);
      ctx.fillStyle = fg;
      font("600 15px");
      ctx.fillText(side === "w" ? t("side.black") : t("side.white"), x, rowY);
      font("14px");
      ctx.fillStyle = muted;
      const c = sum.counts[side];
      text(tf("rv.sideLine", [
        sum.acc[side] == null ? "—" : sum.acc[side], sum.acpl[side] == null ? "—" : sum.acpl[side],
        c.inaccuracy, c.mistake, c.blunder,
      ]), x, rowY + 24, colW, 3, 19);
    }
    if (sum.worst) {
      font("14px");
      ctx.fillStyle = accent;
      // the Plain key, not the panel's line with its "tap to jump" tail
      text(tf("rv.turningPointPlain", [sum.worst.moveNo,
        sum.worst.side === "w" ? t("side.black") : t("side.white"), sum.worst.san,
        (sum.worst.loss / 100).toFixed(1)]), 40, rowY + 100, cw, 2, 20);
    }
    font("12px");
    ctx.fillStyle = muted;
    ctx.fillText(t("brand"), 40, H - 24);
    return cv;
  }

  /** Base64 payload of a canvas PNG, without the data: prefix. */
  function canvasPngBase64(cv) {
    const url = cv.toDataURL("image/png");
    const at = url.indexOf(",");
    return at < 0 ? "" : url.slice(at + 1);
  }

  function reportFileName() {
    return pgnFileName().replace(/\.pgn$/, "") + ".png";
  }

  async function exportReport() {
    const cv = renderReportCanvas();
    if (!cv) { toast(t("rv.noReport")); return; }
    const name = reportFileName();
    const b64 = canvasPngBase64(cv);
    // the bridge refuses base64 past 512 KiB; a report this size is nowhere
    // near it, but falling back beats failing
    if (Host.hasZero() && b64 && b64.length < 512 * 1024) {
      try {
        const path = await Host.saveFileDialog({ title: t("rv.exportTitle"), defaultName: name });
        if (path == null) { toast(t("msg.export.cancelled")); return; }
        await Host.writeBinaryFile(path, b64);
        await Host.revealPath(path);
        toast(t("msg.export.done") + name);
        return;
      } catch (_) { /* fall through to the browser path */ }
    }
    try {
      const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
      if (!blob) throw new Error("no blob");
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 2000);
      toast(t("msg.export.done") + name);
    } catch (_) { toast(t("msg.file.readFailed"), "fault"); }
  }

  /**
   * One question, asked once, on a genuinely fresh install.
   *
   * Everything the app has for a beginner — the interactive course, the Beginner
   * engine that makes real mistakes on purpose — was reachable only by someone
   * who already knew to go looking. Until 1.7 the first screen was a 1700-rated
   * Stockfish, which is exactly the "hard to get started" complaint the whole
   * teaching side was built to answer.
   *
   * Dismissing the dialog leaves the player where they already are, so this can
   * never trap anyone: the worst case is the old behaviour.
   */
  async function runOnboarding() {
    const choice = await pickFromList(t("ob.title"), [
      { label: t("ob.newLabel"), sub: t("ob.newSub") },
      { label: t("ob.knowLabel"), sub: t("ob.knowSub") },
    ]);
    if (choice == null) return; // cancelled — leave the defaults alone
    if (choice === 0) {
      store.session.mode = "learn";
      startLearn();
    } else {
      // they can play, but "normal" is Elo 1700 — start a rung lower and let
      // the difficulty row (now visible) speak for itself. The engine reads
      // `difficulty` at search time, so setting it here is enough.
      store.session.mode = "ai";
      store.session.difficulty = "easy";
    }
    setPanelOpen(true);
    saveSettings();
    sync();
    toast(choice === 0 ? t("ob.toLearn") : tf("ob.toPlay", [diffName(store.session.difficulty)]));
    if (choice !== 0) maybeEngineTurn();
  }

  function pickFromList(title, items) {
    const modal = document.getElementById("pick-modal");
    const list = document.getElementById("pick-list");
    const titleEl = document.getElementById("pick-title");
    if (!modal || !list) return Promise.resolve(items.length ? 0 : null);
    if (titleEl) titleEl.textContent = title;
    list.replaceChildren();
    items.forEach((it, i) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pick-item";
      b.dataset.i = String(i);
      b.textContent = it.label;
      if (it.sub) {
        const s = document.createElement("span");
        s.className = "pick-sub";
        s.textContent = it.sub;
        b.appendChild(s);
      }
      list.appendChild(b);
    });
    Dlg.open(modal, list.querySelector(".pick-item"));
    return new Promise((resolve) => { store.ui.pickResolver = resolve; });
  }
  function finishPick(v) {
    const modal = document.getElementById("pick-modal");
    Dlg.close(modal);
    if (store.ui.pickResolver) { store.ui.pickResolver(v); store.ui.pickResolver = null; }
  }

  /**
   * @param {string} text PGN
   * @param {string} label where it came from (for the toast)
   * @param {object} [prompt] override the replace-current-game confirmation.
   * Loading a save slot goes through the same import path, but telling the
   * user "Import PGN — importing replaces the current game" when they clicked
   * a save slot describes the plumbing rather than what they did.
   */
  async function importPgnText(text, label, prompt) {
    let text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return false; }
    // A PGN file may hold a whole database — importing only the last game (the
    // old behaviour) silently threw away everything before it.
    const games = ChessPgn ? ChessPgn.splitGames(text0) : [text0];
    if (games.length > 1) {
      const items = games.map((g, i) => {
        const s = ChessPgn.summary(g);
        return {
          label: (i + 1) + ". " + s.white + " — " + s.black + "  " + s.result,
          sub: [s.event, s.date, s.plies ? tf("mm.plies", [s.plies]) : ""].filter(Boolean).join(" · "),
        };
      });
      const pick = await pickFromList(tf("dlg.pickGame", [games.length]), items);
      if (pick == null) { toast(t("msg.import.cancelled")); return false; }
      text0 = games[pick];
    }
    const ask = prompt || { msg: t("dlg.importPgn"), title: t("dlg.importPgnTitle"), ok: t("dlg.import") };
    if (sanHistory().length &&
        !(await confirmNative(ask.msg, ask.title, { ok: ask.ok, cancel: t("act.cancel") }))) {
      return false;
    }
    const probe = new Chess();
    const parsed = probe.load_pgn(text0, { sloppy: true }) && probe.history().length > 0;
    // A game exported before its first move is legal PGN with no movetext, and
    // it is what a save slot or an export holds for a study position. chess.js
    // will not parse that shape, so fall back to its [SetUp]/[FEN] tags rather
    // than call the file malformed.
    const importFen = parsed ? null : (ChessPgn ? ChessPgn.startFen(text0) : null);
    if (!parsed && (!importFen || !new Chess().validate_fen(importFen).valid)) {
      toast(t("msg.import.badPgn"), "fault");
      return false;
    }
    invalidateEngine();
    stopEditor();
    if (parsed) {
      gameLoadPgn(text0, { sloppy: true });
    } else {
      gameLoad(importFen);
      game.header("SetUp", "1", "FEN", importFen);
    }
    store.game.selection = null;
    store.game.viewIndex = sanHistory().length;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
    resetClocks();
    syncAutoFlip();
    store.commit("game", "action");
    saveGame();
    toast(sanHistory().length
      ? t("msg.import.donePrefix") + moveCount(Math.ceil(sanHistory().length / 2))
      : t("mm.positionLoaded"));
    maybeEngineTurn();
    return true;
  }

  async function pastePgn() {
    try {
      // Host bridge first: the packaged WebView may not grant the page
      // clipboard-read permission, but the native side always can.
      const text = await Host.readClipboard();
      importPgnText(text, t("mm.clipboard"));
    } catch (_) {
      toast(t("msg.clipboard.readFailed"), "fault");
    }
  }

  /**
   * Toast for a failed host-side read. An oversized file gets its own words:
   * it is the one failure the player can act on, and lumping it in with
   * "could not open the file" is what made a truncated PGN library look like
   * a corrupt one.
   */
  function toastReadFailure(err) {
    if (err && err.name === Host.FILE_TOO_LARGE) {
      toast(tf("mm.fileTooLarge", [Math.floor((err.limit || 0) / 1024)]));
      return;
    }
    toast(t("msg.file.readFailed"), "fault");
  }

  /** Open a .pgn file: native dialog via the host bridge, <input> in browsers. */
  async function openPgnFile() {
    if (Host.hasZero()) {
      try {
        const picked = await Host.openFileDialog({ title: t("dlg.openPgn") });
        const paths = Host.normalizePaths(picked);
        if (!paths.length) return; // cancelled
        const text = await Host.readTextFile(paths[0]);
        importPgnText(text, paths[0]);
        Host.addRecentDocument(paths[0]);
      } catch (err) {
        toastReadFailure(err);
      }
      return;
    }
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".pgn,.txt";
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = () => importPgnText(String(reader.result || ""), f.name);
      reader.readAsText(f);
    };
    input.click();
  }

  // --- position editor + FEN loading ---
  const PALETTE = [
    ["w", "k"], ["w", "q"], ["w", "r"], ["w", "b"], ["w", "n"], ["w", "p"], ["", ""],
    ["b", "k"], ["b", "q"], ["b", "r"], ["b", "b"], ["b", "n"], ["b", "p"], ["", ""],
  ];
  const PALETTE_GLYPH = {
    wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
    bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
  };

  function editorModel() {
    return {
      position: store.session.editor.board,
      flipped: store.game.flipped,
      selected: null,
      legalTargets: [],
      lastMove: null,
      checkSquare: null,
      hintMove: null,
      stars: [],
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  function startEditor() {
    const Ed = ChessEditor;
    if (!Ed) { toast(t("msg.editor.unavailable"), "fault"); return; }
    invalidateEngine();
    store.session.editor = Ed.fromFen(viewGame().fen(), Chess);
    store.session.editor.brush = { color: "w", type: "p" };
    store.game.selection = null;
    BoardView.cancelAnim();
    renderEditorPalette();
    sync();
    toast(t("msg.editor.hint"), "fix");
  }

  /**
   * Leave edit mode.
   *
   * Every path that changes what the board means — switching mode, starting a
   * new game, loading a position, clearing the save — must go through here.
   * The editor owns the board model while it is open, so an editor left behind
   * by a mode switch renders its own board *over* the lesson or game that just
   * started (v1.4 shipped exactly that: an empty board on top of a live lesson).
   * @param {string} [note] toast to show when the editor was actually open
   * @returns {boolean} true when an open editor was closed
   */
  function stopEditor(note) {
    if (!store.session.editor) return false;
    store.session.editor = null;
    if (note) toast(note);
    return true;
  }

  function renderEditorPalette() {
    const el = document.getElementById("editor-palette");
    if (!el || !store.session.editor) return;
    el.replaceChildren();
    for (const [color, type] of PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      if (!color) {
        b.dataset.erase = "1";
        b.textContent = "✕";
        b.title = t("ed.eraser");
        b.classList.toggle("active", store.session.editor.brush.type === "");
      } else {
        b.dataset.color = color;
        b.dataset.type = type;
        b.textContent = PALETTE_GLYPH[color + type];
        b.classList.toggle("active", store.session.editor.brush.color === color && store.session.editor.brush.type === type);
      }
      el.appendChild(b);
    }
  }

  function editorClick(sq) {
    const Ed = ChessEditor;
    const { r, c } = Ed.indexOf(sq);
    const cur = store.session.editor.board[r][c];
    if (store.session.editor.brush.type === "") {
      store.session.editor.board[r][c] = null;
    } else if (cur && cur.color === store.session.editor.brush.color && cur.type === store.session.editor.brush.type) {
      store.session.editor.board[r][c] = null; // tapping the same piece again clears the square
    } else {
      store.session.editor.board[r][c] = { type: store.session.editor.brush.type, color: store.session.editor.brush.color };
    }
    syncEditorUI();
    draw();
  }

  function syncEditorUI() {
    const sec = document.getElementById("sec-editor");
    if (!sec) return;
    sec.hidden = !store.session.editor;
    if (!store.session.editor) return;
    document.querySelectorAll("#editor-turn button").forEach((b) => {
      b.classList.toggle("active", b.dataset.turn === store.session.editor.turn);
    });
    document.querySelectorAll("#editor-castling button").forEach((b) => {
      b.classList.toggle("active", !!store.session.editor.castling[b.dataset.cr]);
    });
    const epRow = document.getElementById("row-ed-ep");
    const epSeg = document.getElementById("editor-ep");
    const cands = ChessEditor.epCandidates(store.session.editor);
    if (epRow) epRow.hidden = !cands.length;
    if (epSeg && cands.length) {
      epSeg.replaceChildren();
      for (const sqName of [null, ...cands]) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.ep = sqName || "";
        b.textContent = sqName || t("ed.epNone");
        b.classList.toggle("active", (store.session.editor.ep || null) === sqName);
        epSeg.appendChild(b);
      }
    }
    if (!cands.length && store.session.editor.ep) store.session.editor.ep = null;
    const err = document.getElementById("editor-error");
    const reason = ChessEditor.validate(store.session.editor, Chess);
    if (err) err.textContent = reason ? t(reason) : "";
    const apply = document.getElementById("editor-apply");
    if (apply) apply.disabled = !!reason;
  }

  /** Load `fen` as a fresh game whose history starts from that position. */
  function loadFenAsGame(fen, note) {
    stopEditor();
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    gameLoad(fen);
    game.header("SetUp", "1", "FEN", fen);
    store.game.selection = null;
    store.game.viewIndex = 0;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
    store.session.analysis = null;
    store.game.recordedId = null;
    resetClocks();
    syncAutoFlip();
    sync();
    saveGame();
    toast(note || t("mm.positionLoaded"));
    maybeEngineTurn();
  }

  function applyEditor() {
    const Ed = ChessEditor;
    const reason = Ed.validate(store.session.editor, Chess);
    if (reason) { toast(t(reason)); return; }
    const fen = Ed.toFen(store.session.editor);
    stopEditor();
    loadFenAsGame(fen, t("msg.editor.started"));
  }

  const fenModal = document.getElementById("fen-modal");
  function openFenModal() {
    if (!fenModal) return;
    const input = document.getElementById("fen-input");
    const err = document.getElementById("fen-error");
    if (input) { input.value = viewGame().fen(); input.classList.remove("bad"); }
    if (err) err.textContent = "";
    Dlg.open(fenModal, input);
    if (input) input.select();
  }
  function closeFenModal() { Dlg.close(fenModal); }

  function submitFen() {
    const input = document.getElementById("fen-input");
    const err = document.getElementById("fen-error");
    const raw = (input && input.value || "").trim();
    const show = (msg) => {
      if (err) err.textContent = msg;
      if (input) input.classList.add("bad");
    };
    if (!raw) { show(t("msg.fen.empty")); return; }
    const v = new Chess().validate_fen(raw);
    if (!v.valid) { show(v.error || t("msg.fen.invalid")); return; }
    // chess.js accepts positions no game could reach (no kings, a side already
    // in check while its opponent moves) — reuse the editor's stricter rules,
    // then load the ORIGINAL fen so its en-passant square and clocks survive.
    const reason = ChessEditor
      ? ChessEditor.validate(ChessEditor.fromFen(raw, Chess), Chess)
      : null;
    if (reason) { show(t(reason)); return; }
    closeFenModal();
    loadFenAsGame(new Chess(raw).fen(), t("msg.fen.loaded"));
  }

  // --- named save slots -------------------------------------------------
  // The autosave holds exactly one game, so studying a second position meant
  // losing the first. Slots are explicit, user-named storage on top of it.
  const SLOT_COUNT = 5;

  function loadSlots() {
    try {
      const s = JSON.parse(Persist.get("slots") || "null");
      if (s && Array.isArray(s.slots)) return s;
    } catch (_) {}
    return { v: 1, slots: new Array(SLOT_COUNT).fill(null) };
  }
  function saveSlots(s) {
    Persist.setJson("slots", s);
  }

  /**
   * A slot's one-line description, localised *at render time*.
   *
   * Slots store the mode and difficulty ids rather than a finished label, so a
   * game saved in Chinese still reads as English after a language switch;
   * `slot.label` is only the fallback for slots written before 1.6.
   */
  function slotSummary(slot) {
    if (!slot) return t("slots.empty");
    const P = ChessPgn;
    const s = P ? P.summary(slot.pgn) : null;
    const when = slot.savedAt ? new Date(slot.savedAt).toLocaleString() : "";
    const moves = s && s.plies ? moveCount(Math.ceil(s.plies / 2)) : "";
    const what = slot.mode
      ? t(slot.mode === "ai" ? "mode.ai" : "mode.pvp") + (slot.mode === "ai" ? " · " + diffName(slot.diff) : "")
      : slot.label || "";
    return [what, moves, when].filter(Boolean).join(" · ");
  }

  /** "1 move" / "12 moves" — a count needs its own plural form in English. */
  function moveCount(n) {
    return tf(n === 1 ? "mm.moveCount.one" : "mm.moveCount.other", [n]);
  }

  function renderSlots() {
    const list = document.getElementById("slots-list");
    if (!list) return;
    const st = loadSlots();
    list.replaceChildren();
    for (let i = 0; i < SLOT_COUNT; i++) {
      const slot = st.slots[i];
      const row = document.createElement("div");
      row.style.cssText = "display:flex;gap:6px;align-items:stretch";
      const load = document.createElement("button");
      load.type = "button";
      load.className = "pick-item";
      load.style.flex = "1";
      load.dataset.load = String(i);
      load.disabled = !slot;
      load.textContent = t("slots.slot") + (i + 1);
      const sub = document.createElement("span");
      sub.className = "pick-sub";
      sub.textContent = slotSummary(slot);
      load.appendChild(sub);
      const save = document.createElement("button");
      save.type = "button";
      save.className = "tool-btn";
      save.dataset.save = String(i);
      save.textContent = t("slots.save");
      row.append(load, save);
      if (slot) {
        const del = document.createElement("button");
        del.type = "button";
        del.className = "tool-btn";
        del.dataset.del = String(i);
        del.textContent = t("slots.delete");
        row.appendChild(del);
      }
      list.appendChild(row);
    }
  }

  function openSlots() {
    renderSlots();
    Dlg.open(document.getElementById("slots-modal"));
  }
  function closeSlots() {
    Dlg.close(document.getElementById("slots-modal"));
  }

  function saveToSlot(i) {
    // a set-up position with no moves yet is exactly the thing worth parking
    // in a slot, so "nothing to save" means neither moves nor a custom start
    if (!sanHistory().length && !startFen()) { toast(t("slots.nothing")); return; }
    const st = loadSlots();
    st.slots[i] = {
      pgn: pgnForExport(),
      savedAt: Date.now(),
      mode: store.session.mode,
      diff: store.session.difficulty,
    };
    saveSlots(st);
    renderSlots();
    toast(t("slots.saved") + (i + 1));
  }

  async function loadFromSlot(i) {
    const st = loadSlots();
    const slot = st.slots[i];
    if (!slot) return;
    closeSlots();
    const ok = await importPgnText(slot.pgn, t("slots.slot") + (i + 1),
      { msg: t("dlg.loadSlot"), title: t("dlg.loadSlotTitle"), ok: t("dlg.loadSlotOk") });
    if (ok) toast(t("slots.loaded") + (i + 1));
  }

  function deleteSlot(i) {
    const st = loadSlots();
    st.slots[i] = null;
    saveSlots(st);
    renderSlots();
    toast(t("slots.deleted") + (i + 1));
  }

  /**
   * Captured pieces beside each name, and a `+N` on whoever is ahead.
   *
   * Follows the replay cursor rather than the live game: scrubbing back to
   * "where did it go wrong" and seeing the material as it stood at that move
   * is most of the point. In the puzzle and lesson modes the pieces on the
   * board are a constructed exercise, not a game's remains, so it stays empty.
   */
  /**
   * The card that stands in for an empty notation list.
   *
   * At move 0 the play tab had nothing to show below the replay bar — measured
   * on 1.12, 239px of a 619px pane, which is 39% and is also the very first
   * screen of every new game and of every new install. Nothing here is new
   * information: the last result and the running record come out of the same
   * statistics the record tab reads, and the suggestion is `recommendation()`,
   * which until now only ever appeared on a tab most players never open.
   */
  function renderIdleCard() {
    const el = document.getElementById("idle-card");
    if (!el) return;
    // only on an untouched board in a real game — lessons and puzzles have
    // their own copy filling this space
    const show = (store.session.mode === "ai" || store.session.mode === "pvp") && !sanHistory().length && !store.session.editor;
    el.hidden = !show;
    if (!show) return;
    el.replaceChildren();
    const line = (k, v) => {
      const row = document.createElement("div");
      row.className = "idle-line";
      const a = document.createElement("span");
      a.className = "idle-k";
      a.textContent = k;
      const b = document.createElement("span");
      b.className = "idle-v";
      b.textContent = v;
      row.append(a, b);
      el.appendChild(row);
    };
    const st = loadStats();
    const games = st.games || [];
    const last = games[games.length - 1];
    if (last) {
      line(t("idle.last"), historyLabel(last) + " · " + historyWhen(last.t));
      const mine = games.filter((g) => g.diff === store.session.difficulty);
      const w = mine.filter((g) => g.result === "win").length;
      const l = mine.filter((g) => g.result === "loss").length;
      const d = mine.length - w - l;
      if (mine.length) line(diffName(store.session.difficulty), tf("stats.wld", [w, l, d]));
    } else {
      line(t("idle.ready"), t(store.session.mode === "ai" ? "idle.vsEngine" : "idle.vsHuman"));
    }
    const rec = recommendation();
    const tip = document.createElement("div");
    tip.className = "idle-rec";
    tip.textContent = rec || t("idle.tip");
    el.appendChild(tip);
  }

  function renderMaterial() {
    const Mat = ChessMaterial;
    const wEl = document.getElementById("taken-w");
    const bEl = document.getElementById("taken-b");
    if (!wEl || !bEl) return;
    const off = store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
    if (!Mat || off) { wEl.replaceChildren(); bEl.replaceChildren(); return; }
    const shown = viewGame();
    const promos = verboseHistory().slice(0, store.game.viewIndex)
      .filter((m) => m.promotion).map((m) => ({ color: m.color, promotion: m.promotion }));
    const s = Mat.summary(baseGame().board(), shown.board(), promos);
    const svgs = CHESS_PIECE_SVGS || {};
    // Built as nodes rather than concatenated markup. The pieces are vendored
    // SVG text and the lead is a number, so nothing here was ever hostile —
    // but "build a string and hand it to the parser" is a habit, and the two
    // places it mattered (the move list, the history rows) learned it here.
    const strip = (parent, list, color, lead) => {
      const kids = [];
      for (const tp of list) {
        const svg = svgs[color + tp];
        if (!svg) continue;
        const span = document.createElement("span");
        span.className = "taken-p";
        // the sprite set is our own file, not input — parsed once per piece
        span.insertAdjacentHTML("afterbegin", svg);
        kids.push(span);
      }
      if (lead > 0) {
        const d = document.createElement("span");
        d.className = "taken-diff";
        d.textContent = "+" + lead;
        kids.push(d);
      }
      parent.replaceChildren(...kids);
    };
    // White's row shows the black pieces White has taken
    strip(wEl, s.w, "b", s.diff);
    strip(bEl, s.b, "w", -s.diff);
  }

  // --- panel tabs ---
  //
  // Until 1.9 the panel was one 1788px scroll in a 900px window, ordered by
  // when a setting is chosen rather than by how often it is used: theme and
  // language sat above the fold while the move list, the replay bar and this
  // game's own actions all started below it. Three tabs split it by what the
  // player is doing — playing, configuring, or looking back.
  const TABS = ["play", "setup", "record"];

  function setSideTab(id, opts) {
    const want = TABS.includes(id) ? id : "play";
    store.ui.sideTab = want;
    for (const t of TABS) {
      const btn = document.getElementById("tab-" + t);
      const pane = document.getElementById("pane-" + t);
      if (btn) btn.setAttribute("aria-selected", t === want ? "true" : "false");
      if (pane) {
        pane.hidden = t !== want;
        // a pane left scrolled half-way reads as a broken tab when you return
        if (t === want && opts && opts.top) pane.scrollTop = 0;
      }
    }
    saveSettings();
  }

  function isPanelOpen() { return appEl.classList.contains("panel-open"); }
  function setPanelOpen(open) {
    const want = !!open;
    appEl.classList.toggle("panel-open", want);
    appEl.classList.toggle("scrim-on", want && window.innerWidth < 900);
    Persist.set("panelOpen", want ? "1" : "0");
    const side = document.getElementById("side");
    if (side) {
      if (want) { side.removeAttribute("inert"); side.setAttribute("aria-hidden", "false"); }
      else {
        side.setAttribute("inert", "");
        side.setAttribute("aria-hidden", "true");
        if (side.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
      }
    }
    // the spine and the status pill both read "is the panel open"
    store.commit("ui", "panel");
    requestAnimationFrame(() => { BoardView.resizeCanvas(); draw(); });
  }
  function togglePanel() { setPanelOpen(!isPanelOpen()); }

  /** Re-render every translated label; dynamic text comes back via sync(). */
  function applyLanguage() {
    if (!I18n) return;
    I18n.apply(document);
    document.documentElement.setAttribute("lang", store.ui.langId);
    const seg = document.getElementById("lang-seg");
    if (seg) {
      seg.replaceChildren();
      for (const l of I18n.available()) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.lang = l.id;
        b.textContent = l.name;
        b.classList.toggle("active", l.id === store.ui.langId);
        seg.appendChild(b);
      }
    }
    // sync() redraws the board and panels, but the stats and achievement
    // sections render on their own schedule — without these they keep the
    // previous language until the next game finishes
    renderStats();
    renderAchievements();
    if (store.session.editor) renderEditorPalette();
    sync();
  }

  function applyTheme(id) {
    store.ui.themeId = id;
    document.documentElement.setAttribute("data-theme", id);
    // The board palette is its own axis since 1.25 (styles.css, [data-board]).
    // Setting it to the theme's id keeps the pairing exactly as it was — what
    // changed is that it is now a pairing rather than one thing.
    document.documentElement.setAttribute("data-board", id);
    // the board reads its square colours from the same variables, and caches
    // them — the cache is only ever stale here
    if (BoardView.invalidatePaint) BoardView.invalidatePaint();
    saveSettings();
    syncSettingsUI();
    draw();
  }

  // --- events: pointer-driven board (click-click AND drag-drop both work) ---
  function canvasPoint(ev) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left) * (canvas.width / rect.width),
      y: (ev.clientY - rect.top) * (canvas.height / rect.height),
    };
  }
  /** Would a click on `sq` pick up a piece in the current mode? (cursor hint) */
  function grabbableAt(sq) {
    if (store.session.editor) return true; // every square is paintable
    if (store.session.mode === "learn") {
      if (!store.session.learn || store.session.learn.done || store.session.learn.demoing) return false;
      const task = curTask();
      if (task.type === "tap") return false;
      const p = store.session.learn.g.get(sq);
      return !!p && p.color === "w" && store.session.learn.g.turn() === "w" && (!task.only || p.type === task.only);
    }
    if (store.session.mode === "puzzle") {
      if (!store.session.puzzle || store.session.puzzle.done) return false;
      const p = store.session.puzzle.g.get(sq);
      return !!p && p.color === "w" && store.session.puzzle.g.turn() === "w";
    }
    if (!isLive() || appGameOver()) return false;
    if (store.session.mode === "ai" && game.turn() !== store.session.humanColor) return false;
    const p = game.get(sq);
    return !!p && p.color === game.turn();
  }

// {from} armed on pressing one of our selectable pieces

  // right-click clears a square in the editor (no need to switch to the eraser)
  canvas.addEventListener("contextmenu", (ev) => {
    if (!store.session.editor) return;
    ev.preventDefault();
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    if (!sq) return;
    const { r, c } = ChessEditor.indexOf(sq);
    store.session.editor.board[r][c] = null;
    syncEditorUI();
    draw();
  });
  canvas.addEventListener("pointerdown", (ev) => {
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    if (!sq) return;
    try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    onSquareClick(sq);
    // in the editor a press starts a paint stroke: placing 16 pawns one click
    // at a time is exactly the kind of tedium an editor should absorb
    if (store.session.editor) { store.ui.painting = sq; return; }
    store.ui.dragging = store.game.selection && store.game.selection.sq === sq ? { from: sq } : null;
    if (store.ui.dragging) canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (ev) => {
    const p = canvasPoint(ev);
    if (store.ui.painting) {
      const sq = BoardView.cellAt(p.x, p.y);
      if (sq && sq !== store.ui.painting) { store.ui.painting = sq; editorClick(sq); }
      return;
    }
    if (!store.ui.dragging) {
      const sq = BoardView.cellAt(p.x, p.y);
      canvas.style.cursor = sq && grabbableAt(sq) ? "grab" : "default";
      return;
    }
    // tell the board which square the drop would land on, and whether the
    // piece can actually go there — the ring under the pointer is the whole
    // point of dragging rather than clicking twice
    const over = BoardView.cellAt(p.x, p.y);
    const legal = !!(over && store.game.selection && store.game.selection.targets.includes(over));
    if (!store.ui.dragging.x) Audio2.playLift(); // the first move of a drag
    store.ui.dragging = { from: store.ui.dragging.from, x: p.x, y: p.y, over, legal };
    draw();
  });
  canvas.addEventListener("pointerup", (ev) => {
    store.ui.painting = null;
    const wasDrag = store.ui.dragging;
    store.ui.dragging = null;
    canvas.style.cursor = "default";
    if (!wasDrag) return;
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    // A drop that plays nothing sends the piece home rather than letting it
    // blink back onto its square. Read the piece before the click, since the
    // click is what may move it.
    const refused = !sq || sq === wasDrag.from ||
      !(store.game.selection && store.game.selection.targets.includes(sq));
    const held = refused ? viewGame().get(wasDrag.from) : null;
    draw();
    if (sq && sq !== wasDrag.from) onSquareClick(sq); // drop = play/reselect
    if (held) { Audio2.playRefused(); BoardView.reboundDrag(held, wasDrag.from, p.x, p.y); }
  });
  canvas.addEventListener("pointercancel", () => {
    store.ui.painting = null;
    store.ui.dragging = null;
    canvas.style.cursor = "default";
    draw();
  });

  // --- keyboard play: the board is a real focusable control, not just a canvas ---
  const FILE_CHARS = "abcdefgh";
  canvas.setAttribute("tabindex", "0");
  canvas.setAttribute("role", "application");
  canvas.setAttribute("data-i18n-aria", "aria.boardKeys");
  canvas.setAttribute("aria-label", t("aria.boardKeys"));

  function announce(msg) {
    const el = document.getElementById("board-live");
    if (el) el.textContent = msg;
  }

  /** describe a square for screen readers: "e4 · 白兵" / "e4 · 空格" */
  function describeSquare(sq) {
    const g = store.session.editor ? null : (store.session.mode === "learn" && store.session.learn ? store.session.learn.g : store.session.mode === "puzzle" && store.session.puzzle ? store.session.puzzle.g : viewGame());
    let piece = null;
    if (g) piece = g.get(sq);
    else if (store.session.editor) {
      const { r, c } = ChessEditor.indexOf(sq);
      piece = store.session.editor.board[r][c];
    }
    if (!piece) return sq + " · " + t("live.empty");
    return sq + " · " + t(piece.color === "w" ? "vs.white" : "vs.black") + t("piece." + piece.type);
  }

  function moveCursor(df, dr) {
    if (!store.ui.keyboardCursor) store.ui.keyboardCursor = store.game.flipped ? "e5" : "e4";
    let f = FILE_CHARS.indexOf(store.ui.keyboardCursor[0]);
    let r = Number(store.ui.keyboardCursor[1]);
    // arrows follow what the player sees, so they invert with the board
    const sign = store.game.flipped ? -1 : 1;
    f = Math.max(0, Math.min(7, f + df * sign));
    r = Math.max(1, Math.min(8, r + dr * sign));
    store.ui.keyboardCursor = FILE_CHARS[f] + r;
    announce(describeSquare(store.ui.keyboardCursor));
    draw();
  }

  canvas.addEventListener("focus", () => {
    store.ui.boardFocused = true;
    if (!store.ui.keyboardCursor) store.ui.keyboardCursor = store.game.flipped ? "e5" : "e4";
    announce(t("live.focused") + " · " + describeSquare(store.ui.keyboardCursor));
    draw();
  });
  canvas.addEventListener("blur", () => { store.ui.boardFocused = false; draw(); });

  canvas.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    // A dialog outranks the board. The promotion chooser is the case that
    // matters: it can only be opened by a move made on the board, so the board
    // always holds focus when it appears — and the board used to swallow the
    // Escape that was supposed to dismiss it, which meant Escape never once
    // worked on the one dialog every player meets. Same fault as the FEN field
    // in 1.10; that one got fixed and this one was missed.
    if (dialogOpen()) return;
    // arrows/Home/End also drive replay from the window handler — while the
    // board itself is focused they belong to the cursor, so stop them here
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "Enter", " ", "Escape"].includes(ev.key)) {
      ev.stopPropagation();
    }
    switch (ev.key) {
      case "ArrowLeft": ev.preventDefault(); moveCursor(-1, 0); return;
      case "ArrowRight": ev.preventDefault(); moveCursor(1, 0); return;
      case "ArrowUp": ev.preventDefault(); moveCursor(0, 1); return;
      case "ArrowDown": ev.preventDefault(); moveCursor(0, -1); return;
      case "Home": ev.preventDefault(); store.ui.keyboardCursor = store.game.flipped ? "h1" : "a8"; announce(describeSquare(store.ui.keyboardCursor)); draw(); return;
      case "End": ev.preventDefault(); store.ui.keyboardCursor = store.game.flipped ? "a8" : "h1"; announce(describeSquare(store.ui.keyboardCursor)); draw(); return;
      case "Enter":
      case " ": {
        ev.preventDefault();
        if (!store.ui.keyboardCursor) return;
        const before = store.game.selection ? store.game.selection.sq : null;
        onSquareClick(store.ui.keyboardCursor);
        if (store.game.selection && store.game.selection.sq === store.ui.keyboardCursor && before !== store.ui.keyboardCursor) {
          announce(t("live.selected") + " " + describeSquare(store.ui.keyboardCursor) + " · " + store.game.selection.targets.length + " " + t("live.targets"));
        } else if (!store.game.selection && before) {
          announce(statusText());
        }
        return;
      }
      case "Escape":
        if (store.game.selection) { ev.preventDefault(); store.game.selection = null; announce(t("live.cleared")); draw(); }
        return;
      default:
    }
  });
  canvas.style.touchAction = "none"; // let touch drags move pieces, not the page

  document.getElementById("undo").onclick = undo;
  document.getElementById("btn-hint").onclick = () => { requestHint(); };
  document.getElementById("btn-new").onclick = () => { requestNewGame(); };
  document.getElementById("btn-flip").onclick = () => {
    store.game.flipped = !store.game.flipped;
    saveSettings();
    draw();
    toast(store.game.flipped ? t("msg.view.black") : t("msg.view.white"));
  };
  document.getElementById("toggle-panel").onclick = togglePanel;
  const moreBtn = document.getElementById("more-tools");
  if (moreBtn) {
    moreBtn.onclick = () => {
      const row = document.getElementById("more-row");
      if (!row) return;
      const show = row.hidden;
      row.hidden = !show;
      moreBtn.setAttribute("aria-expanded", show ? "true" : "false");
      // the key moves with the state, so a language switch re-renders the
      // label that matches what the disclosure is actually doing
      moreBtn.setAttribute("data-i18n", show ? "act.less" : "act.more");
      moreBtn.textContent = t(show ? "act.less" : "act.more");
    };
  }
  const tabRow = document.querySelector(".side-tabs");
  if (tabRow) {
    tabRow.onclick = (ev) => {
      const b = ev.target.closest("button[data-tab]");
      if (b) setSideTab(b.dataset.tab, { top: true });
    };
    // ARIA tablist keyboard contract: arrows move between tabs
    tabRow.onkeydown = (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const cur = TABS.indexOf(store.ui.sideTab);
      const next = TABS[(cur + (ev.key === "ArrowRight" ? 1 : TABS.length - 1)) % TABS.length];
      ev.preventDefault();
      setSideTab(next, { top: true });
      const btn = document.getElementById("tab-" + next);
      if (btn) btn.focus();
    };
  }
  document.getElementById("scrim").onclick = () => setPanelOpen(false);

  const mlEl = document.getElementById("move-list");
  if (mlEl) {
    mlEl.onclick = (ev) => {
      const b = ev.target.closest("button[data-i]");
      if (b) setViewIndex(Number(b.dataset.i));
    };
  }
  document.getElementById("rep-start").onclick = () => setViewIndex(0);
  document.getElementById("rep-prev").onclick = () => setViewIndex(store.game.viewIndex - 1);
  document.getElementById("rep-next").onclick = () => setViewIndex(store.game.viewIndex + 1);
  document.getElementById("rep-end").onclick = () => setViewIndex(sanHistory().length);
  document.getElementById("rep-live").onclick = () => { goLive(); toast(t("msg.replay.atLive")); };

  document.getElementById("an-run").onclick = () => {
    if (store.session.analyzing) {
      store.session.analyzeAbort = true;
      if (ChessEngine) ChessEngine.cancel();
      return;
    }
    analyzeGame(120);
  };
  document.getElementById("an-deep").onclick = () => { analyzeGame(400); };
  document.getElementById("retry-here").onclick = () => { retryFromHere(); };
  const curveEl = document.getElementById("eval-curve");
  if (curveEl) {
    curveEl.onclick = (ev) => {
      const a = analysisFor();
      if (!a) return;
      const rect = curveEl.getBoundingClientRect();
      const n = a.scalars.length - 1;
      const frac = (ev.clientX - rect.left - 4) / Math.max(1, rect.width - 8);
      setViewIndex(Math.round(Math.max(0, Math.min(1, frac)) * n));
    };
    curveEl.style.cursor = "pointer";
  }
  document.getElementById("stats-clear").onclick = async () => {
    if (!(await confirmNative(t("dlg.clearStats"), t("dlg.clearStatsTitle"),
      { ok: t("act.clear"), cancel: t("act.cancel") }))) return;
    Persist.remove("stats");
    renderStats();
    renderAchievements();
    toast(t("msg.stats.cleared"));
  };

  document.getElementById("fen-copy").onclick = () => copyText(viewGame().fen(), t("msg.copy.fenDone"));
  document.getElementById("pgn-copy").onclick = () => {
    if (!sanHistory().length) { toast(t("msg.copy.noGame"), "fix"); return; }
    copyText(pgnForExport(), t("msg.copy.pgnDone"));
  };
  const resignEl = document.getElementById("btn-resign");
  if (resignEl) resignEl.onclick = () => { doResign(); };
  const drawEl = document.getElementById("btn-offerdraw");
  if (drawEl) drawEl.onclick = () => { doOfferDraw(); };
  const claimEl = document.getElementById("btn-claimdraw");
  if (claimEl) claimEl.onclick = () => { doClaimDraw(); };
  document.getElementById("pgn-download").onclick = () => { downloadPgn(); };
  const reportBtn = document.getElementById("report-export");
  if (reportBtn) reportBtn.onclick = () => { exportReport(); };
  document.getElementById("pgn-paste").onclick = () => { pastePgn(); };
  document.getElementById("pgn-open").onclick = () => { openPgnFile(); };

  // Drop a .pgn onto the window to import it — host bridge in the packaged
  // app, DataTransfer in browsers.
  Host.onDropFiles(async (payload) => {
    const paths = Host.normalizePaths(payload && payload.paths ? payload.paths : payload);
    const p = paths.find((x) => /\.(pgn|txt)$/i.test(x)) || paths[0];
    if (!p) return;
    try {
      importPgnText(await Host.readTextFile(p), p);
      Host.addRecentDocument(p);
    } catch (err) { toastReadFailure(err); }
  });
  window.addEventListener("dragover", (ev) => ev.preventDefault());
  window.addEventListener("drop", (ev) => {
    ev.preventDefault();
    const f = ev.dataTransfer && ev.dataTransfer.files && ev.dataTransfer.files[0];
    if (!f || !/\.(pgn|txt)$/i.test(f.name)) return;
    const reader = new FileReader();
    reader.onload = () => importPgnText(String(reader.result || ""), f.name);
    reader.readAsText(f);
  });

  // Native lifecycle: flush the save when the app loses focus.
  /**
   * The keyboard reference.
   *
   * Built from a table rather than written into the markup, because the same
   * table is what the native menu is checked against: a shortcut that exists
   * in one place and not the other is exactly the state 1.9 shipped in, when
   * the panel silently moved from Tab to P.
   */
  const KEY_HELP = [
    { keys: ["P"], k: "keys.panel" },
    { keys: ["N"], k: "keys.new" },
    { keys: ["Z"], k: "keys.undo" },
    { keys: ["H"], k: "keys.hint" },
    { keys: ["F"], k: "keys.flip" },
    { keys: ["←", "→"], k: "keys.step" },
    { keys: ["Home", "End"], k: "keys.ends" },
    { keys: ["Tab"], k: "keys.tab" },
    { keys: ["Esc"], k: "keys.esc" },
    { keys: ["?"], k: "keys.help" },
    { keys: ["Q", "R", "B", "N"], k: "keys.promo" },
    { keys: ["↑", "↓", "←", "→", "Enter"], k: "keys.board" },
    { keys: ["R"], k: "keys.retry" },
  ];
  const keysModal = document.getElementById("keys-modal");
  function renderKeyHelp() {
    const list = document.getElementById("keys-list");
    if (!list) return;
    list.replaceChildren();
    for (const row of KEY_HELP) {
      const dt = document.createElement("dt");
      for (const key of row.keys) {
        const kbd = document.createElement("kbd");
        kbd.textContent = key;
        dt.appendChild(kbd);
      }
      const dd = document.createElement("dd");
      dd.textContent = t(row.k);
      list.appendChild(dt);
      list.appendChild(dd);
    }
  }
  function openKeyHelp() {
    if (!keysModal) return;
    renderKeyHelp();
    Dlg.open(keysModal, document.getElementById("keys-close"));
  }
  function closeKeyHelp() { Dlg.close(keysModal); }
  if (keysModal) {
    document.getElementById("keys-close").onclick = closeKeyHelp;
    keysModal.onclick = (ev) => { if (ev.target === keysModal) closeKeyHelp(); };
  }

  /**
   * Native menu commands (app.zon → main.zig → host.js).
   *
   * The menu is the desktop-shaped half of the same actions the letter keys
   * already do; both end up here so there is one implementation and the two
   * can never drift.
   */
  const NATIVE_COMMANDS = {
    "game.new": () => requestNewGame(),
    "game.undo": () => undo(),
    "game.hint": () => requestHint(),
    "game.flip": () => { store.game.flipped = !store.game.flipped; saveSettings(); draw(); },
    "view.panel": () => togglePanel(),
    "view.prev": () => setViewIndex(store.game.viewIndex - 1),
    "view.next": () => setViewIndex(store.game.viewIndex + 1),
    "help.keys": () => openKeyHelp(),
  };
  Host.onAppLifecycle({
    activate: () => { store.ui.appForeground = true; syncClockTimer(); renderClocks(); },
    deactivate: () => { store.ui.appForeground = false; saveGame(); syncClockTimer(); },
    shortcut: (detail) => {
      let id = null;
      try {
        const d = typeof detail === "string" ? JSON.parse(detail) : detail;
        id = d && (d.command || d.id);
      } catch (_) { id = null; }
      const run = id && NATIVE_COMMANDS[id];
      if (run) run();
    },
  });

  document.getElementById("theme-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-theme]");
    if (b) {
      applyTheme(b.dataset.theme);
      toast(t("msg.setting.theme") + t("themeName." + store.ui.themeId));
    }
  };
  document.getElementById("mode-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === store.session.mode) return;
    invalidateEngine();
    stopEditor(t("msg.editor.exited"));
    const wasLearn = store.session.mode === "learn";
    const wasPuzzle = store.session.mode === "puzzle";
    store.session.mode = b.dataset.mode;
    // entering a clocked mode mid-game gets fresh clocks
    store.game.flagFall = null;
    if (store.session.mode === "pvp" || store.session.mode === "ai") resetClocks();
    if (store.session.mode === "learn") startLearn();
    else if (wasLearn) stopLearn();
    if (store.session.mode === "puzzle") startPuzzles();
    else if (wasPuzzle) stopPuzzles();
    // the mode decides what the play tab holds, so show it — otherwise
    // switching to 教学 from the settings tab looks like nothing happened
    setSideTab("play", { top: true });
    saveSettings();
    store.game.selection = null;
    syncAutoFlip();
    sync();
    toast(store.session.mode === "ai" ? t("msg.mode.aiPrefix") + (DIFF_NAMES[store.session.difficulty] || "") :
      store.session.mode === "pvp" ? t("msg.mode.pvp") :
      store.session.mode === "learn" ? t("mm.learnMode") : t("mm.puzzleMode"));
    maybeEngineTurn();
  };
  document.getElementById("lesson-restart").onclick = () => {
    if (store.session.learn) { startLearnTask(); toast(t("lm.restarted")); }
  };
  document.getElementById("lesson-demo").onclick = () => {
    if (!store.session.learn || store.session.learn.demoing) return;
    const task = curTask();
    if (!task.solution || (task.type !== "stars" && task.type !== "move")) { toast(t("lm.noDemo"), "fix"); return; }
    store.session.learn.wantDemo = true;
    startLearnTask();
  };
  document.getElementById("learn-reset").onclick = async () => {
    if (!(await confirmNative(t("dlg.resetLearn"), t("dlg.resetLearnTitle"),
      { ok: t("act.reset"), cancel: t("act.cancel") }))) return;
    store.session.learnState = { v: 1, done: {}, last: 0 };
    saveLearnState();
    if (store.session.learn) startLesson(0);
    toast(t("lm.progressReset"));
  };
  document.getElementById("lesson-next").onclick = () => {
    if (!store.session.learn) return;
    if (store.session.learn.li + 1 < LESSONS.length) { startLesson(store.session.learn.li + 1); return; }
    // graduation: straight into a beginner AI game
    store.session.difficulty = "beginner";
    store.session.mode = "ai";
    stopLearn();
    saveSettings();
    store.game.selection = null;
    sync();
    toast(t("lm.firstGame"));
    maybeEngineTurn();
  };
  document.getElementById("lesson-list").onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b && store.session.learn) startLesson(Number(b.dataset.i));
  };
  document.getElementById("puzzle-cat-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-cat]");
    // `puzzle` is null whenever the tier filter empties the current category —
    // exactly the moment the user needs these tabs to change category, so this
    // must not bail out on a missing puzzle
    if (!b || (store.session.puzzle && b.dataset.cat === store.session.puzzle.cat)) return;
    if (b.dataset.cat === "review" && !puzzlesInCat("review").length) {
      toast(t("pz.noMissed"));
      return;
    }
    store.session.puzzleState.cat = b.dataset.cat;
    savePuzzleState();
    startPuzzles();
  };
  document.getElementById("puzzle-tier-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-tier]");
    if (!b || b.dataset.tier === store.session.puzzleTierFilter) return;
    store.session.puzzleTierFilter = b.dataset.tier;
    saveSettings();
    startPuzzles();
  };
  document.getElementById("puzzle-retry").onclick = () => {
    if (store.session.puzzle) { startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx); toast(t("pz.restarted")); }
  };
  document.getElementById("puzzle-answer").onclick = () => { showPuzzleAnswer(); };
  document.getElementById("puzzle-next").onclick = () => { nextPuzzle(); };
  const playOnEl = document.getElementById("puzzle-playon");
  if (playOnEl) playOnEl.onclick = () => { playOnFromPuzzle(); };
  document.getElementById("puzzle-list").onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b && store.session.puzzle) startPuzzleAt(store.session.puzzle.cat, Number(b.dataset.i));
  };
  document.getElementById("clock-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-tc]");
    if (!b || b.dataset.tc === store.game.timeControl) return;
    store.game.timeControl = b.dataset.tc;
    resetClocks();
    saveSettings();
    saveGame();
    store.commit("game", "action");
    const tcSet = parseTc(store.game.timeControl);
    toast(!tcSet ? t("msg.clock.off") :
      tf("mm.clockSet", [tcSet.base / 60]) + (tcSet.inc ? tf("mm.clockInc", [tcSet.inc]) : ""));
  };
  const onDiffClick = (ev) => {
    const b = ev.target.closest("button[data-diff]");
    if (!b || b.dataset.diff === store.session.difficulty) return;
    store.session.difficulty = b.dataset.diff;
    saveSettings();
    sync();
    toast(t("msg.setting.difficulty") + (DIFF_NAMES[store.session.difficulty] || store.session.difficulty));
  };
  document.getElementById("diff-seg").onclick = onDiffClick;
  const diffEngineSeg = document.getElementById("diff-seg-engine");
  if (diffEngineSeg) diffEngineSeg.onclick = onDiffClick;
  document.getElementById("persona-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-persona]");
    if (!b || b.dataset.persona === store.session.personaId) return;
    store.session.personaId = b.dataset.persona;
    saveSettings();
    sync();
    toast(t("m.personaSet") + t("persona." + store.session.personaId));
  };
  document.getElementById("color-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-color]");
    if (!b || b.dataset.color === store.session.humanColor) return;
    invalidateEngine();
    store.session.humanColor = b.dataset.color;
    store.game.flipped = store.session.humanColor === "b";
    saveSettings();
    sync();
    toast(store.session.humanColor === "w" ? t("msg.side.whiteChosen") : t("msg.side.blackChosen"));
    maybeEngineTurn();
  };
  const langSeg = document.getElementById("lang-seg");
  if (langSeg) {
    langSeg.onclick = (ev) => {
      const b = ev.target.closest("button[data-lang]");
      if (!b || !I18n || b.dataset.lang === store.ui.langId) return;
      store.ui.langId = I18n.setLang(b.dataset.lang);
      saveSettings();
      applyLanguage();
      toast(t("mm.langSwitched"));
    };
  }
  document.getElementById("opt-coach").onclick = () => {
    store.session.coachOn = !store.session.coachOn;
    saveSettings();
    syncSettingsUI();
    toast(store.session.coachOn ? t("msg.coach.on") : t("msg.coach.off"));
  };
  document.getElementById("opt-autoflip").onclick = () => {
    store.ui.autoFlipPvp = !store.ui.autoFlipPvp;
    if (syncAutoFlip()) draw();
    saveSettings();
    syncSettingsUI();
    toast(store.ui.autoFlipPvp ? t("msg.autoflip.on") : t("msg.autoflip.off"));
  };
  document.getElementById("opt-sound").onclick = () => {
    store.ui.soundOn = !store.ui.soundOn;
    saveSettings();
    syncSettingsUI();
    if (store.ui.soundOn) Audio2.playMove("w");
    toast(store.ui.soundOn ? t("msg.sound.on") : t("msg.sound.off"));
  };
  document.getElementById("clear-save").onclick = async () => {
    if (!(await confirmNative(t("dlg.clearSave"), t("act.clearSave"),
      { ok: t("dlg.clear"), cancel: t("act.cancel") }))) return;
    // Everything this app stored, from persist.js's key list — not the one key
    // this button used to remove and not the eight somebody had to remember.
    // 缺陷 33.
    Persist.clearAll();
    // the Dock / jump list is local data too: clearing the save and leaving a
    // list of this player's PGNs sitting in the system menu is not "cleared"
    Host.clearRecentDocuments();
    stopEditor();
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    gameReset();
    store.game.selection = null;
    store.game.viewIndex = 0;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
    store.session.analysis = null;
    store.game.recordedId = null;
    resetClocks();
    syncAutoFlip();
    sync();
    toast(t("msg.save.cleared"));
    maybeEngineTurn();
  };

  // --- editor + FEN wiring ---
  document.getElementById("editor-open").onclick = () => {
    if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
    startEditor();
  };
  document.getElementById("fen-load-open").onclick = () => {
    if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
    openFenModal();
  };
  document.getElementById("editor-palette").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b || !store.session.editor) return;
    store.session.editor.brush = b.dataset.erase ? { color: "", type: "" }
      : { color: b.dataset.color, type: b.dataset.type };
    renderEditorPalette();
  };
  document.getElementById("editor-turn").onclick = (ev) => {
    const b = ev.target.closest("button[data-turn]");
    if (!b || !store.session.editor) return;
    store.session.editor.turn = b.dataset.turn;
    syncEditorUI();
  };
  document.getElementById("editor-ep").onclick = (ev) => {
    const b = ev.target.closest("button[data-ep]");
    if (!b || !store.session.editor) return;
    store.session.editor.ep = b.dataset.ep || null;
    syncEditorUI();
  };
  document.getElementById("editor-castling").onclick = (ev) => {
    const b = ev.target.closest("button[data-cr]");
    if (!b || !store.session.editor) return;
    store.session.editor.castling[b.dataset.cr] = !store.session.editor.castling[b.dataset.cr];
    syncEditorUI();
  };
  document.getElementById("editor-clear").onclick = () => {
    if (!store.session.editor) return;
    store.session.editor.board = ChessEditor.emptyBoard();
    store.session.editor.castling = { K: false, Q: false, k: false, q: false };
    syncEditorUI();
    draw();
  };
  document.getElementById("editor-reset").onclick = () => {
    if (!store.session.editor) return;
    store.session.editor = Object.assign(
      ChessEditor.fromFen(new Chess().fen(), Chess),
      { brush: store.session.editor.brush }
    );
    syncEditorUI();
    draw();
  };
  document.getElementById("editor-cancel").onclick = () => {
    stopEditor();
    sync();
    toast(t("msg.editor.cancelled"));
  };
  document.getElementById("editor-apply").onclick = () => { applyEditor(); };

  if (fenModal) {
    document.getElementById("fen-cancel").onclick = closeFenModal;
    document.getElementById("fen-load").onclick = submitFen;
    document.getElementById("fen-from-clip").onclick = async () => {
      try {
        const clip = await Host.readClipboard();
        const input = document.getElementById("fen-input");
        if (input) { input.value = (clip || "").trim(); input.classList.remove("bad"); }
        const err = document.getElementById("fen-error");
        if (err) err.textContent = "";
      } catch (_) { toast(t("msg.clipboard.readFailed"), "fault"); }
    };
    document.getElementById("fen-input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submitFen(); }
      // Typing a FEN must not trigger board shortcuts — but Escape and Tab are
      // not shortcuts, they are how you leave the dialog. Swallowing them here
      // meant the one control this dialog auto-focuses was also the one place
      // Escape could not close it from.
      if (ev.key !== "Escape" && ev.key !== "Tab") ev.stopPropagation();
    });
    fenModal.onclick = (ev) => { if (ev.target === fenModal) closeFenModal(); };
  }

  const slotsModal = document.getElementById("slots-modal");
  if (slotsModal) {
    document.getElementById("slots-open").onclick = () => {
      if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
      openSlots();
    };
    document.getElementById("slots-close").onclick = closeSlots;
    document.getElementById("slots-list").onclick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.save != null) saveToSlot(Number(b.dataset.save));
      else if (b.dataset.del != null) deleteSlot(Number(b.dataset.del));
      else if (b.dataset.load != null) loadFromSlot(Number(b.dataset.load));
    };
    slotsModal.onclick = (ev) => { if (ev.target === slotsModal) closeSlots(); };
  }

  const histModal = document.getElementById("hist-modal");
  if (histModal) {
    const openBtn = document.getElementById("hist-open");
    if (openBtn) openBtn.onclick = openHistory;
    document.getElementById("hist-close").onclick = closeHistory;
    const hres = document.getElementById("hist-result-seg");
    if (hres) hres.onclick = (ev) => {
      const b = ev.target.closest("button[data-hres]");
      if (!b || b.dataset.hres === store.ui.histFilter.result) return;
      store.ui.histFilter.result = b.dataset.hres;
      renderHistory();
    };
    const hcol = document.getElementById("hist-color-seg");
    if (hcol) hcol.onclick = (ev) => {
      const b = ev.target.closest("button[data-hcol]");
      if (!b || b.dataset.hcol === store.ui.histFilter.color) return;
      store.ui.histFilter.color = b.dataset.hcol;
      renderHistory();
    };
    const onHistClick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.histPgn != null) {
        const rec = store.session.histCache[Number(b.dataset.histPgn)];
        if (rec) copyText(historyPgn(rec), t("hist.pgnCopied"));
      } else if (b.dataset.hist != null) {
        if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
        loadFromHistory(Number(b.dataset.hist));
      }
    };
    document.getElementById("hist-list").onclick = onHistClick;
    const histBody = document.getElementById("hist-body");
    if (histBody) histBody.onclick = onHistClick;
    histModal.onclick = (ev) => { if (ev.target === histModal) closeHistory(); };
  }

  const pickModal = document.getElementById("pick-modal");
  if (pickModal) {
    document.getElementById("pick-list").onclick = (ev) => {
      const b = ev.target.closest("button[data-i]");
      if (b) finishPick(Number(b.dataset.i));
    };
    document.getElementById("pick-cancel").onclick = () => finishPick(null);
    pickModal.onclick = (ev) => { if (ev.target === pickModal) finishPick(null); };
  }

  const confirmModal = document.getElementById("confirm-modal");
  document.getElementById("confirm-ok").onclick = () => finishConfirm(true);
  document.getElementById("confirm-cancel").onclick = () => finishConfirm(false);
  document.getElementById("confirm-alt").onclick = () => finishConfirm("alt");
  confirmModal.onclick = (ev) => { if (ev.target === confirmModal) finishConfirm(false); };

  const promoModal = document.getElementById("promo-modal");
  if (promoModal) {
    promoModal.querySelectorAll("button[data-p]").forEach((b) => {
      b.onclick = () => finishPromotion(b.dataset.p);
    });
    promoModal.onclick = (ev) => { if (ev.target === promoModal) finishPromotion(null); };
  }

  // Tab belongs to the browser everywhere except inside an open dialog, where
  // it has to wrap instead of walking out into the page behind the backdrop.
  // Capture phase so it applies even to controls that stop propagation.
  window.addEventListener("keydown", (ev) => { Dlg.handleTab(ev); }, true);

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      // The topmost dialog, whichever it is. This was seven
      // `classList.contains("show")` tests in a fixed order, with the same
      // seven listed again in dialogOpen(): adding an eighth meant editing two
      // places, and ordering them wrong failed silently. Each dialog now says
      // how it closes when it is built (see wireDialogs()), and Escape asks
      // for the top of the stack. 缺陷 19.
      if (Dlg.closeTop()) return;
      // before closing the panel — the panel holds the editor's only exit
      if (store.session.editor) { stopEditor(t("msg.editor.exited")); store.commit("game", "action"); return; }
      if (isPanelOpen()) setPanelOpen(false);
      return;
    }
    if (promoModal && promoModal.classList.contains("show")) {
      const pk = ev.key.toLowerCase();
      if (["q", "r", "b", "n"].includes(pk)) { ev.preventDefault(); finishPromotion(pk); }
      return;
    }
    if (confirmModal.classList.contains("show")) {
      if (ev.key === "Enter") { ev.preventDefault(); finishConfirm(true); }
      return;
    }
    // "?" comes before the dialog guard below, because it is the one shortcut
    // whose whole job is opening and closing a dialog — but only its own: with
    // anything else on screen it stays out of the way like everything else.
    if ((ev.key === "?" || (ev.key === "/" && ev.shiftKey)) && !ev.metaKey && !ev.ctrlKey) {
      const sheetUp = keysModal && keysModal.classList.contains("show");
      if (sheetUp || !dialogOpen()) {
        ev.preventDefault();
        if (sheetUp) closeKeyHelp(); else openKeyHelp();
        return;
      }
    }
    // Everything below acts on the game. A dialog is in front of the game, so
    // none of it applies while one is open — see dialogOpen(). Escape is
    // handled above precisely because it is the one key that does apply.
    if (dialogOpen()) return;
    const k = ev.key.toLowerCase();
    // Tab is not ours to take. Binding it to the panel meant focus could never
    // move anywhere by keyboard — the app had a full keyboard board cursor and
    // no way to reach any other control. The panel is on P instead.
    if (k === "p" && !ev.metaKey && !ev.ctrlKey && !ev.altKey) { ev.preventDefault(); togglePanel(); return; }
    if (store.session.mode === "learn") {
      // replay / game shortcuts act on the main game — inert during lessons;
      // R retries the task, Z/H work in engine drills
      if (!store.session.learn || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { startLearnTask(); toast(t("lm.restarted")); }
      else if (k === "z") learnUndo();
      else if (k === "h") learnHint();
      return;
    }
    if (store.session.mode === "puzzle") {
      if (!store.session.puzzle || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx); toast(t("pz.restarted")); }
      else if (k === "n") nextPuzzle();
      else if (k === "h") showPuzzleAnswer();
      return;
    }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); setViewIndex(store.game.viewIndex - 1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); setViewIndex(store.game.viewIndex + 1); }
    else if (ev.key === "Home") { ev.preventDefault(); setViewIndex(0); }
    else if (ev.key === "End") { ev.preventDefault(); setViewIndex(sanHistory().length); }
    else if (k === "z" && !ev.metaKey && !ev.ctrlKey) undo();
    else if (k === "n" && !ev.metaKey && !ev.ctrlKey) requestNewGame();
    else if (k === "h" && !ev.metaKey && !ev.ctrlKey) requestHint();
    else if (k === "f" && !ev.metaKey && !ev.ctrlKey) {
      store.game.flipped = !store.game.flipped; saveSettings(); draw();
    }
  });

  window.addEventListener("resize", () => {
    appEl.classList.toggle("scrim-on", isPanelOpen() && window.innerWidth < 900);
    BoardView.resizeCanvas();
    draw();
    drawEvalCurve();
  });
  // Track the canvas size continuously, so the backing store never disagrees
  // with the CSS size (a whole board rendered scaled reads as blurry).
  //
  // There used to be an `else` here listening for transitionend on
  // #board-wrap's width/height, described in its own comment as the fallback
  // for environments without ResizeObserver. Those properties are
  // deliberately not transitioned — see the note in styles.css, the board
  // snaps to its new size on purpose — so the event never fired and the
  // branch was dead from the day it was written: the comment was older than
  // the CSS it described. Defect 11. Nothing replaces it, because nothing was
  // there: setPanelOpen() already re-samples on the next frame (the new size
  // is final immediately, precisely because there is no transition), and the
  // window resize handler covers the rest.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { BoardView.resizeCanvas(); draw(); }).observe(canvas);
  }
  window.addEventListener("beforeunload", () => saveGame());
  window.addEventListener("pagehide", () => saveGame());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
    // and stop/restart the clock — syncClockTimer resets clockTickAt when it
    // restarts, so the time spent away is never charged to anybody
    syncClockTimer();
    renderClocks();
  });

  // --- boot ---
  // "Have we been here before?" — asked before loadSettings writes anything,
  // because the very first thing a new player saw was a 1700-rated Stockfish
  // (mode "ai" + difficulty "normal" are the code defaults) with nothing at all
  // pointing at the interactive course or the Beginner tier built for them.
  /**
   * How each dialog is dismissed.
   *
   * One line per dialog, next to the other one-block-of-wiring in this file.
   * Escape reads this; nothing else has to know the list, and nothing has to
   * keep it in an order.
   */
  function wireDialogs() {
    Dlg.register(promoModal, () => finishPromotion(null));
    Dlg.register(document.getElementById("slots-modal"), closeSlots);
    Dlg.register(document.getElementById("hist-modal"), closeHistory);
    Dlg.register(pickModal, () => finishPick(null));
    Dlg.register(fenModal, closeFenModal);
    Dlg.register(confirmModal, () => finishConfirm(false));
    Dlg.register(keysModal, closeKeyHelp);
  }
  wireDialogs();

  // Views listen from here on. Wired before any state is loaded, so the first
  // sync() below paints a screen that already agrees with the restored game
  // rather than one that agrees with the defaults.
  wireViews();

  const firstRun = !Persist.get("settings") && !Persist.get("save") &&
    !Persist.get("learn") && !Persist.get("puzzles");
  // and on a first run, start in the system language rather than always Chinese
  if (firstRun && I18n && I18n.detectLang) store.ui.langId = I18n.setLang(I18n.detectLang());
  loadSettings();
  document.documentElement.setAttribute("data-theme", store.ui.themeId);
  document.documentElement.setAttribute("data-board", store.ui.themeId);
  if (I18n) { I18n.setLang(store.ui.langId); I18n.apply(document); }
  const savedPanel = Persist.get("panelOpen");
  setPanelOpen(savedPanel === "1");
  setSideTab(store.ui.sideTab);
  const resumed = tryLoadSave();
  if (resumed) toast(t("msg.save.restored"));
  // a resumed finished game must not be re-counted on the next live move
  // A restored game that is already over was filed when it ended; marking it
  // recorded stops the launch path filing it a second time. The id is unknown
  // here (it is in the stats file, not the save), and a sentinel is enough:
  // all this flag decides is "do not record again".
  if (resumed && naturalGameOver()) store.game.recordedId = RESTORED_AND_FILED;
  // …and the same for the three app-level endings, which naturalGameOver()
  // does not see: a resigned game is not over by its moves.
  if (resumed && (store.game.resigned || store.game.drawAgreed || store.game.drawClaimed)) {
    store.game.recordedId = RESTORED_AND_FILED;
  }
  // clock preset chosen but no saved clock state → fresh clocks
  if (store.game.timeControl !== "off" && !store.game.clock) resetClocks();
  syncAutoFlip(); // a resumed pvp game must face whoever is on move
  if (store.session.mode === "learn") startLearn();
  if (store.session.mode === "puzzle") startPuzzles();
  BoardView.resizeCanvas();
  renderStats();
  renderAchievements();
  applyLanguage();
  sync();
  saveSettings();
  if (!resumed) saveGame();
  if (store.session.mode === "ai" && ChessEngine) {
    ChessEngine.init().catch(() => toast(t("mm.engineInitFailed"), "fault"));
    maybeEngineTurn(); // resumed save may leave the engine on move
  }
  if (firstRun) runOnboarding();

