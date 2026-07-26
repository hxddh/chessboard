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
 *   cursor: square name | null — keyboard focus ring (keyboard play)
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
  /** live drag ghost: {from, x, y} in canvas pixels | null */
  let _drag = null;
  /** live slide animation: {from, to, start, dur} | null */
  let _anim = null;

  // --- SVG piece sprites (pieces.js). Vector art decoded once per square
  // size into offscreen canvases; the Unicode-glyph path below stays as a
  // fallback for the frames before the images finish decoding.
  const _imgs = {};
  let _sprites = {};
  let _spriteSize = 0;

  function initPieceImages() {
    const svgs = global.CHESS_PIECE_SVGS;
    if (!svgs || typeof Image === "undefined") return;
    for (const key of Object.keys(svgs)) {
      const img = new Image();
      img.onload = () => { _sprites = {}; draw(); };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgs[key]);
      _imgs[key] = img;
    }
  }

  /** offscreen raster of piece `key` at `size` device pixels | null while loading */
  function spriteFor(key, size) {
    const img = _imgs[key];
    if (!img || !img.complete || !img.naturalWidth) return null;
    if (size !== _spriteSize) { _sprites = {}; _spriteSize = size; }
    let c = _sprites[key];
    if (!c) {
      c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      _sprites[key] = c;
    }
    return c;
  }

  function attach(canvas, modelFn) {
    _canvas = canvas;
    _model = modelFn;
    if (!Object.keys(_imgs).length) initPieceImages();
  }

  function setDrag(d) { _drag = d; }

  const easeOut = (t) => 1 - (1 - t) * (1 - t);

  /** Slide the piece now sitting on `to` in from→to over ~150ms (live moves). */
  /**
   * The OS "reduce motion" setting, watched live.
   *
   * v1.10 honoured it in CSS and stopped there, which missed the motion people
   * actually see: a piece gliding across the board happens dozens of times a
   * game, a panel slide once. That glide is canvas + requestAnimationFrame, so
   * no media query in the stylesheet can reach it — the check has to be here.
   *
   * Watched rather than read once: someone who turns the setting on mid-session
   * because the motion is making them ill should not have to restart the app.
   */
  let _reduceMotion = false;
  (function watchReducedMotion() {
    try {
      if (typeof window === "undefined" || !window.matchMedia) return;
      const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      _reduceMotion = !!mq.matches;
      const onChange = (ev) => { _reduceMotion = !!ev.matches; };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange); // Safari < 14
    } catch (_) { /* no matchMedia: animate, as before */ }
  })();

  /**
   * Slide one or more pieces to their new squares.
   *
   * Castling is the reason this takes a list. It is the only move that shifts
   * two men at once, and it is the move beginners find hardest to read (lesson
   * 20 exists for it) — animating the king while the rook teleported showed
   * exactly the half that needed no explaining.
   *
   * @param {string|Array<{from: string, to: string}>} from square, or the
   *   whole list of segments
   * @param {string} [to] destination, when called with two squares
   * @param {{from: string, to: string}} [also] a second piece moving with the
   *   first — the rook's hop in a castle
   */
  function animateMove(from, to, also) {
    if (!_canvas || !_model || !from) return;
    const segs = Array.isArray(from)
      ? from.filter((sg) => sg && sg.from && sg.to)
      : (to ? [{ from, to }] : []);
    if (Array.isArray(from) && also) segs.push(also);
    else if (also && also.from && also.to) segs.push(also);
    if (!segs.length) return;
    // Land the pieces with no glide. Deliberately no draw() here: the caller
    // repaints from the updated model a moment later, and drawing now would
    // paint the pre-move position for that moment.
    if (_reduceMotion) { _anim = null; return; }
    _anim = { segs, start: (typeof performance !== "undefined" ? performance.now() : 0), dur: 150 };
    const step = () => {
      if (!_anim) return;
      const now = typeof performance !== "undefined" ? performance.now() : _anim.start + _anim.dur;
      if (now - _anim.start >= _anim.dur) { _anim = null; draw(); return; }
      draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function cancelAnim() { _anim = null; }

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

  /**
   * Fill the frame's coordinate gutters, reordering them when the board flips.
   * Rebuilt only when the orientation actually changes — draw() runs on every
   * animation frame during a move.
   */
  let coordFlip = null;
  function drawCoords(flipped) {
    if (coordFlip === !!flipped) return;
    coordFlip = !!flipped;
    const files = typeof document !== "undefined" && document.getElementById("coord-files");
    const ranks = typeof document !== "undefined" && document.getElementById("coord-ranks");
    if (!files || !ranks) return;
    const fs = FILES.split("");
    const rs = ["8", "7", "6", "5", "4", "3", "2", "1"];
    const span = (t) => "<span>" + t + "</span>";
    files.innerHTML = (coordFlip ? fs.slice().reverse() : fs).map(span).join("");
    ranks.innerHTML = (coordFlip ? rs.slice().reverse() : rs).map(span).join("");
  }

  function draw() {
    if (!_canvas || !_model) return;
    const m = _model();
    const ctx = _canvas.getContext("2d");
    const w = _canvas.width;
    const step = w / 8;
    // integer cell edges: fractional fillRect boundaries land between device
    // pixels and antialias into soft seams at some board sizes
    const edge = (i) => Math.round(i * step);
    const cellRect = (sr, sc) => [edge(sc), edge(sr), edge(sc + 1) - edge(sc), edge(sr + 1) - edge(sr)];
    // squares
    for (let sr = 0; sr < 8; sr++) {
      for (let sc = 0; sc < 8; sc++) {
        ctx.fillStyle = (sr + sc) % 2 === 0 ? LIGHT : DARK;
        ctx.fillRect(...cellRect(sr, sc));
      }
    }
    // last-move tint
    if (m.lastMove) {
      for (const sq of [m.lastMove.from, m.lastMove.to]) {
        const { sr, sc } = screenPos(sq, m.flipped);
        ctx.fillStyle = LAST;
        ctx.fillRect(...cellRect(sr, sc));
      }
    }
    // selection
    if (m.selected) {
      const { sr, sc } = screenPos(m.selected, m.flipped);
      ctx.fillStyle = SEL;
      ctx.fillRect(...cellRect(sr, sc));
    }
    // check highlight (radial under the king)
    if (m.checkSquare) {
      const { sr, sc } = screenPos(m.checkSquare, m.flipped);
      const cx = sc * step + step / 2, cy = sr * step + step / 2;
      const g = ctx.createRadialGradient(cx, cy, step * 0.1, cx, cy, step * 0.62);
      g.addColorStop(0, CHECK);
      g.addColorStop(1, "rgba(220,60,40,0)");
      ctx.fillStyle = g;
      ctx.fillRect(...cellRect(sr, sc));
    }
    // Coordinates are no longer painted here: they are printed on the frame
    // around the board (see .coords in styles.css), which is where a real
    // board has them and where they cannot sit on top of the a1/h1 rooks.
    drawCoords(m.flipped);
    // pieces: crisp vector sprites, Unicode glyphs only while sprites decode
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = Math.round(step * 0.78) + "px 'Segoe UI Symbol', 'Apple Color Emoji', serif";
    const spriteSize = Math.max(8, Math.round(step));
    function paintPiece(piece, x, y) {
      const sprite = spriteFor(piece.color + piece.type, spriteSize);
      if (sprite) {
        ctx.drawImage(sprite, Math.round(x - spriteSize / 2), Math.round(y - spriteSize / 2));
        return;
      }
      const glyph = GLYPHS[piece.type];
      if (piece.color === "w") {
        ctx.fillStyle = "#f8f8f4";
        ctx.strokeStyle = "rgba(20,20,20,0.85)";
      } else {
        ctx.fillStyle = "#1d1d1b";
        ctx.strokeStyle = "rgba(255,255,255,0.30)";
      }
      ctx.lineWidth = Math.max(1, step * 0.02);
      ctx.strokeText(glyph, x, y + step * 0.04);
      ctx.fillText(glyph, x, y + step * 0.04);
    }
    let dragPiece = null;
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const piece = m.position[r][c];
        if (!piece) continue;
        const sq = FILES[c] + (8 - r);
        if (_drag && _drag.from === sq) { dragPiece = piece; continue; } // ghost drawn last
        if (_anim && _anim.segs.some((sg) => sg.to === sq)) continue; // drawn interpolated below
        const { sr, sc } = screenPos(sq, m.flipped);
        paintPiece(piece, sc * step + step / 2, sr * step + step / 2);
      }
    }
    // sliding pieces: interpolate each from→to over the animation window
    if (_anim) {
      const now = typeof performance !== "undefined" ? performance.now() : _anim.start + _anim.dur;
      const t = easeOut(Math.max(0, Math.min(1, (now - _anim.start) / _anim.dur)));
      let painted = 0;
      for (const sg of _anim.segs) {
        const c = FILES.indexOf(sg.to[0]);
        const r = 8 - Number(sg.to[1]);
        const piece = m.position[r] && m.position[r][c];
        if (!piece) continue;
        const a = screenPos(sg.from, m.flipped);
        const b = screenPos(sg.to, m.flipped);
        const sc = a.sc + (b.sc - a.sc) * t;
        const sr = a.sr + (b.sr - a.sr) * t;
        paintPiece(piece, sc * step + step / 2, sr * step + step / 2);
        painted++;
      }
      // the model moved on under us (undo, jump, new game) — drop the animation
      if (!painted) _anim = null;
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
    // drag ghost follows the pointer, above everything else
    if (_drag && dragPiece) {
      ctx.globalAlpha = 0.9;
      paintPiece(dragPiece, _drag.x, _drag.y);
      ctx.globalAlpha = 1;
    }
    // keyboard cursor: a focus ring that must stay readable on both square
    // colours and on top of pieces, so it is drawn as a double stroke
    if (m.cursor) {
      const { sr, sc } = screenPos(m.cursor, m.flipped);
      const x = edge(sc), y = edge(sr);
      const w2 = edge(sc + 1) - x, h2 = edge(sr + 1) - y;
      const lw = Math.max(2, step * 0.045);
      ctx.strokeStyle = "rgba(20,20,20,0.55)";
      ctx.lineWidth = lw * 1.8;
      ctx.strokeRect(x + lw, y + lw, w2 - lw * 2, h2 - lw * 2);
      ctx.strokeStyle = "rgba(255,255,255,0.95)";
      ctx.lineWidth = lw;
      ctx.strokeRect(x + lw, y + lw, w2 - lw * 2, h2 - lw * 2);
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

  global.ChessBoardView = { attach, draw, resizeCanvas, cellAt, setDrag, animateMove, cancelAnim };
})(typeof window !== "undefined" ? window : globalThis);
