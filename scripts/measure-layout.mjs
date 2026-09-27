/**
 * The play view at the five window sizes v8-0-plan §2 A2 is accepted at.
 *
 *   node scripts/measure-layout.mjs                      print
 *   node scripts/measure-layout.mjs --shots=DIR          …and save a PNG per size
 *   node scripts/measure-layout.mjs --record=before      …and write docs/measured.json → layoutA2.before
 *   node scripts/measure-layout.mjs --record=after       …and → layoutA2.after
 *
 * The position is the same everywhere: a two-player game, ten plies of the
 * Italian (five notation rows, with a figurine, a capture and a pawn move in
 * each column), the panel open on 对局. What is measured and how is
 * scripts/lib/layout-probe.mjs; scripts/test-layout-e2e.mjs asserts the same
 * numbers against A2's thresholds. "before" was recorded on 107838a (M1).
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser } from "./e2e-browser.mjs";
import { layoutProbe } from "./lib/layout-probe.mjs";
import { read, record } from "./measurements.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
const arg = (k) => { const a = process.argv.find((x) => x.startsWith("--" + k + "=")); return a ? a.slice(k.length + 3) : null; };
const SHOTS = arg("shots");
const REC = arg("record");

export const SIZES = [[1024, 768], [1280, 800], [1440, 900], [1920, 1080], [600, 900]];
export const ITALIAN = ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6", "f1", "c4", "f8", "c5", "c2", "c3", "g8", "f6", "d2", "d4", "e5", "d4"];

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;
const browser = await launchBrowser();

const out = {};
for (const [w, h] of SIZES) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  for (const sq of ITALIAN) {
    const pt = await page.evaluate((s) => {
      const b = document.getElementById("board").getBoundingClientRect();
      return { x: b.left + (s.charCodeAt(0) - 97 + 0.5) * (b.width / 8), y: b.top + (8 - Number(s[1]) + 0.5) * (b.height / 8) };
    }, sq);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(120);
  }
  await page.waitForTimeout(400);
  const m = await page.evaluate(layoutProbe);
  out[w + "x" + h] = m;
  console.log(w + "x" + h, JSON.stringify(m));
  if (SHOTS) {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, w + "x" + h + ".png") });
  }
  await ctx.close();
}
await browser.close();
server.close();

if (REC === "before" || REC === "after") {
  const prev = read().layoutA2 || {};
  record("layoutA2", {
    what: "v8-0-plan §2 A2：下棋视图在五档窗口下的几何。band 为最宽的非内容空带（整条横向或纵向都没有内容的带），share 为棋盘格子占下棋视图的面积比，gutter 为棋谱白列最宽着法文字右缘到黑列文字左缘，nav 为最后一行棋谱底到翻谱栏顶，first 为竖窗第一屏不滚动就看得见的着法格数",
    script: "scripts/measure-layout.mjs --record=" + REC,
    position: "双人对局，意大利开局 10 个半回合（5 行棋谱），面板开在「对局」页",
    sizes: SIZES.map(([w, h]) => w + "x" + h),
    before: REC === "before" ? out : prev.before,
    after: REC === "after" ? out : prev.after,
  });
}
