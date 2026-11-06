/**
 * The play page's dictionary for a language. Chinese only for now; a new
 * language is one more module and one more line here — no component changes.
 * @module text/play
 */
import { createText } from "../lib/text.js";
import page from "./play.zh.js";
import explain from "./explain.zh.js";

/** the explainer's sentences are every page's (text/explain.zh.js) */
const zh = { ...explain, ...page };

const DICTS = { zh };
export const playText = (lang = "zh") => createText(DICTS[lang] || zh, zh);
