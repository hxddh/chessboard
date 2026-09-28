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
  const { doc, store, t, tf } = d;
  const M = EXPLORER_MASTERS;
  const lib = X.librarySource(() => store.session.library);
  let book = null; // built on first use: 195 lines, a few ms
  const tables = []; // master buckets that have arrived
  let shownSig = "", held = false, pending = false;

  const list = doc.getElementById("xp-list");
  const note = doc.getElementById("xp-note");
  const seg = doc.getElementById("xp-src");

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
    btn.setAttribute("aria-label", r.n ? tf("xp.row", [r.san + (r.book ? " · " + t("xp.book") : ""), r.n, w, dr, b]) : tf("xp.rowBook", [r.san]));
    const san = doc.createElement("span");
    san.className = "xp-san";
    san.textContent = r.san;
    if (r.book) {
      const mark = doc.createElement("span");
      mark.className = "xp-book";
      mark.textContent = t("xp.book");
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
    return li;
  }

  function render() {
    if (!list) return;
    if (held) { pending = true; return; }
    const src = store.ui.explorer.src;
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
      msg = m.deep ? tf("xp.deep", [M.plies]) : m.wait ? t("xp.loading") : !out.length ? t("xp.none")
        : tf("xp.masterNote", [M.source.slice(-7), M.minElo, M.games]);
    } else {
      out = lib.movesAt(key);
      const here = out.reduce((s, r) => s + r.n, 0);
      msg = !lib.size() ? t("xp.libEmpty") : here ? tf("lib.count", [here])
        : ply >= X.LIB_PLIES ? tf("xp.deep", [X.LIB_PLIES]) : t("xp.none");
    }
    if (!book) book = X.bookIndex(bookLines);
    const rows = X.rowsAt(out, pos, book.get(key));
    const sig = [src, key, msg, rows.map((r) => [r.san, r.n, r.w, r.d, r.b, r.book].join()).join(";")].join("|");
    if (sig === shownSig) return;
    shownSig = sig;
    if (note.textContent !== msg) note.textContent = msg;
    const refocus = list.contains(doc.activeElement);
    list.replaceChildren(...rows.map(row));
    // a keyboard player who pressed Enter on a row keeps their place: the
    // first row of the new position (or the list itself, when it is empty)
    if (refocus) (list.querySelector("button") || list).focus();
  }

  // 7.6: hold the rows still under a pressed pointer
  list.addEventListener("pointerdown", () => { held = true; });
  const release = () => { if (!held) return; held = false; if (pending) { pending = false; setTimeout(render, 0); } };
  doc.addEventListener("pointerup", release, true);
  doc.addEventListener("pointercancel", release, true);

  list.addEventListener("click", (ev) => {
    const btn = ev.target.closest("button.xp-row");
    if (!btn) return;
    const m = d.viewGame().moves({ verbose: true }).find((x) => x.san === btn.dataset.san);
    const play = m && d.movePath();
    if (!play) return;
    d.startClockIfIdle();
    play(m.from, m.to, m.promotion || "q");
  });
  seg.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-src]");
    if (!b || b.dataset.src === store.ui.explorer.src) return;
    store.ui.explorer.src = b.dataset.src;
    d.saveSettings();
    render();
  });
  return { render };
}
