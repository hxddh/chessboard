/**
 * 错题自炼 — your own blunders, turned into drills.
 *
 * Every version through 2.6 handed the player a better *canned* book: more
 * lessons, more puzzles, more lines, a smarter reading order. The one content
 * source no canned book can have is the games this player actually lost, and
 * the review pass already computes everything a drill needs — the position
 * (FEN), what was played, what the engine would have played, and how much the
 * difference cost. Until now that judgement was displayed once and thrown
 * away: "move 23 ?? lost 4.1" scrolled past, and the same mistake was free to
 * happen again next game. This module closes the loop: a `??` by the player
 * becomes a puzzle in their own book, riding the same rails (solved/missed,
 * SRS review, 为你出一题) as every canned puzzle.
 *
 * Pure on purpose: analysis arrays in, drill objects out. No engine call —
 * the analysis pass already paid for the search — no DOM, no store, no i18n.
 * The caller owns persistence and timestamps.
 * @module mistakes
 */

/**
 * The personal book is a working set, not an archive. Fifty is roughly a
 * month of daily play at a handful of blunders a game — enough that a real
 * pattern (the same square, the same motif) will be represented, small enough
 * that the review queue stays payable. Beyond it, retired (solved) drills go
 * first, then the oldest: a drill you already fixed taught what it had to.
 */
const MAX_MINES = 50;

/**
 * A stable id from the position and the move that was wrong in it.
 *
 * Not from the game or the ply: analysing the same game twice must produce
 * the same ids (so re-analysis deduplicates instead of duplicating), and the
 * same blunder reached through a different move order is the same lesson —
 * one drill, not two.
 */
function mineId(fen, played) {
  const s = fen + "|" + played;
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "mine:" + h.toString(36);
}

/**
 * The drills one analysed game yields for one side.
 *
 * Only `??` plies — a `?` is a worse-than-best move, which most human moves
 * are; drilling those would flood the set with noise and bury the real
 * lessons. Each candidate must have a stored best move that is legal in the
 * position and different from what was played: an analysis row without a
 * best move (aborted probe, terminal position) has a judgement but no answer,
 * and a drill without an answer is not a drill.
 *
 * @param {object} a { fens, sans, tags, bests, scalars } — analyzeGame's own
 *        arrays: fens[i] is the position ply i was played from, sans[i] the
 *        move, tags[i] its judgement, bests[i] the engine's UCI choice there
 * @param {"w"|"b"} side whose mistakes to mine
 * @param {Function} Chess for UCI → SAN in the candidate's position
 * @returns {object[]} drill objects, without timestamps (the caller stamps)
 */
function candidatesFrom(a, side, Chess) {
  const out = [];
  if (!a || !a.fens || !a.sans || !a.tags || !a.bests) return out;
  for (let i = 0; i < a.sans.length; i++) {
    if (a.tags[i] !== "??") continue;
    const fen = a.fens[i];
    if (!fen || fen.split(" ")[1] !== side) continue;
    const uci = a.bests[i];
    if (typeof uci !== "string" || uci.length < 4) continue;
    const g = new Chess(fen);
    const best = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || "q" });
    if (!best || best.san === a.sans[i]) continue;
    // centipawn cost of the played move, from the mover's side — the same
    // arithmetic the tag was computed from
    const sA = a.scalars ? a.scalars[i] : null;
    const sB = a.scalars ? a.scalars[i + 1] : null;
    const loss = sA != null && sB != null ? Math.round(side === "w" ? sA - sB : sB - sA) : null;
    out.push({
      id: mineId(fen, a.sans[i]),
      cat: "mine",
      fen,
      solution: [best.san],
      played: a.sans[i],
      loss,
      ply: i,
      // black-to-move drills flip the board and gate input exactly like the
      // black opening drills — the rails read `side`, nothing else needed
      side: side === "b" ? "b" : undefined,
    });
  }
  return out;
}

/**
 * Merge freshly mined drills into the personal book.
 *
 * Dedup by id (re-analysing a game must be a no-op), stamp arrivals, then
 * enforce the cap: solved drills leave first (oldest first), then unsolved
 * oldest. Returns the new list plus what was added and dropped — the caller
 * cleans dropped ids out of solved/missed so no orphan queue entries linger.
 *
 * @param {object[]} list the current personal book
 * @param {object[]} cands candidatesFrom() output
 * @param {number} now timestamp for the new arrivals
 * @param {Set<string>} solvedIds ids already solved, for retirement order
 * @returns {{list: object[], added: number, dropped: string[]}}
 */
function addMines(list, cands, now, solvedIds) {
  const have = new Set(list.map((m) => m.id));
  const fresh = [];
  for (const c of cands) {
    if (have.has(c.id)) continue;
    have.add(c.id);
    fresh.push(Object.assign({}, c, { t: now }));
  }
  let next = list.concat(fresh);
  const dropped = [];
  if (next.length > MAX_MINES) {
    const retire = (pred) => {
      for (const m of next.slice().sort((x, y) => (x.t || 0) - (y.t || 0))) {
        if (next.length <= MAX_MINES) break;
        if (!pred(m)) continue;
        next = next.filter((x) => x.id !== m.id);
        dropped.push(m.id);
      }
    };
    retire((m) => solvedIds && solvedIds.has(m.id));
    retire(() => true);
  }
  return { list: next, added: fresh.length, dropped };
}

export const ChessMistakes = { MAX_MINES, mineId, candidatesFrom, addMines };
