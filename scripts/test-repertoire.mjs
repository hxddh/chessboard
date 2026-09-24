/**
 * 我的开局书的模型层（src/web/js/repertoire.js）。
 *
 * 纯函数：喂进去解析好的 PGN 树和诊断出来的开局战绩，检查出来的书与缺口。
 * 跑：node scripts/test-repertoire.mjs
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
for (const f of ["drills.js", "pgn-parser.js", "repertoire.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + f)), ctx, { filename: f });
}
const R = ctx.ChessRepertoire;
const P = ctx.ChessPgnParser;

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};

/** 一份带变着的开局书，就是教练给你的那种 */
const PGN = `[Event "White repertoire"]
[White "?"]
[Black "?"]
[Result "*"]

1. e4 e5 (1... c5 2. Nf3 d6 3. d4) 2. Nf3 Nc6 3. Bb5 a6 *
`;

// --- 变着就是这本书的全部意义 ----------------------------------------------
{
  const games = P.parsePgn(PGN).games;
  const lines = R.linesFrom(games).lines;
  assert(lines.length === 2, "一份带一个变着的书，读出来是两条线", lines.length);
  assert(lines.includes("e4 e5 Nf3 Nc6 Bb5 a6"), "主线在", JSON.stringify(lines));
  assert(lines.includes("e4 c5 Nf3 d6 d4"), "变着也在 —— 棋谱库只留主线，这里正相反", JSON.stringify(lines));
  // 深度优先，主线先出来：书读起来要跟它写出来的顺序一样
  assert(lines[0] === "e4 e5 Nf3 Nc6 Bb5 a6", "主线排在前面", lines[0]);
}

// --- 从别的局面出发的「体系」不是一条开局线（7.3 B2）------------------------
{
  // 一份从残局出发的 PGN。7.2 把它读成一条线 "Rd8 Rb1 Rd2" 照样进书 —— 而这
  // 三手从标准开局第一手就非法，于是铸出一道谁也做不了的题，还什么都不说。
  // 7.1 在棋谱库那条导入路径上修过同一类缺陷（foldGame 不读起始 FEN）。
  const SETUP = `[Event "Rook endgame"]\n[SetUp "1"]\n[FEN "r5k1/5ppp/8/8/8/8/5PPP/R5K1 b - - 0 30"]\n\n1... Rd8 2. Rb1 Rd2 *\n`;
  const r = R.linesFrom(P.parsePgn(SETUP).games);
  assert(r.lines.length === 0, "从别的局面出发的局，一条线都不产出", JSON.stringify(r.lines));
  assert(r.skipped === 1, "……而且数出来跳过了几局，页面才说得出为什么", r.skipped);
  // 普通的局照旧
  const ok = R.linesFrom(P.parsePgn(PGN).games);
  assert(ok.lines.length === 2 && ok.skipped === 0, "标准开局的书一切照旧",
    JSON.stringify([ok.lines.length, ok.skipped]));
}

// --- 同一份书导第二遍，不该变成两本 ----------------------------------------
{
  const fresh = R.linesFrom(P.parsePgn(PGN).games).lines;
  const a = R.addLines([], fresh, null);
  assert(a.added === 2 && a.lines.length === 2, "空书导进两条线", a.added);
  const b = R.addLines(a.lines, fresh, null);
  assert(b.added === 0 && b.dup === 2 && b.lines.length === 2,
    "同一份再导一遍，一条都不多 —— 否则挂在 id 上的进度就散了", JSON.stringify([b.added, b.dup]));
  assert(b.lines[0].id === a.lines[0].id, "id 也没变");
}

// --- 前缀：短的那条不值得单独背 --------------------------------------------
{
  const deep = R.addLines([], ["e4 e5 Nf3 Nc6 Bb5"], null);
  const withShort = R.addLines(deep.lines, ["e4 e5 Nf3"], null);
  assert(withShort.added === 0 && withShort.lines.length === 1,
    "已有更深的那条，短的就不必再进来 —— 同样的前六个半着不该背两遍");
  const shallow = R.addLines([], ["e4 e5 Nf3"], null);
  const extended = R.addLines(shallow.lines, ["e4 e5 Nf3 Nc6 Bb5"], null);
  assert(extended.added === 1 && extended.lines.length === 1 && extended.lines[0].sans === "e4 e5 Nf3 Nc6 Bb5",
    "反过来，更深的那条替掉它 —— 书长了，不是多了一条",
    JSON.stringify(extended.lines.map((l) => l.sans)));
  // 被替掉的那条的 id 离开了这本书，所以它要报出来：挂在这个 id 上的复习债，
  // 调用方得跟着一起清掉（7.2 发布前复查提的第三条）。7.4 D3 起它报在
  // replaced 里、不在 dropped 里 —— dropped 是上限挤出去的，界面只为那个弹
  // 「上限 400 条」
  assert(extended.replaced.length === 1 && extended.replaced[0] === shallow.lines[0].id,
    "被替掉的那条 id 报在 replaced 里 —— 否则它欠下的复习永远还不上",
    JSON.stringify(extended.replaced));
  assert(extended.dropped.length === 0,
    "……而不在 dropped 里：书没满，不该弹「上限」", JSON.stringify(extended.dropped));
}

// --- 7.4 D3：同一个文件里短线在前、长线在后 ----------------------------------
{
  // 7.3：addLines([], ["e4 e5", "e4 e5 Nf3"]) 返回 added 2、dropped 1 —— 书里
  // 其实只有一条线，界面却弹「上限 400 条，退出了 1 条」
  const r = R.addLines([], ["e4 e5", "e4 e5 Nf3"], null);
  assert(r.lines.length === 1 && r.lines[0].sans === "e4 e5 Nf3", "书里只有那条长的",
    JSON.stringify(r.lines.map((l) => l.sans)));
  assert(r.added === 1, "进书 1 条，不是 2 条 —— added 不多数", r.added);
  assert(r.dropped.length === 0 && r.replaced.length === 0,
    "没有东西被上限挤出去，也没有书里原有的线被替掉 —— 不弹「触顶」",
    JSON.stringify([r.dropped, r.replaced]));
  // 反过来的次序，结果一样
  const r2 = R.addLines([], ["e4 e5 Nf3", "e4 e5"], null);
  assert(r2.lines.length === 1 && r2.added === 1 && r2.dup === 1 && !r2.dropped.length,
    "长线在前、短线在后：短的算已有", JSON.stringify([r2.added, r2.dup, r2.dropped]));
  // 边界：前缀按「着」算，不按字符算 —— N 不是 Nf3 的前缀
  const r3 = R.addLines([], ["e4 e5 N", "e4 e5 Nf3"].map((x) => x), null);
  assert(r3.lines.length === 2, "按着法比前缀，不按字符", JSON.stringify(r3.lines.map((l) => l.sans)));
  // 上限真的挤掉了书里的老线：这才是要说的那件事
  const old = R.addLines([], ["a3 a6"], null).lines;
  const many = [];
  for (let i = 0; i < R.MAX_LINES; i++) many.push("e4 e5 Nf3 x" + i);
  const r4 = R.addLines(old, many, null);
  assert(r4.dropped.length === 1 && r4.dropped[0] === old[0].id && r4.added === R.MAX_LINES,
    "书满时挤出去的是最老的那条，报在 dropped 里", JSON.stringify([r4.dropped.length, r4.added]));
  // 新线本身就超过上限：进不来的那些不算 added
  many.push("e4 e5 Nf3 y");
  const r5 = R.addLines([], many, null);
  assert(r5.added === R.MAX_LINES && r5.lines.length === R.MAX_LINES && r5.dropped.length === 1,
    "上限挡在门外的新线不算进书", JSON.stringify([r5.added, r5.dropped.length]));
  // 起名只起留下来的那些
  let asked = 0;
  R.addLines([], many, () => { asked++; return null; });
  assert(asked === R.MAX_LINES, "名字只为留在书里的线查", asked);
}

// --- 7.4 D4：两万个叶子的书，一秒之内 --------------------------------------
{
  // 7.3 每进一条线都对整本书做一遍前缀比较，两万个叶子实测 90.8 秒，界面一直
  // 冻着。这里是 20 × 20 × 50 三层、两万条线直接喂 addLines（着法串只是
  // 字符串，合不合法不归这一步管）。门槛给得宽（2 秒），它量的是 O(n²) 回没
  // 回来，不是机器快慢。
  const A = ["a3", "a4", "b3", "b4", "c3", "c4", "d3", "d4", "e3", "e4",
    "f3", "f4", "g3", "g4", "h3", "h4", "Na3", "Nc3", "Nf3", "Nh3"];
  const B = ["a6", "a5", "b6", "b5", "c6", "c5", "d6", "d5", "e6", "e5",
    "f6", "f5", "g6", "g5", "h6", "h5", "Na6", "Nc6", "Nf6", "Nh6"];
  const lines = [];
  for (const a of A) for (const b of B) {
    for (let k = 0; k < 50; k++) lines.push([a, b, "x" + k]);
  }
  const t0 = Date.now();
  const r = R.addLines([], lines.map((l) => R.normalize(l)), () => null);
  const ms = Date.now() - t0;
  assert(lines.length === 20000, "两万个叶子", lines.length);
  assert(ms < 2000, "两万条线进书用了 " + ms + " ms（门槛 2000）", ms);
  assert(r.lines.length === R.MAX_LINES && r.dropped.length === 20000 - R.MAX_LINES,
    "……而且结果对：留下上限那么多，其余报在 dropped 里", JSON.stringify([r.lines.length, r.dropped.length]));
  // 已经有一本满的书，再导两万条：同样快
  const t1 = Date.now();
  R.addLines(r.lines, lines.map((l) => R.normalize(l.concat("y"))), () => null);
  const ms2 = Date.now() - t1;
  assert(ms2 < 2000, "满书之上再导两万条（全是替换）用了 " + ms2 + " ms", ms2);
}

// --- 7.4 D4：pathsOf / linesFrom 在一棵两万叶子的树上 ------------------------
{
  // 解析器那一头不归这里管；这里造树，量的是把树摊成线这一步
  const root = { children: [] };
  for (let a = 0; a < 20; a++) {
    const na = { san: "a" + a, children: [] };
    root.children.push(na);
    for (let b = 0; b < 20; b++) {
      const nb = { san: "b" + b, children: [] };
      na.children.push(nb);
      for (let c = 0; c < 50; c++) nb.children.push({ san: "c" + c, children: [] });
    }
  }
  const t0 = Date.now();
  const read = R.linesFrom([{ root }]);
  const r = R.addLines([], read.lines, () => null);
  const ms = Date.now() - t0;
  assert(read.lines.length === 20000 && r.lines.length === R.MAX_LINES,
    "两万叶子的树读出两万条线", read.lines.length);
  assert(ms < 2000, "从树到书用了 " + ms + " ms（门槛 2000）", ms);
}

// --- id 由着法决定，不由它排第几决定（drills.js 那条教训） ------------------
{
  const one = R.addLines([], ["e4 e5 Nf3 Nc6"], null);
  const two = R.addLines([], ["d4 d5 c4 e6", "e4 e5 Nf3 Nc6"], null);
  const idIn = (r, sans) => r.lines.find((l) => l.sans === sans).id;
  assert(idIn(one, "e4 e5 Nf3 Nc6") === idIn(two, "e4 e5 Nf3 Nc6"),
    "同一条线在书里排第几，都是同一个 id");
  assert(idIn(two, "d4 d5 c4 e6") !== idIn(two, "e4 e5 Nf3 Nc6"), "不同的线是不同的 id");
  // 内置开局题的 id 是 op- 开头的，而一条自己的线常常正好就是书里那一条 ——
  // 同一个 id 的话，做对一边会把另一边也标成做过了
  assert(idIn(one, "e4 e5 Nf3 Nc6").startsWith("rep-"),
    "自己的线用自己的 id 前缀，不和内置开局题撞车", idIn(one, "e4 e5 Nf3 Nc6"));
  // 名字是后来才补上的（ECO 表是懒加载的块），id 不能跟着变
  const named = R.addLines([], ["e4 e5 Nf3 Nc6"], () => ({ eco: "C44", name: "王翼马" }));
  assert(named.lines[0].id === idIn(one, "e4 e5 Nf3 Nc6"),
    "认出名字之后 id 还是那个 id —— 否则挂在上面的进度就断了");
}

// --- 起名：认得出的就带上 ECO，认不出也照样进书 ------------------------------
{
  const nameOf = (sans) => (sans.startsWith("e4 e5") ? { eco: "C60", name: "西班牙开局" } : null);
  const r = R.addLines([], ["e4 e5 Nf3 Nc6 Bb5", "a3 h6 b3 g6"], nameOf);
  const spanish = r.lines.find((l) => l.eco === "C60");
  assert(spanish && spanish.name === "西班牙开局", "认得出的线带着它的名字");
  const odd = r.lines.find((l) => l.sans.startsWith("a3"));
  assert(odd && odd.eco === "" && r.added === 2,
    "书上没有的怪线照样进书 —— 这是你的书，不是 ECO 的书");
}

// --- 上限：满了淘汰最早进来的 ------------------------------------------------
{
  const many = [];
  for (let i = 0; i < R.MAX_LINES + 3; i++) many.push("e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 " + "Na5 ".repeat(1) + "b" + i);
  const r = R.addLines([], many, null);
  assert(r.lines.length === R.MAX_LINES && r.dropped.length === 3,
    `上限 ${R.MAX_LINES} 条，多出来的淘汰最早进来的`, r.lines.length + "/" + r.dropped.length);
}

// --- 交给开局树的那三列 -----------------------------------------------------
{
  const r = R.addLines([], ["e4 e5 Nf3 Nc6"], () => ({ eco: "C44", name: "王翼马" }));
  const rows = R.rowsOf(r.lines);
  assert(rows.length === 1 && rows[0][0] === "C44" && rows[0][2] === "e4 e5 Nf3 Nc6",
    "书交给开局树的是 [ECO, id, 着法串] —— 和内置书同一种行", JSON.stringify(rows[0]));
  assert(rows[0][1] === r.lines[0].id,
    "行里带的是这条线自己的 id：走到叶子时要靠它标「这条背下来了」");
  assert(R.rowsOf([{ id: "x", sans: "d4", eco: "" }])[0][0] === "REP",
    "认不出 ECO 的线也得有个编号位，树才建得起来");
}

// --- 缺口：用真实战绩排序，不是一句列表差集 --------------------------------
{
  const ecos = [
    { eco: "C60", name: "西班牙", n: 20, win: 10, loss: 6, draw: 4 },
    { eco: "B20", name: "西西里", n: 14, win: 2, loss: 9, draw: 3 },
    { eco: "D02", name: "后翼", n: 9, win: 4, loss: 4, draw: 1 },
    { eco: "A40", name: "只下过一局", n: 1, win: 0, loss: 1, draw: 0 },
  ];
  const covered = R.coveredEcos([{ eco: "C60" }, { eco: "" }]);
  const g = R.gaps(ecos, covered, 2);
  assert(!g.some((e) => e.eco === "C60"), "书里有的开局不算缺口");
  assert(g[0].eco === "B20", "输得最多的那个排第一 —— 这一段的全部意义", JSON.stringify(g.map((e) => e.eco)));
  assert(!g.some((e) => e.eco === "A40"), "只碰过一局的还称不上缺口");
  assert(R.coveredEcos([{ eco: "" }]).size === 0, "认不出 ECO 的线，不声称覆盖了任何开局");
}

// --- 一整局带注解的棋不是一条开局线 -----------------------------------------
{
  const long = ["1."];
  const sans = [];
  for (let i = 0; i < 30; i++) sans.push("Nf3", "Nf6", "Ng1", "Ng8");
  const root = { children: [] };
  let cur = root;
  for (const san of sans) { const n = { san, children: [] }; cur.children.push(n); cur = n; }
  const lines = R.linesFrom([{ root }]).lines;
  assert(lines[0].split(" ").length === R.MAX_PLIES,
    `再长也只取前 ${R.MAX_PLIES} 个半着`, lines[0].split(" ").length);
  void long;
}

// --- 7.4 D2 / D3：导入那一层（repertoire-ui.js）---------------------------
{
  // 界面那一层要的东西，全部从一个袋子里递进去；这里递假的：没有 DOM（render
  // 找不到节点就直接返回）、存档写进一个对象、toast 记下来
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/repertoire-ui.js")), ctx, { filename: "repertoire-ui.js" });
  const make = () => {
    const toasts = [];
    const forgotten = [];
    const store = { session: { library: [], puzzleState: { solved: {}, missed: {} } } };
    const t = (k) => k;
    const tf = (k, args) => k + ":" + args.join(",");
    const ui = ctx.createRepertoireUI({
      doc: { getElementById: () => null }, store,
      Persist: { read: () => ({ value: null }), setJson: () => {} },
      t, tf, toast: (m, tier) => toasts.push([m, tier || ""]),
      confirmNative: async () => true, openPgnFile: () => {}, sync: () => {},
      forgetDrills: (ids) => forgotten.push(...ids),
      diagnose: () => null, startDrills: () => {},
    });
    return { ui, toasts, forgotten, store };
  };

  // D2：一份四局的文件，第三局有一着非法。7.3 整份拒掉；现在坏的那局跳过、
  // 说出来，其余三局照常进书
  const GOOD = (moves) => `[Event "r"]\n[Result "*"]\n\n${moves} *\n`;
  const FILE = [
    GOOD("1. e4 e5 2. Nf3 Nc6"),
    GOOD("1. d4 d5 2. c4 e6"),
    GOOD("1. e4 e5 2. Ke3 Nc6"),   // Ke3 is illegal
    GOOD("1. c4 e5 2. Nc3 Nf6"),
  ].join("\n");
  // 先确认这份文件整份喂给解析器确实会抛 —— 否则这条测试什么都没测
  let threw = false;
  try { P.parsePgn(FILE); } catch (_) { threw = true; }
  assert(threw, "整份一次解析，一着非法就整份抛错（7.3 的行为）");
  const a = make();
  await a.ui.importInto("w", FILE, "file.pgn");
  assert(a.ui.linesOf("w").length === 3, "好的三局照常进书", a.ui.linesOf("w").length);
  assert(a.toasts.some(([m]) => m === "rep.badGames:1"), "坏的那一局数出来、说出来",
    JSON.stringify(a.toasts));
  assert(!a.toasts.some(([m]) => m === "msg.import.badPgn"), "不再说整份读不懂", JSON.stringify(a.toasts));

  // D3：先导短线，再导把它延长了的那条 —— 书没满，不弹「上限」；可短线的 id
  // 仍然交给 forgetDrills，它欠的复习要跟着清
  const b = make();
  await b.ui.importInto("w", GOOD("1. e4 e5"), "");
  const shortId = b.ui.linesOf("w")[0].id;
  await b.ui.importInto("w", GOOD("1. e4 e5 2. Nf3 Nc6"), "");
  assert(b.ui.linesOf("w").length === 1, "书里还是一条线，只是长了");
  assert(!b.toasts.some(([m]) => m.startsWith("rep.dropped")),
    "被更长的线替掉不是「上限挤出去」，不弹那一句", JSON.stringify(b.toasts));
  assert(b.forgotten.includes(shortId), "被替掉的 id 照样清掉它欠的复习", JSON.stringify(b.forgotten));
  // 同一份文件里短线、长线各一局：进书 1 条，不是 2 条
  const c = make();
  await c.ui.importInto("w", [GOOD("1. e4 e5"), GOOD("1. e4 e5 2. Nf3")].join("\n"), "");
  assert(c.toasts.some(([m]) => m === "rep.added:1,1"), "进书 1 条（1 条已经在里面了）", JSON.stringify(c.toasts));
  assert(!c.toasts.some(([m]) => m.startsWith("rep.dropped")), "……不弹「上限」", JSON.stringify(c.toasts));

  // 7.5：导入改成分批读以后，读文件的这段时间里界面是活的。这时清空开局书
  // （clearBook 换上一个空对象），读完的文件不能再把线加回去 —— 否则「清空」被悄悄撤销
  const d = make();
  await d.ui.importInto("w", GOOD("1. e4 e5"), "");
  assert(d.ui.linesOf("w").length === 1, "清空之前书里有一条线");
  const pending = d.ui.importInto("w", GOOD("1. d4 d5 2. c4"), "");
  d.store.session.repertoire = { w: [], b: [] };
  await pending;
  assert(d.ui.linesOf("w").length === 0, "读文件时书被清空了，读完的文件不再往里加线",
    JSON.stringify(d.ui.linesOf("w").map((l) => l.id)));
}

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log("\nall repertoire tests passed");
