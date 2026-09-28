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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Date, Math, JSON };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["sync-ui.js", "persist.js", "pgn-parser.js", "library.js"]) {
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
  assert(p0.on === false && p0.site === "lichess" && p0.user === "" && p0.n === 20, "没存过：关，Lichess，20 局", JSON.stringify(p0));
  assert(ctx.syncPrefs(P({ v: 1, on: "yes" })).on === false, "on 不是 true 就是关");
  const p1 = ctx.syncPrefs(P({ v: 1, on: true, site: "chesscom", user: "Hikaru", n: 50 }));
  assert(p1.on && p1.site === "chesscom" && p1.user === "Hikaru" && p1.n === 50, "存下的都读回来", JSON.stringify(p1));
  const p2 = ctx.syncPrefs(P({ v: 1, on: true, site: "fics", user: 7, n: 999 }));
  assert(p2.site === "lichess" && p2.user === "" && p2.n === 20, "认不得的值回到默认", JSON.stringify(p2));
  // 它是档案里的一个键：清除全部存档会连用户名一起清掉
  assert(ctx.KEYS && ctx.KEYS.sync === "chess.v1.sync", "persist.js 的键表里有 sync");
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
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
