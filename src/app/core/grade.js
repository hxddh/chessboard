/**
 * Move grades and the review's moments, on win percentage (core/winpct).
 * The grading is 19.0's review-grade.js, value for value (parity test in
 * scripts/app/grade.test.mjs); the thresholds' reasons live there and in
 * v8-0-plan B2. New here: `selectMoments`, the ≤ 3 moments the review on the
 * board walks through (v20-0-plan §3 P5).
 *
 * The pass arrays (core/pass.js): fens (n + 1), sans (n), and per position
 * scalars (White view), bests (UCI), seconds (scalar of the second line),
 * pvs (SAN line, space-separated), deep (searched again), terminal.
 * @module core/grade
 */
import { Chess } from "./chess.js";
import { winPctDrop, sideWin, classifyByWinPct, WIN_INACCURACY, WIN_MISTAKE } from "./winpct.js";

export const BEST_EPS = 0.5, EXCELLENT = 2, GOOD = WIN_INACCURACY;
export const ONLY_GAP = WIN_MISTAKE, WINNING = 70, LOST = 30;
export const SAC_PAWNS = 2, BRILLIANT_MIN_AFTER = 50;
export const MISS_OPP_DROP = WIN_MISTAKE, MISS_FROM = 65, MISS_DROP = WIN_MISTAKE, MISS_FLOOR = 40;
export const BOOK_MAX_DROP = WIN_MISTAKE;
export const DEEP_TRIGGER = WIN_INACCURACY, DEEP_FACTOR = 3, DEEP_MULTIPV = 3;
export const MOMENTS_PER_SIDE = 3, MOMENT_MIN = WIN_INACCURACY;
export const GRADES = ["brilliant", "only", "best", "excellent", "good", "book", "miss", "inaccuracy", "mistake", "blunder"];
/** What the move list prints after a graded move. */
export const MARK = { brilliant: "!!", only: "!", miss: "?", inaccuracy: "?!", mistake: "?", blunder: "??" };

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

const moverAt = (fens, i) => (fens[i].split(" ")[1] === "b" ? "b" : "w");
function verbose(fen, san) {
  try { return new Chess(fen).move(san, { sloppy: true }) || null; } catch { return null; }
}
const uciOf = (m) => (m ? m.from + m.to + (m.promotion || "") : null);

function balance(chess, side) {
  let own = 0, opp = 0;
  for (const row of chess.board()) for (const sq of row) {
    if (!sq) continue;
    if (sq.color === side) own += VALUE[sq.type]; else opp += VALUE[sq.type];
  }
  return own - opp;
}

/** Pawns the move gives up along the engine's best reply line (see 19.0 review-grade). */
export function sacrificed(fen, san, replyPv) {
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

function isRecapture(fens, sans, i) {
  if (i < 1) return false;
  const prev = verbose(fens[i - 1], sans[i - 1]);
  const cur = verbose(fens[i], sans[i]);
  return !!(prev && cur && prev.captured && cur.captured && prev.to === cur.to);
}

const crossesLine = (best, second) => (best >= WINNING && second < WINNING) || (best >= LOST && second < LOST);

function replyLine(p, i) {
  const line = p.pvs && typeof p.pvs[i] === "string" ? p.pvs[i].split(" ") : [];
  return line[0] === p.sans[i] ? line.slice(1).join(" ") : (p.pvs ? p.pvs[i + 1] : null);
}

/** Positions to search again, deeper: both sides of a ≥ 5-point drop, and only-move candidates. */
export function deepTargets(p) {
  const want = new Set();
  for (let i = 0; i < p.sans.length; i++) {
    const a = p.scalars[i], b = p.scalars[i + 1];
    if (a == null || b == null) continue;
    const side = moverAt(p.fens, i);
    const drop = winPctDrop(a, b, side);
    if (drop >= DEEP_TRIGGER) { want.add(i); want.add(i + 1); continue; }
    if (!(p.seconds && p.seconds[i] != null && p.bests[i])) continue;
    const before = sideWin(a, side), second = sideWin(p.seconds[i], side);
    if (before - second < ONLY_GAP || uciOf(verbose(p.fens[i], p.sans[i])) !== p.bests[i]) continue;
    if (crossesLine(before, second) || sacrificed(p.fens[i], p.sans[i], replyLine(p, i)) >= SAC_PAWNS) want.add(i);
  }
  return [...want].filter((k) => !(p.deep && p.deep[k]) && !(p.terminal && p.terminal[k])).sort((x, y) => x - y);
}

/** One grade per ply (ids from GRADES), null where a side of the move was not measured. */
export function gradeMoves(p) {
  const out = [];
  const drops = p.sans.map((_, i) => (p.scalars[i] == null || p.scalars[i + 1] == null ? null
    : winPctDrop(p.scalars[i], p.scalars[i + 1], moverAt(p.fens, i))));
  for (let i = 0; i < p.sans.length; i++) {
    const drop = drops[i];
    if (drop == null) { out.push(null); continue; }
    const side = moverAt(p.fens, i);
    const tag = classifyByWinPct(drop);
    const before = sideWin(p.scalars[i], side), after = sideWin(p.scalars[i + 1], side);
    const m = verbose(p.fens[i], p.sans[i]);
    const isBest = !!m && !!p.bests && uciOf(m) === p.bests[i];
    if (p.book && p.book[i] && drop < BOOK_MAX_DROP) { out.push("book"); continue; }
    const confirmed = !!(p.deep && p.deep[i]);
    const second = p.seconds ? p.seconds[i] : null;
    const gap = second == null ? null : before - sideWin(second, side);
    let unique = false;
    if (confirmed && isBest && gap != null && gap >= ONLY_GAP) {
      const legal = new Chess(p.fens[i]).moves().length;
      unique = legal > 1 && !isRecapture(p.fens, p.sans, i);
    }
    if (unique && after >= BRILLIANT_MIN_AFTER && sacrificed(p.fens[i], p.sans[i], replyLine(p, i)) >= SAC_PAWNS) { out.push("brilliant"); continue; }
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
    else out.push("good");
  }
  return out;
}

const gradeOfTag = (tag) => (tag === "??" ? "blunder" : tag === "?" ? "mistake" : tag === "?!" ? "inaccuracy" : null);
const r1 = (x) => Math.round(x * 10) / 10;

/** 19.0's key moments: three per side by win % swing (kept for parity and the report). */
export function keyMoments(p, grades, firstMover, moveNo) {
  const all = [];
  for (let i = 0; i < p.sans.length; i++) {
    const a = p.scalars[i], b = p.scalars[i + 1];
    if (a == null || b == null) continue;
    const side = (i % 2 === 0) === (firstMover !== "b") ? "w" : "b";
    const g = grades ? grades[i] : gradeOfTag(classifyByWinPct(winPctDrop(a, b, side)));
    if (!g) continue;
    const before = sideWin(a, side), after = sideWin(b, side);
    const swing = g === "only" || g === "brilliant" ? before - sideWin(p.seconds[i], side) : winPctDrop(a, b, side);
    if (!(swing >= MOMENT_MIN)) continue;
    all.push({ ply: i, side, san: p.sans[i], moveNo: moveNo(i), grade: g,
      tag: classifyByWinPct(winPctDrop(a, b, side)),
      swing: r1(swing), before: r1(before), after: r1(after), best: p.bests ? p.bests[i] || null : null });
  }
  all.sort((x, y) => y.swing - x.swing || x.ply - y.ply);
  return {
    w: all.filter((m) => m.side === "w").slice(0, MOMENTS_PER_SIDE),
    b: all.filter((m) => m.side === "b").slice(0, MOMENTS_PER_SIDE),
  };
}

/** The review's grades worth going back to: a chance missed, a mistake, a blunder. */
export const MOMENT_GRADES = ["miss", "mistake", "blunder"];
/** Outside this band of the mover's win % the game was already decided. */
export const DECIDED_LOW = 15, DECIDED_HIGH = 85;

/**
 * The review's turning points (P5): at most `max`, only the moves of
 * `sides` (the player's own), only a miss / mistake / blunder, and only while
 * the outcome was undecided — not once the mover was already lost (< 15 %
 * before), nor a slip that left a won game won (> 85 % after). The largest
 * swings are kept; they are returned in the order they were played.
 * @returns {Array<{ply, side, san, grade, tag, swing, before, after, best}>}
 */
export function selectMoments(p, grades, sides, max = 3) {
  const out = [];
  for (let i = 0; i < p.sans.length; i++) {
    const g = grades[i];
    if (!MOMENT_GRADES.includes(g)) continue;
    const side = moverAt(p.fens, i);
    if (!sides.includes(side)) continue;
    const before = sideWin(p.scalars[i], side), after = sideWin(p.scalars[i + 1], side);
    if (before == null || after == null || before < DECIDED_LOW || after > DECIDED_HIGH) continue;
    const swing = winPctDrop(p.scalars[i], p.scalars[i + 1], side);
    out.push({ ply: i, side, san: p.sans[i], grade: g, tag: classifyByWinPct(swing),
      swing: r1(swing), before: r1(before), after: r1(after), best: p.bests ? p.bests[i] || null : null });
  }
  return out.sort((x, y) => y.swing - x.swing || x.ply - y.ply).slice(0, max).sort((x, y) => x.ply - y.ply);
}

/** Per-side counts of every grade. */
export function countGrades(grades, firstMover) {
  const zero = () => Object.fromEntries(GRADES.map((g) => [g, 0]));
  const out = { w: zero(), b: zero() };
  (grades || []).forEach((g, i) => { if (g) out[(i % 2 === 0) === (firstMover !== "b") ? "w" : "b"][g]++; });
  return out;
}
