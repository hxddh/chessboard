/**
 * PGN import (library/import.js, ADR 0003 「导入」): many games with comments,
 * variations and NAGs; 19.0's 「导出全部数据」 (fixtures/v19-export.json, the
 * shape io.js / persist.js write); a malformed file (fixtures/malformed.pgn):
 * the good games come in, each bad one is named by its line; re-importing
 * adds nothing; the events land in the library table and feed the learner
 * model; a large file yields while it is read.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { readGames, importFile, splitChunks, hashText, inferName, ImportError } from "../../src/app/library/import.js";
import { createDb, memoryBackend } from "../../src/app/services/db.js";
import { project } from "../../src/app/learn/model.js";
import { nativeOpen, FileError } from "../../src/app/services/files.js";

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const read = (f) => fs.readFileSync(path.join(FIX, f), "utf8");
const noPause = () => Promise.resolve();

const STUDY = `[Event "Study"]
[White "Me"]
[Black "Rival"]
[BlackElo "1320"]
[Result "1-0"]

1. e4 {the king's pawn} e5 2. Nf3 $1 (2. f4 exf4 {gambit}) 2... Nc6 3. Bc4!? ; a line comment
Bc5 4. O-O Nf6 5. d3 1-0

[Event "Second"]
[White "Other"]
[Black "Me"]
[WhiteElo "1500"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 c6 3. Nf3 Nf6 1/2-1/2

1. c4 e5 *
`;

export default function (test) {
  test("import: comments, variations, NAGs, several games; the mainline is kept", async (a) => {
    const r = await readGames(STUDY, { pause: noPause });
    a.equal(r.kind, "pgn");
    a.equal(r.games.length, 3);
    a.equal(r.games[0].sans, "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 d3", "not the f4 variation");
    a.equal(r.games[0].white, "Me"); a.equal(r.games[0].result, "1-0");
    a.equal(r.games[2].sans, "c4 e5", "a game with no tags still comes");
    a.equal(r.you, "Me", "the name in most games is yours");
    a.equal(r.games[0].you, "w"); a.equal(r.games[0].opp, 1320);
    a.equal(r.games[1].you, "b"); a.equal(r.games[1].opp, 1500);
    a.equal(r.games[2].you, null);
    a.equal(r.bad.length, 0);
  });

  test("import: a malformed file — the good games come, each bad one named by its line", async (a) => {
    const r = await readGames(read("malformed.pgn"), { pause: noPause });
    a.equal(r.games.length, 1, "one good game");
    a.equal(r.games[0].white, "Alice");
    a.equal(r.empty, 1, "the game with no moves is counted, not imported");
    a.deepEqual(r.bad.map((b) => b.code), ["illegal", "brackets", "fen"]);
    a.equal(r.bad[0].token, "Nf9");
    a.equal(r.bad[0].line, 15, "the illegal move's own line in the file");
    a.ok(r.bad.every((b) => b.line > 0 && b.n > 0));
  });

  test("import: a file that is not games says why", async (a) => {
    const code = async (text) => { try { await readGames(text, { pause: noPause }); return null; } catch (e) { return e instanceof ImportError ? e.code : e.message; } };
    a.equal(await code(""), "empty");
    a.equal(await code("   \n "), "empty");
    a.equal(await code("hello, this is a shopping list\nmilk\neggs"), "noGames");
    a.equal(await code("{\"a\": 1}"), "notExport");
    a.equal(await code("{not json"), "badJson");
    a.equal(await code("PK\u0003\u0004\u0000\u0000binary"), "binary");
    a.equal(await code(JSON.stringify({ app: "chessboard", schema: 3, keys: { settings: "{}" } })), "v19NoGames");
  });

  test("import: 19.0's 「导出全部数据」 — history, library, slots; what each knows", async (a) => {
    const r = await readGames(read("v19-export.json"), { pause: noPause });
    a.equal(r.kind, "v19");
    const by = (src) => r.games.filter((g) => g.source === src);
    a.equal(by("19.0-history").length, 3, "three history games with moves (one empty record is skipped)");
    a.equal(by("19.0-library").length, 2);
    a.equal(by("19.0-slot").length, 1);
    const [r1, r2, r3] = by("19.0-history");
    a.deepEqual([r1.you, r1.result, r1.opp], ["w", "1-0", 532], "a win as White against 皮普 (beginner, 532)");
    a.equal(r1.sans, "e4 e5 Bc4 Nc6 Qh5 Nf6 Qxf7#");
    a.deepEqual([r2.you, r2.result], ["b", "1-0"], "a loss as Black");
    a.ok(Number.isFinite(r2.opp), "a ladder-3 rung has its rating");
    a.equal(r2.sans, "d4 d5 c4 e6 Nc3 Nf6", "comments, the variation and $1 dropped");
    a.equal(r3.opp, null, "an unrated (set-up) game is not rated");
    a.equal(r3.startFen, "8/8/8/4k3/8/8/4P3/4K3 w - - 0 1");
    a.equal(r1.playedAt, 1760000000000);
    const lib = by("19.0-library");
    a.equal(lib[0].white, "Kasparov"); a.equal(lib[0].site, "Wijk aan Zee"); a.equal(lib[0].you, null);
    a.equal(lib[1].you, "w", "a claimed side comes across");
    a.equal(lib[1].result, "0-1");
  });

  test("import: events into the library; re-import adds nothing; the model rates what it can", async (a) => {
    const db = await createDb(memoryBackend({}));
    const r = await importFile(read("v19-export.json"), { db, name: "chessboard-all.json", pause: noPause });
    a.equal(r.added, 6);
    a.equal(await db.query("table.count", { table: "library" }), 6);
    const again = await importFile(read("v19-export.json"), { db, pause: noPause });
    a.equal(again.added, 0); a.equal(again.dup, 6);
    const r3 = await importFile(STUDY, { db, pause: noPause });
    a.equal(r3.added, 3);
    a.equal(await db.query("table.count", { table: "library" }), 9);
    const events = await db.query("events.since", { after: 0, limit: 100 });
    a.equal(events.filter((e) => e.type === "game.import").length, 9);
    a.equal(events.filter((e) => e.type === "import.file").length, 3);
    a.equal(events.find((e) => e.type === "import.file").name, "chessboard-all.json");
    const row = (await db.query("library.ids")).length;
    a.equal(row, 9);
    const st = project(events);
    a.equal(st.imported, 9);
    // rated: 19.0 r1 (532), r2 (ladder 3), and Me's two games with an Elo
    a.equal(st.games, 4);
    a.ok(st.game && Number.isFinite(st.game.r));
  });

  test("files: the native dialog's pieces, cancel, no dialog, too large", async (a) => {
    const text = "[Event \"中文\"]\n\n1. e4 e5 *\n".repeat(20);
    const bytes = new TextEncoder().encode(text);
    const b64 = (u) => Buffer.from(u).toString("base64");
    const calls = [];
    // pieces of 7 bytes: a boundary falls inside a UTF-8 character
    const invoke = async (cmd, p) => {
      calls.push(p);
      const off = p.offset || 0;
      return { name: "a.pgn", b64: b64(bytes.subarray(off, off + 7)), more: off + 7 < bytes.length, token: 3 };
    };
    const r = await nativeOpen(invoke, { title: "t", max: 1 << 20 });
    a.equal(r.text, text, "decoded whole");
    a.equal(r.name, "a.pgn");
    a.ok(calls.slice(1).every((p) => p.token === 3 && p.offset > 0));
    a.equal(await nativeOpen(async () => ({ cancelled: true }), { max: 10 }), null);
    a.equal(await nativeOpen(async () => ({ error: "no_dialog" }), { max: 10 }), undefined);
    await a.rejects(() => nativeOpen(async () => ({ tooLarge: true, limit: 5 }), { max: 10 }));
    let e = null;
    try { await nativeOpen(invoke, { max: 20 }); } catch (err) { e = err; }
    a.ok(e instanceof FileError && e.code === "tooLarge", "past `max` while reading: too large");
  });

  test("import: ids are stable, and differ for different games", (a) => {
    a.equal(hashText("abc"), hashText("abc"));
    a.ok(hashText("abc") !== hashText("abd"));
    a.equal(hashText("").length, 16);
    a.equal(inferName([{ white: "x", black: "y" }]), null, "one game says nothing about whose it is");
  });

  test("import: a large file yields while it is read, and every game comes", async (a) => {
    const one = (i) => `[Event "G${i}"]\n[White "P${i % 7}"]\n[Black "Q${i % 5}"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 1-0\n`;
    const text = Array.from({ length: 1500 }, (_, i) => one(i)).join("\n");
    let pauses = 0, clock = 0;
    const chunks = await splitChunks(text, { pause: async () => { pauses++; }, now: () => (clock += 1) });
    a.equal(chunks.length, 1500);
    pauses = 0; clock = 0;
    const r = await readGames(text, { pause: async () => { pauses++; }, now: () => (clock += 5) });
    a.equal(r.games.length, 1500);
    a.ok(pauses > 50, "it handed the thread back (" + pauses + " times)");
  });
}
