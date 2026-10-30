/**
 * The chosen segment slides (v16-0-plan §3 M).
 *
 * Up to 15.x the chosen segment of a segmented control was the button itself,
 * raised (.theme-row button.active): pick another and the raised block
 * vanished from one place and appeared in the other. Now one block — the
 * row's ::before, in the same fill, edge and level — stands behind the chosen
 * button, and moves to the new one over --dur-base on the stylesheet's curve.
 *
 * Only one-line rows (.theme-row without .wrap): a wrapped segment is a grid
 * whose rows the block would have to cross. Where the block is, this writes
 * the row's --thumb-x / -y / -w / -h, measured from the chosen button, and
 * the class has-thumb (styles.css then clears the button's own raised fill);
 * thumb-live, one frame later, turns the travel on — so the first placing,
 * and a row coming out of a hidden tab, are not animated from the corner.
 * Under "reduce motion" the stylesheet keeps only colour and opacity
 * transitions, so the block jumps.
 *
 * When: the chosen class moves (a MutationObserver on the row, as fit-row.js
 * watches its rows), and the row changes size (a ResizeObserver, deferred a
 * frame). Nothing here touches a button; only the row's style and classes.
 * @module seg-thumb
 */

/** Put the block under `row`'s chosen button, or take it away. */
export function placeThumb(row) {
  const on = row.querySelector(":scope > button.active");
  const box = row.getBoundingClientRect();
  const r = on && !on.hidden ? on.getBoundingClientRect() : null;
  if (!r || !r.width || !box.width) {
    // only if there: remove() rewrites the class attribute even when it
    // changes nothing, and the row's own observer would call this again
    if (row.classList.contains("has-thumb")) row.classList.remove("has-thumb", "thumb-live");
    return;
  }
  const set = (k, v) => row.style.setProperty("--thumb-" + k, Math.round(v * 100) / 100 + "px");
  set("x", r.left - box.left - row.clientLeft);
  set("y", r.top - box.top - row.clientTop);
  set("w", r.width);
  set("h", r.height);
  if (!row.classList.contains("has-thumb")) {
    row.classList.add("has-thumb");
    requestAnimationFrame(() => row.classList.add("thumb-live"));
  }
}

/**
 * Keep every one-line segment under `root` placed from now on.
 * @param {ParentNode} root
 */
export function watchSegThumbs(root) {
  const rows = [...root.querySelectorAll(".theme-row:not(.wrap)")];
  if (!rows.length || typeof MutationObserver !== "function") return;
  const mo = new MutationObserver((recs) => {
    for (const row of new Set(recs.map((x) => x.target.closest(".theme-row")))) if (row) placeThumb(row);
  });
  const ro = typeof ResizeObserver === "function"
    ? new ResizeObserver((es) => requestAnimationFrame(() => { for (const e of es) placeThumb(e.target); }))
    : null;
  for (const row of rows) {
    mo.observe(row, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "hidden"] });
    if (ro) ro.observe(row);
    placeThumb(row);
  }
}
