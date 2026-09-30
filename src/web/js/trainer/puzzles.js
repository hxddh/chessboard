/**
 * 谜题：战术训练、开局题、错题自炼与做题评级。
 *
 * The puzzle trainer as it stood in app.js — the book (hand-written, mined,
 * opening drills and the personal book), the state on disk, the ratings, the
 * review queue, the move handler with its engine-checked alternatives, the
 * answer walk and the side panel. Carved out in v8-0-plan F4 without a change
 * in behaviour.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createPuzzlesUI()` (createLibraryUI's shape); nothing here reaches back
 * into app.js. The repertoire, the library and today's plan are created after
 * this module, so app.js hands those in as small forwarders.
 * @module trainer/puzzles
 */
import { Chess } from "../chess.js";
import { ChessDrills } from "../drills.js";
import { ChessEngine } from "../engine.js";
import { ChessLazy } from "../lazy-content.js";
import { ChessLibrary } from "../library.js";
import { ChessMistakes } from "../mistakes.js";
import { ChessOpeningCoach } from "../opening-coach.js";
import { ChessOpeningTree } from "../opening-tree.js";
import { CHESS_OPENINGS, CHESS_OPENING_NAMES } from "../openings.js";
import { ChessPicker } from "../picker.js";
import { ChessPlanner } from "../planner.js";
import { ChessProgress } from "../progress.js";
import { ChessPuzzleDb } from "../puzzle-db.js";
import { CHESS_PUZZLES } from "../puzzles.js";
import { ChessRating } from "../rating.js";
import { ChessSrs } from "../srs.js";
import { createBankReview, isBankId } from "./bank-review.js";
import { createPuzzleModes, isThemeCat, THEME_CAT } from "./puzzle-modes.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createPuzzlesUI(d) {
  const {
    Audio2, BoardView, MINED_ORDINAL, Persist, RepUI, Review, animateReply, appGameOver, avail,
    checkNewAchievements, choosePromotion, clearPreview, clearSelection, confirmNative,
    cursorSquare, dailyJump, dailyStepIsHere, el, evalScalar, gameLoadPgn, gameReset,
    invalidateEngine, kingSquare, loadHistoryRecord, loadLibraryEntry, loadStats, maybeEngineTurn,
    motifKeyOf, moveSound, puzzleIdea, puzzleMotif, puzzleName, renderAchievements,
    renderPuzzleTally, renderRecordEntry, renderRepertoire, renderStats, resetClocks, sanHistory,
    saveGame, saveSettings, selectSquare, setIcon, setText, setViewIndex, sideName, startLearn,
    stopLearn, store, sync, t, tf, toast, writeSan, switchMode, setSideTab, drawRatingTrend,
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
  const PUZZLE_CAT_IDS = ["m1", "m2", "m3", "win", "tac", "real", "def", "draw", "op", "rep", "mine", "review"];
  const PUZZLE_MOVES = { m1: 1, m2: 2, m3: 3 };
  /** scripted-line categories: exact-line play, opponent replies from the script */
  const SCRIPTED_CATS = { win: true, op: true, rep: true, tac: true, draw: true, real: true, mine: true };

  /** A mate in one for whoever is to move in `g`, or null. */
  function mateInOne(g) {
    for (const m of g.moves()) {
      g.move(m);
      const done = g.in_checkmate();
      g.undo();
      if (done) return m;
    }
    return null;
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
  /**
   * Categories where difficulty is a real, separate axis.
   *
   * In the three mate categories it is not. `puzzleTier()`'s dominant term is
   * (plies − 1) × 1.5, and for m1/m2/m3 the ply count is a written-in constant
   * — 1, 3, 5 — contributing 0, 3 and 6 points, while every other term put
   * together moves the score by at most ±4.5, which never crosses a 3-point
   * band boundary. So the tier *was* the category: every mate-in-one came out
   * easy, every mate-in-three hard, and seven of the eighteen
   * category × difficulty combinations were empty. Picking one of those left
   * the list blank — and the filter is remembered, so the next visit to that
   * category looked like an empty puzzle set. 缺陷 14.
   *
   * The fix chosen is (A): stop offering a filter that is a second name for
   * the category. "Mate in two" already says how hard it is. The four
   * categories where the tier is derived from something else — the line's
   * length for openings, how loud the key move is for real games, how many
   * moves hold for defence, and the full score for tactics and captures —
   * keep it.
   *
   * (B) — a solving-cost measure from the engine's first-choice margin —
   * would be better and is not free: it needs an offline pass over 168
   * puzzles and a new field in the data. It stays on the table.
   */
  const TIER_CATS = new Set(["tac", "win", "real", "def", "draw", "op"]);
  function tierApplies(cat) { return TIER_CATS.has(cat); }

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

  /**
   * Move a pre-1.21.3 save off the positional opening-drill ids.
   *
   * Runs once, marked by `idv`. It reads the book as it stands to work out
   * which row each old index named, so it is only correct while the book is
   * the one those indexes were written against — which is why the release
   * carrying this migration must not also change the book.
   */
  function migrateDrillIds(s) {
    if (!s || s.idv >= 2) return s;
    // frozen table, NOT read from the live book — see drills.js. Deriving it
    // meant the migration was only correct for someone upgrading from the
    // exact book it was generated against, which said nothing about a player
    // who skips this release entirely.
    const map = ChessDrills.legacyIdMap();
    ChessDrills.migrateIds(s.solved, map);
    ChessDrills.migrateIds(s.missed, map);
    s.idv = 2;
    return s;
  }

  /** @returns {{state: object, migrated: boolean}} — `migrated` says the ids
      were actually rewritten, which is a different thing from "this profile
      is on the current id version", and the difference is the whole bug */
  function loadPuzzleState() {
    const s = Persist.read("puzzles").value;
    if (s) {
      if (!s.missed) s.missed = {};
      const was = s.idv;
      const out = migrateDrillIds(s);
      return { state: out, migrated: out.idv !== was };
    }
    return { state: { v: 1, idv: 2, solved: {}, missed: {}, cat: "m1" }, migrated: false };
  }
  const loadedPuzzles = loadPuzzleState();
  store.session.puzzleState = loadedPuzzles.state;
  // persist the rewritten ids straight away — a migration that only lives in
  // memory runs again on every launch, and once the book does change it would
  // then be reading positions that no longer mean what they meant.
  //
  // Only when ids actually moved. The test was `idv === 2`, which is equally
  // true of the default this function returns for a profile that has never been
  // touched — so a brand-new user got an empty puzzle record written at import
  // time, and that write is what made `firstRun` false for everybody.
  if (loadedPuzzles.migrated) { Persist.setJson("puzzles", store.session.puzzleState); }
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

  // --- 6.0: ratings (v6-plan Q3.1) -------------------------------------------
  // One Glicko-2 rating for the player, one per puzzle, both moved by the FIRST
  // answer to a puzzle only — a solve after a miss has already been counted as
  // the miss. Hand-written puzzles start from their derived tier, so the first
  // few answers already say something; the lichess import carries its own.
  function playerRating() {
    const st = store.session.puzzleState;
    if (!st.rating) st.rating = ChessRating.newRating();
    settleIdleRating(st);
    return st.rating;
  }

  /**
   * Charge the days since the rating last moved to its deviation.
   *
   * 6.1 review: rating.js documents `rd` as the thing that lets a returning
   * player's rating move again, and nothing in the app ever grew it back —
   * the only path that does was never called from anywhere.
   *
   * Settling also resets the idle clock, which is what makes this safe to call
   * from `playerRating()` on every access: a second call the same second sees
   * no whole day and does nothing. It also makes the charge exact across
   * sessions without a session flag (a flag on `st` would be persisted and
   * then never decay again): `rd²` is additive in days, so thirty daily opens
   * and one thirty-day absence land on the same deviation.
   *
   * `ratedAt` is written by ratePuzzleOnce. An archive from before 7.0 has
   * none, so the last rating-history stamp stands in. Neither present means
   * this rating has never moved — decaying from the epoch would hand every
   * such player a fresh 350 on first launch.
   */
  function settleIdleRating(st) {
    const last = Number(st.ratedAt) ||
      (Array.isArray(st.rhist) && st.rhist.length ? Number(st.rhist[st.rhist.length - 1].t) : 0);
    if (!last) return;
    const days = (Date.now() - last) / 86400000;
    if (!(days >= 1)) return;
    const next = ChessRating.decayIdle(st.rating, days);
    st.ratedAt = Date.now();
    if (next !== st.rating) st.rating = next;
    savePuzzleState();
  }
  function puzzleRating(p) {
    const st = store.session.puzzleState;
    if (!st.pr) st.pr = {};
    if (st.pr[p.id]) return st.pr[p.id];
    if (Number.isFinite(p.rating)) return { r: p.rating, rd: 150, vol: 0.06 };
    const tier = p.cat === "mine" ? "mid" : puzzleTier(p);
    const base = tier === "easy" ? 1200 : tier === "hard" ? 1800 : 1500;
    const bump = p.cat === "m3" ? 100 : p.cat === "m1" ? -100 : 0;
    return { r: base + bump, rd: 200, vol: 0.06 };
  }
  /** @returns {number|null} null for the categories that are not on the scale */
  function puzzleRatingOf(p) { return isRatedCat(p.cat) ? Math.round(puzzleRating(p).r) : null; }
  function ratePuzzleOnce(id, score) {
    const pz = store.session.puzzle;
    if (!pz || pz.p.id !== id || pz.rated || pz.run) return; // a run is not rated (trainer/runs.js)
    if (!isRatedCat(pz.p.cat)) return; // 背谱不是战术水平（7.3 B1）
    if (store.session.puzzleState.solved[id]) return; // not a first attempt
    // …nor is a restart of a missed one (R / 再试一次 builds a new puzzle object,
    // so pz.rated alone forgot it): st.pr[id] is written by the first answer
    // and is what persists it (Codex on #88)
    const pr = store.session.puzzleState.pr;
    if (pr && pr[id]) { pz.rated = true; return; }
    pz.rated = true;
    const st = store.session.puzzleState;
    const before = Math.round(playerRating().r);
    const r = ChessRating.rate1v1(playerRating(), puzzleRating(pz.p), score);
    // v8-0-plan B1: each theme the puzzle belongs to has its own rating
    Modes.rateThemes(pz.p, score, puzzleRating(pz.p));
    // what the answer did to the rating, for the feedback card (7.7 §4)
    pz.rating = { now: Math.round(r.player.r), delta: Math.round(r.player.r) - before,
      provisional: ChessRating.isProvisional(r.player) };
    st.rating = r.player;
    if (!st.pr) st.pr = {};
    st.pr[id] = r.puzzle;
    st.ratedAt = Date.now();
    if (!Array.isArray(st.rhist)) st.rhist = [];
    st.rhist.push({ t: st.ratedAt, r: Math.round(r.player.r) });
    while (st.rhist.length > 60) st.rhist.shift();
  }
  /**
   * "1523", or "1104?" while the rating is provisional (v8-0-plan §5). The
   * ± it used to print beside the number is the tooltip now: 「1104 ±180」
   * read as a measurement with an error bar, where 「?」 says what it is.
   */
  function ratingLabel() {
    const r = playerRating();
    return Math.round(r.r) + (ChessRating.isProvisional(r) ? "?" : "");
  }
  function ratingTip() {
    const r = playerRating();
    return ChessRating.isProvisional(r) ? tf("rec.ratingRd", [Math.round(r.rd)]) : "";
  }
  function markMissed(id) {
    // Only a puzzle the book can still serve (7.4 D5). The one on screen can
    // outlive its book: replacing or clearing the repertoire (or a mined
    // drill retiring) forgets the ids, but the board keeps the drill — and a
    // wrong move on it then wrote the id straight back into the queue, a
    // review `owedNow()` counts for ever and nothing can hand out.
    // A Lichess puzzle is not in the book: v8-0-plan B1 left it out of the
    // queue for that reason. v8-1-plan T6 queues its id and notes its band,
    // and the review waits for the band when it is due (bank-review.js).
    const pz = store.session.puzzle;
    const lc = pz && pz.p.id === id && pz.p.src === "lichess" ? pz.p : null;
    const p = lc || bookNow().find((x) => x.id === id);
    if (!p) return;
    store.session.puzzleState.missed[id] = Srs.onMiss(store.session.puzzleState.missed[id], Date.now());
    if (lc) Bank.note(store.session.puzzleState, lc);
    // 6.0 (v6-plan Q3.1): the first answer to a puzzle moves both ratings
    ratePuzzleOnce(id, 0);
    // …and into the lifetime tally, which unlike the queue survives
    // graduation — it is the memory 为你出一题 reads (see picker.js)
    Picker.recordAnswer(store.session.puzzleState, p.cat, true, motifKeyOf(p));
    // …and into this week's bucket — the tally is the total, this is the change
    Progress.recordAnswer(store.session.progress, p.cat, true, Date.now());
    saveProgress();
    savePuzzleState();
  }
  /**
   * A clean solve advances the puzzle towards leaving the review queue — it no
   * longer graduates on the first correct answer, which was usually given
   * moments after reading the solution.
   */
  function clearMissed(id) {
    // owed by count, or served by date from the retention ladder — either way
    // a clean solve advances it; a retention entry solved early (from its own
    // category, before its date) is left where it is
    const cur = store.session.puzzleState.missed[id];
    if (!Srs.isDue(cur) && !Srs.dueBy(cur, Date.now())) return;
    const next = Srs.onSolve(store.session.puzzleState.missed[id], Date.now());
    if (next) store.session.puzzleState.missed[id] = next;
    else { delete store.session.puzzleState.missed[id]; Bank.forget(store.session.puzzleState, id); }
    savePuzzleState();
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
    const base = cat === "review"
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
    // "Review" is not a difficulty band — it is exactly the set of puzzles this
    // player got wrong. Filtering it by an automatically derived tier hides the
    // very puzzles they asked to redo (a queue of three could show as empty),
    // so the tier row does not apply here.
    if (cat === "review" || !tierApplies(cat) || store.session.puzzleTierFilter === "all") return base;
    return base.filter((p) => puzzleTier(p) === store.session.puzzleTierFilter);
  }

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
  /**
   * The drill an opening puzzle in progress is actually on (7.6).
   *
   * The trainer accepts any book move and the opponent answers from the whole
   * tree, so a few plies in, the board can be on a different line from the
   * one the puzzle was opened as: 1.e4 is accepted in A01's drill, and C54's
   * can end in the Rossolimo. The title, the 「背谱完成」 toast and the credit
   * all used to name the line it started as — so finishing the Rossolimo
   * marked the Italian learnt. They follow the board now: the puzzle's own
   * line while the path is still on it, else the shortest drill the path is
   * still on, and at a leaf the line that ends there.
   */
  /** Every drill of this opening drill's book, in its chair. */
  function opPool(p) {
    const side = p.side === "b" ? "b" : undefined;
    return p.cat === "rep" ? RepUI.drills(side === "b" ? "b" : "w")
      : ALL_PUZZLES.filter((q) => q.cat === "op" && q.side === side);
  }
  function opCurrent(pz) {
    const p = pz && pz.p;
    // a due card is its own position, never a line to be credited (v8-1-plan T3)
    if (p && p.card) return p;
    if (!p || !isOpeningCat(p.cat) || !Array.isArray(pz.opPath)) return p;
    const path = pz.opPath;
    const onLine = (q) => path.length <= q.line.length && path.every((san, i) => q.line[i] === san);
    if (onLine(p)) return p;
    const side = p.side === "b" ? "b" : undefined;
    let best = null;
    for (const q of opPool(p)) if (onLine(q) && (!best || q.line.length < best.line.length)) best = q;
    if (best) return best;
    // a leaf shorter than a drill (drills.js keeps >=6 plies): name it from
    // the book's own row, but credit the drill that was opened — a leaf that
    // short is not a drill, so an id minted for it would be counted nowhere
    // (not in 背下来 N/M, not by the daily plan's opening step; Codex on #79)
    const leaf = ChessOpeningTree.nodeAt(openingTreeFor(p), path);
    const ln = leaf && !Object.keys(leaf.children).length && leaf.lines[0];
    if (!ln || p.cat !== "op") return p;
    return { id: p.id, cat: "op", side,
      nameId: ln.id, eco: ln.eco, name: ln.eco + " " + (CHESS_OPENING_NAMES[ln.id] || ln.id),
      line: ln.sans.slice(), idea: ln.idea || "" };
  }

  /**
   * An opening drill's move, judged against the tree rather than one line.
   * @returns {boolean} true when this call handled the move entirely
   */
  function opTreeMove(g, mv) {
    const pz = store.session.puzzle;
    if (pz.p.card) return cardMove(g, mv);
    const path = g.history();
    const before = path.slice(0, -1);
    const tree = openingTreeFor(pz.p);
    const kids = ChessOpeningTree.childrenAt(tree, before);
    if (!kids.length) { puzzleSolved(); return true; } // already at a leaf
    if (!kids.some((k) => k.san === mv.san)) {
      // explain against the book move the player was rehearsing when it is
      // one of the options here, else the main one
      const book = kids.some((k) => k.san === pz.p.line[before.length]) ? pz.p.line[before.length] : kids[0].san;
      const why = openingWhy(g, mv, book);
      // 7.2: in your OWN book there is nothing to withhold. The built-in drills
      // make you find the book move — that is the exercise, and 「答案」 is
      // there when you cannot. A repertoire line is a thing you decided to
      // play and are trying to remember, so being told which move that was is
      // the whole exercise, not the end of it.
      puzzleWrong(pz.p.cat === "rep" ? why + " · " + tf("pz.repBook", [book]) : why);
      return true;
    }
    pz.stage++;
    pz.opPath = path.slice();
    let after = ChessOpeningTree.childrenAt(tree, path);
    if (after.length) {
      const reply = ChessOpeningTree.weightedPick(tree, path) || after[0].san;
      const rm = g.move(reply);
      if (rm) {
        pz.last = { from: rm.from, to: rm.to };
        animateReply(rm);
        moveSound(rm, g);
        pz.stage++;
        pz.opPath = g.history();
        after = ChessOpeningTree.childrenAt(tree, pz.opPath);
      }
    }
    if (!after.length) {
      // the leaf reached is a line of its own: mark it learnt too, in the
      // chair it was played from. The one the board is on is left for
      // puzzleSolved(), which credits it with the tally and the week too.
      const leaf = ChessOpeningTree.nodeAt(tree, pz.opPath);
      const onBoard = opCurrent(pz).id;
      // only ids that are drills: a book row shorter than a drill has no
      // puzzle of its own, and a key minted for it is counted nowhere
      const drillIds = new Set(opPool(pz.p).map((q) => q.id));
      for (const ln of (leaf && leaf.lines) || []) {
        // the repertoire's rows carry their own ids (repertoire.js mints them
        // once, from the moves); the ECO book's are derived from the row
        const id = (pz.p.cat === "rep" ? ln.id : Drills.drillId(ln.eco, ln.sans.join(" ")))
          + (pz.p.side === "b" ? ":b" : "");
        if (id !== onBoard && drillIds.has(id) && !store.session.puzzleState.solved[id]) {
          store.session.puzzleState.solved[id] = true;
        }
      }
      // …and so is every shorter drill the path played through from end to
      // end — the puzzle's own line among them when it was a prefix of this
      // one. A line the path left is not: it was not played.
      const path = pz.opPath;
      for (const q of opPool(pz.p)) {
        if (q.id !== onBoard && q.line.length < path.length && q.line.every((san, i) => path[i] === san)) {
          store.session.puzzleState.solved[q.id] = true;
        }
      }
      puzzleSolved();
      return true;
    }
    sync();
    return true;
  }

  /**
   * v8-1-plan T3: a due card's one question — the move your book plays here
   * (any of them, when it plays several). The first answer is the grade;
   * a retry after a miss, or after 「答案」, does not grade it again.
   */
  function gradeCard(ok) {
    const pz = store.session.puzzle;
    if (!pz.p.card || pz.graded) return;
    pz.graded = true;
    RepUI.grade(pz.p, ok);
  }
  function cardMove(g, mv) {
    const pz = store.session.puzzle;
    if (!pz.p.answers.includes(mv.san)) {
      const why = openingWhy(g, mv, pz.p.answers[0]);
      gradeCard(false);
      puzzleWrong(why + " · " + tf("pz.repBook", [pz.p.answers.join(" / ")]));
      return true;
    }
    pz.stage++;
    pz.opPath = g.history();
    puzzleSolved();
    return true;
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

  /**
   * Sit in a chair the repertoire actually has lines for.
   *
   * The 开局书 tab is drawn from `RepUI.total()` — both books together — while
   * the list it serves is one chair at a time. Import a Black book only, and
   * the tab appears while `opSide` still says White: the category is empty,
   * the guard below falls back to 一步杀, and the side segment never gets
   * drawn because nobody ever entered the category. The book is there and
   * there is no way in. Same rule 「开始背」 already follows.
   */
  function seatRepSide() {
    const cur = store.session.puzzleState.opSide === "b" ? "b" : "w";
    if (RepUI.drills(cur).length || !RepUI.total()) return;
    store.session.puzzleState.opSide = cur === "w" ? "b" : "w";
    savePuzzleState();
  }

  /** startPuzzles has waited once for the repertoire's chunk (M3 评审) */
  let repWaited = false;
  function startPuzzles() {
    // v8-0-plan B1: a theme resumes as a theme (its bands load first)
    if (isThemeCat(store.session.puzzleState.cat)) { Modes.startTheme(store.session.puzzleState.cat.slice(THEME_CAT.length)); return; }
    let cat = PUZZLE_CAT_IDS.includes(store.session.puzzleState.cat) || store.session.puzzleState.cat === "repdue" ? store.session.puzzleState.cat : "m1";
    // the due list is chunk-rep.js's: at launch it may still be booting — wait
    // for it once rather than read "nothing due" off a list not there yet (M3 评审)
    if (cat === "repdue" && !RepUI.booted() && !repWaited) {
      repWaited = true;
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
      stars: [],
      cursor: cursorSquare(),
      // the drag is part of the picture, not a thing pushed in beforehand
      drag: store.ui.dragging,
    };
  }

  function matingMovesOf(g) {
    return g.moves({ verbose: true }).filter((m) => {
      g.move(m); const mate = g.in_checkmate(); g.undo(); return mate;
    });
  }

  /** White to move: some move forces mate within n white moves. */
  function whiteHasForcedMate(g, n) {
    for (const m of g.moves()) {
      g.move(m);
      const mate = g.in_checkmate();
      const deeper = !mate && n > 1 && !g.game_over() && blackForcedLost(g, n - 1);
      g.undo();
      if (mate || deeper) return true;
    }
    return false;
  }

  /** Black to move: EVERY reply loses to a forced mate within n white moves. */
  function blackForcedLost(g, n) {
    const replies = g.moves();
    if (!replies.length) return false; // stalemate/over — black escaped
    for (const r of replies) {
      g.move(r);
      const lost = whiteHasForcedMate(g, n);
      g.undo();
      if (!lost) return false;
    }
    return true;
  }

  /** A black reply that refutes the mate threat within n, or null if none. */
  function findRefutation(g, n) {
    for (const r of g.moves()) {
      g.move(r);
      const lost = whiteHasForcedMate(g, n);
      g.undo();
      if (!lost) return r;
    }
    return null;
  }

  /** Black's toughest defense: needs the deepest mate (ties: fewest maters). */
  function bestDefense(g, n) {
    let best = null, bestDepth = -1, bestMaters = Infinity;
    for (const r of g.moves()) {
      g.move(r);
      let d = 1;
      while (d < n && !whiteHasForcedMate(g, d)) d++;
      const maters = matingMovesOf(g).length;
      g.undo();
      if (d > bestDepth || (d === bestDepth && maters < bestMaters)) {
        bestDepth = d; bestMaters = maters; best = r;
      }
    }
    return best;
  }

  function puzzleGoalText() {
    // an opening drill is titled by the line the board is on (7.6)
    const p = opCurrent(store.session.puzzle);
    if (p.cat === "mine") {
      const cost = p.loss != null ? " · " + tf("pz.mineCost", [(p.loss / 100).toFixed(1)]) : "";
      return tf("pz.goalMine", [p.played]) + cost;
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

  /**
   * 5.1: the personal drill asks "what should I have played" and until now
   * accepted exactly one string — the engine's first choice at the budget of
   * the pass that minted it. Any other sound move was "weaker" (audit F3).
   * Now a different move is checked against the stored answer at the same
   * budget: costs less than a mistake, it is accepted and remembered.
   */
  async function verifyAlt(mv, opts) {
    const pz = store.session.puzzle;
    const p = pz.p;
    const g = pz.g;
    if (!ChessEngine || !ChessEngine.isReady || !ChessEngine.isReady()) return null;
    const stored = puzzleScript(p)[0];
    if (!stored) return null;
    // 120 and not SCAN_BUDGET: this is what a drill mined BEFORE the budget
    // was stored was mined at. It is a fact about old records, not a default
    // for new work — raising it here would claim those drills were searched
    // deeper than they were, and the whole point of storing the budget is
    // that a shallower pass may not overrule a deeper one (5.1, audit F2).
    const budget = (p.rev && p.rev.budget) || 120;
    const side = p.fen.split(" ")[1];
    const afterAlt = g.fen();
    const probe = new Chess(p.fen);
    if (!probe.move(stored)) return null;
    const afterBest = probe.fen();
    pz.verifying = true;
    sync();
    let eBest = null, eAlt = null;
    try {
      eBest = await ChessEngine.analyze(afterBest, budget);
      eAlt = await ChessEngine.analyze(afterAlt, budget);
    } catch (_) {}
    pz.verifying = false;
    if (store.session.puzzle !== pz || pz.done) return null;
    const cpBest = evalScalar(eBest), cpAlt = evalScalar(eAlt);
    if (cpBest == null || cpAlt == null) return null;
    const v = Mistakes.judgeAlt(cpBest, cpAlt, side, Review.MISTAKE);
    if (v.ok && opts && opts.remember) {
      p.alts = Array.isArray(p.alts) ? p.alts : [];
      if (!p.alts.includes(mv.san)) { p.alts.push(mv.san); saveMines(); }
    }
    return v;
  }
  const verifyMineAlt = (mv) => verifyAlt(mv, { remember: true });

  /** Why the stored answer is the answer — from the numbers the pass kept. */
  function mineWhy(p) {
    const rest = typeof p.pv === "string" ? p.pv.split(" ").slice(1, 4).join(" ") : "";
    const loss = p.loss != null ? (p.loss / 100).toFixed(1) : null;
    let why = loss != null ? tf("pz.mine.whyLoss", [p.played, loss]) : "";
    if (rest) why += (why ? " " : "") + tf("pz.mine.whyLine", [p.solution[0], rest]);
    return why;
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
      if (mv.san === p.played) { puzzleWrong(t("pz.mine.repeat") + " —— " + mineWhy(p)); return; }
      verifyMineAlt(mv).then((v) => {
        if (store.session.puzzle !== undefined && store.session.puzzle && store.session.puzzle.p === p) {
          if (v && v.ok) { toast(tf("pz.mine.alsoFine", [mv.san, (v.loss / 100).toFixed(1)])); puzzleSolved(); return; }
          const cost = v ? " —— " + tf("pz.mine.altCost", [(v.loss / 100).toFixed(1)]) : "";
          puzzleWrong(t("pz.mine.stronger") + cost);
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

  /**
   * Say why an opening move is wrong, not merely that it is.
   *
   * "这不是谱着" is a fact about a line the player has not memorised yet, which
   * is exactly what they came here to learn — it teaches nothing. The coach
   * names the principle instead. `g` already has the move on the board, so
   * everything before it is the drill so far.
   */
  function openingWhy(g, mv, bookSan) {
    const Coach = ChessOpeningCoach;
    if (!Coach || !bookSan) return t("pz.offBook");
    let r = null;
    try { r = Coach.critique(store.session.puzzle.p.fen || "", g.history().slice(0, -1), mv.san, bookSan, Chess); }
    catch (_) { r = null; }
    if (!r) return t("pz.offBook");
    // the coach knows nothing about the dictionary, so a piece comes back as
    // its key ("piece.n") and is turned into a word here
    const vals = r.vals.map((v) => (typeof v === "string" && v.startsWith("piece.") ? t(v) : v));
    return tf(r.key, vals);
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
    setText(meta, parts.join(" · "));
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
      sub: (clean ? verb + " · " : "") + puzzleName(sp) + (why ? " · " + why : "") };
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

  /** The 执白/执黑 row exists only where there are two chairs: the op list. */
  function syncOpSideSeg(cat) {
    avail(el("row-op-side"), isOpeningCat(cat));
    const side = store.session.puzzleState.opSide === "b" ? "b" : "w";
    document.querySelectorAll("#op-side-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.side === side);
    });
  }

  /**
   * 5.2: the engine's line under a solved personal drill, as chips — the
   * same chips the review's 引擎主变 uses, but here a click WALKS the puzzle
   * board to that move, because the trainer owns the board and a preview
   * would yield to it. 题面 comes first and takes the board back.
   */
  function puzzleLineSans(p) {
    if (!p || p.cat !== "mine" || !p.solution || !p.solution[0]) return [];
    const pv = typeof p.pv === "string" ? p.pv.split(" ").filter(Boolean) : [];
    const line = pv.length && pv[0] === p.solution[0] ? pv : [p.solution[0]].concat(pv.slice(0, 4));
    // only as far as the position actually allows — a revised answer may
    // have orphaned an older continuation
    const g = new Chess(p.fen);
    const ok = [];
    for (const san of line.slice(0, 6)) { if (!g.move(san)) break; ok.push(san); }
    return ok;
  }
  function walkPuzzleLine(k) {
    const pz = store.session.puzzle;
    if (!pz || !pz.done) return;
    const sans = puzzleLineSans(pz.p);
    const g = new Chess(pz.p.fen);
    let last = null;
    for (let i = 0; i <= k && i < sans.length; i++) {
      const m = g.move(sans[i]);
      if (!m) break;
      last = { from: m.from, to: m.to };
    }
    pz.g = g;
    pz.last = last;
    pz.lineAt = k;
    store.game.selection = null;
    BoardView.cancelAnim();
    store.commit("game", "sync");
  }
  function renderPuzzleLine() {
    const el = document.getElementById("puzzle-line");
    if (!el) return;
    const pz = store.session.puzzle;
    const sans = pz && pz.done ? puzzleLineSans(pz.p) : [];
    el.hidden = !sans.length;
    el.replaceChildren();
    if (!sans.length) return;
    const lab = document.createElement("span");
    lab.className = "pv-label";
    lab.textContent = t("pz.line");
    el.appendChild(lab);
    const at = Number.isInteger(pz.lineAt) ? pz.lineAt : sans.length - 1;
    const start = pz.p.fen.split(" ")[1] === "b" ? "b" : "w";
    const chip = (text, k, color) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "pv-chip" + (k === at ? " active" : "");
      b.dataset.k = String(k);
      if (color) writeSan(b, text, color); else b.textContent = text;
      b.onclick = () => walkPuzzleLine(k);
      el.appendChild(b);
    };
    chip(t("pz.lineStart"), -1, null);
    sans.forEach((san, k) => chip(san, k, k % 2 === 0 ? start : (start === "w" ? "b" : "w")));
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
      if (b.dataset.cat === "review") b.textContent = t("pz.cat.review") + (missedCount ? "·" + missedCount : "");
      if (b.dataset.cat === "mine") b.hidden = !store.session.mines.length;
      if (b.dataset.cat === "rep") b.hidden = !RepUI.total();
    });
    const task = document.getElementById("puzzle-task");
    if (task) {
      // 「第 N 题」 is the chip's job now (7.3 B4) — the card carries the goal,
      // the detail and, where there is one, the puzzle's rating
      task.textContent = store.session.puzzle.done
        ? t("pz.solvedNext")
        : puzzleGoalText()
          + (puzzleRatingOf(store.session.puzzle.p) != null
            ? " · " + tf("pz.ratingOf", [puzzleRatingOf(store.session.puzzle.p)]) : "");
    }
    renderPuzzleLine();
    renderPuzzleFeedback();
    // opening drills are rote memorisation without the "why" — show the idea
    const ideaEl = document.getElementById("puzzle-idea");
    if (ideaEl) {
      const idea = puzzleIdea(opCurrent(store.session.puzzle));
      ideaEl.hidden = !idea;
      ideaEl.textContent = idea ? t("pz.idea") + " · " + idea : "";
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
        const len = isOpeningCat(p.cat) ? "  " + Math.ceil(p.line.length / 2) + t("pz.moveUnit") : "";
        b.textContent = (store.session.puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + puzzleName(p) + len;
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
  // v8-0-plan B1: 冲刺 / 连胜, the themes, the rating on the view (puzzle-modes.js)
  const Modes = createPuzzleModes({
    doc: document, store, t, tf, el, avail, setText, sync, toast, Audio2, drawRatingTrend,
    ALL_PUZZLES, isRatedCat, puzzleRating, playerRating, motifKeyOf,
    savePuzzleState, saveSettings, switchMode, setSideTab, seatPuzzle, startPuzzles, puzzleHumanSide,
  });

  return {
    wirePuzzlePanel,
    onMinedArrived, ALL_PUZZLES, Library, Mistakes, loadMines, saveMines, Progress, Planner,
    saveProgress, bookNow, loadPuzzleState, savePuzzleState, Srs, Picker,
    owedNow, ratingLabel, ratingTip, practiceLeft, puzzlesInCat,
    startPuzzleAt, startPuzzles, stopPuzzles, puzzleModel, puzzleHumanSide, puzzleClick,
    showPuzzleAnswer, leaveTrainer, nextPuzzle, syncPuzzleUI, closeThemes: () => Modes.closeThemes(),
  };
}
