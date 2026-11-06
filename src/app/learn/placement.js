/**
 * The placement (19.0 onboarding + trainer/runs.js 「定级」, kept): three
 * answers — never played, know the moves, play often — and for the latter
 * two six puzzles whose difficulty follows the answers: each moves the aim
 * by a step that halves as it goes (300, 200, 150, 100, 75, 50), and the
 * aim after the sixth is the placed rating. `learn.place` then lights every
 * skill below it (learn/model.js).
 * @module learn/placement
 */
import { ITEMS, PLACEMENT } from "../content/practice.js";
import { START_RATING } from "./model.js";

export const PLACE_BASE = { knows: 900, often: 1400 };
export const STEPS = [300, 200, 150, 100, 75, 50];
const LO = 400, HI = 2400;

export const newRun = (how) => ({ how, est: PLACE_BASE[how], k: 0, used: [], over: false });

/** The puzzle nearest the aim that has not been served (ties: the pool's order). */
export function pickNext(run) {
  let best = null;
  for (const id of PLACEMENT) {
    if (run.used.includes(id)) continue;
    const d = Math.abs(ITEMS[id].rating - run.est);
    if (!best || d < best.d) best = { id, d };
  }
  return best ? best.id : null;
}

/** The run after an answer. */
export function step(run, id, ok) {
  const est = Math.max(LO, Math.min(HI, run.est + (ok ? 1 : -1) * STEPS[Math.min(run.k, STEPS.length - 1)]));
  const k = run.k + 1;
  return { ...run, est, k, used: [...run.used, id], over: k >= STEPS.length };
}

/** The `learn.place` event for a finished run, or for 没下过棋. */
export const placeEvent = (run) => (run ? { type: "learn.place", rating: run.est, how: run.how } : { type: "learn.place", rating: START_RATING, how: "new" });
