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
  const p = load(Chess, fen).get(sq);
  const g = p && load(Chess, onMove(fen, p.color));
  return g ? g.moves({ square: sq, verbose: true }) : [];
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
  // (a king cannot be captured, so ask which moves would land on its square)
  const givers = g.in_check() ? takersOf(Chess, after, kingOf(gridOf(g), them), mv.color).map((m) => m.from) : [];
  if (givers.length >= 2) return "double";
  // A discovered check is a check delivered by a piece that did not move.
  if (givers.length === 1 && givers[0] !== mv.to) return "discovered";

  // --- fork: the piece that moved now attacks two things worth winning -----
  // The king counts as one of them, and usually is: a knight hitting king and
  // rook is the fork everybody pictures, and it is invisible to a rule that
  // only looks at capturable pieces, because a king is never capturable.
  {
    const hits = new Set(attacksFrom(Chess, after, mv.to)
      .filter((m) => m.captured && VALUE[m.captured] >= 3)
      .map((m) => m.to));
    if (givers.includes(mv.to)) hits.add("K");
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
  const g = load(Chess, onMove(after, them));
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

/** The keys motifOf() can return. */
export const MOTIF_KEYS = ["fork", "pin", "skewer", "discovered", "double"];

/**
 * The motif key a puzzle is counted under (7.6): its written label when it
 * has one, mapped through `handKeys` (the puzzle set's own table), else what
 * `derive()` works out from the position. A label is what the card shows, so
 * it must be what the tally records; a label with no key counts as no motif.
 * @param {{motif?: string}} p
 * @param {Object<string, string>} handKeys written label → key
 * @param {function(): (string|null)} derive
 * @returns {string|null}
 */
export function puzzleMotifKey(p, handKeys, derive) {
  if (p.motif) return handKeys[p.motif] || (MOTIF_KEYS.includes(p.motif) ? p.motif : null);
  return derive();
}

// ===========================================================================
// Motifs read off an engine line (v8-0-plan B3).
//
// motifOf() looks at one move and the position after it, which is right for
// a puzzle (the solution IS the line) and not enough for a review sentence:
// 4.Bg5?? Qxg5 passed its pin test — a queen on g5 with two white men behind
// each other on a ray — when the bishop was simply unprotected and taken.
// The 8.0 audit (docs/coach-audit-8.0.md) found that shape again and again.
//
// So a motif named in a sentence is named here, from the engine's own line,
// and every detector has two halves: the geometry, and the line cashing it
// in — the forked man is taken, the pinned man is taken where it stands,
// the defender is removed and then what it defended goes. Geometry the line
// does not exploit is not a reason, and says nothing. Detectors run most
// specific first; "hanging" runs before everything, because a man taken for
// free is the whole story whatever lines it happens to stand on.
//
// Still pure: FEN and SAN in, a key out. chess.js is injected.
// ===========================================================================

const FILES = "abcdefgh";
const xyOf = (sq) => [sq.charCodeAt(0) - 97, Number(sq[1]) - 1];
const sqAt = (f, r) => FILES[f] + (r + 1);
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const KING = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const other = (c) => (c === "w" ? "b" : "w");
const rankOf = (t) => (t === "k" ? 100 : VALUE[t]);

function load(Chess, fen) {
  let g = null;
  try { g = new Chess(fen); } catch (_) { return null; }
  return g && g.fen && g.fen().split(" ")[0] === fen.split(" ")[0] ? g : null;
}
/** `fen` with `color` on move and no en-passant square (a null move). */
function onMove(fen, color) {
  const p = fen.split(" ");
  p[1] = color;
  p[3] = "-";
  return p.join(" ");
}
/** square → piece, for the geometry below */
function gridOf(g) {
  const m = {};
  const b = g.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (b[r][f]) m[sqAt(f, 7 - r)] = b[r][f];
  return m;
}
/** Squares the man on `from` attacks (pseudo-legal: pins are not asked). */
function hitsFrom(grid, from) {
  const p = grid[from];
  if (!p) return [];
  const [f0, r0] = xyOf(from);
  const out = [];
  if (p.type === "p") {
    const d = p.color === "w" ? 1 : -1;
    for (const df of [-1, 1]) if (onBoard(f0 + df, r0 + d)) out.push(sqAt(f0 + df, r0 + d));
    return out;
  }
  if (p.type === "n" || p.type === "k") {
    for (const [df, dr] of p.type === "n" ? KNIGHT : KING) if (onBoard(f0 + df, r0 + dr)) out.push(sqAt(f0 + df, r0 + dr));
    return out;
  }
  const dirs = p.type === "b" ? RAYS.b : p.type === "r" ? RAYS.r : RAYS.b.concat(RAYS.r);
  for (const [df, dr] of dirs) {
    for (let i = 1; i < 8; i++) {
      const f = f0 + df * i, r = r0 + dr * i;
      if (!onBoard(f, r)) break;
      const s = sqAt(f, r);
      out.push(s);
      if (grid[s]) break;
    }
  }
  return out;
}
/** Squares of `color` men that attack `sq`. */
function hittersOf(grid, sq, color) {
  return Object.keys(grid).filter((s) => grid[s].color === color && hitsFrom(grid, s).includes(sq));
}
/** Is `x` strictly between `a` and `b` on one rank, file or diagonal? */
function between(a, b, x) {
  const [af, ar] = xyOf(a), [bf, br] = xyOf(b), [xf, xr] = xyOf(x);
  const df = Math.sign(bf - af), dr = Math.sign(br - ar);
  const n = Math.max(Math.abs(bf - af), Math.abs(br - ar));
  if (bf - af !== df * n || br - ar !== dr * n) return false;   // not a line
  for (let i = 1; i < n; i++) if (af + df * i === xf && ar + dr * i === xr) return true;
  return false;
}
function kingOf(grid, color) {
  return Object.keys(grid).find((s) => grid[s].type === "k" && grid[s].color === color) || null;
}
/** Legal moves of `color` onto `sq` in `fen` (whoever is on move there). */
function takersOf(Chess, fen, sq, color) {
  const g = load(Chess, onMove(fen, color));
  if (!g) return [];
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch (_) { return []; }
  return ms.filter((m) => m.to === sq);
}
/**
 * Could `color` take back on `sq` if the other side captured there? Asked of
 * the rules with a stand-in on the square, so a pinned defender is no
 * defender and a king only defends squares it may step onto.
 */
function guarded(Chess, fen, sq, color) {
  const g = load(Chess, onMove(fen, color));
  if (!g) return false;
  g.remove(sq);
  g.put({ type: "n", color: other(color) }, sq);
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch (_) { return false; }
  return ms.some((m) => m.to === sq);
}
/**
 * Is the side on move in `fen` in check from a man other than the one on
 * `sq`? Then a take-back on `sq` is illegal because of the check, not
 * because nothing guards it, and "free" would be a misreading: a discovered
 * check (review of PR #87 — Nxc5+ with Re1 behind, the b6 pawn guarding c5).
 */
function checkedFromElsewhere(Chess, fen, sq) {
  const g = load(Chess, fen);
  if (!g || !g.in_check()) return false;
  const grid = gridOf(g);
  const V = g.turn();
  const k = kingOf(grid, V);
  return !!k && hittersOf(grid, k, other(V)).some((s) => s !== sq);
}
function playOn(g, m) {
  let mv = null;
  try { mv = g.move(m); } catch (_) { mv = null; }
  if (!mv && typeof m === "string" && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) {
    try { mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || "q" }); } catch (_) { mv = null; }
  }
  return mv;
}
/** A mate in one for the side on move in `fen`, as SAN, or null. */
function mateInOne(Chess, fen) {
  const g = load(Chess, fen);
  if (!g) return null;
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch (_) { return null; }
  for (const m of ms) {
    g.move(m);
    const mate = g.in_checkmate();
    g.undo();
    if (mate) return m.san;
  }
  return null;
}

/**
 * The line, played: each move record and the FEN after it, up to the first
 * move that will not play. `mateAt` is the ply that mates, if one does.
 */
function walk(Chess, fen, sans, max) {
  const g = load(Chess, fen);
  if (!g) return null;
  const moves = [], fens = [];
  let mateAt = null;
  for (const s of sans.slice(0, max)) {
    const m = playOn(g, s);
    if (!m) break;
    moves.push(m);
    fens.push(g.fen());
    if (g.in_checkmate()) { mateAt = moves.length - 1; break; }
  }
  return { moves, fens, mateAt };
}
/** Material `side` wins over the first `n` plies (promotions count). */
function gainOver(moves, n, side) {
  let s = 0;
  for (const m of moves.slice(0, n)) {
    const sign = m.color === side ? 1 : -1;
    if (m.captured) s += sign * VALUE[m.captured];
    if (m.promotion) s += sign * (VALUE[m.promotion] - 1);
  }
  return s;
}
/** Does an attacker move at an even ply > 0 inside the window satisfy `f`? */
function laterMine(c, f) {
  return c.L.moves.slice(0, c.W).some((x, i) => i % 2 === 0 && i > 0 && f(x, i));
}

// --- the detectors -----------------------------------------------------------
// Each takes the context built by lineMotif() and returns {motif, …} or null.
// `c.won` is what the attacker is up over the window, net of whatever the
// move before the line (the mistake) had captured — so a recapture after a
// trade is 0 and never "wins" anything.

/** A man taken for nothing, or by something worth less than it. */
function dHanging(c) {
  const m = c.L.moves[0];
  if (!m.captured || VALUE[m.captured] < 3 || c.W < 2) return null;
  // a check from behind the capturer, not the capture, is what forbids the
  // take-back: unsure whether it hangs, so leave it to dDiscovered
  if (checkedFromElsewhere(c.Chess, c.L.fens[0], m.to)) return null;
  // asked where it happened: can the side that lost it take back, legally?
  const free = !takersOf(c.Chess, c.L.fens[0], m.to, c.V).some((x) => x.captured);
  const cheap = m.piece !== "k" && VALUE[m.piece] < VALUE[m.captured];
  if (!free && !cheap) return null;
  if (c.won < 2 && !c.mates) return null;
  // `free`: nothing could take back; otherwise a cheaper man took it and the
  // recapture does not pay for it — the sentence says which (8.0 audit:
  // 17.Nf6+ gxf6 is not 「马没有保护住」, the e5 pawn guarded it)
  return { motif: "hanging", piece: m.captured, by: m.piece, free };
}

/**
 * Checks, every attacker move of the line, from a position the mover was
 * winning, to an evaluation of dead level: the engine sees the repetition.
 */
function dPerpetual(c) {
  const o = c.opts;
  if (o.evalBefore == null || o.evalAfter == null) return null;
  const sign = c.V === "w" ? 1 : -1;
  if (sign * o.evalBefore < 150 || Math.abs(o.evalAfter) > 15) return null;
  const mine = c.L.moves.filter((m) => m.color === c.A);
  if (c.L.moves.length < 3 || mine.length < 2 || !mine.every((m) => /[+#]$/.test(m.san))) return null;
  // v8-2-plan T5: a run of checks in a level line is not yet a perpetual —
  // 8.1's sample had the king walk out (…Kf8 Rxh7) and a draw by other means.
  // Proved on the board: after the line's first check, whatever the king
  // does, a check brings a position back. Short cycles first (most are two
  // or three checks long); 2,000 positions is about half a second at worst,
  // and the 8.1 cases that proved at all did so inside it
  const g = load(c.Chess, c.fen);
  g.move(c.L.moves[0]);
  const b = { n: 2000 };
  for (let d = 2; d < 7 && b.n > 0; d++) if (forever(g, [c.fen.split(" ", 2).join()], d, b, true)) return { motif: "perpetual" };
  return null;
}
/**
 * `g` after a check (`def`: the defender on move) or before one: can the
 * checking side keep on checking until a position on `seen` comes back?
 * Within `d` more checks and `b.n` positions — past that, no.
 */
function forever(g, seen, d, b, def) {
  const k = g.fen().split(" ", 2).join();
  if (!def && seen.includes(k)) return true;
  if (--b.n < 0 || !d) return false;
  seen.push(k);
  // the defender: every reply (none at all: mate); the checker: one check that works
  let ok = def;
  for (const m of g.moves({ verbose: true })) {
    if (!def && !/[+#]/.test(m.san)) continue;
    g.move(m);
    const r = forever(g, seen, d - !def, b, !def);
    g.undo();
    if (r !== def) { ok = r; break; }
  }
  seen.pop();
  return ok;
}

/** A line piece unmasked by the move: check, double check, or attack. */
function dDiscovered(c) {
  const m = c.L.moves[0];
  if (/[kq]/.test(m.flags)) return null;
  const g0 = gridOf(load(c.Chess, c.fen)), g1 = gridOf(load(c.Chess, c.L.fens[0]));
  const found = [];
  for (const s of Object.keys(g1)) {
    const p = g1[s];
    if (p.color !== c.A || s === m.to || !"brq".includes(p.type)) continue;
    const was = new Set(hitsFrom(g0, s));
    for (const t of hitsFrom(g1, s)) {
      const q = g1[t];
      if (was.has(t) || !q || q.color !== c.V || !between(s, t, m.from)) continue;
      if (q.type === "k" || VALUE[q.type] >= 3) found.push({ from: s, to: t, type: q.type });
    }
  }
  if (!found.length) return null;
  if (found.some((x) => x.type === "k")) {
    if (!(c.won >= 2 || c.mates)) return null;
    return { motif: hitsFrom(g1, m.to).includes(kingOf(g1, c.V)) ? "double" : "discovered" };
  }
  // an attack, not a check: the unmasked piece has to take what it uncovered
  const took = laterMine(c, (x) => x.captured && found.some((f) => f.from === x.from && f.to === x.to));
  return took && c.won >= 2 ? { motif: "discoveredAttack" } : null;
}

/** The men worth having that the man which moved now hits. */
function forkTargets(c) {
  const m = c.L.moves[0];
  const g1 = gridOf(load(c.Chess, c.L.fens[0]));
  return hitsFrom(g1, m.to).filter((t) => g1[t] && g1[t].color === c.V && (g1[t].type === "k" || VALUE[g1[t].type] >= 3))
    .map((t) => ({ sq: t, type: g1[t].type }));
}
/** A fork the line cashes: the forker itself takes one of the men it hit. */
function dFork(c) {
  const m = c.L.moves[0];
  const hits = forkTargets(c);
  if (hits.length < 2) return null;
  const took = laterMine(c, (x) => x.from === m.to && x.captured && hits.some((h) => h.sq === x.to));
  if (!took || c.won < 2) return null;
  return { motif: "fork", hits: hits.map((h) => h.type).sort((a, b) => rankOf(b) - rankOf(a)) };
}
/**
 * The fork as a fact of the position, for a line too short (or too busy
 * elsewhere) to show the capture: the forker cannot be taken, and at least
 * two of the men it hits are the king, loose, or worth more than it. The
 * sentence built on this names what is hit and claims no loss.
 */
function dForkShape(c) {
  const m = c.L.moves[0];
  const hits = forkTargets(c);
  if (hits.length < 2) return null;
  if (takersOf(c.Chess, c.L.fens[0], m.to, c.V).some((x) => x.captured)) return null;
  // "loose" is asked of the geometry, not the rules: in check the rules let
  // no defender take back, and 32…Qg7+ looked like it won the h8 rook that
  // the b8 rook guards once the king has stepped aside (8.0 audit)
  // A king counts as a guard of what no second attacker hits. Even in check:
  // 25…Qe2+ against Kg2 and Rf3 can be met by Rf2, and a fork that depends
  // on which way the king steps is not certain enough to name.
  const g1 = gridOf(load(c.Chess, c.L.fens[0]));
  const loose = (sq) => !hittersOf(g1, sq, c.V).some((s) => g1[s].type !== "k" || hittersOf(g1, sq, c.A).length <= 1);
  const real = hits.filter((h) => h.type === "k" || VALUE[h.type] > VALUE[m.piece] || loose(h.sq));
  if (real.length < 2) return null;
  return { motif: "fork", hits: [...new Set(real.map((h) => h.type))].sort((a, b) => rankOf(b) - rankOf(a)), shape: true };
}

/**
 * The mistake captured; instead of taking back at once the reply is a check
 * or a capture elsewhere, and the recapture comes a move later.
 */
function dZwischenzug(c) {
  const p = c.opts.played;
  const m = c.L.moves[0];
  if (!p || !p.captured || m.to === p.to) return null;
  if (!/[+#]$/.test(m.san) && !m.captured) return null;
  if (!takersOf(c.Chess, c.fen, p.to, c.A).length) return null;     // there was a recapture to delay
  return laterMine(c, (x) => x.to === p.to && x.captured) && c.won >= 2 ? { motif: "zwischenzug" } : null;
}

/** A man that was lost anyway takes something on its way out. */
function dDesperado(c) {
  const m = c.L.moves[0], p = c.opts.played;
  if (!m.captured || !p || c.W < 2) return null;
  const g0 = gridOf(load(c.Chess, c.fen));
  const by = hittersOf(g0, m.from, c.V);
  if (!by.length) return null;
  const doomed = !guarded(c.Chess, c.fen, m.from, c.A) || by.some((s) => g0[s].type !== "k" && VALUE[g0[s].type] < VALUE[m.piece]);
  // the mistake is what doomed it: it attacked the man, or took something
  if (!doomed || !(hitsFrom(g0, p.to).includes(m.from) || p.captured)) return null;
  // and it takes something else: taking the man that attacks it is just a
  // capture (8.0 audit: 19…Bd6 Qxd6 is not a desperado)
  if (by.includes(m.to)) return null;
  const l1 = c.L.moves[1];
  if (!l1 || l1.to !== m.to || !l1.captured) return null;
  return c.won >= 1 ? { motif: "desperado" } : null;
}

/** Take the defender, then what it defended — which nobody guards now. */
function dRemoveDefender(c) {
  const [m0, , m2] = c.L.moves;
  if (!m2 || c.W < 4 || !m0.captured || !m2.captured || VALUE[m2.captured] < 3 || m2.to === m0.to) return null;
  const g0 = gridOf(load(c.Chess, c.fen));
  const t = g0[m2.to];
  if (!t || t.color !== c.V || !hitsFrom(g0, m0.to).includes(m2.to)) return null;
  if (!guarded(c.Chess, c.fen, m2.to, c.V)) return null;           // it WAS defended…
  if (guarded(c.Chess, c.L.fens[1], m2.to, c.V)) return null;      // …and is not any more
  return c.won >= 2 ? { motif: "removeDefender", piece: m2.captured } : null;
}

/**
 * A man drawn onto the square the attacker played to: overload (it had to
 * take back there and also guarded something else), deflection (a sacrifice
 * pulls it off its post) or decoy (a sacrifice pulls the king or queen onto
 * a square where it is then hit).
 */
function dLured(c) {
  const [m0, m1, m2] = c.L.moves;
  if (!m2 || c.W < 4 || m1.to !== m0.to || !m1.captured) return null;
  const g0 = gridOf(load(c.Chess, c.fen));
  const post = m1.from;
  // what it guarded from its post, and lost with it
  if (m2.captured && m2.to !== m0.to && VALUE[m2.captured] >= 3 && hitsFrom(g0, post).includes(m2.to) &&
    guarded(c.Chess, c.fen, m2.to, c.V) && !guarded(c.Chess, c.L.fens[1], m2.to, c.V) && c.won >= 2) {
    return { motif: m0.captured ? "overload" : "deflection", piece: m2.captured };
  }
  if (!m0.captured && (m1.piece === "k" || m1.piece === "q")) {
    const g2 = gridOf(load(c.Chess, c.L.fens[2]));
    if (hitsFrom(g2, m2.to).includes(m0.to) && c.won >= 2) return { motif: "decoy" };
  }
  return null;
}

/** Every line `color`'s sliders hold in `grid`: two enemy men, one behind the other. */
function linesIn(grid, color) {
  const out = [];
  for (const s of Object.keys(grid)) {
    const p = grid[s];
    if (p.color !== color || !"brq".includes(p.type)) continue;
    const dirs = p.type === "q" ? RAYS.b.concat(RAYS.r) : RAYS[p.type];
    const [f0, r0] = xyOf(s);
    for (const [df, dr] of dirs) {
      const seen = [];
      for (let i = 1; i < 8 && seen.length < 2; i++) {
        const f = f0 + df * i, r = r0 + dr * i;
        if (!onBoard(f, r)) break;
        const q = sqAt(f, r);
        if (!grid[q]) continue;
        if (grid[q].color === color) break;
        seen.push(q);
      }
      if (seen.length < 2) continue;
      out.push({ by: s, front: seen[0], back: seen[1], frontType: grid[seen[0]].type, backType: grid[seen[1]].type });
    }
  }
  return out;
}
/**
 * Pin: the man in front is worth less than the one behind, and the line
 * takes it where it stands. Skewer: the one in front is worth more, steps
 * aside, and the piece that skewered takes the one behind. Either way the
 * move made the line or pointed at the man on it.
 */
function dPinSkewer(c) {
  const m0 = c.L.moves[0];
  const g1 = gridOf(load(c.Chess, c.L.fens[0]));
  for (const p of linesIn(g1, c.A)) {
    const made = p.by === m0.to || between(p.by, p.front, m0.from);
    const pointed = hitsFrom(g1, m0.to).includes(p.front);
    if (!made && !pointed) continue;
    if (p.frontType !== "k" && rankOf(p.backType) > rankOf(p.frontType)) {
      const took = laterMine(c, (x) => x.to === p.front && x.captured === p.frontType);
      if (took && c.won >= 2) return { motif: "pin", piece: p.frontType };
    } else if (p.by === m0.to && rankOf(p.frontType) > rankOf(p.backType) && VALUE[p.backType] >= 3) {
      const m1 = c.L.moves[1], m2 = c.L.moves[2];
      if (m1 && m2 && c.W >= 4 && m1.from === p.front && m2.from === p.by && m2.to === p.back && m2.captured && c.won >= 2) {
        return { motif: "skewer", piece: m2.captured };
      }
    }
  }
  return null;
}

/** Take, be taken back, take again with the piece that stood behind. */
function dXray(c) {
  const [m0, m1, m2] = c.L.moves;
  if (!m2 || c.W < 4 || !m0.captured || m1.to !== m0.to || !m1.captured || m2.to !== m0.to || !m2.captured) return null;
  if (!"brq".includes(m2.piece) || !between(m2.from, m0.to, m0.from)) return null;
  const g0 = gridOf(load(c.Chess, c.fen));
  if (!g0[m2.from] || g0[m2.from].color !== c.A || hitsFrom(g0, m2.from).includes(m0.to)) return null;
  return c.won >= 2 ? { motif: "xray" } : null;
}

/** Attacked, and every square it could go to loses it too; the line takes it. */
function dTrapped(c) {
  const m0 = c.L.moves[0];
  if (m0.captured || /[+#]$/.test(m0.san)) return null;
  const g1 = gridOf(load(c.Chess, c.L.fens[0]));
  // can the attacker take a man of this type on `sq` and keep the gain?
  const lostOn = (fen, sq, type) => {
    const takes = takersOf(c.Chess, fen, sq, c.A).filter((x) => x.captured);
    if (!takes.length) return false;
    return takes.some((x) => x.piece !== "k" && VALUE[x.piece] < VALUE[type]) || !guarded(c.Chess, fen, sq, c.V);
  };
  for (const t of hitsFrom(g1, m0.to)) {
    const p = g1[t];
    if (!p || p.color !== c.V || p.type === "k" || VALUE[p.type] < 3) continue;
    if (!lostOn(c.L.fens[0], t, p.type)) continue;
    const g = load(c.Chess, c.L.fens[0]);
    let ms = [];
    try { ms = g.moves({ square: t, verbose: true }) || []; } catch (_) { ms = []; }
    if (!ms.length) continue;               // no move at all is a pin or a wall, not this
    // v8-2-plan T5: nor is a man whose king takes its squares away — all
    // three of 8.1's wrong 困子 were queens pinned to the king (…Qxd4 Bc5)
    if (g.moves({ square: t, legal: false }).length > ms.length) continue;
    const everywhere = ms.every((mv) => {
      if (mv.captured && VALUE[mv.captured] >= VALUE[p.type]) return false;
      g.move(mv);
      const bad = lostOn(g.fen(), mv.to, p.type);
      g.undo();
      return bad;
    });
    if (!everywhere) continue;
    if (laterMine(c, (x) => x.captured === p.type) && c.won >= 2) return { motif: "trapped", piece: p.type };
  }
  return null;
}

/** A quiet move after which the attacker would mate next move. */
function dMateThreat(c) {
  const m0 = c.L.moves[0];
  if (/[+#]$/.test(m0.san) || !(c.won >= 2 || c.mates)) return null;
  if (mateInOne(c.Chess, onMove(c.fen, c.A))) return null;          // the threat was there already
  return mateInOne(c.Chess, onMove(c.L.fens[0], c.A)) ? { motif: "mateThreat" } : null;
}

/** A pawn queens inside the line and the material stays. */
function dPromotion(c) {
  const pr = c.L.moves.slice(0, Math.max(c.W, 1)).some((m, i) => i % 2 === 0 && m.promotion);
  return pr && c.won >= 3 ? { motif: "promotion" } : null;
}

// zwischenzug before the checks and forks: when the mistake captured and the
// reply delays the recapture with a check that also forks, the delay is the
// lesson — the fork is how it pays
const DETECTORS = [dHanging, dPerpetual, dZwischenzug, dDiscovered, dFork, dDesperado, dRemoveDefender,
  dLured, dPinSkewer, dXray, dTrapped, dMateThreat, dPromotion, dForkShape];

/**
 * The motif an engine line proves, or null.
 *
 * @param {string} fen       the position the line starts from
 * @param {string[]} sans    the line (SAN or UCI); its first move is the attacker's
 * @param {Function} Chess   the rules engine
 * @param {object} [opts]
 * @param {number} [opts.credit]     material the move before the line captured
 *                                   (a trade is not a win)
 * @param {object} [opts.played]     that move's record (zwischenzug, desperado)
 * @param {number} [opts.evalBefore] app evalScalar before that move (White's view)
 * @param {number} [opts.evalAfter]  … and after it (perpetual)
 * @returns {null|{motif: string, piece?: string, by?: string, free?: boolean, hits?: string[], shape?: boolean}}
 */
export function lineMotif(fen, sans, Chess, opts = {}) {
  if (!fen || !Array.isArray(sans) || !sans.length) return null;
  const L = walk(Chess, fen, sans, 8);
  if (!L || !L.moves.length) return null;
  const A = L.moves[0].color;
  // an even window, so a capture is always followed by the chance to take
  // back; six plies at most — the tail of a quick line is its least certain part
  const W = Math.min(6, L.moves.length) & ~1;
  const mates = L.mateAt != null && L.mateAt % 2 === 0;
  const c = { Chess, fen, L, A, V: other(A), W, mates, opts,
    won: (mates ? 100 : gainOver(L.moves, W, A)) - (opts.credit || 0) };
  for (const d of DETECTORS) {
    let r = null;
    try { r = d(c); } catch (_) { r = null; }
    if (r) return r;
  }
  return null;
}

/**
 * The shape of a mate the line delivers: a back-rank mate is a rook or queen
 * mating along the king's own first rank while its own pawns wall it in.
 * @returns {"backRank"|null}
 */
export function mateMotif(fen, sans, Chess) {
  const L = walk(Chess, fen, Array.isArray(sans) ? sans : [], 12);
  if (!L || L.mateAt == null) return null;
  const last = L.moves[L.mateAt];
  if (last.piece !== "r" && last.piece !== "q") return null;
  const g = gridOf(load(Chess, L.fens[L.mateAt]));
  const V = other(last.color);
  const k = kingOf(g, V);
  const home = V === "w" ? 0 : 7;
  if (!k || xyOf(k)[1] !== home || xyOf(last.to)[1] !== home) return null;
  const kf = xyOf(k)[0];
  const up = V === "w" ? 1 : -1;
  let walls = 0;
  for (const df of [-1, 0, 1]) {
    if (!onBoard(kf + df, home + up)) continue;
    const q = g[sqAt(kf + df, home + up)];
    if (!q || q.color !== V) return null;
    if (q.type === "p") walls++;
  }
  return walls >= 2 ? "backRank" : null;
}

/**
 * v8-0-plan B3 §4 — was the refutation already a threat before the mistake?
 * Asked with a null move: the attacker on move in the position before, the
 * same move. It is a threat the mistake ignored when it already did the same
 * damage there (mated, or took a man that could not be held), and the
 * engine's own choice is what stopped it. Anything less certain is null.
 *
 * @param {string} fenBefore  position before the mistake (mover on move)
 * @param {object} reply      the refutation's move record (color, from, to, promotion)
 * @param {string|null} best  the engine's move there (SAN or UCI)
 * @param {Function} Chess
 * @returns {null|{motif: string, piece?: string, by?: string, free?: boolean}}
 */
export function threatOf(fenBefore, reply, best, Chess) {
  const gb = load(Chess, fenBefore);
  if (!gb || gb.in_check() || !reply || !best) return null;
  const A = reply.color;
  const probe = (fen) => {
    const g = load(Chess, onMove(fen, A));
    if (!g) return null;
    const m = playOn(g, { from: reply.from, to: reply.to, promotion: reply.promotion || "q" });
    if (!m) return null;
    if (g.in_checkmate()) return { motif: "mateThreat" };
    if (!m.captured || VALUE[m.captured] < 3) return null;
    if (checkedFromElsewhere(Chess, g.fen(), m.to)) return null;   // a discovered check, as in dHanging
    const free = !takersOf(Chess, g.fen(), m.to, other(A)).some((x) => x.captured);
    const cheap = m.piece !== "k" && VALUE[m.piece] < VALUE[m.captured];
    return free || cheap ? { motif: "hanging", piece: m.captured, by: m.piece, free } : null;
  };
  const before = probe(fenBefore);
  if (!before) return null;
  // the engine's move answered it: after it the same reply no longer works
  const gBest = load(Chess, fenBefore);
  if (!gBest || !playOn(gBest, best)) return null;
  const afterBest = probe(gBest.fen());
  if (afterBest && afterBest.motif === before.motif) return null;
  return before;
}

/** Every key lineMotif(), mateMotif() and threatOf() can return. */
export const LINE_MOTIF_KEYS = ["hanging", "perpetual", "double", "discovered", "discoveredAttack", "fork",
  "zwischenzug", "desperado", "removeDefender", "overload", "deflection", "decoy", "pin", "skewer",
  "xray", "trapped", "mateThreat", "promotion", "backRank"];
