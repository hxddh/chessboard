/**
 * 关于's door: the button, and the chunk that is the dialog's code
 * (about-ui.js, chunk-about.js) fetched the first time it is pressed.
 *
 * 21.0 E: 关于 is opened a few times in an app's life, and its 2 KB sat in
 * every first paint; 21.0's teaching changes needed that room under 19.0's
 * 827,000-byte line, which stays where it is.
 * @module about-lazy
 */
import { loadChunk } from "./chunk.js";

/**
 * @param {object} d the bag about-ui.js's wireAbout() takes
 * @returns {HTMLElement|null} the dialog (app.js registers it with Dlg's Escape)
 */
export function wireAboutLazy(d) {
  const doc = d.doc;
  const modal = doc.getElementById("about-modal");
  const btn = doc.getElementById("about-open");
  if (!modal || !btn) return modal;
  const state = { asked: null };
  btn.onclick = () => {
    if (state.asked) return;
    // wireAbout() puts its own handler on the button; this click is then its
    state.asked = loadChunk("chunk-about.js", "wireAbout").then((wire) => {
      wire(d);
      btn.onclick();
    }, () => { state.asked = null; });
  };
  return modal;
}
