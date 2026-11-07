/**
 * Piece sprites: each set's twelve SVGs decoded once and rastered per size,
 * shared by every board on the page.
 * @module board/pieces
 */
import { PIECE_SETS } from "../core/pieces.js";

const images = new Map();   // set → Promise<Record<code, HTMLImageElement>>
const ready = new Map();    // set → Record<code, HTMLImageElement>
const sprites = new Map();  // "set|code|px" → canvas
const MAX_SPRITES = 12 * 3 * 4;

/**
 * Burnett's 1.5-unit outline was cut for 45 px squares; on a large square it
 * reads heavy and on a small one it vanishes, so the pen follows the size.
 */
function refine(set, svg, px) {
  if (set !== "cburnett") return svg;
  const w = px > 0 ? Math.min(2.6, Math.max(1.2, 45 / px)) : 1.2;
  return svg.replace(/stroke-width="1\.5"/g, 'stroke-width="' + w.toFixed(2).replace(/\.?0+$/, "") + '"');
}

/** Decode all twelve of `set`; resolves when they can be drawn. */
export function loadSet(set) {
  let p = images.get(set);
  if (p) return p;
  p = (PIECE_SETS[set] || PIECE_SETS.merida)().then((svgs) => Promise.all(Object.keys(svgs).map((code) => {
    const img = new Image();
    img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(refine(set, svgs[code], 0));
    return img.decode().catch(() => {}).then(() => [code, img]);
  }))).then((pairs) => {
    const out = Object.fromEntries(pairs);
    ready.set(set, out);
    return out;
  });
  images.set(set, p);
  return p;
}

/** A canvas of `code` at `px` device pixels, or null while the set is decoding. */
export function sprite(set, code, px) {
  const imgs = ready.get(set);
  const img = imgs && imgs[code];
  if (!img || !img.naturalWidth) return null;
  const k = set + "|" + code + "|" + px;
  let c = sprites.get(k);
  if (!c) {
    if (sprites.size >= MAX_SPRITES) sprites.delete(sprites.keys().next().value);
    c = document.createElement("canvas");
    c.width = c.height = px;
    const g = c.getContext("2d");
    if (set === "cburnett") {
      g.shadowColor = "rgba(0, 0, 0, 0.22)";
      g.shadowBlur = px * 0.03;
      g.shadowOffsetY = px * 0.015;
    }
    g.drawImage(img, 0, 0, px, px);
    sprites.set(k, c);
  }
  return c;
}
