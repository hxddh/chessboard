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
 * @param {object} [rev] the revision this analysis is — see drillFrom
 * @returns {object[]} drill objects, without timestamps (the caller stamps)
 */
function candidatesFrom(a, side, Chess, rev) {
  const out = [];
  if (!a || !a.fens || !a.sans || !a.tags || !a.bests) return out;
  for (let i = 0; i < a.sans.length; i++) {
    if (a.tags[i] !== "??") continue;
    const fen = a.fens[i];
    if (!fen || fen.split(" ")[1] !== side) continue;
    // centipawn cost of the played move, from the mover's side — the same
    // arithmetic the tag was computed from
    const sA = a.scalars ? a.scalars[i] : null;
    const sB = a.scalars ? a.scalars[i + 1] : null;
    const loss = sA != null && sB != null ? Math.round(side === "w" ? sA - sB : sB - sA) : null;
    const d = drillFrom(fen, a.sans[i], a.bests[i], loss, i, Chess, rev);
    if (d) {
      // the engine's continuation after the answer, for the explanation
      if (a.pvs && typeof a.pvs[i] === "string") d.pv = a.pvs[i];
      out.push(d);
    }
  }
  return out;
}

/**
 * One drill from one judged ply — the single rule both mining paths share.
 *
 * The automatic pass (candidatesFrom) and the review page's hand-bank button
 * must mint identical drills for identical mistakes, ids included: two rules
 * would eventually let a hand-banked drill duplicate an auto-mined one under
 * a different id, and the whole dedup story rests on the id being a function
 * of (position, played move) alone.
 *
 * Returns null when there is nothing to teach: no stored best, an illegal
 * best (stale analysis on a different game), or best === played.
 *
 * `rev` — since 5.1 — records which analysis said so: `{ budget, src }`,
 * budget being the per-move search time in ms and src "auto" or "hand". A
 * drill's identity is (position, sin); its ANSWER is a judgement made at a
 * search budget, and a deeper pass may change it or withdraw the ?? entirely.
 * Until 5.1 addMines skipped every known id, so the quick pass's answer was
 * the answer for ever and a later 精析 could not correct it (audit F2).
 */
function drillFrom(fen, played, bestUci, loss, ply, Chess, rev) {
  if (!fen || typeof bestUci !== "string" || bestUci.length < 4) return null;
  const g = new Chess(fen);
  const best = g.move({ from: bestUci.slice(0, 2), to: bestUci.slice(2, 4), promotion: bestUci[4] || "q" });
  if (!best || best.san === played) return null;
  return {
    id: mineId(fen, played),
    cat: "mine",
    fen,
    solution: [best.san],
    played,
    loss: Number.isFinite(loss) ? Math.round(loss) : null,
    ply,
    rev: rev ? { budget: Number(rev.budget) || 0, src: rev.src || "auto" } : undefined,
    // black-to-move drills flip the board and gate input exactly like the
    // black opening drills — the rails read `side`, nothing else needed
    side: fen.split(" ")[1] === "b" ? "b" : undefined,
  };
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

/**
 * Let a fresh analysis revise the drills it already covers.
 *
 * Two things a deeper pass can say about a position that is already in the
 * book: "the best move is different (or costs a different amount)", and "this
 * was never a serious mistake". Both are only believed from a pass at least
 * as deep as the one that minted the drill — a quick pass never overrules a
 * deep one. Progress on a revised drill is kept: the position and the sin are
 * the same lesson, only the answer sheet changed. A withdrawn drill is
 * returned in `retired` so the caller can clear its queue entries.
 *
 * @param {object[]} list the personal book
 * @param {object[]} cands candidatesFrom() of the new pass — the ?? plies
 * @param {object} a the pass's arrays {fens, sans, tags}, for the plies it
 *        judged NOT to be ??
 * @param {"w"|"b"} side the side the pass mined
 * @param {object} rev {budget, src} of the new pass
 * @returns {{list: object[], updated: string[], retired: string[]}}
 */
function reviseMines(list, cands, a, side, rev) {
  const budget = rev ? Number(rev.budget) || 0 : 0;
  const deepEnough = (m) => !m.rev || budget >= (Number(m.rev.budget) || 0);
  const byId = new Map(list.map((m) => [m.id, m]));
  const updated = [], retired = [];
  for (const c of cands) {
    const m = byId.get(c.id);
    if (!m || !deepEnough(m)) continue;
    const changed = m.solution[0] !== c.solution[0] || m.loss !== c.loss;
    if (!changed) continue;
    m.solution = [c.solution[0]];
    m.loss = c.loss;
    m.pv = c.pv;
    m.alts = [];  // an alternative accepted against the old answer is re-judged
    m.rev = { budget, src: m.rev ? m.rev.src : "auto" };
    updated.push(m.id);
  }
  if (a && a.fens && a.sans && a.tags) {
    for (let i = 0; i < a.sans.length; i++) {
      if (!a.fens[i] || a.fens[i].split(" ")[1] !== side) continue;
      if (a.tags[i] == null || a.tags[i] === "??") continue;
      const m = byId.get(mineId(a.fens[i], a.sans[i]));
      if (m && deepEnough(m)) retired.push(m.id);
    }
  }
  const gone = new Set(retired);
  return { list: gone.size ? list.filter((m) => !gone.has(m.id)) : list, updated, retired };
}

/** Is `san` an answer this drill accepts — the stored best, or an alternative
    the engine has since confirmed costs nothing serious? */
function isAccepted(m, san) {
  return !!m && (m.solution.includes(san) || (Array.isArray(m.alts) && m.alts.includes(san)));
}

/**
 * Judge a move the player offered instead of the stored answer, from the two
 * evaluations (white's view, centipawns) after the stored best and after the
 * offered move, at the same budget. Accepted when it costs less than a
 * mistake against the best: the drill asks for a move that does not lose the
 * position, not for the engine's exact preference (audit F3).
 * @returns {{ok: boolean, loss: number}} loss ≥ 0, from the mover's side
 */
function judgeAlt(cpAfterBest, cpAfterAlt, side, mistake) {
  const loss = Math.max(0, Math.round(side === "w" ? cpAfterBest - cpAfterAlt : cpAfterAlt - cpAfterBest));
  return { ok: loss < mistake, loss };
}

export const ChessMistakes = { MAX_MINES, mineId, candidatesFrom, drillFrom, addMines, reviseMines, isAccepted, judgeAlt };
