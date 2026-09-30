/**
 * 杀棋题的搜索：一步杀、强制杀、反驳与最顽强的防守。
 *
 * The exhaustive searches the mate categories are graded with (any move that
 * still forces mate is right, and the reply is the toughest defence), moved
 * out of trainer/puzzles.js in v8-2-plan F1 as they were. Pure chess.js: they
 * read and restore the game they are handed and touch nothing else.
 * @module trainer/puzzle-mate
 */

/** A mate in one for whoever is to move in `g`, or null. */
export function mateInOne(g) {
  for (const m of g.moves()) {
    g.move(m);
    const done = g.in_checkmate();
    g.undo();
    if (done) return m;
  }
  return null;
}

export function matingMovesOf(g) {
  return g.moves({ verbose: true }).filter((m) => {
    g.move(m); const mate = g.in_checkmate(); g.undo(); return mate;
  });
}

/** White to move: some move forces mate within n white moves. */
export function whiteHasForcedMate(g, n) {
  for (const m of g.moves()) {
    g.move(m);
    const mate = g.in_checkmate();
    const deeper = !mate && n > 1 && !g.game_over() && blackForcedLost(g, n - 1);
    g.undo();
    if (mate || deeper) return true;
  }
  return false;
}

/** Black to move: EVERY reply loses to a forced mate within n white moves. */
export function blackForcedLost(g, n) {
  const replies = g.moves();
  if (!replies.length) return false; // stalemate/over — black escaped
  for (const r of replies) {
    g.move(r);
    const lost = whiteHasForcedMate(g, n);
    g.undo();
    if (!lost) return false;
  }
  return true;
}

/** A black reply that refutes the mate threat within n, or null if none. */
export function findRefutation(g, n) {
  for (const r of g.moves()) {
    g.move(r);
    const lost = whiteHasForcedMate(g, n);
    g.undo();
    if (!lost) return r;
  }
  return null;
}

/** Black's toughest defense: needs the deepest mate (ties: fewest maters). */
export function bestDefense(g, n) {
  let best = null, bestDepth = -1, bestMaters = Infinity;
  for (const r of g.moves()) {
    g.move(r);
    let d = 1;
    while (d < n && !whiteHasForcedMate(g, d)) d++;
    const maters = matingMovesOf(g).length;
    g.undo();
    if (d > bestDepth || (d === bestDepth && maters < bestMaters)) {
      bestDepth = d; bestMaters = maters; best = r;
    }
  }
  return best;
}
