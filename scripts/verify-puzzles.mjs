/**
 * Re-verify stored puzzle solutions with the engine (v8-0-plan B1).
 *
 * The acceptance line for the imported Lichess set: "a sample of 500 re-checked
 * at depth 18; the share whose stored solution is worse than the engine's best
 * is ≤ 1%". The gate (puzzle-gate.mjs) proves what it can without an engine —
 * mates are forced, material is won — but not that the stored move is the
 * *best* one; a line that wins a knight where a queen was on offer passes the
 * gate and teaches the smaller win. This asks Stockfish.
 *
 * Every solver move of the stored line is checked, not just the first: the
 * player has to find each of them, and the app grades each. A move is `worse`
 * when the engine's best at that position scores more than TIE (50cp) above
 * it at the same depth; a mate that is merely slower than the fastest mate is
 * not worse (scores are 100000 − distance, so M3 vs M1 is 2 points). Scores
 * come from a fresh hash per position, and a stored move outside the top
 * lines is scored with `searchmoves` (lib/sf-node.mjs, from test-mined.mjs).
 *
 *   node scripts/verify-puzzles.mjs --set=mined   [--sample=500] [--depth=18] [--seed=1] [--shard=1/3] [--tie=50] [--out=f.json]
 *   node scripts/verify-puzzles.mjs --set=lichess [--dir=src/web/js] …
 *   node scripts/verify-puzzles.mjs --merge=a.json,b.json,c.json [--retire]
 *
 * --retire (a complete mined run only) takes every `worse` puzzle out of
 * puzzles-mined.js — see retire() below.
 *
 * --shard runs one slice of the same seeded sample, so three processes cover
 * the 500 in a third of the time; --merge adds their JSON reports up. The
 * `worse` ids of a Lichess run are the --exclude list for import-puzzles.mjs:
 * dropped, and the drop written into the landing record.
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startEngine } from "./lib/sf-node.mjs";
import { seededRng } from "./import-puzzles.mjs";

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : dflt;
};
// --tie=49 drops every move 50cp or more below the best (cp are integers);
// the default keeps the acceptance line's "more than 50cp"
const TIE = Number(arg("tie", 50));
const LINES = 4;

/** Add up shard reports. */
function merge(files) {
  const all = files.map((f) => JSON.parse(fs.readFileSync(f, "utf8")));
  const out = { set: all[0].set, depth: all[0].depth, sample: 0, checked: 0, plies: 0, worseFirst: [], worseAny: [], ms: 0 };
  for (const r of all) {
    out.sample += r.sample; out.checked += r.checked; out.plies += r.plies; out.ms = Math.max(out.ms, r.ms);
    out.worseFirst.push(...r.worseFirst); out.worseAny.push(...r.worseAny);
  }
  return out;
}

function report(r) {
  const pct = (n) => (r.checked ? (100 * n / r.checked).toFixed(2) : "0") + "%";
  console.log(`${r.set}: ${r.checked} puzzles, ${r.plies} solver moves, depth ${r.depth}`);
  console.log(`  stored first move worse than the engine's best by > ${TIE}cp: ${r.worseFirst.length} (${pct(r.worseFirst.length)})`);
  console.log(`  any stored solver move worse by > ${TIE}cp:               ${r.worseAny.length} (${pct(r.worseAny.length)})`);
  for (const w of r.worseAny.slice(0, 30)) console.log(`    ${w.id.padEnd(20)} ply ${w.ply}  stored ${String(w.stored).padEnd(8)} engine ${String(w.best).padEnd(8)} by ${w.margin == null ? "?" : w.margin}cp`);
}

/**
 * Retire every mined puzzle a report calls worse (v8-0-plan B1: the whole set
 * at depth 18, --tie=49). The same edit test-mined --fix makes: one entry per
 * line in the generated file, ids never rewritten, the header's count kept
 * equal to what is left. Retired, not truncated: a line whose second or third
 * solver move is worse teaches that move, and cutting it short would ship a
 * puzzle the gate never saw.
 */
function retire(r) {
  const file = path.join(ROOT, "src/web/js/puzzles-mined.js");
  const gone = new Set(r.worseAny.map((w) => w.id));
  let dropped = 0;
  let src = fs.readFileSync(file, "utf8").split("\n").filter((line) => {
    const m = /^\s*\{id: "([^"]+)"/.exec(line);
    if (m && gone.has(m[1])) { dropped++; return false; }
    return true;
  }).join("\n");
  src = src.replace(/^( \* )(\d+) puzzles \(([^)]*)\)/m, (all0, lead, n, notes) =>
    lead + (Number(n) - dropped) + " puzzles (" + notes + ", " + dropped + " by verify-puzzles at depth " + r.depth + ")");
  fs.writeFileSync(file, src);
  console.log(`retired ${dropped} mined puzzles`);
}

if (arg("merge")) {
  const r = merge(arg("merge").split(","));
  report(r);
  if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(r, null, 1));
  if (process.argv.includes("--retire")) {
    if (r.set !== "mined" || r.checked < r.sample) { console.error("--retire needs a complete mined run"); process.exit(1); }
    retire(r);
  }
  process.exit(0);
}

const SET = arg("set", "mined");
const DEPTH = Number(arg("depth", 18));
const SAMPLE = Number(arg("sample", 500));
const SEED = Number(arg("seed", 1));
const [SH, SN] = arg("shard", "1/1").split("/").map(Number);

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/puzzle-db.js"]);
const Chess = ctx.Chess;
let puzzles = [];
if (SET === "mined") {
  puzzles = loadAppModules(["src/web/js/puzzles-mined.js"]).MINED_PUZZLES;
} else if (SET === "lichess") {
  const dir = path.join(arg("dir", path.join(ROOT, "src/web/js")), "lichess");
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^band-\d{4}\.js$/.test(f)).sort() : [];
  for (const f of files) {
    const b = loadAppModules([path.join(dir, f)]);
    puzzles.push(...b["LC_BAND_" + f.slice(5, 9)].map(ctx.ChessPuzzleDb.decodeRow));
  }
} else if (SET === "hand") {
  puzzles = loadAppModules(["src/web/js/puzzles.js"]).CHESS_PUZZLES.filter((p) => Array.isArray(p.solution) && p.fen);
}
if (!puzzles.length) { console.log("no puzzles in set " + SET); process.exit(0); }

// the same seeded sample for every shard: shuffle, take SAMPLE, deal round-robin
const rng = seededRng(SEED);
const order = puzzles.slice();
for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
const sample = order.slice(0, SAMPLE).filter((_, i) => i % SN === SH - 1);

const eng = await startEngine(Chess, DEPTH);
const t0 = Date.now();
const res = { set: SET, depth: DEPTH, sample: sample.length, checked: 0, plies: 0, worseFirst: [], worseAny: [], ms: 0 };
for (let i = 0; i < sample.length; i++) {
  const p = sample[i];
  const line = p.solution || [];
  const g = new Chess(p.fen);
  let bad = null;
  for (let k = 0; k < line.length; k++) {
    if (k % 2 === 0) {
      const fen = g.fen();
      const lines = await eng.topLines(fen, LINES);
      if (lines.length) {
        res.plies++;
        const shown = lines.find((l) => l.san === line[k]);
        const stored = shown ? shown.score : await eng.scoreOfMove(fen, line[k]);
        const margin = stored == null ? null : lines[0].score - stored;
        if (margin == null || margin > TIE) { bad = { id: p.id, cat: p.cat, ply: k, stored: line[k], best: lines[0].san, margin }; break; }
      }
    }
    if (!g.move(line[k])) break;
  }
  res.checked++;
  if (bad) { res.worseAny.push(bad); if (bad.ply === 0) res.worseFirst.push(bad); }
  if ((i + 1) % 25 === 0) process.stderr.write(`  ${SH}/${SN}: ${i + 1}/${sample.length} (${((Date.now() - t0) / 60000).toFixed(1)} min)\n`);
}
res.ms = Date.now() - t0;
report(res);
if (arg("out")) fs.writeFileSync(arg("out"), JSON.stringify(res, null, 1));
process.exit(0);
