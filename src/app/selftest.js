/**
 * The 20.0 app's self-test, inside the packaged app (v20-0-plan A1–A3, F3):
 * what only the real WebView with the real shell can answer. Loaded by
 * services/native.js only when the shell says self-test mode is on
 * (CHESS_SELFTEST=1); a scenario name comes with it in the automation build
 * (CHESS_SELFTEST_SCENARIO). Each run writes its report through
 * chess.selftestReport — `{ ok, stage, checks: { name: { pass, … } } }` — and
 * the driver (scripts/automation-app.mjs) reads it. Without a scenario the
 * shell exits on the report, 0 when ok.
 *
 *   (none)       smoke: the board is drawn, the native db and the native
 *                engine answer
 *   app-move     a new two-player game, e2e4 e7e5, written to the db
 *   app-restore  the next launch: the same game, with both moves, is back
 *   app-db       the db contract against the native SQLite store; append latency
 *   app-engine   the engine contract against native Stockfish; a 60-ply
 *                review on the board (review/review.js, progressive): time to
 *                the first card, the whole pass, depth and nodes/s per level;
 *                the same game the 19.0 way (200 ms a position) for before /
 *                after; a kill mid-search survived; Threads and Hash as asked
 *   app-menu     the menu bar (20.0 E3): each step reports `await:<command>`,
 *                the driver sends that menu command through the automation
 *                server, and the page checks it acted — 我, 下, 翻转棋盘,
 *                新对局; then the language: the bar in English (`expectMenu`,
 *                which the driver reads off the automation snapshot), and back
 *   app-open     files the OS hands over (20.0 E3): `await:open-1` — the
 *                driver opens one .pgn (Windows: on the command line of this
 *                launch; macOS: `open -a`, the Apple event), and it is
 *                imported on 我; `await:open-2` — a second file while the app
 *                runs (Windows: a second launch, which hands it over and
 *                exits; macOS: `open -a` again), imported too
 * @module selftest
 */
import { createHarness } from "../../scripts/app/harness.mjs";
import dbContract from "../../scripts/app/db-contract.mjs";
import engineContract from "../../scripts/app/engine-contract.mjs";
import { COACH_GAMES } from "../../scripts/fixtures/coach-games.mjs";
import { createDb, newId } from "./services/db.js";
import { nativeBackend } from "./services/db-native.js";
import { createEngineService, REVIEW_NODES } from "./services/engine.js";
import { nativeStockfishBackend } from "./services/engine-native.js";
import { runPass, engineAnalyze } from "./core/pass.js";
import { createReview } from "./review/review.js";
import { Chess } from "./core/chess.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (xs) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const pct = (xs, p) => { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * p))] : null; };
const round = (x, d = 2) => (x == null ? null : Math.round(x * 10 ** d) / 10 ** d);

async function waitFor(pred, ms, what) {
  const t0 = Date.now();
  for (;;) {
    const v = await pred();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("no " + what + " in " + ms + " ms");
    await sleep(50);
  }
}

/** The router the app was started with (runSelftest). */
let appRouter = null;
/**
 * 下's board, drawn. The first start on a device opens 学 (the placement,
 * 7e160fb), so a scenario that needs 下 goes there first instead of waiting
 * for a board that page never draws.
 */
async function boardDrawn() {
  if (appRouter && appRouter.route.peek().path !== "/play") await appRouter.go("/play");
  return waitFor(() => performance.getEntriesByName("app:board").length > 0 && document.querySelector("[data-page=play] canvas"), 30000, "board");
}

/** A contract suite's cases as checks: { pass, passed, failed, failures }. */
async function runSuite(add, label) {
  const lines = [];
  const h = createHarness((l) => lines.push(l));
  add(h.test);
  const t0 = performance.now();
  const r = await h.run(label);
  return { pass: r.failed === 0 && r.passed > 0, passed: r.passed, failed: r.failed, failures: r.failures, ms: Math.round(performance.now() - t0), log: lines.slice(0, 8) };
}

/**
 * One review on the board (review/review.js) against `svc`, with a db that
 * holds nothing: ms to the first card and to the finished pass, and per
 * level (scan / normal / deep) the searches, median depth and nodes/s.
 */
async function reviewOnce(be, svc, game, positions, budget) {
  const per = { scan: [], normal: [], deep: [] };
  const recording = { ...svc, analyse: async (fen, o) => {
    const r = await svc.analyse(fen, o);
    const lv = o && o.budget && (o.budget.review || (budget && Object.keys(budget).find((k) => budget[k] === o.budget)));
    if (lv && be.info.last) per[lv].push(be.info.last);
    return r;
  } };
  const db = Promise.resolve({ query: async () => [], append: async () => {} });
  const rv = createReview({ engine: recording, db, t: (k, ...a) => k + a.join(","), ...(budget ? { budget } : {}) });
  await rv.open(game, { sides: ["w"] });
  await rv.whenFinished();
  const out = { plies: game.moves.length, positions: rv.data ? rv.data.fens.length : 0, firstCardMs: rv.timing.firstCardMs, fullMs: rv.timing.fullMs,
    scanMs: rv.timing.scanMs, moments: rv.data ? rv.data.moments.map((m) => m.ply + ":" + m.san + ":" + m.grade) : [], threads: be.info.threads };
  for (const [lv, xs] of Object.entries(per)) {
    out[lv] = { searches: xs.length, medianDepth: median(xs.map((s) => s.depth)), minDepth: xs.length ? Math.min(...xs.map((s) => s.depth)) : null,
      medianNodes: median(xs.map((s) => s.nodes)), medianNps: median(xs.map((s) => s.nps)), medianMs: median(xs.map((s) => s.ms)) };
  }
  rv.close();
  return out;
}

const SCENARIOS = {
  async smoke({ ready, analyst, nativeInfo }, checks) {
    await boardDrawn();
    checks.board = { pass: true, at: Math.round(performance.getEntriesByName("app:board")[0].startTime) };
    await ready;
    checks.db = { pass: nativeInfo.db === "native", backend: nativeInfo.db };
    const t0 = performance.now();
    const r = await analyst.search(START, { multipv: 1, movetime: 300 });
    checks.engine = { pass: !!(r.lines[0] && r.lines[0].pv[0]) && analyst.name === "stockfish-native", name: analyst.name, fallback: nativeInfo.fallback,
      move: r.lines[0] && r.lines[0].pv[0], depth: r.lines[0] && r.lines[0].depth, ms: Math.round(performance.now() - t0) };
  },

  async "app-move"(ctx, checks, rep) {
    const { store, ready } = ctx;
    await boardDrawn();
    checks.board = { pass: true };
    const db = await ready;
    const id = newId();
    store.dispatch("play.new", { id, mode: "pvp" });
    store.dispatch("play.move", { uci: "e2e4", now: Date.now() });
    store.dispatch("play.move", { uci: "e7e5", now: Date.now() });
    await db.flush();
    const back = await db.query("game.current");
    const ucis = back && back.moves.map((m) => m.uci);
    checks.move = { pass: !!back && back.game.id === id && ucis.join(" ") === "e2e4 e7e5", id, moves: ucis, backend: ctx.nativeInfo.db };
    rep.wrote = id;
  },

  async "app-restore"({ store, ready }, checks, rep) {
    await boardDrawn();
    await ready;
    const g = await waitFor(() => store.get().play.game, 10000, "restored game");
    const ucis = g.moves.map((m) => m.uci);
    checks.restored = { pass: ucis.join(" ") === "e2e4 e7e5", id: g.id, moves: ucis };
    rep.found = g.id;
  },

  async "app-db"(ctx, checks, rep) {
    await ctx.ready;
    checks.contract = await runSuite((test) => dbContract(test, (name) => createDb(nativeBackend(name)), ""), "native: ");
    // append latency: one move per task, each awaited (the autosave's shape)
    const db = await createDb(nativeBackend("latency-" + Date.now()));
    const gameId = newId();
    await db.append({ type: "game.start", gameId, mode: "pvp", startFen: START });
    const each = [];
    for (let ply = 0; ply < 200; ply++) {
      const t0 = performance.now();
      await db.append({ type: "game.move", gameId, ply, uci: "e2e4", san: "e4" });
      each.push(performance.now() - t0);
    }
    const t1 = performance.now();
    const batch = [];
    for (let i = 0; i < 100; i++) batch.push(db.append({ type: "note", i }));
    await Promise.all(batch);
    const batchMs = performance.now() - t1;
    const t2 = performance.now();
    const moves = await db.query("game.moves", { gameId });
    const readMs = performance.now() - t2;
    rep.latency = { appendMedianMs: round(median(each)), appendP95Ms: round(pct(each, 0.95)), appendMaxMs: round(Math.max(...each)), batch100Ms: round(batchMs), read200Ms: round(readMs) };
    checks.latency = { pass: moves.length === 200 && median(each) < 50, ...rep.latency };
    await db.close();
  },

  async "app-engine"(ctx, checks, rep) {
    // the page's own native engine (one process, one queue of searches)
    const be = ctx.analyst && ctx.analyst.nativeBackend ? await ctx.analyst.nativeBackend() : nativeStockfishBackend();
    if (!be) throw new Error("the page's engine fell back to wasm: " + ctx.nativeInfo.fallback);
    await be.boot();
    checks.boot = { pass: be.info.threads >= 1, cores: be.info.cores, threads: be.info.threads, hashMb: be.info.hashMb };
    const svc = createEngineService(be);
    checks.contract = await runSuite((test) => engineContract(test, () => svc, { budget: { ms: 200 } }), "native: ");

    // a 60-ply review, the way the page runs it: progressive, at the review's levels
    const sans = COACH_GAMES[0].san.slice(0, 60);
    const g = new Chess();
    const fens = [g.fen()];
    const moves = [];
    for (const s of sans) { const m = g.move(s); fens.push(g.fen()); moves.push({ san: m.san, fen: g.fen() }); }
    await be.clear();
    rep.review = await reviewOnce(be, svc, { id: "st-60", startFen: START, moves }, fens.length);
    rep.review.nodesPerThread = { ...REVIEW_NODES.native };
    // gates with room for a slow runner: the targets are 3 s and 8 s (v20-0-plan §10 P5b);
    // the 19.0 way took 28–29 s here, and the normal level must reach depth 16
    checks.review = { pass: rep.review.positions === fens.length && rep.review.firstCardMs != null && rep.review.firstCardMs <= 4000 &&
      rep.review.fullMs != null && rep.review.fullMs <= 25000 && rep.review.normal.medianDepth >= 16, ...rep.review };
    // the 19.0 way on the same game and engine: 200 ms a position (before / after)
    const stats = [];
    const recording = { ...svc, analyse: async (fen, o) => { const r = await svc.analyse(fen, o); if (be.info.last) stats.push(be.info.last); return r; } };
    await be.clear();
    const t0 = performance.now();
    const p19 = await runPass({ fens, sans, budget: 200, analyze: engineAnalyze(recording) });
    const quick = stats.filter((s) => s.ms < 600);
    rep.review19 = { budgetMs: 200, reviewS: round((performance.now() - t0) / 1000), searches: stats.length, deep: p19.deep.filter(Boolean).length,
      medianDepth: median(quick.map((s) => s.depth)), medianNps: median(quick.map((s) => s.nps)) };
    // a lighter budget, for the record (what the nodes buy): half of every level, as plain
    // nodes (× Threads) — this bundle's REVIEW_NODES is a copy, not the page's
    const T = be.info.threads, half = (n) => ({ nodes: Math.round(n / 2) * T });
    const lighter = { scan: half(REVIEW_NODES.native.scan), normal: half(REVIEW_NODES.native.normal), deep: half(REVIEW_NODES.native.deep) };
    await be.clear();
    rep.reviewHalf = await reviewOnce(be, svc, { id: "st-60h", startFen: START, moves }, fens.length, lighter);
    rep.reviewHalf.nodesPerThread = Object.fromEntries(Object.entries(lighter).map(([k, v]) => [k, v.nodes / T]));
    // one long look from the start: a ceiling for nodes/s on this machine
    await svc.analyse(START, { lines: 1, budget: { ms: 3000 } });
    rep.long = { ...be.info.last };
    checks.long = { pass: (be.info.last.depth || 0) >= 20, ...rep.long };
    // a kill mid-search: that search fails, the next one starts a new process
    const pending = be.search(START, { movetime: 5000 });
    await sleep(300);
    await be.kill();
    let failed = false;
    try { await pending; } catch { failed = true; }
    const again = await be.search(START, { depth: 14 });
    checks.restart = { pass: failed && again.lines[0].depth >= 14 && be.restarts >= 1, failedSearch: failed, depth: again.lines[0].depth, restarts: be.restarts };
  },

  async "app-menu"(ctx, checks, rep) {
    const { router, store, report } = ctx;
    await boardDrawn();
    checks.shell = { pass: !!(await window.__app.shell) };
    const route = () => router.route.peek();
    const steps = [
      { cmd: "go.me", ok: () => route().path === "/me" && document.querySelector("[data-test=library]") },
      { cmd: "go.play", ok: () => route().path === "/play" && window.__play },
      { cmd: "game.flip", ok: () => window.__play && window.__play.flipped.peek() === true },
      { cmd: "game.new", ok: () => document.querySelector("[data-test=opp-card]") },
      // the language: the bar is rebuilt in English (the driver reads it off the snapshot first)
      { before: async () => { document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); store.dispatch("settings.set", { key: "lang", value: "en" }); await sleep(1500); },
        expectMenu: "New Game", cmd: "go.learn", ok: () => route().path === "/learn" },
      { before: async () => { store.dispatch("settings.set", { key: "lang", value: "zh" }); await sleep(1500); },
        expectMenu: "新对局", cmd: "go.play", ok: () => route().path === "/play" },
    ];
    for (const [i, st] of steps.entries()) {
      if (st.before) await st.before();
      // the step number: the same command can come twice (go.play), and the driver answers each step once
      rep.step = i;
      rep.stage = "await:" + st.cmd;
      rep.expectMenu = st.expectMenu || null;
      await report();
      const t0 = Date.now();
      const key = "menu:" + st.cmd + (st.expectMenu ? "@" + st.expectMenu : "");
      try { await waitFor(st.ok, 30000, st.cmd); checks[key] = { pass: true, ms: Date.now() - t0 }; }
      catch (e) { checks[key] = { pass: false, err: e.message }; }
    }
    rep.expectMenu = null;
  },

  async "app-open"(ctx, checks, rep) {
    const { router, ready, report } = ctx;
    // Not boardDrawn(): on Windows the first file is on this launch's command
    // line, so the shell opens 我 as soon as the first page is mounted — the
    // play board may never be drawn (job 128306275065 waited 30 s for it).
    // What this scenario needs is the store and the shell.
    const db = await ready;
    checks.shell = { pass: !!(await window.__app.shell) };
    const count = () => db.query("table.count", { table: "library" });
    // open-1.pgn holds two games, open-2.pgn one (scripts/automation-app.mjs OPEN_FILES)
    for (const [i, [stage, want]] of [["open-1", 2], ["open-2", 3]].entries()) {
      rep.step = i;
      rep.stage = "await:" + stage;
      await report();
      const t0 = Date.now();
      try {
        await waitFor(async () => (await count()) >= want && router.route.peek().path === "/me" &&
          /done/.test((document.querySelector("[data-test=import-status]") || {}).dataset?.state || ""), 60000, stage);
        checks[stage] = { pass: (await count()) === want, games: await count(), ms: Date.now() - t0,
          status: document.querySelector("[data-test=import-status]").textContent };
      } catch (e) {
        checks[stage] = { pass: false, err: e.message, games: await count() };
      }
      const st = document.querySelector("[data-test=import-status]");
      if (st) st.dataset.state = "";
    }
  },
};

/** Run the scenario the shell named (or the smoke) and report it. */
export async function runSelftest(ctx, { invoke, scenario }) {
  const name = scenario || "smoke";
  const run = SCENARIOS[name];
  const checks = {};
  const rep = { ok: false, scenario: name, stage: "running", checks };
  const report = () => invoke("chess.selftestReport", rep).catch(() => {});
  appRouter = ctx.router || null;
  // a scenario's reports are read as they come (the shell stays up); the
  // plain self-test's one report ends the app, so it is sent only at the end
  if (scenario) await report();
  try {
    if (!run) throw new Error("no scenario " + name);
    await run({ ...ctx, report }, checks, rep);
    rep.ok = Object.values(checks).every((c) => c.pass);
  } catch (e) {
    rep.err = String(e && e.stack || e).slice(0, 2000);
    rep.ok = false;
  }
  rep.stage = "done";
  rep.ua = navigator.userAgent;
  await report();
}
