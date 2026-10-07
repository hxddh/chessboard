/**
 * explain.js — why a ? or ?? was a mistake, from facts only (v7-8-plan §3).
 *
 * The engine lines are written out here, so no engine runs: what is tested
 * is the reading of a line, not the line. The real-engine version of the
 * fixed game lives in test-engine-flows-e2e (scenario 「为什么」).
 *
 * Run: node scripts/test-explain.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
// lang-en/ja first: the dictionaries are chunks the page loads ahead of the
// bundle (v8-0-plan F5), and i18n.js adopts whatever is already there
for (const f of ["chess.js", "motif.js", "explain.js", "lang-en.js", "lang-ja.js", "i18n.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), ctx, { filename: f });
}
const { Chess, ChessExplain: X, ChessI18n } = ctx;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}
const LANGS = ["zh-CN", "en", "ja"];
const tOf = (lang) => (k) => ChessI18n.DICT[lang][k];
const fenAfter = (moves) => {
  const g = new Chess();
  for (const m of moves.split(" ")) if (!g.move(m)) throw new Error("illegal " + m);
  return g.fen();
};
const MOTIF_NAMES = (lang) => ["fork", "pin", "skewer", "discovered", "double"].map((m) => ChessI18n.DICT[lang]["motif." + m]);

// --- the fixed game: 9. a3 walks into …Nxc2+ -------------------------------
// 1.e4 e5 2.Nf3 Nc6 3.Bc4 Nf6 4.Ng5 d5 5.exd5 Nxd5 6.Nxf7 Kxf7 7.Qf3+ Ke6
// 8.Nc3 Nb4 9.a3 Nxc2+ 10.Kd1 Nxa1 11.Nxd5 Kd6 — the walk-through game x02.
const FIXED = fenAfter("e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Nb4");
{
  const ex = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line: "Nxc2+ Kd1 Nxa1 Nxd5 Kd6" }, Chess);
  assert(ex && ex.refute && ex.refute.san === "Nxc2+" && ex.refute.motif === "fork",
    "9.a3：对方的应着是 Nxc2+，motif.js 认出捉双 (" + JSON.stringify(ex && ex.refute) + ")");
  assert(ex && ex.lost && ex.lost.piece === "r" && ex.lost.net === 3,
    "9.a3：四个半着之内丢了车，吃回一个马，净丢 3 (" + JSON.stringify(ex && ex.lost) + ")");
  assert(ex && ex.better && ex.better.san === "Qe4", "9.a3：更好的是引擎的 Qe4（UCI f3e4 转成 SAN）");
  assert(X.explainKey(ex) === "ex.motifLoss", "9.a3：句子取「漏看母题 + 丢子」这一条");
  const want = { "zh-CN": ["捉双", "车"], en: ["Fork", "rook"], ja: ["フォーク", "ルーク"] };
  for (const lang of LANGS) {
    const s = X.explainText(ex, tOf(lang));
    console.log("     " + lang + "：" + s);
    assert(want[lang].every((w) => s.includes(w)) && s.includes("♞xc2+"),
      "9.a3（" + lang + "）：说明里有 ♞xc2+、" + want[lang].join("、"));
  }
  assert(X.explainText(ex, tOf("zh-CN")) === "漏看了 ♞xc2+ 捉双，丢车", "9.a3（zh-CN）：一字不差是计划里那一句");
  const parts = X.explainParts(ex, tOf("zh-CN"));
  assert(parts.some((p) => p && p.san === "Nxc2+" && p.color === "b"),
    "句子的着法是单独的一段 {san, color}，界面按棋谱的样子画它");
  // 再试一次 without the engine: the mistake again is wrong, the best is right
  assert(X.retryQuick("a3", ex) === "wrong", "再试一次：再走 a3 判错");
  assert(X.retryQuick("Qe4", ex) === "right", "再试一次：走引擎最佳 Qe4 判对");
  assert(X.retryQuick("O-O", ex) === null, "再试一次：别的着法交给引擎（judgeAlt）判");
  // a line too short to hold a recapture is not counted
  const one = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line: "Nxc2+" }, Chess);
  assert(one && one.refute && one.refute.motif === "fork" && one.lost === null,
    "只有一个半着的引擎线：母题照报，子力不数（没有回吃的机会，数了就是编）");
  assert(X.explainKey(one) === "ex.forkHits" && one.refute.hits.join() === "k,r",
    "…句子说捉双捉的是什么：王和车 —— 这是 c2 上那个马的攻击范围，不是推测 (" + X.explainText(one, tOf("zh-CN")) + ")");
  // the engine's actual answer at 200 ms: 10…Nd4, not 10…Nxa1 — the line
  // after the fork wins nothing, and the sentence still names the rook
  const nd4 = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line: "Nxc2+ Kd1 Nd4 Bxd5+" }, Chess);
  assert(nd4 && nd4.lost === null && X.explainText(nd4, tOf("zh-CN")) === "漏看了 ♞xc2+ 捉双，同时攻击王和车",
    "引擎线里黑方没吃车（10…Nd4）：不说丢车，说捉双攻击王和车 (" + X.explainText(nd4, tOf("zh-CN")) + ")");
  for (const lang of LANGS) {
    const s = X.explainText(nd4, tOf(lang));
    console.log("     " + lang + "：" + s);
    assert({ "zh-CN": /捉双.*车/, en: /Fork.*rook/, ja: /フォーク.*ルーク/ }[lang].test(s), "10…Nd4 那条线（" + lang + "）：母题和车都在");
  }
}

// --- the line after the mistake, as the pass stored it ---------------------
// The real 200 ms pass kept only 「Nxc2+ Kd1」 after 9. a3 — one ply short of
// the rook. The game went down that line, and the pass searched the positions
// it reached, so their lines continue it.
{
  const sans = "e4 e5 Nf3 Nc6 Bc4 Nf6 Ng5 d5 exd5 Nxd5 Nxf7 Kxf7 Qf3+ Ke6 Nc3 Nb4 a3 Nxc2+ Kd1 Nxa1 Nxd5 Kd6".split(" ");
  const pvs = new Array(sans.length + 1).fill(null);
  pvs[17] = "Nxc2+ Kd1";
  pvs[18] = "Kd1 Nxa1";
  pvs[19] = "Nxa1 Nxd5 Kd6";
  const line = X.lineAfter(pvs, sans, 16);
  assert(line.join(" ") === "Nxc2+ Kd1 Nxa1 Nxd5 Kd6",
    "lineAfter：棋局沿着引擎线走，就用走到的局面上引擎自己的线接下去 (" + line.join(" ") + ")");
  const short = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line: pvs[17] }, Chess);
  assert(short && short.lost === null && X.explainText(short, tOf("zh-CN")) === "漏看了 ♞xc2+ 捉双，同时攻击王和车",
    "只有两个半着：不说「丢兵」—— 那一步之后车就没了，窗口不满就不数 (" + X.explainText(short, tOf("zh-CN")) + ")");
  const spliced = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line }, Chess);
  assert(X.explainText(spliced, tOf("zh-CN")) === "漏看了 ♞xc2+ 捉双，丢车", "接上之后：「漏看了 ♞xc2+ 捉双，丢车」");
  // the game left the line: nothing after the fork is borrowed from the game
  const other = sans.slice(); other[18] = "Ke2";
  assert(X.lineAfter(pvs, other, 16).join(" ") === "Nxc2+ Kd1 Nxa1",
    "棋局离开引擎线的那一步，不再往下接 (" + X.lineAfter(pvs, other, 16).join(" ") + ")");
  assert(X.lineAfter([], sans, 16).length === 0, "没有线：空");
}

// --- a knight for a pawn ------------------------------------------------------
// 1.e4 e5 2.Bc4 Nf6 3.d3, and 3…Nxe4? 4.dxe4: the knight is simply gone.
// 7.x said 「对方 dxe4 之后丢马」; since v8-0-plan B3 the line proves more —
// nothing could take back on e4 — and that is the hanging-piece sentence.
{
  const fen = fenAfter("e4 e5 Bc4 Nf6 d3");
  const ex = X.explainMistake({ fen, played: "Nxe4", best: "b8c6", line: "dxe4 Bc5 Nf3 d6" }, Chess);
  assert(ex && ex.refute && ex.refute.motif === "hanging" && ex.refute.free && ex.lost && ex.lost.piece === "n",
    "3…Nxe4：应着 dxe4 吃掉没有保护的马 (" + JSON.stringify(ex) + ")");
  for (const lang of LANGS) {
    const s = X.explainText(ex, tOf(lang));
    console.log("     " + lang + "：" + s);
    assert(!MOTIF_NAMES(lang).some((n) => s.includes(n)), "没有母题的失着（" + lang + "）：说明里不出现任何母题名");
  }
  assert(X.explainText(ex, tOf("zh-CN")) === "漏看了 dxe4，马没有保护住", "…中文是「漏看了 dxe4，马没有保护住」");
}

// --- nothing certain: only the better move ---------------------------------
{
  const fen = fenAfter("e4 e5 Nf3 Nc6");
  const ex = X.explainMistake({ fen, played: "a3", best: "f1b5", line: "Nf6 Nc3 Bc5 d3" }, Chess);
  assert(X.explainKey(ex) === "ex.better" && X.explainText(ex, tOf("zh-CN")) === "更好的是 ♗b5",
    "认不出母题、也没有子力变化：只说「更好的是 ♗b5」(" + X.explainText(ex, tOf("zh-CN")) + ")");
  for (const lang of LANGS) {
    const s = X.explainText(ex, tOf(lang));
    assert(!MOTIF_NAMES(lang).some((n) => s.includes(n)) && s.includes("♗b5"), "只有更好的一手（" + lang + "）：" + s);
  }
}

// --- a missed mate, and a mate allowed -------------------------------------
{
  const fen = fenAfter("e4 e5 Bc4 Nc6 Qh5 Nf6");
  const ex = X.explainMistake({ fen, played: "d3", best: "h5f7", line: "Nxh5" }, Chess);
  assert(ex && ex.better && ex.better.mate === 1 && X.explainText(ex, tOf("zh-CN")) === "有 ♕xf7# 一步杀没走",
    "漏了一步杀：「有 ♕xf7# 一步杀没走」(" + X.explainText(ex, tOf("zh-CN")) + ")");
  const fen2 = fenAfter("e4 e5 Bc4 Nc6 Qh5");
  const ex2 = X.explainMistake({ fen: fen2, played: "Nf6", best: "g7g6", line: "Qxf7#" }, Chess);
  // Qxf7# was already on the board before 3…Nf6: the move ignored a threat
  // (v8-0-plan B3 §4), which says more than 「让对方一步杀」
  assert(ex2 && ex2.refute && ex2.refute.mate === 1 && X.explainKey(ex2) === "ex.threatMate" &&
    X.explainText(ex2, tOf("zh-CN")) === "没防住对方 ♕xf7# 一步杀的威胁",
    "送了一步杀、而那一步杀之前就摆着：没防住威胁 (" + X.explainText(ex2, tOf("zh-CN")) + ")");
  const ex3 = X.explainMistake({ fen: fenAfter("e4 e5 Bc4 Nc6 d3"), played: "Qh4", best: "g8f6", line: "Qh5 Nf6 Qxf7#" }, Chess);
  assert(!ex3.threat, "…走之前没有的杀，不说「没防住威胁」");
  // mate in two along the engine's own line: a checkmate on the board, not a score
  // mate in two along the engine's own line: a checkmate on the board, not a score
  const fen3 = "6k1/5ppp/8/8/8/8/5PPP/1R1R2K1 w - - 0 1";
  const ex4 = X.explainMistake({ fen: fen3, played: "h3", best: "d1d8", bestLine: "Rd8#" }, Chess);
  assert(ex4 && ex4.better && ex4.better.mate === 1, "底线杀：Rd8# 是一步杀");
  const fen5 = "3rr1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1";
  const ex5 = X.explainMistake({ fen: fen5, played: "h3", best: "d2d8", bestLine: "Rxd8 Rxd8 Rxd8#" }, Chess);
  assert(ex5 && ex5.better && ex5.better.mate === 2 && X.explainText(ex5, tOf("zh-CN")) === "有 ♖xd8 起的 2 步杀没走（底线杀）",
    "两步杀，数的是引擎线上真的将死的那一步 (" + X.explainText(ex5, tOf("zh-CN")) + ")");
  const ex7 = X.explainMistake({ fen: fen5, played: "h3", best: "d2d8", bestLine: "Rxd8 h6" }, Chess);
  assert(ex7 && ex7.better && ex7.better.mate === null && !/步杀/.test(X.explainText(ex7, tOf("zh-CN"))),
    "引擎线没走到将死：不说杀，哪怕杀其实在那里 —— 只报棋盘上看得见的");
}

// --- inputs that say nothing ------------------------------------------------
{
  assert(X.explainMistake({ fen: FIXED, played: "Qxa8" }, Chess) === null, "走不出来的着法：没有说明");
  const same = X.explainMistake({ fen: FIXED, played: "Qe4", best: "f3e4" }, Chess);
  assert(same && same.better === null && X.explainParts(same, tOf("zh-CN")).length === 0,
    "走的就是引擎最佳：没有「更好的」，也没有句子");
  const garbage = X.explainMistake({ fen: FIXED, played: "a3", best: "f3e4", line: "Qxh1 Kd1" }, Chess);
  assert(garbage && garbage.refute === null && garbage.lost === null && X.explainKey(garbage) !== "ex.motifLoss",
    "和局面对不上的引擎线：一个字都不从它里面读");
}

// --- v8-0-plan B3: every motif proved by its line — one position that is,
// one that only looks like it ------------------------------------------------
// Positive and negative FENs per detector. A negative is the same geometry
// (or the same material) without the line cashing it in, which is exactly
// where 7.x said too much.
{
  const LM = (fen, line, opts) => { const r = ctx.lineMotif(fen, line.split(" "), Chess, opts || {}); return r ? r.motif : null; };
  const cases = [
    // [name, fen, line, want, opts]
    ["挂着的子：白吃没有保护的马", "4k3/8/8/3n4/8/8/8/3QK3 w - - 0 1", "Qxd5 Ke7 Qe4+ Kd6", "hanging"],
    ["…有兵保护、吃了被吃回：不是", "4k3/8/4p3/3n4/8/8/8/3QK3 w - - 0 1", "Qxd5 exd5 Kd2 Kd7", null],
    ["以小吃大也算（兵吃有保护的马）", "4k3/8/4p3/3n4/4P3/8/8/4K3 w - - 0 1", "exd5 exd5 Kd2 Kd7", "hanging"],
    ["捉双：马同时打王和车，线上吃了车", "r3k3/8/8/1N6/8/8/8/4K3 w - - 0 1", "Nc7+ Kd7 Nxa8 Kc6", "fork"],
    ["…马能被后吃掉：不是捉双", "r3k3/2q5/8/1N6/8/8/8/4K3 w - - 0 1", "Nc7+ Qxc7 Kd2 Qd6+", null],
    ["牵制：钉在王前的马被兵吃掉", "4k3/8/2n5/1B6/3P4/8/8/4K3 w - - 0 1", "d5 Kd8 dxc6 Kc7", "pin"],
    ["串击：王让开，后面的后被吃", "8/1q6/8/3k4/8/8/4B3/6K1 w - - 0 1", "Bf3+ Kd6 Bxb7 Kc5", "skewer"],
    ["…同一形状、线上没吃到：不说", "8/1q6/8/3k4/8/8/4B3/6K1 w - - 0 1", "Bf3+ Kd6 Kf2 Qb2+", null],
    ["闪将：马让开，车将军，再吃后", "4k3/1q6/8/8/4N3/8/8/4R1K1 w - - 0 1", "Nc5+ Kf8 Nxb7 Kg8", "discovered"],
    ["双将", "4k3/1q6/8/8/4N3/8/8/4R1K1 w - - 0 1", "Nd6+ Kd8 Nxb7+ Kc7", "double"],
    ["…闪将什么也没赢：不说", "4k3/8/8/8/4N3/8/8/4R1K1 w - - 0 1", "Nc3+ Kd7 Kg2 Kd6", null],
    ["闪击：马让开，象吃车", "r5k1/8/8/8/4N3/8/8/6KB w - - 0 1", "Ng5 Kf8 Bxa8 Ke7", "discoveredAttack"],
    ["杀棋威胁：Qh5 威胁 Qxh7#，顺手吃马", "5rk1/5ppp/8/n7/8/3B4/5PPP/3Q2K1 w - - 0 1", "Qh5 h6 Qxa5 Kh8", "mateThreat"],
    ["困子：马四个去处都丢", "4k3/7p/4p1p1/3b4/7N/8/8/K7 b - - 0 1", "g5 Kb2 gxh4 Kc3", "trapped"],
    ["…f3 有兵保护：不是困子", "4k3/7p/4p1p1/3b4/7N/8/4P3/K7 b - - 0 1", "g5 Kb2 gxh4 Kc3", null],
    ["消除保护：吃掉保护象的马，再吃象", "6k1/1p6/2n5/1B2b3/8/8/8/4R1K1 w - - 0 1", "Bxc6 bxc6 Rxe5 Kf8", "removeDefender"],
    ["…象还有兵保护：不是", "6k1/1p6/2np4/1B2b3/8/8/8/4R1K1 w - - 0 1", "Bxc6 bxc6 Rxe5 dxe5", null],
    ["过载：后既保护 d5 又保护 b4", "6k1/8/3q4/3b4/1b6/5B2/8/K3Q3 w - - 0 1", "Bxd5+ Qxd5 Qxb4 Kh7", "overload"],
    ["引离：弃象把后从 b4 的保护上引开", "6k1/8/3q4/8/1r6/5B2/8/K3Q3 w - - 0 1", "Bd5+ Qxd5 Qxb4 Kh7", "deflection"],
    ["引入：弃车把王引到 h8，再马叉王后", "3q2k1/8/8/4N3/8/8/8/K6R w - - 0 1", "Rh8+ Kxh8 Nf7+ Kg7 Nxd8 Kf6", "decoy"],
    ["X 光：叠车，第二个车从后面吃回", "3r2k1/3r1ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1", "Rxd7 Rxd7 Rxd7 Kf8", "xray"],
    ["升变", "8/P6k/8/8/8/8/8/K7 w - - 0 1", "a8=Q Kg6 Qb7 Kf5", "promotion"],
    ["…兵没走：不说升变", "8/P6k/8/8/8/8/8/K7 w - - 0 1", "Kb2 Kg6 Kc3 Kf5", null],
    // v8-2-plan T5: a real one (Lichess 1VSCb, 47.Kg3??): the king has
    // nowhere to go from h1/h2 but back. B3's made-up one here was no
    // perpetual at all — 6k1/5pp1 with a lone queen, …Kg6 walks out
    ["长将：原本白优，引擎 0.00，后在 f3 / f2 / f1 来回将", "8/2RQ1pk1/5qp1/3P4/6pP/4P1K1/5P2/8 b - - 1 47", "Qf3+ Kh2 Qxf2+ Kh1 Qf1+", "perpetual",
      { evalBefore: 776, evalAfter: 0 }],
    ["…评估不是和棋：不是长将", "8/2RQ1pk1/5qp1/3P4/6pP/4P1K1/5P2/8 b - - 1 47", "Qf3+ Kh2 Qxf2+ Kh1 Qf1+", null,
      { evalBefore: 776, evalAfter: 300 }],
    ["…线上步步将军，王却走得出去：不是长将", "6k1/5pp1/8/8/8/8/8/3Q3K w - - 0 1", "Qd8+ Kh7 Qh4+ Kg8 Qd8+ Kh7", null,
      { evalBefore: -500, evalAfter: 0 }],
  ];
  for (const [name, fen, line, want, opts] of cases) {
    const got = LM(fen, line, opts);
    assert(got === want, "lineMotif " + name + "（" + got + "）");
  }
  // v8-2-plan T5: the six cases 8.1's sample judged wrong (docs/motif-audit-8.1.md),
  // with the app's own lines and evaluations: kings that walk out of the
  // checks (or a draw that is no draw), and queens pinned to their king
  for (const [want, id, fen, played, line, evalBefore, evalAfter] of [
    ["perpetual", "HQaJg", "3r4/1p3k1R/2p2q2/p2p2r1/P1n5/2P1PQ2/1P2KP2/2R5 b - - 15 33", "Rg7", "Rxg7+ Kxg7 Rg1+ Kf7 Qh5+", -257, -5],
    ["perpetual", "bKEBE", "5rk1/2RR2pp/ppp5/8/1P6/P3r2P/5pPK/8 b - - 2 35", "Rf6", "Rxg7+ Kh8 Rxh7+ Kg8 Rcg7+", -487, 0],
    ["perpetual", "n12Rw", "1k6/1r4pp/1p4r1/4p3/4P3/3R1P1P/q5PK/5Q2 b - - 3 35", "Qa6", "Rd8+ Ka7 Ra8+ Kxa8 Qxa6+", -582, 0],
    ["trapped", "V9epA", "5rk1/pp4pp/2ppq1b1/1N2P1n1/2P5/P3R1P1/1P3rBP/2R1Q2K b - - 2 30", "cxb5", "Bd5 Qxd5+ cxd5 Rxb2 exd6", -587, 131],
    ["trapped", "YoHIz", "2r2rk1/1p1qb1pp/p4n2/3p4/P2n1N2/2P3PP/1P4B1/R2Q1RK1 w - - 0 20", "Qxd4", "Bc5 Qxc5 Rxc5 Rae1 Rcc8", 8, -447],
    ["trapped", "k8aIk", "2kr2nr/pppq2pp/2np4/4pP2/3b3P/1PN2P2/PBPPQP2/2KR1B1R b - - 0 11", "Qxf5", "Bh3 Qxh3 Rxh3 Nge7 f4", -15, 623],
  ]) {
    const g = new Chess(fen);
    const mv = g.move(played);
    const r = ctx.lineMotif(g.fen(), line.split(" "), Chess, { played: mv, credit: mv.captured ? { p: 1, n: 3, b: 3, r: 5, q: 9 }[mv.captured] : 0, evalBefore, evalAfter });
    assert(!r || r.motif !== want, "T5：8.1 判错的 " + id + " 不再说成 " + want + "（" + (r && r.motif) + "）");
  }
  // M3 评审 P3: the perpetual search is bounded in what it costs, not only in
  // positions. Counted, not timed: the moves chess.js lists (each one is a
  // SAN, which generates the legal moves again) — 8.2 M3 listed some 20,000
  // on each of these no-perpetuals and held the page for about a second
  {
    let listed = 0;
    const Counting = function (fen) {
      const g = new Chess(fen);
      const moves = g.moves;
      g.moves = (o) => { const r = moves(o); listed += r.length; return r; };
      return g;
    };
    for (const [fen, line] of [
      ["rn3bnr/pp2Npp1/1k6/2p4p/6bP/P2P1P2/1PPQP3/R3KBNR w KQ - 1 12", "Qb4+ Kc7 Qa5+ Kd7 Qd8+"],
      ["r6q/pp3k2/2n5/4B3/4p3/P1P1bbP1/1P6/R3K1N1 b - - 1 23", "Bf2+ Kf1 Be2+ Kxe2 Nd4+"],
      ["rnb1kb2/1p1p1pp1/8/4p1p1/1P4n1/3K4/2QP3r/2B2BR1 b - - 1 18", "Rh3+ Kc4 Rc3+ Kxc3 Ra3+"],
    ]) {
      listed = 0;
      const t0 = Date.now();
      const r = ctx.lineMotif(fen, line.split(" "), Counting, { evalBefore: fen.split(" ")[1] === "w" ? -300 : 300, evalAfter: 0 });
      assert((!r || r.motif !== "perpetual") && listed < 8000, "长将的搜索有上限：" + line + " 不是长将，列了 " + listed + " 着（" + (Date.now() - t0) + " ms）");
    }
  }
  // v8-3-plan F2: 8.2 left the perpetual proof at a worst of 260–340 ms and
  // 8.3 accepts it (a smaller budget loses real perpetuals) — this keeps it
  // from growing. Every T6 sample line is read as if it were level after the
  // mistake (the review's way: the evaluations are made up), so each one
  // whose checks run on starts the proof. The gate is the search's own
  // budget, counted the way forever() charges it (n × n listing the
  // checker's moves, n × 40 a king in check's), not the clock: the most is
  // pz:pUkFR at 157,894 (the last listing overshoots the 100,000 it checks
  // against), bound 175,000 (+10%); doubling the budget reads ~2× here. The
  // clock is a loose check on top, the heaviest five, best of five each
  {
    const cases = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/motif-sample.json"), "utf8"));
    let spent = 0, A = "w";
    const Charged = function (fen) {
      const g = new Chess(fen);
      const moves = g.moves;
      g.moves = (o) => {
        const r = moves(o);
        if (o && o.verbose && /\bat forever\b/.test(new Error().stack)) spent += r.length * (g.turn() === A ? r.length : 40);
        return r;
      };
      return g;
    };
    const runs = [], limit = Error.stackTraceLimit;
    Error.stackTraceLimit = 3;   // forever() is the caller of moves(): two frames up
    for (const c of cases) {
      const g = new Chess(c.fen);
      const mv = g.move(c.played);
      if (!mv) continue;
      const fen = g.fen(), line = Array.isArray(c.line) ? c.line : c.line.split(" ");
      const opts = { played: mv, credit: mv.captured ? { p: 1, n: 3, b: 3, r: 5, q: 9 }[mv.captured] : 0,
        evalBefore: mv.color === "w" ? 300 : -300, evalAfter: 0 };
      spent = 0;
      A = g.turn();
      ctx.lineMotif(fen, line, Charged, opts);
      runs.push({ id: c.id, spent, fen, line, opts });
    }
    Error.stackTraceLimit = limit;
    runs.sort((a, b) => b.spent - a.spent);
    const top = runs[0];
    assert(top.spent > 50000 && top.spent <= 175000,
      "F2：长将的搜索在 " + runs.length + " 条样本上最多花 " + top.spent + "（" + top.id + "，上限 175,000）");
    let worst = 0, at = "";
    for (const r of runs.slice(0, 5)) {
      let best = Infinity;
      for (let k = 0; k < 5; k++) {
        const t0 = performance.now();
        ctx.lineMotif(r.fen, r.line, Chess, r.opts);
        best = Math.min(best, performance.now() - t0);
      }
      if (best > worst) { worst = best; at = r.id; }
    }
    assert(worst <= 350, "F2：最费的五条，各取五次里最快的一次，最慢 " + worst.toFixed(0) + " ms（" + at + "，上限 350 ms）");
  }
  // 中间着 and 绝望子 read the mistake itself, so they take its move record
  {
    const g = new Chess("r5k1/6p1/8/8/6b1/5N2/5PPP/3Q2K1 b - - 0 1");
    const played = g.move("Bxf3");
    const opts = { played, credit: 3 };
    assert(ctx.lineMotif(g.fen(), "Qd5+ Kh7 Qxa8 Kg6 gxf3 Kf6".split(" "), Chess, opts).motif === "zwischenzug",
      "中间着：黑吃马，白先将军吃车，再吃回");
    const imm = ctx.lineMotif(g.fen(), "gxf3 Kf8 Qd8+ Ke7".split(" "), Chess, opts);
    assert(!imm || imm.motif !== "zwischenzug", "…马上吃回：不是中间着");
  }
  {
    // the corpus game low-skill 5, 15…Qc6: the loose c4 bishop takes a knight before it goes
    const g = new Chess("rn3rk1/1bpq3p/1p1bp1p1/3n1p2/p1BP2PP/P1N1PN2/1PQB1P2/R3K1R1 b Q - 1 15");
    const played = g.move("Qc6");
    assert(ctx.lineMotif(g.fen(), "Bxd5 exd5 gxf5 Bc8 fxg6".split(" "), Chess, { played }).motif === "desperado",
      "绝望子：反正保不住的象先吃一个马");
    const rt = ctx.lineMotif(g.fen(), "Bd3 Nf6 Kf1 Nd5".split(" "), Chess, { played });
    assert(!rt || rt.motif !== "desperado", "…象退回去：不是绝望子");
  }
  // mates: the back rank is named, other mates are not
  assert(ctx.mateMotif("3rr1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1", ["Rxd8", "Rxd8", "Rxd8#"], Chess) === "backRank",
    "底线杀：车在底线将死，王被自己的兵堵住");
  assert(ctx.mateMotif(fenAfter("e4 e5 Bc4 Nc6 Qh5 Nf6"), ["Qxf7#"], Chess) === null, "…f7 上的杀不是底线杀");
  // every key the detectors can return has a name in all three languages
  for (const lang of LANGS) {
    const missing = ctx.LINE_MOTIF_KEYS.filter((k) => !ChessI18n.DICT[lang]["motif." + k]);
    assert(missing.length === 0, lang + "：" + ctx.LINE_MOTIF_KEYS.length + " 个母题都有名字" + (missing.length ? " —— 缺 " + missing.join(", ") : ""));
  }
}

// --- v8-0-plan B3: the sentences the 8.0 audit fixed, on the real games -----
{
  // 4.Bg5?? Qxg5 — the walk-through's "pin" was a bishop left unprotected
  const bg5 = X.explainMistake({ fen: "rnbqkbnr/pp3ppp/2p1p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4",
    played: "Bg5", best: "e2e4", line: "Qxg5 cxd5 exd5 e4 dxe4" }, Chess);
  assert(X.explainText(bg5, tOf("zh-CN")) === "漏看了 ♛xg5，象没有保护住",
    "4.Bg5?? 是挂着的子，不是牵制 (" + X.explainText(bg5, tOf("zh-CN")) + ")");
  assert(X.explainMotif(bg5) === "hanging", "…句子说出的母题是 hanging");
  // 17.Nf6+ gxf6 — the knight WAS guarded (exf6); it went for a pawn
  const nf6 = X.explainMistake({ fen: "1r2k2r/pbppnppp/1bn5/4P2q/Q3N3/B1PB1N2/P4PPP/R3R1K1 w k - 1 17",
    played: "Nf6+", best: "a1d1", line: "gxf6 exf6 Rg8 Be4 Qh3 g3 Rxg3+" }, Chess);
  assert(X.explainText(nf6, tOf("zh-CN")) === "漏看了 gxf6，兵吃马，换不回来",
    "有保护、被兵吃掉的马：不说「没有保护住」 (" + X.explainText(nf6, tOf("zh-CN")) + ")");
  // 19…Bd6 Qxd6 Qxd6 Bxd6 — a queen each, and a bishop: the loss is the bishop
  const bd6 = X.explainMistake({ fen: "2r2rk1/pb2bppp/8/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 b - - 0 19",
    played: "Bd6", best: "e7b4", line: "Qxd6 Qxd6 Bxd6 Rfd8 Rxc8" }, Chess);
  assert(bd6 && bd6.lost && bd6.lost.piece === "b" && X.explainText(bd6, tOf("zh-CN")) === "对方 ♕xd6 之后丢象",
    "换掉的后不算丢：丢的是象 (" + X.explainText(bd6, tOf("zh-CN")) + ")");
  // 18.Bd6? — the a1 rook had been hanging to …Qxa1+ before the move; ignoring a threat
  const th = X.explainMistake({ fen: "rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18",
    played: "Bd6", best: "a1e1", line: "Qxa1+ Ke2" }, Chess);
  assert(X.explainKey(th) === "ex.threatHanging" && X.explainText(th, tOf("zh-CN")) === "没理会对方 ♛xa1+ 的威胁，车没有保护住",
    "没理会的威胁：走之前 ♛xa1+ 就在那里 (" + X.explainText(th, tOf("zh-CN")) + ")");
  // …and a move that CREATED the problem is not an ignored threat
  assert(!bg5.threat, "4.Bg5 自己走进去被吃：不是「没理会威胁」");
  // Nxc5+ unmasks Re1 on the king: …bxc5 is illegal only because of the check,
  // the b6 pawn does guard c5 — the lesson is the discovered check, not a
  // bishop 「没有保护住」 (review of PR #87)
  const dc = X.explainMistake({ fen: "4k3/p3npp1/1p6/2b4p/4N3/8/5PPP/4R1K1 b - - 0 1",
    played: "Ng6", best: "Kd8", bestLine: ["Kd8"], line: ["Nxc5+", "Kf8", "Nd3", "a5"] }, Chess);
  assert(dc && dc.refute && dc.refute.motif === "discovered",
    "闪将吃掉有兵保护的象：说闪将，不说挂着的子 (" + X.explainKey(dc) + " " + (dc && dc.refute && dc.refute.motif) + ")");
  assert(ctx.lineMotif("4k3/p4pp1/1p6/2b4p/4N3/8/5PPP/4R1K1 w - - 0 1", ["Nxc5+", "Kf8", "Nd3", "a5"], Chess).motif === "discovered",
    "…lineMotif 本身：闪将，不是 hanging");
  // the same capture was already on before …a6: still not a hanging-piece threat
  const dt = X.explainMistake({ fen: "4k3/p4pp1/1p6/2b4p/4N3/8/5PPP/4R1K1 b - - 0 1",
    played: "a6", best: "Kf8", bestLine: ["Kf8"], line: ["Nxc5+", "Kf8", "Nd3", "a5"] }, Chess);
  assert(dt && !dt.threat && X.explainKey(dt) !== "ex.threatHanging" && !(dt.refute && dt.refute.motif === "hanging"),
    "闪将的威胁：不说「没理会威胁，象没有保护住」 (" + X.explainKey(dt) + ")");
  for (const lang of LANGS) {
    for (const ex of [bg5, nf6, th]) {
      const s = X.explainText(ex, tOf(lang));
      assert(s && !/\{\d\}/.test(s) && !/undefined/.test(s), "B3 句子（" + lang + "）：" + s);
    }
  }
}

// --- every key the sentences use is written in all three languages ---------
{
  // read off explain.js itself, so a sentence added there cannot miss a language
  const src = fs.readFileSync(path.join(root, "src/web/js/explain.js"), "utf8");
  const keys = [...new Set(src.match(/"ex\.[A-Za-z0-9]+"/g).map((k) => k.slice(1, -1)))];
  assert(keys.length === 22, "explain.js 用到 22 个句型 (" + keys.length + ")");
  for (const lang of LANGS) {
    const missing = keys.filter((k) => !ChessI18n.DICT[lang][k]);
    assert(missing.length === 0, lang + "：" + keys.length + " 个句型都在" + (missing.length ? " —— 缺 " + missing.join(", ") : ""));
  }
}

// --- v8-1-plan T6: the sampled cases, and the motifs that fell back ---------
// scripts/fixtures/motif-sample.json holds every case the precision sample
// judged (scripts/sample-motifs.mjs), with the app's own engine lines. Read
// again here: a motif above 5% errors (MATERIAL_ONLY) is never named, its
// sentence says only what the line wins; every other case still names the
// motif it was judged under — so a change to motif.js that moves a sampled
// case shows up here, and the rate in docs/measured.json no longer vouches
// for it until the sample is run again.
{
  const cases = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/motif-sample.json"), "utf8"));
  const measured = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).motifPrecision;
  const off = new Set(X.MATERIAL_ONLY);
  const want = Object.keys(measured.byMotif).filter((m) => measured.byMotif[m].fallback);
  assert(want.length === off.size && want.every((m) => off.has(m)),
    "T6: MATERIAL_ONLY 就是抽样错误率 > 5% 的母题（" + [...off].join("、") + "）");
  const counts = {};
  for (const m of Object.keys(measured.byMotif)) counts[m] = cases.filter((c) => c.motif === m).length;
  const thin = Object.keys(counts).filter((m) => counts[m] < 20 && !off.has(m));
  assert(thin.length === 0, "T6: 仍会说出的母题每种至少 20 条样本" + (thin.length ? " —— 不足：" + thin.join(", ") : ""));
  const moved = [], said = [];
  for (const c of cases) {
    const ex = X.explainMistake({ fen: c.fen, played: c.played, best: c.best, bestLine: c.bestLine, line: c.line,
      evalBefore: c.evalBefore, evalAfter: c.evalAfter }, Chess);
    const m = X.explainMotif(ex);
    if (off.has(c.motif)) { if (m === c.motif) said.push(c.id); }
    else if (m !== c.motif) moved.push(c.id + " " + c.motif + "→" + m);
  }
  assert(said.length === 0, "T6: 回退的母题在它们的样本上一次也不说出来" + (said.length ? " —— " + said.slice(0, 5).join(", ") : ""));
  assert(moved.length === 0, "T6: 其余 " + cases.filter((c) => !off.has(c.motif)).length + " 条样本仍说出判定时的母题" +
    (moved.length ? " —— " + moved.slice(0, 5).join(", ") : ""));
}

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("explain: all passed");
