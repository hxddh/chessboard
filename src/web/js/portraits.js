/**
 * 对手的面孔 (v11-0-plan V1).
 *
 * Twenty-one opponents were twenty-one line icons — an hourglass, a flame, a
 * medal — the same weight and colour as every toolbar button, so the person
 * across the board read as a setting. Each now has a face: a small flat,
 * geometric portrait in one style (round head, simple hair, two dots for eyes,
 * a line for a mouth, the shoulders of a jumper), drawn here from a line of
 * parameters rather than shipped as 21 files, so they stay one family and
 * cost a couple of kilobytes. Stockfish, the last rung, is the one that is
 * not a person: a small robot.
 *
 * The SVG is a string with fixed colours (a face is not themed: the
 * background disc is the only colour that is a choice, and it is a soft one
 * that sits on both the light and the dark shells). It has no ids, so any
 * number of copies can share a page; the round crop is the container's
 * (CSS .portrait: border-radius and overflow).
 * @module portraits
 */

const SKIN = ["#f6dcc8", "#eec4a2", "#d9a37a", "#b37650", "#7d4f33"];
const HAIR = ["#2a201a", "#57361f", "#9a5b2c", "#d6ad66", "#8f8b86", "#d8d3cc", "#7b2f2a"];
const BG = ["#e9d6c5", "#cfe1d7", "#d5dcee", "#efd8dc", "#e4e1cd", "#d4e8ef", "#e6d5ea", "#dfe6cf"];
const TOP = ["#3f5f8a", "#8c3f3f", "#3f7a5a", "#6b4f8a", "#a8742f", "#2f2f35", "#5d6f7a", "#b25b4a"];

/**
 * Each opponent: skin, hair colour, hair style, background, jumper, extras.
 * Styles: short · side · bun · long · curly · bald · cap. Extras: g glasses,
 * b beard, m moustache, e earrings, k kid (smaller, rounder face).
 */
export const FACES = {
  pip: [0, 3, "curly", 3, 4, "k"],
  tomo: [1, 0, "side", 4, 2, ""],
  lina: [0, 2, "long", 2, 1, "e"],
  kai: [2, 0, "short", 0, 7, ""],
  ada: [3, 0, "bun", 5, 3, "g"],
  remy: [1, 1, "side", 1, 0, "m"],
  ben: [0, 2, "cap", 6, 0, "k"],
  nico: [2, 1, "curly", 7, 4, ""],
  vera: [1, 6, "long", 0, 5, "e"],
  sol: [4, 0, "curly", 3, 2, "e"],
  leo: [0, 3, "side", 2, 7, "b"],
  ivy: [2, 0, "bun", 1, 1, ""],
  max: [1, 0, "short", 6, 5, "g"],
  iris: [0, 5, "long", 5, 6, "g"],
  otto: [1, 5, "bald", 4, 0, "gb"],
  hugo: [3, 4, "short", 7, 5, "b"],
  zoe: [4, 0, "bun", 6, 7, "e"],
  lars: [0, 3, "short", 5, 2, "b"],
  nora: [2, 4, "long", 4, 3, "g"],
  kit: [1, 2, "cap", 0, 6, ""],
};

const r1 = (n) => Math.round(n * 10) / 10;

function hairBack(style, c) {
  if (style === "long") return `<path d="M18.5 30C18.5 13 45.5 13 45.5 30L47 47H17Z" fill="${c}"/>`;
  if (style === "bun") return `<circle cx="32" cy="12.5" r="5.5" fill="${c}"/>`;
  return "";
}

function hairFront(style, c, kid) {
  const top = kid ? 12.5 : 10.5;
  switch (style) {
    case "short":
      return `<path d="M20.3 28C19.6 ${top} 44.4 ${top} 43.7 28C41.5 22.5 37 21 32 21S22.5 22.5 20.3 28Z" fill="${c}"/>`;
    case "side":
      return `<path d="M20.3 29C19.3 ${top} 44.7 ${top - 1} 43.7 27C40 21.5 30 22.5 26 21C24.5 23.5 22.3 26 20.3 29Z" fill="${c}"/>`;
    case "bun":
    case "long":
      return `<path d="M20.3 28.5C19.6 ${top + 1} 44.4 ${top + 1} 43.7 28.5C40 23.5 36 22 32 22S24 23.5 20.3 28.5Z" fill="${c}"/>`;
    case "curly": {
      let s = "";
      for (const [x, y, r] of [[22, 24, 4.2], [26, 19.5, 4.6], [32, 17.5, 4.8], [38, 19.5, 4.6], [42, 24, 4.2]]) {
        s += `<circle cx="${x}" cy="${kid ? y + 1 : y}" r="${r}" fill="${c}"/>`;
      }
      return s;
    }
    case "bald":
      return `<path d="M20.6 30C20.4 26 21.5 24.5 22.5 24V31ZM43.4 30C43.6 26 42.5 24.5 41.5 24V31Z" fill="${c}"/>`;
    case "cap":
      return `<path d="M20 25.5C20 ${top + 1} 44 ${top + 1} 44 25.5Z" fill="${c}"/><rect x="18" y="24" width="28" height="3.2" rx="1.6" fill="${c}"/>`;
    default:
      return "";
  }
}

function person(id, f) {
  const [si, hi, style, bi, ti, extras] = f;
  const kid = extras.includes("k");
  const skin = SKIN[si], hair = HAIR[hi], top = TOP[ti];
  const ink = "#2a221d";
  const rx = kid ? 11.5 : 11, ry = kid ? 11.5 : 12.5, cy = kid ? 30 : 29;
  const ey = cy + (kid ? 0.5 : 0.5);
  let s = `<rect width="64" height="64" fill="${BG[bi]}"/>`;
  s += hairBack(style, hair);
  // shoulders, then the neck, then the head
  s += `<path d="M10 64C10 50.5 19 45 32 45S54 50.5 54 64Z" fill="${top}"/>`;
  s += `<path d="M27.5 39H36.5V46.5C34 48.5 30 48.5 27.5 46.5Z" fill="${skin}"/>`;
  s += `<path d="M27.5 46C29.5 47.6 34.5 47.6 36.5 46L38.5 47.5C35 50.5 29 50.5 25.5 47.5Z" fill="#000" opacity=".12"/>`;
  s += `<circle cx="${32 - rx}" cy="${r1(cy + 1)}" r="2.4" fill="${skin}"/><circle cx="${32 + rx}" cy="${r1(cy + 1)}" r="2.4" fill="${skin}"/>`;
  s += `<ellipse cx="32" cy="${cy}" rx="${rx}" ry="${ry}" fill="${skin}"/>`;
  if (extras.includes("e")) {
    s += `<circle cx="${32 - rx}" cy="${r1(cy + 4)}" r="1.1" fill="#d9b25a"/><circle cx="${32 + rx}" cy="${r1(cy + 4)}" r="1.1" fill="#d9b25a"/>`;
  }
  if (extras.includes("b")) {
    s += `<path d="M${32 - rx + 1} ${cy + 1}C${32 - rx + 1} ${cy + ry + 3} ${32 + rx - 1} ${cy + ry + 3} ${32 + rx - 1} ${cy + 1}C${32 + rx - 3} ${cy + 10.5} ${32 - rx + 3} ${cy + 10.5} ${32 - rx + 1} ${cy + 1}Z" fill="${hair}"/>`;
  }
  s += hairFront(style, hair, kid);
  // the face: two eyes, a quiet smile
  s += `<circle cx="27.6" cy="${ey}" r="1.35" fill="${ink}"/><circle cx="36.4" cy="${ey}" r="1.35" fill="${ink}"/>`;
  if (extras.includes("m")) {
    s += `<path d="M28.5 ${cy + 5.2}Q32 ${cy + 3.6} 35.5 ${cy + 5.2}Q32 ${cy + 6.2} 28.5 ${cy + 5.2}Z" fill="${hair}"/>`;
  }
  s += `<path d="M29.4 ${r1(cy + 5.6)}Q32 ${r1(cy + 7.6)} 34.6 ${r1(cy + 5.6)}" fill="none" stroke="${ink}" stroke-width="1.1" stroke-linecap="round"/>`;
  if (extras.includes("g")) {
    s += `<g fill="none" stroke="${ink}" stroke-width="1"><circle cx="27.6" cy="${ey}" r="3.3"/><circle cx="36.4" cy="${ey}" r="3.3"/><path d="M30.9 ${ey}H33.1"/></g>`;
  }
  return s;
}

function robot() {
  let s = `<rect width="64" height="64" fill="#d3dce6"/>`;
  s += `<path d="M10 64C10 51 19 46 32 46S54 51 54 64Z" fill="#4a5866"/>`;
  s += `<rect x="29" y="40" width="6" height="7" fill="#7c8a98"/>`;
  s += `<path d="M32 13V18" stroke="#4a5866" stroke-width="1.6" stroke-linecap="round"/><circle cx="32" cy="12" r="2.2" fill="#d65c4c"/>`;
  s += `<rect x="18.5" y="18" width="27" height="23" rx="7" fill="#9aa8b6"/>`;
  s += `<rect x="22" y="23" width="20" height="10" rx="5" fill="#2b333b"/>`;
  s += `<circle cx="27.5" cy="28" r="2" fill="#7fe0c4"/><circle cx="36.5" cy="28" r="2" fill="#7fe0c4"/>`;
  s += `<rect x="27" y="36" width="10" height="1.6" rx=".8" fill="#4a5866"/>`;
  return s;
}

/** The SVG markup of `id`'s portrait (any id that is not a face is the robot). */
export function portraitSvg(id) {
  const f = FACES[id];
  const body = f ? person(id, f) : robot();
  return `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">${body}</svg>`;
}

/**
 * Put `id`'s portrait into `slot` (an element with the .portrait class),
 * unless it is already the one there — the strips repaint on every commit.
 */
export function setPortrait(slot, id) {
  if (!slot) return;
  const key = "pt:" + id;
  if (slot.dataset.icon === key) return;
  slot.dataset.icon = key;
  slot.classList.add("portrait");
  // our own fixed markup, not data (like the vendored piece SVGs)
  slot.replaceChildren();
  slot.insertAdjacentHTML("afterbegin", portraitSvg(id));
}

export const ChessPortraits = { FACES, portraitSvg, setPortrait };
