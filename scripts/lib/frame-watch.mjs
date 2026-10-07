/**
 * What the page looked like when a frame did not come (v8-3-plan V4).
 *
 * test-layout-e2e's 5b probe waits two rAFs or 400 ms (8.2 added the timer
 * after release rehearsal 36721702122 sat on a bare rAF chain for an hour).
 * The timer keeps the job alive, and it also hides the event: a fallback
 * left one line, "5b: N 次", and nothing about why the compositor skipped.
 * The plan asks for three occurrences in CI before choosing a fix, so each
 * one has to carry its own evidence:
 *
 *   - which scenario, and which viewport the probe was taken at;
 *   - the last few resizes the test asked for (with their age), next to the
 *     sizes the page itself saw arrive as `resize` events — a resize that was
 *     requested and never reached the page is a different bug from a page
 *     that has the size and paints no frame;
 *   - how many of the probe's two rAFs ran, how many frames the page drew in
 *     all and how long since the last one, document.visibilityState and its
 *     changes, document.hasFocus().
 *
 * PAGE_HOOK goes into the context with addInitScript. It only observes: the
 * rAF wrapper counts frames the page asked for anyway and requests none of
 * its own, so it cannot supply the frame whose absence it is recording.
 *
 * Each fallback logs one `FRAME-MISS {json}` line; at exit the shard writes
 * its count to $GITHUB_STEP_SUMMARY, zero included, so "how often" is read
 * off the run page across shards rather than out of four job logs.
 */
import fs from "fs";

/** Runs in the page (ctx.addInitScript). Self-contained: it is serialised. */
export const PAGE_HOOK = () => {
  if (window.__frameWatch) return;
  const keep = 6;
  const fw = window.__frameWatch = { frames: 0, lastT: -1, lastAt: -1, resizes: [], vis: [] };
  const now = () => Math.round(performance.now());
  const raf = window.requestAnimationFrame.bind(window);
  // one count per frame, not per callback: every callback of a frame gets the
  // same timestamp
  window.requestAnimationFrame = (cb) => raf((t) => {
    if (t !== fw.lastT) { fw.frames++; fw.lastT = t; fw.lastAt = now(); }
    return cb(t);
  });
  window.addEventListener("resize", () => {
    fw.resizes.push([innerWidth, innerHeight, now()]);
    if (fw.resizes.length > keep) fw.resizes.shift();
  });
  document.addEventListener("visibilitychange", () => {
    fw.vis.push([document.visibilityState, now()]);
    if (fw.vis.length > keep) fw.vis.shift();
  });
};

/**
 * The test side: the resizes it asked for, the misses, the summary.
 * `shard` is { index, count } (e2e-shard.mjs); `scenario` returns the index
 * of the scenario now running.
 */
export function makeFrameWatch({ shard, scenario = () => -1, log = console.log, keep = 6, clock = Date.now }) {
  const asked = [];
  const misses = [];
  return {
    /** page.setViewportSize, remembered */
    async resize(page, size) {
      asked.push([size.width, size.height, clock()]);
      if (asked.length > keep) asked.shift();
      await page.setViewportSize(size);
    },
    /** one fallback: `where` names the probe, `page` is what the probe read in the page */
    miss(where, page) {
      const t = clock();
      const rec = { shard: `${shard.index}/${shard.count}`, scenario: scenario(), where,
        asked: asked.map(([w, h, at]) => [w, h, t - at]), page };
      misses.push(rec);
      log("FRAME-MISS " + JSON.stringify(rec));
      return rec;
    },
    get count() { return misses.length; },
    /** one markdown line for the job summary */
    summary() {
      // the first few places by name: a summary line, not a second log
      const where = [...new Set(misses.map((m) => "#" + m.scenario + " " + m.where))];
      const named = where.slice(0, 6).join("，") + (where.length > 6 ? `，另 ${where.length - 6} 处` : "");
      return `- layout shard ${shard.index}/${shard.count}: ${misses.length} 次量取没等到两帧、按 400 ms 兜底` +
        (where.length ? `（${named}；明细见日志里的 FRAME-MISS 行）` : "") + "\n";
    },
    /** append the line to $GITHUB_STEP_SUMMARY when there is one (sync: also runs from process 'exit') */
    writeSummary(file = process.env.GITHUB_STEP_SUMMARY) {
      if (!file) return false;
      try { fs.appendFileSync(file, this.summary()); return true; } catch { return false; }
    },
  };
}
