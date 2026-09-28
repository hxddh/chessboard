/**
 * The ladder, measured (v8-0-plan B4): every rung plays every other rung, and
 * the results are fitted into one rating per rung.
 *
 * Why a round-robin and not ACPL or a novice bot: test-strength measures how
 * accurate each rung's moves are and test-novice how often a stand-in for a
 * raw beginner beats the bottom two, but neither says what the plan's
 * acceptance asks — whether each rung is a *step* above the one below (the
 * stronger scoring 60–75% against it) and where the rungs sit on a scale a
 * player can read. Only games between the rungs answer that.
 *
 * The games are the app's games: each move goes through engine.js's own tier
 * rows and its own pickCandidate, resignation and draw offers follow
 * opponents.js (the rules the app applies to the engine), a rung that offers
 * a draw gets it when the other side's own eval says it is not ahead — the
 * rule the engine applies to a player's offer. Openings rotate through a
 * fixed book of 16 short lines, each played with both colours, and the
 * sampling runs off a seeded generator, so a pairing's games are repeatable
 * (the Elo rungs' own UCI_LimitStrength randomness is inside Stockfish and
 * is not).
 *
 * The fit is Bradley–Terry by maximum likelihood — what BayesElo computes,
 * without its draw model — with two virtual draws between neighbours as the
 * prior, so a 10–0 pairing gives a finite gap. It is then put on the app's
 * scale by the two numbers the app shipped with: 初级 (UCI_Elo 1320) and
 * 中级 (UCI_Elo 1700).
 *
 * Heavy: the Elo rungs think 0.5–1.2 s a move. Run in shards, one at a time,
 * in the background; every game is appended to the shard's file as it ends,
 * so a stopped run resumes where it stopped.
 *
 *   node scripts/test-ladder.mjs play --shard=1/4 --out=DIR [--adjacent=40] [--near=16] [--far=6]
 *   node scripts/test-ladder.mjs fit --in=DIR [--record]
 *   node scripts/test-ladder.mjs play --only=casual,learner --adjacent=40 --out=DIR   (tuning)
 *   --override='{"learner":{"winT":10}}' plays a rung with changed settings (tuning only; the
 *   settings are written with each game, and `fit` refuses games whose settings are not engine.js's)
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startPlayer } from "./lib/ladder-player.mjs";
import { record, RECORDING } from "./measurements.mjs";

const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MODE = process.argv[2];
const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/engine.js", "src/web/js/persona.js", "src/web/js/opponents.js"]);
const { Chess, ChessEngine, ChessPersona, Opponents } = ctx;
const LEVELS = Opponents.LEVELS;
const override = JSON.parse(arg("override", "{}"));
/**
 * A rung as it is played: its engine.js row and its persona's style — the
 * ratings the dialog shows are the personas', so the personas are what play.
 */
const shipped = (id) => {
  const p = Opponents.PERSONAS.find((x) => x.level === id);
  return Object.assign({}, ChessEngine.TIERS[id], { style: p ? p.style : "off" });
};
const tierOf = (id) => Object.assign(shipped(id), override[id] || {});

/** 16 short, level book lines — the games start here, both colours each. */
const OPENINGS = [
  "e4 e5 Nf3 Nc6", "d4 d5 c4 e6", "e4 c5 Nf3 d6", "d4 Nf6 c4 g6",
  "e4 e6 d4 d5", "e4 c6 d4 d5", "c4 e5 Nc3 Nf6", "Nf3 d5 g3 Nf6",
  "e4 e5 Nf3 Nf6", "d4 Nf6 c4 e6", "e4 c5 Nc3 Nc6", "d4 d5 Nf3 Nf6",
  "e4 d6 d4 Nf6", "d4 Nf6 Nf3 d5", "c4 c5 Nc3 Nc6", "e4 e5 Bc4 Nf6",
];

// --- play ------------------------------------------------------------------

/** every pairing and how many games it gets: neighbours most, far pairs few */
function schedule() {
  const only = arg("only", "");
  const ids = only ? only.split(",") : LEVELS;
  const nAdj = Number(arg("adjacent", 40)), nNear = Number(arg("near", 16)), nFar = Number(arg("far", 6));
  const out = [];
  // --pairs=a:b,c:d plays just those pairings (tuning)
  const pairs = arg("pairs", "");
  if (pairs) {
    for (const p of pairs.split(",")) {
      const [a, b] = p.split(":");
      for (let k = 0; k < nAdj; k++) out.push({ a, b, k });
    }
    return out;
  }
  // --slow-only: just the pairings with an Elo rung in them. The rungs
  // handicapped here play a game in a fraction of a second, so their
  // pairings among themselves are run apart (--only=…) with many more games,
  // into the same directory
  const slowOnly = process.argv.includes("--slow-only");
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if (slowOnly && !ChessEngine.TIERS[ids[i]].movetime && !ChessEngine.TIERS[ids[j]].movetime) continue;
      const gap = Math.abs(LEVELS.indexOf(ids[j]) - LEVELS.indexOf(ids[i]));
      const n = only ? nAdj : gap === 1 ? nAdj : gap === 2 ? nNear : nFar;
      for (let k = 0; k < n; k++) out.push({ a: ids[i], b: ids[j], k });
    }
  }
  return out;
}

function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function rngFrom(seed) {
  let x = seed || 1;
  return () => { x = (x * 1103515245 + 12345) & 0x7fffffff; return x / 0x7fffffff; };
}

async function play() {
  const outDir = arg("out", null);
  if (!outDir) { console.error("--out=DIR"); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const [si, sn] = arg("shard", "1/1").split("/").map(Number);
  const file = path.join(outDir, "shard-" + si + "-of-" + sn + ".jsonl");
  const done = new Set();
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, "utf8").split("\n").filter(Boolean)) {
      const g = JSON.parse(line);
      done.add(g.key);
    }
  }
  const all = schedule().filter((_, i) => i % sn === si - 1);
  const player = await startPlayer({ Chess, ChessEngine, ChessPersona });
  const started = Date.now();
  let n = 0;
  for (const job of all) {
    const ta = tierOf(job.a), tb = tierOf(job.b);
    const key = job.a + ":" + JSON.stringify(ta) + "|" + job.b + ":" + JSON.stringify(tb) + "|" + job.k;
    if (done.has(key)) continue;
    const aWhite = job.k % 2 === 0;
    const opening = OPENINGS[Math.floor(job.k / 2) % OPENINGS.length];
    const t0 = Date.now();
    const res = await playGame(player, aWhite ? [job.a, ta] : [job.b, tb], aWhite ? [job.b, tb] : [job.a, ta], opening,
      rngFrom(seedOf(key)));
    const scoreA = res.result === "1/2" ? 0.5 : (res.result === "1-0") === aWhite ? 1 : 0;
    const rec = { key, a: job.a, b: job.b, k: job.k, ta, tb, aWhite, opening, result: res.result, scoreA,
      how: res.how, plies: res.plies, ms: Date.now() - t0 };
    fs.appendFileSync(file, JSON.stringify(rec) + "\n");
    n++;
    process.stdout.write(`\r  ${n}/${all.length - done.size}  ${job.a}–${job.b} #${job.k}: ${res.result} (${res.how}, ${res.plies} 半着)          `);
  }
  console.log(`\n分片 ${si}/${sn}：${n} 盘，墙钟 ${((Date.now() - started) / 60000).toFixed(1)} 分钟 → ${file}`);
}

/**
 * One game. `white`/`black` are [id, tier row]. Ends by the rules, by a
 * resignation or an accepted draw offer (opponents.js), or at 300 plies as a
 * draw.
 */
async function playGame(player, white, black, opening, rng) {
  const g = new Chess();
  for (const san of opening.split(" ")) g.move(san);
  await player.newGame();
  const own = { w: [], b: [] };
  const lastOffer = { w: null, b: null };
  let plies = g.history().length;
  while (!g.game_over() && plies < 300) {
    const side = g.turn();
    const [, tier] = side === "w" ? white : black;
    const mv = await player.move(g.fen(), tier, rng, tier.style);
    if (!mv) break;
    if (!g.move({ from: mv.uci.slice(0, 2), to: mv.uci.slice(2, 4), promotion: mv.uci[4] || "q" })) break;
    plies++;
    if (mv.score != null) own[side].push(mv.score);
    if (Opponents.shouldResign(own[side])) return { result: side === "w" ? "0-1" : "1-0", how: "resign", plies };
    const half = Number(g.fen().split(" ")[4]) || 0;
    if (Opponents.shouldOfferDraw(own[side], plies, half, lastOffer[side])) {
      lastOffer[side] = plies;
      const other = side === "w" ? "b" : "w";
      const theirs = own[other].length ? own[other][own[other].length - 1] : null;
      if (Opponents.acceptsDraw(theirs)) return { result: "1/2", how: "agreed", plies };
    }
  }
  if (g.in_checkmate()) return { result: g.turn() === "w" ? "0-1" : "1-0", how: "mate", plies };
  return { result: "1/2", how: g.game_over() ? "rules" : "cap", plies };
}

// --- fit -------------------------------------------------------------------

/** Bradley–Terry MLE (Elo units), with `prior` virtual draws between neighbours. */
function fitBT(ids, games, prior) {
  const idx = Object.fromEntries(ids.map((id, i) => [id, i]));
  const obs = games.map((g) => ({ i: idx[g.a], j: idx[g.b], s: g.scoreA, w: 1 }));
  for (let i = 0; i + 1 < ids.length; i++) obs.push({ i, j: i + 1, s: 0.5, w: prior });
  const K = Math.log(10) / 400;
  const R = ids.map(() => 0);
  for (let it = 0; it < 500; it++) {
    // Newton on all but the first rating (pinned at 0)
    const n = ids.length;
    const grad = new Array(n).fill(0);
    const H = Array.from({ length: n }, () => new Array(n).fill(0));
    for (const o of obs) {
      const p = 1 / (1 + Math.exp(-K * (R[o.i] - R[o.j])));
      const d = o.w * K * (o.s - p);
      grad[o.i] += d; grad[o.j] -= d;
      const h = o.w * K * K * p * (1 - p);
      H[o.i][o.i] += h; H[o.j][o.j] += h; H[o.i][o.j] -= h; H[o.j][o.i] -= h;
    }
    const m = n - 1;
    const A = Array.from({ length: m }, (_, r) => H[r + 1].slice(1).concat([grad[r + 1]]));
    const step = solve(A);
    let moved = 0;
    for (let r = 0; r < m; r++) { R[r + 1] += step[r]; moved = Math.max(moved, Math.abs(step[r])); }
    if (moved < 1e-6) {
      const inv = invert(H.slice(1).map((row) => row.slice(1)));
      const se = [0].concat(inv.map((row, r) => Math.sqrt(Math.max(0, row[r]))));
      return { R, se };
    }
  }
  throw new Error("fit did not converge");
}
function solve(A) {
  const m = A.length;
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c] / A[c][c];
      for (let k = c; k <= m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row, r) => row[m] / row[r]);
}
function invert(M) {
  const m = M.length;
  const A = M.map((row, r) => row.concat(Array.from({ length: m }, (_, k) => (k === r ? 1 : 0))));
  for (let c = 0; c < m; c++) {
    let p = c;
    for (let r = c + 1; r < m; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    [A[c], A[p]] = [A[p], A[c]];
    const d = A[c][c];
    for (let k = 0; k < 2 * m; k++) A[c][k] /= d;
    for (let r = 0; r < m; r++) {
      if (r === c) continue;
      const f = A[r][c];
      for (let k = 0; k < 2 * m; k++) A[r][k] -= f * A[c][k];
    }
  }
  return A.map((row) => row.slice(m));
}

function fit() {
  const dir = arg("in", null);
  if (!dir) { console.error("--in=DIR"); process.exit(2); }
  const games = [];
  let stale = 0;
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)) {
      const g = JSON.parse(line);
      // a game played with settings that are not the ones engine.js ships
      // describes some other rung
      // (--loose: fit whatever was played — tuning runs with --override)
      if (!process.argv.includes("--loose") && (JSON.stringify(g.ta) !== JSON.stringify(shipped(g.a)) ||
          JSON.stringify(g.tb) !== JSON.stringify(shipped(g.b)))) { stale++; continue; }
      games.push(g);
    }
  }
  const ids = LEVELS.filter((id) => games.some((g) => g.a === id || g.b === id));
  const { R, se } = fitBT(ids, games, 2);
  const ai = ids.indexOf("easy"), bi = ids.indexOf("normal");
  const scale = ai >= 0 && bi >= 0 ? 380 / (R[bi] - R[ai]) : 1;
  const base = ai >= 0 ? 1320 - scale * R[ai] : 1500;
  const rating = Object.fromEntries(ids.map((id, i) => [id, Math.round(base + scale * R[i])]));
  const ratingSe = Object.fromEntries(ids.map((id, i) => [id, Math.round(scale * se[i])]));
  const pct = (d) => 100 / (1 + Math.pow(10, -d / 400));
  const pairs = {};
  for (const g of games) {
    const k = g.a + "|" + g.b;
    const p = pairs[k] || (pairs[k] = { a: g.a, b: g.b, games: 0, scoreA: 0, draws: 0 });
    p.games++; p.scoreA += g.scoreA; if (g.scoreA === 0.5) p.draws++;
  }
  const adjacent = [];
  let bad = 0;
  console.log("\n档位        原始 Elo   标定分  ±   对下一档（直接对局 / 拟合）");
  for (let i = 0; i < ids.length; i++) {
    let line = "  " + ids[i].padEnd(9) + String(Math.round(R[i])).padStart(8) + String(rating[ids[i]]).padStart(9) +
      String(ratingSe[ids[i]]).padStart(5);
    if (i > 0) {
      const lo = ids[i - 1], hi = ids[i];
      const p = pairs[lo + "|" + hi] || pairs[hi + "|" + lo];
      const h2h = p ? (p.a === hi ? p.scoreA : p.games - p.scoreA) / p.games * 100 : null;
      const fitPct = pct(R[i] - R[i - 1]);
      adjacent.push({ lower: lo, upper: hi, games: p ? p.games : 0, h2hPct: h2h == null ? null : Math.round(h2h * 10) / 10,
        fitPct: Math.round(fitPct * 10) / 10 });
      line += `   ${hi} 对 ${lo}: ${h2h == null ? "—" : h2h.toFixed(1) + "%"} / ${fitPct.toFixed(1)}%`;
      if (!(fitPct >= 60 && fitPct <= 75)) bad++;
    }
    console.log(line);
  }
  const monotone = R.every((r, i) => i === 0 || r > R[i - 1]);
  console.log(`\n${games.length} 盘（${stale} 盘的设置已不是 engine.js 的，未计入）；两锚 1320 / 1700，原始尺度 ×${scale.toFixed(3)}`);
  console.log((monotone ? "ok" : "FAIL") + ": 阶梯单调");
  console.log((bad ? "FAIL" : "ok") + `: 相邻两档强者的拟合得分都在 60–75%（${adjacent.length - bad}/${adjacent.length}）`);
  if (RECORDING) {
    const hours = games.reduce((a, g) => a + g.ms, 0) / 3600000;
    record("ladder", {
      what: "所有档位循环对下（node 里的 Stockfish 19 lite，engine.js 的档位设置与取子规则，opponents.js 的认输与提和），" +
        "Bradley–Terry 极大似然拟合（相邻两档各加 2 盘虚拟和棋作先验），以初级 = 1320、中级 = 1700 两点定标",
      script: "scripts/test-ladder.mjs play --shard=i/n … ; scripts/test-ladder.mjs fit --record",
      games: games.length,
      engineHours: Math.round(hours * 100) / 100,
      scale: Math.round(scale * 1000) / 1000,
      rating, ratingSe,
      raw: Object.fromEntries(ids.map((id, i) => [id, Math.round(R[i])])),
      adjacent,
      monotone,
      pairs: Object.values(pairs).map((p) => ({ a: p.a, b: p.b, games: p.games, scoreA: p.scoreA, draws: p.draws })),
      settings: Object.fromEntries(ids.map((id) => [id, shipped(id)])),
    });
  }
  process.exit(monotone && !bad ? 0 : 1);
}

if (MODE === "play") await play().then(() => process.exit(0));
else if (MODE === "fit") fit();
else { console.error("用法: test-ladder.mjs play|fit …"); process.exit(2); }
