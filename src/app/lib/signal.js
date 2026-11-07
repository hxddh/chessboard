/**
 * Signals: signal / computed / effect / batch.
 *
 * Push-pull with three node states (CLEAN, CHECK, DIRTY). A write marks its
 * direct readers DIRTY and everything further downstream CHECK; nothing is
 * recomputed then. Effects are queued and, once the outermost write or batch
 * ends, each one pulls: a CHECK node first brings its sources up to date and
 * only recomputes if one of them actually changed. So a computed never runs
 * against a half-updated graph (no glitches), never runs when nobody reads it,
 * and a computed that recomputes to the same value stops the wave there.
 *
 * Effects run in the order they were first scheduled. An effect created while
 * another effect runs belongs to it and is disposed before the parent re-runs.
 * @module signal
 */

const CLEAN = 0, CHECK = 1, DIRTY = 2;

let current = null;      // the computed or effect whose fn is running
let batchDepth = 0;
const queue = [];        // effects waiting to run
let flushing = false;

class Node {
  constructor(fn, value) {
    this.fn = fn;
    this.value = value;
    this.sources = [];
    this.observers = new Set();
    this.state = fn ? DIRTY : CLEAN;
    this.running = false;
  }

  /** Mark this node and, more weakly, everything that reads it. */
  stale(state) {
    if (this.state >= state) return;
    const was = this.state;
    this.state = state;
    if (this.effect) { if (was === CLEAN) queue.push(this); return; }
    for (const o of this.observers) o.stale(CHECK);
  }

  read() {
    // refresh before subscribing: a recompute marks its observers DIRTY, and
    // the reader that is running right now must not be one of them
    if (this.running) throw new Error("signal: cycle detected");
    if (this.fn) this.refresh();
    if (current && !current.sources.includes(this)) {
      current.sources.push(this);
      this.observers.add(current);
    }
    return this.value;
  }

  /** Bring this node up to date, recomputing only if a source changed. */
  refresh() {
    if (this.state === CHECK) {
      for (const s of this.sources) {
        if (s.fn) s.refresh();
        if (this.state === DIRTY) break;
      }
    }
    // CLEAN before running, so a write made during the run marks it again
    if (this.state === DIRTY) { this.state = CLEAN; this.run(); }
    else this.state = CLEAN;
  }

  run() {
    for (const s of this.sources) s.observers.delete(this);
    this.sources = [];
    const prev = current;
    current = this;
    this.running = true;
    try {
      const next = this.fn(this.value);
      if (!Object.is(next, this.value)) {
        this.value = next;
        for (const o of this.observers) o.state = DIRTY;
      }
    } finally {
      this.running = false;
      current = prev;
    }
  }
}

class EffectNode extends Node {
  constructor(fn) {
    super(fn, undefined);
    this.effect = true;
    this.children = [];
    this.cleanups = [];
    this.disposed = false;
    if (current && current.effect) current.children.push(this);
  }

  run() {
    this.reset();
    for (const s of this.sources) s.observers.delete(this);
    this.sources = [];
    const prev = current;
    current = this;
    try {
      const out = this.fn();
      if (typeof out === "function") this.cleanups.push(out);
    } finally {
      current = prev;
    }
  }

  /** Dispose child effects and run cleanups, newest first. */
  reset() {
    for (const c of this.children.splice(0)) c.dispose();
    for (const f of this.cleanups.splice(0).reverse()) f();
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
    for (const s of this.sources) s.observers.delete(this);
    this.sources = [];
    this.state = CLEAN;
  }
}

function flush() {
  if (flushing || batchDepth) return;
  flushing = true;
  let error = null;
  try {
    for (let i = 0; i < queue.length; i++) {
      if (i > 100000) throw new Error("signal: effects keep re-triggering each other");
      const e = queue[i];
      if (e.disposed) continue;
      try { e.refresh(); } catch (err) { if (!error) error = err; e.state = CLEAN; }
    }
  } finally {
    queue.length = 0;
    flushing = false;
  }
  if (error) throw error;
}

/** A writable value. `.value` reads (and tracks), `.peek()` reads without tracking. */
export function signal(initial) {
  const n = new Node(null, initial);
  return {
    get value() { return n.read(); },
    set value(v) {
      if (Object.is(v, n.value)) return;
      n.value = v;
      for (const o of n.observers) o.stale(DIRTY);
      flush();
    },
    peek: () => n.value,
    update(fn) { this.value = fn(n.value); },
  };
}

/** A derived value, computed lazily and cached until a source changes. */
export function computed(fn) {
  const n = new Node(fn, undefined);
  return {
    get value() { return n.read(); },
    peek() { return untrack(() => n.read()); },
  };
}

/** Run `fn` now and again whenever what it read changes. Returns a disposer. */
export function effect(fn) {
  const e = new EffectNode(fn);
  e.state = CLEAN;
  // as a batch, so a write inside the first run queues the effect instead of
  // re-entering it
  try { batch(() => e.run()); } catch (err) { e.dispose(); throw err; }
  return () => e.dispose();
}

/** Register a cleanup for the running effect (before its next run or disposal). */
export function onCleanup(fn) {
  if (current && current.effect) current.cleanups.push(fn);
}

/** Group writes: effects run once, after the outermost batch. */
export function batch(fn) {
  batchDepth++;
  try { return fn(); } finally {
    batchDepth--;
    flush();
  }
}

/** Read signals without subscribing the running computed or effect to them. */
export function untrack(fn) {
  const prev = current;
  current = null;
  try { return fn(); } finally { current = prev; }
}
