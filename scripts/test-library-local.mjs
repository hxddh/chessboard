/**
 * v8-1-plan T5 — 本机对局 in the diagnosis, the export and the speed filter,
 * without a browser (library-local.js; test-library-e2e wires it up).
 *
 *   1. the diagnosis's three sources, each against numbers worked out by
 *      hand from fixed games;
 *   2. the export of a 本机 game and its way back: the record, field for
 *      field, under its own id; what a file may not smuggle in;
 *   3. the time control: new-style tags, the back-fill from the save, over
 *      the stats shapes 6.x … 8.0 wrote — nothing else in a record changes;
 *   4. the speed filter finds a 本机 game by its clock.
 *
 * 跑：node scripts/test-library-local.mjs
 */
import { ChessPgnParser } from "../src/web/js/pgn-parser.js";
import { ChessLibrary as L } from "../src/web/js/library.js";
import { LibraryQuery as Q } from "../src/web/js/library-query.js";
import { LibraryLocal as LL } from "../src/web/js/library-local.js";
import { ChessReview } from "../src/web/js/review.js";

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra != null ? "  " + extra : "")); }
};
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** library-ui.js rescoreLosses, as the chunk calls it on a 本机 entry's pass. */
function rescore(g) {
  const an = g.an, sc = an.scalars;
  let side = typeof g.fen === "string" && g.fen.trim().split(/\s+/)[1] === "b" ? "b" : "w";
  an.losses = an.losses.map((_, i) => {
    const out = ChessReview.lossOf(sc[i], sc[i + 1], side);
    side = side === "w" ? "b" : "w";
    return out;
  });
}

// --- 1. the diagnosis: 导入的 / 本机 / 全部 ------------------------------------
{
  // two analysed imports
  const I1 = { id: "lib:1", side: "w", outcome: "win", eco: "C60", ecoName: "Ruy Lopez", fen: "", sans: "e4 e5 Nf3 Nc6", plies: 4,
    an: { acc: { w: 80, b: 50 }, tags: [null, null, "?", null], losses: [10, 0, 50, 0] } };
  const I2 = { id: "lib:2", side: "b", outcome: "loss", eco: "B20", ecoName: "Sicilian", fen: "", sans: "e4 c5 Nf3 d6", plies: 4,
    an: { acc: { w: 70, b: 60 }, tags: [null, "??", null, null], losses: [0, 200, 0, 30] } };
  // three 本机 games: one with its pass still on file, one with only its
  // accuracy, one never analysed
  const L1 = { id: "loc:a", src: "local", side: "w", outcome: "win", eco: "C60", ecoName: "Ruy Lopez", fen: "", sans: "e4 e5 Nf3 Nc6", plies: 4 };
  const L2 = { id: "loc:b", src: "local", side: "b", outcome: "draw", eco: "", fen: "", sans: "d4 d5", plies: 2 };
  const L3 = { id: "loc:c", src: "local", side: "w", outcome: "loss", eco: "A00", fen: "", sans: "g4 e5", plies: 2 };
  const recs = { "loc:a": { id: "a", acc: 90 }, "loc:b": { id: "b", acc: 70 }, "loc:c": { id: "c" } };
  // the pass on file for L1: White's third ply (move 2) drops 300 and is ??
  const kept = { "loc:a": { scalars: [0, 0, 0, -300, -300], tags: [null, null, "??", null], acc: { w: 91, b: 88 } } };
  const local = [];
  for (const e of [L1, L2, L3]) {
    e.an = LL.localAnalysis(e, recs[e.id], kept[e.id] || null);
    if (!e.an) continue;
    if (e.an.scalars) rescore(e);
    local.push(e);
  }
  assert(local.length === 2 && !L3.an, "本机：只有带精准度的对局算分析过（两局；没分析的那局不算）");
  assert(same(L1.an.acc, { w: 90 }) && same(L1.an.losses, [0, 0, 300, 0]) && same(L2.an.tags, []),
    "…精准度用战绩里记的那个，逐手损失由留着的那遍分析按 lossOf 算出（" + JSON.stringify(L1.an.losses) + "）");

  const dx = (src) => L.diagnose(LL.diagGames(src, [I1, I2], local), 2);
  const imp = dx("import"), loc = dx("local"), all = dx("all");
  // worked by hand:
  //   导入的：I1 (w, win, 80) plies 0, 2 → moves 1, 2, losses 10 + 50, "?" at move 2;
  //          I2 (b, loss, 60) plies 1, 3 → moves 1, 2, losses 200 + 30, "??" at move 1
  //          games 2 · 1-1-0 · acc 70 · opening acpl 290/4 = 72.5 → 73, bad 2/4
  //          ECO C60 1 (win), B20 1 (loss) · peak: moves 1 and 2 tie at 1, the earlier wins → 1
  assert(imp.enough && imp.games === 2 && same(imp.outcome, { win: 1, loss: 1, draw: 0 }) && imp.acc === 70 &&
    imp.phase.opening.acpl === 73 && imp.phase.opening.badRate === 0.5 && imp.phase.opening.plies === 4 &&
    imp.phase.middle.acpl === null && imp.peak.move === 1 && imp.peak.n === 1 &&
    same(imp.ecos.map((e) => [e.eco, e.n, e.win, e.loss]), [["C60", 1, 1, 0], ["B20", 1, 0, 1]]),
    "导入的：2 局 1 胜 1 负、精准度 70、开局 73 厘兵/手、失误率 50%、失误最密在第 1 回合（" + JSON.stringify(imp) + "）");
  //   本机：L1 (w, win, 90) plies 0, 2 → losses 0 + 300, "??" at move 2; L2 (b, draw, 70) no plies
  //          games 2 · 1-0-1 · acc 80 · opening acpl 300/2 = 150, bad 1/2 · C60 1 (L2 has no opening) · peak 2
  assert(loc.enough && loc.games === 2 && same(loc.outcome, { win: 1, loss: 0, draw: 1 }) && loc.acc === 80 &&
    loc.phase.opening.acpl === 150 && loc.phase.opening.badRate === 0.5 && loc.phase.opening.plies === 2 &&
    loc.peak.move === 2 && loc.peak.n === 1 && same(loc.ecos.map((e) => [e.eco, e.n, e.win]), [["C60", 1, 1]]),
    "本机：2 局 1 胜 1 和、精准度 80、开局 150 厘兵/手、失误率 50%、失误最密在第 2 回合（" + JSON.stringify(loc) + "）");
  //   全部：games 4 · 2-1-1 · acc (80+60+90+70)/4 = 75 · opening (60+230+300)/6 = 98.3 → 98, bad 3/6
  //          C60 2 (2 wins, score 100%), B20 1 · peak: move 2 has 2 (I1, L1), move 1 has 1
  assert(all.enough && all.games === 4 && same(all.outcome, { win: 2, loss: 1, draw: 1 }) && all.acc === 75 &&
    all.phase.opening.acpl === 98 && all.phase.opening.badRate === 0.5 && all.phase.opening.plies === 6 &&
    all.peak.move === 2 && all.peak.n === 2 &&
    same(all.ecos.map((e) => [e.eco, e.n, e.win, e.score]), [["C60", 2, 2, 1], ["B20", 1, 0, 0]]),
    "全部：4 局 2 胜 1 负 1 和、精准度 75、开局 98 厘兵/手、失误最密在第 2 回合（2 局）（" + JSON.stringify(all) + "）");
  assert(LL.diagGames(undefined, [I1], local).length === 1 && LL.diagGames("bogus", [I1], local).length === 1,
    "没选或选了不认识的来源，都按「导入的」读 —— 7.x 的诊断");
  assert(!L.diagnose(LL.diagGames("local", [I1, I2], local), 20).enough && L.diagnose(LL.diagGames("local", [I1, I2], local), 20).have === 2,
    "每种来源各自有样本下限（本机 2 局 < 20 局就不给诊断）");
}

// --- 2. export → import: a 本机 game comes back as itself -------------------
const T0 = 1758000000000;
const parse = (text) => ChessPgnParser.parsePgn(text).games[0];
const mainline = (g) => { const s = []; for (let n = g.root; n.children.length; n = n.children[0]) s.push(n.children[0].san); return s; };
{
  const rec = { id: "mfk2x3-1", t: T0, color: "b", result: "loss", moves: 8, ending: "resigned", diff: "hard", style: "off",
    rb: 1432, ra: 1418, perf: null, acc: 71.5, acpl: 44, hi: 120, lo: -380, tc: "300+3",
    pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6" };
  const e = { id: "loc:" + rec.id, src: "local", ref: rec.id, side: "b", outcome: "loss", result: "1-0", date: "2025.09.16",
    sans: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6", plies: 8, fen: "", tc: rec.tc };
  const text = LL.localPgn(e, rec, [], "Stockfish (高级)", Q.entryPgn);
  assert(/\[LibId "loc:mfk2x3-1"\]/.test(text) && /\[TimeControl "300\+3"\]/.test(text) && /\[White "Stockfish \(高级\)"\]/.test(text) &&
    /\[Black "Player"\]/.test(text) && /\[Result "1-0"\]/.test(text) && /4\. Ba4 Nf6 1-0/.test(text),
    "导出：七项标签、用时、LibId=loc:记录 id，着法和结果");
  const back = LL.recFromGame(parse(text), ChessPgnParser.serializePgn);
  const strip = (r) => { const o = Object.assign({}, r); delete o.pgn; return o; };
  assert(back && same(strip(back), strip(rec)), "导回：战绩记录逐个字段相等（" + JSON.stringify(back && strip(back)) + "）");
  assert(back && same(mainline(parse(back.pgn)), mainline(parse(rec.pgn))), "…它的 PGN 是同一盘棋（" + (back && back.pgn.trim()) + "）");
  // a record whose PGN has headers (a set-up start) gets them back
  const fenRec = Object.assign({}, rec, { id: "x-2", color: "w", result: "win", pgn: '[SetUp "1"]\n[FEN "8/8/4k3/8/8/8/4P3/4K3 b - - 3 40"]\n\n40... Kd5 41. Kd2' });
  const fg = parse(fenRec.pgn);
  const fe = Object.assign({}, e, { id: "loc:x-2", side: "w", outcome: "win", result: "1-0", sans: "Kd5 Kd2", plies: 2, fen: fg.root.fen });
  const fb = LL.recFromGame(parse(LL.localPgn(fe, fenRec, fg.headers, "Stockfish", Q.entryPgn)), ChessPgnParser.serializePgn);
  const fb2 = fb && parse(fb.pgn);
  assert(fb && fb2.root.fen === fg.root.fen && same(mainline(fb2), ["Kd5", "Kd2"]) && same(strip(fb), strip(fenRec)),
    "从摆好的局面开始的本机棋：起始局面和记录都回来");
  // 8.1 M2 评审 P3：LibRec 按写进标签之后的长度量（引号和反斜杠再转义一次）。
  // 引号多的头：JSON 本身约 3,000 字，写成标签超过读取的 4096，整局就认不回来
  const quoted = Array.from({ length: 45 }, (_, i) => ["Annotator" + i, '"q" "u" "o" "t" "e" "s" \\ x' + i]);
  const qRec = Object.assign({}, rec, { id: "q-3", pgn: quoted.map(([k, v]) => "[" + k + ' "' + v.replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"]').join("\n") + "\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6" });
  const qJson = JSON.stringify(Object.assign({}, rec, { h: quoted }));
  assert(qJson.length < 3500 && qJson.length + (qJson.match(/["\\]/g) || []).length > 4096,
    "样本：JSON 在 3500 以内，转义后超过 4096（" + qJson.length + "）");
  const qText = LL.localPgn(Object.assign({}, e, { id: "loc:q-3" }), qRec, quoted, "Stockfish", Q.entryPgn);
  const qLine = qText.split("\n").find((l) => l.startsWith("[LibRec "));
  const qBack = LL.recFromGame(parse(qText), ChessPgnParser.serializePgn);
  assert(qLine.length <= 4096 && qBack && qBack.id === "q-3" && same(strip(qBack), strip(qRec)),
    "引号多的本机棋：LibRec 那一行在 4096 以内（" + qLine.length + "），记录照样认得回来（头太长就不带）");
  // 8.1 M2 评审 P3：导回的记录按时间并进战绩，战绩只留最新 500 条——被挤掉的不算「加入」
  {
    const hist = Array.from({ length: 499 }, (_, i) => ({ id: "h" + i, t: T0 + 1000 + i }));
    const recs = [{ id: "old1", t: T0 - 2 }, { id: "old2", t: T0 - 1 }, { id: "new1", t: T0 + 5000 }, { id: "h3", t: T0 + 1003 }];
    const mm = LL.mergeRecs(hist, recs, 500);
    assert(mm.games.length === 500 && mm.added === 1 && mm.dup === 1 && mm.changed && mm.games[mm.games.length - 1].id === "new1" &&
      !mm.games.some((g) => g.id === "old1" || g.id === "old2"),
      "战绩快满时导回：只留下的 1 条算加入，重复 1 条，比留下的都旧的 2 条不算（" + JSON.stringify({ added: mm.added, dup: mm.dup, n: mm.games.length }) + "）");
    const none = LL.mergeRecs(hist, [{ id: "h1", t: 1 }], 500);
    assert(!none.changed && none.added === 0 && none.dup === 1 && none.games === hist, "全是重复：什么也不动");
  }
  // what a file may not do
  const forge = (tags) => parse(tags + '\n\n1. e4 *');
  assert(LL.recFromGame(forge('[LibId "loc:a"]'), ChessPgnParser.serializePgn) === null, "只有 LibId、没有 LibRec：不是本机棋，照普通导入");
  assert(LL.recFromGame(forge('[LibId "loc:a"]\n[LibRec "{\\"id\\":\\"b\\",\\"t\\":1,\\"color\\":\\"w\\",\\"result\\":\\"win\\"}"]'), ChessPgnParser.serializePgn) === null,
    "LibRec 的 id 和 LibId 对不上：不认");
  assert(LL.recFromGame(forge('[LibId "loc:a"]\n[LibRec "{\\"id\\":\\"a\\",\\"t\\":1,\\"color\\":\\"w\\",\\"result\\":\\"maybe\\"}"]'), ChessPgnParser.serializePgn) === null,
    "结果不是胜 / 负 / 和：不认");
  assert(LL.recFromGame(forge('[LibId "loc:../x"]\n[LibRec "{\\"id\\":\\"../x\\",\\"t\\":1,\\"color\\":\\"w\\",\\"result\\":\\"win\\"}"]'), ChessPgnParser.serializePgn) === null,
    "id 不像记录 id：不认");
  const odd = LL.recFromGame(forge('[LibId "loc:a"]\n[LibRec "{\\"id\\":\\"a\\",\\"t\\":1,\\"color\\":\\"w\\",\\"result\\":\\"win\\",\\"x\\":{\\"y\\":1},\\"__proto__\\":{\\"z\\":1},\\"pgn\\":\\"1. h4\\"}"]'),
    ChessPgnParser.serializePgn);
  assert(odd && !("x" in odd) && !Object.prototype.hasOwnProperty.call(odd, "__proto__") && odd.z === undefined && /1\. e4/.test(odd.pgn),
    "只收平铺的字段：对象、__proto__ 都不进记录，PGN 用这盘棋自己的着法");
  // the imported-game path is untouched: map() hands entryPgn an index, not tags
  const imp = { id: "lib:abc", white: "a", black: "b", result: "1-0", sans: "e4", plies: 1, fen: "" };
  assert([imp].map(Q.entryPgn)[0] === Q.entryPgn(imp) && !/LibRec/.test(Q.entryPgn(imp)), "导入的棋照旧导出（entryPgn 经 map 调用时不多写标签）");
}

// --- 3. the time control: new records carry it, old ones where the save says --
const lineOf = (pgn) => {
  const g = parse(pgn);
  if (!g) return null;
  const tc = g.headers.find(([k]) => k === "TimeControl");
  return { fen: g.root.fen, sans: mainline(g), tc: tc ? tc[1] : "" };
};
{
  assert(LL.tcTagOf("5+3") === "300+3" && LL.tcTagOf("10") === "600" && LL.tcTagOf("c20+5") === "1200+5" && LL.tcTagOf("off") === "",
    "棋钟设置写成 PGN 的 TimeControl：5+3 → 300+3，10 → 600，自定 c20+5 → 1200+5");
  const MATE = "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#";
  // the shapes each version wrote (6.x after persist.js migrateStats)
  const v6 = { id: "v1-mf0-0", t: T0 - 5e8, result: "win", diff: "casual", color: "w", pgn: "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", ending: "mate" };
  const v7 = { id: "g1", t: T0 - 4e8, diff: "normal", color: "w", result: "win", moves: 7, acc: 88,
    pgn: '[Event "?"]\n[Result "1-0"]\n\n' + MATE + " 1-0", ending: "" };
  const v8 = { id: "mf9-3", t: T0 - 1e8, color: "w", result: "win", moves: 7, pgn: MATE, ending: "", diff: "normal", style: "tal",
    rb: 1400, ra: 1412, perf: 1500, acc: 91, acpl: 12, hi: 900, lo: -40 };
  const v8u = { id: "mf9-4", t: T0 - 5e7, color: "b", result: "draw", moves: 4, pgn: "1. d4 d5 2. c4 e6", ending: "drawAgreed",
    diff: "hard", style: "off", unrated: "changed" };
  const own = { id: "mf9-5", t: T0 - 4e7, color: "w", result: "loss", moves: 2, pgn: '[TimeControl "600"]\n\n1. f3 e5', ending: "resigned", diff: "hard", style: "off" };
  const fresh = { id: "mfa-1", t: T0, color: "w", result: "win", moves: 3, pgn: "1. e4 e5 2. Qh5", ending: "resigned", diff: "hard", style: "off", tc: "-" };
  const games = [v6, v7, v8, v8u, own, fresh];
  const before = JSON.parse(JSON.stringify(games));
  // the board still has the scholar's mate on it, played on 5+3 and clocked
  const save = { v: 1, pgn: '[Result "1-0"]\n\n' + MATE + " 1-0", clock: { tc: "5+3", w: 281000, b: 290500, flag: null, started: true } };
  const cand = LL.saveClock(save, lineOf);
  assert(cand && cand.tc === "300+3" && cand.sans === "e4 e5 Qh5 Nc6 Bc4 Nf6 Qxf7#", "存档里走过的棋钟是对局时的设置（5+3 → 300+3）");
  assert(LL.saveClock(Object.assign({}, save, { clock: { tc: "5+3", w: 300000, b: 300000, started: true } }), lineOf) === null,
    "…钟没走过（从历史里载入的旧局配的是今天的钟）不算");
  assert(LL.saveClock(Object.assign({}, save, { clock: Object.assign({}, save.clock, { started: false }) }), lineOf) === null &&
    LL.saveClock({ v: 1, pgn: MATE }, lineOf) === null, "…没开始走、没有钟，也不算");
  const n = LL.backfillTc(games, [cand], lineOf);
  assert(n === 2 && v8.tc === "300+3" && own.tc === "600", "补标两局：棋盘上那局（最近下的那一盘）按存档的钟，自己 PGN 里写着的按标签（" + n + "）");
  assert(v6.tc === undefined && v7.tc === undefined && v8u.tc === undefined,
    "同样着法的更早两局（6.x、7.x 形状）和推不出来的，不标");
  const lost = games.map((g, i) => Object.keys(before[i]).filter((k) => !same(before[i][k], g[k])).map((k) => g.id + "." + k)).flat();
  const extra = games.map((g, i) => Object.keys(g).filter((k) => !(k in before[i]) && k !== "tc")).flat();
  assert(lost.length === 0 && extra.length === 0 && fresh.tc === "-",
    "6.x–8.0 的每条记录：原有字段一个不变，只多了 tc；已经有 tc 的（新记录，含不计时的 \"-\"）不动（" + lost.concat(extra).join(",") + "）");
  assert(LL.backfillTc(games, [cand], lineOf) === 0, "再跑一次什么都不改（候选已用过，已标的不再标）");
}

// --- 4. the speed filter finds 本机 games by their clock ---------------------
{
  const mk = (id, tc) => Object.assign({ id, src: "local", side: "w", outcome: "win", sans: "e4", plies: 1, fen: "" }, tc ? { tc } : {});
  const games = [mk("loc:1", "300+3"), mk("loc:2", "60"), mk("loc:3", "-"), mk("loc:4"), { id: "lib:1", tc: "900+10", sans: "e4", plies: 1 }];
  const ids = (q) => Q.query(games, q, () => null).map((g) => g.id).join(",");
  assert(ids({ tc: "blitz" }) === "loc:1" && ids({ tc: "bullet" }) === "loc:2" && ids({ tc: "rapid", src: "local" }) === "" &&
    ids({ tc: "rapid" }) === "lib:1", "用时筛选对本机棋有效：300+3 是快棋、60 是超快棋；不计时和没标的不归任何一档");
}

if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\n全部通过");
