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
import { ChessFide } from "./fide.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);

function makeNode(id, fen) {
  return { id, san: null, from: null, to: null, promotion: null, fen, comment: null, nags: [], shapes: { arrows: [], circles: [] }, children: [] };
}

/**
 * A new tree at `startFen` (the standard array by default). The FEN is
 * normalised through chess.js so two trees of the same position compare
 * equal whatever spelling the caller used.
 *
 * `result` is the game result the tree carries, null when nothing said one:
 * a PGN may end "1-0" with no Result tag, and reading the tag alone lost it
 * on the way out again.
 */
function createTree(startFen) {
  const chess = new Chess();
  const fen = startFen ? String(startFen).trim() : START_FEN;
  if (!chess.load(fen)) throw new Error("game-tree: invalid start FEN " + JSON.stringify(fen));
  return { startFen: chess.fen(), nextId: 1, result: null, root: makeNode(0, chess.fen()) };
}

// v8-0-plan F2: an id → node index and each node's derived facts, kept
// beside the tree rather than in it. Walking the whole tree per lookup was
// the right call for the games of 6.0; at 160 plies every commit was paying
// for dozens of walks, and the replay paths re-derived every position from
// the SAN list besides. Both caches live in WeakMaps so the tree stays the
// plain object serialize() writes — nothing here ever reaches a save.
//
// The index is rebuilt whenever it cannot vouch for itself (the root was
// replaced, an id is missing); addMove / deleteNode / renumber — the only
// code that changes a tree's shape — keep it current or drop it. A node's
// facts never go stale: its fen and the path above it are fixed for as long
// as the node exists (promote reorders siblings, it never re-parents).
const INDEX = new WeakMap();
const FACTS = new WeakMap();

function indexOf(tree) {
  let ix = INDEX.get(tree);
  if (ix && ix.root === tree.root) return ix;
  ix = { root: tree.root, byId: new Map(), up: new Map() };
  const stack = [tree.root];
  while (stack.length) {
    const n = stack.pop();
    ix.byId.set(n.id, n);
    for (const c of n.children) { ix.up.set(c, n); stack.push(c); }
  }
  INDEX.set(tree, ix);
  return ix;
}

/**
 * Locate a node with the chain of ancestors that leads to it.
 * @returns {{node: object, parent: object|null, path: object[]}|null}
 *   `path` is root → … → node inclusive
 */
function find(tree, nodeId) {
  const id = Number(nodeId);
  let ix = indexOf(tree);
  let node = ix.byId.get(id);
  if (!node) { INDEX.delete(tree); ix = indexOf(tree); node = ix.byId.get(id); }
  if (!node) return null;
  const parent = ix.up.get(node) || null;
  return {
    node, parent,
    // built on demand: most callers want the node or its parent, and the
    // chain is the one part that costs the depth of the game
    get path() {
      const out = [node];
      for (let n = ix.up.get(node); n; n = ix.up.get(n)) out.push(n);
      return out.reverse();
    },
  };
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
  const ix = INDEX.get(tree);
  if (ix && ix.root === tree.root) { ix.byId.set(child.id, child); ix.up.set(child, node); }
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
  INDEX.delete(tree);
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

/**
 * A fact about the line root → node, worked out once per node and then
 * looked up (v8-0-plan F2). `step(node, above)` derives the node's value
 * from its parent's (`above` is undefined at the root); the walk climbs only
 * as far as the nearest node that already knows, so each move of a growing
 * game costs one step, not a replay. `slot` names the fact — callers own
 * their slots and must only cache what cannot change under them.
 * @returns {*} the node's value, or undefined when there is no such node
 */
function derive(tree, nodeId, slot, step) {
  const hit = find(tree, nodeId);
  if (!hit) return undefined;
  const up = indexOf(tree).up;
  const chain = [];
  let n = hit.node;
  while (n && !(FACTS.has(n) && slot in FACTS.get(n))) { chain.push(n); n = up.get(n); }
  let v = n ? FACTS.get(n)[slot] : undefined;
  for (let k = chain.length - 1; k >= 0; k--) {
    v = step(chain[k], v);
    if (!FACTS.has(chain[k])) FACTS.set(chain[k], {});
    FACTS.get(chain[k])[slot] = v;
  }
  return v;
}

/**
 * The repetition key of a node's position — ChessFide.positionKey, so the
 * placement, side to move, castling rights and an en-passant right only
 * when the capture is really playable (FIDE 9.2). Cached on the node.
 */
function nodeKey(node) {
  let f = FACTS.get(node);
  if (!f) FACTS.set(node, (f = {}));
  if (f.key === undefined) f.key = ChessFide.positionKey(node.fen, null, Chess);
  return f.key;
}

/** Plies from the root to the node (root 0). */
function depthOf(tree, nodeId) {
  return derive(tree, nodeId, "depth", (n, above) => (above === undefined ? 0 : above + 1));
}

/**
 * How many times the node's position has stood on the board along the line
 * root → node, this time included — what ChessFide.repetitionCount answers
 * by replaying the SAN list, answered once per node instead.
 */
function repetitions(tree, nodeId) {
  const hit = find(tree, nodeId);
  if (!hit) return 0;
  const f = FACTS.get(hit.node);
  if (f && f.reps !== undefined) return f.reps;
  const up = indexOf(tree).up;
  const key = nodeKey(hit.node);
  let reps = 1;
  for (let n = up.get(hit.node); n; n = up.get(n)) if (nodeKey(n) === key) reps++;
  FACTS.get(hit.node).reps = reps;
  return reps;
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
 * non-standard start position adds `SetUp`/`FEN` if the caller did not.
 *
 * The result is the one the tree carries — the movetext token the file
 * ended with, which the standard lets disagree with the Result tag and
 * which fromPgnGame put there — and only then the Result tag, for a tree
 * built move by move that never had one.
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
  const tag = r && RESULTS.has(r[1]) ? r[1] : null;
  const carried = RESULTS.has(tree.result) ? tree.result : null;
  return { headers: pairs, root: cloneNode(tree.root, false), result: carried || tag || "*" };
}

/** A tree from a pgn-parser Game — ids are assigned fresh, in preorder. */
function fromPgnGame(game) {
  const tree = createTree(game.root.fen);
  // keepId so the id slot stays first in every node: a tree built by addMove
  // and one loaded from PGN must serialize byte-for-byte alike
  tree.root = cloneNode(game.root, true);
  tree.result = RESULTS.has(game.result) ? game.result : null;
  return renumber(tree);
}

/** Preorder ids from 1, root 0 — after a load, so persisted ids stay dense. */
function renumber(tree) {
  let next = 1;
  const walk = (n) => { for (const c of n.children) { c.id = next++; walk(c); } };
  tree.root.id = 0;
  walk(tree.root);
  tree.nextId = next;
  INDEX.delete(tree);
  return tree;
}

function serialize(tree) {
  return JSON.stringify({ startFen: tree.startFen, nextId: tree.nextId, result: tree.result || null, root: tree.root });
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
  // an older blob has no result; null is "nothing said one", not "*"
  tree.result = RESULTS.has(raw.result) ? raw.result : null;
  tree.nextId = Math.max(max + 1, Number(raw.nextId) || 0);
  return tree;
}

export const ChessTree = {
  START_FEN, createTree, addMove, promote, promoteToMain, deleteNode, mainline, mainlineSans, pathTo, nodeAt,
  parentOf, fenAt, setComment, setNags, setShapes, toPgnGame, fromPgnGame, renumber, serialize, deserialize,
  derive, nodeKey, depthOf, repetitions,
};
export {
  createTree, addMove, promote, promoteToMain, deleteNode, mainline, mainlineSans, pathTo, nodeAt,
  parentOf, fenAt, setComment, setNags, setShapes, toPgnGame, fromPgnGame, renumber, serialize, deserialize,
  derive, nodeKey, depthOf, repetitions,
};
