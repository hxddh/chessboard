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
 * 6.1 — content the first paint does not use, built as its own classic script
 * and injected on demand by src/web/js/chunk.js.
 *
 * `bundle.js` was 1.68 MB because everything app.js imports statically lands
 * in it, and about a megabyte of that is data: the ECO table for a label that
 * appears next to a game, the mined puzzles for a tab most sessions never
 * open, and the two interface languages the reader is not reading in. Each
 * entry below is bundled alone, exports onto the window, and is *not* reached
 * from app.js's import graph — that last part is what keeps it out of the
 * main bundle, and test-chess.mjs asserts it stays that way.
 */
//
// v8-0-plan F5 finished what 6.1 planned: the languages, the mined puzzles
// and the second piece set are chunks too (src/web/js/lazy-content.js says
// who needs which, and when), and `boot` is the one chunk index.html itself
// loads — ahead of bundle.js, to put the saved language's chunk on the page
// before the first frame. `min` is sync-dist.mjs's "was it really built"
// floor, per chunk now that they are not all the ECO table's size.
/**
 * v8-0-plan B1: the imported Lichess puzzles, one chunk per 200-point band.
 * scripts/import-puzzles.mjs writes lichess/band-NNNN.js and an index that
 * names the same bands; the list is read from the directory so an import
 * needs no edit here. puzzle-db.js bandChunk() derives the same file and
 * global names. No bands on disk (the database not imported yet), no chunks.
 * @param {string} dir
 */
export function lichessChunks(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^band-\d{4}\.js$/.test(f)).sort(); } catch { files = []; }
  return files.map((f) => {
    const n = f.slice(-7, -3);
    return { entry: path.relative(root, path.join(dir, f)).split(path.sep).join("/"), out: "src/web/js/chunk-lc-" + n + ".js", global: "LC_BAND_" + n, min: 1000 };
  });
}

/**
 * v8-0-plan C3: the master move tree, one chunk per ply bucket.
 * scripts/build-explorer.mjs writes explorer/masters-NN.js and an index
 * naming the buckets; explorer/ui.js masterChunk() derives the same file and
 * global names. Read from the directory, as the puzzle bands are.
 * @param {string} dir
 */
export function explorerChunks(dir) {
  let files = [];
  try { files = fs.readdirSync(dir).filter((f) => /^masters-\d\d\.js$/.test(f)).sort(); } catch { files = []; }
  return files.map((f) => {
    const n = f.slice(8, 10);
    return { entry: path.relative(root, path.join(dir, f)).split(path.sep).join("/"), out: "src/web/js/chunk-xm-" + n + ".js", global: "EXPLORER_MB_" + n, min: 1000 };
  });
}

export const CHUNKS = [
  { entry: "src/web/js/eco.js", out: "src/web/js/chunk-eco.js", global: "ECO_BY_KEY", min: 400000 },
  { entry: "src/web/js/lang-en.js", out: "src/web/js/chunk-lang-en.js", global: "CHESS_I18N_EN", min: 150000 },
  { entry: "src/web/js/lang-ja.js", out: "src/web/js/chunk-lang-ja.js", global: "CHESS_I18N_JA", min: 200000 },
  // the mined puzzles, and the Lichess index with them (mined-chunk.js)
  { entry: "src/web/js/mined-chunk.js", out: "src/web/js/chunk-mined.js", global: "MINED_PUZZLES", min: 150000 },
  { entry: "src/web/js/pieces-merida.js", out: "src/web/js/chunk-merida.js", global: "MERIDA_PIECE_SVGS", min: 30000 },
  // v8-0-plan A3: the further piece sets, one chunk each (lazy-content.js PIECE_CHUNKS)
  { entry: "src/web/js/pieces-chessnut.js", out: "src/web/js/chunk-pieces-chessnut.js", global: "CHESSNUT_PIECE_SVGS", min: 25000 },
  { entry: "src/web/js/pieces-fantasy.js", out: "src/web/js/chunk-pieces-fantasy.js", global: "FANTASY_PIECE_SVGS", min: 60000 },
  { entry: "src/web/js/pieces-celtic.js", out: "src/web/js/chunk-pieces-celtic.js", global: "CELTIC_PIECE_SVGS", min: 25000 },
  { entry: "src/web/js/pieces-spatial.js", out: "src/web/js/chunk-pieces-spatial.js", global: "SPATIAL_PIECE_SVGS", min: 30000 },
  { entry: "src/web/js/boot.js", out: "src/web/js/chunk-boot.js", global: null, boot: true, min: 500 },
  // v8-0-plan A4 + F5: the review's picture and its key-moments card (lazy-content.js REVIEW_CHUNKS)
  { entry: "src/web/js/report.js", out: "src/web/js/chunk-report.js", global: "ChessReport", min: 3000 },
  { entry: "src/web/js/review/moments.js", out: "src/web/js/chunk-moments.js", global: "createMoments", min: 3000 },
  // v8-0-plan B4: the ladder, personas, rating and styles (opponents-lazy.js)
  { entry: "src/web/js/opponents-chunk.js", out: "src/web/js/chunk-opponents.js", global: "CHESS_OPPONENTS", min: 15000 },
  // v8-0-plan C1: the library as a database — IndexedDB, search, 本机 games (library-ui.js)
  { entry: "src/web/js/library-page.js", out: "src/web/js/chunk-libdb.js", global: "CHESS_LIBDB", min: 15000 },
  // v8-0-plan C2: the sync dialog, on its button's first click (prefs-ui.js)
  { entry: "src/web/js/sync-ui.js", out: "src/web/js/chunk-sync.js", global: "createSyncUI", min: 2000 },
  // v8-1-plan T3: the repertoire by position — records, cards, cross-check (repertoire-ui.js)
  { entry: "src/web/js/rep-page.js", out: "src/web/js/chunk-rep.js", global: "CHESS_REP", min: 3000 },
  ...lichessChunks(path.join(root, "src/web/js/lichess")),
  // v8-0-plan C3: the opening explorer's panel (explorer/lazy.js), then the master tree's buckets
  { entry: "src/web/js/explorer/ui.js", out: "src/web/js/chunk-explorer.js", global: "createExplorerUI", min: 5000 },
  // v8-1-plan T2: the endgame camp's ninety positions and their words (trainer/endgames.js)
  { entry: "src/web/js/endgames.js", out: "src/web/js/chunk-endgames.js", global: "CHESS_ENDGAMES", min: 20000 },
  // v8-2-plan T3: 名局猜着's runner — judging the guesses, its board and card (trainer/lessons.js)
  { entry: "src/web/js/trainer/guess.js", out: "src/web/js/chunk-guess.js", global: "createGuess", min: 3000 },
  // v8-4-plan T2: the thirty further classics, three languages, for 读棋 and 名局猜着 (trainer/classics-more.js)
  { entry: "src/web/js/classics-more-chunk.js", out: "src/web/js/chunk-classics-more.js", global: "CHESS_CLASSICS_MORE", min: 40000 },
  // v8-2-plan T2: 看 N 步后 / 盲走收官, their questions and their words (trainer/visual.js)
  { entry: "src/web/js/trainer/visual-modes.js", out: "src/web/js/chunk-visual.js", global: "CHESS_VISUAL", min: 5000 },
  // v8-2-plan T1: the advanced course part 3 — 24 lessons, three languages (trainer/lessons-adv.js)
  { entry: "src/web/js/lessons-adv-chunk.js", out: "src/web/js/chunk-lessons-adv.js", global: "CHESS_LESSONS_ADV", min: 20000 },
  // v8-2-plan V1: the packaged self-test's checks and the automation build's scenarios (app.js, CHESS_SELFTEST=1 only)
  { entry: "src/web/js/selftest-run.js", out: "src/web/js/chunk-selftest.js", global: "CHESS_SELFTEST_RUN", min: 5000 },
  ...explorerChunks(path.join(root, "src/web/js/explorer")),
];

/**
 * The first-paint budget, in minified bytes: test-chess.mjs fails the build
 * past this line. What it exists to catch — a chunk's payload inlined again
 * by a stray static import — is caught per chunk by the probe checks beside
 * it in test-chess.mjs; this line is the backstop for a whole language's
 * content coming back (~200 KB each).
 */
export const BUNDLE_BUDGET = 951642;

/**
 * v8-1-plan F2 (option a): whitespace and syntax, never identifiers. A stack
 * trace from a player's machine still names app.js's functions, the tests
 * that find a binding by name in the output (test-learning.mjs's LC_INDEX)
 * still find it. `legalComments: "inline"` is unchanged and so is what it
 * keeps: esbuild drops ordinary block comments with or without minify (the
 * readable bundle carried no licence header either — chess.js's is a plain
 * `/*` comment; the licences live in the vendored sources and README's 许可),
 * and a `/*!` or @license comment would still be kept. So what goes is not
 * the comments (esbuild never emitted the source's comments) but layout:
 * 174 KB of indentation alone at v8.0.0, the line breaks, esbuild's
 * `// src/…` file markers, and what minifySyntax folds (`var a, b` merged,
 * `void 0`, shorter conditionals).
 */
export const MINIFY = { minifyWhitespace: true, minifySyntax: true, minifyIdentifiers: false };

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
 * on: WebView2 (Chromium) on Windows, WKWebView on macOS. Naming a floor
 * keeps a future syntax feature from silently becoming a runtime error on
 * the older of the two.
 *
 * Why the WebKit floor stays safari15 (v8-1-plan §5). WKWebView is the
 * system's WebKit, so the floor is set by the oldest macOS the app runs on,
 * and SDK 0.10.1 says 11.0: its Info.plist template writes
 * LSMinimumSystemVersion 11.0 (src/tooling/package.zig) and build/app.zig
 * links with -mmacosx-version-min=11.0, as build.zig here does. Big Sur
 * shipped Safari 14 and was offered 15 and 16 as updates, none of them
 * guaranteed — so nothing promises Safari 16's WebKit, and C1's gap stays
 * (no BroadcastChannel before Safari 15.4: another window learns of a
 * library commit at its next launch, library-page.js). safari15 is already
 * a step above what the plist allows; raising it waits for the SDK's
 * minimum to rise.
 */
/** The app's version, from package.json — the About panel reads it (6.0). */
function versionDefine() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    return { __CHESS_VERSION__: JSON.stringify(String(pkg.version || "")) };
  } catch (_) { return { __CHESS_VERSION__: JSON.stringify("") }; }
}

export async function build({ write = true, minify = true } = {}) {
  const esbuild = await loadEsbuild();
  // Until 8.0 this was `minify: false`: a desktop app loading from disk, and
  // a stack trace that points at real source. MINIFY keeps the second (the
  // names survive) and drops what the first never needed. `minify: false` is
  // still here for scripts/measure-boot.mjs's before/after (v8-1-plan F2).
  const min = minify ? MINIFY : {};
  const r = await esbuild.build({
    entryPoints: [ENTRY],
    bundle: true,
    format: "iife",
    define: versionDefine(),
    target: ["chrome100", "safari15"],
    charset: "utf8",
    legalComments: "inline",
    ...min,
    write: false,
    logLevel: "silent",
  });
  const text = r.outputFiles[0].text;
  if (write) fs.writeFileSync(OUT, text);
  for (const c of CHUNKS) {
    const cr = await esbuild.build({
      entryPoints: [path.join(root, c.entry)],
      bundle: true,
      format: "iife",
      globalName: "__chunk",
      define: versionDefine(),
      target: ["chrome100", "safari15"],
      charset: "utf8",
      legalComments: "inline",
      ...min,
      write: false,
      logLevel: "silent",
    });
    // esbuild leaves the namespace in `__chunk`; the page wants the names
    // themselves, the same shape compileModuleSync uses for the tests.
    const body = cr.outputFiles[0].text +
      "\n;for (var k in __chunk) if (Object.prototype.hasOwnProperty.call(__chunk, k)) window[k] = __chunk[k];\n";
    if (write) fs.writeFileSync(path.join(root, c.out), body);
  }
  // 10.0 M0: a chunk no longer built (9.0 dropped chunk-lc-old-*) is removed,
  // not left beside the live ones — chunk-*.js is build output (.gitignore)
  if (write) {
    const live = new Set(CHUNKS.map((c) => path.basename(c.out)));
    const dir = path.join(root, "src/web/js");
    for (const f of fs.readdirSync(dir)) if (/^chunk-.+\.js$/.test(f) && !live.has(f)) fs.rmSync(path.join(dir, f));
  }
  return text;
}

/** Build only when the sources are newer than the bundle. */
export async function buildIfStale() {
  const dir = path.dirname(ENTRY);
  // recursive: v8-0-plan F4 puts app.js's regions in folders (review/, trainer/)
  const srcs = fs.readdirSync(dir, { recursive: true })
    .map(String)
    .filter((f) => f.endsWith(".js") && f !== "bundle.js")
    .map((f) => fs.statSync(path.join(dir, f)).mtimeMs)
    // and this file: a change to how the bundle is built (v8-1-plan F2's
    // MINIFY) is as much a reason to rebuild as a change to what goes in
    .concat(fs.statSync(fileURLToPath(import.meta.url)).mtimeMs);
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
    define: versionDefine(),
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

// Run directly, or imported? `file://` + argv[1] answers that on posix and
// silently answers "imported" on Windows, where argv[1] is `D:\\a\\…\\bundle.mjs`
// and import.meta.url is `file:///D:/a/…/bundle.mjs`. The block below then
// never runs: no bundle written, nothing printed, exit 0. That is exactly how
// the 2.0.0 release failed — the Windows build's next line was
// `cp src/web/js/bundle.js`, and the only symptom was "No such file or
// directory" three commands later. Compare real paths instead.
const runDirectly = !!process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  const text = await build();
  // bytes, not UTF-16 code units: the sources carry Chinese, and length/1024
  // under-reported the file on disk by about 15% (6.1)
  const kb = (t) => (Buffer.byteLength(t, "utf8") / 1024).toFixed(1);
  console.log(`bundle.js: ${kb(text)} KB` +
    CHUNKS.map((c) => `, ${path.basename(c.out)}: ${kb(fs.readFileSync(path.join(root, c.out), "utf8"))} KB`).join(""));
  if (process.argv.includes("--check")) {
    const again = await build({ write: false });
    if (again !== text) { console.error("构建不是幂等的"); process.exit(1); }
    console.log("ok: 两次构建逐字节相同");
  }
}
