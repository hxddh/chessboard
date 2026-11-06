/**
 * FSRS-5, the spaced-repetition scheduler (v20-0-plan §2 L2: it replaces
 * 19.0's SM-2 ladder), written from the published formulas and following
 * py-fsrs 4.1.2's Scheduler step for step — learning steps, relearning
 * steps, same-day reviews — so its published test sequences hold here
 * (scripts/app/fsrs.test.mjs). No fuzz: a schedule is a pure function of the
 * answers and their times, which the learner model needs to be recomputable
 * from the event table.
 *
 *   R(t, S) = (1 + F·t/S)^D               D = −0.5, F = 19/81 (R(S, S) = 0.9)
 *   I(S)    = S/F · (r^(1/D) − 1)         = S at r = 0.9
 *   S0(G)   = w[G−1]                      D0(G) = w4 − e^(w5·(G−1)) + 1
 *   D'      = w7·D0(4) + (1−w7)·(D + (10−D)·(−w6·(G−3))/9)
 *   S'r     = S·(1 + e^w8·(11−D)·S^−w9·(e^(w10·(1−R)) − 1)·(w15 if Hard)·(w16 if Easy))
 *   S'f     = min(w11·D^−w12·((S+1)^w13 − 1)·e^(w14·(1−R)), S / e^(w17·w18))
 *   S'same  = S·e^(w17·(G − 3 + w18))     (a review less than a day after the last)
 *
 * Ratings: 1 Again, 2 Hard, 3 Good, 4 Easy. Times are milliseconds.
 * @module learn/fsrs
 */

export const W5 = Object.freeze([0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621]);
export const DECAY = -0.5;
export const FACTOR = 0.9 ** (1 / DECAY) - 1;
export const DAY = 86400000;
const MIN = 60000;
export const AGAIN = 1, HARD = 2, GOOD = 3, EASY = 4;
export const LEARNING = 1, REVIEW = 2, RELEARNING = 3;

/** Python's round(): halves go to the even neighbour (py-fsrs rounds intervals with it). */
export function roundHalfEven(x) {
  const f = Math.floor(x), d = x - f;
  if (d > 0.5) return f + 1;
  if (d < 0.5) return f;
  return f % 2 === 0 ? f : f + 1;
}

export function createScheduler({ w = W5, retention = 0.9, learningSteps = [1 * MIN, 10 * MIN],
  relearningSteps = [10 * MIN], maxInterval = 36500 } = {}) {
  const clampD = (d) => Math.min(Math.max(d, 1), 10);
  const initS = (g) => Math.max(w[g - 1], 0.1);
  const initD = (g) => clampD(w[4] - Math.exp(w[5] * (g - 1)) + 1);
  const interval = (s) => Math.min(Math.max(roundHalfEven((s / FACTOR) * (retention ** (1 / DECAY) - 1)), 1), maxInterval);
  const shortS = (s, g) => s * Math.exp(w[17] * (g - 3 + w[18]));
  const nextD = (d, g) => {
    const delta = -(w[6] * (g - 3));
    return clampD(w[7] * initD(EASY) + (1 - w[7]) * (d + ((10 - d) * delta) / 9));
  };
  const forgetS = (d, s, r) => Math.min(w[11] * d ** -w[12] * ((s + 1) ** w[13] - 1) * Math.exp((1 - r) * w[14]),
    s / Math.exp(w[17] * w[18]));
  const recallS = (d, s, r, g) => s * (1 + Math.exp(w[8]) * (11 - d) * s ** -w[9] * (Math.exp((1 - r) * w[10]) - 1) *
    (g === HARD ? w[15] : 1) * (g === EASY ? w[16] : 1));
  const nextS = (d, s, r, g) => (g === AGAIN ? forgetS(d, s, r) : recallS(d, s, r, g));

  /** The probability of recall at `now` (0 for a card never reviewed). */
  function retrievability(card, now) {
    if (card.last == null) return 0;
    const days = Math.max(0, Math.floor((now - card.last) / DAY));
    return (1 + (FACTOR * days) / card.s) ** DECAY;
  }

  /** A card that has never been reviewed. */
  const newCard = (now) => ({ state: LEARNING, step: 0, s: null, d: null, due: now, last: null, reps: 0, lapses: 0 });

  /** Steps through learning or relearning; returns [nextCard fields, interval ms]. */
  function stepped(c, g, steps) {
    if (!steps.length || c.step > steps.length) return [{ state: REVIEW, step: null }, interval(c.s) * DAY];
    if (g === AGAIN) return [{ step: 0 }, steps[0]];
    if (g === HARD) {
      if (c.step === 0 && steps.length === 1) return [{}, steps[0] * 1.5];
      if (c.step === 0) return [{}, (steps[0] + steps[1]) / 2];
      return [{}, steps[c.step]];
    }
    if (g === GOOD) {
      if (c.step + 1 === steps.length) return [{ state: REVIEW, step: null }, interval(c.s) * DAY];
      return [{ step: c.step + 1 }, steps[c.step + 1]];
    }
    return [{ state: REVIEW, step: null }, interval(c.s) * DAY];
  }

  /** The card after answer `g` at `now` (a new object; the input is untouched). */
  function review(card, g, now) {
    if (![AGAIN, HARD, GOOD, EASY].includes(g)) throw new Error("fsrs: rating " + g);
    const c = { ...card };
    const days = c.last != null ? Math.floor((now - c.last) / DAY) : null;
    if (c.s == null && c.d == null) { c.s = initS(g); c.d = initD(g); }
    else if (days != null && days < 1) { c.s = shortS(c.s, g); c.d = nextD(c.d, g); }
    else { c.s = nextS(c.d, c.s, retrievability(c, now), g); c.d = nextD(c.d, g); }
    let patch, ivl;
    if (c.state === LEARNING) [patch, ivl] = stepped(c, g, learningSteps);
    else if (c.state === REVIEW) {
      if (g === AGAIN && relearningSteps.length) { patch = { state: RELEARNING, step: 0 }; ivl = relearningSteps[0]; c.lapses++; }
      else { patch = {}; ivl = interval(c.s) * DAY; if (g === AGAIN) c.lapses++; }
    } else [patch, ivl] = stepped(c, g, relearningSteps);
    Object.assign(c, patch);
    c.due = now + ivl;
    c.last = now;
    c.reps++;
    return c;
  }

  return { newCard, review, retrievability, interval, w };
}

export const fsrs = createScheduler();
