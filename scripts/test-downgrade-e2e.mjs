/**
 * Downgrade to 8.0 / 8.1 and back (v8-2-plan V3).
 *
 * release-notes「降级回 8.0」said what was known — the library's summary
 * marker is dropped — and what was not: whether 8.1's new fields (a game's
 * `lad` and `tc`, the endgame camp's `learn.eg`) come back after 8.0 has
 * read and written the same profile. Nobody had run it. This does, for the
 * two releases a player can actually go back to, on one origin so both
 * builds read the same localStorage and IndexedDB, exactly as an older app
 * would read the WebView data the newer one left:
 *
 *   a) the current build writes a full profile through its own UI where that
 *      is cheap (a rated game, a library import with its summary rows, a
 *      repertoire import, a solved puzzle) and from the writers' own shapes
 *      where a run needs the real engine (endgame camp `learn.eg`, guess
 *      results `learn.gs`, `puzzleState.vis`) — then boots once more, so what
 *      is compared is what 8.2 itself keeps;
 *   b) the old build opens it and does what a player would: plays and files a
 *      game, solves a puzzle, opens 学习, imports a library game and a
 *      repertoire line;
 *   c) the current build opens it again; every field of (a) is compared, and
 *      every write of (b) has to be there too.
 *
 * What is lost is not hidden: EXPECT below is the table README「降级」and
 * plan §9 M3 are written from, and the test fails when the measured outcome
 * of a field is not the one written there — in either direction.
 *
 * The old builds are made here, from their tags (git archive of the tag →
 * npm ci → its own scripts/bundle.mjs), into node_modules/.cache, keyed by
 * the tag's commit; a second run reuses them. Nothing of them is committed.
 * A shallow clone (CI) fetches the two tags first. Each build's bundle size
 * is pinned: a different number means this did not build what was shipped.
 *
 *   node scripts/test-downgrade-e2e.mjs            both versions
 *   DOWNGRADE_ONLY=v8.0.0 node scripts/test-downgrade-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import crypto from "crypto";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { Chess } from "../src/web/js/chess.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, "..");
const CURRENT = path.join(REPO, "src", "web");
const CACHE = process.env.DOWNGRADE_CACHE || path.join(REPO, "node_modules", ".cache", "chess-downgrade");

/** The shipped main bundle of each release, in bytes (v8-1-plan / v8-2-plan §2). */
const SHIPPED = { "v8.0.0": 1200498, "v8.1.0": 900972 };
const TAGS = Object.keys(SHIPPED).filter((t) => !process.env.DOWNGRADE_ONLY || process.env.DOWNGRADE_ONLY === t);

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok  ", msg);
  else { failed++; console.error("FAIL", msg, extra != null ? " " + extra : ""); }
};

// --- the old builds ----------------------------------------------------------
const git = (args, opts) => execFileSync("git", args, Object.assign({ cwd: REPO, encoding: "utf8" }, opts));

/** The commit `tag` names, fetching it first when this clone has not got it. */
function tagCommit(tag) {
  const look = () => { try { return git(["rev-parse", "--verify", "-q", tag + "^{commit}"]).trim(); } catch { return ""; } };
  let sha = look();
  if (!sha) {
    git(["fetch", "--no-tags", "--depth=1", "origin", "refs/tags/" + tag + ":refs/tags/" + tag], { stdio: "inherit" });
    sha = look();
  }
  if (!sha) throw new Error("没有 " + tag);
  return sha;
}

/** src/web of release `tag`, built by its own bundler; cached by commit. */
function oldBuild(tag) {
  const sha = tagCommit(tag);
  const dir = path.join(CACHE, tag + "-" + sha.slice(0, 12));
  const stamp = path.join(dir, "built.json");
  const web = path.join(dir, "src", "web");
  if (fs.existsSync(stamp)) return Object.assign({ web, cached: true }, JSON.parse(fs.readFileSync(stamp, "utf8")));
  const t0 = Date.now();
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  const tar = git(["archive", "--format=tar", sha, "package.json", "package-lock.json", "scripts", "src/web"], { encoding: "buffer", maxBuffer: 1 << 30 });
  execFileSync("tar", ["-x", "-C", dir], { input: tar });
  // the tag's own lock: its esbuild, not ours, made what shipped
  execFileSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  execFileSync(process.execPath, ["scripts/bundle.mjs"], { cwd: dir, stdio: ["ignore", "ignore", "inherit"] });
  const bundle = fs.readFileSync(path.join(web, "js", "bundle.js"));
  const info = { tag, sha, bytes: bundle.length, sha256: crypto.createHash("sha256").update(bundle).digest("hex"), ms: Date.now() - t0 };
  fs.writeFileSync(stamp, JSON.stringify(info));
  return Object.assign({ web, cached: false }, info);
}

const BUILDS = {};
for (const tag of TAGS) {
  const b = BUILDS[tag] = oldBuild(tag);
  console.log(tag, b.sha.slice(0, 7), b.cached ? "(cached)" : "(built in " + (b.ms / 1000).toFixed(1) + " s)", b.bytes, "bytes", b.sha256.slice(0, 12));
  assert(b.bytes === SHIPPED[tag], tag + ": 从标签构建出的主包与发布时同样大（" + SHIPPED[tag] + "）", b.bytes);
}

// --- one origin, three builds ------------------------------------------------
let root = CURRENT;
const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".json": "application/json", ".svg": "image/svg+xml" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // no-store: switching builds must never be answered from the HTTP cache
  const head = (type) => ({ "content-type": type, "cache-control": "no-store" });
  if (p === "/js/engine-src.js") { res.writeHead(200, head("text/javascript")); res.end("// stub"); return; }
  try {
    const d = fs.readFileSync(path.join(root, p));
    res.writeHead(200, head(MIME[path.extname(p)] || "application/octet-stream"));
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

const SCRATCH = path.join(REPO, "node_modules", ".cache", "downgrade-e2e");
fs.mkdirSync(SCRATCH, { recursive: true });

/** Open the app as build `web` (CURRENT or an old src/web) in `ctx`. */
async function open(ctx, web) {
  root = web;
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => !!window.__chess, null, { timeout: 15000 });
  await page.waitForTimeout(1200);
  await page.click("#pick-cancel", { timeout: 800 }).catch(() => {});
  return { page, errs };
}

async function view(page, v) {
  await page.click('#rail button[data-view="' + v + '"]');
  await page.waitForTimeout(400);
}

/** Feed a file picker. */
async function importFile(page, name, text, button) {
  const file = path.join(SCRATCH, name);
  fs.writeFileSync(file, text);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(button)]);
  await chooser.setFiles(file);
  await page.waitForTimeout(900);
}

/** Click a square's centre; `flip`: Black at the bottom. */
async function tap(page, sq, flip) {
  const p = await page.evaluate(([n, fl]) => {
    const r = document.getElementById("board").getBoundingClientRect();
    let f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    if (fl) { f = 7 - f; rk = 7 - rk; }
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, [sq, !!flip]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(160);
}

/** Everything stored: localStorage parsed, and the two IndexedDB databases. */
async function snapshot(page) {
  return page.evaluate(async () => {
    const ls = {};
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), v = localStorage.getItem(k);
      try { ls[k] = JSON.parse(v); } catch { ls[k] = v; }
    }
    const dump = (name) => new Promise((resolve) => {
      const req = indexedDB.open(name);
      req.onupgradeneeded = () => { req.transaction.abort(); };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result, out = { version: db.version, stores: {} };
        const names = [...db.objectStoreNames];
        if (!names.length) { db.close(); resolve(out); return; }
        const tx = db.transaction(names, "readonly");
        for (const s of names) {
          const st = tx.objectStore(s), keys = st.getAllKeys(), vals = st.getAll();
          vals.onsuccess = () => { const o = {}; keys.result.forEach((k, i) => { o[String(k)] = vals.result[i]; }); out.stores[s] = o; };
        }
        tx.oncomplete = () => { db.close(); resolve(out); };
        tx.onerror = () => { db.close(); resolve(out); };
      };
    });
    return { ls, lib: await dump("chessboard.library"), rep: await dump("chessboard.repertoire") };
  });
}

// --- the profile -------------------------------------------------------------
/**
 * Repertoire lines to import. v8-2-plan T4 lifts the 400-line cap and moves
 * the lines into chessboard.repertoire; when it lands, raise this past 400 so
 * the downgrade covers a book an older build cannot hold in its header.
 */
const REP_LINES = 40;
/** `n` distinct legal White lines from the start, one game each. */
function repertoirePgn(n) {
  const g = new Chess(), out = [];
  const firsts = ["e4", "d4", "c4", "Nf3"];
  for (const a of firsts) {
    g.move(a);
    for (const b of g.moves()) {
      g.move(b);
      for (const c of g.moves().slice(0, 4)) {
        if (out.length >= n) break;
        out.push(`[Event "rep ${out.length}"]\n[Result "*"]\n\n1. ${a} ${b} 2. ${c} *\n`);
      }
      g.undo();
      if (out.length >= n) break;
    }
    g.undo();
    if (out.length >= n) break;
  }
  return out.join("\n");
}

const LIB_PGN = [1, 2, 3, 4, 5].map((i) => `[Event "Rated blitz"]\n[Site "lichess"]\n[Date "2026.09.0${i}"]\n` +
  `[White "${i % 2 ? "hxddh" : "rival" + i}"]\n[Black "${i % 2 ? "rival" + i : "hxddh"}"]\n[Result "${i % 2 ? "1-0" : "0-1"}"]\n[TimeControl "180+2"]\n\n` +
  `1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 ${i % 2 ? "1-0" : "0-1"}\n`).join("\n");
const OLD_LIB_PGN = (tag) => `[Event "${tag}"]\n[Site "lichess"]\n[Date "2026.09.20"]\n[White "hxddh"]\n[Black "old-${tag}"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 c6 1/2-1/2\n`;

/**
 * What 8.2 writes for the runs that need a real engine or a long session,
 * in the shapes their writers produce (trainer/endgames.js record,
 * trainer/guess.js finish, trainer/visual-modes.js solved/missed). Merged
 * into what the current build has stored, then the current build boots on
 * it and writes it back — so the snapshot is 8.2's own.
 */
function trainerSeed(now) {
  const srs = (due) => ({ s: 0, n: 1, due, ivl: 0 });
  return {
    eg: { done: { "kp-outside": now - 5e6, "rp-lucena": now - 4e6 }, srs: { "dr-philidor": srs(now - 1e5) } },
    gs: { "morphy-opera-1858": { w: { same: 15, n: 17, avg: 1.2, at: now - 3e6 } }, "anderssen-kieseritzky-1851": { w: { same: 9, n: 23, avg: 4.4, at: now - 2e6 }, b: { same: 3, n: 22, avg: 8.1, at: now - 1e6 } } },
    vis: {
      look: { rating: { r: 1180, rd: 140, vol: 0.06 }, solve: 6, miss: 3, at: now - 2e6, q: { "m1-1|3|77": srs(now - 1e5) } },
      blind: { rating: { r: 1320, rd: 160, vol: 0.06 }, solve: 4, miss: 1, at: now - 1e6, q: { "m2-4": srs(now + 1e8) } },
    },
    runs: { look: { best: 7, at: now - 2e6 }, blind: { best: 5, at: now - 1e6 } },
    // this week's answers in the progress file, under the two modes' own names
    cats: { look: { m: 3, s: 6 }, blind: { m: 1, s: 4 } },
  };
}

// --- (b) what an old build does --------------------------------------------
/** Play 1.e4 against the computer and resign through the confirmation: the game is filed. */
async function fileGame(page) {
  await view(page, "play");
  await page.keyboard.press("n");
  await page.waitForTimeout(300);
  await page.click("#ng-start", { timeout: 1500 }).catch(() => {});
  await page.waitForTimeout(500);
  await tap(page, "e2"); await tap(page, "e4");
  await page.waitForTimeout(400);
  // 认输 asks first. The engine is a stub here, and while a build still says
  // 引擎思考中 the button may not answer yet — so ask until the question is up.
  let asked = false;
  for (let i = 0; i < 40 && !asked; i++) {
    await page.evaluate(() => document.getElementById("btn-resign").click());
    asked = await page.waitForSelector("#confirm-modal.show", { state: "attached", timeout: 500 }).then(() => true, () => false);
  }
  if (!asked) throw new Error("认输没有弹出确认");
  await page.waitForTimeout(300);
  await page.evaluate(() => document.getElementById("confirm-ok").click());
  await page.waitForTimeout(700);
}

/** The puzzle on the board (a mate in one: the profile's category is m1), played. */
async function solvePuzzle(page) {
  await view(page, "puzzle");
  await page.waitForTimeout(600);
  const fen = await page.evaluate(() => window.__chess.puzzle && window.__chess.puzzle());
  if (!fen) return null;
  const g = new Chess(fen);
  const m = g.moves({ verbose: true }).find((x) => { g.move(x); const mate = g.in_checkmate(); g.undo(); return mate; });
  if (!m) return null;
  const flip = g.turn() === "b";
  await tap(page, m.from, flip); await tap(page, m.to, flip);
  await page.waitForTimeout(700);
  return m.san;
}

/** Open 学习: the build starts the bookmarked lesson, or its last one when it has fewer. */
async function openLearn(page) {
  await view(page, "learn");
  await page.waitForTimeout(800);
}

// --- (c) the comparison ------------------------------------------------------
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const lsOf = (s, k) => s.ls["chess.v1." + k] || {};
const libGames = (s) => (s.lib && s.lib.stores.games) || {};
const repRows = (s) => (s.rep && s.rep.stores.repertoire) || {};
/** Summary rows, as {game id: row}, from every `sum:` key of the library's meta store. */
function sumRows(s) {
  const out = {};
  const meta = (s.lib && s.lib.stores.meta) || {};
  for (const [k, v] of Object.entries(meta)) if (k.startsWith("sum:")) for (const r of JSON.parse(v)) out[r.id] = r;
  return out;
}
const pick = (o, keys) => Object.fromEntries(keys.filter((k) => k in (o || {})).map((k) => [k, o[k]]));

/**
 * The fields compared, each a reading of a snapshot. Its outcome is
 * kept (the old build left it alone), restored (the old build dropped it and
 * 8.2 put it back) or lost (not there when 8.2 comes back). EXPECT says which
 * one each field is, per version — what README「降级」and plan §9 M3 say.
 */
function fields(s1) {
  const g82 = lsOf(s1, "stats").games[0].id;
  const game = (s) => (lsOf(s, "stats").games || []).find((g) => g.id === g82) || {};
  const libIds = Object.keys(libGames(s1));
  const solved82 = Object.keys(lsOf(s1, "puzzles").solved || {});
  return {
    "stats.lad": (s) => game(s).lad,
    "stats.tc": (s) => game(s).tc,
    "stats.rated": (s) => pick(game(s), ["rb", "ra", "perf", "diff", "style"]),
    "settings.difficulty": (s) => lsOf(s, "settings").difficulty,
    "settings.bgWorker": (s) => lsOf(s, "settings").bgWorker,
    "settings.look": (s) => pick(lsOf(s, "settings"), ["appearance", "boardId", "boardFrame", "pieceSet", "themeId", "langId",
      "soundOn", "soundSet", "volume", "textSize", "coordsOn", "hash", "multipv", "humanColor", "timeControl", "personaId"]),
    "learn.last": (s) => lsOf(s, "learn").last,
    "learn.done": (s) => lsOf(s, "learn").done,
    "learn.eg": (s) => lsOf(s, "learn").eg,
    "learn.gs": (s) => lsOf(s, "learn").gs,
    "puzzles.vis": (s) => lsOf(s, "puzzles").vis,
    "puzzles.runs": (s) => lsOf(s, "puzzles").runs,
    "puzzles.solved": (s) => pick(lsOf(s, "puzzles").solved, solved82),
    "progress.vis": (s) => Object.fromEntries(Object.entries(lsOf(s, "progress").weeks || {})
      .map(([w, x]) => [w, pick(x.cats, ["look", "blind"])])),
    "library.games": (s) => pick(libGames(s), libIds),
    "library.names": (s) => lsOf(s, "library").names,
    "library.sum": (s) => lsOf(s, "library").sum,
    "repertoire.lines": (s) => lsOf(s, "repertoire").w,
    "repertoire.records": (s) => pick(repRows(s), Object.keys(repRows(s1))),
  };
}

/** Per version: the fields that are not simply kept. */
const EXPECT = {
  "v8.0.0": {
    // 8.0's settings writer is a fixed list: no bgWorker (8.1), and a rung
    // it does not know falls back to its default
    "settings.difficulty": "lost", "settings.bgWorker": "lost",
    // 96 lessons in 8.0 and 8.1: opening 学习 there starts the last of them
    // and bookmarks it; 8.2 puts its own bookmark back (trainer/lessons.js `l2`)
    "learn.last": "restored",
    // known since 8.1: 8.0 rewrites the library header without `sum`; 8.2
    // rebuilds the summary on the next boot (README 8.1.0「降级回 8.0」)
    "library.sum": "restored",
  },
  "v8.1.0": {
    "learn.last": "restored",
  },
};

// --- run ---------------------------------------------------------------------
const NOW = Date.now();
const WEEK = await (async () => {
  const d = new Date(NOW);
  // ISO week, the way progress.js keys its weeks
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return t.getUTCFullYear() + "-W" + String(Math.ceil(((t - y0) / 864e5 + 1) / 7)).padStart(2, "0");
})();

const report = {};
for (const tag of TAGS) {
  console.log("\n== " + tag + " ==");
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  // the profile's first state, once: a reload and the other builds see what was written since
  await ctx.addInitScript(() => {
    if (localStorage.getItem("chess.v1.settings")) return;
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "ai", difficulty: "hardplus", bgWorker: true, humanColor: "w",
      langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "green", pieceSet: "merida", textSize: "l" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1" }));
    // 第 101 课 (part 3) is the bookmark; one lesson of each part done
    localStorage.setItem("chess.v1.learn", JSON.stringify({ v: 1, done: { board: true, "cl-cands": true }, last: 100 }));
  });

  // (a) 8.2 writes
  let { page, errs } = await open(ctx, CURRENT);
  const errs82 = errs;
  await fileGame(page);
  const san82 = await solvePuzzle(page);
  await view(page, "library");
  await importFile(page, "lib.pgn", LIB_PGN, "#lib-import");
  await importFile(page, "rep.pgn", repertoirePgn(REP_LINES), "#rep-import-w");
  await page.waitForTimeout(800);
  await page.evaluate(([seed, week]) => {
    const learn = JSON.parse(localStorage.getItem("chess.v1.learn"));
    Object.assign(learn, { eg: seed.eg, gs: seed.gs });
    localStorage.setItem("chess.v1.learn", JSON.stringify(learn));
    const pz = JSON.parse(localStorage.getItem("chess.v1.puzzles"));
    Object.assign(pz, { vis: seed.vis, runs: Object.assign(pz.runs || {}, seed.runs) });
    localStorage.setItem("chess.v1.puzzles", JSON.stringify(pz));
    const pr = JSON.parse(localStorage.getItem("chess.v1.progress") || '{"v":1,"weeks":{},"days":{}}');
    const w = pr.weeks[week] = pr.weeks[week] || { cats: {}, mined: 0, red: 0 };
    Object.assign(w.cats, seed.cats);
    localStorage.setItem("chess.v1.progress", JSON.stringify(pr));
  }, [trainerSeed(NOW), WEEK]);
  // one position of the book practised: its card is what a rebuild of the
  // index has to carry over by id (rep-page.js)
  await page.evaluate((card) => new Promise((resolve, reject) => {
    const req = indexedDB.open("chessboard.repertoire");
    req.onsuccess = () => {
      const db = req.result, tx = db.transaction("repertoire", "readwrite"), st = tx.objectStore("repertoire");
      const all = st.getAll();
      all.onsuccess = () => { const r = all.result.find((x) => x.side === "w" && x.path === "e4 Nc6"); if (r) st.put(Object.assign(r, { card })); };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  }), { s: 2, n: 3, due: NOW + 3 * 864e5, ivl: 3 });
  await page.close();
  ({ page, errs } = await open(ctx, CURRENT));
  await openLearn(page);
  await view(page, "library");
  await page.waitForTimeout(1500);
  const s1 = await snapshot(page);
  errs82.push(...errs);
  await page.close();
  fs.writeFileSync(path.join(SCRATCH, tag + "-1.json"), JSON.stringify(s1, null, 1));
  const st1 = lsOf(s1, "stats").games || [];
  assert(st1.length === 1 && st1[0].lad === 2 && typeof st1[0].tc === "string",
    tag + " (a): 8.2 记下的这盘带 lad: 2 和 tc", JSON.stringify(st1[0]));
  assert(!!san82 && Object.keys(lsOf(s1, "puzzles").solved || {}).length === 1, tag + " (a): 8.2 解了一题", san82);
  assert(Object.keys(libGames(s1)).length === 6 && !!lsOf(s1, "library").sum && Object.keys(sumRows(s1)).length === 6,
    tag + " (a): 棋谱库 6 局（导入 5 + 本机 1），头里有摘要标记、6 行摘要", Object.keys(libGames(s1)).length);
  assert((lsOf(s1, "repertoire").w || []).length === REP_LINES && Object.keys(repRows(s1)).length > 0 &&
    Object.values(repRows(s1)).some((r) => r.path === "e4 Nc6" && r.card && r.card.n === 3),
    tag + " (a): 开局书 " + REP_LINES + " 条线，数据库里有按局面的记录，其中一张卡练过三次", Object.keys(repRows(s1)).length);
  assert(lsOf(s1, "learn").last === 100 && !!lsOf(s1, "learn").eg && !!lsOf(s1, "learn").gs && !!lsOf(s1, "puzzles").vis,
    tag + " (a): 8.2 自己启动一次之后，书签、eg、gs、vis 都在", JSON.stringify(lsOf(s1, "learn")).slice(0, 200));
  assert(lsOf(s1, "settings").difficulty === "hardplus" && lsOf(s1, "settings").bgWorker === true,
    tag + " (a): 设置里是 8.1 起才有的档（hardplus）、第二个引擎开着");
  assert(errs82.length === 0, tag + " (a): 8.2 没有页面异常", errs82.join(" / "));

  // (b) the old build on the same storage
  ({ page, errs } = await open(ctx, BUILDS[tag].web));
  await fileGame(page);
  const sanOld = await solvePuzzle(page);
  await openLearn(page);
  await view(page, "library");
  await importFile(page, "old-" + tag + ".pgn", OLD_LIB_PGN(tag), "#lib-import");
  await importFile(page, "rep-b.pgn", `[Event "b"]\n[Result "*"]\n\n1. d4 Nf6 2. c4 e6 *\n`, "#rep-import-b");
  await page.waitForTimeout(1500);
  const s2 = await snapshot(page);
  await page.close();
  fs.writeFileSync(path.join(SCRATCH, tag + "-2.json"), JSON.stringify(s2, null, 1));
  assert(errs.length === 0, tag + " (b): 旧版读 8.2 的档案没有页面异常", errs.join(" / "));
  const oldGame = (lsOf(s2, "stats").games || []).find((g) => !st1.some((x) => x.id === g.id));
  assert(!!oldGame && oldGame.ending === "resigned", tag + " (b): 旧版记下了它下的一盘", JSON.stringify(oldGame));
  const oldSolved = Object.keys(lsOf(s2, "puzzles").solved || {}).find((id) => !(id in (lsOf(s1, "puzzles").solved || {})));
  assert(!!sanOld && !!oldSolved, tag + " (b): 旧版解了一题（" + sanOld + "）", oldSolved);
  const oldLib = Object.values(libGames(s2)).find((g) => g.event === tag);
  assert(!!oldLib, tag + " (b): 旧版往棋谱库导入了一局");
  assert((lsOf(s2, "repertoire").b || []).length === 1, tag + " (b): 旧版导入了一条执黑的线");

  // (c) back to 8.2
  ({ page, errs } = await open(ctx, CURRENT));
  await view(page, "library");
  await page.waitForTimeout(2500);
  const s3 = await snapshot(page);
  await page.close();
  fs.writeFileSync(path.join(SCRATCH, tag + "-3.json"), JSON.stringify(s3, null, 1));
  assert(errs.length === 0, tag + " (c): 回到 8.2 没有页面异常", errs.join(" / "));

  // every field of (a), by outcome
  const F = fields(s1), want = EXPECT[tag] || {}, got = {};
  for (const [name, read] of Object.entries(F)) {
    const v1 = read(s1), v2 = read(s2), v3 = read(s3);
    const outcome = eq(v1, v3) ? (eq(v1, v2) ? "kept" : "restored") : "lost";
    got[name] = outcome;
    const exp = want[name] || "kept";
    assert(outcome === exp, tag + " (c): " + name + " —— " + exp + (outcome === exp ? "" : "，实际 " + outcome),
      outcome === "lost" ? JSON.stringify(v1).slice(0, 160) + " → " + JSON.stringify(v3).slice(0, 160) : "");
  }
  report[tag] = got;
  // …and every write of (b)
  assert((lsOf(s3, "stats").games || []).some((g) => g.id === oldGame?.id), tag + " (c): 旧版下的那盘还在战绩里");
  assert(Object.values(libGames(s3)).some((g) => g.src === "local" && g.ref === oldGame?.id), tag + " (c): ……也在棋谱库的本机对局里");
  assert(!!oldSolved && (oldSolved in (lsOf(s3, "puzzles").solved || {})), tag + " (c): 旧版解的那题还记着");
  assert(!!oldLib && !!libGames(s3)[oldLib.id], tag + " (c): 旧版导入的那局还在棋谱库");
  const ids3 = Object.keys(libGames(s3)), rows3 = sumRows(s3);
  assert(ids3.length === 8 && ids3.every((id) => rows3[id]) && Object.keys(rows3).length === 8,
    tag + " (c): 摘要行覆盖棋谱库的全部 8 局", ids3.length + " / " + Object.keys(rows3).length);
  assert((lsOf(s3, "repertoire").b || []).length === 1 &&
    Object.values(repRows(s3)).some((r) => r.side === "b" && r.path === "d4 Nf6 c4"),
    tag + " (c): 旧版加的执黑线在书里，按局面的记录也有它", JSON.stringify(Object.keys(repRows(s3))).slice(0, 200));
}

console.log("\n" + JSON.stringify(report, null, 1));
await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("全部通过");
