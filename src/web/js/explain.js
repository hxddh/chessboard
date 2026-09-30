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
import { lineMotif, mateMotif, threatOf } from "./motif.js";

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/**
 * How many plies of the engine line the material count may walk. Four is
 * two full exchanges: enough for 「捉双，吃车，被吃回一个马」, short enough
 * that the tail of a 200 ms line — the least certain part — is not read.
 */
export const LOSS_PLIES = 4;

/**
 * v8-1-plan T6: motifs that are not named. B3's rule — a motif whose sampled
 * error rate is above 5% falls back to saying only what the line wins
 * (「对方 X 之后丢 Y」) or which move was better, exactly as when no motif is
 * proved. The rates, 22–25 real-game cases per motif judged against a
 * search 3.7 times deeper, are docs/measured.json `motifPrecision`
 * (scripts/sample-motifs.mjs); the cases are docs/motif-audit-8.1.md.
 *
 *   - perpetual: 3 of 25 wrong — the drawing line the deep search finds is
 *     not all checks, or it is not a draw at all;
 *   - trapped: 3 of 25 wrong — each a queen pinned to its king, not trapped
 *     (motif.js dTrapped asks whether every square loses the man, and a
 *     pinned man's few legal moves all do).
 */
export const MATERIAL_ONLY = ["perpetual", "trapped"];
/** A motif record the sentence may name, or null. */
const said = (m) => (m && m.motif && !MATERIAL_ONLY.includes(m.motif) ? m : null);

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
  const mine = [], theirs = [];
  for (let i = 0; i < n; i++) {
    const m = play(g, sans[i]);
    if (!m) return null;
    if (m.captured) (m.color !== side ? mine : theirs).push(m.captured);
  }
  // A trade is not a loss: 「♕xd6 ♛xd6 ♗xd6」 takes a queen each and a
  // bishop, and the man lost is the bishop — the 8.0 audit caught 「丢后」
  // there (v8-0-plan B3). Men of equal value taken on both sides cancel,
  // and what is named is the most valuable of the mover's men left over.
  for (const t of theirs) {
    const i = mine.findIndex((x) => VALUE[x] === VALUE[t]);
    if (i >= 0) mine.splice(i, 1);
  }
  const top = mine.sort((a, b) => VALUE[b] - VALUE[a])[0] || null;
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
 * The facts about one mistake.
 *
 * @param {object} x
 * @param {string} x.fen        position before the mistake
 * @param {string} x.played     the move played (SAN)
 * @param {string} x.best       the engine's best move there (UCI or SAN)
 * @param {string|string[]} [x.bestLine] the engine line from `fen` (SAN), starting with `best`
 * @param {string|string[]} [x.line]     the engine line after the mistake (SAN)
 * @param {number} [x.evalBefore] the pass's evaluation before the mistake (app evalScalar, White's view)
 * @param {number} [x.evalAfter]  … and after it — only a perpetual reads them
 * @param {Function} Chess      the rules engine (injected)
 * @returns {null|{side: string, played: string,
 *   refute: null|{san: string, motif: string|null, piece: string|null, shape: boolean,
 *     mate: number|null, mateMotif: string|null, hits: string[]},
 *   lost: null|{piece: string, net: number},
 *   better: null|{san: string, motif: string|null, piece: string|null, mate: number|null, mateMotif: string|null},
 *   threat?: {san: string, motif: string, piece: string|null}}}
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
    // v8-0-plan B3: the motif is the one the line proves (motif.js
    // lineMotif), not the geometry of its first move alone
    const credit = (mv.captured ? VALUE[mv.captured] : 0) + (mv.promotion ? VALUE[mv.promotion] - 1 : 0);
    const lm = said(lineMotif(afterPlayed, line, Chess, { credit, played: mv, evalBefore: x.evalBefore, evalAfter: x.evalAfter }));
    const mate = mateAlong(new Chess(afterPlayed), line);
    const mm = mate ? said({ motif: mateMotif(afterPlayed, line, Chess) }) : null;
    out.refute = { san: first.san, motif: lm ? lm.motif : null, piece: (lm && lm.piece) || null,
      by: (lm && lm.by) || null, free: !!(lm && lm.free), shape: !!(lm && lm.shape), mate, mateMotif: mm ? mm.motif : null,
      hits: lm && lm.motif === "fork" ? lm.hits || forkHits(Chess, afterPlayed, first) : [] };
  }

  // --- 3: the better move ------------------------------------------------
  const b = x.best ? play(new Chess(x.fen), x.best) : null;
  if (b && b.san !== mv.san) {
    const bl = sansOf(x.bestLine);
    // the line has to start with the move it explains, or it is some other line
    const head = bl.length ? play(new Chess(x.fen), bl[0]) : null;
    const bLine = head && head.san === b.san ? bl : [b.san];
    const lm = said(lineMotif(x.fen, bLine, Chess));
    const mate = mateAlong(new Chess(x.fen), bLine);
    const mm = mate ? said({ motif: mateMotif(x.fen, bLine, Chess) }) : null;
    out.better = { san: b.san, motif: lm ? lm.motif : null, piece: (lm && lm.piece) || null,
      by: (lm && lm.by) || null, free: !!(lm && lm.free), mate, mateMotif: mm ? mm.motif : null };
  }

  // --- 4: a threat the mistake ignored (v8-0-plan B3 §4) ------------------
  if (first && b && b.san !== mv.san) {
    const th = said(threatOf(x.fen, first, b.san, Chess));
    // the same reply has to be what actually happens after the mistake:
    // a mate it delivers, or the man it takes staying taken
    if (th && ((th.motif === "mateThreat" && out.refute.mate === 1) ||
      (th.motif === "hanging" && out.refute.motif === "hanging" && out.refute.piece === th.piece))) {
      out.threat = { san: first.san, motif: th.motif, piece: th.piece || null, by: th.by || null, free: !!th.free };
    }
  }
  return out;
}

/**
 * The template key that says the most certain thing, and its arguments.
 *
 * Order (v8-0-plan B3): a mate on the board; a threat the mistake ignored
 * (the same reply already worked before it); a perpetual; a man left
 * hanging; any other motif the line proves, with what it wins; the loss
 * alone; the better move, with its motif when its own line proves one.
 */
function pick(ex) {
  const them = ex.side === "w" ? "b" : "w";
  const me = ex.side;
  const b = ex.better, r = ex.refute, l = ex.lost, th = ex.threat;
  const san = (s, c) => ({ san: s, color: c });
  const mm = (x) => (x.mateMotif ? { motif: x.mateMotif } : null);
  if (b && b.mate === 1) return b.mateMotif ? ["ex.mate1Motif", [san(b.san, me), mm(b)]] : ["ex.mate1", [san(b.san, me)]];
  if (b && b.mate) {
    return b.mateMotif ? ["ex.mateNMotif", [san(b.san, me), String(b.mate), mm(b)]] : ["ex.mateN", [san(b.san, me), String(b.mate)]];
  }
  if (th && th.motif === "mateThreat") return ["ex.threatMate", [san(th.san, them)]];
  if (r && r.mate === 1) return r.mateMotif ? ["ex.allowsMate1Motif", [san(r.san, them), mm(r)]] : ["ex.allowsMate1", [san(r.san, them)]];
  if (r && r.mate) {
    return r.mateMotif ? ["ex.allowsMateMotif", [san(r.san, them), String(r.mate), mm(r)]]
      : ["ex.allowsMate", [san(r.san, them), String(r.mate)]];
  }
  // a man taken for nothing, or taken by a cheaper one: two sentences, since
  // 「没有保护住」 is false of a man that was guarded and still lost
  const took = (x, free, cheap, key) => (x.free ? [free, [san(x.san, key), { piece: x.piece }]]
    : [cheap, [san(x.san, key), { piece: x.piece }, { piece: x.by }]]);
  if (th && th.motif === "hanging") return took(th, "ex.threatHanging", "ex.threatCheap", them);
  if (r && r.motif === "perpetual") return ["ex.perpetual", [san(r.san, them)]];
  if (r && r.motif === "hanging") return took(r, "ex.hanging", "ex.hangingCheap", them);
  if (r && r.motif && !r.shape && l) return ["ex.motifLoss", [san(r.san, them), { motif: r.motif }, { piece: l.piece }]];
  // no loss inside the line, but a fork is a fact about what it attacks: the
  // engine may well answer 10…Nd4 rather than take the rook, and still the
  // knight on c2 stood on king and rook at once
  if (r && r.motif === "fork" && r.hits.length >= 2) {
    return ["ex.forkHits", [san(r.san, them), { motif: r.motif }, { piece: r.hits[0] }, { piece: r.hits[1] }]];
  }
  if (r && r.motif && !r.shape) return ["ex.motif", [san(r.san, them), { motif: r.motif }]];
  if (r && l) return ["ex.loss", [san(r.san, them), { piece: l.piece }]];
  if (b && b.motif === "hanging") return took(b, "ex.betterHanging", "ex.betterCheap", me);
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
 * The motif the sentence names, or null — what the coverage measurement
 * (scripts/test-coach.mjs) counts: a motif the record holds but the
 * sentence does not say (a mate outranked it) is not one the learner read.
 */
export function explainMotif(ex) {
  const p = ex && pick(ex);
  if (!p) return null;
  if (p[0] === "ex.threatMate") return "mateThreat";
  if (/^ex\.(threat|better)?(Hanging|Cheap|hanging|hangingCheap)$/.test(p[0])) return "hanging";
  if (p[0] === "ex.perpetual") return "perpetual";
  const m = p[1].find((a) => a && a.motif);
  return m ? m.motif : null;
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

export const ChessExplain = { MATERIAL_ONLY, explainMistake, explainParts, explainText, explainKey, explainMotif, figurine, retryQuick, lineAfter, LOSS_PLIES };
