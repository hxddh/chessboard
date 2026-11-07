/**
 * 我's 棋谱库 (v20-0-plan §6 S1, ADR 0003 「导入」): how many games, 导入 PGN
 * and what the last import did; 「这是你吗」 when a file's names did not say
 * which one is yours; and the list — the games imported and the games played
 * here, newest first, searched by name, event or date, filtered by result and
 * year, a page at a time (library/list.js) — whose rows open the game on a
 * board (pages/me-game.js, `#/me/game/<id>`).
 *
 * The picker is the native dialog in the app, the browser's elsewhere
 * (services/files.js); the import runs in slices (library/import.js), so a
 * large file only shows its progress here. Imported games whose side is
 * known are reviewed in the background (library/autoreview.js) — `wake()`
 * tells it the library changed.
 * @module pages/me-library
 */
import { h } from "../lib/dom.js";
import { openTextFile, FileError } from "../services/files.js";
import { oppText } from "../opponents/lines.js";
import { youCandidates } from "../learn/model.js";
import { entriesOf, dateLabel, filterEntries, pageOf, yearsOf, outcomeOf, claimsFor, PAGE_SIZE } from "../library/list.js";
import { AUTO_RECENT, AUTO_PER_DAY } from "../library/records.js";

/** library/import.js's IMPORT_MAX, without loading it before it is needed. */
const IMPORT_MAX = 64 * 1024 * 1024;

/**
 * @param {object} o
 * @param {object} o.db
 * @param {object} o.L            the learner (learn/service.js)
 * @param {Function} o.t          the 学 / 我 dictionary
 * @param {() => boolean} o.alive
 * @param {() => Promise} o.redraw  the rest of 我 (the level may have moved)
 * @param {(id: string) => void} o.open
 * @param {() => void} [o.wake]   the background review: the library changed
 */
export function libraryCard({ db, L, t, alive, redraw, open, wake = () => {} }) {
  const count = h("p", { "data-test": "lib-count" });
  const status = h("p", { class: "muted", "data-test": "import-status", "aria-live": "polite" });
  const errs = h("ul", { class: "needs", "data-test": "import-errors" });

  // --- 导入 PGN ------------------------------------------------------------------------
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
  // one import at a time: a file handed over meanwhile (the menu, a
  // double-click, a drop) waits for the one before it
  let chain = Promise.resolve();
  /** Import `given` ({ name, text } or { name, error } from the shell), or what the picker gives. */
  function run(given) {
    const next = chain.then(() => runOne(given && given.type !== "click" ? given : null));
    chain = next.catch(() => {});
    return next;
  }
  async function runOne(given) {
    let file = given;
    if (!file) {
      try { file = await openTextFile({ title: t("me.importTitle"), max: IMPORT_MAX }); }
      catch (e) { fail(e instanceof FileError ? e.code : "read", e && e.message); return; }
      if (!file) return;
    }
    if (file.error) { fail(file.error === "tooLarge" ? "tooLarge" : "read", file.name || ""); return; }
    btn.disabled = true;
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
        wake();
      } catch (e) {
        if (e instanceof ImportError) fail(e.code); else { console.warn("import:", e); fail("read", e && e.message); }
      }
    } finally {
      btn.disabled = false;
      await refresh();
    }
  }
  const btn = h("button", { type: "button", "data-test": "import-pgn", onclick: run }, t("me.import"));

  // --- 「这是你吗」 ------------------------------------------------------------------------
  const ask = h("div", { class: "you-ask", "data-test": "you-ask", hidden: true });
  function renderAsk() {
    const names = L.model ? youCandidates(L.model) : [];
    ask.hidden = !names.length;
    if (!names.length) { ask.replaceChildren(); return; }
    ask.replaceChildren(h("p", { class: "q", text: t("lib.youAsk") }), h("p", { class: "muted", text: t("lib.youWhy") }),
      h("div", { class: "names" }, ...names.map((n) => h("button", { type: "button", "data-test": "you-name", "data-name": n.name, onclick: () => claim(n.name) },
        t("lib.youName", n.name, n.games))), h("button", { type: "button", class: "quiet", "data-test": "you-none", onclick: () => claim(null) }, t("lib.youNone"))));
  }
  async function claim(name) {
    for (const b of ask.querySelectorAll("button")) b.disabled = true;
    const games = name ? claimsFor(await db.query("library.all"), name) : [];
    // the event is the record: the model rates those games, the library rows learn their side
    await L.record({ type: "library.you", name, games });
    if (name) { status.textContent = t("lib.youDone", name, games.length); status.dataset.state = "done"; errs.replaceChildren(); }
    if (alive()) await redraw();
    await refresh();
    wake();
  }

  // --- the list --------------------------------------------------------------------------
  const filter = { q: "", result: "all", year: "all", page: 0 };
  let entries = [];
  const search = h("input", { type: "search", "data-test": "lib-search", placeholder: t("lib.search"), "aria-label": t("lib.search") });
  let typing = null;
  search.addEventListener("input", () => { clearTimeout(typing); typing = setTimeout(() => { filter.q = search.value; filter.page = 0; renderList(); }, 150); });
  const opt = (value, label) => h("option", { value }, label);
  const result = h("select", { "data-test": "lib-result", "aria-label": t("lib.allResults"),
    onchange: (e) => { filter.result = e.target.value; filter.page = 0; renderList(); } },
  opt("all", t("lib.allResults")), opt("win", t("lib.win")), opt("loss", t("lib.loss")), opt("draw", t("lib.draw")));
  const year = h("select", { "data-test": "lib-year", "aria-label": t("lib.allYears"), onchange: (e) => { filter.year = e.target.value; filter.page = 0; renderList(); } });
  const list = h("ul", { class: "lib-list", "data-test": "lib-list" });
  const pageText = h("span", { class: "muted", "data-test": "lib-page" });
  const prev = h("button", { type: "button", class: "quiet", "data-test": "lib-prev", onclick: () => { filter.page--; renderList(); } }, t("lib.prev"));
  const next = h("button", { type: "button", class: "quiet", "data-test": "lib-next", onclick: () => { filter.page++; renderList(); } }, t("lib.next"));
  const total = h("span", { class: "muted", "data-test": "lib-total" });
  const pager = h("div", { class: "lib-pager" }, prev, pageText, next, total);
  // [data-test=games]: dates and counts here are not ratings (test-learn-e2e reads 我's numbers outside it)
  const listBox = h("div", { class: "lib-box", "data-test": "games" }, h("div", { class: "lib-filter" }, search, result, year), list, pager);

  const locale = () => t("date.locale");
  const dateText = (e) => dateLabel(e, locale());
  const sideName = (name, side, e) => name || (e.you === side ? t("lib.you") : t(side === "w" ? "lib.white" : "lib.black"));
  function row(e) {
    const o = outcomeOf(e);
    const res = o ? t("lib." + o) : e.result !== "*" ? e.result : "";
    const vs = t("lib.vs", sideName(e.white, "w", e), sideName(e.black, "b", e));
    const bits = [dateText(e), vs, res].filter(Boolean);
    const tags = [e.kind === "played" ? t("lib.played") : "", e.analysed || e.reviewed ? t("lib.reviewed") : ""].filter(Boolean);
    return h("li", {}, h("button", { type: "button", class: "lib-row", "data-test": "lib-row", "data-game-id": e.id, "data-outcome": o || "",
      "aria-label": t("lib.open", vs), onclick: () => open(e.id) },
    h("span", { class: "when" }, bits[0] || ""), h("span", { class: "who" }, vs), h("span", { class: "res" }, res),
    h("span", { class: "tags" }, tags.join(" · "))));
  }
  function renderList() {
    const shown = filterEntries(entries, filter);
    const pg = pageOf(shown, filter.page, PAGE_SIZE);
    filter.page = pg.page;
    list.replaceChildren(...(pg.rows.length ? pg.rows.map(row) : [h("li", { class: "muted", "data-test": "lib-none", text: entries.length ? t("lib.none") : t("me.noGames") })]));
    pageText.textContent = t("lib.page", pg.page + 1, pg.pages);
    total.textContent = t("lib.total", pg.total);
    prev.disabled = pg.page === 0;
    next.disabled = pg.page >= pg.pages - 1;
    pager.hidden = pg.pages <= 1 && !shown.length;
  }
  function renderYears() {
    const ys = yearsOf(entries);
    if (filter.year !== "all" && !ys.includes(Number(filter.year))) filter.year = "all";
    year.replaceChildren(opt("all", t("lib.allYears")), ...ys.map((y) => opt(String(y), String(y))));
    year.value = String(filter.year);
  }

  /** A played game's two sides as words: yours, the opponent's name; White and Black between two people. */
  const namesOf = (g) => {
    if (g.mode !== "engine") return { white: t("lib.white"), black: t("lib.black") };
    const them = oppText(g.opponent, "name") || t("me.vsEngine");
    return g.engineColor === "w" ? { white: them, black: t("lib.you") } : { white: t("lib.you"), black: them };
  };
  async function refresh() {
    const [lib, games, n] = await Promise.all([db.query("library.all"), db.query("games.all"), db.query("table.count", { table: "library" })]);
    if (!alive()) return;
    count.textContent = n ? t("me.libCount", n) : t("me.libEmpty");
    entries = entriesOf(lib, games, namesOf);
    renderYears();
    renderList();
    renderAsk();
  }

  const el = h("section", { class: "card", "data-test": "library" }, h("h2", { text: t("me.library") }), count,
    h("div", {}, btn), h("p", { class: "muted", text: t("me.importHow") }), status, errs, ask, listBox,
    h("p", { class: "muted small", "data-test": "lib-auto", text: t("lib.auto", AUTO_RECENT, AUTO_PER_DAY) }));
  refresh();
  return { el, refresh, importFile: run };
}
