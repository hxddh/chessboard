/**
 * v10-0-plan E3: wait for the page to have finished what it was doing,
 * instead of for a fixed number of milliseconds.
 *
 * The browser suites waited 1,258 times for a guessed time — slow where the
 * guess was long, flaky where it was short. What most of those waits stood
 * for is "the click's transition has run and the frame after it is drawn":
 * every finite animation finished (an infinite one — the engine's thinking
 * dot, a spinner — never does, and is not waited for), then two animation
 * frames, so a layout read after this reads the settled one.
 *
 * A wait for a timer the app sets itself (a toast's life, the run's hand-off
 * to the next puzzle, a debounce) is not this, and stays a wait for what the
 * timer does.
 * @module lib/settle
 */
export async function settle(page, timeout = 2000) {
  await page.waitForFunction(() => document.getAnimations().every((a) => {
    if (a.playState !== "running") return true;
    const t = a.effect && a.effect.getTiming ? a.effect.getTiming() : null;
    return !!t && t.iterations === Infinity;
  }), null, { timeout, polling: "raf" }).catch(() => {});
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))).catch(() => {});
}
