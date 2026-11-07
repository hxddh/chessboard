/**
 * The interface languages, by id, and the first-run guess among them.
 *
 * Split out of i18n.js by v8-0-plan F5: the English and Japanese dictionaries
 * are chunks now, so "which languages exist" can no longer be read off the
 * keys of the dictionary table — two of them are usually not loaded. And
 * chunk-boot.js has to make the same first-run guess i18n.js makes, before
 * the bundle is even parsed, without pulling a dictionary in to do it.
 * @module lang-ids
 */

  /** Every interface language, the Chinese source first. */
  export const LANG_IDS = ["zh-CN", "en", "ja"];
  /** The source language, and what anything unknown falls back to. */
  export const FALLBACK_LANG = "zh-CN";
  /**
   * Each language's name for itself, for the picker — which lists every
   * language whether or not its dictionary is here yet. test-chess.mjs holds
   * these equal to each dictionary's own `lang.name`.
   */
  export const LANG_NAMES = { "zh-CN": "中文", en: "English", ja: "日本語" };

  /**
   * Best language for someone who has never set one, from the OS/browser
   * locale. Only consulted on a first run — a stored preference always wins,
   * so nobody's explicit choice can be overridden by their system settings.
   *
   * Without this, 1.6's translation work was unreachable: the app booted in
   * Chinese for everyone, including the first-run dialog that decides whether
   * a newcomer sees the course at all.
   */
  export function detectLang(nav) {
    const src = nav || (typeof navigator !== "undefined" ? navigator : null);
    if (!src) return FALLBACK_LANG;
    const tags = [].concat(src.languages || [], src.language || []);
    for (const raw of tags) {
      const tag = String(raw || "").toLowerCase();
      if (!tag) continue;
      if (tag.startsWith("zh")) return "zh-CN";
      const base = tag.split("-")[0];
      if (LANG_IDS.includes(base)) return base;
      const exact = LANG_IDS.find((id) => id.toLowerCase() === tag);
      if (exact) return exact;
    }
    return FALLBACK_LANG;
  }
