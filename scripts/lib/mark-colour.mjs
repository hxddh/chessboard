/**
 * The board marks, measured as colour (v7-7-plan §6).
 *
 * A mark is a translucent colour laid over a square. Over the light square and
 * over the dark one it composites to two different colours, and the question
 * the plan asks is whether they still read as the SAME mark — whether the
 * last-move tint that is lime on a light square turns to olive on a dark one
 * (7.6.0, wood: rgba(64,153,23,.28) over #b58863).
 *
 * The metric is CIEDE2000 (ΔE00), on sRGB → CIELAB with a D65 white. Two
 * figures per mark and board:
 *
 *   dE    the whole ΔE00 between the mark over light and the mark over dark.
 *         Most of it is lightness, and lightness is supposed to differ — the
 *         two squares differ — so this is recorded, not minimised.
 *   dH    the hue term of the same ΔE00, ΔH'/(kH·SH): how much of that
 *         difference is the colour turning into another colour. This is the
 *         one the retune minimises and the test puts a ceiling on.
 *
 * And one figure per board, because a mark that looks the same on both
 * squares is no use if it also looks like its neighbour:
 *
 *   sep   the smallest ΔE00 between two different marks over the same square.
 *
 * Pure functions over the stylesheet text, so the recording script and
 * scripts/test-chess.mjs compute the same thing from the same file.
 * @module mark-colour
 */

/** The marks the plan names: last move, selection, check, hint. */
export const MARKS = ["last", "sel", "check", "hint"];
export const BOARDS = ["wood", "night", "day", "notebook"];

/** One board palette's declarations, from the stylesheet text. */
export function boardBlock(css, board) {
  const sel = board === "wood" ? /:root, \[data-board="wood"\]\s*\{([\s\S]*?)\n    \}/
    : new RegExp('\\[data-board="' + board + '"\\]\\s*\\{([\\s\\S]*?)\\n    \\}');
  const m = sel.exec(css);
  if (!m) throw new Error("no board palette for " + board);
  return m[1];
}

/** The three mark strengths, from the one :root block that declares them. */
export function markSteps(css) {
  const out = {};
  for (const k of ["strong", "mid", "soft"]) {
    const m = new RegExp("--mark-" + k + ":\\s*([\\d.]+)").exec(css);
    out[k] = m ? Number(m[1]) : NaN;
  }
  return out;
}

/** {r,g,b,a} of a declared colour: #rrggbb, or rgba(r, g, b, n | var(--mark-x)). */
export function parseColour(v, steps) {
  v = v.trim();
  const h = /^#([0-9a-f]{6})$/i.exec(v);
  if (h) {
    const n = parseInt(h[1], 16);
    return { r: n >> 16 & 255, g: n >> 8 & 255, b: n & 255, a: 1 };
  }
  const m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*(var\([^)]*\)|[\d.]+))?\s*\)$/.exec(v);
  if (!m) throw new Error("unparsed colour " + v);
  let a = 1;
  if (m[4] != null) {
    const s = /var\(--mark-(strong|mid|soft)\)/.exec(m[4]);
    a = s ? steps[s[1]] : Number(m[4]);
  }
  return { r: +m[1], g: +m[2], b: +m[3], a };
}

/** A token's value inside a block. */
export function tokenIn(block, name) {
  const m = new RegExp("\\n\\s*" + name + ":\\s*([^;]+);").exec(block);
  if (!m) throw new Error("no " + name);
  return m[1];
}

/** Source-over, straight alpha, onto an opaque base. */
export function over(top, base) {
  const a = top.a;
  return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 };
}

function lin(c) { c /= 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
/** sRGB (0–255) → CIELAB, D65. */
export function lab(c) {
  const R = lin(c.r), G = lin(c.g), B = lin(c.b);
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.0;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;
  const f = (t) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return { L: 116 * fy - 16, a: 500 * (fx - fy), b: 200 * (fy - fz) };
}

/**
 * CIEDE2000 (Sharma, Wu & Dalal 2005), kL = kC = kH = 1. Returns the total
 * and its three weighted terms, so a caller can ask how much of a difference
 * is hue.
 */
export function de2000(p, q) {
  const { L: L1, a: a1, b: b1 } = p, { L: L2, a: a2, b: b2 } = q;
  const rad = Math.PI / 180;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2);
  const Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Math.pow(Cb, 7) / (Math.pow(Cb, 7) + Math.pow(25, 7))));
  const a1p = (1 + G) * a1, a2p = (1 + G) * a2;
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const hp = (a, b) => (a === 0 && b === 0 ? 0 : (Math.atan2(b, a) / rad + 360) % 360);
  const h1p = hp(a1p, b1), h2p = hp(a2p, b2);
  const dLp = L2 - L1, dCp = C2p - C1p;
  let dhp = 0;
  if (C1p * C2p !== 0) {
    dhp = h2p - h1p;
    if (dhp > 180) dhp -= 360; else if (dhp < -180) dhp += 360;
  }
  const dHp = 2 * Math.sqrt(C1p * C2p) * Math.sin((dhp / 2) * rad);
  const Lbp = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hbp = h1p + h2p;
  if (C1p * C2p !== 0) {
    if (Math.abs(h1p - h2p) > 180) hbp = (h1p + h2p < 360) ? (h1p + h2p + 360) / 2 : (h1p + h2p - 360) / 2;
    else hbp = (h1p + h2p) / 2;
  }
  const T = 1 - 0.17 * Math.cos((hbp - 30) * rad) + 0.24 * Math.cos(2 * hbp * rad) +
    0.32 * Math.cos((3 * hbp + 6) * rad) - 0.20 * Math.cos((4 * hbp - 63) * rad);
  const dTheta = 30 * Math.exp(-Math.pow((hbp - 275) / 25, 2));
  const Rc = 2 * Math.sqrt(Math.pow(Cbp, 7) / (Math.pow(Cbp, 7) + Math.pow(25, 7)));
  const Sl = 1 + (0.015 * Math.pow(Lbp - 50, 2)) / Math.sqrt(20 + Math.pow(Lbp - 50, 2));
  const Sc = 1 + 0.045 * Cbp, Sh = 1 + 0.015 * Cbp * T;
  const Rt = -Math.sin(2 * dTheta * rad) * Rc;
  const tL = dLp / Sl, tC = dCp / Sc, tH = dHp / Sh;
  return { dE: Math.sqrt(tL * tL + tC * tC + tH * tH + Rt * tC * tH), tL, tC, tH };
}

const r1 = (x) => Math.round(x * 10) / 10;

/**
 * Every mark on every board, measured from the stylesheet text.
 * @returns {{[board: string]: {marks: object, sep: number, sepPair: string}}}
 */
export function measureMarks(css) {
  const steps = markSteps(css);
  const out = {};
  for (const board of BOARDS) {
    const blk = boardBlock(css, board);
    const L = parseColour(tokenIn(blk, "--sq-light"), steps);
    const D = parseColour(tokenIn(blk, "--sq-dark"), steps);
    const marks = {};
    const on = {};
    for (const k of MARKS) {
      const m = parseColour(tokenIn(blk, "--sq-" + k), steps);
      const cl = lab(over(m, L)), cd = lab(over(m, D));
      on[k] = { cl, cd };
      const d = de2000(cl, cd);
      marks[k] = { dE: r1(d.dE), dH: r1(Math.abs(d.tH)) };
    }
    let sep = Infinity, sepPair = "";
    for (let i = 0; i < MARKS.length; i++) {
      for (let j = i + 1; j < MARKS.length; j++) {
        for (const sq of ["cl", "cd"]) {
          const d = de2000(on[MARKS[i]][sq], on[MARKS[j]][sq]).dE;
          if (d < sep) { sep = d; sepPair = MARKS[i] + "/" + MARKS[j] + (sq === "cl" ? " on light" : " on dark"); }
        }
      }
    }
    out[board] = { marks, sep: r1(sep), sepPair };
  }
  return out;
}

/**
 * 7.8 §6: how colourful each mark is where it is brightest — composited over
 * the LIGHT square — as CIELAB chroma C* = √(a*² + b*²).
 *
 * The hue term above keeps a mark one colour on both squares; it says nothing
 * about how loud that colour is. On 7.7 the wood last-move tint was the right
 * hue on both squares and a bright lime on the light one (C* 54). Lichess's
 * default brown board, measured the same way (rgba(155,199,0,.41) over
 * #f0d9b5), comes to C* 52.4 at a yellower hue; LAST_CHROMA_CEILING sits a
 * tenth under that reference rather than copying it.
 */
export const LICHESS_LAST = { mark: { r: 155, g: 199, b: 0, a: 0.41 }, light: { r: 240, g: 217, b: 181, a: 1 } };
export const LAST_CHROMA_CEILING = 47;

/** C* of a composite, one decimal. */
export function chroma(c) {
  const l = lab(c);
  return r1(Math.hypot(l.a, l.b));
}

/** {[board]: {[mark]: C* over the light square}} from the stylesheet text. */
export function markChroma(css) {
  const steps = markSteps(css);
  const out = {};
  for (const board of BOARDS) {
    const blk = boardBlock(css, board);
    const L = parseColour(tokenIn(blk, "--sq-light"), steps);
    out[board] = {};
    for (const k of MARKS) out[board][k] = chroma(over(parseColour(tokenIn(blk, "--sq-" + k), steps), L));
  }
  return out;
}
