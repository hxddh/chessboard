/**
 * The app's state, as it starts: the three slices store.js holds.
 *
 * 13.0 E: moved out of app.js (its line ceiling), whole — the fields, their
 * defaults and the comments that say what each is for. app.js makes the
 * store from this once, at boot (`createStore(initialState())`).
 * @module app-state
 */
import { ChessTree } from "./game-tree.js";
import { LOOK_DEFAULT } from "./look.js";

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
export function initialState() {
  return {
    game: {
      /** Replay cursor: 0..sanHistory().length; live when === length. */
      viewIndex: 0,
      /**
       * The game as a tree (game-tree.js) and the line `game` is standing on
       * (v6-plan Q2.1). `line` is node ids root → leaf, so `line[viewIndex]`
       * is the node under the cursor and `line.length === sanHistory().length
       * + 1` always; the five doors below keep both in step with chess.js.
       */
      tree: ChessTree.createTree(),
      line: [0],
      /** the doors keep the tree in step — off while switchLine() replays a
          path the tree already holds; `_batch` > 0 holds their commits */
      _treeSync: true,
      _batch: 0,
      /** the game came in from a file, the clipboard or the history — the
          engine is not playing it, so replaying into it opens variations */
      imported: false,
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
      /** clock: 'off' | a time-control.js id (e.g. '5', '3+2', 'c20+5') */
      timeControl: "off",
      /** remaining ms per side; null when no clock */
      clock: null,
      /** side whose flag fell ('w'|'b') — terminal for the game, like mate */
      flagFall: null,
      /** 7.0: the clock is running (set by the first touch of the board) */
      clockStarted: false,
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
      /** the last autosave written, {sig, raw} — see saveGame (v8-0-plan F2) */
      _saved: null,
    },
    session: {
      /** @type {'ai'|'pvp'} */
      mode: "ai",
      /** a rung of opponents.js LEVELS — 休闲 for a new install (v10-0-plan T1) */
      difficulty: "casual",
      /** @type {'w'|'b'} human side in AI mode */
      humanColor: "w",
      /** v7-8-plan §4: the last new game was started with 执子「随机」, so the
       *  dialog offers that again; humanColor is still the side actually drawn */
      colorRandom: false,
      engineThinking: false,
      /** 6.0 (v6-plan Q2.8): the move queued while the engine thinks, {from,to} */
      premove: null,
      /** 6.0 (v6-plan Q3.5): the classic game being read — {ci}, in learn mode with no lesson */
      study: null,
      /** 6.0 (v6-plan Q2.6): continuous analysis — on/off, and the running search */
      liveOn: false,
      live: null,
      /** review analysis: {sig, scalars[n+1], tags[n]}; stale when sig ≠ pgn */
      analysis: null,
      /** 7.6 §1c: finished analyses by game, as stored (analysis-store.js);
          read from storage on first use */
      analysesKept: null,
      /** the engine failed to start — analysis and hints are not offered, and
          the review group says why in place (5.1) */
      engineDown: false,
      /** the boot in flight, shared by everyone who asks for one (7.4) */
      engineBoot: null,
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
      /** 14.0 E: runs started or stopped — a lesson waiting on its chunk opens only if none came after it */
      learnRuns: 0,
      /** puzzle-mode runtime; null unless mode === 'puzzle' */
      puzzle: null,
      /** 7.8 §3: 再试一次 — one move to find, on top of the replay; see startRetry */
      retry: null,
      learnState: null,  // filled in below, where it can first be computed
      puzzleState: null,  // filled in below, where it can first be computed
      /** 错题自炼 — the personal book (mistakes.js); filled in below */
      mines: [],
      /** 进步档案 — weekly buckets + practice days (progress.js); filled in below */
      progress: null,
      /** 今天的训练 — the active sitting {steps, i, before}, or null (planner.js) */
      daily: null,
      /** editor runtime: {board, turn, castling, brush} | null */
      editor: null,
      coachPending: null,
      drawOfferPending: false,
      /** 7.7 §4: the ending whose result card was put away with ✕ */
      goDismissed: null, goAch: null,
      goAnnounced: null,
      /** 7.7 §4: puzzles solved clean in a row, this sitting */
      pzStreak: 0,
      _analysisTick: null,
      /** the newest-first list the rendered rows index into */
      histCache: [],
      achSeen: null,  // filled in below, where it can first be computed
    },
    ui: {
      soundOn: true,
      /** 7.7 (v7-7-plan §8): "wood" (the rendered samples) or "classic" (the oscillators) */
      soundSet: "wood",
      /** 6.0 (v6-plan Q2.8 / Q2.6): the level, the frame labels, the men, the engine knobs */
      volume: 100,
      coordsOn: true,
      /** v7-8-plan §5: coordinates in the corner squares instead of on the frame */
      coordsInside: false,
      blindfold: false,
      hash: 32,
      multipv: 1,
      /**
       * 7.0: show the `?!` mark at all.
       *
       * Off by default, and the reason is measured rather than aesthetic.
       * 6.1 swept twenty-eight games at three budgets (docs/measured.json,
       * `winPctNoise`): of every ply either of two runs called `?!`, both runs
       * agreed 52 / 56 / 54% of the time — a coin flip decides whether the
       * same position gets the mark, and ten times the search does not help.
       * `?` reaches 84% and `??` 95%, and both improve with depth, which is
       * what a real signal does. 6.1 wrote down that `?!` is the one mark this
       * app will not endorse and then went on showing it exactly like the
       * other two. Showing noise with a caveat is still showing noise, so it
       * is off; the switch is there for anyone who wants it anyway.
       */
      showSoftMark: false,
      // 7.8 §2: the engine lines drawn as board arrows (持续分析 and the review)
      engineArrows: true,
      // 13.0 I: 「人会怎么走」 under the engine lines (review/human-line.js)
      humanLine: true,
      // a pointer is pressed inside #live-line: its rows hold still (paintLive)
      liveHeld: false,
      /** 6.0 (v6-plan Q3.6): the text size step */
      textSize: "m",
      /** v8-0-plan A3: the look, four answers (look.js) — first-run values */
      ...LOOK_DEFAULT,
      /** pvp: flip the board to face the side to move after every move */
      autoFlipPvp: false,
      haptics: true,
      /** 9.0 S5: the settings page's open category (shell.js SETTING_CATS) */
      setCat: "general",
      /** 9.0 S3: 训练's last segment (shell.js TRAIN_SEGS), and 名局 read or guessed */
      trainSeg: "course",
      classicMode: "read",
      /** UI language id (see i18n.js); lesson/puzzle content stays Chinese */
      langId: null,  // filled in below, where it can first be computed
      /** Is the app in front of somebody? Kept by the app:activate/deactivate
       *  lifecycle pair; the clock and the analysis notification both read it. */
      appForeground: true,
      /** keyboard play: focused square, shown only while the board has focus */
      keyboardCursor: null,
      boardFocused: false,
      /** …and only after the board was reached or used by keyboard (7.7 §1c,
       *  a11y.js): the canvas's own `:focus-visible` */
      cursorShown: false,
      toastTimer: null,
      confirmResolver: null,
      /** v7-8-plan §4: the new-game dialog's draft while it is open —
       *  {difficulty, personaId, color: "w"|"b"|"random", timeControl} — else null.
       *  Never persisted: the choices are committed by 开始, not by the clicks. */
      newGame: null,
      /** 7.7 §3: the review group, opened by hand during an engine game */
      reviewOpen: false,
      // 7.1: the library list's own filters, plus the one the diagnosis sets
      // when a row there is clicked (`libPick`). Kept apart so that clearing
      // the diagnosis's filter does not also undo "losses only".
      libFilter: { result: "all", color: "all", sort: "t" },
      libPick: null,
      promoResolver: null,
      /** 7.8 §1c: the square the open promotion chooser stands on */
      promoSquare: null,
      /** Modal list picker → index of the chosen entry, or null when cancelled. */
      pickResolver: null,
      dragging: null,
      /** 7.6: a pointer is down right now, and what waits for it to come up
          (afterPress) — never persisted, never rendered. */
      pointerPressed: false,
      pressQueue: [],
      /** 摸得到的复盘 — the position under the pointer (move-list row or PV
          chip being hovered): {position, last, check} or null. Transient by
          construction: set on hover, cleared on leave, never persisted. */
      preview: null,
      /** Enter on a PV chip keeps the line on the board after focus moves on;
          Esc or any navigation lets go. Never persisted. */
      previewPinned: false,
      /** editor paint stroke: the square last painted while the pointer is down */
      painting: null,
      /** right-button drag in progress: {from, over, color} — an arrow or a
          circle being drawn, not yet on the node (v6-plan Q2.4) */
      shaping: null,
      /** the pinned engine line's moves, so 「从这里试走」 can write them down */
      previewPv: null,
      /** node id the move context menu is open for, or null */
      moveMenu: null,
      /** node id the comment dialog is editing, or null */
      noteFor: null,
    },
  };
}
