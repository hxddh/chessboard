/**
 * Every FEN this app ships can exist; an impossible [FEN] is refused and a
 * terminal one is a normal file.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import vm from "vm";
import { assert, ctx, Chess, loadModule } from "./harness.mjs";

export async function run() {
  // --- 7.0: every FEN this app ships must be a position that can exist ---------
  //
  // `ChessEditor.validate` has known since 6.0 that a pawn cannot stand on its
  // own back rank — and nothing had ever run the app's OWN content through it.
  // One knight lesson drew the "surrounded by your own pawns" box from c1 to e3,
  // which puts three white pawns on the first rank. chess.js accepts it and
  // Stockfish 18 evaluated it, so it shipped and was played for eleven versions.
  //
  // Stockfish 19 does not: `position fen` on that square set aborts the whole
  // wasm module with `RuntimeError: unreachable`. An aborted module is not a
  // crashed search — every later ccall hits the same trap, so 6.1's engine
  // self-healing cannot get back from it either. The engine upgrade turned a
  // cosmetic illegality into a dead engine on a beginner lesson.
  //
  // So: run the content through the guard that already existed.
  {
    const Ed = ctx.ChessEditor;
    const seen = new Set();
    let bad = 0, checked = 0;
    const vet = (fen, where) => {
      if (!fen || seen.has(fen)) return;
      seen.add(fen);
      checked++;
      // allowTerminal: a puzzle may start from a position with no legal move
      // (a mate to recognise); that is content, not corruption. Everything
      // structural — piece counts, kings, pawns on a back rank, an impossible
      // en-passant square — is what this is here for.
      let why = null;
      try { why = Ed.validate(Ed.fromFen(fen, ctx.Chess), ctx.Chess, { allowTerminal: true }); }
      catch (err) { why = "threw: " + err.message; }
      if (why) { bad++; console.error("FAIL: " + where + " 的局面不合法 (" + why + "): " + fen); }
    };
    for (const L of (ctx.CHESS_LESSONS || []).concat(ctx.CHESS_LESSONS_ADV_ZH || [])) {
      for (const t of L.tasks || []) vet(t.fen, "课程 " + L.id);
    }
    for (const p of ctx.CHESS_PUZZLES || []) vet(p.fen, "题目 " + p.id);
    // the mined set too — it is generated, which is exactly the reason a bad
    // position could arrive in bulk without anyone typing it
    {
      const mctx = { console, Date, performance };
      mctx.globalThis = mctx; mctx.window = mctx;
      vm.createContext(mctx);
      loadModule(mctx, "src/web/js/puzzles-mined.js");
      for (const p of mctx.MINED_PUZZLES || []) vet(p.fen, "挖掘题 " + p.id);
    }
    assert(checked > 1000, "课程、题目与挖掘题的局面都取到了 (" + checked + ")");
    assert(bad === 0, "每一个随应用发布的局面都是真能出现的局面 —— " +
      "兵不在底线、王各一个、吃过路兵格站得住 (" + checked + " 个)");
  }

  // --- 6.1: an impossible [FEN] must not be quietly repaired -------------------
  //
  // ChessEditor exists to reject positions chess.js accepts. fromFen() used to
  // build its board with `new Chess(fen).board()`, and chess.js tracks one king
  // square per colour, so a FEN with two white kings arrived at validate() with
  // one already dropped: the guard said yes and the app loaded a position that
  // was not the one in the file. The no-king half worked, which is why it went
  // unseen.
  {
    loadModule(ctx, "src/web/js/editor.js");
    const E6 = ctx.ChessEditor;
    const two = "4k3/8/8/8/8/8/8/K3K3 w - - 0 1";
    assert(new Chess().validate_fen(two).valid, "chess.js itself accepts two white kings");
    const st = E6.fromFen(two, Chess);
    const kings = st.board.flat().filter((p) => p && p.type === "k" && p.color === "w").length;
    assert(kings === 2, "fromFen() reads the board field as written (" + kings + " white kings)");
    assert(E6.validate(st, Chess) === "edErr.manyWhiteKings", "…so validate() can reject it");
    const one = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
    assert(E6.validate(E6.fromFen(one, Chess), Chess) === null, "…and an ordinary position still passes");
    assert(E6.boardFromFenField("8/8/8/8/8/8/8") === null, "a board field with seven ranks is not a board");
    assert(E6.boardFromFenField("9/8/8/8/8/8/8/8") === null, "…nor is one with nine empty squares in a rank");
  }

  // --- 6.1 (review): a terminal [FEN] is a normal file, not an invalid one -----
  //
  // The import path reuses ChessEditor.validate for the structural and
  // reachability checks. validate() also refuses a position with no legal move,
  // which is right for the editor (there would be nothing to play) and wrong
  // here: a game that starts from a checkmate or a stalemate is an ordinary
  // study or a finished game, and those files were importable before 6.1 wired
  // the validator in. opts.allowTerminal separates the two policies.
  {
    const E7 = ctx.ChessEditor;
    const mate = "7k/5KQ1/8/8/8/8/8/8 b - - 0 1";
    const stale = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
    const mp = new Chess(mate), sp = new Chess(stale);
    assert(mp.in_checkmate(), "the mate fixture really is a checkmate");
    assert(sp.in_stalemate(), "the stalemate fixture really is a stalemate");
    assert(E7.validate(E7.fromFen(mate, Chess), Chess) === "edErr.alreadyMate",
      "the editor still refuses to set up a finished position");
    assert(E7.validate(E7.fromFen(stale, Chess), Chess) === "edErr.alreadyStalemate", "…stalemate too");
    assert(E7.validate(E7.fromFen(mate, Chess), Chess, { allowTerminal: true }) === null,
      "…and the import path takes a checkmate [FEN]");
    assert(E7.validate(E7.fromFen(stale, Chess), Chess, { allowTerminal: true }) === null,
      "…and a stalemate [FEN]");
    // allowTerminal relaxes only that one rule — everything above it still bites
    assert(E7.validate(E7.fromFen("4k3/8/8/8/8/8/8/K3K3 w - - 0 1", Chess), Chess, { allowTerminal: true })
      === "edErr.manyWhiteKings", "…while two white kings are still rejected");
    // app.js's own wiring is checked where it can be checked behaviourally —
    // scripts/test-content-e2e.mjs imports a PGN whose [FEN] is a checkmate and
    // asserts the board loads it. A source-text assertion here would be a fifth
    // entry in a register that only ever shrinks.
  }
}
