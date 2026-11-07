/**
 * 看 N 步 / 盲走: the bank's band, and the first question not waiting.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";
import { assert, root, loadModule } from "./harness.mjs";

export async function run() {
  // v8-3-plan T1 / T2: 看 N 步 / 盲走 draw from the bank's band for the mode's
  // rating, and look's plies past the puzzle's line are the engine's move at
  // the review's budget — the rule without an engine (pickMove) where it has none
  {
    const vctx = { console };
    vctx.globalThis = vctx;
    vctx.window = vctx;
    vm.createContext(vctx);
    loadModule(vctx, "src/web/js/chess.js");
    loadModule(vctx, "src/web/js/trainer/visual-modes.js");
    const V = vctx.CHESS_VISUAL, C = vctx.Chess;
    const ana = fs.readFileSync(path.join(root, "src/web/js/review/analysis.js"), "utf8");
    assert(Number((/const SCAN_BUDGET = (\d+);/.exec(ana) || [])[1]) === V.LOOK_BUDGET,
      "visual-modes LOOK_BUDGET is the review's SCAN_BUDGET (" + V.LOOK_BUDGET + ")");
    const idx = { bands: [{ band: 600 }, { band: 800 }, { band: 1000 }], themes: { m1: { bands: [30, 5, 25] }, m2: { bands: [40, 40, 3] } } };
    assert(V.bankBand(idx, 600, ["m1", "m2"]) === 600 && V.bankBand(idx, 800, ["m1", "m2"]) === 600 && V.bankBand(idx, 1000, ["m1", "m2"]) === 600 &&
      V.bankBand(idx, 800, []) === 800 && V.bankBand({ bands: idx.bands, themes: {} }, 1000, ["m1"]) === 1000,
      "bankBand: the rating's band, or the nearest holding a set's worth of each mate, or the rating's band when none does");
    assert(V.keyBand("lc-ab|1400") === 1400 && V.keyBand("lc-ab|3|99|1400") === 1400 && V.keyBand("m1-x|3|99") === null &&
      V.keyBand("m1-x") === null && V.keyBand("lc-ab") === null, "keyBand: a bank review key ends in its band, a local one has none");
    const A = { id: "lc-a" }, B = { id: "b" }, Cq = { id: "c" };
    assert(V.blindNext([[A], []], [[B], [Cq]], 7, 0, 1, []) === Cq && V.blindNext([[A], []], [[B], [Cq]], 7, 0, 0, []) === A &&
      V.blindNext([[A], []], [[B], [Cq]], 7, 0, 0, ["lc-a"]) === B && V.blindNext(null, [[B], []], 7, 0, 1, []) === B &&
      V.blindNext(null, [[], []], 7, 0, 0, []) === null,
      "blindNext: the level asked for from the bank, then the local book, then the other level");
    // the Italian, Black to move; the puzzle's line is one ply, the engine plays two
    const p = { id: "lc-t", src: "lichess", rating: 1450, cat: "tac", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", solution: ["Nf6"] };
    const asked = [];
    const eng = { "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4": "f3g5", "r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4": "d7d5" };
    const best = async (fen) => { asked.push(fen); return eng[fen] || null; };
    const q = await V.buildLook(C, p, 3, 11, best);
    const q2 = await V.buildLook(C, p, 3, 11, best);
    assert(q && q.sans.join(" ") === "Nf6 Ng5 d5" && asked.length === 4 && JSON.stringify(q) === JSON.stringify(q2) && /^lc-t\|3\|11\|1400$/.test(q.key),
      "buildLook: the puzzle's line first, then the engine's moves (asked only past the line), the same question twice, the key ends in the band", q && q.sans.join(" ") + " " + asked.length + " " + (q && q.key));
    const none = await V.buildLook(C, p, 3, 11, async () => null);
    const bad = await V.buildLook(C, p, 3, 11, async () => "a1a1");
    const rule = await V.buildLook(C, p, 3, 11);
    assert(rule && JSON.stringify(none) === JSON.stringify(rule) && JSON.stringify(bad) === JSON.stringify(rule) && rule.sans[0] === "Nf6",
      "buildLook: no engine move (none, or one that is not legal) — pickMove's rule, exactly as without an engine", rule && rule.sans.join(" "));
    const pool = V.lookPool([p, Object.assign({}, p, { id: "lc-u", solution: ["Nf6", "Ng5"] })]);
    const a = await V.lookQuestion(C, pool, 99, 0, 3, best), b = await V.lookQuestion(C, pool, 99, 0, 3, best);
    assert(a && JSON.stringify(a) === JSON.stringify(b), "lookQuestion with the engine: the same seed, the same question", a && a.key);
  }

  // v8-4-plan T1: 看 N 步's first question no longer waits for searches. Twelve
  // whole sets (four seeds × three answer patterns, N moving 2–6 with them)
  // over the hand-written book dressed as bank puzzles, with an "engine" that
  // is a pure function of the FEN, as the real one is: the same seed and the
  // same answers give the same 120 questions, key for key. Then a review:
  // built from the plies its key kept (engPlies), with no engine at all, it is
  // the question the engine built.
  {
    const vctx = { console };
    vctx.globalThis = vctx;
    vctx.window = vctx;
    vm.createContext(vctx);
    loadModule(vctx, "src/web/js/chess.js");
    loadModule(vctx, "src/web/js/puzzles.js");
    loadModule(vctx, "src/web/js/trainer/visual-modes.js");
    const V = vctx.CHESS_VISUAL, C = vctx.Chess;
    const pool = V.lookPool(vctx.CHESS_PUZZLES.map((p) => Object.assign({}, p, { id: "lc-" + p.id, src: "lichess", rating: 1450 })));
    const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
    let searches = 0;
    const best = async (fen) => {
      searches++;
      const ms = new C(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || "")).sort();
      return ms.length ? ms[fnv(fen) % ms.length] : null;
    };
    const asked = (q) => q.t !== "cap" || !!q.target;
    const sets = async () => {
      const out = [], qs = [];
      for (const seed of [1, 99, 1790600000, 4000000007]) for (const pat of [0, 0x3ff, 0x2b5]) {
        let n = 2;
        const keys = [];
        for (let k = 0; k < 10; k++) {
          const q = await V.lookNth(C, pool, seed, k, n, best, asked);
          keys.push(q ? q.key + " " + q.sans.join(" ") + " " + q.t : "null");
          if (q) qs.push(q);
          n = Math.max(2, Math.min(6, n + ((pat >> k) & 1 ? 1 : -1)));
        }
        out.push(seed + "/" + pat + ": " + keys.join(", "));
      }
      return { sha: crypto.createHash("sha256").update(out.join("\n")).digest("hex"), qs };
    };
    const first = await sets();
    const once = searches;
    const again = await sets();
    const qs = first.qs;
    assert(pool.length === 168 && first.sha === again.sha && qs.length >= 100 && once > 50,
      "v8-4-plan T1: twelve whole 看 N 步 sets (seed × answers) come out the same twice, question for question (" + qs.length + " questions, " + once + " searches)", first.sha.slice(0, 12) + " / " + again.sha.slice(0, 12) + " / pool " + pool.length);
    // plies kept with the key → the same question with no engine; none kept → the search
    let same = 0, plied = 0, quiet = 0;
    const noEngine = () => { throw new Error("searched"); };
    for (const q of qs.slice(0, 60)) {
      const p = pool.find((x) => x.id === q.pid);
      const seen = new Map();
      const tee = async (fen) => { const u = await best(fen); if (u) seen.set(V.fenTag(fen), u); return u; };
      const again = await V.buildLook(C, p, q.n, Number(q.key.split("|")[2]), tee);
      const eng = V.engPlies(C, again, seen);
      const kept = V.engFrom(eng);
      const rebuilt = await V.buildLook(C, p, q.n, Number(q.key.split("|")[2]), (fen) => (kept.has(V.fenTag(fen)) ? Promise.resolve(kept.get(V.fenTag(fen))) : noEngine()));
      if (JSON.stringify(again) === JSON.stringify(q) && JSON.stringify(rebuilt) === JSON.stringify(q)) same++;
      if (eng) plied++;
      if (q.n <= (p.line || p.solution).length && !eng) quiet++;
    }
    assert(same === 60 && plied >= 10 && quiet >= 10,
      "v8-4-plan T1: a review rebuilt from the engine plies its key kept is the engine's question, with no search (" + plied + " with plies, " + quiet + " inside the puzzle's own line)", same + "/60");
    assert(V.engFrom("a1:e2e4,b2:zz,c3:e7e8q,,d4").size === 2 && V.engFrom(null).size === 0 && V.engPlies(C, qs[0], new Map()) === "",
      "v8-4-plan T1: engFrom keeps only what reads as a move; engPlies of a question with no engine answer is empty");
  }
}
