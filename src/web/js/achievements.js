/**
 * Achievements — pure derivations of already-persisted progress (game stats,
 * lesson completion, puzzle solves). No new gameplay state: each badge's
 * `test(s)` reads a summary object the app builds from existing storage.
 * scripts/test-chess.mjs checks every badge is well-formed and reachable.
 * @module achievements
 */
(function (global) {
  global.CHESS_ACHIEVEMENTS = [
    { id: "first-lesson", icon: "🎓", name: "初学乍练", desc: "完成第 1 课",
      test: (s) => s.lessonsDone >= 1 },
    { id: "all-lessons", icon: "📚", name: "规则通关", desc: "完成全部教学课程",
      test: (s) => s.lessonsTotal > 0 && s.lessonsDone >= s.lessonsTotal },
    { id: "first-puzzle", icon: "🧩", name: "初试身手", desc: "解出第 1 道题",
      test: (s) => s.puzzleSolvedCount >= 1 },
    { id: "puzzle-10", icon: "🎯", name: "战术之眼", desc: "累计解出 10 道题",
      test: (s) => s.puzzleSolvedCount >= 10 },
    { id: "all-mates", icon: "♛", name: "杀法大师", desc: "解出全部杀王题",
      test: (s) => s.matesTotal > 0 && s.matesSolved >= s.matesTotal },
    { id: "all-tactics", icon: "⚡", name: "战术行家", desc: "解出全部战术母题",
      test: (s) => s.tacTotal > 0 && s.tacSolved >= s.tacTotal },
    { id: "all-openings", icon: "📖", name: "开局博士", desc: "背完全部开局线路",
      test: (s) => s.opTotal > 0 && s.opSolved >= s.opTotal },
    { id: "first-win", icon: "🏆", name: "首胜", desc: "人机对弈赢下第 1 局",
      test: (s) => s.wins >= 1 },
    { id: "win-10", icon: "👑", name: "常胜将军", desc: "人机累计胜 10 局",
      test: (s) => s.wins >= 10 },
    { id: "extreme-win", icon: "🔥", name: "屠龙", desc: "在「极限」难度赢一局",
      test: (s) => s.extremeWins >= 1 },
    { id: "veteran", icon: "⏳", name: "身经百战", desc: "人机累计对局 50 局",
      test: (s) => s.games >= 50 },
    { id: "completionist", icon: "🌟", name: "圆满", desc: "解锁上面全部成就",
      test: (s) => s.otherUnlocked >= s.otherTotal && s.otherTotal > 0 },
  ];
})(typeof window !== "undefined" ? window : globalThis);
