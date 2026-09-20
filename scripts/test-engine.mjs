/**
 * engine.js under a fake Worker (v6.1 缺陷 1–6).
 *
 * The engine manager is the one module that never runs in any other test: the
 * five defects this file pins were all failures of its *lifecycle* — teardown,
 * rebuild, strike counting, stale timers, the exclusive queue — none of which
 * a real Stockfish would show you on demand. So the worker here is a fake that
 * answers UCI by script and can be told to go deaf, and time is a virtual
 * clock, because the module's own timeouts are 5s / 15s / 24h and a test that
 * waited them out would not be run.
 *
 * Run: node scripts/test-engine.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SRC = compileModuleSync(path.join(root, "src/web/js/engine.js"));

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}

/** let every pending microtask (and promise chain) run */
async function settle(n = 8) {
  for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r));
}

/** setTimeout/clearTimeout on a clock the test moves by hand */
function makeClock() {
  let now = 0, seq = 0;
  const timers = new Map();
  return {
    now: () => now,
    setTimeout(fn, ms) { const id = ++seq; timers.set(id, { fn, at: now + (ms || 0) }); return id; },
    clearTimeout(id) { timers.delete(id); },
    pending: () => timers.size,
    async advance(ms) {
      const target = now + ms;
      for (;;) {
        let pick = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && id < pick.id))) pick = { id, t };
        }
        if (!pick) break;
        timers.delete(pick.id);
        now = pick.t.at;
        pick.t.fn();
        await settle();
      }
      now = target;
      await settle();
    },
  };
}

/**
 * A context holding engine.js, a fake document that injects the two source
 * globals, and a fake Worker that speaks just enough UCI.
 *
 * cfg.deafSearch  — never answers `go` (a wedged search)
 * cfg.deafReady   — never answers `isready`
 * cfg.goDelay     — ms (virtual) before `go movetime` answers; `stop` cuts it
 *                   short with a shallower score, exactly like Stockfish
 */
function boot(cfg = {}) {
  const clock = makeClock();
  const state = { injections: 0, workers: [] };
  const ctx = {
    console, Date, JSON, Math, Uint8Array, ArrayBuffer,
    setTimeout: (fn, ms) => clock.setTimeout(fn, ms),
    clearTimeout: (id) => clock.clearTimeout(id),
    performance: { now: () => clock.now() },
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    URL: { createObjectURL: () => "blob:fake", revokeObjectURL() {} },
    Blob: class { constructor() {} },
  };
  ctx.globalThis = ctx;
  ctx.window = ctx;

  ctx.Worker = class {
    constructor() {
      this.alive = true;
      this.cmds = [];
      this.searching = false;
      this.onmessage = null;
      this.onerror = null;
      state.workers.push(this);
    }
    say(line) {
      Promise.resolve().then(() => { if (this.alive && this.onmessage) this.onmessage({ data: line }); });
    }
    finish(depth, cp) {
      this.searching = false;
      this.say("info depth " + depth + " multipv 1 score cp " + cp + " pv e2e4 e7e5");
      this.say("bestmove e2e4");
    }
    postMessage(m) {
      if (m && m.type === "init") { this.say("__sf_ready__"); return; }
      this.cmds.push(m);
      if (m === "uci") { this.say("uciok"); return; }
      if (m === "isready") { if (!cfg.deafReady) this.say("readyok"); return; }
      if (/^go\b/.test(m)) {
        this.searching = true;
        if (cfg.deafSearch) return;
        if (/infinite/.test(m)) return; // only `stop` ends an infinite search
        if (cfg.goDelay) { clock.setTimeout(() => { if (this.searching) this.finish(20, 30); }, cfg.goDelay); return; }
        this.finish(20, 30);
        return;
      }
      if (m === "stop" && this.searching) this.finish(2, 5); // truncated: shallow score
    }
    terminate() { this.alive = false; }
  };

  ctx.document = {
    createElement: () => ({ set src(_v) {}, set async(_v) {}, onload: null, onerror: null }),
    head: {
      appendChild(el) {
        state.injections++;
        ctx.CHESS_SF_LOADER = "/* loader */";
        ctx.CHESS_SF_WASM_B64 = "AAAAAA==";
        Promise.resolve().then(() => el.onload && el.onload());
      },
    },
  };

  vm.createContext(ctx);
  vm.runInContext(SRC, ctx, { filename: "engine.js" });
  state.last = () => state.workers[state.workers.length - 1];
  return { E: ctx.ChessEngine, ctx, clock, state };
}

const FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const FEN2 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1";

// --- 缺陷 1: an engine torn down can be built again ------------------------
{
  const { E, clock, state } = boot();
  const p = E.init(); await clock.advance(1); await p;
  assert(E.isReady() && state.workers.length === 1, "boots: one worker, ready");
  state.last().onerror(); // the documented wasm-trap teardown path
  await settle();
  assert(!E.isReady(), "an onerror tears the engine down");
  let err = null;
  const p2 = E.init().catch((e) => { err = e; });
  await clock.advance(1); await p2;
  assert(!err, "init() after a teardown rebuilds" + (err ? " — " + err.message : ""));
  assert(E.isReady() && state.workers.length === 2, "…on a second, fresh worker");
  assert(state.injections === 1, "…without re-injecting the 9.7MB source script");
  const p3 = E.init().catch(() => {}); await clock.advance(1); await p3;
  assert(E.isReady() && state.workers.length === 2, "a third init() is still idempotent");
}

// --- 缺陷 2: teardown settles the searches it kills ------------------------
{
  const { E, clock, state } = boot({ deafSearch: true });
  const p = E.init(); await clock.advance(1); await p;
  let stopResolved = false;
  const stop = E.analyzeInfinite(FEN, { multipv: 1 }, () => {});
  await clock.advance(1); // let the queued body reach `go infinite`
  assert(/go infinite/.test(state.last().cmds.join(" ")), "the live analysis is running");
  state.last().onerror(); // worker dies under it
  await settle();
  stop().then(() => { stopResolved = true; });
  await clock.advance(10);
  assert(stopResolved, "teardown settles the in-flight search, so stop() resolves");
  assert(clock.pending() === 0, "…and cancels its 24-hour timer");
  // and the exclusive queue is not wedged behind the dead search
  let after = "pending";
  const q = E.analyze(FEN2, 50).then((r) => { after = r; }, (e) => { after = "rejected:" + e.message });
  await clock.advance(5); await q;
  assert(after && after !== "pending" && after.best === "e2e4",
    "…and the next search still runs (" + JSON.stringify(after) + ")");
}

// --- 缺陷 3: two search timeouts in a row tear the worker down -------------
{
  // the classic wedge: `isready` is answered, searches are not. Each search
  // drains with an isready first, and that readyok used to reset the strikes.
  const { E, clock, state } = boot({ deafSearch: true });
  const p = E.init(); await clock.advance(1); await p;
  const a = E.analyze(FEN, 50).catch(() => "timeout");
  await clock.advance(20000); await a;
  assert(E.isReady(), "one hung search is only a strike");
  const b = E.analyze(FEN2, 50).catch(() => "timeout");
  await clock.advance(20000); await b;
  assert(!E.isReady(), "a second hung search tears the wedged worker down, readyok or not");
  assert(!state.last().alive, "…the worker is really terminated");
}

// --- 缺陷 4: a dead worker's timer never strikes its replacement -----------
{
  const { E, clock, state } = boot({ deafSearch: true });
  const p = E.init(); await clock.advance(1); await p;
  const a = E.analyze(FEN, 50).catch(() => "torn down");
  await clock.advance(1);
  const dead = state.last();
  dead.onerror();
  await settle(); await a;
  const p2 = E.init(); await clock.advance(1); await p2;
  const fresh = state.last();
  assert(fresh !== dead && E.isReady(), "a fresh worker is up");
  await clock.advance(60000); // the dead search's budget would have expired here
  assert(!fresh.cmds.includes("stop"), "the old search's timer sends no stop to the new worker");
  assert(E.isReady(), "…and does not strike it");
}

// --- 缺陷 5: a live analysis stops its own search, not somebody else's -----
{
  const { E, clock, state } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  let got = null;
  const busy = E.analyze(FEN, 100).then((r) => { got = r; });
  await clock.advance(1); // the review search is now in `go movetime`
  const w = state.last();
  assert(w.cmds.some((c) => /^go movetime/.test(c)), "a review search is running");
  const stop = E.analyzeInfinite(FEN2, {}, () => {}); // queued behind it
  await settle();
  stop(); // the panel is closed before its turn ever comes
  await settle();
  const cut = w.cmds.indexOf("stop");
  assert(cut === -1, "stop() on a queued live analysis sends no stop at all");
  await clock.advance(1000); await busy;
  assert(got && got.cp === 30, "…so the other caller keeps its full-budget result (cp=" + (got && got.cp) + ")");
  // and the cache must not be holding a truncated answer under a full budget
  const again = await E.analyze(FEN, 100);
  assert(again.cp === 30, "…and that is what the cache serves");
}

// --- 缺陷 6: changing an option that changes results empties the cache -----
{
  const { E, clock, state } = boot();
  const p = E.init(); await clock.advance(1); await p;
  const first = E.analyze(FEN, 100); await clock.advance(1); await first;
  const gos = () => state.last().cmds.filter((c) => /^go\b/.test(c)).length;
  const cached = E.analyze(FEN, 100); await clock.advance(1); await cached;
  assert(gos() === 1, "the same position at the same budget is served from the cache");
  E.setOptions({ hash: 512 });
  const after = E.analyze(FEN, 100); await clock.advance(1); await after;
  assert(gos() === 2, "a Hash change invalidates it — the search runs again");
  assert(state.last().cmds.includes("setoption name Hash value 512"), "…at the new Hash");
  E.setOptions({ hash: 512 });
  const same = E.analyze(FEN, 100); await clock.advance(1); await same;
  assert(gos() === 2, "setting the same value again keeps the cache");
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("engine: all tests passed");
