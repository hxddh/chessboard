/**
 * The rules engine (chess.js): legal moves, mate and draw detection, perft,
 * FEN and PGN round-trips, and the opening book every drill is built from.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert, ctx, Chess, loadModule, allAppSource, srcOf } from "./harness.mjs";

export async function run() {
  // start position basics
  {
    const g = new Chess();
    assert(g.moves().length === 20, "20 legal moves from start");
    assert(g.turn() === "w", "white to move");
    assert(g.fen() === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "start FEN");
  }

  // scholar's mate → checkmate detection
  {
    const g = new Chess();
    for (const m of ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]) {
      assert(g.move(m) !== null, "move " + m);
    }
    assert(g.in_checkmate(), "scholar's mate is checkmate");
    assert(g.game_over(), "game over");
  }

  // pinned piece cannot move (self-check is illegal)
  {
    const g = new Chess("4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1");
    // Ne2 is pinned by the e4 rook against the e1 king
    assert(!g.in_check(), "not currently in check");
    assert(g.move("Nc3") === null, "moving the pinned knight is illegal");
    assert(g.move("Kd1") !== null, "king step aside is legal");
  }

  // fool's mate position is mate (every move illegal)
  {
    const g = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
    assert(g.in_check(), "white in check");
    assert(g.in_checkmate(), "fool's mate is checkmate");
    assert(g.moves().length === 0, "no legal moves");
  }

  // castling
  {
    const g = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const mv = g.move("O-O");
    assert(mv !== null && mv.flags.includes("k"), "kingside castle");
    assert(g.get("g1") && g.get("g1").type === "k", "king on g1");
    assert(g.get("f1") && g.get("f1").type === "r", "rook on f1");
  }

  // en passant
  {
    const g = new Chess("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
    const mv = g.move("exf6");
    assert(mv !== null && mv.flags.includes("e"), "en passant capture");
  }

  // promotion
  {
    const g = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
    const mv = g.move({ from: "a7", to: "a8", promotion: "q" });
    assert(mv !== null && mv.promotion === "q", "promotion to queen");
    assert(g.get("a8").type === "q", "queen on a8");
  }

  // underpromotion (the in-app chooser relies on all four pieces working)
  for (const p of ["r", "b", "n"]) {
    const g = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
    const mv = g.move({ from: "a7", to: "a8", promotion: p });
    assert(mv !== null && mv.promotion === p, "underpromotion to " + p);
    assert(g.get("a8").type === p, p + " on a8");
  }

  // stalemate
  {
    const g = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
    assert(g.in_stalemate(), "stalemate detected");
    assert(!g.in_checkmate(), "stalemate is not mate");
  }

  // insufficient material
  {
    const g = new Chess("8/8/8/4k3/8/8/4K3/8 w - - 0 1");
    assert(g.insufficient_material(), "K vs K insufficient material");
  }

  // PGN round-trip
  {
    const g = new Chess();
    for (const m of ["d4", "d5", "c4", "e6", "Nc3", "Nf6"]) g.move(m);
    const pgn = g.pgn();
    const g2 = new Chess();
    assert(g2.load_pgn(pgn), "PGN loads");
    assert(g2.history().length === 6, "PGN history length");
    assert(g2.fen() === g.fen(), "PGN round-trip FEN match");
  }

  // --- 6.0: perft — the rules engine is vendored, so its move generator is
  // trusted; this is the one gate that would catch a bad vendor bump. Node
  // counts are the published ones (chessprogramming.org/Perft_Results).
  {
    function perft(g, d) {
      if (d === 0) return 1;
      let n = 0;
      for (const m of g.moves({ verbose: true })) { g.move(m); n += perft(g, d - 1); g.undo(); }
      return n;
    }
    const CASES = [
      ["start", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 8902],
      ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2, 2039],
      ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3, 2812],
      ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 2, 264],
      ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 2, 1486],
    ];
    for (const [name, fen, depth, want] of CASES) {
      const got = perft(new Chess(fen), depth);
      assert(got === want, `perft ${name} depth ${depth} = ${want} (got ${got})`);
    }
  }

  // --- 6.0: rule edges the app's own tests never covered
  {
    // a pinned pawn may not capture en passant when that exposes its king
    const g = new Chess("8/8/8/2k5/3Pp3/8/8/4K2R b K d3 0 1");
    // …but here the pin is along the e-file: black king e8? use a diagonal pin
    const pinned = new Chess("4k3/8/8/8/1b1Pp3/8/8/3K4 b - d3 0 1");
    assert(pinned.moves().some((m) => m === "exd3"), "e.p. is legal when nothing is pinned through it");
    const pinnedRank = new Chess("8/8/8/8/k2Pp2R/8/8/4K3 b - d3 0 1");
    assert(!pinnedRank.moves().some((m) => m === "exd3"),
      "e.p. is illegal when both pawns leave a rank pin on the king (the classic horizontal case)");
    assert(g.moves().some((m) => m === "exd3"), "e.p. with a rook on the other file is fine");
    // castling through check is illegal; castling out of check is illegal
    const through = new Chess("4k3/8/8/8/8/8/5r2/4K2R w K - 0 1");
    assert(!through.moves().includes("O-O"), "cannot castle through an attacked square (f1)");
    const outOf = new Chess("4k3/8/8/8/8/8/4r3/4K2R w K - 0 1");
    assert(!outOf.moves().includes("O-O"), "cannot castle out of check");
    // a promotion that captures the rook takes the castling right with it
    const cap = new Chess("r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1");
    cap.move({ from: "b7", to: "a8", promotion: "q" });
    assert(cap.fen().split(" ")[2] === "-", "capturing the a8 rook by promotion clears black's queenside right");
    // insufficient material: same-coloured bishops draw, opposite-coloured do not
    // c8 and f1 are both light squares; c8 and c1 are not
    assert(new Chess("2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1").insufficient_material(),
      "KB vs KB on the same colour is insufficient");
    assert(!new Chess("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1").insufficient_material(),
      "KB vs KB on opposite colours is not (a mate exists)");
    assert(!new Chess("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1").insufficient_material(),
      "KNN vs K is not insufficient by chess.js (FIDE 5.2.2: a helpmate exists)");
  }

  // --- 6.0: the exporter owns the result token (v6-plan D1)
  {
    const { ChessPgn } = await import("../../src/web/js/pgn.js");
    assert(ChessPgn.stripResult("1. e4 e5 2. Nf3 1-0") === "1. e4 e5 2. Nf3", "a trailing 1-0 is stripped");
    assert(ChessPgn.stripResult("1. e4 e5 *") === "1. e4 e5", "a trailing * is stripped");
    assert(ChessPgn.stripResult("1. e4 e5 1/2-1/2\n") === "1. e4 e5", "a trailing draw token is stripped");
    assert(ChessPgn.stripResult("1. e4 e5") === "1. e4 e5", "nothing to strip leaves the text alone");
    const g = new Chess();
    g.load_pgn('[Event "x"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0', { sloppy: true });
    const body = ChessPgn.stripResult(g.pgn().split("\n\n").pop());
    assert(!/1-0/.test(body), "chess.js's own trailing result is gone from the movetext");
    assert(/ChessPgn\.stripResult\(game\.pgn\(\)/.test(srcOf("pgnForExport")),
      "…and the exporter strips it before appending its own");
  }

  // FEN round-trip after moves
  {
    const g = new Chess();
    g.move("e4"); g.move("c5");
    const g2 = new Chess(g.fen());
    assert(g2.fen() === g.fen(), "FEN round-trip");
    assert(g2.moves().length === g.moves().length, "same legal moves from FEN");
  }

  // undo restores position
  {
    const g = new Chess();
    const before = g.fen();
    g.move("e4");
    g.undo();
    assert(g.fen() === before, "undo restores start");
  }

  // FEN-start PGN: load_pgn honors [SetUp]/[FEN]; pgn() preserves them;
  // replaying history from the header FEN reproduces the final position
  // (the app's replay/analysis/retry all rely on this)
  {
    const startFen = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1";
    const pgn = '[SetUp "1"]\n[FEN "' + startFen + '"]\n\n1. Qa8+ Kd7 2. Qb7+ Kd6';
    const g = new Chess();
    assert(g.load_pgn(pgn, { sloppy: true }), "FEN-start PGN loads");
    assert(g.header().FEN === startFen && g.header().SetUp === "1", "FEN header retained");
    const r = new Chess(startFen);
    for (const san of g.history()) assert(r.move(san) !== null, "replay-from-header move " + san);
    assert(r.fen() === g.fen(), "replay from header FEN reproduces the game");
    const g2 = new Chess();
    assert(g2.load_pgn(g.pgn()) && g2.fen() === g.fen(), "FEN-start save/restore round-trip");
    g.reset();
    assert(!g.header().FEN, "reset clears the FEN header for a fresh game");
  }

  // opening book: every line must be legal, canonical SAN, unique, well-formed
  {
    loadModule(ctx, "src/web/js/openings.js");
    const book = ctx.CHESS_OPENINGS;
    assert(Array.isArray(book) && book.length > 50, "opening book loaded (" + (book ? book.length : 0) + " entries)");
    const seen = new Set();
    let bad = 0;
    for (const entry of book) {
      const [eco, name, seq] = entry;
      if (!/^[A-E]\d\d$/.test(eco)) { bad++; console.error("FAIL: bad ECO code", eco, name); continue; }
      if (typeof name !== "string" || !name) { bad++; console.error("FAIL: bad name for", eco); continue; }
      if (seen.has(seq)) { bad++; console.error("FAIL: duplicate line", eco, seq); continue; }
      seen.add(seq);
      const g = new Chess();
      for (const san of seq.split(" ")) {
        const mv = g.move(san);
        if (!mv) { bad++; console.error("FAIL: illegal move", san, "in", eco, name, "(" + seq + ")"); break; }
        if (mv.san !== san) { bad++; console.error("FAIL: non-canonical SAN", san, "≠", mv.san, "in", eco, name); break; }
      }
    }
    assert(bad === 0, "all opening lines legal, canonical and unique");

    // Depth. Only lines of six plies or more become drills, and until 1.15 there
    // were 38 of them with the longest running ten plies — five moves, which is
    // not an opening anyone can rehearse into a game. Soundness of the lines
    // themselves is a separate, slower check: scripts/test-openings.mjs plays
    // each one out and asks the engine whether it ends anywhere near equal.
    const drills = book.filter(([, , seq]) => seq.split(" ").length >= 6);
    const deep = drills.filter(([, , seq]) => seq.split(" ").length >= 14);
    assert(drills.length >= 100, "at least 100 lines are long enough to drill (" + drills.length + ")");
    assert(deep.length >= 60, "at least 60 drills run 14 plies or more (" + deep.length + ")");
    const longest = Math.max(...drills.map(([, , seq]) => seq.split(" ").length));
    assert(longest >= 18, "the longest line runs at least 18 plies (" + longest + ")");

    // Every drilled line needs its own name, because the name is the key both
    // the English table and the idea table are looked up by — two lines sharing
    // a name silently share one explanation.
    const drillNames = drills.map((e) => e[1]);
    const dupName = drillNames.find((n, i) => drillNames.indexOf(n) !== i);
    assert(!dupName, "every drilled line has its own name" + (dupName ? " — repeated: " + dupName : ""));

    // The difficulty filter has to actually split this category. It never did:
    // an opening drill carries no FEN, so every term in the tactic scale except
    // length silently skipped, leaving score = (plies-1)*1.5 + 3 — at least 10.5
    // for the shortest line in the book against a "hard" threshold of 6. All 38
    // drills in 1.14 were "hard", and nobody noticed because 38 rows fit on a
    // screen. Mirror the rule here so a future edit cannot collapse it again.
    const opTier = (plies) => (plies <= 8 ? "easy" : plies <= 16 ? "mid" : "hard");
    const bands = {};
    for (const [, , seq] of drills) {
      const b2 = opTier(seq.split(" ").length);
      bands[b2] = (bands[b2] || 0) + 1;
    }
    const src = allAppSource;
    assert(/isOpeningCat\(p\.cat\)[\s\S]{0,400}?plies <= 8 \? "easy" : plies <= 16 \? "mid" : "hard"/.test(src),
      "opening drills get their own tier rule rather than the tactic scale");
    assert(Object.keys(bands).length === 3 && Math.min(...Object.values(bands)) >= 15,
      "the difficulty filter splits the drills three ways (" + JSON.stringify(bands) + ")");
  }
}
