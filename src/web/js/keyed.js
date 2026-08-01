/**
 * Minimal keyed list updates.
 *
 * The lists in this app are rebuilt wholesale: the move list on every move,
 * the game history at up to 500 rows, the puzzle set at 168, the course at 72.
 * Rebuilding is simple and, for a list of this size, fast enough — but it
 * throws away the nodes, and with them two things the user was relying on:
 *
 *   the scroll position — restored by hand afterwards, which is why
 *   renderMoveList() ends by measuring offsetTop and putting the scroll back;
 *
 *   the focus — not restored at all. Tab to a move, have the clock tick, and
 *   focus is on <body>.
 *
 * Neither is a bug you would file. Both are the difference between a list that
 * feels like an object and one that feels like a page reload.
 *
 * The trick is that a row only has to be rebuilt when it *says* something
 * different. A signature per row is enough to know: for a move that is
 * `san + annotation + is-it-the-current-one`, and on a normal move exactly one
 * row's signature changes.
 *
 * @module keyed
 */

/**
 * Bring `parent`'s children into line with `items`, touching as little as
 * possible.
 *
 * @param {Element} parent
 * @param {Array} items
 * @param {(item, i) => string} keyOf identity — stable across renders
 * @param {(item, i) => string} sigOf everything the row displays
 * @param {(item, i, reuse: Element|null) => Element} build makes (or refills)
 *   a row; gets the existing node when there is one to reuse
 * @returns {number} how many rows were built or rebuilt
 */
export function reconcile(parent, items, keyOf, sigOf, build) {
  const have = new Map();
  for (const node of Array.prototype.slice.call(parent.children)) {
    const k = node.dataset && node.dataset.k;
    if (k != null) have.set(k, node);
  }

  let built = 0;
  const want = [];
  for (let i = 0; i < items.length; i++) {
    const key = String(keyOf(items[i], i));
    const sig = String(sigOf(items[i], i));
    let node = have.get(key);
    if (!node || node.dataset.sig !== sig) {
      node = build(items[i], i, node || null);
      node.dataset.k = key;
      node.dataset.sig = sig;
      built++;
    }
    want.push(node);
  }

  // Move only what is out of place. Not replaceChildren(...want): re-inserting
  // a node is enough to blur it, so a list that "did not change" would still
  // drop the focus this whole exercise exists to keep.
  for (let i = 0; i < want.length; i++) {
    if (parent.childNodes[i] !== want[i]) parent.insertBefore(want[i], parent.childNodes[i] || null);
  }
  while (parent.childNodes.length > want.length) parent.removeChild(parent.lastChild);
  return built;
}
