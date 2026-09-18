/**
 * The opening book as one tree.
 *
 * openings.js is a flat list of lines, `[eco, id, "e4 e5 Nf3 …", idea?]`,
 * matched by SAN prefix. That shape is right for naming a position ("deepest
 * prefix wins") and wrong for two things Q3.4 wants: an opponent who, at a
 * branch point, plays *one of* the book's continuations rather than the one
 * the drill happens to be about, and a "play on from here" that can start
 * from any leaf. Both are questions about the tree the list implies, so the
 * tree is built once here and the list stays the source of truth — no second
 * hand-maintained data.
 *
 * Weights are counts, not authored: a child's weight is the number of book
 * lines that pass through it, so the move more of the book continues with is
 * the move the opponent plays more often. Main lines are main because the
 * book says more about them; nothing else needs to be written down.
 *
 * Pure: lines in, tree out. The rng is injected so tests can seed it.
 * @module opening-tree
 */

/** A node: the move that reached it, the lines through it, its children. */
function node(san) {
  return { san, count: 0, lines: [], children: Object.create(null) };
}

/**
 * Build the tree.
 * @param {Array} lines openings.js rows: [eco, id, sanSequence, idea?]
 * @returns {object} the root (san: null)
 */
function buildTree(lines) {
  const root = node(null);
  for (const row of lines || []) {
    const sans = String(row[2] || "").trim().split(/\s+/).filter(Boolean);
    let cur = root;
    cur.count++;
    for (const san of sans) {
      if (!cur.children[san]) cur.children[san] = node(san);
      cur = cur.children[san];
      cur.count++;
    }
    cur.lines.push({ eco: row[0], id: row[1], sans, idea: row[3] });
  }
  return root;
}

/** The node reached by `sans`, or null when the book leaves that path. */
function nodeAt(tree, sans) {
  let cur = tree;
  for (const san of sans || []) {
    cur = cur.children[san];
    if (!cur) return null;
  }
  return cur;
}

/**
 * The book's continuations after `sans`.
 * @returns {Array<{san:string, count:number}>} in first-seen (book) order;
 *          empty when the path is off-book or at a leaf
 */
function childrenAt(tree, sans) {
  const n = nodeAt(tree, sans);
  if (!n) return [];
  return Object.keys(n.children).map((san) => ({ san, count: n.children[san].count }));
}

/**
 * One continuation, drawn with probability proportional to how many lines go
 * through it.
 * @param {function} [rng] () → [0,1); Math.random by default
 * @returns {string|null} a SAN, or null when there is no continuation
 */
function weightedPick(tree, sans, rng) {
  const kids = childrenAt(tree, sans);
  if (!kids.length) return null;
  const total = kids.reduce((n, k) => n + k.count, 0);
  let x = (rng || Math.random)() * total;
  for (const k of kids) {
    x -= k.count;
    if (x < 0) return k.san;
  }
  return kids[kids.length - 1].san; // rng returned exactly 1: last child
}

/**
 * The lines that end where the book ends — where 接实战 can start.
 * A line that is a prefix of a longer one (e.g. "Nf3" under "Nf3 d5") is not
 * a leaf: play on from it and the book still has a say.
 * @returns {Array<{eco:string, id:string, sans:string[], idea?:string}>}
 */
function leafLines(tree) {
  const out = [];
  (function walk(n) {
    const kids = Object.keys(n.children);
    if (!kids.length) out.push(...n.lines);
    for (const k of kids) walk(n.children[k]);
  })(tree);
  return out;
}

export const ChessOpeningTree = { buildTree, nodeAt, childrenAt, weightedPick, leafLines };
