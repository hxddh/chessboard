/**
 * One game from the library on a board (`#/me/game/<id>`, opened from
 * pages/me-library.js): an imported game or one played here, stepped through
 * with the move drawer (pages/play-drawer.js, figurine notation) or ← / →,
 * and 复盘这盘 — the review on the board (review/review.js), the same cards
 * as after a game played here. A game the background review has done
 * (library/autoreview.js) opens on its stored pass at once. The review
 * looks at your moves when it is known which side you were, else at both.
 * @module pages/me-game
 */
import { h } from "../lib/dom.js";
import { signal, computed, effect, untrack } from "../lib/signal.js";
import { setNotation } from "../lib/notation.js";
import { createBoard } from "../board/board.js";
import { createDrawer } from "./play-drawer.js";
import { createReview } from "../review/review.js";
import { createSound, moveSoundAt } from "../lib/sound.js";
import { playText } from "../text/play.js";
import { oppText } from "../opponents/lines.js";
import { gameOfRecord } from "../library/records.js";
import { outcomeOf } from "../library/list.js";
import { Chess } from "../core/chess.js";
import { START_FEN } from "../core/rules.js";

/** A game played here as the review's game: { id, startFen, moves: [{ san, uci, fen }] }. */
async function playedGame(db, id) {
  const g = await db.query("game.get", { id });
  if (!g) return null;
  const rows = await db.query("game.moves", { gameId: id });
  const startFen = g.startFen || START_FEN;
  const c = new Chess(startFen);
  const moves = [];
  for (const m of rows) {
    const mv = c.move({ from: m.uci.slice(0, 2), to: m.uci.slice(2, 4), promotion: m.uci[4] || "q" });
    if (!mv) break;
    moves.push({ san: mv.san, uci: m.uci, fen: c.fen() });
  }
  return { row: g, game: { id, startFen, moves } };
}

/**
 * @param {HTMLElement} el
 * @param {object} o  { db, store, engine, id, t (学 / 我), back: () => void }
 * @returns {() => void} unmount
 */
export function mountGame(el, { db, store, engine, id, t, back, commands }) {
  const tp = playText();
  const settings = store.get().settings;
  const at = signal(0);
  const flipped = signal(false);
  const info = signal(null);   // { game, you, title, meta }
  let alive = true;

  const title = h("span", { class: "who", "data-test": "game-title" });
  const meta = h("span", { class: "muted", "data-test": "game-meta" });
  const head = h("div", { class: "strip lib-head" },
    h("button", { type: "button", class: "quiet", "data-test": "game-back", onclick: () => back() }, t("game.back")), title, meta);
  const boardEl = h("div", { class: "board-box", "data-test": "game-board" });
  const barText = h("p", { class: "bar-text", "data-test": "game-bar", "aria-live": "polite" });
  const barActions = h("div", { class: "bar-actions" });
  const bar = h("div", { class: "bar", "data-test": "game-bar-box" }, barText, barActions);
  const drawer = createDrawer({ t: tp, onPick: (i) => look(i), onStep: (d) => look(at.peek() + d), onCopy: copyPgn, onFlip: () => { flipped.value = !flipped.peek(); } });
  drawer.open = true;
  const root = h("div", { class: "play lib-game", "data-test": "lib-game" },
    h("div", { class: "stage" }, head, h("div", { class: "board-row" }, boardEl), bar), drawer.el);
  el.append(root);

  const sound = createSound(() => store.get().settings.sound !== "off");
  const review = createReview({ engine, db: Promise.resolve(db), t: tp });
  const board = createBoard(boardEl, { label: tp("board.aria"), fen: START_FEN, pieceSet: settings.pieceSet, theme: settings.boardTheme, movable: "none",
    premove: false, onMove: ({ from, to }) => tryMove(from, to) });

  function tryMove(from, to) {
    const rb = review.board.peek();
    if (!rb || review.state.peek().phase !== "card") return;
    const legal = new Chess(rb.fen).moves({ verbose: true }).find((m) => m.from === from && m.to === to);
    if (legal) review.tryMove(from + to + (legal.promotion ? "q" : ""));
  }
  function look(i) {
    const g = info.peek() && info.peek().game;
    if (!g || review.board.peek()) return;
    const n = g.moves.length, next = Math.max(0, Math.min(n, i));
    // one step forward is heard, as a move on 下 is
    if (next === at.peek() + 1) { const m = g.moves[next - 1]; const s = moveSoundAt(next > 1 ? g.moves[next - 2].fen : g.startFen, m.uci.slice(0, 2), m.uci.slice(2, 4)); if (s) sound.play(s.name, s.piece, s.color); }
    at.value = next;
  }
  function copyPgn() {
    const g = info.peek() && info.peek().game;
    if (!g) return;
    const first = g.startFen.split(" ")[1] === "b" ? 1 : 0;
    const no = (i) => Math.floor((i + first) / 2) + 1;
    const sans = g.moves.map((m, i) => ((i + first) % 2 === 0 ? no(i) + ". " : i === 0 ? no(i) + "... " : "") + m.san).join(" ");
    const head = g.startFen !== START_FEN ? "[SetUp \"1\"]\n[FEN \"" + g.startFen + "\"]\n\n" : "";
    const text = head + sans + (info.peek().result && info.peek().result !== "*" ? " " + info.peek().result : "");
    Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(text)).catch(() => {});
  }
  function startReview() {
    const i = info.peek();
    if (!i || !i.game.moves.length) return;
    review.open(i.game, { orientation: i.you === "b" ? "black" : "white", sides: i.you ? [i.you] : ["w", "b"] });
  }

  // --- what the board shows, the bar, the drawer ------------------------------------------
  const offs = [];
  const fx = (fn) => offs.push(effect(fn));
  const view = computed(() => {
    const i = info.value;
    const turn = (o) => (flipped.value ? (o === "black" ? "white" : "black") : o);
    const rb = review.board.value;
    if (rb) return { ...rb, orientation: turn(rb.orientation || "white") };
    if (!i) return { fen: START_FEN, lastMove: null, movable: "none", orientation: "white", arrows: [] };
    const k = at.value, m = i.game.moves[k - 1];
    return { fen: k ? m.fen : i.game.startFen, lastMove: m ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : null, movable: "none",
      orientation: turn(i.you === "b" ? "black" : "white"), arrows: [] };
  });
  fx(() => {
    const v = view.value;
    board.set({ fen: v.fen, lastMove: v.lastMove, movable: v.movable, orientation: v.orientation, arrows: v.arrows || [], marks: [] });
    untrack(() => drawer.setCursor(review.board.peek() ? null : at.peek()));
  });
  const btn = (testId, label, onclick, cls = "") => h("button", { type: "button", "data-test": testId, class: cls, onclick }, label);
  fx(() => {
    const i = info.value, rv = review.state.value, k = at.value;
    let text = "", tone = "", actions = [];
    if (!i) text = info.value === false ? t("game.missing") : "…";
    else if (rv.phase === "idle") {
      text = k ? t("game.at", k, i.game.moves.length) : t("game.startPos");
      if (i.game.moves.length) actions = [btn("game-review", t("game.review"), startReview, "primary")];
    } else if (rv.phase === "running") text = (i.you ? "" : t("game.both") + " ") + tp("rv.running", rv.done, rv.total);
    else if (rv.phase === "failed") text = tp("rv.noEngine", rv.error);
    else if (rv.phase === "empty") text = tp("rv.clean");
    else if (rv.phase === "done") text = tp("rv.done");
    else if (rv.phase === "card") {
      const last = rv.k + 1 >= rv.count;
      text = rv.note || review.headline() + " " + tp("rv.tryAgain");
      tone = rv.tone || "";
      const next = btn("rv-next", last ? tp("rv.finish") : tp("rv.next"), () => review.next(), rv.solved || rv.shown ? "primary" : "quiet");
      actions = rv.solved || rv.shown ? [next] : [btn("rv-answer", tp("rv.answer"), () => review.answer(), "primary"), next];
    }
    setNotation(barText, text);
    bar.dataset.tone = tone;
    bar.dataset.phase = i ? rv.phase : "loading";
    barActions.replaceChildren(...actions);
  });
  fx(() => {
    const rv = review.state.value, i = info.value;
    const has = rv.phase === "card" || rv.phase === "done" || rv.phase === "empty";
    untrack(() => drawer.setReport(has ? review.report() : null, i && i.you));
  });

  function onKey(e) {
    if (e.metaKey || e.ctrlKey || e.altKey || /^(INPUT|SELECT|TEXTAREA)$/.test((e.target && e.target.tagName) || "")) return;
    if (e.key === "ArrowLeft") { look(at.peek() - 1); e.preventDefault(); }
    else if (e.key === "ArrowRight") { look(at.peek() + 1); e.preventDefault(); }
    else if (e.key === "Home") { look(0); e.preventDefault(); }
    else if (e.key === "End") { look(Infinity); e.preventDefault(); }
    else if (e.key.toLowerCase() === "f") flipped.value = !flipped.peek();
  }
  addEventListener("keydown", onKey);
  // the menu bar (services/shell.js)
  const menu = commands ? [
    commands.handle("game.flip", () => { flipped.value = !flipped.peek(); }),
    commands.handle("view.prev", () => look(at.peek() - 1)),
    commands.handle("view.next", () => look(at.peek() + 1)),
  ] : [];

  // --- the game ---------------------------------------------------------------------------
  (async () => {
    let i = null;
    const rec = await db.query("library.get", { id });
    if (rec) {
      const game = gameOfRecord(rec);
      if (game) {
        i = { game, you: rec.you || null, result: rec.result || "*", white: rec.white || "", black: rec.black || "",
          when: rec.date ? rec.date.replace(/\.\?\?/g, "") : "", event: rec.event || "" };
      }
    } else {
      const p = await playedGame(db, id);
      if (p) {
        const g = p.row, you = g.mode === "engine" ? (g.engineColor === "w" ? "b" : "w") : null;
        const them = g.mode === "engine" ? oppText(g.opponent, "name") || t("me.vsEngine") : "";
        i = { game: p.game, you, result: g.result ? g.result.result : "*", white: you === "b" ? them : you === "w" ? t("lib.you") : t("lib.white"),
          black: you === "w" ? them : you === "b" ? t("lib.you") : t("lib.black"), when: g.startedAt ? new Date(g.startedAt).toLocaleDateString(t("date.locale")) : "", event: "" };
      }
    }
    if (!alive) return;
    if (!i) { info.value = false; return; }
    title.textContent = t("lib.vs", i.white || t("lib.white"), i.black || t("lib.black"));
    const o = outcomeOf({ result: i.result, you: i.you });
    meta.textContent = [o ? t("lib." + o) : i.result !== "*" ? i.result : "", i.when, i.event].filter(Boolean).join(" · ");
    drawer.setMoves(i.game.moves, i.game.id);
    info.value = i;
    at.value = i.game.moves.length;
  })();

  window.__libGame = { board, review, sound, look, get at() { return at.peek(); }, get info() { return info.peek(); } };
  return () => {
    alive = false;
    removeEventListener("keydown", onKey);
    menu.forEach((off) => off());
    for (const off of offs) off();
    review.close();
    sound.close();
    board.destroy();
    root.remove();
    delete window.__libGame;
  };
}
