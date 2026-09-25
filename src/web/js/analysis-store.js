/**
 * Finished board analyses, kept across a reload (v7-6-plan §1c).
 *
 * Through 7.5 `store.session.analysis` lived in the session and nowhere else:
 * a 分析 is ~13 s of engine time on a 60-ply game and a 精析 ~34 s, and a
 * reload — or loading the same game back from 对局历史 — threw all of it away
 * and lit the 分析 button again. This is the list those results are filed in,
 * keyed by the game they measured, so a load can put them back without a
 * single search.
 *
 * Keyed by what the analysis actually depends on: the start position and the
 * moves of the line that was analysed. Not the PGN text — its tag pairs
 * (Result, Date, the names) change without changing one evaluation, and a game
 * loaded back from history carries different ones than the board did.
 *
 * Pure: the caller owns storage. Bounded both by count and by serialized
 * size, oldest out first, because this sits in localStorage beside the save
 * and the library, and a quota failure there latches the whole profile's
 * "not saved" warning (persist.js).
 * @module analysis-store
 */

/** How many analysed games are remembered. */
export const MAX_ANALYSES = 24;
/** Serialized-size ceiling for the whole list, in characters (~2 bytes each). */
export const MAX_CHARS = 600000;

/**
 * FNV-1a, 32 bits, base 36 — the same short stable digest drills.js uses.
 * Only an index: `find` compares the full move text before trusting a hit.
 */
function hash36(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}

/**
 * @param {string} fen the position the line starts from
 * @param {string[]} sans the line, in SAN
 */
export function keyOf(fen, sans) {
  return hash36(String(fen || "") + "|" + (sans || []).join(" "));
}

/** The shape `load` accepts; anything else is dropped rather than trusted. */
function valid(e) {
  return !!e && typeof e.k === "string" && typeof e.fen === "string" && typeof e.sans === "string" &&
    e.an && Array.isArray(e.an.scalars) && Array.isArray(e.an.tags);
}

/** Entries from a stored value; tolerant of null and of foreign shapes. */
export function load(v) {
  return v && v.v === 1 && Array.isArray(v.list) ? v.list.filter(valid) : [];
}

/** The value to store for `list`. */
export function dump(list) {
  return { v: 1, list };
}

/**
 * The analysis on file for this line, or null.
 * @returns {object|null} the stored `an` (no `sig` — the caller sets it)
 */
export function find(list, fen, sans) {
  const k = keyOf(fen, sans);
  const text = (sans || []).join(" ");
  const e = (list || []).find((x) => x.k === k && x.fen === fen && x.sans === text);
  return e ? e.an : null;
}

/**
 * File `an` for this line, replacing an earlier one for the same line, and
 * evict the oldest until both caps hold. A shallower result never replaces
 * a deeper one: a 分析 run after a 精析 of the same game would otherwise
 * quietly downgrade what a reload shows.
 * @returns {object[]} the new list (the input is not changed)
 */
export function put(list, fen, sans, an, now) {
  const k = keyOf(fen, sans);
  const text = (sans || []).join(" ");
  const old = (list || []).find((x) => x.k === k && x.fen === fen && x.sans === text);
  if (old && (old.an.budget || 0) > (an.budget || 0)) return list;
  const rec = Object.assign({}, an);
  delete rec.sig;
  const out = (list || []).filter((x) => x !== old);
  out.push({ k, fen, sans: text, t: now || Date.now(), an: rec });
  out.sort((a, b) => (a.t || 0) - (b.t || 0));
  while (out.length > MAX_ANALYSES) out.shift();
  while (out.length > 1 && JSON.stringify(dump(out)).length > MAX_CHARS) out.shift();
  return out;
}

export const ChessAnalysisStore = { MAX_ANALYSES, MAX_CHARS, keyOf, load, dump, find, put };
