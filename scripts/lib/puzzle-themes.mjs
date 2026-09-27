/**
 * Lichess theme tags → this app's theme ids, each with a check (v8-0-plan B1).
 *
 * A Lichess tag is a label its generator attached; some are exact ("the
 * solution promotes"), some are judgement ("kingsideAttack"). The app shows a
 * theme as a claim about the chess, and a wrong claim in a teaching app
 * teaches the wrong thing (motif.js says the same about motifs). So a tag is
 * kept only when it can be *checked* on the stored line, and only after the
 * check passes: every entry below has a `verify`, tags with no entry are
 * dropped, and a tag whose check fails is dropped from that puzzle (the
 * puzzle itself stands or falls on its category's gate, not on its tags).
 *
 * The checks are geometric facts, not engine opinions:
 *   - the three mate lengths and the defence are the category gates
 *     themselves (puzzle-gate.mjs) — the importer marks them verified when
 *     the gate that proves them passed;
 *   - motifs (fork, pin, skewer, discovered check, double check) are
 *     motif.js's `motifOf` on one of the solver's moves, the same function
 *     the app labels its own puzzles with; a discovered *attack* (not check)
 *     is "a piece that did not move newly attacks something worth taking";
 *   - mate patterns look at the final position; move features (promotion,
 *     en passant, castling, …) at the solver's moves; endgame types at the
 *     men on the board.
 *
 * `ctx` is built once per puzzle by `themeContext` below. Pure: no DOM, no
 * engine, `Chess` and `motifOf` are injected.
 */

const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** Every square a piece of `color` attacks in `fen` (pseudo-legal captures). */
function attacksOf(Chess, fen, color) {
  const parts = fen.split(" ");
  parts[1] = color;
  parts[3] = "-";
  let g;
  try { g = new Chess(parts.join(" ")); } catch (_) { return []; }
  const out = [];
  for (const m of g.moves({ verbose: true })) if (m.captured) out.push({ from: m.from, to: m.to, captured: m.captured });
  return out;
}

/** squares next to `sq` that are on the board */
function around(sq) {
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]);
  const out = [];
  for (let df = -1; df <= 1; df++) for (let dr = -1; dr <= 1; dr++) {
    if (!df && !dr) continue;
    const nf = f + df, nr = r + dr;
    if (nf >= 0 && nf < 8 && nr >= 1 && nr <= 8) out.push(String.fromCharCode(97 + nf) + nr);
  }
  return out;
}

function kingSquare(g, color) {
  for (const row of g.board()) for (const q of row) if (q && q.type === "k" && q.color === color) return q.square;
  return null;
}

/** pieces giving check to `color`'s king in `g` (the side to move is in check) */
function checkers(Chess, g, color) {
  const k = kingSquare(g, color);
  if (!k) return [];
  // a king can never be captured, so ask for the attacks with the king
  // swapped for a queen of its own colour: every attacker of that square
  const parts = g.fen().split(" ");
  const rows = parts[0].split("/");
  const f = k.charCodeAt(0) - 97, r = 8 - Number(k[1]);
  const cells = [];
  for (const ch of rows[r]) { if (/\d/.test(ch)) for (let i = 0; i < Number(ch); i++) cells.push("1"); else cells.push(ch); }
  cells[f] = color === "w" ? "Q" : "q";
  rows[r] = cells.join("").replace(/1+/g, (m) => String(m.length));
  parts[0] = rows.join("/");
  const them = color === "w" ? "b" : "w";
  return attacksOf(Chess, parts.join(" "), them).filter((a) => a.to === k).map((a) => a.from);
}

/** the men on the board, by colour and type */
function menOf(g) {
  const men = { w: {}, b: {} };
  for (const row of g.board()) for (const q of row) if (q) men[q.color][q.type] = (men[q.color][q.type] || 0) + 1;
  return men;
}

/**
 * Everything the checks read, computed once: the solver's colour, each ply
 * of the line as a verbose move with the position before it, and the final
 * position.
 */
export function themeContext(Chess, fen, solution) {
  const g = new Chess(fen);
  const solver = g.turn();
  const plies = [];
  for (const san of solution) {
    const before = g.fen();
    const m = g.move(san);
    if (!m) return null;
    plies.push({ before, after: g.fen(), m, solver: m.color === solver });
  }
  return { Chess, fen, solution, solver, plies, start: new Chess(fen), end: g };
}

const solverMoves = (c) => c.plies.filter((p) => p.solver);

/** the final position is mate, delivered by the solver: [king square, checker squares] */
function finalMate(c) {
  if (!c.end.in_checkmate()) return null;
  const loser = c.solver === "w" ? "b" : "w";
  return { king: kingSquare(c.end, loser), by: checkers(c.Chess, c.end, loser), loser };
}

/** motif.js on any solver move */
const hasMotif = (key) => (c, motifOf) => solverMoves(c).some((p) => motifOf(p.before, p.m.san, c.Chess) === key);

/** an endgame made only of `types` (+ kings, pawns), with each named type on the board */
const ending = (types) => (c) => {
  const men = menOf(c.start);
  const allowed = new Set(["k", "p"].concat(types));
  for (const col of ["w", "b"]) for (const t of Object.keys(men[col])) if (!allowed.has(t)) return false;
  return types.every((t) => (men.w[t] || 0) + (men.b[t] || 0) > 0);
};

/**
 * Ordered rarest first: a row's *first* verified theme in this order is the
 * cell it is counted under when the importer stratifies (so a smothered mate
 * in two fills the smothered cell, not the much larger mate-in-two one).
 * `id` is the app's name; the motif keys are motif.js's MOTIF_KEYS.
 */
export const THEMES = [
  { tag: "underPromotion", id: "underPromotion", verify: (c) => solverMoves(c).some((p) => p.m.promotion && p.m.promotion !== "q") },
  { tag: "enPassant", id: "enPassant", verify: (c) => solverMoves(c).some((p) => p.m.flags.includes("e")) },
  { tag: "castling", id: "castling", verify: (c) => solverMoves(c).some((p) => /[kq]/.test(p.m.flags)) },
  { tag: "smotheredMate", id: "smothered", verify: (c) => {
    const f = finalMate(c);
    if (!f || f.by.length !== 1 || c.end.get(f.by[0]).type !== "n") return false;
    return around(f.king).every((sq) => { const q = c.end.get(sq); return q && q.color === f.loser; });
  } },
  { tag: "arabianMate", id: "arabian", verify: (c) => {
    const f = finalMate(c);
    if (!f || f.by.length !== 1 || !/^[ah][18]$/.test(f.king)) return false;
    const rook = f.by[0];
    if (c.end.get(rook).type !== "r" || !around(f.king).includes(rook)) return false;
    // the rook is guarded by a knight of the solver's
    return knightGuards(c, rook);
  } },
  { tag: "doubleCheck", id: "double", verify: hasMotif("double") },
  { tag: "backRankMate", id: "backRank", verify: (c) => {
    const f = finalMate(c);
    if (!f || f.by.length !== 1) return false;
    const home = f.loser === "w" ? "1" : "8";
    const by = c.end.get(f.by[0]);
    return f.king[1] === home && f.by[0][1] === home && (by.type === "r" || by.type === "q");
  } },
  { tag: "attackingF2F7", id: "f2f7", verify: (c) => solverMoves(c).some((p) => p.m.captured && p.m.to === (c.solver === "w" ? "f7" : "f2")) },
  { tag: "promotion", id: "promotion", verify: (c) => solverMoves(c).some((p) => !!p.m.promotion) },
  { tag: "knightEndgame", id: "knightEnding", verify: ending(["n"]) },
  { tag: "bishopEndgame", id: "bishopEnding", verify: ending(["b"]) },
  { tag: "queenEndgame", id: "queenEnding", verify: ending(["q"]) },
  { tag: "queenRookEndgame", id: "queenRookEnding", verify: ending(["q", "r"]) },
  { tag: "pawnEndgame", id: "pawnEnding", verify: (c) => ending([])(c) && Object.keys(menOf(c.start).w).concat(Object.keys(menOf(c.start).b)).includes("p") },
  { tag: "rookEndgame", id: "rookEnding", verify: ending(["r"]) },
  { tag: "skewer", id: "skewer", verify: hasMotif("skewer") },
  { tag: "discoveredAttack", id: "discovered", verify: (c, motifOf) => hasMotif("discovered")(c, motifOf) || solverMoves(c).some((p) => discovers(c, p)) },
  { tag: "pin", id: "pin", verify: hasMotif("pin") },
  { tag: "sacrifice", id: "sacrifice", verify: (c) => c.plies.some((p, i) => {
    // the solver's man is taken on the square it just moved to, and it was
    // worth more than whatever it took getting there
    const next = c.plies[i + 1];
    return p.solver && next && next.m.captured && next.m.to === p.m.to &&
      VAL[p.m.promotion || p.m.piece] > (p.m.captured ? VAL[p.m.captured] : 0);
  }) },
  { tag: "quietMove", id: "quiet", verify: (c) => solverMoves(c).some((p) => !p.m.captured && !p.m.promotion && !/[+#]/.test(p.m.san)) },
  { tag: "advancedPawn", id: "advancedPawn", verify: (c) => solverMoves(c).some((p) => p.m.piece === "p" &&
    (c.solver === "w" ? Number(p.m.to[1]) >= 6 : Number(p.m.to[1]) <= 3)) },
  { tag: "defensiveMove", id: "def", verify: (c, _m, gated) => gated === "def" },
  { tag: "hangingPiece", id: "hanging", verify: (c) => {
    // the first move takes a man that nothing guards
    const p = solverMoves(c)[0];
    if (!p || !p.m.captured || VAL[p.m.captured] < 1) return false;
    const g = new c.Chess(p.after);
    return !g.moves({ verbose: true }).some((r) => r.to === p.m.to);
  } },
  { tag: "mateIn3", id: "m3", verify: (c, _m, gated) => gated === "m3" },
  { tag: "mateIn2", id: "m2", verify: (c, _m, gated) => gated === "m2" },
  { tag: "fork", id: "fork", verify: hasMotif("fork") },
  { tag: "mateIn1", id: "m1", verify: (c, _m, gated) => gated === "m1" },
];

/** does a knight of the solver's guard `sq` in the final position? */
function knightGuards(c, sq) {
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]);
  for (const [df, dr] of [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]]) {
    const nf = f + df, nr = r + dr;
    if (nf < 0 || nf > 7 || nr < 1 || nr > 8) continue;
    const q = c.end.get(String.fromCharCode(97 + nf) + nr);
    if (q && q.type === "n" && q.color === c.solver) return true;
  }
  return false;
}

/**
 * A discovered attack: after the move, a solver's man that did NOT move
 * attacks an enemy king, or a man worth ≥ 3, that it did not attack before.
 * Only the mover's departure can open such a line (a capture on the arrival
 * square closes lines, never opens them), so this is a discovery.
 */
function discovers(c, p) {
  const worth = (a) => a.captured === "k" || VAL[a.captured] >= 3;
  const key = (a) => a.from + a.to;
  const before = new Set(attacksOf(c.Chess, p.before, c.solver).filter(worth).map(key));
  const after = attacksOf(c.Chess, p.after, c.solver).filter((a) => worth(a) && a.from !== p.m.to);
  // chess.js does not list king "captures"; a discovered check shows as check
  const them = c.solver === "w" ? "b" : "w";
  const g = new c.Chess(p.after);
  if (g.in_check() && checkers(c.Chess, g, them).some((sq) => sq !== p.m.to)) return true;
  return after.some((a) => !before.has(key(a)));
}

export const THEME_IDS = THEMES.map((t) => t.id);
const BY_TAG = new Map(THEMES.map((t) => [t.tag, t]));

/** The Lichess tags on a row this module can check, in THEMES order (rarest first). */
export function checkableTags(themes) {
  const set = new Set(String(themes || "").trim().split(/\s+/));
  return THEMES.filter((t) => set.has(t.tag));
}

/**
 * The verified app theme ids for one puzzle, in THEMES order.
 * @param {object} ctx from themeContext
 * @param {string} tags the row's Lichess Themes column
 * @param {Function} motifOf motif.js
 * @param {string} gatedCat the category whose gate the puzzle passed
 * @returns {{ids:string[], dropped:string[]}} dropped: tags whose check failed
 */
export function verifyThemes(ctx, tags, motifOf, gatedCat) {
  const ids = [], dropped = [];
  for (const t of checkableTags(tags)) {
    let ok = false;
    try { ok = !!t.verify(ctx, motifOf, gatedCat); } catch (_) { ok = false; }
    (ok ? ids : dropped).push(ok ? t.id : t.tag);
  }
  return { ids, dropped };
}

export { BY_TAG };
