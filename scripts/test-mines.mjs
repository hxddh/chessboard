/**
 * The three numbers 5.1 wrote down without measuring.
 *
 * 5.1 gave the personal book three rules and three constants:
 *   1. a deeper pass may revise or withdraw a drill a quicker pass minted
 *      (mistakes.js reviseMines) — how often does 400ms actually disagree
 *      with 120ms about a ??, and about the best move?
 *   2. an alternative answer is accepted when it costs less than
 *      Review.MISTAKE (100cp) against the stored best (judgeAlt) — at a ??
 *      position, how many moves are that close to the best? If it is usually
 *      several, the drill is lenient; if it is usually none, the rule almost
 *      never fires and the old "one string" behaviour is what players get.
 *   3. a verdict needs Review.MIN_JUDGED (10) own moves — how far is the
 *      accuracy after N moves from the accuracy after the whole game?
 *
 * A measurement, not a pass/fail test: it prints tables and, with --record,
 * writes docs/measured.json so the constants can quote it. Nothing here moves
 * a threshold on its own. Same four hand-played games as test-analysis.mjs —
 * decided games with real mistakes in them, not positions this engine chose.
 *
 * Opt-in and slow (minutes). Run:
 *   node scripts/test-mines.mjs [--record] [--quick=120] [--deep=400]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { record, RECORDING } from "./measurements.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const enginePath = path.join(root, "third_party/stockfish/stockfish-18-lite-single.js");
const wasmPath = path.join(root, "third_party/stockfish/stockfish-18-lite-single.wasm");
if (!fs.existsSync(enginePath) || !fs.existsSync(wasmPath)) {
  console.log("skip: vendored Stockfish not found at third_party/stockfish/");
  process.exit(0);
}

const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "review.js", "mistakes.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + f)), ctx, { filename: f });
}
const Chess = ctx.Chess;
const Review = ctx.ChessReview;
const Mistakes = ctx.ChessMistakes;

const argOf = (k) => { const a = process.argv.find((x) => x.startsWith(k + "=")); return a ? Number(a.slice(k.length + 1)) : null; };
const QUICK = argOf("--quick") || 120;
const DEEP = argOf("--deep") || 400;

// the same four games test-analysis.mjs measures scan noise on
const GAMES = [
  { name: "Morphy–Duke of Brunswick & Count Isouard, Paris 1858",
    san: "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(" ") },
  { name: "Steinitz–von Bardeleben, Hastings 1895",
    san: ("e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 d5 exd5 Nxd5 O-O Be6 Bg5 Be7 " +
      "Bxd5 Bxd5 Nxd5 Qxd5 Bxe7 Nxe7 Re1 f6 Qe2 Qd7 Rac1 c6 d5 cxd5 Nd4 Kf7 Ne6 Rhc8 Qg4 g6 " +
      "Ng5+ Ke8 Rxe7+").split(" ") },
  { name: "Anderssen–Kieseritzky, London 1851",
    san: ("e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 " +
      "h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 " +
      "Qf6+ Nxf6 Be7#").split(" ") },
  { name: "Anderssen–Dufresne, Berlin 1852",
    san: ("e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 " +
      "Qxb5 Rb8 Qa4 Bb6 Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 " +
      "Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7#").split(" ") },
];

// --- engine driver (mirrors src/web/js/engine.js) -------------------------
const listeners = [];
const engine = {
  wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)),
  listener: (line) => { for (const l of listeners.slice()) l(line); },
};
const factory = require(enginePath);
await (factory.length >= 1 ? factory(engine) : factory()(engine));
await new Promise((resolve) => {
  const tick = () => (engine._isReady && !engine._isReady() ? setTimeout(tick, 10) : resolve());
  tick();
});
const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
function waitFor(pred, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { drop(); reject(new Error("engine timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); resolve(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function ready() { const w = waitFor((l) => l === "readyok", 10000); send("isready"); await w; }
const uciWait = waitFor((l) => l === "uciok", 20000);
send("uci");
await uciWait;

const infoScore = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  return m ? { kind: m[1], val: Number(m[2]) } : null;
};
/** app.js evalScalar(), to the letter — side-to-move score → White's view */
function evalScalar(score, turn) {
  if (!score) return null;
  const sign = turn === "w" ? 1 : -1;
  if (score.kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(score.val), 50) * 10;
    return score.val > 0 ? sign * mag : -sign * mag;
  }
  return sign * score.val;
}

/** One probe, the UCI sequence analyzeInner() sends; returns {cp, best} or,
    with multipv > 1, {lines: [{cp, move}]} sorted by the engine. */
async function probe(fen, ms, multipv = 1) {
  await ready();
  send("setoption name MultiPV value " + multipv);
  send("setoption name Skill Level value 20");
  send("setoption name UCI_LimitStrength value false");
  send("position fen " + fen);
  const turn = fen.split(" ")[1] === "b" ? "b" : "w";
  const lines = new Map();
  let best = null;
  const collect = (l) => {
    if (typeof l !== "string") return;
    const s = infoScore(l);
    const pv = l.match(/\bmultipv (\d+)\b[\s\S]*\bpv (\S+)/);
    if (s && pv) lines.set(Number(pv[1]), { cp: evalScalar(s, turn), move: pv[2] });
    else if (s && multipv === 1) { const m = l.match(/\bpv (\S+)/); lines.set(1, { cp: evalScalar(s, turn), move: m ? m[1] : null }); }
    const bm = l.match(/^bestmove (\S+)/);
    if (bm) best = bm[1];
  };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  try { await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  const arr = [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]);
  return { cp: arr[0] ? arr[0].cp : null, best, lines: arr };
}

function fensOf(sans) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of sans) { if (!g.move(san)) throw new Error("illegal SAN: " + san); fens.push(g.fen()); }
  return fens;
}
const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
const quantile = (xs, q) => { if (!xs.length) return 0; const s = xs.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };
const mean = (xs) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : 0);

// =========================================================================
// 1 · does the deep pass agree with the quick pass about the book?
// =========================================================================
const quickTracks = [], deepTracks = [];
let survived = 0, withdrawn = 0, sameBest = 0, changedBest = 0, newAtDeep = 0;
const blunderPositions = []; // {fen, side, deepBest} — the ?? plies at DEEP
for (const game of GAMES) {
  const fens = fensOf(game.san);
  const q = [], d = [];
  for (const fen of fens) q.push(await probe(fen, QUICK));
  for (const fen of fens) d.push(await probe(fen, DEEP));
  quickTracks.push(q); deepTracks.push(d);
  for (let i = 0; i < game.san.length; i++) {
    const side = fens[i].split(" ")[1];
    const lossQ = q[i].cp == null || q[i + 1].cp == null ? null : Review.lossOf(q[i].cp, q[i + 1].cp, side);
    const lossD = d[i].cp == null || d[i + 1].cp == null ? null : Review.lossOf(d[i].cp, d[i + 1].cp, side);
    const qq = lossQ != null && Review.markFor(lossQ) === "??";
    const dd = lossD != null && Review.markFor(lossD) === "??";
    if (qq && dd) { survived++; if (q[i].best === d[i].best) sameBest++; else changedBest++; }
    else if (qq && !dd) withdrawn++;
    else if (!qq && dd) newAtDeep++;
    if (dd) blunderPositions.push({ fen: fens[i], side, deepBest: d[i].best, played: game.san[i] });
  }
}
const revision = {
  what: "快扫铸的错题，精析怎么看：还是 ?? 吗、最佳着变了吗、精析另外还发现了几处 ??",
  script: "scripts/test-mines.mjs --record",
  quickMs: QUICK, deepMs: DEEP, games: GAMES.length,
  quickBlunders: survived + withdrawn, survived, withdrawn, withdrawnPct: pct(withdrawn, survived + withdrawn),
  sameBest, changedBest, changedBestPct: pct(changedBest, survived), newAtDeep,
};
console.log("\n=== 1 · 快扫 ?? 在精析下的命运 ===");
console.log(revision);

// =========================================================================
// 2 · at a ?? position, how many moves sit within MISTAKE of the best?
// =========================================================================
const gaps = [], within = { 50: [], 100: [], 200: [] };
for (const bp of blunderPositions) {
  const r = await probe(bp.fen, DEEP, 5);
  const lines = r.lines.filter((l) => l.cp != null && Math.abs(l.cp) < 9000);
  if (lines.length < 2) continue;
  const best = lines[0].cp;
  const loss = (cp) => Math.max(0, bp.side === "w" ? best - cp : cp - best);
  gaps.push(loss(lines[1].cp));
  for (const k of Object.keys(within)) within[k].push(lines.slice(1).filter((l) => loss(l.cp) < Number(k)).length);
}
const alternatives = {
  what: "?? 局面上（精析 MultiPV 5），次佳着离最佳着多少分；离最佳不到 50/100/200 分的替代着各有几个",
  positions: gaps.length,
  secondBestGapMedian: quantile(gaps, 0.5), secondBestGapP25: quantile(gaps, 0.25), secondBestGapP75: quantile(gaps, 0.75),
  acceptedAltsMean: { 50: mean(within[50]), 100: mean(within[100]), 200: mean(within[200]) },
  positionsWithAnyAlt: { 50: pct(within[50].filter((n) => n > 0).length, gaps.length),
                         100: pct(within[100].filter((n) => n > 0).length, gaps.length),
                         200: pct(within[200].filter((n) => n > 0).length, gaps.length) },
  mistakeThreshold: Review.MISTAKE,
};
console.log("\n=== 2 · 替代解的宽严 ===");
console.log(alternatives);

// =========================================================================
// 3 · accuracy after N own moves against accuracy after the whole game
// =========================================================================
const floors = {};
for (const N of [5, 10, 15, 20]) {
  const diffs = [];
  for (let gi = 0; gi < GAMES.length; gi++) {
    const d = deepTracks[gi];
    const sans = GAMES[gi].san;
    const scalars = d.map((x) => x.cp);
    const whole = Review.summarize(scalars, sans, "w");
    for (const side of ["w", "b"]) {
      // the first N own moves = the first 2N plies
      const part = Review.summarize(scalars.slice(0, 2 * N + 1), sans.slice(0, 2 * N), "w");
      if (!whole || !part || whole.acc[side] == null || part.acc[side] == null) continue;
      diffs.push(Math.abs(whole.acc[side] - part.acc[side]));
    }
  }
  floors[N] = { sides: diffs.length, accDiffMean: mean(diffs), accDiffMax: diffs.length ? Math.max(...diffs) : 0 };
}
const verdictFloor = {
  what: "只看前 N 着算出的精准度，与整局精准度差多少个百分点（越小说明 N 着已经够说话）",
  minJudged: Review.MIN_JUDGED, byN: floors,
};
console.log("\n=== 3 · 样本门槛 ===");
console.log(verdictFloor);

if (RECORDING) {
  record("mineRevision", revision);
  record("mineAlternatives", alternatives);
  record("verdictFloor", verdictFloor);
  console.log("\nrecorded to docs/measured.json");
}
send("quit");
process.exit(0);
