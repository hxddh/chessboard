/**
 * The board component (ADR 0002): `createBoard(el, opts)`, one instance per
 * call, as many per page as wanted. It owns a canvas, a scene and an input
 * machine; it knows the rules only to offer legal moves (from the FEN, or the
 * `dests` given), and reports what the player did through `onMove`.
 *
 *   const b = createBoard(el, { fen, orientation: "white", movable: "white", onMove })
 *   b.set({ fen, lastMove })    // a new position animates from the old one
 *
 * Options (all optional, all settable later with set()):
 *   fen            position (default: the start)
 *   orientation    "white" | "black"
 *   movable        "white" | "black" | "both" | "none" — who may move pieces
 *   dests          Map(from → [to]) — legal moves; default: computed from fen
 *   lastMove       { from, to } | null
 *   check          square | true (the side to move's king, if in check) | null
 *   premove        true — the waiting side may queue one move
 *   arrows, marks  programmatic shapes: [{ from, to, color }], [{ sq, color }]
 *                  colours G R B Y, E/e for engine lines
 *   animation      ms (250); under 70 is none; prefers-reduced-motion is none
 *   pieceSet       "merida" | "cburnett" | "classic"
 *   theme          "wood" | "green" | "blue" — sets data-board on the element
 *   coords         true
 *   onMove({ from, to, drop, premove }), onShapes({ arrows, marks })
 *   onReady()      once, after the first frame drawn with the piece set
 * @module board
 */
import { createScene } from "./scene.js";
import { createInput } from "./input.js";
import { paint, readPaint } from "./render.js";
import { loadSet } from "./pieces.js";
import { readFen, premoveDests, fromScreen, sqFile, sqRank } from "./geometry.js";
import { DEFAULT_MS, effectiveMs, snapbackMs, hoverMs } from "./tween.js";
import { legalDests, checkSquare, START_FEN, turnOf } from "../core/rules.js";
import { DEFAULT_PIECE_SET } from "../core/pieces.js";

const now = () => performance.now();
const reducedQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
const reduced = () => !!(reducedQuery && reducedQuery.matches);

export function createBoard(el, opts = {}) {
  const o = {
    fen: START_FEN, orientation: "white", movable: "both", dests: null, lastMove: null, check: true,
    premove: true, arrows: [], marks: [], animation: DEFAULT_MS, pieceSet: DEFAULT_PIECE_SET, theme: "wood",
    coords: true, onMove: () => {}, onShapes: () => {}, onReady: null, ...opts,
  };
  let placement = readFen(o.fen);
  // the legal moves are worked out when first asked for (a press), not while the page mounts
  let dests = o.dests || null;
  const destsNow = () => (dests ||= legalDests(o.fen));
  let snap = [];
  let pal = null;

  const canvas = document.createElement("canvas");
  canvas.className = "cb-canvas";
  canvas.tabIndex = 0;
  canvas.setAttribute("role", "application");
  canvas.setAttribute("aria-label", o.label || "棋盘");
  el.classList.add("cb-board");
  el.dataset.board = o.theme;
  el.append(canvas);
  const ctx = canvas.getContext("2d");

  const turn = () => (turnOf(o.fen) === "w" ? "white" : "black");
  function canPick(sq) {
    const code = placement.get(sq);
    if (!code || o.movable === "none") return null;
    const side = code[0] === "w" ? "white" : "black";
    if (side === turn() && (o.movable === "both" || o.movable === side)) return "move";
    if (o.premove && o.movable === side) return "premove";
    return null;
  }
  const input = createInput({
    canPick,
    dests: (from) => destsNow().get(from) || [],
    premoveDests: (from) => premoveDests(placement, from),
    orientation: () => o.orientation,
  });
  const scene = createScene();

  // --- view → scene -----------------------------------------------------------

  let checkFor = null, checkAt = null;
  function kingInCheck() {
    if (checkFor !== o.fen) { checkFor = o.fen; checkAt = checkSquare(o.fen); }
    return checkAt;
  }

  const ms = () => effectiveMs(o.animation, reduced());
  const xy = (sq) => ({ x: sqFile(sq), y: sqRank(sq) });

  function overlays() {
    const s = input.state, list = [];
    const sq = (key, square, color) => list.push({ key, kind: "square", color, ...xy(square) });
    if (o.lastMove) { sq("last:" + o.lastMove.from, o.lastMove.from, "last"); sq("last:" + o.lastMove.to, o.lastMove.to, "last"); }
    if (s.premove) { sq("pre:" + s.premove.from, s.premove.from, "premove"); sq("pre:" + s.premove.to, s.premove.to, "premove"); }
    if (s.selected) sq("sel:" + s.selected.sq, s.selected.sq, s.selected.mode === "move" ? "sel" : "premove");
    // the legal square under a man in the hand
    if (s.drag && s.drag.active && s.drag.over && s.drag.over !== s.drag.from && input.targets().includes(s.drag.over))
      sq("hover:" + s.drag.over, s.drag.over, "hover");
    const chk = o.check === true ? kingInCheck() : o.check;
    if (chk) list.push({ key: "check:" + chk, kind: "check", ...xy(chk) });
    for (const t of input.targets()) list.push({ key: "hint:" + t, kind: placement.has(t) ? "ring" : "dot", ...xy(t) });
    for (const m of [...o.marks, ...s.shapes.marks]) list.push({ key: "mark:" + m.sq + m.color, kind: "circle", color: m.color, ...xy(m.sq) });
    o.arrows.forEach((a, i) => {
      const p = xy(a.from), q = xy(a.to);
      list.push({ key: "auto:" + i, kind: "arrow", color: a.color || "E", x: p.x, y: p.y, x2: q.x, y2: q.y });
    });
    for (const a of s.shapes.arrows) {
      const p = xy(a.from), q = xy(a.to);
      list.push({ key: "arrow:" + a.from + a.to + a.color, kind: "arrow", color: a.color, x: p.x, y: p.y, x2: q.x, y2: q.y });
    }
    return list;
  }

  // --- drawing ------------------------------------------------------------------

  let frameReq = 0;
  let setReady = false;
  const stats = { frames: 0 };
  function draw() {
    frameReq = 0;
    if (!canvas.width) return;
    if (!pal) pal = readPaint(el);
    const t = now();
    const f = scene.frame(t);
    const s = input.state;
    const drag = s.drag && s.drag.active ? s.drag : null;
    paint(ctx, canvas.width, f, {
      orientation: o.orientation, paint: pal, set: o.pieceSet, coords: o.coords,
      cursor: s.cursor && document.activeElement === canvas ? [sqFile(s.cursor), sqRank(s.cursor)] : null,
      drag: drag && placement.get(drag.from) ? { code: placement.get(drag.from), ...toCanvas(drag.x, drag.y) } : null,
      ghost: drag ? drag.from : null,
    });
    stats.frames++;
    if (setReady && o.onReady) { const cb = o.onReady; o.onReady = null; cb(); }
    if (f.busy || drag) request();
  }
  function request() { if (!frameReq) frameReq = requestAnimationFrame(draw); }

  function refresh(animate = true, dur = ms()) {
    scene.setOverlays(overlays(), { now: now(), ms: animate ? dur : 0 });
    request();
  }

  // --- geometry -----------------------------------------------------------------

  // While a pointer is down the canvas does not move: its box is read once
  // at the press, not on every pointermove and frame (no layout reads in the drag).
  let rect = null;
  const box = () => rect || canvas.getBoundingClientRect();
  // The size comes from the observer (after the page's own layout), never by
  // reading the layout while the page mounts: the first size is drawn on the
  // next frame, so mounting, the first layout and the first draw are three
  // short tasks, not one long one. A later resize draws at once (no blank frame).
  let sized = false;
  function resize() {
    rect = null;
    const r = canvas.getBoundingClientRect();
    const px = Math.max(64, Math.round(r.width * (devicePixelRatio || 1)));
    if (canvas.width === px) return;
    canvas.width = canvas.height = px;
    if (sized) draw(); else { sized = true; request(); }
  }
  const ro = new ResizeObserver(resize);
  ro.observe(el);

  function toCanvas(clientX, clientY) {
    const r = box();
    return { x: (clientX - r.left) * canvas.width / r.width, y: (clientY - r.top) * canvas.height / r.height };
  }
  /** Client coordinates → board space (float file, rank; square centres on integers). */
  function boardXY(clientX, clientY) {
    const r = box();
    const col = (clientX - r.left) / (r.width / 8) - 0.5, row = (clientY - r.top) / (r.height / 8) - 0.5;
    return o.orientation === "black" ? { x: 7 - col, y: row } : { x: col, y: 7 - row };
  }
  function squareAt(clientX, clientY) {
    const r = box();
    const col = Math.floor((clientX - r.left) / (r.width / 8)), row = Math.floor((clientY - r.top) / (r.height / 8));
    return col >= 0 && col < 8 && row >= 0 && row < 8 ? fromScreen(col, row, o.orientation) : null;
  }

  // --- commands from input ---------------------------------------------------

  let ptr = null; // the last pointer position, client coordinates
  function run(commands) {
    for (const c of commands) {
      if (c.type === "move") {
        // a dropped man is already where it lands: the set() the page makes in
        // answer, synchronously, must not slide it there again — it settles
        // from where it was let go
        snap = c.drop ? [ptr ? { sq: c.to, ...boardXY(ptr.x, ptr.y) } : c.to] : [];
        o.onMove({ from: c.from, to: c.to, drop: !!c.drop, premove: !!c.premove });
        snap = [];
      } else if (c.type === "snapback") {
        if (ptr) { const p = boardXY(ptr.x, ptr.y); scene.release(c.from, p.x, p.y, { now: now(), ms: snapbackMs(ms()) }); }
      } else if (c.type === "shapes") o.onShapes(input.state.shapes);
    }
    refresh();
  }

  // the pointer's shape says what a press would do: pick up, put down, nothing
  let cursorNow = "";
  function setCursor(c) { if (c !== cursorNow) { cursorNow = c; canvas.style.cursor = c; } }
  function hoverCursor(sq) {
    if (!sq) return setCursor("");
    if (input.targets().includes(sq)) return setCursor("pointer");
    setCursor(canPick(sq) ? "grab" : "");
  }

  const mods = (e) => ({ shiftKey: e.shiftKey, altKey: e.altKey || e.ctrlKey || e.metaKey });
  function onDown(e) {
    if (e.button !== 0 && e.button !== 2) return;
    e.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(e.pointerId);
    rect = canvas.getBoundingClientRect();
    ptr = { x: e.clientX, y: e.clientY };
    run(input.down(squareAt(e.clientX, e.clientY), e.clientX, e.clientY, e.button, mods(e)));
  }
  function onMovePointer(e) {
    const sq = squareAt(e.clientX, e.clientY);
    const d = input.state.drag;
    if (!d) return hoverCursor(sq);
    ptr = { x: e.clientX, y: e.clientY };
    const wasActive = d.active, overBefore = d.over;
    if (input.move(sq, e.clientX, e.clientY)) {
      setCursor("grabbing");
      // the hover square changes only when the square under the man does
      if (!wasActive || d.over !== overBefore) refresh(true, hoverMs(ms()));
      else request();
    }
  }
  function onUp(e) {
    if (e.button !== 0 && e.button !== 2) return;
    ptr = { x: e.clientX, y: e.clientY };
    const sq = squareAt(e.clientX, e.clientY);
    run(input.up(sq, e.clientX, e.clientY, e.button, mods(e)));
    rect = null;
    hoverCursor(sq);
  }
  function onCancel() { run(input.cancel()); rect = null; setCursor(""); }
  function onKey(e) {
    const r = input.key(e.key, o.orientation === "black" ? "e7" : "e2");
    if (!r.handled) return;
    e.preventDefault();
    run(r.commands);
  }
  const noMenu = (e) => e.preventDefault();
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMovePointer);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onCancel);
  canvas.addEventListener("contextmenu", noMenu);
  canvas.addEventListener("keydown", onKey);
  canvas.addEventListener("blur", request);
  canvas.addEventListener("pointerleave", () => { if (!input.state.drag) setCursor(""); });

  // --- public -------------------------------------------------------------------

  function set(next = {}) {
    const fenChanged = next.fen !== undefined && next.fen !== o.fen;
    const themeChanged = next.theme !== undefined && next.theme !== o.theme;
    const setChanged = next.pieceSet !== undefined && next.pieceSet !== o.pieceSet;
    const { animate = true, shapes, ...rest } = next;
    Object.assign(o, rest);
    if (themeChanged) { el.dataset.board = o.theme; pal = null; }
    if (setChanged) loadSet(o.pieceSet).then(request);
    if (next.dests) dests = next.dests;
    else if (fenChanged) dests = null;
    if (fenChanged) {
      placement = readFen(o.fen);
      scene.setPieces(placement, { now: now(), ms: animate ? ms() : 0, snap });
      const later = input.positionChanged();
      if (later.length) queueMicrotask(() => run(later));
    }
    if (shapes) input.setShapes(shapes);
    refresh(animate);
  }

  scene.setPieces(placement, { now: now(), ms: 0 });
  refresh(false);
  loadSet(o.pieceSet).then(() => { setReady = true; request(); });

  return {
    el, canvas, set,
    /** A snapshot for tests and for the page: what is selected, queued, drawn. */
    state() {
      const s = input.state;
      return { fen: o.fen, orientation: o.orientation, selected: s.selected && s.selected.sq,
        premove: s.premove, shapes: s.shapes, cursor: s.cursor, dragging: !!(s.drag && s.drag.active),
        targets: input.targets(), animating: scene.frame(now()).busy, moving: scene.frame(now()).moving, frames: stats.frames,
        hover: s.drag && s.drag.active && s.drag.over !== s.drag.from && input.targets().includes(s.drag.over) ? s.drag.over : null,
        pointer: cursorNow,
        check: o.check === true ? kingInCheck() : o.check || null, arrows: o.arrows, marks: o.marks, movable: o.movable };
    },
    /** Client coordinates of a square's centre. */
    squareCenter(sq) {
      const r = canvas.getBoundingClientRect(), s = r.width / 8;
      let col = sqFile(sq), row = 7 - sqRank(sq);
      if (o.orientation === "black") { col = 7 - col; row = 7 - row; }
      return { x: r.left + (col + 0.5) * s, y: r.top + (row + 0.5) * s };
    },
    squareAt,
    cancelPremove() { input.clearPremove(); refresh(); },
    destroy() {
      ro.disconnect();
      if (frameReq) cancelAnimationFrame(frameReq);
      canvas.remove();
      el.classList.remove("cb-board");
    },
  };
}
