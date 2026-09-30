/**
 * 开局浏览器的面板 (v8-0-plan C3) — the chunk explorer/lazy.js loads.
 *
 * For the position under the replay cursor: every move played from it, how
 * many games, and White wins / draws / Black wins, from your library or from
 * the built-in master tree; a move the opening book plays is marked 「书」.
 * The panel follows the board (game commits, the cursor, a variation), and a
 * row is a button: clicking it — or Enter on it — plays the move exactly as
 * a move on the board would be played (app.js movePath: a variation off the
 * live position, refused in a live engine game's past or on the engine's
 * turn).
 *
 * 7.6: the rows are rebuilt only when what they say changes (another
 * position, source, library or language), never on the commits in between —
 * the engine's lines and the clock commit several times a second — and never
 * while a pointer is down on them: a rebuild then waits for the pointer to
 * come up, so a click always lands on the button it started on.
 *
 * v8-1-plan T3: your own repertoire, too. A move your book (the side the
 * 我的开局书 switch names) plays from this position is marked 「我的」 —
 * apart from 「书」, which is the built-in book — and each row has a toggle
 * beside it that puts the move into that book or takes it out; 「加进开局书」
 * adds the moves that led to the position on the board. The marks are read
 * off the lines the main bundle holds (core.js mineIndex), the edits go
 * through repertoire-ui.js `edit`.
 * @module explorer/ui
 */
import { loadChunk } from "../chunk.js";
import { ChessFide } from "../fide.js";
import { ChessExplorer as X } from "./core.js";
import { EXPLORER_MASTERS } from "./masters-index.js";

/** chunk-xm-NN.js holds master bucket NN (scripts/bundle.mjs builds the same names). */
export function masterChunk(i) {
  const nn = String(i).padStart(2, "0");
  return { file: "chunk-xm-" + nn + ".js", global: "EXPLORER_MB_" + nn };
}

/**
 * @param {object} d app.js's bag, as explorer/lazy.js got it
 * @param {Array} bookLines openings.js's lines, from the bundle
 */
export function createExplorerUI(d, bookLines) {
  const doc = document, { store, t, tf } = d;
  const M = EXPLORER_MASTERS;
  // M5: C1's position index (d.library = LibraryUI) answers, the replay only without it
  const lib = X.librarySource(() => store.session.library, d.library, () => render());
  // the first launch after a migration indexes the old games in the
  // background (library-db.js indexMissing): ask again once that is done
  if (d.library && d.library.ready) d.library.ready().then((c) => c && c.indexing).then(() => { lib.refresh(); render(); }, () => {});
  let book = null; // built on first use: 195 lines, a few ms
  const tables = []; // master buckets that have arrived
  let shownSig = "", held = false, pending = false;

  const list = doc.getElementById("xp-list");
  const note = doc.getElementById("xp-note");
  const seg = doc.getElementById("xp-src");
  // v8-1-plan T3: 我的开局书 — which side's book, and 「加进开局书」
  const rep = d.repertoire || null;
  const repRow = doc.getElementById("xp-mine-row");
  const repSeg = doc.getElementById("xp-rep");
  const addBtn = doc.getElementById("xp-add");
  if (repRow) repRow.hidden = !rep;
  const repSide = () => (store.ui.explorer.rep === "b" ? "b" : "w");
  const mineMemo = {};
  /** The moves `side`'s book plays from `key` (re-indexed when its lines are replaced). */
  function mineAt(key) {
    const s = repSide();
    const lines = rep && store.session.repertoire ? store.session.repertoire[s] : null;
    if (!lines) return undefined;
    if (!mineMemo[s] || mineMemo[s].lines !== lines) mineMemo[s] = { lines, idx: X.mineIndex(lines) };
    return mineMemo[s].idx.get(key);
  }
  /** The moves from the starting position to the board's, or null when this game began elsewhere. */
  function pathHere() {
    const pos = d.viewGame();
    const sans = pos.history();
    const r = X.createReplay();
    for (const san of sans) if (!r.move(san)) return null;
    return r.key() === ChessFide.positionKey(pos.fen(), pos) ? sans : null;
  }

  /** The ply a position stands at, from its FEN's move number. */
  const plyOf = (pos) => { const f = pos.fen().split(" "); return (Number(f[5]) - 1) * 2 + (f[1] === "b" ? 1 : 0); };

  /** The master rows for `key` at `ply`: {rows} | {wait} | {deep}. */
  function masterRows(key, ply) {
    const b = X.bucketFor(M.buckets, ply);
    if (b < 0) return { deep: true };
    if (!tables[b]) {
      const c = masterChunk(b);
      loadChunk(c.file, c.global).then((tbl) => { tables[b] = tbl; render(); }, () => {});
      return { wait: true };
    }
    const h = X.hashKey(key);
    // a position reached at an unusual depth may sit in another bucket that is already here
    const str = tables[b][h] || tables.map((tb) => tb && tb[h]).find(Boolean);
    return { rows: X.decodeRows(str) };
  }

  function row(r) {
    const li = doc.createElement("li");
    const btn = doc.createElement("button");
    btn.type = "button";
    btn.className = "xp-row";
    btn.dataset.san = r.san;
    const [w, dr, b] = X.percents(r);
    const name = r.san + (r.book ? " · " + t("xp.book") : "") + (r.mine ? " · " + t("xp.mine") : "");
    // a book move no game played is read as just that: the move, 书
    btn.setAttribute("aria-label", r.n ? tf("xp.row", [name, r.n, w, dr, b]) : name);
    const san = doc.createElement("span");
    san.className = "xp-san";
    san.textContent = r.san;
    if (r.book) {
      const mark = doc.createElement("span");
      mark.className = "xp-book";
      mark.textContent = t("xp.book");
      san.appendChild(mark);
    }
    if (r.mine) {
      const mark = doc.createElement("span");
      mark.className = "xp-mine";
      mark.textContent = t("xp.mine");
      san.appendChild(mark);
    }
    const n = doc.createElement("span");
    n.className = "xp-n num";
    n.textContent = r.n ? String(r.n) : "";
    const bar = doc.createElement("span");
    bar.className = "xp-bar";
    [[w, "xp-w"], [dr, "xp-d"], [b, "xp-b"]].forEach(([p, cls]) => {
      if (!p) return;
      const seg = doc.createElement("span");
      seg.className = cls + " num";
      seg.style.width = p + "%";
      // the figure only where it fits; the row's name reads all three
      seg.textContent = p >= 14 ? p + "%" : "";
      bar.appendChild(seg);
    });
    for (const el of [san, n, bar]) el.setAttribute("aria-hidden", "true");
    btn.append(san, n, bar);
    li.appendChild(btn);
    if (rep) {
      // a sibling of the row, not inside it: a button in a button is not a button
      const tog = doc.createElement("button");
      tog.type = "button";
      tog.className = "xp-tog";
      tog.dataset.san = r.san;
      tog.setAttribute("aria-pressed", String(!!r.mine));
      tog.setAttribute("aria-label", tf("xp.mineToggle", [r.san, t(repSide() === "b" ? "color.black" : "color.white")]));
      tog.textContent = r.mine ? "✓" : "";
      li.appendChild(tog);
    }
    return li;
  }

  function render() {
    if (!list) return;
    if (held) { pending = true; return; }
    // anything but "master" in a stored setting is the library
    const src = store.ui.explorer.src === "master" ? "master" : "lib";
    for (const b of seg.querySelectorAll("button")) {
      const on = b.dataset.src === src;
      b.classList.toggle("active", on);
      if (b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on));
    }
    const pos = d.viewGame();
    const key = ChessFide.positionKey(pos.fen(), pos), ply = plyOf(pos);
    let out, msg;
    if (src === "master") {
      const m = masterRows(key, ply);
      out = m.rows || [];
      // past the tree's depth (M.plies) there is simply nothing, and it says so
      msg = m.wait ? "…" : !out.length ? t("xp.none")
        // the source, the rating floor and the licence are the same words in every language
        : "Lichess " + M.source.slice(-7) + " · ≥ " + M.minElo + " · " + tf("lib.count", [M.games]) + " · CC0";
    } else {
      out = lib.movesAt(key, pos.fen());
      // the index answers within the task; what is on screen stays until then
      if (!out && shownSig.startsWith("lib|")) return;
      const here = (out || []).reduce((s, r) => s + r.n, 0);
      // 本机 games are in the index but not in the imported list: rows first
      msg = !out ? "…" : here ? tf("lib.count", [here]) : !lib.size() ? t("xp.libEmpty") : t("xp.none");
      out = out || [];
    }
    if (!book) book = X.bookIndex(bookLines);
    if (repSeg) {
      for (const b of repSeg.querySelectorAll("button")) {
        const on = b.dataset.side === repSide();
        b.classList.toggle("active", on);
        if (b.getAttribute("aria-pressed") !== String(on)) b.setAttribute("aria-pressed", String(on));
      }
    }
    const rows = X.rowsAt(out, pos, book.get(key), mineAt(key));
    const sig = [src, key, msg, repSide(), rows.map((r) => [r.san, r.n, r.w, r.d, r.b, r.book, r.mine].join()).join(";")].join("|");
    if (sig === shownSig) return;
    shownSig = sig;
    if (note.textContent !== msg) note.textContent = msg;
    const at = list.contains(doc.activeElement) ? doc.activeElement : null;
    const togSan = at && at.classList.contains("xp-tog") ? at.dataset.san : null;
    list.replaceChildren(...rows.map(row));
    // a keyboard player who pressed Enter on a row keeps their place: the
    // first row of the new position (or the list itself, when it is empty);
    // on a toggle, the same move's toggle — the position did not change
    const same = togSan != null ? [...list.querySelectorAll("button.xp-tog")].find((b) => b.dataset.san === togSan) : null;
    if (at) (same || list.querySelector("button") || list).focus();
  }

  /** Put `sans` into the chosen book, or its last move out of it (repertoire-ui.js edit). */
  function editBook(sans, remove) {
    if (rep.edit(repSide(), sans, remove)) render();
  }

  // 7.6: hold the rows still under a pressed pointer
  list.addEventListener("pointerdown", () => { held = true; });
  const release = () => { if (!held) return; held = false; if (pending) { pending = false; setTimeout(render, 0); } };
  doc.addEventListener("pointerup", release, true);
  doc.addEventListener("pointercancel", release, true);

  list.addEventListener("click", (ev) => {
    const tog = ev.target.closest("button.xp-tog");
    if (tog) {
      const path = pathHere();
      editBook(path && path.concat(tog.dataset.san), tog.getAttribute("aria-pressed") === "true");
      return;
    }
    const btn = ev.target.closest("button.xp-row");
    if (!btn) return;
    const m = d.viewGame().moves({ verbose: true }).find((x) => x.san === btn.dataset.san);
    const play = m && d.movePath();
    if (!play) return;
    d.startClockIfIdle();
    play(m.from, m.to, m.promotion || "q");
  });
  if (repSeg) repSeg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-side]");
    if (!b || b.dataset.side === repSide()) return;
    store.ui.explorer.rep = b.dataset.side;
    d.saveSettings();
    render();
  });
  if (addBtn && rep) addBtn.addEventListener("click", () => editBook(pathHere(), false));
  seg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-src]");
    if (!b || b.dataset.src === store.ui.explorer.src) return;
    store.ui.explorer.src = b.dataset.src;
    d.saveSettings();
    render();
  });
  return { render };
}
