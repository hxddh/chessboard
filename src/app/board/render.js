/**
 * Canvas painting of one scene frame. The drawing is 19.0's (board.js): flat
 * squares, a radial glow under a checked king, a contact shadow under each
 * man, rings and dots for legal moves, round-capped arrows.
 * @module board/render
 */
import { sprite } from "./pieces.js";
import { LIFT_SCALE } from "./tween.js";
import { toScreen, FILES } from "./geometry.js";

/** CSS custom properties the board paints with, and their fallbacks. */
const PAINT = {
  light: ["--sq-light", "#f0d9b5"],
  dark: ["--sq-dark", "#b58863"],
  sel: ["--sq-sel", "rgba(99, 77, 34, .52)"],
  last: ["--sq-last", "rgba(220, 170, 75, .52)"],
  check: ["--sq-check", "rgba(215, 55, 45, .52)"],
  premove: ["--sq-hint", "rgba(5, 165, 255, .52)"],
  hover: ["--sq-hover", "rgba(20, 85, 30, .3)"],
  dot: ["--sq-dot", "rgba(30, 30, 30, .28)"],
  ring: ["--sq-ring", "rgba(30, 30, 30, .28)"],
  cursor: ["--sq-cursor", "rgba(255, 255, 255, .95)"],
  cursorEdge: ["--sq-cursor-edge", "rgba(20, 20, 20, .55)"],
  pieceShadow: ["--piece-shadow", "rgba(38, 20, 4, .13)"],
  G: ["--shape-g", "rgba(21, 120, 27, .72)"],
  R: ["--shape-r", "rgba(136, 32, 32, .72)"],
  B: ["--shape-b", "rgba(0, 48, 136, .72)"],
  Y: ["--shape-y", "rgba(232, 143, 0, .72)"],
  E: ["--engine-arrow", "rgba(5, 165, 255, .52)"],
  e: ["--engine-arrow-alt", "rgba(5, 165, 255, .28)"],
};

/** Resolve the palette from an element's computed style. */
export function readPaint(el) {
  const cs = getComputedStyle(el);
  const out = {};
  for (const [k, [name, fallback]] of Object.entries(PAINT)) out[k] = cs.getPropertyValue(name).trim() || fallback;
  out.font = cs.fontFamily || "sans-serif";
  return out;
}

const GLYPHS = { k: "♚", q: "♛", r: "♜", b: "♝", n: "♞", p: "♟" };

/** The colour at a given alpha, for the far stop of a gradient. */
function fade(col, a) {
  const m = /rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)/.exec(col);
  if (m) return `rgba(${m[1]},${m[2]},${m[3]},${a})`;
  const h = /^#([0-9a-f]{6})$/i.exec(col);
  if (h) { const n = parseInt(h[1], 16); return `rgba(${n >> 16 & 255},${n >> 8 & 255},${n & 255},${a})`; }
  return `rgba(0,0,0,${a})`;
}

const shadows = new Map();
/** A blurred ellipse, made once per size and stamped: a blur per man is too slow without a GPU. */
function contactShadow(px, color) {
  const k = px + color;
  let c = shadows.get(k);
  if (!c) {
    c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    g.fillStyle = color;
    g.filter = "blur(" + (px * 0.06).toFixed(2) + "px)";
    g.beginPath();
    g.ellipse(px / 2, px / 2, px * 0.3, px * 0.09, 0, 0, Math.PI * 2);
    g.fill();
    shadows.set(k, c);
  }
  return c;
}

/**
 * @param {CanvasRenderingContext2D} ctx
 * @param {number} size canvas width in device pixels
 * @param {{ pieces: object[], overlays: object[] }} frame scene.frame()
 * @param {object} v view: { orientation, paint, set, coords, cursor, drag: {code, x, y}|null, ghost: sq|null }
 */
export function paint(ctx, size, frame, v) {
  const P = v.paint, step = size / 8;
  const edge = (i) => Math.round(i * step);
  // board space (float file, rank) → centre in canvas pixels
  const centre = (x, y) => {
    const s = toScreen(x, y, v.orientation);
    return [s.col * step + step / 2, s.row * step + step / 2];
  };
  const cell = (x, y) => {
    const s = toScreen(Math.round(x), Math.round(y), v.orientation);
    return [edge(s.col), edge(s.row), edge(s.col + 1) - edge(s.col), edge(s.row + 1) - edge(s.row)];
  };

  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    ctx.fillStyle = (r + c) % 2 === 0 ? P.light : P.dark;
    ctx.fillRect(edge(c), edge(r), edge(c + 1) - edge(c), edge(r + 1) - edge(r));
  }

  const over = { square: [], check: [], dot: [], ring: [], circle: [], arrow: [] };
  for (const o of frame.overlays) (over[o.kind] || []).push(o);

  for (const o of over.square) {
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = P[o.color] || P.last;
    ctx.fillRect(...cell(o.x, o.y));
  }
  for (const o of over.check) {
    const [cx, cy] = centre(o.x, o.y);
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, step * 0.7);
    g.addColorStop(0, fade(P.check, 0.95));
    g.addColorStop(0.3, P.check);
    g.addColorStop(1, fade(P.check, 0));
    ctx.globalAlpha = o.alpha;
    ctx.fillStyle = g;
    ctx.fillRect(...cell(o.x, o.y));
  }
  ctx.globalAlpha = 1;

  const px = Math.max(8, Math.round(step));
  const drawMan = (code, cx, cy, alpha = 1, scale = 1, shadow = true) => {
    ctx.globalAlpha = alpha;
    const sz = Math.round(px * scale);
    const img = sprite(v.set, code, sz);
    if (img) {
      if (shadow) ctx.drawImage(contactShadow(sz, P.pieceShadow), cx - sz / 2, cy - sz * 0.17);
      ctx.drawImage(img, Math.round(cx - sz / 2), Math.round(cy - sz / 2));
    } else {
      ctx.font = Math.round(step * 0.78 * scale) + "px serif";
      ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = code[0] === "w" ? "#f8f8f4" : "#1d1d1b";
      ctx.strokeStyle = code[0] === "w" ? "rgba(20,20,20,.85)" : "rgba(255,255,255,.3)";
      ctx.lineWidth = Math.max(1, step * 0.02);
      ctx.strokeText(GLYPHS[code[1]], cx, cy + step * 0.04);
      ctx.fillText(GLYPHS[code[1]], cx, cy + step * 0.04);
    }
    ctx.globalAlpha = 1;
  };
  for (const p of frame.pieces) {
    const [cx, cy] = centre(p.x, p.y);
    const ghost = v.ghost && !p.leaving && p.sq === v.ghost;
    drawMan(p.code, cx, cy, ghost ? 0.3 * p.alpha : p.alpha, p.scale, !ghost);
  }

  // the coordinates over the men (v20-0-plan §11 L6: a man on the first rank
  // covered its file letter): ink in the other square's colour, over a halo in
  // its own square's colour, so a letter reads on the square and on a man alike
  if (v.coords) {
    ctx.font = "600 " + Math.round(step * 0.16) + "px " + P.font;
    ctx.lineWidth = Math.max(2, step * 0.05);
    ctx.lineJoin = "round";
    const label = (text, x, y, onLight) => {
      ctx.strokeStyle = onLight ? P.light : P.dark;
      ctx.strokeText(text, x, y);
      ctx.fillStyle = onLight ? P.dark : P.light;
      ctx.fillText(text, x, y);
    };
    for (let i = 0; i < 8; i++) {
      const file = v.orientation === "black" ? 7 - i : i;
      const rank = v.orientation === "black" ? i : 7 - i;
      ctx.textAlign = "right"; ctx.textBaseline = "bottom";
      label(FILES[file], edge(i + 1) - step * 0.06, size - step * 0.04, (7 + i) % 2 === 0);
      ctx.textAlign = "left"; ctx.textBaseline = "top";
      label(String(rank + 1), step * 0.06, edge(i) + step * 0.04, i % 2 === 0);
    }
  }

  for (const o of over.dot) {
    const [cx, cy] = centre(o.x, o.y);
    ctx.globalAlpha = o.alpha;
    ctx.beginPath(); ctx.arc(cx, cy, step * 0.14, 0, Math.PI * 2);
    ctx.fillStyle = P.dot; ctx.fill();
  }
  for (const o of over.ring) {
    const [cx, cy] = centre(o.x, o.y);
    ctx.globalAlpha = o.alpha;
    ctx.beginPath(); ctx.arc(cx, cy, step * 0.45, 0, Math.PI * 2);
    ctx.strokeStyle = P.ring; ctx.lineWidth = step * 0.075; ctx.stroke();
  }
  for (const o of over.circle) {
    const [cx, cy] = centre(o.x, o.y);
    ctx.globalAlpha = o.alpha;
    ctx.beginPath(); ctx.arc(cx, cy, step * 0.45, 0, Math.PI * 2);
    ctx.strokeStyle = P[o.color] || P.G; ctx.lineWidth = step * 0.075; ctx.stroke();
  }
  for (const o of over.arrow) {
    const [ax, ay] = centre(o.x, o.y), [bx, by] = centre(o.x2, o.y2);
    const ang = Math.atan2(by - ay, bx - ax), head = step * 0.3;
    const col = P[o.color] || P.G;
    ctx.globalAlpha = o.alpha;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    ctx.lineWidth = step * 0.13; ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(ax + Math.cos(ang) * step * 0.24, ay + Math.sin(ang) * step * 0.24);
    ctx.lineTo(bx - Math.cos(ang) * head * 0.8, by - Math.sin(ang) * head * 0.8);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx - Math.cos(ang - 0.45) * head, by - Math.sin(ang - 0.45) * head);
    ctx.lineTo(bx - Math.cos(ang + 0.45) * head, by - Math.sin(ang + 0.45) * head);
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;

  if (v.cursor) {
    const [x, y, w, h] = cell(...v.cursor);
    const lw = Math.max(2, step * 0.045);
    ctx.strokeStyle = P.cursorEdge; ctx.lineWidth = lw * 1.8;
    ctx.strokeRect(x + lw, y + lw, w - lw * 2, h - lw * 2);
    ctx.strokeStyle = P.cursor; ctx.lineWidth = lw;
    ctx.strokeRect(x + lw, y + lw, w - lw * 2, h - lw * 2);
  }

  if (v.drag) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.38)";
    ctx.shadowBlur = step * 0.14;
    ctx.shadowOffsetY = step * 0.06;
    drawMan(v.drag.code, v.drag.x, v.drag.y, 1, LIFT_SCALE, false);
    ctx.restore();
  }
}
