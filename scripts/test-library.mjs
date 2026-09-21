/**
 * 棋谱库的模型层（src/web/js/library.js）。
 *
 * 纯函数，所以这里不需要浏览器也不需要引擎：喂进去解析好的棋局与分析数组，
 * 检查出来的诊断。跑：node scripts/test-library.mjs
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
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/library.js")), ctx, { filename: "library.js" });
const L = ctx.ChessLibrary;

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra ? "  " + extra : "")); }
};

const hdr = (o) => Object.entries(o);
const T0 = 1758000000000;

// --- id 稳定性：重复导入同一份存档不能把每一局都变成两局 --------------------
{
  const h = hdr({ Event: "Rated blitz", Site: "lichess", Date: "2026.09.01", Round: "-",
    White: "me", Black: "them", Result: "1-0" });
  const sans = ["e4", "e5", "Nf3"];
  assert(L.gameId(h, sans) === L.gameId(h, sans), "同样的棋局给出同样的 id");
  assert(L.gameId(h, sans) !== L.gameId(h, ["e4", "e5", "Nc3"]), "着法不同就是不同的棋局");
  assert(L.gameId(h, sans) !== L.gameId(hdr({ ...Object.fromEntries(h), Date: "2026.09.02" }), sans),
    "同样的着法、不同的日期，是不同的棋局");
}

// --- 认领：认不出来就不认，绝不猜 ------------------------------------------
{
  const h = hdr({ White: "Me", Black: "Them", Result: "1-0" });
  assert(L.sideOf(h, ["me"]) === "w", "按名字认出执白（大小写与空白无关）");
  assert(L.sideOf(h, ["  THEM "]) === "b", "……执黑同理");
  assert(L.sideOf(h, ["someone"]) === null, "两边都不是我，就不认领");
  assert(L.sideOf(h, []) === null, "没给名字，就不认领");
  assert(L.sideOf(hdr({ White: "me", Black: "me", Result: "1-0" }), ["me"]) === null,
    "两边都叫我（自己跟自己下）也不认领 —— 猜一边会污染后面每一个数字");
  assert(L.outcomeFor("1-0", "w") === "win" && L.outcomeFor("1-0", "b") === "loss" &&
    L.outcomeFor("1/2-1/2", "w") === "draw" && L.outcomeFor("*", "w") === null,
    "结果从自己这把椅子上读");
  assert(L.outcomeFor("1-0", null) === null, "没认领就没有胜负");
}

// --- 条目：把一局棋压成一条记录 --------------------------------------------
{
  const game = { headers: hdr({ White: "me", Black: "them", Result: "0-1", Date: "2026.09.01" }), result: "0-1" };
  const sans = ["e4", "e5", "Nf3", "Nc6"];
  const e = L.entryFrom(game, sans, ["me"], T0);
  assert(e.side === "w" && e.outcome === "loss", "认领与胜负一起算出来");
  assert(e.plies === 4 && e.sans === "e4 e5 Nf3 Nc6",
    "整局着法也存下来 —— 只存局数的话，诊断就只能给数字、给不出那局棋", e.sans);
  assert(e.an === null, "刚进库的局还没分析");
}

// --- 合并：重复导入是常态，不是例外 ----------------------------------------
{
  const mk = (id, t) => ({ id, t, plies: 20, side: "w", an: null });
  const a = L.addGames([], [mk("g1", T0), mk("g2", T0 + 1)]);
  assert(a.added === 2 && a.dup === 0, "第一次导入两局");
  const b = L.addGames(a.list, [mk("g1", T0 + 5), mk("g3", T0 + 6)]);
  assert(b.added === 1 && b.dup === 1, "再导一次：一局新的，一局重复");
  const kept = b.list.find((g) => g.id === "g1");
  assert(kept.t === T0, "重复的那局原样保留（连导入时间都不动）");

  // 重复的那局如果已经分析过，分析结果绝不能被重新导入冲掉 —— 那是几分钟引擎时间
  const withAn = L.addGames([{ id: "g1", t: T0, plies: 20, side: "w", an: { acc: { w: 70, b: 60 } } }],
    [mk("g1", T0 + 9)]);
  assert(withAn.list[0].an && withAn.list[0].an.acc.w === 70, "已分析的那局，重新导入不会把分析冲掉");

  // 上限：按导入时间淘汰最旧的
  const many = [];
  for (let i = 0; i < L.MAX_GAMES + 10; i++) many.push(mk("x" + i, T0 + i));
  const c = L.addGames([], many);
  assert(c.list.length === L.MAX_GAMES, `上限 ${L.MAX_GAMES} 局`);
  assert(c.dropped.length === 10 && c.dropped.includes("x0"), "……淘汰的是最早导入的那些");
  assert(c.list[0].id === "x" + (L.MAX_GAMES + 9), "……留下的按导入时间倒序，最新的在前");
}

// --- 待分析队列 -------------------------------------------------------------
{
  const list = [
    { id: "a", t: T0 + 2, plies: 30, an: null },
    { id: "b", t: T0 + 1, plies: 30, an: { acc: {} } },
    { id: "c", t: T0 + 3, plies: 30, an: null },
    { id: "d", t: T0, plies: 0, an: null },
  ];
  const q = L.pending(list).map((g) => g.id);
  assert(q.join() === "a,c", "只排还没分析过、且真的有着法的局（先导入的先分析）");
}

// --- 值得再深一遍的队列（7.2 A1）-------------------------------------------
{
  const list = [
    { id: "shallow", t: T0 + 2, plies: 30, an: { budget: 200 } },
    { id: "deep", t: T0 + 1, plies: 30, an: { budget: 400 } },
    { id: "older", t: T0, plies: 30, an: { budget: 200 } },
    { id: "nobudget", t: T0 + 3, plies: 30, an: {} },
    { id: "unanalysed", t: T0 + 4, plies: 30, an: null },
    { id: "broken", t: T0 + 5, plies: 30, an: { budget: 200 }, unplayable: true },
  ];
  const d = L.deepenable(list, 400).map((g) => g.id);
  assert(d.join() === "older,shallow,nobudget",
    "只排分析过、但预算比这次浅的局（先导入的先来）", d.join());
  assert(!L.deepenable(list, 400).some((g) => g.id === "deep"),
    "已经深过一遍的不再排 —— 否则这条队列永远清不空");
  assert(L.pending(list).map((g) => g.id).join() === "unanalysed",
    "……而「还没分析过」那条队列一点没变：两个问题，两条队列");
  // 同样的预算不算加深；但没记预算的那一局，连 200 都不敢说它花过
  assert(L.deepenable(list, 200).map((g) => g.id).join() === "nobudget",
    "同样的预算不算加深 —— 只剩那局连预算都没记的", L.deepenable(list, 200).map((g) => g.id).join());
}

// --- 阶段划分 ---------------------------------------------------------------
{
  assert(L.phaseOf(1) === "opening" && L.phaseOf(L.OPENING_UNTIL) === "opening", "开局");
  assert(L.phaseOf(L.OPENING_UNTIL + 1) === "middle" && L.phaseOf(L.MIDDLE_UNTIL) === "middle", "中局");
  assert(L.phaseOf(L.MIDDLE_UNTIL + 1) === "end", "残局");
}

// --- 诊断：样本不够就明说，不画一张三局的图 --------------------------------
{
  const few = [{ id: "a", side: "w", an: { acc: { w: 70 }, tags: [], losses: [] } }];
  const d = L.diagnose(few, 20);
  assert(d.enough === false && d.have === 1 && d.need === 20, "只有一局：直说样本不够，不给结论");

  // 造一批：白方在残局固定亏 120 厘兵、开局只亏 5，每局残局一个 ??
  const games = [];
  for (let i = 0; i < 40; i++) {
    const tags = [], losses = [];
    for (let ply = 0; ply < 80; ply++) {
      const mine = ply % 2 === 0;
      const moveNo = Math.floor(ply / 2) + 1;
      const end = moveNo > L.MIDDLE_UNTIL;
      tags.push(mine && end && moveNo === 40 ? "??" : null);
      losses.push(mine ? (end ? 120 : 5) : 0);
    }
    games.push({
      id: "g" + i, t: T0 + i, side: "w", plies: 80,
      outcome: i % 4 === 0 ? "win" : i % 4 === 1 ? "draw" : "loss",
      eco: "B20", ecoName: "西西里防御",
      motifs: { 78: "fork" },
      an: { acc: { w: 62 }, tags, losses },
    });
  }
  const r = L.diagnose(games, 20);
  assert(r.enough === true && r.games === 40, "四十局：给结论");
  assert(r.acc === 62, "整体精准度是每局的平均", String(r.acc));
  assert(r.outcome.win === 10 && r.outcome.draw === 10 && r.outcome.loss === 20, "胜负和分布");
  assert(r.phase.opening.acpl === 5 && r.phase.end.acpl === 120,
    "分阶段 ACPL 各自算各自的", JSON.stringify({ o: r.phase.opening.acpl, e: r.phase.end.acpl }));
  assert(r.weakestPhase === "end", "指出该练的是残局", String(r.weakestPhase));
  assert(r.peak && r.peak.move === 40 && r.peak.n === 40, "失误最密集的是第 40 手", JSON.stringify(r.peak));
  assert(r.motifs[0] && r.motifs[0].motif === "fork" && r.motifs[0].n === 40, "按母题统计失误");
  assert(r.ecos[0] && r.ecos[0].eco === "B20" && r.ecos[0].n === 40 && r.ecos[0].score === 0.375,
    "按开局统计战绩", JSON.stringify(r.ecos[0]));

  // 差距不够大的时候不要硬给建议
  const flat = games.map((g) => ({ ...g, an: { ...g.an, losses: g.an.losses.map(() => 40) } }));
  assert(L.diagnose(flat, 20).weakestPhase === null,
    "三个阶段差不多时，不硬指一个「最弱」—— 五个点的差是噪声，不是建议");

  // 对手的失误不是我的
  const theirs = games.map((g) => ({ ...g, side: "b" }));
  const rb = L.diagnose(theirs, 20);
  assert(rb.phase.end.acpl === 0, "换到黑方视角，统计的就只是黑方那些手", String(rb.phase.end.acpl));

  // 没认领的局不进统计
  const mixed = games.concat([{ id: "z", t: T0, side: null, an: { acc: {}, tags: [], losses: [] } }]);
  assert(L.diagnose(mixed, 20).games === 40, "认不出是谁下的那局，不折进「你的」数字里");

  // [SetUp] 局：起手方和起手手数都写在 FEN 里，7.0 两个都没读
  //
  // 下面每一局都是「黑方走 ply 0，黑方每一手丢 200，白方一手不丢」，而且这盘棋
  // 从第 30 手开始。读不出 FEN 的版本会把这 20 局算成「白方视角、开局、每手 0」
  // —— 把玩家自己的每一手都记到对手账上，再把残局的局面归进开局。
  {
    const tags = new Array(40).fill(null), losses = new Array(40).fill(0);
    for (let i = 0; i < 40; i += 2) { losses[i] = 200; tags[i] = "??"; }
    const setup = Array.from({ length: 20 }, (_, i) => ({
      id: "s" + i, t: T0 + i, side: "b", plies: 40,
      fen: "8/8/4k3/8/8/4K3/8/8 b - - 0 30",
      outcome: "loss", motifs: {}, an: { acc: { b: 50 }, tags, losses },
    }));
    const d = L.diagnose(setup, 20);
    assert(d.phase.end.acpl === 200,
      "FEN 说黑方先走，统计的就该是黑方那些手", JSON.stringify(d.phase));
    // 第 30–32 手还算中局（MIDDLE_UNTIL = 32），之后是残局；开局一手都没有
    assert(d.phase.opening.plies === 0 && d.phase.middle.plies === 60 && d.phase.end.plies === 340,
      "FEN 说从第 30 手开始，这些手就不是开局", JSON.stringify(d.phase));
    assert(d.peak && d.peak.move === 30, "第一手是第 30 手，不是第 1 手", JSON.stringify(d.peak));
  }
}

if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\nall library tests passed");
