/**
 * What minifying the bundle does to startup (v8-1-plan F2, option a).
 *
 * F2's acceptance asks for DOMContentLoaded before and after, in all three
 * languages. This builds both forms of the same tree — readable (the build
 * through 8.0) and minified (MINIFY in bundle.mjs) — holds each in memory,
 * and loads the page alternately from one and the other, so drift in a
 * shared machine lands on both sides alike. Per load it reads, on the page's
 * own timeline (navigation start = 0):
 *
 *   dcl          domContentLoadedEventEnd: bundle.js parsed and run, the
 *                boot chunk's language chunks with it
 *   interactive  the later of the board's first getContext and its
 *                pointerdown listener — test-board-e2e's 首屏到可交互
 *
 * and reports medians. A measurement, not a gate: the gates are the budget in
 * test-chess.mjs and test-board-e2e's < 1000 ms.
 *
 *   node scripts/measure-boot.mjs [--runs=N] [--record]
 *
 * --record writes the figures and the byte counts to docs/measured.json
 * (`bundleMinify`). Chromium only, like perf-e2e: one engine's timeline is
 * enough to compare two builds with each other.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { build, CHUNKS, OUT, BUNDLE_BUDGET, BUNDLE_BYTES_BEFORE_F5, BUNDLE_BYTES_BEFORE_F5_READABLE } from "./bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const ROOT = path.join(REPO, "src", "web");
const RUNS = Number((process.argv.find((a) => a.startsWith("--runs=")) || "=15").split("=")[1]);
const LANGS = ["zh-CN", "en", "ja"];

if (ENGINE !== "chromium") {
  console.log("measure-boot 只在 Chromium 上量，E2E_BROWSER=" + ENGINE + " 不适用");
  process.exit(0);
}

/** Build one form and keep every file it wrote, by served path. */
async function snapshot(minify) {
  const text = await build({ write: true, minify });
  const files = new Map([["/js/bundle.js", Buffer.from(text, "utf8")]]);
  for (const c of CHUNKS) files.set("/js/" + path.basename(c.out), fs.readFileSync(path.join(REPO, c.out)));
  const bytes = {};
  for (const [p, b] of files) bytes[path.basename(p)] = b.length;
  return { files, bytes };
}
const forms = { readable: await snapshot(false), minified: await snapshot(true) };
// the tree is left as every other script expects it: built, minified
if (!fs.readFileSync(OUT).equals(forms.minified.files.get("/js/bundle.js"))) throw new Error("bundle.js on disk is not the minified build");

let serving = forms.minified;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".wasm": "application/wasm" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the engine is never loaded at startup; test-board-e2e stubs it the same way
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  const mem = serving.files.get(p);
  try {
    const d = mem || fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await launchBrowser();

async function once(lang) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: lang });
  await ctx.addInitScript((l) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "pvp", langId: l, sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__t = { painted: null, wired: null };
    const realCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) {
      if (this.id === "board" && window.__t.painted == null) window.__t.painted = performance.now();
      return realCtx.apply(this, a);
    };
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (type === "pointerdown" && this.id === "board" && window.__t.wired == null) window.__t.wired = performance.now();
      return realAdd.call(this, type, ...rest);
    };
  }, lang);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__t && window.__t.painted != null && window.__t.wired != null &&
    performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd > 0, null, { timeout: 30000 });
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return { dcl: nav.domContentLoadedEventEnd - nav.startTime, interactive: Math.max(window.__t.painted, window.__t.wired) - nav.startTime,
      lang: document.documentElement.lang };
  });
  await ctx.close();
  if (errs.length) throw new Error(lang + ": " + errs[0]);
  if (t.lang !== lang) throw new Error(lang + ": the page came up in " + t.lang);
  return t;
}

const median = (xs) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const samples = {};
for (const f of Object.keys(forms)) { samples[f] = {}; for (const l of LANGS) samples[f][l] = { dcl: [], interactive: [] }; }
// one warm-up per form and language, not counted: the first launch pays for the browser
for (const f of Object.keys(forms)) { serving = forms[f]; for (const l of LANGS) await once(l); }
for (let i = 0; i < RUNS; i++) {
  for (const l of LANGS) {
    // alternate which form goes first, so neither always follows the other
    for (const f of i % 2 ? ["minified", "readable"] : ["readable", "minified"]) {
      serving = forms[f];
      const t = await once(l);
      samples[f][l].dcl.push(t.dcl);
      samples[f][l].interactive.push(t.interactive);
    }
  }
}
await browser.close();
server.close();

const r1 = (x) => Math.round(x * 10) / 10;
const result = {};
for (const f of Object.keys(forms)) {
  result[f] = {};
  for (const l of LANGS) result[f][l] = { dclMs: r1(median(samples[f][l].dcl)), interactiveMs: r1(median(samples[f][l].interactive)) };
}
for (const l of LANGS) {
  console.log(`${l.padEnd(6)} DOMContentLoaded ${result.readable[l].dclMs} → ${result.minified[l].dclMs} ms, ` +
    `可交互 ${result.readable[l].interactiveMs} → ${result.minified[l].interactiveMs} ms（中位数，各 ${RUNS} 次）`);
}
const B = (f) => forms[f].bytes["bundle.js"];
console.log(`bundle.js ${B("readable")} → ${B("minified")} 字节；预算 ${BUNDLE_BUDGET}（7.9.0 压缩后 ${BUNDLE_BYTES_BEFORE_F5} × 70.5%）`);

if (process.argv.includes("--record")) {
  const file = path.join(REPO, "docs/measured.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  const chunkTotal = (f) => Object.entries(forms[f].bytes).filter(([k]) => k !== "bundle.js").reduce((a, [, v]) => a + v, 0);
  m.bundleMinify = {
    what: "v8-1-plan F2 (a)：bundle.js 与分块开 minifyWhitespace + minifySyntax、保留标识符。前后字节数、新预算，以及同一棵树两种构建交替加载的 DOMContentLoaded / 首屏到可交互（Chromium，页面自己的时间轴，中位数）",
    script: "scripts/measure-boot.mjs --record",
    engine: ENGINE,
    runs: RUNS,
    budget: {
      base790Readable: BUNDLE_BYTES_BEFORE_F5_READABLE, base790Minified: BUNDLE_BYTES_BEFORE_F5, ratio: 0.705, budget: BUNDLE_BUDGET,
      budgetBefore: Math.floor(BUNDLE_BYTES_BEFORE_F5_READABLE * 0.705),
      headroomBefore: Math.floor(BUNDLE_BYTES_BEFORE_F5_READABLE * 0.705) - B("readable"), headroomAfter: BUNDLE_BUDGET - B("minified"),
    },
    bytes: { before: forms.readable.bytes, after: forms.minified.bytes, chunksTotalBefore: chunkTotal("readable"), chunksTotalAfter: chunkTotal("minified") },
    before: result.readable,
    after: result.minified,
  };
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  console.log("recorded docs/measured.json bundleMinify");
}
