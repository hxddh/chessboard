/**
 * Labels side by side: 「白方走 · 将军！」, 「第 3 题 · 将杀」.
 *
 * v8-2-plan F4: interface text is never glued together with `+` — a sentence
 * is one key with placeholders, read with tf() (i18n.js). What is left is
 * putting whole labels next to each other, and that goes through here, so
 * the separator is a word of the language ("ui.dot") rather than a " · "
 * typed at forty call sites. Parts that are "", null, undefined or false drop
 * out, which is what every `cond ? " · " + x : ""` used to spell by hand.
 *
 * Its own module because the key check in test-chess.mjs reads every module
 * but the dictionaries for the keys in use; i18n.js is one of them. Modules
 * in the bundle import it; the on-demand chunks get it in their bag (`d.tdot`)
 * — importing it would put i18n.js and its dictionary into the chunk too.
 * @module tdot
 */
import { ChessI18n } from "./i18n.js";

/** @param {...*} parts */
export function tdot(...parts) {
  return parts.filter((p) => p !== "" && p != null && p !== false).join(ChessI18n.t("ui.dot"));
}
