/**
 * 本机对局 through the library's other doors (v8-1-plan T5): the diagnosis,
 * the PGN export and its way back in, and the time control.
 *
 * v8-0-plan C1 put the play history (the stats record's `games`) into the
 * library as `src: "local"` entries and left three things out, each written
 * down as a deviation there:
 *
 *   * the diagnosis read the imported games only — counting 本机 games in a
 *     statement about "your games elsewhere" would change what its numbers
 *     mean. So the diagnosis gets a source row instead, 导入的 by default:
 *     those numbers keep their meaning, and the other two are asked for;
 *   * 导出 PGN left them out, because a re-import would have made each an
 *     imported copy of itself. The export now writes `[LibId "loc:<record
 *     id>"]` and the record's own fields (`[LibRec]`), and the import puts
 *     such a game back into the play history — under its own id, never twice;
 *   * a history record kept no clock, so the speed filter could not find one.
 *     Records carry `tc` (app.js recordOutcome, PGN form: "300+3", "300",
 *     "-" for no clock).
 *
 * Pure, like library-query.js: records and entries in, plain values out, no
 * DOM and no store — scripts/test-library-local.mjs runs every rule in node.
 * Rides in chunk-libdb.js with the rest of the library page.
 * @module library-local
 */

/** The standard start, for a record whose PGN has no [FEN]. */
const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

/**
 * The diagnosis's source row: 导入的 (the default), 本机, 全部.
 * @param {string} src "import" | "local" | "all"
 * @param {object[]} imported the library's entries
 * @param {object[]} local the 本机 entries, with `an` from localAnalysis
 */
function diagGames(src, imported, local) {
  if (src === "local") return (local || []).slice();
  if (src === "all") return (imported || []).concat(local || []);
  return (imported || []).slice();
}

/**
 * What the diagnosis can read off a 本机 game — the shape library.js
 * foldGame reads off an analysed import: `{acc: {[side]}, tags, losses}`.
 *
 * The record holds the player's accuracy (review/analysis.js recordAccuracy)
 * and nothing per move; the move-by-move pass is on file only for the last
 * games analysed (analysis-store.js keeps 24). So every analysed game counts
 * with its result, accuracy and opening, and the phases, the mistake moves
 * and their chart read the ones whose pass is still kept — the note under
 * the source row says how many (diag.localNote). `losses` come back empty
 * here and are filled from the scalars by the caller's lossOf (library-ui.js
 * fillLosses), the one routine every other path uses.
 *
 * @param {object} e the 本机 entry (library-page.js localEntry)
 * @param {object} rec its stats record
 * @param {object|null} kept the stored pass of this line (analysis-store find), or null
 * @returns {object|null} the `an` to hang on the entry, or null: not analysed
 */
function localAnalysis(e, rec, kept) {
  const side = e && (e.side === "b" ? "b" : e.side === "w" ? "w" : null);
  if (!side || !rec) return null;
  // analysed = the record has its accuracy, as the history row says (hist.acc)
  if (!Number.isFinite(rec.acc)) return null;
  const an = { acc: { [side]: rec.acc }, tags: [], losses: [] };
  if (kept && Array.isArray(kept.tags) && Array.isArray(kept.scalars) && kept.scalars.length === kept.tags.length + 1) {
    an.tags = kept.tags.slice();
    an.scalars = kept.scalars.slice();
    an.losses = new Array(kept.tags.length).fill(null);
  }
  return an;
}

/** A record key the export carries: short, a word (no "__proto__"). */
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9]{0,15}$/;
/** The ids a record can have: newRecordId's. */
const ID_RE = /^[\w.-]{1,64}$/;
/**
 * PGN readers take a tag of ~4 KB (pgn-parser.js reads 4096 characters), and
 * this is the value as the tag writes it — every " and \ of the JSON escaped
 * again (library-query.js tagValue), which doubles a quote-heavy record.
 */
const REC_MAX = 3500;
/** The length of `s` once written as a PGN tag value (LibraryQuery tagValue). */
const tagLen = (s) => s.length + (s.match(/["\\]/g) || []).length;

/**
 * A 本机 game as one PGN game for 导出 PGN (v8-1-plan T5). The Seven Tag
 * Roster as the app's own export writes it (app.js pgnForExport), the time
 * control when the record has one, and the two tags that bring it back as
 * itself: `LibId` ("loc:" + the record's id — what the library files it
 * under), and `LibRec`, the record's own fields as JSON (not its PGN: that
 * is this game). The record's PGN headers, when it has any, ride in LibRec
 * as `h` so the round trip gives the same PGN back.
 *
 * @param {object} e the 本机 entry
 * @param {object} rec its stats record
 * @param {Array<[string,string]>} headers the record's PGN headers
 * @param {string} engine the engine's name for the other chair
 * @param {(g: object, extra: Array<[string,string]>) => string} entryPgn LibraryQuery.entryPgn
 */
function localPgn(e, rec, headers, engine, entryPgn) {
  const meta = {};
  for (const [k, v] of Object.entries(rec)) {
    if (k === "pgn" || !KEY_RE.test(k)) continue;
    if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) meta[k] = v;
  }
  if (headers && headers.length) meta.h = headers;
  let json = JSON.stringify(meta);
  // 8.1 M2 review P3: measured as written, escapes and all — the JSON's own
  // length let a record of quote-heavy headers past the reader's 4096
  if (tagLen(json) > REC_MAX) { delete meta.h; json = JSON.stringify(meta); }
  const me = "Player";
  const g = { id: e.id, event: "Casual game", site: "Chessboard", date: e.date || "????.??.??", round: "-",
    white: e.side === "b" ? engine : me, black: e.side === "b" ? me : engine, result: e.result,
    fen: e.fen, tc: typeof rec.tc === "string" ? rec.tc : "", sans: e.sans };
  return entryPgn(g, [["LibRec", json]]);
}

/**
 * The play-history record a 本机 game exported by localPgn stands for, or
 * null when it is not one (no `loc:` LibId, or a LibRec that does not hold
 * a record: wrong id, result or colour). What the file says is data, so
 * only flat fields come back — a string, a number, true / false or null
 * under a plain key — and the PGN is rebuilt from the game's own moves.
 *
 * @param {{headers: Array<[string,string]>, root: object, result: string}} game parsed
 * @param {(g: object) => string} serialize pgn-parser.js serializePgn
 * @returns {object|null}
 */
function recFromGame(game, serialize) {
  const tag = (k) => { const row = ((game && game.headers) || []).find(([key]) => key === k); return row ? row[1] : ""; };
  const m = /^loc:(.+)$/.exec(tag("LibId"));
  if (!m || !ID_RE.test(m[1])) return null;
  let meta = null;
  try { meta = JSON.parse(tag("LibRec")); } catch (_) { meta = null; }
  if (!meta || typeof meta !== "object" || Array.isArray(meta) || meta.id !== m[1]) return null;
  if (!["win", "loss", "draw"].includes(meta.result) || (meta.color !== "w" && meta.color !== "b") || !Number.isFinite(meta.t)) return null;
  const rec = {};
  for (const [k, v] of Object.entries(meta)) {
    if (k === "h" || k === "pgn" || !KEY_RE.test(k)) continue;
    if (v === null || typeof v === "string" || typeof v === "boolean" || (typeof v === "number" && Number.isFinite(v))) rec[k] = v;
  }
  const h = Array.isArray(meta.h) ? meta.h.filter((p) => Array.isArray(p) && p.length === 2 && typeof p[0] === "string" && typeof p[1] === "string" && KEY_RE.test(p[0]))
    : [];
  // a set-up start is in the headers the PGN was written with; say it again
  // if they did not come across
  if (game.root && game.root.fen !== START_FEN && !h.some(([k]) => k === "FEN")) h.push(["SetUp", "1"], ["FEN", game.root.fen]);
  const res = h.find(([k]) => k === "Result");
  rec.pgn = serialize({ headers: h, root: game.root, result: res ? res[1] : "*" });
  return rec;
}

/**
 * Records read back from an export, merged into the play history: one whose
 * id the history has is a duplicate and left alone; the rest go in by their
 * time, and the history keeps its newest `cap` (app.js recordOutcome).
 * `added` counts only the records the cap left in — 8.1 M2 review P3: a
 * record older than the 500 kept is gone again at once, and was reported
 * added.
 * @returns {{games: object[], added: number, dup: number, changed: boolean}}
 */
function mergeRecs(games, recs, cap) {
  const have = new Set((games || []).map((g) => g && g.id));
  const add = [];
  for (const rec of recs) { if (have.has(rec.id)) continue; have.add(rec.id); add.push(rec); }
  const dup = recs.length - add.length;
  if (!add.length) return { games: games || [], added: 0, dup, changed: false };
  const out = (games || []).concat(add).sort((a, b) => (a.t || 0) - (b.t || 0)).slice(-cap);
  const left = new Set(out.map((g) => g && g.id));
  return { games: out, added: add.filter((rec) => left.has(rec.id)).length, dup, changed: true };
}

export const LibraryLocal = { START_FEN, diagGames, localAnalysis, localPgn, recFromGame, mergeRecs };
