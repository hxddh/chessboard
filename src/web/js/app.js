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

  Audio2.init(() => soundOn);

  function sanHistory() { return game.history(); }
  function isLive() { return viewIndex === sanHistory().length; }

  /** chess.js instance for the currently VIEWED position (live or replay). */
  function viewGame() {
    if (isLive()) return game;
    const g = new Chess();
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
    };
  });

  function draw() { BoardView.draw(); }

  // --- toast + in-app confirm (same reliable pattern as Goban) ---
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
      if (["ai", "pvp"].includes(s.mode)) mode = s.mode;
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
    if (game.game_over() || game.turn() === humanColor) return;
    const token = ++engineToken;
    engineThinking = true;
    sync();
    let mv = null;
    try { mv = await window.ChessEngine.bestMove(game.fen(), difficulty); }
    catch (_) { mv = null; }
    if (token !== engineToken) return; // game changed while thinking
    engineThinking = false;
    if (!mv) { sync(); toast("引擎未能走子"); return; }
    const played = game.move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    if (played) {
      viewIndex = sanHistory().length;
      selection = null;
      hintMove = null;
      Audio2.playMove(played.color);
      if (game.in_checkmate()) Audio2.playWin();
      saveGame();
      recordGameIfOver();
    }
    sync();
  }

  // --- engine hint: full-strength best move drawn as an arrow ---

  async function requestHint() {
    if (!window.ChessEngine) { toast("引擎不可用"); return; }
    if (!isLive()) { toast("请先回到最新一着"); return; }
    if (game.game_over() || flagFall) return;
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
    return mode === "pvp" && !!clock && !flagFall && !game.game_over() && sanHistory().length >= 1;
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
      Audio2.playWin();
      saveGame();
      sync();
      toast(side === "w" ? "白方超时 · 黑方胜" : "黑方超时 · 白方胜");
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
    const show = mode === "pvp" && timeControl !== "off" && !!clock;
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
    const name = openingFor(viewIndex);
    el.hidden = !name;
    el.textContent = name || "";
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
    const g = new Chess();
    const fens = [g.fen()];
    for (const san of h) { g.move(san); fens.push(g.fen()); }
    analyzing = true;
    analyzeProgress = "0/" + fens.length;
    setAnalyzeUI();
    const scalars = new Array(fens.length).fill(null);
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
      }
      analyzeProgress = (i + 1) + "/" + fens.length;
      setAnalyzeUI();
    }
    // centipawn loss from the mover's perspective (games start from startpos,
    // so even plies are white's moves)
    const tags = h.map((_, i) => {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) return null;
      const loss = i % 2 === 0 ? a - b : b - a;
      if (loss >= 300) return "??";
      if (loss >= 100) return "?";
      if (loss >= 50) return "?!";
      return null;
    });
    analysis = { sig, scalars, tags };
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

  // --- game flow ---
  function statusText() {
    const g = viewGame();
    if (!isLive()) return "复盘 " + viewIndex + "/" + sanHistory().length;
    if (flagFall) return flagFall === "w" ? "超时 · 黑方胜" : "超时 · 白方胜";
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

  function sync() {
    draw();
    const h = sanHistory();
    document.getElementById("status").textContent = statusText();
    document.getElementById("moves").textContent = viewIndex + "/" + h.length;
    document.getElementById("replay-pos").textContent = viewIndex + " / " + h.length;
    document.getElementById("rep-start").disabled = viewIndex <= 0;
    document.getElementById("rep-prev").disabled = viewIndex <= 0;
    document.getElementById("rep-next").disabled = viewIndex >= h.length;
    document.getElementById("rep-end").disabled = viewIndex >= h.length;
    document.getElementById("rep-live").disabled = isLive();
    document.getElementById("undo").disabled = h.length === 0 || !isLive() || !!flagFall;
    const hintBtn = document.getElementById("btn-hint");
    if (hintBtn) {
      hintBtn.disabled = hintPending || analyzing || !isLive() || game.game_over() || !!flagFall ||
        (mode === "ai" && (engineThinking || game.turn() !== humanColor));
      hintBtn.textContent = hintPending ? "思考中" : "提示";
    }
    document.getElementById("pgn-copy").disabled = h.length === 0;
    document.getElementById("pgn-download").disabled = h.length === 0;
    document.getElementById("fen-copy").disabled = false;
    const status = document.getElementById("status");
    const g = viewGame();
    status.classList.toggle("win", isLive() && (g.in_checkmate() || !!flagFall));
    status.classList.toggle("replay", !isLive());
    const over = game.game_over() || !!flagFall;
    document.getElementById("white-turn").hidden = !(isLive() && !over && game.turn() === "w");
    document.getElementById("black-turn").hidden = !(isLive() && !over && game.turn() === "b");
    const rt = document.getElementById("retry-here");
    if (rt) rt.disabled = isLive();
    renderMoveList();
    setAnalyzeUI();
    renderOpening();
    renderClocks();
    syncClockTimer();
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
    if (clockRow) clockRow.hidden = mode !== "pvp";
    const engineName = "Stockfish · " + (DIFF_NAMES[difficulty] || difficulty);
    const wRole = document.getElementById("white-role");
    const bRole = document.getElementById("black-role");
    if (wRole && bRole) {
      if (mode === "ai") {
        wRole.textContent = humanColor === "w" ? "玩家" : engineName;
        bRole.textContent = humanColor === "b" ? "玩家" : engineName;
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
    Audio2.playMove(mv.color);
    if (mv.promotion) toast("已升变为" + (PROMO_NAMES[mv.promotion] || "后"));
    if (game.in_checkmate()) Audio2.playWin();
    sync();
    saveGame();
    recordGameIfOver();
    maybeEngineTurn();
  }

  function onSquareClick(sq) {
    if (!isLive()) { toast("请先「回到最新一着」再走子"); return; }
    if (game.game_over()) return;
    if (flagFall) { toast("已超时 · 按 N 开新局"); return; }
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
    if (!sanHistory().length || flagFall) return;
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
    game.reset();
    for (const san of h) game.move(san);
    selection = null;
    viewIndex = h.length;
    // continuing a flagged game gets fresh clocks; otherwise time carries on
    if (flagFall) resetClocks();
    sync();
    saveGame();
    toast("已回到第 " + keep + " 着,继续对弈");
    maybeEngineTurn();
  }

  // --- FEN / PGN I/O ---
  async function copyText(text, okMsg) {
    try { await Host.writeClipboard(text); toast(okMsg); }
    catch (_) { toast("复制失败"); }
  }

  function pgnFileName() {
    const d = new Date();
    const p = (n) => String(n).padStart(2, "0");
    return "chess-" + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) +
      p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds()) + ".pgn";
  }

  async function downloadPgn() {
    if (!sanHistory().length) { toast("还没有棋谱可导出"); return; }
    const pgn = game.pgn();
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

  // --- events ---
  canvas.addEventListener("click", (ev) => {
    const rect = canvas.getBoundingClientRect();
    const x = (ev.clientX - rect.left) * (canvas.width / rect.width);
    const y = (ev.clientY - rect.top) * (canvas.height / rect.height);
    const sq = BoardView.cellAt(x, y);
    if (sq) onSquareClick(sq);
  });
  canvas.style.cursor = "pointer";

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
    toast("统计已清零");
  };

  document.getElementById("fen-copy").onclick = () => copyText(viewGame().fen(), "FEN 已复制");
  document.getElementById("pgn-copy").onclick = () => {
    if (!sanHistory().length) { toast("还没有棋谱可复制"); return; }
    copyText(game.pgn(), "PGN 已复制");
  };
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
    mode = b.dataset.mode;
    // flag fall only exists in pvp; entering pvp mid-game gets fresh clocks
    flagFall = null;
    if (mode === "pvp") resetClocks();
    saveSettings();
    sync();
    toast(mode === "ai" ? "人机对弈 · " + (DIFF_NAMES[difficulty] || "") : "双人对弈");
    maybeEngineTurn();
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
    if (ev.key === "ArrowLeft") { ev.preventDefault(); setViewIndex(viewIndex - 1); }
    else if (ev.key === "ArrowRight") { ev.preventDefault(); setViewIndex(viewIndex + 1); }
    else if (ev.key === "Home") { ev.preventDefault(); setViewIndex(0); }
    else if (ev.key === "End") { ev.preventDefault(); setViewIndex(sanHistory().length); }
    else if (ev.key === "Tab") { ev.preventDefault(); togglePanel(); }
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
  // clock preset chosen but no saved clock state → fresh clocks
  if (timeControl !== "off" && !clock) resetClocks();
  BoardView.resizeCanvas();
  renderStats();
  sync();
  saveSettings();
  if (!resumed) saveGame();
  if (mode === "ai" && window.ChessEngine) {
    window.ChessEngine.init().catch(() => toast("引擎初始化失败"));
    maybeEngineTurn(); // resumed save may leave the engine on move
  }

})();
