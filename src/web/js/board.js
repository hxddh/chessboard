/**
 * Chess board canvas renderer + hit testing. Pure view: reads a model
 * function on every draw, never touches game rules.
 * Model: { position, flipped, selected, legalTargets, lastMove, checkSquare,
 *          hintMove, stars }
 *   position: chess.js .board() — [8][8] of {type,color}|null, row 0 = rank 8
 *   selected/checkSquare: square names ("e2") | null
 *   mated: true when checkSquare is a mated king, not merely a checked one
 *   legalTargets: array of square names
 *   lastMove/hintMove: {from,to} | null (hintMove renders as an arrow)
 *   stars: array of square names — lesson goal markers (gold stars)
 *   flashSquare: square name | null — brief success flash (lesson feedback)
 *   cursor: square name | null — keyboard focus ring (keyboard play)
 *   shapes: {arrows: [{from,to,color}], circles: [{sq,color}]} | undefined —
 *     the player's own annotations on this position, colour letters G/R/B/Y
 *     (lichess's), painted from the --shape-* tokens (v6-plan Q2.4)
 * @module board
 */
import { CHESS_PIECE_SVGS } from "./pieces.js";
import { MERIDA_PIECE_SVGS } from "./pieces-merida.js";
  const FILES = "abcdefgh";

  // Solid glyph set for both colors — colored via fill, outlined for contrast.
  const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

  /**
   * Board colours, read from the stylesheet so the board belongs to the theme.
   *
   * Until 1.11 these were six constants baked into this file, which meant the
   * four themes changed the frame, the panel and the coordinate ink and left
   * the 64 squares identical — measured: every theme painted 240,217,181 and
   * 181,136,99. "Night" was a dark green frame around a bright tan board. The
   * squares are what a player looks at essentially the whole time, so a theme
   * that cannot touch them is a theme in name only.
   *
   * The fallbacks are the old constants: if a theme forgets a variable the
   * board still draws, in the colours it always had.
   */
  const PAINT = {
    light: ["--sq-light", "#f0d9b5"],
    dark: ["--sq-dark", "#b58863"],
    sel: ["--sq-sel", "rgba(0, 150, 0, 0.52)"],
    last: ["--sq-last", "rgba(0, 255, 0, 0.28)"],
    check: ["--sq-check", "rgba(245, 70, 55, 0.52)"],
    dot: ["--sq-dot", "rgba(30, 30, 30, 0.28)"],
    ring: ["--sq-ring", "rgba(30, 30, 30, 0.32)"],
    // 1.12 moved the squares onto variables and stopped there, so these four
    // kept the wood theme's values on every board. They are marks *on* the
    // squares, and a theme that repaints the squares under them but not them
    // is the same half-done job the squares were.
    hint: ["--sq-hint", "rgba(5, 165, 255, 0.52)"],
    star: ["--sq-star", "rgba(230, 170, 30, 0.95)"],
    starEdge: ["--sq-star-edge", "rgba(120, 80, 0, 0.5)"],
    flash: ["--sq-flash", "rgba(72, 190, 100, 0.45)"],
    // the keyboard cursor is a double stroke because it has to stay legible on
    // both square colours *and* on top of a black or a white piece
    cursor: ["--sq-cursor", "rgba(255, 255, 255, 0.95)"],
    // the contact shadow under a standing piece: a light board wants a
    // different one from a dark board, so it belongs to the palette too
    pieceShadow: ["--piece-shadow", "rgba(38, 20, 4, 0.13)"],
    cursorEdge: ["--sq-cursor-edge", "rgba(20, 20, 20, 0.55)"],
    // the four annotation colours, lichess's letters: a theme tunes them
    // like every other mark, and the fallbacks are lichess's own values
    shapeG: ["--shape-g", "rgba(21, 120, 27, 0.8)"],
    shapeR: ["--shape-r", "rgba(136, 32, 32, 0.8)"],
    shapeB: ["--shape-b", "rgba(0, 48, 136, 0.8)"],
    shapeY: ["--shape-y", "rgba(232, 143, 0, 0.8)"],
    // 7.8 §2: the engine lines as arrows — line 1 in the hint's colour, the
    // other two the same hue a step lighter; letters E and e below
    engine: ["--engine-arrow", "rgba(5, 165, 255, 0.52)"],
    engineAlt: ["--engine-arrow-alt", "rgba(5, 165, 255, 0.28)"],
    // 7.7 §5: the analysis marks' badge, on the one scale the move list, the
    // report and the curve already read (--judge-*), and the two side inks
    // for the glyph inside it — whichever reads on that fill
    judgeSoft: ["--judge-soft", "#c9b458"],
    judgeMid: ["--judge-mid", "#e0a03c"],
    judgeBad: ["--judge-bad", "#e05252"],
    sideWhite: ["--side-white", "#f2f2ee"],
    sideBlack: ["--side-black", "#1d1d1b"],
  };
  const JUDGE_PAINT = { "?!": "judgeSoft", "?": "judgeMid", "??": "judgeBad" };
  const SHAPE_PAINT = { G: "shapeG", R: "shapeR", B: "shapeB", Y: "shapeY", E: "engine", e: "engineAlt" };
  /** resolved once per theme change, not once per square */
  let _paint = null;
  function paint() {
    if (_paint) return _paint;
    const out = {};
    let cs = null;
    try { cs = getComputedStyle(document.documentElement); } catch (_) { cs = null; }
    for (const key of Object.keys(PAINT)) {
      const [varName, fallback] = PAINT[key];
      const v = cs ? cs.getPropertyValue(varName).trim() : "";
      out[key] = v || fallback;
    }
    // the interface's own type for the one piece of text the board draws
    let ff = "";
    try { ff = document.body ? getComputedStyle(document.body).fontFamily : ""; } catch (_) { ff = ""; }
    out.font = ff || "sans-serif";
    _paint = out;
    return out;
  }
  /** call when the theme changes — the next draw re-reads the variables */
  function invalidatePaint() { _paint = null; _slideMs = null; }

  /**
   * How long a piece takes to slide, read from the same --dur-base the panel
   * and the buttons use. It was 150 written here, a fourth number in a fourth
   * place while the stylesheet ran seven of its own.
   *
   * @returns {number} milliseconds
   */
  let _slideMs = null;
  function slideMs() {
    if (_slideMs !== null) return _slideMs;
    let v = "";
    try { v = getComputedStyle(document.documentElement).getPropertyValue("--dur-base").trim(); }
    catch (_) { v = ""; }
    const m = /^(\.?\d*\.?\d+)(m?s)$/.exec(v);
    _slideMs = m ? Number(m[1]) * (m[2] === "s" ? 1000 : 1) : 200;
    return _slideMs;
  }

  /**
   * The same colour at zero alpha — the far stop of the check gradient, which
   * has to fade the theme's own red out rather than the one red that used to
   * be written here.
   *
   * @param {string} col a CSS colour as authored in the theme variables
   * @param {number} [alpha] the alpha to give it (default 0: transparent)
   * @returns {string} the same hue at that alpha
   */
  function fade(col, alpha) {
    const a = alpha == null ? 0 : alpha;
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(col);
    if (m) return "rgba(" + m[1] + "," + m[2] + "," + m[3] + "," + a + ")";
    const h = /^#([0-9a-f]{6})$/i.exec(col.trim());
    if (h) {
      const n = parseInt(h[1], 16);
      return "rgba(" + (n >> 16 & 255) + "," + (n >> 8 & 255) + "," + (n & 255) + "," + a + ")";
    }
    return "rgba(0,0,0," + a + ")";
  }

  /** Relative luminance of a #rrggbb / rgb() colour, 0..1 (WCAG). */
  function luminance(col) {
    let r = 0, g = 0, b = 0;
    const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(col);
    const h = /^#([0-9a-f]{6})$/i.exec(col.trim());
    if (m) { r = +m[1]; g = +m[2]; b = +m[3]; }
    else if (h) { const n = parseInt(h[1], 16); r = n >> 16 & 255; g = n >> 8 & 255; b = n & 255; }
    const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
  }

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
  // The drag lives in the model, not in a variable here — see draw(). It used
  // to be pushed in through setDrag(), which made the board hold a second copy
  // of something the app already knew: `store.ui.dragging`. Two copies of one
  // fact is one more than a renderer needs.
  /** how much a piece grows while it is being held */
  const LIFT = 1.12;
  /** live rebound of a refused drop: {piece, to, x, y, start, dur} | null */
  let _rebound = null;
  /** live slide animation: {from, to, start, dur} | null */
  let _anim = null;

  // --- SVG piece sprites (pieces.js). Vector art decoded once per square
  // size into offscreen canvases; the Unicode-glyph path below stays as a
  // fallback for the frames before the images finish decoding.
  const _imgs = {};
  let _sprites = {};
  let _spriteSize = 0;

  /**
   * The piece sets, by id (v7-7-plan §6). Each is licence-cleared in its own
   * module's header; the About panel lists them.
   */
  const PIECE_SETS = { cburnett: CHESS_PIECE_SVGS, merida: MERIDA_PIECE_SVGS };
  let _set = "cburnett";

  function initPieceImages() {
    const svgs = PIECE_SETS[_set] || CHESS_PIECE_SVGS;
    if (!svgs || typeof Image === "undefined") return;
    const want = _set;
    // A switch keeps drawing the old set until the whole new one has
    // decoded, then swaps all twelve at once: swapping piece by piece showed
    // a board of two sets, and clearing first showed the glyph fallback.
    const fresh = {};
    let left = Object.keys(svgs).length;
    const first = !Object.keys(_imgs).length;
    for (const key of Object.keys(svgs)) {
      const img = new Image();
      img.onload = () => {
        if (_set !== want) return; // superseded by a later switch
        if (first) { _sprites = {}; draw(); return; }
        if (--left === 0) { Object.assign(_imgs, fresh); _sprites = {}; draw(); }
      };
      img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgs[key]);
      if (first) _imgs[key] = img; else fresh[key] = img;
    }
  }

  /** Choose the piece set by id; an unknown id is ignored. */
  function setPieceSet(id) {
    if (!PIECE_SETS[id] || id === _set) return;
    _set = id;
    if (Object.keys(_imgs).length) initPieceImages();
  }

  /**
   * Offscreen raster of piece `key` at `size` device pixels, or null while the
   * SVGs are still decoding.
   *
   * Two sizes are cached, not one: the board size, and that size × LIFT. A
   * dragged piece is drawn 12% larger, and with a single cache that meant
   * scaling a bitmap up — so the one piece the player is looking at, held
   * under the pointer, was the only blurry thing on the board. 缺陷 18.
   *
   * design-constraints §2 says "只缓存一个尺寸 round(step)", because changing
   * size re-rasterises twelve pieces. That reasoning is about *board* sizes,
   * which change as the window does; these two are a fixed pair and the second
   * is only ever built while something is actually being dragged.
   */
  function spriteFor(key, size) {
    const img = _imgs[key];
    if (!img || !img.complete || !img.naturalWidth) return null;
    if (size !== _spriteSize && size !== Math.round(_spriteSize * LIFT)) {
      _sprites = {}; _spriteSize = size;
    }
    const ck = key + "@" + size;
    let c = _sprites[ck];
    if (!c) {
      c = document.createElement("canvas");
      c.width = size;
      c.height = size;
      c.getContext("2d").drawImage(img, 0, 0, size, size);
      _sprites[ck] = c;
    }
    return c;
  }

  /**
   * 7.8 §1c: the current set's picture of piece `key`, for the DOM — the
   * in-board promotion picker draws with the same art as the board, not the
   * Unicode glyphs it used to. A data: URL of the SVG the sprites decode.
   */
  function pieceSrc(key) {
    const svgs = PIECE_SETS[_set] || CHESS_PIECE_SVGS;
    return svgs && svgs[key] ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svgs[key]) : "";
  }

  /** Where `sq` is drawn right now: screen column and row, 0–7 from top left. */
  function screenCell(sq) {
    const m = _model ? _model() : null;
    const p = screenPos(sq, !!(m && m.flipped));
    return { col: p.sc, row: p.sr };
  }

  function attach(canvas, modelFn) {
    _canvas = canvas;
    _model = modelFn;
    if (!Object.keys(_imgs).length) initPieceImages();
  }

  /**
   * The mark scale: two radii, three stroke weights.
   *
   * Ten marks used to carry ten geometries — three ring radii (.44 / .45 /
   * .46) and seven stroke weights (.015 .02 .035 .045 .055 .06 .075). The
   * visible cost: the drag ring (.46 / .06) sat on the legal-target ring
   * (.44 / .075) as two almost-concentric circles of different thickness,
   * which reads as a rendering fault rather than as two marks. 缺陷 16.
   *
   * Every mark now picks a step instead of inventing one. Fractions of the
   * square, so they hold at any board size.
   */
  const MARK = {
    /** a ring drawn around a square — one radius, whatever it means */
    ring: 0.45,
    /** the dot inside a legal-target ring on an occupied square */
    dot: 0.14,
    /** hairline: an outline whose job is contrast, not weight */
    hair: 0.02,
    /** the ordinary mark weight */
    line: 0.045,
    /** the one the eye should go to first */
    bold: 0.075,
    /** the hint arrow's shaft — a body, not a stroke round something else */
    arrow: 0.13,
  };

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
   * @param {{sq: string, piece: {type: string, color: string}}} [taken] the
   *   man this move captured, and where he stood (not `to` for en passant).
   *   7.7 §9: he fades out under the arriving piece over the same window,
   *   instead of being gone before it has left its square. The model has
   *   already moved on when this is called, so the caller has to say who it was.
   */
  function animateMove(from, to, also, taken) {
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
    _anim = { segs, taken: taken && taken.sq && taken.piece ? taken : null,
      start: (typeof performance !== "undefined" ? performance.now() : 0), dur: slideMs() };
    const step = () => {
      if (!_anim) return;
      const now = typeof performance !== "undefined" ? performance.now() : _anim.start + _anim.dur;
      if (now - _anim.start >= _anim.dur) { _anim = null; draw(); return; }
      draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function cancelAnim() { _anim = null; _rebound = null; }

  /**
   * Send a refused piece home from where the pointer let it go.
   * @param {object} piece the {type, color} being dragged
   * @param {string} to the square it came from
   * @param {number} x pointer position at the moment of the drop
   * @param {number} y
   */
  function reboundDrag(piece, to, x, y) {
    if (!_canvas || !_model || !piece || !to) return;
    if (_reduceMotion) { _rebound = null; return; }
    _rebound = { piece, to, x, y, start: (typeof performance !== "undefined" ? performance.now() : 0), dur: slideMs() };
    const step = () => {
      if (!_rebound) return;
      const now = typeof performance !== "undefined" ? performance.now() : _rebound.start + _rebound.dur;
      if (now - _rebound.start >= _rebound.dur) { _rebound = null; draw(); return; }
      draw();
      requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
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

  /**
   * Fill the frame's coordinate gutters, reordering them when the board flips.
   * Rebuilt only when the orientation actually changes — draw() runs on every
   * animation frame during a move.
   */
  let coordFlip = null;
  function drawCoords(flipped, on) {
    // 6.0: the gutters can be emptied (v6-plan Q2.8) — `null` marks "nothing
    // drawn" so switching back on repaints for the current orientation
    const key = on === false ? "off" : !!flipped;
    if (coordFlip === key) return;
    coordFlip = key;
    const files = typeof document !== "undefined" && document.getElementById("coord-files");
    const ranks = typeof document !== "undefined" && document.getElementById("coord-ranks");
    if (!files || !ranks) return;
    if (on === false) { files.replaceChildren(); ranks.replaceChildren(); return; }
    const fs = FILES.split("");
    const rs = ["8", "7", "6", "5", "4", "3", "2", "1"];
    const span = (t) => {
      const el = document.createElement("span");
      el.textContent = t;
      return el;
    };
    files.replaceChildren(...(coordFlip ? fs.slice().reverse() : fs).map(span));
    ranks.replaceChildren(...(coordFlip ? rs.slice().reverse() : rs).map(span));
  }

  function draw() {
    if (!_canvas || !_model) return;
    const m = _model();
    const _drag = m.drag || null;
    const P = paint();
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
        ctx.fillStyle = (sr + sc) % 2 === 0 ? P.light : P.dark;
        ctx.fillRect(...cellRect(sr, sc));
      }
    }
    // last-move tint
    if (m.lastMove) {
      for (const sq of [m.lastMove.from, m.lastMove.to]) {
        const { sr, sc } = screenPos(sq, m.flipped);
        ctx.fillStyle = P.last;
        ctx.fillRect(...cellRect(sr, sc));
      }
    }
    // selection
    if (m.selected) {
      const { sr, sc } = screenPos(m.selected, m.flipped);
      ctx.fillStyle = P.sel;
      ctx.fillRect(...cellRect(sr, sc));
    }
    // Check highlight (radial under the king). Checkmate gets the same wash
    // plus a ring: until 1.22.1 the end of the game looked exactly like being
    // checked once, which is the wrong emphasis for the one frame a player is
    // most likely to sit and look at.
    //
    // 7.7 §6: a glow, not a wash. The gradient used to start at the token's
    // own alpha (.52) and fade linearly to the square's edge, which on screen
    // was a red square with softened corners — "flat" in the walk-through.
    // Now it is Lichess's shape: a hot core under the king, the token's
    // strength by a third of the way out, gone before the corners. Still one
    // square, still through cellRect(): the glow is clipped to the king's
    // square by the fill, so it never bleeds onto a neighbour.
    if (m.checkSquare) {
      const { sr, sc } = screenPos(m.checkSquare, m.flipped);
      const cx = sc * step + step / 2, cy = sr * step + step / 2;
      const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, step * 0.7);
      g.addColorStop(0, fade(P.check, 0.95));
      g.addColorStop(0.3, P.check);
      g.addColorStop(1, fade(P.check));
      ctx.fillStyle = g;
      ctx.fillRect(...cellRect(sr, sc));
      if (m.mated) {
        ctx.beginPath();
        ctx.arc(cx, cy, step * MARK.ring, 0, Math.PI * 2);
        ctx.strokeStyle = P.check;
        ctx.lineWidth = step * MARK.line;
        ctx.stroke();
      }
    }
    // Coordinates are no longer painted here: they are printed on the frame
    // around the board (see .coords in styles.css), which is where a real
    // board has them and where they cannot sit on top of the a1/h1 rooks.
    drawCoords(m.flipped, m.coords !== false);
    // pieces: crisp vector sprites, Unicode glyphs only while sprites decode
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = Math.round(step * 0.78) + "px 'Segoe UI Symbol', 'Apple Color Emoji', serif";
    const spriteSize = Math.max(8, Math.round(step));
    /**
     * The shadow that says a piece is standing ON something.
     *
     * ctx.shadowColor appeared exactly once in this whole file, in the drag
     * branch — so thirty-two pieces sat directly on flat colour with no
     * contact at all, while the frame around them had a gradient, an outer
     * shadow and an inner stroke. 缺陷 17. It is a very small ellipse: about
     * 2% of a square offset down, 6% blurred, and faint enough that nobody
     * will point at it — which is the difference between "a wooden board" and
     * "two shades of brown".
     */
    function paintContactShadow(x, y, sz) {
      ctx.save();
      ctx.fillStyle = P.pieceShadow;
      ctx.filter = "blur(" + (step * 0.06).toFixed(2) + "px)";
      ctx.beginPath();
      ctx.ellipse(x, y + sz * 0.33, sz * 0.30, sz * 0.09, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    function paintPiece(piece, x, y, scale) {
      // 6.0 blindfold (v6-plan Q2.8): the marks, the cursor and the drag still
      // draw — only the men are withheld, which is the whole exercise
      if (m.blind) return;
      const k = scale || 1;
      // Rastered at the size it is drawn at. Until 2.0 the lifted piece was
      // the board sprite scaled up 12% at draw time, which made the one piece
      // under the pointer the only stretched bitmap on the board. 缺陷 18.
      const sz = k === 1 ? spriteSize : Math.round(spriteSize * k);
      const sprite = spriteFor(piece.color + piece.type, sz);
      if (sprite) {
        if (k === 1) paintContactShadow(x, y, sz); // the drag has its own, larger
        ctx.drawImage(sprite, Math.round(x - sz / 2), Math.round(y - sz / 2));
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
      ctx.lineWidth = Math.max(1, step * MARK.hair);
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
      // the captured man, fading under whoever is arriving — drawn first so
      // the mover passes over him (animateMove's `taken`)
      const lands = (sq) => { const r = m.position[8 - Number(sq[1])]; return !!(r && r[FILES.indexOf(sq[0])]); };
      if (_anim.taken && _anim.segs.some((sg) => lands(sg.to))) {
        const { sr, sc } = screenPos(_anim.taken.sq, m.flipped);
        ctx.save();
        ctx.globalAlpha = 1 - t;
        paintPiece(_anim.taken.piece, sc * step + step / 2, sr * step + step / 2);
        ctx.restore();
      }
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
      ctx.fillStyle = P.flash;
      // through cellRect() like every other square fill — this was the one
      // site that painted on fractional edges, so the flash could show a soft
      // seam against its neighbours at some board sizes. Defect 10.
      ctx.fillRect(...cellRect(sr, sc));
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
        ctx.fillStyle = P.star;
        ctx.fill();
        ctx.strokeStyle = P.starEdge;
        ctx.lineWidth = Math.max(1, step * MARK.hair);
        ctx.stroke();
      }
    }
    // one arrow, for the engine's hint and for the player's own: the shaft
    // is MARK.arrow, and the geometry is the same whoever drew it
    function paintArrow(from, to, colour) {
      const a = screenPos(from, m.flipped);
      const b = screenPos(to, m.flipped);
      const ax = a.sc * step + step / 2, ay = a.sr * step + step / 2;
      const bx = b.sc * step + step / 2, by = b.sr * step + step / 2;
      const ang = Math.atan2(by - ay, bx - ax);
      const head = step * 0.3;
      // stop the shaft where the arrowhead begins
      const sx = bx - Math.cos(ang) * head * 0.8;
      const sy = by - Math.sin(ang) * head * 0.8;
      ctx.strokeStyle = colour;
      ctx.fillStyle = colour;
      ctx.lineWidth = step * MARK.arrow;
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
    // the player's annotations (v6-plan Q2.4): circles at the one ring
    // radius in the bold weight, arrows as above, colours from the theme
    if (m.shapes) {
      for (const c of m.shapes.circles || []) {
        const { sr, sc } = screenPos(c.sq, m.flipped);
        ctx.beginPath();
        ctx.arc(sc * step + step / 2, sr * step + step / 2, step * MARK.ring, 0, Math.PI * 2);
        ctx.strokeStyle = P[SHAPE_PAINT[c.color] || "shapeG"];
        ctx.lineWidth = step * MARK.bold;
        ctx.stroke();
      }
      for (const a of m.shapes.arrows || []) paintArrow(a.from, a.to, P[SHAPE_PAINT[a.color] || "shapeG"]);
    }
    // engine hint arrow on top of pieces
    if (m.hintMove) paintArrow(m.hintMove.from, m.hintMove.to, P.hint);
    // 7.7 §5: the analysis mark of the move that led here, as a badge in the
    // top-right corner of the square it landed on — where Lichess and
    // Chess.com put it, so the eye that follows the last-move tint finds it.
    // Only the three marks the analysis has (?! ? ??), coloured from the same
    // --judge-* scale as the move list; the glyph takes whichever side ink
    // reads on that fill. Drawn inside the square, so a1–h8 corners never
    // clip it.
    if (m.annotation && JUDGE_PAINT[m.annotation.tag]) {
      const { sr, sc } = screenPos(m.annotation.sq, m.flipped);
      const r = step * 0.19;
      const cx = (sc + 1) * step - r - step * 0.03, cy = sr * step + r + step * 0.03;
      const fill = P[JUDGE_PAINT[m.annotation.tag]];
      ctx.save();
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.lineWidth = Math.max(1, step * MARK.hair);
      ctx.strokeStyle = P.cursorEdge;
      ctx.stroke();
      ctx.fillStyle = luminance(fill) > 0.4 ? P.sideBlack : P.sideWhite;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      const tag = m.annotation.tag;
      ctx.font = "600 " + Math.round(r * (tag.length > 1 ? 0.95 : 1.25)) + "px " + P.font;
      ctx.fillText(tag, cx, cy + r * 0.04);
      ctx.restore();
    }
    // The dragged piece follows the pointer above everything else, lifted:
    // a shadow and a little scale, so it reads as picked UP rather than as a
    // copy sliding under the glass.
    if (_drag && dragPiece) {
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.38)";
      ctx.shadowBlur = step * 0.14;
      ctx.shadowOffsetY = step * 0.06;
      paintPiece(dragPiece, _drag.x, _drag.y, LIFT);
      ctx.restore();
    }
    // A piece dropped where it cannot go returns to where it came from. It
    // used to vanish from under the pointer and reappear on its old square,
    // which reads as a glitch rather than as "no".
    if (_rebound) {
      const now = typeof performance !== "undefined" ? performance.now() : _rebound.start + _rebound.dur;
      const t = easeOut(Math.max(0, Math.min(1, (now - _rebound.start) / _rebound.dur)));
      const { sr, sc } = screenPos(_rebound.to, m.flipped);
      const tx = sc * step + step / 2, ty = sr * step + step / 2;
      ctx.save();
      ctx.globalAlpha = 1 - t * 0.25;
      paintPiece(_rebound.piece, _rebound.x + (tx - _rebound.x) * t,
        _rebound.y + (ty - _rebound.y) * t, LIFT - (LIFT - 1) * t);
      ctx.restore();
    }
    // keyboard cursor: a focus ring that must stay readable on both square
    // colours and on top of pieces, so it is drawn as a double stroke
    if (m.cursor) {
      const { sr, sc } = screenPos(m.cursor, m.flipped);
      const x = edge(sc), y = edge(sr);
      const w2 = edge(sc + 1) - x, h2 = edge(sr + 1) - y;
      const lw = Math.max(2, step * MARK.line);
      ctx.strokeStyle = P.cursorEdge;
      ctx.lineWidth = lw * 1.8;
      ctx.strokeRect(x + lw, y + lw, w2 - lw * 2, h2 - lw * 2);
      ctx.strokeStyle = P.cursor;
      ctx.lineWidth = lw;
      ctx.strokeRect(x + lw, y + lw, w2 - lw * 2, h2 - lw * 2);
    }
    // The square under a dragged piece. A drop is a commitment made with the
    // pointer somewhere over a 60-pixel square, and until now nothing said
    // which square that was — the player found out by letting go.
    if (_drag && _drag.over) {
      const { sr, sc } = screenPos(_drag.over, m.flipped);
      const cx = sc * step + step / 2, cy = sr * step + step / 2;
      ctx.beginPath();
      ctx.arc(cx, cy, step * MARK.ring, 0, Math.PI * 2);
      ctx.strokeStyle = _drag.legal ? P.ring : P.cursor;
      ctx.globalAlpha = _drag.legal ? 0.95 : 0.3;
      ctx.lineWidth = step * (_drag.legal ? MARK.bold : MARK.hair);
      ctx.stroke();
      ctx.globalAlpha = 1;
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
          ctx.arc(cx, cy, step * MARK.ring, 0, Math.PI * 2);
          ctx.strokeStyle = P.ring;
          ctx.lineWidth = step * MARK.bold;
          ctx.stroke();
        } else {
          ctx.arc(cx, cy, step * MARK.dot, 0, Math.PI * 2);
          ctx.fillStyle = P.dot;
          ctx.fill();
        }
      }
    }
  }

  /**
   * The surface, in three groups.
   *
   *   paint      draw() — "here is the model, put it on screen". Everything
   *              the board shows is in the model it reads: the position, the
   *              selection, the legal targets, the last move, the check, the
   *              hint arrow, the stars, the flash, the cursor, and since 1.25
   *              the drag. Nothing is pushed in ahead of time.
   *   lifecycle  attach() / resizeCanvas() / invalidatePaint() / setPieceSet() — the canvas
   *              itself, its backing store, and the theme colours it caches.
   *   effects    animateMove() / reboundDrag() / cancelAnim() — the three
   *              things that are genuinely time, not state. An animation is
   *              not a fact about the position; it is a thing that happens to
   *              it, and it ends.
   *   hit test   cellAt() — the inverse of paint, and the only reason the app
   *              needs to know the board's geometry at all.
   */
  export const ChessBoardView = { draw, attach, resizeCanvas, invalidatePaint,
    animateMove, reboundDrag, cancelAnim, cellAt, setPieceSet, pieceSrc, screenCell };
