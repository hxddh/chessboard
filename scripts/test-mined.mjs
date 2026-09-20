/**
 * Soundness gate for the mined `tac` / `win` puzzles.
 *
 * `scripts/test-tactics.mjs` does this for the 23 hand-written `cat: "real"`
 * puzzles and says why it has to exist: "the generator screened at 350ms; this
 * re-searches deeper, which is where three of the first candidate set turned
 * out to have a second solution." The 894 mined tac/win puzzles — the
 * overwhelming majority of what a player actually meets — had no such gate at
 * all. They were screened once during mining at 120ms with a 120cp margin and
 * never looked at again.
 *
 * Measured before this file existed (140 sampled at depth 18): 6% had a second
 * solution within 50cp, and another 6% stored an answer that was not even the
 * engine's first choice — one by 262cp, which means the app was teaching a
 * worse move. Roughly one puzzle in nine.
 *
 * 7.0 also made the app accept an equally good first move (app.js `verifyAlt`),
 * so a second solution is no longer a wrong answer for the player. This gate is
 * the other half: the *stored* answer has to be a best move, because it is what
 * the "show me the answer" button teaches.
 *
 * Two verdicts, deliberately separate:
 *   - `not-best`  the stored answer is not the engine's first choice. A content
 *                 error: fix or retire the puzzle.
 *   - `tied`      the stored answer is first but something else is within
 *                 `TIE`. Not an error — record the alternative in `alts` so the
 *                 app can accept it without paying for a search.
 *
 * `--fix` rewrites src/web/js/puzzles-mined.js: `tied` puzzles gain their
 * alternatives, `not-best` puzzles are retired. **Ids are never rewritten** —
 * 6.0 → 6.1 kept all 958, and a changed id orphans a player's progress.
 *
 * Opt-in and slow (about 2s per puzzle, so ~30 min for the set) and needs the
 * vendored engine, so it rides in `test:engine`, not in PR CI.
 *   node scripts/test-mined.mjs [--depth=18] [--sample=N] [--fix]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);
const argOf = (flag) => Number((process.argv.find((a) => a.startsWith(flag + "=")) || "").slice(flag.length + 1));

const DEPTH = argOf("--depth") || 18;
const SAMPLE = argOf("--sample") || 0;
const FIX = process.argv.includes("--fix");
/** how far clear of the runner-up counts as "alone"; below this they are tied */
const TIE = 50;

const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "puzzles-mined.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), ctx, { filename: f });
}
const Chess = ctx.Chess;
const all = (ctx.MINED_PUZZLES || []).filter((p) => p.cat === "tac" || p.cat === "win");
if (!all.length) { console.log("no mined tac/win puzzles to check"); process.exit(0); }

// A fixed shuffle so `--sample` takes a spread of the set rather than its head,
// and takes the SAME spread on every run — a gate that samples differently each
// time reports a different number each time and teaches people to re-run it.
let seed = 20260920;
const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const order = all.slice();
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const puzzles = SAMPLE > 0 ? order.slice(0, SAMPLE) : order;

const listeners = [];
const engine = {
  wasmBinary: new Uint8Array(fs.readFileSync(path.join(root, "third_party/stockfish/stockfish-19-lite-single.wasm"))),
  listener: (line) => { for (const h of listeners.slice()) h(line); },
};
const factory = require(path.join(root, "third_party/stockfish/stockfish-19-lite-single.js"));
await (factory.length >= 1 ? factory(engine) : factory()(engine));
await new Promise((r) => { const tick = () => (engine._isReady && !engine._isReady() ? setTimeout(tick, 10) : r()); tick(); });
const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
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

/** the top two moves in SAN with their scores, best first */
async function topTwo(fen) {
  await ready();
  send("setoption name MultiPV value 2");
  send("position fen " + fen);
  const found = new Map();
  const collect = (line) => {
    const mp = /\bmultipv (\d+)\b/.exec(line);
    const sc = scoreOf(line);
    const pv = /\bpv ((?:[a-h][1-8][a-h][1-8][qrbn]?\s*)+)/.exec(line);
    if (mp && sc != null && pv) found.set(Number(mp[1]), { score: sc, uci: pv[1].trim().split(/\s+/)[0] });
  };
  listeners.push(collect);
  const done = waitFor((l) => /^bestmove/.test(l), 180000);
  send("go depth " + DEPTH);
  await done;
  listeners.splice(listeners.indexOf(collect), 1);
  return [...found.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => {
    const g = new Chess(fen);
    const m = g.move({ from: v.uci.slice(0, 2), to: v.uci.slice(2, 4), promotion: v.uci[4] });
    return { san: m ? m.san : v.uci, score: v.score };
  });
}

console.log(`挖掘题里的 tac + win 共 ${all.length} 道，本轮检查 ${puzzles.length} 道，go depth ${DEPTH}\n`);

const notBest = [];
const tied = [];
let clean = 0;
for (let i = 0; i < puzzles.length; i++) {
  const p = puzzles[i];
  const stored = (p.solution || p.line || [])[0];
  if (!stored) continue;
  const lines = await topTwo(p.fen);
  if (!lines.length) continue;
  const [first, second] = lines;
  if (first.san !== stored) {
    notBest.push({ id: p.id, cat: p.cat, stored, best: first.san,
      gap: second ? first.score - second.score : null });
  } else if (second && first.score - second.score < TIE) {
    tied.push({ id: p.id, cat: p.cat, stored, alt: second.san, gap: first.score - second.score });
  } else {
    clean++;
  }
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${puzzles.length}\n`);
}

const bad = notBest.length + tied.length;
console.log(`干净 ${clean} · 存的答案不是首选 ${notBest.length} · 有同等好的第二解 ${tied.length}`);
console.log(`问题率 ${((bad / puzzles.length) * 100).toFixed(1)}%\n`);
for (const r of notBest.slice(0, 20)) console.log(`  not-best  ${r.id.padEnd(18)} 存 ${r.stored.padEnd(7)} 引擎 ${r.best}`);
for (const r of tied.slice(0, 20)) console.log(`  tied      ${r.id.padEnd(18)} 存 ${r.stored.padEnd(7)} 同等 ${r.alt.padEnd(7)} 差 ${r.gap}cp`);

if (FIX) {
  const file = path.join(root, "src/web/js/puzzles-mined.js");
  let src = fs.readFileSync(file, "utf8");
  const retire = new Set(notBest.map((r) => r.id));
  let dropped = 0, noted = 0;
  // one entry per line in this generated file, so a line filter is exact
  src = src.split("\n").filter((line) => {
    const m = /id: "([^"]+)"/.exec(line);
    if (m && retire.has(m[1])) { dropped++; return false; }
    return true;
  }).join("\n");
  for (const r of tied) {
    const re = new RegExp('(id: "' + r.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[^\\n]*?)(\\s*\\},)');
    if (re.test(src) && !new RegExp('id: "' + r.id + '"[^\\n]*alts:').test(src)) {
      src = src.replace(re, (all0, head, tail) => head + ', alts: ["' + r.alt + '"]' + tail);
      noted++;
    }
  }
  fs.writeFileSync(file, src);
  console.log(`\n--fix：退役 ${dropped} 道，记下 ${noted} 道的同等解。id 一个都没改写。`);
  console.log("重新跑 test-learning.mjs 更新题量下限，再跑一遍本文件复核。");
}

// The gate itself. `--sample` is for looking around; only a full pass may
// pronounce the set sound, so a sampled run never fails the build.
if (!FIX && !SAMPLE) {
  if (bad) {
    console.error(`\nFAIL: ${bad} 道没过门禁 —— 用 --fix 清理，或逐条改写`);
    process.exit(1);
  }
  console.log("\nall mined tac/win puzzles are sound");
}
