/**
 * Build the 20.0 app (src/app) as ES modules, split (ADR 0001): esbuild with
 * `format: "esm"` and `splitting: true`, so every `import()` — the pages, the
 * piece sets — is its own chunk, and the first paint loads only the shell,
 * the play page and what they share.
 *
 *   node scripts/build-app.mjs          → dist-app/ (index.html, main.js, chunks, app.css)
 *
 * Everything lands flat in dist-app/. A `new URL("…", import.meta.url)` in the
 * source is rewritten to point at the same file from there: a worker that is
 * our own code becomes an entry of its own (dist-app/<name>.js); any other
 * file (wasm, weights, the Stockfish loader) is copied under
 * dist-app/assets/, at its path in the repository (assets/third_party/…,
 * assets/src/app/…), and referenced there. So dist-app/ is the whole app on
 * its own: the native package serves it as its root (sync-dist.mjs),
 * where a `../` would climb out of the bundle (v20-0-plan A1).
 * @module build-app
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as esbuild from "esbuild";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = path.join(ROOT, "src/app");
export const OUT = path.join(ROOT, "dist-app");
const URL_RE = /new URL\((["'])(\.{1,2}\/[^"']+)\1,\s*import\.meta\.url\)/g;

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) =>
    d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith(".js") ? [path.join(dir, d.name)] : []);
}

/** Our own modules some source starts as a worker: entry name → file. */
function workerEntries() {
  const out = {};
  for (const f of walk(SRC)) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(URL_RE)) {
      const target = path.resolve(path.dirname(f), m[2]);
      if (target.startsWith(SRC + path.sep) && target.endsWith(".js")) out[entryName(target)] = target;
    }
  }
  return out;
}
const entryName = (file) => path.relative(SRC, file).replace(/\.js$/, "").split(path.sep).filter((p) => p !== "services").join("-");

/** Files outside the bundle the source points at, copied under OUT/ASSETS after the build. */
export const ASSETS = "assets";
const rewriteUrls = (workers, copied) => ({
  name: "import-meta-url",
  setup(b) {
    b.onLoad({ filter: /src[\\/]app[\\/].*\.js$/ }, async (args) => {
      let text = await fs.promises.readFile(args.path, "utf8");
      if (text.includes("import.meta.url")) {
        text = text.replace(URL_RE, (all, q, rel) => {
          const target = path.resolve(path.dirname(args.path), rel);
          const name = Object.keys(workers).find((k) => workers[k] === target);
          let to = "./" + name + ".js";
          if (!name) {
            const rel = path.relative(ROOT, target);
            if (rel.startsWith("..") || path.isAbsolute(rel)) throw new Error("build-app: " + args.path + " points outside the repository: " + all);
            copied.set(target, ASSETS + "/" + rel.split(path.sep).join("/"));
            to = "./" + copied.get(target);
          }
          return "new URL(" + q + to + q + ", import.meta.url)";
        });
      }
      return { contents: text, loader: "js" };
    });
  },
});

export async function buildApp({ minify = true, quiet = false } = {}) {
  const t0 = Date.now();
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  const workers = workerEntries();
  const copied = new Map();
  const js = await esbuild.build({
    entryPoints: { main: path.join(SRC, "main.js"), ...workers },
    bundle: true, splitting: true, format: "esm", outdir: OUT, target: "es2022",
    entryNames: "[name]", chunkNames: "[name]-[hash]", minify, sourcemap: false,
    metafile: true, logLevel: "warning", plugins: [rewriteUrls(workers, copied)],
  });
  // the self-test (src/app/selftest.js, loaded only in the shell's self-test
  // mode): one file of its own, so the contract suites it carries never
  // change how the app itself is split
  await esbuild.build({
    entryPoints: { selftest: path.join(SRC, "selftest.js") },
    bundle: true, splitting: false, format: "esm", outdir: OUT, target: "es2022", minify, sourcemap: false,
    logLevel: "warning", plugins: [rewriteUrls(workers, copied)],
  });
  for (const [from, to] of copied) {
    if (!fs.existsSync(from)) throw new Error("build-app: " + path.relative(ROOT, from) + " is referenced but missing");
    fs.mkdirSync(path.dirname(path.join(OUT, to)), { recursive: true });
    fs.copyFileSync(from, path.join(OUT, to));
  }
  // the stylesheet: tokens + app rules in one file, the font beside it
  const cssEntry = path.join(OUT, "_app.css");
  fs.writeFileSync(cssEntry, '@import "../src/app/styles/tokens.css";\n@import "../src/app/styles/app.css";\n');
  await esbuild.build({ entryPoints: { app: cssEntry }, bundle: true, outdir: OUT, minify, logLevel: "warning",
    loader: { ".woff2": "file" }, assetNames: "[name]-[hash]" });
  fs.rmSync(cssEntry);

  // index.html: one stylesheet, one module script, the play page preloaded
  const outs = js.metafile.outputs;
  const rel = (f) => path.relative(OUT, path.join(ROOT, f)).split(path.sep).join("/");
  const playOut = Object.keys(outs).find((o) => outs[o].entryPoint === "src/app/pages/play.js");
  const preload = new Set();
  const visit = (o) => {
    if (!o || preload.has(o)) return;
    preload.add(o);
    for (const i of outs[o].imports) if (i.kind === "import-statement") visit(i.path);
  };
  visit(playOut);
  const mainOut = Object.keys(outs).find((o) => outs[o].entryPoint === "src/app/main.js");
  for (const i of outs[mainOut].imports) if (i.kind === "import-statement") preload.add(i.path);
  let html = fs.readFileSync(path.join(SRC, "index.html"), "utf8");
  html = html.replace(/\s*<link rel="stylesheet" href="styles\/tokens.css">\s*<link rel="stylesheet" href="styles\/app.css">/,
    '\n  <link rel="stylesheet" href="app.css">');
  html = html.replace(/\s*<link rel="modulepreload" href="pages\/play.js">/,
    [...preload].map((o) => '\n  <link rel="modulepreload" href="' + rel(o) + '">').join(""));
  fs.writeFileSync(path.join(OUT, "index.html"), html);

  const sizes = Object.fromEntries(Object.entries(outs).map(([o, v]) => [rel(o), v.bytes]));
  const first = [rel(mainOut), ...[...preload].map(rel)];
  const firstBytes = [...new Set(first)].reduce((a, f) => a + sizes[f], 0);
  if (!quiet) {
    console.log("dist-app: " + Object.keys(sizes).length + " files in " + (Date.now() - t0) + " ms; first paint loads " +
      [...new Set(first)].length + " modules, " + (firstBytes / 1024).toFixed(1) + " KB");
  }
  return { sizes, first: [...new Set(first)], firstBytes, ms: Date.now() - t0, assets: [...copied.values()] };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) await buildApp();
