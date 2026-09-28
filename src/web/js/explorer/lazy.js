/**
 * 开局浏览器在主包里的那一半 (v8-0-plan C3).
 *
 * The explorer is a chunk (chunk-explorer.js: the panel, the arithmetic, the
 * fast replay board and the master tree's index), because the main bundle
 * had ~3 KB left under F5's budget. What stays here is what must work before
 * the chunk is asked for: the 开局 key in the tool row, the library page's
 * door, whether the panel is open (kept in the settings, so a restart keeps
 * it), and a render that shows or hides the section. The first render with
 * the panel open fetches the chunk; from then on every render is the chunk's.
 * The book is handed over from here — openings.js is in the bundle already,
 * and importing it into the chunk would ship it twice.
 * @module explorer/lazy
 */
import { loadChunk } from "../chunk.js";
import { CHESS_OPENINGS } from "../openings.js";

/**
 * @param {object} d from app.js: doc, store, t, tf, viewGame, movePath,
 *   startClockIfIdle, toBoard, saveSettings, saved (the stored settings)
 */
export function createExplorerLazy(d) {
  const { doc, store } = d;
  const s = (d.saved && d.saved.explorer) || {};
  store.ui.explorer = { open: s.open === true, src: s.src === "master" ? "master" : "lib" };
  let ui = null, asked = false;
  function render() {
    const on = store.ui.explorer.open, sec = doc.getElementById("explorer");
    doc.getElementById("explorer-open").setAttribute("aria-pressed", on);
    // the play pane's notation, not a trainer's board, nor the editor's, nor 再试一次's
    const shown = on && /^(ai|pvp)$/.test(store.session.mode) && !store.session.editor && !store.session.retry;
    if (sec.hidden === shown) sec.hidden = !shown;
    if (!shown || ui) return ui && shown && ui.render();
    if (asked) return;
    asked = true;
    loadChunk("chunk-explorer.js", "createExplorerUI").then((create) => { ui = create(d, CHESS_OPENINGS); ui.render(); }, () => { asked = false; });
  }
  /** Open or close the panel (`open` to set it), and remember that. */
  function toggle(open) {
    store.ui.explorer.open = open === true || (open !== false && !store.ui.explorer.open);
    d.saveSettings();
    render();
  }
  doc.getElementById("explorer-open").addEventListener("click", () => toggle());
  // the library page's door: the board, with the panel open on it
  doc.getElementById("lib-explorer").addEventListener("click", () => { d.toBoard(); toggle(true); });
  for (const slice of ["game", "session", "ui"]) store.subscribe(slice, render);
}
