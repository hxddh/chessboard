/**
 * What every module of scripts/test-chess.mjs shares: `assert` and its failure
 * count, the vm context the app modules are loaded into, and the source
 * lookups (`allAppSource`, `srcOf`, APP_MODULES) the guards read app code by.
 *
 * Importing it does what the top of test-chess.mjs did before the checks were
 * split by domain: it creates the context, loads chess.js and reads every
 * hand-written module in src/web/js once.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "../bundle.mjs";

/** scripts/ — the checks live one directory below it */
export const scriptsDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const root = path.join(scriptsDir, "..");
/**
 * Every .mjs in scripts/ and scripts/test/, relative to scripts/ ("bundle.mjs",
 * "test/rules.mjs"). A scan of the scripts that read only the top level would
 * stop seeing this suite's own checks, which moved down a directory.
 */
export const scriptFiles = () => fs.readdirSync(scriptsDir).filter((n) => n.endsWith(".mjs"))
  .concat(fs.readdirSync(path.join(scriptsDir, "test")).filter((n) => n.endsWith(".mjs")).map((n) => "test/" + n));

/**
 * Run one app module inside a vm context, exports landing as globals.
 *
 * Up to 1.25 this was `vm.runInContext(readFileSync(f))` at 26 call sites: the
 * files were IIFEs writing to `global`, so running one *was* loading it, and
 * the test had to know the load order (openings.js before the openings tests,
 * pieces.js before board.js). They are ES modules now, so this compiles them —
 * imports and all — and publishes the exports the way the old wrapper did.
 * The order is the bundler's to work out; the call sites just name what they
 * want.
 */
export function loadModule(context, rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  // v8-0-plan F5: the en/ja dictionaries and content are chunks the page puts
  // on the window before the bundle runs; the suite does the same, so every
  // check below still sees all three languages in ChessI18n.DICT.
  if (path.basename(abs) === "i18n.js") {
    for (const f of ["lang-en.js", "lang-ja.js"]) {
      vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), context, { filename: f });
    }
  }
  vm.runInContext(compileModuleSync(abs), context, { filename: path.basename(abs) });
}
export const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
loadModule(ctx, "src/web/js/chess.js");
export const Chess = ctx.Chess;

/** shapes handed to the headless render check (scripts/test-render.mjs) */
let boardShapes = [];
let failed = 0;
export function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
/** how many asserts have failed so far */
export const failures = () => failed;

// --- v8-0-plan F4: a source check names a symbol, not a file ---------------
//
// About 150 checks in this suite read app.js's source as text (111 of them are
// in the register at the end), and up to 7.9 each did so by its file name. F4 splits that file into modules, and
// every function it moves would have turned the checks that mention it red
// with nothing actually wrong. So they read `allAppSource` instead: every
// hand-written module in src/web/js, app.js first, the generated ones (the
// bundle, its chunks, the engine source) left out. `srcOf(name)` returns one
// declaration's text from whichever module holds it. A check that really is
// about one file — the markup, the stylesheet, a workflow, a module's own
// exported contract — still reads that file by name.
export const WEB_JS = path.join(root, "src/web/js");
export const GENERATED_JS = /^(?:bundle|engine-src|chunk-.+)\.js$/;
/**
 * Every .js under `dir`, as paths relative to it ("app.js", "review/panel.js").
 * F4 moves app.js's regions into folders (review/, trainer/), and a scan that
 * read only the top level would stop seeing the code it was written for.
 * lichess/ is left out: the import script writes it (v8-0-plan B1).
 */
export const webJsFiles = (dir) => fs.readdirSync(dir, { recursive: true })
  .map((f) => String(f).split(path.sep).join("/"))
  .filter((f) => f.endsWith(".js") && !f.startsWith("lichess/"));
/** file name → source for every hand-written module in `dir`, app.js first */
export function readWebModules(dir) {
  const names = webJsFiles(dir).filter((f) => !GENERATED_JS.test(f)).sort();
  names.sort((a, b) => (b === "app.js") - (a === "app.js"));
  return new Map(names.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
}
export const joinModules = (mods) => [...mods.values()].join("\n");
/**
 * The text of `function name(…) {…}` or `const|let|var name = …;` in `text`,
 * or "" if it is not declared there. Brackets are matched with strings and
 * comments skipped, so a "}" inside a message does not end the body early.
 */
export function declarationIn(text, name) {
  const id = name.replace(/[$]/g, "\\$");
  const m = new RegExp("(?:^|[^\\w$.])((?:async\\s+)?function\\*?\\s+" + id + "\\s*\\(|(?:const|let|var)\\s+" + id + "\\s*=)").exec(text);
  if (!m) return "";
  const start = m.index + m[0].length - m[1].length;
  const isFn = /function/.test(m[1]);
  let depth = 0, seenBody = false;
  for (let k = start + m[1].length - (isFn ? 1 : 0); k < text.length; k++) {
    const c = text[k];
    if (c === '"' || c === "'" || c === "`") {
      for (k++; k < text.length && text[k] !== c; k++) if (text[k] === "\\") k++;
      continue;
    }
    if (c === "/" && text[k + 1] === "/") { k = text.indexOf("\n", k); if (k < 0) break; continue; }
    if (c === "/" && text[k + 1] === "*") { k = text.indexOf("*/", k) + 1; if (k <= 0) break; continue; }
    if (c === "/" && /[(,=:[!&|?{};]\s*$|\breturn\s*$/.test(text.slice(Math.max(0, k - 12), k))) {
      // a regex literal: `/"/` or `/\}/` must not open a string or close a block
      k++;
      for (let cls = false; k < text.length && text[k] !== "\n"; k++) {
        if (text[k] === "\\") k++;
        else if (text[k] === "[") cls = true;
        else if (text[k] === "]") cls = false;
        else if (text[k] === "/" && !cls) break;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; if (c === "{") seenBody = true; }
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      // a function ends with the brace that closes its body, a binding with
      // the `;` at its own depth (the house style never leans on ASI)
      if (isFn && depth === 0 && c === "}" && seenBody) return text.slice(start, k + 1);
    } else if (!isFn && depth === 0 && c === ";") {
      return text.slice(start, k + 1);
    }
  }
  return "";
}
/** { file, text } of the module that declares `name`, or null */
export function findSymbol(mods, name) {
  for (const [file, text] of mods) {
    const hit = declarationIn(text, name);
    if (hit) return { file, text: hit };
  }
  return null;
}
export const WEB_MODULES = readWebModules(WEB_JS);
export const allAppSource = joinModules(WEB_MODULES);
export const srcOf = (name) => (findSymbol(WEB_MODULES, name) || { text: "" }).text;
// A negative check — "app.js never spells X, module Y owns it" — becomes "no
// module but Y spells X": the owner is left out and everything else is read,
// so the rule still holds wherever app.js's code goes next.
export const allSourceExcept = (...owners) =>
  joinModules(new Map([...WEB_MODULES].filter(([f]) => !owners.includes(f))));
// The per-line house rules (no module-level `let`, no Chinese literal reaching
// the DOM) were written for app.js, and the data modules — lessons, puzzles,
// the dictionaries — are Chinese by design. A module carved out of app.js
// joins this list in the same PR, so the rules follow the code they were
// written for.
export const APP_MODULES = ["app.js", "appearance-ui.js", "settings-ui.js", "shell.js", "prefs-ui.js", "review-pass.js", "review/eval-graph.js", "review/retry.js", "review/panel.js", "review/lines.js", "review/analysis.js", "review/board-marks.js",
  "trainer/content.js", "trainer/lessons.js", "trainer/puzzles.js", "trainer/today.js", "trainer/puzzle-modes.js",
  "trainer/puzzle-book.js", "trainer/puzzle-rating.js", "trainer/puzzle-openings.js", "trainer/puzzle-mine.js", "trainer/guess.js",
  "me-page.js", "game-end.js", "review/moments.js", "opponents-ui.js", "io.js", "game-controller.js"];
export const appModuleEntries = () => APP_MODULES.map((f) => [f, WEB_MODULES.get(f) || ""]);
