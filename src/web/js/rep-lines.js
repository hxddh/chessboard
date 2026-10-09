/**
 * 开局书的线，存进开局书自己的数据库 (v8-2-plan T4).
 *
 * The lines — the book's structure, what 按线练 drills and what every edit
 * edits — live in the "lines" store of chessboard.book (rep-db.js), one row
 * per line, and in the native shards beside the records (rep-page.js). The
 * cap is repertoire.js MAX_LINES (5,000 a side).
 *
 * The localStorage header (`chess.repertoire`) holds no lines, only what it
 * vouches for (`n`, `sig`, `gen`, `ln`) — except when a learning file was
 * merged into it (learning.js): its lines are then the book, and the next
 * boot takes them into the store.
 *
 * Pure: lines and rows in, lines and rows out. No storage, no DOM.
 * @module rep-lines
 */

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

/**
 * Which lines a launch boots on (rep-page.js), from what it found:
 *
 *   - `inbound`: lines a learning file put into the header — they are the
 *     book, and the lines the store had that they do not are `gone`;
 *   - else the stored rows — the native shards' when a session without
 *     IndexedDB wrote them last (`newer`, M3 评审's generations) or when
 *     IndexedDB has none.
 * @param {{inbound?: {w, b}|null, stored: object[], shards: object[], newer?: boolean}} o
 * @returns {{book: {w, b}, gone: string[], from: "head"|"idb"|"shards"|"none"}}
 */
function pick(o) {
  const st = mapOf(o.stored), sh = mapOf(o.shards);
  const from = o.newer && sh.size ? "shards" : st.size ? "idb" : sh.size ? "shards" : "none";
  const had = from === "none" ? { w: [], b: [] } : bookOf([...(from === "idb" ? st : sh).values()]);
  if (!o.inbound) return { book: had, gone: [], from };
  const book = { w: (o.inbound.w || []).filter(isLine), b: (o.inbound.b || []).filter(isLine) };
  const keep = new Set(book.w.concat(book.b).map((l) => l.id));
  const gone = had.w.concat(had.b).map((l) => l.id).filter((id) => !keep.has(id));
  return { book, gone, from: "head" };
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

export const ChessRepLines = { keyOf, isLine, mapOf, bookOf, diff, pick, rowsOfShards };
