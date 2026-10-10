/**
 * Per-move cost gate: a long game must not get slower to play or to replay
 * than a short one (v8-0-plan F2).
 *
 * Through 7.9 every commit replayed the whole game — the opening line, the
 * replay board, the repetition count — so the script time of one move grew
 * with the game: 13.5 ms over moves 1–20, 65 ms over moves 140–160, and an
 * arrow-key step through a finished game cost ~23 ms. The tree now carries
 * each node's position, repetition count and opening, and this is the check
 * that keeps it that way.
 *
 * What it does, in Chromium only (a CDP metric, and a cost curve is a
 * property of the code rather than of the engine running it):
 *   1. plays a fixed 160-ply game through the real input path — two clicks on
 *      the canvas per move, 两人对弈 mode, no engine;
 *   2. reads CDP `ScriptDuration` around each move, from the first click to
 *      two frames after the move is on the list;
 *   3. steps back through the game with ← and forward again with →, timing
 *      each key the same way.
 *
 * Gates, on medians over 20-ply windows so one GC pause or a scheduler hiccup
 * in a headless runner cannot decide the result on its own:
 *   - moves 141–160 cost at most 1.5× moves 1–20;
 *   - a replay step costs at most 5 ms;
 *   - the autosave is written at most once per move (it was twice).
 *
 * The game is generated here from a fixed seed rather than taken from a
 * file: it has to stay clear of every automatic ending (mate, stalemate,
 * insufficient material, fivefold, 75 moves) and of promotion, which asks a
 * question, for all 160 plies — a property checked below, not hoped for.
 *   node scripts/perf-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { Chess } from "../src/web/js/chess.js";
import { ChessFide } from "../src/web/js/fide.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
const PLIES = 160;
const WINDOW = 20;

if (ENGINE !== "chromium") {
  // not a skip: there is nothing missing, the measurement is Chromium's
  console.log("perf-e2e 只在 Chromium 上量(CDP 指标),E2E_BROWSER=" + ENGINE + " 不适用");
  process.exit(0);
}

/**
 * A legal 160-ply game that never ends or asks anything on the way. Quiet
 * moves are preferred so the material lasts; a position is never repeated,
 * so no claim appears either.
 */
function makeGame() {
  for (let seed = 1; seed < 500; seed++) {
    let s = seed;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
    const g = new Chess();
    const seen = new Set([ChessFide.positionKey(g.fen(), g)]);
    const out = [];
    while (out.length < PLIES) {
      const all = g.moves({ verbose: true }).filter((m) => !m.promotion);
      const quiet = all.filter((m) => !m.captured);
      const pool = quiet.length && rnd() < 0.9 ? quiet : all;
      const order = pool.map((m) => [rnd(), m]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
      let pick = null;
      for (const m of order) {
        g.move(m);
        const k = ChessFide.positionKey(g.fen(), g);
        const ok = !seen.has(k) && !g.game_over() && ChessFide.halfmoveClock(g.fen()) < 90;
        if (ok) { pick = m; seen.add(k); break; }
        g.undo();
      }
      if (!pick) break;
      out.push([pick.from, pick.to]);
    }
    if (out.length === PLIES) return out;
  }
  throw new Error("no clean 160-ply game in 500 seeds");
}

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the 9MB engine is generated, not committed; two players need none
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
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
const p90 = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]; };
const ms = (x) => x.toFixed(1) + " ms";

const line = makeGame();
const browser = await launchBrowser();
console.log("引擎:", ENGINE);

const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN", reducedMotion: "reduce" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
  localStorage.setItem("chess.panelOpen", "1");
  // count what the autosave costs, not only how long a move takes: the save
  // key itself, and every localStorage write (the save carries a stamp)
  window.__saves = { n: 0, bytes: 0, all: 0, allBytes: 0 };
  const set = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    window.__saves.all++; window.__saves.allBytes += String(v).length;
    if (k === "chess.save") { window.__saves.n++; window.__saves.bytes += String(v).length; }
    return set.call(this, k, v);
  };
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
// the opening table is a chunk; let it land so every move names its opening,
// which is the expensive path this gate is about
await page.waitForTimeout(800);

const cdp = await ctx.newCDPSession(page);
await cdp.send("Performance.enable");
const scriptMs = async () => {
  const { metrics } = await cdp.send("Performance.getMetrics");
  return metrics.find((m) => m.name === "ScriptDuration").value * 1000;
};
const settle = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));

const box = await page.evaluate(() => {
  const r = document.getElementById("board").getBoundingClientRect();
  return { x: r.left, y: r.top, w: r.width };
});
const xy = (sq) => {
  const f = sq.charCodeAt(0) - 97, rk = 8 - Number(sq[1]);
  const sz = box.w / 8;
  return { x: box.x + (f + 0.5) * sz, y: box.y + (rk + 0.5) * sz };
};
const plyCount = () => page.evaluate(() => document.querySelectorAll("#move-list .mlmove").length);

// --- 1. play ------------------------------------------------------------------
const resetSaves = () => page.evaluate(() => { window.__saves = { n: 0, bytes: 0, all: 0, allBytes: 0 }; });
await resetSaves();
const perMove = [];
for (let i = 0; i < line.length; i++) {
  const [a, b] = line[i];
  const t0 = await scriptMs();
  const p = xy(a); await page.mouse.click(p.x, p.y);
  const q = xy(b); await page.mouse.click(q.x, q.y);
  await page.waitForFunction((n) => document.querySelectorAll("#move-list .mlmove").length >= n, i + 1, { timeout: 5000 })
    .catch(() => {});
  await settle();
  perMove.push((await scriptMs()) - t0);
}
const plies = await plyCount();
assert(plies === PLIES, "the whole game went in through the board (" + plies + "/" + PLIES + " plies)");
const saves = await page.evaluate(() => window.__saves);

const early = perMove.slice(0, WINDOW), late = perMove.slice(PLIES - WINDOW);
const e = median(early), l = median(late);
console.log("每步脚本时间  第 1–20 手: 中位 " + ms(e) + " · p90 " + ms(p90(early)) +
  "  |  第 141–160 手: 中位 " + ms(l) + " · p90 " + ms(p90(late)));
for (let w = 0; w < PLIES; w += WINDOW) console.log("  " + (w + 1) + "–" + (w + WINDOW) + ": " + ms(median(perMove.slice(w, w + WINDOW))));
console.log("存档写入: " + saves.n + " 次 / " + (saves.bytes / 1e6).toFixed(2) + " MB(localStorage 共 " +
  saves.all + " 次 / " + (saves.allBytes / 1e6).toFixed(2) + " MB)");
assert(l <= e * 1.5, "move 160 costs ≤ 1.5× move 20 (" + ms(l) + " vs " + ms(e) + ", " + (l / e).toFixed(2) + "×)");
assert(saves.n <= PLIES, "the autosave is written at most once per move (" + saves.n + " for " + PLIES + ")");
// the page going away asks for a save — hide, then quit — and the game has
// not changed since the last move wrote it: nothing to write (v8-0-plan F2)
await resetSaves();
await page.evaluate(() => { window.dispatchEvent(new Event("pagehide")); window.dispatchEvent(new Event("beforeunload")); });
const idle = await page.evaluate(() => window.__saves.n);
assert(idle === 0, "an unchanged game is not written again (" + idle + " writes on pagehide + beforeunload)");

// --- 2. replay ----------------------------------------------------------------
// the board holds focus after the clicks, and its arrows move a square cursor;
// the replay arrows are the page's
await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
await resetSaves();
const steps = [];
const step = async (key) => {
  const t0 = await scriptMs();
  await page.keyboard.press(key);
  await settle();
  steps.push((await scriptMs()) - t0);
};
for (let i = 0; i < PLIES; i++) await step("ArrowLeft");
const atStart = await page.evaluate(() => !document.querySelector("#move-list .current"));
for (let i = 0; i < PLIES; i++) await step("ArrowRight");
const replaySaves = await page.evaluate(() => window.__saves.n);
const back = steps.slice(0, PLIES), fwd = steps.slice(PLIES);
console.log("回放每步脚本时间  ←: 中位 " + ms(median(back)) + " · p90 " + ms(p90(back)) +
  "  |  →: 中位 " + ms(median(fwd)) + " · p90 " + ms(p90(fwd)));
assert(atStart, "← walked the cursor back to the start");
assert(median(steps) <= 5, "a replay step costs ≤ 5 ms (median " + ms(median(steps)) + ")");
assert(replaySaves === 0, "stepping through the game writes no save (" + replaySaves + ")");

assert(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));

await browser.close();
server.close();
if (failed) { console.error("\n" + failed + " 项未通过"); process.exit(1); }
console.log("\nperf-e2e 全部通过");
