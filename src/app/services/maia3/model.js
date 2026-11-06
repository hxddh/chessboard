/**
 * Maia-3 as one call: a position (with what came before it) and two ratings
 * in, the human move distribution over the legal moves and a WDL out. Runs
 * wherever it is imported — the worker (worker.js) in the app, the process
 * itself in Node tests.
 *
 *   const m = await loadMaia3();                 // fetches the three files beside the app
 *   m.evaluate(fen, { history, self, oppo })     // → { policy: [{ move, p }], wdl, ponder, ms }
 * @module services/maia3/model
 */
import { Chess } from "../../core/chess.js";
import { features, legalPolicy, readFen, wdl } from "./encode.js";
import { createNet } from "./net.js";

export const FILES = {
  header: new URL("../../../../third_party/maia3/maia3-5m.json", import.meta.url).href,
  weights: new URL("../../../../third_party/maia3/maia3-5m.f16", import.meta.url).href,
  wasm: new URL("./kernels.wasm", import.meta.url).href,
};

async function bytes(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error("maia3: " + url + " → " + r.status);
  return r.arrayBuffer();
}

/**
 * @param {{ header?: object, weights?: ArrayBuffer, wasm?: ArrayBuffer|null, files?: object }} [o]
 *   anything not given is fetched from `files` (default: FILES); wasm: null forces the JS kernel
 */
export async function loadMaia3(o = {}) {
  const files = { ...FILES, ...o.files };
  const [header, weights, wasm] = await Promise.all([
    o.header || bytes(files.header).then((b) => JSON.parse(new TextDecoder().decode(b))),
    o.weights || bytes(files.weights),
    o.wasm !== undefined ? o.wasm : bytes(files.wasm).catch(() => null),
  ]);
  const net = await createNet({ header, weights, wasm });
  return { ...evaluator(net), kernel: net.kernel, heapBytes: net.heapBytes };
}

const now = () => (typeof performance === "object" ? performance.now() : Date.now());

export function evaluator(net) {
  /**
   * @param {string} fen
   * @param {{ history?: string[], self?: number, oppo?: number }} [o]
   *   history: the positions before `fen`, oldest first (only the last 7 count)
   */
  function evaluate(fen, { history = [], self = 1500, oppo = self } = {}) {
    const t0 = now();
    const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
    const { black } = readFen(fen);
    const out = net.forward(features([...history, fen]), self, oppo);
    return {
      policy: legal.length ? legalPolicy(out.logits, legal, black) : [],
      wdl: wdl(out.value),
      ponder: out.ponder,
      ms: now() - t0,
    };
  }
  return { evaluate };
}
