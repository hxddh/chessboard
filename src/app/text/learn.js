/**
 * The dictionary of 学 and 我 for a language (ADR 0002 文案). Chinese only for
 * now; en and ja are one more module each, with the same keys.
 * @module text/learn
 */
import { createText } from "../lib/text.js";
import zh from "./learn.zh.js";

const DICTS = { zh };
export const learnText = (lang = "zh") => createText(DICTS[lang] || zh, zh);
