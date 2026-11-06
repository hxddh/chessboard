/**
 * One queue (v20-0-plan §2 L3): what to do next is decided here and only
 * here — the reviews that are due, one new skill, and a game or an endgame,
 * interleaved — and the day's 「今日一课」 is the first 10–15 minutes of it.
 * Doing an item appends its event, the model folds it, and the queue is
 * asked again: the plan is never stored.
 *
 *   plan(st, now, { tz }) → [{ id, kind, skill, why }]   why: review | lesson | new | weak | drill | game
 *   (and `ahead` from next(): a lit skill's position, when nothing else is left)
 *   next(st, now, { tz }) → the first of the plan, or of the day after it (more, when today's is done)
 * @module learn/queue
 */
import { SKILL, SKILLS } from "../content/skills.js";
import { ITEMS, PRACTICE, DRILLS } from "../content/practice.js";
import { dueCards, frontier, isLit, isReached, isWeak, today, visibleRating, MINUTES } from "./model.js";

export const DAY_MINUTES = 12;
const MAX_DUE = 6, MAX_NEW = 6;

/** An item by id: a position from the content, a card made from your own game, a lesson or a game. */
export function itemOf(st, id) {
  if (ITEMS[id]) return ITEMS[id];
  if (st.extra[id]) return st.extra[id];
  if (id.startsWith("lesson:")) {
    const skill = id.slice(7);
    return SKILL[skill] ? { id, kind: "lesson", skill, fen: firstFen(skill), needs: [] } : null;
  }
  if (id.startsWith("game:")) return { id, kind: "game", rating: Number(id.slice(5)), skill: null, needs: [] };
  return null;
}
const firstFen = (skill) => { const first = (PRACTICE[skill] || [])[0]; return first ? ITEMS[first].fen : null; };

const solved = (st, id) => !!(st.items[id] && st.items[id].ok);
const tried = (st, id) => !!st.items[id];

/** The new skill's next items: its explanation (once), then the positions not yet solved, then a drill. */
export function skillItems(st, skill, max = MAX_NEW) {
  const out = [];
  const s = st.skills[skill];
  if (!(s && s.lesson)) out.push("lesson:" + skill);
  const list = PRACTICE[skill] || [];
  const fresh = list.filter((id) => !tried(st, id));
  const again = list.filter((id) => tried(st, id) && !solved(st, id) && !st.cards[id]);
  out.push(...fresh, ...again);
  for (const d of DRILLS[skill] || []) if (!solved(st, d)) { out.push(d); break; }
  if (out.length === (s && s.lesson ? 0 : 1)) {
    // every position answered and still not lit: go round the unsolved, then all of them
    const unsolved = list.filter((id) => !solved(st, id));
    out.push(...(unsolved.length ? unsolved : list));
  }
  return out.slice(0, max);
}

/** The game slot: once a day, from the day the player can win one (将死 lit). */
function slot(st, now, tz, done) {
  const day = today(st, now, tz);
  if (isLit(st, "mate") && !day.games && !day.items.some((i) => i.startsWith("game:"))) {
    return { id: "game:" + Math.max(400, Math.round(visibleRating(st) / 100) * 100), why: "game" };
  }
  // else an endgame drill of a reached skill not yet won, one a day
  if (day.items.some((i) => i.startsWith("dr:"))) return null;
  for (const s of SKILLS) {
    if (!isReached(st, s.id)) continue;
    for (const d of DRILLS[s.id] || []) if (!solved(st, d) && !done.has(d)) return { id: d, why: "drill" };
  }
  return null;
}

/**
 * The plan from now: reviews and the new skill alternating, a weak skill's
 * position, the game or drill last; cut to what is left of today's minutes
 * (`full`: not cut — the queue after today's lesson).
 */
export function plan(st, now, { tz = 0, full = false } = {}) {
  const day = today(st, now, tz);
  const doneToday = new Set(day.items);
  const due = dueCards(st, now).slice(0, MAX_DUE).map((id) => ({ id, why: "review" }));
  const f = frontier(st);
  const fresh = f.length ? skillItems(st, f[0]).map((id) => ({ id, why: id.startsWith("lesson:") ? "lesson" : "new" })) : [];
  const weakSkill = SKILLS.find((s) => isWeak(st, s.id) && (PRACTICE[s.id] || []).length);
  const weak = weakSkill ? (PRACTICE[weakSkill.id] || []).filter((id) => !st.cards[id] || st.cards[id].due <= now).slice(0, 1)
    .map((id) => ({ id, why: "weak" })) : [];
  const out = [], seen = new Set();
  const push = (x) => { if (x && !seen.has(x.id)) { seen.add(x.id); out.push(x); } };
  // a lesson is followed by its first position; then review, new, review, new …
  let i = 0, j = 0;
  if (fresh[0] && fresh[0].why === "lesson") { push(fresh[j++]); if (fresh[j]) push(fresh[j++]); }
  while (i < due.length || j < fresh.length) {
    if (i < due.length) push(due[i++]);
    if (j < fresh.length) push(fresh[j++]);
  }
  weak.forEach(push);
  // the game or drill comes fourth: today's lesson always reaches it
  const g = slot(st, now, tz, doneToday);
  if (g && !seen.has(g.id)) { seen.add(g.id); out.splice(Math.min(3, out.length), 0, g); }
  const items = out.map((x) => ({ ...x, ...pick(itemOf(st, x.id)) })).filter((x) => x.kind);
  if (full) return items;
  let left = DAY_MINUTES - day.minutes;
  const cut = [];
  for (const x of items) {
    if (left <= 0) break;
    cut.push(x);
    left -= MINUTES[x.kind] || 1;
  }
  return cut;
}
const pick = (it) => (it ? { kind: it.kind, skill: it.skill || null } : {});

/**
 * When nothing is due and every reachable skill is lit (a strong placement,
 * or a long day): the positions of lit skills not yet tried, nearest your
 * rating first; then the ones tried longest ago.
 */
export function practiceAhead(st) {
  const r = visibleRating(st);
  const lit = SKILLS.filter((s) => isLit(st, s.id)).flatMap((s) => PRACTICE[s.id] || []);
  const fresh = lit.filter((id) => !tried(st, id)).sort((a, b) => Math.abs(ITEMS[a].rating - r) - Math.abs(ITEMS[b].rating - r) || (a < b ? -1 : 1));
  if (fresh.length) return fresh[0];
  const old = lit.sort((a, b) => st.items[a].last - st.items[b].last || (a < b ? -1 : 1));
  return old[0] || null;
}

/** What to do now. `more`: today's lesson is done and this is from the rest of the queue. */
export function next(st, now, o = {}) {
  const p = plan(st, now, o);
  if (p.length) return { ...p[0], more: false };
  const rest = plan(st, now, { ...o, full: true });
  if (rest.length) return { ...rest[0], more: true };
  const id = practiceAhead(st);
  return id ? { id, why: "ahead", kind: ITEMS[id].kind, skill: ITEMS[id].skill, more: true } : null;
}

/** Today's lesson: minutes done, minutes planned, items left. */
export function todayOf(st, now, o = {}) {
  const day = today(st, now, o.tz || 0);
  const p = plan(st, now, o);
  const left = p.reduce((m, x) => m + (MINUTES[x.kind] || 1), 0);
  return { done: Math.round(day.minutes), left: Math.round(left), count: p.length, answered: day.answers };
}
