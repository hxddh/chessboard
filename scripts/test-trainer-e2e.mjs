/**
 * Browser check for the puzzle trainer's 8.0 modes (v8-0-plan B1):
 *
 *   - the rating and its curve are on the puzzle view at all times
 *   - the theme browser: every verifiable theme, its count, search, the
 *     progress filter, and a start that lands on the board and survives a
 *     reload
 *   - black-to-move puzzles from the Lichess index, end to end: the board
 *     turns, the goal says Black, and the three mate-grading sentences
 *     (pz.stillMate / pz.notMateYetMove / pz.refuted) name White
 *   - 冲刺 and 连胜: the card, the strikes, the clock running out, the best
 *     score kept across a reload, a run surviving a cancelled game load
 *
 * The real Lichess index changes with every import, so this builds its own
 * page, where the answers are known: scripts/import-puzzles.mjs runs over the fixture
 * CSV (scripts/fixtures/lichess-sample.csv, 49 puzzles, 24 of them Black to
 * move) into a temporary directory, and the bundle is built with that index
 * in place of src/web/js/puzzles-lc-index.js — the same esbuild options as
 * scripts/bundle.mjs, the band chunks and chunk-mined.js (which carries the
 * index) built the same way. Nothing in the app
 * knows it is being tested.
 *
 *   node scripts/test-trainer-e2e.mjs
 */
import fs from "fs";
import http from "http";
import os from "os";
import path from "path";
import vm from "vm";
import { spawnSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { compileModuleSync, ENTRY } from "./bundle.mjs";

// --- the fixture index -----------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "trainer-e2e-"));
const imp = spawnSync(process.execPath, [path.join(HERE, "import-puzzles.mjs"),
  path.join(HERE, "fixtures", "lichess-sample.csv"), "--out-dir", TMP, "--seed", "1"], { encoding: "utf8" });
if (imp.status !== 0) { console.error(imp.stdout, imp.stderr); process.exit(1); }
const BAND_DIR = path.join(TMP, "lichess");
const bandFiles = fs.readdirSync(BAND_DIR).filter((f) => /^band-\d{4}\.js$/.test(f)).sort();

const esbuild = await import("esbuild");
const OPTS = { bundle: true, format: "iife", target: ["chrome100", "safari15"], charset: "utf8", write: false, logLevel: "silent",
  define: { __CHESS_VERSION__: JSON.stringify("0.0.0-test") } };
const fixtureIndex = {
  name: "lc-fixture-index",
  setup(b) { b.onResolve({ filter: /puzzles-lc-index\.js$/ }, () => ({ path: path.join(TMP, "puzzles-lc-index.js") })); },
};
const BUNDLE = (await esbuild.build(Object.assign({ entryPoints: [ENTRY], plugins: [fixtureIndex] }, OPTS))).outputFiles[0].text;
const CHUNKS = new Map();
// the index rides in chunk-mined.js (mined-chunk.js): that chunk, with the fixture index
{
  const r = await esbuild.build(Object.assign({ entryPoints: [path.join(ROOT, "js", "mined-chunk.js")], globalName: "__chunk", plugins: [fixtureIndex] }, OPTS));
  CHUNKS.set("chunk-mined.js", r.outputFiles[0].text +
    "\n;for (var k in __chunk) if (Object.prototype.hasOwnProperty.call(__chunk, k)) window[k] = __chunk[k];\n");
}
for (const f of bandFiles) {
  const r = await esbuild.build(Object.assign({ entryPoints: [path.join(BAND_DIR, f)], globalName: "__chunk" }, OPTS));
  CHUNKS.set("chunk-lc-" + f.slice(5, 9) + ".js", r.outputFiles[0].text +
    "\n;for (var k in __chunk) if (Object.prototype.hasOwnProperty.call(__chunk, k)) window[k] = __chunk[k];\n");
}

// --- the same data the page will load, so the test knows the answers -------
const data = { console };
data.globalThis = data; data.window = data;
vm.createContext(data);
for (const f of ["js/chess.js", "js/puzzles.js", "js/puzzles-mined.js", "js/puzzle-db.js"]) {
  vm.runInContext(compileModuleSync(path.join(ROOT, f)), data, { filename: "module" });
}
for (const f of bandFiles) vm.runInContext(compileModuleSync(path.join(BAND_DIR, f)), data, { filename: "module" });
const Chess = data.Chess;
const LC = bandFiles.flatMap((f) => data["LC_BAND_" + f.slice(5, 9)].map(data.ChessPuzzleDb.decodeRow));
const LC_INDEX = JSON.parse(/LC_INDEX = (\{.*\});/.exec(fs.readFileSync(path.join(TMP, "puzzles-lc-index.js"), "utf8"))[1]);
const lcById = (id) => LC.find((p) => p.id === "lc-" + id);
// every puzzle a run may serve: a position, and a rated category (not an opening drill)
const POOL = data.CHESS_PUZZLES.concat(data.MINED_PUZZLES, LC).filter((p) => p.fen && p.cat !== "op" && p.cat !== "rep");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
/** ms to hold chunk-mined.js back — (e) plays a player quicker than the chunk */
let minedDelay = 0;
const server = http.createServer(async (req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/js/chunk-mined.js" && minedDelay) await new Promise((r) => setTimeout(r, minedDelay));
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  if (p === "/js/bundle.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end(BUNDLE); return; }
  const chunk = CHUNKS.get(p.replace(/^\/js\//, ""));
  if (chunk) { res.writeHead(200, { "content-type": "text/javascript" }); res.end(chunk); return; }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok:", msg, extra === undefined ? "" : extra);
  else { failed++; console.error("FAIL:", msg, extra === undefined ? "" : extra); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);
const errs = [];

/** A page in puzzle mode with `puzzles` as the stored puzzle state. */
async function open(puzzles, opts) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(([pz, mode, extra]) => {
    if (sessionStorage.getItem("seeded")) return; // a reload keeps what the app wrote
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode, langId: "zh-CN", sideTab: "play", soundOn: false, view: mode === "puzzle" ? "puzzle" : "play" }));
    localStorage.setItem("chess.panelOpen", "1");
    if (pz) localStorage.setItem("chess.v1.puzzles", JSON.stringify(pz));
    for (const k in extra) localStorage.setItem(k, extra[k]);
  }, [puzzles || null, (opts && opts.mode) || "puzzle", (opts && opts.extra) || {}]);
  const page = await ctx.newPage();
  if (opts && opts.clock) await page.clock.install();
  page.on("pageerror", (e) => errs.push(e.message));
  // (e) holds a chunk back: the load event would wait for it
  await page.goto(`http://127.0.0.1:${PORT}/`, opts && opts.early ? { waitUntil: "domcontentloaded" } : undefined);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 800 }).catch(() => {});
  return { ctx, page };
}

const helpers = (page) => {
  // the board turns for a Black puzzle without the game's own flip (body.flipped),
  // so the side it faces is read off the position itself: see `faces`
  const view = { flipped: false };
  const squareAt = (s) => page.evaluate(([x, fl]) => {
    const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
    const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
    const co = fl ? 7 - f : f, ro = fl ? 7 - rk : rk, z = r.width / 8;
    return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
  }, [s, view.flipped]);
  const tap = async (s) => { const p = await squareAt(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(200); };
  const move = async (a, b) => { await tap(a); await tap(b); await page.waitForTimeout(350); };
  /** the occupied squares, named as if the board were not turned */
  const occupied = () => page.evaluate(() => {
    const c = document.getElementById("board"); const g = c.getContext("2d");
    const step = c.width / 8; const on = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
      const w = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x, y, w, w).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
    }
    return on.sort().join(",");
  });
  const text = (sel) => page.evaluate((s) => { const n = document.querySelector(s); return n ? n.textContent : null; }, sel);
  const shown = (sel) => page.evaluate((s) => {
    const n = document.querySelector(s);
    return !!n && !n.hidden && n.getClientRects().length > 0;
  }, sel);
  const feedback = () => text("#puzzle-feedback");
  /** does the board show `fen` upright (false) or turned (true)? null: neither */
  const faces = async (fen) => {
    const occ = await occupied();
    const sq = squaresOf(fen);
    return occ === sq ? false : occ === mirror(sq) ? true : null;
  };
  return { view, tap, move, occupied, faces, text, shown, feedback };
};
const squaresOf = (fen) => {
  const rows = fen.split(" ")[0].split("/"); const out = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { out.push("abcdefgh"[f] + (8 - r)); f++; } }
  });
  return out.sort().join(",");
};
const mirror = (sqs) => sqs.split(",").map((s) => "abcdefgh"[7 - (s.charCodeAt(0) - 97)] + (9 - +s[1])).sort().join(",");
/** SAN → from/to in `fen` */
const fromTo = (fen, san) => { const g = new Chess(fen); const m = g.move(san); return m ? [m.from, m.to] : null; };
/** a mate in one for the side to move, or null */
const mateInOne = (g) => { for (const m of g.moves()) { g.move(m); const x = g.in_checkmate(); g.undo(); if (x) return m; } return null; };
const hasMateIn = (g, n) => {
  for (const m of g.moves()) {
    g.move(m);
    let ok = g.in_checkmate();
    if (!ok && n > 1 && !g.game_over()) {
      ok = g.moves().every((r) => { g.move(r); const y = hasMateIn(g, n - 1); g.undo(); return y; });
    }
    g.undo();
    if (ok) return true;
  }
  return false;
};

// --- (c) the rating, always on the puzzle view -------------------------------
{
  const now = Date.now();
  const { ctx, page } = await open({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1",
    rating: { r: 1520, rd: 60, vol: 0.06 }, ratedAt: now,
    rhist: [{ t: now - 3000, r: 1500 }, { t: now - 2000, r: 1540 }, { t: now - 1000, r: 1520 }] });
  const h = helpers(page);
  assert(await h.shown("#pz-rating"), "c: 谜题页常驻评级一行");
  assert(/^1520(?!\?)/.test(await h.text("#pz-rating-v") || ""), "c: 评级数值就是存下的评级", await h.text("#pz-rating-v"));
  const inked = await page.evaluate(() => {
    const c = document.getElementById("pz-rating-curve");
    if (!c || !c.width) return 0;
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) n++;
    return n;
  });
  assert(inked > 20, "c: 评级曲线画出来了", inked);
  // a fresh profile still shows a number (provisional) and a line
  await ctx.close();
  const fresh = await open(null);
  const hf = helpers(fresh.page);
  assert(/^\d+\?/.test(await hf.text("#pz-rating-v") || ""), "c: 新档案也有评级，标「?」", await hf.text("#pz-rating-v"));
  // …shown, not filed: a rating is written by an answer, never by the view
  // (test-library-e2e: a rote drill must leave `rating` unset)
  await fresh.page.click('#pz-mode-seg button[data-run="practice"]').catch(() => {});
  await fresh.page.evaluate(() => document.getElementById("puzzle-next").click());
  await fresh.page.waitForTimeout(300);
  const filed = await fresh.page.evaluate(() => (JSON.parse(localStorage.getItem("chess.v1.puzzles") || "{}")).rating);
  assert(filed == null, "c: 看一眼评级不会把评级存进档案", JSON.stringify(filed));
  await fresh.ctx.close();
}

// --- (b) the theme browser -----------------------------------------------------
{
  const { ctx, page } = await open(null, { mode: "ai" });
  const h = helpers(page);
  await page.click('#rail button[data-view="puzzle"]');
  await page.waitForTimeout(500);
  await page.click("#pz-themes-open");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => document.getElementById("theme-modal").classList.contains("show")), "b: 「按主题练」打开主题页");
  const rows = () => page.evaluate(() => [...document.querySelectorAll("#theme-list button[data-theme]")].map((b) => ({ id: b.dataset.theme, text: b.textContent, off: b.disabled })));
  let r = await rows();
  assert(r.length === 28, "b: 列出全部 28 个可验证主题", r.length);
  const localM1 = data.CHESS_PUZZLES.concat(data.MINED_PUZZLES).filter((p) => p.cat === "m1" && p.fen).length;
  const m1 = r.find((x) => x.id === "m1");
  assert(m1 && m1.text.includes((localM1 + LC_INDEX.themes.m1.n) + " 道"), "b: 一步杀的题数 = 本地 + 题库索引", m1 && m1.text);
  const smo = r.find((x) => x.id === "smothered");
  assert(smo && smo.off && /0 道/.test(smo.text), "b: 没有题的主题列出来，但点不了", smo && smo.text);
  await page.fill("#theme-search", "闷杀");
  await page.waitForTimeout(150);
  r = await rows();
  assert(r.length === 1 && r[0].id === "smothered", "b: 按名字搜索", r.map((x) => x.id).join(","));
  await page.fill("#theme-search", "fork");
  await page.waitForTimeout(150);
  r = await rows();
  assert(r.length === 1 && r[0].id === "fork", "b: 按 id 搜索（英文）", r.map((x) => x.id).join(","));
  await page.fill("#theme-search", "zzz");
  await page.waitForTimeout(150);
  assert((await rows()).length === 0 && /没有符合/.test(await h.text("#theme-list-count")), "b: 搜不到时说没有", await h.text("#theme-list-count"));
  await page.fill("#theme-search", "");
  await page.click('#theme-prog-seg button[data-tprog="started"]');
  await page.waitForTimeout(150);
  assert((await rows()).length === 0, "b: 「练过」一开始是空的");
  await page.click('#theme-prog-seg button[data-tprog="all"]');
  await page.waitForTimeout(150);
  // start 一步杀: the sheet goes, the board is the puzzle board, the theme row names it
  await page.click('#theme-list button[data-theme="m1"]');
  await page.waitForTimeout(800);
  assert(!(await page.evaluate(() => document.getElementById("theme-modal").classList.contains("show"))), "b: 开始后主题页收起");
  assert(await page.evaluate(() => document.getElementById("app").getAttribute("data-view")) === "puzzle", "b: 落在谜题棋盘上");
  assert(await h.shown("#row-pz-theme") && (await h.text("#pz-theme-name")) === "一步杀", "b: 面板上写着在练哪个主题", await h.text("#pz-theme-name"));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles") || "{}").cat);
  assert(stored === "theme:m1", "b: 主题存下了", stored);

  // --- (d) Black to move, from the Lichess index ------------------------------
  const pick = async (lcId) => {
    await page.evaluate(() => { const d = document.querySelector("#puzzle-list")?.closest("details"); if (d) d.open = true; });
    const ok = await page.evaluate((id) => {
      const b = [...document.querySelectorAll("#puzzle-list button[data-i]")].find((x) => x.textContent.includes("#" + id));
      if (!b) return false;
      b.click();
      return true;
    }, lcId);
    await page.waitForTimeout(500);
    return ok;
  };
  const p1 = lcById("F0001"); // k5q1/8/8/8/8/5n2/8/7K b — Qg1#
  assert(await pick("F0001"), "d: 题库里的黑先一步杀在主题列表里");
  assert(await h.faces(p1.fen) === true, "d: 摆的是这道题，棋盘转过来（黑方在下）", await h.occupied());
  h.view.flipped = true;
  assert(/黑先/.test(await h.text("#puzzle-task")), "d: 题面写黑先", await h.text("#puzzle-task"));
  // a queen check that is not mate: White gets a move, and the sentence names White
  const notMate = new Chess(p1.fen).moves({ verbose: true }).find((m) => m.from === "g8" && m.san.includes("+") && !m.san.includes("#"));
  await h.move(notMate.from, notMate.to);
  let fb = await h.feedback();
  assert(/还不是将死 —— 白方可走/.test(fb), "d: pz.notMateYetMove 说白方可走", fb);
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(st.themes && st.themes.m1 && st.themes.m1.rating && st.themes.m1.miss === 1, "b: 主题有自己的评级，和总评级存在一起", JSON.stringify(st.themes));
  assert(st.rhist && st.rhist.length === 1, "b: 题库的题也算进总评级", st.rhist && st.rhist.length);
  // Codex on #88: a missed puzzle restarted (R / 再试一次) is the same puzzle —
  // only its first answer moves the ratings. Red before: every restart and miss
  // counted again, for the theme and for the overall rating.
  await page.keyboard.press("r");
  await page.waitForTimeout(500);
  await h.move(notMate.from, notMate.to);
  await h.feedback();
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(st.themes.m1.miss === 1 && !(st.themes.m1.solve > 0) && st.rhist.length === 1,
    "b: 重开再答错，主题和总评级都不再算第二次", JSON.stringify({ theme: st.themes.m1, rhist: st.rhist.length }));
  await page.keyboard.press("r");
  await page.waitForTimeout(500);
  const [a1, b1] = fromTo(p1.fen, p1.solution[0]);
  await h.move(a1, b1);
  fb = await h.feedback();
  assert(/解出|最佳/.test(fb) && !/再想想/.test(fb), "d: 黑先一步杀走对了就过", fb);

  // m2, Black: a first move that does not force mate is refuted by White
  const p2 = lcById("F0011");
  await page.click("#pz-theme-change");
  await page.waitForTimeout(250);
  await page.click('#theme-list button[data-theme="m2"]');
  await page.waitForTimeout(600);
  assert(await pick("F0011"), "d: 黑先两步杀在列表里");
  const g2 = new Chess(p2.fen);
  const loose = g2.moves({ verbose: true }).find((m) => {
    if (m.san === p2.solution[0]) return false;
    g2.move(m); const lost = g2.moves().every((r) => { g2.move(r); const y = hasMateIn(g2, 1); g2.undo(); return y; }); g2.undo();
    return !lost && !m.san.includes("#");
  });
  await h.move(loose.from, loose.to);
  fb = await h.feedback();
  assert(/不能强制将死 —— 白方可用/.test(fb), "d: pz.refuted 说白方化解", fb);

  // def, Black: a move that leaves White's mate on
  const p3 = lcById("F0037");
  await page.click("#pz-theme-change");
  await page.waitForTimeout(250);
  await page.click('#theme-list button[data-theme="def"]');
  await page.waitForTimeout(600);
  assert(await pick("F0037"), "d: 黑方的防守题在列表里");
  assert(/白方下一步就要将死你/.test(await h.text("#puzzle-task")), "d: 黑方防守题的题面说白方要杀", await h.text("#puzzle-task"));
  const g3 = new Chess(p3.fen);
  const careless = g3.moves({ verbose: true }).find((m) => { g3.move(m); const x = !g3.game_over() && !!mateInOne(g3); g3.undo(); return x; });
  await h.move(careless.from, careless.to);
  fb = await h.feedback();
  assert(/还是没接住 —— 白方接着走/.test(fb), "d: pz.stillMate 说白方接着杀", fb);

  // the progress filter now has the themes answered in
  await page.click("#pz-theme-change");
  await page.waitForTimeout(250);
  await page.click('#theme-prog-seg button[data-tprog="started"]');
  await page.waitForTimeout(150);
  r = await rows();
  assert(["m1", "m2", "def"].every((id) => r.some((x) => x.id === id)) && /评级/.test(r[0].text), "b: 「练过」列出做过的主题，带评级", r.map((x) => x.id).join(","));
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);

  // a reload lands on the same theme
  await page.reload();
  await page.waitForTimeout(1200);
  assert(await h.shown("#row-pz-theme") && (await h.text("#pz-theme-name")) === "防守", "b: 重开之后还在这个主题", await h.text("#pz-theme-name"));
  assert(!!(await h.text("#puzzle-task")), "b: 重开之后有题可做");
  await ctx.close();
}

// --- (a) 连胜 / 冲刺 --------------------------------------------------------------
/** the run's puzzle on the board, found by its position */
async function solveCurrent(page, h) {
  const occ = await h.occupied();
  const p = POOL.find((q) => squaresOf(q.fen) === occ || mirror(squaresOf(q.fen)) === occ);
  if (!p) return false;
  h.view.flipped = p.side === "b";
  const g = new Chess(p.fen);
  for (let k = 0; k < p.solution.length; k += 2) {
    const m = g.move(p.solution[k]);
    if (!m) return false;
    await h.move(m.from, m.to);
    // a promotion opens the picker, as it does for a player: choose the solution's piece
    if (m.promotion) { await page.click(`#promo-modal button[data-p="${m.promotion}"]`); await page.waitForTimeout(350); }
    if (p.cat === "real") break;
    await page.waitForTimeout(250);
    if (k + 1 < p.solution.length) g.move(p.solution[k + 1]);
  }
  return true;
}
{
  const { ctx, page } = await open(null);
  const h = helpers(page);
  // A run is seeded by Date.now(), so without this every CI run drew its own
  // puzzles — and one draw in a few dozen opened with a promotion (CI on
  // 045dd84: the picker stayed open and the streak scored 0). Pinned to a
  // seed whose first puzzle is exactly that one, mn-203-137-66 (…fxe8=Q+):
  // the first pick is made before any Lichess band has arrived, so it
  // depends on the seed and the local book only, and the promotion path is
  // taken on every run, not by luck.
  await page.clock.setFixedTime(1790596830270);
  await page.click('#pz-mode-seg button[data-run="streak"]');
  await page.waitForTimeout(600);
  const occ0 = await h.occupied();
  const first = POOL.find((q) => squaresOf(q.fen) === occ0 || mirror(squaresOf(q.fen)) === occ0);
  assert(first && first.id === "mn-203-137-66", "a: 固定种子，第一题是要升变的那道", first && first.id);
  assert(await h.shown("#pz-run"), "a: 连胜的卡片出现");
  assert(/答错一题即结束/.test(await h.text("#pz-run-head")), "a: 卡片写着连胜的规则", await h.text("#pz-run-head"));
  assert(!(await h.shown("#puzzle-cat-seg")), "a: 练习的题型行让位");
  let solved = 0;
  for (let i = 0; i < 2; i++) {
    if (!(await solveCurrent(page, h))) break;
    await page.waitForTimeout(900);
    solved++;
  }
  assert(solved === 2 && /得分 2/.test(await h.text("#pz-run-score")), "a: 连对两题，得分 2", await h.text("#pz-run-score"));
  await page.click("#btn-hint"); // 答案 in a run: this one is given up
  await page.waitForTimeout(1300);
  assert(/连胜中断/.test(await h.text("#pz-run-head")), "a: 一题不对，连胜结束", await h.text("#pz-run-head"));
  assert(/新纪录：2/.test(await h.text("#pz-run-best")), "a: 新纪录写出来", await h.text("#pz-run-best"));
  assert(await h.shown("#pz-run-again"), "a: 可以再来一局");
  const best = await page.evaluate(() => (JSON.parse(localStorage.getItem("chess.v1.puzzles")).runs || {}).streak);
  assert(best && best.best === 2, "a: 最佳成绩存下了", JSON.stringify(best));
  await page.reload();
  await page.waitForTimeout(1200);
  await page.click('#pz-mode-seg button[data-run="streak"]');
  await page.waitForTimeout(600);
  assert(/最佳 2/.test(await h.text("#pz-run-best")), "a: 重开之后最佳成绩还在", await h.text("#pz-run-best"));
  await page.click('#pz-mode-seg button[data-run="practice"]');
  await page.waitForTimeout(500);
  assert(!(await h.shown("#pz-run")) && await h.shown("#puzzle-cat-seg"), "a: 回到练习，题型行回来");

  // 冲刺: the clock and three strikes
  await page.click('#pz-mode-seg button[data-run="rush"]');
  await page.waitForTimeout(600);
  assert(/^[23]:\d\d$/.test(await h.text("#pz-run-clock") || ""), "a: 冲刺有 3 分钟的钟", await h.text("#pz-run-clock"));
  assert(/失误 0\/3/.test(await h.text("#pz-run-strikes")), "a: 失误 0/3", await h.text("#pz-run-strikes"));
  // R (重做) is practice's key: in a run it must not drop the puzzle
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press("r");
  await page.waitForTimeout(300);
  assert(!/暂无题目/.test(await h.text("#puzzle-task")) && /^[23]:\d\d$/.test(await h.text("#pz-run-clock") || ""),
    "a: 冲刺里按 R 不会把题弄丢", await h.text("#puzzle-task"));
  for (let i = 0; i < 3; i++) { await page.click("#btn-hint"); await page.waitForTimeout(1200); }
  assert(/失误 3\/3/.test(await h.text("#pz-run-strikes")) && /失误用完了/.test(await h.text("#pz-run-head")), "a: 三次失误出局", await h.text("#pz-run-head"));
  await ctx.close();
}
{
  // Codex on #88: a library game opened mid-run, and the 「替换当前棋局？」
  // question answered 取消 — the run goes on as it was: not over, not filed,
  // its clock still running from where it stood
  const lib = JSON.stringify({ v: 1, names: ["me"], games: [{ id: "g1", t: 1758000000000, white: "me", black: "rival",
    date: "2026.09.01", event: "Casual", result: "1-0", plies: 4, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win" }] });
  const { ctx, page } = await open(null, { extra: { "chess.v1.library": lib,
    "chess.v1.save": JSON.stringify({ v: 1, pgn: "1. d4 d5 2. c4 *" }) } });
  const h = helpers(page);
  const runsOf = () => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles") || "{}").runs || {});
  const secs = async () => { const m = /^(\d):(\d\d)$/.exec(await h.text("#pz-run-clock") || ""); return m ? +m[1] * 60 + +m[2] : null; };
  await page.click('#pz-mode-seg button[data-run="rush"]');
  await page.waitForTimeout(600);
  const answered = await solveCurrent(page, h);
  await page.waitForTimeout(900);
  const before = { score: await h.text("#pz-run-score"), left: await secs(), runs: await runsOf() };
  assert(answered && /得分 1/.test(before.score), "a/#88: 冲刺答对一题", before.score);
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(300);
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(700);
  const asked = await page.isVisible("#confirm-cancel");
  if (asked) await page.click("#confirm-cancel");
  await page.waitForTimeout(600);
  await page.click('#rail button[data-view="puzzle"]');
  await page.waitForTimeout(300);
  const t1 = await secs();
  await page.waitForTimeout(2100);
  const t2 = await secs();
  const after = { head: await h.text("#pz-run-head"), score: await h.text("#pz-run-score"), runs: await runsOf() };
  assert(asked, "a/#88: 冲刺里打开库里的一局，先问要不要替换");
  assert(/3 分钟/.test(after.head) && await h.shown("#pz-run-stop"), "a/#88: 取消之后冲刺还在进行，没有结束", after.head);
  assert(after.score === before.score, "a/#88: 得分不变", after.score);
  assert(!after.runs.rush && JSON.stringify(after.runs) === JSON.stringify(before.runs), "a/#88: 成绩没有被记下，最佳不变", JSON.stringify(after.runs));
  assert(t1 != null && t2 != null && t1 <= before.left && t1 > 150 && t2 < t1, "a/#88: 钟接着原来的时间在走", [before.left, t1, t2].join(" → "));
  assert(!!(await h.text("#puzzle-task")) && !(await h.shown("#puzzle-cat-seg")), "a/#88: 棋盘上还是这一局冲刺的题");
  // …and answered 替换, the run ends there and its score is filed
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(300);
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(700);
  await page.click("#confirm-ok");
  await page.waitForTimeout(600);
  const filed = await runsOf();
  assert(filed.rush && filed.rush.best === 1, "a/#88: 确认替换之后，这一局冲刺的成绩记下", JSON.stringify(filed));
  await ctx.close();
}
{
  // the clock runs out
  const { ctx, page } = await open(null, { clock: true });
  const h = helpers(page);
  await page.click('#pz-mode-seg button[data-run="rush"]');
  await page.clock.runFor(1000);
  assert(/^2:5\d$/.test(await h.text("#pz-run-clock") || ""), "a: 钟在走", await h.text("#pz-run-clock"));
  await page.clock.runFor(181000);
  assert(/时间到/.test(await h.text("#pz-run-head")), "a: 3 分钟到，冲刺结束", await h.text("#pz-run-head"));
  await ctx.close();
}

// --- (e) quicker than the index ------------------------------------------------
// The Lichess index rides in chunk-mined.js (mined-chunk.js), fetched after the
// first paint. A theme page opened, a theme started or a run begun before it
// is here waits for it: the counts are redrawn, the bands are still asked for.
{
  minedDelay = 5000;
  const { ctx, page } = await open(null, { mode: "ai", early: true });
  const lcAsked = [];
  page.on("request", (q) => { if (/chunk-lc-\d{4}\.js/.test(q.url())) lcAsked.push(q.url().split("/").pop()); });
  const early = await page.evaluate(() => !window.LC_INDEX);
  await page.click('#rail button[data-view="puzzle"]');
  await page.waitForTimeout(200);
  await page.click("#pz-themes-open");
  await page.waitForTimeout(200);
  await page.click('#theme-list button[data-theme="fork"]').catch(() => {});
  await page.waitForTimeout(200);
  const askedBefore = lcAsked.length;
  await page.waitForFunction(() => !!window.LC_INDEX, null, { timeout: 10000 }).catch(() => {});
  await page.waitForTimeout(800);
  const forkBands = Object.keys(LC_INDEX.themes.fork ? LC_INDEX.themes.fork.bands : []).length;
  assert(early && askedBefore === 0, "e: 题库索引还没到（chunk-mined.js 压着）", "早 " + early + "，已要分块 " + askedBefore);
  assert(lcAsked.length > 0, "e: 索引到了，先点的主题照样去要它的分块", lcAsked.join(","));
  await ctx.close();
  // a theme page left open while the index arrives redraws its counts
  const sheet = await open(null, { mode: "ai", early: true });
  await sheet.page.click('#rail button[data-view="puzzle"]');
  await sheet.page.waitForTimeout(200);
  await sheet.page.click("#pz-themes-open");
  await sheet.page.waitForTimeout(200);
  const sheetM1 = () => sheet.page.evaluate(() => (document.querySelector('#theme-list button[data-theme="m1"]') || {}).textContent || "");
  const sheetBefore = await sheetM1();
  const sheetEarly = await sheet.page.evaluate(() => !window.LC_INDEX);
  await sheet.page.waitForFunction(() => !!window.LC_INDEX, null, { timeout: 10000 }).catch(() => {});
  await sheet.page.waitForTimeout(500);
  const localM1 = data.CHESS_PUZZLES.concat(data.MINED_PUZZLES).filter((p) => p.cat === "m1" && p.fen).length;
  assert(sheetEarly && (await sheetM1()).includes((localM1 + LC_INDEX.themes.m1.n) + " 道"), "e: 开着的主题页，索引一到题数就补上题库",
    sheetBefore + " → " + (await sheetM1()));
  await sheet.ctx.close();
  // a run begun before the index: its bands are asked for once the index is here
  const run = await open(null, { mode: "ai", early: true });
  const runAsked = [];
  run.page.on("request", (q) => { if (/chunk-lc-\d{4}\.js/.test(q.url())) runAsked.push(q.url().split("/").pop()); });
  await run.page.click('#rail button[data-view="puzzle"]');
  await run.page.waitForTimeout(200);
  await run.page.click('#pz-mode-seg button[data-run="rush"]');
  const runEarly = await run.page.evaluate(() => !window.LC_INDEX) && runAsked.length === 0;
  await run.page.waitForFunction(() => !!window.LC_INDEX, null, { timeout: 10000 }).catch(() => {});
  await run.page.waitForTimeout(800);
  assert(runEarly && runAsked.length > 0, "e: 冲刺先开，索引到了照样去要分数段的分块", runAsked.join(",") + " (fork 在 " + forkBands + " 段)");
  await run.ctx.close();
  minedDelay = 0;
}

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
