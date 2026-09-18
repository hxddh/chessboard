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
import { ECO_BY_KEY } from "./eco.js";
import { ChessFide } from "./fide.js";
import { CHESS_OPENINGS, CHESS_OPENING_NAMES } from "./openings.js";
import { CHESS_OPENINGS_EN } from "./openings-en.js";
import { CHESS_OPENINGS_JA } from "./openings-ja.js";

  /** The table's key for the position `chess` is at. */
  function positionKey(chess) {
    return ChessFide.positionKey(chess.fen(), chess);
  }

  /** The table entry for exactly this position, or null. */
  function lookupPosition(chess) {
    const hit = ECO_BY_KEY[positionKey(chess)];
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
    const g = from ? new Chess(from) : new Chess();
    let best = null;
    const probe = (ply) => {
      const hit = ECO_BY_KEY[positionKey(g)];
      if (hit) best = { eco: hit[0], name: hit[1], ply };
    };
    probe(0);
    for (let i = 0; i < sans.length; i++) {
      if (!g.move(sans[i])) break;
      probe(i + 1);
    }
    return best;
  }

  /** The broadest English name filed under an ECO code, or null. */
  const NAME_BY_ECO = (() => {
    const out = {};
    for (const [eco, name] of Object.values(ECO_BY_KEY)) {
      // the shortest name is the family name; longer ones are its variations
      if (!out[eco] || name.length < out[eco].length) out[eco] = name;
    }
    return out;
  })();
  function ecoName(eco) {
    return NAME_BY_ECO[eco] || null;
  }

  /**
   * lichess `eco|name` → openings.js line id, from the book's own lines.
   *
   * Built by playing each book line and taking the table's deepest hit, kept
   * only when the codes agree — a book line filed under C88 whose deepest
   * position lichess files under C92 is a different (finer) claim, and lending
   * the C88 name to it would be wrong. First line to claim an entry keeps it.
   */
  const BOOK_ID_BY_ENTRY = (() => {
    const out = {};
    for (const [eco, id, moves] of CHESS_OPENINGS) {
      const hit = openingForGame(moves.split(" "));
      if (!hit || hit.eco !== eco) continue;
      const k = hit.eco + "|" + hit.name;
      if (!out[k]) out[k] = id;
    }
    return out;
  })();

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
    const id = BOOK_ID_BY_ENTRY[entry.eco + "|" + entry.name];
    const tbl = LOCAL[lang];
    return (id && tbl && tbl[id]) || entry.name;
  }

  export const ChessEco = {
    positionKey, lookupPosition, openingForGame, ecoName, localName,
    BOOK_ID_BY_ENTRY, size: Object.keys(ECO_BY_KEY).length,
  };
