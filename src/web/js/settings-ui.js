/**
 * 设置页：每个分段、开关和它们背后的处理。
 *
 * v8-0-plan F4 (M2): the settings page's code, carved out of app.js the way
 * library-ui.js was in 7.2 — the view that paints every segment and switch
 * from the store (paintSettings, which app.js still calls syncSettingsUI),
 * the theme, and the handlers behind the controls. Moved, not rewritten: the
 * bodies are the ones app.js had, with those two names changed.
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

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createSettingsUI(d) {
  const {
    doc, store, appEl, t, el, setText, DIFF_NAMES,
    saveSettings, saveGame, toast, sync, draw, resetClocks, parseTc,
    invalidateEngine, maybeEngineTurn, syncAutoFlip, applyLanguage,
    setAnalyzeUI, renderReview, drawEvalCurve, drawEvalBar,
  } = d;
  const document = doc;
  const Audio2 = ChessAudio;
  const BoardView = ChessBoardView;
  const Host = ChessHost;
  const I18n = ChessI18n;
  // 6.0 (v6-plan Q3.6): the system's scheme — the follow switch reads it,
  // and so does app.js at launch
  const schemeMq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;

  function paintSettings() {
    document.querySelectorAll("#theme-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.theme === store.ui.themeId);
    });
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
    if (rowCoordsAt) rowCoordsAt.hidden = !store.ui.coordsOn;
    document.querySelectorAll("#coords-seg button").forEach((b) => b.classList.toggle("active", (b.dataset.coords === "in") === store.ui.coordsInside));
    // the frame narrows with them (styles.css #app[data-coords="in"]); an
    // attribute on #app because the board rect is the layout's, not the canvas's
    appEl.setAttribute("data-coords", store.ui.coordsOn && store.ui.coordsInside ? "in" : "out");
    sw("opt-softmark", store.ui.showSoftMark);
    sw("opt-engine-arrows", store.ui.engineArrows);
    sw("opt-blind", store.ui.blindfold);
    sw("opt-follow", store.ui.followSystem);
    document.querySelectorAll("#text-seg button").forEach((b) => b.classList.toggle("active", b.dataset.text === store.ui.textSize));
    document.querySelectorAll("#pieces-seg button").forEach((b) => b.classList.toggle("active", b.dataset.pieces === store.ui.pieceSet));
    const vol = document.getElementById("opt-volume");
    if (vol && Number(vol.value) !== store.ui.volume) vol.value = String(store.ui.volume);
    const rowVol = document.getElementById("row-volume");
    if (rowVol) rowVol.hidden = !store.ui.soundOn;
    const rowSet = document.getElementById("row-sound-set");
    if (rowSet) rowSet.hidden = !store.ui.soundOn;
    document.querySelectorAll("#sound-set-seg button").forEach((b) => b.classList.toggle("active", b.dataset.soundSet === store.ui.soundSet));
    document.querySelectorAll("#hash-seg button").forEach((b) => b.classList.toggle("active", Number(b.dataset.hash) === store.ui.hash));
    document.querySelectorAll("#multipv-seg button").forEach((b) => b.classList.toggle("active", Number(b.dataset.multipv) === store.ui.multipv));
    document.querySelectorAll("#mode-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.mode === store.session.mode);
    });
    // the first tab holds the lesson or the puzzle in those modes, so it says
    // so — 「对局」 over a lesson read as a page that had not changed
    const playTab = document.getElementById("tab-play");
    if (playTab) {
      playTab.textContent = store.session.mode === "learn" ? t("mode.learn")
        : store.session.mode === "puzzle" ? t("mode.puzzle") : t("tab.play");
    }
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
    document.querySelectorAll("#clock-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.tc === pick.timeControl);
    });
    const diffRow = document.getElementById("row-difficulty");
    const colorRow = document.getElementById("row-color");
    const clockRow = document.getElementById("row-clock");
    if (diffRow) diffRow.hidden = store.session.mode !== "ai";
    const personaRow = document.getElementById("row-persona");
    if (personaRow) personaRow.hidden = store.session.mode !== "ai";
    // in the dialog a two-player game also chooses a side: which one sits at
    // the bottom of the board (「谁执白」) — unless 自动翻转 is on, which
    // turns the board to White the moment the game starts (Codex, #83)
    const pvpPick = !!ng && store.session.mode === "pvp" && !store.ui.autoFlipPvp;
    if (colorRow) {
      colorRow.hidden = store.session.mode !== "ai" && !pvpPick;
      setText(colorRow.querySelector(".setting-k"), t(pvpPick ? "ng.pvpColor" : "side.color"));
    }
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
    // The whole section, not just the fold inside it. Hiding the <details>
    // alone left the <section> standing: 33px of nothing with the group's
    // dividing rule still drawn under it, which on the settings page of the
    // two teaching modes read as a group that had failed to load.
    const foldGame = el("fold-game");
    const teaching = store.session.mode === "learn" || store.session.mode === "puzzle";
    if (foldGame) {
      foldGame.hidden = teaching;
      const sec = foldGame.closest("section");
      if (sec) sec.hidden = teaching;
    }

    const secMoves = document.getElementById("sec-moves");
    const trainer = store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
    if (secMoves) secMoves.hidden = trainer;
    // 统计/历史/成就 used to be hidden in the trainer modes because they sat in
    // the same scroll and got in the way. They now live behind their own tab,
    // which nobody opens by accident — and puzzle badges are earned right there.
    // (Who plays each side is written by renderStrips — 7.7.)
  }

  function applyThemeNow(id) {
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
    paintSettings();
    draw();
  }

  /** Every control on the settings page gets its handler — once, at launch. */
  function wireSettings() {
    document.getElementById("theme-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-theme]");
      if (b) {
        // choosing a theme by hand is the answer to "follow the system?"
        store.ui.followSystem = false;
        applyThemeNow(b.dataset.theme);
      }
    };
    // v7-8-plan §4: inside the new-game dialog a click chooses for the NEXT
    // game — it goes into the draft and nothing on the board changes until
    // 开始. On the settings page the same buttons act at once, as before.
    const draftPick = (field, value) => {
      if (!store.ui.newGame) return false;
      store.ui.newGame[field] = value;
      paintSettings();
      return true;
    };
    document.getElementById("clock-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-tc]");
      if (!b || draftPick("timeControl", b.dataset.tc) || b.dataset.tc === store.game.timeControl) return;
      store.game.timeControl = b.dataset.tc;
      resetClocks();
      saveSettings();
      saveGame();
      store.commit("game", "action");
      const tcSet = parseTc(store.game.timeControl);
    };
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
      langSeg.onclick = (ev) => {
        const b = ev.target.closest("button[data-lang]");
        if (!b || !I18n || b.dataset.lang === store.ui.langId) return;
        const want = b.dataset.lang;
        // v8-0-plan F5: the language's chunk first, then the switch — switched
        // before it arrived, the page would repaint in Chinese fallbacks first.
        // A chunk that cannot load leaves the language as it was.
        ChessLazy.ensureLang(want).then(() => {
          if (store.ui.langId === want) return;
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
    // 6.0 (v6-plan Q3.6): the theme follows the system's scheme while the
    // switch is on — night for dark, day for light — and reacts live
    function applySystemScheme() {
      if (!store.ui.followSystem || !schemeMq) return;
      const want = schemeMq.matches ? "night" : "day";
      if (store.ui.themeId !== want) applyThemeNow(want);
    }
    if (schemeMq && schemeMq.addEventListener) schemeMq.addEventListener("change", applySystemScheme);
    document.getElementById("opt-follow").onclick = () => {
      store.ui.followSystem = !store.ui.followSystem;
      saveSettings();
      paintSettings();
      applySystemScheme();
    };
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
    document.getElementById("pieces-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-pieces]");
      if (!b) return;
      store.ui.pieceSet = b.dataset.pieces;
      saveSettings();
      paintSettings();
      BoardView.setPieceSet(store.ui.pieceSet);
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
    // 6.0 (v6-plan Q2.6): the engine knobs
    if (ChessEngine && ChessEngine.setOptions) ChessEngine.setOptions({ hash: store.ui.hash });
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

  return { sync: paintSettings, applyTheme: applyThemeNow, wire: wireSettings, schemeMq };
}
