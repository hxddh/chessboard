/**
 * Browser check for the automation build's page-side scenarios
 * (src/web/js/selftest-scenarios.js, v8-2-plan V1 step 2), before any runner
 * has launched the real app with them: every scenario runs here, in the order
 * scripts/automation-scenarios.mjs runs them, on one browser profile (a
 * restart is a new page in the same context), with window.zero stubbed.
 *
 * The stub stands in for main.zig: chess.selftestMode names the scenario;
 * chess.selftestReport keeps every report (scenario mode: it does not exit);
 * chess.fetchGames does what main.zig does with CHESS_SYNC_BASE set — the
 * same paths and queries, against scripts/fake-sync-server.mjs, the answer
 * cut into games, `since` applied, {pgn, count, last} or the error code —
 * and chess.fetchProgress counts the games as they stream in. main.zig's own
 * half (the rebase, the http) is its Zig tests; the real app with the real
 * WebView is the CI job (build-macos.yml / build-windows.yml "automation").
 *
 * What only this can catch before CI: a scenario that throws, waits for
 * something the page never does, or judges the fake server's answers wrong.
 *
 *   node scripts/test-selftest-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { startFakeSyncServer } from "./fake-sync-server.mjs";

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

const fake = await startFakeSyncServer({ delayMs: 40, games: 100 });
const UA = "chessboard (+https://github.com/hxddh/chessboard)";

/** sync.zig syncStatusError */
const statusError = (s) => (s === 0 ? "offline" : s === 200 ? null : s === 404 || s === 410 ? "not_found" : s === 429 ? "rate_limited" : "http");
/** sync.zig pgnUtcMs */
const utcMs = (g) => {
  const d = /\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]/.exec(g), t = /\[UTCTime "(\d{2}):(\d{2}):(\d{2})"\]/.exec(g);
  return d && t ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) : null;
};
const games = (body) => body.split(/^(?=\[Event )/m).map((g) => g.trim()).filter((g) => g.startsWith("[Event "));
let progress = null;
/** One GET as sync.zig's httpGet does it: the status, or 0 when nothing came back. */
async function get(url, accept, onText) {
  return new Promise((resolve) => {
    const req = http.get(url, { headers: { "user-agent": UA, accept } }, (res) => {
      let text = "";
      res.setEncoding("utf8");
      res.on("data", (c) => { text += c; if (onText) onText(text); });
      res.on("end", () => resolve({ status: res.statusCode, text }));
      res.on("error", () => resolve({ status: 0, text: "" }));
    });
    req.on("error", () => resolve({ status: 0, text: "" }));
  });
}
/** sync.zig syncFetch, with the sites' host swapped for the fake server's. */
async function nativeFetch(p) {
  const answer = (list, since) => {
    const kept = list.filter((g) => !(since && utcMs(g) != null && utcMs(g) < since)).slice(0, p.max);
    const times = kept.map(utcMs).filter((x) => x != null);
    const r = { pgn: kept.join("\n\n"), count: kept.length };
    if (times.length) r.last = Math.max(...times);
    return r;
  };
  if (p.site === "lichess") {
    let q = "max=" + p.max + "&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false";
    if (p.since) q += "&since=" + p.since + "&sort=dateAsc";
    progress = 0;
    const r = await get(fake.base + "/api/games/user/" + p.user + "?" + q, "application/x-chess-pgn", (t) => { progress = Math.min(p.max, (t.match(/^\[Event /gm) || []).length); });
    progress = null;
    const e = statusError(r.status);
    return e ? (e === "http" ? { error: e, status: r.status } : { error: e }) : answer(games(r.text), p.since || 0);
  }
  const list = await get(fake.base + "/pub/player/" + p.user.toLowerCase() + "/games/archives", "application/json");
  const e = statusError(list.status);
  if (e) return { error: e };
  const months = JSON.parse(list.text).archives;
  const out = [];
  for (let i = months.length - 1; i >= 0 && i >= months.length - 3 && out.length < p.max; i--) {
    const m = await get(months[i].replace("https://api.chess.com", fake.base), "application/json");
    if (statusError(m.status)) break;
    const gs = JSON.parse(m.text).games.filter((g) => (g.rules || "chess") === "chess").map((g) => g.pgn.trim());
    out.push(...gs.reverse());
  }
  return answer(out, 0);
}

const browser = await launchBrowser();
console.log("引擎:", ENGINE);
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
await ctx.exposeFunction("__nativeFetch", (p) => nativeFetch(p));
await ctx.exposeFunction("__nativeProgress", () => (progress == null ? { busy: false, count: 0 } : { busy: true, count: progress }));

/** One launch: a new page on the same profile, running `scenario`; its last report. */
async function launch(scenario, drive, expectOk = true) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.addInitScript((scenario) => {
    window.__reports = [];
    window.__listeners = {};
    window.zero = {
      invoke: (cmd, payload) => {
        if (cmd === "chess.selftestMode") return Promise.resolve({ on: true, scenario });
        if (cmd === "chess.selftestReport") { window.__reports.push(JSON.parse(JSON.stringify(payload))); return Promise.resolve({ written: true }); }
        if (cmd === "chess.fetchGames") return window.__nativeFetch(payload);
        if (cmd === "chess.fetchProgress") return window.__nativeProgress();
        if (cmd === "chess.openPgn" || cmd === "chess.saveText") return Promise.resolve({ cancelled: true });
        return Promise.resolve(true);
      },
      on: (name, cb) => { (window.__listeners[name] = window.__listeners[name] || []).push(cb); return () => {}; },
      off: () => {},
      platform: { supports: () => Promise.resolve(true) },
      os: { addRecentDocument: () => Promise.resolve(true), clearRecentDocuments: () => Promise.resolve(true),
        showNotification: () => Promise.resolve(true), revealPath: () => Promise.resolve(true) },
      clipboard: { readText: () => Promise.resolve(""), writeText: () => Promise.resolve(true) },
    };
    window.__fire = (name, detail) => { for (const cb of window.__listeners[name] || []) cb(detail); };
  }, scenario);
  await page.goto(`http://127.0.0.1:${PORT}/`);
  const last = () => page.evaluate(() => window.__reports[window.__reports.length - 1] || null);
  const stage = async (want, ms = 60000) => {
    const end = Date.now() + ms;
    for (;;) {
      const r = await last();
      if (r && (r.stage === want || r.stage === "done")) return r;
      if (Date.now() > end) return r;
      await page.waitForTimeout(100);
    }
  };
  if (drive) await drive(page, stage);
  const r = await stage("done", 120000);
  await page.close();
  assert(errs.length === 0, scenario + ": no page errors (" + errs.join(" | ") + ")");
  const bad = r ? Object.entries(r.checks || {}).filter(([, c]) => !c.pass).map(([k, c]) => k + ": " + c.err) : ["no report"];
  if (expectOk) assert(r && r.stage === "done" && r.ok === true, scenario + ": every check passed (" + (bad.join("; ") || Object.keys(r.checks).join(", ")) + ")");
  return r;
}

const seed = await launch("rep-seed");
assert(seed.checks.syncOff && seed.checks.syncOff.pass, "rep-seed: 允许联网同步 is off on a fresh profile (R5)");
const indexed = await launch("rep-index");
const ix = indexed.checks.indexed || {};
assert(ix.lines && ix.lines.length === 2 && ix.records.length > 0 && ix.due > 0,
  "rep-index: the boot moved the two lines into chessboard.book, with records and cards due (" + JSON.stringify(ix) + ")");
const reread = await launch("rep-read");
const rb = reread.checks.readBack || {};
assert(JSON.stringify(rb.records) === JSON.stringify(ix.records) && JSON.stringify(rb.lines) === JSON.stringify(ix.lines), "rep-read: the same records and lines after a restart (R17)");

const sync = await launch("sync");
const li = sync.checks.lichess || {};
assert(li.count === 100 && li.progress && li.progress.distinct >= 3 && li.progress.rising, "sync: 100 games, 已取到 k 局 counting up (" + JSON.stringify(li.progress) + ")");
assert(li.frames && li.frames.frames > 0, "sync: the frames were timed meanwhile (" + JSON.stringify(li.frames) + ")");
const asked = fake.requests.filter((r) => r.path === "/api/games/user/slow_tester");
assert(asked.length === 3 && !asked[0].query.since && asked.slice(1).every((r) => r.query.since && r.query.sort === "dateAsc"), "sync: the second and third Lichess requests carry since= and sort=dateAsc (R6a)");
assert(sync.checks.chesscom && sync.checks.chesscom.count === 9, "sync: Chess.com's month without its four Chess960 games (R7)");
for (const k of ["error:lichess:offline_user", "error:lichess:missing_user", "error:chesscom:missing_user", "error:lichess:limited_user"]) {
  assert(sync.checks[k] && sync.checks[k].pass, "sync: " + k + " reads as " + (sync.checks[k] && sync.checks[k].key));
}

const pseed = await launch("prefetch-seed");
const pread = await launch("prefetch-read");
assert(pseed.checks.seeded.n === 409 && pread.checks.prefetch.n === pseed.checks.seeded.n,
  "prefetch: the next launch's chunk-boot.js prefetch answered with the whole library (" + pseed.checks.seeded.n + " → " + pread.checks.prefetch.n + ", " + pread.checks.prefetch.ms + " ms) (R18)");

const menus = await launch("menus", async (page, stage) => {
  const a = await stage("armed");
  if (!a || a.stage !== "armed") return;
  await page.evaluate(() => window.__fire("shortcut", { command: "game.new" }));
  const b = await stage("next");
  if (!b || b.stage !== "next") return;
  await page.evaluate(() => window.__fire("shortcut", JSON.stringify({ command: "view.repertoire" })));
});
assert(menus.checks["game.new"].pass && menus.checks["view.repertoire"].pass, "menus: game.new opens 新对局, view.repertoire shows 我的开局书");

const none = await launch("no-such", null, false);
assert(none && none.stage === "done" && none.ok === false && /no scenario/.test(none.err || ""), "an unknown scenario reports itself failed, not ok (" + (none && none.err) + ")");
await ctx.close();
await browser.close();
await fake.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("自检场景（页面一半）全部通过");
