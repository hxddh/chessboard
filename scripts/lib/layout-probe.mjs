/**
 * The play view's geometry, as v8-0-plan §2 A2 states its acceptance: the
 * widest empty band, the board's share, the gap between the notation's two
 * columns, how far the transport bar stands under the last row, and what the
 * portrait drawer shows on its first screen.
 *
 * One function, run inside the page (`page.evaluate(layoutProbe)`), shared
 * by scripts/measure-layout.mjs (which records the numbers) and
 * scripts/test-layout-e2e.mjs (which asserts them), so the number in
 * docs/measured.json and the number a test compares are the same
 * measurement.
 *
 * Definitions — each one is what the plan's own "before" figure measured:
 *
 *   band   A band is a strip of the play view with no content anywhere
 *          along it: an x-interval that no content box crosses at any height
 *          under the top bar (1920 wide: "左右各空 258px" is two of these), or
 *          a y-interval that none crosses at any x. Content is the board and
 *          its frame, the player strips, the left info column's cards, the
 *          notation strip and the side panel while it is open. `band` is the
 *          widest one.
 *   share  the board's squares (the canvas) as a fraction of the play view.
 *   shareWin  …and of the whole window, rail included (M2: with a 64px rail
 *          beside it the play view is no longer the window).
 *   gutter the white space between the notation's two columns: from the
 *          right edge of the widest White move's text to the left edge of
 *          the Black column's text. 7.9 set them in two 1fr columns, so this
 *          was most of half the panel.
 *   nav    from the bottom of the last notation row on screen to the top of
 *          the transport bar (⏮ ◀ ▶ ⏭).
 *   first  in a portrait window, the move cells the first screen shows
 *          without scrolling anything.
 *
 * Text edges are read with Range.getClientRects — a cell's box is not where
 * its letters are.
 * @module layout-probe
 */

/** Runs in the page. Takes no closure: Playwright serialises it. */
export function layoutProbe() {
  const r = (e) => e.getBoundingClientRect();
  const shown = (e) => {
    if (!e || e.hidden) return false;
    const b = r(e);
    const cs = getComputedStyle(e);
    return b.width > 0 && b.height > 0 && cs.visibility !== "hidden" && cs.display !== "none";
  };
  const app = document.getElementById("app");
  // the play view: .stage, which is #app less the navigation rail (M2, A1);
  // on 107838a ("before") there was no rail and the two were the same box
  const A = r(document.querySelector("#app > .stage") || app);
  const chrome = document.querySelector(".chrome");
  const top = A.top + (chrome && shown(chrome) ? r(chrome).height : 0);
  const side = document.getElementById("side");
  const open = app.classList.contains("panel-open");
  const boxes = [];
  const add = (e) => { if (shown(e)) boxes.push(r(e)); };
  add(document.getElementById("board-wrap"));
  for (const e of document.querySelectorAll(".pstrip")) add(e);
  for (const e of document.querySelectorAll("#info-col > *")) add(e);
  add(document.getElementById("move-strip"));
  if (open && side) {
    const b = r(side);
    // a sheet that is translated off the bottom is not on screen
    if (b.top < A.bottom - 1 && b.left < A.right - 1) boxes.push(b);
  }
  // the widest gap in [lo, hi] that the intervals leave
  const gap = (iv, lo, hi) => {
    const s = iv.map(([a, b]) => [Math.max(lo, a), Math.min(hi, b)]).filter(([a, b]) => b > a).sort((p, q) => p[0] - q[0]);
    let best = 0, at = lo;
    for (const [a, b] of s) { best = Math.max(best, a - at); at = Math.max(at, b); }
    return Math.max(best, hi - at);
  };
  const clip = (b) => b.bottom > top && b.top < A.bottom;
  const xBand = gap(boxes.filter(clip).map((b) => [b.left, b.right]), A.left, A.right);
  const yBand = gap(boxes.map((b) => [b.top, b.bottom]), top, A.bottom);
  const canvas = r(document.getElementById("board"));

  // the notation
  const textBox = (el) => {
    if (!el) return null;
    const rg = document.createRange(); rg.selectNodeContents(el);
    const rs = [...rg.getClientRects()].filter((x) => x.width > 0);
    if (!rs.length) return null;
    return { l: Math.min(...rs.map((x) => x.left)), r: Math.max(...rs.map((x) => x.right)),
             t: Math.min(...rs.map((x) => x.top)), b: Math.max(...rs.map((x) => x.bottom)) };
  };
  const list = document.getElementById("move-list");
  const rows = list ? [...list.querySelectorAll(".mlrow")].filter(shown) : [];
  let gutter = null, pitch = null;
  const whites = [], blacks = [];
  for (const row of rows) {
    const mv = [...row.querySelectorAll(".mlmove")];
    const gapped = mv[0] && mv[0].classList.contains("mlgap");
    const w = gapped ? null : mv[0], k = gapped ? mv[1] : mv[1];
    if (w) { const t = textBox(w); if (t) whites.push({ t, cell: r(w) }); }
    if (k) { const t = textBox(k); if (t) blacks.push({ t, cell: r(k) }); }
  }
  if (whites.length && blacks.length) {
    gutter = Math.min(...blacks.map((x) => x.t.l)) - Math.max(...whites.map((x) => x.t.r));
    pitch = Math.min(...blacks.map((x) => x.cell.left)) - Math.min(...whites.map((x) => x.cell.left));
  }
  const bar = document.getElementById("replay-seg");
  let nav = null;
  if (list && shown(list) && bar && shown(bar)) {
    const L = r(list);
    const kids = [...list.children].filter(shown);
    const last = kids.length ? r(kids[kids.length - 1]) : null;
    const lastBottom = last ? Math.min(last.bottom, L.bottom) : L.top;
    nav = r(bar).top - lastBottom;
  }
  // the first screen: move cells wholly inside the window and inside the
  // box that scrolls them, whichever box that is
  const inView = (e) => {
    const b = r(e);
    if (!(b.width > 0 && b.top >= A.top - 0.5 && b.bottom <= A.bottom + 0.5 && b.left >= A.left - 0.5 && b.right <= A.right + 0.5)) return false;
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll|hidden)/.test(cs.overflowY + cs.overflowX)) {
        const c = r(p);
        if (b.top < c.top - 0.5 || b.bottom > c.bottom + 0.5 || b.left < c.left - 0.5 || b.right > c.right + 0.5) return false;
      }
    }
    return shown(e);
  };
  const cells = [...document.querySelectorAll("#move-list .mlmove:not(.mlgap), #move-strip .ms-move")];
  const round = (v) => (v == null ? null : Math.round(v * 10) / 10);
  return {
    view: { w: Math.round(A.width), h: Math.round(A.height) },
    band: round(Math.max(xBand, yBand)), xBand: round(xBand), yBand: round(yBand),
    board: round(canvas.width), share: Math.round((canvas.width * canvas.height) / (A.width * A.height) * 1000) / 1000,
    shareWin: Math.round((canvas.width * canvas.height) / (innerWidth * innerHeight) * 1000) / 1000,
    frame: [r(document.getElementById("board-wrap"))].map((b) => [b.left, b.top, b.width, b.height].map(round))[0],
    side: open && side ? round(r(side).width) : null,
    rows: rows.length, gutter: round(gutter), pitch: round(pitch), nav: round(nav),
    first: cells.filter(inView).length, moves: cells.filter((e) => e.closest("#move-list")).length,
    wide: app.classList.contains("pv-wide"),
  };
}
