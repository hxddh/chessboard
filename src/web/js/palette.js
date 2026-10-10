/**
 * ⌘K 命令面板 — find a thing and go there, from the keyboard (v10-0-plan A3).
 *
 * The app holds 120 lessons, 90 endgame positions, the puzzle themes, the
 * library's games and a dozen actions that live behind ⋯ (粘贴 PGN, 编辑局面,
 * 载入 FEN, 导出). Each had one place to be found, a few clicks deep. This is
 * the one box that finds any of them: type, ↑ ↓, Enter.
 *
 * Everything is listed in the interface language at the moment the panel
 * opens, and searched as written there, so it searches in whichever of the
 * three languages the app is in; ids (an ECO code, a theme's key) match too.
 *
 * A chunk (chunk-palette.js): palette-lazy.js holds the key and the loader,
 * and the dialog's markup is the page's (#palette-modal).
 * @module palette
 */

/** Rows shown at most — the list is for choosing, not for browsing. */
export const SHOWN = 40;

/** Lower case, no spaces: 「残局 车」 finds 残局·车兵对车. */
export function norm(s) {
  return String(s || "").toLowerCase().replace(/\s+/g, "");
}

/**
 * The rows matching `q`, best first: a label that begins with it before one
 * that only contains it, and within each, the order they were listed in
 * (actions, then places, then content).
 */
export function search(items, q) {
  const n = norm(q);
  if (!n) return items.slice(0, SHOWN);
  const head = [], body = [];
  for (const it of items) {
    const label = norm(it.label);
    if (label.startsWith(n)) head.push(it);
    else if (label.includes(n) || (it.alt && norm(it.alt).includes(n))) body.push(it);
  }
  return head.concat(body).slice(0, SHOWN);
}

/**
 * @param {object} d doc, t, tf, tdot, Dlg, store, LESSONS, lessonText, THEME_IDS,
 *   Endgames, SETTING_CATS, run: {newGame, analyse, blank, paste, editor, fen,
 *   exportPgn, flip, go(view), train(seg), settings(cat), lesson(i), theme(id),
 *   endgame(id), libGame(entry)}
 */
export function createPalette(d) {
  const { doc, t, tf, tdot, Dlg, store, run } = d;
  const el = (id) => doc.getElementById(id);
  const ui = { items: [], shown: [], at: 0 };

  /** Everything findable, in the language of the moment. */
  function items() {
    const out = [];
    const add = (kind, label, go, alt) => out.push({ kind, label, go, alt: alt || "" });
    add("action", t("ng.title"), run.newGame);
    add("action", t("an.open"), run.analyse);
    add("action", t("an.board"), run.blank);
    add("action", t("pal.paste"), run.paste);
    add("action", t("act.editorLong"), run.editor);
    add("action", t("act.loadFen"), run.fen, "fen");
    add("action", t("pal.exportPgn"), run.exportPgn, "pgn");
    add("action", t("pal.flip"), run.flip);
    for (const v of ["home", "play", "library", "me"]) add("go", t("nav." + v), () => run.go(v));
    for (const s of ["course", "puzzle", "endgame", "classic"]) add("go", tdot(t("nav.train"), t("train." + s)), () => run.train(s));
    for (const c of d.SETTING_CATS) add("go", tdot(t("nav.settings"), t("set." + c)), () => run.settings(c));
    d.LESSONS.forEach((L, i) => {
      if (!L.tasks || !L.tasks.length) return;
      const tx = d.lessonText(L);
      add("lesson", tf("today.lessonN", [i + 1, tx.title]), () => run.lesson(i), tx.part);
    });
    const E = d.Endgames;
    if (E && E.ready()) {
      for (const id of E.items()) {
        const L = E.lesson(id);
        if (L) add("endgame", L.title, () => run.endgame(id), L.part);
      }
    }
    for (const id of d.THEME_IDS) add("theme", t("pzt." + id), () => run.theme(id), id);
    for (const g of (store.session.library || []).slice(0, 400)) {
      add("game", tdot((g.white || "?") + " – " + (g.black || "?"), g.date || "", g.result || ""), () => run.libGame(g), g.eco || "");
    }
    return out;
  }

  function paint() {
    const list = el("palette-list");
    if (!list) return;
    list.replaceChildren(...ui.shown.map((it, i) => {
      const b = doc.createElement("button");
      b.type = "button";
      b.className = "pal-row";
      b.setAttribute("role", "option");
      b.setAttribute("aria-selected", i === ui.at ? "true" : "false");
      b.id = "pal-" + i;
      const k = doc.createElement("span");
      k.className = "pal-kind";
      k.textContent = t("pal.kind." + it.kind);
      const l = doc.createElement("span");
      l.className = "pal-label";
      l.textContent = it.label;
      b.append(l, k);
      b.onclick = () => choose(i);
      return b;
    }));
    const none = el("palette-none");
    if (none) none.hidden = ui.shown.length > 0;
    const input = el("palette-input");
    if (input) input.setAttribute("aria-activedescendant", ui.shown.length ? "pal-" + ui.at : "");
    const on = list.children[ui.at];
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest" });
  }

  function filter() {
    ui.shown = search(ui.items, (el("palette-input") || {}).value);
    ui.at = 0;
    paint();
  }

  function choose(i) {
    const it = ui.shown[i];
    if (!it) return;
    close();
    it.go();
  }

  function open() {
    const modal = el("palette-modal"), input = el("palette-input");
    if (!modal) return;
    if (modal.classList.contains("show")) { close(); return; }
    ui.items = items();
    if (input) input.value = "";
    filter();
    Dlg.open(modal, input);
  }
  function close() { Dlg.close(el("palette-modal")); }

  function wire() {
    const input = el("palette-input");
    if (input) {
      input.oninput = filter;
      input.onkeydown = (ev) => {
        if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
          ev.preventDefault();
          if (!ui.shown.length) return;
          ui.at = (ui.at + (ev.key === "ArrowDown" ? 1 : -1) + ui.shown.length) % ui.shown.length;
          paint();
        } else if (ev.key === "Enter") {
          ev.preventDefault();
          choose(ui.at);
        }
      };
    }
    const modal = el("palette-modal");
    if (modal) modal.onclick = (ev) => { if (ev.target === modal) close(); };
  }

  wire();
  return { open, close };
}
