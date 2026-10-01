/**
 * 我的开局书的 IndexedDB (v8-1-plan T3; M3 评审) — chunk-rep.js's own
 * database, "chessboard.repertoire", version 1: the records by position
 * ("repertoire", keyPath id) and "meta" (the pre-migration copies of the
 * header, `rep-v1:<time>` and `rep-v2:<time>`, and the write generation
 * `rep-gen`).
 *
 * Its own database and not a store in chessboard.library: adding a store
 * there meant a version-2 library, and every 8.0 launch after that asked
 * for version 1 and got a VersionError — 8.0's library read-only for good.
 * Here the library stays at version 1 and 8.0 keeps working on it.
 *
 * v8-2-plan T4: the lines themselves (rep-lines.js), which until 8.1 lived
 * only in the localStorage header under a 400-line cap, go into a database
 * of their own as well, "chessboard.replines", version 1 — for the same
 * reason again: a store added to chessboard.repertoire would make it version
 * 2, and 8.1, which asks for version 1, would get a VersionError on every
 * launch after a downgrade and lose sight of its cards. chessboard.repertoire
 * keeps 8.1's version and schema untouched. Beside the lines ("lines",
 * keyPath `k` = side + ":" + line id) the new database keeps a copy of every
 * card ("cards", keyPath id): an 8.1 session indexes only the header's 400
 * lines a side and drops the records past them from chessboard.repertoire,
 * and their schedules come back from here (rep-page.js).
 * @module rep-db
 */

export const REP_DB_NAME = "chessboard.repertoire";
export const REP_DB_VERSION = 1;
export const LINES_DB_NAME = "chessboard.replines";
export const LINES_DB_VERSION = 1;

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

/** One database at its version, each named store created once; null when refused. */
async function openOne(idb, name, version, stores) {
  let db;
  try {
    const req = idb.open(name, version);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [store, opts] of stores) if (!d.objectStoreNames.contains(store)) d.createObjectStore(store, opts);
    };
    req.onblocked = () => {};
    db = await done(req);
  } catch (_) { return null; }
  db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
  return db;
}

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
 * null when this WebView has no IndexedDB or refuses either database.
 * @param {IDBFactory} idb
 * @param {string} [name] another database name for the records (tests)
 * @param {string} [linesName] another for the lines (tests)
 */
export async function openRepDb(idb, name, linesName) {
  if (!idb || typeof idb.open !== "function") return null;
  const db = await openOne(idb, name || REP_DB_NAME, REP_DB_VERSION, [["repertoire", { keyPath: "id" }], ["meta", undefined]]);
  if (!db) return null;
  const ldb = await openOne(idb, linesName || LINES_DB_NAME, LINES_DB_VERSION, [["lines", { keyPath: "k" }], ["cards", { keyPath: "id" }]]);
  if (!ldb) { try { db.close(); } catch (_) { /* already */ } return null; }
  const tx = (stores, mode) => db.transaction(stores, mode);
  const all = (d, store) => done(d.transaction([store], "readonly").objectStore(store).getAll());
  return {
    kind: "idb",
    async all() { return all(db, "repertoire"); },
    async put(records) { return write(db, "repertoire", records, []); },
    async remove(ids) { return write(db, "repertoire", [], ids); },
    /** The lines (v8-2-plan T4): rows as rep-lines.js writes them. */
    async lines() { return all(ldb, "lines"); },
    async putLines(rows, gone) { return write(ldb, "lines", rows, gone); },
    /** The cards' copy (v8-2-plan T4): `{id, card}` per record that has one. */
    async cards() { return all(ldb, "cards"); },
    async putCards(rows, gone) { return write(ldb, "cards", rows, gone); },
    /** Everything (清除全部存档, 导入全部数据). */
    async clear() {
      const t = tx(["repertoire"], "readwrite");
      t.objectStore("repertoire").clear();
      await committed(t);
      const u = ldb.transaction(["lines", "cards"], "readwrite");
      u.objectStore("lines").clear();
      u.objectStore("cards").clear();
      return committed(u);
    },
    async getMeta(k) { return done(tx(["meta"], "readonly").objectStore("meta").get(k)); },
    async setMeta(k, v) {
      const t = tx(["meta"], "readwrite");
      t.objectStore("meta").put(v, k);
      return committed(t);
    },
  };
}
