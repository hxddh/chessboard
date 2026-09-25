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
      mode: "pvp", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
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
  await page.click("#pick-cancel").catch(() => {});
  await page.click("#tab-record").catch(() => {});
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

const libOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library") || "null"));

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
  const body0 = await page.textContent("#lib-body");
  assert(/一局都没认出是你下的/.test(body0), "……而且页面直说了这件事", body0);

  // 填上名字 → 已经在库里的棋也要重新认一遍
  await page.fill("#lib-names", "hxddh");
  await page.dispatchEvent("#lib-names", "change");
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
    assert(/还差 15 局/.test(await page.textContent("#lib-body")), "……并且说清楚还差多少",
      await page.textContent("#lib-body"));
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
  await page.click("#tab-record");
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
  await page.click("#tab-record");
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
      mode: "pvp", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.library", lb);
    localStorage.setItem("chess.v1.mines", JSON.stringify({ v: 1, list: ms }));
  }, [JSON.stringify({ v: 1, names: ["hxddh"], games }), mines]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#tab-record").catch(() => {});
  await page.waitForTimeout(200);

  const body = await page.textContent("#lib-body");
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
    budget: JSON.parse(localStorage.getItem("chess.v1.library")).games[0].an.budget,
    tags: JSON.parse(localStorage.getItem("chess.v1.library")).games[0].an.tags,
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
  const wrong = await page.evaluate(() => document.getElementById("toast").textContent.trim());
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
  if (!done) { await mv("g1", "f3"); done = await page.isVisible("#puzzle-playon"); }
  assert(done, "照书走完一条线就算背下来了 —— 对手的回答也是从这本书里挑的");
  const solved = await page.evaluate(() => {
    const st = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    return Object.keys(st.solved).filter((k) => k.startsWith("rep-")).length;
  });
  assert(solved >= 1, "背下来的那条记进了进度，和内置开局书同一条轨", solved);

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
  await page.click("#tab-record");
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
  await page.click("#tab-record");
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
  await mv("e2", "e4");
  await mv("e7", "e5");

  await importFile(page, REP, "#rep-import-w");
  await page.waitForTimeout(400);
  await page.click("#rep-drill");
  await page.waitForTimeout(900);

  // 书清掉，题还在屏幕上
  await page.click("#tab-record");
  await page.waitForTimeout(200);
  await page.click("#rep-clear");
  await page.waitForTimeout(300);
  await page.click("#confirm-ok");
  await page.waitForTimeout(500);
  await mv("e2", "e4");   // 书上是 d4：这是一步错棋
  assert((await missedRep()).length === 0,
    "书已经清空，屏幕上那道题走错了也不写进复习队列 —— 不留一道谁也端不出来的题",
    JSON.stringify(await missedRep()));

  // 「接实战」：重新导书、背完一条线，棋盘上还压着那盘没下完的棋
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
      mode: "pvp", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
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
  await page.click("#pick-cancel").catch(() => {});
  await page.click("#tab-record").catch(() => {});
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

// --- 17. 7.6 §3c/§3d/§3e：诊断弹窗滚得动；教学/做题里也打得开；按筛选停在那一手 ----
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
        mode: m, langId: "zh-CN", sideTab: tb, soundOn: false, themeId: "wood" }));
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
        paneScroll: document.getElementById("pane-record").scrollTop,
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
    assert(g1.paneScroll === g0.paneScroll, tag + "：滚轮滚的是弹窗，不是背后的面板（" + g0.paneScroll + " → " + g1.paneScroll + "）");
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
      mode: "pvp", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
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

await browser.close();
server.close();
if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\n全部通过");
