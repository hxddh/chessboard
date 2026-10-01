/**
 * 我的开局书的 IndexedDB (v8-1-plan T3; M3 评审) — chunk-rep.js's own
 * database, "chessboard.repertoire": the records by position
 * ("repertoire", keyPath id) and "meta" (the pre-migration copies of the
 * header, `rep-v1:<time>` and `rep-v2:<time>`, and the write generation
 * `rep-gen`).
 *
 * Version 2 (v8-2-plan T4) adds "lines", keyPath `k` (side + ":" + line id):
 * the book's lines themselves (rep-lines.js), which until 8.1 lived only in
 * the localStorage header under a 400-line cap. The upgrade only creates the
 * store; the lines move in on the first boot (rep-page.js). 8.1 asks for
 * version 1 and gets a VersionError: its openRepDb answers null, and 8.1 runs
 * its records on its in-memory backend and the native shards, with the
 * header's lines (the first 400 a side, rep-lines.js HEAD) as the book.
 *
 * Its own database and not a store in chessboard.library: adding a store
 * there meant a version-2 library, and every 8.0 launch after that asked
 * for version 1 and got a VersionError — 8.0's library read-only for good.
 * Here the library stays at version 1 and 8.0 keeps working on it.
 * @module rep-db
 */

export const REP_DB_NAME = "chessboard.repertoire";
export const REP_DB_VERSION = 2;

/** A request as a promise. */
const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error("indexedDB request failed"));
});
/** A transaction as a promise: true once committed. */
const committed = (t) => new Promise((resolve, reject) => {
  t.oncomplete = () => resolve(true);
  t.onerror = () => reject(t.error || new Error("indexedDB transaction failed"));
  t.onabort = () => reject(t.error || new Error("indexedDB transaction aborted"));
});

/**
 * The backend rep-page.js boots on (the same shape as its memory one), or
 * null when this WebView has no IndexedDB or refuses it.
 * @param {IDBFactory} idb
 * @param {string} [name] another database name (tests)
 */
export async function openRepDb(idb, name) {
  if (!idb || typeof idb.open !== "function") return null;
  let db;
  try {
    const req = idb.open(name || REP_DB_NAME, REP_DB_VERSION);
    // from nothing, or from 8.1's version 1: each store once
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("repertoire")) d.createObjectStore("repertoire", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("lines")) d.createObjectStore("lines", { keyPath: "k" });
    };
    req.onblocked = () => {};
    db = await done(req);
  } catch (_) { return null; }
  db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
  const tx = (stores, mode) => db.transaction(stores, mode);
  return {
    kind: "idb",
    async all() { return done(tx(["repertoire"], "readonly").objectStore("repertoire").getAll()); },
    async put(records) {
      if (!records.length) return true;
      const t = tx(["repertoire"], "readwrite");
      const s = t.objectStore("repertoire");
      for (const r of records) s.put(r);
      return committed(t);
    },
    async remove(ids) {
      if (!ids.length) return true;
      const t = tx(["repertoire"], "readwrite");
      const s = t.objectStore("repertoire");
      for (const id of ids) s.delete(id);
      return committed(t);
    },
    /** The lines (v8-2-plan T4): rows as rep-lines.js writes them. */
    async lines() { return done(tx(["lines"], "readonly").objectStore("lines").getAll()); },
    async putLines(rows, gone) {
      if (!rows.length && !gone.length) return true;
      const t = tx(["lines"], "readwrite");
      const s = t.objectStore("lines");
      for (const k of gone) s.delete(k);
      for (const r of rows) s.put(r);
      return committed(t);
    },
    /** Records and lines in one transaction (清除全部存档, 导入全部数据). */
    async clear() {
      const t = tx(["repertoire", "lines"], "readwrite");
      t.objectStore("repertoire").clear();
      t.objectStore("lines").clear();
      return committed(t);
    },
    async getMeta(k) { return done(tx(["meta"], "readonly").objectStore("meta").get(k)); },
    async setMeta(k, v) {
      const t = tx(["meta"], "readwrite");
      t.objectStore("meta").put(v, k);
      return committed(t);
    },
  };
}
