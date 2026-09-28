/**
 * 开局浏览器（v8-0-plan C3）：src/web/js/explorer/core.js 的算术、内置大师树的
 * 数据，以及浏览器与开局树在「书」着上的一致。
 *
 * 纯函数加生成好的数据文件，不需要浏览器。跑：node scripts/test-explorer.mjs
 *
 *   1. 棋谱库来源：计数、易位（换序）合并、一局只算一次、500 局的耗时。
 *   2. 「书」：浏览器按局面标出的书着 = 开局树（opening-tree.js）在所有走到
 *      同一局面的着法顺序上的 childrenAt 之并。
 *   3. 大师树：build-explorer.mjs 的计数器对样本棋谱逐局面等于一个朴素重数；
 *      打进包里的分块在抽检局面上逐着等于构建时从原始对局重数的结果；体积 ≤ 10 MB。
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync, CHUNKS, build } from "./bundle.mjs";
import { createCounter, naiveCount, eachGame, qualifies, DEFAULTS } from "./build-explorer.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Date, Math, JSON };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "fide.js", "openings.js", "opening-tree.js", "explorer/core.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + f)), ctx, { filename: f });
}
const X = ctx.ChessExplorer;
const { Chess } = ctx;
const keyOf = (pos) => ctx.ChessFide.positionKey(pos.fen(), pos);
const keyAfter = (sans, fen) => { const g = fen ? new Chess(fen) : new Chess(); for (const s of sans) g.move(s); return keyOf(g); };

let failed = 0;
const REC = {}; // --record: what docs/measured.json `explorer` holds
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};

// --- 基础：哈希、结果、百分比 ---------------------------------------------------
{
  const k0 = keyAfter([]);
  assert(X.hashKey(k0) === X.hashKey(k0) && X.hashKey(k0) !== X.hashKey(keyAfter(["e4"])), "hashKey 稳定，不同局面不同");
  assert(/^[0-9a-z]{1,11}$/.test(X.hashKey(k0)), "hashKey 是 ≤ 11 位的 36 进制串");
  assert(X.resultOf("1-0") === "w" && X.resultOf("0-1") === "b" && X.resultOf("1/2-1/2") === "d" && X.resultOf("*") === null, "resultOf 从白方看");
  const p = X.percents({ w: 1, d: 1, b: 1 });
  assert(p.reduce((a, b) => a + b, 0) === 100 && p.join() === "34,33,33", "百分比凑满 100（最大余数）", p.join());
  assert(X.percents({ w: 0, d: 0, b: 0 }).join() === "0,0,0", "没有结果时全是 0");
  const rows = [{ san: "e4", n: 3, w: 1, d: 1, b: 1 }, { san: "d4", n: 10, w: 9, d: 0, b: 0 }];
  assert(X.decodeRows(X.encodeRows(rows)).map((r) => [r.san, r.n, r.w, r.d, r.b].join()).join("|") === "e4,3,1,1,1|d4,10,9,0,0", "encodeRows / decodeRows 往返");
  assert(X.bucketFor([[0, 5], [6, 9]], 7) === 1 && X.bucketFor([[0, 5], [6, 9]], 12) === -1, "bucketFor 按半回合区间");
}

// --- 1. 棋谱库来源 ---------------------------------------------------------------
{
  const lib = [
    { sans: "e4 e5 Nf3 Nc6 Bc4 Bc5", result: "1-0" },
    { sans: "e4 e5 Bc4 Nc6 Nf3 Nf6", result: "0-1" }, // 换序到同一局面
    { sans: "e4 c5 Nf3", result: "1/2-1/2" },
    { sans: "d4 d5", result: "*" },                    // 没下完：只算局数
    { sans: "Nf3 Nf6 Ng1 Ng8 Nf3 Nf6", result: "1-0" }, // 重复局面：一局只算一次
    { sans: "Ke2", fen: "4k3/8/8/8/8/8/8/4K3 w - - 0 1", result: "1/2-1/2" },
  ];
  let list = lib.slice();
  const src = X.librarySource(() => list);
  const at = (sans, fen) => src.movesAt(keyAfter(sans, fen)).map((r) => [r.san, r.n, r.w, r.d, r.b].join(",")).join(" ");
  assert(at([]) === "e4,3,1,1,1 Nf3,1,1,0,0 d4,1,0,0,0", "起始局面：e4 三局（1 胜 1 和 1 负），未完的 d4 只计局数；来回跳马回到起始局面的那局只计一次", at([]));
  assert(at(["e4", "e5"]) === "Bc4,1,0,0,1 Nf3,1,1,0,0", "1.e4 e5 之后两种走法各一局", at(["e4", "e5"]));
  const tp = at(["e4", "e5", "Nf3", "Nc6", "Bc4"]);
  assert(tp === at(["e4", "e5", "Bc4", "Nc6", "Nf3"]) && tp === "Bc5,1,1,0,0 Nf6,1,0,0,1", "换序走到的同一局面合并统计", tp);
  assert(at(["Nf3"]) === "Nf6,1,1,0,0", "同一局重复到达的局面只计一次", at(["Nf3"]));
  assert(at([], "4k3/8/8/8/8/8/8/4K3 w - - 0 1") === "Ke2,1,0,1,0", "带 [FEN] 的对局从它自己的起始局面算");
  assert(src.size() === 6, "size() 是库里的局数");
  list = list.concat([{ sans: "e4", result: "1-0" }]);
  assert(at([]).startsWith("e4,4,2,1,1"), "库换了一个新数组，索引跟着重建");

  // 500 局、每局 80 个半回合的随机棋谱：一次建索引、此后每次查询
  const rand = ((s) => () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296))(7);
  const big = [];
  for (let i = 0; i < 500; i++) {
    const g = new Chess();
    for (let p = 0; p < 80; p++) {
      const ms = g.moves();
      if (!ms.length) break;
      g.move(ms[Math.floor(rand() * ms.length)]);
    }
    big.push({ sans: g.history().join(" "), result: ["1-0", "0-1", "1/2-1/2"][i % 3] });
  }
  const bsrc = X.librarySource(() => big);
  let t = performance.now();
  const first = bsrc.movesAt(keyAfter([]));
  const tIndex = performance.now() - t;
  REC.libIndex = { games: 500, plies: 80, maxPly: X.LIB_PLIES, chessJsMsBefore: 3445 };
  t = performance.now();
  for (let i = 0; i < 100; i++) bsrc.movesAt(keyAfter([]));
  const tQuery = (performance.now() - t) / 100;
  Object.assign(REC.libIndex, { ms: Math.round(tIndex), queryMs: Math.round(tQuery * 100) / 100 });
  console.log("  500 局索引 " + tIndex.toFixed(0) + " ms，每次查询 " + tQuery.toFixed(2) + " ms");
  assert(first.reduce((n, r) => n + r.n, 0) === 500, "500 局都从起始局面计入");
  assert(tIndex < 1000, "500 局 × 80 半回合，一次建索引 < 1 s（" + tIndex.toFixed(0) + " ms；chess.js 上是 3.4 s）");
  assert(tQuery < 5, "建好之后每次查询 < 5 ms（" + tQuery.toFixed(2) + " ms）");

  // replay.js 的局面键逐步等于 ChessFide.positionKey（chess.js）：随机对局（含升变、
  // 吃过路兵、易位、牵制下的消歧）加几个专门摆出来的局面
  let steps = 0, off = 0, firstOff = "";
  const check = (g, r) => { steps++; if (r.key() !== keyOf(g)) { off++; if (!firstOff) firstOff = g.fen() + " → " + r.key(); } };
  for (let i = 0; i < 300; i++) {
    const g = new Chess();
    const r = X.createReplay();
    for (let p = 0; p < 160; p++) {
      const ms = g.moves();
      if (!ms.length) break;
      // lean on pawn pushes so promotions and en passant actually happen
      const pawny = ms.filter((m) => /^[a-h]/.test(m));
      const pool = pawny.length && rand() < 0.5 ? pawny : ms;
      const san = pool[Math.floor(rand() * pool.length)];
      g.move(san);
      if (!r.move(san)) { off++; firstOff = firstOff || "move " + san + " at " + g.fen(); break; }
      check(g, r);
    }
  }
  const special = [
    // ep legal / pinned against the king along the rank / on a diagonal
    ["8/8/8/8/1p6/8/P7/4K2k w - - 0 1", ["a4"]],
    ["8/8/8/K7/1p5r/8/2P5/7k w - - 0 1", ["c4"]],
    ["4k3/8/8/1b6/8/3p4/4P3/5K2 w - - 0 1", ["e4"]],
    // two knights, one pinned: SAN names no file
    ["4k3/4r3/8/8/8/8/2N1N3/4K3 w - - 0 1", ["Nd4"]],
    // castling rights lost by a rook capture on its corner
    ["r3k2r/8/8/8/8/8/6B1/R3K2R w KQkq - 0 1", ["Bxa8", "Kf8", "O-O"]],
    ["4k3/1P6/8/8/8/8/8/4K3 w - - 0 1", ["b8=N"]],
  ];
  for (const [fen, sans] of special) {
    const g = new Chess(fen);
    const r = X.createReplay(fen);
    check(g, r);
    for (const s of sans) {
      if (!g.move(s) || !r.move(s)) { off++; firstOff = firstOff || fen + " " + s; break; }
      check(g, r);
    }
  }
  assert(off === 0 && steps > 20000, "replay.js 与 chess.js 的局面键在 " + steps + " 步上逐步相同", firstOff);
}

// --- 2. 「书」：浏览器与开局树一致 ------------------------------------------------
{
  const lines = ctx.CHESS_OPENINGS;
  const T = ctx.ChessOpeningTree;
  const tree = T.buildTree(lines);
  const book = X.bookIndex(lines);
  // 开局树按着法顺序：走到每个局面的所有顺序上的 childrenAt 之并
  const want = new Map();
  let prefixes = 0;
  (function walk(node, sans) {
    const kids = T.childrenAt(tree, sans).map((k) => k.san);
    if (kids.length) {
      prefixes++;
      const k = keyAfter(sans);
      if (!want.has(k)) want.set(k, new Set());
      for (const s of kids) want.get(k).add(s);
    }
    for (const s of kids) walk(node.children[s], sans.concat(s));
  })(tree, []);
  let agree = 0;
  const bad = [];
  for (const [k, set] of want) {
    const got = book.get(k) || new Set();
    if (got.size === set.size && [...set].every((s) => got.has(s))) agree++;
    else bad.push(k + " tree=" + [...set].join(",") + " explorer=" + [...got].join(","));
  }
  assert(bad.length === 0 && book.size === want.size,
    "开局树的 " + prefixes + " 个分支点（" + want.size + " 个局面）上，浏览器标「书」的着法与开局树一模一样", bad.slice(0, 3).join(" | "));
  // 一个换序：1.Nf3 d5 2.d4 与 1.d4 d5 2.Nf3 是同一局面，书着取两条路的并
  const k = keyAfter(["d4", "d5", "Nf3"]);
  assert(keyAfter(["Nf3", "d5", "d4"]) === k && book.has(k), "换序到同一局面，书着按局面查得到");
  // rowsAt：合法才留、书着标出；一局都没有时列出书着（n = 0），有对局时不掺空行
  const pos = new Chess();
  const rows = X.rowsAt([{ san: "e4", n: 5, w: 2, d: 1, b: 2 }, { san: "Ke2", n: 1, w: 0, d: 0, b: 1 }, { san: "a3", n: 2, w: 1, d: 0, b: 1 }], pos, book.get(keyOf(pos)));
  assert(rows.find((r) => r.san === "e4").book && !rows.find((r) => r.san === "a3").book, "e4 是书着、a3 不是");
  assert(!rows.some((r) => r.san === "Ke2"), "不合法的着法（哈希撞车或坏棋谱）不上屏");
  assert(!rows.some((r) => r.n === 0), "有对局的局面不掺局数为 0 的书着行");
  const silent = X.rowsAt([], pos, book.get(keyOf(pos)));
  assert(silent.length === book.get(keyOf(pos)).size && silent.every((r) => r.n === 0 && r.book) && silent.some((r) => r.san === "d4"),
    "一局都没有的局面，列出开局书的 " + silent.length + " 个着法，局数 0");
}

// --- 3. 大师树 -------------------------------------------------------------------
{
  const dir = path.join(root, "src/web/js/explorer");
  const idxSrc = fs.readFileSync(path.join(dir, "masters-index.js"), "utf8");
  const ictx = {};
  vm.createContext(ictx);
  vm.runInContext(idxSrc.replace("export const EXPLORER_MASTERS =", "globalThis.EXPLORER_MASTERS ="), ictx);
  const M = ictx.EXPLORER_MASTERS;
  assert(M.licence === "CC0" && /^lichess_db_standard_rated_\d{4}-\d\d$/.test(M.source), "来源与许可写在索引里：" + M.source + "，" + M.licence);
  assert(/Params: --month \S+ --min-elo \d+ --speeds \S+ --games \d+ --plies \d+ --min-games \d+/.test(idxSrc), "生成参数记在文件头");
  assert(M.plies >= 12 && M.plies <= 16, "深度在计划的 12–16 个半回合之内（" + M.plies + "）");
  const files = fs.readdirSync(dir).filter((f) => /^masters-\d\d\.js$/.test(f)).sort();
  const bytes = files.reduce((n, f) => n + fs.statSync(path.join(dir, f)).size, 0);
  console.log("  大师树 " + M.games + " 局，" + M.positions + " 个局面，" + files.length + " 块，共 " + (bytes / 1048576).toFixed(2) + " MB");
  assert(bytes <= 10 * 1048576, "体积 ≤ 10 MB（" + (bytes / 1048576).toFixed(2) + " MB）");
  assert(files.length === M.buckets.length, "每个半回合区间一块");
  // every bucket is a chunk the bundler builds, under the global core.js asks for
  for (let i = 0; i < files.length; i++) {
    const nn = String(i).padStart(2, "0");
    assert(CHUNKS.some((c) => c.entry === "src/web/js/explorer/masters-" + nn + ".js" && c.out === "src/web/js/chunk-xm-" + nn + ".js" && c.global === "EXPLORER_MB_" + nn),
      "masters-" + nn + ".js 构建成 chunk-xm-" + nn + ".js（EXPLORER_MB_" + nn + "）");
  }
  const chunk = (i) => {
    const nn = String(i).padStart(2, "0");
    const c = {};
    vm.createContext(c);
    vm.runInContext(fs.readFileSync(path.join(dir, "masters-" + nn + ".js"), "utf8").replace("export const EXPLORER_MB_" + nn + " =", "globalThis.T ="), c);
    return c.T;
  };
  const loaded = M.buckets.map((_, i) => chunk(i));

  // 3a. 抽检：打进包里的计数 = 构建时从原始对局朴素重数（剪掉 < minGames 的着法）
  const audit = JSON.parse(fs.readFileSync(path.join(root, "scripts/fixtures/explorer-audit.json"), "utf8"));
  assert(audit.params.games === M.games && audit.positions.length >= 20, "抽检表与分块是同一次构建（" + audit.positions.length + " 个局面）");
  let exact = 0;
  const miss = [];
  for (const p of audit.positions) {
    const b = X.bucketFor(M.buckets, p.ply);
    const got = X.decodeRows(loaded[b][X.hashKey(p.key)]).map((r) => [r.san, r.n, r.w, r.d, r.b].join(",")).join(" ");
    const want = X.sortRows(Object.entries(p.moves).map(([san, r]) => Object.assign({ san }, r)).filter((r) => r.n >= M.minGames))
      .map((r) => [r.san, r.n, r.w, r.d, r.b].join(",")).join(" ");
    if (got === want) exact++; else miss.push(p.key + ": " + got + " ≠ " + want);
  }
  REC.masters = { source: M.source, licence: M.licence, minElo: M.minElo, speeds: M.speeds, plies: M.plies, minGames: M.minGames,
    read: M.read, games: M.games, positions: M.positions, moves: M.moves, buckets: M.buckets, sourceBytes: bytes,
    audit: { positions: audit.positions.length, exact } };
  assert(miss.length === 0, "抽检 " + audit.positions.length + " 个局面，分块里的每一着、每个胜和负都等于原始对局重数（" + exact + " 个一致）", miss.slice(0, 2).join(" | "));
  const start = X.decodeRows(loaded[0][X.hashKey(keyAfter([]))]);
  assert(start.reduce((n, r) => n + r.n, 0) >= M.games * 0.99, "起始局面的着法合计 ≈ 总局数（剪枝只去掉极少数冷门首着）");

  // 3b. 计数器本身：对提交的原始样本，逐局面等于朴素重数（不剪枝、不哈希）
  const text = fs.readFileSync(path.join(root, "scripts/fixtures/explorer-sample.pgn"), "utf8");
  const games = [];
  async function* linesOf(s) { for (const l of s.split("\n")) yield l; }
  await eachGame(linesOf(text), (g) => {
    if (qualifies(g.tags, Object.assign({}, DEFAULTS, { minElo: M.minElo, speeds: M.speeds }))) games.push({ sans: g.sans, result: g.tags.Result });
  });
  assert(games.length >= 300, "样本有 " + games.length + " 局，都符合构建的门槛（Elo ≥ " + M.minElo + "，" + M.speeds.join("/") + "）");
  const counter = createCounter({ Chess, keyOf, X }, M.plies);
  for (const g of games) counter.add(g.sans, g.result);
  const naive = naiveCount(Chess, keyOf, games, new Set(counter.pos.keys()), M.plies);
  let same = 0;
  const diff = [];
  for (const [k, p] of counter.pos) {
    const a = X.sortRows([...p.moves.values()]).map((r) => [r.san, r.n, r.w, r.d, r.b].join()).join(" ");
    const b = X.sortRows(Object.entries(naive.get(k)).map(([san, r]) => Object.assign({ san }, r))).map((r) => [r.san, r.n, r.w, r.d, r.b].join()).join(" ");
    if (a === b) same++; else diff.push(k);
  }
  assert(diff.length === 0 && same > 1000, "样本的 " + same + " 个局面，计数器与朴素重数逐着一致", diff.slice(0, 2).join(" | "));
}

if (failed) { console.error("\n" + failed + " failed"); process.exit(1); }

// --record: the package-size delta and the figures above into docs/measured.json
// (v8-0-plan C3 acceptance: 包体积增量写进落地记录). The main bundle's
// "before" is the dev branch C3 was last merged with (4d75749) built without C3:
// the M4 review fixes merged meanwhile grew the bundle too, and are not C3's.
if (process.argv.includes("--record")) {
  const bundleSrc = await build({ write: true });
  const size = (f) => fs.statSync(path.join(root, f)).size;
  const xm = CHUNKS.filter((c) => /chunk-xm-\d\d\.js$/.test(c.out)).map((c) => size(c.out));
  REC.package = {
    bundleBefore: 1203521, bundleAfter: Buffer.byteLength(bundleSrc, "utf8"),
    chunkExplorer: size("src/web/js/chunk-explorer.js"), masterChunks: xm, masterChunksTotal: xm.reduce((a, b) => a + b, 0),
  };
  REC.package.bundleDelta = REC.package.bundleAfter - REC.package.bundleBefore;
  REC.package.installDelta = REC.package.bundleDelta + REC.package.chunkExplorer + REC.package.masterChunksTotal;
  const file = path.join(root, "docs/measured.json");
  const m = JSON.parse(fs.readFileSync(file, "utf8"));
  m.explorer = Object.assign({ what: "v8-0-plan C3 开局浏览器：棋谱库索引耗时、内置大师树的来源与规模、包体积增量", script: "scripts/test-explorer.mjs --record" }, REC);
  fs.writeFileSync(file, JSON.stringify(m, null, 2) + "\n");
  console.log("recorded docs/measured.json explorer: " + JSON.stringify(REC.package));
}
console.log("\nall explorer checks passed");
