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
  for (const e of ["offline", "timeout", "bridge"]) {
    assert(say({ error: e }) === '{"key":"sync.offline"}', "连不上（" + e + "）", say({ error: e }));
  }
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
    JSON.stringify(old.last) === "{}", "8.0 的存档：开关、网站、名字照旧，最多 20 局、不自动分析、没有上次", JSON.stringify(old));
  assert(JSON.stringify(ctx.LIMITS) === "[20,50,100]", "局数只有 20 / 50 / 100 三档", JSON.stringify(ctx.LIMITS));
  for (const n of [20, 50, 100]) assert(ctx.syncPrefs({ max: n }).max === n, "存下的 " + n + " 读回来");
  for (const n of [0, 30, 1000, "50", null]) assert(ctx.syncPrefs({ max: n }).max === 20, "不认得的局数回到 20：" + JSON.stringify(n));
  assert(ctx.syncPrefs({ analyse: true }).analyse === true && ctx.syncPrefs({ analyse: "yes" }).analyse === false, "同步后分析：只认真的 true，默认关");
  const marks = ctx.syncPrefs({ last: { "lichess:thibault": 1790617958000, "chesscom:erik": -1, "x": "1", "y": 1.5 } }).last;
  assert(JSON.stringify(marks) === '{"lichess:thibault":1790617958000}', "上次的时间：只留正整数", JSON.stringify(marks));
  assert(JSON.stringify(ctx.syncPrefs({ last: [1] }).last) === "{}", "上次的时间不是对象：当作没有");

  // 发给原生层的：第一次没有 since；同一网站、同一名字（不分大小写）的第二次，since = 上次 + 1 ms
  const p0 = ctx.syncPrefs({ v: 1, on: true });
  assert(JSON.stringify(ctx.syncRequest(p0, "lichess", "thibault", 20)) === '{"site":"lichess","user":"thibault","max":20}',
    "第一次：网站、名字、局数，没有 since", JSON.stringify(ctx.syncRequest(p0, "lichess", "thibault", 20)));
  const s1 = ctx.withLast({ v: 1, on: true }, "lichess", "Thibault", 1790617958000);
  const p1 = ctx.syncPrefs(s1);
  assert(JSON.stringify(ctx.syncRequest(p1, "lichess", "thibault", 50)) === '{"site":"lichess","user":"thibault","max":50,"since":1790617958001}',
    "第二次：since 是上次最新一局的时间 + 1 ms（名字不分大小写）", JSON.stringify(ctx.syncRequest(p1, "lichess", "thibault", 50)));
  assert(ctx.syncRequest(p1, "chesscom", "thibault", 20).since === undefined && ctx.syncRequest(p1, "lichess", "erik", 20).since === undefined,
    "别的网站、别的名字各记各的");
  // 记号只往前走：没有新棋（应答里没有 last）或更早的时间都不动它
  assert(ctx.syncPrefs(ctx.withLast(s1, "lichess", "thibault", undefined)).last["lichess:thibault"] === 1790617958000, "没有新棋：记号不动");
  assert(ctx.syncPrefs(ctx.withLast(s1, "lichess", "thibault", 1700000000000)).last["lichess:thibault"] === 1790617958000, "更早的时间：记号不往回走");
  const s2 = ctx.withLast(s1, "chesscom", "erik", 1790355872000);
  assert(s2.on === true && s2.v === 1 && Object.keys(ctx.syncPrefs(s2).last).length === 2, "记下一处不丢别的键、别的记号", JSON.stringify(s2));

  // 增量时零局说「没有新对局」，第一次零局仍说「还没有对局」
  assert(JSON.stringify(ctx.syncMessage({ pgn: "", count: 0 }, true)) === '{"key":"sync.none"}', "增量同步零局：没有新对局");
  assert(JSON.stringify(ctx.syncMessage({ pgn: "", count: 0 }, false)) === '{"key":"sync.empty"}', "第一次零局：还没有对局");
  assert(JSON.stringify(ctx.syncMessage({ error: "busy" }, true)) === '{"key":"sync.failed","arg":"?"}', "原生层忙（另一个窗口在同步）：同步没有完成");

  // 选项的字只由分块读（sync-ui.js → chunk-sync.js），首屏包里没有读它们的代码
  const fs = await import("fs");
  const readers = fs.readdirSync(path.join(root, "src/web/js"))
    .filter((f) => f.endsWith(".js") && !/^(chunk-|bundle\.js|i18n)/.test(f))
    .filter((f) => /sync\.(limit|analyse|progress|none)\b/.test(fs.readFileSync(path.join(root, "src/web/js", f), "utf8")));
  assert(JSON.stringify(readers) === '["sync-ui.js"]', "T4 的四个新键只在 sync-ui.js 里读", JSON.stringify(readers));
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
