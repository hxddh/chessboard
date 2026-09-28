/**
 * 复盘分析：一局棋的全盘分析、结果的保存与取回、精准度，和分析后自动收错题。
 *
 * v8-0-plan F4 (M3): the orchestration around review-pass.js, moved out of
 * app.js — the analysis the board is standing on (analysisFor, memoised per
 * commit), 分析 / 精析 (analyzeGame: the pass, the marks, the grades, the
 * record, the hand-off to the library and to the mistakes book), the
 * analyses kept across a reload (analysis-store.js glue), the per-ply losses
 * and accuracy, and the three analysis buttons. Moved, not rewritten: the
 * bodies are the ones app.js had. The mistakes book and the statistics stay
 * app.js's; what this needs of them arrives in the bag.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createAnalysis()`, createLibraryUI's shape; nothing here reaches back into
 * app.js. Two of its callees are made after it (the review panel and the
 * library), so those two arrive as thin forwarders. The pure modules are
 * imported, not passed, because they are the same objects app.js imports
 * (patching ChessEngine through the test seam patches this file's copy too).
 * @module review/analysis
 */
import { Chess } from "../chess.js";
import { ChessAnalysisStore } from "../analysis-store.js";
import { ChessEco } from "../eco-lookup.js";
import { ChessEngine } from "../engine.js";
import { ChessHost } from "../host.js";
import { ChessMistakes } from "../mistakes.js";
import { ChessProgress } from "../progress.js";
import { factsOf } from "../progress-metrics.js";
import { ChessReview } from "../review.js";
import { ChessReviewGrade as Grade } from "../review-grade.js";
import { ChessReviewPass } from "../review-pass.js";
import { motifOf } from "../motif.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createAnalysis(d) {
  const {
    store, game, Persist, t, tf, toast, sync, sanHistory, baseGame, bootEngine,
    setAnalyzeUI, stopLiveAnalysis, LibraryUI, boardDrillSource, saveMines, savePuzzleState, saveProgress,
    naturalGameOver, ruleTerminated, loadStats, saveStats, renderStats,
  } = d;
  const Host = ChessHost;
  const Mistakes = ChessMistakes;
  const Progress = ChessProgress;
  const Review = ChessReview;

  // --- review analysis: full-strength eval per position → curve + move tags ---

  /** White-perspective centipawns; mates mapped to ±(10000 − plies·10). */
  function evalScalar(e) {
    if (!e) return null;
    const sign = e.turn === "w" ? 1 : -1;
    if (e.mate != null) {
      const mag = 10000 - Math.min(Math.abs(e.mate), 50) * 10;
      return e.mate > 0 ? sign * mag : -sign * mag;
    }
    if (e.cp != null) return sign * e.cp;
    return null;
  }

  /**
   * The analysis, if it still belongs to the game on the board.
   *
   * Memoised for one sync-and-paint cycle, because the check is not cheap and
   * this sits in the render path. `analysis.sig` is a PGN, and on an 80-move
   * game `game.pgn()` costs ~3.3ms — a fifth of a 60fps frame. 1.22 put the
   * best-move arrow in the board model, which is rebuilt on EVERY draw()
   * including every animation frame, so a 12-frame replay slide was spending
   * ~40ms serialising the same PGN twelve times.
   *
   * The memo is exact rather than merely fast: it is dropped whenever the game
   * commits, so a frame can never be looking at an analysis of a different
   * position. Up to 1.25 it was dropped at the top of sync() instead, which
   * was correct only for as long as "sync() runs after every state change"
   * stayed true — an invariant held by hand at 65 call sites.
   */
  function analysisFor() {
    // Keyed on the analysis object too, so replacing it invalidates the memo
    // without every one of the seven assignment sites having to remember. The
    // game commit covers the other direction: the game changing underneath an
    // unchanged analysis.
    if (store.session._analysisTick && store.session._analysisTick.a === store.session.analysis) return store.session._analysisTick.v;
    store.session._analysisTick = { a: store.session.analysis, v: store.session.analysis && store.session.analysis.sig === game.pgn() ? store.session.analysis : null };
    return store.session._analysisTick.v;
  }

  /**
   * What 分析 spends per position, in ms. 精析 spends 400.
   *
   * 6.1 set this to 120 and measured the two-pass agreement there; 7.0 swapped
   * Stockfish 18 for 19 lite-single, which is a different engine and therefore
   * a different noise floor, so the number was re-measured — three independent
   * 28-game passes at 120 / 200 / 400 ms (docs/measured.json winPctNoise).
   *
   * Read the runs PAIRED, each against itself, because the run-to-run spread
   * is as wide as the effect:
   *
   *            ?  120→200    ??  120→200
   *   run A    60 → 73 %     86 → 88 %
   *   run B    64 → 73 %     82 → 84 %
   *   run C    58 → 64 %     80 → 82 %
   *
   * Three out of three improve on both marks, which is why 200 is worth
   * 1.67× the time: `?` is the mark a player reads on a single move and acts
   * on, and at 120 ms it agreed with itself about three times in five.
   * `?!` improves too (42 → 47 % pooled) and is still nowhere near the 60 %
   * line §5 set, which is why 7.0 stopped showing it by default rather than
   * trying to buy it with depth — 400 ms does not rescue it either.
   */
  const SCAN_BUDGET = 200;

  async function analyzeGame(movetime) {
    if (store.session.analyzing || !ChessEngine) return;
    await stopLiveAnalysis();
    const perMove = movetime || SCAN_BUDGET;
    const h = sanHistory();
    if (!h.length) { toast(t("msg.analysis.noGame"), "fix"); return; }
    const sig = game.pgn();
    const g = baseGame();
    const fens = [g.fen()];
    for (const san of h) { g.move(san); fens.push(g.fen()); }
    store.session.analyzing = true;
    store.session.analyzeAbort = false;
    store.session.analyzeProgress = "0/" + fens.length;
    setAnalyzeUI();
    // v8-0-plan B2: the pass itself — every position at the budget, then the
    // moves that matter again, deeper — is review-pass.js, so the measurement
    // of its reproducibility runs this very code
    const p = await ChessReviewPass.runPass({ fens, sans: h, budget: perMove, lines: store.ui.multipv, evalScalar,
      analyze: (fen, b, o) => ChessEngine.analyze(fen, b, o),
      halt: () => (game.pgn() !== sig ? "gone" : store.session.analyzeAbort ? "abort" : null),
      progress: (d, n) => { store.session.analyzeProgress = d + "/" + n; setAnalyzeUI(); } });
    const { scalars, pvs, bests, linesAt, depths } = p;
    if (p.halted === "gone") { store.session.analyzing = false; store.session.analyzeProgress = ""; setAnalyzeUI(); return; }
    if (p.halted) {
      store.session.analyzing = false; store.session.analyzeAbort = false; store.session.analyzeProgress = "";
      // keep whatever was already measured — a partial curve still helps
      if (p.at > 1) {
        store.session.analysis = { sig, scalars, tags: h.map(() => null), pvs, bests };
        toast(t("msg.analysis.keptPrefix") + (p.at - 1) + t("msg.analysis.keptSuffix"));
      } else toast(t("msg.analysis.stopped"));
      sync();
      return;
    }
    // centipawn loss from the mover's perspective — the mover of ply i is the
    // side to move in fens[i] (FEN-start games may begin with black)
    const tags = h.map((_, i) => {
      const a = scalars[i], b = scalars[i + 1];
      if (a == null || b == null) return null;
      const mover = fens[i].split(" ")[1] === "w" ? "w" : "b";
      // 6.0: marks by win-percentage drop, not centipawns. Measured on the
      // same four games (docs/measured.json winPctNoise): two 120 ms scans
      // agree on ?! 67 % of the time against 32 % for the centipawn cut-off,
      // because a centipawn is worth much less at +5 than at 0 and the
      // win-percentage curve already knows that. One source for the
      // thresholds: the move list, the curve markers and the arrow all read
      // the same call (v6-plan Q2.5).
      return Review.classifyByWinPct(Review.winPctDrop(a, b, mover));
    });
    // v8-0-plan B2: the finer grades, 谱着 read off the ECO table (loaded here
    // if nothing has asked for it yet — without it no move is called book)
    try { await ChessEco.ready(); } catch (_) { /* graded without book moves */ }
    p.book = Grade.bookPlies(fens, (f) => !!ChessEco.lookupPosition(new Chess(f)));
    // `v: 2` marks a node-limited, deepened, graded pass: analysis-store.js
    // never lets an earlier record (timed, ungraded) stand in for one
    store.session.analysis = { sig, scalars, tags, pvs, bests, linesAt, depths, budget: perMove, acc: accuracyFrom(fens, scalars),
      v: 2, seconds: p.seconds, deep: p.deep.flatMap((d, i) => (d ? [i] : [])), grades: Grade.gradeMoves(p, Chess) };
    store.session.analyzing = false;
    store.session.analyzeProgress = "";
    fileAnalysis(fens[0], h, store.session.analysis);
    // a library game on the board: the deeper look goes back to its entry
    // (7.6 §1c). The miner below only runs in ai mode, where the game has a
    // "you"; anywhere else the library's own miner takes this one.
    LibraryUI.adoptBoardAnalysis({ fens, sans: h, scalars, bests, budget: perMove }, store.session.mode !== "ai");
    recordAccuracy();
    // 错题自炼: the pass just judged every move — bank the player's ?? plies
    // as drills before the judgement scrolls away. Only in games where one
    // side is this player (ai mode); a pvp or imported game has no "you".
    let mined = 0, revised = 0, withdrawn = 0;
    if (store.session.mode === "ai") {
      const rev = { budget: perMove, src: "auto", from: boardDrillSource() };
      const pass = { fens, sans: h, tags, bests, scalars, pvs, losses: plyLosses(fens, scalars) };
      const cands = withMotifs(Mistakes.candidatesFrom(pass, store.session.humanColor, Chess, rev));
      const solvedIds = new Set(Object.keys(store.session.puzzleState.solved).filter((k) => k.startsWith("mine:")));
      // 5.1: a deeper pass first corrects what the book already says about
      // this game — a changed answer, a ?? that did not survive the depth —
      // and only then adds what is new (audit F2)
      const rv = Mistakes.reviseMines(store.session.mines, cands, pass, store.session.humanColor, rev);
      const r = Mistakes.addMines(rv.list, cands, Date.now(), solvedIds);
      const dropped = rv.retired.concat(r.dropped);
      if (r.added || dropped.length || rv.updated.length || rv.filled.length) {
        store.session.mines = r.list;
        saveMines();
        // retired drills take their queue entries with them — an orphan id in
        // missed would owe a review nothing can serve
        for (const id of dropped) {
          delete store.session.puzzleState.solved[id];
          delete store.session.puzzleState.missed[id];
        }
        if (dropped.length) savePuzzleState();
        mined = r.added;
        revised = rv.updated.length;
        withdrawn = rv.retired.length;
        if (r.added) { Progress.recordMined(store.session.progress, r.added, Date.now()); saveProgress(); }
      }
    }
    sync();
    const bad = tags.filter((tag) => tag === "?" || tag === "??").length;
    let done = bad ? t("msg.analysis.donePrefix") + bad + t("msg.analysis.doneSuffix") : t("msg.analysis.doneClean");
    if (mined) done += " · " + tf("msg.mined", [mined]);
    if (revised) done += " · " + tf("msg.minesRevised", [revised]);
    if (withdrawn) done += " · " + tf("msg.minesWithdrawn", [withdrawn]);
    if (p.deepCut) done += " · " + t("msg.analysis.deepStopped");   // Stop while deepening: graded and filed all the same (review of PR #87)
    toast(done);
    // A deep pass is 400ms a ply — over half a minute on a long game, which is
    // long enough that people go and do something else. A toast behind another
    // window is a message that was never delivered.
    if (!store.ui.appForeground) Host.notify({ title: t("ntf.analysisDone"), body: done });
  }

  // --- 7.6 §1c: analyses kept across a reload --------------------------------
  //
  // A finished pass is filed under the line it measured (analysis-store.js),
  // and every path that puts a game on the board asks for it back — the
  // launch, 对局历史, 打开 and the library. Nothing here searches: a hit is
  // the stored arrays with this game's `sig`, a miss is no analysis.
  function analysesList() {
    if (!store.session.analysesKept) store.session.analysesKept = ChessAnalysisStore.load(Persist.read("analyses").value);
    return store.session.analysesKept;
  }
  function fileAnalysis(fen, sans, an) {
    const next = ChessAnalysisStore.put(analysesList(), fen, sans, an, Date.now());
    if (next === store.session.analysesKept) return;
    store.session.analysesKept = next;
    Persist.setJson("analyses", ChessAnalysisStore.dump(next));
  }
  /** The stored analysis of the line on the board, ready to use, or null. */
  function recallAnalysis() {
    const an = ChessAnalysisStore.find(analysesList(), baseGame().fen(), sanHistory());
    return an ? Object.assign({}, an, { sig: game.pgn() }) : null;
  }
  /** Put the stored analysis of the game just loaded back; true when there was one. */
  function restoreAnalysis() {
    store.session.analysis = sanHistory().length ? recallAnalysis() : null;
    return !!store.session.analysis;
  }

  /**
   * Centipawn loss for every ply of a pass, from the mover's chair.
   *
   * One routine for all three callers — the board's analysis pass, the
   * library's, and the reload that repairs records 7.0 wrote. It was three
   * copies until 7.1, and two of them had the same bug: they subtracted the
   * raw scalars instead of going through `Review.lossOf`, which pulls both
   * ends into ±EVAL_WINDOW first. 6.1 fixed that on the eval curve for a
   * reason worth repeating here: one ply where a fast search announced mate
   * and the next where it only reported a large plus differ by ~9000, and
   * charging that difference to the mover records the worst blunder the
   * scale can express against somebody who did nothing wrong.
   *
   * `null` — not 0 — where a ply was not measured. Zero is a *measurement*
   * saying "this move gave away nothing", and averaging it in flatters the
   * player; every consumer here already skips non-finite entries.
   * @param {string[]} fens position before each ply, plus the final one
   * @param {(number|null)[]} scalars evaluation after each, index 0 = start
   * @returns {(number|null)[]} one entry per ply
   */
  function plyLosses(fens, scalars) {
    const out = [];
    for (let i = 0; i + 1 < fens.length; i++) {
      const a = scalars[i], b = scalars[i + 1];
      out.push(a == null || b == null ? null
        : Review.lossOf(a, b, fens[i].split(" ")[1] === "w" ? "w" : "b"));
    }
    return out;
  }

  /**
   * Name what each drill is about, from the move that refutes it.
   *
   * The motif of the move the player *played* is rarely anything — a blunder
   * usually has no pattern; the move that punishes it does, which is the
   * argument `analyseLibraryGame` already makes about the diagnosis. Here it
   * pays for something else: `addMines` keeps the newest few drills of every
   * motif when the cap bites, and it can only do that if a drill says which
   * motif it is (v7-1-plan §1.2). Unnameable is fine — those share one
   * bucket, which is the honest reading of "not a pattern".
   */
  function withMotifs(cands) {
    for (const c of cands) {
      if (!c || c.motif || !c.solution || !c.solution[0]) continue;
      let m = null;
      try { m = motifOf(c.fen, c.solution[0], Chess); } catch (_) { m = null; }
      if (m) c.motif = m;
    }
    return cands;
  }

  /**
   * Per-side average centipawn loss and an accuracy score derived from it.
   *
   * The arithmetic is review.js's — the clamp, the mean and the exponential
   * lived here as well until 1.25, identical in every respect except how each
   * copy decided whose move a ply was. review.js's own header says three
   * copies are how they start to drift; two was not better. 缺陷 6.
   *
   * What stays here is only the part that is genuinely this caller's: the side
   * rule. The analyser already holds the FEN of every position, so it reads
   * the side to move off that instead of deriving it from the first mover and
   * the parity of the ply. Both rules must give the same answer, and
   * scripts/test-chess.mjs now checks that on a real game.
   */
  function accuracyFrom(fens, scalars) {
    const loss = Review.lossesBySide(scalars, (i) => (fens[i].split(" ")[1] === "w" ? "w" : "b"));
    const w = Review.accuracyOf(loss.w);
    const b = Review.accuracyOf(loss.b);
    // 6.0: the accuracy figure is the win-percentage one — the same measure
    // the online platforms report, so the number is finally comparable
    // (缺陷 22); the average loss stays in centipawns, which is what it is
    const wp = Review.summarizeWinPct(scalars, sanHistory(), fens[0].split(" ")[1] === "b" ? "b" : "w");
    return { w: wp ? wp.acc.w : w.acc, b: wp ? wp.acc.b : b.acc, wAcpl: w.acpl, bAcpl: b.acpl };
  }

  /**
   * Attach the human's accuracy to the stats record of the game just analysed.
   *
   * Matched by the record's stored `sig`, never by "the most recent record":
   * analysing an imported or replayed game would otherwise stamp its accuracy
   * onto an unrelated game the user really did play.
   */
  function recordAccuracy() {
    if (store.session.mode !== "ai" || !store.session.analysis || !store.session.analysis.acc) return;
    if (!(naturalGameOver() || ruleTerminated())) return;
    const mine = store.session.humanColor === "w" ? store.session.analysis.acc.w : store.session.analysis.acc.b;
    const acpl = store.session.humanColor === "w" ? store.session.analysis.acc.wAcpl : store.session.analysis.acc.bAcpl;
    if (mine == null) return;
    const s = loadStats();
    // By id. Until 1.25 the key was the PGN, so two games played the same way
    // were the same record, and this had to walk to the LAST unannotated match
    // and hope — a heuristic covering for a missing identity. With an id there
    // is nothing to guess: either this game was filed, or it was not.
    const rec = store.game.recordedId
      ? s.games.find((g) => g.id === store.game.recordedId) : null;
    if (!rec) return;
    rec.acc = mine;
    rec.acpl = acpl;
    // v8-0-plan B5: the game's best and worst moment from the player's chair,
    // for 化优为胜 / 逆境求生 on 我的 — two numbers, not the curve
    const f = factsOf({ side: store.session.humanColor, outcome: rec.result, scalars: store.session.analysis.scalars });
    if (f && f.hi != null) { rec.hi = f.hi; rec.lo = f.lo; }
    saveStats(s);
    renderStats();
  }

  /** 分析 (and its stop), 精析 and 持续分析. */
  function wire() {
    document.getElementById("an-run").onclick = () => {
      if (store.session.analyzing) {
        store.session.analyzeAbort = true;
        if (ChessEngine) ChessEngine.cancel();
        return;
      }
      analyzeGame(SCAN_BUDGET);
    };
    document.getElementById("an-deep").onclick = () => { analyzeGame(400); };
    document.getElementById("an-live").onclick = () => {
      store.session.liveOn = !store.session.liveOn;
      if (store.session.liveOn && ChessEngine && !ChessEngine.isReady()) bootEngine();
      store.commit("session", "sync");
    };
  }

  return {
    evalScalar, analysisFor, SCAN_BUDGET, analyzeGame, recallAnalysis, restoreAnalysis, plyLosses, withMotifs,
    recordAccuracy, wire,
  };
}
