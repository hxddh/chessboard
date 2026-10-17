/**
 * The first seconds of a launch (14.0 A3, docs/v14-0-plan.md §1).
 *
 * After the first paint a launch used to fetch and evaluate the engine's
 * 9.7 MB and a Maia net at once — long tasks of 300–600 ms right when the
 * board has just appeared and the player reaches for it. Unless the engine
 * is on move, both wait for this: the launch's first BOOT_QUIET_MS. (The
 * mined puzzles and the library's database still come right after the
 * paint: the pages that count them read them at once.)
 * @module quiet
 */
export const BOOT_QUIET_MS = 3000;
const t0 = typeof performance !== "undefined" ? performance.now() : 0;

/** How long is left of the launch's quiet, in ms (0 once it is over). */
export function quietLeft() {
  return typeof performance !== "undefined" ? Math.max(0, BOOT_QUIET_MS - (performance.now() - t0)) : 0;
}

