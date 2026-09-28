/**
 * Browser check for the top level (v8-0-plan A1): the navigation rail, the
 * home page, the two pages, the preferences window and the settings page that
 * is left once the app's own preferences went there.
 *
 * What the plan asks of it, each a claim only a running page can settle:
 *   - 下棋 / 谜题 / 学习 / 棋谱库 / 我的 on a left rail in a wide window, in
 *     the top bar in a narrow one; keyboard-walkable, current entry marked;
 *   - 首页 with 继续上次 / 今天的训练 / 下一步建议, and every view one click
 *     away from it;
 *   - the mode segment out of the settings page (人机 / 双人 go with the new
 *     game, 谜题 / 学习 are the rail's);
 *   - appearance, language, sound (and the data) in a preferences window,
 *     ⌘, on macOS and Ctrl+, elsewhere.
 * The geometry — the board not moving, no horizontal scroll on a page — is
 * test-layout-e2e.mjs's.
 *
 * Same harness as the other browser checks (see e2e-browser.mjs).
 *   node scripts/test-shell-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 700, height: 600 };

async function open(settings = {}, viewport = WIDE) {
  const ctx = await browser.newContext({ viewport, locale: settings.langId || "zh-CN" });
  // seeded once per tab, so a reload reads what the app saved
  await ctx.addInitScript((s) => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.v1.settings", JSON.stringify(Object.assign(
      { mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }, s)));
    localStorage.setItem("chess.panelOpen", "1");
  }, settings);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  return { ctx, page, errs };
}
/** Everything a view check needs, read in one pass. */
const state = (page) => page.evaluate(() => {
  const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden";
  const cur = document.querySelector('#rail [aria-current="page"]');
  return {
    view: document.getElementById("app").getAttribute("data-view"),
    current: cur ? cur.dataset.view : null,
    mode: JSON.parse(localStorage.getItem("chess.v1.settings") || "{}").mode,
    home: vis(document.getElementById("page-home")),
    library: vis(document.getElementById("page-library")),
    me: vis(document.getElementById("page-me")),
    puzzleSec: vis(document.getElementById("sec-puzzle")),
    learnSec: vis(document.getElementById("sec-learn")),
    stageInert: document.querySelector(".stage").hasAttribute("inert"),
  };
});

// --- 1. the rail: six views and the preferences, in the plan's order --------
{
  const { ctx, page, errs } = await open();
  const rail = await page.evaluate(() => {
    const nav = document.getElementById("rail");
    if (!nav) return null;
    const r = nav.getBoundingClientRect();
    return {
      tag: nav.tagName, label: nav.getAttribute("aria-label"),
      views: [...nav.querySelectorAll("button[data-view]")].map((b) => b.dataset.view),
      labels: [...nav.querySelectorAll("button")].map((b) => b.textContent.trim()),
      prefs: !!nav.querySelector("#prefs-open"),
      x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
      // the controls take the app's two heights (or auto, the icon pill is --ctl-h-sm)
      pill: Math.round(nav.querySelector(".rail-ic").getBoundingClientRect().height),
    };
  });
  assert(rail && rail.tag === "NAV" && !!rail.label, "A1: 有一条带名字的 <nav> 导航栏");
  assert(rail && JSON.stringify(rail.views) === JSON.stringify(["home", "play", "puzzle", "learn", "library", "me"]),
    "A1: 入口依次是 首页 / 下棋 / 谜题 / 学习 / 棋谱库 / 我的(" + (rail && rail.views.join(" ")) + ")");
  assert(rail && JSON.stringify(rail.labels.slice(1, 6)) === JSON.stringify(["下棋", "谜题", "学习", "棋谱库", "我的"]),
    "A1: 五个入口的字(" + (rail && rail.labels.join(" / ")) + ")");
  assert(rail && rail.prefs, "A1: 栏里有偏好设置的入口");
  assert(rail && rail.x === 0 && rail.w > 0 && rail.w <= 72 && rail.h === WIDE.height,
    "A1: 宽窗是左侧窄栏,不超过 72px 宽、通高(" + JSON.stringify(rail) + ")");
  assert(rail && rail.pill === 32, "A1: 图标底是 --ctl-h-sm(" + (rail && rail.pill) + "px)");
  const s = await state(page);
  assert(s.view === "play" && s.current === "play", "A1: 人机模式打开时在「下棋」,栏上标着当前项(" + JSON.stringify(s) + ")");
  assert(errs.length === 0, "rail: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 2. narrow: the same entries, as a row in the top bar ---------------------
{
  const { ctx, page, errs } = await open({}, NARROW);
  const bar = await page.evaluate(() => {
    const nav = document.getElementById("rail");
    const r = nav.getBoundingClientRect();
    const chrome = document.querySelector(".chrome").getBoundingClientRect();
    const btns = [...nav.querySelectorAll("button")].map((b) => b.getBoundingClientRect());
    return {
      top: Math.round(r.top), h: Math.round(r.height), chromeH: Math.round(chrome.height),
      oneRow: new Set(btns.map((b) => Math.round(b.top))).size === 1,
      inside: btns.every((b) => b.right <= window.innerWidth && b.bottom <= chrome.bottom + 0.5),
      toggle: (() => { const t = document.getElementById("toggle-panel").getBoundingClientRect(); return btns.every((b) => b.right <= t.left); })(),
    };
  });
  assert(bar.top === 0 && bar.h <= bar.chromeH, "A1: 窄窗是顶栏,落在 32px 的条里(" + JSON.stringify(bar) + ")");
  assert(bar.oneRow && bar.inside && bar.toggle, "A1: 一行排开,不出窗口、不压 ☰(" + JSON.stringify(bar) + ")");
  assert(errs.length === 0, "narrow: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3. every view is one click, and each lands where it says -----------------
{
  const { ctx, page, errs } = await open();
  const EXPECT = {
    home: (s) => s.home && s.stageInert,
    puzzle: (s) => s.puzzleSec && s.mode === "puzzle" && !s.stageInert,
    learn: (s) => s.learnSec && s.mode === "learn",
    library: (s) => s.library && s.stageInert,
    me: (s) => s.me && s.stageInert,
    play: (s) => !s.home && !s.library && !s.me && s.mode === "ai" && !s.puzzleSec && !s.learnSec,
  };
  for (const v of ["home", "puzzle", "learn", "library", "me", "play"]) {
    await page.click('#rail button[data-view="' + v + '"]');
    await page.waitForTimeout(300);
    const s = await state(page);
    assert(s.view === v && s.current === v && EXPECT[v](s), "A1: 点「" + v + "」一次就到(" + JSON.stringify(s) + ")");
  }
  // …and from the home page, each of them is one click
  for (const v of ["play", "puzzle", "learn", "library", "me"]) {
    await page.click('#rail button[data-view="home"]');
    await page.waitForTimeout(200);
    await page.click('#rail button[data-view="' + v + '"]');
    await page.waitForTimeout(300);
    const s = await state(page);
    assert(s.view === v && EXPECT[v](s), "A1: 首页 → 「" + v + "」一次点击");
  }
  assert(errs.length === 0, "views: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 4. 首页: three cards, each a sentence and a button that goes somewhere ---
{
  const { ctx, page, errs } = await open({ view: "home" });
  const cards = await page.evaluate(() => ["home-continue", "home-daily", "home-next"].map((id) => {
    const c = document.getElementById(id);
    if (!c) return null;
    return {
      title: (c.querySelector("h2") || {}).textContent,
      body: c.querySelector(".home-body").textContent.trim(),
      go: c.querySelector(".home-go").textContent.trim(),
      visible: c.getClientRects().length > 0,
    };
  }));
  assert(cards.every((c) => c && c.visible && c.body && c.go),
    "A1: 首页三张卡都有内容和按钮(" + JSON.stringify(cards) + ")");
  assert(cards.map((c) => c && c.title).join("/") === "继续上次/今天的训练/下一步建议",
    "A1: 三张卡是 继续上次 / 今天的训练 / 下一步建议");
  assert((await state(page)).view === "home", "A1: 上次停在首页,打开还是首页");
  // 继续上次, with no game on the board, starts one: the new-game dialog
  await page.click("#home-continue .home-go");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    view: document.getElementById("app").getAttribute("data-view"),
    ng: document.getElementById("newgame-modal").classList.contains("show"),
  }));
  assert(after.view === "play" && after.ng, "A1: 没有对局时「继续上次」→ 下棋 + 新对局对话框(" + JSON.stringify(after) + ")");
  await page.click("#ng-cancel");
  // 今天的训练 starts the plan: its first step, on the view it happens in
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(200);
  await page.click("#home-daily .home-go");
  await page.waitForTimeout(500);
  const dv = await state(page);
  assert(dv.view !== "home" && !dv.home, "A1: 「今天的训练」的按钮带你去第一步(" + dv.view + ")");
  // 下一步建议 goes to a board view
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(200);
  await page.click("#home-next .home-go");
  await page.waitForTimeout(500);
  const nx = await state(page);
  assert(["learn", "puzzle", "play"].includes(nx.view), "A1: 「下一步建议」的按钮落在一个棋盘视图上(" + nx.view + ")");
  assert(errs.length === 0, "home: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 5. the keyboard: the rail walks with arrows, and the game keys stand down under a page
{
  const { ctx, page } = await open();
  await page.focus('#rail button[data-view="play"]');
  await page.keyboard.press("ArrowDown");
  const f1 = await page.evaluate(() => document.activeElement.dataset.view);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  assert(f1 === "puzzle" && (await state(page)).view === "puzzle", "A1: ↓ 走到下一个入口,回车进去(" + f1 + ")");
  await page.keyboard.press("End");
  const f2 = await page.evaluate(() => document.activeElement.id);
  assert(f2 === "prefs-open", "A1: End 到栏尾(" + f2 + ")");
  await page.keyboard.press("Home");
  const f3 = await page.evaluate(() => document.activeElement.dataset.view);
  assert(f3 === "home", "A1: Home 到栏首(" + f3 + ")");
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(200);
  await page.evaluate(() => document.activeElement.blur());
  await page.keyboard.press("n");
  await page.keyboard.press("p");
  await page.waitForTimeout(300);
  const quiet = await page.evaluate(() => ({
    ng: document.getElementById("newgame-modal").classList.contains("show"),
    panel: document.getElementById("app").classList.contains("panel-open"),
  }));
  assert(!quiet.ng && quiet.panel, "A1: 页面在前时 N / P 不动后面的棋局与侧栏(" + JSON.stringify(quiet) + ")");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.getElementById("app").classList.contains("panel-open")),
    "A1: 页面在前时 Esc 也不去关背后的侧栏");
  await page.keyboard.press("?");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.getElementById("keys-modal").classList.contains("show")),
    "A1: 页面上 ? 照样打开快捷键表");
  const prefsRow = await page.evaluate(() => /Ctrl\+,/.test(document.getElementById("keys-modal").textContent));
  assert(prefsRow, "A1: 快捷键表里有偏好设置的键");
  await page.keyboard.press("Escape");
  await ctx.close();
}

// --- 6. the settings page keeps the game; the window's own things moved -------
{
  const { ctx, page, errs } = await open({ sideTab: "setup" });
  const setup = await page.evaluate(() => {
    const pane = document.getElementById("pane-setup");
    const has = (id) => !!pane.querySelector("#" + id);
    return {
      mode: has("mode-seg"), theme: has("appearance-seg") || has("board-pick-seg"), lang: has("lang-seg"), sound: has("opt-sound"),
      pieces: has("piece-pick-seg"), data: has("alldata-export"), text: has("text-seg"), coords: has("opt-coords"),
      diff: has("diff-seg"), clock: has("clock-seg"), orient: has("orient-seg"), hash: has("hash-seg"),
      tabs: [...document.querySelectorAll(".side-tabs [role=tab]")].map((b) => b.dataset.tab),
    };
  });
  assert(!setup.mode, "A1: 模式分段不在设置页了");
  assert(!setup.theme && !setup.lang && !setup.sound && !setup.pieces && !setup.data && !setup.text && !setup.coords,
    "A1: 外观、语言、声音、数据都不在设置页(" + JSON.stringify(setup) + ")");
  assert(setup.diff && setup.clock && setup.orient && setup.hash, "A1: 对局相关的项还在设置页");
  assert(JSON.stringify(setup.tabs) === JSON.stringify(["play", "setup"]), "A1: 侧栏两个页签:对局 / 设置(" + setup.tabs + ")");
  // Ctrl+, (⌘, on macOS) opens the preferences window with those rows in it
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await page.waitForTimeout(300);
  const prefs = await page.evaluate(() => {
    const m = document.getElementById("prefs-modal");
    const has = (id) => !!m.querySelector("#" + id);
    return { open: m.classList.contains("show"), theme: has("appearance-seg"), board: has("board-pick-seg"),
      frame: has("frame-seg"), lang: has("lang-seg"),
      sound: has("opt-sound"), pieces: has("piece-pick-seg"), data: has("alldata-export"),
      text: has("text-seg"), coords: has("opt-coords"), coordsAt: has("coords-seg"),
      langs: m.querySelectorAll("#lang-seg button").length,
      // the 7.x rows are gone everywhere, not only moved (M2 merge: A3 × A1)
      old: ["theme-seg", "opt-follow", "pieces-seg", "look-rows"].filter((id) => document.getElementById(id)) };
  });
  assert(prefs.open, "A1: Ctrl+, 打开偏好设置");
  assert(prefs.theme && prefs.board && prefs.frame && prefs.pieces && prefs.lang && prefs.sound && prefs.data && prefs.langs === 3,
    "A1 × A3: 偏好设置里有外观 / 棋盘 / 边框 / 棋子、语言、声音、数据(" + JSON.stringify(prefs) + ")");
  assert(prefs.text && prefs.coords && prefs.coordsAt, "A1: 字号与坐标两行在偏好设置里(" + JSON.stringify(prefs) + ")");
  assert(prefs.old.length === 0, "A3: 旧的主题 / 跟随系统 / 棋子样式行已不存在(" + prefs.old + ")");
  // a choice there still works: the board and the appearance change the page
  await page.click('#board-pick-seg button[data-board-id="green"]');
  await page.click('#appearance-seg button[data-appearance="dark"]');
  await page.waitForTimeout(200);
  const look = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), board: document.documentElement.getAttribute("data-board"),
    pressed: document.querySelector('#appearance-seg button[data-appearance="dark"]').getAttribute("aria-pressed") }));
  assert(look.theme === "night" && look.board === "green" && look.pressed === "true", "A1 × A3: 在偏好设置里换外观与棋盘照样生效(" + JSON.stringify(look) + ")");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  assert(!(await page.evaluate(() => document.getElementById("prefs-modal").classList.contains("show"))), "A1: Esc 关上偏好设置");
  await page.click("#prefs-open");
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => document.getElementById("prefs-modal").classList.contains("show")), "A1: 栏上的「偏好」也能打开");
  await page.click("#prefs-close");
  assert(errs.length === 0, "setup/prefs: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 7. 人机 / 双人 are chosen with the new game ----------------------------------
{
  const { ctx, page, errs } = await open();
  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  const seg = await page.evaluate(() => ({
    inDialog: !!document.querySelector("#newgame-modal #mode-seg"),
    modes: [...document.querySelectorAll("#mode-seg button")].map((b) => b.dataset.mode),
    active: (document.querySelector("#mode-seg button.active") || {}).dataset,
  }));
  assert(seg.inDialog && JSON.stringify(seg.modes) === JSON.stringify(["ai", "pvp"]),
    "A1: 新对局对话框里选 人机 / 双人(" + JSON.stringify(seg) + ")");
  await page.click('#mode-seg button[data-mode="pvp"]');
  await page.waitForTimeout(150);
  const draft = await page.evaluate(() => ({
    diffHidden: document.getElementById("row-difficulty").hidden,
    mode: JSON.parse(localStorage.getItem("chess.v1.settings")).mode,
  }));
  assert(draft.diffHidden && draft.mode === "ai", "A1: 选了双人,难度行收起;还没开始,模式不变(" + JSON.stringify(draft) + ")");
  await page.click("#ng-start");
  await page.waitForTimeout(400);
  const s = await state(page);
  assert(s.mode === "pvp" && s.view === "play", "A1: 开始之后是双人对局(" + JSON.stringify(s) + ")");
  assert(errs.length === 0, "new game: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 8. what was saved comes back, and 7.x's 记录 tab has somewhere to land ----
{
  const { ctx, page, errs } = await open({ sideTab: "record" });
  const s = await page.evaluate(() => ({
    tab: [...document.querySelectorAll(".side-tabs [role=tab]")].find((b) => b.getAttribute("aria-selected") === "true").dataset.tab,
    view: document.getElementById("app").getAttribute("data-view"),
  }));
  assert(s.tab === "play" && s.view === "play", "A1: 7.x 存下的「记录」页签打开时回到对局(" + JSON.stringify(s) + ")");
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(900);
  const back = await state(page);
  assert(back.view === "me" && back.me, "A1: 停在「我的」,重开还是「我的」(" + JSON.stringify(back) + ")");
  const moved = await page.evaluate(() => ({
    stats: !!document.querySelector("#page-me #stats-body"),
    ach: !!document.querySelector("#page-me #ach-body"),
    hist: !!document.querySelector("#page-me #hist-body"),
    lib: !!document.querySelector("#page-library #lib-body"),
    rep: !!document.querySelector("#page-library #rep-body"),
  }));
  assert(Object.values(moved).every(Boolean), "A1: 统计/历史/成就在「我的」,棋谱库/开局书在「棋谱库」(" + JSON.stringify(moved) + ")");
  assert(errs.length === 0, "restore: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 9. three languages: every entry has a label, and English has no Chinese in it
for (const lang of ["en", "ja"]) {
  const { ctx, page, errs } = await open({ langId: lang });
  const labels = await page.evaluate(() => [...document.querySelectorAll("#rail .rail-lbl")].map((s) => s.textContent.trim()));
  assert(labels.length === 7 && labels.every(Boolean), lang + ": 栏上七个字都有(" + labels.join(" / ") + ")");
  if (lang === "en") assert(!labels.some((l) => /[一-鿿]/.test(l)), "en: 栏上没有中文");
  const fits = await page.evaluate(() => [...document.querySelectorAll("#rail .rail-lbl")].every((s) => s.scrollWidth <= s.clientWidth + 1));
  assert(fits, lang + ": 栏上的字都放得下");
  assert(errs.length === 0, lang + ": 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: a page in front of the board makes the game's letter keys
// inert (a11y.js), and the native menu's accelerators — the same commands
// through Host.onAppLifecycle → NativeCmds.run() — must be inert with it.
// Red before: ⌘F on 首页 flipped the hidden board, ⌘\ shut the panel.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__handlers = {};
    window.zero = {
      on: (n, cb) => { (window.__handlers[n] = window.__handlers[n] || []).push(cb); return () => {}; },
      invoke: async () => ({}),
      platform: { supports: async () => false },
    };
    window.__fire = (command) => { for (const cb of window.__handlers.shortcut || []) cb({ command, id: command, windowId: 1 }); };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const look = () => page.evaluate(() => ({
    flipped: [...document.querySelectorAll("#orient-seg button")].filter((b) => b.classList.contains("active")).map((b) => b.dataset.orient)[0],
    panel: localStorage.getItem("chess.panelOpen") }));
  const fire = async (c) => { await page.evaluate((x) => window.__fire(x), c); await page.waitForTimeout(400); };
  for (const v of ["home", "library", "me"]) {
    await page.click('#rail button[data-view="' + v + '"]');
    await page.waitForTimeout(400);
    const before = await look();
    await fire("game.flip");
    await fire("view.panel");
    const after = await look();
    assert(JSON.stringify(before) === JSON.stringify(after),
      v + ":整页在前时,菜单的「翻转棋盘」「侧栏」不动背后的棋盘(" + JSON.stringify(before) + " → " + JSON.stringify(after) + ")");
  }
  // …and on the play view they still work
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(400);
  const b0 = await look();
  await fire("game.flip");
  assert((await look()).flipped !== b0.flipped, "回到下棋,菜单的「翻转棋盘」照常翻");
  assert(errs.length === 0, "菜单快捷键与整页:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: a game opened from 对局历史 on 我的 is loaded onto the board,
// so the board is what shows next — as a library game already does. Red
// before: the sheet closed, and the 我的 page went on covering the new game.
{
  const { ctx, page, errs } = await open();
  await page.evaluate(() => {
    localStorage.setItem("chess.v1.stats", JSON.stringify({ v: 2, games: [
      { id: "h1", t: Date.now() - 864e5, diff: "normal", color: "w", result: "win", moves: 3,
        pgn: '[Event "?"]\n\n1. e4 e5 2. Nf3 *', ending: "", acc: 70 },
    ] }));
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(400);
  await page.click("#hist-open");
  await page.waitForTimeout(400);
  await page.click("#hist-list [data-hist]");
  await page.waitForTimeout(600);
  await page.click("#confirm-ok", { timeout: 800 }).catch(() => {});
  await page.waitForTimeout(800);
  const st = await state(page);
  const rows = await page.evaluate(() => document.querySelectorAll(".mlrow").length);
  assert(rows === 2, "从对局历史打开的一局载入了棋盘(" + rows + " 行)");
  assert(!st.me && st.current === "play" && !st.stageInert,
    "……载入之后看见的是棋盘,不是还盖着的「我的」(" + JSON.stringify({ me: st.me, current: st.current, inert: st.stageInert }) + ")");
  assert(errs.length === 0, "对局历史载入:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: 下一步建议 names the first unfinished lesson; its button opens
// THAT lesson, not whichever lesson was visited last. Red before: with
// lesson 1 done and lesson 3 the last one open, the card said 「第 2 课」 and
// the button went back to lesson 3.
{
  const { ctx, page, errs } = await open();
  await page.evaluate(() => {
    localStorage.setItem("chess.v1.learn", JSON.stringify({ v: 1, done: { board: true }, last: 2 }));
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const said = await page.evaluate(() => document.getElementById("home-next").textContent);
  await page.click("#home-next .home-go");
  await page.waitForTimeout(700);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.learn")).last);
  const st = await state(page);
  assert(st.view === "learn" && last === 1,
    "「下一步建议」点开的正是卡上说的那一课(第 2 课;打开的是第 " + (last + 1) + " 课,视图 " + st.view + ";卡上:" + said.trim().slice(0, 40) + ")");
  assert(errs.length === 0, "下一步建议:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: the board previews (paper and marble build their textures
// procedurally) are drawn when the preferences window opens, not at every
// launch for a window most sessions never open. Red before: every preview
// canvas already held pixels at startup.
{
  const { ctx, page, errs } = await open();
  const inked = () => page.evaluate(() => [...document.querySelectorAll("#prefs-look canvas.look-board")].map((cv) => {
    if (!cv.width || !cv.height) return false;
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  }));
  const before = await inked();
  assert(before.length > 0 && before.every((x) => !x), "启动时偏好窗口还没开,棋盘预览一张也没画(" + before.join(",") + ")");
  await page.click("#prefs-open");
  await page.waitForTimeout(500);
  const after = await inked();
  assert(after.length === before.length && after.every(Boolean), "打开偏好设置,棋盘预览都画出来了(" + after.join(",") + ")");
  assert(errs.length === 0, "预览推迟绘制:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: 首页 stays current while it is open — a game commit (the
// engine's reply) changes what 继续上次 says. Red before: only session
// commits reached the home page, so the card still said 「还没有对局」.
{
  const { ctx, page, errs } = await open({ mode: "pvp" });
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const said0 = await page.evaluate(() => document.getElementById("home-continue").textContent);
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const at = (sq) => page.evaluate((x) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (x.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(x[1]) + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); }
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const said1 = await page.evaluate(() => document.getElementById("home-continue").textContent);
  // now, with 首页 in front, take the move back through the menu path the
  // page does not own: the game changes under the open page
  await page.evaluate(() => document.getElementById("undo").click());
  await page.waitForTimeout(400);
  const said2 = await page.evaluate(() => document.getElementById("home-continue").textContent);
  assert(said0 !== said1, "首页:走了一步再回来,「继续上次」变了");
  assert(said2 === said0, "首页开着时对局变了(悔掉那一步),「继续上次」跟着变回去(" + said2.trim().slice(0, 30) + ")");
  assert(errs.length === 0, "首页刷新:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: a PGN dropped onto the window while a page is in front loads
// onto the board, and the board is what shows next — the same as a game from
// the library or the history. Red before: the toast said it loaded, and the
// page went on covering it.
for (const v of ["home", "library", "me"]) {
  const { ctx, page, errs } = await open({ mode: "pvp" });
  await page.click('#rail button[data-view="' + v + '"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['[Event "?"]\n\n1. d4 d5 2. c4 *'], "drop.pgn", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(900);
  await page.click("#confirm-ok", { timeout: 600 }).catch(() => {});
  await page.waitForTimeout(500);
  const st = await state(page);
  const rows = await page.evaluate(() => document.querySelectorAll(".mlrow").length);
  assert(rows === 2 && !st[v] && !st.stageInert && st.current === "play",
    v + ":整页在前时拖进来的 PGN 载入后回到棋盘(" + JSON.stringify({ rows, page: st[v], current: st.current, inert: st.stageInert }) + ")");
  // …and the board is what the app reopens on: the navigation is saved, not
  // only made (Codex on #86 — the next launch covered the game again)
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const again = await state(page);
  assert(again.current === "play" && !again[v], v + ":拖入后直接重开,回来的是棋盘不是这张整页(" + again.current + ")");
  assert(errs.length === 0, v + ":拖入 PGN 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: a PGN dropped while a page covers a lesson or a puzzle opens
// in a playing mode — the trainer draws its own board, not the game. Red
// before: back on 谜题, the loaded game nowhere on screen.
{
  const { ctx, page, errs } = await open({ mode: "puzzle" });
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    const dt = new DataTransfer();
    dt.items.add(new File(['[Event "?"]\n\n1. d4 d5 2. c4 *'], "drop.pgn", { type: "text/plain" }));
    window.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  });
  await page.waitForTimeout(900);
  await page.click("#confirm-ok", { timeout: 600 }).catch(() => {});
  await page.waitForTimeout(500);
  const st = await state(page);
  const rows = await page.evaluate(() => document.querySelectorAll("#move-list .mlrow").length);
  assert(st.current === "play" && (st.mode === "ai" || st.mode === "pvp") && rows === 2,
    "谜题上盖着首页时拖入 PGN:回到下棋、离开谜题模式,看得见这一局(" + JSON.stringify({ current: st.current, mode: st.mode, rows }) + ")");
  assert(errs.length === 0, "训练模式下拖入:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: a home card worked from the keyboard hides the page its
// button is on; focus goes where the player went, not into a hidden subtree.
{
  const { ctx, page, errs } = await open();
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  await page.focus("#home-continue .home-go");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");   // the new-game dialog the empty board opens
  await page.waitForTimeout(400);
  const f = await page.evaluate(() => {
    const a = document.activeElement;
    return { tag: a && a.tagName, id: a && (a.id || a.dataset.view || ""), seen: !!a && a !== document.body && a.getClientRects().length > 0,
      inPage: !!a && !!a.closest("#page-home, #page-library, #page-me") };
  });
  assert(f.seen && !f.inPage, "键盘点首页卡片离开整页后,焦点在看得见的地方(" + JSON.stringify(f) + ")");
  assert(errs.length === 0, "焦点:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- v8-0-plan B5: the 我的 page puts everything on one page ---------------
// The engine-game rating curve, the practice calendar, strengths and
// weaknesses and the three cross-game figures, each drawn only when it has
// data (7.1: a chart that cannot be drawn does not exist) and each figure
// naming the games it needs. Three profiles: nothing; one wrong first answer
// to a puzzle; a full record. Then the record is cleared under the page.
{
  const DAY = 86400000;
  const now = Date.now();
  const tagsOf = (n, at) => Array.from({ length: n }, (_, i) => (at.includes(i) ? "??" : null));
  const libGame = (i, extra) => Object.assign({
    id: "L" + i, t: now - i * DAY, white: "hxddh", black: "rival" + i, date: "", event: "", result: "1-0",
    plies: 40, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win",
  }, extra);
  // ten clocked, analysed games — the time-pressure floor — five of them
  // reached +2 (the conversion floor) and five −2 (the resilience one)
  const lib = Array.from({ length: 10 }, (_, i) => {
    const clk = [];
    for (let j = 0; j < 20; j++) clk.push(j < 16 ? 170 - 10 * j : [15, 12, 8, 4][j - 16], 180);
    const peak = i < 5 ? 300 : -300;
    const scalars = Array.from({ length: 41 }, (_, k) => (k === 20 ? peak : 0));
    return libGame(i, { clk, outcome: i < 3 ? "win" : i < 7 ? "draw" : "loss", result: i < 3 ? "1-0" : i < 7 ? "1/2-1/2" : "0-1",
      an: { acc: { w: 80, b: 70 }, acpl: { w: 30, b: 40 }, tags: tagsOf(40, [36]), scalars, bests: [], budget: 200 } });
  });
  const stats = { v: 2, games: Array.from({ length: 6 }, (_, i) => ({ id: "s" + i, t: now - (6 - i) * DAY, diff: "normal", color: "w",
    result: i % 2 ? "win" : "loss", moves: 40, pgn: "", ending: "", ra: 1450 + i * 12 })) };
  const th = (r, solve, miss) => ({ solve, miss, rating: { r, rd: 80, vol: 0.06 } });
  const puzzles = { v: 1, solved: {}, tally: { tac: { miss: 3, solve: 9 } }, rhist: [{ t: now - DAY, r: 1500 }, { t: now, r: 1520 }],
    themes: { fork: th(1700, 6, 1), pin: th(1350, 2, 4), skewer: th(1550, 4, 2) } };
  const seeded = async (keys, viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || WIDE, locale: "zh-CN" });
    await ctx.addInitScript((ks) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", sideTab: "play", view: "me", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      // the profile keys, spelled out by the callers (persist.js KEYS)
      for (const [k, v] of Object.entries(ks)) localStorage.setItem(k, JSON.stringify(v));
    }, keys);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1200);
    return { ctx, page, errs };
  };
  const meState = (page) => page.evaluate(() => {
    const vis = (id) => { const e = document.getElementById(id); return !!e && !e.hidden && e.getClientRects().length > 0; };
    const m = document.getElementById("me-metrics");
    return {
      view: document.getElementById("app").getAttribute("data-view"),
      empty: vis("record-empty"), growth: vis("sec-growth"), rating: vis("me-rating"), cal: vis("me-cal"),
      sw: vis("me-sw"), metrics: vis("me-metrics"),
      calMeta: (document.getElementById("me-cal-meta") || {}).textContent || "",
      ratingMeta: (document.getElementById("me-rating-meta") || {}).textContent || "",
      calLabel: (document.getElementById("me-cal") || { getAttribute: () => "" }).getAttribute("aria-label") || "",
      swText: vis("me-sw") ? document.getElementById("me-sw").textContent : "",
      rows: m ? [...m.querySelectorAll(".me-metric")].map((r) => r.textContent) : [],
      calW: (document.getElementById("me-cal") || {}).width || 0,
    };
  });
  {
    const { ctx, page, errs } = await seeded({});
    const s = await meState(page);
    assert(s.view === "me" && s.empty && !s.growth && !s.rating && !s.cal && !s.sw && !s.metrics,
      "B5 什么都没有:入口卡片在,成长一节整个不存在(" + JSON.stringify(s) + ")");
    assert(errs.length === 0, "B5 空档案:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
  {
    // one first answer, and it was wrong: a tally row and a rating on the
    // page — which is a record, and the entry card said 「现在还空着」 over it
    const { ctx, page, errs } = await seeded({ "chess.v1.puzzles": { v: 1, solved: {}, tally: { tac: { miss: 1, solve: 0 } }, rhist: [{ t: now, r: 1480 }] } });
    const s = await meState(page);
    const tally = await page.evaluate(() => !document.getElementById("puzzle-tally-body").hidden);
    assert(tally && !s.empty, "B5 答错过一道题:战绩里有这一行,入口卡片不再说「现在还空着」(" + JSON.stringify({ tally, empty: s.empty }) + ")");
    assert(s.growth && s.cal && !s.rating && !s.sw && !s.metrics,
      "B5 只有一次作答:日历画出今天,评级曲线、强弱项、跨局指标都不在(" + JSON.stringify(s) + ")");
    assert(/1/.test(s.calLabel), "B5 日历有读屏说明(" + s.calLabel + ")");
    assert(errs.length === 0, "B5 一次作答:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
  {
    // too few games for any figure: the block is there, says what it needs,
    // and prints no percentage
    const few = lib.slice(0, 3).map((g) => Object.assign({}, g, { clk: undefined }));
    const { ctx, page, errs } = await seeded({ "chess.v1.library": { v: 1, names: ["hxddh"], games: few } });
    const s = await meState(page);
    assert(s.metrics && s.rows.length === 3 && s.rows.every((r) => !/%/.test(r)) && s.rows.every((r) => /5|10/.test(r)),
      "B5 三局:三项指标都写明要几局,一个百分比也不给(" + JSON.stringify(s.rows) + ")");
    assert(errs.length === 0, "B5 三局:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
  {
    const { ctx, page, errs } = await seeded({ "chess.v1.library": { v: 1, names: ["hxddh"], games: lib },
      "chess.v1.stats": stats, "chess.v1.puzzles": puzzles, "chess.v1.progress": { v: 1, weeks: {}, days: {} } });
    const s = await meState(page);
    assert(!s.empty && s.growth && s.rating && s.cal && s.sw && s.metrics, "B5 满档案:评级曲线、日历、强弱项、跨局指标都在(" + JSON.stringify(s) + ")");
    assert(/1510/.test(s.ratingMeta), "B5 对局评级读的是每局存下的评级(" + s.ratingMeta + ")");
    assert(s.calW > 1, "B5 日历按显示宽度画(" + s.calW + ")");
    assert(/10/.test(s.calMeta), "B5 连续 10 天写在日历上(" + s.calMeta + ")");
    assert(/捉双/.test(s.swText) && /牵制/.test(s.swText), "B5 强弱项读的是主题评级(" + s.swText + ")");
    assert(s.rows.length === 3 && /60%/.test(s.rows[0]) && /40%/.test(s.rows[1]) && /33%/.test(s.rows[2]),
      "B5 化优为胜 3/5、逆境求生 2/5、时间紧 10/30 步(" + JSON.stringify(s.rows) + ")");
    // cleared under the page: the curve goes with the games it was drawn from
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(300);
    await page.click("#stats-clear");
    await page.waitForTimeout(300);
    await page.click("#confirm-ok").catch(() => {});
    await page.waitForTimeout(400);
    await page.click("#prefs-close").catch(() => {});
    await page.waitForTimeout(300);
    const after = await meState(page);
    assert(!after.rating && after.cal, "B5 清除统计之后:评级曲线跟着消失,日历还有棋谱库和做题(" + JSON.stringify({ rating: after.rating, cal: after.cal }) + ")");
    assert(errs.length === 0, "B5 满档案:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
}

await browser.close();
server.close();
if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
