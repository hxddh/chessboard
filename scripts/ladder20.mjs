/**
 * The 20.0 ladder, measured (v20-0-plan §3 P1): the opponents of
 * src/app/core/opponents.js play each other, and the results are fitted into
 * one rating per opponent — the rating the new-game sheet shows.
 *
 * The games are the app's games: every move is engine.bestMove(fen, profile,
 * ctx) on the app's engine service over the same backends (Maia-3 in this
 * thread, the vendored Stockfish wasm; scripts/lib/opp-game.mjs), resignation
 * by opponents/mind.js. Openings rotate through 16 short book lines, each
 * with both colours; sampling runs off a seeded generator per game.
 *
 * The scale: 19.0's ladder (docs/measured.json `ladder`) is on the scale the
 * app has always shown — UCI_Elo 1320 / 1700 in 8.0, then each re-fit held to
 * the rungs that had not changed. Four of its rungs play here as anchors
 * (`19:<id>`: 19.0's own engine.js tiers and Maia-1 nets, through
 * scripts/lib/ladder-player.mjs, 19.0's resign rule) against the 20.0
 * opponents nearest them; the fit is put on the 19.0 scale by a least-squares
 * line through the anchors at their recorded ratings. So a 1500 here is a
 * 1500 there.
 *
 * The fit is Bradley–Terry (scripts/lib/bradley-terry.mjs, the 19.0 fit) with
 * two virtual draws between neighbours.
 *
 *   node scripts/ladder20.mjs play --shard=1/4 --out=DIR [--adjacent=40] [--near=12] [--anchor-games=30]
 *   node scripts/ladder20.mjs play --pairs=pip:tomo:80,19:steady:lina:40 --shard=1/4 --out=DIR
 *   node scripts/ladder20.mjs play … --dry-run
 *   node scripts/ladder20.mjs fit --in=DIR[,DIR] [--record]
 *
 * A game records the settings both sides played with; `fit` counts only
 * games whose settings are today's (core/opponents.js and opponents/mind.js).
 */
import fs from "fs";
import path from "path";
import { LADDER } from "../src/app/core/opponents.js";
import { TUNING } from "../src/app/opponents/mind.js";
import { Chess } from "../src/app/core/chess.js";
import { nodeService, rngFrom, seedOf } from "./lib/opp-game.mjs";
import { fitBT } from "./lib/bradley-terry.mjs";
import { record, read, RECORDING } from "./measurements.mjs";

process.removeAllListeners("warning");
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MODE = process.argv[2];

/** 19.0 rungs that hold the scale, and the 20.0 opponents they meet (nearest by rating). */
export const ANCHORS = ["steady", "normalminus", "hard", "master"];
const IDS = LADDER.map((o) => o.id);
const MIND = TUNING;
/** What a game was played with: the profile's play and resign rule, and the mind's own settings. */
const settingsOf = (id) => {
  if (id.startsWith("19:")) return { ladder19: id.slice(3) };
  const p = LADDER.find((o) => o.id === id);
  return { play: p.play, resign: p.resign, mind: MIND };
};

const OPENINGS = [
  "e4 e5 Nf3 Nc6", "d4 d5 c4 e6", "e4 c5 Nf3 d6", "d4 Nf6 c4 g6",
  "e4 e6 d4 d5", "e4 c6 d4 d5", "c4 e5 Nc3 Nf6", "Nf3 d5 g3 Nf6",
  "e4 e5 Nf3 Nf6", "d4 Nf6 c4 e6", "e4 c5 Nc3 Nc6", "d4 d5 Nf3 Nf6",
  "e4 d6 d4 Nf6", "d4 Nf6 Nf3 d5", "c4 c5 Nc3 Nc6", "e4 e5 Bc4 Nf6",
];

// --- the schedule ------------------------------------------------------------------

/** The 20.0 opponent an anchor is nearest, by the ratings on record (or shown). */
function nearestTo(rating, k) {
  const rec = (read().ladder20 || {}).rating || {};
  const r = (id) => rec[id] ?? LADDER.find((o) => o.id === id).rating;
  return IDS.slice().sort((a, b) => Math.abs(r(a) - rating) - Math.abs(r(b) - rating)).slice(0, k);
}

function schedule() {
  const out = [];
  const pairs = arg("pairs", "");
  const known = (x) => IDS.includes(x) || (x.startsWith("19:") && ANCHORS.includes(x.slice(3)));
  if (pairs) {
    for (const p of pairs.split(",")) {
      // ids may carry the 19: prefix; the count is last
      const parts = p.split(":");
      const n = /^\d+$/.test(parts[parts.length - 1]) ? Number(parts.pop()) : Number(arg("adjacent", 40));
      const ids = [];
      for (let i = 0; i < parts.length; i++) ids.push(parts[i] === "19" ? "19:" + parts[++i] : parts[i]);
      if (ids.length !== 2 || !ids.every(known) || ids[0] === ids[1]) { console.error("--pairs: " + p); process.exit(2); }
      for (let k = 0; k < n; k++) out.push({ a: ids[0], b: ids[1], k });
    }
    return out;
  }
  const nAdj = Number(arg("adjacent", 40)), nNear = Number(arg("near", 12)), nAnchor = Number(arg("anchor-games", 30));
  for (let i = 0; i < IDS.length; i++) {
    if (i + 1 < IDS.length) for (let k = 0; k < nAdj; k++) out.push({ a: IDS[i], b: IDS[i + 1], k });
    if (i + 2 < IDS.length) for (let k = 0; k < nNear; k++) out.push({ a: IDS[i], b: IDS[i + 2], k });
  }
  const rec19 = read().ladder.rating;
  for (const an of ANCHORS) for (const id of nearestTo(rec19[an], 2)) for (let k = 0; k < nAnchor; k++) out.push({ a: "19:" + an, b: id, k });
  return out;
}

// --- play --------------------------------------------------------------------------

/** 19.0's rungs, as test-ladder.mjs plays them (only loaded when an anchor plays). */
async function ladder19() {
  const { loadAppModules } = await import("./lib/app-module.mjs");
  const { startPlayer } = await import("./lib/ladder-player.mjs");
  const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/engine.js", "src/web/js/persona.js", "src/web/js/opponents.js", "src/web/js/human/maia-net.js", "src/web/js/human/pick.js"]);
  const { Chess: Chess19, ChessEngine, ChessPersona, Opponents, parseNet, movePolicy } = ctx;
  const player = await startPlayer({ Chess: Chess19, ChessEngine, ChessPersona, parseNet, movePolicy,
    Pick: { pickHuman: ctx.pickHuman, guardMoves: ctx.guardMoves, guardPolicy: ctx.guardPolicy } });
  const tierOf = (id) => {
    const p = Opponents.PERSONAS.find((x) => x.level === id);
    return Object.assign({}, ChessEngine.TIERS[id], { style: p ? p.style : "off" });
  };
  return { player, tierOf, shouldResign: (s) => Opponents.shouldResign(s) };
}

async function playOne(svc, old, white, black, opening, random) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of opening.split(" ")) { g.move(san); fens.push(g.fen()); }
  if (old && (white.startsWith("19:") || black.startsWith("19:"))) await old.player.newGame();
  const looks = { w: [], b: [] }, scores19 = { w: [], b: [] };
  let plies = 0;
  while (!g.game_over() && plies < 300) {
    const side = g.turn(), id = side === "w" ? white : black;
    const fen = g.fen();
    let uci;
    if (id.startsWith("19:")) {
      const tier = old.tierOf(id.slice(3));
      const mv = await old.player.move(fen, tier, random, tier.style, fens);
      if (!mv) break;
      uci = mv.uci;
      if (mv.score != null) scores19[side].push(mv.score);
      if (old.shouldResign(scores19[side])) return { result: side === "w" ? "0-1" : "1-0", how: "resign", plies };
    } else {
      const prof = LADDER.find((o) => o.id === id);
      const r = await svc.bestMove(fen, prof, { history: fens.slice(0, -1), looks: looks[side], random });
      looks[side].push(r.look);
      if (r.resign) return { result: side === "w" ? "0-1" : "1-0", how: "resign", plies };
      uci = r.move;
    }
    if (!uci || !g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" })) break;
    fens.push(g.fen());
    plies++;
  }
  if (g.in_checkmate()) return { result: g.turn() === "w" ? "0-1" : "1-0", how: "mate", plies };
  return { result: "1/2", how: g.game_over() ? "rules" : "cap", plies };
}

async function play() {
  const all = schedule();
  const [si, sn] = arg("shard", "1/1").split("/").map(Number);
  if (process.argv.includes("--dry-run")) {
    const per = {};
    for (const j of all) per[j.a + "–" + j.b] = (per[j.a + "–" + j.b] || 0) + 1;
    for (const [p, n] of Object.entries(per)) console.log("  " + p + "  " + n);
    console.log(Object.keys(per).length + " pairings, " + all.length + " games; shard " + si + "/" + sn + ": " + all.filter((_, i) => i % sn === si - 1).length);
    return;
  }
  const outDir = arg("out", null);
  if (!outDir) { console.error("--out=DIR"); process.exit(2); }
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, "shard-" + si + "-of-" + sn + ".jsonl");
  const done = new Set();
  for (const f of fs.readdirSync(outDir).filter((x) => x.endsWith(".jsonl"))) {
    for (const line of fs.readFileSync(path.join(outDir, f), "utf8").split("\n").filter(Boolean)) done.add(JSON.parse(line).key);
  }
  const keyOf = (j) => j.a + ":" + JSON.stringify(settingsOf(j.a)) + "|" + j.b + ":" + JSON.stringify(settingsOf(j.b)) + "|" + j.k;
  const todo = all.filter((_, i) => i % sn === si - 1).filter((j) => !done.has(keyOf(j)));
  const { svc } = await nodeService();
  const old = todo.some((j) => j.a.startsWith("19:") || j.b.startsWith("19:")) ? await ladder19() : null;
  const t0 = Date.now();
  let n = 0;
  for (const j of todo) {
    const key = keyOf(j);
    const aWhite = j.k % 2 === 0;
    const opening = OPENINGS[Math.floor(j.k / 2) % OPENINGS.length];
    const s = Date.now();
    const res = await playOne(svc, old, aWhite ? j.a : j.b, aWhite ? j.b : j.a, opening, rngFrom(seedOf(key)));
    const scoreA = res.result === "1/2" ? 0.5 : (res.result === "1-0") === aWhite ? 1 : 0;
    fs.appendFileSync(file, JSON.stringify({ key, a: j.a, b: j.b, k: j.k, sa: settingsOf(j.a), sb: settingsOf(j.b), aWhite, opening,
      result: res.result, scoreA, how: res.how, plies: res.plies, ms: Date.now() - s }) + "\n");
    n++;
    process.stdout.write(`\r  ${n}/${todo.length}  ${j.a}–${j.b} #${j.k}: ${res.result} (${res.how}, ${res.plies})        `);
  }
  console.log(`\nshard ${si}/${sn}: ${n} games, ${((Date.now() - t0) / 60000).toFixed(1)} min → ${file}`);
}

// --- fit ---------------------------------------------------------------------------

function fit() {
  const dirs = arg("in", "").split(",").filter(Boolean);
  if (!dirs.length) { console.error("--in=DIR[,DIR]"); process.exit(2); }
  const now = (id) => JSON.stringify(settingsOf(id));
  const games = [];
  const seen = new Set();
  let stale = 0;
  for (const dir of dirs) for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".jsonl")).sort()) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)) {
      const g = JSON.parse(line);
      if (seen.has(g.key)) continue;
      seen.add(g.key);
      const ok = (id, s) => (id.startsWith("19:") ? ANCHORS.includes(id.slice(3)) : IDS.includes(id)) && JSON.stringify(s) === now(id);
      if (!ok(g.a, g.sa) || !ok(g.b, g.sb)) { stale++; continue; }
      games.push(g);
    }
  }
  const pairs = {};
  const pairOf = (a, b) => pairs[a + "|" + b] || pairs[b + "|" + a] || (pairs[a + "|" + b] = { a, b, games: 0, scoreA: 0, draws: 0 });
  for (const g of games) {
    const p = pairOf(g.a, g.b);
    p.games++; p.scoreA += p.a === g.a ? g.scoreA : 1 - g.scoreA; if (g.scoreA === 0.5) p.draws++;
  }
  const all = Object.values(pairs);
  const rec19 = read().ladder.rating;
  // the fit's order: the 20.0 ladder, each anchor slotted in by its 19.0 rating against today's shown ratings
  const shown = (id) => (id.startsWith("19:") ? rec19[id.slice(3)] : LADDER.find((o) => o.id === id).rating);
  const ids = [...IDS, ...ANCHORS.map((a) => "19:" + a)].filter((id) => all.some((p) => p.a === id || p.b === id))
    .sort((x, y) => (x.startsWith("19:") || y.startsWith("19:") ? shown(x) - shown(y) : IDS.indexOf(x) - IDS.indexOf(y)));
  const { R, se, cov } = fitBT(ids, all, 2);
  // the 19.0 scale: least squares through the anchors at their recorded ratings
  const an = ids.filter((id) => id.startsWith("19:"));
  let scale = 1, base = 1500 - R[0];
  if (an.length >= 2) {
    const xs = an.map((id) => R[ids.indexOf(id)]), ys = an.map((id) => rec19[id.slice(3)]);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length, my = ys.reduce((a, b) => a + b, 0) / ys.length;
    scale = xs.reduce((a, x, k) => a + (x - mx) * (ys[k] - my), 0) / xs.reduce((a, x) => a + (x - mx) ** 2, 0);
    base = my - scale * mx;
  }
  const rating = {}, ratingSe = {}, raw = {};
  ids.forEach((id, i) => { rating[id] = Math.round(base + scale * R[i]); ratingSe[id] = Math.round(scale * se[i]); raw[id] = Math.round(R[i]); });
  const pct = (d) => 100 / (1 + Math.pow(10, -d / 400));
  const r1 = (x) => Math.round(x * 10) / 10;
  const adjacent = [];
  let bad = 0;
  const lad = ids.filter((id) => !id.startsWith("19:"));
  console.log("\nopponent    raw   rating   ±   vs the one below: head to head (95%) / fit (95%)");
  for (let k = 0; k < lad.length; k++) {
    const id = lad[k], i = ids.indexOf(id);
    let line = "  " + id.padEnd(8) + String(raw[id]).padStart(6) + String(rating[id]).padStart(8) + String(ratingSe[id]).padStart(5);
    if (k > 0) {
      const lo = lad[k - 1], j = ids.indexOf(lo);
      const p = pairs[lo + "|" + id] || pairs[id + "|" + lo];
      let h2h = null, h2hCi = null;
      if (p && p.games) {
        const up = p.a === id ? p.scoreA : p.games - p.scoreA;
        const wins = up - p.draws / 2, m = up / p.games;
        const v = (wins * (1 - m) ** 2 + p.draws * (0.5 - m) ** 2 + (p.games - wins - p.draws) * m * m) / p.games;
        const h = 1.96 * Math.sqrt(v / p.games);
        h2h = r1(m * 100); h2hCi = [r1(Math.max(0, m - h) * 100), r1(Math.min(1, m + h) * 100)];
      }
      const d = R[i] - R[j];
      const sd = Math.sqrt(Math.max(0, cov[i][i] + cov[j][j] - 2 * cov[i][j]));
      const fitPct = pct(d), fitCi = [r1(pct(d - 1.96 * sd)), r1(pct(d + 1.96 * sd))];
      adjacent.push({ lower: lo, upper: id, games: p ? p.games : 0, h2hPct: h2h, h2hCi, fitPct: r1(fitPct), fitCi });
      line += `   ${h2h == null ? "—" : h2h + "% (" + h2hCi.join("–") + ")"} / ${fitPct.toFixed(1)}% (${fitCi.join("–")}), ${p ? p.games : 0} games`;
      if (!(fitPct >= 60 && fitPct <= 75)) bad++;
    }
    console.log(line);
  }
  for (const id of an) console.log("  " + id.padEnd(16) + String(rating[id]).padStart(6) + " ± " + ratingSe[id] + "  (19.0 record " + rec19[id.slice(3)] + ")");
  const monotone = lad.every((id, k) => k === 0 || R[ids.indexOf(id)] > R[ids.indexOf(lad[k - 1])]);
  const hours = games.reduce((a, g) => a + g.ms, 0) / 3600000;
  const how = {};
  for (const g of games) how[g.how] = (how[g.how] || 0) + 1;
  console.log(`\n${games.length} games (${hours.toFixed(2)} engine hours; ${JSON.stringify(how)}), ${stale} stale; scale ×${scale.toFixed(3)} through ${an.length} anchors`);
  console.log((monotone ? "ok" : "FAIL") + ": monotone");
  console.log((bad ? "FAIL" : "ok") + `: every adjacent step 60–75% by the fit (${adjacent.length - bad}/${adjacent.length})`);
  if (RECORDING) {
    record("ladder20", {
      what: "20.0 的对手（src/app/core/opponents.js）相邻循环对下：每步是应用的 engine.bestMove（opponents/mind.js，Maia-3 + node 里的 Stockfish 19 lite wasm），" +
        "16 个开局各执两色、每盘一个种子；Bradley–Terry 极大似然（相邻各加 2 盘虚拟和棋）；以 19.0 阶梯的 " + an.length + " 个档（19:id，19.0 自己的设置）为锚，" +
        "按它们在 docs/measured.json ladder 里的分数做最小二乘定标。区间 95%",
      script: "scripts/ladder20.mjs play --shard=i/4 … ; scripts/ladder20.mjs fit --record",
      games: games.length, engineHours: Math.round(hours * 100) / 100, endings: how,
      scale: Math.round(scale * 1000) / 1000, anchors: Object.fromEntries(an.map((id) => [id, { record: rec19[id.slice(3)], fitted: rating[id], se: ratingSe[id] }])),
      rating: Object.fromEntries(lad.map((id) => [id, rating[id]])), ratingSe: Object.fromEntries(lad.map((id) => [id, ratingSe[id]])),
      adjacent, monotone,
      pairs: all.map((p) => ({ a: p.a, b: p.b, games: p.games, scoreA: p.scoreA, draws: p.draws })),
      settings: Object.fromEntries(lad.map((id) => [id, settingsOf(id)])),
    });
  }
  process.exit(monotone && !bad ? 0 : 1);
}

if (MODE === "play") await play().then(() => process.exit(0));
else if (MODE === "fit") fit();
else { console.error("usage: ladder20.mjs play|fit …"); process.exit(2); }
