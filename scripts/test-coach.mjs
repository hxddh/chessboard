/**
 * v8-0-plan B3 — how often does the coach say *why*, and how often is it right?
 *
 * test-motif.mjs measured the library tally's rule (the motif of the engine's
 * own move) and could not say whether a label was correct. This measures the
 * sentence the review actually shows — explain.js on the stored lines, the
 * same call app.js makes in mistakeFacts() — and checks every claim in it
 * against a second, deeper engine search (the oracle below).
 *
 * Corpora, both committed:
 *   - scripts/fixtures/corpus.mjs — the 28 decided games every other
 *     measurement uses (mostly master games: few ??, and those few are hard);
 *   - scripts/fixtures/coach-games.mjs — low-skill engine games, the miner's
 *     recipe (scripts/mine-puzzles.mjs): hanging pieces and walked-into forks,
 *     the mistakes a learner's own games are full of.
 *
 * The engine output is cached in scripts/fixtures/coach-analysis.json, keyed
 * by budget and FEN, so a before/after comparison differs only in the code:
 * a 200 ms search is not reproducible run to run, and a coverage change that
 * is really a different line would be measured as progress.
 *
 *   node scripts/test-coach.mjs                    coverage, printed
 *   node scripts/test-coach.mjs --record=after     … and written to docs/measured.json
 *   node scripts/test-coach.mjs --audit=docs/coach-audit-8.0.md
 *   node scripts/test-coach.mjs --lib=<dir>        explain.js/motif.js from <dir>
 *   node scripts/test-coach.mjs gen --games=12     new low-skill games (rarely)
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { read as readMeasured, record } from "./measurements.mjs";
import { GAMES } from "./fixtures/corpus.mjs";

const require = createRequire(import.meta.url);
const arg = (k) => { const a = process.argv.find((x) => x.startsWith(k + "=")); return a ? a.slice(k.length + 1) : null; };
const num = (k, d) => { const n = Number(arg(k)); return Number.isFinite(n) && n > 0 ? n : d; };
const GEN = process.argv[2] === "gen";
/** the app's quick-scan budget (app.js SCAN_BUDGET): what a review pass stores */
const MS = num("--ms", 200);
/** the oracle's budget: seven and a half times the pass's */
const DEEP_MS = num("--deep", 1500);
const LIB = arg("--lib") ? path.resolve(arg("--lib")) : path.join(ROOT, "src/web/js");
const CACHE = path.join(ROOT, "scripts/fixtures/coach-analysis.json");
const GAMES_FILE = path.join(ROOT, "scripts/fixtures/coach-games.mjs");

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/review.js",
  "src/web/js/lang-en.js", "src/web/js/lang-ja.js", "src/web/js/i18n.js", path.join(LIB, "explain.js")]);
const { Chess, ChessReview: Review, ChessExplain: X, ChessI18n } = ctx;
const tOf = (lang) => (k) => ChessI18n.DICT[lang][k] || k;

// --- engine (lazy: a full cache never starts it) -----------------------------
let engine = null;
const listeners = [];
async function startEngine() {
  if (engine) return;
  const enginePath = path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.js");
  const wasmPath = path.join(ROOT, "third_party/stockfish/stockfish-19-lite-single.wasm");
  if (!fs.existsSync(enginePath)) { console.log("skip: vendored Stockfish not found"); process.exit(0); }
  engine = { wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)), listener: (l) => { for (const x of listeners.slice()) x(l); } };
  const factory = require(enginePath);
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const w = waitFor((l) => l === "uciok", 20000);
  send("uci");
  await w;
}
const send = (c) => engine.ccall("command", null, ["string"], [c], { async: /^go\b/.test(c) });
function waitFor(pred, ms) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
    const h = (l) => { if (typeof l === "string" && pred(l)) { clearTimeout(timer); drop(); res(l); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function ready() { const w = waitFor((l) => l === "readyok", 10000); send("isready"); await w; }

/** app.js evalScalar(), to the letter: White's view, mate as ±(10000 − 10·n) */
function scalarOf(kind, val, turn) {
  const sign = turn === "w" ? 1 : -1;
  if (kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(val), 50) * 10;
    return val > 0 ? sign * mag : -sign * mag;
  }
  return sign * val;
}

/** One search: score (White's view), best move and principal variation (UCI). */
async function search(fen, ms, opts = {}) {
  await startEngine();
  await ready();
  send("setoption name MultiPV value 1");
  send("setoption name Skill Level value " + (opts.skill == null ? 20 : opts.skill));
  send("setoption name UCI_LimitStrength value false");
  send("position fen " + fen);
  let last = null;
  const collect = (l) => {
    if (typeof l !== "string" || !l.startsWith("info") || !/\bpv\b/.test(l)) return;
    const s = l.match(/\bscore (cp|mate) (-?\d+)\b/);
    const pv = l.match(/\bpv (.+)$/);
    if (s && pv) last = { kind: s[1], val: Number(s[2]), pv: pv[1].trim().split(/\s+/) };
  };
  listeners.push(collect);
  const w = waitFor((l) => l.startsWith("bestmove"), ms + 30000);
  send("go movetime " + ms);
  let best = null;
  try { best = String(await w).split(/\s+/)[1] || null; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  if (best === "(none)") best = null;
  const turn = fen.split(" ")[1];
  return { scalar: last ? scalarOf(last.kind, last.val, turn) : null, best, pv: last ? last.pv : [] };
}

// --- cache ---------------------------------------------------------------------
let cache = {};
try { cache = JSON.parse(fs.readFileSync(CACHE, "utf8")); } catch (_) { cache = {}; }
let dirty = 0;
async function cached(fen, ms, keep) {
  const k = ms + "|" + fen;
  if (!cache[k]) {
    const r = await search(fen, ms);
    cache[k] = { s: r.scalar, b: r.best, pv: r.pv.slice(0, keep).join(" ") };
    if (++dirty % 50 === 0) saveCache();
  }
  const c = cache[k];
  return { scalar: c.s, best: c.b, pv: c.pv ? c.pv.split(" ") : [] };
}
function saveCache() {
  const keys = Object.keys(cache).sort();
  const out = {};
  for (const k of keys) out[k] = cache[k];
  fs.writeFileSync(CACHE, JSON.stringify(out).replace(/\},"/g, "},\n\"") + "\n");
}

/** UCI line → SAN from `fen`, stopping at the first move that will not play */
function sanLine(fen, ucis, max) {
  const g = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, max)) {
    let m = null;
    try { m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); } catch (_) { m = null; }
    if (!m) break;
    out.push(m.san);
  }
  return out;
}

// --- gen: low-skill games --------------------------------------------------------
if (GEN) {
  const n = num("--games", 12);
  let seed = num("--seed", 8);
  const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const games = [];
  for (let gi = 0; gi < n; gi++) {
    const skills = { w: Math.floor(rnd() * 4), b: Math.floor(rnd() * 4) };
    const g = new Chess();
    const san = [];
    for (let i = 0; i < 4; i++) {        // a short random opening, as the miner does
      const ms = g.moves();
      const m = ms[Math.floor(rnd() * ms.length)];
      g.move(m); san.push(m);
    }
    while (!g.game_over() && san.length < 110) {
      const r = await search(g.fen(), 40, { skill: skills[g.turn()] });
      const s = sanLine(g.fen(), [r.best || ""], 1)[0];
      if (!s) break;
      g.move(s); san.push(s);
    }
    games.push({ name: `low-skill ${gi + 1} (skill ${skills.w}–${skills.b})`, san });
    process.stdout.write(".");
  }
  const body = games.map((x) => `  { name: ${JSON.stringify(x.name)},\n    san: ${JSON.stringify(x.san.join(" "))}.split(" ") },`).join("\n");
  fs.writeFileSync(GAMES_FILE, `/**
 * Low-skill engine games for the coach measurement (v8-0-plan B3) — written
 * by \`node scripts/test-coach.mjs gen\`, do not edit.
 *
 * Stockfish at UCI Skill Level 0–3 against itself from a four-ply random
 * opening, 40 ms a move — the recipe scripts/mine-puzzles.mjs uses because
 * weak settings blunder the way people do. The 28-game corpus is mostly
 * master play; its ?? are few and mostly deep. These are the other kind.
 */
export const COACH_GAMES = [
${body}
];
`);
  console.log("\nwrote " + path.relative(ROOT, GAMES_FILE));
  process.exit(0);
}

const { COACH_GAMES } = await import("./fixtures/coach-games.mjs");

// --- the pass, the app's way -----------------------------------------------------
/** What app.js stores for a game: scalars, bests (UCI) and pvs (SAN, five plies). */
async function passOf(sans) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const s of sans) { if (!g.move(s)) throw new Error("illegal SAN " + s); fens.push(g.fen()); }
  const scalars = [], bests = [], pvs = [];
  for (const fen of fens) {
    const p = new Chess(fen);
    if (p.in_checkmate()) { scalars.push(p.turn() === "w" ? -10000 : 10000); bests.push(null); pvs.push(null); continue; }
    if (p.in_stalemate() || p.insufficient_material()) { scalars.push(0); bests.push(null); pvs.push(null); continue; }
    const r = await cached(fen, MS, 5);
    scalars.push(r.scalar);
    bests.push(r.best);
    const line = sanLine(fen, r.pv, 5);
    pvs.push(line.length ? line.join(" ") : null);
  }
  return { fens, scalars, bests, pvs };
}

const rows = [];
async function run(set, games) {
  for (const game of games) {
    const p = await passOf(game.san);
    for (let i = 0; i < game.san.length; i++) {
      const a = p.scalars[i], b = p.scalars[i + 1];
      if (a == null || b == null) continue;
      const mover = p.fens[i].split(" ")[1];
      const tag = Review.classifyByWinPct(Review.winPctDrop(a, b, mover));
      if (tag !== "?" && tag !== "??") continue;
      if (!p.bests[i]) continue;
      // mistakeFacts() in app.js, to the letter (plus the evaluations B3 reads)
      const ex = X.explainMistake({
        fen: p.fens[i], played: game.san[i], best: p.bests[i],
        bestLine: p.pvs[i], line: X.lineAfter(p.pvs, game.san, i),
        evalBefore: a, evalAfter: b,
      }, Chess);
      rows.push({ set, game: game.name, ply: i, tag, fen: p.fens[i], played: game.san[i], ex,
        line: X.lineAfter(p.pvs, game.san, i), bestLine: p.pvs[i], evalBefore: a, evalAfter: b,
        key: X.explainKey(ex), motif: ex ? motifNamed(ex, X.explainKey(ex)) : null, zh: X.explainText(ex, tOf("zh-CN")), en: X.explainText(ex, tOf("en")) });
    }
    process.stdout.write(".");
  }
}
await run("corpus", GAMES);
await run("low", COACH_GAMES);
process.stdout.write("\n");

/**
 * The motif the sentence names, or null. explain.js answers that itself
 * (explainMotif) since B3; the 7.x module did not have it, so for a --lib
 * run against the old code the same question is asked of its keys: the three
 * sentences that carry {motif} and the one that names the better move's.
 */
function motifNamed(ex, key) {
  if (X.explainMotif) return X.explainMotif(ex);
  if (/^ex\.(motifLoss|motif|forkHits)$/.test(key || "")) return ex.refute.motif;
  if (key === "ex.betterMotif") return ex.better.motif;
  return null;
}
const motifSaid = (r) => !!r.motif;
function mateSaid(r) { return /^ex\.(mate1|mateN|allowsMate|allowsMate1|threatMate)(Motif)?$/.test(r.key || ""); }

function summary(set) {
  const rs = rows.filter((r) => !set || r.set === set);
  const bl = rs.filter((r) => r.tag === "??");
  const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
  const by = {};
  for (const r of rs) if (r.key) by[r.key] = (by[r.key] || 0) + 1;
  const motifs = {};
  for (const r of rs) if (r.motif) motifs[r.motif] = (motifs[r.motif] || 0) + 1;
  return {
    mistakes: rs.length,
    explained: rs.filter(motifSaid).length,
    explainedPct: pct(rs.filter(motifSaid).length, rs.length),
    blunders: bl.length,
    blundersExplained: bl.filter(motifSaid).length,
    blundersExplainedPct: pct(bl.filter(motifSaid).length, bl.length),
    blundersMotifOrMate: bl.filter((r) => motifSaid(r) || mateSaid(r)).length,
    blundersMotifOrMatePct: pct(bl.filter((r) => motifSaid(r) || mateSaid(r)).length, bl.length),
    byKey: by,
    byMotif: motifs,
  };
}
const res = { corpus: summary("corpus"), low: summary("low"), all: summary(null) };
for (const [k, v] of Object.entries(res)) {
  console.log(`\n[${k}] ?/?? ${v.mistakes} 手，说出母题的 ${v.explained}（${v.explainedPct}%）；` +
    `?? ${v.blunders} 手，说出母题的 ${v.blundersExplained}（${v.blundersExplainedPct}%），母题或杀 ${v.blundersMotifOrMate}（${v.blundersMotifOrMatePct}%）`);
  console.log("   句型 " + JSON.stringify(v.byKey));
  console.log("   母题 " + JSON.stringify(v.byMotif));
}
if (dirty) saveCache();
if (arg("--rows")) fs.writeFileSync(arg("--rows"), JSON.stringify(rows.map((r) => ({ set: r.set, ply: r.ply, tag: r.tag, fen: r.fen,
  played: r.played, line: r.line, bestLine: r.bestLine, evalBefore: r.evalBefore, evalAfter: r.evalAfter, key: r.key, motif: r.motif, zh: r.zh }))));

// --- the oracle, for the audit ---------------------------------------------------
/**
 * Where a reading of the board overrules the oracle. The oracle checks that
 * a loss is as big as claimed, not which man it names, and that a forker
 * takes something, not that there was a fork — these rows are where that
 * bluntness passed a wrong sentence (all four are 7.x sentences).
 */
const HUMAN = [
  { fen: "2r2rk1/pb2bppp/8/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 b - - 0 19", played: "Bd6", zh: "漏看了 ♕xd6 捉双，丢后",
    verdict: "wrong", reason: "♕xd6 吃的是被攻击两次、保护一次的象，后是对换掉的；丢的是象，也不是捉双" },
  { fen: "r3kb1r/2qb1pR1/p2ppP2/1pn4p/3NP3/2N2Q1B/PPP4P/2KR4 b kq - 3 18", played: "O-O-O", zh: "漏看了 ♖xf7 捉双，丢兵",
    verdict: "wrong", reason: "f7 上的车打到的 d7、f8 两个象都有保护，不值得吃：不是捉双" },
  { fen: "r2qk1nr/1b3p2/pn2p2p/1Pp1P1p1/2pP4/2P2BB1/4NPPP/R2Q1RK1 b kq - 0 15", played: "axb5", zh: "对方 ♗xb7 之后丢车",
    verdict: "wrong", reason: "线上车是对换（…Rxa1 Qxa1），丢的是 b7 象" },
  { fen: "r4rk1/2pn3p/bpqbp1p1/1N1n1P2/p1BP3P/P3PN2/1PQB1P2/R3K1R1 w Q - 1 18", played: "Rg4", zh: "对方 ♝xb5 之后丢后",
    verdict: "wrong", reason: "后是对换（…Qxc2 Bxc2），丢的是 b5 马" },
];

if (arg("--audit") || arg("--dump")) {
  const { oracle } = await import("./lib/coach-oracle.mjs");
  const sample = auditSample(rows, 100);
  const deepOf = async (fen) => {
    const g = new Chess(fen);
    if (g.game_over()) return { scalar: g.in_checkmate() ? (g.turn() === "w" ? -10000 : 10000) : 0, pv: [] };
    const r = await cached(fen, DEEP_MS, 16);
    return { scalar: r.scalar, pv: sanLine(fen, r.pv, 16) };
  };
  const audited = [];
  for (const r of sample) {
    const g = new Chess(r.fen); g.move(r.played);
    const d = { after: await deepOf(g.fen()), before: await deepOf(r.fen), reply: null, best: null };
    // the position after the claimed refutation, and after the claimed better move
    if (r.ex && r.ex.refute) { const h = new Chess(g.fen()); if (h.move(r.ex.refute.san)) d.reply = await deepOf(h.fen()); }
    if (r.ex && r.ex.better) { const h = new Chess(r.fen); if (h.move(r.ex.better.san)) d.best = await deepOf(h.fen()); }
    let v = oracle(r, d, Chess);
    const h = HUMAN.find((x) => r.fen === x.fen && r.played === x.played && r.zh === x.zh);
    if (h) v = { verdict: h.verdict, reason: "人工：" + h.reason + "（oracle：" + v.reason + "）" };
    audited.push({ ...r, verdict: v.verdict, reason: v.reason });
  }
  if (dirty) saveCache();
  const wrong = audited.filter((r) => r.verdict === "wrong").length;
  const claims = audited.filter((r) => r.key && r.key !== "ex.better").length;
  const wrongClaims = audited.filter((r) => r.verdict === "wrong" && r.key !== "ex.better").length;
  console.log(`\naudit：${audited.length} 条，错 ${wrong}（${Math.round(wrong / audited.length * 1000) / 10}%）；` +
    `其中不止「更好的是」的 ${claims} 条，错 ${wrongClaims}`);
  if (arg("--dump")) {
    fs.writeFileSync(arg("--dump"), JSON.stringify(audited.map((r) => ({
      set: r.set, game: r.game, ply: r.ply, tag: r.tag, fen: r.fen, played: r.played, line: r.line, bestLine: r.bestLine,
      key: r.key, zh: r.zh, en: r.en, verdict: r.verdict, reason: r.reason })), null, 1));
  }
  if (arg("--audit")) writeAudit(arg("--audit"), audited, arg("--label") || "after");
  res.audit = { n: audited.length, wrong, wrongPct: Math.round(wrong / audited.length * 1000) / 10, claims, wrongClaims,
    wrongClaimsPct: claims ? Math.round(wrongClaims / claims * 1000) / 10 : 0 };
}

/**
 * 100 mistakes, the same 100 whatever the code says about them: every ?? in
 * order, then ? to fill, both sets interleaved so neither corpus dominates.
 */
function auditSample(all, n) {
  const pick = [];
  const order = (set, tag) => all.filter((r) => r.set === set && r.tag === tag);
  const lists = [order("corpus", "??"), order("low", "??"), order("corpus", "?"), order("low", "?")];
  const a = [], b = [];
  for (let i = 0; i < Math.max(lists[0].length, lists[1].length); i++) { if (lists[0][i]) a.push(lists[0][i]); if (lists[1][i]) a.push(lists[1][i]); }
  for (let i = 0; i < Math.max(lists[2].length, lists[3].length); i++) { if (lists[2][i]) b.push(lists[2][i]); if (lists[3][i]) b.push(lists[3][i]); }
  for (const r of a.concat(b)) { if (pick.length < n) pick.push(r); }
  return pick;
}

function writeAudit(file, audited, label) {
  const abs = path.resolve(ROOT, file);
  let doc = "";
  try { doc = fs.readFileSync(abs, "utf8"); } catch (_) { doc = ""; }
  const begin = `<!-- audit:${label}:begin -->`, end = `<!-- audit:${label}:end -->`;
  const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|");
  const table = [begin, "", "| # | 集 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |", "|---|---|---|---|---|---|---|---|",
    ...audited.map((r, i) => `| ${i + 1} | ${r.set === "corpus" ? "名局" : "低档"} | ${r.tag} | \`${r.fen}\` | ${esc(r.played)} | ${esc(r.zh || "（无）")} | ${r.verdict === "wrong" ? "**错**" : r.verdict === "ok" ? "对" : "空"} | ${esc(r.reason)} |`),
    "", end].join("\n");
  if (doc.includes(begin)) doc = doc.slice(0, doc.indexOf(begin)) + table + doc.slice(doc.indexOf(end) + end.length);
  else doc += "\n" + table + "\n";
  fs.writeFileSync(abs, doc);
  console.log("wrote " + file + " [" + label + "]");
}

const rec = arg("--record");
if (rec) {
  const prev = readMeasured().coachCoverage || {};
  prev.what = "复盘里 ? / ?? 的一句说明说出了战术母题的比例（explain.js，按 app.js mistakeFacts() 的调用方式）";
  prev.script = "scripts/test-coach.mjs --record=before|after --audit=docs/coach-audit-8.0.md";
  prev.movetimeMs = MS;
  prev.oracleMs = DEEP_MS;
  prev.corpora = { corpus: "scripts/fixtures/corpus.mjs（28 局）", low: "scripts/fixtures/coach-games.mjs（低档引擎对局）" };
  prev[rec] = res;
  record("coachCoverage", prev);
}
process.exit(0);
