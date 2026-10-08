/**
 * 名局猜着的核对（v8-4-plan T2）：每一局、每一步，大师着与引擎第一选择差多少。
 *
 * 名局猜着 scores a guess against the master's move (trainer/guess.js): the
 * master's own move is full marks whatever the engine thinks of it, and any
 * other move loses only what it gives away *against the master's move*. So a
 * historical mistake is never a trap for the player — a better move than the
 * master's loses nothing — but the card would hand full marks to a move the
 * engine calls a blunder, and the notes should say so where it matters. This
 * script finds those moves.
 *
 * For every ply of every game (the ten of classics.js and the thirty of
 * classics-more.js): the engine's best move and its score at DEPTH, and,
 * where the master played something else, the master's move scored at the
 * same depth with `searchmoves` (lib/sf-node.mjs — the vendored Stockfish,
 * a clean hash per position, as verify-puzzles.mjs and verify-lessons.mjs).
 * The drop is in the mover's win-percentage points, review.js's curve, the
 * same unit the guess card shows. A ply is recorded when the drop reaches
 * FLAG (review.js WIN_BLUNDER, 20 — a ?? in the review).
 *
 * Writes docs/classics-verified.json: per game its move list (so a game
 * edited after its check fails scripts/test-classics.mjs until re-run), the
 * flagged plies, and how long it took. Each game is independent, so the run
 * can be split: --only=a,b,… --out=part.json checks some games, and --merge
 * folds the parts into the record (four processes cover the forty games in
 * about a quarter of the time).
 *
 *   node scripts/verify-classics.mjs [--depth=18] [--only=id,… | --shard=i/n] [--out=part.json] [--dry]
 *   node scripts/verify-classics.mjs --merge=part1.json,part2.json   (fold shard runs into the record)
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startEngine } from "./lib/sf-node.mjs";

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : dflt;
};
const DEPTH = Number(arg("depth", 18));
let ONLY = arg("only", "") ? new Set(arg("only", "").split(",")) : null;
/** --shard=i/n: the i-th of n slices balanced by plies (with --out, then --merge) */
const SHARD = arg("shard", "");
const DRY = process.argv.includes("--dry");
export const RECORD = path.join(ROOT, "docs/classics-verified.json");
const OUT = arg("out", "") ? path.resolve(arg("out", "")) : RECORD;
/** --merge=a.json,b.json: shard records (--only … --out=…) folded into the record */
const MERGE = arg("merge", "") ? arg("merge", "").split(",") : null;
/** review.js WIN_BLUNDER: a drop this size is a ?? in the review */
export const FLAG = 20;

/** review.js winPct, from the mover's side; mate scores (sf-node scoreOf) map to the ends */
export const winPct = (s) => (s >= 90000 ? 100 : s <= -90000 ? 0 : 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * s)) - 1));

/** The forty games in catalog order, from the sources the app ships. */
export function allGames() {
  const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/classics.js", "src/web/js/classics-more.js"]);
  return { Chess: ctx.Chess, games: [...ctx.CHESS_CLASSICS, ...ctx.CHESS_CLASSICS_MORE_ZH.games] };
}

/** a game's moves as one string — what the record is held to */
export function movesOf(Chess, g) {
  const c = new Chess();
  c.load_pgn(g.pgn, { sloppy: true });
  return c.history().join(" ");
}

async function main() {
  const { Chess, games } = allGames();
  if (SHARD) {
    const [i, n] = SHARD.split("/").map(Number);
    const bins = Array.from({ length: n }, () => ({ ids: new Set(), plies: 0 }));
    const rows = games.map((g) => ({ id: g.id, p: movesOf(Chess, g).split(" ").length })).sort((a, b) => b.p - a.p || (a.id < b.id ? -1 : 1));
    for (const r of rows) { const b = bins.reduce((m, x) => (x.plies < m.plies ? x : m)); b.ids.add(r.id); b.plies += r.p; }
    ONLY = bins[i - 1].ids;
  }
  const rec = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : null;
  const keep = rec && rec.depth === DEPTH ? new Map(rec.games.map((g) => [g.id, g])) : new Map();
  for (const f of MERGE || []) {
    const part = JSON.parse(fs.readFileSync(f, "utf8"));
    if (part.depth !== DEPTH) throw new Error(f + " was searched at depth " + part.depth + ", not " + DEPTH);
    for (const g of part.games) keep.set(g.id, g);
  }
  const engine = MERGE ? null : await startEngine(Chess, DEPTH);
  const t0 = Date.now();
  for (const g of games) {
    if (MERGE || (ONLY && !ONLY.has(g.id))) continue;
    const t1 = Date.now();
    const c = new Chess();
    c.load_pgn(g.pgn, { sloppy: true });
    const moves = c.history({ verbose: true });
    const walk = new Chess();
    const flagged = [];
    let worst = 0;
    for (let i = 0; i < moves.length; i++) {
      const fen = walk.fen();
      const m = moves[i];
      const [best] = await engine.topLines(fen, 1);
      let drop = 0, ms = best ? best.score : null;
      if (best && best.san !== m.san) {
        ms = await engine.scoreOfMove(fen, m.san);
        if (ms != null) drop = Math.max(0, winPct(best.score) - winPct(ms));
      }
      worst = Math.max(worst, drop);
      if (drop >= FLAG) flagged.push({ ply: i + 1, san: m.san, best: best.san, bestScore: best.score, score: ms, drop: Math.round(drop * 10) / 10 });
      walk.move(m.san);
    }
    const row = { id: g.id, plies: moves.length, moves: moves.map((m) => m.san).join(" "), flagged, worst: Math.round(worst * 10) / 10, ms: Date.now() - t1 };
    keep.set(g.id, row);
    console.log(g.id, moves.length + " plies", (row.ms / 1000).toFixed(1) + " s", flagged.length ? "flagged: " + flagged.map((f) => "ply " + f.ply + " " + Math.ceil(f.ply / 2) + (f.ply % 2 ? "." : "...") + f.san + " (best " + f.best + ", −" + f.drop + ")").join("; ") : "");
  }
  const out = {
    depth: DEPTH, flag: FLAG, engine: "third_party/stockfish/stockfish-19-lite-single (lib/sf-node.mjs)",
    games: games.map((g) => keep.get(g.id)).filter(Boolean),
  };
  out.summary = { games: out.games.length, plies: out.games.reduce((a, g) => a + g.plies, 0),
    flagged: out.games.reduce((a, g) => a + g.flagged.length, 0), ms: out.games.reduce((a, g) => a + g.ms, 0) };
  console.log("done in " + ((Date.now() - t0) / 1000).toFixed(0) + " s; record has " + out.summary.games + " games, " + out.summary.flagged + " flagged plies");
  if (!DRY) fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + "\n");
  process.exit(0);
}

if (import.meta.url === "file://" + process.argv[1]) main();
