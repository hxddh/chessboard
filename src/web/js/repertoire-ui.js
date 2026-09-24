/**
 * 我的开局书的存档、导入与那一块界面。
 *
 * The model is repertoire.js; this is what the app wraps around it — the
 * on-disk book, the two import buttons, the 记录 pane's section with the
 * coverage gaps, and the drills handed to the trainer.
 *
 * Built as its own module from the start (7.2, v7-2-plan §3) rather than
 * added to app.js, for the reason §4 of the same plan had just finished
 * arguing: app.js had passed ten thousand lines because every feature was
 * added to it. The seam here is the same one library-ui.js uses — everything
 * borrowed from the app arrives in the bag.
 *
 * What is deliberately NOT here: the drilling itself. A repertoire drill is
 * an opening drill with a different book behind it, and it rides the rails
 * the trainer already has — `opening-tree.js` for the tree, `drills.js` for
 * the ids, `srs.js` for the schedule. This module hands over rows and
 * puzzles; app.js serves them exactly as it serves the built-in book.
 * @module repertoire-ui
 */
import { ChessEco } from "./eco-lookup.js";
import { ChessOpeningTree } from "./opening-tree.js";
import { ChessPgnParser } from "./pgn-parser.js";
import { ChessRepertoire } from "./repertoire.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createRepertoireUI(d) {
  const { doc, store, Persist, t, tf, toast, confirmNative, openPgnFile, sync, forgetDrills } = d;
  const Rep = ChessRepertoire;

  /** How many of your games in an opening before its absence is a gap. */
  const GAP_MIN_GAMES = 2;

  function loadBook() {
    const s = Persist.read("repertoire").value;
    const side = (k) => (s && Array.isArray(s[k])
      ? s[k].filter((l) => l && l.id && typeof l.sans === "string" && l.sans)
      : []);
    return { w: side("w"), b: side("b") };
  }
  store.session.repertoire = loadBook();
  function saveBook() {
    Persist.setJson("repertoire", { v: 1, w: store.session.repertoire.w, b: store.session.repertoire.b });
  }

  const linesOf = (side) => store.session.repertoire[side === "b" ? "b" : "w"] || [];
  const total = () => linesOf("w").length + linesOf("b").length;

  /**
   * The ECO code and name for one line, from the same table that names a
   * library game. Null before the ECO chunk has loaded — a book imported
   * then keeps its lines and simply has no names, which is why `addLines`
   * takes the namer rather than requiring it.
   */
  function nameOf(sans) {
    if (!ChessEco.loaded()) return null;
    const hit = ChessEco.openingForGame(sans.split(" "));
    return hit ? { eco: hit.eco, name: hit.name } : null;
  }

  /** Fill in names that were missing when the book was imported. */
  function fillNames() {
    if (!ChessEco.loaded()) return false;
    let changed = false;
    for (const side of ["w", "b"]) {
      for (const l of linesOf(side)) {
        if (l.eco) continue;
        const hit = nameOf(l.sans);
        // the id carries the code, so a line named later keeps the id it was
        // drilled under — progress must not move when a name arrives
        if (hit && hit.eco) { l.eco = hit.eco; l.name = hit.name; changed = true; }
      }
    }
    return changed;
  }

  // a file being read (7.5: that is no longer instant); a second import
  // meanwhile is turned away rather than interleaved with it
  let importing = false;

  /**
   * Take a repertoire PGN into one side's book.
   *
   * Every root-to-leaf path becomes a line, including the variations —
   * unlike the library's importer, which keeps the mainline only. See
   * repertoire.js for why the two opposite rules are the same rule.
   *
   * Game by game, the way the library's importer reads a file (7.4 D2). 7.2
   * handed the whole text to one `parsePgn`, so a single illegal move in the
   * fortieth game of a file threw the other thirty-nine away with it.
   */
  async function importInto(side, text, label) {
    const text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return; }
    if (importing) return;
    let chunks;
    try { chunks = ChessPgnParser.splitGames(text0); } catch (_) { chunks = [text0]; }
    // 7.5: game by game with the thread handed back every ~16 ms, so a big
    // book file does not freeze the window while it is read
    let parsed;
    importing = true;
    try { parsed = await ChessPgnParser.parseGamesAsync(chunks); }
    finally { importing = false; }
    const games = parsed.filter(Boolean);
    const bad = parsed.length - games.length;
    const read = Rep.linesFrom(games);
    // a file that held nothing but set-up positions is not a broken file —
    // it is the wrong kind of file, and saying which is the whole difference
    if (!read.lines.length && read.skipped) { toast(tf("rep.skippedSetUp", [read.skipped]), "fix"); return; }
    if (!read.lines.length) { toast(t("msg.import.badPgn"), "fault"); return; }
    const r = Rep.addLines(linesOf(side), read.lines, nameOf);
    store.session.repertoire[side === "b" ? "b" : "w"] = r.lines;
    // the ids that left — the cap's casualties and the shorter lines a deeper
    // one replaced — take their solved/missed entries with them
    const gone = r.dropped.concat(r.replaced);
    if (gone.length) forgetDrills(gone);
    saveBook();
    render();
    sync();
    if (!r.added) toast(tf("rep.addedNone", [r.dup]), "fix");
    else toast(tf("rep.added", [r.added, r.dup]) + (label ? " · " + label : ""));
    // only the cap is news: a short line a deeper one grew out of did not
    // leave the book, it got longer (7.4 D3)
    if (r.dropped.length) toast(tf("rep.dropped", [Rep.MAX_LINES, r.dropped.length]), "fix");
    if (read.skipped) toast(tf("rep.skippedSetUp", [read.skipped]), "fix");
    if (bad) toast(tf("rep.badGames", [bad]), "fix");
  }

  async function clearBook() {
    if (!total()) return;
    const ok = await confirmNative(t("rep.clearAsk"), t("rep.clearTitle"),
      { ok: t("rep.clearOk"), cancel: t("act.cancel") });
    if (!ok) return;
    // …and so does the whole book: a review owed to a drill that no longer
    // exists is counted for ever and can never be served
    forgetDrills(linesOf("w").concat(linesOf("b")).map((l) => l.id));
    store.session.repertoire = { w: [], b: [] };
    saveBook();
    render();
    sync();
    toast(t("rep.cleared"));
  }

  // --- what the trainer reads ------------------------------------------------

  /**
   * One side's book as a tree, rebuilt when the book changes.
   *
   * Cached on the lines array's identity rather than on a dirty flag: every
   * path that changes the book replaces the array, so an identity check is
   * exactly the question "is this tree still about the book we have".
   */
  const treeCache = { w: null, b: null };
  function treeFor(side) {
    const key = side === "b" ? "b" : "w";
    const lines = linesOf(key);
    if (!treeCache[key] || treeCache[key].from !== lines) {
      treeCache[key] = { from: lines, tree: ChessOpeningTree.buildTree(Rep.rowsOf(lines)) };
    }
    return treeCache[key].tree;
  }

  /**
   * The drills for one chair.
   *
   * The same shape the built-in opening drills have, because they are served
   * by the same code: an id, the line in SAN, the chair it is played from.
   * `cat` is what tells the trainer which tree to judge against.
   */
  function drills(side) {
    const key = side === "b" ? "b" : "w";
    return linesOf(key).map((l) => ({
      id: l.id + (key === "b" ? ":b" : ""),
      cat: "rep",
      side: key === "b" ? "b" : undefined,
      eco: l.eco || "",
      name: (l.eco ? l.eco + " " : "") + (l.name || t("rep.unnamed")),
      line: l.sans.split(" "),
    }));
  }

  /** Every drill in the book, both chairs — what the review queue reads. */
  function allDrills() {
    return drills("w").concat(drills("b"));
  }

  // --- the section in the 记录 pane -------------------------------------------

  /**
   * Openings this player actually plays and has nothing written down about.
   *
   * The half of this feature that only became true in 7.1: before it, the
   * app could say "your book does not cover the French", which is a fact
   * about two lists. `diagnose().ecos` makes it a fact about the player —
   * how many games, and how many of them lost — so the list is ordered by
   * what the gap has cost and the worst one is named first.
   */
  function gapRows() {
    const diag = d.diagnose();
    if (!diag || !diag.enough) return [];
    const covered = Rep.coveredEcos(linesOf("w").concat(linesOf("b")));
    return Rep.gaps(diag.ecos, covered, GAP_MIN_GAMES);
  }

  function render() {
    const body = doc.getElementById("rep-body");
    if (!body) return;
    // The ECO table is a lazy chunk, and asking for it is what fetches it —
    // so this section must not ask on a profile that has nothing to name. The
    // first screen fetching a chunk is a guarded regression in this repo
    // (scripts/test-board-e2e.mjs: 「首屏一个 chunk 都没取」), and this
    // section renders as part of the 记录 pane at boot. Ask only when there
    // is a book to label or a library to diagnose; on a fresh profile that is
    // never, which is exactly the case the guard describes.
    const needsNames = total() > 0 || (store.session.library || []).some((g) => g && g.an);
    if (needsNames && !ChessEco.loaded()) ChessEco.whenReady(() => { if (fillNames()) saveBook(); render(); });
    else if (ChessEco.loaded() && fillNames()) saveBook();
    const meta = doc.getElementById("rep-meta");
    if (meta) { meta.hidden = !total(); meta.textContent = tf("rep.count", [total()]); }
    body.replaceChildren();
    const line = (text, cls) => {
      const p = doc.createElement("p");
      p.className = cls || "hint";
      p.textContent = text;
      body.appendChild(p);
    };
    if (!total()) {
      line(t("rep.empty"));
    } else {
      const row = doc.createElement("div");
      row.className = "stat-row";
      const k = doc.createElement("span");
      k.className = "stat-k";
      k.textContent = t("rep.lines");
      const v = doc.createElement("span");
      v.className = "stat-v num";
      v.textContent = tf("rep.bySide", [linesOf("w").length, linesOf("b").length]);
      row.append(k, v);
      body.appendChild(row);
      const solved = allDrills().filter((p) => store.session.puzzleState.solved[p.id]).length;
      line(tf("rep.learnt", [solved, total()]));
    }
    // the gaps, whether or not there is a book: with no book at all, every
    // opening you play is a gap, and that is the most useful thing this
    // section can say to someone who has not imported anything yet
    const gaps = gapRows();
    if (gaps.length) {
      const h = doc.createElement("p");
      h.className = "hint";
      h.textContent = t("rep.gapsTitle");
      body.appendChild(h);
      for (const g of gaps) {
        const r = doc.createElement("div");
        r.className = "stat-row";
        const k = doc.createElement("span");
        k.className = "stat-k";
        k.textContent = g.eco + " " + (g.name || "");
        // an opening's full name rarely fits the name track — it is cut with
        // an ellipsis there, so the whole of it lives here (7.3 B3)
        k.title = k.textContent;
        const v = doc.createElement("span");
        v.className = "stat-v num";
        v.textContent = tf("rep.gapRecord", [g.n, g.loss]);
        r.append(k, v);
        body.appendChild(r);
      }
    }
    const drill = doc.getElementById("rep-drill");
    if (drill) drill.hidden = !total();
    const clear = doc.getElementById("rep-clear");
    if (clear) clear.hidden = !total();
  }

  /** Wire the section's four buttons. Called once, from app.js's boot. */
  function wire() {
    const impW = doc.getElementById("rep-import-w");
    if (impW) impW.onclick = () => { openPgnFile((text, label) => importInto("w", text, label)); };
    const impB = doc.getElementById("rep-import-b");
    if (impB) impB.onclick = () => { openPgnFile((text, label) => importInto("b", text, label)); };
    const drill = doc.getElementById("rep-drill");
    if (drill) drill.onclick = () => d.startDrills();
    const clear = doc.getElementById("rep-clear");
    if (clear) clear.onclick = () => { clearBook(); };
  }

  /** Re-read the book from storage — after a learning file brought one in. */
  function reload() {
    store.session.repertoire = loadBook();
    render();
  }

  return { render, wire, drills, allDrills, treeFor, total, gapRows, importInto, linesOf, reload };
}
