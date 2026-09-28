/**
 * 棋谱库的数据库一半：存储、搜索、本机对局、认领名字、整库导出
 * (v8-0-plan C1). Loaded as chunk-libdb.js after the first frame.
 *
 * library-ui.js keeps what it always had — the analysis pass, the section on
 * the library page, the diagnosis — and hands this module its bag, the way
 * every carved-out region of app.js does. Everything stateful arrives in
 * that bag (the dialog stack, chess.js, the parser, the ECO table): a second
 * copy of any of them bundled into this chunk would be a second stack, a
 * second table, and focus that goes nowhere.
 *
 * What it adds:
 *   * boot: open IndexedDB (library-db.js), migrate a v1 library into it,
 *     pull games back from the native store when IndexedDB lost them, load,
 *     index what is not indexed — then hand the lists to library-ui;
 *   * save: the games that changed (a cheap signature per entry), their
 *     shards touched for the native mirror, the header kept current;
 *   * 本机: the play history (stats.games) as library entries, `src:
 *     "local"`, so the list, the search and the explorer see one library.
 *     The analysis pass and the diagnosis still read the imported games only
 *     — a 本机 game already has its own review, and counting it twice in a
 *     statement about "your games elsewhere" would change what 7.x's numbers
 *     meant;
 *   * the list page: search by opponent / opening / ECO / event, date range,
 *     result, colour, speed, source and "passes through the position on the
 *     board", with what was played next from there;
 *   * claim: after an import, the name on most games is offered once.
 * @module library-page
 */
import { LibraryQuery } from "./library-query.js";
import { LibraryDb } from "./library-db.js";

/** Rows the list draws at a time; 「再显示」 adds this many more. */
const PAGE = 100;

/** The header as read from localStorage (`chess.v1.library`), or null. */
function readHeader(raw) {
  if (raw == null || raw === "") return null;
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : null; } catch (_) { return null; }
}

/**
 * The fields a save cares about, as one string: an entry whose signature is
 * unchanged since it was last written is not written again. Everything the
 * app mutates on a stored entry is here — claim, analysis, opening, clock.
 */
function sigOf(g) {
  const an = g.an;
  return [g.side, g.outcome, g.eco, g.ecoName, g.unplayable ? 1 : 0,
    an ? (an.budget || 0) + ":" + (Array.isArray(an.tags) ? an.tags.length : 0) + ":" + (an.acc ? an.acc.w + "/" + an.acc.b : "") : "",
    g.clk ? g.clk.length : 0, g.motifs ? Object.keys(g.motifs).length : 0].join("|");
}

/**
 * @param {object} d the bag library-ui.js hands over (see its libDbBag)
 * @returns {Promise<object>} the controller
 */
async function bootLibrary(d) {
  const { doc, store, Persist, t, tf, toast, Library, Dlg, reconcile } = d;
  const header = readHeader(Persist.get("library")) || {};
  let claimAsked = !!header.claimAsked;
  const backend = await LibraryDb.idbBackend(d.idb);
  const st = LibraryDb.createLibraryStore({ backend: backend || LibraryDb.memoryBackend(), Chess: d.Chess, withLock: d.withLock });
  // "idb": games in IndexedDB. "legacy": no IndexedDB here, or the migration
  // was refused — the 8.0-dev shape (one localStorage value) for this session
  let mode = backend ? "idb" : "legacy";
  const sigs = new Map();
  let warned = false;
  const warnOnce = (key, arg) => { if (warned) return; warned = true; toast(tf(key, [arg || ""]), "fault"); };

  // --- migrate, recover, load ---------------------------------------------
  const v1Games = Array.isArray(header.games) ? header.games : [];
  let migrated = false;
  if (mode === "idb" && v1Games.length) {
    const r = await st.migrate(Persist.get("library"));
    if (r.ok) migrated = true;
    else { mode = "legacy"; warnOnce("lib.migrateFailed", r.error); }
  }
  if (mode === "idb") {
    try { await st.load(); } catch (_) { mode = "legacy"; warnOnce("lib.migrateFailed", "load"); }
  }
  if (mode === "idb" && header.db === 2 && Number(header.n) > st.games.length) {
    // IndexedDB holds fewer games than the header counted: the WebView's
    // data went and localStorage's did not (or a restore could not write).
    // The native store has the shards.
    const texts = await Persist.readBulk();
    const back = [];
    for (const text of Object.values(texts || {})) {
      const v = readHeader(text);
      if (v && Array.isArray(v.games)) back.push(...v.games);
    }
    if (back.length) {
      const r = await st.migrate(JSON.stringify({ v: 1, games: back }));
      if (r.ok) { await st.load(); toast(tf("lib.recovered", [st.games.length])); }
    }
  }
  if (mode === "idb") {
    // the session's list becomes the stored one. A v1 library the page has
    // been showing since boot is the same games (just migrated), and nothing
    // could change them meanwhile: imports and passes wait for this boot.
    store.session.library = st.games.filter((g) => g && g.id && typeof g.sans === "string" && g.plies > 0);
    for (const g of store.session.library) sigs.set(g.id, sigOf(g));
    if (migrated) {
      // the header changes last, after every game is readable back — until
      // then a crash anywhere leaves the v1 value, and the next launch
      // migrates again
      Persist.touchBulk(Object.keys(shardMap()));
      writeHeader();
    }
  }

  function shardMap() {
    const m = {};
    for (const g of store.session.library) m[st.shardOf(g.id)] = true;
    return m;
  }

  /** The header: names and counts only, once the games are in IndexedDB. */
  function writeHeader() {
    const names = store.session.libNames;
    if (mode !== "idb") {
      return Persist.setJson("library", { v: 1, games: store.session.library, names, claimAsked: claimAsked || undefined });
    }
    return Persist.setJson("library", { v: 1, games: [], names, db: 2, n: store.session.library.length,
      claimAsked: claimAsked || undefined });
  }

  /**
   * Write what changed: new or changed entries (by signature), removed ones,
   * the header. The native shards are touched first — the stamp goes up
   * before IndexedDB is written, so a crash in between leaves the mirror
   * owed rather than claiming a revision it lacks (persist.js recover).
   */
  let chain = Promise.resolve();
  function save() {
    if (mode !== "idb") { writeHeader(); return Promise.resolve(true); }
    const list = store.session.library;
    const changed = [];
    const live = new Set();
    for (const g of list) {
      live.add(g.id);
      const s = sigOf(g);
      if (sigs.get(g.id) !== s) { changed.push(g); sigs.set(g.id, s); }
    }
    const gone = [];
    for (const id of sigs.keys()) if (!live.has(id)) gone.push(id);
    for (const id of gone) sigs.delete(id);
    st.games = list;
    const touched = new Set(changed.concat(gone.map((id) => ({ id }))).map((g) => st.shardOf(g.id)));
    if (touched.size) Persist.touchBulk([...touched]);
    writeHeader();
    if (!changed.length && !gone.length) return chain;
    chain = chain.then(async () => {
      try {
        if (gone.length) await st.drop(gone);
        await st.save(changed);
      } catch (e) {
        // not written: owed again, and said once
        for (const g of changed) sigs.delete(g.id);
        warnOnce("lib.saveFailed", (e && e.name) || "");
      }
    });
    return chain;
  }

  // --- 本机: the play history as library entries ---------------------------
  const localRec = new Map();   // entry id → the stats record it stands for
  /** "1-0" etc. from the player's colour and outcome. */
  const boardResult = (rec) => (rec.result === "draw" ? "1/2-1/2"
    : (rec.result === "win") === (rec.color !== "b") ? "1-0" : "0-1");
  function localEntry(rec) {
    const e = { id: "loc:" + rec.id, src: "local", ref: rec.id, t: rec.t || 0, diff: rec.diff || "",
      side: rec.color === "b" ? "b" : "w", outcome: rec.result, result: boardResult(rec),
      white: "", black: "", date: "", sans: "", plies: 0, fen: "", pgnLen: rec.pgn.length };
    if (rec.t) {
      const dt = new Date(rec.t), two = (n) => String(n).padStart(2, "0");
      e.date = dt.getFullYear() + "." + two(dt.getMonth() + 1) + "." + two(dt.getDate());
    }
    if (typeof rec.acc === "number") e.acc = rec.acc;
    let game = null;
    try { game = d.PgnParser.parsePgn(rec.pgn).games[0] || null; } catch (_) { game = null; }
    if (!game) return e;
    const sans = [], fens = [game.root.fen];
    for (let n = game.root; n && n.children.length; n = n.children[0]) {
      sans.push(n.children[0].san);
      fens.push(n.children[0].fen);
    }
    e.sans = sans.join(" ");
    e.plies = sans.length;
    if (game.root.fen !== new d.Chess().fen()) e.fen = game.root.fen;
    st.indexFens(e.id, fens);
    return e;
  }
  /**
   * Bring the 本机 entries in step with the play history: new games added
   * (parsed and indexed once, then stored), finished analyses picked up,
   * games the history no longer has dropped. A slice at a time.
   */
  let localBusy = null;
  function syncLocal() {
    if (localBusy) { localBusy.again = true; return localBusy.p; }
    const run = { again: false };
    run.p = (async () => {
      do {
        run.again = false;
        let recs = [];
        try { recs = (d.loadStats().games || []).filter((g) => g && g.id && typeof g.pgn === "string" && g.pgn.trim()); }
        catch (_) { recs = []; }
        const have = new Map(st.local.map((g) => [g.id, g]));
        const next = [], put = [];
        let t0 = Date.now();
        localRec.clear();
        for (const rec of recs) {
          const id = "loc:" + rec.id;
          localRec.set(id, rec);
          let e = have.get(id);
          if (!e || e.pgnLen !== rec.pgn.length || e.acc !== (typeof rec.acc === "number" ? rec.acc : undefined)) {
            e = localEntry(rec);
            put.push(e);
          }
          next.push(e);
          if (Date.now() - t0 > 12) { await d.pause(); t0 = Date.now(); }
        }
        const gone = [...have.keys()].filter((id) => !localRec.has(id));
        st.local = next;
        if (mode === "idb") {
          try { if (gone.length) await st.drop(gone); await st.save(put); } catch (_) { /* derived: rebuilt next launch */ }
        }
      } while (run.again);
      localBusy = null;
      if (listOpen()) renderList();
    })();
    localBusy = run;
    return run.p;
  }

  // --- the list page -------------------------------------------------------
  const listModal = () => doc.getElementById("lib-list-modal");
  const listOpen = () => { const m = listModal(); return !!m && m.classList.contains("show"); };
  const f = store.ui.libFilter = Object.assign({ result: "all", color: "all", sort: "t", src: "all", tc: "all",
    q: "", from: "", to: "", pos: false }, store.ui.libFilter);
  let shown = PAGE;

  /** Every game the list can show: imported first, then 本机. */
  const allGames = () => store.session.library.concat(st.local);
  /** The query the page's controls describe. */
  function pageQuery() {
    return { text: f.q, from: f.from, to: f.to, result: f.result, color: f.color, tc: f.tc, src: f.src,
      position: f.pos ? d.boardFen() : "" };
  }
  /** A diagnosis pick (7.1) narrows the imported games further. */
  function pickMatches(g) {
    const pick = store.ui.libPick;
    if (!pick) return true;
    if (g.src === "local") return false;
    if (pick.kind === "eco") return g.eco === pick.value;
    return d.libPickPly(g) != null;
  }

  /** How many of this player's own plies in a game were `?` or `??`. */
  function badCount(g) {
    const tags = g.an && Array.isArray(g.an.tags) ? g.an.tags : [];
    const start = g.fen ? g.fen.trim().split(/\s+/) : [];
    const first = start[1] === "b" ? "b" : "w";
    const other = first === "w" ? "b" : "w";
    let n = 0;
    for (let i = 0; i < tags.length; i++) {
      if ((i % 2 === 0 ? first : other) !== g.side) continue;
      if (tags[i] === "?" || tags[i] === "??") n++;
    }
    return n;
  }
  /** The second line: when, how well, how many mistakes, which opening. */
  function subOf(g) {
    const bits = [];
    if (g.src === "local") {
      if (g.date) bits.push(g.date);
      if (g.plies) bits.push(tf(Math.ceil(g.plies / 2) === 1 ? "mm.moveCount.one" : "mm.moveCount.other", [Math.ceil(g.plies / 2)]));
      if (typeof g.acc === "number") bits.push(tf("hist.acc", [g.acc]));
    } else {
      if (g.date && g.date !== "?") bits.push(g.date);
      const acc = g.an && g.an.acc && g.side ? g.an.acc[g.side] : null;
      if (Number.isFinite(acc)) bits.push(tf("lib.rowAcc", [Math.round(acc * 10) / 10]));
      if (g.an) bits.push(tf("lib.rowBad", [badCount(g)]));
      else bits.push(t(g.unplayable ? "lib.rowUnplayable" : "lib.rowPending"));
      if (LibraryQuery.tcClass(g.tc)) bits.push(t("lib.tc." + LibraryQuery.tcClass(g.tc)));
    }
    if (g.eco) bits.push(g.eco + " " + d.libEcoName(g.eco, g.ecoName));
    return bits.join(" · ");
  }
  /** A 本机 game's headline: the history's own words (result · level · colour). */
  function localLabel(g) {
    const res = t(g.outcome === "win" ? "hist.win" : g.outcome === "loss" ? "hist.loss" : "hist.draw");
    return [res, t("diff." + g.diff), t(g.side === "b" ? "hist.black" : "hist.white")].join(" · ");
  }
  function rowOf(g) {
    const row = doc.createElement("div");
    row.className = "hist-row";
    const load = doc.createElement("button");
    load.type = "button";
    load.className = "pick-item";
    if (g.src === "local") {
      load.dataset.loc = g.ref;
      load.textContent = localLabel(g);
      // v8-0-plan C1: 对局历史 is part of the library now, and says where it came from
      const tag = doc.createElement("span");
      tag.className = "pick-tag";
      tag.textContent = t("lib.srcLocal");
      load.appendChild(tag);
    } else {
      load.dataset.lib = g.id;
      load.textContent = d.libraryLabel(g);
    }
    const sub = doc.createElement("span");
    sub.className = "pick-sub";
    sub.textContent = subOf(g);
    load.appendChild(sub);
    row.appendChild(load);
    const act = doc.createElement("button");
    act.type = "button";
    act.className = "row-act";
    if (g.src === "local") {
      act.dataset.locPgn = g.ref;
      act.textContent = t("hist.pgn");
      row.appendChild(act);
    } else if (g.an && !g.unplayable && (Number(g.an.budget) || 0) < d.LIB_DEEP_BUDGET) {
      // 「再深一遍」 only where there is something to deepen (7.2 A1, P3)
      act.dataset.libDeep = g.id;
      act.textContent = t("lib.deepen");
      act.title = t("tip.libDeepen");
      row.appendChild(act);
    }
    return row;
  }

  /** The measured cost of the last search, for docs/measured.json. */
  const last = { ms: 0, n: 0 };
  function renderList() {
    const list = doc.getElementById("lib-list");
    if (!list) return;
    const t0 = performance.now();
    const all = allGames();
    for (const g of st.local) if (!g.opp || g.oppLang !== store.ui.langId) { g.opp = t("diff." + g.diff); g.oppLang = store.ui.langId; }
    let rows = LibraryQuery.query(all, pageQuery(), st.pkOf);
    if (store.ui.libPick) rows = rows.filter(pickMatches);
    if (f.sort === "acc") {
      // worst first; a game with no accuracy to rank goes last
      const accOf = (g) => (g.src === "local" ? (typeof g.acc === "number" ? g.acc : Infinity)
        : g.an && g.an.acc && g.side && g.an.acc[g.side] != null ? g.an.acc[g.side] : Infinity);
      rows.sort((a, b) => accOf(a) - accOf(b));
    } else {
      rows.sort((a, b) => (b.t || 0) - (a.t || 0));
    }
    const page = rows.slice(0, shown);
    // rows carry the game's id, never an index (7.4 D1)
    reconcile(list, page, (g) => g.id,
      (g) => [store.ui.langId, g.outcome, g.side, g.eco, g.an ? "a" + (g.an.budget || 0) : "-", g.unplayable ? "u" : "-", g.acc].join("|"),
      (g) => rowOf(g));
    if (!rows.length) {
      const p = doc.createElement("p");
      p.className = "hint";
      p.textContent = t("hist.noneMatch");
      list.appendChild(p);
    }
    const more = doc.getElementById("lib-more");
    if (more) {
      more.hidden = rows.length <= page.length;
      more.textContent = tf("lib.more", [Math.min(PAGE, rows.length - page.length)]);
    }
    const count = doc.getElementById("lib-list-count");
    if (count) {
      const filtered = rows.length !== all.length || !!store.ui.libPick;
      count.hidden = !filtered;
      count.textContent = tf("hist.showing", [rows.length, all.length]);
    }
    const note = doc.getElementById("lib-pick-note");
    if (note) {
      note.hidden = !store.ui.libPick;
      note.textContent = store.ui.libPick ? store.ui.libPick.label : "";
    }
    const clear = doc.getElementById("lib-pick-clear");
    if (clear) clear.hidden = !store.ui.libPick;
    const pos = doc.getElementById("lib-pos-note");
    if (pos) {
      // what was played next from the position on the board — the
      // explorer's question (C3), asked of the games this list is showing
      const s = f.pos ? LibraryQuery.gamesWithPosition(rows, d.boardFen(), st.pkOf) : null;
      pos.hidden = !s;
      if (s) {
        const top = s.moves.slice(0, 5).map((m) => m.san + " " + m.n).join(" · ");
        pos.textContent = tf("lib.posStat", [s.total, top || "—"]);
      }
    }
    for (const [seg, key, attr] of [["lib-result-seg", "result", "lres"], ["lib-color-seg", "color", "lcol"],
      ["lib-sort-seg", "sort", "lsort"], ["lib-src-seg", "src", "lsrc"], ["lib-tc-seg", "tc", "ltc"]]) {
      doc.querySelectorAll("#" + seg + " button").forEach((b) => b.classList.toggle("active", b.dataset[attr] === f[key]));
    }
    const posBtn = doc.getElementById("lib-pos");
    if (posBtn) posBtn.setAttribute("aria-pressed", f.pos ? "true" : "false");
    last.ms = performance.now() - t0;
    last.n = rows.length;
  }

  function openList(pick, opts) {
    store.ui.libPick = pick || null;
    if (opts && opts.src) f.src = opts.src;
    shown = PAGE;
    const q = doc.getElementById("lib-q");
    if (q && q.value !== f.q) q.value = f.q;
    // an opening name needs the ECO chunk; ask for it and redraw when it lands
    const fill = () => { if (d.fillOpenings()) save(); fillLocalOpenings(); };
    if (!d.Eco.loaded()) d.Eco.whenReady(() => { fill(); renderList(); });
    else fill();
    renderList();
    Dlg.open(listModal());
    syncLocal();
  }
  /** 本机 games get their opening the way imported ones do (fillOpenings). */
  function fillLocalOpenings() {
    for (const g of st.local) {
      if (typeof g.eco === "string" || !g.sans) continue;
      let hit = null;
      try { hit = d.Eco.openingForGame(g.sans.split(" ").slice(0, 24), g.fen || undefined); } catch (_) { hit = null; }
      g.eco = hit ? hit.eco : "";
      g.ecoName = hit ? hit.name || "" : "";
    }
  }

  /** Every control on the list page, wired once. */
  function wire() {
    const list = doc.getElementById("lib-list");
    if (list) {
      list.onclick = (ev) => {
        const deep = ev.target.closest("button[data-lib-deep]");
        if (deep) { d.deepenLibraryGame(deep.dataset.libDeep); return; }
        const pgn = ev.target.closest("button[data-loc-pgn]");
        if (pgn) {
          const rec = localRec.get("loc:" + pgn.dataset.locPgn);
          if (rec) d.copyText(rec.pgn, t("hist.pgnCopied"));
          return;
        }
        const loc = ev.target.closest("button[data-loc]");
        if (loc) {
          const rec = localRec.get("loc:" + loc.dataset.loc);
          if (!rec) return;
          if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
          Dlg.close(listModal());
          d.loadHistoryRecord(rec);
          return;
        }
        const b = ev.target.closest("button[data-lib]");
        if (b) d.loadFromLibrary(b.dataset.lib);
      };
    }
    const segs = [["lib-result-seg", "result", "lres"], ["lib-color-seg", "color", "lcol"], ["lib-sort-seg", "sort", "lsort"],
      ["lib-src-seg", "src", "lsrc"], ["lib-tc-seg", "tc", "ltc"]];
    for (const [id, key, attr] of segs) {
      const seg = doc.getElementById(id);
      if (seg) seg.onclick = (ev) => {
        const b = ev.target.closest("button");
        if (!b || b.dataset[attr] == null || f[key] === b.dataset[attr]) return;
        f[key] = b.dataset[attr];
        shown = PAGE;
        renderList();
      };
    }
    const q = doc.getElementById("lib-q");
    if (q) q.oninput = () => { f.q = q.value; shown = PAGE; renderList(); };
    for (const [id, key] of [["lib-from", "from"], ["lib-to", "to"]]) {
      const el = doc.getElementById(id);
      if (el) el.onchange = () => { f[key] = el.value; shown = PAGE; renderList(); };
    }
    const pos = doc.getElementById("lib-pos");
    if (pos) pos.onclick = () => { f.pos = !f.pos; shown = PAGE; renderList(); };
    const more = doc.getElementById("lib-more");
    if (more) more.onclick = () => { shown += PAGE; renderList(); };
    const clearPick = doc.getElementById("lib-pick-clear");
    if (clearPick) clearPick.onclick = () => { store.ui.libPick = null; renderList(); };
    const exp = doc.getElementById("lib-export");
    if (exp) exp.onclick = () => { exportPgn(); };
  }

  /**
   * The imported games the page is showing, as one PGN file — the whole
   * library when nothing is filtered (v8-0-plan C1: 整库导出和导回逐局相等).
   * 本机 games are not in it: the history keeps their own PGN, and a
   * re-import would turn each into an imported copy of itself.
   */
  async function exportPgn() {
    let rows = LibraryQuery.query(store.session.library, pageQuery(), st.pkOf);
    if (store.ui.libPick) rows = rows.filter(pickMatches);
    if (!rows.length) { toast(t("hist.noneMatch"), "fix"); return; }
    const text = rows.map(LibraryQuery.entryPgn).join("\n");
    await d.exportText("chessboard-library.pgn", text, "application/x-chess-pgn", t("lib.exportPgn"));
  }

  // --- import and claim ----------------------------------------------------
  let importing = false;
  /**
   * Take every game in a PGN file into the library (7.0), with its position
   * index made from the parse — the parser already walked every position.
   */
  async function importPgn(text, label) {
    const text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return; }
    if (store.session.libRun || store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    if (importing) return;
    let chunks;
    try { chunks = d.PgnParser.splitGames(text0); } catch (_) { chunks = d.Pgn.splitGames(text0); }
    // read game by game, handing the thread back every ~16 ms (7.5)
    let games;
    importing = true;
    try { games = await d.PgnParser.parseGamesAsync(chunks); } finally { importing = false; }
    if (store.session.libRun || store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    const now = Date.now();
    const fresh = [];
    for (const parsed of games) {
      if (!parsed) continue;
      // mainline SAN only: variations are the annotator's opinion
      const sans = [], fens = [parsed.root.fen];
      for (let n = parsed.root; n && n.children.length; n = n.children[0]) {
        sans.push(n.children[0].san);
        fens.push(n.children[0].fen);
      }
      if (!sans.length) continue;
      const e = Library.entryFrom(parsed, sans, store.session.libNames, now);
      if (!st.pk.has(e.id)) st.indexFens(e.id, fens);
      fresh.push(e);
    }
    if (!fresh.length) { toast(t("msg.import.badPgn"), "fault"); return; }
    const r = Library.addGames(store.session.library, fresh);
    store.session.library = r.list;
    for (const id of r.dropped) st.pk.delete(id);
    save();
    d.renderLibrary();
    if (!r.added) toast(tf("lib.addedNone", [r.dup]), "fix");
    else toast(tf("lib.added", [r.added, r.dup]) + (label ? " · " + label : ""));
    if (r.dropped.length) toast(tf("lib.dropped", [Library.MAX_GAMES, r.dropped.length]), "fix");
    await maybeClaim();
  }

  /**
   * v8-0-plan C1: 认领名字. Nobody has been named yet and the games agree
   * on one name (LibraryQuery.inferName): ask once. Yes or no, the question
   * is not asked again — the name field is still there for a correction.
   */
  async function maybeClaim() {
    if (claimAsked || store.session.libNames.length) return;
    const c = LibraryQuery.inferName(store.session.library);
    if (!c) return;
    claimAsked = true;
    writeHeader();
    const yes = await d.confirmNative(tf("lib.claimAsk", [c.name, c.n, c.of]), t("lib.claimTitle"),
      { ok: t("lib.claimYes"), cancel: t("lib.claimNo") });
    if (yes !== true) return;
    store.session.libNames = [c.name];
    const input = doc.getElementById("lib-names");
    if (input) input.value = c.name;
    d.reclaimLibrary();
    save();
    d.renderLibrary();
    toast(tf("lib.claimDone", [c.name, store.session.library.filter((g) => g.side).length]));
  }

  // --- the rest of the seam ------------------------------------------------
  wire();
  // what is not indexed yet (a migrated or restored library), in the
  // background; the position filter finds more as it goes
  const indexing = st.indexMissing(12, d.pause).then(() => { if (listOpen()) renderList(); });
  syncLocal();

  return {
    mode: () => mode,
    save,
    writeHeader,
    importPgn,
    openList,
    renderList,
    syncLocal,
    exportPgn,
    last,
    indexing,
    /** v8-0-plan C1 query API (see library-query.js), over imported + 本机 */
    query: (q) => LibraryQuery.query(allGames(), q, st.pkOf),
    gamesWithPosition: (fen) => LibraryQuery.gamesWithPosition(allGames(), fen, st.pkOf),
    all: allGames,
    pkOf: st.pkOf,
    // persist.js's port (BULK)
    shardNames: () => (mode === "idb" ? Object.keys(shardMap()) : []),
    shardText: (name) => { st.games = store.session.library; return mode === "idb" ? st.shardText(name) : null; },
    restoreShards: async (texts) => { if (mode === "idb") await st.restoreShards(texts); },
    clear: () => {
      store.session.library = [];
      sigs.clear();
      if (mode === "idb") chain = chain.then(() => st.backend.clear()).catch(() => {});
    },
  };
}

export const CHESS_LIBDB = { bootLibrary, LibraryQuery, LibraryDb };
