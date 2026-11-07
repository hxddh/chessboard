/**
 * The library's summary on disk (v8-1-plan F3): where it is kept, and the
 * one read of it. Shared by library-db.js, which keeps it, and library-ui.js,
 * which asks for it while the app is still starting — so both bundles carry
 * this file, and it is kept to that.
 *
 * The summary is one row per game (library-db.js summaryOf), grouped the way
 * the native mirror groups the games (`lib00` … `lib3f`), one key per group
 * in the "meta" store of "chessboard.games", plus the summary's id.
 * @module library-sum
 */

export const DB_NAME = "chessboard.games";
/** The library's header — persist.js KEYS.library, read raw by chunk-boot.js. */
export const HEADER_KEY = "chess.library";
/** The global chunk-boot.js leaves its prefetch on, for library-ui.js. */
export const PREFETCH_GLOBAL = "CHESS_LIBSUM";
/** A shard of rows is `sum:` + the shard's name. */
export const SUM_KEY = "sum:";
/** The summary's id; the header (`chess.library`) carries it as `sum`. */
export const SUM_ID = "sumId";

/**
 * The stored summary — its id, each shard's text, and how many records the
 * store holds — from an open database, in one transaction so the three
 * describe one moment. Rejects when the database refuses.
 * @param {IDBDatabase} db
 * @returns {Promise<{id: string|null, texts: object, count: number}>}
 */
export function readStored(db) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(["games", "meta"], "readonly");
    const m = t.objectStore("meta");
    const range = IDBKeyRange.bound(SUM_KEY, SUM_KEY + "\uffff");
    const id = m.get(SUM_ID), keys = m.getAllKeys(range), texts = m.getAll(range), n = t.objectStore("games").count();
    // the last request's answer, not the transaction's end: requests answer
    // in the order they were made, and a read-only transaction has nothing
    // to commit — one event sooner, at start-up where each waits for a gap
    // between frames (M4 评审)
    n.onsuccess = () => {
      const out = {};
      keys.result.forEach((k, i) => { out[k] = texts.result[i]; });
      resolve({ id: typeof id.result === "string" ? id.result : null, texts: out, count: n.result });
    };
    t.onabort = t.onerror = () => reject(t.error || new Error("indexedDB summary read failed"));
  });
}

/**
 * The stored summary, asked for as early as the app can: the read is off
 * the main thread, and what comes back is strings — the rows are parsed
 * when the library's chunk wants them. Resolves {db, stored}: the open
 * connection too, which the chunk adopts (library-db.js idbBackend) rather
 * than opening its own — at start-up every reply waits behind whatever the
 * page is drawing, and one round trip fewer is one wait fewer. Null when
 * there is no database (it is not created here: library-db.js creates it,
 * with its stores) or it cannot be read; the chunk then does both itself.
 * @param {IDBFactory|null} idb
 * @returns {Promise<{db: IDBDatabase, stored: object}|null>}
 */
export function prefetchSummary(idb) {
  const g = typeof globalThis !== "undefined" ? globalThis : {};
  // chunk-boot.js asked already (bootPrefetch): that one, once
  if (g[PREFETCH_GLOBAL]) { const p = g[PREFETCH_GLOBAL]; g[PREFETCH_GLOBAL] = null; return p; }
  if (!idb || typeof idb.open !== "function" || typeof IDBKeyRange === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let req;
    try { req = idb.open(DB_NAME); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => { try { req.transaction.abort(); } catch (_) { /* already */ } };
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result;
      // a later version opened elsewhere: let go, as library-db.js does
      db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
      const fail = () => { try { db.close(); } catch (_) { /* already */ } resolve(null); };
      try { readStored(db).then((stored) => resolve({ db, stored }), fail); } catch (_) { fail(); }
    };
  });
}

/**
 * chunk-boot.js's half: the same read, begun before bundle.js runs. Once the
 * page starts drawing, each IndexedDB reply waits for a gap between frames
 * (in headless Chromium without a GPU a board frame is 0.4–0.7 s), so the
 * open and the read are best under way before the first one. Only for a
 * header that names a summary.
 */
export function bootPrefetch(storage, idb) {
  let raw = null;
  try { raw = storage ? storage.getItem(HEADER_KEY) : null; } catch (_) { raw = null; }
  if (!raw || raw.length > 65536 || !/"sum":"/.test(raw)) return false;
  const g = typeof globalThis !== "undefined" ? globalThis : null;
  if (!g) return false;
  g[PREFETCH_GLOBAL] = prefetchSummary(idb);
  return true;
}

/** The library's chunk (library-page.js), as library-ui.js loads it. */
export const LIBDB_CHUNK = { file: "chunk-libdb.js", global: "CHESS_LIBDB" };

/**
 * Does the app open on the library page (the saved `view`)? Then chunk-boot.js
 * puts the library's chunk ahead of bundle.js too, the way it does the
 * language's: the page's first frame is the list, and with the chunk already
 * there and the summary already read, library-ui.js draws it in that frame
 * rather than after the start-up's other frames.
 * @param {string|null} settingsRaw the stored settings JSON
 */
export function opensOnLibrary(settingsRaw) {
  let s = null;
  try { s = settingsRaw ? JSON.parse(settingsRaw) : null; } catch (_) { s = null; }
  return !!s && typeof s === "object" && s.view === "library";
}
