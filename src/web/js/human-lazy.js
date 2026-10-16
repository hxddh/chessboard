/**
 * The way to chunk-human.js (13.0 H): the Maia worker, made the first time a
 * Maia rung plays or the 「人会怎么走」 line asks (engine.js, review).
 * @module human-lazy
 */
import { loadChunk } from "./chunk.js";

let made = null;
/** @returns {Promise<{load: Function, policy: Function, BANDS: number[]}>} */
export function humanEngine() {
  if (!made) {
    made = loadChunk("chunk-human.js", "CHESS_HUMAN").then((m) => m.createHuman({ loadChunk, global: globalThis }));
    made.catch(() => { made = null; });
  }
  return made;
}
