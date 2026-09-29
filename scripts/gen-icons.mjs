/**
 * The app icon, from its SVG sources to the three files app.zon hands the
 * packager (v8-0-plan A6):
 *
 *   assets/icon/icon.svg      the macOS master: 1024 canvas, 824 tile
 *   assets/icon/icon-win.svg  Windows, 24 px and up: the tile full-bleed
 *   assets/icon/icon-16.svg   Windows 16 px, drawn on the pixel grid
 *   assets/icon/icon-32.svg   Windows 32 px, the same
 *        ↓
 *   assets/icon.png   the 1024 master (pre-shaped: the SDK ships it as is)
 *   assets/icon.icns  macOS, every slot from 16 to 1024
 *   assets/icon.ico   Windows 16 / 24 / 32 / 48 / 64 / 128 / 256
 *
 * Why not one PNG, as 7.x had: the SDK's pipeline scales one source to every
 * size, so the 16 px icon in Explorer was the 1024 drawing box-filtered to
 * sixteen pixels — the ears one grey smudge. A prebuilt .icns / .ico wins
 * over the generated one for its platform (package.zig resolveIconPlan), so
 * the small sizes can be drawn for their size.
 *
 * The SVGs are rasterised by Chromium (the browser the E2E suites use, via
 * scripts/e2e-browser.mjs) at each size directly — never scaled from a
 * bigger raster — and everything after the pixels is in scripts/lib/
 * icon-files.mjs, byte-stable. scripts/test-brand.mjs checks the results.
 *
 *   node scripts/gen-icons.mjs                write the three files
 *   node scripts/gen-icons.mjs --preview DIR  …and the renders plus a 16 px
 *                                             legibility sheet into DIR
 * @module gen-icons
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser } from "./e2e-browser.mjs";
import { encodePng, encodeArgb, writeIcns, writeIco, ICNS_SLOTS, ICO_SIZES } from "./lib/icon-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(root, "assets/icon");
const at = process.argv.indexOf("--preview");
const PREVIEW = at > 0 ? path.resolve(process.argv[at + 1]) : null;

const browser = await launchBrowser();
const page = await browser.newPage();
await page.setContent("<!doctype html><body></body>");

/** One SVG source at `size` px, as straight-alpha RGBA. */
async function render(file, size) {
  // the root's own width/height set to the target, so the image is drawn
  // 1:1 at the size it was rasterised at, not resampled
  const svg = fs.readFileSync(path.join(SRC, file), "utf8")
    .replace(/<svg([^>]*?) width="[^"]*" height="[^"]*"/, `<svg$1 width="${size}" height="${size}"`);
  const px = await page.evaluate(async ({ svg, size }) => {
    const img = new Image();
    img.src = "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));
    await img.decode();
    const c = document.createElement("canvas");
    c.width = c.height = size;
    const g = c.getContext("2d");
    g.drawImage(img, 0, 0, size, size);
    return Array.from(g.getImageData(0, 0, size, size).data);
  }, { svg, size });
  return Buffer.from(px);
}

const mac = new Map();
for (const s of [...new Set(ICNS_SLOTS.map((x) => x.size))]) mac.set(s, await render("icon.svg", s));
const icns = writeIcns(ICNS_SLOTS.map(({ kind, size, argb }) => ({
  kind, data: argb ? encodeArgb(mac.get(size), size, size) : encodePng(mac.get(size), size, size),
})));
const win = new Map();
for (const s of ICO_SIZES) {
  const file = s === 16 ? "icon-16.svg" : s === 32 ? "icon-32.svg" : "icon-win.svg";
  win.set(s, await render(file, s));
}
const ico = writeIco(ICO_SIZES.map((s) => ({ size: s, png: encodePng(win.get(s), s, s) })));

fs.writeFileSync(path.join(root, "assets/icon.png"), encodePng(mac.get(1024), 1024, 1024));
fs.writeFileSync(path.join(root, "assets/icon.icns"), icns);
fs.writeFileSync(path.join(root, "assets/icon.ico"), ico);
console.log("assets/icon.png 1024 · icon.icns " + icns.length + " bytes · icon.ico " + ico.length + " bytes");

if (PREVIEW) {
  fs.mkdirSync(PREVIEW, { recursive: true });
  for (const [s, px] of win) fs.writeFileSync(path.join(PREVIEW, "win-" + s + ".png"), encodePng(px, s, s));
  for (const s of [16, 32, 64]) fs.writeFileSync(path.join(PREVIEW, "mac-" + s + ".png"), encodePng(mac.get(s), s, s));
  // the legibility sheet: each small size at 1× and blown up 8× / 4×
  // (nearest neighbour), on a light and a dark taskbar
  const sheet = await page.evaluate(async (items) => {
    const load = async (b64) => { const i = new Image(); i.src = "data:image/png;base64," + b64; await i.decode(); return i; };
    const imgs = [];
    for (const it of items) imgs.push(Object.assign(await load(it.b64), { s: it.s }));
    const W = 24 + imgs.reduce((a, i) => a + i.s * (i.s <= 16 ? 8 : 4) + i.s + 48, 0);
    const c = document.createElement("canvas");
    c.width = W; c.height = 2 * (32 * 4 + 32);
    const g = c.getContext("2d");
    g.imageSmoothingEnabled = false;
    ["#f3f3f3", "#202020"].forEach((bg, row) => {
      const y0 = row * (32 * 4 + 32);
      g.fillStyle = bg; g.fillRect(0, y0, W, 32 * 4 + 32);
      let x = 16;
      for (const i of imgs) {
        const k = i.s <= 16 ? 8 : 4;
        g.drawImage(i, x, y0 + 16);
        g.drawImage(i, x + i.s + 12, y0 + 16, i.s * k, i.s * k);
        x += i.s + 12 + i.s * k + 36;
      }
    });
    return c.toDataURL("image/png").split(",")[1];
  }, [16, 32].flatMap((s) => [{ s, b64: encodePng(win.get(s), s, s).toString("base64") },
    { s, b64: encodePng(mac.get(s), s, s).toString("base64") }]));
  fs.writeFileSync(path.join(PREVIEW, "legibility-16-32.png"), Buffer.from(sheet, "base64"));
  console.log("preview → " + PREVIEW);
}
await browser.close();
