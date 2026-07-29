/**
 * Soundness check for the real-game tactics (`cat: "real"`).
 *
 * scripts/test-chess.mjs proves the structural claims: 20+ men, White not
 * already down material, more than one capture available, a legal canonical
 * line whose material swing equals the stated gain. None of that proves the
 * puzzle is a puzzle. The claim the category actually makes — printed in the
 * goal line the player reads — is that **exactly one move wins material**, and
 * only an engine can check that.
 *
 * So: search every position wide enough to see the runner-up, and fail any
 * puzzle where the stored key move is not alone by a clear margin. The
 * generator screened at 350ms; this re-searches deeper, which is where three of
 * the first candidate set turned out to have a second solution.
 *
 * Opt-in locally: slow (about two seconds per puzzle) and needs the vendored
 * engine, so it is not part of package.sh. The release workflow does run it —
 * leaving it to whoever remembered meant "CI is green" never covered this file
 * at all.
 * Run: node scripts/test-tactics.mjs [--depth=20] [--ms=1800]
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
const argOf = (flag) => Number((process.argv.find((a) => a.startsWith(flag + "=")) || "").slice(flag.length + 1));
// Fixed depth, not fixed time — same reason as test-openings.mjs. The tightest
// puzzle cleared the runner-up by 218cp against a 200cp bar at 1800ms, which is
// inside the run-to-run noise of a time-limited search: a release gate that
// flickers is a release gate people learn to re-run. `go depth 20` is
// reproducible to the centipawn, sits where 1800ms already reached (17-21), and
// resolves these positions harder — the tightest margin becomes 276cp.
const MS = argOf("--ms") || 0;
const DEPTH = argOf("--depth") || 20;
const GO = MS ? "go movetime " + MS : "go depth " + DEPTH;
const BUDGET = MS ? MS + "ms each" : "depth " + DEPTH + " each";
/** how far clear of the runner-up the key move has to be, in centipawns */
const MARGIN = 200;
/** the runner-up must not itself be winning */
const SECOND_CEIL = 150;

const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "puzzles.js"]) {
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js", f), "utf8"), ctx, { filename: f });
}
const Chess = ctx.Chess;
const puzzles = (ctx.CHESS_PUZZLES || []).filter((p) => p.cat === "real");
if (!puzzles.length) {
  console.log("no real-game tactics to check");
  process.exit(0);
}

const listeners = [];
const engine = {
  wasmBinary: new Uint8Array(fs.readFileSync(path.join(root, "third_party/stockfish/stockfish-18-lite-single.wasm"))),
  listener: (line) => { for (const h of listeners.slice()) h(line); },
};
const factory = require(path.join(root, "third_party/stockfish/stockfish-18-lite-single.js"));
await (factory.length >= 1 ? factory(engine) : factory()(engine));
await new Promise((r) => {
  const tick = () => (engine._isReady && !engine._isReady() ? setTimeout(tick, 10) : r());
  tick();
});
const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
// the waiter has to be registered before the command: in Node the engine
// emits synchronously inside ccall, so a listener added afterwards misses it
const waitFor = (pred, ms) => new Promise((res, rej) => {
  const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
  const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); res(line); } };
  const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
  listeners.push(h);
});
const uciok = waitFor((l) => l === "uciok", 30000); send("uci"); await uciok;
const ready = async () => { const w = waitFor((l) => l === "readyok", 20000); send("isready"); await w; };

const scoreOf = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

/** the top `n` moves in SAN, best first */
async function topMoves(fen, n) {
  await ready();
  send("setoption name MultiPV value " + n);
  send("position fen " + fen);
  const found = new Map();
  const collect = (line) => {
    const mp = /\bmultipv (\d+)\b/.exec(line);
    const sc = scoreOf(line);
    const pv = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(line);
    if (mp && sc != null && pv) found.set(Number(mp[1]), { score: sc, uci: pv[1].trim().split(/\s+/)[0] });
  };
  listeners.push(collect);
  const done = waitFor((l) => /^bestmove/.test(l), 120000);
  send(GO);
  await done;
  listeners.splice(listeners.indexOf(collect), 1);
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => {
    const g = new Chess(fen);
    const mv = g.move({ from: v.uci.slice(0, 2), to: v.uci.slice(2, 4), promotion: v.uci[4] || "q" });
    return { san: mv ? mv.san : v.uci, score: v.score };
  });
}

let bad = 0;
console.log(`checking ${puzzles.length} real-game tactics at ${BUDGET}\n`);
for (const p of puzzles) {
  const top = await topMoves(p.fen, 3);
  const key = p.line[0];
  if (top.length < 2) { console.error(`FAIL ${p.id}: engine offered no runner-up`); bad++; continue; }
  const gap = top[0].score - top[1].score;
  const problems = [];
  if (top[0].san !== key) problems.push(`engine prefers ${top[0].san} (${top[0].score}) over the stored ${key}`);
  if (gap < MARGIN) problems.push(`only ${gap}cp clear of ${top[1].san}`);
  if (top[1].score >= SECOND_CEIL) problems.push(`runner-up ${top[1].san} is also winning (${top[1].score})`);
  if (problems.length) {
    console.error(`FAIL ${p.id} (${p.name}): ` + problems.join("; "));
    bad++;
  } else {
    console.log(`ok   ${p.id.padEnd(12)} ${key.padEnd(7)} ${String(gap).padStart(5)}cp clear of ${top[1].san}`);
  }
}
console.log(bad ? `\n${bad} tactic(s) failed` : "\nall real-game tactics are sound");
process.exit(bad ? 1 : 0);
