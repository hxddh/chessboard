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
import { bootPrefetch, opensOnLibrary, LIBDB_CHUNK } from "./library-sum.js";

let raw = null;
try { raw = localStorage.getItem(SETTINGS_KEY); } catch (_) { raw = null; }
for (const file of bootPlan(raw, typeof navigator !== "undefined" ? navigator : null)) {
  document.write('<script src="js/' + file + '"></script>');
}

// v8-1-plan F3: the library's summary, asked of IndexedDB before the bundle
// draws anything (library-sum.js bootPrefetch; library-ui.js takes it) —
// and when the app opens on the library page, the chunk that draws the list
let summarised = false;
try { summarised = bootPrefetch(localStorage, typeof indexedDB !== "undefined" ? indexedDB : null); } catch (_) { summarised = false; }
if (summarised && opensOnLibrary(raw)) document.write('<script src="js/' + LIBDB_CHUNK.file + '"></script>');
