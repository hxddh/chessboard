/**
 * Converting (v20-0-plan §3 P1 acceptance): every opponent wins won
 * positions. For each profile of src/app/core/opponents.js, the 50 positions
 * of scripts/fixtures/convert-positions.json (middlegames from real games,
 * rook-up and queen-up endings; the side to move wins by Stockfish, ≥ +6) are
 * played out — the profile on the winning side, moving as the app moves it
 * (engine.bestMove → opponents/mind.js over Maia-3 and the vendored
 * Stockfish), against a fixed defender (Stockfish, 5,000 nodes a move, no
 * strength limit). A win is a mate within 60 of the profile's moves; a draw
 * by the rules or the cap is not. Every profile must win ≥ 90%.
 *
 *   node scripts/test-convert.mjs [--shard=i/n] [--profiles=pip,tomo] [--positions=N] [--out=DIR] [--record]
 *   node scripts/test-convert.mjs --in=DIR --record      (merge the shards' files and record)
 *
 * With --out each shard appends its games to DIR/convert-i-of-n.jsonl; --in
 * reads them all back (the CI job runs four shards, then one --in).
 */
import fs from "fs";
import path from "path";
import { LADDER } from "../src/app/core/opponents.js";
import { ROOT } from "./lib/app-module.mjs";
import { nodeService, playGame, rngFrom, seedOf } from "./lib/opp-game.mjs";
import { record, RECORDING } from "./measurements.mjs";

process.removeAllListeners("warning");
const arg = (name, dflt) => {
  const hit = process.argv.find((a) => a.startsWith("--" + name + "="));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const MOVES = 60, NEED = 0.9, DEFENDER_NODES = 5000;
const FIX = JSON.parse(fs.readFileSync(path.join(ROOT, "scripts/fixtures/convert-positions.json"), "utf8")).positions;
const positions = FIX.slice(0, Number(arg("positions", FIX.length)));
const profiles = arg("profiles", "") ? LADDER.filter((p) => arg("profiles", "").split(",").includes(p.id)) : LADDER;

function report(rows) {
  const by = {};
  for (const r of rows) {
    const b = by[r.id] || (by[r.id] = { games: 0, wins: 0, moves: [], kinds: {} });
    b.games++;
    if (r.won) { b.wins++; b.moves.push(r.moves); }
    const k = b.kinds[r.kind] || (b.kinds[r.kind] = [0, 0]);
    k[1]++; if (r.won) k[0]++;
  }
  let bad = 0;
  const out = {};
  for (const p of LADDER) {
    const b = by[p.id];
    if (!b) continue;
    const rate = b.wins / b.games;
    const med = b.moves.sort((x, y) => x - y)[b.moves.length >> 1] ?? null;
    out[p.id] = { games: b.games, wins: b.wins, rate: Math.round(rate * 1000) / 10, medianMoves: med,
      kinds: Object.fromEntries(Object.entries(b.kinds).map(([k, v]) => [k, v[0] + "/" + v[1]])) };
    const ok = rate >= NEED;
    if (!ok) bad++;
    console.log((ok ? "ok" : "FAIL") + `: ${p.id.padEnd(5)} ${b.wins}/${b.games} won (${out[p.id].rate}%), median ${med} moves  ` +
      Object.entries(out[p.id].kinds).map(([k, v]) => k + " " + v).join(", "));
  }
  return { bad, out };
}

if (arg("in", "")) {
  const rows = [];
  for (const dir of arg("in", "").split(",")) for (const f of fs.readdirSync(dir).filter((x) => /^convert-.*\.jsonl$/.test(x))) {
    for (const line of fs.readFileSync(path.join(dir, f), "utf8").split("\n").filter(Boolean)) rows.push(JSON.parse(line));
  }
  const { bad, out } = report(rows);
  if (RECORDING && !bad) {
    record("convert20", {
      what: "每个对手在 50 个赢棋局面（scripts/fixtures/convert-positions.json：真实对局的中局与多车、多后残局，Stockfish 深 14 ≥ +6）执胜方，" +
        "按应用的走法（engine.bestMove → opponents/mind.js）对固定防守方（Stockfish 每步 " + DEFENDER_NODES + " 节点、不限强度），" + MOVES + " 步内将死算赢",
      script: "scripts/test-convert.mjs --shard=i/4 --out=DIR ; scripts/test-convert.mjs --in=DIR --record",
      need: NEED * 100, profiles: out,
    });
  }
  process.exit(bad ? 1 : 0);
}

const [si, sn] = arg("shard", "1/1").split("/").map(Number);
const jobs = [];
for (const p of profiles) positions.forEach((pos, i) => jobs.push({ p, pos, i }));
const mine = jobs.filter((_, k) => k % sn === si - 1);
const { svc, sf } = await nodeService();
const defender = { id: "defender", play: null };
const defend = async (fen) => ({ move: (await sf.search(fen, { multipv: 1, nodes: DEFENDER_NODES })).lines[0]?.pv[0] || null, look: 0, resign: false, thinkMs: 0 });
const svcWithDefender = { bestMove: (fen, prof, ctx) => (prof === defender ? defend(fen) : svc.bestMove(fen, prof, ctx)) };
const outDir = arg("out", "");
if (outDir) fs.mkdirSync(outDir, { recursive: true });
const file = outDir ? path.join(outDir, "convert-" + si + "-of-" + sn + ".jsonl") : null;
const rows = [];
const t0 = Date.now();
for (const { p, pos, i } of mine) {
  const winner = pos.fen.split(" ")[1];
  const startFen = pos.fen;
  // the fixture's history is the game before it; playGame starts its own from startFen
  const r = await playGame({
    svc: { bestMove: (fen, prof, ctx) => svcWithDefender.bestMove(fen, prof, prof === defender ? ctx : { ...ctx, history: [...pos.history, ...ctx.history] }) },
    white: winner === "w" ? p : defender, black: winner === "w" ? defender : p, startFen,
    random: rngFrom(seedOf(p.id + ":" + i)), cap: MOVES * 2,
  });
  const won = r.how === "mate" && (r.result === "1-0") === (winner === "w") || r.how === "resign" && (r.result === "1-0") === (winner === "w");
  const row = { id: p.id, i, kind: pos.kind, won, how: r.how, moves: Math.ceil(r.plies / 2), result: r.result };
  rows.push(row);
  if (file) fs.appendFileSync(file, JSON.stringify(row) + "\n");
  process.stdout.write(`\r  ${rows.length}/${mine.length}  ${p.id} #${i} (${pos.kind}): ${won ? "won" : r.how} in ${row.moves}        `);
}
console.log(`\nshard ${si}/${sn}: ${rows.length} games in ${((Date.now() - t0) / 60000).toFixed(1)} min`);
const { bad } = report(rows);
process.exit(sn === 1 && bad ? 1 : 0);
