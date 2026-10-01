/**
 * 谜题：战术训练、开局题、错题自炼与做题评级。
 *
 * The puzzle trainer as it stood in app.js — the book (hand-written, mined,
 * opening drills and the personal book), the state on disk, the ratings, the
 * review queue, the move handler with its engine-checked alternatives, the
 * answer walk and the side panel. Carved out in v8-0-plan F4 without a change
 * in behaviour.
 *
 * v8-2-plan F1 split it again by what each part is for, still without a
 * change in behaviour; this file is what is left in the middle — a puzzle
 * seated, a move judged, the verdict filed, the next one found, the way out
 * of the trainer into a game (背完接着下, 看那局棋), and the side panel:
 *
 *   puzzle-book.js      题库 — the book, the state on disk, the tiers and the
 *                       review queue; created first, since creating it loads
 *                       the state
 *   puzzle-rating.js    评级 — the Glicko ratings and what an answer is filed as
 *   puzzle-openings.js  开局题 — the tree the drills are judged against
 *   puzzle-mine.js      错题自炼 — the engine's second look and the line
 *   puzzle-mate.js      杀棋 — the mate searches (pure)
 *   puzzle-modes.js     冲刺 / 连胜 and the theme page (v8-0-plan B1)
 *   visual.js           看 N 步后 / 盲走收官 (v8-2-plan T2) — the door; the
 *                       modes are chunk-visual.js (visual-modes.js)
 *
 * Where a new way to train plugs in (v8-2-plan T2): a module of its own,
 * created below beside the modes and handed what it needs the same way; its
 * content and data are a chunk, never the bundle (F1). It puts a puzzle on
 * the board through seatPuzzle(cat, idx, p, run), and a puzzle that carries
 * a `run` hands its verdicts to the mode — puzzleWrong, puzzleSolved and
 * showPuzzleAnswer each stop at `pz.run` — instead of the review queue and
 * the rating.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createPuzzlesUI()` (createLibraryUI's shape); nothing here reaches back
 * into app.js. The repertoire, the library and today's plan are created after
 * this module, so app.js hands those in as small forwarders. The parts above
 * get that same bag and the pieces of each other they read; the pure modules
 * (Srs, Picker, Progress, Mistakes, Drills) each imports for itself, the same
 * objects the book hands app.js.
 * @module trainer/puzzles
 */
import { Chess } from "../chess.js";
import { ChessEngine } from "../engine.js";
import { ChessMistakes as Mistakes } from "../mistakes.js";
import { ChessOpeningTree } from "../opening-tree.js";
import { ChessPicker as Picker } from "../picker.js";
import { ChessProgress as Progress } from "../progress.js";
import { ChessRating } from "../rating.js";
import { ChessSrs as Srs } from "../srs.js";
import { mateInOne, blackForcedLost, findRefutation, bestDefense } from "./puzzle-mate.js";
import { createPuzzleBook } from "./puzzle-book.js";
import { createPuzzleMine } from "./puzzle-mine.js";
import { createPuzzleModes, isThemeCat, THEME_CAT } from "./puzzle-modes.js";
import { createPuzzleOpenings } from "./puzzle-openings.js";
import { createPuzzleRating } from "./puzzle-rating.js";
import { createVisual } from "./visual.js";
import { tdot } from "../tdot.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createPuzzlesUI(d) {
  const {
    Audio2, BoardView, RepUI, animateReply, appGameOver, avail, checkNewAchievements, choosePromotion,
    clearPreview, clearSelection, confirmNative, cursorSquare, dailyJump, dailyStepIsHere, el, gameLoadPgn,
    gameReset, invalidateEngine, kingSquare, loadHistoryRecord, loadLibraryEntry, loadStats, maybeEngineTurn,
    motifKeyOf, moveSound, puzzleIdea, puzzleMotif, puzzleName, renderPuzzleTally, renderRepertoire,
    resetClocks, sanHistory, saveGame, saveSettings, selectSquare, setIcon, setText, setViewIndex, sideName,
    startLearn, stopLearn, store, sync, t, tf, toast, switchMode, setSideTab, drawRatingTrend,
  } = d;

  // v8-2-plan F1: the parts, in the order the old file ran them. The book
  // first: creating it loads the puzzle state. The modes come last, so the
  // book and the ratings reach them through forwarders.
  const Book = createPuzzleBook({ ...d, Modes: { themeList: (id) => Modes.themeList(id) } });
  const {
    saveProgress, bookNow, isOpeningCat, openingTreeFor, tierApplies, puzzleTier, savePuzzleState, owedNow,
    reviewWaits, reviewBank, puzzlesInCat,
  } = Book;
  const Rating = createPuzzleRating({ ...d, ...Book, Modes: { rateThemes: (p, score, r) => Modes.rateThemes(p, score, r) } });
  const { playerRating, puzzleRatingOf, ratePuzzleOnce, markMissed, clearMissed } = Rating;
  const { opCurrent, opTreeMove, gradeCard, seatRepSide, openingWhy, syncOpSideSeg } =
    createPuzzleOpenings({ ...d, ...Book, puzzleWrong, puzzleSolved });
  const { verifyAlt, verifyMineAlt, mineWhy, renderPuzzleLine } = createPuzzleMine({ ...d, ...Book, puzzleScript });
  // v8-0-plan B1: 冲刺 / 连胜, the themes, the rating on the view (puzzle-modes.js);
  // the book and the ratings go in whole (ALL_PUZZLES, isRatedCat, savePuzzleState,
  // puzzleRating, playerRating are what it reads of them)
  const Modes = createPuzzleModes({
    ...Book, ...Rating,
    doc: document, store, t, tf, el, avail, setText, sync, toast, Audio2, drawRatingTrend, motifKeyOf,
    saveSettings, switchMode, setSideTab, seatPuzzle, startPuzzles, puzzleHumanSide, makeVis: (k) => Vis.make(k),
  });
  // v8-2-plan T2: 看 N 步后 and 盲走收官, beside the modes above — the door
  // (trainer/visual.js); the modes themselves are chunk-visual.js
  const Vis = createVisual({
    ...Book, ...Rating, store, t, tf, tdot, el, avail, setText, sync, toast, Audio2, Chess, ChessRating,
    seatPuzzle, puzzleMove, puzzleHumanSide, startRun: Modes.startRun, finishRun: Modes.finishRun,
  });

  const PUZZLE_CAT_IDS = ["m1", "m2", "m3", "win", "tac", "real", "def", "draw", "op", "rep", "mine", "review"];
  const PUZZLE_MOVES = { m1: 1, m2: 2, m3: 3 };
  /** scripted-line categories: exact-line play, opponent replies from the script */
  const SCRIPTED_CATS = { win: true, op: true, rep: true, tac: true, draw: true, real: true, mine: true };

  /** the scripted line of the current puzzle (openings: line; win: solution) */
  function puzzleScript(p) {
    // a due card (v8-1-plan T3) asks one move; its line is the way there and that move
    if (p.card) return p.line;
    // an opening drill in progress reads its script off the tree: the path so
    // far, then the book's main continuation — the stored line may already
    // have been left by a weighted reply
    const pz = store.session.puzzle;
    if (isOpeningCat(p.cat) && pz && pz.p === p && Array.isArray(pz.opPath)) {
      const kid = ChessOpeningTree.childrenAt(openingTreeFor(p), pz.opPath)[0];
      return kid ? pz.opPath.concat(kid.san) : pz.opPath.slice();
    }
    return p.line || p.solution;
  }

  function startPuzzleAt(cat, idx) {
    if (cat === "review" && reviewWaits(() => startPuzzleAt(cat, idx))) return;
    const list = puzzlesInCat(cat);
    if (!list.length) {
      // no puzzle survives the filter: clear the board and the counters too,
      // otherwise the previous puzzle stays on screen and the "n/N" chip keeps
      // counting a set that is no longer being shown
      store.session.puzzle = null;
      store.game.selection = null;
      BoardView.cancelAnim();
      sync();
      toast(t("pz.noneInTier"));
      return;
    }
    idx = ((idx % list.length) + list.length) % list.length;
    store.session.puzzleState.cat = cat;
    savePuzzleState();
    seatPuzzle(cat, idx, list[idx]);
  }

  /**
   * Put puzzle `p` on the board as number `idx` of `cat` — startPuzzleAt's
   * second half, and a run's way in (`run`: trainer/runs.js's record).
   */
  function seatPuzzle(cat, idx, p, run) {
    if (!p) p = puzzlesInCat(cat)[idx];
    if (!p) return;
    store.session.puzzle = { cat, idx, p, g: p.fen ? new Chess(p.fen) : new Chess(), stage: 0, done: false, misses: 0, usedAnswer: false, helpArrow: null, last: null, rated: false, opPath: isOpeningCat(p.cat) ? [] : null, run: run || null };
    // a due card (v8-1-plan T3): the moves that lead to its position are played for you
    if (p.card) {
      const pz = store.session.puzzle;
      for (const san of p.pre) { const m = pz.g.move(san); if (!m) break; pz.last = { from: m.from, to: m.to }; }
      pz.opPath = pz.g.history();
      pz.stage = pz.opPath.length;
    } else if (isOpeningCat(p.cat) && p.side === "b") {
      // playing Black: the app opens with White's book move, you answer
      const first = store.session.puzzle.g.move(p.line[0]);
      if (first) {
        store.session.puzzle.stage = 1;
        store.session.puzzle.last = { from: first.from, to: first.to };
        store.session.puzzle.opPath = [first.san];
      }
    }
    store.game.selection = null;
    BoardView.cancelAnim();
    sync();
  }

  function startPuzzles() {
    // v8-0-plan B1: a theme resumes as a theme (its bands load first)
    if (isThemeCat(store.session.puzzleState.cat)) { Modes.startTheme(store.session.puzzleState.cat.slice(THEME_CAT.length)); return; }
    let cat = PUZZLE_CAT_IDS.includes(store.session.puzzleState.cat) || store.session.puzzleState.cat === "repdue" ? store.session.puzzleState.cat : "m1";
    // the due list is chunk-rep.js's: at launch it may still be booting — wait
    // for it once rather than read "nothing due" off a list not there yet (M3 评审)
    if (cat === "repdue" && !RepUI.booted() && !store.session.repWaited) {
      store.session.repWaited = true;   // once a session: a chunk that failed is not waited for again
      const was = store.session.puzzleState.cat;
      RepUI.ready().then(() => {
        if (store.session.mode === "puzzle" && !store.session.run && store.session.puzzleState.cat === was) startPuzzles();
      });
      return;
    }
    // v8-1-plan T3: nothing due any more — the book's lines, as 「开始背」 does
    if (cat === "repdue" && !puzzlesInCat(cat).length) cat = "rep";
    if (cat === "rep") seatRepSide();
    if (cat === "review" && reviewWaits(startPuzzles)) return;
    // don't strand the user on an empty review tab — or an emptied personal
    // book, which retires drills on its own (mistakes.js cap)
    // …or an emptied repertoire, which is a file the player can delete
    if ((cat === "review" || cat === "mine" || cat === "rep") && !puzzlesInCat(cat).length) cat = "m1";
    const list = puzzlesInCat(cat);
    let idx = list.findIndex((p) => !store.session.puzzleState.solved[p.id]);
    if (idx < 0) idx = 0;
    startPuzzleAt(cat, idx);
  }
  function stopPuzzles() { Modes.endRun(); store.session.run = null; store.session.puzzle = null; }

  function puzzleModel() {
    const g = store.session.puzzle.g;
    const mark = store.session.puzzle.mark || null;
    return {
      // v8-0-plan A5: a move's ✓ or ✗ on its square, and once solved no
      // check glow — a mate that solved the puzzle was lit in the check's red
      mark, success: !!(store.session.puzzle.done && mark && mark.ok),
      position: g.board(),
      flipped: store.session.puzzle.p.side === "b", // face the chair you sit in
      selected: store.game.selection ? store.game.selection.sq : null,
      legalTargets: store.game.selection ? store.game.selection.targets : [],
      lastMove: store.session.puzzle.last,
      checkSquare: g.in_check() ? kingSquare(g, g.turn()) : null,
      mated: g.in_checkmate(),
      hintMove: store.session.puzzle.helpArrow,
      blind: !!store.session.puzzle.hidden, // 盲走 (v8-2-plan T2): the men are withheld
      stars: [],
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  function puzzleGoalText() {
    // an opening drill is titled by the line the board is on (7.6)
    const p = opCurrent(store.session.puzzle);
    if (p.cat === "mine") {
      return tdot(tf("pz.goalMine", [p.played]), p.loss != null && tf("pz.mineCost", [(p.loss / 100).toFixed(1)]));
    }
    if (p.card) return tf("rep.goalCard", [puzzleName(p)]);
    if (isOpeningCat(p.cat)) return tf(p.side === "b" ? "pz.goalOpB" : "pz.goalOp", [puzzleName(p), Math.ceil(p.line.length / 2)]);
    // v8-0-plan B1: a Lichess puzzle keeps its side, and the goal says which
    const b = p.side === "b";
    if (p.cat === "win") return tf(b ? "pz.goalWinB" : "pz.goalWin", [puzzleName(p), p.gain]);
    if (p.cat === "tac") return tf(b ? "pz.goalTacB" : "pz.goalTac", [puzzleName(p), puzzleMotif(p), p.gain]);
    if (p.cat === "real") return tf("pz.goalReal", [puzzleName(p), p.men, p.gain]);
    if (p.cat === "def") return tf(b ? "pz.goalDefB" : "pz.goalDef", [puzzleName(p)]);
    if (p.cat === "draw") return tf("pz.goalDraw", [puzzleName(p)]);
    // the count is a word in Chinese ("一步"), a numeral in English — so it
    // goes through the dictionary rather than being interpolated raw
    return tf(b ? "pz.goalMateB" : "pz.goalMate", [puzzleName(p), t("pz.n." + (PUZZLE_MOVES[p.cat] || 1))]);
  }

  /** The chair the solver sits in: white everywhere except black op drills. */
  function puzzleHumanSide() {
    return store.session.puzzle && store.session.puzzle.p.side === "b" ? "b" : "w";
  }

  function puzzleClick(sq) {
    if (!store.session.puzzle || store.session.puzzle.done) return;
    const g = store.session.puzzle.g;
    if (g.game_over() || g.turn() !== puzzleHumanSide()) return;
    // 看 N 步 (v8-2-plan T2): a square is an answer, not a move on this board
    const own = store.session.puzzle.run && store.session.puzzle.run.own;
    if (own && own.click(sq)) return;
    const piece = g.get(sq);
    if (store.game.selection && store.game.selection.targets.includes(sq)) {
      const from = store.game.selection.sq;
      const vmv = g.moves({ square: from, verbose: true }).find((m) => m.to === sq);
      if (vmv && vmv.promotion) {
        choosePromotion(g.turn(), sq).then((p) => { if (p) puzzleMove(from, sq, p); });
        return;
      }
      puzzleMove(from, sq, "q");
      return;
    }
    if (piece && piece.color === puzzleHumanSide()) {
      selectSquare(sq, g.moves({ square: sq, verbose: true }).map((m) => m.to));
      return;
    }
    clearSelection();
  }

  function puzzleMove(from, to, promotion) {
    if (store.session.puzzle.verifying) return; // the engine is still judging the last move
    const g = store.session.puzzle.g;
    const mv = g.move({ from, to, promotion });
    if (!mv) return;
    store.game.selection = null;
    store.session.puzzle.helpArrow = null;
    store.session.puzzle.last = { from: mv.from, to: mv.to };
    // v8-0-plan A5: where the solver's move landed, for its ✓ / ✗
    Object.assign(store.session.puzzle, { mark: null, solverTo: mv.to });
    BoardView.cancelAnim(); // the solver's own move — see animateReply
    moveSound(mv, g);
    // A real-game tactic grades the key move and nothing else. The two plies
    // after it are a demonstration, not a second question: in a 25-piece
    // position the follow-up usually has several equally good moves, and
    // marking one of them wrong would teach the opposite of the lesson. The
    // point of this category is finding the one move that wins — once it is
    // found, the rest is there to show what it won.
    if (store.session.puzzle.p.cat === "real") {
      const script = puzzleScript(store.session.puzzle.p);
      if (mv.san !== script[0]) { puzzleWrong(t("pz.notTheMove")); return; }
      store.session.puzzle.stage = 1;
      for (let i = 1; i < script.length; i++) {
        const m = g.move(script[i]);
        if (!m) break;
        store.session.puzzle.last = { from: m.from, to: m.to };
        store.session.puzzle.stage = i + 1;
      }
      puzzleSolved();
      return;
    }
    if (store.session.puzzle.p.cat === "mine" && store.session.puzzle.stage === 0 &&
        mv.san !== store.session.puzzle.p.solution[0]) {
      const p = store.session.puzzle.p;
      if (Mistakes.isAccepted(p, mv.san)) { puzzleSolved(); return; }
      if (mv.san === p.played) { puzzleWrong(tf("pz.mine.repeatWhy", [mineWhy(p)])); return; }
      verifyMineAlt(mv).then((v) => {
        if (store.session.puzzle !== undefined && store.session.puzzle && store.session.puzzle.p === p) {
          if (v && v.ok) { toast(tf("pz.mine.alsoFine", [mv.san, (v.loss / 100).toFixed(1)])); puzzleSolved(); return; }
          puzzleWrong(v ? tf("pz.mine.strongerCost", [(v.loss / 100).toFixed(1)]) : t("pz.mine.stronger"));
        }
      });
      return;
    }
    if (isOpeningCat(store.session.puzzle.p.cat)) { opTreeMove(g, mv); return; }
    if (SCRIPTED_CATS[store.session.puzzle.p.cat]) {
      // scripted line: exact match, opponent replies straight from the script
      const script = puzzleScript(store.session.puzzle.p);
      if (mv.san !== script[store.session.puzzle.stage]) {
        const c = store.session.puzzle.p.cat;
        // 7.0: a different FIRST move that is just as good is right.
        //
        // `tac` and `win` graded by exact SAN and nothing else, which is the
        // opposite of what every other category here argues for — `real`:
        // "several follow-ups are equally good, and marking one of them wrong
        // would teach the opposite of the lesson"; `def`: "insisting on one
        // stored move would mark a perfectly good defence wrong"; `mine`
        // already re-checked with the engine. Measured over 140 of the 894
        // mined tac/win puzzles at depth 18: 6% had a second solution within
        // 50cp and another 6% stored an answer that was not even the engine's
        // first choice — so about one in nine told a player who found an
        // equally good move that they were wrong, and docked their Glicko
        // rating and re-queued the puzzle for it.
        //
        // Only the first move: from there the script is a demonstration, not
        // a second question, exactly as `real` explains.
        if ((c === "tac" || c === "win") && store.session.puzzle.stage === 0) {
          const pz0 = store.session.puzzle;
          if (Array.isArray(pz0.p.alts) && pz0.p.alts.includes(mv.san)) { puzzleSolved(); return; }
          verifyAlt(mv, { remember: true }).then((v) => {
            if (store.session.puzzle !== pz0 || pz0.done) return;
            if (v && v.ok) { toast(tf("pz.mine.alsoFine", [mv.san, (v.loss / 100).toFixed(1)])); puzzleSolved(); return; }
            puzzleWrong(c === "win"
              ? (mv.captured ? t("pz.wrongCapture") : t("pz.biggerPrize"))
              : tf("pz.findMotif", [puzzleMotif(pz0.p)]));
          });
          return;
        }
        puzzleWrong(
          c === "win" ? (mv.captured ? t("pz.wrongCapture") : t("pz.biggerPrize")) :
          c === "tac" ? (store.session.puzzle.stage === 0 ? tf("pz.findMotif", [puzzleMotif(store.session.puzzle.p)]) : t("pz.takeTarget")) :
          c === "draw" ? t("pz.notDrawn") :
          c === "mine" ? (mv.san === store.session.puzzle.p.played ? t("pz.mine.repeat") : t("pz.mine.stronger")) :
          openingWhy(g, mv, script[store.session.puzzle.stage]));
        return;
      }
      store.session.puzzle.stage++;
      if (store.session.puzzle.stage < script.length) {
        const rm = g.move(script[store.session.puzzle.stage]);
        if (rm) {
          store.session.puzzle.last = { from: rm.from, to: rm.to };
          animateReply(rm);
          moveSound(rm, g);
          store.session.puzzle.stage++;
        }
      }
      if (store.session.puzzle.stage >= script.length) { puzzleSolved(); return; }
      puzzleGoodMove();
      sync();
      return;
    }
    // Defensive puzzles are graded on the position, not on matching a script.
    // The question they ask is "is the mate still there?" — so any move that
    // answers no is right, exactly as it would be in a real game. Insisting on
    // one stored move would mark a perfectly good defence wrong.
    if (store.session.puzzle.p.cat === "def") {
      if (!g.game_over() && mateInOne(g)) {
        const still = mateInOne(g);
        puzzleWrong(tf("pz.stillMate", [still, sideName(g.turn())]));
        return;
      }
      puzzleSolved();
      return;
    }
    if (g.in_checkmate()) { puzzleSolved(); return; }
    const totalMoves = PUZZLE_MOVES[store.session.puzzle.p.cat] || 1;
    const remaining = totalMoves - (store.session.puzzle.stage + 1);
    if (remaining <= 0) {
      // used the last move without mating — explain what black gets to play
      const escape = g.moves()[0];
      puzzleWrong(escape ? tf("pz.notMateYetMove", [escape, sideName(g.turn())]) : t("pz.notMateYet"));
      return;
    }
    // midpoint: the stored line, or any alternate that still forces mate
    const onLine = mv.san === store.session.puzzle.p.solution[store.session.puzzle.stage * 2];
    if (!onLine) {
      const refutation = findRefutation(g, remaining);
      if (refutation) {
        puzzleWrong(tf("pz.refuted", [refutation, sideName(g.turn())]));
        return;
      }
    }
    store.session.puzzle.stage++;
    const reply = onLine ? store.session.puzzle.p.solution[store.session.puzzle.stage * 2 - 1] : bestDefense(g, remaining);
    const rm = reply ? g.move(reply) : null;
    if (rm) {
      store.session.puzzle.last = { from: rm.from, to: rm.to };
      animateReply(rm);
      moveSound(rm, g);
    }
    puzzleGoodMove();
    sync();
  }

  function puzzleWrong(reason) {
    // the move is taken back; its ✗ stays on the square it went to (A5)
    const bad = store.session.puzzle.g.undo();
    store.session.puzzle.mark = bad ? { sq: bad.to, ok: false } : null;
    if (store.session.puzzle.run) { store.session.puzzle.last = null; Modes.runMissed(reason); return; }
    store.session.puzzle.last = null;
    store.session.puzzle.misses++;
    store.session.pzStreak = 0;
    markMissed(store.session.puzzle.p.id); // a missed puzzle joins the review queue
    Audio2.playWrong();
    // The correction: this is the app telling you what you got wrong, which
    // in the puzzle and opening modes is the entire product. 7.7 (v7-7-plan
    // §4): on the feedback card beside the board rather than in a toast over
    // it — a cross, 再想想, the reason, and the way to the answer.
    store.session.puzzle.fb = { ok: false, head: t("pz.fb.retry"), sub: reason || t("pz.noForcedMate") };
    store.commit("session", "sync");
  }

  /** A right move that is not yet the end of the puzzle: say so (7.7 §4). */
  function puzzleGoodMove() {
    store.session.puzzle.mark = markRight();
    store.session.puzzle.fb = { ok: true, head: t("pz.fb.best"), sub: t("pz.fb.keepGoing") };
  }

  /**
   * The feedback card under the task (7.7, v7-7-plan §4) — what the last
   * move was. Lichess's shape: a tick and 「最佳着」, or a cross and 「再想想」
   * with the way to the answer; on the solve, the run of clean solves and
   * what the answer did to the rating.
   */
  function renderPuzzleFeedback() {
    const box = el("puzzle-feedback");
    if (!box) return;
    const pz = store.session.puzzle;
    const fb = pz && pz.fb;
    avail(box, !!fb);
    if (!fb) return;
    box.classList.toggle("ok", fb.ok);
    box.classList.toggle("bad", !fb.ok);
    setIcon(el("puzzle-fb-ic"), fb.ok ? "check" : "x");
    setText(el("puzzle-fb-head"), fb.head);
    setText(el("puzzle-fb-sub"), fb.sub || "");
    const meta = el("puzzle-fb-meta");
    const parts = [];
    if (fb.ok && pz.done && store.session.pzStreak >= 2) parts.push(tf("pz.fb.streak", [store.session.pzStreak]));
    if (pz.rating && (pz.done || !fb.ok)) {
      const d = pz.rating.delta;
      parts.push(pz.rating.now + (pz.rating.provisional ? "?" : "") + " " + (d > 0 ? "+" + d : d < 0 ? "−" + -d : "±0"));
    }
    avail(meta, parts.length > 0);
    setText(meta, tdot(...parts));
    if (meta) meta.classList.toggle("up", !!(pz.rating && pz.rating.delta > 0));
    // the way to the answer, after a miss, while there is still a question
    avail(el("puzzle-fb-hint"), !fb.ok && !pz.done && !pz.helpArrow);
  }

  /** Arrow for the correct move at the current stage. */
  function showPuzzleAnswer() {
    if (!store.session.puzzle || store.session.puzzle.done) return;
    if (store.session.puzzle.run) { Modes.runAnswer(); return; }
    const g = store.session.puzzle.g;
    if (g.turn() !== puzzleHumanSide() || g.game_over()) return;
    let from = null, to = null;
    // on the stored line the stored move is always valid here
    const stored = SCRIPTED_CATS[store.session.puzzle.p.cat]
      ? puzzleScript(store.session.puzzle.p)[store.session.puzzle.stage]
      : store.session.puzzle.p.solution[store.session.puzzle.stage * 2];
    if (stored) {
      const probe = new Chess(g.fen());
      const mv = probe.move(stored);
      if (mv) { from = mv.from; to = mv.to; }
    }
    if (!from) {
      // off the stored line — search for any move that still forces mate
      const remaining = (PUZZLE_MOVES[store.session.puzzle.p.cat] || 1) - store.session.puzzle.stage;
      for (const m of g.moves({ verbose: true })) {
        g.move(m);
        const ok = g.in_checkmate() ||
          (remaining > 1 && !g.game_over() && blackForcedLost(g, remaining - 1));
        g.undo();
        if (ok) { from = m.from; to = m.to; break; }
      }
    }
    if (from) {
      store.session.puzzle.helpArrow = { from, to };
      store.session.puzzle.usedAnswer = true;
      markMissed(store.session.puzzle.p.id); // relying on the answer counts as a miss
      store.commit("session", "sync");
    }
  }

  /** A right move's ✓, on the square the solver's move landed on (v8-0-plan A5). */
  function markRight() {
    const sq = store.session.puzzle.solverTo;
    return sq ? { sq, ok: true } : null;
  }

  function puzzleSolved() {
    store.session.puzzle.done = true;
    store.session.puzzle.mark = markRight();
    store.game.selection = null;
    Audio2.playWin();
    if (store.session.puzzle.run) { Modes.runSolved(); return; } // v8-0-plan B1
    // an opening drill is credited to the line the board is on (7.6)
    const sp = opCurrent(store.session.puzzle);
    // a clean first-try solve retires the puzzle from review; a shaky one keeps it
    if (store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer) clearMissed(sp.id);
    // a due card is graded on its own schedule, not solved into the tally (v8-1-plan T3)
    if (sp.card) gradeCard(store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer);
    else if (!store.session.puzzleState.solved[sp.id]) {
      if (store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer) ratePuzzleOnce(sp.id, 1);
      store.session.puzzleState.solved[sp.id] = true;
      // a clean first solve counts into the lifetime tally; a solve after
      // misses already counted those misses — counting the solve too would
      // let one shaky puzzle wash its own signal out
      if (store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer) {
        Picker.recordAnswer(store.session.puzzleState, store.session.puzzle.p.cat, false, motifKeyOf(store.session.puzzle.p));
        Progress.recordAnswer(store.session.progress, store.session.puzzle.p.cat, false, Date.now());
        // a personal drill solved clean: the mistake is redeemed, and the week remembers
        if (store.session.puzzle.p.cat === "mine") Progress.recordRedeemed(store.session.progress, Date.now());
        saveProgress();
      }
      savePuzzleState();
      checkNewAchievements();
    }
    // the record pane's 背下来 N/M and the tally count this solve now, not
    // after a reload (7.6)
    if (isOpeningCat(sp.cat)) renderRepertoire();
    renderPuzzleTally();
    const verb = store.session.puzzle.p.cat === "mine" ? t("pz.doneMine") :
      isOpeningCat(store.session.puzzle.p.cat) ? t("pz.doneOp") :
      store.session.puzzle.p.cat === "def" ? t("pz.doneDef") :
      store.session.puzzle.p.cat === "draw" ? t("pz.doneDraw") :
      store.session.puzzle.p.cat === "real" ? t("pz.doneReal") :
      store.session.puzzle.p.cat === "win" || store.session.puzzle.p.cat === "tac" ? t("pz.doneWin") : t("pz.doneMate");
    const why = store.session.puzzle.p.cat === "mine" ? mineWhy(store.session.puzzle.p) : "";
    if (store.session.puzzle.p.cat === "mine") store.session.puzzle.lineAt = 0;
    // the run of clean first-try solves this sitting, and the card that says
    // so — the tick, the verb, the puzzle's name (7.7 §4; was a toast)
    const clean = store.session.puzzle.misses === 0 && !store.session.puzzle.usedAnswer;
    store.session.pzStreak = clean ? store.session.pzStreak + 1 : 0;
    store.session.puzzle.fb = { ok: true, head: clean ? t("pz.fb.best") : verb,
      sub: tdot(clean ? verb : "", puzzleName(sp), why) };
    sync();
  }

  /**
   * Carry a finished opening drill into a real game.
   *
   * Rehearsing six plies and then being handed the next drill is where the
   * opening trainer stopped being about openings: a line is only worth
   * knowing for the game it leads to, and that game was never reachable from
   * here. This hands the drilled position to the engine with the moves
   * intact, from the White side the player just rehearsed.
   */
  async function playOnFromPuzzle() {
    // Both opening categories: the button is drawn for both (canPlayOn reads
    // isOpeningCat), and a guard that disagreed with the button is a button
    // that does nothing — which for a line out of your OWN book is the worst
    // place to make that promise. Found by review on 7.2's own PR.
    if (!store.session.puzzle || !store.session.puzzle.done || !isOpeningCat(store.session.puzzle.p.cat)) return;
    // Everything this needs off the puzzle, taken BEFORE the trainer is
    // stopped. `stopPuzzles()` sets `store.session.puzzle` to null, and the
    // three lines below used to read through it afterwards — so this button
    // threw on its first statement past that call and did nothing, for every
    // category, since it was written in 6.0. What kept it looking fine was a
    // source-text assertion that matched the very expression that was broken:
    // the shape was right and nobody had pressed it. 7.2 replaced that check
    // with an e2e that presses it, and the e2e failed immediately.
    const pz = store.session.puzzle;
    const p = pz.p;
    const line = pz.g.pgn();
    const name = puzzleName(opCurrent(pz));
    if (!line.trim()) return;
    // The game on the board is about to be replaced, so ask first — the same
    // question 新局 asks (7.4). Until 7.2 this button never did anything, so
    // the silent wipe of an unfinished game only became reachable then. A
    // finished game has nothing left to lose: it is already in 战绩.
    if (sanHistory().length && !appGameOver() &&
        !(await confirmNative(t("dlg.newGame"), t("act.playOn"), { ok: t("act.playOn"), cancel: t("act.cancel") }))) {
      return;
    }
    // the dialog is an await: the drill may have moved on under it
    if (store.session.puzzle !== pz) return;
    invalidateEngine();
    if (ChessEngine) ChessEngine.newGame();
    stopPuzzles();
    store.session.mode = "ai";
    store.session.humanColor = p.side === "b" ? "b" : "w";
    store.game.flipped = p.side === "b";
    store.game.flagFall = null;
    store.game.resigned = null;
    store.game.drawAgreed = false;
    store.game.drawClaimed = null;
    store.session.analysis = null;
    store.game.recordedId = null;
    gameReset();
    gameLoadPgn(line, { sloppy: true });
    store.game.selection = null;
    store.session.hintMove = null;
    store.game.viewIndex = sanHistory().length;
    resetClocks();
    saveSettings();
    saveGame();
    sync();
    toast(tf("pz.playOn", [name]));
    maybeEngineTurn();
  }

  /**
   * The game a drill was mined from, if it is still on disk.
   *
   * 7.2 (A2). `from` is a reference, not a copy, and both the things it can
   * point at roll over: the library keeps 500 games and 战绩 keeps 500
   * records, and 战绩 can be cleared outright. So every read asks whether the
   * source is still there — and the entry point is drawn only when this
   * answers yes. A button that opens nothing is exactly the promise P3 exists
   * to stop the interface making.
   */
  function drillSourceOf(p) {
    const from = p && p.from;
    if (!from || !from.id) return null;
    if (from.kind === "lib") {
      const entry = (store.session.library || []).find((g) => g && g.id === from.id);
      return entry ? { kind: "lib", entry } : null;
    }
    const rec = loadStats().games.find((g) => g && g.id === from.id);
    return rec ? { kind: "game", rec } : null;
  }

  /**
   * 「看那局棋」: leave the trainer and open the drill's source game, stopping
   * the cursor on the move it was mined from.
   *
   * The drill's fen is the position *before* the blunder, so the cursor goes
   * one ply later: that lands on the move itself — the one the move list
   * marks ?? and the one just failed again — rather than on the moment
   * before it, where the board would look identical to the puzzle just left.
   *
   * The trainer is left before the load, because the load asks whether it may
   * replace the board and the answer may be no. That is why it is left through
   * leaveTrainer: a cancelled jump puts the same drill (and run) back.
   */
  async function openDrillSource() {
    const pz = store.session.puzzle;
    const p = pz && pz.p;
    const src = drillSourceOf(p);
    if (!src) return;
    const ply = Number.isFinite(p.ply) ? p.ply : null;
    // a run's drill (a mined one can be served in 冲刺) keeps its run too (Codex on #88)
    const back = leaveTrainer();
    const ok = src.kind === "lib" ? await loadLibraryEntry(src.entry) : await loadHistoryRecord(src.rec);
    // nothing was loaded and the mode never left 做题 — put the drill back
    if (!ok) { back(); return; }
    if (ply != null) setViewIndex(ply + 1);
    saveGame();
    sync();
  }

  /**
   * Step out of 教学 / 做题 so a game can go on the board (7.6 §3d).
   *
   * The mode itself is left as it is — the load that follows sets it, and a
   * load can be refused (the 「替换当前棋局？」 question). What is returned
   * puts the trainer back exactly where it was for that case: the same
   * drill, the same lesson, the same classic. Outside the trainer modes
   * there is nothing to leave and nothing to restore.
   * @returns {() => void}
   */
  function leaveTrainer() {
    const mode = store.session.mode;
    if (mode !== "learn" && mode !== "puzzle") return () => {};
    // the trainer objects themselves, not their indices: restarting from an
    // index resets a puzzle's stage, misses and hints, a lesson to its first
    // task and a classic to its first move — so cancelling the load used to
    // throw the training in progress away (Codex on #79). Stopping only drops
    // these references (stopLearn also bumps the lesson's token, which just
    // cancels a demo in flight), and a refused load changes nothing else.
    const kept = { puzzle: store.session.puzzle, learn: store.session.learn, study: store.session.study };
    invalidateEngine();
    clearPreview();
    // a 冲刺 / 连胜 is parked, not ended: stopPuzzles would file its score
    // and stop its clock before the answer is in (Codex on #88). A yes
    // leaves the mode through switchMode, whose stopPuzzles files it then.
    if (mode === "puzzle") { Modes.parkRun(); store.session.puzzle = null; } else stopLearn();
    return () => {
      store.session.mode = mode;
      if (mode === "puzzle") {
        if (kept.puzzle) { store.session.puzzle = kept.puzzle; Modes.unparkRun(); } else { Modes.endRun(); startPuzzles(); }
      } else if (kept.study || kept.learn) {
        store.session.learn = kept.learn;
        store.session.study = kept.study;
      } else startLearn();
      sync();
    };
  }

  function nextPuzzle() {
    if (!store.session.puzzle || store.session.puzzle.run) return;
    // 7.6 §3g: while 今天的训练 is running, 下一题 is the plan's next step.
    // It used to be only "the next one in this category" — so the step that
    // had just been completed was left for whatever the category held, and an
    // emptied review queue graduated to 一步杀 instead of to the plan's next
    // item. Where the current step is this category, that is still the move.
    const d = store.session.daily;
    const step = d && d.steps[d.i];
    if (step && !dailyStepIsHere(step) && dailyJump(step)) { store.commit("session", "sync"); return; }
    if (store.session.puzzle.cat === "review" && reviewWaits(nextPuzzle)) return;
    let list = puzzlesInCat(store.session.puzzle.cat);
    // v8-1-plan T3: the card just answered has left the due list (or, missed,
    // gone to its end), so the one now at this index is the next
    if (store.session.puzzle.cat === "repdue") {
      if (!list.length) {
        toast(t("rep.dueDone"));
        store.session.puzzleState.cat = "rep"; savePuzzleState();
        startPuzzles();
        return;
      }
      startPuzzleAt("repdue", store.session.puzzle.idx % list.length);
      return;
    }
    if (store.session.puzzle.cat === "review") {
      // a clean re-solve shrinks the queue; graduate to m1 when it empties
      if (!list.length) {
        toast(t("pz.reviewEmptyDone"));
        store.session.puzzleState.cat = "m1"; savePuzzleState();
        startPuzzles();
        return;
      }
      startPuzzleAt("review", store.session.puzzle.idx % list.length);
      return;
    }
    // prefer the next unsolved one, wrapping around
    for (let d = 1; d <= list.length; d++) {
      const i = (store.session.puzzle.idx + d) % list.length;
      if (!store.session.puzzleState.solved[list[i].id]) { startPuzzleAt(store.session.puzzle.cat, i); return; }
    }
    startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx + 1);
  }

  function syncPuzzleUI() {
    paintPuzzlePanel();
    // v8-0-plan B1: the rating, the run card and the theme row, over the rest
    if (store.session.mode === "puzzle") Modes.render();
  }

  function paintPuzzlePanel() {
    const sec = document.getElementById("sec-puzzle");
    if (!sec) return;
    sec.hidden = store.session.mode !== "puzzle";
    if (store.session.mode !== "puzzle") return;
    // an empty difficulty filter leaves no puzzle loaded — keep the filter row
    // usable so the user can pick their way back out
    if (!store.session.puzzle) {
      document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.tier === store.session.puzzleTierFilter);
        b.disabled = false; // no puzzle loaded means we are not in review
      });
      document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
        b.classList.toggle("active", b.dataset.cat === store.session.puzzleState.cat);
        if (b.dataset.cat === "mine") b.hidden = !store.session.mines.length;
        if (b.dataset.cat === "rep") b.hidden = !RepUI.total();
      });
      avail(el("row-puzzle-tier"), tierApplies(store.session.puzzleState.cat));
      syncOpSideSeg(store.session.puzzleState.cat);
      const emptyProg = document.getElementById("puzzle-progress");
      if (emptyProg) emptyProg.textContent = tf("pz.solvedCount",
        [bookNow().filter((p) => store.session.puzzleState.solved[p.id]).length, bookNow().length]);
      const emptyTask = document.getElementById("puzzle-task");
      if (emptyTask) emptyTask.textContent = t("pz.noneInTier");
      const emptyList = document.getElementById("puzzle-list");
      if (emptyList) emptyList.replaceChildren();
      avail(el("puzzle-feedback"), false);
      return;
    }
    const list = puzzlesInCat(store.session.puzzle.cat);
    const solvedAll = bookNow().filter((p) => store.session.puzzleState.solved[p.id]).length;
    const missedCount = puzzlesInCat("review").length;
    const prog = document.getElementById("puzzle-progress");
    if (prog) {
      prog.textContent = store.session.puzzle.cat === "review"
        ? tf("pz.missedCount", [missedCount])
        : store.session.puzzle.cat === "repdue" ? tf("rep.dueLeft", [list.length])
        : tf("pz.solvedCount", [solvedAll, bookNow().length]);
    }
    // the tier row does nothing in the review queue — grey it out rather than
    // The difficulty filter exists only where difficulty is a separate axis.
    // In review it filters nothing (the queue is what it is), and in the three
    // mate categories the tier is the category under another name — see
    // tierApplies(). A filter that cannot change the list is not disabled, it
    // is absent (P3.3).
    const shows = tierApplies(store.session.puzzle.cat);
    avail(el("row-puzzle-tier"), shows);
    syncOpSideSeg(store.session.puzzle.cat);
    document.querySelectorAll("#puzzle-tier-seg button").forEach((b) => {
      b.classList.toggle("active", shows && b.dataset.tier === store.session.puzzleTierFilter);
      b.disabled = false;
    });
    document.querySelectorAll("#puzzle-cat-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.cat === store.session.puzzle.cat || (b.dataset.cat === "rep" && store.session.puzzle.cat === "repdue"));
      // surface how many are queued for review right on the tab
      if (b.dataset.cat === "review") b.textContent = missedCount ? tf("pz.reviewN", [missedCount]) : t("pz.cat.review");
      if (b.dataset.cat === "mine") b.hidden = !store.session.mines.length;
      if (b.dataset.cat === "rep") b.hidden = !RepUI.total();
    });
    const task = document.getElementById("puzzle-task");
    if (task) {
      // 「第 N 题」 is the chip's job now (7.3 B4) — the card carries the goal,
      // the detail and, where there is one, the puzzle's rating
      task.textContent = store.session.puzzle.done
        ? t("pz.solvedNext")
        : tdot(puzzleGoalText(), puzzleRatingOf(store.session.puzzle.p) != null && tf("pz.ratingOf", [puzzleRatingOf(store.session.puzzle.p)]));
    }
    renderPuzzleLine();
    renderPuzzleFeedback();
    // opening drills are rote memorisation without the "why" — show the idea
    const ideaEl = document.getElementById("puzzle-idea");
    if (ideaEl) {
      const idea = puzzleIdea(opCurrent(store.session.puzzle));
      ideaEl.hidden = !idea;
      ideaEl.textContent = idea ? tdot(t("pz.idea"), idea) : "";
    }
    // a finished opening line offers the game it was drilled for; that is the
    // reward, so it takes the primary emphasis from "next puzzle"
    const canPlayOn = !!store.session.puzzle.done && isOpeningCat(store.session.puzzle.p.cat);
    const playOn = document.getElementById("puzzle-playon");
    if (playOn) {
      playOn.hidden = !canPlayOn;
      playOn.classList.toggle("primary", canPlayOn);
    }
    // 「看那局棋」 (7.2): only for a drill mined from a game that is still
    // filed — see drillSourceOf for why that has to be asked every time
    const srcBtn = document.getElementById("puzzle-source");
    if (srcBtn) srcBtn.hidden = !drillSourceOf(store.session.puzzle.p);
    // 「答案」 lives in the chrome's hint slot only (7.4 §5 — see index.html):
    // renderGameActions() empties that slot once the puzzle is done, the
    // same P3 rule the panel copy used to keep here.
    // the after-solve review nudge: the queue's size is the whole message
    const nudge = document.getElementById("puzzle-review-nudge");
    if (nudge) {
      const owed = owedNow();
      const show = !!store.session.puzzle.done && owed > 0 && store.session.puzzle.cat !== "review";
      nudge.hidden = !show;
      if (show) nudge.textContent = tf("pz.smart.review", [owed]);
    }
    const next = document.getElementById("puzzle-next");
    if (next) next.classList.toggle("primary", store.session.puzzle.done && !canPlayOn);
    const listEl = document.getElementById("puzzle-list");
    if (listEl) {
      listEl.replaceChildren();
      list.forEach((p, i) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "lesson-item" + (i === store.session.puzzle.idx ? " current" : "");
        b.dataset.i = String(i);
        // opening drills carry their length: "how much is there to remember"
        // is the first thing anyone wants to know before starting one
        const len = isOpeningCat(p.cat) ? tf("pz.moveN", [Math.ceil(p.line.length / 2)]) : "";
        b.textContent = (store.session.puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + puzzleName(p) + (len && "  " + len);
        listEl.appendChild(b);
      });
    }
  }

  /** The puzzle panel's controls — wired from app.js's boot as before (v8-0-plan F4). */
  function wirePuzzlePanel() {
    Modes.wire();
    document.getElementById("puzzle-cat-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-cat]");
      // `puzzle` is null whenever the tier filter empties the current category —
      // exactly the moment the user needs these tabs to change category, so this
      // must not bail out on a missing puzzle
      if (!b || (store.session.puzzle && b.dataset.cat === store.session.puzzle.cat)) return;
      const go = () => {
        if (b.dataset.cat === "review" && !puzzlesInCat("review").length) {
          toast(t("pz.noMissed"));
          return;
        }
        store.session.puzzleState.cat = b.dataset.cat;
        savePuzzleState();
        startPuzzles();
      };
      // v8-1-plan T6: a queue of bank puzzles only is empty until their bands are here
      if (b.dataset.cat !== "review" || !reviewWaits(go)) go();
    };
    document.getElementById("op-side-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-side]");
      const cur = store.session.puzzleState.opSide === "b" ? "b" : "w";
      if (!b || b.dataset.side === cur) return;
      store.session.puzzleState.opSide = b.dataset.side;
      savePuzzleState();
      // land on this chair's first unsolved line, same as entering the mode
      startPuzzles();
    };
    document.getElementById("puzzle-tier-seg").onclick = (ev) => {
      const b = ev.target.closest("button[data-tier]");
      if (!b || b.dataset.tier === store.session.puzzleTierFilter) return;
      store.session.puzzleTierFilter = b.dataset.tier;
      saveSettings();
      startPuzzles();
    };
    document.getElementById("puzzle-retry").onclick = () => {
      if (store.session.puzzle) { startPuzzleAt(store.session.puzzle.cat, store.session.puzzle.idx); toast(t("pz.restarted")); }
    };
    document.getElementById("puzzle-next").onclick = () => { nextPuzzle(); };
    // the feedback card's way to the answer: the same as the chrome's 答案
    document.getElementById("puzzle-fb-hint").onclick = () => { showPuzzleAnswer(); };
    document.getElementById("puzzle-review-nudge").onclick = () =>
      document.getElementById("puzzle-smart").click();
    document.getElementById("puzzle-smart").onclick = function smart() {
      // the review rung reads the queue: a due bank puzzle's band first (v8-1-plan T6)
      if (reviewWaits(smart)) return;
      // the rating rung only once a first answer has moved the rating — a fresh
      // profile is still sent exploring
      const rated = Array.isArray(store.session.puzzleState.rhist) && store.session.puzzleState.rhist.length > 0;
      const pick = Picker.pickNext(store.session.puzzleState, bookNow(), Srs, puzzleTier, motifKeyOf,
        puzzleRatingOf, rated ? ChessRating.pickRange(playerRating()) : null, Date.now(), reviewBank());
      if (pick.kind === "done") { toast(t("pz.smart.done")); return; }
      store.session.puzzleState.cat = pick.cat;
      // same contract for the side segment: if the picker chose an opening line
      // from the chair not currently shown, switch chairs so the pick is servable
      const picked = bookNow().find((p) => p.id === pick.id);
      if (picked && isOpeningCat(picked.cat) && isOpeningCat(pick.cat))
        store.session.puzzleState.opSide = picked.side === "b" ? "b" : "w";
      savePuzzleState();
      // the recommendation must be able to serve what it picked: the tier
      // filter is a per-category browse tool, and a pick filtered out by it
      // would land on "这一档没有题" — the interface contradicting itself
      store.session.puzzleTierFilter = "all";
      const list = puzzlesInCat(pick.cat);
      const idx = Math.max(0, list.findIndex((p) => p.id === pick.id));
      startPuzzleAt(pick.cat, idx);
      toast(pick.kind === "review" ? tf("pz.smart.review", [pick.due]) :
            pick.kind === "rated" ? tf("pz.smart.rated", [pick.rating]) :
            pick.kind === "motif" ? tf("pz.smart.motif", [t("motif." + pick.motif)]) :
            pick.kind === "weak" ? tf("pz.smart.weak", [t("pz.cat." + pick.cat)]) :
            tf("pz.smart.explore", [t("pz.cat." + pick.cat)]));
    };
    const playOnEl = document.getElementById("puzzle-playon");
    if (playOnEl) playOnEl.onclick = () => { playOnFromPuzzle(); };
    const drillSrcEl = document.getElementById("puzzle-source");
    if (drillSrcEl) drillSrcEl.onclick = () => { openDrillSource(); };
    document.getElementById("puzzle-list").onclick = (ev) => {
      const b = ev.target.closest("button[data-i]");
      if (b && store.session.puzzle) startPuzzleAt(store.session.puzzle.cat, Number(b.dataset.i));
    };
  }

  // exactly what the one-file trainer returned (M1 评审): the book's and the
  // ratings' other names stay inside the trainer. Srs, Picker, Progress and
  // Mistakes are the same modules the book imports.
  const { onMinedArrived, ALL_PUZZLES, Library, loadMines, saveMines, Planner, loadPuzzleState, practiceLeft } = Book;
  const { ratingLabel, ratingTip } = Rating;
  return {
    wirePuzzlePanel,
    onMinedArrived, ALL_PUZZLES, Library, Mistakes, loadMines, saveMines, Progress, Planner,
    saveProgress, bookNow, loadPuzzleState, savePuzzleState, Srs, Picker,
    owedNow, ratingLabel, ratingTip, practiceLeft, puzzlesInCat,
    startPuzzleAt, startPuzzles, stopPuzzles, puzzleModel, puzzleHumanSide, puzzleClick,
    showPuzzleAnswer, leaveTrainer, nextPuzzle, syncPuzzleUI, closeThemes: () => Modes.closeThemes(), Vis,
  };
}
