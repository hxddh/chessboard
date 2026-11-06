/**
 * The 20.0 opponents (v20-0-plan §3 P1): the ladder's shape and its record,
 * the think time, resigning, draws and converting — in Node, with the real
 * Maia-3 net for the distributions the think time is made of.
 */
import fs from "fs";
import { LADDER, OPPONENTS, opponentById } from "../../src/app/core/opponents.js";
import { complexity, thinkTime, THINK_MIN, THINK_MAX } from "../../src/app/opponents/think.js";
import { acceptsDraw, convertPick, leanPolicy, shouldResign, surprised, opponentMove, ownScalar } from "../../src/app/opponents/mind.js";
import { oppText } from "../../src/app/opponents/lines.js";
import { FACES } from "../../src/app/opponents/portraits.js";
import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { maia3Backend, inlineRunner } from "../../src/app/services/maia3/backend.js";
import { Chess } from "../../src/app/core/chess.js";
import { loadInNode } from "./maia3-parity.mjs";

const rng = (seed) => { let x = seed >>> 0 || 1; return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; }; };
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[a.length >> 1]; };

/** Opening positions (moves 1–10) and complex middlegames, from real games (scripts/fixtures/human-positions.json). */
function positions() {
  const human = JSON.parse(fs.readFileSync(new URL("../fixtures/human-positions.json", import.meta.url), "utf8"));
  const games = Object.values(human.bands).flat();
  const opening = [], complex = [];
  for (const gm of games) {
    const g = new Chess();
    const fens = [g.fen()];
    for (const u of gm.moves.split(" ")) { if (!g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })) break; fens.push(g.fen()); }
    if (opening.length < 10 && fens.length > 12) opening.push({ fen: fens[4 + (opening.length % 8)], history: fens.slice(0, 4 + (opening.length % 8)) });
    if (complex.length < 10) {
      for (let i = 24; i < fens.length; i++) {
        const c = complexity(fens[i]);
        if (c.men >= 22 && c.captures >= 3 && !c.check && c.legal >= 30) { complex.push({ fen: fens[i], history: fens.slice(0, i) }); break; }
      }
    }
    if (opening.length >= 10 && complex.length >= 10) break;
  }
  return { opening, complex };
}

export default function (test) {
  test("opponents: 12–16 people, weakest first, each named, with a face, a line and a character", (a) => {
    a.ok(LADDER.length >= 12 && LADDER.length <= 16, LADDER.length + " on the ladder");
    for (let i = 1; i < LADDER.length; i++) a.ok(LADDER[i].rating > LADDER[i - 1].rating, LADDER[i].id + " above " + LADDER[i - 1].id);
    for (const p of LADDER) {
      for (const k of ["name", "note", "hello"]) a.ok(oppText(p.id, k), p.id + " has " + k);
      a.ok(p.id === "fish" || FACES[p.id], p.id + " has a face");
      a.ok(p.pace > 0.5 && p.pace < 1.5, p.id + " pace");
      a.ok(p.play.maia != null ? p.play.maia >= 600 && p.play.maia <= 2600 : p.play.nodes > 0, p.id + " plays something");
    }
    a.equal(LADDER[LADDER.length - 1].play.elo, undefined, "the top is Stockfish at full strength");
    a.equal(opponentById("nobody").id, opponentById().id, "an unknown id is the default opponent");
    a.ok(OPPONENTS.some((o) => o.id === "friend" && !o.play));
  });

  test("think: 0.5–6 s; an opening reply is quicker than a complex middlegame for every profile; never a constant", async (a) => {
    const m = await loadInNode();
    const { opening, complex } = positions();
    a.ok(opening.length === 10 && complex.length === 10);
    for (const p of LADDER) {
      const r = rng(7);
      const rating = p.play.maia ?? 2600;
      const times = (set) => set.map((x) => thinkTime({ fen: x.fen, policy: m.evaluate(x.fen, { history: x.history.slice(-7), self: rating, oppo: rating }).policy, profile: p, random: r }));
      const o = times(opening), c = times(complex);
      for (const t of [...o, ...c]) a.ok(t >= THINK_MIN && t <= THINK_MAX, p.id + " " + t);
      a.ok(median(o) < median(c), p.id + ": opening median " + median(o) + " < middlegame " + median(c));
      a.ok(new Set([...o, ...c]).size >= 15, p.id + ": the times vary");
    }
  });

  test("think: a forced reply is quick; a clock caps the time", (a) => {
    const forced = "7k/8/8/8/8/8/6q1/7K w - - 0 40";        // Kxg2 only
    a.equal(new Chess(forced).moves().length, 1);
    a.ok(thinkTime({ fen: forced, policy: [{ move: "h1g2", p: 1 }], random: () => 0.5 }) <= 700);
    const busy = "r1bq1rk1/pp2bppp/2n1pn2/3p4/2PP4/2N1PN2/PP3PPP/R2QKB1R w KQ - 0 9";
    const flat = new Chess(busy).moves({ verbose: true }).map((m, i, all) => ({ move: m.from + m.to, p: 1 / all.length }));
    a.ok(thinkTime({ fen: busy, policy: flat, random: () => 0.5, clockMs: 10000 }) <= 250 + 1, "10 s left: a quarter-second");
  });

  test("resign: by character — sustained, not before its ply, never for a profile that plays on", (a) => {
    const p = { resign: { cp: 900, n: 3, after: 20 } };
    a.equal(shouldResign(p, [-1000, -1000, -1000], 30), true);
    a.equal(shouldResign(p, [-1000, -500, -1000], 30), false, "a recovery in between");
    a.equal(shouldResign(p, [-1000, -1000, -1000], 10), false, "too early");
    a.equal(shouldResign({ resign: null }, [-9990, -9990, -9990, -9990], 80), false);
    a.equal(shouldResign(opponentById("pip"), Array(10).fill(-9000), 100), false, "皮普 plays to the end");
    a.ok(opponentById("max").resign.cp < opponentById("lina").resign.cp, "the strong resign sooner");
  });

  test("draws: taken when worse, or late and level", (a) => {
    const p = { draw: { worse: 150 } };
    a.equal(acceptsDraw(p, -200, 20), true);
    a.equal(acceptsDraw(p, 50, 20), false);
    a.equal(acceptsDraw(p, 10, 80), true);
    a.equal(acceptsDraw(p, 300, 80), false);
  });

  test("reaction: once its look falls ≥ 2.5 to below +1", (a) => {
    a.ok(surprised(300, 0)); a.ok(!surprised(800, 400)); a.ok(!surprised(100, 0)); a.ok(!surprised(undefined, -500));
  });

  test("style: a small tilt, the distribution stays the person's", (a) => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const pol = [{ move: "d2d4", p: 0.4 }, { move: "f1c4", p: 0.3 }, { move: "f1b5", p: 0.2 }, { move: "b1c3", p: 0.1 }];
    const lean = leanPolicy(pol, fen, "principled");
    a.ok(Math.abs(lean.reduce((s, x) => s + x.p, 0) - 1) < 1e-9);
    const p = (l, m) => l.find((x) => x.move === m).p;
    a.ok(p(lean, "f1c4") > 0.3 && p(lean, "d2d4") < 0.4 && p(lean, "d2d4") > 0.3);
  });

  test("converting: keeps the win, takes a mate it sees, skips one it would not, never repeats", (a) => {
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30";
    const lines = [{ moves: ["a1a8"], own: 9990 }, { moves: ["g1f1"], own: 700 }, { moves: ["h2h4"], own: 650 }, { moves: ["a1a2"], own: -50 }];
    a.equal(convertPick([{ move: "h2h4", p: 0.9 }], lines, { fen, sees: 1, random: () => 0.5 }), "a1a8", "mate in one is seen");
    // a mate in 10 and a +16 are the same to a person: both "winning"; the prior chooses
    const far = [{ moves: ["a1e1"], own: 9900 }, { moves: ["g1f1"], own: 1600 }, { moves: ["a1a2"], own: -50 }];
    a.equal(convertPick([{ move: "g1f1", p: 0.8 }, { move: "a1e1", p: 0.01 }, { move: "a1a2", p: 0.19 }], far, { fen, sees: 1, random: () => 0.3 }), "g1f1",
      "a mate in 10 is not 'the' move; the throwaway is never picked");
    for (let i = 0; i < 20; i++) {
      const mv = convertPick([{ move: "a1a2", p: 0.99 }, { move: "g1f1", p: 0.01 }], far, { fen, random: rng(i) });
      a.ok(mv !== "a1a2", "never the move that drops the win");
    }
    const back = new Chess(fen); back.move("Kf1");
    a.equal(convertPick([{ move: "g1f1", p: 0.99 }, { move: "h2h4", p: 0.01 }], [{ moves: ["g1f1"], own: 1700 }, { moves: ["h2h4"], own: 1690 }],
      { fen, history: [back.fen()], random: () => 0.1 }), "h2h4", "not back into a position it has had");
  });

  test("opponentMove over the fake engine: a move, a think time, its look; resigns when hopeless", async (a) => {
    const e = createEngineService(fakeBackend());
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const r = await e.bestMove(start, opponentById("ada"), { history: [], looks: [], plies: 0, random: rng(3) });
    a.ok(new Chess(start).moves({ verbose: true }).some((m) => m.from + m.to === r.move), r.move);
    a.ok(r.thinkMs >= THINK_MIN && r.thinkMs <= THINK_MAX && Number.isFinite(r.look) && !r.resign);
    // Black, a queen and two rooks down, its looks already bad: 薇拉 resigns, 皮普 plays on
    const lost = "4k3/8/8/8/8/8/8/RR1QK3 b - - 0 40";
    const vera = await e.bestMove(lost, opponentById("vera"), { looks: [-2000, -2000], plies: 60, random: rng(1) });
    a.ok(vera.resign && vera.move === null, "vera resigns");
    const pip = await e.bestMove(lost, opponentById("pip"), { looks: Array(10).fill(-2000), plies: 60, random: rng(1) });
    a.ok(!pip.resign && pip.move, "pip plays on");
  });

  test("opponentMove on Maia-3: converts a rook-up ending by the human prior", async (a) => {
    const e = createEngineService(maia3Backend({ analyst: fakeBackend(), runner: inlineRunner(loadInNode()) }));
    const fen = "6k1/5ppp/8/8/8/8/5PPP/R5K1 w - - 0 30";
    const r = await e.bestMove(fen, opponentById("pip"), { history: [], random: rng(5) });
    a.ok(r.converting && r.move, "the fake engine's look says it is winning: " + r.look + " " + r.move);
    a.equal(r.move, "a1a8", "mate in one is played, even by 皮普");
    a.ok(ownScalar({ mate: 3 }) === 9970 && ownScalar({ cp: -40 }) === -40);
  });
}
