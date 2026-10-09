/**
 * Browser check for the top level (v8-0-plan A1): the navigation rail, the
 * home page, the pages, and (9.0 S5) the one settings page that replaced the
 * preferences window and the panel's 设置 tab.
 *
 * What the plan asks of it, each a claim only a running page can settle:
 *   - 今天 / 下棋 / 训练 / 棋谱 / 我的 on a left rail in a wide window, in
 *     the top bar in a narrow one; keyboard-walkable, current entry marked
 *     (9.0 S3: 谜题 and 学习 are one view, 训练, with a segment switch —
 *     课程 / 谜题 / 残局 / 名局 — over the panel);
 *   - 今天 (9.0 S1: was 首页's three cards): the hero card — the live game
 *     first, else the plan's step, 换一件事 moving on — the three 继续 cards
 *     into 训练, 下一盘; every view one click away from it;
 *   - the mode segment out of the settings page (人机 / 双人 go with the new
 *     game, 谜题 / 学习 are 训练's);
 *   - appearance, language, sound (and the data) in a preferences window,
 *     ⌘, on macOS and Ctrl+, elsewhere. 9.0 S5: that window and the panel's
 *     设置 tab are one page now, the rail's last entry (设置), six
 *     categories down its left; the panel is one pane.
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
import { seedLibrary } from "./lib/library-view.mjs";

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
    localStorage.setItem("chess.settings", JSON.stringify(Object.assign(
      { mode: "ai", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }, s)));
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
    mode: JSON.parse(localStorage.getItem("chess.settings") || "{}").mode,
    home: vis(document.getElementById("page-home")),
    library: vis(document.getElementById("page-library")),
    me: vis(document.getElementById("page-me")),
    settings: vis(document.getElementById("page-settings")),
    puzzleSec: vis(document.getElementById("sec-puzzle")),
    learnSec: vis(document.getElementById("sec-learn")),
    stageInert: document.querySelector(".stage").hasAttribute("inert"),
    // 9.0 S3: 训练's segment switch over the panel, and the segment lit on it
    segShown: vis(document.getElementById("train-seg")),
    seg: [...document.querySelectorAll('#train-seg button[aria-pressed="true"]')].map((b) => b.dataset.seg).join(),
  };
});

// --- 1. the rail: six views, in the plan's order ----------------------------
// 9.0 S5: the preferences entry (#prefs-open) became the 设置 view, still last;
// 9.0 S3: 谜题 and 学习 became one entry, 训练 (S1/S4: 首页 → 今天, 棋谱库 → 棋谱)
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
      settings: (() => { const all = nav.querySelectorAll("button"), b = all[all.length - 1];
        return !!b && b.dataset.view === "settings" && b.classList.contains("rail-end") && b.textContent.trim() === "设置"; })(),
      x: Math.round(r.left), w: Math.round(r.width), h: Math.round(r.height),
      // the controls take the app's two heights (or auto, the icon pill is --ctl-h-sm)
      pill: Math.round(nav.querySelector(".rail-ic").getBoundingClientRect().height),
    };
  });
  assert(rail && rail.tag === "NAV" && !!rail.label, "A1: 有一条带名字的 <nav> 导航栏");
  assert(rail && JSON.stringify(rail.views) === JSON.stringify(["home", "play", "train", "library", "me", "settings"]),
    "A1 × S3 × S5: 入口依次是 今天 / 下棋 / 训练 / 棋谱 / 我的 / 设置(" + (rail && rail.views.join(" ")) + ")");
  assert(rail && JSON.stringify(rail.labels.slice(0, 5)) === JSON.stringify(["今天", "下棋", "训练", "棋谱", "我的"]),
    "A1 × S1 × S3: 五个入口的字(" + (rail && rail.labels.join(" / ")) + ")");
  assert(rail && rail.settings, "S5: 栏尾是「设置」的入口(" + JSON.stringify(rail && rail.labels) + ")");
  assert(rail && rail.x === 0 && rail.w > 0 && rail.w <= 72 && rail.h === WIDE.height,
    "A1: 宽窗是左侧窄栏,不超过 72px 宽、通高(" + JSON.stringify(rail) + ")");
  assert(rail && rail.pill === 32, "A1: 图标底是 --ctl-h-sm(" + (rail && rail.pill) + "px)");
  const s = await state(page);
  assert(s.view === "play" && s.current === "play", "A1: 人机模式打开时在「下棋」,栏上标着当前项(" + JSON.stringify(s) + ")");
  assert(!s.segShown, "S3: 下棋时没有训练的分段(" + JSON.stringify(s) + ")");
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
    home: (s) => s.home && s.stageInert && !s.segShown,
    // 9.0 S3: was the 谜题 and 学习 views — 训练 is the board in the lesson or
    // the puzzle mode, the switch over the panel naming the segment
    train: (s) => !s.stageInert && s.segShown && ((s.mode === "puzzle" && s.puzzleSec && s.seg === "puzzle")
      || (s.mode === "learn" && s.learnSec && ["course", "endgame", "classic"].includes(s.seg))),
    library: (s) => s.library && s.stageInert,
    me: (s) => s.me && s.stageInert,
    settings: (s) => s.settings && s.stageInert && !s.me && !s.home && !s.library,
    play: (s) => !s.home && !s.library && !s.me && s.mode === "ai" && !s.puzzleSec && !s.learnSec && !s.segShown,
  };
  for (const v of ["home", "train", "library", "me", "settings", "play"]) {
    await page.click('#rail button[data-view="' + v + '"]');
    await page.waitForTimeout(300);
    const s = await state(page);
    assert(s.view === v && s.current === v && EXPECT[v](s), "A1: 点「" + v + "」一次就到(" + JSON.stringify(s) + ")");
  }
  // …and from the home page, each of them is one click
  for (const v of ["play", "train", "library", "me", "settings"]) {
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

// --- 3b. 9.0 S3: 训练's switch — four segments, each opening where it was left
{
  const { ctx, page, errs } = await open();
  // the course bookmarked at lesson 5 (an older profile's shape: no stamps)
  await page.evaluate(() => localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done: {}, last: 4 })));
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const look = () => page.evaluate(() => ({
    title: document.getElementById("lesson-title").textContent.trim(),
    list: document.getElementById("lesson-list-h").textContent.trim(),
    cmode: (() => { const r = document.getElementById("classic-mode"); return !r.hidden && r.getClientRects().length > 0; })(),
    last: JSON.parse(localStorage.getItem("chess.learn") || "{}").last,
    saved: JSON.parse(localStorage.getItem("chess.settings") || "{}").trainSeg,
  }));
  const seg = async (k) => {
    await page.click('#train-seg button[data-seg="' + k + '"]');
    // 残局 is a chunk: the segment lights when the camp has arrived
    await page.waitForFunction((x) => !!document.querySelector('#train-seg button[data-seg="' + x + '"][aria-pressed="true"]'),
      k, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
  };
  await page.click('#rail button[data-view="train"]');
  await page.waitForTimeout(400);
  const s0 = await state(page);
  const l0 = await look();
  assert(s0.view === "train" && s0.current === "train" && s0.segShown && s0.seg === "course" && s0.mode === "learn" && s0.learnSec,
    "S3: 第一次点「训练」是课程,分段开关在侧栏顶上(" + JSON.stringify(s0) + ")");
  assert(l0.last === 4 && !!l0.title, "S3: 课程打开在书签那一课(第 5 课:" + l0.title + ")");
  await seg("puzzle");
  const s1 = await state(page);
  assert(s1.view === "train" && s1.current === "train" && s1.seg === "puzzle" && s1.mode === "puzzle" && s1.puzzleSec && !s1.learnSec,
    "S3: 点「谜题」是谜题模式,仍在训练(" + JSON.stringify(s1) + ")");
  await seg("endgame");
  const s2 = await state(page);
  const l2 = await look();
  assert(s2.view === "train" && s2.seg === "endgame" && s2.mode === "learn" && s2.learnSec,
    "S3: 点「残局」是学习模式里的残局(" + JSON.stringify(s2) + ")");
  await seg("classic");
  const s3 = await state(page);
  const l3 = await look();
  assert(s3.seg === "classic" && s3.mode === "learn" && l3.cmode,
    "S3: 点「名局」,读谱 / 猜着的开关出现(" + JSON.stringify({ seg: s3.seg, cmode: l3.cmode }) + ")");
  assert(!l0.cmode && !l2.cmode, "S3: 读谱 / 猜着只在名局出现");
  assert(new Set([l0.list, l2.list, l3.list]).size === 3,
    "S3: 目录只列当前一段(" + [l0.list, l2.list, l3.list].join(" / ") + ")");
  await seg("course");
  const l4 = await look();
  assert(l4.title === l0.title && l4.last === 4, "S3: 回到「课程」,还是离开时那一课(" + l4.title + ")");
  // 谜题 left last: 下棋 hides the switch, and 训练 comes back on 谜题
  await seg("puzzle");
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const p0 = await state(page);
  assert(p0.view === "play" && p0.mode === "ai" && !p0.segShown, "S3: 下棋时分段开关不在(" + JSON.stringify(p0) + ")");
  await page.click('#rail button[data-view="train"]');
  await page.waitForTimeout(400);
  const p1 = await state(page);
  assert(p1.view === "train" && p1.seg === "puzzle" && p1.mode === "puzzle" && p1.segShown,
    "S3: 从下棋回「训练」,回到离开时的谜题(" + JSON.stringify(p1) + ")");
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const h0 = await state(page);
  await page.click('#rail button[data-view="train"]');
  await page.waitForTimeout(400);
  const h1 = await state(page);
  assert(!h0.segShown && h1.seg === "puzzle" && h1.mode === "puzzle", "S3: 今天页上没有分段;再回训练还是谜题(" + JSON.stringify({ h0: h0.segShown, h1: h1.seg }) + ")");
  assert((await look()).saved === "puzzle", "S3: 训练的分段记在设置里(trainSeg)");
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const r = await state(page);
  assert(r.view === "train" && r.current === "train" && r.seg === "puzzle" && r.segShown, "S3: 重开还在训练·谜题(" + JSON.stringify(r) + ")");
  assert(errs.length === 0, "训练分段:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 4. 今天: the page the app opens on, each part going somewhere --------------
// 9.0 S1: was 首页's three cards (继续上次 / 今天的训练 / 下一步建议, each a
// sentence and a .home-go). What each did is somewhere on 今天 now: 继续上次
// with no game is 下一盘 (#today-new); 今天的训练 is the hero's button
// (#today-go); 下一步建议's "to a board view" is the three 继续 cards, each
// into 训练 at its segment.
{
  const { ctx, page, errs } = await open({ view: "home" });
  // 残局's card waits for the camp's chunk
  await page.waitForFunction(() => { const c = document.querySelector('#today-cont .today-c[data-seg="endgame"]'); return !!c && !c.hidden; },
    null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(200);
  const today = await page.evaluate(() => {
    const vis = (el) => !!el && !el.hidden && el.getClientRects().length > 0;
    const txt = (id) => { const e = document.getElementById(id); return e ? e.textContent.trim() : ""; };
    return {
      head: txt("home-h"), date: txt("today-date"), hero: txt("today-hero-title"), go: txt("today-go"),
      newGame: vis(document.getElementById("today-new")) ? txt("today-new") : "",
      heroBoard: document.querySelectorAll("#today-hero-board .mini-sq").length,
      rings: [...document.querySelectorAll("#today-rings .today-ring")].map((r) => r.dataset.k + ":" + r.querySelector("b").textContent),
      note: txt("today-prog-note"),
      cont: [...document.querySelectorAll("#today-cont .today-c")].filter(vis)
        .map((c) => c.dataset.seg + ":" + c.querySelector("b").textContent.trim() + ":" + c.querySelectorAll(".mini-sq").length),
      gamesEmpty: vis(document.getElementById("today-games-empty")),
      ratings: [txt("today-r-game"), txt("today-r-pz")],
    };
  });
  assert(!!today.head && !!today.date && !!today.hero && !!today.go && today.heroBoard === 64 && today.newGame === "下一盘",
    "S1: 今天页有问候、日期,主卡是一句话 + 一块小棋盘 + 按钮,旁边是「下一盘」(" + JSON.stringify(today) + ")");
  assert(today.rings.join() === "lesson:0/1,puzzle:0/5,game:0/1" && !!today.note,
    "S1: 今天的三项进度:课 0/1、题 0/5、局 0/1,下面说还差什么(" + today.rings.join() + " · " + today.note + ")");
  assert(today.cont.length === 3 && today.cont.map((c) => c.split(":")[0]).join() === "course,endgame,classic"
    && today.cont.every((c) => c.split(":")[1] && c.split(":")[2] === "64") && /第 1 课/.test(today.cont[0]),
    "S1: 「继续」三张卡 课程 / 残局 / 名局,各有名字和棋盘;课程停在第 1 课(" + JSON.stringify(today.cont) + ")");
  assert(today.gamesEmpty && today.ratings.every(Boolean), "S1: 还没有对局时说没有;两个等级分都有字(" + JSON.stringify(today.ratings) + ")");
  assert((await state(page)).view === "home", "A1: 上次停在今天,打开还是今天");
  // 下一盘, with no game on the board, starts one: the new-game dialog
  await page.click("#today-new");
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({
    view: document.getElementById("app").getAttribute("data-view"),
    ng: document.getElementById("newgame-modal").classList.contains("show"),
  }));
  assert(after.view === "play" && after.ng, "A1 × S1: 「下一盘」→ 下棋 + 新对局对话框(" + JSON.stringify(after) + ")");
  await page.click("#ng-cancel");
  // the hero's button starts the plan: its first step, on the view it happens in
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(200);
  await page.click("#today-go");
  await page.waitForTimeout(500);
  const dv = await state(page);
  assert(dv.view !== "home" && !dv.home, "A1 × S1: 主卡的按钮带你去计划的第一步(" + dv.view + ")");
  // each 继续 card goes to 训练, at its segment
  for (const k of ["course", "endgame", "classic"]) {
    await page.click('#rail button[data-view="home"]');
    await page.waitForTimeout(300);
    await page.click('#today-cont .today-c[data-seg="' + k + '"]');
    await page.waitForFunction((x) => !!document.querySelector('#train-seg button[data-seg="' + x + '"][aria-pressed="true"]'),
      k, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const st = await state(page);
    assert(st.view === "train" && st.current === "train" && st.seg === k && st.mode === "learn" && !st.stageInert,
      "S1 × S3: 「继续·" + k + "」落在训练的这一段(" + JSON.stringify(st) + ")");
  }
  assert(errs.length === 0, "today: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 4b. 9.0 S1: the hero puts the game still being played first; 换一件事 moves on
{
  const { ctx, page, errs } = await open({ mode: "pvp" });
  const hero = () => page.evaluate(() => ({
    title: document.getElementById("today-hero-title").textContent.trim(),
    go: document.getElementById("today-go").textContent.trim(),
    skip: !document.getElementById("today-skip").hidden,
    plan: !document.getElementById("daily-plan").hidden,
    sig: document.getElementById("today-hero-board").dataset.sig || "",
  }));
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const h0 = await hero();
  assert(h0.title !== "这盘棋还没下完" && !!h0.title, "S1: 没有对局时,主卡是计划的一步(" + h0.title + ")");
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const at = (sq) => page.evaluate((x) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (x.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(x[1]) + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); }
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const h1 = await hero();
  assert(h1.title === "这盘棋还没下完" && h1.go === "接着下" && h1.skip && /^rnbqkbnr\/pppppppp\/8\/8\/4P3\/8\/PPPP1PPP\/RNBQKBNR b/.test(h1.sig) && /\|e2e4\|/.test(h1.sig),
    "S1: 有一盘没下完,主卡先是它:棋盘上是这一盘,最后一步亮着,按钮是「接着下」(" + JSON.stringify(h1) + ")");
  // 换一件事: from the game to the plan
  await page.click("#today-skip");
  await page.waitForTimeout(300);
  const h2 = await hero();
  assert(h2.title !== h1.title && h2.go !== "接着下" && !!h2.title, "S1: 「换一件事」从这盘棋换到计划的一步(" + JSON.stringify(h2) + ")");
  // …and on through the plan, when it has more than one step
  if (h2.skip) {
    await page.click("#today-skip");
    await page.waitForTimeout(300);
    const h3 = await hero();
    assert(h3.title !== h2.title || h3.sig !== h2.sig, "S1: 再点「换一件事」换到计划的下一步(" + JSON.stringify({ h2: h2.title, h3: h3.title }) + ")");
  }
  // the live game's own button goes back to it: back on the page, it is first again
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const h4 = await hero();
  if (h4.title === "这盘棋还没下完") {
    await page.click("#today-go");
    await page.waitForTimeout(400);
    const st = await state(page);
    const rows = await page.evaluate(() => document.querySelectorAll("#move-list .mlrow").length);
    assert(st.view === "play" && st.mode === "pvp" && rows === 1, "S1: 「接着下」回到这一盘(" + JSON.stringify({ view: st.view, mode: st.mode, rows }) + ")");
  } else {
    // a reload starts a new sitting — but the game is the same game
    assert(false, "S1: 重开之后主卡又先是这盘没下完的棋(" + JSON.stringify(h4) + ")");
  }
  assert(errs.length === 0, "today hero: 没有页面异常 " + errs.join(" / "));
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
  assert(f1 === "train" && (await state(page)).view === "train", "A1 × S3: ↓ 走到下一个入口(训练),回车进去(" + f1 + ")");
  await page.keyboard.press("End");
  // 9.0 S5: the rail's end is the 设置 entry now (was #prefs-open)
  const f2 = await page.evaluate(() => document.activeElement.dataset.view);
  assert(f2 === "settings", "A1 × S5: End 到栏尾的「设置」(" + f2 + ")");
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
  assert(prefsRow, "A1 × S5: 快捷键表里有设置页的键");
  await page.keyboard.press("Escape");
  await ctx.close();
}

// --- 6. the panel is one pane; the settings live on the 设置 page ------------
// 9.0 S5: was "the settings page (the panel's 设置 tab) keeps the game; the
// preferences window holds the app's own things". Both went into one page:
// the panel keeps no settings at all, the game's own choices (rung, clock,
// side) are the new-game dialog's, and everything else is a category of 设置.
{
  // a 7.x/8.x profile that was left on the 设置 tab: the key is ignored now
  const { ctx, page, errs } = await open({ sideTab: "setup" });
  const side = await page.evaluate(() => {
    const pane = document.getElementById("pane-play");
    const has = (id) => !!pane.querySelector("#" + id);
    const ng = document.getElementById("newgame-modal");
    const at = (id, host) => !!document.querySelector("#" + host + " #" + id);
    return {
      mode: has("mode-seg"), theme: has("appearance-seg") || has("board-pick-seg"), lang: has("lang-seg"), sound: has("opt-sound"),
      pieces: has("piece-pick-seg"), data: has("alldata-export"), text: has("text-seg"), coords: has("opt-coords"),
      diff: has("diff-seg"), clock: has("clock-seg"), orient: has("orient-seg"), hash: has("hash-seg"),
      panes: document.querySelectorAll(".side-pane").length, paneShown: !pane.hidden && pane.getClientRects().length > 0,
      tabs: document.querySelectorAll(".side-tabs, #tab-play, #tab-setup, #pane-setup, #prefs-modal, #prefs-open").length,
      ngRows: ["row-color", "row-clock"].every((id) => !!ng.querySelector("#" + id)) && ["row-difficulty", "row-persona"].every((id) => at(id, "ng-custom-body")),
      ngSegs: ["mode-seg", "diff-seg", "clock-seg", "color-seg"].every((id) => !!ng.querySelector("#" + id)),
      orientAt: at("orient-seg", "set-board"), hashAt: at("hash-seg", "set-advanced"),
    };
  });
  assert(!side.mode, "A1: 模式分段不在侧栏");
  assert(!side.theme && !side.lang && !side.sound && !side.pieces && !side.data && !side.text && !side.coords,
    "A1: 外观、语言、声音、数据都不在侧栏(" + JSON.stringify(side) + ")");
  assert(!side.diff && !side.clock && !side.orient && !side.hash && side.ngRows && side.ngSegs && side.orientAt && side.hashAt,
    "S5: 对局相关的项各有去处 —— 难度 / 风格 / 执子 / 棋钟常驻新对局对话框,棋盘方向在设置·棋盘,引擎内存在设置·高级(" + JSON.stringify(side) + ")");
  assert(side.panes === 1 && side.paneShown && side.tabs === 0,
    "S5: 侧栏只剩一页,没有页签、偏好窗口;存下的「设置」页签打开时落在这一页(" + JSON.stringify(side) + ")");
  // Ctrl+, (⌘, on macOS) opens the settings page — a view, marked on the rail
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await page.waitForTimeout(300);
  const opened = await state(page);
  assert(opened.view === "settings" && opened.current === "settings" && opened.settings && opened.stageInert,
    "S5: Ctrl+, 打开设置页,栏上标着「设置」(" + JSON.stringify(opened) + ")");
  // six categories, a vertical tablist, one pane at a time (通用 first)
  const cats = () => page.evaluate(() => {
    const list = document.querySelector("#page-settings .set-cats");
    const tabs = list ? [...list.querySelectorAll("[role=tab]")] : [];
    return {
      role: list && list.getAttribute("role"), orient: list && list.getAttribute("aria-orientation"),
      ids: tabs.map((b) => b.id),
      selected: tabs.filter((b) => b.getAttribute("aria-selected") === "true").map((b) => b.dataset.cat),
      shown: [...document.querySelectorAll("#page-settings .set-pane")].filter((p) => !p.hidden && p.getClientRects().length > 0).map((p) => p.id),
      controls: tabs.every((b) => b.getAttribute("aria-controls") === "set-" + b.dataset.cat),
      tabbable: tabs.filter((b) => b.tabIndex === 0).map((b) => b.dataset.cat),
      focus: document.activeElement && document.activeElement.dataset.cat,
      saved: JSON.parse(localStorage.getItem("chess.settings") || "{}").setCat,
    };
  });
  const c0 = await cats();
  assert(c0.role === "tablist" && c0.orient === "vertical" && c0.controls &&
    JSON.stringify(c0.ids) === JSON.stringify(["cat-general", "cat-board", "cat-sound", "cat-game", "cat-data", "cat-advanced"]),
    "S5: 设置页左侧是竖排的六类:通用 / 棋盘 / 声音 / 对局 / 数据 / 高级(" + JSON.stringify(c0) + ")");
  assert(JSON.stringify(c0.selected) === '["general"]' && JSON.stringify(c0.shown) === '["set-general"]' && JSON.stringify(c0.tabbable) === '["general"]',
    "S5: 头一回打开是「通用」,只显示这一类(" + JSON.stringify(c0) + ")");
  // where each row lives now: the window's rows and the old tab's rows, by category
  const where = await page.evaluate(() => {
    const at = (cat, id) => !!document.querySelector("#set-" + cat + " #" + id);
    return {
      general: at("general", "lang-seg") && at("general", "appearance-seg") && at("general", "text-seg")
        && document.querySelectorAll("#set-general #lang-seg button").length === 3,
      board: ["board-pick-seg", "frame-seg", "piece-pick-seg", "opt-coords", "coords-seg", "orient-seg", "opt-blind"].every((id) => at("board", id)),
      sound: at("sound", "opt-sound"),
      game: at("game", "row-coach") && at("game", "row-autoflip"),
      data: ["opt-netsync", "alldata-export", "alldata-import", "learning-export", "about-open", "learn-reset", "stats-clear", "clear-save"].every((id) => at("data", id)),
      advanced: ["hash-seg", "multipv-seg", "opt-engine-arrows", "opt-softmark"].every((id) => at("advanced", id)),
    };
  });
  assert(Object.values(where).every(Boolean),
    "A1 × A3 × S5: 外观 / 语言 / 字号在通用,棋盘 / 边框 / 棋子 / 坐标在棋盘,声音、对局、数据、高级各在其类(" + JSON.stringify(where) + ")");
  // the ARIA tablist keyboard contract: ↓ / ↑ walk (and wrap), Home / End jump
  await page.focus("#cat-general");
  const walk = [];
  for (const k of ["ArrowDown", "ArrowDown", "End", "ArrowDown", "ArrowUp", "Home", "ArrowUp"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(60);
    const c = await cats();
    walk.push(c.selected.join() + (c.focus === c.selected[0] && c.shown.join() === "set-" + c.selected[0] ? "" : "!"));
  }
  assert(walk.join(" ") === "board sound advanced general advanced general advanced",
    "S5: 方向键在六类间走、首尾相接,Home / End 到两头,焦点与显示的一类跟着走(" + walk.join(" ") + ")");
  // a click picks one, and the choice is remembered (setCat), page and all
  await page.click("#cat-board");
  await page.waitForTimeout(150);
  const c1 = await cats();
  assert(c1.selected.join() === "board" && c1.shown.join() === "set-board" && c1.saved === "board",
    "S5: 点「棋盘」显示棋盘一类,并记下(" + JSON.stringify(c1) + ")");
  // a choice there still works: the board and the appearance change the page
  // (棋盘 is on 棋盘, light / dark on 通用 since S5)
  await page.click('#board-pick-seg button[data-board-id="green"]');
  await page.click("#cat-general");
  await page.waitForTimeout(100);
  await page.click('#appearance-seg button[data-appearance="light"]');
  await page.waitForTimeout(200);
  const lit = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"),
    pressed: document.querySelector('#appearance-seg button[data-appearance="light"]').getAttribute("aria-pressed") }));
  await page.click('#appearance-seg button[data-appearance="dark"]');
  await page.waitForTimeout(200);
  const look = await page.evaluate(() => ({ theme: document.documentElement.getAttribute("data-theme"), board: document.documentElement.getAttribute("data-board"),
    pressed: document.querySelector('#appearance-seg button[data-appearance="dark"]').getAttribute("aria-pressed") }));
  assert(lit.theme !== "night" && lit.pressed === "true" && look.theme === "night" && look.board === "green" && look.pressed === "true",
    "A1 × A3 × S5: 在设置页里换外观(浅 → 深)与棋盘照样生效(" + JSON.stringify({ lit, look }) + ")");
  // the page is remembered as a view, on the category last open
  await page.click("#cat-board");
  await page.waitForTimeout(150);
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const back = await state(page);
  const c2 = await cats();
  assert(back.view === "settings" && back.settings && c2.selected.join() === "board" && c2.shown.join() === "set-board",
    "S5: 停在设置·棋盘,重开还是设置·棋盘(" + JSON.stringify({ view: back.view, cat: c2.selected }) + ")");
  // Escape is not how a page is left (as on 我的): it stays, and the panel behind stays open
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  const esc = await state(page);
  assert(esc.view === "settings" && esc.settings && await page.evaluate(() => document.getElementById("app").classList.contains("panel-open")),
    "S5: 设置是整页,Esc 不关它,也不去关背后的侧栏(" + JSON.stringify(esc) + ")");
  // 9.0 S5: was "#prefs-close closes the window" — the rail leaves the page
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const left = await state(page);
  assert(left.view === "play" && !left.settings && !left.stageInert, "S5: 从栏上回到下棋,设置页收起(" + JSON.stringify(left) + ")");
  // 9.0 S5: was "the rail's 偏好 opens the window too" — the rail's 设置 opens the page
  await page.click('#rail button[data-view="settings"]');
  await page.waitForTimeout(300);
  const again = await state(page);
  assert(again.view === "settings" && again.settings && (await cats()).selected.join() === "board",
    "S5: 栏上的「设置」也能打开,回到上次那一类(" + JSON.stringify(again) + ")");
  // …and ⌘, from another page goes there too, then the rail brings the board back
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  await page.keyboard.press(process.platform === "darwin" ? "Meta+Comma" : "Control+Comma");
  await page.waitForTimeout(300);
  const fromMe = await state(page);
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const ret = await state(page);
  assert(fromMe.view === "settings" && fromMe.settings && !fromMe.me && ret.view === "play" && !ret.stageInert,
    "S5: 在「我的」上按 Ctrl+, 也到设置页,栏再带回棋盘(" + JSON.stringify({ fromMe: fromMe.view, ret: ret.view }) + ")");
  assert(errs.length === 0, "settings: 没有页面异常 " + errs.join(" / "));
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
    mode: JSON.parse(localStorage.getItem("chess.settings")).mode,
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
  // 9.0 S5: no tabs to select any more — the one pane is what shows
  const s = await page.evaluate(() => {
    const pane = document.getElementById("pane-play");
    return { pane: !!pane && !pane.hidden && pane.getClientRects().length > 0,
      view: document.getElementById("app").getAttribute("data-view") };
  });
  assert(s.pane && s.view === "play", "A1 × S5: 7.x 存下的「记录」页签打开时回到对局那一页(" + JSON.stringify(s) + ")");
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  await page.reload();
  await page.waitForTimeout(900);
  const back = await state(page);
  assert(back.view === "me" && back.me, "A1: 停在「我的」,重开还是「我的」(" + JSON.stringify(back) + ")");
  // 9.0 S4: 对局历史 moved from 我的 to 棋谱
  const moved = await page.evaluate(() => ({
    stats: !!document.querySelector("#page-me #stats-body"),
    ach: !!document.querySelector("#page-me #ach-body"),
    hist: !!document.querySelector("#page-library #sec-history #hist-body") && !document.querySelector("#page-me #hist-body"),
    lib: !!document.querySelector("#page-library #lib-body"),
    rep: !!document.querySelector("#page-library #rep-body"),
  }));
  assert(Object.values(moved).every(Boolean), "A1 × S4: 统计/成就在「我的」,棋谱库/开局书/对局历史在「棋谱」(" + JSON.stringify(moved) + ")");
  assert(errs.length === 0, "restore: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 9. three languages: every entry has a label, and English has no Chinese in it
for (const lang of ["en", "ja"]) {
  const { ctx, page, errs } = await open({ langId: lang });
  const labels = await page.evaluate(() => [...document.querySelectorAll("#rail .rail-lbl")].map((s) => s.textContent.trim()));
  assert(labels.length === 6 && labels.every(Boolean), lang + ": 栏上六个字都有(" + labels.join(" / ") + ")");
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
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
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
  // 9.0 S5: 设置 is one of the pages now
  for (const v of ["home", "library", "me", "settings"]) {
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
// 9.0 S4: 对局历史 is on 棋谱 now; the same two doors, from there.
{
  const { ctx, page, errs } = await open();
  await page.evaluate(() => {
    localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games: [
      { id: "h1", t: Date.now() - 864e5, diff: "learner", style: "principled", color: "w", result: "win", moves: 3,
        pgn: '[Event "?"]\n\n1. e4 e5 2. Nf3 *', ending: "", acc: 70 },
    ] }));
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  // v8-0-plan C1: 「全部 N 局」 opens the library's list on its 本机 games,
  // and a row there loads the same way the history's own rows did; the
  // preview rows on 棋谱 (9.0 S4: was 我的) are the second door
  for (const door of ["#lib-list [data-loc]", "#hist-body [data-hist]"]) {
    await page.click('#rail button[data-view="library"]');
    await page.waitForTimeout(400);
    if (door.startsWith("#lib-list")) {
      await page.click("#hist-open");
      await page.waitForTimeout(600);
    }
    await page.click(door);
    await page.waitForTimeout(600);
    await page.click("#confirm-ok", { timeout: 800 }).catch(() => {});
    await page.waitForTimeout(800);
    const st = await state(page);
    const rows = await page.evaluate(() => document.querySelectorAll(".mlrow").length);
    assert(rows === 2, door + ":从对局历史打开的一局载入了棋盘(" + rows + " 行)");
    assert(!st.library && st.current === "play" && !st.stageInert,
      door + ":……载入之后看见的是棋盘,不是还盖着的「棋谱」(" + JSON.stringify({ library: st.library, current: st.current, inert: st.stageInert }) + ")");
    // Codex #89: the opponent comes back with the game — 练习档 × 重原则 is 莉娜 —
    // not whoever is chosen today (the default: no persona); both doors
    await page.waitForFunction(() => !!window.CHESS_OPPONENTS, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(300);
    const who = await page.evaluate(() => ({ role: document.getElementById("black-role").textContent.trim(),
      persona: JSON.parse(localStorage.getItem("chess.settings") || "{}").personaId }));
    assert(who.role === "莉娜" && who.persona === "principled", door + ":对局历史载入:对手是那盘棋的角色(" + JSON.stringify(who) + ")");
  }
  assert(errs.length === 0, "对局历史载入:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: 下一步建议 names the first unfinished lesson; its button opens
// THAT lesson, not whichever lesson was visited last. Red before: with
// lesson 1 done and lesson 3 the last one open, the card said 「第 2 课」 and
// the button went back to lesson 3.
// 9.0 S1: 下一步建议 is the hero's lesson step now — #today-go opens it — while 继续·课程 is the bookmark
// (lesson 3), and goes back to that one. Both are checked: neither may borrow
// the other's lesson.
{
  const { ctx, page, errs } = await open();
  await page.evaluate(() => {
    localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done: { board: true }, last: 2 }));
  });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  const hero = () => page.evaluate(() => ({ title: document.getElementById("today-hero-title").textContent.trim(),
    sig: document.getElementById("today-hero-board").dataset.sig || "",
    skip: !document.getElementById("today-skip").hidden }));
  // the plan's steps come in its own order; 换一件事 turns to the lesson step
  let h = await hero();
  for (let i = 0; i < 8 && h.title !== "学一节新课" && h.skip; i++) {
    await page.click("#today-skip");
    await page.waitForTimeout(200);
    h = await hero();
  }
  const card = await page.evaluate(() => document.querySelector('#today-cont .today-c[data-seg="course"] b').textContent.trim());
  assert(h.title === "学一节新课", "S1: 计划里有「学一节新课」这一步(" + h.title + ")");
  assert(/^第 3 课/.test(card), "S1: 「继续·课程」是书签那一课(第 3 课:" + card + ")");
  await page.click("#today-go");
  await page.waitForTimeout(700);
  const last = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.learn")).last);
  const st = await state(page);
  assert(st.view === "train" && st.seg === "course" && last === 1,
    "主卡「学一节新课」点开的正是第一节没学完的课(第 2 课;打开的是第 " + (last + 1) + " 课,视图 " + st.view + "/" + st.seg + ")");
  // 继续·课程 is the bookmark: lesson 3 — the hero did not move it, it did not borrow the hero's
  await page.evaluate(() => { const s = JSON.parse(localStorage.getItem("chess.learn")); s.last = 2; localStorage.setItem("chess.learn", JSON.stringify(s)); });
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await page.click('#rail button[data-view="home"]');
  await page.waitForTimeout(300);
  await page.click('#today-cont .today-c[data-seg="course"]');
  await page.waitForTimeout(600);
  const last2 = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.learn")).last);
  const st2 = await state(page);
  assert(st2.view === "train" && st2.seg === "course" && last2 === 2, "S1: 「继续·课程」打开书签那一课(第 " + (last2 + 1) + " 课)");
  assert(errs.length === 0, "下一步建议:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// Codex on #86: the board previews (paper and marble build their textures
// procedurally) are drawn when the preferences window opens, not at every
// launch for a window most sessions never open. Red before: every preview
// canvas already held pixels at startup. 9.0 S5: the window is the settings
// page's 棋盘 category; the previews are drawn when that category shows.
{
  const { ctx, page, errs } = await open();
  const inked = () => page.evaluate(() => [...document.querySelectorAll("#prefs-look canvas.look-board")].map((cv) => {
    if (!cv.width || !cv.height) return false;
    const d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
    return false;
  }));
  const before = await inked();
  assert(before.length > 0 && before.every((x) => !x), "启动时设置页还没开,棋盘预览一张也没画(" + before.join(",") + ")");
  await page.click('#rail button[data-view="settings"]');
  await page.waitForTimeout(300);
  await page.click("#cat-board");
  await page.waitForTimeout(500);
  const after = await inked();
  assert(after.length === before.length && after.every(Boolean), "打开设置·棋盘,棋盘预览都画出来了(" + after.join(",") + ")");
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
// 9.0 S5: 设置 is one of the pages now
for (const v of ["home", "library", "me", "settings"]) {
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
      inPage: !!a && !!a.closest("#page-home, #page-library, #page-me, #page-settings") };
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
  const seeded = async (all, viewport) => {
    const ctx = await browser.newContext({ viewport: viewport || WIDE, locale: "zh-CN" });
    // the library (`{names, games}`) goes in as the app keeps it (seedLibrary)
    const { "chess.library": lib, ...keys } = all;
    if (lib) await ctx.addInitScript(seedLibrary, Object.assign({ once: true }, lib));
    await ctx.addInitScript((ks) => {
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", view: "me", soundOn: false, appearance: "dark", boardId: "wood" }));
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
    const { ctx, page, errs } = await seeded({ "chess.puzzles": { v: 1, solved: {}, tally: { tac: { miss: 1, solve: 0 } }, rhist: [{ t: now, r: 1480 }] } });
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
    const { ctx, page, errs } = await seeded({ "chess.library": { v: 1, names: ["hxddh"], games: few } });
    const s = await meState(page);
    assert(s.metrics && s.rows.length === 3 && s.rows.every((r) => !/%/.test(r)) && s.rows.every((r) => /5|10/.test(r)),
      "B5 三局:三项指标都写明要几局,一个百分比也不给(" + JSON.stringify(s.rows) + ")");
    assert(errs.length === 0, "B5 三局:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
  {
    const { ctx, page, errs } = await seeded({ "chess.library": { v: 1, names: ["hxddh"], games: lib },
      "chess.stats": stats, "chess.puzzles": puzzles, "chess.progress": { v: 1, weeks: {}, days: {} } });
    const s = await meState(page);
    assert(!s.empty && s.growth && s.rating && s.cal && s.sw && s.metrics, "B5 满档案:评级曲线、日历、强弱项、跨局指标都在(" + JSON.stringify(s) + ")");
    assert(/1510/.test(s.ratingMeta), "B5 对局评级读的是每局存下的评级(" + s.ratingMeta + ")");
    assert(s.calW > 1, "B5 日历按显示宽度画(" + s.calW + ")");
    assert(/10/.test(s.calMeta), "B5 连续 10 天写在日历上(" + s.calMeta + ")");
    assert(/捉双/.test(s.swText) && /牵制/.test(s.swText), "B5 强弱项读的是主题评级(" + s.swText + ")");
    assert(s.rows.length === 3 && /60%/.test(s.rows[0]) && /40%/.test(s.rows[1]) && /33%/.test(s.rows[2]),
      "B5 化优为胜 3/5、逆境求生 2/5、时间紧 10/30 步(" + JSON.stringify(s.rows) + ")");
    // cleared from 设置 (9.0 S5: a page, its 数据 category, rather than the
    // window over 我的): the curve goes with the games it was drawn from
    await page.keyboard.press("Control+,");
    await page.waitForTimeout(300);
    await page.click("#cat-data");
    await page.waitForTimeout(200);
    await page.click("#stats-clear");
    await page.waitForTimeout(300);
    await page.click("#confirm-ok").catch(() => {});
    await page.waitForTimeout(400);
    await page.click('#rail button[data-view="me"]');
    await page.waitForTimeout(500);
    const after = await meState(page);
    assert(!after.rating && after.cal, "B5 清除统计之后:评级曲线跟着消失,日历还有棋谱库和做题(" + JSON.stringify({ rating: after.rating, cal: after.cal }) + ")");
    assert(errs.length === 0, "B5 满档案:没有页面异常 " + errs.join(" / "));
    await ctx.close();
  }
}

// --- v8-0-plan B4 → B5: rated engine games draw the 我的 curve -------------
// Three engine games, each resigned after one move, on a fresh profile: each
// is filed and rated (opponents.js fileRating writes `ra`), and the rating
// curve B5 draws from `ra` appears with the rating after the last one. Red
// before B4 wired the filing: nothing wrote `ra`, and the curve never showed.
{
  const ctx = await browser.newContext({ viewport: WIDE, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", difficulty: "casual", humanColor: "w",
      langId: "zh-CN", view: "play", soundOn: false }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1200);
  await page.click("#pick-cancel", { timeout: 800 }).catch(() => {});
  const tap = async (sq) => {
    const p = await page.evaluate((q) => {
      const r = document.getElementById("board").getBoundingClientRect(), z = r.width / 8;
      return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * z, y: r.top + (8 - Number(q[1]) + 0.5) * z };
    }, sq);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
  };
  for (let i = 0; i < 3; i++) {
    if (i) { await page.keyboard.press("n"); await page.waitForTimeout(300); await page.click("#ng-start"); await page.waitForTimeout(400); }
    await tap("e2"); await tap("e4"); await page.waitForTimeout(300);
    await page.evaluate(() => document.getElementById("btn-resign").click());
    await page.waitForTimeout(300);
    await page.click("#confirm-ok"); await page.waitForTimeout(500);
  }
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.stats") || "{}"));
  const ras = (st.games || []).map((g) => g.ra);
  assert(ras.length === 3 && ras.every(Number.isFinite) && ras[2] < ras[0] && !!st.rating,
    "B4→B5 三盘人机（都认输）各自计了等级分，存下 ra（" + JSON.stringify(ras) + "）");
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(600);
  const me = await page.evaluate(() => ({
    shown: !document.getElementById("me-rating").hidden && document.getElementById("me-rating").getClientRects().length > 0,
    meta: (document.getElementById("me-rating-meta") || {}).textContent || "",
  }));
  assert(me.shown && me.meta.trim() === String(ras[2]), "B4→B5 「我的」页的评级曲线出现，末点就是最后一盘之后的分数（" + JSON.stringify(me) + "）");
  assert(errs.length === 0, "B4→B5:没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
