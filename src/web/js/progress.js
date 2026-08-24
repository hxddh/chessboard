/**
 * 进步档案 — the practice record over time, not just in total.
 *
 * The app has measured plenty for versions — per-game accuracy since 1.x,
 * a lifetime miss/solve tally per category since 2.4 — but every figure was
 * either a single number or attached to one game. "Your defence miss rate
 * fell from 40% to 22% over three weeks" was true and invisible: the oldest
 * open finding of the 1.21 audit (「进步看不见」). Totals cannot show change;
 * change needs buckets.
 *
 * So: answers are ALSO banked into ISO-week buckets, alongside (never
 * instead of) the lifetime tally the picker reads. Weeks are the honest
 * grain — days are noise for a casual player, months hide a whole learning
 * arc. History starts when this module ships; nothing is back-filled,
 * because the lifetime tally genuinely cannot say when its misses happened.
 *
 * Pure: a record object in, a record object out. No store, no DOM, no i18n,
 * no Date.now() — the caller supplies `now`, the tests supply history.
 * @module progress
 */

/** Buckets beyond this age are dropped — half a year of weekly practice. */
const MAX_WEEKS = 26;

/**
 * ISO-8601 week key, e.g. "2026-W34".
 *
 * ISO rather than "days since epoch / 7" because week boundaries should fall
 * where the player's calendar says they do (Monday), in every timezone the
 * same way their OS calendar does.
 */
function weekKey(t) {
  const d = new Date(t);
  // shift to the Thursday of this week — ISO weeks belong to the year that
  // Thursday is in
  const th = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
  const jan4 = new Date(th.getFullYear(), 0, 4);
  const wk = 1 + Math.round(((th - jan4) / 86400000 - 3 + ((jan4.getDay() + 6) % 7)) / 7);
  return th.getFullYear() + "-W" + String(wk).padStart(2, "0");
}

/** Local calendar day key, e.g. "2026-08-20" — for the session record. */
function dayKey(t) {
  const d = new Date(t);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function emptyRecord() {
  return { v: 1, weeks: {}, days: {} };
}

/** The record, whatever was stored — invalid shapes fall back to empty. */
function coerce(prog) {
  if (prog && prog.v === 1 && prog.weeks && prog.days) return prog;
  return emptyRecord();
}

function weekOf(prog, now) {
  const k = weekKey(now);
  if (!prog.weeks[k]) prog.weeks[k] = { cats: {}, mined: 0, red: 0 };
  return prog.weeks[k];
}

/** One answer into this week's bucket — same call sites as the tally. */
function recordAnswer(prog, cat, missed, now) {
  const w = weekOf(prog, now);
  if (!w.cats[cat]) w.cats[cat] = { m: 0, s: 0 };
  w.cats[cat][missed ? "m" : "s"]++;
  return prune(prog, now);
}

/** Freshly banked mistakes (mistakes.js `added`) count into the week. */
function recordMined(prog, n, now) {
  if (n > 0) weekOf(prog, now).mined += n;
  return prune(prog, now);
}

/** A personal drill solved clean — the mistake is considered redeemed. */
function recordRedeemed(prog, now) {
  weekOf(prog, now).red++;
  return prune(prog, now);
}

/** A finished daily session, for the streak line. Idempotent per day. */
function recordSession(prog, now) {
  prog.days[dayKey(now)] = true;
  return prune(prog, now);
}

/** Consecutive practice days ending today (or yesterday, so a streak is not
 *  broken by reading it before today's session). */
function streak(prog, now) {
  let n = 0;
  let t = now;
  if (!prog.days[dayKey(t)]) t -= 86400000; // allow "yesterday" as the anchor
  while (prog.days[dayKey(t)]) { n++; t -= 86400000; }
  return n;
}

/** Weeks sorted oldest→newest, as [key, bucket] pairs. */
function weeksOf(prog) {
  return Object.keys(prog.weeks).sort().map((k) => [k, prog.weeks[k]]);
}

/**
 * This week vs last week, per category with data in either — the record
 * page's rows. rate is miss/(miss+solve), null where a week has no answers.
 */
function weekOverWeek(prog, now) {
  const ks = Object.keys(prog.weeks).sort();
  const cur = weekKey(now);
  const prev = ks.filter((k) => k < cur).pop() || null;
  const cats = new Set();
  for (const k of [prev, cur]) {
    if (k && prog.weeks[k]) for (const c of Object.keys(prog.weeks[k].cats)) cats.add(c);
  }
  const rate = (k, c) => {
    const t = k && prog.weeks[k] && prog.weeks[k].cats[c];
    return t && t.m + t.s > 0 ? t.m / (t.m + t.s) : null;
  };
  return [...cats].map((c) => ({ cat: c, now: rate(cur, c), prev: rate(prev, c) }));
}

/** Accuracy series from the stats record: analysed games only, in play order. */
function accSeries(games, maxN) {
  const xs = (games || []).filter((g) => typeof g.acc === "number" && typeof g.t === "number");
  xs.sort((a, b) => a.t - b.t);
  return xs.slice(-(maxN || 30)).map((g) => ({ t: g.t, acc: g.acc }));
}

/** Drop buckets older than MAX_WEEKS and days older than 60 — a record, not an archive. */
function prune(prog, now) {
  const ks = Object.keys(prog.weeks).sort();
  for (const k of ks.slice(0, Math.max(0, ks.length - MAX_WEEKS))) delete prog.weeks[k];
  for (const d of Object.keys(prog.days)) {
    if (now - new Date(d + "T12:00:00").getTime() > 60 * 86400000) delete prog.days[d];
  }
  return prog;
}

export const ChessProgress = {
  MAX_WEEKS, weekKey, dayKey, emptyRecord, coerce,
  recordAnswer, recordMined, recordRedeemed, recordSession,
  streak, weeksOf, weekOverWeek, accSeries, prune,
};
