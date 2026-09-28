/**
 * 开局浏览器（v8-0-plan C3）的浏览器检查。
 *
 * explorer/core.js 的算术与大师树的数据由 scripts/test-explorer.mjs 在 Node 里
 * 核对；这里证明的是它接到了应用上：「开局」键开合面板、面板跟着棋盘的局面走、
 * 点一行（或键盘 Enter）就像在棋盘上走这一步、按住一行时它不被重建（7.6）、
 * 人机对局的过去里不许走、大师树按需载入、重启后还开着、棋谱库页的入口、
 * 三种语言、以及 500 局的棋谱库第一次打开要多久。
 *
 * 引擎是桩（与本目录其余 e2e 一样）。需要 playwright-core 与浏览器
 * （scripts/e2e-browser.mjs）；缺了就提示并以 0 退出，除非 E2E_REQUIRED=1：
 *   node scripts/test-explorer-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { heldClick } from "./lib/held-click.mjs";
import { compileModuleSync } from "./bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const served = [];
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  served.push(p);
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

// chess.js, the key and the explorer's decoding, in Node: the expected numbers
const nctx = { console, Date, Math, JSON };
nctx.globalThis = nctx; nctx.window = nctx;
vm.createContext(nctx);
for (const f of ["chess.js", "fide.js", "explorer/core.js"]) vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), nctx, { filename: f });
const X = nctx.ChessExplorer;
const keyAfter = (sans) => { const g = new nctx.Chess(); for (const s of sans) g.move(s); return nctx.ChessFide.positionKey(g.fen(), g); };

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

/** Six games in the shape library.js stores them. */
const GAMES = [
  ["e4 e5 Nf3 Nc6 Bb5 a6", "1-0"], ["e4 c5 Nf3 d6 d4 cxd4", "0-1"], ["e4 e5 Nf3 Nf6", "1/2-1/2"],
  ["d4 d5 c4 e6", "1-0"], ["d4 Nf6 c4 g6", "0-1"], ["e4 e5 Bc4 Nc6 Nf3", "1-0"],
].map(([sans, result], i) => ({ id: "lib:x" + i, t: 1758000000000 - i, white: "a", black: "b", date: "", event: "",
  result, plies: sans.split(" ").length, sans, fen: "", side: null, outcome: null, an: null }));

async function context(opts) {
  const o = Object.assign({ lang: "zh-CN", mode: "pvp", view: "play", games: GAMES, explorer: null, width: 1400 }, opts);
  const ctx = await browser.newContext({ viewport: { width: o.width, height: 1000 }, locale: o.lang });
  await ctx.addInitScript((o) => {
    if (sessionStorage.getItem("seeded")) return; // a reload keeps what the app saved
    sessionStorage.setItem("seeded", "1");
    const s = { mode: o.mode, langId: o.lang, sideTab: "play", view: o.view, soundOn: false, themeId: "wood" };
    if (o.explorer) s.explorer = o.explorer;
    localStorage.setItem("chess.v1.settings", JSON.stringify(s));
    localStorage.setItem("chess.panelOpen", "1");
    if (o.games) localStorage.setItem("chess.v1.library", JSON.stringify({ v: 1, games: o.games, names: [] }));
  }, o);
  return ctx;
}

async function open(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(100);
  return { page, errs };
}

/** The rows as the panel shows them. */
const rows = (page) => page.evaluate(() => [...document.querySelectorAll("#xp-list .xp-row")].map((b) => ({
  san: b.dataset.san, n: b.querySelector(".xp-n").textContent, book: !!b.querySelector(".xp-book"),
  label: b.getAttribute("aria-label"), bar: [...b.querySelectorAll(".xp-bar > span")].map((s) => s.className.split(" ")[0] + ":" + s.style.width).join(" "),
})));
const note = (page) => page.textContent("#xp-note");
const waitRows = async (page, pred, ms = 3000) => {
  let r = [];
  for (let i = 0; i < ms / 50; i++) { r = await rows(page); if (pred(r)) return r; await page.waitForTimeout(50); }
  return r;
};

// --- 1. 开合、跟着局面、点一行就是走这一步 -------------------------------------
{
  const ctx = await context();
  const { page, errs } = await open(ctx);
  assert(await page.isHidden("#explorer"), "默认不开");
  assert(!served.some((p) => p.includes("chunk-explorer")), "没打开之前，不取 chunk-explorer.js（主包只带一个开关）");
  await page.click("#explorer-open");
  assert(await page.getAttribute("#explorer-open", "aria-pressed") === "true", "「开局」键 aria-pressed 跟着变");
  let r = await waitRows(page, (x) => x.length >= 2);
  assert(await page.isVisible("#explorer"), "按「开局」，面板出来");
  // 起始局面：e4 四局（白 2、和 1、黑 1），d4 两局（白 1、黑 1）—— 与种进去的棋谱逐局对得上
  const e4 = r.find((x) => x.san === "e4"), d4 = r.find((x) => x.san === "d4");
  assert(r.length === 2 && e4 && e4.n === "4" && d4 && d4.n === "2", "起始局面两行：e4 4 局、d4 2 局", JSON.stringify(r));
  assert(e4.label === "e4 · 书：4 局，白胜 50%，和 25%，黑胜 25%", "e4 这一行读出来是着法、书、局数与三个百分比", e4.label);
  assert(e4.book && d4.book, "e4、d4 都是开局书里的着法，标「书」");
  assert(e4.bar === "xp-w:50% xp-d:25% xp-b:25%", "胜 / 和 / 负条的宽度就是这三个百分比", e4.bar);
  assert(/6 局/.test(await note(page)), "说明行：6 局走到这里", await note(page));

  // 按住 e4 这一行：按住期间按 F 翻棋盘（一次整面板的提交），行不重建、不挪
  const h = await heldClick(page, '#xp-list .xp-row[data-san="e4"]', { before: () => page.keyboard.press("f") });
  assert(h.drift === 0 && !h.replaced && h.mutated === 0 && h.clicked, "7.6：按住一行时别处的提交不重建它，这一下点击落在它上面", JSON.stringify(h));
  r = await waitRows(page, (x) => x.some((y) => y.san === "e5"));
  const e5 = r.find((x) => x.san === "e5"), c5 = r.find((x) => x.san === "c5");
  assert(e5 && e5.n === "3" && c5 && c5.n === "1", "点 e4 就走了 e4；面板换成 1.e4 之后：e5 3 局、c5 1 局", JSON.stringify(r));
  assert(/白胜 67%，和 33%，黑胜 0%/.test(e5.label), "e5：白胜 2、和 1 → 67% / 33% / 0%", e5.label);

  // 键盘：Tab 到一行，Enter 走它，焦点留在列表里
  await page.focus('#xp-list .xp-row[data-san="e5"]');
  await page.keyboard.press("Enter");
  r = await waitRows(page, (x) => x.some((y) => y.san === "Nf3"));
  const nf3 = r.find((x) => x.san === "Nf3"), bc4 = r.find((x) => x.san === "Bc4");
  assert(nf3 && nf3.n === "2" && bc4 && bc4.n === "1", "Enter 走了 e5；1.e4 e5 之后：Nf3 2 局、Bc4 1 局", JSON.stringify(r));
  assert(await page.evaluate(() => document.getElementById("xp-list").contains(document.activeElement)), "焦点还在列表里，接着用键盘");
  const pos = await page.textContent("#replay-pos");
  assert(/^2 \/ 2$/.test(pos.trim()), "棋谱里是两步", pos);

  // 复盘：翻回开局，面板跟着回去；在过去点一行是开一条变着（双人对局可以）
  await page.click("#rep-start");
  r = await waitRows(page, (x) => x.some((y) => y.san === "d4"));
  assert(r.some((x) => x.san === "e4" && x.n === "4"), "翻回起始局面，面板跟着回去");
  await page.click('#xp-list .xp-row[data-san="d4"]');
  r = await waitRows(page, (x) => x.some((y) => y.san === "d5"));
  assert(r.some((x) => x.san === "d5" && x.n === "1") && r.some((x) => x.san === "Nf6" && x.n === "1"),
    "在过去点 d4：走成一条变着，面板是 1.d4 之后（d5、Nf6 各 1 局）", JSON.stringify(r));
  assert(await page.isVisible("#back-main"), "……变着上有「回主线」");

  // 7.6：按住一行时，面板要换内容（切到大师树）也等松开之后
  const src = await page.evaluate(() => document.querySelector('#xp-src [data-src="master"]').getAttribute("aria-pressed"));
  const h2 = await heldClick(page, '#xp-list .xp-row[data-san="d5"]', {
    before: () => page.evaluate(() => document.querySelector('#xp-src [data-src="master"]').click()),
  });
  assert(src === "false" && !h2.replaced && h2.mutated === 0 && h2.clicked, "按住期间切到「大师」，这一行等松开才换，点击照样落在 d5 上", JSON.stringify(h2));
  // 大师树：按需取 chunk-xm-00.js；数字就是分块里的数字
  r = await waitRows(page, (x) => x.length && x[0].n.length >= 3, 5000);
  const want = (() => {
    const src = fs.readFileSync(path.join(ROOT, "js/explorer/masters-00.js"), "utf8");
    const tbl = JSON.parse(src.slice(src.indexOf("= {") + 2, src.lastIndexOf(";")));
    return X.decodeRows(tbl[X.hashKey(keyAfter(["d4", "d5"]))]);
  })();
  assert(served.some((p) => p.endsWith("chunk-xm-00.js")), "大师树的第一块按需取来（chunk-xm-00.js）");
  assert(r.length === want.length && r.every((x, i) => x.san === want[i].san && x.n === String(want[i].n)),
    "1.d4 d5 之后：大师行逐行等于分块里的着法与局数（" + want.slice(0, 3).map((w) => w.san + " " + w.n).join("、") + "…）",
    JSON.stringify(r.slice(0, 3)));
  assert(/^Lichess 2026-08 · ≥ 2200 · 120000 局 · CC0$/.test(await note(page)), "说明行写明来源、门槛、局数与许可", await note(page));
  assert(r.find((x) => x.san === "c4").book, "c4（后翼弃兵）标「书」");

  // 重启：面板还开着，还是大师
  await page.reload();
  await page.waitForTimeout(900);
  r = await waitRows(page, (x) => x.length > 0, 5000);
  assert(await page.isVisible("#explorer") && await page.getAttribute('#xp-src [data-src="master"]', "aria-pressed") === "true" && r.length > 0,
    "重启之后，面板还开着、来源还是大师");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 2. 人机对局：过去的局面里点一行不走棋；轮到引擎时也不走 -----------------------
{
  const ctx = await context({ mode: "ai", explorer: { open: true, src: "lib" } });
  const { page, errs } = await open(ctx);
  await page.evaluate(() => { window.__chess.engine.bestMove = async () => null; });
  let r = await waitRows(page, (x) => x.length >= 2);
  await page.click('#xp-list .xp-row[data-san="e4"]');
  await page.waitForTimeout(300);
  assert((await page.textContent("#replay-pos")).trim() === "1 / 1", "人机对局里轮到你时，点一行就走这一步");
  await page.click("#rep-start");
  await waitRows(page, (x) => x.some((y) => y.san === "d4"));
  await page.click('#xp-list .xp-row[data-san="d4"]');
  await page.waitForTimeout(300);
  assert((await page.textContent("#replay-pos")).trim() === "0 / 1", "人机对局的过去里点一行，不走（和棋盘一样）");
  assert(/回到最新|最新/.test(await page.textContent("#toast")), "……并且说为什么", await page.textContent("#toast"));
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 3. 空库：说清楚，并列出开局书；棋谱库页的入口 --------------------------------
{
  const ctx = await context({ games: null, view: "library" });
  const { page, errs } = await open(ctx);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(200);
  assert(await page.isVisible("#lib-explorer"), "棋谱库页上有「开局浏览器」");
  await page.click("#lib-explorer");
  const r = await waitRows(page, (x) => x.length > 0);
  assert(await page.isHidden("#page-library") && await page.isVisible("#explorer"), "点它：回到棋盘，面板开着");
  assert(/棋谱库是空的/.test(await note(page)), "空库时说清楚", await note(page));
  assert(r.length >= 10 && r.every((x) => x.book && x.n === ""), "……并列出开局书的首着（" + r.length + " 个，局数空着）");
  const e4 = r.find((x) => x.san === "e4");
  assert(e4 && e4.label === "e4：书着，尚无对局", "书着行读出来是「书着，尚无对局」", e4 && e4.label);
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

// --- 4. 英文与日文：文字、读法、没有截断 -----------------------------------------
for (const [lang, key, label, row] of [
  ["en", "Explorer", /^6 games$/, "e4 · Book: 4 games, White wins 50%, draws 25%, Black wins 25%"],
  ["ja", "定跡", /^全 6 局$/, "e4 · 定跡：4 局、白勝ち 50%、引き分け 25%、黒勝ち 25%"],
]) {
  for (const width of [1400, 1024]) {
    const ctx = await context({ lang, explorer: { open: true, src: "lib" }, width });
    const { page, errs } = await open(ctx);
    const r = await waitRows(page, (x) => x.length >= 2);
    const lbl = await page.evaluate(() => { const l = document.querySelector("#explorer-open .tool-lbl"); return { text: l.textContent, cut: l.scrollWidth > l.clientWidth + 0.5 }; });
    assert(lbl.text === key && !lbl.cut, lang + " " + width + "：「" + key + "」键的字不截断", JSON.stringify(lbl));
    assert(label.test((await note(page)).trim()), lang + " " + width + "：说明行是本语言", await note(page));
    const e4 = r.find((x) => x.san === "e4");
    assert(e4 && e4.label === row, lang + " " + width + "：行的读法是本语言", e4 && e4.label);
    const cut = await page.evaluate(() => [...document.querySelectorAll("#explorer .act-k, #xp-src button, #xp-note, .xp-san")]
      .filter((e) => e.scrollWidth > e.clientWidth + 0.5).map((e) => e.textContent));
    assert(cut.length === 0, lang + " " + width + "：标题、来源键、说明与着法都不截断", cut.join(" | "));
    const side = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth);
    assert(side, lang + " " + width + "：没有横向滚动");
    assert(errs.length === 0, lang + " " + width + "：没有 JS 异常", errs.join(" / "));
    await ctx.close();
  }
}

// --- 5. 500 局的棋谱库：第一次打开到出数字要多久（没有索引，现场建） ------------------
{
  let s = 11;
  const rand = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const big = [];
  for (let i = 0; i < 500; i++) {
    const g = new nctx.Chess();
    for (let p = 0; p < 80; p++) { const ms = g.moves(); if (!ms.length) break; g.move(ms[Math.floor(rand() * ms.length)]); }
    const sans = g.history().join(" ");
    big.push({ id: "lib:b" + i, t: 1758000000000 - i, white: "a", black: "b", date: "", event: "", result: ["1-0", "0-1", "1/2-1/2"][i % 3],
      plies: g.history().length, sans, fen: "", side: null, outcome: null, an: null });
  }
  const ctx = await context({ games: big });
  const { page, errs } = await open(ctx);
  // the chunk first (its fetch is not the index's cost), then the open that builds the index
  await page.evaluate(() => new Promise((r) => { const s = document.createElement("script"); s.src = "js/chunk-explorer.js"; s.onload = r; document.head.appendChild(s); }));
  const ms = await page.evaluate(async () => {
    const t0 = performance.now();
    document.getElementById("explorer-open").click();
    for (let i = 0; i < 400; i++) {
      if (document.querySelectorAll("#xp-list .xp-row").length) return performance.now() - t0;
      await new Promise((r) => setTimeout(r, 5));
    }
    return -1;
  });
  console.log("  500 局 × 80 半回合：按「开局」到第一行出现 " + ms.toFixed(0) + " ms");
  assert(ms > 0 && ms < 1000, "500 局的棋谱库，第一次打开 < 1 s（" + ms.toFixed(0) + " ms）");
  // synchronous: a move commits, the panel's render runs inside that commit
  // (the next frame is the browser's to schedule, not this panel's cost)
  const step = await page.evaluate(() => {
    const before = document.querySelector("#xp-list .xp-row").dataset.san;
    const t0 = performance.now();
    document.querySelector("#xp-list .xp-row").click();
    return { ms: performance.now() - t0, moved: document.querySelector("#xp-list .xp-row") && document.querySelector("#xp-list .xp-row").dataset.san !== before };
  });
  const t1 = step.ms;
  console.log("  建好之后走一步（整个提交，面板在其中）" + t1.toFixed(0) + " ms");
  assert(step.moved, "走了一步，面板已经换成下一个局面");
  assert(t1 < 200, "建好之后每走一步，连同面板 < 200 ms（" + t1.toFixed(0) + " ms）");
  assert(errs.length === 0, "没有 JS 异常", errs.join(" / "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\nall explorer e2e checks passed");
