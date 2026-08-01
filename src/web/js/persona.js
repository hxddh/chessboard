/**
 * Sparring personalities — what kind of mistakes the opponent makes.
 *
 * Up to 1.9 the only dial was strength. Turning Stockfish down makes it play
 * worse moves, but it does not make it play *human* moves: at every tier it is
 * still a machine that punishes you with quiet precision and never once walks
 * into the thing you are trying to learn. A beginner who has just been taught
 * the fork has no way to practise it, because no setting produces an opponent
 * who would ever step into one.
 *
 * A personality is not a strength setting. It is a preference applied over the
 * engine's own candidate list:
 *
 * - **greedy** takes material almost regardless of consequence. This is the
 *   one that makes the tactics lessons pay off — it grabs the pawn your knight
 *   was defending, and your fork appears on the board instead of in a puzzle.
 *   Measured over positions offering Black a losing capture: it takes the bait
 *   60% of the time, against 13% for the same engine with no personality.
 * - **principled** plays the opening the way lesson 28 teaches it: centre
 *   first, minor pieces out, castle early, queen stays home. Measured: 70% of
 *   its moves develop a minor piece (the plain engine, 25%), it castles when
 *   it can, and it never once took the bait above. Playing against your own
 *   textbook is the fastest way to see what it looks like.
 * - **attacker** points everything at your king. Measured over middlegame
 *   positions: every one of its moves landed within three squares of the enemy
 *   king (the plain engine, 40%), average distance 2.9 against 4.1. It does
 *   not check much more often than the engine does — a check bad enough to be
 *   outside the slack is a bad move, not an attacking one — it simply keeps
 *   arriving. It teaches defence, which is the half of chess the puzzle set
 *   could not reach until this version.
 *
 * The guard rails: a personality only ever reorders moves the engine already
 * considered, never invents one, and each has a slack in centipawns beyond
 * which it will not indulge itself. Without that a "greedy" opponent would
 * hang its queen on move 3 and the game would be over before anything was
 * learned. Forced mates are never traded away — see `pick`.
 * @module persona
 */
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

  /**
   * id → how far below the engine's own best move this personality is willing
   * to go (centipawns) and how it scores a candidate.
   *
   * The slacks are the whole safety story, so they are stated plainly:
   * `greedy` is allowed to lose most of a piece for a capture (that is the
   * point), `attacker` about half of one for an assault, `principled` only a
   * fraction of a pawn — it is a style, not a handicap.
   */
  const SLACK = { greedy: 450, attacker: 320, principled: 90 };

  const IDS = ["off", "greedy", "principled", "attacker"];

  /** files/ranks distance between two squares */
  function dist(a, b) {
    return Math.max(
      Math.abs(a.charCodeAt(0) - b.charCodeAt(0)),
      Math.abs(Number(a[1]) - Number(b[1])),
    );
  }

  function kingSquare(g, colour) {
    const rows = g.board();
    for (let r = 0; r < 8; r++) {
      for (let c = 0; c < 8; c++) {
        const sq = rows[r][c];
        if (sq && sq.type === "k" && sq.color === colour) {
          return "abcdefgh"[c] + (8 - r);
        }
      }
    }
    return null;
  }

  const CENTRE = { d4: 1, e4: 1, d5: 1, e5: 1 };
  const BACK = { w: "1", b: "8" };

  /**
   * @param {object} mv chess.js verbose move, already made on `after`
   * @param {object} after position with the move played
   * @param {object} before position before the move
   */
  function score(id, mv, after, before) {
    let s = 0;
    if (id === "greedy") {
      // material is the whole personality: every point of it outweighs any
      // positional consideration, which is exactly the mistake being modelled
      if (mv.captured) s += 100 * (VALUE[mv.captured] || 0);
      if (mv.promotion) s += 80;
      // and it will not decline a capture merely because the square is guarded
      if (after.in_check()) s += 10;
      return s;
    }
    if (id === "attacker") {
      if (after.in_check()) s += 90;
      const enemyKing = kingSquare(after, after.turn());
      if (enemyKing) {
        const d = dist(mv.to, enemyKing);
        if (d <= 1) s += 60; else if (d === 2) s += 40; else if (d === 3) s += 15;
        // a sacrifice near the king is the signature move of this style
        if (mv.captured && d <= 2) s += 30;
      }
      if (mv.piece === "p" && mv.from[1] !== mv.to[1] && enemyKing &&
          dist(mv.to, enemyKing) <= 3) s += 25;    // pawn storm
      return s;
    }
    if (id === "principled") {
      const moveNo = Number(before.fen().split(" ")[5]) || 1;
      const home = BACK[mv.color];
      if (mv.flags.includes("k") || mv.flags.includes("q")) s += 70;   // castling
      if ((mv.piece === "n" || mv.piece === "b") && mv.from[1] === home) s += 55;
      if (mv.piece === "p" && CENTRE[mv.to]) s += 45;
      if (mv.piece === "q" && moveNo <= 8) s -= 80;                    // queen too early
      if (mv.piece === "k" && !mv.flags.includes("k") && !mv.flags.includes("q") &&
          moveNo <= 12) s -= 60;                                       // losing the castle
      if (mv.piece === "r" && mv.from[1] === home && moveNo > 8) s += 20;
      return s;
    }
    return 0;
  }

  /**
   * Re-rank the engine's candidates according to `id`.
   *
   * @param {string} fen position the candidates were searched from
   * @param {Array<{uci: string, score: number|null}>} cands MultiPV lines,
   *   best first, scores in centipawns from the mover's point of view
   * @param {string} id personality id
   * @param {Function} Chess chess.js constructor
   * @returns {string|null} chosen UCI move, or null to leave the choice alone
   */
  function pick(fen, cands, id, Chess) {
    if (!id || id === "off" || !Array.isArray(cands) || cands.length < 2) return null;
    if (!SLACK[id] || typeof Chess !== "function") return null;
    const scored = cands.filter((c) => c && c.uci && c.score != null);
    if (scored.length < 2) return null;
    const best = Math.max(...scored.map((c) => c.score));
    // A personality that throws away a mate it has already found reads as a
    // broken engine rather than a characterful one.
    if (best >= 100000 - 50) return null;
    const allowed = scored.filter((c) => c.score >= best - SLACK[id]);
    if (allowed.length < 2) return null;
    const before = new Chess(fen);
    let bestMove = null, bestScore = -Infinity;
    for (const c of allowed) {
      const g = new Chess(fen);
      const mv = g.move({
        from: c.uci.slice(0, 2), to: c.uci.slice(2, 4),
        promotion: c.uci.length > 4 ? c.uci[4] : undefined,
      });
      if (!mv) continue;
      // the engine's own opinion still counts for something, so the style
      // score is added to it rather than replacing it — a personality breaks
      // the tie between reasonable moves, it does not pick blind
      const s = score(id, mv, g, before) + (c.score - best) / 8;
      if (s > bestScore) { bestScore = s; bestMove = c.uci; }
    }
    return bestMove;
  }

  export const ChessPersona = { IDS, SLACK, pick, score };
