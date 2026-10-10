/**
 * 从内置开局生成 — a first repertoire out of the built-in book (v10-0-plan T4).
 *
 * 我的开局书 began as an import: a PGN with variations, which is what a coach
 * hands out and what a player who has never had a coach does not own. So the
 * first step of opening training was finding a file. The app already carries
 * 195 curated lines (openings.js), with ideas in three languages; this turns
 * a choice of system — 1.e4 or 1.d4 for White, one defence against each for
 * Black — into the lines of a book, ready for 开始背.
 *
 * A repertoire answers every opponent move but plays one move of its own in
 * each position, so the side's own moves are made consistent: lines are
 * taken longest first (the main lines, which carry the ideas), and a line
 * that would play a different move of ours in a position an earlier line
 * already answered is left out. The opponent's moves keep every branch the
 * book has.
 *
 * Pure: the book's rows in, SAN lines out.
 * @module rep-seed
 */

/** The systems offered: the side, and the moves every line must begin with. */
export const SYSTEMS = [
  { id: "e4", side: "w", prefix: "e4" },
  { id: "d4", side: "w", prefix: "d4" },
  { id: "e5", side: "b", prefix: "e4 e5" },
  { id: "sicilian", side: "b", prefix: "e4 c5" },
  { id: "french", side: "b", prefix: "e4 e6" },
  { id: "carokann", side: "b", prefix: "e4 c6" },
  { id: "qgd", side: "b", prefix: "d4 d5" },
  { id: "indian", side: "b", prefix: "d4 Nf6" },
];

/** Lines shorter than this are the system's name, not something to learn. */
const MIN_PLIES = 4;

/**
 * The lines of one system, own moves consistent.
 * @param {object} sys one of SYSTEMS
 * @param {Array} rows openings.js CHESS_OPENINGS ([eco, id, moves, idea?])
 * @returns {string[]} SAN lines, space-joined
 */
export function linesFor(sys, rows) {
  const pre = sys.prefix.split(" ");
  const cands = (rows || []).map((r) => String(r[2] || "").split(" "))
    .filter((m) => m.length >= Math.max(MIN_PLIES, pre.length) && pre.every((x, i) => m[i] === x))
    .sort((a, b) => b.length - a.length);
  const mine = new Map();
  const ours = (i) => (sys.side === "b" ? i % 2 === 1 : i % 2 === 0);
  const out = [];
  for (const m of cands) {
    let ok = true;
    for (let i = 0; i < m.length && ok; i++) {
      if (!ours(i)) continue;
      const had = mine.get(m.slice(0, i).join(" "));
      if (had && had !== m[i]) ok = false;
    }
    if (!ok) continue;
    for (let i = 0; i < m.length; i++) if (ours(i)) mine.set(m.slice(0, i).join(" "), m[i]);
    out.push(m.join(" "));
  }
  // a line another one extends adds no question of its own (repertoire.js
  // addLines would fold it in anyway): the count offered is the count kept
  return out.filter((l) => !out.some((x) => x !== l && x.startsWith(l + " ")));
}

export const ChessRepSeed = { SYSTEMS, linesFor };
