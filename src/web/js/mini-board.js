/**
 * 小棋盘：一个局面的静态图，用在「今天」页的卡片上（9.0 S1）。
 *
 * Sixty-four cells in a CSS grid, coloured by the board's own custom
 * properties (--sq-light / --sq-dark / --sq-last resolve on the page root,
 * whatever board the player chose) and the men drawn with the current piece
 * set (board.js pieceSrc). Nothing here moves or listens: a card's board is
 * a picture of what one click on the card opens.
 *
 * `paintMini` writes only when the position, the last move, the side at the
 * bottom or the piece set changed, so a page that repaints on every commit
 * does not rebuild 64 cells each time (7.6: nothing rebuilt under a press).
 * @module mini-board
 */

const FILES = "abcdefgh";

/** The men of a FEN's board field, square → "wq"-style key. */
function menOf(fen) {
  const out = new Map();
  const rows = String(fen || "").split(" ")[0].split("/");
  if (rows.length !== 8) return out;
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) {
      if (/\d/.test(ch)) { f += Number(ch); continue; }
      const key = (ch === ch.toUpperCase() ? "w" : "b") + ch.toLowerCase();
      out.set(FILES[f] + (8 - r), key);
      f++;
    }
  });
  return out;
}

/**
 * Draw `fen` into `el` (an element with the .mini-board class).
 * @param {HTMLElement} el
 * @param {string} fen
 * @param {{last?: string, flip?: boolean, pieceSrc: (key: string) => string, set?: string}} opts
 *   `last` is a UCI-ish "e2e4" (from and to squares lit), `set` names the
 *   piece set so a change of set repaints
 */
export function paintMini(el, fen, opts) {
  if (!el) return;
  const o = opts || {};
  const sig = [fen, o.last || "", o.flip ? "b" : "w", o.set || ""].join("|");
  if (el.dataset.sig === sig) return;
  el.dataset.sig = sig;
  const men = menOf(fen);
  const lit = new Set(o.last ? [o.last.slice(0, 2), o.last.slice(2, 4)] : []);
  const cells = [];
  for (let sr = 0; sr < 8; sr++) {
    for (let sc = 0; sc < 8; sc++) {
      const file = o.flip ? 7 - sc : sc;
      const rank = o.flip ? sr + 1 : 8 - sr;
      const sq = FILES[file] + rank;
      const cell = document.createElement("span");
      cell.className = "mini-sq " + ((file + rank) % 2 ? "d" : "l") + (lit.has(sq) ? " last" : "");
      const key = men.get(sq);
      if (key) {
        const img = document.createElement("img");
        img.alt = "";
        img.src = o.pieceSrc(key);
        cell.appendChild(img);
      }
      cells.push(cell);
    }
  }
  el.replaceChildren(...cells);
}

export const ChessMiniBoard = { paintMini, menOf };
