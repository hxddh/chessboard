/**
 * The Maia-3 module worker (ADR 0001, 0004): loads the net on the first
 * message, then answers one evaluation per message, in order.
 *
 *   → { id, type: "init" }                         ← { id, kernel, heapBytes, loadMs }
 *   → { id, type: "eval", fen, history, self, oppo } ← { id, result: { policy, wdl, ponder, ms } }
 *   ← { id, error } when anything throws
 * @module services/maia3/worker
 */
import { loadMaia3 } from "./model.js";

let loading = null, loadMs = 0;
const load = () => {
  if (!loading) {
    const t0 = performance.now();
    loading = loadMaia3().then((m) => { loadMs = performance.now() - t0; return m; });
    loading.catch(() => { loading = null; });
  }
  return loading;
};

self.onmessage = async (e) => {
  const { id, type, fen, history, self: selfElo, oppo } = e.data || {};
  try {
    const m = await load();
    if (type === "init") postMessage({ id, kernel: m.kernel, heapBytes: m.heapBytes, loadMs });
    else if (type === "eval") postMessage({ id, result: m.evaluate(fen, { history, self: selfElo, oppo }) });
    else throw new Error("maia3 worker: unknown message " + type);
  } catch (err) {
    postMessage({ id, error: String((err && err.message) || err) });
  }
};
