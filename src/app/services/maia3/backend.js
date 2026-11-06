/**
 * The Maia-3 backend of the engine service (ADR 0004): `human` is the net's
 * move distribution for a rating, `pick` samples an opponent's move from it.
 * Analysis — `search`, and with it `analyse`, `review`, mate finding — stays
 * with the engine passed as `analyst` (Stockfish in the app, the fake in
 * tests); Maia-3 predicts people, it does not calculate.
 *
 *   createEngineService(maia3Backend({ analyst: stockfishBackend() }))
 *
 * The net runs in a module worker (workerRunner) in the browser, or in the
 * calling thread (inlineRunner) where there is no Worker, as in Node tests.
 * @module services/maia3/backend
 */

/** Runs the net in services/maia3/worker.js; one request at a time is fine, the worker answers in order. */
export function workerRunner({ url = new URL("./worker.js", import.meta.url) } = {}) {
  let worker = null, seq = 0;
  const waiting = new Map();
  function start() {
    if (worker) return worker;
    worker = new Worker(url, { type: "module" });
    worker.onmessage = (e) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      waiting.delete(e.data.id);
      if (e.data.error) w.reject(new Error(e.data.error)); else w.resolve(e.data);
    };
    worker.onerror = (e) => {
      const err = new Error("maia3 worker: " + (e.message || "failed to start"));
      for (const w of waiting.values()) w.reject(err);
      waiting.clear();
      worker.terminate();
      worker = null;
    };
    return worker;
  }
  const ask = (msg) => new Promise((resolve, reject) => {
    const id = ++seq;
    waiting.set(id, { resolve, reject });
    start().postMessage({ id, ...msg });
  });
  return {
    init: () => ask({ type: "init" }),
    evaluate: (fen, o) => ask({ type: "eval", fen, ...o }).then((r) => r.result),
    dispose() { if (worker) worker.terminate(); worker = null; },
  };
}

/** Runs the net in this thread; `model` is (a promise of) model.js's loadMaia3(). */
export function inlineRunner(model) {
  const m = Promise.resolve(model);
  return {
    init: () => m.then((x) => ({ kernel: x.kernel, heapBytes: x.heapBytes })),
    evaluate: (fen, o) => m.then((x) => x.evaluate(fen, o)),
    dispose() {},
  };
}

const ratings = (r) => (typeof r === "object" && r ? { self: r.self ?? 1500, oppo: r.oppo ?? r.self ?? 1500 } : { self: r ?? 1500, oppo: r ?? 1500 });

/**
 * One move from a distribution, the way maia3's UCI wrapper samples:
 * temperature 0 is the most likely move; top-p keeps the smallest set of
 * likeliest moves whose mass stays within p (always the first).
 * @param {{ move: string, p: number }[]} policy most likely first
 */
export function sample(policy, { temperature = 1, topP = 1, random = Math.random } = {}) {
  if (!policy.length) return null;
  if (temperature <= 0) return policy[0].move;
  let w = policy.map((x) => Math.pow(x.p, 1 / temperature));
  const s0 = w.reduce((a, b) => a + b, 0);
  w = w.map((x) => x / s0);
  let keep = w.length;
  if (topP < 1) {
    let c = 0;
    keep = 0;
    while (keep < w.length && c + w[keep] <= topP + 1e-9) c += w[keep++];
    keep = Math.max(1, keep);
  }
  const sum = w.slice(0, keep).reduce((a, b) => a + b, 0);
  let r = random() * sum;
  for (let i = 0; i < keep; i++) if ((r -= w[i]) < 0) return policy[i].move;
  return policy[keep - 1].move;
}

/**
 * @param {{ analyst: object, runner?: object }} o
 */
export function maia3Backend({ analyst, runner = workerRunner() }) {
  if (!analyst) throw new Error("maia3Backend: needs an analyst backend for search");
  return {
    name: "maia3+" + analyst.name,
    search: (fen, opts) => analyst.search(fen, opts),
    tablebase: analyst.tablebase ? (fen) => analyst.tablebase(fen) : undefined,
    /** The full answer: { policy, wdl: { win, draw, loss } (side to move), ponder, ms }. */
    evaluate: (fen, { rating, history } = {}) => runner.evaluate(fen, { ...ratings(rating), history: history || [] }),
    /** @returns {Promise<{ move, p }[]>} */
    async human(fen, rating, history) {
      return (await runner.evaluate(fen, { ...ratings(rating), history: history || [] })).policy;
    },
    /**
     * An opponent's move: profile { rating, oppoRating?, history?, temperature?, topP?, random? }.
     * @returns {Promise<string|null>}
     */
    async pick(fen, profile = {}) {
      const r = await runner.evaluate(fen, { ...ratings({ self: profile.rating, oppo: profile.oppoRating ?? profile.rating }), history: profile.history || [] });
      return sample(r.policy, profile);
    },
    info: () => runner.init(),
    dispose() { runner.dispose(); if (analyst.dispose) analyst.dispose(); },
  };
}
