/**
 * Browser check for the autosave: what the app remembers across a restart.
 *
 * This is the test that was missing. A position loaded from the editor or from
 * 载入 FEN is saved the instant it is loaded — before its first move — so the
 * saved PGN is tag pairs and nothing else. chess.js's load_pgn refuses that
 * shape, the launch path read the refusal as "no save at all", and then
 * overwrote the position with the standard array. Set up a study position,
 * close the app before playing into it, and it was gone without a message.
 *
 * The unit tests can prove ChessPgn.startFen recovers the FEN; only a real
 * page can prove the app comes back standing on it. Both halves are here: the
 * save is written through the actual UI, and the restart is a real reload
 * against the same localStorage.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when either is
 * missing, so it can sit in the suite without becoming a hard dependency —
 * except under E2E_REQUIRED=1, where a skip is a failure. The release gate
 * sets it, so "the browser tests passed" cannot mean "they never ran":
 *   node scripts/test-persist-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the 9MB engine is generated, not committed; nothing here needs it
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

/** A context that has never run the app, with the panel open on 对局. */
async function freshContext() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  return ctx;
}

async function open(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel").catch(() => {});
  return { page, errs };
}

/**
 * The position the app is actually standing on.
 *
 * The board is a canvas, so there is nothing to query — but 载入 FEN opens
 * pre-filled with the live position, which is the app telling us where it
 * thinks it is. Read it and close the dialog again.
 */
async function shownFen(page) {
  // 更多 is a toggle, so only press it when the row is actually closed
  if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) {
    await page.click("#more-tools");
  }
  await page.click("#fen-load-open");
  const v = await page.inputValue("#fen-input");
  await page.click("#fen-cancel");
  return v;
}

const STUDY = "8/8/4k3/8/8/8/4P3/4K3 w - - 0 1";
const PLACEMENT = STUDY.split(" ")[0];

// --- 1. the whole user path: load a FEN, close the app, open it again -------
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);

  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(500);

  const saved = await page.evaluate(() => localStorage.getItem("chess.v1.save"));
  const savedPgn = saved ? JSON.parse(saved).pgn : "";
  assert(/\[FEN "/.test(savedPgn), "loading a FEN writes an autosave that names the position");
  assert(!/\d+\.\s/.test(savedPgn), "…and it has no movetext yet, which is the whole difficulty");

  // restart: a new page against the same storage is exactly what a relaunch is
  await page.close();
  const second = await open(ctx);
  const back = await second.page.evaluate(() => localStorage.getItem("chess.v1.save"));
  const backPgn = back ? JSON.parse(back).pgn : "";
  assert(/\[FEN "/.test(backPgn),
    "the position is still in the autosave after a restart — got " + JSON.stringify(backPgn));
  assert(backPgn.includes(STUDY), "…and it is the same position, not the standard array");
  const live = await shownFen(second.page);
  assert(live.split(" ")[0] === PLACEMENT,
    "the board comes back standing on the studied position — shows " + live);
  assert(errs.length === 0 && second.errs.length === 0,
    "no JS exception on either run — " + errs.concat(second.errs).join(" / "));
  await ctx.close();
}

// --- 2. a position with moves played into it still restores, as it always did
{
  const ctx = await freshContext();
  const { page } = await open(ctx);
  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(400);

  const xy = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4"]) { const p = await xy(sq); await page.mouse.click(p.x, p.y); }
  await page.waitForTimeout(400);

  await page.close();
  const second = await open(ctx);
  const moves = await second.page.evaluate(() => {
    const raw = localStorage.getItem("chess.v1.save");
    return raw ? JSON.parse(raw).pgn : "";
  });
  assert(/e4/.test(moves), "a move played into a custom position survives the restart");
  assert(moves.includes(STUDY), "…and the position it started from survives with it");
  await ctx.close();
}

// --- 3. a set-up position round-trips through a save slot ------------------
// The slot writes a PGN and the loader reads one back through the ordinary
// import path, so the same movetext-free shape has to survive both ends. It
// used not to survive either: the slot refused to save a game with no moves,
// and the importer called the result malformed.
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(400);

  await page.click("#slots-open");
  await page.click("#slots-list button[data-save='0']");
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.slots") || "{}"));
  const slot0 = stored && stored.slots && stored.slots[0];
  assert(!!slot0, "a position with no moves yet can be parked in a slot");
  assert(slot0 && slot0.pgn.includes(STUDY), "…and the slot holds the position itself");
  await page.click("#slots-close");

  // wipe the board, then read the slot back
  await page.click("#btn-new");
  await page.click("#confirm-ok").catch(() => {});
  await page.waitForTimeout(300);
  await page.click("#slots-open");
  await page.click("#slots-list button[data-load='0']");
  await page.waitForTimeout(400);
  await page.click("#confirm-ok").catch(() => {});
  await page.waitForTimeout(500);
  const live = await shownFen(page);
  assert(live.split(" ")[0] === PLACEMENT,
    "loading the slot puts the position back on the board — shows " + live);
  assert(errs.length === 0, "no JS exception through the slot round trip — " + errs.join(" / "));
  await ctx.close();
}

// --- 4. the ordinary game is untouched by all of this ----------------------
{
  const ctx = await freshContext();
  const { page } = await open(ctx);
  const xy = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4", "e7", "e5"]) { const p = await xy(sq); await page.mouse.click(p.x, p.y); }
  await page.waitForTimeout(400);
  await page.close();
  const second = await open(ctx);
  const pgn = await second.page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.save") || "{}").pgn || "");
  assert(/1\. e4 e5/.test(pgn), "a game from the standard array still restores — got " + JSON.stringify(pgn));
  assert(!/\[FEN "/.test(pgn), "…without inventing a SetUp header for it");
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
