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
// v8-0-plan B2: the timed passes are 7.9's pass and run only when asked for
// (--ms=120,400); the default is the node-limited pass that ships
const MOVETIMES = msArg ? msArg.split(",").map(Number).filter((n) => n > 0) : [];
// the 缺陷 32 candidate count is its own measurement, run with --multipv
const MULTIPV = process.argv.includes("--multipv");

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
const mvOut = { phases: {} };
if (MULTIPV) {
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

  Object.assign(mvOut, { what: "新手档自己的搜索设置下,每个局面实际返回几条候选、候选之间差多少分",
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
    phases: {} });
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
}

// =========================================================================
// v8-0-plan B2 — the review pass as it ships: does the same game, analysed
// twice, tell the same story? And what does it cost?
// =========================================================================
//
// Through 7.9 this file measured 7.9's pass: `go movetime`, whose agreement
// with itself (`winPctNoise.movetime`, kept below) was `??` 82%, `?` 64%,
// `?!` 45% at the 200 ms it shipped with. B2 replaced it with a node count
// from a cleared engine plus a deeper MultiPV 3 look at every move that
// drops ≥ 5 points — review-pass.js runPass, run here as the app runs it,
// with a node engine driven by the same UCI sequence as engine.js
// analyzeInner. Run B is taken after the engine has been deliberately
// dirtied with unrelated searches, because in the app the engine has always
// done something else first (the coach, a hint, the game).
//
// Also recorded: wall time of 分析 (budget 200) and 精析 (400), split into
// the quick scan and the deepening, against 7.9's timed pass over the same
// positions; and every 妙着 / 仅此一着 the passes found, with the engine's
// lines, for docs/manual-check.md.
const B2_GAME_LIMIT = Number.isFinite(gamesArg) && gamesArg > 0 ? gamesArg : (RECORDING ? Infinity : 4);
const b2Ctx = { console, Date, performance };
b2Ctx.globalThis = b2Ctx;
b2Ctx.window = b2Ctx;
vm.createContext(b2Ctx);
for (const m of ["chess.js", "eco.js", "eco-lookup.js", "review-pass.js", "review-grade.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + m)), b2Ctx, { filename: m });
}
const B2Chess = b2Ctx.Chess, Pass = b2Ctx.ChessReviewPass, Grade = b2Ctx.ChessReviewGrade, Eco = b2Ctx.ChessEco;
const nodesFor = engCtx.ChessEngine.nodesFor;

/** engine.js readInfo, to the letter. */
function readInfo(line, into) {
  const mv = line.match(/\bmultipv (\d+)\b/);
  const idx = mv ? Number(mv[1]) : 1;
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  const pm = line.match(/\bpv\s+(.+)$/);
  const dm = line.match(/\bdepth (\d+)\b/);
  if (!m && !pm) return;
  const slot = into.get(idx) || { cp: null, mate: null, pv: null, depth: 0 };
  if (m) { slot.cp = m[1] === "cp" ? Number(m[2]) : null; slot.mate = m[1] === "mate" ? Number(m[2]) : null; }
  if (pm) slot.pv = pm[1].trim().split(/\s+/);
  if (dm) slot.depth = Number(dm[1]);
  into.set(idx, slot);
}

/**
 * engine.js analyzeInner, the same UCI in the same order: ucinewgame,
 * isready, the full-strength options (Hash 32, the app's default), the
 * position, `go nodes`. `timed` swaps the last for 7.9's `go movetime`.
 */
async function analyzeB2(fen, budget, opts, timed) {
  if (!timed) send("ucinewgame"); // 7.9 sent none
  await ready();
  const multipv = opts && opts.multipv ? opts.multipv : 1;
  send("setoption name MultiPV value " + multipv);
  send("setoption name Skill Level value 20");
  send("setoption name UCI_LimitStrength value false");
  send("setoption name Hash value 32");
  send("position fen " + fen);
  const slots = new Map();
  const collect = (l) => { if (typeof l === "string") readInfo(l, slots); };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), 120000);
  send(timed ? "go movetime " + budget : "go nodes " + nodesFor(budget));
  let line;
  try { line = await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  const uci = line.split(/\s+/)[1];
  const lines = [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  const top = lines[0] || { cp: null, mate: null, pv: null };
  return { cp: top.cp, mate: top.mate, turn: fen.split(" ")[1] === "b" ? "b" : "w",
    best: uci && uci !== "(none)" ? uci : null, pv: top.pv || null, lines };
}
const scalarOf = (e) => (e ? evalScalar(e.mate != null ? { kind: "mate", val: e.mate } : e.cp != null ? { kind: "cp", val: e.cp } : null, e.turn) : null);

/** Unrelated searches, so the next pass starts from a used engine. */
async function dirty() {
  send("setoption name MultiPV value 4");
  for (const fen of ["r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    "8/5pk1/6p1/8/3R4/6P1/5PKP/2r5 b - - 0 40"]) {
    send("position fen " + fen);
    const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), 20000);
    send("go movetime 150");
    await w;
  }
}

/** One pass the way app.js analyzeGame runs it, timed per stage. */
async function passOf(fens, sans, budget) {
  const t = { quick: 0, deep: 0, deepPositions: 0 };
  const lastDeep = new Map();
  const p = await Pass.runPass({ fens, sans, budget, lines: 1, evalScalar: scalarOf,
    analyze: async (fen, b, o) => {
      const t0 = performance.now();
      const e = await analyzeB2(fen, b, o);
      const dt = performance.now() - t0;
      if (b === budget) t.quick += dt; else { t.deep += dt; t.deepPositions++; lastDeep.set(fen, e); }
      return e;
    } });
  p.book = Grade.bookPlies(fens, (f) => !!Eco.lookupPosition(new B2Chess(f)));
  return { p, tags: dropsOf(p.scalars).map(Review.classifyByWinPct), grades: Grade.gradeMoves(p, B2Chess), t, lastDeep };
}

/** 7.9's pass over the same positions, for the time it took. */
async function timedPass(fens) {
  const t0 = performance.now();
  for (const fen of fens) {
    const probe = new B2Chess(fen);
    if (probe.in_checkmate() || probe.in_stalemate()) continue;
    await analyzeB2(fen, 200, { multipv: 1 }, true);
  }
  return performance.now() - t0;
}

const b2Games = GAMES.slice(0, B2_GAME_LIMIT);
const b2Agree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
const deepAgree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
let b2Plies = 0, sameScalars = 0, sameGrades = 0, scalarN = 0;
const gradeTotals = Object.fromEntries(Grade.GRADES.map((g) => [g, 0]));
const time = { positions: 0, quick200: 0, deep200: 0, deepPositions200: 0, quick400: 0, deep400: 0, deepPositions400: 0, timed200: 0 };
const found = [];
for (const game of b2Games) {
  const fens = fensOf(game.san);
  const A = await passOf(fens, game.san, 200);
  await dirty();
  const B = await passOf(fens, game.san, 200);
  const D = await passOf(fens, game.san, 400);
  const T = await timedPass(fens);
  time.positions += fens.length;
  time.quick200 += A.t.quick; time.deep200 += A.t.deep; time.deepPositions200 += A.t.deepPositions;
  time.quick400 += D.t.quick; time.deep400 += D.t.deep; time.deepPositions400 += D.t.deepPositions;
  time.timed200 += T;
  b2Plies += A.tags.length;
  for (let i = 0; i < fens.length; i++) { scalarN++; if (A.p.scalars[i] === B.p.scalars[i]) sameScalars++; }
  for (let i = 0; i < A.grades.length; i++) if (A.grades[i] === B.grades[i]) sameGrades++;
  for (const g of A.grades) if (g) gradeTotals[g]++;
  const ab = tagAgreement(A.tags, B.tags, TAGS), ad = tagAgreement(A.tags, D.tags, TAGS);
  for (const k of TAGS) {
    for (const f of ["a", "b", "both"]) { b2Agree[k][f] += ab[k][f]; deepAgree[k][f] += ad[k][f]; }
  }
  assert(JSON.stringify(A.grades) === JSON.stringify(B.grades),
    "B2 · " + game.name.split(",")[0] + ": the same game twice, the engine dirtied in between — identical grades");
  // every 妙着 / 仅此一着 of either budget, with the deep lines behind it
  for (const [run, budget] of [[A, 200], [D, 400]]) {
    run.grades.forEach((g, i) => {
      if (g !== "brilliant" && g !== "only") return;
      if (found.some((x) => x.fen === fens[i] && x.san === game.san[i])) return;
      const e = run.lastDeep.get(fens[i]);
      const mover = fens[i].split(" ")[1] === "b" ? "b" : "w";
      const win = (s) => { const w = Review.winPct(s); return Math.round((mover === "w" ? w : 100 - w) * 10) / 10; };
      found.push({ grade: g, budget, game: game.name, moveNo: Review.moveNumber(i, "w"), side: mover, san: game.san[i], fen: fens[i],
        winBefore: win(run.p.scalars[i]), winAfter: win(run.p.scalars[i + 1]), second: win(run.p.seconds[i]),
        reply: run.p.pvs[i + 1],
        lines: e ? e.lines.map((l) => ({ score: l.mate != null ? "#" + l.mate : (l.cp / 100).toFixed(2), pv: Pass.sansOf(fens[i], l.pv, 6).join(" ") })) : [] });
    });
  }
  console.log(`  B2 · ${game.name.split(",")[0]}: ${fens.length} 个局面 · 加深 ${A.t.deepPositions} 个 · 分析 ${((A.t.quick + A.t.deep) / 1000).toFixed(1)}s(旧 ${(T / 1000).toFixed(1)}s)· 精析 ${((D.t.quick + D.t.deep) / 1000).toFixed(1)}s`);
}
const rate = (v) => { const u = v.a + v.b - v.both; return { runA: v.a, runB: v.b, both: v.both, agreePct: pct(v.both, u), agreeRate: u ? Math.round((v.both / u) * 1000) / 1000 : 1 }; };
const prior = (() => { try { return JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).winPctNoise; } catch (_) { return null; } })();
const b2Noise = {
  what: "同一局用 8.0 的复盘流程(review-pass.js:定节点、每步前清空引擎、胜率掉 ≥5 的着法加深并开 MultiPV 3)跑两遍,第二遍之前先用无关搜索把引擎弄脏,按胜率降幅分类比较两次的标注集合",
  script: "scripts/test-analysis.mjs --record",
  thresholds: { inaccuracy: Review.WIN_INACCURACY, mistake: Review.WIN_MISTAKE, blunder: Review.WIN_BLUNDER },
  games: b2Games.length, plies: b2Plies,
  pass: { budget: 200, nodes: nodesFor(200), deepFactor: Grade.DEEP_FACTOR, deepMultipv: Grade.DEEP_MULTIPV, deepTrigger: Grade.DEEP_TRIGGER },
  tags: Object.fromEntries(TAGS.map((k) => [k, rate(b2Agree[k])])),
  sameScalarPct: pct(sameScalars, scalarN), sameGradePct: pct(sameGrades, b2Plies),
  grades: gradeTotals,
  // not reproducibility — how much the marks move when the budget doubles
  vs400: Object.fromEntries(TAGS.map((k) => [k, rate(deepAgree[k])])),
  // 7.9's timed pass, as recorded then: the before of this section
  movetime: prior && prior.byMovetime ? prior.byMovetime : prior && prior.movetime ? prior.movetime : null,
};
const perPos = (ms, n) => (n ? Math.round(ms / n) : 0);
const b2Pass = {
  what: "复盘一局的引擎耗时(node 里的 Stockfish 19 lite-single,单线程,同一台机器):分析 = 预算 200,精析 = 400,各分快扫与加深两段;旧 = 7.9 的 go movetime 200 走同样的局面",
  script: "scripts/test-analysis.mjs --record",
  games: b2Games.length, positions: time.positions,
  analyse: { quickMs: Math.round(time.quick200), deepMs: Math.round(time.deep200), deepPositions: time.deepPositions200,
    msPerPosition: perPos(time.quick200 + time.deep200, time.positions), quickMsPerPosition: perPos(time.quick200, time.positions),
    msPerGame: Math.round((time.quick200 + time.deep200) / Math.max(1, b2Games.length)) },
  deepAnalyse: { quickMs: Math.round(time.quick400), deepMs: Math.round(time.deep400), deepPositions: time.deepPositions400,
    msPerPosition: perPos(time.quick400 + time.deep400, time.positions),
    msPerGame: Math.round((time.quick400 + time.deep400) / Math.max(1, b2Games.length)) },
  timed79: { ms: Math.round(time.timed200), msPerPosition: perPos(time.timed200, time.positions),
    msPerGame: Math.round(time.timed200 / Math.max(1, b2Games.length)) },
  found: found.length,
};
console.log(`\n--- v8-0-plan B2 · 复盘流程两遍(${b2Games.length} 局 ${b2Plies} 手,第二遍前弄脏引擎)---`);
for (const k of TAGS) {
  const v = b2Noise.tags[k], d = b2Noise.vs400[k];
  const was = b2Noise.movetime && b2Noise.movetime["200"] ? b2Noise.movetime["200"].tags[k].agreePct : null;
  console.log(`  ${k.padEnd(2)}  两遍各 ${v.runA}/${v.runB} 处 · 都标 ${v.both} · 重合率 ${v.agreePct}%(7.9 的 200ms:${was == null ? "—" : was + "%"})· 与精析 400 重合 ${d.agreePct}%`);
}
console.log(`  逐点评估完全相同 ${b2Noise.sameScalarPct}% · 分级完全相同 ${b2Noise.sameGradePct}%`);
console.log(`  分级计数 ${JSON.stringify(gradeTotals)}`);
console.log(`  耗时:分析 ${(b2Pass.analyse.msPerGame / 1000).toFixed(1)}s/局(快扫 ${b2Pass.analyse.quickMsPerPosition}ms/局面 + 加深 ${b2Pass.analyse.deepPositions} 个局面)· 精析 ${(b2Pass.deepAnalyse.msPerGame / 1000).toFixed(1)}s/局 · 7.9 分析 ${(b2Pass.timed79.msPerGame / 1000).toFixed(1)}s/局`);
assert(b2Noise.tags["??"].agreeRate >= 0.95, "B2 acceptance: ?? agreement ≥ 95% (" + b2Noise.tags["??"].agreePct + "%)");
assert(b2Noise.tags["?!"].agreeRate >= 0.70, "B2 acceptance: ?! agreement ≥ 70% (" + b2Noise.tags["?!"].agreePct + "%)");
if (process.argv.includes("--found")) {
  const out = path.join(process.env.FOUND_DIR || ".", "b2-found.json");
  fs.writeFileSync(out, JSON.stringify(found, null, 1));
  console.log("  妙着 / 仅此一着 " + found.length + " 处 → " + out);
}

if (RECORDING) {
  if (MOVETIMES.length) record("scanNoise", scanOut);
  record("winPctNoise", b2Noise);
  record("reviewPass", b2Pass);
  if (MULTIPV) record("multipvPhase", mvOut);
} else {
  console.log("\n（只打印,没写入。加 --record 才写 docs/measured.json）");
}
if (failed) { console.error(failed + " check(s) failed"); process.exit(1); }
process.exit(0);
