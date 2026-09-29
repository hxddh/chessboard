/**
 * 棋谱诊断的三张图 (v7-1-plan §2.1).
 *
 * Moved out of library-ui.js into chunk-libdb.js when M5 was merged: the
 * first-paint bundle had no room left under F5's budget, and the charts are
 * drawn only in the diagnosis dialog, which the chunk is in time for (the
 * dialog draws them again when it lands).
 *
 * Three shapes for the three things the page says that a number alone does
 * not carry: which phase is the weak one and by how much, where in the game
 * things go wrong, and which openings actually score. Drawn in the same
 * idiom as the two sparklines above — device-pixel sizing, colours read
 * from the document so a theme change is answered, judgement colours from
 * `judgeColours()` so the weak bar is the same red the move list uses.
 *
 * Created by this function rather than sitting in the markup: a chart with
 * no data must not exist at all (the P3 rule this page has followed since
 * 7.0), and "does not exist" is easier to be sure of than "is hidden".
 * @module diag-charts
 */

/**
 * @param {object} d doc, t, tf, judgeColours, libMoveNo — library-ui.js's own
 */
export function createDiagCharts(d) {
  const { doc, t, tf, judgeColours, libMoveNo } = d;
  function diagCanvas(parent, h, label, kind) {
    const cv = doc.createElement("canvas");
    cv.className = "diag-chart";
    // which shape this is, for anyone reading the canvas back: the phase and
    // peak charts stand bars on a shared floor, the eco chart lays them on
    // their side. A pixel reader cannot tell those apart from the ink alone,
    // and it has to — the floor is what tells a bar from a glyph (7.3 §4B).
    if (kind) cv.dataset.chart = kind;
    cv.style.height = h + "px";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", label);
    parent.appendChild(cv);
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round((cv.clientWidth || parent.clientWidth || 320) * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(doc.documentElement);
    return { ctx, W, H, dpr,
      muted: css.getPropertyValue("--muted").trim() || "#999",
      accent: css.getPropertyValue("--accent").trim() || "#e8c39e",
      text: css.getPropertyValue("--text").trim() || "#ddd" };
  }

  /**
   * The smallest a bar is allowed to be, in CSS pixels.
   *
   * 7.3 §4B. Measured on a real library: 开局 8、中局 8、残局 93. On a linear
   * scale in a 92px canvas the first two came out at 1px — a hairline, which
   * is what a bar of zero would also look like. 「小」 and 「没有」 are two
   * different findings about a player and the chart drew them the same.
   * So: anything greater than zero is at least this tall, and zero draws
   * nothing at all. The distortion is bounded and in the honest direction —
   * it can only make a small bar look bigger, never a big one look smaller.
   */
  const MIN_BAR = 4;

  /** The line a bar stands on, so "short" reads as short and not as floating. */
  function baseline(c, y, x0, x1) {
    c.ctx.fillStyle = c.muted;
    c.ctx.globalAlpha = 0.5;
    c.ctx.fillRect(x0, y, x1 - x0, Math.max(1, Math.round(c.dpr)));
    c.ctx.globalAlpha = 1;
  }

  /** Per-phase centipawn loss, with the weak one in the judgement colour. */
  function drawPhaseChart(parent, d, phaseName) {
    const rows = ["opening", "middle", "end"]
      .map((k) => ({ k, acpl: d.phase[k].acpl }))
      .filter((r) => r.acpl != null);
    if (rows.length < 2) return; // one bar is not a comparison
    const c = diagCanvas(parent, 92, t("diag.chartPhase"), "phase");
    const pad = 6 * c.dpr, gap = 10 * c.dpr, label = 16 * c.dpr;
    // the scale's top is a real number off this page — the largest of the
    // three — so the tick can be read against the rows above it. 1.15 of it
    // is headroom for the value printed over the tallest bar, not scale.
    const top = Math.max(...rows.map((r) => r.acpl)) || 1;
    const max = top * 1.15;
    const bw = (c.W - 2 * pad - gap * (rows.length - 1)) / rows.length;
    const bad = judgeColours().bad;
    const floorY = c.H - pad - label;
    const plot = c.H - 2 * pad - 2 * label;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    // the tick: a dashed line at the top of the scale, labelled with the value
    // it stands for. Without it the bars are three heights and no unit.
    const tickY = floorY - (top / max) * plot;
    c.ctx.strokeStyle = c.muted;
    c.ctx.globalAlpha = 0.45;
    c.ctx.setLineDash([3 * c.dpr, 3 * c.dpr]);
    c.ctx.lineWidth = Math.max(1, Math.round(c.dpr));
    c.ctx.beginPath();
    c.ctx.moveTo(pad, tickY);
    c.ctx.lineTo(c.W - pad, tickY);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    c.ctx.globalAlpha = 1;
    c.ctx.fillStyle = c.muted;
    c.ctx.textAlign = "left";
    c.ctx.fillText(tf("diag.chartTop", [top]), pad, tickY - 3 * c.dpr);
    c.ctx.textAlign = "center";
    rows.forEach((r, i) => {
      const x = pad + i * (bw + gap);
      const hgt = r.acpl > 0
        ? Math.max(MIN_BAR * c.dpr, (r.acpl / max) * plot)
        : 0;
      if (hgt) {
        c.ctx.fillStyle = r.k === d.weakestPhase ? bad : c.accent;
        c.ctx.fillRect(x, floorY - hgt, bw, hgt);
      }
      c.ctx.fillStyle = c.text;
      c.ctx.fillText(String(r.acpl), x + bw / 2, floorY - hgt - 3 * c.dpr);
      c.ctx.fillStyle = c.muted;
      c.ctx.fillText(phaseName[r.k], x + bw / 2, c.H - pad);
    });
    baseline(c, floorY, pad, c.W - pad);
  }

  /**
   * Where the mistakes are, by move number.
   *
   * The page already says "第 24 回合，N 局栽在这里". What it cannot say in a
   * sentence is whether that is a spike or a plateau — a clock problem and a
   * knowledge problem look completely different here and identical there.
   */
  function drawPeakChart(parent, list) {
    const counts = new Map();
    let worst = 0;
    for (const g of list) {
      // each game's own claimed chair — the same games `foldGame` counted,
      // so the spike here and the sentence under it cannot disagree
      if (!g.an || !g.side) continue;
      const tags = Array.isArray(g.an.tags) ? g.an.tags : [];
      const start = g.fen ? g.fen.trim().split(/\s+/) : [];
      const first = start[1] === "b" ? "b" : "w";
      const other = first === "w" ? "b" : "w";
      for (let i = 0; i < tags.length; i++) {
        if ((i % 2 === 0 ? first : other) !== g.side) continue;
        if (tags[i] !== "?" && tags[i] !== "??") continue;
        const mv = libMoveNo(g, i);
        counts.set(mv, (counts.get(mv) || 0) + 1);
        if (mv > worst) worst = mv;
      }
    }
    if (counts.size < 3) return null;
    const last = Math.max(10, Math.min(worst, 60));
    const c = diagCanvas(parent, 80, t("diag.chartPeak"), "peak");
    const pad = 6 * c.dpr, label = 14 * c.dpr;
    const max = Math.max(...counts.values()) || 1;
    const bw = (c.W - 2 * pad) / last;
    const floorY = c.H - pad - label;
    const plot = c.H - 2 * pad - label;
    c.ctx.fillStyle = c.accent;
    for (let mv = 1; mv <= last; mv++) {
      const n = counts.get(mv) || 0;
      if (!n) continue;
      // 7.3 §4B: three hairlines floating in a field of white was the whole
      // chart. MIN_BAR gives the shortest of them a body; the baseline below
      // gives all of them a floor to stand on.
      const hgt = Math.max(MIN_BAR * c.dpr, (n / max) * plot);
      c.ctx.fillRect(pad + (mv - 1) * bw, floorY - hgt, Math.max(1, bw - c.dpr), hgt);
    }
    baseline(c, floorY, pad, c.W - pad);
    c.ctx.fillStyle = c.muted;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    c.ctx.textAlign = "left";
    c.ctx.fillText("1", pad, c.H - pad);
    c.ctx.textAlign = "right";
    c.ctx.fillText(String(last), c.W - pad, c.H - pad);
    // what the axes mean, for the caller to print as words: a chart must not
    // be the only place a number appears (v7-3-plan §4B)
    return { last, max };
  }

  /**
   * Win / draw / loss per opening, as one stacked bar each.
   *
   * 7.3 §4B: the bars were right and unreadable. A 100% record and a 0% record
   * each fill the whole width, so two openings with opposite results drew as
   * two identical bars in different colours — and nothing on the canvas said
   * which colour meant which. A stacked bar without a key is a coloured
   * rectangle. So the chart now carries its own key, in words, above the bars.
   */
  function drawEcoChart(parent, ecos) {
    const rows = ecos.slice(0, 6).filter((e) => e.n > 0);
    if (rows.length < 2) return;
    const LEGEND = 16;
    const c = diagCanvas(parent, 18 * rows.length + 12 + LEGEND, t("diag.chartEco"), "eco");
    const pad = 4 * c.dpr;
    const leg = LEGEND * c.dpr;
    const rh = (c.H - 2 * pad - leg) / rows.length;
    const cols = judgeColours();
    const labelW = 46 * c.dpr;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    c.ctx.textAlign = "left";
    // the key: swatch, word, swatch, word, swatch, word
    {
      const sw = 8 * c.dpr, gap = 4 * c.dpr, sp = 10 * c.dpr;
      let x = pad;
      const y = pad + leg * 0.35;
      for (const [col, word] of [[c.accent, t("diag.legendWin")], [c.muted, t("diag.legendDraw")],
                                 [cols.bad, t("diag.legendLoss")]]) {
        c.ctx.fillStyle = col;
        c.ctx.fillRect(x, y - sw * 0.75, sw, sw);
        x += sw + gap;
        c.ctx.fillStyle = c.muted;
        c.ctx.fillText(word, x, y);
        x += c.ctx.measureText(word).width + sp;
      }
    }
    rows.forEach((e, i) => {
      const y = pad + leg + i * rh;
      c.ctx.fillStyle = c.muted;
      c.ctx.fillText(e.eco, pad, y + rh * 0.7);
      const x0 = pad + labelW;
      const full = c.W - pad - x0;
      // the track, so the bar's full extent is visible even when one segment
      // is the whole of it — 「全胜」 and 「全负」 are then the same shape in
      // two colours, which is the truth, rather than two shapes
      c.ctx.fillStyle = c.muted;
      c.ctx.globalAlpha = 0.14;
      c.ctx.fillRect(x0, y + rh * 0.2, full, rh * 0.6);
      c.ctx.globalAlpha = 1;
      let x = x0;
      const seg = [[e.win, c.accent], [e.draw, c.muted], [e.loss, cols.bad]];
      for (const [n, col] of seg) {
        if (!n) continue;
        const w = (n / e.n) * full;
        c.ctx.fillStyle = col;
        c.ctx.fillRect(x, y + rh * 0.2, w, rh * 0.6);
        x += w;
      }
    });
  }
  return { drawPhaseChart, drawPeakChart, drawEcoChart };
}
