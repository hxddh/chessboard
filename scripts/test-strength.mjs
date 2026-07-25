/**
 * Playing-strength regression for the difficulty tiers.
 *
 * The "beginner" tier is a product promise ("会主动犯错"), and a promise about
 * engine behaviour silently rots: v1.3 shipped Skill Level 1 believing it was
 * a beginner opponent when it actually played at ~27 ACPL — indistinguishable
 * from the tier above it. This script measures the tiers instead of trusting
 * the UCI options, by playing each tier's own search settings on a fixed set
 * of sharp positions and scoring every choice against a full-strength eval.
 *
 * Runs Stockfish directly in node (no browser): it mirrors the UCI command
 * sequence in src/web/js/engine.js, so it catches option regressions but not
 * the browser worker plumbing.
 *
 * Opt-in — slow (minutes) and needs the vendored engine, so it is NOT part of
 * package.sh. Run: node scripts/test-strength.mjs [--samples N]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const enginePath = path.join(root, "third_party/stockfish/stockfish-18-lite-single.js");
const wasmPath = path.join(root, "third_party/stockfish/stockfish-18-lite-single.wasm");
if (!fs.existsSync(enginePath) || !fs.existsSync(wasmPath)) {
  console.log("skip: vendored Stockfish not found at third_party/stockfish/");
  process.exit(0);
}

// chess.js for legality + judging
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/chess.js"), "utf8"), ctx, { filename: "chess.js" });
const Chess = ctx.Chess;

// tier table, read straight from the app so the test cannot drift from it
const engCtx = { console };
engCtx.globalThis = engCtx;
engCtx.window = engCtx;
vm.createContext(engCtx);
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/engine.js"), "utf8"), engCtx, { filename: "engine.js" });
const TIERS = engCtx.ChessEngine.TIERS;

const argSamples = Number((process.argv.find((a) => a.startsWith("--samples")) || "").split("=")[1]);
const SAMPLES = Number.isFinite(argSamples) && argSamples > 0 ? argSamples : 3;

/** Sharp middlegame positions: move quality actually separates tiers here. */
const FENS = [
  "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 4 3",
  "2kr3r/ppp2ppp/2n1b3/4q3/4P3/2N2N2/PPP2PPP/R2QKB1R w KQ - 0 11",
  "r3k2r/ppp2ppp/2n1bn2/3q4/3P4/2N1BN2/PPP2PPP/R2QK2R w KQkq - 0 10",
  "4rrk1/pp3ppp/2p5/3q4/3P4/2P2Q2/P4PPP/3RR1K1 w - - 0 20",
  "r4rk1/1bq2ppp/p1n1p3/1p6/3PN3/P4N2/1P3PPP/R2QR1K1 w - - 0 18",
  "2r2rk1/pp1bqppp/2n1pn2/3p4/3P4/2NBPN2/PPQ2PPP/2R2RK1 w - - 0 12",
  "r1bq1rk1/pp2ppbp/2np1np1/8/3NP3/2N1B3/PPP1BPPP/R2Q1RK1 w - - 0 9",
];

// --- engine driver -------------------------------------------------------
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
// In node the engine emits synchronously inside ccall, so every waiter must be
// registered BEFORE its command is sent (in the browser worker it arrives via
// postMessage, where the order does not matter).
const uciWait = waitFor((l) => l === "uciok", 20000);
send("uci");
await uciWait;

const infoScore = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

/** full-strength eval + best move for `fen` (side-to-move centipawns) */
async function analyze(fen, ms) {
  await ready();
  send("setoption name MultiPV value 1");
  send("setoption name Skill Level value 20");
  send("setoption name UCI_LimitStrength value false");
  send("position fen " + fen);
  let score = null;
  const collect = (l) => { const s = infoScore(l); if (s != null) score = s; };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  let line;
  try { line = await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  const best = line.split(/\s+/)[1];
  return { best: best && best !== "(none)" ? best : null, cp: score };
}

/** one move from `tier`, mirroring engine.js's bestMoveInner */
async function tierMove(fen, tier) {
  await ready();
  send("setoption name MultiPV value " + (tier.multipv || 1));
  if (tier.skill != null) {
    send("setoption name UCI_LimitStrength value false");
    send("setoption name Skill Level value " + tier.skill);
  } else if (tier.elo != null) {
    send("setoption name Skill Level value 20");
    send("setoption name UCI_LimitStrength value true");
    send("setoption name UCI_Elo value " + tier.elo);
  } else {
    send("setoption name Skill Level value 20");
    send("setoption name UCI_LimitStrength value false");
  }
  send("position fen " + fen);
  const cands = new Map();
  const collect = (line) => {
    if (typeof line !== "string" || !tier.multipv) return;
    const mv = line.match(/\bmultipv (\d+)\b/);
    const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    if (mv && pv) cands.set(Number(mv[1]), { uci: pv[1], score: infoScore(line) });
  };
  if (tier.multipv) listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), (tier.movetime || 2000) + 20000);
  send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
  let line;
  try { line = await w; } finally { if (tier.multipv) listeners.splice(listeners.indexOf(collect), 1); }
  let picked = line.split(/\s+/)[1];
  if (tier.multipv && cands.size > 1) {
    const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    const scored = list.filter((c) => c.score != null);
    if (scored.length && scored[0].score >= 100000 - 50) picked = list[0].uci;
    else if (tier.worstBias && Math.random() < tier.worstBias && scored.length) {
      picked = scored.reduce((a, b) => (b.score < a.score ? b : a)).uci;
    } else picked = list[Math.floor(Math.random() * list.length)].uci;
  }
  return picked && picked !== "(none)" ? picked : null;
}

/** eval of the position after playing `uci`, from the mover's perspective */
async function evalAfter(fen, uci) {
  const g = new Chess(fen);
  const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
  if (!mv) return null;
  if (g.in_checkmate()) return 10000;
  if (g.game_over()) return 0;
  const e = await analyze(g.fen(), 500);
  return e.cp == null ? null : -e.cp; // e is from the opponent's side
}

// --- measure -------------------------------------------------------------
const ref = {};
for (const fen of FENS) {
  const b = await analyze(fen, 600);
  if (b.best) ref[fen] = await evalAfter(fen, b.best);
}

const order = ["beginner", "easy", "normal", "hard", "extreme"];
const stats = {};
for (const name of order) {
  const tier = TIERS[name];
  if (!tier) continue;
  const losses = [];
  for (const fen of FENS) {
    if (ref[fen] == null) continue;
    for (let k = 0; k < SAMPLES; k++) {
      const uci = await tierMove(fen, tier);
      if (!uci) continue;
      const got = await evalAfter(fen, uci);
      if (got != null) losses.push(Math.max(0, ref[fen] - got));
    }
  }
  losses.sort((a, b) => a - b);
  stats[name] = {
    n: losses.length,
    acpl: losses.length ? Math.round(losses.reduce((a, b) => a + b, 0) / losses.length) : null,
    median: losses.length ? losses[Math.floor(losses.length / 2)] : null,
    serious: losses.filter((l) => l >= 300).length,
  };
}

console.log("每档在 " + FENS.length + " 个尖锐局面各走 " + SAMPLES + " 次,按满强度评估计算失分:\n");
for (const name of order) {
  const s = stats[name];
  if (!s) continue;
  console.log(
    "  " + name.padEnd(9) +
    " ACPL=" + String(s.acpl).padStart(4) +
    "  中位=" + String(s.median).padStart(4) +
    "  ≥300cp 大失误=" + String(s.serious).padStart(2) + "/" + s.n
  );
}

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); } else console.log("ok:", msg);
}
console.log("");
const beg = stats.beginner, easy = stats.easy, ext = stats.extreme;
// The whole point of the tier: it must be dramatically weaker than the one
// above it, not marginally. v1.3's regression was beginner≈easy.
assert(beg && easy && beg.acpl >= easy.acpl * 2.5,
  "新手档失分显著高于入门档 (" + (beg && beg.acpl) + " vs " + (easy && easy.acpl) + ", 需 ≥2.5x)");
assert(beg && beg.acpl >= 80, "新手档 ACPL ≥ 80 (实测 " + (beg && beg.acpl) + ")");
assert(beg && beg.serious / beg.n >= 0.1,
  "新手档大失误率 ≥ 10% (实测 " + (beg && Math.round((beg.serious / beg.n) * 100)) + "%)");
// ...but not random flailing: half its moves should still be reasonable
assert(beg && beg.median <= 200, "新手档中位失分 ≤ 200,仍像在下棋 (实测 " + (beg && beg.median) + ")");
assert(ext && ext.acpl <= 30, "极限档 ACPL ≤ 30 (实测 " + (ext && ext.acpl) + ")");
assert(easy && easy.acpl <= 80, "入门档 ACPL ≤ 80 (实测 " + (easy && easy.acpl) + ")");

if (failed) { console.error("\n" + failed + " test(s) failed"); process.exit(1); }
console.log("\nall passed");
process.exit(0);
