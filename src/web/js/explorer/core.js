/**
 * 开局浏览器的算术 (v8-0-plan C3): for one position, the moves played from it,
 * how many games each, and how those games ended.
 *
 * Three sources answer the same question and come out in the same shape —
 * rows of `{san, n, w, d, b}` (White wins, draws, Black wins), most played
 * first:
 *
 *   - **your library** (step 1): the games imported into 棋谱库, indexed by
 *     position the first time they are asked about. The index is the one
 *     seam M5-db's `gamesWithPosition(fenKey)` replaces: `hitsAt` is the only
 *     function that knows where the games come from.
 *   - **the master tree** (step 2): counted offline from CC0 Lichess games by
 *     scripts/build-explorer.mjs and stored per position, keyed by a hash of
 *     the position (`hashKey`), encoded by `encodeRows`.
 *   - **the book** (step 3) is not a source of counts but a mark: a move the
 *     built-in opening book (openings.js) plays from this position is 「书」.
 *
 * Positions are keyed by ChessFide.positionKey — the key the repetition rule
 * and the ECO table already use (no move counters; an en-passant square only
 * when the capture is playable) — so a transposition finds the same row, the
 * way the ECO name already does. The key function is injected (`deps.keyOf`)
 * along with chess.js, so this module carries neither and stays a few KB in
 * its chunk.
 *
 * Pure: games, lines and strings in, plain objects out. No DOM, no store.
 * @module explorer/core
 */

/**
 * How deep the library index goes, in plies. An opening explorer past move
 * 25 answers "which game was this" — every position there is one game's own —
 * and the depth is what the one-time index costs (explorer-e2e measures it
 * on 500 games). Lichess's personal explorer stops at a similar depth.
 */
export const LIB_PLIES = 50;

/**
 * cyrb53 — a 53-bit string hash, as base 36 (≤ 11 characters). The master
 * tree stores this instead of the 60-odd-character key: at ~10⁵ positions a
 * 53-bit hash has a collision chance around 10⁻⁶, and a collision could only
 * put a move on screen that the position does not have, which `rowsAt`
 * filters out by legality anyway. Math.imul is ES2015 (Safari 15 has it).
 * @param {string} str
 */
export function hashKey(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** A PGN result from White's chair: "w" | "d" | "b", or null (unfinished). */
export function resultOf(result) {
  return result === "1-0" ? "w" : result === "0-1" ? "b" : result === "1/2-1/2" ? "d" : null;
}

/**
 * Count `{san, result}` hits into rows, most played first (ties: SAN order,
 * so two runs over the same games print the same table). An unfinished game
 * counts in `n` and in none of w/d/b.
 * @param {Array<{san:string, result:string}>} hits
 */
export function tally(hits) {
  const by = new Map();
  for (const h of hits || []) {
    let r = by.get(h.san);
    if (!r) by.set(h.san, (r = { san: h.san, n: 0, w: 0, d: 0, b: 0 }));
    r.n++;
    const k = resultOf(h.result);
    if (k) r[k]++;
  }
  return sortRows([...by.values()]);
}

/** Most played first; SAN order breaks ties. */
export function sortRows(rows) {
  return rows.sort((a, b) => b.n - a.n || (a.san < b.san ? -1 : a.san > b.san ? 1 : 0));
}

/**
 * Index the library by position: key → [[game index, ply], …], one entry per
 * (game, position) pair, the ply being the move played FROM that position.
 * A game that visits a position twice (a repetition) counts once, at its
 * first visit — the explorer counts games, not visits.
 *
 * @param {object[]} list library.js entries ({sans, fen, result})
 * @param {{Chess: Function, keyOf: (chess) => string}} deps
 * @param {number} [maxPly] LIB_PLIES
 * @returns {Map<string, Array<[number, number]>>}
 */
export function indexGames(list, deps, maxPly) {
  const cap = maxPly || LIB_PLIES;
  const idx = new Map();
  (list || []).forEach((g, gi) => {
    if (!g || !g.sans) return;
    const sans = String(g.sans).split(" ");
    let pos;
    try { pos = g.fen ? new deps.Chess(g.fen) : new deps.Chess(); } catch (_) { return; }
    const seen = new Set();
    for (let ply = 0; ply < sans.length && ply < cap; ply++) {
      const key = deps.keyOf(pos);
      if (!seen.has(key)) {
        seen.add(key);
        const at = idx.get(key);
        if (at) at.push([gi, ply]); else idx.set(key, [[gi, ply]]);
      }
      if (!pos.move(sans[ply])) break;
    }
  });
  return idx;
}

/**
 * Your library as an explorer source (step 1).
 *
 * The index is built on the first question and kept until the list itself
 * is a different array (library-ui.js replaces the array on every import,
 * delete and analysis write, never edits it in place).
 *
 * THE SEAM (v8-0-plan C3 × C1): `hitsAt` is the whole of "which games reach
 * this position, and what was played next". When the library becomes a
 * database with `gamesWithPosition(fenKey)`, this function's body becomes
 * that query plus the next-move lookup; `movesAt` and everything above it
 * stay as they are.
 *
 * @param {() => object[]} getList the library's entries, as stored
 * @param {{Chess: Function, keyOf: Function}} deps
 */
export function librarySource(getList, deps) {
  let memo = { list: null, idx: null };
  function hitsAt(key) {
    const list = getList() || [];
    if (memo.list !== list) memo = { list, idx: indexGames(list, deps) };
    return (memo.idx.get(key) || []).map(([gi, ply]) => ({ san: String(list[gi].sans).split(" ")[ply], result: list[gi].result }));
  }
  return {
    /** @returns {Array<{san,n,w,d,b}>} */
    movesAt: (key) => tally(hitsAt(key)),
    /** how many games the source holds — the empty state says so */
    size: () => (getList() || []).length,
  };
}

/**
 * The master tree's stored form: "san,n,w,d,b;san,…" with the counts in
 * base 36 (n is stored rather than derived: a game with no result in the
 * dump is counted in n only, exactly as `tally` does).
 */
export function encodeRows(rows) {
  return rows.map((r) => [r.san, r.n.toString(36), r.w.toString(36), r.d.toString(36), r.b.toString(36)].join(",")).join(";");
}
/** @returns {Array<{san,n,w,d,b}>} */
export function decodeRows(str) {
  if (!str) return [];
  return str.split(";").map((s) => {
    const [san, n, w, d, b] = s.split(",");
    return { san, n: parseInt(n, 36), w: parseInt(w, 36), d: parseInt(d, 36), b: parseInt(b, 36) };
  });
}

/**
 * Which master-tree bucket holds positions reached at `ply`. The buckets are
 * ply ranges written by the build (`buckets[i] = [from, to]`, inclusive), and
 * a position reached at several depths is stored in each bucket it was
 * reached in, so one chunk answers a position at the depth you are at.
 * @returns {number} index into buckets, or -1 past the tree's depth
 */
export function bucketFor(buckets, ply) {
  for (let i = 0; i < (buckets || []).length; i++) if (ply >= buckets[i][0] && ply <= buckets[i][1]) return i;
  return -1;
}

/**
 * The book by position (step 3): key → the set of SAN moves any book line
 * plays from it. By position and not by SAN prefix, so the mark agrees with
 * the ECO name on a transposition; opening-tree.js's `childrenAt` answers the
 * same question per move order, and scripts/test-explorer.mjs holds the two
 * to agreeing on every book prefix.
 * @param {Array} lines openings.js rows: [eco, id, "san …", idea?]
 * @param {{Chess: Function, keyOf: Function}} deps
 * @returns {Map<string, Set<string>>}
 */
export function bookIndex(lines, deps) {
  const out = new Map();
  for (const row of lines || []) {
    const pos = new deps.Chess();
    for (const san of String(row[2] || "").trim().split(/\s+/).filter(Boolean)) {
      const key = deps.keyOf(pos);
      if (!out.has(key)) out.set(key, new Set());
      out.get(key).add(san);
      if (!pos.move(san)) break;
    }
  }
  return out;
}

/**
 * The rows for one position: the source's rows, kept only when legal here
 * (a hash collision in the master tree, or a library game whose SAN no
 * longer parses, cannot put a move on screen), each marked `book` when the
 * book plays it; and the book moves no game played, appended with n = 0 so
 * the book is visible where the games are silent.
 * @param {Array<{san,n,w,d,b}>} rows
 * @param {object} pos chess.js at the position
 * @param {Set<string>|undefined} book
 */
export function rowsAt(rows, pos, book) {
  const legal = new Set(pos.moves());
  const out = (rows || []).filter((r) => legal.has(r.san)).map((r) => Object.assign({}, r, { book: !!(book && book.has(r.san)) }));
  if (book) for (const san of book) if (legal.has(san) && !out.some((r) => r.san === san)) out.push({ san, n: 0, w: 0, d: 0, b: 0, book: true });
  return out;
}

/** Whole percentages of w/d/b that add up to 100 (largest remainder). */
export function percents(r) {
  const tot = r.w + r.d + r.b;
  if (!tot) return [0, 0, 0];
  const raw = [r.w, r.d, r.b].map((x) => (x * 100) / tot);
  const out = raw.map(Math.floor);
  let left = 100 - out.reduce((a, b) => a + b, 0);
  raw.map((x, i) => [x - Math.floor(x), i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left > 0) { out[i]++; left--; } });
  return out;
}

export const ChessExplorer = {
  LIB_PLIES, hashKey, resultOf, tally, sortRows, indexGames, librarySource,
  encodeRows, decodeRows, bucketFor, bookIndex, rowsAt, percents,
};
