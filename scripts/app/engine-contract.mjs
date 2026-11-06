/**
 * The engine-service contract (ADR 0004, 0005): the same cases for every
 * backend. Node runs them against the fake (engine.test.mjs); the e2e runs
 * the quick ones against Stockfish wasm. Browser-safe.
 *
 * @param {Function} test harness `test(name, fn)`
 * @param {() => object} make a fresh EngineService
 * @param {{ budget?: object, label?: string, quick?: boolean }} [o]
 */
import { Chess } from "../../src/web/js/chess.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const MATE_IN_1 = "6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1";        // Rd8#
const BLACK_MATES = "3r2k1/5ppp/8/8/8/8/5PPP/6K1 b - - 0 1";      // …Rd1#
const ITALIAN = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3";
const MATED = "rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3";
const STALEMATE = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";

const legal = (fen, uci) => new Chess(fen).moves({ verbose: true }).some((m) => m.from + m.to + (m.promotion || "") === uci);

export default function engineContract(test, make, { budget = { ms: 200 }, label = "", quick = false } = {}) {
  const t = (name, fn) => test(label + name, fn);

  t("bestMove returns a legal move", async (a) => {
    const e = make();
    for (const fen of [START, MATE_IN_1, BLACK_MATES, ITALIAN]) {
      const r = await e.bestMove(fen, { budget });
      a.ok(legal(fen, r.move), fen + " → " + r.move);
      a.ok(r.thinkMs >= 0);
    }
  });

  t("bestMove finds mate in one, for either side", async (a) => {
    const e = make();
    a.equal((await e.bestMove(MATE_IN_1, { budget })).move, "d1d8");
    a.equal((await e.bestMove(BLACK_MATES, { budget })).move, "d8d1");
  });

  t("no move in a finished game", async (a) => {
    const e = make();
    a.deepEqual(await e.bestMove(MATED, { budget }), { move: null, thinkMs: 0 });
    a.equal((await e.bestMove(STALEMATE, { budget })).move, null);
    a.deepEqual((await e.analyse(MATED, { lines: 3, budget })).lines, []);
  });

  if (quick) return;

  t("analyse: lines are legal, distinct, best first, scores are White's", async (a) => {
    const e = make();
    const r = await e.analyse(START, { lines: 3, budget });
    a.equal(r.lines.length, 3);
    const firsts = r.lines.map((l) => l.moves[0]);
    a.equal(new Set(firsts).size, 3);
    for (const l of r.lines) a.ok(legal(START, l.moves[0]));
    const m = await e.analyse(BLACK_MATES, { lines: 1, budget });
    a.ok(m.lines[0].score.mate < 0, "Black mating is a negative mate");
    const w = await e.analyse(MATE_IN_1, { lines: 1, budget });
    a.ok(w.lines[0].score.mate > 0);
  });

  t("humanMoves: a legal distribution summing to 1", async (a) => {
    const e = make();
    const d = await e.humanMoves(START, 1200);
    a.ok(d.length >= 1);
    a.ok(Math.abs(d.reduce((s, x) => s + x.p, 0) - 1) < 1e-6);
    for (const x of d) a.ok(legal(START, x.move) && x.p >= 0);
    a.deepEqual(await e.humanMoves(MATED, 1500), []);
  });

  t("review: one entry per move, losses never negative, a blunder costs", async (a) => {
    const e = make();
    // 1.e4 e5 2.Qh5 Nc6 3.Qxe5+?? Nxe5: the queen for a pawn
    const moves = ["e2e4", "e7e5", "d1h5", "b8c6", "h5e5", "c6e5"];
    const seen = [];
    const r = await e.review({ startFen: START, moves }, { budget, onPly: (x) => seen.push(x.ply) });
    a.equal(r.length, 6);
    a.deepEqual(seen, [0, 1, 2, 3, 4, 5], "streamed in order");
    for (const x of r) a.ok(x.loss >= 0 && x.move === moves[x.ply]);
    a.ok(r[4].loss >= 300, "Qxe5+ gives the queen away (" + r[4].loss + ")");
    await a.rejects(e.review({ moves: ["e2e5"] }));
  });

  t("review of a game ending in mate", async (a) => {
    const e = make();
    const r = await e.review({ moves: ["f2f3", "e7e5", "g2g4", "d8h4"] }, { budget });
    a.equal(r.length, 4);
    a.ok(r[3].after.mate < 0, "the final position is Black's mate");
  });

  t("tablebase: null or a wdl in −2…2", async (a) => {
    const e = make();
    const kk = await e.tablebase("8/8/4k3/8/8/4K3/8/8 w - - 0 1");
    a.ok(kk === null || (kk.wdl >= -2 && kk.wdl <= 2));
    if (kk) a.equal(kk.wdl, 0, "two bare kings are a draw");
    a.equal(await e.tablebase(START), null, "no tablebase for 32 men");
  });
}
