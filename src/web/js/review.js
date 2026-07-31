/**
 * Post-game review — turns a finished analysis into the handful of numbers
 * worth reading: how accurate each side was, how the mistakes were spread,
 * and which single move cost the most.
 *
 * Pure arithmetic over the analysis arrays, no engine and no DOM, so the
 * thresholds can be read and tested on their own. The app owns rendering.
 * @module review
 */
  /** the same cut-offs the move list annotates with ?! / ? / ?? */
  const INACCURACY = 50, MISTAKE = 100, BLUNDER = 300;

  /**
   * Move number in algebraic notation for ply `i`.
   *
   * A game edited to start with Black to move opens at "1…" — Black's move is
   * still move 1, and White's reply is move 2. Counting pairs from ply 0 would
   * put White's first move in move 1 alongside it.
   * @param {number} i ply index, 0-based
   * @param {"w"|"b"} firstMover side that played ply 0
   */
  function moveNumber(i, firstMover) {
    return firstMover === "b" ? Math.floor((i + 1) / 2) + 1 : Math.floor(i / 2) + 1;
  }

  /**
   * @param {number[]} scalars evaluation after each ply, index 0 = start
   *   (centipawns, positive = good for White; null where unmeasured)
   * @param {string[]} history SAN moves
   * @param {"w"|"b"} firstMover side that played history[0] — not always White,
   *   since a game can start from an edited position
   * @returns {object|null} null when nothing measurable was analysed
   */
  function summarize(scalars, history, firstMover) {
    if (!scalars || scalars.length < 2 || !history || !history.length) return null;
    const side = (i) => ((i % 2 === 0) === (firstMover !== "b") ? "w" : "b");
    const losses = { w: [], b: [] };
    const counts = { w: { inaccuracy: 0, mistake: 0, blunder: 0 }, b: { inaccuracy: 0, mistake: 0, blunder: 0 } };
    let worst = null;

    for (let i = 0; i < history.length; i++) {
      const before = scalars[i], after = scalars[i + 1];
      if (before == null || after == null) continue;
      const s = side(i);
      // loss is always measured from the mover's point of view
      const raw = s === "w" ? before - after : after - before;
      const loss = Math.max(0, Math.min(1000, raw));
      losses[s].push(loss);
      if (loss >= BLUNDER) counts[s].blunder++;
      else if (loss >= MISTAKE) counts[s].mistake++;
      else if (loss >= INACCURACY) counts[s].inaccuracy++;
      // the turning point is the single costliest move of the game, either side
      if (loss >= MISTAKE && (!worst || loss > worst.loss)) {
        worst = { ply: i, san: history[i], loss, side: s, moveNo: moveNumber(i, firstMover) };
      }
    }

    const acpl = {}, acc = {};
    for (const s of ["w", "b"]) {
      if (!losses[s].length) { acpl[s] = null; acc[s] = null; continue; }
      const mean = losses[s].reduce((a, b) => a + b, 0) / losses[s].length;
      acpl[s] = Math.round(mean);
      // same readable exponential the accuracy line uses — not an official rating
      acc[s] = Math.round(100 * Math.exp(-mean / 120));
    }
    const measured = losses.w.length + losses.b.length;
    if (!measured) return null;
    return { acpl, acc, counts, worst, measured, plies: history.length };
  }

  /**
   * A one-line verdict key for the human side, chosen from its blunder count
   * and accuracy. Returns an i18n key so this module stays language-free.
   */
  function verdictKey(summary, side) {
    if (!summary || !summary.acc || summary.acc[side] == null) return null;
    const c = summary.counts[side];
    if (c.blunder >= 3) return "rv.verdict.blunders";
    if (c.blunder >= 1) return "rv.verdict.oneBlunder";
    if (c.mistake >= 3) return "rv.verdict.mistakes";
    if (summary.acc[side] >= 90) return "rv.verdict.excellent";
    if (summary.acc[side] >= 75) return "rv.verdict.solid";
    return "rv.verdict.roomToGrow";
  }

  /**
   * Where an evaluation sits on a 0..1 bar, 0 = Black winning, 1 = White.
   *
   * Deliberately returns null rather than 0.5 for an unmeasured position. The
   * two mean opposite things — "the engine says this is level" and "nobody
   * asked the engine" — and a bar that renders them identically is the most
   * confident kind of lie a review can tell. The caller has to show the
   * difference; making it impossible to forget is why this is not 0.5.
   *
   * @param {number|null} cp centipawns, positive = good for White
   * @returns {number|null} 0..1, or null when there is nothing to show
   */
  function evalBar(cp) {
    if (cp == null || !Number.isFinite(cp)) return null;
    // ±6 pawns is already decisive; past that the bar has nothing left to say
    // and only the mate score itself is interesting.
    const CAP = 600;
    return 0.5 + (Math.max(-CAP, Math.min(CAP, cp)) / CAP) * 0.5;
  }

  /**
   * The tag a move earns for giving up `loss` centipawns, or null for a move
   * that costs little enough to leave unremarked.
   *
   * Shared so the move list, the curve markers and the "you should have
   * played" arrow can never disagree about what counts as a mistake — three
   * copies of one threshold is how they start drifting.
   * @returns {"?!"|"?"|"??"|null}
   */
  function markFor(loss) {
    if (!Number.isFinite(loss)) return null;
    if (loss >= BLUNDER) return "??";
    if (loss >= MISTAKE) return "?";
    if (loss >= INACCURACY) return "?!";
    return null;
  }

  /** Is this a tag the player is meant to learn something from? */
  function isMistake(tag) {
    return tag === "?!" || tag === "?" || tag === "??";
  }

  export const ChessReview = {
    summarize, verdictKey, moveNumber, evalBar, markFor, isMistake,
    INACCURACY, MISTAKE, BLUNDER,
  };
