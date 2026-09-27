/**
 * Equal-width action rows whose labels never wrap (v7-9-plan §1b).
 *
 * The panel's action groups — 复盘 (分析 / 精析 / 重下 / 持续分析), 本局
 * (提和 / 判和 / 新局 / 认输), 更多, and the lesson and puzzle rows — are a
 * grid of equal cells across the column. On 7.8.0 they were 72px tracks packed
 * to the left, so the right half of a 400px panel was empty, and English broke
 * 「Live analysis」 and 「Offer draw」 over two lines at that width.
 *
 * Whether three labels fit across depends on the language and on the window,
 * and a stylesheet can know neither: `repeat(auto-fit, minmax(max-content,
 * 1fr))` is not valid CSS, and a fixed minimum is either too wide for Chinese
 * or too narrow for English. So the count is measured. Each row tries its
 * widest layout and steps down, and the first one in which every visible label
 * fits on one line wins:
 *
 *   an action row (.fit-row)       3 → 2 → 1, or 4 → 2 → 1 with exactly four
 *                                  shown (3 + 1 is the orphan the segment rules
 *                                  in styles.css exist to prevent); the puzzle
 *                                  type segment is one of these too
 *   a lesson row (.fit-row.fit-fill)  as many columns as buttons → 2 → 1
 *
 * The answer is written to the row's --cols; styles.css does the rest.
 *
 * When. A row changes what it holds on a commit (an action appears or goes,
 * a label is rewritten by a language switch) and changes width with the
 * window. The first is a mutation, and the fit runs in the observer's callback
 * — a microtask, before the frame is painted, so a wrapped or clipped label is
 * never on screen. The second is a ResizeObserver, deferred to the next frame:
 * a re-fit changes the row's height, and doing that inside the observer's own
 * callback is the "loop completed with undelivered notifications" error.
 * Nothing here touches a button's subtree, only the row's style, so a press
 * that is under way is never rebuilt (7.6).
 * @module fit-row
 */

const shown = (b) => !b.hidden && getComputedStyle(b).display !== "none";

/** The column counts a row may use, widest first. */
function tries(row, n) {
  if (row.classList.contains("fit-fill")) return [...new Set([n, 2, 1])].filter((c) => c <= n);
  return n === 4 ? [4, 2, 1] : [3, 2, 1];
}

/**
 * Give `row` the widest column count at which no visible label overflows.
 * A row that is not laid out (its tab is hidden) keeps what it had.
 * @param {HTMLElement} row
 */
export function fitRow(row) {
  if (!row.getClientRects().length) return;
  const items = [...row.children].filter(shown);
  if (!items.length) return;
  for (const c of tries(row, items.length)) {
    row.style.setProperty("--cols", String(c));
    if (items.every((b) => b.scrollWidth <= b.clientWidth)) return;
  }
}

/**
 * Keep every `.fit-row` under `root` fitted from now on.
 * @param {ParentNode} root
 */
export function watchFitRows(root) {
  const rows = [...root.querySelectorAll(".fit-row")];
  const all = () => { for (const r of rows) fitRow(r); };
  let frame = 0;
  const soon = () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; all(); });
  };
  const mo = new MutationObserver(all);
  const ro = typeof ResizeObserver === "function" ? new ResizeObserver(soon) : null;
  for (const r of rows) {
    // not "style": that is this module's own write
    mo.observe(r, { subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: ["hidden", "disabled", "class"] });
    if (ro) ro.observe(r);
  }
  // a label measured in the fallback face is narrower or wider than the same
  // label once the real one arrives
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(all);
  all();
}
