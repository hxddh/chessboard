/**
 * 12.0 C: the charts' one dress.
 *
 * Through 11.0 each canvas chart read its own colours: the eval curve
 * --data and --line, the rating and accuracy sparklines --accent for the
 * line itself (the brightest ink on the page, for the least important
 * picture on it), the calendar --accent, the library's bars --muted. Five
 * readers, three ideas of what a chart is drawn in. Now there are five
 * tokens (styles.css, :root), and every chart takes them from here:
 *
 *   --chart-line   the data: one thin line, the colour of data (--data)
 *   --chart-area   how strongly the area under it is filled (an alpha)
 *   --chart-grid   a reference line — 50 %, a starting rating — a hairline
 *   --chart-now    the one point that is "now": the board's position, the
 *                  latest rating — the accent, once per chart
 *   --chart-label  axis words and numbers
 *
 * layout e2e 3m6 holds the line and the "now" to 3:1 against the panel in
 * all four themes (WCAG 1.4.11, graphics).
 * @module charts
 */

/** The chart tokens as the document has them now (read per draw: a theme change is when they move). */
export function chartTokens(doc) {
  const css = getComputedStyle(doc.documentElement);
  const v = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
  const area = Number(v("--chart-area", "0.12"));
  return {
    line: v("--chart-line", "#999"),
    area: Number.isFinite(area) ? area : 0.12,
    grid: v("--chart-grid", "#555"),
    now: v("--chart-now", "#e8c39e"),
    label: v("--chart-label", "#999"),
    // a value printed on a chart is text, in the text colour
    ink: v("--text", "#ddd"),
    panel: v("--panel", "#222"),
  };
}

/** Size a canvas's backing store to its box; null when it has no box to draw in. */
export function fitCanvas(cv) {
  if (!cv.clientWidth || !cv.clientHeight) return null;
  const dpr = (typeof window !== "undefined" && window.devicePixelRatio) || 1;
  const W = Math.max(1, Math.round(cv.clientWidth * dpr));
  const H = Math.max(1, Math.round(cv.clientHeight * dpr));
  if (cv.width !== W) cv.width = W;
  if (cv.height !== H) cv.height = H;
  const ctx = cv.getContext("2d");
  ctx.clearRect(0, 0, W, H);
  return { ctx, W, H, dpr };
}

/**
 * Where the points of a sparkline go, in device pixels — pure, so the unit
 * tests can hold it: `ys` over [lo, hi], a `pad` margin all round.
 * @returns {Array<{x:number, y:number}>}
 */
export function sparkPoints(ys, lo, hi, W, H, pad) {
  const n = ys.length - 1;
  const span = Math.max(1e-9, hi - lo);
  return ys.map((v, i) => ({
    x: n ? (i / n) * (W - 2 * pad) + pad : W / 2,
    y: H - pad - (Math.max(lo, Math.min(hi, v)) - lo) / span * (H - 2 * pad),
  }));
}

/**
 * A sparkline: a reference hairline at `ref`, a faint area under one thin
 * line, every point dotted when `dots`, and the last one in --chart-now.
 * Nothing is drawn for fewer than two values — one point is not a line
 * (the callers say how many more make one).
 */
export function drawSpark(doc, cv, ys, { lo, hi, ref = null, dots = false } = {}) {
  const c = fitCanvas(cv);
  if (!c || ys.length < 2) return false;
  const { ctx, W, H, dpr } = c;
  const k = chartTokens(doc);
  const pad = 4 * dpr;
  const pts = sparkPoints(ys, lo, hi, W, H, pad);
  if (ref != null) {
    const yy = Math.round(sparkPoints([ref], lo, hi, W, H, pad)[0].y) + 0.5;
    ctx.strokeStyle = k.grid;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(pts[0].x, H);
  for (const p of pts) ctx.lineTo(p.x, p.y);
  ctx.lineTo(pts[pts.length - 1].x, H);
  ctx.closePath();
  ctx.fillStyle = k.line;
  ctx.globalAlpha = k.area;
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = k.line;
  ctx.lineWidth = 1.5 * dpr;
  ctx.lineJoin = "round";
  ctx.beginPath();
  pts.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.stroke();
  if (dots) {
    ctx.fillStyle = k.line;
    for (const p of pts.slice(0, -1)) { ctx.beginPath(); ctx.arc(p.x, p.y, 1.8 * dpr, 0, Math.PI * 2); ctx.fill(); }
  }
  const last = pts[pts.length - 1];
  ctx.fillStyle = k.now;
  ctx.strokeStyle = k.panel;
  ctx.lineWidth = 1.5 * dpr;
  ctx.beginPath(); ctx.arc(last.x, last.y, 3 * dpr, 0, Math.PI * 2); ctx.stroke(); ctx.fill();
  return true;
}
