/**
 * The entry of chunk-mined.js (scripts/bundle.mjs CHUNKS): the mined puzzles,
 * and the index of the imported Lichess puzzles with them.
 *
 * Both are read only by the puzzle trainer and the counts beside it, and
 * both arrive the same way (lazy-content.js: before the bundle when a
 * session starts in puzzle mode, right after the first paint otherwise). The
 * index is small, but the main bundle has no bytes to spare (v8-0-plan F5),
 * and a chunk already on its way costs no extra request. puzzle-db.js reads
 * LC_INDEX off the window once the chunk is here.
 * @module mined-chunk
 */
export { MINED_PUZZLES } from "./puzzles-mined.js";
export { LC_INDEX } from "./puzzles-lc-index.js";
