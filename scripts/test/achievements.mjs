/**
 * Achievements: well-formed, unique and each reachable.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert, ctx, loadModule } from "./harness.mjs";

export async function run() {
  // achievements: well-formed, unique, each reachable from some summary, and the
  // meta "completionist" resolves from the others
  {
    loadModule(ctx, "src/web/js/achievements.js");
    const ach = ctx.CHESS_ACHIEVEMENTS;
    assert(Array.isArray(ach) && ach.length >= 10, "achievements loaded (" + (ach ? ach.length : 0) + ")");
    const ids = new Set();
    let bad = 0;
    const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
    // a maxed-out summary should unlock everything, an empty one nothing (except
    // completionist is gated on others so it also stays locked when empty)
    const full = {
      lessonsDone: 99, lessonsTotal: 28, puzzleSolvedCount: 99,
      matesSolved: 23, matesTotal: 23, tacSolved: 6, tacTotal: 6, realSolved: 24, realTotal: 24,
      opSolved: 38, opTotal: 38, wins: 99, losses: 0, draws: 0, games: 99, extremeWins: 9,
      otherUnlocked: 12, otherTotal: 12,
    };
    const empty = {
      lessonsDone: 0, lessonsTotal: 28, puzzleSolvedCount: 0,
      matesSolved: 0, matesTotal: 23, tacSolved: 0, tacTotal: 6, realSolved: 0, realTotal: 24,
      opSolved: 0, opTotal: 38, wins: 0, losses: 5, draws: 0, games: 5, extremeWins: 0,
      otherUnlocked: 0, otherTotal: 12,
    };
    for (const a of ach) {
      if (!a.id || ids.has(a.id)) { fail("achievement id missing/duplicate", a.id); continue; }
      ids.add(a.id);
      if (!a.icon || !a.name || !a.desc) fail(a.id, "missing icon/name/desc");
      if (typeof a.test !== "function") { fail(a.id, "test not a function"); continue; }
      if (!a.test(full)) fail(a.id, "not unlocked by a maxed summary");
      if (a.test(empty)) fail(a.id, "unlocked by an empty summary");
    }
    assert(bad === 0, "all achievements well-formed and reachable");
  }
}
