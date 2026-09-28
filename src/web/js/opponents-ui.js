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
import { ChessIcons } from "./icons.js";
import { Opponents } from "./opponents.js";

/**
 * @param {object} d what this module borrows from app.js
 */
export function createOpponentsUI(d) {
  const { doc, store, t, tf, setText, repaint, saveSettings, diffName } = d;
  const el = (id) => doc.getElementById(id);

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
    for (const p of Opponents.PERSONAS) {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "op-card";
      b.dataset.op = p.id;
      b.setAttribute("aria-pressed", "false");
      const av = doc.createElement("span");
      av.className = "op-av";
      av.setAttribute("aria-hidden", "true");
      av.appendChild(ChessIcons.icon(p.icon));
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
    const pick = pickNow();
    const on = Opponents.personaFor(pick.difficulty, pick.personaId);
    for (const b of grid.children) {
      const p = Opponents.personaById(b.dataset.op);
      if (!p) continue;
      const active = !!on && on.id === p.id;
      if (b.classList.contains("active") !== active) b.classList.toggle("active", active);
      if (b.getAttribute("aria-pressed") !== String(active)) b.setAttribute("aria-pressed", String(active));
      setText(b.querySelector(".op-name"), t("op." + p.id + ".name"));
      setText(b.querySelector(".op-rating"), String(Opponents.ratingOf(p.level)));
      setText(b.querySelector(".op-style"), p.style === "off" ? diffName(p.level) : styleName(p.style));
      const tip = t("op." + p.id + ".hello");
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

  function fmtRating(r) {
    return Math.round(r.r) + (r.rd > 110 ? "?" : "");
  }

  // --- the strip and the two lines -----------------------------------------

  /**
   * The engine's strip: the persona's avatar and name, and the rung with its
   * rating (and the style, when it has one). A combination of one's own is
   * Stockfish with the rung and style, as before 8.0.
   */
  function strip(level, style) {
    const p = Opponents.personaFor(level, style);
    const r = Opponents.ratingOf(level);
    const bits = [diffName(level) + (r ? " " + r : "")];
    if (style && style !== "off") bits.push(styleName(style));
    return {
      icon: p ? p.icon : "bot",
      name: p ? t("op." + p.id + ".name") : "Stockfish",
      level: bits.join(" · "),
    };
  }

  /** The persona's opening line, or null for a combination of one's own. */
  function hello(level, style) {
    const p = Opponents.personaFor(level, style);
    return p ? tf("op.say", [t("op." + p.id + ".name"), t("op." + p.id + ".hello")]) : null;
  }

  /**
   * The persona's end-of-game line, from facts only (7.8): the opening, the
   * moves, and what the engine side did — captures, checks.
   */
  function bye(level, style, facts) {
    const p = Opponents.personaFor(level, style);
    if (!p) return null;
    const line = tf("op." + p.id + ".bye", [facts.opening || t("op.noOpening"), facts.moves, facts.captures, facts.checks]);
    return tf("op.say", [t("op." + p.id + ".name"), line]);
  }

  // --- the result card's rating line ---------------------------------------

  /** "等级分 1402（+17）· 最近 10 盘表现分 1420", and the advice if any. */
  function ratingLine(filed) {
    if (!filed || !filed.after) return "";
    const now = Math.round(filed.after.r);
    const was = filed.before ? Math.round(filed.before.r) : null;
    const delta = was == null ? "" : now - was;
    const parts = [tf("go.rating", [fmtRating(filed.after), delta === "" ? "—" : delta > 0 ? "+" + delta : delta < 0 ? "−" + -delta : "±0"])];
    if (filed.perf != null) parts.push(tf("go.perf", [filed.perf]));
    return parts.join(" · ");
  }
  function adviceLine(filed, level) {
    if (!filed || !filed.advice) return "";
    const p = Opponents.neighbour(level, filed.advice);
    if (!p) return "";
    return tf(filed.advice === "up" ? "go.up" : "go.down",
      [t("op." + p.id + ".name"), Opponents.ratingOf(p.level)]);
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

  return { mount, paint, onOpen, strip, hello, bye, ratingLine, adviceLine, showOffer, fmtRating };
}
