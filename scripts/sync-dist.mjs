/**
 * Produce frontend/dist — the directory `native package` bundles and
 * `zig build run` serves — from src/app.
 *
 *   1. scripts/build-app.mjs: src/app as ES modules, split (ADR 0001), into
 *      dist-app/ — the files it points at (wasm, weights, the Stockfish
 *      loader) copied under assets/;
 *   2. dist-app/ copied whole to frontend/dist;
 *   3. the licences next to index.html (GPLv3 §4: the product carries them):
 *      ours, Stockfish's, Maia-3's (AGPL-3.0, and the notice that the weights
 *      are converted), Inter's (SIL OFL). The native Stockfish's source note
 *      and authors are added by the build workflows, which build it.
 *
 * What it checks, so a package is never an empty shell: the page's CSP lets a
 * worker start from a URL ('self'), index.html loads main.js, no script points
 * at a `../` URL (it would be outside the package), and every asset the build
 * referenced is there and not empty.
 *
 *   node scripts/sync-dist.mjs
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { buildApp, OUT } from "./build-app.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const DIST = path.join(ROOT, "frontend", "dist");

/** [source relative to ROOT, destination relative to DIST] */
export const LICENSES = [
  ["LICENSE", "licenses/LICENSE.txt"],
  ["third_party/stockfish/COPYING.txt", "licenses/stockfish-COPYING.txt"],
  ["third_party/maia3/LICENSE", "licenses/maia3-LICENSE.txt"],
  ["third_party/maia3/NOTICE", "licenses/maia3-NOTICE.txt"],
  ["src/app/styles/fonts/Inter-OFL.txt", "licenses/Inter-OFL.txt"],
];

const built = await buildApp({ quiet: true });
fs.rmSync(DIST, { recursive: true, force: true });
fs.cpSync(OUT, DIST, { recursive: true });
fs.mkdirSync(path.join(DIST, "licenses"), { recursive: true });
for (const [from, to] of LICENSES) fs.copyFileSync(path.join(ROOT, from), path.join(DIST, to));

const fail = (why) => { console.error("FAIL: frontend/dist " + why); process.exit(1); };
const html = fs.readFileSync(path.join(DIST, "index.html"), "utf8");
const csp = (/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/.exec(html) || [])[1] || "";
if (!/worker-src 'self' blob:/.test(csp)) fail("的 CSP 没有 worker-src 'self' blob:（URL Worker 会先被页面自己挡掉，ADR 0001）：" + csp);
if (!/<script type="module" src="main.js">/.test(html)) fail("的 index.html 没有加载 main.js");
for (const f of fs.readdirSync(DIST).filter((n) => n.endsWith(".js"))) {
  if (/new URL\((["'])\.\.\//.test(fs.readFileSync(path.join(DIST, f), "utf8"))) fail("里 " + f + " 有一个 ../ 的 URL —— 打包后它在包外面");
}
for (const a of built.assets) {
  const p = path.join(DIST, a);
  if (!fs.existsSync(p) || !fs.statSync(p).size) fail("少了 " + a);
}
const bytes = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, d) => n + (d.isDirectory() ? bytes(path.join(dir, d.name)) : fs.statSync(path.join(dir, d.name)).size), 0);
console.log("frontend/dist ← dist-app（" + (bytes(DIST) / 1048576).toFixed(1) + " MB；" + built.assets.length + " 个资源文件在 assets/ 下）");
