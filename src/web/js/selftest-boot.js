/**
 * What the packaged self-test's `chunkSync` check (v8-1-plan N3,
 * selftest-native.js) needs from the moment bundle.js runs, before the first
 * frame and before app.js could fetch a missing language on its own: what
 * chunk-boot.js was asked to document.write() (the same bootPlan over the
 * same input), and which language chunks were already on the window. Taken on
 * every launch — two property reads and one small JSON.parse — because a
 * self-test cannot go back in time to take it.
 *
 * v8-2-plan V1: and `pre`, the library prefetch chunk-boot.js began
 * (library-sum.js bootPrefetch), resolving with when it answered and how many
 * games the summary counted — what selftest-scenarios.js prefetch-read
 * reports; null when it did not ask. library-ui.js takes the same promise.
 * @module selftest-boot
 */
import { bootPlan, LANG_CHUNKS, SETTINGS_KEY } from "./lazy-content.js";

export const SELFTEST_BOOT = (() => {
  let raw = null;
  try { raw = localStorage.getItem(SETTINGS_KEY); } catch (_) { raw = null; }
  let plan = [];
  try { plan = bootPlan(raw, typeof navigator !== "undefined" ? navigator : null); } catch (_) { plan = []; }
  const here = {};
  for (const id of Object.keys(LANG_CHUNKS)) for (const c of LANG_CHUNKS[id]) here[c.file] = !!globalThis[c.global];
  const pre = globalThis.CHESS_LIBSUM;
  return { plan, here, pre: pre ? pre.then((r) => ({ ms: performance.now(), n: r ? r.stored.count : -1 }), () => null) : null };
})();
