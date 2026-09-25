/**
 * The screenshot walk-through, as a script (7.7 §12.2).
 *
 * 7.7 was planned from 25 screenshots of 7.6.0 taken by hand: three window
 * sizes, four themes, two languages, and the states a player actually passes
 * through — the opening position, a selected piece, a piece in the hand, an
 * analysed game, the resign question, the end of a game, a lesson, a puzzle,
 * the record page. "精致" is only checkable if the same states can be taken
 * again after a change and put next to the old ones, so they are fixed here
 * rather than re-clicked from memory each time.
 *
 * This is not a test. Nothing is compared and nothing fails on a pixel: what
 * can be measured is asserted in the e2e suites (test-layout-e2e.mjs for the
 * geometry), and what cannot be measured is what these pictures are for — a
 * person looking at them, before and after.
 *
 * Same page as the browser checks: src/web served over http, the 9MB engine
 * replaced by a stub, settings seeded through localStorage the way the app
 * restores them, and E2E_BROWSER picking Chromium or WebKit. Where a state
 * needs the engine (the analysed game) it is scripted through window.__chess,
 * as test-review-e2e.mjs does, so the numbers in the picture repeat.
 *
 *   node scripts/shots.mjs                  → shots/<engine>/NN-name.png
 *   OUT=/tmp/before node scripts/shots.mjs  → somewhere else
 *   ONLY=toast node scripts/shots.mjs       → just the shots whose name matches
 * @module shots
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
const OUT = path.resolve(process.env.OUT || path.join(HERE, "..", "shots"), ENGINE);
const ONLY = process.env.ONLY ? new RegExp(process.env.ONLY) : null;

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the 9MB engine is generated, not committed; the states that need one script it
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const WIDE = { width: 1440, height: 900 };
const MID = { width: 1024, height: 700 };
const TALL = { width: 600, height: 900 };

/** The centre of a square on the page, board orientation included. */
async function sqXY(page, sq) {
  return page.evaluate((s) => {
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect();
    const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
    let f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    if (flip) { f = 7 - f; rk = 7 - rk; }
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
}
async function clickSq(page, sq) {
  const p = await sqXY(page, sq);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(120);
}
/** Moves as from/to pairs, played with the mouse. */
async function play(page, moves) {
  for (const m of moves) { await clickSq(page, m.slice(0, 2)); await clickSq(page, m.slice(2, 4)); }
  await page.waitForTimeout(300);
}
const ITALIAN = ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "f8c5", "c2c3", "g8f6", "d2d4", "e5d4"];
const SCHOLAR = ["e2e4", "e7e5", "f1c4", "b8c6", "d1h5", "g8f6", "h5f7"];

/**
 * A scripted engine: its replies are `replies` in order, and its evaluation is
 * level for a few plies, then decisively White (the swing is what tags a move,
 * so the analysed picture has something in it). Same seam as test-review-e2e.
 */
async function stubEngine(page, replies = []) {
  await page.evaluate((rs) => {
    let i = 0, k = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      const turn = fen.split(" ")[1];
      const cpWhite = i++ >= 5 ? 900 : 20;
      return { cp: turn === "w" ? cpWhite : -cpWhite, mate: null, turn, best: "d1h5", pv: ["d1h5"] };
    };
    window.__chess.engine.bestMove = async () => {
      const m = rs[Math.min(k++, rs.length - 1)] || "a7a6";
      return { from: m.slice(0, 2), to: m.slice(2, 4) };
    };
  }, replies);
}
/** White's side of scholar's mate against a scripted Black, ending in mate. */
async function scholarVsEngine(page) {
  await stubEngine(page, ["e7e5", "b8c6", "g8f6"]);
  for (const m of ["e2e4", "f1c4", "d1h5", "h5f7"]) {
    await clickSq(page, m.slice(0, 2)); await clickSq(page, m.slice(2, 4));
    await page.waitForTimeout(900); // the engine's minimum think, then its move
  }
}
/** A two-player scholar's mate, analysed by the scripted engine. */
async function analysed(page) {
  await play(page, SCHOLAR);
  await stubEngine(page);
  await page.click("#an-run");
}
/** Until a toast is up (a picture without the toast is the wrong picture). */
async function waitToast(page) {
  await page.waitForSelector("#toast.show", { timeout: 6000 }).catch(() => console.error("  ! 没等到 toast"));
  await page.waitForTimeout(350); // its fade-in
}

/**
 * The fixed set. `at` runs after the page has settled and before the picture;
 * each state starts from a fresh context, so no shot inherits another's game.
 */
const SHOTS = [
  // the three pages of the panel, the default look
  { name: "play-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "ai", tab: "play" },
  { name: "setup-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "ai", tab: "setup" },
  { name: "record-1440-wood-en", vp: WIDE, lang: "en", theme: "wood", mode: "ai", tab: "record" },
  { name: "play-1440-notebook-en", vp: WIDE, lang: "en", theme: "notebook", mode: "ai", tab: "play" },
  // reading modes: a wider panel, prose in it
  { name: "learn-1440-wood-en", vp: WIDE, lang: "en", theme: "wood", mode: "learn", tab: "play" },
  { name: "puzzle-1440-night-zh", vp: WIDE, lang: "zh-CN", theme: "night", mode: "puzzle", tab: "play" },
  // a game in progress
  { name: "midgame-select-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "pvp", tab: "play",
    at: async (page) => { await play(page, ITALIAN); await clickSq(page, "c3"); } },
  { name: "drag-1440-day-en", vp: WIDE, lang: "en", theme: "day", mode: "pvp", tab: "play",
    at: async (page) => {
      await play(page, ITALIAN.slice(0, 6));
      const a = await sqXY(page, "g8"), b = await sqXY(page, "f6");
      await page.mouse.move(a.x, a.y); await page.mouse.down();
      await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
      await page.mouse.move(b.x, b.y - 12, { steps: 4 });
      await page.waitForTimeout(120);
    },
    // the piece stays in the hand for the picture; let go afterwards
    after: async (page) => { await page.mouse.up(); } },
  // 1c: after a mouse move nothing is ringed; after an arrow key the cursor is
  { name: "cursor-mouse-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "pvp", tab: "play",
    at: async (page) => { await play(page, ["e2e4"]); } },
  { name: "cursor-key-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "pvp", tab: "play",
    at: async (page) => { await play(page, ["e2e4"]); await page.keyboard.press("ArrowUp"); await page.waitForTimeout(120); } },
  // the end of a game, and what the app says about it: the game-over toast
  // (rv.offer, engine games only), then an analysis and its toast
  { name: "gameover-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "ai", tab: "play",
    at: async (page) => { await scholarVsEngine(page); await waitToast(page); } },
  { name: "analysed-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "pvp", tab: "play",
    at: async (page) => { await analysed(page); await waitToast(page); } },
  // the panel scrolled 400px: what shows under the tab row (1e)
  { name: "scrolled-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "pvp", tab: "play",
    at: async (page) => {
      await analysed(page);
      await page.waitForTimeout(1500);
      await page.evaluate(() => { document.getElementById("pane-play").scrollTop = 400; });
      await page.waitForTimeout(300);
    } },
  { name: "resign-confirm-1440-wood-zh", vp: WIDE, lang: "zh-CN", theme: "wood", mode: "ai", tab: "play",
    at: async (page) => {
      await stubEngine(page, ["e7e5"]);
      await play(page, ["e2e4"]);
      await page.waitForTimeout(900);
      await page.click("#btn-resign");
      await page.waitForTimeout(400);
    } },
  // 1024×700: a short landscape window
  { name: "play-1024-night-en", vp: MID, lang: "en", theme: "night", mode: "ai", tab: "play" },
  { name: "record-1024-wood-zh", vp: MID, lang: "zh-CN", theme: "wood", mode: "ai", tab: "record" },
  { name: "gameover-1024-night-en", vp: MID, lang: "en", theme: "night", mode: "ai", tab: "play",
    at: async (page) => { await scholarVsEngine(page); await waitToast(page); } },
  // 600×900: portrait, the bottom sheet
  { name: "play-600-day-zh", vp: TALL, lang: "zh-CN", theme: "day", mode: "ai", tab: "play" },
  { name: "record-600-notebook-en", vp: TALL, lang: "en", theme: "notebook", mode: "ai", tab: "record" },
  { name: "gameover-600-wood-zh", vp: TALL, lang: "zh-CN", theme: "wood", mode: "ai", tab: "play",
    at: async (page) => { await scholarVsEngine(page); await waitToast(page); } },
  { name: "learn-600-wood-en", vp: TALL, lang: "en", theme: "wood", mode: "learn", tab: "play" },
  // the panel shut: the board alone
  { name: "closed-1440-wood-en", vp: WIDE, lang: "en", theme: "wood", mode: "ai", tab: "play", panel: "0" },
];

const browser = await launchBrowser();
fs.mkdirSync(OUT, { recursive: true });
console.log("引擎:", ENGINE, "→", OUT);

let n = 0, errors = 0;
for (const [i, s] of SHOTS.entries()) {
  if (ONLY && !ONLY.test(s.name)) continue;
  const ctx = await browser.newContext({ viewport: s.vp, locale: s.lang });
  await ctx.addInitScript(([l, m, tb, th, po]) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: m, langId: l, sideTab: tb, soundOn: false, themeId: th }));
    localStorage.setItem("chess.panelOpen", po);
  }, [s.lang, s.mode, s.tab, s.theme, s.panel || "1"]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  // Only this harness has no engine (the 9MB file is stubbed), and the banner
  // saying so would sit in every engine-mode picture. The real app boots one.
  await page.evaluate(() => { const f = document.getElementById("engine-fault"); if (f) f.hidden = true; });
  if (s.at) await s.at(page);
  const file = path.join(OUT, String(i + 1).padStart(2, "0") + "-" + s.name + ".png");
  await page.screenshot({ path: file });
  if (s.after) await s.after(page);
  if (errs.length) { errors++; console.error("  ! " + s.name + ": " + errs.join(" / ")); }
  console.log("  " + file);
  n++;
  await ctx.close();
}
await browser.close();
server.close();
console.log(n + " 张截图" + (errors ? "，其中 " + errors + " 张页面报了错" : ""));
process.exit(errors ? 1 : 0);
