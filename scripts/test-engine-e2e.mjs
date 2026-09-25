/**
 * The one browser check that boots the real engine.
 *
 * Every other *-e2e.mjs serves `js/engine-src.js` as a one-line comment, so
 * none of them ever loaded Stockfish in a page. The engine's own tests run in
 * node, where there is no Content-Security-Policy. Between the two, nothing
 * ever asked whether the page as shipped can start the engine at all — and
 * since 6.0 added a CSP to index.html whose script-src has no
 * 'wasm-unsafe-eval', in Chromium it cannot (v7-4-plan §1).
 *
 * Two pages, same move (1. e4 against the computer):
 *   shipped   index.html byte for byte. This is the assertion.
 *   control   the same page with the CSP meta removed. Printed, not asserted:
 *             it tells a red run apart — "the CSP blocks the engine" (control
 *             answers, shipped does not) from "the engine does not run in this
 *             browser at all" (neither answers).
 *   broken    the shipped page, but engine-src.js carries the real loader and
 *             a wasm that cannot compile. Until 7.4 this is what every
 *             install looked like, and the page said nothing: the pill sat on
 *             「引擎思考中…」 while the app booted three workers in a row. Now
 *             the pill must let go, a notice must say the engine did not
 *             start, and the boots must stop (v7-4-plan §1 做什么 2).
 *
 * Runs on whichever engine E2E_BROWSER names (see e2e-browser.mjs), so the
 * chromium / webkit matrix in checks.yml answers the question for both
 * platforms. Generates engine-src.js first when it is missing or a stub.
 *
 *   node scripts/test-engine-e2e.mjs
 *   node scripts/test-engine-e2e.mjs --root=path/to/frontend/dist   (a packaged build)
 */
import fs from "fs";
import http from "http";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const rootArg = process.argv.find((a) => a.startsWith("--root="));
const ROOT = rootArg ? path.resolve(rootArg.slice(7)) : path.join(HERE, "..", "src", "web");

if (!rootArg) {
  const src = path.join(ROOT, "js", "engine-src.js");
  // sync-dist's own threshold for "carries the whole wasm"
  if (!fs.existsSync(src) || fs.statSync(src).size <= 2000000) {
    execFileSync(process.execPath, [path.join(HERE, "gen-engine-src.mjs")], { stdio: "inherit" });
  }
}

const { launchBrowser, ENGINE } = await import("./e2e-browser.mjs");

const CSP_META = /<meta http-equiv="Content-Security-Policy"[^>]*>/;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
// the real loader, and a wasm that starts with the magic number and then is
// garbage: atob() takes it, WebAssembly.instantiate() does not
const SF = path.join(HERE, "..", "third_party", "stockfish");
const BROKEN_SRC =
  "window.CHESS_SF_LOADER = " + JSON.stringify(fs.readFileSync(path.join(SF, "stockfish-19-lite-single.js"), "utf8")) + ";\n" +
  "window.CHESS_SF_WASM_B64 = " + JSON.stringify(Buffer.concat([
    Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]), Buffer.alloc(256, 0xff)]).toString("base64")) + ";\n";
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  const control = p.startsWith("/control/");
  if (control) p = p.slice("/control".length);
  const broken = p.startsWith("/broken/");
  if (broken) p = p.slice("/broken".length);
  // 7.6 self-test: the shipped page with its eco chunk missing
  const nochunk = p.startsWith("/nochunk/");
  if (nochunk) p = p.slice("/nochunk".length);
  if (p === "/") p = "/index.html";
  if (nochunk && p === "/js/chunk-eco.js") { res.writeHead(404); res.end(); return; }
  if (broken && p === "/js/engine-src.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end(BROKEN_SRC);
    return;
  }
  try {
    let d = fs.readFileSync(path.join(ROOT, p));
    if (control && p === "/index.html") d = Buffer.from(String(d).replace(CSP_META, ""));
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
console.log("引擎:", ENGINE, "· 页面:", ROOT);

const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const csp = (html.match(CSP_META) || [""])[0];
console.log("CSP:", csp ? csp.replace(/.*content="([^"]*)".*/, "$1") : "(无)");

/**
 * Open `prefix`, play 1. e4 against the computer, report what came back.
 * With `failing`, the engine is expected not to start: the wait ends as soon
 * as the page has said so, and the probe also reports the notice and how many
 * engine workers the page built.
 */
async function firstReply(prefix, failing) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false }));
    // every boot builds one worker: counting them counts the boot attempts
    const W = window.Worker;
    window.__workers = 0;
    window.Worker = function (...a) { window.__workers++; return new W(...a); };
    window.Worker.prototype = W.prototype;
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  page.on("console", (m) => {
    const s = m.text();
    // the favicon 404 is the http server's, not the app's
    if (m.type() === "error" && !/Failed to load resource/.test(s)) errs.push("console: " + s);
  });
  await page.goto(`http://127.0.0.1:${PORT}${prefix}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const xy = (s) => page.evaluate((sq) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const f = sq.charCodeAt(0) - 97, rk = 8 - Number(sq[1]);
    const sz = r.width / 8;
    return { x: r.left + (f + 0.5) * sz, y: r.top + (rk + 0.5) * sz };
  }, s);
  const a = await xy("e2"); await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  const b = await xy("e4"); await page.mouse.click(b.x, b.y);
  const t0 = Date.now();
  let plies = 0;
  const probe = () => page.evaluate(() => {
    const pillEl = document.getElementById("status");   // 7.7: the sentence is .sr-only
    const n = document.getElementById("engine-fault");
    return {
      moves: [...document.querySelectorAll(".move-list .mlmove")].map((e) => e.getAttribute("aria-label") || e.textContent.trim()),
      pill: ((pillEl || {}).textContent || "").trim(),
      thinking: !!document.querySelector(".pstrip.thinking"),   // 7.7: the engine's disc breathes
      notice: n && !n.hidden && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : "",
      workers: window.__workers,
    };
  });
  let out = null;
  // the engine's own boot timeout is 30 s; past that, silence is the answer
  while (Date.now() - t0 < (failing ? 40000 : 35000)) {
    if (failing) {
      out = await probe();
      if (!out.thinking && !/思考中/.test(out.pill) && out.notice) break;
    } else {
      plies = await page.evaluate(() => document.querySelectorAll(".move-list .mlmove").length);
      if (plies >= 2) break;
    }
    await page.waitForTimeout(250);
  }
  const ms = Date.now() - t0;
  out = await probe();
  plies = out.moves.length;
  if (failing) {
    // a bounded retry is fine; a loop is not — nothing may boot after this
    await page.waitForTimeout(8000);
    out.workersLater = (await probe()).workers;
    // …and an explicit 重试 is the one thing that boots again: once
    await page.click('#engine-fault button:text-is("重试")', { timeout: 3000 }).catch((e) => console.log("click:", e.message.split("\n")[0]));
    await page.waitForTimeout(3000);
    const again = await probe();
    out.workersRetry = again.workers;
    out.noticeRetry = again.notice;
    // 7.5: 新局 is the other place a dead engine is tried again — once, and a
    // second failure is the same notice, not a toast
    await page.evaluate(() => { window.__toasts = [];
      const el = document.getElementById("toast");
      if (el) new MutationObserver(() => { if (el.textContent.trim()) window.__toasts.push(el.textContent.trim()); })
        .observe(el, { childList: true }); });
    // the button sits in a tab the viewport may have scrolled under #app: the
    // handler is what is under test, not the hit-testing
    await page.evaluate(() => document.getElementById("btn-new").click());
    await page.click("#confirm-ok", { timeout: 3000 }).catch(() => {});
    await page.waitForTimeout(3000);
    const fresh = await probe();
    out.workersNew = fresh.workers;
    out.noticeNew = fresh.notice;
    out.movesNew = fresh.moves.length;
    out.toastsNew = (await page.evaluate(() => window.__toasts)).length;
  }
  await ctx.close();
  return { ...out, plies, ms, errs };
}

const shipped = await firstReply("");
console.log("原样:", JSON.stringify({ moves: shipped.moves, pill: shipped.pill, ms: shipped.ms }));
for (const e of shipped.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

const control = await firstReply("/control");
console.log("诊断(去掉 CSP):", JSON.stringify({ moves: control.moves, pill: control.pill, ms: control.ms }));
for (const e of control.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

const broken = await firstReply("/broken", true);
console.log("坏引擎:", JSON.stringify({ moves: broken.moves, pill: broken.pill, notice: broken.notice,
  workers: broken.workers, workersLater: broken.workersLater, workersRetry: broken.workersRetry,
  workersNew: broken.workersNew, toastsNew: broken.toastsNew, ms: broken.ms }));
for (const e of broken.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

// Codex review on #76: in 双人 mode nothing boots the engine at startup, so
// the first boot is the lazy one a hint makes by calling ChessEngine directly
// — around bootEngine(). Its failure has to reach the same notice and the
// same gate, or every press of 提示 builds another worker.
const pvp = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }));
    const W = window.Worker;
    window.__workers = 0;
    window.Worker = function (...a) { window.__workers++; return new W(...a); };
    window.Worker.prototype = W.prototype;
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/broken/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const before = await page.evaluate(() => window.__workers);
  for (let i = 0; i < 3; i++) { await page.click("#btn-hint").catch(() => {}); await page.waitForTimeout(2500); }
  const out = await page.evaluate(() => {
    const n = document.getElementById("engine-fault");
    return { workers: window.__workers, notice: n && !n.hidden && n.getBoundingClientRect().height > 0 ? n.textContent.trim() : "" };
  });
  await ctx.close();
  return { before, ...out };
})();
console.log("坏引擎 · 双人 · 连按三次提示:", JSON.stringify(pvp));
assert(pvp.before === 0, "双人模式启动时不启动引擎(workers " + pvp.before + ")");
assert(!!pvp.notice && /引擎/.test(pvp.notice), "双人模式：提示按钮懒启动失败，同样出现启动失败提示");
assert(pvp.workers === 1, "双人模式：连按三次提示只启动一次，不每按一次就起一个 worker(workers " + pvp.workers + ")");

// Codex review on #77: a lesson drill whose sparring reply was the lazy boot
// that failed. The student's move stands, it is Black to move, and only White
// may move in a drill — so 重试 must fetch the reply, not just boot and redraw.
// The first worker the page builds throws; the retry gets the real engine.
const drill = await (async () => {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "learn", langId: "zh-CN", sideTab: "play", soundOn: false }));
    const W = window.Worker;
    window.__workers = 0;
    window.Worker = function (...a) {
      if (++window.__workers === 1) throw new Error("first boot fails on purpose");
      return new W(...a);
    };
    window.Worker.prototype = W.prototype;
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  // 卢塞纳：the course's first drill; 1K1k4/1P6/8/8/8/8/r7/2R5 w
  await page.evaluate(() => {
    const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
    rows.find((r) => /卢塞纳/.test(r.textContent || ""))?.click();
  });
  await page.waitForTimeout(800);
  const xy = (sq) => page.evaluate((q) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const sz = r.width / 8;
    return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * sz, y: r.top + (8 - Number(q[1]) + 0.5) * sz };
  }, sq);
  const a = await xy("c1"); await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  const b = await xy("d1"); await page.mouse.click(b.x, b.y);
  await page.waitForTimeout(2500);
  const occ = (sq) => page.evaluate((q) => {
    const c = document.getElementById("board"), g = c.getContext("2d");
    const step = c.width / 8, f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
    const d = g.getImageData(Math.round(f * step + step * 0.2), Math.round(rk * step + step * 0.2),
      Math.round(step * 0.6), Math.round(step * 0.6)).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); }
    return hi - lo > 60;
  }, sq);
  const notice = () => page.evaluate(() => {
    const n = document.getElementById("engine-fault");
    return !!n && !n.hidden && n.getBoundingClientRect().height > 0;
  });
  const before = { d1: await occ("d1"), d8: await occ("d8"), a2: await occ("a2"), notice: await notice(), workers: await page.evaluate(() => window.__workers) };
  await page.click('#engine-fault button:text-is("重试")', { timeout: 3000 }).catch((e) => console.log("click:", e.message.split("\n")[0]));
  // Black is in check from d1: the reply either moves the king off d8 or
  // interposes the a2 rook on d2 — either way one of the two squares empties
  let replied = false;
  for (let i = 0; i < 60 && !replied; i++) { await page.waitForTimeout(250); replied = !(await occ("d8")) || !(await occ("a2")); }
  const after = { replied, notice: await notice(), workers: await page.evaluate(() => window.__workers) };
  await ctx.close();
  return { before, after };
})();
console.log("教学对练 · 首次懒启动失败后重试:", JSON.stringify(drill));
assert(drill.before.d1 && drill.before.d8 && drill.before.a2 && drill.before.notice,
  "教学对练：学生那一步留在棋盘上、轮到黑方，引擎懒启动失败给出提示");
assert(drill.after.replied && !drill.after.notice,
  "教学对练：按「重试」之后引擎补上黑方那一步，对练接着进行，不卡住");

// 7.5: the packaged app's self-test (CHESS_SELFTEST=1, main.zig). The native
// half — mode on, report written, exit code — has its own zig tests; this is
// the page half, with a stand-in bridge that answers the two self-test
// commands and keeps chessboard.json in memory (7.6: the report has four
// checks — engine, appdata, chunk, restart). On the real engine the report
// says ok with a legal move; with one piece broken it says not ok and names
// that check, instead of hanging. `reloads` relaunches the page in the same
// context, which is what the restart check needs: localStorage survives it.
async function selftestPage(prefix, { appdataWrite = "ok", reloads = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((writeMode) => {
    window.__report = null;
    let file = null; // base64 of chessboard.json, or null when there is none
    window.zero = {
      invoke: async (name, args) => {
        if (name === "chess.selftestMode") return { on: true };
        if (name === "chess.selftestReport") { window.__report = args; return {}; }
        if (name === "chess.appdataRead") return file == null ? { missing: true } : { b64: file };
        if (name === "chess.appdataWrite") {
          if (writeMode === "reject") return { error: "io" };
          file = args.b64;
          return { ok: true };
        }
        throw new Error("not in this stand-in: " + name);
      },
      on() {},
    };
  }, appdataWrite);
  const page = await ctx.newPage();
  const reports = [];
  for (let run = 0; run <= reloads; run++) {
    if (run === 0) await page.goto(`http://127.0.0.1:${PORT}${prefix}/`);
    else await page.reload();
    let rep = null;
    for (let i = 0; i < 280 && !rep; i++) { await page.waitForTimeout(250); rep = await page.evaluate(() => window.__report); }
    reports.push(rep);
  }
  await ctx.close();
  return reloads ? reports : reports[0];
}
const brief = (r) => r && { ok: r.ok, move: r.move, ms: r.ms, err: r.err, checks: r.checks };
const passed = (r, k) => !!(r && r.checks && r.checks[k] && r.checks[k].pass === true);
const [selfOk, selfOk2] = await selftestPage("", { reloads: 1 });
const selfBad = await selftestPage("/broken");
const selfNoWrite = await selftestPage("", { appdataWrite: "reject" });
const selfNoChunk = await selftestPage("/nochunk");
console.log("自检 · 原样:", JSON.stringify(brief(selfOk)));
console.log("自检 · 原样，重启后:", JSON.stringify(brief(selfOk2)));
console.log("自检 · 坏引擎:", JSON.stringify(brief(selfBad)));
console.log("自检 · 存档写入被拒:", JSON.stringify(brief(selfNoWrite)));
console.log("自检 · eco 分块缺失:", JSON.stringify(brief(selfNoChunk)));
assert(!!selfOk && selfOk.ok === true && typeof selfOk.move === "string" && selfOk.move.length >= 2,
  "自检（页面这一半）：原样页面报告 ok，并给出一步合法着法");
assert(["engine", "appdata", "chunk", "restart"].every((k) => passed(selfOk, k)) && !selfOk.err,
  "自检：原样页面四项（engine、appdata、chunk、restart）分别报告通过");
assert(/^B20 /.test(String(selfOk && selfOk.checks.chunk.name)),
  "自检：chunk 一项真的从 eco 分块里查到了 1.e4 c5 的开局名(" + (selfOk && selfOk.checks.chunk.name) + ")");
assert(!JSON.stringify(Object.values((selfOk && selfOk.checks) || {})).includes('"ok":'),
  "自检：各项用 pass 而不用 ok —— main.zig 按报告里有没有 \"ok\":true 决定退出码");
assert(!!selfOk && !!selfOk2 && selfOk.checks.restart.found == null &&
  selfOk2.checks.restart.found === selfOk.checks.restart.wrote && selfOk2.ok === true,
  "自检：第二次启动读回了第一次写下的 localStorage 标记(" + (selfOk2 && selfOk2.checks.restart.found) + ")");
assert(!!selfBad && selfBad.ok === false && !!selfBad.err,
  "自检（页面这一半）：引擎起不来时报告 ok:false 并写明原因，不会一直挂着");
assert(!!selfBad && !passed(selfBad, "engine") && /^engine: /.test(selfBad.err) && passed(selfBad, "chunk") && passed(selfBad, "appdata"),
  "自检：坏引擎只让 engine 一项红，err 以 engine 开头，其余各项照常检查");
assert(!!selfNoWrite && selfNoWrite.ok === false && !passed(selfNoWrite, "appdata") && passed(selfNoWrite, "engine") &&
  passed(selfNoWrite, "chunk") && /^appdata: .*io/.test(selfNoWrite.err || ""),
  "自检：存档写入被拒时 ok:false，err 点名 appdata 并带上原因");
assert(!!selfNoChunk && selfNoChunk.ok === false && !passed(selfNoChunk, "chunk") && passed(selfNoChunk, "engine") &&
  /^chunk: .*chunk-eco\.js/.test(selfNoChunk.err || ""),
  "自检：eco 分块加载不到时 ok:false，err 点名 chunk 和那个文件");

assert(shipped.plies >= 2, "原样页面里，人机走 1. e4，引擎应了一手(" + ENGINE + ")");
assert(!shipped.errs.length, "…页面上没有报错");
assert(!broken.thinking && !/思考中/.test(broken.pill) && broken.ms < 40000,
  "坏引擎：40 秒内状态药丸不再停在「引擎思考中…」(" + broken.pill + ")");
assert(!!broken.notice && /引擎/.test(broken.notice), "坏引擎：页面上有一条看得见的启动失败提示");
assert(broken.workers >= 1 && broken.workers <= 2 && broken.workersLater === broken.workers,
  "坏引擎：启动有上限，不无限重试(workers " + broken.workers + " → " + broken.workersLater + ")");
assert(broken.workersRetry === broken.workersLater + 1 && !!broken.noticeRetry,
  "坏引擎：点「重试」只再启动一次，失败后提示仍在(workers " + broken.workersRetry + ")");
assert(broken.movesNew === 0 && broken.workersNew === broken.workersRetry + 1 && !!broken.noticeNew && !broken.toastsNew,
  "坏引擎：点「新局」顺带重试一次，失败后仍是那条提示、不另弹 toast(workers " + broken.workersRetry + " → " + broken.workersNew + ", toasts " + broken.toastsNew + ")");
if (shipped.plies < 2) {
  console.error(control.plies >= 2
    ? "诊断:去掉 CSP 之后引擎能应 —— 是 index.html 的 CSP 挡住了它"
    : "诊断:去掉 CSP 也不应 —— 引擎在这个浏览器里本身就起不来");
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("engine e2e: all passed");
