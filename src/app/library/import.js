/**
 * PGN import (ADR 0003 「导入」, v20-0-plan §0): a file of games — one, many,
 * or 19.0's 「导出全部数据」 — read into `game.import` events, one a game.
 * The db projects each into the `library` table; the learner model folds it
 * like a game played here (learn/model.js: the game rating, when it is known
 * which side was yours and how strong the other was).
 *
 *   readGames(text, { name, have, pause, onProgress })
 *     → { games: [record], bad: [{ n, line, code, token }], dup, empty, skipped, kind, you }
 *       or throws ImportError { code } for a file that is not games at all
 *   importFile(text, { db, name, onProgress })   readGames + the events, in batches
 *
 * Pure apart from `pause` (it yields between slices so a large file never
 * holds the page: ~12 ms of work, then a macrotask). The text itself is the
 * 19.0 parser's job (src/web/js/pgn-parser.js: comments, variations, NAGs,
 * `0-0`, figurines, `[%clk]`; chess.js the judge of every move); only the
 * mainline is kept. Re-importing is the normal case: a game has the same id
 * every time (a hash of its start, moves and players), and one the library
 * has is counted, not added again.
 * @module library/import
 */
import { parsePgn, START_FEN } from "../../web/js/pgn-parser.js";
import { Opponents } from "../../web/js/opponents.js";

/** The most read from a file: 19.0's ALL_DATA_MAX (a PGN is never near it). */
export const IMPORT_MAX = 64 * 1024 * 1024;
/** Games per batch of events: one db write each, with a yield between. */
const BATCH = 100;
const SLICE_MS = 12;
const ELO_MIN = 100, ELO_MAX = 3500;
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2"]);
const LIB_SHARD = /^lib[0-3][0-9a-f]$/;

/** A file that holds no games: `code` names why (text/library.zh.js `imp.file.<code>`). */
export class ImportError extends Error {
  constructor(code, detail = "") { super(code + (detail ? ": " + detail : "")); this.name = "ImportError"; this.code = code; this.detail = detail; }
}

const defaultPause = () => new Promise((r) => setTimeout(r, 0));

/** FNV-1a, twice (two seeds): 16 hex digits, enough to tell a library's games apart. */
export function hashText(s) {
  let a = 0x811c9dc5, b = 0x9747b28c;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x01000193) ^ (b >>> 15);
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

const tag = (headers, k) => {
  const row = (headers || []).find(([key]) => key === k);
  const v = row ? String(row[1]).trim() : "";
  return v === "?" || v === "-" ? "" : v;
};
const elo = (v) => { const n = Number(v); return Number.isFinite(n) && n >= ELO_MIN && n <= ELO_MAX ? Math.round(n) : null; };

/**
 * Cut a file into chunks of games by its lines: a tag line after movetext
 * starts the next game. Braces are followed so a `[` inside a comment does
 * not cut. A chunk can still hold several games (no tags between them):
 * parsePgn reads them all. Yields between slices.
 * @returns {Promise<Array<{ text: string, line: number }>>} `line`: 1-based, where the chunk starts
 */
export async function splitChunks(text, { pause = defaultPause, now = () => Date.now() } = {}) {
  const lines = text.split("\n");
  const out = [];
  let start = 0, moves = false, inBrace = false, t0 = now();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lead = line.trimStart();
    if (!inBrace && lead[0] === "[") {
      if (moves) { out.push({ text: lines.slice(start, i).join("\n"), line: start + 1 }); start = i; moves = false; }
      continue;
    }
    if (!inBrace && (lead === "" || lead[0] === "%")) continue;
    moves = true;
    for (let j = 0; j < line.length; j++) {
      const c = line[j];
      if (inBrace) { if (c === "}") inBrace = false; }
      else if (c === "{") inBrace = true;
      else if (c === ";") break;
    }
    if ((i & 1023) === 1023 && now() - t0 > SLICE_MS) { await pause(); t0 = now(); }
  }
  const last = lines.slice(start).join("\n");
  if (last.trim()) out.push({ text: last, line: start + 1 });
  return out;
}

/** The parser's message → a code the page words, and the token it names. */
export function errorCode(err) {
  const m = String((err && err.message) || err);
  const tok = /illegal move "(.*?)"/.exec(m) || /\(token: "(.*?)"\)/.exec(m);
  const code = /illegal move/.test(m) ? "illegal" : /invalid FEN/.test(m) ? "fen"
    : /unterminated|unmatched|variation before/.test(m) ? "brackets" : /annotation before/.test(m) ? "annotation" : "syntax";
  return { code, token: tok ? tok[1].slice(0, 24) : "" };
}

/** The mainline of a parsed game (pgn-parser's tree): SANs up to a null move, and whether it stopped there. */
function mainline(root) {
  const sans = [];
  let n = root, cut = false;
  while (n.children.length) {
    n = n.children[0];
    if (!n.from) { cut = true; break; }   // a null move, or what follows one: no position to vouch for
    sans.push(n.san);
  }
  return { sans, cut };
}

/**
 * One parsed game → a library record, or null when it has no moves.
 * `meta`: what a 19.0 file knows besides the PGN ({ you, opp, result, source, playedAt }).
 */
export function recordOf(game, meta = {}) {
  const { sans, cut } = mainline(game.root);
  if (!sans.length) return null;
  const h = game.headers;
  const headerResult = tag(h, "Result");
  const result = RESULTS.has(meta.result) ? meta.result : RESULTS.has(game.result) ? game.result : RESULTS.has(headerResult) ? headerResult : "*";
  const rec = {
    white: tag(h, "White"), black: tag(h, "Black"), whiteElo: elo(tag(h, "WhiteElo")), blackElo: elo(tag(h, "BlackElo")),
    event: tag(h, "Event"), site: tag(h, "Site"), date: tag(h, "Date"), round: tag(h, "Round"), tc: tag(h, "TimeControl"),
    eco: tag(h, "ECO"), result, startFen: game.root.fen === START_FEN ? null : game.root.fen, sans: sans.join(" "), plies: sans.length,
    you: meta.you === "w" || meta.you === "b" ? meta.you : null, opp: Number.isFinite(meta.opp) ? meta.opp : null,
    source: meta.source || "pgn",
  };
  if (cut) rec.cut = true;
  if (Number.isFinite(meta.playedAt)) rec.playedAt = meta.playedAt;
  const players = rec.white || rec.black || rec.event ? [rec.white, rec.black, rec.date, rec.round, rec.event, rec.site].join("|") : "";
  rec.id = "imp:" + hashText((rec.startFen || "") + "|" + rec.sans + "|" + players);
  return rec;
}

/**
 * The player's own name, when the file says it: one name in at least half the
 * games (and in two or more). That side is "you" in those games.
 */
export function inferName(records) {
  const n = new Map();
  for (const r of records) for (const name of new Set([r.white, r.black])) if (name) n.set(name, (n.get(name) || 0) + 1);
  let best = null;
  for (const [name, c] of n) if (!best || c > best[1]) best = [name, c];
  return best && best[1] >= 2 && best[1] * 2 >= records.length ? best[0] : null;
}

// --- 19.0's 「导出全部数据」 ------------------------------------------------------------

/** Is `doc` 19.0's whole-profile export ({app: "chessboard", schema, keys})? */
export const isV19Export = (doc) => !!doc && typeof doc === "object" && doc.app === "chessboard" && !!doc.keys && typeof doc.keys === "object";

const parseKey = (v) => { if (typeof v !== "string") return null; try { return JSON.parse(v); } catch { return null; } };
const V19_RESULT = { win: { w: "1-0", b: "0-1" }, loss: { w: "0-1", b: "1-0" }, draw: { w: "1/2-1/2", b: "1/2-1/2" } };

/**
 * The games in a 19.0 export, as PGN texts with what the export knows beside
 * them: the play history (`stats.games`: your colour, the result, the rung —
 * rated games carry its rating), the library's shards (`lib00`…`lib3f`: the
 * side you were, when you claimed a name), and any save slot still there.
 * The current unfinished game, the repertoire, lessons, puzzles and
 * achievements are not games and do not come (v20-0-plan §0).
 */
export function v19Items(doc) {
  const items = [];
  const stats = parseKey(doc.keys.stats);
  for (const rec of (stats && Array.isArray(stats.games) ? stats.games : [])) {
    if (!rec || typeof rec.pgn !== "string") continue;
    const you = rec.color === "w" || rec.color === "b" ? rec.color : null;
    const opp = !rec.unrated && rec.diff ? Opponents.opponentOf(rec.diff, rec.lad) : null;
    items.push({ text: rec.pgn, meta: { source: "19.0-history", you, opp: opp ? opp.r : null,
      result: you && V19_RESULT[rec.result] ? V19_RESULT[rec.result][you] : null, playedAt: Number.isFinite(rec.t) ? rec.t : null } });
  }
  for (const [name, v] of Object.entries(doc.keys)) {
    if (!LIB_SHARD.test(name)) continue;
    const shard = parseKey(v);
    for (const e of (shard && Array.isArray(shard.games) ? shard.games : [])) {
      if (!e || typeof e.sans !== "string" || !e.sans.trim()) continue;
      const head = [["Event", e.event], ["Site", e.site], ["Date", e.date], ["Round", e.round], ["White", e.white], ["Black", e.black],
        ["Result", e.result || "*"], ["TimeControl", e.tc]].filter(([, x]) => typeof x === "string" && x);
      if (e.fen) head.push(["SetUp", "1"], ["FEN", e.fen]);
      const text = head.map(([k, x]) => "[" + k + " \"" + x.replace(/\\/g, "\\\\").replace(/"/g, "\\\"") + "\"]").join("\n") + "\n\n" + e.sans + " " + (e.result || "*");
      items.push({ text, meta: { source: "19.0-library", you: e.side === "w" || e.side === "b" ? e.side : null } });
    }
  }
  const slots = parseKey(doc.keys.slots);
  for (const s of (slots && Array.isArray(slots.slots) ? slots.slots : [])) {
    if (s && typeof s.pgn === "string") items.push({ text: s.pgn, meta: { source: "19.0-slot" } });
  }
  return items;
}

/**
 * A 19.0 PGN export of its own games writes `[LibId "loc:…"]` and the record
 * as `[LibRec "{json}"]` (library-local.js): your colour and the rung are in it.
 */
function libRecMeta(headers) {
  if (!/^loc:/.test(tag(headers, "LibId"))) return null;
  let rec = null;
  try { rec = JSON.parse(tag(headers, "LibRec")); } catch { return null; }
  if (!rec || typeof rec !== "object") return null;
  const you = rec.color === "w" || rec.color === "b" ? rec.color : null;
  const opp = !rec.unrated && rec.diff ? Opponents.opponentOf(rec.diff, rec.lad) : null;
  return { source: "19.0-history", you, opp: opp ? opp.r : null, result: you && V19_RESULT[rec.result] ? V19_RESULT[rec.result][you] : null,
    playedAt: Number.isFinite(rec.t) ? rec.t : null };
}

// --- reading a file -----------------------------------------------------------------

/**
 * @param {string} input the file's text
 * @param {{ have?: Set<string>, pause?: () => Promise<void>, now?: () => number,
 *           onProgress?: (done: number, total: number) => void }} [o]
 *        `have`: ids the library holds already (they count as duplicates)
 */
export async function readGames(input, { have = new Set(), pause = defaultPause, now = () => Date.now(), onProgress = () => {} } = {}) {
  const text = String(input == null ? "" : input).replace(/^﻿/, "").replace(/\r\n?/g, "\n");
  if (!text.trim()) throw new ImportError("empty");
  if (/\u0000/.test(text.slice(0, 4096))) throw new ImportError("binary");
  let items, kind = "pgn";
  const lead = text.trimStart()[0];
  if (lead === "{") {
    let doc = null;
    try { doc = JSON.parse(text); } catch { doc = null; }
    if (!doc) throw new ImportError("badJson");
    if (!isV19Export(doc)) throw new ImportError("notExport");
    kind = "v19";
    items = v19Items(doc).map((it, i) => ({ ...it, line: 0, item: i + 1 }));
    if (!items.length) throw new ImportError("v19NoGames");
  } else {
    items = (await splitChunks(text, { pause, now })).map((c) => ({ text: c.text, line: c.line, meta: null }));
  }

  const records = [], bad = [];
  let empty = 0, n = 0, t0 = now();
  for (let i = 0; i < items.length; i++) {
    const it = items[i];
    let games;
    try { games = parsePgn(it.text).games; }
    catch (e) {
      n++;
      const { code, token } = errorCode(e);
      bad.push({ n, line: it.line && e.line ? it.line + e.line - 1 : it.line || null, item: it.item || null, code, token });
      games = [];
    }
    for (const g of games) {
      n++;
      const rec = recordOf(g, it.meta || libRecMeta(g.headers) || {});
      if (rec) records.push(rec); else empty++;
    }
    if (now() - t0 > SLICE_MS) { onProgress(i + 1, items.length); await pause(); t0 = now(); }
  }
  onProgress(items.length, items.length);
  if (!records.length && !bad.length && !empty) throw new ImportError("noGames");
  if (!records.length && bad.length && bad.length === n && kind === "pgn" && !/\[\s*\w+\s+"/.test(text.slice(0, 2000)) && !/\b1\s*\.\s*\S/.test(text.slice(0, 2000))) {
    throw new ImportError("noGames");
  }

  // whose games: the name in at least half of them, where the file did not say
  const you = inferName(records.filter((r) => !r.you));
  for (const r of records) {
    if (r.you || !you) continue;
    r.you = r.white === you ? "w" : r.black === you ? "b" : null;
  }
  for (const r of records) {
    if (r.opp == null && r.you) r.opp = r.you === "w" ? r.blackElo : r.whiteElo;
  }

  const seen = new Set(have), games = [];
  let dup = 0;
  for (const r of records) { if (seen.has(r.id)) { dup++; continue; } seen.add(r.id); games.push(r); }
  return { kind, games, bad, dup, empty, total: n, you };
}

/**
 * Read `text` and append one `game.import` event per new game (and one
 * `import.file` for the file), in batches with a yield between, so ten
 * thousand games never hold the page.
 * @returns {Promise<object>} readGames' answer, `added` set
 */
export async function importFile(text, { db, name = "", pause = defaultPause, onProgress = () => {} }) {
  const have = new Set(await db.query("library.ids"));
  const r = await readGames(text, { have, pause, onProgress: (d, t) => onProgress("read", d, t) });
  for (let i = 0; i < r.games.length; i += BATCH) {
    const part = r.games.slice(i, i + BATCH);
    await Promise.all(part.map(({ id, ...rec }) => db.append({ type: "game.import", gameId: id, ...rec })));
    onProgress("save", Math.min(i + BATCH, r.games.length), r.games.length);
    if (i + BATCH < r.games.length) await pause();
  }
  await db.append({ type: "import.file", name: String(name).slice(0, 200), kind: r.kind, added: r.games.length, dup: r.dup,
    bad: r.bad.length, empty: r.empty, you: r.you || null });
  return { ...r, added: r.games.length };
}
