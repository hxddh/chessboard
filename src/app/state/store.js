/**
 * The store: one immutable state, changed only by named actions.
 *
 * An action is `(state, payload) => nextState` and must not mutate; the store
 * freezes what it returns, so a slip throws instead of corrupting the past.
 * Every dispatch produces a record { name, payload, prev, next } that goes to
 * subscribers (persistence, animation, undo) and to a bounded history.
 * Views read slices through `select`, which are computed signals.
 * @module store
 */
import { signal, computed } from "../lib/signal.js";

/** Freeze a value and every object it holds that is not already frozen. */
export function deepFreeze(v) {
  if (v === null || typeof v !== "object" || Object.isFrozen(v)) return v;
  Object.freeze(v);
  for (const k of Object.keys(v)) deepFreeze(v[k]);
  return v;
}

/** Shallow equality for selector results that are fresh arrays or objects. */
export function shallowEqual(a, b) {
  if (Object.is(a, b)) return true;
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  const ka = Object.keys(a), kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.is(a[k], b[k]));
}

/**
 * @param {object} initial the first state
 * @param {Record<string, (state: object, payload: any) => object>} actions
 * @param {{ historyLimit?: number, now?: () => number }} [opts]
 */
export function createStore(initial, actions, { historyLimit = 200, now = () => Date.now() } = {}) {
  const state = signal(deepFreeze(initial));
  const subscribers = new Set();
  const history = [];
  let reducing = null;

  function dispatch(name, payload) {
    const act = actions[name];
    if (!act) throw new Error("store: unknown action " + name);
    if (reducing) throw new Error("store: " + name + " dispatched inside " + reducing);
    const prev = state.peek();
    let next;
    reducing = name;
    try { next = act(prev, payload); } finally { reducing = null; }
    if (next === undefined) throw new Error("store: " + name + " returned nothing");
    deepFreeze(next);
    const record = Object.freeze({ name, payload, prev, next, at: now() });
    history.push(record);
    if (history.length > historyLimit) history.shift();
    state.value = next;
    for (const fn of [...subscribers]) fn(record);
    return next;
  }

  return {
    state: { get value() { return state.value; }, peek: () => state.peek() },
    get: () => state.peek(),
    dispatch,
    /** A computed slice; `equals` keeps the previous result when it is equal. */
    select(fn, equals = Object.is) {
      return computed((last) => {
        const v = fn(state.value);
        return last !== undefined && equals(last, v) ? last : v;
      });
    },
    subscribe(fn) { subscribers.add(fn); return () => subscribers.delete(fn); },
    history: () => history.slice(),
    actions: () => Object.keys(actions),
  };
}
