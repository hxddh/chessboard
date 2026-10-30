/**
 * 吃子条：两边名字旁边被吃掉的子，和领先一方的 +N。
 *
 * 14.0 E: moved out of app.js, body unchanged.
 * 16.0 V: drawn in the board's own set (pieceSrc), not always the 7.x one.
 * @module material-strip
 */
import { ChessMaterial } from "./material.js";
import { CHESS_PIECE_SVGS } from "./pieces.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createMaterialStrip(d) {
  const { doc, store, viewGame, verboseHistory, baseGame, pieceSrc } = d;

  /**
   * Captured pieces beside each name, and a `+N` on whoever is ahead.
   *
   * Follows the replay cursor rather than the live game: scrubbing back to
   * "where did it go wrong" and seeing the material as it stood at that move
   * is most of the point. In the puzzle and lesson modes the pieces on the
   * board are a constructed exercise, not a game's remains, so it stays empty.
   */
  function renderMaterial() {
    const wEl = doc.getElementById("taken-w");
    const bEl = doc.getElementById("taken-b");
    if (!wEl || !bEl) return;
    const off = store.session.mode === "learn" || store.session.mode === "puzzle" || !!store.session.editor;
    if (off) { wEl.replaceChildren(); bEl.replaceChildren(); delete wEl.dataset.sig; return; }
    const shown = viewGame();
    const promos = verboseHistory().slice(0, store.game.viewIndex)
      .filter((m) => m.promotion).map((m) => ({ color: m.color, promotion: m.promotion }));
    const s = ChessMaterial.summary(baseGame().board(), shown.board(), promos);
    const svgs = CHESS_PIECE_SVGS || {};
    // 16.0 V: the board's set when it is in; the 7.x drawing (in the bundle)
    // only while a chunked set is still on its way
    const src = (key) => (pieceSrc ? pieceSrc(key, 20) : "");
    const set = src("wp") ? store.ui.pieceSet : "";
    // Built as nodes rather than concatenated markup. The pieces are vendored
    // SVG text and the lead is a number, so nothing here was ever hostile —
    // but "build a string and hand it to the parser" is a habit, and the two
    // places it mattered (the move list, the history rows) learned it here.
    const strip = (parent, list, color, lead) => {
      const kids = [];
      let prevType = null;
      for (const tp of list) {
        const url = set && src(color + tp), svg = svgs[color + tp];
        if (!url && !svg) continue;
        const span = doc.createElement("span");
        // grouped by kind (7.7 §2): two pawns overlap like a pile, a knight
        // after them starts a new pile — see .taken-p.new-kind
        span.className = "taken-p" + (prevType && prevType !== tp ? " new-kind" : "");
        prevType = tp;
        if (url) {
          const img = doc.createElement("img");
          img.alt = "";
          img.src = url;
          span.append(img);
        } else {
          // the sprite set is our own file, not input — parsed once per piece
          span.insertAdjacentHTML("afterbegin", svg);
        }
        kids.push(span);
      }
      if (lead > 0) {
        const d = doc.createElement("span");
        d.className = "taken-diff";
        d.textContent = "+" + lead;
        kids.push(d);
      }
      parent.replaceChildren(...kids);
    };
    // White's row shows the black pieces White has taken. Rebuilt only when
    // the tally changed: this hears every game and session commit.
    const sig = s.w.join("") + "|" + s.b.join("") + "|" + s.diff + "|" + set;
    if (wEl.dataset.sig === sig) return;
    wEl.dataset.sig = sig;
    strip(wEl, s.w, "b", s.diff);
    strip(bEl, s.b, "w", -s.diff);
  }

  return { render: renderMaterial };
}
