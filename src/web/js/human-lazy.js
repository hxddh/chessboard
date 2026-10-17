/**
 * The way to chunk-human.js (13.0 H): the Maia worker, made the first time a
 * Maia rung plays or the 「人会怎么走」 line asks (engine.js, review).
 * @module human-lazy
 */
import { loadChunk } from "./chunk.js";
// 14.0 A3: a Maia net is a long task: the line waits for the launch's quiet
import { quietLeft } from "./quiet.js";

let made = null;
/** @returns {Promise<{load: Function, policy: Function, BANDS: number[]}>} */
export function humanEngine() {
  if (!made) {
    made = loadChunk("chunk-human.js", "CHESS_HUMAN").then((m) => m.createHuman({ loadChunk, global: globalThis }));
    made.catch(() => { made = null; });
  }
  return made;
}

/**
 * 13.0 I: the stand-in for review/human-line.js (in chunk-human.js) — the
 * moments-lazy.js shape. Nothing is asked for until the line is wanted (a
 * review or the analysis board, the setting on); until the chunk is here
 * the line stays hidden, and from then on every sync is the real one's.
 * @param {object} d review/human-line.js's bag, less Chess and the engine
 * @returns {{sync: () => void}}
 */
export function createHumanLineLazy(d) {
  const state = { real: null, asked: false, later: false };
  function sync() {
    if (state.real) { state.real.sync(); return; }
    const box = d.doc.getElementById("human-line");
    if (box) box.hidden = true;
    if (state.asked || d.store.ui.humanLine === false || !(d.store.session.analysisBoard || d.analysisFor())) return;
    // a launch onto a reviewed game: the line comes once the launch is quiet
    if (quietLeft() > 0) {
      if (!state.later) { state.later = true; setTimeout(() => { state.later = false; sync(); }, quietLeft()); }
      return;
    }
    state.asked = true;
    loadChunk("chunk-human.js", "CHESS_HUMAN").then((m) => {
      state.real = m.createHumanLine(Object.assign({ engine: humanEngine }, d));
      state.real.sync();
    }, () => { state.asked = false; });
  }
  return { sync };
}
