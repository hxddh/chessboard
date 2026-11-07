/**
 * Who is up material, and which pieces each side has taken.
 *
 * Lesson 9 teaches that a knight is worth three pawns and that you should not
 * trade a rook for a bishop — and then, up to 1.8, nothing anywhere in the app
 * ever told you the running total. In a real game "am I up or down?" is the
 * most frequently consulted fact on the screen, and a beginner is exactly the
 * player who cannot hold it in their head.
 *
 * Two numbers, computed differently on purpose:
 *
 * - The **difference** comes from the pieces actually on the board right now.
 *   That stays correct through promotions and through games started from an
 *   edited position, because it never assumes what the board began with.
 * - The **captured list** compares the current board against the starting one.
 *   That comparison alone would report a promoted pawn as "captured", so the
 *   promotions played so far are folded into the expected counts first.
 * @module material
 */
  /** classical piece values, in pawns; the king is not counted */
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  /** display order: biggest prize first */
  const ORDER = ["q", "r", "b", "n", "p"];

  /** @param {Array} board chess.js board(): 8 rows of {type,color} or null */
  function count(board) {
    const out = { w: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0, k: 0 } };
    for (const row of board || []) {
      for (const sq of row || []) {
        if (sq && out[sq.color] && out[sq.color][sq.type] != null) out[sq.color][sq.type]++;
      }
    }
    return out;
  }

  /** White's material minus Black's, in pawns (positive = White is ahead) */
  function diff(board) {
    const c = count(board);
    let n = 0;
    for (const t of ORDER) n += VALUE[t] * (c.w[t] - c.b[t]);
    return n;
  }

  /**
   * @param {Array} start board() of the position the game started from
   * @param {Array} now board() of the position being shown
   * @param {Array<{color: string, promotion: string}>} promos promotions played so far
   * @returns {{w: string[], b: string[], diff: number}} `w` is what White has
   * taken (black pieces), each type repeated once per piece, biggest first.
   */
  function summary(start, now, promos) {
    const was = count(start);
    const has = count(now);
    for (const m of promos || []) {
      const side = was[m && m.color];
      if (!side || !m.promotion || side[m.promotion] == null) continue;
      // a promoted pawn is not a captured pawn: it left the pawn count on
      // purpose, and arrived in the promoted piece's count
      side.p--;
      side[m.promotion]++;
    }
    const taken = (victim) => {
      const list = [];
      for (const t of ORDER) {
        const gone = Math.max(0, was[victim][t] - has[victim][t]);
        for (let i = 0; i < gone; i++) list.push(t);
      }
      return list;
    };
    return { w: taken("b"), b: taken("w"), diff: diff(now) };
  }

  export const ChessMaterial = { VALUE, ORDER, count, diff, summary };
