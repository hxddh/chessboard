/**
 * Contrast (ADR 0005): in each of the four shells (styles/tokens.css
 * [data-theme]), the text colours on the surfaces they are drawn on reach
 * WCAG AA — 4.5:1 for body text (ink, ink-muted) and for the text on an
 * accent or danger fill, 3:1 for the brand mark (large type). The faint ink
 * is not used for text in the app's own rules (app.css) and is not held here.
 */
import fs from "fs";

const CSS = fs.readFileSync(new URL("../../src/app/styles/tokens.css", import.meta.url), "utf8");
const THEMES = ["wood", "night", "day", "notebook"];
const SURFACES = ["surface", "surface-raised", "card-fill"];
const PAIRS = [
  ...["ink", "ink-muted"].flatMap((t) => SURFACES.map((s) => [t, s, 4.5])),
  ["on-accent", "accent", 4.5],
  ["on-danger", "danger", 4.5],
  ["brand", "surface", 3],
];

/** The theme's block: the semantic names resolved through its own --<theme>-x values. */
function theme(name) {
  const sel = name === "wood" ? ':root, [data-theme="wood"] {' : '[data-theme="' + name + '"] {';
  const at = CSS.indexOf(sel);
  if (at < 0) return null;
  const body = CSS.slice(at + sel.length, CSS.indexOf("\n}", at));
  const vars = Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
  const resolve = (v, depth = 0) => {
    const m = /^var\(--([\w-]+)\)$/.exec(v);
    return m && depth < 5 && vars[m[1]] ? resolve(vars[m[1]], depth + 1) : v;
  };
  return (k) => (vars[k] ? resolve(vars[k]) : null);
}
const rgb = (hex) => { const v = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
const lin = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
const lum = ([r, g, b]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
export const ratio = (a, b) => { const [x, y] = [lum(rgb(a)), lum(rgb(b))].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

export default function (test) {
  for (const name of THEMES) {
    test("contrast: the " + name + " shell's text reaches AA on its surfaces", (a) => {
      const get = theme(name);
      a.ok(get, "the " + name + " block is in tokens.css");
      if (!get) return;
      for (const [fg, bg, min] of PAIRS) {
        const f = get(fg), b = get(bg);
        a.ok(/^#[0-9a-f]{6}$/i.test(f || "") && /^#[0-9a-f]{6}$/i.test(b || ""), name + ": --" + fg + " and --" + bg + " are plain colours (" + f + ", " + b + ")");
        if (!f || !b || f[0] !== "#" || b[0] !== "#") continue;
        const r = ratio(f, b);
        a.ok(r >= min, name + ": --" + fg + " on --" + bg + " is " + r.toFixed(2) + ":1 (at least " + min + ":1)");
      }
    });
  }
}
