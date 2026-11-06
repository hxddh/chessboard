/**
 * 「你这一步」 — one explainer for every piece of feedback (v20-0-plan §4 F1).
 *
 *   explainMove(position, move, context) → { facts, key, args, arrows, kind, … }
 *   explainText(result, t)               → the sentence (zh today; the keys are the same in every language)
 *
 * Every answer says something about *this* move: what it did, what it missed
 * (the threat already on the board before it, the men it left loose, the
 * guard it was), what the opponent does next (drawn on the board as arrows),
 * and — only where the engine evaluation also moved clearly — what it did to
 * the pawns, the king's shelter, the files and squares. Each fact is proved
 * on the board (core/facts.js, and the 19.0 motif detectors, reused); an
 * engine line, where the caller has one, confirms the ones that are about
 * what happens next. The sentence is a template; nothing is guessed.
 *
 * `context` (all optional):
 *   kind        "review" | "coach" | "retry" | "lesson" | "endgame" | "classic" | "opening"
 *   best        the engine's move in `position` (UCI or SAN); bestLine: its line (SAN)
 *   line        the engine line after `move` (SAN), its first move the opponent's reply
 *   evalBefore, evalAfter  the pass's scalars (White's view) — the positional gate reads them
 *   human       a humanMoves() distribution for `position` [{ move (UCI), p }]; rating: whose
 *   goal        a lesson's goal (goals.js) or an endgame drill's ("win" | "draw" | "promote")
 *   expected    the move the item wanted (a lesson's answer, the master's move)
 *   book        an opening drill's move(s) here, most common first (SAN)
 *
 * The 19.0 module (src/web/js/explain.js, motif.js) stays the source of the
 * tactical motifs; its exports are passed through for the callers that
 * still use them directly.
 * @module core/explain
 */
import { Chess } from "./chess.js";
import { explainMistake as explain19, explainParts as parts19, explainKey as key19, explainMotif as motif19, figurine, lineAfter, retryQuick, LOSS_PLIES }
  from "../../web/js/explain.js";
import { lineMotif as lineMotif19, threatOf as threatOf19 } from "../../web/js/motif.js";
import { winPctDrop, WIN_MISTAKE } from "./winpct.js";
import * as F from "./facts.js";
import { kpk } from "./facts-kpk.js";

export { figurine, lineAfter, retryQuick };
const { VALUE, other, load, play, after: afterMove } = F;

/** A move as the app prints it, for now its SAN (the font has no chess glyphs yet). */
export const sanText = (san) => san;
/** @see src/web/js/explain.js explainMistake — the 19.0 facts, still the tactical core */
export const explainMistake = (x) => explain19(x, Chess);
/** @see src/web/js/motif.js lineMotif */
export const lineMotif = (fen, sans, opts) => lineMotif19(fen, sans, Chess, opts);
/** @see src/web/js/motif.js threatOf */
export const threatOf = (fenBefore, reply, best) => threatOf19(fenBefore, reply, best, Chess);

const sansOf = (line) => (Array.isArray(line) ? line.filter((s) => typeof s === "string" && s)
  : typeof line === "string" ? line.split(/\s+/).filter(Boolean) : []);

/** A line as SAN from `fen`, stopping at the first move that will not play. */
function sanLine(fen, line, max = 8) {
  const g = load(fen);
  const out = [];
  for (const m of sansOf(line).slice(0, max)) { const mv = play(g, m); if (!mv) break; out.push(mv.san); }
  return out;
}
/** The move records of a line from `fen`, and the FEN after each. */
function walk(fen, sans, max = 8) {
  const g = load(fen);
  const moves = [], fens = [];
  if (!g) return { moves, fens };
  for (const s of sans.slice(0, max)) { const m = play(g, s); if (!m) break; moves.push(m); fens.push(g.fen()); }
  return { moves, fens };
}
/** What `side` is down over the line's first `n` plies (trades cancel). */
function netLoss(moves, n, side) {
  let s = 0;
  for (const m of moves.slice(0, n)) {
    const v = (m.captured ? VALUE[m.captured] : 0) + (m.promotion ? VALUE[m.promotion] - 1 : 0);
    s += m.color === side ? -v : v;
  }
  return s;
}
/**
 * What `side` is down along the line, walked to a quiet point: at least four
 * plies (or the whole line when shorter, cut to an even length), then on
 * while the exchange is still going (the last move a capture). The 14.0
 * oracle's rule, so a queen taken on ply 4 and taken back on ply 5 is a trade.
 */
function lossAlong(moves, side) {
  let s = 0, n = 0;
  for (const m of moves) {
    const v = (m.captured ? VALUE[m.captured] : 0) + (m.promotion ? VALUE[m.promotion] - 1 : 0);
    s += m.color === side ? -v : v;
    n++;
    if (n >= 4 && !m.captured && n % 2 === 0) break;
  }
  return s;
}

/**
 * Which kind of reason each sentence gives — what the coverage audit counts
 * (scripts/audit-explain.mjs):
 *   bare        only 「更好的是 X」
 *   material    what is lost or won, without the mechanism
 *   named       a mechanism: a mate, a motif, a threat, a man left loose, a
 *               positional or endgame fact, the opening book
 *   describe    what the move does, said of a move that is not a mistake
 */
export const KIND = {
  "ex.better": "bare", "ex.loss": "material", "ex.betterWins": "material", "ex.replyLine": "material",
  "ex.good": "describe", "ex.describe": "describe", "ex.capture": "describe", "ex.check": "describe", "ex.develop": "describe",
  "ex.castle": "describe", "ex.attack": "describe", "ex.defends": "describe", "ex.push": "describe",
  "ex.attackTwo": "describe", "ex.attackMate": "describe", "ex.captureEven": "describe",
};
export const kindOf = (key) => (!key ? null : KIND[key] || "named");

// --- the facts ---------------------------------------------------------------------

/**
 * @param {string|{fen: string}} position
 * @param {string|{from: string, to: string, promotion?: string}} move  SAN, UCI or a record
 * @param {object} [context]  see the module comment
 */
export function explainMove(position, move, context = {}) {
  const fen = typeof position === "string" ? position : position && position.fen;
  const g = load(fen);
  if (!g) return null;
  const mv = play(g, move);
  if (!mv) return null;
  const c = context || {};
  const kind = c.kind || "review";
  const side = mv.color, them = other(side);
  const fenAfter = g.fen();
  const line = sanLine(fenAfter, c.line, 8);
  const bestRec = c.best ? afterMove(fen, c.best) : null;
  const bestSan = bestRec ? bestRec.mv.san : null;
  const bestLine = bestRec ? (() => { const bl = sanLine(fen, c.bestLine, 8); return bl[0] === bestSan ? bl : [bestSan]; })() : [];
  const lineW = walk(fenAfter, line);
  const reply = lineW.moves[0] || null;
  const engine = !!(c.best || line.length);

  const paid = (mv.captured ? VALUE[mv.captured] : 0) + (mv.promotion ? VALUE[mv.promotion] - 1 : 0);
  const facts = { side, played: mv.san, uci: mv.from + mv.to + (mv.promotion || ""), fenAfter, hasLine: line.length > 0 };
  facts.mates = g.in_checkmate();
  facts.stalemate = g.in_stalemate();
  facts.check = g.in_check();
  facts.captured = mv.captured || null;
  if (bestSan && bestSan !== mv.san) facts.best = bestSan;

  // the 19.0 tactical facts, where an engine line is there to prove them
  const ex19 = engine ? explainMistake({ fen, played: mv.san, best: c.noBetter ? null : c.best, bestLine, line, evalBefore: c.evalBefore, evalAfter: c.evalAfter }) : null;
  facts.ex19 = ex19;
  facts.noBetter = !!c.noBetter;

  // the threat before the move: what the opponent could already win
  const T = F.threatOf(fen, them);
  if (T && (T.kind === "mate" || T.gain >= 1)) {
    const still = F.shotStill(fenAfter, T, them);
    if (still > 0 && (T.kind === "mate" || still > paid)) {
      const parried = bestRec ? !F.shotStill(bestRec.fen, T, them) : null;
      facts.threat = { san: sanOfShot(fenAfter, T, them), kind: T.kind, piece: T.piece, by: T.by, gain: still, free: T.free,
        from: T.from, to: T.to, confirmed: !!(reply && reply.from === T.from && reply.to === T.to) && (T.kind === "mate" || lossAlong(lineW.moves, side) - paid >= Math.min(2, VALUE[T.piece])), parried };
    } else if (!still) facts.parries = { san: T.san, piece: T.piece, kind: T.kind };
  }

  // or the reply itself was a threat before the move: the same capture already won there
  if ((!facts.threat || !facts.threat.confirmed) && reply && reply.captured) {
    const shot = { kind: "material", from: reply.from, to: reply.to, piece: reply.captured };
    const pre = F.shotStill(fen, shot, them);
    const still = F.shotStill(fenAfter, shot, them);
    const parried = bestRec ? !F.shotStill(bestRec.fen, shot, them) : null;
    if (pre >= 1 && still >= 1 && parried !== false && lossAlong(lineW.moves, side) - paid >= Math.min(2, VALUE[reply.captured])) {
      facts.threat = { san: reply.san, kind: "material", piece: reply.captured, by: reply.piece, gain: still,
        free: !F.guards(fen, reply.to, side).length, from: reply.from, to: reply.to, confirmed: true, parried };
    }
  }

  // men left loose by the move: attacked, and the exchange on their square pays
  const before = new Map(F.looseMen(fen, side).map((x) => [x.sq, x]));
  const loose = F.looseMen(fenAfter, side).filter((x) => x.sq === mv.to || !before.has(x.sq) || before.get(x.sq).gain < x.gain);
  if (loose.length) {
    const L = loose[0];
    let why = "loose";
    if (L.sq === mv.to) why = "moved";
    else if (F.guards(fen, L.sq, side).some((x) => x.from === mv.from)) why = "unguarded";
    const taken = lineW.moves.findIndex((m, i) => i % 2 === 0 && m.to === L.sq && m.captured);
    // the line takes it, and the mover ends down by it — net of what the move itself took
    const down = lossAlong(lineW.moves, side) - paid;
    facts.loose = { ...L, why, guard: why === "unguarded" ? mv.piece : null, guardFrom: mv.from, taken,
      confirmed: taken >= 0 && down >= Math.min(2, VALUE[L.piece]), board: L.gain - (why === "moved" ? paid : 0) >= 2 };
  }

  // what the line wins, walked to a quiet point (the 19.0 count stops at four plies)
  facts.lineLoss = lineLossOf(lineW.moves, side, paid);
  facts.lineDown = lossAlong(lineW.moves, side) - paid;

  // a defender with two jobs: the only guard of two attacked men
  facts.overloaded = overloadOf(fenAfter, side, lineW);

  // what the reply threatens: a new shot it sets up
  if (reply && !reply.captured && lineW.fens[0]) {
    const now = F.bestShot(fenAfter);
    const th = F.threatOf(lineW.fens[0], them);
    if (th && (th.kind === "mate" || th.gain >= 1) && !(now && now.to === th.to && now.kind === th.kind && (th.kind === "mate" || now.gain >= th.gain))) {
      // 「同时攻击」: the men the replying piece itself now hits and wins
      const hit = F.looseMen(lineW.fens[0], side).filter((x) => x.gain >= 2 && F.capturesOn(F.withTurn(lineW.fens[0], them), x.sq, them).some((m) => m.from === reply.to));
      facts.replyThreat = { reply: reply.san, san: sanOfShot(lineW.fens[0], th, them), kind: th.kind, piece: th.piece, gain: th.gain,
        two: th.kind !== "mate" && hit.length >= 2 ? hit.slice(0, 2).map((x) => x.piece) : null };
    }
  }

  // the better move takes a man the exchange wins (19.0 names it only for a piece)
  if (bestRec && bestSan !== mv.san && bestRec.mv.captured) {
    const gain = VALUE[bestRec.mv.captured] - F.see(bestRec.fen, bestRec.mv.to);
    const bw = walk(fen, bestLine);
    if (gain >= 1 && bw.moves.length >= 2 && -lossAlong(bw.moves, side) >= 1) {
      facts.betterTakes = { san: bestSan, piece: bestRec.mv.captured, by: bestRec.mv.piece, free: !F.capturesOn(bestRec.fen, bestRec.mv.to, them).length };
    }
  }

  // the reply's point: after your answer to it, a capture that wins (its own sacrifice counted)
  if (reply && lineW.fens[1] && lineW.moves[1] && !F.load(lineW.fens[1]).in_checkmate()) {
    const sh = F.bestShot(lineW.fens[1]);
    const pre = (reply.captured ? VALUE[reply.captured] : 0) - (lineW.moves[1].captured ? VALUE[lineW.moves[1].captured] : 0);
    const played2 = !lineW.moves[2] || (lineW.moves[2].from === (sh && sh.from) && lineW.moves[2].to === (sh && sh.to));
    if (sh && sh.kind === "material" && sh.gain >= 2 && pre + sh.gain - paid >= 2 && played2 && (reply.captured || /[+#]$/.test(reply.san))) {
      facts.replyCombo = { reply: reply.san, answer: lineW.moves[1].san, shot: sanOfShot(lineW.fens[1], sh, them), piece: sh.piece, net: pre + sh.gain - paid };
    }
  }

  // or the threat it makes one move later, after a forced answer (a check, a capture to take back)
  if (!facts.replyThreat && reply && lineW.moves[2] && !lineW.moves[2].captured && lineW.fens[2]) {
    const now = F.bestShot(lineW.fens[1]);
    const th = F.threatOf(lineW.fens[2], them);
    const quiet = lossAlong(lineW.moves.slice(0, 2), side) <= 0;
    if (quiet && th && (th.kind === "mate" || th.gain >= 2) && !(now && now.to === th.to && now.kind === th.kind && (th.kind === "mate" || now.gain >= th.gain))) {
      facts.replyThreat = { reply: reply.san, then: lineW.moves[2].san, san: sanOfShot(lineW.fens[2], th, them), kind: th.kind, piece: th.piece, gain: th.gain, two: null };
    }
  }

  // the better line's point: after the opponent's answer to it, a capture that wins (the sacrifice counted)
  if (bestRec && bestSan !== mv.san) {
    const bw = walk(fen, bestLine.length >= 2 ? bestLine : []);
    if (bw.fens[1] && !F.load(bw.fens[1]).in_checkmate()) {
      const sh = F.bestShot(bw.fens[1]);
      const pre = (bw.moves[0].captured ? VALUE[bw.moves[0].captured] : 0) - (bw.moves[1].captured ? VALUE[bw.moves[1].captured] : 0);
      if (sh && sh.kind === "material" && sh.gain >= 2 && pre + sh.gain >= 1) {
        facts.betterCombo = { san: bestSan, reply: bw.moves[1].san, shot: sh.san, piece: sh.piece, net: pre + sh.gain };
      }
    }
  }

  // what the better move threatens, or parries
  if (bestRec && bestSan !== mv.san) {
    const now = F.bestShot(fen);
    const th = F.threatOf(bestRec.fen, side);
    if (th && (th.kind === "mate" || th.gain >= 1) && !(now && now.to === th.to && now.kind === th.kind && now.gain >= th.gain) && !bestRec.mv.captured) {
      const hit = F.looseMen(bestRec.fen, them).filter((x) => x.gain >= 2 && F.capturesOn(F.withTurn(bestRec.fen, side), x.sq, side).some((m) => m.from === bestRec.mv.to));
      facts.betterThreat = { san: bestSan, threat: sanOfShot(bestRec.fen, th, side), kind: th.kind, piece: th.piece, gain: th.gain,
        two: th.kind !== "mate" && hit.length >= 2 ? hit.slice(0, 2).map((x) => x.piece) : null };
    }
  }

  // positional, only where the evaluation moved clearly and no man is lost
  const drop = c.evalBefore != null && c.evalAfter != null ? winPctDrop(c.evalBefore, c.evalAfter, side) : null;
  facts.drop = drop;
  if (((drop != null && drop >= WIN_MISTAKE) || c.positional) && bestRec && bestSan !== mv.san) facts.positional = positionalOf(fen, mv, fenAfter, bestRec, lineW, bestLine, side);

  // endgame facts
  facts.endgame = endgameOf(fen, mv, fenAfter, bestRec, side, c);

  // the opening book, the item's own move
  if (c.book && c.book.length) {
    const book = c.book.map((s) => { const r = afterMove(fen, s); return r ? r.mv.san : null; }).filter(Boolean);
    if (book.length && !book.includes(mv.san)) facts.offBook = { common: book[0] };
  }
  if (c.expected) {
    const r = afterMove(fen, c.expected);
    if (r && r.mv.san !== mv.san) facts.expected = { san: r.mv.san, intent: intentOf(fen, r.mv.san) };
  }

  // people: what players of this rating play here (Maia), and whether this was one of them
  if (Array.isArray(c.human) && c.human.length) {
    const top = c.human.slice().sort((a, b) => b.p - a.p)[0];
    const topRec = afterMove(fen, top.move);
    const mine = c.human.find((h) => { const r = afterMove(fen, h.move); return r && r.mv.san === mv.san; });
    facts.human = { rating: c.rating || 1500, top: topRec ? topRec.mv.san : null, topP: top.p, p: mine ? mine.p : 0 };
  }

  facts.intent = intentOf(fen, mv.san);
  facts.lesson = kind === "lesson" ? lessonOf(fen, mv, g, c) : null;

  const picked = pick(facts, kind);
  const arrows = arrowsOf(facts, lineW, picked);
  return { kind, facts, key: picked ? picked[0] : null, args: picked ? picked[1] : [], arrows,
    reason: kindOf(picked && picked[0]), extra: extraOf(facts, kind, picked) };
}

/** The SAN of a shot (a capture or a mate) for `color` in `fen`, whoever is on move. */
function sanOfShot(fen, shot, color) {
  const g = load(F.withTurn(fen, color));
  const m = play(g, { from: shot.from, to: shot.to });
  return m ? m.san : shot.san;
}

/**
 * The man the line wins from `side`, net of the move's own capture: walked
 * to a quiet point, ending on `side`'s answer (a capture left unanswered at
 * the end of a short line is not counted). Equal men taken on both sides cancel.
 */
function lineLossOf(moves, side, paid) {
  let n = 0;
  for (const m of moves) { n++; if (n >= 4 && !m.captured && n % 2 === 0) break; }
  // a line that runs out in the middle of an exchange: the trailing captures are not counted
  // a line that runs out in the middle of an exchange says nothing sure
  if (n > 0 && n === moves.length && moves[n - 1].captured) return null;
  if (n < 2) return null;
  const w = moves.slice(0, n);
  const mine = [], theirs = [];
  for (const m of w) if (m.captured) (m.color === side ? theirs : mine).push(m.captured);
  const net = netLoss(w, n, side) - paid;
  if (net < 1) return null;
  for (const t of theirs) { const i = mine.findIndex((x) => VALUE[x] === VALUE[t]); if (i >= 0) mine.splice(i, 1); }
  const top = mine.sort((a, b) => VALUE[b] - VALUE[a])[0];
  return top ? { piece: top, net, reply: moves[0].san } : null;
}

function overloadOf(fenAfter, side, lineW) {
  const g = load(fenAfter);
  if (!g) return null;
  const grid = F.gridOf(g);
  const them = other(side);
  const attacked = Object.keys(grid).filter((sq) => grid[sq].color === side && grid[sq].type !== "k" && F.capturesOn(fenAfter, sq, them).length);
  const soleGuard = new Map();
  for (const sq of attacked) {
    const gs = F.guards(fenAfter, sq, side);
    if (gs.length === 1) {
      const k = gs[0].from;
      if (!soleGuard.has(k)) soleGuard.set(k, []);
      soleGuard.get(k).push(sq);
    }
  }
  for (const [d, jobs] of soleGuard) {
    if (jobs.length < 2 || !grid[d]) continue;
    // the line proves it: it takes one of them first, and the mover ends down
    const r = lineW.moves[0];
    if (!r || !r.captured || !jobs.includes(r.to)) continue;
    if (lineW.moves.length < 4 || netLoss(lineW.moves, 4, side) < 1) continue;
    const other2 = jobs.find((x) => x !== r.to);
    return { guard: grid[d].type, at: d, a: grid[r.to] ? grid[r.to].type : r.captured, b: grid[other2].type, aSq: r.to, bSq: other2, reply: r.san };
  }
  return null;
}

function positionalOf(fen, mv, fenAfter, bestRec, lineW, bestLine, side) {
  const them = other(side);
  // the line's first two plies (the reply and the answer to it) and the better line's, so a recapture is in both
  const two = (base, w) => (w.fens[1] || w.fens[0] || base);
  const afterPlayed = two(fenAfter, lineW);
  const bw = bestRec ? walk(fen, bestLine.length ? bestLine : [bestRec.mv.san]) : null;
  const afterBest = bw ? (bw.fens[2] || bw.fens[1] || bw.fens[0]) : null;
  if (!afterBest) return null;
  // no man lost along the way: then the material is the story, not this
  if (lossAlong(lineW.moves, side) - (mv.captured ? VALUE[mv.captured] : 0) >= 1) return null;
  // a pawn fact belongs to the move: its file or the next one, or the reply's
  const near = (sq) => [mv.from, mv.to, lineW.moves[0] && lineW.moves[0].to].some((x) => x && Math.abs(x.charCodeAt(0) - sq.charCodeAt(0)) <= 1);
  const out = [];
  const S0 = F.shelter(fen, side), S1 = F.shelter(fenAfter, side);
  if (mv.piece === "p" && S0 && S1 && S0.king === S1.king && S0.pawns.includes(mv.from) && !S1.pawns.includes(mv.to)) {
    const SB = F.shelter(bestRec.fen, side);
    if (!SB || SB.pawns.length >= S0.pawns.length) out.push({ kind: "shelter", sq: mv.from, king: S0.king });
  }
  if (mv.piece === "p" && S0 && S0.pawns.includes(mv.from)) {
    // a pawn step in front of the king that leaves a hole the opponent's queen or bishop already looks at is the same fact
  }
  const ps = (f, c) => F.pawnStructure(f, c) || { isolated: [], doubled: [], passed: [], backward: [] };
  const A = ps(afterPlayed, side), B = ps(afterBest, side), N = ps(fen, side);
  const newIso = A.isolated.filter((s) => !B.isolated.includes(s) && !N.isolated.includes(s) && near(s));
  if (newIso.length && A.isolated.length > B.isolated.length) out.push({ kind: "isolated", sq: newIso[0] });
  const newDbl = A.doubled.filter((s) => !B.doubled.includes(s) && !N.doubled.includes(s) && near(s));
  if (newDbl.length && A.doubled.length > B.doubled.length) out.push({ kind: "doubled", sq: newDbl[0] });
  // (backward pawns are counted by pawnStructure but not said: a backward pawn two plies on is
  // as often the reply's doing as the move's)
  const TA = ps(afterPlayed, them), TB = ps(afterBest, them), TN = ps(fen, them);
  const passer = TA.passed.filter((s) => !TB.passed.includes(s) && !TN.passed.includes(s) && F.relRank(s, them) >= 3 && near(s));
  if (passer.length && TA.passed.length > TB.passed.length) out.push({ kind: "passed", sq: passer[0] });
  // a file opened at the king, for a rook or queen of the other side
  const K = F.shelter(fen, side);
  if (K) {
    const fa = F.files(afterPlayed), fb = F.files(afterBest), f0 = F.files(fen);
    const mine = side === "w" ? "noW" : "noB";
    const heavy = (f) => { const gg = load(f); return gg && Object.values(F.gridOf(gg)).some((p) => p.color === them && (p.type === "r" || p.type === "q")); };
    const opened = K.files.find((fl) => (fa.open.includes(fl) || fa[mine].includes(fl)) && !(fb.open.includes(fl) || fb[mine].includes(fl)) && !(f0.open.includes(fl) || f0[mine].includes(fl)));
    if (opened != null && heavy(afterPlayed)) out.push({ kind: "openFile", file: "abcdefgh"[opened], king: K.king });
  }
  // an outpost handed to the other side's knight
  const oA = F.outposts(afterPlayed, them), oB = F.outposts(afterBest, them), o0 = F.outposts(fen, them);
  // the moved pawn was the one that could hit it: it stood on the next file, behind the square
  const pawnGuarded = (s) => mv.piece === "p" && Math.abs(mv.from.charCodeAt(0) - s.charCodeAt(0)) === 1 &&
    (side === "w" ? Number(mv.from[1]) < Number(s[1]) : Number(mv.from[1]) > Number(s[1]));
  const emptyAt = (f, s) => { const gg = load(f); return gg && !gg.get(s); };
  const post = oA.find((s) => !oB.includes(s) && !o0.includes(s) && pawnGuarded(s) && emptyAt(afterPlayed, s) && F.knightReach(afterPlayed, s, them, 2) != null);
  if (post) out.push({ kind: "outpost", sq: post });
  // the bishop pair given up: a bishop traded for a knight, the other side keeps its two
  const pair = (f, c) => F.bishops(f, c).length >= 2;
  if (mv.piece === "b" && mv.captured === "n" && pair(fen, side) && !pair(afterPlayed, side) && pair(afterPlayed, them) && pair(afterBest, side)) {
    out.push({ kind: "bishopPair" });
  }
  // a bishop hemmed in by its own pawns
  if (mv.piece === "p") {
    const ba = F.bishops(afterPlayed, side), bb = F.bishops(afterBest, side), b0 = F.bishops(fen, side);
    for (const b of ba) {
      const x = bb.find((y) => y.sq === b.sq), y0 = b0.find((y) => y.sq === b.sq);
      if (x && y0 && b.own >= 5 && b.own > x.own && b.own > y0.own && b.own * 3 >= b.total * 2) { out.push({ kind: "badBishop", sq: b.sq }); break; }
    }
  }
  return out.length ? out : null;
}

function endgameOf(fen, mv, fenAfter, bestRec, side, c) {
  const out = {};
  const k0 = kpk(fen), k1 = kpk(fenAfter);
  if (k0 && k1) {
    const mine = k0.strong === side;
    const won0 = mine ? k0.result === "win" : k0.result === "draw";
    const won1 = mine ? k1.result === "win" : k1.result === "draw";
    out.kpk = { before: k0.result, after: k1.result, strong: k0.strong, lost: won0 && !won1 };
    if (out.kpk.lost && mine) {
      // the reply that holds: the opposition taken, or the pawn caught
      const g = load(fenAfter);
      for (const r of g.moves({ verbose: true })) {
        g.move(r);
        const v = kpk(g.fen());
        const o = F.opposition(g.fen());
        g.undo();
        if (v && v.result === "draw" && o && o.holder !== side && (o.kind === "direct" || o.kind === "distant")) { out.opposition = { reply: r.san, kind: o.kind }; break; }
      }
      // a win still there before: the move that kept it
      const g0 = load(fen);
      const keeps = g0.moves({ verbose: true }).filter((m) => { g0.move(m); const v = kpk(g0.fen()); g0.undo(); return v && v.result === "win"; });
      // the winning move that takes the opposition, when there is one: that is what was given up
      const opp = keeps.find((m) => { g0.move(m); const o = F.opposition(g0.fen()); g0.undo(); return o && o.holder === side; });
      const keep = opp || keeps[0];
      if (keep) out.keep = keep.san;
      if (opp && !out.opposition) out.missedOpposition = { keep: opp.san };
      if (mv.piece === "p" && keep && keep.piece === "k") out.pushedEarly = true;
    }
  }
  // the square: a lone passer that ran before, and is caught after
  const gg = load(fen);
  const grid = gg ? F.gridOf(gg) : {};
  const theirK = F.kingSq(grid, other(side));
  const myPassers = (F.pawnStructure(fen, side) || { passed: [] }).passed;
  const onlyKings = Object.values(grid).filter((p) => p.color === other(side)).every((p) => p.type === "k" || p.type === "p");
  if (theirK && onlyKings && myPassers.length && !(mv.piece === "p" && myPassers.includes(mv.from))) {
    const g1 = load(fenAfter);
    const k1 = F.kingSq(F.gridOf(g1), other(side));
    for (const p of myPassers) {
      const g2 = load(fen);
      const push = g2.moves({ verbose: true }).find((m) => m.from === p && m.piece === "p");
      if (!push) continue;
      const runsAfterPush = !F.caughtBySquare(push.to, side, theirK, other(side));
      const caughtNow = F.caughtBySquare(p, side, k1, other(side));
      if (runsAfterPush && caughtNow) { out.square = { pawn: p, push: push.san }; break; }
    }
  }
  // a rook leaving the seventh, a rook leaving the back of a passed pawn
  if (mv.piece === "r" && F.relRank(mv.from, side) === 6 && F.relRank(mv.to, side) !== 6) out.left7th = { from: mv.from };
  if (mv.piece === "r") {
    for (const c2 of [side, other(side)]) {
      const passed = (F.pawnStructure(fen, c2) || { passed: [] }).passed;
      const p = passed.find((s) => F.rookBehind(fen, s, side) && !F.rookBehind(fenAfter, s, side) && s[0] === mv.from[0]);
      if (p) { out.leftBehind = { pawn: p, mine: c2 === side }; break; }
    }
  }
  return Object.keys(out).length ? out : null;
}

function lessonOf(fen, mv, g, c) {
  if (!c.goal) return null;
  const out = { goal: c.goal };
  if (c.goal === "mate" && !g.in_checkmate()) {
    if (g.in_stalemate()) out.stalemate = true;
    else if (g.in_check()) {
      const ms = g.moves({ verbose: true });
      const k = ms.find((m) => m.piece === "k") || ms[0];
      out.escape = k ? k.san : null;
    } else out.noCheck = true;
  }
  if (c.goal === "check" && !g.in_check()) out.noCheck = true;
  if (c.goal === "capture" && !mv.captured) out.noCapture = true;
  return out;
}

/**
 * What a move does, said plainly — for a move that is not a mistake, or
 * when nothing went wrong but it was not the move wanted: a mate, a capture
 * (and whether it pays), a check, a threat it makes, a threat it parries,
 * castling, a piece brought out, a passed pawn pushed.
 */
export function intentOf(fen, move) {
  const a = afterMove(fen, move);
  if (!a) return null;
  const { mv, fen: f1, g } = a;
  const side = mv.color, them = other(side);
  if (g.in_checkmate()) return { kind: "mate", san: mv.san };
  const out = { san: mv.san };
  if (mv.captured) {
    const back = F.see(f1, mv.to);
    out.capture = { piece: mv.captured, net: VALUE[mv.captured] - back };
  }
  if (g.in_check()) out.check = true;
  const now = F.bestShot(fen);
  const th = g.in_check() ? null : F.threatOf(f1, side);
  if (th && (th.kind === "mate" || th.gain >= 2) && !(now && now.to === th.to && now.kind === th.kind && now.gain >= th.gain)) {
    const hit = F.looseMen(f1, them).filter((x) => x.gain >= 1);
    out.threat = { san: sanOfShot(f1, th, side), kind: th.kind, piece: th.piece, two: hit.length >= 2 ? hit.slice(0, 2).map((x) => x.sq) : null };
  }
  // a double attack: two men under pressure that were not before, the moved piece among the attackers
  if (!out.threat || !out.threat.two) {
    const was = new Set(F.pressure(fen, side).map((x) => x.sq));
    const now2 = F.pressure(f1, side).filter((x) => !was.has(x.sq) && x.attackers.includes(mv.to));
    if (now2.length >= 2) out.threat = { ...(out.threat || {}), kind: out.threat ? out.threat.kind : "material", piece: now2[0].piece, two: now2.slice(0, 2).map((x) => x.sq) };
  }
  const T = F.threatOf(fen, them);
  if (T && (T.kind === "mate" || T.gain >= 2) && !F.shotStill(f1, T, them)) out.parries = { san: T.san, piece: T.piece, kind: T.kind };
  if (mv.flags.includes("k") || mv.flags.includes("q")) out.castle = true;
  else if ((mv.piece === "n" || mv.piece === "b") && F.relRank(mv.from, side) === 0) out.develop = mv.piece;
  if (mv.piece === "p" && (F.pawnStructure(fen, side) || { passed: [] }).passed.includes(mv.from)) out.push = true;
  return out;
}

// --- the sentence --------------------------------------------------------------------

const S = (san, color) => ({ san, color });
const P = (piece) => ({ piece });
const M = (motif) => ({ motif });

/**
 * The template key that says the most certain thing about this move, and
 * its arguments. The order is the 19.0 order with the v2 facts set in:
 * a mate first; a threat that was already there (and the reply plays it);
 * a mate allowed; a man taken for nothing; a man left loose, a guard gone, a
 * defender overloaded — each confirmed by the reply; any other motif; what
 * the reply threatens; the loss alone; the better move with what it wins or
 * threatens; the positional fact; the better move alone.
 */
function pick(f, kind) {
  const me = f.side, them = other(me);
  const ex = f.ex19, r = ex && ex.refute, b = ex && ex.better;
  const k19 = ex ? key19(ex) : null;
  const L = f.lesson, E = f.endgame;

  if (f.mates) return ["ex.good", [S(f.played, me), "mate"]];
  // the item's own wants first: they are what the player was asked
  if (L && L.stalemate) return ["ex.stalemate", [S(f.played, me)]];
  if (L && L.escape) return ["ex.notMate", [S(f.played, me), S(L.escape, them)]];
  if (L && L.noCheck && L.goal === "mate") return ["ex.noCheckMate", [S(f.played, me)]];
  if (L && L.noCheck) return ["ex.noCheck", [S(f.played, me)]];
  if (L && L.noCapture) return ["ex.noCapture", [S(f.played, me)]];
  if (E && E.kpk && E.kpk.lost) {
    if (E.pushedEarly) return ["ex.pushedEarly", [S(f.played, me)]];
    if (E.opposition) return ["ex.lostOpposition", [S(f.played, me), S(E.opposition.reply, them)]];
    if (E.missedOpposition) return ["ex.missedOpposition", [S(f.played, me), S(E.missedOpposition.keep, me)]];
    if (E.square) return ["ex.square", [S(f.played, me), S(E.square.push, me)]];
    return ["ex.lostWin", [S(f.played, me)]];
  }
  if (E && E.square && kind === "endgame") return ["ex.square", [S(f.played, me), S(E.square.push, me)]];
  if (E && E.left7th && kind === "endgame") return ["ex.left7th", [S(f.played, me)]];
  if (E && E.leftBehind && kind === "endgame") return [E.leftBehind.mine ? "ex.leftBehindMine" : "ex.leftBehindTheirs", [S(f.played, me), { sq: E.leftBehind.pawn }]];

  // mates found by the engine line
  if (k19 && /^ex\.(mate1|mateN)/.test(k19)) return [k19, null];
  // the threat that was already there (19.0 says it when a piece hung; v2 also for a pawn and a cheap taker)
  const T = f.threat;
  // with an engine line, the reply has to play it; without one (a lesson, the coach's board check), the board alone, for a piece or a mate
  const tOk = T && (T.confirmed || (!f.hasLine && (T.kind === "mate" || T.gain >= 2)));
  if (T && T.kind === "mate" && tOk) return ["ex.threatMate", [S(T.san, them)]];
  if (k19 === "ex.threatMate") return [k19, null];
  if (k19 && /^ex\.allowsMate/.test(k19)) return [k19, null];
  if ((k19 === "ex.threatHanging" || k19 === "ex.threatCheap") && (!f.hasLine || f.lineDown >= 2)) return [k19, null];
  if (T && tOk && T.kind === "material") {
    return T.free ? ["ex.threatFree", [S(T.san, them), P(T.piece)]] : ["ex.threatTake", [S(T.san, them), P(T.piece), P(T.by)]];
  }
  if (k19 === "ex.perpetual") return [k19, null];
  // 19.0's 「没有保护住」 when the line, walked to a quiet point, bears it out (≥ 2 down)
  if ((k19 === "ex.hanging" || k19 === "ex.hangingCheap") && (!f.hasLine || f.lineDown >= 2)) return [k19, null];
  // a man the move left loose, taken at once by the reply
  const Lx = f.loose;
  const looseKey = () => {
    if (Lx.why === "moved") return Lx.free ? ["ex.movedFree", [S(f.played, me), P(Lx.piece)]] : ["ex.movedTake", [S(f.played, me), P(Lx.piece), P(Lx.by)]];
    if (Lx.why === "unguarded") return ["ex.unguarded", [P(Lx.guard), { sq: Lx.sq }, P(Lx.piece)]];
    return ["ex.looseAfter", [S(f.played, me), { sq: Lx.sq }, P(Lx.piece)]];
  };
  const looseOk = Lx && (f.hasLine ? Lx.confirmed : Lx.board);
  // a motif the 19.0 detectors prove (a fork, a pin…) says more than which man went
  if (k19 && /^ex\.(motifLoss|motif|forkHits)$/.test(k19)) return [k19, null];
  if (looseOk && (Lx.taken === 0 || !f.hasLine)) return looseKey();
  if (f.overloaded) return ["ex.overloaded", [P(f.overloaded.guard), P(f.overloaded.a), P(f.overloaded.b), S(f.overloaded.reply, them)]];
  if (looseOk) return looseKey();
  // the better move took a man for nothing: that is what was missed
  if (k19 && /^ex\.better(Hanging|Cheap|Motif)$/.test(k19)) return [k19, null];
  const RT = f.replyThreat;
  const replyKey = () => {
    if (RT.then) return RT.kind === "mate" ? ["ex.reply2Mate", [S(RT.reply, them), S(RT.then, them), S(RT.san, them)]] : ["ex.reply2Threat", [S(RT.reply, them), S(RT.then, them), P(RT.piece)]];
    if (RT.kind === "mate") return ["ex.replyMate", [S(RT.reply, them), S(RT.san, them)]];
    if (RT.two) return ["ex.replyTwo", [S(RT.reply, them), P(RT.two[0]), P(RT.two[1])]];
    return ["ex.replyThreat", [S(RT.reply, them), P(RT.piece)]];
  };
  if (RT && engineSaidReason(f) && (RT.kind === "mate" || RT.gain >= 2)) return replyKey();
  if (f.replyCombo && engineSaidReason(f)) {
    const C = f.replyCombo;
    return ["ex.replyCombo", [S(C.reply, them), S(C.answer, me), S(C.shot, them), P(C.piece)]];
  }
  if (k19 === "ex.loss") return [k19, null];
  if (f.lineLoss && f.hasLine && VALUE[f.lineLoss.piece] <= f.lineLoss.net + 1) return ["ex.loss", [S(f.lineLoss.reply, them), P(f.lineLoss.piece)]];
  if (f.offBook) return ["ex.offBook", [S(f.played, me), S(f.offBook.common, me)]];
  if (f.threat && f.threat.parried && f.best && !f.noBetter && !f.hasLine && f.threat.gain >= 2) {
    return ["ex.betterParries", [S(f.best, me), S(f.threat.san, them)]];
  }
  if (f.betterThreat && !f.noBetter && engineSaidReason(f)) {
    const B = f.betterThreat;
    if (B.kind === "mate") return ["ex.betterThreatMate", [S(B.san, me), S(B.threat, me)]];
    if (B.two) return ["ex.betterTwo", [S(B.san, me), P(B.two[0]), P(B.two[1])]];
    return ["ex.betterThreat", [S(B.san, me), P(B.piece)]];
  }
  if (f.betterTakes && !f.noBetter && engineSaidReason(f)) {
    const B = f.betterTakes;
    return B.free ? ["ex.betterTakesFree", [S(B.san, me), P(B.piece)]] : ["ex.betterTakes", [S(B.san, me), P(B.piece)]];
  }
  if (k19 === "ex.betterWins") return [k19, null];
  if (RT && engineSaidReason(f)) return replyKey();
  if (f.betterCombo && !f.noBetter && engineSaidReason(f)) {
    const B = f.betterCombo;
    return ["ex.betterCombo", [S(B.san, me), S(B.reply, them), S(B.shot, me), P(B.piece)]];
  }
  if (f.positional && f.positional.length) {
    const x = f.positional[0];
    if (x.kind === "shelter") return ["ex.pos.shelter", [S(f.played, me)]];
    if (x.kind === "openFile") return ["ex.pos.openFile", [S(f.played, me), { file: x.file }]];
    if (x.kind === "isolated") return ["ex.pos.isolated", [S(f.played, me), { sq: x.sq }]];
    if (x.kind === "doubled") return ["ex.pos.doubled", [S(f.played, me), { file: x.sq[0] }]];
    if (x.kind === "backward") return ["ex.pos.backward", [S(f.played, me), { sq: x.sq }]];
    if (x.kind === "passed") return ["ex.pos.passed", [S(f.played, me), { sq: x.sq }]];
    if (x.kind === "outpost") return ["ex.pos.outpost", [S(f.played, me), { sq: x.sq }]];
    if (x.kind === "badBishop") return ["ex.pos.badBishop", [S(f.played, me)]];
    if (x.kind === "bishopPair") return ["ex.pos.bishopPair", [S(f.played, me)]];
  }
  if (k19 === "ex.better") return [k19, null];
  // nothing wrong the board proves: say what the move does — not in a review
  // or the coach, where the move was judged a mistake and a description is no reason
  const I = f.intent;
  if (kind === "review" || kind === "coach" || kind === "retry") return null;
  if (I) {
    if (I.capture && I.capture.net > 0) return ["ex.capture", [S(f.played, me), P(I.capture.piece)]];
    if (I.threat && I.threat.two) return ["ex.attackTwo", [S(f.played, me), { sq: I.threat.two[0] }, { sq: I.threat.two[1] }]];
    if (I.threat && I.threat.kind === "mate") return ["ex.attackMate", [S(f.played, me), S(I.threat.san, me)]];
    if (I.threat) return ["ex.attack", [S(f.played, me), P(I.threat.piece)]];
    if (I.parries) return ["ex.defends", [S(f.played, me), S(I.parries.san, them)]];
    if (I.check) return ["ex.check", [S(f.played, me)]];
    if (I.capture) return ["ex.captureEven", [S(f.played, me), P(I.capture.piece)]];
    if (I.castle) return ["ex.castle", [S(f.played, me)]];
    if (I.develop) return ["ex.develop", [S(f.played, me), P(I.develop)]];
    if (I.push) return ["ex.push", [S(f.played, me)]];
  }
  return ["ex.describe", [S(f.played, me)]];
}
/** Did the engine call this move a mistake (a line and a drop the caller measured)? */
const engineSaidReason = (f) => (f.hasLine && !f.best && !f.noBetter ? false   // the engine's own move: not judged bad
  : f.drop == null ? !!(f.ex19 && f.ex19.refute) : f.drop >= WIN_MISTAKE);

/** A second sentence that adds what people play here: 「1500 的人这里也常走 X」. */
function extraOf(f, kind, picked) {
  const out = [];
  const H = f.human;
  if (H && H.top) {
    if (H.p >= 0.2 && kind !== "classic") out.push(["ex.natural", [String(H.rating), Math.round(H.p * 100) + "%"]]);
    else if (kind === "classic" && H.top === f.played) out.push(["ex.peopleToo", [String(H.rating)]]);
    else if (kind === "classic" && H.top) out.push(["ex.people", [String(H.rating), S(H.top, f.side)]]);
  }
  // an opening move off the book that also does something on the board: say that too
  if (kind === "opening" && picked && picked[0] === "ex.offBook") {
    const more = pick({ ...f, offBook: null }, "lesson");
    if (more && more[0] !== "ex.describe") out.push(more);
  }
  if (kind === "classic" && f.expected && f.expected.intent) {
    const I = f.expected.intent;
    if (I.threat && I.threat.two) out.push(["ex.masterTwo", [{ sq: I.threat.two[0] }, { sq: I.threat.two[1] }]]);
  }
  return out;
}

function arrowsOf(f, lineW, picked) {
  const out = [];
  // the opponent's answer, and the follow-up: the line the sentence is about
  for (let i = 0; i < Math.min(3, lineW.moves.length); i++) {
    const m = lineW.moves[i];
    out.push({ from: m.from, to: m.to, color: m.color === f.side ? "B" : "R" });
  }
  if (!out.length && f.threat && (f.threat.confirmed || picked && /^ex\.threat/.test(picked[0]))) out.push({ from: f.threat.from, to: f.threat.to, color: "R" });
  return out;
}

// --- text ----------------------------------------------------------------------------

/**
 * The sentence, as parts: strings, and `{san, color}` for each move so a
 * page can draw it the way the move list draws moves.
 * @param {object} res   explainMove()
 * @param {Function} t   key → template ({0} {1} …), the page's dictionary
 * @param {{extra?: boolean}} [o]  add the second sentence (what people play)
 */
export function explainParts(res, t, { extra = false } = {}) {
  if (!res || !res.key) return [];
  const out = res.args == null ? parts19(res.facts.ex19, t) : fill(t(res.key), res.args, t);
  if (extra) for (const [k, a] of res.extra || []) { out.push("。"); out.push(...fill(t(k), a, t)); }
  return out;
}
function fill(tpl, args, t) {
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
    else if (a && a.sq) push(a.sq);
    else if (a && a.file) push(t("ex.file", a.file));
    else if (a === "mate") push(t("ex.mateWord"));
    else if (a != null) push(String(a));
    at = m.index + m[0].length;
  }
  push(tpl.slice(at));
  return out;
}

/**
 * The sentence as plain text, moves as SAN. Accepts an explainMove() result,
 * or — for the callers not yet moved — a 19.0 explainMistake() record.
 */
export function explainText(res, t, o) {
  if (res && res.facts) return explainParts(res, t, o).map((p) => (typeof p === "string" ? p : sanText(p.san))).join("");
  return parts19(res, t).map((p) => (typeof p === "string" ? p : sanText(p.san))).join("");
}
/** The key the sentence is built from (19.0 records too). */
export const explainKey = (res) => (res && res.facts ? res.key : key19(res));
/** The motif the sentence names, or null (19.0 records too). */
export function explainMotif(res) {
  if (!res) return null;
  if (!res.facts) return motif19(res);
  if (res.args == null) return motif19(res.facts.ex19);
  if (/^ex\.(threat|moved|looseAfter|unguarded)/.test(res.key)) return /Mate$/.test(res.key) ? "mateThreat" : "hanging";
  if (res.key === "ex.overloaded") return "overload";
  return null;
}
export { LOSS_PLIES };
