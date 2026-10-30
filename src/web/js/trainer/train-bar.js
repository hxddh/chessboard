/**
 * 15.0 S3: a lesson or a puzzle with the panel shut still says what to do,
 * and what comes next.
 *
 * Up to 14.0 the panel held all of it: the task, whether the move was right,
 * 下一课 / 下一题. Shut it and the board went quiet; only a lesson kept a line
 * of small type over the board (the task strip). This bar takes the bottom
 * strip's place under the board, the shape the game's result bar has
 * (game-end.js, .go-card): a mark, the task or the verdict, and the one next
 * step, which is the panel's own button pressed for you.
 *
 * The stylesheet decides when it shows (the panel shut, or a narrow window
 * where the panel is a sheet); this only fills it.
 * @module trainer/train-bar
 */

/**
 * @param {object} d what it borrows from app.js
 */
export function createTrainBar(d) {
  const { doc, store, appEl, setIcon, learnTaskText } = d;
  const $ = (id) => doc.getElementById(id);
  const put = (node, s) => { if (node && node.textContent !== s) node.textContent = s; };
  const shown = (b) => !!b && !b.hidden && !b.disabled;

  /** The bar's content: the mark, two lines, and which panel button is next. */
  function read() {
    const s = store.session;
    if (s.editor) return null;
    if (s.mode === "learn" && s.learn) {
      const L = s.learn;
      const n = ($("lesson-dots") || { children: [] }).children.length;
      return {
        mark: L.done ? "check" : n > 1 ? Math.min(L.ti + 1, n) + "/" + n : "",
        ok: L.done ? true : null,
        head: learnTaskText(), sub: "",
        next: L.done ? "lesson-next" : null,
      };
    }
    if (s.mode === "puzzle" && s.puzzle && $("pz-run").hidden && $("pz-vis").hidden) {
      const P = s.puzzle, fb = P.fb;
      return {
        mark: fb ? (fb.ok ? "check" : "x") : "",
        ok: fb ? fb.ok : null,
        head: fb ? fb.head : P.done ? $("puzzle-task").textContent : $("puzzle-task").dataset.goal || "", sub: fb ? fb.sub || "" : "",
        // solved or given up: the next one; a miss with the question still
        // open: the way to the answer, as the feedback card offers it
        next: P.done ? "puzzle-next" : fb && !fb.ok ? "puzzle-fb-hint" : null,
      };
    }
    return null;
  }

  function sync() {
    const bar = $("tr-bar");
    if (!bar) return;
    const r = read();
    appEl.classList.toggle("has-task", !!r);
    if (!r) return;
    const mark = $("tr-mark");
    if (mark) {
      mark.hidden = !r.mark;
      if (r.mark === "check" || r.mark === "x") setIcon(mark, r.mark);
      else put(mark, r.mark);
    }
    bar.classList.toggle("won", r.ok === true);
    bar.classList.toggle("miss", r.ok === false);
    put($("tr-head"), r.head);
    const sub = $("tr-sub");
    put(sub, r.sub);
    if (sub) sub.hidden = !r.sub;
    const go = $("tr-next"), target = r.next && $(r.next);
    if (go) {
      go.hidden = !shown(target);
      if (shown(target)) { put(go, target.textContent.trim()); go.dataset.for = r.next; }
    }
  }

  function wire() {
    const go = $("tr-next");
    if (go) go.onclick = () => { const b = go.dataset.for && $(go.dataset.for); if (b) b.click(); };
  }

  return { sync, wire };
}
