/**
 * The play page's dictionary for a language. Chinese only for now; a new
 * language is one more module and one more line here — no component changes.
 * @module text/play
 */
import { createText } from "../lib/text.js";
import zh from "./play.zh.js";

const DICTS = { zh };
export const playText = (lang = "zh") => createText(DICTS[lang] || zh, zh);
