/**
 * 关键时刻卡片的按需加载。
 *
 * v8-0-plan A4 + F5: the key-moments card (review/moments.js) is drawn only
 * once a game has been analysed, so it is a chunk (chunk-moments.js), not
 * part of the first paint — the main bundle stands at the F5 budget. This is
 * the stand-in app.js holds: the first render asks for the chunk and draws
 * nothing, and once the chunk is here the real card is made from the same
 * bag and draws at once; from then on every render is the card's own.
 * @module review/moments-lazy
 */
import { loadChunk } from "../chunk.js";
import { REVIEW_CHUNKS } from "../lazy-content.js";
import { ChessReviewGrade } from "../review-grade.js";

/**
 * @param {object} d the bag review/moments.js's createMoments() takes
 * @returns {{render: () => void}}
 */
export function createMomentsLazy(d) {
  const state = { real: null, asked: false };
  function render() {
    if (state.real) { state.real.render(); return; }
    // nothing to draw before an analysis exists: no chunk asked for either
    if (state.asked || !d.analysisFor()) return;
    state.asked = true;
    const { file, global } = REVIEW_CHUNKS.moments;
    loadChunk(file, global).then((create) => {
      state.real = create(Object.assign({ Grade: ChessReviewGrade }, d));
      state.real.render();
    }, () => { state.asked = false; });
  }
  return { render };
}
