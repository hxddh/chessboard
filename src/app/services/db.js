/**
 * The db service (ADR 0003): one append-only event table is the truth, the
 * other tables are projections of it, and pages talk to it through two calls:
 *
 *   append(event)        → Promise<stored event>   (id and time assigned)
 *   query(name, params)  → Promise<result>          (named reads, below)
 *
 * Appends made in the same task are written together, in one transaction,
 * with their projections. A query first waits for those writes, so a page
 * always reads what it just appended.
 *
 * Two backends share this file: memory (Node tests) and IndexedDB (browser,
 * dev server, e2e). The native SQLite backend comes with the SDK work and
 * must pass the same contract suite (scripts/app/db-contract.mjs).
 * @module services/db
 */

/** Schema v1: table → key path. Projections and queries below are the only writers/readers. */
export const TABLES = {
  events: "id",
  games: "id",
  moves: ["gameId", "ply"],
  analysis: ["gameId", "ply"],
  skills: "id",
  cards: "id",
  repertoire: "id",
  library: "id",
  settings: "key",
};

/**
 * Forward-only migrations; index i takes the schema from version i to i + 1.
 * Each receives `createTable(name, keyPath)`.
 */
export const MIGRATIONS = [
  (createTable) => { for (const [name, key] of Object.entries(TABLES)) createTable(name, key); },
];
export const SCHEMA_VERSION = MIGRATIONS.length;

const MAX = Infinity;

/** Event → the writes that keep the projections in step. */
const PROJECT = {
  "game.start": (e) => [{ put: "games", value: { id: e.gameId, mode: e.mode, engineColor: e.engineColor || null,
    startFen: e.startFen, opponent: e.opponent || null, coach: !!e.coach, tc: e.tc || null, startedAt: e.at, result: null } }],
  "game.move": (e) => [{ put: "moves", value: e.clock ? { gameId: e.gameId, ply: e.ply, uci: e.uci, san: e.san, clock: e.clock }
    : { gameId: e.gameId, ply: e.ply, uci: e.uci, san: e.san } }],
  "game.undo": (e) => [
    { delRange: "moves", lower: [e.gameId, e.ply], upper: [e.gameId, MAX] },
    { merge: "games", key: e.gameId, patch: { result: null } },
  ],
  "game.end": (e) => [{ merge: "games", key: e.gameId, patch: { result: { result: e.result, reason: e.reason }, endedAt: e.at } }],
  "settings.set": (e) => [{ put: "settings", value: { key: e.key, value: e.value } }],
  /** A finished review: one row per position of the game (ply = position index, 0 the start). */
  "review.analysis": (e) => [
    { delRange: "analysis", lower: [e.gameId, 0], upper: [e.gameId, MAX] },
    ...e.rows.map((r, i) => ({ put: "analysis", value: { ...r, gameId: e.gameId, ply: i } })),
    { merge: "games", key: e.gameId, patch: { analysed: { at: e.at, budget: e.budget || null } } },
  ],
  "review.done": (e) => [{ merge: "games", key: e.gameId, patch: { reviewed: e.at } }],
};

/** Named reads. `r` is the backend's reader: get, range, count. */
const QUERIES = {
  "game.get": (r, { id }) => r.get("games", id),
  "game.moves": (r, { gameId }) => r.range("moves", [gameId, 0], [gameId, MAX]),
  "game.recent": (r, { limit = 20 } = {}) => r.range("games", null, null, { reverse: true, limit }),
  /** The latest game with its moves, or null. */
  "game.current": async (r) => {
    const [game] = await r.range("games", null, null, { reverse: true, limit: 1 });
    if (!game) return null;
    return { game, moves: await r.range("moves", [game.id, 0], [game.id, MAX]) };
  },
  /** The review's rows for a game, by position; [] when it was never reviewed. */
  "analysis.get": (r, { gameId }) => r.range("analysis", [gameId, 0], [gameId, MAX]),
  "events.since": (r, { after = 0, limit = 1000 } = {}) => r.range("events", after + 1, MAX, { limit }),
  "settings.all": async (r) => Object.fromEntries((await r.range("settings", null, null)).map((s) => [s.key, s.value])),
  "table.count": (r, { table }) => {
    if (!TABLES[table]) throw new Error("db: no table " + table);
    return r.count(table);
  },
};
export const QUERY_NAMES = Object.keys(QUERIES);

/** Time-ordered ids: base-36 milliseconds (fixed width until 2059) and a random tail. */
export function newId(now = Date.now()) {
  return now.toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 6);
}

const enc = new TextEncoder();
/** Bytes a row takes as JSON — the measure `stats().bytes` reports. */
export const sizeOf = (v) => enc.encode(JSON.stringify(v)).length;

/**
 * @param {object} backend memoryBackend() or idbBackend(name)
 * @param {{ now?: () => number, schedule?: (fn: () => void) => void }} [opts]
 */
export async function createDb(backend, { now = () => Date.now(), schedule = queueMicrotask } = {}) {
  let { lastEventId } = await backend.open();
  let pending = [];          // [{ event, resolve, reject }]
  let inFlight = Promise.resolve();
  let scheduled = false;
  const stats = { events: 0, writes: 0, bytes: 0 };
  let closed = false;

  function flush() {
    scheduled = false;
    if (!pending.length) return inFlight;
    const batch = pending;
    pending = [];
    const ops = [];
    for (const { event } of batch) {
      ops.push({ put: "events", value: event });
      const p = PROJECT[event.type];
      if (p) ops.push(...p(event));
    }
    inFlight = inFlight.then(() => backend.write(ops)).then((bytes) => {
      stats.events += batch.length;
      stats.writes++;
      stats.bytes += bytes;
      for (const b of batch) b.resolve(b.event);
    }, (err) => {
      for (const b of batch) b.reject(err);
    });
    return inFlight;
  }

  return {
    append(event) {
      if (closed) return Promise.reject(new Error("db: closed"));
      if (!event || typeof event.type !== "string") return Promise.reject(new Error("db: an event needs a type"));
      const stored = Object.freeze({ ...event, id: ++lastEventId, at: event.at ?? now() });
      return new Promise((resolve, reject) => {
        pending.push({ event: stored, resolve, reject });
        if (!scheduled) { scheduled = true; schedule(flush); }
      });
    },
    async query(name, params = {}) {
      const q = QUERIES[name];
      if (!q) throw new Error("db: no query " + name);
      await flush().catch(() => {});
      return q(backend, params);
    },
    /** Write whatever is pending now (e.g. on pagehide). */
    flush: () => flush(),
    stats: () => ({ ...stats }),
    async close() { await flush().catch(() => {}); closed = true; backend.close(); },
  };
}

// --- keys -------------------------------------------------------------------

/** IndexedDB's key order: number < string < array, arrays element by element. */
export function cmpKey(a, b) {
  const rank = (k) => (typeof k === "number" ? 1 : typeof k === "string" ? 2 : 3);
  const ra = rank(a), rb = rank(b);
  if (ra !== rb) return ra - rb;
  if (ra === 3) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = cmpKey(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

const keyOf = (path, v) => (Array.isArray(path) ? path.map((p) => v[p]) : v[path]);

// --- memory backend ---------------------------------------------------------

/**
 * Rows kept in sorted arrays. Pass the same `data` object to a later
 * memoryBackend() to "reopen" it.
 */
export function memoryBackend(data = {}) {
  for (const t of Object.keys(TABLES)) data[t] ||= [];
  const find = (rows, key) => {
    let lo = 0, hi = rows.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cmpKey(rows[mid].k, key) < 0) lo = mid + 1; else hi = mid; }
    return lo;
  };
  const put = (table, value) => {
    const rows = data[table], k = keyOf(TABLES[table], value), i = find(rows, k);
    const row = { k, v: structuredClone(value) };
    if (rows[i] && cmpKey(rows[i].k, k) === 0) rows[i] = row; else rows.splice(i, 0, row);
    return sizeOf(value);
  };
  const clone = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    async open() {
      const ev = data.events;
      return { lastEventId: ev.length ? ev[ev.length - 1].k : 0 };
    },
    async write(ops) {
      let bytes = 0;
      for (const op of ops) {
        if (op.put) bytes += put(op.put, op.value);
        else if (op.merge) {
          const rows = data[op.merge], i = find(rows, op.key);
          if (rows[i] && cmpKey(rows[i].k, op.key) === 0) bytes += put(op.merge, { ...rows[i].v, ...op.patch });
        } else if (op.delRange) {
          const rows = data[op.delRange];
          const i = find(rows, op.lower);
          let j = i;
          while (j < rows.length && cmpKey(rows[j].k, op.upper) <= 0) j++;
          rows.splice(i, j - i);
        }
      }
      return bytes;
    },
    async get(table, key) {
      const rows = data[table], i = find(rows, key);
      return rows[i] && cmpKey(rows[i].k, key) === 0 ? clone(rows[i].v) : undefined;
    },
    async range(table, lower, upper, { reverse = false, limit = Infinity } = {}) {
      const rows = data[table];
      let out = rows.filter((r) => (lower == null || cmpKey(r.k, lower) >= 0) && (upper == null || cmpKey(r.k, upper) <= 0));
      if (reverse) out = out.reverse();
      return out.slice(0, limit).map((r) => clone(r.v));
    },
    async count(table) { return data[table].length; },
    close() {},
  };
}

// --- IndexedDB backend ------------------------------------------------------

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

/** @param {string} name database name @param {IDBFactory} [idb] */
export function idbBackend(name, idb = globalThis.indexedDB) {
  let db = null;
  const bound = (lower, upper) =>
    lower == null && upper == null ? null :
    lower == null ? IDBKeyRange.upperBound(upper) :
    upper == null ? IDBKeyRange.lowerBound(lower) : IDBKeyRange.bound(lower, upper);
  const store = (table, mode = "readonly") => db.transaction(table, mode).objectStore(table);

  return {
    async open() {
      const r = idb.open(name, SCHEMA_VERSION);
      r.onupgradeneeded = (ev) => {
        const d = r.result;
        for (let v = ev.oldVersion; v < SCHEMA_VERSION; v++) {
          MIGRATIONS[v]((t, keyPath) => d.createObjectStore(t, { keyPath }));
        }
      };
      db = await req(r);
      const cur = await req(store("events").openKeyCursor(null, "prev"));
      return { lastEventId: cur ? cur.key : 0 };
    },
    write(ops) {
      const tables = [...new Set(ops.map((o) => o.put || o.merge || o.delRange))];
      const tx = db.transaction(tables, "readwrite");
      let bytes = 0;
      for (const op of ops) {
        if (op.put) { tx.objectStore(op.put).put(op.value); bytes += sizeOf(op.value); }
        else if (op.delRange) tx.objectStore(op.delRange).delete(IDBKeyRange.bound(op.lower, op.upper));
        else if (op.merge) {
          const s = tx.objectStore(op.merge);
          const g = s.get(op.key);
          g.onsuccess = () => {
            if (!g.result) return;
            const v = { ...g.result, ...op.patch };
            s.put(v);
            bytes += sizeOf(v);
          };
        }
      }
      return new Promise((res, rej) => {
        tx.oncomplete = () => res(bytes);
        tx.onerror = () => rej(tx.error);
        tx.onabort = () => rej(tx.error || new Error("db: transaction aborted"));
      });
    },
    get: (table, key) => req(store(table).get(key)),
    async range(table, lower, upper, { reverse = false, limit = Infinity } = {}) {
      const s = store(table), kr = bound(lower, upper);
      if (!reverse) return req(s.getAll(kr, limit === Infinity ? undefined : limit));
      const out = [];
      await new Promise((res, rej) => {
        const c = s.openCursor(kr, "prev");
        c.onerror = () => rej(c.error);
        c.onsuccess = () => {
          const cur = c.result;
          if (!cur || out.length >= limit) return res();
          out.push(cur.value);
          cur.continue();
        };
      });
      return out;
    },
    count: (table) => req(store(table).count()),
    close() { if (db) db.close(); db = null; },
  };
}

/** Delete a whole IndexedDB database (tests, "start over"). */
export function idbDelete(name, idb = globalThis.indexedDB) {
  return req(idb.deleteDatabase(name));
}
