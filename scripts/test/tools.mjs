/**
 * PGN utilities, the position editor, the post-game report and material.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert, ctx, Chess, loadModule, srcOf } from "./harness.mjs";

export async function run() {
  // PGN utilities: splitting a multi-game file must not lose games (importing a
  // database used to silently keep only the last one)
  {
    loadModule(ctx, "src/web/js/pgn.js");
    const P = ctx.ChessPgn;
    const one = '[Event "A"]\n[White "X"]\n[Black "Y"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n';
    const two = one + '\n[Event "B"]\n[White "P"]\n[Black "Q"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n';
    assert(P.splitGames("").length === 0, "empty PGN yields no games");
    assert(P.splitGames(one).length === 1, "single-game PGN stays one game");
    const games = P.splitGames(two);
    assert(games.length === 2, "two-game PGN splits into two (" + games.length + ")");
    assert(P.tag(games[0], "White") === "X" && P.tag(games[1], "White") === "P", "each chunk keeps its own tags");
    // bare movetext has no [Event] tag at all — must still come back importable
    assert(P.splitGames("1. e4 e5 2. Nf3").length === 1, "tagless movetext is one game");
    for (const g of games) {
      const probe = new Chess();
      assert(probe.load_pgn(g, { sloppy: true }) && probe.history().length > 0, "split chunk parses: " + P.tag(g, "Event"));
    }
    const s = P.summary(games[1]);
    assert(s.white === "P" && s.black === "Q" && s.result === "0-1" && s.plies === 4,
      "summary reads headers and counts plies (" + JSON.stringify(s) + ")");

    // startFen: a game with no moves yet. This is the shape the autosave, the
    // save slots and the exporter all produce the moment a position is set up
    // and before it is played into — and chess.js refuses to parse it, which is
    // how "edit a position, close the app" used to lose the position outright.
    const POS = "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1";
    const held = new Chess(POS);
    held.header("SetUp", "1", "FEN", POS);
    const autosaved = held.pgn(); // literally what saveGame() writes
    assert(!new Chess().load_pgn(autosaved), "chess.js still rejects a movetext-free PGN");
    assert(P.startFen(autosaved) === POS, "startFen recovers the position load_pgn drops");
    assert(P.startFen(autosaved + "*\n") === POS, "a lone result token does not hide the FEN");
    assert(P.startFen(one) === null, "a game from the standard array declares no start FEN");
    assert(P.startFen("") === null && P.startFen(null) === null, "no PGN, no start FEN");
    // [FEN] without [SetUp "1"] is not a set-up game under the PGN spec
    assert(P.startFen('[FEN "' + POS + '"]\n\n') === null, "FEN without SetUp is ignored");
    assert(P.startFen('[SetUp "0"]\n[FEN "' + POS + '"]\n\n') === null, "SetUp 0 is ignored");
    assert(new Chess().validate_fen(P.startFen(autosaved)).valid, "the recovered FEN is loadable");
    // an exported set-up position must survive the round trip back in
    const exported = '[Event "?"]\n[SetUp "1"]\n[FEN "' + POS + '"]\n\n*\n';
    assert(P.startFen(exported) === POS, "an exported position round-trips");
  }

  // position editor: FEN generation plus the legality rules chess.js does not
  // enforce on its own (an editor must never hand the game an unplayable FEN)
  {
    loadModule(ctx, "src/web/js/editor.js");
    const E = ctx.ChessEditor;
    const start = E.fromFen(new Chess().fen(), Chess);
    assert(E.toFen(start) === new Chess().fen().replace(/ \S+ \d+ \d+$/, " - 0 1"),
      "round-trips the start position (" + E.toFen(start) + ")");
    assert(E.validate(start, Chess) === null, "start position is playable");

    const put = (state, sq, piece) => {
      const { r, c } = E.indexOf(sq);
      state.board[r][c] = piece;
      return state;
    };
    const bare = () => ({ board: E.emptyBoard(), turn: "w", castling: { K: false, Q: false, k: false, q: false } });

    let st = bare();
    assert(E.validate(st, Chess) === "edErr.noWhiteKing", "empty board is rejected");
    put(st, "e1", { type: "k", color: "w" });
    assert(E.validate(st, Chess) === "edErr.noBlackKing", "missing black king is rejected");
    put(st, "e8", { type: "k", color: "b" });
    assert(E.validate(st, Chess) === null, "two lone kings are playable");
    put(st, "d1", { type: "k", color: "w" });
    assert(E.validate(st, Chess) === "edErr.manyWhiteKings", "second white king is rejected");

    st = bare();
    put(st, "e1", { type: "k", color: "w" });
    put(st, "e8", { type: "k", color: "b" });
    put(st, "a1", { type: "p", color: "w" });
    assert(E.validate(st, Chess) === "edErr.pawnBackRank", "pawn on the first rank is rejected");

    // white to move while black is already in check is unreachable in a real game
    st = bare();
    put(st, "e1", { type: "k", color: "w" });
    put(st, "e8", { type: "k", color: "b" });
    put(st, "e7", { type: "r", color: "w" });
    assert(E.validate(st, Chess) === "edErr.otherInCheck", "side not to move in check is rejected");

    // castling rights are dropped when the placement cannot support them
    st = bare();
    put(st, "e1", { type: "k", color: "w" });
    put(st, "e8", { type: "k", color: "b" });
    st.castling.K = true; // no rook on h1
    assert(E.toFen(st).split(" ")[2] === "-", "unsupported castling right is filtered out");
    put(st, "h1", { type: "r", color: "w" });
    assert(E.toFen(st).split(" ")[2] === "K", "supported castling right is kept");
  }

  // post-game review: the report is what the user reads instead of the raw
  // numbers, so the arithmetic behind it gets its own checks
  {
    loadModule(ctx, "src/web/js/review.js");
    const R = ctx.ChessReview;
    assert(R.summarize(null, [], "w") === null, "no analysis yields no report");
    assert(R.summarize([0], [], "w") === null, "a game with no moves yields no report");

    // White drops 4 pawns on ply 2 (a blunder); Black plays perfectly.
    //   scalars: start 0, after w1 0, after b1 0, after w2 -400, after b2 -400
    const scalars = [0, 0, 0, -400, -400];
    const history = ["e4", "e5", "Qh5", "Nc6"];
    const s = R.summarize(scalars, history, "w");
    assert(s.counts.w.blunder === 1, "white's 400cp drop counts as a blunder");
    assert(s.counts.b.blunder === 0 && s.counts.b.mistake === 0, "black's moves cost nothing");
    assert(s.worst && s.worst.san === "Qh5", "the turning point is the costliest move (" + (s.worst && s.worst.san) + ")");
    assert(s.worst.side === "w" && s.worst.ply === 2, "turning point attributed to the right side and ply");
    assert(s.worst.moveNo === 2, "turning point reported as move 2");
    assert(s.acpl.w === 200 && s.acpl.b === 0, "acpl averaged per side (w=" + s.acpl.w + ", b=" + s.acpl.b + ")");
    assert(s.acc.b === 100, "a flawless side scores 100%");
    assert(s.acc.w < s.acc.b, "the blundering side scores lower");

    // A game that starts from an edited position with Black to move: ply 0 is
    // Black's, so the losses must not be filed under White.
    const s2 = R.summarize([0, -400, -400], ["Qh4", "Nf3"], "b");
    assert(s2.counts.b.blunder === 0 && s2.counts.w.blunder === 0,
      "a swing in Black's favour is nobody's blunder");
    const s3 = R.summarize([0, 400, 400], ["Qh4", "Nf3"], "b");
    assert(s3.counts.b.blunder === 1 && s3.counts.w.blunder === 0,
      "with Black moving first, Black's blunder is filed under Black");

    // unmeasured plies (an aborted analysis) are skipped, never scored as perfect
    assert(R.summarize([0, null, -400], ["e4", "Qh5"], "w") === null,
      "an analysis with nothing measurable yields no report");

    // --- one accuracy formula, and the two side rules agree on it -------------
    // The clamp, the mean and the exponential existed twice until 1.25 — here
    // and as app.js accuracyFrom() — differing only in how each worked out whose
    // move a ply was. review.js owns the arithmetic now, but the two side rules
    // are still two: this one counts parity from the first mover, the app reads
    // the side to move off the FEN it already has. Nothing forced them to agree,
    // and nothing ever checked. 缺陷 6.
    {
      const g = new Chess();
      const line = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5"];
      const fens = [g.fen()];
      for (const m of line) { g.move(m); fens.push(g.fen()); }
      // a track with real, uneven losses on both sides
      const scalars = [20, 10, 35, 30, 60, 55, 300, 40, 55, -120, 25];

      const viaFen = R.lossesBySide(scalars, (i) => (fens[i].split(" ")[1] === "w" ? "w" : "b"));
      const viaParity = R.lossesBySide(scalars, (i) => (i % 2 === 0 ? "w" : "b"));
      assert(JSON.stringify(viaFen) === JSON.stringify(viaParity),
        "the FEN side rule and the parity side rule split the same game the same way");

      const summary = R.summarize(scalars, line, "w");
      const appAcc = { w: R.accuracyOf(viaFen.w), b: R.accuracyOf(viaFen.b) };
      assert(summary.acpl.w === appAcc.w.acpl && summary.acpl.b === appAcc.b.acpl,
        "…and the report and the accuracy line quote the same ACPL (" +
        summary.acpl.w + "/" + appAcc.w.acpl + ", " + summary.acpl.b + "/" + appAcc.b.acpl + ")");
      assert(summary.acc.w === appAcc.w.acc && summary.acc.b === appAcc.b.acc,
        "…and the same accuracy (" + summary.acc.w + "/" + appAcc.w.acc + ")");

      // and app.js does not carry a second copy of the arithmetic any more
      const accFrom = srcOf("accuracyFrom");
      assert(/Review\.lossesBySide/.test(accFrom) && /Review\.accuracyOf/.test(accFrom),
        "app.js gets its accuracy from review.js");
      assert(!/Math\.exp/.test(accFrom) && !/Math\.min\(1000/.test(accFrom),
        "…and holds no clamp or curve of its own");
    }
    const s4 = R.summarize([0, -400, null, -400], ["e4", "Nf3", "Qh5"], "w");
    assert(s4.measured === 1, "only the measurable plies are scored (" + s4.measured + ")");
    assert(s4.counts.w.blunder === 1 && s4.acpl.b === null,
      "a side with no measured move gets no accuracy rather than 100%");

    // thresholds line up with the ?!/?/?? marks in the move list
    const grade = (loss) => R.summarize([0, -loss], ["e4"], "w").counts.w;
    assert(grade(49).inaccuracy === 0, "49cp is not yet an inaccuracy");
    assert(grade(50).inaccuracy === 1, "50cp is an inaccuracy");
    assert(grade(100).mistake === 1, "100cp is a mistake");
    assert(grade(300).blunder === 1, "300cp is a blunder");

    assert(R.verdictKey(s, "w") === "rv.verdict.oneBlunder", "one blunder gets its own verdict");
    // s is a fragment (fewer than MIN_JUDGED own moves): a side that made a
    // blunder is told about the blunder, a side that made none is told the
    // sample is too short — not that it plays excellently (audit F5)
    assert(R.verdictKey(s, "b") === "rv.verdict.tooShort", "a clean fragment is a fragment, not excellence");
    assert(R.verdictKey(null, "w") === null, "no summary yields no verdict");
    {
      // twenty own moves each, all clean: now it is a game and the verdict may speak
      const n = R.MIN_JUDGED * 2 * 2;
      const flat = new Array(n + 1).fill(0);
      const moves = new Array(n).fill("e4");
      const long = R.summarize(flat, moves, "w");
      assert(long.judged.w === R.MIN_JUDGED * 2 && long.judged.b === R.MIN_JUDGED * 2,
        "summarize counts the judged moves per side");
      assert(R.verdictKey(long, "b") === "rv.verdict.excellent", "a clean full game reads as excellent");
      assert(R.longEnough(long) && !R.longEnough(s), "the curve floor is the same sample floor");
      const two = R.summarize([0, 10, 0], ["e4", "e5"], "w");
      assert(R.verdictKey(two, "w") === "rv.verdict.tooShort" && R.verdictKey(two, "b") === "rv.verdict.tooShort",
        "1.e4 e5 earns nobody a level-up");
    }
  }

  // material: who is up, and what each side has taken
  {
    loadModule(ctx, "src/web/js/material.js");
    const M = ctx.ChessMaterial;
    const start = new Chess();
    assert(M.diff(start.board()) === 0, "the start position is level");
    assert(M.summary(start.board(), start.board(), []).w.length === 0, "nothing captured at the start");

    // 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qxa2 — White has taken a pawn, Black a pawn and a pawn
    const g = new Chess();
    for (const san of ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qxa2"]) assert(g.move(san) !== null, "played " + san);
    const s1 = M.summary(new Chess().board(), g.board(), []);
    assert(s1.w.join("") === "p", "White has taken one pawn (" + s1.w.join("") + ")");
    assert(s1.b.join("") === "pp", "Black has taken two pawns (" + s1.b.join("") + ")");
    assert(s1.diff === -1, "Black is a pawn up (diff " + s1.diff + ")");

    // a promotion must not be reported as a captured pawn
    const promo = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
    const before = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1").board();
    promo.move({ from: "a7", to: "a8", promotion: "q" });
    const raw = M.summary(before, promo.board(), []);
    assert(raw.b.join("") === "p", "without the promotion list the pawn looks captured");
    const fixed = M.summary(before, promo.board(), [{ color: "w", promotion: "q" }]);
    assert(fixed.b.length === 0, "…and with it, nothing is reported as captured");
    assert(fixed.diff === 9, "the new queen counts towards the lead (diff " + fixed.diff + ")");

    // the difference is read off the board, so an edited starting position is fine
    const odd = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
    assert(M.diff(odd.board()) === 5, "a lone rook is a five-pawn lead");
    assert(M.summary(odd.board(), odd.board(), []).w.length === 0,
      "a position that started that way reports no captures");

    // the display order is biggest prize first
    const mixed = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
    const many = M.summary(new Chess().board(), mixed.board(), []);
    assert(many.w[0] === "q" && many.w[many.w.length - 1] === "p", "captured pieces list queens first, pawns last");
    assert(many.w.length === 15 && many.b.length === 15, "…and every missing piece is listed");
  }
}
