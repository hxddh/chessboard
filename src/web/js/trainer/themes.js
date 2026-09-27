/**
 * 题目主题：可验证主题的清单，以及一道题属于哪些主题（v8-0-plan B1）。
 *
 * The ids are scripts/lib/puzzle-themes.mjs's, in its order (rarest first):
 * every one is a tag the importer checks on the line before it keeps it, so a
 * puzzle filed under 闷杀 ends in a smothered mate. test-chess.mjs holds this
 * list equal to that one — the browser lists what the importer can verify,
 * no more and no fewer.
 *
 * A Lichess puzzle carries its verified ids (`themes`). The hand-written and
 * mined books predate the tags, so theirs are read off what the app already
 * proves about them: the three mate lengths and the defence are categories
 * with their own gates, and the motif is motif.js's (the key the tally and the
 * planner already share). Pure: no DOM, no storage, no i18n.
 * @module trainer/themes
 */

export const THEME_IDS = [
  "underPromotion", "enPassant", "castling", "smothered", "arabian", "double", "backRank", "f2f7",
  "promotion", "knightEnding", "bishopEnding", "queenEnding", "queenRookEnding", "pawnEnding",
  "rookEnding", "skewer", "discovered", "pin", "sacrifice", "quiet", "advancedPawn", "def",
  "hanging", "m3", "m2", "fork", "m1",
];
const KNOWN = new Set(THEME_IDS);
const GATED = new Set(["m1", "m2", "m3", "def"]);

/**
 * The theme ids of one puzzle.
 * @param {object} p a puzzle
 * @param {string|null} motif its motif key (trainer/content.js motifKeyOf), or null
 * @returns {string[]}
 */
export function themesOf(p, motif) {
  if (!p) return [];
  if (Array.isArray(p.themes)) return p.themes.filter((id) => KNOWN.has(id));
  const out = [];
  if (GATED.has(p.cat)) out.push(p.cat);
  if (motif && KNOWN.has(motif) && !out.includes(motif)) out.push(motif);
  return out;
}

/** The record kept per theme in the puzzle state: its rating and first answers. */
export function themeRecord(st, id) {
  if (!st.themes || typeof st.themes !== "object") st.themes = {};
  if (!st.themes[id]) st.themes[id] = { solve: 0, miss: 0 };
  return st.themes[id];
}

/** First answers given in a theme so far. */
export function attemptsIn(st, id) {
  const r = st && st.themes && st.themes[id];
  return r ? (r.solve || 0) + (r.miss || 0) : 0;
}

/**
 * The browser's rows after the search box and the progress filter.
 * @param {{id:string, name:string, n:number, tried:number}[]} rows
 * @param {string} query what is typed in the search box
 * @param {"all"|"new"|"started"} prog
 */
export function filterThemes(rows, query, prog) {
  const q = String(query || "").trim().toLowerCase();
  return rows.filter((r) => {
    if (prog === "new" && r.tried > 0) return false;
    if (prog === "started" && !r.tried) return false;
    if (!q) return true;
    return r.name.toLowerCase().includes(q) || r.id.toLowerCase().includes(q);
  });
}

export const ChessThemes = { THEME_IDS, themesOf, themeRecord, attemptsIn, filterThemes };
