/**
 * The review core extracted into src/app/core (winpct, grade, pass) against
 * 19.0's review.js / review-grade.js / review-pass.js on fixed games: the same
 * pass arrays, the same grades, the same moments, the same accuracy. Plus the
 * new pieces: selectMoments, clock, coach facts.
 */
import { Chess } from "../../src/web/js/chess.js";
import { ChessReview as R19 } from "../../src/web/js/review.js";
import { ChessReviewGrade as G19 } from "../../src/web/js/review-grade.js";
import { ChessReviewPass as P19 } from "../../src/web/js/review-pass.js";
import * as W from "../../src/app/core/winpct.js";
import * as G from "../../src/app/core/grade.js";
import { runPass, engineAnalyze, evalScalar } from "../../src/app/core/pass.js";
import * as C from "../../src/app/core/clock.js";
import { threatNow, dangerAfter, checksAndCaptures, shouldAsk } from "../../src/app/core/coach.js";
import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { GAMES } from "../fixtures/corpus.mjs";
import { COACH_GAMES } from "../fixtures/coach-games.mjs";

const fensOf = (sans) => {
  const g = new Chess(), fens = [g.fen()];
  for (const s of sans) { if (!g.move(s)) throw new Error("bad " + s); fens.push(g.fen()); }
  return fens;
};
const FIXED = [GAMES[0], GAMES[1], GAMES[2], { name: "coach 1 (60 plies)", san: COACH_GAMES[0].san.slice(0, 60) }, COACH_GAMES[4]];

export default function (test) {
  test("winPct, drops, tags and accuracy match 19.0", (a) => {
    for (const cp of [-20000, -9000, -1234, -300, -50, 0, 7, 50, 120, 300, 999, 9000, 20000, null]) {
      a.equal(W.winPct(cp), R19.winPct(cp), "winPct " + cp);
      a.equal(W.accuracyWinPct(cp), R19.accuracyWinPct(cp), "accuracyWinPct " + cp);
    }
    for (const [x, y] of [[0, -300], [200, 150], [-50, 400], [9000, 0]]) for (const s of ["w", "b"]) {
      a.equal(W.winPctDrop(x, y, s), R19.winPctDrop(x, y, s));
      a.equal(W.classifyByWinPct(W.winPctDrop(x, y, s)), R19.classifyByWinPct(R19.winPctDrop(x, y, s)));
    }
    a.equal(W.WIN_MISTAKE, R19.WIN_MISTAKE);
    a.equal(W.moveNumber(5, "w"), R19.moveNumber(5, "w"));
  });

  for (const game of FIXED) {
    test("pass and grades match 19.0: " + game.name, async (a) => {
      const fens = fensOf(game.san);
      const engine = createEngineService(fakeBackend());
      const analyze = engineAnalyze(engine);
      const mine = await runPass({ fens, sans: game.san, budget: 100, analyze });
      const old = await P19.runPass({ fens, sans: game.san, budget: 100, analyze, evalScalar });
      for (const k of ["scalars", "bests", "pvs", "seconds", "deep", "terminal"]) a.deepEqual(mine[k], old[k], k);
      const grades = G.gradeMoves(mine);
      a.deepEqual(grades, G19.gradeMoves(old, Chess), "grades");
      a.deepEqual(G.deepTargets(mine), G19.deepTargets(old, Chess), "deep targets");
      const no = (i) => W.moveNumber(i, "w");
      a.deepEqual(G.keyMoments(mine, grades, "w", no), G19.keyMoments(old, grades, "w", no), "moments");
      a.deepEqual(W.gameAccuracy(mine.scalars, "w"), R19.gameAccuracy(old.scalars, "w"), "accuracy");
      a.deepEqual(G.countGrades(grades, "w"), G19.countGrades(grades, "w"), "counts");
      const sel = G.selectMoments(mine, grades, ["w"]);
      a.ok(sel.length <= 3, "at most three moments");
      a.ok(sel.every((m, i) => m.side === "w" && G.MOMENT_GRADES.includes(m.grade) && (!i || sel[i - 1].ply < m.ply)), "white's, graded, in order");
      a.ok(sel.every((m) => m.before >= G.DECIDED_LOW && m.after <= G.DECIDED_HIGH), "only while undecided");
    });
  }

  test("selectMoments: decided games are left alone, the largest swings kept", (a) => {
    // White: 50 → 20 (blunder, undecided), 10 → 0 (lost already), 95 → 90 (won stays won), 60 → 45, 55 → 30, 50 → 35
    const sc = (w) => -Math.log(100 / w - 1) / 0.00368208;   // the scalar whose winPct is w
    const p = { fens: [], sans: [], scalars: [], bests: [] };
    const pairs = [[50, 20], [10, 1], [95, 90], [60, 45], [55, 30], [50, 35]];
    const g = new Chess();
    for (const [b, c] of pairs) {
      p.fens.push(g.fen(), g.fen().replace(" w ", " b "));
      p.sans.push("e4", "e5");
      p.scalars.push(sc(b), sc(c));
      p.bests.push(null, null);
    }
    p.fens.push(g.fen()); p.scalars.push(0);
    const grades = p.sans.map((_, i) => (i % 2 ? null : "mistake"));
    const sel = G.selectMoments(p, grades, ["w"]);
    a.deepEqual(sel.map((m) => m.ply), [0, 6, 8], "three, by swing, in game order (" + sel.map((m) => m.ply + ":" + m.swing) + ")");
  });

  test("clock: first move starts it, increment credited, flag at zero", (a) => {
    let c = C.newClock("3+2");
    a.equal(c.w, 180000);
    c = C.afterMove(c, "w", 1000);
    a.equal(c.w, 180000, "the first move is free");
    a.equal(C.left(c, "b", 6000), 175000);
    c = C.afterMove(c, "b", 6000);
    a.equal(c.b, 177000, "5 s used, 2 s back");
    a.equal(C.left(c, "w", 6000 + 200000), 0);
    a.equal(C.format(65000), "1:05");
    a.equal(C.format(9500), "0:09.5");
    a.equal(C.newClock("none"), null);
    const s = C.stop(c, 7000);
    a.equal(s.since, null); a.equal(s.w, 179000);
  });

  test("coach facts: a hanging queen, a mate allowed, the threat now", (a) => {
    // 1.e4 e5 2.Qh5 Nc6: Qxe5+?? is fine (check) but 2...Nf6?? would allow Qxf7#
    const scholar = "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3";
    const d = dangerAfter(scholar, "g8f6");
    a.equal(d && d.kind, "mate", "…Nf6 allows Qxf7#");
    a.equal(dangerAfter(scholar, "g7g6"), null, "…g6 holds");
    const t = threatNow(scholar);
    a.equal(t && t.kind, "mate", "the threat now is mate (" + JSON.stringify(t) + ")");
    a.equal(t.san, "Qxf7#");
    // a queen walked onto an attacked square
    const q = dangerAfter("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "d1g4");
    a.equal(q && q.piece, "q", "Qg4 hangs the queen to …Bxg4 (" + JSON.stringify(q) + ")");
    a.equal(dangerAfter("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "g1f3"), null);
    const cc = checksAndCaptures(new Chess().fen());
    a.ok(cc.captures.length === 0 && cc.checks.length === 0, "no checks or captures yet");
    a.ok(shouldAsk({ rule: d, facts: null, before: 0, after: 9990, side: "b" }).ask, "mate allowed and the engine agrees: ask");
    a.ok(!shouldAsk({ rule: null, facts: null, before: 0, after: -400, side: "w" }).ask, "a bad move without a proved fact: no question");
    a.ok(!shouldAsk({ rule: q, facts: null, before: 30, after: 0, side: "w" }).ask, "the engine sees no real drop: no question");
  });
}
