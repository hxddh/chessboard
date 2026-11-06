/**
 * The native Stockfish backend of the engine service (ADR 0004, v20-0-plan
 * F3): a full-NNUE, multi-threaded Stockfish the app ships beside its
 * executable, run by the shell (src/engine.zig) and spoken to in UCI over
 * the bridge:
 *
 *   chess.engineStart {}               → { gen, cores, started } | { error }
 *   chess.engineSend  { gen, text }    → { ok } | { error: "not_running" }
 *   chess.engineStop  { gen, kill }
 *   "chess:engine" event               { gen, lines: [...] } | { gen, exit }
 *
 * Same backend interface as stockfishBackend (engine.js): `search(fen, { multipv,
 * depth, movetime, nodes, elo })`, one search at a time. Threads = cores − 1
 * (at least 1), Hash 256 MB.
 *
 * A process that dies is started again (a new generation) for the next
 * search, up to `maxRestarts` times; the search it was doing fails. When it
 * cannot be started at all (no binary, spawn refused, no `uciok`) or keeps
 * dying, `nativeOrWasm` hands every later search to the wasm Stockfish and
 * says so once through `onFallback` — the page's 「分析会慢一些」.
 * @module services/engine-native
 */
import { parseInfo } from "./engine.js";

/** The app's bridge: invoke + the engine's window event. Null outside the app. */
export function zeroBridge(g = globalThis) {
  const z = g.zero;
  if (!z || typeof z.invoke !== "function" || typeof z.on !== "function") return null;
  return { invoke: (cmd, payload) => z.invoke(cmd, payload), on: (name, fn) => z.on(name, fn) };
}

const EVENT = "chess:engine";

/** The numbers an `info` line carries that parseInfo leaves out. */
function infoStats(line) {
  const t = line.split(" ");
  const num = (k) => { const i = t.indexOf(k); return i >= 0 ? Number(t[i + 1]) : undefined; };
  return { depth: num("depth"), seldepth: num("seldepth"), nodes: num("nodes"), nps: num("nps"), time: num("time"), hashfull: num("hashfull") };
}

export function nativeStockfishBackend({
  bridge = zeroBridge(),
  hashMb = 256,
  threads = null,
  bootMs = 20000,
  maxRestarts = 3,
} = {}) {
  if (!bridge) throw new Error("native engine: no bridge");
  let gen = 0, ready = null, listener = null, exitListener = null;
  let chain = Promise.resolve();
  let limited = null, subscribed = false;
  let restarts = 0, crashes = 0;
  const info = { cores: 0, threads: 0, hashMb, last: null, starts: 0 };

  function subscribe() {
    if (subscribed) return;
    subscribed = true;
    bridge.on(EVENT, (d) => {
      if (!d || d.gen !== gen) return;
      if (d.lines) for (const l of d.lines) if (listener) listener(l);
      if (d.exit !== undefined) {
        ready = null;
        crashes++;
        const fn = exitListener;
        exitListener = null;
        if (fn) fn(d.exit);
      }
    });
  }

  const send = async (...cmds) => {
    const r = await bridge.invoke("chess.engineSend", { gen, text: cmds.join("\n") + "\n" });
    if (!r || r.error) throw new Error("native engine: " + (r ? r.error : "no answer"));
  };

  /** Wait for a line `pred` accepts, or for the process to end, or `ms`. */
  function until(pred, ms, what) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { listener = null; exitListener = null; reject(new Error("native engine: no " + what + " in " + ms + " ms")); }, ms);
      listener = (l) => { if (pred(l)) { clearTimeout(timer); listener = null; exitListener = null; resolve(l); } };
      exitListener = (code) => { clearTimeout(timer); listener = null; reject(new Error("native engine exited (" + code + ") before " + what)); };
    });
  }

  function boot() {
    if (ready) return ready;
    ready = (async () => {
      subscribe();
      if (info.starts > 0 && restarts >= maxRestarts) throw new Error("native engine: gave up after " + restarts + " restarts");
      const r = await bridge.invoke("chess.engineStart", {});
      if (!r || r.error) throw new Error("native engine: " + (r ? r.error + (r.detail ? " " + r.detail : "") : "no answer"));
      if (info.starts > 0 && r.started) restarts++;
      info.starts++;
      gen = r.gen;
      info.cores = r.cores;
      info.threads = threads || Math.max(1, (r.cores || 1) - 1);
      limited = null;
      // a page reloaded over a running engine finds it mid-search: stop it first
      const uciok = until((l) => l === "uciok", bootMs, "uciok");
      await send("stop", "uci");
      await uciok;
      const readyok = until((l) => l === "readyok", bootMs, "readyok");
      await send("setoption name Threads value " + info.threads, "setoption name Hash value " + hashMb, "ucinewgame", "isready");
      await readyok;
    })();
    ready.catch(() => { ready = null; });
    return ready;
  }

  function run(fen, { multipv = 1, depth, movetime = 1000, nodes, elo }) {
    return new Promise((resolve, reject) => {
      const lines = new Map();
      let stats = null;
      const want = elo ? Math.max(1320, Math.min(3190, Math.round(elo))) : null;
      const t0 = Date.now();
      const done = (fn, v) => { clearTimeout(timer); listener = null; exitListener = null; fn(v); };
      const timer = setTimeout(() => {
        listener = null; exitListener = null;
        // a hung engine: kill it; the next search starts a new one
        bridge.invoke("chess.engineStop", { gen, kill: true }).catch(() => {});
        ready = null;
        reject(new Error("native engine: no answer"));
      }, (depth || nodes ? 60000 : movetime) + 10000);
      listener = (l) => {
        if (l.startsWith("info ")) {
          const info1 = parseInfo(l);
          if (info1) { lines.set(info1.multipv, info1); stats = infoStats(l); }
          return;
        }
        if (l.startsWith("bestmove")) {
          const out = [...lines.values()].sort((a, b) => a.multipv - b.multipv);
          const bm = l.split(" ")[1];
          if (!out.length && bm && bm !== "(none)") out.push({ multipv: 1, depth: 0, score: { cp: 0 }, pv: [bm] });
          // UCI_LimitStrength plays its own (weakened) pick: `bestmove`, not the first line's best
          if (want && bm && out[0] && out[0].pv[0] !== bm) out[0] = { ...out[0], pv: [bm] };
          info.last = { ...stats, ms: Date.now() - t0, multipv };
          done(resolve, { lines: out, stats: info.last });
        }
      };
      exitListener = (code) => done(reject, new Error("native engine exited (" + code + ") during a search"));
      const cmds = [];
      if (want !== limited) {
        cmds.push("setoption name UCI_LimitStrength value " + (want ? "true" : "false"));
        if (want) cmds.push("setoption name UCI_Elo value " + want);
        limited = want;
      }
      cmds.push("setoption name MultiPV value " + multipv, "position fen " + fen,
        depth ? "go depth " + depth : nodes ? "go nodes " + nodes : "go movetime " + movetime);
      send(...cmds).catch((e) => done(reject, e));
    });
  }

  return {
    name: "stockfish-native",
    info,
    get crashes() { return crashes; },
    get restarts() { return restarts; },
    /** Start (or reach) the process now; rejects when it cannot be had. */
    boot,
    search(fen, opts = {}) {
      const job = chain.then(() => boot()).then(() => run(fen, opts));
      chain = job.catch(() => {});
      return job;
    },
    /** For tests: kill the running process, as a crash would end it. */
    async kill() { await bridge.invoke("chess.engineStop", { gen, kill: true }); },
    dispose() { if (gen) bridge.invoke("chess.engineStop", { gen, kill: false }).catch(() => {}); ready = null; },
  };
}

/**
 * Native first, wasm when native cannot be had: a search the native engine
 * fails because it died is tried once more (on a new process); one it fails
 * because it cannot start, or has given up restarting, goes to the wasm
 * backend, and so does every search after it.
 * @param {{ native: object|null, wasm: () => object, onFallback?: (why: string) => void }} o
 */
export function nativeOrWasm({ native, wasm, onFallback = () => {} }) {
  let fallback = native ? null : wasm();
  let why = native ? null : "no native engine";
  const toWasm = (reason) => {
    if (fallback) return fallback;
    why = reason;
    fallback = wasm();
    try { onFallback(reason); } catch { /* the notice is the page's */ }
    if (native) native.dispose();
    return fallback;
  };
  return {
    get name() { return fallback ? fallback.name : native.name; },
    get fallbackReason() { return why; },
    get native() { return native; },
    async search(fen, opts) {
      if (fallback) return fallback.search(fen, opts);
      try {
        return await native.search(fen, opts);
      } catch (e) {
        const msg = String(e && e.message || e);
        if (/exited|no answer/.test(msg) && native.restarts < 3) {
          try { return await native.search(fen, opts); } catch (e2) { return toWasm(String(e2 && e2.message || e2)).search(fen, opts); }
        }
        return toWasm(msg).search(fen, opts);
      }
    },
    dispose() { if (native) native.dispose(); if (fallback && fallback.dispose) fallback.dispose(); },
  };
}
