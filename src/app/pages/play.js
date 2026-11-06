/**
 * The play page, minimal: a board, the moves, and four buttons. Two players
 * on one board, or against the engine. Every move is an event in the db, so
 * a reload brings the game back where it was.
 * @module pages/play
 */
import { h } from "../lib/dom.js";
import { signal, effect, untrack } from "../lib/signal.js";
import { createBoard } from "../board/board.js";
import { selectFen, selectLastMove } from "../state/play.js";
import { turnOf } from "../core/rules.js";
import { newId } from "../services/db.js";

const REASON = { checkmate: "将死", stalemate: "逼和", insufficient: "子力不足", fivefold: "五次重复", "seventy-five": "七十五步", resign: "认输" };
const SIDE = { w: "白方", b: "黑方" };

export function mount(el, { store, engine, ready }) {
  const game = store.select((s) => s.play.game);
  const fen = store.select(selectFen);
  const lastMove = store.select(selectLastMove);
  const settings = store.select((s) => s.settings);
  const flipped = signal(false);
  const thinking = signal(false);

  const status = h("p", { class: "status", "data-test": "status", "aria-live": "polite" });
  const list = h("ol", { class: "moves", "data-test": "moves" });
  const boardEl = h("div", { class: "board-box", "data-test": "board" });
  const newGame = (mode) => store.dispatch("play.new", { id: newId(), mode, engineColor: mode === "engine" ? "b" : null });
  const undo = () => {
    const g = store.get().play.game;
    if (!g || !g.moves.length) return;
    // against the engine, take back the engine's reply too
    const plies = g.mode === "engine" && turnOf(selectFen(store.get())) !== g.engineColor && g.moves.length > 1 ? 2 : 1;
    store.dispatch("play.undo", { plies });
  };
  const controls = h("div", { class: "controls" },
    h("button", { "data-test": "new-pvp", onclick: () => newGame("pvp") }, "双人对弈"),
    h("button", { "data-test": "new-engine", onclick: () => newGame("engine") }, "对电脑"),
    h("button", { "data-test": "undo", onclick: undo }, "悔棋"),
    h("button", { "data-test": "flip", onclick: () => flipped.update((v) => !v) }, "翻转"));
  el.append(h("div", { class: "play" }, boardEl, h("aside", { class: "side" }, status, controls, list)));

  const s0 = settings.peek();
  const board = createBoard(boardEl, {
    fen: fen.peek(), pieceSet: s0.pieceSet, theme: s0.boardTheme, movable: "none",
    onMove({ from, to }) {
      try { store.dispatch("play.move", { uci: from + to }); } catch (e) { console.warn(e.message); }
    },
  });
  performance.mark("app:board");

  const stops = [];
  stops.push(effect(() => {
    const s = settings.value;
    board.set({ pieceSet: s.pieceSet, theme: s.boardTheme });
  }));

  stops.push(effect(() => {
    const g = game.value;
    const f = fen.value;
    const human = g && g.mode === "engine" ? (g.engineColor === "w" ? "black" : "white") : null;
    const orientation = (human === "black") !== flipped.value ? "black" : "white";
    const movable = !g || g.result ? "none" : human || "both";
    board.set({ fen: f, lastMove: lastMove.value, movable, orientation });

    const turn = turnOf(f);
    status.textContent = !g ? "…" :
      g.result ? g.result.result + " · " + (REASON[g.result.reason] || g.result.reason) :
      (thinking.value ? "电脑思考中…" : SIDE[turn] + "走棋");
  }));

  // the move list grows by one row per move; rebuilt only on undo or a new game
  let shown = [], shownId = null;
  stops.push(effect(() => {
    const g = game.value;
    const moves = g ? g.moves : [];
    const append = g && g.id === shownId && moves.length >= shown.length && shown.every((m, i) => m === moves[i]);
    if (!append) list.replaceChildren();
    for (let i = append ? shown.length : 0; i < moves.length; i++) {
      list.append(h("li", { "data-ply": i }, (i % 2 === 0 ? (i / 2 + 1) + ". " : "") + moves[i].san));
    }
    shown = moves; shownId = g && g.id;
  }));

  // the engine answers when it is its turn; a reply for a position no longer
  // on the board is dropped
  stops.push(effect(() => {
    const g = game.value, f = fen.value;
    if (!g || g.mode !== "engine" || g.result || turnOf(f) !== g.engineColor) return;
    untrack(() => { thinking.value = true; });
    let live = true;
    engine.bestMove(f, { rating: 1500, thinkMs: 300 }).then(({ move }) => {
      if (!live || selectFen(store.get()) !== f || !move) return;
      store.dispatch("play.move", { uci: move });
    }).catch((e) => console.warn("engine:", e.message)).finally(() => { if (live) thinking.value = false; });
    return () => { live = false; thinking.value = false; };
  }));

  ready.then(() => { if (!store.get().play.game) newGame("pvp"); });

  return () => { stops.forEach((s) => s()); board.destroy(); };
}
