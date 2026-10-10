/**
 * The opponents on screen (v8-0-plan B4): the persona cards in the new-game
 * dialog, the engine's strip, the persona's opening and end-of-game lines,
 * the rating line on the result card, and the engine's draw offer.
 *
 * Every node here is built once, at mount, and after that only relabelled
 * and toggled in place — 7.6's rule: nothing under a button is rebuilt
 * between its pointerdown and its pointerup. The draw offer's bar is static
 * markup in index.html for the same reason.
 *
 * The rules (which persona, which rating, when to resign) are opponents.js;
 * this file only shows them. Everything it borrows from app.js arrives in
 * the bag handed to createOpponentsUI(), as settings-ui.js does it.
 * @module opponents-ui
 */
import { Opponents } from "./opponents.js";
import { ChessRating } from "./rating.js";
import { OP_LINES } from "./opponents-lines.js";

/**
 * @param {object} d what this module borrows from app.js
 */
/** 9.0 S2: how many opponent cards the dialog shows at once. */
const SHOWN = 8;

export function createOpponentsUI(d) {
  const { doc, store, t, tf, tdot, setText, repaint, saveSettings, diffName } = d;
  const el = (id) => doc.getElementById(id);
  /** the personas' words (opponents-lines.js), in the interface's language */
  const L = () => OP_LINES[d.lang()] || OP_LINES["zh-CN"];
  const fill = (s, v) => s.replace(/\{(\d)\}/g, (_, i) => String(v[i]));
  const nameOf = (p) => L()[p.id].name;

  // --- the dialog's cards -------------------------------------------------

  /** The persona the dialog's draft (or, outside it, the settings) names. */
  function pickNow() {
    const ng = store.ui.newGame;
    return ng ? { difficulty: ng.difficulty, personaId: ng.personaId }
      : { difficulty: store.session.difficulty, personaId: store.session.personaId };
  }

  function mount() {
    const grid = el("op-grid");
    if (!grid || grid.childElementCount) return;
    // the fold widens the grid to the whole ladder (paint)
    const fold = el("ng-custom");
    if (fold) fold.addEventListener("toggle", () => paint());
    for (const p of Opponents.PERSONAS) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "op-card";
      b.dataset.op = p.id;
      b.setAttribute("aria-pressed", "false");
      const av = doc.createElement("span");
      av.className = "op-av";
      av.setAttribute("aria-hidden", "true");
      av.appendChild(d.icon(p.icon));
      const txt = doc.createElement("span");
      txt.className = "op-txt";
      const name = doc.createElement("span");
      name.className = "op-name";
      const meta = doc.createElement("span");
      meta.className = "op-meta";
      const rating = doc.createElement("span");
      rating.className = "op-rating num";
      const style = doc.createElement("span");
      style.className = "op-style";
      meta.append(rating, style);
      txt.append(name, meta);
      b.append(av, txt);
      grid.appendChild(b);
    }
    grid.onclick = (ev) => {
      const b = ev.target.closest("button[data-op]");
      const p = b && Opponents.personaById(b.dataset.op);
      if (p) choose(p);
    };
  }

  /** A card pressed: in the dialog it is the draft; elsewhere, the setting. */
  function choose(p) {
    const ng = store.ui.newGame;
    if (ng) {
      ng.difficulty = p.level;
      ng.personaId = p.style;
      repaint();
      return;
    }
    store.session.difficulty = p.level;
    store.session.personaId = p.style;
    saveSettings();
    store.commit("session", "sync");
  }

  function styleName(style) { return t("persona." + (style || "off")); }

  function paint() {
    const grid = el("op-grid");
    if (!grid) return;
    // the personas are an engine game's; 双人 in the dialog hides them
    const ai = (store.ui.newGame ? store.ui.newGame.mode : store.session.mode) === "ai";
    const row = el("row-opponent");
    if (row && row.hidden === ai) row.hidden = !ai;
    const ng = store.ui.newGame;
    if (!ng) return;
    const pick = pickNow();
    const on = Opponents.personaFor(pick.difficulty, pick.personaId);
    // 9.0 S2: eight cards — the ladder around the pick, so the one chosen
    // and its neighbours either way are what is on screen. 10.0 M0: 更多选项
    // open shows all twenty-one — it held the same ladder a second time, as
    // two rows of rung names (陪练档 / 棋力档), a second way to choose.
    const all = Opponents.PERSONAS;
    const full = !!(el("ng-custom") && el("ng-custom").open);
    const at = Math.max(0, on ? all.indexOf(on) : all.findIndex((p) => p.level === pick.difficulty));
    const from = full ? 0 : Math.max(0, Math.min(all.length - SHOWN, at - 3));
    const shown = full ? all.length : SHOWN;
    for (const b of grid.children) {
      const p = Opponents.personaById(b.dataset.op);
      if (!p) continue;
      const k = all.indexOf(p);
      const out = k < from || k >= from + shown;
      if (b.hidden !== out) b.hidden = out;
      const active = !!on && on.id === p.id;
      if (b.classList.contains("active") !== active) b.classList.toggle("active", active);
      if (b.getAttribute("aria-pressed") !== String(active)) b.setAttribute("aria-pressed", String(active));
      setText(b.querySelector(".op-name"), nameOf(p));
      setText(b.querySelector(".op-rating"), String(Opponents.ratingOf(p.level)));
      setText(b.querySelector(".op-style"), p.style === "off" ? diffName(p.level) : styleName(p.style));
      const tip = L()[p.id].hello;
      if (b.title !== tip) b.title = tip;
    }
    const r = d.rating();
    setText(el("op-you"), r ? tf("ng.yourRating", [fmtRating(r)]) : t("ng.noRating"));
  }

  /**
   * The dialog is opening: the custom fold is open exactly when the pick is
   * a combination no persona is. Set once per opening, not on every paint,
   * so a fold the player opened stays open while they choose.
   * @returns {HTMLElement|null} the card to focus for 换个对手
   */
  function onOpen() {
    const pick = pickNow();
    const on = Opponents.personaFor(pick.difficulty, pick.personaId);
    const fold = el("ng-custom");
    if (fold) fold.open = !on;
    const grid = el("op-grid");
    return grid && on ? grid.querySelector('[data-op="' + on.id + '"]') : null;
  }

  /** 「1402」, or 「1104（定级中）」 while provisional (v9-0-plan S6: not 「1104?」) */
  function fmtRating(r) {
    return ChessRating.isProvisional(r) ? tf("rating.prov", [Math.round(r.r)]) : String(Math.round(r.r));
  }

  // --- the strip and the two lines -----------------------------------------

  /**
   * The engine's strip: the persona's avatar and name, and the rung with its
   * rating (and the style, when it has one). A combination of one's own is
   * Stockfish with the rung and style, as through 7.9.
   */
  function strip(level, style) {
    const p = Opponents.personaFor(level, style);
    const r = Opponents.ratingOf(level);
    const bits = [r ? tf("ui.pair", [diffName(level), r]) : diffName(level)];
    if (style && style !== "off") bits.push(styleName(style));
    return {
      icon: p ? p.icon : "bot",
      name: p ? nameOf(p) : "Stockfish",
      level: tdot(...bits),
    };
  }

  /** The persona's opening line, or null for a combination of one's own. */
  function hello(level, style) {
    const p = Opponents.personaFor(level, style);
    return p ? fill(L().say, [nameOf(p), L()[p.id].hello]) : null;
  }

  /**
   * The persona's end-of-game line, from facts only (7.8): the opening, the
   * moves, and what the engine side did — captures, checks.
   */
  function bye(level, style, facts) {
    const p = Opponents.personaFor(level, style);
    if (!p) return null;
    // a persona with nothing of its own to count says the shared line
    const line = fill(L()[p.id].bye || L().bye, [facts.opening || L().noOpening, facts.moves, facts.captures, facts.checks]);
    return fill(L().say, [nameOf(p), line]);
  }

  // --- the result card's rating line ---------------------------------------

  /** "等级分 1402（+17）· 最近 10 盘表现分 1420", and the advice if any. */
  function ratingLine(filed) {
    if (!filed || !filed.after) return "";
    const now = Math.round(filed.after.r);
    // a first game moves the newcomer's 1500 (rating.js), and says by how much
    const delta = now - Math.round(filed.before ? filed.before.r : ChessRating.DEFAULT.r);
    // 10.0 M0: while it is provisional a game moves it by hundreds (+305
    // for a first win), which on the result bar read as a broken number —
    // the rating alone, marked 定级中, until it settles
    const parts = [ChessRating.isProvisional(filed.after) ? tf("go.ratingProv", [fmtRating(filed.after)])
      : tf("go.rating", [fmtRating(filed.after), delta > 0 ? "+" + delta : delta < 0 ? "−" + -delta : "±0"])];
    if (filed.perf != null) parts.push(tf("go.perf", [filed.perf]));
    return tdot(...parts);
  }
  function adviceLine(filed, level) {
    if (!filed || !filed.advice) return "";
    const p = Opponents.neighbour(level, filed.advice);
    if (!p) return "";
    return tf(filed.advice === "up" ? "go.up" : "go.down",
      [nameOf(p), Opponents.ratingOf(p.level)]);
  }

  // --- the engine's draw offer ---------------------------------------------

  /**
   * Show or hide the offer. Static markup, relabelled in place: the bar sits
   * in the panel, never over the board, and the game goes on under it — a
   * move on the board is a decline.
   */
  function showOffer(name) {
    const bar = el("draw-offer");
    if (!bar) return;
    if (name) setText(el("draw-offer-text"), tf("offer.draw", [name]));
    const want = !name;
    if (bar.hidden !== want) bar.hidden = want;
  }

  // --- the engine's side of a game ------------------------------------------

  /**
   * The engine's own evaluations after each of its moves in this game, by
   * ply, and the ply of its last draw offer. Session state: a restart starts
   * the count again, which only means three more moves before a resignation.
   * Entries past the current ply are ignored (a take-back undoes them), and
   * a different game on the board forgets them all (reset, from forgetEnding).
   */
  // in the store's session slice, like every other piece of state (it is
  // never persisted): {evals: [{ply, score}], offer: {ply}|null, lastOfferPly}
  const opp = () => store.session.opp || (store.session.opp = { evals: [], offer: null, lastOfferPly: null });
  function reset() { store.session.opp = null; showOffer(null); }
  function ownScores() {
    const n = d.plies();
    const o = opp();
    o.evals = o.evals.filter((e) => e.ply <= n);
    return o.evals.map((e) => e.score);
  }

  /** Search time and pace for the engine's move, on a clock; null without one. */
  function plan(side) {
    const tc = d.parseTc(store.game.timeControl);
    if (!tc || !store.game.clock) return null;
    return Opponents.thinkPlan(d.tiers[store.session.difficulty] || {}, store.game.clock[side], tc.inc * 1000);
  }

  /**
   * The engine has chosen `mv`: note what it thinks of the position, and if
   * it has thought the game lost long enough (opponents.js shouldResign),
   * resign instead of playing it. @returns {boolean} true when it resigned
   */
  function resigns(mv) {
    if (!mv || !Number.isFinite(mv.score)) return false;
    const scores = ownScores().concat([mv.score]);
    opp().evals.push({ ply: d.plies() + 1, score: mv.score });
    if (!Opponents.shouldResign(scores)) return false;
    // the engine's side resigns: terminal, like the player's own resignation
    d.invalidateEngine();
    store.game.resigned = store.session.humanColor === "w" ? "b" : "w";
    d.forgetFileResult();
    d.playEnding(store.session.humanColor);
    d.recordOutcome("win", "resigned");
    d.saveGame();
    store.commit("game", "action");
    return true;
  }

  /** After the engine's move: offer a draw if the position is dead level. */
  function maybeOffer() {
    const scores = ownScores();
    // the game's own ply, from the FEN: a game set up from a position at
    // move 50 is an ending, however few moves were played here
    const f = d.fen().split(" ");
    const n = (Number(f[5]) - 1) * 2 + (f[1] === "b" ? 1 : 0);
    const half = Number(f[4]) || 0;
    const o = opp();
    if (!Opponents.shouldOfferDraw(scores, n, half, o.lastOfferPly)) return;
    o.lastOfferPly = n;
    o.offer = { ply: d.plies() };
    const p = Opponents.personaFor(store.session.difficulty, store.session.personaId);
    showOffer(p ? nameOf(p) : "Stockfish");
    d.announce(tf("offer.draw", [p ? nameOf(p) : "Stockfish"]));
  }

  /** The offer lapses once the game moves on (a move is a decline) or ends. */
  function syncOffer(over) {
    const o = store.session.opp;
    if (o && o.offer && (over || d.plies() !== o.offer.ply || store.session.mode !== "ai")) {
      o.offer = null;
      d.afterPress(() => { if (!(store.session.opp && store.session.opp.offer)) showOffer(null); });
    }
  }

  function wireOffer() {
    const answer = (yes) => {
      const o = store.session.opp;
      if (!o || !o.offer) return;
      o.offer = null;
      showOffer(null);
      if (yes) d.acceptDraw();
    };
    const yes = el("draw-accept"), no = el("draw-decline");
    if (yes) yes.onclick = () => answer(true);
    if (no) no.onclick = () => answer(false);
  }

  // --- the two lines, on screen ---------------------------------------------

  /** The persona's opening line, on the empty-board card. */
  function paintHello() {
    const node = el("op-hello");
    if (!node) return;
    const line = store.session.mode === "ai" ? hello(store.session.difficulty, store.session.personaId) : null;
    if (line) setText(node, line);
    if (node.hidden !== !line) node.hidden = !line;
  }

  /**
   * The result card's persona line and rating line, for an engine game that
   * was filed this session (store.session.filed is the filing of the game on
   * the board — fileRating's result, tagged with the record's id).
   */
  function paintCard(end) {
    const say = el("go-say"), rate = el("go-rating");
    const ai = !!end && store.session.mode === "ai";
    const f = store.session.filed;
    const mine = ai && f && f.id && f.id === store.game.recordedId ? f : null;
    let line = "";
    if (ai) {
      const hist = d.verboseHistory();
      const engine = store.session.humanColor === "w" ? "b" : "w";
      const theirs = hist.filter((m) => m.color === engine);
      const op = d.openingName();
      // the game's own opponent (opponents-lazy.js opponent), not whatever
      // the settings say by the ending (#89 review)
      const who = store.game.opp || { diff: store.session.difficulty, style: store.session.personaId };
      line = bye(who.diff, who.style, {
        opening: op, moves: Math.ceil(hist.length / 2),
        captures: theirs.filter((m) => m.captured).length,
        checks: theirs.filter((m) => /[+#]/.test(m.san)).length,
      }) || "";
    }
    const rl = mine ? [ratingLine(mine), adviceLine(mine, mine.level)].filter(Boolean).join(" · ") : "";
    for (const [node, text] of [[say, line], [rate, rl]]) {
      if (!node) continue;
      if (text) setText(node, text);
      if (node.hidden !== !text) node.hidden = !text;
    }
  }

  /**
   * 换个对手 after an advice: the dialog opens on the persona one rung up
   * (or down), so the suggestion is one Enter away.
   */
  function applyAdvice() {
    const f = store.session.filed;
    const ng = store.ui.newGame;
    if (!ng || !f || !f.advice || f.id !== store.game.recordedId) return;
    const p = Opponents.neighbour(f.level, f.advice);
    if (p) { ng.difficulty = p.level; ng.personaId = p.style; }
  }

  return {
    mount, paint, onOpen, strip, hello, bye, ratingLine, adviceLine, showOffer, fmtRating,
    reset, plan, resigns, maybeOffer, syncOffer, wireOffer, paintHello, paintCard, applyAdvice,
  };
}
