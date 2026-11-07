/**
 * Maia-3 in Chromium (ADR 0004, v20-0-plan §3 P1), served as modules by
 * scripts/serve-app.mjs:
 *
 *   contract   the engine-service contract on maia3Backend (the fake engine
 *              as its analyst), the net in its module worker
 *   parity     the 60 reference positions, evaluated in the worker, against
 *              the PyTorch fixture: top-1 identical, KL < 1e-3
 *   app        ?engine=maia3-fake: the app's engine service answers bestMove
 *              for a rated opponent from Maia-3
 *   measured   cold load (fetch + fp16→f32 + compile), per-evaluation time in
 *              the worker and round trip (median / p90), heap, file sizes;
 *              the median evaluation must be ≤ 60 ms
 *
 *   node scripts/test-maia3-e2e.mjs          (E2E_REQUIRED=1: a missing browser fails)
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./serve-app.mjs";
import { launchBrowser, PERF_SLACK } from "./app/browser.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); }
};
const stats = (xs) => {
  const a = xs.slice().sort((p, q) => p - q);
  return { median: a[a.length >> 1], p90: a[Math.min(a.length - 1, Math.floor(a.length * 0.9))], n: a.length };
};

const srv = await startServer();
const browser = await launchBrowser();
const errors = [];
const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
await page.goto(srv.url + "?engine=maia3-fake&db=memory#/play");
await page.waitForSelector("[data-page]");

// --- measured + parity: a fresh worker, cold ------------------------------------
const m = await page.evaluate(async () => {
  const { workerRunner } = await import("./services/maia3/backend.js");
  const { compare } = await import("/scripts/app/maia3-parity.mjs");
  const cases = (await (await fetch("/scripts/app/fixtures/maia3-reference.json")).json()).cases;
  const runner = workerRunner();
  const t0 = performance.now();
  const info = await runner.init();
  const loadMs = performance.now() - t0;
  const passes = [];
  for (let pass = 0; pass < 3; pass++) {
    const out = [];
    for (const c of cases) {
      const s = performance.now();
      const r = await runner.evaluate(c.fen, { history: c.history, self: c.self, oppo: c.oppo });
      out.push({ r, rtt: performance.now() - s });
    }
    passes.push(out);
  }
  runner.dispose();
  const last = passes[passes.length - 1];
  const parity = compare(cases, (c) => last[cases.indexOf(c)].r);
  return {
    loadMs, workerLoadMs: info.loadMs, kernel: info.kernel, heapBytes: info.heapBytes,
    compute: passes.slice(1).flat().map((x) => x.r.ms), rtt: passes.slice(1).flat().map((x) => x.rtt),
    first: passes[0][0].r.ms,
    parity: { n: cases.length, top1: parity.top1, worstKl: parity.worstKl, worstWdl: parity.worstWdl, bad: parity.bad.map((x) => x.name) },
  };
});
const compute = stats(m.compute), rtt = stats(m.rtt);
const size = (f) => fs.statSync(path.join(ROOT, f)).size;
const report = {
  kernel: m.kernel, loadMs: Math.round(m.loadMs), workerLoadMs: Math.round(m.workerLoadMs),
  evalMsMedian: +compute.median.toFixed(1), evalMsP90: +compute.p90.toFixed(1),
  roundTripMsMedian: +rtt.median.toFixed(1), roundTripMsP90: +rtt.p90.toFixed(1), firstEvalMs: +m.first.toFixed(1),
  heapMB: +(m.heapBytes / 1e6).toFixed(1),
  weightsBytes: size("third_party/maia3/maia3-5m.f16"), headerBytes: size("third_party/maia3/maia3-5m.json"),
  wasmBytes: size("src/app/services/maia3/kernels.wasm"),
  jsBytes: ["encode.js", "net.js", "model.js", "worker.js", "backend.js"].reduce((s, f) => s + size("src/app/services/maia3/" + f), 0),
};
console.log("maia3 in a Chromium worker: kernel " + report.kernel + ", cold load " + report.loadMs + " ms (" + report.workerLoadMs + " in the worker)" +
  ", eval median " + report.evalMsMedian + " ms · p90 " + report.evalMsP90 + " ms (" + compute.n + " evals)" +
  ", round trip median " + report.roundTripMsMedian + " · p90 " + report.roundTripMsP90 + " ms, heap " + report.heapMB + " MB");
assert(m.kernel === "wasm-simd", "the wasm SIMD kernel runs in the worker");
assert(m.parity.bad.length === 0 && m.parity.top1 === m.parity.n && m.parity.worstKl < 1e-3,
  "parity in the browser: top-1 " + m.parity.top1 + "/" + m.parity.n + ", worst KL " + m.parity.worstKl.toExponential(2) + (m.parity.bad.length ? " — " + m.parity.bad.join(", ") : ""));
assert(report.evalMsMedian <= 60 * PERF_SLACK, "median evaluation ≤ " + 60 * PERF_SLACK + " ms (" + report.evalMsMedian + ")");

// --- contract ----------------------------------------------------------------------
{
  const r = await page.evaluate(async () => {
    const { createHarness } = await import("/scripts/app/harness.mjs");
    const { default: engineContract } = await import("/scripts/app/engine-contract.mjs");
    const { createEngineService, fakeBackend } = await import("./services/engine.js");
    const { maia3Backend } = await import("./services/maia3/backend.js");
    const logs = [];
    const h = createHarness((l) => logs.push(l));
    const svc = createEngineService(maia3Backend({ analyst: fakeBackend() }));
    engineContract(h.test, () => svc, { label: "maia3: " });
    const out = await h.run();
    svc.dispose();
    return { ...out, logs };
  });
  for (const l of r.logs) console.error(l);
  assert(r.failed === 0 && r.passed >= 8, "engine contract on maia3 (worker): " + r.passed + " passed, " + r.failed + " failed");
}

// --- the app's own engine service ----------------------------------------------------
{
  const r = await page.evaluate(async () => {
    const e = window.__app.engine;
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    const d = await e.humanMoves(start, 1500);
    const b = await e.bestMove(start, { rating: 1500 });
    return { name: e.name, top: d[0].move, n: d.length, move: b.move };
  });
  assert(/^maia3\+fake$/.test(r.name) && r.n === 20 && /^[a-h][1-8][a-h][1-8]$/.test(r.move),
    "?engine=maia3-fake: humanMoves has the 20 opening moves (top " + r.top + "), a rated bestMove is " + r.move);
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await ctx.close();
await browser.close();
await srv.close();
console.log("\ntest-maia3-e2e: " + passed + " passed, " + failed + " failed");
console.log("MEASURED " + JSON.stringify(report));
process.exit(failed ? 1 : 0);
