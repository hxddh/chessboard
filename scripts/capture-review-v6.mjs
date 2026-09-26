/**
 * Capture real screenshots of v6.0.0 for the review in docs/review-v6.md.
 * Not part of the test suite. Needs playwright-core and a Chromium binary.
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser } from "./e2e-browser.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
const OUT = path.join(HERE, "..", "docs", "review-v6");
fs.mkdirSync(OUT, { recursive: true });

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js") {
    res.writeHead(200, { "content-type": "text/javascript" });
    res.end("// stub");
    return;
  }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const URL = `http://127.0.0.1:${PORT}/`;

const browser = await launchBrowser();
console.log("capturing against", URL);

const SETTINGS = (extra = {}) => ({
  mode: "pvp",
  langId: "zh-CN",
  sideTab: "play",
  soundOn: false,
  themeId: "wood",
  ...extra,
});

async function open(opts = {}) {
  const {
    settings = SETTINGS(),
    panel = "1",
    viewport = { width: 1400, height: 900 },
    locale = "zh-CN",
    empty = false,
    clip = true,
  } = opts;
  const ctx = await browser.newContext({ viewport, locale });
  await ctx.addInitScript(([s, panelOpen, emptyStore, withClip]) => {
    if (!emptyStore) {
      localStorage.setItem("chess.v1.settings", JSON.stringify(s));
      localStorage.setItem("chess.panelOpen", panelOpen);
    }
    if (withClip) {
      window.__clip = "";
      window.zero = {
        invoke: () => Promise.resolve(true),
        on: () => () => {},
        off: () => {},
        platform: { supports: () => Promise.resolve(false) },
        clipboard: {
          readText: () => Promise.resolve(window.__clip),
          writeText: (t) => { window.__clip = String(t); return Promise.resolve(true); },
        },
      };
    }
  }, [settings, panel, empty, clip]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(URL);
  await page.waitForTimeout(1100);
  if (!empty) await page.click("#pick-cancel", { timeout: 400 }).catch(() => {});
  await page.waitForTimeout(200);
  return { ctx, page, errs };
}

async function shot(page, name) {
  const dest = path.join(OUT, name + ".png");
  await page.waitForTimeout(180);
  await page.screenshot({ path: dest, fullPage: false });
  console.log("  ", name);
  return dest;
}

function atFn() {
  return (s) => {
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
    const col = flip ? 7 - f : f, row = flip ? 7 - rk : rk;
    return { x: r.left + (col + 0.5) * (r.width / 8), y: r.top + (row + 0.5) * (r.height / 8) };
  };
}

async function clickSq(page, sq) {
  const p = await page.evaluate(atFn(), sq);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(90);
}

async function playLine(page, squares) {
  for (const sq of squares) await clickSq(page, sq);
}

async function moreOpen(page) {
  if (await page.evaluate(() => !!document.getElementById("more-row")?.hidden)) {
    await page.click("#more-tools");
    await page.waitForTimeout(200);
  }
}

async function pastePgn(page, text) {
  await page.evaluate((x) => { window.__clip = x; }, text);
  await moreOpen(page);
  await page.click("#pgn-paste");
  await page.waitForTimeout(700);
  if (await page.isVisible("#confirm-modal.show").catch(() => false)) {
    await page.click("#confirm-ok");
    await page.waitForTimeout(500);
  }
}

async function scriptEngine(page) {
  await page.evaluate(() => {
    let i = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen) => {
      const turn = fen.split(" ")[1];
      const cpWhite = i++ >= 5 ? 900 : 20;
      return { cp: turn === "w" ? cpWhite : -cpWhite, mate: null, turn, best: "d1h5", pv: ["d1h5", "g8f6"] };
    };
    window.__chess.engine.bestMove = async () => null;
  });
}

// --- 1. first-run onboarding ------------------------------------------------
{
  const { ctx, page } = await open({ empty: true });
  await page.waitForSelector("#pick-modal.show", { timeout: 4000 }).catch(() => {});
  await shot(page, "01-first-run");
  await ctx.close();
}

// --- 2. empty play tab, wood, desktop ---------------------------------------
{
  const { ctx, page } = await open();
  await shot(page, "02-play-empty-wood");
  await ctx.close();
}

// --- 3. settings: mode + interface (v6 knobs) -------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ sideTab: "setup", soundOn: true }) });
  await page.evaluate(() => { const f = document.getElementById("fold-game"); if (f) f.open = true; });
  await shot(page, "03-setup-game-fold");
  await page.locator("#sec-engine").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(page, "04-setup-engine-data");
  await page.locator("#sec-alldata").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(page, "04b-setup-data-danger");
  await ctx.close();
}

// --- 4. record empty --------------------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ sideTab: "record" }) });
  await shot(page, "05-record-empty");
  await ctx.close();
}

// --- 5. themes --------------------------------------------------------------
for (const [id, name] of [["night", "06-theme-night"], ["day", "07-theme-day"], ["notebook", "08-theme-notebook"]]) {
  const { ctx, page } = await open({ settings: SETTINGS({ themeId: id }) });
  await shot(page, name);
  await ctx.close();
}

// --- 6. English + Japanese --------------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ langId: "en" }), locale: "en-US" });
  await shot(page, "09-en-play");
  await ctx.close();
}
{
  const { ctx, page } = await open({ settings: SETTINGS({ langId: "ja" }), locale: "ja-JP" });
  await shot(page, "10-ja-play");
  await ctx.close();
}

// --- 7. puzzle mode ---------------------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ mode: "puzzle" }) });
  await page.waitForTimeout(400);
  await shot(page, "11-puzzle-mate1");
  await page.click('#puzzle-cat-seg button[data-cat="tac"]');
  await page.waitForTimeout(500);
  await shot(page, "12-puzzle-tactics");
  await page.evaluate(() => {
    const d = document.querySelector("#sec-puzzle details");
    if (d) d.open = true;
  });
  await page.locator("#puzzle-list").scrollIntoViewIfNeeded();
  await page.waitForTimeout(200);
  await shot(page, "13-puzzle-list");
  await ctx.close();
}

// --- 8. lesson 1 + TOC + classics ------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ mode: "learn" }) });
  await page.waitForTimeout(500);
  await shot(page, "14-lesson-1");
  await page.evaluate(() => {
    const d = document.querySelector("#sec-learn details");
    if (d) d.open = true;
  });
  await page.waitForTimeout(200);
  const classic = page.locator("#lesson-list button[data-c='0']");
  await classic.scrollIntoViewIfNeeded();
  await page.waitForTimeout(250);
  await shot(page, "15-lesson-toc-classics");
  await classic.click();
  await page.waitForTimeout(700);
  // replay bar is hidden in learn mode; arrows still work once study is on
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(180);
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(350);
  await shot(page, "16-classic-morphy");
  await ctx.close();
}

// --- 9. a real opening on the board ----------------------------------------
{
  const { ctx, page } = await open();
  await playLine(page, ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6", "f1", "c4", "g8", "f6"]);
  await page.waitForTimeout(300);
  await shot(page, "17-italian-opening");
  await ctx.close();
}

// --- 10. analysis tree: variation + comment + shapes -----------------------
{
  const { ctx, page } = await open();
  const PGN = '[Event "Tree"]\n[Site "?"]\n[Date "2026.09.18"]\n[Round "-"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n' +
    '1. e4 e5 2. Nf3 (2. Bc4 {先出象} Nf6 3. d3) 2... Nc6 {[%cal Gb1c3,Gf1c4][%csl Gd4,Ge4] 意大利式出子} *\n';
  await pastePgn(page, PGN);
  await page.waitForTimeout(400);
  await shot(page, "18-tree-mainline");
  await page.click('#move-list .mlv[aria-label="Bc4"]');
  await page.waitForTimeout(350);
  await shot(page, "19-tree-variation");
  await page.click('#move-list .mlv[aria-label="Bc4"]', { button: "right" });
  await page.waitForTimeout(200);
  await shot(page, "20-move-menu");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  await ctx.close();
}

// --- 11. analysed game: eval curve + bar + report --------------------------
{
  const { ctx, page } = await open();
  await playLine(page, ["e2", "e4", "e7", "e5", "f1", "c4", "b8", "c6", "d1", "h5", "g8", "f6", "h5", "f7"]);
  await page.waitForTimeout(400);
  await scriptEngine(page);
  await page.click("#an-run");
  await page.waitForTimeout(2800);
  await shot(page, "21-review-mate");
  await page.click("#rep-start");
  await page.waitForTimeout(350);
  await shot(page, "22-review-start");
  await ctx.close();
}

// --- 12. about + keys + editor + slots -------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ sideTab: "setup" }) });
  await page.evaluate(() => {
    const pane = document.getElementById("pane-setup");
    if (pane) pane.scrollTop = pane.scrollHeight;
  });
  await page.click("#about-open");
  await page.waitForTimeout(400);
  await shot(page, "23-about");
  await page.click("#about-close");
  await page.waitForTimeout(200);
  await page.keyboard.press("?");
  await page.waitForTimeout(400);
  await shot(page, "24-keys");
  await page.click("#keys-close");
  await page.waitForTimeout(200);
  await page.click("#tab-play");
  await page.waitForTimeout(200);
  await page.click("#editor-open");
  await page.waitForTimeout(400);
  await shot(page, "25-editor");
  await page.click("#editor-cancel");
  await page.waitForTimeout(200);
  await page.click("#slots-open");
  await page.waitForTimeout(400);
  await shot(page, "26-slots");
  await page.click("#slots-close");
  await ctx.close();
}

// --- 13. blindfold + no coords ---------------------------------------------
{
  const { ctx, page } = await open({
    settings: SETTINGS({ sideTab: "play" }),
  });
  await playLine(page, ["e2", "e4", "e7", "e5", "g1", "f3"]);
  await page.click("#tab-setup");
  await page.waitForTimeout(200);
  await page.click("#opt-blind");
  await page.waitForTimeout(150);
  await page.click("#opt-coords");
  await page.waitForTimeout(150);
  await page.click("#tab-play");
  await page.waitForTimeout(300);
  await shot(page, "27-blindfold");
  await ctx.close();
}

// --- 14. pvp with clock -----------------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ mode: "pvp" }) });
  await page.click("#tab-setup");
  await page.waitForTimeout(200);
  await page.evaluate(() => { const f = document.getElementById("fold-game"); if (f) f.open = true; });
  await page.click('#clock-seg button[data-tc="5"]');
  await page.waitForTimeout(250);
  await page.click("#tab-play");
  await page.waitForTimeout(200);
  await playLine(page, ["e2", "e4"]);
  await page.waitForTimeout(300);
  await shot(page, "28-clock-pvp");
  await ctx.close();
}

// --- 15. narrow overlay + portrait drawer ----------------------------------
{
  const { ctx, page } = await open({ viewport: { width: 820, height: 700 } });
  await shot(page, "29-narrow-overlay");
  await ctx.close();
}
{
  const { ctx, page } = await open({ viewport: { width: 900, height: 1200 } });
  await shot(page, "30-portrait-drawer");
  await ctx.close();
}

// --- 16. large text + night, settings --------------------------------------
{
  const { ctx, page } = await open({
    settings: SETTINGS({ themeId: "night", sideTab: "setup", textSize: "l" }),
    viewport: { width: 1400, height: 900 },
  });
  await shot(page, "31-night-large-text");
  await ctx.close();
}

// --- 17. shapes PGN from the fixture ---------------------------------------
{
  const { ctx, page } = await open();
  const pgn = fs.readFileSync(path.join(HERE, "fixtures/pgn/shapes-cal-csl.pgn"), "utf8");
  await pastePgn(page, pgn);
  await page.waitForTimeout(400);
  await shot(page, "32-shapes-pgn");
  await ctx.close();
}

// --- 18. daily plan on empty play ------------------------------------------
{
  const { ctx, page } = await open({ settings: SETTINGS({ mode: "ai" }) });
  await shot(page, "33-daily-idle");
  await ctx.close();
}

await browser.close();
server.close();
console.log("wrote", fs.readdirSync(OUT).filter((f) => f.endsWith(".png")).length, "pngs to", OUT);
