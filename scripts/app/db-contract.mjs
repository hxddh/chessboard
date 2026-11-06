/**
 * The db contract (ADR 0003, 0005): every backend passes the same cases.
 * Run in Node against memory (db.test.mjs) and in Chromium against IndexedDB
 * (test-app-e2e.mjs). Browser-safe: no Node imports.
 *
 * @param {Function} test harness `test(name, fn)`
 * @param {(name: string) => Promise<object>} open a db for `name`; the same
 *   name must reopen the same data after close()
 */
import { TABLES, QUERY_NAMES } from "../../src/app/services/db.js";

let seq = 0;
const fresh = () => "contract-" + Date.now() + "-" + (++seq);

export default function dbContract(test, open, label = "") {
  const t = (name, fn) => test(label + name, fn);

  t("a fresh db has every schema v1 table, empty", async (a) => {
    const db = await open(fresh());
    for (const table of Object.keys(TABLES)) a.equal(await db.query("table.count", { table }), 0, table);
    a.deepEqual(Object.keys(TABLES).sort(), ["analysis", "cards", "events", "games", "library", "moves", "repertoire", "settings", "skills"]);
    await db.close();
  });

  t("append assigns increasing ids and a time, and returns the stored event", async (a) => {
    const db = await open(fresh());
    const e1 = await db.append({ type: "note", text: "a" });
    const e2 = await db.append({ type: "note", text: "b", at: 5 });
    a.equal(e2.id, e1.id + 1);
    a.ok(typeof e1.at === "number" && e1.at > 0);
    a.equal(e2.at, 5, "a given time is kept");
    a.equal(e1.text, "a");
    await db.close();
  });

  t("an event without a type is refused", async (a) => {
    const db = await open(fresh());
    await a.rejects(db.append({}));
    await a.rejects(db.append(null));
    await db.close();
  });

  t("appends in one task are one write", async (a) => {
    const db = await open(fresh());
    const w0 = db.stats().writes;
    const all = [];
    for (let i = 0; i < 25; i++) all.push(db.append({ type: "note", i }));
    await Promise.all(all);
    a.equal(db.stats().writes - w0, 1);
    a.equal(db.stats().events, 25);
    await db.close();
  });

  t("a query sees what was just appended, without awaiting it", async (a) => {
    const db = await open(fresh());
    db.append({ type: "settings.set", key: "pieceSet", value: "merida" });
    a.deepEqual(await db.query("settings.all"), { pieceSet: "merida" });
    await db.close();
  });

  t("unknown queries are refused", async (a) => {
    const db = await open(fresh());
    await a.rejects(db.query("nope"));
    await a.rejects(db.query("table.count", { table: "nope" }));
    a.ok(QUERY_NAMES.includes("game.current"));
    await db.close();
  });

  t("game projections: start, moves in order, undo, end", async (a) => {
    const db = await open(fresh());
    const gameId = "g1";
    db.append({ type: "game.start", gameId, mode: "pvp", startFen: "start" });
    const ucis = ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5"];
    ucis.forEach((uci, ply) => db.append({ type: "game.move", gameId, ply, uci, san: uci }));
    let moves = await db.query("game.moves", { gameId });
    a.deepEqual(moves.map((m) => m.uci), ucis);
    db.append({ type: "game.undo", gameId, ply: 3 });
    moves = await db.query("game.moves", { gameId });
    a.deepEqual(moves.map((m) => m.ply), [0, 1, 2]);
    db.append({ type: "game.end", gameId, result: "1-0", reason: "resign" });
    const g = await db.query("game.get", { id: gameId });
    a.deepEqual(g.result, { result: "1-0", reason: "resign" });
    a.equal(g.mode, "pvp");
    a.ok(g.endedAt > 0);
    await db.close();
  });

  t("moves of one game never leak into another", async (a) => {
    const db = await open(fresh());
    for (const gameId of ["a", "b", "aa"]) {
      db.append({ type: "game.start", gameId, mode: "pvp" });
      for (let ply = 0; ply < 12; ply++) db.append({ type: "game.move", gameId, ply, uci: gameId + ply, san: "x" });
    }
    const b = await db.query("game.moves", { gameId: "b" });
    a.equal(b.length, 12);
    a.ok(b.every((m) => m.gameId === "b"));
    a.deepEqual(b.map((m) => m.ply), [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11], "numeric order, not text order");
    await db.close();
  });

  t("game.current is the latest game with its moves", async (a) => {
    const db = await open(fresh());
    a.equal(await db.query("game.current"), null);
    db.append({ type: "game.start", gameId: "0001", mode: "pvp" });
    db.append({ type: "game.start", gameId: "0002", mode: "engine", engineColor: "b" });
    db.append({ type: "game.move", gameId: "0002", ply: 0, uci: "d2d4", san: "d4" });
    const cur = await db.query("game.current");
    a.equal(cur.game.id, "0002");
    a.equal(cur.game.engineColor, "b");
    a.deepEqual(cur.moves.map((m) => m.san), ["d4"]);
    const recent = await db.query("game.recent", { limit: 5 });
    a.deepEqual(recent.map((g) => g.id), ["0002", "0001"]);
    await db.close();
  });

  t("settings: the last write wins", async (a) => {
    const db = await open(fresh());
    db.append({ type: "settings.set", key: "board", value: "wood" });
    db.append({ type: "settings.set", key: "board", value: "blue" });
    db.append({ type: "settings.set", key: "sound", value: false });
    a.deepEqual(await db.query("settings.all"), { board: "blue", sound: false });
    await db.close();
  });

  t("events.since pages through the log", async (a) => {
    const db = await open(fresh());
    let first = null;
    for (let i = 0; i < 10; i++) { const e = db.append({ type: "note", i }); if (!first) first = e; }
    const start = (await first).id;
    const page = await db.query("events.since", { after: start + 2, limit: 3 });
    a.deepEqual(page.map((e) => e.i), [3, 4, 5]);
    a.equal((await db.query("events.since", { after: start - 1 })).length, 10);
    await db.close();
  });

  t("data and the id sequence survive close and reopen", async (a) => {
    const name = fresh();
    let db = await open(name);
    db.append({ type: "game.start", gameId: "g", mode: "pvp" });
    const last = await db.append({ type: "game.move", gameId: "g", ply: 0, uci: "e2e4", san: "e4" });
    await db.close();
    db = await open(name);
    const cur = await db.query("game.current");
    a.equal(cur.game.id, "g");
    a.equal(cur.moves[0].san, "e4");
    const next = await db.append({ type: "note" });
    a.equal(next.id, last.id + 1);
    a.equal(await db.query("table.count", { table: "events" }), 3);
    await db.close();
  });

  t("autosave of a 160-ply game writes ≤ 100 KB (v20-0-plan §1)", async (a) => {
    const db = await open(fresh());
    const b0 = db.stats().bytes;
    const gameId = "000000000abcd";
    await db.append({ type: "game.start", gameId, mode: "engine", engineColor: "b",
      startFen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1" });
    // one task per move, the way a game is played
    for (let ply = 0; ply < 160; ply++) await db.append({ type: "game.move", gameId, ply, uci: "e2e4", san: "Nbxd7+" });
    const bytes = db.stats().bytes - b0;
    a.ok(bytes <= 100 * 1024, bytes + " bytes");
    a.ok(bytes / 160 < 400, (bytes / 160).toFixed(0) + " bytes per move");
    await db.close();
  });
}
