(function () {

  const Host = window.ChessHost;
  const BoardView = window.ChessBoardView;
  const Audio2 = window.ChessAudio;

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
  let analyzeProgress = "";
  /** pgn of the last game recorded into stats (double-count guard) */
  let statsRecordedSig = null;
  /** engine hint arrow {from,to}; cleared whenever the game mutates */
  let hintMove = null;
  let hintPending = false;
  /** two-player clock preset: 'off' | minutes as string */
  let timeControl = "off";
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

  BoardView.attach(canvas, () => {
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
  function confirmNative(message, title, buttons) {
    const okLabel = (buttons && buttons.ok) || "确定";
    const cancelLabel = (buttons && buttons.cancel) || "取消";
    const modal = document.getElementById("confirm-modal");
    const titleEl = document.getElementById("confirm-title");
    const msgEl = document.getElementById("confirm-message");
    const okBtn = document.getElementById("confirm-ok");
    const cancelBtn = document.getElementById("confirm-cancel");
    if (!modal || !okBtn || !cancelBtn) {
      try { return Promise.resolve(!!window.confirm(message)); }
      catch (_) { return Promise.resolve(true); }
    }
    if (titleEl) titleEl.textContent = title || "确认";
    if (msgEl) msgEl.textContent = message;
    okBtn.textContent = okLabel;
    cancelBtn.textContent = cancelLabel;
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
      if (["easy", "normal", "hard", "extreme"].includes(s.difficulty)) difficulty = s.difficulty;
      if (["w", "b"].includes(s.humanColor)) humanColor = s.humanColor;
      if (["off", "3", "5", "10"].includes(s.timeControl)) timeControl = s.timeControl;
    } catch (_) {}
  }
  function saveSettings() {
    try {
      Host.storageSet(SETTINGS_KEY, JSON.stringify({ soundOn, flipped, themeId, mode, difficulty, humanColor, timeControl }));
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
      if (s.clock && ["3", "5", "10"].includes(s.clock.tc) &&
          typeof s.clock.w === "number" && typeof s.clock.b === "number") {
        timeControl = s.clock.tc;
        clock = { w: Math.max(0, s.clock.w), b: Math.max(0, s.clock.b) };
        flagFall = s.clock.flag === "w" || s.clock.flag === "b" ? s.clock.flag : null;
      }
      if (s.resigned === "w" || s.resigned === "b") resigned = s.resigned;
      if (s.drawAgreed === true) drawAgreed = true;
      return sanHistory().length > 0;
    } catch (_) {
      return false;
    }
  }

  // --- engine (AI mode) ---
  const DIFF_NAMES = { easy: "入门", normal: "进阶", hard: "困难", extreme: "极限" };

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
    if (game.game_over() || ruleTerminated() || game.turn() === humanColor) return;
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
    if (!mv) { sync(); toast("引擎未能走子"); return; }
    const played = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    if (played) {
      viewIndex = sanHistory().length;
      selection = null;
      hintMove = null;
      Audio2.playMove(played.color, { captured: !!played.captured, check: game.in_check() });
      if (game.in_checkmate()) Audio2.playWin();
      else if (game.game_over()) Audio2.playDraw();
      saveGame();
      recordGameIfOver();
    }
    sync();
  }

  // --- engine hint: full-strength best move drawn as an arrow ---

  async function requestHint() {
    if (mode === "learn") { learnHint(); return; }
    if (mode === "puzzle") { showPuzzleAnswer(); return; }
    if (!window.ChessEngine) { toast("引擎不可用"); return; }
    if (!isLive()) { toast("请先回到最新一着"); return; }
    if (game.game_over() || ruleTerminated()) return;
    if (mode === "ai" && (engineThinking || game.turn() !== humanColor)) return;
    if (hintPending || analyzing) return;
    const sig = game.fen();
    hintPending = true;
    sync();
    let e = null;
    try { e = await window.ChessEngine.analyze(sig, 400); } catch (_) {}
    hintPending = false;
    if (!isLive() || game.fen() !== sig) { sync(); return; }
    if (!e || !e.best) { sync(); toast("引擎未能给出提示"); return; }
    const from = e.best.slice(0, 2);
    const to = e.best.slice(2, 4);
    const vmv = game.moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    hintMove = { from, to };
    sync();
    toast("提示 · " + (vmv ? vmv.san : from + " → " + to));
  }

  // --- two-player clock (basic: no increment; flag fall is terminal) ---
  const TC_MINUTES = { "3": 3, "5": 5, "10": 10 };

  function resetClocks() {
    const min = TC_MINUTES[timeControl];
    clock = min ? { w: min * 60000, b: min * 60000 } : null;
    flagFall = null;
    syncClockTimer();
    renderClocks();
  }

  /** Ticking starts at the first move so nobody drains on the start screen. */
  function clockRunning() {
    return (mode === "pvp" || mode === "ai") && !!clock &&
      !ruleTerminated() && !game.game_over() && sanHistory().length >= 1;
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
      const who = side === "w" ? "白方" : "黑方";
      toast(isDraw ? who + "超时 · 对方无子力将杀,和棋" :
        who + "超时 · " + (side === "w" ? "黑方" : "白方") + "胜");
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
      map.set(seq, eco + " · " + name);
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
    const name = mode === "learn" || mode === "puzzle" ? null : openingFor(viewIndex);
    el.hidden = !name;
    el.textContent = name || "";
  }

  // --- learn mode: zero-basis interactive lessons (data in lessons.js) ---
  const LEARN_KEY = "chess.v1.learn";
  const LESSONS = window.CHESS_LESSONS || [];

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
    const t = curTask();
    learn.token++;
    learn.g = new Chess(t.fen);
    learn.stars = new Set(t.stars || []);
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
    if (learn.wantDemo && t.solution && (t.type === "stars" || t.type === "move")) {
      learn.wantDemo = false;
      runLessonDemo();
      return;
    }
    sync();
  }

  /** Auto-play the task's solution as a watch-first demo; any board click skips. */
  function runLessonDemo() {
    const t = curTask();
    const sol = t.solution;
    learn.demoing = true;
    const token = learn.token;
    let i = 0;
    toast("先看一遍演示 —— 点击棋盘可跳过");
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
      if (t.type === "stars") {
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
    const t = curTask();
    learn.demoing = false;
    learn.g = new Chess(t.fen);
    learn.stars = new Set(t.stars || []);
    learn.last = null;
    selection = null;
    sync();
    toast("到你了!");
  }

  function skipLessonDemo() {
    learn.token++; // kill the pending demo timers
    endLessonDemo();
  }

  function learnModel() {
    const g = learn.g;
    const t = curTask();
    let stars = Array.from(learn.stars);
    // stuck-help: after repeated misses, highlight the tap answer with stars
    if (learn.helpOn && t.type === "tap" && learn.tapStep < t.steps.length) {
      stars = t.steps[learn.tapStep].squares;
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
    };
  }

  /** Two misses on the same task → show the answer (stars for taps, arrow for moves). */
  function learnRegisterMiss() {
    learn.misses++;
    if (learn.misses < 2 || learn.helpOn) return;
    learn.helpOn = true;
    const t = curTask();
    if (t.type === "move" && t.solution && t.solution.length) {
      try {
        const probe = new Chess(t.fen);
        const mv = probe.move(t.solution[0]);
        if (mv) learn.helpArrow = { from: mv.from, to: mv.to };
      } catch (_) {}
    }
    toast("已为你标出答案");
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
    const t = curTask();
    if (learn.demoing) return "👀 演示中 —— 点击棋盘跳过,看完就轮到你";
    if (learn.done) return "✅ 完成!" + (learn.li + 1 < LESSONS.length ? "点「下一课」继续" : "全部课程完成!");
    if (t.type === "tap") return t.steps[learn.tapStep].tip + "(" + (learn.tapStep + 1) + "/" + t.steps.length + ")";
    if (t.type === "drill" && learn.engineBusy) return "陪练思考中…";
    return t.prompt;
  }

  function learnClick(sq) {
    if (!learn || learn.done) return;
    if (learn.demoing) { skipLessonDemo(); return; }
    const t = curTask();
    if (t.type === "tap") {
      if (t.steps[learn.tapStep].squares.includes(sq)) {
        learn.tapStep++;
        learn.helpOn = false;
        learn.misses = 0;
        Audio2.playStar();
        learnFlash(sq);
        if (learn.tapStep >= t.steps.length) learnTaskDone();
        else sync();
      } else {
        toast("不是这格 —— " + t.steps[learn.tapStep].tip);
        learnRegisterMiss();
      }
      return;
    }
    if (t.type === "drill" && learn.engineBusy) return;
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
    if (piece && piece.color === "w" && g.turn() === "w" && (!t.only || piece.type === t.only)) {
      const targets = g.moves({ square: sq, verbose: true }).map((m) => m.to);
      selection = targets.length ? { sq, targets } : null;
      draw();
      return;
    }
    if (t.only && piece && piece.color === "w" && piece.type !== t.only) {
      toast("这一课请只用" + (PIECE_NAMES[t.only] || "指定棋子"));
      return;
    }
    if (selection) { selection = null; draw(); }
  }

  const PIECE_NAMES = { p: "兵", n: "马", b: "象", r: "车", q: "后", k: "王" };

  function learnRetryTask(msg) {
    toast(msg);
    const token = learn.token;
    setTimeout(() => { if (learn && learn.token === token) startLearnTask(); }, 1400);
  }

  function learnMove(from, to, promotion) {
    const t = curTask();
    const g = learn.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    selection = null;
    learn.last = { from: mv.from, to: mv.to };
    learn.helpArrow = null;
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: g.in_check() });
    if (t.type === "stars") {
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
    if (t.type === "move") {
      const okByGoal =
        t.goal === "any" ? true :
        t.goal === "check" ? g.in_check() :
        t.goal === "mate" ? g.in_checkmate() :
        t.goal === "castle-k" ? mv.flags.includes("k") :
        t.goal === "castle-q" ? mv.flags.includes("q") :
        t.goal === "ep" ? mv.flags.includes("e") :
        t.goal === "promote" ? !!mv.promotion :
        t.goal === "capture" ? (mv.to === t.target && !!mv.captured) :
        t.goal === "one-of" ? (Array.isArray(t.accept) && t.accept.includes(mv.san)) :
        // safe: the moved piece cannot be captured by any reply
        t.goal === "safe" ? !g.moves({ verbose: true }).some((m) => m.to === mv.to) :
        t.goal === "draw-insufficient" ? g.insufficient_material() : false;
      if (okByGoal) {
        if (mv.promotion) toast("已升变为" + (PROMO_NAMES[mv.promotion] || "后"));
        learnTaskDone();
        return;
      }
      if (t.failOnStalemate && g.in_stalemate()) {
        sync();
        learnRetryTask("逼和了!黑王没被将军又无路可走,判和 —— 重来");
        return;
      }
      g.undo();
      learn.last = null;
      toast(t.retry || "没达成目标,再试试");
      learnRegisterMiss();
      sync();
      return;
    }
    if (t.type === "drill") {
      if (t.winOn === "promote" && mv.promotion) {
        toast("升变成功!K+Q 收官你早就会了");
        learnTaskDone();
        return;
      }
      sync();
      if (g.in_checkmate()) { learnTaskDone(); return; }
      if (g.game_over()) {
        learnRetryTask(g.in_stalemate() ? "逼和了 —— 和棋,重来" : "和棋了 —— 重来");
        return;
      }
      learnEngineReply();
    }
  }

  /** White still has winning material for this drill (health check). */
  function learnHasHeavy(g) {
    for (const row of g.board()) for (const p of row) {
      if (p && p.color === "w" && (p.type === "q" || p.type === "r" || p.type === "p")) return true;
    }
    return false;
  }

  async function learnEngineReply() {
    if (!window.ChessEngine) { toast("引擎不可用,无法陪练"); return; }
    const g = learn.g;
    const token = learn.token;
    learn.engineBusy = true;
    sync();
    let mv = null;
    try { mv = await window.ChessEngine.bestMove(g.fen(), "normal"); } catch (_) {}
    if (!learn || token !== learn.token) return;
    learn.engineBusy = false;
    if (mv) {
      const played = g.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
      if (played) {
        learn.last = { from: played.from, to: played.to };
        Audio2.playMove(played.color, { captured: !!played.captured, check: g.in_check() });
      }
    }
    if (g.game_over() && !g.in_checkmate()) {
      sync();
      learnRetryTask(g.in_stalemate() ? "逼和了 —— 和棋,重来" : "和棋了 —— 重来");
      return;
    }
    if (!learnHasHeavy(g)) {
      sync();
      learnRetryTask("大子丢了,无法将杀 —— 重来");
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
    if (!window.ChessEngine) { toast("引擎不可用"); return; }
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
    if (!e || !e.best) { sync(); toast("引擎未能给出提示"); return; }
    learn.helpArrow = { from: e.best.slice(0, 2), to: e.best.slice(2, 4) };
    sync();
  }

  function learnTaskDone() {
    const L = curLesson();
    selection = null;
    if (learn.ti + 1 < L.tasks.length) {
      Audio2.playMove("b");
      toast("完成!下一小题");
      learn.ti++;
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
    toast("🎉 课程完成:" + L.title);
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
    const title = document.getElementById("lesson-title");
    if (title) title.textContent = "第 " + (learn.li + 1) + " 课 · " + L.part + " · " + L.title;
    const textEl = document.getElementById("lesson-text");
    if (textEl) {
      textEl.innerHTML = "";
      for (const p of L.text) {
        const el = document.createElement("p");
        el.textContent = p;
        textEl.appendChild(el);
      }
    }
    const task = document.getElementById("lesson-task");
    if (task) task.textContent = learnTaskText();
    const next = document.getElementById("lesson-next");
    if (next) {
      const isLast = learn.li + 1 >= LESSONS.length;
      next.textContent = isLast ? "去人机·入门" : "下一课";
      next.disabled = isLast && !learn.done;
      next.classList.toggle("primary", learn.done);
    }
    const list = document.getElementById("lesson-list");
    if (list) {
      list.innerHTML = "";
      let lastPart = null;
      LESSONS.forEach((x, i) => {
        if (x.part !== lastPart) {
          lastPart = x.part;
          const h = document.createElement("div");
          h.className = "lesson-part";
          h.textContent = x.part;
          list.appendChild(h);
        }
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === learn.li ? " current" : "");
        b.dataset.i = String(i);
        const mark = learnState.done[x.id] ? "✓ " : "";
        b.textContent = mark + (i + 1) + ". " + x.title;
        list.appendChild(b);
      });
    }
  }

  // --- puzzle mode: tactics trainer (data in puzzles.js, pure chess.js) ---
  const PUZZLE_KEY = "chess.v1.puzzles";
  const PUZZLES = window.CHESS_PUZZLES || [];
  const PUZZLE_CATS = [["m1", "一步杀"], ["m2", "两步杀"], ["m3", "三步杀"], ["win", "吃子"], ["tac", "战术"], ["op", "开局"]];
  const PUZZLE_MOVES = { m1: 1, m2: 2, m3: 3 };
  /** scripted-line categories: exact-line play, opponent replies from the script */
  const SCRIPTED_CATS = { win: true, op: true, tac: true };

  /** Opening trainer drills, generated from the vendored ECO book (≥6 plies). */
  const OPENING_DRILLS = (window.CHESS_OPENINGS || [])
    .filter(([, , seq]) => seq.split(" ").length >= 6)
    .map(([eco, name, seq], i) => ({
      id: "op-" + eco + "-" + i,
      cat: "op",
      name: eco + " " + name,
      line: seq.split(" "),
    }));
  const ALL_PUZZLES = PUZZLES.concat(OPENING_DRILLS);

  function loadPuzzleState() {
    try {
      const s = JSON.parse(Host.storageGet(PUZZLE_KEY) || "null");
      if (s && s.v === 1 && s.solved) return s;
    } catch (_) {}
    return { v: 1, solved: {}, cat: "m1" };
  }
  let puzzleState = loadPuzzleState();
  function savePuzzleState() {
    try { Host.storageSet(PUZZLE_KEY, JSON.stringify(puzzleState)); } catch (_) {}
  }

  function puzzlesInCat(cat) { return ALL_PUZZLES.filter((p) => p.cat === cat); }

  /** the scripted line of the current puzzle (openings: line; win: solution) */
  function puzzleScript(p) { return p.line || p.solution; }

  function startPuzzleAt(cat, idx) {
    const list = puzzlesInCat(cat);
    if (!list.length) return;
    idx = ((idx % list.length) + list.length) % list.length;
    puzzleState.cat = cat;
    savePuzzleState();
    const p = list[idx];
    puzzle = { cat, idx, p, g: p.fen ? new Chess(p.fen) : new Chess(), stage: 0, done: false, misses: 0, helpArrow: null, last: null };
    selection = null;
    sync();
  }

  function startPuzzles() {
    const cat = PUZZLE_CATS.some(([c]) => c === puzzleState.cat) ? puzzleState.cat : "m1";
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
    if (p.cat === "op") return p.name + " · 执白照谱走完 " + Math.ceil(p.line.length / 2) + " 回合";
    if (p.cat === "win") return p.name + " · 白先,吃掉最大的战利品(净得 " + p.gain + " 分)";
    if (p.cat === "tac") return p.name + " · " + (p.motif || "战术") + " · 白先强制得子(净得 " + p.gain + " 分)";
    const n = { m1: "一", m2: "两", m3: "三" }[p.cat] || "?";
    return p.name + " · 白先," + n + "步内将死";
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
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: g.in_check() });
    if (SCRIPTED_CATS[puzzle.p.cat]) {
      // scripted line: exact match, opponent replies straight from the script
      const script = puzzleScript(puzzle.p);
      if (mv.san !== script[puzzle.stage]) {
        const c = puzzle.p.cat;
        puzzleWrong(
          c === "win" ? (mv.captured ? "吃它不划算 —— 数数保护者再算算分" : "有更大的战利品等着你") :
          c === "tac" ? (puzzle.stage === 0 ? "找" + (puzzle.p.motif || "强制手段") + " —— 先用将军逼住对方" : "抓住时机吃掉目标子") :
          "这不是谱着");
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
      puzzleWrong(escape ? "还不是将死 —— 黑方可走 " + escape : "还不是将死");
      return;
    }
    // midpoint: the stored line, or any alternate that still forces mate
    const onLine = mv.san === puzzle.p.solution[puzzle.stage * 2];
    if (!onLine) {
      const refutation = findRefutation(g, remaining);
      if (refutation) {
        puzzleWrong("不能强制将死 —— 黑方可用 " + refutation + " 化解");
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

  function puzzleWrong(reason) {
    puzzle.g.undo();
    puzzle.last = null;
    puzzle.misses++;
    toast((reason || "这步不能强制将死") +
      (puzzle.misses >= 2 ? " —— 点「答案」看正解" : " —— 再试试"));
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
      sync();
    }
  }

  function puzzleSolved() {
    puzzle.done = true;
    selection = null;
    Audio2.playWin();
    if (!puzzleState.solved[puzzle.p.id]) {
      puzzleState.solved[puzzle.p.id] = true;
      savePuzzleState();
      checkNewAchievements();
    }
    const verb = puzzle.p.cat === "op" ? "背谱完成" :
      puzzle.p.cat === "win" || puzzle.p.cat === "tac" ? "得子成功" : "解出";
    toast("✅ " + verb + " · " + puzzle.p.name);
    sync();
  }

  function nextPuzzle() {
    if (!puzzle) return;
    const list = puzzlesInCat(puzzle.cat);
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
    if (mode !== "puzzle" || !puzzle) return;
    const list = puzzlesInCat(puzzle.cat);
    const solvedAll = ALL_PUZZLES.filter((p) => puzzleState.solved[p.id]).length;
    const prog = document.getElementById("puzzle-progress");
    if (prog) prog.textContent = "已解 " + solvedAll + "/" + ALL_PUZZLES.length;
    document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === puzzle.cat);
    });
    const task = document.getElementById("puzzle-task");
    if (task) {
      task.textContent = puzzle.done
        ? "✅ 解出!点「下一题」继续"
        : "第 " + (puzzle.idx + 1) + " 题 · " + puzzleGoalText();
    }
    const next = document.getElementById("puzzle-next");
    if (next) next.classList.toggle("primary", puzzle.done);
    const listEl = document.getElementById("puzzle-list");
    if (listEl) {
      listEl.innerHTML = "";
      list.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === puzzle.idx ? " current" : "");
        b.dataset.i = String(i);
        b.textContent = (puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + p.name;
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

  async function analyzeGame() {
    if (analyzing || !window.ChessEngine) return;
    const h = sanHistory();
    if (!h.length) { toast("还没有对局可分析"); return; }
    const sig = game.pgn();
    const g = baseGame();
    const fens = [g.fen()];
    for (const san of h) { g.move(san); fens.push(g.fen()); }
    analyzing = true;
    analyzeProgress = "0/" + fens.length;
    setAnalyzeUI();
    const scalars = new Array(fens.length).fill(null);
    const pvs = new Array(fens.length).fill(null);
    for (let i = 0; i < fens.length; i++) {
      if (game.pgn() !== sig) { analyzing = false; analyzeProgress = ""; setAnalyzeUI(); return; }
      const probe = new Chess(fens[i]);
      if (probe.in_checkmate()) scalars[i] = probe.turn() === "w" ? -10000 : 10000;
      else if (probe.game_over()) scalars[i] = 0;
      else {
        let e = null;
        try { e = await window.ChessEngine.analyze(fens[i], 120); } catch (_) {}
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
    analysis = { sig, scalars, tags, pvs };
    analyzing = false;
    analyzeProgress = "";
    sync();
    const bad = tags.filter((t) => t === "?" || t === "??").length;
    toast(bad ? "分析完成 · " + bad + " 处失着" : "分析完成 · 没有明显失着");
  }

  function setAnalyzeUI() {
    const btn = document.getElementById("an-run");
    if (btn) {
      btn.disabled = analyzing || !sanHistory().length;
      btn.textContent = analyzing ? "分析中 " + analyzeProgress : "分析";
    }
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
      pvEl.textContent = pv ? "引擎主变 · " + pv : "";
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
      const t = a.tags[i];
      if (t !== "?" && t !== "??") continue;
      const s = a.scalars[i + 1];
      if (s == null) continue;
      ctx.fillStyle = t === "??" ? "#e05252" : "#e0a03c";
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
    if (mode !== "ai" || !game.game_over()) return;
    const sig = game.pgn();
    if (statsRecordedSig === sig) return;
    statsRecordedSig = sig;
    let result = "draw";
    if (game.in_checkmate()) result = game.turn() === humanColor ? "loss" : "win";
    const s = loadStats();
    s.games.push({ t: Date.now(), diff: difficulty, color: humanColor, result, moves: sanHistory().length });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    try { Host.storageSet(STATS_KEY, JSON.stringify(s)); } catch (_) {}
    renderStats();
    checkNewAchievements();
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
    el.innerHTML = "";
    let total = 0;
    for (const k of ["easy", "normal", "hard", "extreme"]) {
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
      val.textContent = a.win + "胜 " + a.loss + "负 " + a.draw + "和";
      row.append(name, val);
      el.appendChild(row);
    }
    const hint = document.createElement("p");
    hint.className = "hint";
    hint.textContent = total ? "共 " + total + " 局 · 人机完局自动记录" : "人机对局分出胜负后自动记录";
    el.appendChild(hint);
    const clearBtn = document.getElementById("stats-clear");
    if (clearBtn) clearBtn.disabled = !total;
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

  /** [{ach, unlocked}] with the meta "completionist" resolved in a 2nd pass. */
  function evalAch() {
    const s = achSummary();
    const base = ACH.filter((a) => a.id !== "completionist");
    const baseRes = base.map((a) => ({ ach: a, unlocked: !!a.test(s) }));
    s.otherUnlocked = baseRes.filter((r) => r.unlocked).length;
    s.otherTotal = base.length;
    return ACH.map((a) =>
      a.id === "completionist" ? { ach: a, unlocked: !!a.test(s) }
        : baseRes.find((r) => r.ach.id === a.id));
  }

  /** Toast any achievement newly unlocked since last check; persist seen set. */
  function checkNewAchievements() {
    const res = evalAch();
    const fresh = res.filter((r) => r.unlocked && !achSeen.has(r.ach.id));
    for (const r of res) if (r.unlocked) achSeen.add(r.ach.id);
    if (fresh.length) {
      try { Host.storageSet(ACH_KEY, JSON.stringify({ seen: Array.from(achSeen) })); } catch (_) {}
      // one toast per unlock, staggered so several don't collide
      fresh.forEach((r, i) => setTimeout(() => toast("🎉 成就解锁 · " + r.ach.icon + " " + r.ach.name), i * 1600));
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
      b.title = r.ach.desc;
      const ic = document.createElement("span");
      ic.className = "ach-ic";
      ic.textContent = r.unlocked ? r.ach.icon : "🔒";
      const nm = document.createElement("span");
      nm.className = "ach-nm";
      nm.textContent = r.ach.name;
      b.append(ic, nm);
      el.appendChild(b);
    }
  }

  // --- game flow ---

  /** FIDE 6.9 (simplified): lone K, K+B or K+N cannot win on the opponent's flag. */
  function sideHasMatingMaterial(color) {
    const pieces = [];
    for (const row of game.board()) for (const p of row) {
      if (p && p.color === color && p.type !== "k") pieces.push(p.type);
    }
    if (pieces.length === 0) return false;
    if (pieces.length === 1 && (pieces[0] === "b" || pieces[0] === "n")) return false;
    return true;
  }

  function timeoutIsDraw() {
    return flagFall && !sideHasMatingMaterial(flagFall === "w" ? "b" : "w");
  }

  function statusText() {
    if (mode === "learn") {
      if (!learn) return "教学模式";
      if (learn.done) return "🎉 课程完成";
      // the sidebar may be closed while clicking the board — put the live
      // task instructions where they are always visible
      return learnTaskText();
    }
    if (mode === "puzzle") {
      if (!puzzle) return "做题练习";
      if (puzzle.done) return "✅ 解出 · 下一题";
      return puzzleGoalText();
    }
    const g = viewGame();
    if (!isLive()) return "复盘 " + viewIndex + "/" + sanHistory().length;
    if (flagFall) {
      if (timeoutIsDraw()) return "超时 · 和棋(对方无子力将杀)";
      return flagFall === "w" ? "超时 · 黑方胜" : "超时 · 白方胜";
    }
    if (resigned) return resigned === "w" ? "白方认输 · 黑方胜" : "黑方认输 · 白方胜";
    if (drawAgreed) return "协议和棋 · 和棋";
    if (engineThinking && !g.game_over()) return "引擎思考中…";
    if (g.in_checkmate()) return g.turn() === "w" ? "将死 · 黑方胜" : "将死 · 白方胜";
    if (g.in_stalemate()) return "逼和 · 和棋";
    if (g.in_threefold_repetition()) return "三次重复 · 和棋";
    if (g.insufficient_material()) return "子力不足 · 和棋";
    if (g.in_draw()) return "和棋";
    const side = g.turn() === "w" ? "白方走子" : "黑方走子";
    return g.in_check() ? side + " · 将军！" : side;
  }

  function renderMoveList() {
    const el = document.getElementById("move-list");
    if (!el) return;
    const h = sanHistory();
    el.innerHTML = "";
    for (let i = 0; i < h.length; i += 2) {
      const row = document.createElement("div");
      row.className = "mlrow";
      const num = document.createElement("span");
      num.className = "mlnum num";
      num.textContent = (i / 2 + 1) + ".";
      row.appendChild(num);
      const a = analysisFor();
      for (const j of [i, i + 1]) {
        if (j >= h.length) break;
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.i = String(j + 1);
        b.textContent = h[j];
        b.className = "mlmove" + (viewIndex === j + 1 ? " current" : "");
        const tag = a && a.tags[j];
        if (tag) {
          const t = document.createElement("span");
          t.className = "mvtag " + (tag === "??" ? "t-bad" : tag === "?" ? "t-mid" : "t-soft");
          t.textContent = tag;
          b.appendChild(t);
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

  /** Live game finished by an app-level rule (flag / resignation / agreed draw). */
  function ruleTerminated() { return !!flagFall || !!resigned || drawAgreed; }

  function sync() {
    draw();
    const h = sanHistory();
    document.getElementById("status").textContent = statusText();
    document.getElementById("moves").textContent =
      mode === "learn" ? (learn ? (learn.li + 1) + "/" + LESSONS.length : "—") :
      mode === "puzzle" ? (puzzle ? "题 " + (puzzle.idx + 1) + "/" + puzzlesInCat(puzzle.cat).length : "—") :
      viewIndex + "/" + h.length;
    document.getElementById("replay-pos").textContent = viewIndex + " / " + h.length;
    document.getElementById("rep-start").disabled = viewIndex <= 0;
    document.getElementById("rep-prev").disabled = viewIndex <= 0;
    document.getElementById("rep-next").disabled = viewIndex >= h.length;
    document.getElementById("rep-end").disabled = viewIndex >= h.length;
    document.getElementById("rep-live").disabled = isLive();
    const modal = mode === "learn" || mode === "puzzle";
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
        : hintPending || analyzing || !isLive() || game.game_over() || ruleTerminated() ||
          (mode === "ai" && (engineThinking || game.turn() !== humanColor));
      hintBtn.textContent = mode === "puzzle" ? "答案" : hintPending ? "思考中" : "提示";
    }
    const resignBtn = document.getElementById("btn-resign");
    if (resignBtn) {
      resignBtn.disabled = modal || !isLive() || h.length === 0 ||
        game.game_over() || ruleTerminated();
    }
    const drawBtn = document.getElementById("btn-offerdraw");
    if (drawBtn) {
      drawBtn.disabled = modal || !isLive() || h.length === 0 ||
        game.game_over() || ruleTerminated() || drawOfferPending;
    }
    document.getElementById("pgn-copy").disabled = h.length === 0;
    document.getElementById("pgn-download").disabled = h.length === 0;
    document.getElementById("fen-copy").disabled = false;
    const status = document.getElementById("status");
    const g = viewGame();
    const decisiveEnd = g.in_checkmate() || !!resigned || (flagFall && !timeoutIsDraw());
    status.classList.toggle("win", !modal && isLive() && decisiveEnd);
    status.classList.toggle("replay", !modal && !isLive());
    const over = game.game_over() || ruleTerminated();
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
    const secMoves = document.getElementById("sec-moves");
    const secStats = document.getElementById("sec-stats");
    const trainer = mode === "learn" || mode === "puzzle";
    if (secMoves) secMoves.hidden = trainer;
    if (secStats) secStats.hidden = trainer;
    const engineName = "Stockfish · " + (DIFF_NAMES[difficulty] || difficulty);
    const wRole = document.getElementById("white-role");
    const bRole = document.getElementById("black-role");
    if (wRole && bRole) {
      if (mode === "ai") {
        wRole.textContent = humanColor === "w" ? "玩家" : engineName;
        bRole.textContent = humanColor === "b" ? "玩家" : engineName;
      } else if (mode === "learn") {
        const drill = learn && curTask().type === "drill";
        wRole.textContent = "学员(执白)";
        bRole.textContent = drill ? "引擎陪练" : "—";
      } else if (mode === "puzzle") {
        wRole.textContent = "你(执白)";
        bRole.textContent = "题目";
      } else {
        wRole.textContent = "玩家 1";
        bRole.textContent = "玩家 2";
      }
    }
  }

  function setViewIndex(n) {
    viewIndex = Math.max(0, Math.min(n, sanHistory().length));
    selection = null;
    sync();
  }

  function goLive() { setViewIndex(sanHistory().length); }

  const PROMO_NAMES = { q: "后", r: "车", b: "象", n: "马" };
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
    Audio2.playMove(mv.color, { captured: !!mv.captured, check: game.in_check() });
    if (mv.promotion) toast("已升变为" + (PROMO_NAMES[mv.promotion] || "后"));
    if (game.in_checkmate()) Audio2.playWin();
    else if (game.game_over()) Audio2.playDraw();
    sync();
    saveGame();
    recordGameIfOver();
    maybeEngineTurn();
  }

  function onSquareClick(sq) {
    if (mode === "learn") { learnClick(sq); return; }
    if (mode === "puzzle") { puzzleClick(sq); return; }
    if (!isLive()) { toast("请先「回到最新一着」再走子"); return; }
    if (game.game_over()) return;
    if (flagFall) { toast("已超时 · 按 N 开新局"); return; }
    if (resigned) { toast("本局已认输 · 按 N 开新局"); return; }
    if (drawAgreed) { toast("本局已协议和棋 · 按 N 开新局"); return; }
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
    sync();
    saveGame();
    maybeEngineTurn();
  }

  async function requestNewGame() {
    if (sanHistory().length &&
        !(await confirmNative("开始新局将清空当前对局，是否继续？", "新局", { ok: "新局", cancel: "取消" }))) {
      return;
    }
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    game.reset();
    selection = null;
    viewIndex = 0;
    resigned = null;
    drawAgreed = false;
    resetClocks();
    sync();
    saveGame();
    toast("新局开始 · 白先");
    maybeEngineTurn();
  }

  /** Truncate the game to the replay cursor and continue playing from there. */
  async function retryFromHere() {
    if (isLive()) return;
    const keep = viewIndex;
    const drop = sanHistory().length - keep;
    if (!(await confirmNative("从第 " + keep + " 着继续重下,其后 " + drop + " 着将被丢弃,是否继续?", "重下", { ok: "重下", cancel: "取消" }))) {
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
    sync();
    saveGame();
    toast("已回到第 " + keep + " 着,继续对弈");
    maybeEngineTurn();
  }

  // --- resignation (terminal, like mate; AI games count as a loss) ---
  async function doResign() {
    if (mode === "learn" || !isLive() || !sanHistory().length || game.game_over() || ruleTerminated()) return;
    const side = mode === "ai" ? humanColor : game.turn();
    const who = side === "w" ? "白方" : "黑方";
    if (!(await confirmNative(who + "认输,结束本局?", "认输", { ok: "认输", cancel: "取消" }))) return;
    invalidateEngine();
    resigned = side;
    Audio2.playWin();
    if (mode === "ai") recordResign();
    saveGame();
    sync();
    toast(who + "认输 · " + (side === "w" ? "黑方" : "白方") + "胜");
  }

  /** Record an AI-game outcome decided by an app-level rule (not by mate). */
  function recordOutcome(result, suffix) {
    const sig = game.pgn() + suffix;
    if (statsRecordedSig === sig) return;
    statsRecordedSig = sig;
    const s = loadStats();
    s.games.push({ t: Date.now(), diff: difficulty, color: humanColor, result, moves: sanHistory().length });
    if (s.games.length > 500) s.games = s.games.slice(-500);
    try { Host.storageSet(STATS_KEY, JSON.stringify(s)); } catch (_) {}
    renderStats();
    checkNewAchievements();
  }

  function recordResign() { recordOutcome("loss", "#resigned"); }

  // --- draw offer: pvp = both agree on the spot; ai = engine judges the eval ---
  let drawOfferPending = false;
  async function doOfferDraw() {
    if (mode === "learn" || mode === "puzzle" || !isLive() || !sanHistory().length ||
        game.game_over() || ruleTerminated() || drawOfferPending) return;
    if (mode === "pvp") {
      if (!(await confirmNative("双方都同意和棋吗?", "提和", { ok: "同意和棋", cancel: "继续下" }))) return;
      acceptDraw();
      return;
    }
    // ai mode: offer on your own turn; the engine accepts unless it is winning
    if (engineThinking || game.turn() !== humanColor) { toast("轮到你走棋时才能提和"); return; }
    if (sanHistory().length < 20) { toast("开局阶段引擎不接受提和"); return; }
    if (!window.ChessEngine) { toast("引擎不可用"); return; }
    drawOfferPending = true;
    toast("已向引擎提和,评估中…");
    let e = null;
    const sig = game.fen();
    try { e = await window.ChessEngine.analyze(sig, 300); } catch (_) {}
    drawOfferPending = false;
    if (game.fen() !== sig || ruleTerminated() || game.game_over()) return;
    // e.cp is from the side to move (the human here); engine eval = -cp
    const engineCp = e && e.cp != null ? -e.cp : e && e.mate != null ? (e.mate > 0 ? -10000 : 10000) : null;
    if (engineCp != null && engineCp < 60) {
      acceptDraw();
    } else {
      sync();
      toast("引擎拒绝提和 —— 它觉得局面更好,继续下");
    }
  }

  function acceptDraw() {
    invalidateEngine();
    drawAgreed = true;
    Audio2.playDraw();
    if (mode === "ai") recordAgreedDraw();
    saveGame();
    sync();
    toast("协议和棋 · 和棋");
  }

  function recordAgreedDraw() { recordOutcome("draw", "#drawAgreed"); }

  // --- FEN / PGN I/O ---
  async function copyText(text, okMsg) {
    try { await Host.writeClipboard(text); toast(okMsg); }
    catch (_) { toast("复制失败"); }
  }

  function gameResultToken() {
    if (game.in_checkmate()) return game.turn() === "w" ? "0-1" : "1-0";
    if (resigned) return resigned === "w" ? "0-1" : "1-0";
    if (drawAgreed) return "1/2-1/2";
    if (flagFall) {
      if (timeoutIsDraw()) return "1/2-1/2";
      return flagFall === "w" ? "0-1" : "1-0";
    }
    if (game.game_over()) return "1/2-1/2"; // stalemate + the draw rules
    return "*";
  }

  /** Standard-conforming PGN: Seven Tag Roster + result token appended. */
  function pgnForExport() {
    const DIFF_EN = { easy: "Easy", normal: "Normal", hard: "Hard", extreme: "Max" };
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
    if (!sanHistory().length) { toast("还没有棋谱可导出"); return; }
    const pgn = pgnForExport();
    const name = pgnFileName();
    if (Host.hasZero()) {
      try {
        const path = await Host.saveFileDialog({ title: "导出 PGN", defaultName: name });
        if (path == null) { toast("已取消导出"); return; }
        await Host.writeTextFile(path, pgn);
        await Host.revealPath(path);
        toast("已导出 " + name);
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
      toast("已导出 " + name);
    } catch (_) {
      copyText(pgn, "导出受限，PGN 已复制到剪贴板");
    }
  }

  async function importPgnText(text, label) {
    const t = (text || "").trim();
    if (!t) { toast("没有可导入的内容"); return; }
    if (sanHistory().length &&
        !(await confirmNative("导入将替换当前对局，是否继续？", "导入 PGN", { ok: "导入", cancel: "取消" }))) {
      return;
    }
    const probe = new Chess();
    if (!probe.load_pgn(t, { sloppy: true }) || !probe.history().length) {
      toast("无法解析 PGN 棋谱");
      return;
    }
    invalidateEngine();
    game.load_pgn(t, { sloppy: true });
    selection = null;
    viewIndex = sanHistory().length;
    resigned = null;
    drawAgreed = false;
    resetClocks();
    sync();
    saveGame();
    toast("已导入 " + sanHistory().length + " 着");
    maybeEngineTurn();
  }

  async function pastePgn() {
    try {
      const text = await navigator.clipboard.readText();
      importPgnText(text, "剪贴板");
    } catch (_) {
      toast("无法读取剪贴板");
    }
  }

  // --- panel ---
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
  let dragging = null; // {from} armed on pressing one of our selectable pieces
  canvas.addEventListener("pointerdown", (ev) => {
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    if (!sq) return;
    try { canvas.setPointerCapture(ev.pointerId); } catch (_) {}
    onSquareClick(sq);
    dragging = selection && selection.sq === sq ? { from: sq } : null;
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const p = canvasPoint(ev);
    BoardView.setDrag({ from: dragging.from, x: p.x, y: p.y });
    draw();
  });
  canvas.addEventListener("pointerup", (ev) => {
    const wasDrag = dragging;
    dragging = null;
    BoardView.setDrag(null);
    if (!wasDrag) return;
    const p = canvasPoint(ev);
    const sq = BoardView.cellAt(p.x, p.y);
    draw();
    if (sq && sq !== wasDrag.from) onSquareClick(sq); // drop = play/reselect
  });
  canvas.addEventListener("pointercancel", () => {
    dragging = null;
    BoardView.setDrag(null);
    draw();
  });
  canvas.style.cursor = "pointer";
  canvas.style.touchAction = "none"; // let touch drags move pieces, not the page

  document.getElementById("undo").onclick = undo;
  document.getElementById("btn-hint").onclick = () => { requestHint(); };
  document.getElementById("btn-new").onclick = () => { requestNewGame(); };
  document.getElementById("btn-flip").onclick = () => {
    flipped = !flipped;
    saveSettings();
    draw();
    toast(flipped ? "黑方视角" : "白方视角");
  };
  document.getElementById("toggle-panel").onclick = togglePanel;
  document.getElementById("collapse").onclick = () => setPanelOpen(false);
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
  document.getElementById("rep-live").onclick = () => { goLive(); toast("已回到最新一着"); };

  document.getElementById("an-run").onclick = () => { analyzeGame(); };
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
    if (!(await confirmNative("清零人机对局统计?", "清零统计", { ok: "清零", cancel: "取消" }))) return;
    try { Host.storageRemove(STATS_KEY); } catch (_) {}
    renderStats();
    renderAchievements();
    toast("统计已清零");
  };

  document.getElementById("fen-copy").onclick = () => copyText(viewGame().fen(), "FEN 已复制");
  document.getElementById("pgn-copy").onclick = () => {
    if (!sanHistory().length) { toast("还没有棋谱可复制"); return; }
    copyText(pgnForExport(), "PGN 已复制(含对局标签)");
  };
  const resignEl = document.getElementById("btn-resign");
  if (resignEl) resignEl.onclick = () => { doResign(); };
  const drawEl = document.getElementById("btn-offerdraw");
  if (drawEl) drawEl.onclick = () => { doOfferDraw(); };
  document.getElementById("pgn-download").onclick = () => { downloadPgn(); };
  document.getElementById("pgn-paste").onclick = () => { pastePgn(); };

  document.getElementById("theme-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-theme]");
    if (b) {
      applyTheme(b.dataset.theme);
      const names = { wood: "木色", night: "夜色", day: "日间", notebook: "纸本" };
      toast("主题：" + (names[themeId] || themeId));
    }
  };
  document.getElementById("mode-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-mode]");
    if (!b || b.dataset.mode === mode) return;
    invalidateEngine();
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
    saveSettings();
    selection = null;
    sync();
    toast(mode === "ai" ? "人机对弈 · " + (DIFF_NAMES[difficulty] || "") :
      mode === "pvp" ? "双人对弈" :
      mode === "learn" ? "教学模式 · 从零学国际象棋" : "做题练习 · 白先将死");
    maybeEngineTurn();
  };
  document.getElementById("lesson-restart").onclick = () => {
    if (learn) { startLearnTask(); toast("本课重来"); }
  };
  document.getElementById("learn-reset").onclick = async () => {
    if (!(await confirmNative("清空全部教学进度,从第一课重新开始?", "重置教学", { ok: "重置", cancel: "取消" }))) return;
    learnState = { v: 1, done: {}, last: 0 };
    saveLearnState();
    if (learn) startLesson(0);
    toast("教学进度已重置");
  };
  document.getElementById("lesson-next").onclick = () => {
    if (!learn) return;
    if (learn.li + 1 < LESSONS.length) { startLesson(learn.li + 1); return; }
    // graduation: straight into a beginner AI game
    difficulty = "easy";
    mode = "ai";
    stopLearn();
    saveSettings();
    selection = null;
    sync();
    toast("人机对弈 · 入门 —— 开始你的第一局!");
    maybeEngineTurn();
  };
  document.getElementById("lesson-list").onclick = (ev) => {
    const b = ev.target.closest("button[data-i]");
    if (b && learn) startLesson(Number(b.dataset.i));
  };
  document.getElementById("puzzle-cat-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-cat]");
    if (!b || !puzzle || b.dataset.cat === puzzle.cat) return;
    puzzleState.cat = b.dataset.cat;
    savePuzzleState();
    startPuzzles();
  };
  document.getElementById("puzzle-retry").onclick = () => {
    if (puzzle) { startPuzzleAt(puzzle.cat, puzzle.idx); toast("重新开始本题"); }
  };
  document.getElementById("puzzle-answer").onclick = () => { showPuzzleAnswer(); };
  document.getElementById("puzzle-next").onclick = () => { nextPuzzle(); };
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
    toast(timeControl === "off" ? "棋钟已关" : "棋钟 · 每方 " + timeControl + " 分钟");
  };
  document.getElementById("diff-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-diff]");
    if (!b || b.dataset.diff === difficulty) return;
    difficulty = b.dataset.diff;
    saveSettings();
    sync();
    toast("难度：" + (DIFF_NAMES[difficulty] || difficulty));
  };
  document.getElementById("color-seg").onclick = (ev) => {
    const b = ev.target.closest("button[data-color]");
    if (!b || b.dataset.color === humanColor) return;
    invalidateEngine();
    humanColor = b.dataset.color;
    flipped = humanColor === "b";
    saveSettings();
    sync();
    toast(humanColor === "w" ? "执白 · 白方视角" : "执黑 · 黑方视角");
    maybeEngineTurn();
  };
  document.getElementById("opt-sound").onclick = () => {
    soundOn = !soundOn;
    saveSettings();
    syncSettingsUI();
    if (soundOn) Audio2.playMove("w");
    toast(soundOn ? "音效已开" : "音效已关");
  };
  document.getElementById("clear-save").onclick = async () => {
    if (!(await confirmNative("清除自动存档并开始新局？", "清除存档", { ok: "清除", cancel: "取消" }))) return;
    try { Host.storageRemove(SAVE_KEY); } catch (_) {}
    invalidateEngine();
    if (window.ChessEngine) window.ChessEngine.newGame();
    game.reset();
    selection = null;
    viewIndex = 0;
    resigned = null;
    drawAgreed = false;
    resetClocks();
    sync();
    toast("存档已清除");
    maybeEngineTurn();
  };

  const confirmModal = document.getElementById("confirm-modal");
  document.getElementById("confirm-ok").onclick = () => finishConfirm(true);
  document.getElementById("confirm-cancel").onclick = () => finishConfirm(false);
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
      if (confirmModal.classList.contains("show")) { finishConfirm(false); return; }
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
      if (k === "r") { startLearnTask(); toast("本课重来"); }
      else if (k === "z") learnUndo();
      else if (k === "h") learnHint();
      return;
    }
    if (mode === "puzzle") {
      if (!puzzle || ev.metaKey || ev.ctrlKey) return;
      if (k === "r") { startPuzzleAt(puzzle.cat, puzzle.idx); toast("重新开始本题"); }
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
  window.addEventListener("beforeunload", () => saveGame());
  window.addEventListener("pagehide", () => saveGame());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") saveGame();
  });

  // --- boot ---
  loadSettings();
  document.documentElement.setAttribute("data-theme", themeId);
  const savedPanel = Host.storageGet(PANEL_KEY);
  setPanelOpen(savedPanel === "1");
  const resumed = tryLoadSave();
  if (resumed) toast("已恢复上次对局");
  // a resumed finished game must not be re-counted on the next live move
  if (resumed && game.game_over()) statsRecordedSig = game.pgn();
  if (resumed && resigned) statsRecordedSig = game.pgn() + "#resigned";
  if (resumed && drawAgreed) statsRecordedSig = game.pgn() + "#drawAgreed";
  // clock preset chosen but no saved clock state → fresh clocks
  if (timeControl !== "off" && !clock) resetClocks();
  if (mode === "learn") startLearn();
  if (mode === "puzzle") startPuzzles();
  BoardView.resizeCanvas();
  renderStats();
  renderAchievements();
  sync();
  saveSettings();
  if (!resumed) saveGame();
  if (mode === "ai" && window.ChessEngine) {
    window.ChessEngine.init().catch(() => toast("引擎初始化失败"));
    maybeEngineTurn(); // resumed save may leave the engine on move
  }

})();
