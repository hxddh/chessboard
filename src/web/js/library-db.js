/**
 * 棋谱库的存储 — one IndexedDB record per game (v8-0-plan C1).
 *
 * Until v8-0-plan C1 the library was one localStorage value, `chess.v1.library`,
 * `{v: 1, names, games: [...]}`: the whole of it re-serialised on every save,
 * capped at 500 games because ~5 MB of quota was the real ceiling, and
 * mirrored to the native store as one file. Now:
 *
 *   * the games live in IndexedDB, database "chessboard.library", store
 *     "games", keyed by the entry's id — one record per game, so a save
 *     writes the games that changed and nothing else, and the quota is the
 *     disk's, not 5 MB;
 *   * each record carries the game's position index (`pk`, library-query.js)
 *     beside the entry, so "contains this position" is a scan, not a replay;
 *   * the native mirror (persist.js) keeps the games too, in 64 shard files
 *     ("lib00" … "lib3f", LibraryQuery.shardOf) under the same manifest, the
 *     same two slots and the same Web Lock as every other key — IndexedDB is
 *     the WebView's, and "remove website data" must not take the library;
 *   * `chess.v1.library` stays, as the header: `{v: 1, games: [], names,
 *     db: 2, n}`. Still v1-shaped on purpose — a 7.x build, or one from before C1, that
 *     opens this profile reads an empty library rather than quarantining a
 *     value it does not know, and the games are still here when it is
 *     upgraded again. If that older build imports meanwhile, it writes v1
 *     games into the header, and the next launch migrates them in too.
 *
 * Why IndexedDB and not a native file per game: the native store is reached
 * over the bridge, one async round trip per file. Loading ten thousand files
 * at every launch is minutes; one getAll() is well under a second. The
 * native store is kept for what it is for — surviving the WebView's data —
 * at a granularity (64 shards) its bridge can carry.
 *
 * The migration (`migrate`) is written for 7.0's history: that release lost
 * PGNs moving data between shapes. So it copies every game object verbatim,
 * keeps the whole v1 value as it was in the "meta" store before anything
 * else, reads back every id before the header is allowed to change, and runs
 * under the store's Web Lock so a second window cannot interleave with it. A
 * migration cut short anywhere leaves the v1 header in localStorage, and the
 * next launch simply does it again: every step is an idempotent upsert.
 * @module library-db
 */
import { LibraryQuery } from "./library-query.js";

const DB_NAME = "chessboard.library";
/**
 * v8-1-plan T3: 2 adds the "repertoire" store (your opening book by position,
 * rep-book.js) beside "games" and "meta". The upgrade only creates what is
 * missing — the games and the meta backups a v1 database holds are not
 * touched. An 8.0 build asking for version 1 of a version-2 database gets a
 * VersionError, which it already treats as "no IndexedDB": its library opens
 * read-only from the native shards (M5 review P2-1), nothing is lost.
 */
const DB_VERSION = 2;

/** A request as a promise. */
function done(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("indexedDB request failed"));
  });
}

/** A transaction's completion as a promise — the only moment a write is durable. */
function committed(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve(true);
    tx.onabort = () => reject(tx.error || new Error("indexedDB transaction aborted"));
    tx.onerror = () => reject(tx.error || new Error("indexedDB transaction failed"));
  });
}

/** How long one task may spend handing records to IndexedDB (ms). */
const PUT_SLICE = 6;
const now = () => (typeof performance !== "undefined" ? performance.now() : Date.now());

/**
 * `records` into store `s` of transaction `t`, PUT_SLICE ms of them per task.
 *
 * v8-1-plan F3: every put() structured-clones its record on the spot, and the
 * first launch moves the whole v1 library in with one put() call — 1,543
 * games of a 2 MB profile were one 34–45 ms task, in the middle of the
 * mirror's first write. The next slice is queued from the last request's
 * success, when the transaction is active again, so it is still one
 * transaction: all of the records or (abort) none of them.
 * @returns {Promise<true>} the transaction's commit
 */
function putSliced(t, s, records) {
  let i = 0, refused = null;
  const slice = () => {
    const t0 = now();
    let req = null;
    try {
      do req = s.put(records[i++]); while (i < records.length && now() - t0 < PUT_SLICE);
    } catch (e) {
      // a record the store refuses (DataError, DataCloneError): nothing of
      // this call lands, and the caller hears that error, not "aborted"
      refused = e;
      try { t.abort(); } catch (_) { /* already finished */ }
      return;
    }
    if (i < records.length) req.onsuccess = slice;
  };
  const done = committed(t).catch((e) => { throw refused || e; });
  if (records.length) slice();
  return done;
}

/**
 * The IndexedDB backend, or null when this WebView has none (or refuses it:
 * a private window, a policy). The caller then keeps the pre-C1 shape.
 * @param {IDBFactory} idb
 */
async function idbBackend(idb, name) {
  if (!idb || typeof idb.open !== "function") return null;
  let db;
  try {
    const req = idb.open(name || DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("games")) d.createObjectStore("games", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
      if (!d.objectStoreNames.contains("repertoire")) d.createObjectStore("repertoire", { keyPath: "id" });
    };
    // another window holding an older version open: it is told to let go
    req.onblocked = () => {};
    db = await done(req);
  } catch (_) { return null; }
  // a later version opened elsewhere: close, so it is not blocked by us
  db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
  const tx = (stores, mode) => db.transaction(stores, mode);
  return {
    kind: "idb",
    // a page at a time: one getAll() of a big library is one long structured
    // clone on the main thread (tens of ms at 2 MB — v8-0-plan F3's 16 ms line)
    async all() {
      const out = [];
      let from = null;
      for (;;) {
        const range = from == null ? null : IDBKeyRange.lowerBound(from, true);
        const page = await done(tx(["games"], "readonly").objectStore("games").getAll(range, 400));
        out.push(...page);
        if (page.length < 400) return out;
        from = page[page.length - 1].id;
      }
    },
    async keys() { return done(tx(["games"], "readonly").objectStore("games").getAllKeys()); },
    async count() { return done(tx(["games"], "readonly").objectStore("games").count()); },
    async get(ids) {
      const s = tx(["games"], "readonly").objectStore("games");
      return Promise.all(ids.map((id) => done(s.get(id))));
    },
    async put(records) {
      if (!records.length) return true;
      const t = tx(["games"], "readwrite");
      return putSliced(t, t.objectStore("games"), records);
    },
    async remove(ids) {
      if (!ids.length) return true;
      const t = tx(["games"], "readwrite");
      const s = t.objectStore("games");
      for (const id of ids) s.delete(id);
      return committed(t);
    },
    async replace(ids, records) {
      const t = tx(["games"], "readwrite");
      const s = t.objectStore("games");
      for (const id of ids) s.delete(id);
      return putSliced(t, s, records);
    },
    async clear() {
      const t = tx(["games"], "readwrite");
      t.objectStore("games").clear();
      return committed(t);
    },
    async getMeta(k) { return done(tx(["meta"], "readonly").objectStore("meta").get(k)); },
    async setMeta(k, v) {
      const t = tx(["meta"], "readwrite");
      t.objectStore("meta").put(v, k);
      return committed(t);
    },
    // v8-1-plan T3: the repertoire's records (rep-page.js), over this same
    // connection — one opener, one upgrade path for both
    rep: {
      async all() { return done(tx(["repertoire"], "readonly").objectStore("repertoire").getAll()); },
      async put(records) {
        if (!records.length) return true;
        const t = tx(["repertoire"], "readwrite");
        return putSliced(t, t.objectStore("repertoire"), records);
      },
      async remove(ids) {
        if (!ids.length) return true;
        const t = tx(["repertoire"], "readwrite");
        const s = t.objectStore("repertoire");
        for (const id of ids) s.delete(id);
        return committed(t);
      },
      async clear() {
        const t = tx(["repertoire"], "readwrite");
        t.objectStore("repertoire").clear();
        return committed(t);
      },
      getMeta: (k) => done(tx(["meta"], "readonly").objectStore("meta").get(k)),
      async setMeta(k, v) {
        const t = tx(["meta"], "readwrite");
        t.objectStore("meta").put(v, k);
        return committed(t);
      },
    },
  };
}

/**
 * The same interface over a Map — for node tests, which inject failures into
 * it (`fail.put = "QuotaExceededError"`), and nothing else.
 */
function memoryBackend() {
  const games = new Map(), meta = new Map(), reps = new Map();
  const fail = {};
  const clone = (v) => (v && typeof v === "object" ? structuredClone(v) : v);
  const check = (op) => { if (fail[op]) { const e = new Error(fail[op]); e.name = fail[op]; throw e; } };
  return {
    kind: "memory", games, meta, fail, reps,
    rep: {
      async all() { check("repAll"); return [...reps.values()].map(clone); },
      async put(records) { check("repPut"); for (const r of records) reps.set(r.id, clone(r)); return true; },
      async remove(ids) { check("repPut"); for (const id of ids) reps.delete(id); return true; },
      async clear() { reps.clear(); return true; },
      async getMeta(k) { return clone(meta.get(k)); },
      async setMeta(k, v) { check("setMeta"); meta.set(k, clone(v)); return true; },
    },
    async all() { check("all"); return [...games.values()].map(clone); },
    async keys() { check("all"); return [...games.keys()]; },
    async count() { return games.size; },
    async get(ids) { check("all"); return ids.map((id) => clone(games.get(id))); },
    async put(records) {
      check("put");
      // all or nothing, like a transaction
      const next = records.map((r) => [r.id, clone(r)]);
      for (const [id, r] of next) games.set(id, r);
      return true;
    },
    async remove(ids) { check("remove"); for (const id of ids) games.delete(id); return true; },
    async replace(ids, records) {
      check("put");
      for (const id of ids) games.delete(id);
      for (const r of records) games.set(r.id, clone(r));
      return true;
    },
    async clear() { check("clear"); games.clear(); return true; },
    async getMeta(k) { return clone(meta.get(k)); },
    async setMeta(k, v) { check("setMeta"); meta.set(k, clone(v)); return true; },
  };
}

/** How deep an entry's analysis went: 0 = none. */
const depthOf = (g) => (g && g.an ? Number(g.an.budget) || 1 : 0);

/**
 * Two copies of one game (the same id): which one stays.
 *
 * `addGames`' rule — what is stored stays — with one exception the two-store
 * world needs: an older build may have analysed the game in its v1 header
 * after this build migrated it. The deeper analysis wins; a clock either side
 * has is kept. Nothing else of either copy is merged: a half of each is a
 * record neither build wrote.
 */
function mergeEntry(have, incoming) {
  if (!have) return incoming;
  const keep = depthOf(incoming) > depthOf(have) ? incoming : have;
  const other = keep === have ? incoming : have;
  if (!keep.clk && other.clk) return Object.assign({}, keep, { clk: other.clk });
  return keep;
}

/**
 * The library's store: the entries in memory, their index beside them, and
 * the one door to IndexedDB. Imported games and 本机 games (`src: "local"`,
 * derived from the play history, see `syncLocal`) are kept apart: the
 * analysis pass and the diagnosis read the imported ones only, as they
 * always have; the list, the search and the explorer read both.
 * @param {{backend: object, Chess: Function, withLock?: (fn) => Promise}} o
 */
function createLibraryStore(o) {
  const backend = o.backend;
  const Chess = o.Chess;
  const withLock = o.withLock || ((fn) => fn());
  /** id → Float64Array: the position index */
  const pk = new Map();
  /** ids whose moves do not replay, so they have no index (kept out of the entry) */
  const noIndex = new Set();
  let games = [];
  let local = [];
  /**
   * Bumped by whatever takes games away wholesale — clear, restore (M5 review
   * P2-2). indexMissing writes its records outside the page's save chain,
   * a slice at a time; a slice that finds the generation moved stops there.
   */
  let gen = 0;
  /** ids of the lists as they are now, rebuilt only when a list is replaced */
  let liveOf = null;
  function live() {
    if (!liveOf || liveOf.games !== games || liveOf.local !== local) {
      liveOf = { games, local, ids: new Set(games.concat(local).map((g) => g.id)) };
    }
    return liveOf.ids;
  }

  /** The record for an entry: the entry, plus its index when it has one. */
  function recordOf(g) {
    const r = Object.assign({}, g);
    const k = pk.get(g.id);
    if (k) r.pk = k;
    return r;
  }
  /** An entry from a record: the index goes beside it, never inside it. */
  function take(r) {
    const g = Object.assign({}, r);
    if (g.pk) {
      pk.set(g.id, g.pk instanceof Float64Array ? g.pk : Float64Array.from(g.pk));
      delete g.pk;
    }
    return g;
  }

  /** Everything stored, split into the two lists. */
  async function load() {
    const rows = await backend.all();
    const a = [], b = [];
    for (const r of rows) {
      if (!r || typeof r.id !== "string") continue;
      (r.src === "local" ? b : a).push(take(r));
    }
    a.sort((x, y) => (y.t || 0) - (x.t || 0));
    games = a;
    local = b;
    return { games, local };
  }

  /**
   * v1 → IndexedDB. `raw` is the header's value exactly as localStorage
   * holds it. Resolves {ok, moved} once every game is readable back from
   * the store — and only then may the caller replace the header.
   * `opts.backup === false`: the value is not one found in localStorage but
   * the native shards read back (library-page.js), already a copy — keeping
   * it too stored a second full library per recovery (M5 review P3-3).
   */
  async function migrate(raw, opts) {
    let v1 = null;
    try { v1 = JSON.parse(raw); } catch (_) { return { ok: false, error: "parse" }; }
    const list = v1 && Array.isArray(v1.games) ? v1.games : [];
    return withLock(async () => {
      try {
        // the value as found, before anything is written — whatever the
        // conversion below gets wrong, this can be read back by hand
        if (!opts || opts.backup !== false) await backend.setMeta("v1:" + Date.now(), { raw });
        // only the games both copies have are read whole
        const stored = new Set(await backend.keys());
        const both = list.filter((g) => g && typeof g.id === "string" && stored.has(g.id)).map((g) => g.id);
        const have = new Map((both.length ? await backend.get(both) : []).filter(Boolean).map((r) => [r.id, r]));
        const put = [];
        for (const g of list) {
          if (!g || typeof g.id !== "string" || !g.id) continue;
          const cur = have.get(g.id);
          if (!cur) { put.push(g); continue; }
          // a second window, or a migration cut short, got here first
          const { pk: k, ...stored } = cur;
          const rec = Object.assign({}, mergeEntry(stored, g));
          if (k) rec.pk = k;
          put.push(rec);
        }
        await backend.put(put);
        // read back: every id the v1 value held is in the store
        const back = new Set(await backend.keys());
        const missing = list.filter((g) => g && typeof g.id === "string" && g.id && !back.has(g.id));
        if (missing.length) return { ok: false, error: "readback", missing: missing.length };
        return { ok: true, moved: list.length };
      } catch (e) {
        return { ok: false, error: (e && e.name) || "write" };
      }
    });
  }

  /** Write these entries (with their index). Rejects when the store refuses. */
  async function save(entries) {
    if (!entries.length) return true;
    return backend.put(entries.map(recordOf));
  }
  /** These records, as entries (a second window wrote them). */
  async function read(ids) {
    return (await backend.get(ids)).filter((r) => r && typeof r.id === "string").map(take);
  }
  async function drop(ids) {
    for (const id of ids) pk.delete(id);
    return backend.remove(ids);
  }

  /** The index of a game whose positions the caller already has (an import). */
  function indexFens(id, fens) { pk.set(id, LibraryQuery.keysOfFens(fens)); }

  /**
   * Index what is not indexed yet, a slice at a time: a migrated or
   * restored library arrives without its index, and replaying ten thousand
   * games is tens of seconds of chess.js. `budgetMs` per slice, then the
   * thread goes back; the games indexed are written back so it happens once.
   * @returns {Promise<number>} games indexed
   */
  async function indexMissing(budgetMs, pause) {
    const todo = games.concat(local).filter((g) => !pk.has(g.id) && !noIndex.has(g.id));
    const at = gen;
    let n = 0;
    let t0 = Date.now();
    let batch = [];
    // only games still in a list: one dropped (over the cap, gone from the
    // play history) or cleared since the list was taken is not written back
    const flush = () => {
      const ids = live();
      return save(batch.filter((x) => pk.has(x.id) && ids.has(x.id))).catch(() => {});
    };
    for (const g of todo) {
      if (gen !== at) return n;
      const k = LibraryQuery.keysOfGame(g, Chess);
      if (k) pk.set(g.id, k);
      else noIndex.add(g.id);   // does not replay; not asked again this session
      batch.push(g);
      n++;
      if (Date.now() - t0 >= budgetMs) {
        await flush();
        batch = [];
        await pause();
        t0 = Date.now();
      }
    }
    if (gen === at) await flush();
    return n;
  }

  /** Stop the background index now (M5 review P2-2): what follows takes games away. */
  function halt() { gen++; }
  /** Every game gone, from memory and the store (清除全部存档). */
  async function clear() {
    halt();
    games = [];
    local = [];
    pk.clear();
    return backend.clear();
  }

  /** id → shard name, so a flush of all 64 does not hash every id 64 times */
  const shardMemo = new Map();
  const shardOf = (id) => {
    let s = shardMemo.get(id);
    if (!s) shardMemo.set(id, (s = LibraryQuery.shardOf(id)));
    return s;
  };
  /** The shards this library's games are mirrored in, with their games. */
  function shards() {
    const m = new Map();
    for (const g of games) {
      const s = shardOf(g.id);
      let list = m.get(s);
      if (!list) m.set(s, (list = []));
      list.push(g);
    }
    return m;
  }
  /** One shard's text for the native store: the entries, never the index. */
  function shardText(name) {
    const list = games.filter((g) => shardOf(g.id) === name);
    return list.length ? JSON.stringify({ v: 1, games: list }) : null;
  }

  /**
   * Replace every imported game with the ones in `texts` (shard name → the
   * text shardText wrote) — a restore from the native store or from an
   * exported profile. The 本机 games are left: they are derived from the
   * play history, which the restore brings back on its own key.
   */
  async function restoreShards(texts) {
    const incoming = [];
    for (const text of Object.values(texts || {})) {
      let v = null;
      try { v = JSON.parse(text); } catch (_) { v = null; }
      if (v && Array.isArray(v.games)) for (const g of v.games) if (g && typeof g.id === "string") incoming.push(g);
    }
    halt();
    return withLock(async () => {
      const old = games.map((g) => g.id);
      // one transaction: never a moment with the old games gone and the new
      // ones not yet in
      await backend.replace(old, incoming);
      for (const id of old) pk.delete(id);
      games = incoming.slice().sort((x, y) => (y.t || 0) - (x.t || 0));
      return incoming.length;
    });
  }

  return {
    backend, pk, load, migrate, save, drop, read, indexFens, indexMissing, halt, clear, shards, shardText, restoreShards, shardOf,
    get games() { return games; }, set games(v) { games = v; },
    get local() { return local; }, set local(v) { local = v; },
    pkOf: (g) => (g ? pk.get(g.id) || null : null),
  };
}

export const LibraryDb = { DB_NAME, idbBackend, memoryBackend, createLibraryStore, mergeEntry };
