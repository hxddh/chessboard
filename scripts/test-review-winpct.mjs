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
// v8-0-plan B2: the grades and the pass that feeds them
for (const m of ["chess.js", "review-grade.js", "review-pass.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + m)), ctx, { filename: m });
}
const G = ctx.ChessReviewGrade, P = ctx.ChessReviewPass, Chess = ctx.Chess;

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
// v8-0-plan B2: lichess's current source, including its "+ 1" uncertainty bonus
assert(near(R.accuracyFromWinPct(60, 50), 103.1668100711649 * Math.exp(-0.04354415386753951 * 10) - 3.166924740191411 + 1, 1e-9),
  "10 points lost is the lichess curve, uncertainty bonus included (" + R.accuracyFromWinPct(60, 50).toFixed(1) + "%)");
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
  // a mate score does not blow the mean up the way a raw centipawn would;
  // the accuracy track clamps it to ±1000 as lichess does (97.5%, not 100)
  const wp = R.summarizeWinPct([0, 0, 9990], ["Qh5", "g5"], "w");
  assert(wp.counts.b.blunder === 1 && wp.drop.b === 50 && wp.acc.b === 11 && wp.acc.w === 100,
    "a mate allowed from a level position is a ?? worth exactly 50 points (" + wp.acc.b + "% for that move)");
}

// --- v8-0-plan B2: lichess's game accuracy, against lichess's own tests -----
// modules/analyse/src/test/AccuracyPercentTest.scala, case for case: `compute`
// there is gameAccuracy(startColor, cps) with lichess's initial 15 cp put in
// front, which is scalars[0] here. isCloseTo(a, b, d) is |a − b| ≤ d.
{
  const close = (a, b, d) => a != null && Math.abs(a - b) <= d;
  const compute = (cps, first = "w") => R.gameAccuracy([15].concat(cps), first);
  const fill = (n, xs) => Array.from({ length: n }, () => xs).flat();
  const cases = [
    ["two good moves", [15, 15], [100, 1], [100, 1]],
    ["white blunders on first move", [-900, -900], [10, 5], [100, 1]],
    ["black blunders on first move", [15, 900], [100, 1], [10, 5]],
    ["both blunder on first move", [-900, 0], [10, 5], [10, 5]],
    ["20 perfect moves", fill(20, [15]), [100, 1], [100, 1]],
    ["20 perfect moves and a white blunder", fill(20, [15]).concat([-900]), [50, 5], [100, 1]],
    ["21 perfect moves and a black blunder", fill(21, [15]).concat([900]), [100, 1], [50, 5]],
    ["5 average moves (65 cpl) on each side", fill(5, [-50, 15]), [76, 8], [76, 8]],
    ["50 average moves (65 cpl) on each side", fill(50, [-50, 15]), [76, 8], [76, 8]],
    ["50 mediocre moves (150 cpl) on each side", fill(50, [-135, 15]), [54, 8], [54, 8]],
    ["50 terrible moves (500 cpl) on each side", fill(50, [-435, 15]), [20, 8], [20, 8]],
  ];
  for (const [name, cps, [w, dw], [b, db]] of cases) {
    const a = compute(cps);
    assert(close(a.w, w, dw) && close(a.b, b, db),
      "lichess: " + name + " → white " + (a.w == null ? "—" : a.w.toFixed(1)) + " (≈" + w + "), black " + (a.b == null ? "—" : a.b.toFixed(1)) + " (≈" + b + ")");
  }
  const blackFirst = [
    ["black moves first, two good moves", [15, 15], [100, 1], [100, 1]],
    ["black moves first, black blunders on first move", [900, 900], [100, 1], [10, 5]],
    ["black moves first, white blunders on first move", [15, -900], [10, 5], [100, 1]],
    ["black moves first, both blunder on first move", [900, 0], [10, 5], [10, 5]],
  ];
  for (const [name, cps, [w, dw], [b, db]] of blackFirst) {
    const a = compute(cps, "b");
    assert(close(a.w, w, dw) && close(a.b, b, db),
      "lichess: " + name + " → white " + (a.w == null ? "—" : a.w.toFixed(1)) + ", black " + (a.b == null ? "—" : a.b.toFixed(1)));
  }
  const one = compute([15]);
  assert(one.b === null && close(one.w, 100, 1), "lichess: a single move leaves the other side without a figure");
  const none = R.gameAccuracy([15], "w");
  assert(none.w === null && none.b === null, "lichess: an empty game has no accuracy");

  // What the plain mean (≤ 7.9) got wrong: one blunder among twenty perfect
  // moves. lichess's test puts that at ≈ 50; the plain mean said ≈ 95.
  const track = [15].concat(fill(20, [15]), [-900]);
  const plain = (() => {
    const xs = [];
    for (let i = 0; i + 1 < track.length; i += 2) xs.push(R.accuracyFromWinPct(R.accuracyWinPct(track[i]), R.accuracyWinPct(track[i + 1])));
    return xs.reduce((a, b) => a + b, 0) / xs.length;
  })();
  assert(plain > 90 && compute(fill(20, [15]).concat([-900])).w < 55,
    "one blunder in eleven moves: plain mean " + plain.toFixed(1) + " → lichess " + compute(fill(20, [15]).concat([-900])).w.toFixed(1));
  // the summary reads the full formula, not its own mean
  const sans = Array.from({ length: 21 }, () => "Nf3");
  const sw = R.summarizeWinPct(track, sans, "w");
  assert(sw.acc.w === Math.round(compute(fill(20, [15]).concat([-900])).w), "summarizeWinPct reports gameAccuracy (" + sw.acc.w + ")");
  // an unmeasured evaluation takes out the moves on either side of it and any
  // window it falls in, as a missing eval does on lichess — never a zero
  const holed = R.gameAccuracy([15, 15, null, 15, 15, 15], "w");
  assert(holed.w != null && holed.b != null && holed.w > 99, "a hole in the track is skipped, not scored (" + (holed.w || 0).toFixed(1) + ")");
}

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
  assert(R.VERDICT_EXCELLENT === 95 && R.VERDICT_SOLID === 87,
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

// --- v8-0-plan B2: move grades, each threshold at its edge -------------------
// Synthetic passes: real positions (the grader asks chess.js what was played,
// how many moves were legal, what the reply line does to the material) and
// hand-set evaluations, so every cut-off is tested on both sides of it.
{
  // the White-view centipawn value that puts White at `win` %
  const cpFor = (win) => -Math.log(2 / ((win - 50) / 50 + 1) - 1) / 0.00368208;
  const START = new Chess().fen();
  const fensOf = (sans, from) => {
    const g = from ? new Chess(from) : new Chess();
    const out = [g.fen()];
    for (const s of sans) { if (!g.move(s)) throw new Error("illegal " + s); out.push(g.fen()); }
    return out;
  };
  const pass = (sans, scalars, extra, from) => Object.assign({
    fens: fensOf(sans, from), sans, scalars,
    bests: new Array(sans.length + 1).fill(null), seconds: new Array(sans.length + 1).fill(null),
    pvs: new Array(sans.length + 1).fill(null), deep: new Array(sans.length + 1).fill(false),
    book: new Array(sans.length).fill(false),
  }, extra || {});
  const grade1 = (san, dropPts, extra) => G.gradeMoves(pass([san], [0, cpFor(50 - dropPts)],
    Object.assign({ bests: ["e2e4", null] }, extra || {})), Chess)[0];

  assert(near(R.winPct(cpFor(63.2)), 63.2, 1e-9), "(the test's own inverse of winPct is exact)");
  assert(grade1("e4", 0) === "best", "the engine's first choice is 最佳");
  assert(grade1("e4", 3) === "best", "…even when the search after it reads a little lower (3 points: still 最佳, no mark)");
  assert(grade1("d4", 0.4) === "best" && grade1("d4", 0.6) === "excellent",
    "another move within " + G.BEST_EPS + " point of the engine's is 最佳 too; 0.6 is 优秀");
  assert(grade1("d4", 1.99) === "excellent" && grade1("d4", 2) === "good", "优秀 below " + G.EXCELLENT + " points, 良好 from it");
  assert(grade1("d4", 4.99) === "good" && grade1("d4", 5) === "inaccuracy", "良好 below 5, 小失误 (?!) from 5 — the ?! line");
  assert(grade1("d4", 9.99) === "inaccuracy" && grade1("d4", 10) === "mistake" && grade1("d4", 19.99) === "mistake" &&
    grade1("d4", 20) === "blunder", "失误 (?) from 10, 严重失误 (??) from 20 — review.js's cut-offs, unchanged");
  assert(grade1("d4", 9.99, { book: [true] }) === "book" && grade1("d4", 10, { book: [true] }) === "mistake",
    "a book move is 谱着 unless it is a ? or worse");
  assert(G.gradeMoves(pass(["e4"], [null, 0]), Chess)[0] === null, "an unmeasured move has no grade");

  // 谱着 is a prefix: out of the book once, out for good
  const inBook = new Set(fensOf(["e4", "e5", "Nf3"]).slice(1, 3).concat(fensOf(["e4", "e5", "Nf3", "Nc6"]).slice(4)));
  assert(JSON.stringify(G.bookPlies(fensOf(["e4", "e5", "Nf3", "Nc6"]), (f) => inBook.has(f))) === "[true,true,false,false]",
    "book plies stop at the first position the table does not know, even if a later one is in it");

  // 仅此一着: first choice, confirmed deeper, every other move ≥ 10 points worse
  const mid = ["e4", "e5", "Nf3", "Nc6", "d4"];
  const only = (gap, extra, win = 72) => {
    const p = pass(mid, [0, 0, 0, 0, cpFor(win), cpFor(win)], Object.assign({ bests: [null, null, null, null, "d2d4", null],
      seconds: [null, null, null, null, cpFor(win - gap), null], deep: [false, false, false, false, true, true] }, extra || {}));
    return G.gradeMoves(p, Chess)[4];
  };
  assert(only(10) === "only" && only(9.99) === "best", "仅此一着 when the second line is ≥ " + G.ONLY_GAP + " points worse, 最佳 below");
  assert(only(10, {}, 93) === "best" && only(21, {}, 50) === "only" && only(15, {}, 50) === "best",
    "…and only when that gap crosses a result line (" + G.WINNING + " / " + G.LOST + "): 93 → 83 is two ways to win, 50 → 35 still level, 50 → 29 lost");
  assert(only(30, { deep: [false, false, false, false, false, true] }) === "best" && only(30, { deep: new Array(6).fill(false) }) === "best",
    "…and only when the deeper search confirmed the position it was played in — the quick scan alone never says it");
  {
    // 3…exd4 4.Nxd4: the knight takes back on the square just captured on
    const sans = ["e4", "e5", "Nf3", "Nc6", "d4", "exd4", "Nxd4"];
    const p = pass(sans, new Array(8).fill(0), { bests: [null, null, null, null, null, null, "f3d4", null],
      seconds: [null, null, null, null, null, null, cpFor(20), null], deep: new Array(8).fill(true) });
    assert(G.gradeMoves(p, Chess)[6] === "best", "a recapture on the square just taken on is never 仅此一着, however large the gap");
  }
  {
    // the one legal move: forced, not found
    const f = "7k/8/8/8/8/8/6q1/7K w - - 0 1";
    const p = pass(["Kxg2"], [0, 0], { bests: ["h1g2", null], seconds: [cpFor(10), null], deep: [true, true] }, f);
    assert(new Chess(f).moves().length === 1 && G.gradeMoves(p, Chess)[0] === "best", "the only legal move is 最佳, not 仅此一着");
  }

  // 妙着: an only move that gives up material along the engine's own line
  {
    const greek = "r1bq1rk1/pppn1ppp/4p3/3pP3/1b1P4/2NB1N2/PPP2PPP/R1BQK2R w KQ - 0 8";
    const brill = (scal, pv) => G.gradeMoves(pass(["Bxh7+"], [scal, scal], { bests: ["d3h7", null],
      seconds: [cpFor(R.winPct(scal) - 20), null], deep: [true, true], pvs: [null, pv] }, greek), Chess)[0];
    assert(G.sacrificed(greek, "Bxh7+", "Kxh7 Ng5+ Kg8", Chess) === 2, "Bxh7+ Kxh7 Ng5+ Kg8 is a bishop for a pawn, still after the follow-up");
    assert(brill(300, "Kxh7 Ng5+ Kg8") === "brilliant", "the Greek gift, the only good move and the engine takes it: 妙着");
    assert(brill(300, "Kh8 Qh5") === "only", "the same move with the sacrifice declined on the engine's line is 仅此一着, not 妙着");
    assert(brill(-30, "Kxh7 Ng5+ Kg8") === "only", "…and a sacrifice that leaves the mover under " + G.BRILLIANT_MIN_AFTER + "% is not 妙着");
    const own = G.gradeMoves(pass(["Bxh7+"], [300, 300], { bests: ["d3h7", null], seconds: [cpFor(R.winPct(300) - 20), null],
      deep: [true, false], pvs: ["Bxh7+ Kxh7 Ng5+ Kg8 Qh5", null] }, greek), Chess)[0];
    assert(own === "brilliant", "…read off the deep search's own first line when that line is the move played");
    // a trade is level again by the second check
    assert(G.sacrificed(START, "e4", "d5 exd5 Qxd5", Chess) === 0, "a pawn trade gives nothing up");
  }

  // 错失良机: the opponent's ? left a win, and this move gave it back without losing
  {
    const sans = ["e4", "e5", "Nf3"];
    const miss = (after) => G.gradeMoves(pass(sans, [0, 0, cpFor(70), cpFor(after)]), Chess)[2];
    assert(miss(55) === "miss", "70 → 55 after the opponent's 20-point slip: 错失良机");
    assert(miss(39) === "blunder", "…70 → 39 is thrown away, not missed: still 严重失误");
    assert(miss(61) === "inaccuracy", "…70 → 61 gives back 9, under the " + G.MISS_DROP + "-point line: an ordinary ?!");
    const calm = G.gradeMoves(pass(sans, [0, cpFor(65), cpFor(70), cpFor(55)]), Chess)[2];
    assert(calm === "mistake", "without the opponent's mistake just before, the same drop is a plain ?");
  }

  // which positions get the deeper MultiPV 3 search
  {
    const sans = ["e4", "e5", "Nf3", "Nc6"];
    const p = pass(sans, [0, 0, cpFor(56), cpFor(56), cpFor(56)]);
    assert(JSON.stringify(G.deepTargets(p, Chess)) === "[1,2]", "a ≥ 5-point drop sends both sides of the move deeper (" + JSON.stringify(G.deepTargets(p, Chess)) + ")");
    p.deep[1] = true;
    assert(JSON.stringify(G.deepTargets(p, Chess)) === "[2]", "…a position already deepened is not searched again");
    const q = pass(sans, [0, 0, 0, 0, 0], { bests: [null, null, "g1f3", null, null], seconds: [null, null, cpFor(25), null, null] });
    assert(JSON.stringify(G.deepTargets(q, Chess)) === "[2]", "an only-move candidate from the quick scan is confirmed deeper — the position it is played in");
    q.bests[2] = "b1c3";
    assert(G.deepTargets(q, Chess).length === 0, "…but not when the move played was not the engine's choice");
  }

  // key moments: three a side, by swing, none under the ?! line
  {
    const sans = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5", "c3", "Nf6", "d4", "exd4"];
    // White-view win %: each ply moves the game by a different amount
    const wins = [50, 44, 51, 39, 71, 68, 60, 52, 54, 25, 31];
    const p = pass(sans, wins.map(cpFor));
    const km = G.keyMoments(p, null, "w", (i) => Math.floor(i / 2) + 1);
    const plies = (xs) => xs.map((m) => m.ply).join(",");
    assert(plies(km.w) === "8,2,6" && plies(km.b) === "3,1,9" && km.w[0].swing === 29,
      "moments rank by swing, three at most a side, ≥ " + G.MOMENT_MIN + " points (白 " + plies(km.w) + " · 黑 " + plies(km.b) + ")");
    assert(km.w[0].grade === "blunder" && km.w[0].tag === "??" && km.w[0].moveNo === 5 && km.w[0].san === "d4" &&
      km.w[0].before === 54 && km.w[0].after === 25, "each moment carries what A4 draws: the move, its grade, before and after");
    const graded = G.gradeMoves(Object.assign(p, { bests: new Array(11).fill(null) }), Chess);
    graded[2] = "only"; p.seconds[2] = cpFor(20);
    const km2 = G.keyMoments(p, graded, "w", (i) => i);
    assert(km2.w.some((m) => m.ply === 2 && m.swing === 31), "an only move's swing is what the second line would have cost (51 − 20)");
    const c = G.countGrades(graded, "w");
    assert(c.w.only === 1 && Object.values(c.w).reduce((a, b) => a + b, 0) === 5 && Object.values(c.b).reduce((a, b) => a + b, 0) === 5,
      "the grade counts split by side and add up to the plies");
  }
}

// --- v8-0-plan B2: the pass — quick scan, then deeper — and determinism ------
{
  // A fake engine whose answer depends only on what it was asked: a stand-in
  // for Stockfish at a fixed node count from a cleared state. Positions after
  // an odd number of plies lose Black 8 points at the quick budget; the deep
  // budget says it was 3.
  const sans = ["e4", "e5", "Nf3", "Nc6", "Bb5", "a6"];
  const g = new Chess();
  const fens = [g.fen()];
  for (const s of sans) { g.move(s); fens.push(g.fen()); }
  const calls = [];
  const analyze = async (fen, budget, opts) => {
    calls.push([fens.indexOf(fen), budget, opts.multipv]);
    const k = fens.indexOf(fen), turn = fen.split(" ")[1];
    const deep = budget > 200;
    const white = k === 4 ? (deep ? 60 : 110) : 20;
    const cp = turn === "w" ? white : -white;
    const best = new Chess(fen).moves({ verbose: true })[0];
    const uci = best.from + best.to;
    return { cp, mate: null, turn, best: uci, pv: [uci], lines: [{ cp, mate: null, pv: [uci], depth: deep ? 16 : 13 },
      { cp: cp - 90, mate: null, pv: [uci], depth: deep ? 16 : 13 }] };
  };
  const evalScalar = (e) => (e ? (e.turn === "w" ? e.cp : -e.cp) : null);
  const run = () => P.runPass({ fens, sans, budget: 200, lines: 1, analyze, evalScalar });
  const a = await run();
  const quick = calls.filter((c) => c[1] === 200), deep = calls.filter((c) => c[1] === 200 * G.DEEP_FACTOR);
  assert(quick.length === fens.length && quick.every((c) => c[2] === 2),
    "the quick scan asks every position once, MultiPV 2 so the second line is known (" + quick.length + ")");
  assert(deep.length > 0 && deep.every((c) => c[2] === G.DEEP_MULTIPV) && new Set(deep.map((c) => c[0])).size === deep.length,
    "the deeper pass is MultiPV " + G.DEEP_MULTIPV + ", at " + G.DEEP_FACTOR + "× the budget, each position once (" + deep.map((c) => c[0]).join(",") + ")");
  assert(deep.some((c) => c[0] === 3) && deep.some((c) => c[0] === 4) && a.deep[3] && a.deep[4] && a.scalars[4] === 60,
    "the 4…Nc6 → 5.Bb5 swing sends both positions deeper, and the deep number replaces the quick one");
  assert(a.linesAt.every((l) => l === null), "with one line on the panel, no extra lines are stored");
  calls.length = 0;
  const b = await run();
  assert(JSON.stringify(a) === JSON.stringify(b), "the same game through the same engine twice: identical pass");
  const ga = G.gradeMoves(a, Chess), gb = G.gradeMoves(b, Chess);
  assert(ga.every((x) => x) && JSON.stringify(ga) === JSON.stringify(gb), "…and identical grades (" + ga.join(" ") + ")");
  // stopped: the quick numbers so far, and where it stopped
  calls.length = 0;
  const cut = await P.runPass({ fens, sans, budget: 200, lines: 1, analyze, evalScalar, halt: () => (calls.length >= 3 ? "abort" : null) });
  assert(cut.halted === "abort" && cut.at === 3 && cut.scalars[2] != null && cut.scalars[3] === null, "a stop keeps the positions already measured and says where");
  assert(!cut.deepCut, "…a stop inside the quick scan is not a finished scan");
  // stopped while deepening (review of PR #87): the quick scan measured every
  // position, so the pass says so — and the search Stop cancelled is not
  // counted as deepened, or its quick numbers would pass for confirmed ones
  calls.length = 0;
  let stopAt = -1;
  const deepCut = await P.runPass({ fens, sans, budget: 200, lines: 1, evalScalar,
    analyze: async (fen, b, o) => { const e = await analyze(fen, b, o); if (b > 200 && stopAt < 0) stopAt = fens.indexOf(fen); return e; },
    halt: () => (stopAt >= 0 ? "abort" : null) });
  assert(!deepCut.halted && deepCut.deepCut === true,
    "a stop while deepening is not a halt: the scan was complete, only the deepening was cut (" + deepCut.halted + " deepCut=" + deepCut.deepCut + ")");
  assert(deepCut.scalars.every((s) => s != null) && deepCut.bests.every((b, i) => b || deepCut.terminal[i]),
    "…every position keeps its quick-scan numbers");
  assert(stopAt >= 0 && !deepCut.deep[stopAt] && deepCut.scalars[4] === 110,
    "…the search Stop cancelled is not counted as deepened, and its quick number stands (" + stopAt + ")");
  const gCut = G.gradeMoves(deepCut, Chess);
  assert(gCut.length === sans.length && gCut.every((x) => typeof x === "string"), "…and every move still gets a grade (" + gCut.join(" ") + ")");
}

// --- v8-2-plan T3: 名局猜着 grades on the review's scale ---------------------
// A guess's loss against the master's move is graded by trainer/guess.js; a
// move the review scans with the same drop must get the same grade (the plain
// branch of gradeMoves: not the engine's first choice, no book, not deepened).
{
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/trainer/guess.js")), ctx, { filename: "guess.js" });
  const Gs = ctx.createGuess({ store: {}, Review: R, Grade: G, Chess });
  const g = new Chess();
  const fens = [g.fen()];
  g.move("e4");
  fens.push(g.fen());
  const off = [];
  for (let cp = 0; cp <= 900; cp += 3) {
    const drop = R.winPctDrop(0, -cp, "w");
    const review = G.gradeMoves({ fens, sans: ["e4"], scalars: [0, -cp], bests: [null], seconds: [null], pvs: [null, null], deep: [false, false] }, Chess)[0];
    if (Gs.gradeOf(drop) !== review) off.push(cp + ":" + Gs.gradeOf(drop) + "≠" + review);
  }
  assert(off.length === 0, "T3: a guess is graded exactly as the review grades the same drop, 0–900 cp" + (off.length ? " — " + off.slice(0, 5).join(", ") : ""));
  assert(Gs.gradeOf(0) === "best" && Gs.gradeOf(R.WIN_MISTAKE) === "mistake" && Gs.gradeOf(R.WIN_BLUNDER) === "blunder",
    "T3: …best at no loss, 失误 from 10 points, 严重失误 from 20");
}

// v8-0-plan B2: the exit sits at the very end — through 7.9 it sat halfway
// down, so a failure in any block below it printed FAIL and still exited 0
if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
