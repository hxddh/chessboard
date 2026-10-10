/**
 * Browser check for what the review shows: the eval gauge, the report card,
 * the curve and the marks on the board.
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
import { heldClick } from "./lib/held-click.mjs";
import { seedLibrary } from "./lib/library-view.mjs";
import { settle } from "./lib/settle.mjs";
import { OPERA, playOpera, analyseOpera, scriptOpera } from "./lib/opera-fixture.mjs";
import { Chess } from "../src/web/js/chess.js";
import { ChessReview } from "../src/web/js/review.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const served = []; // v8-2-plan T3: which chunks a page asked for
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  served.push(p);
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

/**
 * 9.0 S2: 持续分析 is a switch in 设置 · 高级 (#opt-live), not a button over
 * the review. Turn it on or off there, through the rail, and come back to the
 * board — the way a person would.
 */
async function setLive(pg, on) {
  await pg.click('#rail button[data-view="settings"]');
  await settle(pg);
  await pg.click("#cat-advanced");
  await settle(pg);
  const now = await pg.getAttribute("#opt-live", "aria-pressed");
  if ((now === "true") !== on) await pg.click("#opt-live");
  await settle(pg);
  await pg.click('#rail button[data-view="play"]');
  await settle(pg);
}
/**
 * 9.0 S3: the classics are guessed from 训练 · 名局 with its switch on 猜着
 * (the forty are one list, read or guessed); the list is the catalog's fold.
 */
async function toGuessList(pg) {
  // clicked in the page, as this suite clicks the catalog: a pointer click
  // would turn the board's keyboard cursor off (7.7 §1c, :focus-visible), and
  // the keyboard checks below focus the board the way a key would leave it
  for (const sel of ['#train-seg button[data-seg="classic"]', '#classic-mode button[data-cmode="guess"]']) {
    const on = await pg.evaluate((q) => {
      const b = document.querySelector(q);
      if (b.getAttribute("aria-pressed") === "true") return true;
      b.click();
      return false;
    }, sel);
    if (!on) await settle(pg);
  }
  await pg.evaluate(() => { document.getElementById("lesson-fold").open = true; });
}
/** 9.0 S2: 精析 is in 分析's ⋯ menu (details#an-more). */
async function clickDeep(pg) {
  if (!(await pg.$eval("#an-more", (d) => d.open))) await pg.click("#an-more > summary");
  await pg.click("#an-deep");
}
const assert = (cond, msg) => {
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

// v7-7-plan §5: the bar is a vertical gauge down the board's left edge now;
// White's share is its height, filled from White's side of the board
const bar = () => page.evaluate(() => ({
  rowHidden: document.getElementById("eval-bar-row").hidden,
  width: document.getElementById("eval-bar-fill").style.height,
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
await settle(page);
assert((await bar()).rowHidden, "still no bar with the game just finished and nothing analysed");

// --- a scripted engine, so the bar's numbers are known ---------------------
await page.evaluate(() => {
  let i = 0;
  // window.__chess is the app's declared test seam (see app.js) — the modules
  // stopped being globals in 1.25, so the hook says so out loud now.
  window.__chess.engine.isReady = () => true;
  // keyed by position (v8-0-plan B2: the pass asks some positions twice)
  const seen = new Map();
  window.__chess.engine.analyze = async (fen) => {
    const turn = fen.split(" ")[1];
    if (!seen.has(fen)) seen.set(fen, i++);
    // level for the opening, then decisively White — the swing makes a tagged
    // move, which is what the best-move arrow keys off
    const cpWhite = seen.get(fen) >= 5 ? 900 : 20;
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
await settle(page);
const start = await bar();
assert(Math.abs(parseFloat(start.width) - 50) < 5,
  "back at the opening the bar is near level (" + start.width + ")");
assert(start.text !== end.text, "the bar reads the position the board is standing on, not the game's result");

// --- v7-7-plan §5: the gauge stands beside the board, as tall as it --------
// …and turns with it: White's end is the end White sits at. The fill is read
// as the rectangle the page actually draws, not as a class name.
{
  await page.click("#rep-end");
  await settle(page);
  const geo = () => page.evaluate(() => {
    const r = (el) => el.getBoundingClientRect();
    const board = r(document.getElementById("board"));
    const g = r(document.getElementById("eval-bar"));
    const f = r(document.getElementById("eval-bar-fill"));
    const wrap = r(document.getElementById("board-wrap"));
    return { bt: board.top, bh: board.height, gt: g.top, gh: g.height, gl: g.left, gr: g.right,
      wl: wrap.left, ft: f.top, fb: f.bottom, fh: f.height };
  });
  const a = await geo();
  assert(Math.abs(a.gh - a.bh) <= 1 && Math.abs(a.gt - a.bt) <= 1,
    "the gauge is exactly as tall as the board and level with it (" + a.gh + " vs " + a.bh + ")");
  assert(a.gr <= a.wl, "…standing to the left of the frame, not on the squares (" + a.gr + " ≤ " + a.wl + ")");
  assert(Math.abs(a.fb - (a.gt + a.gh)) <= 1 && a.fh > a.gh / 2,
    "White ahead: the white fill rises from the bottom, White's side (" + Math.round(a.fh) + " of " + Math.round(a.gh) + ")");
  await page.evaluate(() => document.querySelector('[data-orient="b"]').click());
  await settle(page);
  const b = await geo();
  assert(Math.abs(b.ft - b.gt) <= 1 && Math.abs(b.fh - a.fh) <= 1,
    "flipped: the same fill now hangs from the top, where White sits (" + Math.round(b.ft - b.gt) + "px from the top)");
  await page.evaluate(() => document.querySelector('[data-orient="w"]').click());
  // back where the blocks below expect to start: the opening
  await page.evaluate(() => document.getElementById("rep-start").click());
  await settle(page);
}

// --- v7-7-plan §5: the curve is there for every analysed game ---------------
// 5.1 hid it below 30 judged moves, so an ordinary short game — this one is
// seven — was analysed and showed no curve at all.
{
  const c = await page.evaluate(() => {
    const el = document.getElementById("eval-curve");
    return { hidden: el.hidden, w: el.clientWidth, h: el.clientHeight };
  });
  assert(!c.hidden && c.w > 100 && c.h > 30,
    "a seven-move game, analysed, has its curve on screen (" + c.w + "×" + c.h + ")");
}

// --- v7-7-plan §5: accuracy is said once ------------------------------------
// It was a line above the report (「精准度 · 白 99% · 黑 98%」) and a row in
// each side's block inside it. Now the two figures are the card's headline and
// appear nowhere else in the panel.
{
  const r = await page.evaluate(() => {
    const pane = document.getElementById("pane-play");
    const vis = (e) => !!(e.offsetParent || e.getClientRects().length);
    const hits = [...pane.querySelectorAll("*")].filter((e) => vis(e) &&
      [...e.childNodes].some((n) => n.nodeType === 3 && /精准度/.test(n.textContent)));
    const nums = [...document.querySelectorAll("#acc-line .acc-num")].map((e) => e.textContent);
    return { labels: hits.length, nums };
  });
  assert(r.labels === 1, "「精准度」 appears once in the panel (" + r.labels + ")");
  assert(r.nums.length === 2 && r.nums.every((n) => /^\d+%$/.test(n)),
    "…over two figures, White's and Black's (" + r.nums.join(" / ") + ")");
}

// --- the report can be taken away ------------------------------------------
// A PGN hands somebody a move list; this hands them the conclusion. The button
// is only useful once there is an analysis, and it must say so rather than
// producing an empty picture.
{
  // browser path: no bridge, so it goes down the <a download> branch. Intercept
  // the click so nothing actually downloads, and check what it was handed.
  // 9.0 S2: 导出复盘图 is in the tool row's 更多 (#more-row)
  assert(await page.evaluate(() => !!document.querySelector("#more-row #report-export")),
    "导出复盘图 sits in the tool row's 更多 row");
  if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) {
    await page.click("#more-tools"); await settle(page);
  }
  assert(await page.isVisible("#report-export"), "…and 更多 shows it");
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

// --- the report card: a headline, a table, a footnote ------------------------
// v7-7-plan §5. Each side's figures were first one sentence carrying five
// values, then (5.x–7.6) three label/value rows per side under a line that
// already said both accuracies. Now: the two accuracies as the card's
// headline, then one small table — a row per mark, a column per side, the
// counts in the marks' own colours — and the caveats as a footnote. Only the
// marks the analysis has (v8-0-plan B2 adds the grades, checked below). The
// exported picture still draws sideRows(), the same numbers.
{
  const r = await page.evaluate(() => {
    const t = document.querySelector("#review-body .rv-table");
    if (!t) return null;
    const rows = [...t.querySelectorAll("tbody tr")].map((tr) => ({
      k: tr.querySelector("th").textContent,
      v: [...tr.querySelectorAll("td")].map((td) => td.textContent),
      cls: tr.className,
      h: Math.round(tr.getBoundingClientRect().height),
      colour: getComputedStyle(tr.querySelector(".rv-mark") || tr.querySelector("th")).color,
    }));
    const head = [...t.querySelectorAll("thead th")].map((th) => th.textContent);
    const notes = [...document.querySelectorAll("#review-body .review-note")].map((n) => n.textContent);
    const css = getComputedStyle(document.documentElement);
    const rgb = (v) => { const d = document.createElement("span"); d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color; d.remove(); return c; };
    return { rows, head, notes, mid: rgb(css.getPropertyValue("--judge-mid")), bad: rgb(css.getPropertyValue("--judge-bad")) };
  });
  assert(!!r, "the report has its table");
  if (r) {
    assert(r.head.length === 3 && r.head[1] && r.head[2], "one column per side (" + r.head.join(" | ") + ")");
    const marks = r.rows.filter((x) => /rv-kind/.test(x.cls));
    // 存疑标注 is off by default: 「?」 and 「??」, not 「?!」
    assert(marks.length === 2 && /^\?\D/.test(marks[0].k) && /^\?\?/.test(marks[1].k),
      "存疑标注关着,表里只有 ? 与 ?? 两行 (" + marks.map((x) => x.k).join(" / ") + ")");
    assert(marks[0] && marks[0].colour === r.mid && marks[1] && marks[1].colour === r.bad,
      "…each mark in its own colour from the theme (" + marks.map((x) => x.colour).join(" / ") + ")");
    assert(r.rows.every((x) => x.v.length === 2 && x.v.every((v) => v.trim() !== "")),
      "every row has a value for both sides");
    const hs = [...new Set(r.rows.map((x) => x.h))];
    assert(hs.every((h) => h < 30), "every row is one line (" + hs.join(", ") + "px)");
    // v8-0-plan B2: the model now has the finer grades. 妙着 / 仅此一着 / 错失良机
    // get a row only when one happened (this stub engine gives one line, so
    // none can). A4: 最佳 · 优秀 · 良好 · 谱着 are rows of the same table, above
    // the marks, not a footnote line a side
    assert(!r.rows.some((x) => /妙|仅此|错失/.test(x.k)), "no praise row for a grade that did not happen");
    const fine = r.rows.filter((x) => /rv-grade/.test(x.cls) && /最佳|优秀|良好|谱着/.test(x.k));
    assert(fine.length >= 1 && !r.notes.some((n) => /最佳 \d+/.test(n)),
      "最佳 · 优秀 · 良好 · 谱着 are rows in the table, one column per side (" + fine.map((x) => x.k + " " + x.v.join("/")).join(" | ") + ")");
    // a seven-move game: the sample caveat is one line, said once
    const short = r.notes.filter((n) => /只分析了/.test(n));
    assert(short.length === 1, "「只分析了 N 着」 is one footnote, not one per side (" + short.length + ")");
  }
  // switch 存疑标注 on: the ?! row joins, in place
  const on = await page.evaluate(() => {
    document.getElementById("opt-softmark").click();
    const rows = [...document.querySelectorAll("#review-body .rv-table tbody tr.rv-kind")].map((tr) => tr.querySelector("th").textContent);
    document.getElementById("opt-softmark").click();
    return rows;
  });
  assert(on.length === 3 && /^\?!/.test(on[0]), "存疑标注打开后,表里多出 ?! 一行 (" + on.join(" / ") + ")");
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
    // v8-0-plan B2: keyed by position, not by call — the pass searches the
    // positions around a mark a second time, deeper, and must get the same story
    const seen = new Map();
    window.__chess.engine.analyze = async (fen) => {
      const turn = fen.split(" ")[1];
      if (!seen.has(fen)) seen.set(fen, i++);
      const w = W[Math.min(seen.get(fen), W.length - 1)];
      return { cp: turn === "w" ? w : -w, mate: null, turn, best: "d1h5", pv: ["d1h5"] };
    };
  });
  await page.click("#an-run");
  await page.waitForTimeout(2500);
  // to the latest move: at ply 0 there is deliberately no current cell (the
  // list scrolls to the top instead), so "which move is boxed" is only a
  // question once the cursor is on one
  await page.click("#rep-end");
  await settle(page);
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

// --- v7-7-plan §5: the mark on the board ------------------------------------
// The move that lost the game carries its 「??」 on the board too: a badge in
// the top-right corner of the square it landed on, in the theme's --judge-bad.
// Read off the canvas's own pixels — the badge is paint, not DOM. Here the
// 「??」 is White's 2.Bc4 (300 → −400), so at ply 3 the badge sits on c4; at
// ply 2 (1…e5, unmarked) nothing is drawn there.
{
  const at = async (n) => {
    // pressed through the DOM: at either end of the game the button that
    // leads nowhere is not shown, and this walks from one end on purpose
    await page.evaluate((k) => {
      document.getElementById("rep-start").click();
      for (let i = 0; i < k; i++) document.getElementById("rep-next").click();
    }, n);
    await settle(page);
    return page.evaluate(() => {
      const cv = document.getElementById("board");
      const step = cv.width / 8;
      // c4, White at the bottom: column 2, row 4 from the top
      // the badge's centre is 0.22 of a square in from the corner and its
      // radius 0.16 (10.1 B2; 0.19 until then) — sampled inside its fill,
      // left of the glyph
      const r = step * 0.16;
      const cx = 3 * step - step * 0.22, cy = 4 * step + step * 0.22;
      const d = cv.getContext("2d").getImageData(Math.round(cx - r * 0.78), Math.round(cy), 1, 1).data;
      const s = document.createElement("span");
      s.style.color = getComputedStyle(document.documentElement).getPropertyValue("--judge-bad");
      document.body.appendChild(s);
      const want = getComputedStyle(s).color.match(/\d+/g).map(Number);
      s.remove();
      return { got: [d[0], d[1], d[2]], want };
    });
  };
  const near = (p) => p.got.every((v, i) => Math.abs(v - p.want[i]) <= 12);
  const on = await at(3);
  assert(near(on), "the 「??」 move has its badge on its square, in --judge-bad (" + on.got + " vs " + on.want + ")");
  const off = await at(2);
  assert(!near(off), "…and an unmarked move has none (" + off.got + ")");
}

// --- 7.6: a turning point already in the mistakes book says so -------------
// The button offered 「把这一手收进错题」 again after the drill was banked (by
// the auto-miner or by this very button); pressing it only toasted 「已经在错
// 题里」. Now the button itself reads that way and cannot be pressed.
{
  const before = await page.evaluate(() => {
    const b = document.querySelector("#review-body .review-bank");
    return b ? { text: b.textContent, disabled: b.disabled } : null;
  });
  assert(before && !before.disabled && /收进错题/.test(before.text),
    "转折点还没收进错题时,按钮可按 (" + JSON.stringify(before) + ")");
  // 9.0 M2: the report card is in 完整报告, folded until opened
  if (!(await page.evaluate(() => document.getElementById("rv-full").open))) await page.click("#rv-full > summary");
  await page.click("#review-body .review-bank");
  await settle(page);
  const after = await page.evaluate(() => {
    const b = document.querySelector("#review-body .review-bank");
    const mines = JSON.parse(localStorage.getItem("chess.mines") || "null");
    const missed = (JSON.parse(localStorage.getItem("chess.puzzles") || "null") || {}).missed || {};
    return { text: b && b.textContent, disabled: b && b.disabled, n: mines ? mines.list.length : 0,
      owed: !!mines && mines.list.every((m) => missed[m.id] && missed[m.id].due <= Date.now()) };
  });
  assert(after.n === 1, "按一下,错题里多了这一道 (" + after.n + ")");
  assert(after.owed, "T2：收进的这一道也排进了复习，今天就到期");
  assert(after.disabled && /已经在错题里/.test(after.text || ""),
    "收进以后,按钮就写「已经在错题里」且按不动 (" + JSON.stringify(after) + ")");
}

assert(errs.length === 0, "no JS exception through analysis and replay — " + errs.join(" / "));

// --- 6.0: the analysis board — the game as a tree (v6-plan Q2.1–Q2.4) ------
// A PGN with a variation, a comment and a [%cal] arrow goes in through the
// clipboard (the fake native bridge, for the reasons test-persist-e2e §7
// gives), and the notation has to show all three: the variation indented
// under the move it replaces, the comment as text, the arrow on the board
// and back out again in the export. Then the tree is *edited* the way a
// player would: click into the variation, promote it, play a move at a
// replay position, draw an arrow — and the export carries every one.
{
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__clip = "";
    window.zero = {
      invoke: () => Promise.resolve(true), on: () => () => {}, off: () => {},
      platform: { supports: () => Promise.resolve(false) },
      clipboard: {
        readText: () => Promise.resolve(window.__clip),
        writeText: (t) => { window.__clip = String(t); return Promise.resolve(true); },
      },
    };
  });
  const pg = await ctx2.newPage();
  const errs2 = [];
  pg.on("pageerror", (e) => errs2.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

  const moreOpen = async () => {
    if (await pg.evaluate(() => !!document.getElementById("more-row").hidden)) { await pg.click("#more-tools"); await settle(pg); }
  };
  const answerIfAsked = async () => {
    if (await pg.isVisible("#confirm-modal.show").catch(() => false)) { await pg.click("#confirm-ok"); await pg.waitForTimeout(600); }
  };
  const paste = async (text) => {
    await pg.evaluate((x) => { window.__clip = x; }, text);
    await moreOpen();
    await pg.click("#pgn-paste");
    await pg.waitForTimeout(700);
    await answerIfAsked();
  };
  /** the position the app says it is on — the FEN dialog opens pre-filled with it */
  const shownFen = async () => {
    await moreOpen();
    await pg.click("#fen-load-open");
    const v = await pg.inputValue("#fen-input");
    await pg.click("#fen-cancel");
    await settle(pg);
    return v;
  };
  const at = (sq) => pg.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const notation = () => pg.evaluate(() => ({
    main: [...document.querySelectorAll("#move-list .mlmove:not(.mlgap)")].map((b) => b.getAttribute("aria-label")),
    vars: [...document.querySelectorAll("#move-list .mlv")].map((b) => b.getAttribute("aria-label")),
    varComments: [...document.querySelectorAll("#move-list .mlvcomment")].map((c) => c.textContent),
    comments: [...document.querySelectorAll("#move-list .mlcomment")].map((c) => c.textContent),
    // v8-0-plan A4: the row also holds 从这里续下 now; this asks about 回主线
    lineRow: !document.getElementById("line-row").hidden && !document.getElementById("back-main").hidden,
  }));
  const fenAfter = (...sans) => { const g = new Chess(); for (const m of sans) g.move(m); return g.fen(); };

  const PGN = '[Event "Tree"]\n[Site "?"]\n[Date "2026.09.18"]\n[Round "-"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n' +
    '1. e4 e5 2. Nf3 (2. Bc4 {the bishop first} Nf6 3. d3) 2... Nc6 {[%cal Gb1c3] a comment} *\n';
  await paste(PGN);
  let n = await notation();
  assert(n.main.join(" ") === "e4 e5 Nf3 Nc6", "the mainline is the mainline (" + n.main.join(" ") + ")");
  assert(n.vars.join(" ") === "Bc4 Nf6 d3", "the variation is shown under the move it replaces (" + n.vars.join(" ") + ")");
  assert(n.varComments.some((c) => /the bishop first/.test(c)), "…with its comment as text beside the move");
  assert(n.comments.some((c) => /a comment/.test(c)) && !n.comments.some((c) => /%cal/.test(c)),
    "the mainline comment is shown, and the [%cal] command is not part of the prose (" + n.comments.join(" | ") + ")");
  assert(!n.lineRow, "on the mainline there is no 「回主线」");

  // click into the variation: the board goes there, and the line is now a variation
  await pg.click('#move-list .mlv[aria-label="Bc4"]');
  await settle(pg);
  assert((await shownFen()) === fenAfter("e4", "e5", "Bc4"), "clicking a variation move puts the board on that position");
  n = await notation();
  assert(n.lineRow, "…and 「回主线」 appears, because the line is a variation");
  assert(n.vars.filter((v) => v === "Bc4").length === 1 &&
    (await pg.evaluate(() => (document.querySelector("#move-list .mlv.current") || {}).getAttribute("aria-label"))) === "Bc4",
    "the current move is boxed inside the variation");

  // promote it through the menu: the right button on the move
  await pg.click('#move-list .mlv[aria-label="Bc4"]', { button: "right" });
  await settle(pg);
  assert(await pg.isVisible("#move-menu"), "the right button opens the move menu");
  await pg.click("#mm-promote");
  await settle(pg);
  n = await notation();
  assert(n.main.join(" ") === "e4 e5 Bc4 Nf6 d3", "promoted: the variation is the mainline now (" + n.main.join(" ") + ")");
  assert(n.vars.join(" ") === "Nf3 Nc6", "…and the old mainline is the variation (" + n.vars.join(" ") + ")");
  assert(!n.lineRow, "…so the line is the mainline again and 「回主线」 goes");

  // a move at a replay position in a two-player game opens a variation
  await pg.click('#move-list .mlmove[data-i="1"]');
  await settle(pg);
  for (const sq of ["c7", "c5"]) { const p = await at(sq); await pg.mouse.click(p.x, p.y); await settle(pg); }
  await settle(pg);
  n = await notation();
  assert(n.vars.includes("c5"), "a move played while replaying became a variation (" + n.vars.join(" ") + ")");
  assert(n.main.join(" ") === "e4 e5 Bc4 Nf6 d3", "…and the mainline was not truncated");
  assert((await shownFen()) === fenAfter("e4", "c5"), "…and the board followed it");
  assert(n.lineRow, "…on a variation, so 「回主线」 is back");

  // an arrow on this position: right-button drag
  const g1 = await at("g1"), f3 = await at("f3");
  await pg.mouse.move(g1.x, g1.y);
  await pg.mouse.down({ button: "right" });
  await pg.mouse.move(f3.x, f3.y, { steps: 4 });
  await pg.mouse.up({ button: "right" });
  await settle(pg);

  // export: everything above is in the file, and the result token once
  await pg.click("#pgn-copy");
  await settle(pg);
  const out = await pg.evaluate(() => window.__clip);
  const body = out.split("\n\n").pop() || "";
  assert(/\(/.test(body), "the export carries a variation");
  assert(/\{/.test(body), "…a comment");
  assert(/\[%cal Gb1c3\]/.test(body), "…the imported arrow");
  assert(/\[%cal Gg1f3\]/.test(body), "…and the one just drawn (" + (body.match(/\[%cal[^\]]*\]/g) || []).join(" ") + ")");
  const tokens = body.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/g) || [];
  assert(tokens.length === 1, "the result token appears exactly once (" + JSON.stringify(tokens) + ")");
  // the variation played at move 1 hangs after 1... e5, before 2. Bc4
  assert(/^1\. e4 e5 \( 1\.\.\. c5/.test(body) && /2\. Bc4 \{/.test(body) && /Nf6 3\. d3/.test(body),
    "…and the movetext is the promoted mainline with the new variation after the move it replaces (" + body.split("\n")[0] + ")");

  // …and it comes back in whole: the round trip through the app itself
  await paste(out);
  const again = await notation();
  assert(again.main.join(" ") === "e4 e5 Bc4 Nf6 d3" && again.vars.join(" ") === n.vars.join(" "),
    "re-importing the export gives the same tree (" + again.main.join(" ") + " / " + again.vars.join(" ") + ")");
  assert(errs2.length === 0, "no JS exception through the tree edits — " + errs2.join(" / "));
  await ctx2.close();
}

// --- 6.1: 多线与持续分析 (v6-plan §5 Q2「MultiPV 3 时三条线可见」) ----------
//
// §7 对的是 §2 的实现项,不是 §5 的验收项,于是这两条一条断言都没有(§8.2)。
// 引擎照旧是脚本化的:真搜索每次给的线数与分数都不一样,而「三条线」要成立,
// 得先能证明那是三条**不同**的线,各自带着自己的胜率 —— 这只有喂已知数字才
// 做得到。
{
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx3.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx3.newPage();
  const errs3 = [];
  pg.on("pageerror", (e) => errs3.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

  const sq = async (name) => {
    const c = await pg.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await pg.mouse.click(c.x, c.y);
    await settle(pg);
  };

  // 6.0 的真缺陷:空棋盘上「复盘」这个组名还立着,底下一个按钮都没有。修法是
  // 按 sanHistory().length 开门再 collapseEmptyGroups() 收组,所以这里先在
  // 一着未走时看一眼 —— 这一条要是回退,下面的持续分析全都还能过。
  {
    const g = await pg.evaluate(() => ({
      group: document.getElementById("review-actions").hidden,
      more: document.getElementById("an-more").hidden,
      run: document.getElementById("an-run").hidden,
      lineBox: document.getElementById("live-line").hidden,
    }));
    assert(g.group, "一着未走时「复盘」整组收起,没有一个光头的组名");
    assert(g.more && g.run, "……组里那几个按钮本来就不该在(分析 / 它的 ⋯ 菜单)");
    assert(g.lineBox, "……引擎行也不在");
  }

  for (const s of ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6"]) await sq(s);
  await settle(pg);
  assert(!(await pg.evaluate(() => document.getElementById("review-actions").hidden)),
    "有棋可复盘了,这一组才出现");

  // 设置里把线数调到 3。走界面而不是塞 localStorage:验收说的是「MultiPV 3
  // 时」,那就得先证明那颗按钮真的把 3 送到了引擎。
  // 9.0 S5:线数在设置页的「高级」里(原先是侧栏的「设置」页签),从栏上去、从栏上回。
  await pg.click('#rail button[data-view="settings"]');
  await settle(pg);
  await pg.click("#cat-advanced");
  await pg.click('#multipv-seg button[data-multipv="3"]');
  await settle(pg);
  await pg.click('#rail button[data-view="play"]');
  await settle(pg);

  // 一份三条线的评估。三条线各走一个**不同**的合法首着,所以「三条」是不是
  // 真的三条,看得出来。
  await pg.evaluate(() => {
    window.__mpv = [];
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen, movetime, opts) => {
      window.__mpv.push(opts && opts.multipv);
      const turn = fen.split(" ")[1];
      const line = (cp, uci) => ({ cp: turn === "w" ? cp : -cp, mate: null, pv: [uci], depth: 14 });
      return { cp: turn === "w" ? 60 : -60, mate: null, turn, best: "e2e4", pv: ["e2e4"],
        lines: [line(60, "e2e4"), line(20, "d2d4"), line(-10, "g1f3")] };
    };
  });
  await pg.click("#an-run");
  await pg.waitForTimeout(2500);
  assert((await pg.evaluate(() => window.__mpv.every((n) => n === 3) && window.__mpv.length > 0)),
    "设置里的 3 到了引擎手上,每一个局面都问了三条线 (" +
    JSON.stringify(await pg.evaluate(() => window.__mpv.slice(0, 4))) + ")");

  // 起始局面 —— 三条线的首着(e4 / d4 / Nf3)在这里都合法,所以三条都画得出来
  await pg.click("#rep-start");
  await settle(pg);
  const mpv = await pg.evaluate(() => {
    const el = document.getElementById("pv-line");
    // 7.8 §2: one row per line, numbered 1 2 3 — the principal line is row 1
    const rows = [...el.querySelectorAll(".pv-row")].map((r) => ({
      label: r.querySelector(".pv-eval").title,
      box: r.querySelector(".pv-eval").textContent,
      sans: [...r.querySelectorAll(".pv-chip")].map((c) => c.getAttribute("aria-label")),
    }));
    return { hidden: el.hidden, rows, bar: document.getElementById("eval-bar-text").textContent };
  });
  assert(!mpv.hidden, "复盘面板给出了引擎的线");
  assert(mpv.rows.length === 3 && mpv.rows.every((r) => r.sans.length >= 1),
    "MultiPV 3:三行,一条线一行 (" + mpv.rows.length + ")");
  const heads = mpv.rows.map((a) => a.sans[0]);
  assert(new Set(heads).size === 3, "三条线是三条不同的线,不是同一条抄三遍 (" + heads.join(" / ") + ")");
  assert(mpv.rows.every((a) => /胜率\s*\d+%/.test(a.label)),
    "每条线的分值框悬停都带着自己的胜率 (" + mpv.rows.map((a) => a.label).join(" | ") + ")");
  assert(mpv.rows.map((r) => r.box).join(" ") === "+0.6 +0.2 −0.1",
    "……分值框写的是分值,从白方看,各算各的 (" + mpv.rows.map((r) => r.box).join(" ") + ")");
  assert(/^[+-]/.test(mpv.bar.trim()), "主变那条的数字在评估条上 (" + mpv.bar + ")");

  // --- 持续分析:跟着复盘游标走,关掉就真的停 -------------------------------
  // 每个局面给一个只跟这个局面有关的分数(按已走手数),所以「变了」意味着
  // 引擎真的换了局面重问,而不是面板把上一次的数字留在那里。
  await pg.evaluate(() => {
    window.__live = { fens: [], stops: 0 };
    window.__chess.engine.analyzeInfinite = (fen, opts, onUpdate) => {
      window.__live.fens.push(fen);
      const parts = fen.split(" ");
      const ply = Number(parts[5]) * 2 - (parts[1] === "w" ? 2 : 1);
      const base = 30 + ply * 37;
      const lines = [];
      for (let k = 0; k < ((opts && opts.multipv) || 1); k++) {
        lines.push({ cp: base - k * 45, mate: null, pv: [], depth: 14 + k });
      }
      const id = setTimeout(() => onUpdate({ depth: 14, lines, turn: parts[1] }), 20);
      return () => { clearTimeout(id); window.__live.stops++; return Promise.resolve(); };
    };
  });
  const liveState = () => pg.evaluate(() => ({
    hidden: document.getElementById("live-line").hidden,
    head: (document.querySelector("#live-line > .pv-head > .pv-label") || {}).textContent || "",
    // 7.8 §2: the win chance is the score box's tooltip now, beside its score
    rows: [...document.querySelectorAll("#live-line .pv-row .pv-eval")].map((x) => x.textContent + " " + x.title),
    pressed: document.getElementById("opt-live").getAttribute("aria-pressed"),
    fens: window.__live.fens.length,
    stops: window.__live.stops,
  }));

  await pg.click("#rep-end");
  await settle(pg);
  await setLive(pg, true);
  await pg.waitForTimeout(500);
  const on = await liveState();
  assert(on.pressed === "true" && !on.hidden, "「持续分析」按下之后引擎行出现了");
  assert(/深度/.test(on.head), "……行首写着深度 (「" + on.head + "」)");
  assert(on.rows.length === 3, "……MultiPV 3,三条线一起在跑 (" + on.rows.length + ")");
  assert(on.rows.every((r) => /胜率\s*\d+%/.test(r)), "……每条都带胜率 (" + on.rows.join(" | ") + ")");
  assert(new Set(on.rows).size === 3, "……三条线三个数,不是同一个 (" + on.rows.join(" | ") + ")");

  // 游标用方向键退 —— 面板上的那对箭头在别处已经走过,这里走键盘这条路
  await pg.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await pg.keyboard.press("ArrowLeft");
  await pg.waitForTimeout(700);
  const back1 = await liveState();
  assert(back1.fens === on.fens + 1, "← 之后引擎被重新问了一次,问的是新局面 (" + back1.fens + ")");
  assert(back1.stops === on.stops + 1, "……上一条搜索被停掉,一次一条 (" + back1.stops + ")");
  assert(back1.rows[0] !== on.rows[0],
    "……面板上的评估跟着游标变了 (「" + on.rows[0] + "」→「" + back1.rows[0] + "」)");
  await pg.keyboard.press("ArrowLeft");
  await pg.waitForTimeout(700);
  const back2 = await liveState();
  assert(back2.rows[0] !== back1.rows[0] && back2.fens === back1.fens + 1,
    "……再退一手再变一次 (「" + back1.rows[0] + "」→「" + back2.rows[0] + "」)");

  // 关掉:最后一条搜索被停,面板收走,再动游标也不会再问引擎
  await setLive(pg, false);
  await settle(pg);
  const off = await liveState();
  assert(off.pressed === "false" && off.hidden && off.rows.length === 0,
    "关掉之后引擎行连同它的三条线一起收走");
  assert(off.stops === back2.stops + 1, "……在飞的那条搜索被停了 (" + off.stops + ")");
  await pg.keyboard.press("ArrowLeft");
  await pg.waitForTimeout(600);
  const after = await liveState();
  assert(after.fens === off.fens, "……关掉就是真的停了:再走游标也不再问引擎 (" + after.fens + ")");
  assert(after.hidden, "……面板也没有自己冒出来");

  assert(errs3.length === 0, "多线与持续分析:全程没有页面异常 — " + errs3.join(" / "));

  // --- 7.3 §3:把「预览」这一族从正则换成真去指、真去按 -------------------
  // 登记册里守着这一族的是十三条源码正则(棋谱行 mouseover/mouseleave、曲线
  // 的 click/pointerdown/pointermove、pv 小块的 click/focusin/keydown、Esc)。
  // 7.2 刚证明这类断言能一字不差地守着一个从 6.0 就按不动的按钮:形状对不代
  // 表按得动。所以这一版把它们换成下面这些 —— 指上去、按下去、看棋盘。
  {
    const badge = () => pg.evaluate(() => {
      const el = document.getElementById("preview-badge");
      return { hidden: !el || el.hidden, text: el ? el.textContent : "" };
    });
    // 游标的位置,从页面自己报出来的地方读 —— 曲线是个 slider,它的
    // aria-valuenow 就是 viewIndex,而这条线本来就有单独的断言看着
    const viewIndex = () => pg.evaluate(() =>
      Number((document.getElementById("eval-curve") || {}).getAttribute
        ? document.getElementById("eval-curve").getAttribute("aria-valuenow") : NaN));

    // 1. 指在棋谱的一行上,棋盘就走到那一手;指开,棋盘就回来
    await pg.click("#rep-start").catch(() => {});
    await settle(pg);
    await pg.hover("#move-list button[data-i]");
    await settle(pg);
    const hov = await badge();
    assert(!hov.hidden, "指在棋谱的一行上,棋盘预览那一手(" + hov.text + ")");
    await pg.hover("#board");
    await settle(pg);
    assert((await badge()).hidden, "指开,预览就收了 —— 棋盘回到游标那一手");

    // 2. 引擎那条线的小块:按一下就预览,焦点走到它身上也预览
    const chips = await pg.evaluate(() =>
      document.querySelectorAll("#pv-line button.pv-chip").length);
    if (chips > 0) {
      await pg.click("#pv-line button.pv-chip");
      await settle(pg);
      const pin = await badge();
      assert(!pin.hidden, "按下引擎线上的一个小块,棋盘就摆出那条线(" + pin.text + ")");
      // 按下去的预览是钉住的 —— 它得能被 Esc 请走,这也是 escapeKey 的活
      await pg.keyboard.press("Escape");
      await settle(pg);
      assert((await badge()).hidden, "Esc 把钉住的预览请走");
      // 键盘也走得通:焦点落到小块上就预览。先把焦点挪开 —— Esc 不会让它
      // 失焦,而 focus() 打在已经有焦点的元素上不发 focusin,那样测的就是
      // 「什么都没发生」。
      await pg.evaluate(() => document.getElementById("board").focus());
      await settle(pg);
      await pg.evaluate(() => document.querySelector("#pv-line button.pv-chip").focus());
      await settle(pg);
      assert(!(await badge()).hidden, "焦点落在小块上,不按也预览 —— 键盘走得通同一条路");
      await pg.keyboard.press("Escape");
      await settle(pg);
    }

    // 3. 曲线:点一下跳到那一手,按着拖过去一路跟着走
    // 3. Esc 还管面板 —— escapeKey 的最后一段
    // Esc 是一串「最局部的先走」:走子菜单、预走、选中的子、对话框、提示条、
    // 钉住的预览、编辑器,最后才是面板。所以这里按到面板收起为止,并数一下
    // 按了几下:这条断言问的是「面板终究收得掉」,不是「第一下就收」。
    await pg.evaluate(() => {
      const app = document.getElementById("app");
      if (!app.classList.contains("panel-open")) document.getElementById("toggle-panel").click();
      document.getElementById("board").focus();
    });
    await settle(pg);
    const open = () => pg.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
    assert(await open(), "侧栏是开着的");
    let taps = 0;
    while (await open() && taps < 5) {
      await pg.keyboard.press("Escape");
      await settle(pg);
      taps++;
    }
    assert(!(await open()),
      "按 Esc,侧栏收起来 —— 这是 escapeKey 最后一段,此前只有一条正则看着它(按了 " + taps + " 下)");
  }

  assert(errs3.length === 0, "预览一族:全程没有页面异常 — " + errs3.join(" / "));
  await ctx3.close();
}

// --- 7.3 §3:局势曲线,点一下与拖一路 ---------------------------------------
// 曲线的 click / pointerdown / pointermove 此前是一条源码正则(「the curve
// scrubs with the pointer through the same call the click makes」)。形状对不
// 代表拖得动,所以这里真的按下去、真的拖过去,看游标有没有跟着走。
// 自己一个上下文:曲线要 30 手以上判过的着法才画得出来(Review.longEnough),
// 而把一整局棋送进去最省事的路是剪贴板,那需要一份 zero.clipboard 的替身。
{
  // 一局够长的棋:Review.longEnough 要 30 手以上判过的着法,曲线才画得出来
  const LONG_PGN = '[Event "Curve"]\n[Site "?"]\n[Date "2026.09.20"]\n[Round "-"]\n' +
    '[White "A"]\n[Black "B"]\n[Result "*"]\n\n' +
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 ' +
    '8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 11. Nbd2 Bb7 12. Bc2 Re8 13. Nf1 Bf8 ' +
    '14. Ng3 g6 15. b3 Bg7 16. d5 Nb6 17. Be3 Nfd7 18. c4 f5 19. exf5 gxf5 ' +
    '20. Nh2 e4 21. f3 Qh4 22. Qd2 Rf8 23. Bxb6 Nxb6 24. Rf1 *\n';

  const ctxC = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctxC.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__clip = "";
    window.zero = {
      invoke: () => Promise.resolve(true), on: () => () => {}, off: () => {},
      platform: { supports: () => Promise.resolve(false) },
      clipboard: {
        readText: () => Promise.resolve(window.__clip),
        writeText: (t) => { window.__clip = String(t); return Promise.resolve(true); },
      },
    };
  });
  // 一页只收第一个指针手势:实测同一个页面上先点一下再按着拖,拖的那一串
  // pointermove 一个都不来(probe 过:单独拖是 0 → 41,点过之后再拖是 38 → 38)。
  // 这是 Playwright 合成指针事件的脾气,不是曲线的。所以点击和拖动各开一页,
  // 每一页上它都是第一个手势 —— 两条断言各自问的那件事都问得干净。
  const errsC = [];
  const readyPage = async () => {
    const pgC = await ctxC.newPage();
    pgC.on("pageerror", (e) => errsC.push(e.message));
    await pgC.goto(`http://127.0.0.1:${PORT}/`);
    await pgC.waitForTimeout(900);
    await pgC.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
    await pgC.evaluate((x) => { window.__clip = x; }, LONG_PGN);
    if (await pgC.evaluate(() => !!document.getElementById("more-row").hidden)) {
      await pgC.click("#more-tools"); await settle(pgC);
    }
    await pgC.click("#pgn-paste");
    await pgC.waitForTimeout(900);
    if (await pgC.isVisible("#confirm-modal.show").catch(() => false)) {
      await pgC.click("#confirm-ok"); await pgC.waitForTimeout(700);
    }
    // 一份不吃 CPU 的评估:每个局面给一个跟着手数走的分数,曲线就有起伏
    await pgC.evaluate(() => {
      let n = 0;
      const seen = new Map(); // by position: the pass asks some twice (v8-0-plan B2)
      window.__chess.engine.analyze = async (fen) => {
        const turn = fen.split(" ")[1];
        if (!seen.has(fen)) seen.set(fen, n++);
        const cp = ((seen.get(fen) % 9) - 4) * 30;
        return { cp: turn === "w" ? cp : -cp, mate: null, turn, best: "e2e4", pv: ["e2e4"],
          lines: [{ cp, mate: null, pv: ["e2e4"], depth: 12 }] };
      };
    });
    await pgC.click("#an-run");
    await pgC.waitForTimeout(4000);
    await pgC.click("#rep-start");
    await settle(pgC);
    const box = await pgC.evaluate(() => {
      const el = document.getElementById("eval-curve");
      if (!el || el.hidden || !el.offsetParent) return null;
      // v8-0-plan A4: the report heads the review now, the curve under it
      el.scrollIntoView({ block: "center" });
      const r = el.getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    const at = () => pgC.evaluate(() =>
      Number(document.getElementById("eval-curve").getAttribute("aria-valuenow")));
    return { pgC, box, at };
  };

  // 点一下:游标跳到那一手
  {
    const { pgC, box, at } = await readyPage();
    assert(!!box, "一整局棋分析完,局势曲线画出来了 —— 下面两条要指的就是它");
    if (box) {
      assert(await at() === 0, "先回到开局(第 " + (await at()) + " 手)");
      await pgC.mouse.click(box.x + box.w * 0.8, box.y);
      await settle(pgC);
      const clicked = await at();
      assert(clicked > 20, "在曲线右边点一下,棋盘就跳到那一手(第 " + clicked + " 手)");
    }
    await pgC.close();
  }
  // 按着拖:游标一路跟着走,不是松手才到
  {
    const { pgC, box, at } = await readyPage();
    if (box) {
      await pgC.mouse.move(box.x + box.w * 0.15, box.y);
      await pgC.mouse.down();
      // 按下之后停一拍再动:不停的话第一段移动会和按下并成一次派发
      await settle(pgC);
      // 9.0 M2:一步一量 —— 每挪一段,棋盘都已经站在指针下的那一手,不是攒到最后
      const seen = [];
      for (let k = 1; k <= 6; k++) {
        await pgC.mouse.move(box.x + box.w * (0.15 + 0.7 * k / 6), box.y);
        await settle(pgC);
        seen.push(await at());
      }
      await settle(pgC);
      // 还没松手就量 —— 拖的定义就是「松手之前已经跟上了」
      const mid = await at();
      await pgC.mouse.up();
      assert(mid > 20, "按着从左往右拖,松手之前棋盘就已经跟到了那边(第 " + mid + " 手)");
      assert(seen.every((v, i) => i === 0 || v > seen[i - 1]),
        "M2:拖动途中每一段棋盘都跟到指针下的那一手(" + seen.join(" → ") + ")");
    }
    await pgC.close();
  }
  // 7.8 §2:120px 高、以 50% 胜率为中线、悬停说「第 N 回合 着法 分值」。
  // v8-0-plan A4 把两块面积改成白黑分色:曲线下是白方的颜色,曲线上是黑方的。
  // 换一份评估:前半盘白方 +1.5,第 30 手之后黑方 −6 —— 中间那一步是 ??,
  // 两种颜色都得有。面积按画布上的像素数,不看代码。
  {
    const { pgC } = await readyPage();
    await pgC.evaluate(() => {
      let n = 0;
      const seen = new Map(); // by position: the pass asks some twice (v8-0-plan B2)
      window.__chess.engine.analyze = async (fen) => {
        const turn = fen.split(" ")[1];
        if (!seen.has(fen)) seen.set(fen, n++);
        const cp = seen.get(fen) < 31 ? 150 : -600;
        return { cp: turn === "w" ? cp : -cp, mate: null, turn, best: "e2e4", pv: ["e2e4"] };
      };
    });
    await pgC.click("#an-run");
    await pgC.waitForTimeout(4000);
    const g = await pgC.evaluate(() => {
      const el = document.getElementById("eval-curve");
      const ctx = el.getContext("2d");
      const { width: W, height: H } = el;
      const d = ctx.getImageData(0, 0, W, H).data;
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => { const s = document.createElement("span"); s.style.color = v; document.body.appendChild(s);
        const c = getComputedStyle(s).color.match(/\d+/g).map(Number); s.remove(); return c; };
      const sw = rgb(css.getPropertyValue("--side-white")), bad = rgb(css.getPropertyValue("--judge-bad"));
      const is = (k, c) => Math.abs(d[k] - c[0]) + Math.abs(d[k + 1] - c[1]) + Math.abs(d[k + 2] - c[2]) < 12;
      let white = 0, red = 0, faint = 0;
      // 9.0 M2: the opaque pixels are the line and the marks; the area under
      // the line is a faint wash, not White's colour
      for (let k = 0; k < d.length; k += 4) {
        if (d[k + 3] > 0 && d[k + 3] < 64) faint++;
        if (d[k + 3] < 250) continue;
        if (is(k, sw)) white++;
        else if (is(k, bad)) red++;
      }
      const marks = [...document.querySelectorAll(".move-list .mvtag")].map((a) => a.textContent.trim());
      return { h: el.getBoundingClientRect().height, white, red, faint, area: W * H, marks };
    });
    assert(g.marks.includes("??"), "这一盘棋里有一步 ?? (" + g.marks.join(" ") + ")");
    assert(g.h >= 120, "局势曲线至少 120px 高 (" + g.h + ")");
    assert(g.red > 20 && g.faint > g.area * 0.1 && g.white < g.area * 0.01,
      "……?? 是一个 --judge-bad 色的小菱形,曲线下是淡填充,没有白色大块 (?? " + g.red + " px / 淡 " + g.faint + " / 白 " + g.white + ")");
    const box = await pgC.evaluate(() => {
      document.getElementById("eval-curve").scrollIntoView({ block: "center" });
      const r = document.getElementById("eval-curve").getBoundingClientRect();
      return { x: r.left, y: r.top + r.height / 2, w: r.width };
    });
    await pgC.mouse.move(box.x + box.w * 0.25, box.y);
    await settle(pgC);
    const tip = await pgC.evaluate(() => {
      const el = document.getElementById("curve-tip");
      return { hidden: !el || el.hidden, text: el && el.firstElementChild ? el.firstElementChild.textContent : "" };
    });
    assert(!tip.hidden && /^第 \d+ 回合 …?\S+ [+−]?\d+\.\d$/.test(tip.text),
      "悬停在曲线上:「第 N 回合 着法 分值」(「" + tip.text + "」)");
    await pgC.mouse.move(box.x, box.y - 200);
    await settle(pgC);
    assert(await pgC.evaluate(() => { const el = document.getElementById("curve-tip"); return !!el && el.hidden; }), "……指针离开就收起");
    await pgC.close();
  }
  assert(errsC.length === 0, "曲线:全程没有页面异常 — " + errsC.join(" / "));
  await ctxC.close();
}

// (v10-0-plan E3: this section keeps its fixed waits — it measures what the
// page does while time passes with the engine reporting, not after it settles)
// --- 7.6 §2：按住的时候，按钮不许挪 ------------------------------------------
// 7.5 在 WebKit 上确认过：按钮在按下与松开之间挪了位置，这次点击就会丢。
// 持续分析的 #live-line 每帧整段重建，multipv=3 时下面的「新局」上下跳；分析
// 进行中，#pv-line 的着法 chip 每一手都被换成新节点。这两处都按住一会儿再
// 松开，逐帧看被按的那个东西挪没挪、换没换（scripts/lib/held-click.mjs）。
{
  const ctxH = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctxH.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", multipv: 3 }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pgH = await ctxH.newPage();
  const errsH = [];
  pgH.on("pageerror", (e) => errsH.push(e.message));
  await pgH.goto(`http://127.0.0.1:${PORT}/`);
  await pgH.waitForTimeout(900);
  if (await pgH.isVisible("#pick-cancel").catch(() => false)) await pgH.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const tap = async (s) => {
    const c = await pgH.evaluate((x) => {
      const r = document.getElementById("board").getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - Number(x[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, s);
    await pgH.mouse.click(c.x, c.y);
  };
  const plies = () => pgH.evaluate(() => document.querySelectorAll("#move-list button[data-i]").length);

  // 一个像真引擎那样说话的持续分析：刚开始一条线，接着两条、三条；之后每一拍
  // 都换一次读法 —— 主变时长时短，着法也换。这正是真 Stockfish 在 multipv=3
  // 时每秒几次送来的东西，也正是旧的 #live-line 每帧整段重建的原因。
  await pgH.evaluate(() => {
    const LINES = {
      // after 1.e4
      b: [
        "g8f6 e4e5 f6d5 d2d4 d7d6 g1f3 b8c6 c2c4",
        "e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6 e1g1",
        "c7c5 g1f3 d7d6 d2d4 c5d4 f3d4 g8f6 b1c3",
      ],
      w: [
        "e2e4 e7e5 g1f3 b8c6 f1b5 a7a6 b5a4 g8f6",
        "d2d4 d7d5 c2c4 e7e6 b1c3 g8f6 c1g5 f8e7",
        "g1f3 g8f6 c2c4 e7e6 b1c3 d7d5 d2d4 f8e7",
      ],
    };
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyzeInfinite = (fen, opts, onUpdate) => {
      const turn = fen.split(" ")[1];
      const mpv = (opts && opts.multipv) || 1;
      let beat = 0;
      const id = setInterval(() => {
        beat++;
        const n = Math.min(mpv, beat);
        const lines = [];
        for (let k = 0; k < n; k++) {
          const pv = LINES[turn][(k + (beat >> 2)) % 3].split(" ");
          // long, short, long, short…: a row that wraps, then one that does not
          lines.push({ cp: 30 - k * 25 + (beat % 7), mate: null, pv: beat % 2 ? pv : pv.slice(0, 2), depth: 8 + beat });
        }
        onUpdate({ depth: 8 + beat, lines, turn });
      }, 70);
      return () => { clearInterval(id); return Promise.resolve(); };
    };
  });

  // --- (a) 持续分析开着，连点「新局」10 次，每次都生效 -------------------
  await tap("e2"); await tap("e4");
  await pgH.waitForTimeout(250);
  await setLive(pgH, true);
  await pgH.waitForTimeout(300);
  const liveRows = await pgH.evaluate(() => document.querySelectorAll("#live-line .pv-row").length);
  assert(liveRows === 3, "持续分析开着，multipv=3 的三条线都在 (" + liveRows + ")");
  let worst = 0, took = 0, lost = [];
  for (let n = 0; n < 10; n++) {
    if (!(await plies())) { await tap("e2"); await tap("e4"); }
    await pgH.waitForTimeout(350);
    const r = await heldClick(pgH, "#btn-new", { hold: 450 });
    worst = Math.max(worst, r.drift);
    let asked = false;
    for (let i = 0; i < 10 && !asked; i++) {
      await pgH.waitForTimeout(60);
      asked = await pgH.isVisible("#newgame-modal.show").catch(() => false);
    }
    if (asked) {
      await pgH.click("#ng-start");
      await pgH.waitForTimeout(300);
    }
    if (asked && r.clicked && !r.replaced && !r.mutated && r.drift === 0 && (await plies()) === 0) took++;
    else lost.push(n + ": " + JSON.stringify({ asked, drift: r.drift, replaced: r.replaced, mutated: r.mutated, clicked: r.clicked }));
  }
  console.log("  持续分析 multipv=3 时按住「新局」：最大位移 " + worst + "px");
  assert(worst === 0, "持续分析每拍都在刷新，「新局」按住期间一像素都没挪 (最多 " + worst + "px)");
  assert(took === 10, "连点「新局」10 次，10 次都生效了 (" + took + "/10)" + (lost.length ? " — " + lost.join(" | ") : ""));

  // --- (b) 分析进行中，按住引擎线上的一着 --------------------------------
  // 先有一份分析，开局那一手带一条五着的主变；再开一遍精析，让它慢慢跑。
  for (const s of ["e2", "e4", "e7", "e5", "f1", "c4", "b8", "c6", "d1", "h5", "g8", "f6", "h5", "f7"]) await tap(s);
  await pgH.waitForTimeout(300);
  await setLive(pgH, false);
  await pgH.evaluate(() => {
    window.__chess.engine.analyze = async (fen, movetime) => {
      const turn = fen.split(" ")[1];
      // the second pass (精析) is slow on purpose: it is the pass in flight
      if (movetime >= 400) await new Promise((r) => setTimeout(r, 200));
      const start = fen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w");
      return { cp: turn === "w" ? 25 : -25, mate: null, turn, best: start ? "e2e4" : null,
        pv: start ? ["e2e4", "e7e5", "g1f3", "b8c6", "f1c4"] : [] };
    };
  });
  await pgH.click("#an-run");
  await pgH.waitForTimeout(1500);
  await pgH.click("#rep-start");
  await pgH.waitForTimeout(300);
  const chips = await pgH.evaluate(() => document.querySelectorAll("#pv-line button.pv-chip").length);
  assert(chips === 5, "开局那一手的引擎线是五个可以按的着法 (" + chips + ")");
  await clickDeep(pgH);
  await pgH.waitForTimeout(400);
  const busy = await pgH.evaluate(() => /停止/.test(document.getElementById("an-run").textContent));
  assert(busy, "精析在跑");
  const c = await heldClick(pgH, '#pv-line button.pv-chip[data-k="2"]', { hold: 600 });
  const still = await pgH.evaluate(() => /停止/.test(document.getElementById("an-run").textContent));
  console.log("  分析进行中按住引擎线上的着法：位移 " + c.drift + "px，节点" + (c.replaced ? "被换掉了" : "还是原来那个"));
  assert(still, "……按住的这 600 毫秒里，精析一直在跑（每一手都刷新面板）");
  assert(!c.replaced && !c.mutated && c.drift === 0, "分析进行中，按住的那一着既没被换成新节点、没被改写，也没挪", JSON.stringify(c));
  const badgeH = await pgH.evaluate(() => {
    const el = document.getElementById("preview-badge");
    return { hidden: el.hidden, text: el.textContent };
  });
  assert(c.clicked && !badgeH.hidden && /Esc/.test(badgeH.text),
    "……松开就是一次点击：棋盘钉在那条线上 (" + badgeH.text + ")");
  await pgH.keyboard.press("Escape");

  // --- (c) 7.8 §2：持续分析的着法也是按钮了。引擎每 30ms 换一次主变，按住
  // 第 1 条线的第 2 步 600ms：那颗按钮不许被换掉、改写或挪动，松开钉住那条线
  if (await pgH.evaluate(() => /停止/.test(document.getElementById("an-run").textContent))) {
    await pgH.click("#an-run");
    await pgH.waitForTimeout(1500);
  }
  await pgH.evaluate(() => {
    window.__chess.engine.analyzeInfinite = (fen, opts, onUpdate) => {
      const turn = fen.split(" ")[1];
      const A = ["e2e4", "e7e5", "g1f3", "b8c6"], B = ["d2d4", "d7d5", "c2c4", "e7e6"];
      let n = 0;
      const id = setInterval(() => {
        n++;
        const pv = n % 2 ? A : B;
        onUpdate({ depth: 10 + n, turn, lines: [0, 1, 2].map((k) => ({ cp: 30 - k * 40 + (n % 5), mate: null, pv, depth: 10 + n })) });
      }, 30);
      return () => { clearInterval(id); return Promise.resolve(); };
    };
  });
  await pgH.evaluate(() => { const b = document.getElementById("rep-start"); if (!b.disabled) b.click(); });
  await pgH.waitForTimeout(200);
  // (switched off and on again, so the new scripted engine is the one asked)
  await setLive(pgH, false);
  await setLive(pgH, true);
  await pgH.waitForTimeout(800);
  const lc = await heldClick(pgH, '#live-line .pv-row[data-line="0"] button.pv-chip[data-k="1"]', { hold: 600 });
  console.log("  持续分析中按住引擎线上的着法：位移 " + lc.drift + "px，节点" + (lc.replaced ? "被换掉了" : "还是原来那个"));
  assert(!lc.replaced && !lc.mutated && lc.drift === 0,
    "持续分析每 30ms 换一次主变，按住的那一着既没被换成新节点、没被改写，也没挪", JSON.stringify(lc));
  const badgeL = await pgH.evaluate(() => document.getElementById("preview-badge").hidden);
  assert(lc.clicked && !badgeL, "……松开就是一次点击：棋盘走进了那条线");
  await pgH.keyboard.press("Escape");
  assert(errsH.length === 0, "按住不挪：全程没有页面异常 — " + errsH.join(" / "));
  await ctxH.close();
}

// --- 停在加深阶段（评审 #87）：快速扫描已经量完每个局面，停止不该丢掉它 ---
// Through PR #87 a Stop pressed while the pass searched the marked moves
// again, deeper, took the partial branch: every tag null, no accuracy, no
// grades, nothing filed, and 「保留前 N 步」 for a game measured end to end.
{
  const ctxS = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctxS.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pgS = await ctxS.newPage();
  const errsS = [];
  pgS.on("pageerror", (e) => errsS.push(e.message));
  await pgS.goto(`http://127.0.0.1:${PORT}/`);
  await pgS.waitForTimeout(900);
  await pgS.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  // scholar's mate again, played on the board
  for (const sq of ["e2", "e4", "e7", "e5", "f1", "c4", "b8", "c6", "d1", "h5", "g8", "f6", "h5", "f7"]) {
    const c = await pgS.evaluate((s) => {
      const r = document.getElementById("board").getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, sq);
    await pgS.mouse.click(c.x, c.y);
  }
  await settle(pgS);
  const stopped = await pgS.evaluate(async () => {
    const W = [20, 20, 300, -400, -380, -390, -1200, -1210];
    const seen = new Map();
    let n = 0, deepAsked = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen, budget) => {
      const turn = fen.split(" ")[1];
      if (!seen.has(fen)) seen.set(fen, n++);
      // the first deeper search: the player presses 停止 while it runs
      if (budget > 200 && !deepAsked++) document.getElementById("an-run").click();
      const w = W[Math.min(seen.get(fen), W.length - 1)];
      return { cp: turn === "w" ? w : -w, mate: null, turn, best: "d1h5", pv: ["d1h5"] };
    };
    document.getElementById("an-run").click();
    await new Promise((r) => setTimeout(r, 2500));
    const kept = JSON.parse(localStorage.getItem("chess.analyses") || "null");
    const e = kept && kept.list && kept.list[kept.list.length - 1];
    return { deepAsked, toast: document.getElementById("toast").textContent,
      an: e ? { tags: e.an.tags, acc: e.an.acc, grades: e.an.grades, scalars: e.an.scalars, deep: e.an.deep } : null,
      tags: [...document.querySelectorAll(".move-list .mvtag")].map((t) => t.textContent.trim()) };
  });
  console.log("  加深时停止：" + JSON.stringify(stopped));
  assert(stopped.deepAsked >= 1, "加深时停止：确实停在了加深阶段 (" + stopped.deepAsked + ")");
  assert(!!stopped.an && stopped.an.scalars.length === 8 && stopped.an.scalars.every((s) => s != null),
    "加深时停止：快速扫描量过的每个局面都存进了分析记录", JSON.stringify(stopped.an));
  assert(!!stopped.an && stopped.an.tags.length === 7 && stopped.an.tags.some((t) => t === "??") && stopped.tags.includes("??"),
    "加深时停止：失着照样标出（记录与着法表）", JSON.stringify(stopped.an && stopped.an.tags) + " " + stopped.tags.join(" "));
  assert(!!stopped.an && stopped.an.acc && typeof stopped.an.acc === "object"
    && Array.isArray(stopped.an.grades) && stopped.an.grades.length === 7 && stopped.an.grades.every((x) => typeof x === "string"),
    "加深时停止：准确率与分级都在", JSON.stringify(stopped.an && { acc: stopped.an.acc, grades: stopped.an.grades }));
  assert(!/保留前/.test(stopped.toast) && /分析完成/.test(stopped.toast) && /加深/.test(stopped.toast),
    "加深时停止：提示说分析完成、加深被停，不说「保留前 N 步」 (" + stopped.toast + ")");
  assert(errsS.length === 0, "加深时停止：没有页面异常 — " + errsS.join(" / "));
  await ctxS.close();
}

// --- v8-0-plan A4：复盘做成一张「对局体检报告」 -----------------------------
// Morphy's Opera game with a fixed engine story (scripts/lib/opera-fixture.mjs):
// marks on both sides, and 16.Qb8+ graded 妙着. Top: both accuracies and the
// grade counts; then the win-rate graph, large (9.0 M2: a thin line on a faint fill), with
// axes, its mistake points snapping a click; the mark on the board; the move
// list coloured by grade; three key moments a side to step through, each with
// 为什么 / 再试一次 / 看引擎线; 从错误中学 chaining every ? / ?? through
// 再试一次; 重下 renamed and moved away from 再试一次; no dashed placeholder
// cards; the eval bar level with the board's frame; nothing cut off in three
// languages.
{
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await ctxA.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", soundOn: false,
      appearance: "dark", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett", view: "play" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctxA.newPage();
  const errsA = [];
  pg.on("pageerror", (e) => errsA.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await playOpera(pg);
  await analyseOpera(pg);
  const goto = async (n) => {
    await pg.evaluate((k) => {
      document.getElementById("rep-start").click();
      for (let i = 0; i < k; i++) document.getElementById("rep-next").click();
    }, n);
    await settle(pg);
  };
  const vi = () => pg.evaluate(() => Number(document.getElementById("eval-curve").getAttribute("aria-valuenow")));
  const rec = await pg.evaluate(() => {
    const kept = JSON.parse(localStorage.getItem("chess.analyses") || "null");
    const e = kept && kept.list && kept.list[kept.list.length - 1];
    return e ? { tags: e.an.tags, grades: e.an.grades } : null;
  });
  assert(!!rec && rec.grades.length === OPERA.length && rec.grades.includes("brilliant") && rec.tags.includes("??"),
    "A4 夹具：整盘分级，里面有妙着和 ??（" + (rec && rec.grades.join(",")) + "）");
  const G = rec ? rec.grades : [];
  const T = rec ? rec.tags : [];

  // (1) 9.0 M2: the review in two layers. On top the game in one sentence,
  // the curve and the key moments — one screen, 再试一次 on the card; the
  // accuracies, the grade table, 从错误中学 and the mistakes list are folded
  // into 完整报告, shut by default.
  const layer = await pg.evaluate(() => {
    document.getElementById("rv-summary").scrollIntoView({ block: "start" });
    const wrap = document.getElementById("eval-wrap");
    const first = [...wrap.children].find((c) => !c.hidden && c.offsetParent);
    const r = (id) => document.getElementById(id).getBoundingClientRect();
    const full = document.getElementById("rv-full");
    const retry = document.querySelector('#rv-km button[data-act="retry"]');
    return { first: first && first.id, summary: document.getElementById("rv-summary").textContent,
      sum: r("rv-summary").top, curve: r("eval-curve").top, km: r("rv-km").top, full: r("rv-full").top,
      retryShown: !!retry && !retry.hidden && !!retry.offsetParent, retryBottom: retry ? retry.getBoundingClientRect().bottom : 1e9,
      fold: window.innerHeight, open: full.open, fullShown: !full.hidden,
      inFull: ["report-card", "rv-learn-row", "rv-mistakes"].every((id) => !!document.getElementById(id).closest("#rv-full")),
      cardSeen: document.getElementById("report-card").checkVisibility() };
  });
  assert(layer.first === "rv-summary" && /^全盘的转折是 \d+(\.|…) ?\S+：(白方|黑方)胜率从 \d+% 掉到 \d+%。$/.test(layer.summary),
    "M2：复盘区第一行是一句话总结，双人对局用中性口吻（「" + layer.summary + "」，首块 " + layer.first + "）");
  assert(layer.sum < layer.curve && layer.curve < layer.km && layer.km < layer.full,
    "M2：第一层自上而下是总结、胜率曲线、关键时刻，完整报告在它们之下");
  assert(layer.retryShown && layer.retryBottom <= layer.fold,
    "M2：总结、曲线和关键时刻卡上的「再试一次」在同一屏里（按钮底 " + Math.round(layer.retryBottom) + " ≤ " + layer.fold + "）");
  assert(layer.fullShown && !layer.open && layer.inFull && !layer.cardSeen,
    "M2：精准度/分级表、从错误中学和失误列表收在「完整报告」里，默认收起" + (layer.open || layer.cardSeen ? " — " + JSON.stringify(layer) : ""));
  await pg.click("#rv-full > summary");
  await settle(pg);
  const top = await pg.evaluate(() => {
    const rows = [...document.querySelectorAll("#review-body .rv-table tbody tr")].map((tr) => ({
      cls: tr.className, k: tr.querySelector("th").textContent, v: [...tr.querySelectorAll("td")].map((td) => td.textContent) }));
    return { label: document.querySelector("#rv-full > summary").textContent.trim(), card: document.getElementById("report-card").checkVisibility(),
      nums: [...document.querySelectorAll("#acc-line .acc-num")].map((e) => e.textContent), rows };
  });
  assert(top.label === "完整报告" && top.card, "M2：点「完整报告」展开，精准度与分级计数就在里面（" + top.label + "）");
  assert(top.nums.length === 2 && top.nums.every((n) => /^\d+%$/.test(n)), "A4：顶部是双方精准度（" + top.nums.join(" / ") + "）");
  {
    const count = (side, g) => G.filter((x, i) => x === g && (i % 2 === 0) === (side === "w")).length;
    const byLabel = { "最佳": "best", "优秀": "excellent", "良好": "good", "谱着": "book", "妙着": "brilliant" };
    const bad = [];
    for (const [lab, g] of Object.entries(byLabel)) {
      const row = top.rows.find((r) => r.k.includes(lab));
      const want = [count("w", g), count("b", g)];
      if (!(want[0] + want[1])) continue;
      if (!row || row.v[0] !== String(want[0]) || row.v[1] !== String(want[1])) bad.push(lab + " " + JSON.stringify(row && row.v) + "≠" + want);
    }
    assert(bad.length === 0, "A4：分级计数是表里的行，每方一列，数目与分析记录一致" + (bad.length ? " — " + bad.join("; ") : ""));
  }

  // (2) the graph: large, axes, White below the line and Black above it
  const graph = await pg.evaluate(() => {
    const cv = document.getElementById("eval-curve");
    cv.scrollIntoView({ block: "center" });
    const n = Number(cv.getAttribute("aria-valuemax"));
    // White is winning by position 26 (under the line: White's colour);
    // position 2 is level, and a quarter down from the top is over the line
    const fx = (i) => (4 + (i / n) * (cv.clientWidth - 8)) / cv.clientWidth;
    const ys = [...document.querySelectorAll("#curve-y span")].map((e) => e.textContent.trim());
    const xs = [...document.querySelectorAll("#curve-x span")].map((e) => e.textContent.trim());
    const ctx = cv.getContext("2d");
    const px = (fx, fy) => [...ctx.getImageData(Math.round(cv.width * fx), Math.round(cv.height * fy), 1, 1).data];
    const rgb = (v) => { const d = document.createElement("span"); d.style.color = v; document.body.appendChild(d);
      const c = getComputedStyle(d).color.match(/\d+/g).map(Number); d.remove(); return c; };
    const css = getComputedStyle(document.documentElement);
    const all = ctx.getImageData(0, 0, cv.width, cv.height).data;
    const data = rgb(css.getPropertyValue("--data")), white = rgb(css.getPropertyValue("--side-white"));
    const near = (k, c, tol) => Math.abs(all[k] - c[0]) + Math.abs(all[k + 1] - c[1]) + Math.abs(all[k + 2] - c[2]) <= tol;
    let line = 0, whiteBlock = 0, opaque = 0;
    for (let k = 0; k < all.length; k += 4) {
      if (all[k + 3] < 250) continue;
      opaque++;
      if (near(k, data, 24)) line++;
      else if (near(k, white, 24)) whiteBlock++;
    }
    return { h: cv.clientHeight, ys, xs, low: px(fx(26), 0.9), high: px(fx(2), 0.25), line, whiteBlock, opaque,
      area: cv.width * cv.height, bg: getComputedStyle(cv).backgroundColor };
  });
  const close = (a, b, tol) => a.every((v, i) => Math.abs(v - b[i]) <= tol);
  assert(graph.h >= 160, "A4：胜率图够大（" + graph.h + "px ≥ 160）");
  assert(graph.ys.join("|") === "100%|50%|0%" && graph.xs.length >= 3 && graph.xs.every((x) => /^\d+$/.test(x)),
    "A4：有纵轴（" + graph.ys.join(" ") + "）和回合数横轴（" + graph.xs.join(" ") + "）");
  // 9.0 M2: a thin line over a faint fill — no block of White's colour
  // under it, nothing over it, the canvas itself transparent on the panel
  assert(graph.low[3] > 0 && graph.low[3] < 64 && graph.high[3] === 0 && /rgba\(0, 0, 0, 0\)|transparent/.test(graph.bg),
    "M2：曲线下是淡填充、曲线上不涂色（下 α" + graph.low[3] + " / 上 α" + graph.high[3] + "，底 " + graph.bg + "）");
  assert(graph.line > 0 && graph.opaque < graph.area * 0.06 && graph.whiteBlock < graph.area * 0.01,
    "M2：实色只有细线和标记（数据色线 " + graph.line + " px，实色 " + graph.opaque + " / " + graph.area + "，白块 " + graph.whiteBlock + "）");

  // (3) a click near a mistake point lands on that move, not on a neighbour
  {
    const worst = T.indexOf("??");
    const p = await pg.evaluate((i) => {
      const cv = document.getElementById("eval-curve");
      cv.scrollIntoView({ block: "center" });
      const r = cv.getBoundingClientRect();
      const n = Number(cv.getAttribute("aria-valuemax"));
      const step = (r.width - 8) / n;
      // the dot is at position i + 1; 0.6 of a step to the right rounds to i + 2
      return { x: r.left + 4 + (i + 1 + 0.6) * step, y: r.top + r.height * 0.1, step };
    }, worst);
    // 9.0 M2: hovering the ?? point says what should have been played
    await pg.mouse.move(p.x - 0.6 * p.step, p.y);
    await settle(pg);
    const tip = await pg.evaluate(() => {
      const el = document.getElementById("curve-tip");
      return el && !el.hidden ? [...el.children].map((c) => c.textContent) : null;
    });
    assert(!!tip && /^应走 \S+$/.test(tip[1] || ""),
      "M2：悬停在 ?? 点上，提示写「应走 …」（" + (tip && tip.join(" | ")) + "）");
    await pg.mouse.click(p.x, p.y);
    await settle(pg);
    const at = await vi();
    assert(p.step * 0.6 < 10 && at === worst + 1,
      "A4：点在失着点旁边 " + Math.round(p.step * 0.6) + "px，也跳到那一步之后（" + at + " = " + (worst + 1) + "）");
  }

  // (4) the mark on the board: !! for the brilliancy, in the praise colour
  {
    const bril = G.indexOf("brilliant");
    await goto(bril + 1);
    const b = await pg.evaluate((sq) => {
      const cv = document.getElementById("board");
      const step = cv.width / 8;
      const f = sq.charCodeAt(0) - 97, rk = 8 - Number(sq[1]);
      const r = step * 0.16; // 10.1 B2 (0.19 until then); the centre is still 0.22 in
      const cx = (f + 1) * step - step * 0.22, cy = rk * step + step * 0.22;
      const d = cv.getContext("2d").getImageData(Math.round(cx - r * 0.78), Math.round(cy), 1, 1).data;
      const s = document.createElement("span");
      s.style.color = getComputedStyle(document.documentElement).getPropertyValue("--judge-good");
      document.body.appendChild(s);
      const want = (getComputedStyle(s).color.match(/\d+/g) || []).map(Number);
      s.remove();
      return { got: [d[0], d[1], d[2]], want, token: getComputedStyle(document.documentElement).getPropertyValue("--judge-good").trim() };
    }, "b8");
    assert(!!b.token && close(b.got, b.want, 12), "A4：妙着的 !! 画在目标格角上，用 --judge-good（" + b.got + " vs " + b.want + "）");
  }

  // (5) the move list, coloured by grade
  {
    const ml = await pg.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => { const d = document.createElement("span"); d.style.color = v; document.body.appendChild(d);
        const c = getComputedStyle(d).color; d.remove(); return c; };
      // 9.0 V1: the move the board stands on is the accent fill with
      // --on-accent ink, graded or not (colour on colour otherwise), so
      // the grade colours are read off the other moves
      const cur = document.querySelector("#move-list .mlmove.current");
      const curInk = cur ? getComputedStyle(cur).color : null;
      // the opera game's one !! is its last move, where the board stands:
      // read the grade colours with the highlight lifted for a moment
      if (cur) cur.classList.remove("current");
      const one = (g) => { const e = document.querySelector("#move-list .mlmove.g-" + g); return e ? getComputedStyle(e).color : null; };
      const graded = { bad: one("blunder"), good: one("brilliant"), best: one("best") };
      if (cur) cur.classList.add("current");
      return { ...graded,
        wantBad: rgb(css.getPropertyValue("--judge-bad")), wantGood: rgb(css.getPropertyValue("--judge-good")),
        cur: curInk, wantCur: rgb(css.getPropertyValue("--on-accent")),
        n: document.querySelectorAll("#move-list .mlmove[class*=' g-']").length };
    });
    assert(ml.n === OPERA.length, "A4：棋谱里每一着都带分级（" + ml.n + " / " + OPERA.length + "）");
    assert(!!ml.bad && ml.bad === ml.wantBad && ml.good === ml.wantGood && ml.best !== ml.wantBad,
      "A4：棋谱按分级着色 —— ?? 是 --judge-bad，!! 是 --judge-good（" + [ml.bad, ml.good, ml.best].join(" / ") + "）");
    assert(!!ml.cur && ml.cur === ml.wantCur, "9.0 V1：当前着是强调色底、--on-accent 字（" + ml.cur + " / " + ml.wantCur + "）");
  }

  // (6) key moments: three a side, stepped through, each with its three actions
  {
    const km = () => pg.evaluate(() => {
      const box = document.getElementById("rv-km");
      if (!box || box.hidden) return null;
      return { pos: (box.querySelector(".km-pos") || {}).textContent, ply: Number((box.querySelector(".km-card") || { dataset: {} }).dataset.ply),
        acts: [...box.querySelectorAll(".km-acts button")].filter((b) => !b.hidden).map((b) => b.dataset.act),
        why: (box.querySelector(".km-why:not([hidden])") || {}).textContent || "",
        what: (box.querySelector(".km-what") || {}).textContent || "" };
    });
    // back to the first moment with the card's own key
    for (let i = 0; i < 6 && await pg.evaluate(() => { const b = document.querySelector("#rv-km .km-prev"); return !!b && !b.disabled; }); i++) {
      await pg.click("#rv-km .km-prev");
      await settle(pg);
    }
    const k0 = await km();
    assert(!!k0 && /^1 \/ [2-6]$/.test(k0.pos || ""), "A4：关键时刻可以翻看（" + (k0 && k0.pos) + "）");
    const total = k0 ? Number(k0.pos.split("/")[1]) : 0;
    const seen = [], kinds = [];
    for (let i = 0; i < total; i++) {
      if (i > 0) { await pg.click("#rv-km .km-next"); await settle(pg); }
      const k = await km();
      seen.push(k.ply);
      kinds.push(k.what);
      const at = await vi();
      assert(at === k.ply + 1, "A4：翻到第 " + (i + 1) + " 个关键时刻，棋盘停在那一步之后（" + at + " = " + (k.ply + 1) + "）");
    }
    // v10-0-plan A2: the three kinds of moment — a mistake, a chance missed,
    // a brilliant move — each turn up in the Opera game's
    assert(kinds.some((x) => /失误/.test(x)) && kinds.some((x) => /错失良机/.test(x)) && kinds.some((x) => /妙着/.test(x)),
      "A2：关键时刻里失误、错失良机、妙着各有一个（" + kinds.join(" / ") + "）");
    // (without the card there is nothing further to step through)
    if (k0) {
      const wSide = seen.filter((p) => p % 2 === 0).length, bSide = seen.filter((p) => p % 2 === 1).length;
      assert(wSide <= 3 && bSide <= 3 && wSide >= 1 && bSide >= 1 && new Set(seen).size === seen.length,
        "A4：每方最多 3 个，两方都有（白 " + wSide + " · 黑 " + bSide + "）");
      const worst = T.indexOf("??");
      for (let i = 0; i < total && (await km()).ply !== worst; i++) { await pg.click("#rv-km .km-prev"); await settle(pg); }
      const k = await km();
      assert(k.ply === worst && ["why", "retry", "lines"].every((a) => k.acts.includes(a)),
        "A4：每个关键时刻都有「为什么」「再试一次」「看引擎线」（" + k.acts.join(", ") + "）");
      // v10-0-plan A2: 为什么 is open as the moment comes up — no click
      const why = (await km()).why;
      assert(/\d+%/.test(why) && why.length > 16, "A4 / A2：「为什么」默认展开，说清这一着让胜率掉了多少，再给出教练的解释（" + why + "）");
      await pg.click('#rv-km button[data-act="why"]');
      await settle(pg);
      assert((await km()).why === "", "A2：再点「为什么」收起");
      await pg.click('#rv-km button[data-act="why"]');
      await settle(pg);
      await pg.click('#rv-km button[data-act="lines"]');
      await settle(pg);
      const lines = await pg.evaluate(() => ({ pv: !document.getElementById("pv-line").hidden,
        rows: document.querySelectorAll("#pv-line .pv-row").length }));
      const at = await vi();
      assert(at === worst && lines.pv && lines.rows >= 1,
        "A4：「看引擎线」停在失着之前的局面，引擎线就在眼前（" + at + "，" + lines.rows + " 行）");
      await goto(worst + 1);
      await pg.click('#rv-km button[data-act="retry"]');
      await settle(pg);
      const rt = await pg.evaluate(() => ({ shown: !document.getElementById("retry-box").hidden, ask: (document.querySelector("#retry-box .rt-ask") || {}).textContent }));
      assert(rt.shown && /再试一次/.test(rt.ask || ""), "A4：「再试一次」从这个关键时刻开始（" + rt.ask + "）");
      await pg.click("#rt-back").catch(() => {});
      await settle(pg);
      // Codex #89: a graded moment that is no mistake (the brilliancy) has a
      // retry too, and once it is judged the board draws the best move's arrow
      const bril = G.indexOf("brilliant");
      const bests = await pg.evaluate(() => { const k = JSON.parse(localStorage.getItem("chess.analyses") || "null");
        const e = k && k.list && k.list[k.list.length - 1]; return e ? e.an.bests : null; });
      const can = (sel) => pg.evaluate((q) => { const b = document.querySelector(q); return !!b && !b.disabled; }, sel);
      while (await can("#rv-km .km-prev")) { await pg.click("#rv-km .km-prev"); await settle(pg); }
      while ((await km()).ply !== bril && await can("#rv-km .km-next")) { await pg.click("#rv-km .km-next"); await settle(pg); }
      const kb = await km();
      if (kb && kb.ply === bril && kb.acts.includes("retry") && bests && bests[bril]) {
        await pg.click('#rv-km button[data-act="retry"]');
        await settle(pg);
        // a move that is not the brilliancy: judged wrong, and the answer is drawn
        const pos = new Chess();
        for (const x of OPERA.slice(0, bril)) pos.move(x);
        const mv = pos.moves({ verbose: true }).find((x) => x.from + x.to !== bests[bril].slice(0, 4) && !x.promotion);
        for (const sq of [mv.from, mv.to]) {
          const c = await pg.evaluate((q) => { const r = document.getElementById("board").getBoundingClientRect();
            return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(q[1]) + 0.5) * (r.height / 8) }; }, sq);
          await pg.mouse.click(c.x, c.y);
          await settle(pg);
        }
        await pg.waitForFunction(() => { const v = document.querySelector("#retry-box .rt-verdict"); return v && /is-(right|wrong|ok)/.test(v.className); }, null, { timeout: 20000 }).catch(() => {});
        await settle(pg);
        const want = bests[bril].slice(0, 2) + bests[bril].slice(2, 4);
        const hint = await pg.evaluate(() => window.__chess.board().hint);
        assert(hint === want, "A4：妙着这个关键时刻「再试一次」走错判完之后，棋盘上画出最佳着的箭头（" + want + "）", String(hint));
        // #89 review: the brilliancy itself, found again — judged right, and
        // the panel does not go on to say 「更好的是」 the move just played
        await pg.click("#rt-again");
        await settle(pg);
        for (const sq of [want.slice(0, 2), want.slice(2, 4)]) {
          const c = await pg.evaluate((q) => { const r = document.getElementById("board").getBoundingClientRect();
            return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(q[1]) + 0.5) * (r.height / 8) }; }, sq);
          await pg.mouse.click(c.x, c.y);
          await settle(pg);
        }
        await pg.waitForFunction(() => { const v = document.querySelector("#retry-box .rt-verdict"); return v && /is-right/.test(v.className); }, null, { timeout: 20000 }).catch(() => {});
        const found = await pg.evaluate(() => ({ verdict: (document.querySelector("#retry-box .rt-verdict") || {}).className || "",
          best: (document.querySelector("#retry-box .rt-best") || {}).textContent || "",
          why: (document.querySelector("#retry-box .rt-why") || {}).textContent || "" }));
        assert(/is-right/.test(found.verdict) && /引擎的最佳/.test(found.best) && found.why === "",
          "A4：妙着「再试一次」走对了，面板不再说「更好的是」刚走的这步（" + JSON.stringify(found) + "）");
        await pg.click("#rt-back").catch(() => {});
        await settle(pg);
      } else assert(false, "A4：妙着是一个关键时刻，而且能「再试一次」", JSON.stringify({ kb, bril }));
      // #89 review: two moments on consecutive plies (the fixture has one:
      // plies 11 and 12). 看引擎线 on the later one stands the board after the
      // earlier one's move, which is where the card follows the board to the
      // earlier moment: the card stays on its own moment, 为什么 still open
      const later = seen.find((p) => seen.includes(p - 1));
      if (later != null) {
        while (await can("#rv-km .km-prev")) { await pg.click("#rv-km .km-prev"); await settle(pg); }
        while ((await km()).ply !== later && await can("#rv-km .km-next")) { await pg.click("#rv-km .km-next"); await settle(pg); }
        await pg.click('#rv-km button[data-act="lines"]');
        await settle(pg);
        const kl = await km();
        const atL = await vi();
        assert(atL === later && kl.ply === later && kl.why !== "",
          "A4：相邻两步都是关键时刻，在后一个上点「看引擎线」，卡片不跳到前一个、「为什么」还开着（" + JSON.stringify({ at: atL, ply: kl.ply, later, why: !!kl.why }) + "）");
        // …and the board moving on by itself turns the card again
        await goto(later);
        await pg.evaluate(() => document.getElementById("rep-prev").click());
        await settle(pg);
        await pg.evaluate(() => document.getElementById("rep-next").click());
        await settle(pg);
        const kf = await km();
        assert(kf.ply === later - 1, "A4：之后棋盘自己走到前一个关键时刻之后，卡片照样跟过去（" + kf.ply + "）");
      } else assert(false, "A4：夹具里有相邻两步的关键时刻", JSON.stringify(seen));
    }
  }

  // (7) 从错误中学: every ? and ?? of this game, one after another, through 再试一次
  {
    const plies = T.map((t, i) => (t === "?" || t === "??" ? i : -1)).filter((i) => i >= 0);
    const learn = await pg.evaluate(() => { const b = document.getElementById("rv-learn"); return b && b.offsetParent ? b.textContent : null; });
    assert(!!learn && learn.includes(String(plies.length)), "A4：「从错误中学」写着本局有几处可练（" + learn + " · " + plies.length + "）");
    if (learn) {
      await pg.click("#rv-learn");
      await settle(pg);
    }
    const visited = [];
    for (let k = 0; learn && k < plies.length; k++) {
      const st = await pg.evaluate(() => ({ prog: (document.querySelector("#retry-box .rt-prog") || {}).textContent || "",
        at: Number(document.getElementById("eval-curve").getAttribute("aria-valuenow")) }));
      visited.push(st.at);
      assert(st.prog.includes((k + 1) + " / " + plies.length), "A4：从错误中学第 " + (k + 1) + " 题，进度写着（" + st.prog + "）");
      // the same mistake again: judged at once, no engine needed
      const again = new Chess();
      for (const s of OPERA.slice(0, st.at)) again.move(s);
      const m = again.move(OPERA[st.at]);
      if (!m) break;
      for (const sq of [m.from, m.to]) {
        const c = await pg.evaluate((s) => { const r = document.getElementById("board").getBoundingClientRect();
          return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) }; }, sq);
        await pg.mouse.click(c.x, c.y);
        await settle(pg);
      }
      await settle(pg);
      const v = await pg.evaluate(() => (document.querySelector("#retry-box .rt-verdict") || {}).className || "");
      assert(/is-wrong/.test(v), "A4：又走了一遍原来的失着，判「不对」（" + v + "）");
      const next = await pg.evaluate(() => { const b = document.getElementById("rt-next"); return b ? b.textContent : null; });
      assert(!!next, "A4：判完有「下一个」（" + next + "）");
      if (!next) break;
      await pg.click("#rt-next");
      await settle(pg);
    }
    assert(JSON.stringify(visited) === JSON.stringify(plies), "A4：按顺序走遍本局每一处 ? 与 ??（" + visited + " = " + plies + "）");
    const end = await pg.evaluate(() => ({ retry: !document.getElementById("retry-box").hidden, toast: document.getElementById("toast").textContent }));
    assert(!end.retry && /0 \/ \d/.test(end.toast), "A4：练完收尾，说清找对了几处（" + end.toast + "）");
  }

  // (8) 重下 is renamed and stands apart from 再试一次
  {
    await goto(10);
    const r = await pg.evaluate(() => {
      const b = document.getElementById("retry-here");
      const tries = [...document.querySelectorAll("button")].filter((x) => x.offsetParent && /再试一次/.test(x.textContent));
      const rb = b.getBoundingClientRect();
      const gap = Math.min(...tries.map((x) => Math.abs(x.getBoundingClientRect().top - rb.top)));
      return { text: b.textContent.trim(), shown: !!b.offsetParent, inReview: !!b.closest("#review-actions"),
        sibling: [...b.parentElement.children].some((x) => /再试一次/.test(x.textContent)), gap, tries: tries.length };
    });
    assert(r.shown && r.text !== "重下" && !/再|重/.test(r.text), "A4：「重下」改了名（「" + r.text + "」）");
    assert(!r.inReview && !r.sibling && (r.tries === 0 || r.gap > 40),
      "A4：它不在复盘那排，也不和「再试一次」挨着（相距 " + r.gap + "px）");
  }

  // (9) no dashed placeholder cards in the review
  {
    const dashed = await pg.evaluate(() => [...document.querySelectorAll("#eval-wrap *, #review-actions *")]
      .filter((e) => e.offsetParent && /dashed/.test(getComputedStyle(e).borderTopStyle + getComputedStyle(e).borderLeftStyle))
      .map((e) => e.className || e.tagName));
    assert(dashed.length === 0, "A4：复盘里没有虚线占位卡片" + (dashed.length ? " — " + dashed.join(", ") : ""));
  }

  // (10) the eval bar sits level with the board's frame, flat and framed
  for (const frame of ["flat", "frame"]) {
    await pg.evaluate((f) => { const b = document.querySelector('#frame-seg button[data-frame="' + f + '"]'); if (b) b.click(); }, frame);
    await settle(pg);
    const g = await pg.evaluate(() => {
      const r = (id) => document.getElementById(id).getBoundingClientRect();
      const w = r("board-wrap"), b = r("eval-bar"), c = r("board");
      return { wt: w.top, wb: w.bottom, bt: b.top, bb: b.bottom, br: b.right, cl: c.left };
    });
    assert(Math.abs(g.bt - g.wt) <= 1 && Math.abs(g.bb - g.wb) <= 1 && g.br <= g.cl + 1,
      "A4：评估条与棋盘外框对齐（" + frame + "：框 " + Math.round(g.wt) + "–" + Math.round(g.wb) + "，条 " + Math.round(g.bt) + "–" + Math.round(g.bb) + "），不压在格子上");
  }
  await pg.evaluate(() => { const b = document.querySelector('#frame-seg button[data-frame="flat"]'); if (b) b.click(); });

  // (11) nothing in the report cut off, in any of the three languages
  for (const lang of ["zh-CN", "en", "ja"]) {
    await pg.evaluate((l) => document.querySelector('#lang-seg button[data-lang="' + l + '"]').click(), lang);
    await pg.waitForTimeout(700);
    await goto(T.indexOf("??") + 1);
    await pg.click('#rv-km button[data-act="why"]').catch(() => {});
    await settle(pg);
    const cut = await pg.evaluate(() => {
      const side = document.getElementById("side").getBoundingClientRect();
      const out = [];
      for (const e of document.querySelectorAll("#eval-wrap *, #line-row *, #review-actions *")) {
        if (!e.offsetParent || e.tagName === "CANVAS") continue;
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (r.right > side.right + 1) out.push("past:" + (e.id || e.className) + ":" + e.textContent.slice(0, 20));
        else if (e.scrollWidth > e.clientWidth + 1 && cs.overflowX !== "visible" && cs.overflowX !== "auto" && !e.closest(".pv-row")) {
          out.push("clip:" + (e.id || e.className) + ":" + e.textContent.slice(0, 20));
        }
        // a button is one line: the label is the thing, never half of it
        if (e.tagName === "BUTTON" && !e.childElementCount && e.closest("#rv-km, #line-row, #review-actions, #rv-learn-row")) {
          const range = document.createRange();
          range.selectNodeContents(e);
          const lines = new Set([...range.getClientRects()].map((x) => Math.round(x.top))).size;
          if (lines > 1) out.push("wrap:" + e.textContent.trim());
        }
      }
      return out;
    });
    assert(cut.length === 0, "A4：" + lang + " 下复盘报告没有截断或折行" + (cut.length ? " — " + cut.slice(0, 5).join(" / ") : ""));
  }
  assert(errsA.length === 0, "A4：全程没有页面异常 — " + errsA.join(" / "));
  await ctxA.close();
}

// --- 9.0 M2：人机对局的一句话总结用对手的口吻 ----------------------------------
// The Opera game, pasted while the mode is 人机 against 莉娜 (练习 · 重原则)
// with you on Black: the summary is hers, about your largest fall in win
// chance (9… b5 in the fixture), in facts — the move and the win chance.
{
  const ctxM = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await ctxM.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", difficulty: "learner", personaId: "principled",
      humanColor: "b", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", view: "play" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__clip = "";
    window.zero = {
      invoke: () => Promise.resolve(true), on: () => () => {}, off: () => {},
      platform: { supports: () => Promise.resolve(false) },
      clipboard: { readText: () => Promise.resolve(window.__clip), writeText: () => Promise.resolve(true) },
    };
  });
  const pg = await ctxM.newPage();
  const errsM = [];
  pg.on("pageerror", (e) => errsM.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const pgn = '[Event "Opera"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n' +
    OPERA.map((s, i) => (i % 2 ? "" : (i / 2 + 1) + ". ") + s).join(" ") + " 1-0\n";
  await pg.evaluate((x) => { window.__clip = x; }, pgn);
  if (await pg.evaluate(() => !!document.getElementById("more-row").hidden)) { await pg.click("#more-tools"); await settle(pg); }
  await pg.click("#pgn-paste");
  await pg.waitForTimeout(900);
  if (await pg.isVisible("#confirm-modal.show").catch(() => false)) { await pg.click("#confirm-ok"); await pg.waitForTimeout(700); }
  // the engine this server sends is a stub: in 人机 the boot fails and says
  // so; a scripted one that is ready, and the notice's 重试, bring 分析 back
  await pg.evaluate(() => {
    const E = window.__chess.engine;
    E.init = () => Promise.resolve(); E.retry = () => {}; E.isReady = () => true;
    const b = document.querySelector("#engine-fault .toast-action");
    if (b) b.click();
  });
  await settle(pg);
  await analyseOpera(pg);
  const s = await pg.evaluate(() => { const e = document.getElementById("rv-summary"); return e && !e.hidden ? e.textContent : null; });
  assert(!!s && /^莉娜：这盘最要紧的是第 9 步——你的胜率从 \d+% 掉到 \d+%。$/.test(s),
    "M2：人机对局的总结是对手说的，讲你掉得最多的那一步（「" + s + "」）");
  // v10-0-plan T4: with no Black book, the report offers to keep this
  // game's opening; kept, it points at the first move the book stops before
  if (!(await pg.evaluate(() => document.getElementById("rv-full").open))) await pg.click("#rv-full > summary");
  const bookNote = () => pg.evaluate(() => { const e = document.querySelector("#review-body .rv-book"); return e ? e.textContent : ""; });
  const n0 = await bookNote();
  assert(/你还没有执黑的开局书/.test(n0) && /加入开局书/.test(n0), "T4：复盘里，没有执黑开局书时提议把这局的开局记下来", n0);
  await pg.click("#review-body .rv-book button");
  await pg.waitForTimeout(900);
  const n1 = await bookNote();
  assert(/第 7 回合的 Qe7，你的开局书还没写到这里/.test(n1), "T4：记下之后，指出开局书还没写到的那一步（第 7 回合 Qe7）", n1);
  assert(errsM.length === 0, "M2：人机总结全程没有页面异常 — " + errsM.join(" / "));
  await ctxM.close();
}

// --- v10-0-plan A1: 分析一局 — a PGN, a Lichess link, a blank analysis board ---
{
  const ctxA = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await ctxA.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", difficulty: "casual", humanColor: "w", langId: "zh-CN", soundOn: false, view: "home" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  await ctxA.addInitScript(() => {
    window.__asked = [];
    window.zero = {
      invoke: (name, p) => {
        window.__asked.push([name, p]);
        if (name === "chess.fetchGames") return Promise.resolve({ pgn: window.__lichessPgn || "", count: 1 });
        return Promise.resolve(true);
      },
      on: () => () => {}, off: () => {}, platform: { supports: () => Promise.resolve(false) },
      clipboard: { readText: () => Promise.resolve(""), writeText: () => Promise.resolve(true) },
    };
  });
  const pg = await ctxA.newPage();
  const errsA = [];
  pg.on("pageerror", (e) => errsA.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await pg.evaluate(() => { const E = window.__chess.engine; E.init = () => Promise.resolve(); E.retry = () => {}; E.isReady = () => true; });
  await scriptOpera(pg);
  const pgn = '[Event "Opera"]\n[White "Morphy"]\n[Black "Allies"]\n[Result "1-0"]\n\n' +
    OPERA.map((x, i) => (i % 2 ? "" : (i / 2 + 1) + ". ") + x).join(" ") + " 1-0\n";
  const note = () => pg.evaluate(() => { const n = document.getElementById("an-note"); return n.hidden ? "" : n.textContent; });
  // a Chess.com link: no single-game export — the dialog says what to do instead
  await pg.click("#today-analyse");
  await pg.fill("#an-text", "https://www.chess.com/game/live/123456789");
  await pg.click("#an-go");
  assert(/分享/.test(await note()), "A1：Chess.com 链接 —— 说明去「分享」里复制 PGN", await note());
  // a Lichess link with the network off: the switch it needs, one click away
  await pg.fill("#an-text", "https://lichess.org/q7ZvsdUFab12");
  await pg.click("#an-go");
  assert(/设置 · 数据/.test(await note()) && await pg.isVisible("#an-net"), "A1：Lichess 链接、没开联网 —— 说要开哪个开关，带去设置的按钮", await note());
  // PGN: on the board, analysed, the report up — in one click; an engine game
  // still, but the engine does not play on in it, and it is not filed
  await pg.fill("#an-text", pgn);
  await pg.click("#an-go");
  await pg.waitForFunction(() => !document.getElementById("report-card").hidden, null, { timeout: 20000 }).catch(() => {});
  const a1 = await pg.evaluate(() => ({ view: document.getElementById("app").getAttribute("data-view"),
    modal: document.getElementById("analyse-modal").classList.contains("show"),
    report: !document.getElementById("report-card").hidden, plies: document.querySelectorAll(".move-list .mlmove").length,
    games: (JSON.parse(localStorage.getItem("chess.stats") || "{}").games || []).length,
    mines: ((JSON.parse(localStorage.getItem("chess.mines") || "null") || {}).list || []).length }));
  assert(a1.view === "play" && !a1.modal && a1.report && a1.plies === OPERA.length && a1.games === 0,
    "A1：粘贴 PGN、点「分析」—— 一步就在棋盘上、报告出来了，不进战绩", JSON.stringify(a1));
  // a pasted game has no "you": the board's humanColor (w here) is not a side
  // of it, so none of its mistakes become drills (Codex on #113)
  assert(a1.mines === 0, "A1：粘贴的对局不知道哪一方是你 —— 不把它的失误收进「我的错题」", JSON.stringify(a1));
  // the same link with the network on: the native side is asked for that one game
  // (the settings are read at launch: the switch is turned on, and the page opened again)
  await pg.evaluate(() => { localStorage.setItem("chess.sync", JSON.stringify({ v: 1, on: true, site: "lichess", user: "" })); });
  await pg.reload();
  await pg.waitForTimeout(900);
  await pg.evaluate((x) => { window.__lichessPgn = x; const E = window.__chess.engine; E.init = () => Promise.resolve(); E.retry = () => {}; E.isReady = () => true; }, pgn);
  await scriptOpera(pg);
  await pg.click('#rail button[data-view="library"]');
  await pg.click("#lib-analyse-one");
  await pg.fill("#an-text", "https://lichess.org/q7ZvsdUF/black#12");
  await pg.click("#an-go");
  await pg.waitForTimeout(700);
  if (await pg.isVisible("#confirm-modal.show").catch(() => false)) { await pg.click("#confirm-ok"); await pg.waitForTimeout(700); }
  await pg.waitForFunction(() => !document.getElementById("report-card").hidden, null, { timeout: 20000 }).catch(() => {});
  const asked = await pg.evaluate(() => window.__asked.filter(([n]) => n === "chess.fetchGames").map(([, p]) => p));
  assert(asked.length === 1 && asked[0].site === "lichess" && asked[0].game === "q7ZvsdUF",
    "A1：开了联网，Lichess 链接取的是那一局（只送 8 位编号）", JSON.stringify(asked));
  // the blank analysis board: a game on the board is asked about first
  await pg.click('#rail button[data-view="home"]');
  await pg.click("#today-analyse");
  await pg.click("#an-board");
  await settle(pg);
  const asks = await pg.isVisible("#confirm-modal.show").catch(() => false);
  if (asks) { await pg.click("#confirm-ok"); await pg.waitForTimeout(600); }
  const b = await pg.evaluate(() => ({ view: document.getElementById("app").getAttribute("data-view"),
    plies: document.querySelectorAll(".move-list .mlmove").length, mode: JSON.parse(localStorage.getItem("chess.settings") || "{}").mode,
    toast: document.getElementById("toast").textContent }));
  assert(b.view === "play" && b.plies === 0 && b.mode === "pvp" && /分析棋盘/.test(b.toast),
    "A1：空白分析棋盘 —— 回到开局局面、双方都由你走，说明它不计入战绩", JSON.stringify(b));
  // from a trainer (⌘K while a puzzle is up), back to an ai board: the switch
  // used to clear the analysis flag, and the engine answered in the imported
  // game (Codex on #113, #114). Eleven plies: Black to move, the engine's side.
  await pg.evaluate(() => { const st = JSON.parse(localStorage.getItem("chess.settings") || "{}"); st.mode = "puzzle"; st.playMode = "ai"; localStorage.setItem("chess.settings", JSON.stringify(st)); });
  await pg.reload();
  await pg.waitForTimeout(900);
  await pg.evaluate(() => { const E = window.__chess.engine; E.init = () => Promise.resolve(); E.retry = () => {}; E.isReady = () => true; });
  await scriptOpera(pg);
  // the engine's game move, counted: the switch back to an ai board schedules
  // one before the flag is set, and the flag alone did not cancel it (Codex on #114)
  await pg.evaluate(() => { window.__best = 0; window.__chess.engine.bestMove = () => { window.__best++; return Promise.resolve("d8d7"); }; });
  await pg.keyboard.press("Control+k");
  await pg.waitForSelector("#palette-modal.show", { timeout: 4000 });
  await pg.fill("#palette-input", "分析一局");
  await pg.keyboard.press("Enter");
  await pg.waitForSelector("#analyse-modal.show", { timeout: 4000 });
  const pgn11 = '[Event "Opera"]\n[White "Morphy"]\n[Black "Allies"]\n[Result "*"]\n\n' +
    OPERA.slice(0, 11).map((x, i) => (i % 2 ? "" : (i / 2 + 1) + ". ") + x).join(" ") + " *\n";
  await pg.fill("#an-text", pgn11);
  await pg.click("#an-go");
  await pg.waitForTimeout(700);
  if (await pg.isVisible("#confirm-modal.show").catch(() => false)) { await pg.click("#confirm-ok"); await pg.waitForTimeout(700); }
  await pg.waitForFunction(() => !document.getElementById("report-card").hidden, null, { timeout: 20000 }).catch(() => {});
  await pg.waitForTimeout(1200);
  const tr = await pg.evaluate(() => ({ plies: document.querySelectorAll(".move-list .mlmove").length,
    mode: JSON.parse(localStorage.getItem("chess.settings") || "{}").mode, analysis: window.__chess.analysisBoard(), best: window.__best }));
  assert(tr.plies === 11 && tr.mode === "ai" && tr.analysis && tr.best === 0, "A1：从谜题里 ⌘K「分析一局」—— 回到棋盘、仍是分析（引擎不接着走，至少三条线）", JSON.stringify(tr));
  assert(errsA.length === 0, "A1：没有页面异常 — " + errsA.join(" / "));
  await ctxA.close();
}

// --- v8-2-plan T3: 名局猜着 — a whole classic guessed, scored, and again ---
// Morphy's Opera game as White, 17 guesses, against a scripted engine keyed
// by position: every position after one of the master's moves is level (50%),
// and the two deliberate deviations are worth known numbers — so the loss,
// the grade and the card's figures can be asserted exactly, with review.js's
// own curve. Three passes: all the master's moves (full marks, no engine
// call at all), two deviations (a 失误 and a 良好), and the same again (the
// same scores, and not one more engine call: the verdicts are kept).
{
  const ctxG = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctxG.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "learn", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctxG.newPage();
  const errsG = [];
  pg.on("pageerror", (e) => errsG.push(e.message));
  const from = served.length;
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  assert(!served.slice(from).includes("/js/chunk-guess.js"), "T3：首屏不取 chunk-guess.js");
  await toGuessList(pg);
  // v8-4-plan T2: ten from the bundle, thirty more once chunk-classics-more.js is in
  await pg.waitForFunction(() => document.querySelectorAll("#lesson-list button[data-gs]").length === 40, null, { timeout: 8000 }).catch(() => {});
  const entries = await pg.evaluate(() => [...document.querySelectorAll("#lesson-list button[data-gs]")].map((b) => b.textContent));
  assert(entries.length === 40, "T2（8.4）：学习目录里 40 局名局都能猜（" + entries.length + "）");
  assert(served.slice(from).includes("/js/chunk-classics-more.js"), "T2（8.4）：目录画出来以后才取 chunk-classics-more.js");
  // 9.0 S3: one list of the forty (read or guessed is the switch): the ten
  // under 名局, the thirty under their four eras
  const eras = await pg.evaluate(() => [...document.querySelectorAll("#lesson-list .lesson-part")].map((h) => h.textContent));
  assert(eras.length === 5 && eras[0] === "名局" && new Set(eras).size === 5 && eras.slice(1).every((x) => x && x !== "名局"),
    "T2（8.4）：名局按时代分组（" + eras.join(" | ") + "）");

  // the scripted engine: White-view cp by position (the first four FEN fields)
  const master = [];
  const dev = {};
  {
    const g = new Chess();
    for (const san of OPERA) { const m = g.move(san); master.push(m.from + m.to + (m.promotion || "")); }
    const at = (ply, uci) => {
      const p = new Chess();
      for (const san of OPERA.slice(0, ply)) p.move(san);
      p.move({ from: uci.slice(0, 2), to: uci.slice(2, 4) });
      return p.fen().split(" ").slice(0, 4).join(" ");
    };
    // 3.Nc3 for 3.d4: 200 cp worse — 17.6 points, a 失误; 7.Nc3 for 7.Qb3: 30 cp — 2.8, 良好
    dev[4] = { uci: "b1c3", cp: -200, fen: at(4, "b1c3"), san: "3. Nc3", mSan: "3. d4" };
    dev[12] = { uci: "b1c3", cp: -30, fen: at(12, "b1c3"), san: "7. Nc3", mSan: "7. Qb3" };
  }
  const table = Object.fromEntries(Object.values(dev).map((x) => [x.fen, x.cp]));
  await pg.evaluate((tb) => {
    window.__gsCalls = [];
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = async (fen, budget, opts) => {
      window.__gsCalls.push({ budget, bg: !!(opts && opts.bg) });
      const turn = fen.split(" ")[1];
      const cpW = tb[fen.split(" ").slice(0, 4).join(" ")] || 0;
      return { cp: turn === "w" ? cpW : -cpW, mate: null, turn, best: null, pv: [], lines: [] };
    };
  }, table);

  const loss = (cp) => ChessReview.winPctDrop(0, cp, "w");
  const l1 = loss(dev[4].cp), l2 = loss(dev[12].cp);
  const r1 = (x) => (Math.round(x * 10) / 10).toFixed(1);
  assert(l1 >= ChessReview.WIN_MISTAKE && l1 < ChessReview.WIN_BLUNDER && l2 >= 2 && l2 < ChessReview.WIN_INACCURACY,
    "T3：两处偏差的胜率差落在失误（" + r1(l1) + "）与良好（" + r1(l2) + "）两档");

  const xy = (sq, flipped) => pg.evaluate(([q, f]) => {
    const r = document.getElementById("board").getBoundingClientRect();
    let fi = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
    if (f) { fi = 7 - fi; rk = 7 - rk; }
    return { x: r.left + (fi + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, [sq, flipped]);
  const tap = async (sq, flipped) => { const c = await xy(sq, flipped); await pg.mouse.click(c.x, c.y); };
  const panel = () => pg.evaluate(() => {
    const p = document.getElementById("gs-panel");
    const txt = (id) => { const e = document.getElementById(id); return e && !e.hidden ? e.textContent : ""; };
    return p ? { phase: p.dataset.phase, at: Number(p.dataset.at), view: p.dataset.view, say: txt("gs-say"), sum: txt("gs-sum"),
      worst: txt("gs-worst"), jump: !document.getElementById("gs-jump").hidden, task: document.getElementById("lesson-task").textContent,
      // 10.0 M0: the title says which side you guess; the game is the strip's
      title: document.getElementById("lesson-title").textContent, game: document.getElementById("lesson-title").dataset.strip || "" } : null;
  });
  const waitGs = (pred, arg) => pg.waitForFunction(pred, arg, { timeout: 10000 }).then(() => true, () => false);
  const waitAt = (ply, phase = "guess") => waitGs(([p, ph]) => {
    const e = document.getElementById("gs-panel");
    return !!e && e.dataset.at === String(p) && e.dataset.phase === ph;
  }, [ply, phase]);

  /** One pass as White; `devs` names the plies guessed differently. @returns the verdict lines */
  const playWhite = async (devs) => {
    const says = [];
    for (let ply = 0; ply < OPERA.length; ply += 2) {
      if (!(await waitAt(ply))) { says.push("stuck at " + ply); break; }
      const u = devs[ply] ? devs[ply].uci : master[ply];
      await tap(u.slice(0, 2)); await tap(u.slice(2, 4));
      // the verdict is in once the ply has moved on
      await waitGs((p) => { const e = document.getElementById("gs-panel"); return Number(e.dataset.at) > p; }, ply);
      says.push((await panel()).say);
    }
    await waitAt(OPERA.length, "done");
    return says;
  };

  // (1) the master's moves throughout: full marks, and the engine never asked
  await pg.evaluate(() => {
    document.querySelector("#sec-learn details.reading-index").open = true;
    document.querySelector('#lesson-list button[data-gs="0"]').click();
  });
  assert(await waitAt(0), "T3：点开第一局，轮到白方猜第 1 手");
  assert(served.slice(from).includes("/js/chunk-guess.js"), "T3：第一次开始时才取 chunk-guess.js");
  let p = await panel();
  assert(/猜白方的着法/.test(p.title) && /1858/.test(p.game), "T3：卡片标题是猜白方，玩家栏上是这一局（" + p.title + " / " + p.game + "）");
  assert(/轮到你猜 1\./.test(p.task), "T3：任务行说轮到你猜第 1 手（" + p.task + "）");
  const live = await pg.evaluate(() => { const e = document.getElementById("gs-say"); return e.getAttribute("aria-live") + "/" + e.getAttribute("role"); });
  assert(live === "polite/status", "T3：「你走的 / 大师走的 / 得分」是读屏会读的 live 区域（" + live + "）");
  // (0) the other side, by keyboard alone: 1.e4 is played for you, then 1…e5
  // on the cursor of the turned board (before any click has put a cursor anywhere)
  await pg.evaluate(() => document.getElementById("gs-swap").click());
  assert(await waitAt(1), "T3：换一方后白方先走 1.e4，轮到黑方猜");
  p = await panel();
  assert(/猜黑方的着法/.test(p.title), "T3：标题改成猜黑方（" + p.title + "）");
  await pg.focus("#board");
  const key = async (k) => { await pg.keyboard.press(k); await settle(pg); };
  await key("ArrowDown"); await key("ArrowDown");
  const onE7 = await pg.evaluate(() => (document.getElementById("board-live") || {}).textContent || "");
  assert(/e7/.test(onE7), "T3：棋盘翻过来，↓↓ 把光标从 e5 带到 e7（「" + onE7 + "」）");
  await key("Enter"); await key("ArrowUp"); await key("ArrowUp"); await key("Enter");
  await waitGs(() => Number(document.getElementById("gs-panel").dataset.at) > 1);
  p = await panel();
  assert(/1… e5：和大师一样，满分/.test(p.say), "T3：只用键盘走 1…e5，满分（" + p.say + "）");
  await pg.evaluate(() => document.getElementById("gs-swap").click());
  assert(await waitAt(0), "T3：再换回白方，从第 1 手猜起");
  const run1 = await playWhite({});
  p = await panel();
  assert(run1.length === 17 && run1.every((x) => /和大师一样，满分/.test(x)), "T3：17 步都和原着一样，每步都是满分");
  assert(p.sum === "与大师相同 17/17 · 平均扣分 0.0 · 得分 100.0", "T3：终局卡 17/17、扣 0、100 分（" + p.sum + "）");
  assert(!p.worst && !p.jump, "T3：没有偏差，就没有「最大偏差」和跳转按钮");
  assert((await pg.evaluate(() => window.__gsCalls.length)) === 0, "T3：和原着一样的着法不必问引擎");
  const saved = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.learn") || "{}"));
  assert(saved.gs && saved.gs["morphy-opera-1858"] && saved.gs["morphy-opera-1858"].w.same === 17, "T3：结果记进学习进度（learn 键的 gs）");
  assert(/^✓ /.test(await pg.evaluate(() => document.querySelector('#lesson-list button[data-gs="0"]').textContent)), "T3：猜完的名局在目录里打 ✓");

  // (2) two deviations, through 重来
  await pg.click("#lesson-restart");
  assert(await waitAt(0), "T3：重来回到第 1 手");
  const run2 = await playWhite(dev);
  p = await panel();
  const want1 = "你走 " + dev[4].san + "，大师走 " + dev[4].mSan + " · 失误 · 扣 " + r1(l1) + " 分";
  const want2 = "你走 " + dev[12].san + "，大师走 " + dev[12].mSan + " · 良好 · 扣 " + r1(l2) + " 分";
  assert(run2[2] === want1, "T3：3.Nc3 按胜率差扣分，分级是失误（" + run2[2] + "）");
  assert(run2[6] === want2, "T3：7.Nc3 扣得少，分级是良好（" + run2[6] + "）");
  const avg = (l1 + l2) / 17;
  const wantSum = "与大师相同 15/17 · 平均扣分 " + r1(avg) + " · 得分 " + r1(100 - avg);
  assert(p.sum === wantSum, "T3：终局卡 15/17、平均扣分与得分（" + p.sum + "）");
  assert(p.worst === "最大偏差：你走 3. Nc3，大师走 3. d4，扣 " + r1(l1) + " 分（失误）" && p.jump, "T3：最大偏差是 3.Nc3，带跳转按钮（" + p.worst + "）");
  const calls = await pg.evaluate(() => window.__gsCalls);
  assert(calls.length === 4 && calls.every((c) => c.budget === 200 && !c.bg),
    "T3：每处偏差问引擎两次（大师的着、你的着），都是复盘的 200 预算、不走后台批量（" + JSON.stringify(calls) + "）");
  await pg.click("#gs-jump");
  await settle(pg);
  assert((await panel()).view === "4", "T3：「看这一步」跳到 3.d4 之前的局面");

  // (3) the same guesses again: the same scores, and no new engine call
  await pg.keyboard.press("r");
  assert(await waitAt(0), "T3：R 键重来");
  const run3 = await playWhite(dev);
  const p3 = await panel();
  assert(JSON.stringify(run3) === JSON.stringify(run2) && p3.sum === p.sum && p3.worst === p.worst, "T3：同一局同一种走法，两次计分相同");
  assert((await pg.evaluate(() => window.__gsCalls.length)) === 4, "T3：第二次没有再问引擎（按局面与着法记住了）");

  // (4) the card in three languages
  for (const [lang, sum, worst, han] of [
    ["en", "Same as the master 15/17 · average deduction " + r1(avg) + " · score " + r1(100 - avg), "Biggest deviation: you 3. Nc3, master 3. d4, −" + r1(l1) + " (Mistake)", false],
    ["ja", "名手と同じ 15/17 · 平均減点 " + r1(avg) + " · 得点 " + r1(100 - avg), "最大のずれ：あなた 3. Nc3、名手 3. d4、−" + r1(l1) + "（悪手）", true],
    ["zh-CN", wantSum, p.worst, true],
  ]) {
    await pg.evaluate((l) => document.querySelector('#lang-seg button[data-lang="' + l + '"]').click(), lang);
    await pg.waitForTimeout(900);
    const q = await panel();
    assert(q.sum === sum && q.worst === worst, "T3：" + lang + " 的终局卡（" + q.sum + " / " + q.worst + "）");
    if (!han) {
      const zh = await pg.evaluate(() => (document.getElementById("gs-panel").textContent + document.getElementById("lesson-task").textContent + document.getElementById("lesson-title").textContent).match(/[一-鿿]/g));
      assert(!zh, "T3：英文下猜着卡片里没有中文（" + (zh || []).join("") + "）");
    }
  }

  // (5) quitting mid-game reads the game instead (9.0 S3: 名局's switch to 读谱,
  // where the runner's own 读棋 button was); a reload mid-game is harmless,
  // and so is a learn key whose gs is not an object
  await pg.evaluate(() => document.querySelector('#classic-mode button[data-cmode="read"]').click());
  await settle(pg);
  const quit = await pg.evaluate(() => ({ panel: !!document.getElementById("gs-panel") && !!document.getElementById("gs-panel").offsetParent, title: document.getElementById("lesson-title").textContent }));
  assert(!quit.panel && /1858/.test(quit.title), "T3：「读谱」离开猜着，读这一局（" + quit.title + "）");
  await toGuessList(pg);
  await pg.evaluate(() => document.querySelector('#lesson-list button[data-gs="8"]').click());
  assert(await waitAt(1), "T3：黑胜的一局默认猜黑方");
  await pg.evaluate(() => { const l = JSON.parse(localStorage.getItem("chess.learn")); l.gs = 7; localStorage.setItem("chess.learn", JSON.stringify(l)); });
  await pg.reload();
  await pg.waitForTimeout(1200);
  await toGuessList(pg);
  await pg.evaluate(() => {
    document.querySelector("#sec-learn details.reading-index").open = true;
    document.querySelector('#lesson-list button[data-gs="0"]').click();
  });
  assert(await waitAt(0), "T3：重新载入之后（gs 被改坏）照样能开始猜");

  // (6) v8-4-plan T2: one of the thirty from the chunk — its card reads the
  // game's own paragraph before the first guess, in the reader's language;
  // 读棋 on it shows the paragraph at move 0 and the first note at its ply
  await pg.waitForFunction(() => document.querySelectorAll("#lesson-list button[data-gs]").length === 40, null, { timeout: 8000 }).catch(() => {});
  await pg.evaluate(() => document.querySelector('#lesson-list button[data-gs="10"]').click()); // La Bourdonnais – McDonnell, 0-1
  assert(await waitAt(1), "T2（8.4）：新的一局（黑胜）默认猜黑方");
  const about = await pg.evaluate(() => { const e = document.getElementById("gs-about"); return e && !e.hidden ? e.textContent : ""; });
  assert(/1834/.test(about), "T2（8.4）：猜第一步之前，卡片上有这一局的开场白（" + about.slice(0, 30) + "…）");
  const title10 = (await panel()).game;
  assert(/德拉布尔多内/.test(title10) && /1834/.test(title10), "T2（8.4）：玩家栏上是新的一局（" + title10 + "）");
  await pg.evaluate(() => document.querySelector('#lang-seg button[data-lang="en"]').click());
  await pg.waitForTimeout(600);
  const aboutEn = await pg.evaluate(() => document.getElementById("gs-about").textContent);
  assert(/La Bourdonnais/.test(aboutEn) && !/[一-鿿]/.test(aboutEn + (await panel()).title + (await panel()).game), "T2（8.4）：英文下开场白与标题是英文（" + aboutEn.slice(0, 40) + "…）");
  await pg.evaluate(() => document.querySelector('#lang-seg button[data-lang="zh-CN"]').click());
  await pg.waitForTimeout(600);
  await pg.click('#classic-mode button[data-cmode="read"]');   // 9.0 S3: 读谱, the switch
  await settle(pg);
  const read = await pg.evaluate(() => document.getElementById("lesson-text").textContent);
  assert(/1834/.test(read) && /麦克唐奈/.test(read), "T2（8.4）：读棋第 0 步也有开场白（" + read.slice(0, 40) + "…）");
  assert(errsG.length === 0, "T3：全程没有页面异常 — " + errsG.join(" / "));
  await ctxG.close();
}

// --- M2 评审：名局猜着不改下棋的棋盘方向；读库被取消后猜着接着走 ----------------
{
  const lib = JSON.stringify({ v: 1, names: ["me"], games: [{ id: "g1", t: 1758000000000, white: "me", black: "rival",
    date: "2026.09.01", event: "Casual", result: "1-0", plies: 4, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win" }] });
  const ctxM = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctxM.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return; // a reload keeps what the app wrote
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "learn", view: "train", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", flipped: false }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.save", JSON.stringify({ v: 1, pgn: "1. d4 d5 2. c4 *" }));
  });
  await ctxM.addInitScript(seedLibrary, Object.assign({ once: true }, JSON.parse(lib)));
  const pg = await ctxM.newPage();
  const errsM = [];
  pg.on("pageerror", (e) => errsM.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const settings = () => pg.evaluate(() => JSON.parse(localStorage.getItem("chess.settings") || "{}"));
  const gsAt = (ply, phase = "guess") => pg.waitForFunction(([p, ph]) => {
    const e = document.getElementById("gs-panel");
    return !!e && !!e.offsetParent && e.dataset.at === String(p) && e.dataset.phase === ph;
  }, [ply, phase], { timeout: 10000 }).then(() => true, () => false);
  const liveText = () => pg.evaluate(() => (document.getElementById("board-live") || {}).textContent || "");
  // P2-1: the default-black guess, then 下棋 and a reload: the saved setting is untouched
  await toGuessList(pg);
  await pg.evaluate(() => {
    document.querySelector("#sec-learn details.reading-index").open = true;
    document.querySelector('#lesson-list button[data-gs="8"]').click();
  });
  assert(await gsAt(1), "M2：黑胜的一局默认猜黑方，轮到黑方");
  // v8-3-plan T4: guessing Black, the hand cursor over Black's men (the board
  // is flipped: a8 is at the bottom right), and not over White's
  const hoverCursor = async (sq) => {
    const c = await pg.evaluate((q) => { const r = document.getElementById("board").getBoundingClientRect(); return { x: r.left + (104.5 - q.charCodeAt(0)) * r.width / 8, y: r.top + (Number(q[1]) - 0.5) * r.height / 8 }; }, sq);
    await pg.mouse.move(c.x, c.y);
    await pg.mouse.move(c.x + 2, c.y + 2);
    return pg.evaluate(() => document.getElementById("board").style.cursor);
  };
  const overBlack = await hoverCursor("b8"), overWhite = await hoverCursor("b1");
  assert(overBlack === "grab" && overWhite !== "grab", "T4：猜黑方时黑子上是手形光标、白子上不是（b8 " + overBlack + "，b1 " + overWhite + "）");
  await pg.focus("#board");
  await pg.keyboard.press("ArrowUp");
  await settle(pg);
  const up = await liveText();
  assert(/^e4 /.test(up), "M2：猜黑方时棋盘翻着，↑ 把光标从 e5 带到 e4（「" + up + "」）");
  assert((await settings()).flipped === false, "M2：猜黑方不把下棋的棋盘方向写进设置");
  await pg.click('.rail-btn[data-view="play"]');
  await pg.waitForTimeout(600);
  const inPlay = await settings();
  const bodyFlipped = await pg.evaluate(() => document.body.classList.contains("flipped"));
  assert(inPlay.flipped === false && !bodyFlipped, "M2：回到下棋，棋盘方向还是原来的（settings.flipped " + inPlay.flipped + "）");
  await pg.reload();
  await pg.waitForTimeout(1200);
  assert((await settings()).flipped === false, "M2：重新载入之后也还是原来的方向");
  // 9.0 S3: 训练's segment and 名局's switch are settings: a reload keeps both
  const kept = await settings();
  assert(kept.classicMode === "guess" && kept.trainSeg === "classic",
    "S3：名局的「猜着」开关与训练的分段存进设置，重新载入之后还在（" + JSON.stringify({ c: kept.classicMode, s: kept.trainSeg }) + "）");

  // P3-5: a library game opened mid-guess and 取消 — the run goes on
  await pg.click('.rail-btn[data-view="train"]');   // 9.0 S3: 训练, left on 名局
  await pg.waitForTimeout(500);
  await toGuessList(pg);
  await pg.evaluate(() => {
    // a slow scripted engine: every position level, each answer 1.5 s away
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = (fen) => new Promise((r) => setTimeout(() => r({ cp: 0, mate: null, turn: fen.split(" ")[1], best: null, pv: [], lines: [] }), 1500));
    document.querySelector("#sec-learn details.reading-index").open = true;
    document.querySelector('#lesson-list button[data-gs="0"]').click();
  });
  assert(await gsAt(0), "M2：开始猜第一局（白方）");
  const tapSq = async (sq) => {
    const c = await pg.evaluate((q) => { const r = document.getElementById("board").getBoundingClientRect(); return { x: r.left + (q.charCodeAt(0) - 96.5) * r.width / 8, y: r.top + (8.5 - Number(q[1])) * r.height / 8 }; }, sq);
    await pg.mouse.click(c.x, c.y);
    await settle(pg);
  };
  const refuseLoad = async () => {
    // the whole path inside the page, so it lands within the other side's 0.7 s
    const t = await pg.evaluate(async () => {
      const t0 = performance.now();
      const wait = async (sel) => { for (let i = 0; i < 60 && !document.querySelector(sel); i++) await new Promise((r) => setTimeout(r, 10)); return document.querySelector(sel); };
      document.querySelector('#rail button[data-view="library"]').click();
      (await wait("#lib-open")).click();
      (await wait("#lib-list button[data-lib]")).click();
      return performance.now() - t0;
    });
    await settle(pg);
    const asked = await pg.isVisible("#confirm-cancel");
    return { t, asked };
  };
  // (a) a guess the engine has to judge (1.d4 for 1.e4), refused while it is judged
  await tapSq("d2"); await tapSq("d4");
  const a = await refuseLoad();
  await pg.waitForTimeout(3600); // both of the check's searches (1.5 s each) come back while the run is set aside
  if (a.asked) await pg.click("#confirm-cancel");
  await pg.click('.rail-btn[data-view="train"]');
  const resumedCheck = await gsAt(2);
  assert(a.asked && resumedCheck, "M2：猜着判分时读库被取消，回来之后判完、对方走、轮到第 2 手（问了替换：" + a.asked + "）");
  const say = await pg.evaluate(() => document.getElementById("gs-say").textContent);
  assert(/1\. d4/.test(say) && /1\. e4/.test(say), "M2：判分的结果照常写出（" + say + "）");
  // (b) the master's move, refused while the other side's move waits
  await tapSq("g1"); await tapSq("f3");
  const b = await refuseLoad();
  await pg.waitForTimeout(1000); // the other side's 0.7 s pass while the run is set aside
  if (b.asked) await pg.click("#confirm-cancel");
  await pg.click('.rail-btn[data-view="train"]');
  assert(b.asked && await gsAt(4), "M2：对方要走时读库被取消，回来之后对方照走、轮到第 3 手（" + Math.round(b.t) + " ms 内问了替换）");
  assert(errsM.length === 0, "M2：全程没有页面异常 — " + errsM.join(" / "));
  await ctxM.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
