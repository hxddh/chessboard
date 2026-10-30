/**
 * 15.0 P: the Chinese names of lichess's opening families and their most
 * frequent variation segments, as one chunk (scripts/bundle.mjs,
 * chunk-opnames-zh.js). They name what the ECO table (chunk-eco.js) or a
 * PGN's Opening header names in English, so they arrive with the table —
 * eco-lookup.js asks for both at once — not before every first paint.
 * @module opnames-zh-chunk
 */
export { OPENING_FAMILIES_ZH } from "./openings-family-zh.js";
export { OPENING_VARIATIONS_ZH } from "./openings-variation-zh.js";
