/**
 * The game as a tree of positions — the model that replaces the linear
 * history array (docs/v6-plan.md §Q2.1).
 *
 * A node is one move and the position after it; the first child of any node
 * is the mainline, every other child a variation. That single rule is the
 * whole representation: "promote" is a reorder of one children array and
 * the mainline is a walk down index 0. Nothing here holds a parent pointer or
 * a lookup table — the tree is a plain object so it can be JSON-persisted as
 * is, and games are small enough that finding a node by walking is cheaper
 * than keeping an index consistent through every edit.
 *
 * Every function is pure over the tree it is handed and mutates in place;
 * the caller decides what "commit" means. Legality is chess.js's, as
 * everywhere else in the app.
 * @module game-tree
 */
import { Chess } from "./chess.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

function makeNode(id, fen) {
  return { id, san: null, from: null, to: null, promotion: null, fen, comment: null, nags: [], shapes: { arrows: [], circles: [] }, children: [] };
}

/**
 * A new tree at `startFen` (the standard array by default). The FEN is
 * normalised through chess.js so two trees of the same position compare
 * equal whatever spelling the caller used.
 */
function createTree(startFen) {
  const chess = new Chess();
  const fen = startFen ? String(startFen).trim() : START_FEN;
  if (!chess.load(fen)) throw new Error("game-tree: invalid start FEN " + JSON.stringify(fen));
  return { startFen: chess.fen(), nextId: 1, root: makeNode(0, chess.fen()) };
}

/**
 * Locate a node with the chain of ancestors that leads to it.
 * @returns {{node: object, parent: object|null, path: object[]}|null}
 *   `path` is root → … → node inclusive
 */
function find(tree, nodeId) {
  const id = Number(nodeId);
  const stack = [{ node: tree.root, path: [tree.root] }];
  while (stack.length) {
    const { node, path } = stack.pop();
    if (node.id === id) return { node, parent: path.length > 1 ? path[path.length - 2] : null, path };
    for (let k = node.children.length - 1; k >= 0; k--) {
      stack.push({ node: node.children[k], path: path.concat(node.children[k]) });
    }
  }
  return null;
}

function must(tree, nodeId) {
  const hit = find(tree, nodeId);
  if (!hit) throw new Error("game-tree: no node " + nodeId);
  return hit;
}

function nodeAt(tree, nodeId) {
  const hit = find(tree, nodeId);
  return hit ? hit.node : null;
}

function parentOf(tree, nodeId) {
  const hit = find(tree, nodeId);
  return hit ? hit.parent : null;
}

/**
 * Play a move from a node. `move` is SAN or `{from, to, promotion}`.
 * Playing a move that already exists as a child returns that child rather
 * than forking — "try the mainline again" must land on the mainline. A new
 * move becomes the last child (a variation) unless it is the first.
 * @returns {object} the child node
 */
function addMove(tree, nodeId, move) {
  const { node } = must(tree, nodeId);
  const chess = new Chess(node.fen);
  const mv = typeof move === "string"
    ? chess.move(move, { sloppy: true })
    : chess.move({ from: move.from, to: move.to, promotion: move.promotion || undefined });
  if (!mv) throw new Error("game-tree: illegal move " + JSON.stringify(move) + " from " + node.fen);
  const existing = node.children.find((c) => c.san === mv.san);
  if (existing) return existing;
  const child = makeNode(tree.nextId++, chess.fen());
  child.san = mv.san;
  child.from = mv.from;
  child.to = mv.to;
  child.promotion = mv.promotion || null;
  node.children.push(child);
  return child;
}

/** Make this variation the mainline at its own branch point only. */
function promote(tree, nodeId) {
  const { node, parent } = must(tree, nodeId);
  if (!parent) return node;
  const k = parent.children.indexOf(node);
  if (k > 0) { parent.children.splice(k, 1); parent.children.unshift(node); }
  return node;
}

/** Make the line through this node the mainline all the way from the root. */
function promoteToMain(tree, nodeId) {
  const { path } = must(tree, nodeId);
  for (let k = 1; k < path.length; k++) {
    const parent = path[k - 1];
    const i = parent.children.indexOf(path[k]);
    if (i > 0) { parent.children.splice(i, 1); parent.children.unshift(path[k]); }
  }
  return path[path.length - 1];
}

/**
 * Remove a node and everything after it. The root cannot be deleted; the
 * result is the parent, which is where a cursor that stood on the deleted
 * line should now be.
 */
function deleteNode(tree, nodeId) {
  const { node, parent } = must(tree, nodeId);
  if (!parent) throw new Error("game-tree: cannot delete the root");
  parent.children.splice(parent.children.indexOf(node), 1);
  return parent;
}

/** Moves of the mainline, root excluded. */
function mainline(tree) {
  const out = [];
  let n = tree.root.children[0];
  while (n) { out.push(n); n = n.children[0]; }
  return out;
}

function mainlineSans(tree) {
  return mainline(tree).map((n) => n.san);
}

/** Moves from the root down to `nodeId` inclusive, root excluded. */
function pathTo(tree, nodeId) {
  const { path } = must(tree, nodeId);
  return path.slice(1);
}

function fenAt(node) {
  return node ? node.fen : null;
}

function setComment(tree, nodeId, text) {
  const { node } = must(tree, nodeId);
  const t = text == null ? "" : String(text).replace(/\s+/g, " ").trim();
  node.comment = t || null;
  return node;
}

function setNags(tree, nodeId, nags) {
  const { node } = must(tree, nodeId);
  node.nags = (nags || []).map(Number).filter((n) => Number.isInteger(n) && n > 0);
  return node;
}

function setShapes(tree, nodeId, shapes) {
  const { node } = must(tree, nodeId);
  node.shapes = {
    arrows: ((shapes && shapes.arrows) || []).map((a) => ({ from: a.from, to: a.to, color: a.color })),
    circles: ((shapes && shapes.circles) || []).map((c) => ({ sq: c.sq, color: c.color })),
  };
  return node;
}

/** Deep copy of a node; `keepId` false strips ids (a PGN Game has none). */
function cloneNode(n, keepId) {
  const out = makeNode(keepId ? n.id : undefined, n.fen);
  if (!keepId) delete out.id;
  out.san = n.san == null ? null : n.san;
  out.from = n.from == null ? null : n.from;
  out.to = n.to == null ? null : n.to;
  out.promotion = n.promotion == null ? null : n.promotion;
  out.comment = n.comment ? String(n.comment) : null;
  out.nags = (n.nags || []).slice();
  out.shapes = {
    arrows: ((n.shapes && n.shapes.arrows) || []).map((a) => ({ from: a.from, to: a.to, color: a.color })),
    circles: ((n.shapes && n.shapes.circles) || []).map((c) => ({ sq: c.sq, color: c.color })),
  };
  out.children = (n.children || []).map((c) => cloneNode(c, keepId));
  return out;
}

/**
 * The tree as a pgn-parser Game. `headers` may be pairs or an object; a
 * non-standard start position adds `SetUp`/`FEN` if the caller did not, and
 * the result comes from the Result tag (or "*").
 */
function toPgnGame(tree, headers) {
  const pairs = Array.isArray(headers) ? headers.map(([k, v]) => [k, String(v)])
    : Object.entries(headers || {}).map(([k, v]) => [k, String(v)]);
  const has = (k) => pairs.some(([n]) => n === k);
  if (tree.startFen !== START_FEN) {
    if (!has("SetUp")) pairs.push(["SetUp", "1"]);
    if (!has("FEN")) pairs.push(["FEN", tree.startFen]);
  }
  const r = pairs.find(([k]) => k === "Result");
  return { headers: pairs, root: cloneNode(tree.root, false), result: r && RESULTS.has(r[1]) ? r[1] : "*" };
}

/** A tree from a pgn-parser Game — ids are assigned fresh, in preorder. */
function fromPgnGame(game) {
  const tree = createTree(game.root.fen);
  // keepId so the id slot stays first in every node: a tree built by addMove
  // and one loaded from PGN must serialize byte-for-byte alike
  tree.root = cloneNode(game.root, true);
  return renumber(tree);
}

/** Preorder ids from 1, root 0 — after a load, so persisted ids stay dense. */
function renumber(tree) {
  let next = 1;
  const walk = (n) => { for (const c of n.children) { c.id = next++; walk(c); } };
  tree.root.id = 0;
  walk(tree.root);
  tree.nextId = next;
  return tree;
}

function serialize(tree) {
  return JSON.stringify({ startFen: tree.startFen, nextId: tree.nextId, root: tree.root });
}

/**
 * The inverse of `serialize`. Shape is checked, not trusted: a persisted
 * blob from a newer or corrupt save must fail loudly here rather than as a
 * `children of undefined` three screens later.
 */
function deserialize(json) {
  const raw = typeof json === "string" ? JSON.parse(json) : json;
  if (!raw || typeof raw !== "object" || !raw.root || typeof raw.root !== "object") {
    throw new Error("game-tree: not a serialized tree");
  }
  const tree = createTree(raw.startFen || raw.root.fen);
  const ids = new Set();
  let max = 0;
  const check = (n) => {
    if (typeof n.fen !== "string" || !Array.isArray(n.children)) throw new Error("game-tree: malformed node");
    if (!Number.isInteger(n.id) || ids.has(n.id)) throw new Error("game-tree: bad or duplicate id " + n.id);
    ids.add(n.id);
    max = Math.max(max, n.id);
    n.children.forEach(check);
  };
  check(raw.root);
  // ids are kept, not renumbered: a saved cursor may point at one
  tree.root = cloneNode(raw.root, true);
  tree.nextId = Math.max(max + 1, Number(raw.nextId) || 0);
  return tree;
}

export const ChessTree = {
  START_FEN, createTree, addMove, promote, promoteToMain, deleteNode, mainline, mainlineSans, pathTo, nodeAt,
  parentOf, fenAt, setComment, setNags, setShapes, toPgnGame, fromPgnGame, renumber, serialize, deserialize,
};
export {
  createTree, addMove, promote, promoteToMain, deleteNode, mainline, mainlineSans, pathTo, nodeAt,
  parentOf, fenAt, setComment, setNags, setShapes, toPgnGame, fromPgnGame, renumber, serialize, deserialize,
};
