/**
 * The 20.0 explainer audit (v20-0-plan §4 F1/F2 验收): the 14.0 coach audit
 * (docs/coach-audit-14.0.md, scripts/test-coach.mjs) ported to
 * core/explain.js explainMove(), on the same corpora and the same stored
 * engine lines:
 *
 *   - scripts/fixtures/corpus.mjs — the 28 decided games;
 *   - scripts/fixtures/coach-games.mjs — the low-rated (low-skill engine) games;
 *   - the pass: scripts/fixtures/coach-analysis.json, 200 ms per position, the
 *     cache test-coach.mjs filled — so 19.0 and 20.0 are measured on the same
 *     lines and differ only in the code.
 *
 * Every ? and ?? (win-percentage drop, core/winpct.js) is explained the way
 * the review does it (review/review.js), and counted four ways — the four
 * acceptance numbers:
 *
 *   reasoned   a concrete reason, anything but 「更好的是 X」  (all games)   58% → ≥ 80%
 *   named      the reason names a mechanism (a mate, a motif, a threat, a man
 *              left loose, a positional or endgame fact) — not only what is
 *              lost or won                                     (low-rated)   27% → ≥ 60%
 *   bare       only 「更好的是 X」                                (all games)  ≤ 10%
 *   wrong      of the 100 audited explanations, those a deep search (1 M
 *              nodes, scripts/lib/sf-deep.mjs) and the board refute    ≤ 1%
 *
 * The 100 are chosen the way test-coach.mjs chooses them (every ?? in order,
 * both corpora interleaved, then ? to fill). The oracle is
 * scripts/lib/explain-oracle.mjs (the 14.0 oracle, plus the v2 sentences).
 *
 *   node scripts/audit-explain.mjs                 the coverage numbers, printed
 *   node scripts/audit-explain.mjs --audit         … and the 100 against the deep search
 *   node scripts/audit-explain.mjs --audit --record  … written to docs/measured.json
 *                                                  `explainCoverage` and docs/explain-audit-20.0.md
 *   --nodes=1000000 --jobs=3   the deep search
 */
import fs from "fs";
import path from "path";
import { ROOT } from "./lib/app-module.mjs";
import * as X19 from "../src/app/core/explain-mistake.js";
import { Chess as Chess19 } from "../src/app/core/chess.js";
import { read as readMeasured, record } from "./measurements.mjs";
import { GAMES } from "./fixtures/corpus.mjs";
import { COACH_GAMES } from "./fixtures/coach-games.mjs";

process.removeAllListeners("warning");
const { Chess } = await import("../src/app/core/chess.js");
const X = await import("../src/app/core/explain.js");
const { classifyByWinPct, winPctDrop } = await import("../src/app/core/winpct.js");
const { playText } = await import("../src/app/text/play.js");
const { oracle } = await import("./lib/explain-oracle.mjs");
const { deepSearch } = await import("./lib/sf-deep.mjs");

const arg = (k) => { const a = process.argv.find((x) => x === k || x.startsWith(k + "=")); return a ? (a.includes("=") ? a.slice(k.length + 1) : true) : null; };
const MS = 200;
const NODES = Number(arg("--nodes")) || 1000000;
const JOBS = Number(arg("--jobs")) || 3;
const CACHE = path.join(ROOT, "scripts/fixtures/coach-analysis.json");
const DEEP = path.join(ROOT, "scripts/fixtures/explain-deep.json");
const t = playText("zh");

// the 19.0 explainer for the "before" column, exactly as the 19.0 review called it

const cache = JSON.parse(fs.readFileSync(CACHE, "utf8"));
function cached(fen) {
  const c = cache[MS + "|" + fen];
  if (!c) throw new Error("audit-explain: no stored pass for " + fen + " — run node scripts/test-coach.mjs first");
  return { scalar: c.s, best: c.b, pv: c.pv ? c.pv.split(" ") : [] };
}
function sanLine(fen, ucis, max) {
  const g = new Chess(fen);
  const out = [];
  for (const u of ucis.slice(0, max)) {
    let m = null;
    try { m = g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] || "q" }); } catch { m = null; }
    if (!m) break;
    out.push(m.san);
  }
  return out;
}
/** test-coach.mjs passOf(): scalars, bests (UCI) and pvs (SAN, five plies) */
function passOf(sans) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const s of sans) { if (!g.move(s)) throw new Error("illegal SAN " + s); fens.push(g.fen()); }
  const scalars = [], bests = [], pvs = [];
  for (const fen of fens) {
    const p = new Chess(fen);
    if (p.in_checkmate()) { scalars.push(p.turn() === "w" ? -10000 : 10000); bests.push(null); pvs.push(null); continue; }
    if (p.in_stalemate() || p.insufficient_material()) { scalars.push(0); bests.push(null); pvs.push(null); continue; }
    const r = cached(fen);
    scalars.push(r.scalar); bests.push(r.best);
    const line = sanLine(fen, r.pv, 5);
    pvs.push(line.length ? line.join(" ") : null);
  }
  return { fens, scalars, bests, pvs };
}

const rows = [];
for (const [set, games] of [["corpus", GAMES], ["low", COACH_GAMES]]) {
  for (const game of games) {
    const p = passOf(game.san);
    for (let i = 0; i < game.san.length; i++) {
      const a = p.scalars[i], b = p.scalars[i + 1];
      if (a == null || b == null || !p.bests[i]) continue;
      const mover = p.fens[i].split(" ")[1];
      const tag = classifyByWinPct(winPctDrop(a, b, mover));
      if (tag !== "?" && tag !== "??") continue;
      const line = X.lineAfter(p.pvs, game.san, i);
      const ctx = { kind: "review", best: p.bests[i], bestLine: p.pvs[i], line, evalBefore: a, evalAfter: b };
      const res = X.explainMove(p.fens[i], game.san[i], ctx);
      const old = X19.explainMistake({ fen: p.fens[i], played: game.san[i], best: p.bests[i], bestLine: p.pvs[i], line, evalBefore: a, evalAfter: b }, Chess19);
      rows.push({ set, game: game.name, ply: i, tag, fen: p.fens[i], played: game.san[i], line, bestLine: p.pvs[i], evalBefore: a, evalAfter: b,
        res, key: res && res.key, reason: res && res.reason, zh: X.explainText(res, t),
        oldKey: X19.explainKey(old), oldZh: X19.explainText(old, (k) => t(k)), old });
    }
  }
}

/** 19.0 keys by the same classes as core/explain.js KIND */
const kind19 = (k) => (!k ? null : k === "ex.better" ? "bare" : k === "ex.loss" || k === "ex.betterWins" ? "material" : "named");
function summary(rs, keyOf, kindOf) {
  const pct = (a) => (rs.length ? Math.round((a / rs.length) * 1000) / 10 : 0);
  const by = {};
  for (const r of rs) { const k = keyOf(r) || "(none)"; by[k] = (by[k] || 0) + 1; }
  const n = (pred) => rs.filter(pred).length;
  const reasoned = n((r) => { const k = kindOf(r); return k === "named" || k === "material"; });
  const named = n((r) => kindOf(r) === "named");
  const bare = n((r) => kindOf(r) === "bare");
  return { mistakes: rs.length, reasoned, reasonedPct: pct(reasoned), named, namedPct: pct(named), bare, barePct: pct(bare), byKey: by };
}
const sets = { all: rows, corpus: rows.filter((r) => r.set === "corpus"), low: rows.filter((r) => r.set === "low") };
const res = { before: {}, after: {} };
for (const [k, rs] of Object.entries(sets)) {
  res.before[k] = summary(rs, (r) => r.oldKey, (r) => kind19(r.oldKey));
  res.after[k] = summary(rs, (r) => r.key, (r) => r.reason);
}
for (const when of ["before", "after"]) {
  for (const k of ["all", "corpus", "low"]) {
    const v = res[when][k];
    console.log(`[${when} ${k}] ${v.mistakes} 手：有原因 ${v.reasonedPct}%，说出机制 ${v.namedPct}%，只说「更好的是」${v.barePct}%`);
  }
}
console.log("   句型 " + JSON.stringify(res.after.all.byKey));
if (arg("--rows")) fs.writeFileSync(arg("--rows"), JSON.stringify(rows.map(({ res: r, old, ...x }) => ({ ...x, facts: r && { ...r.facts, ex19: undefined } })), null, 1));

// --- the audit: 100 against the deep search ----------------------------------------
function auditSample(all, n) {
  const order = (set, tag) => all.filter((r) => r.set === set && r.tag === tag);
  const lists = [order("corpus", "??"), order("low", "??"), order("corpus", "?"), order("low", "?")];
  const a = [], b = [];
  for (let i = 0; i < Math.max(lists[0].length, lists[1].length); i++) { if (lists[0][i]) a.push(lists[0][i]); if (lists[1][i]) a.push(lists[1][i]); }
  for (let i = 0; i < Math.max(lists[2].length, lists[3].length); i++) { if (lists[2][i]) b.push(lists[2][i]); if (lists[3][i]) b.push(lists[3][i]); }
  return a.concat(b).slice(0, n);
}

if (arg("--audit")) {
  const sample = auditSample(rows, 100);
  let deep = {};
  try { deep = JSON.parse(fs.readFileSync(DEEP, "utf8")); } catch { deep = {}; }
  const key = (fen) => "n" + NODES + "|" + fen;
  // the positions each claim needs: after the move, before it, after the claimed reply, after the better move
  const need = new Set();
  const posOf = (r) => {
    const g = new Chess(r.fen); g.move(r.played);
    const out = { after: g.fen(), before: r.fen, reply: null, best: null };
    const f = r.res && r.res.facts;
    const replySan = (f && f.ex19 && f.ex19.refute && f.ex19.refute.san) || (r.line && r.line[0]);
    if (replySan) { const h = new Chess(g.fen()); if (h.move(replySan)) out.reply = h.fen(); }
    const bestSan = f && f.best;
    if (bestSan) { const h = new Chess(r.fen); if (h.move(bestSan)) out.best = h.fen(); }
    return out;
  };
  for (const r of sample) for (const f of Object.values(posOf(r))) if (f && !new Chess(f).game_over() && !deep[key(f)]) need.add(f);
  if (need.size) {
    console.log(`deep search: ${need.size} positions at ${NODES} nodes, ${JOBS} at a time…`);
    let done = 0;
    await deepSearch([...need], { nodes: NODES, jobs: JOBS, onDone: (fen, v) => {
      deep[key(fen)] = v;
      if (++done % 20 === 0) { process.stdout.write(done + " "); saveDeep(deep); }
    } });
    saveDeep(deep);
    console.log("");
  }
  const deepOf = (fen) => {
    if (!fen) return null;
    const g = new Chess(fen);
    if (g.game_over()) return { scalar: g.in_checkmate() ? (g.turn() === "w" ? -10000 : 10000) : 0, pv: [] };
    const d = deep[key(fen)];
    return { scalar: d.s, pv: sanLine(fen, d.pv ? d.pv.split(" ") : [], 16) };
  };
  const audited = sample.map((r) => {
    const p = posOf(r);
    const d = { after: deepOf(p.after), before: deepOf(p.before), reply: deepOf(p.reply), best: deepOf(p.best) };
    const v = oracle(r, d, Chess);
    const v19 = oracle({ ...r, res: null, key: r.oldKey, ex: r.old }, d, Chess);
    return { ...r, verdict: v.verdict, why: v.reason, verdict19: v19.verdict, why19: v19.reason };
  });
  const wrong = audited.filter((r) => r.verdict === "wrong").length;
  const wrong19 = audited.filter((r) => r.verdict19 === "wrong").length;
  // the plan's 「100 句里 25 句只是『更好的是 X』」 is this sample's count (14.0 audit)
  const bareA = audited.filter((r) => r.reason === "bare").length;
  const bare19 = audited.filter((r) => kind19(r.oldKey) === "bare").length;
  console.log(`audit：${audited.length} 条（${NODES} 节点深搜），错 ${wrong}；19.0 的句子在同一批上错 ${wrong19}；其中只说「更好的是」的 ${bareA}`);
  for (const r of audited.filter((x) => x.verdict === "wrong")) console.log("  错：", r.fen, r.played, r.zh, "—", r.why);
  res.audit = { n: audited.length, nodes: NODES, wrong, wrongPct: Math.round(wrong / audited.length * 1000) / 10,
    wrong19, wrong19Pct: Math.round(wrong19 / audited.length * 1000) / 10, bare: bareA, barePct: Math.round(bareA / audited.length * 1000) / 10,
    bare19, bare19Pct: Math.round(bare19 / audited.length * 1000) / 10 };
  if (arg("--record")) writeAudit(audited);
}
function saveDeep(deep) {
  const out = {};
  for (const k of Object.keys(deep).sort()) out[k] = deep[k];
  fs.writeFileSync(DEEP, JSON.stringify(out).replace(/\},"/g, "},\n\"") + "\n");
}

function writeAudit(audited) {
  const file = path.join(ROOT, "docs/explain-audit-20.0.md");
  const esc = (s) => String(s == null ? "" : s).replace(/\|/g, "\\|");
  const A = res.after, B = res.before;
  const doc = `# 讲解抽检（v20-0-plan §4 F1/F2）

20.0 的「你这一步」解释器（\`src/app/core/explain.js\` \`explainMove\`，事实在 \`core/facts.js\`）对着 14.0 的教练审计口径重新量。

## 怎么量的

- 同一套语料：\`scripts/fixtures/corpus.mjs\`（28 局）与低分段的 \`scripts/fixtures/coach-games.mjs\`；同一份 200 ms 的引擎缓存（\`coach-analysis.json\`），所以前后只差代码。
- 每一手 ? / ??（胜率口径）都按复盘（\`review/review.js\`）的调用方式解释。
- 四个数：**有原因**（不止「更好的是 X」，全部对局）；**说出机制**（杀、母题、威胁、松掉的子、局面或残局事实——不只是丢了 / 赢了什么，低分段；计划里的 27% 是 19.0 低分段「说出母题」的 26.8%，低分段「有原因」其实已是 61.6%，所以这里量更严的「机制」）；**只说「更好的是」**（14.0 的口径：抽检的 100 条里，计划的 25 句；全部对局的比例也列出）；**错的**（下面 100 条，对照 ${NODES.toLocaleString("en")} 节点的深搜，\`scripts/lib/explain-oracle.mjs\`）。
- \`node scripts/audit-explain.mjs --audit --record\`；结果在 \`docs/measured.json\` 的 \`explainCoverage\`，\`scripts/app/explain.test.mjs\` 检查它们达到验收。

## 结果

| | 19.0 | 20.0 | 验收 |
|---|---|---|---|
| 有原因（全部 ${A.all.mistakes} 手） | ${B.all.reasonedPct}% | **${A.all.reasonedPct}%** | ≥ 80% |
| 说出机制（低分段 ${A.low.mistakes} 手） | ${B.low.namedPct}% | **${A.low.namedPct}%** | ≥ 60% |
| 只说「更好的是 X」（下面 100 条，14.0 的口径） | ${res.audit.bare19Pct}% | **${res.audit.barePct}%** | ≤ 10% |
| 只说「更好的是 X」（全部 ${A.all.mistakes} 手） | ${B.all.barePct}% | ${A.all.barePct}% | — |
| 错的（100 条，深搜） | ${res.audit.wrong19}% | **${res.audit.wrongPct}%** | ≤ 1% |

名局语料：有原因 ${B.corpus.reasonedPct}% → ${A.corpus.reasonedPct}%，说出机制 ${B.corpus.namedPct}% → ${A.corpus.namedPct}%。低分段有原因 ${B.low.reasonedPct}% → ${A.low.reasonedPct}%。

句型（20.0，全部）：${Object.entries(A.all.byKey).sort((a, b) => b[1] - a[1]).map(([k, v]) => "`" + k + "` " + v).join("，")}。

<!-- audit:20.0:begin -->

| # | 集 | 标 | FEN（走之前） | 走的 | 19.0 | 20.0 | 判定 | 依据 |
|---|---|---|---|---|---|---|---|---|
${audited.map((r, i) => `| ${i + 1} | ${r.set === "corpus" ? "名局" : "低档"} | ${r.tag} | \`${r.fen}\` | ${esc(r.played)} | ${esc(r.oldZh || "（无）")} | ${esc(r.zh || "（无）")} | ${r.verdict === "wrong" ? "**错**" : r.verdict === "ok" ? "对" : "空"} | ${esc(r.why)} |`).join("\n")}

<!-- audit:20.0:end -->
`;
  fs.writeFileSync(file, doc);
  console.log("wrote docs/explain-audit-20.0.md");
}

if (arg("--record")) {
  if (!res.audit) { console.error("--record needs --audit"); process.exit(1); }
  record("explainCoverage", {
    what: "复盘里每一手 ? / ?? 的讲解（core/explain.js explainMove，按 review/review.js 的调用方式）：有原因、说出机制、只说「更好的是」的比例，与 100 条对照深搜的错误数",
    script: "scripts/audit-explain.mjs --audit --record",
    corpora: { corpus: "scripts/fixtures/corpus.mjs（28 局）", low: "scripts/fixtures/coach-games.mjs（低分段）" },
    passMs: MS, oracleNodes: NODES,
    acceptance: { reasonedPct: ">= 80 (all)", namedPct: ">= 60 (low)", barePct: "<= 10 (the 100 audited, as 14.0 counted its 25)", wrongPct: "<= 1 (audit)" },
    before: { all: strip(res.before.all), corpus: strip(res.before.corpus), low: strip(res.before.low), auditWrongPct: res.audit.wrong19Pct, auditBarePct: res.audit.bare19Pct },
    after: { all: strip(res.after.all), corpus: strip(res.after.corpus), low: strip(res.after.low) },
    audit: res.audit,
  });
}
function strip(v) { const { byKey, ...rest } = v; return rest; }
process.exit(0);
