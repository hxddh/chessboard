/**
 * 残局训练营, end to end on the REAL Stockfish (v8-1-plan T2).
 *
 *   1 分块      the first frame fetches no chunk-endgames.js; 学习's 目录 does,
 *               and then lists 60 positions under five themes
 *   2 走错      a position played wrong (马拦兵, not Ne3+): the engine at full
 *               strength queens, the run fails, and the position is in the
 *               review queue (learn key → eg.srs), due now
 *   3 走对      the same position played right: Ne3+ … Nxc2 is a draw by
 *               insufficient material, the goal; it is marked done and walks
 *               up the review ladder
 *   4 我的      the section counts it (1/60), shows no review due, and
 *               进训练营 opens the next untried position in 学习
 *   5 旧存档    an 8.0 learn key (no eg) loads: the course progress is kept
 *               and the camp reads 0/60
 *   6 三语      zh-CN / en / ja at 1400 and 520 wide: nothing in the camp's
 *               list, its lesson card or its 我的 section is cut off
 *
 * The engine plays White's opponent at 满强度 (tier extreme); the page is
 * served from src/web with the real engine-src.js (generated if missing).
 *   node scripts/test-endgames-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
{
  const src = path.join(ROOT, "js", "engine-src.js");
  if (!fs.existsSync(src) || fs.statSync(src).size <= 2000000) {
    execFileSync(process.execPath, [path.join(HERE, "gen-engine-src.mjs")], { stdio: "inherit" });
  }
}
const { launchBrowser, ENGINE } = await import("./e2e-browser.mjs");

const served = [];
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  served.push(p);
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
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg, extra != null ? " " + extra : ""); }
};
const browser = await launchBrowser();
console.log("引擎:", ENGINE);

async function openPage(settings, seed, viewport) {
  const ctx = await browser.newContext({ viewport: viewport || { width: 1400, height: 1000 }, locale: (settings && settings.langId) || "zh-CN" });
  await ctx.addInitScript(([s, sd]) => {
    if (!sessionStorage.getItem("eg.seeded")) {
      localStorage.setItem("chess.v1.settings", JSON.stringify(Object.assign({ langId: "zh-CN", sideTab: "play", soundOn: false }, s)));
      localStorage.setItem("chess.panelOpen", "1");
      for (const [k, v] of Object.entries(sd || {})) localStorage.setItem(k, v);
      sessionStorage.setItem("eg.seeded", "1");
    }
    window.__toasts = [];
    let last = "";
    new MutationObserver(() => {
      const el = document.getElementById("toast");
      const s2 = el ? (el.textContent || "").trim() : "";
      if (s2 && s2 !== last) window.__toasts.push(s2);
      last = s2;
    }).observe(document, { subtree: true, childList: true, characterData: true });
  }, [settings, seed || null]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  return { ctx, page, errs };
}
async function until(fn, ms, step = 200) {
  const t0 = Date.now();
  let v;
  for (;;) {
    v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}
async function clickMove(page, from, to) {
  const xy = (sq) => page.evaluate((q) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const sz = r.width / 8;
    return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * sz, y: r.top + (8 - Number(q[1]) + 0.5) * sz };
  }, sq);
  const a = await xy(from); await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  const b = await xy(to); await page.mouse.click(b.x, b.y);
}
const learnKey = (page) => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("chess.v1.learn") || "null"); } catch { return null; } });
const campItems = (page) => page.evaluate(() => document.querySelectorAll("#lesson-list button[data-eg]").length);
async function openEndgame(page, id) {
  await until(async () => (await campItems(page)) > 0, 8000);
  return page.evaluate((x) => {
    const b = document.querySelector('#lesson-list button[data-eg="' + x + '"]');
    if (b) b.click();
    return !!b;
  }, id);
}
/** what the board shows, from the canvas: is square `sq` occupied */
const occ = (page, sq) => page.evaluate((q) => {
  const c = document.getElementById("board"), g = c.getContext("2d");
  const step = c.width / 8, f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
  const d = g.getImageData(Math.round(f * step + step * 0.2), Math.round(rk * step + step * 0.2), Math.round(step * 0.6), Math.round(step * 0.6)).data;
  let lo = 255, hi = 0;
  for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); }
  return hi - lo > 60;
}, sq);

// --- 1. 分块 ------------------------------------------------------------------
{
  served.length = 0;
  const { ctx, page, errs } = await openPage({ mode: "ai" });
  await page.waitForTimeout(600);
  assert(!served.some((p) => p.includes("chunk-endgames")), "人机模式打开：不取 chunk-endgames.js");
  await page.click('#rail button[data-view="learn"]').catch(() => {});
  const n = await until(() => campItems(page), 8000);
  assert(served.some((p) => p.includes("chunk-endgames")), "进学习以后才取分块");
  const parts = await page.evaluate(() => [...document.querySelectorAll("#lesson-list .lesson-part")].map((h) => h.textContent).filter((s) => /残局训练营/.test(s)));
  assert(n === 60 && parts.length === 5, "目录里有训练营：5 个主题、60 个残局（" + n + "，" + parts.length + "）", parts.join(" | "));
  assert(!errs.length, "分块：页面没有报错", errs.join(" / "));
  await ctx.close();
}

// --- 2–4. 走错、走对、「我的」 --------------------------------------------------
{
  const { ctx, page, errs } = await openPage({ mode: "learn", view: "play" });
  assert(await openEndgame(page, "mi-n-stop"), "走错：点开「马拦兵：带将的双击」");
  await page.waitForTimeout(500);
  const card = await page.evaluate(() => ({
    title: document.getElementById("lesson-title").textContent, task: document.getElementById("lesson-task").textContent,
    text: document.getElementById("lesson-text").textContent, status: document.getElementById("status") ? document.getElementById("status").textContent : "",
    opp: document.getElementById("black-role") ? document.getElementById("black-role").textContent : "",
  }));
  assert(/马拦兵/.test(card.title) && /守和/.test(card.task), "卡片写着名字和目标（守和）", JSON.stringify(card).slice(0, 200));
  assert(/Syzygy/.test(card.text), "出处一行写明用 Syzygy 核对过", card.text.slice(-80));
  assert(/满强度/.test(card.opp), "对手是满强度的引擎", card.opp);
  assert((await occ(page, "d1")) && (await occ(page, "c2")), "局面摆上了（d1 马、c2 兵）");
  // wrong: Kf2 lets the pawn run; the engine queens at full strength
  await clickMove(page, "g2", "f2");
  const failedRun = await until(() => page.evaluate(() => window.__toasts.find((s) => /已排进复习/.test(s)) || null), 20000, 250);
  assert(!!failedRun, "走错：引擎升变，判失败并排进复习", failedRun);
  let lk = await learnKey(page);
  const e1 = lk && lk.eg && lk.eg.srs && lk.eg.srs["mi-n-stop"];
  assert(!!e1 && e1.s === 0 && e1.due <= Date.now() && !(lk.eg.done || {})["mi-n-stop"], "走错：learn 键里记进复习队列、今天到期，不算做过", JSON.stringify(lk && lk.eg));
  // right: the run restarts itself after the failure (lessons.js learnRetryTask)
  await until(async () => (await occ(page, "d1")) && !(await occ(page, "f2")), 6000, 200);
  await clickMove(page, "d1", "e3");
  const replied = await until(async () => !(await occ(page, "c4")), 20000, 250);
  assert(replied, "走对：Ne3+ 之后引擎应了一手");
  const kingTook = await page.evaluate(() => null);
  void kingTook;
  // Nxc2 if the pawn is still there (the king may already have given it up)
  if (await occ(page, "c2")) await clickMove(page, "e3", "c2");
  const done = await until(() => page.evaluate(() => /完成/.test(document.getElementById("lesson-task").textContent)), 20000, 250);
  assert(done, "走对：吃掉兵就是子力不足的和棋，目标达成");
  lk = await learnKey(page);
  const e2 = lk && lk.eg && lk.eg.srs && lk.eg.srs["mi-n-stop"];
  assert(lk && lk.eg.done["mi-n-stop"] > 0 && e2 && e2.s === 1 && e2.due > Date.now() + 3600e3, "走对：记为做过，复习往后排", JSON.stringify(lk && lk.eg));
  const next = await page.evaluate(() => { const b = document.getElementById("lesson-next"); return { shown: !b.hidden, text: b.textContent, primary: b.classList.contains("primary") }; });
  assert(next.shown && /下一个残局/.test(next.text) && next.primary, "「下一个残局」亮着", JSON.stringify(next));
  // 我的
  await page.click('#rail button[data-view="me"]');
  await until(() => page.evaluate(() => !document.getElementById("sec-endgame").hidden), 6000);
  const me = await page.evaluate(() => ({
    shown: !document.getElementById("sec-endgame").hidden, meta: document.getElementById("eg-meta").textContent,
    rows: document.querySelectorAll("#eg-body .stat-row").length, review: !document.getElementById("eg-review").hidden,
    go: !document.getElementById("eg-go").hidden,
  }));
  assert(me.shown && me.meta === "1/60" && me.rows === 5 && !me.review && me.go, "我的：训练营 1/60，五行，没有到期的复习", JSON.stringify(me));
  await page.click("#eg-go");
  await page.waitForTimeout(600);
  const opened = await page.evaluate(() => ({ view: document.getElementById("page-me").hidden, title: document.getElementById("lesson-title").textContent }));
  assert(opened.view && /关键格/.test(opened.title), "进训练营：回到学习，打开第一个没做过的（关键格）", JSON.stringify(opened));
  assert(!errs.length, "走错走对：页面没有报错", errs.join(" / "));
  await ctx.close();
}

// --- 5. 旧存档 ----------------------------------------------------------------
{
  const old = JSON.stringify({ v: 1, done: { board: true, squares: true }, last: 1 });
  const { ctx, page, errs } = await openPage({ mode: "learn" }, { "chess.v1.learn": old });
  await until(async () => (await campItems(page)) > 0, 8000);
  const r = await page.evaluate(() => ({ prog: document.getElementById("learn-progress").textContent, title: document.getElementById("lesson-title").textContent }));
  assert(/2\/\d+/.test(r.prog) && /第 2 课/.test(r.title), "8.0 的教学进度照读：做过 2 课，停在第 2 课", JSON.stringify(r));
  await page.click('#rail button[data-view="me"]');
  const meta = await until(() => page.evaluate(() => document.getElementById("eg-meta").textContent), 6000);
  assert(meta === "0/60", "……训练营从 0/60 开始", meta);
  const lk = await learnKey(page);
  assert(lk && lk.done.board && lk.done.squares && lk.last === 1, "……存回去的 learn 键没丢东西", JSON.stringify(lk));
  assert(!errs.length, "旧存档：页面没有报错", errs.join(" / "));
  await ctx.close();
}

// --- 6. 三语，不截断 ------------------------------------------------------------
{
  const seed = JSON.stringify({ v: 1, done: {}, last: 0, eg: { done: { "kp-keysq": 1, "dr-vancura": 1 }, srs: { "rp-lucena2": { s: 0, n: 1, due: 1, ivl: 0 } } } });
  for (const lang of ["zh-CN", "en", "ja"]) {
    for (const viewport of [{ width: 1400, height: 900 }, { width: 520, height: 800 }]) {
      const tag = lang + " " + viewport.width;
      const { ctx, page, errs } = await openPage({ mode: "learn", langId: lang }, { "chess.v1.learn": seed }, viewport);
      await page.evaluate(() => { const d = document.querySelector("#sec-learn details.reading-index"); if (d) d.open = true; });
      await openEndgame(page, "rp-lucena2");
      await page.waitForTimeout(400);
      const cut = (sel) => page.evaluate((s) => {
        const out = [];
        const scope = document.querySelector(s);
        const box = scope.getBoundingClientRect();
        for (const e of scope.querySelectorAll("button, .side-h, .stat-k, .stat-v, .lesson-title, .lesson-task, .lesson-part, #lesson-text p")) {
          if (!e.offsetParent) continue;
          const r = e.getBoundingClientRect();
          if (e.scrollWidth > e.clientWidth + 1 || r.right > box.right + 1) out.push((e.id || e.textContent.trim().slice(0, 16)) + " " + e.scrollWidth + ">" + e.clientWidth);
        }
        return out;
      }, sel);
      const learnCut = await cut("#sec-learn");
      assert(learnCut.length === 0, tag + "：学习卡片和训练营目录没有被裁掉的字", learnCut.join(", "));
      const strip = await page.evaluate(() => { const e = document.getElementById("task-strip-text"); return e && e.offsetParent ? { t: e.textContent, over: e.scrollWidth > e.clientWidth + 1 } : null; });
      assert(!strip || !strip.over || strip.t.length > 0, tag + "：任务条有字", JSON.stringify(strip));
      await page.click('#rail button[data-view="me"]').catch(() => {});
      await until(() => page.evaluate(() => !document.getElementById("sec-endgame").hidden), 6000);
      const meCut = await cut("#sec-endgame");
      const rev = await page.evaluate(() => !document.getElementById("eg-review").hidden && document.getElementById("eg-review").textContent);
      assert(meCut.length === 0 && !!rev, tag + "：「我的」训练营一节没有被裁掉的字，复习按钮在（" + rev + "）", meCut.join(", "));
      const sideways = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert(sideways <= 0, tag + "：页面不横向滚动（" + sideways + "px）");
      assert(!errs.length, tag + "：页面没有报错", errs.join(" / "));
      await ctx.close();
    }
  }
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("endgames e2e: all passed");
