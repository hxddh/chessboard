/**
 * 「我的」页的跨局指标（src/web/js/progress-metrics.js，v8-0-plan B5）。
 *
 * 纯函数：喂一组固定的对局（scripts/fixtures/progress-games.mjs），
 * 每个数都能对着那份文件数出来。验收要求的两件事都在这里：每项指标有
 * 最少局数、不到就没有数；用一组固定的对局写单元测试。
 * 跑：node scripts/test-progress-metrics.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { ADVANTAGE_GAMES, CLOCK_GAMES, BLACK_FIRST } from "./fixtures/progress-games.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Date, Math, JSON };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["progress-metrics.js", "pgn-parser.js", "library.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), ctx, { filename: f });
}
const M = ctx.ChessProgressMetrics;
const P = ctx.ChessPgnParser;
const L = ctx.ChessLibrary;

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};
/** a library entry as the metrics read it */
const flat = (g) => ({ side: g.side, outcome: g.outcome, fen: g.fen, clk: g.clk,
  scalars: g.an && g.an.scalars, tags: g.an && g.an.tags });
const facts = (list) => list.map((g) => M.factsOf(flat(g)));
const pc = (x) => (x == null ? "null" : (Math.round(x * 1000) / 10) + "%");

// --- %clk：两家网站的写法都读得出来 -----------------------------------------
{
  assert(M.clkOf("[%clk 0:03:00]") === 180, "Lichess 的整秒");
  assert(M.clkOf("[%clk 0:00:05.3]") === 5.3, "chess.com 的十分之一秒");
  assert(M.clkOf("good move [%clk 1:02:03] [%eval 0.3]") === 3723, "混在别的注释和命令中间");
  assert(M.clkOf("[%clk 2:59]") === 179, "只有分:秒");
  assert(M.clkOf("[%eval 0.3]") === null && M.clkOf(null) === null, "没有钟就是 null");
  const g = P.parsePgn('[Event "x"]\n\n1. e4 { [%clk 0:03:00] } e5 { [%clk 0:02:58.4] } 2. Nf3 Nc6 { [%clk 0:02:50] } *').games[0];
  const c = M.clocksOf(g.root);
  assert(JSON.stringify(c) === JSON.stringify([180, 178, null, 170]), "主线每一手一个读数，没有的是 null", JSON.stringify(c));
  assert(M.clocksOf(P.parsePgn("1. e4 e5 *").games[0].root) === null, "整局没有钟：null，不存一串空");
}

// --- 棋谱库导入时把钟留下（重复导入给旧条目补上）---------------------------
{
  const text = '[White "me"]\n[Black "them"]\n[Result "1-0"]\n\n1. e4 { [%clk 0:05:00] } e5 { [%clk 0:05:00] } 2. Qh5 { [%clk 0:04:51] } 1-0';
  const game = P.parsePgn(text).games[0];
  const sans = ["e4", "e5", "Qh5"];
  const e = L.entryFrom(game, sans, ["me"], 1);
  assert(JSON.stringify(e.clk) === JSON.stringify([300, 300, 291]), "entryFrom 带上每手的钟", JSON.stringify(e.clk));
  const bare = L.entryFrom(P.parsePgn('[White "me"]\n[Black "them"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 1-0').games[0], sans, ["me"], 1);
  assert(!("clk" in bare), "没有钟的棋谱，条目里就没有这个字段");
  // the same game imported before clocks were kept: a re-import fills them
  // in, and nothing else of the stored entry — its analysis above all — moves
  const old = Object.assign({}, e, { an: { acc: { w: 90 } } });
  delete old.clk;
  const r = L.addGames([old], [e]);
  assert(r.added === 0 && r.dup === 1 && JSON.stringify(r.list[0].clk) === JSON.stringify(e.clk) &&
    r.list[0].an.acc.w === 90, "再导一次：补上钟，分析原样保留");
}

// --- 化优为胜 / 逆境求生 ----------------------------------------------------
{
  const m = M.crossGame(facts(ADVANTAGE_GAMES));
  assert(m.convert.n === 9 && m.convert.won === 6 && Math.abs(m.convert.rate - 6 / 9) < 1e-9,
    "化优为胜：领先 2 兵以上的 9 局赢了 6 局", JSON.stringify(m.convert));
  assert(m.resil.n === 5 && m.resil.won === 1 && m.resil.drawn === 1 && m.resil.rate === 0.4,
    "逆境求生：落后 2 兵以上的 5 局保住 2 局（1 胜 1 和）", JSON.stringify(m.resil));
  assert(m.convert.need === 5 && m.resil.need === 5, "每项写明最少局数");
  // below the floor there is a count and no rate — the page says how many more
  const few = M.crossGame(facts(ADVANTAGE_GAMES.filter((g) => ["a1", "a2", "a3", "a4", "a7"].includes(g.id))));
  assert(few.convert.n === 4 && few.convert.rate === null, "不到 5 局：没有化优为胜的数（" + few.convert.n + " 局）");
  assert(few.resil.n === 2 && few.resil.rate === null, "不到 5 局：没有逆境求生的数（" + few.resil.n + " 局）");
  // black's chair: white's −300 is our +3
  const b = M.factsOf(flat(ADVANTAGE_GAMES.find((g) => g.id === "a11")));
  assert(b.hi === 10000 && b.lo === 0, "执黑时评估翻过来读", JSON.stringify(b));
  // an engine game files only its extremes (review/analysis.js recordAccuracy)
  const e = M.factsOf({ side: "b", outcome: "loss", hi: 250, lo: -600 });
  assert(e.hi === 250 && e.lo === -600, "人机对局存的 hi / lo 直接用");
  assert(M.factsOf({ side: "w", outcome: null, scalars: [0, 500] }) === null &&
    M.factsOf({ side: null, outcome: "win", scalars: [0, 500] }) === null, "没认领、没结果的棋不算");
}

// --- 时间紧时的失误率 ------------------------------------------------------
{
  const m = M.crossGame(facts(CLOCK_GAMES));
  assert(m.clock.n === 10 && m.clock.need === 10, "10 局带钟、分析过的对局");
  assert(m.clock.press.n === 30 && m.clock.press.b === 10, "时间紧：30 步，10 个 ??", JSON.stringify(m.clock.press));
  assert(m.clock.calm.n === 170 && m.clock.calm.b === 5, "平时：170 步，5 个 ??（对方的 ?? 不算）", JSON.stringify(m.clock.calm));
  assert(Math.abs(m.clock.rate - 1 / 3) < 1e-9 && Math.abs(m.clock.calmRate - 5 / 170) < 1e-9,
    "失误率 " + pc(m.clock.rate) + "，平时 " + pc(m.clock.calmRate));
  const nine = M.crossGame(facts(CLOCK_GAMES.slice(0, 9)));
  assert(nine.clock.n === 9 && nine.clock.rate === null && nine.clock.calmRate === null, "9 局：还没有数");
  // no clock, no count: the advantage games do not dilute it
  const mixed = M.crossGame(facts(CLOCK_GAMES.concat(ADVANTAGE_GAMES)));
  assert(mixed.clock.n === 10, "没有钟的对局不进这一项");
  const unanalysed = CLOCK_GAMES.map((g) => Object.assign(flat(g), { tags: null }));
  assert(M.crossGame(unanalysed.map(M.factsOf)).clock.n === 0, "没分析过（没有 tags）的也不算");
  const bf = M.factsOf(flat(BLACK_FIRST));
  assert(bf.clocked && bf.press.n === 1 && bf.press.b === 1 && bf.calm.n === 2 && bf.calm.b === 1,
    "黑方先走的局面：第 0 手是我们的，按自己的钟读", JSON.stringify(bf));
}

// --- 对局评级曲线：有就画，没有就不存在 -------------------------------------
{
  const games = [{ t: 3, ra: 1510 }, { t: 1, ra: 1480 }, { t: 2 }, { t: 4, ra: 1530 }];
  const s = M.gameRatingSeries(games);
  assert(JSON.stringify(s.map((p) => p.r)) === "[1480,1510,1530]", "按时间排，只取带评级的局", JSON.stringify(s));
  assert(M.gameRatingSeries([{ t: 1, diff: "normal", result: "win" }]).length === 0, "B4 还没合进来：没有序列");
  assert(M.ratingAfter({ ra: 1400 }) === 1400 && M.ratingAfter({}) === null, "读评级只有一个入口（ratingAfter）");
  assert(M.gameRatingSeries(Array.from({ length: 80 }, (_, i) => ({ t: i, ra: 1000 + i })), 60).length === 60, "最多 60 个点");
}

// --- 日历热图与连续天数 ----------------------------------------------------
{
  const at = (s) => new Date(s + "T12:00:00").getTime();
  const now = at("2026-09-24"); // a Thursday
  const counts = M.dayCounts([at("2026-09-24"), at("2026-09-24"), at("2026-09-23"), at("2026-09-22"),
    at("2026-09-10"), at("2026-09-09"), at("2026-09-08"), at("2026-09-07"), at("2025-01-01")]);
  const h = M.heatGrid(counts, now, 18);
  assert(h.cells.length === 17 * 7 + 4, "18 列，本周只到今天（周四）", String(h.cells.length));
  assert(h.cells[0].key === "2026-05-25" && h.cells[0].row === 0, "第一格是 17 周前的周一", h.cells[0].key);
  assert(h.cells[h.cells.length - 1].key === "2026-09-24" && h.cells[h.cells.length - 1].n === 2, "最后一格是今天，2 件事");
  assert(h.active === 7, "图里有 7 天（一年前那天在图外）", String(h.active));
  assert(h.cur === 3 && h.best === 4, "连续 3 天，最长 4 天", h.cur + "/" + h.best);
  const y = M.heatGrid(M.dayCounts([at("2026-09-23"), at("2026-09-22")]), now, 18);
  assert(y.cur === 2, "今天还没练：从昨天往回数，连续不断");
  assert(M.heatGrid({}, now, 18).active === 0, "什么都没有：0 天（页面据此不画）");
}

// --- 强项与弱项 -------------------------------------------------------------
{
  const th = (r, solve, miss) => ({ solve, miss, rating: { r, rd: 80, vol: 0.06 } });
  const themes = { fork: th(1700, 6, 1), pin: th(1400, 2, 4), skewer: th(1550, 3, 3), m1: th(1900, 9, 0),
    backRank: th(2000, 2, 1) }; // 3 answers — not ranked
  const diag = { enough: true, motifs: [{ motif: "fork", n: 7 }, { motif: "pin", n: 3 }],
    ecos: [{ eco: "C50", name: "Italian", n: 5, score: 0.8 }, { eco: "B01", name: "Scandinavian", n: 4, score: 0.25 },
      { eco: "A00", name: "", n: 2, score: 0 }] };
  const s = M.strengths(themes, diag);
  const ids = (xs) => xs.map((x) => x.kind + ":" + x.id).join(",");
  assert(ids(s.strong) === "theme:m1,theme:fork,eco:C50", "强项：评级最高的两个主题，得分最高的开局", ids(s.strong));
  assert(ids(s.weak) === "theme:pin,theme:skewer,motif:fork,motif:pin,eco:B01", "弱项：评级最低的主题，对局里栽得最多的母题，得分最低的开局", ids(s.weak));
  assert(!s.strong.concat(s.weak).some((x) => x.id === "backRank"), "答不到 5 题的主题不排");
  assert(!s.weak.some((x) => x.id === "A00"), "不到 3 局的开局不排");
  const none = M.strengths({ fork: th(1700, 6, 1) }, { enough: false });
  assert(!none.strong.length && !none.weak.length, "一个主题比不出强弱，诊断样本不够也不说");
}

if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
