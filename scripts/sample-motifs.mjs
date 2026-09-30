/**
 * v8-1-plan T6 — how often is each of the 19 coach motifs right?
 *
 * B3 (docs/coach-audit-8.0.md) could put a precision on only four motifs:
 * the other fifteen were never said on its 40 games. This samples every
 * motif at least MIN_PER_MOTIF times from real games and judges each case
 * against a deeper engine search with a written rubric
 * (scripts/lib/motif-oracle.mjs). A motif whose error rate is above 5% falls
 * back to material-only wording (explain.js MATERIAL_ONLY), B3's rule.
 *
 * Where the positions come from — all real games:
 *   - the Lichess puzzle database (database.lichess.org, CC0): every row is a
 *     position from a rated game with the move that was actually played
 *     there (the first of `Moves`) — a blunder, by construction. Rows are
 *     drawn per Lichess theme (hangingPiece, fork, xRayAttack, …) so rare
 *     motifs are reachable at all, plus a uniform draw across the file; the
 *     theme only decides which rows are *tried*: what counts as a case is
 *     what the app says about it, and the app never reads Lichess themes.
 *   - the repo's games: scripts/fixtures/corpus.mjs (28), coach-games.mjs
 *     (12), and the synced samples in src/sync-fixtures (Lichess, Chess.com).
 *
 * Stages (each resumable: output is JSONL, done ids are skipped, so a
 * container restart re-runs nothing; --shard=k/n splits a stage over
 * processes):
 *
 *   scan <csv.zst> --out=cands.jsonl        pick the puzzle rows to try
 *   app  --cands=… --out=app.jsonl          the app's own pass on each: engine
 *                                           at the review budget, the tags,
 *                                           explain.js's sentence
 *   games --out=app-games.jsonl             the same over the repo's games
 *   judge --in=a.jsonl,b.jsonl --out=judged.jsonl
 *                                           the sample (≤ PER_MOTIF per motif,
 *                                           seeded) against the deep search
 *   report --in=judged.jsonl [--record] [--doc=docs/motif-audit-8.1.md]
 *                                           [--fixture=scripts/fixtures/motif-sample.json]
 *
 * The app's pass, reproduced: a mistake's two positions are what the review
 * deepens (review-grade.js deepTargets: a drop of ≥ 5 points), so both are
 * searched at DEEP_FACTOR × SCAN_BUDGET = 600 ms-equivalent = 270,000 nodes,
 * MultiPV 3, from a cleared engine, and the PV is kept to five plies
 * (review-pass.js). explain.js is called as review/retry.js mistakeFacts()
 * calls it.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { record, read as readMeasured } from "./measurements.mjs";

const require = createRequire(import.meta.url);
const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const STAGE = process.argv[2];

/** the review's budget for a mistake's positions: 600 ms-equivalent × 450 nodes/ms */
const APP_NODES = 600 * 450;
/** the judge's budget: 1M nodes, 3.7 × the app's deepened search (B3's oracle: 7.5 × the 200 ms pass; this box is shared, and 19 × 25 cases at 2M did not fit) */
const DEEP_NODES = Number(arg("deep", 1000000));
/** motifs sampled at least this often; at most PER_MOTIF are judged */
export const MIN_PER_MOTIF = 20;
const PER_MOTIF = Number(arg("per", 25));
const SEED = Number(arg("seed", 81));

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/review.js", "src/web/js/lang-en.js", "src/web/js/lang-ja.js",
  "src/web/js/i18n.js", "src/web/js/explain.js"]);
const { Chess, ChessReview: Review, ChessExplain: X, ChessI18n } = ctx;
const tOf = (lang) => (k) => ChessI18n.DICT[lang][k] || k;

// --- small helpers ---------------------------------------------------------------
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
}
function readJsonl(files) {
  const out = [];
  for (const f of String(files || "").split(",").filter(Boolean)) {
    if (!fs.existsSync(f)) continue;
    for (const line of fs.readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      try { out.push(JSON.parse(line)); } catch (_) { /* a line cut by a restart */ }
    }
  }
  return out;
}
function shardOf() {
  const s = arg("shard", "0/1").split("/").map(Number);
  return { k: s[0] || 0, n: s[1] || 1 };
}
/** UCI line → SAN from `fen`, stopping at the first move that will not play */
function sanLine(fen, ucis, max) {
  const g = new Chess(fen);
  const out = [];
  for (const u of (ucis || []).slice(0, max)) {
    let m = null;
    try { m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); } catch (_) { m = null; }
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// --- engine -------------------------------------------------------------------------
let engine = null;
const listeners = [];
const send = (c) => engine.ccall("command", null, ["string"], [c], { async: /^go\b/.test(c) });
function waitFor(pred, ms) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
    const h = (l) => { if (typeof l === "string" && pred(l)) { clearTimeout(timer); drop(); res(l); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function startEngine() {
  if (engine) return;
  const js = path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js");
  engine = { wasmBinary: new Uint8Array(fs.readFileSync(path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
    listener: (l) => { for (const x of listeners.slice()) x(l); } };
  const factory = require(js);
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const w = waitFor((l) => l === "uciok", 30000); send("uci"); await w;
}
async function ready() { const w = waitFor((l) => l === "readyok", 20000); send("isready"); await w; }
/** app evalScalar(): White's view, mate as ±(10000 − 10·n) */
function scalarOf(kind, val, turn) {
  const sign = turn === "w" ? 1 : -1;
  if (kind === "mate") { const mag = 10000 - Math.min(Math.abs(val), 50) * 10; return val > 0 ? sign * mag : -sign * mag; }
  return sign * val;
}
/** One search from a cleared engine (engine.js does `ucinewgame` first): scalar, best, pv (UCI). */
async function search(fen, nodes, mpv) {
  const g = new Chess(fen);
  if (g.in_checkmate()) return { scalar: g.turn() === "w" ? -10000 : 10000, best: null, pv: [] };
  if (g.in_stalemate() || g.insufficient_material()) return { scalar: 0, best: null, pv: [] };
  await startEngine();
  await ready(); send("ucinewgame"); await ready();
  send("setoption name MultiPV value " + (mpv || 1));
  send("position fen " + fen);
  let last = null;
  const collect = (l) => {
    if (typeof l !== "string" || !l.startsWith("info") || !/\bpv\b/.test(l)) return;
    const mp = /\bmultipv (\d+)\b/.exec(l);
    if (mp && mp[1] !== "1") return;
    const s = l.match(/\bscore (cp|mate) (-?\d+)\b/);
    const pv = l.match(/\bpv (.+)$/);
    if (s && pv) last = { kind: s[1], val: Number(s[2]), pv: pv[1].trim().split(/\s+/) };
  };
  listeners.push(collect);
  const w = waitFor((l) => l.startsWith("bestmove"), 600000);
  send("go nodes " + nodes);
  let best = null;
  try { best = String(await w).split(/\s+/)[1] || null; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  if (best === "(none)") best = null;
  return { scalar: last ? scalarOf(last.kind, last.val, fen.split(" ")[1]) : null, best, pv: last ? last.pv : [] };
}

// --- scan: which puzzle rows to try ------------------------------------------------
/**
 * Lichess theme → the motif it is most likely to make the app say. Only a
 * way to reach rare positions: the case is filed under whatever the app says.
 * "overload" and "desperado" have no Lichess theme; the uniform draw and the
 * neighbouring themes (deflection, capturingDefender) are where they turn up.
 */
export const ENRICH = {
  hangingPiece: "hanging", equality: "perpetual", doubleCheck: "double", discoveredCheck: "discovered",
  discoveredAttack: "discoveredAttack", fork: "fork", intermezzo: "zwischenzug", capturingDefender: "removeDefender",
  deflection: "deflection", attraction: "decoy", pin: "pin", skewer: "skewer", xRayAttack: "xray",
  trappedPiece: "trapped", mateIn1: "mateThreat", promotion: "promotion", backRankMate: "backRank",
};
/**
 * The second pass (--shapes): for the motifs the theme draw rarely gets the
 * app to name — a mate outranks a double check in the sentence, so most
 * doubleCheck rows come back as 「让对方…杀」 — rows are picked by the shape
 * of the Lichess solution, read off the board with chess.js (never with
 * motif.js): who takes what on which square in its first three moves, and
 * whether the whole puzzle is a mate. Still only which rows are tried.
 */
function shapesOf(r) {
  if (/\bmate\b/.test(r.themes)) return [];
  const u = Array.isArray(r.moves) ? r.moves : String(r.moves).split(" ");
  const g = new Chess(r.fen);
  const ms = [];
  for (const x of u.slice(0, 4)) {
    let m = null;
    try { m = g.move({ from: x.slice(0, 2), to: x.slice(2, 4), promotion: x[4] || "q" }); } catch (_) { m = null; }
    if (!m) break;
    ms.push(Object.assign({ check: g.in_check(), fen: g.fen() }, m));
  }
  if (ms.length < 2) return [];
  const [b, s0, s1, s2] = ms;            // the blunder, then the solution
  const out = [];
  const th = r.themes;
  if (s0.check) {
    const gg = new Chess(s0.fen);
    const k = gg.board().flat().find((p) => p && p.type === "k" && p.color === gg.turn());
    void k;
    const mover = s0.to;
    // a check by something that did not move: discovered (or double, when the mover checks too)
    const probe = new Chess(s0.fen);
    probe.remove(mover);
    const still = probe.in_check();
    if (still) out.push(/doubleCheck/.test(th) ? "double" : "discovered");
  }
  if (/equality/.test(th)) {
    const mine = ms.slice(1).filter((m, i) => i % 2 === 0);
    if (mine.length >= 2 && mine.every((m) => m.check)) out.push("perpetual");
  }
  if (s1 && s2 && s1.to === s0.to && s1.captured) {
    if (s2.captured && s2.to !== s0.to) out.push(s0.captured ? "overload" : "deflection");
    if (!s0.captured && "kq".includes(s1.piece)) out.push("decoy");
    if (s0.captured && s2.to === s0.to && s2.captured && "brq".includes(s2.piece)) out.push("xray");
  }
  if (s2 && s0.captured && s2.captured && s2.to !== s0.to && /capturingDefender/.test(th)) out.push("removeDefender");
  if (b.captured && s0.captured && s1 && s1.to === s0.to && s1.captured) out.push("desperado");
  if (b.captured && s0.to !== b.to && s1 && /intermezzo/.test(th)) out.push("zwischenzug");
  if (/\bpin\b/.test(th)) out.push("pin");
  return out;
}
async function scanShapes(file, out) {
  const { streamRows } = await import("./import-puzzles.mjs");
  const K = Number(arg("k", 400));
  const tried = new Set(readJsonl(arg("tried")).map((c) => c.id));
  const rnd = seeded(SEED + 1);
  const pools = {}, seen = {};
  let n = 0;
  await streamRows(file, (r) => {
    n++;
    if (tried.has(r.id)) return;
    // the themes the shapes mostly live in are read in full; a quarter of
    // the rest is enough for the shapes without a theme (desperado, overload)
    if (!/doubleCheck|discoveredCheck|equality|deflection|attraction|xRayAttack|capturingDefender|intermezzo|\bpin\b/.test(r.themes) && rnd() > 0.25) return;
    let shapes = [];
    try { shapes = shapesOf(r); } catch (_) { shapes = []; }
    const row = { id: r.id, fen: r.fen, moves: r.moves, rating: r.rating, themes: r.themes, url: r.url };
    for (const s of shapes) {
      const t = "shape:" + s;
      pools[t] = pools[t] || []; seen[t] = (seen[t] || 0) + 1;
      if (pools[t].length < K) pools[t].push(row);
      else { const j = Math.floor(rnd() * seen[t]); if (j < K) pools[t][j] = row; }
    }
  });
  const lines = [];
  const ids = new Set();
  for (const [t, list] of Object.entries(pools)) {
    list.forEach((r, i) => { if (!ids.has(r.id)) { ids.add(r.id); lines.push(JSON.stringify(Object.assign({ group: t, gi: i }, r))); } });
  }
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log("rows " + n + " → candidates " + lines.length + " (" + Object.entries(pools).map(([t, l]) => t + " " + l.length + "/" + seen[t]).join(", ") + ")");
}
async function scan() {
  const { streamRows } = await import("./import-puzzles.mjs");
  const file = process.argv[3];
  if (process.argv.includes("--shapes")) { await scanShapes(file, arg("out")); return; }
  const out = arg("out");
  const K = Number(arg("k", 600));          // rows kept per theme (reservoir)
  const U = Number(arg("u", 6000));         // rows kept from the uniform draw
  const rnd = seeded(SEED);
  const pools = {};
  const seen = {};
  for (const t of Object.keys(ENRICH).concat(["*"])) { pools[t] = []; seen[t] = 0; }
  const keep = (t, r) => {
    const n = ++seen[t], cap = t === "*" ? U : K;
    if (pools[t].length < cap) pools[t].push(r);
    else { const j = Math.floor(rnd() * n); if (j < cap) pools[t][j] = r; }
  };
  let n = 0;
  await streamRows(file, (r) => {
    n++;
    const row = { id: r.id, fen: r.fen, moves: r.moves, rating: r.rating, themes: r.themes, url: r.url };
    for (const t of r.themes.split(" ")) if (t in ENRICH) keep(t, row);
    keep("*", row);
  });
  const lines = [];
  const ids = new Set();
  for (const [t, list] of Object.entries(pools)) {
    list.forEach((r, i) => { if (!ids.has(r.id)) { ids.add(r.id); lines.push(JSON.stringify(Object.assign({ group: t, gi: i }, r))); } });
  }
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log("rows " + n + " → candidates " + lines.length + " (" + Object.entries(pools).map(([t, l]) => t + " " + l.length).join(", ") + ")");
}

// --- app: the app's pass on one mistake ---------------------------------------------
/**
 * The review's facts about one move: both positions searched as the pass
 * deepens a mistake, the tag, and explain.js's record and sentence. `cont`
 * is what the game played next (for lineAfter), searched only when the PV
 * is too short to cover LOSS_PLIES and the game followed it.
 */
async function appCase(fen, played, cont) {
  const g = new Chess(fen);
  const mv = g.move(played);
  if (!mv) return null;
  const after = g.fen();
  const a = await search(fen, APP_NODES, 3), b = await search(after, APP_NODES, 3);
  if (a.scalar == null || b.scalar == null || !a.best) return { tag: null };
  const tag = Review.classifyByWinPct(Review.winPctDrop(a.scalar, b.scalar, mv.color));
  if (tag !== "?" && tag !== "??") return { tag };
  const sans = [mv.san].concat(cont || []);
  const pvs = [sanLine(fen, a.pv, 5).join(" ") || null, sanLine(after, b.pv, 5).join(" ") || null];
  // lineAfter reads pvs[j + 1] where the game went down the line: fill them
  // in only as far as it will look
  const need = () => {
    const l = X.lineAfter(pvs, sans, 0);
    return l.length < X.LOSS_PLIES;
  };
  const gg = new Chess(after);
  for (let j = 1; j < sans.length && need(); j++) {
    if (!gg.move(sans[j])) break;
    if (pvs[j + 1] !== undefined) continue;
    const r = await search(gg.fen(), APP_NODES, 3);
    pvs[j + 1] = sanLine(gg.fen(), r.pv, 5).join(" ") || null;
  }
  const line = X.lineAfter(pvs, sans, 0);
  const ex = X.explainMistake({ fen, played: mv.san, best: a.best, bestLine: pvs[0], line, evalBefore: a.scalar, evalAfter: b.scalar }, Chess);
  const key = X.explainKey(ex);
  return { tag, played: mv.san, best: a.best, bestLine: pvs[0], line, evalBefore: a.scalar, evalAfter: b.scalar,
    key, motif: X.explainMotif(ex), zh: X.explainText(ex, tOf("zh-CN")), en: X.explainText(ex, tOf("en")) };
}

async function app() {
  const out = arg("out");
  const done = new Set(readJsonl(out).map((r) => r.id));
  const { k, n } = shardOf();
  const lo = Number(arg("from", 0)), hi = Number(arg("to", 1e9));
  const groups = arg("groups") ? new Set(arg("groups").split(",")) : null;
  const skip = new Set(String(arg("skip", "")).split(","));
  // groups interleaved (row gi of every group, then gi + 1), so a partial run
  // has tried every theme about equally often
  let cands = readJsonl(arg("cands")).filter((c) => c.gi >= lo && c.gi < hi && (!groups || groups.has(c.group)) && !skip.has(c.group))
    .sort((a, b) => a.gi - b.gi || (a.group < b.group ? -1 : a.group > b.group ? 1 : 0));
  cands = cands.filter((c, i) => i % n === k && !done.has("pz:" + c.id));
  const fd = fs.openSync(out, "a");
  let i = 0;
  for (const c of cands) {
    const g = new Chess(c.fen);
    const u = Array.isArray(c.moves) ? c.moves : String(c.moves).split(" ");
    const first = g.move({ from: u[0].slice(0, 2), to: u[0].slice(2, 4), promotion: u[0][4] || "q" });
    if (!first) continue;
    const cont = sanLine(g.fen(), u.slice(1), 12);
    let r = null;
    try { r = await appCase(c.fen, first.san, cont); } catch (e) { console.error(c.id, e.message); continue; }
    fs.writeSync(fd, JSON.stringify(Object.assign({ id: "pz:" + c.id, src: "lichess-puzzle", group: c.group, url: c.url, rating: c.rating, fen: c.fen }, r || { tag: null })) + "\n");
    if (++i % 25 === 0) process.stdout.write(`[${k}/${n}] ${i}/${cands.length}\n`);
  }
  fs.closeSync(fd);
}

// --- games: the repo's real games, whole ----------------------------------------------
async function gameSources() {
  const out = [];
  const { GAMES } = await import("./fixtures/corpus.mjs");
  const { COACH_GAMES } = await import("./fixtures/coach-games.mjs");
  for (const [i, g] of GAMES.entries()) out.push({ src: "corpus", i, name: g.name, san: g.san, fen: null });
  for (const [i, g] of COACH_GAMES.entries()) out.push({ src: "coach-games", i, name: g.name, san: g.san, fen: null });
  const pgns = [];
  const lich = fs.readFileSync(path.join(ROOT, "src/sync-fixtures/lichess.body"), "utf8");
  for (const p of lich.split(/\n\n(?=\[Event )/)) pgns.push({ src: "sync-lichess", pgn: p });
  const cc = JSON.parse(fs.readFileSync(path.join(ROOT, "src/sync-fixtures/chesscom-month.body"), "utf8"));
  for (const g of cc.games || []) if (g.pgn && (!g.rules || g.rules === "chess")) pgns.push({ src: "sync-chesscom", pgn: g.pgn });
  pgns.forEach((p, i) => {
    const g = new Chess();
    if (!g.load_pgn(p.pgn.replace(/\{[^}]*\}/g, ""))) return;
    const h = g.header();
    if (h.SetUp === "1" || h.FEN) return;
    out.push({ src: p.src, i, name: (h.White || "?") + "–" + (h.Black || "?"), san: g.history(), fen: null });
  });
  return out;
}
async function games() {
  const out = arg("out");
  const done = new Set(readJsonl(out).map((r) => r.gid));
  const { k, n } = shardOf();
  const list = (await gameSources()).filter((g, i) => i % n === k);
  const fd = fs.openSync(out, "a");
  for (const game of list) {
    const gid = game.src + ":" + game.i;
    if (done.has(gid)) continue;
    // every position at the review budget; a mistake gets the full appCase
    const g = new Chess();
    const fens = [g.fen()];
    for (const s of game.san) { if (!g.move(s)) break; fens.push(g.fen()); }
    const rows = [];
    let prev = await search(fens[0], APP_NODES, 3);
    for (let i = 0; i + 1 < fens.length; i++) {
      const next = await search(fens[i + 1], APP_NODES, 3);
      const side = fens[i].split(" ")[1];
      const tag = prev.scalar != null && next.scalar != null ? Review.classifyByWinPct(Review.winPctDrop(prev.scalar, next.scalar, side)) : null;
      if (tag === "?" || tag === "??") {
        const r = await appCase(fens[i], game.san[i], game.san.slice(i + 1, i + 13));
        if (r && r.key) rows.push(Object.assign({ id: "g:" + gid + ":" + i, src: game.src, game: game.name, ply: i, fen: fens[i] }, r));
      }
      prev = next;
    }
    fs.writeSync(fd, JSON.stringify({ gid, rows }) + "\n");
    process.stdout.write(`[${k}/${n}] ${gid} ${rows.length} mistakes\n`);
  }
  fs.closeSync(fd);
}

// --- judge ------------------------------------------------------------------------------
/** Every app row with a named motif, games' rows unpacked. */
function namedRows(files) {
  const out = new Map();
  for (const r of readJsonl(files)) {
    if (Array.isArray(r.rows)) { for (const x of r.rows) if (x.motif) out.set(x.id, x); }
    else if (r.motif) out.set(r.id, r);
  }
  return [...out.values()];
}
/** The sample: per motif, the repo's games first, then puzzle rows in a seeded order, PER_MOTIF at most. */
function sampleOf(rows) {
  const rnd = seeded(SEED);
  const by = {};
  for (const r of rows) (by[r.motif] = by[r.motif] || []).push(r);
  const out = [];
  for (const [m, list] of Object.entries(by)) {
    const keyed = list.map((r) => ({ r, k: (r.src === "lichess-puzzle" ? 1 : 0) + rnd() }));
    keyed.sort((a, b) => a.k - b.k || (a.r.id < b.r.id ? -1 : 1));
    out.push(...keyed.slice(0, PER_MOTIF).map((x) => x.r));
    void m;
  }
  return out;
}
async function judge() {
  const { judgeCase } = await import("./lib/motif-oracle.mjs");
  const out = arg("out");
  const done = new Set(readJsonl(out).map((r) => r.id));
  const { k, n } = shardOf();
  // --motifs: judge only these (a motif's sample is drawn once, when it is judged)
  const only = arg("motifs") ? new Set(arg("motifs").split(",")) : null;
  const sample = sampleOf(namedRows(arg("in")).filter((r) => !only || only.has(r.motif))).filter((r, i) => i % n === k && !done.has(r.id));
  const fd = fs.openSync(out, "a");
  const deepOf = async (fen) => {
    const r = await search(fen, DEEP_NODES, 1);
    return { scalar: r.scalar, pv: sanLine(fen, r.pv, 16) };
  };
  let i = 0;
  for (const r of sample) {
    const g = new Chess(r.fen); g.move(r.played);
    const ex = X.explainMistake({ fen: r.fen, played: r.played, best: r.best, bestLine: r.bestLine, line: r.line,
      evalBefore: r.evalBefore, evalAfter: r.evalAfter }, Chess);
    // the position before the mistake is searched only where a claim reads
    // it: the better move (its motif, or a mate it gives) and a perpetual
    const needBefore = /^ex\.(better|mate)/.test(r.key || "") || r.motif === "perpetual";
    const d = { after: await deepOf(g.fen()), before: needBefore ? await deepOf(r.fen) : { scalar: null, pv: [] }, reply: null, best: null };
    const claim = ex && ex.refute ? ex.refute.san : null;
    if (claim) { const h = new Chess(g.fen()); if (h.move(claim)) d.reply = await deepOf(h.fen()); }
    if (ex && ex.threat) { /* same reply as the refutation: d.reply covers it */ }
    if (ex && ex.better) { const h = new Chess(r.fen); if (h.move(ex.better.san)) d.best = await deepOf(h.fen()); }
    const v = judgeCase(Object.assign({}, r, { ex }), d, Chess);
    fs.writeSync(fd, JSON.stringify(Object.assign({}, r, { ex, deep: d, verdict: v.verdict, reason: v.reason, sentence: v.sentence })) + "\n");
    if (++i % 10 === 0) process.stdout.write(`[${k}/${n}] judged ${i}/${sample.length}\n`);
  }
  fs.closeSync(fd);
}

/**
 * The verdicts again from the stored deep searches — no engine: a rubric
 * refined after reading cases is applied to every case alike. The sentence
 * record is the one judged (`ex`, kept from the app's run), so a motif that
 * has since fallen back is still judged as what the app said then.
 */
async function rejudge() {
  const { judgeCase } = await import("./lib/motif-oracle.mjs");
  const out = [];
  const seen = new Set();
  for (const r of readJsonl(arg("in"))) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const ex = r.ex || X.explainMistake({ fen: r.fen, played: r.played, best: r.best, bestLine: r.bestLine, line: r.line,
      evalBefore: r.evalBefore, evalAfter: r.evalAfter }, Chess);
    const v = judgeCase(Object.assign({}, r, { ex }), r.deep, Chess);
    out.push(JSON.stringify(Object.assign({}, r, { ex, verdict: v.verdict, reason: v.reason, sentence: v.sentence })));
  }
  fs.writeFileSync(arg("out"), out.join("\n") + "\n");
  console.log("rejudged " + out.length);
}

// --- report ---------------------------------------------------------------------------
async function report() {
  const { MOTIF_ORDER, RUBRIC } = await import("./lib/motif-oracle.mjs");
  const all = readJsonl(arg("in"));
  // a human reading overrules the oracle where it is recorded (motif-oracle.mjs HUMAN)
  const { HUMAN } = await import("./lib/motif-oracle.mjs");
  for (const r of all) {
    const h = HUMAN.find((x) => x.id === r.id);
    if (h) { r.reason = "人工：" + h.reason + "（oracle：" + r.reason + "）"; r.verdict = h.verdict; }
  }
  const named = arg("named") ? namedRows(arg("named")) : [];
  // how many real-game moves the app's pass looked at, and how many it tagged ? / ??
  const tried = new Map();
  for (const r of readJsonl(arg("named") || "")) for (const x of Array.isArray(r.rows) ? r.rows : [r]) if (x.id) tried.set(x.id, x.tag);
  const mistakes = [...tried.values()].filter((t) => t === "?" || t === "??").length;
  const res = {};
  for (const m of MOTIF_ORDER) {
    const rs = all.filter((r) => r.motif === m);
    const wrong = rs.filter((r) => r.verdict === "wrong").length;
    const found = named.filter((r) => r.motif === m).length;
    res[m] = { n: rs.length, wrong, errPct: rs.length ? Math.round((wrong / rs.length) * 1000) / 10 : null,
      found: found || undefined, fallback: rs.length >= MIN_PER_MOTIF ? wrong / rs.length > 0.05 : null };
  }
  for (const m of MOTIF_ORDER) {
    const x = res[m];
    console.log(m.padEnd(18) + String(x.n).padStart(4) + "  wrong " + String(x.wrong).padStart(3) + "  " +
      (x.errPct == null ? "—" : x.errPct + "%") + (x.fallback ? "  → material only" : x.fallback == null ? "  (too few)" : ""));
  }
  if (arg("fixture")) {
    const keep = all.map((r) => ({ id: r.id, src: r.src, url: r.url, game: r.game, ply: r.ply, tag: r.tag, fen: r.fen, played: r.played,
      best: r.best, bestLine: r.bestLine, line: r.line, evalBefore: r.evalBefore, evalAfter: r.evalAfter, motif: r.motif, key: r.key,
      zh: r.zh, verdict: r.verdict, reason: r.reason }));
    keep.sort((a, b) => MOTIF_ORDER.indexOf(a.motif) - MOTIF_ORDER.indexOf(b.motif) || (a.id < b.id ? -1 : 1));
    fs.writeFileSync(path.resolve(ROOT, arg("fixture")), "[\n" + keep.map((x) => JSON.stringify(x)).join(",\n") + "\n]\n");
    console.log("wrote " + arg("fixture"));
  }
  if (arg("doc")) writeDoc(path.resolve(ROOT, arg("doc")), all, res, MOTIF_ORDER, RUBRIC);
  if (process.argv.includes("--record")) {
    const prev = readMeasured().motifPrecision || {};
    record("motifPrecision", Object.assign(prev, {
      what: "教练说明里每个母题说对的比例（v8-1-plan T6）：真实对局的失误，按 app 的复盘预算重跑引擎与 explain.js，再用 3.7 倍节点（1,000,000）的深搜按判定规则逐条核对",
      script: "scripts/sample-motifs.mjs（scan → app / games → judge → report）",
      sources: "Lichess 谜题库（database.lichess.org，每行是真实对局里走出的失着）+ scripts/fixtures/corpus.mjs + coach-games.mjs + src/sync-fixtures",
      appNodes: APP_NODES, deepNodes: DEEP_NODES, minPerMotif: MIN_PER_MOTIF, perMotif: PER_MOTIF, rule: "错误率 > 5% 的母题回退到只说子力得失（explain.js MATERIAL_ONLY）",
      tried: { rows: tried.size, mistakes, named: named.length },
      byMotif: res,
    }));
  }
}

function writeDoc(file, all, res, order, rubric) {
  let doc = "";
  try { doc = fs.readFileSync(file, "utf8"); } catch (_) { doc = ""; }
  const begin = "<!-- sample:begin -->", end = "<!-- sample:end -->";
  const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\n/g, " ");
  const parts = [begin, ""];
  parts.push("| 母题 | 抽样 | 错 | 错误率 | 结果 |", "|---|---|---|---|---|");
  for (const m of order) {
    const x = res[m];
    parts.push(`| ${m} | ${x.n} | ${x.wrong} | ${x.errPct == null ? "—" : x.errPct + "%"} | ${x.fallback ? "**回退到只说子力**" : x.fallback == null ? "样本不足" : "保留"} |`);
  }
  for (const m of order) {
    const rs = all.filter((r) => r.motif === m);
    if (!rs.length) continue;
    parts.push("", `### ${m}`, "", "判定规则：" + (rubric[m] || ""), "",
      "| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |", "|---|---|---|---|---|---|---|---|");
    rs.forEach((r, i) => {
      const src = r.url ? `[${r.id.slice(3)}](${r.url})` : esc(r.game) + " ply " + r.ply;
      parts.push(`| ${i + 1} | ${src} | ${r.tag} | \`${r.fen}\` | ${esc(r.played)} | ${esc(r.zh)} | ${r.verdict === "wrong" ? "**错**" : "对"} | ${esc(r.reason)} |`);
    });
  }
  parts.push("", end);
  const table = parts.join("\n");
  if (doc.includes(begin)) doc = doc.slice(0, doc.indexOf(begin)) + table + doc.slice(doc.indexOf(end) + end.length);
  else doc += "\n" + table + "\n";
  fs.writeFileSync(file, doc);
  console.log("wrote " + path.relative(ROOT, file));
}

const STAGES = { scan, app, games, judge, rejudge, report };
if (!STAGES[STAGE]) {
  console.error("usage: node scripts/sample-motifs.mjs scan|app|games|judge|report …  (see the header)");
  process.exit(2);
}
await STAGES[STAGE]();
process.exit(0);
