/**
 * v7-plan §6.4's验收, finally taken — how often can the app say *why*?
 *
 * 7.0 shipped the explanation: a `?` or `??` in the library carries the motif
 * of the move the engine would have played instead, on the argument that a
 * blunder rarely has a pattern and the move that punishes it does. §10 ticked
 * it. But §6.4 had written its own acceptance —
 *
 *   「在 28 局语料上，能给出解释的失误比例要量出来并写明；抽样人工核对解释的
 *     正确率，低于某个门槛就默认关掉这个功能并如实记录」
 *
 * — and the first half of it was never done: `docs/measured.json` has no such
 * key. A feature whose acceptance was written and skipped is a feature nobody
 * can argue about, which is the state 7.1 is trying to get out of (see
 * docs/v7-plan.md §11.6 for the two others like it).
 *
 * What this measures: of the plies the win-percentage track judges `?` or
 * `??`, how many get a motif out of `motif.js`. That is the fraction of
 * mistakes the app can say something about beyond a number.
 *
 * What this does NOT measure, said plainly because §6.4 asked for it: the
 * *correctness* of those labels. `motif.js` names only five patterns and only
 * from geometric facts about the position after the move — "the piece that
 * moved is not the piece giving check", "this piece now attacks two things
 * worth taking" — and returns null wherever nothing is certain. That is an
 * argument for correctness by construction, not a sample of human judgement,
 * and this script cannot supply the latter. The honest reading of the number
 * below is "how often the app has anything to say", not "how often it is
 * right". A human pass over a sample belongs in docs/manual-check.md.
 *
 * There is therefore no threshold here that switches the feature off: a low
 * coverage rate means the explanation is often absent, which is exactly what
 * `motif.js` was designed to do rather than guess. A *wrong* label would be
 * the reason to switch it off, and this script is not the instrument that
 * would find one.
 *
 * Opt-in and slow (the whole corpus at 200ms is about ten minutes). Runs
 * Stockfish directly in node, the same way test-analysis.mjs does.
 *   node scripts/test-motif.mjs [--record] [--ms=200] [--games=N]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { record, RECORDING } from "./measurements.mjs";
import { GAMES } from "./fixtures/corpus.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const enginePath = path.join(root, "third_party/stockfish/stockfish-19-lite-single.js");
const wasmPath = path.join(root, "third_party/stockfish/stockfish-19-lite-single.wasm");
if (!fs.existsSync(enginePath) || !fs.existsSync(wasmPath)) {
  console.log("skip: vendored Stockfish not found at third_party/stockfish/");
  process.exit(0);
}

const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "review.js", "motif.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + f)), ctx, { filename: f });
}
const Chess = ctx.Chess;
const Review = ctx.ChessReview;
const motifOf = ctx.motifOf;

const argOf = (k, d) => {
  const a = process.argv.find((x) => x.startsWith(k + "="));
  const n = a ? Number(a.slice(k.length + 1)) : NaN;
  return Number.isFinite(n) && n > 0 ? n : d;
};
/** the app's own quick-scan budget (app.js SCAN_BUDGET), which is what a library pass uses */
const MS = argOf("--ms", 200);
const LIMIT = argOf("--games", RECORDING ? Infinity : 4);

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
/** app.js evalScalar(), to the letter */
function evalScalar(score, turn) {
  if (!score) return null;
  const sign = turn === "w" ? 1 : -1;
  if (score.kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(score.val), 50) * 10;
    return score.val > 0 ? sign * mag : -sign * mag;
  }
  return sign * score.val;
}

/** One probe: the evaluation AND the engine's own move, which is the explanation's subject. */
async function probe(fen, ms) {
  await ready();
  send("setoption name MultiPV value 1");
  send("setoption name Skill Level value 20");
  send("setoption name UCI_LimitStrength value false");
  send("position fen " + fen);
  let score = null;
  const collect = (l) => { const s = infoScore(l); if (s) score = s; };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  let best = null;
  try { best = (String(await w).split(/\s+/)[1] || "").trim(); }
  finally { listeners.splice(listeners.indexOf(collect), 1); }
  return { scalar: evalScalar(score, fen.split(" ")[1] === "b" ? "b" : "w"),
    best: best && best !== "(none)" ? best : null };
}

/** UCI → SAN in `fen`, or null if it will not play. */
function sanOf(fen, uci) {
  if (!uci || uci.length < 4) return null;
  try {
    const g = new Chess(fen);
    const m = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    return m ? m.san : null;
  } catch (_) { return null; }
}

const games = GAMES.slice(0, LIMIT === Infinity ? GAMES.length : LIMIT);
const byMotif = {};
let plies = 0, mistakes = 0, blunders = 0, explained = 0, blundersExplained = 0, noBest = 0;

for (const game of games) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of game.san) {
    if (!g.move(san)) throw new Error("illegal SAN in corpus: " + san);
    fens.push(g.fen());
  }
  const probes = [];
  for (const fen of fens) probes.push(await probe(fen, MS));
  for (let i = 0; i < game.san.length; i++) {
    plies++;
    const a = probes[i].scalar, b = probes[i + 1].scalar;
    if (a == null || b == null) continue;
    const mover = fens[i].split(" ")[1] === "w" ? "w" : "b";
    const tag = Review.classifyByWinPct(Review.winPctDrop(a, b, mover));
    if (tag !== "?" && tag !== "??") continue;
    mistakes++;
    if (tag === "??") blunders++;
    // the app's rule, exactly: the motif of the move the ENGINE would have
    // played here, not of the move that was played
    const san = sanOf(fens[i], probes[i].best);
    if (!san) { noBest++; continue; }
    let m = null;
    try { m = motifOf(fens[i], san, Chess); } catch (_) { m = null; }
    if (!m) continue;
    explained++;
    if (tag === "??") blundersExplained++;
    byMotif[m] = (byMotif[m] || 0) + 1;
  }
  process.stdout.write(".");
}
process.stdout.write("\n");

const pct = (a, b) => (b ? Math.round((a / b) * 1000) / 10 : 0);
console.log(`\n语料 ${games.length} 局 · ${plies} 半着 · 每手 ${MS}ms`);
console.log(`判为 ? 或 ?? 的：${mistakes} 手`);
console.log(`其中给得出母题解释的：${explained} 手（${pct(explained, mistakes)}%）`);
console.log(`只看 ??：${blundersExplained}/${blunders}（${pct(blundersExplained, blunders)}%）`);
if (noBest) console.log(`引擎没给出着法、因此无从解释的：${noBest} 手`);
const rows = Object.entries(byMotif).sort((x, y) => y[1] - x[1]);
for (const [m, n] of rows) console.log(`  ${m.padEnd(12)} ${n}`);

let failed = 0;
const assert = (cond, msg) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
};
// Sanity of the measurement, not of its verdict — the same rule the other
// measurement scripts follow. Nothing here decides the feature's fate.
assert(plies === games.reduce((n, x) => n + x.san.length, 0), "每一个半着都过了一遍");
assert(explained <= mistakes && blundersExplained <= blunders, "解释数不可能多过失误数");
assert(rows.every(([m]) => ["discovered", "double", "fork", "pin", "skewer"].includes(m)),
  "母题只可能是 motif.js 认得的那五个");

const out = {
  what: "复盘把失误解释成一个母题的覆盖率 —— 用的是引擎在你走错之前那一手的母题",
  script: "scripts/test-motif.mjs --record",
  caveat: "只量了覆盖率。正确性没有人工抽样核对过：motif.js 只认五个母题、" +
    "而且只在几何事实确凿时才开口，不确定就返回 null —— 这是构造上的正确性论证，" +
    "不是一次抽样。人工核对属于 docs/manual-check.md。",
  movetimeMs: MS,
  games: games.length,
  plies,
  mistakes,
  explained,
  explainedPct: pct(explained, mistakes),
  blunders,
  blundersExplained,
  blundersExplainedPct: pct(blundersExplained, blunders),
  byMotif: Object.fromEntries(rows),
};
if (RECORDING) record("motifCoverage", out);
else console.log("\n（只打印，没写入。加 --record 才写 docs/measured.json）");
process.exit(failed ? 1 : 0);
