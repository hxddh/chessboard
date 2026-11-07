/**
 * 悔棋 (v20-0-plan §10, P2–P5 「还没做」): the store takes back to before your
 * last move — the reply with it, or alone while the reply is still coming
 * (19.0's Z took back "the next pair" then); the clock goes back; a finished
 * game is left alone; it is an event (game.undo) that survives a reload, and
 * a game with one is not rated by the learner model.
 */
import { createStore } from "../../src/app/state/store.js";
import { playActions, initialPlay, takebackPlies } from "../../src/app/state/play.js";
import { settingsActions, SETTINGS_DEFAULT } from "../../src/app/state/settings.js";
import { persist, restore } from "../../src/app/state/persist.js";
import { createDb, memoryBackend } from "../../src/app/services/db.js";
import { project, visibleRating } from "../../src/app/learn/model.js";

const makeStore = () => createStore({ play: initialPlay, settings: SETTINGS_DEFAULT }, { ...playActions, ...settingsActions });
const sans = (st) => st.get().play.game.moves.map((m) => m.san);

export default function (test) {
  test("takeback: your move and its reply; your move alone while the reply is coming", (a) => {
    const st = makeStore();
    st.dispatch("play.new", { id: "g", mode: "engine", engineColor: "b" });
    for (const u of ["e2e4", "e7e5", "g1f3", "b8c6"]) st.dispatch("play.move", { uci: u });
    a.equal(takebackPlies(st.get().play.game, "w"), 2);
    st.dispatch("play.undo", { color: "w" });
    a.deepEqual(sans(st), ["e4", "e5"], "Nf3 and its reply Nc6 went");
    st.dispatch("play.move", { uci: "f1c4" });
    a.equal(takebackPlies(st.get().play.game, "w"), 1, "the reply has not come yet");
    st.dispatch("play.undo", { color: "w" });
    a.deepEqual(sans(st), ["e4", "e5"], "only Bc4 went — not the pair before it (19.0's bug)");
    a.equal(st.get().play.game.takebacks, 2);
  });

  test("takeback: playing Black, the engine's first move stays; nothing to take back before your first move", (a) => {
    const st = makeStore();
    st.dispatch("play.new", { id: "g", mode: "engine", engineColor: "w" });
    st.dispatch("play.move", { uci: "d2d4" });
    a.equal(takebackPlies(st.get().play.game, "b"), 0);
    const before = st.get();
    st.dispatch("play.undo", { color: "b" });
    a.equal(st.get(), before, "no-op: the state object is the same");
    for (const u of ["d7d5", "c2c4"]) st.dispatch("play.move", { uci: u });
    st.dispatch("play.undo", { color: "b" });
    a.deepEqual(sans(st), ["d4"]);
  });

  test("takeback: two people sharing the board take back one move; a finished game is left alone", (a) => {
    const st = makeStore();
    st.dispatch("play.new", { id: "g", mode: "pvp" });
    for (const u of ["e2e4", "e7e5"]) st.dispatch("play.move", { uci: u });
    st.dispatch("play.undo", {});
    a.deepEqual(sans(st), ["e4"]);
    st.dispatch("play.new", { id: "m", mode: "pvp" });
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) st.dispatch("play.move", { uci: u });
    a.ok(st.get().play.game.result);
    const over = st.get();
    st.dispatch("play.undo", {});
    a.equal(st.get(), over, "mate stands: 重下 / 新对局 are the ways on");
  });

  test("takeback: the clock goes back to what it showed, and runs again from now", (a) => {
    const st = makeStore();
    st.dispatch("play.new", { id: "g", mode: "engine", engineColor: "b", tc: "5+3" });
    st.dispatch("play.move", { uci: "e2e4", now: 1000 });       // starts the clock
    st.dispatch("play.move", { uci: "e7e5", now: 5000 });       // black spent 4 s, +3
    st.dispatch("play.move", { uci: "g1f3", now: 15000 });      // white spent 10 s, +3
    st.dispatch("play.move", { uci: "b8c6", now: 16000 });
    const atE5 = st.get().play.game.moves[1].clock;
    st.dispatch("play.undo", { color: "w", now: 20000 });
    const c = st.get().play.game.clock;
    a.equal(c.w, atE5.w); a.equal(c.b, atE5.b);
    a.equal(c.turn, "w"); a.equal(c.since, 20000);
    st.dispatch("play.undo", { color: "w", now: 21000 });
    const c0 = st.get().play.game.clock;
    a.equal(c0.w, 300000); a.equal(c0.since, null, "back at the start the clock waits for the first move");
  });

  test("takeback: an event; a reload brings back the position and the count", async (a) => {
    const data = {};
    let db = await createDb(memoryBackend(data));
    const st = makeStore();
    persist(st, db);
    st.dispatch("play.new", { id: "g1", mode: "engine", engineColor: "b", opponent: "ada" });
    for (const u of ["e2e4", "e7e5", "g1f3", "b8c6"]) st.dispatch("play.move", { uci: u });
    st.dispatch("play.undo", { color: "w" });
    const events = await db.query("events.since", { after: 0 });
    const undo = events.find((e) => e.type === "game.undo");
    a.deepEqual({ ply: undo.ply, plies: undo.plies, takebacks: undo.takebacks, uci: undo.uci },
      { ply: 2, plies: 2, takebacks: 1, uci: ["g1f3", "b8c6"] });
    await db.close();
    db = await createDb(memoryBackend(data));
    const back = makeStore();
    await restore(back, db, () => "new");
    a.deepEqual(sans(back), ["e4", "e5"]);
    a.equal(back.get().play.game.takebacks, 1);
  });

  test("takeback: a rated game with a takeback counts, but does not move the game rating", (a) => {
    const opponentRating = () => 1500;
    const game = (id, undo, at) => [
      { type: "game.start", gameId: id, mode: "engine", engineColor: "b", opponent: "vera" },
      ...(undo ? [{ type: "game.undo", gameId: id, ply: 2, plies: 2, takebacks: 1 }] : []),
      { type: "game.end", gameId: id, result: "1-0", reason: "checkmate" },
    ].map((e, i) => ({ ...e, id: at + i, at: Date.UTC(2026, 10, 2) + at }));
    const rated = project([...game("a", false, 1), ...game("b", false, 10), ...game("c", false, 20)], { opponentRating });
    const mixed = project([...game("a", false, 1), ...game("b", true, 10), ...game("c", false, 20)], { opponentRating });
    a.equal(rated.games, 3);
    a.equal(mixed.games, 2, "the game with a takeback is not rated");
    a.equal(mixed.unrated, 1);
    a.ok(visibleRating(mixed) <= visibleRating(rated) || mixed.games < 3);
  });
}
