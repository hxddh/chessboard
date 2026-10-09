/**
 * 棋谱库的调度、存档与两块界面。
 *
 * The model is library.js and has been since 7.0; this is everything the app
 * wraps around it — the background pass, the on-disk record, the 记录 pane's
 * section, the list dialog and the diagnosis dialog (its three charts are
 * diag-charts.js, in chunk-libdb.js since the M5 merge).
 * Carved out of app.js in 7.2 (v7-2-plan §4), the same way report.js and
 * native-commands.js were: app.js had grown past ten thousand lines and this
 * was by far the largest thing in it that already had a clean seam under it.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createLibraryUI()` — the document, the store, the persistence port, the
 * toast, and the handful of app functions a library game touches when it
 * lands on the board. Nothing here reaches back into app.js.
 *
 * The pure modules it uses are imported here rather than passed, because they
 * are the same objects app.js imports: patching `ChessEngine` through the
 * test seam patches the object this file holds too.
 * @module library-ui
 */
import { Chess } from "./chess.js";
import { ChessDialog } from "./dialog.js";
import { loadChunk } from "./chunk.js";
import { ChessEco } from "./eco-lookup.js";
import { ChessEngine } from "./engine.js";
import { ChessFide } from "./fide.js";
import { ChessHost } from "./host.js";
import { ChessLibrary } from "./library.js";
import { ChessMistakes } from "./mistakes.js";
import { ChessPgn } from "./pgn.js";
import { ChessPgnParser } from "./pgn-parser.js";
import { ChessProgress } from "./progress.js";
import { ChessReview } from "./review.js";
import { motifOf } from "./motif.js";
import { reconcile } from "./keyed.js";
import { prefetchSummary, LIBDB_CHUNK } from "./library-sum.js";
import { tdot } from "./tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createLibraryUI(d) {
  const {
    doc, store, Persist, game, t, tf, toast, sync,
    SCAN_BUDGET, evalScalar, importPgnText, invalidateEngine, judgeColours,
    leaveTrainer, plyLosses, sansOf, saveGame, saveMines, saveProgress, savePuzzleState,
    saveSettings, setSideTab, setViewIndex, stopLiveAnalysis, withMotifs, recallAnalysis,
    renderRecordEntry,
  } = d;
  const Dlg = ChessDialog;
  const Fide = ChessFide;
  const Host = ChessHost;
  const Library = ChessLibrary;
  const Mistakes = ChessMistakes;
  const Progress = ChessProgress;
  const Review = ChessReview;

  // --- 棋谱库 ---------------------------------------------------------------
  //
  // The model is library.js; everything here is scheduling, persistence and
  // the two screens. See that file's header for why this exists at all.

  /** How many analysed games buy a diagnosis. */
  const LIB_MIN_GAMES = 20;
  /**
   * Per-position budget for the background pass, in ms. Same as the 分析
   * button — see SCAN_BUDGET for why it is 200 and not 120.
   *
   * A pass over a full library costs about 1.7× what 120 ms would. That is
   * the right trade here and not a close call: every number on the diagnosis
   * page is meant to be acted on, and the pass is backgroundable, pausable
   * and resumable, so the cost is wall-clock the player never waits through.
   */
  const LIB_BUDGET = SCAN_BUDGET;
  /**
   * What 「再深一遍」 spends per ply (7.2 A1).
   *
   * Not the default, deliberately. An 80-ply game is 16 seconds at 200ms and
   * 32 at 400; two hundred games is 53 minutes against 107. The scan budget
   * stays where it is and the deeper look is asked for, one game at a time,
   * about the games worth it. `docs/measured.json` (libRevision) is what that
   * second look is worth: the share of ?? it withdraws and the share of the
   * survivors whose answer it changes.
   */
  const LIB_DEEP_BUDGET = 400;
  /**
   * What a library pass really costs per position, as a share of LIB_BUDGET
   * (7.5). Measured with the real engine in the 7.5 walkthrough: the first 8
   * corpus games (scripts/fixtures/corpus.mjs — 514 plies, so 522 positions
   * with each start) took 102 s at 200 ms, mining included:
   * 102000 / (522 × 200) ≈ 0.98. Terminal positions skip the engine and the
   * rest of the per-ply work is small beside the search, so this is ~1.
   */
  const LIB_PACE = 0.98;
  /**
   * 「约 N 分钟」 for the games still queued: their positions × the scan
   * budget × LIB_PACE. 500 games is one to two hours, and a button that says
   * 分析剩下的 500 局 and nothing else lets that come as a surprise.
   */
  function libEta(games) {
    let positions = 0;
    for (const g of games) positions += (Number(g.plies) || 0) + 1;
    const min = Math.max(1, Math.ceil(positions * LIB_BUDGET * LIB_PACE / 60000));
    return min < 100 ? tf("lib.etaMin", [min]) : tf("lib.etaHour", [Math.round(min / 6) / 10]);
  }

  /**
   * v8-1-plan F3: the library's summary, read from IndexedDB while the app
   * is still starting — by chunk-boot.js before this bundle ran, or from
   * here (library-sum.js prefetchSummary takes whichever came first). The
   * reply waits in memory for the chunk, which would otherwise ask only once
   * it runs, and then wait behind every frame the start-up draws. Null:
   * nothing to ask for.
   */
  let libSumPre = null;
  function loadLibrary() {
    const s = Persist.read("library").value;
    if (!s) return { games: [], names: [] };
    store.session.libComing = Number(s.n) || 0;
    // v8-1-plan F3: games in IndexedDB with a summary beside them — asked for now (see libSumPre)
    if (typeof s.sum === "string" && s.sum) {
      libSumPre = prefetchSummary(typeof indexedDB !== "undefined" ? indexedDB : null);
    }
    return { games: [], names: s.names.filter((n) => typeof n === "string") };
  }

  /**
   * A 本机 game's per-ply losses, from the scalars of its kept pass
   * (library-local.js localAnalysis leaves them empty): lossOf over each
   * pair, the one routine an imported game's pass uses too.
   */
  function fillLosses(g) {
    const an = g && g.an;
    if (!an || !Array.isArray(an.scalars) || !Array.isArray(an.losses)) return;
    const sc = an.scalars;
    if (sc.length !== an.losses.length + 1) return; // not a shape we wrote
    // side to move at ply 0, straight off the stored FEN — no board needed
    let side = typeof g.fen === "string" && g.fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
    an.losses = an.losses.map((_, i) => {
      const a = sc[i], b = sc[i + 1];
      const out = a == null || b == null ? null : Review.lossOf(a, b, side);
      side = side === "w" ? "b" : "w";
      return out;
    });
  }
  {
    const loaded = loadLibrary();
    store.session.library = loaded.games;
    store.session.libNames = loaded.names;
  }
  /** Set while the background pass is running; the pause button clears it. */
  store.session.libRun = null;

  // v8-0-plan C1: the games are in IndexedDB now, and the code that keeps
  // them there — storage, search, 本机 games, the list page — is the chunk
  // chunk-libdb.js (library-page.js), loaded after the first frame. Until it
  // is in, the library shows what the header held (a v1 library's games, or
  // none), and anything that would change the games waits for it.
  let libDb = null;
  // v8-1-plan F3: the list page on the library's summary, before the games
  // are loaded ({count, openList, renderList}; library-page.js)
  let libEarly = null;
  // the diagnosis charts (diag-charts.js) came with the chunk, at the M5 merge
  let charts = null;
  const libDbReady = new Promise((resolve) => {
    const later = (fn) => (typeof requestAnimationFrame === "function"
      ? requestAnimationFrame(() => setTimeout(fn, 0)) : setTimeout(fn, 0));
    // v8-1-plan F3: opening on the library page, chunk-boot.js has put the
    // chunk ahead of the bundle (library-sum.js opensOnLibrary) — then the
    // boot goes now, and the list from the summary is in the first frame
    const start = typeof globalThis !== "undefined" && globalThis[LIBDB_CHUNK.global] ? (fn) => fn() : later;
    start(() => loadChunk(LIBDB_CHUNK.file, LIBDB_CHUNK.global).then((m) => (charts = m.createDiagCharts({ doc, t, tf, judgeColours, libMoveNo }))
      && m.bootLibrary(Object.assign({}, d, { tdot,
      // handed over once: its reply holds the whole summary text (M4 评审)
      summary: ((p) => { libSumPre = null; return p; })(libSumPre),
      onSummary: (c) => { libEarly = c; renderLibrary(); },
      Library, Dlg, reconcile, Chess, PgnParser: ChessPgnParser, Pgn: ChessPgn, Eco: ChessEco,
      idb: typeof indexedDB !== "undefined" ? indexedDB : null, withLock: Host.withStoreLock,
      pause: () => new Promise((r) => setTimeout(r, 8)), LIB_DEEP_BUDGET, fillOpenings, libEcoName, libPickPly,
      libraryLabel, reclaimLibrary, renderLibrary, deepenLibraryGame, loadFromLibrary, fillLosses, renderDiagnosis,
    }))).then((c) => {
      libDb = c;
      libEarly = null;
      if (d.onLibraryLoaded) d.onLibraryLoaded();
      renderLibrary();
      resolve(c);
    }, () => resolve(null)));
  });
  Persist.attachBulk({
    names: () => (libDb ? libDb.shardNames() : null),
    read: (name) => (libDb ? libDb.shardText(name) : null),
    restore: (texts) => libDbReady.then((c) => c && c.restoreShards(texts)),
    clear: () => { store.session.library = []; if (libDb) libDb.clear(); },
  });
  if (typeof window !== "undefined" && window.__chess) {
    // the e2e's view of the library (the games are no longer in localStorage)
    window.__chess.library = () => ({ v: 1, names: store.session.libNames, games: store.session.library,
      ready: !!libDb, mode: libDb ? libDb.mode() : null });
    window.__chess.libDb = () => libDb;
  }
  function saveLibrary() {
    if (libDb) return libDb.save();
    // before the chunk: nothing has changed a game yet (imports and passes
    // wait for it), so the one thing to keep is the names
    libDbReady.then((c) => (c ? c.save() : Persist.setJson("library",
      { v: 1, games: store.session.library, names: store.session.libNames })));
  }

  /** A library game by its id — what the list's rows carry (D1). */
  function libEntryById(id) {
    return id ? store.session.library.find((g) => g.id === id) || null : null;
  }

  /** The names split out of the one text field, trimmed, empties dropped. */
  function libNamesFrom(text) {
    return String(text || "").split(/[,，;；]/).map((n) => n.trim()).filter(Boolean);
  }

  /**
   * Re-run the claim over every entry.
   *
   * Typing a name is the single most likely correction someone makes on this
   * page — they import an archive, see 一局都没认出是你下的, and fix it. That
   * has to re-decide `side` and `outcome` for games already in the library,
   * and it must NOT touch `an`: the analysis measured both sides' plies, so
   * the same pass answers for either chair.
   */
  function reclaimLibrary() {
    const names = store.session.libNames;
    for (const g of store.session.library) {
      const headers = [["White", g.white || ""], ["Black", g.black || ""]];
      g.side = Library.sideOf(headers, names);
      g.outcome = Library.outcomeFor(g.result, g.side);
    }
  }

  /**
   * Take every game in a PGN file into the library. The work is the chunk's
   * (library-page.js importPgn): parse, index, store, and the name claim.
   *
   * Deliberately not the same path as 导入棋谱: that one asks which single
   * game you meant, because it is about to put one on the board. Here the
   * whole file is the point.
   *
   * Resolves with what came of it (8.1 M2 review P1-1): {added, dup}, or
   * null when nothing was taken in. `opts.wait`: see library-page.js.
   */
  async function importPgnToLibrary(text, label, opts) {
    const c = await libDbReady;
    if (!c) { toast(t("msg.import.badPgn"), "fault"); return null; }
    return c.importPgn(text, label, opts);
  }

  /**
   * Accuracy for one library game, from its own moves.
   *
   * `accuracyFrom` reads `sanHistory()` — the game on the board — so it cannot
   * serve a game that is not on the board. Same measure, own arguments.
   */
  function libAccuracy(fens, scalars, sans) {
    const loss = Review.lossesBySide(scalars, (i) => (fens[i].split(" ")[1] === "w" ? "w" : "b"));
    const w = Review.accuracyOf(loss.w);
    const b = Review.accuracyOf(loss.b);
    const wp = Review.summarizeWinPct(scalars, sans, fens[0].split(" ")[1] === "b" ? "b" : "w");
    return { acc: { w: wp ? wp.acc.w : w.acc, b: wp ? wp.acc.b : b.acc },
      acpl: { w: w.acpl, b: b.acpl } };
  }

  /**
   * One game's offline pass. Returns the `an` record, or null if it was cut
   * short — a half-analysed game stays in the queue rather than being filed
   * as a measurement of something it did not measure.
   *
   * A search that comes back empty is not "no evaluation" (7.4 D7). It is a
   * search that `invalidateEngine()` cancelled because someone moved a piece
   * on the board, or an engine that has died. 7.3 wrote it down as a hole
   * and filed the game anyway, at the full budget — so one click on the board
   * could leave a ?? that 「再深一遍」 would never be offered for, and a dead
   * engine wrote a record of nothing but holes over a good 200ms one. Now:
   * one retry, and if that is empty too the whole game is abandoned with
   * `run.failed` set, and nothing is written. A worse result never replaces
   * a better one.
   */
  async function analyseLibraryGame(entry, run, budget) {
    const sans = entry.sans.split(" ").filter(Boolean);
    const g = entry.fen ? new Chess(entry.fen) : new Chess();
    const fens = [g.fen()];
    for (const san of sans) {
      if (!g.move(san, { sloppy: true })) return null; // not a game we can replay
      fens.push(g.fen());
    }
    const scalars = new Array(fens.length).fill(null);
    const bests = new Array(fens.length).fill(null);
    const repSeen = new Map();
    for (let i = 0; i < fens.length; i++) {
      if (run.abort) return null;
      const probe = new Chess(fens[i]);
      const repKey = Fide.positionKey(fens[i], probe);
      const reps = (repSeen.get(repKey) || 0) + 1;
      repSeen.set(repKey, reps);
      // same terminal rule as analyzeGame(): threefold and the 50-move mark
      // are claimable, not over, and scoring them 0 flattens the curve
      if (probe.in_checkmate()) scalars[i] = probe.turn() === "w" ? -10000 : 10000;
      else if (Fide.positionFinished(probe, reps)) scalars[i] = 0;
      else {
        let e = null;
        for (let tries = 0; tries < 2 && evalScalar(e) == null; tries++) {
          if (run.abort) return null;
          // v8-1-plan F4: the lowest level — a game move preempts it, and
          // this ply is searched again afterwards, not the whole game
          try { e = await ChessEngine.analyze(fens[i], budget, { bg: true }); } catch (_) { e = null; }
        }
        if (evalScalar(e) == null) { run.failed = true; return null; }
        scalars[i] = evalScalar(e);
        if (e && typeof e.best === "string" && e.best.length >= 4) bests[i] = e.best;
      }
      run.ply = i + 1;
      run.plies = fens.length;
      renderLibrary();
    }
    return libRecord(fens, sans, scalars, bests, budget);
  }

  /**
   * The `an` record (and the miner's view of it) from one pass's arrays.
   *
   * Split out of analyseLibraryGame (v7-6-plan §1c) so a 精析 on the board can file
   * its result into the library entry it came from through the same code —
   * the same tags, motifs and accuracy a library pass would have written.
   */
  function libRecord(fens, sans, scalars, bests, budget) {
    const tags = sans.map((_, i) => {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) return null;
      const mover = fens[i].split(" ")[1] === "w" ? "w" : "b";
      return Review.classifyByWinPct(Review.winPctDrop(a, b, mover));
    });
    const losses = plyLosses(fens, scalars);
    // What the player missed, at the plies where they went wrong: the motif of
    // the engine's OWN move in that position, not of the move they played. A
    // blunder rarely has a motif; the thing that punished it does, and that is
    // the name worth putting in front of someone ("你栽在双击上 7 次").
    const motifs = {};
    for (let i = 0; i < tags.length; i++) {
      if (tags[i] !== "?" && tags[i] !== "??") continue;
      const uci = bests[i];
      if (!uci) continue;
      const san = sansOf(fens[i], [uci], 1)[0];
      if (!san) continue;
      let m = null;
      try { m = motifOf(fens[i], san, Chess); } catch (_) { m = null; }
      if (m) motifs[i] = m;
    }
    const a = libAccuracy(fens, scalars, sans);
    // `pass` is the same shape analyzeGame hands the miner, so the library
    // feeds 错题自炼 through exactly one set of rules rather than a second
    // copy of them (v7-1-plan §1.2). Not stored — it is the arrays that are
    // stored, and this is a view of them for the caller's next step.
    return { an: { acc: a.acc, acpl: a.acpl, tags, losses, scalars, bests, budget },
      // scalars ride along so reviseMines can tell "this ply was fine" from
      // "this ply was never measured" — see its `judged`
      motifs, pass: { fens, sans, tags, bests, losses, scalars } };
  }

  /** Start (or stop) the background pass over everything still unanalysed. */
  /**
   * Bank one library game's blunders as drills.
   *
   * v7-plan §6.3, which 7.0 skipped: `mistakes.js` has argued since 5.1 that
   * the one content source no canned book can have is the games this player
   * really lost — and 7.0 shipped a feature that analysed hundreds of them
   * and sent not one to the book. `addMines` was called from exactly two
   * places, both on the board path.
   *
   * Same three calls in the same order as the board's pass, deliberately: a
   * deeper look first REVISES what the book already says about a position
   * (audit F2), and only then extends it. Nothing here is library-specific
   * except where the arrays came from.
   * @returns {number} drills added
   */
  function mineLibraryGame(entry, pass, budget) {
    const none = { added: 0, revised: 0, withdrawn: 0 };
    if (!entry || !entry.side || !pass) return none;
    const rev = { budget, src: "lib", from: entry.id ? { kind: "lib", id: entry.id } : undefined };
    const cands = withMotifs(Mistakes.candidatesFrom(pass, entry.side, Chess, rev));
    const solvedIds = new Set(Object.keys(store.session.puzzleState.solved).filter((k) => k.startsWith("mine:")));
    // …but the revision pass runs even with no candidates: "this game has no
    // ?? at 400ms" is exactly the sentence that withdraws the ones 200ms
    // minted, and returning early on an empty list would throw it away.
    const rv = Mistakes.reviseMines(store.session.mines, cands, pass, entry.side, rev);
    const r = Mistakes.addMines(rv.list, cands, Date.now(), solvedIds);
    const dropped = rv.retired.concat(r.dropped);
    if (!r.added && !dropped.length && !rv.updated.length && !rv.filled.length) return none;
    store.session.mines = r.list;
    saveMines();
    for (const id of dropped) {
      delete store.session.puzzleState.solved[id];
      delete store.session.puzzleState.missed[id];
    }
    if (dropped.length) savePuzzleState();
    if (r.added) { Progress.recordMined(store.session.progress, r.added, Date.now()); saveProgress(); }
    return { added: r.added, revised: rv.updated.length, withdrawn: rv.retired.length };
  }

  /**
   * 「再深一遍」: re-analyse ONE library game at the deeper budget (7.2 A1).
   *
   * Until 7.2 a library game was analysed once and never again — `pending()`
   * filters on `!g.an`, so nothing could ask for a second look. That was
   * harmless while drills came only from the board, where 精析 already runs
   * `reviseMines` over them; 7.1 made the library the book's main supplier
   * and left it with no such door. `docs/measured.json` (libRevision) says
   * what is behind it: at these two budgets, the share of ?? the deeper pass
   * withdraws and the share of the survivors whose answer it changes.
   *
   * Same three steps as every other pass, in the same order — analyse,
   * revise, extend — because the correction semantics are `reviseMines`'s
   * and this is the first caller on this path to need them.
   */
  async function deepenLibraryGame(id) {
    const entry = libEntryById(id);
    if (!entry || !entry.an || entry.unplayable) return;
    if (store.session.libUnreadable) { toast(t("lib.unreadable"), "fault"); return; }
    if (store.session.libRun) { toast(t("lib.busy"), "fix"); return; }
    if (!ChessEngine) { toast(t("msg.analysis.noGame"), "fault"); return; }
    if (store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    // the token before the first await — see runLibraryPass
    const run = { abort: false, done: 0, mined: 0, total: 1, ply: 0, plies: 0, deep: true,
      name: (entry.white || "?") + " — " + (entry.black || "?") };
    store.session.libRun = run;
    renderLibrary();
    renderLibList();
    let r = null;
    try {
      // v8-0-plan C1: what the pass writes goes to IndexedDB, so the store is up first
      await libDbReady;
      await stopLiveAnalysis();
      r = await analyseLibraryGame(entry, run, LIB_DEEP_BUDGET);
    } finally {
      store.session.libRun = null;
      renderLibrary();
      renderLibList();
      // 7.6 §1a: 持续分析 stood aside for the pass (liveAllowed); pick it up
      if (store.session.liveOn) sync();
    }
    if (!r) { toast(t("lib.deepCut"), "fix"); return; }
    entry.an = r.an;
    entry.motifs = r.motifs;
    const m = mineLibraryGame(entry, r.pass, LIB_DEEP_BUDGET);
    saveLibrary();
    renderLibrary();
    renderLibList();
    sync();
    toast(tf("lib.deepDone", [libraryLabel(entry), m.withdrawn, m.revised, m.added]));
  }

  /**
   * A pass run on the board, over a game that is in the library (7.6 §1c).
   *
   * Opening a library game and pressing 精析 used to leave the library where
   * it was: budget 200 and the old accuracy in the entry, 400 and the new one
   * on screen, and the diagnosis and the drills still reading the shallower
   * look. Now the deeper pass is filed back exactly as 「再深一遍」 files its
   * own — record, then revise and extend the drills — and a shallower or
   * equal one changes nothing. Matched by moves and start position, not by
   * how the game got onto the board.
   * @param {{fens: string[], sans: string[], scalars: number[], bests: string[], budget: number}} p
   * @param {boolean} mine run the library's miner (false when the board's own
   *   miner already took this pass)
   * @returns {boolean} whether an entry was updated
   */
  function adoptBoardAnalysis(p, mine) {
    if (!p || !Array.isArray(p.sans) || !p.sans.length || store.session.libRun) return false;
    // v8-0-plan C1: before the library has loaded, its entries are about to
    // be replaced by the stored ones; file into those
    if (!libDb) { libDbReady.then((c) => { if (c) adoptBoardAnalysis(p, mine); }); return false; }
    // a hole is a search that did not answer; the library never files those
    if (p.scalars.some((x) => x == null)) return false;
    const text = p.sans.join(" ");
    const entry = store.session.library.find((g) => g && g.sans === text && !g.unplayable &&
      new Chess(g.fen || undefined).fen() === p.fens[0]);
    if (!entry || (entry.an && (entry.an.budget || LIB_BUDGET) >= p.budget)) return false;
    const r = libRecord(p.fens, p.sans, p.scalars, p.bests, p.budget);
    entry.an = r.an;
    entry.motifs = r.motifs;
    if (mine) mineLibraryGame(entry, r.pass, p.budget);
    saveLibrary();
    renderLibrary();
    renderLibList();
    return true;
  }

  async function runLibraryPass() {
    if (store.session.libRun) { store.session.libRun.abort = true; return; }
    // read-only this session (library-page.js, M5 review P2-1): a result could not be kept
    if (store.session.libUnreadable) { toast(t("lib.unreadable"), "fault"); return; }
    if (!ChessEngine) { toast(t("msg.analysis.noGame"), "fault"); return; }
    if (store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    // The run token goes up BEFORE the first await. It used to go up after
    // `stopLiveAnalysis()`, and two clicks inside that await both found
    // `libRun` empty and started two passes over the same queue.
    const run = { abort: false, done: 0, mined: 0, total: Library.pending(store.session.library).length, ply: 0, plies: 0 };
    store.session.libRun = run;
    renderLibrary();
    try {
      // v8-0-plan C1: what the pass writes goes to IndexedDB, so the store is up first
      await libDbReady;
      await stopLiveAnalysis();
      for (;;) {
        if (run.abort) break;
        // A pass over a few hundred games takes the better part of an hour,
        // and the person will not be watching it. One notification carrying a
        // fixed `id` (SDK 0.10.0) is REPLACED by the next one instead of
        // stacking, which is the difference between a progress report and
        // twenty notifications. No action button: `actionCommand` dispatches
        // an app command, and every command in this app passes a mode gate
        // built from the shortcut table — a command with no row there simply
        // does not run, so a button wired to one would be a button that does
        // nothing. Recorded in docs/v7-plan.md §7.5.
        if (!store.ui.appForeground && run.done) {
          Host.notify({ id: "chess.libraryPass", title: t("ntf.libraryTitle"),
            body: tf("ntf.libraryBody", [run.done, run.total]) });
        }
        // re-read the queue each round: an import during the pass adds to it,
        // and an entry that failed to replay must not be handed back forever
        const next = Library.pending(store.session.library).find((g) => !g.an && !g.unplayable);
        if (!next) break;
        run.name = (next.white || "?") + " — " + (next.black || "?");
        const r = await analyseLibraryGame(next, run, LIB_BUDGET);
        if (run.abort) break;
        // the engine gave nothing twice: stop here, file nothing. Carrying on
        // would hand the same game back forever (it is still pending), and
        // marking it unplayable would be a lie about the game
        if (run.failed) break;
        if (!r) { next.unplayable = true; }
        else {
          next.an = r.an;
          next.motifs = r.motifs;
          run.mined += mineLibraryGame(next, r.pass, LIB_BUDGET).added;
        }
        run.done++;
        saveLibrary();
        renderLibrary();
      }
    } finally {
      const done = run.done, mined = run.mined;
      store.session.libRun = null;
      saveLibrary();
      renderLibrary();
      // 7.6 §1a: 持续分析 stood aside for the pass (liveAllowed); pick it up
      if (store.session.liveOn) sync();
      if (run.failed) toast(t("lib.passCut"), "fix");
      if (done && mined) toast(tf("lib.minedDone", [done, mined]));
      if (done && !store.ui.appForeground) {
        Host.notify({ id: "chess.libraryPass", title: t("ntf.libraryTitle"),
          body: tdot(tf("ntf.libraryDone", [done]), mined ? tf("msg.mined", [mined]) : "") });
      }
    }
  }

  /**
   * `items` as <p> lines in `box`, reusing the ones already there: the text
   * of a progress line changes every ply, the nodes need not.
   */
  function putLines(box, items) {
    while (box.childElementCount > items.length) box.lastElementChild.remove();
    items.forEach((it, i) => {
      let p = box.children[i];
      if (!p || p.tagName !== "P") {
        p = doc.createElement("p");
        if (box.children[i]) box.children[i].replaceWith(p);
        else box.appendChild(p);
      }
      if (p.className !== it.cls) p.className = it.cls;
      setText(p, it.text);
    });
  }

  /** textContent, written only when it differs (see renderLibrary). */
  function setText(node, text) {
    if (node.textContent !== text) node.textContent = text;
  }

  /** The library section in the 记录 pane. */
  function renderLibrary() {
    const body = doc.getElementById("lib-body");
    if (!body) return;
    const list = store.session.library;
    const analysed = list.filter((g) => g.an && g.side);
    const queuedGames = Library.pending(list).filter((g) => !g.unplayable);
    const queued = queuedGames.length;
    const meta = doc.getElementById("lib-meta");
    // v8-1-plan F3: before the games, the summary knows how many there are
    const shown = list.length || (!libDb && libEarly ? libEarly.count : 0);
    if (meta) { meta.hidden = !shown; meta.textContent = tf("lib.count", [shown]); }
    const namesRow = doc.getElementById("lib-names-row");
    if (namesRow) namesRow.hidden = !list.length;
    // 7.6 (v7-6-plan §2): the counts stay above the buttons and are updated
    // in place; every line that comes and goes goes to #lib-status, under
    // them. This runs on the name field's first `change` — which is focus
    // leaving it, i.e. the mouse-down of the click on 分析 — and once a ply
    // during a pass, under 暂停分析: nothing above those buttons may change
    // height here, or WebKit loses the click.
    const lines = [];
    const line = (text, cls) => { lines.push({ text, cls: cls || "hint" }); };
    // 7.9 §4a: empty, the section is one dashed card with 导入棋谱文件
    // inside it, and that button is the page's primary (see .rec-block).
    // Classes only — the button itself is never rebuilt (7.6).
    // v8-0-plan C1: the games are still on their way from IndexedDB — the
    // header knows how many; the empty state would be a lie for a second
    const coming = !libDb && store.session.libComing;
    const block = doc.getElementById("lib-block");
    if (block) block.classList.toggle("empty", !list.length && !coming);
    const imp = doc.getElementById("lib-import");
    if (imp) imp.classList.toggle("primary", !list.length && !coming);
    // v8-0-plan §5: the page's own empty state counts the library as well
    if (renderRecordEntry) renderRecordEntry();
    if (!list.length && coming) putLines(body, [{ text: tf("lib.loading", [coming]), cls: "hint" }]);
    // M5 review P2-1: out of reach this session is not "empty"
    else if (!list.length && store.session.libUnreadable) putLines(body, [{ text: t("lib.unreadable"), cls: "hint warn" }]);
    else if (!list.length) {
      // 7.7 (v7-7-plan §3): an empty state — icon, one line, and 导入棋谱文件
      // (see .empty-note)
      putLines(body, [{ text: t("lib.empty"), cls: "hint empty-note" }]);
    } else {
      const claimed = list.filter((g) => g.side).length;
      let row = body.firstElementChild;
      if (!row || row.className !== "stat-row" || body.childElementCount !== 1) {
        row = doc.createElement("div");
        row.className = "stat-row";
        const k = doc.createElement("span");
        k.className = "stat-k";
        const v = doc.createElement("span");
        v.className = "stat-v num";
        row.append(k, v);
        body.replaceChildren(row);
      }
      setText(row.children[0], tf("lib.claimed", [claimed]));
      setText(row.children[1], tdot(tf("lib.analysed", [analysed.length]), queued ? tf("lib.queued", [queued]) : ""));
      const run = store.session.libRun;
      if (run && run.deep) line(tf("lib.deepWorking", [run.name || "", run.plies ? run.ply + "/" + run.plies : ""]));
      else if (run) line(tf("lib.working", [run.done + 1, run.total, run.plies ? run.ply + "/" + run.plies : run.name || ""]));
      else if (!claimed) line(t("lib.noneClaimed"), "hint warn");
      else if (analysed.length < LIB_MIN_GAMES) line(tf("lib.needMore", [LIB_MIN_GAMES - analysed.length, analysed.length, LIB_MIN_GAMES]));
      // A game whose moves would not replay is dropped from the queue, and a
      // queue that quietly gets shorter is how you end up wondering why the
      // count stopped moving. Say how many and leave them in the list.
      const stuck = list.filter((g) => g.unplayable).length;
      if (stuck) line(tf("lib.unplayable", [stuck]));
      // 7.2 A1: the other queue — analysed, but only at scan depth
      const shallow = Library.deepenable(list, LIB_DEEP_BUDGET).length;
      if (!run && shallow) line(tf("lib.deepable", [shallow]));
    }
    const status = doc.getElementById("lib-status");
    if (status) putLines(status, lines);
    const an = doc.getElementById("lib-analyse");
    if (an) {
      an.hidden = !queued && !store.session.libRun;
      // only when it differs: writing the same label again still swaps the
      // button's text node, and that node is what a press on the label was
      // pressed on — this runs once a ply during a pass, under 暂停分析
      setText(an, store.session.libRun ? t("lib.pause")
        : queued ? tf("lib.analyseEta", [queued, libEta(queuedGames)]) : tf("lib.analyse", [queued]));
    }
    const dg = doc.getElementById("lib-diagnose");
    // v8-1-plan T5: any source with enough (the dialog's row picks which)
    if (dg) dg.hidden = analysed.length + (libDb ? libDb.localAnalysed() : 0) < LIB_MIN_GAMES;
    const op = doc.getElementById("lib-open");
    if (op) {
      op.hidden = !shown;
      setText(op, tf("lib.all", [shown]));
    }
  }


  /**
   * The opening every claimed game was played in, filled in where missing.
   *
   * `diagnose()` has counted 开局战绩 since 7.0 and `foldGame` reads `g.eco` —
   * but nothing in 7.0 ever *set* it, so `d.ecos` was always empty and the
   * whole section silently never rendered. (The e2e seeded `eco` by hand,
   * which is exactly why the test passed while the app produced nothing.)
   *
   * Cheap and idempotent: no engine, one position lookup per game, and only
   * for games that lack one. The ECO table is a lazy chunk, so callers that
   * can wait should await `ChessEco.whenReady` first; called before the table
   * has landed this fills nothing and is simply called again later.
   * @returns {number} how many entries it filled
   */
  function fillOpenings() {
    let n = 0;
    for (const g of store.session.library) {
      // v8-0-plan C1: "" is "the table has nothing" (library-page.js), not "not asked yet"
      if (typeof g.eco === "string" || !g.side || typeof g.sans !== "string") continue;
      const sans = g.sans.split(" ").filter(Boolean);
      if (!sans.length) continue;
      let hit = null;
      try { hit = ChessEco.openingForGame(sans.slice(0, 24), g.fen || undefined); } catch (_) { hit = null; }
      if (!hit) continue;
      g.eco = hit.eco;
      // the raw table name, localised at render time — freezing a translation
      // into the record would leave it in whatever language it was imported in
      g.ecoName = hit.name || "";
      n++;
    }
    return n;
  }

  /** `openingForGame`'s name for a stored entry, in the interface language. */
  function libEcoName(eco, name) {
    if (!eco) return "";
    return ChessEco.localName({ eco, name: name || "" }, store.ui.langId) || name || "";
  }

  /**
   * A library entry as a PGN, so the ordinary import path can open it.
   *
   * Deliberately rebuilt from the record rather than kept as text: the record
   * is what survived the import, and a second copy of the same game as a
   * string would be most of what the library weighs (see `entryFrom`'s note
   * on why `sans` is joined rather than an array).
   */
  function libraryPgn(entry) {
    const tag = (k, v) => "[" + k + " \"" + String(v || "?").replace(/["\\\\]/g, "") + "\"]\n";
    let head = tag("Event", entry.event) + tag("Site", "?") + tag("Date", entry.date) +
      tag("Round", "?") + tag("White", entry.white) + tag("Black", entry.black) +
      tag("Result", entry.result || "*");
    if (entry.fen) head += tag("SetUp", "1") + tag("FEN", entry.fen);
    const sans = String(entry.sans || "").split(" ").filter(Boolean);
    const start = entry.fen ? entry.fen.trim().split(/\s+/) : [];
    const first = start[1] === "b" ? "b" : "w";
    const startNo = Number(start[5]) >= 1 ? Math.floor(Number(start[5])) : 1;
    const out = [];
    sans.forEach((san, i) => {
      const moveNo = startNo + Math.floor((i + (first === "b" ? 1 : 0)) / 2);
      // a game that opens with Black to move opens at "1…" — the same rule
      // review.js's moveNumber and library.js's startOf both follow
      if (i === 0 && first === "b") out.push(moveNo + "...");
      else if ((i % 2 === 0) === (first === "w")) out.push(moveNo + ".");
      out.push(san);
    });
    out.push(entry.result || "*");
    return head + "\n" + out.join(" ") + "\n";
  }

  /** The move number of ply `i` in a library entry — startOf's rule, again. */
  function libMoveNo(g, i) {
    const start = g.fen ? g.fen.trim().split(/\s+/) : [];
    const first = start[1] === "b" ? "b" : "w";
    const startNo = Number(start[5]) >= 1 ? Math.floor(Number(start[5])) : 1;
    return startNo + Math.floor((i + (first === "b" ? 1 : 0)) / 2);
  }

  /**
   * The move a motif or move-number filter is about, in this game.
   *
   * The first of this player's moves on the move number the mistakes cluster
   * on, or the first one the motif caught them with. It is both the list's
   * test (a game matches when it has such a move) and — 7.6 §3e — where
   * the game opens — one walk over the arrays, so the move the game opens on
   * is the very move that put it in the list. An opening filter names no
   * move, and neither does no filter: null.
   * @returns {number|null} the index of the move, as in `an.tags`
   */
  function libPickPly(g) {
    const pick = store.ui.libPick;
    if (!pick || (pick.kind !== "motif" && pick.kind !== "peak")) return null;
    const start = g.fen ? g.fen.trim().split(/\s+/) : [];
    const first = start[1] === "b" ? "b" : "w";
    const other = first === "w" ? "b" : "w";
    const tags = g.an && Array.isArray(g.an.tags) ? g.an.tags : [];
    for (let i = 0; i < tags.length; i++) {
      if ((i % 2 === 0 ? first : other) !== g.side) continue;
      if (pick.kind === "motif" && g.motifs && g.motifs[i] === pick.value) return i;
      if (pick.kind === "peak" && (tags[i] === "?" || tags[i] === "??") && libMoveNo(g, i) === pick.value) return i;
    }
    return null;
  }

  /** "2026.09.01 · rival" — the row's headline, localised at render time. */
  function libraryLabel(g) {
    const res = g.outcome ? t(g.outcome === "win" ? "hist.win" : g.outcome === "loss" ? "hist.loss" : "hist.draw")
      : (g.result || "*");
    const me = g.side === "b" ? g.black : g.white;
    const foe = g.side === "b" ? g.white : g.black;
    return tdot(res, foe || t("lib.unknownFoe"), !g.side && me);
  }

  /**
   * The list page (v8-0-plan C1: search, and 对局历史 merged in as 本机) is
   * the chunk's; `opts.src` opens it on one source.
   */
  async function openLibList(pick, opts) {
    // v8-1-plan F3: on the summary while the games load (a diagnosis pick needs the games)
    const c = libDb || (!pick && libEarly) || await libDbReady;
    if (c) c.openList(pick, opts);
  }
  function renderLibList() { const c = libDb || libEarly; if (c) c.renderList(); }
  function closeLibList() { Dlg.close(doc.getElementById("lib-list-modal")); }

  /**
   * Open one library game on the board, with the analysis it already has.
   *
   * The point of the whole feature: 7.0 paid minutes of engine time per game
   * and then had no way to show any of it. `store.session.analysis` is the
   * shape the review page reads, and the library's `an` holds five of its
   * eight fields; `sig` is computed here from the game that just loaded, and
   * `pvs` / `linesAt` are simply absent — every read of those is written
   * `a && a.pvs ? … : null`, so their absence means "no engine line to
   * expand", not a broken page. **No search is started.**
   */
  async function loadFromLibrary(id) {
    const entry = libEntryById(id);
    if (!entry) return;
    // read before the list closes: the filter is what says which move matters
    const ply = libPickPly(entry);
    closeLibList();
    // 7.6 §3d: from 教学 or 做题 this used to refuse with a toast — one the
    // dialog's blurred backdrop covered, so the click simply did nothing, and
    // the daily plan's last step leaves people in exactly that mode. It now
    // does what 「看那局棋」 does: leave the trainer, open the game for review,
    // and put the trainer back as it was if the load is refused.
    const back = leaveTrainer();
    const ok = await loadLibraryEntry(entry);
    if (!ok) { back(); return false; }
    // 7.6 §3e: a game found through 「第 10 回合」 or a motif opens on that
    // move, not at its end — the same one-ply-later rule as 「看那局棋」, so
    // the cursor is on the move the move list marks, not the moment before
    if (ply != null) { setViewIndex(ply + 1); saveGame(); sync(); }
    return true;
  }

  /**
   * The load itself, without the list's own guards.
   *
   * Split out in 7.2 so 「看那局棋」 can reach it: that entry point comes from
   * the puzzle page, which is exactly the mode `loadFromLibrary` refuses —
   * it leaves the trainer first and then loads, so the mode check above would
   * be asking about a mode nobody is in any more.
   */
  async function loadLibraryEntry(entry) {
    if (!entry) return false;
    const ok = await importPgnText(libraryPgn(entry), t("lib.title"),
      { msg: t("dlg.loadLib"), title: t("dlg.loadLibTitle"), ok: t("dlg.loadLibOk") });
    if (!ok) return false;
    // an imported game has no "you" by default; the library knows who you are
    store.session.mode = "pvp";
    if (entry.side === "w" || entry.side === "b") {
      store.session.humanColor = entry.side;
      store.game.flipped = entry.side === "b";
    }
    store.game.recordedId = null;
    invalidateEngine();
    const an = entry.an;
    // a board pass of this very game at least as deep as the entry's (7.6
    // §1c) carries the engine lines too, which the library never stores
    const kept = recallAnalysis();
    if (kept && (!an || (kept.budget || 0) >= (an.budget || LIB_BUDGET))) store.session.analysis = kept;
    else store.session.analysis = an && Array.isArray(an.scalars) && Array.isArray(an.tags) ? {
      sig: game.pgn(),
      scalars: an.scalars,
      tags: an.tags,
      bests: an.bests || [],
      budget: an.budget || LIB_BUDGET,
      acc: { w: an.acc && an.acc.w, b: an.acc && an.acc.b,
        wAcpl: an.acpl && an.acpl.w, bAcpl: an.acpl && an.acpl.b },
    } : null;
    saveSettings();
    saveGame();
    // the game and its review are on the 对局 tab; opened from 记录 the board
    // changed while the panel went on showing the list it came from (7.6 §3e)
    setSideTab("play", { top: true });
    sync();
    toast(tf("lib.loaded", [libraryLabel(entry)]));
    return true;
  }

  /** The diagnosis dialog: what `diagnose()` found, in sentences. */
  function renderDiagnosis() {
    const el = doc.getElementById("lib-diag");
    if (!el) return;
    renderDiagnosisInto(el);
    fitDiagColumn(el);
  }
  function renderDiagnosisInto(el) {
    el.replaceChildren();
    // v8-1-plan T5: the games of the source row (导入的 until the chunk is in)
    const view = libDb ? libDb.diagView() : { games: store.session.library, note: "" };
    const d = Library.diagnose(view.games, LIB_MIN_GAMES);
    const para = (text, cls) => {
      const p = doc.createElement("p");
      p.className = cls || "hint";
      p.textContent = text;
      el.appendChild(p);
    };
    const row = (kText, vText, pick, full) => {
      const r = doc.createElement(pick ? "button" : "div");
      r.className = "stat-row" + (pick ? " stat-row-link" : "");
      if (pick) {
        r.type = "button";
        r.dataset.diagPick = JSON.stringify(pick);
        r.title = t("diag.openThese");
      }
      const k = doc.createElement("span");
      k.className = "stat-k";
      k.textContent = kText;
      // `full` for a name that will not fit the name track: it is cut with an
      // ellipsis there, so the whole of it goes on `title` (7.3 B3). Only the
      // rows carrying data — an opening's name — need it; the fixed labels fit.
      if (full) k.title = kText;
      const v = doc.createElement("span");
      v.className = "stat-v num";
      v.textContent = vText;
      r.append(k, v);
      el.appendChild(r);
    };
    // v7-plan §6.2: 「每一条都必须点到一个可执行的下一步；没有下一步的统计
    // 不写进这一页」。7.0 写了统计，一条下一步都没接上。These three are the
    // rows that name a subset of games, so each one is a door to that subset.
    const pickPara = (text, cls, pick) => {
      const p = doc.createElement(pick ? "button" : "p");
      p.className = (cls || "hint") + (pick ? " hint-link" : "");
      if (pick) { p.type = "button"; p.dataset.diagPick = JSON.stringify(pick); }
      p.textContent = text;
      el.appendChild(p);
    };
    if (view.note) para(view.note);
    if (!d.enough) { para(tf("lib.needMore", [d.need - d.have, d.have, d.need])); return; }
    para(tf("diag.from", [d.games]));
    row(t("diag.record"), tf("diag.wld", [d.outcome.win, d.outcome.loss, d.outcome.draw]));
    if (d.acc != null) row(t("diag.acc"), d.acc + "%");
    const phaseName = {
      opening: tf("diag.phaseOpening", [Library.OPENING_UNTIL]),
      middle: t("diag.phaseMiddle"),
      end: t("diag.phaseEnd"),
    };
    for (const k of ["opening", "middle", "end"]) {
      const p = d.phase[k];
      if (p.acpl == null) continue;
      row(phaseName[k], tdot(tf("diag.acpl", [p.acpl]), tf("diag.badRate", [Math.round((p.badRate || 0) * 1000) / 10])));
    }
    if (charts) charts.drawPhaseChart(el, d, phaseName);
    if (d.weakestPhase) {
      const best = ["opening", "middle", "end"].map((k) => d.phase[k].acpl).filter((n) => n != null);
      para(tf("diag.weakest", [phaseName[d.weakestPhase], d.phase[d.weakestPhase].acpl,
        d.phase[d.weakestPhase].acpl - Math.min(...best)]), "hint warn");
    } else {
      para(t("diag.noWeakest"));
    }
    const peakAxes = charts && charts.drawPeakChart(el, view.games);
    // the chart is not the only place its numbers appear (v7-3-plan §4B)
    if (peakAxes) para(tf("diag.peakRange", [1, peakAxes.last, peakAxes.max]));
    if (d.peak) {
      pickPara(tf("diag.peak", [d.peak.move, d.peak.n]), "hint",
        { kind: "peak", value: d.peak.move, label: tf("diag.pickPeak", [d.peak.move]) });
    }
    if (d.motifs.length) {
      row(t("diag.motifs"), "");
      for (const m of d.motifs.slice(0, 6)) {
        row(t("motif." + m.motif), tf("diag.motifN", [m.n]),
          { kind: "motif", value: m.motif, label: tf("diag.pickMotif", [t("motif." + m.motif)]) });
      }
    }
    if (d.ecos.length) {
      row(t("diag.ecos"), "");
      if (charts) charts.drawEcoChart(el, d.ecos);
      for (const e of d.ecos.slice(0, 6)) {
        const name = libEcoName(e.eco, e.name);
        row(e.eco + (name ? " " + name : ""),
          tf("diag.ecoRow", [e.n, Math.round((e.score || 0) * 100)]),
          { kind: "eco", value: e.eco, label: tf("diag.pickEco", [e.eco + (name ? " " + name : "")]) },
          true);
      }
    }
  }

  /**
   * v8-0-plan §5: one value column as wide as the widest value in it, up to
   * two thirds of the dialog — measured, because the values are sentences
   * whose length depends on the language and the numbers.
   */
  function fitDiagColumn(el) {
    el.style.removeProperty("--stat-v-w");
    const vs = [...el.querySelectorAll(".stat-v")];
    if (!vs.length || !el.clientWidth) return;
    for (const v of vs) v.style.whiteSpace = "nowrap";
    // scrollWidth is rounded; the extra pixel keeps a 152.4px value on one line
    const need = Math.max(...vs.map((v) => v.scrollWidth)) + 1;
    for (const v of vs) v.style.removeProperty("white-space");
    const cap = Math.floor(el.clientWidth * 2 / 3);
    el.style.setProperty("--stat-v-w", Math.min(need, cap) + "px");
    // a narrow window can cut a fixed label too; it keeps itself on title
    for (const k of el.querySelectorAll(".stat-k")) {
      if (k.scrollWidth > k.clientWidth && !k.title) k.title = k.textContent;
    }
  }

  function openDiagnosis() {
    // 7.1: the 开局战绩 section needs an `eco` on the records, which 7.0 never
    // wrote. Fill what is missing before drawing, and draw again when the ECO
    // chunk lands — a library analysed under 7.0 gets its openings without
    // anyone re-running the engine over it.
    if (!ChessEco.loaded()) ChessEco.whenReady(() => { if (fillOpenings()) saveLibrary(); renderDiagnosis(); });
    else if (fillOpenings()) saveLibrary();
    // open FIRST: the charts size themselves from their laid-out width, and a
    // canvas inside a hidden dialog measures zero
    Dlg.open(doc.getElementById("lib-modal"));
    renderDiagnosis();
    // opened before the chunk landed: the charts join the sentences then
    if (!charts) libDbReady.then(() => { if (charts) renderDiagnosis(); });
  }
  function closeDiagnosis() { Dlg.close(doc.getElementById("lib-modal")); }

  return {
    LIB_MIN_GAMES, fillOpenings,
    adoptBoardAnalysis, closeDiagnosis, closeLibList, deepenLibraryGame, importPgnToLibrary,
    libEcoName, libNamesFrom, loadFromLibrary, loadLibraryEntry, openDiagnosis, openLibList,
    reclaimLibrary, renderLibList, renderLibrary, runLibraryPass, saveLibrary,
    // v8-0-plan C1: the query API (library-query.js), over imported + 本机
    // games, once the chunk is in — the seam C3's explorer reads
    ready: () => libDbReady,
    syncLocal: () => { if (libDb) libDb.syncLocal(); },
    query: (q) => libDbReady.then((c) => (c ? c.query(q) : [])),
    gamesWithPosition: (fen) => libDbReady.then((c) => (c ? c.gamesWithPosition(fen) : null)),
  };
}
