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
import { Chess } from "../src/web/js/chess.js";

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
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
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
  await pg.click("#pick-cancel").catch(() => {});

  const moreOpen = async () => {
    if (await pg.evaluate(() => !!document.getElementById("more-row").hidden)) { await pg.click("#more-tools"); await pg.waitForTimeout(250); }
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
    await pg.waitForTimeout(150);
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
    lineRow: !document.getElementById("line-row").hidden,
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
  await pg.waitForTimeout(300);
  assert((await shownFen()) === fenAfter("e4", "e5", "Bc4"), "clicking a variation move puts the board on that position");
  n = await notation();
  assert(n.lineRow, "…and 「回主线」 appears, because the line is a variation");
  assert(n.vars.filter((v) => v === "Bc4").length === 1 &&
    (await pg.evaluate(() => (document.querySelector("#move-list .mlv.current") || {}).getAttribute("aria-label"))) === "Bc4",
    "the current move is boxed inside the variation");

  // promote it through the menu: the right button on the move
  await pg.click('#move-list .mlv[aria-label="Bc4"]', { button: "right" });
  await pg.waitForTimeout(200);
  assert(await pg.isVisible("#move-menu"), "the right button opens the move menu");
  await pg.click("#mm-promote");
  await pg.waitForTimeout(300);
  n = await notation();
  assert(n.main.join(" ") === "e4 e5 Bc4 Nf6 d3", "promoted: the variation is the mainline now (" + n.main.join(" ") + ")");
  assert(n.vars.join(" ") === "Nf3 Nc6", "…and the old mainline is the variation (" + n.vars.join(" ") + ")");
  assert(!n.lineRow, "…so the line is the mainline again and 「回主线」 goes");

  // a move at a replay position in a two-player game opens a variation
  await pg.click('#move-list .mlmove[data-i="1"]');
  await pg.waitForTimeout(300);
  for (const sq of ["c7", "c5"]) { const p = await at(sq); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(220); }
  await pg.waitForTimeout(300);
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
  await pg.waitForTimeout(200);

  // export: everything above is in the file, and the result token once
  await pg.click("#pgn-copy");
  await pg.waitForTimeout(400);
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
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx3.newPage();
  const errs3 = [];
  pg.on("pageerror", (e) => errs3.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel").catch(() => {});

  const sq = async (name) => {
    const c = await pg.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await pg.mouse.click(c.x, c.y);
    await pg.waitForTimeout(140);
  };

  // 6.0 的真缺陷:空棋盘上「复盘」这个组名还立着,底下一个按钮都没有。修法是
  // 按 sanHistory().length 开门再 collapseEmptyGroups() 收组,所以这里先在
  // 一着未走时看一眼 —— 这一条要是回退,下面的持续分析全都还能过。
  {
    const g = await pg.evaluate(() => ({
      group: document.getElementById("review-actions").hidden,
      live: document.getElementById("an-live").hidden,
      run: document.getElementById("an-run").hidden,
      lineBox: document.getElementById("live-line").hidden,
    }));
    assert(g.group, "一着未走时「复盘」整组收起,没有一个光头的组名");
    assert(g.live && g.run, "……组里那几个按钮本来就不该在(持续分析 / 分析)");
    assert(g.lineBox, "……引擎行也不在");
  }

  for (const s of ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6"]) await sq(s);
  await pg.waitForTimeout(300);
  assert(!(await pg.evaluate(() => document.getElementById("review-actions").hidden)),
    "有棋可复盘了,这一组才出现");

  // 设置里把线数调到 3。走界面而不是塞 localStorage:验收说的是「MultiPV 3
  // 时」,那就得先证明那颗按钮真的把 3 送到了引擎。
  await pg.click("#tab-setup");
  await pg.waitForTimeout(200);
  await pg.click('#multipv-seg button[data-multipv="3"]');
  await pg.waitForTimeout(200);
  await pg.click("#tab-play");
  await pg.waitForTimeout(200);

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
  await pg.waitForTimeout(400);
  const mpv = await pg.evaluate(() => {
    const el = document.getElementById("pv-line");
    const main = [...el.querySelectorAll("button.pv-chip")].map((c) => c.getAttribute("aria-label"));
    const alts = [...el.querySelectorAll(".pv-alt-row")].map((r) => ({
      label: r.querySelector(".pv-label").textContent,
      sans: [...r.querySelectorAll(".pv-chip")].map((c) => c.getAttribute("aria-label")),
    }));
    return { hidden: el.hidden, main, alts, bar: document.getElementById("eval-bar-text").textContent };
  });
  assert(!mpv.hidden, "复盘面板给出了引擎的线");
  assert(mpv.alts.length === 2 && mpv.main.length >= 1,
    "MultiPV 3:主变一条 + 副变两条 = 三条线 (" + (1 + mpv.alts.length) + ")");
  const heads = [mpv.main[0], ...mpv.alts.map((a) => a.sans[0])];
  assert(new Set(heads).size === 3, "三条线是三条不同的线,不是同一条抄三遍 (" + heads.join(" / ") + ")");
  assert(mpv.alts.every((a) => /胜率\s*\d+%/.test(a.label)),
    "每条副变都带着自己的胜率 (" + mpv.alts.map((a) => a.label).join(" | ") + ")");
  assert(mpv.alts[0].label !== mpv.alts[1].label,
    "……而且是各算各的,不是同一个数字印两遍 (" + mpv.alts.map((a) => a.label).join(" | ") + ")");
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
    head: (document.querySelector("#live-line > .pv-label") || {}).textContent || "",
    rows: [...document.querySelectorAll("#live-line .pv-alt-row .pv-label")].map((x) => x.textContent),
    pressed: document.getElementById("an-live").getAttribute("aria-pressed"),
    fens: window.__live.fens.length,
    stops: window.__live.stops,
  }));

  await pg.click("#rep-end");
  await pg.waitForTimeout(300);
  await pg.click("#an-live");
  await pg.waitForTimeout(700);
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
  await pg.click("#an-live");
  await pg.waitForTimeout(500);
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
  await ctx3.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
