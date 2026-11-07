/**
 * The rules (core/chess.js: chess.js, vendored, and the FIDE draw rules on
 * top): legal moves, mate and draw detection, castling, en passant,
 * promotion, perft against the published node counts, FEN and PGN round
 * trips. chess.js is the single judge of legality in the app, so a bad
 * vendor bump has to fail here.
 */
import { Chess, ChessFide } from "../../src/app/core/chess.js";

function perft(g, d) {
  if (d === 0) return 1;
  let n = 0;
  for (const m of g.moves({ verbose: true })) { g.move(m); n += perft(g, d - 1); g.undo(); }
  return n;
}

export default function (test) {
  test("rules: the start position, scholar's and fool's mate", (a) => {
    const g = new Chess();
    a.equal(g.moves().length, 20, "20 legal moves from the start");
    a.equal(g.turn(), "w");
    a.equal(g.fen(), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    for (const m of ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]) a.ok(g.move(m), "move " + m);
    a.ok(g.in_checkmate() && g.game_over(), "scholar's mate is mate");
    const f = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    a.ok(f.in_check() && f.in_checkmate() && f.moves().length === 0, "fool's mate is mate");
  });

  test("rules: a pinned piece cannot move; castling; en passant; promotion", (a) => {
    const pin = new Chess("4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1");
    a.equal(pin.move("Nc3"), null, "the pinned knight cannot move");
    a.ok(pin.move("Kd1"), "the king can step aside");
    const c = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const oo = c.move("O-O");
    a.ok(oo && oo.flags.includes("k"), "kingside castling");
    a.equal(c.get("g1").type, "k"); a.equal(c.get("f1").type, "r");
    const ep = new Chess("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3").move("exf6");
    a.ok(ep && ep.flags.includes("e"), "en passant");
    for (const p of ["q", "r", "b", "n"]) {
      const g = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
      const mv = g.move({ from: "a7", to: "a8", promotion: p });
      a.ok(mv && mv.promotion === p && g.get("a8").type === p, "promotion to " + p);
    }
  });

  test("rules: stalemate and insufficient material", (a) => {
    const s = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    a.ok(s.in_stalemate() && !s.in_checkmate(), "stalemate, not mate");
    a.ok(new Chess("8/8/8/4k3/8/8/4K3/8 w - - 0 1").insufficient_material(), "K v K");
    a.ok(new Chess("2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1").insufficient_material(), "KB v KB, bishops on one colour");
    a.ok(!new Chess("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1").insufficient_material(), "KB v KB on opposite colours is not (a mate exists)");
  });

  test("rules: perft — the published node counts (chessprogramming.org)", (a) => {
    for (const [name, fen, depth, want] of [
      ["start", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 8902],
      ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2, 2039],
      ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3, 2812],
      ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 2, 264],
      ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 2, 1486],
    ]) a.equal(perft(new Chess(fen), depth), want, "perft " + name + " depth " + depth);
  });

  test("rules: the edges — e.p. through a pin, castling through or out of check, a promotion that takes a rook", (a) => {
    a.ok(new Chess("4k3/8/8/8/1b1Pp3/8/8/3K4 b - d3 0 1").moves().includes("exd3"), "e.p. when nothing is pinned through it");
    a.ok(!new Chess("8/8/8/8/k2Pp2R/8/8/4K3 b - d3 0 1").moves().includes("exd3"), "no e.p. when both pawns leave a rank pin on the king");
    a.ok(!new Chess("4k3/8/8/8/8/8/5r2/4K2R w K - 0 1").moves().includes("O-O"), "no castling through an attacked square");
    a.ok(!new Chess("4k3/8/8/8/8/8/4r3/4K2R w K - 0 1").moves().includes("O-O"), "no castling out of check");
    const cap = new Chess("r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1");
    cap.move({ from: "b7", to: "a8", promotion: "q" });
    a.equal(cap.fen().split(" ")[2], "-", "taking the a8 rook clears black's queenside right");
  });

  test("rules: FEN and PGN round trips, undo, a game from a set-up position", (a) => {
    const g = new Chess();
    for (const m of ["d4", "d5", "c4", "e6", "Nc3", "Nf6"]) g.move(m);
    const g2 = new Chess();
    a.ok(g2.load_pgn(g.pgn()) && g2.history().length === 6 && g2.fen() === g.fen(), "PGN round trip");
    const f = new Chess(g.fen());
    a.ok(f.fen() === g.fen() && f.moves().length === g.moves().length, "FEN round trip");
    const u = new Chess(), before = u.fen();
    u.move("e4"); u.undo();
    a.equal(u.fen(), before, "undo");
    const start = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1";
    const p = new Chess();
    a.ok(p.load_pgn('[SetUp "1"]\n[FEN "' + start + '"]\n\n1. Qa8+ Kd7 2. Qb7+ Kd6', { sloppy: true }), "a FEN-start PGN loads");
    a.equal(p.header().FEN, start);
    const r = new Chess(start);
    for (const san of p.history()) a.ok(r.move(san), "replay " + san);
    a.equal(r.fen(), p.fen(), "replaying from the header's FEN gives the same position");
  });

  test("rules: FIDE draws — repetition (with the e.p. square read as FIDE does), the 50-move clock, mating material", (a) => {
    const line = ["e4", "e5", "Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1", "Ng8"];
    a.equal(ChessFide.repetitionCount(null, line, Chess), 3, "1.e4 e5 2.Nf3 Nf6 3.Ng1 Ng8 4.Nf3 Nf6 5.Ng1 Ng8 is threefold");
    a.equal(ChessFide.halfmoveClock("8/8/8/4k3/8/8/4K3/4R3 w - - 99 80"), 99);
    a.ok(!ChessFide.hasMatingMaterial(new Chess("8/8/8/4k3/8/8/4K3/8 w - - 0 1").board(), "w"), "a bare king has no mating material");
    a.ok(ChessFide.hasMatingMaterial(new Chess("8/8/8/4k3/8/8/4K3/4R3 w - - 0 1").board(), "w"), "a rook has");
    a.ok(ChessFide.hasMatingMaterial(new Chess("8/8/8/4k3/8/8/4K3/2NN4 w - - 0 1").board(), "w"), "two knights have (a helpmate exists)");
  });
}
