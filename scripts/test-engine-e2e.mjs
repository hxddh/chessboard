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
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  const control = p.startsWith("/control/");
  if (control) p = p.slice("/control".length);
  if (p === "/") p = "/index.html";
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

/** Open `prefix`, play 1. e4 against the computer, report what came back. */
async function firstReply(prefix) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false }));
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
  // the engine's own boot timeout is 30 s; past that, silence is the answer
  while (Date.now() - t0 < 35000) {
    plies = await page.evaluate(() => document.querySelectorAll(".move-list .mlmove").length);
    if (plies >= 2) break;
    await page.waitForTimeout(250);
  }
  const out = await page.evaluate(() => ({
    moves: [...document.querySelectorAll(".move-list .mlmove")].map((e) => e.getAttribute("aria-label") || e.textContent.trim()),
    pill: ((document.querySelector(".status-pill") || {}).textContent || "").trim(),
  }));
  await ctx.close();
  return { ...out, plies, ms: Date.now() - t0, errs };
}

const shipped = await firstReply("");
console.log("原样:", JSON.stringify({ moves: shipped.moves, pill: shipped.pill, ms: shipped.ms }));
for (const e of shipped.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

const control = await firstReply("/control");
console.log("诊断(去掉 CSP):", JSON.stringify({ moves: control.moves, pill: control.pill, ms: control.ms }));
for (const e of control.errs.slice(0, 3)) console.log("  ", e.slice(0, 300));

assert(shipped.plies >= 2, "原样页面里，人机走 1. e4，引擎应了一手(" + ENGINE + ")");
assert(!shipped.errs.length, "…页面上没有报错");
if (shipped.plies < 2) {
  console.error(control.plies >= 2
    ? "诊断:去掉 CSP 之后引擎能应 —— 是 index.html 的 CSP 挡住了它"
    : "诊断:去掉 CSP 也不应 —— 引擎在这个浏览器里本身就起不来");
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("engine e2e: all passed");
