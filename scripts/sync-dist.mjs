/**
 * Produce frontend/dist — the directory `native package` bundles and
 * `zig build run` serves — from src/web.
 *
 * One script, because before this the same six lines lived in three places
 * (scripts/package.sh, build-macos.yml, build-windows.yml) and build.zig had
 * a fourth, wrong version: `npm --prefix frontend run build` against a
 * `frontend/` npm project that never existed (v6-plan D12). build.zig's
 * `frontend-build` step now runs this file; the shell copies stay as they
 * are and this does exactly what they do:
 *
 *   1. node scripts/gen-engine-src.mjs   (Stockfish loader + wasm as base64)
 *   2. node scripts/bundle.mjs           (the ES modules → one classic script)
 *   3. copy src/web/index.html, src/web/styles.css,
 *           src/web/js/bundle.js, src/web/js/engine-src.js
 *      — only the two generated scripts ship; index.html loads exactly these,
 *      and the module sources are build inputs, not product.
 *   4. copy LICENSE and third_party/stockfish/COPYING.txt into licenses/
 *      next to index.html (GPLv3 §4: the product has to carry the licence).
 *
 * Same sanity checks as package.sh: the bundle must be the whole app and
 * engine-src must carry the full wasm payload, not a stub.
 *
 *   node scripts/sync-dist.mjs
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { CHUNKS } from "./bundle.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const DIST = path.join(ROOT, "frontend", "dist");

const run = (script) => execFileSync(process.execPath, [path.join(HERE, script)], { cwd: ROOT, stdio: "inherit" });

run("gen-engine-src.mjs");
run("bundle.mjs");

fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(DIST, "js"), { recursive: true });
fs.mkdirSync(path.join(DIST, "licenses"), { recursive: true });

/** [source relative to ROOT, destination relative to DIST] */
const FILES = [
  ["src/web/index.html", "index.html"],
  ["src/web/styles.css", "styles.css"],
  ["src/web/js/bundle.js", "js/bundle.js"],
  ["src/web/js/engine-src.js", "js/engine-src.js"],
  ["LICENSE", "licenses/LICENSE.txt"],
  ["third_party/stockfish/COPYING.txt", "licenses/stockfish-COPYING.txt"],
  // 6.1: the on-demand chunks. Read from the bundler's own list rather than
  // typed again here — a chunk that is built but not packaged is an app whose
  // opening names silently never appear, and a list in two places is how that
  // happens. The size guards below apply to these too.
  ...CHUNKS.map((c) => [c.out, "js/" + path.basename(c.out)]),
];
for (const [from, to] of FILES) fs.copyFileSync(path.join(ROOT, from), path.join(DIST, to));

const size = (rel) => fs.statSync(path.join(DIST, rel)).size;
if (size("js/bundle.js") <= 400000) {
  console.error("FAIL: frontend/dist/js/bundle.js 太小 —— 不是完整的应用");
  process.exit(1);
}
// 7.0 重标定：Stockfish 18 lite-single 的 wasm 是 7.3 MB，base64 后 9.75 MB；
// 19 lite-single 换了一张 1 MB 的网络，wasm 1.79 MB、base64 后 2.41 MB。这条
// 守卫防的是「打出一个空壳」，所以门槛跟着实际体积走，不是跟着历史走。
if (size("js/engine-src.js") <= 2000000) {
  console.error("FAIL: frontend/dist/js/engine-src.js 太小 —— 没带上完整的 wasm");
  process.exit(1);
}
for (const c of CHUNKS) {
  const rel = "js/" + path.basename(c.out);
  if (size(rel) <= 50000) {
    console.error(`FAIL: frontend/dist/${rel} 太小 —— 分块没建出来`);
    process.exit(1);
  }
}
console.log(`frontend/dist ← src/web (${FILES.length} files)`);
