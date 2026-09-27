/**
 * Entry of js/chunk-lang-en.js: everything English, in one on-demand script
 * (v8-0-plan F5). The interface dictionary and the words of the teaching
 * content — lessons, puzzle names, opening names and ideas, the classics.
 * Chinese is the source and stays in the bundle; this is only words.
 *
 * Nothing in app.js's import graph may import this or the files it names:
 * scripts/bundle.mjs builds it alone, and test-chess.mjs checks its payload is
 * not also inside bundle.js.
 * @module lang-en
 */
export { CHESS_I18N_EN } from "./i18n-en.js";
export { CHESS_LESSONS_EN } from "./lessons-en.js";
export { CHESS_PUZZLES_EN } from "./puzzles-en.js";
export { CHESS_OPENINGS_EN, CHESS_OPENING_IDEAS_EN } from "./openings-en.js";
export { CHESS_CLASSICS_EN } from "./classics-en.js";
