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
 *
 * v8-1-plan T3: the book is also kept by position — IndexedDB records with a
 * review card on every move of yours (rep-page.js, chunk-rep.js, booted once
 * the library's chunk is in). The lines here stay the book's structure: every
 * edit is an edit of the lines, and `commit` hands the new lines to the chunk
 * to index. What the chunk adds reaches this module as `ctrl`.
 * @module repertoire-ui
 */
import { loadChunk } from "./chunk.js";
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
  /** chunk-rep.js's controller once it has booted (rep-page.js), else null. */
  let ctrl = null;
  /** v8-1-plan T3: what the stored header said about the records (db, n, sig), kept until the chunk speaks. */
  let headExtra = {};

  /** How many of your games in an opening before its absence is a gap. */
  const GAP_MIN_GAMES = 2;

  function loadBook() {
    const s = Persist.read("repertoire").value;
    headExtra = s && s.db === 2 ? { db: 2, n: s.n, sig: s.sig } : {};
    const side = (k) => (s && Array.isArray(s[k])
      ? s[k].filter((l) => l && l.id && typeof l.sans === "string" && l.sans)
      : []);
    return { w: side("w"), b: side("b") };
  }
  store.session.repertoire = loadBook();
  function saveBook() {
    // still the 7.2 shape, `{v: 1, w, b}`: an older build reads the whole
    // book. `db`, `n` and `sig` are the records' (rep-page.js), when the
    // chunk vouches for them; what the header last said until it has booted
    Persist.setJson("repertoire", Object.assign({ v: 1, w: store.session.repertoire.w, b: store.session.repertoire.b },
      ctrl ? ctrl.extra() : headExtra));
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
    // the book this import was started on: clearing it, or restoring learning
    // data, while the file is still being read replaces the object, and adding
    // the file's lines afterwards would quietly undo that
    const book = store.session.repertoire;
    importing = true;
    try { parsed = await ChessPgnParser.parseGamesAsync(chunks); }
    finally { importing = false; }
    if (store.session.repertoire !== book) return;
    const games = parsed.filter(Boolean);
    const bad = parsed.length - games.length;
    // v8-1-plan T3: a book this app exported says whose it is ([RepSide]) and
    // is read exactly as written, into that side whichever button it came by
    const tagged = (g) => { const h = (g.headers || []).find(([k]) => k === "RepSide"); return h && /^[wb]$/.test(h[1]) ? h[1] : null; };
    const read = Rep.linesFrom(games.filter((g) => !tagged(g)));
    const own = { w: [], b: [] };
    for (const g of games) if (tagged(g)) own[tagged(g)].push(...Rep.linesFrom([g], true).lines);
    const into = { w: side === "b" ? own.w : read.lines.concat(own.w), b: side === "b" ? read.lines.concat(own.b) : own.b };
    // a file that held nothing but set-up positions is not a broken file —
    // it is the wrong kind of file, and saying which is the whole difference
    if (!into.w.length && !into.b.length && read.skipped) { toast(tf("rep.skippedSetUp", [read.skipped]), "fix"); return; }
    if (!into.w.length && !into.b.length) { toast(t("msg.import.badPgn"), "fault"); return; }
    const r = { added: 0, dup: 0, dropped: [], replaced: [] };
    for (const s of ["w", "b"]) {
      if (!into[s].length) continue;
      const one = Rep.addLines(linesOf(s), into[s], nameOf);
      store.session.repertoire[s] = one.lines;
      r.added += one.added; r.dup += one.dup;
      r.dropped.push(...one.dropped); r.replaced.push(...one.replaced);
    }
    // the ids that left — the cap's casualties and the shorter lines a deeper
    // one replaced — take their solved/missed entries with them
    commit(r.dropped.concat(r.replaced));
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
    const ids = linesOf("w").concat(linesOf("b")).map((l) => l.id);
    store.session.repertoire = { w: [], b: [] };
    commit(ids);
    toast(t("rep.cleared"));
  }

  /**
   * The lines changed: the ids that left take their queue entries with them,
   * the chunk indexes the new lines (its records' cards carry over), and
   * the header is written with what the chunk now vouches for.
   */
  function commit(gone) {
    if (gone && gone.length) forgetDrills(gone);
    if (ctrl) ctrl.sync();
    saveBook();
    render();
    sync();
  }

  /**
   * v8-1-plan T3: 「加进我的开局书」 from the board or the explorer — `sans`,
   * from the starting position, into `side`'s book; `remove`: the last move
   * of `sans` out of it, wherever the book plays it from that position.
   * @returns {boolean} whether the book changed
   */
  function edit(side, sans, remove) {
    const s = side === "b" ? "b" : "w";
    const who = t(s === "b" ? "color.black" : "color.white");
    // null: the board's game did not begin at the starting position
    if (!sans) { toast(tf("rep.lineLen", [1, Rep.MAX_PLIES]), "fix"); return false; }
    const san = sans[sans.length - 1] || "";
    if (remove) {
      const r = ctrl ? ctrl.removeAt(s, sans) : null;
      if (!r) return false;
      store.session.repertoire[s] = r.lines;
      commit(r.gone);
      toast(tf("rep.removedFrom", [san, who]));
      return true;
    }
    if (!sans.length || sans.length > Rep.MAX_PLIES) { toast(tf("rep.lineLen", [1, Rep.MAX_PLIES]), "fix"); return false; }
    const r = Rep.addLines(linesOf(s), [Rep.normalize(sans)], nameOf);
    if (!r.added) { toast(tf("rep.already", [san, who]), "fix"); return false; }
    store.session.repertoire[s] = r.lines;
    commit(r.dropped.concat(r.replaced));
    toast(tf("rep.addedTo", [san, who]));
    if (r.dropped.length) toast(tf("rep.dropped", [Rep.MAX_LINES, r.dropped.length]), "fix");
    return true;
  }

  /** A due card's name: the book line it sits on, as the line drills name it. */
  function cardName(side, line) {
    const q = drills(side).find((x) => line.every((san, i) => x.line[i] === san));
    return q ? q.name : t("rep.unnamed");
  }

  /** 导出 PGN: both books, one game each, variations and all (rep-book.js toPgn). */
  async function exportBook() {
    if (!ctrl || !total()) return;
    const text = ctrl.exportPgn((s) => t("rep.title") + " · " + t(s === "b" ? "color.black" : "color.white"));
    if (text) await d.exportText("chessboard-repertoire.pgn", text, "application/x-chess-pgn", t("lib.exportPgn"));
  }

  // --- the chunk ---------------------------------------------------------------
  // After the library's chunk: the records live in its database. Without it
  // (it failed to load, or a test bag with no library) the chunk still boots,
  // on a Map for the session and the native shards.
  const ready = !(d.library && d.library.ready) ? Promise.resolve(null)
    : d.library.ready().then((c) => loadChunk("chunk-rep.js", "CHESS_REP").then((m) => m.bootRepertoire({
      store, Persist, t, tf, toast, doc, R: Rep, libDb: c, cardName, onChange: () => render(),
      LibraryQuery: typeof window !== "undefined" && window.CHESS_LIBDB ? window.CHESS_LIBDB.LibraryQuery : null,
    }))).then((c) => {
      ctrl = c;
      // what the boot indexed, migrated or recovered: the header says so now
      // (a profile that never had a book is not given one — the library's rule)
      if (!c.fresh && (total() || Persist.get("repertoire") != null)) saveBook();
      render();
      return c;
    }, () => null);
  // persist.js's port for the records' shards (BULK "rep0" … "rep3")
  if (Persist.attachBulk) {
    Persist.attachBulk({
      names: () => (ctrl ? ctrl.shardNames() : null),
      read: (name) => (ctrl ? ctrl.shardText(name) : null),
      restore: (texts) => ready.then((c) => c && c.restoreShards(texts)),
      clear: () => { if (ctrl) ctrl.clear(); },
    }, "rep");
  }
  if (typeof window !== "undefined" && window.__chess) window.__chess.rep = () => ctrl;

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
      name: (l.eco ? l.eco + " " : "") + (localName(l.eco, l.name) || t("rep.unnamed")),
      line: l.sans.split(" "),
    }));
  }

  /**
   * A stored lichess name in the interface language (7.6). The book keeps the
   * raw English name — freezing a translation into it would leave it in the
   * language it was imported in — and every display goes through the same
   * 7.5 family localisation the library uses: 「意大利开局：Classical
   * Variation」, not the whole name in English.
   */
  function localName(eco, name) {
    if (!name) return "";
    return ChessEco.localName({ eco: eco || "", name }, store.ui.langId) || name;
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
    // 7.9 §4a: with no book, the section is one dashed card with the two
    // imports inside it, side by side (see .rec-block) — the gaps below,
    // when there are any, inside it too
    const block = doc.getElementById("rep-block");
    if (block) block.classList.toggle("empty", !total());
    if (!total()) {
      line(t("rep.empty"), "hint empty-note");   // 7.7 §3: see .empty-note
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
      // v8-1-plan T3: what is due, and where your games say otherwise
      if (ctrl) ctrl.renderInto(body);
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
        k.textContent = g.eco + " " + localName(g.eco, g.name);
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
    const due = doc.getElementById("rep-due");
    if (due) due.hidden = !(ctrl && total() && ctrl.dueCount());
    const exp = doc.getElementById("rep-export");
    if (exp) exp.hidden = !(ctrl && total());
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
    const due = doc.getElementById("rep-due");
    if (due) due.onclick = () => d.startDrills(true);
    const exp = doc.getElementById("rep-export");
    if (exp) exp.onclick = () => { exportBook(); };
  }

  /** Re-read the book from storage — after a learning file brought one in. */
  function reload() {
    store.session.repertoire = loadBook();
    // the file's lines are the book now: index them, and say so in the header
    if (ctrl) { ctrl.sync(); saveBook(); }
    render();
  }

  return { render, wire, drills, allDrills, treeFor, total, gapRows, importInto, linesOf, reload, localName,
    // v8-1-plan T3
    edit, ready: () => ready,
    dueDrills: () => (ctrl ? ctrl.dueDrills() : []),
    gradeCard: (p, ok) => { if (ctrl) { ctrl.grade(p, ok); render(); } },
  };
}
