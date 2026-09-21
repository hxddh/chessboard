/**
 * Two measurements the code has been guessing at.
 *
 * P6 of docs/refactor-plan.md holds the questions that had to be measured
 * before anything was changed, because in both cases the obvious fix and the
 * obvious opposite fix are equally plausible from reading the source:
 *
 *   缺陷 23 — the move list annotates `?!` at 50cp, `?` at 100 and `??` at 300,
 *   and the quick scan gives each position 120ms. If 120ms of search wobbles by
 *   tens of centipawns on its own, then the `?!` band is inside the noise and
 *   the same game scanned twice tells two different stories. **Measured here by
 *   scanning the same games twice and comparing the tag sets**, at the quick
 *   scan's 120ms and at the deep pass's 400ms.
 *
 *   v6-plan Q2.5 — the same question for the win-percentage classification
 *   (review.js winPct / classifyByWinPct, cut-offs 5 / 10 / 20 points). It
 *   costs no extra engine time: the same two eval tracks are re-tagged the
 *   second way, and `winPctNoise` is written next to `scanNoise` with the
 *   same method so the two can be read side by side. The plan's acceptance
 *   is `?!` two-pass agreement ≥ 60% at 120ms; whatever comes out is recorded.
 *
 *   缺陷 32 — the beginner tier is `{skill:0, depth:2, multipv:10,
 *   worstBias:0.2}`: two times in ten it plays the worst candidate, and the
 *   other eight it picks uniformly among however many candidates came back.
 *   The claim in the defect is that the candidate count tracks the phase, so
 *   the tier quietly gets stronger as the board empties. **Measured here by
 *   counting the lines the engine actually returns at each phase**, together
 *   with the score spread across those lines — because if the count is flat
 *   and the spread is not, the sampling is what needs weighting, not the count.
 *
 * A measurement more than a test: it prints a table and, with --record,
 * writes docs/measured.json so prose can quote it instead of restating it.
 * Nothing here decides on its own that a threshold should move. The few
 * assertions are about the measurement's own sanity (both passes covered
 * every position, a rate is a rate, the sweep was taken), not its verdict.
 *
 * Runs Stockfish directly in node, mirroring the UCI sequence in
 * src/web/js/engine.js — same caveat as test-strength.mjs: it catches option
 * and threshold regressions, not the browser worker plumbing.
 *
 * Opt-in and slow (minutes). Run:
 *   node scripts/test-analysis.mjs [--record] [--ms=120,400] [--games=N]
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

// chess.js for legality, review.js for the very thresholds under test — read
// from the app so this cannot drift from what the move list actually annotates
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/chess.js")), ctx, { filename: "module" });
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/review.js")), ctx, { filename: "module" });
const Chess = ctx.Chess;
const Review = ctx.ChessReview;

const engCtx = { console };
engCtx.globalThis = engCtx;
engCtx.window = engCtx;
vm.createContext(engCtx);
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/engine.js")), engCtx, { filename: "module" });
const TIERS = engCtx.ChessEngine.TIERS;

const msArg = (process.argv.find((a) => a.startsWith("--ms=")) || "").slice(5);
// 6.1: how many of the 28 games this run measures. --record takes them all
// (about twenty minutes); a plain run takes the first few so the gate is
// quick. See the corpus note at the top of this file.
const gamesArg = Number((process.argv.find((a) => a.startsWith("--games=")) || "").slice(8));
const GAME_LIMIT = Number.isFinite(gamesArg) && gamesArg > 0 ? gamesArg : (RECORDING ? Infinity : 6);
const MOVETIMES = msArg ? msArg.split(",").map(Number).filter((n) => n > 0) : [120, 400];

// The corpus lives in scripts/fixtures/corpus.mjs since 7.1 — see its header.

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
  if (!m) return null;
  return { kind: m[1], val: Number(m[2]) };
};

/** app.js evalScalar(), to the letter — side-to-move score → White's point of view */
function evalScalar(score, turn) {
  if (!score) return null;
  const sign = turn === "w" ? 1 : -1;
  if (score.kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(score.val), 50) * 10;
    return score.val > 0 ? sign * mag : -sign * mag;
  }
  return sign * score.val;
}

/** One quick-scan probe, the same UCI sequence analyzeInner() sends. */
async function scan(fen, ms) {
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
  try { await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  return evalScalar(score, fen.split(" ")[1] === "b" ? "b" : "w");
}

/** Every position of a game, the way analyzeGame() walks it. */
function fensOf(sans) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of sans) {
    if (!g.move(san)) throw new Error("illegal SAN in fixture: " + san);
    fens.push(g.fen());
  }
  return fens;
}

/** The tag the move list would print for each ply of one eval track. */
function tagsOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.markFor(Review.lossOf(a, b, side)));
  }
  return out;
}

/** The centipawn loss of each ply of one eval track — markFor()'s input. */
function lossesOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.lossOf(a, b, side));
  }
  return out;
}

/**
 * How reproducible would the lowest band be at `cut` instead of 50?
 *
 * Swept over the eval tracks already recorded, so trying ten thresholds costs
 * nothing and the answer is measured rather than argued. A threshold is only
 * worth moving to if the marks it prints survive a second scan.
 */
function agreementAt(pairs, lo, hi) {
  let a = 0, b = 0, both = 0;
  for (const [la, lb] of pairs) {
    for (let i = 0; i < la.length; i++) {
      const inA = la[i] != null && la[i] >= lo && la[i] < hi;
      const inB = lb[i] != null && lb[i] >= lo && lb[i] < hi;
      if (inA) a++;
      if (inB) b++;
      if (inA && inB) both++;
    }
  }
  const union = a + b - both;
  return { runA: a, runB: b, both, agreePct: union ? Math.round((both / union) * 100) : 0 };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}

/** The win-percentage drop of each ply of one eval track — classifyByWinPct()'s input. */
function dropsOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.winPctDrop(a, b, side));
  }
  return out;
}

/** Jaccard agreement of two tag tracks, per tag. */
function tagAgreement(tA, tB, keys) {
  const agree = {};
  for (const k of keys) {
    let a = 0, b = 0, both = 0;
    for (let i = 0; i < tA.length; i++) {
      if (tA[i] === k) a++;
      if (tB[i] === k) b++;
      if (tA[i] === k && tB[i] === k) both++;
    }
    agree[k] = { a, b, both };
  }
  return agree;
}
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// =========================================================================
// 缺陷 23 — does the same game scanned twice tell the same story?
// =========================================================================
const scanOut = { what: "同一局连跑两次快扫,比较两次的标注集合与逐点评估抖动",
  script: "scripts/test-analysis.mjs --record",
  thresholds: { inaccuracy: Review.INACCURACY, mistake: Review.MISTAKE, blunder: Review.BLUNDER },
  games: Math.min(GAMES.length, GAME_LIMIT), byMovetime: {} };
const wpOut = { what: "同一两遍快扫的评估轨迹,改按胜率降幅分类(review.js classifyByWinPct),比较两次的标注集合",
  script: "scripts/test-analysis.mjs --record",
  thresholds: { inaccuracy: Review.WIN_INACCURACY, mistake: Review.WIN_MISTAKE, blunder: Review.WIN_BLUNDER },
  games: Math.min(GAMES.length, GAME_LIMIT), byMovetime: {} };
const TAGS = ["?!", "?", "??"];

for (const ms of MOVETIMES) {
  const jitter = [];
  const agree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
  const wpAgree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
  const lossPairs = [], dropPairs = [];
  let plies = 0, wpPlies = 0;
  for (const game of GAMES.slice(0, GAME_LIMIT)) {
    const fens = fensOf(game.san);
    const runA = [], runB = [];
    for (const fen of fens) runA.push(await scan(fen, ms));
    for (const fen of fens) runB.push(await scan(fen, ms));
    assert(runA.length === fens.length && runB.length === fens.length,
      `${ms}ms · ${game.name.split(",")[0]}: both passes scored every one of the ${fens.length} positions`);
    {
      const wA = dropsOf(runA).map(Review.classifyByWinPct), wB = dropsOf(runB).map(Review.classifyByWinPct);
      dropPairs.push([dropsOf(runA), dropsOf(runB)]);
      wpPlies += wA.length;
      const g = tagAgreement(wA, wB, TAGS);
      for (const k of TAGS) { wpAgree[k].a += g[k].a; wpAgree[k].b += g[k].b; wpAgree[k].both += g[k].both; }
    }
    for (let i = 0; i < fens.length; i++) {
      // mate scores are ±10000-ish and would swamp a centipawn jitter figure
      if (runA[i] == null || runB[i] == null) continue;
      if (Math.abs(runA[i]) > 9000 || Math.abs(runB[i]) > 9000) continue;
      jitter.push(Math.abs(runA[i] - runB[i]));
    }
    const tA = tagsOf(runA), tB = tagsOf(runB);
    lossPairs.push([lossesOf(runA), lossesOf(runB)]);
    plies += tA.length;
    for (const k of Object.keys(agree)) {
      for (let i = 0; i < tA.length; i++) {
        if (tA[i] === k) agree[k].a++;
        if (tB[i] === k) agree[k].b++;
        if (tA[i] === k && tB[i] === k) agree[k].both++;
      }
    }
  }
  const row = { plies, jitterMedian: quantile(jitter, 0.5), jitterP90: quantile(jitter, 0.9), tags: {} };
  for (const [k, v] of Object.entries(agree)) {
    // Jaccard: of every ply either run called `k`, how many did both call it
    const union = v.a + v.b - v.both;
    row.tags[k] = { runA: v.a, runB: v.b, both: v.both, agreePct: pct(v.both, union) };
  }
  scanOut.byMovetime[String(ms)] = row;
  console.log(`\n--- 缺陷 23 · 快扫 ${ms}ms ---`);
  console.log(`  逐点评估抖动: 中位 ${row.jitterMedian}cp · 九成位 ${row.jitterP90}cp`);
  for (const [k, v] of Object.entries(row.tags)) {
    console.log(`  ${k.padEnd(2)}  第一次 ${String(v.runA).padStart(2)} 处 · 第二次 ${String(v.runB).padStart(2)} 处 · 两次都标 ${String(v.both).padStart(2)} 处 · 重合率 ${v.agreePct}%`);
  }
  // Where would the lowest band have to sit for its marks to survive a second
  // scan? Swept over the tracks just recorded — no extra engine time.
  row.sweep = {};
  console.log("  ?! 门槛扫描(下界 → 重合率,上界仍是 " + Review.MISTAKE + "):");
  for (const cut of [40, 50, 60, 70, 80, 90]) {
    const r = agreementAt(lossPairs, cut, Review.MISTAKE);
    row.sweep[String(cut)] = r;
    console.log(`    ${String(cut).padStart(3)}cp  两次各 ${String(r.runA).padStart(2)}/${String(r.runB).padStart(2)} 处 · 重合 ${String(r.both).padStart(2)} · ${r.agreePct}%`);
  }

  // The same tracks, tagged by win-percentage drop. agreeRate is the 0..1
  // form of agreePct, so a reader of the JSON can take either.
  // cpSameRun repeats the centipawn figures of *these* two passes, so the
  // side-by-side is within one run — scanNoise may have been recorded on
  // another day and another machine.
  const wpRow = { plies: wpPlies, tags: {}, cpSameRun: row.tags, sweep: {} };
  assert(wpPlies === plies, `${ms}ms · win% tagged the same ${plies} plies the centipawn pass did`);
  for (const [k, v] of Object.entries(wpAgree)) {
    const union = v.a + v.b - v.both;
    wpRow.tags[k] = { runA: v.a, runB: v.b, both: v.both, agreePct: pct(v.both, union),
      agreeRate: union ? Math.round((v.both / union) * 1000) / 1000 : 0 };
    assert(wpRow.tags[k].agreeRate >= 0 && wpRow.tags[k].agreeRate <= 1, `${ms}ms · ${k} win% agreement is a rate (${wpRow.tags[k].agreeRate})`);
  }
  console.log(`\n--- Q2.5 · 同一轨迹按胜率差分类 ${ms}ms(?! ${Review.WIN_INACCURACY} / ? ${Review.WIN_MISTAKE} / ?? ${Review.WIN_BLUNDER} 个百分点)---`);
  for (const [k, v] of Object.entries(wpRow.tags)) {
    const cpv = row.tags[k];
    console.log(`  ${k.padEnd(2)}  第一次 ${String(v.runA).padStart(2)} 处 · 第二次 ${String(v.runB).padStart(2)} 处 · 两次都标 ${String(v.both).padStart(2)} 处 · 重合率 ${v.agreePct}%(厘兵 ${cpv.agreePct}%)`);
  }
  // `band` moves only the ?! floor (upper edge stays at the next cut-off, as
  // the centipawn sweep does; at 10 the ?! band is gone and the row reads the
  // ? band). `atLeast` counts every move flagged at all from `cut` up — the
  // question a player asking "is this move marked or not" is really asking.
  console.log("  ?! 门槛扫描(胜率百分点 → 重合率):");
  for (const cut of [3, 5, 7, 10]) {
    const hi = cut < Review.WIN_MISTAKE ? Review.WIN_MISTAKE : Review.WIN_BLUNDER;
    const band = agreementAt(dropPairs, cut, hi), atLeast = agreementAt(dropPairs, cut, Infinity);
    wpRow.sweep[String(cut)] = { band: { hi, ...band }, atLeast };
    console.log(`    ${String(cut).padStart(3)} 点  区间 [${cut},${hi}) 两次各 ${String(band.runA).padStart(2)}/${String(band.runB).padStart(2)} · 重合 ${band.agreePct}% · 及以上 两次各 ${String(atLeast.runA).padStart(2)}/${String(atLeast.runB).padStart(2)} · 重合 ${atLeast.agreePct}%`);
  }
  assert(["3", "5", "7", "10"].every((c) => wpRow.sweep[c] && Number.isFinite(wpRow.sweep[c].band.agreePct)),
    `${ms}ms · the 3/5/7/10-point sweep was taken`);
  wpOut.byMovetime[String(ms)] = wpRow;
}

// =========================================================================
// 缺陷 32 — is the beginner tier's strength a function of candidate count?
// =========================================================================
const tier = TIERS.beginner;

/** Every candidate the beginner tier's own search returns for `fen`. */
async function candidates(fen) {
  await ready();
  send("setoption name MultiPV value " + (tier.multipv || 1));
  send("setoption name UCI_LimitStrength value false");
  send("setoption name Skill Level value " + (tier.skill != null ? tier.skill : 20));
  send("position fen " + fen);
  const cands = new Map();
  const collect = (line) => {
    if (typeof line !== "string") return;
    const mv = line.match(/\bmultipv (\d+)\b/);
    const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    const sc = infoScore(line);
    if (mv && pv) cands.set(Number(mv[1]), { uci: pv[1], cp: sc && sc.kind === "cp" ? sc.val : (sc ? (sc.val > 0 ? 9000 : -9000) : null) });
  };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), (tier.movetime || 2000) + 20000);
  send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
  try { await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  return [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Opening / middlegame / endgame, by men left on the board. */
const phaseOf = (fen) => {
  const men = (fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
  return men >= 26 ? "opening" : men >= 14 ? "middlegame" : "endgame";
};

const mvOut = { what: "新手档自己的搜索设置下,每个局面实际返回几条候选、候选之间差多少分",
  script: "scripts/test-analysis.mjs --record",
  tier: { skill: tier.skill, depth: tier.depth, multipv: tier.multipv, worstBias: tier.worstBias },
  // The change this measurement was taken to justify, and what happened when
  // it was tried anyway. Kept here because a rejected option with numbers on
  // it is what stops the same idea being re-proposed from first principles.
  weightedSamplingTried: {
    what: "把八成的均匀抽样改成按与首选的分差加权(exp(-gap/K)),量新手 bot 的得分率",
    script: "scripts/test-novice.mjs --tier=<id> --games=32",
    baselineScorePct: { beginner: 56, casual: 27 },
    runs: [
      { spreadK: { beginner: 250, casual: 180 }, scorePct: { beginner: 33, casual: 6 } },
      { spreadK: { beginner: 700, casual: 500 }, scorePct: { beginner: 38, casual: 8 } },
    ],
    verdict: "不采用:两档都远强于既定标定,要补回来只能把 worstBias 抬回 1.19 已经否掉的 0.6 附近",
  },
  phases: {} };
// Four decided games never reach an endgame — all four are mating attacks —
// so the phase the defect is actually about would have had no data at all.
// The endgame positions come from the app's own shipped content (the endgame
// lessons and the draw/defence puzzles) rather than being invented here: those
// are the positions a player using this app really arrives at.
const extra = [];
{
  const cCtx = { console, Date, performance };
  cCtx.globalThis = cCtx;
  cCtx.window = cCtx;
  vm.createContext(cCtx);
  for (const m of ["lessons.js", "puzzles.js"]) {
    vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + m)), cCtx, { filename: "module" });
  }
  const seen = new Set();
  const take = (fen) => {
    if (!fen || seen.has(fen)) return;
    seen.add(fen);
    let probe;
    try { probe = new Chess(fen); } catch (_) { return; }
    if (!probe.fen() || probe.game_over()) return;
    if (phaseOf(fen) !== "endgame") return;
    extra.push(fen);
  };
  for (const L of cCtx.CHESS_LESSONS || []) for (const t of L.tasks || []) take(t.fen);
  for (const p of cCtx.CHESS_PUZZLES || []) take(p.fen);
}
console.log(`\n(残局局面 ${extra.length} 个,取自课程与题库 —— 四局对局全是杀王局,走不到残局)`);

const rows = [];
for (const fen of GAMES.flatMap((g) => fensOf(g.san)).concat(extra)) {
  {
    const probe = new Chess(fen);
    if (probe.game_over()) continue;
    const legal = probe.moves().length;
    const cs = await candidates(fen);
    const scored = cs.filter((c) => c.cp != null);
    rows.push({
      phase: phaseOf(fen), legal, n: cs.length,
      // what a uniform pick actually costs: best candidate minus the mean of
      // the rest, in centipawns, from the mover's point of view
      spread: scored.length >= 2 ? scored[0].cp - Math.round(scored.slice(1).reduce((a, c) => a + c.cp, 0) / (scored.length - 1)) : null,
      worst: scored.length >= 2 ? scored[0].cp - Math.min(...scored.map((c) => c.cp)) : null,
    });
  }
}
console.log(`\n--- 缺陷 32 · 新手档候选条数 (multipv ${tier.multipv}, depth ${tier.depth}) ---`);
for (const ph of ["opening", "middlegame", "endgame"]) {
  const r = rows.filter((x) => x.phase === ph);
  if (!r.length) continue;
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const spreads = r.map((x) => x.spread).filter((x) => x != null);
  const worsts = r.map((x) => x.worst).filter((x) => x != null);
  const row = {
    positions: r.length,
    legalMean: mean(r.map((x) => x.legal)),
    candidatesMean: mean(r.map((x) => x.n)),
    candidatesMin: Math.min(...r.map((x) => x.n)),
    cappedPct: pct(r.filter((x) => x.n >= (tier.multipv || 1)).length, r.length),
    spreadMean: mean(spreads),
    spreadMedian: quantile(spreads, 0.5),
    worstGapMedian: quantile(worsts, 0.5),
  };
  mvOut.phases[ph] = row;
  console.log(`  ${ph.padEnd(11)} ${String(row.positions).padStart(3)} 个局面 · 合法着法均 ${row.legalMean} · 候选均 ${row.candidatesMean}(最少 ${row.candidatesMin},满 ${tier.multipv} 条的占 ${row.cappedPct}%)`);
  console.log(`  ${" ".repeat(11)}     首选领先其余均值 ${row.spreadMean}cp(中位 ${row.spreadMedian})· 首选与最差差 ${row.worstGapMedian}cp(中位)`);
}

if (RECORDING) {
  record("scanNoise", scanOut);
  record("winPctNoise", wpOut);
  record("multipvPhase", mvOut);
} else {
  console.log("\n（只打印,没写入。加 --record 才写 docs/measured.json）");
}
if (failed) { console.error(failed + " check(s) failed"); process.exit(1); }
process.exit(0);
