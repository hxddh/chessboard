/**
 * The interface language: which ones exist, the first-run guess, and the
 * words of the ones that are not Chinese — loaded with `import()` when chosen,
 * so the first paint carries Chinese only (ADR 0002 文案, v20-0-plan §6 S4).
 *
 *   await setLang("en")     fetch text/pack.en.js (and content/words.en.js) once, then make it current
 *   await loadWords()       the content's words for the current language (学 waits for them)
 *   getLang()               "zh" | "en" | "ja" — the language whose words are loaded and showing
 *   pack()                  the current pack ({ play, learn, explain, lines, items?, lessons? }), or null for Chinese
 *
 * A component never asks; text/play.js, text/learn.js, opponents/lines.js and
 * content/words.js read the pack for it. Changing the language re-mounts the
 * page (main.js), so nothing has to listen.
 * @module text/lang
 */

/** Every language, the Chinese source first. */
export const LANGS = ["zh", "en", "ja"];
/** Each language's name for itself, for the chooser. */
export const LANG_NAMES = { zh: "中文", en: "English", ja: "日本語" };
/** The html lang attribute. */
export const LANG_TAGS = { zh: "zh-CN", en: "en", ja: "ja" };

/** The best language for someone who has not chosen one, from the system's locales (19.0 lang-ids.js). */
export function systemLang(nav = typeof navigator !== "undefined" ? navigator : null) {
  const tags = nav ? [].concat(nav.languages || [], nav.language || []) : [];
  for (const raw of tags) {
    const base = String(raw || "").toLowerCase().split("-")[0];
    if (LANGS.includes(base)) return base;
  }
  return "zh";
}

const LOADERS = {
  en: { ui: () => import("./pack.en.js"), words: () => import("../content/words.en.js") },
  ja: { ui: () => import("./pack.ja.js"), words: () => import("../content/words.ja.js") },
};
const packs = {};
let current = "zh";

export const getLang = () => current;
export const pack = (lang = current) => packs[lang] || null;

/**
 * Fetch a language's interface (once) and make it current; with `words`
 * (the default) the content's words too. Resolves to the language now showing.
 */
export async function setLang(lang, { words = true } = {}) {
  if (!LANGS.includes(lang)) lang = "zh";
  if (lang !== "zh" && !packs[lang]) packs[lang] = { ...(await LOADERS[lang].ui()).default };
  if (words) await loadWords(lang);
  current = lang;
  return lang;
}

/** The content's words (lesson text, prompts) for a language — what 学 waits for before it mounts. */
export async function loadWords(lang = current) {
  if (lang === "zh" || (packs[lang] && packs[lang].items)) return;
  const [ui, w] = await Promise.all([packs[lang] || LOADERS[lang].ui().then((m) => m.default), LOADERS[lang].words()]);
  packs[lang] = { ...ui, items: w.ITEMS, lessons: w.LESSONS };
}

/** Tests: a pack put in directly (Node reads the modules without a bundler). */
export function usePack(lang, p) { packs[lang] = p; current = lang; }
