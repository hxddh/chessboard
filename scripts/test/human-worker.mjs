/**
 * The Maia worker's lifecycle, from the page's side (human/worker.js), on a
 * fake Worker — what happens when the worker dies or never answers.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert } from "./harness.mjs";

export async function run() {
  // 19.1 F2 / F3
  const { createHuman } = await import("../../src/web/js/human/worker.js");
  const realWorker = globalThis.Worker;
  const realCreate = URL.createObjectURL, realRevoke = URL.revokeObjectURL;
  const workers = [];
  let urls = 0, revoked = 0;
  // mode: how the next worker behaves — "ok" answers everything, "silent"
  // never answers
  let mode = "ok";
  class FakeWorker {
    constructor() { this.mode = mode; this.terminated = false; this.posted = []; workers.push(this); }
    postMessage(m) {
      this.posted.push(m.type);
      if (this.mode !== "ok" || this.terminated) return;
      const r = m.type === "policy" ? { id: m.id, ok: true, pol: [{ uci: "e2e4", p: 1 }], ms: 1 } : { id: m.id, ok: true };
      setTimeout(() => { if (!this.terminated) this.onmessage({ data: r }); }, 0);
    }
    terminate() { this.terminated = true; }
  }
  globalThis.Worker = FakeWorker;
  URL.createObjectURL = () => "blob:fake/" + (++urls);
  URL.revokeObjectURL = () => { revoked++; };
  try {
    const G = {};
    let scriptLoads = 0;
    const cache = new Map();
    // like chunk.js: the first call loads the script, later ones get the
    // text it carried back from the loader's memory
    const loadChunk = async (file, name) => {
      if (!cache.has(file)) { scriptLoads++; G[name] = "AAAA"; cache.set(file, G[name]); }
      return cache.get(file);
    };
    const H = createHuman({ loadChunk, global: G });
    const r1 = await H.policy(1100, ["fen"], ["e2e4"], 200);
    assert(r1.pol[0].uci === "e2e4" && workers.length === 1, "a first policy boots one worker and answers");
    // the worker dies
    workers[0].onerror({ message: "out of memory" });
    assert(workers[0].terminated, "a worker error terminates the dead worker");
    const t0 = Date.now();
    const r2 = await H.policy(1100, ["fen"], ["e2e4"], 3000);
    assert(r2.pol[0].uci === "e2e4" && workers.length === 2,
      "the next policy boots a fresh worker instead of waiting on the dead one (" + workers.length + " workers)");
    assert(Date.now() - t0 < 1000, "…at once, not after a timeout (" + (Date.now() - t0) + " ms)");
    assert(workers[1].posted.includes("net"), "…and hands the new worker the band's net again");
    assert(scriptLoads === 1, "…from the text the chunk loader kept, without loading the script twice");
    assert(revoked >= 1, "the dead worker's blob URL is revoked (" + revoked + ")");

    // an init that never answers: the worker is not left running beside the next
    mode = "silent";
    const H2 = createHuman({ loadChunk, global: G });
    const before = workers.length;
    let threw = false;
    const realTimeout = globalThis.setTimeout;
    globalThis.setTimeout = (fn, ms) => realTimeout(fn, Math.min(ms, 20));
    try { await H2.policy(1300, ["fen"], ["e2e4"], 50); } catch (_) { threw = true; } finally { globalThis.setTimeout = realTimeout; }
    assert(threw, "an init that never answers fails the request");
    assert(workers[before].terminated, "…and that worker is terminated, not leaked");
    mode = "ok";
    const r3 = await H2.policy(1300, ["fen"], ["e2e4"], 500);
    assert(r3.pol[0].uci === "e2e4" && workers.length === before + 2, "…and the next request boots a working one");
  } finally {
    globalThis.Worker = realWorker;
    URL.createObjectURL = realCreate;
    URL.revokeObjectURL = realRevoke;
  }
}
