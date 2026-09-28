/**
 * 复盘的形势图：棋盘边的形势条，和分析面板里的形势曲线。
 *
 * v8-0-plan F4 (M3): the first piece of app.js's review region to move into
 * review/ — the gauge beside the board (drawEvalBar), the curve under the
 * report (drawEvalCurve), the colours both paint the marks in
 * (judgeColours), and the curve's pointer handling (wire). Moved, not
 * rewritten: the bodies are the ones app.js had.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createEvalGraph()`, createLibraryUI's shape; nothing here reaches back
 * into app.js. The pure modules are imported, not passed.
 * @module review/eval-graph
 */
import { ChessReview } from "../review.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
/**
 * The plies the curve's move axis labels: where each move begins (White's
 * ply), plus the first ply when the game starts with Black to move — "30…"
 * is move 30, not a move to skip (Codex #89) — every `every` moves.
 * @returns {Array<{i:number, no:number}>}
 */
export function axisTicks(n, firstMover, moveNo, every) {
  const out = [];
  for (let i = 0; i < n; i++) {
    if (i > 0 && (i % 2 === 0) !== (firstMover === "w")) continue;
    const no = moveNo(i);
    if (!(no % every)) out.push({ i, no });
  }
  return out;
}

export function createEvalGraph(d) {
  const {
    doc, store, t, tf, setText, analysisFor, setViewIndex, verboseHistory, boardMoveNo, startFen,
  } = d;
  const document = doc;
  const Review = ChessReview;

  /**
   * The judgement colours, from the same tokens the stylesheet reads.
   *
   * The eval curve painted `?` and `??` markers as two hard-coded hexes while
   * the move list's `?!` `?` `??` annotations used two *different* hard-coded
   * hexes plus --danger — three copies of one idea, none of which any theme
   * could reach. 缺陷 8. Now there is one scale (--judge-soft / -mid / -bad),
   * each board palette answers for it, and the canvas asks the document for
   * the same value the CSS uses. Read per call: a theme change is exactly when
   * these move, and this runs once per repaint of a chart, not per frame.
   */
  function judgeColours() {
    const css = getComputedStyle(document.documentElement);
    const pick = (name, fallback) => css.getPropertyValue(name).trim() || fallback;
    return {
      soft: pick("--judge-soft", "#c9b458"),
      mid: pick("--judge-mid", "#e0a03c"),
      bad: pick("--judge-bad", "#e05252"),
      good: pick("--judge-good", "#4caf6a"),
    };
  }


  /**
   * The eval gauge for the position the board is standing on.
   *
   * Pure rendering of `analysis.scalars[viewIndex]` — no engine call, which is
   * the whole reason this is review-only. During a live game `analysisFor()`
   * is null (the signature is the PGN, and that changes every move), so the
   * gauge hides itself without needing a mode check, and there is no way for
   * it to become an answer key while somebody is still playing.
   *
   * 7.7 §5: a vertical gauge down the board's left edge, where Lichess keeps
   * it, instead of a bar in the panel — the number is about the board, so it
   * stands beside the board, and it reads with the panel shut. White's share
   * fills from White's side, so it turns over with the board. Where the
   * window leaves no room beside the frame (a board that is width-bound), it
   * moves onto the frame's own left edge rather than off the screen.
   */
  function drawEvalBar() {
    const row = document.getElementById("eval-bar-row");
    const bar = document.getElementById("eval-bar");
    const fill = document.getElementById("eval-bar-fill");
    const text = document.getElementById("eval-bar-text");
    if (!row || !bar || !fill || !text) return;
    const a = analysisFor();
    const inReview = !!a && !store.session.editor && store.session.mode !== "learn" && store.session.mode !== "puzzle";
    if (!inReview) { row.hidden = true; return; }
    row.hidden = false;
    row.classList.toggle("is-flipped", !!store.game.flipped);
    // room to the left of the frame: the stage's padding plus whatever the
    // centring leaves. The gauge and its gap need about 20px.
    // v8-0-plan A4: in the wide layout what stands to the left of the frame
    // is the info column, 8px off it — the gauge lay across its cards, so
    // the room is measured to that column where there is one
    const wrap = document.getElementById("board-wrap");
    const col = document.getElementById("info-col");
    const edge = col && col.offsetParent ? col.getBoundingClientRect().right : 0;
    // …and the number beside it needs more than the gauge does: where it
    // would run off the window's edge (600 wide: 「12.5」 cut to 「2.5」) it
    // goes the way the inset gauge's number goes, to the curve and the
    // screen reader
    const room = wrap ? wrap.getBoundingClientRect().left - edge : 0;
    row.classList.toggle("is-inset", room < 24);
    row.classList.toggle("is-tight", room >= 24 && room < 56);
    const cp = a.scalars[store.game.viewIndex];
    const frac = Review.evalBar(cp);
    // the curve is a slider for the keyboard: ← / → (the global replay keys)
    // move it, and this is what a screen reader says at each stop
    const cv = document.getElementById("eval-curve");
    if (cv) {
      cv.setAttribute("aria-valuemin", "0");
      cv.setAttribute("aria-valuemax", String(a.scalars.length - 1));
      cv.setAttribute("aria-valuenow", String(store.game.viewIndex));
      cv.setAttribute("aria-valuetext", tf("curve.at", [store.game.viewIndex]) +
        " · " + (frac == null ? t("rv.evalNone") : evalText(cp)));
    }
    if (frac == null) {
      // measured and level is not the same thing as never measured
      bar.classList.add("is-unmeasured");
      fill.style.height = "50%";
      setText(text, t("rv.evalNone"));
      row.classList.remove("white-ahead", "black-ahead");
      return;
    }
    bar.classList.remove("is-unmeasured");
    fill.style.height = (frac * 100).toFixed(1) + "%";
    setText(text, evalText(cp));
    // the number sits at the end of the side that is ahead, like the fill
    row.classList.toggle("white-ahead", frac >= 0.5);
    row.classList.toggle("black-ahead", frac < 0.5);
  }

  /** Who plays ply 0 of the game on the board. */
  function gameStartTurn() {
    const f = startFen();
    return f && f.split(" ")[1] === "b" ? "b" : "w";
  }

  /** "+0.4", "−1.2", or "+#" — a forced mate has no meaningful pawn count. */
  function evalText(cp) {
    return Math.abs(cp) >= 5000
      ? (cp > 0 ? "+#" : "−#")
      : (cp > 0 ? "+" : cp < 0 ? "−" : "") + (Math.abs(cp) / 100).toFixed(1);
  }

  function drawEvalCurve() {
    const cv = document.getElementById("eval-curve");
    const a = analysisFor();
    if (!cv || !a) return;
    // 7.6 §3b: a curve asked to draw while its tab, its panel or itself is
    // hidden measures 0×0, and the `max(1, …)` below used to turn that into
    // a 1×1 backing store — which the stylesheet then stretched to 60px of
    // one blurred pixel, a solid red block after opening a library game from
    // the 记录 tab or switching language on the 设置 tab. Nothing drawn from
    // a box that is not laid out; the ResizeObserver on the canvas redraws it
    // the moment it gets a size again.
    if (!cv.clientWidth || !cv.clientHeight) return;
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round(cv.clientWidth * dpr));
    const H = Math.max(1, Math.round(cv.clientHeight * dpr));
    if (cv.width !== W) cv.width = W;
    if (cv.height !== H) cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const n = a.scalars.length - 1;
    // 7.8 §2: the height is White's win chance, 50 % on the midline — the
    // scale the marks are judged on. It was ±5 pawns linear, where a game
    // decided by a lost rook still drew as a line hugging the axis for its
    // first thirty moves and a mate as the same height as +5.
    const x = (i) => plotX(i, n, W, dpr);
    const y = (s) => 4 * dpr + (1 - Review.winPct(s) / 100) * (H - 8 * dpr);
    const css = getComputedStyle(document.documentElement);
    const cMuted = css.getPropertyValue("--muted").trim() || "#999";
    const cAccent = css.getPropertyValue("--accent").trim() || "#e8c39e";
    const cPanel = css.getPropertyValue("--panel").trim() || cMuted;
    const JC = judgeColours();

    // v8-0-plan A4: White and Black split, the way Lichess draws it — the
    // area under the line is White's colour and the area over it Black's, so
    // the share of the height that is white IS White's win chance. It was
    // two translucent wedges off the midline over the panel's own colour,
    // which in the dark shells made "White is winning" a grey smudge. Each
    // run of measured positions is its own pair of shapes; an unmeasured one
    // leaves the card showing through — not a guess drawn as level.
    const sideW = css.getPropertyValue("--side-white").trim() || "#f2f2ee";
    const sideB = css.getPropertyValue("--side-black").trim() || "#1d1d1b";
    let i0 = 0;
    while (i0 <= n) {
      if (a.scalars[i0] == null) { i0++; continue; }
      let i1 = i0;
      while (i1 + 1 <= n && a.scalars[i1 + 1] != null) i1++;
      // a single measured position still owns its column
      const l = i1 > i0 ? x(i0) : x(i0) - dpr, r = i1 > i0 ? x(i1) : x(i0) + dpr;
      const edge = (from) => { for (let i = i0; i <= i1; i++) ctx.lineTo(x(i), y(a.scalars[i])); ctx.lineTo(r, from); };
      for (const [from, fill] of [[H, sideW], [0, sideB]]) {
        ctx.beginPath();
        ctx.moveTo(l, from);
        ctx.lineTo(l, y(a.scalars[i0]));
        edge(from);
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();
      }
      i0 = i1 + 1;
    }
    // the quarter lines and the midline, over both colours: level is a place
    ctx.strokeStyle = cMuted;
    ctx.lineWidth = dpr;
    for (const [f, alpha] of [[0.25, 0.25], [0.5, 0.6], [0.75, 0.25]]) {
      const yy = Math.round(4 * dpr + f * (H - 8 * dpr)) + 0.5;
      ctx.globalAlpha = alpha;
      ctx.beginPath(); ctx.moveTo(0, yy); ctx.lineTo(W, yy); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // eval line (skip null gaps)
    ctx.strokeStyle = cAccent;
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    let pen = false;
    for (let i = 0; i <= n; i++) {
      const s = a.scalars[i];
      if (s == null) { pen = false; continue; }
      if (pen) ctx.lineTo(x(i), y(s));
      else { ctx.moveTo(x(i), y(s)); pen = true; }
    }
    ctx.stroke();
    // the marked moves, at the position after each: ? and ?? in the marks'
    // colours, a graded pass's !! and ! in the praise colour (v8-0-plan A4)
    for (const { i, tag } of curveMarks(a)) {
      const s = a.scalars[i + 1];
      if (s == null) continue;
      // 7.7 §5: a dot you can find — 2.4px was a speck on a 60px curve —
      // ringed in the panel's own colour so it separates from the fill
      ctx.fillStyle = tag === "??" ? JC.bad : tag === "?" ? JC.mid : JC.good;
      ctx.strokeStyle = cPanel;
      ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath();
      ctx.arc(x(i + 1), y(s), (tag === "??" ? 4.5 : 3.5) * dpr, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fill();
    }
    // current view marker
    ctx.strokeStyle = cAccent;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = dpr;
    ctx.beginPath(); ctx.moveTo(x(store.game.viewIndex), 2 * dpr); ctx.lineTo(x(store.game.viewIndex), H - 2 * dpr); ctx.stroke();
    ctx.globalAlpha = 1;
    drawMoveAxis(cv, n);
  }

  /** x of position `i` of `n` on a plot `W` device pixels wide: a 4px margin each side. */
  function plotX(i, n, W, dpr) {
    return n ? (i / n) * (W - 8 * dpr) + 4 * dpr : W / 2;
  }

  /** The plies the curve marks: ? and ??, and a graded pass's !! and !. */
  function curveMarks(a) {
    const out = [];
    const graded = a.v === 2 && Array.isArray(a.grades) ? a.grades : null;
    for (let i = 0; i < a.scalars.length - 1; i++) {
      const tag = a.tags && (a.tags[i] === "?" || a.tags[i] === "??") ? a.tags[i]
        : graded && (graded[i] === "brilliant" || graded[i] === "only") ? "!" : null;
      if (tag) out.push({ i, tag });
    }
    return out;
  }

  /**
   * v8-0-plan A4: the move numbers under the graph — every 1, 2, 5, 10 or
   * 20 moves, whichever leaves at most six — each at the position where
   * that move begins. Written only when the count or the width changes.
   */
  function drawMoveAxis(cv, n) {
    const axis = document.getElementById("curve-x");
    if (!axis) return;
    const w = cv.clientWidth;
    const firstMover = gameStartTurn();
    const moves = n ? boardMoveNo(n - 1) : 0;
    const every = [1, 2, 5, 10, 20, 50].find((k) => Math.floor(moves / k) <= 6) || 100;
    const key = [n, w, every, firstMover].join("|");
    if (axis.dataset.key === key) return;
    axis.dataset.key = key;
    axis.replaceChildren();
    for (const { i, no } of axisTicks(n, firstMover, boardMoveNo, every)) {
      const s = document.createElement("span");
      s.textContent = String(no);
      s.style.left = ((plotX(i, n, w, 1)) / Math.max(1, w) * 100).toFixed(2) + "%";
      axis.appendChild(s);
    }
  }

  /** The curve answers the pointer: a click or a drag walks the replay, a hover says where. */
  function wire() {
    const curveEl = document.getElementById("eval-curve");
    if (curveEl) {
      // `snap`: a press lands on a marked move when it is within 10px of its
      // dot (v8-0-plan A4) — on a long game the positions are 4px apart and
      // "click the mistake" was a pixel hunt. A drag does not snap: it is a
      // scrub through every position, and must not stick to the dots.
      const jumpOnCurve = (ev, snap) => {
        const a = analysisFor();
        if (!a) return;
        const rect = curveEl.getBoundingClientRect();
        const n = a.scalars.length - 1;
        const frac = (ev.clientX - rect.left - 4) / Math.max(1, rect.width - 8);
        let to = Math.round(Math.max(0, Math.min(1, frac)) * n);
        if (snap) {
          let near = 10;
          for (const { i } of curveMarks(a)) {
            const d = Math.abs(ev.clientX - rect.left - plotX(i + 1, n, rect.width, 1));
            if (d <= near) { near = d; to = i + 1; }
          }
        }
        setViewIndex(to);
      };
      curveEl.onclick = (ev) => jumpOnCurve(ev, true);
      // the time machine: hold the curve and drag — the board scrubs with the
      // pointer, every position on the way is really committed (same call the
      // click makes), and letting go simply stops
      curveEl.onpointerdown = (ev) => {
        curveEl.setPointerCapture(ev.pointerId);
        jumpOnCurve(ev, true);
      };
      // 7.8 §2: what is under the pointer, as Lichess's graph says it — the
      // move that led to that position and the score after it
      const tipEl = document.getElementById("curve-tip");
      const showCurveTip = (ev) => {
        const a = analysisFor();
        if (!a || !tipEl) return;
        const rect = curveEl.getBoundingClientRect();
        const n = a.scalars.length - 1;
        const frac = Math.max(0, Math.min(1, (ev.clientX - rect.left - 4) / Math.max(1, rect.width - 8)));
        const i = Math.round(frac * n);
        const s = a.scalars[i];
        const score = s == null ? t("rv.evalNone") : evalText(s);
        const vh = verboseHistory();
        const mv = i > 0 ? vh[i - 1] : null;
        const head = mv ? tf("curve.hover", [boardMoveNo(i - 1), (mv.color === "b" ? "…" : "") + mv.san, score])
          : tf("curve.at", [0]) + " " + score;
        const hint = tipEl.lastElementChild;
        if (!hint) {
          const main = document.createElement("span");
          const h = document.createElement("span");
          h.className = "curve-tip-hint";
          tipEl.replaceChildren(main, h);
        }
        setText(tipEl.firstElementChild, head);
        setText(tipEl.lastElementChild, t("tip.evalCurve"));
        tipEl.hidden = false;
        // centred on the point, kept inside the panel
        const wrap = tipEl.offsetParent || curveEl.parentElement;
        const wr = wrap.getBoundingClientRect();
        const half = tipEl.offsetWidth / 2;
        const px = rect.left - wr.left + 4 + (n ? (i / n) * (rect.width - 8) : rect.width / 2);
        tipEl.style.left = Math.max(half, Math.min(wr.width - half, px)) + "px";
        tipEl.style.top = (rect.top - wr.top) + "px";
      };
      curveEl.onpointermove = (ev) => { showCurveTip(ev); if (ev.buttons & 1) jumpOnCurve(ev); };
      curveEl.onpointerleave = () => { if (tipEl) tipEl.hidden = true; };
      curveEl.style.cursor = "pointer";
    }
  }

  return { judgeColours, drawEvalBar, evalText, drawEvalCurve, wire };
}
