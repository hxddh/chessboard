/**
 * 看 N 步后与盲走收官的外壳（v8-2-plan T2）。
 *
 * The two modes are js/chunk-visual.js (trainer/visual-modes.js), fetched the
 * first time one is started or 「我的」 has a record of them to draw; this is
 * what the bundle keeps (F1: content and its code in a chunk, the door here).
 * trainer/puzzles.js creates it beside the modes and hands it the trainer's
 * pieces; puzzle-modes.js startRun asks it for a set of either kind.
 *
 * A set is drawn from the book with the mined puzzles in it, so the mined
 * chunk is waited for too: the same seed has to find the same book.
 * @module trainer/visual
 */
import { loadChunk } from "../chunk.js";
import { ChessLazy } from "../lazy-content.js";

/** chunk file and global — scripts/bundle.mjs builds visual-modes.js into it */
export const VIS_CHUNK = { file: "chunk-visual.js", global: "CHESS_VISUAL" };
/** the run kinds that are this module's (puzzle-modes.js startRun) */
export const VIS_KINDS = ["look", "blind"];

/**
 * @param {object} d trainer/puzzles.js's bag (see visual-modes.js createVisualModes)
 */
export function createVisual(d) {
  const box = { asked: null };
  function ensure() {
    if (!box.asked) {
      box.asked = Promise.all([loadChunk(VIS_CHUNK.file, VIS_CHUNK.global), ChessLazy.ensureMined().catch(() => null)])
        .then(([m]) => m.createVisualModes({ ...d, mined: ChessLazy.mined }));
      box.asked.catch(() => { box.asked = null; }); // a failed load is tried again next time
    }
    return box.asked;
  }
  return {
    /** A new set of `kind`, or null when the chunk cannot be had. */
    make: (kind) => ensure().then((m) => m.make(kind), () => { d.toast(d.t("theme.loadFailed"), "fix"); return null; }),
    /** 「我的」: the section, once there is anything to show in it. */
    renderMe() {
      const sec = document.getElementById("sec-vis");
      if (sec && !d.store.session.puzzleState.vis) sec.hidden = true;
      else if (sec) ensure().then((m) => m.renderMe(), () => {});
    },
  };
}
