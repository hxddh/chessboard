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
  if (p === "/") p = "/index.html";
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
  await page.click("#pick-cancel").catch(() => {});
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
    const pillEl = document.querySelector(".status-pill");
    const n = document.getElementById("engine-fault");
    return {
      moves: [...document.querySelectorAll(".move-list .mlmove")].map((e) => e.getAttribute("aria-label") || e.textContent.trim()),
      pill: ((pillEl || {}).textContent || "").trim(),
      thinking: !!(pillEl && pillEl.classList.contains("thinking")),
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
  workers: broken.workers, workersLater: broken.workersLater, workersRetry: broken.workersRetry, ms: broken.ms }));
for (const e of broken.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

assert(shipped.plies >= 2, "原样页面里，人机走 1. e4，引擎应了一手(" + ENGINE + ")");
assert(!shipped.errs.length, "…页面上没有报错");
assert(!broken.thinking && !/思考中/.test(broken.pill) && broken.ms < 40000,
  "坏引擎：40 秒内状态药丸不再停在「引擎思考中…」(" + broken.pill + ")");
assert(!!broken.notice && /引擎/.test(broken.notice), "坏引擎：页面上有一条看得见的启动失败提示");
assert(broken.workers >= 1 && broken.workers <= 2 && broken.workersLater === broken.workers,
  "坏引擎：启动有上限，不无限重试(workers " + broken.workers + " → " + broken.workersLater + ")");
assert(broken.workersRetry === broken.workersLater + 1 && !!broken.noticeRetry,
  "坏引擎：点「重试」只再启动一次，失败后提示仍在(workers " + broken.workersRetry + ")");
if (shipped.plies < 2) {
  console.error(control.plies >= 2
    ? "诊断:去掉 CSP 之后引擎能应 —— 是 index.html 的 CSP 挡住了它"
    : "诊断:去掉 CSP 也不应 —— 引擎在这个浏览器里本身就起不来");
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("engine e2e: all passed");
