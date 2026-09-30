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
import { DB_NAME, SUM_KEY, SUM_ID, readStored } from "./library-sum.js";

/**
 * Still 1 (v8-1-plan T3, M3 评审): the repertoire's records have a database of
 * their own (rep-db.js), because a version 2 here would make every 8.0
 * launch hit a VersionError and open its library read-only for good.
 */
const DB_VERSION = 1;

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
 * v8-1-plan F3: the list's summary lives in the "meta" store beside the v1
 * backups (library-sum.js says where). In a meta write's `del`: every
 * summary shard (the id stays).
 */
const SUM_ALL = "sum:*";

/** A meta write ({put: [[key, value]], del: [key]}) into store `m` of an open transaction. */
function applyMeta(m, meta) {
  for (const k of meta.del || []) m.delete(k === SUM_ALL ? IDBKeyRange.bound(SUM_KEY, SUM_KEY + "\uffff") : k);
  for (const [k, v] of meta.put || []) m.put(v, k);
}

/**
 * The IndexedDB backend, or null when this WebView has none (or refuses it:
 * a private window, a policy). The caller then keeps the pre-C1 shape.
 * @param {IDBFactory} idb
 * @param {string} [name]
 * @param {IDBDatabase} [open] a connection already open (library-sum.js
 *   prefetchSummary) — adopted when it is this version with both stores
 */
async function idbBackend(idb, name, open) {
  if (!idb || typeof idb.open !== "function") return null;
  let db = null;
  if (open) {
    let fits = open.version === DB_VERSION && open.objectStoreNames.contains("games") && open.objectStoreNames.contains("meta");
    // closed meanwhile (a version change elsewhere): a transaction says so
    // (M4 评审) — then a fresh open below
    if (fits) { try { open.transaction(["games"], "readonly"); } catch (_) { fits = false; } }
    if (fits) db = open;
    else { try { open.close(); } catch (_) { /* already */ } }
  }
  if (!db) try {
    const req = idb.open(name || DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains("games")) d.createObjectStore("games", { keyPath: "id" });
      if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    };
    // another window holding an older version open: it is told to let go
    req.onblocked = () => {};
    db = await done(req);
  } catch (_) { return null; }
  // a later version opened elsewhere: close, so it is not blocked by us
  db.onversionchange = () => { try { db.close(); } catch (_) { /* already */ } };
  const tx = (stores, mode) => db.transaction(stores, mode);
  /**
   * A write to "games", and with it (`meta`, v8-1-plan F3) the summary
   * shards that describe those games: one transaction, so the list's summary
   * and the games it summarises commit together or not at all.
   */
  const gamesTx = (meta) => {
    const t = tx(meta ? ["games", "meta"] : ["games"], "readwrite");
    if (meta) applyMeta(t.objectStore("meta"), meta);
    return t;
  };
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
    async put(records, meta) {
      if (!records.length && !meta) return true;
      const t = gamesTx(meta);
      return putSliced(t, t.objectStore("games"), records);
    },
    async remove(ids, meta) {
      if (!ids.length && !meta) return true;
      const t = gamesTx(meta);
      const s = t.objectStore("games");
      for (const id of ids) s.delete(id);
      return committed(t);
    },
    async replace(ids, records, meta) {
      const t = gamesTx(meta);
      const s = t.objectStore("games");
      for (const id of ids) s.delete(id);
      return putSliced(t, s, records);
    },
    // the summary goes with the games; its id stays (see SUM_ID)
    async clear() {
      const t = gamesTx({ del: [SUM_ALL] });
      t.objectStore("games").clear();
      return committed(t);
    },
    async getMeta(k) { return done(tx(["meta"], "readonly").objectStore("meta").get(k)); },
    async setMeta(k, v) {
      const t = tx(["meta"], "readwrite");
      t.objectStore("meta").put(v, k);
      return committed(t);
    },
    // v8-1-plan F3: the stored summary (library-sum.js)
    async summary() { return readStored(db); },
    async writeMeta(meta) {
      const t = tx(["meta"], "readwrite");
      applyMeta(t.objectStore("meta"), meta);
      return committed(t);
    },
  };
}

/**
 * The same interface over a Map — for node tests, which inject failures into
 * it (`fail.put = "QuotaExceededError"`), and nothing else.
 */
function memoryBackend() {
  const games = new Map(), meta = new Map();
  const fail = {};
  const clone = (v) => (v && typeof v === "object" ? structuredClone(v) : v);
  const check = (op) => { if (fail[op]) { const e = new Error(fail[op]); e.name = fail[op]; throw e; } };
  const metaOf = (m) => {
    if (!m) return;
    for (const k of m.del || []) {
      if (k !== SUM_ALL) meta.delete(k);
      else for (const key of [...meta.keys()]) if (key.startsWith(SUM_KEY)) meta.delete(key);
    }
    for (const [k, v] of m.put || []) meta.set(k, clone(v));
  };
  return {
    kind: "memory", games, meta, fail,
    async all() { check("all"); return [...games.values()].map(clone); },
    async keys() { check("all"); return [...games.keys()]; },
    async count() { return games.size; },
    async get(ids) { check("all"); return ids.map((id) => clone(games.get(id))); },
    async put(records, m) {
      check("put");
      // all or nothing, like a transaction
      const next = records.map((r) => [r.id, clone(r)]);
      for (const [id, r] of next) games.set(id, r);
      metaOf(m);
      return true;
    },
    async remove(ids, m) { check("remove"); for (const id of ids) games.delete(id); metaOf(m); return true; },
    async replace(ids, records, m) {
      check("put");
      for (const id of ids) games.delete(id);
      for (const r of records) games.set(r.id, clone(r));
      metaOf(m);
      return true;
    },
    async clear() { check("clear"); games.clear(); metaOf({ del: [SUM_ALL] }); return true; },
    async getMeta(k) { return clone(meta.get(k)); },
    async setMeta(k, v) { check("setMeta"); meta.set(k, clone(v)); return true; },
    async summary() {
      check("all");
      const texts = {};
      for (const [k, v] of meta) if (k.startsWith(SUM_KEY)) texts[k] = v;
      const id = meta.get(SUM_ID);
      return { id: typeof id === "string" ? id : null, texts, count: games.size };
    },
    async writeMeta(m) { check("setMeta"); metaOf(m); return true; },
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

/** How many of this player's own plies in a game were `?` or `??`. */
function badCount(g) {
  const tags = g.an && Array.isArray(g.an.tags) ? g.an.tags : [];
  const start = g.fen ? g.fen.trim().split(/\s+/) : [];
  const first = start[1] === "b" ? "b" : "w";
  const other = first === "w" ? "b" : "w";
  let n = 0;
  for (let i = 0; i < tags.length; i++) {
    if ((i % 2 === 0 ? first : other) !== g.side) continue;
    if (tags[i] === "?" || tags[i] === "??") n++;
  }
  return n;
}

/**
 * v8-1-plan F3: a list row's worth of an entry, under short keys — what the
 * list page draws and searches (everything but "passes through this
 * position") and nothing it does not: no moves, no analysis arrays, no
 * index. Ten thousand of these are ~1.5 MB of JSON, read in one transaction
 * at launch, where the entries themselves are the whole library.
 */
const SUM_FIELDS = [["w", "white"], ["b", "black"], ["d", "date"], ["e", "event"], ["s", "site"], ["r", "result"],
  ["sd", "side"], ["o", "outcome"], ["eco", "eco"], ["en", "ecoName"], ["tc", "tc"], ["src", "src"], ["ref", "ref"],
  ["df", "diff"], ["p", "plies"]];
function summaryOf(g) {
  const r = { id: g.id, t: Number(g.t) || 0 };
  for (const [k, f] of SUM_FIELDS) {
    const v = g[f];
    if (typeof v === "string" || (typeof v === "number" && Number.isFinite(v))) r[k] = v;
  }
  if (g.unplayable) r.u = 1;
  if (g.src === "local") {
    if (typeof g.acc === "number") r.acc = g.acc;
  } else if (g.an) {
    // analysed, how deep (「再深一遍」 needs it), own accuracy, own mistakes
    r.an = Number(g.an.budget) || 1;
    const acc = g.an.acc && g.side ? g.an.acc[g.side] : null;
    if (Number.isFinite(acc)) r.acc = acc;
    r.bad = badCount(g);
  }
  return r;
}
/**
 * An entry-shaped stand-in made from a summary row, marked `stub`: the list
 * page draws and searches it like an entry until the entries arrive. It has
 * no moves and no `an`; `stub` holds what the row knew of the analysis.
 */
function stubOf(r) {
  const g = { id: r.id, t: r.t, stub: { an: r.an || 0, acc: r.acc, bad: r.bad || 0 } };
  for (const [k, f] of SUM_FIELDS) if (r[k] !== undefined) g[f] = r[k];
  if (r.u) g.unplayable = true;
  if (r.src === "local" && typeof r.acc === "number") g.acc = r.acc;
  return g;
}

/**
 * The library's one order: newest first, and by id among games of the same
 * moment — every game of one import shares its `t` (M4 评审 P2-1: sorted by
 * `t` alone, the summary's rows, in shard order, and the entries, in id
 * order, made two different first pages, and the list changed under the
 * reader when the entries arrived).
 */
const newestFirst = (a, b) => (b.t || 0) - (a.t || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** A summary shard's text: its rows in id order, so the same rows are the same text. */
const sumText = (m) => JSON.stringify([...m.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)));

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

  /** id → shard name, so a flush of all 64 does not hash every id 64 times */
  const shardMemo = new Map();
  const shardOf = (id) => {
    let s = shardMemo.get(id);
    if (!s) shardMemo.set(id, (s = LibraryQuery.shardOf(id)));
    return s;
  };

  /**
   * v8-1-plan F3: the summary as this window knows it, shard → id → row.
   * Kept only once `load` has read every record (sumOn): before that it
   * would describe part of the library, and a shard written from it would
   * drop the rest. From then on every write below carries the rows of the
   * shards it changed, in the same transaction as the games.
   */
  const sum = new Map();
  let sumOn = false;
  let sumId = null;
  /** The stored summary as last read (readSummary), for syncSummary to compare against. */
  let sumSeen = null;
  /** These entries' rows (and none for `gone`) into memory; the shards that changed. */
  function sumTouch(entries, gone) {
    const touched = new Set();
    for (const id of gone || []) {
      const s = shardOf(id), m = sum.get(s);
      if (m && m.delete(id)) touched.add(s);
    }
    for (const g of entries || []) {
      if (!g || typeof g.id !== "string") continue;
      const r = summaryOf(g), s = shardOf(g.id);
      let m = sum.get(s);
      if (!m) sum.set(s, (m = new Map()));
      const had = m.get(g.id);
      if (had && JSON.stringify(had) === JSON.stringify(r)) continue;
      m.set(g.id, r);
      touched.add(s);
    }
    return touched;
  }
  /** The meta write for these shards, as memory holds them now. */
  function sumWrite(touched) {
    const meta = { put: [], del: [] };
    for (const s of touched) {
      const m = sum.get(s);
      if (m && m.size) meta.put.push([SUM_KEY + s, sumText(m)]);
      else meta.del.push(SUM_KEY + s);
    }
    return meta;
  }
  /**
   * Shards whose rows memory has and the store may not: a write that carried
   * them was refused, or has not committed yet. Every write carries these
   * too until one commits — retrying the same entries changes no row, so
   * without this the row the refused write took would never be written.
   */
  const owed = new Set();
  /**
   * A write of these entries (and of `gone`): `run(meta)` makes it, with the
   * summary shards it changes — and the owed ones — in its transaction.
   */
  function withSum(entries, gone, run) {
    if (!sumOn) return run(undefined);
    const touched = sumTouch(entries, gone);
    for (const s of owed) touched.add(s);
    if (!touched.size) return run(undefined);
    for (const s of touched) owed.add(s);
    return run(sumWrite(touched)).then((v) => { for (const s of touched) owed.delete(s); return v; },
      (e) => { for (const s of touched) owed.add(s); throw e; });
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
    a.sort(newestFirst);
    games = a;
    local = b;
    // every record is in hand: the summary is rebuilt from them, and kept
    // from here on (syncSummary puts the stored one right)
    sum.clear();
    sumTouch(a.concat(b));
    sumOn = true;
    return { games, local };
  }

  /**
   * v8-1-plan F3: the stored summary, as rows, when it can stand in for the
   * library until `load` has read it: its id is the one the header carries
   * (`id` — a build that does not know the summary rewrites the header
   * without it), and it has a row for every record the store holds. Null
   * otherwise; the list then waits for the entries, as before.
   * `pre`: the same read, made earlier (library-sum.js prefetchSummary).
   * @returns {Promise<object[]|null>}
   */
  async function readSummary(id, pre) {
    let s = pre || null;
    if (!s) { try { s = await backend.summary(); } catch (_) { return null; } }
    sumSeen = s;
    if (!id || s.id !== id) return null;
    const rows = [];
    try {
      for (const text of Object.values(s.texts)) {
        const v = JSON.parse(text);
        if (Array.isArray(v)) for (const r of v) if (r && typeof r.id === "string") rows.push(r);
      }
    } catch (_) { return null; }
    return rows.length === s.count ? rows : null;
  }

  /**
   * After `load`: make the stored summary say what the records say — a
   * shard written by another build, by a window that did not know a game,
   * or never written (a library from before the summary) is rewritten; one
   * that already agrees is left. Compared a shard at a time, `budgetMs` a
   * slice; what differs is serialised again when it is written, so a save
   * that landed meanwhile is not overwritten with the older text.
   * @returns {Promise<string>} the summary's id, for the header
   */
  async function syncSummary(budgetMs, pause) {
    if (!sumOn) return null;
    let stored = sumSeen;
    if (!stored) { try { stored = await backend.summary(); } catch (_) { return null; } }
    const texts = stored.texts || {};
    const stale = new Set();
    let t0 = Date.now();
    for (const [s, m] of sum) {
      if (m.size && texts[SUM_KEY + s] !== sumText(m)) stale.add(s);
      if (pause && Date.now() - t0 >= budgetMs) { await pause(); t0 = Date.now(); }
    }
    for (const k of Object.keys(texts)) {
      const m = sum.get(k.slice(SUM_KEY.length));
      if (!m || !m.size) stale.add(k.slice(SUM_KEY.length));
    }
    const meta = sumWrite(stale);
    const id = stored.id || "s" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    if (!stored.id) meta.put.push([SUM_ID, id]);
    try {
      if (meta.put.length || meta.del.length) await backend.writeMeta(meta);
    } catch (_) { return null; }
    sumSeen = null;
    sumId = id;
    return id;
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
        // before `load` (a v1 library at launch) there is no summary to
        // keep; after it (games pulled back from the native store) there is
        await withSum(put, null, (m) => backend.put(put, m));
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

  /**
   * Write these entries (with their index), and the summary rows they
   * change. Rejects when the store refuses — then neither is written, and
   * the rows in memory are written with the next save of their shard.
   */
  async function save(entries) {
    if (!entries.length) return true;
    return withSum(entries, null, (m) => backend.put(entries.map(recordOf), m));
  }
  /** These records, as entries (a second window wrote them — and their rows). */
  async function read(ids) {
    const out = (await backend.get(ids)).filter((r) => r && typeof r.id === "string").map(take);
    if (sumOn) sumTouch(out);
    return out;
  }
  async function drop(ids) {
    for (const id of ids) pk.delete(id);
    return withSum(null, ids, (m) => backend.remove(ids, m));
  }
  /** Another window dropped these: out of this one's summary too, so its next write does not bring them back. */
  function forget(ids) { if (sumOn) sumTouch(null, ids); }

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
    sum.clear();
    return backend.clear();
  }

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
      await withSum(incoming, old, (m) => backend.replace(old, incoming, m));
      for (const id of old) pk.delete(id);
      games = incoming.slice().sort(newestFirst);
      return incoming.length;
    });
  }

  return {
    backend, pk, load, migrate, save, drop, read, forget, indexFens, indexMissing, halt, clear, shards, shardText, restoreShards, shardOf,
    readSummary, syncSummary,
    /** The summary's id once syncSummary has made the stored one right, else null (v8-1-plan F3). */
    sumId: () => sumId,
    get games() { return games; }, set games(v) { games = v; },
    get local() { return local; }, set local(v) { local = v; },
    pkOf: (g) => (g ? pk.get(g.id) || null : null),
  };
}

export const LibraryDb = { DB_NAME, idbBackend, memoryBackend, createLibraryStore, mergeEntry, badCount, summaryOf, stubOf, newestFirst };
