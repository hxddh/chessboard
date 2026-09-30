/**
 * When an endgame of the training camp is over, and who got what they
 * wanted (v8-1-plan T2).
 *
 * The camp plays every position against the engine at full strength until
 * there is a result, so "the result" has to be something chess.js can see
 * without a tablebase (none ships: 3–5 pieces is ~1 GB). The student is
 * always White — the camp authors every position from the student's chair,
 * colours swapped where the textbook diagram has Black defending.
 *
 * - **win**: checkmate. Or the engine is down to a bare king while the
 *   student keeps a queen or rook it cannot take next move — K+Q and K+R
 *   against a lone king are the course's first drills, and playing them out
 *   again after every pawn ending would teach nothing but patience.
 *   Failures: stalemate or any draw by the rules, being mated, and material
 *   that can no longer mate (no queen, rook or pawn, and fewer than two
 *   minor pieces).
 * - **draw**: any draw by the rules — stalemate, insufficient material,
 *   threefold repetition, the fifty-move rule — or the engine left with a
 *   bare king. Failures: being mated, and the engine making a new queen: a
 *   promotion the defence existed to stop.
 *
 * Pure: scripts/test-endgames.mjs plays every position to its goal through
 * this same function, so the app and the test cannot disagree about what
 * "done" means.
 * @module endgame-rules
 */

  /** the pieces of `color` other than the king, as a count by type */
  function material(g, color) {
    const m = { p: 0, n: 0, b: 0, r: 0, q: 0 };
    for (const row of g.board()) for (const p of row) if (p && p.color === color && p.type !== "k") m[p.type]++;
    return m;
  }
  const bare = (m) => !(m.p || m.n || m.b || m.r || m.q);

  /** can this material still mate, given time? (a lone minor cannot) */
  function canMate(m) {
    return !!(m.q || m.r || m.p || m.n + m.b >= 2);
  }

  /**
   * After Black is bare, does White keep a queen or rook through Black's
   * next move? A lone king can only take something adjacent and unguarded.
   */
  function keepsHeavy(g) {
    const heavy = material(g, "w");
    const n = heavy.q + heavy.r;
    if (!n) return false;
    if (g.turn() !== "b") return true;
    for (const mv of g.moves({ verbose: true })) {
      if (mv.captured === "q" || mv.captured === "r") { if (n <= 1) return false; }
    }
    return true;
  }

  /**
   * @param {object} g chess.js game, after either side's move
   * @param {"win"|"draw"} goal
   * @param {{bq:number}} start the engine's queens in the starting position
   * @returns {null|{ok:true, how:string}|{ok:false, how:string}}
   *   null while play goes on; `how` names what happened, for the words
   */
  function outcome(g, goal, start) {
    const mated = g.in_checkmate();
    if (goal === "draw") {
      if (mated) return g.turn() === "w" ? { ok: false, how: "mated" } : { ok: true, how: "mate" };
      if (g.game_over()) return { ok: true, how: drawHow(g) };
      const bm = material(g, "b");
      if (bare(bm)) return { ok: true, how: "bare" };
      if (bm.q > ((start && start.bq) || 0)) return { ok: false, how: "queened" };
      return null;
    }
    if (mated) return g.turn() === "b" ? { ok: true, how: "mate" } : { ok: false, how: "mated" };
    if (g.game_over()) return { ok: false, how: g.in_stalemate() ? "stalemate" : "draw" };
    if (!canMate(material(g, "w"))) return { ok: false, how: "material" };
    if (bare(material(g, "b")) && keepsHeavy(g)) return { ok: true, how: "bare" };
    return null;
  }

  /** which draw it was, for the words */
  function drawHow(g) {
    if (g.in_stalemate()) return "stalemate";
    if (g.insufficient_material()) return "insufficient";
    if (g.in_threefold_repetition()) return "repetition";
    return "fifty";
  }

  /** the engine's queens at the start, for the "new queen" failure */
  function startOf(g) {
    return { bq: material(g, "b").q };
  }

  export const ChessEndgameRules = { outcome, startOf, material, canMate };
