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
/**
 * How many lines to ask for. 2 was not enough: it answers "is the stored move
 * first", and the question is "how much worse is the stored move", which needs
 * to find it. 4 catches nearly all of them without paying for a wide search;
 * anything further down gets its own `searchmoves` probe.
 */
const LINES = 4;

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

/**
 * Start a position from a clean transposition table.
 *
 * Without this the engine carries every previous puzzle's hash entries into
 * the next one, so a `go depth 18` depends on what was searched before it —
 * the set, the shuffle, everything. That is not a small effect: two passes
 * over the same file disagreed about which move was best, by how much, and
 * even about whether a forced mate exists (margins of 95000cp appearing in
 * one run and not the other). The first two cuts of this gate were both built
 * on that sand.
 *
 * `ucinewgame` tells the engine the next position is unrelated to the last,
 * which is exactly true here and is what makes a run reproducible.
 */
const freshSearch = async () => {
  await ready();
  send("ucinewgame");
  await ready();
};

const scoreOf = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};

/** the top `n` moves in SAN with their scores, best first */
async function topLines(fen, n) {
  await freshSearch();
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

/**
 * What one specific move is worth, at the same depth.
 *
 * Needed because `MULTIPV` only shows the top few: a stored answer that is not
 * among them has an unknown score, and "unknown" is not "bad". `searchmoves`
 * restricts the search to that one move, so the number is directly comparable
 * with the best line's.
 */
async function scoreOfMove(fen, san) {
  const g = new Chess(fen);
  const m = g.move(san);
  if (!m) return null;
  const uci = m.from + m.to + (m.promotion || "");
  await freshSearch();
  send("setoption name MultiPV value 1");
  send("position fen " + fen);
  let best = null;
  const collect = (line) => { const sc = scoreOf(line); if (sc != null && /\bpv\b/.test(line)) best = sc; };
  listeners.push(collect);
  const done = waitFor((l) => /^bestmove/.test(l), 180000);
  send("go depth " + DEPTH + " searchmoves " + uci);
  await done;
  listeners.splice(listeners.indexOf(collect), 1);
  return best;
}

console.log(`挖掘题里的 tac + win 共 ${all.length} 道，本轮检查 ${puzzles.length} 道，go depth ${DEPTH}\n`);

const notBest = [];
const tied = [];
let clean = 0, resolved = 0;
for (let i = 0; i < puzzles.length; i++) {
  const p = puzzles[i];
  const stored = (p.solution || p.line || [])[0];
  if (!stored) continue;
  const lines = await topLines(p.fen, LINES);
  if (!lines.length) continue;
  const best = lines[0];
  // How much worse is the STORED answer — not what rank it happens to hold.
  // Rank is the wrong question and the first cut of this file asked it anyway:
  // two moves within a centipawn of each other swap places between runs (the
  // transposition table carries different history into each position), so a
  // gate built on rank reports a different set every time and never goes
  // green. Worse, `--fix` retired on rank alone, so a puzzle whose answer was
  // 1cp off the engine's pick was thrown away exactly like one that was 262cp
  // off. Margin is the question, and `searchmoves` answers it for a stored
  // move that did not make the top `LINES`.
  const shown = lines.find((l) => l.san === stored);
  const storedScore = shown ? shown.score : await scoreOfMove(p.fen, stored);
  if (storedScore == null) { notBest.push({ id: p.id, cat: p.cat, stored, best: best.san, margin: null }); continue; }
  const margin = best.score - storedScore;
  const alts = Array.isArray(p.alts) ? p.alts : [];
  if (margin > TIE) {
    // genuinely worse: the answer this puzzle teaches is not a best move
    notBest.push({ id: p.id, cat: p.cat, stored, best: best.san, margin });
  } else if (best.san === stored) {
    // stored IS the engine's pick. A runner-up within TIE is an equally good
    // answer the app should accept — unless it is already recorded.
    const second = lines[1];
    if (second && best.score - second.score < TIE && !alts.includes(second.san)) {
      tied.push({ id: p.id, cat: p.cat, stored, alt: second.san, gap: best.score - second.score });
    } else { clean++; }
  } else if (alts.includes(best.san)) {
    // stored is within TIE of the engine's pick and that pick is already
    // listed as acceptable — this is what "fixed" looks like, so say so
    resolved++;
  } else {
    tied.push({ id: p.id, cat: p.cat, stored, alt: best.san, gap: margin });
  }
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${i + 1}/${puzzles.length}\n`);
}

const bad = notBest.length + tied.length;
console.log(`干净 ${clean} · 已记下同等解 ${resolved} · 存的答案确实更差 ${notBest.length} · 有未记下的同等解 ${tied.length}`);
console.log(`问题率 ${((bad / puzzles.length) * 100).toFixed(1)}%\n`);
for (const r of notBest.slice(0, 20)) console.log(`  worse     ${r.id.padEnd(18)} 存 ${r.stored.padEnd(7)} 引擎 ${r.best.padEnd(7)} 差 ${r.margin == null ? "?" : r.margin}cp`);
for (const r of tied.slice(0, 20)) console.log(`  tied      ${r.id.padEnd(18)} 存 ${r.stored.padEnd(7)} 同等 ${r.alt.padEnd(7)} 差 ${r.gap}cp`);

if (FIX) {
  const file = path.join(root, "src/web/js/puzzles-mined.js");
  let src = fs.readFileSync(file, "utf8");
  // only the ones measured to be genuinely worse are retired now — a move
  // that merely lost a coin flip for first place is recorded, not deleted
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
    const hasAlts = new RegExp('id: "' + r.id + '"[^\\n]*alts: \\[([^\\]]*)\\]').exec(src);
    if (hasAlts) {
      // already has a list — append unless this alternative is in it. Two runs
      // can name different runners-up for the same position (they are within
      // a centipawn of each other), and both are acceptable answers.
      if (!hasAlts[1].includes('"' + r.alt + '"')) {
        src = src.replace(hasAlts[0], hasAlts[0].replace(/\]$/, ', "' + r.alt + '"]'));
        noted++;
      }
    } else if (re.test(src)) {
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
//
// Only `worse` fails. An unrecorded equally-good alternative is NOT a defect:
// 7.0's app re-searches the position when the player plays a different first
// move (app.js `verifyAlt`), so `alts` is a cache that skips that search, not
// the thing that makes the answer right. A missing entry costs one engine
// search, never a wrong verdict.
//
// And making it fail would leave the gate permanently red, because which move
// is the runner-up is not stable between runs when two moves are a centipawn
// apart — so every pass would name a slightly different set and the build
// would never go green. A gate that can never be satisfied is a gate people
// learn to ignore, which is worse than not having one.
if (!FIX) {
  if (tied.length) {
    console.log(`\n注意：${tied.length} 道有还没记下的同等解。不算失败（app 会当场复核），` +
      "想省掉那次搜索就跑一次 --fix。");
  }
  // 7.1 (v7-1-plan §3.2): a sample fails on `not-best` too.
  //
  // Until now a `--sample` run printed its findings and exited 0, which made
  // the sampled tier worth nothing as a gate — and the sampled tier is the
  // only one a pull request can afford. The reason the whole verdict was
  // skipped was `tied`, not `not-best`: which move is the runner-up is not
  // stable between runs when two are a centipawn apart, so gating on `tied`
  // would be a gate that can never go green. `not-best` is a content error
  // by a margin of more than TIE — it does not flicker, and a sample that
  // finds one has found a real one.
  if (notBest.length) {
    console.error(`\nFAIL: ${notBest.length} 道存的答案确实更差（超过 ${TIE}cp）—— ` +
      "用 --fix 退役，或逐条改写");
    process.exit(1);
  }
  console.log(SAMPLE
    ? `\nsampled ${puzzles.length} mined tac/win puzzles: none stores a worse answer`
    : "\nall mined tac/win puzzles are sound");
}
