/**
 * The skill graph (v20-0-plan §2 L1): what there is to learn, in the order
 * it is learnt — 走法 → 吃子 → 将军 → 将死 → 基本杀法 → 战术母题 → 计算 →
 * 开局原则 → 基本残局 → 中局计划.
 *
 * A node is { id, group, level, needs, … }:
 *   level    the rating at which a player usually has it: a placement lights
 *            every skill below the placed rating, and the stage goals
 *            (STAGES) are the skills below each goal
 *   needs    prerequisites — a skill is reached once all of them are lit
 *   motifs   the review's motif keys (core/explain, `review.finding`) that
 *            count as evidence against it
 *   lessons  19.0 lessons (src/web/js/lessons*.js) whose text explains it and
 *            whose move tasks become its first positions
 *   stars    a generated move mini-game for this kind of man
 *   pool     how scripts/gen-skills.mjs picks puzzles for it: Lichess themes,
 *            hand/mined categories and motifs, line motifs, the moving piece
 *   drills   endgame drills (19.0 endgames.js ids, or lesson drills)
 *   lines    opening lines to play ({ prefix, side, n })
 *   classic  a stretch of a 19.0 classic game to guess ({ id, from: ply, plies })
 *   game     a targeted game: the opponent's rating
 * Its words are in text/learn.<lang>.js under sk.<id> (name) and
 * sk.<id>.why (one sentence). The positions themselves are generated into
 * content/practice.js — never written by hand here.
 * @module content/skills
 */

export const GROUPS = ["move", "capture", "check", "mate", "mates", "tactics", "calc", "opening", "endgame", "middlegame"];

const S = (id, group, level, needs, more = {}) => ({ id, group, level, needs, motifs: [], lessons: [], ...more });

export const SKILLS = [
  // —— 走法 ——
  S("rook", "move", 100, [], { lessons: ["rook"], stars: "r" }),
  S("bishop", "move", 120, ["rook"], { lessons: ["bishop"], stars: "b" }),
  S("queen", "move", 150, ["bishop"], { lessons: ["queen"], stars: "q" }),
  S("knight", "move", 180, ["rook"], { lessons: ["knight"], stars: "n" }),
  S("king", "move", 200, ["rook"], { lessons: ["king"], stars: "k" }),
  S("pawn", "move", 220, ["rook"], { lessons: ["pawn"], stars: "p" }),
  S("promotion", "move", 260, ["pawn", "queen"], { lessons: ["promotion"], stars: "P", motifs: ["promotion"] }),
  S("castling", "move", 300, ["king"], { lessons: ["castle"], gen: "castle" }),
  S("en-passant", "move", 350, ["pawn", "capture"], { lessons: ["enpassant"], gen: "ep" }),
  // —— 吃子 ——
  S("capture", "capture", 300, ["queen", "knight", "king", "pawn"], { lessons: ["values"], motifs: ["hanging"],
    pool: { cats: ["win"], maxPlies: 1 } }),
  S("protect", "capture", 400, ["check"], { lessons: ["protect", "trade"], pool: { cats: ["win"], maxPlies: 3 } }),
  S("defend", "capture", 450, ["check"], { lessons: ["defend"], pool: { cats: ["def"] } }),
  S("hanging", "capture", 600, ["protect"], { motifs: ["hanging"], pool: { themes: ["hanging"], maxPlies: 3 } }),
  // —— 将军 ——
  S("check", "check", 320, ["capture"], { lessons: ["check"], gen: "check" }),
  // —— 将死 ——
  S("mate", "mate", 400, ["check"], { lessons: ["goal", "mate"], pool: { hand: ["m1-kq-box", "m1-kq-g7", "m1-ladder", "m1-edge-r"] },
    game: { rating: 600 } }),
  S("stalemate", "mate", 450, ["mate"], { lessons: ["stalemate"], gen: "stalemate" }),
  S("mate-in-1", "mate", 550, ["mate"], { motifs: ["mateThreat"], pool: { themes: ["m1"], cats: ["m1"] } }),
  // —— 基本杀法 ——
  S("ladder", "mates", 500, ["mate"], { lessons: ["ladder", "qrladder"], gen: "ladder" }),
  S("queen-mate", "mates", 600, ["stalemate"], { lessons: ["drill-queen"], gen: "kqk", drills: ["lesson:drill-queen", "qu-kqk"] }),
  S("rook-mate", "mates", 700, ["queen-mate"], { lessons: ["drill-rook"], gen: "krk", drills: ["lesson:drill-rook", "rp-krk"] }),
  S("back-rank", "mates", 650, ["mate-in-1"], { lessons: ["backrank"], motifs: ["backRank"], pool: { themes: ["backRank"] } }),
  S("queen-kiss", "mates", 700, ["mate-in-1"], { lessons: ["qkiss"], pool: { themes: ["m1"], cats: ["m1"], mateBy: "q-adjacent" } }),
  S("smothered", "mates", 900, ["mate-in-1", "knight"], { lessons: ["smother", "tc-smother"], pool: { themes: ["smothered"] } }),
  S("arabian", "mates", 950, ["mate-in-1"], { lessons: ["arabian"], pool: { themes: ["arabian"] } }),
  S("f7", "mates", 900, ["mate-in-1"], { pool: { themes: ["f2f7"] } }),
  S("mate-in-2", "mates", 1000, ["mate-in-1", "back-rank"], { pool: { themes: ["m2"], cats: ["m2"] } }),
  S("bishops-mate", "mates", 1300, ["rook-mate"], { lessons: ["drill-bishops"], gen: "kbbk", drills: ["lesson:drill-bishops", "mi-bb"] }),
  S("mate-in-3", "mates", 1400, ["mate-in-2"], { pool: { themes: ["m3"], cats: ["m3"] } }),
  // —— 战术母题 ——
  S("fork", "tactics", 700, ["protect", "mate"], { lessons: ["fork"], motifs: ["fork"], pool: { themes: ["fork"], motif: "fork" } }),
  S("knight-fork", "tactics", 800, ["fork"], { motifs: ["fork"], pool: { themes: ["fork"], motif: "fork", piece: "n" } }),
  S("pin", "tactics", 850, ["fork"], { lessons: ["pin"], motifs: ["pin"], pool: { themes: ["pin"], motif: "pin" } }),
  S("skewer", "tactics", 950, ["pin"], { lessons: ["skewer", "tc-skewer"], motifs: ["skewer", "xray"],
    pool: { themes: ["skewer"], motif: "skewer" } }),
  S("discovered", "tactics", 1050, ["pin"], { lessons: ["discovery"], motifs: ["discovered", "discoveredAttack"],
    pool: { themes: ["discoveredAttack"], motif: "discovered" } }),
  S("double-check", "tactics", 1250, ["discovered"], { motifs: ["double"], pool: { themes: ["double"], motif: "double" } }),
  S("remove-defender", "tactics", 1100, ["fork"], { lessons: ["remove"], motifs: ["removeDefender"], pool: { line: "removeDefender" } }),
  S("deflection", "tactics", 1150, ["remove-defender"], { lessons: ["deflect"], motifs: ["deflection"], pool: { line: "deflection" } }),
  S("overload", "tactics", 1200, ["deflection"], { lessons: ["overload", "tc-overload"], motifs: ["overload"], pool: { line: "overload" } }),
  S("decoy", "tactics", 1250, ["deflection"], { lessons: ["decoy", "tc-decoy"], motifs: ["decoy"], pool: { line: "decoy" } }),
  S("interference", "tactics", 1350, ["deflection"], { lessons: ["interfere", "tc-interference"] }),
  S("zwischenzug", "tactics", 1400, ["fork"], { lessons: ["tc-zwischenzug", "cl-inter"], motifs: ["zwischenzug"] }),
  S("trapped", "tactics", 1300, ["fork"], { lessons: ["po-trap"], motifs: ["trapped"], pool: { line: "trapped" } }),
  S("sacrifice", "tactics", 1400, ["deflection", "mate-in-2"], { pool: { themes: ["sacrifice"] } }),
  S("underpromotion", "tactics", 1500, ["promotion", "mate-in-2"], { pool: { themes: ["underPromotion"] } }),
  S("quiet-move", "tactics", 1600, ["sacrifice"], { lessons: ["cl-quiet"], pool: { themes: ["quiet"] } }),
  // —— 计算（「挑战」「专项」成为技能，v20-0-plan §6 S3）——
  S("threats", "calc", 900, ["hanging", "mate-in-1"], { lessons: ["cl-threat"], motifs: ["mateThreat"], pool: { cats: ["def"] } }),
  S("candidates", "calc", 1000, ["threats"], { lessons: ["cl-cands", "cl-order"] }),
  S("counting", "calc", 1000, ["hanging", "mate"], { lessons: ["cl-count"] }),
  S("checks-first", "calc", 1100, ["candidates"], { lessons: ["cl-checks", "cl-mate"] }),
  S("pawn-race", "calc", 1100, ["pawn", "counting"], { lessons: ["cl-race"] }),
  S("calc-deep", "calc", 1500, ["checks-first"], { lessons: ["cl-end", "cl-replies", "cl-guard"] }),
  // —— 开局原则 ——
  S("op-center", "opening", 500, ["mate"], { lessons: ["opening", "op-firstmove"],
    lines: [{ prefix: "e4 e5 Nf3", side: "w", n: 1 }, { prefix: "d4 d5 c4", side: "w", n: 1 }] }),
  S("op-develop", "opening", 550, ["op-center"], { lessons: ["op-knights", "op-tempo"], classic: { id: "morphy-opera-1858", from: 12, plies: 8 } }),
  S("op-castle", "opening", 600, ["op-develop", "castling"], { lessons: ["op-castle", "op-pawnmoves"] }),
  S("op-first", "opening", 650, ["op-castle"], { lessons: ["op-italian", "firstgame"], lines: [{ prefix: "e4 e5 Nf3 Nc6 Bc4", side: "w", n: 3 }] }),
  S("op-e4", "opening", 900, ["op-first"], { lines: [{ prefix: "e4 e5", side: "w", n: 4 }] }),
  S("op-d4", "opening", 1000, ["op-first"], { lines: [{ prefix: "d4 d5", side: "w", n: 4 }] }),
  S("op-black", "opening", 1100, ["op-e4"], { lines: [{ prefix: "e4 c5", side: "b", n: 2 }, { prefix: "e4 e6", side: "b", n: 1 },
    { prefix: "e4 c6", side: "b", n: 1 }] }),
  // —— 基本残局 ——
  S("eg-square", "endgame", 600, ["mate"], { lessons: ["square"], drills: ["kp-square"], pool: { themes: ["pawnEnding"] } }),
  S("eg-opposition", "endgame", 700, ["eg-square"], { lessons: ["opposition"], drills: ["kp-outflank", "kp-distant"], pool: { themes: ["pawnEnding"] } }),
  S("eg-keysquares", "endgame", 800, ["eg-opposition"], { lessons: ["keysquares"], drills: ["kp-keysq", "lesson:keysquares"],
    pool: { themes: ["pawnEnding"] } }),
  S("eg-king", "endgame", 900, ["eg-keysquares"], { lessons: ["kingactive", "eg-kingact", "drill-pawn"], drills: ["lesson:drill-pawn", "kp-far", "kp-detour"] }),
  S("eg-pawns", "endgame", 1000, ["eg-king"], { lessons: ["majority", "pawntrade"], drills: ["kp-outside", "kp-breakthrough"], pool: { themes: ["pawnEnding"] } }),
  S("eg-rook-behind", "endgame", 1000, ["eg-king"], { lessons: ["rookbehind", "eg-cutoff"], drills: ["rp-tarrasch", "rp-behind"], pool: { themes: ["rookEnding"] } }),
  S("eg-wrong-bishop", "endgame", 1100, ["eg-keysquares"], { lessons: ["wrongbishop"], drills: ["dr-wrongbishop"], pool: { themes: ["bishopEnding"] } }),
  S("eg-rook7", "endgame", 1200, ["eg-rook-behind"], { lessons: ["eg-rook7"], drills: ["rp-skewer"], pool: { themes: ["rookEnding"] } }),
  S("eg-lucena", "endgame", 1300, ["eg-rook7"], { lessons: ["drill-lucena"], drills: ["lesson:drill-lucena", "rp-lucena"],
    pool: { themes: ["rookEnding"] } }),
  S("eg-philidor", "endgame", 1300, ["eg-rook7"], { lessons: ["drill-philidor"], drills: ["lesson:drill-philidor", "dr-philidor"],
    pool: { themes: ["rookEnding"] } }),
  S("eg-minor", "endgame", 1400, ["eg-wrong-bishop"], { lessons: ["eg-bvn", "eg-nvrp", "eg-rvminor"], drills: ["mi-np", "mi-bn"], pool: { themes: ["knightEnding"] } }),
  S("eg-queen", "endgame", 1500, ["eg-king"], { lessons: ["eg-qvp", "eg-queen"], drills: ["qu-epawn", "qu-qvr"], pool: { themes: ["queenEnding"] } }),
  // —— 中局计划 ——
  S("mg-plan", "middlegame", 1200, ["op-castle", "candidates"], { lessons: ["mg-plan", "mg-trade"] }),
  S("mg-open-file", "middlegame", 1200, ["mg-plan"], { lessons: ["mg-openfile", "po-file"] }),
  S("mg-outpost", "middlegame", 1300, ["mg-plan"], { lessons: ["mg-outpost", "po-outpost", "po-hole"] }),
  S("mg-pawns", "middlegame", 1300, ["mg-plan"], { lessons: ["mg-pawns", "ps-doubled", "ps-iqp", "ps-hanging"] }),
  S("mg-passer", "middlegame", 1250, ["mg-plan", "eg-king"], { lessons: ["mg-passer", "po-major", "po-behind"] }),
  S("mg-attack", "middlegame", 1400, ["mg-plan", "sacrifice"], { lessons: ["mg-attack"], pool: { themes: ["sacrifice"], minRating: 1400 } }),
  S("mg-trade", "middlegame", 1400, ["mg-plan"], { lessons: ["po-kpend", "po-trade"] }),
  S("mg-structure", "middlegame", 1500, ["mg-pawns"], { lessons: ["ps-chain", "po-chain", "ps-break", "ps-minority"] }),
  S("mg-bishops", "middlegame", 1500, ["mg-plan"], { lessons: ["ps-bishops", "po-badb", "po-color"] }),
  S("mg-prophylaxis", "middlegame", 1700, ["mg-structure"], { lessons: ["po-prophy", "ps-space"] }),
];

export const SKILL = Object.fromEntries(SKILLS.map((s) => [s.id, s]));
export const ORDER = Object.fromEntries(SKILLS.map((s, i) => [s.id, i]));

/** Every skill `id` stands on, transitively (not itself). */
export function ancestors(id, out = new Set()) {
  for (const p of SKILL[id].needs) if (!out.has(p)) { out.add(p); ancestors(p, out); }
  return out;
}

/** Skills whose evidence a review motif key is (review.finding → negative evidence). */
export const BY_MOTIF = SKILLS.reduce((m, s) => {
  for (const k of s.motifs) (m[k] ||= []).push(s.id);
  return m;
}, {});

/**
 * Stage goals (v20-0-plan §2 L5): each names the skills it needs (those
 * below it) and what reaching it unlocks.
 */
export const STAGES = [800, 1000, 1200, 1500].map((rating) => ({
  rating, skills: SKILLS.filter((s) => s.level < rating).map((s) => s.id),
}));
