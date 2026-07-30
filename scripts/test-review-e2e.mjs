/**
 * Browser check for what the review shows: the eval bar.
 *
 * The bar is a pure rendering of `analysis.scalars[viewIndex]` — no engine
 * call, which is what keeps it review-only and stops it becoming an answer key
 * during a live game. That property is worth a real page: the unit tests can
 * prove ChessReview.evalBar maps numbers to fractions, only a browser can
 * prove the bar is hidden while a game is being played and follows the replay
 * cursor afterwards.
 *
 * The engine is replaced with a scripted one rather than the real Stockfish:
 * the 9MB wasm is generated, not committed, and this is testing the review's
 * plumbing, not the engine's judgement. Feeding known numbers is also the only
 * way to assert an exact bar width.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when
 * either is missing — except under E2E_REQUIRED=1, where a skip is a failure.
 *   node scripts/test-review-e2e.mjs
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
  // the 9MB engine is generated, not committed; this test scripts its own
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

const browser = await launchBrowser();
console.log("引擎:", ENGINE);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.v1.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
await page.click("#pick-cancel").catch(() => {});

const bar = () => page.evaluate(() => ({
  rowHidden: document.getElementById("eval-bar-row").hidden,
  width: document.getElementById("eval-bar-fill").style.width,
  text: document.getElementById("eval-bar-text").textContent,
  unmeasured: document.getElementById("eval-bar").classList.contains("is-unmeasured"),
}));

// --- while a game is being played there is no bar at all -------------------
assert((await bar()).rowHidden, "no analysis, no bar — nothing to read during a live game");

const click = async (sq) => {
  const c = await page.evaluate((s) => {
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  await page.mouse.click(c.x, c.y);
};
// scholar's mate: short, ends in mate, and every build plays it the same way
for (const sq of ["e2", "e4", "e7", "e5", "f1", "c4", "b8", "c6", "d1", "h5", "g8", "f6", "h5", "f7"]) {
  await click(sq);
}
await page.waitForTimeout(400);
assert((await bar()).rowHidden, "still no bar with the game just finished and nothing analysed");

// --- a scripted engine, so the bar's numbers are known ---------------------
await page.evaluate(() => {
  let i = 0;
  window.ChessEngine.isReady = () => true;
  window.ChessEngine.analyze = async (fen) => {
    const turn = fen.split(" ")[1];
    // level for the opening, then decisively White — the swing makes a tagged
    // move, which is what the best-move arrow keys off
    const cpWhite = i++ >= 5 ? 900 : 20;
    return { cp: turn === "w" ? cpWhite : -cpWhite, mate: null, turn, best: "d1h5", pv: ["d1h5"] };
  };
});
await page.click("#an-run");
await page.waitForTimeout(2500);

const end = await bar();
assert(!end.rowHidden, "the bar appears once the game has been analysed");
assert(!end.unmeasured, "a measured position is not drawn as unmeasured");
assert(parseFloat(end.width) > 50, "White winning fills the bar towards White (" + end.width + ")");
assert(/^\+/.test(end.text), "and the number says which way (" + end.text + ")");

// --- it follows the replay cursor, because that is the position on the board
await page.click("#rep-start");
await page.waitForTimeout(400);
const start = await bar();
assert(Math.abs(parseFloat(start.width) - 50) < 5,
  "back at the opening the bar is near level (" + start.width + ")");
assert(start.text !== end.text, "the bar reads the position the board is standing on, not the game's result");

assert(errs.length === 0, "no JS exception through analysis and replay — " + errs.join(" / "));

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
