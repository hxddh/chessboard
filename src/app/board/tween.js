/**
 * Motion parameters (v20-0-plan §5 H, from chessground): 250 ms by default on
 * a cubic in-out curve; anything shorter than 70 ms is not animated at all,
 * and under prefers-reduced-motion nothing is. A drag starts past 3 px.
 *
 * The rest of the board's motion is scaled from the move's duration, so the
 * "fast" and "slow" settings change all of it together:
 *   lift      a man in the hand is drawn 1.1× with a soft drop shadow
 *   settle    dropped, it lands from 1.1× (and from where it was let go) in
 *             half the move's time, at most 120 ms — the "haptic" click
 *   snap-back let go anywhere but a legal square, it slides home from the
 *             pointer in 0.7× the move's time, at most 180 ms
 *   capture   the man taken fades to nothing and shrinks to 0.8× over the move
 *   hover     the legal square under a man in the hand lights in ≤ 90 ms
 * @module board/tween
 */
export const DEFAULT_MS = 250;
export const MIN_MS = 70;
export const DRAG_THRESHOLD_PX = 3;
export const LIFT_SCALE = 1.1;
export const CAPTURE_SCALE = 0.8;
export const SETTLE_MAX_MS = 120;
export const SNAPBACK_MAX_MS = 180;
export const HOVER_MAX_MS = 90;

/** Durations derived from a move's effective duration (0 when motion is off). */
export const settleMs = (ms) => (ms > 0 ? Math.min(SETTLE_MAX_MS, Math.round(ms / 2)) : 0);
export const snapbackMs = (ms) => (ms > 0 ? Math.min(SNAPBACK_MAX_MS, Math.round(ms * 0.7)) : 0);
export const hoverMs = (ms) => (ms > 0 ? Math.min(HOVER_MAX_MS, ms) : 0);

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
