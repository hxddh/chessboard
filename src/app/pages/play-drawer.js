/**
 * The move list as a drawer beside the board (closed by default): one row
 * per move, appended as the game goes; a row clicked shows that position.
 * After the review the same list is the full report — each move once, with
 * its grade, the turning points marked — under one accuracy figure.
 * @module pages/play-drawer
 */
import { h } from "../lib/dom.js";
import { sanNode } from "../lib/notation.js";

/**
 * @param {object} o
 * @param {Function} o.t
 * @param {(index: number) => void} o.onPick   position index (after move i is i + 1)
 * @param {(dir: -1|1) => void} o.onStep
 * @param {() => void} o.onCopy
 * @param {() => void} [o.onFlip]  翻转 (also the F key)
 */
export function createDrawer({ t, onPick, onStep, onCopy, onFlip = () => {} }) {
  const list = h("ol", { class: "moves", "data-test": "moves" });
  const head = h("p", { class: "drawer-head", "data-test": "report-head" });
  const el = h("aside", { class: "drawer", "data-test": "drawer", hidden: true, "aria-label": t("drawer.title") },
    head, list,
    h("div", { class: "drawer-nav" },
      h("button", { type: "button", "data-test": "prev", "aria-label": t("drawer.prev"), onclick: () => onStep(-1) }, "‹"),
      h("button", { type: "button", "data-test": "next", "aria-label": t("drawer.next"), onclick: () => onStep(1) }, "›"),
      h("button", { type: "button", "data-test": "copy", class: "quiet", onclick: onCopy }, t("report.copy")),
      h("button", { type: "button", "data-test": "flip", class: "quiet", title: t("act.flipKey"), onclick: onFlip }, t("act.flip"))));
  list.addEventListener("click", (e) => {
    const li = e.target.closest("li[data-ply]");
    if (li) onPick(Number(li.dataset.ply) + 1);
  });

  let shown = [], shownId = null, cursor = null;
  /** The game's moves; rebuilt only when it is another game or moves were taken back. */
  function setMoves(moves, gameId) {
    const append = gameId === shownId && moves.length >= shown.length && shown.every((m, i) => m === moves[i]);
    if (!append) list.replaceChildren();
    for (let i = append ? shown.length : 0; i < moves.length; i++) {
      const side = i % 2 === 0 ? "w" : "b";
      list.append(h("li", { "data-ply": i, "data-side": side },
        i % 2 === 0 ? h("span", { class: "no", text: (i / 2 + 1) + "." }) : null,
        h("span", { class: "san" }, sanNode(moves[i].san)),
        h("span", { class: "mark" })));
    }
    shown = moves; shownId = gameId;
    setCursor(cursor);
  }

  /** The row of the position on the board (index after move i is i + 1), or none. */
  function setCursor(index) {
    cursor = index;
    for (const li of list.querySelectorAll("li[aria-current]")) li.removeAttribute("aria-current");
    if (index != null && index > 0) {
      const li = list.children[index - 1];
      if (li) { li.setAttribute("aria-current", "true"); if (!el.hidden) li.scrollIntoView({ block: "nearest" }); }
    }
  }

  /** The review's grades on the rows, and the accuracy above them; null clears. */
  function setReport(rep, you) {
    head.textContent = "";
    for (const li of list.children) { li.querySelector(".mark").textContent = ""; li.className = ""; li.removeAttribute("title"); }
    if (!rep) return;
    const acc = you && rep.accuracy[you] != null ? Math.round(rep.accuracy[you]) : null;
    head.textContent = t("report.title") + (acc != null ? " · " + t("report.accuracy", acc) : "");
    for (const r of rep.rows) {
      const li = list.children[r.ply];
      if (!li) continue;
      li.querySelector(".mark").textContent = r.mark;
      li.className = (r.grade ? "g-" + r.grade : "") + (r.moment ? " moment" : "");
      if (r.grade) li.title = t("grade." + r.grade);
    }
  }

  return { el, setMoves, setCursor, setReport, get open() { return !el.hidden; }, set open(v) { el.hidden = !v; } };
}
