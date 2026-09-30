/**
 * The advanced course part 3 (v8-2-plan T1), without a browser or an engine.
 *
 * test-chess.mjs holds the 24 lessons to every rule the rest of the course
 * keeps (legal positions, canonical SAN, goals met, three languages, the
 * README's numbers). This file checks what is particular to them:
 *
 *   1 目录    the ids trainer/lessons-adv.js keeps in the bundle are the
 *            chunk's lessons, in order; 计算 12 then 局面型 12; 3–5 steps
 *            each, every one a move the engine can judge
 *   2 核对    docs/lessons-verified.json (scripts/verify-lessons.mjs) covers
 *            every task: same position, same accepted set as the runner
 *            computes from the task today, judged ok, with a source — so a
 *            lesson edited after its check fails here until it is re-checked
 *   3 分块    the chunk is registered and names the global the shell loads;
 *            the built bundle carries the ids, not the lessons
 *   4 占位课  before the chunk arrives a placeholder has no words and no
 *            tasks (the list skips it, a start waits); reading one asks for
 *            the chunk, and once it is here the words read through
 *
 *   node scripts/test-lessons-adv.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { ROOT, loadAppModules } from "./lib/app-module.mjs";
import { CHUNKS, compileModuleSync } from "./bundle.mjs";
import { acceptedMoves, SOURCES } from "./verify-lessons.mjs";

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg, extra === undefined ? "" : extra); }
};

const data = loadAppModules(["src/web/js/chess.js", "src/web/js/lessons-adv-chunk.js"]);
const Chess = data.Chess;
const ADV = data.CHESS_LESSONS_ADV;
const LESSONS = ADV.lessons;

// ------------------------------------------------------------------ 1 目录
const shellSrc = fs.readFileSync(path.join(ROOT, "src/web/js/trainer/lessons-adv.js"), "utf8");
const shell = { console, Math, Date };
shell.globalThis = shell; shell.window = shell;
shell.setTimeout = (fn, ms) => setTimeout(fn, ms);
vm.createContext(shell);
vm.runInContext(compileModuleSync(path.join(ROOT, "src/web/js/trainer/lessons-adv.js")), shell);
const IDS = shell.ADV_IDS;
{
  assert(Array.isArray(IDS) && IDS.length === 24, "主包的目录有 24 课", IDS && IDS.length);
  assert(JSON.stringify(IDS) === JSON.stringify(LESSONS.map((L) => L.id)), "目录与分块里的课一一对应、顺序相同");
  const parts = LESSONS.map((L) => L.part);
  assert(parts.slice(0, 12).every((p) => p === "计算") && parts.slice(12).every((p) => p === "局面型"),
    "前 12 课是「计算」，后 12 课是「局面型」（v8-2-plan §8 第 7 条）", [...new Set(parts)].join(" / "));
  const steps = LESSONS.filter((L) => L.tasks.length < 3 || L.tasks.length > 5).map((L) => L.id + " " + L.tasks.length);
  assert(!steps.length, "每课 3–5 步", steps.join(", "));
  const odd = LESSONS.flatMap((L) => L.tasks.filter((t) => t.type !== "move" || !["one-of", "mate"].includes(t.goal)).map(() => L.id));
  assert(!odd.length, "每一步都是走子题（one-of 或 mate），引擎能判对错", odd.join(", "));
  const noEn = LESSONS.filter((L) => !ADV.en[L.id] || !ADV.ja[L.id]).map((L) => L.id);
  assert(!noEn.length, "分块里每课都带英文和日文", noEn.join(", "));
}

// ------------------------------------------------------------------ 2 核对
{
  const file = path.join(ROOT, "docs/lessons-verified.json");
  const rec = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : null;
  assert(!!rec, "docs/lessons-verified.json 存在");
  if (rec) {
    assert(rec.depth >= 18 && rec.tie <= 50, "核对的深度 ≥ 18、容差 ≤ 50 cp", rec.depth + " / " + rec.tie);
    const byId = new Map(rec.lessons.map((l) => [l.id, l]));
    let n = 0;
    const stale = [], notOk = [], noSrc = [];
    for (const L of LESSONS) {
      const r = byId.get(L.id);
      if (!r || r.tasks.length !== L.tasks.length) { stale.push(L.id + "（记录里没有或步数不同）"); continue; }
      L.tasks.forEach((t, i) => {
        n++;
        const row = r.tasks[i];
        const want = acceptedMoves(Chess, t).slice().sort().join(",");
        if (row.fen !== t.fen || row.accept.slice().sort().join(",") !== want) stale.push(L.id + "#" + i);
        if (!row.ok) notOk.push(L.id + "#" + i + " " + (row.why || []).join("; "));
        if (!row.src || row.src !== (SOURCES[L.id] || [])[i]) noSrc.push(L.id + "#" + i);
      });
    }
    assert(n === LESSONS.reduce((a, L) => a + L.tasks.length, 0), "记录覆盖全部 " + n + " 步");
    assert(!stale.length, "每一步的局面和「算对」的着法集合与记录相同（改了课要重跑 verify-lessons）", stale.join(", "));
    assert(!notOk.length, "记录里每一步都通过：接受的着法与引擎最佳同级，拒绝的最佳着法差得更多", notOk.join(" | "));
    assert(!noSrc.length, "每一步都记了局面出处", noSrc.join(", "));
    assert(rec.summary && rec.summary.failed === 0 && rec.summary.tasks === n, "记录的汇总：0 步失败", JSON.stringify(rec.summary));
  }
}

// ------------------------------------------------------------------ 3 分块
{
  const c = CHUNKS.find((x) => x.out.endsWith("chunk-lessons-adv.js"));
  assert(!!c && c.entry === "src/web/js/lessons-adv-chunk.js" && c.global === "CHESS_LESSONS_ADV",
    "bundle.mjs 的分块表里有 chunk-lessons-adv.js（全局名 CHESS_LESSONS_ADV）");
  assert(shell.ADV_CHUNK && shell.ADV_CHUNK.file === "chunk-lessons-adv.js" && shell.ADV_CHUNK.global === "CHESS_LESSONS_ADV",
    "外壳加载的分块名与全局名与分块表一致");
  const bundle = path.join(ROOT, "src/web/js/bundle.js"), chunk = path.join(ROOT, "src/web/js/chunk-lessons-adv.js");
  if (fs.existsSync(bundle) && fs.existsSync(chunk)) {
    const b = fs.readFileSync(bundle, "utf8"), k = fs.readFileSync(chunk, "utf8");
    const words = LESSONS.map((L) => L.title).concat(LESSONS.map((L) => ADV.en[L.id].title));
    const leaked = words.filter((w) => b.includes(w));
    assert(!leaked.length, "主包里没有课文（只有 id）", leaked.slice(0, 3).join(" / "));
    assert(words.every((w) => k.includes(w)) && k.includes(LESSONS[0].tasks[0].fen), "课文与局面都在 chunk-lessons-adv.js 里（" + (Buffer.byteLength(k) / 1024).toFixed(1) + " KB）");
    assert(IDS.every((id) => b.includes('"' + id + '"')), "主包带着 24 个课程 id");
  } else {
    console.log("  (没有构建产物，跳过主包 / 分块内容的检查 —— 先 npm run build)");
  }
}

// ------------------------------------------------------------------ 4 占位课
{
  let ready = 0;
  const adv = shell.createAdvLessons(() => { ready++; });
  const s0 = adv.stubs[0];
  assert(adv.stubs.length === 24 && adv.stubs.every((s, i) => s.id === IDS[i]), "24 个占位课，id 与目录相同");
  assert(s0.title === "" && s0.part === "" && s0.tasks.length === 0 && s0.text.length === 0 && !adv.ready(),
    "分块到之前：占位课没有文字、没有步（目录跳过它，开课要等）");
  await new Promise((r) => setTimeout(r, 20));
  assert(!adv.ready() && ready === 0, "取不到分块时不算到了（下次读的时候再取）");
  // the chunk arrives: the page's <script> would put this global on the window
  shell.CHESS_LESSONS_ADV = ADV;
  void s0.title; // reading the words is what asks for it
  await new Promise((r) => setTimeout(r, 20));
  assert(adv.ready() && ready === 1, "读到占位课的文字就去取分块；到了以后通知重画一次");
  assert(s0.title === LESSONS[0].title && s0.tasks === LESSONS[0].tasks && s0.part === "计算",
    "分块到了以后，占位课的标题、课文和步都来自分块");
  assert(adv.stubs[23].part === "局面型" && adv.stubs[23].tasks.length === LESSONS[23].tasks.length, "最后一课也读得到");

  // the words other languages read go through lazy-content's tables
  const lz = { console, Math, Date };
  lz.globalThis = lz; lz.window = lz;
  vm.createContext(lz);
  vm.runInContext(compileModuleSync(path.join(ROOT, "src/web/js/lazy-content.js")), lz);
  assert(lz.ChessLazy.langTables("en").lessonsAdv === undefined, "分块没到：没有进阶课的译文表");
  lz.CHESS_LESSONS_ADV = ADV;
  assert(lz.ChessLazy.langTables("en").lessonsAdv === ADV.en && lz.ChessLazy.langTables("ja").lessonsAdv === ADV.ja,
    "分块到了：lazy-content 把 en / ja 译文表交给查表");
}

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
console.log("all advanced-lesson tests passed");
