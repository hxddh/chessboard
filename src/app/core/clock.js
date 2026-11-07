/**
 * Chess clocks, pure. A clock is { base, inc, w, b, since, turn }: the ms
 * left on each side as of `since` (a ms timestamp the caller supplies, so
 * the store stays a function of its actions), and whose clock runs.
 * `since` null: stopped — before the first move, and once the game is over.
 * @module core/clock
 */

/** Presets: id → seconds base + seconds credited per move (19.0 time-control.js). */
export const PRESETS = {
  "3+2": { base: 180, inc: 2 }, "5+3": { base: 300, inc: 3 }, "10": { base: 600, inc: 0 },
  "15+10": { base: 900, inc: 10 }, "30": { base: 1800, inc: 0 },
};
export const PRESET_IDS = ["none", ...Object.keys(PRESETS)];

/** A fresh clock for preset `id`, or null for no clock. */
export function newClock(id) {
  const p = PRESETS[id];
  if (!p) return null;
  return { id, base: p.base * 1000, inc: p.inc * 1000, w: p.base * 1000, b: p.base * 1000, since: null, turn: "w" };
}

/** Time left for `color` at `now`. */
export function left(clock, color, now) {
  if (!clock) return null;
  const run = clock.since != null && clock.turn === color ? Math.max(0, now - clock.since) : 0;
  return Math.max(0, clock[color] - run);
}

/**
 * The clock after `color` moved at `now`: its time is charged and the
 * increment credited, and the other side's clock starts. The first move of
 * the game starts the clock rather than charging it (online play's rule).
 */
export function afterMove(clock, color, now) {
  if (!clock) return null;
  const other = color === "w" ? "b" : "w";
  if (clock.since == null) return { ...clock, turn: other, since: now };
  const rest = left(clock, color, now);
  return { ...clock, [color]: rest + clock.inc, turn: other, since: now };
}

/** Stopped at `now` (the game ended, or the page went away). */
export function stop(clock, now) {
  if (!clock || clock.since == null) return clock;
  return { ...clock, [clock.turn]: left(clock, clock.turn, now), since: null };
}

/** "4:59", "0:09.5" under ten seconds. */
export function format(ms) {
  if (ms == null) return "";
  const s = Math.max(0, ms) / 1000;
  if (s < 10) return "0:0" + s.toFixed(1);
  const m = Math.floor(s / 60), r = Math.floor(s % 60);
  if (m >= 60) return Math.floor(m / 60) + ":" + String(m % 60).padStart(2, "0") + ":" + String(r).padStart(2, "0");
  return m + ":" + String(r).padStart(2, "0");
}
