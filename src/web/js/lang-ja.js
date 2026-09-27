/**
 * Entry of js/chunk-lang-ja.js: everything Japanese, in one on-demand script
 * (v8-0-plan F5) — see lang-en.js. Japanese also reads English as the bridge
 * for any sentence not yet translated (app.js contentTables), so a Japanese
 * session loads chunk-lang-en.js as well; lazy-content.js LANG_CHUNKS says so.
 *
 * The opening family and variation names used to sit in the bundle because
 * they are small; they are Japanese-only words all the same, and live here.
 * @module lang-ja
 */
export { CHESS_I18N_JA } from "./i18n-ja.js";
export { CHESS_LESSONS_JA } from "./lessons-ja.js";
export { CHESS_PUZZLES_JA } from "./puzzles-ja.js";
export { CHESS_OPENINGS_JA, CHESS_OPENING_IDEAS_JA } from "./openings-ja.js";
export { CHESS_CLASSICS_JA } from "./classics-ja.js";
export { OPENING_FAMILIES_JA } from "./openings-family-ja.js";
export { OPENING_VARIATIONS_JA } from "./openings-variation-ja.js";
