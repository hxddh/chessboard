/**
 * The db service's native backend (ADR 0003, v20-0-plan A2): the SDK's SQLite
 * store, which the app opens when its manifest declares `sqlite`
 * (gen-manifest.mjs --ui app; schema in src/db_migrations.zig), reached over
 * two bridge commands (src/db.zig):
 *
 *   chess.dbExec  {stmts:[{sql, params}]}  one transaction for the array
 *   chess.dbQuery {sql, params}            → {rows:[[…]]}
 *
 * It is the same backend interface as memoryBackend / idbBackend in db.js
 * (open, write, get, range, count, close), so createDb() batches appends the
 * same way — one task's appends, with their projections, are one chess.dbExec
 * — and it passes the same contract (scripts/app/db-contract.mjs): in Node
 * against node:sqlite running this SQL (db-native.test.mjs), and in the app
 * against the real store (the `app-db` automation scenario).
 *
 * Every table is (k TEXT PRIMARY KEY, v TEXT): `v` the row as JSON, `k` the
 * row's key encoded so that SQLite's byte order is IndexedDB's key order
 * (encodeKey), behind a prefix for the database's name — one file holds the
 * app's database and, in a test, any number of fresh ones.
 * @module services/db-native
 */
import { TABLES, sizeOf } from "./db.js";

/** The SDK's limits (relational_store.zig): statements per transaction, rows per read here. */
const MAX_STMTS = 64;
const PAGE_ROWS = 256;
/**
 * A bridge message is at most 1 MiB (SDK bridge max_message_bytes), and a row
 * run's JSON goes in as a string, escaped once more: runs of 128 KB, calls of
 * at most 512 KB of statements.
 */
const MAX_PARAM_BYTES = 128 * 1024;
const MAX_CALL_BYTES = 512 * 1024;

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

/** A float64 as 16 hex digits whose text order is numeric order. */
function sortableNumber(n) {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setFloat64(0, n === 0 ? 0 : n);
  if (b[0] & 0x80) for (let i = 0; i < 8; i++) b[i] = ~b[i] & 0xff;
  else b[0] |= 0x80;
  let s = "";
  for (const x of b) s += HEX[x];
  return s;
}

/**
 * A key as text that sorts the way IndexedDB sorts keys (db.js cmpKey):
 * numbers < strings < arrays, strings by UTF-16 code unit, arrays element by
 * element with a shorter prefix first. Every piece is self-delimiting and
 * every terminator ("0") sorts before any continuation.
 */
export function encodeKey(k) {
  if (typeof k === "number") {
    if (Number.isNaN(k)) throw new Error("db: NaN is not a key");
    return "1" + sortableNumber(k);
  }
  if (typeof k === "string") {
    let s = "2";
    for (let i = 0; i < k.length; i++) s += "1" + k.charCodeAt(i).toString(16).padStart(4, "0");
    return s + "0";
  }
  if (Array.isArray(k)) return "3" + k.map(encodeKey).join("") + "0";
  throw new Error("db: not a key: " + JSON.stringify(k));
}

const hexName = (name) => [...new TextEncoder().encode(String(name))].map((x) => HEX[x]).join("");
const keyOf = (path, v) => (Array.isArray(path) ? path.map((p) => v[p]) : v[path]);

function tableName(t) {
  if (!Object.prototype.hasOwnProperty.call(TABLES, t)) throw new Error("db: no table " + t);
  return t;
}

/**
 * The bridge the app's WebView has, or null: `invoke(command, payload)`.
 * @returns {null | ((cmd: string, payload: object) => Promise<any>)}
 */
export function zeroInvoke(g = globalThis) {
  const z = g.zero;
  return z && typeof z.invoke === "function" ? (cmd, payload) => z.invoke(cmd, payload) : null;
}

/** Whether the native store answers (false outside the app, or when the manifest has no `sqlite`). */
export async function nativeDbAvailable(invoke = zeroInvoke()) {
  if (!invoke) return false;
  try {
    const r = await invoke("chess.dbQuery", { sql: "SELECT count(*) FROM events" });
    return !!(r && Array.isArray(r.rows));
  } catch {
    return false;
  }
}

/**
 * @param {string} name the database (the app's is "chessboard")
 * @param {(cmd: string, payload: object) => Promise<any>} [invoke]
 */
export function nativeBackend(name, invoke = zeroInvoke()) {
  if (!invoke) throw new Error("db: no native bridge");
  const ns = hexName(name) + ":";
  const k = (key) => ns + encodeKey(key);
  const lo = (key) => (key == null ? ns : k(key));
  const hi = (key) => (key == null ? ns + "~" : k(key));

  async function call(cmd, payload) {
    const r = await invoke(cmd, payload);
    if (!r || r.error) throw new Error("db: " + cmd + ": " + (r ? r.error : "no answer"));
    return r;
  }
  const rows = async (sql, params) => (await call("chess.dbQuery", { sql, params })).rows;

  /** db.js's write ops as SQL: runs of puts into one table become one INSERT. */
  function statements(ops) {
    const out = [];
    let bytes = 0;
    let run = null; // { table, rows, size }
    const endRun = () => {
      if (!run) return;
      out.push({ sql: "INSERT OR REPLACE INTO " + run.table + "(k, v) SELECT json_extract(j.value, '$[0]'), json_extract(j.value, '$[1]') FROM json_each(?1) AS j",
        params: [JSON.stringify(run.rows)] });
      run = null;
    };
    // the event log first: its rows depend on nothing else in the batch
    const events = ops.filter((o) => o.put === "events");
    for (const op of [...events, ...ops.filter((o) => o.put !== "events")]) {
      if (op.put) {
        const table = tableName(op.put), v = JSON.stringify(op.value);
        bytes += sizeOf(op.value);
        if (!run || run.table !== table || run.size + v.length > MAX_PARAM_BYTES) { endRun(); run = { table, rows: [], size: 0 }; }
        run.rows.push([k(keyOf(TABLES[table], op.value)), v]);
        run.size += v.length;
        continue;
      }
      endRun();
      if (op.delRange) {
        out.push({ sql: "DELETE FROM " + tableName(op.delRange) + " WHERE k >= ?1 AND k <= ?2", params: [k(op.lower), k(op.upper)] });
      } else if (op.merge) {
        const t = tableName(op.merge);
        // a shallow merge, { ...row, ...patch }, in SQL so it sees this
        // batch's own writes; json() keeps objects, arrays and booleans JSON
        out.push({
          sql: "UPDATE " + t + " SET v = (SELECT json_group_object(key, CASE type WHEN 'true' THEN json('true') WHEN 'false' THEN json('false') " +
            "WHEN 'object' THEN json(value) WHEN 'array' THEN json(value) ELSE value END) FROM (SELECT key, type, value FROM json_each(" + t + ".v) " +
            "WHERE key NOT IN (SELECT key FROM json_each(?2)) UNION ALL SELECT key, type, value FROM json_each(?2))) WHERE k = ?1",
          params: [k(op.key), JSON.stringify(op.patch)],
        });
        bytes += sizeOf(op.patch);
      }
    }
    endRun();
    return { stmts: out, bytes };
  }

  return {
    async open() {
      const r = await rows("SELECT v FROM events WHERE k >= ?1 AND k <= ?2 ORDER BY k DESC LIMIT 1", [lo(null), hi(null)]);
      return { lastEventId: r.length ? JSON.parse(r[0][0]).id : 0 };
    },
    async write(ops) {
      const { stmts, bytes } = statements(ops);
      // one transaction when it fits one call (a task's appends always do);
      // a larger batch goes in order, in parts
      let part = [], size = 0;
      for (const st of stmts) {
        const n = JSON.stringify(st).length;
        if (part.length && (part.length === MAX_STMTS || size + n > MAX_CALL_BYTES)) {
          await call("chess.dbExec", { stmts: part });
          part = []; size = 0;
        }
        part.push(st);
        size += n;
      }
      if (part.length) await call("chess.dbExec", { stmts: part });
      return bytes;
    },
    async get(table, key) {
      const r = await rows("SELECT v FROM " + tableName(table) + " WHERE k = ?1", [k(key)]);
      return r.length ? JSON.parse(r[0][0]) : undefined;
    },
    async range(table, lower, upper, { reverse = false, limit = Infinity } = {}) {
      const t = tableName(table), out = [];
      let from = lo(lower), to = hi(upper), past = null, rowsPer = PAGE_ROWS;
      // in pages, by key, so no answer outgrows the bridge's frame; a page
      // after the first starts strictly past the last key it saw
      while (out.length < limit) {
        const n = Math.min(rowsPer, limit - out.length);
        const cond = past === null ? "k >= ?1 AND k <= ?2" : reverse ? "k >= ?1 AND k < ?2" : "k > ?1 AND k <= ?2";
        let page;
        try {
          page = await rows("SELECT k, v FROM " + t + " WHERE " + cond + " ORDER BY k " + (reverse ? "DESC" : "ASC") + " LIMIT ?3", [from, to, n]);
        } catch (e) {
          // big rows (a library's PGNs): fewer per page, down to one
          if (/too_big/.test(e.message) && n > 1) { rowsPer = Math.max(1, n >> 1); continue; }
          throw e;
        }
        for (const [, v] of page) out.push(JSON.parse(v));
        if (page.length < n) break;
        past = page[page.length - 1][0];
        if (reverse) to = past; else from = past;
      }
      return out;
    },
    async count(table) {
      const r = await rows("SELECT count(*) FROM " + tableName(table) + " WHERE k >= ?1 AND k <= ?2", [lo(null), hi(null)]);
      return r[0][0];
    },
    close() {},
  };
}
