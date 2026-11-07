/**
 * The review core in src/app/core (winpct, grade, pass) against what 19.0's
 * review.js / review-grade.js / review-pass.js gave on fixed games — the same
 * pass arrays, the same grades, the same moments, the same accuracy —
 * recorded from v19.0.0 into scripts/fixtures/review19.json when 19.0 was
 * removed. Plus the new pieces: selectMoments, clock, coach facts.
 */
import fs from "fs";
import { Chess } from "../../src/app/core/chess.js";
import * as W from "../../src/app/core/winpct.js";
import * as G from "../../src/app/core/grade.js";
import { runPass, runProgressive, engineAnalyze, deeper } from "../../src/app/core/pass.js";
import * as C from "../../src/app/core/clock.js";
import { threatNow, dangerAfter, checksAndCaptures, shouldAsk } from "../../src/app/core/coach.js";
import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { GAMES } from "../fixtures/corpus.mjs";
import { COACH_GAMES } from "../fixtures/coach-games.mjs";

const R19 = JSON.parse(fs.readFileSync(new URL("../fixtures/review19.json", import.meta.url), "utf8"));
const plain = (x) => JSON.parse(JSON.stringify(x));

const fensOf = (sans) => {
  const g = new Chess(), fens = [g.fen()];
  for (const s of sans) { if (!g.move(s)) throw new Error("bad " + s); fens.push(g.fen()); }
  return fens;
};
const FIXED = [GAMES[0], GAMES[1], GAMES[2], { name: "coach 1 (60 plies)", san: COACH_GAMES[0].san.slice(0, 60) }, COACH_GAMES[4]];

export default function (test) {
  test("winPct, drops, tags and accuracy match 19.0", (a) => {
    for (const cp of [-20000, -9000, -1234, -300, -50, 0, 7, 50, 120, 300, 999, 9000, 20000, null]) {
      a.equal(W.winPct(cp), R19.winPct[String(cp)], "winPct " + cp);
      a.equal(W.accuracyWinPct(cp), R19.accuracyWinPct[String(cp)], "accuracyWinPct " + cp);
    }
    for (const { x, y, s, drop, cls } of R19.drops) {
      a.equal(W.winPctDrop(x, y, s), drop);
      a.equal(W.classifyByWinPct(W.winPctDrop(x, y, s)), cls);
    }
    a.equal(W.WIN_MISTAKE, R19.WIN_MISTAKE);
    a.equal(W.moveNumber(5, "w"), R19.moveNumber5w);
  });

  for (const game of FIXED) {
    test("pass and grades match 19.0: " + game.name, async (a) => {
      const old = R19.games[game.name];
      a.ok(old, "recorded");
      const fens = fensOf(game.san);
      const engine = createEngineService(fakeBackend());
      const analyze = engineAnalyze(engine);
      const mine = await runPass({ fens, sans: game.san, budget: 100, analyze });
      for (const k of ["scalars", "bests", "pvs", "seconds", "deep", "terminal"]) a.deepEqual(plain(mine[k]), old.pass[k], k);
      const grades = G.gradeMoves(mine);
      a.deepEqual(plain(grades), old.grades, "grades");
      a.deepEqual(plain(G.deepTargets(mine)), old.deepTargets, "deep targets");
      const no = (i) => W.moveNumber(i, "w");
      a.deepEqual(plain(G.keyMoments(mine, grades, "w", no)), old.moments, "moments");
      a.deepEqual(plain(W.gameAccuracy(mine.scalars, "w")), old.accuracy, "accuracy");
      a.deepEqual(plain(G.countGrades(grades, "w")), old.counts, "counts");
      const sel = G.selectMoments(mine, grades, ["w"]);
      a.ok(sel.length <= 3, "at most three moments");
      a.ok(sel.every((m, i) => m.side === "w" && G.MOMENT_GRADES.includes(m.grade) && (!i || sel[i - 1].ply < m.ply)), "white's, graded, in order");
      a.ok(sel.every((m) => m.before >= G.DECIDED_LOW && m.after <= G.DECIDED_HIGH), "only while undecided");
    });
  }

  for (const game of FIXED) {
    test("progressive pass: the same grades and moments as runPass, the first card among them: " + game.name, async (a) => {
      const fens = fensOf(game.san);
      const analyze = engineAnalyze(createEngineService(fakeBackend()));
      const whole = await runPass({ fens, sans: game.san, budget: 100, analyze });
      let first = null;
      const prog = await runProgressive({ fens, sans: game.san, scan: 25, budget: 100, analyze,
        pick: (p, tried) => { const m = G.selectMoments(p, G.gradeMoves(p), ["w"]).find((x) => !tried.has(x.ply)); return m ? m.ply : null; },
        confirmed: (p, ply) => G.selectMoments(p, G.gradeMoves(p), ["w"], Infinity).some((m) => m.ply === ply),
        onFirst: (ply) => { first = ply; } });
      for (const k of ["scalars", "bests", "pvs", "terminal"]) a.deepEqual(prog[k], whole[k], k);
      a.deepEqual(G.gradeMoves(prog), G.gradeMoves(whole), "grades");
      const sel = G.selectMoments(prog, G.gradeMoves(prog), ["w"]);
      a.deepEqual(sel, G.selectMoments(whole, G.gradeMoves(whole), ["w"]), "moments");
      a.ok(first == null ? sel.length === 0 : sel.some((m) => m.ply === first), "the first card is a final turning point (" + first + ")");
    });
  }

  test("deeper: each kind of budget, three times", (a) => {
    a.equal(deeper(200), 600);
    a.deepEqual(deeper({ nodes: 1000 }), { nodes: 3000 });
    a.deepEqual(deeper({ ms: 50 }), { ms: 150 });
    a.deepEqual(deeper({ depth: 16 }), { depth: 18 });
    a.deepEqual(deeper({ review: "normal" }), { review: "deep" });
  });

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
