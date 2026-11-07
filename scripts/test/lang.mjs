/**
 * The content languages and the scanners every translated table is held to:
 * what "untranslated" means per language, and the three corpus-level checks
 * on a Japanese table. Shared by the course, the puzzle set and the i18n
 * guards (scripts/test/content.mjs, i18n-ui.mjs).
 */
import { assert, ctx, loadModule } from "./harness.mjs";

/** every interface language but zh-CN; set by initLanguages() */
export let CONTENT_LANGS = [];
/** load i18n.js (and the dictionaries with it), then read the languages off it */
export function initLanguages() {
  loadModule(ctx, "src/web/js/i18n.js");
  // Every interface language other than the Chinese source needs content of its
  // own. Through 1.20 this was hard-coded to English, which is precisely how ja
  // ended up with a 589-key interface — not one key missing — wrapped around
  // English lessons: the guard enforced trilingual chrome and bilingual
  // teaching, and the gap it left is exactly the gap that existed.
  CONTENT_LANGS = Object.keys(ctx.ChessI18n.DICT).filter((l) => l !== "zh-CN");
  assert(CONTENT_LANGS.length >= 2, "there is more than one content language (" + CONTENT_LANGS.join(", ") + ")");
}
/** the global suffix a language's tables use: en → _EN, ja → _JA */
export const sfx = (lang) => lang.toUpperCase().replace(/-/g, "_");
export const han = /[一-鿿]/;
export const kana = /[぀-ヿ]/;
/**
 * "Still untranslated" reads differently per language. English must contain
 * no Han at all. Japanese *writes* in Han, so the same test would be nonsense;
 * there the precise signal is a string left character-for-character identical
 * to the Chinese original.
 *
 * The first version of this also flagged any Han-without-kana string, on the
 * theory that natural Japanese prose always carries some kana. It does — but
 * short LABELS need not: "実戦 01" is perfectly good Japanese and was reported
 * as untranslated. The per-string rule is now exact, and the kana heuristic
 * moved to `kanaRatio` below, where it is applied to the corpus rather than to
 * individual strings.
 */
export const untranslated = (lang, str, source) => {
  if (typeof str !== "string" || !str) return false;
  if (lang === "ja") return str === source;
  return han.test(str);
};
/** share of a language's strings that carry kana — a corpus-level smell test */
export function kanaRatio(root) {
  let total = 0, withKana = 0;
  const walk = (v) => {
    if (typeof v === "string") { if (v.trim()) { total++; if (kana.test(v)) withKana++; } return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
  };
  walk(root);
  return total ? withKana / total : 1;
}

// ---------------------------------------------------------- Japanese scanners
// These were written for lessons-ja and lived inside that loop, which is why
// openings-ja and puzzles-ja — 452 more strings, added in 1.21 — were never
// scanned at all. They were clean when this was hoisted, which is the only
// reason nothing was found; a corpus nobody scans stays clean by luck.

/**
 * Latin runs that are legitimate inside Japanese chess prose: SAN moves, file
 * letters, roman numerals, a few UI keys and abbreviations. Opening ideas also
 * chain moves with hyphens and plus signs ("d4-Nf3-Bf4-e3", "c4+e4"), so a
 * token is legitimate when every piece of it is.
 */
export const NOTATION = /^(?:[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?|[A-Za-z]|I{1,3}|IV|VI{0,3}|Ctrl(?:\+Z)?|ECO|QGD)$/;
export const notation = (word) => word.split(/[-+]/).filter(Boolean).every((part) => NOTATION.test(part));

/**
 * Scripts Japanese text legitimately uses, plus the punctuation and symbols the
 * prose actually carries: the multiplication sign in "8×8", the Command glyph,
 * "≠", arrows, em dashes.
 */
export const JA_OK = /[　-〿぀-ヿ一-鿿＀-￯ -~‐-‧‰-⁞←-⇿①-⓿■-⛿×≠⌘–—]/;

/** walk every string in a nested value, reporting `path: string` positions */
export function eachString(root, where, fn) {
  const walk = (v, p) => {
    if (typeof v === "string") return fn(v, p);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + "[" + i + "]"));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, p + "." + k));
  };
  walk(root, where);
}

/**
 * The three corpus-level checks on a Japanese table: it reads as Japanese, no
 * loose English drifted into the prose, and no third script leaked in.
 *
 * `kanaMin` is per-corpus because kana density is a property of what the table
 * holds, not of the language. Prose is ~100%; a table of short labels is not,
 * and puzzles-ja is 87% purely because "実戦 01"–"実戦 23" are kanji and digits.
 * That is the same fact this file already records above `untranslated` — the
 * threshold states it rather than being tuned until it passes.
 */
export function checkJapanese(label, table, kanaMin, minStrings) {
  // An empty table passes every check below — kanaRatio returns 1, and neither
  // scan has anything to walk. That is how a renamed global would turn this
  // into three lines of `ok` guarding nothing, so count first.
  let strings = 0;
  eachString(table, label, (v) => { if (v.trim()) strings++; });
  assert(strings >= minStrings, label + ": found " + strings + " strings, expected at least " + minStrings);

  const ratio = kanaRatio(table);
  assert(ratio >= kanaMin, label + " reads as Japanese (kana in " + Math.round(ratio * 100) + "% of strings, floor " + Math.round(kanaMin * 100) + "%)");

  let latin = 0;
  eachString(table, label, (v, where) => {
    for (const w of v.match(/[A-Za-z][A-Za-z0-9=+#-]*/g) || []) {
      if (notation(w)) continue;
      latin++;
      console.error("FAIL: stray English word in " + where + ": " + w);
    }
  });
  assert(latin === 0, label + " carries no stray English words");

  let alien = 0;
  eachString(table, label, (v, where) => {
    for (const ch of v) {
      if (JA_OK.test(ch)) continue;
      alien++;
      console.error("FAIL: character outside Japanese scripts in " + where + ": " + ch +
        " (U+" + ch.codePointAt(0).toString(16).toUpperCase() + ")");
    }
  });
  assert(alien === 0, label + " uses only Japanese scripts");
}
