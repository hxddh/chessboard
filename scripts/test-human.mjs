/**
 * 13.0 H: the Maia layer (src/web/js/human/) held to lc0's rules — the
 * tables, the move indices, the 112 input planes, the net's shape — and the
 * 1100 net's answers in a few positions held to what they were when they
 * were checked by hand (scripts/measure-human.mjs measures the rest).
 *
 *   node scripts/test-human.mjs
 */
import fs from "fs";
import path from "path";
import zlib from "zlib";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";

let failed = 0;
const assert = (ok, msg) => { if (ok) console.log("ok   " + msg); else { failed++; console.error("FAIL " + msg); } };

const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/human/lc0-tables.js", "src/web/js/human/maia-net.js"]);
const { Chess, IDX_TO_MOVE, CONV_POLICY_MAP, parseNet, encodePlanes, moveIndex, movePolicy, maiaCore } = ctx;

// --- the tables -------------------------------------------------------------------
assert(IDX_TO_MOVE.length === 1858 && new Set(IDX_TO_MOVE).size === 1858, "1858 policy moves, none twice");
const mapped = [...CONV_POLICY_MAP].filter((j) => j >= 0);
assert(CONV_POLICY_MAP.length === 73 * 64 && mapped.length === 1858 && new Set(mapped).size === 1858,
  "the convolutional map: 73 planes × 64 squares, every one of the 1858 moves exactly once");
assert(IDX_TO_MOVE.includes("e1h1") && IDX_TO_MOVE.includes("e1a1") && !IDX_TO_MOVE.includes("a7a8n") && IDX_TO_MOVE.includes("a7a8q"),
  "castling is king-takes-rook, a knight promotion is the bare move");

// --- move indices ---------------------------------------------------------------------
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";
const idx = (m) => IDX_TO_MOVE.indexOf(m);
assert(moveIndex("e2e4", START) === idx("e2e4"), "White's e2e4 is e2e4");
assert(moveIndex("e7e5", AFTER_E4) === idx("e2e4"), "Black's e7e5 is seen from Black's side: e2e4");
const CASTLE = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
assert(moveIndex("e1g1", CASTLE) === idx("e1h1") && moveIndex("e1c1", CASTLE) === idx("e1a1"), "White castles as the king takes its rook");
const CASTLE_B = "r3k2r/8/8/8/8/8/8/R3K2R b KQkq - 0 1";
assert(moveIndex("e8g8", CASTLE_B) === idx("e1h1") && moveIndex("e8c8", CASTLE_B) === idx("e1a1"), "…and Black, turned");
const KING_STEP = "8/8/8/8/8/8/8/4K2k w - - 0 1";
assert(moveIndex("e1f1", KING_STEP) === idx("e1f1"), "a king's ordinary step from e1 is not castling");
const PROMO = "8/4P1k1/8/8/8/8/5K2/8 w - - 0 1";
assert(moveIndex("e7e8q", PROMO) === idx("e7e8q") && moveIndex("e7e8n", PROMO) === idx("e7e8") && moveIndex("e7e8r", PROMO) === idx("e7e8r"),
  "promotions: q/r/b by suffix, a knight as the bare move");

// --- the input planes ---------------------------------------------------------------
const P = (x, plane) => [...x.subarray(plane * 64, plane * 64 + 64)];
const ones = (a) => a.reduce((s, v, i) => (v ? s.concat(i) : s), []);
{
  const x = encodePlanes([START]);
  assert(x.length === 112 * 64, "112 planes of 64");
  assert(ones(P(x, 0)).join() === "8,9,10,11,12,13,14,15" && ones(P(x, 11)).join() === "60", "start: our pawns on the second rank, their king on e8");
  assert(P(x, 13).every((v) => v === 0), "start: the positions before the first are empty");
  assert(P(x, 104).every((v) => v === 1) && P(x, 107).every((v) => v === 1) && P(x, 108).every((v) => v === 0) && P(x, 111).every((v) => v === 1),
    "start: castling both ways for both, White to move, the plane of ones");
}
{
  const c = new Chess();
  const fens = [c.fen()];
  c.move("e4"); fens.push(c.fen());
  const x = encodePlanes(fens);
  assert(ones(P(x, 0)).join() === "8,9,10,11,12,13,14,15", "after 1.e4, Black to move: Black's pawns on the second rank, turned");
  assert(ones(P(x, 6)).includes(36) && !ones(P(x, 6)).includes(52), "…and White's e4 pawn on e5 as Black sees it (e2 is empty)");
  assert(ones(P(x, 13)).join() === "8,9,10,11,12,13,14,15" && ones(P(x, 19)).includes(52), "…and the position before it, from Black's side too (White's e-pawn still home)");
  assert(P(x, 108).every((v) => v === 1), "…with the Black-to-move plane on");
}
{
  const c = new Chess();
  const fens = [c.fen()];
  for (const m of ["Nf3", "Nf6", "Ng1", "Ng8"]) { c.move(m); fens.push(c.fen()); }
  const x = encodePlanes(fens);
  assert(P(x, 12).every((v) => v === 1), "a position seen before carries the repetition plane");
  assert(P(x, 109).every((v) => v === 4), "the 50-move plane carries the half-move count as is (4)");
}
{
  const fen = "8/8/8/8/8/8/5k2/4K3 w - - 7 60";
  const x = encodePlanes([fen]);
  assert(ones(P(x, 13 + 5)).join() === ones(P(x, 5)).join() && ones(P(x, 13 * 7 + 5)).length === 1,
    "a game from a FEN fills the missing history with that position (lc0's fen_only)");
}

// --- the net --------------------------------------------------------------------------
const net = parseNet(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "third_party/maia/maia-1100.pb.gz"))));
assert(net.input.ins === 112 && net.input.outs === 64 && net.residual.length === 6 && net.residual.every((r) => !!r.se) &&
  net.policy1.outs === 64 && net.policy.outs === 80, "maia-1100: 112 → 64, six SE residual blocks, a 64 → 80 policy head");
for (const band of [1300, 1500, 1700, 1900]) {
  const n = parseNet(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "third_party/maia/maia-" + band + ".pb.gz"))));
  assert(n.residual.length === 6 && n.policy.outs === 80, "maia-" + band + " has the same shape");
}
{
  let refused = "";
  try { parseNet(new Uint8Array([0x22, 0x02, 0x12, 0x00])); } catch (e) { refused = e.message; }
  assert(/input format 0/.test(refused), "a file of another shape is refused by name, not run (" + refused + ")");
}

// The answers, checked by hand when this was written (13.0): plausible
// human moves — 1.e4 and 1.d4 first; the Fried Liver lunge 4.Ng5, which a
// 1100 plays more than a 1900; castling and both promotions by colour.
const play = (sans, fen) => {
  const c = fen ? new Chess(fen) : new Chess();
  const fens = [c.fen()];
  for (const m of sans) { c.move(m); fens.push(c.fen()); }
  const legal = c.moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
  return movePolicy(net, fens, legal);
};
const top = (pol, k = 2) => pol.slice(0, k).map((r) => r.uci).join(" ");
const near = (pol, uci, want) => { const r = pol.find((x) => x.uci === uci); return !!r && Math.abs(r.p * 100 - want) < 0.5; };
{
  const pol = play([]);
  assert(top(pol) === "e2e4 d2d4" && near(pol, "e2e4", 66.1) && near(pol, "d2d4", 21.0), "1100 at the start: e4 66.1%, d4 21.0%");
  assert(Math.abs(pol.reduce((s, r) => s + r.p, 0) - 1) < 1e-6, "…the legal moves' probabilities sum to one");
}
{
  const pol = play(["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6"]);
  assert(top(pol, 1) === "f3g5" && near(pol, "f3g5", 40.2), "1100 after 3…Nf6: Ng5 40.2%");
}
assert(top(play(["e4"]), 1) === "e7e5", "1100 answers 1.e4 with …e5");
assert(top(play([], "8/4P1k1/8/8/8/8/5K2/8 w - - 0 1"), 1) === "e7e8q" && top(play([], "8/5k2/8/8/8/8/4p1K1/8 b - - 0 1"), 1) === "e2e1q",
  "a pawn on the seventh promotes to a queen, for either side");

// The worker is built from maiaCore's own text (human/worker.js): it must
// refer to nothing outside itself, or the worker dies on its first message.
{
  const rebuilt = new Function("return (" + maiaCore.toString() + ")")()(Array.from(IDX_TO_MOVE), Int16Array.from(CONV_POLICY_MAP));
  const raw = zlib.gunzipSync(fs.readFileSync(path.join(ROOT, "third_party/maia/maia-1100.pb.gz")));
  const n2 = rebuilt.parseNet(new Uint8Array(raw));
  const c = new Chess();
  const legal = c.moves({ verbose: true }).map((m) => m.from + m.to);
  const a = rebuilt.movePolicy(n2, [c.fen()], legal), b = movePolicy(net, [c.fen()], legal);
  assert(a.length === b.length && a.every((r, i) => r.uci === b[i].uci && Math.abs(r.p - b[i].p) < 1e-6),
    "maiaCore rebuilt from its own text (as the worker builds it) answers exactly as the module does");
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("human: all tests passed");
