/**
 * 你的开局书，按局面 (v8-1-plan T3).
 *
 * repertoire.js keeps the book as *lines* — every root-to-leaf path of the
 * PGN it was imported from — because a line is what the 按线练 drills
 * rehearse. That stays the book's structure: an edit here is still an edit of
 * the lines, so the drills and their progress (ids minted from the moves)
 * keep working, untouched.
 *
 * What this module adds is the same book seen **by position**, which is the
 * shape three new questions need:
 *
 *   - **per-move review**: every position where it is your move is a card
 *     with its own schedule (srs.js's ladder, extended), so what comes back
 *     is the one move you forgot, not the whole line it sits in;
 *   - **the explorer's 「我的」**: which moves from the position on the board
 *     are yours — by position, so a transposition finds them;
 *   - **the library's cross-check**: "here you usually play X, the book says Y".
 *
 * A record is one (side, position): `{id: side + "|" + key, side, key, path,
 * moves: [{san, to}], card?}`. `key` is ChessFide.positionKey — computed on
 * explorer/replay.js, which says that same key without chess.js (held equal
 * by scripts/test-explorer.mjs) — so two move orders reaching one position
 * are one record and their moves merge. `path` is the first move order
 * reaching it, which is how a drill gets there. `card` exists only where the
 * side to move is the book's side.
 *
 * Pure: lines and records in, records and text out. No storage, no DOM.
 * @module rep-book
 */
import { createReplay } from "./explorer/replay.js";
import { ChessSrs } from "./srs.js";

/**
 * Review intervals in days after the n-th clean answer in a row: srs.js's
 * ladder, and past its last rung two more instead of retirement. A puzzle
 * you have solved four times can leave for good; a move of your own opening
 * is one you will be asked in a real game, so it keeps coming back, rarely.
 */
const LADDER = ChessSrs.LADDER.concat([60, 180]);
const DAY = ChessSrs.DAY;
/** The start position's key (the book's root). */
const START_KEY = createReplay().key();
/** How many cross-check rows the section shows. */
const CROSS_MAX = 6;
/** Games before "you usually play" is a habit rather than an accident. */
const CROSS_MIN = 2;
/** The native store's shards for the records: "rep0" … "rep3" (persist.js BULK). */
const SHARDS = 4;

const sideOf = (s) => (s === "b" ? "b" : "w");
/** Is it `side`'s move in the position `key`? */
const myTurn = (key, side) => String(key).split(" ")[1] === side;
const newCard = () => ({ s: 0, n: 0, due: 0, ivl: 0 });

/** Which of the SHARDS files a record is mirrored in (a stable string hash). */
function shardOf(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (Math.imul(h, 31) + id.charCodeAt(i)) | 0;
  return "rep" + ((h >>> 0) % SHARDS);
}

/**
 * One side's lines as records by position.
 *
 * Lines are walked in book order, so a position's moves come out in the
 * order the book first plays them and its `path` is the first move order
 * that reaches it. A line whose move does not replay (a set-up game read as
 * a line — repertoire.js START_FEN) stops there: its playable prefix is
 * indexed, the line itself stays in the book as it was.
 *
 * @param {"w"|"b"} side
 * @param {Array<{sans: string}>} lines repertoire.js lines
 * @param {Map<string, object>} [prev] the records as stored: their cards carry over
 * @returns {Map<string, object>} id → record
 */
function indexLines(side, lines, prev) {
  const s = sideOf(side);
  const out = new Map();
  for (const l of lines || []) {
    const sans = String((l && l.sans) || "").split(" ").filter(Boolean);
    const pos = createReplay();
    for (let i = 0; i < sans.length; i++) {
      const key = pos.key();
      if (!pos.move(sans[i])) break;
      const id = s + "|" + key;
      let r = out.get(id);
      if (!r) out.set(id, (r = { id, side: s, key, path: sans.slice(0, i).join(" "), moves: [] }));
      if (!r.moves.some((m) => m.san === sans[i])) r.moves.push({ san: sans[i], to: pos.key() });
    }
  }
  for (const r of out.values()) {
    if (!myTurn(r.key, s)) continue;
    const old = prev && prev.get(r.id);
    r.card = old && old.card ? ChessSrs.entry(old.card) : newCard();
  }
  return out;
}

/** Both sides' records, from the book `{w, b}` (see indexLines). */
function indexBook(book, prev) {
  const out = new Map();
  for (const side of ["w", "b"]) for (const [id, r] of indexLines(side, (book || {})[side], prev)) out.set(id, r);
  return out;
}

/** The moves the book plays from `key`, as a Set of SAN (either side's book, or `side`'s). */
function movesAt(records, key, side) {
  const out = new Set();
  for (const s of side ? [sideOf(side)] : ["w", "b"]) {
    const r = records.get(s + "|" + key);
    if (r) for (const m of r.moves) out.add(m.san);
  }
  return out;
}

/** Same record, as far as anything stored is concerned. */
function sameRecord(a, b) {
  return !!a && !!b && a.path === b.path && JSON.stringify(a.moves) === JSON.stringify(b.moves) &&
    JSON.stringify(a.card || null) === JSON.stringify(b.card || null);
}

/**
 * What to write to go from `prev` to `next`: records new or changed, ids gone.
 * @returns {{put: object[], gone: string[]}}
 */
function diff(prev, next) {
  const put = [], gone = [];
  for (const [id, r] of next) if (!sameRecord(prev.get(id), r)) put.push(r);
  for (const id of prev.keys()) if (!next.has(id)) gone.push(id);
  return { put, gone };
}

/**
 * A card after an answer. Clean: one rung up the ladder (and on the last
 * rung, again). Missed: srs.js's miss — back to the bottom, due at once.
 * @param {object} card
 * @param {boolean} ok
 * @param {number} now ms epoch
 */
function grade(card, ok, now) {
  const e = ChessSrs.entry(card) || newCard();
  if (!ok) return ChessSrs.onMiss(e, now);
  const s = e.s + 1;
  const ivl = LADDER[Math.min(s, LADDER.length) - 1];
  return { s, n: e.n + 1, due: now + ivl * DAY, ivl };
}

/** Is this card owed an answer at `now`? A card never answered is (it is new). */
function isDue(card, now) {
  const e = ChessSrs.entry(card);
  return !!e && e.due <= now;
}

/**
 * The cards due at `now`, most overdue first; within the same date the
 * shallower position first (the book's first moves before its sidelines),
 * then the id, so two calls agree.
 * @param {Map<string, object>|object[]} records
 * @param {number} now
 * @param {"w"|"b"} [side]
 */
function dueCards(records, now, side) {
  const list = [...(records instanceof Map ? records.values() : records)]
    .filter((r) => r.card && r.moves.length && (!side || r.side === side) && isDue(r.card, now));
  const depth = (r) => (r.path ? r.path.split(" ").length : 0);
  return list.sort((a, b) => ChessSrs.entry(a.card).due - ChessSrs.entry(b.card).due ||
    depth(a) - depth(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Cards a day at most (M3 评审; the puzzles' REVIEW_CAP, v6-plan Q3.3). */
const DAILY = 20;

/**
 * Today's dose: the cards due at `now`, at most `cap` of them, and the rest
 * moved to the following days, `cap` a day, in the same order — srs.js
 * dueQueue's rule, so a 400-line book imported in one go does not arrive as
 * one afternoon of new cards.
 * @returns {{today: object[], moved: object[]}} `moved`: records whose card changed (to write)
 */
function dose(records, now, cap) {
  const n = Math.max(1, Math.floor(cap) || DAILY);
  const due = dueCards(records, now);
  const moved = [];
  for (let i = n; i < due.length; i++) {
    const e = ChessSrs.entry(due[i].card);
    due[i].card = { s: e.s, n: e.n, ivl: e.ivl, due: now + (Math.floor((i - n) / n) + 1) * DAY };
    moved.push(due[i]);
  }
  return { today: due.slice(0, n), moved };
}

/**
 * The book as a tree for export: each position's moves written once, at the
 * first place a depth-first walk in move order reaches it; a later arrival
 * (a transposition, a repetition) ends its branch there. That walk is the
 * same one repertoire.js `pathsOf` makes of the file when it is imported
 * again, so the import finds every position's moves at the same place and in
 * the same order — which is what makes the round trip exact.
 */
function treeOf(records, side) {
  const s = sideOf(side);
  const seen = new Set();
  const build = (key) => {
    const r = records.get(s + "|" + key);
    if (!r || seen.has(key)) return [];
    seen.add(key);
    return r.moves.map((m) => ({ san: m.san, kids: build(m.to) }));
  };
  return build(START_KEY);
}

/** A tree's movetext from ply `ply` (0 = White's first move). */
function movetext(kids, ply, force) {
  if (!kids.length) return "";
  const num = (p, f) => (p % 2 === 0 ? p / 2 + 1 + ". " : f ? Math.floor(p / 2) + 1 + "... " : "");
  const [main, ...alts] = kids;
  let out = num(ply, force) + main.san;
  for (const a of alts) {
    const rest = movetext(a.kids, ply + 1, false);
    out += " (" + num(ply, true) + a.san + (rest ? " " + rest : "") + ")";
  }
  const cont = movetext(main.kids, ply + 1, alts.length > 0);
  return cont ? out + " " + cont : out;
}

/**
 * One side's book as a PGN game with variations, or "" when it is empty.
 * `[RepSide]` says whose book it is, so importing the file puts each game
 * back into its own side whichever button it came in by.
 */
function toPgn(records, side, event) {
  const s = sideOf(side);
  const text = movetext(treeOf(records, s), 0, false);
  if (!text) return "";
  const tags = [["Event", event || "Repertoire"], ["Site", "?"], ["Date", "????.??.??"], ["Round", "?"],
    ["White", "?"], ["Black", "?"], ["Result", "*"], ["RepSide", s]];
  const esc = (v) => String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // 80 columns, the export format's own limit (PGN standard 8.2.2)
  const words = (text + " *").split(" ");
  const rows = [];
  let row = "";
  for (const w of words) {
    if (row && row.length + 1 + w.length > 79) { rows.push(row); row = w; } else row = row ? row + " " + w : w;
  }
  if (row) rows.push(row);
  return tags.map(([k, v]) => "[" + k + ' "' + esc(v) + '"]').join("\n") + "\n\n" + rows.join("\n") + "\n";
}

/** The side a parsed game's `[RepSide]` names, or null. */
function taggedSide(game) {
  const h = ((game && game.headers) || []).find(([k]) => k === "RepSide");
  return h && (h[1] === "w" || h[1] === "b") ? h[1] : null;
}

/**
 * Take move `san` out of `side`'s book at position `key`, wherever it is
 * played from there — every line through that position with that move is
 * cut just before it. What is left is merged back by repertoire.js's own
 * rule (a cut line that is now a prefix of another adds nothing), so a line
 * that never went through the move keeps its id and its progress.
 *
 * M3 评审 P2-2: it also says how big the cut is — `cut` lines shortened or
 * gone, `whole` of them gone entirely — so the caller can ask first before a
 * click takes out whole lines. A cut that would leave no move of `side`'s
 * own (Black's book cut after 1. e4) is not a line of that book: it goes
 * whole, rather than staying as an opponent-only line.
 * @param {object} R ChessRepertoire
 * @param {object[]} lines the side's lines
 * @param {"w"|"b"} [side] whose book (default White's)
 * @returns {{lines: object[], gone: string[], cut: number, whole: number}|null} null: the book never plays it
 */
function removeMove(R, lines, key, san, side) {
  const keep = [], cut = [];
  const min = sideOf(side) === "b" ? 2 : 1;
  let hit = false, n = 0, whole = 0;
  for (const l of lines || []) {
    const sans = String(l.sans).split(" ");
    const pos = createReplay();
    let at = -1;
    for (let i = 0; i < sans.length; i++) {
      if (sans[i] === san && pos.key() === key) { at = i; break; }
      if (!pos.move(sans[i])) break;
    }
    if (at < 0) { keep.push(l); continue; }
    hit = true;
    n++;
    if (at >= min) cut.push(sans.slice(0, at).join(" "));
    else whole++;
  }
  if (!hit) return null;
  const r = R.addLines(keep, cut, null);
  const ids = new Set(r.lines.map((l) => l.id));
  return { lines: r.lines, gone: (lines || []).map((l) => l.id).filter((id) => !ids.has(id)), cut: n, whole };
}

/**
 * "In this position you usually play X; your book says Y."
 *
 * For every position where it is your move in a side's book, the games in
 * your library where you had that side and reached it (`hitsOf`, answered
 * from C1's position index): what you played next. A row when the move you
 * play most is not in the book, you played it at least CROSS_MIN times, and
 * more often than every book move there put together.
 * @param {Map<string, object>} records
 * @param {(r: object) => Array<{san: string, n: number}>|null} hitsOf most played first
 * @returns {Array<{side, key, path, usual, n, of, book: string[]}>}
 */
function crossCheck(records, hitsOf) {
  const out = [];
  for (const r of records.values()) {
    if (!r.card || !r.moves.length) continue;
    const hits = hitsOf(r);
    if (!hits || !hits.length) continue;
    const book = r.moves.map((m) => m.san);
    const top = hits.slice().sort((a, b) => b.n - a.n)[0];
    const inBook = hits.filter((h) => book.includes(h.san)).reduce((a, h) => a + h.n, 0);
    const of = hits.reduce((a, h) => a + h.n, 0);
    if (!book.includes(top.san) && top.n >= CROSS_MIN && top.n > inBook) {
      out.push({ side: r.side, key: r.key, path: r.path, usual: top.san, n: top.n, of, book });
    }
  }
  const depth = (x) => (x.path ? x.path.split(" ").length : 0);
  return out.sort((a, b) => b.n - a.n || depth(a) - depth(b) || (a.key < b.key ? -1 : 1)).slice(0, CROSS_MAX);
}

/** "1. e4 e5 2. Nf3" — a path in SAN, numbered from the start. */
function pathText(path) {
  const sans = String(path || "").split(" ").filter(Boolean);
  return sans.map((s, i) => (i % 2 === 0 ? i / 2 + 1 + ". " : "") + s).join(" ");
}

/**
 * A signature of the lines both books hold: the header carries it, and a
 * launch that finds it different from the records' (the records never got
 * written, or a learning file brought other lines) indexes again.
 */
function sigOf(book) {
  let h = 0;
  for (const side of ["w", "b"]) {
    for (const l of (book || {})[side] || []) {
      const s = side + (l && l.id);
      for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
    }
  }
  return (h >>> 0).toString(36);
}

/**
 * What a launch should hold, from what it found (rep-page.js boot).
 *
 * The lines are the book; the records are its index and its cards. So the
 * records are trusted as they are only when the header vouches for them —
 * this build's signature of the same lines, and as many records as it
 * counted. Anything else and the lines are indexed again, with every card
 * that is still in the book carried over:
 *
 *   - fewer records than counted: the WebView's storage lost them; `shards`
 *     are the native store's copy (persist.js readBulk "rep"), and their
 *     cards come back.
 *   - `newer` (the header's `gen` is past the one IndexedDB holds): a
 *     session without IndexedDB graded cards into the shards only; the
 *     shards' records win.
 *
 * @param {{book: {w, b}, header: object|null, stored: object[], shards?: object[]|null, newer?: boolean}} o
 * @returns {{records: Map, put: object[], gone: string[], recovered: number, fresh: boolean}}
 */
function reconcile(o) {
  const header = o.header || {};
  const stored = new Map();
  for (const r of o.stored || []) if (r && typeof r.id === "string" && Array.isArray(r.moves)) stored.set(r.id, r);
  if (!o.newer && typeof header.sig === "string" && header.sig === sigOf(o.book) && stored.size === Number(header.n)) {
    return { records: stored, put: [], gone: [], recovered: 0, fresh: true };
  }
  const prev = new Map(stored);
  let recovered = 0;
  for (const r of o.shards || []) {
    if (!r || typeof r.id !== "string" || !Array.isArray(r.moves)) continue;
    // `newer`: a later session wrote only the shards (it had no IndexedDB) —
    // their cards win over the stored ones (M3 评审)
    if (!prev.has(r.id) || (o.newer && !sameRecord(prev.get(r.id), r))) { prev.set(r.id, r); recovered++; }
  }
  const records = indexBook(o.book, prev);
  const { put, gone } = diff(stored, records);
  return { records, put, gone, recovered, fresh: false };
}

export const ChessRepBook = {
  reconcile,
  LADDER, DAY, START_KEY, SHARDS, CROSS_MIN, shardOf, myTurn, newCard, indexLines, indexBook, movesAt,
  sameRecord, diff, grade, isDue, dueCards, dose, DAILY, treeOf, toPgn, taggedSide, removeMove, crossCheck,
  pathText, sigOf,
};
