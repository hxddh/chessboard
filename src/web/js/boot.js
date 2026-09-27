/**
 * Entry of js/chunk-boot.js — the one script index.html runs before
 * bundle.js (v8-0-plan F5).
 *
 * Its job is to put the chunks the first frame needs on the page before the
 * bundle runs, so the bundle finds them synchronously: the saved language's
 * dictionary and content, and — when the session resumes in puzzle mode, or
 * with the Merida pieces — those too (lazy-content.js bootPlan decides).
 *
 * `document.write` is what makes that synchronous: a script written by a
 * parser-blocking script is inserted right after it, ahead of bundle.js, and
 * runs before it. That is the only way to load a script from a script and
 * still run before the next tag — zero:// cannot fetch, and the CSP allows
 * only 'self' scripts, which these are. An inserted <script> element would
 * run after the bundle had already drawn its first, Chinese, frame.
 * @module boot
 */
import { bootPlan, SETTINGS_KEY } from "./lazy-content.js";

let raw = null;
try { raw = localStorage.getItem(SETTINGS_KEY); } catch (_) { raw = null; }
for (const file of bootPlan(raw, typeof navigator !== "undefined" ? navigator : null)) {
  document.write('<script src="js/' + file + '"></script>');
}
