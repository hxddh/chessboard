/**
 * 我 (v20-0-plan §2 L4/L5, §6 S1): one number — 你的水平 — and how it grew,
 * the next stage and the skills it needs, one line of evidence about the
 * week, the library (PGN import comes with its own step), the recent games.
 * The puzzle and game ratings stay inside the model; only their blend is on
 * screen.
 * @module pages/me
 */
import { h } from "../lib/dom.js";
import { learnText } from "../text/learn.js";
import { playText } from "../text/play.js";
import { STAGES } from "../content/skills.js";
import { visibleRating, stageOf, weekly } from "../learn/model.js";
import { learnerFor, opponentFor } from "../learn/service.js";
import { addStyle } from "../learn/style.js";

const SVG = "http://www.w3.org/2000/svg";
const svg = (tag, attrs = {}) => { const e = document.createElementNS(SVG, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

/** The growth curve: one point a day, no axis numbers (the only number is the rating). */
function curve(points) {
  const el = svg("svg", { class: "curve", viewBox: "0 0 100 40", preserveAspectRatio: "none", "data-test": "curve", role: "img" });
  el.append(svg("line", { class: "base", x1: 0, y1: 39.5, x2: 100, y2: 39.5 }));
  if (points.length) {
    const ys = points.map((p) => p[1]);
    const lo = Math.min(...ys) - 50, hi = Math.max(...ys) + 50;
    const n = Math.max(points.length - 1, 1);
    const xy = points.map((p, i) => [(i / n) * 100, 38 - ((p[1] - lo) / (hi - lo)) * 34]);
    if (xy.length === 1) xy.push([100, xy[0][1]]);
    el.append(svg("polyline", { points: xy.map(([x, y]) => x.toFixed(2) + "," + y.toFixed(2)).join(" ") }));
  }
  return el;
}

export function mount(el, { ready }) {
  addStyle();
  const t = learnText(), tp = playText();
  const root = h("div", { class: "me", "data-test": "me" });
  el.append(root);
  let live = true;

  ready.then(async (db) => {
    const L = learnerFor(db);
    await L.refresh();
    const games = await db.query("game.recent", { limit: 10 });
    if (!live) return;
    const st = L.model, now = Date.now();
    const r = visibleRating(st);
    const stage = stageOf(st, STAGES);
    const opp = opponentFor(stage.rating);
    const week = weekly(st, now);
    const name = (id) => t("sk." + id);
    const oppName = tp.has("opp." + opp.id) ? tp("opp." + opp.id) : "";

    const level = h("section", { class: "card" }, h("h2", { text: t("me.level") }),
      h("div", { class: "level" }, h("span", { class: "num", "data-test": "rating", "data-rating": String(r) }, String(r))),
      h("h2", { text: t("me.curve") }), curve(st.curve));
    const stageCard = h("section", { class: "card", "data-test": "stage" },
      h("h2", { "data-test": "stage-goal" }, stage.reached ? t("me.stageDone") : t("me.stage", stage.rating)),
      stage.missing.length ? h("p", { class: "muted", text: t("me.stageNeeds", stage.missing.length) }) : h("p", { class: "muted", text: t("me.stageReady", stage.rating) }),
      h("ul", { class: "needs", "data-test": "stage-needs" }, stage.missing.slice(0, 12).map((id) => h("li", { text: name(id) }))),
      h("p", { class: "muted", text: t("me.stageUnlock") + (oppName ? " · " + oppName : "") }));
    const weekCard = h("section", { class: "card" }, h("h2", { text: t("me.week") }),
      h("p", { "data-test": "week", text: week ? t("me.weekLine", tp.has("motif." + week.motif) ? tp("motif." + week.motif) : week.motif, week.last, week.now) : t("me.weekNone") }));
    const library = h("section", { class: "card" }, h("h2", { text: t("me.library") }),
      h("div", {}, h("button", { type: "button", "data-test": "import-pgn", disabled: true, title: t("me.importSoon") }, t("me.import"))),
      h("p", { class: "muted", text: t("me.importSoon") }));
    const list = h("ul", { class: "games", "data-test": "games" }, games.length ? games.map((g) => h("li", {},
      new Date(g.startedAt).toLocaleDateString() + " · " + (g.mode === "engine" ? t("me.vsEngine") : t("me.pvp")) +
      (g.result ? " · " + g.result.result : ""))) : h("li", { text: t("me.noGames") }));
    const recent = h("section", { class: "card" }, h("h2", { text: t("me.games") }), list);
    root.replaceChildren(level, stageCard, weekCard, library, recent);
  });
  return () => { live = false; };
}
