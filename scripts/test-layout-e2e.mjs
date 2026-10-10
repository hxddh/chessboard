/**
 * Browser check for the side panel's layout — the things a screenshot shows
 * and no unit test can.
 *
 * Everything here was found by looking at a running window, and every one of
 * them is a claim about geometry that only a laid-out page can settle:
 *
 *   - a wrapped segment row's last button was as wide as the whole panel,
 *     because `flex: 1 1 30%` lets the last line share itself out. A full
 *     width filled button is this UI's word for "primary action", and 满强度
 *     / 爱进攻 were wearing it for no reason other than 4 % 3 == 1.
 *   - "2 players" and "レッスン" wrapped to two lines inside a mode tab.
 *   - a lesson with no sparring partner still drew the opponent card, with an
 *     em dash where the opponent's name goes.
 *   - the ✕ in the tab row was the same height, in the same row, aligned with
 *     three tabs, and was not a tab.
 *   - 演示 was permanently greyed out on every lesson that has no demo.
 *
 * Reading widths off the real box model is the point: "they fit" and "they are
 * the same size" are exactly the claims that get made from memory and are
 * wrong. Same harness as the other browser checks (see e2e-browser.mjs);
 * skips cleanly without a browser unless E2E_REQUIRED=1.
 *   node scripts/test-layout-e2e.mjs
 *   SHARD=2/4 node scripts/test-layout-e2e.mjs   # one quarter (v8-0-plan F1)
 *
 * Every top-level scenario opens with `if (scenario()) {` — see
 * e2e-shard.mjs. A new one must too; test-chess.mjs fails on one that
 * does not, because an ungated block would run in every shard.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { seedLibrary } from "./lib/library-view.mjs";
import { makeScenarioGate } from "./e2e-shard.mjs";
import { PAGE_HOOK, makeFrameWatch } from "./lib/frame-watch.mjs";
import { layoutProbe } from "./lib/layout-probe.mjs";
import { playOpera, analyseOpera } from "./lib/opera-fixture.mjs";
import { loadAppModules } from "./lib/app-module.mjs";

// v8-0-plan F1: SHARD=i/n runs every n-th scenario; unset runs all of them
const scenario = makeScenarioGate(process.env.SHARD);
// v8-3-plan V4: every 400 ms fallback logged with its evidence, and counted
// in the job summary — 'exit' so a shard the watchdog kills still reports
const frames = makeFrameWatch({ shard: scenario.shard, scenario: scenario.current });
process.on("exit", () => frames.writeSummary());

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

/**
 * The app, opened in one language and one mode, on a given view (the board
 * with its panel, or a page — 9.0 S5: the panel has no tabs any more).
 * The settings key is written before the page runs, which is how the app
 * itself restores them — nothing here clicks through the onboarding.
 */
// Every measurement in this file was taken at one window size until 2.1.2 —
// 1400x900, sometimes 1200 or 1280 — while app.zon lets the window go down to
// 520x520. A panel column is 239px at 1400 and the whole layout argument rests
// on numbers like that, so "it fits" was only ever established at the widest
// end. `viewport` lets a section re-run at the narrow end; see 4c.
/** A shell's name (data-theme) as the look that gives it (look.js shellFor). */
const lookOf = (th) => ({ wood: { appearance: "dark", boardId: "wood" }, night: { appearance: "dark", boardId: "green" },
  day: { appearance: "light", boardId: "wood" }, notebook: { appearance: "light", boardId: "blue" } })[th] || {};

async function open(lang, mode, tab, theme = "wood", viewport = { width: 1400, height: 900 }, panelOpen = "1") {
  const ctx = await browser.newContext({ viewport, locale: lang });
  // The theme is chosen at load. Setting data-theme on a page already living in
  // another one leaves a mixture — the theme blocks and the component block
  // have equal specificity, so which wins depends on source order, not on the
  // attribute — and a measurement taken then reads one theme's ink on another
  // theme's paper.
  // v8-0-plan A1: `tab` may name a page of the top level instead — 记录 is
  // the 我的 page now ("record" still opens it), and home / library / me are
  // restored the way the app restores them, from the saved view
  // 9.0 S5: the panel's 设置 tab and the preferences window are one page —
  // "settings" opens it (on the category in `setCat`, 通用 unless a scenario
  // clicks another; see showCat); "play" is the panel, which has no tabs now
  const view = { record: "me", me: "me", home: "home", library: "library", settings: "settings" }[tab] || "play";
  await ctx.addInitScript(([l, m, th, po, v]) => {
    localStorage.setItem("chess.settings", JSON.stringify(Object.assign({
      mode: m, langId: l, soundOn: false, view: v }, th)));
    localStorage.setItem("chess.panelOpen", po);
  }, [lang, mode, lookOf(theme), panelOpen, view]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  // there is normally no game picker to dismiss; a full 30s default timeout
  // per context turns this file into a five-minute test for nothing
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  return { ctx, page, errs };
}

const LANGS = ["zh-CN", "en", "ja"];

// 9.0 S5: the settings page's categories (shell.js SETTING_CATS), one shown at
// a time — a check that used to read the whole 设置 tab reads each of them
const CATS = ["general", "board", "sound", "game", "data", "advanced"];
/**
 * Show one category of the settings page, through its tab's click handler.
 * Not a pointer click: in this harness the engine is a stub, and at some
 * window sizes its 「引擎没能启动」 banner lies over the category list.
 */
async function showCat(page, cat) {
  await page.evaluate((c) => document.getElementById("cat-" + c).click(), cat);
  await page.waitForTimeout(250);
}
/**
 * 9.0 S5: 难度 / 风格 / 执子 / 棋钟 live in the new-game dialog only (they
 * were the 设置 tab's 「对局」 fold, borrowed by the dialog while it was open).
 * Opened the way 新局 / N open it; `custom` unfolds 自定义, where the rung and
 * the style are. #btn-new is hidden with no move on the board, so its handler
 * is reached through click() rather than a pointer.
 */
async function openNewGame(page, custom = true) {
  await page.evaluate(() => document.getElementById("btn-new").click());
  await page.waitForTimeout(400);
  if (custom) {
    await page.evaluate(() => { const d = document.getElementById("ng-custom"); if (d) d.open = true; });
    await page.waitForTimeout(200);
  }
}
/**
 * 9.0 S2: 存档槽 / 编辑局面 / 导出复盘图 left the tool row for its 更多
 * (#more-row). Reached the way a player reaches them: ⋯ first, when the
 * row is shut. Throws if the button is not then on screen, so a check that
 * needs the editor or the slots never measures a page without them.
 */
async function pressMore(page, id) {
  if (!(await page.isVisible("#" + id))) { await page.click("#more-tools", { timeout: 3000 }); await page.waitForTimeout(250); }
  await page.click("#" + id, { timeout: 3000 });
}
/** 开始: the dialog's draft becomes the settings and the game starts. */
async function startNewGame(page) {
  await page.click("#ng-start");
  await page.waitForTimeout(450);
}

// --- 1. no button in a wrapped row is wider than the others ----------------
// The bug was specifically the *last* one on a short final line, so measuring
// max/min across the row catches it without knowing which row wraps.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page, errs } = await open(lang, "ai", "play");
    // The "are these buttons the same width" measurement moved to
    // test-chess.mjs (P2.8): equal widths are a consequence of the wrapped
    // segment being a grid with shared columns, and that is one declaration,
    // checkable in milliseconds and in every language at once. What a browser
    // is still needed for is whether the rows are *there* and whether opening
    // them in this language throws.
    // 9.0 S5: the wrapped segments (档位 / 风格 / 棋钟) are the new-game
    // dialog's, under its 自定义 fold — the 设置 tab's 「对局」 fold is gone
    await openNewGame(page);
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll("#newgame-modal .theme-row.wrap")].filter((r) => r.offsetParent).length);
    assert(rows > 0, lang + ": the wrapped segments are on screen (" + rows + ")");
    // …and the settings page's own wrapped rows (the look pickers, 棋盘)
    await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    await page.click('.rail-btn[data-view="settings"]'); await page.waitForTimeout(300);
    await showCat(page, "board");
    const look = await page.evaluate(() =>
      [...document.querySelectorAll("#set-board .theme-row.wrap")].filter((r) => r.offsetParent).length);
    assert(look > 0, lang + ": …and the settings page's 棋盘 pickers are (" + look + ")");
    assert(errs.length === 0, lang + ": no JS exception — " + errs.join(" / "));
    await ctx.close();
  }
}

// --- 2. the mode segment reads as one control in every language ------------
// It is a `.theme-row.wrap`, the same control the difficulty, the persona and
// the theme use — on the settings page until v8-0-plan A1, in the new-game
// dialog since (人机 / 双人; 谜题 and 学习 are the rail's). Same requirement
// as any segment: every button the same size, no label clipped, nothing past
// the edge of what holds it.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    await page.evaluate(() => document.getElementById("btn-new").click());
    await page.waitForTimeout(400);
    const seg = await page.evaluate(() => {
      const el = document.getElementById("mode-seg");
      const pane = el.closest(".modal").getBoundingClientRect();
      return {
        buttons: [...el.querySelectorAll("button")].map((b) => ({
          text: b.textContent.trim(),
          h: Math.round(b.getBoundingClientRect().height),
          // scrollWidth > clientWidth is the label running out of its box
          over: b.scrollWidth - b.clientWidth,
          pastPane: Math.round(b.getBoundingClientRect().right - pane.right),
        })),
        visible: !!el.offsetParent,
      };
    });
    assert(seg.visible, lang + ": the mode segment is in the new-game dialog");
    assert(seg.buttons.length === 2, lang + ": two modes there, 人机 and 双人");
    const heights = [...new Set(seg.buttons.map((b) => b.h))];
    assert(heights.length === 1,
      lang + ": every mode is the same height (" + heights.join(", ") + ")");
    for (const b of seg.buttons) {
      assert(b.over <= 0, lang + ": “" + b.text + "” fits its button (over by " + b.over + ")");
      assert(b.pastPane <= 1, lang + ": “" + b.text + "” stays inside the dialog (past by " + b.pastPane + ")");
    }
    await ctx.close();
  }
}

// --- 3. the difficulty labels read in order, and the two scales are two ----
// The 1.24 regression: the sparring tier and the engine's floor were near
// synonyms in English (Beginner / Novice) and Japanese (入門 / 初級), with the
// *stronger* of the pair being the one that reads weaker.
// Distinctness is not enough — "Beginner" and "Novice" are distinct strings,
// and that pair is exactly what shipped. The labels are frozen here instead,
// so changing one is a deliberate act with this note attached to it: the two
// sparring tiers must not borrow the ladder's vocabulary, because the ladder
// starts *above* them and a reader who knows the word "novice" will read it
// as the weaker of the two.
if (scenario()) {
  // The top rung is 不限档 / Unrated / 無制限 since P5.8: 「满强度」 promised
  // unlimited strength and read as unlimited time, while the search is still
  // 1.2 seconds a move like every other tier. 缺陷 31.
  // v9-0-plan S6: 全力 / Strongest / 全力 — 「不限档」 said 档 (a word only
  // the code used) and "Unrated" stopped being true when the rung was rated
  // 2877; the tooltip still says 1.2 seconds a move.
  // v8-0-plan B4: six sparring rungs (the four new win-chance rungs join the
  // handicapped pair) and six Elo rungs (1450 and 1575 between 初级 and 中级);
  // v8-1-plan T1: six and fifteen, the ladder re-stepped
  const EXPECT = {
    "zh-CN": { spar: ["新手", "休闲", "练习", "进步", "稳健", "扎实"],
      engine: ["初级", "初级+", "中级−", "中级", "中级+", "高级−", "高级", "高级+", "专家", "专家+", "大师", "大师+", "强力", "强力+", "全力"] },
    en: { spar: ["Gentle", "Casual", "Practice", "Improving", "Steady", "Solid"],
      engine: ["Novice", "Novice+", "Intermediate−", "Intermediate", "Intermediate+", "Advanced−", "Advanced", "Advanced+", "Expert", "Expert+", "Master", "Master+", "Strong", "Strong+", "Strongest"] },
    ja: { spar: ["やさしい", "お気軽", "練習", "上達", "堅実", "手堅い"],
      engine: ["初級", "初級+", "中級−", "中級", "中級+", "上級−", "上級", "上級+", "エキスパート", "エキスパート+", "マスター", "マスター+", "強力", "強力+", "全力"] },
  };
  for (const lang of LANGS) {
    // 9.0 S5: the rungs are the new-game dialog's. 10.0 M0: chosen on the
    // opponent cards alone — 更多选项 open shows all twenty-one; the two rows
    // of rung names that repeated them are gone. A card names its rung (or,
    // for the three with a style, the style) under the persona's name.
    const { ctx, page } = await open(lang, "ai", "play");
    await openNewGame(page);
    const cards = await page.evaluate(() => [...document.querySelectorAll("#op-grid .op-card")].filter((b) => !b.hidden).map((b) => ({
      name: b.querySelector(".op-name").textContent.trim(), rating: Number(b.querySelector(".op-rating").textContent),
      sub: b.querySelector(".op-style").textContent.trim() })));
    const rows = await page.evaluate(() => document.querySelectorAll("#row-difficulty, #diff-seg, #diff-seg-engine").length);
    assert(cards.length === 21 && rows === 0, lang + ": 21 opponent cards with 更多选项 open, and no second list of rungs (" + cards.length + " / " + rows + ")");
    assert(new Set(cards.map((c) => c.name)).size === 21, lang + ": all twenty-one names are distinct");
    assert(cards.every((c, i) => i === 0 || c.rating > cards[i - 1].rating), lang + ": the cards climb the ladder in rating order");
    const ladder = EXPECT[lang].spar.concat(EXPECT[lang].engine);
    const off = cards.map((c, i) => [c.sub, ladder[i]]).filter(([sub]) => ladder.includes(sub));
    assert(off.length >= 18 && off.every(([sub, want]) => sub === want),
      lang + ": each card's rung is the reviewed label — " + off.map(([sub]) => sub).join(" / "));
    await ctx.close();
  }
}

// --- 3b. the bar over the board holds the move, and nothing else -----------
// Those 44px were permanently reserved above a board that is height-bound in
// every window this ships in, so they came off the board's edge: 5.2% of it at
// 1400x900, 8.7% at 640x560. What they held was three things on three clocks —
// a mode switch used once a session, a status that changes every ply, and
// tools used mid-move — in three heights and two baselines, because nothing in
// the row shared a unit. It is 32px now, and it holds one sentence and the two
// actions that belong to the move being made.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const where = await page.evaluate(() => {
    const seg = document.getElementById("mode-seg");
    return {
      inChrome: !!(seg && seg.closest(".chrome")),
      inPanel: !!(seg && seg.closest(".side")),
      navRowsInPanel: document.querySelectorAll(".side .mode-nav, .side .side-tabs").length,
      // 9.0 S3: 训练's segment switch is the panel's only row of ways in, and
      // only while training — 下棋 does not carry it
      trainSegShown: (() => { const t = document.getElementById("train-seg"); return !!(t && !t.hidden && t.offsetParent); })(),
      inDialog: !!(seg && seg.closest("#newgame-modal")),
      rail: [...document.querySelectorAll("#rail button[data-view]")].map((b) => b.dataset.view).join(","),
    };
  });
  assert(!where.inChrome, "the mode switch is off the bar over the board");
  // v8-0-plan A1: and off the panel — 人机 / 双人 with the new game, the
  // trainers on the rail
  assert(!where.inPanel && where.inDialog, "…off the panel, in the new-game dialog");
  // 9.0 S5: the rail ends in 设置 (the preferences window and the 设置 tab, one page)
  // 9.0 S3: 谜题 and 学习 are one entry, 训练 (its segments over the panel)
  assert(where.rail === "home,play,train,library,me,settings", "…and the modes are the rail's (" + where.rail + ")");
  assert(!where.trainSegShown, "…and 下棋's panel does not carry 训练's segment switch");
  // 9.0 S5: the panel's tab row went with its 设置 tab — one pane, so no
  // navigation row in the panel at all (it was "one, not two")
  assert(where.navRowsInPanel === 0,
    "the panel has no navigation row of its own (" + where.navRowsInPanel + ")");

  // …and the chrome carries one meaning per element: whose move, the two
  // actions for the move being made, the panel toggle. The wordmark and the
  // unlabelled move counter went in 2.0; mode, flip and new game went here.
  // 7.9 §1a: the two actions went to the opponent's strip, so the bar holds
  // the panel toggle alone.
  const chrome = await page.evaluate(() => ({
    brand: document.querySelectorAll(".chrome .brand").length,
    counter: document.querySelectorAll(".chrome #moves").length,
    pill: (document.getElementById("status") || {}).textContent || "",
    ids: [...document.querySelectorAll(".chrome button")].map((b) => b.id),
    // the one filled button in the app was "new game", over the board
    primaries: document.querySelectorAll(".chrome .primary, #strip-tools .primary").length,
    tools: [...document.querySelectorAll("#strip-tools button")].map((b) => b.id),
  }));
  assert(chrome.brand === 0, "the wordmark is gone from the chrome");
  assert(chrome.counter === 0, "…and so is the unlabelled move counter");
  assert(chrome.pill.length <= 16,
    "the status pill holds a phrase, not a sentence (" + chrome.pill.length + " chars: " + chrome.pill + ")");
  // 9.0 V3: ☰ is the strip's last control; the bar has no buttons left
  assert(chrome.ids.length === 0, "the bar has no buttons (" + chrome.ids.join(", ") + ")");
  assert(JSON.stringify(chrome.tools) === JSON.stringify(["undo", "btn-hint", "toggle-panel"]),
    "…and the strip's tools are take-back, hint, ☰ — in that order (" + chrome.tools.join(", ") + ")");
  assert(chrome.primaries === 0,
    "nothing over the board is styled as the action to take");

  // Undo is absent until there is a move to take back, and this group is
  // right-aligned, so whatever appears pushes only what is to its left. With
  // undo in the middle it pushed 提示 56px sideways and landed in the pixels
  // 提示 had just left — two clicks in one place, help then take-back.
  const shift = await page.evaluate(async () => {
    const at = () => [...document.querySelectorAll("#strip-tools button")]
      .map((b) => ({ id: b.id, l: Math.round(b.getBoundingClientRect().left),
                     shown: getComputedStyle(b).visibility === "visible" }));
    const before = at();
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect(), s = r.width / 8;
    const click = (c, rw) => {
      for (const type of ["pointerdown", "pointerup", "click"])
        cv.dispatchEvent(new MouseEvent(type,
          { clientX: r.left + (c + 0.5) * s, clientY: r.top + (rw + 0.5) * s, bubbles: true }));
    };
    click(4, 6); await new Promise((z) => setTimeout(z, 150));
    click(4, 4); await new Promise((z) => setTimeout(z, 500));
    return { before, after: at() };
  });
  const moved = shift.after.filter((a) => {
    const b = shift.before.find((x) => x.id === a.id);
    return b && Math.abs(b.l - a.l) > 1;
  });
  const undoBefore = shift.before.find((b) => b.id === "undo");
  const undoAfter = shift.after.find((b) => b.id === "undo");
  assert(undoBefore && !undoBefore.shown, "take-back is not shown with nothing to take back");
  assert(undoAfter && undoAfter.shown, "…and is shown once there is");
  assert(moved.length === 0,
    "…without moving anything in the group, itself included (moved: " +
    moved.map((m) => m.id).join(", ") + ")");
  // it is the trade that is dangerous: after 1.e4 it is the engine's move, so
  // hint goes away in the same repaint that take-back arrives
  const hintBefore = shift.before.find((b) => b.id === "btn-hint");
  const hintAfter = shift.after.find((b) => b.id === "btn-hint");
  assert(hintBefore.shown && !hintAfter.shown,
    "hint leaves in the same repaint — after 1.e4 it is the engine's move");
  assert(hintAfter.l === hintBefore.l && undoAfter.l !== hintBefore.l,
    "…keeping its own slot rather than handing it to take-back (hint " +
    hintBefore.l + "→" + hintAfter.l + ", take-back at " + undoAfter.l + ")");
  // a slot nobody can use is a slot nobody can tab into
  const reach = await page.evaluate(() =>
    [...document.querySelectorAll("#strip-tools button")]
      .filter((b) => getComputedStyle(b).visibility !== "visible")
      .every((b) => b.offsetParent === null || !b.checkVisibility({ visibilityProperty: true })));
  assert(reach, "an empty slot is not reachable by keyboard");
  await ctx.close();
}

// --- 3b2. one height, one baseline ----------------------------------------
// The alignment this bar could never reach: 36 / 32 / 27.4px and baselines
// 26.5 / 25.3, because the mode row sized from --row-h, the buttons were a
// literal 32 and the pill was 4px of padding around whatever the text
// measured. 9.0 V3: wider than 820px the bar holds nothing to see (☰ is the
// strip's) and takes no height; at 820 and under it is the rail's row, and
// that row is one height on one centre line, inside the bar.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    const wide = await page.evaluate(() => document.querySelector(".chrome").getBoundingClientRect().height);
    assert(wide === 0, lang + ": 1400 wide, the bar takes no height (" + wide + ")");
    await page.setViewportSize({ width: 760, height: 900 });
    await page.waitForTimeout(400);
    const bar = await page.evaluate(() => {
      const ch = document.querySelector(".chrome");
      const cr = ch.getBoundingClientRect();
      const items = [...document.querySelectorAll(".rail .rail-btn")]
        .filter((e) => e.checkVisibility({ visibilityProperty: true }) && e.getBoundingClientRect().width > 0);
      const cs = getComputedStyle(ch);
      return {
        chrome: { t: cr.top, b: cr.bottom },
        padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
        items: items.map((e) => {
          const b = e.getBoundingClientRect();
          return { id: e.id || e.dataset.view, h: Math.round(b.height * 10) / 10,
                   mid: Math.round((b.top + b.bottom) / 2 * 10) / 10,
                   past: Math.round((b.bottom - cr.bottom) * 10) / 10 };
        }),
      };
    });
    const heights = [...new Set(bar.items.map((i) => i.h))];
    const mids = [...new Set(bar.items.map((i) => i.mid))];
    assert(bar.items.length >= 5 && heights.length === 1,
      lang + ": 760 wide, everything in the bar is one height (" + heights.join(", ") + ")");
    assert(mids.length === 1,
      lang + ": …on one centre line (" + mids.join(", ") + ")");
    const barMid = Math.round((bar.chrome.t + bar.chrome.b) / 2 * 10) / 10;
    assert(Math.abs(mids[0] - barMid) <= 0.5,
      lang + ": …which is the bar's own (" + mids[0] + " vs " + barMid + ")");
    for (const i of bar.items)
      assert(i.past <= 0, lang + ": " + i.id + " stays inside the bar (past by " + i.past + ")");
    assert(bar.padL === bar.padR,
      lang + ": the bar's insets match (" + bar.padL + " / " + bar.padR + ")");
    await ctx.close();
  }
}

// --- 3c. the player strips: each side on its own edge of the board ---------
// 7.7 (v7-7-plan §2). From 2.2 to 7.6 the whole match — both colours, both
// names, both clocks, the material, the last move — was one 32px row in the
// top bar, with whose move it was in a pill in the corner. Now each side is a
// 40px strip on its own edge of the board: the opponent above, you below,
// following the board when it turns; the side to move is lit (.is-active);
// the end of the game puts 1 / 0 / ½ on them. (Through 7.6 this section
// asked the same questions of the match bar: nothing patches the panel-shut
// case, both players stay named with the panel shut.)
// v8-0-plan A2: from a 1280-wide play view the strips are the cards of the
// info column instead (asserted in the A2 section at the end of this file),
// so this is measured in the two-column layout, at 1200×900.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1200, height: 900 });
  const clickSquares = async (list) => {
    for (const sq of list) {
      const pt = await page.evaluate((sqr) => {
        const c = document.getElementById("board"), r = c.getBoundingClientRect();
        const fl = document.getElementById("strip-w").classList.contains("at-top");
        const f = sqr.charCodeAt(0) - 97, rk = 8 - Number(sqr[1]);
        const co = fl ? 7 - f : f, ro = fl ? 7 - rk : rk;
        return { x: r.left + (co + 0.5) * (r.width / 8), y: r.top + (ro + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(200);
    }
  };
  const read = () => page.evaluate(() => {
    const box = (id) => { const b = document.getElementById(id).getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right, h: b.height }; };
    const s = (side) => {
      const e = document.getElementById("strip-" + side);
      return { ...box("strip-" + side), shown: !!e.offsetParent && getComputedStyle(e).visibility === "visible",
        top: e.classList.contains("at-top"), active: e.classList.contains("is-active"),
        name: document.getElementById(side === "w" ? "white-role" : "black-role").textContent.trim(),
        result: (() => { const r = document.getElementById("result-" + side); return r.hidden ? null : r.textContent.trim(); })() };
    };
    return { w: s("w"), b: s("b"), board: box("board-wrap"),
             status: document.getElementById("status").textContent.trim(),
             statusSr: getComputedStyle(document.getElementById("status")).clip !== "auto",
             spine: !!document.getElementById("spine"), bar: !!document.getElementById("vs-bar") };
  });
  const fresh = await read();
  assert(!fresh.spine && !fresh.bar, "no spine, no match bar in the chrome — the strips hold the match");
  assert(fresh.w.shown && fresh.b.shown, "two strips, both drawn");
  assert(!fresh.w.top && fresh.b.top, "White (the side at the bottom of an unflipped board) has the bottom strip");
  assert(Math.abs(fresh.b.b - fresh.board.t) <= 1 && Math.abs(fresh.w.t - fresh.board.b) <= 1,
    "…and they hug the board's top and bottom edges (" + [fresh.b.b, fresh.board.t, fresh.w.t, fresh.board.b].map(Math.round).join(" / ") + ")");
  assert(fresh.w.h === 40 && fresh.b.h === 40, "…40px each (" + fresh.w.h + " / " + fresh.b.h + ")");
  assert(fresh.w.name === "玩家 1" && fresh.b.name === "玩家 2", "two players are both named (" + fresh.w.name + " / " + fresh.b.name + ")");
  assert(fresh.w.active && !fresh.b.active, "the side to move is the lit one — White before the first move");
  assert(fresh.status.length > 0 && fresh.statusSr, "the whose-move sentence is still there for a screen reader, and only for one (" + fresh.status + ")");
  await clickSquares(["f2", "f3"]);
  const played = await read();
  assert(played.b.active && !played.w.active, "…and after 1.f3 it is Black's strip that is lit");

  await page.click("#toggle-panel");
  await page.waitForTimeout(400);
  const shut = await read();
  assert(shut.w.shown && shut.b.shown && shut.w.name && shut.b.name,
    "shutting the panel does not take the players away (" + shut.w.name + " / " + shut.b.name + ")");
  // F turns the board and the strips go with it
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  const flipped = await read();
  assert(flipped.w.top && !flipped.b.top, "a flipped board carries the strips round: White is above now");
  assert(Math.abs(flipped.w.b - flipped.board.t) <= 1, "…still hugging the edge it moved to");
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  // Fool's mate: the result goes on the strips, and nobody is lit any more
  await clickSquares(["e7", "e5", "g2", "g4", "d8", "h4"]);
  await page.waitForTimeout(400);
  const over = await read();
  assert(over.w.result === "0" && over.b.result === "1", "checkmate writes the score on the strips (" + over.w.result + " / " + over.b.result + ")");
  assert(!over.w.active && !over.b.active, "…and neither side is lit once the game is over");
  await ctx.close();
}

// the persona's icon on the engine's strip, and the imported names (7.6) on
// a loaded game's
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const r = await page.evaluate(() => ({
    bName: document.getElementById("black-role").textContent.trim(),
    bLevel: document.getElementById("black-level").textContent.trim(),
    bIcon: (document.querySelector("#av-b svg") || {}).dataset?.icon,
    wIcon: (document.querySelector("#av-w svg") || {}).dataset?.icon,
    wName: document.getElementById("white-role").textContent.trim(),
  }));
  // v8-0-plan B4: the persona of the rung (中级, no style: 索尔, a star), with its rating
  assert(r.bName === "索尔" && /中级 1700/.test(r.bLevel), "the engine's strip names its persona, level and rating (" + r.bName + " · " + r.bLevel + ")");
  assert(r.bIcon === "star" && r.wIcon === "user", "…with the persona's icon on it, and yours on your own (" + r.bIcon + " / " + r.wIcon + ")");
  await ctx.close();
}

// --- 3c2. the clocks are blocks on the strips, and the running one is lit --
// (v8-0-plan A2: in the two-column layout; the wide one's clock is the last
// line of its card, asserted with the A2 checks)
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1200, height: 900 });
  // 9.0 S5: the clock is chosen with the game — the new-game dialog's 棋钟
  // 9.0 S2: 3+2 is one of the rarer clocks, under 更多选项 (#clock-seg-more)
  await openNewGame(page);
  await page.click('#newgame-modal #clock-seg-more button[data-tc="3+2"]');
  await startNewGame(page);
  const c = await page.evaluate(() => {
    const w = document.getElementById("clock-w"), b = document.getElementById("clock-b");
    const sw = document.getElementById("strip-w"), sb = document.getElementById("strip-b");
    const rw = w.getBoundingClientRect(), rs = sw.getBoundingClientRect();
    return { inStrips: sw.contains(w) && sb.contains(b),
             right: Math.round(rs.right - rw.right),
             shown: !!w.offsetParent && !!b.offsetParent,
             w: w.textContent.trim(), b: b.textContent.trim(),
             active: [w, b].filter((e) => e.classList.contains("active")).map((e) => e.id) };
  });
  assert(c.inStrips, "each clock is on its own side's strip");
  assert(c.right <= 4, "…right-aligned, at the strip's end (" + c.right + "px in)");
  assert(c.shown, "…and a timed game shows them");
  assert(c.w === "3:00" && c.b === "3:00", "…set to the control just chosen (" + c.w + " / " + c.b + ")");
  // Nothing is lit yet: the clock does not start until the board is touched.
  assert(c.active.length === 0, "…and neither is running before the first move (" + c.active.join(", ") + ")");
  for (const sq of ["e2", "e4"]) {
    const pt = await page.evaluate((sqr) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      return { x: r.left + (sqr.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
               y: r.top + (8 - Number(sqr[1]) + 0.5) * (r.height / 8) };
    }, sq);
    await page.mouse.click(pt.x, pt.y);
  }
  await page.waitForTimeout(500);
  const after = await page.evaluate(() => ["clock-w", "clock-b"]
    .filter((id) => document.getElementById(id).classList.contains("active")));
  assert(after.length === 1 && after[0] === "clock-b",
    "1.e4 starts the clock, and the lit one is the side that has to answer (" + after.join(", ") + ")");
  await ctx.close();
}

// --- 3c3. the strips fit, in three languages at three window sizes ---------
// The widest a strip gets is an engine game with a persona, a clock and a
// row of captures. What must never happen: the strip running past the board
// it belongs to, or the clock being pushed off it.
if (scenario()) for (const [w, h] of [[1400, 900], [900, 700], [520, 520]]) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play", "wood", { width: w, height: h });
    // 9.0 S5: style and clock are the new-game dialog's; 开始 makes them the game's
    await openNewGame(page);
    await page.click('#newgame-modal #persona-seg button[data-persona="principled"]');
    await page.click('#newgame-modal #clock-seg-more button[data-tc="3+2"]');
    await startNewGame(page);
    if (w <= 820) { await page.keyboard.press("p"); await page.waitForTimeout(400); }
    const r = await page.evaluate(() => {
      const ch = document.querySelector(".chrome");
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      const one = (side) => {
        const s = document.getElementById("strip-" + side), b = s.getBoundingClientRect();
        const clk = document.getElementById("clock-" + side).getBoundingClientRect();
        return { over: s.scrollWidth - s.clientWidth, l: b.left, r: b.right, clkR: clk.right, clkW: clk.width,
                 inView: b.top >= 0 && b.bottom <= innerHeight };
      };
      return { chromeOver: ch.scrollWidth - ch.clientWidth, wrap: { l: wrap.left, r: wrap.right }, w: one("w"), b: one("b"),
               wide: document.getElementById("app").classList.contains("pv-wide") };
    });
    const at = lang + " " + w + "x" + h + ": ";
    assert(r.chromeOver <= 0, at + "顶栏没有被撑破(溢出 " + r.chromeOver + "px)");
    for (const side of ["w", "b"]) {
      const s = r[side];
      assert(s.over <= 0, at + side + " 对阵条没有溢出(" + s.over + "px)");
      // v8-0-plan A2: in the wide layout a strip is a card of the column left of the board
      if (r.wide) assert(s.l >= 0 && s.r <= r.wrap.l - 1, at + side + " 对阵条（宽布局的卡片）在棋盘左边的信息栏里");
      else assert(s.l >= r.wrap.l - 1 && s.r <= r.wrap.r + 1, at + side + " 对阵条不超出棋盘宽度");
      assert(s.clkW > 0 && s.clkR <= s.r + 1, at + side + " 棋钟在条内(" + Math.round(s.clkR) + " ≤ " + Math.round(s.r) + ")");
      assert(s.inView, at + side + " 对阵条在窗口里");
    }
    await ctx.close();
  }
}
// --- 3d. no visible control is disabled -----------------------------------
// P3's acceptance criterion, and P3.3's whole content. At 0 moves twelve
// visible controls were explicitly disabled — take back, the five replay keys,
// resume-from-here, copy PGN, export, offer draw, claim draw, resign, plus
// analyse and deep-analyse. A disabled control is a promise the interface is
// not keeping: it occupies the layout, it names an action, and it does
// nothing. Grouping actions by tense means the ones that cannot apply are not
// there at all.
//
// Confirmation buttons are the stated exception — a destructive action asking
// "are you sure" may hold its confirm until the box is read.
//
// Four modes, not one. This section spent seven versions looking only at 人机,
// and the lesson row only exists in 教学 — so 「去人机·新手」 on lesson 72 sat
// there greyed at opacity .35 the whole time, which is the exact shape of the
// thing this section was written to forbid. Found by asking the same question
// in all four modes; it was the only one in eight states.
if (scenario()) for (const [when, mode, setup] of [
  ["人机·开局前", "ai", async () => {}],
  ["双人·开局前", "pvp", async () => {}],
  ["做题·第 1 题", "puzzle", async () => {}],
  ["教学·第 1 课", "learn", async () => {}],
  // The last lesson, reached the way anyone would reach it — from the list —
  // without having finished it. 「去人机·新手」 is graduation, so it is right
  // that it is not offered here; being *drawn* and not offered is the defect.
  ["教学·最后一课(没做过)", "learn", async (page) => {
    await page.evaluate(() => {
      const items = [...document.querySelectorAll("#lesson-list .lesson-item:not([data-c]):not([data-eg]):not([data-gs])")];
      items[items.length - 1].click();
    });
    await page.waitForTimeout(800);
    // v8-2-plan T1: the last lesson is 预防 now (lesson 120), whose first task
    // is a move, so a first visit plays its answer once; 演示 is disabled only
    // while that plays (trainer/lessons.js syncLearnUI). Measure the lesson as
    // it stands once the demo is over, as a player sees it.
    await page.waitForFunction(() => !document.getElementById("lesson-demo").disabled, null, { timeout: 6000 }).catch(() => {});
  }],
  ["人机·进行中", "ai", async (page) => {
    // two plies, played through the board like a person would
    for (const sq of ["e2", "e4", "e7", "e5"]) {
      const c = await page.evaluate((s2) => {
        const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
        const f = s2.charCodeAt(0) - 97, rk = 8 - Number(s2[1]);
        return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(120);
    }
  }],
]) {
  const { ctx, page } = await open("zh-CN", mode, "play");
  await setup(page);
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button, input, select")) {
      if (!b.disabled) continue;
      if (!b.offsetParent && getComputedStyle(b).position !== "fixed") continue; // not rendered
      if (b.closest(".modal-bg")) continue;                                      // a dialog's own controls
      // 7.7 (v7-7-plan §1f): the four transport keys are always drawn and the
      // ones that lead nowhere are disabled in place — their positions are
      // what they mean, so a missing key reshapes the control
      if (b.closest("#replay-seg")) continue;
      out.push(b.id || b.textContent.trim().slice(0, 12) || b.className);
    }
    return out;
  });
  for (const b of bad) console.error("  visible but disabled: " + b);
  assert(bad.length === 0,
    when + ":屏幕上没有被禁用的可见控件" + (bad.length ? " —— " + bad.join(", ") : ""));
  await ctx.close();
}

// --- 3d2. no visible control is dead --------------------------------------
// 3d asks whether a control is `disabled`. That is the honest half of the
// question: a control can also be enabled, drawn, and do nothing at all — and
// that failure is *worse*, because the disabled one at least looks unavailable.
//
// This is how 「答案」 was found. In 做题, once the puzzle is solved,
// showPuzzleAnswer() returns immediately (`done`), but nobody stopped drawing
// the button: pressing it changed the canvas by exactly 0 pixels and produced
// no toast. Measured across seven states — 做题 solved / unsolved, 人机 at move
// 0 / after two plies, 教学 lesson 1, 设置, 记录 — it was the only one, which
// is why it is worth a guard rather than a habit: the rule already held
// everywhere else and had one hole.
//
// Method: press every visible control, each in a FRESH page, and see whether
// anything moved — the DOM under #app, the canvas, localStorage, or the toast.
// A fresh page per control because clicking is not free of consequence and the
// order would otherwise decide the answer.
//
// Three exclusions, each a real one rather than a convenience:
//   · `visibility: hidden` slot-holders — the chrome and the replay bar hold
//     their geometry with invisible buttons on purpose (see .slot-empty), and
//     `offsetParent` is non-null for those. Reading them as visible is what
//     the first version of this did, and it reported 悔棋 and three transport
//     keys as dead.
//   · the tab you are already on — selecting the view you are looking at is
//     not a promise to change anything.
//   · anything that needs the engine (提示): the vendored engine does not
//     initialise in a headless page, so a dead 提示 here would be a fact about
//     the harness, not about the app.
if (scenario()) {
  const STATES = [
    ["做题·解出后", { mode: "puzzle", tab: "play" }, async (page, sqClick) => {
      await sqClick("a1"); await sqClick("a8");   // Ra8# — puzzle 1 is m1-backrank-r
      await page.waitForTimeout(1200);
    }],
    // 9.0 S5: the 设置 tab's switches (自动翻转, 盲棋, 箭头, 存疑标注…) are on
    // the settings page, a category at a time — each category its own state,
    // its own pane's controls; the category list itself is pressed once.
    // 数据 is not here, as the 偏好设置 window it came from never was: its
    // buttons open the OS file chooser or a download, which a headless page
    // cannot see happen.
    ["双人·设置·棋盘", { mode: "pvp", tab: "settings", sel: "#page-settings .set-pane:not([hidden]) button[id], #page-settings .set-cat[id]", min: 7 },
      async (page) => { await showCat(page, "board"); }],
    ["双人·设置·声音", { mode: "pvp", tab: "settings", sel: "#page-settings .set-pane:not([hidden]) button[id]", min: 1 },
      async (page) => { await showCat(page, "sound"); }],
    ["双人·设置·对局", { mode: "pvp", tab: "settings", sel: "#page-settings .set-pane:not([hidden]) button[id]", min: 2 },
      async (page) => { await showCat(page, "game"); }],
    ["双人·设置·高级", { mode: "pvp", tab: "settings", sel: "#page-settings .set-pane:not([hidden]) button[id]", min: 2 },
      async (page) => { await showCat(page, "advanced"); }],
    // 9.0 S3: 训练's own controls — the switch over the panel (the segment
    // you are on excepted, as the tab you are on is), and the puzzle picker:
    // 为你出一题, 复习, the six kinds, 换个练法, 按主题细分. Most carry no id,
    // so they are found again by their group and their data attribute.
    ["训练·谜题·选题器", { mode: "puzzle", tab: "play", min: 12,
      sel: "#train-seg button, #pz-hero button, #pz-review, #pz-groups button, #pz-modes button, #pz-themes-row button" },
      async () => {}],
    ["训练·名局·读谱", { mode: "learn", tab: "play", min: 4, sel: "#train-seg button, #classic-mode button" },
      async (page) => { await page.click('#train-seg button[data-seg="classic"]'); await page.waitForTimeout(700); }],
  ];
  const ENGINE_BOUND = ["btn-hint"];
  for (const [label, cfg, prep] of STATES) {
    const fresh = async () => {
      const { ctx, page } = await open("zh-CN", cfg.mode, cfg.tab);
      const sqClick = async (sqr) => {
        const pt = await page.evaluate((x) => {
          const c = document.getElementById("board"), r = c.getBoundingClientRect();
          return { x: r.left + (x.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                   y: r.top + (8 - Number(x[1]) + 0.5) * (r.height / 8) };
        }, sqr);
        await page.mouse.click(pt.x, pt.y);
        await page.waitForTimeout(240);
      };
      await prep(page, sqClick);
      await page.waitForTimeout(300);
      return { ctx, page };
    };
    const snapshot = (page) => page.evaluate(() => {
      const hash = (str) => { let h = 7; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0; return h; };
      const c = document.getElementById("board");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let ch = 7; for (let i = 0; i < d.length; i += 401) ch = (ch * 31 + d[i]) | 0;
      const store = Object.keys(localStorage).sort().map((k) => k + "=" + localStorage.getItem(k)).join("\u0000");
      const toast = document.getElementById("toast");
      return [hash(document.getElementById("app").innerHTML), ch, hash(store), toast ? toast.textContent.trim() : ""].join("/");
    });

    // Wait for silence first, and wait for it properly. The toast lives inside
    // #app and only loses its `show` class when it expires, so a snapshot taken
    // while one is still on screen differs from the next one no matter what the
    // button did — a false *negative*, because it makes every control look
    // alive. Two versions of this section got that wrong before this one: the
    // first took the snapshot straight after the setup, and the second waited
    // for two equal samples 400ms apart, which converges happily in the middle
    // of a toast that is about to expire. Solving a puzzle raises two of them,
    // 1.6s apart, so the quiet has to be longer than that gap to be quiet.
    const QUIET_MS = 2000;
    const quiet = async (page) => {
      let since = 0;
      for (let i = 0; i < 40; i++) {
        const showing = await page.evaluate(() => {
          const t = document.getElementById("toast");
          return !!t && t.classList.contains("show");
        });
        since = showing ? 0 : since + 300;
        if (since >= QUIET_MS) return;
        await page.waitForTimeout(300);
      }
    };
    const { ctx: c0, page: p0 } = await fresh();
    const ids = await p0.evaluate((sel) => [...document.querySelectorAll(sel)]
      .filter((b) => b.offsetParent && !b.disabled && getComputedStyle(b).visibility === "visible")
      .filter((b) => b.getAttribute("aria-selected") !== "true")
      // a segment switch's lit segment is the view you are on (训练, 名局)
      .filter((b) => !(b.closest("#train-seg, #classic-mode") && b.getAttribute("aria-pressed") === "true"))
      .map((b) => {
        if (b.id) return "#" + CSS.escape(b.id);
        const host = b.parentElement.closest("[id]");
        const attr = [...b.attributes].find((a) => a.name.startsWith("data-") && !a.name.startsWith("data-i18n") && a.name !== "data-icon");
        return "#" + CSS.escape(host.id) + " button" + (attr ? "[" + attr.name + '="' + attr.value + '"]' : "");
      }), cfg.sel || "#side button[id], .chrome button[id], #strip-tools button[id]");
    await c0.close();
    assert(ids.length >= (cfg.min || 4), label + ":这个状态下数得到可以按的控件(" + ids.length + " 个)");

    const dead = [];
    for (const id of ids) {
      if (ENGINE_BOUND.includes(id.slice(1))) continue;
      const { ctx, page } = await fresh();
      // focus the button first: clicking it would otherwise also blur the
      // canvas, and erasing the keyboard cursor is a canvas change worth
      // exactly 3384 pixels that has nothing to do with the button
      await page.evaluate((i) => document.querySelector(i).focus(), id);
      await page.waitForTimeout(200);
      await quiet(page);
      const before = await snapshot(page);
      await page.click(id, { timeout: 2000 }).catch(() => {});
      await page.waitForTimeout(800);
      if (await snapshot(page) === before) dead.push(id);
      await ctx.close();
    }
    assert(dead.length === 0,
      label + ":每个画出来的控件按下去都真的做了点什么" + (dead.length ? " —— 什么也没做的:" + dead.join(", ") : ""));
  }
}

// --- 3d3. 自动翻转 turns the board for the player, not for the reviewer ----
// The switch says 「每步走完后棋盘转向走子方」 — after a move is *played*. But
// syncAutoFlip() was called from setViewIndex() as well, so every ‹ and › in a
// pvp game swapped the board end for end: measured on a three-ply game, 黑 →
// 黑 → 黑 became 黑 → 白 → 黑 stepping back, which is 100% of the steps,
// because the sides alternate. Reviewing a 40-move game meant eighty flips —
// and eighty writes of the settings file, because the flip saves itself so a
// reload mid-game faces the right player.
//
// Both halves are asserted, because the fix must not cost the feature: while
// the game is live the board still turns after every move, and ● still brings
// it back to whoever is on move.
if (scenario()) {
  // through the switch itself, which is also a control no test had ever pressed
  // 9.0 S5: 自动翻转 is the settings page's 「对局」 category now
  const { ctx, page } = await open("zh-CN", "pvp", "settings");
  await showCat(page, "game");
  await page.click("#opt-autoflip");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.getElementById("opt-autoflip").getAttribute("aria-pressed")) === "true",
    "自动翻转:开关按下去真的开了");
  // back to the board by the rail (was: the panel's 对局 tab)
  await page.click('.rail-btn[data-view="play"]');
  await page.waitForTimeout(400);
  const view = () => page.evaluate(() => [...document.querySelectorAll("#orient-seg button")]
    .filter((b) => b.classList.contains("active")).map((b) => b.dataset.orient)[0]);
  const play = async (sqr) => {
    const flipped = (await view()) === "b";
    const pt = await page.evaluate(([x, fl]) => {
      const c = document.getElementById("board"), r = c.getBoundingClientRect();
      let f = x.charCodeAt(0) - 97, rk = 8 - Number(x[1]);
      if (fl) { f = 7 - f; rk = 7 - rk; }
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, [sqr, flipped]);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(260);
  };
  await play("e2"); await play("e4");
  assert(await view() === "b", "自动翻转:白走完一手,棋盘转向黑方");
  await play("e7"); await play("e5");
  assert(await view() === "w", "……黑走完一手,再转回来");
  await play("g1"); await play("f3");
  assert(await view() === "b", "……白再走一手,又转过去(实战期间照常翻)");

  const writes = await page.evaluate(() => {
    let n = 0; const orig = Storage.prototype.setItem;
    Storage.prototype.setItem = function (...a) { n++; return orig.apply(this, a); };
    window.__writes = () => n; return 0;
  });
  await page.click("#rep-prev"); await page.waitForTimeout(400);
  assert(await view() === "b", "复盘退一手,棋盘不动 —— 复盘不是对局");
  await page.click("#rep-prev"); await page.waitForTimeout(400);
  assert(await view() === "b", "……再退一手,还是不动");
  assert(await page.evaluate(() => window.__writes()) === 0,
    "……而且这两步没有写设置(此前每翻一次就存一次盘)");
  // 7.7: ● (回到最新) did what » does, and is gone; » is the way back
  await page.click("#rep-end"); await page.waitForTimeout(500);
  assert(await view() === "b", "按 » 回到实战位置,棋盘仍朝着该走子的一方");
  await ctx.close();
}

// --- 3h. nothing is truncated, in any language, on any theme --------------
// P4.7, as a gate rather than a review: after a remake, the thing that breaks
// first is a label that fits in the language it was designed in. A clipped
// label is detectable — scrollWidth exceeds clientWidth — so it need not be
// looked for by eye. The status pill is exempt: it ellipsizes on purpose.
if (scenario()) for (const lang of LANGS) {
  for (const theme of ["wood", "day"]) {
    // 9.0 S5: what the 设置 tab held is the settings page (a category at a
    // time, so each one is read) and the new-game dialog (its 「对局」 fold:
    // 档位 / 风格 / 执子 / 棋钟)
    const { ctx, page } = await open(lang, "ai", "settings");
    await page.evaluate((th) => document.documentElement.setAttribute("data-theme", th), theme);
    await page.waitForTimeout(250);
    const readClipped = (where) => page.evaluate((w) => {
      const out = [];
      for (const e of document.querySelectorAll("button, .setting-k, .side-h, .act-k, .vs-role")) {
        if (!e.offsetParent) continue;
        if (e.id === "status" || e.closest("#status")) continue;   // ellipsizes on purpose
        if (e.classList.contains("switch")) continue;              // a knob, not a label
        // 9.0 S5: 语言 / 外观 have a card heading, so their row labels are
        // screen-reader text (.sr-only: a 1px box on purpose, not a clip)
        if (e.closest(".sr-only")) continue;
        if (e.scrollWidth > e.clientWidth + 1) {
          out.push(w + ":" + (e.id || e.textContent.trim().slice(0, 14)) + " " + e.scrollWidth + ">" + e.clientWidth);
        }
      }
      return out;
    }, where);
    const clipped = [];
    for (const cat of CATS) {
      await showCat(page, cat);
      clipped.push(...await readClipped(cat));
    }
    await page.click('.rail-btn[data-view="play"]'); await page.waitForTimeout(300);
    await openNewGame(page);
    clipped.push(...await readClipped("newgame"));
    for (const c of new Set(clipped)) console.error("  clipped: " + c);
    assert(clipped.length === 0,
      lang + "/" + theme + ":没有被裁掉的标签" + (clipped.length ? " —— " + [...new Set(clipped)].join(", ") : ""));
    await ctx.close();
  }
}

// --- 3i. nothing in the panel is cut off by the panel's edge --------------
// Measured, not guessed: on the code before this check, the three deletion
// buttons came to 90 + 102 + 66 plus gaps = 266px inside a 240px pane, and the
// last 26px — the tail of 清除全部存档 — was clipped by the pane. 3h above did
// not see it, and could not: it asks each label whether *it* scrolls, and a
// <button> with overflow: visible whose text runs past its box reports a
// scrollWidth clamped to its own padding box. The overflow is only visible on
// the ancestor that clips, and that ancestor is a scroller.
//
// So the question asked here is the one the eye asks: does anything stick out
// past the right edge of the panel. Element right edges, not scrollWidth —
// which also means the two things that deliberately paint outside their boxes
// are silent by construction rather than by exception, because both are
// pseudo-elements and neither is in the DOM: the switch's ::after hit target
// (inset -6px -2px) and the disclosure ›, which is rotated 90° when open.
// 9.0 S5: the 设置 tab (and with it the three deletions) is the settings
// page; there the edge that clips is each category's card (.set-sec) and the
// page itself, read one category at a time.
if (scenario()) for (const tab of ["play", "settings"]) {
  const { ctx, page } = await open("zh-CN", "ai", tab);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#side details")) d.open = true;
  });
  await page.waitForTimeout(300);
  const past = () => page.evaluate((onPage) => {
    const res = [];
    if (!onPage) {
      const side = document.getElementById("side");
      const edge = side.getBoundingClientRect().right;
      for (const e of side.querySelectorAll("*")) {
        if (!e.offsetParent) continue;
        const r = e.getBoundingClientRect();
        if (r.width === 0) continue;
        if (r.right > edge + 1) {
          res.push((e.id || e.className || e.tagName) + " right=" + Math.round(r.right) +
            " panel=" + Math.round(edge));
        }
      }
      return res;
    }
    const pg = document.getElementById("page-settings");
    const pageEdge = Math.min(pg.getBoundingClientRect().right, document.documentElement.clientWidth);
    for (const e of pg.querySelectorAll(".set-pane:not([hidden]) *")) {
      if (!e.offsetParent) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      const card = e.closest(".set-sec");
      const edge = card ? Math.min(card.getBoundingClientRect().right, pageEdge) : pageEdge;
      if (r.right > edge + 1) {
        res.push((e.id || e.className || e.tagName) + " right=" + Math.round(r.right) +
          " card=" + Math.round(edge));
      }
    }
    return res;
  }, tab === "settings");
  const out = [];
  if (tab === "settings") {
    for (const cat of CATS) { await showCat(page, cat); out.push(...(await past()).map((o) => cat + ":" + o)); }
  } else out.push(...await past());
  for (const o of out) console.error("  past the panel edge: " + o);
  assert(out.length === 0,
    tab + (tab === "settings" ? " 页(六类):没有控件被卡片边缘裁掉" : " 面板:没有控件被面板边缘裁掉") + (out.length ? " —— " + out.join(", ") : ""));
  await ctx.close();
}

// --- 3j. no disabled control is on screen, in any tab ----------------------
// 3d asks this of the play tab at two moments in a game. The dimmed action
// links that prompted this were in the *setup* tab, where 3d never looked:
// `offsetParent` is null for anything in a pane that is not showing, so a
// check that only ever opens one tab cannot see the other two.
// 9.0 S5: the 设置 tab is the settings page — every category of it is read
if (scenario()) for (const tab of ["play", "settings"]) {
  const { ctx, page } = await open("zh-CN", "ai", tab);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#side details")) d.open = true;
  });
  await page.waitForTimeout(300);
  const read = () => page.evaluate((sel) => {
    const out = [];
    for (const b of document.querySelectorAll(sel)) {
      if (!b.disabled) continue;
      if (!b.offsetParent && getComputedStyle(b).position !== "fixed") continue;
      if (b.closest(".modal-bg")) continue;
      out.push(b.id || b.textContent.trim().slice(0, 12) || b.className);
    }
    return out;
  }, tab === "settings" ? "#page-settings button, #page-settings input, #page-settings select"
                        : "#side button, #side input, #side select");
  const bad = [];
  if (tab === "settings") for (const cat of CATS) { await showCat(page, cat); bad.push(...(await read()).map((b) => cat + ":" + b)); }
  else bad.push(...await read());
  for (const b of bad) console.error("  visible but disabled: " + b);
  assert(bad.length === 0,
    tab + (tab === "settings" ? " 页:设置里" : " 面板:侧栏里") + "没有被禁用的可见控件" + (bad.length ? " —— " + bad.join(", ") : ""));
  await ctx.close();
}

// --- 3k. every design token resolves, in every theme -----------------------
// The two worst defects in 2.0.0 were both invisible to a source-text check
// and both trivially visible here.
//
// One: a comment carrying the words `/* v1.9 polish */` closed itself early —
// CSS comments do not nest — and the parser's recovery swallowed the whole
// `:root, [data-theme="wood"]` block, i.e. every raw value and every semantic
// role of the DEFAULT theme. 271 rules parsed instead of 272; the panel
// rendered white with black text.
//
// Two: seven component variables were written `--accent: var(--accent)`. A
// custom property that references itself is invalid at computed-value time, so
// --accent, --danger, --primary-* and the three --on-* resolved to nothing in
// all four themes. The active tab's underline fell back to currentColor and
// the deletion links were not red.
//
// The unit suite has "every var() names a token that exists" — and it passed
// both times, because both tokens do exist in the text. Existing is not
// resolving. Only a browser can tell the difference.
if (scenario()) {
  const TOKENS = ["--bg","--panel","--panel-border","--text","--muted","--accent","--win",
    "--btn","--btn-hover","--btn-ghost","--card","--card-border",
    "--danger","--on-accent","--on-danger"];
  for (const theme of ["wood","night","day","notebook"]) {
    const { ctx, page } = await open("zh-CN", "ai", "settings", theme);
    const empty = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      return names.filter((n) => !cs.getPropertyValue(n).trim());
    }, TOKENS);
    for (const e of empty) console.error("  unresolved in " + theme + ": " + e);
    assert(empty.length === 0,
      theme + ":每个设计 token 都解析得出值" + (empty.length ? " —— 空的:" + empty.join(", ") : ""));
    await ctx.close();
  }
  // …and the stylesheet parsed whole: a swallowed block is a missing rule
  const { ctx, page } = await open("zh-CN", "ai", "settings");
  const sel = await page.evaluate(() => {
    const sh = [...document.styleSheets].find((s2) => (s2.href || "").includes("styles.css"));
    return [...sh.cssRules].map((r) => r.selectorText || "").filter(Boolean);
  });
  for (const want of [":root, [data-theme=\"wood\"]", "[data-theme=\"night\"]",
                      "[data-theme=\"day\"]", "[data-theme=\"notebook\"]"]) {
    assert(sel.includes(want), "样式表完整解析:" + want + " 这一块在");
  }
  await ctx.close();
}

// --- 3l. keyboard focus is visible ----------------------------------------
// The ring is color-mix(… var(--accent) …), so when --accent died the whole
// `outline` declaration went with it — and `outline-offset: 2px` from the same
// rule still applied, which is how you could tell the rule was matching and
// only that one line was being dropped. The comment above that rule exists
// because the app once shipped with the UA default at about 1.0:1. It was
// back to nothing.
if (scenario()) {
  // 9.0 S5: the settings page (was the 设置 tab) — the walk goes through the
  // rail, the category list and the open category's controls
  const { ctx, page } = await open("zh-CN", "ai", "settings");
  const bad = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      if (e.id === "board") return null;              // draws its own on-canvas cursor
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
                   cs.boxShadow !== "none" ||
                   e.matches(".text-input");           // inputs mark focus on the border
      return ring ? null : (e.id || e.className || e.tagName);
    });
    if (r) bad.push(r);
  }
  assert(bad.length === 0,
    "键盘 Tab 到的每个控件都有可见焦点环" + (bad.length ? " —— 没有的:" + [...new Set(bad)].join(", ") : ""));
  await ctx.close();
}

// --- 3m. body text clears WCAG AA, in every theme --------------------------
// The board's own contrast has been measured since 1.11 and is quoted in the
// README; the interface text never was. 2.0.0 ran --day-muted at 3.79:1 and
// --notebook-muted at 3.86:1 against their own backgrounds — below the 4.5 an
// AA body text needs — across the mode row, the panel tabs, the player roles
// and every group label. wood and night cleared it.
//
// Two things this had to get right before it could be trusted, both of which
// it got wrong first. A fresh page per theme, not `setAttribute` on a page
// already loaded in another one: the theme blocks and the component block have
// equal specificity, so flipping the attribute mid-life leaves a mixture and
// the measurement reads one theme's ink on another theme's paper. And colours
// resolved through a canvas rather than by parsing the computed string:
// color-mix() computes to `color(srgb 0.72 0.61 0.49)`, whose components are
// 0–1, and reading those as 0–255 makes every mixed background look black —
// which is what briefly "found" a 1.13:1 badge that is really 7:1.
if (scenario()) for (const theme of ["wood", "night", "day", "notebook"]) {
  // 9.0 S5: the 设置 tab's text is the settings page's (each category) and
  // the new-game dialog's (the old 「对局」 fold); the bar and strip as before
  const { ctx, page } = await open("zh-CN", "ai", "settings", theme);
  const measure = (sel) => page.evaluate((sel) => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const g2 = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (css) => { g2.clearRect(0, 0, 1, 1); g2.fillStyle = "#000"; g2.fillStyle = css;
      g2.fillRect(0, 0, 1, 1); return [...g2.getImageData(0, 0, 1, 1).data]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = ([r, g3, b]) => 0.2126 * lin(r) + 0.7152 * lin(g3) + 0.0722 * lin(b);
    const bgOf = (e) => { let n = e; while (n) { const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null;   // a gradient has no one colour
      const c = rgba(cs.backgroundColor); if (c[3] > 242) return c.slice(0, 3); n = n.parentElement; }
      return [255, 255, 255]; };
    const out = [];
    for (const e of document.querySelectorAll(sel)) {
      if (!e.offsetParent) continue;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      const fg = rgba(cs.color); if (fg[3] < 242) continue;
      if (parseFloat(cs.opacity) < 0.95) continue;
      const bg = bgOf(e); if (!bg) continue;
      const l1 = L(fg.slice(0, 3)), l2 = L(bg);
      const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const big = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (cr < (big ? 3 : 4.5)) out.push((e.id || e.className || e.tagName) + " " + cr.toFixed(2));
    }
    return [...new Set(out)];
  }, sel);
  const low = [];
  for (const cat of CATS) { await showCat(page, cat); low.push(...(await measure("#page-settings *")).map((l) => cat + ":" + l)); }
  await page.click('.rail-btn[data-view="play"]'); await page.waitForTimeout(300);
  low.push(...await measure(".chrome *, #strip-tools *"));
  await openNewGame(page);
  low.push(...(await measure("#newgame-modal *")).map((l) => "newgame:" + l));
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  // 9.0 S1 / S3: 今天, and 训练's panel — its switch, the lesson card and the
  // puzzle picker (the rating, the review card, the six tiles, 换个练法)
  await page.click('.rail-btn[data-view="home"]'); await page.waitForTimeout(400);
  low.push(...(await measure("#page-home *")).map((l) => "today:" + l));
  await page.click('.rail-btn[data-view="train"]'); await page.waitForTimeout(500);
  for (const seg of ["course", "puzzle"]) {
    await page.click('#train-seg button[data-seg="' + seg + '"]'); await page.waitForTimeout(600);
    low.push(...(await measure("#pane-play *")).map((l) => "train." + seg + ":" + l));
  }
  for (const l of low.slice(0, 6)) console.error("  low contrast in " + theme + ": " + l);
  assert(low.length === 0,
    theme + ":界面文字都达到 WCAG AA" + (low.length ? " —— " + low.length + " 处:" + low.slice(0, 3).join(", ") : ""));
  await ctx.close();
}

// --- 3m2. the theme reaches the shell, not just the board -----------------
// Through 2.1.9 a theme changed the board and left the app the same colour.
// Measured then, in RGB distance over the painted surfaces:
//
//              --panel            --bg
//   木 ↔ 夜      21                13
//   日 ↔ 本      21                13
//
// 21 in a 442-long space. 木's shell was #14100e / #241c18 — 5% and 8%
// lightness, six and twelve points of red over blue — beside a board painted
// #f0d9b5 / #b58863: not a wooden interface, a black one with a wooden picture
// in it, and near enough to 夜's that switching between them changed only the
// squares. The light pair had the same defect at the other end.
//
// Two statements, and they are different statements. Distance is the one that
// found the defect. Material is the one that keeps a future theme from being
// grey: the panel's channels must run in the same order as the board's dark
// square (木 and 日 lead with red and end in blue, 夜 and 本 the other way
// round) and must be at least 8 apart end to end — 本's old #f7f8fb was 4.
//
// The first version of this asked for sign(r−b) ≥ 8 and put 夜 in the red at
// −6, which was the metric's fault and not 夜's: a green tint moves the middle
// channel, and r−b cannot see the middle channel. 夜's shell was thin all the
// same — 8 points end to end against its board's 42 — so it was warmed up too,
// but by its own measurement rather than by the one that could not read it.
//
// Not asserted here: contrast. 3m already measures it per theme against the
// painted surface, so moving a surface is checked there — and did fail there
// first: warming 本's panel cost 次要 text 0.75 of its ratio (5.14 → 4.39) and
// 「清除全部存档」 0.2 of its own, both of which had to be paid back in the ink
// before this section could be written.
if (scenario()) {
  const surf = {};
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const { ctx, page } = await open("zh-CN", "ai", "play", theme);
    surf[theme] = await page.evaluate(() => {
      const cv = document.createElement("canvas"); cv.width = cv.height = 1;
      const g2 = cv.getContext("2d", { willReadFrequently: true });
      const rgba = (css) => { g2.clearRect(0, 0, 1, 1); g2.fillStyle = "#000"; g2.fillStyle = css;
        g2.fillRect(0, 0, 1, 1); return [...g2.getImageData(0, 0, 1, 1).data].slice(0, 3); };
      const v = (n) => rgba(getComputedStyle(document.documentElement).getPropertyValue(n));
      return { panel: v("--panel"), bg: v("--bg"), sqDark: v("--sq-dark") };
    });
    await ctx.close();
  }
  const dist = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));
  const names = Object.keys(surf);
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i], b = names[j];
      const dp = dist(surf[a].panel, surf[b].panel), db = dist(surf[a].bg, surf[b].bg);
      assert(dp >= 25, a + " 和 " + b + " 的面板是两种颜色(相距 " + dp + ")");
      assert(db >= 22, "……应用底也是(相距 " + db + ")");
    }
  }
  const order = (c) => [0, 1, 2].sort((i, j) => c[j] - c[i]).join("");
  const chroma = (c) => Math.max(...c) - Math.min(...c);
  for (const t of names) {
    assert(order(surf[t].panel) === order(surf[t].sqDark),
      t + ":外壳的三个通道和自己棋盘深格排同一个序(面板 " + order(surf[t].panel) +
      ",深格 " + order(surf[t].sqDark) + ")");
    assert(chroma(surf[t].panel) >= 8,
      t + ":……而且真的有颜色,不是灰的(首尾相差 " + chroma(surf[t].panel) + ")");
  }
}

// --- 3m3. the records page opens on a sentence, not as a wall -----------
// A fresh install used to open 记录 on two grey sentences saying nothing had
// happened yet and fifteen 🔒 rows under a 0/15 — a wall with the score
// already on it. 8.x put three doors there (上课 / 做题 / 下棋); 10.0 M0 took
// them away again — they were the third copy of what 今天 and 训练 offer.
// Now: one sentence naming what the page will hold, and the locked list
// folded after the three closest.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "record");
  const fresh = await page.evaluate(() => {
    const card = document.getElementById("record-empty");
    const locked = [...document.querySelectorAll(".ach-item:not(.got)")].filter((e) => e.offsetParent);
    const more = document.getElementById("ach-more");
    return { shown: !!card && !card.hidden, buttons: card ? card.querySelectorAll("button").length : -1,
             text: card ? card.textContent.trim() : "",
             locked: locked.length, more: more ? more.textContent.trim() : null };
  });
  assert(fresh.shown && fresh.text.length > 0, "全新安装打开记录页,先看到一句话说这一页会记什么(" + fresh.text + ")");
  assert(fresh.buttons === 0, "……那张卡片上没有训练的入口(今天、训练已经有了)(" + fresh.buttons + ")");
  assert(fresh.locked === 3, "锁着的成就只站出来三个,不是十五个(" + fresh.locked + ")");
  assert(fresh.more && /12/.test(fresh.more), "……其余的收在一个数字后面(" + fresh.more + ")");

  // the fold opens
  await page.click("#ach-more");
  await page.waitForTimeout(250);
  const opened = await page.evaluate(() =>
    [...document.querySelectorAll(".ach-item:not(.got)")].filter((e) => e.offsetParent).length);
  assert(opened === 15, "按下去十五个都在(" + opened + ")");
  await ctx.close();
}

// --- 3m4. the two state changes that used to jump -------------------------
// Hover and press were never the gap: measured across the three tabs, of every
// clickable element in the app exactly one had no transition declared. What
// jumped were the two changes that swap a block rather than restyle one —
// switching tabs (`hidden` on a pane) and opening a settings group (`[open]`
// on a <details>) — because neither is a property a transition can reach.
// Both are keyframed now, so the check is `getAnimations()`, not a computed
// style: an animation that is declared but never runs would pass the latter.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const bare = await page.evaluate(() => {
    const sel = 'button, [role="tab"], summary, .lesson-item, .hist-row, .ach-item, .mlrow';
    return [...new Set([...document.querySelectorAll(sel)].filter((e) => e.offsetParent)
      .filter((e) => ["none", "all"].includes(getComputedStyle(e).transitionProperty))
      .map((e) => e.id || e.className || e.tagName))];
  });
  assert(bare.length === 0, "每一个能按的东西都声明了过渡" + (bare.length ? " —— 没有的:" + bare.join(", ") : ""));

  // 9.0 S5: the panel's tab row is gone; the block that is swapped like a tab
  // pane now is the settings page's category (its vertical tablist) — and the
  // page itself, which replaces the board view
  await page.click('.rail-btn[data-view="settings"]');
  await page.waitForTimeout(500);
  const bareSet = await page.evaluate(() => {
    const sel = 'button, [role="tab"], summary';
    return [...new Set([...document.querySelectorAll("#page-settings " + sel.split(", ").join(", #page-settings "))]
      .filter((e) => e.offsetParent)
      .filter((e) => ["none", "all"].includes(getComputedStyle(e).transitionProperty))
      .map((e) => e.id || e.className || e.tagName))];
  });
  assert(bareSet.length === 0, "设置页上能按的东西也都声明了过渡" + (bareSet.length ? " —— 没有的:" + bareSet.join(", ") : ""));
  // 9.0 S1 / S3: 今天's cards and 训练's switch, tiles and review card too
  const bareIn = (root) => page.evaluate((r) => [...new Set([...document.querySelectorAll(r + " button, " + r + " summary")]
    .filter((e) => e.offsetParent)
    .filter((e) => ["none", "all"].includes(getComputedStyle(e).transitionProperty))
    .map((e) => e.id || e.className || e.tagName))], root);
  await page.click('.rail-btn[data-view="home"]'); await page.waitForTimeout(400);
  const bareToday = await bareIn("#page-home");
  await page.click('.rail-btn[data-view="train"]'); await page.waitForTimeout(400);
  await page.click('#train-seg button[data-seg="puzzle"]'); await page.waitForTimeout(600);
  const bareTrain = await bareIn("#pane-play");
  assert(bareToday.length === 0 && bareTrain.length === 0, "今天页与训练面板上能按的东西也都声明了过渡" +
    (bareToday.length + bareTrain.length ? " —— 没有的:" + bareToday.concat(bareTrain).join(", ") : ""));
  await page.click('.rail-btn[data-view="settings"]'); await page.waitForTimeout(400);
  const tab = await page.evaluate(async () => {
    const cur = document.querySelector(".set-cat[aria-selected=\"true\"]");
    const next = [...document.querySelectorAll(".set-cat")].find((b) => b !== cur);
    next.click();
    const pane = document.getElementById(next.getAttribute("aria-controls"));
    const anims = pane.getAnimations();
    const names = anims.map((a) => a.animationName);
    // wait for the animation itself rather than for a number of milliseconds:
    // 7.3 gave the 记录 tab a wider panel, so switching to it now also relays
    // out the board, and a fixed 400ms caught the fade at 0.98 — a timing
    // flake dressed up as a claim about where the pane comes to rest.
    await Promise.all(anims.map((a) => a.finished.catch(() => {})));
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    return { names, settled: getComputedStyle(pane).opacity };
  });
  // v7-8-plan §5: a fade (pane-in), no longer the 4px reveal-in slide — a tab replaces the pane, it is not revealed from above
  assert(tab.names.includes("pane-in"), "切设置分类的时候新的一类是淡入的(" + tab.names.join(", ") + ")");
  assert(tab.settled === "1", "……而且走完就停在原地(" + tab.settled + ")");
  await ctx.close();

  // 9.0 S5: the 设置 tab's 「对局」 fold (.setting-fold) is gone with the tab;
  // the disclosure that keeps the reveal-in rule is the lesson index
  const { ctx: c2, page: p2 } = await open("zh-CN", "learn", "play");
  const fold = await p2.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 400));
    const d = document.querySelector("#sec-learn .reading-index");
    d.open = false;
    await new Promise((r) => setTimeout(r, 60));
    d.open = true;
    const body = [...d.children].find((c) => c.tagName !== "SUMMARY");
    return body ? body.getAnimations().map((a) => a.animationName) : [];
  });
  assert(fold.includes("reveal-in"), "展开一组(课程目录)的时候里面的东西也是(" + fold.join(", ") + ")");
  await c2.close();
}

// --- 3n. every control has an accessible name -----------------------------
// 2.0.0's 失着提醒 and 自动翻转 switches had none: a screen reader announced
// "button, pressed" and nothing else. The sound switch beside them had a
// title, so the row read differently to a sighted user and to a blind one.
if (scenario()) {
  // 9.0 S5: the switches are on the settings page (each category read) and
  // the game's own rows in the new-game dialog
  const { ctx, page } = await open("zh-CN", "ai", "settings");
  const nameless = () => page.evaluate(() =>
    [...document.querySelectorAll("button, input, select, [role=tab]")]
      .filter((e) => e.offsetParent)
      .filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim() ||
                       e.title || e.getAttribute("aria-labelledby")))
      .map((e) => e.id || e.className || e.tagName));
  const anon = [];
  for (const cat of CATS) { await showCat(page, cat); anon.push(...await nameless()); }
  await page.click('.rail-btn[data-view="play"]'); await page.waitForTimeout(300);
  await openNewGame(page);
  anon.push(...await nameless());
  // 9.0 S1 / S3: 今天 (its cards are buttons with a mini board in them), and
  // 训练's panel in each of its four segments
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  await page.click('.rail-btn[data-view="home"]'); await page.waitForTimeout(400);
  const todayN = await page.evaluate(() => [...document.querySelectorAll("#page-home button")].filter((e) => e.offsetParent).length);
  assert(todayN >= 5, "今天 has its buttons on screen (" + todayN + ")");
  anon.push(...(await nameless()).map((x) => "today:" + x));
  await page.click('.rail-btn[data-view="train"]'); await page.waitForTimeout(500);
  for (const seg of ["course", "puzzle", "endgame", "classic"]) {
    await page.click('#train-seg button[data-seg="' + seg + '"]'); await page.waitForTimeout(700);
    anon.push(...(await nameless()).map((x) => "train." + seg + ":" + x));
  }
  assert(anon.length === 0,
    "每个可见控件都有可读的名称" + (anon.length ? " —— 没有的:" + anon.join(", ") : ""));
  await ctx.close();
}

// --- 3g. the reading modes get a reading layout ---------------------------
// 72 lessons of prose in a 284px panel wrapped at about twenty characters a
// line, with the text, the task, three controls and the entire table of
// contents stacked in that one column. P3.5.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "learn", "play");
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => {
    const side = document.getElementById("side");
    const idx = document.querySelector("#sec-learn .reading-index");
    return {
      mode: document.getElementById("app").getAttribute("data-mode"),
      width: Math.round(side.getBoundingClientRect().width),
      indexFolded: idx ? !idx.open : null,
      indexItemsVisible: idx ? [...idx.querySelectorAll("button, .lesson-row")].filter((b) => b.offsetParent).length : -1,
      taskOwnSurface: !!document.querySelector("#lesson-task"),
    };
  });
  assert(st.mode === "learn", "the app says which mode it is in, so the layout can follow");
  assert(st.width >= 340, "the reading column is wider than the playing one (" + st.width + "px)");
  assert(st.indexFolded, "the table of contents is folded away by default");
  assert(st.indexItemsVisible === 0,
    "…so 96 lessons are not stacked under the one you are reading (" + st.indexItemsVisible + ")");
  assert(st.taskOwnSurface, "the task sits on its own surface, apart from the prose");
  await ctx.close();
}
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const w = await page.evaluate(() => Math.round(document.getElementById("side").getBoundingClientRect().width));
  // 7.7 (v7-7-plan §1g): through 7.6 the playing page kept a 284px column
  // and only the reading modes widened — which slid the board sideways on
  // every mode change. One width now, for every page, from the window alone.
  assert(w >= 340, "…and the playing page has the same column: the width follows the window, not the mode (" + w + "px)");
  await ctx.close();
}

// --- 3f. settings read as a summary, and open on request ------------------
// Eighteen equal-weight buttons stood open permanently — six difficulties,
// four sparring styles, two colours, six clocks — in front of someone who
// mostly wants to know what the current ones are. P3.2.
if (scenario()) {
  // 9.0 S5: the 设置 tab's 「对局」 fold and its one-line summary are gone —
  // the rungs and the styles are chosen with a game, folded under the new-game
  // dialog's 自定义 (the persona cards above it say who you are playing). The
  // summary-line assertion went with its line; the fold is asked of 自定义.
  const { ctx, page } = await open("zh-CN", "ai", "play");
  await openNewGame(page, false);
  const st = await page.evaluate(() => {
    const f = document.getElementById("ng-custom");
    // a shut <details> keeps its content laid out under Chromium's
    // ::details-content (content-visibility), so offsetParent alone reads
    // the folded buttons as there; checkVisibility() asks whether they are drawn
    const seen = (b) => !!b.offsetParent && b.checkVisibility();
    const shut = { open: f.open,
      visibleButtons: [...f.querySelectorAll("button")].filter(seen).length };
    f.open = true;
    return { shut, openButtons: [...f.querySelectorAll("button")].filter(seen).length };
  });
  assert(!st.shut.open, "the rungs and styles start folded (自定义)");
  assert(st.shut.visibleButtons === 0, "…so none of the buttons is on screen (" + st.shut.visibleButtons + ")");
  // 10.0 M0: five clocks and four styles — the rungs are the cards above it
  assert(st.openButtons >= 9, "…and they are all there when you open it (" + st.openButtons + ")");
  await ctx.close();
}

// --- 3e. destructive actions are in one place, off the playing screen -----
// Four unrecoverable actions in four locations under three different words for
// "destroy" — 清除存档 pinned in red at the foot of the panel, 重置 in the
// lesson header, 清零 in the statistics header, 认输 in the game group — all of
// them permanent furniture a stray click away while you play. P3.7.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const found = await page.evaluate(() => {
    const danger = [...document.querySelectorAll(".act-btn.danger, .danger")]
      .filter((b) => b.tagName === "BUTTON");
    return {
      onPlayTab: danger.filter((b) => b.closest("#pane-play") && b.offsetParent).map((b) => b.id),
      inFoot: document.querySelectorAll(".side-foot").length,
      // v8-0-plan A1: in the preferences window, off the game's settings too;
      // 9.0 S5: that window is the settings page's 「数据」 category
      grouped: [...document.querySelectorAll("#set-data .act-btn.danger")].map((b) => b.id).sort(),
      // …all of them, and under one heading (one card)
      cards: new Set([...document.querySelectorAll("#page-settings .act-btn.danger")].map((b) => b.closest(".set-sec"))).size,
    };
  });
  assert(found.inFoot === 0, "nothing irreversible is pinned to the foot of the panel");
  assert(JSON.stringify(found.grouped) === JSON.stringify(["clear-save", "learn-reset", "stats-clear"]),
    "the three data deletions live together under one heading — " + found.grouped.join(", "));
  assert(found.cards === 1, "…one card on the settings page, not spread over several (" + found.cards + ")");
  // resign is the exception, and it is a move rather than a deletion: it stays
  // with the game, and P3.3 already made it present only while one is running
  assert(found.onPlayTab.every((id) => id === "btn-resign"),
    "the play tab carries no deletion — " + found.onPlayTab.join(", "));
  await ctx.close();
}

// --- 3o. a segmented control has no orphan segment ------------------------
// `auto-fit` with a 64px floor resolves to three columns in a 284px panel
// whatever the control holds, so every four-item segment laid out 3 + 1 — the
// mode row, the engine ladder, the sparring styles — while the theme row, also
// four items but a plain flex `.theme-row`, sat four-across two centimetres
// below. A segment alone on a line reads as a different kind of thing.
// 2.0.0 met this family once already and made the two rows equal *height*,
// which tidied the orphan without removing it.
if (scenario()) {
  for (const lang of LANGS) {
    for (const mode of ["ai", "pvp", "learn", "puzzle"]) {
      // 9.0 S5: the 设置 tab's segments are on the settings page (a category
      // at a time) and, for a game, in the new-game dialog (its 自定义 open)
      const { ctx, page } = await open(lang, mode, "settings");
      const segs = (where) => page.evaluate((where) => {
        const out = [];
        // the board view's panel stays laid out under the page, so the page
        // (or the dialog) is the scope, as the 设置 tab's pane was
        const scope = where === "newgame" ? "#newgame-modal .theme-row"
          : where.startsWith("train") ? "#pane-play .theme-row" : "#page-settings .theme-row";
        for (const g of document.querySelectorAll(scope)) {
          if (!g.offsetParent) continue;
          const bs = [...g.querySelectorAll("button")];
          if (bs.length < 2) continue;
          const lines = new Map();
          for (const b of bs) {
            const t = Math.round(b.getBoundingClientRect().top);
            lines.set(t, (lines.get(t) || 0) + 1);
          }
          out.push({ id: where + ":" + (g.id || g.className), n: bs.length,
                     lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) });
        }
        return out;
      }, where);
      const rows = [];
      for (const cat of CATS) { await showCat(page, cat); rows.push(...await segs(cat)); }
      if (mode === "ai" || mode === "pvp") {
        await page.click('.rail-btn[data-view="play"]'); await page.waitForTimeout(300);
        await openNewGame(page);
        rows.push(...await segs("newgame"));
      } else {
        // 9.0 S3: 训练's own segments are in the panel — the four-way switch
        // over it, and 名局's 读谱 / 猜着 (shown on the 名局 segment)
        await page.click('.rail-btn[data-view="train"]'); await page.waitForTimeout(400);
        rows.push(...await segs("train"));
        if (mode === "learn") {
          await page.click('#train-seg button[data-seg="classic"]'); await page.waitForTimeout(600);
          const cl = await segs("train:classic");
          assert(cl.some((g) => /classic-mode/.test(g.id)), lang + "/" + mode + ": 名局's 读谱/猜着 switch is measured (" + cl.map((g) => g.id).join(", ") + ")");
          rows.push(...cl);
        }
        assert(rows.some((g) => /train-seg/.test(g.id)), lang + "/" + mode + ": 训练's switch is measured");
      }
      assert(rows.length > 0, lang + "/" + mode + ": segments are on screen");
      for (const g of rows)
        assert(g.lines.length === 1 || g.lines[g.lines.length - 1] > 1,
          lang + "/" + mode + ": " + g.id + " has no segment alone on the last line (" +
          g.n + " → " + g.lines.join("+") + ")");
      await ctx.close();
    }
  }
}

// --- 3p. a group that has nothing to show is not on screen ----------------
// Hiding the <details> and leaving its <section> standing left 33px of nothing
// with the group's dividing rule still under it, on the settings page of both
// teaching modes — which reads as a group that failed to load. Same shape as
// the 「本局」 heading standing over a single 「新局」 at move 0.
if (scenario()) {
  for (const mode of ["ai", "pvp", "learn", "puzzle"]) {
    // 9.0 S5: the 设置 tab is the settings page — each category's cards
    for (const tab of ["play", ...CATS.map((c) => "settings:" + c)]) {
      const [view, cat] = tab.split(":");
      const { ctx, page } = await open("zh-CN", mode, view);
      if (cat) await showCat(page, cat);
      const empties = await page.evaluate(() => {
        const pane = document.querySelector("#page-settings:not([hidden]) .set-pane:not([hidden])")
          || document.querySelector(".side-pane:not([hidden])");
        const out = [];
        for (const g of pane.querySelectorAll("section, .act-group")) {
          if (!g.offsetParent) continue;
          // a group folded shut is showing exactly what it means to show: its
          // heading, its summary line, and the arrow that opens it
          if (g.querySelector("details:not([open])")) continue;
          const heading = g.querySelector(".side-h, .act-k");
          const items = [...g.querySelectorAll("button, input, a")]
            .filter((e) => e.offsetParent && getComputedStyle(e).visibility === "visible");
          if (!heading) continue;
          // 9.0 S5: a settings card's unit is the labelled row — 「声音」 over
          // 音效 (with the sound off, its volume and voice rows hide) or
          // 「从网站同步」 over 允许联网同步 and its explanation is one setting
          // with its name, not a heading over a stray button
          const labelled = g.closest("#page-settings") && [...g.querySelectorAll(".setting-row")]
            .some((r) => r.offsetParent && r.querySelector(".setting-k:not(.sr-only)") && r.querySelector("button, input"));
          if (items.length <= 1 && !labelled && !g.querySelector(".stats-body, .hist-body, .ach-body, .move-list, .lesson-text"))
            out.push({ h: heading.textContent.trim(), n: items.length,
                       items: items.map((e) => e.textContent.trim().slice(0, 8)) });
        }
        return out;
      });
      for (const e of empties)
        assert(false, mode + "/" + tab + ": 「" + e.h + "」 is a heading over " +
          (e.n ? "a single item (" + e.items.join(",") + ")" : "nothing"));
      assert(empties.length === 0, mode + "/" + tab + ": every group on screen has a group in it");
      await ctx.close();
    }
  }
}

// --- 3q. the achievement grid is a grid of achievements -------------------
// The suggestion card and the two group headings were children of the same
// two-column grid as the badges, so each took one cell and left the other half
// blank — the panel opened on a bordered card beside a gap. And the names:
// 2.0.1 stopped them overflowing with `overflow-wrap: anywhere`, which stopped
// the overflow by breaking the word instead — nine of fifteen read 规则通/关,
// 熟能生/巧, 杀法大/师.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    const r = await page.evaluate(() => {
      const body = document.getElementById("ach-body");
      const br = body.getBoundingClientRect();
      const full = [...body.querySelectorAll(".ach-next, .ach-group")].map((e) => {
        const b = e.getBoundingClientRect();
        return { c: e.className, spans: Math.round(b.width) >= Math.round(br.width) - 1 };
      });
      // A name may wrap when it is genuinely wider than the space it has —
      // "Consistent winner" is two words and 17 characters in a 130px cell.
      // What it may not do is wrap while it would have fitted, which is what
      // was happening: the 0/111 counter sat on the same line and squeezed it
      // until `overflow-wrap: anywhere` broke 规则通/关 rather than the row
      // giving way. Measure the name on one line and compare with the room.
      const wrapped = [...body.querySelectorAll(".ach-nm")].map((n) => {
        const lh = parseFloat(getComputedStyle(n).lineHeight);
        const lines = Math.round(n.getBoundingClientRect().height / lh);
        if (lines <= 1) return null;
        const probe = n.cloneNode(true);
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto";
        n.parentElement.appendChild(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        const room = n.parentElement.getBoundingClientRect().width -
          [...n.parentElement.children].filter((e) => e !== n)
            .reduce((a, e) => a + e.getBoundingClientRect().width + 6, 0) - 16;
        return need <= room ? { t: n.textContent.trim(), lines, need: Math.round(need), room: Math.round(room) } : null;
      }).filter(Boolean);
      const over = [...body.querySelectorAll(".ach-item")]
        .map((e) => Math.round(e.getBoundingClientRect().right - br.right)).filter((x) => x > 1);
      const badges = [...body.querySelectorAll(".ach-item")].map((e) => ({
        t: (e.querySelector(".ach-nm") || {}).textContent || "",
        h: Math.round(e.getBoundingClientRect().height) }));
      return { full, wrapped, over, badges, cols: getComputedStyle(body).gridTemplateColumns.split(" ").length };
    });
    for (const f of r.full)
      assert(f.spans, lang + ": ." + f.c.split(" ")[0] + " spans the grid rather than taking one badge's cell");
    assert(r.wrapped.length === 0,
      lang + ": no achievement name is broken while its row had the room — " +
      r.wrapped.map((w) => w.t + " (" + w.need + "px into " + w.room + ")").join(", "));
    assert(r.over.length === 0, lang + ": no badge runs past the grid (" + r.over.join(", ") + ")");
    // Fifteen badges are a list, and a list has one row height. In two columns
    // each row took its own: a name that wrapped, or a counter that dropped to
    // a second line, raised that row and left its neighbours alone. Measured on
    // the shipped build — Chinese 33 and 55, English 33/54/55/76/90, Japanese
    // 33/54/55/68/76. One column at the full panel width fits every name in
    // every language on one line with the counter beside it, which is the same
    // row the statistics directly above it are already made of.
    const heights = [...new Set(r.badges.map((b) => b.h))];
    assert(r.cols === 1, lang + ": the badges are one list, not two columns (" + r.cols + ")");
    assert(heights.length === 1,
      lang + ": every badge is the same height (" + heights.join(", ") + ") — tallest is 「" +
      (r.badges.find((b) => b.h === Math.max(...heights)) || {}).t + "」");
    await ctx.close();
  }
}

// --- 3s. the transport keys are one control -------------------------------
// 7.7 (v7-7-plan §1f): «  ‹  ›  » — four keys, always on screen; the ones that
// lead nowhere are disabled in place. Through 7.6 there were five (● did what
// » does) and the unavailable ones held their slot invisibly, so at the last
// move the row lost its two right-hand keys. Their positions relative to
// each other are what they mean, and they come and go with the replay
// position. Under `flex: 1`
// that meant two visible keys took 97px each and five took 37: press ‹ once at
// the live position and every key snapped to a third of its width while ‹
// itself jumped 61px left, out from under the pointer about to press it again.
// Third instance of the family, after the chrome's take-back/hint trade.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play");
  const bar = () => page.evaluate(() =>
    [...document.querySelectorAll("#replay-seg button")].map((b) => ({
      id: b.id,
      l: Math.round(b.getBoundingClientRect().left),
      w: Math.round(b.getBoundingClientRect().width),
      shown: getComputedStyle(b).visibility === "visible" && !!b.offsetParent,
      off: b.disabled,
      icon: !!b.querySelector("svg.ic") && b.textContent.trim() === "",
    })));
  const clickSquares = async (list) => {
    for (const sq of list) {
      const pt = await page.evaluate((s) => {
        const c = document.getElementById("board"), r = c.getBoundingClientRect();
        return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                 y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(220);
    }
  };
  await clickSquares(["e2", "e4", "e7", "e5"]);
  const atLive = await bar();
  await page.click("#rep-prev");
  await page.waitForTimeout(400);
  const backOne = await bar();
  assert(atLive.length === 4 && backOne.length === 4, "four transport keys (" + atLive.map((b) => b.id).join(", ") + ")");
  assert(atLive.every((b) => b.icon), "…drawn as icons, not as « ‹ › » characters");
  const widths = [...new Set(atLive.concat(backOne).map((b) => b.w))];
  assert(widths.length === 1,
    "every transport key is the same width in every state (" + widths.join(", ") + ")");
  const moved = backOne.filter((b) => {
    const before = atLive.find((x) => x.id === b.id);
    return before && Math.abs(before.l - b.l) > 1;
  });
  assert(moved.length === 0,
    "…and stepping back moves none of them (" + moved.map((m) => m.id).join(", ") + ")");
  assert(atLive.every((b) => b.shown) && backOne.every((b) => b.shown),
    "…all four visible at the last move and one back");
  assert(JSON.stringify(atLive.map((b) => b.off)) === "[false,false,true,true]" && backOne.every((b) => !b.off),
    "…and the ones that lead nowhere are disabled, not hidden (" + atLive.map((b) => b.id + ":" + b.off).join(" ") + ")");
  // no trailing 「…」 after the last move: the menu handle is an icon now
  const dots = await page.evaluate(() => [...document.querySelectorAll("#move-list *")].filter((e) => e.childElementCount === 0 && e.textContent.trim() === "…").length);
  assert(dots === 0, "the notation does not end in a literal 「…」 (" + dots + ")");
  // one number, one place: the chip that repeated the 棋谱 heading's count is gone
  const counters = await page.evaluate(() => document.querySelectorAll("#replay-seg #moves").length);
  assert(counters === 0, "the replay bar does not repeat the move counter above it");
  await ctx.close();
}

// --- 3t. the message strip speaks, and the one that stays can be sent away -
// #toast carries all 110 of this app's messages, including 「引擎启动失败」,
// and had no role and no aria-live — while the board beside it has had a live
// region since the keyboard work and the storage banner sets role=alert
// explicitly. And the fault tier, the one that deliberately does not leave on
// its own, had no way out but a mouse landing on a div: not focusable, no ✕
// (the docblock said there was one), and Escape — which closes everything else
// transient in this app — did nothing, while it sat over the board's back rank.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  // the stubbed engine makes 提示 fail, which is a real fault through the real
  // code path rather than a synthetic one
  await page.click("#btn-hint").catch(() => {});
  await page.waitForTimeout(900);
  const t = await page.evaluate(() => {
    const el = document.getElementById("toast");
    const close = el.querySelector(".toast-close");
    if (close) close.focus();
    return {
      shown: el.classList.contains("show"),
      fault: el.classList.contains("t-fault"),
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
      hasClose: !!close,
      closeNamed: !!(close && (close.getAttribute("aria-label") || "").trim()),
      closeFocused: !!close && document.activeElement === close,
    };
  });
  assert(t.shown && t.fault, "a failed hint raises a fault toast — " + JSON.stringify(t));
  assert(t.role === "alert" && t.live === "assertive",
    "…that a screen reader is told about (" + t.role + "/" + t.live + ")");
  assert(t.hasClose && t.closeNamed && t.closeFocused,
    "…with a close control that is focusable and named");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => !document.getElementById("toast").classList.contains("show")),
    "…and Escape sends it away, like everything else transient here");
  // the receipt tier is polite, not assertive: it must not interrupt.
  // 5.1: switching the theme no longer raises a toast (the panel repaints, and
  // that is the receipt), so the sample receipt is 今天的训练 — 「这一节共 N
  // 步」 or 「没有欠账」, either one an ok-tier message.
  // 9.0 S1: the plan's button is 今天's primary (#today-go), on that page
  await page.click('.rail-btn[data-view="home"]');
  await page.waitForTimeout(400);
  const ok = await page.evaluate(async () => {
    document.getElementById("today-go").click();
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById("toast");
    return { role: el.getAttribute("role"), live: el.getAttribute("aria-live"),
             close: !!el.querySelector(".toast-close") };
  });
  assert(ok.role === "status" && ok.live === "polite",
    "a receipt is announced politely (" + ok.role + "/" + ok.live + ")");
  assert(!ok.close, "…and carries no close control, because it leaves on its own");
  await ctx.close();
}

// --- 3u. a list of facts is a list, not six of one and one of another ------
// The six difficulty rows and the accuracy row are one list and read as one.
// In English the accuracy row wrapped both its halves and stood 42px against
// the others' 23 — 「Accuracy, last 10 games」 against 「69% · latest 78%」 in
// a 239px row. Chinese and Japanese never showed it.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [], diffs = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
      for (let i = 0; i < 20; i++) games.push({ id: "g" + i, t: Date.now() - i * 864e5,
        diff: diffs[i % 6], color: i % 2 ? "w" : "b", result: ["win", "loss", "draw"][i % 3],
        moves: 8 + i * 4, pgn: '[Event "?"]\n\n1. e4 e5 1/2-1/2', ending: "", acc: 40 + i * 2, acpl: 120 - i * 4 });
      localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".stat-row")].filter((e) => e.offsetParent).map((e) => ({
        h: Math.round(e.getBoundingClientRect().height),
        k: (e.querySelector(".stat-k") || {}).textContent || "",
      })));
    assert(rows.length >= 6, lang + ": the statistics are on screen (" + rows.length + " rows)");
    const heights = [...new Set(rows.map((r) => r.h))];
    assert(heights.length === 1,
      lang + ": every row in the list is the same height (" + heights.join(", ") + ") — tallest is 「" +
      (rows.find((r) => r.h === Math.max(...heights)) || {}).k + "」");
    await ctx.close();
  }
}

// --- 3u2. every `label → value` row, everywhere, is one line and one column
// 7.3 B3. §3u above asks the six difficulty rows to be the same height, which
// they were — the rows that were not are the ones carrying data rather than a
// fixed label. Measured at 1400x900 before the fix, in all three languages:
// 「D30 Queen's Gambit Declined」 → 「12 局 · 输 12」 stood 42px against every
// other row's 23, because the name wrapped and took the value with it, and the
// value's left edge sat at one of eight different x positions down a single
// panel (1271 … 1316) because `space-between` puts it wherever the text ends.
//
// So this walks every `.stat-row` the app can show — the statistics, the
// library, the gaps in the book, the puzzle tally, the progress rows and the
// diagnosis dialog — and asks two things of all of them at once:
//   1. one line. Not "the same height as its neighbours": a row that wraps in
//      a section where every row wraps would pass that and still be wrong.
//   2. one value column per container. The track is fixed, so this holds by
//      construction — which is exactly why it is worth an assertion: the next
//      person to reach for `space-between` here should find out immediately.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page, errs } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [], diffs = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
      for (let i = 0; i < 20; i++) games.push({ id: "g" + i, t: Date.now() - i * 864e5,
        diff: diffs[i % 6], color: i % 2 ? "w" : "b", result: ["win", "loss", "draw"][i % 3],
        moves: 8 + i * 4, pgn: '[Event "?"]\n\n1. e4 e5 1/2-1/2', ending: "", acc: 40 + i * 2, acpl: 120 - i * 4 });
      localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games }));
      // a library with two openings, so the rows that carry an ECO name — the
      // ones that wrapped — are on screen
      const ECOS = ["e4 e5 Nf3 Nc6 Bb5 a6", "d4 d5 c4 e6 Nf3 Nf6"];
      const lib = [];
      for (let i = 0; i < 24; i++) {
        const tags = new Array(80).fill(null), losses = new Array(80).fill(null), scalars = [0];
        for (let ply = 0; ply < 80; ply++) {
          const mine = ply % 2 === 0, moveNo = Math.floor(ply / 2) + 1;
          losses[ply] = mine ? (moveNo > 32 ? 120 : 8) : 0;
          scalars.push(scalars[ply] + (mine ? -losses[ply] : losses[ply]));
        }
        const sans = ECOS[i % 2];
        lib.push({ id: "g" + i, t: 1758000000000 + i * 864e5, white: "hxddh", black: "rival" + i,
          date: "2026.09.01", event: "Rated blitz", result: i % 2 ? "0-1" : "1-0", plies: 80,
          sans: sans + " " + sans, fen: "", side: "w", outcome: i % 2 ? "loss" : "win",
          motifs: { 54: "fork", 40: "pin" },
          an: { acc: { w: 60 + (i % 20), b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars,
                bests: new Array(81).fill(null), budget: 200 } });
      }
      window.__seedLib = { names: ["hxddh"], games: lib };
    });
    await page.evaluate(seedLibrary, await page.evaluate(() => window.__seedLib));
    await page.reload();
    await page.waitForTimeout(1000);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});

    // the same reading, taken twice: once on the panel, once with the
    // diagnosis dialog open — the dialog is where the ECO rows live, and it is
    // a different width, so it is a second container with its own column
    const read = () => page.evaluate(() => {
      // group by the actual parent box, not by its id — a container without
      // one would otherwise be lumped in with every other container without
      // one, and two columns that differ would read as a failure in the wrong
      // place (or, worse, one that does differ would read as fine)
      const boxes = new Map();
      const boxKey = (el) => {
        if (!boxes.has(el)) boxes.set(el, el.id || (el.className || "box") + "#" + (boxes.size + 1));
        return boxes.get(el);
      };
      return [...document.querySelectorAll(".stat-row")].filter((e) => e.offsetParent).map((e) => {
        const k = e.querySelector(".stat-k"), v = e.querySelector(".stat-v");
        const cs = getComputedStyle(e);
        // one line = the row is no taller than its own line box plus padding
        const line = parseFloat(cs.lineHeight) || 0;
        const pad = parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom);
        return {
          box: boxKey(e.parentElement),
          h: Math.round(e.getBoundingClientRect().height),
          oneLine: Math.round(e.getBoundingClientRect().height) <= Math.ceil(line + pad) + 1,
          k: k ? k.textContent : "", v: v ? v.textContent : "",
          kTitled: !!(k && k.title),
          vleft: v ? Math.round(v.getBoundingClientRect().left) : 0,
        };
      });
    });

    for (const where of ["panel", "diagnosis"]) {
      if (where === "diagnosis") {
        // v8-0-plan A1: the diagnosis opens from the library page
        await page.click('#rail button[data-view="library"]', { timeout: 800 }).catch(() => {});
        await page.click("#lib-diagnose", { timeout: 800 }).catch(() => {});
        await page.waitForTimeout(1600);
      }
      const rows = await read();
      assert(rows.length >= (where === "panel" ? 6 : 8),
        lang + " / " + where + ": there are rows to read (" + rows.length + ")");
      const wrapped = rows.filter((r) => !r.oneLine);
      assert(wrapped.length === 0,
        lang + " / " + where + ": every row is one line" +
        (wrapped.length ? " — wrapped: " + wrapped.map((r) => "「" + r.k + "」 → 「" + r.v + "」 " + r.h + "px").join("; ") : ""));
      // one value column per container
      const byBox = new Map();
      for (const r of rows) {
        if (!byBox.has(r.box)) byBox.set(r.box, new Set());
        byBox.get(r.box).add(r.vleft);
      }
      for (const [box, lefts] of byBox) {
        assert(lefts.size === 1,
          lang + " / " + where + ": the numbers in #" + box + " are one column (x = " +
          [...lefts].join(", ") + ")");
      }
    }
    // the name that had to be cut keeps the whole of itself on `title`
    const named = (await read()).filter((r) => /^[A-E]\d\d /.test(r.k));
    assert(named.length > 0, lang + ": the diagnosis names openings (" + named.length + " rows)");
    assert(named.every((r) => r.kTitled),
      lang + ": …and each of those names is kept whole on `title`");
    assert(errs.length === 0, lang + ": no JS exception while reading the rows");
    await ctx.close();
  }
}

// --- 3u3. a bar chart's shortest bar is still a bar ------------------------
// 7.3 §4B. Measured on the diagnosis page with a real library: the phases came
// out 开局 8 / 中局 8 / 残局 93, and on a linear scale in a 92px canvas the
// first two were drawn 1px tall — a hairline, which is also what a phase with
// no data at all would look like. Three numbers floated over what read as two
// empty slots and one red brick. The 失误分布 chart had the same disease:
// three hairlines suspended in white, no floor under them.
//
// Read off the canvas rather than off the source: the claim is about what is
// drawn. The background is cleared to transparent, so ink is alpha > 0 and a
// bar is the longest run of SOLID ink (alpha > 200) down its column — the
// value printed above it and the dashed tick are antialiased and broken, so
// they cannot be mistaken for it.
if (scenario()) {
  const { ctx, page, errs } = await open("zh-CN", "ai", "record");
  await page.evaluate(() => {
    const games = [];
    for (let i = 0; i < 24; i++) {
      const tags = new Array(80).fill(null), losses = new Array(80).fill(null), scalars = [0];
      for (let ply = 0; ply < 80; ply++) {
        // mine: a trickle through the opening and middlegame, a flood in the
        // endgame — the shape that drew two hairlines and one brick
        const mine = ply % 2 === 0, moveNo = Math.floor(ply / 2) + 1;
        losses[ply] = mine ? (moveNo > 32 ? 120 : 8) : 0;
        scalars.push(scalars[ply] + (mine ? -losses[ply] : losses[ply]));
      }
      for (const mv of [20, 28, 36]) tags[(mv - 1) * 2] = mv === 28 ? "??" : "?";
      const sans = i % 2 ? "d4 d5 c4 e6 Nf3 Nf6" : "e4 e5 Nf3 Nc6 Bb5 a6";
      games.push({ id: "g" + i, t: 1758000000000 + i * 864e5, white: "hxddh", black: "rival" + i,
        date: "2026.09.01", event: "Rated blitz", result: i % 2 ? "0-1" : "1-0", plies: 80,
        sans: sans + " " + sans, fen: "", side: "w", outcome: i % 2 ? "loss" : "win",
        motifs: { 54: "fork", 40: "pin" },
        an: { acc: { w: 60 + (i % 20), b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars,
              bests: new Array(81).fill(null), budget: 200 } });
    }
    window.__seedLib = { names: ["hxddh"], games: games };
  });
  await page.evaluate(seedLibrary, await page.evaluate(() => window.__seedLib));
  await page.reload();
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
  await page.click('#rail button[data-view="library"]', { timeout: 900 });   // v8-0-plan A1
  await page.click("#lib-diagnose", { timeout: 900 });
  await page.waitForTimeout(1800);

  const charts = await page.evaluate(() => {
    const out = [];
    for (const cv of document.querySelectorAll("#lib-diag canvas.diag-chart")) {
      const g = cv.getContext("2d");
      const { width: W, height: H } = cv;
      const data = g.getImageData(0, 0, W, H).data;
      // the longest run of solid ink in one column — a bar, if there is one
      const runAt = (x) => {
        let best = 0, run = 0;
        for (let y = 0; y < H; y++) {
          if (data[(y * W + x) * 4 + 3] > 200) { run++; if (run > best) best = run; }
          else run = 0;
        }
        return best;
      };
      const bars = [];
      for (let x = 0; x < W; x++) { const r = runAt(x); if (r > 0) bars.push(r); }
      out.push({ label: cv.getAttribute("aria-label") || "", role: cv.getAttribute("role"),
                 W, H, tallest: Math.max(0, ...bars), shortest: bars.length ? Math.min(...bars) : 0,
                 inked: bars.length });
    }
    return out;
  });
  assert(charts.length >= 2, "诊断页画出了图 (" + charts.length + " 张)");
  const dpr = await page.evaluate(() => window.devicePixelRatio || 1);
  for (const c of charts) {
    assert(!!c.label && c.role === "img", "「" + c.label + "」是一张有名字的图");
    assert(c.tallest > 0 && c.tallest <= c.H,
      "「" + c.label + "」最高的一根在画布里 (" + c.tallest + " / " + c.H + ")");
  }
  // the two bar charts: nothing drawn is a hairline. `shortest` counts every
  // inked column including the axis labels' stems, so the claim is made on
  // the bars themselves — the columns whose run is at least a bar's minimum.
  const MIN_BAR_PX = 4;
  const barish = await page.evaluate(() => {
    const out = [];
    // only the two charts that stand bars on a floor. The 开局战绩 chart lays
    // its bars on their side, so a column of ink there is a slice through a
    // row, not a bar — reading it this way would measure the wrong thing and
    // then complain about the answer.
    for (const cv of document.querySelectorAll('#lib-diag canvas[data-chart="phase"], #lib-diag canvas[data-chart="peak"]')) {
      const g = cv.getContext("2d");
      const { width: W, height: H } = cv;
      const data = g.getImageData(0, 0, W, H).data;
      const runs = [];
      for (let x = 0; x < W; x++) {
        let best = 0, bestEnd = -1, run = 0;
        for (let y = 0; y < H; y++) {
          if (data[(y * W + x) * 4 + 3] > 200) { run++; if (run > best) { best = run; bestEnd = y; } }
          else run = 0;
        }
        if (best > 0) runs.push({ x, len: best, end: bestEnd });
      }
      // the floor is the row the most columns end on. Not the lowest one:
      // the axis labels are printed BELOW the baseline, so "lowest" is the
      // bottom of a glyph, and every bar would then be off the floor.
      const tally = new Map();
      for (const r of runs) tally.set(r.end, (tally.get(r.end) || 0) + 1);
      let floor = -1, most = 0;
      for (const [end, n] of tally) if (n > most) { most = n; floor = end; }
      const onFloor = runs.filter((r) => Math.abs(r.end - floor) <= 1);
      out.push({ label: cv.getAttribute("aria-label") || "", kind: cv.dataset.chart,
                 bars: onFloor.length, min: onFloor.length ? Math.min(...onFloor.map((r) => r.len)) : 0,
                 max: onFloor.length ? Math.max(...onFloor.map((r) => r.len)) : 0 });
    }
    return out;
  });
  assert(barish.length === 2, "两张立着柱子的图都读到了 (" + barish.length + ")");
  for (const c of barish) {
    if (!c.bars) continue;
    assert(c.min >= Math.floor(MIN_BAR_PX * dpr) - 1,
      "「" + c.label + "」最矮的一根也有 " + c.min + " 设备像素（下限 " + Math.round(MIN_BAR_PX * dpr) +
      "）—— 「小」和「没有」不再长得一样");
  }
  // and every number the charts print is also on the page in words
  const text = await page.evaluate(() => (document.getElementById("lib-diag") || {}).innerText || "");
  assert(/回合/.test(text), "失误分布图的横轴范围在页面文字里也说了一遍", text.slice(0, 120));
  assert(errs.length === 0, "读图时零 JS 异常", errs.join(" | "));
  await ctx.close();
}

// --- 3u4. the chrome has three duties and three levels --------------------
// 7.3 §4D. The bar held eight things — a status pill, two king glyphs, two
// names, two personas, a 行 badge, the last move — at 0.6875, 0.75 and
// 0.8125rem with the LOUDEST weight on a persona's name and the lightest on
// the one fact that changes every half-move. Three duties, left to right:
// whose move it is, what game this is, what you can do about it. One level
// each, and the level has to descend in that order.
//
// …and the bar must not be saying what the panel is already saying. The
// puzzle page had them word for word (§2 B4), so this asks it of every mode.
if (scenario()) {
  for (const lang of LANGS) {
    for (const mode of ["ai", "pvp", "puzzle", "learn"]) {
      const { ctx, page, errs } = await open(lang, mode, "play");
      const seen = await page.evaluate(() => {
        const px = (el) => (el ? parseFloat(getComputedStyle(el).fontSize) : 0);
        const wt = (el) => (el ? Number(getComputedStyle(el).fontWeight) : 0);
        const pill = document.getElementById("status");
        // 7.7: the names are on the player strips now (.ps-name / .ps-level)
        const name = document.querySelector("#strip-b .ps-name");
        const role = [...document.querySelectorAll("#strip-b .ps-level")].find((e) => e.textContent.trim());
        const panel = document.querySelector(".side [id$='-task'], .side .task, #puzzle-task, #lesson-task");
        return {
          pill: (pill || {}).textContent || "", pillPx: px(pill), pillWt: wt(pill),
          namePx: px(name), nameWt: wt(name), rolePx: px(role),
          panelFirst: panel ? (panel.textContent || "").trim() : "",
        };
      });
      // 7.7 (v7-7-plan §2): the status sentence is for a screen reader now —
      // whose move it is shows as the lit strip — so the weight contest
      // between the pill and the names is over; the sentence must still exist
      assert(seen.pill.trim().length > 0, lang + "/" + mode + ":状态句还在(读屏用)「" + seen.pill + "」");
      if (seen.rolePx > 0 && seen.namePx > 0) {
        assert(seen.namePx >= seen.rolePx,
          lang + "/" + mode + ":名字不比它的说明小 (" + seen.namePx + " vs " + seen.rolePx + ")");
      }
      // 没有 ≥8 字的公共子串:顶栏与右栏第一句不是同一句话
      if (seen.panelFirst) {
        let shared = "";
        for (let i = 0; i + 8 <= seen.pill.length && !shared; i++) {
          const frag = seen.pill.slice(i, i + 8);
          if (seen.panelFirst.includes(frag)) shared = frag;
        }
        assert(!shared, lang + "/" + mode + ":顶栏与右栏首行没有 8 字以上的重叠" +
          (shared ? "(「" + shared + "」)" : ""));
      }
      assert(errs.length === 0, lang + "/" + mode + ":顶栏零 JS 异常", errs.join(" | "));
      await ctx.close();
    }
  }
}

// --- 3u5. on a reading page the reading gets the room — by the window -----
// 7.3 §4E widened the 记录 tab to 568px from 1180px up (521px of content) and
// asserted the board gave way for it. 7.7 (v7-7-plan §1g) takes that back:
// the price was paid by the board moving — its left edge went from 150 to 8
// at 1440×900 whenever you glanced at your records. The column is now one
// function of the window, 30vw, wide enough for the records at the sizes
// where they had been widened, and the same on every tab.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  // v8-0-plan A1: the records are the 我的 page, over the stage; the board
  // is laid out under it, and must be where it was when the page goes
  const boardOn = async (view) => page.evaluate(async (v) => {
    document.querySelector('#rail button[data-view="' + v + '"]').click();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 420));
    const b = document.getElementById("board-wrap").getBoundingClientRect();
    const sec = document.getElementById("sec-stats");
    const p = sec && sec.offsetParent ? sec.getBoundingClientRect() : { width: 0 };
    return { board: Math.round(b.width), left: Math.round(b.left), content: Math.round(p.width) };
  }, view);
  const play1 = await boardOn("play");
  const rec = await boardOn("me");
  const play2 = await boardOn("play");
  assert(rec.content >= 360, "1400×900 「我的」页一栏内容 " + rec.content + "px ≥ 360px");
  assert(play1.board === rec.board && play1.left === rec.left && play2.left === play1.left,
    "看一眼记录页,棋盘一个像素都没动 (" + play1.left + " → " + rec.left + " → " + play2.left + ")");
  await ctx.close();
}
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "record", "wood", { width: 1024, height: 700 });
  const w = await page.evaluate(() =>
    Math.round(document.querySelector(".side").getBoundingClientRect().width));
  assert(w >= 284 && w < 400, "1024×700 在「我的」页下,面板仍按窗口取宽:284 的下限之上,不越界变宽 (" + w + "px)");
  await ctx.close();
}
if (scenario()) {
  const at = async (mode) => {
    const { ctx, page } = await open("zh-CN", mode, "play");
    const r = await page.evaluate(() => ({
      side: Math.round(document.querySelector(".side").getBoundingClientRect().width),
      board: Math.round(document.getElementById("board-wrap").getBoundingClientRect().width) }));
    await ctx.close();
    return r;
  };
  const pz = await at("puzzle"), learn = await at("learn"), ai = await at("ai");
  assert(pz.side === learn.side && learn.side === ai.side,
    "1400×900 做题、教学、对局三页的面板一样宽 (" + [pz.side, learn.side, ai.side].join(" / ") + ")");
  assert(pz.board === learn.board && learn.board === ai.board,
    "……所以三页的棋盘一样大 (" + [pz.board, learn.board, ai.board].join(" / ") + ")");
}

// --- 3v. a dialog is called what it says it is ----------------------------
// Every dialog carried its title twice — an aria-label on the box and a
// visible <h3>, from two different i18n keys — and two of the pairs had
// drifted apart (「升变」/「升变为」, 「载入 FEN」/「载入 FEN 局面」). The
// confirm dialog was not merely drifted: its heading is written fresh for each
// question, while its aria-label was the fixed word 「确认」. Ask to delete
// every save and the screen said 「清除存档」 while a screen reader said
// 「确认」 — the most consequential dialog in the app, announced as nothing in
// particular.
if (scenario()) {
  // 9.0 S5: 清除全部存档 is on the settings page's 「数据」
  const { ctx, page } = await open("zh-CN", "ai", "settings");
  await showCat(page, "data");
  const dialogs = await page.evaluate(() =>
    [...document.querySelectorAll(".modal-bg")].map((d) => {
      const by = d.getAttribute("aria-labelledby");
      const target = by ? document.getElementById(by) : null;
      const h = d.querySelector("h3");
      return { id: d.id, by, label: d.getAttribute("aria-label"),
               pointsAtHeading: !!target && target === h,
               name: target ? target.textContent.trim() : null,
               heading: h ? h.textContent.trim() : null };
    }));
  assert(dialogs.length >= 7, "the dialogs are in the markup (" + dialogs.length + ")");
  for (const d of dialogs) {
    assert(!d.label, d.id + ": carries no second copy of its title as an aria-label");
    assert(d.pointsAtHeading, d.id + ": is named by the heading you can see (" + d.by + ")");
    assert(d.name && d.name === d.heading, d.id + ": 「" + d.name + "」 = 「" + d.heading + "」");
  }
  // and the one whose heading changes: what it is called must change with it
  const asked = await page.evaluate(async () => {
    document.getElementById("clear-save").click();
    await new Promise((r) => setTimeout(r, 500));
    const d = document.getElementById("confirm-modal");
    const by = document.getElementById(d.getAttribute("aria-labelledby"));
    return { open: d.classList.contains("show"), name: by ? by.textContent.trim() : null };
  });
  assert(asked.open, "asking to delete every save opens the confirm dialog");
  // …and every dialog is still a card. Widening one of them, I split the
  // `.modal` rule to add the modifier and left the background, the border, the
  // padding and the shadow behind in the modifier — so the six that are not
  // wide became bare text over the board. Nothing in this file noticed: every
  // check here reads geometry or names, and none of them asks whether the box
  // is a box. The save-slot dialog lost 34px of height and that was the only
  // trace.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll(".modal-bg > .modal")].map((m) => {
      const cs = getComputedStyle(m);
      return { id: m.parentElement.id, bg: cs.backgroundColor, sheet: m.parentElement.classList.contains("page-sheet"),
               pad: parseFloat(cs.paddingTop), border: parseFloat(cs.borderTopWidth),
               w: Math.round(m.getBoundingClientRect().width) };
    }));
  for (const b of boxes) {
    assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(b.bg),
      b.id + ": is drawn on something, not straight onto the board (" + b.bg + ")");
    assert(b.pad >= 12, b.id + ": keeps its padding (" + b.pad + ")");
    // v8-0-plan A1: the three page sheets are pages, not cards: edge to
    // edge over the page they came from, so no border to keep
    assert(b.border > 0 || b.sheet, b.id + ": keeps its border (" + b.border + ")");
  }
  assert(asked.name && asked.name !== "确认",
    "…and it is announced by what it is asking, not by the word 「确认」 — 「" + asked.name + "」");
  await ctx.close();
}

// --- 3r. the settings page reads as one page ------------------------------
// The order is the argument: how this game is set, how the board in front of
// you is shown, the engine. v8-0-plan A1 took the mode off it (the new-game
// dialog and the rail have it) and the app's own look, language, sound and
// data (偏好设置); there the deletions are — last, always last: 2.1 had them
// in the middle of a page, the only red on it.
// 9.0 S5: the 设置 tab and 偏好设置 are one page of six categories. The same
// argument, read off it: 通用 first and opening on the language (语言第一屏),
// no mode anywhere, the deletions the last card of 「数据」 and nowhere else,
// the engine the last category. The game group: 难度 / 风格 / 执子 / 棋钟 are
// the new-game dialog's in every mode, so the page has none of them — and
// 「对局」 (失着提醒 / 自动翻转) is there in every mode (it was "present exactly
// when there is a game to set"; S5 shows both switches always).
if (scenario()) {
  for (const mode of ["ai", "learn"]) {
    const { ctx, page } = await open("zh-CN", mode, "settings");
    const pg = await page.evaluate(() => ({
      cats: [...document.querySelectorAll(".set-cats [role=tab]")].map((b) => b.dataset.cat),
      open: (document.querySelector('.set-cat[aria-selected="true"]') || {}).id,
      secs: Object.fromEntries([...document.querySelectorAll(".set-pane")].map((p) =>
        [p.id.slice(4), [...p.querySelectorAll(":scope > section")].map((s) => (s.querySelector(".side-h") || {}).textContent || "?")])),
      gameRows: ["row-opponent", "row-persona", "row-color", "row-clock", "mode-seg"]
        .filter((id) => document.getElementById(id) && document.getElementById(id).closest("#page-settings")),
    }));
    const all = Object.values(pg.secs).flat();
    assert(JSON.stringify(pg.cats) === JSON.stringify(CATS),
      mode + ": six categories, 通用 first and 高级 last — " + pg.cats.join(" → "));
    assert(pg.open === "cat-general" && pg.secs.general[0] === "语言",
      mode + ": the page opens on 通用, the language first — " + pg.open + " / " + pg.secs.general.join(" → "));
    assert(!all.includes("模式") && pg.gameRows.length === 0,
      mode + ": no mode and none of the game's own rows on the settings page — " + pg.gameRows.join(", "));
    assert(all.filter((h) => h === "清除数据").length === 1 && pg.secs.data[pg.secs.data.length - 1] === "清除数据",
      mode + ": the deletions are the last card of 数据, and only there — " + pg.secs.data.join(" → "));
    assert(pg.secs.advanced[0] === "引擎", mode + ": the engine comes last (高级) — " + pg.secs.advanced.join(" → "));
    await showCat(page, "game");
    const game = await page.evaluate(() => ["row-coach", "row-autoflip"].map((id) => !!document.getElementById(id).offsetParent));
    assert(game.every(Boolean), mode + ": 「对局」 shows 失着提醒 and 自动翻转 (" + game.join(", ") + ")");
    await ctx.close();
  }
}

// --- 4. the tab row holds tabs only ---------------------------------------
// 9.0 S5: the panel's tab row is gone (one pane). The app's one tablist now is
// the settings page's category list, and the rule is asked of it: tabs and
// nothing else, each naming the pane it controls.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const kids = await page.evaluate(() => [...document.querySelector(".set-cats").children]
    .map((el) => el.getAttribute("role") + (document.getElementById(el.getAttribute("aria-controls") || "-") ? "" : "(no pane)")));
  assert(kids.length === 6 && kids.every((r) => r === "tab"),
    "the category list contains six tabs, each with its pane, and nothing else — got " + JSON.stringify(kids));
  assert(await page.evaluate(() => !document.querySelector(".side-tabs, #side [role=tablist]")),
    "…and the panel has no tab row");
  // and the panel is still closable without it
  await page.click("#toggle-panel");
  await page.waitForTimeout(400);
  const open1 = await page.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
  assert(!open1, "the topbar ☰ still closes the panel");
  await page.keyboard.press("p");
  await page.waitForTimeout(400);
  const open2 = await page.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
  assert(open2, "…and P still opens it");
  await ctx.close();
}

// --- 5. a lesson with no opponent names the lesson there --------------------
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "learn", "play");
  // 7.7 kept the opponent's strip's place (the board must not move between
  // modes) and drew nothing in it; 9.0 V3: it names the lesson, a label
  // rather than a player (never the side to move)
  const vs = await page.evaluate(() => {
    const top = document.getElementById("strip-b");
    return {
      label: top.classList.contains("is-label") && !top.classList.contains("is-empty"),
      shown: getComputedStyle(top).visibility === "visible",
      active: top.classList.contains("is-active"),
      name: document.getElementById("black-role").textContent.trim(),
      title: document.getElementById("lesson-title").textContent.trim(),
    };
  });
  assert(vs.label && vs.shown && !vs.active, "lesson 1 has no sparring partner, so the opponent's strip is the lesson's label (" + JSON.stringify(vs) + ")");
  assert(!!vs.name && vs.name === vs.title, "…and it reads the lesson's title (" + vs.name + " / " + vs.title + ")");
  await ctx.close();
}

// --- 6. 演示 is present when it works and absent when it cannot ------------
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "learn", "play");
  const state = await page.evaluate(() => {
    const b = document.getElementById("lesson-demo");
    return { hidden: b.hidden, disabled: b.disabled };
  });
  // whichever way lesson 1 falls, the button is never "visible and dead"
  assert(!(state.hidden === false && state.disabled === true),
    "演示 is never shown permanently greyed out — hidden=" + state.hidden + " disabled=" + state.disabled);
  await ctx.close();
}
// --- 3w. a label stays inside the control it names -------------------------
// `.tool-btn` is 32px tall and does not wrap; four of them at `flex: 1` in the
// editor's 239px row could not shrink below their own padding plus their
// longest word, so the labels wrapped inside a box that had no room for a
// second line and the text came out through the border. Measured on the
// shipped build: 「开始对局」 as two stacked lines in Chinese, 「Start game」
// with the button itself 32px past the panel's edge in English, and in
// Japanese 「キャンセル」 as three lines with its last character hanging below
// the pill. scrollHeight against clientHeight catches the whole class — any
// control anywhere whose text needs more room than the control has — which is
// why this is not written against the editor.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    await pressMore(page, "editor-open");
    await page.waitForTimeout(500);
    assert(await page.isVisible("#sec-editor"), lang + ": 编辑局面 (from 更多) opened the editor");
    const spilled = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent && b.scrollHeight > b.clientHeight + 1)
        .map((b) => b.textContent.trim() + " (" + b.scrollHeight + " needs " +
          b.clientHeight + " has, in #" + (b.closest("[id]") || {}).id + ")"));
    assert(spilled.length === 0,
      lang + ": every label fits inside its own button" +
      (spilled.length ? " — " + spilled.join("; ") : ""));
    // …and the row itself stays inside the panel it lives in
    const past = await page.evaluate(() => {
      const row = document.querySelector("#sec-editor .lesson-controls");
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return [...row.querySelectorAll("button")]
        .filter((b) => b.getBoundingClientRect().right > r.right + 1)
        .map((b) => b.textContent.trim());
    });
    assert(past && past.length === 0,
      lang + ": no editor button reaches past the row" +
      (past && past.length ? " — " + past.join(", ") : ""));
    await ctx.close();
  }
}

// --- 3x. a segment of ten is still one control -----------------------------
// The puzzle type filter was the only segment in the app with more than four
// items, and it was the one the `.theme-row.wrap` comment claimed to have
// handled: "five or more fall back to three". It did not — `auto-fit` with a
// 64px floor resolves to four columns in a 335px panel — and at four columns
// 「Win material」 needed 79px in a 78px cell. One label one pixel too wide,
// and `grid-auto-rows: 1fr` passed its wrapped height to all ten buttons: the
// whole control half again as tall, in English only.
// 9.0 S3: the ten types are six tiles (#pz-groups: 杀棋 战术 残局 防守 开局,
// and 我的错题 once the personal book holds drills) over 换个练法's two rows.
// The same claims, of them: three across, one height, no name or count cut
// (a tile's name ellipsizes, so "cut" is its own scrollWidth), and the two
// rows' labels and buttons whole too.
const pickerFits = (page) => page.evaluate(() => {
  const g = document.getElementById("pz-groups");
  const tiles = [...g.querySelectorAll(".pz-tile")].filter((b) => !b.hidden && b.offsetParent);
  const cut = (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
  const tight = [];
  for (const b of tiles) {
    const r = b.getBoundingClientRect();
    for (const e of b.querySelectorAll(".pz-tile-name, .pz-tile-n")) {
      const er = e.getBoundingClientRect();
      if (cut(e) || er.right > r.right + 0.5 || er.left < r.left - 0.5) tight.push(b.dataset.group + ":" + e.textContent.trim());
    }
  }
  const rows = [...document.querySelectorAll("#pz-modes .pz-modes-row")];
  // a label that wraps is as unreadable a row as one that spills (ja's
  // チャレンジ stood three lines tall in a 48px column)
  const lh = (e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
  const modeCut = rows.flatMap((row) => [...row.children].filter((e) => e.offsetParent &&
    (cut(e) || (e.tagName !== "BUTTON" && e.getBoundingClientRect().height > lh(e) * 1.5)))
    .map((e) => e.textContent.trim() + " " + e.scrollWidth + "/" + e.clientWidth + "×" + Math.round(e.getBoundingClientRect().height)));
  const modeH = [...new Set(rows.flatMap((row) => [...row.querySelectorAll("button")]).map((b) => Math.round(b.getBoundingClientRect().height)))];
  const rv = document.getElementById("pz-review");
  const review = rv && rv.offsetParent ? [...rv.querySelectorAll("b, small, .pz-review-n")].filter((e) => e.offsetParent && cut(e)).map((e) => e.textContent.trim()) : [];
  return { n: tiles.length, groups: tiles.map((b) => b.dataset.group).join(","), review,
           cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
           heights: [...new Set(tiles.map((b) => Math.round(b.getBoundingClientRect().height)))],
           named: tiles.every((b) => b.querySelector(".pz-tile-name").textContent.trim()),
           tight, modeCut, modeH, rows: rows.length };
});
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "puzzle", "play");
    const seg = await pickerFits(page);
    // v10-0-plan T2: 我的错题 is drawn with no drills too, saying how it fills
    assert(seg.n === 6 && seg.groups === "mate,tactic,endgame,defense,opening,mine",
      lang + ": five kinds and 我的错题, there with no drills (" + seg.groups + ")");
    assert(seg.cols === 3, lang + ": the tiles lay out three across (" + seg.cols + ")");
    assert(seg.heights.length === 1 && seg.named, lang + ": every tile is one height and named (" + seg.heights.join(", ") + ")");
    assert(seg.tight.length === 0, lang + ": no kind's name or count is cut" + (seg.tight.length ? " — " + seg.tight.join(", ") : ""));
    assert(seg.review.length === 0, lang + ": the 复习 card's name, line and count are whole" + (seg.review.length ? " — " + seg.review.join(", ") : ""));
    assert(seg.rows === 2 && seg.modeCut.length === 0 && seg.modeH.length === 1,
      lang + ": 换个练法's two rows: labels and buttons whole, one height (" + seg.modeCut.join(", ") + "; " + seg.modeH.join(", ") + ")");
    await ctx.close();
  }
  // …and when the personal book holds drills the 我的错题 tile is drawn: six
  // must still be one height each, in the widest language too
  for (const lang of LANGS) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang });
    await ctx.addInitScript(([l]) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "puzzle", langId: l, soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.mines", JSON.stringify({ v: 1, list: [{
        id: "mine:t1", cat: "mine", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
        solution: ["Nf3"], played: "e4", loss: 350, ply: 0, t: 1700000000000 }] }));
      localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "mine" }));
    }, [lang]);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    const seg = await pickerFits(page);
    assert(seg.n === 6 && /mine/.test(seg.groups) && seg.heights.length === 1,
      lang + ": with the personal book drawn, six kinds are still one height (" + seg.groups + "; " + seg.heights.join(", ") + ")");
    assert(seg.tight.length === 0,
      lang + ": the 我的错题 tile fits its cell" + (seg.tight.length ? " — " + seg.tight.join(", ") : ""));
    await ctx.close();
  }
}

/**
 * 9.0 S4: the list dialog shows its search; the other filters are the fold
 * 筛选 (details#lib-filters), shut by default. Opened through its summary,
 * as a player would, so the rows below are measured open — the only state
 * in which "this filter has a label you can see" means anything.
 */
async function openLibFilters(page) {
  const was = await page.evaluate(() => {
    const d = document.getElementById("lib-filters"), q = document.getElementById("lib-q");
    return { wasShut: !!d && !d.open, search: !!q && !!q.offsetParent && q.checkVisibility() };
  });
  await page.click("#lib-filters > summary");
  await page.waitForTimeout(300);
  return { ...was, open: await page.evaluate(() => document.getElementById("lib-filters").open) };
}

// --- 3y. a refusal is heard, not only seen ---------------------------------
// Two places tell you why the app will not do what you asked, and both wrote
// into a plain <p>: the editor's reason the position is illegal (which is also
// the reason 「开始对局」 is greyed out) and the FEN dialog's reason the string
// was rejected. Text arriving in an element that is not a live region is text
// a screen reader never mentions — the same defect the toast had, in the two
// spots where the app is saying no. The FEN field also went red without ever
// being marked invalid, so the ring was the whole message.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const attrs = await page.evaluate(() => {
    const g = (id) => {
      const e = document.getElementById(id);
      return e && { role: e.getAttribute("role"), live: e.getAttribute("aria-live") };
    };
    return { ed: g("editor-error"), fen: g("fen-error"),
             describedBy: document.getElementById("fen-input").getAttribute("aria-describedby") };
  });
  for (const [id, a] of [["editor-error", attrs.ed], ["fen-error", attrs.fen]]) {
    assert(a && a.role === "status" && a.live === "polite",
      id + " is a live region before anything is written into it (" +
      (a ? a.role + "/" + a.live : "missing") + ")");
  }
  assert(attrs.describedBy === "fen-error", "the FEN field points at its own reason");
  // and a rejected FEN really marks the field invalid
  const bad = await page.evaluate(async () => {
    document.getElementById("fen-load-open").click();
    await new Promise((r) => setTimeout(r, 400));
    const input = document.getElementById("fen-input");
    input.value = "not a fen";
    document.getElementById("fen-load").click();
    await new Promise((r) => setTimeout(r, 300));
    return { invalid: input.getAttribute("aria-invalid"), red: input.classList.contains("bad"),
             why: document.getElementById("fen-error").textContent.trim() };
  });
  assert(bad.red && bad.why, "a rejected FEN turns the field red and says why — 「" + bad.why + "」");
  assert(bad.invalid === "true", "…and the field is marked invalid, not only coloured (" + bad.invalid + ")");
  await ctx.close();
}

// --- 3z. the shortcut sheet describes the mode you are in ------------------
// The keydown handler has always been partitioned by mode — learn and puzzle
// return before the replay keys, N and F are reached — and the sheet was one
// flat list of thirteen rows shown identically everywhere. In 做题 it offered
// 「Z 悔棋」, 「F 翻转棋盘」 and the two replay rows, none of which do anything
// there, and it called N 「新局」 when in that mode N is the next puzzle. The
// only screen that tells you what the keyboard does was wrong in two of the
// app's four modes.
if (scenario()) {
  const expect = {
    ai:     { has: ["新局", "悔棋", "翻转棋盘"], hasnt: ["下一题", "看答案", "重做当前这题"] },
    learn:  { has: ["重做当前这题", "悔棋", "本课提示"], hasnt: ["新局", "翻转棋盘", "下一题"] },
    puzzle: { has: ["下一题", "看答案", "重做当前这题"], hasnt: ["新局", "悔棋", "翻转棋盘"] },
  };
  for (const mode of Object.keys(expect)) {
    const { ctx, page } = await open("zh-CN", mode, "play");
    // the sheet has no button — 「?」 and the native Help menu are its two doors
    await page.keyboard.press("Shift+Slash");
    await page.waitForTimeout(400);
    const rows = await page.evaluate(async () => {
      const l = document.getElementById("keys-list");
      const out = [];
      for (let i = 0; i < l.children.length; i += 2)
        out.push({ keys: [...l.children[i].querySelectorAll("kbd")].map((k) => k.textContent).join("/"),
                   what: l.children[i + 1].textContent.trim() });
      return out;
    });
    assert(rows.length > 0, mode + ": the shortcut sheet has rows (" + rows.length + ")");
    const text = rows.map((r) => r.what);
    for (const want of expect[mode].has)
      assert(text.includes(want), mode + ": the sheet lists 「" + want + "」");
    for (const no of expect[mode].hasnt)
      assert(!text.includes(no),
        mode + ": the sheet does not offer 「" + no + "」, which does nothing here");
    // and the four that work everywhere are always there
    for (const k of ["P", "Tab", "Esc", "?"])
      assert(rows.some((r) => r.keys.split("/").includes(k)), mode + ": " + k + " is listed");
    await ctx.close();
  }
}

// --- 4a. the game list is a list, and its filters are labelled -------------
// Two defects in the dialog you open to find an old game.
// The rows: 「date · N moves · X% accuracy」 on one line, in a 380px box that
// left the line 262px. English needs 263 for a game played yesterday, because
// the relative form 「yesterday 12:55 AM」 is longer than the absolute
// 「7/31/2026」 that older games get — one pixel, and 12 of 40 rows stood 67px
// against the other 28 at 51. The box is what was wrong: this is the only
// dialog holding a scrolling list of sentences, and it was the width of the
// ones holding a single question.
// The filters: two segments side by side at `flex: 0 1 auto`, whose auto basis
// is the content width of a grid of `minmax(0, 1fr)` columns — zero. They
// never grew. Measured in Chinese: four result buttons sharing 60px and three
// colour buttons 94px inside a 418px row, and at 26px a column 「执白」 wrapped
// to three lines, so the colour filter stood 79px beside a 35px result filter.
// Stacked, full width, and each one now carries as a visible label the string
// that was only ever its aria-label — two 「全部」 buttons above each other,
// both active, with nothing on screen saying what either row filtered.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [], diffs = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
      for (let i = 0; i < 40; i++) games.push({ id: "g" + i, t: Date.now() - i * 36e5,
        diff: diffs[i % 6], color: i % 2 ? "w" : "b", result: ["win", "loss", "draw"][i % 3],
        moves: 8 + i * 3, pgn: '[Event "?"]\n\n1. e4 e5 1/2-1/2', ending: "", acc: 40 + i, acpl: 120 - i * 2 });
      localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    // v8-0-plan C1: 「全部 N 局」 opens the library's list on its 本机 games —
    // the history's own dialog is gone, and the same ruler applies to this one
    // 9.0 S4: the history is 棋谱's now (moved from 我的)
    await page.click('#rail button[data-view="library"]');
    await page.waitForTimeout(400);
    assert(await page.evaluate(() => !!document.getElementById("sec-history").closest("#page-library")
      && !!document.getElementById("hist-open").offsetParent), lang + ": 对局历史 and its 「全部 N 局」 are on 棋谱");
    await page.click("#hist-open", { timeout: 2500 });
    await page.waitForTimeout(800);
    const fold = await openLibFilters(page);
    assert(fold.wasShut && fold.search, lang + ": the list opens on its search, the other filters folded (" + JSON.stringify(fold) + ")");
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#lib-list .hist-row")].filter((e) => e.offsetParent);
      // 7.1: scoped to the dialog under test. Unscoped, this also swept up the
      // three filter rows of 棋谱库's own list dialog — which is CLOSED here,
      // so their labels measure as invisible and their buttons as zero-sized,
      // and the assertions below read that as "this filter has no visible
      // label". The library's rows get the same scrutiny in their own block
      // below, with the dialog open, which is the only state the question
      // means anything in.
      const segs = [...document.querySelectorAll("#lib-list-modal .hist-filters .theme-row")].map((seg) => {
        const by = seg.getAttribute("aria-labelledby");
        const label = by ? document.getElementById(by) : null;
        const bs = [...seg.querySelectorAll("button")];
        return { id: seg.id, label: label && label.offsetParent ? label.textContent.trim() : null,
                 stray: seg.getAttribute("aria-label"),
                 heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
                 // equal-width segments come from minmax(0, 1fr) columns; a fractional
                 // share is snapped to 1/64 px per column, so two equal segments can
                 // round to 204 and 205 — compare the raw widths instead
                 widths: bs.map((b) => b.getBoundingClientRect().width),
                 spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.trim()) };
      });
      return { n: rows.length,
               rowH: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               segs };
    });
    assert(r.n >= 20, lang + ": the history dialog is showing the games (" + r.n + ")");
    assert(r.rowH.length === 1,
      lang + ": every game in the list is the same height (" + r.rowH.join(", ") + ")");
    assert(r.segs.length === 5, lang + ": every filter is there — result, colour, sort, source, speed (" + r.segs.length + ")");
    for (const s of r.segs) {
      assert(s.label, s.id + " (" + lang + "): carries a label you can see, not only one you can hear");
      assert(!s.stray, s.id + " (" + lang + "): and not a second copy of it as an aria-label");
      assert(s.heights.length === 1 && s.heights[0] < 40,
        s.id + " (" + lang + "): every segment is one line tall (" + s.heights.join(", ") + ")");
      assert(Math.max(...s.widths) - Math.min(...s.widths) < 0.1,
        s.id + " (" + lang + "): every segment is the same width (" + s.widths.map((w) => w.toFixed(2)).join(", ") + ")");
      assert(s.spill.length === 0,
        s.id + " (" + lang + "): no filter label breaks out of its button" +
        (s.spill.length ? " — " + s.spill.join(", ") : ""));
    }
    await ctx.close();
  }
}

// --- 4a2. 棋谱库的列表对话框，和对局历史同一把尺子 (7.1) -------------------
// 同一套断言，换一个对话框：三排筛选/排序段，每一排都要有一个看得见的标签、
// 不要第二份 aria-label、一行高、等宽、文字不溢出按钮。上面那一段之所以要
// 限定在 #hist-modal 里，就是因为这三排在那时是关着的 —— 关着的东西量出来的
// 是 0，而 0 不该被读成「这个筛选器没有标签」。
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [];
      for (let i = 0; i < 25; i++) {
        games.push({ id: "lib" + i, t: Date.now() - i * 36e5, white: "hxddh", black: "rival" + i,
          date: "2026.09.01", event: "Rated blitz", result: i % 2 ? "1-0" : "0-1", plies: 6,
          sans: "e4 e5 Nf3 Nc6 Bb5 a6", fen: "", side: "w", outcome: i % 2 ? "win" : "loss",
          motifs: {}, an: null });
      }
      window.__seedLib = { names: ["hxddh"], games: games };
    });
    await page.evaluate(seedLibrary, await page.evaluate(() => window.__seedLib));
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    await page.click('#rail button[data-view="library"]', { timeout: 2000 }).catch(() => {});
    await page.click("#lib-open", { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(500);
    const fold = await openLibFilters(page);
    assert(fold.wasShut && fold.search, lang + ": 列表先给搜索，其余筛选收着 (" + JSON.stringify(fold) + ")");
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#lib-list .hist-row")].filter((e) => e.offsetParent);
      const segs = [...document.querySelectorAll("#lib-list-modal .hist-filters .theme-row")].map((seg) => {
        const by = seg.getAttribute("aria-labelledby");
        const label = by ? document.getElementById(by) : null;
        const bs = [...seg.querySelectorAll("button")];
        return { id: seg.id, label: label && label.offsetParent ? label.textContent.trim() : null,
                 stray: seg.getAttribute("aria-label"),
                 heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
                 // equal-width segments come from minmax(0, 1fr) columns; a fractional
                 // share is snapped to 1/64 px per column, so two equal segments can
                 // round to 204 and 205 — compare the raw widths instead
                 widths: bs.map((b) => b.getBoundingClientRect().width),
                 spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.trim()) };
      });
      return { n: rows.length,
               rowH: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               segs };
    });
    assert(r.n >= 20, lang + ": 棋谱库列表摆出了那些棋 (" + r.n + ")");
    assert(r.rowH.length === 1,
      lang + ": 每一行一样高 (" + r.rowH.join(", ") + ")");
    assert(r.segs.length === 5, lang + ": 五排筛选/排序都在 —— 结果、执子、排序、来源、用时 (" + r.segs.length + ")");
    for (const s of r.segs) {
      assert(s.label, s.id + " (" + lang + "): 有一个看得见的标签，不是只有读屏听得见的那种");
      assert(!s.stray, s.id + " (" + lang + "): 而且没有第二份 aria-label");
      assert(s.heights.length === 1 && s.heights[0] < 40,
        s.id + " (" + lang + "): 每一段都是一行高 (" + s.heights.join(", ") + ")");
      assert(Math.max(...s.widths) - Math.min(...s.widths) < 0.1,
        s.id + " (" + lang + "): 每一段等宽 (" + s.widths.map((w) => w.toFixed(2)).join(", ") + ")");
      assert(s.spill.length === 0,
        s.id + " (" + lang + "): 文字没有从按钮里挤出来" +
        (s.spill.length ? " —— " + s.spill.join(", ") : ""));
    }
    await ctx.close();
  }
}

// --- 4b. nothing is held out below the board any more ---------------------
// The chrome bar's height is held out of the board so its gradient never sits
// on rank 8 — the comment on `.stage` says exactly that. The spine was the
// same case at the bottom and got the same treatment: a 24px pill pinned 6px
// off the floor, over a board fitted to within 6px of what it is given, so a
// 30px strip was reserved under the board whenever the panel was shut. (Before
// that reservation existed the pill ran 490–514 against a–h at 498–513 at
// 520x520, and 870–894 against 878–893 at 1400x900 — the file row, at every
// size, with the pill's own text lying across c–f.)
//
// The bar took the spine's job, so the strip is not reserved and not spent:
// the board is the same size with the panel shut as it is with the panel open
// on a window this shape, and it reaches the floor. What is guarded is that
// the strip does not come back — a board that stops short of the bottom edge
// by ~30px is exactly what a re-reserved --spine-h looks like.
if (scenario()) {
  for (const [w, h] of [[1400, 900], [900, 700], [520, 520]]) {
    const { ctx, page } = await open("zh-CN", "ai", "play", "wood", { width: w, height: h });
    await page.keyboard.press("p");          // shut the panel
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const app = document.getElementById("app");
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      // 7.7: below the board is the player's own strip (--strip-h) and the
      // vertical pad (--stage-pad-y) — both are the layout, not a spine
      const cs = getComputedStyle(app);
      const pad = (parseFloat(cs.getPropertyValue("--strip-h")) || 0) + (parseFloat(cs.getPropertyValue("--stage-pad-y")) || 0);
      return { shut: !app.classList.contains("panel-open"),
               bottom: Math.round(wrap.bottom), board: Math.round(wrap.width),
               pad: Math.round(pad), vh: innerHeight,
               heightBound: Math.round(wrap.width) <= innerWidth - 2 * (parseFloat(cs.getPropertyValue("--stage-pad")) || 6) - 1 };
    });
    assert(r.shut, w + "x" + h + ": the panel is shut");
    assert(r.bottom <= r.vh, w + "x" + h + ": the board ends inside the window (" + r.bottom + " of " + r.vh + ")");
    // only meaningful where the board is height-bound; in a wide short window
    // it is the width that runs out first and the floor gap is not the spine's
    if (r.heightBound) {
      assert(r.vh - r.bottom <= r.pad + 1,
        w + "x" + h + ": …and reaches it — no strip is held below it (" +
        (r.vh - r.bottom) + "px left over, pad is " + r.pad + ")");
    }
    await ctx.close();
  }
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const gone = await page.evaluate(() =>
    getComputedStyle(document.getElementById("app")).getPropertyValue("--spine-h").trim());
  assert(gone === "", "--spine-h is not declared at all any more (" + JSON.stringify(gone) + ")");
  await ctx.close();
}

// --- 4c. the smallest window the app allows ------------------------------
// app.zon sets min_width/min_height to 520 and every assertion in this file was
// written at 1400x900. docs/manual-check.md D5 ("缩到某个尺寸就不再变小，布局
// 不塌") is the only thing that ever covered the other end, and nobody has run
// it. These are the same questions the wide checks ask, asked at 520.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play", "wood", { width: 520, height: 520 });
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const past = [...document.querySelectorAll("body *")]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1)
        .map((e) => ((e.textContent || "").trim().slice(0, 14) || e.tagName) +
                    " +" + Math.round(e.getBoundingClientRect().right - innerWidth));
      const spilled = [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent && b.scrollHeight > b.clientHeight + 1)
        .map((b) => b.textContent.trim().slice(0, 14));
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      return { hScroll: de.scrollWidth > de.clientWidth + 1,
               past: past.slice(0, 5), spilled: [...new Set(spilled)].slice(0, 5),
               board: Math.round(wrap.width),
               boardIn: wrap.bottom <= innerHeight + 1 && wrap.right <= innerWidth + 1 };
    });
    assert(!r.hScroll, lang + " @520: the page does not scroll sideways");
    assert(r.past.length === 0,
      lang + " @520: nothing is drawn past the window edge" +
      (r.past.length ? " — " + r.past.join(", ") : ""));
    assert(r.spilled.length === 0,
      lang + " @520: no label breaks out of its button" +
      (r.spilled.length ? " — " + r.spilled.join(", ") : ""));
    assert(r.boardIn && r.board > 300,
      lang + " @520: the board is whole and still the biggest thing on screen (" + r.board + "px)");
    await ctx.close();
  }
}

// --- 4d. a lesson button holds its own label ------------------------------
// The same defect as the editor's action row, in the teaching track, left
// there when 2.1.2 fixed the editor. `.tool-btn` is 32px tall and does not
// wrap, so a label that needs two lines came out through the bottom of the
// pill. Measured on the shipped 2.1.3, every lesson offering all four buttons
// leaked in all three languages — 「接着练 2 题」 as 「接着练 2 / 题」 with
// 「题」 hanging under the border, 「Practise (2)」 and 「Next lesson」 both in
// English, 「続けて2問」 and 「次のレッスン」 in Japanese. Lesson 72 leaks with
// only two buttons: 「Play the Beginner engine」, the one button the whole
// teaching track exists to reach.
// Not the editor's fix — that row overflowed sideways and needed 2×2. This one
// fits across; what it did not fit was the label inside the box.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "learn", "play");
    // 6.0: the list ends with the ten classic games (data-c), which are read,
    // not answered — no button row, and v8-1-plan T2 put the endgame camp
    // (data-eg) after them — and v8-2-plan T3 the same ten games to guess
    // (data-gs) between the two. The probes stay on the lessons proper, and
    // the last of those is still the one with the graduation button.
    const n = await page.evaluate(() => document.querySelectorAll("#lesson-list .lesson-item:not([data-c]):not([data-eg]):not([data-gs])").length);
    assert(n > 60, lang + ": the course is loaded (" + n + " lessons)");
    // the lessons that show all four, plus the last one — its label is the
    // longest in the file and it appears in a two-button row
    const probes = [17, 19, 21, n - 1];
    for (const i of probes) {
      const r = await page.evaluate(async (i) => {
        const it = document.querySelectorAll("#lesson-list .lesson-item")[i];
        if (it) it.click();
        await new Promise((r) => setTimeout(r, 150));
        const row = document.querySelector("#sec-learn .lesson-controls");
        const bs = [...row.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        const rr = row.getBoundingClientRect();
        return { n: bs.length, labels: bs.map((b) => b.textContent.trim()),
                 heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
                 spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1)
                   .map((b) => b.textContent.trim() + " (" + b.scrollHeight + ">" + b.clientHeight + ")"),
                 past: bs.filter((b) => b.getBoundingClientRect().right > rr.right + 1)
                   .map((b) => b.textContent.trim()) };
      }, i);
      const at = lang + " lesson " + (i + 1) + " (" + r.n + " buttons)";
      assert(r.spill.length === 0,
        at + ": every label stays inside its button" +
        (r.spill.length ? " — " + r.spill.join("; ") : ""));
      assert(r.past.length === 0,
        at + ": and no button reaches past the row" +
        (r.past.length ? " — " + r.past.join(", ") : ""));
      assert(r.heights.length === 1,
        at + ": the row is one control, one height (" + r.heights.join(", ") + ")");
    }
    await ctx.close();
  }
}

// --- 4e. five save slots are five of the same thing -----------------------
// All four facts shared the second line — 「Engine · Unrated · 3 moves ·
// 8/2/2026, 8:59:30 AM」 — and in English that is 249px of text in 228, so the
// two filled slots stood 71px and 87px against the three empty ones' 55. Five
// identical things in three heights, in the dialog whose whole job is letting
// you compare them. Now the row is the shape the history list already uses:
// what kind of game on the first line, how long and when on the second — and
// the dialog is the wide one, because this is the second list of sentences in
// the app and 2.1.2 only widened the first.
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    await page.evaluate(() => {
      const mk = (d) => ({ pgn: '[Event "?"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *',
                           savedAt: Date.now() - 1e7, mode: "ai", diff: d });
      localStorage.setItem("chess.slots",
        JSON.stringify({ v: 1, slots: [mk("extreme"), mk("beginner"), null, null, null] }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    await pressMore(page, "slots-open");
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#slots-list > *")].filter((e) => e.offsetParent);
      const box = document.querySelector("#slots-modal .modal");
      return { n: rows.length,
               wide: box.classList.contains("wide"),
               heights: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               inline: rows.filter((e) => e.getAttribute("style")).length,
               spill: rows.filter((e) => e.scrollHeight > e.clientHeight + 1)
                 .map((e) => (e.textContent || "").trim().slice(0, 24)) };
    });
    assert(r.n === 5, lang + ": five slots (" + r.n + ")");
    assert(r.wide, lang + ": the slot list gets the wide box, like the other list of sentences");
    assert(r.heights.length === 1,
      lang + ": a filled slot is the same height as an empty one (" + r.heights.join(", ") + ")");
    assert(r.inline === 0, lang + ": the row is built from a class, not an inline style");
    assert(r.spill.length === 0,
      lang + ": nothing overflows a slot row" + (r.spill.length ? " — " + r.spill.join(", ") : ""));
    await ctx.close();
  }
}

// --- 4f. the game picker is the third list, found the same way ------------
// A PGN file may hold a database, and the picker lists what is in it: one row
// per game, 「N. White — Black  result」 over 「event · date · plies」. Real
// games vary in name and event length, so the rows varied with them — measured
// on a four-game file, 55px and 71px in all three languages. The same shape as
// the history rows and the save slots, in the same 380px box, found two
// versions after the first one was fixed. Guarded structurally in
// test-chess.mjs as well: any dialog holding a `.pick-list` gets the wide box.
if (scenario()) {
  const GAMES = [
    ["Linares Super Tournament 1994", "Kasparov, Garry", "Karpov, Anatoly", "1-0"],
    ["Ch", "Li, Y", "Wu, X", "1/2-1/2"],
    ["World Championship Match, Game 6", "Nepomniachtchi, Ian", "Carlsen, Magnus", "0-1"],
    ["Op", "Ivanov, A", "Petrov, B", "1-0"],
  ];
  const PGN = GAMES.map(([ev, w, b, r], i) =>
    '[Event "' + ev + '"]\n[Site "Somewhere"]\n[Date "199' + i + '.02.1' + i + '"]\n' +
    '[White "' + w + '"]\n[Black "' + b + '"]\n[Result "' + r + '"]\n\n' +
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 ' + r).join("\n\n");
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    const opened = await page.evaluate(async (pgn) => {
      const dt = new DataTransfer();
      dt.items.add(new File([pgn], "games.pgn", { type: "application/x-chess-pgn" }));
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 900));
      return document.getElementById("pick-modal").classList.contains("show");
    }, PGN);
    assert(opened, lang + ": a four-game PGN opens the picker");
    const r = await page.evaluate(() => {
      const box = document.querySelector("#pick-modal .modal");
      const rows = [...document.querySelectorAll("#pick-list .pick-item")];
      return { wide: box.classList.contains("wide"), n: rows.length,
               heights: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               tallest: (rows.find((e) => e.getBoundingClientRect().height ===
                 Math.max(...rows.map((x) => x.getBoundingClientRect().height))) || {}).textContent };
    });
    assert(r.n === 4, lang + ": all four games are listed (" + r.n + ")");
    assert(r.wide, lang + ": the picker gets the wide box");
    assert(r.heights.length === 1,
      lang + ": every game in the list is the same height (" + r.heights.join(", ") + ") — tallest is 「" +
      (r.tallest || "").trim().replace(/\s+/g, " ").slice(0, 40) + "」");
    await ctx.close();
  }
}

// --- 4g. the first launch, which nothing here had ever exercised -----------
// Every context in this file seeds localStorage before the page loads, so the
// one path every new user takes — cold start — was untested by construction.
// It was also broken: `firstRun` was computed by reading four keys at the end
// of init, and the puzzle store writes an empty record at import time, into the
// same bag those reads come out of. So it was false for everybody, and it gates
// two things — the first-run guide, and `detectLang()`.
// Measured on the shipped 2.1.4 with clean storage: en-US, ja-JP, zh-CN and
// de-DE all came up in Chinese, and the guide never appeared. Both of those are
// what docs/manual-check.md A3 names as the failure, and A3 has never been run.
if (scenario()) {
  // de-DE is here on purpose: an unsupported locale falls back to Chinese by
  // design (test-chess pins fr-FR → zh-CN), so it proves the fallback still
  // works rather than that everything is Chinese again.
  for (const [locale, lang, tab] of [
    // 9.0 S5: read off the rail's 设置 (nav.settings) — the panel's 对局 tab,
    // which this used to read, is gone with the tab row
    ["en-US", "en", "Settings"], ["ja-JP", "ja", "設定"],
    ["zh-CN", "zh-CN", "设置"], ["de-DE", "zh-CN", "设置"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale });
    const page = await ctx.newPage();          // nothing seeded: a new install
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      shown: document.getElementById("pick-modal").classList.contains("show"),
      items: document.querySelectorAll("#pick-list .pick-item").length,
      firstTab: (document.querySelector('.rail-btn[data-view="settings"] .rail-lbl') || {}).textContent,
      stored: JSON.parse(localStorage.getItem("chess.settings") || "{}").langId,
    }));
    assert(r.shown, locale + ": a new install opens the guide");
    // v10-0-plan T1: three ways in — never played, knows the moves, plays often
    assert(r.items === 3, locale + ": …with the three ways in (" + r.items + ")");
    assert(r.stored === lang, locale + ": the app starts in the system's language (" + r.stored + ")");
    assert((r.firstTab || "").trim() === tab,
      locale + ": …and the interface is in it — 「" + (r.firstTab || "").trim() + "」");
    // choosing an answer closes it, and it does not come back
    const after = await page.evaluate(async () => {
      document.querySelector("#pick-list .pick-item").click();
      await new Promise((r) => setTimeout(r, 600));
      return document.getElementById("pick-modal").classList.contains("show");
    });
    assert(!after, locale + ": answering it closes it");
    // 7.6 §3a: the first answer is 「我是新手」 — the lesson it opens is not
    // the whole of it: the engine waiting after the lessons is the Beginner
    // one, not the default 1700 (「我会下棋」 was already getting a lower rung)
    const chose = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.settings") || "{}"));
    assert(chose.mode === "learn" && chose.difficulty === "beginner",
      locale + ": 「new to chess」 lands in the lessons with the Beginner engine (" +
      chose.mode + " / " + chose.difficulty + ")");
    await page.reload();
    await page.waitForTimeout(1100);
    const again = await page.evaluate(() =>
      document.getElementById("pick-modal").classList.contains("show"));
    assert(!again, locale + ": and the second launch is not a first launch");
    await ctx.close();
  }
}

// --- 2.2:面板只说一种控件语言,而且同屏只有一个主按钮 ----------------------
// 2.1.9 实测:设置页用的是有边框的分段控件,对局页用的是 12px 无边框无填充的
// 文本链接 —— 同一块面板两种语言,而对局页恰恰是主屏。同时十六个动作一样重,
// 「认输」和「PGN」看起来同样可点。这一节量的就是这两件事。
// 9.0 S5: the 设置 tab is the settings page; there the whole page is the
// screen (all six categories measured together — each is shown alone, but
// they are one family of controls)
if (scenario()) for (const [lang, mode, tab] of [["zh-CN", "ai", "play"], ["en", "pvp", "play"], ["ja", "ai", "settings"]]) {
  const { ctx, page } = await open(lang, mode, tab);
  // 7.7 §3: at 0 moves the play pane has no action buttons left to measure —
  // the tools became an icon row and 本局 waits for a game — so play one.
  if (tab === "play") {
    for (const sq of ["e2", "e4"]) {
      const p = await page.evaluate((s) => { const r = document.getElementById("board").getBoundingClientRect();
        const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
        return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) }; }, sq);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(140);
    }
    await page.waitForTimeout(400);
  }
  const shape = await page.evaluate((root) => {
    const vis = (e) => { const b = e.getBoundingClientRect();
      return e.offsetParent !== null && b.width > 0 && b.height > 0; };
    const shut = root === "#page-settings" ? [...document.querySelectorAll(".set-pane[hidden]")] : [];
    for (const p of shut) p.hidden = false;
    // the A3 picker tiles are not the panel's since the M2 merge (they live
    // in the preferences window, measured below), and are left out here
    const btns = [...document.querySelectorAll(`${root} .act-btn, ${root} .theme-row:not(.look-grid) button`)].filter(vis);
    const kind = (e) => { const s = getComputedStyle(e);
      return [s.fontSize, s.fontWeight, s.borderStyle, Math.round(e.getBoundingClientRect().height)].join("|"); };
    const kinds = {};
    for (const b of btns) (kinds[kind(b)] ||= []).push(b.id || b.textContent.trim().slice(0, 6));
    const out = {
      n: btns.length,
      heights: [...new Set(btns.map((b) => Math.round(b.getBoundingClientRect().height)))].sort((a, c) => a - c),
      sizes: [...new Set(btns.map((b) => getComputedStyle(b).fontSize))],
      // 9.0 V1: a segment is a place in a tray — the tray carries the
      // hairline (an inset box-shadow), not each segment; an action is a
      // bordered button. Neither is a bare text link.
      borderless: btns.filter((b) => b.matches(".theme-row button")
        ? !/inset/.test(getComputedStyle(b.parentElement).boxShadow)
        : getComputedStyle(b).borderStyle === "none").map((b) => b.id || b.textContent.trim().slice(0, 8)),
      primaries: [...document.querySelectorAll(`${root} .act-btn.primary`)].filter(vis).map((b) => b.id),
      kinds: Object.entries(kinds).map(([k, v]) => k + " ← " + v.join(",")),
    };
    for (const p of shut) p.hidden = true;
    return out;
  }, tab === "settings" ? "#page-settings" : "#side");
  // 数量本身不是这一节要断言的东西:没有棋谱时 PGN/导出/分析/精析 是「不渲染」
  // 而不是「置灰」(见 .act-btn:disabled)，所以 0 手时对局页只剩四个。这条只是
  // 确认下面几条真的量到了东西。
  assert(shape.n >= 3, `${lang}/${tab}: 面板里数得到动作按钮(${shape.n} 个:${JSON.stringify(shape.kinds)})`);
  assert(shape.borderless.length === 0,
    `${lang}/${tab}: 没有一个动作是无边框的文本链接(${JSON.stringify(shape.borderless)})`);
  assert(shape.sizes.length === 1, `${lang}/${tab}: 所有动作一个字号(${shape.sizes.join(" ")})`);
  assert(shape.heights.length <= 2,
    `${lang}/${tab}: 高度最多两种(一行的和折行的),实际 ${JSON.stringify(shape.heights)}`);
  assert(shape.primaries.length <= 1,
    `${lang}/${tab}: 同屏最多一个主按钮(${JSON.stringify(shape.primaries)})`);
  // v8-0-plan A3: the board and piece pickers are pictures of what they
  // choose (a corner of the board, two kings) — a tile, not an action, and
  // their height is the picture's; they answer to the segment family in
  // everything else (font, border). Since the M2 merge they live in the
  // preferences window (A1), so they are measured there, against that
  // window's own segments — and finding none is a failure, not a pass.
  // 9.0 S5: that window is the settings page (the tiles in 棋盘, measured
  // against the segments of every category, as the window held them all)
  await page.click('.rail-btn[data-view="settings"]');
  await page.waitForTimeout(300);
  await showCat(page, "board");
  const look = await page.evaluate(() => {
    const m = document.getElementById("page-settings");
    const shut = [...m.querySelectorAll(".set-pane[hidden]")];
    for (const p of shut) p.hidden = false;
    const vis = (e) => { const b = e.getBoundingClientRect(); return e.offsetParent !== null && b.width > 0 && b.height > 0; };
    // 9.0 V1: the box is the tray's (an inset hairline), so the kind is the
    // segment's type and its tray's edge
    const k = (b) => getComputedStyle(b).fontSize + "|" + getComputedStyle(b).borderStyle + "|" + /inset/.test(getComputedStyle(b.parentElement).boxShadow);
    const tiles = [...m.querySelectorAll(".look-grid button")].filter(vis);
    const segs = [...m.querySelectorAll(".theme-row:not(.look-grid) button")].filter(vis);
    const out = { open: !m.hidden, tiles: tiles.length, segs: segs.length,
             tileKinds: [...new Set(tiles.map(k))], segKinds: [...new Set(segs.map(k))] };
    for (const p of shut) p.hidden = true;
    return out;
  });
  assert(look.open && look.tiles === 12 && look.segs >= 5,
    `${lang}/${tab}: 设置页里量得到棋盘与棋子的图块(${look.tiles} / 12)和分段控件(${look.segs})`);
  assert(look.tileKinds.length === 1 && look.segKinds.length === 1 && look.tileKinds[0] === look.segKinds[0],
    `${lang}/${tab}: 棋盘与棋子的图块和分段控件同一字号、同一边框(${look.tileKinds.join(" ")} vs ${look.segKinds.join(" ")})`);
  await ctx.close();
}

// 主按钮什么时候出现:这局下完、而且还没分析过 —— 正是空复盘段一直用散文写着
// 的那句话（「完局后点『分析』可记录精准度」）。对局进行中没有「唯一该点的
// 那一个」,那就一个都不填。
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play");
  const at = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board"); const r = c.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const primaries = () => page.evaluate(() =>
    // 9.0 M1: the result is a bar under the board, not in the panel
    [...document.querySelectorAll("#side .act-btn.primary, #go-card .act-btn.primary")].filter((b) => b.offsetParent).map((b) => b.id));
  const play = async (a, b) => {
    for (const sq of [a, b]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(140); }
    await page.waitForTimeout(320);
  };
  assert((await primaries()).length === 0, "开局:没有任何动作被填成主按钮");
  await play("f2", "f3"); await play("e7", "e5");
  assert((await primaries()).length === 0, "对局进行中:仍然没有");
  await play("g2", "g4"); await play("d8", "h4");   // 愚人将杀
  await page.waitForTimeout(600);
  const after = await primaries();
  // 7.7 §4: the one to press now sits on the result bar (复盘这局); the review
  // row's 分析 takes the fill back once the card is put away — the §4 block
  // near the end of this file checks that half.
  assert(JSON.stringify(after) === '["go-analyse"]',
    `这局下完了,结果条上的「复盘这局」成为唯一的主按钮(实际 ${JSON.stringify(after)})`);
  await ctx.close();
}

// --- 4h. the native menu obeys the gates the keyboard obeys ---------------
//
// The menu bar is the other half of the same shortcuts, and it was reaching
// the actions past both gates the letter keys stop at. Measured on 2.2.2, in
// this harness, with the bridge faked far enough that host.js believes it:
//
//   ⌘N inside 做题 / 教学  →  「开始新局将清空当前对局」 over the trainer,
//                             and the main game gone on OK. N there is 下一题.
//   ⌘F inside 做题 / 教学  →  an authored board flipped. F there does nothing.
//   ⌘F with a dialog up    →  the board behind it flipped.
//
// Every case below is one of those, plus the other direction — the commands
// still have to work where they always did, or "fixing" this would just be
// taking the menu away.
if (scenario()) {
  /* The SDK injects `zero`; nothing in a headless page does. host.js only
     asks whether it is an object, and the one thing this section needs from
     it is the shortcut handler the app registers through `zero.on`. */
  const openBridged = async (mode) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((m) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: m, langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      window.__handlers = {};
      window.zero = {
        on: (n, cb) => { (window.__handlers[n] = window.__handlers[n] || []).push(cb); return () => {}; },
        invoke: async () => ({}),
        platform: { supports: async () => false },
      };
      window.__fire = (command) => {
        for (const cb of window.__handlers.shortcut || []) cb({ command, id: command, windowId: 1 });
      };
    }, mode);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
    return { ctx, page };
  };
  const fire = async (page, cmd) => { await page.evaluate((c) => window.__fire(c), cmd); await page.waitForTimeout(450); };
  const orient = (page) => page.evaluate(() =>
    [...document.querySelectorAll("#orient-seg button")].filter((b) => b.classList.contains("active")).map((b) => b.dataset.orient)[0]);
  const rows = (page) => page.evaluate(() => document.querySelectorAll(".mlrow").length);
  const confirmUp = (page) => page.evaluate(() => {
    const m = document.getElementById("confirm-modal");
    return !!m && m.classList.contains("show");
  });
  const at = (page, sq) => page.evaluate((x) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (x.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(x[1]) + 0.5) * (r.height / 8) };
  }, sq);
  const play = async (page, a, b) => {
    for (const sq of [a, b]) { const p = await at(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); }
    await page.waitForTimeout(280);
  };
  // v8-0-plan A1: a trainer is the rail's; 双人 comes with a new game
  const toSetup = async (page, mode) => {
    if (mode === "puzzle" || mode === "learn") {
      // 9.0 S3: one rail entry, 训练; the mode is its segment (谜题 / 课程)
      await page.click('#rail button[data-view="train"]'); await page.waitForTimeout(500);
      const seg = mode === "puzzle" ? "puzzle" : "course";
      if (await page.evaluate((s) => document.querySelector('#train-seg button[data-seg="' + s + '"]').getAttribute("aria-pressed") !== "true", seg))
        await page.click(`#train-seg button[data-seg="${seg}"]`);
      await page.waitForTimeout(800);
      assert(await page.evaluate((m) => document.getElementById("app").dataset.mode === m, mode), "训练 → " + seg + " puts the board in " + mode);
    } else {
      await page.click('#rail button[data-view="play"]'); await page.waitForTimeout(400);
      if (await page.evaluate((m) => JSON.parse(localStorage.getItem("chess.settings")).mode !== m, mode)) {
        await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);
        await page.click(`#mode-seg button[data-mode="${mode}"]`);
        await page.click("#ng-start"); await page.waitForTimeout(800);
      }
    }
    // 9.0 S5: no 对局 tab to click — the panel is one pane, already showing
  };

  // 1. a game in progress, then into a trainer: the menu must not be able to
  //    reach back and delete it.
  for (const trainer of ["puzzle", "learn"]) {
    const { ctx, page } = await openBridged("pvp");
    await play(page, "e2", "e4"); await play(page, "e7", "e5");
    const before = await rows(page);
    assert(before > 0, `${trainer}:先在双人下出 ${before} 行着法`);
    await toSetup(page, trainer);
    await fire(page, "game.new");
    assert(!(await confirmUp(page)), `${trainer}:菜单「新局」没有在训练界面上弹确认框`);
    await toSetup(page, "pvp");
    assert((await rows(page)) === before, `${trainer}:主对局的 ${before} 行着法还在`);
    await ctx.close();
  }

  // 2. an authored board does not turn round because the menu said so
  for (const trainer of ["puzzle", "learn"]) {
    const { ctx, page } = await openBridged(trainer);
    const before = await orient(page);
    await fire(page, "game.flip");
    assert((await orient(page)) === before, `${trainer}:菜单「翻转棋盘」没有翻动课程/题目摆好的方向(${before})`);
    await ctx.close();
  }

  // 3. a dialog is in front of the game — for the menu too
  {
    const { ctx, page } = await openBridged("ai");
    await page.keyboard.press("?");
    await page.waitForTimeout(400);
    const up = await page.evaluate(() => [...document.querySelectorAll(".modal-bg.show")].map((d) => d.id).join(","));
    assert(up === "keys-modal", `快捷键表打开了(${up})`);
    const before = await orient(page);
    await fire(page, "game.flip");
    assert((await orient(page)) === before, "对话框开着时,菜单「翻转棋盘」和 F 一样什么也不做");
    // …and the one command that is about a dialog still closes its own
    await fire(page, "help.keys");
    assert(!(await page.evaluate(() => document.getElementById("keys-modal").classList.contains("show"))),
      "菜单「快捷键」关掉的是它自己那张表");
    await ctx.close();
  }

  // 4. the other direction: where the keys work, the menu still works
  {
    const { ctx, page } = await openBridged("ai");
    const before = await orient(page);
    await fire(page, "game.flip");
    assert((await orient(page)) !== before, "人机对局里,菜单「翻转棋盘」照常翻");
    await fire(page, "view.panel");
    assert(!(await page.evaluate(() => document.getElementById("app").classList.contains("panel-open"))),
      "……「侧栏」照常开合");
    await fire(page, "help.keys");
    assert(await page.evaluate(() => document.getElementById("keys-modal").classList.contains("show")),
      "……「快捷键」照常打开");
    await ctx.close();
  }

  // 5. and the sheet finally says the menu exists
  {
    const { ctx, page } = await openBridged("ai");
    await page.keyboard.press("?");
    await page.waitForTimeout(400);
    const accels = await page.evaluate(() =>
      [...document.querySelectorAll("#keys-list kbd.accel")].map((k) => k.textContent));
    assert(accels.length >= 7,
      `人机模式的快捷键表列出了菜单的快捷键(${accels.length} 个:${accels.join(" ")})`);
    // "primary" IS ⌘ on macOS and Ctrl on Windows; the sheet has to name the
    // one this machine has, not pick one and hope.
    const mod = accels[0] && accels[0].startsWith("⌘") ? "⌘" : "Ctrl+";
    assert(accels.every((a) => a.startsWith(mod)),
      `……而且用的是这台机器上的那个修饰键(${mod})`);
    // 引擎提示 is the only one with two modifiers — ⌘H is the system's
    // 「隐藏应用」, which is why it is ⌘⇧H — so the sheet must spell both.
    assert(accels.includes(mod === "⌘" ? "⌘⇧H" : "Ctrl+Shift+H"),
      `……「引擎提示」的两个修饰键都写出来了(${accels.join(" ")})`);
    await ctx.close();
  }
}

// --- 4i. the three irreversible questions are asked by the platform -------
//
// 「清除全部存档」 wipes every key this app has ever written, and it asked
// with a div. A `.modal-bg` shares the window with the thing it is asking
// about and is styled like the rest of the app — which is the one place that
// is wrong, because this is the only question in the app whose answer cannot
// be taken back. The SDK has had `dialogs.showMessage` since 0.4 and nothing
// here had ever called it.
//
// Three properties, and the third is the one that matters: a build WITHOUT a
// native dialog must still be able to ask. `Host.showMessage` returning null
// means "no such dialog here", and reading that as "the player said no" would
// turn a missing capability into a dead button.
if (scenario()) {
  const openDialogBridge = async (answer, supported) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript(([a, sup]) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "ai", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.stats", JSON.stringify({ v: 1, games: 3 }));
      window.__asked = [];
      window.zero = {
        on: () => () => {}, invoke: async () => ({}),
        platform: { supports: async (v) => (v && (v.feature || v.name) === "dialogs" ? sup : false) },
        dialogs: {
          showMessage: async (opts) => { window.__asked.push(opts); return a; },
        },
      };
    }, [answer, supported]);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
    return { ctx, page };
  };
  // v8-0-plan A1: the deletions are in 偏好设置; 9.0 S5: the settings page's 「数据」
  const toData = async (page) => {
    await page.click('.rail-btn[data-view="settings"]'); await page.waitForTimeout(300);
    await showCat(page, "data");
  };
  const asked = (page) => page.evaluate(() => window.__asked);
  const inPageUp = (page) => page.evaluate(() =>
    !!document.getElementById("confirm-modal").classList.contains("show"));
  const saved = (page) => page.evaluate(() => localStorage.getItem("chess.stats"));

  // 1. it asks the platform, with the right shape, and takes "no" for an answer
  {
    const { ctx, page } = await openDialogBridge("secondary", true);
    await toData(page);
    await page.click("#clear-save");
    await page.waitForTimeout(500);
    const calls = await asked(page);
    assert(calls.length === 1, `「清除全部存档」问的是系统对话框(${calls.length} 次)`);
    assert(calls[0] && calls[0].style === "critical", `……而且是 critical 的那种(${calls[0] && calls[0].style})`);
    assert(!!(calls[0] && calls[0].primaryButton && calls[0].secondaryButton),
      `……两个按钮都带着自己的文案(${calls[0] && calls[0].primaryButton}/${calls[0] && calls[0].secondaryButton})`);
    assert(!(await inPageUp(page)), "……页内那个框没有跟着一起弹");
    assert((await saved(page)) !== null, "……答「取消」,存档一个字都没动");
    await ctx.close();
  }

  // 2. and takes "yes" for one
  {
    const { ctx, page } = await openDialogBridge("primary", true);
    await toData(page);
    await page.click("#clear-save");
    await page.waitForTimeout(900);
    assert((await saved(page)) === null, "答「清除」,存档真的没了");
    await ctx.close();
  }

  // 3. a build with no native dialog still asks — in the page, as before
  {
    const { ctx, page } = await openDialogBridge("primary", false);
    await toData(page);
    await page.click("#clear-save");
    await page.waitForTimeout(500);
    assert((await asked(page)).length === 0, "平台说自己没有对话框时,不去调它");
    assert(await inPageUp(page), "……改用页内那个框问");
    assert((await saved(page)) !== null, "……而且在得到回答之前什么也没删");
    await ctx.close();
  }
}

// --- 4j. 顶栏的墨序跟着信息的价值走,不跟着它的新鲜度走 ---------------------
//
// 对着一帧实局评估过:「2．e4」曾是整条栏对比度最高的文字 —— 白色数字加
// 药丸底 —— 而它是栏里最短命也最冗余的事实,棋盘上两个高亮格正说着同一件
// 事。每半着变一次内容的东西穿着最响的墨,就是余光里的规律性脉冲。它的两
// 个真正职责(复盘时指认第几着、窄窗无面板时替补棋盘高亮)都只要求它在,
// 不要求它响。轮次同理:状态药丸永远在说,计时局里走表那侧的钟又亮着,
// 「行」徽章只在不计时的对局里才是第二个不多余的说法。
if (scenario()) {
  const openTc = async (tc) => {
    const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 }, locale: "zh-CN" });
    await ctx.addInitScript((t) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", timeControl: t }));
      localStorage.setItem("chess.panelOpen", "0");
    }, tc);
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
    const mv = async (sq) => {
      const pt = await page.evaluate((s) => {
        const r = document.getElementById("board").getBoundingClientRect();
        return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                 y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(180);
    };
    await mv("e2"); await mv("e4");
    await page.waitForTimeout(300);
    return { ctx, page };
  };

  // 7.7 (v7-7-plan §2): the last move is the board's two highlighted squares
  // and the notation's current move — the bar's middle slot that repeated it
  // is gone with the bar. Whose move it is is said once, by the lit strip: in
  // an untimed game the side's disc takes the accent ring, in a timed one
  // the running clock is lit as well, on the same strip.
  {
    const { ctx, page } = await openTc("off");
    const m = await page.evaluate(() => ({
      lastSlot: !!document.getElementById("vs-last"),
      activeB: document.getElementById("strip-b").classList.contains("is-active"),
      activeW: document.getElementById("strip-w").classList.contains("is-active"),
      ring: getComputedStyle(document.getElementById("av-b")).boxShadow !== "none",
      clocksHidden: document.getElementById("clock-w").hidden && document.getElementById("clock-b").hidden,
    }));
    assert(!m.lastSlot, "上一手不再在顶栏里重复一遍(棋盘高亮和棋谱已经说了)");
    assert(m.activeB && !m.activeW && m.ring, "不计时局:轮到的黑方那条亮起(圆标带强调色描边)");
    assert(m.clocksHidden, "……钟不画");
    await ctx.close();
  }
  {
    const { ctx, page } = await openTc("3+2");
    const m = await page.evaluate(() => ({
      clocksShown: !document.getElementById("clock-w").hidden && !document.getElementById("clock-b").hidden,
      stripB: document.getElementById("strip-b").classList.contains("is-active"),
      activeIsBlack: document.getElementById("clock-b").classList.contains("active") &&
        !document.getElementById("clock-w").classList.contains("active"),
    }));
    assert(m.clocksShown && m.stripB, "计时局:钟在,轮到的黑方那条亮着");
    assert(m.activeIsBlack, "……走表的那侧钟亮着,正是轮到的黑方");
    await ctx.close();
  }
}

// --- 5. 竖窗：这一整类视口从来没有人量过（7.3 §1）------------------------
//
// 把侧栏换成底部抽屉的那条规则带着 `min-width: 560px`。比它窄的竖窗既不走抽屉
// （宽度不够），也不走窄横窗那一套（那条要求 min-aspect-ratio: 1/1），于是掉回
// 桌面那套：侧栏照旧占 284px，棋盘分剩下的。而 `chess.panelOpen` 的默认值是
// 「开」，所以这是首启第一屏。
//
// 这一整类视口在这套 e2e 里一次都没有出现过：48 个视口实例里 47 个宽度
// ≥1200px，唯一的窄视口是 520×520 —— 正方形，落进窄横窗那条规则，碰不到这里。
// 已发布的桌面壳允许 520×520 起步的窗口，所以 520×900 这种形状是真能摆出来的。
if (scenario()) {
  // 手机常见宽度，外加桌面壳允许的最窄窗口
  const PORTRAIT = [
    { width: 360, height: 780 },
    { width: 390, height: 844 },
    { width: 430, height: 932 },
    { width: 520, height: 900 },
  ];
  /** 棋盘小于这个数就不再是棋盘，是一张邮票 */
  const MIN_BOARD = 260;
  const measure = (page) => page.evaluate(() => {
    const b = document.getElementById("board").getBoundingClientRect();
    const de = document.documentElement;
    // a CLOSED panel is parked off-screen on purpose (translateX/Y 100%), so
    // everything inside it reads as "past the right edge" and means nothing
    const parked = document.getElementById("app").classList.contains("panel-open")
      ? null : document.getElementById("side");
    const over = [...document.querySelectorAll("body *")].filter((el) => {
      if (!el.offsetParent && el.tagName !== "BODY") return false;
      if (parked && (el === parked || parked.contains(el))) return false;
      const r = el.getBoundingClientRect();
      return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1);
    }).map((el) => el.id || el.className);
    return { board: Math.round(b.width), vw: de.clientWidth, vh: de.clientHeight, over };
  });

  for (const vp of PORTRAIT) {
    const size = vp.width + "×" + vp.height;
    // 面板记着「开」—— 这就是首启第一屏的状态，不需要先按任何东西
    const openPanel = await open("zh-CN", "ai", "play", "wood", vp, "1");
    const a = await measure(openPanel.page);
    assert(a.board >= MIN_BOARD,
      `${size} 面板开着时棋盘 ${a.board}px ≥ ${MIN_BOARD}px —— 这是首启第一屏`);
    assert(a.over.length === 0, `${size} 面板开着时没有元素越出视口`);
    assert(openPanel.errs.length === 0, `${size} 没有 JS 异常`);
    await openPanel.ctx.close();

    const shut = await open("zh-CN", "ai", "play", "wood", vp, "0");
    const b = await measure(shut.page);
    // 手机宽度上宽是短边，棋盘该铺满它；520×900 那种形状是高度在卡，
    // 「开合一样大」与「≥260」两条已经说完了该说的
    if (vp.width <= 430) {
      assert(b.board >= Math.round(b.vw * 0.85),
        `${size} 棋盘铺满宽度 ${b.board}px（≥ ${Math.round(b.vw * 0.85)}px）`);
    }
    await shut.ctx.close();

    // 抽屉是覆盖上去的，不是把棋盘挤小的 —— 两种状态下棋盘一样大
    assert(a.board === b.board,
      `${size} 开合面板棋盘一样大（开 ${a.board} / 合 ${b.board}）—— 抽屉盖在棋盘上，不挤它`);
  }

  // 三语各跑一遍首屏：文字长度不该把这件事变成另一种结果
  for (const lang of LANGS) {
    const { ctx, page, errs } = await open(lang, "ai", "play", "wood", { width: 390, height: 844 }, "1");
    const m = await measure(page);
    assert(m.board >= MIN_BOARD && m.over.length === 0 && errs.length === 0,
      `390×844 / ${lang}：棋盘 ${m.board}px，无溢出，无异常`);
    await ctx.close();
  }
}

// --- 5b. 真实可达的那一段：520…620 宽 × 520…960 高（7.4 §3）--------------
//
// 上面那组量的是 360 / 390 / 430 —— 已发布的桌面壳根本到不了（app.zon 的
// min_width = 520）。用户够得着、而 7.3 没有测的，是 520–620 这一段，尤其是
// 接近正方形的那些窗口。7.3.0 上实测（面板开 / 关，棋盘边长）：
//
//     540×543 → 210 / 465     559×562 → 229 / 484
//     560×900 → 408 / 514     600×610 → 251 / 532
//
// 宽 520–559、长宽比落在 (0.99, 1) 的窗口三条媒体查询一条都不命中；宽 ≥560 的
// 竖窗走旧抽屉，面板一开棋盘就缩。这里把整张网格走一遍，每格面板开关各量一次。
// 一个页面、改视口尺寸、按 ☰ —— 每格开一个新页面要跑十几分钟。
if (scenario()) {
  const MIN_BOARD = 260;
  const sizes = [];
  for (let w = 520; w <= 620; w += 10) {
    for (let h = 520; h <= 960; h += 20) sizes.push([w, h]);
  }
  // 计划里点名的四个实测点，外加步长会跨过去的边：正方与差一像素
  sizes.push([540, 543], [559, 562], [560, 900], [600, 610], [559, 560], [560, 559],
             [620, 625], [625, 620]);
  // 再往上到桌面尺寸：只要求 ≥260、不越界（≥821 宽的竖窗抽屉仍让出高度，
  // 那是桌面，开合面板棋盘本来就会变）
  const wide = [[700, 700], [700, 1000], [820, 830], [820, 640], [821, 900], [900, 1200],
                [1000, 1000], [1024, 700], [1180, 820], [1400, 900]];

  // The panel slides (transform over --dur-slow): two frames after a toggle
  // it is still half-way in and reads as overflow. This asks where things
  // come to rest, and the app's own reduced-motion rule makes the transform
  // jump (inline styles are off the table: the page's CSP forbids them).
  const ctx = await browser.newContext({ viewport: { width: 520, height: 520 }, locale: "zh-CN",
                                         reducedMotion: "reduce" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
  });
  await ctx.addInitScript(PAGE_HOOK);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});

  // Two frames, or 400ms if the compositor skips one after a resize: a bare
  // rAF chain inside page.evaluate has no timeout, and one headless run
  // (release rehearsal 36721702122) sat on it until the 60-minute cancel.
  // v8-3-plan V4: a fallback also brings back what the page was doing
  // (lib/frame-watch.mjs). FRAME_FALLBACK_MS only shortens the wait, to see
  // that record locally, where the frames do come.
  const fallbackMs = Number(process.env.FRAME_FALLBACK_MS) || 400;
  let frameMisses = 0;
  const probe = (tag) => page.evaluate((ms) => new Promise((done) => {
    let fired = false, rafs = 0;
    const t = setTimeout(() => { if (!fired) { fired = true; measure(true); } }, ms);
    requestAnimationFrame(() => { rafs++; requestAnimationFrame(() => {
      rafs++;
      if (fired) return;
      fired = true; clearTimeout(t); measure(false);
    }); });
    function measure(miss) {
      const fw = window.__frameWatch || {};
      const at = Math.round(performance.now());
      const res = (r) => done({ ...r, miss, diag: miss ? {
        rafs, vis: document.visibilityState, focus: document.hasFocus(),
        inner: [innerWidth, innerHeight], dpr: devicePixelRatio,
        frames: fw.frames, sinceFrame: fw.lastAt >= 0 ? at - fw.lastAt : null,
        seen: (fw.resizes || []).map(([w, h, s]) => [w, h, at - s]),
        visLog: (fw.vis || []).map(([v, s]) => [v, at - s]) } : undefined });
      const de = document.documentElement;
      const app = document.getElementById("app");
      const side = document.getElementById("side");
      const b = document.getElementById("board").getBoundingClientRect();
      const open = app.classList.contains("panel-open");
      const over = [...document.querySelectorAll("body *")].filter((el) => {
        if (!el.offsetParent) return false;
        if (!open && (el === side || side.contains(el))) return false;
        const r = el.getBoundingClientRect();
        return r.width > 0 && (r.right > de.clientWidth + 1 || r.left < -1);
      }).map((el) => el.id || el.className);
      const s = side.getBoundingClientRect();
      // 底部抽屉（它的上沿在棋盘上沿之下）让出的是高度：棋盘不该被它压住
      const sheet = open && s.top > b.top;
      res({ open, board: Math.round(b.width), over,
            inView: b.bottom <= de.clientHeight + 1 && b.right <= de.clientWidth + 1,
            underSheet: sheet && b.bottom > s.top + 1 });
    }
  }), fallbackMs).then((r) => {
    if (r.miss) { frameMisses++; frames.miss("5b " + tag, r.diag); }
    return r;
  });
  const setOpen = (want) => page.evaluate((w) => {
    if (document.getElementById("app").classList.contains("panel-open") !== w)
      document.getElementById("toggle-panel").click();
  }, want);

  const bad = { small: [], moved: [], over: [], out: [] };
  for (const [w, h] of [...sizes, ...wide]) {
    const tag = `${w}×${h}`;
    await frames.resize(page, { width: w, height: h });
    await setOpen(true);
    const a = await probe(tag + " open");
    await setOpen(false);
    const c = await probe(tag + " closed");
    if (a.board < MIN_BOARD || c.board < MIN_BOARD) bad.small.push(`${tag} ${a.board}/${c.board}`);
    if (w <= 820 && a.board !== c.board) bad.moved.push(`${tag} ${a.board}/${c.board}`);
    if (a.over.length || c.over.length) bad.over.push(`${tag} ${[...a.over, ...c.over].slice(0, 2).join(",")}`);
    // A near-square window has no height to spare under a full-width board,
    // so its sheet lies over the board's bottom while it is up (styles.css,
    // the portrait sheet). Once the spare height reaches the sheet's minimum
    // (240px, plus 32 of chrome) it must not: the sheet lives under the board.
    const roomy = w > 820 || h - w >= 272;
    if (!a.inView || !c.inView || (roomy && a.underSheet)) bad.out.push(tag);
  }
  const n = sizes.length + wide.length;
  assert(bad.small.length === 0,
    `${n} 个视口、面板开关两种状态，棋盘都 ≥ ${MIN_BOARD}px` +
    (bad.small.length ? ` —— 开/关：${bad.small.slice(0, 12).join("；")}（共 ${bad.small.length} 个）` : ""));
  assert(bad.moved.length === 0,
    `宽 ≤820 的 ${sizes.length + wide.filter(([w]) => w <= 820).length} 个视口里，开合面板棋盘一样大` +
    (bad.moved.length ? ` —— 开/关：${bad.moved.slice(0, 12).join("；")}（共 ${bad.moved.length} 个）` : ""));
  assert(bad.over.length === 0, "没有元素越出视口" +
    (bad.over.length ? " —— " + bad.over.slice(0, 6).join("；") : ""));
  assert(bad.out.length === 0, "棋盘整块在视口里；有富余高度时也不压在底部抽屉下面" +
    (bad.out.length ? " —— " + bad.out.slice(0, 12).join("；") : ""));
  assert(errs.length === 0, "改窗口尺寸、开合面板，没有 JS 异常" + (errs.length ? " —— " + errs[0] : ""));
  if (frameMisses) console.log(`5b: ${frameMisses} 次量取没等到两帧，按 400ms 兜底量的`);
  await ctx.close();
}

// --- 5c. 顶栏的东西不互相压着（7.4 §3.5）----------------------------------
//
// 390×844 截图里「行」徽章压在「黑」字上：顶栏中段是 `flex: 1; min-width: 0`，
// 放不下的时候里面的字不是让出去，而是缩进邻居里。520 宽（桌面壳最窄）同样的
// 行，换一种语言、一种状态就会碰上。这里取顶栏里每一个看得见的叶子元素，两两
// 求交 —— 包括占位但隐形的「悔棋」槽：它下一手就会出现在那里。
// 7.9 §1a：悔棋、提示搬到了对手那一行，所以上方那一条对阵条也一起量。
if (scenario()) {
  const WIDTHS = [[520, 900], [540, 545], [560, 900], [620, 700], [390, 844]];
  const hits = [];
  for (const lang of LANGS) {
    for (const mode of ["ai", "pvp", "puzzle", "learn"]) {
      const { ctx, page } = await open(lang, mode, "play", "wood", { width: 520, height: 900 }, "0");
      for (const [w, h] of WIDTHS) {
        await page.setViewportSize({ width: w, height: h });
        const r = await page.evaluate(() => new Promise((res) => requestAnimationFrame(() => {
          const leaves = [...document.querySelectorAll(".chrome *, .pstrip.at-top *")]
            .filter((e) => e.offsetParent && !e.children.length && e.getBoundingClientRect().width > 0)
            .map((e) => ({ t: (e.textContent || e.id).trim().slice(0, 8), r: e.getBoundingClientRect() }));
          const out = [];
          for (let i = 0; i < leaves.length; i++) {
            for (let j = i + 1; j < leaves.length; j++) {
              const a = leaves[i].r, b = leaves[j].r;
              if (a.left < b.right - 0.5 && b.left < a.right - 0.5 &&
                  a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) out.push(leaves[i].t + "/" + leaves[j].t);
            }
          }
          res(out);
        })));
        if (r.length) hits.push(`${lang} ${mode} ${w}×${h}: ${r.join(",")}`);
      }
      await ctx.close();
    }
  }
  assert(hits.length === 0, "顶栏里没有两个元素叠在一起（三语 × 四种模式 × 五档宽度）" +
    (hits.length ? " —— " + hits.slice(0, 8).join("；") + `（共 ${hits.length} 处）` : ""));
}

// --- 5d. 教学的任务在棋盘上方看得见，和面板开合无关（7.6 §3f）------------------
// 7.5 走查：540×900 选「新手」进来，面板是收起的 —— 而「点击 e4」这句只写在
// 面板里的任务卡上，棋盘上什么也没说。
if (scenario()) {
  const measure = (page) => page.evaluate(() => {
    const strip = document.getElementById("task-strip");
    const task = document.getElementById("lesson-task");
    const chrome = document.querySelector(".chrome").getBoundingClientRect();
    const wrap = document.getElementById("board-wrap").getBoundingClientRect();
    const s = strip ? strip.getBoundingClientRect() : null;
    return {
      shown: !!s && getComputedStyle(strip).display !== "none" && s.height > 0,
      text: strip ? strip.textContent.trim() : "",
      task: task ? task.textContent.trim() : "",
      top: s ? s.top : 0, bottom: s ? s.bottom : 0,
      chromeBottom: chrome.bottom, boardTop: wrap.top, board: Math.round(wrap.width),
      clipped: strip && strip.firstElementChild ? strip.firstElementChild.scrollHeight > strip.firstElementChild.clientHeight + 1 : false,
    };
  });
  for (const lang of LANGS) {
    for (const vp of [{ width: 540, height: 900 }, { width: 620, height: 520 }, { width: 1400, height: 900 }]) {
      const tag = lang + " " + vp.width + "×" + vp.height;
      const { ctx, page, errs } = await open(lang, "learn", "play", "wood", vp, "0");
      // (the first lesson may open on its watch-first demo; the card and the
      // strip then both say so, which is the same claim)
      const shut = await measure(page);
      assert(shut.shown, tag + " 面板收起：棋盘上方有任务条");
      assert(shut.text && shut.text === shut.task, tag + " 任务条说的就是任务卡上那句（「" + shut.text + "」）");
      assert(shut.top >= shut.chromeBottom - 0.5 && shut.bottom <= shut.boardTop + 0.5,
        tag + " 任务条在顶栏之下、棋盘之上，不压着第 8 横排（" +
        [shut.chromeBottom, shut.top, shut.bottom, shut.boardTop].map(Math.round).join(" / ") + "）");
      assert(!shut.clipped, tag + " 两行之内说得完");
      await page.click("#toggle-panel");
      await page.waitForTimeout(400);
      const up = await measure(page);
      if (vp.width <= 820) {
        // the panel is over or under the board here, not beside it: the strip
        // stays, and so does the board's size
        assert(up.shown, tag + " 面板打开：任务条仍在");
        assert(up.board === shut.board, tag + " 开合面板，棋盘不变大小（" + shut.board + " → " + up.board + "）");
      } else {
        assert(!up.shown, tag + " 宽窗面板打开：任务就在旁边的面板里，棋盘上方不再重复");
      }
      assert(errs.length === 0, tag + " 没有 JS 异常", errs.join(" / "));
      await ctx.close();
    }
  }
  // …and the board of a portrait window keeps every pixel it had: the strip's
  // height comes out of the sheet's reserve (540×900: 528px either way)
  {
    const a = await open("zh-CN", "learn", "play", "wood", { width: 540, height: 900 }, "0");
    const b = await open("zh-CN", "pvp", "play", "wood", { width: 540, height: 900 }, "0");
    const la = await measure(a.page), lb = await measure(b.page);
    assert(la.board === lb.board, "540×900：教学里的棋盘和双人模式一样大（" + la.board + " / " + lb.board + "）");
    await a.ctx.close(); await b.ctx.close();
  }
}

// --- 7.6：「重下」三语都是一行；换语言后着法菜单的名字跟着换 ----------------
// 日文原来是「ここから指し直す」，英文是「Replay from here」，在按钮里都挤成两行。着法旁边那颗「…」的
// title / aria-label 在切到英文后还是「着法操作」：着法列表是按签名复用
// 节点的，签名里没有语言，于是它一直留着切换前的那个名字。
if (scenario()) {
  const mv = async (page, sq) => {
    const pt = await page.evaluate((s) => {
      const r = document.getElementById("board").getBoundingClientRect();
      return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
               y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
    }, sq);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(180);
  };
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "pvp", "play");
    await mv(page, "e2"); await mv(page, "e4");
    await page.click("#rep-start");
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const b = document.getElementById("retry-here");
      const range = document.createRange();
      range.selectNodeContents(b);
      const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
      return { shown: !!b.offsetParent, text: b.textContent.trim(), lines };
    });
    assert(r.shown && r.lines === 1, `${lang}:「${r.text}」按钮里是一行（${r.lines} 行）`);
    await ctx.close();
  }
  const { ctx, page } = await open("zh-CN", "pvp", "play");
  await mv(page, "e2"); await mv(page, "e4");
  await page.waitForTimeout(300);
  const zh = await page.evaluate(() => (document.querySelector("#move-list .mlmenu") || {}).title);
  // 9.0 S5: the language is the settings page's (通用), not the 设置 tab's
  await page.click('.rail-btn[data-view="settings"]'); await page.waitForTimeout(300);
  await showCat(page, "general");
  await page.click('#lang-seg button[data-lang="en"]');
  await page.waitForTimeout(400);
  await page.click('.rail-btn[data-view="play"]'); await page.waitForTimeout(300);
  const en = await page.evaluate(() => {
    const m = document.querySelector("#move-list .mlmenu");
    return m ? { title: m.title, aria: m.getAttribute("aria-label") } : null;
  });
  assert(zh === "着法操作" && en && en.title === "Move actions" && en.aria === "Move actions",
    "切到英文后，着法菜单按钮的 title 与 aria-label 都是英文（" + zh + " → " + JSON.stringify(en) + "）");
  await ctx.close();
}

/** click one square, the way a person does (7.7's sections below) */
const mv = async (page, sq) => {
  const pt = await page.evaluate((s) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
             y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
  }, sq);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForTimeout(180);
};

// --- 7.7 (v7-7-plan §1g, §1h, §2): the board is the anchor -----------------
// Through 7.6 the panel's width followed its page (284 / 380 / 568), so the
// board slid sideways when a tab was switched: at 1440×900 its frame's left
// edge was 150 on 对局, 8 on 记录 and 102 in 教学 / 做题. Now the panel is a
// function of the window alone, and the board's rect is the same to the pixel
// on every tab and in every mode. The strips cost the board some height; the
// floor is 88% of 7.6's side (canvas 822 at 1440×900, 722 at 1280×800, 622 at
// 1024×700 — measured on main 75a3560).
if (scenario()) {
  const OLD = { "1440x900": 822, "1280x800": 722, "1024x700": 622 };
  for (const [w, h] of [[1440, 900], [1280, 800], [1024, 700]]) {
    const rects = new Map();
    let tabsTop = null;
    // v8-0-plan A1: …and every page of the top level — the board is laid
    // out under 首页 / 棋谱库 / 我的, so coming back to it moves nothing
    // 9.0 S5: the 设置 tab is the settings page, a page over the board like
    // the other three; and with the tab row gone the panel's one pane is what
    // sits at its top (was: the tab row, ≤ 12px from the window's top)
    for (const [mode, tab] of [["ai", "play"], ["ai", "settings"], ["ai", "record"], ["pvp", "play"], ["learn", "play"], ["puzzle", "play"], ["puzzle", "record"], ["ai", "home"], ["pvp", "library"]]) {
      const { ctx, page } = await open("zh-CN", mode, tab, "wood", { width: w, height: h });
      const r = await page.evaluate(() => {
        const b = document.getElementById("board").getBoundingClientRect();
        const t = document.getElementById("pane-play").getBoundingClientRect();
        return { board: [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10), tabTop: t.top };
      });
      rects.set(mode + "/" + tab, JSON.stringify(r.board));
      if (tabsTop === null) tabsTop = r.tabTop;
      await ctx.close();
    }
    const distinct = [...new Set(rects.values())];
    assert(distinct.length === 1, w + "x" + h + ": #board 在四种模式、四张整页(含设置页)下逐像素相同(" +
      [...rects].map(([k, v]) => k + " " + v).join(" · ") + ")");
    const side = JSON.parse(distinct[0])[2];
    const old = OLD[w + "x" + h];
    assert(side >= 0.88 * old, w + "x" + h + ": 棋盘边长 " + side + " ≥ 7.6 的 88%(" + old + " → " + Math.round(side / old * 1000) / 10 + "%)");
    assert(tabsTop <= 12, w + "x" + h + ": 侧栏(唯一一页)贴顶(上缘 " + tabsTop + "px)");
  }
}

// --- 7.7 (v7-7-plan §10): portrait, the strips stay with the board ---------
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play", "wood", { width: 600, height: 900 });
  const r = await page.evaluate(() => {
    const box = (id) => document.getElementById(id).getBoundingClientRect();
    return { top: box("strip-b").top, bottom: box("strip-w").bottom, side: box("side").top,
             open: document.getElementById("app").classList.contains("panel-open") };
  });
  assert(r.open, "600x900: the drawer is up");
  assert(r.top >= 0 && r.bottom <= r.side + 1,
    "600x900: 两条对阵条和棋盘一起在抽屉上方(条底 " + Math.round(r.bottom) + " ≤ 抽屉顶 " + Math.round(r.side) + ")");
  await ctx.close();
}

// --- 7.7 (v7-7-plan §3): mid-game the notation is what the panel is for ---
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "ai", "play", "wood", { width: 1440, height: 900 });
  await page.evaluate(() => { window.__chess.engine.bestMove = async () => null; });
  for (const sq of ["e2", "e4"]) await mv(page, sq);
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => {
    const list = document.getElementById("move-list");
    const last = list.lastElementChild.getBoundingClientRect();
    const vis = (e) => !!e.offsetParent;
    return { nav: document.getElementById("replay-seg").getBoundingClientRect().top - last.bottom,
             rows: list.children.length,
             review: vis(document.getElementById("review-actions")),
             reviewKey: vis(document.getElementById("review-open")),
             // 9.0 S1: the plan left the panel for 今天 — nothing of it is in the panel
             daily: [...document.querySelectorAll("#side #today-go, #side .daily-plan, #side [id^='daily-']")].filter(vis).map((e) => e.id),
             primaries: [...document.querySelectorAll("#side .primary, .chrome .primary")].filter(vis).map((b) => b.id),
             // 9.0 S2: the row is five fixed places; 存档槽 / 编辑局面 are under 更多
             toolRow: [...document.querySelectorAll("#tool-row button")].map((b) => b.id),
             tertiary: ["review-open", "explorer-open", "pgn-copy", "pgn-download", "more-tools"].map((id) => {
               const b = document.getElementById(id);
               return !!b && b.classList.contains("tool-ic") && !!b.title && !!b.getAttribute("aria-label");
             }),
             folded: ["slots-open", "editor-open", "report-export"].map((id) => {
               const b = document.getElementById(id);
               return !!b && !!b.closest("#more-row") && !vis(b);
             }) };
  });
  // v8-0-plan A2 supersedes "the list takes ≥ 45% of the column": taking the
  // height left the bar 380px under five rows. The list is its rows now and
  // the bar follows the last one (a long game: see the A2 section)
  assert(r.rows === 1 && r.nav >= 0 && r.nav <= 16, "对局中,翻谱栏紧跟最后一行棋谱(" + r.nav + "px ≤ 16)");
  assert(!r.review && r.reviewKey, "…复盘的按钮收在「复盘」键后面,不是对局中的常驻家具");
  assert(r.daily.length === 0, "…「今天的训练」不在对局的面板里(" + r.daily.join(", ") + ")");
  assert(r.primaries.length === 0, "…对局中没有主按钮(" + r.primaries.join(", ") + ")");
  assert(JSON.stringify(r.toolRow) === JSON.stringify(["review-open", "explorer-open", "pgn-copy", "pgn-download", "more-tools"]),
    "工具行固定五个位置(" + r.toolRow.join(", ") + ")");
  assert(r.tertiary.every(Boolean), "复盘 / 开局 / 复制 / 导出 / 更多 是第三级:图标 + tooltip + 可读名");
  assert(r.folded.every(Boolean), "…存档槽 / 编辑局面 / 导出复盘图 收在「更多」里,对局中不露面");
  // 9.0 S1: and on 今天 the next thing is this game — the plan gives way to it
  await page.click('.rail-btn[data-view="home"]');
  await page.waitForTimeout(400);
  const hero = await page.evaluate(() => ({ go: document.getElementById("today-go").textContent.trim(),
    plan: !!document.getElementById("daily-plan").offsetParent }));
  assert(hero.go === "接着下" && !hero.plan, "…对局进行中,「今天」的主卡是这一盘(「" + hero.go + "」),计划让位");
  await page.click('.rail-btn[data-view="play"]');
  await page.waitForTimeout(400);
  await page.click("#review-open");
  await page.waitForTimeout(200);
  assert(await page.evaluate(() => !!document.getElementById("review-actions").offsetParent), "…按「复盘」键,它们就出来");
  await ctx.close();
}

// --- 7.7 (v7-7-plan §4): every ending gets the result card ------------------
// Mate, flag, resignation and a draw — the card is there, says the right
// thing and carries at most one filled button. 9.0 M1: v8-0-plan A5 floated
// it over the middle of the board; it is a bar in the bottom strip's place
// now (a card in the wide layout's column), so the rule is that it covers
// none of the 64 squares and lies wholly in the window.
if (scenario()) {
  const cardState = (page) => page.evaluate(async () => {
    const c = document.getElementById("go-card");
    // measured where it comes to rest: the reveal (result-in) moves it 4%
    await Promise.all((c.getAnimations ? c.getAnimations() : []).map((a) => a.finished.catch(() => {})));
    const b = document.getElementById("board").getBoundingClientRect();
    const r = c.getBoundingClientRect();
    const clear = r.left >= b.right - 0.5 || r.right <= b.left + 0.5 || r.top >= b.bottom - 0.5 || r.bottom <= b.top + 0.5;
    const hit = clear && r.left >= -0.5 && r.top >= -0.5 && r.right <= innerWidth + 0.5 && r.bottom <= innerHeight + 0.5;
    const vis = (e) => !!e.offsetParent;
    return { shown: vis(c), hit, result: document.getElementById("go-result").textContent.trim(),
             reason: document.getElementById("go-reason").textContent.trim(),
             primaries: [...document.querySelectorAll("#side .primary, #go-card .primary")].filter(vis).map((e) => e.id),
             rect: [r.left, r.top, r.right, r.bottom, b.left, b.top, b.right, b.bottom].map(Math.round).join(","),
             toast: document.getElementById("toast").classList.contains("show") ? document.getElementById("toast").textContent : "" };
  });
  const cases = [
    ["将杀", async (page) => { for (const sq of ["f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4"]) await mv(page, sq); }, /黑方胜/, /将杀/],
    ["认输", async (page) => {
      for (const sq of ["e2", "e4"]) await mv(page, sq);
      await page.click("#btn-resign");
      await page.waitForTimeout(300);
      const btn = await page.evaluate(() => {
        const ok = document.getElementById("confirm-ok");
        const probe = document.createElement("div");
        probe.style.color = "var(--danger)";
        document.body.appendChild(probe);
        const danger = getComputedStyle(probe).color;
        probe.remove();
        return { fg: getComputedStyle(ok).color, danger, cls: ok.className };
      });
      // 9.0 V1: danger is the fourth button kind — the danger colour and its
      // hairline, not a red slab (and never the accent)
      assert(btn.fg === btn.danger && /danger/.test(btn.cls),
        "认输确认框的确认按钮是危险按钮，字取自 --danger(" + btn.fg + " vs " + btn.danger + ")");
      await page.click("#confirm-ok");
    }, /白方胜|黑方胜/, /认输/],
    ["和棋", async (page) => {
      for (const sq of ["e2", "e4"]) await mv(page, sq);
      await page.click("#btn-offerdraw");
      await page.waitForTimeout(300);
      await page.click("#confirm-ok");
    }, /和棋/, /协议和棋/],
  ];
  for (const [what, play, resultRe, reasonRe] of cases) {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 });
    await play(page);
    await page.waitForTimeout(700);
    const s = await cardState(page);
    assert(s.shown, what + ":终局卡出现");
    assert(resultRe.test(s.result) && reasonRe.test(s.reason), what + ":写着结果和原因(" + s.result + " · " + s.reason + ")");
    assert(s.hit, what + ":结果条不压 64 格,整条在窗口里(9.0 M1)(条 / 盘 " + s.rect + ")");
    assert(s.primaries.length === 1 && s.primaries[0] === "go-analyse", what + ":唯一的主按钮是「复盘这局」(" + s.primaries.join(", ") + ")");
    assert(!s.toast, what + ":结局不再由 toast 宣布(" + s.toast + ")");
    await ctx.close();
  }
  // Flag fall: Date.now runs forty times fast (the clock suite's device), so a
  // three-minute clock falls in a few seconds of real time.
  {
    const ctx = await browser.newContext({ viewport: { width: 1024, height: 700 }, locale: "zh-CN" });
    await ctx.addInitScript(() => {
      const t0 = Date.now(), real = Date.now;
      Date.now = () => t0 + (real() - t0) * 40;
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", timeControl: "3" }));
      localStorage.setItem("chess.panelOpen", "1");
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
    for (const sq of ["e2", "e4"]) await mv(page, sq);
    // under ten seconds the running clock shows tenths
    let tenths = false;
    for (let i = 0; i < 80 && !tenths; i++) {
      await page.waitForTimeout(50);
      tenths = await page.evaluate(() => /^0:0\d\.\d$/.test(document.getElementById("clock-b").textContent.trim()));
    }
    assert(tenths, "超时前最后十秒,钟显示到 0.1 秒");
    await page.waitForTimeout(1500);
    const s = await cardState(page);
    assert(s.shown && /白方胜/.test(s.result) && /超时/.test(s.reason), "超时:终局卡出现(" + s.result + " · " + s.reason + ")");
    assert(s.hit, "超时:结果条不压 64 格,整条在窗口里(1024x700)");
    await ctx.close();
  }
  // ✕ puts it away, and 分析 in the review row takes the fill back
  {
    const { ctx, page } = await open("en", "pvp", "play", "day", { width: 1440, height: 900 });
    for (const sq of ["f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4"]) await mv(page, sq);
    await page.waitForTimeout(500);
    await page.click("#go-close");
    await page.waitForTimeout(200);
    const s = await cardState(page);
    assert(!s.shown && s.primaries.length === 1 && s.primaries[0] === "an-run",
      "✕ puts the card away, and 分析 in the review row is the one filled button again (" + s.primaries.join(", ") + ")");
    // Codex on #82: the ✕ was remembered by (plies, FEN, result), so the same
    // mate in the next game came up already dismissed
    await page.click("#btn-new");
    await page.waitForTimeout(300);
    await page.click("#ng-start");   // v7-8-plan §4: a finished game — no warning, just 开始
    await page.waitForTimeout(400);
    for (const sq of ["f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4"]) await mv(page, sq);
    await page.waitForTimeout(500);
    assert((await cardState(page)).shown, "the same mate in the next game gets its card again, the ✕ was for the last one");
    await ctx.close();
  }
  // Codex on #82: a game opened already mated — a [FEN] header and no moves —
  // has an ending but nothing to analyse, and 复盘这局 on its card led straight
  // to "no game to analyse". (The FEN dialog refuses such a position; a PGN
  // does not.) The engine is marked ready so only the missing history decides.
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 });
    await page.evaluate(() => {
      window.__chess.engine.isReady = () => true;
      const pgn = '[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "0-1"]\n[SetUp "1"]\n' +
        '[FEN "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3"]\n\n0-1\n';
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { readText: () => Promise.resolve(pgn), writeText: () => Promise.resolve() } });
    });
    if (!(await page.isVisible("#pgn-paste"))) { await page.click("#more-tools"); await page.waitForTimeout(250); }
    await page.click("#pgn-paste");
    await page.waitForTimeout(800);
    const s = await cardState(page);
    const analyse = await page.evaluate(() => !!document.getElementById("go-analyse").offsetParent);
    assert(s.shown && !analyse, "打开一局已将死、没有着法的棋谱：终局卡在，但不给「复盘这局」(" + JSON.stringify({ shown: s.shown, analyse }) + ")");
    await ctx.close();
  }
  // Codex on #82 (second round): importing the same finished game again goes
  // straight from one ending to the other, never through a game in progress,
  // so the ✕ on the first still hid the second
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 });
    await page.evaluate(() => {
      const pgn = '[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n';
      Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { readText: () => Promise.resolve(pgn), writeText: () => Promise.resolve() } });
    });
    const paste = async () => {
      if (!(await page.isVisible("#pgn-paste"))) { await page.click("#more-tools"); await page.waitForTimeout(250); }
      await page.click("#pgn-paste");
      await page.waitForTimeout(800);
      if (await page.isVisible("#confirm-modal.show").catch(() => false)) { await page.click("#confirm-ok"); await page.waitForTimeout(600); }
    };
    await paste();
    const first = (await cardState(page)).shown;
    await page.click("#go-close");
    await page.waitForTimeout(200);
    await paste();
    assert(first && (await cardState(page)).shown, "同一局已完的棋谱再导入一次：终局卡重新出现，上一次的 ✕ 不算数");
    await ctx.close();
  }
  // Codex on #82: with the panel shut the card was off-screen, and nothing
  // else on screen said how the game ended — 7.7 answered with a toast.
  // v8-0-plan A5: the card is on the board, so with the panel shut it is
  // still on screen, and says it once — no toast on top of it
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 }, "0");
    for (const sq of ["f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4"]) await mv(page, sq);
    await page.waitForTimeout(500);
    const s = await cardState(page);
    assert(s.shown && s.hit && /黑方胜/.test(s.result) && /将杀/.test(s.reason) && !s.toast,
      "面板收起时终局：结果条就在棋盘下沿,说一次结果和原因(" + s.result + " · " + s.reason + (s.toast ? " · toast " + s.toast : "") + ")");
    await ctx.close();
  }
}

// --- 7.7 (v7-7-plan §3, §4): at most one filled button, in every context ---
if (scenario()) for (const [when, mode, act] of [
  ["教学·第 1 课", "learn", async () => {}],
  ["做题·第 1 题", "puzzle", async () => {}],
  // 9.0 S3: 训练's other two segments are the same lesson panel with other content
  ["训练·残局", "learn", async (page) => { await page.click('#train-seg button[data-seg="endgame"]'); await page.waitForTimeout(600); }],
  ["训练·名局", "learn", async (page) => { await page.click('#train-seg button[data-seg="classic"]'); await page.waitForTimeout(600); }],
  ["人机·开局前", "ai", async () => {}],
  ["我的", "ai", async (page) => { await page.click('#rail button[data-view="me"]'); }],
  ["首页", "ai", async (page) => { await page.click('#rail button[data-view="home"]'); }],
  ["棋谱库", "ai", async (page) => { await page.click('#rail button[data-view="library"]'); }],
  // 9.0 S5: the 设置 tab is the settings page — every category of it
  ...CATS.map((c) => ["设置页·" + c, "pvp", async (page) => {
    await page.click('#rail button[data-view="settings"]'); await page.waitForTimeout(300);
    await showCat(page, c);
  }]),
]) {
  const { ctx, page } = await open("zh-CN", mode, "play");
  await act(page);
  await page.waitForTimeout(400);
  const p = await page.evaluate(() => [...document.querySelectorAll(".primary")].filter((e) => !!e.offsetParent && !e.closest(".modal-bg")).map((e) => e.id));
  assert(p.length <= 1, when + ":可见的主按钮 ≤ 1(" + p.join(", ") + ")");
  if (when === "教学·第 1 课") {
    const dots = await page.evaluate(() => document.querySelectorAll("#lesson-dots .lesson-dot").length);
    assert(dots >= 1, "教学:课程进度是一排圆点(" + dots + " 个)");
  }
  await ctx.close();
}

// --- 7.7 (v7-7-plan §4): the puzzle answers on its own card ----------------
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "puzzle", "play");
  // the first 一步杀 is the back rank: Ra1, Kg1 against Kg8 behind f7 g7 h7
  const fb = () => page.evaluate(() => { const e = document.getElementById("puzzle-feedback");
    return { shown: !!e.offsetParent, ok: e.classList.contains("ok"), bad: e.classList.contains("bad"),
             head: document.getElementById("puzzle-fb-head").textContent.trim(),
             hint: !!document.getElementById("puzzle-fb-hint").offsetParent }; });
  assert(!(await fb()).shown, "做题:还没走,没有反馈卡");
  // a1 rook to a2 is legal in the first mate-in-one and does not mate
  await mv(page, "a1"); await mv(page, "a2");
  await page.waitForTimeout(400);
  const wrong = await fb();
  assert(wrong.shown && wrong.bad && /再想想/.test(wrong.head) && wrong.hint,
    "走错:叉、「再想想」和提示入口(" + JSON.stringify(wrong) + ")");
  await mv(page, "a1"); await mv(page, "a8");
  await page.waitForTimeout(600);
  const right = await fb();
  assert(right.shown && right.ok, "走对:对勾(" + JSON.stringify(right) + ")");
  await ctx.close();
}

// --- 7.9 §4b:「今天的训练」只在人机和双人、没有对局时出现 -------------------
// 7.8.0 在教学里,第一课正在上,面板最上面仍是「今天的训练:学一节新课」,把课文
// 往下推了约 140px;做题页同理。量法:卡片藏着时课文标题的纵坐标,对比把卡片
// 临时放回来时的纵坐标 —— 后者就是 7.8.0 的位置。
// 9.0 S1: the card left the panel altogether — the plan is 今天's hero. The
// claim is re-asked of where things are now: while training, the panel opens
// on the lesson or the puzzle (right under 训练's switch, nothing between);
// and with no game on, the plan is still one click away, on 今天, in words.
if (scenario()) {
  for (const mode of ["learn", "puzzle"]) {
    const { ctx, page } = await open("zh-CN", mode, "play");
    const r = await page.evaluate((m) => {
      const seg = document.getElementById("train-seg");
      const head = document.querySelector(m === "learn" ? "#lesson-title" : "#puzzle-task");
      const daily = [...document.querySelectorAll("#side #today-go, #side .daily-plan, #side [id^='daily-']")]
        .filter((e) => e.offsetParent).map((e) => e.id);
      const top = seg.getBoundingClientRect().bottom, end = head.getBoundingClientRect().top;
      const sec = head.closest("section");
      // what stands between the switch and the content: only the section's
      // own heading row (its progress count) may — no card, no banner
      const between = [...document.querySelectorAll("#pane-play *")].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.height > 0 && e.checkVisibility() && r.top >= top - 1 && r.top < end - 1 && e !== sec && !e.closest(".side-h-row");
      }).map((e) => e.id || e.className || e.tagName);
      return { daily, between, seg: !!seg.offsetParent, gap: end - top };
    }, mode);
    assert(r.daily.length === 0, "§4b " + mode + ":「今天的训练」不在面板里(" + r.daily.join(", ") + ")");
    assert(r.seg && r.gap >= 0 && r.between.length === 0, "§4b " + mode + ":" + (mode === "learn" ? "课文标题" : "题目卡") +
      "紧跟在训练的切换下面,中间只有本节的标题行(相隔 " + Math.round(r.gap) + "px" + (r.between.length ? ";中间还有 " + r.between.join(", ") : "") + ")");
    await ctx.close();
  }
  for (const mode of ["ai", "pvp"]) {
    const { ctx, page } = await open("zh-CN", mode, "play");
    await page.click('#rail button[data-view="home"]');
    await page.waitForTimeout(500);
    const h = await page.evaluate(() => {
      const go = document.getElementById("today-go");
      return { shown: !!go.offsetParent, go: go.textContent.trim(),
               title: document.getElementById("today-hero-title").textContent.trim() };
    });
    assert(h.shown && h.title && h.go !== "接着下",
      "§4b " + mode + ":没有对局时「今天」的主卡是今天的训练(「" + h.title + "」·「" + h.go + "」)");
    await ctx.close();
  }
}

// --- 7.9 §4d:做题页的纵向节奏只有两种间距 ----------------------------------
// 同一组内 8px,组与组之间 20px。7.8.0 是 8 / 0 / 8 / 12 / 12,「为你出一题」
// 离「题型」只有 9px。量的是 #sec-puzzle 里每个看得见的块,上一块下缘到下一块
// 上缘;没走、走错(反馈卡加提示)、走对(反馈卡加后续)三种状态都量。
if (scenario()) {
  const gaps = (page) => page.evaluate(() => {
    const kids = [...document.getElementById("sec-puzzle").children]
      .filter((e) => e.getClientRects().length && e.getBoundingClientRect().height > 0);
    const out = [];
    for (let i = 1; i < kids.length; i++) {
      const g = kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom;
      out.push({ g: Math.round(g * 10) / 10, at: kids[i].id || kids[i].className });
    }
    return out;
  });
  const ok = (gs) => gs.every((x) => Math.abs(x.g - 8) <= 0.5 || Math.abs(x.g - 20) <= 0.5);
  const show = (gs) => gs.map((x) => x.g + "→" + x.at).join(", ");
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "puzzle", "play");
    const g0 = await gaps(page);
    assert(g0.length >= 4 && ok(g0), "§4d " + lang + " 做题页各段间距只有 8 / 20:" + show(g0));
    if (lang === "zh-CN") {
      await mv(page, "a1"); await mv(page, "a2");
      await page.waitForTimeout(400);
      const g1 = await gaps(page);
      assert(ok(g1), "§4d 走错之后(反馈卡)仍只有 8 / 20:" + show(g1));
      await mv(page, "a1"); await mv(page, "a8");
      await page.waitForTimeout(600);
      const g2 = await gaps(page);
      assert(ok(g2), "§4d 走对之后仍只有 8 / 20:" + show(g2));
    }
    await ctx.close();
  }
}


// --- 7.7 §1：看得见的瑕疵，写成几何断言 ------------------------------------
// 每一条都是 7.6.0 截图里看得见的东西（v7-7-plan §1a–§1e）。量的是摆好之后
// 的盒子和画布上的像素，不是样式表里写了什么。
if (scenario()) {
  const sqAt = async (page, sq) => page.evaluate((s) => {
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const tap = async (page, sq) => { const p = await sqAt(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); };

  // §1a：每个看得见的 .act-btn 都有左右内边距，高度正好是 --row-h（两行字也
  // 装得下，行距是紧的）。例外只有一种：同一行里有标签要折成三行（英文的
  // Clear lesson progress、日文的几条长标签在 70px 栅格里），栅格的等高行
  // 把整行一起撑高 —— 那时只要求不矮于 --row-h。标签太长是文案的事。
  for (const lang of LANGS) {
    for (const theme of ["wood", "night", "day", "notebook"]) {
      // 9.0 S5: the 设置 tab is the settings page, read a category at a time
      // 9.0 S1: and 今天 (下一盘, the hero's primary)
      for (const tab of ["play", "settings", "record", "home"]) {
        const { ctx, page } = await open(lang, "pvp", tab, theme);
        await page.evaluate(() => { document.querySelectorAll("details").forEach((d) => { d.open = true; }); });
        const measure = () => page.evaluate(() => {
          const rowH = parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--row-h"));
          const out = [];
          const linesOf = (b) => {
            const range = document.createRange();
            range.selectNodeContents(b);
            return new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
          };
          for (const b of document.querySelectorAll(".act-btn")) {
            if (!b.offsetParent) continue;
            const cs = getComputedStyle(b);
            const h = b.getBoundingClientRect().height;
            const lines = linesOf(b);
            // the tallest label among the buttons sharing this row
            const top = Math.round(b.getBoundingClientRect().top);
            const rowMax = Math.max(...[...b.parentElement.querySelectorAll(".act-btn")]
              .filter((o) => o.offsetParent && Math.round(o.getBoundingClientRect().top) === top).map(linesOf));
            const padOk = parseFloat(cs.paddingLeft) >= 8 && parseFloat(cs.paddingRight) >= 8;
            const hOk = rowMax <= 2 ? Math.abs(h - rowH) < 0.5 : h >= rowH - 0.5;
            if (!padOk || !hOk) out.push(b.id + "「" + b.textContent.trim() + "」 h=" + h.toFixed(1) + " pad=" + cs.paddingLeft + " lines=" + lines);
          }
          return { rowH, bad: out, n: document.querySelectorAll(".act-btn").length };
        });
        for (const c of tab === "settings" ? CATS : [null]) {
          if (c) await showCat(page, c);
          const r = await measure();
          const where = c ? "settings·" + c : tab;
          assert(r.bad.length === 0, `§1a ${lang}/${theme}/${where}：可见的 .act-btn 左右内边距 ≥ 8px、单行高 ${r.rowH}px` +
            (r.bad.length ? " —— " + r.bad.join("；") : ""));
        }
        await ctx.close();
      }
    }
  }

  // §1b：「今天的训练」的文字不是等宽字体
  for (const lang of LANGS) {
    // 9.0 S1: the plan is 今天's hero; its steps are listed once it is begun
    // (开始), so begin it, and come back to 今天 to read them
    const { ctx, page } = await open(lang, "ai", "home");
    await page.click("#today-go");
    await page.waitForTimeout(600);
    await page.click('#rail button[data-view="home"]');
    await page.waitForTimeout(500);
    // 7.9 §2b: --font-num is the interface face itself now, so "not the
    // --font-num family" stopped meaning anything; ask the real question
    const r = await page.evaluate(() => {
      const first = "等宽字体";
      const monoRe = /SF Mono|Menlo|Consolas|ui-monospace|monospace/i;
      // 10.0 T5: a plan of one thing (a new profile's first lesson) is the
      // card's title and line alone — the list of one is not drawn
      const els = [...document.querySelectorAll("#daily-plan .daily-what, #daily-plan .daily-why, #today-hero-title, #today-hero-meta")];
      return { n: els.filter((e) => e.offsetParent).length, first, mono: els.filter((e) => monoRe.test(getComputedStyle(e).fontFamily)).map((e) => e.textContent) };
    });
    assert(r.n > 0 && r.mono.length === 0, `§1b ${lang}：今天的训练 ${r.n} 段文字都不用 ${r.first}` + (r.mono.length ? " —— " + r.mono.join(" / ") : ""));
    await ctx.close();
  }

  // §1c：键盘光标照 :focus-visible 的规矩。读画布像素：光标是一圈近白的
  // 描边，横在格子上缘内侧；浅格、深格、上一步的绿都到不了近白。
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play");
    const ringed = (sq) => page.evaluate((s) => {
      const c = document.getElementById("board");
      const g = c.getContext("2d");
      const step = c.width / 8;
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      const x0 = Math.round(f * step + step * 0.3), w = Math.round(step * 0.4);
      let best = 0;
      for (let y = Math.round(rk * step + 1); y < Math.round(rk * step + step * 0.14); y++) {
        const d = g.getImageData(x0, y, w, 1).data;
        let white = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
        best = Math.max(best, white / w);
      }
      return best > 0.8;
    }, sq);
    await tap(page, "e2"); await tap(page, "e4");
    await page.waitForTimeout(300);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    assert(focused === "board" && !(await ringed("e4")) && !(await ringed("e5")),
      `§1c 鼠标走完 e2-e4，棋盘有焦点（${focused}）但没有画键盘光标`);
    // 7.8 §1a：方向键在光标没画出来时翻棋谱；进光标模式的是回车
    await page.keyboard.press("Enter");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(150);
    assert(await ringed("e5"), "§1c 按回车进光标模式，再按方向键，光标出现（e4 → e5）");
    await tap(page, "a2");
    await page.waitForTimeout(150);
    assert(!(await ringed("e5")), "§1c 再用鼠标点一下，光标又收起来");
    await ctx.close();
  }

  // §1d：toast 的矩形与 #board 不相交。两种 toast：一条回执（复制 PGN），
  // 一条带按钮的故障（引擎两次都没给出着法）—— 后者更宽，也不会自己走。
  for (const vp of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 700 }, { width: 600, height: 900 }]) {
    for (const panel of ["1", "0"]) {
      const { ctx, page } = await open("en", "ai", "play", "wood", vp, panel);
      await page.evaluate(() => {
        window.__chess.engine.isReady = () => true;
        window.__chess.engine.bestMove = async () => { throw new Error("engine down"); };
        const f = document.getElementById("engine-fault");
        if (f) f.hidden = true;
      });
      await tap(page, "e2"); await tap(page, "e4");
      await page.waitForSelector(".toast.show .toast-action", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(350);
      const hit = () => page.evaluate(() => {
        const t = document.getElementById("toast");
        const a = t.getBoundingClientRect(), b = document.getElementById("board").getBoundingClientRect();
        const cross = a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
        return { shown: t.classList.contains("show"), cross, text: t.textContent.slice(0, 40),
          a: [a.left, a.top, a.right, a.bottom].map(Math.round), b: [b.left, b.top, b.right, b.bottom].map(Math.round) };
      });
      const fault = await hit();
      assert(fault.shown && !fault.cross,
        `§1d ${vp.width}×${vp.height} 面板${panel === "1" ? "开" : "关"}：故障 toast 不压棋盘（toast ${fault.a} / 棋盘 ${fault.b}）`);
      await page.keyboard.press("Escape");
      await page.evaluate(() => { const b = document.getElementById("pgn-copy"); if (b && b.offsetParent) b.click(); });
      await page.waitForTimeout(350);
      const receipt = await hit();
      if (receipt.shown) {
        assert(!receipt.cross, `§1d ${vp.width}×${vp.height} 面板${panel === "1" ? "开" : "关"}：回执 toast 不压棋盘（「${receipt.text}」 ${receipt.a}）`);
      }
      await ctx.close();
    }
  }

  // 7.8 §1d：竖窗下抽屉打开时，toast 不压结果卡的按钮。7.7 把它放在窗口
  // 底部 24px 处 —— 正好落在抽屉里结果卡的第二个按钮「换个对手」上。
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 600, height: 900 });
    for (const sq of ["f2", "f3", "e7", "e5", "g2", "g4", "d8", "h4"]) await tap(page, sq);
    await page.waitForTimeout(400);
    const check = () => page.evaluate(() => {
      const t = document.getElementById("toast");
      const a = t.getBoundingClientRect();
      const btns = [...document.querySelectorAll("#go-card button")].filter((b) => b.offsetParent);
      const hits = btns.filter((b) => { const r = b.getBoundingClientRect(); return a.left < r.right && r.left < a.right && a.top < r.bottom && r.top < a.bottom; });
      return { shown: t.classList.contains("show"), card: btns.length, hits: hits.map((b) => b.id), text: t.textContent.slice(0, 30), top: Math.round(a.top),
               open: document.getElementById("app").classList.contains("panel-open") };
    });
    const end = await check();
    assert(end.open && end.card >= 3, `§1d 600×900 终局：抽屉开着，结果卡在（${end.card} 个按钮）`);
    if (end.shown) assert(end.hits.length === 0, `§1d …终局的 toast「${end.text}」不压结果卡的按钮（${end.hits.join(", ")}）`);
    // a receipt raised while the card is up — the same place any toast takes
    await page.evaluate(() => document.getElementById("pgn-copy").click());
    await page.waitForTimeout(350);
    const rc = await check();
    assert(rc.shown && rc.hits.length === 0, `§1d …再来一条 toast「${rc.text}」（上缘 ${rc.top}px），也不压结果卡的按钮（${rc.hits.join(", ")}）`);
    await ctx.close();
  }

  // 7.8 §1e：棋谱里的兵种字形 = 字母的大写高度（±10%），与字母同一条基线；
  // 白方空心，黑方实心，都是文字的颜色。三种语言各量一遍。
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "pvp", "play");
    // 1.Nf3 Nc6 2.Nc3 Nf6 3.e4 d6 4.Bb5 Bd7 5.Qe2 Qc8 6.Kd1 Kd8
    for (const sq of ["g1", "f3", "b8", "c6", "b1", "c3", "g8", "f6", "e2", "e4", "d7", "d6", "f1", "b5", "c8", "d7", "d1", "e2", "d8", "c8", "e1", "d1", "e8", "d8"]) await tap(page, sq);
    await page.waitForTimeout(300);
    const figs = await page.evaluate(() => {
      const ctx2 = document.createElement("canvas").getContext("2d");
      return [...document.querySelectorAll(".move-list .mlmove .mlfig")].map((f) => {
        const btn = f.closest(".mlmove");
        const cs = getComputedStyle(btn);
        ctx2.font = cs.fontWeight + " " + cs.fontSize + " " + cs.fontFamily;
        const cap = ctx2.measureText("H").actualBoundingBoxAscent;
        const probe = document.createElement("span");
        probe.style.cssText = "display:inline-block;width:0;height:0;vertical-align:baseline";
        btn.appendChild(probe);
        const base = probe.getBoundingClientRect().bottom;
        probe.remove();
        const g = f.querySelector("svg").getBoundingClientRect();
        const text = cs.color;
        const fills = [...f.querySelectorAll("path, circle, rect, polygon")].map((p) => getComputedStyle(p).fill);
        return { san: btn.getAttribute("aria-label"), w: f.classList.contains("fig-w"), h: g.height, cap, dy: g.bottom - base,
                 foreign: fills.filter((x) => x !== "none" && x !== text).length, hollow: fills.filter((x) => x === "none").length, solid: fills.filter((x) => x === text).length };
      });
    });
    const off = figs.filter((f) => Math.abs(f.h / f.cap - 1) > 0.1 || Math.abs(f.dy) > 1.5);
    assert(figs.length === 10 && off.length === 0,
      `§1e ${lang}：${figs.length} 个字形都是大写高度、在基线上` + (off.length ? "（" + off.map((f) => f.san + " " + f.h.toFixed(1) + "/" + f.cap.toFixed(1) + " dy " + f.dy.toFixed(1)).join("，") + "）" : ""));
    assert(figs.every((f) => f.foreign === 0), `§1e ${lang}：字形只用文字的颜色`);
    assert(figs.filter((f) => f.w).every((f) => f.hollow > 0) && figs.filter((f) => !f.w).every((f) => f.solid > 0 && f.w === false),
      `§1e ${lang}：白方空心、黑方实心（白 ${figs.filter((f) => f.w).length} 个，黑 ${figs.filter((f) => !f.w).length} 个）`);
    await ctx.close();
  }

  // §1e（页签条不透明、窗格滚下去后页签下缘有一道 --line）: removed by 9.0 S5
  // S5 — its subject, the panel's tab row, is gone; the pane starts at the
  // panel's top and nothing scrolls under anything (the board-anchor section
  // asserts the pane is at the top)
}

// --- 7.9 §2a / §2c：棋谱大一号，回合号与着法同一条基线 ----------------------
// 7.8.0 量到：「标准」下棋谱着法 13px，面板文字只有 12 和 13 两档；回合号装在
// 一个居中的小方块里，文字下缘比着法高 2.6px。三种语言 × 三种宽度各量一遍。
// 下缘用 Range.getClientRects 量文字本身，不量盒子：盒子对齐了，字不一定。
if (scenario()) {
  const sqAt = async (page, sq) => page.evaluate((s) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const tap = async (page, sq) => { const p = await sqAt(page, sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); };
  // 意大利开局十手：五行，其中有兵种字形（字形是 inline-block，不能把基线带跑）
  const ITALIAN = ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6", "f1", "c4", "f8", "c5", "c2", "c3", "g8", "f6", "d2", "d4", "e5", "d4"];
  const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 600, height: 900 }];
  for (const lang of LANGS) {
    for (const vp of SIZES) {
      const { ctx, page } = await open(lang, "pvp", "play", "wood", vp);
      for (const sq of ITALIAN) await tap(page, sq);
      // 9.0 M3: a portrait drawer shows the list at nine tenths only (the
      // strip stands in for it at half) — the grip's tap takes it there
      await page.evaluate(() => { const g = document.getElementById("sheet-grip"); if (g && g.offsetParent) document.getElementById("app").classList.add("sheet-full"); });
      await page.waitForTimeout(300);
      const r = await page.evaluate(() => {
        const vis = (e) => { const b = e.getBoundingClientRect(); return e.offsetParent !== null && b.width > 0 && b.height > 0; };
        // the bottom of the last line box of the element's first text run
        const textBottom = (el) => {
          const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: (n) => n.textContent.trim() ? 1 : 3 });
          const tn = w.nextNode();
          if (!tn) return null;
          const rg = document.createRange(); rg.selectNodeContents(tn);
          const rs = [...rg.getClientRects()];
          return rs.length ? rs[rs.length - 1].bottom : null;
        };
        const rows = [...document.querySelectorAll(".move-list .mlrow")].filter(vis).map((row) => {
          const no = row.querySelector(".mlnum");
          const nb = textBottom(no);
          const mv = [...row.querySelectorAll(".mlmove:not(.mlgap)")].map(textBottom).filter((x) => x != null);
          return { no: no.textContent, d: mv.length && nb != null ? Math.max(...mv.map((m) => Math.abs(m - nb))) : null,
                   bg: getComputedStyle(no).backgroundColor, align: getComputedStyle(no).textAlign };
        });
        const texts = [...document.querySelectorAll("#side *")].filter((e) => vis(e) &&
          [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
        const pane = document.getElementById("pane-play");
        return {
          rows,
          san: [...new Set([...document.querySelectorAll(".move-list .mlmove")].map((e) => getComputedStyle(e).fontSize))],
          // 9.0 S5: the panel's tabs are gone; the tabs now are the settings
          // page's categories, whose names are body text too
          tab: getComputedStyle(document.querySelector("#cat-general .set-cat-txt b")).fontSize,
          // 9.0 V1: 12px is a role again — the aside, in the muted ink — and
          // nothing in the panel is smaller but a badge or a tool's name (11)
          twelve: texts.filter((e) => getComputedStyle(e).fontSize === "12px" &&
            getComputedStyle(e).color !== getComputedStyle(document.getElementById("replay-pos")).color).map((e) => e.id || e.className),
          small: texts.filter((e) => parseFloat(getComputedStyle(e).fontSize) < 12 &&
            !e.matches(".tool-lbl, .mvtag, .pick-tag, .xp-book, .xp-mine, .xp-bar *, .curve-x *, .curve-y, .curve-y *, .daily-dot")).map((e) => e.id || e.className),
          hscroll: pane.scrollWidth - pane.clientWidth,
          docScroll: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        };
      });
      const tag = `7.9 ${lang} ${vp.width}×${vp.height}`;
      // 9.0 V1: the notation is body text, 14px (four type roles, no 15)
      assert(r.san.length === 1 && r.san[0] === "14px", `§2a ${tag}：棋谱着法 14px（${r.san.join(" ")}）`);
      assert(r.tab === "14px", `§2a ${tag}：正文 14px（设置分类名 ${r.tab}）`);
      assert(r.twelve.length === 0, `§2a ${tag}：面板里 12px 的字都是旁注（次要色）` + (r.twelve.length ? "（" + r.twelve.slice(0, 4).join("，") + "）" : ""));
      assert(r.small.length === 0, `§2a ${tag}：面板里没有小于 12px 的正文（11px 只给坐标与徽章）` + (r.small.length ? "（" + r.small.slice(0, 4).join("，") + "）" : ""));
      assert(r.hscroll <= 0 && r.docScroll <= 0, `§2a ${tag}：大一号之后没有横向滚动（窗格 ${r.hscroll}，页面 ${r.docScroll}）`);
      const off = r.rows.filter((x) => x.d == null || x.d > 1);
      assert(r.rows.length === 5 && off.length === 0,
        `§2c ${tag}：${r.rows.length} 行里回合号与着法的文字下缘相差 ≤ 1px` +
        (off.length ? "（" + off.map((x) => x.no + " " + (x.d == null ? "?" : x.d.toFixed(2))).join("，") + "）" : "（最大 " + Math.max(...r.rows.map((x) => x.d)).toFixed(2) + "）"));
      assert(r.rows.every((x) => x.bg === "rgba(0, 0, 0, 0)" && x.align === "right"),
        `§2c ${tag}：回合号没有底色、右对齐（${[...new Set(r.rows.map((x) => x.bg + " " + x.align))].join("；")}）`);
      await ctx.close();
    }
  }
}


// --- 7.9 §1 + §7：控件的归属与网格，量到像素 -------------------------------
// v7-9-plan §1a–§1e 的量尺断言，三种语言 × 三种窗口（1440×900、1024×700、
// 600×900）。7.8.0 上量到的是：悔棋/提示/☰ 在 y 2–30、对手那一行在 36–66，
// ☰ 的右缘比棋盘外框多出 104px；「复盘」「本局」两组按钮 72px 定宽、靠左，
// 英文「Live analysis」「Offer draw」折成两行；面板里的按钮 36px 与 28px 两种
// 之外还混着别的。这里量摆好之后的盒子，不量样式表写了什么（那是
// test-chess.mjs 的两种高度守卫）。
if (scenario()) {
  const SIZES = [{ width: 1440, height: 900 }, { width: 1024, height: 700 }, { width: 600, height: 900 }];
  const clickSquares = async (page, list) => {
    for (const sq of list) {
      const pt = await page.evaluate((s) => {
        const c = document.getElementById("board"), r = c.getBoundingClientRect();
        return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                 y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(160);
    }
  };
  // Every visible button in the panel, measured: its height, how many lines
  // its text takes (distinct line tops of a Range over each text node, 3px
  // apart or more — an icon beside a label is not a second line), and
  // whether the text runs out of its box. Two kinds of row are not in it,
  // being entries of a list rather than controls in the sense of §1e: the
  // notation's cells (--row-h-sm, the one deliberate second height 1.13 gave
  // the move list) and the steps of 今天的训练, which are the step and then
  // why, on two lines by design (7.4 §5).
  const panelButtons = (page) => page.evaluate(() => {
    const lines = (b) => {
      const tops = [];
      const walk = document.createTreeWalker(b, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        if (!n.data.trim()) continue;
        const r = document.createRange();
        r.selectNodeContents(n);
        for (const rc of r.getClientRects()) if (rc.width > 0) tops.push(rc.top);
      }
      tops.sort((a, z) => a - z);
      return tops.filter((t, i) => i === 0 || t - tops[i - 1] >= 3).length;
    };
    return [...document.querySelectorAll("#side button")]
      // 9.0 S3: the puzzle picker's tiles and its 复习 card are cards (an
      // icon, a name and a count on lines of their own, by design), entries
      // of a menu rather than §1e's controls — measured as cards by
      // pickerFits instead
      .filter((b) => b.checkVisibility({ visibilityProperty: true }) && !b.closest("#move-list, .daily-plan, .pz-tile, .pz-review"))
      .map((b) => {
        const r = b.getBoundingClientRect();
        return { id: b.id || b.className, text: b.textContent.trim().slice(0, 24), h: Math.round(r.height * 10) / 10,
                 w: r.width, lines: lines(b), over: b.scrollWidth - b.clientWidth };
      });
  });

  for (const vp of SIZES) {
    for (const lang of LANGS) {
      const at = `7.9 ${lang} ${vp.width}×${vp.height}：`;
      const { ctx, page, errs } = await open(lang, "pvp", "play", "wood", vp);
      await clickSquares(page, ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6"]);
      await page.waitForTimeout(300);

      // §1a — 悔棋、提示 are the right end of the opponent's strip: on its
      // centre line (the disc's), and flush with the frame's right edge
      const a = await page.evaluate(() => {
        const top = document.querySelector(".pstrip.at-top");
        const wrap = document.getElementById("board-wrap").getBoundingClientRect();
        const av = top.querySelector(".ps-av").getBoundingClientRect();
        const tools = [...document.querySelectorAll("#strip-tools button")]
          .filter((b) => getComputedStyle(b).visibility === "visible")
          .map((b) => { const r = b.getBoundingClientRect(); return { id: b.id, mid: (r.top + r.bottom) / 2, r: r.right, h: r.height }; });
        const chromeBtns = [...document.querySelectorAll(".chrome button")].map((b) => b.id);
        // v8-0-plan A2: in the wide layout the strip is a card and the tools
        // are a line of it, so their centre line is their own and their right
        // edge is the card's content edge
        const wide = document.getElementById("app").classList.contains("pv-wide");
        const tb = top.getBoundingClientRect(), cs = getComputedStyle(top);
        const inner = tb.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        return { inTop: !!top.querySelector("#strip-tools"),
                 rowMid: wide && tools.length ? tools[0].mid : (av.top + av.bottom) / 2,
                 frameR: wide ? inner : wrap.right, tools, chromeBtns };
      });
      assert(a.inTop, at + "§1a 悔棋/提示在对手那一行（上方的对阵条）里");
      assert(a.tools.map((t) => t.id).join() === "undo,btn-hint,toggle-panel", at + "§1a 两步之后悔棋、提示都在，☰ 在它们右边（" + a.tools.map((t) => t.id).join(", ") + "）");
      const offMid = a.tools.map((t) => Math.abs(t.mid - a.rowMid));
      assert(offMid.every((d) => d <= 1),
        at + "§1a 控件的垂直中线 = 对手那一行的中线 ±1px（差 " + offMid.map((d) => d.toFixed(1)).join(" / ") + "）");
      const rightmost = Math.max(...a.tools.map((t) => t.r));
      assert(Math.abs(rightmost - a.frameR) <= 1,
        at + "§1a 最右一个控件的右缘 = 棋盘外框右缘 ±1px（" + rightmost.toFixed(1) + " vs " + a.frameR.toFixed(1) + "）");
      assert(a.tools.every((t) => Math.abs(t.h - 32) < 0.5), at + "§1e 这三个控件是 --ctl-h-sm（" + a.tools.map((t) => t.h).join(", ") + "）");
      assert(a.chromeBtns.length === 0, at + "9.0 V3 顶栏没有按钮（" + a.chromeBtns.join(", ") + "）");

      // Two states: the live position, where 本局 is 提和 / 新局 / 认输 and
      // English used to break 「Offer draw」; and one move back with 更多
      // open, where 复盘 shows all four (重下 appears while replaying) and the
      // fourth row is drawn.
      for (const state of ["live", "back"]) {
        if (state === "back") {
          await page.click("#rep-prev");
          await page.waitForTimeout(250);
          await page.click("#more-tools");
          await page.waitForTimeout(250);
        }
        const st = at + "[" + state + "] ";
        // 9.0 S2: 精析 is in 分析's ⋯ menu — opened, it is a panel button like
        // the others (measured below with them), named, inside the column
        if (state === "back") {
          await page.click("#an-more > summary");
          await page.waitForTimeout(250);
          const m = await page.evaluate(() => {
            const sum = document.querySelector("#an-more > summary"), deep = document.getElementById("an-deep");
            const side = document.getElementById("side").getBoundingClientRect(), r = deep.getBoundingClientRect();
            return { named: !!(sum.getAttribute("aria-label") || "").trim(), shown: deep.checkVisibility(),
                     inside: r.left >= side.left - 0.5 && r.right <= side.right + 0.5, h: Math.round(sum.getBoundingClientRect().height) };
          });
          assert(m.named && m.shown && m.inside && m.h >= 32, st + "分析的 ⋯ 有名字、打开后精析在面板里 (" + JSON.stringify(m) + ")");
        }
        const btns = await panelButtons(page);

        // §1b — one line, in its box, every button in the panel
        const wrapped = btns.filter((b) => b.text && (b.lines > 1 || b.over > 0));
        assert(wrapped.length === 0,
          st + "§1b 面板里每个按钮的文字都只有一行、不出框" +
          (wrapped.length ? " —— " + wrapped.map((b) => b.id + "「" + b.text + "」 lines=" + b.lines + " over=" + b.over).join("；") : ""));
        // …and the groups are equal cells; a group with a full first row
        // reaches the column's right edge
        const groups = await page.evaluate(() => [...document.querySelectorAll("#pane-play .fit-row")]
          .filter((r) => r.checkVisibility())
          .map((r) => {
            const kids = [...r.children].filter((b) => b.checkVisibility());
            const rr = r.getBoundingClientRect();
            const ws = kids.map((b) => b.getBoundingClientRect().width);
            const cols = Number(getComputedStyle(r).getPropertyValue("--cols")) || 0;
            return { id: r.id || r.parentElement.id, n: kids.length, spread: Math.max(...ws) - Math.min(...ws), cols,
                     filled: Math.max(...kids.map((b) => b.getBoundingClientRect().right)) - rr.right };
          }));
        const want = state === "live" ? ["review-actions", "game-actions"] : ["review-actions", "game-actions", "more-row"];
        assert(want.every((id) => groups.some((g) => g.id === id)),
          st + "§1b 这几组都在（" + groups.map((g) => g.id + ":" + g.n + "×" + g.cols + "列").join(", ") + "）");
        for (const g of groups) {
          assert(g.spread <= 1, st + "§1b " + g.id + " 同组按钮宽度相差 ≤ 1px（" + g.spread.toFixed(2) + "）");
          if (g.n >= g.cols) assert(Math.abs(g.filled) <= 1,
            st + "§1b " + g.id + " 铺满面板宽度（" + g.n + " 个 " + g.cols + " 列，右缘差 " + g.filled.toFixed(1) + "）");
        }

        // §1e — two heights among the panel's buttons, and only these two
        const heights = [...new Set(btns.map((b) => b.h))].sort((x, y) => x - y);
        assert(heights.length <= 2 && heights.every((h) => h === 32 || h === 36),
          st + "§1e 面板里可见按钮的高度只有 32 / 36 两种（" +
          heights.map((h) => h + "×" + btns.filter((b) => b.h === h).length).join("、") + "）" +
          (heights.some((h) => h !== 32 && h !== 36)
            ? " —— " + btns.filter((b) => b.h !== 32 && b.h !== 36).map((b) => b.id + "=" + b.h).join(", ") : ""));
      }

      // §1c — four equal cells of one bar, 36px, reached in order by Tab
      const bar = await page.evaluate(() => {
        const seg = document.getElementById("replay-seg");
        const cs = getComputedStyle(seg);
        return {
          radius: parseFloat(cs.borderTopLeftRadius), border: cs.borderTopStyle,
          cells: [...seg.querySelectorAll("button")].map((b) => {
            const r = b.getBoundingClientRect();
            return { id: b.id, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10, off: b.disabled };
          }),
        };
      });
      assert(bar.cells.length === 4 && bar.border === "solid" && bar.radius > 0,
        at + "§1c 翻棋谱是一条带圆角外框的按钮栏（" + bar.cells.length + " 格，" + bar.border + "，r=" + bar.radius + "）");
      const cw = bar.cells.map((c) => c.w), ch = bar.cells.map((c) => c.h);
      assert(Math.max(...cw) - Math.min(...cw) <= 1 && ch.every((h) => h === 36),
        at + "§1c 四格同宽同高 36px（宽 " + cw.join("/") + "，高 " + ch.join("/") + "）");
      if (vp.width === 1440 && bar.cells.every((c) => !c.off)) {
        await page.focus("#rep-start");
        const order = ["rep-start"];
        const rings = [];
        for (let i = 0; i < 3; i++) {
          await page.keyboard.press("Tab");
          const f = await page.evaluate(() => {
            const e = document.activeElement, cs = getComputedStyle(e);
            return { id: e.id, ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) >= 2 };
          });
          order.push(f.id); rings.push(f.ring);
        }
        assert(order.join(",") === "rep-start,rep-prev,rep-next,rep-end",
          at + "§1c Tab 依次到达四格（" + order.join(" → ") + "）");
        assert(rings.every(Boolean), at + "§1c 每一格的焦点环都看得见");
      }

      // §1d — the icons carry their names when the panel is 360px or wider,
      // and a name never runs out of its cell
      const d = await page.evaluate(() => {
        const side = document.getElementById("side").getBoundingClientRect().width;
        const lbls = [...document.querySelectorAll("#tool-row .tool-lbl")]
          .filter((l) => l.closest("button").checkVisibility());
        return {
          side,
          shown: lbls.filter((l) => l.checkVisibility()).length, total: lbls.length,
          bad: lbls.filter((l) => l.checkVisibility()).filter((l) => {
            const b = l.closest("button").getBoundingClientRect(), r = l.getBoundingClientRect();
            return l.scrollWidth > l.clientWidth || r.left < b.left - 0.5 || r.right > b.right + 0.5 ||
              r.bottom > b.bottom + 0.5 || parseFloat(getComputedStyle(l).fontSize) !== 11;
          }).map((l) => l.textContent),
        };
      });
      if (d.side >= 360) {
        assert(d.total > 0 && d.shown === d.total, at + "§1d 面板 " + Math.round(d.side) + "px ≥ 360：每个图标下有字（" + d.shown + "/" + d.total + "）");
        assert(d.bad.length === 0, at + "§1d 11px 的字不出各自的格子" + (d.bad.length ? " —— " + d.bad.join("、") : ""));
      } else {
        assert(d.shown === 0, at + "§1d 面板 " + Math.round(d.side) + "px < 360：只显示图标（" + d.shown + "）");
      }
      assert(errs.length === 0, at + "零 JS 异常 " + errs.join(" / "));
      await ctx.close();
    }
  }

  // §1e on the two reading pages — 重来/下一课 and 重做/下一题 were the 28px
  // ones, one row under the 36px type buttons
  for (const vp of SIZES) {
    for (const lang of LANGS) {
      for (const mode of ["learn", "puzzle"]) {
        const at = `7.9 ${lang} ${vp.width}×${vp.height} ${mode}：`;
        const { ctx, page } = await open(lang, mode, "play", "wood", vp);
        const btns = await panelButtons(page);
        const heights = [...new Set(btns.map((b) => b.h))].sort((x, y) => x - y);
        assert(heights.length <= 2 && heights.every((h) => h === 32 || h === 36),
          at + "§1e 可见按钮的高度只有 32 / 36 两种（" + heights.map((h) => h + "×" + btns.filter((b) => b.h === h).length).join("、") + "）" +
          (heights.some((h) => h !== 32 && h !== 36) ? " —— " + btns.filter((b) => b.h !== 32 && b.h !== 36).map((b) => b.id + "=" + b.h).join(", ") : ""));
        const wrapped = btns.filter((b) => b.text && (b.lines > 1 || b.over > 0));
        assert(wrapped.length === 0, at + "§1b 按钮文字都只有一行" +
          (wrapped.length ? " —— " + wrapped.map((b) => b.id + "「" + b.text + "」").join("；") : ""));
        if (mode === "puzzle") {
          const pk = await pickerFits(page);
          assert(pk.heights.length === 1 && pk.tight.length === 0 && pk.review.length === 0,
            at + "选题器的卡片一样高、名字/数目/复习说明都不被截 (" + pk.heights.join(", ") + "; " + pk.tight.concat(pk.review).join(", ") + ")");
          assert(pk.modeCut.length === 0 && pk.modeH.length === 1 && pk.modeH.every((h) => h === 32 || h === 36),
            at + "换个练法：标签一行不出格，按钮 32/36 (" + pk.modeCut.join(", ") + "; " + pk.modeH.join(", ") + ")");
        }
        const ctl = await page.evaluate(() => [...document.querySelectorAll(".lesson-controls.fit-row button")]
          .filter((b) => b.checkVisibility()).map((b) => b.getBoundingClientRect().width));
        if (ctl.length) assert(Math.max(...ctl) - Math.min(...ctl) <= 1, at + "§1b 课程/做题那一行等宽（" + ctl.map(Math.round).join("/") + "）");
        await ctx.close();
      }
    }
  }

  // §1a — 9.0 V3: ☰ is the opponent's strip's last control, open or shut
  // (it stood on the panel's edge, outside the board); and the strip's tools
  // follow the board when it turns
  {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 });
    const where = () => page.evaluate(() => {
      const b = document.getElementById("toggle-panel"), r = b.getBoundingClientRect();
      const top = document.querySelector(".pstrip.at-top"), t = top.getBoundingClientRect();
      return { last: b.parentElement.id === "strip-tools" && !b.nextElementSibling && top.contains(b),
               inside: r.top >= t.top - 0.5 && r.bottom <= t.bottom + 0.5 };
    });
    const open1 = await where();
    assert(open1.last && open1.inside, "9.0 V3 面板开着：☰ 是上方玩家栏最后一个控件（" + JSON.stringify(open1) + "）");
    await page.keyboard.press("p");
    await page.waitForTimeout(450);
    const shut = await where();
    assert(shut.last && shut.inside, "9.0 V3 面板关着：☰ 仍在上方玩家栏里（" + JSON.stringify(shut) + "）");
    await page.keyboard.press("p");
    await page.waitForTimeout(450);
    await page.keyboard.press("f");
    await page.waitForTimeout(300);
    const flipped = await page.evaluate(() => ({
      topId: document.querySelector(".pstrip.at-top").id,
      holder: document.getElementById("strip-tools").parentElement.id,
    }));
    assert(flipped.topId === "strip-w" && flipped.holder === "strip-w",
      "7.9 §1a 翻转棋盘后，悔棋/提示跟着到上方那一条（" + flipped.holder + "）");
    await ctx.close();
  }
}

// --- v8-0-plan §5: the shortcut sheet and the new-game dialog ---------------
// Red before §5: the sheet was 380px with its list capped at 52vh, so the
// bottom rows sat behind an inner scroll bar (128px of list hidden at
// 1400x900 in Chinese, 388 in English); and the new-game dialog's two
// difficulty labels were 11px beside 14px 陪练风格 / 执子 / 棋钟.
if (scenario()) {
  for (const lang of LANGS) {
    for (const vp of [{ width: 1400, height: 900 }, { width: 1200, height: 800 }, { width: 390, height: 700 }]) {
      const { ctx, page, errs } = await open(lang, "ai", "play", "wood", vp);
      await page.evaluate(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "?", bubbles: true })));
      await page.waitForTimeout(400);
      const k = await page.evaluate(() => {
        const m = document.querySelector("#keys-modal .modal"), l = document.getElementById("keys-list");
        const box = m.getBoundingClientRect();
        const lh = (d) => parseFloat(getComputedStyle(d).lineHeight) || 20;
        return {
          shown: document.getElementById("keys-modal").classList.contains("show"),
          width: Math.round(box.width),
          listHidden: l.scrollHeight - l.clientHeight,
          cardHidden: m.scrollHeight - m.clientHeight,
          maxLines: Math.max(...[...l.querySelectorAll("dd")].map((d) => Math.round(d.getBoundingClientRect().height / lh(d)))),
          outside: [...l.querySelectorAll("dt, dd")].filter((e) => e.getBoundingClientRect().right > box.right + 0.5).length,
        };
      });
      const at = lang + " " + vp.width + "x" + vp.height + ": ";
      assert(k.shown && k.listHidden <= 0, at + "§5 快捷键表没有藏在内层滚动条后面的行(" + k.listHidden + "px)");
      assert(k.outside === 0, at + "§5 …没有一行伸出卡片右缘");
      if (vp.width >= 1200) {
        assert(k.width >= 640, at + "§5 …卡片够宽(" + k.width + "px)");
        assert(k.cardHidden <= 0, at + "§5 …整张表一屏放得下,关闭不用滚(" + k.cardHidden + "px)");
        assert(k.maxLines <= 2, at + "§5 …每条说明至多两行(" + k.maxLines + ")");
      }
      assert(errs.length === 0, at + "no JS exception — " + errs.join(" / "));
      await ctx.close();
    }
    // the new-game dialog: one size for every group title in it
    const { ctx, page } = await open(lang, "ai", "play");
    await page.evaluate(() => document.getElementById("btn-new").click());
    await page.waitForTimeout(400);
    const sizes = await page.evaluate(() => [...document.querySelectorAll("#ng-host .diff-group, #ng-host .setting-k")]
      .filter((e) => e.offsetParent).map((e) => e.textContent.trim() + " " + getComputedStyle(e).fontSize + "/" + getComputedStyle(e).fontWeight));
    const distinct = new Set(sizes.map((s) => s.split(" ").pop()));
    assert(sizes.length >= 4 && distinct.size === 1, lang + ": §5 新对局对话框的组标题同一字号同一字重(" + sizes.join(", ") + ")");
    await ctx.close();
  }
}

// --- v8-0-plan A1: the rail stands still -------------------------------------
// The top level's one invariant of its own, in the shape of 7.7's two: the
// rail is the same box, to the pixel, whichever of its entries is current —
// a navigation that moves under the pointer is clicked twice in the wrong
// place — in a wide window (a column), a narrow one and a portrait one (a row
// in the top bar). And the board is where it was after a trip through every
// page: re-proving "the board rect is fixed" for the new shell.
if (scenario()) {
  for (const vp of [{ width: 1440, height: 900 }, { width: 760, height: 600 }, { width: 600, height: 900 }]) {
    const tag = vp.width + "x" + vp.height;
    const { ctx, page, errs } = await open("zh-CN", "ai", "play", "wood", vp);
    const railBox = () => page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return [b.left, b.top, b.width, b.height].map((v) => Math.round(v * 10) / 10).join(","); };
      const nav = document.getElementById("rail");
      return { rail: r(nav), buttons: [...nav.querySelectorAll("button")].map(r).join(" "),
               board: r(document.getElementById("board")) };
    });
    const first = await railBox();
    const seen = new Set();
    // 9.0 S3: 谜题 / 学习 are one entry, 训练; the six are now with 设置
    for (const v of ["home", "train", "library", "me", "settings", "play"]) {
      await page.click('#rail button[data-view="' + v + '"]');
      await page.waitForTimeout(350);
      const b = await railBox();
      seen.add(b.rail + " | " + b.buttons);
      if (v === "play") assert(b.board === first.board, tag + ": 走遍六个入口回到「下棋」,棋盘逐像素在原处(" + first.board + " → " + b.board + ")");
    }
    assert(seen.size === 1 && [...seen][0] === first.rail + " | " + first.buttons,
      tag + ": 切换入口时导航栏和它的每个按钮都不动(" + seen.size + " 种)");
    const shape = await page.evaluate(() => {
      const r = document.getElementById("rail").getBoundingClientRect();
      return { w: Math.round(r.width), h: Math.round(r.height), x: Math.round(r.left), y: Math.round(r.top) };
    });
    if (vp.width > 820) assert(shape.x === 0 && shape.y === 0 && shape.w <= 72 && shape.h === vp.height, tag + ": 宽窗是左侧通高的窄栏(" + JSON.stringify(shape) + ")");
    else assert(shape.y === 0 && shape.h <= 32, tag + ": 窄窗是 32px 顶栏里的一行(" + JSON.stringify(shape) + ")");
    assert(errs.length === 0, tag + ": 没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
}

// --- v8-0-plan A1: the rail costs the play view nothing ---------------------
// "下棋视图保持现在的几何". In every window this app runs in the board is
// height-bound, so a 64px column on the left comes out of the side slack and
// not out of the board: its edge is what the 7.9 formula (no rail) gave, to
// the pixel. And the panel's width is still a function of the window alone —
// the same on both tabs, in every mode and under every page (7.7 §1g).
// M2 (A1 × A2): "the window" is the play view's size since A2 (the window
// less this rail), and where the play view is wide enough for A2's wide
// layout (1920 here) the board is A2's, which is never smaller than the
// two-column formula — the rail still takes nothing from it.
if (scenario()) {
  for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 700]]) {
    const widths = new Set(), boards = new Set();
    // 9.0 S5: the 设置 tab is the settings page (a page, like 我的 / 棋谱库)
    for (const [mode, tab] of [["ai", "play"], ["ai", "settings"], ["puzzle", "play"], ["learn", "play"], ["ai", "me"], ["ai", "library"]]) {
      const { ctx, page } = await open("zh-CN", mode, tab, "wood", { width: w, height: h });
      const r = await page.evaluate(() => {
        const css = getComputedStyle(document.documentElement);
        const px = (n) => parseFloat(css.getPropertyValue(n));
        const side = document.getElementById("side").getBoundingClientRect().width;
        // 7.9's #board-wrap: min(100vw − side − 2·pad, 100vh − bar − 2·strip − pad-y)
        const old = Math.min(innerWidth - side - 2 * px("--stage-pad"),
          innerHeight - px("--chrome-h") - 2 * px("--strip-h") - px("--stage-pad-y"));
        return { side: Math.round(side), wrap: Math.round(document.getElementById("board-wrap").getBoundingClientRect().width), old: Math.round(old),
                 wide: document.getElementById("app").classList.contains("pv-wide") };
      });
      widths.add(r.side); boards.add(r.wrap + "/" + r.old + "/" + r.wide);
      await ctx.close();
    }
    assert(widths.size === 1, w + "x" + h + ": 面板宽度只由窗口(下棋视图)决定 —— 三种模式、三张整页(含设置页)一个宽度(" + [...widths].join(", ") + ")");
    const [wrap, old, wide] = [...boards][0].split("/");
    assert(boards.size === 1 && (wide === "true" ? Number(wrap) >= Number(old) : wrap === old),
      w + "x" + h + ": 导航栏不占棋盘:棋盘框 " + wrap + "px " + (wide === "true" ? "≥" : "=") + " 没有栏时两栏公式的 " + old + "px" + (wide === "true" ? "(宽布局)" : "") + " " + [...boards].join(" | "));
  }
}

/**
 * 9.0 S1: 今天 — what a page owes the window (5.x / A1), asked of its own
 * parts: the greeting, the hero card with its board, the three rings, the
 * three 继续 cards, the recent games and the two ratings. No text cut (a
 * card title ellipsizes, so "cut" is its own scrollWidth), every button one
 * line inside itself, the three cards one height, the boards square and
 * drawn, and the recent games listed (four at most) with the ratings shown.
 */
const seedTodayStats = () => {
  const games = [];
  for (let i = 0; i < 6; i++) games.push({ id: "tg" + i, t: Date.now() - i * 864e5, diff: "normal", color: i % 2 ? "b" : "w",
    result: ["win", "loss", "draw"][i % 3], moves: 30 + i, pgn: '[Event "?"]\n\n1. e4 e5 2. Nf3 Nc6 1/2-1/2', ending: "", acc: 70, acpl: 40 });
  localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games }));
};
async function todayChecks(tag, page) {
  if (!(await page.isVisible("#page-home"))) {
    await page.click('#rail button[data-view="home"]'); await page.waitForTimeout(400);
  }
  // the camp's card waits for its chunk (today-page.js renderContinue)
  await page.waitForFunction(() => !document.querySelector('#today-cont .today-c[data-seg="endgame"]').hidden, null, { timeout: 6000 }).catch(() => {});
  const r = await page.evaluate(() => {
    const home = document.getElementById("page-home");
    const vis = (e) => !!e.offsetParent && e.getClientRects().length;
    const cut = (e) => e.scrollWidth > e.clientWidth + 1;
    const texts = [...home.querySelectorAll("h1, h2, p, b, small, .today-ring span, .today-res, .today-d, .setting-k, li")]
      .filter((e) => vis(e) && e.textContent.trim() && getComputedStyle(e).display !== "inline");
    const btns = [...home.querySelectorAll(".act-btn, .tool-txt")].filter(vis);
    const cards = [...home.querySelectorAll("#today-cont .today-c")].filter(vis);
    const boards = [...home.querySelectorAll(".mini-board")].filter(vis).map((b) => b.getBoundingClientRect());
    const lh = (e) => parseFloat(getComputedStyle(e).lineHeight) || parseFloat(getComputedStyle(e).fontSize) * 1.5;
    return {
      cut: texts.filter(cut).map((e) => (e.id || e.className || e.tagName) + "「" + e.textContent.trim().slice(0, 16) + "」"),
      btnBad: btns.filter((b) => cut(b) || b.scrollHeight > b.clientHeight + 1 || b.getBoundingClientRect().height > lh(b) * 1.6 + 16)
        .map((b) => (b.id || b.className) + "「" + b.textContent.trim() + "」" + Math.round(b.getBoundingClientRect().height)),
      cards: cards.length, cardH: [...new Set(cards.map((c) => Math.round(c.getBoundingClientRect().height)))],
      boards: boards.length, square: boards.every((b) => Math.abs(b.width - b.height) <= 1 && b.width >= 48),
      drawn: [...home.querySelectorAll(".mini-board")].filter(vis).every((b) => b.querySelectorAll(".mini-sq").length === 64 && b.querySelector("img")),
      rings: [...home.querySelectorAll(".today-ring")].filter(vis).length,
      games: home.querySelectorAll("#today-games li").length,
      ratings: ["today-r-game", "today-r-pz"].map((id) => document.getElementById(id).textContent.trim()),
      hero: document.getElementById("today-hero-title").textContent.trim(), go: document.getElementById("today-go").textContent.trim(),
    };
  });
  assert(r.cut.length === 0, tag + ": 今天页上没有被截掉的字" + (r.cut.length ? " — " + r.cut.slice(0, 6).join(", ") : ""));
  assert(r.btnBad.length === 0, tag + ": 今天页的按钮一行、字在框里" + (r.btnBad.length ? " — " + r.btnBad.join(", ") : ""));
  assert(r.cards === 3 && r.cardH.length === 1, tag + ": 继续的三张卡都在、一样高 (" + r.cards + "; " + r.cardH.join(", ") + ")");
  assert(r.boards === 4 && r.square && r.drawn, tag + ": 主卡与三张卡的小棋盘方正、摆着棋子 (" + r.boards + ")");
  assert(r.rings === 3 && r.games >= 1 && r.games <= 4 && r.ratings.every(Boolean),
    tag + ": 三个进度环、最近对局 " + r.games + " 局、两个等级分 (" + r.ratings.join(" / ") + ")");
  assert(r.hero && r.go, tag + ": 主卡说了接下来做什么,按钮有字 (「" + r.hero + "」·「" + r.go + "」)");
}

// --- v8-0-plan A1: a page is as wide as the window, never wider --------------
// The pages took the records out of a 400px panel and the diagnosis out of a
// 460px dialog; the one way a page can go wrong the panel could not is to be
// wider than the window. At the five widths A2 measures: no horizontal
// scroll on the page, and nothing on it past its right edge — the list and
// the diagnosis sheets included, which are the widest things in the app.
if (scenario()) {
  const games = [];
  for (let i = 0; i < 24; i++) {
    const tags = new Array(80).fill(null), losses = new Array(80).fill(null), scalars = [0];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0;
      losses[ply] = mine ? (ply > 60 ? 120 : 8) : 0;
      scalars.push(scalars[ply] + (mine ? -losses[ply] : losses[ply]));
    }
    tags[54] = "??";
    const sans = i % 2 ? "d4 d5 c4 e6 Nf3 Nf6" : "e4 e5 Nf3 Nc6 Bb5 a6";
    games.push({ id: "g" + i, t: 1758000000000 + i * 864e5, white: "hxddh", black: "rival" + i,
      date: "2026.09.01", event: "Rated blitz", result: i % 2 ? "0-1" : "1-0", plies: 80,
      sans: sans + " " + sans, fen: "", side: "w", outcome: i % 2 ? "loss" : "win",
      eco: i % 2 ? "D37" : "C60", ecoName: i % 2 ? "Queen's Gambit Declined" : "Ruy Lopez",
      motifs: { 54: "fork" },
      an: { acc: { w: 60, b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars, bests: new Array(81).fill(null), budget: 200 } });
  }
  const lib = JSON.stringify({ v: 1, names: ["hxddh"], games });
  for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080], [600, 900]]) {
    for (const lang of ["zh-CN", "en"]) {
      const tag = w + "x" + h + "/" + lang;
      const { ctx, page, errs } = await open(lang, "ai", "home", "wood", { width: w, height: h });
      await page.evaluate(seedLibrary, JSON.parse(lib));
      await page.evaluate(seedTodayStats);
      await page.reload();
      await page.waitForTimeout(900);
      const overflow = (sel) => page.evaluate((q) => {
        const root = document.querySelector(q);
        if (!root || !root.getClientRects().length) return { missing: q };
        const edge = root.getBoundingClientRect().right;
        // 9.0 S5: a row that scrolls sideways on purpose (设置's categories
        // under 900px: .set-cats, overflow-x auto) clips what it holds; the
        // row itself is still measured against the edge
        const inScroller = (e) => { const n = e.parentElement && e.parentElement.closest(".set-cats");
          return !!n && root.contains(n) && /auto|scroll/.test(getComputedStyle(n).overflowX); };
        const past = [...root.querySelectorAll("*")].filter((e) => e.getClientRects().length)
          .filter((e) => e.getBoundingClientRect().right > edge + 1 && !e.closest(".sr-only") && !inScroller(e))
          .map((e) => (e.id || e.className || e.tagName) + "@" + Math.round(e.getBoundingClientRect().right));
        return { doc: document.scrollingElement.scrollWidth - innerWidth, own: root.scrollWidth - root.clientWidth, past: past.slice(0, 4) };
      }, sel);
      const check = async (what, sel) => {
        const o = await overflow(sel);
        assert(!o.missing && o.doc <= 0 && o.own <= 0 && o.past.length === 0,
          tag + ": " + what + " 没有横向滚动,也没有东西伸出右缘(" + JSON.stringify(o) + ")");
      };
      await check("首页", "#page-home");
      await todayChecks(tag, page);
      await page.click('#rail button[data-view="library"]'); await page.waitForTimeout(300);
      await check("棋谱库", "#page-library");
      await page.click("#lib-diagnose"); await page.waitForTimeout(900);
      await check("诊断", "#lib-modal .modal");
      await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      await page.click("#lib-open"); await page.waitForTimeout(500);
      await check("棋谱列表", "#lib-list-modal .modal");
      await page.keyboard.press("Escape"); await page.waitForTimeout(200);
      await page.click('#rail button[data-view="me"]'); await page.waitForTimeout(300);
      await check("我的", "#page-me");
      // 9.0 S5: 设置 is a page too (the 偏好设置 window and the 设置 tab), a
      // category at a time
      await page.click('#rail button[data-view="settings"]'); await page.waitForTimeout(300);
      for (const cat of CATS) { await showCat(page, cat); await check("设置·" + cat, "#page-settings"); }
      await page.click('#rail button[data-view="me"]'); await page.waitForTimeout(300);
      // …and a page is as wide as the window lets it be: the diagnosis was
      // cut at 460px
      if (w >= 1024) {
        await page.click('#rail button[data-view="library"]'); await page.waitForTimeout(200);
        await page.click("#lib-diagnose"); await page.waitForTimeout(700);
        const cw = await page.evaluate(() => Math.round(document.querySelector("#lib-modal .modal").getBoundingClientRect().width));
        assert(cw >= 900, tag + ": 诊断是整页宽(" + cw + "px),不再是 460px 的弹窗");
        await page.keyboard.press("Escape");
      }
      assert(errs.length === 0, tag + ": 没有页面异常 " + errs.join(" / "));
      await ctx.close();
    }
  }

  // 9.0 S1: 今天 in the third language too (the page above is zh-CN / en only)
  for (const [w, h] of [[1024, 768], [1440, 900], [600, 900]]) {
    const tag = w + "x" + h + "/ja";
    const { ctx, page, errs } = await open("ja", "ai", "home", "wood", { width: w, height: h });
    await page.evaluate(seedTodayStats);
    await page.reload();
    await page.waitForTimeout(900);
    const o = await page.evaluate(() => ({ doc: document.scrollingElement.scrollWidth - innerWidth,
      own: document.getElementById("page-home").scrollWidth - document.getElementById("page-home").clientWidth }));
    assert(o.doc <= 0 && o.own <= 0, tag + ": 今天页没有横向滚动 (" + JSON.stringify(o) + ")");
    await todayChecks(tag, page);
    assert(errs.length === 0, tag + ": 没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
}

// --- v8-0-plan B5: 我的 with everything on it, in three languages -----------
// The progress page filled: the rating curve, the calendar, strengths and
// weaknesses and the three cross-game figures, whose sentences are the
// longest things on it (「saved 8 of 12 games after being 2 pawns down, 4 of
// them won」). At the five widths A2 measures and in all three languages: no
// horizontal scroll, nothing past the page's right edge, no heading running
// into its figure, and no text cut — the rows wrap rather than truncate.
if (scenario()) {
  const DAY = 864e5, now = Date.now();
  const games = Array.from({ length: 24 }, (_, i) => {
    const clk = [];
    for (let j = 0; j < 20; j++) clk.push(j < 16 ? 170 - 10 * j : [15, 12, 8, 4][j - 16], 180);
    return { id: "g" + i, t: now - (i % 12) * 2 * DAY, white: "hxddh", black: "rival" + i, date: "", event: "", result: "1-0",
      plies: 40, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: ["win", "draw", "loss"][i % 3], clk,
      eco: i % 2 ? "C50" : "B01", ecoName: i % 2 ? "Italian Game" : "Scandinavian Defense", motifs: { 36: "fork" },
      an: { acc: { w: 80, b: 70 }, acpl: { w: 30, b: 40 }, tags: Array.from({ length: 40 }, (_, k) => (k === 36 ? "??" : null)),
        scalars: Array.from({ length: 41 }, (_, k) => (k === 20 ? (i % 2 ? 300 : -300) : 0)), losses: new Array(40).fill(10), bests: [], budget: 200 } };
  });
  const th = (r, s, m) => ({ solve: s, miss: m, rating: { r, rd: 80, vol: 0.06 } });
  const seed = {
    "chess.library": { v: 1, names: ["hxddh"], games },
    "chess.stats": { v: 2, games: Array.from({ length: 12 }, (_, i) => ({ id: "s" + i, t: now - (12 - i) * DAY, diff: "normal",
      color: "w", result: i % 2 ? "win" : "loss", moves: 40, pgn: "", ending: "", ra: 1450 + i * 9 })) },
    "chess.puzzles": { v: 1, solved: {}, tally: { tac: { miss: 3, solve: 9 } }, rhist: [{ t: now - DAY, r: 1500 }, { t: now, r: 1520 }],
      themes: { fork: th(1700, 6, 1), pin: th(1350, 2, 4), skewer: th(1550, 4, 2), discoveredAttack: th(1600, 5, 2), backRank: th(1420, 3, 3), m1: th(1800, 9, 0) } },
  };
  for (const [w, h] of [[1024, 768], [1280, 800], [1440, 900], [1920, 1080], [600, 900]]) {
    for (const lang of LANGS) {
      const tag = "B5 " + w + "x" + h + "/" + lang;
      const { ctx, page, errs } = await open(lang, "ai", "me", "wood", { width: w, height: h });
      const { "chess.library": seedLib, ...seedKeys } = seed;
      await page.evaluate((ks) => { for (const [k, v] of Object.entries(ks)) localStorage.setItem(k, JSON.stringify(v)); }, seedKeys);
      await page.evaluate(seedLibrary, seedLib);
      await page.reload();
      await page.waitForTimeout(1200);
      const r = await page.evaluate(() => {
        const root = document.getElementById("page-me");
        const sec = document.getElementById("sec-growth");
        const shown = (e) => e.getClientRects().length > 0;
        const edge = root.getBoundingClientRect().right;
        const past = [...root.querySelectorAll("*")].filter(shown)
          .filter((e) => e.getBoundingClientRect().right > edge + 1)
          .map((e) => (e.id || e.className || e.tagName) + "@" + Math.round(e.getBoundingClientRect().right));
        const cut = [...sec.querySelectorAll(".me-k, .me-v, .me-sw-h, .hint, .side-h, .side-h-meta")].filter(shown)
          .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > sec.getBoundingClientRect().right + 0.5)
          .map((e) => e.textContent.trim().slice(0, 24) + " " + e.scrollWidth + ">" + e.clientWidth);
        // a heading and its figure share a row: neither may run into the other
        const clash = [...sec.querySelectorAll(".side-h-row")].filter(shown).filter((row) => {
          const [a, b] = [row.querySelector(".side-h"), row.querySelector(".side-h-meta")];
          return a && b && shown(b) && a.getBoundingClientRect().right > b.getBoundingClientRect().left + 0.5;
        }).map((row) => row.id);
        return {
          on: shown(sec), blocks: ["me-cal", "me-rating", "me-sw", "me-metrics"].filter((id) => shown(document.getElementById(id))).length,
          doc: document.scrollingElement.scrollWidth - innerWidth, own: root.scrollWidth - root.clientWidth,
          past: past.slice(0, 4), cut: cut.slice(0, 4), clash,
        };
      });
      assert(r.on && r.blocks === 4, tag + ": 成长一节四块都在(" + r.blocks + ")");
      assert(r.doc <= 0 && r.own <= 0 && r.past.length === 0, tag + ": 「我的」没有横向滚动,也没有东西伸出右缘(" + JSON.stringify(r) + ")");
      assert(r.cut.length === 0 && r.clash.length === 0, tag + ": 成长一节没有被截断的字,标题不压着数字(" + JSON.stringify({ cut: r.cut, clash: r.clash }) + ")");
      assert(errs.length === 0, tag + ": 没有页面异常 " + errs.join(" / "));
      await ctx.close();
    }
  }
}

// --- v8-0-plan §2 A2: the play view stretches with its window ---------------
// The acceptance, at the five sizes the plan names, measured by the same probe
// scripts/measure-layout.mjs records with (scripts/lib/layout-probe.mjs has
// the definitions). "Before" is docs/measured.json layoutA2.before, measured
// on 107838a: at 1920×1080 a 258px band either side of the board, 1440×900
// the notation's two columns 144px apart and the transport bar 380px under
// the last row, 600×900 a drawer whose first screen held no full row.
const A2_ITALIAN = ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6", "f1", "c4", "f8", "c5", "c2", "c3", "g8", "f6", "d2", "d4", "e5", "d4"];
const A2_SIZES = [[1024, 768], [1280, 800], [1440, 900], [1920, 1080], [600, 900]];
// a game long enough to fill any column: 120 legal plies from a fixed seed
const a2LongPgn = async () => {
  const { Chess } = await import("../src/web/js/chess.js");
  let s = 7;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
  const g = new Chess();
  while (g.history().length < 120 && !g.game_over()) { const m = g.moves(); g.move(m[Math.floor(rnd() * m.length)]); }
  return '[Event "A2"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n' + g.pgn() + " *\n";
};
const a2Paste = async (page, pgn) => {
  await page.evaluate((p) => {
    Object.defineProperty(navigator, "clipboard", { configurable: true,
      value: { readText: () => Promise.resolve(p), writeText: () => Promise.resolve() } });
  }, pgn);
  if (!(await page.isVisible("#pgn-paste"))) { await page.click("#more-tools"); await page.waitForTimeout(250); }
  await page.click("#pgn-paste");
  await page.waitForTimeout(900);
  if (await page.isVisible("#confirm-modal.show").catch(() => false)) { await page.click("#confirm-ok"); await page.waitForTimeout(600); }
};
if (scenario()) {
  const before = JSON.parse(fs.readFileSync(path.join(HERE, "..", "docs", "measured.json"), "utf8")).layoutA2.before;
  for (const [w, h] of A2_SIZES) {
    const { ctx, page, errs } = await open("zh-CN", "pvp", "play", "wood", { width: w, height: h });
    for (const sq of A2_ITALIAN) await mv(page, sq);
    await page.waitForTimeout(400);
    let m = await page.evaluate(layoutProbe);
    // 9.0 M3: a portrait drawer's list is its nine tenths' — the bar under
    // it is measured there (the half stop has the strip instead)
    if (w < h) {
      await page.evaluate(() => document.getElementById("app").classList.add("sheet-full"));
      await page.waitForTimeout(500);
      m.nav = (await page.evaluate(layoutProbe)).nav;
    }
    const was = before[w + "x" + h];
    const at = `A2 ${w}×${h}：`;
    // M2 (A1 × A2): beside the 64px rail the wide layout fits only 1920 of
    // the five; at 1280 / 1440 the two-column panel takes the board's
    // leftover instead (styles.css #app --side-w), so the band holds there too
    assert(m.band <= 48, at + `非内容空带 ${m.band}px ≤ 48（之前 ${was.band}）`);
    assert(m.share >= was.share, at + `棋盘占比 ${m.share} ≥ 之前的 ${was.share}（边长 ${was.board} → ${m.board}）`);
    // …and of the whole window, rail included: the rail is not paid for
    // with board (before, window and play view were the same box)
    assert(m.shareWin >= was.share, at + `棋盘占整个窗口 ${m.shareWin} ≥ 之前的 ${was.share}`);
    assert(m.nav != null && m.nav >= 0 && m.nav <= 16, at + `翻谱栏在最后一行棋谱下 ${m.nav}px（≤ 16；之前 ${was.nav}）`);
    if (w === 1440) assert(m.gutter != null && m.gutter <= 40, at + `棋谱两列间距 ${m.gutter}px（≤ 40；之前 ${was.gutter}）`);
    // the rule is the play view's (window less the rail), not the window's
    assert(!m.wide || (m.view.w >= 1280 && m.view.w > m.view.h), at + "宽布局只在下棋视图 ≥ 1280 的横窗里（" + m.wide + "，视图 " + m.view.w + "）");
    assert(m.wide === (w === 1920), at + "五档里只有 1920 的下棋视图（1856）放得下宽布局（" + m.wide + "）");
    if (w < h) {
      // the drawer's first screen: the move on the board is on it, whole
      const s = await page.evaluate(() => {
        const strip = document.getElementById("move-strip");
        const cur = strip.querySelector(".ms-move.current");
        const r = (e) => e.getBoundingClientRect();
        if (!cur) return null;
        const c = r(cur), b = r(strip);
        return { text: cur.textContent, inStrip: c.left >= b.left - 0.5 && c.right <= b.right + 0.5,
                 inView: c.top >= 0 && c.bottom <= innerHeight, stripTop: b.top, sideTop: r(document.getElementById("side")).top,
                 // 9.0 S5: no tab row — the pane follows the strip directly
                 tabsTop: r(document.getElementById("pane-play")).top };
      });
      assert(!!s && s.inStrip && s.inView && s.text === "exd4",
        at + "抽屉第一屏就有棋谱：当前一着 exd4 整个在横条里、在窗口里（" + JSON.stringify(s) + "）");
      assert(!!s && s.stripTop < s.tabsTop, at + "…横条在面板（唯一一页）之上，是抽屉的第一行");
      assert(m.first > was.first, at + `第一屏不滚动看得见的着法格 ${was.first} → ${m.first}`);
    }
    assert(errs.length === 0, at + "no JS exception — " + errs.join(" / "));
    await ctx.close();
  }
}

// A long game: the list shrinks and scrolls, the bar stays under its last row
// and on screen without scrolling the page; in portrait the strip scrolls to
// the move on the board.
if (scenario()) {
  const pgn = await a2LongPgn();
  for (const [w, h] of [[1440, 900], [1024, 768], [600, 900]]) {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: w, height: h });
    await a2Paste(page, pgn);
    // diagnosis only (WebKit 1024×768): a frame-by-frame record of the list
    // from the End press on — scrollTop, scrollHeight, the current row's top,
    // and every row that changed size — printed when the check fails
    await page.evaluate(() => {
      const list = document.getElementById("move-list");
      const log = window.__mlLog = [];
      const t0 = performance.now();
      const snap = (why) => { const c = list.querySelector(".current"); log.push([Math.round(performance.now() - t0), why, list.scrollTop, list.scrollHeight, list.clientHeight, c ? Math.round(c.getBoundingClientRect().top - list.getBoundingClientRect().top) : null]); };
      new ResizeObserver((es) => snap("ro" + es.length)).observe(list);
      const rows = new ResizeObserver((es) => snap("row" + es.length + ":" + es.map((e) => Math.round(e.contentRect.height * 10) / 10).slice(0, 3).join("/")));
      for (const r of list.children) rows.observe(r);
      new MutationObserver(() => { for (const r of list.children) rows.observe(r); snap("mo"); }).observe(list, { childList: true, subtree: true });
      list.addEventListener("scroll", () => snap("scroll"));
      let n = 0;
      const tick = () => { snap("raf"); if (++n < 30) requestAnimationFrame(tick); };
      window.__mlStart = () => { log.length = 0; n = 0; requestAnimationFrame(tick); };
    });
    await page.evaluate(() => window.__mlStart());
    await page.keyboard.press("End");
    await page.waitForTimeout(300);
    const measure = () => page.evaluate(() => {
      const box = (e) => e.getBoundingClientRect();
      const list = document.getElementById("move-list"), bar = document.getElementById("replay-seg");
      const pane = document.getElementById("pane-play");
      const cur = list.querySelector(".current");
      const L = box(list), B = box(bar), P = box(pane);
      const strip = document.getElementById("move-strip");
      const sc = strip.querySelector(".ms-move.current");
      return { rows: list.querySelectorAll(".mlrow").length, scrolls: list.scrollHeight > list.clientHeight + 1,
               barInPane: B.top >= P.top - 0.5 && B.bottom <= P.bottom + 0.5, paneTop: pane.scrollTop,
               curInList: !!cur && box(cur).top >= L.top - 0.5 && box(cur).bottom <= L.bottom + 0.5,
               curBox: cur ? [Math.round(box(cur).top), Math.round(box(cur).bottom), cur.textContent] : null,
               listBox: [Math.round(L.top), Math.round(L.bottom), list.scrollTop, list.scrollHeight, list.clientHeight],
               nav: B.top - L.bottom,
               stripCur: sc ? box(sc).right <= box(strip).right + 0.5 && box(sc).left >= box(strip).left - 0.5 : null };
    });
    let r = await measure();
    const stripCur = r.stripCur;
    // 9.0 M3: in a portrait drawer the strip is the half stop's notation and
    // the list the nine tenths' — the list is measured there
    if (w < h) {
      await page.evaluate(() => document.getElementById("app").classList.add("sheet-full"));
      await page.waitForTimeout(500);
      r = await measure();
    }
    const at = `A2 ${w}×${h} 120 手：`;
    assert(r.rows >= 60, at + "棋谱有 " + r.rows + " 行");
    if (!r.curInList) console.error("A2 timeline " + at + JSON.stringify(await page.evaluate(() => window.__mlLog.filter((e, i, a) => i === 0 || e.slice(2).join() !== a[i - 1].slice(2).join() || e[1] !== "raf"))));
    assert(r.curInList, at + "当前一着在棋谱的可见范围里（" + JSON.stringify({ cur: r.curBox, list: r.listBox }) + "）");
    assert(r.nav >= 0 && r.nav <= 16, at + "翻谱栏紧跟棋谱（" + r.nav + "px）");
    if (w > h) {
      assert(r.scrolls, at + "棋谱自己滚动");
      assert(r.barInPane && r.paneTop === 0, at + "翻谱栏不用滚动面板就在屏上（" + JSON.stringify(r) + "）");
    } else {
      assert(stripCur === true, at + "横条滚到了当前一着");
    }
    await ctx.close();
  }
}

// The table: White's column as wide as its widest move, both columns lined
// up from row to row, every other row shaded, and a variation hung off a
// vertical rule, indented. And in portrait a press on the strip is a press
// on the list.
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1440, height: 900 });
  await a2Paste(page, '[Event "A2"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 (1... c5 2. Nf3 d6) 2. Nf3 Nc6 3. Bb5 a6 4. Bxc6 dxc6 *\n');
  const t = await page.evaluate(() => {
    const box = (e) => e.getBoundingClientRect();
    const rows = [...document.querySelectorAll("#move-list > .mlrow")];
    const whites = rows.map((r) => r.querySelector(".mlnum + .mlmove")).filter((e) => e && !e.classList.contains("mlgap"));
    const blacks = rows.map((r) => [...r.querySelectorAll(".mlmove")][1]).filter(Boolean);
    const v = document.querySelector("#move-list > .mlvar");
    const cs = v ? getComputedStyle(v) : null;
    const lefts = (xs) => [...new Set(xs.map((e) => Math.round(box(e).left)))];
    return { rows: rows.length, whiteLefts: lefts(whites), blackLefts: lefts(blacks),
             widest: Math.max(...whites.map((e) => box(e).width)), blackLeft: Math.min(...blacks.map((e) => box(e).left)),
             whiteLeft: Math.min(...whites.map((e) => box(e).left)),
             bg: rows.map((r) => getComputedStyle(r).backgroundColor),
             v: v ? { rule: parseFloat(cs.borderLeftWidth), style: cs.borderLeftStyle, colour: cs.borderLeftColor,
                      indent: box(v).left - box(document.getElementById("move-list")).left } : null };
  });
  assert(t.whiteLefts.length === 1 && t.blackLefts.length === 1,
    "A2：棋谱每一行的白、黑两列左缘对齐（白 " + t.whiteLefts.join("/") + "，黑 " + t.blackLefts.join("/") + "）");
  assert(Math.abs(t.blackLeft - (t.whiteLeft + t.widest + 2)) <= 1,
    "A2：白列宽 = 最宽的白方着法（黑列从 " + Math.round(t.blackLeft) + " 起，白列 " + Math.round(t.whiteLeft) + " + " + Math.round(t.widest) + " + 2）");
  const shaded = t.bg.filter((c) => c !== "rgba(0, 0, 0, 0)").length;
  assert(t.rows >= 4 && shaded >= 1 && shaded < t.rows, "A2：隔行加底色（" + t.bg.join(" | ") + "）");
  assert(!!t.v && t.v.rule >= 1 && t.v.style === "solid" && t.v.colour !== "rgba(0, 0, 0, 0)" && t.v.indent >= 16,
    "A2：变着缩进、挂在一条竖线上（" + JSON.stringify(t.v) + "）");
  await ctx.close();

  const p = await open("zh-CN", "pvp", "play", "wood", { width: 600, height: 900 });
  for (const sq of A2_ITALIAN.slice(0, 8)) await mv(p.page, sq);
  await p.page.waitForTimeout(300);
  await p.page.click('#move-strip .ms-move >> nth=1');
  await p.page.waitForTimeout(300);
  const after = await p.page.evaluate(() => ({
    list: (document.querySelector("#move-list .mlmove.current") || {}).textContent,
    strip: (document.querySelector("#move-strip .ms-move.current") || {}).textContent,
    pos: document.getElementById("replay-pos").textContent.trim(),
    focusable: [...document.querySelectorAll("#move-strip button")].every((b) => b.tabIndex === -1),
    hidden: document.getElementById("move-strip").getAttribute("aria-hidden") }));
  assert(after.list === "e5" && after.strip === "e5" && after.pos.startsWith("2"),
    "A2 600×900：点横条上的 e5，棋谱和横条都停在 e5（" + JSON.stringify(after) + "）");
  assert(after.focusable && after.hidden === "true", "A2：横条是指针用的镜像，不进 Tab 顺序、不给读屏重复一遍");
  await p.ctx.close();
}

// The wide layout's info column, and the 7.7 invariants re-proved in it.
// 7.7 §1g said "the panel's width is a function of the window and of nothing
// else" and §2 "the strips hug the board's top and bottom edges". A2 keeps the
// first — the panel is a function of the play view's size (width AND height
// now: the board is height-bound and the panel takes what it leaves), never
// of a tab, a mode or the content — and replaces the second for the wide
// layout: the strips are the info column's top and bottom cards, flush with
// the board's top and bottom edges, one --info-gap to its left.
// (M2: a 1504×900 window, whose play view beside the 64px rail is the
// 1440×900 the branch measured without one. 9.0 V3: the top bar's 32px went
// to the board, and at 1440×900 the two-column board (816) is now the larger
// one, so the wide layout starts at a 1463px view: 1664×900, view 1600×900.)
if (scenario()) {
  const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: 1664, height: 900 });
  for (const sq of A2_ITALIAN) await mv(page, sq);
  await page.waitForTimeout(300);
  const read = () => page.evaluate(() => {
    const box = (e) => { const b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width }; };
    const top = document.querySelector(".pstrip.at-top"), bot = document.querySelector(".pstrip.at-bottom");
    const tools = [...document.querySelectorAll("#strip-tools button")].filter((b) => getComputedStyle(b).visibility === "visible").map(box);
    return { wide: document.getElementById("app").classList.contains("pv-wide"),
             wrap: box(document.getElementById("board-wrap")), board: box(document.getElementById("board")),
             top: box(top), bot: box(bot), topId: top.id, side: box(document.getElementById("side")),
             toolsIn: tools.length === 3 && tools.every((b) => b.l >= box(top).l && b.r <= box(top).r && b.t >= box(top).t && b.b <= box(top).b),
             opening: (() => { const o = document.getElementById("info-opening"); return o.hidden ? null : { text: o.textContent, ...box(o) }; })(),
             panelOpening: getComputedStyle(document.getElementById("opening-line")).display,
             gap: parseFloat(getComputedStyle(document.getElementById("app")).getPropertyValue("--info-gap")) };
  });
  const r = await read();
  assert(r.wide, "A2 1664×900（下棋视图 1600×900）：宽布局");
  assert(Math.abs(r.top.t - r.wrap.t) <= 1 && Math.abs(r.bot.b - r.wrap.b) <= 1,
    "A2：对手卡片顶 = 棋盘外框顶，自己的卡片底 = 棋盘外框底（" + [r.top.t, r.wrap.t, r.bot.b, r.wrap.b].map(Math.round).join(" / ") + "）");
  assert([r.top, r.bot].every((c) => Math.abs(c.r - (r.wrap.l - r.gap)) <= 1 && c.l >= 0),
    "A2：两张卡片在棋盘左边一个 --info-gap 处，在窗口里");
  assert(r.toolsIn, "A2：悔棋 / 提示 / ☰ 在对手的卡片里");
  assert(!!r.opening && r.opening.text.startsWith("C54") && r.opening.r <= r.wrap.l && r.opening.t > r.top.b && r.opening.b < r.bot.t,
    "A2：开局名在两张卡片之间（" + JSON.stringify(r.opening) + "）");
  assert(r.panelOpening === "none", "A2：…面板里那一行让位，不说两遍");
  await page.keyboard.press("f");
  await page.waitForTimeout(300);
  const flipped = await read();
  assert(flipped.topId === "strip-w" && Math.abs(flipped.top.t - flipped.wrap.t) <= 1, "A2：翻转棋盘，白方的卡片到上面");
  await page.keyboard.press("f");
  await page.keyboard.press("p");
  await page.waitForTimeout(400);
  const shut = await read();
  // shut, the board may take the panel's room (as in the two-column layout
  // since 7.x) and the column goes with it
  assert(shut.wide && shut.board.w >= r.board.w && Math.abs(shut.top.t - shut.wrap.t) <= 1 &&
    Math.abs(shut.top.r - (shut.wrap.l - shut.gap)) <= 1 && shut.top.l >= 0,
    "A2：宽布局里收起面板，棋盘不变小，信息栏仍贴着它（" + r.board.w + " → " + shut.board.w + "）");
  await ctx.close();

  // the panel's width, by the play view's size and nothing else — the same
  // at every tab and in every mode, and different sizes give different
  // widths only through the rule (a taller window, a bigger board, a
  // narrower panel)
  for (const [w, h] of [[1440, 900], [1920, 1080], [1280, 800]]) {
    const seen = new Map();
    // 9.0 S5: the 设置 tab is the settings page (laid over the board)
    for (const [mode, tab] of [["ai", "play"], ["ai", "settings"], ["ai", "record"], ["pvp", "play"], ["learn", "play"], ["puzzle", "play"]]) {
      const o = await open("zh-CN", mode, tab, "wood", { width: w, height: h });
      const s = await o.page.evaluate(() => {
        const b = document.getElementById("board").getBoundingClientRect();
        return JSON.stringify({ side: document.getElementById("side").getBoundingClientRect().width, board: [b.left, b.top, b.width] });
      });
      seen.set(mode + "/" + tab, s);
      await o.ctx.close();
    }
    const distinct = [...new Set(seen.values())];
    assert(distinct.length === 1, `A2 ${w}×${h}：面板宽度与棋盘矩形在面板、设置页、我的、四种模式下都相同（${[...seen].map(([k, v]) => k + " " + v).join(" · ")}）`);
  }
}

// The cards at their narrowest (a 1320×800 play view — 9.0 V3: the
// narrowest that is wide at 800 high now the top bar's 32px is the board's), in three
// languages, with a persona, a clock and both tools: nothing overflows a card
// and no two of its pieces lie on each other (the same pairwise test as 5c).
// (M2: the window is 1384×800, the play view beside the 64px rail 1320×800.)
if (scenario()) {
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play", "wood", { width: 1384, height: 800 });
    // 9.0 S5: style and clock are chosen in the new-game dialog
    await openNewGame(page);
    await page.click('#newgame-modal #persona-seg button[data-persona="principled"]');
    await page.click('#newgame-modal #clock-seg-more button[data-tc="3+2"]');
    await startNewGame(page);
    const r = await page.evaluate(() => [...document.querySelectorAll(".pstrip")].map((s) => {
      const leaves = [...s.querySelectorAll("*")]
        .filter((e) => e.offsetParent && !e.children.length && e.getBoundingClientRect().width > 0 && getComputedStyle(e).visibility === "visible")
        .map((e) => ({ t: (e.textContent || e.id).trim().slice(0, 8), r: e.getBoundingClientRect() }));
      const hits = [];
      for (let i = 0; i < leaves.length; i++) for (let j = i + 1; j < leaves.length; j++) {
        const a = leaves[i].r, b = leaves[j].r;
        if (a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5) hits.push(leaves[i].t + "/" + leaves[j].t);
      }
      const box = s.getBoundingClientRect();
      const out = leaves.filter((l) => l.r.left < box.left - 0.5 || l.r.right > box.right + 0.5).map((l) => l.t);
      return { id: s.id, wide: document.getElementById("app").classList.contains("pv-wide"), over: s.scrollWidth - s.clientWidth, hits, out };
    }));
    for (const c of r) {
      assert(c.wide && c.over <= 0 && c.hits.length === 0 && c.out.length === 0,
        `A2 ${lang} 1384×800（视图 1320×800）：${c.id} 卡片里没有溢出、没有叠在一起的东西（${JSON.stringify(c)}）`);
    }
    await ctx.close();
  }
}

// The layout is decided by the play view's own box, not the window's: the
// navigation rail beside it (v8-0-plan A1, 64px from 821px wide) takes width
// the play view does not have. With the real rail (the branch simulated it by
// narrowing #app): a 1340 window is a 1276 play view and stays two-column, a
// 1600 one is 1536 and goes wide — and whichever it is, the rail, the board
// and the panel sit side by side without overlapping.
if (scenario()) {
  for (const [w, wide] of [[1340, false], [1600, true]]) {
    const { ctx, page } = await open("zh-CN", "pvp", "play", "wood", { width: w, height: 900 });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const a = document.getElementById("app");
      const box = (id) => document.getElementById(id).getBoundingClientRect();
      const col = [...document.querySelectorAll(".pstrip, #info-col > *")].filter((e) => e.getBoundingClientRect().width > 0)
        .map((e) => e.getBoundingClientRect().left);
      return { wide: a.classList.contains("pv-wide"), pv: a.style.getPropertyValue("--pv-w"),
               stage: document.querySelector("#app > .stage").clientWidth, railR: box("rail").right,
               sideR: box("side").right, wrapR: box("board-wrap").right, wrapL: box("board-wrap").left, sideL: box("side").left,
               colL: col.length ? Math.min(...col) : null };
    });
    assert(r.stage === w - 64 && r.pv === r.stage + "px",
      `A1 × A2：窗口 ${w} 的下棋视图是去掉 64px 导航栏的 ${r.stage}，--pv-w 量的就是它（${r.pv}）`);
    assert(r.wide === wide, `A2：窗口 ${w}、下棋视图 ${r.stage} → ${wide ? "" : "不"}用宽布局（按视图自己的宽度）`);
    assert(r.sideR <= w + 0.5 && r.wrapR <= r.sideL + 0.5 && r.wrapL >= r.railR && (r.colL == null || r.colL >= r.railR - 0.5),
      `A1 × A2：导航栏、信息栏、棋盘、面板左右排开互不压盖（栏右缘 ${Math.round(r.railR)}，信息栏左缘 ${r.colL == null ? "-" : Math.round(r.colL)}，棋盘 ${Math.round(r.wrapL)}–${Math.round(r.wrapR)}，面板 ${Math.round(r.sideL)}–${Math.round(r.sideR)}）`);
    await ctx.close();
  }
}

// --- v8-0-plan A4：复盘视图在 M2 的三种布局里 ----------------------------------
// The health report has to live inside whatever the play view is: the wide
// three-column layout (1920), the two-column one (1440) and portrait (600).
// In each, flat and framed: the eval bar is level with the board's frame (it
// ran from the squares' top edge — frame y=72, bar y=89 at 1440×900 with the
// wood frame), it lies on nothing else (rail, info column, panel), and the
// report fits its column — nothing past the panel's edge, no sideways scroll.
if (scenario()) {
  for (const vp of [{ width: 1920, height: 1080 }, { width: 1440, height: 900 }, { width: 600, height: 900 }]) {
    const { ctx, page, errs } = await open("en", "pvp", "play", "wood", vp);
    await playOpera(page);
    await analyseOpera(page);
    await page.evaluate(() => {
      document.getElementById("rep-start").click();
      for (let i = 0; i < 18; i++) document.getElementById("rep-next").click();
      // 9.0 M2: the report card is in the folded 完整报告 — open, so the
      // fit below measures it too
      document.getElementById("rv-full").open = true;
    });
    await page.waitForTimeout(300);
    for (const frame of ["flat", "frame"]) {
      await page.evaluate((f) => document.querySelector('#frame-seg button[data-frame="' + f + '"]').click(), frame);
      await page.waitForTimeout(400);
      const r = await page.evaluate(() => {
        const box = (e) => e.getBoundingClientRect();
        const w = box(document.getElementById("board-wrap")), b = box(document.getElementById("eval-bar"));
        const hit = (a, c) => !(a.right <= c.left || a.left >= c.right || a.bottom <= c.top || a.top >= c.bottom);
        const others = [document.getElementById("rail"), document.getElementById("side"),
          ...document.querySelectorAll("#info-col > *, .pstrip")].filter((e) => e && e.offsetParent && box(e).width > 0);
        const side = document.getElementById("side");
        const sr = box(side);
        const past = [...document.querySelectorAll("#eval-wrap *")].filter((e) => e.offsetParent && box(e).width > 0 && box(e).right > sr.right + 1)
          .map((e) => e.id || e.className);
        return { layout: document.getElementById("app").classList.contains("pv-wide") ? "wide" : "two",
          wt: w.top, wb: w.bottom, bt: b.top, bb: b.bottom, bl: b.left,
          num: (() => { const n = box(document.getElementById("eval-bar-text")); return { l: n.left, w: n.width, r: n.right }; })(),
          on: others.filter((e) => hit(b, box(e))).map((e) => e.id || e.className),
          inset: document.getElementById("eval-bar-row").classList.contains("is-inset"),
          scroll: side.scrollWidth - side.clientWidth, past,
          km: !!document.getElementById("rv-km") && !document.getElementById("rv-km").hidden, report: !document.getElementById("report-card").hidden };
      });
      const tag = `${vp.width}×${vp.height} ${frame}（${r.layout}${r.inset ? "，贴框内" : ""}）`;
      assert(Math.abs(r.bt - r.wt) <= 1 && Math.abs(r.bb - r.wb) <= 1,
        `A4：${tag} 评估条与棋盘外框上下对齐（框 ${Math.round(r.wt)}–${Math.round(r.wb)}，条 ${Math.round(r.bt)}–${Math.round(r.bb)}）`);
      assert(r.bl >= 0 && r.on.length === 0, `A4：${tag} 评估条不压导航栏、信息栏、面板（${r.on.join(", ") || "无"}）`);
      assert(r.num.w <= 1 || (r.num.l >= 0 && r.num.r <= vp.width),
        `A4：${tag} 评估条的分数要么整个在窗口里，要么交给曲线和读屏（${Math.round(r.num.l)}–${Math.round(r.num.r)}）`);
      assert(r.report && r.km && r.scroll <= 0 && r.past.length === 0,
        `A4：${tag} 体检报告与关键时刻都在，面板里没有越界、没有横向滚动（${r.scroll}px${r.past.length ? "，越界 " + r.past.join(", ") : ""}）`);
    }
    assert(errs.length === 0, `A4：${vp.width}×${vp.height} 没有页面异常 — ` + errs.join(" / "));
    await ctx.close();
  }
}
// --- v8-1-plan T5: the diagnosis's source row, the filters' ruler -----------
// 导入的 / 本机 / 全部 is a segmented control like the list's five: a label you
// can see, one line tall, segments equal to the raw pixel, no word out of its
// button — in three languages, at the widest window and the narrowest. And
// the note it adds under 本机 does not push the dialog sideways.
if (scenario()) {
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 700 }]) {
      const { ctx, page, errs } = await open(lang, "ai", "library", "wood", viewport);
      await page.evaluate(() => {
        const games = [];
        for (let i = 0; i < 20; i++) {
          games.push({ id: "t5-" + i, t: Date.now() - (i + 1) * 36e5, diff: "normal", color: i % 2 ? "b" : "w",
            result: i % 2 ? "loss" : "win", moves: 4, acc: 50 + i, pgn: i % 2 ? "1. d4 d5 2. c4 e6" : "1. e4 e5 2. Nf3 Nc6", ending: "resigned" });
        }
        localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games }));
      });
      await page.reload();
      await page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready, null, { timeout: 20000 }).catch(() => {});
      await page.waitForTimeout(600);
      await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
      await page.click('#rail button[data-view="library"]', { timeout: 1500 }).catch(() => {});
      await page.click("#lib-diagnose", { timeout: 2500 }).catch(() => {});
      await page.waitForTimeout(500);
      await page.click('#diag-src-seg [data-dsrc="local"]', { timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(500);
      const r = await page.evaluate(() => {
        const seg = document.getElementById("diag-src-seg");
        const label = document.getElementById(seg.getAttribute("aria-labelledby"));
        const bs = [...seg.querySelectorAll("button")];
        const modal = document.querySelector("#lib-modal .modal");
        return { open: document.getElementById("lib-modal").classList.contains("show"),
          label: label && label.offsetParent ? label.textContent.trim() : null, stray: seg.getAttribute("aria-label"),
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
          widths: bs.map((b) => b.getBoundingClientRect().width),
          spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
          sideways: modal.scrollWidth - modal.clientWidth,
          past: bs.filter((b) => b.getBoundingClientRect().right > modal.getBoundingClientRect().right + 0.5).length,
          diag: /\d/.test(document.getElementById("lib-diag").textContent) };
      });
      const tag = `T5 诊断来源 (${lang}, ${viewport.width}×${viewport.height})`;
      assert(r.open && r.diag, `${tag}: 对话框开着，读的是本机的棋`);
      assert(r.label && !r.stray, `${tag}: 有一个看得见的标签「${r.label}」，没有第二份 aria-label`);
      assert(r.heights.length === 1 && r.heights[0] < 40, `${tag}: 每一段一行高 (${r.heights.join(", ")})`);
      assert(Math.max(...r.widths) - Math.min(...r.widths) < 0.1, `${tag}: 每一段等宽 (${r.widths.map((w) => w.toFixed(2)).join(", ")})`);
      assert(r.spill.length === 0 && r.past === 0 && r.sideways <= 0,
        `${tag}: 文字不出按钮，按钮不出对话框，对话框不横向滚动 (${r.spill.join(", ") || "—"}; ${r.sideways}px)`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-1-plan T1: the new-game dialog's personas, a segment at a time -------
// Twenty-odd cards were three segments (入门 / 进阶 / 高手) over the grid.
// 9.0 S2: the segments are gone — the grid is a window of eight cards around
// the one picked (opponents-ui SHOWN), every rung and style under 更多选项.
// What T1 asked of the cards still holds of the eight: no name or rating is
// cut and every card sits inside the dialog without a sideways scroll — in a
// wide window and at phone width, in three languages; and now also that the
// window is eight with the pick inside it, and that 更多选项 opened keeps the
// dialog as tidy (its clocks, rungs and styles inside it, no label cut).
// (The three tabs' equal-thirds and one-height checks went with the tabs.)
if (scenario()) {
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 390, height: 700 }]) {
      const { ctx, page, errs } = await open(lang, "ai", "play", "wood", viewport);
      await page.waitForFunction(() => document.querySelectorAll("#op-grid .op-card").length > 8, null, { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => document.getElementById("btn-new").click());
      await page.waitForTimeout(400);
      // this file stubs the engine, whose fault banner then lands over a
      // phone-width dialog's top: out of the way, it is not what is measured
      await page.evaluate(() => { const f = document.getElementById("engine-fault"); if (f) f.style.display = "none"; });
      const measure = () => page.evaluate(() => {
        const modal = document.querySelector("#newgame-modal .modal");
        const mr = modal.getBoundingClientRect();
        const all = [...document.querySelectorAll("#op-grid .op-card")];
        const cards = all.filter((c) => !c.hidden && c.offsetParent);
        const cut = (e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1;
        const outside = (e) => e.getBoundingClientRect().right > mr.right + 0.5 || e.getBoundingClientRect().left < mr.left - 0.5;
        const more = [...document.querySelectorAll("#ng-custom-body button")].filter((b) => b.checkVisibility());
        return {
          ladder: all.length, cards: cards.length,
          picked: cards.filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.op),
          cardSpill: cards.filter((c) => [...c.querySelectorAll(".op-name, .op-meta")].some(cut)).map((c) => c.dataset.op),
          past: cards.filter(outside).length,
          more: more.length, moreSpill: more.filter(cut).map((b) => b.textContent.trim()), morePast: more.filter(outside).length,
          sideways: modal.scrollWidth - modal.clientWidth,
        };
      });
      const tag = `T1 对手卡 (${lang}, ${viewport.width}×${viewport.height})`;
      const r = await measure();
      assert(r.ladder > 8 && r.cards === 8, `${tag}: 阶梯 ${r.ladder} 位对手里露出 8 张卡 (${r.cards})`);
      assert(r.picked.length === 1, `${tag}: 选中的那位在这 8 张里 (${r.picked.join(", ") || "—"})`);
      assert(r.cardSpill.length === 0 && r.past === 0 && r.sideways <= 0,
        `${tag}: ${r.cards} 张卡片都在对话框里、名字和分数没被截 (${r.cardSpill.join(", ") || "—"}; ${r.sideways}px)`);
      assert(r.more === 0, `${tag}: 「更多选项」收着时里面的按钮一个也不露 (${r.more})`);
      await page.evaluate(() => { document.getElementById("ng-custom").open = true; });
      await page.waitForTimeout(250);
      const o = await measure();
      // 10.0 M0: its buttons are the rarer clocks and the styles (5 + 4); the
      // rungs are the cards, all twenty-one of them now, as tidy as the eight
      assert(o.more >= 9 && o.moreSpill.length === 0 && o.morePast === 0 && o.sideways <= 0,
        `${tag}: 打开「更多选项」，${o.more} 个按钮都在对话框里、字不出按钮、不横向滚动 (${o.moreSpill.join(", ") || "—"}; ${o.sideways}px)`);
      assert(o.cards === 21 && o.cardSpill.length === 0 && o.past === 0,
        `${tag}: …对手卡展开成全部 ${o.cards} 张，都在对话框里、没被截 (${o.cardSpill.join(", ") || "—"})`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-1-plan T3: the explorer's 我的开局书 row, the filters' ruler ----------
// 执白 / 执黑 is a segmented control like the diagnosis's: a label you can see,
// one line tall, segments equal to the raw pixel, no word out of its button;
// the 「加进开局书」 key and the rows with their toggles stay inside the panel —
// in three languages, at the widest window and the narrowest.
if (scenario()) {
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 700 }]) {
      const { ctx, page, errs } = await open(lang, "pvp", "play", "wood", viewport);
      await ctx.addInitScript(() => {
        if (sessionStorage.getItem("t3seed")) return;
        sessionStorage.setItem("t3seed", "1");
        localStorage.setItem("chess.repertoire", JSON.stringify({ v: 1, w: [{ id: "rep-t3a", sans: "e4 e5 Nf3 Nc6 Bb5", eco: "", name: "" },
          { id: "rep-t3b", sans: "d4 d5 c4", eco: "", name: "" }], b: [] }));
      });
      await page.reload();
      await page.waitForFunction(() => window.__chess && window.__chess.rep && window.__chess.rep(), null, { timeout: 20000 }).catch(() => {});
      await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
      await page.click("#explorer-open", { timeout: 1500 }).catch(() => {});
      await page.waitForSelector("#xp-list .xp-mine", { timeout: 5000 }).catch(() => {});
      await page.evaluate(() => document.getElementById("xp-mine-row").scrollIntoView());
      const r = await page.evaluate(() => {
        const seg = document.getElementById("xp-rep");
        const label = document.getElementById(seg.getAttribute("aria-labelledby"));
        const bs = [...seg.querySelectorAll("button")];
        const box = document.getElementById("explorer");
        const inside = [document.getElementById("xp-add"), ...document.querySelectorAll("#xp-list .xp-tog, #xp-list .xp-row")];
        const right = box.getBoundingClientRect().right;
        return { shown: !box.hidden && !document.getElementById("xp-mine-row").hidden,
          mine: document.querySelectorAll("#xp-list .xp-mine").length,
          label: label && label.offsetParent ? label.textContent.trim() : null, stray: seg.getAttribute("aria-label"),
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
          widths: bs.map((b) => b.getBoundingClientRect().width),
          spill: bs.concat(inside.slice(0, 1)).filter((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()),
          past: inside.concat(bs).filter((b) => b.getBoundingClientRect().right > right + 0.5).length,
          sideways: box.scrollWidth - box.clientWidth,
          togH: [...new Set([...document.querySelectorAll("#xp-list .xp-tog")].map((b) => Math.round(b.getBoundingClientRect().height)))] };
      });
      const tag = `T3 我的开局书 (${lang}, ${viewport.width}×${viewport.height})`;
      assert(r.shown && r.mine >= 2, `${tag}: 开局浏览器开着，起始局面 e4、d4 标「我的」(${r.mine})`);
      assert(r.label && !r.stray, `${tag}: 有一个看得见的标签「${r.label}」，没有第二份 aria-label`);
      assert(r.heights.length === 1 && r.heights[0] < 40, `${tag}: 每一段一行高 (${r.heights.join(", ")})`);
      assert(Math.max(...r.widths) - Math.min(...r.widths) < 0.1, `${tag}: 每一段等宽 (${r.widths.map((w) => w.toFixed(2)).join(", ")})`);
      assert(r.togH.length === 1 && r.togH[0] === 32, `${tag}: 每行的开关是小号控件高 (${r.togH.join(", ")})`);
      assert(r.spill.length === 0 && r.past === 0 && r.sideways <= 0,
        `${tag}: 文字不出按钮，按钮与行不出面板，面板不横向滚动 (${r.spill.join(", ") || "—"}; ${r.past}; ${r.sideways}px)`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-1-plan T2: the endgame camp — its 我的 section, its lesson card -----
// In three languages, at the widest window and the narrowest: the section's
// rows one line each, its two buttons one height with their words inside,
// nothing past the page's edge; in 学习, a camp position's card and the
// camp's part of 目录 cut nothing off, and 重来 / 下一个残局 stay one row.
if (scenario()) {
  const seed = JSON.stringify({ v: 1, done: {}, last: 0,
    eg: { done: { "kp-keysq": 1, "dr-vancura": 1 }, srs: { "rp-lucena2": { s: 0, n: 1, due: 1, ivl: 0 } } } });
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 800 }]) {
      const tag = `T2 训练营 (${lang}, ${viewport.width}×${viewport.height})`;
      const { ctx, page, errs } = await open(lang, "learn", "play", "wood", viewport);
      await page.evaluate((s) => localStorage.setItem("chess.learn", s), seed);
      await page.reload();
      await page.waitForTimeout(900);
      await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
      // 9.0 S3: the camp is 训练's 残局 segment; 目录 lists that segment only
      await page.click('#train-seg button[data-seg="endgame"]');
      await page.waitForFunction(() => document.querySelectorAll("#lesson-list button[data-eg]").length === 90, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => {
        const d = document.querySelector("#sec-learn details.reading-index");
        if (d) d.open = true;
        const b = document.querySelector('#lesson-list button[data-eg="rp-lucena2"]');
        if (b) b.click();
      });
      await page.waitForTimeout(400);
      const learn = await page.evaluate(() => {
        const sec = document.getElementById("sec-learn"), box = sec.getBoundingClientRect();
        const out = [];
        for (const e of sec.querySelectorAll("button, .lesson-title, .lesson-task, .lesson-part, #lesson-text p")) {
          if (!e.offsetParent) continue;
          if (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > box.right + 1) out.push(e.textContent.trim().slice(0, 18));
        }
        const row = sec.querySelector(".lesson-controls");
        const bs = [...row.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        return { cut: out, items: sec.querySelectorAll("#lesson-list button[data-eg]").length,
          others: sec.querySelectorAll("#lesson-list .lesson-item:not([data-eg])").length,
          head: document.getElementById("lesson-list-h").textContent,
          title: document.getElementById("lesson-title").textContent,
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))], n: bs.length };
      });
      assert(learn.items === 90 && /·/.test(learn.title), `${tag}: 目录里 90 个，卡片是这个残局（${learn.title}）`);
      assert(learn.others === 0 && /90/.test(learn.head), `${tag}: 目录只列残局这一段（另有 ${learn.others} 项；「${learn.head}」）`);
      assert(learn.cut.length === 0, `${tag}: 学习卡片与目录没有被裁掉的字` + (learn.cut.length ? " — " + learn.cut.join(", ") : ""));
      assert(learn.n === 2 && learn.heights.length === 1, `${tag}: 重来 / 下一个残局 一排、一样高 (${learn.n}; ${learn.heights.join(", ")})`);
      await page.click('#rail button[data-view="me"]', { timeout: 1500 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById("sec-endgame").hidden, null, { timeout: 6000 }).catch(() => {});
      const me = await page.evaluate(() => {
        const sec = document.getElementById("sec-endgame"), box = sec.getBoundingClientRect();
        const rows = [...sec.querySelectorAll(".stat-row")];
        const bs = [...sec.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        const line = (e) => parseFloat(getComputedStyle(e).lineHeight) || 20;
        return { shown: !sec.hidden, meta: document.getElementById("eg-meta").textContent,
          tall: rows.filter((r) => r.getBoundingClientRect().height > line(r) * 1.6).map((r) => r.textContent.trim()),
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
          spill: bs.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 || b.getBoundingClientRect().right > box.right + 1).map((b) => b.textContent.trim()),
          n: bs.length, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      // 9.0 S3: a record, not a second way in — the camp is 训练 · 残局
      assert(me.shown && me.meta === "2/90" && me.n === 0, `${tag}: 「我的」有训练营一节，2/90，没有第二个入口（${me.n} 个按钮）`);
      assert(me.tall.length === 0, `${tag}: 五个主题各一行` + (me.tall.length ? " — " + me.tall.join(", ") : ""));
      assert(me.sideways <= 0, `${tag}: 页面不横向滚动 (${me.sideways}px)`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-2-plan T3: 名局猜着 — its card mid-game and at the end -------------
// In three languages, at the widest window and the narrowest (one game per
// language, the window narrowed and widened again around each look): the card's
// lines (the verdict, the running figures, the biggest deviation) and the
// task strip cut nothing off, its three buttons are one row of one height
// with their words inside, and the page does not scroll sideways. The engine
// is scripted (engine-src.js is a stub here): 1.d4 for Morphy's 1.e4 costs
// 200 cp, every other position is level.
if (scenario()) {
  const OPERA_UCI = ["e2e4", "e7e5", "g1f3", "d7d6", "d2d4", "c8g4", "d4e5", "g4f3", "d1f3", "d6e5", "f1c4", "g8f6",
    "f3b3", "d8e7", "b1c3", "c7c6", "c1g5", "b7b5", "c3b5", "c6b5", "c4b5", "b8d7", "e1c1", "a8d8", "d1d7", "d8d7",
    "h1d1", "e7e6", "b5d7", "f6d7", "b3b8", "d7b8", "d1d8"];
  const xy = (page, sq) => page.evaluate((q) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const probe = (page) => page.evaluate(() => {
    const sec = document.getElementById("sec-learn"), box = sec.getBoundingClientRect();
    const out = [];
    for (const e of sec.querySelectorAll("button, .lesson-title, .lesson-task, #gs-panel p")) {
      if (!e.offsetParent) continue;
      if (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > box.right + 1) out.push(e.textContent.trim().slice(0, 18));
    }
    const strip = document.getElementById("task-strip-text");
    if (strip && strip.offsetParent && strip.scrollWidth > strip.clientWidth + 1) out.push("strip:" + strip.textContent.slice(0, 18));
    const bs = [...document.querySelectorAll("#gs-panel .lesson-controls button")].filter((b) => !b.hidden && b.offsetParent);
    const tops = new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)));
    return { cut: out, n: bs.length, rows: tops.size,
      heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
      spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.trim()),
      mode: (() => { const m = [...document.querySelectorAll("#classic-mode button")].filter((b) => b.offsetParent);
        return { n: m.length, on: (m.find((b) => b.getAttribute("aria-pressed") === "true") || { dataset: {} }).dataset.cmode,
          heights: [...new Set(m.map((b) => Math.round(b.getBoundingClientRect().height)))],
          spill: m.filter((b) => b.scrollHeight > b.clientHeight + 1 || b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent.trim()) }; })(),
      say: (document.getElementById("gs-say") || {}).textContent || "",
      worst: (document.getElementById("gs-worst") || {}).textContent || "",
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  const WIDE = { width: 1400, height: 900 }, NARROW = { width: 520, height: 800 };
  // v8-4-plan T2: per language, the catalog index (10–39) of the game with
  // the longest "white – black" and of the one with the longest intro
  const LONGEST = {};
  {
    const m = loadAppModules(["src/web/js/classics-more.js", "src/web/js/classics-more-en.js", "src/web/js/classics-more-ja.js"]);
    const G = m.CHESS_CLASSICS_MORE_ZH.games;
    for (const lang of LANGS) {
      const tr = (g) => (lang === "en" ? m.CHESS_CLASSICS_MORE_EN : lang === "ja" ? m.CHESS_CLASSICS_MORE_JA : null)?.[g.id] || g;
      const top = (f) => 10 + G.reduce((b, g, i) => (f(tr(g)) > f(tr(G[b])) ? i : b), 0);
      LONGEST[lang] = { title: top((x) => (x.white + x.black).length), intro: top((x) => x.intro.length) };
    }
  }
  /** probe at both sizes, back to the wide one after */
  const both = async (page) => {
    const out = [];
    for (const v of [WIDE, NARROW]) {
      await page.setViewportSize(v);
      await page.waitForTimeout(300);
      out.push([v, await probe(page)]);
    }
    await page.setViewportSize(WIDE);
    await page.waitForTimeout(200);
    return out;
  };
  for (const lang of LANGS) {
    {
      const { ctx, page, errs } = await open(lang, "learn", "play", "wood", WIDE);
      // 9.0 S3: the forty are 训练's 名局 segment, guessed when its switch says 猜着
      await page.click('#train-seg button[data-seg="classic"]');
      await page.waitForTimeout(500);
      await page.click('#classic-mode button[data-cmode="guess"]');
      await page.waitForFunction(() => document.querySelectorAll("#lesson-list button[data-gs]").length === 40, null, { timeout: 8000 }).catch(() => {});
      await page.evaluate(() => {
        window.__chess.engine.isReady = () => true;
        window.__chess.engine.analyze = async (fen) => {
          const turn = fen.split(" ")[1];
          const cpW = fen.startsWith("rnbqkbnr/pppppppp/8/8/3P4/") ? -200 : 0;
          return { cp: turn === "w" ? cpW : -cpW, mate: null, turn, best: null, pv: [], lines: [] };
        };
        document.querySelector("#sec-learn details.reading-index").open = true;
        document.querySelector('#lesson-list button[data-gs="0"]').click();
      });
      const at = (ply, phase = "guess") => page.waitForFunction(([p, ph]) => {
        const e = document.getElementById("gs-panel");
        return !!e && e.dataset.at === String(p) && e.dataset.phase === ph;
      }, [ply, phase], { timeout: 10000 }).then(() => true, () => false);
      let ok = await at(0);
      for (let ply = 0; ok && ply < OPERA_UCI.length; ply += 2) {
        const u = ply === 0 ? "d2d4" : OPERA_UCI[ply];
        for (const sq of [u.slice(0, 2), u.slice(2, 4)]) { const c = await xy(page, sq); await page.mouse.click(c.x, c.y); }
        ok = ply + 2 < OPERA_UCI.length ? await at(ply + 2) : await at(OPERA_UCI.length, "done");
        if (ply === 0 && ok) {
          for (const [v, mid] of await both(page)) {
            const tag = `T3 猜着 (${lang}, ${v.width}×${v.height})`;
            assert(/1\. d4/.test(mid.say), `${tag}: 猜错一步后，判语在卡片上（${mid.say}）`);
            assert(mid.cut.length === 0 && mid.sideways <= 0, `${tag}: 猜到一半，卡片、任务行与任务条没有被裁掉的字，页面不横向滚动` + (mid.cut.length ? " — " + mid.cut.join(", ") : ""));
            // 9.0 S3: 读棋 is 名局's 读谱 / 猜着 switch now, not a button on the card
            assert(mid.n === 1 && mid.rows === 1 && mid.heights.length === 1 && mid.spill.length === 0,
              `${tag}: 猜到一半，换一方 一个按钮、字在框里 (${mid.n}; ${mid.rows} 行; ${mid.heights.join(", ")})`);
            assert(mid.mode.n === 2 && mid.mode.on === "guess" && mid.mode.heights.length === 1 && mid.mode.spill.length === 0,
              `${tag}: 读谱 / 猜着 开关在，停在猜着，一样高、字在框里 (${JSON.stringify(mid.mode)})`);
          }
        }
      }
      assert(ok, `T3 猜着 (${lang}): 一局猜完`);
      for (const [v, end] of await both(page)) {
        const tag = `T3 猜着 (${lang}, ${v.width}×${v.height})`;
        assert(/1\. d4/.test(end.worst), `${tag}: 终局卡有最大偏差（${end.worst}）`);
        assert(end.cut.length === 0 && end.sideways <= 0, `${tag}: 终局卡没有被裁掉的字，页面不横向滚动` + (end.cut.length ? " — " + end.cut.join(", ") : ""));
        assert(end.n === 2 && end.rows === 1 && end.heights.length === 1 && end.spill.length === 0,
          `${tag}: 看这一步 / 换一方 一排、一样高、字在框里 (${end.n}; ${end.rows} 行; ${end.heights.join(", ")}; ${end.spill.join(", ") || "—"})`);
      }
      // v8-4-plan T2: of the forty, the game with the longest names and the
      // one with the longest intro in this language — the card before the
      // first guess (the intro is shown then), and the 40-entry catalog open
      // beside it, at both sizes
      await page.waitForFunction(() => document.querySelectorAll("#lesson-list button[data-gs]").length === 40, null, { timeout: 8000 }).catch(() => {});
      assert((await page.evaluate(() => document.querySelectorAll("#lesson-list button[data-gs]").length)) === 40, `T2 (${lang}): 目录里 40 局名局猜着`);
      for (const [what, ci] of [["最长的标题", LONGEST[lang].title], ["最长的开场白", LONGEST[lang].intro]]) {
        await page.evaluate((i) => {
          document.querySelector("#sec-learn details.reading-index").open = true;
          document.querySelector('#lesson-list button[data-gs="' + i + '"]').click();
        }, ci);
        const shown = await page.waitForFunction(() => {
          const e = document.getElementById("gs-about");
          return !!e && !e.hidden && e.textContent.length > 20;
        }, null, { timeout: 10000 }).then(() => true, () => false);
        assert(shown, `T2 (${lang}): ${what}（第 ${ci} 局）开场白在卡片上`);
        for (const [v, st] of await both(page)) {
          const tag = `T2 (${lang}, ${v.width}×${v.height}) ${what}（第 ${ci} 局）`;
          assert(st.cut.length === 0 && st.sideways <= 0, `${tag}: 标题、开场白、目录 40 局都没有被裁掉的字，页面不横向滚动` + (st.cut.length ? " — " + st.cut.join(", ") : ""));
        }
      }
      assert(errs.length === 0, `T3 猜着 (${lang}): 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-2-plan T2: 看 N 步 / 盲走 — the two doors, the card, 「我的」's section ---
// In three languages, at the widest window and the narrowest: the 玩法 row
// with its five segments one height and their words inside (9.0 S3: the
// four buttons of 换个练法 — 冲刺 · 连胜 · 看 N 步 · 盲走); the question
// card's field and buttons inside the panel, the field and 确定 on one line;
// the block rhythm of 做题 still 8 / 20; 「我的」's 计算专项 one line a mode,
// its two buttons one height; nothing past the page's edge.
if (scenario()) {
  const seed = JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1", runs: { look: { best: 6, at: 1 } },
    vis: { look: { rating: { r: 1310, rd: 120, vol: 0.06 }, solve: 7, miss: 3, q: { "m2-corner-h8|2|12345": { s: 0, n: 1, due: 1, ivl: 0 } } },
      blind: { rating: { r: 1450, rd: 200, vol: 0.06 }, solve: 2, miss: 1, q: {} } } });
  const cardFits = (page) => page.evaluate(() => {
    const sec = document.getElementById("sec-puzzle"), box = sec.getBoundingClientRect();
    // 9.0 S3: the 玩法 segment became 换个练法's four buttons (挑战 · 专项)
    const seg = [...document.querySelectorAll("#pz-modes button[data-run]")].filter((b) => b.offsetParent);
    const card = document.getElementById("pz-vis");
    const ctl = [...card.querySelectorAll("button, input")].filter((b) => !b.hidden && b.offsetParent);
    const spill = seg.concat(ctl).filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 ||
      b.getBoundingClientRect().right > box.right + 1 || b.getBoundingClientRect().left < box.left - 1).map((b) => b.id || b.textContent.trim());
    const text = [...card.querySelectorAll("p:not(.sr-only)")].filter((p) => p.offsetParent && p.scrollWidth > p.clientWidth + 1).map((p) => p.id);
    const inp = document.getElementById("pz-vis-in"), go = document.getElementById("pz-vis-go");
    const row = !inp.offsetParent || Math.abs(inp.getBoundingClientRect().top - go.getBoundingClientRect().top) < 6;
    const kids = [...sec.children].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height > 0);
    const gaps = [];
    for (let i = 1; i < kids.length; i++) gaps.push(Math.round((kids[i].getBoundingClientRect().top - kids[i - 1].getBoundingClientRect().bottom) * 10) / 10);
    const gapAt = gaps.map((g, i) => g + "→" + (kids[i + 1].id || kids[i + 1].className));
    return { shown: !card.hidden && !!card.offsetParent, spill, text, row, gaps, gapAt, nseg: seg.length,
      lit: seg.filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.dataset.run),
      segH: [...new Set(seg.map((b) => Math.round(b.getBoundingClientRect().height)))],
      ctlH: [...new Set(ctl.filter((b) => b.tagName === "BUTTON").map((b) => Math.round(b.getBoundingClientRect().height)))],
      sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
  });
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 800 }]) {
      const tag = `T2 看 N 步 / 盲走 (${lang}, ${viewport.width}×${viewport.height})`;
      const { ctx, page, errs } = await open(lang, "puzzle", "play", "wood", viewport);
      await page.evaluate((s) => localStorage.setItem("chess.puzzles", s), seed);
      await page.reload();
      await page.waitForTimeout(900);
      await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
      for (const kind of ["look", "blind"]) {
        await page.click(`#pz-modes button[data-run="${kind}"]`);
        await page.waitForFunction(() => !document.getElementById("pz-vis").hidden, null, { timeout: 6000 }).catch(() => {});
        await page.waitForTimeout(300);
        for (const when of ["asked", "answered"]) {
          if (when === "answered") {
            // 答案 (H) gives the question up: the card shows the answer and 下一题
            await page.evaluate(() => document.activeElement && document.activeElement.blur());
            await page.keyboard.press("h");
            await page.waitForTimeout(400);
          }
          const r = await cardFits(page);
          const at = `${tag} ${kind}/${when}`;
          assert(r.shown, `${at}: 卡片出现`);
          assert(r.nseg === 4 && r.lit.join() === kind, `${at}: 换个练法的四个按钮都在，亮的是这一个 (${r.nseg}; ${r.lit.join(", ")})`);
          assert(r.segH.length === 1 && r.ctlH.length <= 1, `${at}: 换个练法四个按钮一样高、卡片的按钮一样高 (${r.segH.join(", ")}; ${r.ctlH.join(", ")})`);
          assert(r.spill.length === 0 && r.text.length === 0 && r.row, `${at}: 字不出框、输入框和「确定」一行 (${r.spill.join(", ") || "—"}; ${r.text.join(", ") || "—"})`);
          assert(r.gaps.every((g) => Math.abs(g - 8) <= 0.5 || Math.abs(g - 20) <= 0.5), `${at}: 做题页的间距仍只有 8 / 20 (${r.gapAt.join(", ")})`);
          assert(r.sideways <= 0, `${at}: 页面不横向滚动 (${r.sideways}px)`);
        }
      }
      await page.click('#rail button[data-view="me"]', { timeout: 1500 }).catch(() => {});
      await page.waitForFunction(() => !document.getElementById("sec-vis").hidden, null, { timeout: 6000 }).catch(() => {});
      const me = await page.evaluate(() => {
        const sec = document.getElementById("sec-vis"), box = sec.getBoundingClientRect();
        const rows = [...sec.querySelectorAll(".stat-row")];
        const bs = [...sec.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        const line = (e) => parseFloat(getComputedStyle(e).lineHeight) || 20;
        return { shown: !sec.hidden, n: rows.length, h: document.getElementById("vis-h").textContent,
          tall: rows.filter((r) => r.getBoundingClientRect().height > line(r) * 1.6).map((r) => r.textContent.trim()),
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
          spill: bs.filter((b) => b.scrollWidth > b.clientWidth + 1 || b.scrollHeight > b.clientHeight + 1 || b.getBoundingClientRect().right > box.right + 1).map((b) => b.textContent.trim()),
          nb: bs.length, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      });
      // 9.0 S3: a record, not a second way in (看 N 步 / 盲走 are 训练 · 谜题's)
      assert(me.shown && me.n === 2 && me.nb === 0 && me.h, `${tag}: 「我的」有计算专项一节，两行，没有第二个入口（${me.h}）`);
      assert(me.tall.length === 0, `${tag}: 每个模式一行` + (me.tall.length ? " — " + me.tall.join(", ") : ""));
      assert(me.sideways <= 0, `${tag}: 页面不横向滚动 (${me.sideways}px)`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
// --- v8-2-plan T1: the advanced course part 3 — its parts in 目录, its card ---
// In three languages, at the widest window and the narrowest: once the chunk
// is here, 目录 lists 计算 and 局面型 with their 24 lessons numbered 97–120 in
// course order and no row cut off; the advanced lesson with the longest title
// opens to a card whose title, text, task and buttons cut nothing off, its
// buttons one row of one height, and the page does not scroll sideways.
if (scenario()) {
  for (const lang of LANGS) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 800 }]) {
      const tag = `T1 进阶课程 (${lang}, ${viewport.width}×${viewport.height})`;
      const { ctx, page, errs } = await open(lang, "learn", "play", "wood", viewport);
      await page.waitForFunction(() => !!window.CHESS_LESSONS_ADV &&
        document.querySelectorAll("#lesson-list .lesson-item:not([data-c]):not([data-eg]):not([data-gs])").length === 120, null, { timeout: 8000 }).catch(() => {});
      const list = await page.evaluate((l) => {
        const d = document.querySelector("#sec-learn details.reading-index");
        if (d) d.open = true;
        const A = window.CHESS_LESSONS_ADV;
        if (!A) return { n: 0, titles: [], want: [], parts: [], cut: [], longest: 0 };
        const word = (L) => (l === "zh-CN" ? L : A[l][L.id]);
        const items = [...document.querySelectorAll("#lesson-list .lesson-item:not([data-c]):not([data-eg]):not([data-gs])")];
        const box = document.getElementById("sec-learn").getBoundingClientRect();
        const adv = items.slice(96);
        let longest = 0;
        A.lessons.forEach((L, i) => { if (word(L).title.length > word(A.lessons[longest]).title.length) longest = i; });
        const heads = [...document.querySelectorAll("#lesson-list .lesson-part")];
        return {
          n: items.length,
          titles: adv.map((b) => b.textContent),
          want: A.lessons.map((L, i) => (97 + i) + ". " + word(L).title),
          // 9.0 S3: a unit's head carries its progress after its name (「计算 · 0/12」)
          parts: [word(A.lessons[0]).part, word(A.lessons[23]).part].map((p) => heads.some((h) => h.textContent.startsWith(p) && /\d+\/\d+$/.test(h.textContent) && h.offsetParent)),
          cut: adv.concat(heads).filter((b) => b.offsetParent && (b.scrollWidth > b.clientWidth + 1 || b.getBoundingClientRect().right > box.right + 1))
            .map((b) => b.textContent.slice(0, 18)),
          longest,
        };
      }, lang);
      assert(list.n === 120 && list.titles.length === 24 && list.titles.every((t, i) => t === list.want[i]),
        `${tag}: 目录里是 120 课，进阶的 24 课按顺序排在第 97–120 课（${list.titles[0] || "—"} … ${list.titles[23] || "—"}）`);
      assert(list.parts.length === 2 && list.parts.every(Boolean), `${tag}: 「计算」「局面型」两个部分的标题(带本单元进度)都在目录里`);
      assert(list.cut.length === 0, `${tag}: 目录里进阶课程的行没有被裁掉的字` + (list.cut.length ? " — " + list.cut.join(", ") : ""));
      await page.evaluate((i) => {
        const items = document.querySelectorAll("#lesson-list .lesson-item:not([data-c]):not([data-eg]):not([data-gs])");
        if (items[96 + i]) items[96 + i].click();
      }, list.longest);
      await page.waitForTimeout(600);
      const card = await page.evaluate((i) => {
        const sec = document.getElementById("sec-learn"), box = sec.getBoundingClientRect();
        const out = [];
        for (const e of sec.querySelectorAll("button, .lesson-title, .lesson-task, .lesson-part, #lesson-text p")) {
          if (!e.offsetParent) continue;
          if (e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > box.right + 1) out.push(e.textContent.trim().slice(0, 18));
        }
        const strip = document.getElementById("task-strip-text");
        if (strip && strip.offsetParent && strip.scrollWidth > strip.clientWidth + 1) out.push("task strip: " + strip.textContent.slice(0, 18));
        const row = sec.querySelector(".lesson-controls");
        const bs = [...row.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        return { cut: out, title: document.getElementById("lesson-title").textContent, n: bs.length,
          heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
          tops: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().top)))],
          lesson: 97 + i, sideways: document.documentElement.scrollWidth - document.documentElement.clientWidth };
      }, list.longest);
      assert(card.title.includes(String(card.lesson)), `${tag}: 卡片是第 ${card.lesson} 课（${card.title}）`);
      assert(card.cut.length === 0, `${tag}: 卡片的标题、课文、任务与按钮没有被裁掉的字` + (card.cut.length ? " — " + card.cut.join(", ") : ""));
      assert(card.n >= 2 && card.heights.length === 1 && card.tops.length === 1,
        `${tag}: 课程按钮一排、一样高 (${card.n}; ${card.heights.join(", ")}; ${card.tops.length} 行)`);
      assert(card.sideways <= 0, `${tag}: 页面不横向滚动 (${card.sideways}px)`);
      assert(errs.length === 0, `${tag}: 没有页面异常 — ` + errs.join(" / "));
      await ctx.close();
    }
  }
}
const { shard, total } = scenario.done();
console.log(`shard ${shard.index}/${shard.count}: ${Math.ceil((total - shard.index + 1) / shard.count)} of ${total} scenarios`);
await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
