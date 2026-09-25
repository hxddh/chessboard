/**
 * 棋谱库的调度、存档与两块界面。
 *
 * The model is library.js and has been since 7.0; this is everything the app
 * wraps around it — the background pass, the on-disk record, the 记录 pane's
 * section, the list dialog and the diagnosis dialog with its three charts.
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

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createLibraryUI(d) {
  const {
    doc, store, Persist, game, t, tf, toast, sync,
    SCAN_BUDGET, evalScalar, importPgnText, invalidateEngine, judgeColours,
    leaveTrainer, plyLosses, sansOf, saveGame, saveMines, saveProgress, savePuzzleState,
    saveSettings, setSideTab, setViewIndex, stopLiveAnalysis, withMotifs,
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

  function loadLibrary() {
    const s = Persist.read("library").value;
    if (!s) return { games: [], names: [] };
    const games = s.games.filter((g) => g && g.id && typeof g.sans === "string" && g.plies > 0);
    for (const g of games) rescoreLosses(g);
    return { games, names: Array.isArray(s.names) ? s.names.filter((n) => typeof n === "string") : [] };
  }

  /**
   * Recompute a stored game's per-ply losses from the scalars beside them.
   *
   * 7.0 wrote this array unclamped (see analyseLibraryGame), so a library
   * analysed under 7.0 carries plies charged five figures of centipawns, and
   * the diagnosis built from it says 残局 whatever the player actually does
   * there. Capping the stored number at 1000 would not undo it: mate-in-5 to
   * mate-in-9 is 0 once both ends are in the window and 400 once they are not.
   * The scalars are in the record, so the honest repair is to run lossOf over
   * them again rather than to salvage the arithmetic. Idempotent — a record
   * written by this version comes out of it unchanged — which is why it needs
   * no version flag and can simply run on every load.
   */
  function rescoreLosses(g) {
    const an = g && g.an;
    if (!an || !Array.isArray(an.scalars) || !Array.isArray(an.losses)) return;
    const sc = an.scalars;
    if (sc.length !== an.losses.length + 1) return; // not a shape we wrote
    // side to move at ply 0, straight off the stored FEN — no board needed,
    // and this runs over the whole library on every boot
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
  function saveLibrary() {
    Persist.setJson("library", { v: 1, games: store.session.library, names: store.session.libNames });
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

  // a file being read (7.5: that is no longer instant); a second import
  // meanwhile is turned away rather than interleaved with it
  let importing = false;

  /**
   * Take every game in a PGN file into the library.
   *
   * Deliberately not the same path as 导入棋谱: that one asks which single
   * game you meant, because it is about to put one on the board. Here the
   * whole file is the point.
   */
  async function importPgnToLibrary(text, label) {
    const text0 = (text || "").trim();
    if (!text0) { toast(t("msg.import.empty"), "fix"); return; }
    if (store.session.libRun || store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    if (importing) return;
    let chunks;
    try { chunks = ChessPgnParser.splitGames(text0); }
    catch (_) { chunks = ChessPgn.splitGames(text0); }
    // 7.5: read game by game, handing the thread back every ~16 ms — a big
    // archive used to freeze the window for seconds (see parseGamesAsync)
    let games;
    importing = true;
    try { games = await ChessPgnParser.parseGamesAsync(chunks); }
    finally { importing = false; }
    // a pass may have started while the file was being read
    if (store.session.libRun || store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    const now = Date.now();
    const fresh = [];
    for (const parsed of games) {
      if (!parsed) continue;
      // mainline SAN only: a game's variations are the annotator's opinion,
      // and what this library measures is what the player actually played
      const sans = [];
      for (let n = parsed.root; n && n.children.length; n = n.children[0]) sans.push(n.children[0].san);
      if (!sans.length) continue;
      fresh.push(Library.entryFrom(parsed, sans, store.session.libNames, now));
    }
    if (!fresh.length) { toast(t("msg.import.badPgn"), "fault"); return; }
    const r = Library.addGames(store.session.library, fresh);
    store.session.library = r.list;
    saveLibrary();
    renderLibrary();
    if (!r.added) toast(tf("lib.addedNone", [r.dup]), "fix");
    else toast(tf("lib.added", [r.added, r.dup]) + (label ? " · " + label : ""));
    if (r.dropped.length) toast(tf("lib.dropped", [Library.MAX_GAMES, r.dropped.length]), "fix");
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
          try { e = await ChessEngine.analyze(fens[i], budget, {}); } catch (_) { e = null; }
        }
        if (evalScalar(e) == null) { run.failed = true; return null; }
        scalars[i] = evalScalar(e);
        if (e && typeof e.best === "string" && e.best.length >= 4) bests[i] = e.best;
      }
      run.ply = i + 1;
      run.plies = fens.length;
      renderLibrary();
    }
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
      await stopLiveAnalysis();
      r = await analyseLibraryGame(entry, run, LIB_DEEP_BUDGET);
    } finally {
      store.session.libRun = null;
      renderLibrary();
      renderLibList();
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

  async function runLibraryPass() {
    if (store.session.libRun) { store.session.libRun.abort = true; return; }
    if (!ChessEngine) { toast(t("msg.analysis.noGame"), "fault"); return; }
    if (store.session.analyzing) { toast(t("lib.busy"), "fix"); return; }
    // The run token goes up BEFORE the first await. It used to go up after
    // `stopLiveAnalysis()`, and two clicks inside that await both found
    // `libRun` empty and started two passes over the same queue.
    const run = { abort: false, done: 0, mined: 0, total: Library.pending(store.session.library).length, ply: 0, plies: 0 };
    store.session.libRun = run;
    renderLibrary();
    try {
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
          Host.notify({ id: "chess.library", title: t("ntf.libraryTitle"),
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
      if (run.failed) toast(t("lib.passCut"), "fix");
      if (done && mined) toast(tf("lib.minedDone", [done, mined]));
      if (done && !store.ui.appForeground) {
        Host.notify({ id: "chess.library", title: t("ntf.libraryTitle"),
          body: tf("ntf.libraryDone", [done]) + (mined ? " · " + tf("msg.mined", [mined]) : "") });
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
      if (p.textContent !== it.text) p.textContent = it.text;
    });
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
    if (meta) { meta.hidden = !list.length; meta.textContent = tf("lib.count", [list.length]); }
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
    if (!list.length) {
      putLines(body, [{ text: t("lib.empty"), cls: "hint" }]);
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
      row.children[0].textContent = tf("lib.claimed", [claimed]);
      row.children[1].textContent = [tf("lib.analysed", [analysed.length]), queued ? tf("lib.queued", [queued]) : ""]
        .filter(Boolean).join(" · ");
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
      an.textContent = store.session.libRun ? t("lib.pause")
        : queued ? tf("lib.analyseEta", [queued, libEta(queuedGames)]) : tf("lib.analyse", [queued]);
    }
    const dg = doc.getElementById("lib-diagnose");
    if (dg) dg.hidden = analysed.length < LIB_MIN_GAMES;
    const op = doc.getElementById("lib-open");
    if (op) {
      op.hidden = !list.length;
      op.textContent = tf("lib.all", [list.length]);
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
      if (g.eco || !g.side || typeof g.sans !== "string") continue;
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

  /** How many of this player's own plies in a game were `?` or `??`. */
  function libBadCount(g) {
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

  /** The move number of ply `i` in a library entry — startOf's rule, again. */
  function libMoveNo(g, i) {
    const start = g.fen ? g.fen.trim().split(/\s+/) : [];
    const first = start[1] === "b" ? "b" : "w";
    const startNo = Number(start[5]) >= 1 ? Math.floor(Number(start[5])) : 1;
    return startNo + Math.floor((i + (first === "b" ? 1 : 0)) / 2);
  }

  /**
   * Does this game answer the filter the diagnosis set?
   *
   * The three kinds mirror the three things `diagnose()` reports that name a
   * subset of games: a motif that keeps catching you, an opening, and the
   * move number your mistakes cluster on. Each is answered from the same
   * arrays `foldGame` counted, so the list can never disagree with the number
   * that sent the player to it.
   */
  function libPickMatches(g) {
    const pick = store.ui.libPick;
    if (!pick) return true;
    if (pick.kind === "eco") return g.eco === pick.value;
    return libPickPly(g) != null;
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

  /** Which slice of the library the list is showing. */
  function libMatches(g) {
    const f = store.ui.libFilter;
    if (f.result !== "all" && g.outcome !== f.result) return false;
    if (f.color !== "all" && g.side !== f.color) return false;
    return libPickMatches(g);
  }

  /** "2026.09.01 · rival" — the row's headline, localised at render time. */
  function libraryLabel(g) {
    const res = g.outcome ? t(g.outcome === "win" ? "hist.win" : g.outcome === "loss" ? "hist.loss" : "hist.draw")
      : (g.result || "*");
    const me = g.side === "b" ? g.black : g.white;
    const foe = g.side === "b" ? g.white : g.black;
    return res + " · " + (foe || t("lib.unknownFoe")) + (g.side ? "" : " · " + (me || ""));
  }

  /** The second line: when, how well, how many mistakes, which opening. */
  function librarySub(g) {
    const bits = [];
    if (g.date && g.date !== "?") bits.push(g.date);
    const acc = g.an && g.an.acc && g.side ? g.an.acc[g.side] : null;
    if (Number.isFinite(acc)) bits.push(tf("lib.rowAcc", [Math.round(acc * 10) / 10]));
    if (g.an) bits.push(tf("lib.rowBad", [libBadCount(g)]));
    else bits.push(t(g.unplayable ? "lib.rowUnplayable" : "lib.rowPending"));
    if (g.eco) bits.push(g.eco + " " + libEcoName(g.eco, g.ecoName));
    return bits.join(" · ");
  }

  function libraryRow(g) {
    const row = doc.createElement("div");
    row.className = "hist-row";
    const load = doc.createElement("button");
    load.type = "button";
    load.className = "pick-item";
    load.dataset.lib = g.id;
    load.textContent = libraryLabel(g);
    const sub = doc.createElement("span");
    sub.className = "pick-sub";
    sub.textContent = librarySub(g);
    load.appendChild(sub);
    row.appendChild(load);
    // 「再深一遍」 only where there is something to deepen: an analysed game
    // whose pass was shallower than LIB_DEEP_BUDGET. An already-deep game
    // does not get a greyed button, it gets none (P3).
    if (entryDeepenable(g)) {
      const deep = doc.createElement("button");
      deep.type = "button";
      deep.className = "row-act";
      deep.dataset.libDeep = g.id;
      deep.textContent = t("lib.deepen");
      deep.title = t("tip.libDeepen");
      row.appendChild(deep);
    }
    return row;
  }

  /** one game's half of Library.deepenable — the row button reads this */
  function entryDeepenable(g) {
    return !!g && !!g.an && !g.unplayable && (Number(g.an.budget) || 0) < LIB_DEEP_BUDGET;
  }

  /**
   * The list dialog.
   *
   * Rows carry the game's id — not its index into the filtered array (the
   * history list learned that the hard way: re-indexing a filtered list makes
   * "open this game" open a different one whenever a filter is on), and not
   * its index into `store.session.library` either (7.4 D1). `addGames` re-sorts
   * the library newest first on every import, so every index moves, while
   * `reconcile` keeps a row whose signature has not changed — and the index
   * is not in the signature. An old row then pointed at whichever game had
   * moved into its slot: 「打开」 opened another game, and 「再深一遍」
   * rewrote another game's analysis and drills. An id does not move.
   */
  function renderLibList() {
    const list = doc.getElementById("lib-list");
    if (!list) return;
    const all = store.session.library;
    const rows = all.filter((g) => libMatches(g)).map((g) => ({ g }));
    if (store.ui.libFilter.sort === "acc") {
      // worst first: this list exists to find the games worth reopening, and
      // an unanalysed game has no accuracy to rank, so it goes last
      rows.sort((a, b) => {
        const av = a.g.an && a.g.an.acc && a.g.side ? a.g.an.acc[a.g.side] : Infinity;
        const bv = b.g.an && b.g.an.acc && b.g.side ? b.g.an.acc[b.g.side] : Infinity;
        return (av == null ? Infinity : av) - (bv == null ? Infinity : bv);
      });
    } else {
      rows.sort((a, b) => (b.g.t || 0) - (a.g.t || 0));
    }
    reconcile(list, rows,
      ({ g }) => g.id,
      // the budget is in the signature: without it a game that just got
      // deepened would keep the 「再深一遍」 button it no longer needs — and so
      // is the language, or the rows keep the old one's words after a switch
      ({ g }) => [store.ui.langId, g.outcome, g.side, g.eco, g.an ? "a" + (g.an.budget || 0) : "-", g.unplayable ? "u" : "-"].join("|"),
      ({ g }) => libraryRow(g));
    if (!rows.length) {
      const p = doc.createElement("p");
      p.className = "hint";
      p.textContent = t("hist.noneMatch");
      list.appendChild(p);
    }
    const count = doc.getElementById("lib-list-count");
    if (count) {
      const filtered = store.ui.libFilter.result !== "all" || store.ui.libFilter.color !== "all" || store.ui.libPick;
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
    doc.querySelectorAll("#lib-result-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.lres === store.ui.libFilter.result);
    });
    doc.querySelectorAll("#lib-color-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.lcol === store.ui.libFilter.color);
    });
    doc.querySelectorAll("#lib-sort-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.lsort === store.ui.libFilter.sort);
    });
  }

  function openLibList(pick) {
    store.ui.libPick = pick || null;
    // an opening name needs the ECO chunk; ask for it and redraw when it lands
    if (!ChessEco.loaded()) ChessEco.whenReady(() => { if (fillOpenings()) saveLibrary(); renderLibList(); });
    else if (fillOpenings()) saveLibrary();
    renderLibList();
    Dlg.open(doc.getElementById("lib-list-modal"));
  }
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
    store.session.analysis = an && Array.isArray(an.scalars) && Array.isArray(an.tags) ? {
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


  /**
   * The diagnosis charts (v7-1-plan §2.1).
   *
   * Three shapes for the three things the page says that a number alone does
   * not carry: which phase is the weak one and by how much, where in the game
   * things go wrong, and which openings actually score. Drawn in the same
   * idiom as the two sparklines above — device-pixel sizing, colours read
   * from the document so a theme change is answered, judgement colours from
   * `judgeColours()` so the weak bar is the same red the move list uses.
   *
   * Created by this function rather than sitting in the markup: a chart with
   * no data must not exist at all (the P3 rule this page has followed since
   * 7.0), and "does not exist" is easier to be sure of than "is hidden".
   */
  function diagCanvas(parent, h, label, kind) {
    const cv = doc.createElement("canvas");
    cv.className = "diag-chart";
    // which shape this is, for anyone reading the canvas back: the phase and
    // peak charts stand bars on a shared floor, the eco chart lays them on
    // their side. A pixel reader cannot tell those apart from the ink alone,
    // and it has to — the floor is what tells a bar from a glyph (7.3 §4B).
    if (kind) cv.dataset.chart = kind;
    cv.style.height = h + "px";
    cv.setAttribute("role", "img");
    cv.setAttribute("aria-label", label);
    parent.appendChild(cv);
    const dpr = window.devicePixelRatio || 1;
    const W = Math.max(1, Math.round((cv.clientWidth || parent.clientWidth || 320) * dpr));
    const H = Math.max(1, Math.round(h * dpr));
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext("2d");
    ctx.clearRect(0, 0, W, H);
    const css = getComputedStyle(doc.documentElement);
    return { ctx, W, H, dpr,
      muted: css.getPropertyValue("--muted").trim() || "#999",
      accent: css.getPropertyValue("--accent").trim() || "#e8c39e",
      text: css.getPropertyValue("--text").trim() || "#ddd" };
  }

/**
   * The smallest a bar is allowed to be, in CSS pixels.
   *
   * 7.3 §4B. Measured on a real library: 开局 8、中局 8、残局 93. On a linear
   * scale in a 92px canvas the first two came out at 1px — a hairline, which
   * is what a bar of zero would also look like. 「小」 and 「没有」 are two
   * different findings about a player and the chart drew them the same.
   * So: anything greater than zero is at least this tall, and zero draws
   * nothing at all. The distortion is bounded and in the honest direction —
   * it can only make a small bar look bigger, never a big one look smaller.
   */
  const MIN_BAR = 4;

  /** The line a bar stands on, so "short" reads as short and not as floating. */
  function baseline(c, y, x0, x1) {
    c.ctx.fillStyle = c.muted;
    c.ctx.globalAlpha = 0.5;
    c.ctx.fillRect(x0, y, x1 - x0, Math.max(1, Math.round(c.dpr)));
    c.ctx.globalAlpha = 1;
  }

  /** Per-phase centipawn loss, with the weak one in the judgement colour. */
  function drawPhaseChart(parent, d, phaseName) {
    const rows = ["opening", "middle", "end"]
      .map((k) => ({ k, acpl: d.phase[k].acpl }))
      .filter((r) => r.acpl != null);
    if (rows.length < 2) return; // one bar is not a comparison
    const c = diagCanvas(parent, 92, t("diag.chartPhase"), "phase");
    const pad = 6 * c.dpr, gap = 10 * c.dpr, label = 16 * c.dpr;
    // the scale's top is a real number off this page — the largest of the
    // three — so the tick can be read against the rows above it. 1.15 of it
    // is headroom for the value printed over the tallest bar, not scale.
    const top = Math.max(...rows.map((r) => r.acpl)) || 1;
    const max = top * 1.15;
    const bw = (c.W - 2 * pad - gap * (rows.length - 1)) / rows.length;
    const bad = judgeColours().bad;
    const floorY = c.H - pad - label;
    const plot = c.H - 2 * pad - 2 * label;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    // the tick: a dashed line at the top of the scale, labelled with the value
    // it stands for. Without it the bars are three heights and no unit.
    const tickY = floorY - (top / max) * plot;
    c.ctx.strokeStyle = c.muted;
    c.ctx.globalAlpha = 0.45;
    c.ctx.setLineDash([3 * c.dpr, 3 * c.dpr]);
    c.ctx.lineWidth = Math.max(1, Math.round(c.dpr));
    c.ctx.beginPath();
    c.ctx.moveTo(pad, tickY);
    c.ctx.lineTo(c.W - pad, tickY);
    c.ctx.stroke();
    c.ctx.setLineDash([]);
    c.ctx.globalAlpha = 1;
    c.ctx.fillStyle = c.muted;
    c.ctx.textAlign = "left";
    c.ctx.fillText(tf("diag.chartTop", [top]), pad, tickY - 3 * c.dpr);
    c.ctx.textAlign = "center";
    rows.forEach((r, i) => {
      const x = pad + i * (bw + gap);
      const hgt = r.acpl > 0
        ? Math.max(MIN_BAR * c.dpr, (r.acpl / max) * plot)
        : 0;
      if (hgt) {
        c.ctx.fillStyle = r.k === d.weakestPhase ? bad : c.accent;
        c.ctx.fillRect(x, floorY - hgt, bw, hgt);
      }
      c.ctx.fillStyle = c.text;
      c.ctx.fillText(String(r.acpl), x + bw / 2, floorY - hgt - 3 * c.dpr);
      c.ctx.fillStyle = c.muted;
      c.ctx.fillText(phaseName[r.k], x + bw / 2, c.H - pad);
    });
    baseline(c, floorY, pad, c.W - pad);
  }

  /**
   * Where the mistakes are, by move number.
   *
   * The page already says "第 24 回合，N 局栽在这里". What it cannot say in a
   * sentence is whether that is a spike or a plateau — a clock problem and a
   * knowledge problem look completely different here and identical there.
   */
  function drawPeakChart(parent, list) {
    const counts = new Map();
    let worst = 0;
    for (const g of list) {
      // each game's own claimed chair — the same games `foldGame` counted,
      // so the spike here and the sentence under it cannot disagree
      if (!g.an || !g.side) continue;
      const tags = Array.isArray(g.an.tags) ? g.an.tags : [];
      const start = g.fen ? g.fen.trim().split(/\s+/) : [];
      const first = start[1] === "b" ? "b" : "w";
      const other = first === "w" ? "b" : "w";
      for (let i = 0; i < tags.length; i++) {
        if ((i % 2 === 0 ? first : other) !== g.side) continue;
        if (tags[i] !== "?" && tags[i] !== "??") continue;
        const mv = libMoveNo(g, i);
        counts.set(mv, (counts.get(mv) || 0) + 1);
        if (mv > worst) worst = mv;
      }
    }
    if (counts.size < 3) return null;
    const last = Math.max(10, Math.min(worst, 60));
    const c = diagCanvas(parent, 80, t("diag.chartPeak"), "peak");
    const pad = 6 * c.dpr, label = 14 * c.dpr;
    const max = Math.max(...counts.values()) || 1;
    const bw = (c.W - 2 * pad) / last;
    const floorY = c.H - pad - label;
    const plot = c.H - 2 * pad - label;
    c.ctx.fillStyle = c.accent;
    for (let mv = 1; mv <= last; mv++) {
      const n = counts.get(mv) || 0;
      if (!n) continue;
      // 7.3 §4B: three hairlines floating in a field of white was the whole
      // chart. MIN_BAR gives the shortest of them a body; the baseline below
      // gives all of them a floor to stand on.
      const hgt = Math.max(MIN_BAR * c.dpr, (n / max) * plot);
      c.ctx.fillRect(pad + (mv - 1) * bw, floorY - hgt, Math.max(1, bw - c.dpr), hgt);
    }
    baseline(c, floorY, pad, c.W - pad);
    c.ctx.fillStyle = c.muted;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    c.ctx.textAlign = "left";
    c.ctx.fillText("1", pad, c.H - pad);
    c.ctx.textAlign = "right";
    c.ctx.fillText(String(last), c.W - pad, c.H - pad);
    // what the axes mean, for the caller to print as words: a chart must not
    // be the only place a number appears (v7-3-plan §4B)
    return { last, max };
  }

  /**
   * Win / draw / loss per opening, as one stacked bar each.
   *
   * 7.3 §4B: the bars were right and unreadable. A 100% record and a 0% record
   * each fill the whole width, so two openings with opposite results drew as
   * two identical bars in different colours — and nothing on the canvas said
   * which colour meant which. A stacked bar without a key is a coloured
   * rectangle. So the chart now carries its own key, in words, above the bars.
   */
  function drawEcoChart(parent, ecos) {
    const rows = ecos.slice(0, 6).filter((e) => e.n > 0);
    if (rows.length < 2) return;
    const LEGEND = 16;
    const c = diagCanvas(parent, 18 * rows.length + 12 + LEGEND, t("diag.chartEco"), "eco");
    const pad = 4 * c.dpr;
    const leg = LEGEND * c.dpr;
    const rh = (c.H - 2 * pad - leg) / rows.length;
    const cols = judgeColours();
    const labelW = 46 * c.dpr;
    c.ctx.font = (10 * c.dpr) + "px " + (getComputedStyle(doc.documentElement)
      .getPropertyValue("--font-num").trim() || "monospace");
    c.ctx.textAlign = "left";
    // the key: swatch, word, swatch, word, swatch, word
    {
      const sw = 8 * c.dpr, gap = 4 * c.dpr, sp = 10 * c.dpr;
      let x = pad;
      const y = pad + leg * 0.35;
      for (const [col, word] of [[c.accent, t("diag.legendWin")], [c.muted, t("diag.legendDraw")],
                                 [cols.bad, t("diag.legendLoss")]]) {
        c.ctx.fillStyle = col;
        c.ctx.fillRect(x, y - sw * 0.75, sw, sw);
        x += sw + gap;
        c.ctx.fillStyle = c.muted;
        c.ctx.fillText(word, x, y);
        x += c.ctx.measureText(word).width + sp;
      }
    }
    rows.forEach((e, i) => {
      const y = pad + leg + i * rh;
      c.ctx.fillStyle = c.muted;
      c.ctx.fillText(e.eco, pad, y + rh * 0.7);
      const x0 = pad + labelW;
      const full = c.W - pad - x0;
      // the track, so the bar's full extent is visible even when one segment
      // is the whole of it — 「全胜」 and 「全负」 are then the same shape in
      // two colours, which is the truth, rather than two shapes
      c.ctx.fillStyle = c.muted;
      c.ctx.globalAlpha = 0.14;
      c.ctx.fillRect(x0, y + rh * 0.2, full, rh * 0.6);
      c.ctx.globalAlpha = 1;
      let x = x0;
      const seg = [[e.win, c.accent], [e.draw, c.muted], [e.loss, cols.bad]];
      for (const [n, col] of seg) {
        if (!n) continue;
        const w = (n / e.n) * full;
        c.ctx.fillStyle = col;
        c.ctx.fillRect(x, y + rh * 0.2, w, rh * 0.6);
        x += w;
      }
    });
  }

  /** The diagnosis dialog: what `diagnose()` found, in sentences. */
  function renderDiagnosis() {
    const el = doc.getElementById("lib-diag");
    if (!el) return;
    el.replaceChildren();
    const d = Library.diagnose(store.session.library, LIB_MIN_GAMES);
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
      row(phaseName[k], tf("diag.acpl", [p.acpl]) + " · " +
        tf("diag.badRate", [Math.round((p.badRate || 0) * 1000) / 10]));
    }
    drawPhaseChart(el, d, phaseName);
    if (d.weakestPhase) {
      const best = ["opening", "middle", "end"].map((k) => d.phase[k].acpl).filter((n) => n != null);
      para(tf("diag.weakest", [phaseName[d.weakestPhase], d.phase[d.weakestPhase].acpl,
        d.phase[d.weakestPhase].acpl - Math.min(...best)]), "hint warn");
    } else {
      para(t("diag.noWeakest"));
    }
    const peakAxes = drawPeakChart(el, store.session.library);
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
      drawEcoChart(el, d.ecos);
      for (const e of d.ecos.slice(0, 6)) {
        const name = libEcoName(e.eco, e.name);
        row(e.eco + (name ? " " + name : ""),
          tf("diag.ecoRow", [e.n, Math.round((e.score || 0) * 100)]),
          { kind: "eco", value: e.eco, label: tf("diag.pickEco", [e.eco + (name ? " " + name : "")]) },
          true);
      }
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
  }
  function closeDiagnosis() { Dlg.close(doc.getElementById("lib-modal")); }

  return {
    LIB_MIN_GAMES, fillOpenings,
    closeDiagnosis, closeLibList, deepenLibraryGame, importPgnToLibrary,
    libNamesFrom, loadFromLibrary, loadLibraryEntry, openDiagnosis, openLibList,
    reclaimLibrary, renderLibList, renderLibrary, runLibraryPass, saveLibrary,
  };
}
