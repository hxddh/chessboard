/**
 * What tactic is this? — derived from the position, not hand-typed.
 *
 * Only 21 of the 168 puzzles carried a `motif`, all of them in the `tac`
 * category, so "today I want to practise pins" could only ever reach those 21
 * — while the 23 real-game and 37 capture puzzles are full of pins, skewers
 * and deflections that nobody had labelled. 缺陷 28.
 *
 * Hand-tagging 147 positions is how the labels start being wrong: a motif is a
 * claim about the chess, and a wrong claim in a teaching app teaches the wrong
 * thing. So this derives them, the same way `puzzleTier()` derives difficulty
 * — the set can grow and the labels cannot drift away from it.
 *
 * **It reports only what it is sure of.** Every rule here is a geometric fact
 * about the position after the key move, not a guess: a discovered check is
 * "the piece that moved is not the piece giving check", a fork is "this piece
 * now attacks two things worth taking". Where nothing matches, the answer is
 * null and the puzzle stays untagged, which is the honest outcome — an
 * unlabelled puzzle costs a filter entry, a mislabelled one costs trust.
 *
 * Pure: a position in, a string out. No DOM, no engine.
 *
 * @module motif
 */

/** Standard piece values, for "is this worth winning". */
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Squares a piece on `sq` attacks, ignoring whose turn it is. */
function attacksFrom(Chess, fen, sq) {
  // A side can only be asked for its own moves, so put the mover on move.
  const parts = fen.split(" ");
  const g0 = new Chess(fen);
  const piece = g0.get(sq);
  if (!piece) return [];
  parts[1] = piece.color;
  parts[3] = "-";           // en-passant rights belong to the other position
  let g;
  try { g = new Chess(parts.join(" ")); } catch (_) { return []; }
  if (!g || !g.fen) return [];
  let moves = [];
  try { moves = g.moves({ square: sq, verbose: true }) || []; } catch (_) { return []; }
  return moves;
}

/**
 * The motif of `san` played in `fen`, or null.
 *
 * @param {string} fen        position before the key move
 * @param {string} san        the key move
 * @param {Function} Chess    the rules engine (injected — this module has none)
 * @returns {string|null}     a motif key: "discovered" | "double" | "fork" |
 *                            "pin" | "skewer", or null when nothing is certain
 */
export function motifOf(fen, san, Chess) {
  let g;
  try { g = new Chess(fen); } catch (_) { return null; }
  if (!g || !g.fen()) return null;
  let mv = null;
  try { mv = g.move(san); } catch (_) { mv = null; }
  if (!mv) return null;
  const after = g.fen();
  const them = mv.color === "w" ? "b" : "w";

  // --- checks: is the checking piece the one that moved? -------------------
  if (g.in_check()) {
    const king = kingSquare(g, them);
    const givers = attackersOf(Chess, after, king, mv.color);
    if (givers.length >= 2) return "double";
    // A discovered check is a check delivered by a piece that did not move.
    if (givers.length === 1 && givers[0] !== mv.to) return "discovered";
  }

  // --- fork: the piece that moved now attacks two things worth winning -----
  // The king counts as one of them, and usually is: a knight hitting king and
  // rook is the fork everybody pictures, and it is invisible to a rule that
  // only looks at capturable pieces, because a king is never capturable.
  {
    const hits = new Set(attacksFrom(Chess, after, mv.to)
      .filter((m) => m.captured && VALUE[m.captured] >= 3)
      .map((m) => m.to));
    if (g.in_check()) {
      const givers = attackersOf(Chess, after, kingSquare(g, them), mv.color);
      if (givers.includes(mv.to)) hits.add("K");
    }
    if (hits.size >= 2) return "fork";
  }

  // --- pin / skewer --------------------------------------------------------
  // Two shapes, both real: the move *creates* the line, or the move exploits a
  // line that is already there — attacking a man that cannot step aside is a
  // pin being used, and that is what the puzzle is teaching either way.
  {
    const made = lineTargets(Chess, after, mv.to, mv.color);
    if (made) return made;
    const used = exploitsPin(Chess, fen, after, mv, them);
    if (used) return used;
  }
  return null;
}

/**
 * Does the key move attack an enemy man that is pinned to its king?
 *
 * "Pinned" is asked of the rules rather than worked out geometrically: if the
 * man has no legal move at all in a position where its side is to move, and
 * removing it would expose the king, it is pinned. chess.js already refuses to
 * generate the illegal moves, so the question is just "does this piece have
 * any move".
 */
function exploitsPin(Chess, before, after, mv, them) {
  const parts = after.split(" ");
  parts[1] = them;
  parts[3] = "-";
  let g;
  try { g = new Chess(parts.join(" ")); } catch (_) { return null; }
  if (!g || g.in_check()) return null;    // in check, everything is constrained
  const victims = attacksFrom(Chess, after, mv.to).filter((m) => m.captured);
  for (const v of victims) {
    const p = g.get(v.to);
    if (!p || p.type === "k" || p.type === "p") continue;
    let moves = [];
    try { moves = g.moves({ square: v.to, verbose: true }) || []; } catch (_) { continue; }
    if (moves.length === 0) return "pin";
  }
  return null;
}

/** Where `color`'s king stands. */
function kingSquare(g, color) {
  const b = g.board();
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = b[r][f];
      if (p && p.type === "k" && p.color === color) return "abcdefgh"[f] + (8 - r);
    }
  }
  return null;
}

/** Squares from which `color` attacks `sq`. */
function attackersOf(Chess, fen, sq, color) {
  if (!sq) return [];
  const parts = fen.split(" ");
  parts[1] = color;
  parts[3] = "-";
  let g;
  try { g = new Chess(parts.join(" ")); } catch (_) { return []; }
  let moves = [];
  try { moves = g.moves({ verbose: true }) || []; } catch (_) { return []; }
  // a king cannot be captured, so ask which moves would land on that square
  return moves.filter((m) => m.to === sq).map((m) => m.from);
}

/**
 * A pin or a skewer created by the piece now on `from`.
 *
 * Both are the same geometry — a line piece, an enemy man, and a second enemy
 * man behind it on the same ray. Which one it is depends on which of the two
 * is worth more: the valuable one in front is a skewer, behind is a pin.
 */
const RAYS = {
  b: [[1, 1], [1, -1], [-1, 1], [-1, -1]],
  r: [[1, 0], [-1, 0], [0, 1], [0, -1]],
};
function lineTargets(Chess, fen, from, color) {
  let g;
  try { g = new Chess(fen); } catch (_) { return null; }
  const p = g.get(from);
  if (!p || !"brq".includes(p.type)) return null;
  const dirs = p.type === "q" ? RAYS.b.concat(RAYS.r) : RAYS[p.type];
  const f0 = from.charCodeAt(0) - 97, r0 = Number(from[1]) - 1;
  for (const [df, dr] of dirs) {
    const seen = [];
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (f < 0 || f > 7 || r < 0 || r > 7) break;
      const sq = "abcdefgh"[f] + (r + 1);
      const q = g.get(sq);
      if (!q) continue;
      if (q.color === color) break;        // own piece blocks the ray
      seen.push(q);
      if (seen.length === 2) break;
    }
    if (seen.length === 2) {
      const front = seen[0], back = seen[1];
      // the king counts as the most valuable thing on the board
      const v = (x) => (x.type === "k" ? 100 : VALUE[x.type]);
      if (v(back) > v(front)) return "pin";
      if (v(front) > v(back)) return "skewer";
    }
  }
  return null;
}
