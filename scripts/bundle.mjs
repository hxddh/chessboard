/**
 * Bundle the ES modules under src/web/js into one classic script.
 *
 * Why a build step exists at all. zero:// cannot load a worker, cannot fetch,
 * and cannot load an ES module — but it loads a classic script fine. Until
 * 1.25 that constraint was satisfied by *not having modules*: 28 files, 28
 * `<script>` tags, everything on `window`, and the load order in index.html
 * doubling as the dependency graph. That contract was implicit and unchecked,
 * which is how 1.12 shipped two releases in a row where the board went blank
 * on check — one free variable (`CHECK`) read before the file that set it.
 * `scripts/scope-check.mjs` was written to catch exactly that, and it is
 * retired by this change: an unresolved import is now a build error, and the
 * bundler topologically sorts the graph instead of a human maintaining it.
 *
 * So: modules for the source, one classic script for the product. The output
 * (`src/web/js/bundle.js`) is generated and gitignored, exactly like
 * `engine-src.js`.
 *
 * Everything that loads the app runs this first — index.html references only
 * the bundle, and the E2E servers, package.sh and test-chess.mjs all build
 * before they read.
 *
 *   node scripts/bundle.mjs            build
 *   node scripts/bundle.mjs --check    build, then fail if it is not idempotent
 *
 * @module bundle
 */
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const ENTRY = path.join(root, "src/web/js/app.js");
export const OUT = path.join(root, "src/web/js/bundle.js");

/**
 * Load esbuild, or explain how to get it.
 *
 * It is a devDependency rather than a vendored copy because it is a build
 * tool, not a shipped one: nothing in the .app or the .exe comes from it
 * except the text it emits.
 */
async function loadEsbuild() {
  try {
    return await import("esbuild");
  } catch {
    console.error(
      "找不到 esbuild。先装依赖:\n" +
      "  npm install\n" +
      "(它只是构建工具,产物里不含它的任何代码)");
    process.exit(1);
  }
}

/**
 * Build the bundle and return its text.
 *
 * `format: "iife"` is the whole point — the modules keep their own scope and
 * the page gets one classic script. `target` is the two engines the app ships
 * on: WebView2 (Chromium) on Windows, WKWebView on macOS. Both are far newer
 * than these, but naming a floor keeps a future syntax feature from silently
 * becoming a runtime error on the older of the two.
 */
export async function build({ write = true } = {}) {
  const esbuild = await loadEsbuild();
  const r = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    target: ["chrome100", "safari15"],
    charset: "utf8",
    legalComments: "inline",
    // Readable output: this is a desktop app loading from disk, not a page
    // over a network, and a stack trace that points at real source beats a
    // few hundred kilobytes.
    minify: false,
    write: false,
    logLevel: "silent",
  });
  const text = r.outputFiles[0].text;
  if (write) fs.writeFileSync(OUT, text);
  return text;
}

/** Build only when the sources are newer than the bundle. */
export async function buildIfStale() {
  const dir = path.dirname(ENTRY);
  const srcs = fs.readdirSync(dir)
    .filter((f) => f.endsWith(".js") && f !== "bundle.js")
    .map((f) => fs.statSync(path.join(dir, f)).mtimeMs);
  let out = 0;
  try { out = fs.statSync(OUT).mtimeMs; } catch { /* not built yet */ }
  if (out > Math.max(...srcs)) return false;
  await build();
  return true;
}

/**
 * One module compiled to a classic script that publishes its exports as
 * globals — what `vm.runInContext` in test-chess.mjs wants.
 *
 * Before this change those tests read each file and ran it directly, which
 * worked only because every file was an IIFE writing to `global`. The exports
 * are now real ES exports, so the same effect needs a real compile. It stays
 * synchronous (`buildSync`) so the ~26 load sites in the suite remain plain
 * statements rather than each growing an `await`.
 *
 * Imports are followed, so loading board.js still brings pieces.js with it —
 * the load order the test used to have to know is now the bundler's problem.
 *
 * @param {string} abs absolute path to a module under src/web/js
 * @returns {string} classic-script text
 */
export function compileModuleSync(abs) {
  const esbuild = requireEsbuildSync();
  const r = esbuild.buildSync({
    entryPoints: [abs],
    bundle: true,
    format: "iife",
    globalName: "__mod",
    target: ["chrome100", "safari15"],
    charset: "utf8",
    write: false,
    logLevel: "silent",
  });
  // esbuild leaves the namespace in `__mod`; the tests expect the names
  // themselves, exactly as the old `global.X = …` put them there.
  return r.outputFiles[0].text +
    "\n;for (const k of Object.keys(__mod)) globalThis[k] = __mod[k];\n";
}

let _esbuild = null;
function requireEsbuildSync() {
  if (_esbuild) return _esbuild;
  const require = createRequire(import.meta.url);
  try { _esbuild = require("esbuild"); } catch {
    console.error("找不到 esbuild。先 npm install");
    process.exit(1);
  }
  return _esbuild;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await build();
  console.log(`bundle.js: ${(text.length / 1024).toFixed(1)} KB`);
  if (process.argv.includes("--check")) {
    const again = await build({ write: false });
    if (again !== text) { console.error("构建不是幂等的"); process.exit(1); }
    console.log("ok: 两次构建逐字节相同");
  }
}
