/**
 * 学 (v20-0-plan §6 S1/S2): it opens on the next thing to do, on one big
 * board; doing it chains to the next. What comes next is the queue's
 * (learn/queue.js) and nobody else's — reviews due, one new skill, a game
 * or an endgame. The skill map (where you are, what is next) is one tap
 * away. A fresh profile starts with the placement (learn/placement.js).
 *
 *   ?learnNow=<ms since epoch>   the clock the queue reads (tests)
 *   ?chain=<ms>                  how long a right answer stays before the next (1100)
 * @module pages/learn
 */
import { h } from "../lib/dom.js";
import { setNotation, withFigurines } from "../lib/notation.js";
import { signal, effect, untrack } from "../lib/signal.js";
import { createBoard } from "../board/board.js";
import { learnText } from "../text/learn.js";
import { playText } from "../text/play.js";
import { SKILL, SKILLS, GROUPS } from "../content/skills.js";
import { LESSONS } from "../content/lessons.js";
import { lessonOf } from "../content/words.js";
import { PRACTICE } from "../content/practice.js";
import { next, itemOf, todayOf, skillItems } from "../learn/queue.js";
import { isLit, isReached, frontier, visibleRating } from "../learn/model.js";
import { newRun, pickNext, step, placeEvent } from "../learn/placement.js";
import { createRunner } from "../learn/runner.js";
import { learnerFor, opponentFor, nextGameLine } from "../learn/service.js";
import { addStyle } from "../learn/style.js";
import { ITEMS } from "../content/practice.js";
import { LEVELS, coachOn } from "../state/settings.js";
import { newId } from "../services/db.js";
import { createSound, moveSoundAt } from "../lib/sound.js";

const plain = (s) => String(s).replace(/\*\*/g, "");

export function mount(el, { store, engine, ready, router }) {
  addStyle();
  const t = learnText();
  const tp = playText();
  const params = new URLSearchParams(location.search);
  const clock = () => (params.has("learnNow") ? Number(params.get("learnNow")) + (performance.now() | 0) : Date.now());
  const s0 = store.get().settings;
  const CHAIN_MS = params.has("chain") ? Number(params.get("chain")) : 1100;

  const view = signal("loading");      // loading | place | item | map
  const current = signal(null);         // { item, why, runner, done: null | result }
  const detail = signal(null);          // a skill id open on the map
  const rev = signal(0);                // bumped when the current item changes inside (answered)
  const offs = [];
  let L = null, run = null, focus = null, alive = true;
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); if (alive) fn(); }, ms); timers.add(id); return id; };

  // --- layout -----------------------------------------------------------------------
  const todayEl = h("span", { class: "left", "data-test": "today" });
  const chip = h("span", { class: "chip", "data-test": "why" });
  const mapBtn = h("button", { type: "button", class: "end quiet", "data-test": "open-map", onclick: () => toggleMap() });
  const head = h("header", { class: "learn-head" }, h("h1", { text: t("learn.today") }), todayEl, chip, mapBtn);
  const boardEl = h("div", { class: "board-box", "data-test": "learn-board" });
  const barText = h("p", { class: "bar-text", "data-test": "learn-bar", "aria-live": "polite" });
  const barActions = h("div", { class: "bar-actions" });
  const bar = h("div", { class: "bar", "data-test": "learn-bar-box" }, barText, barActions);
  const sideGroup = h("p", { class: "group" });
  const sideName = h("h2", { "data-test": "skill-name" });
  const sideWhy = h("p", { class: "why", "data-test": "skill-why" });
  const sideLesson = h("div", { class: "lesson", "data-test": "lesson-text" });
  const side = h("aside", { class: "learn-side" }, sideGroup, sideName, sideWhy, sideLesson);
  const main = h("div", { class: "learn-main" }, h("div", { class: "learn-stage" }, boardEl, bar), side);
  const mapEl = h("div", { class: "skill-map", "data-test": "skill-map", hidden: true });
  const placeEl = h("div", { class: "place", "data-test": "place", hidden: true });
  const root = h("div", { class: "learn", "data-test": "learn" }, head, main, mapEl, placeEl);
  el.append(root);

  const board = createBoard(boardEl, { label: tp("board.aria"), fen: "8/8/8/8/8/8/8/8 w - - 0 1", dests: new Map(), movable: "none", check: null, premove: false,
    pieceSet: s0.pieceSet, theme: s0.boardTheme, onMove: ({ from, to }) => { const c = current.peek(); if (c && c.runner && !c.done) c.runner.move(from, to); } });

  // the same wooden set as 下 (lib/sound.js), under the same setting
  const sound = createSound(() => store.get().settings.sound !== "off");
  let heard = { fen: null, bar: null };

  // --- the item ------------------------------------------------------------------------
  function showNext() {
    if (!L) return;
    const st = L.model;
    let n = null;
    if (focus && focus.length) { const id = focus.shift(); n = { id, why: "new" }; }
    else n = next(st, clock(), { tz: L.tz });
    if (!n) { current.value = null; return; }
    start(itemOf(st, n.id), n.why, { more: !!n.more });
  }

  function start(item, why, extra = {}) {
    const prev = current.peek();
    if (prev && prev.runner) prev.runner.dispose();
    const c = { item, why, done: null, ...extra };
    if (item.kind === "game") c.opponent = opponentFor(item.rating);
    c.runner = item.kind === "game" ? null : createRunner(item, { t, engine, later, onDone: (r) => done(c, r) });
    current.value = c;
  }

  async function done(c, r) {
    if (current.peek() !== c) return;
    const it = c.item;
    const e = { type: "learn.answer", item: it.id, skill: it.skill || null, kind: it.kind, ok: !!r.ok, tries: r.tries || 1,
      revealed: !!r.revealed, ...(Number.isFinite(it.rating) ? { rating: it.rating } : {}), ...(c.placement ? { placement: true } : {}) };
    c.done = r;
    rev.value++;
    if (r.ok && !r.revealed && it.kind !== "lesson") sound.play("star");
    if (c.placement) return placementAnswer(it, r.ok && !r.revealed);
    await L.record(e);
    if (!alive || current.peek() !== c) return;
    if (it.kind === "lesson") showNext();
    else if (r.ok) later(CHAIN_MS, () => { if (current.peek() === c) showNext(); });
  }
  async function startGame(c) {
    const o = c.opponent || opponentFor(c.item.rating);
    await L.record({ type: "learn.game", item: c.item.id, opponent: o.id });
    store.dispatch("play.new", { id: newId(), mode: "engine", engineColor: "b", opponent: o.id, coach: coachOn(store.get().settings) });
    router.go("/play");
  }
  const gameLine = (o) => nextGameLine(t, o);

  // --- placement -----------------------------------------------------------------------
  let placing = null;
  function renderPlace() {
    const choice = (how, label, sub) => h("button", { type: "button", "data-test": "place-" + how, onclick: () => choose(how) },
      h("strong", { text: t(label) }), h("small", { text: t(sub) }));
    placeEl.replaceChildren(h("h1", { text: t("place.title") }), choice("new", "place.new", "place.newSub"),
      choice("knows", "place.knows", "place.knowsSub"), choice("often", "place.often", "place.oftenSub"));
  }
  async function choose(how) {
    if (how === "new") { await placed(placeEvent(null)); return; }
    placing = newRun(how);
    view.value = "item";
    placeOne();
  }
  function placeOne() {
    const id = pickNext(placing);
    start(ITEMS[id], "place", { placement: true });
  }
  async function placementAnswer(it, ok) {
    placing = step(placing, it.id, ok);
    await L.record({ type: "learn.answer", item: it.id, skill: null, kind: it.kind, ok, placement: true });
    later(CHAIN_MS, () => { if (placing.over) placed(placeEvent(placing)); else placeOne(); });
  }
  async function placed(e) {
    placing = null;
    await L.record(e);
    // the coach and the opponents follow the level the placement found
    const lv = LEVELS.reduce((b, x) => (Math.abs(x - e.rating) < Math.abs(b - e.rating) ? x : b), LEVELS[0]);
    try { store.dispatch("settings.set", { key: "level", value: lv }); } catch { /* a level the settings do not offer */ }
    view.value = "item";
    showNext();
  }

  // --- the map ---------------------------------------------------------------------------
  function toggleMap() { view.value = view.peek() === "map" ? "item" : "map"; }
  function stateOf(st, id, now) {
    if (isLit(st, id)) return "lit";
    if (now === id) return "now";
    return isReached(st, id) ? "reached" : "locked";
  }
  function renderMap() {
    const st = L.model;
    const now = frontier(st)[0];
    const sections = GROUPS.map((g) => h("section", {}, h("h3", { text: t("group." + g) }),
      h("div", { class: "chips" }, SKILLS.filter((s) => s.group === g).map((s) =>
        h("button", { type: "button", "data-skill": s.id, "data-state": stateOf(st, s.id, now), onclick: () => { detail.value = s.id; } }, t("sk." + s.id))))));
    const d = detail.peek();
    const box = [];
    if (d) {
      const s = SKILL[d], state = stateOf(st, d, now);
      const missing = s.needs.filter((p) => !isLit(st, p)).map((p) => t("sk." + p));
      box.push(h("div", { class: "skill-detail", "data-test": "skill-detail" },
        h("h2", { text: t("sk." + d) }), h("p", { text: t("sk." + d + ".why") }),
        h("p", { class: "muted", text: t("map." + state) + " · " + t("map.positions", (PRACTICE[d] || []).length) +
          (missing.length ? " · " + t("map.needs", missing.join(t("ex.list"))) : "") }),
        h("div", {}, h("button", { type: "button", class: "primary", "data-test": "practice-skill", disabled: state === "locked",
          onclick: () => practise(d) }, t("map.practice")))));
    }
    mapEl.replaceChildren(...box, ...sections);
  }
  function practise(id) {
    const st = L.model;
    const list = isLit(st, id) ? PRACTICE[id].slice() : skillItems(st, id);
    focus = list.length ? list : PRACTICE[id].slice();
    detail.value = null;
    view.value = "item";
    showNext();
  }

  // --- rendering ---------------------------------------------------------------------------
  const fx = (fn) => offs.push(effect(fn));
  fx(() => {
    const v = view.value;
    main.hidden = v !== "item";
    mapEl.hidden = v !== "map";
    placeEl.hidden = v !== "place";
    head.hidden = v === "place" || v === "loading";
    mapBtn.textContent = v === "map" ? t("learn.back") : t("learn.map");
    if (v === "map") { detail.value; untrack(renderMap); }
    if (v === "place") renderPlace();
  });
  fx(() => {
    const c = current.value;
    if (!c || !c.runner) {
      board.set({ fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", dests: new Map(), movable: "none", marks: [], arrows: [], lastMove: null, check: null, animate: false });
      return;
    }
    const v = c.runner.view.value;
    // a move on the board, yours or the other side's, is heard; a jump to another position is not
    if (v.lastMove && heard.fen && v.fen !== heard.fen) {
      const s = moveSoundAt(heard.fen, v.lastMove.from, v.lastMove.to);
      if (s) sound.play(s.name, s.piece, s.color);
    }
    heard.fen = v.fen;
    board.set({ fen: v.fen, orientation: v.orientation, movable: v.movable, dests: v.dests || new Map(), marks: v.marks || [], arrows: v.arrows || [],
      lastMove: v.lastMove, check: v.check === true ? true : null });
  });
  fx(() => {
    const c = current.value;
    rev.value;
    const b = c && c.runner ? c.runner.bar.value : null;
    const btn = (a) => h("button", { type: "button", "data-test": "act-" + a.id, class: a.primary ? "primary" : "quiet", onclick: a.fn }, a.label);
    if (!c) { barText.textContent = ""; barActions.replaceChildren(); return; }
    if (c.item.kind === "game") {
      barText.textContent = gameLine(c.opponent);
      barActions.replaceChildren(btn({ id: "play", label: t("learn.play"), primary: true, fn: () => startGame(c) }));
      bar.dataset.tone = "";
      return;
    }
    setNotation(barText, b.text);
    bar.dataset.tone = b.tone || "";
    if (b !== heard.bar && b.tone === "bad") sound.play("wrong");
    heard.bar = b;
    const acts = c.done && !c.placement ? [{ id: "next", label: t("learn.next"), primary: true, fn: () => showNext() }] : b.actions;
    barActions.replaceChildren(...acts.map(btn));
  });
  fx(() => {
    const c = current.value;
    rev.value;
    if (L) L.state.value;
    if (!c) return;
    const it = c.item, sk = it.skill && SKILL[it.skill];
    chip.textContent = c.placement ? t("place.k", (placing ? placing.k : 0) + 1) : t("learn.why." + (c.why || "new"));
    sideGroup.textContent = sk ? t("group." + sk.group) : "";
    sideName.textContent = sk ? t("sk." + sk.id) : it.kind === "game" ? gameLine(c.opponent) : t("puzzle.find");
    sideWhy.textContent = sk ? t("sk." + sk.id + ".why") : it.kind === "game" ? t("learn.gameWhy") : "";
    const paras = it.kind === "lesson" && sk ? sk.lessons.flatMap((id) => (LESSONS[id] ? lessonOf(id, LESSONS[id]).text : [])).slice(0, 4) : [];
    sideLesson.replaceChildren(...paras.map((p) => h("p", {}, ...withFigurines(plain(p)))));
    if (L && !c.placement) {
      const td = todayOf(L.model, clock(), { tz: L.tz });
      todayEl.textContent = c.more || !td.left ? t("learn.doneToday") : t("learn.left", Math.max(1, td.left));
    } else todayEl.textContent = "";
  });

  // --- start -------------------------------------------------------------------------------
  ready.then((db) => { L = learnerFor(db); return L.refresh(); }).then(() => {
    if (!alive) return;
    if (!L.model.placed) { view.value = "place"; return; }
    view.value = "item";
    showNext();
  });

  // tests and the console: the item on the board, and a way to answer it
  window.__learn = {
    get item() { const c = current.peek(); return c ? c.item : null; },
    get why() { const c = current.peek(); return c ? c.why : null; },
    get model() { return L && L.model; },
    get view() { return view.peek(); },
    rating: () => (L ? visibleRating(L.model) : null),
    answer(ok = true) {
      const c = current.peek();
      if (c && c.runner && !c.runner.over) c.runner.finish({ ok });
      else if (c && c.item.kind === "game") L.record({ type: "learn.game", item: c.item.id }).then(showNext);
    },
    next: () => showNext(),
    /** tests: put one item on the board (an id of content/practice.js) */
    start: (id) => { view.value = "item"; start(ITEMS[id], "new"); },
    square: (sq) => board.squareCenter(sq),
    board: () => board.state(),
    sound,
    lit: (id) => !!(L && isLit(L.model, id)),
  };

  return () => {
    alive = false;
    for (const off of offs) off();
    for (const id of timers) clearTimeout(id);
    const c = current.peek();
    if (c && c.runner) c.runner.dispose();
    board.destroy();
    sound.close();
    if (window.__learn && window.__learn.square) delete window.__learn;
  };
}
