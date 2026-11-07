/**
 * How long an opponent thinks (v20-0-plan §3 P1): by the position and by the
 * character, the way a person's clock goes — quick in the opening and for an
 * obvious reply, slow where many moves look playable and pieces hang in the
 * balance. 0.5–6 s, scaled by the profile's `pace`, never a constant.
 *
 * The inputs are what the opponent "sees":
 *   - the human move distribution (Maia-3, for the profile's rating): how
 *     many moves are plausible (the moves that make up 80% of the mass, and
 *     the distribution's perplexity) and how sure the likeliest one is;
 *   - material tension: how many captures are on the board for the side to move;
 *   - check (few replies: quick, unless there are many) and the phase.
 *
 * Maia-3's own "ponder" head is not used: the 5M checkpoint was trained with
 * include_time_info = False, the label's units are not documented anywhere
 * in the release (no training code, no model card entry), and on a probe set
 * its output barely moves (0.32–0.92 whatever the position; a bare K+R v K
 * scores highest). v20-0-plan §10 has the probe.
 * @module opponents/think
 */
import { Chess } from "../core/chess.js";

export const THINK_MIN = 500, THINK_MAX = 6000;

/** The facts of a position the think time is made of. Pure; cheap (one chess.js move list). */
export function complexity(fen, policy = []) {
  const g = new Chess(fen);
  const moves = g.moves({ verbose: true });
  const legal = moves.length;
  const captures = moves.filter((m) => m.captured).length;
  const ps = policy.map((x) => x.p).filter((p) => p > 0);
  const top = ps.length ? ps[0] : 1 / Math.max(1, legal);
  let mass = 0, plausible = 0;
  for (const p of ps) { if (mass >= 0.8) break; mass += p; plausible++; }
  if (!ps.length) plausible = Math.min(legal, 8);
  const entropy = -ps.reduce((a, p) => a + p * Math.log(p), 0);
  const perplexity = ps.length ? Math.exp(entropy) : Math.min(legal, 8);
  const fullmove = Number(String(fen).split(" ")[5]) || 1;
  const men = String(fen).split(" ")[0].replace(/[^a-zA-Z]/g, "").length;
  return { legal, captures, top, plausible, perplexity, check: g.in_check(), fullmove, men };
}

const clamp01 = (x) => Math.max(0, Math.min(1, x));

/**
 * 0 (nothing to think about) … 1 (a knot): the share of the 0.5–6 s range a
 * person of average pace would use here.
 */
export function difficulty(c) {
  if (c.legal <= 1) return 0;
  const spread = clamp01(Math.log(Math.max(1, c.perplexity)) / Math.log(14));   // 1 move … ~14 equally likely
  const choice = clamp01((c.plausible - 1) / 9);
  const doubt = clamp01(1 - c.top);                                              // the likeliest move is not obvious
  const tension = clamp01(c.captures / 6);
  let d = 0.3 * spread + 0.2 * choice + 0.3 * doubt + 0.2 * tension;
  if (c.check) d *= c.legal <= 3 ? 0.35 : 0.75;                                  // in check: few replies to weigh
  // the phase: book moves come quickly; a bare ending is calmer than a full board
  if (c.fullmove <= 6) d *= 0.3;
  else if (c.fullmove <= 10) d *= 0.6;
  if (c.men <= 6) d *= 0.75;
  return clamp01(d);
}

/** A standard normal from a uniform source (Box–Muller). */
function gauss(random) {
  const u = Math.max(1e-9, random()), v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Milliseconds the opponent takes over this move.
 * @param {object} o
 * @param {string} o.fen
 * @param {{move,p}[]} [o.policy]  the human distribution for the profile's rating, likeliest first
 * @param {{ pace?: number }} [o.profile]  pace 1 = average; 0.7 quick, 1.3 deliberate
 * @param {() => number} [o.random]
 * @param {number} [o.clockMs]  its time left, when there is a clock
 * @param {number} [o.incMs]
 */
export function thinkTime({ fen, policy = [], profile = {}, random = Math.random, clockMs = null, incMs = 0 }) {
  const c = complexity(fen, policy);
  const d = difficulty(c);
  const pace = profile.pace || 1;
  // a lognormal wobble: two similar positions never take exactly the same time
  const wobble = Math.exp(0.28 * gauss(random));
  let ms = (THINK_MIN + (THINK_MAX - THINK_MIN) * Math.pow(d, 1.25)) * pace * wobble;
  if (c.legal <= 1) ms = THINK_MIN * (0.9 + 0.3 * random());
  ms = Math.max(THINK_MIN, Math.min(THINK_MAX, ms));
  if (clockMs != null && Number.isFinite(clockMs)) {
    // on a clock: never more than its share of what is left (and a flag lost to a pause would be absurd)
    const share = Math.max(0, clockMs) / 40 + 0.75 * Math.max(0, incMs || 0);
    ms = Math.min(ms, Math.max(150, share));
  }
  return Math.round(ms);
}
