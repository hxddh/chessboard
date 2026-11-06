/**
 * Facts v2 (v20-0-plan §4 F2): what a move did, missed and allowed, each one
 * proved on the board. Pure — positions in, records out; no engine, no text.
 * core/explain.js decides which of them an engine line confirms and which
 * one the sentence says.
 *
 *   tactical   the threat before the move (what the opponent could already
 *              win), men left loose after it (attacked and not held — the
 *              exchange on the square, played out, wins), the guard the
 *              moving man was, a defender with two jobs (overloaded), the
 *              threat a reply makes, the threat a better move makes
 *   positional isolated / doubled / backward / passed pawns, the king's pawn
 *              shelter, files opened at a king, outposts, a bishop hemmed in
 *              by its own pawns — each a count on the board, compared
 *              between two positions (after the move and after the better one)
 *   endgame    the opposition, the square of a passed pawn, a rook on the
 *              seventh, a rook behind a passed pawn
 *
 * "Loose" is decided by a static exchange on the square, played with the
 * real moves of chess.js: the cheapest legal capturer each time, either side
 * free to stop — so pins, x-rays through the square and a king that may not
 * take back are all as the rules have them.
 * @module core/facts
 */
import { Chess } from "./chess.js";

export const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const FILES = "abcdefgh";
export const other = (c) => (c === "w" ? "b" : "w");
const fileOf = (sq) => sq.charCodeAt(0) - 97;
const rankOf = (sq) => Number(sq[1]) - 1;
const sqAt = (f, r) => FILES[f] + (r + 1);
const on = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;
/** The rank counted from `color`'s side: 0 is its back rank. */
export const relRank = (sq, color) => (color === "w" ? rankOf(sq) : 7 - rankOf(sq));

export function load(fen) {
  try {
    const g = new Chess(fen);
    return g.fen().split(" ")[0] === String(fen).split(" ")[0] ? g : null;
  } catch { return null; }
}
/** `fen` with `color` on move and no en-passant square (a null move). */
export function withTurn(fen, color) {
  const p = String(fen).split(" ");
  p[1] = color;
  p[3] = "-";
  return p.join(" ");
}
/** Play `m` (SAN, UCI or a {from, to} record) on `g`; the move record or null. */
export function play(g, m) {
  if (!g || !m) return null;
  let mv = null;
  if (typeof m === "object") {
    try { mv = g.move({ from: m.from, to: m.to, promotion: m.promotion || "q" }); } catch { mv = null; }
    return mv;
  }
  try { mv = g.move(m); } catch { mv = null; }
  if (!mv && /^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) {
    try { mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || "q" }); } catch { mv = null; }
  }
  return mv;
}
/** The position after `m`, and its record; null when it will not play. */
export function after(fen, m) {
  const g = load(fen);
  const mv = play(g, m);
  return mv ? { fen: g.fen(), mv, g } : null;
}
/** square → piece */
export function gridOf(g) {
  const m = {};
  const b = g.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (b[r][f]) m[sqAt(f, 7 - r)] = b[r][f];
  return m;
}
export const kingSq = (grid, color) => Object.keys(grid).find((s) => grid[s].type === "k" && grid[s].color === color) || null;

/** Legal captures by `color` onto `sq` (whoever is on move in `fen`). */
export function capturesOn(fen, sq, color) {
  const g = load(withTurn(fen, color));
  if (!g) return [];
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return []; }
  return ms.filter((m) => m.to === sq && m.captured);
}
/**
 * Could `color` take on `sq` if the man there were the other side's? Asked
 * with a stand-in, so a pinned defender is none and a king only guards a
 * square it may step onto.
 */
export function guards(fen, sq, color) {
  const g = load(withTurn(fen, color));
  if (!g) return [];
  const here = g.get(sq);
  if (here && here.type === "k") return [];
  g.remove(sq);
  g.put({ type: "n", color: other(color) }, sq);
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return []; }
  return ms.filter((m) => m.to === sq).map((m) => ({ from: m.from, piece: m.piece }));
}

/**
 * The static exchange on `sq` for the side on move in `fen`: what it nets by
 * starting the captures there (0 when it should not start). Each capture is
 * the cheapest legal one; each side may stop when going on loses.
 */
export function see(fen, sq, depth = 0) {
  if (depth > 8) return 0;
  const g = load(fen);
  if (!g) return 0;
  const target = g.get(sq);
  if (!target || target.color === g.turn()) return 0;
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return 0; }
  const caps = ms.filter((m) => m.to === sq && m.captured).sort((a, b) => VALUE[a.piece] - VALUE[b.piece] || (a.piece === "k") - (b.piece === "k"));
  if (!caps.length) return 0;
  const m = caps.find((x) => x.piece !== "k") || caps[0];
  g.move(m);
  const gain = VALUE[m.captured] + (m.promotion ? VALUE[m.promotion] - 1 : 0) - see(g.fen(), sq, depth + 1);
  return Math.max(0, gain);
}

/**
 * The men of `color` the other side wins outright if it were on move: the
 * exchange on the square pays. [{ sq, piece, gain, free, by }] — `free` when
 * nothing of `color` guards it, `by` the cheapest taker. Kings never.
 */
export function looseMen(fen, color) {
  const probe = withTurn(fen, other(color));
  const g = load(probe);
  if (!g) return [];
  const out = [];
  const grid = gridOf(g);
  for (const sq of Object.keys(grid)) {
    const p = grid[sq];
    if (p.color !== color || p.type === "k") continue;
    const caps = capturesOn(probe, sq, other(color));
    if (!caps.length) continue;
    const gain = see(probe, sq);
    if (gain <= 0) continue;
    const by = caps.map((m) => m.piece).sort((a, b) => VALUE[a] - VALUE[b])[0];
    out.push({ sq, piece: p.type, gain, free: !guards(fen, sq, color).length, by });
  }
  return out.sort((a, b) => b.gain - a.gain || VALUE[b.piece] - VALUE[a.piece]);
}

/**
 * The most the side on move wins with one move: a mate in one, or the
 * capture whose exchange nets the most. { kind: "mate"|"material", san,
 * from, to, piece, by, gain, free } or null.
 */
export function bestShot(fen) {
  const g = load(fen);
  if (!g) return null;
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return null; }
  let best = null;
  for (const m of ms) {
    g.move(m);
    const mate = g.in_checkmate();
    g.undo();
    if (mate) return { kind: "mate", san: m.san, from: m.from, to: m.to, piece: null, by: m.piece, gain: 100 };
  }
  for (const m of ms) {
    if (!m.captured) continue;
    g.move(m);
    const back = see(g.fen(), m.to);
    const free = !capturesOn(g.fen(), m.to, g.turn()).length;
    g.undo();
    const gain = VALUE[m.captured] + (m.promotion ? VALUE[m.promotion] - 1 : 0) - back;
    if (gain > 0 && (!best || gain > best.gain || (gain === best.gain && VALUE[m.piece] < VALUE[best.by]))) {
      best = { kind: "material", san: m.san, from: m.from, to: m.to, piece: m.captured, by: m.piece, gain, free };
    }
  }
  return best;
}

/**
 * What `color` would win in `fen` if it were its move: its best shot. Null
 * when the null move is impossible (the other side is in check).
 */
export function threatOf(fen, color) {
  const g = load(fen);
  if (!g) return null;
  if (g.turn() === color) return bestShot(fen);
  // the side on move is in check: passing is not a position
  if (g.in_check()) return null;
  return bestShot(withTurn(fen, color));
}

/** Does the capture `from→to` (or mate) still work for `color` in `fen`? Its gain, or 0. */
export function shotStill(fen, shot, color) {
  if (!shot) return 0;
  const f = withTurn(fen, color);
  const g = load(f);
  if (!g) return 0;
  const m = play(g, { from: shot.from, to: shot.to, promotion: "q" });
  if (!m) return 0;
  if (shot.kind === "mate") return g.in_checkmate() ? 100 : 0;
  if (!m.captured || m.captured !== shot.piece) return 0;
  return Math.max(0, VALUE[m.captured] - see(g.fen(), m.to));
}

// --- positional facts -------------------------------------------------------------

/** Pawns by file for each colour: { w: [[ranks…] ×8], b: … } */
function pawnFiles(grid) {
  const out = { w: Array.from({ length: 8 }, () => []), b: Array.from({ length: 8 }, () => []) };
  for (const sq of Object.keys(grid)) if (grid[sq].type === "p") out[grid[sq].color][fileOf(sq)].push(rankOf(sq));
  return out;
}

/**
 * The pawn structure of `color`: isolated, doubled, backward and passed
 * pawns, by square. Backward: no own pawn beside or behind on the adjacent
 * files, and the square in front is hit by an enemy pawn.
 */
export function pawnStructure(fen, color) {
  const g = load(fen);
  if (!g) return null;
  const grid = gridOf(g);
  const pf = pawnFiles(grid);
  const mine = pf[color], theirs = pf[other(color)];
  const up = color === "w" ? 1 : -1;
  const ahead = (r, x) => (color === "w" ? x > r : x < r);
  const isolated = [], doubled = [], passed = [], backward = [];
  for (let f = 0; f < 8; f++) {
    for (const r of mine[f]) {
      const sq = sqAt(f, r);
      const nb = [f - 1, f + 1].filter((x) => x >= 0 && x < 8);
      if (!nb.some((x) => mine[x].length)) isolated.push(sq);
      if (mine[f].length > 1) doubled.push(sq);
      const blocked = [f - 1, f, f + 1].some((x) => x >= 0 && x < 8 && theirs[x].some((y) => ahead(r, y)));
      if (!blocked) passed.push(sq);
      const support = nb.some((x) => mine[x].some((y) => !ahead(r, y)));
      const front = r + up;
      const hitFront = on(f, front + up) && [f - 1, f + 1].some((x) => x >= 0 && x < 8 && theirs[x].includes(front + up));
      if (!support && nb.some((x) => mine[x].length) && hitFront && !passed.includes(sq)) backward.push(sq);
    }
  }
  return { isolated, doubled, passed, backward };
}

/**
 * The king's pawn shelter: own pawns on the king's file and the two beside
 * it, one or two ranks in front. Null while the king stands in the centre
 * (c–f files) or has left its back two ranks — there is no shelter to speak of.
 */
export function shelter(fen, color) {
  const g = load(fen);
  if (!g) return null;
  const grid = gridOf(g);
  const k = kingSq(grid, color);
  if (!k || relRank(k, color) > 1) return null;
  const kf = fileOf(k);
  if (kf >= 2 && kf <= 5) return null;
  const up = color === "w" ? 1 : -1;
  const out = [];
  for (const f of [kf - 1, kf, kf + 1]) {
    if (f < 0 || f > 7) continue;
    for (const d of [1, 2]) {
      const sq = on(f, rankOf(k) + up * d) ? sqAt(f, rankOf(k) + up * d) : null;
      if (sq && grid[sq] && grid[sq].type === "p" && grid[sq].color === color) out.push(sq);
    }
  }
  return { king: k, pawns: out, files: [kf - 1, kf, kf + 1].filter((f) => f >= 0 && f <= 7) };
}

/** Files with no pawn of `color` (half-open for its opponent's rooks), and with no pawn at all. */
export function files(fen) {
  const g = load(fen);
  if (!g) return null;
  const pf = pawnFiles(gridOf(g));
  const open = [], halfW = [], halfB = [];
  for (let f = 0; f < 8; f++) {
    if (!pf.w[f].length && !pf.b[f].length) open.push(f);
    else if (!pf.w[f].length) halfW.push(f);
    else if (!pf.b[f].length) halfB.push(f);
  }
  return { open, noW: halfW, noB: halfB };
}

/**
 * Outposts for `color`: squares on its 4th–6th ranks guarded by its own pawn
 * that no enemy pawn can ever hit (none left on the adjacent files ahead).
 */
export function outposts(fen, color) {
  const g = load(fen);
  if (!g) return [];
  const grid = gridOf(g);
  const pf = pawnFiles(grid);
  const them = pf[other(color)];
  const out = [];
  for (let f = 0; f < 8; f++) for (let r = 0; r < 8; r++) {
    const sq = sqAt(f, r);
    const rr = relRank(sq, color);
    if (rr < 3 || rr > 5) continue;
    if (grid[sq] && grid[sq].type === "p") continue;
    const back = color === "w" ? -1 : 1;
    const guarded = [f - 1, f + 1].some((x) => on(x, r + back) && grid[sqAt(x, r + back)] && grid[sqAt(x, r + back)].type === "p" && grid[sqAt(x, r + back)].color === color);
    if (!guarded) continue;
    // an enemy pawn that could still come to hit it stands ahead of it, on an adjacent file
    const ahead = (y) => (color === "w" ? y > r : y < r);
    if ([f - 1, f + 1].some((x) => x >= 0 && x < 8 && them[x].some(ahead))) continue;
    out.push(sq);
  }
  return out;
}

/** Can a knight of `color` reach `sq` in at most `n` moves (through empty or enemy squares)? */
export function knightReach(fen, sq, color, n = 2) {
  const g = load(fen);
  if (!g) return null;
  const grid = gridOf(g);
  const J = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
  let front = Object.keys(grid).filter((s) => grid[s].type === "n" && grid[s].color === color);
  const seen = new Set(front);
  for (let d = 0; d <= n; d++) {
    if (front.includes(sq)) return front.length ? d : null;
    const next = [];
    for (const s of front) for (const [df, dr] of J) {
      const f = fileOf(s) + df, r = rankOf(s) + dr;
      if (!on(f, r)) continue;
      const t = sqAt(f, r);
      if (seen.has(t) || (grid[t] && grid[t].color === color && t !== sq)) continue;
      seen.add(t);
      next.push(t);
    }
    front = next;
  }
  return null;
}

/**
 * `color`'s bishops and how many of its own pawns stand on the bishop's
 * colour: [{ sq, own, total }]. A bishop with most of its pawns on its own
 * colour is the "bad" one.
 */
export function bishops(fen, color) {
  const g = load(fen);
  if (!g) return [];
  const grid = gridOf(g);
  const shade = (sq) => (fileOf(sq) + rankOf(sq)) % 2;
  const pawns = Object.keys(grid).filter((s) => grid[s].type === "p" && grid[s].color === color);
  return Object.keys(grid).filter((s) => grid[s].type === "b" && grid[s].color === color)
    .map((sq) => ({ sq, own: pawns.filter((p) => shade(p) === shade(sq)).length, total: pawns.length }));
}

// --- endgame facts ------------------------------------------------------------------

/**
 * Do the kings stand in opposition in `fen` — same file or rank (or diagonal),
 * an odd number of squares between them — and who has it? The side *not* on
 * move has the opposition. { kind: "direct"|"distant"|"diagonal", holder } or null.
 */
export function opposition(fen) {
  const g = load(fen);
  if (!g) return null;
  const grid = gridOf(g);
  const a = kingSq(grid, "w"), b = kingSq(grid, "b");
  if (!a || !b) return null;
  const df = Math.abs(fileOf(a) - fileOf(b)), dr = Math.abs(rankOf(a) - rankOf(b));
  const holder = other(g.turn());
  if ((df === 0 && dr % 2 === 0 && dr >= 2) || (dr === 0 && df % 2 === 0 && df >= 2)) {
    return { kind: Math.max(df, dr) === 2 ? "direct" : "distant", holder };
  }
  if (df === dr && df % 2 === 0 && df >= 2) return { kind: "diagonal", holder };
  return null;
}

/**
 * The rule of the square for the passed pawn on `pawnSq`: can the defending
 * king catch it when the pawn runs alone? `toMove` is whose move it is.
 * Counts the promotion square's distance, a first-rank pawn's double step
 * included; true means the king catches it.
 */
export function caughtBySquare(pawnSq, color, kingAt, toMove) {
  const promo = sqAt(fileOf(pawnSq), color === "w" ? 7 : 0);
  let steps = Math.abs(rankOf(promo) - rankOf(pawnSq));
  if (relRank(pawnSq, color) === 1) steps -= 1;
  const kd = Math.max(Math.abs(fileOf(kingAt) - fileOf(promo)), Math.abs(rankOf(kingAt) - rankOf(promo)));
  // the pawn moves first when its side is on move
  return kd - (toMove === color ? 0 : 1) <= steps;
}

/** `color`'s rooks on its seventh rank. */
export function rooksOnSeventh(fen, color) {
  const g = load(fen);
  if (!g) return [];
  const grid = gridOf(g);
  return Object.keys(grid).filter((s) => grid[s].type === "r" && grid[s].color === color && relRank(s, color) === 6);
}

/**
 * Is a rook of `color` behind the passed pawn on `pawnSq` (same file, on the
 * side the pawn came from, nothing between)? Either colour's passer.
 */
export function rookBehind(fen, pawnSq, color) {
  const g = load(fen);
  if (!g) return false;
  const grid = gridOf(g);
  const p = grid[pawnSq];
  if (!p || p.type !== "p") return false;
  const back = p.color === "w" ? -1 : 1;
  const f = fileOf(pawnSq);
  for (let r = rankOf(pawnSq) + back; r >= 0 && r < 8; r += back) {
    const q = grid[sqAt(f, r)];
    if (!q) continue;
    return q.type === "r" && q.color === color;
  }
  return false;
}

/** The material on the board, by colour: { w: "kp", b: "k" }-like strings, sorted. */
export function materialOf(fen) {
  const g = load(fen);
  if (!g) return null;
  const out = { w: "", b: "" };
  for (const p of Object.values(gridOf(g))) out[p.color] += p.type;
  for (const c of ["w", "b"]) out[c] = out[c].split("").sort((x, y) => "kqrbnp".indexOf(x) - "kqrbnp".indexOf(y)).join("");
  return out;
}

/** Material balance from `side`'s view. */
export function balance(fen, side) {
  const g = load(fen);
  if (!g) return 0;
  let s = 0;
  for (const p of Object.values(gridOf(g))) s += (p.color === side ? 1 : -1) * VALUE[p.type];
  return s;
}

/**
 * The attackers of `color` on `sq` counted the way an exchange uses them: the
 * cheapest capturer (pins not asked, the king last), taken off the board,
 * then the next — so a queen behind its bishop on one diagonal counts twice.
 * The squares, in order.
 */
export function attackersInLine(fen, sq, color, max = 6) {
  const g = load(withTurn(fen, color));
  if (!g) return [];
  const out = [];
  for (let i = 0; i < max; i++) {
    const tgt = g.get(sq);
    if (!tgt) { g.put({ type: "p", color: other(color) }, sq); }
    else if (tgt.color === color) { g.remove(sq); g.put({ type: "p", color: other(color) }, sq); }
    let ms = [];
    // pseudo-legal, the king last: whether a king may take back depends on what is left
    try { ms = g.moves({ verbose: true, legal: false }) || []; } catch { break; }
    const rank = (m) => (m.piece === "k" ? 100 : VALUE[m.piece]);
    const caps = ms.filter((m) => m.to === sq).sort((a, b) => rank(a) - rank(b));
    if (!caps.length) break;
    out.push(caps[0].from);
    g.remove(caps[0].from);
  }
  return out;
}

/**
 * The men of the other side `color` puts under pressure: attacked more often
 * than they are defended (batteries counted), or attacked and not defended,
 * or attacked by something cheaper. [{ sq, piece, attackers: [sq…] }]
 */
export function pressure(fen, color) {
  const g = load(fen);
  if (!g) return [];
  const grid = gridOf(g);
  const out = [];
  for (const sq of Object.keys(grid)) {
    const p = grid[sq];
    if (p.color === color || p.type === "k") continue;
    const att = attackersInLine(fen, sq, color);
    if (!att.length) continue;
    const def = attackersInLine(fen, sq, other(color));
    const cheap = att.some((s) => grid[s] && grid[s].type !== "k" && VALUE[grid[s].type] < VALUE[p.type]);
    if (att.length > def.length || !def.length || cheap) out.push({ sq, piece: p.type, attackers: att });
  }
  return out;
}
