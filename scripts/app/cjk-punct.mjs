/**
 * Full-width punctuation in the 20.0 app's Chinese and Japanese copy — 19.0's
 * scripts/cjk-punct.mjs, pointed at src/app.
 *
 * An ASCII `, ; : ( )` between CJK characters is the first thing a Chinese
 * or Japanese reader sees on a screen, and the cheapest signal of "not
 * finished"; it is also the cheapest thing to keep fixed, which is what this
 * check is for.
 *
 * What it reads: string LITERALS in every .js under src/app (the page
 * dictionaries, the explainer's sentences, the opponents' lines, the
 * content's words), and only the ones that contain a CJK character —
 * comments, keys, code and literals without CJK are left alone, so the
 * English copy never trips it. Inside such a literal `, ; : ( )` should be
 * their full-width forms; `?` and `!` too, but only directly after a CJK
 * character — `?!` `?` `??` are move marks and stand after a space. A colon
 * between two digits (5:00) is a time and stays.
 *
 *   node scripts/app/cjk-punct.mjs           list the offenders, exit 1 if any
 *   node scripts/app/cjk-punct.mjs --fix     rewrite the files in place
 *
 * scripts/app/cjk-punct.test.mjs runs the check in `npm run test:app`.
 * @module app/cjk-punct
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
export const APP = path.join(ROOT, "src", "app");

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
const MAP = { ",": "，", ";": "；", ":": "：", "(": "（", ")": "）", "?": "？", "!": "！" };
const ASCII = /[,;:()?!]/g;

/** One literal's contents (without its quotes), as it should be. */
export function fixLiteral(text) {
  if (!CJK.test(text)) return text;
  return text.replace(ASCII, (ch, i) => {
    const prev = text[i - 1] || "", next = text[i + 1] || "";
    if (ch === ":" && /\d/.test(prev) && /\d/.test(next)) return ch;          // 5:00
    if ((ch === "?" || ch === "!") && !CJK.test(prev)) return ch;            // ?! ?? — move marks
    return MAP[ch];
  });
}

/**
 * Walk a JS source, passing its string literals through `fixLiteral` and
 * leaving everything else as it is. A `${…}` in a template literal is kept
 * whole (only the text around it is read); comments and regex literals are
 * skipped (a `/` after an operator or an opening bracket starts a regex).
 * @returns {{ src: string, hits: Array<{ line: number, from: string, to: string }> }}
 */
export function transform(src) {
  let out = "";
  const hits = [];
  let i = 0, line = 1;
  const n = src.length;
  const isOpenerBefore = (j) => {
    let k = j - 1;
    while (k >= 0 && /\s/.test(src[k])) k--;
    return k < 0 || /[=(,;:!&|?{}[+\-*%<>~^]/.test(src[k]) || /\b(return|typeof|case|in|of)$/.test(src.slice(Math.max(0, k - 6), k + 1));
  };
  const literal = (body, at) => {
    // a template's ${…} parts are code: only the text between them is copy
    const parts = body.split(/(\$\{[^}]*\})/);
    const fixed = parts.map((p) => (/^\$\{/.test(p) ? p : fixLiteral(p))).join("");
    if (fixed !== body) hits.push({ line: at, from: body, to: fixed });
    return fixed;
  };
  while (i < n) {
    const c = src[i];
    if (c === "\n") line++;
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; out += src.slice(i, end); i = end; continue; }
    if (c === "/" && isOpenerBefore(i)) {
      let j = i + 1, cls = false;
      while (j < n && (cls || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        else if (src[j] === "\n") break;
        j++;
      }
      j++;
      while (j < n && /[gimsuy]/.test(src[j])) j++;
      out += src.slice(i, j); i = j; continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const at = line;
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; if (src[j] === "\n") line++; j++; }
      out += c + literal(src.slice(i + 1, j), at) + c; i = j + 1; continue;
    }
    out += c; i++;
  }
  return { src: out, hits };
}

/** Every .js under src/app. */
export function appFiles(dir = APP) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? appFiles(p) : e.name.endsWith(".js") ? [p] : [];
  }).sort();
}

/** @returns {Array<{ file: string, line: number, from: string, to: string }>} */
export function scan({ fix = false, files = appFiles() } = {}) {
  const all = [];
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (!CJK.test(src)) continue;
    const { src: next, hits } = transform(src);
    for (const h of hits) all.push({ file: path.relative(ROOT, abs), ...h });
    if (fix && next !== src) fs.writeFileSync(abs, next);
  }
  return all;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fix = process.argv.includes("--fix");
  const hits = scan({ fix });
  if (fix) console.log("cjk-punct: " + hits.length + " 处字串已改为全角标点");
  else if (hits.length) {
    for (const h of hits.slice(0, 40)) console.error("  " + h.file + ":" + h.line + "  「" + h.from.slice(0, 40) + "」");
    if (hits.length > 40) console.error("  …还有 " + (hits.length - 40) + " 处");
    console.error("FAIL: " + hits.length + " 处中文/日文字串使用了半角标点 —— node scripts/app/cjk-punct.mjs --fix");
    process.exit(1);
  } else console.log("ok: src/app 的中文与日文字串全部使用全角标点");
}
