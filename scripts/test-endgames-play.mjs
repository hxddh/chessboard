/**
 * Every endgame of the camp, played out (v8-1-plan T2 acceptance: 每个残局都能
 * 用引擎的最佳着走完并达到目标).
 *
 * Both chairs are the vendored engine at a fixed depth — the side to move
 * plays its best move, the student's side included — until endgame-rules.js,
 * the function the app judges a run with, says the run is over. Every one
 * must end with the student's goal reached: a win for "win", a draw by the
 * rules (or a bare engine king) for "draw". So a position whose goal cannot
 * be reached by good play from the student's side, or whose "result" the app
 * would never recognise, fails here.
 *
 * Opt-in (engine, several minutes): part of `npm run test:engine`.
 *   node scripts/test-endgames-play.mjs [--depth=20] [--only=id,id] [--plies=400]
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startEngine } from "./lib/sf-node.mjs";

const arg = (k, d) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : d; };
const DEPTH = Number(arg("depth", 20));
const PLIES = Number(arg("plies", 400));
const ONLY = arg("only", "").split(",").filter(Boolean);

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/endgames.js", "src/web/js/endgame-rules.js"]);
const { Chess, CHESS_ENDGAMES, ChessEndgameRules: Rules } = ctx;
const eng = await startEngine(Chess, DEPTH);

let failed = 0;
const rows = [];
for (const x of CHESS_ENDGAMES.ITEMS) {
  if (ONLY.length && !ONLY.includes(x.id)) continue;
  const g = new Chess(x.fen);
  const start = Rules.startOf(g);
  const t0 = Date.now();
  let r = null;
  while (!r && g.history().length < PLIES) {
    const [best] = await eng.topLines(g.fen(), 1);
    if (!best || !g.move(best.san)) { r = { ok: false, how: "no move " + (best && best.san) }; break; }
    r = Rules.outcome(g, x.goal, start);
  }
  const ok = !!(r && r.ok);
  if (!ok) failed++;
  const row = { id: x.id, goal: x.goal, ok, how: r ? r.how : "unfinished", plies: g.history().length, s: Math.round((Date.now() - t0) / 1000) };
  rows.push(row);
  console.log((ok ? "ok: " : "FAIL: ") + x.id + " (" + x.goal + ") → " + row.how + " in " + row.plies + " plies, " + row.s + "s" +
    (ok ? "" : " — " + g.pgn({ max_width: 200 })));
}
const out = arg("out", "");
if (out) fs.writeFileSync(path.resolve(out), JSON.stringify({ depth: DEPTH, rows }, null, 1) + "\n");
if (failed) { console.error(failed + " endgame(s) not played to their goal"); process.exit(1); }
console.log("all passed: " + rows.length + " endgames reached their goal at depth " + DEPTH);
void ROOT;
