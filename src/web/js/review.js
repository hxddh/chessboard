/**
 * Post-game review — turns a finished analysis into the handful of numbers
 * worth reading: how accurate each side was, how the mistakes were spread,
 * and which single move cost the most.
 *
 * Pure arithmetic over the analysis arrays, no engine and no DOM, so the
 * thresholds can be read and tested on their own. The app owns rendering.
 * @module review
 */
  /**
   * The same cut-offs the move list annotates with ?! / ? / ??.
   *
   * **Measured, and deliberately not moved.** 缺陷 23 was right that 50cp is
   * the same size as the quick scan's own noise: scanning four decided games
   * twice at 120ms/position (168 plies), the evaluation of the *same* position
   * moves by a median 10cp between runs, 34cp at the ninth percentile — and a
   * move's loss is a difference of two of those. The consequence is measured
   * too: of every ply either run called `?!`, both runs called it 39% of the
   * time. `?` reaches 58% and `??` 86%.
   *
   * The defect proposed scaling the thresholds with movetime. Refuted — at
   * 400ms the jitter is the same order (median 6cp, p90 20) and `?!` still
   * only reaches 53%, so there is no movetime-dependent noise floor to track.
   * Raising the `?!` cut is refuted too: swept over the recorded tracks at
   * 40/50/60/70/80/90cp, agreement wanders (50/39/31/22/29/33) with no trend,
   * because a hard cut on a noisy quantity always has about half its members
   * sitting on the edge, wherever the edge is put.
   *
   * So the numbers stay, and what changed is that they are now known rather
   * than assumed: docs/measured.json `scanNoise`, written by
   * scripts/test-analysis.mjs --record, and scripts/test-chess.mjs fails if
   * these three constants stop matching what that run was taken against.
   * `?!` is already kept off the evaluation curve's mistake dots (app.js) —
   * which turns out to have been the right instinct.
   */
  const INACCURACY = 50, MISTAKE = 100, BLUNDER = 300;

  /**
   * How much a move cost the side that played it, in centipawns.
   *
   * Always measured from the mover's point of view, and clamped: an eval track
   * runs to ±mate scores, and one lost queen and one lost game should not be
   * ten thousand times apart in an average.
   *
   * @param {number} before evaluation before the move (+ = good for White)
   * @param {number} after  evaluation after it
   * @param {"w"|"b"} side  who played it
   */
  function lossOf(before, after, side) {
    return Math.max(0, Math.min(1000, side === "w" ? before - after : after - before));
  }

  /**
   * Average loss and the accuracy score derived from it, for one side.
   *
   * The curve is the usual exponential decay — 100% at zero loss, ~60% around
   * 60cp average. It is a readable summary, not an official rating, and the UI
   * labels it as such (see also 缺陷 22: online sites compute an
   * identically-named number from win probability and get 60–75% where this
   * gets 37%).
   *
   * This is the *only* copy. It used to exist twice — here and as
   * app.js accuracyFrom() — with the same clamp, the same mean and the same
   * exponential, differing only in how each decided whose move a ply was. This
   * module's own header already said three copies are how they begin to
   * drift; two was not better. 缺陷 6.
   *
   * @param {number[]} losses centipawn losses for one side
   * @returns {{acpl: number|null, acc: number|null}}
   */
  function accuracyOf(losses) {
    if (!losses || !losses.length) return { acpl: null, acc: null };
    const mean = losses.reduce((a, b) => a + b, 0) / losses.length;
    return { acpl: Math.round(mean), acc: Math.round(100 * Math.exp(-mean / 120)) };
  }

  /**
   * Split an eval track into each side's losses.
   *
   * `sideAt` is the caller's, because the two callers genuinely know it two
   * different ways: the review derives it from the first mover and the parity
   * of the ply, the app reads it off the FEN it already has in hand. Those must
   * agree, and scripts/test-chess.mjs checks that they do on a real game —
   * which is the part that was never checked while the arithmetic was doubled.
   *
   * @param {Array<number|null>} scalars evaluation after each ply, [0] = start
   * @param {(i: number) => "w"|"b"} sideAt who played ply `i`
   */
  function lossesBySide(scalars, sideAt) {
    const out = { w: [], b: [] };
    for (let i = 0; i + 1 < scalars.length; i++) {
      const before = scalars[i], after = scalars[i + 1];
      if (before == null || after == null) continue;
      const s = sideAt(i);
      out[s].push(lossOf(before, after, s));
    }
    return out;
  }

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
      const loss = lossOf(before, after, s);
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
      const a = accuracyOf(losses[s]);
      acpl[s] = a.acpl;
      acc[s] = a.acc;
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
    lossOf, accuracyOf, lossesBySide,
    INACCURACY, MISTAKE, BLUNDER,
  };
