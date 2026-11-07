/**
 * 谜题的题库：内置题、挖掘题、开局题、错题自炼与开局书，做题的存档、难度档与复习队列。
 *
 * What the puzzle trainer serves from, as it stood in trainer/puzzles.js —
 * carved out in v8-2-plan F1 without a change in behaviour. The book (the
 * hand-written set, the mined chunk joined in when it arrives, the opening
 * drills from both chairs, the personal book and the player's own opening
 * book), the puzzle state on disk, the derived
 * difficulty tier, and the review queue: what is owed, what can be served,
 * and the list each category shows.
 *
 * Created first by `createPuzzlesUI()`, before anything else in the trainer:
 * creating it loads the state, exactly as
 * the top of the old file did. The rest of the trainer reads the book through
 * what this returns. The theme lists live with the themes (puzzle-modes.js),
 * created later, so `Modes` arrives as a forwarder.
 * @module trainer/puzzle-book
 */
import { ChessDrills } from "../drills.js";
import { ChessLazy } from "../lazy-content.js";
import { ChessLibrary } from "../library.js";
import { ChessMistakes } from "../mistakes.js";
import { ChessOpeningTree } from "../opening-tree.js";
import { CHESS_OPENINGS, CHESS_OPENING_NAMES } from "../openings.js";
import { ChessPicker } from "../picker.js";
import { ChessPlanner } from "../planner.js";
import { ChessProgress } from "../progress.js";
import { ChessPuzzleDb } from "../puzzle-db.js";
import { CHESS_PUZZLES } from "../puzzles.js";
import { ChessSrs } from "../srs.js";
import { createBankReview, isBankId } from "./bank-review.js";
import { isThemeCat, THEME_CAT, isGroupCat, GROUP_CAT } from "./puzzle-modes.js";

/**
 * @param {object} d everything this module borrows from app.js, and the trainer's `Modes` forwarder
 */
export function createPuzzleBook(d) {
  const {
    MINED_ORDINAL, Persist, RepUI, Modes, renderAchievements, renderRecordEntry, renderStats,
    store, sync, t, toast,
  } = d;

  // --- puzzle mode: tactics trainer (data in puzzles.js, pure chess.js) ---
  // the hand-written book plus the engine-mined set (scripts/mine-puzzles.mjs):
  // same categories, same gate, named by category and number rather than by
  // a translated title (v6-plan Q3.2)
  //
  // v8-0-plan F5: the mined set is a chunk. It is joined into ALL_PUZZLES
  // when it is here — before the bundle runs for a session resuming in puzzle
  // mode, right after the first paint for every other one — and joined right
  // behind the hand-written book, ahead of the drills. So a category list
  // only ever grows at its end: an index taken before the join still names
  // the same puzzle after it.
  const PUZZLES = CHESS_PUZZLES || [];

  /** Join the mined set in, once. @returns {boolean} whether it joined now */
  function joinMined() {
    const mined = ChessLazy.mined();
    if (!mined || MINED_ORDINAL.size) return false;
    const perCat = {};
    for (const p of mined) { perCat[p.cat] = (perCat[p.cat] || 0) + 1; MINED_ORDINAL.set(p.id, perCat[p.cat]); }
    ALL_PUZZLES.splice(PUZZLES.length, 0, ...mined);
    return true;
  }
  /** The chunk is here: join it, and repaint whatever counts puzzles. */
  function onMinedArrived() {
    if (!joinMined()) return;
    forgetRetired();
    renderStats();
    renderAchievements();
    renderRecordEntry();
    sync();
  }

  /**
   * 6.0 (v6-plan Q3.4): the same 195 lines as one tree. The trainer's opponent
   * picks its reply among the book's children, weighted by how many lines run
   * through each, so the same drill does not always go the same way; a drill
   * is complete at any leaf.
   */
  const OPENING_TREE = ChessOpeningTree.buildTree(CHESS_OPENINGS || []);

  /** Opening trainer drills, generated from the vendored ECO book (≥6 plies). */
  const Drills = ChessDrills;
  const OPENING_DRILLS = Drills.orderDrills(Drills.drillLines(CHESS_OPENINGS || [])
    // The id is derived from the ECO code and the moves, NOT from the row's
    // position — see drills.js. With a positional id, adding a single deep
    // line to the book moved 108 of the 109 ids onto a different drill and
    // quietly wiped everyone's opening progress and review queue.
    .map(([eco, nameId, seq, idea]) => ({
      id: Drills.drillId(eco, seq),
      cat: "op",
      // `nameId` keys all three name tables; the displayed name is built at
      // render time so a language switch relabels the whole drill list
      nameId,
      eco,
      name: eco + " " + (CHESS_OPENING_NAMES[nameId] || nameId),
      line: seq.split(" "),
      idea: idea || "",
    })),
    // The common openings first (v8-0-plan §5 — the list used to open on A01),
    // then ECO order, so the rest reads A→E: flank, then semi-open, then open,
    // then queen's-pawn, then Indian. The book is authored in family order
    // inside each letter, which put A57 next to A08 once 1.15 added the deep
    // lines, and 109 rows in no order at all is a list nobody scrolls twice.
    // Ties go by the Chinese name, not the displayed one: the list order must
    // not shuffle when the interface language changes
    CHESS_OPENING_NAMES);
  /**
   * The same 119 lines, played from the other chair. Nearly half the book is
   * a Black defence — Caro-Kann, French, the whole Sicilian family — and
   * until 2.6 the trainer only let you stand on White's side of them, being
   * shown Black's answers instead of giving them. A sibling puzzle per line,
   * not a runtime mode: as plain puzzles they ride every existing rail —
   * solved/missed keys, the review queue, the picker, tiers — with no special
   * cases. `:b` ids are new keys, so nobody's White progress moves.
   */
  const OPENING_DRILLS_B = OPENING_DRILLS.map((d) => Object.assign({}, d, { id: d.id + ":b", side: "b" }));
  const ALL_PUZZLES = PUZZLES.concat(OPENING_DRILLS, OPENING_DRILLS_B);
  joinMined();
  /**
   * 错题自炼 — the personal book, mined from this player's own analysed
   * games (mistakes.js). Dynamic where ALL_PUZZLES is frozen, so the two are
   * kept apart and joined per read: bookNow() is the whole book *right now*,
   * and it is what every rail that serves puzzles reads — the review queue,
   * the picker, the progress counts. The achievements deliberately keep
   * reading ALL_PUZZLES: badge totals must not drift with a set that grows
   * and retires on its own.
   */
  const Library = ChessLibrary;
  const Mistakes = ChessMistakes;
  function loadMines() {
    const s = Persist.read("mines").value;
    if (!s) return [];
    return s.list.filter((m) => m && m.id && m.fen && Array.isArray(m.solution) && m.solution.length && m.cat === "mine");
  }
  store.session.mines = loadMines();
  function saveMines() { Persist.setJson("mines", { v: 1, list: store.session.mines }); }
  const Progress = ChessProgress;
  const Planner = ChessPlanner;
  store.session.progress = Progress.coerce((() => {
    return Persist.read("progress").value;
  })());
  function saveProgress() { Persist.setJson("progress", store.session.progress); }
  /**
   * The whole book right now: the frozen set, the mined drills, and — since
   * 7.2 — the player's own opening book. All three dynamic sets are joined
   * per read for the same reason: the review queue and the picker look a
   * puzzle up by id, and an id they cannot resolve is a review owed to
   * nothing.
   */
  function bookNow() {
    const rep = REP_DRILLS();
    if (!store.session.mines.length && !rep.length) return ALL_PUZZLES;
    return ALL_PUZZLES.concat(store.session.mines, rep);
  }
  /**
   * Both chairs of the player's own opening book.
   *
   * `RepUI` is created further down this file; every caller of `bookNow()` is
   * a rail that serves a puzzle, and none of them runs before boot has walked
   * past that line. Written as a plain reference deliberately: if that ever
   * stops being true, the app fails loudly at startup rather than quietly
   * serving a book with the repertoire missing from it.
   */
  function REP_DRILLS() { return RepUI.allDrills(); }
  /** Opening drills, built-in or the player's own — one word for both. */
  function isOpeningCat(cat) { return cat === "op" || cat === "rep"; }
  /**
   * Is this category's difficulty a *tactical* difficulty? (7.3 B1)
   *
   * Only those belong on the Glicko scale, because that is the only thing the
   * scale means. A rote line's "difficulty" is `puzzleTier`'s ply count —
   * how much there is to remember — so rating one would let a long variation
   * out of your own imported book move the number that is supposed to say how
   * well you see tactics. 7.2 shipped exactly that.
   *
   * This rule was already written in two places and contradicted in a third:
   * the picker's rated rung excluded opening drills, the task line refused to
   * print their rating — and `ratePuzzleOnce` rated them anyway, every time,
   * since 6.0. One function now, read by all three.
   */
  function isRatedCat(cat) { return !isOpeningCat(cat); }
  /** The tree an opening drill is judged against. */
  function openingTreeFor(p) {
    return p && p.cat === "rep" ? RepUI.treeFor(p.side === "b" ? "b" : "w") : OPENING_TREE;
  }

  /**
   * Rough difficulty tier for a puzzle, derived rather than hand-tagged so it
   * cannot drift out of sync as the set grows: how many moves the solution
   * runs, how crowded the board is, and whether the key move is a quiet one
   * (no check, no capture — the hardest kind to spot).
   * @returns {"easy"|"mid"|"hard"}
   */
  const PUZZLE_TIER_CACHE = new Map();

  function puzzleTier(p) {
    if (PUZZLE_TIER_CACHE.has(p.id)) return PUZZLE_TIER_CACHE.get(p.id);
    let score = 0;
    const line = p.line || p.solution || [];
    const plies = { m1: 1, m2: 3, m3: 5 }[p.cat] || line.length;
    // An opening drill is not a tactic and does not belong on the tactic
    // scale. It has no `fen`, so every term below (men on the board, quiet key
    // move, no capture) silently never ran, leaving score = (plies-1)*1.5 + 3
    // — which is ≥10.5 for the shortest line in the book. Measured on 1.14:
    // all 38 drillable lines scored "hard", and the difficulty filter had
    // therefore never done anything at all in this category. What actually
    // makes a rote line harder is how much of it there is to remember.
    if (isOpeningCat(p.cat)) {
      const tier = plies <= 8 ? "easy" : plies <= 16 ? "mid" : "hard";
      PUZZLE_TIER_CACHE.set(p.id, tier);
      return tier;
    }
    // A real-game tactic is not on the diagram scale either: every one of them
    // has 20+ men, so the crowding term below would land the whole category in
    // the same band. What separates them is how loud the winning move is — a
    // big capture announces itself, a quiet move on a full board does not.
    if (p.cat === "real") {
      const first = line[0] || "";
      const loud = /[+#x]/.test(first);
      const tier = !loud ? "hard" : p.gain >= 5 ? "easy" : p.gain >= 3 ? "mid" : "hard";
      PUZZLE_TIER_CACHE.set(p.id, tier);
      return tier;
    }
    // A defence is as hard as it is narrow — and that is the ONLY thing that
    // varies across this category. Every defensive puzzle is one move long, so
    // the ply term is 0 for all of them, and they all share the same middlegame
    // shape: 9–14 men, a quiet key move, usually no capture. Those constants
    // added ~3.5 to every single one, which put the whole category above the
    // "easy" line no matter how wide the defence was — `def × 简单` was an
    // empty list, and the P5 acceptance rule says an empty combination must
    // not be offered. So `saves` decides it outright, the same way an opening
    // drill is scored on its length alone rather than on the tactic scale.
    if (p.cat === "def" && typeof p.saves === "number") {
      const tier = p.saves >= 4 ? "easy" : p.saves >= 2 ? "mid" : "hard";
      PUZZLE_TIER_CACHE.set(p.id, tier);
      return tier;
    }
    score += (plies - 1) * 1.5;                    // longer forcing lines dominate
    if (p.cat === "tac") score += 1.5;
    if (p.cat === "win" && typeof p.gain === "number" && p.gain <= 3) score += 1; // small wins hide better
    try {
      if (p.fen) {
        const men = (p.fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
        if (men >= 14) score += 2.5; else if (men >= 9) score += 1.5; else if (men >= 6) score += 0.5;
        const first = line[0] || "";
        if (first && !/[+#]/.test(first)) score += 1.5;   // quiet key move
        if (first && !/x/.test(first)) score += 0.5;      // no capture to point the way
        // a lone king opposite has fewer defences to calculate
        const blackMen = (p.fen.split(" ")[0].match(/[a-z]/g) || []).length;
        if (blackMen <= 1) score -= 1;
      }
    } catch (_) {}
    const tier = score >= 6 ? "hard" : score >= 3 ? "mid" : "easy";
    PUZZLE_TIER_CACHE.set(p.id, tier);
    return tier;
  }

  function loadPuzzleState() {
    const s = Persist.read("puzzles").value;
    if (s) {
      if (!s.missed) s.missed = {};
      return s;
    }
    // not written until something is solved: an empty record written at
    // load is what once made `firstRun` false for everybody
    return { v: 1, solved: {}, missed: {}, cat: "m1" };
  }
  store.session.puzzleState = loadPuzzleState();
  function savePuzzleState() {
    Persist.setJson("puzzles", store.session.puzzleState);
  }
  /**
   * Forget the puzzles the book has retired (Codex on #88) — once the mined
   * set has joined, since before that every mined id is merely not here yet.
   * Runs at load when the chunk came first, else when it arrives; written
   * back at once so it does not have to run again.
   */
  function forgetRetired() {
    if (!MINED_ORDINAL.size) return;
    const ids = new Set(ALL_PUZZLES.map((p) => p.id));
    if (ChessDrills.forgetRetired(store.session.puzzleState, (id) => ids.has(id))) savePuzzleState();
  }
  forgetRetired();
  const Srs = ChessSrs;
  // v8-1-plan T6: bank puzzles in the review queue, their bands loaded when due
  const Bank = createBankReview({ Db: ChessPuzzleDb, Srs });
  const Picker = ChessPicker;
  /** reviews served per day before the rest is pushed to tomorrow (Q3.3) */
  const REVIEW_CAP = 20;
  /** how many reviews are owed right now — the count every plan reads */
  function owedNow() {
    // only what the 复习 list can serve — it resolves ids against the book —
    // so every plan's review step can be worked off (Codex on #88). A mined
    // id counts before its chunk joins: it is not served yet, not retired.
    // So does a bank id before its band is here (v8-1-plan T6): the review
    // waits for the band (reviewWaits), and bank-review.js prune() drops an
    // id no band holds.
    // an id every band it could be in has come without is not owed (M3 评审)
    if (Bank.prune(store.session.puzzleState)) savePuzzleState();
    const missed = store.session.puzzleState.missed;
    const book = new Set(bookNow().map((p) => p.id));
    const servable = {};
    for (const id of Object.keys(missed)) {
      if (book.has(id) || isBankId(id) || (!MINED_ORDINAL.size && id.startsWith("mn-"))) servable[id] = missed[id];
    }
    return Srs.dueCount(servable, Date.now());
  }

  /**
   * The `tac` puzzles that continue a lesson, and how many are still unsolved.
   *
   * Matched on the lesson's `practice` motif rather than a hand-written list
   * of puzzle ids: a list would have to be edited every time a puzzle is added
   * to the set, and the one nobody edits is the one that silently stops
   * covering the new puzzles. 缺陷 24.
   * @param {object} L a lesson
   * @returns {{all: object[], total: number, left: number}}
   */
  function practiceLeft(L) {
    const all = L && L.practice
      ? ALL_PUZZLES.filter((p) => p.cat === "tac" && p.motif === L.practice)
      : [];
    return { all, total: all.length, left: all.filter((p) => !store.session.puzzleState.solved[p.id]).length };
  }

  /**
   * v8-1-plan T6: run `then` once the bands of the due bank puzzles are here
   * — the review's withIndex. True when it waits; false, go on now.
   */
  function reviewWaits(then) {
    // the player may have gone elsewhere while the band loaded (startTheme's rule)
    const was = store.session.puzzleState.cat;
    const still = () => store.session.mode === "puzzle" && !store.session.run && store.session.puzzleState.cat === was;
    return Bank.wait(store.session.puzzleState, Date.now(), () => { if (still()) then(); }, () => toast(t("theme.loadFailed"), "fix"));
  }
  /** The queued bank puzzles whose bands are here: what only the picker's review rung reads (M3 评审 P2-1). */
  function reviewBank() {
    const st = store.session.puzzleState;
    return Object.keys(st.missed).filter(isBankId).map((id) => Bank.resolve(st, id)).filter(Boolean);
  }

  /** id → puzzle over the live book, one lookup table per read. */
  function bookFinder() {
    const m = new Map(bookNow().map((p) => [p.id, p]));
    return (id) => m.get(id) || null;
  }

  /** "review" is a virtual category: every puzzle currently in the missed set. */
  function puzzlesInCat(cat) {
    if (isThemeCat(cat)) return Modes.themeList(cat.slice(THEME_CAT.length));
    if (isGroupCat(cat)) return Modes.groupList(cat.slice(GROUP_CAT.length));
    return cat === "review"
      // 6.0 (v6-plan Q3.3): what is due today, most overdue first, at most a
      // day's dose — the rest is scheduled forward by dueQueue() itself so a
      // fortnight away does not arrive as one afternoon. Only what can be served
      // now takes a slot (M3 评审: a bank id whose band is not here waits its turn)
      ? Bank.reviewList(store.session.puzzleState, Date.now(), REVIEW_CAP, bookFinder())
      // the op list shows one chair at a time — the side segment picks which
      : cat === "op" ? ALL_PUZZLES.filter((p) => p.cat === "op" && (p.side === "b") === (store.session.puzzleState.opSide === "b"))
      // the repertoire tab shows one chair at a time too, and for the same
      // reason: a drill is a question asked of the side you are sitting on
      : cat === "rep" ? RepUI.drills(store.session.puzzleState.opSide === "b" ? "b" : "w")
      // v8-1-plan T3: the repertoire's due moves, one card per position, both chairs
      : cat === "repdue" ? RepUI.due()
      : cat === "mine" ? store.session.mines.slice()
      : ALL_PUZZLES.filter((p) => p.cat === cat);
  }

  return {
    onMinedArrived, ALL_PUZZLES, Library, Mistakes, loadMines, saveMines, Progress, Planner,
    saveProgress, bookNow, isOpeningCat, isRatedCat, openingTreeFor, puzzleTier,
    loadPuzzleState, savePuzzleState, Srs, Bank, Picker, owedNow, practiceLeft, reviewWaits,
    reviewBank, puzzlesInCat,
  };
}
