/**
 * The Maia worker, from the page's side (13.0 H).
 *
 * One worker for every band. Its source is `workerMain`'s text called with
 * `maiaCore`'s (the function refers to nothing outside itself; the two lc0
 * tables travel in the init message) — text, not eval: the page's CSP has
 * no 'unsafe-eval', and a blob worker inherits it, so the core cannot be
 * rebuilt from a string in there. Each band's weights arrive as base64 that the
 * worker decodes — the page only hands strings over. 12.0's R6 found what
 * decoding 9.7 MB on the page's thread does to a frame (engine.js); the
 * nets are 1.7 MB each and are not decoded here either.
 *
 * The weights are classic scripts, js/maia-<band>.js, made by
 * scripts/gen-maia-src.mjs from third_party/maia/ (zero:// cannot fetch a
 * packaged file, but it can load a script): window.CHESS_MAIA_<band>, read
 * once, handed over, dropped.
 * @module human/worker
 */
import { maiaCore } from "./maia-net.js";
import { IDX_TO_MOVE, CONV_POLICY_MAP } from "./lc0-tables.js";

/** The worker's whole program — its text is the worker's source, called with maiaCore. */
function workerMain(makeCore) {
  let core = null;
  const nets = {};
  self.onmessage = (ev) => {
    const m = ev.data || {};
    const reply = (o) => self.postMessage(Object.assign({ id: m.id }, o));
    try {
      if (m.type === "init") {
        core = makeCore(m.moves, Int16Array.from(m.map));
        reply({ ok: true });
      } else if (m.type === "net") {
        const bin = atob(m.b64), bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        nets[m.band] = core.parseNet(bytes);
        reply({ ok: true });
      } else if (m.type === "policy") {
        if (!nets[m.band]) throw new Error("maia-" + m.band + " is not loaded");
        const t0 = performance.now();
        const pol = core.movePolicy(nets[m.band], m.fens, m.legal, m.temperature || 1);
        reply({ ok: true, pol, ms: Math.round(performance.now() - t0) });
      } else reply({ ok: false, err: "unknown message " + m.type });
    } catch (e) {
      reply({ ok: false, err: String((e && e.message) || e) });
    }
  };
}

/**
 * @param {object} d
 * @param {(file: string, global: string) => Promise<any>} d.loadChunk chunk.js loadChunk
 * @param {object} [d.global] where the weight scripts leave their text (window)
 */
export function createHuman(d) {
  const G = d.global || globalThis;
  let worker = null, seq = 0, booting = null;
  const pending = new Map();
  const loaded = new Map(); // band → Promise<void>

  function ask(msg, ms) {
    const id = ++seq;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error("maia: no answer to " + msg.type + " in " + ms + " ms")); }, ms);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage(Object.assign({ id }, msg));
    });
  }

  function boot() {
    if (booting) return booting;
    booting = (async () => {
      const src = "(" + workerMain.toString() + ")(" + maiaCore.toString() + ")";
      worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
      worker.onmessage = (ev) => {
        const r = ev.data || {};
        const p = pending.get(r.id);
        if (!p) return;
        pending.delete(r.id);
        clearTimeout(p.timer);
        if (r.ok) p.resolve(r); else p.reject(new Error(r.err || "maia: failed"));
      };
      worker.onerror = (ev) => { const err = new Error("maia worker: " + ((ev && ev.message) || "error")); for (const p of pending.values()) { clearTimeout(p.timer); p.reject(err); } pending.clear(); };
      await ask({ type: "init", moves: IDX_TO_MOVE, map: Array.from(CONV_POLICY_MAP) }, 10000);
    })();
    booting.catch(() => { booting = null; });
    return booting;
  }

  /** The band's net, in the worker (once). */
  function load(band) {
    if (loaded.has(band)) return loaded.get(band);
    const p = (async () => {
      await boot();
      const name = "CHESS_MAIA_" + band;
      await d.loadChunk("maia-" + band + ".js", name);
      const b64 = G[name];
      if (!b64 || typeof b64 !== "string") throw new Error("maia-" + band + ".js carried no weights");
      G[name] = "";
      await ask({ type: "net", band, b64 }, 30000);
    })();
    loaded.set(band, p);
    p.catch(() => loaded.delete(band));
    return p;
  }

  /**
   * The legal moves of the last position in `fens`, with the probability a
   * player of `band` plays each, most likely first.
   * @returns {Promise<{pol: Array<{uci: string, p: number}>, ms: number}>}
   */
  async function policy(band, fens, legal, ms = 4000) {
    await load(band);
    const r = await ask({ type: "policy", band, fens, legal }, ms);
    return { pol: r.pol, ms: r.ms };
  }

  return { load, policy, BANDS: [1100, 1300, 1500, 1700, 1900] };
}
