/**
 * Lichess puzzle importer — Q3.2 of docs/v6-plan.md.
 *
 *   node scripts/import-puzzles.mjs lichess_db_puzzle.csv \
 *        --out src/web/js/puzzles-lichess.js \
 *        --per-theme 100 --per-band 50 --max 2000 --seed 1
 *
 * Input is the plain CSV from https://database.lichess.org/#puzzles (CC0;
 * decompress the .zst yourself — the pipeline reads only plain .csv so it
 * needs no dependency). Columns:
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 *
 * What the pipeline does to each row, in order, and why:
 *
 *   1. themes → category. Only themes this app can *check* are kept
 *      (THEME_MAP); everything else is skipped, not guessed.
 *   2. the first move in `Moves` is the OPPONENT's — Lichess stores the
 *      position before it. It is played to get the puzzle position; the rest
 *      is the solution.
 *   3. the solver is put on White. puzzles.js stores every puzzle white to
 *      move and the whole gate assumes it, so a black-to-move puzzle is
 *      mirrored top-to-bottom with colours swapped (`mirrorFen`), which
 *      preserves every tactical fact — the geometry of chess is symmetric
 *      across the middle of the board except for castling side and pawn
 *      direction, and both swap consistently.
 *   4. UCI → canonical SAN through chess.js, on the normalised board.
 *   5. the repo's gate (scripts/lib/puzzle-gate.mjs), the same functions the
 *      test suite runs on hand-written puzzles. A Lichess "mateIn2" that the
 *      solver finds is a mate in one, or a "fork" whose line does not win
 *      material by this app's one-ply rule, is rejected here rather than
 *      shipped and failed by the tests.
 *   6. quotas: at most --per-theme per category/motif and --per-band per
 *      200-point rating band, --max overall, drawn from a seeded shuffle so a
 *      re-run on the same DB emits the same file.
 *
 * Exported pieces are what scripts/test-learning.mjs exercises on a fixture;
 * the CLI at the bottom is a thin wrapper.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { loadAppModules } from "./lib/app-module.mjs";
import { positionGate, mateGate, swingGate, winGate, defGate, lineSwing } from "./lib/puzzle-gate.mjs";

/**
 * Lichess theme → this app's category (and motif, in motif.js's names).
 * Ordered: a row carrying several themes takes the first match, so a
 * "fork mateIn2" is a mate puzzle — the mate is what the gate can prove.
 * No Lichess theme means "hold a draw" (equality is about material, not a
 * half point), so `draw` has no source here and stays hand-written.
 */
export const THEME_MAP = [
  ["mateIn1", { cat: "m1" }],
  ["mateIn2", { cat: "m2" }],
  ["mateIn3", { cat: "m3" }],
  ["fork", { cat: "tac", motif: "fork" }],
  ["pin", { cat: "tac", motif: "pin" }],
  ["skewer", { cat: "tac", motif: "skewer" }],
  ["discoveredAttack", { cat: "tac", motif: "discovered" }],
  ["doubleCheck", { cat: "tac", motif: "double" }],
  ["defensiveMove", { cat: "def" }],
  ["hangingPiece", { cat: "win" }],
];

/** @returns {{cat:string, motif?:string}|null} */
export function mapThemes(themes) {
  const set = new Set(String(themes || "").trim().split(/\s+/));
  for (const [theme, target] of THEME_MAP) if (set.has(theme)) return Object.assign({}, target);
  return null;
}

/** Parse the Lichess CSV (no quoting: none of the columns can contain a comma). */
export function parseCsv(text) {
  const lines = String(text).split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const head = lines[0].split(",");
  const start = head[0] === "PuzzleId" ? 1 : 0;
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const c = lines[i].split(",");
    if (c.length < 8) continue;
    rows.push({
      id: c[0], fen: c[1], moves: c[2].trim().split(/\s+/),
      rating: Number(c[3]), rd: Number(c[4]), popularity: Number(c[5]), plays: Number(c[6]),
      themes: c[7], url: c[8] || "", opening: c[9] || "",
    });
  }
  return rows;
}

const swapCase = (ch) => (ch === ch.toUpperCase() ? ch.toLowerCase() : ch.toUpperCase());

/**
 * Mirror the board top-to-bottom and swap the colours: the same position
 * seen from the other side. Rank r ↔ 9−r, White ↔ Black, castling rights
 * swap sides, the en-passant square moves with its pawn.
 */
export function mirrorFen(fen) {
  const p = fen.split(" ");
  const board = p[0].split("/").reverse()
    .map((rank) => rank.split("").map((ch) => (/[a-zA-Z]/.test(ch) ? swapCase(ch) : ch)).join(""))
    .join("/");
  const turn = p[1] === "w" ? "b" : "w";
  let castle = "-";
  if (p[2] && p[2] !== "-") {
    const sw = p[2].split("").map(swapCase);
    castle = ["K", "Q", "k", "q"].filter((c) => sw.includes(c)).join("") || "-";
  }
  const ep = p[3] && p[3] !== "-" ? p[3][0] + (9 - Number(p[3][1])) : "-";
  return [board, turn, castle, ep, p[4] || "0", p[5] || "1"].join(" ");
}

/** e2e4 → e7e5; a7a8q → a2a1q */
export function mirrorUci(uci) {
  const m = /^([a-h])([1-8])([a-h])([1-8])([qrbn]?)$/.exec(uci);
  if (!m) return uci;
  return m[1] + (9 - Number(m[2])) + m[3] + (9 - Number(m[4])) + m[5];
}

/**
 * From a Lichess row to a white-to-move position and a SAN solution.
 * @returns {{ok:true, fen:string, solution:string[], mirrored:boolean}|{ok:false, reason:string}}
 */
export function normalise(Chess, row) {
  if (!row.moves || row.moves.length < 2) return { ok: false, reason: "needs an opponent move and a solution" };
  const v = new Chess().validate_fen(row.fen);
  if (!v.valid) return { ok: false, reason: "invalid FEN: " + v.error };
  const g0 = new Chess(row.fen);
  if (!g0.move(uciMove(row.moves[0]))) return { ok: false, reason: "opponent move illegal: " + row.moves[0] };
  let fen = g0.fen();
  let ucis = row.moves.slice(1);
  const mirrored = g0.turn() === "b";
  if (mirrored) { fen = mirrorFen(fen); ucis = ucis.map(mirrorUci); }
  const g = new Chess(fen);
  const solution = [];
  for (const u of ucis) {
    const m = g.move(uciMove(u));
    if (!m) return { ok: false, reason: "solution move illegal: " + u };
    solution.push(m.san);
  }
  return { ok: true, fen, solution, mirrored };
}

function uciMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

/**
 * Build the stored entry for one row, or say why not.
 * @returns {{ok:true, puzzle:object}|{ok:false, reason:string, stage:string}}
 */
export function convert(Chess, row) {
  const target = mapThemes(row.themes);
  if (!target) return { ok: false, stage: "unmapped", reason: "no checkable theme" };
  const n = normalise(Chess, row);
  if (!n.ok) return { ok: false, stage: "normalise", reason: n.reason };
  const pos = positionGate(Chess, n.fen);
  if (!pos.ok) return { ok: false, stage: "gate", reason: pos.reason };
  const p = { id: "lc-" + row.id, cat: target.cat };
  if (target.motif) p.motif = target.motif;
  p.fen = n.fen;
  p.solution = n.solution;
  let r;
  switch (target.cat) {
    case "m1": r = mateGate(Chess, n.fen, n.solution, 1); break;
    case "m2": r = mateGate(Chess, n.fen, n.solution, 2); break;
    case "m3": r = mateGate(Chess, n.fen, n.solution, 3); break;
    case "tac": {
      r = swingGate(Chess, n.fen, n.solution, 1);
      if (r.ok) p.gain = Math.max(1, r.swing);
      break;
    }
    case "win": {
      const s = lineSwing(Chess, n.fen, n.solution);
      r = s.ok ? winGate(Chess, n.fen, n.solution, Math.max(1, s.swing)) : s;
      if (r.ok) p.gain = Math.max(1, s.swing);
      break;
    }
    case "def": {
      r = defGate(Chess, n.fen, n.solution);
      if (r.ok) p.saves = r.saves;
      break;
    }
    default: r = { ok: false, reason: "no gate for " + target.cat };
  }
  if (!r.ok) return { ok: false, stage: "gate", reason: r.reason };
  p.rating = row.rating;
  p.src = "lichess";
  p.url = row.url;
  return { ok: true, puzzle: p };
}

/** mulberry32: small, seedable, good enough to shuffle a puzzle list */
export function seededRng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const themeKey = (p) => p.cat + (p.motif ? "/" + p.motif : "");
export const bandOf = (rating) => Math.floor((Number(rating) || 0) / 200) * 200;

/**
 * Run the whole pipeline on parsed rows.
 * @param {Function} Chess
 * @param {object[]} rows from parseCsv
 * @param {{perTheme:number, perBand:number, max:number, seed:number}} opt
 * @returns {{puzzles:object[], stats:object}}
 */
export function runPipeline(Chess, rows, opt) {
  const perTheme = opt.perTheme || Infinity, perBand = opt.perBand || Infinity, max = opt.max || Infinity;
  const rng = seededRng(opt.seed == null ? 1 : opt.seed);
  const order = rows.slice();
  for (let i = order.length - 1; i > 0; i--) { // Fisher–Yates on the seeded rng
    const j = Math.floor(rng() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const stats = { rows: rows.length, unmapped: 0, quota: 0, rejected: {}, rejectedIds: {}, accepted: 0, byCat: {}, byTheme: {}, byBand: {} };
  const puzzles = [];
  const seen = new Set();
  for (const row of order) {
    if (puzzles.length >= max) break;
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const target = mapThemes(row.themes);
    if (!target) { stats.unmapped++; continue; }
    const tk = themeKey(target), band = bandOf(row.rating);
    if ((stats.byTheme[tk] || 0) >= perTheme || (stats.byBand[band] || 0) >= perBand) { stats.quota++; continue; }
    const c = convert(Chess, row);
    if (!c.ok) {
      if (c.stage === "unmapped") { stats.unmapped++; continue; }
      stats.rejected[c.reason] = (stats.rejected[c.reason] || 0) + 1;
      stats.rejectedIds[row.id] = c.reason;
      continue;
    }
    puzzles.push(c.puzzle);
    stats.accepted++;
    stats.byCat[c.puzzle.cat] = (stats.byCat[c.puzzle.cat] || 0) + 1;
    stats.byTheme[tk] = (stats.byTheme[tk] || 0) + 1;
    stats.byBand[band] = (stats.byBand[band] || 0) + 1;
  }
  // stable output: by category, then rating, then id — not by shuffle order
  const catRank = { m1: 0, m2: 1, m3: 2, tac: 3, win: 4, def: 5 };
  puzzles.sort((a, b) => (catRank[a.cat] - catRank[b.cat]) || (a.rating - b.rating) || (a.id < b.id ? -1 : 1));
  return { puzzles, stats };
}

/** The module text for puzzles-lichess.js. */
export function emit(puzzles, meta) {
  const head = [
    "/**",
    " * Puzzles sampled from the Lichess puzzle database — generated, do not edit.",
    " *",
    " * Source: https://database.lichess.org/#puzzles, released under CC0 1.0",
    " * (public domain dedication): the positions, solutions and ratings here",
    " * carry no licence obligation; `url` points back to the game each came from.",
    " * Every entry is white to move (black-to-move puzzles were mirrored, see",
    " * scripts/import-puzzles.mjs) and has passed scripts/lib/puzzle-gate.mjs,",
    " * the same proof scripts/test-chess.mjs applies to the hand-written set.",
    " *",
    " * " + (meta || "") ,
    " * @module puzzles-lichess",
    " */",
    "export const LICHESS_PUZZLES = [",
  ];
  const body = puzzles.map((p) => "  " + JSON.stringify(p).replace(/"([a-zA-Z_]+)":/g, "$1: ").replace(/,/g, ", ").replace(/\[ /g, "[") + ",");
  return head.concat(body, ["];", ""]).join("\n");
}

function parseArgs(argv) {
  const opt = { out: "src/web/js/puzzles-lichess.js", perTheme: 100, perBand: 50, max: 2000, seed: 1, csv: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--out") opt.out = next();
    else if (a === "--per-theme") opt.perTheme = Number(next());
    else if (a === "--per-band") opt.perBand = Number(next());
    else if (a === "--max") opt.max = Number(next());
    else if (a === "--seed") opt.seed = Number(next());
    else if (!a.startsWith("--")) opt.csv = a;
    else { console.error("unknown flag " + a); process.exit(2); }
  }
  return opt;
}

/** CLI entry — also usable from tests via `main(argv)`. */
export function main(argv) {
  const opt = parseArgs(argv);
  if (!opt.csv) {
    console.error("usage: node scripts/import-puzzles.mjs <lichess_db_puzzle.csv> [--out f] [--per-theme n] [--per-band n] [--max n] [--seed n]");
    process.exit(2);
  }
  const ctx = loadAppModules(["src/web/js/chess.js"]);
  const rows = parseCsv(fs.readFileSync(opt.csv, "utf8"));
  const { puzzles, stats } = runPipeline(ctx.Chess, rows, opt);
  const meta = "Sampled " + puzzles.length + " of " + rows.length + " rows: --per-theme " + opt.perTheme +
    " --per-band " + opt.perBand + " --max " + opt.max + " --seed " + opt.seed + ".";
  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, emit(puzzles, meta));
  console.log("rows " + stats.rows + ", unmapped " + stats.unmapped + ", over quota " + stats.quota +
    ", rejected " + Object.values(stats.rejected).reduce((n, x) => n + x, 0) + ", emitted " + puzzles.length + " → " + opt.out);
  for (const [k, n] of Object.entries(stats.byTheme)) console.log("  " + k.padEnd(16) + n);
  for (const [k, n] of Object.entries(stats.byBand).sort((a, b) => a[0] - b[0])) console.log("  band " + String(k).padEnd(11) + n);
  for (const [k, n] of Object.entries(stats.rejected)) console.log("  rejected: " + k + " × " + n);
  return { puzzles, stats };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main(process.argv.slice(2));
