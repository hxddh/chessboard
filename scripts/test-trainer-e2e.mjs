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
 *   - 看 N 步后 and 盲走收官 (v8-2-plan T2): a fixed seed gives a fixed
 *     first question, the moves are text while the board stands still, the
 *     answers go to each mode's own rating and review queue and to 「我的」,
 *     three languages, and 盲走 played start to finish from the keyboard
 *   - v8-3-plan T1 / T2 (j): both modes draw from the bank's band for their
 *     rating, the local book when the band does not load; look's plies past
 *     the puzzle's line are the engine's (the real one, served for (j) and
 *     (k) only, against the same Stockfish run here), pickMove's rule without it
 *   - (k) their M2 review: a set still being made never starts over what the
 *     player did since, a local puzzle's review key is rebuilt by pickMove's
 *     rule alone, a cancelled search is asked again, the Hash setting does
 *     not reach these searches, and leaving stops them
 *   - (l) v8-4-plan T1: the first question of a set is up within 1 s (CI:
 *     2.5 s); a review whose key kept its engine plies searches nothing,
 *     and a wrong answer to a key without them files them
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
import { compileModuleSync, ENTRY, MINIFY } from "./bundle.mjs";
import { seedLibrary } from "./lib/library-view.mjs";

// --- the fixture index -----------------------------------------------------
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "trainer-e2e-"));
const imp = spawnSync(process.execPath, [path.join(HERE, "import-puzzles.mjs"),
  path.join(HERE, "fixtures", "lichess-sample.csv"), "--out-dir", TMP, "--seed", "1"], { encoding: "utf8" });
if (imp.status !== 0) { console.error(imp.stdout, imp.stderr); process.exit(1); }
const BAND_DIR = path.join(TMP, "lichess");
const bandFiles = fs.readdirSync(BAND_DIR).filter((f) => /^band-\d{4}\.js$/.test(f)).sort();

const esbuild = await import("esbuild");
const OPTS = { bundle: true, format: "iife", target: ["chrome100", "safari15"], charset: "utf8", write: false, logLevel: "silent",
  define: { __CHESS_VERSION__: JSON.stringify("0.0.0-test") },
  // the shipped form (v8-1-plan F2), so this page is the one the app loads
  ...MINIFY };
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
/** ms to hold a band chunk back, by file — (f) makes the nearest band the slow one */
const chunkDelay = {};
/** (j), (k) v8-3-plan T2: the real Stockfish instead of the one-line stub every other section has */
let realEngine = false;
const server = http.createServer(async (req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/js/chunk-mined.js" && minedDelay) await new Promise((r) => setTimeout(r, minedDelay));
  const held = chunkDelay[p.replace(/^\/js\//, "")];
  if (held === "fail") { res.writeHead(404); res.end(); return; }
  if (held) await new Promise((r) => setTimeout(r, held));
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js" && !realEngine) { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
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

/**
 * A page in puzzle mode with `puzzles` as the stored puzzle state; `extra`,
 * more keys — the library (`chess.library`, as `{names, games}` JSON)
 * through seedLibrary.
 */
async function open(puzzles, opts) {
  // (h) opens in each of the three languages
  const lang = (opts && opts.lang) || "zh-CN";
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang });
  const { "chess.library": lib, ...extra } = (opts && opts.extra) || {};
  if (lib) await ctx.addInitScript(seedLibrary, Object.assign({ once: true }, JSON.parse(lib)));
  await ctx.addInitScript(([pz, mode, extra, langId]) => {
    if (sessionStorage.getItem("seeded")) return; // a reload keeps what the app wrote
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode, langId, sideTab: "play", soundOn: false, view: mode === "puzzle" ? "train" : "play" }));
    localStorage.setItem("chess.panelOpen", "1");
    if (pz) localStorage.setItem("chess.puzzles", JSON.stringify(pz));
    for (const k in extra) localStorage.setItem(k, extra[k]);
  }, [puzzles || null, (opts && opts.mode) || "puzzle", extra, lang]);
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
/**
 * 9.0 S3: into 训练 · 谜题 — the rail's 训练 (the view, where the player left
 * it), then 谜题 on the switch over the panel. The rail's 谜题 is gone.
 */
async function toPuzzles(page) {
  const lit = () => page.evaluate(() => {
    if (document.getElementById("app").getAttribute("data-view") !== "train") return null;
    const row = document.getElementById("train-seg");
    const b = row && !row.hidden && row.querySelector("button[data-seg].active");
    return b ? b.dataset.seg : null;
  });
  if (!(await lit())) { await page.click('#rail button[data-view="train"]'); await page.waitForTimeout(200); }
  if ((await lit()) !== "puzzle") await page.click('#train-seg button[data-seg="puzzle"]');
}
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
  assert(/^1520(?!\?|（)/.test(await h.text("#pz-rating-v") || ""), "c: 评级数值就是存下的评级", await h.text("#pz-rating-v"));
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
  assert(/^\d+（定级中）/.test(await hf.text("#pz-rating-v") || ""), "c: 新档案也有评级，标「定级中」（v9-0-plan S6：不是「?」）", await hf.text("#pz-rating-v"));
  // …shown, not filed: a rating is written by an answer, never by the view
  // (test-library-e2e: a rote drill must leave `rating` unset)
  assert(!(await hf.shown("#pz-run")) && await hf.shown("#pz-groups-sec"), "c: 新档案在练习里（没有挑战在跑，按类做题在）");
  await fresh.page.evaluate(() => document.getElementById("puzzle-next").click());
  await fresh.page.waitForTimeout(300);
  const filed = await fresh.page.evaluate(() => (JSON.parse(localStorage.getItem("chess.puzzles") || "{}")).rating);
  assert(filed == null, "c: 看一眼评级不会把评级存进档案", JSON.stringify(filed));
  await fresh.ctx.close();
}

// --- (b) the theme browser -----------------------------------------------------
{
  const { ctx, page } = await open(null, { mode: "ai" });
  const h = helpers(page);
  await toPuzzles(page);
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
  assert(await page.evaluate(() => document.getElementById("app").getAttribute("data-view")) === "train" &&
    await page.evaluate(() => document.querySelector('#train-seg button[data-seg="puzzle"]').classList.contains("active")), "b: 落在训练 · 谜题的棋盘上");
  assert(await h.shown("#row-pz-theme") && (await h.text("#pz-theme-name")) === "一步杀", "b: 面板上写着在练哪个主题", await h.text("#pz-theme-name"));
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles") || "{}").cat);
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
  let st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
  assert(st.themes && st.themes.m1 && st.themes.m1.rating && st.themes.m1.miss === 1, "b: 主题有自己的评级，和总评级存在一起", JSON.stringify(st.themes));
  assert(st.rhist && st.rhist.length === 1, "b: 题库的题也算进总评级", st.rhist && st.rhist.length);
  // Codex on #88: a missed puzzle restarted (R / 再试一次) is the same puzzle —
  // only its first answer moves the ratings. Red before: every restart and miss
  // counted again, for the theme and for the overall rating.
  await page.keyboard.press("r");
  await page.waitForTimeout(500);
  await h.move(notMate.from, notMate.to);
  await h.feedback();
  st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
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
  assert(["m1", "m2", "def"].every((id) => r.some((x) => x.id === id)) && /谜题等级分/.test(r[0].text), "b: 「练过」列出做过的主题，带谜题等级分", r.map((x) => x.id).join(","));
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
  await page.click('#pz-modes button[data-run="streak"]');
  await page.waitForTimeout(600);
  const occ0 = await h.occupied();
  const first = POOL.find((q) => squaresOf(q.fen) === occ0 || mirror(squaresOf(q.fen)) === occ0);
  assert(first && first.id === "mn-203-137-66", "a: 固定种子，第一题是要升变的那道", first && first.id);
  assert(await h.shown("#pz-run"), "a: 连胜的卡片出现");
  assert(/答错一题即结束/.test(await h.text("#pz-run-head")), "a: 卡片写着连胜的规则", await h.text("#pz-run-head"));
  assert(!(await h.shown("#pz-groups-sec")) && !(await h.shown("#pz-hero")), "a: 练习的选题（为你出一题、按类做题）让位");
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
  const best = await page.evaluate(() => (JSON.parse(localStorage.getItem("chess.puzzles")).runs || {}).streak);
  assert(best && best.best === 2, "a: 最佳成绩存下了", JSON.stringify(best));
  await page.reload();
  await page.waitForTimeout(1200);
  await page.click('#pz-modes button[data-run="streak"]');
  await page.waitForTimeout(600);
  assert(/最佳 2/.test(await h.text("#pz-run-best")), "a: 重开之后最佳成绩还在", await h.text("#pz-run-best"));
  // 9.0 S3: no 练习 button — 结束 ends the run, its card keeps the score and
  // the picker is back under it; a tile from the picker is practice again
  await page.click("#pz-run-stop");
  await page.waitForTimeout(500);
  assert(await h.shown("#pz-run-again") && !(await h.shown("#pz-run-stop")) && await h.shown("#pz-groups-sec") && await h.shown("#pz-hero"),
    "a: 结束：卡片停在结束，选题回来", await h.text("#pz-run-head"));
  await page.click('#pz-groups button[data-group="mate"]');
  await page.waitForTimeout(500);
  assert(!(await h.shown("#pz-run")) && await h.shown("#pz-groups-sec") && !!(await h.text("#puzzle-task")) &&
    !(await page.evaluate(() => document.querySelector("#pz-modes button.active"))), "a: 点一块按类做题，回到练习，挑战的卡片收起");

  // 冲刺: the clock and three strikes
  await page.click('#pz-modes button[data-run="rush"]');
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
  const { ctx, page } = await open(null, { extra: { "chess.library": lib,
    "chess.save": JSON.stringify({ v: 1, pgn: "1. d4 d5 2. c4 *" }) } });
  const h = helpers(page);
  const runsOf = () => page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles") || "{}").runs || {});
  const secs = async () => { const m = /^(\d):(\d\d)$/.exec(await h.text("#pz-run-clock") || ""); return m ? +m[1] * 60 + +m[2] : null; };
  await page.click('#pz-modes button[data-run="rush"]');
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
  await toPuzzles(page);
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
  assert(!!(await h.text("#puzzle-task")) && !(await h.shown("#pz-groups-sec")), "a/#88: 棋盘上还是这一局冲刺的题");
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
  await page.click('#pz-modes button[data-run="rush"]');
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
  await toPuzzles(page);
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
  await toPuzzles(sheet.page);
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
  await toPuzzles(run.page);
  await run.page.waitForTimeout(200);
  await run.page.click('#pz-modes button[data-run="rush"]');
  const runEarly = await run.page.evaluate(() => !window.LC_INDEX) && runAsked.length === 0;
  await run.page.waitForFunction(() => !!window.LC_INDEX, null, { timeout: 10000 }).catch(() => {});
  await run.page.waitForTimeout(800);
  assert(runEarly && runAsked.length > 0, "e: 冲刺先开，索引到了照样去要分数段的分块", runAsked.join(",") + " (fork 在 " + forkBands + " 段)");
  await run.ctx.close();
  minedDelay = 0;
}

// --- (f) a theme with nothing local starts from the nearest band -------------
// Codex #89: every band of the theme used to load at once and the first to
// arrive seated its puzzle, near or not. The nearest band loads first now.
{
  const { ctx, page } = await open(null, { mode: "ai" });
  const h = helpers(page);
  await toPuzzles(page);
  await page.waitForTimeout(500);
  await page.click("#pz-themes-open");
  await page.waitForTimeout(300);
  const rowsF = await page.evaluate(() => [...document.querySelectorAll("#theme-list button[data-theme]")].map((b) => ({ id: b.dataset.theme, text: b.textContent, off: b.disabled })));
  const bandOf = (r) => Math.floor(r / 200) * 200;
  const pick = rowsF.find((x) => {
    const t = LC_INDEX.themes[x.id];
    return t && !x.off && new RegExp("(^|\\D)" + t.n + " 道").test(x.text) && t.bands.filter((c) => c > 0).length >= 2;
  });
  const bands = pick ? LC_INDEX.bands.filter((b, i) => LC_INDEX.themes[pick.id].bands[i] > 0).map((b) => b.band) : [];
  bands.sort((a, b) => Math.abs(a + 100 - 1500) - Math.abs(b + 100 - 1500));
  const near = bands[0];
  if (near != null) chunkDelay["chunk-lc-" + String(near).padStart(4, "0") + ".js"] = 1500;
  if (pick) await page.click('#theme-list button[data-theme="' + pick.id + '"]');
  await page.waitForTimeout(3500);
  const occ = await h.occupied();
  const seated = LC.filter((p) => pick && p.themes.includes(pick.id)).find((p) => squaresOf(p.fen) === occ || mirror(squaresOf(p.fen)) === occ);
  assert(!!pick && bands.length >= 2 && !!seated && bandOf(seated.rating) === near,
    "f: 没有本地题的主题，先摆最近分数段的题（最近段故意慢到）", JSON.stringify({ theme: pick && pick.id, bands, seated: seated && seated.rating, occ, name: await h.text("#pz-theme-name"), n: LC.filter((p) => pick && p.themes.includes(pick.id)).map((p) => p.rating) }));
  for (const k in chunkDelay) delete chunkDelay[k];
  await ctx.close();
  // Codex #89: the nearest band failing to load does not strand the theme —
  // the next nearest is asked for, and its puzzle seated
  if (near != null) chunkDelay["chunk-lc-" + String(near).padStart(4, "0") + ".js"] = "fail";
  const two = await open(null, { mode: "ai" });
  const h2 = helpers(two.page);
  await toPuzzles(two.page);
  await two.page.waitForTimeout(500);
  await two.page.click("#pz-themes-open");
  await two.page.waitForTimeout(300);
  if (pick) await two.page.click('#theme-list button[data-theme="' + pick.id + '"]');
  await two.page.waitForTimeout(2500);
  const occ2 = await h2.occupied();
  const seated2 = LC.filter((p) => pick && p.themes.includes(pick.id)).find((p) => squaresOf(p.fen) === occ2 || mirror(squaresOf(p.fen)) === occ2);
  assert(!!seated2 && bandOf(seated2.rating) === bands[1], "f: 最近段载入失败，接着要下一段，照样摆出题",
    JSON.stringify({ want: bands[1], seated: seated2 && seated2.rating }));
  for (const k in chunkDelay) delete chunkDelay[k];
  await two.ctx.close();
}

// --- (g) a missed bank puzzle comes back in 复习 (v8-1-plan T6) ------------------
// B1 rated a Lichess puzzle but left it out of the review queue (its band may
// not be loaded when the queue is read). Now the queue keeps its id and the
// band it lives in; after a restart the review waits for that band — held
// back here — before it shows anything, and does not give up on 复习.
{
  const p1 = lcById("F0001");
  const band = "chunk-lc-" + String(Math.floor(p1.rating / 200) * 200).padStart(4, "0") + ".js";
  const { ctx, page } = await open(null, { mode: "ai" });
  const h = helpers(page);
  await toPuzzles(page);
  await page.waitForTimeout(500);
  await page.click("#pz-themes-open");
  await page.waitForTimeout(300);
  await page.click('#theme-list button[data-theme="m1"]');
  await page.waitForTimeout(800);
  await page.evaluate(() => { const d = document.querySelector("#puzzle-list")?.closest("details"); if (d) d.open = true; });
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("#puzzle-list button[data-i]")].find((x) => x.textContent.includes("#F0001"));
    if (b) b.click();
  });
  await page.waitForTimeout(500);
  h.view.flipped = true;
  const wrong = new Chess(p1.fen).moves({ verbose: true }).find((m) => m.from === "g8" && m.san.includes("+") && !m.san.includes("#"));
  await h.move(wrong.from, wrong.to);
  await h.feedback();
  const st = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
  assert(st.missed && st.missed["lc-F0001"] && st.bank && st.bank["lc-F0001"] === Math.floor(p1.rating / 200) * 200,
    "g: 答错的题库题进了复习队列（只存 id），旁边记下它所在的分块", JSON.stringify({ missed: st.missed, bank: st.bank }));
  assert(st.rhist && st.rhist.length === 1, "g: …照样计入评级", st.rhist && st.rhist.length);
  await ctx.close();

  // restart on 复习, the band slow to arrive
  chunkDelay[band] = 1500;
  const again = await open(Object.assign({}, st, { cat: "review" }), { early: true });
  const ha = helpers(again.page);
  ha.view.flipped = true;
  await again.page.waitForTimeout(3000);
  const tab = await again.page.evaluate(() => {
    const b = document.getElementById("pz-review");
    return b && b.classList.contains("active") ? document.getElementById("pz-review-n").textContent : "";
  });
  const stored = await again.page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")).cat);
  assert(await ha.faces(p1.fen) === true && stored === "review",
    "g: 重开之后，复习先等分块到了再摆出这道题（没有退回一步杀）", JSON.stringify({ occ: await ha.occupied(), stored }));
  assert(await again.page.evaluate((g) => !!window[g], "LC_BAND_" + band.slice(9, 13)), "g: …它等的正是这道题所在的分块", band);
  assert(/到期 1 道/.test(tab) && /黑先/.test(await ha.text("#puzzle-task") || ""), "g: 复习卡片亮着、数到它，题面照旧是黑先", tab);
  // solved cleanly: it advances along the ladder, due tomorrow, its band note kept
  const [a1, b1] = fromTo(p1.fen, p1.solution[0]);
  await ha.move(a1, b1);
  await ha.feedback();
  const st2 = await again.page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
  const e = st2.missed["lc-F0001"];
  assert(e && e.s === 1 && e.due > Date.now() + 3600000 && st2.bank["lc-F0001"] === st.bank["lc-F0001"],
    "g: 复习里做对，排到明天，分块记录还在", JSON.stringify({ e, bank: st2.bank }));
  await again.ctx.close();
  for (const k in chunkDelay) delete chunkDelay[k];

  // gone elsewhere while the band loads: 复习 does not pull the player back
  chunkDelay[band] = 1500;
  const away = await open(Object.assign({}, st, { cat: "m1" }));
  await away.page.click("#pz-review");
  await away.page.click('#rail button[data-view="play"]');
  await away.page.waitForTimeout(2500);
  const awayView = await away.page.evaluate(() => document.getElementById("app").getAttribute("data-view"));
  const awayCat = await away.page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")).cat);
  assert(awayView === "play" && awayCat === "m1", "g: 等分块时去了对局页，分块到了也不把人拉回复习", JSON.stringify({ awayView, awayCat }));
  await away.ctx.close();
  for (const k in chunkDelay) delete chunkDelay[k];

  // not due today: 复习 has nothing and asks for no band
  const later = await open(Object.assign({}, st2, { cat: "m1" }));
  const asked2 = [];
  later.page.on("request", (q) => { if (q.url().includes(band)) asked2.push(q.url()); });
  assert(/没有到期的/.test(await later.page.evaluate(() => document.getElementById("pz-review-n").textContent)), "g: 复习卡片写着没有到期的");
  await later.page.click("#pz-review");
  await later.page.waitForTimeout(800);
  const cat2 = await later.page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")).cat);
  assert(cat2 === "m1" && asked2.length === 0, "g: 还没到期的题库题不进今天的复习，也不去要分块", JSON.stringify({ cat2, asked2 }));
  await later.ctx.close();

  // a queue of local puzzles only (no bank ids, no band table) opens on 复习 as always
  const old = await open({ v: 1, solved: {}, missed: { "m1-backrank-r": { s: 0, n: 1, due: 0, ivl: 0 } }, cat: "review" });
  const ho = helpers(old.page);
  const m101 = data.CHESS_PUZZLES.find((p) => p.id === "m1-backrank-r");
  assert(!!m101 && await ho.faces(m101.fen) === false, "g: 只有本地题的复习队列照常打开", await ho.occupied());
  await old.ctx.close();
}

// --- (m) 9.0 S3: 按类做题 — a pool of both books, near the player's rating ---
// The six tiles replace the category row. 杀棋 is m1/m2/m3 from the built-in
// book and from the Lichess bands together: its count is both, its list is
// both once the bands nearest the rating are in, and it seats the unsolved
// puzzle nearest the rating — a 2300 player gets a Lichess 2300, not the
// book's 1900 ceiling.
{
  const now = Date.now(), R = 2300;
  const MATE = ["m1", "m2", "m3"];
  const localMate = data.CHESS_PUZZLES.concat(data.MINED_PUZZLES).filter((p) => p.fen && MATE.includes(p.cat));
  const lcMate = LC.filter((p) => MATE.includes(p.cat));
  const lcAsked = [];
  const { ctx, page } = await open({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1", rating: { r: R, rd: 60, vol: 0.06 }, ratedAt: now, rhist: [{ t: now - 1000, r: R }] });
  page.on("request", (q) => { const m = /chunk-lc-(\d{4})\.js/.exec(q.url()); if (m) lcAsked.push(+m[1]); });
  const h = helpers(page);
  const tiles = await page.evaluate(() => [...document.querySelectorAll("#pz-groups button[data-group]")].map((b) => ({ g: b.dataset.group, hidden: b.hidden, n: b.querySelector(".pz-tile-n").textContent, on: b.classList.contains("active") })));
  const mateN = localMate.length + MATE.reduce((n, id) => n + (LC_INDEX.themes[id] ? LC_INDEX.themes[id].n : 0), 0);
  const mate = tiles.find((x) => x.g === "mate");
  assert(tiles.map((x) => x.g).join() === "mate,tactic,endgame,defense,opening,mine" && tiles.find((x) => x.g === "mine").hidden,
    "m: 六块按类做题，没有错题时「我的错题」不出现", JSON.stringify(tiles.map((x) => x.g + (x.hidden ? "(隐)" : ""))));
  assert(mate && mate.n === mateN + " 题" && mate.on, "m: 杀棋这一块数的是内置 + 题库两本书（" + localMate.length + " + 题库），存着的一步杀落在这一块上", JSON.stringify(mate));
  await page.click('#pz-groups button[data-group="mate"]');
  await page.waitForTimeout(2500);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")).cat);
  const near = [...new Set(lcAsked)];
  const listed = async () => {
    await page.evaluate(() => { document.getElementById("pz-list-fold").open = true; });
    return page.evaluate(() => [...document.querySelectorAll("#puzzle-list button[data-i]")].map((b) => b.textContent));
  };
  let rows = await listed();
  const lcRows = rows.filter((x) => /#F\d{4}/.test(x)), localRows = rows.filter((x) => !/#F\d{4}/.test(x));
  const loadedLc = lcMate.filter((p) => near.includes(Math.floor(p.rating / 200) * 200));
  assert(stored === "grp:mate" && near.length > 0 && Math.min(...near.map((b) => Math.abs(b + 100 - R))) <= 100,
    "m: 点杀棋：存下 grp:mate，先去要离评级最近的分段", JSON.stringify({ stored, near }));
  assert(localRows.length === localMate.length && lcRows.length === loadedLc.length && lcRows.length > 0,
    "m: 列表里两本书都在：内置 " + localRows.length + " 道 + 题库（已到的分段）" + lcRows.length + " 道", JSON.stringify({ local: localMate.length, lc: loadedLc.map((p) => p.id) }));
  // the bands are in: into the tile again, and it seats the nearest of the pool
  await page.click('#pz-groups button[data-group="mate"]');
  await page.waitForTimeout(800);
  const pool = localMate.concat(loadedLc);
  const prOf = (p) => (Number.isFinite(p.rating) ? p.rating : null);
  const occ = await h.occupied();
  const seated = pool.find((p) => squaresOf(p.fen) === occ || mirror(squaresOf(p.fen)) === occ);
  const best = Math.min(...loadedLc.map((p) => Math.abs(p.rating - R)));
  assert(!!seated && seated.src === "lichess" && Math.abs(prOf(seated) - R) === best && Math.abs(prOf(seated) - R) < 100,
    "m: 分段到了再进杀棋，摆的是离 " + R + " 最近的题库题（内置题最高 1900）", JSON.stringify({ seated: seated && [seated.id, seated.rating], best, occ }));
  assert(new RegExp("难度 " + (seated ? seated.rating : "?")).test(await h.text("#puzzle-task") || "") &&
    await page.evaluate(() => document.querySelector('#pz-groups button[data-group="mate"]').classList.contains("active")),
    "m: 题面带着这道题的评级，杀棋这一块亮着", await h.text("#puzzle-task"));
  // solved: 下一题 stays in the pool
  if (seated) {
    h.view.flipped = seated.side === "b" || seated.fen.split(" ")[1] === "b";
    const g = new Chess(seated.fen);
    for (let k = 0; k < seated.solution.length; k += 2) {
      const m = g.move(seated.solution[k]);
      await h.move(m.from, m.to);
      await page.waitForTimeout(300);
      if (k + 1 < seated.solution.length) g.move(seated.solution[k + 1]);
    }
    await page.waitForTimeout(300);
    const solved = await page.evaluate((id) => !!JSON.parse(localStorage.getItem("chess.puzzles")).solved[id], seated.id);
    await page.click("#puzzle-next");
    await page.waitForTimeout(600);
    const occ2 = await h.occupied();
    const next = pool.find((p) => squaresOf(p.fen) === occ2 || mirror(squaresOf(p.fen)) === occ2);
    assert(solved && !!next && next.id !== seated.id && MATE.includes(next.cat) &&
      (await page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")).cat)) === "grp:mate",
      "m: 解出之后「下一题」还在杀棋这一池里", JSON.stringify({ solved, next: next && next.id }));
  }
  // 开局 is the book's opening drills, with the side row
  await page.click('#pz-groups button[data-group="opening"]');
  await page.waitForTimeout(600);
  const op = await page.evaluate(() => ({ cat: JSON.parse(localStorage.getItem("chess.puzzles")).cat, side: !document.getElementById("row-op-side").hidden,
    lit: (document.querySelector("#pz-groups button.active") || { dataset: {} }).dataset.group }));
  assert(op.cat === "op" && op.side && op.lit === "opening", "m: 开局这一块就是背谱（op），执方一行出现", JSON.stringify(op));
  await ctx.close();
}

// --- (h) 看 N 步后 / 盲走收官 (v8-2-plan T2) ------------------------------------
// Both modes are chunk-visual.js, and a set is a pure function of its seed —
// the clock when it starts, pinned here with page.clock — and the book. The
// node side loads the same module over the same book and checks that the
// page shows exactly the question it derives; the answers are then worked
// out here with chess.js, not read off the page.
const VIS = (() => {
  const c = { console };
  c.globalThis = c; c.window = c;
  vm.createContext(c);
  vm.runInContext(compileModuleSync(path.join(ROOT, "js/trainer/visual-modes.js")), c, { filename: "module" });
  return c.CHESS_VISUAL;
})();
const BOOK = data.CHESS_PUZZLES.concat(data.MINED_PUZZLES);
// v8-3-plan T1: a set draws from the bank's band for the mode's rating (a new
// player's 1500: look 1400, blind 1500 − 150 → 1200), the local book when the
// band does not load; the generator's own checks below run on the local book
const LOCAL_LOOK = VIS.lookPool(BOOK);
const LOCAL_BLIND = VIS.blindPool(BOOK);
data.LC_INDEX = LC_INDEX;
const Db = data.ChessPuzzleDb;
const bandList = (b) => (data["LC_BAND_" + String(b).padStart(4, "0")] || []).map(Db.decodeRow);
const lookBand = (r = 1500) => VIS.bankBand(LC_INDEX, Db.bandFor(r), []);
const blindBand = (r = 1500) => VIS.bankBand(LC_INDEX, Db.bandFor(r - 150), ["m1", "m2"]);
const LOOK_POOL = VIS.lookPool(bandList(lookBand()));
const blindAt = (seed, k, lvl, used, band = blindBand()) => VIS.blindNext(VIS.blindPool(bandList(band)), LOCAL_BLIND, seed, k, lvl, used);
/** a blind review key: the id, and a bank puzzle's band */
const blindKey = (p) => (p.src === "lichess" ? p.id + "|" + Math.floor(p.rating / 200) * 200 : p.id);
const visState = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles") || "{}"));
const visSaid = async (page) => { await page.waitForTimeout(150); return page.evaluate(() => document.getElementById("pz-vis-say").textContent); };
/** the right answer to look question `q`, given on the board */
async function answerLook(page, h, q) {
  h.view.flipped = q.start.split(" ")[1] === "b";
  if (q.t === "mate" && !q.mates.length) await page.click("#pz-vis-none");
  else if (q.t === "mate") await h.move(q.mates[0].from, q.mates[0].to);
  else await h.tap(q.answers[0]);
  await page.waitForTimeout(300);
}
/** a square that is not an answer to `q` (for the wrong answer) */
const wrongSquare = (q) => ["a1", "h8", "a8", "h1", "d4", "e5"].find((s) => !(q.answers || []).includes(s));
{
  // node side: the same seed, the same question; another seed, another set
  const T = 1790600000000, seed = (T >>> 0) || 1;
  const a = await VIS.lookQuestion(Chess, LOCAL_LOOK, seed, 0, 2), b = await VIS.lookQuestion(Chess, LOCAL_LOOK, seed, 0, 2);
  const others = [];
  for (const k of [1, 2, 3, 4, 5]) others.push(JSON.stringify((await VIS.lookQuestion(Chess, LOCAL_LOOK, seed + k, 0, 2)).sans));
  assert(a && JSON.stringify(a) === JSON.stringify(b) && a.sans.length === 2, "h: 同一种子两次生成同一道题", a && a.key);
  assert(new Set(others).size > 1, "h: 换种子题目就不同", others.join(" / "));
  const ns = [];
  for (const n of [2, 3, 4, 5, 6]) ns.push(((await VIS.lookQuestion(Chess, LOCAL_LOOK, seed, 7, n)) || { sans: [] }).sans.length);
  assert(ns.join() === "2,3,4,5,6", "h: N 从 2 到 6 都生成得出（着法条数）", ns.join());
  // every question kind comes out of the generator, and each is answerable
  const kinds = {};
  for (let k = 0; k < 60; k++) {
    const q = await VIS.lookQuestion(Chess, LOCAL_LOOK, seed, k, 2 + (k % 5));
    const kk = q.t + (q.t === "mate" && !q.mates.length ? "-none" : "");
    kinds[kk] = (kinds[kk] || 0) + 1;
    const ans = q.t === "mate" ? (q.mates.length ? { move: q.mates[0] } : { none: true }) : { sq: q.answers[0] };
    if (!VIS.judgeLook(Chess, q, ans)) { kinds.bad = (kinds.bad || 0) + 1; }
  }
  assert(kinds.cap && kinds.check && kinds.mate && kinds["mate-none"] && !kinds.bad, "h: 三种问题（和「没有一步杀」）都出得来，每道都有答案", JSON.stringify(kinds));
  const pa = VIS.parseAnswer(Chess, "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "d1d8", true);
  const pb = VIS.parseAnswer(Chess, "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", "Rd8#", true);
  assert(pa && pb && pa.san === "Rd8#" && pb.move.to === "d8" && VIS.parseAnswer(Chess, "8/8/8/8/8/8/8/K6k w - - 0 1", "没有").none,
    "h: 键盘输入认 UCI、SAN 和「没有」", JSON.stringify([pa, pb]));
}
{
  // 看 N 步: the board stays still, the moves are text, the question is chess.js's
  const T = 1790600000000, seed = (T >>> 0) || 1;
  const { ctx, page } = await open(null);
  const h = helpers(page);
  await page.clock.setFixedTime(T);
  await page.click('#pz-modes button[data-run="look"]');
  await page.waitForTimeout(900);
  const q0 = await VIS.lookQuestion(Chess, LOOK_POOL, seed, 0, 2);
  assert(q0 && q0.pid.startsWith("lc-") && LOOK_POOL.some((p) => p.id === q0.pid), "h: 看 N 步的题来自题库按评级取的分段（新玩家 1500 → " + lookBand() + "）", q0 && q0.key);
  h.view.flipped = q0.start.split(" ")[1] === "b";
  assert(await h.shown("#pz-vis") && await h.shown("#pz-run") && !(await h.shown("#pz-groups-sec")), "h: 看 N 步的卡片出现，练习的选题让位");
  assert((await h.text("#pz-vis-moves")).includes(VIS.lineText(q0.start, q0.sans)), "h: 固定种子，列出的着法就是生成的那两步",
    await h.text("#pz-vis-moves") + " | " + VIS.lineText(q0.start, q0.sans));
  assert(await h.faces(q0.start) === h.view.flipped, "h: 棋盘停在出题的局面，不走", await h.occupied());
  const said0 = await visSaid(page);
  assert(said0.includes(q0.sans[0]) && said0.includes(await h.text("#pz-vis-q")), "h: 读屏的 live 区读出着法和问题", said0);
  assert(/看 N 步/.test(await h.text("#pz-run-head")) && /第 1\/10 题/.test(await h.text("#pz-run-head")), "h: 卡片写着规则和第几题", await h.text("#pz-run-head"));
  await answerLook(page, h, q0);
  assert(/答对了/.test(await h.feedback()) && /得分 1/.test(await h.text("#pz-run-score")), "h: 答对，得分 1", await h.feedback());
  assert(await h.faces(q0.fen) === h.view.flipped, "h: 答完棋盘摆出问的那个局面", await h.occupied());
  assert(await h.shown("#pz-vis-next") && !(await h.shown("#pz-vis-row")), "h: 答完出现「下一题」，输入框收起");
  await page.click("#pz-vis-next");
  await page.waitForTimeout(500);
  // right answer: N goes up one
  const q1 = await VIS.lookQuestion(Chess, LOOK_POOL, seed, 1, 3);
  assert((await h.text("#pz-vis-moves")).includes(VIS.lineText(q1.start, q1.sans)) && /看 3 步/.test(await h.text("#pz-run-head")),
    "h: 答对一题，下一题看 3 步", await h.text("#pz-vis-moves"));
  // a wrong answer, typed: the review queue, the rating, the week's record
  await page.fill("#pz-vis-in", q1.t === "mate" ? (q1.mates.length ? "没有" : "a1") : wrongSquare(q1));
  await page.press("#pz-vis-in", "Enter");
  await page.waitForTimeout(400);
  const st = await visState(page);
  const look = (st.vis || {}).look || {};
  assert(/答错了/.test(await h.feedback()) && await h.text("#puzzle-fb-sub"), "h: 答错，说出正确答案", await h.feedback());
  assert(look.q && look.q[q1.key] && look.solve === 1 && look.miss === 1 && look.rating && look.rating.r,
    "h: 答错的题进「看 N 步」自己的复习队列，评级另记", JSON.stringify(look).slice(0, 200));
  assert(!Object.keys(st.missed || {}).length && !st.rating, "h: 不碰做题的复习队列和做题评级", JSON.stringify({ missed: st.missed, rating: st.rating }));
  const prog = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.progress") || "{}"));
  const wk = Object.values(prog.weeks || {})[0] || { cats: {} };
  assert(wk.cats.look && wk.cats.look.s === 1 && wk.cats.look.m === 1, "h: 这一周的进步记录里有「看 N 步」一对一错", JSON.stringify(wk.cats));
  // determinism across pages: a second page at the same clock opens on the same moves
  const two = await open(null);
  await two.page.clock.setFixedTime(T);
  await two.page.click('#pz-modes button[data-run="look"]');
  await two.page.waitForTimeout(900);
  assert((await helpers(two.page).text("#pz-vis-moves")).includes(VIS.lineText(q0.start, q0.sans)), "h: 另开一页，同一时刻开始，第一题相同");
  await two.ctx.close();
  // the queue: the next set opens on the question that was missed
  const again = await open(st);
  await again.page.clock.setFixedTime(T + 86400000);
  await again.page.click('#pz-modes button[data-run="look"]');
  await again.page.waitForTimeout(900);
  const ha = helpers(again.page);
  assert((await ha.text("#pz-vis-moves")).includes(VIS.lineText(q1.start, q1.sans)) && /复习/.test(await ha.text("#pz-run-head")),
    "h: 下一组先出复习题（答错的那道）", await ha.text("#pz-run-head"));
  // 我的: the section, its rows and the way back
  await again.page.click('#rail button[data-view="me"]');
  await again.page.waitForFunction(() => !document.getElementById("sec-vis").hidden, null, { timeout: 4000 }).catch(() => {});
  assert(await ha.shown("#sec-vis") && /计算专项/.test(await ha.text("#vis-h")) && /对 1 \/ 错 1/.test(await ha.text("#vis-body")),
    "h: 「我的」有计算专项一节，记着对错", await ha.text("#vis-body"));
  await again.ctx.close();
  await ctx.close();
}
for (const [lang, label, head, ask, go] of [["en", "Look ahead", /Look ahead/, /to move/, "Answer"], ["ja", "N手先読み", /N手先読み/, /番/, "解答"]]) {
  // the other two languages: the door, the card, the question and the field
  const { ctx, page } = await open(null, { lang });
  const h = helpers(page);
  assert(await h.text('#pz-modes button[data-run="look"]') === label, `h/${lang}: 入口按钮是「${label}」`);
  await page.clock.setFixedTime(1790600000000);
  await page.click('#pz-modes button[data-run="look"]');
  await page.waitForTimeout(900);
  assert(head.test(await h.text("#pz-run-head")) && ask.test(await h.text("#pz-vis-q")) && await h.text("#pz-vis-go") === go,
    `h/${lang}: 卡片、问题与按钮都是这种语言`, (await h.text("#pz-run-head")) + " | " + (await h.text("#pz-vis-q")));
  assert(!/[一-鿿]{2}/.test((await h.text("#pz-vis")) || "") || lang === "ja", `h/${lang}: 卡片里没有中文`, await h.text("#pz-vis"));
  await page.click('#pz-modes button[data-run="blind"]');
  await page.waitForTimeout(900);
  assert(await h.text('#pz-modes button[data-run="blind"]') === (lang === "en" ? "Blind mate" : "目隠し詰め") &&
    (lang === "en" ? /Blind mate/ : /目隠し詰め/).test(await h.text("#pz-run-head")), `h/${lang}: 盲走的卡片也是这种语言`, await h.text("#pz-run-head"));
  await ctx.close();
}
{
  // 盲走, keyboard only: into the mode, the moves typed, on to the next
  const T = 1790700000000, seed = (T >>> 0) || 1;
  const { ctx, page } = await open(null);
  const h = helpers(page);
  await page.clock.setFixedTime(T);
  await page.focus('#pz-modes button[data-run="blind"]');
  await page.keyboard.press("Enter");
  await page.waitForTimeout(900);
  const p0 = blindAt(seed, 0, 0, []);
  assert(p0 && p0.cat === "m1" && p0.id.startsWith("lc-") && await h.faces(p0.fen) === (p0.fen.split(" ")[1] === "b"), "h/盲走: 固定种子，第一题是题库分段里的这道一步杀，先亮出局面", p0 && p0.id);
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === "pz-vis-in", "h/盲走: 焦点落在输入框");
  const said = await visSaid(page);
  assert(/一步杀/.test(said) && said.includes("K" + new Chess(p0.fen).board().flat().find((x) => x && x.type === "k" && x.color === "w").square),
    "h/盲走: 读屏读出题目和子的位置", said);
  await page.waitForTimeout(3300);
  assert(await h.occupied() === "", "h/盲走: 3 秒后棋子隐去，只剩空棋盘", await h.occupied());
  assert(/棋子已隐藏/.test(await visSaid(page)), "h/盲走: 读屏说棋子藏起来了");
  await page.keyboard.type(p0.solution[0]);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  assert(/答对了/.test(await h.feedback()) && /得分 1/.test(await h.text("#pz-run-score")), "h/盲走: 敲出杀着，答对", await h.feedback());
  assert((await h.occupied()).length > 0, "h/盲走: 答完棋子重新露出来");
  assert(await page.evaluate(() => document.activeElement && document.activeElement.id) === "pz-vis-next", "h/盲走: 焦点到「下一题」");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  // a solve moves the next one up to a mate in two
  const p1 = blindAt(seed, 1, 1, [p0.id]);
  assert(p1 && p1.cat === "m2" && await h.faces(p1.fen) === (p1.fen.split(" ")[1] === "b"), "h/盲走: 答对之后来一道两步杀", p1 && p1.id);
  await page.waitForTimeout(3300);
  // UCI this time: the reply is said, since it cannot be seen
  const g1 = new Chess(p1.fen);
  const m1 = g1.move(p1.solution[0]);
  await page.keyboard.type(m1.from + m1.to);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const reply = await visSaid(page);
  assert(reply.includes(p1.solution[1]) && /轮到你/.test(reply), "h/盲走: 对方的应着读出来", reply);
  assert(/已走/.test(await h.text("#pz-vis-moves")), "h/盲走: 卡片上写着已走的着法", await h.text("#pz-vis-moves"));
  await page.keyboard.type(p1.solution[2]);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  assert(/答对了/.test(await h.feedback()) && /得分 2/.test(await h.text("#pz-run-score")), "h/盲走: 两步杀走完，得分 2", await h.feedback());
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  // a wrong move: the mode's own queue, the puzzle's id
  const p2 = blindAt(seed, 2, 1, [p0.id, p1.id]);
  const g2 = new Chess(p2.fen);
  // a move that lets Black escape: some reply leaves no mate in one
  const wrong = g2.moves().find((m) => {
    g2.move(m);
    const bad = !g2.game_over() && g2.moves().some((r) => { g2.move(r); const y = !hasMateIn(g2, 1); g2.undo(); return y; });
    g2.undo();
    return bad;
  });
  await page.keyboard.type("Zz9");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(200);
  assert(/这步走不了/.test(await visSaid(page)) && /得分 2/.test(await h.text("#pz-run-score")), "h/盲走: 走不了的着法只提示，不算错");
  await page.keyboard.press("Control+A");
  await page.keyboard.type(wrong);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(1500);
  const st = await visState(page);
  const blind = (st.vis || {}).blind || {};
  assert(/答错了/.test(await h.feedback()) && blind.q && blind.q[blindKey(p2)] && blind.solve === 2 && blind.miss === 1,
    "h/盲走: 走错进「盲走」自己的复习队列", JSON.stringify(blind).slice(0, 200));
  await ctx.close();
}

// --- (i) M2 评审：看 N 步 / 盲走的修正 -------------------------------------------
{
  // P2-2: an en-passant capture was asked as 「吃掉 X 上的…」 with X empty —
  // manW(null) threw in render and the set froze. Every question the book can
  // give, where the line itself reaches an en-passant chance (the probe's
  // exhaustive set), over many question seeds: a capture question names a
  // man of the other side on its square, and each answer is a man of the side to move
  const epLines = [];
  for (const p of LOCAL_LOOK) {
    const line = p.line || p.solution || [];
    const g = new Chess(p.fen);
    for (let n = 1; n <= Math.min(6, line.length); n++) {
      if (!g.move(line[n - 1]) || g.game_over()) break;
      if (n >= 2 && g.moves({ verbose: true }).some((m) => m.flags.includes("e"))) epLines.push([p, n]);
    }
  }
  let asked = 0, epSeen = 0;
  const bad = [];
  const check = (q) => {
    if (!q) return;
    asked++;
    const g = new Chess(q.fen);
    if (g.moves({ verbose: true }).some((m) => m.flags.includes("e"))) epSeen++;
    const ok = q.t === "cap" ? !!g.get(q.sq) && g.get(q.sq).color !== q.side && !!q.target && q.target.type === g.get(q.sq).type
      && q.answers.length > 0 && q.answers.every((a) => g.get(a) && g.get(a).color === q.side)
      : q.t === "check" ? q.answers.length > 0 && q.answers.every((a) => g.get(a) && g.get(a).color === q.side)
      : Array.isArray(q.mates);
    if (!ok) bad.push(q.key + " " + q.t + " " + q.sq);
  };
  for (const [p, n] of epLines) for (let s = 1; s <= 400; s++) check(await VIS.buildLook(Chess, p, n, s));
  // …and the generator the sets use, every level, a spread of set seeds
  for (let seed = 1; seed < 5; seed++) for (let k = 0; k < 10; k++) for (let n = 2; n <= 6; n++) check(await VIS.lookQuestion(Chess, LOCAL_LOOK, seed * 7919, k, n));
  assert(epLines.length > 0 && epSeen > 0 && !bad.length,
    "i/P2-2: 过路兵局面在内，每道「看 N 步」题都有真实的目标子和答案（" + asked + " 道，" + epLines.length + " 个过路兵局面）", bad.slice(0, 3).join(" | "));
  // P3-7: castling with the digit zero; a promotion without its piece is no move
  const pf = "r3k2r/1P6/8/8/8/8/8/R3K2R w KQkq - 0 1";
  const pa = (x, mf) => VIS.parseAnswer(Chess, pf, x, mf) || { none: false, nil: true };
  assert(pa("0-0", true).san === "O-O" && pa("0-0-0", true).san === "O-O-O" && pa("o-o", true).san === "O-O",
    "i/P3-7: 0-0 与 0-0-0（数字零）也认作易位");
  assert(pa("bxa8", true).nil && pa("b8", true).nil && (pa("bxa8=Q", true).move || {}).promotion === "q" && (pa("bxa8Q", true).move || {}).to === "a8",
    "i/P3-7: 要走子时缺升变子的 bxa8 / b8 不算答案（交给「这步走不了」），bxa8=Q、bxa8Q 照认");
  assert(pa("b8", false).sq === "b8", "i/P3-7: 问格子的题里 b8 仍是格子");
}
{
  // P2-2 on the page: the review question the reviewer hit opens without an error, the card not blank
  const before = errs.length;
  const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { q: { "mn-301-38-72|3|1955526313": { s: 0, n: 1, due: 0, ivl: 0 } } } } });
  const h = helpers(page);
  await page.click('#pz-modes button[data-run="look"]');
  await page.waitForTimeout(1500);
  assert(errs.length === before && !!(await h.text("#pz-vis-q")) && !!(await h.text("#pz-vis-moves")),
    "i/P2-2: 出过路兵吃子题的那道复习题：没有异常，卡片有问题可答", (await h.text("#pz-vis-q")) + " | " + errs.slice(before).join(" | "));
  await ctx.close();
}
{
  // 盲走: P3-1 an answer inside the 3 s stays shown; P3-2 a hidden board says
  // and shows nothing of its men; P3-6 a refused load keeps the answer card
  const T = 1790700000000, seed = (T >>> 0) || 1;
  const lib = JSON.stringify({ v: 1, names: ["me"], games: [{ id: "g1", t: 1758000000000, white: "me", black: "rival",
    date: "2026.09.01", event: "Casual", result: "1-0", plies: 4, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win" }] });
  const { ctx, page } = await open(null, { extra: { "chess.library": lib, "chess.save": JSON.stringify({ v: 1, pgn: "1. d4 d5 2. c4 *" }) } });
  const h = helpers(page);
  await page.clock.setFixedTime(T);
  await page.click('#pz-modes button[data-run="blind"]');
  await page.waitForTimeout(600);
  const p0 = blindAt(seed, 0, 0, []);
  await page.fill("#pz-vis-in", p0.solution[0]);
  await page.press("#pz-vis-in", "Enter");
  await page.waitForTimeout(300);
  const shownAt = (await h.occupied()).length;
  await page.waitForTimeout(3500);
  const b = await page.evaluate(() => { const r = document.getElementById("board").getBoundingClientRect(); return { x: r.left + 10, y: r.top + 10 }; });
  await page.mouse.move(b.x, b.y);
  await page.mouse.move(b.x + 60, b.y + 60);
  await page.evaluate(() => window.dispatchEvent(new Event("resize"))); // any redraw shows what the model says
  await page.waitForTimeout(300);
  assert(/答对了/.test(await h.feedback()) && shownAt > 0 && (await h.occupied()).length === shownAt,
    "i/P3-1: 3 秒内答对，3 秒计时到了棋子也不再藏起来", shownAt + " → " + (await h.occupied()).length);
  await page.click("#pz-vis-next");
  await page.waitForTimeout(3500);
  const p1 = blindAt(seed, 1, 1, [p0.id]);
  const g1 = new Chess(p1.fen);
  h.view.flipped = g1.turn() === "b";
  assert(await h.occupied() === "", "i: 下一题 3 秒后藏子");
  await page.focus("#board");
  const heard = [];
  for (const k of ["Enter", "ArrowUp", "ArrowLeft", "ArrowRight", "ArrowDown"]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(120);
    heard.push(await page.evaluate(() => document.getElementById("board-live").textContent));
  }
  assert(heard.every((x) => /(^|· )[a-h][1-8]$/.test(x)), "i/P3-2: 藏子时键盘光标只读格名，不报子", heard.join(" / "));
  await page.keyboard.press("Escape");
  const own = g1.board().flat().find((x) => x && x.color === g1.turn()).square;
  const hover = async (sq) => {
    const pt = await page.evaluate(([q, f]) => { const r = document.getElementById("board").getBoundingClientRect(); let fi = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]); if (f) { fi = 7 - fi; rk = 7 - rk; } return { x: r.left + (fi + .5) * r.width / 8, y: r.top + (rk + .5) * r.height / 8 }; }, [sq, h.view.flipped]);
    await page.mouse.move(pt.x, pt.y);
    await page.waitForTimeout(100);
    return page.evaluate(() => document.getElementById("board").style.cursor);
  };
  assert(await hover(own) !== "grab", "i/P3-2: 藏子时指针在自己的子上不变成「可抓」", own);
  // solve it, then a library load answered 取消: the answer card stays, no next question
  for (const k of [0, 2]) {
    await page.fill("#pz-vis-in", p1.solution[k]);
    await page.press("#pz-vis-in", "Enter");
    await page.waitForTimeout(700);
  }
  const head = await h.text("#pz-run-head");
  assert(/答对了/.test(await h.feedback()) && await h.shown("#pz-vis-next") && /第 2\/10 题/.test(head), "i: 两步杀答完，停在答案卡", head);
  await page.click('#rail button[data-view="library"]');
  await page.waitForTimeout(300);
  await page.click("#lib-open");
  await page.waitForTimeout(400);
  await page.click("#lib-list button[data-lib]");
  await page.waitForTimeout(700);
  const askedLoad = await page.isVisible("#confirm-cancel");
  if (askedLoad) await page.click("#confirm-cancel");
  await page.waitForTimeout(600);
  await toPuzzles(page);
  await page.waitForTimeout(500);
  const head2 = await h.text("#pz-run-head");
  assert(askedLoad && head2 === head && await h.shown("#pz-vis-next") && /答对了/.test(await h.feedback()),
    "i/P3-6: 读库一局被取消后，盲走还停在这一题的答案卡，没有自己跳到下一题", head + " → " + head2);
  await ctx.close();
}

// --- (j) v8-3-plan T1 / T2：题库分段、分段载不进来、引擎接续 ---------------------
const due0 = { s: 0, n: 1, due: 0, ivl: 0 };
const visMoves = (page, ms = 20000) => page.waitForFunction(() => document.getElementById("pz-vis-moves").textContent.length > 0, null, { timeout: ms })
  .then(() => page.evaluate(() => document.getElementById("pz-vis-moves").textContent), () => "");
{
  // T1: the band follows each mode's own rating (look 2100 → 2000; blind 2150 − 150 → 2000)
  const T = 1790800000000, seed = (T >>> 0) || 1;
  const rated = (r) => ({ rating: { r, rd: 80, vol: 0.06 }, solve: 1, q: {} });
  const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: rated(2100), blind: rated(2150) } });
  const h = helpers(page);
  await page.clock.setFixedTime(T);
  await page.click('#pz-modes button[data-run="look"]');
  const q = await VIS.lookQuestion(Chess, VIS.lookPool(bandList(lookBand(2100))), seed, 0, 2);
  const shown = await visMoves(page);
  assert(lookBand(2100) === 2000 && q.pid.startsWith("lc-") && shown.includes(VIS.lineText(q.start, q.sans)),
    "j/T1: 看 N 步评级 2100，题从 2000 分段出", q.key + " | " + shown);
  await page.click('#pz-modes button[data-run="blind"]');
  await page.waitForTimeout(900);
  const p = blindAt(seed, 0, 0, [], blindBand(2150));
  assert(blindBand(2150) === 2000 && p.id.startsWith("lc-") && p.rating >= 2000 && p.rating < 2200 && await h.faces(p.fen) === (p.fen.split(" ")[1] === "b"),
    "j/T1: 盲走评级 2150，一步杀从 2000 分段出", p.id + " " + p.rating);
  await ctx.close();
}
{
  // T1: a band that does not load — both modes go on with the local book
  const T = 1790600000000, seed = (T >>> 0) || 1;
  const files = [lookBand(), blindBand()].map((b) => "chunk-lc-" + String(b).padStart(4, "0") + ".js");
  for (const f of files) chunkDelay[f] = "fail";
  const before = errs.length;
  const { ctx, page } = await open(null);
  const h = helpers(page);
  await page.clock.setFixedTime(T);
  await page.click('#pz-modes button[data-run="look"]');
  const q = await VIS.lookQuestion(Chess, LOCAL_LOOK, seed, 0, 2);
  const shown = await visMoves(page);
  assert(!q.pid.startsWith("lc-") && shown.includes(VIS.lineText(q.start, q.sans)) && !!(await h.text("#pz-vis-q")),
    "j/T1: 分段载不进来，看 N 步从本地题库出题", shown);
  await answerLook(page, h, q);
  assert(/答对了/.test(await h.feedback()), "j/T1: 本地题照常作答", await h.feedback());
  await page.click('#pz-modes button[data-run="blind"]');
  await page.waitForTimeout(900);
  const p = VIS.blindPick(LOCAL_BLIND, seed, 0, 0, []);
  assert(!p.id.startsWith("lc-") && await h.faces(p.fen) === (p.fen.split(" ")[1] === "b"), "j/T1: 分段载不进来，盲走从本地的一步杀出题", p.id);
  assert(errs.length === before, "j/T1: 分段失败没有异常", errs.slice(before).join(" | "));
  for (const f of files) delete chunkDelay[f];
  await ctx.close();
}
{
  // T2: past the puzzle's line, the engine's move — a review asked at N = 6
  // runs well past a bank puzzle's line; the page's real engine and the same
  // Stockfish here, at the review's node count, must agree, and differ from
  // pickMove's rule (else this would prove nothing)
  const engSrc = path.join(ROOT, "js", "engine-src.js");
  if (!fs.existsSync(engSrc) || fs.statSync(engSrc).size < 1000) spawnSync(process.execPath, [path.join(HERE, "gen-engine-src.mjs")], { stdio: "inherit" });
  const { startEngine } = await import("./lib/sf-node.mjs");
  const sf = await startEngine(Chess, 1);
  const best = (fen) => sf.bestAt(fen, VIS.LOOK_BUDGET * 450); // engine.js nodesFor: NODES_PER_MS 450
  let key = null, q = null, plain = null;
  for (const p of LOOK_POOL) {
    if (key || p.solution.length >= 5) continue;
    for (let qs = 1; qs <= 20 && !key; qs++) {
      const e = await VIS.buildLook(Chess, p, 6, qs, best);
      const o = await VIS.buildLook(Chess, p, 6, qs);
      if (e && o && JSON.stringify(e.sans) !== JSON.stringify(o.sans)) { key = e.key; q = e; plain = o; }
    }
  }
  assert(!!key && /\|1400$/.test(key), "j/T2: 找到一道线走完还要接着走的题（复习键带分段）", key);
  const st = { v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q: { [key]: due0 } } } };
  realEngine = true;
  const seen = [];
  for (let i = 0; i < 2; i++) {
    const { ctx, page } = await open(st);
    const t0 = Date.now();
    await page.click('#pz-modes button[data-run="look"]');
    seen.push(await visMoves(page, 60000));
    if (i === 0) console.log("  j/T2: 引擎启动 + 出第一题", Date.now() - t0, "ms");
    await ctx.close();
  }
  realEngine = false;
  const want = VIS.lineText(q.start, q.sans);
  assert(seen[0].includes(want) && seen[1].includes(want), "j/T2: 线走完以后是引擎的着法（页面与本地 Stockfish 同一定节点），两页相同",
    seen.join(" / ") + " | 期望 " + want + " | pickMove 规则 " + (plain ? VIS.lineText(plain.start, plain.sans) : "—"));
  // engine unavailable (the stub): the same review falls back to pickMove's rule and the set goes on
  if (plain) {
    const { ctx, page } = await open(st);
    await page.click('#pz-modes button[data-run="look"]');
    const fb = await visMoves(page);
    assert(fb.includes(VIS.lineText(plain.start, plain.sans)) && !!(await helpers(page).text("#pz-vis-q")),
      "j/T2: 没有引擎时照 pickMove 的规则接着走，题照常出", fb);
    await ctx.close();
  } else assert(false, "j/T2: 选出的复习题在 pickMove 规则下也要出得来");
}

// --- (k) v8-3-plan T1 / T2 的 M2 评审：出题的先后、本地题的复习键、引擎的重试与 Hash、离开就停
{
  // P2-2: a local puzzle's review key (no band) is built by pickMove's rule
  // alone, engine or not — over keys that run past the puzzle's line. The
  // "engine" here is any legal move pickMove would not choose, so a key
  // built with it could not pass.
  const other = (fen) => { const ms = new Chess(fen).moves({ verbose: true }); const m = ms[ms.length - 1]; return Promise.resolve(m ? m.from + m.to + (m.promotion || "") : null); };
  let same = 0, past = 0, built = 0;
  const diff = [];
  for (let i = 0; i < 40; i++) {
    const p = LOCAL_LOOK[(i * 37) % LOCAL_LOOK.length], n = 2 + (i % 5), qs = 1000 + i;
    const old = await VIS.buildLook(Chess, p, n, qs);
    const now = await VIS.buildLook(Chess, p, n, qs, other);
    if (JSON.stringify(old) === JSON.stringify(now)) same++; else diff.push(p.id + "|" + n + "|" + qs);
    if (old) built++;
    if (old && n > (p.line || p.solution || []).length) past++;
  }
  assert(same === 40 && past >= 5 && built >= 20, "k/P2-2: 本地题的复习键（没有分段）照 pickMove 的规则逐字节重建，有引擎也不用（" + past + " 道走过题目自带的线）", diff.slice(0, 3).join(" "));
  // …and a bank question whose engine move would mate takes pickMove's ply instead of being thrown away
  // Black plays the line's a6; White's Rd8# would end the game with nothing to ask
  const bank = { id: "lc-T0001", src: "lichess", rating: 1500, cat: "m1", fen: "6k1/p4ppp/8/8/8/8/1q3PPP/3R2K1 b - - 0 1", solution: ["a6"] };
  const mate = () => Promise.resolve("d1d8");
  const qs = [];
  for (let s = 1; s <= 30; s++) qs.push(await VIS.buildLook(Chess, bank, 2, s, mate));
  const ok = qs.filter(Boolean);
  assert(ok.length > 0 && ok.every((q) => q.sans[1] !== "Rd8#" && /\|1400$/.test(q.key)), "k/P2-2: 引擎这一步会将死时改用 pickMove 接着走，题照出（" + ok.length + "/30）", ok[0] && ok[0].sans.join(" "));
}
{
  // P3-1: a stale (cancelled) search is asked again — up to five times — and
  // every look search asks for the same Hash, whatever the player set
  const fake = (nulls) => {
    const calls = [];
    return { calls, analyze: (fen, budget, opts) => { calls.push(opts); return Promise.resolve(calls.length > nulls ? { best: "e2e4" } : null); } };
  };
  const ask = (E) => (VIS.askEngine ? VIS.askEngine(E, "8/8/8/8/8/8/4P3/K6k w - - 0 1") : Promise.resolve("—"));
  const e3 = fake(3), e9 = fake(9);
  const r3 = await ask(e3), r9 = await ask(e9);
  assert(r3 === "e2e4" && e3.calls.length === 4, "k/P3-1: 被取消的搜索连着重问，第 4 次拿到着法", r3 + " / " + e3.calls.length);
  assert(r9 === null && e9.calls.length === 5, "k/P3-1: 重问有上限（5 次），之后交给 pickMove", r9 + " / " + e9.calls.length);
  assert(e3.calls.every((o) => o && o.hash === 32), "k/P3-1: 每次都按固定的 Hash 32 MB 搜", JSON.stringify(e3.calls[0]));
}
{
  // P2-1: a set still being made when the player does something else is dropped
  const lookFile = "chunk-lc-" + String(lookBand()).padStart(4, "0") + ".js";
  chunkDelay[lookFile] = 2500;
  const busy = (page, run) => page.evaluate((r) => document.querySelector('#pz-modes button[data-run="' + r + '"]').getAttribute("aria-busy"), run);
  const active = (page) => page.evaluate(() => { const b = document.querySelector("#pz-modes button.active"); return b && b.dataset.run; });
  {
    const { ctx, page } = await open(null);
    const h = helpers(page);
    await page.click('#pz-modes button[data-run="look"]');
    const busy0 = await busy(page, "look");
    await page.waitForTimeout(150);
    await page.click('#pz-modes button[data-run="blind"]');
    await page.waitForTimeout(4000);
    assert(busy0 === "true" && await busy(page, "look") === null && await busy(page, "blind") === null,
      "k/P2-1: 看 N 步出题期间按钮标着 aria-busy，换了模式就撤掉", busy0 + " / " + await busy(page, "look"));
    assert(await active(page) === "blind" && /盲走/.test(await h.text("#pz-run-head")) && await h.shown("#pz-run-stop"),
      "k/P2-1: 先点看 N 步、再点盲走：看 N 步迟到的一组不再顶掉正在做的盲走", (await active(page)) + " | " + await h.text("#pz-run-head"));
    const st = await visState(page);
    assert(!(st.runs && st.runs.blind), "k/P2-1: 盲走没有被当成结束的一组记分", JSON.stringify(st.runs));
    await ctx.close();
  }
  {
    const { ctx, page } = await open(null);
    await page.click('#pz-modes button[data-run="look"]');
    await page.waitForTimeout(150);
    await page.click('#rail button[data-view="play"]');
    await page.waitForTimeout(4000);
    const v = await page.evaluate(() => [document.getElementById("app").getAttribute("data-view"), JSON.parse(localStorage.getItem("chess.settings")).mode]);
    assert(v[0] === "play" && v[1] !== "puzzle", "k/P2-1: 先点看 N 步、再去对局页：出好的题不把人拉回谜题", JSON.stringify(v));
    await ctx.close();
  }
  delete chunkDelay[lookFile];
}
{
  // with the real engine: P2-2 a local key on the page, P3-1 the Hash, P3-3 leaving stops the searches
  const { startEngine } = await import("./lib/sf-node.mjs");
  const sf = await startEngine(Chess, 1);
  const best = (fen) => sf.bestAt(fen, VIS.LOOK_BUDGET * 450);
  // P2-2: a local puzzle's key whose engine line differs from pickMove's
  let k82 = null, q82 = null;
  for (const p of LOCAL_LOOK) {
    if (k82 || (p.line || p.solution || []).length >= 5) continue;
    for (let qs = 1; qs <= 10 && !k82; qs++) {
      const o = await VIS.buildLook(Chess, p, 6, qs);
      const e = await VIS.buildLook(Chess, Object.assign({}, p, { src: "lichess", rating: 1500 }), 6, qs, best);
      if (o && e && JSON.stringify(o.sans) !== JSON.stringify(e.sans)) { k82 = o.key; q82 = o; }
    }
  }
  assert(!!k82 && !/\|\d{4}$/.test(k82), "k/P2-2: 找到一道本地题的复习键，引擎会走得和 pickMove 不同", k82);
  // two bank keys whose lines run out early: N = 6 needs at least three searches each
  const short = [];
  for (const p of LOOK_POOL) {
    if (short.length >= 2 || (p.line || p.solution).length > 3) continue;
    for (let qs = 1; qs <= 3; qs++) { const q = await VIS.buildLook(Chess, p, 6, qs, best); if (q) { short.push(q); break; } }
  }
  const [qa, qb] = short;
  assert(!!qa && !!qb && /\|\d{4}$/.test(qa.key), "k: 两道线很短的题库题（看 6 步要搜至少 3 步）", qa && qa.key);
  realEngine = true;
  const settings = (hash) => JSON.stringify({ mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, view: "train", hash });
  const watch = (page) => page.evaluate(() => {
    window.__sent = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (m, t) { if (typeof m === "string") window.__sent.push(m); return post.call(this, m, t); };
    window.__evals = [];
    window.__engineProbe = (j) => { if (j.kind === "eval") window.__evals.push(Date.now()); };
  });
  {
    const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q: { [k82]: due0 } } } }, { extra: { "chess.settings": settings(128) } });
    await watch(page);
    await page.click('#pz-modes button[data-run="look"]');
    const shown = await visMoves(page, 60000);
    assert(shown.includes(VIS.lineText(q82.start, q82.sans)), "k/P2-2: 页面上本地题的复习题与 pickMove 出的相同（引擎在也不用）", shown + " | 期望 " + VIS.lineText(q82.start, q82.sans));
    await ctx.close();
  }
  if (qa && qb) {
    // P3-3, the set being made: back to practice (9.0 S3: a tile of 按类做题)
    // before the first question is in — no search after it but the one running
    const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q: { [qa.key]: due0 } } } });
    await watch(page);
    await page.click('#pz-modes button[data-run="look"]');
    await page.waitForFunction(() => window.__evals.length > 0, null, { timeout: 30000 }).catch(() => {});
    await page.click('#pz-groups button[data-group="mate"]');
    const left = await page.evaluate(() => Date.now());
    await page.waitForTimeout(5000);
    const after = await page.evaluate((t) => window.__evals.filter((x) => x > t).length, left);
    const act = await page.evaluate(() => ({ run: (document.querySelector("#pz-modes button.active") || { dataset: {} }).dataset.run || null,
      card: !document.getElementById("pz-run").hidden, tile: (document.querySelector("#pz-groups button.active") || { dataset: {} }).dataset.group || null }));
    assert(after <= 1 && !act.run && !act.card && act.tile === "mate", "k/P3-3: 出第一题时回到练习（点杀棋）：之后不再排引擎搜索，这一组也不开始", after + " 次 / " + JSON.stringify(act));
    await ctx.close();
  }
  if (qa && qb) {
    // P3-3, the set going on: the next question is being built when 练习 ends the set; P3-1: Hash 32 whatever the setting
    const q = { [qb.key]: due0, [qa.key]: Object.assign({}, due0, { due: 1 }) };
    const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q } } }, { extra: { "chess.settings": settings(128) } });
    const h = helpers(page);
    await watch(page);
    await page.click('#pz-modes button[data-run="look"]');
    const shown = await visMoves(page, 60000);
    assert(shown.includes(VIS.lineText(qb.start, qb.sans)), "k: 第一道复习题出来了", shown);
    // answered, and 练习 in the same task: the answer has already asked for
    // the next question's first search (it runs to its node count — nothing
    // cuts it short), and no other may follow it
    const said = qb.t === "mate" ? (qb.mates.length ? qb.mates[0].san : "") : qb.answers[0];
    const before = await page.evaluate((x) => {
      const n = window.__evals.length;
      if (x) { document.getElementById("pz-vis-in").value = x; document.getElementById("pz-vis-go").click(); } else document.getElementById("pz-vis-none").click();
      document.getElementById("pz-run-stop").click(); // 9.0 S3: 结束 ends the set
      return n;
    }, said);
    await page.waitForTimeout(5000);
    const after = await page.evaluate((n) => window.__evals.length - n, before);
    const ended = await h.shown("#pz-run-again") && !(await h.shown("#pz-run-stop"));
    assert(/答对了/.test(await h.feedback()) && ended && after <= 1,
      "k/P3-3: 答完一题、下一题刚要出时结束这一组：除了已经发出的一次，不再排引擎搜索", after + " 次, 结束 " + ended);
    const sent = await page.evaluate(() => window.__sent);
    const hashes = [];
    sent.forEach((m, i) => { if (/^go nodes /.test(m)) { const hs = sent.slice(0, i).filter((x) => /Hash value/.test(x)); hashes.push(hs.length ? hs[hs.length - 1].split(" ").pop() : "?"); } });
    assert(hashes.length >= 3 && hashes.every((x) => x === "32"), "k/P3-1: 设置里 Hash 是 128，看 N 步的每次搜索仍按 32", hashes.join(","));
    await ctx.close();
  }
  // (l) v8-4-plan T1: 开始一组到第一题出现 ≤ 1 s（CI 放宽）——新的一组；复习题带着
  // 自己的引擎着法（vis.look.eng）时不搜；没带的键答错一次之后就带上
  {
    const cap = process.env.CI ? 2500 : 1000;
    const firstAt = async (page) => {
      const t0 = Date.now();
      await page.click('#pz-modes button[data-run="look"]');
      const shown = await visMoves(page, 60000);
      return { ms: Date.now() - t0, shown };
    };
    const gos = (page) => page.evaluate(() => window.__sent.filter((m) => /^go nodes /.test(m)).length);
    {
      const { ctx, page } = await open(null);
      await watch(page);
      const { ms, shown } = await firstAt(page);
      assert(shown && ms <= cap, "l/T1: 新的一组，点下去到第一题出现 ≤ " + cap + " ms", ms + " ms");
      await ctx.close();
    }
    if (qa) {
      // the plies qa's key would keep, worked out here against the same Stockfish
      const p = LOOK_POOL.find((x) => x.id === qa.pid);
      const seen = new Map();
      const tee = async (fen) => { const u = await best(fen); if (u) seen.set(VIS.fenTag(fen), u); return u; };
      const again = await VIS.buildLook(Chess, p, qa.n, Number(qa.key.split("|")[2]), tee);
      const eng = VIS.engPlies(Chess, again, seen);
      assert(JSON.stringify(again) === JSON.stringify(qa) && eng.split(",").length >= 3, "l/T1: qa 的引擎着法（至少 3 步）", eng);
      {
        const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q: { [qa.key]: due0 }, eng: { [qa.key]: eng } } } });
        await watch(page);
        const { ms, shown } = await firstAt(page);
        assert(shown.includes(VIS.lineText(qa.start, qa.sans)) && await gos(page) === 0 && ms <= cap,
          "l/T1: 复习题带着引擎着法：不搜一次，与引擎出的同一道题，第一题 ≤ " + cap + " ms", ms + " ms, " + await gos(page) + " 次搜索");
        await ctx.close();
      }
      {
        // a key without plies: searched; a wrong answer files the plies with the key
        const { ctx, page } = await open({ v: 1, solved: {}, vis: { look: { solve: 0, miss: 1, q: { [qa.key]: due0 } } } });
        await watch(page);
        const { shown } = await firstAt(page);
        const searched = await gos(page);
        const wrong = qa.t === "mate" ? (qa.mates.length ? "没有" : new Chess(qa.fen).moves()[0]) : wrongSquare(qa);
        await page.fill("#pz-vis-in", wrong);
        await page.press("#pz-vis-in", "Enter");
        await page.waitForTimeout(400);
        const look = ((await visState(page)).vis || {}).look || {};
        assert(shown.includes(VIS.lineText(qa.start, qa.sans)) && searched >= 3 && look.q[qa.key] && look.eng && look.eng[qa.key] === eng,
          "l/T1: 没带引擎着法的复习键搜出同一道题；答错后键旁记下这几步引擎着法", searched + " 次搜索, " + JSON.stringify(look.eng));
        await ctx.close();
      }
    }
  }
  realEngine = false;
}

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
