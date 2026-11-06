/**
 * The dictionary of 学 and 我 for a language (ADR 0002 文案). Chinese only for
 * now; en and ja are one more module each, with the same keys.
 * @module text/learn
 */
import { createText } from "../lib/text.js";
import page from "./learn.zh.js";
import explain from "./explain.zh.js";

/** the explainer's sentences are every page's (text/explain.zh.js) */
const zh = { ...explain, ...page };

const DICTS = { zh };
export const learnText = (lang = "zh") => createText(DICTS[lang] || zh, zh);
