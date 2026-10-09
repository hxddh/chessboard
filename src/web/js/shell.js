/**
 * 顶层导航与首页：左侧窄栏（宽窗）或顶栏（窄窗），以及三张卡的首页。
 *
 * v8-0-plan A1. Until now the app had no top level: the mode was a segment
 * on the settings page (index.html's #sec-mode), the library and its
 * diagnosis were ~460px dialogs, and 统计 / 棋谱库 / 开局书 / 对局历史 / 成就
 * were stacked in the 400px side panel under 记录. This is the level above
 * all of that — seven views, one of them showing at a time:
 *
 *   home     首页: 继续上次 / 今天的训练 / 下一步建议
 *   play     下棋: the board with the panel — the geometry players know
 *   puzzle   谜题: the same board view, in the puzzle mode
 *   learn    学习: the same board view, in the lesson mode
 *   library  棋谱库: a page — the library, its diagnosis, the opening book
 *   me       我的: a page — statistics, history, achievements
 *   settings 设置: a page — the one place settings live (9.0 S5)
 *
 * The three board views are the one stage in three modes, so the board's
 * rect is the same in all of them (test-layout-e2e). The two pages lie over
 * the stage rather than replacing it: the board keeps its size underneath,
 * and coming back to it moves nothing.
 *
 * The view follows the mode, not the other way round: every path that
 * changes the mode (the daily plan, 接着练, a lesson's graduation, the
 * onboarding) lands on the matching board view through onSession(), so none
 * of them had to learn about views. Everything it needs from app.js arrives
 * in the bag handed to createShell() (createLibraryUI's shape).
 * @module shell
 */
import { ChessDialog } from "./dialog.js";
import { ChessBoardView } from "./board.js";

/** The views, in the rail's order; `home` is the rail's head. */
export const SHELL_VIEWS = ["home", "play", "puzzle", "learn", "library", "me", "settings"];
/** The views that are pages over the stage, and the page each one shows. */
const PAGES = { home: "page-home", library: "page-library", me: "page-me", settings: "page-settings" };
/** 9.0 S5: the settings page's categories, in the list's order. */
export const SETTING_CATS = ["general", "board", "sound", "game", "data", "advanced"];

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createShell(d) {
  const {
    doc, store, appEl, t, tf, switchMode, saveSettings, requestNewGame, onSettings,
    sanHistory, gameOver, recommendation, nextLesson, owed, dailyPlan, dailyStepLabel, dailyJump, onMe,
  } = d;
  const Dlg = ChessDialog;
  const rail = doc.getElementById("rail");
  const railBtns = () => (rail ? [...rail.querySelectorAll("button[data-view]")] : []);

  const isPage = (v) => Object.prototype.hasOwnProperty.call(PAGES, v);
  /** The board view the current mode belongs to. */
  function boardView() {
    const m = store.session.mode;
    return m === "learn" || m === "puzzle" ? m : "play";
  }

  // before the first show() at launch, nothing is showing yet: the restored
  // view is not the flows' to change (restore() paints it)
  const shown = () => appEl.hasAttribute("data-view");
  /**
   * Paint `view` — the rail's current entry, the page on top (or none), and
   * which half of the window is live. No state is changed but the view's.
   */
  function show(view) {
    const want = SHELL_VIEWS.includes(view) ? view : "play";
    store.ui.view = want;
    appEl.setAttribute("data-view", want);
    // v8-2-plan F3: the board is drawn when it is uncovered, not under a page
    ChessBoardView.cover(appEl.classList.toggle("page-on", isPage(want)));
    for (const b of railBtns()) {
      if (b.dataset.view === want) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    }
    // Focus inside a page that is about to be hidden (a home card worked from
    // the keyboard, a sheet that hands focus back to its opener) would sit in
    // a display:none subtree, with nothing visible to go on from. It goes to
    // the rail's entry for where the player went instead (Codex on #86).
    const had = doc.activeElement;
    for (const [v, id] of Object.entries(PAGES)) {
      const page = doc.getElementById(id);
      if (!page) continue;
      if (v !== want && had && page.contains(had)) {
        const to = railBtns().find((b) => b.dataset.view === want);
        if (to) to.focus();
      }
      page.hidden = v !== want;
    }
    // Under a page the board and the panel are still laid out (so nothing
    // moves when the page goes), but they are not there for the keyboard or
    // a screen reader: the stage, the panel and the bar go inert.
    for (const sel of [".stage", "#side", ".chrome", "#task-strip"]) {
      const n = doc.querySelector(sel);
      if (!n) continue;
      if (isPage(want)) n.setAttribute("inert", "");
      else if (sel !== "#side" || appEl.classList.contains("panel-open")) n.removeAttribute("inert");
    }
    if (want === "home") renderHome();
    // 我的 draws its charts at the width it opens at (me-page.js, v8-0-plan B5)
    else if (want === "me" && onMe) onMe();
    else if (want === "settings") showCat(store.ui.setCat);
  }

  /**
   * Go to `view`: the one door the rail, the home cards and the app use.
   * A board view puts its mode on the board first (switchMode is the old
   * mode segment's handler: it stops the engine, leaves the editor, resets
   * the clocks); a page leaves the mode alone.
   */
  function go(view) {
    // a sheet over the library page (the game list, the diagnosis, the
    // history) belongs to the page it was opened from
    while (closeSheet()) { /* one sheet per pass */ }
    if (view === "play" && boardView() !== "play") switchMode(store.ui.playMode === "pvp" ? "pvp" : "ai");
    else if ((view === "puzzle" || view === "learn") && store.session.mode !== view) switchMode(view);
    show(view);
    saveSettings();
  }
  /** Close the topmost dialog if it is one of the page sheets. */
  function closeSheet() {
    const open = [...doc.querySelectorAll(".modal-bg.page-sheet.show")];
    if (!open.length) return false;
    return Dlg.closeTop();
  }

  /** Leave a page for the board, keeping the mode (app.js's setSideTab). */
  function toBoard() {
    if (!shown() || !isPage(store.ui.view)) return;
    show(boardView());
    // saved, as go() saves: a flow that leaves a page for the board (an
    // import, a history or library game) is where the app reopens next
    // (Codex on #86)
    saveSettings();
  }

  /** At launch: the page that was open, or the board of the restored mode. */
  function restore() {
    show(isPage(store.ui.view) ? store.ui.view : boardView());
  }

  /**
   * A session commit: the mode may have changed under a board view. The
   * view follows it, and the last playing mode is remembered for 下棋.
   */
  /**
   * A game commit: 首页 reads the game (继续上次's move count, whether it is
   * over), so an open home page follows it — an engine reply or a finished
   * game lands while it is showing (Codex on #86).
   */
  function onGame() {
    if (shown() && store.ui.view === "home") renderHome();
  }

  function onSession() {
    const m = store.session.mode;
    if (m === "ai" || m === "pvp") store.ui.playMode = m;
    if (!shown()) return;
    if (!isPage(store.ui.view) && store.ui.view !== boardView()) show(boardView());
    else if (store.ui.view === "home") renderHome();
  }

  // --- the panel -----------------------------------------------------------
  //
  // 9.0 S5: the panel is one page again. Its 设置 tab went to the settings
  // page (the opponent, the side and the clock to the new-game dialog), and
  // with one pane left the tab row went with it. The name stays for the
  // flows that call it: "show the board, with the panel at its top".
  function setSideTab(_id, opts) {
    toBoard();
    const pane = doc.getElementById("pane-play");
    if (pane && opts && opts.top) pane.scrollTop = 0;
  }

  // --- 设置 -------------------------------------------------------------------
  //
  // Six categories down the left, one shown on the right (Apple HIG's
  // settings window; v9-0-plan S5). Which one was open is remembered, so ⌘,
  // goes back to where the player was.
  function showCat(cat) {
    const want = SETTING_CATS.includes(cat) ? cat : "general";
    store.ui.setCat = want;
    for (const c of SETTING_CATS) {
      const tab = doc.getElementById("cat-" + c);
      const pane = doc.getElementById("set-" + c);
      const on = c === want;
      if (tab) {
        tab.setAttribute("aria-selected", on ? "true" : "false");
        tab.tabIndex = on ? 0 : -1;
      }
      if (pane) pane.hidden = !on;
    }
    if (onSettings) onSettings(want);
  }

  function wireCats() {
    const list = doc.querySelector(".set-cats");
    if (!list) return;
    list.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[data-cat]");
      if (!b) return;
      showCat(b.dataset.cat);
      saveSettings();
    });
    // a vertical tablist: up and down walk it, Home / End jump to its ends
    list.addEventListener("keydown", (ev) => {
      const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
      if (!keys.includes(ev.key)) return;
      const i = SETTING_CATS.indexOf(store.ui.setCat);
      const n = SETTING_CATS.length;
      const back = ev.key === "ArrowUp" || ev.key === "ArrowLeft";
      const j = ev.key === "Home" ? 0 : ev.key === "End" ? n - 1 : (i + (back ? n - 1 : 1)) % n;
      ev.preventDefault();
      ev.stopPropagation();
      showCat(SETTING_CATS[j]);
      saveSettings();
      const b = doc.getElementById("cat-" + SETTING_CATS[j]);
      if (b) b.focus();
    });
  }

  // --- 首页 ------------------------------------------------------------------

  /** A card's body text and its one button, written only when they differ. */
  function fill(id, lines, label, action) {
    const card = doc.getElementById(id);
    if (!card) return;
    const body = card.querySelector(".home-body");
    const btn = card.querySelector(".home-go");
    const sig = lines.join("\u0001") + "|" + label;
    if (body && body.dataset.sig !== sig) {
      body.dataset.sig = sig;
      body.replaceChildren(...lines.map((s) => {
        const p = doc.createElement("p");
        p.className = "home-line";
        p.textContent = s;
        return p;
      }));
    }
    // 7.6: relabelled in place, never rebuilt — the button may be under a press
    if (btn) {
      if (btn.textContent !== label) btn.textContent = label;
      btn.onclick = action;
    }
  }

  function renderHome() {
    // 继续上次: where the board was left — a lesson, a puzzle or a game
    const m = store.session.mode;
    const n = sanHistory().length;
    if (m === "learn") {
      fill("home-continue", [t("home.cont.learn")], t("home.cont.go"), () => go("learn"));
    } else if (m === "puzzle") {
      fill("home-continue", [t("home.cont.puzzle")], t("home.cont.go"), () => go("puzzle"));
    } else if (n && !gameOver()) {
      fill("home-continue", [tf("home.cont.live", [t(m === "pvp" ? "mode.pvp" : "mode.ai"), Math.ceil(n / 2)])],
        t("home.cont.go"), () => go("play"));
    } else if (n) {
      fill("home-continue", [t("home.cont.over")], t("home.cont.review"), () => go("play"));
    } else {
      fill("home-continue", [t("home.cont.none")], t("chrome.new"), () => { go("play"); requestNewGame(); });
    }
    // 今天的训练: the planner's steps, and the same button as the panel's card
    const running = store.session.daily;
    const steps = running ? running.steps.slice(running.i) : dailyPlan();
    if (!steps.length) {
      fill("home-daily", [t("daily.rest")], t("nav.puzzle"), () => go("puzzle"));
    } else {
      fill("home-daily", steps.slice(0, 3).map((s, i) => (i + 1) + ". " + dailyStepLabel(s)),
        running ? tf("daily.of", [running.i + 1, running.steps.length]) : t("home.daily.go"),
        // the panel card's own handler: it jumps to the step, and the jump
        // lands on the step's view (toBoard / go("library"))
        () => { const b = doc.getElementById("daily-btn"); if (b) b.click(); });
    }
    // 下一步建议: the coach's sentence when it has one, and a concrete step
    const said = recommendation();
    const lesson = nextLesson();
    const due = owed();
    const lines = said ? [said] : [];
    // The button opens what the card names — the daily plan's own jump, so
    // the lesson is that lesson (not the last one visited) and the review is
    // the 错题 category (not whichever one was open) (Codex on #86)
    if (lesson) {
      lines.push(tf("home.next.lesson", [lesson.n, lesson.title]));
      fill("home-next", lines, t("home.next.learn"), () => dailyJump({ kind: "lesson", i: lesson.i }));
    } else if (due) {
      lines.push(tf("home.next.review", [due]));
      fill("home-next", lines, t("nav.puzzle"), () => dailyJump({ kind: "review" }));
    } else {
      lines.push(t("home.next.smart"));
      fill("home-next", lines, t("pz.smart"), () => {
        go("puzzle");
        const b = doc.getElementById("puzzle-smart");
        if (b) b.click();
      });
    }
  }

  // --- wiring ----------------------------------------------------------------

  const isMac = /Mac|iPhone|iPad/.test((typeof navigator !== "undefined" && (navigator.platform || navigator.userAgent)) || "");

  function wire() {
    wireCats();
    if (rail) {
      rail.addEventListener("click", (ev) => {
        const b = ev.target.closest("button");
        if (b && b.dataset.view) go(b.dataset.view);
      });
      // A column of links on a wide window, a row on a narrow one: both
      // arrow pairs walk it, Home / End jump to its ends. The keys stop
      // here — on the window they would step through the game.
      rail.addEventListener("keydown", (ev) => {
        const keys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End"];
        if (!keys.includes(ev.key)) return;
        const all = [...rail.querySelectorAll("button")];
        const i = all.indexOf(doc.activeElement);
        if (i < 0) return;
        ev.preventDefault();
        ev.stopPropagation();
        const back = ev.key === "ArrowUp" || ev.key === "ArrowLeft";
        const j = ev.key === "Home" ? 0 : ev.key === "End" ? all.length - 1
          : (i + (back ? all.length - 1 : 1)) % all.length;
        all[j].focus();
      });
    }
    // ⌘, on macOS, Ctrl+, elsewhere — every desktop app's settings key
    // (design review #10). Capture phase: a focused control must not eat it.
    doc.defaultView.addEventListener("keydown", (ev) => {
      if (ev.key !== "," || ev.altKey || ev.shiftKey) return;
      if (!(isMac ? ev.metaKey && !ev.ctrlKey : ev.ctrlKey && !ev.metaKey)) return;
      ev.preventDefault();
      ev.stopPropagation();
      go("settings");
    }, true);
  }

  return {
    go, show, toBoard, restore, onSession, onGame, renderHome, wire, boardView, setSideTab,
    /** Is a page (not the board) in front? The game's keys stand down. */
    pageShown: () => isPage(store.ui.view),
  };
}
