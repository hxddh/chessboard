import { createEngineService, fakeBackend, parseInfo, whiteScore, scoreCp } from "../../src/app/services/engine.js";
import engineContract from "./engine-contract.mjs";

export default function (test) {
  engineContract(test, () => createEngineService(fakeBackend()), { label: "fake: " });

  test("parseInfo reads multipv, depth, score and pv", (a) => {
    a.deepEqual(parseInfo("info depth 12 seldepth 18 multipv 2 score cp -31 nodes 1 nps 2 pv e7e5 g1f3 b8c6"),
      { multipv: 2, depth: 12, score: { cp: -31 }, pv: ["e7e5", "g1f3", "b8c6"] });
    a.deepEqual(parseInfo("info depth 3 score mate -2 pv h7h6 d1d8").score, { mate: -2 });
    a.equal(parseInfo("info string NNUE evaluation"), null);
    a.equal(parseInfo("bestmove e2e4"), null);
  });

  test("scores turn to White's point of view", (a) => {
    const b = "8/8/8/8/8/8/8/8 b - - 0 1", w = "8/8/8/8/8/8/8/8 w - - 0 1";
    a.deepEqual(whiteScore({ cp: 30 }, b), { cp: -30 });
    a.deepEqual(whiteScore({ mate: 2 }, b), { mate: -2 });
    a.deepEqual(whiteScore({ cp: 30 }, w), { cp: 30 });
    a.ok(scoreCp({ mate: 1 }) > scoreCp({ mate: 3 }) && scoreCp({ mate: 3 }) > scoreCp({ cp: 5000 }));
    a.ok(scoreCp({ mate: -1 }) < scoreCp({ mate: -3 }) && scoreCp({ mate: -3 }) < scoreCp({ cp: -5000 }));
  });

  test("the fake is deterministic", async (a) => {
    const e = createEngineService(fakeBackend());
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const x = await e.analyse(fen, { lines: 4 }), y = await e.analyse(fen, { lines: 4 });
    a.deepEqual(x, y);
  });
}
