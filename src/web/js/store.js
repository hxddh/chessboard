/**
 * Application state, in one place, in three slices.
 *
 * Until 1.25 the state was 56 module-level `let`s scattered down app.js's
 * 5 300 lines, and "what is the state of this app" could only be answered by
 * reading the whole file. Worse, nothing could observe a change: every write
 * was followed, by hand, by a call to sync() — and sync() therefore had to
 * rebuild everything, because the one thing it never knew was what had
 * actually changed.
 *
 * The slices are drawn along the lines the app already thinks in:
 *
 *   game     the position, the move list, the clock, how it ended.
 *            Everything here is true of the *chess*, and survives a reload.
 *   session  what the user is doing right now — mode, and the lesson, puzzle,
 *            editor and analysis runtimes that belong to each mode. Exactly
 *            one of learn/puzzle/editor is non-null at a time.
 *   ui       what the interface looks like — panel, tab, dialogs, theme,
 *            language. None of it changes a single chess fact.
 *
 * A slice is a plain object, so reads stay as cheap and as ordinary as the
 * `let`s were (`game.viewIndex`, not `store.get("game").viewIndex`). What it
 * adds is `commit()`: a write followed by a notification, so a view can ask to
 * hear about the slice it draws from instead of being redrawn wholesale.
 *
 * Deliberately not a framework. No reducers, no action types, no immutability
 * — those buy time-travel and middleware, and this app wants neither. It wants
 * one place where the state lives and one way to hear that it moved.
 *
 * @module store
 */

/**
 * @param {Record<string, object>} initial slice name → its starting fields
 */
export function createStore(initial) {
  /** @type {Record<string, Set<Function>>} */
  const listeners = {};
  const slices = {};
  for (const name of Object.keys(initial)) {
    slices[name] = initial[name];
    listeners[name] = new Set();
  }

  /**
   * Announce that a slice moved.
   *
   * Callers mutate the slice object directly and then say which one they
   * touched. That is a deliberate half-measure: the alternative — routing
   * every one of a thousand assignments through a setter — buys nothing here,
   * because the code that reads a slice is in the same module as the code that
   * writes it. What the app was missing was not encapsulation, it was a
   * *signal*.
   *
   * Re-entrancy: a listener that commits again is running inside this loop, so
   * the set is copied first. Depth is capped rather than trusted — a view that
   * writes the state it draws from is a bug, and an infinite loop is the worst
   * way to find out about it.
   */
  let depth = 0;
  function commit(name, why) {
    const set = listeners[name];
    if (!set) throw new Error("commit to unknown slice: " + name);
    if (depth > 8) throw new Error("commit loop on slice " + name + " (" + why + ")");
    depth++;
    try { for (const fn of [...set]) fn(slices[name], why); }
    finally { depth--; }
  }

  /** Listen to one slice. Returns the unsubscribe. */
  function subscribe(name, fn) {
    if (!listeners[name]) throw new Error("subscribe to unknown slice: " + name);
    listeners[name].add(fn);
    return () => listeners[name].delete(fn);
  }

  /** Everything, for the persistence layer and for tests. */
  function snapshot() {
    const out = {};
    for (const k of Object.keys(slices)) out[k] = { ...slices[k] };
    return out;
  }

  // The slices sit directly on the returned object — `store.game.viewIndex`,
  // not `store.slices.game.viewIndex`. A read of the state is the most common
  // thing this module is asked for and it should not cost a word.
  for (const name of Object.keys(slices)) {
    if (name === "commit" || name === "subscribe" || name === "snapshot") {
      throw new Error("slice name collides with a store method: " + name);
    }
  }
  return { ...slices, commit, subscribe, snapshot };
}
