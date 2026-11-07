import { signal, computed, effect, batch, untrack, onCleanup } from "../../src/app/lib/signal.js";

export default function (test) {
  test("signal: read, write, peek, update", (a) => {
    const s = signal(1);
    a.equal(s.value, 1);
    s.value = 2;
    a.equal(s.peek(), 2);
    s.update((v) => v + 1);
    a.equal(s.value, 3);
  });

  test("computed is lazy and cached", (a) => {
    const s = signal(1);
    let runs = 0;
    const c = computed(() => { runs++; return s.value * 2; });
    a.equal(runs, 0, "not run before it is read");
    a.equal(c.value, 2);
    a.equal(c.value, 2);
    a.equal(runs, 1, "cached");
    s.value = 5;
    a.equal(runs, 1, "a write does not recompute");
    a.equal(c.value, 10);
    a.equal(runs, 2);
  });

  test("effect runs now and on change; same value does not re-run", (a) => {
    const s = signal(1);
    const seen = [];
    const stop = effect(() => { seen.push(s.value); });
    s.value = 2;
    s.value = 2;
    s.value = 3;
    stop();
    s.value = 4;
    a.deepEqual(seen, [1, 2, 3]);
  });

  test("glitch-free diamond: one run, consistent values", (a) => {
    const s = signal(1);
    const b = computed(() => s.value + 1);
    const c = computed(() => s.value * 10);
    const d = computed(() => b.value + c.value);
    const seen = [];
    effect(() => { seen.push([b.value, c.value, d.value]); });
    s.value = 2;
    a.deepEqual(seen, [[2, 10, 12], [3, 20, 23]]);
  });

  test("deep chain with unequal depths sees no stale mix", (a) => {
    const s = signal(0);
    const x1 = computed(() => s.value + 1);
    const x2 = computed(() => x1.value + 1);
    const x3 = computed(() => x2.value + 1);
    const seen = [];
    effect(() => { seen.push(s.value + ":" + x3.value); });
    s.value = 10;
    a.deepEqual(seen, ["0:3", "10:13"]);
  });

  test("a computed that settles to the same value stops the wave", (a) => {
    const s = signal(1);
    const parity = computed(() => s.value % 2);
    let runs = 0;
    effect(() => { parity.value; runs++; });
    s.value = 3;
    s.value = 5;
    a.equal(runs, 1);
    s.value = 6;
    a.equal(runs, 2);
  });

  test("batch: effects run once, after the outermost batch", (a) => {
    const x = signal(1), y = signal(1);
    const seen = [];
    effect(() => { seen.push(x.value + y.value); });
    batch(() => {
      x.value = 2;
      batch(() => { y.value = 3; });
      a.deepEqual(seen, [2], "nothing ran inside the batch");
    });
    a.deepEqual(seen, [2, 5]);
  });

  test("batch returns the function's value", (a) => {
    a.equal(batch(() => 42), 42);
  });

  test("effects run in the order they were scheduled", (a) => {
    const s = signal(0);
    const order = [];
    effect(() => { s.value; order.push("a"); });
    effect(() => { s.value; order.push("b"); });
    effect(() => { s.value; order.push("c"); });
    order.length = 0;
    s.value = 1;
    a.deepEqual(order, ["a", "b", "c"]);
  });

  test("dynamic dependencies are re-tracked each run", (a) => {
    const flag = signal(true), x = signal("x"), y = signal("y");
    const seen = [];
    effect(() => { seen.push(flag.value ? x.value : y.value); });
    y.value = "y2";
    a.deepEqual(seen, ["x"], "y not read yet");
    flag.value = false;
    x.value = "x2";
    a.deepEqual(seen, ["x", "y2"], "x no longer read");
    y.value = "y3";
    a.deepEqual(seen, ["x", "y2", "y3"]);
  });

  test("cleanup: returned function and onCleanup run before re-run and on dispose", (a) => {
    const s = signal(1);
    const log = [];
    const stop = effect(() => {
      const v = s.value;
      onCleanup(() => log.push("c1:" + v));
      return () => log.push("ret:" + v);
    });
    s.value = 2;
    a.deepEqual(log, ["ret:1", "c1:1"], "newest first");
    stop();
    a.deepEqual(log, ["ret:1", "c1:1", "ret:2", "c1:2"]);
    stop();
    a.equal(log.length, 4, "dispose twice is harmless");
  });

  test("nested effects are disposed when the parent re-runs", (a) => {
    const outer = signal(0), inner = signal(0);
    const log = [];
    const stop = effect(() => {
      const o = outer.value;
      effect(() => {
        log.push("inner " + o + "/" + inner.value);
        return () => log.push("bye " + o);
      });
    });
    inner.value = 1;
    outer.value = 1;
    inner.value = 2;
    a.deepEqual(log, ["inner 0/0", "bye 0", "inner 0/1", "bye 0", "inner 1/1", "bye 1", "inner 1/2"]);
    stop();
    a.equal(log[log.length - 1], "bye 1", "disposing the parent disposes the child");
    inner.value = 3;
    a.equal(log.filter((l) => l.startsWith("inner")).length, 4, "child is gone");
  });

  test("an effect writing a signal schedules dependants, not itself recursively", (a) => {
    const s = signal(1), doubled = signal(0);
    const seen = [];
    effect(() => { doubled.value = s.value * 2; });
    effect(() => { seen.push(doubled.value); });
    s.value = 3;
    a.deepEqual(seen, [2, 6]);
  });

  test("an effect writing what it read converges", (a) => {
    const s = signal(0);
    effect(() => { if (s.value < 5) s.value = s.value + 1; });
    a.equal(s.peek(), 5);
  });

  test("untrack reads without subscribing", (a) => {
    const s = signal(1), t = signal(1);
    let runs = 0;
    effect(() => { s.value; untrack(() => t.value); runs++; });
    t.value = 2;
    a.equal(runs, 1);
    s.value = 2;
    a.equal(runs, 2);
  });

  test("computed peek does not subscribe", (a) => {
    const s = signal(1);
    const c = computed(() => s.value + 1);
    let runs = 0;
    effect(() => { c.peek(); runs++; });
    s.value = 2;
    a.equal(runs, 1);
    a.equal(c.peek(), 3);
  });

  test("unread computeds are not recomputed by writes", (a) => {
    const s = signal(1);
    let runs = 0;
    const c = computed(() => { runs++; return s.value; });
    const stop = effect(() => { c.value; });
    stop();
    s.value = 2; s.value = 3;
    a.equal(runs, 1, "no reader, no work");
  });

  test("a cycle throws", (a) => {
    let c;
    const s = signal(0);
    c = computed(() => s.value + (s.value > 0 ? c.value : 0));
    a.equal(c.value, 0);
    s.value = 1;
    a.throws(() => c.value);
  });

  test("an effect that throws does not stop the others; the error surfaces", (a) => {
    const s = signal(0);
    const seen = [];
    effect(() => { if (s.value === 1) throw new Error("boom"); });
    effect(() => { seen.push(s.value); });
    a.throws(() => { s.value = 1; });
    a.deepEqual(seen, [0, 1]);
    s.value = 2;
    a.deepEqual(seen, [0, 1, 2], "the graph still works afterwards");
  });

  test("an effect that throws on its first run is not left subscribed", (a) => {
    const s = signal(0);
    let runs = 0;
    a.throws(() => effect(() => { runs++; s.value; throw new Error("x"); }));
    s.value = 1;
    a.equal(runs, 1);
  });

  test("many writes in a batch: each computed recomputes once", (a) => {
    const xs = Array.from({ length: 50 }, (_, i) => signal(i));
    let runs = 0;
    const sum = computed(() => { runs++; return xs.reduce((t, x) => t + x.value, 0); });
    const seen = [];
    effect(() => { seen.push(sum.value); });
    batch(() => { for (const x of xs) x.value += 1; });
    a.equal(runs, 2);
    a.deepEqual(seen, [1225, 1275]);
  });
}
