/**
 * Offline puzzle miner — the second source for Q3.2 of docs/v6-plan.md.
 *
 * The Lichess importer (scripts/import-puzzles.mjs) needs the Lichess database
 * on disk; where that download is not possible this script grows the puzzle
 * set from games the vendored Stockfish plays against itself:
 *
 *   node scripts/mine-puzzles.mjs mine --games 200 --seed 7 --rows /tmp/rows-7.json
 *   node scripts/mine-puzzles.mjs emit --rows /tmp/rows-7.json,/tmp/rows-8.json \
 *        --out src/web/js/puzzles-mined.js --per-theme 150 --per-band 80 --max 1200
 *
 * How a position becomes a puzzle, and why each step is there:
 *
 *   1. Two engine sides at low UCI Skill Levels (chosen per game from a seeded
 *      rng) play from a short random opening. Weak settings blunder the way
 *      people do — hanging pieces, walking into forks, missing mates — which
 *      is exactly the material a tactics trainer wants.
 *   2. Every position is also analysed at full strength for `--movetime` ms.
 *      A move whose evaluation swing against the mover is ≥ `--loss` cp is a
 *      blunder, and the position right after it is a candidate: the other
 *      side has something to find, and the full-strength principal variation
 *      says what.
 *   3. Each candidate is written as a Lichess-shaped row (FEN before the
 *      blunder, then the blunder followed by the refutation), with a theme
 *      this repo can *check*: mateInN when the solver proves a forced mate,
 *      a motif name when motif.js recognises one, else hangingPiece.
 *   4. `emit` feeds the rows through the importer's own pipeline — the same
 *      normalisation (white to move), the same scripts/lib/puzzle-gate.mjs
 *      proofs, the same quotas — so a mined puzzle is held to the standard of
 *      a hand-written or imported one, and nothing here re-implements a gate.
 *
 * Ratings: a mined position has no player history, so `rating` is an estimate
 * from the category, the length of the line and whether the key move is quiet
 * (the same signals app.js uses for hand-written puzzles). The app's Glicko-2
 * moves it from the first answer on; the estimate only decides where a puzzle
 * starts.
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { runPipeline, convert, normalise, seededRng, themeKey, bandOf } from "./import-puzzles.mjs";
import { whiteHasForcedMate } from "./lib/puzzle-gate.mjs";

const require = createRequire(import.meta.url);
const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/motif.js"]);
const Chess = ctx.Chess;
const motifOf = ctx.motifOf;

/** motif.js name → the Lichess theme the importer maps back to it */
const MOTIF_THEME = { fork: "fork", pin: "pin", skewer: "skewer", discovered: "discoveredAttack", double: "doubleCheck" };

// --- engine ------------------------------------------------------------------
let engine = null;
const listeners = [];
async function startEngine() {
  const enginePath = path.join(ROOT, "third_party/stockfish/stockfish-18-lite-single.js");
  const wasmPath = path.join(ROOT, "third_party/stockfish/stockfish-18-lite-single.wasm");
  if (!fs.existsSync(enginePath) || !fs.existsSync(wasmPath)) throw new Error("vendored Stockfish not found at third_party/stockfish/");
  engine = { wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)), listener: (l) => { for (const x of listeners.slice()) x(l); } };
  const factory = require(enginePath);
  await (factory.length >= 1 ? factory(engine) : factory()(engine));
  await new Promise((r) => { const t = () => (engine._isReady && !engine._isReady() ? setTimeout(t, 10) : r()); t(); });
  const w = waitFor((l) => l === "uciok", 20000);
  send("uci");
  await w;
}
const send = (c) => engine.ccall("command", null, ["string"], [c], { async: /^go\b/.test(c) });
function waitFor(pred, ms) {
  return new Promise((res, rej) => {
    const timer = setTimeout(() => { drop(); rej(new Error("engine timeout")); }, ms);
    const h = (l) => { if (typeof l === "string" && pred(l)) { clearTimeout(timer); drop(); res(l); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function ready() { const w = waitFor((l) => l === "readyok", 10000); send("isready"); await w; }
const parseScore = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  const v = Number(m[2]);
  return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
};
/** full-strength truth: score (mover's view) and principal variation */
async function truth(fen, ms) {
  await ready();
  send("setoption name Skill Level value 20");
  send("setoption name MultiPV value 1");
  send("position fen " + fen);
  let last = null;
  const collect = (l) => { if (typeof l !== "string") return; const s = parseScore(l); const pv = l.match(/\bpv\s+(.+)$/); if (s != null && pv) last = { score: s, pv: pv[1].trim().split(/\s+/) }; };
  listeners.push(collect);
  const w = waitFor((l) => l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  await w;
  listeners.splice(listeners.indexOf(collect), 1);
  return last;
}
/** one move from a weak engine */
async function weakMove(fen, skill, ms) {
  await ready();
  send("setoption name Skill Level value " + skill);
  send("position fen " + fen);
  const w = waitFor((l) => l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  const line = await w;
  const mv = line.split(/\s+/)[1];
  return mv && mv !== "(none)" ? mv : null;
}
const uciMove = (u) => ({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || undefined });

// --- one game → candidate rows -----------------------------------------------
const SKILLS = [1, 2, 3, 4, 5, 6, 8, 10];
async function playGame(rng, opt, seq) {
  const g = new Chess();
  const openPlies = 2 + Math.floor(rng() * 7);
  for (let i = 0; i < openPlies; i++) {
    const ms = g.moves();
    if (!ms.length) break;
    g.move(ms[Math.floor(rng() * ms.length)]);
  }
  const skill = { w: SKILLS[Math.floor(rng() * SKILLS.length)], b: SKILLS[Math.floor(rng() * SKILLS.length)] };
  const rows = [];
  let prev = null; // truth of the position before the last move, mover's view
  let prevFen = null, prevUci = null, decided = 0;
  for (let ply = 0; ply < opt.maxPlies && !g.game_over(); ply++) {
    const fen = g.fen();
    const here = await truth(fen, opt.movetime);
    if (!here) break;
    if (prev && prevUci) {
      // loss suffered by the previous mover: what they had, minus what they have now
      const before = prev.score, after = -here.score;
      const loss = before - after;
      const mateNow = here.score >= 90000 && !(before <= -90000);
      if ((loss >= opt.loss || mateNow) && here.pv.length) {
        rows.push({ id: "mn-" + seq + "-" + ply, fen: prevFen, moves: [prevUci].concat(here.pv.slice(0, 7)), ply,
          score: here.score, loss: Math.round(loss), skill });
      }
    }
    // a decided game teaches nothing more: stop once a mate is on the board or
    // one side has been a rook up for a while
    if (Math.abs(here.score) >= 90000 && (Math.abs(here.score) >= 99990 || ply > 12)) break;
    decided = Math.abs(here.score) >= 800 ? decided + 1 : 0;
    if (decided >= 6) break;
    const side = g.turn();
    // a share of outright random moves on top of the weak engine: a low skill
    // level still rarely hangs a piece outright, and hung pieces are what a
    // first tactics book is made of (the puzzle is the position after the
    // mistake, however it was made)
    let uci;
    if (rng() < opt.random) {
      const ms = g.moves({ verbose: true });
      const pick = ms[Math.floor(rng() * ms.length)];
      uci = pick.from + pick.to + (pick.promotion || "");
    } else uci = await weakMove(fen, skill[side], opt.playMs);
    if (!uci) break;
    const mv = g.move(uciMove(uci));
    if (!mv) break;
    prev = here; prevFen = fen; prevUci = uci;
  }
  return rows;
}

// --- candidate row → checkable theme ----------------------------------------
function quiet(fen, san) {
  const g = new Chess(fen);
  const m = g.move(san);
  return !!m && !m.captured && !g.in_check();
}
function estimateRating(cat, solution, fen) {
  const base = { m1: 1000, m2: 1350, m3: 1650, tac: 1400, win: 1200 }[cat] || 1400;
  let r = base + (quiet(fen, solution[0]) ? 150 : 0) + Math.max(0, (solution.length - 1) / 2) * 100;
  return Math.round(r / 50) * 50;
}
/** top two moves at full strength: the first move must be clearly best */
async function topTwo(fen, ms) {
  await ready();
  send("setoption name Skill Level value 20");
  send("setoption name MultiPV value 2");
  send("position fen " + fen);
  const lines = {};
  const collect = (l) => { if (typeof l !== "string") return; const m = l.match(/multipv (\d+) score (cp|mate) (-?\d+).* pv (\S+)/); if (m) lines[m[1]] = { score: parseScore(l), uci: m[4] }; };
  listeners.push(collect);
  const w = waitFor((l) => l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  await w;
  listeners.splice(listeners.indexOf(collect), 1);
  send("setoption name MultiPV value 1");
  return [lines[1] || null, lines[2] || null];
}
const sanToUci = (fen, san) => { const g = new Chess(fen); const m = g.move(san); return m ? m.from + m.to + (m.promotion || "") : null; };
/**
 * The engine's word on a non-mate line, on top of the gate's material proof:
 * the key move is the engine's first choice by a clear margin, and — for a
 * three-ply line — every Black reply leaves White clearly ahead, with the
 * stored reply among Black's best defences. A gate proves the arithmetic of
 * the stored line; this proves the line is the one that matters.
 */
async function verified(fen, solution, opt) {
  const [a, b] = await topTwo(fen, opt.verifyMs);
  if (!a || a.uci !== sanToUci(fen, solution[0])) return false;
  if (b && a.score < 90000 && a.score - b.score < opt.margin) return false;
  if (solution.length === 1) return true;
  const g = new Chess(fen);
  g.move(solution[0]);
  const replies = g.moves({ verbose: true });
  if (replies.length > 40) return false;
  let bestDef = Infinity, storedV = null;
  for (const r of replies) {
    const t = new Chess(g.fen());
    t.move(r);
    let v;
    if (t.in_checkmate()) v = -100000;
    else if (t.game_over()) v = 0;
    else { const e = await truth(t.fen(), opt.replyMs); v = e ? e.score : null; }
    if (v == null || v < opt.hold) return false;
    if (v < bestDef) bestDef = v;
    if (r.san === solution[1]) storedV = v;
  }
  return storedV != null && storedV <= bestDef + opt.slack;
}
/**
 * Decide the theme and the solution length for one row, by trying the checks
 * in order of strength: forced mate (solver-proven), a recognised motif, then
 * plain material ("material"); non-mate lines are also engine-verified.
 * @returns {Promise<object|null>} the row with `themes` and `moves` set, or null
 */
export async function classify(row, opt) {
  const n = normalise(Chess, Object.assign({}, row, { themes: "x" }));
  if (!n.ok) return null;
  const fen = n.fen, sol = n.solution;
  const attempt = async (theme, plies, mate) => {
    if (sol.length < plies) return null;
    const r = Object.assign({}, row, { themes: theme, moves: row.moves.slice(0, 1 + plies) });
    const c = convert(Chess, r);
    if (!c.ok) return null;
    if (!mate && !(await verified(c.puzzle.fen, c.puzzle.solution, opt))) return null;
    r.rating = estimateRating(c.puzzle.cat, c.puzzle.solution, c.puzzle.fen);
    return r;
  };
  for (let m = 1; m <= 3; m++) {
    if (whiteHasForcedMate(new Chess(fen), m)) return attempt("mateIn" + m, m * 2 - 1, true);
  }
  let motif = null;
  try { motif = motifOf(fen, sol[0], Chess); } catch (_) { motif = null; }
  const theme = motif && MOTIF_THEME[motif];
  if (theme) {
    const t = (await attempt(theme, 1)) || (await attempt(theme, 3));
    if (t) return t;
  }
  return (await attempt("hangingPiece", 1)) || (await attempt("material", 1)) || (await attempt("material", 3));
}

// --- emit --------------------------------------------------------------------
export function emitMined(puzzles, meta) {
  const head = [
    "/**",
    " * Puzzles mined from engine self-play — generated by scripts/mine-puzzles.mjs, do not edit.",
    " *",
    " * Source: games the vendored Stockfish 18 lite played against itself at low",
    " * UCI skill levels; each entry is the position after a blunder, with the",
    " * full-strength refutation as the solution. Every entry is white to move",
    " * (black-to-move positions were mirrored, see scripts/import-puzzles.mjs)",
    " * and has passed scripts/lib/puzzle-gate.mjs, the same proof the hand-written",
    " * set is held to. `rating` is an estimate (see mine-puzzles.mjs); the app's",
    " * Glicko-2 takes over from the first answer.",
    " *",
    " * " + (meta || ""),
    " * @module puzzles-mined",
    " */",
    "export const MINED_PUZZLES = [",
  ];
  const body = puzzles.map((p) => "  " + JSON.stringify(p).replace(/"([a-zA-Z_]+)":/g, "$1: ").replace(/,/g, ", ").replace(/\[ /g, "[") + ",");
  return head.concat(body, ["];", ""]).join("\n");
}

// --- CLI ---------------------------------------------------------------------
function parseArgs(argv) {
  const opt = { games: 20, seed: 1, movetime: 70, playMs: 25, loss: 180, maxPlies: 90, random: 0.12, verifyMs: 120, replyMs: 30, margin: 120, hold: 150, slack: 60, perTheme: 150, perBand: 80, max: 1200 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i], next = () => argv[++i];
    if (a === "--games") opt.games = Number(next());
    else if (a === "--seed") opt.seed = Number(next());
    else if (a === "--movetime") opt.movetime = Number(next());
    else if (a === "--play-ms") opt.playMs = Number(next());
    else if (a === "--loss") opt.loss = Number(next());
    else if (a === "--rows") opt.rows = next();
    else if (a === "--out") opt.out = next();
    else if (a === "--per-theme") opt.perTheme = Number(next());
    else if (a === "--per-band") opt.perBand = Number(next());
    else if (a === "--max") opt.max = Number(next());
    else if (a === "--debug") opt.debug = true;
    else if (a === "--random") opt.random = Number(next());
    else if (!a.startsWith("--")) opt.cmd = a;
  }
  return opt;
}

export async function main(argv) {
  const opt = parseArgs(argv);
  if (opt.cmd === "mine") {
    await startEngine();
    const rng = seededRng(opt.seed);
    const all = [], rejected = [];
    const t0 = Date.now();
    for (let gi = 0; gi < opt.games; gi++) {
      const rows = await playGame(rng, opt, opt.seed + "-" + gi);
      let kept = 0;
      for (const r of rows) { const c = await classify(r, opt); if (c) { all.push(c); kept++; } else if (opt.debug) rejected.push(r); }
      console.error(`game ${gi + 1}/${opt.games}: ${rows.length} candidates, ${kept} pass the gate (${all.length} total, ${Math.round((Date.now() - t0) / 1000)}s)`);
    }
    fs.writeFileSync(opt.rows, JSON.stringify(all));
    if (opt.debug) fs.writeFileSync(opt.rows + ".rejected.json", JSON.stringify(rejected));
    const by = {};
    for (const r of all) by[r.themes] = (by[r.themes] || 0) + 1;
    console.log(JSON.stringify({ rows: all.length, byTheme: by }));
    process.exit(0);
  }
  if (opt.cmd === "emit") {
    const rows = [];
    for (const f of String(opt.rows).split(",")) rows.push(...JSON.parse(fs.readFileSync(f, "utf8")));
    for (const r of rows) if (r.themes === "crushing") r.themes = "material"; // rows from before the label settled
    // the same position reached in two games is one puzzle
    const seen = new Set();
    const uniq = rows.filter((r) => { const k = r.fen + " " + r.moves[0]; if (seen.has(k)) return false; seen.add(k); return true; });
    const { puzzles, stats } = runPipeline(Chess, uniq, { perTheme: opt.perTheme, perBand: opt.perBand, max: opt.max, seed: opt.seed });
    for (const p of puzzles) { p.id = p.id.replace(/^lc-/, ""); p.src = "mined"; delete p.url; }
    const meta = `${puzzles.length} puzzles from ${uniq.length} candidate positions; per theme ≤ ${opt.perTheme}, per 200-point band ≤ ${opt.perBand}.`;
    fs.writeFileSync(opt.out, emitMined(puzzles, meta));
    console.log(JSON.stringify({ candidates: uniq.length, accepted: puzzles.length, byCat: stats.byCat, byTheme: stats.byTheme, byBand: stats.byBand, rejected: stats.rejected }));
    return;
  }
  console.error("usage: mine-puzzles.mjs mine --games N --seed S --rows out.json | emit --rows a.json[,b.json] --out puzzles-mined.js");
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
