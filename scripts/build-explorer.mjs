/**
 * The built-in master move tree — v8-0-plan C3 step 2.
 *
 *   node scripts/build-explorer.mjs                     stream the default month
 *   node scripts/build-explorer.mjs --input dump.pgn.zst --games 20000
 *
 * Source: the Lichess standard rated game dumps at https://database.lichess.org/
 * (released under CC0 — "Use them for research, commercial purpose,
 * publication, anything you like"). A month is ~30 GB compressed, and a tree
 * of the first moves needs a small fraction of it, so the file is streamed
 * from the start (curl, or --input for a local copy) and the stream is cut
 * as soon as --games games qualify. Same pzstd framing as the puzzle dump
 * (import-puzzles.mjs pzstdFrames).
 *
 * A game qualifies when both players are rated ≥ --min-elo, the speed is one
 * of --speeds (the Event tag: "Rated Blitz game" …; bullet and ultrabullet are
 * left out — their openings are chosen for the clock), and the result is
 * decisive or drawn. Its first --plies plies are counted position by
 * position (explorer/core.js keys: ChessFide.positionKey, so transpositions
 * merge), then every move played in fewer than --min-games games is dropped
 * — a one-game move is one player's idea, and it is most of the bytes.
 *
 * Output (the parameters and the counts are in every file's header):
 *   src/web/js/explorer/masters-index.js   EXPLORER_MASTERS — params, the ply
 *                                          buckets, totals. Rides in the
 *                                          explorer's UI chunk.
 *   src/web/js/explorer/masters-NN.js      EXPLORER_MB_NN — one ply bucket:
 *                                          hashKey(position) → encodeRows.
 *                                          scripts/bundle.mjs builds each into
 *                                          chunk-xm-NN.js, loaded on demand.
 *   scripts/fixtures/explorer-sample.pgn   the first --sample qualifying games,
 *                                          trimmed to --plies: the raw data
 *                                          scripts/test-explorer.mjs re-counts.
 *   scripts/fixtures/explorer-audit.json   --audit positions drawn from the
 *                                          tree (seeded), each re-counted from
 *                                          the raw games by a naive loop that
 *                                          shares nothing with the tree code
 *                                          but chess.js; the test holds the
 *                                          shipped chunks to it.
 * @module build-explorer
 */
import fs from "fs";
import path from "path";
import readline from "readline";
import { spawn } from "child_process";
import zlib from "zlib";
import { fileURLToPath } from "url";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { pzstdFrames } from "./import-puzzles.mjs";

export const DEFAULTS = {
  month: "2026-08",
  minElo: 2200,
  speeds: ["Blitz", "Rapid", "Classical"],
  games: 100000,
  plies: 14,
  minGames: 3,
  bucketBytes: 1200000,
  sample: 400,
  audit: 40,
  seed: 1,
};

/** Load chess.js, the FIDE key and the explorer's own encoding. */
export function deps() {
  const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/fide.js", "src/web/js/explorer/core.js"]);
  return {
    Chess: ctx.Chess, X: ctx.ChessExplorer,
    keyOf: (pos) => ctx.ChessFide.positionKey(pos.fen(), pos),
  };
}

/** A game's movetext → SAN tokens (comments, move numbers, NAGs, marks and the result gone). */
export function sansOf(movetext) {
  return String(movetext).replace(/\{[^}]*\}/g, " ").replace(/\([^)]*\)/g, " ").split(/\s+/)
    .filter((t) => t && !/^\d+\.+$/.test(t) && !/^\$\d+$/.test(t) && !/^(1-0|0-1|1\/2-1\/2|\*)$/.test(t))
    .map((t) => t.replace(/^\d+\.+/, "").replace(/[?!]+$/, ""))
    .filter(Boolean);
}

/**
 * Stream PGN text line by line into games: `{tags, sans}` for each.
 * @param {AsyncIterable<string>} lines
 * @param {(g:{tags:object, sans:string[], text:string}) => boolean|void} onGame return false to stop
 */
export async function eachGame(lines, onGame) {
  let tags = {}, move = [], headerText = [];
  const flush = () => {
    if (!move.length) return true;
    const g = { tags, sans: sansOf(move.join(" ")), header: headerText };
    tags = {}; move = []; headerText = [];
    return onGame(g) !== false;
  };
  for await (const line of lines) {
    if (line.startsWith("[")) {
      if (move.length && !flush()) return;
      const m = /^\[(\w+)\s+"(.*)"\]/.exec(line);
      if (m) { tags[m[1]] = m[2]; headerText.push(line); }
    } else if (line.trim()) move.push(line);
  }
  flush();
}

/** Does this game go into the tree? */
export function qualifies(tags, opt) {
  const ev = /^Rated (\w+) (game|tournament)/.exec(tags.Event || "");
  if (!ev || !opt.speeds.includes(ev[1])) return false;
  if (!(Number(tags.WhiteElo) >= opt.minElo && Number(tags.BlackElo) >= opt.minElo)) return false;
  if (!["1-0", "0-1", "1/2-1/2"].includes(tags.Result)) return false;
  // an abandoned game or a rules infraction is not a game anyone chose to play out
  return !/Abandoned|Rules infraction/.test(tags.Termination || "");
}

/**
 * The counter: position key → { plies: Set of plies it was reached at,
 * moves: Map san → {n,w,d,b} }. One game counts once per position (the
 * first visit), as the library index does. Replayed on explorer/replay.js;
 * naiveCount below re-counts on chess.js, so the audit also holds the two
 * boards to the same keys on real games.
 */
export function createCounter(d, plies) {
  const pos = new Map();
  let games = 0;
  function add(sans, result) {
    const g = d.X.createReplay();
    const seen = new Set();
    const k = d.X.resultOf(result);
    for (let ply = 0; ply < plies && ply < sans.length; ply++) {
      const key = g.key();
      if (!seen.has(key)) {
        seen.add(key);
        let p = pos.get(key);
        if (!p) pos.set(key, (p = { plies: new Set(), moves: new Map() }));
        p.plies.add(ply);
        let r = p.moves.get(sans[ply]);
        if (!r) p.moves.set(sans[ply], (r = { san: sans[ply], n: 0, w: 0, d: 0, b: 0 }));
        r.n++;
        if (k) r[k]++;
      }
      if (!g.move(sans[ply])) break;
    }
    games++;
  }
  return { add, pos, games: () => games };
}

/**
 * Prune and bucket: moves under `minGames` go; positions left with no move
 * go; each kept position is written into the bucket of every ply it was
 * reached at. Buckets are consecutive ply ranges, grown until the next ply
 * would push one past `bucketBytes`.
 * @returns {{buckets: Array<[number,number]>, files: Array<object>, positions: number, moves: number}}
 */
export function packTree(d, counter, opt) {
  const byPly = Array.from({ length: opt.plies }, () => new Map());
  let positions = 0, moves = 0;
  for (const [key, p] of counter.pos) {
    const rows = d.X.sortRows([...p.moves.values()].filter((r) => r.n >= opt.minGames));
    if (!rows.length) continue;
    positions++;
    moves += rows.length;
    const enc = d.X.encodeRows(rows);
    const h = d.X.hashKey(key);
    for (const ply of p.plies) byPly[ply].set(h, enc);
  }
  const plyBytes = byPly.map((m) => [...m].reduce((n, [h, e]) => n + h.length + e.length + 6, 0));
  const buckets = [];
  let from = 0, bytes = 0;
  for (let ply = 0; ply < opt.plies; ply++) {
    if (ply > from && bytes + plyBytes[ply] > opt.bucketBytes) { buckets.push([from, ply - 1]); from = ply; bytes = 0; }
    bytes += plyBytes[ply];
  }
  buckets.push([from, opt.plies - 1]);
  const files = buckets.map(([a, b], i) => {
    const map = new Map();
    for (let ply = a; ply <= b; ply++) for (const [h, e] of byPly[ply]) map.set(h, e);
    return { i, range: [a, b], map };
  });
  return { buckets, files, positions, moves };
}

/** A small deterministic generator for the audit's draw. */
function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
}

/**
 * The naive re-count: for the positions in `keys`, walk every raw game from
 * the start and tally the move played the first time the game stands there.
 * No counter, no pruning, no hashing, no encoding — only chess.js.
 * @returns {Map<string, object>} key → { san: {n,w,d,b} }
 */
export function naiveCount(Chess, keyOf, games, keys, plies) {
  const out = new Map([...keys].map((k) => [k, {}]));
  // the key's en-passant test is the slow part of keyOf; a position whose
  // placement, side and castling match no audited key cannot match one
  const heads = new Set([...keys].map((k) => k.split(" ").slice(0, 3).join(" ")));
  for (const g of games) {
    const pos = new Chess();
    const seen = new Set();
    for (let ply = 0; ply < plies && ply < g.sans.length; ply++) {
      const key = heads.has(pos.fen().split(" ").slice(0, 3).join(" ")) ? keyOf(pos) : null;
      if (key && out.has(key) && !seen.has(key)) {
        seen.add(key);
        const by = out.get(key);
        const r = (by[g.sans[ply]] = by[g.sans[ply]] || { n: 0, w: 0, d: 0, b: 0 });
        r.n++;
        if (g.result === "1-0") r.w++; else if (g.result === "0-1") r.b++; else if (g.result === "1/2-1/2") r.d++;
      }
      if (!pos.move(g.sans[ply])) break;
    }
  }
  return out;
}

/** Open the input: a local .pgn / .pgn.zst, or the month's dump streamed through curl. */
function openInput(opt) {
  let raw, child = null;
  if (opt.input) raw = fs.createReadStream(opt.input);
  else {
    const url = "https://database.lichess.org/standard/lichess_db_standard_rated_" + opt.month + ".pgn.zst";
    child = spawn("curl", ["-sS", "-f", "--retry", "0", url], { stdio: ["ignore", "pipe", "inherit"] });
    raw = child.stdout;
    opt.url = url;
  }
  const zst = opt.input ? /\.zst$/i.test(opt.input) : true;
  const params = {};
  if (zlib.constants.ZSTD_d_windowLogMax != null) params[zlib.constants.ZSTD_d_windowLogMax] = 31;
  const text = zst ? raw.pipe(pzstdFrames(params)) : raw;
  raw.on("error", (e) => text.destroy(e));
  return { text, stop: () => { if (child) child.kill(); raw.destroy(); } };
}

function header(opt, stats) {
  return "/**\n * GENERATED by scripts/build-explorer.mjs — do not edit (v8-0-plan C3 step 2).\n" +
    " * Source: " + (opt.url || path.basename(opt.input || "")) + " (Lichess, CC0).\n" +
    " * Params: --month " + opt.month + " --min-elo " + opt.minElo + " --speeds " + opt.speeds.join(",") +
    " --games " + opt.games + " --plies " + opt.plies + " --min-games " + opt.minGames +
    " --bucket-bytes " + opt.bucketBytes + " --seed " + opt.seed + "\n" +
    " * Read " + stats.read + " games, counted " + stats.games + "; kept " + stats.positions + " positions, " + stats.moves + " moves.\n */\n";
}

function parseArgs(argv) {
  const opt = Object.assign({}, DEFAULTS, { input: null, outDir: path.join(ROOT, "src/web/js/explorer"), fixtures: path.join(ROOT, "scripts/fixtures") });
  const num = { "--min-elo": "minElo", "--games": "games", "--plies": "plies", "--min-games": "minGames",
    "--bucket-bytes": "bucketBytes", "--sample": "sample", "--audit": "audit", "--seed": "seed" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--input") opt.input = argv[++i];
    else if (a === "--raw") opt.raw = argv[++i];
    else if (a === "--save-raw") opt.saveRaw = argv[++i];
    else if (a === "--month") opt.month = argv[++i];
    else if (a === "--speeds") opt.speeds = argv[++i].split(",");
    else if (a === "--out-dir") opt.outDir = argv[++i];
    else if (a === "--fixtures") opt.fixtures = argv[++i];
    else if (num[a]) opt[num[a]] = Number(argv[++i]);
    else { console.error("unknown flag " + a); process.exit(2); }
  }
  return opt;
}

export async function main(argv) {
  const opt = parseArgs(argv);
  const d = deps();
  const counter = createCounter(d, opt.plies);
  const kept = []; // every qualifying game, trimmed: the audit's raw data
  const t0 = Date.now();
  let read = 0;
  const take = (header, sans, result) => {
    counter.add(sans, result);
    kept.push({ sans, result, header: kept.length < opt.sample ? header : null });
  };
  if (opt.raw) {
    // a --save-raw file: the qualifying games of an earlier run, one JSON line
    // each, so the tree can be re-packed with other pruning without a download
    const lines = fs.readFileSync(opt.raw, "utf8").split("\n").filter(Boolean);
    const meta = JSON.parse(lines[0]);
    Object.assign(opt, { month: meta.month, url: meta.url, minElo: meta.minElo, speeds: meta.speeds });
    read = meta.read;
    for (const l of lines.slice(1)) {
      if (counter.games() >= opt.games) break;
      const g = JSON.parse(l);
      take(g.h, g.s.split(" ").slice(0, opt.plies), g.r);
    }
  } else {
    const { text, stop } = openInput(opt);
    let failed = null;
    text.on("error", (e) => { failed = e; });
    const rl = readline.createInterface({ input: text, crlfDelay: Infinity });
    await eachGame(rl, (g) => {
      read++;
      if (read % 200000 === 0) console.log("  read " + read + ", kept " + counter.games() + " (" + ((Date.now() - t0) / 1000).toFixed(0) + " s)");
      if (!qualifies(g.tags, opt)) return true;
      take(g.header, g.sans.slice(0, opt.plies), g.tags.Result);
      return counter.games() < opt.games;
    });
    rl.close();
    stop();
    if (failed && counter.games() < opt.games) throw failed;
    if (opt.saveRaw) {
      fs.writeFileSync(opt.saveRaw, JSON.stringify({ month: opt.month, url: opt.url || opt.input, minElo: opt.minElo, speeds: opt.speeds, read }) + "\n" +
        kept.map((g) => JSON.stringify({ h: g.header, r: g.result, s: g.sans.join(" ") })).join("\n") + "\n");
    }
  }
  const t1 = Date.now();
  const packed = packTree(d, counter, opt);
  const stats = { read, games: counter.games(), positions: packed.positions, moves: packed.moves };
  const head = header(opt, stats);
  fs.mkdirSync(opt.outDir, { recursive: true });
  for (const f of fs.readdirSync(opt.outDir)) if (/^masters-\d\d\.js$/.test(f)) fs.unlinkSync(path.join(opt.outDir, f));
  let bytes = 0;
  const bucketBytes = [];
  for (const f of packed.files) {
    const nn = String(f.i).padStart(2, "0");
    const body = head + "export const EXPLORER_MB_" + nn + " = " + JSON.stringify(Object.fromEntries(f.map)) + ";\n";
    fs.writeFileSync(path.join(opt.outDir, "masters-" + nn + ".js"), body);
    bytes += Buffer.byteLength(body);
    bucketBytes.push(Buffer.byteLength(body));
  }
  const index = {
    source: "lichess_db_standard_rated_" + opt.month, licence: "CC0", minElo: opt.minElo, speeds: opt.speeds,
    plies: opt.plies, minGames: opt.minGames, games: stats.games, read, positions: stats.positions, moves: stats.moves,
    buckets: packed.buckets, bytes: bucketBytes,
  };
  fs.writeFileSync(path.join(opt.outDir, "masters-index.js"), head + "export const EXPLORER_MASTERS = " + JSON.stringify(index) + ";\n");
  // the raw sample, and the audit re-counted from every kept game
  fs.mkdirSync(opt.fixtures, { recursive: true });
  // the tags the filter reads, and Site to find the game again; the rest is weight
  const KEEP = /^\[(Event|Site|Result|WhiteElo|BlackElo|Termination) /;
  const pgn = kept.slice(0, opt.sample).map((g) => g.header.filter((l) => KEEP.test(l)).join("\n") + "\n\n" +
    g.sans.map((s, i) => (i % 2 ? "" : (i / 2 + 1) + ". ") + s).join(" ") + " " + g.result + "\n").join("\n");
  fs.writeFileSync(path.join(opt.fixtures, "explorer-sample.pgn"), pgn);
  const keys = [...counter.pos.keys()].filter((k) => [...counter.pos.get(k).moves.values()].some((r) => r.n >= opt.minGames));
  const rand = rng(opt.seed);
  const pick = new Set([keys[0]]); // the start position, always
  while (pick.size < Math.min(opt.audit, keys.length)) pick.add(keys[Math.floor(rand() * keys.length)]);
  const recount = naiveCount(d.Chess, d.keyOf, kept, pick, opt.plies);
  const audit = { params: index, positions: [...pick].map((key) => ({ key, ply: Math.min(...counter.pos.get(key).plies), moves: recount.get(key) })) };
  fs.writeFileSync(path.join(opt.fixtures, "explorer-audit.json"), JSON.stringify(audit, null, 1) + "\n");
  console.log("read " + read + " games, counted " + stats.games + " (≥" + opt.minElo + ", " + opt.speeds.join("/") + ") in " +
    ((t1 - t0) / 1000).toFixed(0) + " s; " + stats.positions + " positions, " + stats.moves + " moves, " +
    (bytes / 1024).toFixed(0) + " KB in " + packed.files.length + " buckets " + JSON.stringify(packed.buckets) +
    " [" + bucketBytes.map((b) => (b / 1024).toFixed(0)).join(", ") + " KB]; audit " + (Date.now() - t1) / 1000 + " s");
  return { stats, index };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
