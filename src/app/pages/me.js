/**
 * 我 (v20-0-plan §2 L4/L5, §6 S1): one number — 你的水平 — and how it grew,
 * the next stage and the skills it needs, one line of evidence about the
 * week, the library and its PGN import (library/import.js), the recent games.
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
import { openTextFile, FileError } from "../services/files.js";

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

/**
 * 棋谱库: how many games, 导入 PGN, and what the last import did. The picker is
 * the native dialog in the app, the browser's elsewhere (services/files.js);
 * the import runs in slices (library/import.js), so a large file only shows
 * its progress here.
 */
function libraryCard(db, t, L, alive, redraw) {
  const count = h("p", { "data-test": "lib-count" });
  const status = h("p", { class: "muted", "data-test": "import-status", "aria-live": "polite" });
  const errs = h("ul", { class: "needs", "data-test": "import-errors" });
  const showCount = async () => {
    const n = await db.query("table.count", { table: "library" });
    if (alive()) count.textContent = n ? t("me.libCount", n) : t("me.libEmpty");
  };
  const done = (r) => {
    const parts = [r.added ? t("me.importDone", r.added) : t("me.importNone")];
    if (r.dup) parts.push(t("me.importDup", r.dup));
    if (r.bad.length) parts.push(t("me.importBad", r.bad.length));
    if (r.empty) parts.push(t("me.importEmpty", r.empty));
    if (r.you) parts.push(t("me.importYou", r.you));
    status.textContent = (r.kind === "v19" ? t("me.importV19") + " · " : "") + parts.join(t("me.importSep")) + t("me.importEnd");
    status.dataset.state = "done";
    errs.replaceChildren(...r.bad.slice(0, 5).map((b) => {
      const why = t("imp.err." + b.code, b.token);
      return h("li", { text: b.line ? t("me.importBadLine", b.n, b.line, why) : t("me.importBadItem", b.item || b.n, why) });
    }), ...(r.bad.length > 5 ? [h("li", { text: t("me.importMore", r.bad.length - 5) })] : []));
  };
  const fail = (code, detail = "") => {
    status.textContent = t("imp.file." + code, detail);
    status.dataset.state = "error";
    errs.replaceChildren();
  };
  let busy = false;
  async function run() {
    if (busy) return;
    let file;
    try { file = await openTextFile({ title: t("me.importTitle"), max: IMPORT_MAX }); }
    catch (e) { fail(e instanceof FileError ? e.code : "read", e && e.message); return; }
    if (!file) return;
    busy = true; btn.disabled = true;
    status.dataset.state = "busy";
    status.textContent = t("me.importReading", 0, "…");
    try {
      const { importFile, ImportError } = await import("../library/import.js");
      try {
        const r = await importFile(file.text, { db, name: file.name, onProgress: (phase, d, n) => {
          status.textContent = t(phase === "read" ? "me.importReading" : "me.importSaving", d, n);
        } });
        done(r);
        if (alive()) await redraw();
      } catch (e) {
        if (e instanceof ImportError) fail(e.code); else { console.warn("import:", e); fail("read", e && e.message); }
      }
    } finally {
      busy = false; btn.disabled = false;
      showCount();
    }
  }
  const btn = h("button", { type: "button", "data-test": "import-pgn", onclick: run }, t("me.import"));
  showCount();
  return h("section", { class: "card", "data-test": "library" }, h("h2", { text: t("me.library") }), count,
    h("div", {}, btn), h("p", { class: "muted", text: t("me.importHow") }), status, errs);
}
/** library/import.js's IMPORT_MAX, without loading it before it is needed. */
const IMPORT_MAX = 64 * 1024 * 1024;

export function mount(el, { ready }) {
  addStyle();
  const t = learnText(), tp = playText();
  const root = h("div", { class: "me", "data-test": "me" });
  el.append(root);
  let live = true;

  let library = null;
  ready.then(async function render(db) {
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
    // one card for the page's life: an import re-draws the rest (the level may have moved), not its own report
    library ||= libraryCard(db, t, L, () => live, () => render(db));
    const list = h("ul", { class: "games", "data-test": "games" }, games.length ? games.map((g) => h("li", {},
      new Date(g.startedAt).toLocaleDateString() + " · " + (g.mode === "engine" ? t("me.vsEngine") : t("me.pvp")) +
      (g.result ? " · " + g.result.result : ""))) : h("li", { text: t("me.noGames") }));
    const recent = h("section", { class: "card" }, h("h2", { text: t("me.games") }), list);
    root.replaceChildren(level, stageCard, weekCard, library, recent);
  });
  return () => { live = false; };
}
