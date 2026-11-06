/**
 * The native db backend (src/app/services/db-native.js) in Node: the db
 * contract against node:sqlite standing in for the SDK's store — the schema
 * read out of src/db_migrations.zig, chess.dbExec / chess.dbQuery answered
 * the way src/db.zig answers them (one transaction per exec, rows as arrays,
 * booleans as 0/1). The same suite runs in the app against the real store
 * (the `app-db` automation scenario, scripts/automation-app.mjs).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createDb, TABLES, cmpKey } from "../../src/app/services/db.js";
import { nativeBackend, encodeKey, nativeDbAvailable } from "../../src/app/services/db-native.js";
import dbContract from "./db-contract.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// a Windows checkout has CRLF; the parse below is line by line on "\n"
const MIGRATIONS_ZIG = fs.readFileSync(path.join(ROOT, "src/db_migrations.zig"), "utf8").replace(/\r\n/g, "\n");

/** The SQL of each migration in src/db_migrations.zig (multiline `\\` strings). */
export function migrationSql(zig = MIGRATIONS_ZIG) {
  const out = [];
  for (const block of zig.split(".sql =").slice(1)) {
    const lines = [];
    for (const l of block.split("\n").slice(1)) {
      const m = /^\s*\\\\(.*)$/.exec(l);
      if (!m) break;
      lines.push(m[1]);
    }
    out.push(lines.join("\n"));
  }
  return out;
}

let sqlite = null;
try {
  process.removeAllListeners("warning");
  sqlite = await import("node:sqlite");
} catch { sqlite = null; }

/** chess.dbExec / chess.dbQuery as src/db.zig answers them, on one node:sqlite database. */
export function fakeNativeBridge() {
  const db = new sqlite.DatabaseSync(":memory:");
  for (const sql of migrationSql()) db.exec(sql);
  const bind = (params = []) => params.map((p) => (typeof p === "boolean" ? (p ? 1 : 0) : p));
  const calls = { exec: 0, query: 0 };
  async function invoke(cmd, payload) {
    // the bridge carries JSON: what goes in is what a WebView would send
    payload = JSON.parse(JSON.stringify(payload));
    if (cmd === "chess.dbExec") {
      calls.exec++;
      if (!payload.stmts || !payload.stmts.length || payload.stmts.length > 64) return { error: "bad_request" };
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const s of payload.stmts) db.prepare(s.sql).run(...bind(s.params));
        db.exec("COMMIT");
        return { ok: true };
      } catch (e) {
        db.exec("ROLLBACK");
        return { error: /constraint/i.test(e.message) ? "constraint" : "misuse" };
      }
    }
    if (cmd === "chess.dbQuery") {
      calls.query++;
      const st = db.prepare(payload.sql);
      return { rows: st.all(...bind(payload.params)).map((r) => Object.values(r)) };
    }
    throw new Error("no such command " + cmd);
  }
  return { invoke, calls, db };
}

export default function (test) {
  test("db-native: encodeKey sorts as cmpKey does", (a) => {
    const keys = [["b", 2], "b", 10, ["a", 10], ["a", 2], "a", 2, ["a"], Infinity, -1, 0, -Infinity, 1.5, "", "ab", "a\u0000", "￿",
      ["000000000abcd", 0], ["000000000abcd", 159], ["000000000abcd", Infinity], ["000000000abce", 0], []];
    const byCmp = keys.slice().sort(cmpKey);
    const byEnc = keys.slice().sort((x, y) => (encodeKey(x) < encodeKey(y) ? -1 : encodeKey(x) > encodeKey(y) ? 1 : 0));
    a.deepEqual(byEnc, byCmp);
    a.ok(keys.every((x) => /^[0-9a-f]+$/.test(encodeKey(x))), "plain hex: no byte SQLite could compare oddly");
  });

  test("db-native: the schema in src/db_migrations.zig is db.js's tables", (a) => {
    const [v1] = migrationSql();
    const made = [...v1.matchAll(/CREATE TABLE (\w+) \(k TEXT PRIMARY KEY NOT NULL, v TEXT NOT NULL\) WITHOUT ROWID;/g)].map((m) => m[1]);
    a.deepEqual(made.sort(), Object.keys(TABLES).sort());
    a.equal(migrationSql().length, 1, "schema v1 is one migration, as in db.js");
  });

  if (!sqlite) {
    test("db-native: node:sqlite is there (Node ≥ 22.5)", (a) => a.ok(false, "no node:sqlite in " + process.version));
    return;
  }

  const bridge = fakeNativeBridge();
  dbContract(test, (name) => createDb(nativeBackend(name, bridge.invoke)), "native (node:sqlite): ");

  test("db-native: a task's appends are one chess.dbExec; a big range comes in pages", async (a) => {
    const b = fakeNativeBridge();
    const db = await createDb(nativeBackend("pages", b.invoke));
    const e0 = b.calls.exec;
    const all = [];
    for (let i = 0; i < 600; i++) all.push(db.append({ type: "game.move", gameId: "g", ply: i, uci: "e2e4", san: "e4" }));
    await Promise.all(all);
    a.equal(b.calls.exec - e0, 1, "600 appends with their projections, one exec");
    const q0 = b.calls.query;
    const moves = await db.query("game.moves", { gameId: "g" });
    a.equal(moves.length, 600);
    a.deepEqual(moves.slice(0, 3).map((m) => m.ply), [0, 1, 2]);
    a.ok(b.calls.query - q0 >= 3, "in pages of 256");
    const back = await db.query("events.since", { after: 0, limit: 1000 });
    a.equal(back.length, 600);
    const recent = await nativeBackend("pages", b.invoke).range("moves", null, null, { reverse: true, limit: 300 });
    a.deepEqual(recent.slice(0, 2).map((m) => m.ply), [599, 598]);
    a.equal(recent.length, 300);
    a.equal(recent[299].ply, 300);
    await db.close();
  });

  test("db-native: a page too big for the bridge comes in smaller pages; a big batch in parts", async (a) => {
    const b = fakeNativeBridge();
    const inner = b.invoke;
    // the frame: an answer over 1 MiB is refused, as src/db.zig refuses it
    const invoke = async (cmd, p) => { const r = await inner(cmd, p); return cmd === "chess.dbQuery" && JSON.stringify(r).length > 1048576 ? { error: "too_big" } : r; };
    const be = nativeBackend("big", invoke);
    await be.open();
    const pgn = "1. e4 e5 ".repeat(1500);
    const ops = Array.from({ length: 300 }, (_, i) => ({ put: "library", value: { id: "g" + String(i).padStart(3, "0"), pgn } }));
    const e0 = b.calls.exec;
    await be.write(ops);
    a.ok(b.calls.exec - e0 > 1, "4 MB of rows went in more than one call (" + (b.calls.exec - e0) + ")");
    const all = await be.range("library", null, null);
    a.equal(all.length, 300);
    a.equal(all[299].id, "g299");
  });

  test("db-native: a merge keeps booleans, objects and nulls as JSON", async (a) => {
    const b = fakeNativeBridge();
    const db = await createDb(nativeBackend("merge", b.invoke));
    db.append({ type: "game.start", gameId: "m", mode: "engine", coach: true, tc: { base: 300, inc: 2 }, engineColor: "b" });
    db.append({ type: "game.end", gameId: "m", result: "0-1", reason: "mate" });
    const g = await db.query("game.get", { id: "m" });
    a.equal(g.coach, true);
    a.deepEqual(g.tc, { base: 300, inc: 2 });
    a.deepEqual(g.result, { result: "0-1", reason: "mate" });
    db.append({ type: "game.undo", gameId: "m", ply: 0 });
    a.equal((await db.query("game.get", { id: "m" })).result, null, "result: null is kept, not dropped");
    await db.close();
  });

  test("db-native: available only where the bridge answers", async (a) => {
    a.equal(await nativeDbAvailable(null), false);
    a.equal(await nativeDbAvailable(async () => ({ error: "no_db" })), false);
    a.equal(await nativeDbAvailable(fakeNativeBridge().invoke), true);
  });
}
