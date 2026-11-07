import { createStore, deepFreeze, shallowEqual } from "../../src/app/state/store.js";
import { effect } from "../../src/app/lib/signal.js";
import { playActions, initialPlay, selectFen, selectLastMove } from "../../src/app/state/play.js";
import { START_FEN, legalDests, applyMove, outcome, checkSquare } from "../../src/app/core/rules.js";

const counter = () => createStore({ n: 0, list: [], other: { x: 1 } }, {
  inc: (s, by = 1) => ({ ...s, n: s.n + by }),
  push: (s, v) => ({ ...s, list: [...s.list, v] }),
  same: (s) => s,
  bad: (s) => { s.n = 99; return s; },
  nothing: () => undefined,
});

export default function (test) {
  test("store: state is frozen, actions are named", (a) => {
    const st = counter();
    a.ok(Object.isFrozen(st.get()) && Object.isFrozen(st.get().other));
    st.dispatch("inc", 2);
    a.equal(st.get().n, 2);
    a.throws(() => st.dispatch("nope"), "unknown action");
    a.throws(() => st.dispatch("bad"), "mutating the frozen state throws");
    a.equal(st.get().n, 2, "and leaves it as it was");
    a.throws(() => st.dispatch("nothing"));
  });

  test("store: every action records prev and next", (a) => {
    const st = counter();
    const got = [];
    const off = st.subscribe((r) => got.push(r));
    const s0 = st.get();
    st.dispatch("inc");
    st.dispatch("push", "a");
    off();
    st.dispatch("inc");
    a.equal(got.length, 2);
    a.equal(got[0].name, "inc");
    a.equal(got[0].prev, s0);
    a.equal(got[0].next, got[1].prev, "records chain");
    a.deepEqual(got[1].payload, "a");
    a.equal(st.history().length, 3);
    a.ok(Object.isFrozen(got[0]));
  });

  test("store: history is bounded", (a) => {
    const st = createStore({ n: 0 }, { inc: (s) => ({ n: s.n + 1 }) }, { historyLimit: 5 });
    for (let i = 0; i < 12; i++) st.dispatch("inc");
    const h = st.history();
    a.equal(h.length, 5);
    a.equal(h[4].next.n, 12);
  });

  test("store: structural sharing keeps untouched slices identical", (a) => {
    const st = counter();
    const before = st.get().other;
    st.dispatch("inc");
    a.equal(st.get().other, before);
  });

  test("store: selectors are signals and fire only for their slice", (a) => {
    const st = counter();
    const n = st.select((s) => s.n);
    const other = st.select((s) => s.other);
    const seen = { n: 0, other: 0 };
    effect(() => { n.value; seen.n++; });
    effect(() => { other.value; seen.other++; });
    st.dispatch("inc");
    st.dispatch("push", 1);
    st.dispatch("same");
    a.deepEqual(seen, { n: 2, other: 1 });
  });

  test("store: a selector with equals keeps the previous result", (a) => {
    const st = counter();
    const pair = st.select((s) => ({ even: s.n % 2 === 0, len: s.list.length }), shallowEqual);
    let runs = 0;
    effect(() => { pair.value; runs++; });
    st.dispatch("inc", 2);
    a.equal(runs, 1, "a fresh but equal object does not notify");
    st.dispatch("inc", 1);
    a.equal(runs, 2);
  });

  test("store: dispatch inside an action is refused; inside a subscriber it works", (a) => {
    let st;
    st = createStore({ n: 0 }, {
      inc: (s) => ({ n: s.n + 1 }),
      nested: (s) => { st.dispatch("inc"); return s; },
    });
    a.throws(() => st.dispatch("nested"));
    st.subscribe((r) => { if (r.name === "inc" && r.next.n === 1) st.dispatch("inc"); });
    st.dispatch("inc");
    a.equal(st.get().n, 2);
  });

  test("deepFreeze stops at frozen subtrees", (a) => {
    const shared = Object.freeze({ deep: { x: 1 } });
    deepFreeze({ shared });
    a.ok(!Object.isFrozen(shared.deep), "already-frozen objects are not walked");
  });

  test("rules: legal destinations, moves, check, endings", (a) => {
    const d = legalDests(START_FEN);
    a.equal(d.size, 10);
    a.deepEqual(d.get("g1").sort(), ["f3", "h3"]);
    a.equal(applyMove(START_FEN, "e2e5"), null);
    const m = applyMove(START_FEN, "e2e4");
    a.equal(m.san, "e4");
    let f = START_FEN;
    const fens = [f];
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) { f = applyMove(f, u).fen; fens.push(f); }
    a.equal(checkSquare(f), "e1");
    a.deepEqual(outcome(fens), { result: "0-1", reason: "checkmate" });
    const promo = applyMove("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8");
    a.equal(promo.uci, "a7a8q", "a bare promotion is a queen");
    a.equal(applyMove("8/P6k/8/8/8/8/8/K7 w - - 0 1", "a7a8n").san, "a8=N");
  });

  test("play: new, move, undo, restore, resign", (a) => {
    const st = createStore({ play: initialPlay }, playActions);
    const fen = st.select(selectFen);
    st.dispatch("play.new", { id: "g1", mode: "engine" });
    a.equal(st.get().play.game.engineColor, "b");
    st.dispatch("play.move", { uci: "e2e4" });
    st.dispatch("play.move", { uci: "e7e5" });
    a.equal(fen.value.split(" ")[0], "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR");
    a.deepEqual(selectLastMove(st.get()), { from: "e7", to: "e5" });
    a.throws(() => st.dispatch("play.move", { uci: "e4e5" }), "illegal move refused");
    st.dispatch("play.undo");
    a.equal(st.get().play.game.moves.length, 1);
    const row = { id: "g1", mode: "engine", engineColor: "b", startFen: START_FEN };
    const st2 = createStore({ play: initialPlay }, playActions);
    st2.dispatch("play.restore", { game: row, moves: [{ uci: "e2e4" }, { uci: "e7e5" }, { uci: "g1f3" }] });
    a.equal(st2.get().play.game.moves[2].san, "Nf3");
    st2.dispatch("play.resign", { color: "w" });
    a.deepEqual(st2.get().play.game.result, { result: "0-1", reason: "resign" });
    a.throws(() => st2.dispatch("play.move", { uci: "b8c6" }), "no moves after the end");
  });

  test("play: fool's mate ends the game", (a) => {
    const st = createStore({ play: initialPlay }, playActions);
    st.dispatch("play.new", { id: "g" });
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) st.dispatch("play.move", { uci: u });
    a.deepEqual(st.get().play.game.result, { result: "0-1", reason: "checkmate" });
  });
}
