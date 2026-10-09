/**
 * 设置页：每个分段、开关和它们背后的处理。
 *
 * v8-0-plan F4 (M2): the settings page's code, carved out of app.js the way
 * library-ui.js was in 7.2 — the view that paints every segment and switch
 * from the store (paintSettings, which app.js still calls syncSettingsUI),
 * the look, and the handlers behind the controls. Moved, not rewritten: the
 * bodies are the ones app.js had, with those two names changed. The look is
 * v8-0-plan A3's applyLook (look.js); its pickers are appearance-ui.js,
 * mounted in the preferences window (prefs-ui.js), and painted from here
 * through `syncLook`.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createSettingsUI()`; nothing here reaches back into app.js. The pure
 * modules are imported, not passed, because they are the same objects
 * app.js imports (patching ChessEngine through the test seam patches this
 * file's copy too).
 * @module settings-ui
 */
import { ChessAudio } from "./audio.js";
import { ChessBoardView } from "./board.js";
import { ChessEngine } from "./engine.js";
import { ChessHost } from "./host.js";
import { ChessI18n } from "./i18n.js";
import { ChessLazy } from "./lazy-content.js";
import { lookAttrs } from "./look.js";
import { TimeControl } from "./time-control.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createSettingsUI(d) {
  const {
    doc, store, appEl, t, setText,
    saveSettings, saveGame, toast, sync, draw, resetClocks,
    invalidateEngine, maybeEngineTurn, syncAutoFlip, applyLanguage,
    setAnalyzeUI, renderReview, drawEvalCurve, drawEvalBar, syncLook, onPaint,
  } = d;
  const document = doc;
  const Audio2 = ChessAudio;
  const BoardView = ChessBoardView;
  const Host = ChessHost;
  const I18n = ChessI18n;
  // 6.0 (v6-plan Q3.6): the system's scheme — the 跟随系统 appearance
  // (v8-0-plan A3, the default) follows it live
  const schemeMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function paintSettings() {
    if (syncLook) syncLook();
    // v8-0-plan B4: the persona cards beside these rows (opponents-ui.js) repaint with them
    if (onPaint) onPaint();
    const sb = document.getElementById("opt-sound");
    if (sb) {
      sb.classList.toggle("active", store.ui.soundOn);
      sb.setAttribute("aria-pressed", store.ui.soundOn ? "true" : "false");
    }
    const sw = (id, on) => {
      const b = document.getElementById(id);
      if (!b) return;
      b.classList.toggle("active", !!on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    };
    sw("opt-coords", store.ui.coordsOn);
    // where they are printed only matters while they are printed at all
    const rowCoordsAt = document.getElementById("row-coords-at");
    // …and only on the wooden frame: a flat board has no frame to print on,
    // so there they are always in the squares (v8-0-plan A3)
    const framed = store.ui.boardFrame === "frame";
    if (rowCoordsAt) rowCoordsAt.hidden = !store.ui.coordsOn || !framed;
    document.querySelectorAll("#coords-seg button").forEach((b) => b.classList.toggle("active", (b.dataset.coords === "in") === store.ui.coordsInside));
    // the frame narrows with them (styles.css #app[data-coords="in"]); an
    // attribute on #app because the board rect is the layout's, not the canvas's
    appEl.setAttribute("data-coords", store.ui.coordsOn && (store.ui.coordsInside || !framed) ? "in" : "out");
    sw("opt-softmark", store.ui.showSoftMark);
    sw("opt-engine-arrows", store.ui.engineArrows);
    sw("opt-blind", store.ui.blindfold);
    document.querySelectorAll("#text-seg button").forEach((b) => b.classList.toggle("active", b.dataset.text === store.ui.textSize));
    const vol = document.getElementById("opt-volume");
    if (vol && Number(vol.value) !== store.ui.volume) vol.value = String(store.ui.volume);
    const rowVol = document.getElementById("row-volume");
    if (rowVol) rowVol.hidden = !store.ui.soundOn;
    const rowSet = document.getElementById("row-sound-set");
    if (rowSet) rowSet.hidden = !store.ui.soundOn;
    document.querySelectorAll("#sound-set-seg button").forEach((b) => b.classList.toggle("active", b.dataset.soundSet === store.ui.soundSet));
    document.querySelectorAll("#hash-seg button").forEach((b) => b.classList.toggle("active", Number(b.dataset.hash) === store.ui.hash));
    // the engine's knobs follow the store here, not at wire time: wiring runs
    // before loadSettings(), so a saved Hash reached the engine only when its
    // segment was clicked again (found by v8-1-plan F4, whose `bgWorker` —
    // no control, a setting in the file, off by default — rides along).
    // setOptions() is a no-op for unchanged values.
    if (ChessEngine && ChessEngine.setOptions) ChessEngine.setOptions({ hash: store.ui.hash, bgWorker: store.ui.bgWorker === true });
    document.querySelectorAll("#multipv-seg button").forEach((b) => b.classList.toggle("active", Number(b.dataset.multipv) === store.ui.multipv));
    // v8-0-plan A1: the segment is the new-game dialog's, and shows its draft
    const ngMode = store.ui.newGame ? store.ui.newGame.mode : store.session.mode;
    document.querySelectorAll("#mode-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === ngMode);
    });
    // two rows now: sparring tiers and engine-strength tiers (see index.html)
    // While the new-game dialog is open (v7-8-plan §4) these rows are in it
    // and show its draft — what the next game will be — not the game on the
    // board; closing the dialog drops the draft and they read the store again.
    const ng = store.ui.newGame;
    const pick = ng || {
      difficulty: store.session.difficulty, personaId: store.session.personaId,
      color: store.session.humanColor, timeControl: store.game.timeControl,
    };
    document.querySelectorAll("#diff-seg button, #diff-seg-engine button").forEach((b) => {
      b.classList.toggle("active", b.dataset.diff === pick.difficulty);
    });
    document.querySelectorAll("#persona-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.persona === pick.personaId);
    });
    document.querySelectorAll("#color-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.color === pick.color);
      // 随机 is a way to start a game, not a side to switch to mid-game
      if (b.dataset.color === "random") b.hidden = !ng;
    });
    document.querySelectorAll("#orient-seg button").forEach((b) => {
      b.classList.toggle("active", (b.dataset.orient === "b") === !!store.game.flipped);
    });
    // v8-0-plan B4: 自定义 is lit by any c<min>+<inc> id, and shows its numbers
    const custom = TimeControl.isCustom(pick.timeControl);
    // 9.0 S2: the four common clocks, and the rest under 更多选项
    document.querySelectorAll("#clock-seg button, #clock-seg-more button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tc === pick.timeControl || (custom && b.dataset.tc === "custom"));
    });
    const customRow = document.getElementById("clock-custom");
    if (customRow && customRow.hidden === custom) customRow.hidden = !custom;
    if (custom) {
      const tc = TimeControl.parse(pick.timeControl);
      for (const [id, v] of [["tc-min", tc.base / 60], ["tc-inc", tc.inc]]) {
        const inp = document.getElementById(id);
        // never under the caret: a value rewritten while it is being typed
        if (inp && document.activeElement !== inp && Number(inp.value) !== v) inp.value = String(v);
      }
    }
    const diffRow = document.getElementById("row-difficulty");
    const colorRow = document.getElementById("row-color");
    const clockRow = document.getElementById("row-clock");
    if (diffRow) diffRow.hidden = ngMode !== "ai";
    const personaRow = document.getElementById("row-persona");
    if (personaRow) personaRow.hidden = ngMode !== "ai";
    // in the dialog a two-player game also chooses a side: which one sits at
    // the bottom of the board (「谁执白」) — unless 自动翻转 is on, which
    // turns the board to White the moment the game starts (Codex, #83)
    const pvpPick = !!ng && ngMode === "pvp" && !store.ui.autoFlipPvp;
    if (colorRow) {
      colorRow.hidden = ngMode !== "ai" && !pvpPick;
      setText(colorRow.querySelector(".setting-k"), t(pvpPick ? "ng.pvpColor" : "side.color"));
    }
    if (clockRow) clockRow.hidden = ngMode !== "pvp" && ngMode !== "ai";
    const moreClocks = document.getElementById("row-clock-more");
    if (moreClocks && clockRow) moreClocks.hidden = clockRow.hidden;
    const coachSwitch = document.getElementById("opt-coach");
    if (coachSwitch) coachSwitch.setAttribute("aria-pressed", store.session.coachOn ? "true" : "false");
    const flipSwitch = document.getElementById("opt-autoflip");
    if (flipSwitch) flipSwitch.setAttribute("aria-pressed", store.ui.autoFlipPvp ? "true" : "false");
    // the reading modes get a wider column — see styles.css [data-mode]
    appEl.setAttribute("data-mode", store.session.mode);

    const secMoves = document.getElementById("sec-moves");
    const trainer = store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
    if (secMoves) secMoves.hidden = trainer;
    // 统计/历史/成就 used to be hidden in the trainer modes because they sat in
    // the same scroll and got in the way. They now live behind their own tab,
    // which nobody opens by accident — and puzzle badges are earned right there.
    // (Who plays each side is written by renderStrips — 7.7.)
  }

  /**
   * Put the look on the page (v8-0-plan A3): the shell, the board and the
   * frame as three attributes (look.js lookAttrs), the piece set on the
   * board. `patch` is a change from the pickers, saved; without one this is
   * the boot pass or the system turning dark, and nothing is written.
   */
  function applyLook(patch) {
    if (patch) Object.assign(store.ui, patch);
    const dark = !!(schemeMq && schemeMq.matches);
    const at = lookAttrs(store.ui, dark);
    const root = document.documentElement;
    const reframed = root.getAttribute("data-frame") !== at.frame;
    root.setAttribute("data-theme", at.theme);
    root.setAttribute("data-board", at.board);
    root.setAttribute("data-frame", at.frame);
    BoardView.setPieceSet(store.ui.pieceSet);
    // the board reads its square colours from the same variables, and caches
    // them — the cache is only ever stale here
    if (BoardView.invalidatePaint) BoardView.invalidatePaint();
    if (!patch) return;
    saveSettings();
    paintSettings();
    draw();
    // the frame's 17px come and go with it: the canvas takes the new size
    if (reframed) requestAnimationFrame(() => { BoardView.resizeCanvas(); draw(); });
  }

  /** Every control on the settings page gets its handler — once, at launch. */
  function wireSettings() {
    // v7-8-plan §4: inside the new-game dialog a click chooses for the NEXT
    // game — it goes into the draft and nothing on the board changes until
    // 开始. On the settings page the same buttons act at once, as before.
    const draftPick = (field, value) => {
      if (!store.ui.newGame) return false;
      store.ui.newGame[field] = value;
      paintSettings();
      return true;
    };
    // v8-0-plan A1: 人机 / 双人 is chosen with the next game, in the dialog
    document.getElementById("mode-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-mode]");
      if (b) draftPick("mode", b.dataset.mode);
    };
    const pickTc = (tc) => {
      if (draftPick("timeControl", tc) || tc === store.game.timeControl) return;
      store.game.timeControl = tc;
      resetClocks();
      saveSettings();
      saveGame();
      store.commit("game", "action");
    };
    // v8-0-plan B4: 自定义 is the control the two numbers beside it say
    const customTc = () => TimeControl.customId(document.getElementById("tc-min").value,
      document.getElementById("tc-inc").value);
    const onClock = (ev) => {
      const b = ev.target.closest("button[data-tc]");
      if (b) pickTc(b.dataset.tc === "custom" ? customTc() : b.dataset.tc);
    };
    for (const id of ["clock-seg", "clock-seg-more"]) document.getElementById(id).onclick = onClock;
    for (const id of ["tc-min", "tc-inc"]) {
      const inp = document.getElementById(id);
      if (inp) inp.onchange = () => { pickTc(customTc()); paintSettings(); };
    }
    const onDiffClick = (ev) => {
      const b = ev.target.closest("button[data-diff]");
      if (!b || draftPick("difficulty", b.dataset.diff) || b.dataset.diff === store.session.difficulty) return;
      store.session.difficulty = b.dataset.diff;
      saveSettings();
      store.commit("session", "sync");
    };
    document.getElementById("diff-seg").onclick = onDiffClick;
    const diffEngineSeg = document.getElementById("diff-seg-engine");
    if (diffEngineSeg) diffEngineSeg.onclick = onDiffClick;
    document.getElementById("persona-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-persona]");
      if (!b || draftPick("personaId", b.dataset.persona) || b.dataset.persona === store.session.personaId) return;
      store.session.personaId = b.dataset.persona;
      saveSettings();
      store.commit("session", "sync");
    };
    document.getElementById("color-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-color]");
      if (!b || draftPick("color", b.dataset.color) || !["w", "b"].includes(b.dataset.color)) return;
      // a side picked here is a side: 随机 from the last new game is over (Codex, #83)
      if (store.session.colorRandom) { store.session.colorRandom = false; saveSettings(); }
      if (b.dataset.color === store.session.humanColor) { sync(); return; }
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
      let langAsked = null;   // the latest pick wins over a chunk still loading (Codex on #85)
      langSeg.onclick = (ev) => {
        const b = ev.target.closest("button[data-lang]");
        if (!b || !I18n || (langAsked = b.dataset.lang) === store.ui.langId) return;
        const want = b.dataset.lang;
        // v8-0-plan F5: the language's chunk first, then the switch — switched
        // before it arrived, the page would repaint in Chinese fallbacks first.
        // A chunk that cannot load leaves the language as it was.
        ChessLazy.ensureLang(want).then(() => {
          if (langAsked !== want || store.ui.langId === want) return;
          store.ui.langId = I18n.setLang(want);
          saveSettings();
          applyLanguage();
          // the native menu is built at launch from a per-language table; the
          // shell records the choice and applies it on the next start (Q1.6)
          Host.setMenuLanguage(store.ui.langId.split("-")[0]).then((r) => {
            if (r && r.restartRequired) toast(t("msg.menuLang.restart"));
          }).catch(() => {});
        }).catch(() => {});
      };
    }
    document.getElementById("opt-coach").onclick = () => {
      store.session.coachOn = !store.session.coachOn;
      saveSettings();
      paintSettings();
      toast(store.session.coachOn ? t("msg.coach.on") : t("msg.coach.off"));
    };
    document.getElementById("opt-autoflip").onclick = () => {
      store.ui.autoFlipPvp = !store.ui.autoFlipPvp;
      if (syncAutoFlip()) draw();
      saveSettings();
      paintSettings();
      toast(store.ui.autoFlipPvp ? t("msg.autoflip.on") : t("msg.autoflip.off"));
    };
    document.getElementById("opt-sound").onclick = () => {
      store.ui.soundOn = !store.ui.soundOn;
      saveSettings();
      paintSettings();
      if (store.ui.soundOn) Audio2.playMove("w");
      toast(store.ui.soundOn ? t("msg.sound.on") : t("msg.sound.off"));
    };
    // 6.0 (v6-plan Q2.8): volume, coordinates, blindfold
    Audio2.setVolume(store.ui.volume / 100);
    const volEl = document.getElementById("opt-volume");
    if (volEl) {
      volEl.oninput = () => {
        store.ui.volume = Math.max(0, Math.min(100, Number(volEl.value) || 0));
        Audio2.setVolume(store.ui.volume / 100);
      };
      // one save and one sample per release of the slider, not one per pixel
      volEl.onchange = () => { saveSettings(); if (store.ui.soundOn) Audio2.playMove("w"); };
    }
    // 7.7 (v7-7-plan §8): wood or classic, with a sample of the one just picked
    document.getElementById("sound-set-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-sound-set]");
      if (!b) return;
      Audio2.setSoundSet(store.ui.soundSet = b.dataset.soundSet);
      saveSettings();
      paintSettings();
      Audio2.playMove("w");
    };
    // 6.0 (v6-plan Q3.6): the appearance follows the system's scheme — since
    // v8-0-plan A3 as its default, 跟随系统 — and reacts live
    if (schemeMq && schemeMq.addEventListener) {
      schemeMq.addEventListener("change", () => {
        if (store.ui.appearance !== "system") return;
        applyLook();
        draw();
      });
    }
    function applyTextSize() {
      document.documentElement.setAttribute("data-text", store.ui.textSize);
      // the board is sized from its container, which the type size can move
      requestAnimationFrame(() => { BoardView.resizeCanvas(); draw(); drawEvalCurve(); drawEvalBar(); });
    }
    document.getElementById("text-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-text]");
      if (!b) return;
      store.ui.textSize = b.dataset.text;
      saveSettings();
      paintSettings();
      applyTextSize();
    };
    document.getElementById("opt-coords").onclick = () => {
      store.ui.coordsOn = !store.ui.coordsOn;
      saveSettings();
      paintSettings();
      draw();
    };
    document.getElementById("coords-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-coords]");
      if (!b || (b.dataset.coords === "in") === store.ui.coordsInside) return;
      store.ui.coordsInside = b.dataset.coords === "in";
      saveSettings();
      paintSettings();
      draw();
    };
    document.getElementById("opt-engine-arrows").onclick = () => {
      store.ui.engineArrows = !store.ui.engineArrows;
      saveSettings();
      paintSettings();
      draw();
    };
    document.getElementById("opt-softmark").onclick = () => {
      store.ui.showSoftMark = !store.ui.showSoftMark;
      saveSettings();
      paintSettings();
      // the move list keys its repaint on each node's tag, and the report
      // prints the counts, so both have to be asked again
      store.commit("game", "action");
      renderReview();
    };
    document.getElementById("opt-blind").onclick = () => {
      store.ui.blindfold = !store.ui.blindfold;
      saveSettings();
      paintSettings();
      draw();
      toast(store.ui.blindfold ? t("msg.blind.on") : t("msg.blind.off"));
    };
    // 6.0 (v6-plan Q2.6): the engine knobs (handed over in paintSettings)
    document.getElementById("hash-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-hash]");
      if (!b) return;
      store.ui.hash = Number(b.dataset.hash);
      if (ChessEngine && ChessEngine.setOptions) ChessEngine.setOptions({ hash: store.ui.hash });
      saveSettings();
      paintSettings();
    };
    document.getElementById("multipv-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-multipv]");
      if (!b) return;
      store.ui.multipv = Number(b.dataset.multipv);
      saveSettings();
      paintSettings();
      setAnalyzeUI();
    };
  }

  return { sync: paintSettings, applyLook, wire: wireSettings };
}
