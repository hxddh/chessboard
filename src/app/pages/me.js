/**
 * 我 (v20-0-plan §2 L4/L5, §6 S1): one number — 你的水平 — and how it grew,
 * the next stage and the skills it needs, one line of evidence about the
 * week, and the library (pages/me-library.js: its PGN import, 「这是你吗」,
 * the list of games imported and played); `#/me/game/<id>` opens one of them
 * on a board (pages/me-game.js).
 * The puzzle and game ratings stay inside the model; only their blend is on
 * screen.
 * @module pages/me
 */
import { h } from "../lib/dom.js";
import { learnText } from "../text/learn.js";
import { playText } from "../text/play.js";
import { STAGES } from "../content/skills.js";
import { visibleRating, ratingKnown, stageOf, weekly, nextSkills } from "../learn/model.js";
import { learnerFor, opponentFor } from "../learn/service.js";
import { addStyle } from "../learn/style.js";
import { oppText } from "../opponents/lines.js";
import { effect, untrack } from "../lib/signal.js";
import { libraryCard } from "./me-library.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/**
 * The growth curve: one point a day, no axis numbers (the only number is the
 * rating). Before there are two points (v20-0-plan §11 L4) it says what will
 * be drawn there — a faint rising line where the curve will go, and a word.
 */
function curve(points, t) {
  const el = svg("svg", { class: "curve", viewBox: "0 0 100 40", preserveAspectRatio: "none", "data-test": "curve", role: "img",
    "aria-label": t("me.curve") });
  el.append(svg("line", { class: "base", x1: 0, y1: 39.5, x2: 100, y2: 39.5 }));
  if (!points.length) {
    el.append(svg("path", { class: "ghost", d: "M0,36 C20,35 30,30 45,27 S75,16 100,8", "aria-hidden": "true" }));
    return h("div", { class: "curve-box empty" }, el, h("p", { class: "curve-empty muted", "data-test": "curve-empty" }, t("me.curveEmpty")));
  }
  const ys = points.map((p) => p[1]);
  const lo = Math.min(...ys) - 50, hi = Math.max(...ys) + 50;
  const n = Math.max(points.length - 1, 1);
  const xy = points.map((p, i) => [(i / n) * 100, 38 - ((p[1] - lo) / (hi - lo)) * 34]);
  if (xy.length === 1) xy.push([100, xy[0][1]]);
  el.append(svg("polyline", { points: xy.map(([x, y]) => x.toFixed(2) + "," + y.toFixed(2)).join(" ") }));
  if (points.length > 1) return el;
  return h("div", { class: "curve-box" }, el, h("p", { class: "curve-empty muted", "data-test": "curve-empty" }, t("me.curveOne")));
}

export function mount(el, { ready, route, router, store, engine, background, commands }) {
  addStyle();
  const t = learnText();
  const root = h("div", { class: "me", "data-test": "me" });
  const host = h("div", { class: "lib-game-host" });
  el.append(root, host);
  let live = true;
  const open = (id) => router.go("/me/game/" + encodeURIComponent(id));
  const wake = () => { if (background) background.wake(); };

  let library = null, libraryShown;
  const libraryReady = new Promise((r) => { libraryShown = r; });
  // the menu bar (services/shell.js): 导入 PGN…, and a file the OS handed over
  const menu = commands ? [
    commands.handle("file.import", () => libraryReady.then((lib) => lib.importFile())),
    commands.handle("file.open", (file) => libraryReady.then((lib) => lib.importFile(file))),
  ] : [];
  ready.then(async function render(db) {
    const L = learnerFor(db);
    await L.refresh();
    if (!live) return;
    const st = L.model, now = Date.now();
    const r = visibleRating(st);
    const stage = stageOf(st, STAGES);
    const opp = opponentFor(stage.rating);
    const week = weekly(st, now);
    const next = nextSkills(st, stage.missing);
    const name = (id) => t("sk." + id);
    const tp = playText();
    const oppName = opp ? oppText(opp.id, "name") : "";

    // no number before there is evidence (§11 L4): what it takes to have one, and the way there
    const known = ratingKnown(st);
    const level = h("section", { class: "card" }, h("h2", { text: t("me.level") }),
      known ? h("div", { class: "level" }, h("span", { class: "num", "data-test": "rating", "data-rating": String(r), "data-known": "1" }, String(r)))
        : h("div", { class: "level unknown" }, h("span", { class: "num-unknown", "data-test": "rating", "data-rating": "", "data-known": "0" }, t("me.unknown")),
          h("p", { class: "muted", "data-test": "rating-why" }, st.placed ? t("me.unknownSoon") : t("me.unknownWhy")),
          ...(st.placed ? [] : [h("button", { type: "button", class: "primary", "data-test": "go-place", onclick: () => router.go("/learn") }, t("me.placeGo"))])),
      h("h2", { text: t("me.curve") }), curve(known ? st.curve : [], t));
    const stageCard = h("section", { class: "card", "data-test": "stage" },
      h("h2", { "data-test": "stage-goal" }, stage.reached ? t("me.stageDone") : t("me.stage", stage.rating)),
      // all four reached: that is the whole card (no "reach N" and no unlock still to come)
      ...(stage.reached ? [] : [
        // the count and the list agree (§11 L9): all of them, or "N to go — start with these 12"
        stage.missing.length ? h("p", { class: "muted", "data-test": "stage-count", "data-total": String(stage.missing.length), "data-shown": String(next.length),
          text: next.length < stage.missing.length ? t("me.stageMore", stage.missing.length, next.length) : t("me.stageNeeds", stage.missing.length) })
          : h("p", { class: "muted", text: t("me.stageReady", stage.rating) }),
        h("ul", { class: "needs", "data-test": "stage-needs" }, next.map((id) => h("li", { text: name(id) }))),
        h("p", { class: "muted", "data-test": "stage-unlock", text: t("me.stageUnlock") + (oppName ? " · " + oppName : "") })]));
    const weekCard = h("section", { class: "card" }, h("h2", { text: t("me.week") }),
      h("p", { "data-test": "week", text: week ? t("me.weekLine", tp.has("motif." + week.motif) ? tp("motif." + week.motif) : week.motif, week.last, week.now) : t("me.weekNone") }));
    // one card for the page's life: an import or an answer re-draws the rest (the level may have moved), not its own report
    library ||= libraryCard({ db, L, t, alive: () => live, redraw: () => render(db), open, wake });
    root.replaceChildren(level, stageCard, weekCard, library.el);
    libraryShown(library);
  });

  // #/me/game/<id>: the game on a board, the list kept underneath as it was
  let viewer = null, viewing = null;
  function show(id) {
    if (id === viewing) return;
    viewing = id;
    if (viewer) { viewer(); viewer = null; }
    root.hidden = !!id;
    if (!id) { if (library) library.refresh(); return; }
    ready.then(async (db) => {
      if (!live || viewing !== id) return;
      const { mountGame } = await import("./me-game.js");
      if (!live || viewing !== id) return;
      viewer = mountGame(host, { db, store, engine, id, t, back: () => router.go("/me"), commands });
    });
  }
  const off = route ? effect(() => {
    const r = route.value;
    const id = r.path === "/me" && r.rest[0] === "game" && r.rest[1] ? r.rest[1] : null;
    untrack(() => show(id));
  }) : () => {};
  // a game the background review finished shows as reviewed when the list is next drawn
  const offBg = background && background.version ? effect(() => { background.version.value; untrack(() => { if (library && !viewing) library.refresh(); }); }) : () => {};

  return () => { live = false; off(); offBg(); menu.forEach((x) => x()); if (viewer) viewer(); };
}
