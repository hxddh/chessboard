/**
 * ⌘K's door: the key, and the chunk that is the panel (palette.js,
 * chunk-palette.js) fetched the first time it is pressed (v10-0-plan A3).
 * @module palette-lazy
 */
import { loadChunk } from "./chunk.js";

/**
 * @param {object} d the bag palette.js's createPalette() takes
 * @returns {{open: () => void, close: () => void}}
 */
export function createPaletteLazy(d) {
  let real = null, asked = null;
  function open() {
    if (real) { real.open(); return; }
    if (!asked) {
      asked = loadChunk("chunk-palette.js", "createPalette").then((create) => {
        real = create(d);
        real.open();
      }, () => { asked = null; });
    }
  }
  function close() { if (real) real.close(); }
  return { open, close };
}
