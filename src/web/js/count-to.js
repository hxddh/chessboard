/**
 * A figure that moves to its new value (v12-0-plan F).
 *
 * A rating, an accuracy, a count that changes where the player is looking
 * runs from the old value to the new one over twice --dur-slow (600 ms) on the
 * stylesheet's own curve, instead of jumping. Under "reduce motion", the
 * first time a figure is shown, or when nothing readable was there before, it
 * is simply written. Integers only; the last frame writes exactly `to`.
 * @module count-to
 */

import { easeFromCss } from "./motion.js";

const running = new WeakMap();

function reduced() {
  try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (_) { return false; }
}

/**
 * Write `to` into `el`, counting from what `el` shows now.
 * @param {HTMLElement} el
 * @param {number} to
 */
export function countTo(el, to) {
  if (!el) return;
  const target = Math.round(to);
  const from = Number((el.textContent || "").replace(/[^\d-]/g, ""));
  const stop = running.get(el);
  if (stop) stop();
  if (!el.textContent || !Number.isFinite(from) || from === target || reduced() || typeof requestAnimationFrame !== "function") {
    el.textContent = String(target);
    return;
  }
  let ease = (t) => t;
  let ms = 600;
  try {
    const cs = getComputedStyle(document.documentElement);
    ease = easeFromCss(cs.getPropertyValue("--ease"));
    const raw = cs.getPropertyValue("--dur-slow");
    const d = parseFloat(raw);
    if (d >= 0) ms = 2 * d * (/ms/.test(raw) ? 1 : 1000);
  } catch (_) { /* the defaults */ }
  const t0 = performance.now();
  let on = true;
  running.set(el, () => { on = false; });
  const step = (now) => {
    if (!on) return;
    const k = ms > 0 ? Math.min(1, (now - t0) / ms) : 1;
    el.textContent = String(Math.round(from + (target - from) * ease(k)));
    if (k < 1) requestAnimationFrame(step);
    else running.delete(el);
  };
  requestAnimationFrame(step);
}

export const ChessCountTo = { countTo };
