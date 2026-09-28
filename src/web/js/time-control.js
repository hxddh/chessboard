/**
 * Time controls: the presets, and a control of the player's own.
 *
 * v8-0-plan B4: the clock stopped at ten minutes a side and could not be set
 * to anything else. 15+10 and 30+0 join the presets (the two longest online
 * rapid controls), and a custom control is written into its own id —
 * `c<minutes>+<increment>`, e.g. `c20+5` — so it rides in the settings and in
 * a saved game's `clock.tc` exactly like a preset does: one string, and no
 * second field that could disagree with it.
 * @module time-control
 */

/** preset id → base seconds + increment seconds credited per move */
const PRESETS = {
  "3": { base: 180, inc: 0 }, "3+2": { base: 180, inc: 2 },
  "5": { base: 300, inc: 0 }, "5+3": { base: 300, inc: 3 },
  "10": { base: 600, inc: 0 }, "15+10": { base: 900, inc: 10 },
  "30": { base: 1800, inc: 0 },
};

/** A custom control's bounds: a minute to three hours, no increment to a minute. */
const MIN = { lo: 1, hi: 180 };
const INC = { lo: 0, hi: 60 };

const CUSTOM_RE = /^c(\d{1,3})\+(\d{1,2})$/;

/** @returns {{base: number, inc: number}|null} seconds, or null for no clock */
function parse(id) {
  if (typeof id !== "string") return null;
  if (Object.prototype.hasOwnProperty.call(PRESETS, id)) return PRESETS[id];
  const m = CUSTOM_RE.exec(id);
  if (!m) return null;
  const min = Number(m[1]), inc = Number(m[2]);
  if (min < MIN.lo || min > MIN.hi || inc < INC.lo || inc > INC.hi) return null;
  return { base: min * 60, inc };
}

function isCustom(id) { return typeof id === "string" && CUSTOM_RE.test(id) && !!parse(id); }

/** The id of a custom control, clamped into bounds; minutes and seconds in. */
function customId(minutes, inc) {
  const m = Math.round(Math.min(MIN.hi, Math.max(MIN.lo, Number(minutes) || MIN.lo)));
  const i = Math.round(Math.min(INC.hi, Math.max(INC.lo, Number(inc) || 0)));
  return "c" + m + "+" + i;
}

/** "15+10", "30", "20+5" — how a control reads on a button or in a PGN. */
function label(id) {
  const tc = parse(id);
  if (!tc) return "";
  const m = tc.base / 60;
  return tc.inc ? m + "+" + tc.inc : String(m);
}

export const TimeControl = { PRESETS, MIN, INC, parse, isCustom, customId, label };
