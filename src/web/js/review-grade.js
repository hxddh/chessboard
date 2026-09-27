/**
 * Move grades and key moments (v8-0-plan B2).
 *
 * Through 7.9 a move was either unmarked or one of `?!` `?` `??`, and a game
 * had one "turning point". This module grades every move on the scale the
 * online platforms use — 妙着 / 仅此一着 / 最佳 / 优秀 / 良好 / 谱着 /
 * 错失良机 / 小失误 / 失误 / 严重失误 — and picks three key moments per
 * side, as data: the review view (v8-0-plan A4) draws them, this decides them.
 *
 * Every threshold is stated in the mover's win-percentage points (review.js
 * winPct: lichess's curve), the unit the `?!` / `?` / `??` cut-offs already
 * use, so one scale runs from "best" to "blunder" with no seam. The upper
 * cut-offs are chess.com's published expected-points bands read as win %:
 * best 0, excellent < 2, good < 5, then 5 / 10 / 20 — the last three are
 * review.js's own, unchanged. What chess.com states only in words (only
 * move, brilliant, miss) is pinned to numbers here, each beside its rule.
 *
 * `?!` / `?` / `??` (review.js classifyByWinPct) stay exactly what they
 * were: the grade is a second, finer reading of the same drops, never a
 * replacement — mistake mining, the curve's dots and every count read tags.
 *
 * Pure: analysis arrays in, grade ids out. The engine was paid for by the
 * pass (review-pass.js); chess.js is passed in, as mistakes.js takes it.
 * @module review-grade
 */
import { ChessReview as Review } from "./review.js";

/**
 * Best (最佳): the engine's own first choice at that position, or a move it
 * rates no worse than that choice to within rounding — a transposition, or
 * an equal alternative the search happened to rank second.
 */
const BEST_EPS = 0.5;
/** Excellent (优秀): gives away less than 2 points. */
const EXCELLENT = 2;
/** Good (良好): less than the `?!` line (5 points) — anything more is marked. */
const GOOD = Review.WIN_INACCURACY;

/**
 * Only move (仅此一着): the move played is the engine's first choice, and
 * every other move is at least a `?` — the second-best line scores ≥ 10
 * points worse for the mover (lichess's `?` line, so "the alternative would
 * have been a mistake") — and that gap crosses a result line: the best keeps
 * the mover ≥ 70 (winning) and the second falls under it, or the best keeps
 * ≥ 30 (not lost) and the second falls under that. Ten points between 93 and
 * 83 is two ways to win; the first test run on the corpus called 16% of all
 * moves "only" without this, most of them in positions already won.
 * Confirmed by the deeper MultiPV search, never by the quick scan alone, and
 * not awarded for:
 *   - a position with one legal move (forced, not found);
 *   - taking back a piece on the square the opponent just captured on — a
 *     recapture is the only move far more often than it is a discovery.
 */
const ONLY_GAP = Review.WIN_MISTAKE;
const WINNING = 70, LOST = 30;

/**
 * Brilliant (妙着): the engine's first choice, confirmed deeper, every other
 * move ≥ 10 points worse (the only-move gap, without the result-line test —
 * Morphy's 16.Qb8+ is mate in two against an alternative that merely stays
 * +3.6, and it is the textbook brilliancy), not a recapture or forced, and a
 * sacrifice the engine accepts on the opponent's behalf — along the engine's
 * best reply line, the mover is at least 2 pawns (a piece for a pawn) down on
 * material after the opponent's reply, and still after the reply after that
 * where the line is that long — while the mover's win % after the move stays
 * ≥ 50. A trade (Bxc6 bxc6) is level again by the second check; a piece left
 * hanging that the best line declines is not "engine-confirmed" and is not
 * counted, on purpose.
 */
const SAC_PAWNS = 2;
const BRILLIANT_MIN_AFTER = 50;

/**
 * Missed win (错失良机): the opponent's previous move was a `?` or `??`
 * (dropped ≥ 10) and left the mover clearly better (win ≥ 65 before this
 * move), and this move gave ≥ 10 of it back — while leaving the mover at
 * ≥ 40, i.e. not lost. Throwing a win into a loss is a blunder and stays
 * graded one; this is the chance not taken.
 */
const MISS_OPP_DROP = Review.WIN_MISTAKE;
const MISS_FROM = 65;
const MISS_DROP = Review.WIN_MISTAKE;
const MISS_FLOOR = 40;

/**
 * Book (谱着): the position after the move is in the ECO table and every move
 * before it was too (a game that leaves the book and transposes back later
 * is not "still in theory"), and the move is not a `?` / `??` — the table
 * carries some dubious gambits, and a book name must not excuse a mistake.
 */
const BOOK_MAX_DROP = Review.WIN_MISTAKE;

/**
 * Which positions the pass searches again, deeper, with MultiPV 3: both
 * sides of a move that drops ≥ 5 points (the `?!` line), and the position
 * before an only-move candidate from the quick scan (played the first
 * choice, second line ≥ 10 worse) — the candidate is the deep search's first
 * line there, which carries the reply the brilliancy test reads. The deeper
 * search is DEEP_FACTOR × the pass budget.
 */
const DEEP_TRIGGER = Review.WIN_INACCURACY;
const DEEP_FACTOR = 3;
const DEEP_MULTIPV = 3;

/** Key moments per side, ranked by win % swing, none under the `?!` line. */
const MOMENTS_PER_SIDE = 3;
const MOMENT_MIN = Review.WIN_INACCURACY;

/** Every grade, strongest praise first. */
const GRADES = ["brilliant", "only", "best", "excellent", "good", "book", "miss", "inaccuracy", "mistake", "blunder"];

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Win % for `side`, from a White-view scalar. */
function sideWin(scalar, side) {
  const w = Review.winPct(scalar);
  return w == null ? null : (side === "w" ? w : 100 - w);
}

/** Who plays ply `i` — read off the FEN, the analyser's own rule. */
function moverAt(fens, i) {
  return fens[i].split(" ")[1] === "b" ? "b" : "w";
}

/** chess.js's verbose move for `san` at `fen`, or null. */
function verbose(fen, san, Chess) {
  try { return new Chess(fen).move(san, { sloppy: true }) || null; } catch (_) { return null; }
}

function uciOf(m) {
  return m ? m.from + m.to + (m.promotion || "") : null;
}

/** Material balance for `side` in pawns (own − opponent's). */
function balance(chess, side) {
  let own = 0, opp = 0;
  for (const row of chess.board()) for (const sq of row) {
    if (!sq) continue;
    if (sq.color === side) own += VALUE[sq.type]; else opp += VALUE[sq.type];
  }
  return own - opp;
}

/**
 * How many pawns the move gives up along the engine's best reply line: the
 * smaller loss of the two checks (after the reply, and after the reply to
 * the reply), 0 when either check is level or better.
 * @param {string} fen before the move
 * @param {string} san the move
 * @param {string|null} replyPv the best line from the position after it, SAN, space-separated
 */
function sacrificed(fen, san, replyPv, Chess) {
  if (typeof replyPv !== "string" || !replyPv) return 0;
  const g = new Chess(fen);
  const side = g.turn();
  const b0 = balance(g, side);
  if (!g.move(san, { sloppy: true })) return 0;
  const line = replyPv.split(" ").filter(Boolean);
  const checks = [];
  for (let k = 0; k < line.length && k < 3; k++) {
    if (!g.move(line[k], { sloppy: true })) break;
    if (k === 0 || k === 2) checks.push(b0 - balance(g, side));
  }
  if (!checks.length) return 0;
  return Math.max(0, Math.min(...checks));
}

/** Did ply `i` take back on the square ply `i − 1` captured on? */
function isRecapture(fens, sans, i, Chess) {
  if (i < 1) return false;
  const prev = verbose(fens[i - 1], sans[i - 1], Chess);
  const cur = verbose(fens[i], sans[i], Chess);
  return !!(prev && cur && prev.captured && cur.captured && prev.to === cur.to);
}

/** Does going from `best` to `second` (mover's win %) cross a result line? */
function crossesLine(best, second) {
  return (best >= WINNING && second < WINNING) || (best >= LOST && second < LOST);
}

/**
 * The line after ply `i` in SAN: the search's own continuation of the move
 * (its first line starts with it), else the line searched after it.
 */
function replyLine(p, i) {
  const line = p.pvs && typeof p.pvs[i] === "string" ? p.pvs[i].split(" ") : [];
  return line[0] === p.sans[i] ? line.slice(1).join(" ") : (p.pvs ? p.pvs[i + 1] : null);
}

/**
 * The positions the pass should search again, deeper — see DEEP_TRIGGER.
 * @param {object} p the pass so far: fens, sans, scalars, bests, seconds, deep, terminal
 * @returns {number[]} position indices not yet deepened, ascending
 */
function deepTargets(p, Chess) {
  const want = new Set();
  for (let i = 0; i < p.sans.length; i++) {
    const a = p.scalars[i], b = p.scalars[i + 1];
    if (a == null || b == null) continue;
    const side = moverAt(p.fens, i);
    const drop = Review.winPctDrop(a, b, side);
    if (drop >= DEEP_TRIGGER) { want.add(i); want.add(i + 1); continue; }
    // an only-move or brilliancy candidate needs only the position before it:
    // the move is the engine's first line there, which carries the reply too
    if (!(p.seconds && p.seconds[i] != null && p.bests[i])) continue;
    const before = sideWin(a, side), second = sideWin(p.seconds[i], side);
    if (before - second < ONLY_GAP || uciOf(verbose(p.fens[i], p.sans[i], Chess)) !== p.bests[i]) continue;
    if (crossesLine(before, second) || sacrificed(p.fens[i], p.sans[i], replyLine(p, i), Chess) >= SAC_PAWNS) want.add(i);
  }
  return [...want].filter((k) => !(p.deep && p.deep[k]) && !(p.terminal && p.terminal[k])).sort((x, y) => x - y);
}

/**
 * Book plies: true for each move whose resulting position `inBook` knows,
 * up to the first one it does not (see BOOK_MAX_DROP for why contiguous).
 * @param {string[]} fens positions, [0] = start
 * @param {(fen: string) => boolean} inBook
 */
function bookPlies(fens, inBook) {
  const out = [];
  let open = true;
  for (let i = 0; i + 1 < fens.length; i++) {
    open = open && !!inBook(fens[i + 1]);
    out.push(open);
  }
  return out;
}

/**
 * One grade per ply, or null where a side of the move was not measured.
 * @param {object} p fens, sans, scalars, bests, seconds, pvs (SAN strings,
 *   per position), deep (per position), book (per ply)
 * @returns {Array<string|null>} ids from GRADES
 */
function gradeMoves(p, Chess) {
  const out = [];
  const drops = p.sans.map((_, i) => (p.scalars[i] == null || p.scalars[i + 1] == null ? null
    : Review.winPctDrop(p.scalars[i], p.scalars[i + 1], moverAt(p.fens, i))));
  for (let i = 0; i < p.sans.length; i++) {
    const drop = drops[i];
    if (drop == null) { out.push(null); continue; }
    const side = moverAt(p.fens, i);
    const tag = Review.classifyByWinPct(drop);
    const before = sideWin(p.scalars[i], side), after = sideWin(p.scalars[i + 1], side);
    const m = verbose(p.fens[i], p.sans[i], Chess);
    const isBest = !!m && !!p.bests && uciOf(m) === p.bests[i];
    if (p.book && p.book[i] && drop < BOOK_MAX_DROP) { out.push("book"); continue; }
    const confirmed = !!(p.deep && p.deep[i]);
    const second = p.seconds ? p.seconds[i] : null;
    const gap = second == null ? null : before - sideWin(second, side);
    let unique = false;
    if (confirmed && isBest && gap != null && gap >= ONLY_GAP) {
      const legal = new Chess(p.fens[i]).moves().length;
      unique = legal > 1 && !isRecapture(p.fens, p.sans, i, Chess);
    }
    if (unique && after >= BRILLIANT_MIN_AFTER &&
        sacrificed(p.fens[i], p.sans[i], replyLine(p, i), Chess) >= SAC_PAWNS) { out.push("brilliant"); continue; }
    if (unique && crossesLine(before, before - gap)) { out.push("only"); continue; }
    const oppDrop = i > 0 ? drops[i - 1] : null;
    if (oppDrop != null && oppDrop >= MISS_OPP_DROP && before >= MISS_FROM && drop >= MISS_DROP && after >= MISS_FLOOR) {
      out.push("miss"); continue;
    }
    if (tag === "??") out.push("blunder");
    else if (tag === "?") out.push("mistake");
    else if (tag === "?!") out.push("inaccuracy");
    else if (isBest || drop < BEST_EPS) out.push("best");
    else if (drop < EXCELLENT) out.push("excellent");
    else out.push("good"); // < GOOD: anything from GOOD up carries a tag
  }
  return out;
}

/** The interface key naming each grade; the three marks keep their own. */
const LABEL = {
  brilliant: "rv.grade.brilliant", only: "rv.grade.only", best: "rv.grade.best",
  excellent: "rv.grade.excellent", good: "rv.grade.good", book: "rv.grade.book", miss: "rv.grade.miss",
  inaccuracy: "rv.kind.soft", mistake: "rv.kind.mid", blunder: "rv.kind.bad",
};
/** The two grades the move list prints a glyph for, as annotators do. */
const GLYPH = { brilliant: "!!", only: "!" };

/** The grade a mark alone implies — for an analysis filed before grading. */
function gradeOfTag(tag) {
  return tag === "??" ? "blunder" : tag === "?" ? "mistake" : tag === "?!" ? "inaccuracy" : null;
}

/** Per-side counts of every grade; `firstMover` plays ply 0. */
function countGrades(grades, firstMover) {
  const zero = () => Object.fromEntries(GRADES.map((g) => [g, 0]));
  const out = { w: zero(), b: zero() };
  (grades || []).forEach((g, i) => {
    if (g) out[(i % 2 === 0) === (firstMover !== "b") ? "w" : "b"][g]++;
  });
  return out;
}

/**
 * Three key moments per side, replacing the single turning point (v8-0-plan
 * B2, drawn by A4). A moment is a ply that changed the game by at least the
 * `?!` line, measured as its win % swing for the mover:
 *   - a marked move (or a miss): the points it gave away;
 *   - an only move or a brilliancy: the points it saved — the gap to the
 *     second-best line, which is what any other move would have cost.
 * Ranked by swing, largest first (ties: the earlier ply); at most three a side.
 *
 * An analysis filed before grading (no `grades`) still has moments: its marks
 * stand in for grades, which is all it ever measured.
 *
 * @param {object} p the graded pass (sans, scalars, bests, seconds)
 * @param {Array<string|null>|null} grades from gradeMoves
 * @param {"w"|"b"} firstMover who plays ply 0
 * @param {(i: number) => number} moveNo the printed move number of ply i
 * @returns {{w: object[], b: object[]}} each {ply, side, san, moveNo, grade,
 *   tag, swing, before, after, best} — win % from the mover's side, rounded
 *   to 0.1; `best` the engine's first choice (UCI) at that position
 */
function keyMoments(p, grades, firstMover, moveNo) {
  const all = [];
  for (let i = 0; i < p.sans.length; i++) {
    const a = p.scalars[i], b = p.scalars[i + 1];
    if (a == null || b == null) continue;
    const side = (i % 2 === 0) === (firstMover !== "b") ? "w" : "b";
    const g = grades ? grades[i] : gradeOfTag(Review.classifyByWinPct(Review.winPctDrop(a, b, side)));
    if (!g) continue;
    const before = sideWin(a, side), after = sideWin(b, side);
    let swing = 0;
    if (g === "only" || g === "brilliant") swing = before - sideWin(p.seconds[i], side);
    else swing = Review.winPctDrop(a, b, side);
    if (!(swing >= MOMENT_MIN)) continue;
    const r1 = (x) => Math.round(x * 10) / 10;
    all.push({ ply: i, side, san: p.sans[i], moveNo: moveNo(i), grade: g,
      tag: Review.classifyByWinPct(Review.winPctDrop(a, b, side)),
      swing: r1(swing), before: r1(before), after: r1(after), best: p.bests ? p.bests[i] || null : null });
  }
  all.sort((x, y) => y.swing - x.swing || x.ply - y.ply);
  return {
    w: all.filter((m) => m.side === "w").slice(0, MOMENTS_PER_SIDE),
    b: all.filter((m) => m.side === "b").slice(0, MOMENTS_PER_SIDE),
  };
}

export const ChessReviewGrade = {
  GRADES, BEST_EPS, EXCELLENT, GOOD, ONLY_GAP, SAC_PAWNS, BRILLIANT_MIN_AFTER,
  MISS_OPP_DROP, MISS_FROM, MISS_DROP, MISS_FLOOR, BOOK_MAX_DROP, WINNING, LOST,
  DEEP_TRIGGER, DEEP_FACTOR, DEEP_MULTIPV, MOMENTS_PER_SIDE, MOMENT_MIN, LABEL, GLYPH,
  deepTargets, bookPlies, gradeMoves, countGrades, keyMoments, sacrificed,
};
