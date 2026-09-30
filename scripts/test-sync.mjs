/**
 * 从 Lichess / Chess.com 同步的页面一侧（v8-0-plan C2）。
 *
 * 取棋在原生层（main.zig chess.fetchGames，两家应答的解析由那里的 Zig 单元
 * 测试盯着）；这里是页面拿到应答之后的事：每种应答说哪句话、用户名在发出去
 * 之前先过一遍、开关默认关、两家网站的 PGN 进得了棋谱库并认出是谁下的。
 * 跑：node scripts/test-sync.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { lichessAnswer, chesscomAnswer } from "./sync-fixtures.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Date, Math, JSON };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["sync-ui.js", "persist.js", "pgn-parser.js", "library.js", "library-query.js", "progress-metrics.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), ctx, { filename: f });
}

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};

// --- 每种应答一句话：断网、限速、查无此人各有各的 --------------------------
{
  const say = (r) => JSON.stringify(ctx.syncMessage(r));
  assert(say(null) === '{"key":"sync.noHost"}', "没有原生桥：只在桌面应用里可用", say(null));
  for (const e of ["offline", "bridge"]) {
    assert(say({ error: e }) === '{"key":"sync.offline"}', "连不上（" + e + "）", say({ error: e }));
  }
  // 8.1 M2 评审 P2-1：原生层自己的截止时间、上一次同步还在外面，各有各的话
  assert(say({ error: "timeout" }) === '{"key":"sync.timeout"}', "超时：说网站迟迟没有应答", say({ error: "timeout" }));
  assert(say({ error: "busy" }) === '{"key":"sync.busy"}', "忙：说上一次同步还没结束", say({ error: "busy" }));
  assert(say({ error: "rate_limited" }) === '{"key":"sync.rate"}', "429：请过一会儿再试");
  assert(say({ error: "not_found" }) === '{"key":"sync.notFound"}', "404：没有这个用户");
  assert(say({ error: "bad_request" }) === '{"key":"sync.badName"}', "原生层不收的名字：说名字的规矩");
  assert(say({ error: "http", status: 503 }) === '{"key":"sync.failed","arg":"HTTP 503"}', "别的状态码：带上数字", say({ error: "http", status: 503 }));
  assert(say({ error: "parse" }) === '{"key":"sync.failed","arg":"parse"}', "读不懂应答：带上原因");
  assert(say({ error: "<b>x</b>" }) === '{"key":"sync.failed","arg":"?"}', "没见过的错误码不原样念出来");
  assert(say({ pgn: "", count: 0 }) === '{"key":"sync.empty"}', "零局：说没有对局，而不是说出错");
  assert(say("x") === '{"key":"sync.failed","arg":"?"}', "不是对象的应答");
  assert(ctx.syncMessage({ pgn: "[Event \"x\"]\n\n1. e4 *", count: 1 }) === null, "有棋：没有要说的，直接进棋谱库");
}

// --- 名字先在页面里过一遍：和 main.zig syncRequest 同一条规矩 --------------
{
  const ok = ["ab", "sync_tester", "Opponent-2", "a".repeat(30)];
  const bad = ["", "a", "a b", "../x", "x?max=1", "名字", "a".repeat(31), " ab "];
  for (const n of ok) assert(ctx.syncNameOk(n), "收：" + n);
  for (const n of bad) assert(!ctx.syncNameOk(n), "不收：" + JSON.stringify(n));
}

// --- 开关默认关，存下来的也只认真的 true ------------------------------------
{
  const P = (value) => value;
  const p0 = ctx.syncPrefs(P(null));
  assert(p0.on === false && p0.site === "lichess" && p0.user === "", "没存过：关，Lichess", JSON.stringify(p0));
  assert(ctx.syncPrefs(P({ v: 1, on: "yes" })).on === false, "on 不是 true 就是关");
  const p1 = ctx.syncPrefs(P({ v: 1, on: true, site: "chesscom", user: "Hikaru" }));
  assert(p1.on && p1.site === "chesscom" && p1.user === "Hikaru", "存下的都读回来", JSON.stringify(p1));
  const p2 = ctx.syncPrefs(P({ v: 1, on: true, site: "fics", user: 7 }));
  assert(p2.site === "lichess" && p2.user === "", "认不得的值回到默认", JSON.stringify(p2));
  // 它是档案里的一个键：清除全部存档会连用户名一起清掉
  assert(ctx.KEYS && ctx.KEYS.sync === "chess.v1.sync", "persist.js 的键表里有 sync");
}

// --- v8-1-plan T4：增量、局数上限、同步后分析，都记在同一个 sync 键里 ---------
{
  // 8.0 存下的 {v, on, site, user}：新的几项读成默认，一个字也不丢
  const old = ctx.syncPrefs({ v: 1, on: true, site: "chesscom", user: "Hikaru" });
  assert(old.on && old.site === "chesscom" && old.user === "Hikaru" && old.max === 20 && old.analyse === false &&
    !("last" in old), "8.0 的存档：开关、网站、名字照旧，最多 20 局、不自动分析", JSON.stringify(old));
  assert(JSON.stringify(ctx.LIMITS) === "[20,50,100]", "局数只有 20 / 50 / 100 三档", JSON.stringify(ctx.LIMITS));
  for (const n of [20, 50, 100]) assert(ctx.syncPrefs({ max: n }).max === n, "存下的 " + n + " 读回来");
  for (const n of [0, 30, 1000, "50", null]) assert(ctx.syncPrefs({ max: n }).max === 20, "不认得的局数回到 20：" + JSON.stringify(n));
  assert(ctx.syncPrefs({ analyse: true }).analyse === true && ctx.syncPrefs({ analyse: "yes" }).analyse === false, "同步后分析：只认真的 true，默认关");
  // c27fbfa 存下的 last（按网站:名字记的时间）照样读得进来，只是不再用
  const withMark = ctx.syncPrefs({ v: 1, on: true, site: "lichess", user: "thibault", max: 50, last: { "lichess:thibault": 1790617958000 } });
  assert(withMark.on && withMark.site === "lichess" && withMark.user === "thibault" && withMark.max === 50 && !("last" in withMark),
    "c27fbfa 的存档（带 last）：其余各项照旧读回，last 不再读", JSON.stringify(withMark));

  // 8.1 M2 评审 P2-2 / P2-3：从哪里开始，看棋谱库里已经有的
  const DAY = 86400000;
  const g = (site, white, black, date, extra) => Object.assign({ site, white, black, date }, extra || {});
  const LI = (id) => "https://lichess.org/" + id;
  const lib = [
    g(LI("a1"), "thibault", "x", "2026.09.28"),
    g(LI("a2"), "Thibault", "y", "2026.09.20"),
    g(LI("a3"), "z", "THIBAULT", "2026.09.14"), // 正好在 14 天那一天
    g(LI("a4"), "thibault", "w", "2026.09.13"), // 早一天：不在重叠里
    g(LI("a5"), "someone", "else", "2026.09.29"), // 别人的棋
    g("Chess.com", "thibault", "q", "2026.09.30"), // 别的网站
    g(LI("a6"), "thibault", "r", "????.??.??"), // 没有日期
    g(LI("a7"), "thibault", "s", "2026.09.30", { src: "local" }), // 本机棋不算
  ];
  const f1 = ctx.syncSince(lib, "lichess", "thibault");
  assert(f1 && f1.since === Date.UTC(2026, 8, 28) - 14 * DAY && f1.known === 3,
    "since = 库里这个网站、这个名字最新一局那天的 0 点 − 14 天；重叠里已有 3 局（名字不分大小写、执黑执白都算）", JSON.stringify(f1));
  assert(f1.since === 1789344000000, "与 main.zig 的 Lichess 增量测试是同一个 since", String(f1.since));
  const f2 = ctx.syncSince(lib, "chesscom", "thibault");
  assert(f2 && f2.since === Date.UTC(2026, 8, 30) - 14 * DAY && f2.known === 1, "Chess.com 只看 Site 是 Chess.com 的棋", JSON.stringify(f2));
  assert(ctx.syncSince(lib, "lichess", "nobody") === null && ctx.syncSince([], "lichess", "thibault") === null,
    "库里没有这人的棋：第一次同步，不带 since");
  // 重叠里最多算 50 局：一天 60 局，since 就是那天，已有的只报 50
  const heavy = [];
  for (let i = 0; i < 60; i++) heavy.push(g(LI("h" + i), "thibault", "x", "2026.09.28"));
  for (let i = 0; i < 30; i++) heavy.push(g(LI("k" + i), "thibault", "x", "2026.09.27"));
  const f3 = ctx.syncSince(heavy, "lichess", "thibault");
  assert(f3.since === Date.UTC(2026, 8, 28) && f3.known === 50, "重叠最多 50 局：since 收到第 50 新的那一局那天", JSON.stringify(f3));
  const spread = [];
  for (let i = 0; i < 80; i++) spread.push(g(LI("s" + i), "thibault", "x", "2026.09." + String(28 - Math.floor(i / 8)).padStart(2, "0")));
  const f4 = ctx.syncSince(spread, "lichess", "thibault");
  assert(f4.since === Date.UTC(2026, 8, 22) && f4.known === 50, "重叠最多 50 局：8 局一天，收到 9 月 22 日（那 7 天 56 局，报 50）（" + JSON.stringify(f4) + "）");

  // 发给原生层的：第一次没有 since；之后 since 来自棋谱库，局数 = 选的 N + 重叠里已有的
  assert(JSON.stringify(ctx.syncRequest("lichess", "thibault", 20, null)) === '{"site":"lichess","user":"thibault","max":20}',
    "第一次：网站、名字、局数，没有 since", JSON.stringify(ctx.syncRequest("lichess", "thibault", 20, null)));
  assert(JSON.stringify(ctx.syncRequest("lichess", "thibault", 50, f1)) === '{"site":"lichess","user":"thibault","max":53,"since":1789344000000}',
    "之后：since 来自棋谱库，局数 50 + 已有的 3", JSON.stringify(ctx.syncRequest("lichess", "thibault", 50, f1)));
  assert(ctx.OVERLAP_DAYS === 14 && ctx.OVERLAP_GAMES === 50 && 100 + ctx.OVERLAP_GAMES <= 150,
    "最多 100 + 50 局，不超过 main.zig 的 SYNC_GAMES_MAX（150）");
  const zig = (await import("fs")).readFileSync(path.join(root, "src/main.zig"), "utf8");
  assert(/const SYNC_GAMES_MAX: usize = 150;/.test(zig), "main.zig SYNC_GAMES_MAX 仍是 150");

  // 增量时零局说「没有新对局」，第一次零局仍说「还没有对局」
  assert(JSON.stringify(ctx.syncMessage({ pgn: "", count: 0 }, true)) === '{"key":"sync.none"}', "增量同步零局：没有新对局");
  assert(JSON.stringify(ctx.syncMessage({ pgn: "", count: 0 }, false)) === '{"key":"sync.empty"}', "第一次零局：还没有对局");
  assert(JSON.stringify(ctx.syncMessage({ error: "busy" }, true)) === '{"key":"sync.busy"}', "原生层忙（上一次还在外面）：说上一次同步还没结束");

  // 选项的字只由分块读（sync-ui.js → chunk-sync.js），首屏包里没有读它们的代码
  const fs = await import("fs");
  const readers = fs.readdirSync(path.join(root, "src/web/js"))
    .filter((f) => f.endsWith(".js") && !/^(chunk-|bundle\.js|i18n)/.test(f))
    .filter((f) => /sync\.(limit|analyse|progress|none|timeout|busy)\b/.test(fs.readFileSync(path.join(root, "src/web/js", f), "utf8")));
  assert(JSON.stringify(readers) === '["sync-ui.js"]', "T4 的四个新键、评审加的两个只在 sync-ui.js 里读", JSON.stringify(readers));
}

// --- 两家网站的 PGN 进得了棋谱库，并认出是谁下的 ----------------------------
// 形状与 main.zig 的样本一致：Lichess 的时钟注释带空格，Chess.com 的不带，
// 且带小数秒；原生层交回来的是「一局一段、空行相隔」的一整段文本。
{
  const LICHESS = "[Event \"Rated blitz game\"]\n[Site \"https://lichess.org/Ab3dEf7h\"]\n[Date \"2026.09.21\"]\n" +
    "[White \"sync_tester\"]\n[Black \"Opponent-2\"]\n[Result \"1-0\"]\n[TimeControl \"180+2\"]\n\n" +
    "1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:03:01] } 2... Nc6 { [%clk 0:02:59] } " +
    "3. Bc4 { [%clk 0:03:00] } 3... Nf6 { [%clk 0:02:57] } 4. Qxf7# { [%clk 0:03:00] } 1-0";
  const CHESSCOM = "[Event \"Let's Play!\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.20\"]\n[White \"last_opp\"]\n" +
    "[Black \"Sync_Tester\"]\n[Result \"0-1\"]\n\n1. f3 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58.1]} 2. g4 {[%clk 0:02:57]} 2... Qh4# {[%clk 0:02:55]} 0-1";
  const text = LICHESS + "\n\n" + CHESSCOM;
  const P = ctx.ChessPgnParser, L = ctx.ChessLibrary;
  const games = P.splitGames(text).map((c) => P.parsePgn(c).games[0]).filter(Boolean);
  assert(games.length === 2, "两局分得开", String(games.length));
  const entries = games.map((g) => {
    const sans = [];
    for (let n = g.root; n && n.children.length; n = n.children[0]) sans.push(n.children[0].san);
    return L.entryFrom(g, sans, ["sync_tester"], 1);
  });
  assert(entries[0].plies === 7 && entries[0].side === "w" && entries[0].outcome === "win", "Lichess 那局：7 步，执白，赢", JSON.stringify(entries[0]));
  // 名字不分大小写：Chess.com 的 URL 用小写，PGN 里是用户自己写的大小写
  assert(entries[1].plies === 4 && entries[1].side === "b" && entries[1].outcome === "win", "Chess.com 那局：4 步，执黑，赢", JSON.stringify(entries[1]));
  assert(Array.isArray(entries[0].clk) && entries[0].clk.length === 7 && Array.isArray(entries[1].clk),
    "两家的时钟都带进了棋谱库（B5 的时间压力要用）", JSON.stringify([entries[0].clk, entries[1].clk]));

  // M5 合并（C2 × C1）：同步进来的棋走 C1 的导入（library-page.js importPgn），
  // 带着来源、带着局面索引 —— 列表上标出是哪家网站的，开局浏览器按局面数得到
  const Q = ctx.LibraryQuery;
  assert(Q && typeof Q.siteOf === "function" && Q.siteOf(entries[0]) === "Lichess" && Q.siteOf(entries[1]) === "Chess.com",
    "来源标签：Lichess / Chess.com（从 PGN 的 Site 认）", Q && Q.siteOf && JSON.stringify(entries.map(Q.siteOf)));
  assert(Q && Q.siteOf && Q.siteOf({ site: "" }) === "" && Q.siteOf({ site: "https://example.org/lichess.org" }) === "" && Q.siteOf({ src: "local" }) === "",
    "别处的棋、本机的棋不标");
  const pk = new Map(games.map((g, i) => {
    const fens = [g.root.fen];
    for (let n = g.root; n && n.children.length; n = n.children[0]) fens.push(n.children[0].fen);
    return [entries[i].id, Q.keysOfFens(fens)];
  }));
  const at = Q.gamesWithPosition(entries, "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", (g) => pk.get(g.id));
  assert(at.total === 2 && at.moves.map((m) => m.san + m.n).join() === "e41,f31", "两局按解析时的局面进了索引：起始局面 e4 / f3 各 1 局", JSON.stringify(at.moves));
}

// --- 真实应答（src/sync-fixtures/，2026-09-29 由 sync-samples.yml 取回）---------
// 原生层交给页面的正是这样的文本（scripts/sync-fixtures.mjs 照 main.zig 的分局
// 规则拼，Zig 测试在同几份文件上钉住了）：Lichess thibault 的 5 局快棋；Chess.com
// erik 最近一个月的 13 局里 9 局标准棋（其中 8 局每日棋、1 局 10 分钟），
// Chess960 的 4 局原生层就不给
{
  const P = ctx.ChessPgnParser, L = ctx.ChessLibrary, Q = ctx.LibraryQuery, M = ctx.ChessProgressMetrics;
  const importAs = (text, names) => {
    const games = P.splitGames(text).map((c) => P.parsePgn(c).games[0]).filter(Boolean);
    return games.map((g) => {
      const sans = [], fens = [g.root.fen];
      for (let n = g.root; n && n.children.length; n = n.children[0]) { sans.push(n.children[0].san); fens.push(n.children[0].fen); }
      return { e: L.entryFrom(g, sans, names, 1), keys: Q.keysOfFens(fens) };
    });
  };
  const li = lichessAnswer(), cc = chesscomAnswer();
  assert(li.count === 5 && cc.count === 9, "真实应答：Lichess 5 局、Chess.com 9 局", JSON.stringify([li.count, cc.count]));
  const a = importAs(li.pgn, ["thibault"]);
  const b = importAs(cc.pgn, ["Erik"]);
  const ea = a.map((x) => x.e), eb = b.map((x) => x.e);
  assert(ea.length === 5 && eb.length === 9, "每一局都解析得出来", JSON.stringify([ea.length, eb.length]));
  const brief = (e) => [e.plies, e.side, e.outcome].join(" ");
  assert(ea.map(brief).join() === "78 b win,15 b loss,136 w loss,197 b draw,18 w loss",
    "Lichess：步数、执哪方、胜负都对得上", ea.map(brief).join());
  assert(eb.map(brief).join() === "68 w draw,74 b draw,20 w loss,34 b win,72 w win,61 w win,92 w win,82 b win,107 b win",
    "Chess.com：名字不分大小写认出 erik，最新的在前，步数、执哪方、胜负都对得上", eb.map(brief).join());
  assert(ea.every((e) => Q.siteOf(e) === "Lichess") && eb.every((e) => Q.siteOf(e) === "Chess.com"),
    "来源标签：Site 是对局 URL / \"Chess.com\"", JSON.stringify(ea.concat(eb).map((e) => e.site)));
  assert(new Set(ea.concat(eb).map((e) => e.id)).size === 14, "14 局 14 个 id，没有撞在一起");
  assert(ea.concat(eb).every((e) => Array.isArray(e.clk) && e.clk.length === e.plies), "每一手的钟都读到了（两家的写法：带不带空格、小时位、十分之一秒）");
  const pk = new Map(a.concat(b).map((x) => [x.e.id, x.keys]));
  const at = Q.gamesWithPosition(ea.concat(eb), "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", (g) => pk.get(g.id));
  assert(at.total === 14 && at.moves.map((m) => m.san + ":" + m.n).join() === "e4:10,d4:4",
    "局面索引：起始局面 e4 10 局、d4 4 局", JSON.stringify(at.moves.map((m) => m.san + ":" + m.n)));
  // B5 的时间紧失误率：每日棋的 [%clk] 是这一步的时限，不算（progress-metrics.js factsOf）
  const facts = (e) => M.factsOf({ side: e.side, outcome: e.outcome, fen: e.fen, clk: e.clk, tc: e.tc, tags: e.clk.map(() => null) });
  const daily = eb.filter((e) => /^1\//.test(e.tc)), live = eb.filter((e) => e.tc === "600");
  assert(daily.length === 8 && live.length === 1 && daily.every((e) => !facts(e).clocked) && live.every((e) => facts(e).clocked) && ea.every((e) => facts(e).clocked),
    "每日棋的钟不进时间紧，限时棋照算", JSON.stringify(eb.map((e) => [e.tc, facts(e).clocked])));
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
