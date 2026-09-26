/**
 * Why was this move a mistake? — one line, from facts only (v7-8-plan §3).
 *
 * The report used to say where a game turned and by how much, never why:
 * 「关键一步：第 9 回合 白方 走 a3，胜率掉了 16 个百分点」. What a learner
 * needs next is the reason — 9. a3 walks into …Nxc2+, a knight hitting king
 * and rook at once — and the analysis pass already holds every fact that
 * sentence is made of: the engine's line after the mistake (whose first move
 * is the refutation), the engine's own choice before it, and motif.js, which
 * names a tactic only when the geometry proves it.
 *
 * **Nothing here guesses.** Three facts, each checked on the board:
 *
 *   1. the refutation — the first move of the engine line after the mistake,
 *      with its motif when motif.js is sure of one;
 *   2. the material — played out along that line for an even number of plies
 *      (so a capture is always followed by the reply that could recapture
 *      it), what the mover is down net, and the most valuable man taken;
 *   3. the better move — the engine's best before the mistake, and whether
 *      its line mates (a checkmate on the board, not a score) or it is itself
 *      a motif.
 *
 * Where none of them says anything, the sentence is only 「更好的是 X」.
 * A motif name appears only when motif.js returned one — the 7.6 rule about
 * categories without a basis applies to reasons too.
 *
 * Pure: positions and lines in, a record and a sentence out. No DOM, no
 * engine, no dictionary of its own — the caller hands in `t` (key → template).
 *
 * @module explain
 */
import { motifOf } from "./motif.js";

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * How many plies of the engine line the material count may walk. Four is
 * two full exchanges: enough for 「捉双，吃车，被吃回一个马」, short enough
 * that the tail of a 200 ms line — the least certain part — is not read.
 */
export const LOSS_PLIES = 4;

/** Material from `side`'s point of view: its men minus the other side's. */
function balance(g, side) {
  let s = 0;
  for (const row of g.board()) {
    for (const p of row) if (p) s += (p.color === side ? 1 : -1) * VALUE[p.type];
  }
  return s;
}

/** A SAN line as an array, whatever shape it came in. */
function sansOf(line) {
  if (Array.isArray(line)) return line.filter((s) => typeof s === "string" && s);
  if (typeof line === "string") return line.split(/\s+/).filter(Boolean);
  return [];
}

/** Play `m` (SAN or UCI) on `g`; the move record or null. */
function play(g, m) {
  if (!m) return null;
  let mv = null;
  try { mv = g.move(m); } catch (_) { mv = null; }
  if (mv) return mv;
  if (/^[a-h][1-8][a-h][1-8][qrbn]?$/.test(m)) {
    try { mv = g.move({ from: m.slice(0, 2), to: m.slice(2, 4), promotion: m[4] || "q" }); } catch (_) { mv = null; }
  }
  return mv;
}

/**
 * Plays `sans` from `g` (mutating it); the number of moves until checkmate
 * for the side that starts, or null when the line does not mate on the board.
 */
function mateAlong(g, sans) {
  for (let i = 0; i < sans.length; i++) {
    if (!play(g, sans[i])) return null;
    if (g.in_checkmate()) return i % 2 === 0 ? i / 2 + 1 : null;
  }
  return null;
}

/**
 * Walks `sans` from `fen` for exactly LOSS_PLIES plies — an even number, so
 * a capture is always followed by the move that could take back. Returns
 * the material balance at the end from `side`'s view, and the most valuable
 * of `side`'s men taken on the way — or null when the line is shorter than
 * that or does not play on this board.
 */
function along(Chess, fen, sans, side) {
  // the whole window or nothing: 「♞xc2+ ♔d1」 alone says 「丢兵」 about a
  // move that wins a rook one ply later
  const n = LOSS_PLIES;
  if (sans.length < n) return null;
  const g = new Chess(fen);
  let top = null;
  for (let i = 0; i < n; i++) {
    const m = play(g, sans[i]);
    if (!m) return null;
    if (m.color !== side && m.captured && (!top || VALUE[m.captured] > VALUE[top])) top = m.captured;
  }
  return { bal: balance(g, side), top };
}

/**
 * What the forking piece stands on: the mover's men it attacks that are worth
 * a fork (a minor piece or more), and the king when it gives check — the two
 * tests motif.js used to call it a fork, read back as names, most valuable
 * first. (A fork that checks is never a discovered one: motif.js answers
 * "discovered" before it asks about forks.)
 */
function forkHits(Chess, fenBefore, mv) {
  const g = new Chess(fenBefore);
  if (!play(g, mv.san)) return [];
  const parts = g.fen().split(" ");
  parts[1] = mv.color;               // ask the forker's moves from where it now stands
  parts[3] = "-";
  let moves = [];
  try { moves = new Chess(parts.join(" ")).moves({ square: mv.to, verbose: true }) || []; } catch (_) { return []; }
  const hits = g.in_check() ? ["k"] : [];
  for (const m of moves) {
    const p = g.get(m.to);
    if (p && p.color !== mv.color && p.type !== "k" && VALUE[p.type] >= 3 && !hits.includes(p.type)) hits.push(p.type);
  }
  const rank = (t) => (t === "k" ? 100 : VALUE[t]);
  return hits.sort((a, b) => rank(b) - rank(a));
}

/**
 * motif.js, with one more condition on two of its answers. A fork, a double
 * check and a discovered check are facts of the position after the move. A
 * pin or a skewer, as motif.js finds them, is only a line piece with two
 * enemy men behind each other on its ray — 3. Bb5 in the Ruy Lopez passes
 * that test (knight on c6, pawn on d7). Those two are named only when the
 * engine line actually wins material; otherwise the reason is not proven.
 */
function sure(motif, wonMaterial) {
  if (motif === "pin" || motif === "skewer") return wonMaterial ? motif : null;
  return motif;
}

/**
 * The facts about one mistake.
 *
 * @param {object} x
 * @param {string} x.fen        position before the mistake
 * @param {string} x.played     the move played (SAN)
 * @param {string} x.best       the engine's best move there (UCI or SAN)
 * @param {string|string[]} [x.bestLine] the engine line from `fen` (SAN), starting with `best`
 * @param {string|string[]} [x.line]     the engine line after the mistake (SAN)
 * @param {Function} Chess      the rules engine (injected)
 * @returns {null|{side: string, played: string,
 *   refute: null|{san: string, motif: string|null, mate: number|null, hits: string[]},
 *   lost: null|{piece: string, net: number},
 *   better: null|{san: string, motif: string|null, mate: number|null}}}
 */
export function explainMistake(x, Chess) {
  if (!x || !x.fen || !x.played) return null;
  let g;
  try { g = new Chess(x.fen); } catch (_) { return null; }
  if (!g || !g.fen()) return null;
  const side = g.turn();
  const start = balance(g, side);
  const mv = play(g, x.played);
  if (!mv) return null;
  const afterPlayed = g.fen();
  const out = { side, played: mv.san, refute: null, lost: null, better: null };

  // --- 1 + 2: the refutation, and what the line after it wins ------------
  const line = sansOf(x.line);
  const after = along(Chess, afterPlayed, line, side);
  if (after && start - after.bal >= 1 && after.top) out.lost = { piece: after.top, net: start - after.bal };
  const first = line.length ? play(new Chess(afterPlayed), line[0]) : null;
  if (first) {
    const motif = sure(motifOf(afterPlayed, first.san, Chess), !!out.lost);
    out.refute = { san: first.san, motif, mate: mateAlong(new Chess(afterPlayed), line),
      hits: motif === "fork" ? forkHits(Chess, afterPlayed, first) : [] };
  }

  // --- 3: the better move ------------------------------------------------
  const b = x.best ? play(new Chess(x.fen), x.best) : null;
  if (b && b.san !== mv.san) {
    const bl = sansOf(x.bestLine);
    // the line has to start with the move it explains, or it is some other line
    const head = bl.length ? play(new Chess(x.fen), bl[0]) : null;
    const bLine = head && head.san === b.san ? bl : [b.san];
    const won = along(Chess, x.fen, bLine, side);
    out.better = { san: b.san, motif: sure(motifOf(x.fen, b.san, Chess), !!won && won.bal - start >= 1),
      mate: mateAlong(new Chess(x.fen), bLine) };
  }
  return out;
}

/** The template key that says the most certain thing, and its arguments. */
function pick(ex) {
  const them = ex.side === "w" ? "b" : "w";
  const me = ex.side;
  const b = ex.better, r = ex.refute, l = ex.lost;
  const san = (s, c) => ({ san: s, color: c });
  if (b && b.mate === 1) return ["ex.mate1", [san(b.san, me)]];
  if (b && b.mate) return ["ex.mateN", [san(b.san, me), String(b.mate)]];
  if (r && r.mate === 1) return ["ex.allowsMate1", [san(r.san, them)]];
  if (r && r.mate) return ["ex.allowsMate", [san(r.san, them), String(r.mate)]];
  if (r && r.motif && l) return ["ex.motifLoss", [san(r.san, them), { motif: r.motif }, { piece: l.piece }]];
  // no loss inside the line, but a fork is a fact about what it attacks: the
  // engine may well answer 10…Nd4 rather than take the rook, and still the
  // knight on c2 stood on king and rook at once
  if (r && r.motif === "fork" && r.hits.length >= 2) {
    return ["ex.forkHits", [san(r.san, them), { motif: r.motif }, { piece: r.hits[0] }, { piece: r.hits[1] }]];
  }
  if (r && r.motif) return ["ex.motif", [san(r.san, them), { motif: r.motif }]];
  if (r && l) return ["ex.loss", [san(r.san, them), { piece: l.piece }]];
  if (b && b.motif) return ["ex.betterMotif", [san(b.san, me), { motif: b.motif }]];
  if (b) return ["ex.better", [san(b.san, me)]];
  return null;
}

/**
 * The sentence, as parts: strings, and `{san, color}` for each move so the
 * caller can draw it the way the move list draws moves.
 *
 * @param {object} ex        what explainMistake() returned
 * @param {function(string): string} t  key → template (`{0}`, `{1}`…)
 * @returns {Array<string|{san: string, color: string}>}
 */
export function explainParts(ex, t) {
  const p = ex && pick(ex);
  if (!p) return [];
  const [key, args] = p;
  const tpl = t(key);
  const out = [];
  const push = (s) => {
    if (!s) return;
    if (typeof s === "string" && typeof out[out.length - 1] === "string") out[out.length - 1] += s;
    else out.push(s);
  };
  const re = /\{(\d)\}/g;
  let at = 0, m;
  while ((m = re.exec(tpl))) {
    push(tpl.slice(at, m.index));
    const a = args[Number(m[1])];
    if (a && a.san) push(a);
    else if (a && a.motif) push(t("motif." + a.motif));
    else if (a && a.piece) push(t("piece." + a.piece));
    else if (a != null) push(String(a));
    at = m.index + m[0].length;
  }
  push(tpl.slice(at));
  return out;
}

/** Figurines, hollow for White and solid for Black. */
const FIG = {
  w: { K: "♔", Q: "♕", R: "♖", B: "♗", N: "♘" },
  b: { K: "♚", Q: "♛", R: "♜", B: "♝", N: "♞" },
};

/** A move as text: `Nxc2+` by Black is 「♞xc2+」. */
export function figurine(san, color) {
  const f = FIG[color] && FIG[color][san[0]];
  return f ? f + san.slice(1) : san;
}

/** The sentence as plain text — for a title, a toast, a test. */
export function explainText(ex, t) {
  return explainParts(ex, t).map((p) => (typeof p === "string" ? p : figurine(p.san, p.color))).join("");
}

/**
 * The key the sentence is built from — for a caller (or a test) that needs to
 * know which fact carried it without parsing a translation.
 */
export function explainKey(ex) {
  const p = ex && pick(ex);
  return p ? p[0] : null;
}

/**
 * The engine line after ply `i`, as long as the analysis can make it.
 *
 * A quick pass keeps short lines — the walk-through game's line after 9. a3
 * came back as 「♞xc2+ ♔d1」, two plies, which stops one move before the
 * rook goes. But where the game itself went down that line, the pass also
 * searched the positions it reached: `pvs[j + 1]` is the engine's line after
 * the game's ply j. So while the game's moves agree with the line, the line
 * is continued by the engine's own line from the next position. Every move
 * in the result is either the engine's or the game's and the engine's at
 * once — nothing is extended by guessing.
 *
 * @param {Array<string|null>} pvs  the pass's lines, SAN, one per position
 * @param {string[]} sans           the game's moves
 * @param {number} i                the mistake's ply
 * @param {number} [want]           stop once the line is this long
 * @returns {string[]}
 */
export function lineAfter(pvs, sans, i, want = LOSS_PLIES) {
  let line = sansOf(pvs && pvs[i + 1]);
  for (let k = 0; line.length < want && k < line.length; k++) {
    const j = i + 1 + k;              // the game's ply this move of the line is
    if (sans[j] !== line[k]) break;   // the game left the line: stop here
    const next = sansOf(pvs[j + 1]);
    if (next.length > line.length - k - 1) line = sans.slice(i + 1, j + 1).concat(next);
  }
  return line;
}

/**
 * 再试一次, the part that needs no engine: the mistake again is wrong, the
 * engine's own choice is right, anything else is "ask the engine" (null) —
 * and the engine's answer is judged by Mistakes.judgeAlt, the rule the
 * personal drills already use.
 *
 * @param {string} san      the move tried (SAN)
 * @param {{played: string, better: ?{san: string}}} ex
 * @returns {"right"|"wrong"|null}
 */
export function retryQuick(san, ex) {
  if (!ex || !san) return null;
  if (san === ex.played) return "wrong";
  if (ex.better && san === ex.better.san) return "right";
  return null;
}

export const ChessExplain = { explainMistake, explainParts, explainText, explainKey, figurine, retryQuick, lineAfter, LOSS_PLIES };
