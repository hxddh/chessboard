import { createStore } from "../../src/app/state/store.js";
import { playActions, initialPlay } from "../../src/app/state/play.js";
import { settingsActions, SETTINGS_DEFAULT, shellFor } from "../../src/app/state/settings.js";
import { persist, restore } from "../../src/app/state/persist.js";
import { createDb, memoryBackend } from "../../src/app/services/db.js";

const makeStore = () => createStore({ play: initialPlay, settings: SETTINGS_DEFAULT }, { ...playActions, ...settingsActions });

export default function (test) {
  test("persist: a game and the settings come back from the events alone", async (a) => {
    const data = {};
    let db = await createDb(memoryBackend(data));
    const st = makeStore();
    persist(st, db);
    st.dispatch("play.new", { id: "g1", mode: "engine", engineColor: "b" });
    for (const u of ["e2e4", "e7e5", "g1f3", "b8c6"]) st.dispatch("play.move", { uci: u });
    st.dispatch("play.undo", { plies: 2 });
    st.dispatch("play.move", { uci: "f1c4" });
    st.dispatch("settings.set", { key: "pieceSet", value: "classic" });
    await db.close();

    db = await createDb(memoryBackend(data));
    const back = makeStore();
    await restore(back, db, () => "new");
    const g = back.get().play.game;
    a.deepEqual(g.moves.map((m) => m.san), ["e4", "e5", "Bc4"]);
    a.equal(g.mode, "engine");
    a.equal(g.engineColor, "b");
    a.equal(back.get().settings.pieceSet, "classic");
  });

  test("persist: one event per move, and the end of a game is recorded once", async (a) => {
    const db = await createDb(memoryBackend({}));
    const st = makeStore();
    persist(st, db);
    st.dispatch("play.new", { id: "g", mode: "pvp" });
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) st.dispatch("play.move", { uci: u });
    const events = await db.query("events.since", { after: 0 });
    a.deepEqual(events.map((e) => e.type), ["game.start", "game.move", "game.move", "game.move", "game.move", "game.end"]);
    a.deepEqual((await db.query("game.get", { id: "g" })).result, { result: "0-1", reason: "checkmate" });
  });

  test("restore: a first run starts a fresh two-player game", async (a) => {
    const db = await createDb(memoryBackend({}));
    const st = makeStore();
    await restore(st, db, () => "fresh");
    a.equal(st.get().play.game.id, "fresh");
    a.equal(st.get().play.game.mode, "pvp");
  });

  test("settings: invalid values are refused or skipped; shells follow the board", (a) => {
    const st = makeStore();
    a.throws(() => st.dispatch("settings.set", { key: "pieceSet", value: "fantasy" }));
    st.dispatch("settings.load", { pieceSet: "fantasy", boardTheme: "blue", junk: 1 });
    a.deepEqual(st.get().settings, { ...SETTINGS_DEFAULT, boardTheme: "blue" });
    a.equal(shellFor("dark", "wood"), "wood");
    a.equal(shellFor("light", "green"), "notebook");
    a.equal(shellFor("system", "blue", true), "night");
    a.equal(shellFor("system", "wood", false), "day");
  });
}
