/**
 * The win-percentage side of review.js (v6-plan Q2.5).
 *
 * Pins the two lichess formulas to values computed by hand, the symmetry a
 * White-view mapping must have, and that summarizeWinPct() keeps the shape
 * and the side rule of summarize() — a caller swapping one for the other
 * should not have to learn a second record layout.
 *
 * Run: node scripts/test-review-winpct.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/review.js")), ctx, { filename: "review.js" });
const R = ctx.ChessReview;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}
const near = (a, b, eps = 0.01) => Math.abs(a - b) <= eps;

// --- winPct ---------------------------------------------------------------
assert(R.winPct(0) === 50, "level is 50%");
assert(near(R.winPct(100), 59.10, 0.01), "+1 pawn is 59.1% (" + R.winPct(100).toFixed(2) + ")");
assert(near(R.winPct(-100), 40.90, 0.01), "−1 pawn is 40.9%");
assert(near(R.winPct(300) + R.winPct(-300), 100), "symmetric around 50");
assert(R.winPct(9500) === 100 && R.winPct(-9500) === 0, "mate scores are 100 / 0");
assert(R.winPct(null) === null && R.winPct(NaN) === null, "unmeasured stays null");
assert(R.winPct(50, { ply: 30 }) === R.winPct(50), "opts.ply is accepted and does not change the lichess model");
assert(R.winPct(1000) < 100 && R.winPct(1000) > 97, "+10 pawns is nearly but not quite won (" + R.winPct(1000).toFixed(1) + ")");
assert(R.winPct(100) - R.winPct(50) > R.winPct(900) - R.winPct(850), "the same 50cp matters more near equality than at +9");

// --- drop, per side -------------------------------------------------------
assert(near(R.winPctDrop(100, 0, "w"), 9.10, 0.01), "White going from +1 to 0 drops 9.1 points");
assert(near(R.winPctDrop(0, 100, "b"), 9.10, 0.01), "…and Black allowing 0 → +1 drops the same");
assert(R.winPctDrop(0, 100, "w") === 0, "an improving move never drops below zero");
assert(R.winPctDrop(null, 100, "w") === null, "an unmeasured side returns null");

// --- thresholds -----------------------------------------------------------
assert(R.WIN_INACCURACY === 5 && R.WIN_MISTAKE === 10 && R.WIN_BLUNDER === 20, "cut-offs are 5 / 10 / 20 points");
assert(R.classifyByWinPct(4.9) === null && R.classifyByWinPct(5) === "?!", "?! from 5, inclusive");
assert(R.classifyByWinPct(9.9) === "?!" && R.classifyByWinPct(10) === "?", "? from 10");
assert(R.classifyByWinPct(19.9) === "?" && R.classifyByWinPct(20) === "??" && R.classifyByWinPct(60) === "??", "?? from 20");
assert(R.classifyByWinPct(null) === null && R.classifyByWinPct(NaN) === null, "no drop, no tag");
assert(R.INACCURACY === 50 && R.MISTAKE === 100 && R.BLUNDER === 300 && R.markFor(50) === "?!",
  "the centipawn cut-offs are untouched");

// --- accuracy -------------------------------------------------------------
assert(R.accuracyFromWinPct(50, 50) === 100 && R.accuracyFromWinPct(40, 60) === 100, "no loss is 100%");
assert(near(R.accuracyFromWinPct(60, 50), 103.1668 * Math.exp(-0.04354 * 10) - 3.1669, 1e-9), "10 points lost is the lichess curve (" + R.accuracyFromWinPct(60, 50).toFixed(1) + "%)");
assert(R.accuracyFromWinPct(100, 0) === 0, "losing everything clamps to 0");
assert(R.accuracyFromWinPct(null, 50) === null, "unmeasured is null");
{
  // the curve is monotone: every extra point lost costs accuracy
  let ok = true, prev = 101;
  for (let d = 0; d <= 100; d += 1) { const a = R.accuracyFromWinPct(100, 100 - d); if (a > prev) ok = false; prev = a; }
  assert(ok, "accuracy never rises as the drop grows");
}

// --- summarizeWinPct ------------------------------------------------------
{
  // White plays well, Black gives away the game in one move, then the rest is quiet
  const history = ["e4", "e5", "Nf3", "f6", "Nxe5", "fxe5"];
  const scalars = [20, 30, 25, 40, 250, 900, 600];
  const cp = R.summarize(scalars, history, "w");
  const wp = R.summarizeWinPct(scalars, history, "w");
  assert(wp && Object.keys(wp).sort().join() === "acc,counts,drop,judged,measured,plies,worst",
    "same shape as summarize(), with drop in place of acpl");
  assert(wp.measured === cp.measured && wp.judged.w === cp.judged.w && wp.judged.b === cp.judged.b && wp.plies === 6,
    "same plies measured, same side split");
  assert(wp.counts.b.blunder === 0 && wp.counts.b.mistake === 1 && wp.counts.b.inaccuracy >= 0,
    "3…f6 (40 → 250) is a ? by win% (" + R.winPctDrop(40, 250, "b").toFixed(1) + " points)");
  assert(wp.worst && wp.worst.ply === 3 && wp.worst.san === "f6" && wp.worst.side === "b" && wp.worst.moveNo === 2,
    "the turning point is 2…f6, numbered as in summarize()");
  assert(wp.acc.w > wp.acc.b, "the side that blundered scores lower");
  assert(wp.acc.w === 100, "White lost nothing and scores 100");
  assert(wp.drop.b > wp.drop.w, "…and lower mean drop");
  // 5…fxe5 900 → 600 is White's gain of nothing: Black's move improved Black's lot
  assert(R.winPctDrop(900, 600, "b") === 0, "a move that improves the mover's position drops 0");
}
{
  // the same six plies with Black to move first — the side rule flips
  const history = ["e5", "Nf3", "f6", "Nxe5", "fxe5", "Qh5+"];
  const scalars = [20, 30, 25, 250, 900, 600, 700];
  const wp = R.summarizeWinPct(scalars, history, "b");
  assert(wp.worst && wp.worst.san === "f6" && wp.worst.side === "b" && wp.worst.moveNo === 2, "firstMover 'b' is honoured (2…f6)");
}
assert(R.summarizeWinPct([null, null], ["e4"], "w") === null, "nothing measured → null");
assert(R.summarizeWinPct([], [], "w") === null, "empty → null");
{
  // a mate score does not blow the mean up the way a raw centipawn would
  const wp = R.summarizeWinPct([0, 0, 9990], ["Qh5", "g5"], "w");
  assert(wp.counts.b.blunder === 1 && wp.drop.b === 50 && wp.acc.b < 10 && wp.acc.w === 100,
    "a mate allowed from a level position is a ?? worth exactly 50 points (" + wp.acc.b + "% for that move)");
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");

// --- 6.1: the verdict cut-offs belong to the curve they are read from -------
//
// 6.0 switched what renderReview hands verdictKey to the win-% summary but
// left the 90 / 75 cut-offs that were read off the centipawn curve, so every
// player was graded a band too generously. These pin the two curves together
// at the play the old numbers described.
{
  const sans = Array.from({ length: 40 }, () => "Nf3");
  const track = (L) => { const sc = []; let v = 0; for (let i = 0; i <= 40; i++) { sc.push(v); v += (i % 2 === 0 ? -L : +L); } return sc; };
  const cpAcc = (L) => R.summarize(track(L), sans, "w").acc.w;
  const wpAcc = (L) => R.summarizeWinPct(track(L), sans, "w").acc.w;
  assert(R.VERDICT_EXCELLENT === 94 && R.VERDICT_SOLID === 86,
    "the verdict cut-offs are the win-% ones (" + R.VERDICT_EXCELLENT + " / " + R.VERDICT_SOLID + ")");
  assert(cpAcc(14) < 90 && cpAcc(13) >= 90, "the old 'excellent' line sat at ~14cp a move on the cp curve");
  assert(Math.abs(wpAcc(14) - R.VERDICT_EXCELLENT) <= 1,
    "…and the new one sits at the same play on the win-% curve (" + wpAcc(14) + " vs " + R.VERDICT_EXCELLENT + ")");
  assert(cpAcc(36) < 75 && cpAcc(35) >= 75, "the old 'solid' line sat at ~36cp a move");
  assert(Math.abs(wpAcc(36) - R.VERDICT_SOLID) <= 1,
    "…and the new one matches it (" + wpAcc(36) + " vs " + R.VERDICT_SOLID + ")");
  const verdict = (L) => R.verdictKey(R.summarizeWinPct(track(L), sans, "w"), "w");
  assert(verdict(25) === "rv.verdict.solid", "25cp a move is solid, not excellent (" + verdict(25) + ")");
  assert(verdict(10) === "rv.verdict.excellent", "10cp a move is still excellent");
  assert(verdict(40) === "rv.verdict.roomToGrow", "40cp a move has room to grow (" + verdict(40) + ")");
}

// --- 6.1: a mate score and a big plus are the same thing to the cp track ----
//
// The app still banks and displays the centipawn ACPL (app.js rec.acpl). A
// 120ms search gains and loses its mate announcement all the time in a won
// endgame, and before 6.1 each of those transitions was ~8000cp, clamped to
// the worst blunder the scale can express and charged to a player who did
// nothing wrong.
{
  assert(R.lossOf(9810, 1500, "w") === 0, "a mate call that becomes a large plus costs nothing (" + R.lossOf(9810, 1500, "w") + ")");
  assert(R.lossOf(1500, 9810, "w") === 0, "…and so does the reverse");
  assert(R.lossOf(9970, 9920, "w") === 0, "mate-in-3 to mate-in-8 costs nothing");
  assert(R.lossOf(200, -300, "w") === 500, "a real blunder is untouched (" + R.lossOf(200, -300, "w") + ")");
  assert(R.lossOf(9800, 50, "w") === 950, "…and throwing a forced mate away still costs nearly everything");
  const sc = [1400, 9800, 9810, 1500, 1500, 9840, 9850, 1600, 1600, 9880, 9890];
  const sans = sc.slice(1).map(() => "Ke2");
  const cp = R.summarize(sc, sans, "w");
  assert(cp.acpl.w === 0 && cp.counts.w.blunder === 0,
    "a won endgame whose search flickers in and out of mate reads as clean (acpl " + cp.acpl.w + ", blunders " + cp.counts.w.blunder + ")");
}

// 7.1: a game that starts from a [FEN] opens at that position's full-move
// number. Every version up to here listed a study handed to you at move 30 as
// move 1 — harmless while such games arrived one at a time, immediately
// visible now that the library opens them by the dozen (v7-1-plan §7).
{
  const row = (first, startNo) => [0, 1, 2, 3].map((i) => R.moveNumber(i, first, startNo)).join(",");
  assert(row("w") === "1,1,2,2", "白方先走、没有起手手数：照旧从第 1 手开始 (" + row("w") + ")");
  assert(row("b") === "1,2,2,3", "黑方先走：开在「1…」，白方的应手是第 2 手 (" + row("b") + ")");
  assert(row("w", 30) === "30,30,31,31", "白方先走、从第 30 手开始 (" + row("w", 30) + ")");
  assert(row("b", 30) === "30,31,31,32", "黑方先走、从第 30 手开始 (" + row("b", 30) + ")");
  assert(row("w", 0) === "1,1,2,2" && row("w", NaN) === "1,1,2,2",
    "起手手数是 0 或读不出来时，回到 1 —— 不是第 0 手");
}
