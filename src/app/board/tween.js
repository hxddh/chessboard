/**
 * Motion parameters (v20-0-plan §5 H): 250 ms by default on a cubic in-out
 * curve; anything shorter than 70 ms is not animated at all, and under
 * prefers-reduced-motion nothing is.
 * @module board/tween
 */
export const DEFAULT_MS = 250;
export const MIN_MS = 70;
export const DRAG_THRESHOLD_PX = 3;

export function cubicInOut(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/** The duration actually used for an animation of `ms`. */
export function effectiveMs(ms, reducedMotion = false) {
  if (reducedMotion || !(ms >= MIN_MS)) return 0;
  return ms;
}

/** Progress 0–1 of a tween that started at `start` and lasts `dur`. */
export const progress = (start, dur, now) => (dur <= 0 ? 1 : Math.max(0, Math.min(1, (now - start) / dur)));

/** Interpolate the numeric props of `from` towards `to`. */
export function lerpProps(from, to, t) {
  const out = {};
  for (const k of Object.keys(to)) {
    const a = from[k], b = to[k];
    out[k] = typeof a === "number" && typeof b === "number" ? a + (b - a) * t : b;
  }
  return out;
}
