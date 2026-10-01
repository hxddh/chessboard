/**
 * 开局书的线，存进开局书自己的数据库 (v8-2-plan T4).
 *
 * Until 8.1 the lines — the book's structure, what 按线练 drills and what
 * every edit edits — lived only in the localStorage header
 * `chess.v1.repertoire`, and repertoire.js capped them at 400 a side so the
 * header stayed a few dozen KB. They now live in the "lines" store of a new
 * database, chessboard.replines (rep-db.js — chessboard.repertoire keeps
 * 8.1's version, so 8.1 still opens it), one row per line, and in the native
 * shards beside the records (rep-page.js). The cap is repertoire.js
 * MAX_LINES (5,000 a side).
 *
 * The header keeps a copy of the first HEAD lines of each side — exactly
 * what 7.2–8.1 read, so a downgrade still opens a book: the whole of any
 * book that was ≤ 400 lines when it moved, and the first 400 a side of a
 * bigger one. `ln` on the header says how many lines the store holds; an
 * older build rewriting the header drops it.
 *
 * The header is also the journal for whatever reaches it without passing
 * the store: an older build's edits, and an edit made while chunk-rep.js was
 * still booting (the main bundle only has the header's lines then). At boot
 * `mergeHead` lays the header over the stored lines: a line that was in the
 * copy and is not in the header any more was taken out, a line in the header
 * that the copy did not have was added. Lines past the copy are kept — unless
 * the header has none left on that side: an older build emptied it (清空).
 * A header that is missing or could not be read takes nothing out (M3 评审
 * P2); a full one from an older build that lacks only the oldest lines lost
 * them to that build's 400-line cap, and they stay (M3 评审 P3).
 *
 * Pure: lines and rows in, lines and rows out. No storage, no DOM.
 * @module rep-lines
 */

/** Lines a side the header keeps: 7.2–8.1's whole cap, so a downgrade sees an old book whole. */
const HEAD = 400;

/** A row's key in the "lines" store: the same line can be in both books. */
const keyOf = (side, id) => side + ":" + id;

/** A line as the book holds it (repertoire.js addLines), from a row. */
const lineOf = (r) => ({ id: r.id, sans: r.sans, eco: r.eco || "", name: r.name || "" });

/** Is this stored thing a line? (the rule repertoire-ui.js loadBook reads by) */
const isLine = (l) => !!l && typeof l.id === "string" && !!l.id && typeof l.sans === "string" && !!l.sans;

/** The rows as a Map, key → row. */
function mapOf(rows) {
  const m = new Map();
  for (const r of rows || []) if (isLine(r) && typeof r.k === "string" && (r.side === "w" || r.side === "b")) m.set(r.k, r);
  return m;
}

/** The book `{w, b}` from rows, each side in its stored order. */
function bookOf(rows) {
  const out = { w: [], b: [] };
  const list = [...mapOf(rows).values()].sort((a, b) => (a.side < b.side ? -1 : a.side > b.side ? 1 : a.o - b.o));
  for (const r of list) out[r.side].push(lineOf(r));
  return out;
}

/**
 * What to write to go from the stored rows `prev` (a Map, as mapOf) to the
 * book `book`: rows new or changed (the place `o`, or a name filled in),
 * keys gone. A removal shifts the places after it, so those are rewritten.
 * @returns {{put: object[], gone: string[]}}
 */
function diff(prev, book) {
  const put = [], seen = new Set();
  for (const side of ["w", "b"]) {
    const lines = (book && book[side]) || [];
    for (let o = 0; o < lines.length; o++) {
      const l = lines[o];
      const k = keyOf(side, l.id);
      if (seen.has(k)) continue;   // the same line twice in a side: the first place
      seen.add(k);
      const p = prev.get(k);
      if (p && p.o === o && p.sans === l.sans && p.eco === (l.eco || "") && p.name === (l.name || "")) continue;
      put.push({ k, side, o, id: l.id, sans: l.sans, eco: l.eco || "", name: l.name || "" });
    }
  }
  const gone = [...prev.keys()].filter((k) => !seen.has(k));
  return { put, gone };
}

/** The header's copy of `book`: the first HEAD lines of each side. */
function headOf(book) {
  return { w: ((book && book.w) || []).slice(0, HEAD), b: ((book && book.b) || []).slice(0, HEAD) };
}

const sameIds = (a, b) => a.length === b.length && a.every((l, i) => l.id === b[i].id);

/**
 * The stored book `full` with the header's lines `head` laid over it (see
 * the module comment). Where the header is the copy `full` would write, the
 * book is `full` itself.
 * @param {object} R ChessRepertoire (addLines: a deeper added line replaces
 *   the shorter one it extends, wherever that one is in the book)
 * @param {{w, b}} full
 * @param {{w, b}} head
 * @param {object|null} [hdr] the header as stored. null: there was none, or
 *   it could not be read (M3 评审 P2) — the lines `head` holds then are what
 *   the main bundle could see, not what anyone took out, so nothing leaves
 *   the book; a line `head` has that the store does not is still added.
 *   A header without one of the sides is, for that side, no header.
 *   Omitted: a readable header that has both sides.
 * @returns {{book: {w, b}, gone: string[]}} `gone`: line ids that left the
 *   book here (their drills' queue entries go with them)
 */
function mergeHead(R, full, head, hdr) {
  const book = {}, gone = [];
  for (const side of ["w", "b"]) {
    const f = (full && full[side]) || [];
    const h = ((head && head[side]) || []).filter(isLine);
    const copy = f.slice(0, HEAD);
    if (sameIds(copy, h)) { book[side] = f; continue; }
    // no header, or none of this side in it: nothing to take out (M3 评审 P2)
    const lost = hdr === null || (!!hdr && !Array.isArray(hdr[side]));
    // every line it could see taken out: that side was emptied (清空 in an
    // older build), not trimmed to what it could not see — only when the
    // header says so, `[]` on a header that could be read
    if (!h.length && !lost) { book[side] = []; gone.push(...f.map((l) => l.id)); continue; }
    const inHead = new Set(h.map((l) => l.id)), inCopy = new Set(copy.map((l) => l.id));
    // M3 评审 P3: 7.2–8.1 keep 400 lines a side by dropping the oldest. An
    // older build's header (no `ln`) that is full and lacks only the copy's
    // first lines lost them to that cap, not to an edit: they stay
    let cap = 0;
    if (hdr && !hdr.ln && h.length >= HEAD) {
      while (cap < copy.length && !inHead.has(copy[cap].id)) cap++;
      if (copy.slice(cap).some((l) => !inHead.has(l.id))) cap = 0;
    }
    // taken out where the header could see it; kept past the copy
    const kept = f.filter((l, i) => lost || i < cap || i >= HEAD || inHead.has(l.id));
    const named = new Map(h.map((l) => [l.sans, l]));
    const r = R.addLines(kept, h.filter((l) => !inCopy.has(l.id)).map((l) => l.sans), (sans) => {
      const l = named.get(sans);
      return l && l.eco ? { eco: l.eco, name: l.name || "" } : null;
    });
    book[side] = r.lines;
    const ids = new Set(r.lines.map((l) => l.id));
    for (const l of f) if (!ids.has(l.id)) gone.push(l.id);
  }
  return { book, gone };
}

/**
 * Which lines a launch boots on (rep-page.js), from what it found:
 *
 *   - `lf` on the header: a session without IndexedDB wrote the whole book
 *     into the header (the pre-T4 shape, like the library's legacy mode) —
 *     it is the book;
 *   - else the stored rows — the native shards' when a session without
 *     IndexedDB wrote them last (`newer`, M3 评审's generations) or when
 *     IndexedDB has none — with the header laid over them;
 *   - nothing stored anywhere: the header is the book. `short` when the
 *     header says the store held more (`ln`): the lines past the copy are
 *     not in reach this launch.
 * @param {object} R ChessRepertoire
 * @param {{header: object|null, head: {w, b}, stored: object[], shards: object[], newer?: boolean, lost?: boolean}} o
 *   `lost`: the main bundle could not read the header this session (persist.js
 *   quarantined it) — the lines it holds are not the header's (M3 评审 P2)
 * @returns {{book: {w, b}, gone: string[], from: "head"|"idb"|"shards", short: boolean}}
 */
function pick(R, o) {
  const h = o.header || {};
  const head = o.head || { w: [], b: [] };
  const st = mapOf(o.stored), sh = mapOf(o.shards);
  if (h.lf) return { book: head, gone: [], from: "head", short: false };
  const from = o.newer && sh.size ? "shards" : st.size ? "idb" : sh.size ? "shards" : "head";
  if (from === "head") {
    const n = head.w.length + head.b.length;
    return { book: head, gone: [], from, short: Number(h.ln) > n };
  }
  const r = mergeHead(R, bookOf([...(from === "idb" ? st : sh).values()]), head, o.lost || !o.header ? null : h);
  return { book: r.book, gone: r.gone, from, short: false };
}

/** The rows a shard text carries (rep-page.js shardText: `{v: 1, rep, lines}`). */
function rowsOfShards(texts) {
  const out = [];
  for (const text of Object.values(texts || {})) {
    let v = null;
    try { v = JSON.parse(text); } catch (_) { v = null; }
    if (v && Array.isArray(v.lines)) out.push(...v.lines);
  }
  return out;
}

export const ChessRepLines = { HEAD, keyOf, isLine, mapOf, bookOf, diff, headOf, mergeHead, pick, rowsOfShards };
