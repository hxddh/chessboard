/**
 * Full-width punctuation in the Chinese and Japanese copy.
 *
 * 「从白方视角看:横排叫「横线」,由近到远编号 1–8;竖排叫「直线」」 — the
 * teaching text, the interface dictionary and the puzzle names were written
 * with ASCII `, ; : ( )` between CJK characters. A Chinese reader registers
 * that before anything else on the screen: it is the single cheapest signal
 * of "not finished". It is also the single cheapest thing to fix once and
 * keep fixed, which is what this script is (audit, 5.1 work package F).
 *
 * What it touches: string LITERALS in the listed source files, and only the
 * ones that contain a CJK character. Comments, keys, code and every literal
 * without CJK in it are left exactly as they are. Inside a qualifying literal
 * `, ; : ( )` become their full-width forms; `?` and `!` do too, but only
 * directly after a CJK character — `?!` `?` `??` are this app's move marks
 * and appear in prose, always after a space. A colon between two digits
 * (5:00) is a time and stays.
 *
 *   node scripts/cjk-punct.mjs --check   exit 1 and list the offenders
 *   node scripts/cjk-punct.mjs --fix     rewrite the files in place
 *
 * test-chess.mjs runs the check, so the rule outlives whoever remembers it.
 * @module cjk-punct
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** Files whose Chinese or Japanese literals are user-facing copy. */
export const FILES = [
  "src/web/js/i18n.js",
  "src/web/js/lessons.js", "src/web/js/lessons-ja.js",
  "src/web/js/puzzles.js", "src/web/js/puzzles-ja.js",
  "src/web/js/openings.js", "src/web/js/openings-ja.js",
];

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿ｦ-ﾟ]/;
const MAP = { ",": "，", ";": "；", ":": "：", "(": "（", ")": "）", "?": "？", "!": "！" };
const ASCII = /[,;:()?!]/g;

/** Convert one literal's contents (without its quotes). */
export function fixLiteral(text) {
  if (!CJK.test(text)) return text;
  return text.replace(ASCII, (ch, i) => {
    const prev = text[i - 1] || "", next = text[i + 1] || "";
    // A colon that separates two digits is a time or a ratio (5:00), not prose.
    if (ch === ":" && /\d/.test(prev) && /\d/.test(next)) return ch;
    // ? and ! are also this app's move marks (?! ? ??). Only the one that ends
    // a CJK sentence — directly after a CJK character — is punctuation.
    if ((ch === "?" || ch === "!") && !CJK.test(prev)) return ch;
    return MAP[ch];
  });
}

/**
 * Walk a JS source, rewriting string literals through `fixLiteral` and
 * leaving everything else untouched. Template literals are handled as plain
 * strings (these files use none with `${}`); comments and regex literals are
 * skipped by the simplest adequate rule — a `/` that follows an operator or
 * an opening bracket starts a regex.
 * @returns {{src: string, hits: Array<{line: number, from: string, to: string}>}}
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
  while (i < n) {
    const c = src[i];
    if (c === "\n") line++;
    // comments
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); const end = e < 0 ? n : e; out += src.slice(i, end); i = end; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); const end = e < 0 ? n : e + 2; line += (src.slice(i, end).match(/\n/g) || []).length; out += src.slice(i, end); i = end; continue; }
    // regex literal
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
    // strings
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < n && src[j] !== c) { if (src[j] === "\\") j++; if (src[j] === "\n") line++; j++; }
      const body = src.slice(i + 1, j);
      const fixed = fixLiteral(body);
      if (fixed !== body) hits.push({ line, from: body, to: fixed });
      out += c + fixed + c; i = j + 1; continue;
    }
    out += c; i++;
  }
  return { src: out, hits };
}

/** @returns {Array<{file: string, line: number, from: string, to: string}>} */
export function scan(fix) {
  const all = [];
  for (const rel of FILES) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const src = fs.readFileSync(abs, "utf8");
    const { src: next, hits } = transform(src);
    for (const h of hits) all.push(Object.assign({ file: rel }, h));
    if (fix && next !== src) fs.writeFileSync(abs, next);
  }
  return all;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const fix = process.argv.includes("--fix");
  const hits = scan(fix);
  if (fix) {
    console.log(`cjk-punct: ${hits.length} 处字串已改为全角标点`);
  } else if (hits.length) {
    for (const h of hits.slice(0, 40)) console.error(`  ${h.file}:${h.line}  「${h.from.slice(0, 40)}」`);
    if (hits.length > 40) console.error(`  …还有 ${hits.length - 40} 处`);
    console.error(`FAIL: ${hits.length} 处中文/日文字串使用了半角标点 —— node scripts/cjk-punct.mjs --fix`);
    process.exit(1);
  } else {
    console.log("ok: 中文与日文字串全部使用全角标点");
  }
}
