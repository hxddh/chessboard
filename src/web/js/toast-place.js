/**
 * Where a toast stands: never on the board (7.7 §1d).
 *
 * It stood 24px above the bottom of the window, centred on the window, and
 * in every landscape window the board runs to within 6px of that edge — so
 * 「本局结束 —— 点『分析』看这盘的回顾」 and 「分析完成」 sat on e1 and f1,
 * over the very position they were talking about, and a fault toast stayed
 * there until dismissed. It was also centred on the window, which is not
 * the board's middle whenever the panel is open beside it.
 *
 * Now it is centred on the board, no wider than it, and stands where the
 * board is not:
 *   - its old place, 24px off the bottom, wherever that is clear of the
 *     board — the portrait windows, where it lies over the sheet's reserve
 *     as it always did;
 *   - otherwise the strip above the board: the chrome's row down to the
 *     first rank, 55px in the landscape layout, which a one-line toast
 *     clears with room either side. It covers the middle of the chrome for
 *     its two seconds, which is the price of not covering the position;
 *   - a message that wraps past that strip goes under the squares if there
 *     is room there, and only a window with neither lets it overlap, at the
 *     top, as little as it can.
 *
 * 15.0 S3: the strip above the board names the opponent, the puzzle or the
 * lesson, and the one under it is the trainers' bar or the result bar — a
 * toast over either covered the very line it was about. Where the window
 * has room beside the board it stands in the bottom right corner, over
 * nothing; the bottom place is taken only clear of the strip under the
 * board, not just of the squares.
 * @module toast-place
 */
/**
 * @param {HTMLElement} el the toast
 * @param {HTMLElement} appEl #app, the box it is placed in
 */
export function placeToastAt(el, appEl) {
  // 9.0 M1: the result bar holds the bottom strip's place — not under a toast
  const barUp = () => { const c = document.getElementById("go-card"); return !!c && !c.hidden && !appEl.classList.contains("pv-wide"); };
  const board = document.getElementById("board");
  const wrap = document.getElementById("board-wrap");
  if (!el || !board || !wrap || !appEl) return;
  const a = appEl.getBoundingClientRect();
  const b = board.getBoundingClientRect();
  const w = wrap.getBoundingClientRect();
  if (!b.width) return; // not laid out (a hidden window): keep the stylesheet's place
  el.style.maxWidth = Math.round(Math.max(200, Math.min(560, w.width - 16))) + "px";
  // measured where it has the most room — near an edge an absolute box shrinks to fit
  el.style.width = "";
  el.style.left = Math.round(w.left - a.left + w.width / 2) + "px";
  const h = el.offsetHeight;
  const GAP = 4, LOW = 24, EDGE = 16;
  // 7.8 §1d: nor on the drawer. In a portrait window the panel is a sheet
  // from the bottom, and the bottom place put 「成就解锁 · 首胜」 over the
  // result card's second button. A place that would cross the sheet is not
  // taken; the strip above the board is what is left.
  const sideEl = document.getElementById("side");
  const s = sideEl ? sideEl.getBoundingClientRect() : null;
  const cx = w.left + w.width / 2, half = el.offsetWidth / 2;
  const onSheet = (y) => !!s && s.width > 0 && a.top + y < s.bottom && a.top + y + h > s.top &&
    cx - half < s.right && cx + half > s.left;
  // 9.0 V3: the top bar's row is gone on a wide window — over the top
  // strip, then, ending where the board begins
  // what stands under the board: the bottom strip, or the bar in its place
  const under = Math.max(w.bottom, ...[...wrap.querySelectorAll(":scope > .pstrip.at-bottom, :scope > .tr-bar, :scope > .go-card")]
    .map((n) => n.getBoundingClientRect()).filter((r) => r.height > 0 && r.left < w.right && r.right > w.left).map((r) => r.bottom));
  const stage = document.querySelector(".stage");
  const room = stage ? Math.min(stage.getBoundingClientRect().right, s && s.width > 0 && s.left > b.right ? s.left : Infinity) - b.right : 0;
  if (room >= el.offsetWidth + 2 * EDGE) {
    el.style.width = el.offsetWidth + "px";
    el.style.top = Math.round(a.height - LOW - h) + "px";
    el.style.left = Math.round(b.right - a.left + room - EDGE - half) + "px";
    return;
  }
  const top = a.bottom - under >= h + LOW + GAP && !onSheet(a.height - LOW - h) ? a.height - LOW - h
    : b.top - a.top < h + 2 * GAP && a.bottom - b.bottom >= h + 2 * GAP && !onSheet(b.bottom - a.top + GAP) && !barUp() ? b.bottom - a.top + GAP
    : Math.max(0, Math.min(GAP, b.top - a.top - h));
  el.style.top = Math.round(top) + "px";
  el.style.left = Math.round(w.left - a.left + w.width / 2) + "px";
}
