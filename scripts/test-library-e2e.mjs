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
async function importFile(page, text) {
  const file = path.join(HERE, "..", "node_modules", ".cache", "lib-e2e.pgn");
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
  const [chooser] = await Promise.all([
    page.waitForEvent("filechooser"),
    page.click("#lib-import"),
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

await browser.close();
server.close();
if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\n全部通过");
