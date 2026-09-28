/**
 * 品牌、图标（v8-0-plan A6）：提交进仓库的图标文件本身，以及品牌色的用法。
 *
 * 图标由 scripts/gen-icons.mjs 从 assets/icon/*.svg 画出来；这里不重画，只读
 * 提交的文件，看它们是不是计划要的样子：
 *   - macOS：1024 画布上 824 的圆角方块（四周各留 100），四角透明（SDK 原样
 *     打包，不再缩一次、套一次圆角）；.icns 从 16 到 1024 每个槽位都在；
 *   - Windows：.ico 七个尺寸，16 / 32 是按像素画的 —— 边缘不糊，两只耳朵在
 *     最上一行分得开（7.x 那只「独角兽」只有一只耳朵），眼睛是一个亮像素；
 *   - app.zon 把三个文件都交给打包器；
 *   - 品牌色是四套主题各自的 token，用在首页、关于和空状态，且在各自的底色上
 *     够得上大字 3:1。
 * 跑：node scripts/test-brand.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { decodePng, decodeArgb, readIcns, readIco, ICNS_SLOTS, ICO_SIZES } from "./lib/icon-files.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};
const read = (rel) => { try { return fs.readFileSync(path.join(root, rel)); } catch { return null; } };

/** Opaque (alpha ≥ 128) bounding box. */
function bbox({ w, h, rgba }) {
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (rgba[(y * w + x) * 4 + 3] >= 128) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  }
  return { x0, y0, x1, y1 };
}
const lum = (r, g, b) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
/**
 * How a small icon reads: the ink (the knight) against the tile.
 *   soft   share of the tile's pixels that are neither ink nor tile — the
 *          blur a scaled-down drawing leaves along every edge
 *   ears   ink runs on the knight's topmost row: two ears, not one horn
 *   eye    tile-coloured pixels enclosed by ink: the eye survived
 */
function legibility(img) {
  const { w, h, rgba } = img;
  const cls = new Array(w * h).fill(null); // "ink" | "tile" | "soft" | null (outside)
  let opaque = 0, soft = 0;
  for (let i = 0; i < w * h; i++) {
    if (rgba[i * 4 + 3] < 250) continue;
    opaque++;
    const L = lum(rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2]);
    cls[i] = L < 0.2 ? "ink" : L > 0.35 ? "tile" : "soft";
    if (cls[i] === "soft") soft++;
  }
  let top = -1;
  for (let y = 0; y < h && top < 0; y++) for (let x = 0; x < w; x++) if (cls[y * w + x] === "ink") { top = y; break; }
  let ears = 0;
  for (let x = 0; x < w; x++) if (cls[top * w + x] === "ink" && cls[top * w + x - 1] !== "ink") ears++;
  let eye = 0;
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
    const i = y * w + x;
    if (cls[i] === "tile" && cls[i - 1] === "ink" && cls[i + 1] === "ink" && cls[i - w] === "ink" && cls[i + w] === "ink") eye++;
    // a 2×2 eye at 32 px: tile pixels whose run is closed by ink on both axes within two
    else if (cls[i] === "tile" && [[-1, 0], [1, 0], [0, -1], [0, 1]].every(([dx, dy]) =>
      cls[i + dx + dy * w] === "ink" || (cls[i + dx + dy * w] === "tile" && cls[i + 2 * dx + 2 * dy * w] === "ink"))) eye++;
  }
  return { soft: soft / opaque, ears, eye };
}

// --- macOS: the 824 grid, pre-shaped -----------------------------------------
{
  const buf = read("assets/icon.png");
  const img = buf && decodePng(buf);
  assert(img && img.w === 1024 && img.h === 1024, "icon.png 是 1024 × 1024");
  if (img) {
    const corner = [0, 1023, 1023 * 1024, 1024 * 1024 - 1].every((i) => img.rgba[i * 4 + 3] === 0);
    assert(corner, "四角透明：SDK 原样打包（imageIsPreShaped），不再缩一次、套一次圆角");
    const b = bbox(img);
    const on = (v, want) => Math.abs(v - want) <= 1;
    assert(on(b.x0, 100) && on(b.y0, 100) && on(b.x1, 923) && on(b.y1, 923),
      "圆角方块落在 macOS 的 824 网格上：100…924（实测 " + JSON.stringify(b) + "；7.x 是 41…982，约 942）");
  }
  const icns = read("assets/icon.icns");
  let members = [];
  try { members = icns ? readIcns(icns) : []; } catch (e) { members = []; }
  assert(JSON.stringify(members.map((m) => m.kind)) === JSON.stringify(ICNS_SLOTS.map((s) => s.kind)),
    "icon.icns 有全部十个槽位（" + members.map((m) => m.kind).join(" ") + "）");
  for (const slot of ICNS_SLOTS) {
    const m = members.find((x) => x.kind === slot.kind);
    if (!m) continue;
    let ok = false;
    try {
      if (slot.argb) ok = decodeArgb(m.data, slot.size, slot.size).length === slot.size * slot.size * 4;
      else { const p = decodePng(m.data); ok = p.w === slot.size && p.h === slot.size; }
    } catch { ok = false; }
    assert(ok, "icns " + slot.kind + "：" + slot.size + " px" + (slot.argb ? "（ARGB）" : "（PNG）"));
  }
  const ic10 = members.find((x) => x.kind === "ic10");
  assert(buf && ic10 && ic10.data.equals(buf), "icns 的 1024 槽位就是 icon.png 本身");
}

// --- Windows: seven sizes, 16 and 32 drawn on the pixel grid ------------------
{
  const buf = read("assets/icon.ico");
  let entries = [];
  try { entries = buf ? readIco(buf) : []; } catch { entries = []; }
  assert(JSON.stringify(entries.map((e) => e.size)) === JSON.stringify(ICO_SIZES), "icon.ico 有 " + ICO_SIZES.join(" / ") + "（" + entries.map((e) => e.size).join(" ") + "）");
  for (const e of entries) {
    const p = decodePng(e.png);
    assert(p.w === e.size && p.h === e.size, "ico " + e.size + " px 的图就是 " + e.size + " px");
  }
  const at = (s) => { const e = entries.find((x) => x.size === s); return e ? decodePng(e.png) : null; };
  const i16 = at(16), i32 = at(32);
  if (i16) {
    const L = legibility(i16);
    console.log("     16 px:", JSON.stringify(L));
    assert(L.soft <= 0.02, "16 px 边缘不糊：介于棋子与底色之间的像素 " + (L.soft * 100).toFixed(1) + "%（≤ 2%）");
    assert(L.ears === 2, "16 px 顶上一行是两只耳朵，不是一只角（" + L.ears + "）");
    assert(L.eye >= 1, "16 px 有眼睛（" + L.eye + " 个亮像素被棋子围住）");
  } else assert(false, "ico 里有 16 px");
  if (i32) {
    const L = legibility(i32);
    console.log("     32 px:", JSON.stringify(L));
    assert(L.soft <= 0.03, "32 px 边缘基本不糊：" + (L.soft * 100).toFixed(1) + "%（≤ 3%）");
    assert(L.ears === 2, "32 px 两只耳朵（" + L.ears + "）");
    assert(L.eye >= 1, "32 px 有眼睛（" + L.eye + "）");
  } else assert(false, "ico 里有 32 px");
  // what they are drawn from, so the next change is to a source, not a PNG
  for (const f of ["icon.svg", "icon-win.svg", "icon-16.svg", "icon-32.svg"]) {
    assert(!!read("assets/icon/" + f), "源文件 assets/icon/" + f);
  }
  assert(!!read("scripts/gen-icons.mjs"), "生成脚本 scripts/gen-icons.mjs");
}

// --- app.zon hands all three to the packager -----------------------------------
{
  const zon = String(read("app.zon"));
  const m = /\.icons = \.\{([^}]*)\}/.exec(zon);
  const list = m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : [];
  assert(JSON.stringify(list) === JSON.stringify(["assets/icon.icns", "assets/icon.ico", "assets/icon.png"]),
    "app.zon .icons：icns 给 macOS、ico 给 Windows、png 给其余（" + list.join(", ") + "）");
}

// --- the brand colour: a token per theme, used where the plan says ------------
{
  const css = String(read("src/web/styles.css"));
  const html = String(read("src/web/index.html"));
  const hex = (s) => { const v = s.replace("#", ""); return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16)); };
  const rel = (c) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const L = ([r, g, b]) => 0.2126 * rel(r) + 0.7152 * rel(g) + 0.0722 * rel(b);
  const ratio = (a, b) => { const [x, y] = [L(a), L(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const sel = theme === "wood" ? ':root, [data-theme="wood"]' : '[data-theme="' + theme + '"]';
    const start = css.indexOf(sel + " {");
    const blk = start >= 0 ? css.slice(start, css.indexOf("\n    }", start)) : "";
    const raw = new RegExp("--" + theme + "-brand: (#[0-9a-f]{6});").exec(blk);
    const bg = new RegExp("--" + theme + "-bg: (#[0-9a-f]{6});").exec(blk);
    const panel = new RegExp("--" + theme + "-panel: (#[0-9a-f]{6});").exec(blk);
    assert(raw && blk.includes("--brand: var(--" + theme + "-brand);"), theme + "：主题块里声明品牌色 --brand");
    if (raw && bg && panel) {
      const r1 = ratio(hex(raw[1]), hex(bg[1])), r2 = ratio(hex(raw[1]), hex(panel[1]));
      assert(Math.min(r1, r2) >= 3, theme + "：品牌色在底色和面板上都够大字 3:1（" + r1.toFixed(2) + " / " + r2.toFixed(2) + "）");
    }
  }
  const body = css.slice(css.indexOf("* { box-sizing"));
  assert(/\.wordmark \{[^}]*color: var\(--brand\)/.test(body), "字标用品牌色");
  assert(/\.hint\.empty-note::after \{[^}]*background: var\(--brand\)/.test(body), "空状态的图标用品牌色");
  assert(/id="home-h"[^>]*class="[^"]*wordmark|class="[^"]*wordmark[^"]*"[^>]*id="home-h"/.test(html), "首页的标题是字标");
  assert(/id="about-modal"[\s\S]{0,400}class="[^"]*wordmark/.test(html), "关于里有字标");
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
