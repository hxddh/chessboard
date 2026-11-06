/**
 * The 「你这一步」 explainer (v20-0-plan §4 F1/F2): core/explain.js
 * explainMove, the facts under it (core/facts.js, core/facts-kpk.js), the
 * zh sentences, and the audit's recorded numbers against the acceptance
 * (docs/measured.json `explainCoverage`, scripts/audit-explain.mjs).
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { explainMove, explainText, explainKey, explainMotif, kindOf } from "../../src/app/core/explain.js";
import * as F from "../../src/app/core/facts.js";
import { kpk } from "../../src/app/core/facts-kpk.js";
import { learnText } from "../../src/app/text/learn.js";
import { playText } from "../../src/app/text/play.js";
import explainZh from "../../src/app/text/explain.zh.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const t = playText(), tl = learnText();
const say = (fen, mv, ctx, tt = t) => { const r = explainMove(fen, mv, ctx); return { r, text: explainText(r, tt, { extra: true }) }; };

export default function (test) {
  test("a 19.0 tactic still reads the same: 9. a3?? walks into …Nxc2+", (a) => {
    // the walk-through game (test-explain.mjs FIXED): a knight fork of king and rook
    const fen = "r1bqkbnr/pppp1ppp/8/3P4/1n2P3/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 5";
    const { r, text } = say(fen, "a3", { kind: "review", best: "c2c3", line: ["Nxc2+", "Kd2", "Nxa1"] });
    a.ok(r && r.key, "a sentence");
    a.ok(/Nxc2\+/.test(text), "it names the reply: " + text);
    a.ok(r.arrows.length && r.arrows[0].color === "R" && r.arrows[0].to === "c2", "and draws it on the board");
  });

  test("the threat before the move: the reply was already there, and the move did not answer it", (a) => {
    // White's knight on c3 is attacked by the d4 pawn; 1.h3 ignores it, …dxc3 takes it
    const fen = "rnbqkbnr/ppp1pppp/8/8/3p4/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 3";
    const { r, text } = say(fen, "h3", { kind: "review", best: "c3e4", line: ["dxc3", "bxc3", "Nf6", "d4"], evalBefore: 0, evalAfter: -250 });
    a.ok(/^ex\.threat(Free|Take|Cheap|Hanging)$/.test(r.key), r.key + " " + text);
    a.ok(text.includes("dxc3") && text.includes("马"), text);
    a.equal(explainMotif(r), "hanging");
  });

  test("a man left loose by the move, and the guard it was", (a) => {
    // 1.e4 d6 2.Qg4?? — the queen steps where the c8 bishop takes it
    const { r, text } = say("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", "Qg4", { kind: "coach" });
    a.equal(r.key, "ex.movedFree", text);
    a.ok(text.includes("后"), text);
    // the knight on f3 guarded e5; 1.Ng5 leaves the e5 pawn to the d6 pawn? no — to …Nxe5
    const f2 = "r1bqkb1r/pppp1ppp/2n2n2/4P3/8/5N2/PPP2PPP/RNBQKB1R w KQkq - 1 5";
    const u = say(f2, "Ng5", { kind: "coach" });
    a.equal(u.r.facts.loose && u.r.facts.loose.why, "unguarded", JSON.stringify(u.r.facts.loose));
  });

  test("no engine line: only what the board proves, and never a description passed off as a reason", (a) => {
    const quiet = explainMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "e4", { kind: "review", best: "e2e4", line: ["e5"] });
    a.equal(quiet.key, null, "the engine's own move in a review: nothing against it");
    const coach = explainMove("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "Nf3", { kind: "coach" });
    a.equal(coach.key, null, "a safe move: the coach has nothing to say");
  });

  test("a retry is explained without naming the answer", (a) => {
    const fen = "rnbqkbnr/ppp1pppp/8/8/3p4/2N5/PPPPPPPP/R1BQKBNR w KQkq - 0 3";
    const r = explainMove(fen, "h3", { kind: "retry", best: "c3e4", line: ["dxc3", "bxc3"], noBetter: true, evalBefore: 0, evalAfter: -250 });
    a.ok(r.key && !/^ex\.better/.test(r.key), r.key);
    a.ok(!explainText(r, t).includes("Ne4"), explainText(r, t));
  });

  test("lessons: the fact about your move, not the task again", (a) => {
    const fen = "7k/Q7/6K1/8/8/8/8/8 w - - 0 1";
    a.equal(explainMove(fen, "Qf7", { kind: "lesson", goal: "mate" }).key, "ex.stalemate");
    const ch = say("7k/Q7/8/6K1/8/8/8/8 w - - 0 1", "Qa8+", { kind: "lesson", goal: "mate" }, tl);
    a.equal(ch.r.key, "ex.notMate", ch.text);
    a.ok(/Qa8\+ 是将军，但对方可以走 K/.test(ch.text), ch.text);
    a.equal(explainMove(fen, "Kf6", { kind: "lesson", goal: "mate" }).key, "ex.noCheckMate");
    const safe = say("7k/8/8/3Q3r/8/8/8/K7 w - - 0 1", "Qe5+", { kind: "lesson", goal: "safe" }, tl);
    a.equal(safe.r.key, "ex.movedFree", safe.text);
  });

  test("endgames: the exact king-and-pawn verdict, and what the move gave away", (a) => {
    a.equal(kpk("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1").result, "win");
    a.equal(kpk("4k3/8/8/8/8/4P3/8/4K3 b - - 0 1").result, "draw");
    a.equal(kpk("4k3/4P3/4K3/8/8/8/8/8 b - - 0 1").result, "draw", "stalemate");
    a.equal(kpk("1k6/8/8/8/8/8/p7/K7 w - - 0 1").result, "draw", "a rook's pawn, the king in front");
    a.equal(kpk("8/8/8/8/8/8/8/K1k5 w - - 0 1"), null);
    const opp = say("8/6k1/8/8/8/8/3P3K/8 w - - 0 1", "Kh3", { kind: "endgame", goal: "win" }, tl);
    a.equal(opp.r.key, "ex.missedOpposition", opp.text);
    a.ok(opp.text.startsWith("你让出了对王") && opp.text.includes("Kg3"), opp.text);
    a.equal(explainMove("8/6k1/8/8/8/8/3P3K/8 w - - 0 1", "Kg3", { kind: "endgame", goal: "win" }).facts.endgame.kpk.lost, false, "Kg3 keeps the win");
    a.equal(explainMove("4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", "e4", { kind: "endgame" }).key, "ex.pushedEarly");
    a.equal(explainMove("8/8/8/P7/4k3/8/8/7K w - - 0 1", "Kg2", { kind: "endgame" }).key, "ex.square");
    const r7 = say("6k1/R7/8/8/8/8/5PPP/6K1 w - - 0 1", "Ra1", { kind: "endgame" }, tl);
    a.equal(r7.r.key, "ex.left7th", r7.text);
    a.ok(r7.text.includes("车离开了第七横线"), r7.text);
  });

  test("openings and classics: off the book, the master's intent, what people play", (a) => {
    const fen = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const ob = say(fen, "Qh5", { kind: "opening", book: ["Nf3"] }, tl);
    a.equal(ob.r.key, "ex.offBook");
    a.ok(ob.text.includes("离开了你的开局书，常见的是 Nf3"), ob.text);
    const morphy = "rn1qkb1r/ppp2ppp/5n2/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R w KQkq - 2 7";
    const qb3 = say(morphy, "Qb3", { kind: "classic" }, tl);
    a.equal(qb3.r.key, "ex.attackTwo", qb3.text);
    a.ok(qb3.text.includes("b7") && qb3.text.includes("f7"), qb3.text);
    const guess = say(morphy, "Nc3", { kind: "classic", expected: "Qb3", human: [{ move: "c4f7", p: 0.5 }, { move: "b1c3", p: 0.2 }] }, tl);
    a.ok(guess.text.startsWith("Nc3 出动了马"), guess.text);
    a.ok(guess.text.includes("1500 分的人这里常走 Bxf7+"), guess.text);
  });

  test("a natural mistake: what players of the rating play here (Maia)", (a) => {
    const fen = "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const { text } = say(fen, "Qg4", { kind: "review", best: "d2d4", line: ["Bxg4"], human: [{ move: "d1g4", p: 0.3 }, { move: "d2d4", p: 0.5 }], rating: 1200,
      evalBefore: 40, evalAfter: -800 });
    a.ok(text.includes("1200 分的人这里也常这样走（约 30%）"), text);
  });

  test("positional facts need the evaluation to have moved, and are kept to what the move did", (a) => {
    // a pawn trade that leaves White an isolated d-pawn is only said when the evaluation moved
    const r = explainMove("rnbqkb1r/pp3ppp/4pn2/2pp4/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQkq - 0 5", "cxd5",
      { kind: "review", best: "e2e3", bestLine: ["e3"], line: ["exd5"], evalBefore: 30, evalAfter: 30 });
    a.equal(r.facts.positional, undefined, "no drop: no positional claim");
  });

  test("pure board facts: exchanges, loose men, pawns, the square", (a) => {
    a.equal(F.see("4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1", "d5"), 1, "exd5 wins a pawn");
    a.equal(F.see("4k3/2p5/3p4/4P3/8/8/8/4K3 w - - 0 1", "d6"), 0, "exd6 cxd6: even, so no gain");
    a.deepEqual(F.looseMen("4k3/8/8/3n4/4P3/8/8/4K3 b - - 0 1", "b").map((x) => x.sq), ["d5"]);
    const ps = F.pawnStructure("4k3/8/8/8/8/8/P1PP1P1P/4K3 w - - 0 1", "w");
    a.deepEqual(ps.isolated.sort(), ["a2", "f2", "h2"]);
    a.equal(F.caughtBySquare("a5", "w", "e4", "b"), true, "the king steps into the square");
    a.equal(F.caughtBySquare("a6", "w", "e4", "b"), false, "pushed: it runs");
    a.deepEqual(F.opposition("8/8/8/4k3/8/4K3/8/8 w - - 0 1"), { kind: "direct", holder: "b" });
  });

  test("every key the explainer can say has a zh sentence, and every sentence a kind", (a) => {
    const src = fs.readFileSync(path.join(ROOT, "src/app/core/explain.js"), "utf8");
    const keys = new Set([...src.matchAll(/"(ex\.[A-Za-z0-9.]+)"/g)].map((m) => m[1]));
    for (const k of keys) {
      if (k === "ex.replyLine") continue;
      a.ok(explainZh[k] != null, "no zh for " + k);
    }
    a.equal(kindOf("ex.better"), "bare");
    a.equal(kindOf("ex.loss"), "material");
    a.equal(kindOf("ex.threatFree"), "named");
    a.equal(kindOf("ex.develop"), "describe");
    a.ok(t("ex.lostOpposition").includes("你让出了对王") && tl("ex.left7th").includes("车离开了第七横线"), "the endgame sentences the plan names");
  });

  test("the recorded audit meets the acceptance (docs/measured.json explainCoverage)", (a) => {
    const m = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/measured.json"), "utf8")).explainCoverage;
    a.ok(m, "scripts/audit-explain.mjs --audit --record has been run");
    a.ok(m.after.all.reasonedPct >= 80, "a reason for ≥ 80% of mistakes (" + m.after.all.reasonedPct + ")");
    a.ok(m.after.low.namedPct >= 60, "the low-rated games: a named mechanism for ≥ 60% (" + m.after.low.namedPct + ")");
    a.ok(m.audit.barePct <= 10, "only 「更好的是 X」 for ≤ 10% of the 100 (" + m.audit.barePct + ")");
    a.ok(m.after.all.barePct <= 12, "and about as few over every mistake (" + m.after.all.barePct + ")");
    a.ok(m.audit.n >= 100 && m.audit.nodes >= 1000000, "100 checked against a 1 M-node search (" + m.audit.n + ", " + m.audit.nodes + ")");
    a.ok(m.audit.wrongPct <= 1, "wrong ≤ 1% (" + m.audit.wrongPct + ")");
    a.ok(m.before.all.reasonedPct < m.after.all.reasonedPct && m.before.low.namedPct < m.after.low.namedPct, "and better than 19.0 on the same lines");
  });

  test("explainKey / explainMotif read both shapes", (a) => {
    const fen = "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2";
    const r = explainMove(fen, "Qg4", { kind: "coach" });
    a.equal(explainKey(r), r.key);
  });
}
