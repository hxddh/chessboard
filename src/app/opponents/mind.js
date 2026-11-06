/**
 * An opponent's turn (v20-0-plan §3 P1, ADR 0004): which move, how long it
 * takes over it, and whether it would rather resign. The engine service
 * calls this for a ladder profile (core/opponents.js); the page never knows
 * who played. The same function plays the opponents in the app and in the
 * Node harnesses (scripts/test-convert.mjs, scripts/ladder20.mjs), over the
 * same backends.
 *
 *   one quick look   a short Stockfish search: the opponent's own sense of
 *                    the position, for resigning, draws, and converting
 *   the move         Maia-3 profiles: a draw from the human distribution at
 *                    the profile's rating, sharpened by its temperature /
 *                    top-p and leant by a small style prior; Stockfish
 *                    profiles: UCI_Elo over a fixed node count; 全力: no limit
 *   converting       when the look gives the side to move ≥ 85% (lichess's
 *                    curve, about +5; the plan's bar is 90%, and a quick
 *                    look reads a +6 as +5.5 often enough to matter), and
 *                    until it falls below 70%, the draw is taken among the
 *                    moves a multi-line search says keep the win, by the
 *                    human prior of a player who knows how to win it (the
 *                    profile's rating + 400, up to 1600), leant toward
 *                    progress: a 600 wins a won position the way a person
 *                    who knows it is winning does — no blunder, no
 *                    repetition, mates that a person sees (≤ `sees` moves),
 *                    not a 20-move combination
 *   the clock        opponents/think.js
 *
 * @module opponents/mind
 */
import { Chess } from "../core/chess.js";
import { winPct } from "../core/winpct.js";
import { sample } from "../services/maia3/backend.js";
import { thinkTime } from "./think.js";

export const LOOK = { nodes: 20000 };
export const CONVERT_LOOK = { nodes: 40000, lines: 6 };
export const CONVERT_AT = 85;           // win % for the side to move (≈ +4.8; a little before the plan's 90%, so a +6 read as +5.9 still counts)
export const CONVERT_RATING = 1600;     // converting, it moves like a player this much stronger, up to this
export const CONVERT_LIFT = 400;
export const CONVERT_KEEP = 70;         // … and, once converting, the % it keeps at it down to
const CAP = 1500;                       // a big advantage is a big advantage: beyond it no move is "better"
const TRADE = 2, PUSH = 1.6;            // converting: the lean to trades and to pawns going through
const SLACK = 120, TAU = 35;            // converting: how much worse than the best a kept move may be; the lean to progress
/** Everything above that changes which move is played: a game records it (scripts/ladder20.mjs). */
export const TUNING = { LOOK, CONVERT_LOOK, CONVERT_AT, CONVERT_KEEP, CONVERT_RATING, CONVERT_LIFT, CAP, SLACK, TAU, TRADE, PUSH };

const sideToMove = (fen) => (String(fen).split(" ")[1] === "b" ? "b" : "w");

/** A score from the side to move's view, as a scalar: centipawns, a mate ±(10000 − 10·n). */
export function ownScalar(score) {
  if (!score) return 0;
  if (score.mate !== undefined) return score.mate > 0 ? 10000 - 10 * score.mate : -10000 - 10 * score.mate;
  return score.cp;
}
/** White-view score (the service's) → side-to-move scalar. */
export const ownOf = (score, fen) => (sideToMove(fen) === "w" ? 1 : -1) * ownScalar(score);

/** Win % for the side to move from its own scalar. */
export const ownWin = (s) => winPct(s);

/**
 * Should it resign? `looks` are its own scalars before each of its moves,
 * oldest first, the current one last. A profile without `resign` plays on
 * to the end (a beginner does). Sustained, not momentary.
 */
export function shouldResign(profile, looks, plies = Infinity) {
  const r = profile && profile.resign;
  if (!r || !looks || !looks.length) return false;
  if (plies < (r.after ?? 20)) return false;
  const last = looks.slice(-r.n);
  if (last.length < r.n) return false;
  return last.every((s) => s <= -r.cp);
}

/**
 * Does it take a draw it is offered? When it is worse by `draw.worse`, or
 * when the game is long and dead level. `own` is its scalar now.
 */
export function acceptsDraw(profile, own, plies) {
  const d = (profile && profile.draw) || { worse: 150 };
  if (!Number.isFinite(own)) return false;
  if (own <= -d.worse) return true;
  return plies >= (d.levelAfter ?? 60) && Math.abs(own) <= (d.level ?? 30);
}

/**
 * The one reaction a game gets (≤ 3 lines a game): the player's last move
 * turned the position against it — its look fell by ≥ 250 to below +1.
 */
export function surprised(prev, now) {
  return Number.isFinite(prev) && Number.isFinite(now) && prev - now >= 250 && now < 100;
}

/**
 * A style as a small prior over the human distribution: `attacker` leans to
 * checks and captures, `principled` (the opening only) to castling and
 * developing a minor piece. The distribution stays the person's; this is
 * a tilt of a few percent, renormalised.
 */
export function leanPolicy(policy, fen, style) {
  if (!style || !policy.length) return policy;
  const g = new Chess(fen);
  const full = Number(String(fen).split(" ")[5]) || 1;
  const byUci = new Map(g.moves({ verbose: true }).map((m) => [m.from + m.to + (m.promotion || ""), m]));
  const out = policy.map(({ move, p }) => {
    const m = byUci.get(move);
    let k = 1;
    if (m && style === "attacker") {
      if (m.san.includes("+")) k *= 1.6;
      else if (m.captured) k *= 1.2;
    } else if (m && style === "principled" && full <= 12) {
      if (m.flags.includes("k") || m.flags.includes("q")) k *= 1.8;
      else if ((m.piece === "n" || m.piece === "b") && "18".includes(m.from[1])) k *= 1.35;
      else if (m.piece === "q" && full <= 6) k *= 0.6;
    }
    return { move, p: p * k };
  });
  const s = out.reduce((a, x) => a + x.p, 0) || 1;
  return out.map((x) => ({ move: x.move, p: x.p / s })).sort((a, b) => b.p - a.p);
}

/** Ahead, a capture (a trade) and a pawn on its way to queen weigh more: TRADE, PUSH. */
function simplifies(m) {
  if (m.captured) return TRADE;
  if (m.piece === "p" && (m.promotion || (m.color === "w" ? Number(m.to[1]) >= 5 : Number(m.to[1]) <= 4))) return PUSH;
  return 1;
}

/** The position (board, side, castling, ep) a move leads to: for "not this again". */
const key = (fen) => String(fen).split(" ").slice(0, 4).join(" ");

/**
 * Converting: among the lines the search found, the moves that keep the
 * win, drawn by the human prior sharpened by `temperature`. Scores are
 * capped at +15 (a mate a person would not see counts as a big advantage,
 * not as "the" move); a mate within `sees` moves is taken.
 * @param {{ moves: string[], own: number }[]} lines  side-to-move scalars
 */
export function convertPick(policy, lines, { fen, history = [], sees = 1, temperature = 0.5, random = Math.random }) {
  if (!lines.length) return null;
  const seen = new Set(history.map(key));
  const g = new Chess(fen);
  const capped = (s) => (s >= 10000 - 10 * sees ? 5000 : Math.min(s, CAP));
  const cands = lines.map((l) => {
    const mv = l.moves[0];
    const m = g.move({ from: mv.slice(0, 2), to: mv.slice(2, 4), promotion: mv[4] || "q" });
    const again = m ? seen.has(key(g.fen())) : true;
    if (m) g.undo();
    return { move: mv, s: capped(l.own), again, plan: m ? simplifies(m) : 1 };
  });
  const best = Math.max(...cands.map((c) => c.s));
  if (best >= 5000) return cands.find((c) => c.s === best).move;
  const pOf = new Map(policy.map((x) => [x.move, x.p]));
  let keep = cands.filter((c) => c.s >= best - SLACK && ownWin(c.s) >= 80 && !c.again);
  if (!keep.length) keep = cands.filter((c) => c.s >= best - SLACK);
  // the prior picks among them, leant toward progress: a move TAU worse weighs 1/e as much
  // and toward what a player ahead is taught: trade pieces, push the passed pawn
  const w = keep.map((c) => Math.pow((pOf.get(c.move) || 0) + 0.003, 1 / temperature) * Math.exp((c.s - best) / TAU) * c.plan);
  let r = random() * w.reduce((a, b) => a + b, 0);
  for (let i = 0; i < keep.length; i++) if ((r -= w[i]) < 0) return keep[i].move;
  return keep[keep.length - 1].move;
}

/**
 * The opponent's turn.
 * @param {{ analyse, humanMoves, search }} api  the engine service's calls (search: the backend's raw one)
 * @param {string} fen
 * @param {object} profile  a core/opponents.js profile
 * @param {{ history?: string[], looks?: number[], plies?: number, random?: () => number, clockMs?: number, incMs?: number }} [ctx]
 * @returns {Promise<{ move: string|null, thinkMs: number, look: number, resign: boolean, converting: boolean }>}
 */
export async function opponentMove(api, fen, profile, ctx = {}) {
  const { history = [], looks = [], random = Math.random, clockMs = null, incMs = 0 } = ctx;
  // how far into the game, by the position's own move number (a game set up from a position counts from there)
  const plies = ctx.plies ?? ((Number(String(fen).split(" ")[5]) || 1) - 1) * 2 + (sideToMove(fen) === "b" ? 1 : 0);
  const play = profile.play || {};
  const rating = play.maia ?? Math.min(2600, profile.rating || 1500);
  const policy = await api.humanMoves(fen, { self: rating, oppo: rating }, history.slice(-7));
  const think = () => thinkTime({ fen, policy, profile, random, clockMs, incMs });

  // its look: a Stockfish profile's own search; a person's, a short one beside the net
  let own = null, look = 0;
  if (play.maia == null) {
    const r = await api.search(fen, { multipv: 1, nodes: play.nodes || 100000, elo: play.elo || undefined });
    own = r.lines[0] ? r.lines[0].pv[0] : null;
    look = r.lines[0] ? ownScalar(r.lines[0].score) : 0;
    if (play.elo) {
      // under UCI_LimitStrength the reported score is not to be trusted (a won rook ending
      // came back as 0.00 one search in three): the look is a plain short search
      const a = await api.analyse(fen, { lines: 1, budget: LOOK });
      look = a.lines[0] ? ownOf(a.lines[0].score, fen) : look;
    }
  } else {
    const a = await api.analyse(fen, { lines: 1, budget: LOOK });
    look = a.lines[0] ? ownOf(a.lines[0].score, fen) : 0;
  }
  if (shouldResign(profile, [...looks, look], plies)) return { move: null, thinkMs: think(), look, resign: true, converting: false };

  // once it is converting it keeps at it while the game stays clearly won (a person who knows
  // the game is won does not stop being careful at +5.9). A Stockfish profile converts too:
  // UCI_Elo and a small node count throw away won games as readily as they throw away equal ones
  const was = looks.length > 0 && ownWin(looks[looks.length - 1]) >= CONVERT_KEEP + 10;
  const converting = ownWin(look) >= CONVERT_AT || (was && ownWin(look) >= CONVERT_KEEP);
  let move = null;
  if (converting) {
    const m = await api.analyse(fen, { lines: CONVERT_LOOK.lines, budget: { nodes: CONVERT_LOOK.nodes } });
    const lines = m.lines.map((l) => ({ moves: l.moves, own: ownOf(l.score, fen) }));
    // the prior of a player who knows how to win this: CONVERT_LIFT stronger, up to CONVERT_RATING
    // (a flat floor made everyone below it convert alike, and squeezed 1000–1650 into 100 points)
    const cr = Math.max(rating, Math.min(CONVERT_RATING, rating + CONVERT_LIFT));
    const prior = cr === rating ? policy : await api.humanMoves(fen, { self: cr, oppo: rating }, history.slice(-7));
    move = convertPick(prior, lines, { fen, history, sees: play.sees || (play.maia == null ? 5 : 1), temperature: play.convertT || 0.5, random });
  }
  if (!move && play.maia == null) move = own;
  if (!move) move = sample(leanPolicy(policy, fen, play.style), { temperature: play.temperature ?? 1, topP: play.topP ?? 1, random });
  return { move, thinkMs: think(), look, resign: false, converting };
}
