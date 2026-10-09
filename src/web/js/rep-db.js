/**
 * 我的开局书的 IndexedDB (v8-1-plan T3, v8-2-plan T4) — chunk-rep.js's own
 * database, "chessboard.book", version 1, three stores:
 *
 *   * "records" — the book by position (rep-book.js), keyPath id, each with
 *     its card;
 *   * "lines" — the lines themselves (rep-lines.js), keyPath `k` = side +
 *     ":" + line id, what 按线练 drills and every edit edits;
 *   * "meta" — the write generation `rep-gen`.
 * @module rep-db
 */

export const REP_DB_NAME = "chessboard.book";
export const REP_DB_VERSION = 1;

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

/** Rows in, keys out, in one transaction on `store`. */
function write(db, store, rows, gone) {
  if (!rows.length && !gone.length) return true;
  const t = db.transaction([store], "readwrite");
  const s = t.objectStore(store);
  for (const k of gone) s.delete(k);
  for (const r of rows) s.put(r);
  return committed(t);
}

/**
 * The backend rep-page.js boots on (the same shape as its memory one), or
 * null when this WebView has no IndexedDB or refuses the database.
 * @param {IDBFactory} idb
 * @param {string} [name] another database name (tests)
 */
export async function openRepDb(idb, name) {
  if (!idb || typeof idb.open !== "function") return null;
  let db;
  try {
    const req = idb.open(name || REP_DB_NAME, REP_DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("records")) d.createObjectStore("records", { keyPath: "id" });
      if (!d.objectStoreNames.contains("lines")) d.createObjectStore("lines", { keyPath: "k" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    req.onblocked = () => {};
    db = await done(req);
  } catch (_) { return null; }
  db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
  const tx = (stores, mode) => db.transaction(stores, mode);
  const all = (store) => done(tx([store], "readonly").objectStore(store).getAll());
  return {
    kind: "idb",
    async all() { return all("records"); },
    async put(records) { return write(db, "records", records, []); },
    async remove(ids) { return write(db, "records", [], ids); },
    /** The lines: rows as rep-lines.js writes them. */
    async lines() { return all("lines"); },
    async putLines(rows, gone) { return write(db, "lines", rows, gone); },
    /** Everything (清除全部存档, 导入全部数据). */
    async clear() {
      const t = tx(["records", "lines"], "readwrite");
      t.objectStore("records").clear();
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
