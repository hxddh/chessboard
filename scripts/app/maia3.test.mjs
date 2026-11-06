import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { maia3Backend, inlineRunner, sample } from "../../src/app/services/maia3/backend.js";
import { features, moveIndex, readFen } from "../../src/app/services/maia3/encode.js";
import { compare, loadInNode, referenceCases, KL_MAX } from "./maia3-parity.mjs";
import engineContract from "./engine-contract.mjs";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";

export default function (test) {
  const model = loadInNode();
  const make = () => createEngineService(maia3Backend({ analyst: fakeBackend(), runner: inlineRunner(model) }));
  engineContract(test, make, { label: "maia3: " });

  test("maia3 encode: squares a1 = 0, Black's view flipped, history padded with the earliest", (a) => {
    const { squares, black } = readFen(START);
    a.equal(squares[0], 4); a.equal(squares[4], 6); a.equal(squares[60], -6); a.equal(black, false);
    const w = features([START]), b = features([E4]);
    a.equal(w.length, 32 * 2 * 8);
    // after 1.e4, Black to move: its king (e8 = 60) is "own king" (channel 5) on e1 (4) in the current slot (7)
    const pairs = (f) => { const s = new Set(); for (let i = 0; i < f.length; i += 2) s.add(f[i] + ":" + f[i + 1]); return s; };
    a.ok(pairs(b).has("4:" + (7 * 12 + 5)));
    a.ok(pairs(b).has("36:" + (7 * 12 + 6)), "White's e4 pawn, seen from Black, is an opponent pawn on e5 (36)");
    const h = pairs(features([START, E4]));
    a.ok(h.has("12:" + (6 * 12 + 0)) && h.has("12:" + 0), "earlier slots hold the start position, from White's side");
    a.equal(moveIndex("e2e4", false), 12 * 64 + 28);
    a.equal(moveIndex("e7e5", true), 12 * 64 + 28, "Black's moves in the mirrored frame");
    a.equal(moveIndex("a7b8n", false), 4096 + 1 * 4 + 3);
    a.equal(moveIndex("h2h1q", true), 4096 + (7 * 8 + 7) * 4);
  });

  test("maia3 parity with the PyTorch reference (wasm kernel, every position)", async (a) => {
    const m = await model;
    const cases = await referenceCases();
    a.ok(cases.length >= 50);
    const r = compare(cases, (c) => m.evaluate(c.fen, { history: c.history, self: c.self, oppo: c.oppo }));
    a.equal(r.bad.length, 0, r.bad.map((x) => x.name + " kl " + x.kl + " top " + x.top + "/" + x.refTop).join("; "));
    a.ok(r.worstKl < KL_MAX && r.top1 === cases.length);
    for (const e of [600, 1100, 1500, 2000, 2600]) a.ok(cases.some((c) => c.self === e), "rating " + e + " covered");
    a.ok(cases.some((c) => c.fen.includes(" b ")) && cases.some((c) => c.history.length === 7));
  });

  test("maia3 parity: the plain-JS kernel agrees too (a few positions)", async (a) => {
    const m = await loadInNode({ js: true });
    a.equal(m.kernel, "js");
    const cases = (await referenceCases()).filter((_, i) => i % 12 === 0);
    const r = compare(cases, (c) => m.evaluate(c.fen, { history: c.history, self: c.self, oppo: c.oppo }));
    a.equal(r.bad.length, 0);
  });

  test("maia3: ratings and history change the answer; the backend passes them through", async (a) => {
    const e = make();
    const lo = await e.humanMoves(START, 600), hi = await e.humanMoves(START, 2600);
    a.ok(JSON.stringify(lo) !== JSON.stringify(hi));
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3";
    const hist = [START, E4, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2",
      "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2"];
    const a1 = await e.humanMoves(fen, 1500), a2 = await e.humanMoves(fen, 1500, hist);
    a.ok(a1[0].p !== a2[0].p, "history is an input");
    a.ok(["f1b5", "f1c4", "d2d4"].includes(a1[0].move), "a common third move: " + a1[0].move);
  });

  test("maia3 pick: samples by rating; temperature 0 is the top move; top-p cuts the tail", async (a) => {
    const e = make();
    const top = (await e.humanMoves(START, 1500))[0].move;
    a.equal((await e.bestMove(START, { rating: 1500, temperature: 0 })).move, top);
    let x = 12345;   // mulberry32
    const random = () => { x = (x + 0x6d2b79f5) | 0; let t = Math.imul(x ^ (x >>> 15), 1 | x); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
    const seen = new Set();
    for (let i = 0; i < 40; i++) seen.add((await e.bestMove(START, { rating: 1100, random })).move);
    a.ok(seen.size > 1, "a person does not always play the same move: " + [...seen]);
    const pol = [{ move: "a", p: 0.6 }, { move: "b", p: 0.3 }, { move: "c", p: 0.1 }];
    a.equal(sample(pol, { topP: 0.5, random: () => 0.99 }), "a", "top-1 is always kept");
    a.equal(sample(pol, { topP: 0.9, random: () => 0.99 }), "b");
    a.equal(sample(pol, { random: () => 0.99 }), "c");
    a.equal(sample([], {}), null);
    a.equal((await e.bestMove("6k1/5ppp/8/8/8/8/5PPP/3R2K1 w - - 0 1", { budget: { ms: 50 } })).move, "d1d8",
      "without a rating, bestMove is the analyst's");
  });
}
