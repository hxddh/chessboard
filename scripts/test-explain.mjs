/**
 * explain.js — why a ? or ?? was a mistake, from facts only (v7-8-plan §3).
 *
 * The engine lines are written out here, so no engine runs: what is tested
 * is the reading of a line, not the line. The real-engine version of the
 * fixed game lives in test-engine-flows-e2e (scenario 「为什么」).
 *
 * Run: node scripts/test-explain.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "explain.js", "i18n.js"]) {
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

// --- a plain mistake: a knight for a pawn, no motif ------------------------
// 1.e4 e5 2.Bc4 Nf6 3.d3, and 3…Nxe4? 4.dxe4: the knight is simply gone.
{
  const fen = fenAfter("e4 e5 Bc4 Nf6 d3");
  const ex = X.explainMistake({ fen, played: "Nxe4", best: "b8c6", line: "dxe4 Bc5 Nf3 d6" }, Chess);
  assert(ex && ex.refute && ex.refute.motif === null && ex.lost && ex.lost.piece === "n",
    "3…Nxe4：应着 dxe4 没有母题，丢马 (" + JSON.stringify(ex) + ")");
  for (const lang of LANGS) {
    const s = X.explainText(ex, tOf(lang));
    console.log("     " + lang + "：" + s);
    assert(!MOTIF_NAMES(lang).some((n) => s.includes(n)), "没有母题的失着（" + lang + "）：说明里不出现任何母题名");
  }
  assert(X.explainText(ex, tOf("zh-CN")) === "对方 dxe4 之后丢马", "…中文是「对方 dxe4 之后丢马」");
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
  assert(ex2 && ex2.refute && ex2.refute.mate === 1 && X.explainKey(ex2) === "ex.allowsMate1",
    "送了一步杀：说对方 ♕xf7# 一步杀 (" + X.explainText(ex2, tOf("zh-CN")) + ")");
  // mate in two along the engine's own line: a checkmate on the board, not a score
  // mate in two along the engine's own line: a checkmate on the board, not a score
  const fen3 = "6k1/5ppp/8/8/8/8/5PPP/1R1R2K1 w - - 0 1";
  const ex4 = X.explainMistake({ fen: fen3, played: "h3", best: "d1d8", bestLine: "Rd8#" }, Chess);
  assert(ex4 && ex4.better && ex4.better.mate === 1, "底线杀：Rd8# 是一步杀");
  const fen5 = "3rr1k1/5ppp/8/8/8/8/3R1PPP/3R2K1 w - - 0 1";
  const ex5 = X.explainMistake({ fen: fen5, played: "h3", best: "d2d8", bestLine: "Rxd8 Rxd8 Rxd8#" }, Chess);
  assert(ex5 && ex5.better && ex5.better.mate === 2 && X.explainText(ex5, tOf("zh-CN")) === "有 ♖xd8 起的 2 步杀没走",
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

// --- every key the sentences use is written in all three languages ---------
{
  const keys = ["ex.mate1", "ex.mateN", "ex.allowsMate", "ex.allowsMate1", "ex.motifLoss", "ex.motif", "ex.forkHits", "ex.loss", "ex.betterMotif", "ex.better"];
  for (const lang of LANGS) {
    const missing = keys.filter((k) => !ChessI18n.DICT[lang][k]);
    assert(missing.length === 0, lang + "：十个句型都在" + (missing.length ? " —— 缺 " + missing.join(", ") : ""));
  }
}

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("explain: all passed");
