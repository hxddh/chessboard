/**
 * The exported analysis report — a PNG of the curve and the numbers.
 *
 * Carved out of app.js (v6-plan Q1.7): it draws from the analysis and
 * the store but owns none of it, so everything it reads arrives in `d`. The
 * palette and the font stack live here with it, and the guard in
 * scripts/test-chess.mjs reads this file rather than app.js.
 * @module report
 */
export const ChessReport = (() => {
  /**
   * The exported review image.
   *
   * Three things this is not allowed to be, each of which it was:
   *
   * **Theme-coloured.** It used to paint on `--card` — a 3–4% white overlay in
   * the wood and night themes — with `--text` on top. Exported from either, the
   * PNG is near-white text on near-white, and dropping it into any document
   * with a white background produced a blank rectangle. An exported file leaves
   * the app; it cannot inherit the app's assumptions about what is behind it.
   * So the palette here is opaque, fixed, and the same from all four themes.
   * 缺陷 2.
   *
   * **Written for the screen.** The turning-point line ended "—— 点此跳转",
   * true of the panel and nonsense in a file, and it was removed by a regex
   * that only worked because Chinese and Japanese use a full-width dash: the
   * English build shipped "tap to jump" printed on the image. Two keys now, no
   * regex. 缺陷 5.
   *
   * **Unmeasured.** Nine fillText calls, no measureText, no wrapping, on a
   * fixed 820px canvas. The Japanese side line runs about a third longer than
   * the Chinese one, and over-long text did not ellipsize — it left the canvas
   * and was gone. 缺陷 21.
   */
  const REPORT_FONT = "system-ui, -apple-system, 'Helvetica Neue', 'PingFang SC', 'Hiragino Kaku Gothic ProN', sans-serif";
  /**
   * Fixed, opaque, and nothing to do with the interface theme.
   *
   * Light, because a shared image lands on a white page far more often than a
   * dark one, and because these values can then be checked for contrast once
   * rather than four times.
   */
  const REPORT_INK = {
    bg: "#fbfaf7", fg: "#1b1a17", muted: "#6b675e",
    accent: "#8a5a1e", line: "#d9d4c8",
  };

  function render(d) {
    const { t, tf, sideName, statusText, openingFor, sanHistory, startFen, analysisFor, judgeColours, sideRows, DIFF_NAMES, store } = d;
    const a = analysisFor();
    const R = d.ChessReview;
    if (!a || !R) return null;
    const first = startFen() && startFen().split(" ")[1] === "b" ? "b" : "w";
    const sum = R.summarizeWinPct(a.scalars, sanHistory(), first);
    const cp = R.summarize(a.scalars, sanHistory(), first);
    if (!sum || !cp) return null;
    sum.acpl = cp.acpl;

    const S = 2; // fixed scale: the file should not depend on the player's screen
    const W = 900, H = 520;
    const cv = document.createElement("canvas");
    cv.width = W * S; cv.height = H * S;
    const ctx = cv.getContext("2d");
    ctx.scale(S, S);
    const { bg, fg, muted, accent, line } = REPORT_INK;
    const font = (spec) => { ctx.font = spec + " " + REPORT_FONT; };

    /**
     * Draw text that is guaranteed to be inside the image.
     *
     * Wraps at `maxW` and, if it still does not fit in `maxLines`, ends the
     * last line with an ellipsis. Returns the y after the last line, so the
     * caller can lay out what comes next instead of assuming a height.
     */
    function text(str, x, y, maxW, maxLines, lh) {
      const words = String(str).split(/(\s+)/);
      const lines = [];
      let cur = "";
      for (const w of words) {
        const next = cur + w;
        // CJK has no spaces to break on, so fall back to breaking per character
        if (ctx.measureText(next).width <= maxW || !cur) { cur = next; continue; }
        lines.push(cur.trimEnd());
        cur = w.trimStart();
      }
      if (cur) lines.push(cur.trimEnd());
      const out = [];
      for (const l of lines) {
        if (ctx.measureText(l).width <= maxW) { out.push(l); continue; }
        let piece = "";
        for (const ch of l) {
          if (ctx.measureText(piece + ch).width > maxW) { out.push(piece); piece = ch; }
          else piece += ch;
        }
        if (piece) out.push(piece);
      }
      const shown = out.slice(0, maxLines || out.length);
      if (out.length > shown.length && shown.length) {
        let last = shown[shown.length - 1];
        while (last && ctx.measureText(last + "…").width > maxW) last = last.slice(0, -1);
        shown[shown.length - 1] = last + "…";
      }
      shown.forEach((l, i) => ctx.fillText(l, x, y + i * (lh || 20)));
      return y + shown.length * (lh || 20);
    }

    ctx.fillStyle = bg; ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = fg;
    font("600 26px");
    ctx.fillText(t("rv.title"), 40, 56);

    font("15px");
    ctx.fillStyle = muted;
    const opening = openingFor(sanHistory().length);
    const head = [opening ? opening[1] : null, statusText(),
      tf("mm.plies", [sanHistory().length])].filter(Boolean).join("  ·  ");
    text(head, 40, 84, W - 80, 2, 20);

    // one line of context: which level, which colour, when
    font("13px");
    const when = new Date().toISOString().slice(0, 10);
    const ctxLine = [DIFF_NAMES[store.session.difficulty] || store.session.difficulty,
      t(store.session.humanColor === "w" ? "color.white" : "color.black"), when]
      .filter(Boolean).join("  ·  ");
    ctx.fillStyle = muted;
    text(ctxLine, 40, 106, W - 80, 1, 18);

    // the curve, same shape and cut-off as the one on screen
    const cx0 = 40, cy0 = 130, cw = W - 80, ch = 150;
    ctx.strokeStyle = line; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(cx0, cy0 + ch / 2); ctx.lineTo(cx0 + cw, cy0 + ch / 2); ctx.stroke();
    const n = a.scalars.length - 1, CAP = 500;
    const JC = judgeColours();
    const px = (i) => (n ? cx0 + (i / n) * cw : cx0 + cw / 2);
    const py = (sv) => cy0 + ch / 2 - (Math.max(-CAP, Math.min(CAP, sv)) / CAP) * (ch / 2 - 4);
    ctx.strokeStyle = accent; ctx.lineWidth = 2; ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const sv = a.scalars[i];
      if (sv == null) { pen = false; continue; }
      if (pen) ctx.lineTo(px(i), py(sv)); else { ctx.moveTo(px(i), py(sv)); pen = true; }
    }
    ctx.stroke();
    for (let i = 0; i < n; i++) {
      if (!R.isMistake(a.tags[i]) || a.tags[i] === "?!") continue;
      const sv = a.scalars[i + 1];
      if (sv == null) continue;
      ctx.fillStyle = a.tags[i] === "??" ? JC.bad : JC.mid;
      ctx.beginPath(); ctx.arc(px(i + 1), py(sv), 3.5, 0, Math.PI * 2); ctx.fill();
    }

    // the numbers, one column per side — each column measured, so the longer
    // Japanese line wraps inside its column instead of into the other one
    const rowY = cy0 + ch + 46;
    const colW = cw / 2 - 20;
    for (const [k, side] of [[0, "w"], [1, "b"]]) {
      const x = 40 + k * (cw / 2);
      ctx.fillStyle = fg;
      font("600 15px");
      ctx.fillText(sideName(side), x, rowY);
      // the same three rows the panel shows, from the same helper: label at the
      // column's left edge, value at its right, so the two columns read as one
      // table rather than two paragraphs
      font("14px");
      sideRows(sum, side).forEach(([label, value], i) => {
        const y = rowY + 24 + i * 22;
        // both halves through text(): it is the only thing here that measures
        // before it draws, and a label that outgrew its half would otherwise
        // run in under the number
        ctx.textAlign = "right";
        ctx.fillStyle = fg;
        text(value, x + colW, y, colW * 0.45, 1, 22);
        ctx.textAlign = "left";
        ctx.fillStyle = muted;
        text(label, x, y, colW * 0.5, 1, 22);
      });
    }
    if (sum.worst) {
      font("14px");
      ctx.fillStyle = accent;
      // the Plain key, not the panel's line with its "tap to jump" tail
      text(tf("rv.turningPointPlain", [sum.worst.moveNo,
        sideName(sum.worst.side), sum.worst.san,
        Math.round(sum.worst.drop)]), 40, rowY + 112, cw, 2, 20);
    }
    font("12px");
    ctx.fillStyle = muted;
    ctx.fillText(t("brand"), 40, H - 24);
    return cv;
  }

  return { render, REPORT_INK, REPORT_FONT };
})();
