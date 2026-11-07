/**
 * 动效曲线：画布与样式表用同一条贝塞尔。
 *
 * v8-0-plan A5: the stylesheet has had one easing curve since 1.13 (--ease,
 * guarded by test-chess), and the board's canvas animations ran a second one
 * of their own — a quadratic easeOut written in board.js, so a piece's slide
 * and the panel's slide beside it started and settled differently. The
 * canvas cannot say `cubic-bezier(…)`, so the curve is read from --ease and
 * turned into a lookup table here: sampled once along the curve's parameter,
 * then answered for any t by a binary search and a straight line between two
 * samples. 64 samples keep the error under 0.002 for the curves CSS allows.
 *
 * Pure: a string in, a function out. board.js reads the variable.
 * @module motion
 */

/** The curve the stylesheet ships with, for a page whose --ease is not readable. */
const FALLBACK = [0.22, 1, 0.36, 1];

/**
 * The four numbers of `cubic-bezier(x1, y1, x2, y2)`, or null for anything
 * else (a keyword, an empty variable). x1 and x2 must lie in [0, 1], as CSS
 * requires — that is what makes the curve a function of time.
 * @param {string} css
 * @returns {number[]|null}
 */
export function parseBezier(css) {
  const m = /cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/.exec(String(css || ""));
  if (!m) return null;
  const v = m.slice(1).map(Number);
  if (v.some((x) => !Number.isFinite(x)) || v[0] < 0 || v[0] > 1 || v[2] < 0 || v[2] > 1) return null;
  return v;
}

/**
 * The easing function of a cubic Bézier from (0,0) to (1,1), as a table.
 * @param {number} x1
 * @param {number} y1
 * @param {number} x2
 * @param {number} y2
 * @param {number} [samples]
 * @returns {(t: number) => number} progress 0..1 → eased 0..1 (ends exact)
 */
export function bezierEase(x1, y1, x2, y2, samples = 64) {
  const at = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
  const xs = new Float64Array(samples + 1), ys = new Float64Array(samples + 1);
  for (let k = 0; k <= samples; k++) {
    const u = k / samples;
    xs[k] = at(x1, x2, u);
    ys[k] = at(y1, y2, u);
  }
  return (t) => {
    if (!(t > 0)) return 0;
    if (t >= 1) return 1;
    let lo = 0, hi = samples;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= t) lo = mid; else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    const f = span > 0 ? (t - xs[lo]) / span : 0;
    return ys[lo] + (ys[hi] - ys[lo]) * f;
  };
}

/**
 * The easing function for a CSS value — --ease, read off the page.
 * @param {string} css e.g. "cubic-bezier(0.22, 1, 0.36, 1)"
 */
export function easeFromCss(css) {
  const v = parseBezier(css) || FALLBACK;
  return bezierEase(v[0], v[1], v[2], v[3]);
}

export const ChessMotion = { parseBezier, bezierEase, easeFromCss, FALLBACK };
