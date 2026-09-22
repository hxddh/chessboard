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
  const lines = R.linesFrom(games);
  assert(lines.length === 2, "一份带一个变着的书，读出来是两条线", lines.length);
  assert(lines.includes("e4 e5 Nf3 Nc6 Bb5 a6"), "主线在", JSON.stringify(lines));
  assert(lines.includes("e4 c5 Nf3 d6 d4"), "变着也在 —— 棋谱库只留主线，这里正相反", JSON.stringify(lines));
  // 深度优先，主线先出来：书读起来要跟它写出来的顺序一样
  assert(lines[0] === "e4 e5 Nf3 Nc6 Bb5 a6", "主线排在前面", lines[0]);
}

// --- 同一份书导第二遍，不该变成两本 ----------------------------------------
{
  const fresh = R.linesFrom(P.parsePgn(PGN).games);
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
  // 被替掉的那条的 id 离开了这本书，所以它要出现在 dropped 里：挂在这个 id 上
  // 的复习债，调用方得跟着一起清掉（7.2 发布前复查提的第三条）
  assert(extended.dropped.length === 1 && extended.dropped[0] === shallow.lines[0].id,
    "被替掉的那条 id 报在 dropped 里 —— 否则它欠下的复习永远还不上",
    JSON.stringify(extended.dropped));
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
  const lines = R.linesFrom([{ root }]);
  assert(lines[0].split(" ").length === R.MAX_PLIES,
    `再长也只取前 ${R.MAX_PLIES} 个半着`, lines[0].split(" ").length);
  void long;
}

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log("\nall repertoire tests passed");
