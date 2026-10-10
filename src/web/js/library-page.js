/**
 * 棋谱库的数据库一半：存储、搜索、本机对局、认领名字、整库导出
 * (v8-0-plan C1). Loaded as chunk-libdb.js after the first frame.
 *
 * library-ui.js keeps what it always had — the analysis pass, the section on
 * the library page, the diagnosis (whose three charts, diag-charts.js, ride
 * in this chunk since the M5 merge) — and hands this module its bag, the way
 * every carved-out region of app.js does. Everything stateful arrives in
 * that bag (the dialog stack, chess.js, the parser, the ECO table): a second
 * copy of any of them bundled into this chunk would be a second stack, a
 * second table, and focus that goes nowhere.
 *
 * What it adds:
 *   * boot: open IndexedDB (library-db.js), load, pull games back from the
 *     native store when IndexedDB lost them, index what is not indexed —
 *     then hand the lists to library-ui;
 *   * save: the games that changed (a cheap signature per entry), their
 *     shards touched for the native mirror, the header kept current;
 *   * 本机: the play history (stats.games) as library entries, `src:
 *     "local"`, so the list, the search and the explorer see one library.
 *     The analysis pass still reads the imported games only — a 本机 game
 *     already has its own review. The diagnosis reads them when its source
 *     row asks (v8-1-plan T5, library-local.js), and 导出 PGN takes them out
 *     and back in as themselves;
 *   * the list page: search by opponent / opening / ECO / event, date range,
 *     result, colour, speed, source and "passes through the position on the
 *     board", with what was played next from there;
 *   * claim: after an import, the name on most games is offered once.
 * @module library-page
 */
import { LibraryQuery } from "./library-query.js";
import { LibraryDb } from "./library-db.js";
import { LibraryLocal } from "./library-local.js";
import { createDiagCharts } from "./diag-charts.js";
import { runNativeSelftest } from "./selftest-native.js";

/**
 * Background work (the 本机 games, the index, the openings) runs in slices of
 * this many ms with a pause between: the native mirror's own writes are held
 * to 16 ms of main thread (v8-0-plan F3), and a slice that lands between two
 * of its bridge calls counts against that.
 */
const SLICE = 6;

/** Rows the list draws at a time; 「再显示」 adds this many more. */
const PAGE = 100;

/** How long the boot waits for the start-up's summary read (ms, v8-1-plan F3). */
const PREFETCH_WAIT = 3000;

/** The header as read from localStorage (`chess.library`), or null. */
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
  const { doc, store, Persist, t, tf, tdot, toast, Library, Dlg, reconcile } = d;
  const header = readHeader(Persist.get("library")) || {};
  let claimAsked = !!header.claimAsked;
  let claim = null;   // the offer on screen (renderClaim)
  // v8-1-plan F3: the connection and the summary asked for at start-up
  // (library-sum.js), if they were. Not waited for past PREFETCH_WAIT: an
  // open that never answers (WebKit has had those) must not hold the
  // library; the library opens its own then, and a late one is closed.
  let pre = null;
  if (d.summary) {
    pre = await Promise.race([d.summary, new Promise((r) => setTimeout(() => r(null), PREFETCH_WAIT))]);
    if (!pre) d.summary.then((late) => { if (late) try { late.db.close(); } catch (_) { /* already */ } });
  }
  const backend = await LibraryDb.idbBackend(d.idb, undefined, pre && pre.db);
  const makeStore = (b) => LibraryDb.createLibraryStore({ backend: b, Chess: d.Chess, withLock: d.withLock });
  let st = makeStore(backend || LibraryDb.memoryBackend());
  // "idb": games in IndexedDB. "memory": no IndexedDB here (or it would not
  // load) — the games of this session live in memory and in the native shards
  let mode = backend ? "idb" : "memory";
  const sigs = new Map();
  let warned = false;
  const warnOnce = (key, arg) => { if (warned) return; warned = true; toast(tf(key, [arg || ""]), "fault"); };
  // set once restoreShards has replaced the games: the page reloads onto
  // them, and nothing it still holds may be written back first (M5 review P3-4)
  let frozen = false;

  // --- the list page -------------------------------------------------------
  // Above the load on purpose (v8-1-plan F3): with a summary on file, the
  // page opens on it while the entries are still being read.
  const localRec = new Map();   // entry id → the stats record it stands for
  const listModal = () => doc.getElementById("lib-list-modal");
  const listOpen = () => { const m = listModal(); return !!m && m.classList.contains("show"); };
  const diagOpen = () => { const m = doc.getElementById("lib-modal"); return !!m && m.classList.contains("show"); };
  const f = store.ui.libFilter = Object.assign({ result: "all", color: "all", sort: "t", src: "all", tc: "all",
    q: "", from: "", to: "", pos: false }, store.ui.libFilter);
  let shown = PAGE;
  /**
   * v8-1-plan F3: the summary's stand-ins (LibraryDb.stubOf) until the
   * entries are loaded, then null. The page draws and searches them like
   * entries; what needs a whole game (open it, deepen it, export, "passes
   * through this position") waits for `loaded`.
   */
  let stubs = null;
  let loadedNow = null;
  const loaded = new Promise((r) => { loadedNow = r; });

  /** Every game the list can show: imported first, then 本机. */
  const allGames = () => stubs || store.session.library.concat(st.local);
  /** A row's own accuracy, mistakes and depth — from the entry, or from its summary row. */
  const accOf = (g) => (g.stub ? (typeof g.stub.acc === "number" ? g.stub.acc : null)
    : g.an && g.an.acc && g.side ? g.an.acc[g.side] : null);
  const depthOf = (g) => (g.stub ? g.stub.an : g.an ? Number(g.an.budget) || 0 : 0);
  const analysed = (g) => (g.stub ? g.stub.an > 0 : !!g.an);
  /** The query the page's controls describe. */
  function pageQuery() {
    return { text: f.q, from: f.from, to: f.to, result: f.result, color: f.color, tc: f.tc, src: f.src,
      position: f.pos ? d.boardFen() : "" };
  }
  /**
   * A diagnosis pick (7.1) narrows the games further — the imported ones, or
   * those of the source the diagnosis was read from (v8-1-plan T5: `src`).
   */
  function pickMatches(g) {
    const pick = store.ui.libPick;
    if (!pick) return true;
    const src = pick.src || "import";
    if (src !== "all" && (g.src === "local") !== (src === "local")) return false;
    if (pick.kind === "eco") return g.eco === pick.value;
    return d.libPickPly(g) != null;
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
      const acc = accOf(g);
      if (Number.isFinite(acc)) bits.push(tf("lib.rowAcc", [Math.round(acc * 10) / 10]));
      if (analysed(g)) bits.push(tf("lib.rowBad", [g.stub ? g.stub.bad : LibraryDb.badCount(g)]));
      else bits.push(t(g.unplayable ? "lib.rowUnplayable" : "lib.rowPending"));
      if (LibraryQuery.tcClass(g.tc)) bits.push(t("lib.tc." + LibraryQuery.tcClass(g.tc)));
    }
    if (g.eco) bits.push(g.eco + " " + d.libEcoName(g.eco, g.ecoName));
    return tdot(...bits);
  }
  /** A 本机 game's headline: the history's own words (result · level · colour). */
  function localLabel(g) {
    const res = t(g.outcome === "win" ? "hist.win" : g.outcome === "loss" ? "hist.loss" : "hist.draw");
    return tdot(res, t("diff." + g.diff), t(g.side === "b" ? "hist.black" : "hist.white"));
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
      // v8-0-plan C2: a game from Lichess / Chess.com (synced or downloaded) says so, as 本机 does
      const site = LibraryQuery.siteOf(g);
      if (site) {
        const tag = doc.createElement("span");
        tag.className = "pick-tag";
        tag.textContent = site;
        load.appendChild(tag);
      }
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
    } else if (analysed(g) && !g.unplayable && depthOf(g) < d.LIB_DEEP_BUDGET) {
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
    for (const g of all) {
      if (g.src === "local" && (!g.opp || g.oppLang !== store.ui.langId)) { g.opp = t("diff." + g.diff); g.oppLang = store.ui.langId; }
    }
    // v8-1-plan F3: "passes through this position" needs the index, which
    // comes with the entries — until then it finds nothing and says so
    const waiting = f.pos && !!stubs;
    let rows = waiting ? [] : LibraryQuery.query(all, pageQuery(), st.pkOf);
    if (store.ui.libPick) rows = rows.filter(pickMatches);
    if (f.sort === "acc") {
      // worst first; a game with no accuracy to rank goes last
      const rank = (g) => {
        const a = g.src === "local" ? g.acc : accOf(g);
        return typeof a === "number" ? a : Infinity;
      };
      rows.sort((a, b) => rank(a) - rank(b) || LibraryDb.newestFirst(a, b));
    } else {
      rows.sort(LibraryDb.newestFirst);
    }
    const page = rows.slice(0, shown);
    // rows carry the game's id, never an index (7.4 D1). A summary row draws
    // the row its entry does (v8-1-plan F3), so the entries arriving leave
    // the rows in place — none is rebuilt under a press (7.6). The key is
    // what the row says (M4 评审: a summary one launch out of date is
    // redrawn when the entries arrive, not left saying the old thing)
    reconcile(list, page, (g) => g.id,
      (g) => [store.ui.langId, g.src === "local" ? localLabel(g) : d.libraryLabel(g) + LibraryQuery.siteOf(g), subOf(g),
        analysed(g) && !g.unplayable && depthOf(g) < d.LIB_DEEP_BUDGET ? "d" : "-"].join("|"),
      (g) => rowOf(g));
    if (!rows.length && !waiting) {
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
      const s = f.pos && !waiting ? LibraryQuery.gamesWithPosition(rows, d.boardFen(), st.pkOf) : null;
      pos.hidden = !s && !waiting;
      if (waiting) pos.textContent = tf("lib.loading", [all.length]);
      else if (s) {
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
    // a pick comes from a diagnosis row, read from the source on its row (T5)
    if (pick && !pick.src) pick.src = diagSrc();
    store.ui.libPick = pick || null;
    // a diagnosis pick is about imported games; show them, whatever the
    // source row was left on
    // …and the pick is the whole question: the page's own search steps aside
    if (opts && opts.src) f.src = opts.src;
    else if (pick) Object.assign(f, { src: "all", q: "", from: "", to: "", tc: "all", pos: false });
    for (const [id, key] of [["lib-from", "from"], ["lib-to", "to"]]) {
      const el = doc.getElementById(id);
      if (el && el.value !== f[key]) el.value = f[key];
    }
    shown = PAGE;
    const q = doc.getElementById("lib-q");
    if (q && q.value !== f.q) q.value = f.q;
    // an opening name needs the ECO chunk; the fill asks for it, and redraws.
    // Opened on the summary (v8-1-plan F3), both wait for the entries: the
    // end of the boot runs them anyway
    if (!stubs) fillOpenings();
    renderList();
    Dlg.open(listModal());
    if (!stubs) syncLocal();
  }
  /** A press on the list is under way (see the entries' arrival, 7.6). */
  let pressed = false;
  /** The last row pressed while the list showed the summary (its button's data), or null. */
  let queued = null;
  /** What a row's button does, from its data (the button itself may be redrawn meanwhile). */
  function rowAction(ds) {
    if (ds.libDeep) { d.deepenLibraryGame(ds.libDeep); return; }
    if (ds.locPgn) {
      const rec = localRec.get("loc:" + ds.locPgn);
      if (rec) d.copyText(rec.pgn, t("hist.pgnCopied"));
      return;
    }
    if (ds.loc) {
      const rec = localRec.get("loc:" + ds.loc);
      if (!rec) return;
      if (store.session.mode === "learn" || store.session.mode === "puzzle") { toast(t("msg.mode.needPlay"), "fix"); return; }
      Dlg.close(listModal());
      d.loadHistoryRecord(rec);
      return;
    }
    if (ds.lib) d.loadFromLibrary(ds.lib);
  }
  /** The queued press, now that its game is here — dropped if the list was closed meanwhile. */
  function runQueued() {
    const ds = queued;
    queued = null;
    const list = doc.getElementById("lib-list");
    if (list) list.removeAttribute("aria-busy");
    if (ds && listOpen()) rowAction(ds);
  }
  /** Every control on the list page, wired once. */
  function wire() {
    const list = doc.getElementById("lib-list");
    if (list) {
      list.addEventListener("pointerdown", () => { pressed = true; });
      for (const ev of ["pointerup", "pointercancel"]) doc.addEventListener(ev, () => { pressed = false; }, true);
      list.onclick = (ev) => {
        const b = ev.target.closest("button");
        if (!b) return;
        // a row drawn from the summary (v8-1-plan F3): its game is not here
        // yet. Say so, and keep the last press only — run once the games
        // (and the 本机 records) are in, if the list is still open
        if (stubs || queued) {
          queued = Object.assign({}, b.dataset);
          list.setAttribute("aria-busy", "true");
          toast(tf("lib.loading", [allGames().length]));
          return;
        }
        rowAction(b.dataset);
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
  wire();

  /**
   * v8-1-plan F3: the list before the games. The store keeps a summary row
   * per game beside the games (library-db.js summaryOf), and the header
   * carries its id; when the two agree and the summary covers every record,
   * the page can be opened on it now — one read of ~1.5 MB at ten thousand
   * games — while the entries and their index are read after it.
   */
  if (backend && typeof header.sum === "string") {
    const rows = await st.readSummary(header.sum, pre && pre.stored);
    const imp = [], loc = [];
    for (const r of rows || []) (r.src === "local" ? loc : imp).push(LibraryDb.stubOf(r));
    // …and it has as many imported games as the header counted (M4 评审: a
    // second check beside the record count, which the 本机 games share)
    if (rows && rows.length && imp.length === Number(header.n)) {
      imp.sort(LibraryDb.newestFirst);
      loc.sort(LibraryDb.newestFirst);
      stubs = imp.concat(loc);
      if (d.onSummary) d.onSummary({ count: imp.length, openList, renderList, loaded });
    }
  }
  // the prefetched text is in the rows now, or not wanted: not kept (~1.5 MB at ten thousand games)
  d.summary = null;
  pre = null;

  // --- load, recover --------------------------------------------------------
  try { await st.load(); } catch (_) { mode = "memory"; st = makeStore(LibraryDb.memoryBackend()); await st.load(); }
  if (Number(header.n) > st.games.length) {
    // the store holds fewer games than the header counted: the WebView's
    // data went and localStorage's did not (or a restore could not write).
    // The native store has the shards.
    const texts = await Persist.readBulk("lib");   // its own shards, not the repertoire's (M3 评审)
    const back = [];
    for (const text of Object.values(texts || {})) {
      const v = readHeader(text);
      if (v && Array.isArray(v.games)) back.push(...v.games);
    }
    if (back.length) {
      const had = st.games.length;
      const r = await st.importRecords(back);
      if (r.ok) {
        await st.load();
        if (st.games.length > had && mode === "idb") toast(tf("lib.recovered", [st.games.length - had]));
      }
    }
  }
  /**
   * M5 review P2-1: no IndexedDB this session, and the games the header
   * counts could not all be read back from the native shards. Whatever this
   * session wrote over those shards would lose the rest, so the library is
   * shown as it is and held: the shards stay as they are on disk, the header
   * keeps its count, and imports and passes are refused.
   */
  let held = mode === "memory" && Number(header.n) > st.games.length;
  if (held) {
    warnOnce("lib.unreadable");
    store.session.libUnreadable = true;
  }
  store.session.library = st.games.filter((g) => g && g.id && typeof g.sans === "string" && g.plies > 0);
  for (const g of store.session.library) sigs.set(g.id, sigOf(g));
  // a name typed while the games were still loading claimed the list the
  // page had then; claim the stored one too
  const namesThen = JSON.stringify(Array.isArray(header.names) ? header.names : []);
  const renamed = !held && JSON.stringify(store.session.libNames) !== namesThen;

  /** shard name → its games, for the current list (see shardText) */
  let groups = null;
  function shardGroups() {
    const m = new Map();
    for (const g of store.session.library) {
      const k = st.shardOf(g.id);
      let a = m.get(k);
      if (!a) m.set(k, (a = []));
      a.push(g);
    }
    return m;
  }
  function shardMap() {
    const m = {};
    for (const g of store.session.library) m[st.shardOf(g.id)] = true;
    return m;
  }

  /** The header: names and counts only — the games are in the store. */
  function writeHeader() {
    const names = store.session.libNames;
    // a profile that never had a library is not given one
    if (Persist.get("library") == null && !store.session.library.length && !names.length && !claimAsked) return true;
    // held (P2-1): the count as found, with the names
    if (held) return Persist.setJson("library", Object.assign({}, header, { names, claimAsked: claimAsked || undefined }));
    // `sum` (v8-1-plan F3): the store's summary is this library's. Until
    // syncSummary has answered, the id the header came with stays (M4 评审
    // P2-2: a save in between dropped it, and the next launch waited for the
    // entries for nothing). Without IndexedDB there is no summary to name.
    return Persist.setJson("library", { v: 1, names, n: store.session.library.length, claimAsked: claimAsked || undefined,
      sum: mode !== "idb" ? undefined : st.sumId() || (typeof header.sum === "string" ? header.sum : undefined) });
  }

  /**
   * Write what changed: new or changed entries (by signature), removed ones,
   * the header. The native shards are touched first — the stamp goes up
   * before IndexedDB is written, so a crash in between leaves the mirror
   * owed rather than claiming a revision it lacks (persist.js recover).
   */
  let chain = Promise.resolve();
  function save() {
    // a name typed into the field is an answer to the claim too
    if (store.session.libNames.length && !claimAsked) { claimAsked = true; renderClaim(); }
    if (frozen) return chain;
    if (held) { writeHeader(); return Promise.resolve(true); }
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
    groups = null;
    const touched = new Set(changed.concat(gone.map((id) => ({ id }))).map((g) => st.shardOf(g.id)));
    if (touched.size) Persist.touchBulk([...touched]);
    writeHeader();
    if (!changed.length && !gone.length) return chain;
    chain = chain.then(async () => {
      try {
        if (gone.length) await st.drop(gone);
        await st.save(changed);
        if (peers) peers.postMessage({ put: changed.map((g) => g.id), gone });
      } catch (e) {
        // not written: owed again, and said once
        for (const g of changed) sigs.delete(g.id);
        warnOnce("lib.saveFailed", (e && e.name) || "");
      }
    });
    return chain;
  }

  /**
   * Two windows of the app share one IndexedDB but each holds its own list.
   * Every window writes only the games it changed, so neither can take the
   * other's games out of the store — but a window that never heard of a game
   * would leave it out of the native shards it writes, and out of an
   * export. So a commit is announced, and the other windows read those
   * records back into their lists. (No BroadcastChannel before Safari 15.4:
   * there the next launch is when a window learns.)
   */
  const peers = typeof BroadcastChannel === "function" && mode === "idb" ? new BroadcastChannel("chessboard.library") : null;
  if (peers) {
    peers.onmessage = async (ev) => {
      const m = ev.data || {};
      const ids = Array.isArray(m.put) ? m.put : [];
      const goneIds = new Set(Array.isArray(m.gone) ? m.gone : []);
      let got = [];
      try { got = ids.length ? await st.read(ids) : []; } catch (_) { got = []; }
      const byId = new Map(got.filter((g) => g && g.src !== "local").map((g) => [g.id, g]));
      const list = store.session.library.filter((g) => !goneIds.has(g.id) && !byId.has(g.id));
      for (const g of byId.values()) { list.push(g); sigs.set(g.id, sigOf(g)); }
      for (const id of goneIds) sigs.delete(id);
      st.forget([...goneIds]);
      list.sort(LibraryDb.newestFirst);
      store.session.library = list;
      st.games = list;
      d.renderLibrary();
      if (listOpen()) renderList();
    };
  }

  // --- 本机: the play history as library entries ---------------------------
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
    // v8-1-plan T5: the clock it was played on, so the speed filter finds it
    if (typeof rec.tc === "string" && rec.tc) e.tc = rec.tc;
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
    const eco = ecoOfFens(fens);
    if (eco !== undefined) { e.eco = eco ? eco.eco : ""; e.ecoName = eco ? eco.name : ""; }
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
        const next = [], put = [], recOf = new Map();
        let t0 = Date.now();
        for (const rec of recs) {
          const id = "loc:" + rec.id;
          recOf.set(id, rec);
          let e = have.get(id);
          if (!e || e.pgnLen !== rec.pgn.length || e.acc !== (typeof rec.acc === "number" ? rec.acc : undefined) || (e.tc || "") !== (rec.tc || "")) {
            e = localEntry(rec);
            put.push(e);
          }
          next.push(e);
          if (Date.now() - t0 > SLICE) { await d.pause(); t0 = Date.now(); }
        }
        const gone = [...have.keys()].filter((id) => !recOf.has(id));
        st.local = next;
        localRec.clear();
        for (const [id, rec] of recOf) localRec.set(id, rec);
        if (!frozen) {
          try { if (gone.length) await st.drop(gone); await st.save(put); } catch (_) { /* derived: rebuilt next launch */ }
        }
      } while (run.again);
      localBusy = null;
      if (listOpen()) renderList();
      // the 诊断 button counts the 本机 games too (v8-1-plan T5)
      d.renderLibrary();
    })();
    localBusy = run;
    return run.p;
  }

  /** LibraryQuery.ecoOfFens over the ECO table, once it has arrived (undefined before). */
  const ecoOfFens = (fens) => {
    const tab = typeof window !== "undefined" ? window.ECO_BY_KEY : null;
    return tab ? LibraryQuery.ecoOfFens(fens, tab) : undefined;
  };
  /**
   * Every game's opening, filled in where it is missing — imported and 本机,
   * claimed or not, so the search can find them by opening. A slice at a
   * time: at ten thousand games the synchronous fill (library-ui.js
   * fillOpenings, 7.1) replays up to 24 plies of each and would hold the
   * window for seconds. A game the table has nothing for is marked "" and
   * not asked again.
   */
  let filling = null;
  function fillOpenings() {
    if (filling) return filling;
    if (!allGames().some((g) => typeof g.eco !== "string" && g.sans)) return Promise.resolve();
    filling = (async () => {
      try { await d.Eco.ready(); } catch (_) { /* no table: nothing to fill */ }
      let n = 0;
      if (d.Eco.loaded()) {
        let t0 = Date.now();
        for (const g of allGames()) {
          if (typeof g.eco === "string" || !g.sans) continue;
          let hit = null;
          try { hit = d.Eco.openingForGame(g.sans.split(" ").slice(0, 24), g.fen || undefined); } catch (_) { hit = null; }
          g.eco = hit ? hit.eco : "";
          g.ecoName = hit ? hit.name || "" : "";
          n++;
          if (Date.now() - t0 > SLICE) { await d.pause(); t0 = Date.now(); }
        }
      }
      filling = null;
      // the diagnosis too: its 本机 rows counted only the games that had an
      // opening when it was drawn (8.1 M2, CI's WebKit — see diagView)
      if (n) { save(); if (listOpen()) renderList(); if (diagOpen()) d.renderDiagnosis(); }
    })();
    return filling;
  }

  /**
   * The games the page is showing, as one PGN file — the whole library when
   * nothing is filtered (v8-0-plan C1: 整库导出和导回逐局相等). The source row
   * says whether 本机 games go too (v8-1-plan T5): 导入 leaves them out, as
   * 8.0 did; 本机 and 全部 take them, each with its record (localPgn), so a
   * re-import puts it back in the history as itself rather than as an
   * imported copy.
   */
  async function exportPgn() {
    await loaded;   // the summary's rows have no moves (v8-1-plan F3)
    let rows = LibraryQuery.query(allGames(), pageQuery(), st.pkOf);
    if (store.ui.libPick) rows = rows.filter(pickMatches);
    if (!rows.length) { toast(t("hist.noneMatch"), "fix"); return; }
    const text = rows.map((g) => {
      if (g.src !== "local") return LibraryQuery.entryPgn(g);
      const rec = localRec.get(g.id);
      if (!rec) return "";
      let headers = [];
      try { headers = d.PgnParser.parsePgn(rec.pgn).games[0].headers; } catch (_) { headers = []; }
      return LibraryLocal.localPgn(g, rec, headers, tf("lib.sfPlayer", [t("diff." + g.diff)]), LibraryQuery.entryPgn);
    }).filter(Boolean).join("\n");
    await d.exportText("chessboard-library.pgn", text, "application/x-chess-pgn", t("lib.exportPgn"));
  }

  // --- import and claim ----------------------------------------------------
  /** The file being read, as a promise; the next import waits for it. */
  let importing = null;
  /** How often an import waiting on a running pass looks again (review P1-1). */
  const BUSY_WAIT_MS = 500;
  /** A pass over the library, or the board's analysis, is running: the import waits or refuses. */
  const libBusy = () => !!(store.session.libRun || store.session.analyzing);
  /**
   * Take every game in a PGN file into the library (7.0), with its position
   * index made from the parse — the parser already walked every position.
   *
   * 8.1 M2 review P1-1: says what came of it — {added, dup} when the games
   * went in (added may be 0: all duplicates), null when nothing was taken
   * (refused, or nothing readable; a toast has said which). With
   * `opts.wait` (a sync's games, fetched and not to be fetched again for
   * nothing) a running pass is waited out rather than refused.
   * @returns {Promise<{added: number, dup: number}|null>}
   */
  async function importPgn(text, label, opts) {
    const wait = !!(opts && opts.wait);
    const text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return null; }
    // a second file (or a sync) while one is being read waits its turn: it
    // used to return here in silence, games fetched and gone (M5 review P3-2)
    for (;;) {
      while (importing) await importing;
      if (!libBusy() || !wait) break;
      await new Promise((ok) => setTimeout(ok, BUSY_WAIT_MS));
    }
    if (store.session.libUnreadable) { toast(t("lib.unreadable"), "fault"); return null; }
    // 导入全部数据 is reloading the page (P3-4): say that, rather than import into what goes
    if (frozen) { toast(t("msg.allData.imported")); return null; }
    if (libBusy()) { toast(t("lib.busy"), "fix"); return null; }
    let chunks;
    try { chunks = d.PgnParser.splitGames(text0); } catch (_) { chunks = d.Pgn.splitGames(text0); }
    // read game by game, handing the thread back every ~16 ms (7.5)
    let games, release;
    importing = new Promise((r) => { release = r; });
    // the openings come from the parse's own positions, so the ECO table
    // is wanted now rather than replayed for later (fillOpenings)
    try { await d.Eco.ready(); } catch (_) { /* no table: filled later */ }
    try { games = await d.PgnParser.parseGamesAsync(chunks); } finally { importing = null; release(); }
    // a pass begun while the file was read: from here to the end nothing
    // awaits, so once it is over the games go in whole
    while (wait && libBusy()) await new Promise((ok) => setTimeout(ok, BUSY_WAIT_MS));
    if (libBusy()) { toast(t("lib.busy"), "fix"); return null; }
    if (store.session.libUnreadable || frozen) return null;
    const now = Date.now();
    const fresh = [];
    // v8-1-plan T5: 本机 games exported with their record, back into the history
    const back = [];
    for (const parsed of games) {
      if (!parsed) continue;
      const rec = LibraryLocal.recFromGame(parsed, d.PgnParser.serializePgn);
      if (rec) { back.push(rec); continue; }
      // mainline SAN only: variations are the annotator's opinion
      const sans = [], fens = [parsed.root.fen];
      for (let n = parsed.root; n && n.children.length; n = n.children[0]) {
        sans.push(n.children[0].san);
        fens.push(n.children[0].fen);
      }
      if (!sans.length) continue;
      const e = Library.entryFrom(parsed, sans, store.session.libNames, now);
      if (!st.pk.has(e.id)) st.indexFens(e.id, fens);
      const eco = ecoOfFens(fens);
      if (eco !== undefined) { e.eco = eco ? eco.eco : ""; e.ecoName = eco ? eco.name : ""; }
      fresh.push(e);
    }
    if (!fresh.length && !back.length) { toast(t("msg.import.badPgn"), "fault"); return null; }
    const r = Library.addGames(store.session.library, fresh);
    store.session.library = r.list;
    for (const id of r.dropped) st.pk.delete(id);
    const loc = restoreLocal(back);
    save();
    d.renderLibrary();
    const added = r.added + loc.added, dup = r.dup + loc.dup;
    if (!added) toast(tf("lib.addedNone", [dup]), "fix");
    else toast(tdot(tf("lib.added", [added, dup]), label));
    if (r.dropped.length) toast(tf("lib.dropped", [Library.MAX_GAMES, r.dropped.length]), "fix");
    renderClaim();
    fillOpenings();
    return { added, dup };
  }

  /**
   * Records read back from an export (recFromGame) into the play history:
   * one whose id the history has is a duplicate and left alone, as a
   * re-imported archive game is (Library.addGames); the rest go in by their
   * time, under the history's own cap (app.js recordOutcome keeps 500).
   * Then they become 本机 entries the usual way (syncLocal).
   */
  /** app.js recordOutcome keeps this many records of play. */
  const HISTORY_MAX = 500;
  function restoreLocal(recs) {
    if (!recs.length) return { added: 0, dup: 0 };
    const stats = d.loadStats();
    const m = LibraryLocal.mergeRecs(stats.games, recs, HISTORY_MAX);
    if (m.changed) {
      stats.games = m.games;
      d.saveStats(stats);
      if (d.onLibraryLoaded) d.onLibraryLoaded();
      syncLocal();
    }
    return { added: m.added, dup: m.dup };
  }

  /**
   * v8-0-plan C1: 认领名字. Nobody has been named yet and the games agree on
   * one name (LibraryQuery.inferName): the library section offers it, once —
   * a line under the buttons, not a dialog, so it neither blocks the page nor
   * moves 分析 (7.6). Answered either way, or a name typed into the field,
   * and it is not offered again; the field stays for a correction.
   */
  function renderClaim() {
    const box = doc.getElementById("lib-claim");
    claim = claimAsked || store.session.libNames.length ? null : LibraryQuery.inferName(store.session.library);
    if (!box) return;
    box.hidden = !claim;
    const text = doc.getElementById("lib-claim-text");
    if (claim && text) text.textContent = tf("lib.claimAsk", [claim.name, claim.n, claim.of]);
  }
  function answerClaim(yes) {
    const c = claim;
    claimAsked = true;
    if (yes && c) {
      store.session.libNames = [c.name];
      const input = doc.getElementById("lib-names");
      if (input) input.value = c.name;
      d.reclaimLibrary();
    }
    save();
    renderClaim();
    d.renderLibrary();
    if (yes && c) toast(tf("lib.claimDone", [c.name, store.session.library.filter((g) => g.side).length]));
  }

  // --- v8-1-plan T5: the diagnosis's source row, and the clock of old games --
  const diagSrc = () => (["import", "local", "all"].includes(store.ui.diagSrc) ? store.ui.diagSrc : "import");
  /**
   * The 本机 entries the diagnosis can read, each with its `an`
   * (LibraryLocal.localAnalysis) — hung on the entry itself, so a diagnosis
   * row's pick finds the same move in it (library-ui.js libPickPly). The
   * passes on file are the review's (analysis-store.js), by start and moves.
   */
  function localDiag() {
    let kept = store.session.analysesKept;
    if (!Array.isArray(kept)) {
      try { const v = JSON.parse(Persist.get("analyses") || "null"); kept = v && Array.isArray(v.list) ? v.list : []; } catch (_) { kept = []; }
    }
    const out = [];
    for (const e of st.local) {
      const fen = e.fen || LibraryLocal.START_FEN;
      const k = kept.find((x) => x && x.fen === fen && x.sans === e.sans && x.an);
      e.an = LibraryLocal.localAnalysis(e, localRec.get(e.id), k ? k.an : null);
      if (!e.an) continue;
      if (e.an.scalars) d.fillLosses(e);
      out.push(e);
    }
    return out;
  }
  /** What the diagnosis reads for the source on its row, and what to say about 本机. */
  function diagView() {
    const src = diagSrc();
    doc.querySelectorAll("#diag-src-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.dsrc === src);
      b.setAttribute("aria-pressed", b.dataset.dsrc === src ? "true" : "false");
    });
    const local = src === "import" ? [] : localDiag();
    // A 本机 entry made before the ECO table arrived has no opening
    // (localEntry). Drawn like that, an opening row counted the games that
    // had one — 2 on CI's WebKit — and its pick opened all 5, the list
    // having filled the rest (openList → fillOpenings). The same fill, asked
    // for here; it draws the diagnosis again when it has filled any.
    if (local.some((g) => typeof g.eco !== "string" && g.sans)) fillOpenings();
    const deep = local.filter((g) => g.an.tags.length).length;
    return { games: LibraryLocal.diagGames(src, store.session.library, local),
      note: src === "import" ? "" : tf("diag.localNote", [deep]) };
  }
  const dseg = doc.getElementById("diag-src-seg");
  if (dseg) dseg.onclick = (ev) => {
    const b = ev.target.closest("button[data-dsrc]");
    if (!b || b.dataset.dsrc === diagSrc()) return;
    store.ui.diagSrc = b.dataset.dsrc;
    d.renderDiagnosis();
  };
  // --- the rest of the seam ------------------------------------------------
  // v8-1-plan F3: the entries are in — the list draws them in place of the
  // summary's rows, and what waited on them (a click, 导出) goes ahead
  if (stubs) {
    stubs = null;
    // a row whose summary was out of date is redrawn: not while it is pressed (7.6)
    const redraw = () => { if (listOpen()) { fillOpenings(); renderList(); } };
    if (!pressed) redraw();
    else {
      const after = () => {
        doc.removeEventListener("pointerup", after, true);
        doc.removeEventListener("pointercancel", after, true);
        setTimeout(redraw, 0);   // after the click the release makes
      };
      doc.addEventListener("pointerup", after, true);
      doc.addEventListener("pointercancel", after, true);
    }
  }
  loadedNow();
  for (const [id, yes] of [["lib-claim-yes", true], ["lib-claim-no", false]]) {
    const b = doc.getElementById(id);
    if (b) b.onclick = () => answerClaim(yes);
  }
  renderClaim();
  if (renamed) { d.reclaimLibrary(); save(); }
  // what is not indexed yet (a restored library), in the background; the
  // position filter finds more as it goes
  const indexing = st.indexMissing(SLICE, d.pause).then(() => { if (listOpen()) renderList(); });
  // a press queued on the summary runs once the 本机 records are in too (M4 评审)
  Promise.resolve(syncLocal()).then(runQueued, runQueued);
  // v8-1-plan F3: the stored summary made to agree with the entries just
  // read, in the background; the header learns its id once
  const summarised = mode === "idb"
    ? st.syncSummary(SLICE, d.pause).then((id) => {
      // the header as it is now, not as it was at boot (M4 评审 P2-2)
      const now = readHeader(Persist.get("library")) || {};
      if (id && now.sum !== id && !frozen) writeHeader();
      return id;
    })
    : Promise.resolve(null);

  return {
    mode: () => mode,
    save,
    writeHeader,
    importPgn,
    openList,
    renderList,
    syncLocal,
    exportPgn,
    // v8-1-plan T5: the diagnosis's sources
    diagView,
    localAnalysed: () => st.local.filter((g) => typeof g.acc === "number").length,
    last,
    indexing,
    // v8-1-plan F3: the stored summary agrees with the entries (its id), for the e2e
    summarised,
    /** v8-0-plan C1 query API (see library-query.js), over imported + 本机 */
    query: (q) => LibraryQuery.query(allGames(), q, st.pkOf),
    gamesWithPosition: (fen) => LibraryQuery.gamesWithPosition(allGames(), fen, st.pkOf),
    all: allGames,
    pkOf: st.pkOf,
    // persist.js's port (BULK)
    // held: null — unknown, so they stay owed and the manifest keeps them
    // (M5 review P2-1)
    shardNames: () => (held ? null : Object.keys(shardMap())),
    shardText: (name) => {
      if (held) return null;
      // grouped once per library state, not once per shard asked for
      if (!groups || groups.list !== store.session.library) {
        // v8-1-plan F3: timed for a test's probe (persist.js timed); part of its "shardText"
        const probe = globalThis.__persistProbe, t = probe ? performance.now() : 0;
        groups = { list: store.session.library, m: shardGroups() };
        if (probe) probe("shardGroups", performance.now() - t);
      }
      const g = groups.m.get(name);
      return g ? JSON.stringify({ v: 1, games: g }) : null;
    },
    // 导入全部数据 (M5 review P3-4): the page reloads onto the restored games;
    // until then the pass stops, the index stops and nothing is saved
    restoreShards: async (texts) => {
      frozen = true;
      st.halt();
      if (store.session.libRun) store.session.libRun.abort = true;
      // a save already queued lands before the replace, not after it
      await chain.catch(() => {});
      await st.restoreShards(texts);
    },
    clear: () => {
      store.session.library = [];
      sigs.clear();
      held = false;
      // the index stops now, not when the chain reaches the clear (P2-2)
      st.halt();
      chain = chain.then(() => st.clear()).catch(() => {});
    },
  };
}

// v8-1-plan N3: the packaged self-test's idb / chunkSync / nativeIo checks ride here too
export const CHESS_LIBDB = { bootLibrary, LibraryQuery, LibraryDb, createDiagCharts, runNativeSelftest };
