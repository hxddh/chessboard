/**
 * Sharding for a long browser suite (v8-0-plan F1).
 *
 * test-layout-e2e was the critical path of every PR — 31m51s on Chromium, a
 * single job, while every other group finished inside 13 minutes. It is ~90
 * independent top-level scenarios in one file, so it splits cleanly: each
 * scenario opens with `if (scenario()) {`, and SHARD=i/n runs the scenarios
 * whose index k (0-based, in source order) has k % n === i - 1.
 *
 * Round-robin rather than contiguous ranges: the scenarios near one another in
 * the file tend to be of a kind (the viewport sweeps sit together, the long
 * interaction flows sit together), so contiguous thirds would be lopsided.
 *
 * Every index lands in exactly one shard for every n by construction — that
 * is checked in test-chess.mjs, together with "every top-level block of the
 * suite is gated", which is what would otherwise let a new block run in
 * every shard (n times) or, gated by something else, in none.
 *
 * No SHARD (or an empty one) means all of it — a local `node
 * scripts/test-layout-e2e.mjs` is unchanged.
 */

export function parseShard(spec) {
  const s = String(spec ?? "").trim();
  if (!s) return { index: 1, count: 1 };
  const m = /^(\d+)\/(\d+)$/.exec(s);
  const index = m ? Number(m[1]) : NaN, count = m ? Number(m[2]) : NaN;
  if (!(count >= 1 && index >= 1 && index <= count)) {
    throw new Error("SHARD must look like i/n with 1 <= i <= n, got " + JSON.stringify(s));
  }
  return { index, count };
}

/** Does scenario k (0-based) belong to shard {index, count}? */
export const inShard = (k, { index, count }) => k % count === index - 1;

/**
 * One gate per scenario, called in source order. Logs each scenario it runs
 * with the wall time of the previous one, so a CI log shows where a shard's
 * minutes went and a lopsided split can be rebalanced from data.
 */
export function makeScenarioGate(spec, log = console.log, limitMs = Number(process.env.SCENARIO_TIMEOUT_MS) || 600000) {
  const shard = parseShard(spec);
  let k = -1, t0 = 0, last = -1, dog = null;
  const lap = () => {
    if (dog) { clearTimeout(dog); dog = null; }
    if (last >= 0) log(`[shard ${shard.index}/${shard.count}] scenario #${last} ${((Date.now() - t0) / 1000).toFixed(1)}s`);
    last = -1;
  };
  // A scenario that awaits something that never settles (a rAF chain inside
  // page.evaluate has no timeout) used to sit silently until the job's own
  // cancel, an hour later, naming nothing. The slowest one runs ~4 minutes on
  // a runner; past the limit, say which one and fail the process.
  const watch = (n) => {
    dog = setTimeout(() => {
      console.error(`FAIL: [shard ${shard.index}/${shard.count}] scenario #${n} still running after ${limitMs / 1000}s — hung`);
      process.exit(1);
    }, limitMs);
    dog.unref?.();
  };
  const scenario = () => {
    lap();
    k++;
    if (!inShard(k, shard)) return false;
    last = k; t0 = Date.now();
    watch(k);
    return true;
  };
  scenario.done = () => { lap(); return { shard, total: k + 1 }; };
  // v8-3-plan V4: the scenario running now, for a log line that names it
  scenario.current = () => last;
  scenario.shard = shard;
  return scenario;
}
