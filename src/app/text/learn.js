/**
 * The dictionary of 学 and 我 for a language (ADR 0002 文案): Chinese here,
 * English and Japanese in their pack (text/lang.js), with the same keys.
 * @module text/learn
 */
import { createText } from "../lib/text.js";
import { getLang, pack } from "./lang.js";
import page from "./learn.zh.js";
import explain from "./explain.zh.js";

/** the explainer's sentences are every page's (text/explain.zh.js) */
const zh = { ...explain, ...page };

export const learnText = (lang = getLang()) => {
  const p = lang !== "zh" && pack(lang);
  return createText(p ? { ...p.explain, ...p.learn } : zh, zh, { lang: p ? lang : "zh" });
};
