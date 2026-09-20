/**
 * Opening recognition by position, over the full ECO table in eco.js.
 *
 * openings.js matches a SAN prefix, which is right for *drilling* a line but
 * wrong for *naming* a game: 1.e4 e5 2.Bc4 Nc6 3.Nf3 is the Italian by
 * transposition, and a game loaded from a `[FEN]` has no prefix at all.
 * Here every position along the game is looked up and the deepest hit wins,
 * so both cases classify (v6-plan Q2.7).
 *
 * The key is ChessFide.positionKey — the same normalisation the repetition
 * rule uses (no counters, ep only when a capture is legal), and the same one
 * scripts/gen-eco.mjs wrote the table with. One function on both sides is
 * what keeps a generated table and a live board agreeing.
 *
 * Names come from lichess in English. The curated book already carries the
 * Chinese and Japanese names of its 195 lines, and those are reused rather
 * than retranslated: a lichess entry is joined to a book line when the book
 * line's deepest position in the table *is* that entry, and the ECO codes
 * agree. The join is built once at load from the book itself; nothing here
 * is typed twice. Entries with no book line show the English name — that is
 * most of the table, and it is stated rather than hidden.
 * @module eco-lookup
 */
import { Chess } from "./chess.js";
import { loadChunk, chunkReady } from "./chunk.js";
import { ChessFide } from "./fide.js";
import { CHESS_OPENINGS, CHESS_OPENING_NAMES } from "./openings.js";
import { CHESS_OPENINGS_EN } from "./openings-en.js";
import { CHESS_OPENINGS_JA } from "./openings-ja.js";

  /** The table's key for the position `chess` is at. */
  function positionKey(chess) {
    return ChessFide.positionKey(chess.fen(), chess);
  }

  // 6.1: the table is 462 KB — a third of everything index.html parsed before
  // the first paint, for a label that appears beside a game once one exists.
  // It is its own chunk now (scripts/bundle.mjs builds js/chunk-eco.js) and
  // arrives when something first asks. Until then every lookup answers null,
  // which is what the caller already renders when a position is not in the
  // book, so nothing downstream needed a new state to understand.
  const ECO_GLOBAL = "ECO_BY_KEY";
  const table = () => (typeof window !== "undefined" ? window[ECO_GLOBAL] : globalThis[ECO_GLOBAL]) || null;
  /** Fetch the table if it is not here yet. @returns {Promise<void>} */
  function ready() { return loadChunk("chunk-eco.js", ECO_GLOBAL).then(() => undefined); }
  /** Is the table here? Callers render without it and re-render on ready(). */
  function loaded() { return chunkReady(ECO_GLOBAL); }
  // One shared wait, so a caller that redraws on every move does not stack a
  // callback per move on the one load. The latch lives here rather than beside
  // the caller: app.js keeps its state in the store and nothing else (see the
  // module-level-let rule in scripts/test-chess.mjs), and this is not app
  // state — it is this module's own bookkeeping about its own chunk.
  const waiters = [];
  let loading = false;
  /** Call `fn` once, when the table has arrived. No-op if it already has. */
  function whenReady(fn) {
    if (loaded()) return;
    waiters.push(fn);
    if (loading) return;
    loading = true;
    ready().then(() => { for (const w of waiters.splice(0)) { try { w(); } catch (_) { /* a redraw is not worth a throw */ } } })
      .catch(() => { waiters.length = 0; loading = false; });
  }

  /** The table entry for exactly this position, or null. */
  function lookupPosition(chess) {
    const t = table();
    if (!t) return null;
    const hit = t[positionKey(chess)];
    return hit ? { eco: hit[0], name: hit[1] } : null;
  }

  /**
   * The deepest position along a game that the table knows.
   *
   * Deepest rather than first because ECO is a tree: 1.e4 is B00, 1.e4 c5 is
   * B20, and the line keeps refining until the book runs out. The game is
   * replayed from `startFen` (null = standard start) — from a chess.js
   * instance its history is replayed on a scratch board so the caller's
   * board is not undone and rebuilt.
   *
   * @param {object|string[]} chessOrSanList a chess.js instance, or SAN moves
   * @param {string|null} [startFen] where the SAN list starts; ignored when a
   *   chess.js instance is passed (its own start position is recovered)
   * @returns {{eco: string, name: string, ply: number}|null} ply = how many
   *   moves in the hit was found (0 = the start position itself)
   */
  function openingForGame(chessOrSanList, startFen) {
    let sans, from;
    if (Array.isArray(chessOrSanList)) {
      sans = chessOrSanList;
      from = startFen || null;
    } else {
      // recover the start position without touching the caller's board:
      // undo to the root, read it, replay — history() is preserved by the replay
      const g = chessOrSanList;
      sans = g.history();
      for (let i = 0; i < sans.length; i++) g.undo();
      from = g.fen();
      for (const san of sans) g.move(san);
    }
    const t = table();
    if (!t) return null;
    const g = from ? new Chess(from) : new Chess();
    let best = null;
    const probe = (ply) => {
      const hit = t[positionKey(g)];
      if (hit) best = { eco: hit[0], name: hit[1], ply };
    };
    probe(0);
    for (let i = 0; i < sans.length; i++) {
      if (!g.move(sans[i])) break;
      probe(i + 1);
    }
    return best;
  }

  /**
   * The broadest English name filed under an ECO code, or null.
   * Built on first use rather than at load: the table it reads is a chunk now
   * and is usually not here yet when this module is evaluated (6.1).
   */
  let NAME_BY_ECO = null;
  function nameByEco() {
    const t = table();
    if (!t) return null;
    if (NAME_BY_ECO) return NAME_BY_ECO;
    const out = {};
    for (const [eco, name] of Object.values(t)) {
      // the shortest name is the family name; longer ones are its variations
      if (!out[eco] || name.length < out[eco].length) out[eco] = name;
    }
    NAME_BY_ECO = out;
    return out;
  }
  function ecoName(eco) {
    const tbl = nameByEco();
    return (tbl && tbl[eco]) || null;
  }

  /**
   * lichess `eco|name` → openings.js line id, from the book's own lines.
   *
   * Built by playing each book line and taking the table's deepest hit, kept
   * only when the codes agree — a book line filed under C88 whose deepest
   * position lichess files under C92 is a different (finer) claim, and lending
   * the C88 name to it would be wrong. First line to claim an entry keeps it.
   */
  // Built on first use, not at load. It plays every book line through
  // openingForGame, which needs the table — and the table is a chunk now (6.1),
  // absent while this module is evaluated. Built eagerly it came out empty and
  // stayed empty, so localName() fell back to English for every entry in
  // Chinese and Japanese. The static test missed it because it preloads eco.js.
  let BOOK_ID_BY_ENTRY = null;
  function bookIdByEntry() {
    if (BOOK_ID_BY_ENTRY) return BOOK_ID_BY_ENTRY;
    if (!table()) return null;
    const out = {};
    for (const [eco, id, moves] of CHESS_OPENINGS) {
      const hit = openingForGame(moves.split(" "));
      if (!hit || hit.eco !== eco) continue;
      const k = hit.eco + "|" + hit.name;
      if (!out[k]) out[k] = id;
    }
    BOOK_ID_BY_ENTRY = out;
    return out;
  }

  const LOCAL = { "zh-CN": CHESS_OPENING_NAMES, ja: CHESS_OPENINGS_JA, en: CHESS_OPENINGS_EN };

  /**
   * The name to show for a table entry in `lang`.
   *
   * The book's translation when the entry is one of the book's lines, else
   * the lichess English name. English also prefers lichess: the book's
   * English is a translation of its Chinese, the table's is the source.
   * @param {{eco: string, name: string}} entry from lookupPosition / openingForGame
   * @param {"zh-CN"|"en"|"ja"} lang
   */
  function localName(entry, lang) {
    if (!entry) return null;
    if (lang === "en") return entry.name;
    const book = bookIdByEntry();
    const id = book && book[entry.eco + "|" + entry.name];
    const tbl = LOCAL[lang];
    return (id && tbl && tbl[id]) || entry.name;
  }

  export const ChessEco = {
    positionKey, lookupPosition, openingForGame, ecoName, localName, ready, loaded, whenReady,
    get BOOK_ID_BY_ENTRY() { return bookIdByEntry() || {}; },
    get size() { const t = table(); return t ? Object.keys(t).length : 0; },
  };
