/**
 * What the app uses when it runs inside the shell (v20-0-plan A2, F3):
 * main.js asks here for the db backend and the analysis engine, and starts
 * the self-test when the shell is in self-test mode. In a browser (dev
 * server, e2e) none of it applies: IndexedDB and the wasm Stockfish, as
 * before.
 *
 *   openDbBackend(params)  native SQLite when the shell has the store
 *                          (gen-manifest.mjs --ui app), else IndexedDB;
 *                          ?db=memory still means nothing persists
 *   analystBackend(wasm)   native Stockfish, the wasm one as its fallback —
 *                          with a one-line notice when it falls back
 *   startSelftest(ctx)     selftest.js, only in self-test mode
 * @module services/native
 */
import { idbBackend, memoryBackend } from "./db.js";

// db-native.js and engine-native.js load only inside the shell: a browser's
// first paint carries neither (scripts/test-app-e2e.mjs counts its modules)
const inShell = () => typeof globalThis.zero === "object" && globalThis.zero !== null && typeof globalThis.zero.invoke === "function";

/** Which backends this launch got, for the self-test and the console. */
export const nativeInfo = { db: null, engine: null, fallback: null };

export async function openDbBackend(params, name = params.get("dbname") || "chessboard") {
  if (params.get("db") === "memory") { nativeInfo.db = "memory"; return memoryBackend(); }
  if (inShell()) {
    const { nativeBackend, nativeDbAvailable } = await import("./db-native.js");
    if (await nativeDbAvailable()) { nativeInfo.db = "native"; return nativeBackend(name); }
  }
  nativeInfo.db = "indexeddb";
  return idbBackend(name);
}

/** The one line a player sees when analysis falls back to the wasm engine. */
const SLOWER = { zh: "分析会慢一些", en: "Analysis will be slower", ja: "解析が少し遅くなります" };

function notice(text) {
  if (typeof document === "undefined") return;
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.dataset.test = "engine-notice";
  el.className = "toast";
  el.textContent = text;
  document.body.append(el);
  setTimeout(() => el.remove(), 4000);
}

/** @param {() => object} makeWasm the wasm Stockfish backend, made only when needed */
export function analystBackend(makeWasm) {
  if (!inShell() || typeof globalThis.zero.on !== "function") { nativeInfo.engine = "wasm"; return makeWasm(); }
  nativeInfo.engine = "native";
  let backend = null;
  const load = () => backend || (backend = import("./engine-native.js").then((m) => nativeAnalyst(m, makeWasm)));
  // the same backend interface, with the module behind the first search
  return {
    get name() { return backend && backend.done ? backend.done.name : "stockfish-native"; },
    async search(fen, opts) { const b = await load(); backend.done = b; return b.search(fen, opts); },
    dispose() { if (backend && backend.done) backend.done.dispose(); },
    /** The native backend itself (null once fallen back): the self-test measures it. */
    async nativeBackend() { const b = await load(); backend.done = b; return b.fallbackReason ? null : b.native; },
  };
}

function nativeAnalyst({ nativeStockfishBackend, nativeOrWasm, zeroBridge }, makeWasm) {
  return nativeOrWasm({
    native: nativeStockfishBackend({ bridge: zeroBridge() }),
    wasm: makeWasm,
    onFallback: (why) => {
      nativeInfo.engine = "wasm";
      nativeInfo.fallback = why;
      console.warn("engine: native Stockfish unavailable (" + why + "); using wasm");
      const lang = (document.documentElement.lang || "zh").slice(0, 2);
      notice(SLOWER[lang] || SLOWER.zh);
    },
  });
}

/** Self-test mode: the shell says so; selftest.js is loaded only then. */
export async function startSelftest(ctx) {
  if (!inShell()) return;
  const invoke = (cmd, payload) => globalThis.zero.invoke(cmd, payload);
  let mode;
  try { mode = await invoke("chess.selftestMode", {}); } catch { return; }
  if (!mode || !mode.on) return;
  // beside index.html, in every layout (src/app/, dist-app/, the package);
  // its own bundle (build-app.mjs), so its imports never reshape the app's chunks
  const { runSelftest } = await import(new URL("selftest.js", document.baseURI).href);
  await runSelftest({ ...ctx, nativeInfo }, { invoke, scenario: mode.scenario || null });
}
