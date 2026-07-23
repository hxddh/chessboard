/**
 * Chess board canvas renderer + hit testing. Pure view: reads a model
 * function on every draw, never touches game rules.
 * Model: { position, flipped, selected, legalTargets, lastMove, checkSquare,
 *          hintMove, stars }
 *   position: chess.js .board() — [8][8] of {type,color}|null, row 0 = rank 8
 *   selected/checkSquare: square names ("e2") | null
 *   legalTargets: array of square names
 *   lastMove/hintMove: {from,to} | null (hintMove renders as an arrow)
 *   stars: array of square names — lesson goal markers (gold stars)
 *   flashSquare: square name | null — brief success flash (lesson feedback)
 * @module board
 */
(function (global) {
  const FILES = "abcdefgh";

  // Solid glyph set for both colors — colored via fill, outlined for contrast.
  const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

  const LIGHT = "#f0d9b5";
  const DARK = "#b58863";
  const SEL = "rgba(255, 210, 60, 0.45)";
  const LAST = "rgba(155, 199, 0, 0.34)";
  const CHECK = "rgba(220, 60, 40, 0.55)";
  const DOT = "rgba(30, 30, 30, 0.28)";
  const RING = "rgba(30, 30, 30, 0.32)";
  const HINT = "rgba(56, 142, 78, 0.75)";
  const STAR = "rgba(230, 170, 30, 0.95)";
  const STAR_EDGE = "rgba(120, 80, 0, 0.5)";

  /** 5-point star path centered at (cx,cy) with outer radius r. */
  function starPath(ctx, cx, cy, r) {
    ctx.beginPath();
    for (let i = 0; i < 10; i++) {
      const ang = -Math.PI / 2 + (i * Math.PI) / 5;
      const rad = i % 2 === 0 ? r : r * 0.42;
      const x = cx + Math.cos(ang) * rad;
      const y = cy + Math.sin(ang) * rad;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  }

  let _canvas = null;
  let _model = null;

  function attach(canvas, modelFn) {
    _canvas = canvas;
    _model = modelFn;
  }

  function resizeCanvas() {
    if (!_canvas) return;
    const rect = _canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const px = Math.max(200, Math.round(Math.min(rect.width, rect.height) * dpr));
    if (_canvas.width !== px) { _canvas.width = px; _canvas.height = px; }
  }

  /** screen row/col (0 top-left) → square name, honoring flip */
  function squareAt(sr, sc, flipped) {
    const r = flipped ? 7 - sr : sr;
    const c = flipped ? 7 - sc : sc;
    return FILES[c] + (8 - r);
  }

  /** square name → screen row/col */
  function screenPos(sq, flipped) {
    const c = FILES.indexOf(sq[0]);
    const r = 8 - Number(sq[1]);
    return flipped ? { sr: 7 - r, sc: 7 - c } : { sr: r, sc: c };
  }

  /** canvas-pixel coords → square name | null */
  function cellAt(x, y) {
    if (!_canvas || !_model) return null;
    const m = _model();
    const w = _canvas.width;
    const step = w / 8;
    const sc = Math.floor(x / step);
    const sr = Math.floor(y / step);
    if (sr < 0 || sr > 7 || sc < 0 || sc > 7) return null;
    return squareAt(sr, sc, m.flipped);
  }

  function draw() {
    if (!_canvas || !_model) return;
    const m = _model();
    const ctx = _canvas.getContext("2d");
    const w = _canvas.width;
    const step = w / 8;
    // squares
    for (let sr = 0; sr < 8; sr++) {
      for (let sc = 0; sc < 8; sc++) {
        ctx.fillStyle = (sr + sc) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(sc * step, sr * step, step, step);
      }
    }
    // last-move tint
    if (m.lastMove) {
      for (const sq of [m.lastMove.from, m.lastMove.to]) {
        const { sr, sc } = screenPos(sq, m.flipped);
        ctx.fillStyle = LAST;
        ctx.fillRect(sc * step, sr * step, step, step);
      }
    }
    // selection
    if (m.selected) {
      const { sr, sc } = screenPos(m.selected, m.flipped);
      ctx.fillStyle = SEL;
      ctx.fillRect(sc * step, sr * step, step, step);
    }
    // check highlight (radial under the king)
    if (m.checkSquare) {
      const { sr, sc } = screenPos(m.checkSquare, m.flipped);
      const cx = sc * step + step / 2, cy = sr * step + step / 2;
      const g = ctx.createRadialGradient(cx, cy, step * 0.1, cx, cy, step * 0.62);
      g.addColorStop(0, CHECK);
      g.addColorStop(1, "rgba(220,60,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(sc * step, sr * step, step, step);
    }
    // coordinates (small, inside edge squares)
    ctx.font = "500 " + Math.round(step * 0.19) + "px -apple-system, system-ui, sans-serif";
    ctx.textBaseline = "alphabetic";
    for (let i = 0; i < 8; i++) {
      // files along the bottom
      const fsq = squareAt(7, i, false);
      const fileChar = m.flipped ? FILES[7 - i] : FILES[i];
      ctx.fillStyle = (7 + i) % 2 === 0 ? DARK : LIGHT;
      ctx.textAlign = "right";
      ctx.fillText(fileChar, (i + 1) * step - step * 0.08, 8 * step - step * 0.08);
      // ranks along the left
      const rankChar = m.flipped ? String(i + 1) : String(8 - i);
      ctx.fillStyle = (i + 0) % 2 === 0 ? DARK : LIGHT;
      ctx.textAlign = "left";
      ctx.fillText(rankChar, step * 0.08, i * step + step * 0.26);
      void fsq;
    }
    // pieces
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = Math.round(step * 0.78) + "px 'Segoe UI Symbol', 'Apple Color Emoji', serif";
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = m.position[r][c];
        if (!piece) continue;
        const sq = FILES[c] + (8 - r);
        const { sr, sc } = screenPos(sq, m.flipped);
        const x = sc * step + step / 2;
        const y = sr * step + step * 0.54;
        const glyph = GLYPHS[piece.type];
        if (piece.color === "w") {
          ctx.fillStyle = "#f8f8f4";
          ctx.strokeStyle = "rgba(20,20,20,0.85)";
        } else {
          ctx.fillStyle = "#1d1d1b";
          ctx.strokeStyle = "rgba(255,255,255,0.30)";
        }
        ctx.lineWidth = Math.max(1, step * 0.02);
        ctx.strokeText(glyph, x, y);
        ctx.fillText(glyph, x, y);
      }
    }
    // lesson success flash
    if (m.flashSquare) {
      const { sr, sc } = screenPos(m.flashSquare, m.flipped);
      ctx.fillStyle = "rgba(72, 190, 100, 0.45)";
      ctx.fillRect(sc * step, sr * step, step, step);
    }
    // lesson stars: big on empty squares, tucked in the corner on occupied ones
    if (m.stars && m.stars.length) {
      for (const sq of m.stars) {
        const { sr, sc } = screenPos(sq, m.flipped);
        const c = FILES.indexOf(sq[0]);
        const r = 8 - Number(sq[1]);
        const occupied = !!m.position[r][c];
        const cx = occupied ? sc * step + step * 0.8 : sc * step + step / 2;
        const cy = occupied ? sr * step + step * 0.2 : sr * step + step / 2;
        starPath(ctx, cx, cy, occupied ? step * 0.16 : step * 0.3);
        ctx.fillStyle = STAR;
        ctx.fill();
        ctx.strokeStyle = STAR_EDGE;
        ctx.lineWidth = Math.max(1, step * 0.015);
        ctx.stroke();
      }
    }
    // engine hint arrow on top of pieces
    if (m.hintMove) {
      const a = screenPos(m.hintMove.from, m.flipped);
      const b = screenPos(m.hintMove.to, m.flipped);
      const ax = a.sc * step + step / 2, ay = a.sr * step + step / 2;
      const bx = b.sc * step + step / 2, by = b.sr * step + step / 2;
      const ang = Math.atan2(by - ay, bx - ax);
      const head = step * 0.3;
      // stop the shaft where the arrowhead begins
      const sx = bx - Math.cos(ang) * head * 0.8;
      const sy = by - Math.sin(ang) * head * 0.8;
      ctx.strokeStyle = HINT;
      ctx.fillStyle = HINT;
      ctx.lineWidth = step * 0.13;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(ax + Math.cos(ang) * step * 0.24, ay + Math.sin(ang) * step * 0.24);
      ctx.lineTo(sx, sy);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx - Math.cos(ang - 0.45) * head, by - Math.sin(ang - 0.45) * head);
      ctx.lineTo(bx - Math.cos(ang + 0.45) * head, by - Math.sin(ang + 0.45) * head);
      ctx.closePath();
      ctx.fill();
    }
    // legal-move markers on top of pieces (capture ring / empty dot)
    if (m.legalTargets && m.legalTargets.length) {
      for (const sq of m.legalTargets) {
        const { sr, sc } = screenPos(sq, m.flipped);
        const c = FILES.indexOf(sq[0]);
        const r = 8 - Number(sq[1]);
        const occupied = !!m.position[r][c];
        const cx = sc * step + step / 2, cy = sr * step + step / 2;
        ctx.beginPath();
        if (occupied) {
          ctx.arc(cx, cy, step * 0.44, 0, Math.PI * 2);
          ctx.strokeStyle = RING;
          ctx.lineWidth = step * 0.075;
          ctx.stroke();
        } else {
          ctx.arc(cx, cy, step * 0.14, 0, Math.PI * 2);
          ctx.fillStyle = DOT;
          ctx.fill();
        }
      }
    }
  }

  global.ChessBoardView = { attach, draw, resizeCanvas, cellAt };
})(typeof window !== "undefined" ? window : globalThis);
