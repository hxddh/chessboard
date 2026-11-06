/**
 * The learner model as the pages see it: one per db, folded from the event
 * table (learn/model.js) and kept in step — `refresh()` folds whatever was
 * appended since (the play page's reviews and games included), `record(e)`
 * appends an event and folds it. The state is a signal; pages read it.
 * @module learn/service
 */
import { signal } from "../lib/signal.js";
import { initialState, apply } from "./model.js";
import { OPPONENTS } from "../core/opponents.js";

const PAGE = 1000;
const byDb = new WeakMap();

export const opponentRating = (id) => {
  const o = OPPONENTS.find((x) => x.id === id);
  return o && Number.isFinite(o.rating) ? o.rating : null;
};
/** The opponent nearest a rating (for a targeted game), never above it by more than 150. */
export function opponentFor(rating) {
  const list = OPPONENTS.filter((o) => Number.isFinite(o.rating)).sort((a, b) => a.rating - b.rating);
  let best = list[0];
  for (const o of list) if (o.rating <= rating + 150) best = o;
  return best;
}

export function learnerFor(db, { tz = new Date().getTimezoneOffset() } = {}) {
  if (byDb.has(db)) return byDb.get(db);
  const opts = { tz, opponentRating };
  const st = initialState();
  const state = signal(0);            // a version number: the state object is folded in place
  let chain = Promise.resolve();

  async function pull() {
    for (;;) {
      const rows = await db.query("events.since", { after: st.lastId, limit: PAGE });
      for (const e of rows) apply(st, e, opts);
      if (rows.length < PAGE) break;
    }
    state.value++;
  }
  const api = {
    state,
    get model() { return st; },
    tz,
    /** Fold what the table holds and this has not seen. */
    refresh() { chain = chain.then(pull, pull); return chain; },
    /** Append an event and fold it (with anything else new). */
    async record(e) { await db.append(e); await api.refresh(); return st; },
  };
  byDb.set(db, api);
  return api;
}
