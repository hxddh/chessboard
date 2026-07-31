/**
 * FIDE draw arithmetic — pure functions over a position/history, no app state.
 *
 * chess.js ends the game at threefold repetition and at the 50-move mark, but
 * under FIDE those are *claimable* draws (arts. 9.2/9.3); only fivefold and 75
 * moves end it automatically (art. 9.6). Article 6.9 also decides flag falls by
 * whether a mate is possible *at all*, not by a simple piece count. Both live
 * here so the rules can be read and tested apart from the UI.
 * @module fide
 */
  /** halfmove clock of a FEN (plies since the last capture or pawn move) */
  function halfmoveClock(fen) {
    return Number(String(fen).split(" ")[4]) || 0;
  }

  /**
   * Repetition key: FIDE compares placement, side to move and *the moves
   * actually available* — not the raw FEN.
   *
   * The difference is the en-passant field. chess.js (like the FEN standard)
   * records a target square after every double pawn push, even when no enemy
   * pawn can take there; FIDE only counts the ep right if the capture is
   * genuinely playable. Without this normalisation the key after 1.e4 differs
   * from the identical position reached any other way, and ordinary repetition
   * lines — e.g. 1.e4 e5 2.Nf3 Nf6 3.Ng1 Ng8 4.Nf3 Nf6 5.Ng1 Ng8 — never reach
   * threefold.
   *
   * @param {string} fen
   * @param {Function} [game] live chess.js position for this FEN, when the
   * caller already has one; otherwise pass ChessCtor as `ChessCtor` to let the
   * key build its own. With neither, a present ep square is kept as-is.
   */
  function positionKey(fen, game, ChessCtor) {
    const parts = String(fen).split(" ");
    const head = parts.slice(0, 4);
    if (head[3] && head[3] !== "-") {
      const g = game || (ChessCtor ? new ChessCtor(fen) : null);
      // pin-aware by construction: an ep capture that would expose the king is
      // not in moves(), so the right does not exist under FIDE either
      if (g && !g.moves({ verbose: true }).some((m) => m.flags.includes("e"))) head[3] = "-";
    }
    return head.join(" ");
  }

  /**
   * How many times the position after `history` has occurred in the game.
   * @param {string|null} startFen null = standard start
   * @param {string[]} history SAN moves
   * @param {Function} ChessCtor chess.js constructor
   */
  function repetitionCount(startFen, history, ChessCtor) {
    const g = startFen ? new ChessCtor(startFen) : new ChessCtor();
    const key = () => positionKey(g.fen(), g);
    const counts = new Map([[key(), 1]]);
    for (const san of history) {
      if (!g.move(san)) break;
      const k = key();
      counts.set(k, (counts.get(k) || 0) + 1);
    }
    return counts.get(key()) || 1;
  }

  /**
   * FIDE 6.9: could `color` still deliver mate by *any* legal sequence, even
   * with the opponent helping? Decided from material, with bishop colours:
   *  - any pawn / rook / queen → yes
   *  - ≥2 knights → yes (a helpmate exists)
   *  - 1 knight → only if the flagged side still has a piece to be smothered by
   *  - bishops on both square colours → yes
   *  - same-coloured bishops only → only if the opponent has a piece that can
   *    ever occupy the other colour
   * @param {Array} board chess.js .board() — [8][8], row 0 = rank 8
   */
  function hasMatingMaterial(board, color) {
    const mine = [], theirs = [];
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = board[r][c];
      if (!p || p.type === "k") continue;
      (p.color === color ? mine : theirs).push({ type: p.type, dark: (r + c) % 2 === 1 });
    }
    if (mine.some((p) => p.type === "p" || p.type === "r" || p.type === "q")) return true;
    const knights = mine.filter((p) => p.type === "n").length;
    const bishops = mine.filter((p) => p.type === "b");
    if (knights >= 2) return true;
    if (knights === 1) return bishops.length > 0 || theirs.length > 0;
    if (!bishops.length) return false;
    if (bishops.some((b) => b.dark) && bishops.some((b) => !b.dark)) return true;
    const myColor = bishops[0].dark;
    return theirs.some((p) => p.type !== "b" || p.dark !== myColor);
  }

  /**
   * Is this position finished by the laws of chess alone?
   *
   * The counterpart to the app's live `naturalGameOver()`, for positions the
   * app is not standing on — replaying an analysis, say. It exists because the
   * obvious call, chess.js's `game_over()`, answers a different question: it
   * ends the game at threefold and at the 50-move mark, which arts. 9.2/9.3
   * make *claimable*, not terminal. A game legally continues through both, so
   * treating them as finished scores live positions as dead draws.
   *
   * @param {object} g chess.js instance standing on the position
   * @param {number} [reps] how many times the position has occurred in the
   *   game so far, including this one (see repetitionCount); 1 when unknown
   */
  function positionFinished(g, reps) {
    if (g.in_checkmate()) return true; // a mating move trumps the 75-move rule
    if (g.in_stalemate() || g.insufficient_material()) return true;
    return (reps || 1) >= 5 || halfmoveClock(g.fen()) >= 150;
  }

  export const ChessFide = { halfmoveClock, positionKey, repetitionCount, hasMatingMaterial, positionFinished };
