/**
 * Tactics puzzle set — hand-authored classic mating patterns, fully offline.
 * All positions are white to move. Solutions are canonical chess.js SAN:
 *   m1: [whiteMate]
 *   m2: [white, blackBestDefense, whiteMate]
 *   m3: [white, black, white, black, whiteMate]
 * scripts/test-chess.mjs proves every m1 solution mates and every m2/m3 first
 * move FORCES mate within the move budget (a small exhaustive solver checks
 * all defenses), so the runtime can also accept alternate winning first moves
 * it verifies the same way.
 * @module puzzles
 */
(function (global) {
  global.CHESS_PUZZLES = [
    // —— 一步将死 ——
    { id: "m1-backrank-r", cat: "m1", name: "底线杀",
      fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", solution: ["Ra8#"] },
    { id: "m1-q-knight", cat: "m1", name: "马护后杀",
      fen: "7k/8/5N2/8/8/8/8/K5Q1 w - - 0 1", solution: ["Qg8#"] },
    { id: "m1-smother", cat: "m1", name: "闷杀",
      fen: "6rk/6pp/8/6N1/8/8/8/7K w - - 0 1", solution: ["Nf7#"] },
    { id: "m1-ladder", cat: "m1", name: "双车梯杀",
      fen: "k7/7R/8/8/8/8/8/6RK w - - 0 1", solution: ["Rg8#"] },
    { id: "m1-kq-box", cat: "m1", name: "后王合璧",
      fen: "k7/8/2K5/8/8/8/8/1Q6 w - - 0 1", solution: ["Qb7#"] },
    { id: "m1-epaulette", cat: "m1", name: "肩章杀",
      fen: "3rkr2/8/8/8/8/7Q/8/7K w - - 0 1", solution: ["Qe6#"] },
    { id: "m1-pawn-q", cat: "m1", name: "兵护后杀",
      fen: "7k/3Q4/6P1/8/8/8/8/7K w - - 0 1", solution: ["Qh7#"] },
    { id: "m1-edge-r", cat: "m1", name: "边线杀",
      fen: "8/8/8/8/5K1k/8/8/R7 w - - 0 1", solution: ["Rh1#"] },
    { id: "m1-bishops", cat: "m1", name: "双象杀",
      fen: "k7/8/1K6/8/5B2/8/4B3/8 w - - 0 1", solution: ["Bf3#"] },
    { id: "m1-q-backrank", cat: "m1", name: "吃车底线杀",
      fen: "3r2k1/5ppp/8/8/8/8/8/3Q2K1 w - - 0 1", solution: ["Qxd8#"] },
    { id: "m1-promo", cat: "m1", name: "升变杀",
      fen: "7k/5P2/6K1/8/8/8/8/8 w - - 0 1", solution: ["f8=Q#"] },
    { id: "m1-arabian", cat: "m1", name: "阿拉伯杀",
      fen: "7k/R7/5N2/8/8/8/8/K7 w - - 0 1", solution: ["Rh7#"] },
    // —— 两步将死 ——
    { id: "m2-corner-h8", cat: "m2", name: "静着锁角",
      fen: "7k/8/8/6K1/8/8/8/1Q6 w - - 0 1", solution: ["Kg6", "Kg8", "Qb8#"] },
    { id: "m2-corner-a8", cat: "m2", name: "静着锁角 II",
      fen: "k7/8/8/1K6/8/8/8/6Q1 w - - 0 1", solution: ["Kb6", "Kb8", "Qg8#"] },
    { id: "m2-corner-a1", cat: "m2", name: "静着锁角 III",
      fen: "6Q1/8/8/8/1K6/8/8/k7 w - - 0 1", solution: ["Kb3", "Kb1", "Qg1#"] },
    { id: "m2-corner-rook", cat: "m2", name: "车王锁角",
      fen: "7k/8/8/6K1/8/8/8/R7 w - - 0 1", solution: ["Kg6", "Kg8", "Ra8#"] },
    { id: "m2-ladder-rank", cat: "m2", name: "双车赶王",
      fen: "8/1k6/5R2/8/8/8/8/6RK w - - 0 1", solution: ["Rg7+", "Kb8", "Rf8#"] },
    { id: "m2-ladder-file", cat: "m2", name: "双车赶王 II",
      fen: "6R1/8/8/8/8/5R2/1k6/7K w - - 0 1", solution: ["Rg2+", "Kb1", "Rf1#"] },
    { id: "m2-rr-sac", cat: "m2", name: "叠车强吃底线",
      fen: "r3r1k1/5ppp/8/8/8/8/4R3/4R1K1 w - - 0 1", solution: ["Rxe8+", "Rxe8", "Rxe8#"] },
    { id: "m2-q-sac", cat: "m2", name: "弃后底线杀",
      fen: "r3r1k1/5ppp/8/8/8/8/4Q3/4R1K1 w - - 0 1", solution: ["Qxe8+", "Rxe8", "Rxe8#"] },
    // —— 三步将死 ——(求解器证明:无二步捷径,首着对所有防守强制)
    { id: "m3-ladder-b", cat: "m3", name: "双车赶王三步",
      fen: "8/8/1k6/7R/8/8/8/6RK w - - 0 1", solution: ["Rg6+", "Ka7", "Rh7+", "Ka8", "Rg8#"] },
    { id: "m3-ladder-c", cat: "m3", name: "双车赶王三步 II",
      fen: "8/8/2k5/7R/8/8/8/6RK w - - 0 1", solution: ["Rg6+", "Kb7", "Rh7+", "Ka8", "Rg8#"] },
    { id: "m3-ladder-m", cat: "m3", name: "双车赶王三步 III",
      fen: "8/8/6k1/R7/8/8/8/1R5K w - - 0 1", solution: ["Rb6+", "Kf7", "Ra7+", "Ke8", "Rb8#"] },
  ];
})(typeof window !== "undefined" ? window : globalThis);
