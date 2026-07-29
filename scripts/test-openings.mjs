/**
 * Soundness check for the opening book.
 *
 * scripts/test-chess.mjs already proves every line is legal, canonical and
 * unique. That is not the same as being *right*: a line I transcribed with one
 * move out of place is still perfectly legal, and a wrong line in an opening
 * book is worse than a missing one — somebody drills it and memorises a
 * mistake. So play each line out and ask the engine what it thinks of the
 * position it ends in. Book lines end roughly balanced; anything a long way
 * from equal is a line to go back and read by hand.
 *
 * This caught three of the seventy-one lines added in 1.15:
 *   Caro-Kann Advance   +233cp — 7.Nc3 Ne7 just drops the c5 pawn
 *   Trompowsky          +378cp — ...Bf5 hangs the bishop to Bxf5
 *   Scotch Gambit       −220cp — the wrong capture on move eight
 * All three were legal, canonical, and wrong.
 *
 * Searches to a fixed DEPTH, not a fixed time. `go movetime` reaches whatever
 * depth the machine manages in the budget, so the same line scored 111cp on one
 * run and over 130 on the next — B06 (Modern, Austrian Attack) genuinely
 * evaluates around +111, and ±20cp of run-to-run noise straddles the limit.
 * That is tolerable for a check you run by hand and read; it is not tolerable
 * for one that gates a release, where a spurious red teaches you to ignore it.
 * `go depth 20` is reproducible — two runs agree to the centipawn — and lands
 * near where 900ms already got to (depth 17–22, median 19).
 *
 * Opt-in locally: slow (about 2.8 minutes) and needs the vendored engine, so it
 * is not part of package.sh. The release workflow does run it — leaving it to
 * whoever remembered meant "CI is green" never covered this file at all.
 * Run: node scripts/test-openings.mjs [--depth=20] [--ms=900]
 * `--ms` trades reproducibility for speed; the default is the reproducible one.
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

const argOf = (flag) => Number((process.argv.find((a) => a.startsWith(flag)) || "").split("=")[1]);
const argMs = argOf("--ms");
const argDepth = argOf("--depth");
/** fixed time, only when asked for explicitly — it is the non-reproducible mode */
const MS = Number.isFinite(argMs) && argMs > 0 ? argMs : 0;
const DEPTH = Number.isFinite(argDepth) && argDepth > 0 ? argDepth : 20;
/** what the engine is told to do, and how the run describes itself */
const GO = MS ? "go movetime " + MS : "go depth " + DEPTH;
const BUDGET = MS ? `每条 ${MS}ms` : `每条搜到 depth ${DEPTH}`;
/** how far from equal a line may end and still be called book, in centipawns */
const LIMIT = 130;
/** shorter lines are early theory and legitimately less balanced */
const MIN_PLIES = 6;

const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/chess.js"), "utf8"), ctx, { filename: "chess.js" });
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/openings.js"), "utf8"), ctx, { filename: "openings.js" });
const Chess = ctx.Chess;
const BOOK = ctx.CHESS_OPENINGS.filter(([, , seq]) => seq.split(" ").length >= MIN_PLIES);

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
function waitFor(pred, ms = 60000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { drop(); reject(new Error("engine timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); resolve(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function ready() { const w = waitFor((l) => l === "readyok", 20000); send("isready"); await w; }
// register every waiter before its command: in node the engine emits
// synchronously inside ccall (see the same note in test-strength.mjs)
const uciWait = waitFor((l) => l === "uciok", 30000);
send("uci");
await uciWait;
send("setoption name Skill Level value 20");
send("setoption name UCI_LimitStrength value false");

const scoreOf = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

/** @returns {number} centipawns from White's point of view */
async function evalFen(fen, whiteToMove) {
  await ready();
  send("position fen " + fen);
  let cp = null;
  const collect = (l) => { const s = scoreOf(l); if (s != null) cp = s; };
  listeners.push(collect);
  const done = waitFor((l) => /^bestmove/.test(l), 60000);
  send(GO);
  await done;
  listeners.splice(listeners.indexOf(collect), 1);
  return whiteToMove ? cp : -cp;
}

console.log(`检查 ${BOOK.length} 条 ≥${MIN_PLIES} 手的开局线,${BUDGET}\n`);
let flagged = 0;
const cps = [];
for (const [eco, name, seq] of BOOK) {
  const g = new Chess();
  for (const san of seq.split(" ")) g.move(san);
  const cp = await evalFen(g.fen(), g.turn() === "w");
  cps.push(cp);
  if (Math.abs(cp) > LIMIT) {
    flagged++;
    console.error(`FAIL: ${eco} ${name} 结束时 ${cp}cp,超出 ±${LIMIT}`);
    console.error(`      ${seq}`);
  }
}
const mean = Math.round(cps.reduce((a, b) => a + b, 0) / cps.length);
const sorted = cps.slice().sort((a, b) => a - b);
console.log(`\n最低 ${sorted[0]}cp  中位 ${sorted[Math.floor(sorted.length / 2)]}cp  最高 ${sorted[sorted.length - 1]}cp  平均 ${mean}cp`);
if (flagged) { console.error(`${flagged} 条超出范围`); process.exit(1); }
console.log("全部落在书本范围内");
process.exit(0);
