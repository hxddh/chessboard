/**
 * The play page's dictionary for a language: Chinese is here; English and
 * Japanese come with their pack (text/lang.js), loaded when chosen. A
 * missing key falls back to the Chinese (scripts/app/text.test.mjs keeps
 * every key in all three).
 * @module text/play
 */
import { createText } from "../lib/text.js";
import { getLang, pack } from "./lang.js";
import page from "./play.zh.js";
import explain from "./explain.zh.js";

/** the explainer's sentences are every page's (text/explain.zh.js) */
const zh = { ...explain, ...page };

export const playText = (lang = getLang()) => {
  const p = lang !== "zh" && pack(lang);
  return createText(p ? { ...p.explain, ...p.play } : zh, zh);
};
