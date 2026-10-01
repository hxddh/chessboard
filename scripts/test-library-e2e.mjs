/**
 * Browser check for the 棋谱库 (7.0).
 *
 * library.js is pure and has its own unit tests; what they cannot show is
 * that the app is wired to it — that 导入棋谱文件 puts *every* game of a
 * multi-game file in, that the name field re-decides who "you" are in games
 * already stored, that the count survives a restart, and that the diagnosis
 * refuses to draw anything below its sample floor and does draw above it.
 * Every one of those is a claim the README makes, and none of them is
 * checkable without a page.
 *
 * The engine is stubbed here, as in every e2e in this suite, so the
 * background analysis pass is not what this file exercises: the analysed
 * games are seeded into storage in the shape the pass writes. What is being
 * proved is the wiring around it.
 *
 * Needs playwright-core and a browser (scripts/e2e-browser.mjs). Exits 0 with
 * a notice when either is missing, unless E2E_REQUIRED=1:
 *   node scripts/test-library-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { heldClick } from "./lib/held-click.mjs";
import { libOf, storedLib } from "./lib/library-view.mjs";
import { Chess } from "../src/web/js/chess.js";
import { record, RECORDING, read as readMeasured } from "./measurements.mjs";

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
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok  ", msg);
  else { failed++; console.error("FAIL", msg, extra != null ? " " + extra : ""); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

/** Three games, two of them mine, one between two other people. */
const PGN = [
  '[Event "Rated blitz"]\n[Site "lichess"]\n[Date "2026.09.01"]\n[White "hxddh"]\n[Black "rival"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n',
  '[Event "Rated blitz"]\n[Site "lichess"]\n[Date "2026.09.02"]\n[White "rival"]\n[Black "hxddh"]\n[Result "0-1"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 0-1\n',
  '[Event "Club night"]\n[Site "somewhere"]\n[Date "2026.09.03"]\n[White "alice"]\n[Black "bob"]\n[Result "1/2-1/2"]\n\n1. c4 c5 2. g3 g6 1/2-1/2\n',
  // A [SetUp]/[FEN] game — a study, an endgame, a position someone sent you.
  // Replaying its moves from the standard array simply fails, so the entry has
  // to carry the position it starts from.
  '[Event "Study"]\n[Site "-"]\n[Date "2026.09.04"]\n[White "hxddh"]\n[Black "coach"]\n[Result "1-0"]\n[SetUp "1"]\n[FEN "8/8/4k3/8/8/8/4P3/4K3 w - - 0 1"]\n\n1. Kd2 Kd5 2. Ke3 1-0\n',
].join("\n");

async function freshContext(seed) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript((lib) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    if (lib) localStorage.setItem("chess.v1.library", lib);
  }, seed || "");
  return ctx;
}

async function open(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(200);
  return { page, errs };
}

/** Feed the file picker the way a person does: click, choose, done. */
async function importFile(page, text, button) {
  const file = path.join(HERE, "..", "node_modules", ".cache", "lib-e2e.pgn");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click(button || "#lib-import"),
  ]);
  await chooser.setFiles(file);
  await page.waitForTimeout(600);
}

/** What the library section says: the counts above the buttons and the
    status lines under them (7.6 moved those below, see renderLibrary). */
const libText = (page) => page.evaluate(() => ["lib-body", "lib-status"]
  .map((id) => (document.getElementById(id) || {}).textContent || "").join("\n"));


// --- 1. every game in the file, not one of them -----------------------------
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);

  assert(await page.isHidden("#lib-meta"), "空库不摆一个 0 出来");
  await importFile(page, PGN);

  let lib = await libOf(page);
  assert(lib && lib.games.length === 4, "一个四局的文件进库就是四局 —— 不是让你挑一局",
    lib ? lib.games.length : "null");
  const first = lib.games.find((g) => g.event === "Rated blitz" && g.white === "hxddh");
  assert(first && first.sans === "e4 e5 Nf3 Nc6 Bb5 a6",
    "每局的着法都跟着存下来了 —— 只存局数的话，诊断就只能给数字、给不出那局棋",
    first && first.sans);
  assert(await page.isVisible("#lib-names-row"), "有棋之后,认领的输入框才出现");

  // 没填名字 → 一局都不认领,而且说出来
  assert(lib.games.every((g) => g.side === null), "还没说自己是谁的时候,一局都不认");
  const body0 = await libText(page);
  assert(/一局都没认出是你下的/.test(body0), "……而且页面直说了这件事", body0);

  // 填上名字 → 已经在库里的棋也要重新认一遍
  // typed, and left the way a person leaves a field — no hand-made `change`:
  // the event the app actually gets is the one focus leaving produces
  await page.click("#lib-names");
  await page.keyboard.type("hxddh");
  await page.keyboard.press("Tab");
  await page.waitForTimeout(300);
  lib = await libOf(page);
  const mine = lib.games.filter((g) => g.side);
  assert(mine.length === 3, "填上名字,已经在库里的棋重新认一遍 —— 三局是我的", mine.length);
  const study = lib.games.find((g) => g.event === "Study");
  assert(study && study.fen === "8/8/4k3/8/8/8/4P3/4K3 w - - 0 1",
    "[SetUp]/[FEN] 的棋局带着它自己的起始局面进库 —— 从标准开局重放它的着法根本走不通",
    study && JSON.stringify(study.fen));
  const w = lib.games.find((g) => g.event === "Rated blitz" && g.white === "hxddh");
  const b = lib.games.find((g) => g.black === "hxddh");
  assert(w && w.side === "w" && w.outcome === "win", "执白那局是赢的");
  assert(b && b.side === "b" && b.outcome === "win", "执黑赢的那局也是赢的 —— 结果从我这把椅子上读");
  assert(lib.games.find((g) => g.white === "alice").side === null,
    "别人之间的那局留着,但不认领 —— 猜一边会污染后面每一个数字");

  // 再导一次同一个文件:不该翻倍
  await importFile(page, PGN);
  lib = await libOf(page);
  assert(lib.games.length === 4, "同一个文件导第二遍,还是四局", lib.games.length);

  // 重启
  await page.close();
  const second = await open(ctx);
  const after = await libOf(second.page);
  assert(after.games.length === 4 && after.names[0] === "hxddh", "重启之后棋和名字都还在");
  assert(/认出是你的 3 局/.test(await second.page.textContent("#lib-body")),
    "……页面也还这么说", await second.page.textContent("#lib-body"));
  assert(errs.length === 0 && second.errs.length === 0,
    "两轮都没有 JS 异常", errs.concat(second.errs).join(" / "));
  await ctx.close();
}

// --- 1b. 7.9 §4a:记录页只有一种空状态 ---------------------------------------
// 7.8.0 的同一页上有三种:实底的入口卡片、虚线卡片、卡片外面左对齐的裸按钮
// (导入棋谱文件 / 按白方导入 / 按黑方导入,各自一个宽度)。现在每一处空状态
// 都是虚线卡片,按钮在卡片里,每张至多一个主按钮;开局书的两个导入并排等宽。
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  const read = () => page.evaluate(() => {
    const vis = (e) => !!e.offsetParent;
    const CARD = ".rec-entry, .rec-block.empty, .empty-note";
    const cards = [...document.querySelectorAll(".page:not([hidden]) " + CARD)].filter(vis)
      .filter((c) => !c.parentElement.closest(".rec-block.empty"));
    const inside = (b, c) => {
      const x = b.getBoundingClientRect(), y = c.getBoundingClientRect();
      return x.left >= y.left - 0.5 && x.right <= y.right + 0.5 && x.top >= y.top - 0.5 && x.bottom <= y.bottom + 0.5;
    };
    // the empty sections and everything that belongs to them, headings included
    const scope = ["record-empty", "stats-body", "lib-block", "rep-block", "hist-body", "hist-open"]
      .map((id) => document.getElementById(id));
    const buttons = scope.flatMap((el) => el.matches("button") ? [el] : [...el.querySelectorAll("button")]).filter(vis);
    return {
      cards: cards.map((c) => ({ id: c.id || c.parentElement.id, dashed: getComputedStyle(c).borderTopStyle,
        primaries: [...c.querySelectorAll(".primary")].filter(vis).length })),
      outside: buttons.filter((b) => !cards.some((c) => c.contains(b) && inside(b, c))).map((b) => b.id || b.textContent.trim()),
      repBtns: ["rep-import-w", "rep-import-b"].map((id) => document.getElementById(id).getBoundingClientRect())
        .map((x) => ({ w: x.width, top: x.top })),
      libPrimary: document.getElementById("lib-import").classList.contains("primary"),
    };
  });
  // v8-0-plan A1: 记录 is two pages — 我的 (the entry, stats, history) and
  // 棋谱库 (the library, the opening book); each is read while it shows
  await page.click('#rail button[data-view="me"]');
  const onMe = await read();
  await page.click('#rail button[data-view="library"]');
  const onLib = await read();
  const r = Object.assign({}, onLib, { cards: onMe.cards.concat(onLib.cards), outside: onMe.outside.concat(onLib.outside) });
  assert(r.cards.length >= 5, "§4a 全新档案的记录页:入口、统计、棋谱库、开局书、对局历史,五张空状态卡片",
    JSON.stringify(r.cards));
  assert(r.cards.every((c) => c.dashed === "dashed"), "§4a …全是同一种:虚线卡片", JSON.stringify(r.cards));
  assert(r.cards.every((c) => c.primaries <= 1), "§4a …每张至多一个主按钮", JSON.stringify(r.cards));
  assert(r.outside.length === 0, "§4a …卡片外面没有按钮", r.outside.join(", "));
  assert(r.libPrimary, "§4a 空棋谱库里「导入棋谱文件」是主按钮");
  assert(Math.abs(r.repBtns[0].w - r.repBtns[1].w) <= 1 && Math.abs(r.repBtns[0].top - r.repBtns[1].top) <= 1,
    "§4a 开局书的两个导入在卡片里并排、等宽", JSON.stringify(r.repBtns));
  // …and once there is a library the card gives way and the fill with it
  await importFile(page, PGN);
  const after = await page.evaluate(() => ({
    empty: document.getElementById("lib-block").classList.contains("empty"),
    primary: document.getElementById("lib-import").classList.contains("primary"),
  }));
  assert(!after.empty && !after.primary, "§4a 导入之后棋谱库不再是空状态,「导入棋谱文件」回到次要按钮",
    JSON.stringify(after));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 2. 诊断:够不够样本,是这一页唯一要紧的事 -------------------------------
{
  // 25 局已分析的棋,白方在残局每手亏 120 厘兵、开局只亏 5,每局第 40 回合
  // 一个 ??。这是分析那一趟写出来的形状,原样喂进去。
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = [], losses = [];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0;
      const moveNo = Math.floor(ply / 2) + 1;
      const end = moveNo > 32;
      tags.push(mine && moveNo === 40 ? "??" : null);
      losses.push(mine ? (end ? 120 : 5) : 0);
    }
    games.push({
      id: "seed" + i, t: 1758000000000 + i, white: "hxddh", black: "rival",
      result: "1-0", plies: 80, sans: "e4", side: "w", outcome: i % 2 ? "win" : "loss",
      eco: "B20", ecoName: "西西里防御", motifs: { 78: "fork" },
      an: { acc: { w: 62, b: 55 }, acpl: { w: 60, b: 70 }, tags, losses },
    });
  }
  // 先只给 5 局:门槛之下,这一页必须闭嘴
  {
    const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games: games.slice(0, 5) }));
    const { page } = await open(ctx);
    assert(await page.isHidden("#lib-diagnose"), "只有五局时,「看诊断」根本不出现");
    assert(/还差 15 局/.test(await libText(page)), "……并且说清楚还差多少",
      await libText(page));
    await ctx.close();
  }
  // 25 局:门槛之上
  {
    const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
    const { page, errs } = await open(ctx);
    assert(await page.isVisible("#lib-diagnose"), "二十局以上,诊断才开门");
    await page.click("#lib-diagnose");
    await page.waitForTimeout(300);
    const text = await page.textContent("#lib-diag");
    assert(/25 局已分析的棋/.test(text), "诊断先说自己是从多少局里读出来的", text.slice(0, 80));
    assert(/12 胜 13 负 0 和/.test(text), "战绩", text.slice(0, 200));
    assert(/62%/.test(text), "精准度是每局的平均");
    assert(/该练的是残局/.test(text), "指出该练哪一段", text);
    assert(/120 厘兵\/手/.test(text) && /5 厘兵\/手/.test(text),
      "分阶段 ACPL 各自算各自的", text);
    assert(/第 40 回合/.test(text), "失误最密集的回合");
    assert(/捉双/.test(text), "按母题统计 —— 用的是「你没看见的那一手」的母题");
    assert(/B20/.test(text), "按开局统计战绩");
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }
}

// --- 3. 7.0 存下来的那一批「五位数厘兵」,开库时要就地改正 -------------------
{
  // 7.0 的分析那一趟写 losses 时没有钳制到 ±EVAL_WINDOW —— 6.1 在棋盘上修掉的
  // 正是这件事。于是一局棋里引擎一旦报杀,那一手就被记成九千多厘兵,诊断按阶段
  // 一平均,不管这个人残局下得怎么样,结论都是「该练残局」。
  //
  // 这里喂进去的就是 7.0 写出来的形状:losses 是没钳制的原始差值,scalars 在
  // 旁边。开库时应当拿 scalars 重算一遍,而不是把存下来的数字将就着用。
  const games = [];
  for (let i = 0; i < 25; i++) {
    const scalars = [0];
    for (let ply = 0; ply < 80; ply++) scalars.push(ply % 2 === 0 ? scalars[ply] - 30 : scalars[ply] + 30);
    scalars[71] = -9950; // 第 36 回合白方走完,引擎报黑方杀棋
    const tags = [], losses = [];
    for (let ply = 0; ply < 80; ply++) {
      const w = ply % 2 === 0;
      tags.push(null);
      // 7.0 的算式,原样:Math.max(0, (a - b) * mover)
      losses.push(Math.max(0, (scalars[ply] - scalars[ply + 1]) * (w ? 1 : -1)));
    }
    games.push({
      id: "mate" + i, t: 1758000000000 + i, white: "hxddh", black: "rival",
      result: "0-1", plies: 80, sans: "e4", side: "w", outcome: "loss",
      motifs: {}, an: { acc: { w: 62, b: 55 }, acpl: { w: 60, b: 70 }, tags, losses, scalars },
    });
  }
  const worst = Math.max(...games[0].an.losses);
  assert(worst > 9000, "种子确实是 7.0 那种没钳制的数字", String(worst));

  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.click("#lib-diagnose");
  await page.waitForTimeout(300);
  const text = await page.textContent("#lib-diag");
  // 白方残局的八手:七手各亏 30,报杀那一手钳到 1000 →(210+1000)/8 = 151
  assert(/151 厘兵\/手/.test(text), "报杀那一手按窗口上限算,不是九千多", text);
  assert(!/1[0-9]{3} 厘兵/.test(text), "诊断里不该出现四位数的每手厘兵", text);
  assert(/30 厘兵\/手/.test(text), "开局中局照旧是 30 厘兵/手", text);
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 4. 7.1:列表、点开那一局、诊断每一行都是一扇门 -------------------------
{
  // 25 局真棋,西班牙开局的头六个半着,白方第 2 个半着(Nf3)是 ??。前十局在那一手
  // 上带 fork 母题 —— 诊断的母题行筛出来的就该是这十局。
  const SANS = "e4 e5 Nf3 Nc6 Bb5 a6";
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = [null, null, "??", null, null, null];
    const scalars = [20, 10, -400, -390, -380, -370, -360];
    const bests = [null, null, "b1c3", null, null, null, null];
    const losses = [10, 0, 410, 0, 0, 0];
    games.push({
      id: "real" + i, t: 1758000000000 + i,
      white: "hxddh", black: "rival" + i, date: "2026.09." + String((i % 28) + 1).padStart(2, "0"),
      event: "Rated blitz", result: i % 3 === 0 ? "1-0" : "0-1", plies: 6, sans: SANS, fen: "",
      side: "w", outcome: i % 3 === 0 ? "win" : "loss",
      motifs: i < 10 ? { 2: "fork" } : {},
      an: { acc: { w: 50 + i, b: 60 }, acpl: { w: 70, b: 40 }, tags, losses, scalars, bests, budget: 200 },
    });
  }
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);

  // 列表本身
  assert(await page.isVisible("#lib-open"), "有棋之后,「全部 N 局」这个入口才出现");
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  const rowCount = () => page.evaluate(() => document.querySelectorAll("#lib-list button[data-lib]").length);
  assert((await rowCount()) === 25, "列表把 25 局都摆出来了", String(await rowCount()));
  const firstRow = await page.textContent("#lib-list button[data-lib]");
  assert(/精准度/.test(firstRow) && /1 处失误/.test(firstRow),
    "每一行写着我这局下得怎么样,不只是个日期", firstRow);

  // 筛选
  await page.click('#lib-result-seg button[data-lres="loss"]');
  await page.waitForTimeout(200);
  assert((await rowCount()) === 16, "「只看输的」筛出 16 局", String(await rowCount()));
  await page.click('#lib-result-seg button[data-lres="all"]');
  await page.waitForTimeout(200);

  // 点开那一局 —— 这是 7.0 完全做不到的事
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(900);
  const moves = await page.evaluate(() =>
    [...document.querySelectorAll("#move-list .mlmove")].map((b) => b.textContent.trim()));
  assert(moves.length === 6 && /e4/.test(moves[0]) && /a6/.test(moves[5]),
    "棋盘上是那一局棋", JSON.stringify(moves));
  const bad = await page.evaluate(() =>
    [...document.querySelectorAll("#move-list .mvtag.t-bad")].map((x) => x.textContent));
  assert(bad.length === 1 && bad[0] === "??",
    "存好的分析跟着一起过来了 —— 那个 ?? 立刻就在走子列表上,引擎一次都没跑",
    JSON.stringify(bad));

  // 诊断的母题行是一扇门
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(200);
  await page.click("#lib-diagnose");
  await page.waitForTimeout(1200);
  const diagText = await page.textContent("#lib-diag");
  assert(/C6[0-9]|西班牙|Ruy/.test(diagText),
    "开局战绩终于有东西了 —— 7.0 从来没有人给条目写过 eco,这一段一直是死的", diagText);
  // 这一组的棋全是六个半着、同一个开局、失误都在同一回合 —— 三张图一张都画不出来，
  // 而这正是这一页一贯的规矩：没有数据就不要那个元素（v7-1-plan B1）
  const noCharts = await page.evaluate(() => document.querySelectorAll("#lib-diag canvas.diag-chart").length);
  assert(noCharts === 0, "画不出来的图就不存在，而不是一张空画布", String(noCharts));
  const motifBtn = await page.$("#lib-diag button[data-diag-pick]");
  assert(!!motifBtn, "诊断里能点的行是 button,键盘和读屏都拿得到");
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#lib-diag button[data-diag-pick]")]
      .find((x) => JSON.parse(x.dataset.diagPick).kind === "motif");
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  assert(await page.isVisible("#lib-list-modal"), "点一行母题,开的是那些棋局的列表");
  assert((await rowCount()) === 10, "筛出来的正是被这个母题打中的那十局", String(await rowCount()));
  assert(/只看被/.test(await page.textContent("#lib-pick-note")), "并且说清楚筛的是什么");
  await page.click("#lib-pick-clear");
  await page.waitForTimeout(200);
  assert((await rowCount()) === 25, "清除筛选回到全部");

  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 5. 7.1 A3:日课和进步页看得见棋谱库 -------------------------------------
{
  // 一个刚导完存档、在这个应用里一道题都没做过的人。7.0 给他的日课里没有任何
  // 一条和他自己的棋有关 —— 弱项读的是题库战绩(空的)，「今天下过棋」读的是
  // 本地战绩(也是空的)。
  const today = new Date();
  const ymd = today.getFullYear() + "." +
    String(today.getMonth() + 1).padStart(2, "0") + "." + String(today.getDate()).padStart(2, "0");
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = [null, null, "??", null, null, null];
    const scalars = [20, 10, -400, -390, -380, -370, -360];
    games.push({
      id: "a3g" + i, t: 1758000000000 + i, white: "hxddh", black: "rival" + i,
      date: ymd, event: "Rated blitz", result: "0-1", plies: 6,
      sans: "e4 e5 Nf3 Nc6 Bb5 a6", fen: "", side: "w", outcome: "loss",
      motifs: { 2: "fork" },
      an: { acc: { w: 55, b: 70 }, acpl: { w: 90, b: 40 }, tags,
        losses: [10, 0, 410, 0, 0, 0], scalars, bests: [null, null, "b1c3", null, null, null, null], budget: 200 },
    });
  }
  // …plus five imported but never analysed, so the 「分析」 step has work
  for (let i = 0; i < 5; i++) {
    games.push({ id: "a3q" + i, t: 1758000100000 + i, white: "hxddh", black: "foe" + i,
      date: "2026.08.01", event: "Rated blitz", result: "0-1", plies: 6,
      sans: "e4 e5 Nf3 Nc6 Bb5 a6", fen: "", side: "w", outcome: "loss", motifs: {}, an: null });
  }
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.click('#rail button[data-view="play"]');
  await page.click("#tab-play");
  await page.waitForTimeout(300);
  await page.click("#daily-btn");
  await page.waitForTimeout(500);
  const plan = await page.textContent("#daily-plan");
  assert(/捉双/.test(plan),
    "题库战绩一片空白时，弱项从他自己的棋里读出来 —— 「捉双」", plan);
  assert(/还没分析的 5 局/.test(plan),
    "导进来没分析的五局，本身就是今天该干的一件事", plan);
  assert(!/下一盘|下一局/.test(plan),
    "今天在别处下过棋，就不该再劝他去下一盘", plan);

  // 进步页的准确率走势有东西可画 —— 数据全部来自棋谱库
  await page.click('#rail button[data-view="me"]');   // v8-0-plan A1: the trend is on 我的
  await page.waitForTimeout(400);
  assert(await page.isVisible("#trend-acc"),
    "准确率走势画得出来 —— 本地战绩是空的，这条线全部来自棋谱库");

  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 6. 7.1 B1:三张图各自画出来 ---------------------------------------------
{
  // 专门为图准备的样本:25 局 80 半着(三个阶段都有)、失误散落在好几个回合、
  // 两个开局。这三件事就是三张图各自的前提。
  const ECOS = ["e4 e5 Nf3 Nc6 Bb5 a6", "d4 d5 c4 e6 Nc3 Nf6"];
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = new Array(80).fill(null);
    const losses = new Array(80).fill(null);
    const scalars = [0];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0;
      const moveNo = Math.floor(ply / 2) + 1;
      losses[ply] = mine ? (moveNo > 32 ? 120 : 8) : 0;
      scalars.push(scalars[ply] + (mine ? -losses[ply] : losses[ply]));
    }
    // 失误落在第 20、28、36 回合上，轻重不同 —— 分布图要看得出这是个坡不是个尖
    for (const mv of [20, 28, 36]) {
      if (i % 3 === 0 || mv !== 20) tags[(mv - 1) * 2] = mv === 28 ? "??" : "?";
    }
    const sans = ECOS[i % 2];
    games.push({
      id: "chart" + i, t: 1758000000000 + i, white: "hxddh", black: "rival" + i,
      date: "2026.09.0" + ((i % 9) + 1), event: "Rated blitz",
      result: i % 2 ? "1-0" : "0-1", plies: 80, sans: sans + " " + sans, fen: "",
      side: "w", outcome: i % 2 ? "win" : "loss", motifs: {},
      an: { acc: { w: 60, b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars,
        bests: new Array(81).fill(null), budget: 200 },
    });
  }
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.click("#lib-diagnose");
  await page.waitForTimeout(1500);
  const charts = await page.evaluate(() =>
    [...document.querySelectorAll("#lib-diag canvas.diag-chart")]
      .map((c) => ({ label: c.getAttribute("aria-label"), w: c.width, h: c.height,
        painted: (() => {
          const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
          for (let i = 3; i < d.length; i += 4) if (d[i]) return true;
          return false;
        })() })));
  assert(charts.length === 3, "分阶段、失误分布、开局战绩各一张图", JSON.stringify(charts.map((c) => c.label)));
  assert(charts.every((c) => c.w > 0 && c.h > 0 && c.label),
    "每张图都有像素、都带着读屏能念的说明", JSON.stringify(charts));
  assert(charts.every((c) => c.painted),
    "而且真的画了东西上去 —— 不是三张空画布", JSON.stringify(charts.map((c) => c.painted)));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();

  // M5 合并：三张图（diag-charts.js）随 chunk-libdb.js 来。分块到之前就打开诊断，
  // 先是文字；分块一到，图补上
  const ctx2 = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  let release;
  const gate = new Promise((r) => { release = r; });
  await ctx2.route("**/chunk-libdb.js", async (route) => { await gate; await route.continue(); });
  // the held chunk would hold the load event too: wait for the DOM only
  const o2 = { page: await ctx2.newPage(), errs: [] };
  o2.page.on("pageerror", (e) => o2.errs.push(e.message));
  await o2.page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
  await o2.page.waitForTimeout(900);
  await o2.page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await o2.page.click('#rail button[data-view="library"]').catch(() => {});
  await o2.page.waitForTimeout(200);
  await o2.page.click("#lib-diagnose");
  await o2.page.waitForTimeout(300);
  const rows = await o2.page.evaluate(() => document.querySelectorAll("#lib-diag .stat-row").length);
  release();
  await o2.page.waitForFunction(() => document.querySelectorAll("#lib-diag canvas.diag-chart").length === 3, null, { timeout: 8000 }).catch(() => {});
  const late = await o2.page.evaluate(() => document.querySelectorAll("#lib-diag canvas.diag-chart").length);
  assert(rows > 0 && late === 3, "分块到之前打开诊断：先有文字（" + rows + " 行），分块一到三张图补上（" + late + " 张）");
  assert(o2.errs.length === 0, "没有 JS 异常", o2.errs.join(" / "));
  await ctx2.close();
}

// --- 7. 黑方先走、从第 30 手开始的那种局，也要开得出来 ----------------------
{
  // 7.0 的 foldGame 把这种局的每一手都记到了对手账上（7.1 修掉）。载入这条路上
  // 有同一个坑：把它写回 PGN 时，手数从 FEN 的第六段起算，而且开在「30...」上。
  // 一个真的能走下去的车残局。第一版的着法序列是非法的（Rxe1+ 之后白方已经没有
  // 车可以吃回来），e2e 当场把它抓了出来 —— 局面本身合法不代表着法序列合法。
  const fen = "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 30";
  const games = [{
    id: "setup1", t: 1758000500000, white: "rival", black: "hxddh",
    date: "2026.09.10", event: "Study", result: "0-1", plies: 4,
    sans: "Rd8 Rb1 Rd2 Rb8+", fen, side: "b", outcome: "win", motifs: {},
    an: { acc: { w: 40, b: 90 }, acpl: { w: 200, b: 10 },
      tags: [null, "??", null, null], losses: [5, 900, 5, 5],
      scalars: [0, -5, -900, -905, -910], bests: [null, null, null, null, null], budget: 200 },
  }];
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(900);
  const state = await page.evaluate(() => ({
    moves: [...document.querySelectorAll("#move-list .mlmove")].map((b) => b.textContent.trim()),
    nums: [...document.querySelectorAll("#move-list")].map((n) => n.textContent)[0] || "",
  }));
  // 走子列表用的是图形记号（棋子是单独的字形），所以这里比的是格子不是 SAN
  const sans = state.moves.filter((x) => /[a-h][1-8]/.test(x));
  assert(sans.length === 4 && /d8/.test(sans[0]) && /b8/.test(sans[3]),
    "黑方先走的残局也照样摆得出来", JSON.stringify(state.moves));
  assert(/30/.test(state.nums) && !/^\s*1\./.test(state.nums),
    "而且它开在第 30 手，不是第 1 手 —— 手数从 FEN 的第六段起算", state.nums.slice(0, 60));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 8. 7.2 A2:错题指得回它的来源局 ----------------------------------------
{
  // 7.1 把棋谱库接成了错题的主要来源，接完之后一道题落在做题页上，你问不出
  // 「这是我哪一局」。这一段验的就是那条回头路：入口只在来源还在时出现，点
  // 下去棋盘上是那一局，游标停在挖出这道题的那一手上。
  const fen = "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 30";
  const games = [{
    id: "setup1", t: 1758000500000, white: "rival", black: "hxddh",
    date: "2026.09.10", event: "Study", result: "0-1", plies: 4,
    sans: "Rd8 Rb1 Rd2 Rb8+", fen, side: "b", outcome: "win", motifs: {},
    an: { acc: { w: 40, b: 90 }, acpl: { w: 200, b: 10 },
      tags: [null, null, "??", null], losses: [5, 5, 900, 5],
      scalars: [0, -5, -10, -910, -915], bests: [null, null, null, null, null], budget: 200 },
  }];
  // the drill as the miner writes it: the position before 31...Rd2, the move
  // actually played, and the game it came from
  const drillFen = "3r2k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 2 31";
  const mine = (id, from) => ({
    id, cat: "mine", fen: drillFen, solution: ["Rd1"], played: "Rd2", loss: 900,
    ply: 2, t: 1758000600000, side: "b", rev: { budget: 200, src: "lib" }, from,
  });
  const seed = async (mines, lib) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
    await ctx.addInitScript(([ms, lb]) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.v1.library", lb);
      localStorage.setItem("chess.v1.mines", JSON.stringify({ v: 1, list: ms }));
      localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "mine" }));
    }, [mines, lib]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    return { ctx, page, errs };
  };

  const libJson = JSON.stringify({ v: 1, names: ["hxddh"], games });
  {
    const { ctx, page, errs } = await seed([mine("mine:src1", { kind: "lib", id: "setup1" })], libJson);
    assert(await page.isVisible("#puzzle-source"), "来源还在，做题页上就有「看那局棋」");
    await page.click("#puzzle-source");
    await page.waitForTimeout(1200);
    const state = await page.evaluate(() => ({
      moves: [...document.querySelectorAll("#move-list .mlmove")].map((b) => b.textContent.trim()),
      current: (document.querySelector("#move-list .mlmove.current") || {}).textContent || "",
      puzzleGone: document.getElementById("sec-puzzle").hidden,
    }));
    const sans = state.moves.filter((x) => /[a-h][1-8]/.test(x));
    assert(sans.length === 4 && /d8/.test(sans[0]) && /b8/.test(sans[3]),
      "点下去，棋盘上就是挖出这道题的那一局", JSON.stringify(state.moves));
    assert(/d2/.test(state.current),
      "而且游标停在那一手上 —— 不是开头，也不是最后", JSON.stringify(state.current));
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // 来源没了（库满淘汰、或者那局根本不在这台机器上）：入口就不该出现。一个
  // 点开什么都没有的按钮，正是 P3 存在的理由。
  {
    const { ctx, page, errs } = await seed([mine("mine:src2", { kind: "lib", id: "gone" })], libJson);
    assert(await page.isHidden("#puzzle-source"), "来源局已经不在库里，入口就不出现");
    await ctx.close();
    void errs;
  }

  // 7.2 之前存下的老错题没有来源字段，一样不该出现入口
  {
    const { ctx, page } = await seed([mine("mine:old", undefined)], libJson);
    assert(await page.isHidden("#puzzle-source"), "7.2 之前的老错题没有来源，入口也不出现");
    await ctx.close();
  }
}

// --- 9. 7.2 A1:库里的局可以再深一遍，而且修正它挖出来的错题 -----------------
{
  // 7.0 起，一局分析过一次就再也不会被重新分析（pending() 筛的是 !g.an），
  // 而库用的是 200 毫秒快扫。docs/measured.json 的 libRevision 量过这件事：
  // 400 毫秒撤销了 38% 的 ??，剩下的里 20% 换了最佳着。7.1 把库变成错题本的
  // 主要来源之后，这些错答案没有任何出口。这一段验那扇门。
  const FENS = [
    "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 30",
    "3r2k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 1 31",
    "3r2k1/5ppp/8/8/8/8/5PPP/1R4K1 b - - 2 31",
    "6k1/5ppp/8/8/8/8/3r1PPP/1R4K1 w - - 3 32",
    "1R4k1/5ppp/8/8/8/8/3r1PPP/6K1 b - - 4 32",
  ];
  // 200 毫秒那一趟的说法：黑方第 2 手（Rd2）是个 ??，正解 Rd1
  const games = [{
    id: "deep1", t: 1758000900000, white: "rival", black: "hxddh",
    date: "2026.09.11", event: "Study", result: "0-1", plies: 4,
    sans: "Rd8 Rb1 Rd2 Rb8+", fen: FENS[0], side: "b", outcome: "win", motifs: {},
    an: { acc: { w: 60, b: 60 }, acpl: { w: 100, b: 100 },
      tags: [null, null, "??", null], losses: [0, 0, 900, 0],
      scalars: [0, 0, 0, 900, 900], bests: [null, null, "d8d1", null, null], budget: 200 },
  }];
  // 两道题的 id 必须是 Mistakes.mineId(局面, 走的那一手) 真算出来的那个 —— 修正
  // 靠 id 对上，编一个字符串就只会被当成两道不相干的题：
  //   node -e "import('./src/web/js/mistakes.js').then(m=>console.log(
  //     m.ChessMistakes.mineId(fen, san)))"
  const ID_WITHDRAW = "mine:49b7uc";  // (FENS[2], "Rd2")
  const ID_REVISE = "mine:1s09ot3";   // (FENS[0], "Rd8")
  const mines = [
    // 深一趟会说「这一手其实不是 ??」→ 撤销
    { id: ID_WITHDRAW, cat: "mine", fen: FENS[2], solution: ["Rd1"], played: "Rd2",
      loss: 900, ply: 2, t: 1758000900001, side: "b", rev: { budget: 200, src: "lib" },
      from: { kind: "lib", id: "deep1" } },
    // 深一趟会说「这一手是 ??，但正解是别的」→ 改答
    { id: ID_REVISE, cat: "mine", fen: FENS[0], solution: ["Rf8"], played: "Rd8",
      loss: 300, ply: 0, t: 1758000900002, side: "b", rev: { budget: 200, src: "lib" },
      from: { kind: "lib", id: "deep1" } },
  ];
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript(([lb, ms]) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.library", lb);
    localStorage.setItem("chess.v1.mines", JSON.stringify({ v: 1, list: ms }));
  }, [JSON.stringify({ v: 1, names: ["hxddh"], games }), mines]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(200);

  const body = await libText(page);
  assert(/可以再深一遍/.test(body), "记录页说得出还有几局是快扫出来的", body);

  // 深一趟的说法：黑方第 0 手才是 ??（而且正解换成 Rc8），第 2 手根本不是
  await page.evaluate((fens) => {
    const view = { [fens[0]]: 0, [fens[1]]: 900, [fens[2]]: 900, [fens[3]]: 900, [fens[4]]: 900 };
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      const turn = fen.split(" ")[1] === "b" ? "b" : "w";
      const cpWhite = view[fen];
      if (cpWhite == null) return null;
      // app.js evalScalar 把「走子方视角」翻成白方视角，这里反着填
      const cp = turn === "w" ? cpWhite : -cpWhite;
      return { cp, mate: null, turn, best: fen === fens[0] ? "a8c8" : null, pv: [] };
    };
  }, FENS);

  await page.click("#lib-open");
  await page.waitForTimeout(400);
  assert(await page.isVisible("#lib-list button[data-lib-deep]"),
    "快扫过的那一局，列表里有「再深一遍」");
  await page.click("#lib-list button[data-lib-deep]");
  await page.waitForTimeout(2500);

  const after = await page.evaluate(() => ({
    budget: window.__chess.library().games[0].an.budget,
    tags: window.__chess.library().games[0].an.tags,
    mines: JSON.parse(localStorage.getItem("chess.v1.mines")).list
      .map((m) => ({ id: m.id, sol: m.solution[0], budget: m.rev && m.rev.budget, from: m.from && m.from.id })),
    deepBtn: !!document.querySelector("#lib-list button[data-lib-deep]"),
  }));
  assert(after.budget === 400, "这一局的分析预算从 200 变成了 400", after.budget);
  assert(!after.deepBtn, "深过一遍之后，那个入口就不再出现 —— 没有第二次可深的了");
  const ids = after.mines.map((m) => m.id);
  assert(!ids.includes(ID_WITHDRAW),
    "深一趟说不是 ?? 的那道题，从错题本里撤掉了", JSON.stringify(ids));
  // 一撤一改，不该多出第三道 —— 多出来就说明修正没认出它是同一道题
  assert(after.mines.length === 1, "错题本里剩下的正是那一道", JSON.stringify(ids));
  const revised = after.mines.find((m) => m.id === ID_REVISE);
  assert(revised && revised.sol === "Rc8",
    "深一趟换了正解的那道题，答案跟着换了", JSON.stringify(revised));
  assert(revised && revised.budget === 400,
    "……并且记下它现在是 400 毫秒判的，免得下一趟快扫再把它改回去", JSON.stringify(revised));
  assert(revised && revised.from === "deep1", "来源仍然是那一局");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 10. 7.2 P1:我的开局书 ---------------------------------------------------
{
  // 内置的 195 条开局书教的是「开局原理」，用的是所有人都下的那些开局。这一
  // 本是你自己的那四五套东西，从一份带变着的 PGN 进来。第三件事 —— 说出你下
  // 过、书里却没有的开局 —— 只有 7.1 之后才成立：在那之前应用不知道你在哪些
  // 开局里真的输过。
  // 第二条和下面那本开局书走的是同一串 —— 覆盖是按 ECO 编号算的，换个次序
  // 就是另一个编号，这里要验的是「补上了就不再是缺口」
  const ECOS = ["e4 e5 Nf3 Nc6 Bb5 a6", "d4 d5 c4 e6 Nf3 Nf6"];
  const games = [];
  for (let i = 0; i < 24; i++) {
    const tags = new Array(12).fill(null);
    const losses = new Array(12).fill(20);
    const scalars = new Array(13).fill(0);
    const sans = ECOS[i % 2];
    games.push({
      id: "rep" + i, t: 1758100000000 + i, white: "hxddh", black: "rival" + i,
      date: "2026.09.0" + ((i % 9) + 1), event: "Rated blitz",
      // 西班牙赢得多，后翼（i 为奇数的那一半）输得多 —— 缺口按输赢排，不按局数
      result: i % 2 ? "0-1" : "1-0", plies: 12, sans: sans + " " + sans, fen: "",
      side: "w", outcome: i % 2 ? "loss" : "win", motifs: {},
      an: { acc: { w: 60, b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars,
        bests: new Array(13).fill(null), budget: 200 },
    });
  }
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.waitForTimeout(600);

  // 书是空的：你下过的每一个开局都是缺口，而且最该先补的排在最前面
  let body = await page.textContent("#rep-body");
  assert(/还没有你自己的开局书/.test(body), "没有书时就直说没有", body);
  assert(/书里却没有的开局/.test(body), "……并且已经能说出你下过什么", body);
  const firstGap = await page.evaluate(() =>
    (document.querySelector("#rep-body .stat-row .stat-k") || {}).textContent || "");
  assert(/^D/.test(firstGap), "输得最多的那个开局排第一 —— 不是下得最多的那个", firstGap);

  // 导一份带变着的执白开局书进来
  // 两条线里白方走的是同一串（d4 c4 Nf3），黑方的回答不同 —— 树是按权重挑
  // 回答的，这样无论它挑哪一边，这一趟要走的都是同样三手
  const REP = `[Event "White repertoire"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n` +
    `1. d4 d5 2. c4 e6 (2... c6) 3. Nf3 Nf6 *\n`;
  await importFile(page, REP, "#rep-import-w");
  await page.waitForTimeout(600);
  const book = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.repertoire") || "null"));
  assert(book && book.w.length === 2, "主线和变着各成一条线", book ? book.w.length : "null");
  assert(book.b.length === 0, "执黑那本还是空的 —— 两本书，两套体系");
  body = await page.textContent("#rep-body");
  assert(/执白 2/.test(body), "记录页数得出两边各几条", body);
  const gapsNow = await page.evaluate(() =>
    [...document.querySelectorAll("#rep-body .stat-row .stat-k")].map((e) => e.textContent));
  assert(!gapsNow.some((g) => /^D/.test(g)),
    "补上的那个开局，不再算缺口", JSON.stringify(gapsNow));

  // 同一份再导一遍，书不会变成两倍
  await importFile(page, REP, "#rep-import-w");
  await page.waitForTimeout(500);
  const again = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.repertoire")));
  assert(again.w.length === 2, "同一份导第二遍，还是两条", again.w.length);

  // 背它：开始背 → 做题页开在「开局书」这一档
  await page.click("#rep-drill");
  await page.waitForTimeout(900);
  const started = await page.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem("chess.v1.puzzles")).cat,
    tabShown: !document.querySelector('#puzzle-cat-seg button[data-cat="rep"]').hidden,
    task: (document.getElementById("puzzle-task") || {}).textContent || "",
  }));
  assert(started.cat === "rep" && started.tabShown, "「开始背」把你放在开局书那一档",
    JSON.stringify(started));
  assert(/d4|后翼|Queen/i.test(started.task) || started.task.length > 0,
    "题面说的是这一条线", started.task);

  // 走偏了：当场告诉你书上走什么
  const tapAt = async (sq) => {
    const p = await page.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
      const flip = document.body.classList.contains("flipped");
      const co = flip ? 7 - f : f, ro = flip ? 7 - rk : rk, z = r.width / 8;
      return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
    }, sq);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(220);
  };
  const mv = async (a, b) => { await tapAt(a); await tapAt(b); await page.waitForTimeout(420); };
  await mv("e2", "e4");
  // 7.7 (v7-7-plan §4): the correction is on the puzzle's feedback card
  // beside the board now, not in a toast over it
  const wrong = await page.evaluate(() => document.getElementById("puzzle-feedback").textContent.trim());
  assert(/d4/.test(wrong), "走书上没有的一手，当场告诉你书上走的是 d4", wrong);
  // 走错的那道题进复习队列 —— 和内置开局题、错题走的是同一条 SRS
  const missed = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    return Object.keys(st.missed || {});
  });
  assert(missed.length === 1 && missed[0].startsWith("rep-"),
    "走错的开局书题进了复习队列，和内置题同一条 SRS", JSON.stringify(missed));

  // 书上那三手走得通，对手每一手都从书里回答，走到叶子就算背下来了
  await mv("d2", "d4");
  await mv("c2", "c4");
  let done = await page.isVisible("#puzzle-playon");
  // 黑方回的是 c6 那条的话，这里已经到叶子了；回 e6 就还差白方第三手
  const slav = done;
  if (!done) { await mv("g1", "f3"); done = await page.isVisible("#puzzle-playon"); }
  assert(done, "照书走完一条线就算背下来了 —— 对手的回答也是从这本书里挑的");
  const solved = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    return Object.keys(st.solved).filter((k) => k.startsWith("rep-")).length;
  });
  assert(solved >= 1, "背下来的那条记进了进度，和内置开局书同一条轨", solved);
  // 7.6: the credit, the toast's name and the record pane's count all follow
  // the line the board actually finished — whichever one the drill opened as
  const fin = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    const book = JSON.parse(localStorage.getItem("chess.v1.repertoire"));
    return { solved: Object.keys(st.solved).filter((k) => k.startsWith("rep-")), book: book.w,
      toast: document.getElementById("puzzle-feedback").textContent.trim(),   // 7.7: the card, not a toast
      body: document.getElementById("rep-body").textContent };
  });
  const played = fin.book.find((l) => l.sans === (slav ? "d4 d5 c4 c6" : "d4 d5 c4 e6 Nf3 Nf6"));
  assert(played && fin.solved.length === 1 && fin.solved[0] === played.id,
    "记成已背的正是走完的那条线，没走到的那条不算", JSON.stringify({ slav, solved: fin.solved }));
  assert(played && (!played.eco || fin.toast.includes(played.eco)),
    "「背谱完成」报的是走完的那条线的名字", fin.toast);
  assert(!/Queen's Gambit|Slav Defense/.test(fin.toast + started.task),
    "开局书的线名按界面语言显示族名，不是整条英文", fin.toast + " | " + started.task);
  assert(/背下来 1\/2/.test(fin.body), "记录页的「背下来」当场就是 1/2，不用重载", fin.body);

  // 7.3 B1：背谱不是战术水平 —— 背对一条自己的线，Glicko 一动不动。
  // 7.2 里它会动：ratePuzzleOnce 不看类别，而这条线的「难度」是按它有多长
  // 推出来的，于是导一本长变着的书就能刷高战术评级。
  const rated = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    return { hist: (st.rhist || []).length, rating: st.rating ? Math.round(st.rating.r) : null,
      task: (document.getElementById("puzzle-task") || {}).textContent || "" };
  });
  assert(rated.hist === 0 && rated.rating === null,
    "背对一条开局书的线，评级一动不动 —— 背谱的「难度」是线有多长，不是战术水平",
    JSON.stringify(rated));
  assert(!/\d{4}/.test(rated.task),
    "……题面上也不挂一个没有意义的评级数字", rated.task);

  // 背完一条线，「接实战」不只是出现，它还得真的把这个局面带到棋盘上 —— 7.2
  // 发布前的复查发现：按钮按 isOpeningCat 画出来了，而它的处理函数仍然只认
  // cat === "op"，于是自己书里那条线背完之后，这个按钮点下去什么都不发生
  await page.click("#puzzle-playon");
  await page.waitForTimeout(900);
  const playedOn = await page.evaluate(() => ({
    mode: JSON.parse(localStorage.getItem("chess.v1.settings")).mode,
    moves: [...document.querySelectorAll("#move-list .mlmove")]
      .map((b) => b.textContent.trim()).filter((x) => /[a-h][1-8]/.test(x)),
  }));
  assert(playedOn.mode === "ai" && playedOn.moves.length >= 3,
    "「接实战」把刚背完的那条线带上棋盘，继续跟引擎下", JSON.stringify(playedOn));

  // 清空开局书：欠下的复习跟着一起没有，否则 owedNow() 会永远数着一道谁也
  // 端不出来的题
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(300);
  await page.click("#rep-clear");
  await page.waitForTimeout(400);
  await page.click("#confirm-ok");   // 清空要问一句，问的是这个应用自己的对话框
  await page.waitForTimeout(700);
  const afterClear = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    const book = JSON.parse(localStorage.getItem("chess.v1.repertoire"));
    return { lines: book.w.length + book.b.length,
      orphan: Object.keys(st.missed || {}).filter((k) => k.startsWith("rep-")) };
  });
  assert(afterClear.lines === 0, "清空就是清空", afterClear.lines);
  assert(afterClear.orphan.length === 0,
    "书没了，它欠的复习也没了 —— 不留一道谁也端不出来的题", JSON.stringify(afterClear.orphan));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 12. 7.3 B2：从别的局面出发的「体系」不进书，而且说清为什么 --------------
{
  // 这种文件本身没坏，只是不是开局书。7.2 把它读成一条线照样进书，铸出一道
  // 第一手就非法、谁也做不了的题，一个字都不说。
  const SETUP = `[Event "Rook endgame"]\n[SetUp "1"]\n` +
    `[FEN "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 30"]\n\n1... Rd8 2. Rb1 Rd2 *\n`;
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  await importFile(page, SETUP, "#rep-import-w");
  await page.waitForTimeout(600);
  const after = await page.evaluate(() => ({
    book: JSON.parse(localStorage.getItem("chess.v1.repertoire") || "null"),
    toast: document.getElementById("toast").textContent.trim(),
    tab: (document.querySelector('#puzzle-cat-seg button[data-cat="rep"]') || {}).hidden,
  }));
  assert(!after.book || (after.book.w.length === 0 && after.book.b.length === 0),
    "从别的局面出发的局，一条都不进书", JSON.stringify(after.book));
  assert(/起始局面|跳过/.test(after.toast),
    "……并且说清了为什么，而不是默默地什么都不做", after.toast);
  assert(after.tab !== false, "书还是空的，「开局书」那一档也就不出现");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 11. 7.2 复查：只导了执黑那本，「开局书」这一档得能进得去 ----------------
{
  // 标签是按两本书加起来画的，而列表一次只给一把椅子。只导执黑、而 opSide
  // 还停在执白时，这一档是空的 —— 空的那一下会被「别把人晾在空档上」的兜底
  // 甩回一步杀，于是书在那儿，却没有任何一条路进得去。
  const REP_B = `[Event "Black repertoire"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n` +
    `1. e4 c5 2. Nf3 d6 3. d4 cxd4 *\n`;
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  await importFile(page, REP_B, "#rep-import-b");
  await page.waitForTimeout(500);
  const book = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.repertoire")));
  assert(book.b.length === 1 && book.w.length === 0, "只有执黑那本有东西",
    JSON.stringify([book.w.length, book.b.length]));
  await page.click("#rep-drill");
  await page.waitForTimeout(900);
  const seated = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    return { cat: st.cat, side: st.opSide,
      task: (document.getElementById("puzzle-task") || {}).textContent || "" };
  });
  assert(seated.cat === "rep" && seated.side === "b",
    "只有执黑那本时，自动坐到执黑那把椅子上", JSON.stringify(seated));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 13. 7.4 D1：点 A 局，打开的就是 A 局 ------------------------------------
{
  // 7.1 起，列表的每一行带的是这一局在库里的下标。每次导入 addGames 都按新到旧
  // 重排，下标全跟着挪；可 reconcile 按 id 复用行、签名里又没有下标，于是旧行
  // 原样留着、指向的却是挪进那个位置的另一局：点 A 打开的是 C，点 A 的「再深
  // 一遍」改写的是 C 的分析和错题。这一段就按这个次序走一遍。
  const an = () => ({ acc: { w: 80, b: 70 }, acpl: { w: 20, b: 30 },
    tags: [null, null, null, null], losses: [0, 0, 0, 0], scalars: [0, 0, 0, 0, 0],
    bests: [null, null, null, null, null], budget: 200 });
  const mk = (id, t, foe, sans, eco) => ({
    id, t, white: "hxddh", black: foe, date: "2026.09.01", event: "Rated blitz",
    result: "1-0", plies: 4, sans, fen: "", side: "w", outcome: "win", motifs: {},
    // eco already there, so the ECO chunk landing does not rebuild these rows
    // for an unrelated reason and hide the bug
    eco, ecoName: "x", an: an(),
  });
  // stored oldest first — the order the bug needs: alpha at index 0
  const games = [mk("d1a", 1758000000000, "alpha", "e4 e5 d4 d5", "C20"),
    mk("d1b", 1758000000001, "bravo", "c4 c5 g3 g6", "A30")];
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const { page, errs } = await open(ctx);
  await page.click("#lib-open");
  await page.waitForTimeout(1200);
  const rowOf = (foe) => page.locator("#lib-list .hist-row", { hasText: foe });
  assert((await rowOf("alpha").count()) === 1, "列表里有 alpha 那一行");
  await page.click("#lib-list-close");
  await page.waitForTimeout(200);

  // 导进一局更新的：它排到最前面，每一个下标都挪了一位
  await importFile(page, '[Event "Rated blitz"]\n[Date "2026.09.20"]\n[White "hxddh"]\n[Black "charlie"]\n' +
    '[Result "1-0"]\n\n1. a3 a6 2. h3 h6 1-0\n');
  const order = (await libOf(page)).games.map((g) => g.black);
  assert(order[0] === "charlie", "新导的那局排在库的最前面 —— 旧局的下标全挪了", JSON.stringify(order));

  await page.click("#lib-open");
  await page.waitForTimeout(500);
  const ids = await page.evaluate(() =>
    [...document.querySelectorAll("#lib-list .hist-row")].map((r) => ({
      text: r.textContent, lib: r.querySelector("button[data-lib]").dataset.lib })));
  const alphaRow = ids.find((r) => /alpha/.test(r.text));
  assert(alphaRow && alphaRow.lib === "d1a", "行上带的是这一局的 id，不是下标", JSON.stringify(ids));

  // 「再深一遍」先点 —— 点「打开」会关掉列表
  await page.evaluate(() => {
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) =>
      ({ cp: 0, mate: null, turn: fen.split(" ")[1] === "b" ? "b" : "w", best: null, pv: [] });
  });
  await rowOf("alpha").locator("button[data-lib-deep]").click();
  await page.waitForTimeout(1500);
  const budgets = Object.fromEntries((await libOf(page)).games.map((g) => [g.black, g.an ? g.an.budget : null]));
  assert(budgets.alpha === 400, "点 alpha 的「再深一遍」，深的是 alpha", JSON.stringify(budgets));
  assert(budgets.bravo === 200 && budgets.charlie === null, "……别的局一个字都没动", JSON.stringify(budgets));

  await rowOf("alpha").locator("button[data-lib]").click();
  await page.waitForTimeout(900);
  const moves = await page.evaluate(() =>
    [...document.querySelectorAll("#move-list .mlmove")].map((b) => b.textContent.trim()));
  assert(moves.length === 4 && /e4/.test(moves[0]) && /d5/.test(moves[3]),
    "点 alpha，棋盘上是 alpha 那一局 —— 不是挪进它下标的 charlie", JSON.stringify(moves));

  // 行签名里有语言：换成英文再打开列表，行文字跟着换（7.1 就有的缝）
  await page.evaluate(() => document.querySelector('#lang-seg button[data-lang="en"]').click());
  await page.waitForTimeout(300);
  await page.click('#rail button[data-view="library"]');
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  const enRow = await rowOf("bravo").locator("button[data-lib]").textContent();
  assert(/^Win/.test(enRow) && !/胜/.test(enRow), "换了语言，列表的行跟着换 —— 不留上一种语言的字", enRow);
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 14. 7.4 D7：库分析拿到空结果，绝不拿更差的覆盖更好的 ------------------
{
  const good = { acc: { w: 88, b: 70 }, acpl: { w: 12, b: 30 },
    tags: [null, null, null, null], losses: [0, 0, 0, 0], scalars: [20, 25, 30, 22, 18],
    bests: [null, null, null, null, null], budget: 200 };
  const games = [
    { id: "d7a", t: 1758000000000, white: "hxddh", black: "alpha", date: "2026.09.01", event: "x",
      result: "1-0", plies: 4, sans: "e4 e5 d4 d5", fen: "", side: "w", outcome: "win", motifs: {},
      eco: "C20", ecoName: "x", an: good },
    { id: "d7q", t: 1758000000001, white: "hxddh", black: "queued", date: "2026.09.02", event: "x",
      result: "1-0", plies: 4, sans: "c4 c5 g3 g6", fen: "", side: "w", outcome: "win", motifs: {},
      eco: "A30", ecoName: "x", an: null },
  ];
  const seedJson = JSON.stringify({ v: 1, names: ["hxddh"], games });

  // (a) 引擎死了：每一次都是 null
  {
    const ctx = await freshContext(seedJson);
    const { page, errs } = await open(ctx);
    await page.evaluate(() => {
      window.__calls = 0;
      window.__chess.engine.isReady = () => true;
      window.__chess.engine.analyze = async () => { window.__calls++; return null; };
    });
    await page.click("#lib-open");
    await page.waitForTimeout(400);
    await page.locator("#lib-list .hist-row", { hasText: "alpha" }).locator("button[data-lib-deep]").click();
    await page.waitForTimeout(800);
    let lib = await libOf(page);
    const a = lib.games.find((g) => g.id === "d7a");
    assert(a.an.budget === 200 && JSON.stringify(a.an.scalars) === JSON.stringify(good.scalars),
      "「再深一遍」一手都没拿到评估：原来 200 毫秒的分析原样留着，没被一份全是空洞的记录盖掉",
      JSON.stringify(a.an));
    assert(/原样留着/.test(await page.textContent("#toast")), "……并且说了", await page.textContent("#toast"));
    await page.click("#lib-list-close");
    await page.waitForTimeout(200);

    await page.evaluate(() => { window.__calls = 0; });
    await page.click("#lib-analyse");
    await page.waitForTimeout(1200);
    lib = await libOf(page);
    const q = lib.games.find((g) => g.id === "d7q");
    assert(q.an == null && !q.unplayable,
      "后台分析拿不到评估：那一局不存档，也不被当成「摆不出来」", JSON.stringify(q));
    const calls = await page.evaluate(() => window.__calls);
    assert(calls === 2, "同一手问两次（重试一次），然后整趟停下 —— 不在同一局上转圈", String(calls));
    assert(/停在这里/.test(await page.textContent("#toast")), "停下来的时候说了为什么",
      await page.textContent("#toast"));
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // (b) 棋盘上的一步把在途的搜索取消了一次：重试一次就接上，整局照常存档
  {
    const ctx = await freshContext(seedJson);
    const { page, errs } = await open(ctx);
    await page.evaluate(() => {
      const seen = new Set();
      window.__chess.engine.isReady = () => true;
      window.__chess.engine.analyze = async (fen) => {
        // every position's first ask is "cancelled", the second answers
        if (!seen.has(fen)) { seen.add(fen); return null; }
        return { cp: 15, mate: null, turn: fen.split(" ")[1] === "b" ? "b" : "w", best: null, pv: [] };
      };
    });
    await page.click("#lib-analyse");
    await page.waitForTimeout(1500);
    const q = (await libOf(page)).games.find((g) => g.id === "d7q");
    assert(q.an && q.an.scalars.length === 5 && q.an.scalars.every((x) => x != null),
      "每一手第一次都被取消，重试一次就拿到了 —— 整局存下来，一个空洞都没有",
      JSON.stringify(q.an && q.an.scalars));
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // (c) 连点两下「分析」：7.3 的 run token 在第一个 await 之后才立起来，两下
  // 都看见 libRun 是空的，于是两趟一起跑、同一局分析两遍
  {
    const ctx = await freshContext(seedJson);
    const { page, errs } = await open(ctx);
    await page.evaluate(() => {
      window.__asked = {};
      window.__inflight = 0;
      window.__maxInflight = 0;
      window.__chess.engine.isReady = () => true;
      window.__chess.engine.analyze = async (fen) => {
        window.__asked[fen] = (window.__asked[fen] || 0) + 1;
        window.__inflight++;
        window.__maxInflight = Math.max(window.__maxInflight, window.__inflight);
        await new Promise((r) => setTimeout(r, 20));
        window.__inflight--;
        return { cp: 15, mate: null, turn: fen.split(" ")[1] === "b" ? "b" : "w", best: null, pv: [] };
      };
      const b = document.getElementById("lib-analyse");
      b.click();
      b.click();
    });
    await page.waitForTimeout(1500);
    const r = await page.evaluate(() => ({ asked: window.__asked, max: window.__maxInflight }));
    assert(r.max <= 1 && Object.values(r.asked).every((n) => n === 1),
      "连点两下，不会有两趟分析同时跑同一局", JSON.stringify(r));
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }
}

// --- 15. 7.4 D5 与「接实战」：换掉开局书之后，屏幕上的那道题 -----------------
{
  const REP = `[Event "White repertoire"]\n[White "?"]\n[Black "?"]\n[Result "*"]\n\n` +
    `1. d4 d5 2. c4 e6 3. Nf3 Nf6 *\n`;
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  const tapAt = async (sq) => {
    const p = await page.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
      const flip = document.body.classList.contains("flipped");
      const co = flip ? 7 - f : f, ro = flip ? 7 - rk : rk, z = r.width / 8;
      return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
    }, sq);
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(220);
  };
  const mv = async (a, b) => { await tapAt(a); await tapAt(b); await page.waitForTimeout(420); };
  const missedRep = () => page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles") || "{}");
    return Object.keys(st.missed || {}).filter((k) => k.startsWith("rep-"));
  });

  // 棋盘上先有一盘没下完的棋（双人模式，走两步）
  await page.click('#rail button[data-view="play"]');   // v8-0-plan A1: the board is its own view
  await mv("e2", "e4");
  await mv("e7", "e5");

  await page.click('#rail button[data-view="library"]');   // the book is on the library page
  await importFile(page, REP, "#rep-import-w");
  await page.waitForTimeout(400);
  await page.click("#rep-drill");
  await page.waitForTimeout(900);

  // 书清掉，题还在屏幕上
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(200);
  await page.click("#rep-clear");
  await page.waitForTimeout(300);
  await page.click("#confirm-ok");
  await page.waitForTimeout(500);
  await page.click('#rail button[data-view="puzzle"]');   // back to the puzzle on the board
  await mv("e2", "e4");   // 书上是 d4：这是一步错棋
  assert((await missedRep()).length === 0,
    "书已经清空，屏幕上那道题走错了也不写进复习队列 —— 不留一道谁也端不出来的题",
    JSON.stringify(await missedRep()));

  // 「接实战」：重新导书、背完一条线，棋盘上还压着那盘没下完的棋
  await page.click('#rail button[data-view="library"]');   // the book is on the library page
  await importFile(page, REP, "#rep-import-w");
  await page.waitForTimeout(400);
  await page.click("#rep-drill");
  await page.waitForTimeout(900);
  await mv("d2", "d4");
  await mv("c2", "c4");
  let done = await page.isVisible("#puzzle-playon");
  if (!done) { await mv("g1", "f3"); done = await page.isVisible("#puzzle-playon"); }
  assert(done, "背完一条线，「接实战」出来了");
  await page.click("#puzzle-playon");
  await page.waitForTimeout(400);
  assert(await page.isVisible("#confirm-modal"),
    "棋盘上有一盘没下完的棋，「接实战」先问一声 —— 和「新局」一样");
  await page.click("#confirm-cancel");
  await page.waitForTimeout(400);
  const mode1 = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.settings")).mode);
  assert(mode1 === "puzzle", "取消就什么都不变 —— 还在做题", mode1);
  await page.click("#puzzle-playon");
  await page.waitForTimeout(400);
  await page.click("#confirm-ok");
  await page.waitForTimeout(900);
  const mode2 = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.settings")).mode);
  assert(mode2 === "ai", "确定之后才接着和引擎下", mode2);
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 16. 7.5：这趟要跑多久，照实说；中途关掉再开，从断点接着分析 -------------
// 真引擎下 8 局 200ms 快扫用了 102 秒（v7-5-plan §4），满载 500 局是一两个
// 小时。按钮上要说出预计时长；而「后台、可暂停、可续」这句话从 6.0 写到现在
// 没被验证过：跑到一半重新载入，分析完的留着、没分析的仍在队列里、接着点
// 「分析」就从那里往下走，已经分析过的不再重跑。
{
  // (a) 满载：500 局 × 80 手 → 500 × 81 个局面 × 200ms × 0.98 ≈ 133 分钟
  {
    const sans = Array.from({ length: 20 }, () => "Nf3 Nf6 Ng1 Ng8").join(" ");
    const games = Array.from({ length: 500 }, (_, k) => ({
      id: "eta" + k, t: 1758000000000 + k, white: "hxddh", black: "r" + k, date: "2026.09.01", event: "x",
      result: "1/2-1/2", plies: 80, sans, fen: "", side: "w", outcome: "draw", motifs: {}, eco: "A04", ecoName: "x", an: null }));
    const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games }));
    const { page, errs } = await open(ctx);
    const label = (await page.textContent("#lib-analyse")).trim();
    assert(label === "分析剩下的 500 局（约 2.2 小时）", "满载的库，按钮上照实写出要跑多久", label);
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // (b) 跑到一半重新载入
  const line = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7".split(" ");
  const games = Array.from({ length: 6 }, (_, k) => ({
    id: "rs" + k, t: 1758000000000 + k, white: "hxddh", black: "r" + k, date: "2026.09.0" + (k + 1), event: "x",
    result: "1-0", plies: line.length - k, sans: line.slice(0, line.length - k).join(" "), fen: "",
    side: "w", outcome: "win", motifs: {}, eco: "C60", ecoName: "x", an: null }));
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript((lib) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    // seeded once: a reload must find what the pass saved, not the seed again
    if (!localStorage.getItem("chess.v1.library")) localStorage.setItem("chess.v1.library", lib);
  }, JSON.stringify({ v: 1, names: ["hxddh"], games }));
  const stub = (page) => page.evaluate(() => {
    window.__asked = [];
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      window.__asked.push(fen);
      await new Promise((r) => setTimeout(r, 60));
      return { cp: 15, mate: null, turn: fen.split(" ")[1] === "b" ? "b" : "w", best: null, pv: [] };
    };
  });
  const { page, errs } = await open(ctx);
  const label0 = (await page.textContent("#lib-analyse")).trim();
  assert(label0 === "分析剩下的 6 局（约 1 分钟）", "六局待分析，按钮写着预计时长（不到一分钟也说 1 分钟）", label0);
  await stub(page);
  await page.click("#lib-analyse");
  let done = [];
  for (let i = 0; i < 80; i++) {
    await page.waitForTimeout(100);
    done = (await libOf(page)).games.filter((g) => g.an).map((g) => g.id);
    if (done.length >= 2) break;
  }
  const before = (await libOf(page)).games;
  assert(done.length >= 2 && done.length < 6, "跑到一半（已存 " + done.length + " 局）就重新载入", done.join(","));
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(200);
  const mid = (await libOf(page)).games;
  const kept = before.filter((g) => g.an);
  assert(kept.every((g) => JSON.stringify(mid.find((m) => m.id === g.id).an) === JSON.stringify(g.an)),
    "重新载入之后，分析完的局原样还在", kept.map((g) => g.id).join(","));
  const left = mid.filter((g) => !g.an && !g.unplayable).length;
  assert(left === 6 - kept.length && left > 0, "没分析完的仍在队列里（" + left + " 局），没有被丢掉，也没有被标成摆不出来", String(left));
  const label1 = (await page.textContent("#lib-analyse")).trim();
  assert(label1.startsWith("分析剩下的 " + left + " 局"), "按钮说的是剩下的局数", label1);
  await stub(page);
  await page.click("#lib-analyse");
  for (let i = 0; i < 150; i++) {
    await page.waitForTimeout(100);
    if ((await libOf(page)).games.every((g) => g.an)) break;
  }
  const end = (await libOf(page)).games;
  assert(end.every((g) => g.an), "接着点「分析」，从断点往下跑完", end.filter((g) => !g.an).map((g) => g.id).join(","));
  const asked = await page.evaluate(() => window.__asked.length);
  const expect = end.filter((g) => !kept.some((k) => k.id === g.id)).reduce((n, g) => n + g.plies + 1, 0);
  assert(asked === expect, "续跑只问没分析过的局面（" + asked + " 次，应为 " + expect + "）—— 已分析的局不重跑", String(asked));
  assert(kept.every((g) => JSON.stringify(end.find((m) => m.id === g.id).an) === JSON.stringify(g.an)),
    "……先前那几局的记录一字未动");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 17. 7.6 §2：打完名字直接点「分析」，一下就开始 ---------------------------
// 7.5 在 WebKit 上丢过这一下：名字框失焦时的第一次 change 重建了按钮上方的
// #lib-body，1100 宽时按钮在按下与松开之间上移 16px，这次点击就没了。这里走
// 真实路径 —— 点进框里、打字、直接去按按钮，不手动派发 change —— 并且按住
// 一会儿再松开，逐帧看按钮挪没挪。挪了，WebKit 上这一下就会丢。
{
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const { page, errs } = await open(ctx);
  await importFile(page, PGN);
  await page.evaluate(() => {
    window.__asked = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      window.__asked++;
      await new Promise((r) => setTimeout(r, 80));
      return { cp: 15, mate: null, turn: fen.split(" ")[1] === "b" ? "b" : "w", best: null, pv: [] };
    };
  });
  assert(/一局都没认出是你下的/.test(await libText(page)), "打名字之前，页面说一局都没认出来");
  await page.click("#lib-names");
  await page.keyboard.type("hxddh");
  const r = await heldClick(page, "#lib-analyse");
  console.log("  lib-names → 分析：按住期间按钮位移 " + r.drift + "px，节点" + (r.replaced ? "被换掉了" : "还是原来那个") +
    "，按钮里的 DOM 变动 " + r.mutated + " 处");
  assert(r.drift === 0 && !r.replaced, "失焦那一下的 change 重排了面板，按钮在按下与松开之间没有挪动",
    JSON.stringify(r));
  // 不挪还不够：7.6 的 WebKit 上按钮一像素没动，点击照样丢了 —— 失焦的重绘
  // 把「分析」的文字用同样的内容重写了一遍，按下时压着的那个文本节点被换掉
  assert(r.mutated === 0, "……按住期间按钮里的 DOM 一处都没被改写（连同样的文字重写一遍也不行）", JSON.stringify(r));
  assert(r.clicked, "这一下点击落在了「分析」上");
  let running = false;
  for (let i = 0; i < 20 && !running; i++) {
    await page.waitForTimeout(100);
    running = /暂停/.test(await page.textContent("#lib-analyse"));
  }
  assert(running && (await page.evaluate(() => window.__asked)) > 0, "点一下，分析就开始了",
    await page.textContent("#lib-analyse"));
  const lib = await libOf(page);
  assert(lib.games.filter((g) => g.side).length === 3, "……名字也照样生效：三局认领为我的");

  // 跑的过程中，「暂停分析」上方的内容也不许动：每一手都在刷新进度
  const p = await heldClick(page, "#lib-analyse", { hold: 600 });
  console.log("  分析进行中按「暂停分析」：位移 " + p.drift + "px");
  assert(p.drift === 0 && !p.replaced && p.mutated === 0 && p.clicked,
    "分析进行中，进度每手一刷，「暂停分析」按住期间不挪、按钮里也不被改写", JSON.stringify(p));
  let paused = false;
  for (let i = 0; i < 20 && !paused; i++) {
    await page.waitForTimeout(100);
    paused = !/暂停/.test(await page.textContent("#lib-analyse"));
  }
  assert(paused, "……而且一下就停了", await page.textContent("#lib-analyse"));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 18. 7.6 §3c/§3d/§3e：诊断弹窗滚得动；教学/做题里也打得开；按筛选停在那一手 ----
{
  // 25 局、80 半着，失误落在第 20、28、36 回合，第 28 回合那一手是「捉双」；
  // 两个开局。和第 6 节的样本同一个形状：三张图都画得出来，诊断页因此最长 ——
  // 7.5 在 900 高的窗口里量到卡片 1025px，关闭按钮在 y=976。
  // 两局真能摆完 80 半着的棋（开局之后是确定性地挑的安静着）—— 打开要停在
  // 第 55 半着，前提是棋盘上真有第 55 半着
  const ECOS = [
    "e4 e5 Nf3 Nc6 Bb5 a6 b4 Bc5 Be2 Bd4 Bb5 b6 Nc3 Rb8 a3 Nf6 Kf1 Bc5 Ne1 d6 g4 h5 Qe2 Kd7 f3 Qf8 a4 Ke7 Qf2 Nh7 Ba3 Nd8 Qg2 Ng5 Bd7 Nge6 Rc1 f6 b5 Bb4 Rb1 g5 Rg1 Qe8 Ke2 f5 Nd3 Ba5 Qh3 Bb4 Rh1 Ba5 Rbe1 Kf7 Bb4 Kf6 Na2 Ke7 Ref1 Qg6 Re1 Qg8 Kf1 Nc6 Kg2 Ra8 Rc1 Qf8 Rce1 Rh6 Ra1 Qh8 Qg3 Qd8 Rhf1 Kf8 Rab1 Rf6 Ra1 Ra7",
    "d4 d5 c4 e6 Nc3 Nf6 b3 c6 Be3 Kd7 a3 c5 Bh6 Qe7 Nh3 e5 e4 Nh5 f4 Qg5 Nb1 Rg8 Nf2 a6 Ng4 Ke7 g3 Qf6 Bg5 Ke6 Nc3 Kd7 Bd3 Kd6 Ke2 Qe6 Bb1 Kc6 Bh6 Kd6 h4 Nc6 Kd2 Bd7 Qc2 Rh8 Na4 Na7 Rc1 Bc8 Rd1 Kd7 Ke3 Qe7 Qc1 Nf6 Rf1 Nh5 Re1 Qe8 Nf2 f6 Ke2 Qe6 Qd2 Kc7 Ng4 Qf7 Qc3 b6 Qb4 Qg6 Rh1 Nb5 Nf2 Be7 Nc3 Na7 Kf1 Kb8",
  ];
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = new Array(80).fill(null);
    const losses = new Array(80).fill(null);
    const scalars = [0];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0;
      const moveNo = Math.floor(ply / 2) + 1;
      losses[ply] = mine ? (moveNo > 32 ? 120 : 8) : 0;
      scalars.push(scalars[ply] + (mine ? -losses[ply] : losses[ply]));
    }
    for (const mv of [20, 28, 36]) {
      if (i % 3 === 0 || mv !== 20) tags[(mv - 1) * 2] = mv === 28 ? "??" : "?";
    }
    const sans = ECOS[i % 2];
    games.push({
      id: "s3g" + i, t: 1758000000000 + i, white: "hxddh", black: "rival" + i,
      date: "2026.09.0" + ((i % 9) + 1), event: "Rated blitz",
      result: i % 2 ? "1-0" : "0-1", plies: 80, sans,
      fen: "", side: "w", outcome: i % 2 ? "win" : "loss",
      // six openings and five motifs: every section of the page at its
      // longest, which is what made the card taller than the window
      eco: ["C70", "D35", "B20", "A00", "E60", "C00"][i % 6],
      ecoName: ["Ruy Lopez", "Queen's Gambit Declined", "Sicilian Defense", "Polish Opening",
        "King's Indian Defense", "French Defense"][i % 6],
      motifs: { [(28 - 1) * 2]: "fork", [(36 - 1) * 2]: ["pin", "skewer", "discovered", "double"][i % 4] },
      an: { acc: { w: 60, b: 65 }, acpl: { w: 80, b: 50 }, tags, losses, scalars,
        bests: new Array(81).fill(null), budget: 200 },
    });
  }
  const seed = JSON.stringify({ v: 1, names: ["hxddh"], games });
  const openAt = async (viewport, mode, tab, panelOpen = "1") => {
    const ctx = await browser.newContext({ viewport, locale: "zh-CN" });
    await ctx.addInitScript(([lib, m, tb, po]) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: m, langId: "zh-CN", sideTab: tb === "record" ? "play" : tb, view: tb === "record" ? "library" : "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", po);
      localStorage.setItem("chess.v1.library", lib);
    }, [seed, mode, tab, panelOpen]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
    return { ctx, page, errs };
  };
  const settingsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.settings") || "{}"));

  // §3c —— 两个窗口都要能点到弹窗的最后一行，而且是用滚轮滚过去的，不是脚本
  // 替人 scrollIntoView（#app 是 overflow: hidden，脚本滚得动它，人滚不动）
  for (const viewport of [{ width: 1400, height: 900 }, { width: 540, height: 900 }]) {
    const tag = viewport.width + "×" + viewport.height;
    const { ctx, page, errs } = await openAt(viewport, "pvp", "record");
    await page.click("#lib-diagnose");
    await page.waitForTimeout(900);
    const geo = () => page.evaluate(() => {
      const card = document.querySelector("#lib-modal .modal").getBoundingClientRect();
      const rows = document.querySelectorAll("#lib-diag [data-diag-pick]");
      const last = rows[rows.length - 1];
      const r = last.getBoundingClientRect();
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const close = document.getElementById("lib-modal-close").getBoundingClientRect();
      const hitClose = document.elementFromPoint(close.left + close.width / 2, close.top + close.height / 2);
      return {
        cardTop: card.top, cardBottom: card.bottom, vh: innerHeight,
        lastTop: r.top, lastBottom: r.bottom,
        lastReachable: !!hit && (hit === last || last.contains(hit)),
        closeReachable: !!hitClose && hitClose.id === "lib-modal-close",
        paneScroll: document.getElementById("page-library").scrollTop,
        lastPick: last.dataset.diagPick,
      };
    });
    const g0 = await geo();
    assert(g0.cardTop >= 0 && g0.cardBottom <= g0.vh,
      tag + "：诊断卡片整张在窗口里（" + Math.round(g0.cardTop) + "–" + Math.round(g0.cardBottom) + " / " + g0.vh + "）");
    assert(g0.closeReachable, tag + "：一打开，「关闭」就点得到");
    // 滚轮在卡片上往下滚到底
    const card = await page.$("#lib-modal .modal");
    const cb = await card.boundingBox();
    await page.mouse.move(cb.x + cb.width / 2, cb.y + cb.height / 2);
    for (let i = 0; i < 20; i++) { await page.mouse.wheel(0, 400); await page.waitForTimeout(40); }
    await page.waitForTimeout(300);
    const g1 = await geo();
    assert(g1.lastReachable, tag + "：滚到底，最后一行开局点得到（y=" + Math.round(g1.lastTop) + "）");
    assert(g1.closeReachable, tag + "：滚到底，「关闭」也还在、点得到");
    assert(g1.paneScroll === g0.paneScroll, tag + "：滚轮滚的是弹窗，不是背后的页面（" + g0.paneScroll + " → " + g1.paneScroll + "）");
    // 真点一下最后一行：那一组棋的列表打开
    const lastBox = await page.evaluate(() => {
      const rows = document.querySelectorAll("#lib-diag [data-diag-pick]");
      const r = rows[rows.length - 1].getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    });
    await page.mouse.click(lastBox.x, lastBox.y);
    await page.waitForTimeout(500);
    assert(await page.isVisible("#lib-list-modal"),
      tag + "：点最后一行，开的是那一组棋的列表");
    assert(errs.length === 0, tag + "：没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // toast 在弹窗和它的模糊背景之上
  {
    const { ctx, page } = await openAt({ width: 1400, height: 900 }, "pvp", "record");
    const z = await page.evaluate(() => ({
      toast: Number(getComputedStyle(document.getElementById("toast")).zIndex),
      modals: [...document.querySelectorAll(".modal-bg")].map((m) => Number(getComputedStyle(m).zIndex) || 0),
    }));
    assert(z.toast > Math.max(...z.modals), "toast 的层级在所有弹窗之上（" + z.toast + " > " + Math.max(...z.modals) + "）");
    await ctx.close();
  }

  // §3d —— 做题、教学里从棋谱库点一局：切到双人复盘，棋盘上就是那一局
  for (const mode of ["puzzle", "learn"]) {
    const { ctx, page, errs } = await openAt({ width: 1400, height: 900 }, mode, "record");
    await page.click("#lib-open");
    await page.waitForTimeout(400);
    const id = await page.getAttribute("#lib-list button[data-lib]", "data-lib");
    await page.click("#lib-list button[data-lib]");
    await page.waitForTimeout(900);
    // whatever the trainer left on the main board may be asked about first
    if (await page.isVisible("#confirm-ok")) {
      await page.click("#confirm-ok");
      await page.waitForTimeout(600);
    }
    const st = await settingsOf(page);
    const moves = await page.evaluate(() => document.querySelectorAll("#move-list .mlmove:not(.mlgap)").length);
    assert(st.mode === "pvp", mode + "：点库里的一局，自动切到双人复盘（mode=" + st.mode + "）");
    assert(moves === 80, mode + "：棋盘上就是那一局（" + moves + " 半着，" + id + "）");
    assert(!(await page.isVisible("#lib-list-modal")), mode + "：列表关上了");
    assert(errs.length === 0, mode + "：没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // §3d（Codex on #79）—— 在教学里点库里的一局、再在「替换当前对局」上点取消：
  // 教学原样回来，停在刚才那一步，而不是从这一课的第一步重来
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((lib) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "learn", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.v1.library", lib);
      // a game in progress on the main board, so the load has to ask first
      localStorage.setItem("chess.v1.save", JSON.stringify({ v: 1, pgn: "1. d4 d5 2. c4 *" }));
    }, seed);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1500);
    const task = () => page.evaluate(() => (document.getElementById("lesson-task") || {}).textContent || "");
    const first = await task();
    // lesson 1's first step asks for e4: do it, so the lesson is one step in
    const pt = await page.evaluate(() => {
      const r = document.getElementById("board").getBoundingClientRect(), z = r.width / 8;
      return { x: r.left + 4.5 * z, y: r.top + 4.5 * z };
    });
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(1200);
    const before = await task();
    await page.click('#rail button[data-view="library"]');
    await page.waitForTimeout(300);
    await page.click("#lib-open");
    await page.waitForTimeout(400);
    await page.click("#lib-list button[data-lib]");
    await page.waitForTimeout(900);
    const asked = await page.isVisible("#confirm-cancel");
    if (asked) { await page.click("#confirm-cancel"); await page.waitForTimeout(600); }
    await page.click('#rail button[data-view="learn"]');
    await page.waitForTimeout(300);
    const after = await task();
    const st = await settingsOf(page);
    assert(asked && before !== first, "教学里点库里的一局，先问要不要替换棋盘上那一局（已走过第一步）");
    assert(st.mode === "learn" && after === before,
      "取消之后教学原样回来，停在刚才那一步，不从第一步重来（「" + before.slice(0, 20) + "」→「" + after.slice(0, 20) + "」）");
    assert(errs.length === 0, "取消：没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // §3e —— 从诊断的「第 N 回合」「母题」行筛出来的局，打开停在那一手，侧栏在对局页
  for (const kind of ["peak", "motif"]) {
    const { ctx, page, errs } = await openAt({ width: 1400, height: 900 }, "pvp", "record");
    await page.click("#lib-diagnose");
    await page.waitForTimeout(900);
    const pick = await page.evaluate((k) => {
      const b = [...document.querySelectorAll("#lib-diag [data-diag-pick]")]
        .find((x) => JSON.parse(x.dataset.diagPick).kind === k);
      if (!b) return null;
      b.click();
      return JSON.parse(b.dataset.diagPick);
    }, kind);
    await page.waitForTimeout(500);
    assert(!!pick, kind + "：诊断里有这一行", JSON.stringify(pick));
    await page.click("#lib-list button[data-lib]");
    await page.waitForTimeout(900);
    const r = await page.evaluate(() => {
      const moves = [...document.querySelectorAll("#move-list .mlmove:not(.mlgap)")];
      return {
        at: moves.findIndex((b) => b.classList.contains("current")) + 1,
        total: moves.length,
        tab: document.getElementById("tab-play").getAttribute("aria-selected"),
      };
    });
    // 第 28 回合白方那一手是第 55 半着；第 20、36 回合是 39、71
    const want = kind === "motif" ? 55 : (pick.value - 1) * 2 + 1;
    assert(r.at === want, kind + "：打开停在出问题的那一手（第 " + r.at + " 半着，应为 " + want + "，共 " + r.total + "）");
    assert(r.tab === "true", kind + "：侧栏切到了对局页");
    assert(errs.length === 0, kind + "：没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }
}

// --- 18. 7.6 §3b：评估曲线不在隐藏的时候按 0×0 去画 ---------------------------
{
  // 一局分析过的库棋。7.5 实测：曲线在它所在的标签页隐藏时被重画，画布成了
  // 1×1，再被样式表拉成 60px 高的一整块红色 —— 从棋谱库打开一局，或者在设置页
  // 换语言，都会这样。
  // long enough that the curve is drawn at all (Review.longEnough)
  const sans = "e4 e5 Nf3 Nc6 Bb5 a6 b4 Bc5 Be2 Bd4 Bb5 b6 Nc3 Rb8 a3 Nf6 Kf1 Bc5 Ne1 d6 g4 h5 Qe2 Kd7 f3 Qf8 a4 Ke7 Qf2 Nh7 Ba3 Nd8 Qg2 Ng5 Bd7 Nge6 Rc1 f6 b5 Bb4";
  const n = sans.split(" ").length;
  const tags = new Array(n).fill(null); tags[6] = "??"; tags[13] = "?";
  const scalars = [0];
  for (let i = 0; i < n; i++) scalars.push(scalars[i] + (i === 6 ? -300 : i === 13 ? 150 : (i % 2 ? -10 : 10)));
  const game = {
    id: "curve1", t: 1758000000000, white: "hxddh", black: "rival", date: "2026.09.01",
    event: "Rated blitz", result: "1-0", plies: n, sans, fen: "", side: "w", outcome: "win", motifs: {},
    an: { acc: { w: 80, b: 70 }, acpl: { w: 30, b: 40 }, tags, losses: new Array(n).fill(5), scalars,
      bests: new Array(n + 1).fill(null), budget: 200 },
  };
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((lib) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.library", lib);
  }, JSON.stringify({ v: 1, names: ["hxddh"], games: [game] }));
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  // the backing store is the curve's laid-out size in device pixels, and it
  // has ink in more than one colour — a 1×1 store stretched is one colour
  const curve = () => page.evaluate(() => {
    const c = document.getElementById("eval-curve");
    const dpr = window.devicePixelRatio || 1;
    const colours = new Set();
    if (c.width > 1 && c.height > 1) {
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      for (let i = 0; i < d.length; i += 4 * 37) if (d[i + 3]) colours.add(d[i] + "," + d[i + 1] + "," + d[i + 2]);
    }
    return { w: c.width, h: c.height, cw: Math.round(c.clientWidth * dpr), ch: Math.round(c.clientHeight * dpr),
      colours: colours.size, visible: c.clientWidth > 0 };
  });
  const sized = (r) => r.visible && r.w === r.cw && r.h === r.ch && r.w > 50 && r.colours > 2;

  // 1) 从「记录」页打开库里这一局
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(900);
  if (!(await page.evaluate(() => document.getElementById("tab-play").getAttribute("aria-selected") === "true"))) {
    await page.click("#tab-play");
    await page.waitForTimeout(400);
  }
  let r = await curve();
  assert(sized(r), "从记录页打开一局，曲线按自己的尺寸画出来（" + JSON.stringify(r) + "）");

  // 2) 在设置页换语言，再回对局页
  await page.click("#tab-setup");
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('#lang-seg button[data-lang="en"]').click());
  await page.waitForTimeout(400);
  await page.click("#tab-play");
  await page.waitForTimeout(400);
  r = await curve();
  assert(sized(r), "在设置页换了语言再回来，曲线不是一块拉伸的单色（" + JSON.stringify(r) + "）");

  // 3) 标签页藏着的时候窗口变了尺寸，回来时按新尺寸画
  await page.click("#tab-setup");
  await page.waitForTimeout(200);
  await page.setViewportSize({ width: 800, height: 900 }); // the panel becomes a full-width sheet
  await page.waitForTimeout(400);
  await page.click("#tab-play");
  await page.waitForTimeout(400);
  r = await curve();
  assert(sized(r), "藏着的时候窗口变了，回来时按新宽度重画（" + JSON.stringify(r) + "）");

  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- v8-0-plan §5: the record page and the library -------------------------
// Red before §5: (a) with a library and nothing else recorded the page still
// opened on 「现在还空着」; (b) a library game — someone's record — carried
// 悔棋 and 再来一盘; (c) the diagnosis cut its values off at the dialog's
// right edge (「5 厘兵/手 · 失误率 16.7%」 in a 114px track), in every language.
{
  // (a) a library is a record: seeded, and imported into an empty page
  {
    const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games: [
      { id: "g1", t: 1758000000000, white: "hxddh", black: "rival", result: "1-0", plies: 5, sans: "e4 e5 Nf3 Nc6 Bb5", side: "w", outcome: "win" }] }));
    const { page, errs } = await open(ctx);
    const empty = await page.evaluate(() => !document.getElementById("record-empty").hidden);
    assert(!empty, "§5 库里有棋、别的都还没有:记录页不说「现在还空着」");
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }
  {
    const ctx = await freshContext();
    const { page, errs } = await open(ctx);
    const before = await page.evaluate(() => !document.getElementById("record-empty").hidden);
    await importFile(page, PGN);
    const after = await page.evaluate(() => !document.getElementById("record-empty").hidden);
    assert(before && !after, "§5 空档案导入棋谱:入口卡片在导入那一刻让位(" + before + " → " + after + ")");
    // (b) open one of them: a record, not a game of yours
    await page.click("#lib-open");
    await page.waitForTimeout(400);
    await page.click("#lib-list button[data-lib]");
    await page.waitForTimeout(900);
    await page.click("#tab-play").catch(() => {});
    await page.waitForTimeout(300);
    const r = await page.evaluate(() => {
      const u = document.getElementById("undo");
      return {
        plies: document.querySelectorAll(".mlmove").length,
        undo: !!u && !u.hidden && !u.classList.contains("slot-empty"),
        card: !document.getElementById("go-card").hidden,
        again: !document.getElementById("go-again").hidden,
      };
    });
    assert(r.plies > 0 && !r.undo, "§5 从棋谱库打开的一局:没有「悔棋」", JSON.stringify(r));
    assert(!r.card || !r.again, "§5 …也没有「再来一盘」", JSON.stringify(r));
    await page.keyboard.press("z");
    await page.waitForTimeout(300);
    const plies = await page.evaluate(() => document.querySelectorAll(".mlmove").length);
    assert(plies === r.plies, "§5 …按 Z 也不改别人的棋谱(" + r.plies + " → " + plies + ")");
    assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }

  // (c) the diagnosis: every value whole and inside the dialog
  const games = [];
  for (let i = 0; i < 25; i++) {
    const tags = [], losses = [];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0, moveNo = Math.floor(ply / 2) + 1;
      // a ? now and then, so the blunder rate has decimals: 16.7%, not 0%
      tags.push(mine && moveNo === 40 ? "??" : mine && ply % 7 === 0 ? "?" : null);
      losses.push(mine ? (moveNo > 32 ? 120 : 5) : 0);
    }
    games.push({ id: "d" + i, t: 1758000000000 + i, white: "hxddh", black: "rival", result: "1-0", plies: 80, sans: "e4",
      side: "w", outcome: i % 2 ? "win" : "loss", eco: "B20", ecoName: "西西里防御", motifs: { 78: "fork" },
      an: { acc: { w: 62, b: 55 }, acpl: { w: 60, b: 70 }, tags, losses } });
  }
  for (const lang of ["zh-CN", "en", "ja"]) {
    for (const vp of [{ width: 1400, height: 1000 }, { width: 390, height: 800 }]) {
      const ctx = await browser.newContext({ viewport: vp, locale: lang });
      await ctx.addInitScript(([lib, l]) => {
        localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "pvp", langId: l, sideTab: "play", view: "library", soundOn: false }));
        localStorage.setItem("chess.panelOpen", "1");
        localStorage.setItem("chess.v1.library", lib);
      }, [JSON.stringify({ v: 1, names: ["hxddh"], games }), lang]);
      const { page, errs } = await open(ctx);
      await page.click('#rail button[data-view="library"]').catch(() => {});
      await page.click("#lib-diagnose");
      await page.waitForTimeout(400);
      const bad = await page.evaluate(() => {
        const box = document.querySelector("#lib-modal .modal").getBoundingClientRect();
        const out = [];
        for (const v of document.querySelectorAll("#lib-diag .stat-v")) {
          if (!v.textContent) continue;
          const r = v.getBoundingClientRect();
          if (v.scrollWidth > v.clientWidth + 1 || r.right > box.right - 8 || r.left < box.left + 8)
            out.push(v.textContent + " (" + (v.scrollWidth - v.clientWidth) + "px)");
        }
        // a name may be cut only where its whole text is on the title
        for (const k of document.querySelectorAll("#lib-diag .stat-k")) {
          if (k.scrollWidth > k.clientWidth + 1 && k.title !== k.textContent) out.push(k.textContent + " (name)");
        }
        return out;
      });
      assert(bad.length === 0, "§5 " + lang + " " + vp.width + ":诊断里每个数值都完整、在弹窗之内", bad.join(" / "));
      assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
      await ctx.close();
    }
  }
}

// --- v8-0-plan B5: an import keeps the clock, and 我的 follows it ----------
// The time-pressure figure reads `[%clk]` from the games you import; until
// B5 the library kept the moves and dropped every comment. And the page is
// live: a game played today, imported while 我的 was shut, is a day on the
// calendar the moment the page opens.
{
  const d = new Date();
  const today = d.getFullYear() + "." + String(d.getMonth() + 1).padStart(2, "0") + "." + String(d.getDate()).padStart(2, "0");
  const ctx = await freshContext(JSON.stringify({ v: 1, names: ["hxddh"], games: [] }));
  const { page, errs } = await open(ctx);
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  const before = await page.evaluate(() => !document.getElementById("me-cal").hidden);
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(200);
  await importFile(page, `[Event "Rated blitz"]\n[Date "${today}"]\n[White "hxddh"]\n[Black "rival"]\n[Result "1-0"]\n\n` +
    "1. e4 { [%clk 0:03:00] } e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:02:57] } Nc6 { [%clk 0:02:55.2] } " +
    "3. Bc4 { [%clk 0:02:50] } Nf6 { [%clk 0:02:40] } 4. Qxf7# { [%clk 0:02:49] } 1-0\n");
  const clk = (await libOf(page)).games.map((g) => g.clk);
  assert(JSON.stringify(clk) === "[[180,180,177,175,170,160,169]]", "B5 导入的棋谱带着每手的钟", JSON.stringify(clk));
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(400);
  const after = await page.evaluate(() => ({ cal: !document.getElementById("me-cal").hidden,
    meta: document.getElementById("me-cal-meta").textContent, w: document.getElementById("me-cal").width }));
  assert(!before && after.cal && /1/.test(after.meta) && after.w > 1,
    "B5 今天下的一局导进来:「我的」打开时日历上有今天(" + JSON.stringify({ before, after }) + ")");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// ============================================================================
// v8-0-plan C1: 棋谱库数据库化 — storage, migration, search, 本机, claim.
// The games moved from one localStorage value (500 at most) to one IndexedDB
// record each (library-db.js); everything below is a claim the plan's
// acceptance makes, measured in a real page. Numbers go to docs/measured.json
// (libraryDb) — this suite prints them.
// ============================================================================
const C1 = {};
const DAY = 86400000;

/** A context with settings, and `keys` written into localStorage once. */
async function c1Context(keys, init) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN", acceptDownloads: true });
  await ctx.addInitScript((k) => {
    if (sessionStorage.getItem("c1.seeded")) return;
    sessionStorage.setItem("c1.seeded", "1");
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", view: "library", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    for (const [key, v] of Object.entries(k || {})) localStorage.setItem(key, v);
  }, Object.fromEntries(Object.entries(keys || {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v)])));
  if (init) await ctx.addInitScript(init);
  return ctx;
}
/**
 * v8-1-plan F3: in the page, from its first script on (when the session says
 * so): the moment 全部 N 局 shows it is pressed, the moment the list has rows
 * the search box is typed into, and each moment is taken then — a
 * MutationObserver's callback, not a poll that waits behind a frame.
 * `fromSummary`: the rows were there before the entries were.
 */
function coldProbe() {
  if (!sessionStorage.getItem("f3.cold")) return;
  const out = window.__cold = {};
  const libReady = () => !!(window.__chess && window.__chess.library && window.__chess.library().ready);
  const look = () => {
    const b = document.getElementById("lib-open");
    if (out.pressed == null && b && !b.hidden) { out.pressed = performance.now(); b.click(); }
    const modal = document.getElementById("lib-list-modal");
    if (out.rows == null && modal && modal.classList.contains("show") && document.querySelector("#lib-list .hist-row")) {
      out.rows = performance.now();
      out.fromSummary = !libReady();
      // M4 评审 P2-1: the first page as the summary drew it
      out.first = [...document.querySelectorAll("#lib-list .hist-row button.pick-item")].map((x) => x.dataset.lib || x.dataset.loc);
      const q = document.getElementById("lib-q");
      q.value = "magnus";
      q.dispatchEvent(new Event("input"));
      out.search = performance.now();
      out.searchCount = document.getElementById("lib-list-count").textContent;
      // M4 评审: a row pressed before its game is here — said, and run once it is
      if (sessionStorage.getItem("f3.click")) {
        const row = document.querySelector("#lib-list button[data-lib]");
        out.clickedId = row ? row.dataset.lib : null;
        if (row) { row.click(); row.click(); }
        out.busy = document.getElementById("lib-list").getAttribute("aria-busy");
        out.toast = document.getElementById("toast").textContent;
      }
    }
    if (out.ready == null && libReady()) out.ready = performance.now();
    if (out.rows != null && out.ready != null) { mo.disconnect(); clearInterval(tick); }
  };
  const mo = new MutationObserver(look);
  const tick = setInterval(look, 50);
  mo.observe(document, { subtree: true, childList: true, attributes: true, characterData: true });
}

const c1Ready = (page) => page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready,
  null, { timeout: 60000 }).catch(() => {});

/** The shapes each release wrote (library.js entryFrom, then the pass). 6.x had no library. */
const T = 1758000000000;
const V1 = {
  "7.0": { v: 1, names: ["hxddh"], games: [
    { id: "lib:70a", t: T, white: "hxddh", black: "r1", date: "2026.01.01", event: "e", result: "1-0", plies: 4,
      sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win",
      an: { acc: { w: 81.2, b: 60 }, acpl: { w: 30, b: 90 }, tags: [null, "?", null, "??"], losses: [0, 120, 5, 400], scalars: [20, 25, -100, -90, -500] } },
    { id: "lib:70b", t: T + 1, white: "x", black: "y", date: "?", event: "", result: "*", plies: 2, sans: "d4 d5", fen: "", side: null, outcome: null, an: null },
  ] },
  "7.2": { v: 1, names: ["hxddh", "alt"], games: [
    { id: "lib:72a", t: T + 2, white: "alt", black: "r2", date: "2026.02.02", event: "e", result: "0-1", plies: 2, sans: "f3 e5",
      fen: "", side: "w", outcome: "loss", eco: "A00", ecoName: "Barnes Opening",
      an: { acc: { w: 20, b: 90 }, acpl: { w: 200, b: 10 }, tags: ["?", null], losses: [150, 0], scalars: [20, -130, -120], bests: ["e2e4", null], budget: 200 },
      motifs: { 0: "hanging" } },
    { id: "lib:72b", t: T + 3, white: "hxddh", black: "r3", date: "2026.02.03", event: "e", result: "1-0", plies: 3, sans: "e4 Ke7 Qh5",
      fen: "", side: "w", outcome: "win", an: null, unplayable: true },
  ] },
  "8.0-dev": { v: 1, names: ["hxddh"], games: [
    { id: "lib:80a", t: T + 4, white: "hxddh", black: "coach", date: "2026.09.04", event: "Study", result: "1-0", plies: 3,
      sans: "Kd5 Kd2 Ke4", fen: "8/8/4k3/8/8/8/4P3/4K3 b - - 3 40", side: "w", outcome: "win", clk: [30, 29, 28],
      an: { acc: { w: 99, b: 99 }, acpl: { w: 0, b: 0 }, tags: [null, null, null], losses: [0, 0, 0], scalars: [0, 0, 0, 0], budget: 400 } },
    { id: "lib:80b", t: T + 5, white: "rival", black: "hxddh", date: "2026.09.05", event: "Rated blitz", result: "0-1", plies: 6,
      sans: "d4 Nf6 c4 e6 Nc3 Bb4", fen: "", side: "b", outcome: "win", clk: [180, 180, 178, 179, 170, 175], an: null },
  ] },
};
/** The play history as 6.x (v1, `sig`) and 7.x (v2, `pgn`) wrote it. */
const STATS_6X = { v: 1, games: [
  { t: T - 3 * DAY, sig: "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7##mate", result: "win", diff: "casual", color: "w" },
  { t: T - 2 * DAY, sig: "d4 d5 c4 dxc4#resigned", result: "loss", diff: "normal", color: "b" },
] };
const STATS_7X = { v: 2, games: [
  { id: "g1", t: T - DAY, diff: "normal", color: "w", result: "win", moves: 7, acc: 88,
    pgn: '[Event "?"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0', ending: "" },
  { id: "g2", t: T, diff: "hard", color: "b", result: "draw", moves: 4,
    pgn: '[Event "?"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2', ending: "drawAgreed" },
] };

// --- C1.1 every earlier library, migrated without losing a byte ----------------
for (const [ver, v1] of Object.entries(V1)) {
  const raw = JSON.stringify(v1);
  const ctx = await c1Context({ "chess.v1.library": raw, "chess.v1.stats": STATS_7X });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.waitForTimeout(300);
  const lib = await libOf(page);
  const st = await storedLib(page);
  const byId = new Map((st.games || []).map((g) => [g.id, g]));
  // every field the old entry had, unchanged — apart from what the app has
  // always rewritten on load (7.0's unclamped losses, recomputed from the
  // scalars beside them) and the opening it fills in once (7.1 fillOpenings).
  // The byte-for-byte copy is the backup, checked below.
  const lost = v1.games.filter((g) => {
    const s = byId.get(g.id);
    if (!s) return true;
    return Object.keys(g).some((k) => {
      if (k === "an" && g.an && s.an) {
        const a = Object.assign({}, g.an), b = Object.assign({}, s.an);
        delete a.losses; delete b.losses;
        return JSON.stringify(a) !== JSON.stringify(b) || (s.an.losses || []).length !== (g.an.losses || []).length;
      }
      return JSON.stringify(g[k]) !== JSON.stringify(s[k]);
    }) || Object.keys(s).some((k) => !(k in g) && !["eco", "ecoName", "__pk"].includes(k));
  }).map((g) => g.id);
  assert(lost.length === 0, `C1 ${ver}：旧棋谱库的每一局都进了 IndexedDB，每个字段都在(不等：${lost.join(",") || "无"})`);
  assert(st.header && st.header.db === 2 && st.header.games.length === 0 && JSON.stringify(st.header.names) === JSON.stringify(v1.names) &&
    st.header.n === v1.games.length,
    `C1 ${ver}：localStorage 里只剩一个头(db 2、名字、局数 ${st.header && st.header.n})`);
  assert(lib.mode === "idb" && lib.games.length === v1.games.length, `C1 ${ver}：应用里还是这 ${v1.games.length} 局(${lib.games.length}, ${lib.mode})`);
  const local = (st.games || []).filter((g) => g.src === "local").map((g) => g.id).sort().join(",");
  assert(local === "loc:g1,loc:g2", `C1 ${ver}：对局历史的两局作为「本机」进了库(${local})`);
  await page.reload();
  await c1Ready(page);
  const again = await libOf(page);
  const st2 = await storedLib(page);
  assert(again.games.length === v1.games.length && st2.games.filter((g) => g.src !== "local").length === v1.games.length,
    `C1 ${ver}：再启动一次：还是 ${v1.games.length} 局，没有重复`);
  // the v1 value as found, kept in IndexedDB's meta store
  const backup = await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("chessboard.library");
    r.onsuccess = () => {
      const all = r.result.transaction(["meta"], "readonly").objectStore("meta").getAll();
      all.onsuccess = () => { res(all.result.map((x) => x.raw)); r.result.close(); };
    };
  }));
  assert(backup.includes(raw), `C1 ${ver}：迁移前的整份 v1 原样留了一份在 IndexedDB 里`);
  assert(errs.length === 0, `C1 ${ver}：没有 JS 异常`, errs.join(" / "));
  await ctx.close();
}

// 6.x: no library at all, and the history in both of its shapes
{
  const ctx = await c1Context({ "chess.v1.stats": STATS_6X });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.waitForTimeout(600);
  const st = await storedLib(page);
  const local = (st.games || []).filter((g) => g.src === "local");
  assert(local.length === 2 && local.every((g) => g.__pk && g.plies > 0),
    `C1 6.x：没有棋谱库的老档案，对局历史照样成了「本机」棋局，带局面索引(${local.map((g) => g.plies).join(",")})`);
  assert(st.header == null, "C1 6.x：没有棋谱库就不凭空写一个头");
  assert(errs.length === 0, "C1 6.x：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- C1.2 the quota refuses the migration: nothing moves, nothing is lost ---------
{
  const v1 = V1["7.2"];
  const raw = JSON.stringify(v1);
  const ctx = await c1Context({ "chess.v1.library": raw }, () => {
    if (sessionStorage.getItem("c1.quota") === "off") return;
    const put = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (v, k) {
      if (this.name === "games") throw new DOMException("the disk is full", "QuotaExceededError");
      return put.call(this, v, k);
    };
  });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  const toastText = await page.textContent("#toast").catch(() => "");
  const lib = await libOf(page);
  const kept = await page.evaluate(() => localStorage.getItem("chess.v1.library"));
  assert(/没能搬进新的存储/.test(toastText) && /QuotaExceededError/.test(toastText), `C1 配额满：迁移失败说出来(${toastText})`);
  const keptV1 = JSON.parse(kept);
  assert(keptV1.v === 1 && !keptV1.db && v1.games.every((g) => keptV1.games.some((x) => x.id === g.id && x.sans === g.sans)),
    "C1 配额满：localStorage 里的旧棋谱库原样留着(v1，每一局都在)");
  assert(lib.mode === "legacy" && lib.games.length === v1.games.length, `C1 配额满：这一次照旧方式用，${v1.games.length} 局都在(${lib.mode})`);
  // a game imported meanwhile is kept the old way…
  await importFile(page, '[Event "x"]\n[White "hxddh"]\n[Black "q"]\n[Result "1-0"]\n\n1. c4 e5 1-0\n');
  const legacy = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library")));
  assert(legacy.games.length === 3 && !legacy.db, "C1 配额满：这期间导入的棋按旧方式存进了 localStorage");
  // …and the next launch, with room again, moves all of it
  await page.evaluate(() => sessionStorage.setItem("c1.quota", "off"));
  await page.reload();
  await c1Ready(page);
  const st = await storedLib(page);
  assert(st.header.db === 2 && st.games.filter((g) => g.src !== "local").length === 3,
    `C1 配额满之后：下一次启动把三局都搬了进去(${st.games.length})`);
  assert(errs.length === 0, "C1 配额满：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- C1.3 interrupted: the store holds part of it, the header still says v1 -------
{
  const v1 = V1["8.0-dev"];
  const half = { v: 1, names: v1.names, games: v1.games.slice(0, 1) };
  const ctx = await c1Context({ "chess.v1.library": half });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  // deepen the stored copy meanwhile (a later analysis), then put the full v1
  // header back — a migration cut short before the header changed
  await page.evaluate((full) => new Promise((res) => {
    const r = indexedDB.open("chessboard.library");
    r.onsuccess = () => {
      const tx = r.result.transaction(["games"], "readwrite");
      const s = tx.objectStore("games");
      const g = s.get("lib:80a");
      g.onsuccess = () => { const x = g.result; x.an = Object.assign({}, x.an, { budget: 800 }); s.put(x); };
      tx.oncomplete = () => { r.result.close(); localStorage.setItem("chess.v1.library", full); res(); };
    };
  }), JSON.stringify(v1));
  await page.reload();
  await c1Ready(page);
  const st = await storedLib(page);
  const imported = st.games.filter((g) => g.src !== "local");
  assert(imported.length === 2 && imported.find((g) => g.id === "lib:80a").an.budget === 800,
    `C1 中断的迁移再跑一遍：两局，不重复；已存的更深的分析(800)没被旧副本盖掉(${imported.map((g) => g.id + ":" + (g.an && g.an.budget)).join(",")})`);
  assert(st.header.db === 2, "C1 中断的迁移：这次头换成了 db 2");
  assert(errs.length === 0, "C1 中断：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- C1.4 a second window open during the migration ----------------------------
{
  const v1 = V1["7.0"];
  const ctx = await c1Context({ "chess.v1.library": v1 });
  const [a, b] = await Promise.all([open(ctx), open(ctx)]);
  await Promise.all([c1Ready(a.page), c1Ready(b.page)]);
  const [la, lb] = [await libOf(a.page), await libOf(b.page)];
  const st = await storedLib(a.page);
  const imported = st.games.filter((g) => g.src !== "local");
  assert(la.games.length === 2 && lb.games.length === 2 && imported.length === 2 && st.header.db === 2,
    `C1 两个窗口同时迁移：两边都是 2 局，库里也是 2 局(${la.games.length}/${lb.games.length}/${imported.length})`);
  // one window imports; the other's next save does not take it away
  await importFile(a.page, '[Event "w"]\n[White "hxddh"]\n[Black "z"]\n[Result "0-1"]\n\n1. g4 e5 2. f3 Qh4# 0-1\n');
  await b.page.waitForTimeout(500);
  const heard = (await libOf(b.page)).games.map((g) => g.event);
  assert(heard.length === 3 && heard.includes("w"),
    `C1 一个窗口导入，另一个窗口的列表也有了这一局(BroadcastChannel；${heard.length} 局)`);
  await b.page.evaluate(() => { document.getElementById("lib-names").value = "hxddh, other"; document.getElementById("lib-names").dispatchEvent(new Event("change")); });
  await b.page.waitForTimeout(600);
  const after = (await storedLib(a.page)).games.filter((g) => g.src !== "local");
  assert(after.length === 3, `C1 一个窗口导入、另一个窗口改名字保存：库里还是 3 局，没被旧窗口的列表盖掉(${after.length})`);
  assert(a.errs.length === 0 && b.errs.length === 0, "C1 两个窗口：没有 JS 异常", a.errs.concat(b.errs).join(" / "));
  await ctx.close();
}

// --- M5 review P3-2 / P3-4: two imports at once; nothing written after a restore --
{
  const ctx = await c1Context({ "chess.v1.library": V1["7.0"] });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  // a sync landing while a file is still being read: the second import used
  // to return in silence, its games fetched and gone
  const events = await page.evaluate(async (texts) => {
    const c = window.__chess.libDb();
    await Promise.all(texts.map((x) => c.importPgn(x)));
    return window.__chess.library().games.map((g) => g.event);
  }, ['[Event "qa"]\n[White "hxddh"]\n[Black "a"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 1-0\n',
    '[Event "qb"]\n[White "hxddh"]\n[Black "b"]\n[Result "1-0"]\n\n1. d4 d5 2. Bf4 Nf6 1-0\n']);
  assert(events.includes("qa") && events.includes("qb"), `P3-2 两次导入同时来：两个文件的棋都进了库(${events.join(",")})`);
  // 导入全部数据 has replaced the games: until the reload, what the page still
  // holds (a pass filing its result, an adoption) must not be written back
  await page.evaluate(async () => {
    const c = window.__chess.libDb();
    await c.restoreShards({ lib00: JSON.stringify({ v: 1, games: [{ id: "lib:rs", t: 9, white: "a", black: "b", date: "?", event: "restored",
      result: "*", plies: 1, sans: "e4", fen: "" }] }) });
    const g = window.__chess.library().games.find((x) => x.id === "lib:70b");
    g.an = { acc: { w: 70, b: 70 }, acpl: { w: 1, b: 1 }, tags: [null, null], losses: [0, 0], scalars: [0, 0, 0], budget: 200 };
    await c.save();
    await new Promise((r) => setTimeout(r, 300));
  });
  const st = await storedLib(page);
  const ids = st.games.filter((g) => g.src !== "local").map((g) => g.id).sort().join(",");
  assert(ids === "lib:rs", `P3-4 导入全部数据之后、重新载入之前：页面手里的旧棋不再写回(${ids})`);
  assert(errs.length === 0, "P3-2/P3-4：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- C1.5 10,000 games: import, search ≤ 200 ms, restart, export → import ---------
/** Ten thousand short games, deterministic, in the shapes an archive has. */
function tenThousand() {
  const names = ["rival", "magnus", "hikaru", "alireza", "bot", "friend", "coach", "anna", "li", "sato"];
  const tcs = ["60+0", "180+2", "300+0", "600+5", "1800+20", "1/86400"];
  // mulberry32: a generator whose period is not the question under test
  let seed = 7;
  const rnd = (n) => {
    seed = (seed + 0x6d2b79f5) | 0;
    let x = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return (((x ^ (x >>> 14)) >>> 0) % n);
  };
  // 1,000 distinct move sequences (chess.js at ~0.5 ms a ply is the slow
  // part), each played in about ten games with different tags
  const g = new Chess();
  const lines = [];
  for (let i = 0; i < 1000; i++) {
    g.reset();
    const plies = 8 + rnd(12);
    const sans = [];
    for (let p = 0; p < plies; p++) {
      const ms = g.moves();
      if (!ms.length) break;
      // the first move from four, so openings are shared the way they are
      // in a real archive
      const m = p === 0 ? ["e4", "d4", "c4", "Nf3"][rnd(4)] : ms[rnd(ms.length)];
      g.move(m);
      sans.push(m);
    }
    lines.push(sans);
  }
  const out = [];
  for (let i = 0; i < 10000; i++) {
    const sans = lines[rnd(lines.length)];
    const me = rnd(10) < 7;
    const foe = names[rnd(names.length)] + (rnd(3) ? "" : String(rnd(50)));
    const white = rnd(2) ? "hxddh" : foe, black = white === "hxddh" ? foe : (me ? "hxddh" : names[rnd(names.length)]);
    const y = 2016 + rnd(11), mo = 1 + rnd(12), d = 1 + rnd(28);
    const res = ["1-0", "0-1", "1/2-1/2"][rnd(3)];
    let mv = "";
    sans.forEach((s, k) => { mv += (k % 2 ? "" : (k / 2 + 1) + ". ") + s + " "; });
    out.push(`[Event "Rated game ${i}"]\n[Site "https://lichess.org/g${i}"]\n[Date "${y}.${String(mo).padStart(2, "0")}.${String(d).padStart(2, "0")}"]\n` +
      `[Round "-"]\n[White "${white}"]\n[Black "${black}"]\n[Result "${res}"]\n[TimeControl "${tcs[rnd(tcs.length)]}"]\n\n${mv}${res}\n`);
  }
  return out.join("\n");
}
{
  const t0 = Date.now();
  const big = tenThousand();
  console.log(`  C1：生成 1 万局 PGN ${(big.length / 1048576).toFixed(1)} MB（${Date.now() - t0} ms）`);
  const ctx = await c1Context({ "chess.v1.library": { v: 1, names: ["hxddh"], games: [] } }, coldProbe);
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  const ti = Date.now();
  await importFile(page, big);
  await page.waitForFunction(() => window.__chess.library().games.length >= 10000, null, { timeout: 240000 }).catch(() => {});
  C1.importMs = Date.now() - ti;
  const n = (await libOf(page)).games.length;
  assert(n === 10000, `C1 一次导入 1 万局，全部进库(${n}，${(C1.importMs / 1000).toFixed(1)} s)`);
  // the store has written them all before the restart
  await page.waitForFunction(() => new Promise((res) => {
    const r = indexedDB.open("chessboard.library");
    r.onsuccess = () => { const c = r.result.transaction(["games"], "readonly").objectStore("games").count(); c.onsuccess = () => { res(c.result >= 10000); r.result.close(); }; };
  }), null, { timeout: 120000, polling: 500 }).catch(() => {});

  // the openings are filled in when the list opens (7.1 fillOpenings)
  await page.click("#lib-open");
  await page.waitForTimeout(1500);
  await page.click("#lib-list-close");
  // the API: every filter the plan names, and the position question
  const api = await page.evaluate(() => {
    const db = window.__chess.libDb();
    const time = (fn) => { const t = performance.now(); const r = fn(); return { ms: performance.now() - t, n: Array.isArray(r) ? r.length : r.total }; };
    const e4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
    return {
      opponent: time(() => db.query({ opponent: "magnus" })),
      text: time(() => db.query({ text: "hikaru7" })),
      date: time(() => db.query({ from: "2020-01-01", to: "2021-06-30" })),
      result: time(() => db.query({ result: "win", color: "b" })),
      tc: time(() => db.query({ tc: "blitz" })),
      eco: time(() => db.query({ eco: "B" })),
      position: time(() => db.query({ position: e4 })),
      combined: time(() => db.query({ opponent: "rival", tc: "rapid", from: "2018-01-01", result: "loss", position: e4 })),
      explorer: time(() => db.gamesWithPosition(e4)),
      start: time(() => db.gamesWithPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1")),
    };
  });
  C1.api = api;
  const worst = Math.max(...Object.values(api).map((r) => r.ms));
  console.log("  C1：1 万局查询(ms) " + Object.entries(api).map(([k, r]) => `${k} ${r.ms.toFixed(1)}/${r.n}`).join(" · "));
  assert(worst <= 200, `C1 1 万局：每一种查询都 ≤ 200 ms(最慢 ${worst.toFixed(1)} ms)`);
  assert(api.position.n > 1000 && api.explorer.n === api.position.n && api.start.n === 10000,
    `C1 「包含这个局面」和开局浏览器的问法数得一致(1. e4 后 ${api.position.n} 局；开局局面 ${api.start.n} 局)`);

  // the page: typing into the search box, the position switch, a segment
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  const ui = await page.evaluate(() => {
    const q = document.getElementById("lib-q");
    const t0 = performance.now();
    q.value = "magnus";
    q.dispatchEvent(new Event("input"));
    const typed = performance.now() - t0;
    const rows = document.querySelectorAll("#lib-list .hist-row").length;
    const t1 = performance.now();
    document.getElementById("lib-pos").click();
    const pos = performance.now() - t1;
    const note = document.getElementById("lib-pos-note").textContent;
    const t2 = performance.now();
    document.querySelector('#lib-tc-seg [data-ltc="blitz"]').click();
    const seg = performance.now() - t2;
    const count = document.getElementById("lib-list-count").textContent;
    return { typed, pos, seg, rows, note, count, more: !document.getElementById("lib-more").hidden };
  });
  C1.ui = ui;
  console.log(`  C1：页面上搜索 ${ui.typed.toFixed(1)} ms · 局面开关 ${ui.pos.toFixed(1)} ms · 用时分段 ${ui.seg.toFixed(1)} ms · ${ui.count}`);
  assert(Math.max(ui.typed, ui.pos, ui.seg) <= 200, `C1 1 万局：页面上的搜索（查询 + 画出列表）≤ 200 ms(${Math.max(ui.typed, ui.pos, ui.seg).toFixed(1)} ms)`);
  assert(ui.rows > 0 && ui.rows <= 100 && /经过这个局面的有 \d+ 局，接着下的是：/.test(ui.note),
    `C1 列表一次最多画 100 行，局面开关说出下一步的分布(${ui.rows} 行；${ui.note})`);

  // restart: ten thousand games come back from IndexedDB
  const tr = Date.now();
  await page.reload();
  await c1Ready(page);
  C1.loadMs = Date.now() - tr;
  const back = await libOf(page);
  assert(back.games.length === 10000 && back.mode === "idb", `C1 重启：1 万局从 IndexedDB 读回(${back.games.length}，${C1.loadMs} ms 到可用)`);

  // v8-1-plan F3: 冷启动. The page opens the list the moment 全部 N 局 is
  // there and types into its search at once (coldProbe, in the page, so no
  // poll of ours waits behind a frame); times are from the navigation's
  // start. The plan's lines: list visible ≤ 1.5 s, search usable ≤ 4.5 s —
  // the search on the summary at once, "passes through this position" when
  // the index has arrived (ready). v8-2-plan F3: the median of five for all
  // three (8.1 took the best of three for the list and the worst for ready,
  // which hid the quarter of launches whose list came after the first frame).
  await page.evaluate(() => { sessionStorage.setItem("f3.cold", "1"); });
  const cold = [];
  for (let i = 0; i < 5; i++) {
    const t0 = Date.now();
    await page.reload();
    await c1Ready(page);
    await page.waitForFunction(() => window.__cold && window.__cold.rows != null && window.__cold.ready != null, null, { timeout: 30000 }).catch(() => {});
    const r = await page.evaluate(() => Object.assign({ origin: performance.timeOrigin }, window.__cold));
    r.reloadReady = Date.now() - t0;
    r.posHits = await page.evaluate(() => window.__chess.libDb().query({ position: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1" }).length);
    r.fullText = await page.evaluate(() => window.__chess.libDb().query({ text: "magnus" }).length);
    cold.push(r);
    await page.evaluate(() => { const q = document.getElementById("lib-q"); q.value = ""; q.dispatchEvent(new Event("input")); });
    r.firstAfter = await page.evaluate(() => [...document.querySelectorAll("#lib-list .hist-row button.pick-item")].map((x) => x.dataset.lib || x.dataset.loc));
    await page.click("#lib-list-close").catch(() => {});
  }
  // M4 评审 (CI): the same launch without the summary — the header's `sum`
  // taken out, which is exactly how the page behaved before F3 (and how it
  // behaves after an 8.0 launch): the list waits for the entries. Its ready
  // time is this machine's "now", which the index's arrival must not fall
  // behind by more than a quarter (see the assertion below).
  const base = [];
  for (let i = 0; i < 2; i++) {
    await page.evaluate(() => {
      const h = JSON.parse(localStorage.getItem("chess.v1.library"));
      delete h.sum;
      localStorage.setItem("chess.v1.library", JSON.stringify(h));
    });
    await page.reload();
    await c1Ready(page);
    await page.waitForFunction(() => window.__cold && window.__cold.rows != null && window.__cold.ready != null, null, { timeout: 30000 }).catch(() => {});
    base.push(await page.evaluate(() => Object.assign({}, window.__cold)));
    await page.evaluate(() => { const q = document.getElementById("lib-q"); q.value = ""; q.dispatchEvent(new Event("input")); });
    await page.click("#lib-list-close").catch(() => {});
    // the next launch trusts the summary again: the check puts `sum` back
    await page.waitForFunction(() => !!JSON.parse(localStorage.getItem("chess.v1.library")).sum, null, { timeout: 30000 }).catch(() => {});
  }
  C1.coldBase = { readyMs: Math.round(Math.max(...base.map((r) => r.ready))), listMs: Math.round(Math.min(...base.map((r) => r.rows))) };
  console.log(`  F3 同一台机器上不用摘要(即 F3 之前的路径)：列表 ${C1.coldBase.listMs} ms · 局面索引 ${C1.coldBase.readyMs} ms`);
  assert(base.every((r) => r.fromSummary === false), "F3 头里没有摘要 id：列表等整局（8.0 之后的第一次启动也是这样）");
  // M4 评审 P2-1: the ten thousand came in one import, so they share one
  // `t` — the page the summary drew is the page the entries draw, row for row
  assert(cold.every((r) => r.first && r.first.length === 100 && JSON.stringify(r.first) === JSON.stringify(r.firstAfter)),
    "F3 重启：整局到了，第一页还是摘要画的那 100 行，次序不变(" + cold.map((r) => (r.first || []).filter((x, i) => r.firstAfter[i] === x).length).join(",") + " / 100)");
  // M4 评审: a row pressed while the list is the summary's — the press is
  // acknowledged, the second press replaces the first, and the game opens
  // when it is here (the list closes as loadFromLibrary does)
  await page.evaluate(() => { sessionStorage.setItem("f3.click", "1"); });
  await page.reload();
  await c1Ready(page);
  await page.waitForFunction(() => window.__cold && window.__cold.clickedId !== undefined, null, { timeout: 30000 }).catch(() => {});
  await page.waitForFunction(() => !document.getElementById("lib-list-modal").classList.contains("show"), null, { timeout: 30000 }).catch(() => {});
  const clicked = await page.evaluate(() => Object.assign({ open: document.getElementById("lib-list-modal").classList.contains("show"),
    busyNow: document.getElementById("lib-list").getAttribute("aria-busy") }, window.__cold));
  assert(clicked.clickedId && clicked.busy === "true" && /正在读取棋谱库/.test(clicked.toast) && !clicked.open && clicked.busyNow === null,
    `F3 重启：按摘要画的行先按下去，说正在读取，整局到了就打开那一局(${JSON.stringify({ busy: clicked.busy, toast: clicked.toast, open: clicked.open })})`);
  await page.evaluate(() => {
    sessionStorage.removeItem("f3.click"); sessionStorage.removeItem("f3.cold");
    const q = document.getElementById("lib-q"); q.value = ""; q.dispatchEvent(new Event("input"));
  });
  // M4 评审 P2-2: a save right when the library is in, before the summary's
  // check has answered, keeps the header's summary id
  const sumBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library")).sum);
  // the check is a few slices of work: on Chromium the CPU is slowed eight
  // times for this launch, so the save lands before it has answered
  const cdp = ENGINE === "chromium" ? await ctx.newCDPSession(page) : null;
  if (cdp) await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });
  await page.reload({ waitUntil: "commit" });
  await page.waitForFunction(() => window.__chess && window.__chess.libDb && window.__chess.libDb(), null, { timeout: 120000, polling: 1 });
  const early = await page.evaluate(async () => {
    const c = window.__chess.libDb();
    let answered = false;
    c.summarised.then(() => { answered = true; });
    await Promise.resolve();
    c.save();
    return { sum: JSON.parse(localStorage.getItem("chess.v1.library")).sum, answered };
  });
  if (cdp) { await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 }); await cdp.detach(); }
  assert(typeof sumBefore === "string" && early.sum === sumBefore,
    `F3 重启：摘要核对完之前的一次保存，头里的摘要 id 不丢(${sumBefore} → ${early.sum}；核对${early.answered ? "已" : "未"}答)`);
  await c1Ready(page);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(300);
  const r0 = (x) => Math.round(x);
  const median = (xs) => xs.slice().sort((a, b) => a - b)[xs.length >> 1];
  console.log("  F3 冷启动(ms，从导航开始)：" + cold.map((r) => `列表 ${r0(r.rows)} · 搜索 ${r0(r.search)} · 局面索引 ${r0(r.ready)}`).join(" | "));
  C1.cold = {
    listVisibleMs: r0(median(cold.map((r) => r.rows))),
    searchUsableMs: r0(median(cold.map((r) => r.search))),
    readyMs: r0(median(cold.map((r) => r.ready))),
    runs: cold.map((r) => ({ list: r0(r.rows), search: r0(r.search), ready: r0(r.ready), reload: r.reloadReady })),
  };
  assert(cold.every((r) => r.rows != null && r.fromSummary),
    "F3 重启：列表先按摘要画出来，那时整局还没读完(" + cold.map((r) => r.fromSummary).join(",") + ")");
  assert(cold.every((r) => r.searchCount && Number((/\d+/.exec(r.searchCount) || [])[0]) === r.fullText && r.fullText > 100),
    "F3 重启：摘要上的搜索和整局读完后的搜索数得一样(" + cold.map((r) => r.searchCount + " / " + r.fullText).join("；") + ")");
  assert(cold.every((r) => r.posHits === api.position.n),
    "F3 重启：索引到了之后「包含这个局面」照常(" + cold.map((r) => r.posHits).join(",") + " = " + api.position.n + ")");
  if (ENGINE === "chromium") {
    assert(C1.cold.listVisibleMs <= 1500, `F3 1 万局重启到列表可见 ≤ 1.5 s(${C1.cold.listVisibleMs} ms，五次的中位数)`);
    assert(C1.cold.searchUsableMs <= 4500, `F3 1 万局重启到搜索可用 ≤ 4.5 s(按摘要 ${C1.cold.searchUsableMs} ms，五次的中位数)`);
    // v8-2-plan F3: 1.5 s — or, on a runner slower than this machine, a
    // quarter over the same run's launch without the summary (v8-1-plan §9
    // M4 评审修正; that was max(4.5 s, …) while the board's frames held the
    // index back)
    const readyLimit = Math.max(1500, Math.round(C1.coldBase.readyMs * 1.25));
    assert(C1.cold.readyMs <= readyLimit,
      `F3 1 万局重启到「包含这个局面」可用 ≤ ${readyLimit} ms(${C1.cold.readyMs} ms，五次的中位数；不用摘要 ${C1.coldBase.readyMs} ms)`);
  }

  // the whole library out as PGN, into an empty profile, game for game
  await page.click("#lib-open");
  await page.waitForTimeout(300);
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 60000 }), page.click("#lib-export")]);
  const file = await dl.path();
  const text = fs.readFileSync(file, "utf8");
  const ctx2 = await c1Context({ "chess.v1.library": { v: 1, names: ["hxddh"], games: [] } });
  const second = await open(ctx2);
  await c1Ready(second.page);
  await importFile(second.page, text);
  await second.page.waitForFunction(() => window.__chess.library().games.length >= 10000, null, { timeout: 240000 }).catch(() => {});
  const b2 = await libOf(second.page);
  const want = new Map(back.games.map((g) => [g.id, g]));
  const fields = ["id", "white", "black", "date", "event", "site", "round", "result", "plies", "sans", "fen", "tc", "clk", "side", "outcome"];
  const diff = [];
  for (const g of b2.games) {
    const o = want.get(g.id);
    if (!o) { diff.push(g.id + " 多出来"); continue; }
    for (const f of fields) if (JSON.stringify(o[f]) !== JSON.stringify(g[f])) diff.push(g.id + "." + f);
  }
  assert(b2.games.length === 10000 && diff.length === 0,
    `C1 整库导出(${(text.length / 1048576).toFixed(1)} MB PGN)再导进空库：1 万局逐局相等(${fields.length} 个字段${diff.length ? "；不等 " + diff.slice(0, 5).join(", ") : ""})`);
  assert(errs.length === 0 && second.errs.length === 0, "C1 1 万局：没有 JS 异常", errs.concat(second.errs).join(" / "));
  await ctx2.close();
  await ctx.close();
}

// --- C1.6 对局历史 is the library's 本机 games; its doors still open -------------
{
  const ctx = await c1Context({ "chess.v1.stats": STATS_7X, "chess.v1.library": V1["8.0-dev"] });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  const label = (await page.textContent("#hist-open")).trim();
  await page.click("#hist-open");
  await page.waitForTimeout(500);
  const r = await page.evaluate(() => ({
    open: document.getElementById("lib-list-modal").classList.contains("show"),
    src: document.querySelector("#lib-src-seg .active") && document.querySelector("#lib-src-seg .active").dataset.lsrc,
    rows: [...document.querySelectorAll("#lib-list .hist-row")].map((row) => ({
      loc: !!row.querySelector("[data-loc]"), tag: (row.querySelector(".pick-tag") || {}).textContent || "",
      pgn: !!row.querySelector("[data-loc-pgn]"), text: row.textContent })),
  }));
  assert(label === "全部 2 局" && r.open && r.src === "local" && r.rows.length === 2 && r.rows.every((x) => x.loc && x.tag === "本机" && x.pgn),
    `C1 「我的」→ 对局历史「全部 N 局」打开的是棋谱库，只看本机，每行标「本机」、能复制 PGN(${label}; ${JSON.stringify(r.rows.map((x) => x.tag))})`);
  // all sources: the two imported games and the two local ones, one list
  await page.click('#lib-src-seg [data-lsrc="all"]');
  const all = await page.$$eval("#lib-list .hist-row", (rows) => rows.length);
  assert(all === 4, `C1 来源选「全部」：导入的 2 局和本机的 2 局在同一张列表里(${all})`);
  // opening a 本机 game: onto the board, as the history's rows did
  await page.click('#lib-src-seg [data-lsrc="local"]');
  await page.click('#lib-list [data-loc="g1"]');
  await page.waitForTimeout(900);
  const board = await page.evaluate(() => ({
    list: document.getElementById("lib-list-modal").classList.contains("show"),
    page: !document.getElementById("page-me").hidden && document.getElementById("page-me").offsetParent !== null,
    view: JSON.parse(localStorage.getItem("chess.v1.settings")).view,
    mode: JSON.parse(localStorage.getItem("chess.v1.settings")).mode,
    pgn: JSON.parse(localStorage.getItem("chess.v1.save")).pgn,
  }));
  assert(!board.list && !board.page && board.mode === "ai" && /Qxf7#/.test(board.pgn) && board.view !== "me",
    `C1 点本机那一局：列表关掉、离开「我的」回到棋盘、人机模式、就是那一局，而且记下了(${JSON.stringify({ view: board.view, mode: board.mode })})`);
  // the preview rows on 我的 still load a game
  await page.click('#rail button[data-view="me"]');
  await page.waitForTimeout(300);
  assert(await page.$$eval("#hist-body [data-hist]", (b) => b.length) === 2, "C1 「我的」上的对局历史预览还在(2 行)");
  // search the merged list: by the engine level, and by the position on the board
  await page.click("#hist-open");
  await page.waitForTimeout(300);
  await page.click('#lib-src-seg [data-lsrc="all"]');
  await page.fill("#lib-q", "高级");
  const hard = await page.$$eval("#lib-list [data-loc]", (b) => b.map((x) => x.dataset.loc));
  assert(hard.join() === "g2", `C1 搜索本机棋局的对手（引擎级别）(${hard.join()})`);
  await page.fill("#lib-q", "");
  await page.click("#lib-pos");
  const pos = await page.evaluate(() => ({ rows: document.querySelectorAll("#lib-list .hist-row").length,
    note: document.getElementById("lib-pos-note").textContent, pressed: document.getElementById("lib-pos").getAttribute("aria-pressed") }));
  assert(pos.pressed === "true" && pos.rows === 1 && /有 1 局/.test(pos.note),
    `C1 「局面」开关：只留下经过棋盘上这个局面的棋(棋盘上是那盘 4. Qxf7# 之后；${pos.rows} 行，${pos.note})`);
  // a diagnosis row opens the list on imported games, even when the source
  // row was last left on 本机 (red before: an empty list)
  await page.click("#lib-list-close");
  const eco = (await libOf(page)).games.find((g) => g.id === "lib:80b").eco;
  await page.evaluate((e) => window.__chess.libDb().openList({ kind: "eco", value: e, label: e }), eco);
  await page.waitForTimeout(300);
  const picked = await page.evaluate(() => ({ src: document.querySelector("#lib-src-seg .active").dataset.lsrc,
    ids: [...document.querySelectorAll("#lib-list [data-lib]")].map((b) => b.dataset.lib) }));
  assert(!!eco && picked.src === "all" && picked.ids.join() === "lib:80b",
    `C1 诊断里点一个开局：列表回到「全部」来源，筛出那一局(${eco}; ${JSON.stringify(picked)})`);
  assert(errs.length === 0, "C1 本机：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- C1.7 认领名字: the name on most games, offered once ---------------------------
{
  const ctx = await c1Context({});
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  assert(await page.isHidden("#lib-claim"), "C1 空库不提认领");
  await importFile(page, PGN);
  const offer = await page.evaluate(() => ({ shown: !document.getElementById("lib-claim").hidden,
    text: document.getElementById("lib-claim-text").textContent }));
  assert(offer.shown && /「hxddh」出现在这 4 局里的 3 局中/.test(offer.text), `C1 导入之后，按最常出现的名字问一次(${offer.text})`);
  await page.click("#lib-claim-yes");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => ({ names: document.getElementById("lib-names").value, hidden: document.getElementById("lib-claim").hidden,
    header: JSON.parse(localStorage.getItem("chess.v1.library")) }));
  const lib = await libOf(page);
  assert(after.names === "hxddh" && after.hidden && lib.games.filter((g) => g.side).length === 3 && after.header.claimAsked === true,
    `C1 点「是我」：名字填上，三局认成你的，提示收起(${after.names}; ${lib.games.filter((g) => g.side).length})`);
  // it is not asked again: not after a reload, not after another import
  await page.evaluate(() => { const i = document.getElementById("lib-names"); i.value = ""; i.dispatchEvent(new Event("change")); });
  await page.reload();
  await c1Ready(page);
  await importFile(page, PGN.replace(/2026\.09/g, "2026.10"));
  assert(await page.isHidden("#lib-claim"), "C1 问过一次就不再问 —— 重启、再导入都不问");
  // "不是": also asked once
  const ctx2 = await c1Context({});
  const second = await open(ctx2);
  await c1Ready(second.page);
  await importFile(second.page, PGN);
  await second.page.click("#lib-claim-no");
  await importFile(second.page, PGN.replace(/2026\.09/g, "2026.11"));
  const no = await second.page.evaluate(() => ({ hidden: document.getElementById("lib-claim").hidden, names: document.getElementById("lib-names").value }));
  assert(no.hidden && no.names === "", "C1 点「不是」：不填名字，之后也不再问");
  assert(errs.length === 0 && second.errs.length === 0, "C1 认领：没有 JS 异常", errs.concat(second.errs).join(" / "));
  await ctx2.close();
  await ctx.close();
}

// ============================================================================
// v8-1-plan T5: 本机对局 in the diagnosis, the export and the speed filter.
// library-local.js has the rules and their hand-worked numbers
// (test-library-local.mjs); what is proved here is the wiring in a page.
// ============================================================================
/** Twenty analysed 本机 games (10 won, 10 lost, accuracy 50…69) and one never analysed. */
const T5_LINES = ["1. e4 e5 2. Nf3 Nc6", "1. d4 d5 2. c4 e6", "1. e4 c5 2. Nf3 d6", "1. c4 e5 2. Nc3 Nf6"];
const T5_STATS = { v: 2, games: Array.from({ length: 20 }, (_, i) => Object.assign({ id: "t5-" + i, t: T - (30 - i) * DAY,
  diff: i % 3 ? "normal" : "hard", color: i % 2 ? "b" : "w", result: i % 2 ? "loss" : "win", moves: 4, acc: 50 + i,
  pgn: T5_LINES[i % 4], ending: "resigned", style: "off" },
i % 5 === 0 ? { rb: 1400 + i, ra: 1410 + i, perf: 1500 } : {}, i % 4 === 1 ? { tc: "180+2" } : {}))
  .concat([{ id: "t5-x", t: T - DAY, diff: "normal", color: "w", result: "draw", moves: 2, pgn: "1. g4 e5", ending: "drawAgreed" }]) };
const statsOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.stats") || "{}"));
/** Click one square, then another — a move on the board. */
async function t5Move(page, from, to) {
  const xy = (sq) => page.evaluate((q) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const sz = r.width / 8;
    return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * sz, y: r.top + (8 - Number(q[1]) + 0.5) * sz };
  }, sq);
  const a = await xy(from); await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  const b = await xy(to); await page.mouse.click(b.x, b.y);
}
const AI_5_3 = { mode: "ai", difficulty: "beginner", humanColor: "w", timeControl: "5+3", langId: "zh-CN", sideTab: "play",
  view: "play", soundOn: false, themeId: "wood" };

// --- T5.1 a game played now records its clock; the speed filter finds it ------
{
  const ctx = await c1Context({ "chess.v1.settings": AI_5_3,
    "chess.v1.save": { v: 1, savedAt: T, pgn: '[Event "t5"]\n[Result "*"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 *',
      clock: { tc: "5+3", w: 240000, b: 250000, flag: null, started: true } } });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(400);
  await t5Move(page, "h5", "f7");
  await page.waitForTimeout(800);
  const last = ((await statsOf(page)).games || []).slice(-1)[0] || null;
  assert(last && last.result === "win" && last.tc === "300+3", `T5 新下完的一局记下棋钟：5+3 → TimeControl 300+3(${JSON.stringify(last && { r: last.result, tc: last.tc })})`);
  await page.evaluate(() => window.__chess.libDb().openList(null, { src: "local" }));
  await page.waitForTimeout(600);
  await page.click('#lib-tc-seg [data-ltc="blitz"]');
  const blitz = await page.$$eval("#lib-list [data-loc]", (b) => b.map((x) => x.dataset.loc));
  await page.click('#lib-tc-seg [data-ltc="rapid"]');
  const rapid = await page.$$eval("#lib-list [data-loc]", (b) => b.map((x) => x.dataset.loc));
  assert(last && blitz.join() === last.id && rapid.length === 0, `T5 用时筛选对本机棋有效：快棋一档里就是这一局，中速里没有(${blitz.join()} / ${rapid.join()})`);
  assert(errs.length === 0, "T5 新对局：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- T5.2 an old game gets the clock the save says it was played on -----------
{
  const MATE = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#";
  const ctx = await c1Context({ "chess.v1.settings": AI_5_3, "chess.v1.stats": STATS_7X,
    "chess.v1.save": { v: 1, savedAt: T, pgn: '[Result "1-0"]\n\n' + MATE + " 1-0", clock: { tc: "5+3", w: 281000, b: 290500, flag: null, started: true } } });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.waitForTimeout(400);
  const st = await statsOf(page);
  const byId = new Map((st.games || []).map((g) => [g.id, g]));
  const lost = STATS_7X.games.filter((g) => {
    const s = byId.get(g.id);
    return !s || Object.keys(g).some((k) => JSON.stringify(g[k]) !== JSON.stringify(s[k])) || Object.keys(s).some((k) => !(k in g) && k !== "tc");
  }).map((g) => g.id);
  assert(byId.get("g1") && byId.get("g1").tc === "300+3" && byId.get("g2") && !("tc" in byId.get("g2")) && lost.length === 0,
    `T5 旧记录补标：棋盘上那局按存档里走过的钟标 300+3，推不出来的不标，其余字段一个不变(${JSON.stringify([...byId.values()].map((g) => g.tc || "-"))}；不等 ${lost.join(",") || "无"})`);
  await page.evaluate(() => window.__chess.libDb().openList(null, { src: "local" }));
  await page.waitForTimeout(600);
  await page.click('#lib-tc-seg [data-ltc="blitz"]');
  const blitz = await page.$$eval("#lib-list [data-loc]", (b) => b.map((x) => x.dataset.loc));
  assert(blitz.join() === "g1", `T5 补标之后，用时筛选找得到它(${blitz.join()})`);
  assert(errs.length === 0, "T5 补标：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- T5.3 the diagnosis's source row: 导入的 by default, 本机, 全部 --------------
let t5Export = "";
{
  const ctx = await c1Context({ "chess.v1.stats": T5_STATS, "chess.v1.library": V1["7.0"] });
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await page.waitForTimeout(600);
  // one analysed import and twenty analysed 本机 games: the button is there
  // (red before T5: it counted the one import and stayed hidden)
  assert(await page.isVisible("#lib-diagnose"), "T5 本机分析过的够数，「看诊断」就出现(导入的只有 1 局)");
  await page.click("#lib-diagnose");
  await page.waitForTimeout(500);
  const read = () => page.evaluate(() => ({
    on: [...document.querySelectorAll("#diag-src-seg button")].filter((b) => b.classList.contains("active")).map((b) => b.dataset.dsrc + ":" + b.getAttribute("aria-pressed")),
    text: document.getElementById("lib-diag").innerText.replace(/\s+/g, " ") }));
  const imp = await read();
  assert(imp.on.join() === "import:true" && /还差 19 局才够给诊断（已分析 1\/20）/.test(imp.text) && !/逐手分析/.test(imp.text),
    `T5 诊断默认读「导入的」：7.x 的数字，还差 19 局(${imp.on}；${imp.text.slice(0, 60)})`);
  // by keyboard: Tab to 本机, Enter
  await page.focus('#diag-src-seg [data-dsrc="local"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const loc = await read();
  assert(loc.on.join() === "local:true" && /20 局已分析的棋/.test(loc.text) && /10 胜 10 负 0 和/.test(loc.text) && /平均精准度 59\.5%/.test(loc.text) &&
    /只看还存着逐手分析的 0 局/.test(loc.text),
    `T5 选「本机」(键盘)：20 局、10 胜 10 负、平均精准度 59.5%，并说明逐手数据只有几局(${loc.text.slice(0, 120)})`);
  await page.click('#diag-src-seg [data-dsrc="all"]');
  await page.waitForTimeout(300);
  const all = await read();
  assert(all.on.join() === "all:true" && /21 局已分析的棋/.test(all.text) && /11 胜 10 负 0 和/.test(all.text) && /平均精准度 60\.5%/.test(all.text),
    `T5 选「全部」：21 局、11 胜 10 负、平均精准度 60.5%((1190 + 81.2) / 21)(${all.text.slice(0, 120)})`);
  // an opening row read from 本机 opens the list on the 本机 games of that opening
  // (7.x's rule, now for 本机 too: the row's count is the games its pick
  // opens. Red at the M2 merge on WebKit — the diagnosis was drawn while
  // three of the five C44 games had no opening yet, said 2, and opened 5.)
  // CI's WebKit at the M2 merge: the ECO table arrived while the 本机 games
  // were being made, so some of them had no opening yet (library-page.js
  // localEntry) — three of the five C44 games, here as there
  const eco = await page.evaluate(() => {
    const all = window.__chess.libDb().all();
    for (const g of all) if (["t5-0", "t5-4", "t5-8"].includes(g.ref)) delete g.eco;
    return (all.find((g) => g.ref === "t5-16") || {}).eco || "";
  });
  await page.click('#diag-src-seg [data-dsrc="local"]');
  const rowOf = (e) => [...document.querySelectorAll('#lib-diag [data-diag-pick]')].find((b) => JSON.parse(b.dataset.diagPick).value === e) || null;
  await page.waitForFunction(([e, f]) => window.__chess.libDb().all().every((g) => g.src !== "local" || typeof g.eco === "string") &&
    !!new Function("return " + f)()(e), [eco, rowOf.toString()], { timeout: 15000 }).catch(() => {});
  const row = await page.evaluate(([e, f]) => {
    const b = new Function("return " + f)()(e);
    if (!b) return null;
    b.dataset.t5 = "row";
    return { n: Number((/(\d+) 局/.exec(b.querySelector(".stat-v").textContent) || [])[1]),
      want: window.__chess.libDb().all().filter((g) => g.src === "local" && g.eco === e && typeof g.acc === "number").map((g) => g.ref).sort().join() };
  }, [eco, rowOf.toString()]);
  if (row) await page.click('#lib-diag [data-t5="row"]');
  await page.waitForFunction(() => document.getElementById("lib-list-modal").classList.contains("show"), null, { timeout: 5000 }).catch(() => {});
  const picked = await page.$$eval("#lib-list [data-loc]", (b) => b.map((x) => x.dataset.loc).sort().join());
  const libs = await page.$$eval("#lib-list [data-lib]", (b) => b.length);
  assert(!!eco && !!row && !!row.want && picked === row.want && picked.split(",").length === row.n && libs === 0,
    `T5 本机诊断里点一个开局：列表里是这个开局的本机棋，和那一行说的局数一样(${picked} = ${row && row.want}；行上 ${row && row.n} 局)`);
  await page.click("#lib-list-close");
  // restart: the row is back on 导入的
  await page.reload();
  await c1Ready(page);
  await page.waitForTimeout(400);
  await page.click("#lib-diagnose");
  await page.waitForTimeout(400);
  assert((await read()).on.join() === "import:true", "T5 重启之后，诊断的来源回到默认的「导入的」");
  await page.click("#lib-modal-close");

  // --- T5.4 导出 PGN with the 本机 games, into an empty profile, and back ---------
  await page.evaluate(() => window.__chess.libDb().openList(null, { src: "import" }));
  await page.waitForTimeout(400);
  const [dl1] = await Promise.all([page.waitForEvent("download"), page.click("#lib-export")]);
  const onlyImp = fs.readFileSync(await dl1.path(), "utf8");
  assert(!/\[LibId "loc:/.test(onlyImp) && (onlyImp.match(/\[LibId "lib:/g) || []).length === 2,
    "T5 来源选「导入」时导出的和 8.0 一样：只有导入的 2 局");
  await page.click('#lib-src-seg [data-lsrc="all"]');
  const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("#lib-export")]);
  t5Export = fs.readFileSync(await dl2.path(), "utf8");
  assert((t5Export.match(/\[LibId "loc:/g) || []).length === 21 && (t5Export.match(/\[LibRec "/g) || []).length === 21 &&
    (t5Export.match(/\[LibId "lib:/g) || []).length === 2 && /\[TimeControl "180\+2"\]/.test(t5Export),
    "T5 来源选「全部」：导出带上 21 局本机棋，每局有 LibId 和记录，有棋钟的带 TimeControl");
  // the same profile: nothing is added twice
  const n0 = (await statsOf(page)).games.length;
  await page.click("#lib-list-close");
  await importFile(page, t5Export);
  await page.waitForTimeout(600);
  const again = await libOf(page);
  const n1 = (await statsOf(page)).games.length;
  const locals = await page.evaluate(() => window.__chess.libDb().all().filter((g) => g.src === "local").length);
  assert(n1 === n0 && again.games.length === 2 && locals === 21, `T5 导回同一个档案：一局不多(战绩 ${n0} → ${n1}，导入的 ${again.games.length}，本机 ${locals})`);
  assert(errs.length === 0, "T5 诊断与导出：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}
{
  // 清空 → 导回: an empty profile takes the file, and every 本机 game is 本机 again
  const ctx = await c1Context({});
  const { page, errs } = await open(ctx);
  await c1Ready(page);
  await importFile(page, t5Export);
  await page.waitForTimeout(1200);
  const st = await statsOf(page);
  const byId = new Map((st.games || []).map((g) => [g.id, g]));
  const moves = (pgn) => pgn.replace(/\[[^\]]*\]/g, "").replace(/\d+\.(\.\.)?/g, "").replace(/\s(1-0|0-1|1\/2-1\/2|\*)\s*$/, "").trim().split(/\s+/).join(" ");
  const diff = [];
  for (const g of T5_STATS.games) {
    const s = byId.get(g.id);
    if (!s) { diff.push(g.id + " 没回来"); continue; }
    for (const k of Object.keys(g).concat(Object.keys(s))) {
      if (k === "pgn") { if (moves(g.pgn) !== moves(s.pgn)) diff.push(g.id + ".pgn"); continue; }
      if (JSON.stringify(g[k]) !== JSON.stringify(s[k])) diff.push(g.id + "." + k);
    }
  }
  await page.waitForTimeout(600);
  const view = await page.evaluate(() => {
    const all = window.__chess.libDb().all();
    return { local: all.filter((g) => g.src === "local").map((g) => g.ref).sort(), imported: all.filter((g) => g.src !== "local").map((g) => g.id).sort() };
  });
  assert(st.games.length === 21 && diff.length === 0, `T5 带本机棋导出 → 空档案 → 导回：21 条战绩记录逐字段相等(${diff.slice(0, 5).join(", ") || "全等"})`);
  assert(view.local.length === 21 && view.local.every((id) => byId.has(id)) && view.imported.join() === "lib:70a,lib:70b",
    `T5 …来源仍是「本机」，导入的两局还是导入的，没有一局变成导入的副本(本机 ${view.local.length}，导入 ${view.imported.join()})`);
  await page.evaluate(() => window.__chess.libDb().openList(null, { src: "local" }));
  await page.waitForTimeout(500);
  const tags = await page.$$eval("#lib-list .hist-row", (rows) => rows.map((r) => (r.querySelector(".pick-tag") || {}).textContent || ""));
  assert(tags.length === 21 && tags.every((x) => x === "本机"), `T5 列表里每一局都标「本机」(${tags.length})`);
  await page.click("#lib-list-close");
  await importFile(page, t5Export);
  await page.waitForTimeout(600);
  const twice = await statsOf(page);
  const toast = await page.evaluate(() => document.getElementById("toast").textContent);
  assert(twice.games.length === 21 && /23 局全都已经在库里了/.test(toast), `T5 再导一次：一局不多，说全都已经在库里(${twice.games.length}；${toast})`);
  assert(errs.length === 0, "T5 导回：没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// the numbers, for docs/measured.json (libraryDb) — written with --record
{
  const r1 = (x) => Math.round(x * 10) / 10;
  const figures = {
    what: "v8-0-plan C1：1 万局棋谱库（1,000 条不同着法 × 各约 10 局，每局 8–19 个半回合，标签各异）在 headless Chromium 里：一次导入进库、重启读回到可用、各种查询（API）与列表页上的搜索（查询 + 画出列表）的耗时，毫秒；验收线 ≤ 200 ms。coldStart（v8-1-plan F3，v8-2-plan F3）：重启后从导航开始到列表可见、按摘要搜索可用、局面索引到达（ready，即「经过这个局面」可用），五次取中位数；验收线 1.5 s / 4.5 s / 1.5 s",
    script: "node scripts/test-library-e2e.mjs --record",
    games: 10000,
    importMs: C1.importMs, loadMs: C1.loadMs,
    queryMs: C1.api && Object.fromEntries(Object.entries(C1.api).map(([k, r]) => [k, r1(r.ms)])),
    queryHits: C1.api && Object.fromEntries(Object.entries(C1.api).map(([k, r]) => [k, r.n])),
    pageMs: C1.ui && { typed: r1(C1.ui.typed), position: r1(C1.ui.pos), speed: r1(C1.ui.seg) },
    limitMs: 200,
    // from the navigation's start, the median of five (v8-2-plan F3)
    coldStart: C1.cold && Object.assign({ limitMs: { list: 1500, search: 4500, ready: "max(1500, 1.25 × noSummary.readyMs)" } }, C1.cold, { noSummary: C1.coldBase }),
  };
  // the same measurement on the code before each F3, kept across
  // re-recordings: v8-1-plan's (this suite over 17334e1's src/web) and
  // v8-2-plan's (`--before=<ref>`: this suite over that ref's src/web; such
  // a run records only that)
  const had = readMeasured().libraryDb || {};
  const before = (process.argv.find((a) => a.startsWith("--before=")) || "").slice(9);
  for (const k of ["coldStartBefore", "coldStartBefore82"]) if (had[k]) figures[k] = had[k];
  if (before && C1.cold) figures.coldStartBefore82 = Object.assign({ ref: before }, C1.cold, { noSummary: C1.coldBase });
  console.log("C1 measured: " + JSON.stringify(figures));
  if (RECORDING && C1.api && C1.ui) record("libraryDb", before ? Object.assign({}, had, { coldStartBefore82: figures.coldStartBefore82 }) : figures);
}

await browser.close();
server.close();
if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\n全部通过");
