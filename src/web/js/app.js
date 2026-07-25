(function () {

  const Host = window.ChessHost;
  const BoardView = window.ChessBoardView;
  const Audio2 = window.ChessAudio;

  const I18n = window.ChessI18n;
  const t = I18n ? I18n.t : (k) => k;
  /** t() with {0}/{1} placeholders filled in — see i18n.tf */
  const tf = I18n ? I18n.tf : (k) => k;

  const SAVE_KEY = "chess.v1.save";
  const SETTINGS_KEY = "chess.v1.settings";
  const PANEL_KEY = "chess.panelOpen";
  const STATS_KEY = "chess.v1.stats";

  const canvas = document.getElementById("board");
  const appEl = document.getElementById("app");

  /** The live game — single source of truth (chess.js keeps full history). */
  const game = new Chess();
  /** Replay cursor: 0..sanHistory().length; live when === length. */
  let viewIndex = 0;
  let flipped = false;
  let soundOn = true;
  /** @type {'wood'|'night'|'day'|'notebook'} */
  let themeId = "wood";
  /** @type {{sq:string, targets:string[]}|null} click-move selection */
  let selection = null;
  /** @type {'ai'|'pvp'} */
  let mode = "ai";
  /** @type {'easy'|'normal'|'hard'|'extreme'} */
  let difficulty = "normal";
  /** @type {'w'|'b'} human side in AI mode */
  let humanColor = "w";
  let engineThinking = false;
  /** bumped on every game mutation; stale engine replies are dropped */
  let engineToken = 0;
  /** review analysis: {sig, scalars[n+1], tags[n]}; stale when sig ≠ pgn */
  let analysis = null;
  let analyzing = false;
  /** set by the stop button; the analysis loop bails at the next position */
  let analyzeAbort = false;
  let analyzeProgress = "";
  /** pgn of the last game recorded into stats (double-count guard) */
  let statsRecordedSig = null;
  /** engine hint arrow {from,to}; cleared whenever the game mutates */
  let hintMove = null;
  let hintPending = false;
  /** clock preset: 'off' | a key of TCS (e.g. '5', '3+2') */
  let timeControl = "off";
  /** blunder coach: warn after ??-level moves in AI games */
  let coachOn = true;
  /** pvp: flip the board to face the side to move after every move */
  let autoFlipPvp = false;
  /** which panel tab is showing: "play" | "setup" | "record" */
  let sideTab = "play";
  /** UI language id (see i18n.js); lesson/puzzle content stays Chinese */
  let langId = I18n ? I18n.getLang() : "zh-CN";
  /** remaining ms per side; null when no clock */
  let clock = null;
  /** side whose flag fell ('w'|'b') — terminal for the game, like mate */
  let flagFall = null;
  let clockTimer = null;
  let clockTickAt = 0;
  /** side that resigned ('w'|'b') — terminal for the game, like mate */
  let resigned = null;
  /** draw agreed (pvp: both players; ai: engine accepted the offer) */
  let drawAgreed = false;
  /** claimed draw: 'threefold' | 'fifty' | null — terminal once claimed */
  let drawClaimed = null;
  /** learn-mode runtime; null unless mode === 'learn' */
  let learn = null;
  /** puzzle-mode runtime; null unless mode === 'puzzle' */
  let puzzle = null;

  Audio2.init(() => soundOn);

  function sanHistory() { return game.history(); }
  function isLive() { return viewIndex === sanHistory().length; }

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
      game.load(sf);
      game.header("SetUp", "1", "FEN", sf);
    } else {
      game.reset();
    }
  }

  /** chess.js instance for the currently VIEWED position (live or replay). */
  function viewGame() {
    if (isLive()) return game;
    const g = baseGame();
    const h = sanHistory();
    for (let i = 0; i < viewIndex; i++) g.move(h[i]);
    return g;
  }

  /** Verbose move objects for the whole game (for last-move highlight). */
  function verboseHistory() { return game.history({ verbose: true }); }

  function kingSquare(g, color) {
    const bd = g.board();
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = bd[r][c];
      if (p && p.type === "k" && p.color === color) return "abcdefgh"[c] + (8 - r);
    }
    return null;
  }

  /** keyboard play: focused square, shown only while the board has focus */
  let keyboardCursor = null;
  let boardFocused = false;
  const cursorSquare = () => (boardFocused ? keyboardCursor : null);

  BoardView.attach(canvas, () => {
    if (editor) return editorModel();
    if (mode === "learn" && learn) return learnModel();
    if (mode === "puzzle" && puzzle) return puzzleModel();
    const g = viewGame();
    const vh = verboseHistory();
    const last = viewIndex > 0 ? vh[viewIndex - 1] : null;
    return {
      position: g.board(),
      flipped,
      selected: selection ? selection.sq : null,
      legalTargets: selection ? selection.targets : [],
      lastMove: last ? { from: last.from, to: last.to } : null,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      hintMove: isLive() ? hintMove : null,
      stars: [],
      cursor: cursorSquare(),
    };
  });

  function draw() { BoardView.draw(); }

  // --- toast + promise-based in-app confirm ---
  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = msg;
    el.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2200);
  }

  let confirmResolver = null;
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
    modal.classList.add("show");
    okBtn.focus();
    return new Promise((resolve) => { confirmResolver = resolve; });
  }
  function finishConfirm(val) {
    const modal = document.getElementById("confirm-modal");
    if (modal) modal.classList.remove("show");
    if (confirmResolver) { confirmResolver(val); confirmResolver = null; }
  }

  // --- settings + autosave ---
  function loadSettings() {
    try {
      const raw = Host.storageGet(SETTINGS_KEY);
      if (!raw) return;
      const s = JSON.parse(raw);
      if (typeof s.soundOn === "boolean") soundOn = s.soundOn;
      if (typeof s.flipped === "boolean") flipped = s.flipped;
      if (["wood", "night", "day", "notebook"].includes(s.themeId)) themeId = s.themeId;
      if (["ai", "pvp", "learn", "puzzle"].includes(s.mode)) mode = s.mode;
      if (["beginner", "easy", "normal", "hard", "extreme"].includes(s.difficulty)) difficulty = s.difficulty;
      if (["w", "b"].includes(s.humanColor)) humanColor = s.humanColor;
      if (s.timeControl === "off" || TCS[s.timeControl]) timeControl = s.timeControl;
      if (typeof s.coachOn === "boolean") coachOn = s.coachOn;
      if (typeof s.autoFlipPvp === "boolean") autoFlipPvp = s.autoFlipPvp;
      if (I18n && typeof s.langId === "string") langId = I18n.setLang(s.langId);
      if (["all", "easy", "mid", "hard"].includes(s.puzzleTier)) puzzleTierFilter = s.puzzleTier;
      if (["play", "setup", "record"].includes(s.sideTab)) sideTab = s.sideTab;
    } catch (_) {}
  }
  function saveSettings() {
    try {
      Host.storageSet(SETTINGS_KEY, JSON.stringify({ soundOn, flipped, themeId, mode, difficulty, humanColor, timeControl, coachOn, autoFlipPvp, langId, puzzleTier: puzzleTierFilter, sideTab }));
    } catch (_) {}
  }
  function saveGame() {
    try {
      const payload = { v: 1, pgn: game.pgn(), savedAt: Date.now() };
      if (timeControl !== "off" && clock) {
        payload.clock = { tc: timeControl, w: Math.round(clock.w), b: Math.round(clock.b), flag: flagFall };
      }
      if (resigned) payload.resigned = resigned;
      if (drawAgreed) payload.drawAgreed = true;
      if (drawClaimed) payload.drawClaimed = drawClaimed;
      Host.storageSet(SAVE_KEY, JSON.stringify(payload));
    } catch (_) {}
  }
  function tryLoadSave() {
    try {
      const raw = Host.storageGet(SAVE_KEY);
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!s || s.v !== 1 || typeof s.pgn !== "string" || !s.pgn) return false;
      if (!game.load_pgn(s.pgn)) return false;
      viewIndex = sanHistory().length;
      if (s.clock && TCS[s.clock.tc] &&
          typeof s.clock.w === "number" && typeof s.clock.b === "number") {
        timeControl = s.clock.tc;
        clock = { w: Math.max(0, s.clock.w), b: Math.max(0, s.clock.b) };
        flagFall = s.clock.flag === "w" || s.clock.flag === "b" ? s.clock.flag : null;
      }
      if (s.resigned === "w" || s.resigned === "b") resigned = s.resigned;
      if (s.drawAgreed === true) drawAgreed = true;
      if (s.drawClaimed === "threefold" || s.drawClaimed === "fifty") drawClaimed = s.drawClaimed;
      return sanHistory().length > 0;
    } catch (_) {
      return false;
    }
  }

  // --- engine (AI mode) ---
  const DIFF_IDS = ["beginner", "easy", "normal", "hard", "extreme"];
  const diffName = (id) => t("diff." + id);
  /** legacy alias kept for the many call sites that read it like a map */
  const DIFF_NAMES = new Proxy({}, {
    get: (_, k) => (DIFF_IDS.includes(k) ? diffName(k) : undefined),
    has: (_, k) => DIFF_IDS.includes(k),
  });

  /** Drop any in-flight engine search; call before every game mutation. */
  function invalidateEngine() {
    engineToken++;
    engineThinking = false;
    hintMove = null;
    if (window.ChessEngine) window.ChessEngine.cancel();
  }

  /** If it's the engine's turn in AI mode, think and play its reply. */
  async function maybeEngineTurn() {
    if (mode !== "ai" || !window.ChessEngine) return;
    if (appGameOver() || game.turn() === humanColor) return;
    const token = ++engineToken;
    engineThinking = true;
    sync();
    // clocked AI games: the engine budgets its think time from its clock
    const engineSide = humanColor === "w" ? "b" : "w";
    const budget = clock && timeControl !== "off" ? Math.max(150, clock[engineSide] / 30) : null;
    let mv = null;
    try { mv = await window.ChessEngine.bestMove(game.fen(), difficulty, budget); }
    catch (_) { mv = null; }
    if (token !== engineToken) return; // game changed while thinking
    engineThinking = false;
    if (!mv) { sync(); toast(t("m.00")); return; }
    const played = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    if (played) {
      viewIndex = sanHistory().length;
      selection = null;
      hintMove = null;
      applyIncrement(played.color);
      BoardView.animateMove(played.from, played.to);
      Audio2.playMove(played.color, { captured: !!played.captured, check: game.in_check() });
      if (game.in_checkmate()) Audio2.playWin();
      else if (naturalGameOver()) Audio2.playDraw();
      saveGame();
      recordGameIfOver();
      coachAfterEngineReply();
    }
    sync();
  }

  // --- engine hint: full-strength best move drawn as an arrow ---

  async function requestHint() {
    if (mode === "learn") { learnHint(); return; }
    if (mode === "puzzle") { showPuzzleAnswer(); return; }
    if (!window.ChessEngine) { toast(t("m.01")); return; }
    if (!isLive()) { toast(t("m.02")); return; }
    if (appGameOver()) return;
    if (mode === "ai" && (engineThinking || game.turn() !== humanColor)) return;
    if (hintPending || analyzing) return;
    const sig = game.fen();
    hintPending = true;
    sync();
    let e = null;
    try { e = await window.ChessEngine.analyze(sig, 400); } catch (_) {}
    hintPending = false;
    if (!isLive() || game.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("m.03")); return; }
    const from = e.best.slice(0, 2);
    const to = e.best.slice(2, 4);
    const vmv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    hintMove = { from, to };
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
    const tc = parseTc(timeControl);
    clock = tc ? { w: tc.base * 1000, b: tc.base * 1000 } : null;
    flagFall = null;
    syncClockTimer();
    renderClocks();
  }

  /** Fischer increment: credit the mover once their move is completed. */
  function applyIncrement(mover) {
    const tc = parseTc(timeControl);
    if (!clock || !tc || !tc.inc || flagFall) return;
    clock[mover] += tc.inc * 1000;
    renderClocks();
  }

  /** Ticking starts at the first move so nobody drains on the start screen. */
  function clockRunning() {
    return (mode === "pvp" || mode === "ai") && !!clock &&
      !appGameOver() && sanHistory().length >= 1;
  }

  function syncClockTimer() {
    const want = clockRunning();
    if (want && !clockTimer) {
      clockTickAt = Date.now();
      clockTimer = setInterval(clockTick, 200);
    } else if (!want && clockTimer) {
      clearInterval(clockTimer);
      clockTimer = null;
    }
  }

  function clockTick() {
    if (!clockRunning()) { syncClockTimer(); return; }
    const now = Date.now();
    const side = game.turn();
    clock[side] = Math.max(0, clock[side] - (now - clockTickAt));
    clockTickAt = now;
    if (clock[side] === 0) {
      flagFall = side;
      syncClockTimer();
      invalidateEngine();
      const isDraw = timeoutIsDraw();
      if (isDraw) Audio2.playDraw(); else Audio2.playWin();
      if (mode === "ai") {
        recordOutcome(isDraw ? "draw" : side === humanColor ? "loss" : "win", "#flag");
      }
      saveGame();
      sync();
      const who = side === "w" ? t("m.04") : t("m.05");
      toast(isDraw ? who + t("m.06") :
        tf("mm.flagWin", [who, side === "w" ? t("m.05") : t("m.04")]));
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
    const show = (mode === "pvp" || mode === "ai") && timeControl !== "off" && !!clock;
    wEl.hidden = !show;
    bEl.hidden = !show;
    if (!show) return;
    const active = clockRunning() ? game.turn() : null;
    for (const [el, side] of [[wEl, "w"], [bEl, "b"]]) {
      el.textContent = fmtClock(clock[side]);
      el.classList.toggle("active", active === side);
      el.classList.toggle("low", clock[side] < 20000);
    }
  }

  // --- opening book: deepest SAN-prefix match wins ---
  const OPENING_BOOK = (() => {
    const map = new Map();
    let maxPly = 0;
    for (const [eco, name, seq] of window.CHESS_OPENINGS || []) {
      // store the parts, not the joined label: the name is localised at render
      // time so switching language relabels the line already on screen
      map.set(seq, [eco, name]);
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
    const hit = mode === "learn" || mode === "puzzle" ? null : openingFor(viewIndex);
    el.hidden = !hit;
    el.textContent = hit ? hit[0] + " · " + openingName(hit[1]) : "";
  }

  // --- learn mode: zero-basis interactive lessons (data in lessons.js) ---
  const LEARN_KEY = "chess.v1.learn";
  const LESSONS = window.CHESS_LESSONS || [];

  /**
   * Lesson prose in the active language, falling back to the authored Chinese.
   * Only text is localised — positions, goals and solutions always come from
   * lessons.js, so a translation can never change what a lesson teaches.
   *
   * The teaching content exists in two languages, Chinese and English, while
   * the interface has three: a Japanese player gets a Japanese interface and
   * English lessons. That is a deliberate choice rather than an oversight —
   * chess terminology in English is far more likely to be readable to them
   * than the Chinese original, and a machine-translated course would teach
   * worse than an honest second language.
   */
  function lessonText(lesson) {
    const tr = langId !== "zh-CN" && window.CHESS_LESSONS_EN ? window.CHESS_LESSONS_EN[lesson.id] : null;
    return {
      part: (tr && tr.part) || lesson.part,
      title: (tr && tr.title) || lesson.title,
      text: (tr && tr.text) || lesson.text,
    };
  }
  /** localised prose for task `ti` of `lesson` (prompt / retry / tap tips) */
  function taskText(lesson, ti) {
    const task = lesson.tasks[ti];
    const tr = langId !== "zh-CN" && window.CHESS_LESSONS_EN ? window.CHESS_LESSONS_EN[lesson.id] : null;
    const tt = tr && tr.tasks && tr.tasks[ti];
    return {
      prompt: (tt && tt.prompt) || task.prompt,
      retry: (tt && tt.retry) || task.retry,
      step: (i) => (tt && tt.steps && tt.steps[i]) || (task.steps && task.steps[i] && task.steps[i].tip),
    };
  }

  /**
   * Localised puzzle prose. Same split as the lessons: puzzles.js owns the
   * chess (fen, solution, gain), puzzles-en.js owns only the words, so a
   * translation can never disagree with what the puzzle actually is.
   */
  function puzzleEn(p) {
    return langId !== "zh-CN" && window.CHESS_PUZZLES_EN ? window.CHESS_PUZZLES_EN[p.id] : null;
  }
  function puzzleName(p) {
    // opening drills are named by the book, not by puzzles-en.js
    if (p.cat === "op" && p.zh) return p.eco + " " + openingName(p.zh);
    const tr = puzzleEn(p);
    return (tr && tr.name) || p.name;
  }
  function puzzleMotif(p) {
    const tr = puzzleEn(p);
    return (tr && tr.motif) || p.motif || t("pz.forcing");
  }
  function puzzleIdea(p) {
    if (p.cat === "op" && p.zh) return openingIdea(p.zh) || p.idea || "";
    const tr = puzzleEn(p);
    return (tr && tr.idea) || p.idea || "";
  }
  /** Localised opening name, looked up by its Chinese name (the stable key). */
  function openingName(zh) {
    const tbl = langId !== "zh-CN" ? window.CHESS_OPENINGS_EN : null;
    return (tbl && tbl[zh]) || zh;
  }
  /** …and the sentence explaining what the line is trying to do. */
  function openingIdea(zh) {
    const tbl = langId !== "zh-CN" ? window.CHESS_OPENING_IDEAS_EN : null;
    return (tbl && tbl[zh]) || "";
  }

  function loadLearnState() {
    try {
      const s = JSON.parse(Host.storageGet(LEARN_KEY) || "null");
      if (s && s.v === 1 && s.done) return s;
    } catch (_) {}
    return { v: 1, done: {}, last: 0 };
  }
  let learnState = loadLearnState();
  function saveLearnState() {
    try { Host.storageSet(LEARN_KEY, JSON.stringify(learnState)); } catch (_) {}
  }

  function startLearn() {
    startLesson(Math.max(0, Math.min(learnState.last || 0, LESSONS.length - 1)));
  }
  function stopLearn() { if (learn) learn.token++; learn = null; }

  function curLesson() { return LESSONS[learn.li]; }
  function curTask() { return curLesson().tasks[learn.ti]; }

  function startLesson(i) {
    if (!LESSONS[i]) return;
    learnState.last = i;
    saveLearnState();
    learn = { li: i, ti: 0, g: null, stars: new Set(), tapStep: 0, last: null, done: false, engineBusy: false, token: 0, misses: 0, helpOn: false, helpArrow: null, flash: null, demoing: false, wantDemo: !learnState.done[LESSONS[i].id] };
    startLearnTask();
  }

  function startLearnTask() {
    const task = curTask();
    learn.token++;
    BoardView.cancelAnim();
    learn.g = new Chess(task.fen);
    learn.stars = new Set(task.stars || []);
    learn.tapStep = 0;
    learn.last = null;
    learn.done = false;
    learn.engineBusy = false;
    learn.misses = 0;
    learn.helpOn = false;
    learn.helpArrow = null;
    learn.flash = null;
    learn.demoing = false;
    selection = null;
    // first visit to an unfinished lesson: show the solution once, then reset
    if (learn.wantDemo && task.solution && (task.type === "stars" || task.type === "move")) {
      learn.wantDemo = false;
      runLessonDemo();
      return;
    }
    sync();
  }

  /** Auto-play the task's solution as a watch-first demo; any board click skips. */
  function runLessonDemo() {
    const task = curTask();
    const sol = task.solution;
    learn.demoing = true;
    const token = learn.token;
    let i = 0;
    toast(t("lm.demoIntro"));
    sync();
    const step = () => {
      if (!learn || learn.token !== token) return;
      if (i >= sol.length) {
        setTimeout(() => {
          if (!learn || learn.token !== token) return;
          endLessonDemo();
        }, 800);
        return;
      }
      const s = sol[i++];
      const g = learn.g;
      const mv = /^[a-h][1-8][a-h][1-8]$/.test(s)
        ? g.move({ from: s.slice(0, 2), to: s.slice(2, 4), promotion: "q" })
        : g.move(s);
      if (!mv) { endLessonDemo(); return; }
      learn.last = { from: mv.from, to: mv.to };
      if (task.type === "stars") {
        if (learn.stars.has(mv.to)) learn.stars.delete(mv.to);
        // hand the turn back, exactly like real star play
        const f = g.fen().split(" ");
        f[1] = "w"; f[3] = "-";
        learn.g = new Chess(f.join(" "));
      }
      Audio2.playMove("w");
      sync();
      setTimeout(step, 800);
    };
    setTimeout(step, 700);
  }

  function endLessonDemo() {
    const task = curTask();
    learn.demoing = false;
    learn.g = new Chess(task.fen);
    learn.stars = new Set(task.stars || []);
    learn.last = null;
    selection = null;
    sync();
    toast(t("lm.yourTurn"));
  }

  function skipLessonDemo() {
    learn.token++; // kill the pending demo timers
    endLessonDemo();
  }

  function learnModel() {
    const g = learn.g;
    const task = curTask();
    let stars = Array.from(learn.stars);
    // stuck-help: after repeated misses, highlight the tap answer with stars
    if (learn.helpOn && task.type === "tap" && learn.tapStep < task.steps.length) {
      stars = task.steps[learn.tapStep].squares;
    }
    return {
      position: g.board(),
      flipped: false, // lessons are authored from the white side
      selected: selection ? selection.sq : null,
      legalTargets: selection ? selection.targets : [],
      lastMove: learn.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      hintMove: learn.helpArrow,
      flashSquare: learn.flash,
      stars,
      cursor: cursorSquare(),
    };
  }

  /** Two misses on the same task → show the answer (stars for taps, arrow for moves). */
  function learnRegisterMiss() {
    learn.misses++;
    if (learn.misses < 2 || learn.helpOn) return;
    learn.helpOn = true;
    const task = curTask();
    if (task.type === "move" && task.solution && task.solution.length) {
      try {
        const probe = new Chess(task.fen);
        const mv = probe.move(task.solution[0]);
        if (mv) learn.helpArrow = { from: mv.from, to: mv.to };
      } catch (_) {}
    }
    toast(t("lm.answerShown"));
    sync();
  }

  function learnFlash(sq) {
    learn.flash = sq;
    draw();
    const token = learn.token;
    setTimeout(() => {
      if (learn && learn.token === token && learn.flash === sq) { learn.flash = null; draw(); }
    }, 380);
  }

  function learnTaskText() {
    const task = curTask();
    if (learn.demoing) return t("lm.demoing");
    if (learn.done) return t("lm.taskDone") + (learn.li + 1 < LESSONS.length ? t("lm.tapNext") : t("lm.allDone"));
    const tx = taskText(curLesson(), learn.ti);
    if (task.type === "tap") return tx.step(learn.tapStep) + "(" + (learn.tapStep + 1) + "/" + task.steps.length + ")";
    if (task.type === "drill" && learn.engineBusy) return t("lm.sparThinking");
    // tx, not task: reading the prompt straight off the lesson showed every
    // move/stars/drill task in Chinese to English readers — the translations
    // were sitting in lessons-en.js unused, and only the tap tasks (which go
    // through tx.step above) ever looked translated
    return tx.prompt;
  }

  function learnClick(sq) {
    if (!learn || learn.done) return;
    if (learn.demoing) { skipLessonDemo(); return; }
    const task = curTask();
    if (task.type === "tap") {
      if (task.steps[learn.tapStep].squares.includes(sq)) {
        learn.tapStep++;
        learn.helpOn = false;
        learn.misses = 0;
        Audio2.playStar();
        learnFlash(sq);
        if (learn.tapStep >= task.steps.length) learnTaskDone();
        else sync();
      } else {
        // the localised tip, not the authored one — same reason as learnTaskText
        toast(tf("lm.wrongSquare", [taskText(curLesson(), learn.ti).step(learn.tapStep)]));
        learnRegisterMiss();
      }
      return;
    }
    if (task.type === "drill" && learn.engineBusy) return;
    const g = learn.g;
    if (g.game_over()) return;
    const piece = g.get(sq);
    if (selection && selection.targets.includes(sq)) {
      const from = selection.sq;
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
      selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (task.only && piece && piece.color === "w" && piece.type !== task.only) {
      toast(tf("lm.onlyPiece", [PIECE_NAMES[task.only]]));
      return;
    }
    if (selection) { selection = null; draw(); }
  }

  const PIECE_NAMES = new Proxy({}, { get: (_, k) => t("piece." + String(k)) });

  function learnRetryTask(msg) {
    toast(msg);
    const token = learn.token;
    setTimeout(() => { if (learn && learn.token === token) startLearnTask(); }, 1400);
  }

  function learnMove(from, to, promotion) {
    const task = curTask();
    const g = learn.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    selection = null;
    learn.last = { from: mv.from, to: mv.to };
    learn.helpArrow = null;
    BoardView.animateMove(mv.from, mv.to);
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: g.in_check() });
    if (task.type === "stars") {
      if (learn.stars.has(mv.to)) {
        learn.stars.delete(mv.to);
        Audio2.playStar();
        learnFlash(mv.to);
      }
      if (learn.stars.size === 0) { learnTaskDone(); return; }
      // hand the turn straight back to the student — the opponent never replies
      const f = g.fen().split(" ");
      f[1] = "w"; f[3] = "-";
      learn.g = new Chess(f.join(" "));
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
      learn.last = null;
      // the translated retry hint, not the raw Chinese one on the task
      toast(taskText(curLesson(), learn.ti).retry || t("lm.retry"));
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
    if (!window.ChessEngine) { toast(t("lm.noEngine")); return; }
    const g = learn.g;
    const token = learn.token;
    // drills default to the weakest tier: the sparring partner is there to
    // teach the technique, not to punish a beginner with perfect defense
    const tier = curTask().engine || "beginner";
    learn.engineBusy = true;
    sync();
    let mv = null;
    try { mv = await window.ChessEngine.bestMove(g.fen(), tier); } catch (_) {}
    if (!learn || token !== learn.token) return;
    learn.engineBusy = false;
    if (mv) {
      const played = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
      if (played) {
        learn.last = { from: played.from, to: played.to };
        Audio2.playMove(played.color, { captured: !!played.captured, check: g.in_check() });
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
    if (!learn || learn.done || curTask().type !== "drill") return;
    const g = learn.g;
    if (!g.history().length) return;
    learn.token++; // drop any in-flight engine reply
    learn.engineBusy = false;
    if (window.ChessEngine) window.ChessEngine.cancel();
    g.undo();
    if (g.history().length && g.turn() !== "w") g.undo();
    learn.last = null;
    learn.helpArrow = null;
    selection = null;
    sync();
  }

  /** Drill-only engine hint, drawn as an arrow (full strength, brief think). */
  async function learnHint() {
    if (!learn || learn.done || curTask().type !== "drill" || learn.engineBusy) return;
    if (!window.ChessEngine) { toast(t("m.01")); return; }
    const g = learn.g;
    if (g.game_over() || g.turn() !== "w") return;
    if (hintPending) return;
    const token = learn.token;
    const sig = g.fen();
    hintPending = true;
    sync();
    let e = null;
    try { e = await window.ChessEngine.analyze(sig, 400); } catch (_) {}
    hintPending = false;
    if (!learn || token !== learn.token || learn.g.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast(t("m.03")); return; }
    learn.helpArrow = { from: e.best.slice(0, 2), to: e.best.slice(2, 4) };
    sync();
  }

  function learnTaskDone() {
    const L = curLesson();
    selection = null;
    if (learn.ti + 1 < L.tasks.length) {
      Audio2.playMove("b");
      toast(t("lm.nextSubtask"));
      learn.ti++;
      // startLearnTask resets the per-task cursors, but it runs 900ms later —
      // and the board and prompt are redrawn now. A tap task followed by
      // another tap task would spend that gap reading step[3] of a 1-step task.
      learn.tapStep = 0;
      learn.helpOn = false;
      const token = ++learn.token;
      setTimeout(() => { if (learn && learn.token === token) startLearnTask(); }, 900);
      sync();
      return;
    }
    learn.done = true;
    Audio2.playWin();
    if (!learnState.done[L.id]) {
      learnState.done[L.id] = true;
      saveLearnState();
      checkNewAchievements();
    }
    toast(tf("lm.lessonDone", [lessonText(L).title]));
    sync();
  }

  function syncLearnUI() {
    const sec = document.getElementById("sec-learn");
    if (!sec) return;
    sec.hidden = mode !== "learn";
    if (mode !== "learn" || !learn) return;
    const L = curLesson();
    const doneCount = LESSONS.filter((x) => learnState.done[x.id]).length;
    const prog = document.getElementById("learn-progress");
    if (prog) prog.textContent = doneCount + "/" + LESSONS.length;
    const loc = lessonText(L);
    const title = document.getElementById("lesson-title");
    if (title) title.textContent = t("learn.lessonPre") + (learn.li + 1) + t("learn.lessonPost") + " · " + loc.part + " · " + loc.title;
    const textEl = document.getElementById("lesson-text");
    if (textEl) {
      textEl.innerHTML = "";
      for (const p of loc.text) {
        const el = document.createElement("p");
        el.textContent = p;
        textEl.appendChild(el);
      }
    }
    const task = document.getElementById("lesson-task");
    if (task) task.textContent = learnTaskText();
    const demoBtn = document.getElementById("lesson-demo");
    if (demoBtn) {
      const curT = curTask();
      demoBtn.disabled = learn.demoing || !curT.solution || (curT.type !== "stars" && curT.type !== "move");
    }
    const next = document.getElementById("lesson-next");
    if (next) {
      const isLast = learn.li + 1 >= LESSONS.length;
      next.textContent = isLast ? t("lm.toBeginnerAi") : t("act.next");
      // `learn.done` only records whether the tasks were finished *this
      // session*, so someone returning to a course they already completed
      // found the graduation button greyed out — the one button the whole
      // teaching track exists to reach. The saved progress counts too.
      const everDone = !!learnState.done[LESSONS[learn.li].id];
      next.disabled = isLast && !learn.done && !everDone;
      next.classList.toggle("primary", learn.done || (isLast && everDone));
    }
    const list = document.getElementById("lesson-list");
    if (list) {
      list.innerHTML = "";
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
        b.className = "lesson-item" + (i === learn.li ? " current" : "");
        b.dataset.i = String(i);
        const mark = learnState.done[x.id] ? "✓ " : "";
        b.textContent = mark + (i + 1) + ". " + xl.title;
        list.appendChild(b);
      });
    }
  }

  // --- puzzle mode: tactics trainer (data in puzzles.js, pure chess.js) ---
  const PUZZLE_KEY = "chess.v1.puzzles";
  const PUZZLES = window.CHESS_PUZZLES || [];
  const PUZZLE_CAT_IDS = ["m1", "m2", "m3", "win", "tac", "op", "review"];
  const PUZZLE_MOVES = { m1: 1, m2: 2, m3: 3 };
  /** scripted-line categories: exact-line play, opponent replies from the script */
  const SCRIPTED_CATS = { win: true, op: true, tac: true };

  /** Opening trainer drills, generated from the vendored ECO book (≥6 plies). */
  const OPENING_DRILLS = (window.CHESS_OPENINGS || [])
    .filter(([, , seq]) => seq.split(" ").length >= 6)
    .map(([eco, name, seq, idea], i) => ({
      id: "op-" + eco + "-" + i,
      cat: "op",
      // `zh` is the key both English tables are keyed by; the displayed name is
      // built at render time so a language switch relabels the whole drill list
      zh: name,
      eco,
      name: eco + " " + name,
      line: seq.split(" "),
      idea: idea || "",
    }));
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
    score += (plies - 1) * 1.5;                    // longer forcing lines dominate
    if (p.cat === "op") score += 3;                // rote lines need memorising
    if (p.cat === "tac") score += 1.5;
    if (p.cat === "win" && typeof p.gain === "number" && p.gain <= 3) score += 1; // small wins hide better
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
  /** active difficulty filter: "all" | "easy" | "mid" | "hard" */
  let puzzleTierFilter = "all";

  function loadPuzzleState() {
    try {
      const s = JSON.parse(Host.storageGet(PUZZLE_KEY) || "null");
      if (s && s.v === 1 && s.solved) { if (!s.missed) s.missed = {}; return s; }
    } catch (_) {}
    return { v: 1, solved: {}, missed: {}, cat: "m1" };
  }
  let puzzleState = loadPuzzleState();
  function savePuzzleState() {
    try { Host.storageSet(PUZZLE_KEY, JSON.stringify(puzzleState)); } catch (_) {}
  }
  const Srs = window.ChessSrs;
  function markMissed(id) {
    puzzleState.missed[id] = Srs.onMiss(puzzleState.missed[id]);
    savePuzzleState();
  }
  /**
   * A clean solve advances the puzzle towards leaving the review queue — it no
   * longer graduates on the first correct answer, which was usually given
   * moments after reading the solution.
   */
  function clearMissed(id) {
    if (!Srs.isDue(puzzleState.missed[id])) return;
    const next = Srs.onSolve(puzzleState.missed[id]);
    if (next) puzzleState.missed[id] = next; else delete puzzleState.missed[id];
    savePuzzleState();
  }

  /** "review" is a virtual category: every puzzle currently in the missed set. */
  function puzzlesInCat(cat) {
    const base = cat === "review"
      // least-learned first, so a puzzle just answered goes to the back of the
      // queue instead of being asked again on the very next click
      ? Srs.order(ALL_PUZZLES.filter((p) => Srs.isDue(puzzleState.missed[p.id])).map((p) => p.id),
        puzzleState.missed).map((id) => ALL_PUZZLES.find((p) => p.id === id))
      : ALL_PUZZLES.filter((p) => p.cat === cat);
    // "Review" is not a difficulty band — it is exactly the set of puzzles this
    // player got wrong. Filtering it by an automatically derived tier hides the
    // very puzzles they asked to redo (a queue of three could show as empty),
    // so the tier row does not apply here.
    if (cat === "review" || puzzleTierFilter === "all") return base;
    return base.filter((p) => puzzleTier(p) === puzzleTierFilter);
  }

  /** the scripted line of the current puzzle (openings: line; win: solution) */
  function puzzleScript(p) { return p.line || p.solution; }

  function startPuzzleAt(cat, idx) {
    const list = puzzlesInCat(cat);
    if (!list.length) {
      // no puzzle survives the filter: clear the board and the counters too,
      // otherwise the previous puzzle stays on screen and the "n/N" chip keeps
      // counting a set that is no longer being shown
      puzzle = null;
      selection = null;
      BoardView.cancelAnim();
      sync();
      toast(t("pz.noneInTier"));
      return;
    }
    idx = ((idx % list.length) + list.length) % list.length;
    puzzleState.cat = cat;
    savePuzzleState();
    const p = list[idx];
    puzzle = { cat, idx, p, g: p.fen ? new Chess(p.fen) : new Chess(), stage: 0, done: false, misses: 0, usedAnswer: false, helpArrow: null, last: null };
    selection = null;
    BoardView.cancelAnim();
    sync();
  }

  function startPuzzles() {
    let cat = PUZZLE_CAT_IDS.includes(puzzleState.cat) ? puzzleState.cat : "m1";
    // don't strand the user on an empty review tab
    if (cat === "review" && !puzzlesInCat("review").length) cat = "m1";
    const list = puzzlesInCat(cat);
    let idx = list.findIndex((p) => !puzzleState.solved[p.id]);
    if (idx < 0) idx = 0;
    startPuzzleAt(cat, idx);
  }
  function stopPuzzles() { puzzle = null; }

  function puzzleModel() {
    const g = puzzle.g;
    return {
      position: g.board(),
      flipped: false, // all puzzles are white to move
      selected: selection ? selection.sq : null,
      legalTargets: selection ? selection.targets : [],
      lastMove: puzzle.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      hintMove: puzzle.helpArrow,
      stars: [],
      cursor: cursorSquare(),
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
    const p = puzzle.p;
    if (p.cat === "op") return tf("pz.goalOp", [puzzleName(p), Math.ceil(p.line.length / 2)]);
    if (p.cat === "win") return tf("pz.goalWin", [puzzleName(p), p.gain]);
    if (p.cat === "tac") return tf("pz.goalTac", [puzzleName(p), puzzleMotif(p), p.gain]);
    // the count is a word in Chinese ("一步"), a numeral in English — so it
    // goes through the dictionary rather than being interpolated raw
    return tf("pz.goalMate", [puzzleName(p), t("pz.n." + (PUZZLE_MOVES[p.cat] || 1))]);
  }

  function puzzleClick(sq) {
    if (!puzzle || puzzle.done) return;
    const g = puzzle.g;
    if (g.game_over() || g.turn() !== "w") return;
    const piece = g.get(sq);
    if (selection && selection.targets.includes(sq)) {
      const from = selection.sq;
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
      selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (selection) { selection = null; draw(); }
  }

  function puzzleMove(from, to, promotion) {
    const g = puzzle.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    selection = null;
    puzzle.helpArrow = null;
    puzzle.last = { from: mv.from, to: mv.to };
    BoardView.animateMove(mv.from, mv.to);
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: g.in_check() });
    if (SCRIPTED_CATS[puzzle.p.cat]) {
      // scripted line: exact match, opponent replies straight from the script
      const script = puzzleScript(puzzle.p);
      if (mv.san !== script[puzzle.stage]) {
        const c = puzzle.p.cat;
        puzzleWrong(
          c === "win" ? (mv.captured ? t("pz.wrongCapture") : t("pz.biggerPrize")) :
          c === "tac" ? (puzzle.stage === 0 ? tf("pz.findMotif", [puzzleMotif(puzzle.p)]) : t("pz.takeTarget")) :
          openingWhy(g, mv, script[puzzle.stage]));
        return;
      }
      puzzle.stage++;
      if (puzzle.stage < script.length) {
        const rm = g.move(script[puzzle.stage]);
        if (rm) {
          puzzle.last = { from: rm.from, to: rm.to };
          Audio2.playMove(rm.color, { captured: !!rm.captured, check: g.in_check() });
          puzzle.stage++;
        }
      }
      if (puzzle.stage >= script.length) { puzzleSolved(); return; }
      sync();
      return;
    }
    if (g.in_checkmate()) { puzzleSolved(); return; }
    const totalMoves = PUZZLE_MOVES[puzzle.p.cat] || 1;
    const remaining = totalMoves - (puzzle.stage + 1);
    if (remaining <= 0) {
      // used the last move without mating — explain what black gets to play
      const escape = g.moves()[0];
      puzzleWrong(escape ? tf("pz.notMateYetMove", [escape]) : t("pz.notMateYet"));
      return;
    }
    // midpoint: the stored line, or any alternate that still forces mate
    const onLine = mv.san === puzzle.p.solution[puzzle.stage * 2];
    if (!onLine) {
      const refutation = findRefutation(g, remaining);
      if (refutation) {
        puzzleWrong(tf("pz.refuted", [refutation]));
        return;
      }
    }
    puzzle.stage++;
    const reply = onLine ? puzzle.p.solution[puzzle.stage * 2 - 1] : bestDefense(g, remaining);
    const rm = reply ? g.move(reply) : null;
    if (rm) {
      puzzle.last = { from: rm.from, to: rm.to };
      Audio2.playMove(rm.color, { captured: !!rm.captured, check: g.in_check() });
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
    const Coach = window.ChessOpeningCoach;
    if (!Coach || !bookSan) return t("pz.offBook");
    let r = null;
    try { r = Coach.critique(puzzle.p.fen || "", g.history().slice(0, -1), mv.san, bookSan, Chess); }
    catch (_) { r = null; }
    if (!r) return t("pz.offBook");
    // the coach knows nothing about the dictionary, so a piece comes back as
    // its key ("piece.n") and is turned into a word here
    const vals = r.vals.map((v) => (typeof v === "string" && v.startsWith("piece.") ? t(v) : v));
    return tf(r.key, vals);
  }

  function puzzleWrong(reason) {
    puzzle.g.undo();
    puzzle.last = null;
    puzzle.misses++;
    markMissed(puzzle.p.id); // a missed puzzle joins the review queue
    toast((reason || t("pz.noForcedMate")) +
      (puzzle.misses >= 2 ? t("pz.seeAnswer") : t("pz.tryAgain")));
    sync();
  }

  /** Arrow for the correct move at the current stage. */
  function showPuzzleAnswer() {
    if (!puzzle || puzzle.done) return;
    const g = puzzle.g;
    if (g.turn() !== "w" || g.game_over()) return;
    let from = null, to = null;
    // on the stored line the stored move is always valid here
    const stored = SCRIPTED_CATS[puzzle.p.cat]
      ? puzzleScript(puzzle.p)[puzzle.stage]
      : puzzle.p.solution[puzzle.stage * 2];
    if (stored) {
      const probe = new Chess(g.fen());
      const mv = probe.move(stored);
      if (mv) { from = mv.from; to = mv.to; }
    }
    if (!from) {
      // off the stored line — search for any move that still forces mate
      const remaining = (PUZZLE_MOVES[puzzle.p.cat] || 1) - puzzle.stage;
      for (const m of g.moves({ verbose: true })) {
        g.move(m);
        const ok = g.in_checkmate() ||
          (remaining > 1 && !g.game_over() && blackForcedLost(g, remaining - 1));
        g.undo();
        if (ok) { from = m.from; to = m.to; break; }
      }
    }
    if (from) {
      puzzle.helpArrow = { from, to };
      puzzle.usedAnswer = true;
      markMissed(puzzle.p.id); // relying on the answer counts as a miss
      sync();
    }
  }

  function puzzleSolved() {
    puzzle.done = true;
    selection = null;
    Audio2.playWin();
    // a clean first-try solve retires the puzzle from review; a shaky one keeps it
    if (puzzle.misses === 0 && !puzzle.usedAnswer) clearMissed(puzzle.p.id);
    if (!puzzleState.solved[puzzle.p.id]) {
      puzzleState.solved[puzzle.p.id] = true;
      savePuzzleState();
      checkNewAchievements();
    }
    const verb = puzzle.p.cat === "op" ? t("pz.doneOp") :
      puzzle.p.cat === "win" || puzzle.p.cat === "tac" ? t("pz.doneWin") : t("pz.doneMate");
    toast("✅ " + verb + " · " + puzzleName(puzzle.p));
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
    if (!puzzle || !puzzle.done || puzzle.p.cat !== "op") return;
    const line = puzzle.g.pgn();
    const name = puzzleName(puzzle.p);
    if (!line.trim()) return;
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    stopPuzzles();
    mode = "ai";
    humanColor = "w"; // every opening drill is played from White's side
    flipped = false;
    flagFall = null;
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    analysis = null;
    statsRecordedSig = null;
    game.reset();
    game.load_pgn(line, { sloppy: true });
    selection = null;
    hintMove = null;
    viewIndex = sanHistory().length;
    resetClocks();
    saveSettings();
    saveGame();
    sync();
    toast(tf("pz.playOn", [name]));
    maybeEngineTurn();
  }

  function nextPuzzle() {
    if (!puzzle) return;
    let list = puzzlesInCat(puzzle.cat);
    if (puzzle.cat === "review") {
      // a clean re-solve shrinks the queue; graduate to m1 when it empties
      if (!list.length) {
        toast(t("pz.reviewEmptyDone"));
        puzzleState.cat = "m1"; savePuzzleState();
        startPuzzles();
        return;
      }
      startPuzzleAt("review", puzzle.idx % list.length);
      return;
    }
    // prefer the next unsolved one, wrapping around
    for (let d = 1; d <= list.length; d++) {
      const i = (puzzle.idx + d) % list.length;
      if (!puzzleState.solved[list[i].id]) { startPuzzleAt(puzzle.cat, i); return; }
    }
    startPuzzleAt(puzzle.cat, puzzle.idx + 1);
  }

  function syncPuzzleUI() {
    const sec = document.getElementById("sec-puzzle");
    if (!sec) return;
    sec.hidden = mode !== "puzzle";
    if (mode !== "puzzle") return;
    // an empty difficulty filter leaves no puzzle loaded — keep the filter row
    // usable so the user can pick their way back out
    if (!puzzle) {
      document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.tier === puzzleTierFilter);
        b.disabled = false; // no puzzle loaded means we are not in review
      });
      document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.cat === puzzleState.cat);
      });
      const emptyProg = document.getElementById("puzzle-progress");
      if (emptyProg) emptyProg.textContent = tf("pz.solvedCount",
        [ALL_PUZZLES.filter((p) => puzzleState.solved[p.id]).length, ALL_PUZZLES.length]);
      const emptyTask = document.getElementById("puzzle-task");
      if (emptyTask) emptyTask.textContent = t("pz.noneInTier");
      const emptyList = document.getElementById("puzzle-list");
      if (emptyList) emptyList.innerHTML = "";
      return;
    }
    const list = puzzlesInCat(puzzle.cat);
    const solvedAll = ALL_PUZZLES.filter((p) => puzzleState.solved[p.id]).length;
    const missedCount = puzzlesInCat("review").length;
    const prog = document.getElementById("puzzle-progress");
    if (prog) {
      prog.textContent = puzzle.cat === "review"
        ? tf("pz.missedCount", [missedCount])
        : tf("pz.solvedCount", [solvedAll, ALL_PUZZLES.length]);
    }
    // the tier row does nothing in the review queue — grey it out rather than
    // leaving buttons that look live but change nothing
    const inReview = puzzle.cat === "review";
    document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
      b.classList.toggle("active", !inReview && b.dataset.tier === puzzleTierFilter);
      b.disabled = inReview;
    });
    const tierRow = document.getElementById("row-puzzle-tier");
    if (tierRow) tierRow.classList.toggle("muted-row", inReview);
    document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === puzzle.cat);
      // surface how many are queued for review right on the tab
      if (b.dataset.cat === "review") b.textContent = t("pz.cat.review") + (missedCount ? "·" + missedCount : "");
    });
    const task = document.getElementById("puzzle-task");
    if (task) {
      task.textContent = puzzle.done
        ? t("pz.solvedNext")
        : tf("pz.nth", [puzzle.idx + 1]) + " · " + puzzleGoalText();
    }
    // opening drills are rote memorisation without the "why" — show the idea
    const ideaEl = document.getElementById("puzzle-idea");
    if (ideaEl) {
      const idea = puzzleIdea(puzzle.p);
      ideaEl.hidden = !idea;
      ideaEl.textContent = idea ? t("pz.idea") + " · " + idea : "";
    }
    // a finished opening line offers the game it was drilled for; that is the
    // reward, so it takes the primary emphasis from "next puzzle"
    const canPlayOn = !!puzzle.done && puzzle.p.cat === "op";
    const playOn = document.getElementById("puzzle-playon");
    if (playOn) {
      playOn.hidden = !canPlayOn;
      playOn.classList.toggle("primary", canPlayOn);
    }
    const next = document.getElementById("puzzle-next");
    if (next) next.classList.toggle("primary", puzzle.done && !canPlayOn);
    const listEl = document.getElementById("puzzle-list");
    if (listEl) {
      listEl.innerHTML = "";
      list.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === puzzle.idx ? " current" : "");
        b.dataset.i = String(i);
        b.textContent = (puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + puzzleName(p);
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

  function analysisFor() {
    return analysis && analysis.sig === game.pgn() ? analysis : null;
  }

  async function analyzeGame(movetime) {
    if (analyzing || !window.ChessEngine) return;
    const perMove = movetime || 120;
    const h = sanHistory();
    if (!h.length) { toast(t("m.19")); return; }
    const sig = game.pgn();
    const g = baseGame();
    const fens = [g.fen()];
    for (const san of h) { g.move(san); fens.push(g.fen()); }
    analyzing = true;
    analyzeAbort = false;
    analyzeProgress = "0/" + fens.length;
    setAnalyzeUI();
    const scalars = new Array(fens.length).fill(null);
    const pvs = new Array(fens.length).fill(null);
    for (let i = 0; i < fens.length; i++) {
      if (analyzeAbort) {
        analyzing = false; analyzeAbort = false; analyzeProgress = "";
        // keep whatever was already measured — a partial curve still helps
        if (i > 1) {
          analysis = { sig, scalars, tags: h.map(() => null), pvs };
          toast(t("m.30") + (i - 1) + t("m.31"));
        } else toast(t("m.29"));
        sync();
        return;
      }
      if (game.pgn() !== sig) { analyzing = false; analyzeProgress = ""; setAnalyzeUI(); return; }
      const probe = new Chess(fens[i]);
      if (probe.in_checkmate()) scalars[i] = probe.turn() === "w" ? -10000 : 10000;
      else if (probe.game_over()) scalars[i] = 0;
      else {
        let e = null;
        try { e = await window.ChessEngine.analyze(fens[i], perMove); } catch (_) {}
        if (game.pgn() !== sig) { analyzing = false; analyzeProgress = ""; setAnalyzeUI(); return; }
        scalars[i] = evalScalar(e);
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
      analyzeProgress = (i + 1) + "/" + fens.length;
      setAnalyzeUI();
    }
    // centipawn loss from the mover's perspective — the mover of ply i is the
    // side to move in fens[i] (FEN-start games may begin with black)
    const tags = h.map((_, i) => {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) return null;
      const moverIsWhite = fens[i].split(" ")[1] === "w";
      const loss = moverIsWhite ? a - b : b - a;
      if (loss >= 300) return "??";
      if (loss >= 100) return "?";
      if (loss >= 50) return "?!";
      return null;
    });
    analysis = { sig, scalars, tags, pvs, acc: accuracyFrom(fens, scalars) };
    analyzing = false;
    analyzeProgress = "";
    recordAccuracy();
    sync();
    const bad = tags.filter((tag) => tag === "?" || tag === "??").length;
    toast(bad ? t("m.27") + bad + t("m.28") : t("m.26"));
  }

  /**
   * Per-side average centipawn loss and an accuracy score derived from it.
   *
   * The accuracy curve is the usual exponential decay (100% at zero loss,
   * ~60% around 60cp average) — it is a readable summary, not an official
   * rating, and the UI labels it as such.
   */
  function accuracyFrom(fens, scalars) {
    const acc = { w: null, b: null, wAcpl: null, bAcpl: null };
    const loss = { w: [], b: [] };
    for (let i = 0; i + 1 < scalars.length; i++) {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) continue;
      const side = fens[i].split(" ")[1] === "w" ? "w" : "b";
      const d = side === "w" ? a - b : b - a;
      loss[side].push(Math.max(0, Math.min(1000, d)));
    }
    for (const side of ["w", "b"]) {
      if (!loss[side].length) continue;
      const mean = loss[side].reduce((x, y) => x + y, 0) / loss[side].length;
      acc[side === "w" ? "wAcpl" : "bAcpl"] = Math.round(mean);
      acc[side] = Math.round(100 * Math.exp(-mean / 120));
    }
    return acc;
  }

  /**
   * Attach the human's accuracy to the stats record of the game just analysed.
   *
   * Matched by the record's stored `sig`, never by "the most recent record":
   * analysing an imported or replayed game would otherwise stamp its accuracy
   * onto an unrelated game the user really did play.
   */
  function recordAccuracy() {
    if (mode !== "ai" || !analysis || !analysis.acc) return;
    if (!(naturalGameOver() || ruleTerminated())) return;
    const mine = humanColor === "w" ? analysis.acc.w : analysis.acc.b;
    const acpl = humanColor === "w" ? analysis.acc.wAcpl : analysis.acc.bAcpl;
    if (mine == null) return;
    const pgn = game.pgn();
    const s = loadStats();
    // statsRecordedSig is the signature this game was filed under (it carries a
    // "#resigned"-style suffix for app-level endings, hence the prefix match)
    const rec = s.games.find((g) => g.sig && (g.sig === pgn || g.sig === statsRecordedSig));
    if (!rec || rec.acc != null) return; // not ours to annotate, or already done
    rec.acc = mine;
    rec.acpl = acpl;
    try { Host.storageSet(STATS_KEY, JSON.stringify(s)); } catch (_) {}
    renderStats();
  }

  function setAnalyzeUI() {
    const btn = document.getElementById("an-run");
    // while a run is in flight the primary button becomes the stop control —
    // a deep pass over a long game is a minute of engine time to be stuck in
    if (btn) {
      btn.disabled = !analyzing && !sanHistory().length;
      btn.textContent = analyzing ? t("act.stop") + " " + analyzeProgress : t("act.analyze");
      btn.title = t(analyzing ? "tipRun.stop" : "tipRun.analyze");
    }
    const deep = document.getElementById("an-deep");
    if (deep) deep.disabled = analyzing || !sanHistory().length;
    const wrap = document.getElementById("eval-wrap");
    if (wrap) {
      wrap.hidden = !analysisFor();
      if (!wrap.hidden) drawEvalCurve();
    }
    const pvEl = document.getElementById("pv-line");
    if (pvEl) {
      const a = analysisFor();
      const pv = a && a.pvs ? a.pvs[viewIndex] : null;
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
    const R = window.ChessReview;
    const a = analysisFor();
    const sum = R && a ? R.summarize(a.scalars, sanHistory(), startFen() ? (startFen().split(" ")[1] === "b" ? "b" : "w") : "w") : null;
    el.hidden = !sum;
    el.innerHTML = "";
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
      who.textContent = t(side === "w" ? "m.04" : "m.05");
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
        [sum.worst.moveNo, t(sum.worst.side === "w" ? "m.04" : "m.05"), sum.worst.san,
         (sum.worst.loss / 100).toFixed(1)]);
      btn.title = t("rv.jumpTip");
      // land on the position *after* the move, so the damage is on the board
      btn.onclick = () => setViewIndex(sum.worst.ply + 1);
      el.appendChild(btn);
    }
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
      ctx.fillStyle = tagCh === "??" ? "#e05252" : "#e0a03c";
      ctx.beginPath();
      ctx.arc(x(i + 1), y(s), 2.4 * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
    // current view marker
    ctx.strokeStyle = cAccent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(x(viewIndex), 2 * dpr); ctx.lineTo(x(viewIndex), H - 2 * dpr); ctx.stroke();
    ctx.globalAlpha = 1;
  }

  // --- stats (AI-mode finished games) ---
  function loadStats() {
    try {
      const s = JSON.parse(Host.storageGet(STATS_KEY) || "null");
      if (s && s.v === 1 && Array.isArray(s.games)) return s;
    } catch (_) {}
    return { v: 1, games: [] };
  }

  /** Record an AI game the moment it finishes on a live move (not on import). */
  function recordGameIfOver() {
    if (mode !== "ai" || !naturalGameOver()) return;
    const sig = game.pgn();
    if (statsRecordedSig === sig) return;
    statsRecordedSig = sig;
    let result = "draw";
    if (game.in_checkmate()) result = game.turn() === humanColor ? "loss" : "win";
    const s = loadStats();
    // `sig` ties the record to the exact game it came from, so a later
    // analysis can only annotate the game it actually measured
    s.games.push({ t: Date.now(), diff: difficulty, color: humanColor, result, moves: sanHistory().length, sig });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    try { Host.storageSet(STATS_KEY, JSON.stringify(s)); } catch (_) {}
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
    if (mode !== "ai" || !window.ChessEngine || analyzing) return;
    if (analysisFor()) return; // already analysed — the report is on screen
    if (sanHistory().length < 6) return; // too short to say anything useful
    setTimeout(() => {
      if (mode === "ai" && !analyzing && !analysisFor() && appGameOver()) toast(t("rv.offer"));
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
    el.innerHTML = "";
    let total = 0;
    for (const k of ["beginner", "easy", "normal", "hard", "extreme"]) {
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
  /** the newest-first list the rendered rows index into */
  let histCache = [];

  function historyGames() {
    return loadStats().games.filter((g) => g && typeof g.sig === "string" && g.sig.trim()).reverse();
  }

  /**
   * The playable PGN of a record.
   *
   * `sig` doubles as the record's identity, so a game ended by an app-level
   * rule carries a "#resigned"-style marker after the movetext. A checkmate
   * ends in a bare "#", so stripping a trailing "#word" can never eat a move.
   */
  function historyPgn(rec) {
    return String(rec.sig || "").replace(/#[a-zA-Z]+$/, "");
  }

  /** the app-level ending marker of a record, or "" for mate/stalemate */
  function historyEnding(rec) {
    const m = /#([a-zA-Z]+)$/.exec(String(rec.sig || ""));
    return m ? m[1] : "";
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

  function renderHistory() {
    histCache = historyGames();
    const body = document.getElementById("hist-body");
    if (body) {
      body.innerHTML = "";
      if (!histCache.length) {
        const p = document.createElement("p");
        p.className = "hint";
        p.textContent = t("hist.empty");
        body.appendChild(p);
      } else {
        histCache.slice(0, HIST_PREVIEW).forEach((rec, i) => body.appendChild(historyRow(rec, i, false)));
      }
    }
    const btn = document.getElementById("hist-open");
    if (btn) {
      btn.hidden = !histCache.length;
      btn.textContent = tf("hist.all", [histCache.length]);
    }
    const list = document.getElementById("hist-list");
    if (list) {
      list.innerHTML = "";
      histCache.forEach((rec, i) => list.appendChild(historyRow(rec, i, true)));
    }
  }

  function openHistory() {
    renderHistory();
    const m = document.getElementById("hist-modal");
    if (m) m.classList.add("show");
  }
  function closeHistory() {
    const m = document.getElementById("hist-modal");
    if (m) m.classList.remove("show");
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
      resigned = rec.color; // in an engine game only the human can resign
    } else if (end === "drawAgreed") {
      drawAgreed = true;
    } else if (end === "claimed") {
      // the record does not say which rule was claimed; the halfmove clock does
      drawClaimed = Number(game.fen().split(" ")[4]) >= 100 ? "fifty" : "threefold";
    } else if (end === "flag") {
      const other = rec.color === "w" ? "b" : "w";
      flagFall = rec.result === "win" ? other : rec.result === "loss" ? rec.color
        : sideHasMatingMaterial(other) ? other : rec.color;
      // the record does not keep the clocks; zeroing the side that ran out is
      // enough to stop a full clock sitting next to "flag fall". With the time
      // control since switched off there is no clock to correct.
      if (clock) { clock[flagFall] = 0; renderClocks(); }
      syncClockTimer();
    }
  }

  async function loadFromHistory(i) {
    const rec = histCache[i];
    if (!rec) return;
    closeHistory();
    const ok = await importPgnText(historyPgn(rec), t("hist.title"),
      { msg: t("dlg.loadHist"), title: t("dlg.loadHistTitle"), ok: t("dlg.loadHistOk") });
    if (!ok) return;
    // Restore the context the game was played in. Orientation and difficulty
    // are what the board and the review report mean by "you", and pinning
    // statsRecordedSig to this record lets a fresh 分析 file its accuracy back
    // onto the very game it just measured.
    mode = "ai";
    if (DIFF_NAMES[rec.diff]) difficulty = rec.diff;
    if (rec.color === "w" || rec.color === "b") { humanColor = rec.color; flipped = humanColor === "b"; }
    statsRecordedSig = rec.sig;
    restoreEnding(rec);
    // the import ends by offering the position to the engine; a game that ended
    // in resignation is not over by its moves, so call off that search now that
    // the ending is back in place
    invalidateEngine();
    analysis = null;
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
    const cur = st.games.filter((g) => g.diff === difficulty);
    const recent = cur.slice(-6);
    const idx = DIFF_IDS.indexOf(difficulty);
    // an unfinished course outranks any difficulty advice
    const done = LESSONS.filter((l) => learnState.done[l.id]).length;
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
      const missed = ALL_PUZZLES.filter((p) => window.ChessSrs.isDue(puzzleState.missed[p.id])).length;
      return missed ? tf("rec.review", [missed]) : t("rec.puzzles");
    }
    return null;
  }

  // --- achievements: pure derivations of stats + lesson/puzzle progress ---
  const ACH = window.CHESS_ACHIEVEMENTS || [];
  const ACH_KEY = "chess.v1.achv";
  function loadAchSeen() {
    try {
      const s = JSON.parse(Host.storageGet(ACH_KEY) || "null");
      if (s && Array.isArray(s.seen)) return new Set(s.seen);
    } catch (_) {}
    return new Set();
  }
  let achSeen = loadAchSeen();

  function achSummary() {
    const st = loadStats();
    let wins = 0, losses = 0, draws = 0, extremeWins = 0;
    for (const g of st.games) {
      if (g.result === "win") { wins++; if (g.diff === "extreme") extremeWins++; }
      else if (g.result === "loss") losses++;
      else draws++;
    }
    const solved = puzzleState.solved || {};
    const solvedIn = (cat) => ALL_PUZZLES.filter((p) => p.cat === cat && solved[p.id]).length;
    const countIn = (cat) => ALL_PUZZLES.filter((p) => p.cat === cat).length;
    const mateCats = ["m1", "m2", "m3"];
    return {
      lessonsDone: LESSONS.filter((l) => learnState.done[l.id]).length,
      lessonsTotal: LESSONS.length,
      puzzleSolvedCount: ALL_PUZZLES.filter((p) => solved[p.id]).length,
      matesSolved: mateCats.reduce((n, c) => n + solvedIn(c), 0),
      matesTotal: mateCats.reduce((n, c) => n + countIn(c), 0),
      tacSolved: solvedIn("tac"), tacTotal: countIn("tac"),
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
    const baseRes = base.map((a) => ({ ach: a, unlocked: !!a.test(s) || achSeen.has(a.id) }));
    s.otherUnlocked = baseRes.filter((r) => r.unlocked).length;
    s.otherTotal = base.length;
    const out = ACH.map((a) =>
      a.id === "completionist" ? { ach: a, unlocked: !!a.test(s) || achSeen.has(a.id) }
        : baseRes.find((r) => r.ach.id === a.id));
    // the badges' progress() reads the same summary the tests ran against
    out.summary = s;
    return out;
  }

  /** Toast any achievement newly unlocked since last check; persist seen set. */
  function checkNewAchievements() {
    const res = evalAch();
    const fresh = res.filter((r) => r.unlocked && !achSeen.has(r.ach.id));
    for (const r of res) if (r.unlocked) achSeen.add(r.ach.id);
    if (fresh.length) {
      try { Host.storageSet(ACH_KEY, JSON.stringify({ seen: Array.from(achSeen) })); } catch (_) {}
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
    el.innerHTML = "";
    const head = document.getElementById("ach-count");
    if (head) head.textContent = got + "/" + res.length;
    for (const r of res) {
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
    return flagFall && !sideHasMatingMaterial(flagFall === "w" ? "b" : "w");
  }

  function statusText() {
    if (editor) {
      const reason = window.ChessEditor.validate(editor, Chess);
      return t("st.editing") + " · " + (reason ? t(reason) : t("st.editingReady"));
    }
    if (mode === "learn") {
      if (!learn) return t("st.learn");
      if (learn.done) return t("st.lessonDone");
      // the sidebar may be closed while clicking the board — put the live
      // task instructions where they are always visible
      return learnTaskText();
    }
    if (mode === "puzzle") {
      if (!puzzle) return t("st.puzzle");
      if (puzzle.done) return t("st.puzzleDone");
      return puzzleGoalText();
    }
    const g = viewGame();
    if (!isLive()) return t("st.replay") + " " + viewIndex + "/" + sanHistory().length;
    if (flagFall) {
      if (timeoutIsDraw()) return t("st.flagDraw");
      return t(flagFall === "w" ? "st.flagWhite" : "st.flagBlack");
    }
    if (resigned) return t(resigned === "w" ? "st.resignWhite" : "st.resignBlack");
    if (drawAgreed) return t("st.drawAgreed");
    if (drawClaimed) return t(drawClaimed === "threefold" ? "st.claimThreefold" : "st.claimFifty");
    if (engineThinking && !naturalGameOver()) return t("st.thinking");
    if (g.in_checkmate()) return t(g.turn() === "w" ? "st.mateBlack" : "st.mateWhite");
    if (g.in_stalemate()) return t("st.stalemate");
    if (g.insufficient_material()) return t("st.insufficient");
    const auto = autoDrawReason();
    if (auto) return t(auto === "fivefold" ? "st.autoFivefold" : "st.autoSeventyfive");
    const side = g.turn() === "w" ? t("turn.white") : t("turn.black");
    const base = g.in_check() ? side + " · " + t("turn.check") : side;
    return claimableDrawReason() ? base + " · " + t("st.claimable") : base;
  }

  function renderMoveList() {
    const el = document.getElementById("move-list");
    if (!el) return;
    const h = sanHistory();
    el.innerHTML = "";
    // A position edited to start with Black opens at "1…", so its first row
    // holds a single black move and White's reply belongs to move 2. Pairing
    // from ply 0 would file them together under move 1 — and the review
    // report's turning-point line would then disagree with this list.
    const blackFirst = startFen() ? startFen().split(" ")[1] === "b" : false;
    const firstMover = blackFirst ? "b" : "w";
    const moveNo = (i) => (window.ChessReview
      ? window.ChessReview.moveNumber(i, firstMover)
      : Math.floor(i / 2) + 1);
    for (let i = blackFirst ? -1 : 0; i < h.length; i += 2) {
      const row = document.createElement("div");
      row.className = "mlrow";
      const num = document.createElement("span");
      num.className = "mlnum num";
      num.textContent = moveNo(Math.max(0, i)) + ".";
      row.appendChild(num);
      // the opening row of a black-first game shows "1. … Qh4"
      if (i < 0) {
        const gap = document.createElement("span");
        gap.className = "mlmove mlgap";
        gap.textContent = "…";
        row.appendChild(gap);
      }
      const a = analysisFor();
      for (const j of (i < 0 ? [0] : [i, i + 1])) {
        if (j >= h.length) break;
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.i = String(j + 1);
        b.textContent = h[j];
        b.className = "mlmove" + (viewIndex === j + 1 ? " current" : "");
        const tag = a && a.tags[j];
        if (tag) {
          const span = document.createElement("span");
          span.className = "mvtag " + (tag === "??" ? "t-bad" : tag === "?" ? "t-mid" : "t-soft");
          span.textContent = tag;
          b.appendChild(span);
        }
        row.appendChild(b);
      }
      el.appendChild(row);
    }
    const cur = el.querySelector(".current");
    if (cur && cur.scrollIntoView) {
      // scroll only within the list container
      el.scrollTop = cur.offsetTop - el.clientHeight / 2;
    }
  }

  /** Live game finished by an app-level rule (flag / resignation / agreed or claimed draw). */
  function ruleTerminated() { return !!flagFall || !!resigned || drawAgreed || !!drawClaimed; }

  // --- FIDE draw plumbing ---
  // chess.js's game_over() ends the game at threefold repetition and at the
  // 50-move mark, but under FIDE those are CLAIMABLE draws (arts. 9.2/9.3);
  // only fivefold repetition and 75 moves end the game automatically
  // (arts. 9.6). The app therefore never consults game_over() for
  // terminal-ness — it derives its own claimable/auto states here.

  const Fide = window.ChessFide;

  function halfmoveClock(g) { return Fide.halfmoveClock((g || game).fen()); }

  /** how many times the current live position has occurred (incl. start) */
  let repMemo = { sig: null, count: 1 };
  function repetitionCount() {
    const h = sanHistory();
    const sig = h.join(" ");
    if (repMemo.sig === sig) return repMemo.count;
    repMemo = { sig, count: Fide.repetitionCount(startFen(), h, Chess) };
    return repMemo.count;
  }

  /** 'fivefold' | 'seventyfive' | null — draws that end the game by law */
  function autoDrawReason() {
    if (game.in_checkmate()) return null; // a mating move trumps the 75-move rule
    if (repetitionCount() >= 5) return "fivefold";
    if (halfmoveClock() >= 150) return "seventyfive";
    return null;
  }

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

  function sync() {
    draw();
    const h = sanHistory();
    document.getElementById("status").textContent = statusText();
    document.getElementById("moves").textContent =
      mode === "learn" ? (learn ? (learn.li + 1) + "/" + LESSONS.length : "—") :
      mode === "puzzle" ? (puzzle ? tf("pz.chip", [puzzle.idx + 1, puzzlesInCat(puzzle.cat).length]) : "—") :
      viewIndex + "/" + h.length;
    document.getElementById("replay-pos").textContent = viewIndex + " / " + h.length;
    document.getElementById("rep-start").disabled = viewIndex <= 0;
    document.getElementById("rep-prev").disabled = viewIndex <= 0;
    document.getElementById("rep-next").disabled = viewIndex >= h.length;
    document.getElementById("rep-end").disabled = viewIndex >= h.length;
    document.getElementById("rep-live").disabled = isLive();
    const modal = mode === "learn" || mode === "puzzle" || !!editor;
    const inDrill = mode === "learn" && learn && !learn.done && curTask().type === "drill";
    document.getElementById("undo").disabled = modal
      ? !(inDrill && learn.g && learn.g.history().length)
      : h.length === 0 || !isLive() || ruleTerminated();
    document.getElementById("btn-new").disabled = modal;
    document.getElementById("btn-flip").disabled = modal;
    const hintBtn = document.getElementById("btn-hint");
    if (hintBtn) {
      hintBtn.disabled =
        mode === "learn"
          ? !(inDrill && !learn.engineBusy && !hintPending && learn.g && !learn.g.game_over() && learn.g.turn() === "w")
        : mode === "puzzle"
          ? !(puzzle && !puzzle.done && !puzzle.g.game_over() && puzzle.g.turn() === "w")
        : !!editor || hintPending || analyzing || !isLive() || appGameOver() ||
          (mode === "ai" && (engineThinking || game.turn() !== humanColor));
      hintBtn.textContent = mode === "puzzle" ? t("chrome.answer") : hintPending ? t("chrome.thinking") : t("chrome.hint");
    }
    const resignBtn = document.getElementById("btn-resign");
    if (resignBtn) {
      resignBtn.disabled = modal || !isLive() || h.length === 0 || appGameOver();
    }
    const drawBtn = document.getElementById("btn-offerdraw");
    if (drawBtn) {
      drawBtn.disabled = modal || !isLive() || h.length === 0 ||
        appGameOver() || drawOfferPending;
    }
    const claimBtn = document.getElementById("btn-claimdraw");
    if (claimBtn) {
      const reason = !modal && isLive() && !appGameOver() ? claimableDrawReason() : null;
      claimBtn.disabled = !reason;
      claimBtn.title = t(reason === "threefold" ? "tipRun.claimThreefold"
        : reason === "fifty" ? "tipRun.claimFifty" : "tipRun.claimNone");
    }
    document.getElementById("pgn-copy").disabled = h.length === 0;
    document.getElementById("pgn-download").disabled = h.length === 0;
    document.getElementById("fen-copy").disabled = false;
    const status = document.getElementById("status");
    const g = viewGame();
    const decisiveEnd = g.in_checkmate() || !!resigned || (flagFall && !timeoutIsDraw());
    status.classList.toggle("win", !modal && isLive() && decisiveEnd);
    status.classList.toggle("replay", !modal && !isLive());
    const over = appGameOver();
    const showTurn = !modal && isLive() && !over;
    document.getElementById("white-turn").hidden = !(showTurn && game.turn() === "w");
    document.getElementById("black-turn").hidden = !(showTurn && game.turn() === "b");
    const rt = document.getElementById("retry-here");
    if (rt) rt.disabled = isLive();
    renderMoveList();
    setAnalyzeUI();
    renderOpening();
    renderClocks();
    syncClockTimer();
    syncLearnUI();
    syncPuzzleUI();
    syncEditorUI();
    syncSettingsUI();
  }

  function syncSettingsUI() {
    document.querySelectorAll("#theme-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === themeId);
    });
    const sb = document.getElementById("opt-sound");
    if (sb) {
      sb.classList.toggle("active", soundOn);
      sb.setAttribute("aria-pressed", soundOn ? "true" : "false");
    }
    document.querySelectorAll("#mode-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === mode);
    });
    document.querySelectorAll("#diff-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.diff === difficulty);
    });
    document.querySelectorAll("#color-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.color === humanColor);
    });
    document.querySelectorAll("#clock-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tc === timeControl);
    });
    const diffRow = document.getElementById("row-difficulty");
    const colorRow = document.getElementById("row-color");
    const clockRow = document.getElementById("row-clock");
    if (diffRow) diffRow.hidden = mode !== "ai";
    if (colorRow) colorRow.hidden = mode !== "ai";
    if (clockRow) clockRow.hidden = mode !== "pvp" && mode !== "ai";
    const coachRow = document.getElementById("row-coach");
    if (coachRow) coachRow.hidden = mode !== "ai";
    const coachSwitch = document.getElementById("opt-coach");
    if (coachSwitch) coachSwitch.setAttribute("aria-pressed", coachOn ? "true" : "false");
    const flipRow = document.getElementById("row-autoflip");
    if (flipRow) flipRow.hidden = mode !== "pvp";
    const flipSwitch = document.getElementById("opt-autoflip");
    if (flipSwitch) flipSwitch.setAttribute("aria-pressed", autoFlipPvp ? "true" : "false");
    const secMoves = document.getElementById("sec-moves");
    const trainer = mode === "learn" || mode === "puzzle" || !!editor;
    if (secMoves) secMoves.hidden = trainer;
    // 统计/历史/成就 used to be hidden in the trainer modes because they sat in
    // the same scroll and got in the way. They now live behind their own tab,
    // which nobody opens by accident — and puzzle badges are earned right there.
    const engineName = "Stockfish · " + (DIFF_NAMES[difficulty] || difficulty);
    const wRole = document.getElementById("white-role");
    const bRole = document.getElementById("black-role");
    if (wRole && bRole) {
      if (mode === "ai") {
        wRole.textContent = humanColor === "w" ? t("vs.player") : engineName;
        bRole.textContent = humanColor === "b" ? t("vs.player") : engineName;
      } else if (mode === "learn") {
        const drill = learn && curTask().type === "drill";
        wRole.textContent = t("role.student");
        bRole.textContent = drill ? t("role.sparring") : "—";
      } else if (mode === "puzzle") {
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
    if (!autoFlipPvp || mode !== "pvp") return false;
    const want = viewGame().turn() === "b";
    if (flipped === want) return false;
    flipped = want;
    saveSettings(); // otherwise a reload mid-game faces the wrong player
    return true;
  }

  function setViewIndex(n) {
    viewIndex = Math.max(0, Math.min(n, sanHistory().length));
    selection = null;
    BoardView.cancelAnim();
    syncAutoFlip();
    sync();
  }

  function goLive() { setViewIndex(sanHistory().length); }

  /** localised promotion piece names — read through t() so a language switch
   * takes effect without rebuilding the table */
  const PROMO_NAMES = new Proxy({}, { get: (_, k) => t("piece." + String(k)) });
  const PROMO_GLYPHS = {
    w: { q: "♕", r: "♖", b: "♗", n: "♘" },
    b: { q: "♛", r: "♜", b: "♝", n: "♞" },
  };

  let promoResolver = null;
  /** Modal chooser for pawn promotion → 'q'|'r'|'b'|'n', or null on cancel. */
  function choosePromotion(color) {
    const modal = document.getElementById("promo-modal");
    if (!modal) return Promise.resolve("q");
    modal.querySelectorAll("button[data-p]").forEach((b) => {
      const gl = b.querySelector(".promo-glyph");
      if (gl) gl.textContent = PROMO_GLYPHS[color][b.dataset.p];
    });
    modal.classList.add("show");
    return new Promise((resolve) => { promoResolver = resolve; });
  }
  function finishPromotion(p) {
    const modal = document.getElementById("promo-modal");
    if (modal) modal.classList.remove("show");
    if (promoResolver) { promoResolver(p); promoResolver = null; }
  }

  function playHumanMove(from, to, promotion) {
    const mv = game.move({ from, to, promotion });
    if (!mv) return;
    selection = null;
    hintMove = null;
    viewIndex = sanHistory().length;
    applyIncrement(mv.color);
    BoardView.animateMove(mv.from, mv.to);
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: game.in_check() });
    if (mv.promotion) toast(tf("mm.promoted", [PROMO_NAMES[mv.promotion]]));
    if (game.in_checkmate()) Audio2.playWin();
    else if (naturalGameOver()) Audio2.playDraw();
    if (!appGameOver()) syncAutoFlip();
    coachRemember(mv);
    sync();
    saveGame();
    recordGameIfOver();
    maybeEngineTurn();
  }

  function onSquareClick(sq) {
    if (editor) { editorClick(sq); return; }
    if (mode === "learn") { learnClick(sq); return; }
    if (mode === "puzzle") { puzzleClick(sq); return; }
    if (!isLive()) { toast(t("mm.goLiveFirst")); return; }
    if (naturalGameOver()) return;
    if (flagFall) { toast(t("m.40")); return; }
    if (resigned) { toast(t("m.41")); return; }
    if (drawAgreed) { toast(t("m.42")); return; }
    if (drawClaimed) { toast(t("m.43")); return; }
    if (mode === "ai" && game.turn() !== humanColor) return; // engine's move
    const piece = game.get(sq);
    if (selection && selection.targets.includes(sq)) {
      const from = selection.sq;
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
      selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (selection) { selection = null; draw(); }
  }

  function undo() {
    if (mode === "learn") { learnUndo(); return; }
    if (!sanHistory().length || ruleTerminated()) return;
    if (!isLive()) { goLive(); return; }
    invalidateEngine();
    game.undo();
    // in AI mode take back the engine reply too, so it's the human's turn again
    if (mode === "ai") {
      while (sanHistory().length && game.turn() !== humanColor) game.undo();
    }
    selection = null;
    viewIndex = sanHistory().length;
    syncAutoFlip();
    sync();
    saveGame();
    maybeEngineTurn();
  }

  async function requestNewGame() {
    stopEditor(t("m.55"));
    if (sanHistory().length &&
        !(await confirmNative(t("dlg.newGame"), t("chrome.new"), { ok: t("chrome.new"), cancel: t("act.cancel") }))) {
      return;
    }
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    game.reset();
    selection = null;
    viewIndex = 0;
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    resetClocks();
    syncAutoFlip();
    sync();
    saveGame();
    toast(t("m.07"));
    maybeEngineTurn();
  }

  /** Truncate the game to the replay cursor and continue playing from there. */
  async function retryFromHere() {
    if (isLive()) return;
    const keep = viewIndex;
    const drop = sanHistory().length - keep;
    if (!(await confirmNative(tf("dlg.retryHere", [keep, drop]), t("act.retryHere"),
        { ok: t("act.retryHere"), cancel: t("act.cancel") }))) {
      return;
    }
    const h = sanHistory().slice(0, keep);
    invalidateEngine();
    resetGameToStart();
    for (const san of h) game.move(san);
    selection = null;
    viewIndex = h.length;
    // continuing a finished game (flag / resignation) gets fresh clocks
    if (ruleTerminated()) resetClocks();
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    syncAutoFlip();
    sync();
    saveGame();
    toast(tf("mm.backToMove", [keep]));
    maybeEngineTurn();
  }

  // --- resignation (terminal, like mate; AI games count as a loss) ---
  async function doResign() {
    if (mode === "learn" || !isLive() || !sanHistory().length || naturalGameOver() || ruleTerminated()) return;
    let side;
    if (mode === "ai") {
      side = humanColor;
      if (!(await confirmNative(tf("dlg.resign", [side === "w" ? t("m.04") : t("m.05")]),
        t("act.resign"), { ok: t("act.resign"), cancel: t("act.cancel") }))) return;
    } else {
      // pvp: either player may resign at any time (FIDE) — pick the side
      const pick = await confirmNative(t("dlg.whoResigns"), t("act.resign"),
        { ok: t("dlg.whiteResigns"), alt: t("dlg.blackResigns"), cancel: t("act.cancel") });
      if (!pick) return;
      side = pick === "alt" ? "b" : "w";
    }
    const who = side === "w" ? t("m.04") : t("m.05");
    invalidateEngine();
    resigned = side;
    Audio2.playWin();
    if (mode === "ai") recordResign();
    saveGame();
    sync();
    toast(tf("mm.resignWin", [who, side === "w" ? t("m.05") : t("m.04")]));
  }

  /** Record an AI-game outcome decided by an app-level rule (not by mate). */
  function recordOutcome(result, suffix) {
    const sig = game.pgn() + suffix;
    if (statsRecordedSig === sig) return;
    statsRecordedSig = sig;
    const s = loadStats();
    s.games.push({ t: Date.now(), diff: difficulty, color: humanColor, result, moves: sanHistory().length, sig });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    try { Host.storageSet(STATS_KEY, JSON.stringify(s)); } catch (_) {}
    renderStats();
    checkNewAchievements();
    offerReview(); // resignation and flag-fall end a game just as much as mate
  }

  function recordResign() { recordOutcome("loss", "#resigned"); }

  // --- blunder coach (AI mode): after the engine replies, quietly evaluate
  // the human's last move; a ??-level swing earns a "consider undoing" nudge.
  let coachPending = null; // {before, after, san, len}

  function coachRemember(mv) {
    coachPending = null;
    if (mode !== "ai" || !coachOn || !window.ChessEngine) return;
    const h = sanHistory();
    const g = baseGame();
    for (let i = 0; i < h.length - 1; i++) g.move(h[i]);
    coachPending = { before: g.fen(), after: game.fen(), san: mv.san, len: h.length };
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
    const p = coachPending;
    coachPending = null;
    if (!p || !coachOn || mode !== "ai" || appGameOver()) return;
    if (!coachWorthChecking(p.before, p.after)) return;
    let a = null, b = null;
    try {
      a = await window.ChessEngine.analyze(p.before, 120);
      b = await window.ChessEngine.analyze(p.after, 120);
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
  let drawOfferPending = false;
  async function doOfferDraw() {
    if (mode === "learn" || mode === "puzzle" || !isLive() || !sanHistory().length ||
        appGameOver() || drawOfferPending) return;
    if (mode === "pvp") {
      if (!(await confirmNative(t("dlg.drawBoth"), t("act.offerDraw"),
        { ok: t("dlg.drawAgree"), cancel: t("dlg.drawPlayOn") }))) return;
      acceptDraw();
      return;
    }
    // ai mode: offer on your own turn; the engine accepts unless it is winning
    if (engineThinking || game.turn() !== humanColor) { toast(t("m.32")); return; }
    if (sanHistory().length < 20) { toast(t("m.33")); return; }
    if (!window.ChessEngine) { toast(t("m.01")); return; }
    drawOfferPending = true;
    toast(t("m.34"));
    let e = null;
    const sig = game.fen();
    try { e = await window.ChessEngine.analyze(sig, 300); } catch (_) {}
    drawOfferPending = false;
    if (game.fen() !== sig || appGameOver()) return;
    // e.cp is from the side to move (the human here); engine eval = -cp
    const engineCp = e && e.cp != null ? -e.cp : e && e.mate != null ? (e.mate > 0 ? -10000 : 10000) : null;
    if (engineCp != null && engineCp < 60) {
      acceptDraw();
    } else {
      sync();
      toast(t("m.35"));
    }
  }

  function acceptDraw() {
    invalidateEngine();
    drawAgreed = true;
    Audio2.playDraw();
    if (mode === "ai") recordAgreedDraw();
    saveGame();
    sync();
    toast(t("m.36"));
  }

  function recordAgreedDraw() { recordOutcome("draw", "#drawAgreed"); }

  /** FIDE arts. 9.2/9.3: claim the draw at threefold repetition / 50 moves. */
  function doClaimDraw() {
    if (mode === "learn" || mode === "puzzle" || !isLive() || appGameOver()) return;
    const reason = claimableDrawReason();
    if (!reason) { toast(t("m.37")); return; }
    invalidateEngine();
    drawClaimed = reason;
    Audio2.playDraw();
    if (mode === "ai") recordOutcome("draw", "#claimed");
    saveGame();
    sync();
    toast(reason === "threefold" ? t("m.38") : t("m.39"));
  }

  // --- FEN / PGN I/O ---
  async function copyText(text, okMsg) {
    try { await Host.writeClipboard(text); toast(okMsg); }
    catch (_) { toast(t("m.22")); }
  }

  function gameResultToken() {
    if (game.in_checkmate()) return game.turn() === "w" ? "0-1" : "1-0";
    if (resigned) return resigned === "w" ? "0-1" : "1-0";
    if (drawAgreed || drawClaimed) return "1/2-1/2";
    if (flagFall) {
      if (timeoutIsDraw()) return "1/2-1/2";
      return flagFall === "w" ? "0-1" : "1-0";
    }
    if (naturalGameOver()) return "1/2-1/2"; // stalemate + the auto draw rules
    return "*";
  }

  /** Standard-conforming PGN: Seven Tag Roster + result token appended. */
  function pgnForExport() {
    const DIFF_EN = { beginner: "Beginner", easy: "Easy", normal: "Normal", hard: "Hard", extreme: "Max" };
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    const engineName = "Stockfish 18 (" + (DIFF_EN[difficulty] || difficulty) + ")";
    const white = mode === "ai" ? (humanColor === "w" ? "Player" : engineName) : "Player 1";
    const black = mode === "ai" ? (humanColor === "b" ? "Player" : engineName) : "Player 2";
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
    const tc = parseTc(timeControl);
    tagPairs.push(["TimeControl", tc ? tc.base + (tc.inc ? "+" + tc.inc : "") : "-"]);
    if (result !== "*") {
      tagPairs.push(["Termination", flagFall ? "time forfeit" : "normal"]);
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
    if (!sanHistory().length) { toast(t("m.17")); return; }
    const pgn = pgnForExport();
    const name = pgnFileName();
    if (Host.hasZero()) {
      try {
        const path = await Host.saveFileDialog({ title: t("dlg.exportPgn"), defaultName: name });
        if (path == null) { toast(t("m.09")); return; }
        await Host.writeTextFile(path, pgn);
        await Host.revealPath(path);
        toast(t("m.10") + name);
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
      toast(t("m.10") + name);
    } catch (_) {
      copyText(pgn, t("m.11"));
    }
  }

  /** Modal list picker → index of the chosen entry, or null when cancelled. */
  let pickResolver = null;
  /**
   * One question, asked once, on a genuinely fresh install.
   *
   * Everything the app has for a beginner — the 36-lesson course, the Beginner
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
      mode = "learn";
      startLearn();
    } else {
      // they can play, but "normal" is Elo 1700 — start a rung lower and let
      // the difficulty row (now visible) speak for itself. The engine reads
      // `difficulty` at search time, so setting it here is enough.
      mode = "ai";
      difficulty = "easy";
    }
    setPanelOpen(true);
    saveSettings();
    sync();
    toast(choice === 0 ? t("ob.toLearn") : tf("ob.toPlay", [diffName(difficulty)]));
    if (choice !== 0) maybeEngineTurn();
  }

  function pickFromList(title, items) {
    const modal = document.getElementById("pick-modal");
    const list = document.getElementById("pick-list");
    const titleEl = document.getElementById("pick-title");
    if (!modal || !list) return Promise.resolve(items.length ? 0 : null);
    if (titleEl) titleEl.textContent = title;
    list.innerHTML = "";
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
    modal.classList.add("show");
    return new Promise((resolve) => { pickResolver = resolve; });
  }
  function finishPick(v) {
    const modal = document.getElementById("pick-modal");
    if (modal) modal.classList.remove("show");
    if (pickResolver) { pickResolver(v); pickResolver = null; }
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
    if (!text0) { toast(t("m.12")); return false; }
    // A PGN file may hold a whole database — importing only the last game (the
    // old behaviour) silently threw away everything before it.
    const games = window.ChessPgn ? window.ChessPgn.splitGames(text0) : [text0];
    if (games.length > 1) {
      const items = games.map((g, i) => {
        const s = window.ChessPgn.summary(g);
        return {
          label: (i + 1) + ". " + s.white + " — " + s.black + "  " + s.result,
          sub: [s.event, s.date, s.plies ? tf("mm.plies", [s.plies]) : ""].filter(Boolean).join(" · "),
        };
      });
      const pick = await pickFromList(tf("dlg.pickGame", [games.length]), items);
      if (pick == null) { toast(t("m.14")); return false; }
      text0 = games[pick];
    }
    const ask = prompt || { msg: t("dlg.importPgn"), title: t("dlg.importPgnTitle"), ok: t("dlg.import") };
    if (sanHistory().length &&
        !(await confirmNative(ask.msg, ask.title, { ok: ask.ok, cancel: t("act.cancel") }))) {
      return false;
    }
    const probe = new Chess();
    if (!probe.load_pgn(text0, { sloppy: true }) || !probe.history().length) {
      toast(t("m.13"));
      return false;
    }
    invalidateEngine();
    stopEditor();
    game.load_pgn(text0, { sloppy: true });
    selection = null;
    viewIndex = sanHistory().length;
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    resetClocks();
    syncAutoFlip();
    sync();
    saveGame();
    toast(t("m.62") + moveCount(Math.ceil(sanHistory().length / 2)));
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
      toast(t("m.15"));
    }
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
      } catch (_) {
        toast(t("m.16"));
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
  /** editor runtime: {board, turn, castling, brush} | null */
  let editor = null;

  function editorModel() {
    return {
      position: editor.board,
      flipped,
      selected: null,
      legalTargets: [],
      lastMove: null,
      checkSquare: null,
      hintMove: null,
      stars: [],
      cursor: cursorSquare(),
    };
  }

  function startEditor() {
    const Ed = window.ChessEditor;
    if (!Ed) { toast(t("m.58")); return; }
    invalidateEngine();
    editor = Ed.fromFen(viewGame().fen(), Chess);
    editor.brush = { color: "w", type: "p" };
    selection = null;
    BoardView.cancelAnim();
    renderEditorPalette();
    sync();
    toast(t("m.57"));
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
    if (!editor) return false;
    editor = null;
    if (note) toast(note);
    return true;
  }

  function renderEditorPalette() {
    const el = document.getElementById("editor-palette");
    if (!el || !editor) return;
    el.innerHTML = "";
    for (const [color, type] of PALETTE) {
      const b = document.createElement("button");
      b.type = "button";
      if (!color) {
        b.dataset.erase = "1";
        b.textContent = "✕";
        b.title = t("ed.eraser");
        b.classList.toggle("active", editor.brush.type === "");
      } else {
        b.dataset.color = color;
        b.dataset.type = type;
        b.textContent = PALETTE_GLYPH[color + type];
        b.classList.toggle("active", editor.brush.color === color && editor.brush.type === type);
      }
      el.appendChild(b);
    }
  }

  function editorClick(sq) {
    const Ed = window.ChessEditor;
    const { r, c } = Ed.indexOf(sq);
    const cur = editor.board[r][c];
    if (editor.brush.type === "") {
      editor.board[r][c] = null;
    } else if (cur && cur.color === editor.brush.color && cur.type === editor.brush.type) {
      editor.board[r][c] = null; // tapping the same piece again clears the square
    } else {
      editor.board[r][c] = { type: editor.brush.type, color: editor.brush.color };
    }
    syncEditorUI();
    draw();
  }

  function syncEditorUI() {
    const sec = document.getElementById("sec-editor");
    if (!sec) return;
    sec.hidden = !editor;
    if (!editor) return;
    document.querySelectorAll("#editor-turn button").forEach((b) => {
      b.classList.toggle("active", b.dataset.turn === editor.turn);
    });
    document.querySelectorAll("#editor-castling button").forEach((b) => {
      b.classList.toggle("active", !!editor.castling[b.dataset.cr]);
    });
    const epRow = document.getElementById("row-ed-ep");
    const epSeg = document.getElementById("editor-ep");
    const cands = window.ChessEditor.epCandidates(editor);
    if (epRow) epRow.hidden = !cands.length;
    if (epSeg && cands.length) {
      epSeg.innerHTML = "";
      for (const sqName of [null, ...cands]) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.ep = sqName || "";
        b.textContent = sqName || t("ed.epNone");
        b.classList.toggle("active", (editor.ep || null) === sqName);
        epSeg.appendChild(b);
      }
    }
    if (!cands.length && editor.ep) editor.ep = null;
    const err = document.getElementById("editor-error");
    const reason = window.ChessEditor.validate(editor, Chess);
    if (err) err.textContent = reason ? t(reason) : "";
    const apply = document.getElementById("editor-apply");
    if (apply) apply.disabled = !!reason;
  }

  /** Load `fen` as a fresh game whose history starts from that position. */
  function loadFenAsGame(fen, note) {
    stopEditor();
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    game.load(fen);
    game.header("SetUp", "1", "FEN", fen);
    selection = null;
    viewIndex = 0;
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    analysis = null;
    statsRecordedSig = null;
    resetClocks();
    syncAutoFlip();
    sync();
    saveGame();
    toast(note || t("mm.positionLoaded"));
    maybeEngineTurn();
  }

  function applyEditor() {
    const Ed = window.ChessEditor;
    const reason = Ed.validate(editor, Chess);
    if (reason) { toast(t(reason)); return; }
    const fen = Ed.toFen(editor);
    stopEditor();
    loadFenAsGame(fen, t("m.54"));
  }

  const fenModal = document.getElementById("fen-modal");
  function openFenModal() {
    if (!fenModal) return;
    const input = document.getElementById("fen-input");
    const err = document.getElementById("fen-error");
    if (input) { input.value = viewGame().fen(); input.classList.remove("bad"); }
    if (err) err.textContent = "";
    fenModal.classList.add("show");
    if (input) { input.focus(); input.select(); }
  }
  function closeFenModal() { if (fenModal) fenModal.classList.remove("show"); }

  function submitFen() {
    const input = document.getElementById("fen-input");
    const err = document.getElementById("fen-error");
    const raw = (input && input.value || "").trim();
    const show = (msg) => {
      if (err) err.textContent = msg;
      if (input) input.classList.add("bad");
    };
    if (!raw) { show(t("m.60")); return; }
    const v = new Chess().validate_fen(raw);
    if (!v.valid) { show(v.error || t("m.61")); return; }
    // chess.js accepts positions no game could reach (no kings, a side already
    // in check while its opponent moves) — reuse the editor's stricter rules,
    // then load the ORIGINAL fen so its en-passant square and clocks survive.
    const reason = window.ChessEditor
      ? window.ChessEditor.validate(window.ChessEditor.fromFen(raw, Chess), Chess)
      : null;
    if (reason) { show(t(reason)); return; }
    closeFenModal();
    loadFenAsGame(new Chess(raw).fen(), t("m.53"));
  }

  // --- named save slots -------------------------------------------------
  // The autosave holds exactly one game, so studying a second position meant
  // losing the first. Slots are explicit, user-named storage on top of it.
  const SLOTS_KEY = "chess.v1.slots";
  const SLOT_COUNT = 5;

  function loadSlots() {
    try {
      const s = JSON.parse(Host.storageGet(SLOTS_KEY) || "null");
      if (s && Array.isArray(s.slots)) return s;
    } catch (_) {}
    return { v: 1, slots: new Array(SLOT_COUNT).fill(null) };
  }
  function saveSlots(s) {
    try { Host.storageSet(SLOTS_KEY, JSON.stringify(s)); } catch (_) {}
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
    const P = window.ChessPgn;
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
    list.innerHTML = "";
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
    const m = document.getElementById("slots-modal");
    if (m) m.classList.add("show");
  }
  function closeSlots() {
    const m = document.getElementById("slots-modal");
    if (m) m.classList.remove("show");
  }

  function saveToSlot(i) {
    if (!sanHistory().length) { toast(t("slots.nothing")); return; }
    const st = loadSlots();
    st.slots[i] = {
      pgn: pgnForExport(),
      savedAt: Date.now(),
      mode,
      diff: difficulty,
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
    sideTab = want;
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
    try { Host.storageSet(PANEL_KEY, want ? "1" : "0"); } catch (_) {}
    const side = document.getElementById("side");
    if (side) {
      if (want) { side.removeAttribute("inert"); side.setAttribute("aria-hidden", "false"); }
      else {
        side.setAttribute("inert", "");
        side.setAttribute("aria-hidden", "true");
        if (side.contains(document.activeElement) && document.activeElement.blur) document.activeElement.blur();
      }
    }
    requestAnimationFrame(() => { BoardView.resizeCanvas(); draw(); });
  }
  function togglePanel() { setPanelOpen(!isPanelOpen()); }

  /** Re-render every translated label; dynamic text comes back via sync(). */
  function applyLanguage() {
    if (!I18n) return;
    I18n.apply(document);
    document.documentElement.setAttribute("lang", langId);
    const seg = document.getElementById("lang-seg");
    if (seg) {
      seg.innerHTML = "";
      for (const l of I18n.available()) {
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.lang = l.id;
        b.textContent = l.name;
        b.classList.toggle("active", l.id === langId);
        seg.appendChild(b);
      }
    }
    // sync() redraws the board and panels, but the stats and achievement
    // sections render on their own schedule — without these they keep the
    // previous language until the next game finishes
    renderStats();
    renderAchievements();
    if (editor) renderEditorPalette();
    sync();
  }

  function applyTheme(id) {
    themeId = id;
    document.documentElement.setAttribute("data-theme", id);
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
    if (editor) return true; // every square is paintable
    if (mode === "learn") {
      if (!learn || learn.done || learn.demoing) return false;
      const task = curTask();
      if (task.type === "tap") return false;
      const p = learn.g.get(sq);
      return !!p && p.color === "w" && learn.g.turn() === "w" && (!task.only || p.type === task.only);
    }
    if (mode === "puzzle") {
      if (!puzzle || puzzle.done) return false;
      const p = puzzle.g.get(sq);
      return !!p && p.color === "w" && puzzle.g.turn() === "w";
    }
    if (!isLive() || appGameOver()) return false;
    if (mode === "ai" && game.turn() !== humanColor) return false;
    const p = game.get(sq);
    return !!p && p.color === game.turn();
  }

  let dragging = null; // {from} armed on pressing one of our selectable pieces
  /** editor paint stroke: the square last painted while the pointer is down */
  let painting = null;

  // right-click clears a square in the editor (no need to switch to the eraser)
  canvas.addEventListener("contextmenu", (ev) => {
    if (!editor) return;
    ev.preventDefault();
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    if (!sq) return;
    const { r, c } = window.ChessEditor.indexOf(sq);
    editor.board[r][c] = null;
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
    if (editor) { painting = sq; return; }
    dragging = selection && selection.sq === sq ? { from: sq } : null;
    if (dragging) canvas.style.cursor = "grabbing";
  });
  canvas.addEventListener("pointermove", (ev) => {
    const p = canvasPoint(ev);
    if (painting) {
      const sq = BoardView.cellAt(p.x, p.y);
      if (sq && sq !== painting) { painting = sq; editorClick(sq); }
      return;
    }
    if (!dragging) {
      const sq = BoardView.cellAt(p.x, p.y);
      canvas.style.cursor = sq && grabbableAt(sq) ? "grab" : "default";
      return;
    }
    BoardView.setDrag({ from: dragging.from, x: p.x, y: p.y });
    draw();
  });
  canvas.addEventListener("pointerup", (ev) => {
    painting = null;
    const wasDrag = dragging;
    dragging = null;
    BoardView.setDrag(null);
    canvas.style.cursor = "default";
    if (!wasDrag) return;
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    draw();
    if (sq && sq !== wasDrag.from) onSquareClick(sq); // drop = play/reselect
  });
  canvas.addEventListener("pointercancel", () => {
    painting = null;
    dragging = null;
    BoardView.setDrag(null);
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
    const g = editor ? null : (mode === "learn" && learn ? learn.g : mode === "puzzle" && puzzle ? puzzle.g : viewGame());
    let piece = null;
    if (g) piece = g.get(sq);
    else if (editor) {
      const { r, c } = window.ChessEditor.indexOf(sq);
      piece = editor.board[r][c];
    }
    if (!piece) return sq + " · " + t("live.empty");
    return sq + " · " + t(piece.color === "w" ? "vs.white" : "vs.black") + t("piece." + piece.type);
  }

  function moveCursor(df, dr) {
    if (!keyboardCursor) keyboardCursor = flipped ? "e5" : "e4";
    let f = FILE_CHARS.indexOf(keyboardCursor[0]);
    let r = Number(keyboardCursor[1]);
    // arrows follow what the player sees, so they invert with the board
    const sign = flipped ? -1 : 1;
    f = Math.max(0, Math.min(7, f + df * sign));
    r = Math.max(1, Math.min(8, r + dr * sign));
    keyboardCursor = FILE_CHARS[f] + r;
    announce(describeSquare(keyboardCursor));
    draw();
  }

  canvas.addEventListener("focus", () => {
    boardFocused = true;
    if (!keyboardCursor) keyboardCursor = flipped ? "e5" : "e4";
    announce(t("live.focused") + " · " + describeSquare(keyboardCursor));
    draw();
  });
  canvas.addEventListener("blur", () => { boardFocused = false; draw(); });

  canvas.addEventListener("keydown", (ev) => {
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
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
      case "Home": ev.preventDefault(); keyboardCursor = flipped ? "h1" : "a8"; announce(describeSquare(keyboardCursor)); draw(); return;
      case "End": ev.preventDefault(); keyboardCursor = flipped ? "a8" : "h1"; announce(describeSquare(keyboardCursor)); draw(); return;
      case "Enter":
      case " ": {
        ev.preventDefault();
        if (!keyboardCursor) return;
        const before = selection ? selection.sq : null;
        onSquareClick(keyboardCursor);
        if (selection && selection.sq === keyboardCursor && before !== keyboardCursor) {
          announce(t("live.selected") + " " + describeSquare(keyboardCursor) + " · " + selection.targets.length + " " + t("live.targets"));
        } else if (!selection && before) {
          announce(statusText());
        }
        return;
      }
      case "Escape":
        if (selection) { ev.preventDefault(); selection = null; announce(t("live.cleared")); draw(); }
        return;
      default:
    }
  });
  canvas.style.touchAction = "none"; // let touch drags move pieces, not the page

  document.getElementById("undo").onclick = undo;
  document.getElementById("btn-hint").onclick = () => { requestHint(); };
  document.getElementById("btn-new").onclick = () => { requestNewGame(); };
  document.getElementById("btn-flip").onclick = () => {
    flipped = !flipped;
    saveSettings();
    draw();
    toast(flipped ? t("m.44") : t("m.45"));
  };
  document.getElementById("toggle-panel").onclick = togglePanel;
  document.getElementById("collapse").onclick = () => setPanelOpen(false);
  const tabRow = document.querySelector(".side-tabs");
  if (tabRow) {
    tabRow.onclick = (ev) => {
      const b = ev.target.closest("button[data-tab]");
      if (b) setSideTab(b.dataset.tab, { top: true });
    };
    // ARIA tablist keyboard contract: arrows move between tabs
    tabRow.onkeydown = (ev) => {
      if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
      const cur = TABS.indexOf(sideTab);
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
  document.getElementById("rep-prev").onclick = () => setViewIndex(viewIndex - 1);
  document.getElementById("rep-next").onclick = () => setViewIndex(viewIndex + 1);
  document.getElementById("rep-end").onclick = () => setViewIndex(sanHistory().length);
  document.getElementById("rep-live").onclick = () => { goLive(); toast(t("m.08")); };

  document.getElementById("an-run").onclick = () => {
    if (analyzing) {
      analyzeAbort = true;
      if (window.ChessEngine) window.ChessEngine.cancel();
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
    try { Host.storageRemove(STATS_KEY); } catch (_) {}
    renderStats();
    renderAchievements();
    toast(t("m.23"));
  };

  document.getElementById("fen-copy").onclick = () => copyText(viewGame().fen(), t("m.20"));
  document.getElementById("pgn-copy").onclick = () => {
    if (!sanHistory().length) { toast(t("m.18")); return; }
    copyText(pgnForExport(), t("m.21"));
  };
  const resignEl = document.getElementById("btn-resign");
  if (resignEl) resignEl.onclick = () => { doResign(); };
  const drawEl = document.getElementById("btn-offerdraw");
  if (drawEl) drawEl.onclick = () => { doOfferDraw(); };
  const claimEl = document.getElementById("btn-claimdraw");
  if (claimEl) claimEl.onclick = () => { doClaimDraw(); };
  document.getElementById("pgn-download").onclick = () => { downloadPgn(); };
  document.getElementById("pgn-paste").onclick = () => { pastePgn(); };
  document.getElementById("pgn-open").onclick = () => { openPgnFile(); };

  // Drop a .pgn onto the window to import it — host bridge in the packaged
  // app, DataTransfer in browsers.
  Host.onDropFiles(async (payload) => {
    const paths = Host.normalizePaths(payload && payload.paths ? payload.paths : payload);
    const p = paths.find((x) => /\.(pgn|txt)$/i.test(x)) || paths[0];
    if (!p) return;
    try { importPgnText(await Host.readTextFile(p), p); }
    catch (_) { toast(t("m.16")); }
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
  Host.onAppLifecycle({ deactivate: () => saveGame() });

  document.getElementById("theme-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-theme]");
    if (b) {
      applyTheme(b.dataset.theme);
      toast(t("m.67") + t("themeName." + themeId));
    }
  };
  document.getElementById("mode-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === mode) return;
    invalidateEngine();
    stopEditor(t("m.55"));
    const wasLearn = mode === "learn";
    const wasPuzzle = mode === "puzzle";
    mode = b.dataset.mode;
    // entering a clocked mode mid-game gets fresh clocks
    flagFall = null;
    if (mode === "pvp" || mode === "ai") resetClocks();
    if (mode === "learn") startLearn();
    else if (wasLearn) stopLearn();
    if (mode === "puzzle") startPuzzles();
    else if (wasPuzzle) stopPuzzles();
    // the mode decides what the play tab holds, so show it — otherwise
    // switching to 教学 from the settings tab looks like nothing happened
    setSideTab("play", { top: true });
    saveSettings();
    selection = null;
    syncAutoFlip();
    sync();
    toast(mode === "ai" ? t("m.64") + (DIFF_NAMES[difficulty] || "") :
      mode === "pvp" ? t("m.65") :
      mode === "learn" ? t("mm.learnMode") : t("mm.puzzleMode"));
    maybeEngineTurn();
  };
  document.getElementById("lesson-restart").onclick = () => {
    if (learn) { startLearnTask(); toast(t("lm.restarted")); }
  };
  document.getElementById("lesson-demo").onclick = () => {
    if (!learn || learn.demoing) return;
    const task = curTask();
    if (!task.solution || (task.type !== "stars" && task.type !== "move")) { toast(t("lm.noDemo")); return; }
    learn.wantDemo = true;
    startLearnTask();
  };
  document.getElementById("learn-reset").onclick = async () => {
    if (!(await confirmNative(t("dlg.resetLearn"), t("dlg.resetLearnTitle"),
      { ok: t("act.reset"), cancel: t("act.cancel") }))) return;
    learnState = { v: 1, done: {}, last: 0 };
    saveLearnState();
    if (learn) startLesson(0);
    toast(t("lm.progressReset"));
  };
  document.getElementById("lesson-next").onclick = () => {
    if (!learn) return;
    if (learn.li + 1 < LESSONS.length) { startLesson(learn.li + 1); return; }
    // graduation: straight into a beginner AI game
    difficulty = "beginner";
    mode = "ai";
    stopLearn();
    saveSettings();
    selection = null;
    sync();
    toast(t("lm.firstGame"));
    maybeEngineTurn();
  };
  document.getElementById("lesson-list").onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b && learn) startLesson(Number(b.dataset.i));
  };
  document.getElementById("puzzle-cat-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-cat]");
    // `puzzle` is null whenever the tier filter empties the current category —
    // exactly the moment the user needs these tabs to change category, so this
    // must not bail out on a missing puzzle
    if (!b || (puzzle && b.dataset.cat === puzzle.cat)) return;
    if (b.dataset.cat === "review" && !puzzlesInCat("review").length) {
      toast(t("pz.noMissed"));
      return;
    }
    puzzleState.cat = b.dataset.cat;
    savePuzzleState();
    startPuzzles();
  };
  document.getElementById("puzzle-tier-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-tier]");
    if (!b || b.dataset.tier === puzzleTierFilter) return;
    puzzleTierFilter = b.dataset.tier;
    saveSettings();
    startPuzzles();
  };
  document.getElementById("puzzle-retry").onclick = () => {
    if (puzzle) { startPuzzleAt(puzzle.cat, puzzle.idx); toast(t("pz.restarted")); }
  };
  document.getElementById("puzzle-answer").onclick = () => { showPuzzleAnswer(); };
  document.getElementById("puzzle-next").onclick = () => { nextPuzzle(); };
  const playOnEl = document.getElementById("puzzle-playon");
  if (playOnEl) playOnEl.onclick = () => { playOnFromPuzzle(); };
  document.getElementById("puzzle-list").onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b && puzzle) startPuzzleAt(puzzle.cat, Number(b.dataset.i));
  };
  document.getElementById("clock-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-tc]");
    if (!b || b.dataset.tc === timeControl) return;
    timeControl = b.dataset.tc;
    resetClocks();
    saveSettings();
    saveGame();
    sync();
    const tcSet = parseTc(timeControl);
    toast(!tcSet ? t("m.46") :
      tf("mm.clockSet", [tcSet.base / 60]) + (tcSet.inc ? tf("mm.clockInc", [tcSet.inc]) : ""));
  };
  document.getElementById("diff-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-diff]");
    if (!b || b.dataset.diff === difficulty) return;
    difficulty = b.dataset.diff;
    saveSettings();
    sync();
    toast(t("m.66") + (DIFF_NAMES[difficulty] || difficulty));
  };
  document.getElementById("color-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-color]");
    if (!b || b.dataset.color === humanColor) return;
    invalidateEngine();
    humanColor = b.dataset.color;
    flipped = humanColor === "b";
    saveSettings();
    sync();
    toast(humanColor === "w" ? t("m.68") : t("m.69"));
    maybeEngineTurn();
  };
  const langSeg = document.getElementById("lang-seg");
  if (langSeg) {
    langSeg.onclick = (ev) => {
      const b = ev.target.closest("button[data-lang]");
      if (!b || !I18n || b.dataset.lang === langId) return;
      langId = I18n.setLang(b.dataset.lang);
      saveSettings();
      applyLanguage();
      toast(t("mm.langSwitched"));
    };
  }
  document.getElementById("opt-coach").onclick = () => {
    coachOn = !coachOn;
    saveSettings();
    syncSettingsUI();
    toast(coachOn ? t("m.49") : t("m.50"));
  };
  document.getElementById("opt-autoflip").onclick = () => {
    autoFlipPvp = !autoFlipPvp;
    if (syncAutoFlip()) draw();
    saveSettings();
    syncSettingsUI();
    toast(autoFlipPvp ? t("m.51") : t("m.52"));
  };
  document.getElementById("opt-sound").onclick = () => {
    soundOn = !soundOn;
    saveSettings();
    syncSettingsUI();
    if (soundOn) Audio2.playMove("w");
    toast(soundOn ? t("m.47") : t("m.48"));
  };
  document.getElementById("clear-save").onclick = async () => {
    if (!(await confirmNative(t("dlg.clearSave"), t("act.clearSave"),
      { ok: t("dlg.clear"), cancel: t("act.cancel") }))) return;
    try { Host.storageRemove(SAVE_KEY); } catch (_) {}
    stopEditor();
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    game.reset();
    selection = null;
    viewIndex = 0;
    resigned = null;
    drawAgreed = false;
    drawClaimed = null;
    resetClocks();
    syncAutoFlip();
    sync();
    toast(t("m.24"));
    maybeEngineTurn();
  };

  // --- editor + FEN wiring ---
  document.getElementById("editor-open").onclick = () => {
    if (mode === "learn" || mode === "puzzle") { toast(t("m.59")); return; }
    startEditor();
  };
  document.getElementById("fen-load-open").onclick = () => {
    if (mode === "learn" || mode === "puzzle") { toast(t("m.59")); return; }
    openFenModal();
  };
  document.getElementById("editor-palette").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b || !editor) return;
    editor.brush = b.dataset.erase ? { color: "", type: "" }
      : { color: b.dataset.color, type: b.dataset.type };
    renderEditorPalette();
  };
  document.getElementById("editor-turn").onclick = (ev) => {
    const b = ev.target.closest("button[data-turn]");
    if (!b || !editor) return;
    editor.turn = b.dataset.turn;
    syncEditorUI();
  };
  document.getElementById("editor-ep").onclick = (ev) => {
    const b = ev.target.closest("button[data-ep]");
    if (!b || !editor) return;
    editor.ep = b.dataset.ep || null;
    syncEditorUI();
  };
  document.getElementById("editor-castling").onclick = (ev) => {
    const b = ev.target.closest("button[data-cr]");
    if (!b || !editor) return;
    editor.castling[b.dataset.cr] = !editor.castling[b.dataset.cr];
    syncEditorUI();
  };
  document.getElementById("editor-clear").onclick = () => {
    if (!editor) return;
    editor.board = window.ChessEditor.emptyBoard();
    editor.castling = { K: false, Q: false, k: false, q: false };
    syncEditorUI();
    draw();
  };
  document.getElementById("editor-reset").onclick = () => {
    if (!editor) return;
    editor = Object.assign(
      window.ChessEditor.fromFen(new Chess().fen(), Chess),
      { brush: editor.brush }
    );
    syncEditorUI();
    draw();
  };
  document.getElementById("editor-cancel").onclick = () => {
    stopEditor();
    sync();
    toast(t("m.56"));
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
      } catch (_) { toast(t("m.15")); }
    };
    document.getElementById("fen-input").addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); submitFen(); }
      ev.stopPropagation(); // typing a FEN must not trigger board shortcuts
    });
    fenModal.onclick = (ev) => { if (ev.target === fenModal) closeFenModal(); };
  }

  const slotsModal = document.getElementById("slots-modal");
  if (slotsModal) {
    document.getElementById("slots-open").onclick = () => {
      if (mode === "learn" || mode === "puzzle") { toast(t("m.59")); return; }
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
    const onHistClick = (ev) => {
      const b = ev.target.closest("button");
      if (!b) return;
      if (b.dataset.histPgn != null) {
        const rec = histCache[Number(b.dataset.histPgn)];
        if (rec) copyText(historyPgn(rec), t("hist.pgnCopied"));
      } else if (b.dataset.hist != null) {
        if (mode === "learn" || mode === "puzzle") { toast(t("m.59")); return; }
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

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (promoModal && promoModal.classList.contains("show")) { finishPromotion(null); return; }
      if (slotsModal && slotsModal.classList.contains("show")) { closeSlots(); return; }
      if (histModal && histModal.classList.contains("show")) { closeHistory(); return; }
      if (pickModal && pickModal.classList.contains("show")) { finishPick(null); return; }
      if (fenModal && fenModal.classList.contains("show")) { closeFenModal(); return; }
      if (confirmModal.classList.contains("show")) { finishConfirm(false); return; }
      // before closing the panel — the panel holds the editor's only exit
      if (editor) { stopEditor(t("m.55")); sync(); return; }
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
    const k = ev.key.toLowerCase();
    if (ev.key === "Tab") { ev.preventDefault(); togglePanel(); return; }
    if (mode === "learn") {
      // replay / game shortcuts act on the main game — inert during lessons;
      // R retries the task, Z/H work in engine drills
      if (!learn || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { startLearnTask(); toast(t("lm.restarted")); }
      else if (k === "z") learnUndo();
      else if (k === "h") learnHint();
      return;
    }
    if (mode === "puzzle") {
      if (!puzzle || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { startPuzzleAt(puzzle.cat, puzzle.idx); toast(t("pz.restarted")); }
      else if (k === "n") nextPuzzle();
      else if (k === "h") showPuzzleAnswer();
      return;
    }
    if (ev.key === "ArrowLeft") { ev.preventDefault(); setViewIndex(viewIndex - 1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); setViewIndex(viewIndex + 1); }
    else if (ev.key === "Home") { ev.preventDefault(); setViewIndex(0); }
    else if (ev.key === "End") { ev.preventDefault(); setViewIndex(sanHistory().length); }
    else if (k === "z" && !ev.metaKey && !ev.ctrlKey) undo();
    else if (k === "n" && !ev.metaKey && !ev.ctrlKey) requestNewGame();
    else if (k === "h" && !ev.metaKey && !ev.ctrlKey) requestHint();
    else if (k === "f" && !ev.metaKey && !ev.ctrlKey) {
      flipped = !flipped; saveSettings(); draw();
    }
  });

  window.addEventListener("resize", () => {
    appEl.classList.toggle("scrim-on", isPanelOpen() && window.innerWidth < 900);
    BoardView.resizeCanvas();
    draw();
    drawEvalCurve();
  });
  // The panel toggle animates #board-wrap over 280ms; a one-shot resize at
  // toggle time samples a mid-transition rect and leaves the backing store
  // mismatched with the CSS size (whole board rendered scaled = blurry).
  // Track the canvas size continuously instead.
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(() => { BoardView.resizeCanvas(); draw(); }).observe(canvas);
  } else {
    document.getElementById("board-wrap").addEventListener("transitionend", (ev) => {
      if (ev.propertyName === "width" || ev.propertyName === "height") {
        BoardView.resizeCanvas();
        draw();
      }
    });
  }
  window.addEventListener("beforeunload", () => saveGame());
  window.addEventListener("pagehide", () => saveGame());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
  });

  // --- boot ---
  // "Have we been here before?" — asked before loadSettings writes anything,
  // because the very first thing a new player saw was a 1700-rated Stockfish
  // (mode "ai" + difficulty "normal" are the code defaults) with nothing at all
  // pointing at the 36-lesson course or the Beginner tier built for them.
  const firstRun = !Host.storageGet(SETTINGS_KEY) && !Host.storageGet(SAVE_KEY) &&
    !Host.storageGet(LEARN_KEY) && !Host.storageGet(PUZZLE_KEY);
  // and on a first run, start in the system language rather than always Chinese
  if (firstRun && I18n && I18n.detectLang) langId = I18n.setLang(I18n.detectLang());
  loadSettings();
  document.documentElement.setAttribute("data-theme", themeId);
  if (I18n) { I18n.setLang(langId); I18n.apply(document); }
  const savedPanel = Host.storageGet(PANEL_KEY);
  setPanelOpen(savedPanel === "1");
  setSideTab(sideTab);
  const resumed = tryLoadSave();
  if (resumed) toast(t("m.25"));
  // a resumed finished game must not be re-counted on the next live move
  if (resumed && naturalGameOver()) statsRecordedSig = game.pgn();
  if (resumed && resigned) statsRecordedSig = game.pgn() + "#resigned";
  if (resumed && drawAgreed) statsRecordedSig = game.pgn() + "#drawAgreed";
  if (resumed && drawClaimed) statsRecordedSig = game.pgn() + "#claimed";
  // clock preset chosen but no saved clock state → fresh clocks
  if (timeControl !== "off" && !clock) resetClocks();
  syncAutoFlip(); // a resumed pvp game must face whoever is on move
  if (mode === "learn") startLearn();
  if (mode === "puzzle") startPuzzles();
  BoardView.resizeCanvas();
  renderStats();
  renderAchievements();
  applyLanguage();
  sync();
  saveSettings();
  if (!resumed) saveGame();
  if (mode === "ai" && window.ChessEngine) {
    window.ChessEngine.init().catch(() => toast(t("mm.engineInitFailed")));
    maybeEngineTurn(); // resumed save may leave the engine on move
  }
  if (firstRun) runOnboarding();

})();
