/**
 * The entry of chunk-classics-more.js (scripts/bundle.mjs CHUNKS): the thirty
 * further classics of v8-4-plan T2 — the Chinese source with its era groups,
 * and both translations, so a language switch needs no second fetch.
 * trainer/classics-more.js loads it and appends the games to the catalog.
 * @module classics-more-chunk
 */
import { CHESS_CLASSICS_MORE_ZH } from "./classics-more.js";
import { CHESS_CLASSICS_MORE_EN } from "./classics-more-en.js";
import { CHESS_CLASSICS_MORE_JA } from "./classics-more-ja.js";

export const CHESS_CLASSICS_MORE = {
  groups: CHESS_CLASSICS_MORE_ZH.groups, games: CHESS_CLASSICS_MORE_ZH.games,
  en: CHESS_CLASSICS_MORE_EN, ja: CHESS_CLASSICS_MORE_JA,
};
