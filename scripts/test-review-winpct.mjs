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
