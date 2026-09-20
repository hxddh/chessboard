/**
 * On-demand classic scripts (6.1).
 *
 * index.html loads one bundle, and everything app.js imports statically ends
 * up inside it — 1.68 MB parsed before the first paint, of which roughly a
 * megabyte is content the first paint does not use: the full ECO table, the
 * mined puzzle set, and the two interface languages the reader is not reading
 * in (docs/v6-plan.md §8.3).
 *
 * engine.js already had the answer for its own 9.7 MB: leave the payload out
 * of the bundle, and inject it as a classic script the first time something
 * actually wants it. zero:// cannot fetch() a packaged file but it can load a
 * script, which is the same road index.html takes. This is that trick, made
 * reusable, so each chunk has one loader rather than four copies of one.
 *
 * A chunk is an ordinary module built into its own IIFE by scripts/bundle.mjs
 * and assigns its exports to the window; `loadChunk` resolves once the global
 * it promises is there.
 *
 * @module chunk
 */
  const global = typeof window !== "undefined" ? window : globalThis;
  /** in-flight loads, so two callers share one script tag */
  const inflight = new Map();

  /**
   * @param {string} file  file name under js/, e.g. "chunk-eco.js"
   * @param {string} globalName  the global the chunk defines
   * @returns {Promise<any>} the global's value
   */
  export function loadChunk(file, globalName) {
    if (global[globalName] != null) return Promise.resolve(global[globalName]);
    const already = inflight.get(file);
    if (already) return already;
    const p = new Promise((resolve, reject) => {
      const doc = global.document;
      if (!doc || !doc.head) { reject(new Error("no document for " + file)); return; }
      const el = doc.createElement("script");
      el.src = "js/" + file;
      el.async = true;
      el.onload = () => (global[globalName] != null
        ? resolve(global[globalName])
        : reject(new Error(file + " loaded without " + globalName)));
      el.onerror = () => reject(new Error(file + " failed to load"));
      doc.head.appendChild(el);
    });
    // a failed load must not be remembered as the answer: the next caller
    // gets a fresh attempt (a packaged file can be missing on one launch and
    // present on the next, after an update)
    p.catch(() => inflight.delete(file));
    inflight.set(file, p);
    return p;
  }

  /** Has this chunk already arrived? Callers render without it until it has. */
  export function chunkReady(globalName) { return global[globalName] != null; }
