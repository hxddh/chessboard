/**
 * The endgame camp without an engine (v8-1-plan T2).
 *
 *   - the content: sixty positions, twelve per theme, legal, White to move,
 *     a goal each, words in all three languages;
 *   - the verdicts: each goal is what docs/endgames-verified.json recorded
 *     when the content was written (scripts/verify-endgames.py): ≤ 4 men the
 *     local Syzygy tables; 5–7 men a deep Stockfish search, and — for those
 *     marked `tb` — the full Syzygy set's answer from tablebase.lichess.ovh
 *     (`lichess`, v8-2-plan V2); more than 7 men only the search. Each
 *     position's method is the one its source note names, and a position
 *     whose tip names "the only move" is held to the table's list of moves
 *     that keep the result;
 *   - endgame-rules.js: when a run is over and who got what they wanted;
 *   - the progress: a miss, a helped success and a clean one against
 *     srs.js's queue, on a fixed clock; the learning-file merge; a pre-8.1
 *     learn key;
 *   - the chunk: the positions are in chunk-endgames.js, not in bundle.js.
 *
 * Playing each one out against the engine is scripts/test-endgames-play.mjs.
 * Run: node scripts/test-endgames.mjs
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";

const ctx = loadAppModules([
  "src/web/js/chess.js", "src/web/js/srs.js", "src/web/js/endgames.js", "src/web/js/endgame-rules.js",
  "src/web/js/trainer/endgames.js", "src/web/js/learning.js", "src/web/js/i18n.js",
]);
const { Chess, CHESS_ENDGAMES, ChessEndgameRules: Rules, ChessSrs: Srs, createEndgames, ChessLearning } = ctx;

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// ------------------------------------------------------------ the content
const { GROUPS, ITEMS } = CHESS_ENDGAMES;
{
  assert(ITEMS.length === 60, "60 个残局（" + ITEMS.length + "）");
  assert(GROUPS.length === 5 && GROUPS.every((g) => ITEMS.filter((x) => x.g === g.id).length === 12),
    "五个主题，每个 12 个：" + GROUPS.map((g) => g.id + " " + ITEMS.filter((x) => x.g === g.id).length).join(", "));
  assert(new Set(ITEMS.map((x) => x.id)).size === ITEMS.length, "id 不重复");
  const bad = [];
  for (const x of ITEMS) {
    const v = new Chess().validate_fen(x.fen);
    const g = new Chess(x.fen);
    if (!v.valid) bad.push(x.id + " FEN " + v.error);
    else if (g.turn() !== "w") bad.push(x.id + " 不是白方先走");
    else if (g.game_over()) bad.push(x.id + " 已经结束");
    if (x.goal !== "win" && x.goal !== "draw") bad.push(x.id + " goal " + x.goal);
    const men = g.board().flat().filter(Boolean).length;
    // v8-2-plan V2: ≤ 4 men is the local table's, so always `tb`; 5–7 men
    // may be `tb` only on the online table's answer (checked below)
    if (men <= 4 && x.v !== "tb") bad.push(x.id + " " + men + " 子却标 " + x.v);
    if (men > 7 && x.v !== "sf") bad.push(x.id + " 超过 7 子却标 " + x.v);
    // …and the other way round (M2 review): the card's wording says an `sf`
    // position is one past every table, so one must have more than 7 men
    if (x.v === "sf" && men <= 7) bad.push(x.id + " 标 sf 却只有 " + men + " 子");
    for (const f of ["n", "tip", "src"]) {
      if (!Array.isArray(x[f]) || x[f].length !== 3 || x[f].some((s) => typeof s !== "string" || !s.trim())) bad.push(x.id + " " + f + " 缺语言");
    }
  }
  for (const b of bad) console.error("  " + b);
  assert(bad.length === 0, "每个局面合法、白先、有目标，名字 / 提示 / 出处三语齐备，≤ 4 子的标 tb，超过 7 子的标 sf，标 sf 的都超过 7 子");
  const goals = { win: ITEMS.filter((x) => x.goal === "win").length, draw: ITEMS.filter((x) => x.goal === "draw").length };
  assert(goals.win > 0 && goals.draw >= 12, "有取胜也有守和（" + goals.win + " 胜 / " + goals.draw + " 和）");
  assert(GROUPS.every((g) => Array.isArray(g.n) && g.n.length === 3 && g.n.every(Boolean)), "主题名三语齐备");
}

// ----------------------------------------------- the verdicts, as recorded
{
  const file = path.join(ROOT, "docs/endgames-verified.json");
  const doc = JSON.parse(fs.readFileSync(file, "utf8"));
  const rec = new Map(doc.items.map((r) => [r.id, r]));
  assert(doc.items.length === ITEMS.length && ITEMS.every((x) => rec.has(x.id)), "核对记录覆盖全部 60 个（" + doc.items.length + "）");
  const bad = [];
  const online = doc.tools.lichessTablebase;
  // tablebase_api.py verdict(): cursed / blessed are draws, maybe-* and unknown settle nothing
  const SIDE = { win: "win", "syzygy-win": "win", draw: "draw", "cursed-win": "draw", "blessed-loss": "draw", loss: "loss", "syzygy-loss": "loss" };
  const byOnline = [];
  for (const x of ITEMS) {
    const r = rec.get(x.id);
    if (!r) continue;
    const men = new Chess(x.fen).board().flat().filter(Boolean).length;
    if (r.fen !== x.fen) bad.push(x.id + " 记录里的 FEN 不同：" + r.fen);
    // `method` is what the offline run did (verify-endgames.py): the local
    // table up to 4 men, the search above; a 5–7-man `tb` rests on `lichess`
    if (r.method !== (men <= 4 ? "tb" : "sf")) bad.push(x.id + " " + men + " 子，记录的方法却是 " + r.method);
    if (r.verdict !== x.goal) bad.push(x.id + " 目标 " + x.goal + " ≠ 记录 " + r.verdict);
    const L = r.lichess;
    if (L) {
      // an answer on file must agree, whichever basis the item names
      if (L.verdict !== SIDE[L.category] || L.verdict !== x.goal) bad.push(x.id + " 在线表 " + L.category + " / " + L.verdict + "，目标 " + x.goal);
      if (!Array.isArray(L.good) || !L.good.length) bad.push(x.id + " 在线表没有保住结论的着法");
      if (r.method === "tb" && JSON.stringify(L.good) !== JSON.stringify(r.good)) bad.push(x.id + " 在线表的着法 ≠ 本地表");
      if (!online || online.partial || online.over7.includes(x.id)) bad.push(x.id + " 在线表的应答没有出处或不完整");
    }
    if (x.v === "tb" && men > 4) {
      byOnline.push(x.id);
      if (!L) bad.push(x.id + " " + men + " 子标 tb，却没有在线表（lichess）的应答");
      else if (x.key && JSON.stringify([...x.key].sort()) !== JSON.stringify(L.good)) bad.push(x.id + " 提示说的唯一着 " + x.key + " ≠ 在线表 " + L.good);
    }
    if (r.method === "tb") {
      if ((x.goal === "win") !== (r.wdl === 2) || (x.goal === "draw") !== (r.wdl === 0)) bad.push(x.id + " WDL " + r.wdl);
      if (!Array.isArray(r.good) || !r.good.length) bad.push(x.id + " 没有保住结论的着法");
      if (x.key && JSON.stringify([...x.key].sort()) !== JSON.stringify(r.good)) bad.push(x.id + " 提示说的唯一着 " + x.key + " ≠ 表 " + r.good);
    } else {
      const rows = r.search || [];
      const depths = rows.map((s) => s.depth);
      if (rows.length < 2 || Math.min(...depths) < 30) bad.push(x.id + " 深度不够 " + depths);
      const cls = (s) => (s.mate != null ? (s.mate > 0 ? "win" : "loss") : s.cp >= 10000 ? "win" : s.cp === 0 ? "draw" : "open");
      if (!rows.every((s) => cls(s) === x.goal)) bad.push(x.id + " 搜索结论 " + rows.map(cls).join("/"));
    }
  }
  for (const b of bad) console.error("  " + b);
  assert(bad.length === 0, "60 个结论与生成时的核对记录一致（Syzygy " + ITEMS.filter((x) => x.v === "tb").length +
    "，其中 " + byOnline.length + " 个 5–7 子查的在线表；Stockfish " + ITEMS.filter((x) => x.v === "sf").length +
    "）；点名「唯一正解」的与表一致");
  assert(/Stockfish/.test(doc.tools.stockfish || "") && Object.keys(doc.tools.syzygyMd5 || {}).length >= 30,
    "记录写明了用的工具：" + doc.tools.stockfish + "，" + Object.keys(doc.tools.syzygyMd5 || {}).length + " 个 Syzygy 文件的 md5");
}

// ------------------------------------------------------- endgame-rules.js
{
  const at = (fen, goal, start) => Rules.outcome(new Chess(fen), goal, start || { bq: 0 });
  const r1 = at("k7/1Q6/1K6/8/8/8/8/8 b - - 0 1", "win");
  assert(r1 && r1.ok && r1.how === "mate", "将死 → 取胜");
  const r2 = at("k7/8/1QK5/8/8/8/8/8 b - - 0 1", "win");
  assert(r2 && !r2.ok && r2.how === "stalemate", "逼和 → 取胜失败");
  const r3 = at("7k/8/8/8/8/8/1Q6/K7 b - - 0 1", "win");
  assert(r3 && r3.ok && r3.how === "bare", "对方只剩光王、你的后吃不掉 → 取胜");
  const r3b = at("7k/8/8/8/8/8/1Q6/K7 b - - 0 1", "win", { bq: 0, bare: true });
  assert(r3b === null, "……但对方开局就是光王（后杀王、车杀王）时，要真的将死");
  const r4 = at("8/8/8/8/8/8/1kQ5/7K b - - 0 1", "win");
  assert(r4 === null, "光王下一步能吃掉你唯一的后 → 还没完");
  const r5 = at("4k3/8/8/8/8/8/4p3/4KN2 w - - 0 1", "win");
  assert(r5 && !r5.ok && r5.how === "material", "只剩一个轻子、没有兵 → 已经赢不了");
  const r6 = at("8/8/8/8/8/8/2k5/K7 w - - 0 1", "win");
  assert(r6 && !r6.ok && r6.how === "draw", "子力不足的和棋 → 取胜失败");
  const r7 = at("k7/8/1QK5/8/8/8/8/8 b - - 0 1", "draw");
  assert(r7 && r7.ok, "守和：逼和算达成");
  const r8 = at("7K/8/5k2/8/8/8/6q1/8 w - - 0 1", "draw", { bq: 1 });
  assert(r8 === null, "守和：还有路走 → 还没完");
  const r10 = at("7K/5kq1/8/8/8/8/8/8 w - - 0 1", "draw");
  assert(r10 && !r10.ok && r10.how === "mated", "守和：被将死 → 失败");
  const r11 = at("8/8/8/8/8/4k3/8/K3q3 w - - 0 1", "draw", { bq: 0 });
  assert(r11 && !r11.ok && r11.how === "queened", "守和：对方新变出一个后 → 失败");
  const r12 = at("8/8/8/8/8/4k3/8/K3q3 w - - 0 1", "draw", { bq: 1 });
  assert(r12 === null, "……开局就有的后不算");
  const r12c = at("8/8/8/8/8/B2k4/8/2q3K1 w - - 0 1", "draw", { bq: 0 });
  assert(r12c === null, "……你下一步就能吃掉新后（象守着升变格）时也不算");
  const r12b = at("8/2P5/8/8/8/4k3/8/K3q3 w - - 0 1", "draw", { bq: 0 });
  assert(r12b === null, "……你的兵也在第 7 横线、下一步就变后时也不算（列蒂的名题就是后对后和棋）");
  // M3 评审：开局就有的后被吃掉以后，对方再变出来的后是新后
  {
    const q = new Chess("K4R2/8/8/8/5q2/2k5/p7/8 w - - 0 1");
    const st = Rules.startOf(q);
    for (const m of ["Rxf4", "a1=Q+"]) assert(q.move(m), "着法 " + m + " 合法");
    const rq = Rules.outcome(q, "draw", st);
    assert(st.bq === 1 && rq && !rq.ok && rq.how === "queened", "守和：原来的后被吃掉之后再变出一个后 → 失败", JSON.stringify(rq));
    const keep = new Chess("K4R2/8/8/8/5q2/2k5/8/8 w - - 0 1");
    const st2 = Rules.startOf(keep);
    keep.move("Rf7");
    assert(Rules.outcome(keep, "draw", st2) === null, "……原来的后一直在，不算新后");
  }
  // M3 评审：从残局回到一课，令牌同样接着走（startEndgame 已经这样做），
  // 不再从 0 开始——上一轮还在路上的引擎回复不会对上新一轮的第一个令牌
  {
    const src = fs.readFileSync(path.join(ROOT, "src/web/js/trainer/lessons.js"), "utf8");
    const starts = [...src.matchAll(/store\.session\.learn = \{[^\n]*token: ([^,]+),/g)].map((m) => m[1]);
    assert(starts.length === 2 && starts.every((x) => x === "carryToken()") && /store\.session\.lastLearnToken = \+\+store\.session\.learn\.token/.test(src),
      "startLesson 与 startEndgame 都接着上一轮（或上次停下的）令牌走", starts.join(" / "));
  }
  const r13 = at("8/8/8/8/8/2k5/8/K1R5 b - - 0 1", "draw");
  assert(r13 && r13.ok && r13.how === "bare", "守和：对方只剩光王 → 达成");
  // threefold: shuffle the kings twice round
  const g = new Chess("8/8/8/4k3/8/8/1r6/4B2K w - - 0 1");
  for (const m of ["Kg1", "Kd4", "Kh1", "Ke5", "Kg1", "Kd4", "Kh1", "Ke5"]) g.move(m);
  const r14 = Rules.outcome(g, "draw", { bq: 0 });
  assert(r14 && r14.ok && r14.how === "repetition", "守和：三次重复 → 达成");
  const r15 = Rules.outcome(new Chess("8/8/8/4k3/8/8/1r6/4B2K w - - 100 80"), "draw", { bq: 0 });
  assert(r15 && r15.ok && r15.how === "fifty", "守和：50 回合 → 达成");
  // the start of every camp position is still open
  const open = ITEMS.filter((x) => Rules.outcome(new Chess(x.fen), x.goal, Rules.startOf(new Chess(x.fen))) !== null);
  assert(open.length === 0, "60 个起始局面都还没分出结果" + (open.length ? "：" + open.map((x) => x.id).join(", ") : ""));
}

// ---------------------------------------- progress and the review queue
function camp(learnState) {
  const saved = [];
  const store = { ui: { langId: "zh-CN" }, session: { learnState } };
  const I = ctx.ChessI18n;
  const t = (k) => I.DICT["zh-CN"][k] || k;
  const tf = (k, a) => t(k).replace(/\{(\d)\}/g, (_, i) => a[i]);
  const E = createEndgames({ store, t, tf, saveLearnState: () => saved.push(JSON.stringify(store.session.learnState)), onReady: () => {} });
  return { E, store, saved };
}
{
  // the chunk's global is already on this context, so the module finds it
  ctx.CHESS_ENDGAMES = CHESS_ENDGAMES;
  ctx.setTimeout = setTimeout; // the fetch waits a frame (trainer/endgames.js ensure)
  const DAY = Srs.DAY, T0 = Date.UTC(2026, 8, 30);
  const { E, store, saved } = camp({ v: 1, done: { board: true }, last: 7 });
  // a pre-8.1 learn key: nothing of it is lost, and the camp reads as empty
  assert(E.doneCount() === 0 && store.session.learnState.last === 7 && store.session.learnState.done.board === true,
    "8.0 的教学进度（没有 eg）照样读，课程进度一点不丢");
  E.ensure();
  await new Promise((r) => setTimeout(r, 20));
  assert(E.ready() && E.total() === 60, "分块已在窗口上时直接可用（60）");
  const L = E.lesson("dr-reti");
  assert(L && L.id === "eg:dr-reti" && L.tasks.length === 1 && L.tasks[0].type === "drill" && L.tasks[0].engine === "extreme",
    "一个残局 = 一课一题：和引擎对下，引擎满强度（extreme）");
  assert(L.tasks[0].winOn === "draw" && L.tasks[0].goal === "draw", "守和的残局按守和判");
  const tbL = E.lesson("kp-keysq"), onL = E.lesson("rp-lucena"), sfL = E.lesson("kp-breakthrough");
  assert(tbL.text[1].includes("Syzygy") && onL.text[1].includes("Syzygy") && sfL.text[1].includes("Stockfish"),
    "每个残局的出处一行写明核对方法：" + tbL.text[1] + " / " + onL.text[1] + " / " + sfL.text[1]);
  assert(tbL.text[1].includes("标准残局理论") && onL.text[1].includes("Salvio"), "……以及局面的来源");

  E.record("kp-keysq", false, false, T0);
  const s1 = store.session.learnState.eg.srs["kp-keysq"];
  assert(s1 && s1.s === 0 && s1.due === T0, "走错 → 进复习队列，今天就到期");
  assert(JSON.stringify(E.due(T0)) === JSON.stringify(["kp-keysq"]), "到期列表里有它");
  assert(!store.session.learnState.eg.done["kp-keysq"], "没达成就不算做过");
  E.record("kp-keysq", true, false, T0 + 1000);
  const s2 = store.session.learnState.eg.srs["kp-keysq"];
  assert(store.session.learnState.eg.done["kp-keysq"] === T0 + 1000 && s2.s === 1 && s2.due === T0 + 1000 + DAY,
    "干净地达成 → 记为做过，复习往后排 1 天（srs.js 的阶梯）");
  assert(E.due(T0 + 2000).length === 0 && E.due(T0 + 1000 + DAY).length === 1, "明天才再到期");
  E.record("kp-sixth", true, true, T0);
  assert(store.session.learnState.eg.done["kp-sixth"] && store.session.learnState.eg.srs["kp-sixth"].due === T0,
    "用了悔棋或提示才达成 → 算做过，但排进复习");
  let e = store.session.learnState.eg.srs["kp-keysq"];
  for (let i = 0; i < 4 && e; i++) { E.record("kp-keysq", true, false, e.due); e = store.session.learnState.eg.srs["kp-keysq"]; }
  assert(!e, "一路干净地复习完 1 → 3 → 7 → 21 天，就离开队列");
  assert(saved.length >= 4 && JSON.parse(saved[saved.length - 1]).eg.done["kp-keysq"], "每次都写回教学进度（learn 键）");
  assert(E.next("kp-keysq") === "kp-tempo", "下一个：排在后面的第一个没做过的（" + E.next("kp-keysq") + "）");
  for (const x of ITEMS) store.session.learnState.eg.done[x.id] = T0;
  store.session.learnState.eg.srs = { "qu-qvr": { s: 0, n: 1, due: 0, ivl: 0 } };
  assert(E.next("kp-keysq") === "qu-qvr", "全做过以后，下一个是到期的复习");
  store.session.learnState.eg.srs = {};
  assert(E.next("kp-keysq") === null, "都做过、也没有到期的，就没有下一个");
  assert(E.doneCount("kp") === 12 && E.doneCount() === 60, "按主题数做过的");
  // a hand-edited key of the wrong shape is repaired, not thrown on
  const { E: E2, store: st2 } = camp({ v: 1, done: {}, last: 0, eg: "junk" });
  E2.ensure();
  assert(E2.doneCount() === 0 && typeof st2.session.learnState.eg === "object", "坏掉的 eg 当成空的");
}

// ----------------------------------------------- the learning file merge
{
  const cur = { v: 1, done: { a: true }, last: 2, eg: { done: { x: 1 }, srs: { x: { s: 0, n: 1, due: 5, ivl: 0 }, y: { s: 2, n: 3, due: 9, ivl: 3 } } } };
  const inc = { v: 1, done: { b: true }, last: 4, eg: { done: { z: 2 }, srs: { x: { s: 1, n: 2, due: 7, ivl: 1 }, y: { s: 1, n: 2, due: 1, ivl: 1 } } } };
  const out = ChessLearning.merge({ learn: JSON.stringify(cur) }, { kind: "chessboard-learning", v: 1, data: { learn: inc } }, 100).learn;
  assert(out.done.a && out.done.b && out.last === 4, "学习文件合并：课程照旧");
  assert(out.eg.done.x === 1 && out.eg.done.z === 2, "……残局做过的取并集");
  assert(out.eg.srs.x.s === 1 && out.eg.srs.y.s === 2, "……复习取阶梯走得更远的一条");
  const old = ChessLearning.merge({ learn: JSON.stringify({ v: 1, done: {}, last: 0 }) }, { kind: "chessboard-learning", v: 1, data: { learn: { v: 1, done: { a: true }, last: 1 } } }, 100).learn;
  assert(!("eg" in old), "两边都没有 eg（8.0 的文件）就不凭空加一个");
  // M3 评审：这里已经毕业（做过、复习项已离开队列）的残局，旧文件里的复习项不再带回来
  const grad = ChessLearning.merge({ learn: JSON.stringify({ v: 1, done: {}, last: 0, eg: { done: { g: 1 }, srs: {} } }) },
    { kind: "chessboard-learning", v: 1, data: { learn: { v: 1, done: {}, last: 0, eg: { done: { g: 1 }, srs: { g: { s: 2, n: 3, due: 9, ivl: 3 }, h: { s: 0, n: 1, due: 1, ivl: 0 } } } } } }, 100).learn;
  assert(!("g" in grad.eg.srs) && grad.eg.srs.h && grad.eg.srs.h.s === 0, "……毕业的不复活；这里没做过的照常进来", JSON.stringify(grad.eg.srs));
}

// ----------------------------------------------------------- the chunk
{
  const bundle = path.join(ROOT, "src/web/js/bundle.js");
  const chunk = path.join(ROOT, "src/web/js/chunk-endgames.js");
  if (!fs.existsSync(bundle) || !fs.existsSync(chunk)) {
    console.log("skip: no build — npm run build first for the chunk checks");
  } else {
    const b = fs.readFileSync(bundle, "utf8"), c = fs.readFileSync(chunk, "utf8");
    assert(!b.includes("kp-keysq") && !b.includes("4kb2/8/8/8/7p") && !b.includes("Vančura"), "主包里没有残局内容（局面、名字）");
    assert(c.includes("kp-keysq") && c.includes("CHESS_ENDGAMES"), "内容在 chunk-endgames.js（" + (c.length / 1024).toFixed(1) + " KB）");
    assert(b.includes("chunk-endgames.js"), "主包只知道分块的文件名");
  }
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
