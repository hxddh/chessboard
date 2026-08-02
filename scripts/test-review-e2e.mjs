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
  // window.__chess is the app's declared test seam (see app.js) — the modules
  // stopped being globals in 1.25, so the hook says so out loud now.
  window.__chess.engine.isReady = () => true;
  window.__chess.engine.analyze = async (fen) => {
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

// --- the report can be taken away ------------------------------------------
// A PGN hands somebody a move list; this hands them the conclusion. The button
// is only useful once there is an analysis, and it must say so rather than
// producing an empty picture.
{
  // browser path: no bridge, so it goes down the <a download> branch. Intercept
  // the click so nothing actually downloads, and check what it was handed.
  const shot = await page.evaluate(async () => {
    const out = { name: null, type: null, bytes: 0 };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {
      out.name = this.download;
      return undefined; // swallow the download
    };
    const realCreate = URL.createObjectURL;
    URL.createObjectURL = (blob) => { out.type = blob.type; out.bytes = blob.size; return "blob:stub"; };
    document.getElementById("report-export").click();
    await new Promise((r) => setTimeout(r, 700));
    HTMLAnchorElement.prototype.click = realClick;
    URL.createObjectURL = realCreate;
    return out;
  });
  assert(/\.png$/.test(shot.name || ""), "the report exports as a .png (" + shot.name + ")");
  assert(shot.type === "image/png", "…and it really is a PNG (" + shot.type + ")");
  // a blank 900x480 canvas still compresses small; a drawn one does not
  assert(shot.bytes > 3000, "…with a drawn report in it, not an empty canvas (" + shot.bytes + " bytes)");
}

// --- the report is a list of numbers, laid out as one -----------------------
// Each side's figures were one sentence carrying five values — 「精准度 100% ·
// 平均失分 0 · 小失误 0 / 失误 0 / 严重 0」 — which in a 239px panel wrapped to
// three lines in Chinese and five in English, breaking after the separators so
// that 「/」 and 「·」 ended the lines. Directly above it, the statistics
// section lays out the same kind of content (named quantities) as one row
// each, label left and value right. Now the report is made of those rows, and
// the exported picture draws the same three from the same helper — splitting
// them for the panel alone would have left the picture describing the same
// five numbers in different words, which is how every other pair in this app
// has drifted.
{
  const r = await page.evaluate(() => {
    const body = document.getElementById("review-body");
    const blocks = [...body.querySelectorAll(".review-row")].filter((e) => e.querySelector(".stat-row"));
    return blocks.map((b) => ({
      who: (b.querySelector(".review-k") || {}).textContent || "",
      rows: [...b.querySelectorAll(".stat-row")].map((r) => ({
        h: Math.round(r.getBoundingClientRect().height),
        k: (r.querySelector(".stat-k") || {}).textContent || "",
        v: (r.querySelector(".stat-v") || {}).textContent || "",
        fits: (() => {
          const kk = r.querySelector(".stat-k"), vv = r.querySelector(".stat-v");
          if (!kk || !vv) return false;
          return kk.getBoundingClientRect().right <= vv.getBoundingClientRect().left + 1;
        })(),
      })),
    }));
  });
  assert(r.length === 2, "the report has a block per side (" + r.length + ")");
  for (const b of r) {
    assert(b.rows.length === 3, b.who + ": three numbers, three rows (" + b.rows.length + ")");
    const hs = [...new Set(b.rows.map((x) => x.h))];
    assert(hs.length === 1, b.who + ": every row is the same height (" + hs.join(", ") + ")");
    for (const row of b.rows) {
      assert(row.fits, b.who + " 「" + row.k + "」: the label ends before the value starts");
      assert(row.h < 30, b.who + " 「" + row.k + "」: on one line (" + row.h + "px)");
      assert(row.v.trim() !== "", b.who + " 「" + row.k + "」: has a value");
    }
  }
}

// --- the move list, with annotations on it ---------------------------------
// The notation had no layout coverage at all: it is the one panel surface that
// carries per-move state (a 「?」 or 「??」 hung off a move, and the box around
// the move the board is standing on) and nothing measured what that does to
// the rows. Re-analysed here with an eval that really loses centipawns on a
// White move, because a flat curve produces no tags and a test that renders
// none is not testing the annotated case.
{
  await page.evaluate(() => {
    let i = 0;
    // White-relative evals; the engine reports from the side to move, so flip
    // for Black. 300 → -400 across ply 2 is a 700cp loss by White: 「??」.
    const W = [20, 20, 300, -400, -380, -390, -1200, -1210];
    window.__chess.engine.analyze = async (fen) => {
      const turn = fen.split(" ")[1];
      const w = W[Math.min(i++, W.length - 1)];
      return { cp: turn === "w" ? w : -w, mate: null, turn, best: "d1h5", pv: ["d1h5"] };
    };
  });
  await page.click("#an-run");
  await page.waitForTimeout(2500);
  // to the latest move: at ply 0 there is deliberately no current cell (the
  // list scrolls to the top instead), so "which move is boxed" is only a
  // question once the cursor is on one
  await page.click("#rep-end");
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const list = document.querySelector(".move-list");
    const lr = list.getBoundingClientRect();
    const rows = [...list.querySelectorAll(".mlrow")].filter((e) => e.offsetParent);
    const cells = [...list.querySelectorAll(".mlmove")];
    return {
      rows: rows.length,
      heights: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
      tags: [...list.querySelectorAll(".mvtag")].map((t) => t.textContent.trim()),
      current: list.querySelectorAll(".mlmove.current").length,
      clipped: cells.filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim()),
      past: cells.filter((c) => c.getBoundingClientRect().right > lr.right + 1).map((c) => c.textContent.trim()),
      unnamed: cells.filter((c) => !(c.getAttribute("aria-label") || "").trim()).length,
      names: cells.map((c) => c.getAttribute("aria-label")),
    };
  });
  assert(r.rows >= 3, "the notation has rows (" + r.rows + ")");
  assert(r.tags.length > 0, "a lost position is marked on the move that lost it (" + r.tags.join(" ") + ")");
  assert(r.heights.length === 1,
    "an annotated row is the same height as a plain one (" + r.heights.join(", ") + ")");
  assert(r.current === 1, "exactly one move is boxed at the latest position (" + r.current + ")");
  // …and it moves with the cursor rather than staying where it was
  const back = await page.evaluate(async () => {
    document.getElementById("rep-prev").click();
    await new Promise((r) => setTimeout(r, 300));
    const cur = document.querySelector(".move-list .mlmove.current");
    return { n: document.querySelectorAll(".move-list .mlmove.current").length,
             name: cur ? cur.getAttribute("aria-label") : null };
  });
  assert(back.n === 1 && back.name && back.name !== r.names[r.names.length - 1],
    "stepping back moves the box with it (now 「" + back.name + "」)");
  assert(r.clipped.length === 0,
    "no move is cut off inside its own cell" + (r.clipped.length ? " — " + r.clipped.join(", ") : ""));
  assert(r.past.length === 0,
    "no move reaches past the list" + (r.past.length ? " — " + r.past.join(", ") : ""));
  // the moves are drawn as figurines, so the piece is not in the text: the
  // accessible name is the only place the full SAN survives
  assert(r.unnamed === 0, "every move keeps its full SAN as its accessible name");
  assert(/^[KQRBN]/.test(r.names[2] || ""),
    "…including the piece letter the figurine replaces (" + r.names[2] + ")");
}

assert(errs.length === 0, "no JS exception through analysis and replay — " + errs.join(" / "));

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
