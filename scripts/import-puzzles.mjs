/**
 * Lichess puzzle importer — Q3.2 of docs/v6-plan.md, grown to v8-0-plan B1.
 *
 *   node scripts/import-puzzles.mjs lichess_db_puzzle.csv.zst
 *   node scripts/import-puzzles.mjs lichess_db_puzzle.csv --max 40000 --seed 1
 *
 * Input is the database from https://database.lichess.org/#puzzles (CC0), as
 * downloaded (.csv.zst — Node's own zlib decompresses it, streaming) or
 * already decompressed (.csv). It is streamed once; nothing but the selected
 * candidates is held in memory, and the raw file is never committed. Columns:
 *   PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags
 *
 * Output (default --out-dir src/web/js):
 *   puzzles-lc-index.js   LC_INDEX — per band: file, global, count, rating
 *                         range; per theme: count, and count per band. This
 *                         is all the main bundle carries (puzzle-db.js).
 *   lichess/band-NNNN.js  LC_BAND_NNNN — one 200-point rating band each, built
 *                         by scripts/bundle.mjs into chunk-lc-NNNN.js and
 *                         loaded on demand (chunk.js), never in the bundle.
 *
 * What happens to each row, in order, and why:
 *
 *   1. cheap filters while streaming: rating in [--min-rating, --max-rating),
 *      popularity ≥ --min-popularity, plays ≥ --min-plays, RD ≤ --max-rd, and
 *      a category this app can grade (categoryOf: THEME_MAP, or a Lichess
 *      "crushing"/"advantage" line that the material gate can prove).
 *   2. stratification: each row is counted in one cell, (its rarest
 *      checkable theme × its band) — lib/puzzle-themes.mjs THEMES order —
 *      and each cell keeps only its --pool best rows by quality (popularity,
 *      then order of magnitude of plays, then a seeded tie-break).
 *   3. the first move in `Moves` is the OPPONENT's — Lichess stores the
 *      position before it. It is played to get the puzzle position; the rest
 *      is the solution, turned into canonical SAN by chess.js.
 *   4. the solver keeps its side (v8-0-plan B1). Until v8-0-plan B1 a black-to-move
 *      puzzle was mirrored to White; now it is stored as Lichess has it with
 *      `side: "b"`, and the app turns the board (app.js puzzleModel reads
 *      `side`, as it has for black opening drills and mined mistakes).
 *      --mirror restores the old behaviour; mine-puzzles.mjs relies on it.
 *   5. the repo's gate (scripts/lib/puzzle-gate.mjs), the same functions the
 *      test suite runs on hand-written puzzles — on the mirror when Black is
 *      to move, which proves exactly the same facts. A Lichess "mateIn2"
 *      that has a mate in one, or a "fork" whose line does not win material
 *      by this app's one-ply rule, is rejected here rather than shipped.
 *   6. themes: every checkable Lichess tag is checked (puzzle-themes.mjs)
 *      and kept only if it holds; the tag that put the row in its cell must
 *      hold, or the row is rejected — a cell called "smothered" holds only
 *      smothered mates.
 *   7. selection: cells are visited round-robin (in a seeded order), each
 *      giving its next-best row, until --max are accepted; a thin cell
 *      simply runs out, and the rest keep filling. --per-cell caps a cell.
 *
 * Exported pieces are what scripts/test-learning.mjs exercises on the
 * fixture; the CLI at the bottom is a thin wrapper.
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import {
  positionGate, mateGate, swingGate, winGate, defGate, lineSwing, mirrorFen, mirrorUci, mirrorLine,
} from "./lib/puzzle-gate.mjs";
import { THEMES, checkableTags, themeContext, verifyThemes } from "./lib/puzzle-themes.mjs";

export { mirrorFen, mirrorUci };

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
  // scripts/mine-puzzles.mjs's label for a line that simply wins material
  // without a named motif: still a tactic, proven by the same swing gate,
  // shown without a motif label. Not a Lichess theme — a Lichess "crushing"
  // row stays unmapped here (categoryOf below decides what to do with it).
  ["material", { cat: "tac" }],
];

/** @returns {{cat:string, motif?:string}|null} */
export function mapThemes(themes) {
  const set = new Set(String(themes || "").trim().split(/\s+/));
  for (const [theme, target] of THEME_MAP) if (set.has(theme)) return Object.assign({}, target);
  return null;
}

/**
 * The category a Lichess row is graded in. THEME_MAP first; then, for the
 * bulk of the database — lines Lichess calls "crushing" or "advantage"
 * without a named motif — `tac`, whose gate proves the line wins material.
 * A "crushing" row that wins nothing countable fails that gate, as it
 * should. Mates longer than three and "equality" rows have no gate here.
 * @returns {{cat:string, motif?:string}|null}
 */
export function categoryOf(themes) {
  const t = mapThemes(themes);
  if (t) return t;
  const set = new Set(String(themes || "").trim().split(/\s+/));
  if (set.has("mate")) return null; // mateIn4+ — no exhaustive gate that deep
  if (set.has("crushing") || set.has("advantage")) return { cat: "tac" };
  return null;
}

/** One CSV line → a row, or null (no quoting: no column can contain a comma). */
export function parseLine(line) {
  const c = String(line).split(",");
  if (c.length < 8 || c[0] === "PuzzleId") return null;
  return {
    id: c[0], fen: c[1], moves: c[2].trim().split(/\s+/),
    rating: Number(c[3]), rd: Number(c[4]), popularity: Number(c[5]), plays: Number(c[6]),
    themes: c[7], url: c[8] || "", opening: (c[9] || "").trim(),
  };
}

/** Parse the Lichess CSV text. */
export function parseCsv(text) {
  const rows = [];
  for (const l of String(text).split(/\r?\n/)) {
    if (!l.trim()) continue;
    const r = parseLine(l);
    if (r) rows.push(r);
  }
  return rows;
}

/**
 * Stream a .csv or .csv.zst from disk, one parsed row at a time. Node's zlib
 * reads zstd natively (no dependency); the window limit is raised because
 * Lichess compresses with long-distance matching on some exports.
 * @param {string} file
 * @param {(row:object) => void} onRow
 * @returns {Promise<number>} lines read
 */
export async function streamRows(file, onRow) {
  let input = fs.createReadStream(file);
  if (/\.zst$/i.test(file)) {
    if (typeof zlib.createZstdDecompress !== "function") throw new Error("this Node has no zstd — decompress with `zstd -d` and pass the .csv");
    const params = {};
    if (zlib.constants.ZSTD_d_windowLogMax != null) params[zlib.constants.ZSTD_d_windowLogMax] = 31;
    input = input.pipe(zlib.createZstdDecompress({ params }));
  }
  const rl = readline.createInterface({ input, crlfDelay: Infinity });
  let n = 0;
  for await (const line of rl) {
    n++;
    const r = parseLine(line);
    if (r) onRow(r);
  }
  return n;
}

function uciMove(uci) {
  return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined };
}

/**
 * From a Lichess row to the puzzle position and a SAN solution.
 * @param {{mirror?:boolean}} [opt] mirror: put the solver on White (the 6.0–7.9 behaviour)
 * @returns {{ok:true, fen:string, solution:string[], side:"w"|"b", mirrored:boolean}|{ok:false, reason:string}}
 */
export function normalise(Chess, row, opt) {
  if (!row.moves || row.moves.length < 2) return { ok: false, reason: "needs an opponent move and a solution" };
  const v = new Chess().validate_fen(row.fen);
  if (!v.valid) return { ok: false, reason: "invalid FEN: " + v.error };
  const g0 = new Chess(row.fen);
  if (!g0.move(uciMove(row.moves[0]))) return { ok: false, reason: "opponent move illegal: " + row.moves[0] };
  let fen = g0.fen();
  let ucis = row.moves.slice(1);
  const mirrored = !!(opt && opt.mirror) && g0.turn() === "b";
  if (mirrored) { fen = mirrorFen(fen); ucis = ucis.map(mirrorUci); }
  const g = new Chess(fen);
  const solution = [];
  for (const u of ucis) {
    const m = g.move(uciMove(u));
    if (!m) return { ok: false, reason: "solution move illegal: " + u };
    solution.push(m.san);
  }
  return { ok: true, fen, solution, side: fen.split(" ")[1] === "b" ? "b" : "w", mirrored };
}

/**
 * Build the stored entry for one row, or say why not.
 * @param {{mirror?:boolean, motifOf?:Function}} [opt] with `motifOf`, the
 *        row's tags are checked (puzzle-themes.mjs) and `themes` is set; the
 *        cell tag (the row's first checkable tag) must hold
 * @returns {{ok:true, puzzle:object}|{ok:false, reason:string, stage:string}}
 */
export function convert(Chess, row, opt) {
  const target = opt && opt.motifOf ? categoryOf(row.themes) : mapThemes(row.themes);
  if (!target) return { ok: false, stage: "unmapped", reason: "no checkable theme" };
  const n = normalise(Chess, row, opt);
  if (!n.ok) return { ok: false, stage: "normalise", reason: n.reason };
  // the gates are written for White; a black puzzle is proved on its mirror
  const w = n.side === "b" ? mirrorLine(Chess, n.fen, n.solution) : { fen: n.fen, solution: n.solution };
  if (!w) return { ok: false, stage: "normalise", reason: "mirror failed" };
  const pos = positionGate(Chess, w.fen);
  if (!pos.ok) return { ok: false, stage: "gate", reason: pos.reason };
  const p = { id: "lc-" + row.id, cat: target.cat };
  if (target.motif) p.motif = target.motif;
  p.fen = n.fen;
  p.solution = n.solution;
  let r;
  switch (target.cat) {
    case "m1": r = mateGate(Chess, w.fen, w.solution, 1); break;
    case "m2": r = mateGate(Chess, w.fen, w.solution, 2); break;
    case "m3": r = mateGate(Chess, w.fen, w.solution, 3); break;
    case "tac": {
      r = swingGate(Chess, w.fen, w.solution, 1);
      if (r.ok) p.gain = Math.max(1, r.swing);
      break;
    }
    case "win": {
      const s = lineSwing(Chess, w.fen, w.solution);
      r = s.ok ? winGate(Chess, w.fen, w.solution, Math.max(1, s.swing)) : s;
      if (r.ok) p.gain = Math.max(1, s.swing);
      break;
    }
    case "def": {
      r = defGate(Chess, w.fen, w.solution);
      if (r.ok) p.saves = r.saves;
      break;
    }
    default: r = { ok: false, reason: "no gate for " + target.cat };
  }
  if (!r.ok) return { ok: false, stage: "gate", reason: r.reason };
  if (opt && opt.motifOf) {
    const ctx = themeContext(Chess, n.fen, n.solution);
    const v = verifyThemes(ctx, row.themes, opt.motifOf, target.cat);
    const cell = checkableTags(row.themes)[0];
    if (!cell) return { ok: false, stage: "theme", reason: "no checkable theme tag" };
    if (!v.kept.includes(cell.tag)) return { ok: false, stage: "theme", reason: "claimed " + cell.tag + " does not hold" };
    p.themes = v.ids;
    // the motif label is a claim too: only a motif that was verified, and of
    // those the one motif.js names on the solver's earliest move — not the
    // rarest (review of PR #87: a verified fork lost the label to a rarer tag)
    const motifs = ["fork", "pin", "skewer", "discovered", "double"];
    if (p.cat === "tac") {
      const named = ctx.plies.filter((q) => q.solver).map((q) => opt.motifOf(q.before, q.m.san, Chess));
      const m = named.find((k) => motifs.includes(k) && v.ids.includes(k)) || v.ids.find((id) => motifs.includes(id));
      if (m) {
        p.motif = m;
        // puzzle-db.js decodeRow labels a row with its first motif theme: the
        // label goes first among them, every other theme stays where it was
        const order = [m].concat(v.ids.filter((id) => motifs.includes(id) && id !== m));
        let k = 0;
        p.themes = v.ids.map((id) => (motifs.includes(id) ? order[k++] : id));
      } else delete p.motif;
    }
    p.dropped = v.dropped;
  }
  if (n.side === "b") p.side = "b";
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
 * The 6.0 pipeline, kept for scripts/mine-puzzles.mjs: a seeded shuffle,
 * then --per-theme / --per-band / --max quotas in shuffle order.
 * @param {Function} Chess
 * @param {object[]} rows from parseCsv
 * @param {{perTheme:number, perBand:number, max:number, seed:number, mirror?:boolean}} opt
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
    const c = convert(Chess, row, { mirror: !!opt.mirror });
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

// --- the stratified import (v8-0-plan B1) --------------------------------

/** Defaults for the full database: ~40k puzzles over 600–2799 in 11 bands. */
export const DEFAULTS = {
  max: 40000, perCell: Infinity, pool: 1500, seed: 1,
  minRating: 600, maxRating: 2800, minPopularity: 80, minPlays: 100, maxRd: 90,
};

/** The cell a row is counted in: its rarest checkable tag's id × its band. */
export function cellOf(row) {
  const t = checkableTags(row.themes)[0];
  return t ? t.id + "@" + bandOf(row.rating) : null;
}

/** Does a row pass the cheap filters (step 1)? */
export function admissible(row, opt) {
  const o = Object.assign({}, DEFAULTS, opt);
  return row.rating >= o.minRating && row.rating < o.maxRating &&
    row.popularity >= o.minPopularity && row.plays >= o.minPlays && row.rd <= o.maxRd &&
    row.moves.length >= 2 && !!categoryOf(row.themes) && !!cellOf(row);
}

/** 32-bit string hash, seeded: the tie-break between equally good rows */
function hash32(s, seed) {
  let h = (seed >>> 0) ^ 0x9E3779B9;
  for (let i = 0; i < s.length; i++) { h = Math.imul(h ^ s.charCodeAt(i), 0x01000193); }
  return h >>> 0;
}

/** Higher is better: popularity, then the order of magnitude of plays, then a seeded hash. */
export function qualityKey(row, seed) {
  return [row.popularity, Math.floor(Math.log2((row.plays || 0) + 1)), hash32(row.id, seed)];
}
const byQuality = (seed) => (a, b) => {
  const ka = qualityKey(a, seed), kb = qualityKey(b, seed);
  return (kb[0] - ka[0]) || (kb[1] - ka[1]) || (kb[2] - ka[2]);
};

/**
 * Candidate pools per cell, bounded while streaming: each cell keeps its
 * `pool` best rows. Rows are only compared, never gated, here — the gate is
 * the expensive part and runs on the survivors.
 */
export function createPools(opt) {
  const o = Object.assign({}, DEFAULTS, opt);
  const cells = new Map();
  const cmp = byQuality(o.seed);
  const seen = new Set();
  let admitted = 0;
  return {
    add(row) {
      if (!admissible(row, o) || seen.has(row.id)) return;
      seen.add(row.id);
      admitted++;
      const k = cellOf(row);
      let list = cells.get(k);
      if (!list) cells.set(k, (list = []));
      list.push(row);
      if (list.length >= o.pool * 2) { list.sort(cmp); list.length = o.pool; }
    },
    /** @returns {Map<string, object[]>} each cell sorted best first, at most `pool` */
    done() {
      for (const list of cells.values()) { list.sort(cmp); if (list.length > o.pool) list.length = o.pool; }
      return cells;
    },
    get admitted() { return admitted; },
  };
}

/**
 * Steps 3–7 on the pooled candidates.
 * @param {Function} Chess
 * @param {Map<string, object[]>} cells from createPools().done()
 * @param {Function} motifOf motif.js
 * @param {object} opt DEFAULTS overrides
 * @returns {{puzzles:object[], stats:object}}
 */
export function selectPuzzles(Chess, cells, motifOf, opt) {
  const o = Object.assign({}, DEFAULTS, opt);
  const rng = seededRng(o.seed);
  const keys = [...cells.keys()].sort();
  for (let i = keys.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [keys[i], keys[j]] = [keys[j], keys[i]]; }
  const at = new Map(keys.map((k) => [k, 0]));
  const taken = new Map(keys.map((k) => [k, 0]));
  const stats = { candidates: 0, tried: 0, accepted: 0, rejected: {}, rejectedIds: {}, byStage: {}, byCell: {}, byBand: {}, byTheme: {}, byCat: {}, sides: { w: 0, b: 0 }, dropped: {} };
  for (const list of cells.values()) stats.candidates += list.length;
  const puzzles = [];
  let live = keys.slice();
  while (live.length && puzzles.length < o.max) {
    const next = [];
    for (const k of live) {
      if (puzzles.length >= o.max) break;
      const list = cells.get(k);
      let got = false;
      while (at.get(k) < list.length && !got) {
        const row = list[at.get(k)];
        at.set(k, at.get(k) + 1);
        stats.tried++;
        const c = convert(Chess, row, { motifOf });
        if (!c.ok) {
          stats.byStage[c.stage] = (stats.byStage[c.stage] || 0) + 1;
          stats.rejected[c.reason] = (stats.rejected[c.reason] || 0) + 1;
          stats.rejectedIds[row.id] = c.reason;
          continue;
        }
        got = true;
        const p = c.puzzle;
        for (const t of p.dropped) stats.dropped[t] = (stats.dropped[t] || 0) + 1;
        delete p.dropped;
        puzzles.push(p);
        stats.accepted++;
        taken.set(k, taken.get(k) + 1);
        stats.byCell[k] = taken.get(k);
        const b = bandOf(p.rating);
        stats.byBand[b] = (stats.byBand[b] || 0) + 1;
        stats.byCat[p.cat] = (stats.byCat[p.cat] || 0) + 1;
        stats.sides[p.side === "b" ? "b" : "w"]++;
        for (const t of p.themes) stats.byTheme[t] = (stats.byTheme[t] || 0) + 1;
      }
      if (at.get(k) < list.length && taken.get(k) < o.perCell) next.push(k);
    }
    live = next;
  }
  puzzles.sort((a, b) => (a.rating - b.rating) || (a.id < b.id ? -1 : 1));
  return { puzzles, stats };
}

/** Band → the zero-padded name the files and globals use: 600 → "0600". */
export const bandName = (band) => String(band).padStart(4, "0");

/**
 * One stored puzzle as a compact row — the shape src/web/js/puzzle-db.js
 * decodes: [id, fen, "san san …", rating, cat, "theme theme …", n], where
 * n is `gain` (tac/win) or `saves` (def), else 0. `side` and `motif` are
 * derived on decode (from the FEN and the themes), `url` is dropped: the id
 * is the Lichess puzzle id, lichess.org/training/<id>.
 */
export function encodeRow(p) {
  return [p.id.replace(/^lc-/, ""), p.fen, p.solution.join(" "), p.rating, p.cat, (p.themes || []).join(" "), p.gain || p.saves || 0];
}

const HEADER = (what) => [
  "/**",
  " * " + what + " — generated by scripts/import-puzzles.mjs, do not edit.",
  " *",
  " * Source: https://database.lichess.org/#puzzles, released under CC0 1.0",
  " * (public domain dedication): the positions, solutions and ratings here",
  " * carry no licence obligation; each id is the Lichess puzzle id",
  " * (lichess.org/training/<id>). Every entry keeps the side Lichess gave it",
  " * and has passed scripts/lib/puzzle-gate.mjs; every theme listed was",
  " * checked on the line (scripts/lib/puzzle-themes.mjs).",
  " *",
];

/** The module text for one band. */
export function emitBand(band, puzzles) {
  const name = "LC_BAND_" + bandName(band);
  const head = HEADER("Lichess puzzles rated " + band + "–" + (band + 199)).concat([
    " * " + puzzles.length + " puzzles. Row shape: see puzzle-db.js decodeRow.",
    " * @module lichess/band-" + bandName(band),
    " */",
    "export const " + name + " = [",
  ]);
  const body = puzzles.map((p) => JSON.stringify(encodeRow(p)) + ",");
  return head.concat(body, ["];", ""]).join("\n");
}

/** The index the main bundle carries: counts and ranges, no puzzles. */
export function buildIndex(puzzles) {
  const bands = [...new Set(puzzles.map((p) => bandOf(p.rating)))].sort((a, b) => a - b);
  const index = { total: puzzles.length, sides: { w: 0, b: 0 }, bands: [], themes: {} };
  for (const b of bands) {
    const inBand = puzzles.filter((p) => bandOf(p.rating) === b);
    index.bands.push({ band: b, n: inBand.length, lo: Math.min(...inBand.map((p) => p.rating)), hi: Math.max(...inBand.map((p) => p.rating)) });
  }
  for (const t of THEMES) {
    const withT = puzzles.filter((p) => (p.themes || []).includes(t.id));
    if (withT.length) index.themes[t.id] = { n: withT.length, bands: bands.map((b) => withT.filter((p) => bandOf(p.rating) === b).length) };
  }
  for (const p of puzzles) index.sides[p.side === "b" ? "b" : "w"]++;
  return index;
}

/** The module text for puzzles-lc-index.js. */
export function emitIndex(index, meta) {
  return HEADER("Index of the imported Lichess puzzles").concat([
    " * Only counts live here — the puzzles are in lichess/band-*.js, one lazy",
    " * chunk per band (scripts/bundle.mjs lichessChunks). " + (meta || ""),
    " * @module puzzles-lc-index",
    " */",
    "export const LC_INDEX = " + JSON.stringify(index) + ";",
    "",
  ]).join("\n");
}

/** Write the index and the band files; stale band files are removed. */
export function writeOutput(outDir, puzzles, meta) {
  const dir = path.join(outDir, "lichess");
  fs.mkdirSync(dir, { recursive: true });
  for (const f of fs.readdirSync(dir)) if (/^band-\d{4}\.js$/.test(f)) fs.rmSync(path.join(dir, f));
  const index = buildIndex(puzzles);
  const files = [];
  for (const b of index.bands) {
    const f = path.join(dir, "band-" + bandName(b.band) + ".js");
    fs.writeFileSync(f, emitBand(b.band, puzzles.filter((p) => bandOf(p.rating) === b.band)));
    files.push(f);
  }
  const idx = path.join(outDir, "puzzles-lc-index.js");
  fs.writeFileSync(idx, emitIndex(index, meta));
  return { index, files: files.concat([idx]) };
}

function parseArgs(argv) {
  const opt = Object.assign({}, DEFAULTS, { outDir: path.join(ROOT, "src/web/js"), input: null });
  const num = { "--max": "max", "--per-cell": "perCell", "--pool": "pool", "--seed": "seed", "--min-rating": "minRating",
    "--max-rating": "maxRating", "--min-popularity": "minPopularity", "--min-plays": "minPlays", "--max-rd": "maxRd" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out-dir") opt.outDir = argv[++i];
    else if (num[a]) opt[num[a]] = Number(argv[++i]);
    else if (!a.startsWith("--")) opt.input = a;
    else { console.error("unknown flag " + a); process.exit(2); }
  }
  return opt;
}

/** CLI entry — also usable from tests via `main(argv)`. */
export async function main(argv) {
  const opt = parseArgs(argv);
  if (!opt.input) {
    console.error("usage: node scripts/import-puzzles.mjs <lichess_db_puzzle.csv[.zst]> [--out-dir d] [--max n] [--per-cell n]\n" +
      "       [--pool n] [--seed n] [--min-rating n] [--max-rating n] [--min-popularity n] [--min-plays n] [--max-rd n]");
    process.exit(2);
  }
  const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/motif.js"]);
  const t0 = Date.now();
  const pools = createPools(opt);
  const lines = await streamRows(opt.input, (r) => pools.add(r));
  const cells = pools.done();
  const t1 = Date.now();
  const { puzzles, stats } = selectPuzzles(ctx.Chess, cells, ctx.motifOf, opt);
  const t2 = Date.now();
  const meta = "Selected " + puzzles.length + " of " + lines + " rows (" + pools.admitted + " admissible): --max " + opt.max +
    " --pool " + opt.pool + " --seed " + opt.seed + " --min-rating " + opt.minRating + " --max-rating " + opt.maxRating +
    " --min-popularity " + opt.minPopularity + " --min-plays " + opt.minPlays + " --max-rd " + opt.maxRd + ".";
  const out = writeOutput(opt.outDir, puzzles, meta);
  const bytes = out.files.reduce((n, f) => n + fs.statSync(f).size, 0);
  console.log("lines " + lines + ", admissible " + pools.admitted + ", pooled " + stats.candidates + ", gated " + stats.tried +
    ", accepted " + puzzles.length + " (w " + stats.sides.w + " / b " + stats.sides.b + ") → " + opt.outDir +
    " [" + (bytes / 1024).toFixed(0) + " KB, stream " + ((t1 - t0) / 1000).toFixed(1) + " s, gate " + ((t2 - t1) / 1000).toFixed(1) + " s]");
  for (const b of out.index.bands) console.log("  band " + String(b.band).padEnd(6) + String(b.n).padStart(6));
  for (const [k, n] of Object.entries(stats.byTheme).sort((a, b) => b[1] - a[1])) console.log("  theme " + k.padEnd(16) + String(n).padStart(6));
  for (const [k, n] of Object.entries(stats.byStage)) console.log("  rejected at " + k + ": " + n);
  for (const [k, n] of Object.entries(stats.dropped).sort((a, b) => b[1] - a[1])) console.log("  tag dropped (check failed): " + k + " × " + n);
  return { puzzles, stats, index: out.index };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
