/**
 * Board materials: the paper and marble textures, and ink-coloured pieces
 * (v8-0-plan A3).
 *
 * A board palette in styles.css names its texture (--board-texture: none |
 * paper | marble) and, for the paper board, the ink and paper its men are
 * printed in (--piece-ink: "<ink> <paper>"). This module turns those names
 * into pixels, so board.js keeps drawing squares the way it always has —
 * flat colour through cellRect() — and lays a texture over them.
 *
 * The textures are made here, not shipped: a tile of seeded, periodic value
 * noise, a few kilobytes of code instead of a few hundred of image, the same
 * pixels on every run (the screenshots and tests compare like with like),
 * and it tiles without a seam because the noise lattice wraps at the tile's
 * edge. One tile per texture and square colour, built once per theme change
 * and cached; board.js fills each square with it as a pattern.
 * @module board-skin
 */

const TILE = 256;

/** Mulberry32: a small seeded PRNG, so a texture is the same every run. */
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Periodic value noise: a `cx`×`cy` lattice of random values that wraps,
 * smoothly interpolated. Sampled over one tile it tiles seamlessly; a lattice
 * with fewer cells across than down stretches its features across (fibres).
 */
function lattice(cx, cy, seed) {
  const rnd = prng(seed);
  const v = new Float32Array(cx * cy);
  for (let i = 0; i < v.length; i++) v[i] = rnd();
  return (x, y) => {
    // x, y in 0..1 over the tile
    const fx = x * cx, fy = y * cy;
    const x0 = Math.floor(fx), y0 = Math.floor(fy);
    const tx = fx - x0, ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const at = (i, j) => v[((j % cy + cy) % cy) * cx + ((i % cx + cx) % cx)];
    const a = at(x0, y0), b = at(x0 + 1, y0), c = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
    return (a + (b - a) * sx) + ((c + (d - c) * sx) - (a + (b - a) * sx)) * sy;
  };
}

/** Fractal sum of octaves, 0..1; `stretch` cells down for each one across. */
function fbm(octaves, base, seed, stretch) {
  const k = stretch || 1;
  const layers = [];
  for (let o = 0; o < octaves; o++) layers.push(lattice(base << o, (base << o) * k, seed + o * 101));
  return (x, y) => {
    let s = 0, amp = 1, norm = 0;
    for (const n of layers) { s += n(x, y) * amp; norm += amp; amp *= 0.5; }
    return s / norm;
  };
}

/**
 * The texture recipes. Each returns, for a point of the tile, a colour to
 * lay over the square and how much of it: [r, g, b, alpha 0..1]. They are
 * deliberately faint — the texture is the material, not a pattern to look
 * at, and the marks and the pieces must read on it exactly as on flat
 * colour (the ceilings in scripts/lib/mark-colour.mjs are measured on the
 * flat colours, which are the texture's mean).
 */
const RECIPES = {
  /**
   * Paper: long soft fibres (stretched noise), a fine tooth, and on the dark
   * squares the uneven pooling of an ink wash.
   */
  paper(dark) {
    const tooth = fbm(2, 64, 7);
    const fibre = fbm(2, 6, 19, 6);
    const wash = fbm(3, 3, dark ? 31 : 43);
    return (x, y) => {
      const t = tooth(x, y) - 0.5;
      const f = fibre(x, y) - 0.5; // fibres run one way
      const s = t * 0.9 + f * 0.6;
      if (dark) {
        // the wash pools unevenly, and the paper's tooth shows through it
        const w = (wash(x, y) - 0.5) * 0.6 + s * 0.5;
        return w > 0 ? [30, 34, 48, Math.min(0.10, w * 0.3)] : [255, 252, 240, Math.min(0.10, -w * 0.3)];
      }
      return s > 0 ? [120, 100, 70, Math.min(0.06, s * 0.16)] : [255, 255, 250, Math.min(0.08, -s * 0.2)];
    };
  },
  /** Marble: turbulent veins across a softly clouded ground. */
  marble(dark) {
    const turb = fbm(5, 4, dark ? 53 : 67);
    const cloud = fbm(3, 3, dark ? 71 : 89);
    return (x, y) => {
      // a vein is where a sine across the tile, bent by turbulence, crosses zero
      // whole turns across the tile in x and in y, so the tile still wraps
      const phase = (x * 2 + y) * Math.PI * 2 + turb(x, y) * 9;
      const vein = Math.pow(1 - Math.abs(Math.sin(phase)), 14);
      const c = cloud(x, y) - 0.5;
      if (vein > 0.08) return dark ? [238, 238, 240, Math.min(0.32, vein * 0.34)] : [110, 112, 120, Math.min(0.30, vein * 0.32)];
      return c > 0 ? [255, 255, 255, Math.min(0.10, c * 0.25)] : [40, 40, 48, Math.min(0.08, -c * 0.2)];
    };
  },
};

export const TEXTURES = Object.keys(RECIPES);

const _tiles = new Map();

/**
 * The overlay tile for a texture on a light or a dark square, as a canvas, or
 * null for "none", an unknown name, or no DOM (the static tests).
 * @param {string} name   a --board-texture value
 * @param {boolean} dark  the dark squares' variant
 */
export function textureTile(name, dark) {
  if (!Object.prototype.hasOwnProperty.call(RECIPES, name)) return null;
  const key = name + (dark ? ":d" : ":l");
  if (_tiles.has(key)) return _tiles.get(key);
  let tile = null;
  try {
    tile = document.createElement("canvas");
    tile.width = TILE; tile.height = TILE;
    const pen = tile.getContext("2d");
    const img = pen.createImageData(TILE, TILE);
    const px = RECIPES[name](dark);
    for (let y = 0; y < TILE; y++) {
      for (let x = 0; x < TILE; x++) {
        const [r, g, b, a] = px(x / TILE, y / TILE);
        const i = (y * TILE + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b;
        img.data[i + 3] = Math.max(0, Math.min(255, Math.round(a * 255)));
      }
    }
    pen.putImageData(img, 0, 0);
  } catch (_) { tile = null; }
  _tiles.set(key, tile);
  return tile;
}

/**
 * Parse --piece-ink ("#ink #paper"), or null when the board prints its men
 * as drawn.
 * @returns {{ink: string, paper: string}|null}
 */
export function parseInk(v) {
  const m = /^\s*(#[0-9a-f]{6})\s+(#[0-9a-f]{6})\s*$/i.exec(v || "");
  return m ? { ink: m[1], paper: m[2] } : null;
}

/**
 * Reprint a piece sprite in ink on paper, in place: its black becomes the
 * ink, its white the paper, every grey in between the matching mix, and the
 * shape (alpha) is kept. `screen` with the ink lifts black to ink and leaves
 * white alone; `multiply` with the paper takes white down to paper and
 * leaves ink nearly as it is; `destination-in` with the original puts the
 * transparency back.
 * @param {HTMLCanvasElement} c  a sprite already drawn at its size
 * @param {HTMLImageElement} img the piece it was drawn from
 * @param {{ink: string, paper: string}} ink
 */
export function inkSprite(c, img, ink) {
  const pen = c.getContext("2d");
  const w = c.width, h = c.height;
  pen.save();
  pen.globalCompositeOperation = "screen";
  pen.fillStyle = ink.ink;
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = "multiply";
  pen.fillStyle = ink.paper;
  pen.fillRect(0, 0, w, h);
  pen.globalCompositeOperation = "destination-in";
  pen.drawImage(img, 0, 0, w, h);
  pen.restore();
}

export const ChessBoardSkin = { TEXTURES, textureTile, parseInk, inkSprite };
