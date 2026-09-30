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
      const due = () => {
        let pick = null;
        for (const [id, t] of timers) {
          if (t.at <= target && (!pick || t.at < pick.t.at || (t.at === pick.t.at && id < pick.id))) pick = { id, t };
        }
        return pick;
      };
      await settle();
      for (let guard = 0; guard < 10000; guard++) {
        const pick = due();
        if (!pick) {
          if (now === target) break;
          now = target;          // a promise chain may still arm a timer here
          await settle();
          if (!due()) break;
          continue;
        }
        timers.delete(pick.id);
        if (pick.t.at > now) now = pick.t.at;
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
 * cfg.goDelay     — ms (virtual) before a `go` answers; `stop` cuts it
 *                   short with a shallower score, exactly like Stockfish
 * cfg.bootFail    — the first N boots fail the way a wasm that will not
 *                   compile does (`__sf_fail__`); later ones succeed
 * cfg.deafInitFrom — workers from this index on never answer the wasm
 *                   (a second worker that does not boot, v8-1-plan F4)
 */
function boot(cfg = {}) {
  const clock = makeClock();
  const state = { injections: 0, workers: [], failBoots: cfg.bootFail || 0 };
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
      if (m && m.type === "init" && cfg.deafInitFrom != null && state.workers.indexOf(this) >= cfg.deafInitFrom) return;
      if (m && m.type === "init") { this.say(cfg.bootFail && state.failBoots-- > 0 ? "__sf_fail__ CompileError" : "__sf_ready__"); return; }
      this.cmds.push(m);
      if (m === "uci") { this.say("uciok"); return; }
      if (m === "isready") { if (!cfg.deafReady) this.say("readyok"); return; }
      if (/^go\b/.test(m)) {
        this.searching = true;
        const id = this.searchId = (this.searchId || 0) + 1; // a timer ends its own search only
        if (cfg.deafSearch) return;
        if (/infinite/.test(m)) return; // only `stop` ends an infinite search
        // honorMovetime: a slow search (goDelay) still stops at its `movetime`
        const mt = cfg.honorMovetime ? /\bmovetime (\d+)/.exec(m) : null;
        const ms = mt ? Math.min(cfg.goDelay || Infinity, Number(mt[1])) : cfg.goDelay;
        if (ms) { clock.setTimeout(() => { if (this.searching && this.searchId === id) this.finish(20, 30); }, ms); return; }
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
  // and the exclusive queue is not wedged behind the dead search: the next
  // caller gets a rebuilt worker and its own answer (still deaf here, so it
  // ends in a timeout — what matters is that it ends, and on a live worker)
  let after = "pending";
  const q = E.analyze(FEN2, 50).then((r) => { after = "result"; }, (e) => { after = e.message; });
  await clock.advance(20000); await q;
  assert(after !== "pending", "…and the next search reaches the queue at all (" + after + ")");
  assert(state.workers.length === 2 && state.last().cmds.some((c) => /^go nodes/.test(c)),
    "…on a worker rebuilt for it");
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
  await clock.advance(1); // the review search is now in its `go nodes`
  const w = state.last();
  assert(w.cmds.some((c) => /^go nodes/.test(c)), "a review search is running");
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

// --- 7.4 (Codex review on #76): a failed boot is sticky, whoever hit it ----
// A hint or a library pass calls analyze()/bestMove() directly and boots the
// engine lazily, around app.js's bootEngine(). Each such call used to build a
// fresh worker after a failure, and nothing told the app it had failed.
{
  const { E, clock, state } = boot({ bootFail: 1 });
  const heard = [];
  E.onBootFail((err) => heard.push(err && err.message));
  let rejected = null;
  const p = E.analyze(FEN, 100).catch((e) => { rejected = e; });
  await clock.advance(1); await p;
  assert(state.workers.length === 1, "a lazy boot through analyze() builds one worker", state.workers.length);
  assert(heard.length === 1 && /CompileError/.test(heard[0]),
    "…and its failure reaches onBootFail, with the worker's reason", JSON.stringify(heard));
  const again = [E.analyze(FEN2, 100).catch(() => null), E.bestMove(FEN, "beginner").catch(() => null), E.init().catch(() => null)];
  await clock.advance(1); await Promise.all(again);
  assert(state.workers.length === 1, "after a failed boot, analyze / bestMove / init build no more workers", state.workers.length);
  assert(heard.length === 1, "…and the failure is reported once, not per caller", heard.length);
  E.retry();
  const r = E.init(); await clock.advance(1); await r;
  assert(E.isReady() && state.workers.length === 2, "retry() lets exactly one new boot through, and it can succeed");
}

// --- v8-0-plan B2: analysis is a node count from a clean engine ------------
// `go movetime` stopped wherever the clock ran out, so the same game analysed
// twice told two stories. A node-limited search after `ucinewgame` does not
// depend on the machine or on what was searched before it.
{
  const { E, clock, state } = boot();
  const p = E.init(); await clock.advance(1); await p;
  const r = E.analyze(FEN, 200, { multipv: 2 }); await clock.advance(1); const got = await r;
  const cmds = state.last().cmds;
  const go = cmds.filter((c) => /^go\b/.test(c));
  assert(go.length === 1 && go[0] === "go nodes " + E.nodesFor(200) && E.nodesFor(200) === 200 * E.NODES_PER_MS,
    "an analysis at budget 200 searches a fixed node count (" + go.join(", ") + ")");
  const fresh = cmds.lastIndexOf("ucinewgame"), goAt = cmds.lastIndexOf(go[0]);
  assert(fresh >= 0 && fresh < goAt && cmds.slice(fresh, goAt).includes("isready"),
    "…from a cleared engine: ucinewgame, then isready, then the search");
  assert(got && got.nodes === E.nodesFor(200), "…and the result says how many nodes it was");
  // a deeper result no longer answers a shallower request: the review deepens
  // some positions, and the next pass must see its own quick scan again
  const deep = E.analyze(FEN2, 800); await clock.advance(1); await deep;
  const gos = () => state.last().cmds.filter((c) => /^go\b/.test(c)).length;
  const before = gos();
  const quick = E.analyze(FEN2, 200); await clock.advance(1); await quick;
  assert(gos() === before + 1, "a position searched deeper is searched again at the quick budget, not served the deep answer");
  const again = E.analyze(FEN2, 200); await clock.advance(1); await again;
  assert(gos() === before + 1, "…while the same budget is still served from the cache");
}

// --- v8-1-plan F4: three levels, and a higher one preempts a lower one ------
// Through 8.0 every search waited its turn on one chain, so the game's reply
// queued behind whatever library-pass search was running. Now a game move
// stops a background search, runs, and the background search is run again —
// its cut result never reaches the pass.
const FEN3 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
const gosOf = (w) => w.cmds.filter((c) => /^(go|stop|ucinewgame|position)\b/.test(c));
{
  const { E, clock, state, ctx } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  const waits = [];
  ctx.__engineProbe = (e) => waits.push(e);
  const got = [];
  const pass = [FEN, FEN2, FEN3].map((f) => E.analyze(f, 100, { bg: true }).then((r) => { got.push([f, r && r.cp]); return r; }));
  await clock.advance(450); // the first position is done, the second is searching
  const w = state.last();
  assert(w.searching && w.cmds.filter((c) => /^go nodes/.test(c)).length === 2, "a background pass is on its second position");
  let mv = null;
  const move = E.bestMove(FEN3, "extreme").then((m) => { mv = m; });
  await settle();
  const stopAt = w.cmds.lastIndexOf("stop");
  assert(stopAt > w.cmds.lastIndexOf("go nodes " + E.nodesFor(100)), "a game move arriving mid-pass stops the running background search at once");
  await clock.advance(800); await move;
  const seq = gosOf(w).filter((c) => /^(go|position)/.test(c)).map((c) => c.startsWith("position") ? c.slice(13) : c.split(" ").slice(0, 2).join(" "));
  const moveGo = seq.indexOf("go movetime");
  assert(mv && moveGo > 0 && seq[moveGo - 1] === FEN3, "…the move searches next, ahead of the rest of the pass");
  await clock.advance(2000); await Promise.all(pass);
  const nodesGos = w.cmds.filter((c) => /^go nodes/.test(c)).length;
  assert(nodesGos === 4, "…and the cut position is searched again afterwards — once, the finished one not at all (" + nodesGos + " searches for 3 positions)");
  assert(got.length === 3 && got.every(([, cp]) => cp === 30), "…every position of the pass gets a whole search's result, none the truncated one", JSON.stringify(got));
  assert(got.map(([f]) => f).join("|") === [FEN, FEN2, FEN3].join("|"), "…in the order the pass asked for them");
  const mw = waits.find((e) => e.kind === "move");
  assert(mw && mw.wait <= 5, "the move waited for the engine no longer than a `stop` takes (" + (mw && mw.wait) + " ms virtual)");
  const again = waits.filter((e) => e.kind === "batch" && e.runs === 2);
  assert(again.length === 1, "exactly one background search ran twice");
}

// cancel() — a board change — does not cut a background search short: its
// result would be filed as a whole one. newGame()'s ucinewgame waits too.
{
  const { E, clock, state } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  let r = null;
  const a = E.analyze(FEN, 100, { bg: true }).then((x) => { r = x; });
  await clock.advance(50);
  const w = state.last();
  const before = w.cmds.length;
  E.cancel();
  E.newGame();
  assert(!w.cmds.slice(before).includes("stop") && !w.cmds.slice(before).includes("ucinewgame"),
    "cancel() and newGame() send neither stop nor ucinewgame into a running background search");
  await clock.advance(500); await a;
  assert(r && r.cp === 30, "…which delivers its whole result (cp=" + (r && r.cp) + ")");
  const m = E.bestMove(FEN2, "beginner"); await clock.advance(1000); await m;
  const tail = w.cmds.slice(w.cmds.lastIndexOf("go nodes " + E.nodesFor(100)) + 1);
  assert(tail.indexOf("ucinewgame") >= 0 && tail.indexOf("ucinewgame") < tail.findIndex((c) => /^go depth/.test(c)),
    "…and the next game search starts with the ucinewgame the new game asked for");
  // a foreground search is still cancelled exactly as before
  let fg = "pending";
  const f = E.analyze(FEN3, 100).then((x) => { fg = x; });
  await clock.advance(50);
  E.cancel();
  await clock.advance(10); await f;
  assert(fg === null && w.cmds[w.cmds.length - 1] === "stop", "cancel() still stops and discards a foreground search");
}

// the levels: 持续分析 yields to a game move and comes back; a background
// pass yields to 持续分析; searches at one level keep their order
{
  const { E, clock, state } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  const updates = [];
  const stop = E.analyzeInfinite(FEN, {}, (u) => updates.push(u));
  await clock.advance(10);
  const w = state.last();
  const move = E.bestMove(FEN2, "extreme");
  await clock.advance(1000); await move;
  const gos = w.cmds.filter((c) => /^go\b/.test(c));
  assert(gos.join(",") === "go infinite,go movetime 1200,go infinite", "a game move preempts 持续分析, which re-arms on its position afterwards (" + gos.join(", ") + ")");
  await stop();
  assert(w.cmds[w.cmds.length - 1] === "stop", "…and stop() still ends it");
  // a background pass under 持续分析
  const b = E.analyze(FEN3, 100, { bg: true });
  await clock.advance(50);
  const stop2 = E.analyzeInfinite(FEN2, {}, () => {});
  await clock.advance(10);
  const cut = w.cmds.lastIndexOf("stop");
  assert(cut > w.cmds.lastIndexOf("go nodes " + E.nodesFor(100)) && w.cmds[w.cmds.length - 1] === "go infinite",
    "持续分析 preempts a background search");
  let br = null; b.then((x) => { br = x; });
  await clock.advance(1000);
  assert(br === null, "…which waits while 持续分析 runs");
  await stop2(); await clock.advance(1000);
  assert(br && br.cp === 30, "…and completes, whole, once it stops");
  // two foreground requests: no preemption between them, arrival order
  const x1 = E.analyze(FEN, 150);
  await clock.advance(10);
  const n0 = w.cmds.length;
  const x2 = E.bestMove(FEN2, "extreme");
  await clock.advance(10);
  assert(!w.cmds.slice(n0).includes("stop"), "a game move does not preempt a hint or coach search — same level, arrival order");
  await clock.advance(2000); await Promise.all([x1, x2]);
}

// part 3: the second worker, off by default; on, a pass runs beside the game
{
  const { E, clock, state } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  assert(E.getOptions().bgWorker === false, "the second worker is off by default (v8-1-plan §8.7)");
  const a = E.analyze(FEN, 100, { bg: true }); await clock.advance(500); await a;
  assert(state.workers.length === 1, "…so a pass runs on the one worker");
  E.setOptions({ bgWorker: true });
  let r = null;
  const b = E.analyze(FEN2, 100, { bg: true }).then((x) => { r = x; });
  await clock.advance(50);
  assert(state.workers.length === 2 && state.last().cmds.some((c) => /^go nodes/.test(c)), "on: a pass boots a second worker and searches there");
  const m = E.bestMove(FEN3, "extreme");
  await clock.advance(10);
  assert(!state.workers[0].cmds.includes("stop") && !state.workers[1].cmds.includes("stop") && state.workers[0].searching,
    "…a game move runs on the first at the same time, nobody stopped");
  await clock.advance(1000); await Promise.all([b, m]);
  assert(r && r.cp === 30 && r.nodes === E.nodesFor(100), "…and the pass gets the same whole result");
  const lane = state.last();
  assert(lane.cmds.slice(lane.cmds.indexOf("ucinewgame")).join("|").includes("setoption name Hash value 32"),
    "…searched the way the first worker would: ucinewgame, full strength, the player's Hash");
  E.setOptions({ bgWorker: false });
  assert(!lane.alive, "turning it off terminates the second worker");
}
{
  // 8.1 M2 review P3: a search queued on the lane behind the one that
  // close() cut off does not boot a new worker nobody holds
  const { E, clock, state } = boot({ goDelay: 400 });
  const p = E.init(); await clock.advance(1); await p;
  E.setOptions({ bgWorker: true });
  const res = [];
  const b1 = E.analyze(FEN2, 100, { bg: true }).then((x) => { res.push(x); });
  const b2 = E.analyze(FEN3, 100, { bg: true }).then((x) => { res.push(x); });
  await clock.advance(50);
  assert(state.workers.length === 2, "two passes queued on the second worker (" + state.workers.length + " workers)");
  E.setOptions({ bgWorker: false });
  await clock.advance(3000); await Promise.all([b1, b2]);
  assert(state.workers.length === 2 && !state.workers[1].alive,
    "closed with a search queued behind: no third worker is booted, the second stays down (" + state.workers.length + " workers)");
  assert(res.length === 2 && res.every((r) => r && r.cp === 30), "…and both searches are answered by the first worker");
}
{
  // a second worker that never boots: the pass carries on on the first
  const { E, clock, state } = boot({ goDelay: 100, deafInitFrom: 1 });
  const p = E.init(); await clock.advance(1); await p;
  E.setOptions({ bgWorker: true });
  let r = null;
  const b = E.analyze(FEN2, 100, { bg: true }).then((x) => { r = x; });
  await clock.advance(31000); await b;
  assert(state.workers.length === 2 && !state.workers[1].alive, "a second worker that does not boot is terminated");
  assert(r && r.cp === 30 && state.workers[0].cmds.some((c) => /^go nodes/.test(c)),
    "…and the search falls back to the first worker", JSON.stringify(r));
  const c = E.analyze(FEN3, 100, { bg: true }); await clock.advance(500); await c;
  assert(state.workers.length === 2, "…which the rest of the pass keeps using, no second try per search");
}

// v8-0-plan §5: the generated engine-src.js header named Stockfish 18 after
// 19 was vendored — the version it prints must be the one it reads
{
  const fs = await import("fs");
  const gen = fs.readFileSync(path.join(root, "scripts/gen-engine-src.mjs"), "utf8");
  const read = [...gen.matchAll(/stockfish-(\d+)-lite-single\.(?:js|wasm)/g)].map((m) => m[1]);
  const said = [...gen.matchAll(/Stockfish(?:\.js)? (\d+)/g)].map((m) => m[1]);
  const vendored = fs.readdirSync(path.join(root, "third_party/stockfish")).map((f) => (/^stockfish-(\d+)-/.exec(f) || [])[1]).filter(Boolean);
  const v = vendored[0];
  assert(v && read.length && read.every((x) => x === v) && said.length && said.every((x) => x === v),
    "gen-engine-src.mjs reads and names the vendored Stockfish " + v + " (reads " + read.join("/") + ", header says " + said.join("/") + ")");
}

// --- v8-1-plan T1: the re-stepped rungs, as the worker sees them -------------
// A UCI_Elo rung searches to its pick depth and holds the reply like a depth
// rung; a longer list is sent as MultiPV and the pick left to Stockfish; a
// node rung searches its count, drawn ±15%, and fewer nodes short of time.
{
  const { E, clock, state } = boot();
  const p = E.init(); await clock.advance(1); await p;
  const w = state.last();
  const since = () => w.cmds.slice(w.cmds.lastIndexOf("isready"));
  let done = false;
  const m1 = E.bestMove(FEN, "easyplus").then((m) => { done = true; return m; });
  await clock.advance(10);
  const c1 = since();
  assert(c1.includes("setoption name MultiPV value 6") && c1.includes("setoption name UCI_Elo value 1500") && c1.includes("go depth 2"),
    "T1: 初级+ is UCI_Elo 1500 searched to depth 2 over six lines (" + c1.filter((c) => /MultiPV|UCI_Elo|^go/.test(c)).join(", ") + ")");
  assert(!done, "T1: …and its instant reply is held, like a depth rung's");
  await clock.advance(600);
  const mv1 = await m1;
  assert(done && mv1 && mv1.from === "e2" && mv1.to === "e4", "T1: …then it plays Stockfish's own pick");
  const nodesOf = () => Number((/^go nodes (\d+)/.exec(w.cmds.filter((c) => /^go/.test(c)).pop()) || [])[1]);
  const seen = [];
  for (let i = 0; i < 6; i++) { const m = E.bestMove(FEN, "strongplus"); await clock.advance(1200); await m; seen.push(nodesOf()); }
  assert(seen.every((n) => n >= 2125 && n <= 2875) && new Set(seen).size > 1,
    "T1: 强力+ searches about 2,500 nodes, a different count each move (" + seen.join(", ") + ")");
  const short = E.bestMove(FEN, "strongplus", { search: 2, pace: 0 }); await clock.advance(10); await short;
  assert(nodesOf() <= E.nodesFor(2) * 1.15, "T1: …and on a nearly flagged clock only what the time buys (" + nodesOf() + ")");
}

// --- M3 评审: a depth rung on a nearly flagged clock ----------------------------
// 大师 searches to depth 10 — ~100 ms in a middlegame on this machine, more on
// a slow one. With 2 s left of a 1+0 game (thinkPlan: ~50 ms a move) the
// reply must come inside what the clock allots, not when depth 10 is done.
{
  const { E, clock, state } = boot({ goDelay: 5000, honorMovetime: true });
  const p = E.init(); await clock.advance(1); await p;
  const w = state.last();
  let mv;
  const m = E.bestMove(FEN, "master", { search: 0, pace: 50, ceil: 50 }).then((x) => { mv = x; });
  for (let i = 0; i < 12 && !mv; i++) await clock.advance(10);
  const go = w.cmds.filter((c) => /^go\b/.test(c)).pop();
  assert(go === "go depth 10 movetime 50" && mv && mv.from === "e2", "M3: a depth rung under a tight clock stops at the clock's ceiling and replies in time (" + go + ")");
  await m;
  const n = E.bestMove(FEN, "master"); await clock.advance(10);
  assert(w.cmds.filter((c) => /^go\b/.test(c)).pop() === "go depth 10", "M3: …and with no clock it searches its depth as before");
  await clock.advance(6000); await n;
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("engine: all tests passed");
