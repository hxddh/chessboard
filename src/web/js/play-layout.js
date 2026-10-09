/**
 * The play view stretches with its window (v8-0-plan §2 A2).
 *
 * Three things the stylesheet cannot do alone, each a small observer:
 *
 *   the wide layout   At 1920×1080 the board stood in the middle of 1480px
 *                     with 258px of nothing on each side, because the panel
 *                     stopped at 440 and the board is height-bound. From a
 *                     play view 1280 wide the two player strips leave the
 *                     board's top and bottom edges for a column on its left
 *                     (who, the clock, the opening's name), the board takes
 *                     the height they gave back, and the panel on the right
 *                     takes what is left, up to 520. Whether that layout
 *                     fits is a question about the play view's own box —
 *                     not the window's, since a navigation rail may stand
 *                     beside it — and a stylesheet cannot ask it without
 *                     container queries, which the bundle cannot use (Safari
 *                     15). So it is measured here and answered with a class
 *                     (`pv-wide`), the way fit-row.js answers `.side-wide`,
 *                     and the play view's size goes to the stylesheet as
 *                     --pv-w / --pv-h for the arithmetic.
 *   the move columns  The notation is a three-column table — number, White,
 *                     Black — whose White column is as wide as its widest
 *                     move and no wider. Each row is its own grid (a row is
 *                     a box the tests, the hover preview and the keyboard
 *                     all rely on), so the shared width is measured and
 *                     written to --ml-w. Measured by a ResizeObserver on the
 *                     White cells, which reports after layout, so reading a
 *                     size never forces one (F2 counted the list's forced
 *                     layouts as half of a replay step).
 *   the move strip    In a portrait window the drawer's first screen used to
 *                     be tabs and the opening name, with the notation below
 *                     the fold. A strip of the mainline, one line that
 *                     scrolls sideways to the move on the board, now stands
 *                     at the top of the drawer. It mirrors #move-list — the
 *                     one place the notation is rendered — and a press on a
 *                     move clicks the same move there, so the two can never
 *                     disagree about what a move does. Pointer only: the
 *                     list is the keyboard's and the screen reader's route,
 *                     and a second copy of it in the tab order would be noise.
 *
 * Nothing here rebuilds a node under a pressed button (7.6): the strip is
 * keyed like the list, and the other two only write a class or a property.
 * @module play-layout
 */
import { reconcile } from "./keyed.js";
import { watchFitRows } from "./fit-row.js";

/** The play view's width from which the wide layout is considered (A2). */
export const WIDE_MIN = 1280;

/**
 * The board frame's edge in the two landscape layouts, and the panel's width
 * in the wide one, from the play view's size. `k` holds the stylesheet's
 * lengths (see readTokens); pure, so scripts/test-chess.mjs checks the rule
 * without a browser.
 *
 *   two   7.7's: a player strip above and below the board, the panel on
 *         the right — at least 7.7's clamp(284, 30%, 440) (`side`, the floor
 *         the reading pages were sized for), and since the M2 merge also
 *         whatever width the height-bound board leaves, up to sideMax
 *         (`sideTwo`): beside a 64px rail the wide layout no longer fits at
 *         1280 / 1440, and that leftover stood as an 84–90px empty band
 *         either side of the board (A2: the right column stretches to ~520)
 *   wide  A2's: the info column on the left, no strips above or below, the
 *         panel what the height-bound board leaves, never narrower than the
 *         two-column floor and at most sideMax
 *
 * styles.css computes the same two panels (#app --side-w, #app.pv-wide
 * --side-w); scripts/test-chess.mjs checks the two agree.
 */
export function boardEdges(w, h, k) {
  const side = Math.min(440, Math.max(284, 0.3 * w));
  const high = h - k.chrome - 2 * k.strip - k.padY;
  const sideTwo = Math.min(k.sideMax, Math.max(side, w - 2 * k.pad - high));
  const two = Math.min(w - sideTwo - 2 * k.pad, high);
  const tall = h - k.chrome - 2 * k.padY;
  const room = w - k.info - k.gap - 2 * k.pad;
  const right = Math.min(k.sideMax, Math.max(side, room - tall));
  return { two, wide: Math.min(tall, room - right), right, side, sideTwo };
}

/**
 * The wide layout is used where the play view is at least WIDE_MIN wide,
 * landscape, and the board is no smaller in it than in the two-column one —
 * so switching to it can only ever give the board room (A2: 棋盘占比不低于现在).
 */
export function isWide(w, h, k) {
  if (w < WIDE_MIN || w <= h) return false;
  const e = boardEdges(w, h, k);
  return e.wide >= e.two;
}

/** The lengths boardEdges needs, as the stylesheet declares them. */
function readTokens(el) {
  const cs = getComputedStyle(el);
  const px = (n) => parseFloat(cs.getPropertyValue(n)) || 0;
  return { chrome: px("--chrome-h"), strip: px("--strip-h"), pad: px("--stage-pad"), padY: px("--stage-pad-y"),
           info: px("--info-w"), gap: px("--info-gap"), sideMax: px("--side-max-wide") };
}

/**
 * Keep the play view's size in --pv-w / --pv-h on `app`, and its layout in
 * `pv-wide`. The play view is `view` (.stage): #app less the navigation
 * rail beside it (v8-0-plan A1), which is #app's but not the play view's.
 */
function watchShape(app, view) {
  let k = null, last = "", frame = 0;
  const apply = () => {
    frame = 0;
    const w = view.clientWidth, h = view.clientHeight;
    if (!w || !h) return;
    // an unchanged size writes nothing: every write re-lays-out the panel
    if (w + "x" + h === last) return;
    last = w + "x" + h;
    if (!k) k = readTokens(app);
    app.style.setProperty("--pv-w", w + "px");
    app.style.setProperty("--pv-h", h + "px");
    app.classList.toggle("pv-wide", isWide(w, h, k));
  };
  apply();
  // From the observer, a frame later, as fit-row.js does: since the two-
  // column panel takes the width the board leaves (--pv-w, v8-0-plan A2),
  // writing here resized boxes other observers (the canvas, the move list)
  // were delivered in the same pass, and WebKit raised "ResizeObserver loop
  // completed with undelivered notifications" (#86, layout shard 2).
  const soon = () => { if (!frame) frame = requestAnimationFrame(apply); };
  if (typeof ResizeObserver === "function") new ResizeObserver(soon).observe(view);
  else window.addEventListener("resize", soon);
}

/** The White column: the first cell after each row's number. */
const WHITE = ".mlrow > .mlnum + .mlmove";

/**
 * 9.0: the list centres the current move when it renders (app.js), but what
 * is inside it can grow afterwards without the list's own box changing — the
 * White column is re-measured (--ml-w), a font arrives, a row refits — and
 * the move it centred slides below the edge (WebKit, a 120-move game at
 * 1024×768: scrollTop 1234 of 1278, the current move 44px under the edge).
 * So the rows are watched as well as the list: when the list or any row
 * changes size, bring the current move back if it is no longer inside.
 * @param {HTMLElement} list
 */
function keepCurrentInView(list) {
  if (typeof ResizeObserver !== "function") return;
  let frame = 0, tries = 0;
  const check = () => {
    frame = 0;
    const cur = list.querySelector(".current");
    if (!cur) return;
    const c = cur.getBoundingClientRect(), l = list.getBoundingClientRect();
    if (c.top >= l.top - 0.5 && c.bottom <= l.bottom + 0.5) { tries = 0; return; }
    // past the end is asked for as the end (app.js renderMoveList: WebKit)
    const want = list.scrollTop + c.top - l.top - list.clientHeight / 2;
    list.scrollTop = want >= list.scrollHeight - list.clientHeight - 1 ? list.scrollHeight : Math.max(0, want);
    // WebKit's scroll range can lag its own layout by a few frames with
    // nothing to say it grew (1234 of 1278 for the first frames, then 1278,
    // no resize, no mutation): look again on the next frames, a bounded number
    if (++tries < 30) frame = requestAnimationFrame(check);
  };
  const soon = () => { tries = 0; if (!frame) frame = requestAnimationFrame(check); };
  const sizes = new ResizeObserver(soon);
  sizes.observe(list);
  for (const row of list.children) sizes.observe(row);
  new MutationObserver((recs) => {
    for (const r of recs) {
      for (const n of r.removedNodes) if (n.nodeType === 1) sizes.unobserve(n);
      for (const n of r.addedNodes) if (n.nodeType === 1 && n.parentNode === list) sizes.observe(n);
    }
    soon();
  }).observe(list, { childList: true, subtree: true });
}

/** Keep --ml-w on `list` equal to its widest White cell. */
function watchColumns(list) {
  if (typeof ResizeObserver !== "function") return;
  const widths = new WeakMap();
  let last = "";
  // from the cached widths only: this never reads layout
  const recompute = () => {
    let max = 0;
    for (const c of list.querySelectorAll(WHITE)) max = Math.max(max, widths.get(c) || 0);
    const v = max ? Math.ceil(max) + "px" : "";
    if (v === last) return;
    last = v;
    if (v) list.style.setProperty("--ml-w", v); else list.style.removeProperty("--ml-w");
  };
  // a ResizeObserver reports after layout: the sizes read here are free
  const ro = new ResizeObserver((entries) => {
    for (const e of entries) widths.set(e.target, e.target.getBoundingClientRect().width);
    recompute();
  });
  const cells = (n) => (n.nodeType !== 1 ? [] : n.matches(WHITE) ? [n] : [...n.querySelectorAll(WHITE)]);
  // how many blocks the list holds: its floor in styles.css is "seven rows,
  // or all of them if there are fewer", and CSS cannot count children
  let rows = -1;
  const count = () => {
    if (list.children.length !== rows) { rows = list.children.length; list.style.setProperty("--ml-rows", String(rows)); }
  };
  // only the cells that came and went: a move rebuilds one row (keyed.js)
  new MutationObserver((recs) => {
    count();
    let gone = false;
    for (const r of recs) {
      for (const n of r.addedNodes) for (const c of cells(n)) ro.observe(c);
      for (const n of r.removedNodes) for (const c of cells(n)) { ro.unobserve(c); gone = true; }
    }
    if (gone) recompute();
  }).observe(list, { childList: true, subtree: true });
  for (const c of list.querySelectorAll(WHITE)) ro.observe(c);
  count();
}

/**
 * The strip is a portrait window's (styles.css shows it there only), and the
 * same query decides here whether it is kept up to date: in a landscape
 * window, mirroring every move would be work for a box nobody sees.
 */
const PORTRAIT = "(max-aspect-ratio: 1/1)";

/** The portrait strip: `strip` mirrors the mainline rows of `list`. */
function watchStrip(list, strip) {
  const mq = typeof window.matchMedia === "function" ? window.matchMedia(PORTRAIT) : null;
  const render = () => {
    if (!mq || !mq.matches) return;
    const items = [];
    for (const row of list.querySelectorAll(":scope > .mlrow")) {
      const num = row.querySelector(".mlnum");
      if (num) items.push({ key: "n" + row.dataset.k, sig: num.textContent, num: num.textContent });
      for (const mv of row.querySelectorAll(".mlmove")) {
        if (mv.classList.contains("mlgap")) continue;
        // a node never changes its move, so its text says the rest: NAGs, the review tag
        items.push({ key: "m" + mv.dataset.node, sig: mv.textContent + (mv.classList.contains("current") ? "*" : ""), mv });
      }
    }
    reconcile(strip, items, (it) => it.key, (it) => it.sig, (it, _i, reuse) => {
      if (it.num) {
        const s = reuse || document.createElement("span");
        s.className = "ms-num";
        s.textContent = it.num;
        return s;
      }
      const b = reuse || document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      b.className = "ms-move" + (it.mv.classList.contains("current") ? " current" : "");
      b.dataset.node = it.mv.dataset.node;
      b.replaceChildren(...[...it.mv.childNodes].map((n) => n.cloneNode(true)));
      return b;
    });
    strip.hidden = !items.length;
    // the move on the board, in view — scrolled within the strip only
    const cur = strip.querySelector(".current") || strip.lastElementChild;
    if (cur) strip.scrollLeft = Math.max(0, cur.offsetLeft + cur.offsetWidth - strip.clientWidth + 16);
  };
  strip.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-node]");
    const twin = b && list.querySelector('.mlmove[data-node="' + b.dataset.node + '"]');
    if (twin) twin.click();
  });
  new MutationObserver(render).observe(list, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  if (mq && mq.addEventListener) mq.addEventListener("change", render);
  else if (mq && mq.addListener) mq.addListener(render);
  render();
}

/** In the wide layout the opening's name stands in the info column. */
function watchOpening(src, dst) {
  const copy = () => {
    dst.textContent = src.textContent;
    dst.hidden = src.hidden;
    dst.classList.toggle("vacant", src.classList.contains("vacant"));
  };
  new MutationObserver(copy).observe(src, { childList: true, characterData: true, subtree: true, attributes: true, attributeFilter: ["hidden", "class"] });
  copy();
}

/**
 * Wire the play view's layout. `d` names the elements, so this module never
 * looks anything up by a guess: { app, view, side, list, strip, opening,
 * infoOpening } — `view` the play view's own box (.stage), where it is not
 * all of `app`. The panel's action rows (fit-row.js, 7.9 §1b) are the
 * panel's half of the same job and are wired here with the rest.
 */
export function watchPlayLayout(d) {
  if (d.app) watchShape(d.app, d.view || d.app);
  if (d.side) watchFitRows(d.side);
  // 9.0 V1: a label is one line everywhere (white-space: nowrap), so the
  // action rows on the pages and in 偏好设置 step their columns down too
  for (const el of document.querySelectorAll(".page")) watchFitRows(el, { wide: false });
  if (d.list) { watchColumns(d.list); keepCurrentInView(d.list); }
  if (d.list && d.strip) watchStrip(d.list, d.strip);
  if (d.opening && d.infoOpening) watchOpening(d.opening, d.infoOpening);
}
