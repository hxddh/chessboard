(function () {

  const Host = window.ChessHost;
  const BoardView = window.ChessBoardView;
  const Audio2 = window.ChessAudio;

  const SAVE_KEY = "chess.v1.save";
  const SETTINGS_KEY = "chess.v1.settings";
  const PANEL_KEY = "chess.panelOpen";

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
    } catch (_) {}
  }
  function saveSettings() {
    try {
      Host.storageSet(SETTINGS_KEY, JSON.stringify({ soundOn, flipped, themeId }));
    } catch (_) {}
  }
  function saveGame() {
    try {
      Host.storageSet(SAVE_KEY, JSON.stringify({ v: 1, pgn: game.pgn(), savedAt: Date.now() }));
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
      return sanHistory().length > 0;
    } catch (_) {
      return false;
    }
  }

  // --- game flow ---
  function statusText() {
    const g = viewGame();
    if (!isLive()) return "复盘 " + viewIndex + "/" + sanHistory().length;
    if (g.in_checkmate()) return g.turn() === "w" ? "黑方将死获胜" : "白方将死获胜";
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
      for (const j of [i, i + 1]) {
        if (j >= h.length) break;
        const b = document.createElement("button");
        b.type = "button";
        b.dataset.i = String(j + 1);
        b.textContent = h[j];
        b.className = "mlmove" + (viewIndex === j + 1 ? " current" : "");
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
    document.getElementById("undo").disabled = h.length === 0 || !isLive();
    document.getElementById("pgn-copy").disabled = h.length === 0;
    document.getElementById("pgn-download").disabled = h.length === 0;
    document.getElementById("fen-copy").disabled = false;
    const status = document.getElementById("status");
    const g = viewGame();
    status.classList.toggle("win", isLive() && g.in_checkmate());
    status.classList.toggle("replay", !isLive());
    document.getElementById("white-turn").hidden = !(isLive() && !game.game_over() && game.turn() === "w");
    document.getElementById("black-turn").hidden = !(isLive() && !game.game_over() && game.turn() === "b");
    renderMoveList();
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
  }

  function setViewIndex(n) {
    viewIndex = Math.max(0, Math.min(n, sanHistory().length));
    selection = null;
    sync();
  }

  function goLive() { setViewIndex(sanHistory().length); }

  function onSquareClick(sq) {
    if (!isLive()) { toast("请先「回到最新一手」再走子"); return; }
    if (game.game_over()) return;
    const piece = game.get(sq);
    if (selection && selection.targets.includes(sq)) {
      // promotions always queen in v0.1 (chooser is on the roadmap)
      const mv = game.move({ from: selection.sq, to: sq, promotion: "q" });
      if (mv) {
        selection = null;
        viewIndex = sanHistory().length;
        Audio2.playMove(mv.color);
        if (mv.promotion) toast("已升变为后");
        if (game.in_checkmate()) Audio2.playWin();
        sync();
        saveGame();
      }
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
    if (!sanHistory().length) return;
    if (!isLive()) { goLive(); return; }
    game.undo();
    selection = null;
    viewIndex = sanHistory().length;
    sync();
    saveGame();
  }

  async function requestNewGame() {
    if (sanHistory().length &&
        !(await confirmNative("开始新局将清空当前对局，是否继续？", "新局", { ok: "新局", cancel: "取消" }))) {
      return;
    }
    game.reset();
    selection = null;
    viewIndex = 0;
    sync();
    saveGame();
    toast("新局开始 · 白先");
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
    game.load_pgn(t, { sloppy: true });
    selection = null;
    viewIndex = sanHistory().length;
    sync();
    saveGame();
    toast("已导入 " + sanHistory().length + " 手");
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
  document.getElementById("rep-live").onclick = () => { goLive(); toast("已回到最新一手"); };

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
    game.reset();
    selection = null;
    viewIndex = 0;
    sync();
    toast("存档已清除");
  };

  const confirmModal = document.getElementById("confirm-modal");
  document.getElementById("confirm-ok").onclick = () => finishConfirm(true);
  document.getElementById("confirm-cancel").onclick = () => finishConfirm(false);
  confirmModal.onclick = (ev) => { if (ev.target === confirmModal) finishConfirm(false); };

  window.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") {
      if (confirmModal.classList.contains("show")) { finishConfirm(false); return; }
      if (isPanelOpen()) setPanelOpen(false);
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
    else if (k === "f" && !ev.metaKey && !ev.ctrlKey) {
      flipped = !flipped; saveSettings(); draw();
    }
  });

  window.addEventListener("resize", () => {
    appEl.classList.toggle("scrim-on", isPanelOpen() && window.innerWidth < 900);
    BoardView.resizeCanvas();
    draw();
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
  BoardView.resizeCanvas();
  sync();
  saveSettings();
  if (!resumed) saveGame();

})();
