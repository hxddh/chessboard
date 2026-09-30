/**
 * The entry of chunk-lessons-adv.js (scripts/bundle.mjs CHUNKS): the advanced
 * course part 3 (v8-2-plan T1) — the Chinese source and both translations,
 * so a language switch needs no second fetch. trainer/lessons-adv.js loads
 * it; lazy-content.js hands the words of `en` / `ja` to the lookup.
 * @module lessons-adv-chunk
 */
import { CHESS_LESSONS_ADV_ZH } from "./lessons-adv.js";
import { CHESS_LESSONS_ADV_EN } from "./lessons-adv-en.js";
import { CHESS_LESSONS_ADV_JA } from "./lessons-adv-ja.js";

export const CHESS_LESSONS_ADV = { lessons: CHESS_LESSONS_ADV_ZH, en: CHESS_LESSONS_ADV_EN, ja: CHESS_LESSONS_ADV_JA };
