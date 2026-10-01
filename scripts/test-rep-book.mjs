/**
 * 你的开局书，按局面（v8-1-plan T3）：src/web/js/rep-book.js 的纯函数。
 *
 *   1. 按局面存：换序走到同一局面合并成一条记录，局面键 = ChessFide.positionKey。
 *   2. 开局浏览器的「我的」（explorer/core.js mineIndex）与开局书的记录逐着一致。
 *   3. 按单着排期：固定时钟，到期和不到期逐条核对。
 *   4. 导出 / 导入 PGN（带变着）往返逐节点相等。
 *   5. 老的 repertoire 存档（6.x–8.0 的形状）无损迁移；进度带到新卡片上。
 *   6. 从开局书里拿掉一着；棋谱库反推。
 *   7. 启动：本机分片一时读不出来、只写了分片的会话。
 *   8. v8-2-plan T4：线搬进开局书自己的数据库（rep-lines.js）——上限、行的
 *      往返、头上的 400 条副本、老版本改动叠回、8.1 档案升级、降级、没有
 *      IndexedDB、分片与导入全部数据。
 *
 * 跑：node scripts/test-rep-book.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console, Date, Math, JSON, structuredClone };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const f of ["chess.js", "fide.js", "drills.js", "pgn-parser.js", "repertoire.js", "openings.js", "explorer/core.js", "rep-book.js", "rep-lines.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + f)), ctx, { filename: f });
}
const B = ctx.ChessRepBook;
const R = ctx.ChessRepertoire;
const P = ctx.ChessPgnParser;
const X = ctx.ChessExplorer;
const { Chess } = ctx;
const keyAfter = (sans) => { const g = new Chess(); for (const s of sans.split(" ").filter(Boolean)) g.move(s); return ctx.ChessFide.positionKey(g.fen(), g); };

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};
const book = (w, b) => ({ w: R.addLines([], w || [], null).lines, b: R.addLines([], b || [], null).lines });

// --- 1. 按局面存，换序合并 ----------------------------------------------------
{
  const bk = book(["e4 e5 Nf3 Nc6 Bb5 a6", "Nf3 Nc6 e4 e5 Bc4 Bc5"]);
  const recs = B.indexBook(bk);
  const at = recs.get("w|" + keyAfter("e4 e5 Nf3 Nc6"));
  assert(at && at.moves.map((m) => m.san).join() === "Bb5,Bc4", "两种着法顺序走到同一局面，一条记录、两着合并", at && JSON.stringify(at.moves));
  assert(at.path === "e4 e5 Nf3 Nc6", "记录记下第一条走到它的着法顺序", at.path);
  assert(at.key === keyAfter("e4 e5 Nf3 Nc6"), "局面键就是 ChessFide.positionKey");
  const mine = [...recs.values()].filter((r) => r.card);
  assert(mine.length && mine.every((r) => r.key.split(" ")[1] === "w"), "只有轮到我方（执白）走的局面是卡片");
  assert([...recs.values()].filter((r) => !r.card).every((r) => r.key.split(" ")[1] === "b"), "对方走的局面是预期应着，不出题");
  // en passant：只有真能吃的时候键里才带吃过路兵格，所以 1. e4 … 与换序同键
  const ep = B.indexBook(book(["e4 d5 e5 f5", "e4 f5 e5 d5"]));
  const k = keyAfter("e4 d5 e5 f5");
  assert(k.split(" ")[3] === "f6" && ep.get("w|" + k) === undefined && ep.size === 6, "能吃过路兵的局面键带 f6；叶子局面没有着法、不存", String(ep.size));
  // 7.2 读进来的「从残局出发」那种线：能走的前缀进索引，线本身原样留着
  const bad = B.indexLines("w", [{ id: "rep-x", sans: "Rd8 Rb1 Rd2" }, { id: "rep-y", sans: "d4 d5 c4" }]);
  assert(bad.size === 3 && [...bad.values()].every((r) => r.moves.every((m) => m.san !== "Rd8")), "走不通的线不产生记录，别的线照常", String(bad.size));
}

// --- 2. 开局浏览器的「我的」与开局书逐着一致 ------------------------------------
{
  // 内置书的 195 条线当执白书，同一批的前 80 条当执黑书：上千个局面、大量换序
  const lines = ctx.CHESS_OPENINGS.map((r) => r[2]);
  const bk = book(lines, lines.slice(0, 80));
  const recs = B.indexBook(bk);
  let checked = 0, bad = [];
  for (const side of ["w", "b"]) {
    const marks = X.mineIndex(bk[side]);
    const keys = new Set([...marks.keys()].concat([...recs.values()].filter((r) => r.side === side).map((r) => r.key)));
    for (const key of keys) {
      const a = [...(marks.get(key) || [])].sort().join();
      const b = [...B.movesAt(recs, key, side)].sort().join();
      checked++;
      if (a !== b) bad.push(side + " " + key + ": " + a + " / " + b);
    }
  }
  assert(checked > 1000 && !bad.length, `「我的」标记与开局书记录逐局面逐着相同（${checked} 个局面）`, bad.slice(0, 3).join(" | "));
  // rowsAt：有对局的行标「我的」；一局都没有的我的着法也列出来（n = 0）
  const g = new Chess();
  const mine = B.movesAt(recs, keyAfter(""), "w");
  const rows = X.rowsAt([{ san: "e4", n: 3, w: 1, d: 1, b: 1 }, { san: "a3", n: 1, w: 0, d: 0, b: 1 }], g, new Set(["e4", "d4"]), mine);
  const e4 = rows.find((r) => r.san === "e4");
  assert(e4.mine && e4.book && !rows.find((r) => r.san === "a3").mine, "有对局的行：e4 既是书也是我的，a3 两样都不是");
  const extra = rows.filter((r) => r.n === 0).map((r) => r.san).sort();
  assert(extra.length === [...mine].filter((s) => s !== "e4").length && extra.every((s) => mine.has(s)),
    "我的书里有、却一局都没有的着法也列出来", extra.join());
  assert(rows.every((r) => r.mine === mine.has(r.san)), "每一行的「我的」都等于开局书在这个局面的着法");
}

// --- 3. 按单着排期：固定时钟 ---------------------------------------------------
{
  const T0 = Date.UTC(2026, 8, 1, 8, 0, 0);
  const D = B.DAY;
  let c = B.newCard();
  assert(B.isDue(c, T0), "新卡片立即到期");
  const want = [1, 3, 7, 21, 60, 180, 180];
  let now = T0;
  const got = [];
  for (let i = 0; i < want.length; i++) {
    c = B.grade(c, true, now);
    got.push(c.ivl);
    assert(!B.isDue(c, now + c.ivl * D - 1), `第 ${i + 1} 次答对后：${c.ivl} 天减 1 ms 还不到期`);
    assert(B.isDue(c, now + c.ivl * D), `……${c.ivl} 天整到期`);
    now += c.ivl * D;
  }
  assert(got.join() === want.join(), "间隔阶梯 1 → 3 → 7 → 21 → 60 → 180，之后停在 180", got.join());
  const miss = B.grade(c, false, now);
  assert(miss.s === 0 && miss.due === now && B.isDue(miss, now), "答错：连对归零、立刻到期");
  assert(B.grade(miss, true, now).due === now + D, "答错之后再答对，从 1 天重新爬");

  // 一本书、三十天：每天只练到期的，逐条核对哪几张到期
  const bk = book(["e4 e5 Nf3 Nc6 Bb5", "e4 c5 Nf3 d6 d4"], ["e4 e5 Nf3 Nc6", "d4 d5 c4 e6"]);
  const recs = B.indexBook(bk);
  const all = [...recs.values()].filter((r) => r.card);
  assert(B.dueCards(recs, T0).length === all.length, "开始时每张卡都到期（" + all.length + "）");
  assert(B.dueCards(recs, T0, "b").every((r) => r.side === "b"), "按执子方筛");
  const first = B.dueCards(recs, T0);
  assert(first[0].path === "" && first[1].path.split(" ").length <= first[first.length - 1].path.split(" ").length,
    "同一天到期：浅的局面先问", first.map((r) => r.path).join(" / "));
  // 第 0 天：第一张答错，其余答对；之后每天把到期的都答对
  first.forEach((r, i) => { r.card = B.grade(r.card, i !== 0, T0); });
  const plan = [0];
  for (let day = 1; day <= 30; day++) {
    const t = T0 + day * D;
    const due = B.dueCards(recs, t).map((r) => r.id);
    plan.push(due.length);
    // 手算：每张卡到期 ⇔ card.due ≤ t
    const expect = all.filter((r) => r.card.due <= t).map((r) => r.id).sort();
    if (due.slice().sort().join() !== expect.join()) { failed++; console.error("FAIL day " + day, due, expect); }
    for (const r of B.dueCards(recs, t)) r.card = B.grade(r.card, true, t);
  }
  const n = all.length;
  // 答对的：第 1 天（1）、第 4 天（+3）、第 11 天（+7）；答错的那张晚一天：第 1、2、5、12 天
  const expect = new Array(31).fill(0);
  for (const d of [1, 4, 11]) expect[d] += n - 1;
  for (const d of [1, 2, 5, 12]) expect[d] += 1;
  assert(plan.join() === expect.join(), "三十天里每天到期几张，和手算的一张不差（答错那张比别的晚一天爬梯）", plan.join() + " / " + expect.join());
  console.log("     三十天每天到期的张数：" + plan.join(" "));

  // M3 评审：一天至多 DAILY 张，其余按原来的先后排到后面几天
  const many = [];
  for (let i = 0; i < 45; i++) many.push({ id: "w|k" + i, side: "w", key: "k" + i, path: "", moves: [{ san: "e4", to: "x" }], card: B.newCard() });
  const d0 = B.dose(many, T0);
  const dueOn = (k) => many.filter((r) => r.card.due > T0 + (k - 1) * D && r.card.due <= T0 + k * D).length;
  assert(B.DAILY === 20 && d0.today.length === 20 && d0.moved.length === 25 && dueOn(1) === 20 && dueOn(2) === 5,
    "45 张新卡：今天 20 张，明天 20 张，后天 5 张", JSON.stringify({ today: d0.today.length, moved: d0.moved.length, d1: dueOn(1), d2: dueOn(2) }));
  assert(B.dose(many, T0).moved.length === 0 && B.dose(many, T0).today.length === 20, "同一天再算一次：不再挪动，还是那 20 张");
  // 迁移时背过的线：带进度的卡同样一天 DAILY 张，不是全在明天
  const wl = R.addLines([], ctx.CHESS_OPENINGS.map((r) => r[2]), null).lines;
  const srecs = B.indexBook({ w: wl, b: [] });
  const solvedAll = {}; for (const l of wl) solvedAll[l.id] = 1;
  const seeded = B.seedCards(srecs, { w: wl, b: [] }, { solved: solvedAll, missed: {} }, T0);
  const perDay = {};
  for (const r of srecs.values()) if (r.card && r.card.s === 1) { const k = Math.round((r.card.due - T0) / D); perDay[k] = (perDay[k] || 0) + 1; }
  assert(seeded > 40 && Object.values(perDay).every((x) => x <= B.DAILY) && perDay[1] === B.DAILY,
    `迁移播种 ${seeded} 张：从明天起一天至多 ${B.DAILY} 张`, JSON.stringify(perDay).slice(0, 120));
}

// --- 4. PGN 往返逐节点相等 ------------------------------------------------------
{
  const node = (recs) => [...recs.values()].map((r) => r.id + " " + r.moves.map((m) => m.san + ">" + m.to).join(",")).sort().join("\n");
  const roundTrip = (bk) => {
    const recs = B.indexBook(bk);
    const text = B.toPgn(recs, "w", "White") + "\n" + B.toPgn(recs, "b", "Black");
    const games = P.parsePgn(text).games;
    const back = { w: [], b: [] };
    for (const g of games) {
      const side = B.taggedSide(g);
      back[side] = R.addLines(back[side], R.linesFrom([g], true).lines, null).lines;
    }
    return { recs, text, again: B.indexBook(back) };
  };
  // 变着、换序、重复局面（回到起始局面）、两方的书
  const bk = book(
    ["e4 e5 Nf3 Nc6 Bb5 a6 Ba4", "e4 e5 Nf3 Nc6 Bb5 Nf6", "e4 c5 Nf3 d6 d4 cxd4 Nxd4", "Nf3 Nc6 e4 e5 Bc4", "Nf3 Nf6 Ng1 Ng8 d4"],
    ["e4 e5 Nf3 Nc6 Bb5 a6", "d4 Nf6 c4 e6 Nc3 Bb4", "c4 e5 Nc3 Nf6", "Nf3 d5 d4 Nf6"]);
  const r1 = roundTrip(bk);
  assert(/\(/.test(r1.text) && /\[RepSide "b"\]/.test(r1.text), "导出的 PGN 带变着，每方一局，标着是谁的书");
  assert(node(r1.recs) === node(r1.again), `往返之后逐节点相等（${r1.recs.size} 个节点，每个节点的着法与去向）`,
    node(r1.recs).split("\n").length + " vs " + node(r1.again).split("\n").length);
  const order = (recs) => [...recs.values()].map((r) => r.id + ":" + r.moves.map((m) => m.san).join(",")).sort().join("|");
  assert(order(r1.recs) === order(r1.again), "每个节点里着法的先后也不变（主线在前）");
  // 大书：内置书 195 条当执白、前 60 条当执黑
  const lines = ctx.CHESS_OPENINGS.map((r) => r[2]);
  const r2 = roundTrip(book(lines, lines.slice(0, 60)));
  assert(node(r2.recs) === node(r2.again) && order(r2.recs) === order(r2.again), `195 条线的大书往返逐节点相等（${r2.recs.size} 个节点）`);
  // 再导出一次，文字一字不差
  const text2 = B.toPgn(r2.again, "w", "White") + "\n" + B.toPgn(r2.again, "b", "Black");
  assert(text2 === r2.text, "导回的书再导出，PGN 一字不差");
  assert(B.toPgn(B.indexBook(book([], [])), "w") === "", "空书导出空串");
}

// --- 5. 老存档迁移（6.x–8.0 的形状）----------------------------------------------
{
  const T0 = Date.UTC(2026, 8, 30);
  // 6.x：没有开局书这个键
  const r6 = B.reconcile({ book: { w: [], b: [] }, header: null, stored: [], state: { solved: {}, missed: {} }, now: T0 });
  assert(r6.records.size === 0 && !r6.put.length && r6.migrating, "6.x：没有书，迁移不产生任何记录");
  // 7.2：线没有名字，还混着一条「从残局出发」的线（7.2 当时照收）
  const v72 = { v: 1, w: [
    { id: "rep-" + ctx.ChessDrills.hash36("e4 e5 Nf3 Nc6 Bc4"), sans: "e4 e5 Nf3 Nc6 Bc4", eco: "", name: "" },
    { id: "rep-" + ctx.ChessDrills.hash36("Rd8 Rb1 Rd2"), sans: "Rd8 Rb1 Rd2", eco: "", name: "" },
  ], b: [] };
  // 7.4–8.0：有 ECO 名字，两方都有；换序
  const v80 = { v: 1, w: [
    { id: "rep-" + ctx.ChessDrills.hash36("e4 e5 Nf3 Nc6 Bb5 a6"), sans: "e4 e5 Nf3 Nc6 Bb5 a6", eco: "C68", name: "Ruy Lopez: Morphy Defense" },
    { id: "rep-" + ctx.ChessDrills.hash36("Nf3 Nc6 e4 e5 Bc4"), sans: "Nf3 Nc6 e4 e5 Bc4", eco: "C50", name: "Italian Game" },
  ], b: [
    { id: "rep-" + ctx.ChessDrills.hash36("d4 Nf6 c4 e6"), sans: "d4 Nf6 c4 e6", eco: "E00", name: "Indian Defense" },
  ] };
  for (const [tag, v1, solved] of [["7.2", v72, [v72.w[0].id]], ["8.0", v80, [v80.w[0].id, v80.b[0].id + ":b"]]]) {
    const before = JSON.stringify(v1);
    const state = { solved: Object.fromEntries(solved.map((id) => [id, true])), missed: {} };
    const r = B.reconcile({ book: { w: v1.w, b: v1.b }, header: v1, stored: [], state, now: T0 });
    assert(JSON.stringify(v1) === before, `${tag}：迁移不改线本身（旧版本照读、按线练的进度照挂）`);
    // 无损：每条线能走的每一着，都在它那一方的记录里
    let edges = 0, miss = [];
    for (const side of ["w", "b"]) for (const l of v1[side]) {
      const g = new Chess();
      for (const san of l.sans.split(" ")) {
        const key = ctx.ChessFide.positionKey(g.fen(), g);
        if (!g.move(san)) break;
        edges++;
        if (!B.movesAt(r.records, key, side).has(san)) miss.push(side + " " + san);
      }
    }
    assert(edges > 0 && !miss.length, `${tag}：${edges} 着全部进了按局面的记录`, miss.join());
    assert(r.put.length === r.records.size && !r.gone.length, `${tag}：第一次迁移把每条记录都写进去（${r.put.length}）`);
    const seededCards = [...r.records.values()].filter((x) => x.card && x.card.s === 1);
    assert(r.seeded > 0 && r.seeded === seededCards.length && seededCards.every((x) => x.card.due === T0 + B.DAY),
      `${tag}：背下来的线，它上面的卡从第一级开始、一天后到期（${r.seeded} 张）`);
    // 迁移第二遍（旧版本又写了一次头）：卡片原样带过来，不再重播种
    const again = B.reconcile({ book: { w: v1.w, b: v1.b }, header: v1, stored: [...r.records.values()], state, now: T0 + 5 * B.DAY });
    assert(!again.put.length && !again.gone.length && again.seeded === 0, `${tag}：再迁一次什么都不写、不重播种`);
    // 迁移完的头：db 2、同样的签名与记录数 —— 直接信任
    const header = Object.assign({}, v1, { db: 2, n: r.records.size, sig: B.sigOf({ w: v1.w, b: v1.b }) });
    const fast = B.reconcile({ book: { w: v1.w, b: v1.b }, header, stored: [...r.records.values()], state, now: T0 });
    assert(fast.fresh && fast.records.size === r.records.size, `${tag}：头对得上时直接用存着的记录`);
    // 浏览器存储丢了记录，本机存档的分片还在：卡片找回来
    const graded = [...r.records.values()].map((x) => (x.card ? Object.assign({}, x, { card: { s: 3, n: 3, due: T0 + 7 * B.DAY, ivl: 7 } }) : x));
    const lost = B.reconcile({ book: { w: v1.w, b: v1.b }, header, stored: [], shards: graded, state, now: T0 });
    assert(lost.recovered === graded.length && [...lost.records.values()].filter((x) => x.card).every((x) => x.card.s === 3),
      `${tag}：记录丢了，从分片找回 ${lost.recovered} 条，复习进度一张不少`);
  }
}

// --- 6. 拿掉一着；棋谱库反推 ----------------------------------------------------
{
  const w = book(["e4 e5 Nf3 Nc6 Bb5 a6", "Nf3 Nc6 e4 e5 Bb5 Nf6", "e4 e5 Nf3 Nc6 Bc4", "d4 d5 c4"]).w;
  const key = keyAfter("e4 e5 Nf3 Nc6");
  const r = B.removeMove(R, w, key, "Bb5");
  const sans = r.lines.map((l) => l.sans).sort();
  assert(JSON.stringify(sans) === JSON.stringify(["Nf3 Nc6 e4 e5", "d4 d5 c4", "e4 e5 Nf3 Nc6 Bc4"]),
    "拿掉 Bb5：两种着法顺序里的 Bb5 都没了，截下来的前缀被更长的线盖住就不单留", JSON.stringify(sans));
  const keep = w.find((l) => l.sans === "d4 d5 c4");
  assert(r.lines.find((l) => l.sans === "d4 d5 c4").id === keep.id && r.gone.length === 2,
    "没经过这一着的线 id 不变，进度照挂；离开的两条 id 报出来", r.gone.join());
  const recs = B.indexLines("w", r.lines);
  assert(!B.movesAt(recs, key, "w").has("Bb5") && B.movesAt(recs, key, "w").has("Bc4"), "按局面看：这个局面只剩 Bc4");
  assert(B.removeMove(R, w, key, "Qh5") === null, "书里本来就没有的着法，拿不掉，也不动书");
  // M3 评审 P2-2：拿掉之前说得出这一下有多大——几条线受影响、几条整条删掉
  assert(r.cut === 2 && r.whole === 0, "拿掉 Bb5：两条线截短，没有整条删掉", JSON.stringify({ cut: r.cut, whole: r.whole }));
  const root = B.removeMove(R, w, B.START_KEY, "e4");
  assert(root.whole === 2 && root.cut === 2 && root.lines.length === 2,
    "在起始局面拿掉 e4：经过它的两条线整条删掉（换序那条从 Nf3 开始，不经过这一着）", JSON.stringify({ cut: root.cut, whole: root.whole, n: root.lines.length }));
  // 执黑的书截在第一个半着之后只剩白方的一着——那不是一条黑方的线，整条删掉
  const bl = book([], ["e4 e5 Nf3 Nc6", "d4 d5 c4 e6"]).b;
  const cutB = B.removeMove(R, bl, keyAfter("e4"), "e5", "b");
  assert(cutB.lines.map((l) => l.sans).join() === "d4 d5 c4 e6" && cutB.whole === 1,
    "执黑拿掉 1…e5：不留下只有 1. e4 的一条「线」", JSON.stringify(cutB.lines.map((l) => l.sans)));

  // 棋谱库反推：你执白走到这个局面 5 局里 4 局走 Bc4，书里写的是 Bb5
  const bk = book(["e4 e5 Nf3 Nc6 Bb5 a6", "d4 d5 c4 e6 Nc3"]);
  const all = B.indexBook(bk);
  const hits = { [keyAfter("e4 e5 Nf3 Nc6")]: [{ san: "Bc4", n: 4 }, { san: "Bb5", n: 1 }],
    [keyAfter("d4 d5")]: [{ san: "c4", n: 6 }, { san: "Nf3", n: 5 }],
    [keyAfter("e4 e5")]: [{ san: "Nc3", n: 1 }] };
  const rows = B.crossCheck(all, (x) => hits[x.key] || null);
  assert(rows.length === 1 && rows[0].usual === "Bc4" && rows[0].n === 4 && rows[0].of === 5 && rows[0].book.join() === "Bb5",
    "你常走 Bc4（5 局里 4 局），书写的是 Bb5 —— 只报这一处", JSON.stringify(rows));
  assert(B.pathText(rows[0].path) === "1. e4 e5 2. Nf3 Nc6", "局面按着法写出来", B.pathText(rows[0].path));
  const tie = B.crossCheck(all, (x) => (x.key === keyAfter("e4 e5 Nf3 Nc6") ? [{ san: "Bc4", n: 2 }, { san: "Bb5", n: 2 }] : null));
  assert(!tie.length, "和书上的着一样多，不算「常走」");
}

// --- 7. 启动（rep-page.js）：本机分片一时读不出来、只写了分片的会话（M3 评审） ----------------
{
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/rep-page.js")), ctx, { filename: "rep-page.js" });
  const boot = ctx.CHESS_REP.bootRepertoire;
  const bk = book(["e4 e5 Nf3 Nc6 Bb5", "d4 d5 c4"], ["e4 c5 Nf3 d6"]);
  const full = B.indexBook(bk);
  const graded = [...full.values()].map((x) => (x.card ? Object.assign({}, x, { card: { s: 3, n: 3, due: 1, ivl: 7 } }) : x));
  const shardTexts = {};
  for (const x of graded) { const n = B.shardOf(x.id); (shardTexts[n] = shardTexts[n] || []).push(x); }
  for (const n of Object.keys(shardTexts)) shardTexts[n] = JSON.stringify({ v: 1, rep: shardTexts[n] });
  // rep-db.js's interface over Maps — the records, and since v8-2-plan T4 the lines
  const idb = (rows, gen, lineRows) => {
    const m = new Map(rows.map((x) => [x.id, JSON.parse(JSON.stringify(x))]));
    const ls = new Map((lineRows || []).map((x) => [x.k, JSON.parse(JSON.stringify(x))]));
    const cs = new Map();
    const meta = new Map(gen ? [["rep-gen", gen]] : []);
    return { m, ls, cs, meta, puts: 0, lineWrites: 0,
      async all() { return [...m.values()].map((x) => JSON.parse(JSON.stringify(x))); },
      async put(rs) { this.puts++; for (const x of rs) m.set(x.id, JSON.parse(JSON.stringify(x))); return true; },
      async remove(ids) { for (const id of ids) m.delete(id); return true; },
      async lines() { return [...ls.values()].map((x) => JSON.parse(JSON.stringify(x))); },
      async putLines(rs, gone) { this.lineWrites++; for (const k of gone) ls.delete(k); for (const x of rs) ls.set(x.k, JSON.parse(JSON.stringify(x))); return true; },
      async cards() { return [...cs.values()].map((x) => JSON.parse(JSON.stringify(x))); },
      async putCards(rs, gone) { for (const k of gone) cs.delete(k); for (const x of rs) cs.set(x.id, JSON.parse(JSON.stringify(x))); return true; },
      async clear() { m.clear(); ls.clear(); cs.clear(); return true; },
      async getMeta(k) { return meta.get(k); },
      async setMeta(k, v) { meta.set(k, v); return true; } };
  };
  const run = async (header, backend, texts) => {
    const touched = [];
    const Persist = { get: () => JSON.stringify(Object.assign({ v: 1 }, bk, header)), readBulk: async () => texts,
      hasStore: () => true, touchBulk: (n) => touched.push(...n), touchUnlisted: (n) => touched.push(...n) };
    const store = { session: { repertoire: { w: bk.w, b: bk.b }, puzzleState: { solved: {}, missed: {} } } };
    const c = await boot({ store, Persist, t: (k) => k, tf: (k) => k, toast: () => {}, doc: null, R, libDb: null, repBackend: backend,
      LibraryQuery: null, cardName: () => "", onChange: () => {} });
    return { c, touched };
  };
  const head = { db: 2, n: full.size, sig: B.sigOf(bk), gen: 500 };
  // IndexedDB lost the records; the native store is there but this read failed
  const lost = idb([], 500);
  const h1 = await run(head, lost, null);
  const ex = h1.c.extra();
  assert(h1.c.held() && !h1.touched.length && lost.puts === 0 && h1.c.shardNames() === null,
    "分片一时读不出来：这次什么也不写（不写记录、不碰分片）", JSON.stringify({ held: h1.c.held(), touched: h1.touched, puts: lost.puts }));
  assert(ex.db === 2 && ex.n === head.n && ex.sig === head.sig && ex.gen === 500, "……头照原样担保，下次启动再读分片", JSON.stringify(ex));
  const h1b = await run(head, idb([], 500), shardTexts);
  assert(!h1b.c.held() && [...h1b.c.records().values()].filter((x) => x.card).every((x) => x.card.s === 3), "下次读得出来：卡片从分片找回");
  // a session with no IndexedDB graded into the shards only (header gen 900 > IndexedDB's 500)
  const stale = idb([...full.values()], 500);
  const h2 = await run(Object.assign({}, head, { gen: 900 }), stale, shardTexts);
  const cards = [...h2.c.records().values()].filter((x) => x.card);
  assert(cards.length && cards.every((x) => x.card.s === 3), "只写了分片的那次会话更新：它的卡片胜过 IndexedDB 里旧的", JSON.stringify(cards.map((x) => x.card.s)));
  assert([...stale.m.values()].filter((x) => x.card).every((x) => x.card.s === 3) && stale.meta.get("rep-gen") > 900,
    "……写回 IndexedDB，代数跟着往前走");
  const same = idb([...full.values()], 900);
  const h3 = await run(Object.assign({}, head, { gen: 900 }), same, shardTexts);
  assert(same.puts === 0 && [...h3.c.records().values()].filter((x) => x.card).every((x) => x.card.s === 0), "代数一样：直接用 IndexedDB 的记录，不读分片");
  // 学习数据带来的卡片：阶梯更远的那张胜出；书里没有的局面不收
  const withCard = [...h3.c.records().values()].filter((x) => x.card);
  const incoming = { [withCard[0].id]: { s: 4, n: 4, due: 7, ivl: 21 }, [withCard[1].id]: { s: 0, n: 0, due: 0, ivl: 0 }, "w|nowhere": { s: 5, n: 5, due: 1, ivl: 60 } };
  withCard[1].card = { s: 2, n: 2, due: 5, ivl: 3 };
  const took = h3.c.takeCards(incoming);
  assert(took === 1 && h3.c.records().get(withCard[0].id).card.s === 4 && h3.c.records().get(withCard[1].id).card.s === 2 && !h3.c.records().has("w|nowhere"),
    "学习数据里的卡片：更远的一张进来，更近的不覆盖，书里没有的局面不收", String(took));

  // --- 8. v8-2-plan T4：线搬进开局书自己的数据库，去掉 400 条上限 ----------------------
  const L = ctx.ChessRepLines;
  assert(R.MAX_LINES === 5000 && L.HEAD === 400, "上限 5000 条一方（只是护栏）；头上留每方前 400 条", R.MAX_LINES + " / " + L.HEAD);
  // 1000 条执白线、3 条执黑线（走不通的着法只截断记录，不影响线的存储）
  const many = book(Array.from({ length: 1000 }, (_, i) => "e4 e5 Nf3 L" + i), ["e4 c5 Nf3 d6", "d4 Nf6 c4 e6", "Nf3 d5 g3 Nf6"]);
  assert(many.w.length === 1000, "一次加 1000 条，一条不丢（8.1 会只留最后 400 条）", String(many.w.length));
  // 行：往返、顺序、改名、删一条后面的挪位置
  const rows0 = L.diff(new Map(), many).put;
  const back = L.bookOf(rows0);
  assert(rows0.length === 1003 && JSON.stringify(back) === JSON.stringify(many), "行 ↔ 线往返一字不差（两本书、各自的先后）");
  const m0 = L.mapOf(rows0);
  assert(!L.diff(m0, many).put.length && !L.diff(m0, many).gone.length, "没变就什么也不写");
  const renamed = { w: many.w.map((l, i) => (i === 5 ? Object.assign({}, l, { eco: "C20", name: "King's Pawn" }) : l)), b: many.b };
  const dr = L.diff(m0, renamed);
  assert(dr.put.length === 1 && dr.put[0].eco === "C20" && !dr.gone.length, "补上名字：只写那一行");
  const cut = { w: many.w.filter((_, i) => i !== 997), b: many.b };
  const dc = L.diff(m0, cut);
  assert(dc.gone.length === 1 && dc.gone[0] === "w:" + many.w[997].id && dc.put.length === 2, "拿掉一条：删它、后面两条挪位置", JSON.stringify({ gone: dc.gone.length, put: dc.put.length }));
  // 头上的副本：前 400 条
  const copy = L.headOf(many);
  assert(copy.w.length === 400 && copy.w[399].id === many.w[399].id && copy.b.length === 3, "头上的副本：执白前 400 条，执黑 3 条全在");
  // 老版本在副本上的改动叠回整本书
  const asIs = L.mergeHead(R, many, copy);
  assert(asIs.book.w === many.w && !asIs.gone.length, "头就是副本：整本书原样");
  const edited = { w: copy.w.filter((l) => l.id !== many.w[10].id).concat(R.addLines([], ["d4 d5 c4"], null).lines), b: copy.b };
  const mg = L.mergeHead(R, many, edited);
  assert(mg.book.w.length === 1000 && !mg.book.w.some((l) => l.id === many.w[10].id) && mg.book.w.some((l) => l.sans === "d4 d5 c4") &&
    mg.book.w.some((l) => l.id === many.w[999].id) && JSON.stringify(mg.gone) === JSON.stringify([many.w[10].id]),
    "老版本拿掉一条、加了一条：照做；副本以外的 600 条都在", JSON.stringify({ n: mg.book.w.length, gone: mg.gone }));
  const deeper = { w: copy.w.map((l, i) => (i === 0 ? R.addLines([], ["e4 e5 Nf3 L0 x"], null).lines[0] : l)), b: copy.b };
  const md = L.mergeHead(R, many, deeper);
  assert(md.book.w.length === 1000 && md.book.w.some((l) => l.sans === "e4 e5 Nf3 L0 x") && !md.book.w.some((l) => l.sans === "e4 e5 Nf3 L0"),
    "老版本把一条线走深：深的那条接替浅的");
  const emptied = L.mergeHead(R, many, { w: [], b: copy.b });
  assert(!emptied.book.w.length && emptied.book.b === many.b && emptied.gone.length === 1000, "老版本把执白清空：整本执白书清空（不只清副本那 400 条）");
  // 启动时选哪份线
  const head8 = { db: 2, ln: 1003 };
  const pk = (o) => L.pick(R, Object.assign({ header: head8, head: copy, stored: [], shards: [] }, o));
  assert(pk({ stored: rows0 }).from === "idb" && pk({ stored: rows0 }).book.w.length === 1000, "IndexedDB 有线：用它（头叠在上面）");
  assert(pk({ shards: rows0 }).from === "shards", "IndexedDB 没有、分片有：用分片");
  assert(pk({ stored: L.diff(new Map(), cut).put, shards: rows0, newer: true }).book.w.length === 1000, "只写了分片的会话更新（newer）：用分片");
  const ph = pk({});
  assert(ph.from === "head" && ph.short && ph.book.w.length === 400, "哪里都没有：只能用头上的 400 条，并且知道缺了（short）");
  assert(L.pick(R, { header: { v: 1 }, head: copy, stored: [], shards: [] }).short === false, "8.1 / 8.0 的头（没有 ln）：头就是整本书");
  const lfp = L.pick(R, { header: { lf: 1 }, head: cut, stored: rows0, shards: [] });
  assert(lfp.from === "head" && lfp.book === cut, "没有 IndexedDB 的会话把整本书写在头上（lf）：以头为准，不叠旧的 IndexedDB");

  // 启动（rep-page.js）：真的 boot，假的 IndexedDB / 本机存储
  const boot2 = async (o) => {
    const touched = [], set = [];
    const hdr = o.header ? JSON.stringify(o.header) : null;
    const Persist = { get: () => hdr, readBulk: async () => o.texts, hasStore: () => !!o.hasStore,
      touchBulk: (n) => touched.push(...n), touchUnlisted: (n) => touched.push(...n) };
    const lines = o.header ? { w: o.header.w || [], b: o.header.b || [] } : { w: [], b: [] };
    const store = { session: { repertoire: { w: lines.w, b: lines.b }, puzzleState: { solved: o.solved || {}, missed: {} } } };
    const forgot = [];
    const c = await boot({ store, Persist, t: (k) => k, tf: (k) => k, toast: () => {}, doc: null, R, libDb: null, repBackend: o.backend,
      LibraryQuery: null, cardName: () => "", onChange: () => {}, forget: (ids) => forgot.push(...ids) });
    await new Promise((r) => setTimeout(r, 0));
    return { c, touched, set, store, forgot };
  };
  // 8.1 的档案：头上 ≤ 400 条（带 db 2），IndexedDB 是版本 1 的记录、没有线
  const book81 = book(Array.from({ length: 120 }, (_, i) => "d4 d5 c4 M" + i).concat(["e4 e5 Nf3 Nc6 Bb5 a6"]), ["e4 c5 Nf3 d6"]);
  const rec81 = B.indexBook(book81);
  for (const x of rec81.values()) if (x.card) x.card = { s: 2, n: 2, due: 77, ivl: 3 };
  const head81 = Object.assign({ v: 1 }, book81, { db: 2, n: rec81.size, sig: B.sigOf(book81), gen: 600 });
  const db81 = idb([...rec81.values()], 600);
  const u = await boot2({ header: head81, backend: db81 });
  const h81 = u.c.head();
  await new Promise((r) => setTimeout(r, 0));
  assert(JSON.stringify(L.bookOf([...db81.ls.values()])) === JSON.stringify(book81), "8.1 升上来：线一条不少、按原来的先后进了 lines 表", String(db81.ls.size));
  assert([...u.c.records().values()].filter((x) => x.card).every((x) => x.card.s === 2 && x.card.due === 77) && u.c.records().size === rec81.size,
    "……按局面的记录与卡片原样（不重播种、不丢排期）");
  assert([...db81.meta.keys()].some((k) => k.startsWith("rep-v2:")) && db81.meta.get([...db81.meta.keys()].find((k) => k.startsWith("rep-v2:"))).raw === JSON.stringify(head81),
    "……迁移前的头原样备份在 meta 表（rep-v2:）");
  assert(JSON.stringify(h81.w) === JSON.stringify(book81.w) && JSON.stringify(h81.b) === JSON.stringify(book81.b) && h81.ln === 122 && h81.db === 2,
    "……头上的线一字不动（8.1 / 8.0 降级回去照读），多了 ln", JSON.stringify({ ln: h81.ln, w: h81.w.length }));
  // 这本书长到 1000 条以后：头上只留 400 条，降级的版本看到的是最早的那 400 条
  u.store.session.repertoire.w = R.addLines(u.store.session.repertoire.w, Array.from({ length: 900 }, (_, i) => "c4 e5 N" + i), null).lines;
  u.c.sync();
  const big = u.c.head();
  await new Promise((r) => setTimeout(r, 0));
  assert(big.w.length === 400 && big.ln === 1022 && JSON.stringify(big.w.slice(0, 121)) === JSON.stringify(book81.w),
    "1021 条执白线：头上前 400 条，原来那 121 条都在里面", JSON.stringify({ w: big.w.length, ln: big.ln }));
  assert(db81.ls.size === 1022 && JSON.stringify(u.c.bag(JSON.stringify(big)) && JSON.parse(u.c.bag(JSON.stringify(big))).w.length) === "1021",
    "lines 表里 1022 条；学习数据拿到的是整本书");
  // 分片带着线：导出全部数据 / 本机镜像
  const names = u.c.shardNames();
  const texts = Object.fromEntries(names.map((n) => [n, u.c.shardText(n)]));
  const shardRows = L.rowsOfShards(texts);
  assert(shardRows.length === 1022 && Object.values(texts).every((s) => Array.isArray(JSON.parse(s).rep)),
    "分片里有线（lines）也有记录（rep，8.1 照读）", String(shardRows.length));
  // 降级到 8.1：它只认头（400 条），拿掉一条、加一条、写回头（不带 ln）；回到 8.2，整本书叠上它的改动
  const h8 = JSON.parse(JSON.stringify(big));
  delete h8.ln;
  h8.w = h8.w.filter((l) => l.id !== book81.w[3].id).concat(R.addLines([], ["g3 d5 Bg2"], null).lines);
  const u2 = await boot2({ header: h8, backend: db81 });
  const w2 = u2.store.session.repertoire.w;
  assert(w2.length === 1021 && !w2.some((l) => l.id === book81.w[3].id) && w2.some((l) => l.sans === "g3 d5 Bg2") && w2.some((l) => l.sans === "c4 e5 N899"),
    "降级时的改动回来叠上：拿掉的那条没了、加的那条在，副本以外的 621 条都在", String(w2.length));
  assert(u2.forgot.includes(book81.w[3].id), "……拿掉的那条线的按线练进度跟着清掉");
  // 没有 IndexedDB 的会话（WebView 拒绝）：线从本机分片读回；头写整本（lf）
  const mem = await boot2({ header: big, backend: null, texts, hasStore: true });
  assert(mem.c.mode() === "memory" && mem.store.session.repertoire.w.length === 1021 && !mem.c.held(), "没有 IndexedDB：整本书从分片读回", String(mem.store.session.repertoire.w.length));
  const hm = mem.c.head();
  assert(hm.lf === 1 && hm.w.length === 1021 && !("ln" in hm), "……头上写整本书（lf），浏览器里不靠分片也不丢");
  // …下一次 IndexedDB 回来了：以那份整本的头为准
  const u3 = await boot2({ header: Object.assign({}, hm, { w: hm.w.slice(1) }), backend: db81 });
  const h3h = u3.c.head();
  assert(u3.store.session.repertoire.w.length === 1020 && h3h.ln === 1021 && !h3h.lf && h3h.w.length === 400, "IndexedDB 回来：以 lf 的头为准写回 lines 表，头又只留副本", JSON.stringify({ n: u3.store.session.repertoire.w.length, ln: h3h.ln, lf: h3h.lf }));
  // 没有 IndexedDB、分片也没有线：副本以外的线够不着——什么都不写，改动记在头上
  const ro = await boot2({ header: big, backend: null, texts: {}, hasStore: false });
  ro.store.session.repertoire.w = R.addLines(ro.store.session.repertoire.w, ["b3 e5 Bb2"], null).lines;
  const hr = ro.c.head();
  assert(ro.c.held() && !ro.touched.length && ro.store.session.repertoire.w.length === 401 && hr.ln === 1022 && hr.db === 2 && hr.w.length === 401,
    "没有 IndexedDB、也没有分片：用头上的 400 条，不写分片，头照旧说 ln（改动叠回去）", JSON.stringify({ held: ro.c.held(), n: hr.w.length, touched: ro.touched.length }));
  // 导入全部数据：分片里的线进 lines 表
  const fresh = idb([], 0);
  const u4 = await boot2({ header: null, backend: fresh });
  await u4.c.restoreShards(texts);
  assert(fresh.ls.size === 1022 && fresh.m.size === u.c.records().size, "导入全部数据：线和记录都从分片进库", JSON.stringify({ ls: fresh.ls.size, m: fresh.m.size }));
  // 降级到 8.1：它只按头上的 400 条重建记录，那之外的局面从 chessboard.repertoire 掉了——
  // 卡片从 chessboard.replines 的副本回来（rep-db.js：开局书的库不升版本，8.1 照常打开）
  const fat = book(Array.from({ length: 400 }, (_, i) => "e4 e5 Nf3 Q" + i).concat(["g4 d5 Bg2"]));
  const dbF = idb([], 0);
  const uF = await boot2({ header: Object.assign({ v: 1 }, fat), backend: dbF });
  const farId = "w|" + keyAfter("g4 d5");
  uF.c.grade({ card: farId }, true);
  const hF = uF.c.head();
  await new Promise((r) => setTimeout(r, 0));
  const gradedF = uF.c.records().get(farId).card;
  assert(gradedF.s === 1 && dbF.cs.get(farId) && dbF.cs.get(farId).card.due === gradedF.due && hF.w.length === 400 && hF.ln === 401,
    "第 401 条线上的一张卡答对了；卡片的副本在 replines", JSON.stringify(dbF.cs.get(farId)));
  const book400 = { w: hF.w, b: hF.b };
  const rec400 = B.indexBook(book400, new Map(dbF.m));
  const db81c = idb([...rec400.values()], 0, [...dbF.ls.values()]);
  for (const [k, v] of dbF.cs) db81c.cs.set(k, v);
  assert(!rec400.has(farId), "8.1 的索引里没有这个局面（它看不到第 401 条）");
  const uB = await boot2({ header: Object.assign({ v: 1 }, book400, { db: 2, n: rec400.size, sig: B.sigOf(book400), gen: 1 }), backend: db81c });
  const backF = uB.c.records().get(farId);
  assert(uB.store.session.repertoire.w.length === 401 && backF && backF.card.s === 1 && backF.card.due === gradedF.due,
    "回到 8.2：第 401 条线回来，那张卡的排期也回来", JSON.stringify(backF && backF.card));
}

if (failed) { console.error(`\n${failed} 项失败`); process.exit(1); }
console.log("\nall rep-book tests passed");
