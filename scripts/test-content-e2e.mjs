/**
 * Browser check for the two things 1.17 added: the six new endgame lessons and
 * the 实战 puzzle category.
 *
 * test-chess.mjs proves the *data* is well formed — every FEN loads, every
 * solution is legal and canonical, every claimed gain matches the line. What it
 * cannot see is whether any of it reaches the screen. This drives the real page
 * with real clicks: opens each lesson, checks the prose and the diagram render,
 * plays a wrong move and a right one, then does the same for a real-game tactic
 * including the demonstration that follows the key move.
 *
 * It also guards the emphasis renderer. The course has marked its key sentence
 * with `**…**` since 1.4 and the renderer set textContent, so every reader saw
 * the asterisks — 24 paragraphs of it, unnoticed through twelve releases,
 * because nothing ever looked at the rendered lesson.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when either is
 * missing, so it can sit in the suite without becoming a hard dependency —
 * except under E2E_REQUIRED=1, where a skip is a failure. The release gate
 * sets it, so "the browser tests passed" cannot mean "they never ran":
 *   node scripts/test-content-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { compileModuleSync } from "./bundle.mjs";

// the same data the page will load, so the test knows the right answers
const data = { console };
data.globalThis = data; data.window = data;
vm.createContext(data);
for (const f of ["chess.js", "lessons.js", "puzzles.js"]) {
  vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), data, { filename: "module" });
}
const Chess = data.Chess;
const LESSONS = data.CHESS_LESSONS;
const ENDGAME = LESSONS.filter((l) => l.part === "残局基础");
const OPENING = LESSONS.filter((l) => l.part === "开局入门");
const REAL = data.CHESS_PUZZLES.filter((p) => p.cat === "real");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  if (p === "/js/engine-src.js") { res.writeHead(200, { "content-type": "text/javascript" }); res.end("// stub"); return; }
  try {
    const d = fs.readFileSync(path.join(ROOT, p));
    res.writeHead(200, { "content-type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(d);
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((r) => server.listen(0, r));
const PORT = server.address().port;

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok:", msg, extra || "");
  else { failed++; console.error("FAIL:", msg, extra || ""); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.v1.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.click("#pick-cancel").catch(() => {});

/**
 * Which squares hold a piece, read off the canvas.
 * Compared by luminance spread rather than against the square's own colour:
 * every cburnett piece carries a dark outline, and in the notebook theme a
 * white piece sits on a near-white square.
 */
const occupied = () => page.evaluate(() => {
  const c = document.getElementById("board"); const g = c.getContext("2d");
  const step = c.width / 8; const on = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
    const w = Math.max(4, Math.round(step * 0.6));
    const d = g.getImageData(x, y, w, w).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
      if (l < lo) lo = l; if (l > hi) hi = l;
    }
    if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
  }
  return on.sort().join(",");
});
const squaresOf = (fen) => {
  const rows = fen.split(" ")[0].split("/"); const out = [];
  rows.forEach((row, r) => {
    let f = 0;
    for (const ch of row) { if (/\d/.test(ch)) f += +ch; else { out.push("abcdefgh"[f] + (8 - r)); f++; } }
  });
  return out.sort().join(",");
};
const squareAt = (s) => page.evaluate((x) => {
  const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
  const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
  const fl = document.body.classList.contains("flipped");
  const co = fl ? 7 - f : f, ro = fl ? 7 - rk : rk, z = r.width / 8;
  return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
}, s);
const tap = async (s) => { const p = await squareAt(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(240); };
const move = async (a, b) => { await tap(a); await tap(b); await page.waitForTimeout(300); };
// the toast element is reused rather than re-added, so read its live text
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "));
/** a lesson demonstrates its first move on entry, and swallows a click while it does */
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() => /演示中|Showing/.test(document.getElementById("lesson-task").textContent));
    if (!busy) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(200);
};

// --- every lesson in the course -------------------------------------------
// Through 1.19 this loop ran over the opening and endgame blocks only — 16 of
// 57 lessons. The other 41 had never been opened in a real page. Extending it
// turned up no app defect, but it did turn up a limitation in THIS file:
// `occupied()` reads pieces off the canvas by luminance spread, and a stars
// lesson paints its star markers on empty squares, which read exactly like
// pieces. So the expected set for a stars task is pieces ∪ stars-not-yet-taken.
await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "learn").click());
await page.waitForTimeout(500);
assert(ENDGAME.length >= 8, `残局基础有 ${ENDGAME.length} 课`);
assert(OPENING.length >= 8, `开局入门有 ${OPENING.length} 课`);
assert(LESSONS.length >= 60, `课程共 ${LESSONS.length} 课,这一轮全都要点开`);

/** what the canvas should show: the men on the board plus any live star marks */
const shown = (fen, stars) =>
  [...new Set(squaresOf(fen).split(",").filter(Boolean).concat(stars))].sort().join(",");

for (const les of LESSONS) {
  const opened = await page.evaluate((want) => {
    const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
    const row = rows.find((r) => (r.textContent || "").includes(want));
    if (!row) return false;
    row.click();
    return true;
  }, les.title);
  await page.waitForTimeout(500);
  assert(opened, `${les.id}:课程列表里点得开`);
  if (!opened) continue;

  const emph = await page.evaluate(() => ({
    stars: (document.getElementById("lesson-text").textContent.match(/\*\*/g) || []).length,
    strong: document.querySelectorAll("#lesson-text strong").length,
    paras: document.querySelectorAll("#lesson-text p").length,
  }));
  assert(emph.paras === les.text.length, `${les.id}:${les.text.length} 段课文都渲染了`, `实际 ${emph.paras} 段`);
  const wantsBold = les.text.some((p) => p.includes("**"));
  assert(emph.stars === 0 && (!wantsBold || emph.strong > 0),
    `${les.id}:重点是粗体,不是一对星号`, JSON.stringify(emph));

  await settle();
  const on = await occupied();
  // skipping/finishing the entry demo leaves the board one move past the
  // diagram, so either reading is correct
  const allowed = [];
  les.tasks.forEach((task, k) => {
    let live = task.type === "stars" ? [...(task.stars || [])] : [];
    allowed.push([`第 ${k + 1} 题`, shown(task.fen, live)]);
    const g = new Chess(task.fen);
    (task.solution || []).forEach((san, s) => {
      const mv = g.move(san)
        || g.move({ from: san.slice(0, 2), to: san.slice(2, 4), promotion: "q" });
      if (!mv) return;
      live = live.filter((sq) => sq !== mv.to); // that star has been collected
      if (task.type === "stars") {
        // the runtime hands the turn straight back, so the demo never leaves
        // the board on Black's move
        const f = g.fen().split(" "); f[1] = "w"; f[3] = "-"; g.load(f.join(" "));
      }
      allowed.push([`第 ${k + 1} 题走完第 ${s + 1} 步`, shown(g.fen(), live)]);
    });
  });
  const hit = allowed.find(([, sqs]) => sqs === on);
  assert(!!hit, `${les.id}:棋盘上摆的是这一课的局面`, hit ? hit[0] : `实际 ${on}`);
}

// 缺陷 24: the course teaches a motif once and the puzzle set holds 21 more of
// the same, with nothing joining them. The button has to appear where there is
// somewhere to go, land on a puzzle of that motif, and not exist where there is
// not — a greyed-out button here would be the P3 rule broken again.
{
  const withP = LESSONS.find((l) => l.practice === "捉双");
  const without = LESSONS.find((l) => !l.practice && l.part === "吃子与价值");
  const open = async (title) => {
    await page.evaluate((want) => {
      const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
      rows.find((r) => (r.textContent || "").includes(want))?.click();
    }, title);
    await page.waitForTimeout(400);
  };
  const btn = () => page.evaluate(() => {
    const b = document.getElementById("lesson-practice");
    return { hidden: !!b.hidden, disabled: !!b.disabled, text: b.textContent || "" };
  });

  await open(without.title);
  const off = await btn();
  assert(off.hidden, `${without.id}:没有配套题目就不显示按钮`, JSON.stringify(off));

  await open(withP.title);
  const on2 = await btn();
  assert(!on2.hidden && !on2.disabled && /\d/.test(on2.text),
    `${withP.id}:有配套题目就显示按钮,并报出题数`, JSON.stringify(on2));

  await page.evaluate(() => document.getElementById("lesson-practice").click());
  await page.waitForTimeout(700);
  const landed = await page.evaluate(() => ({
    mode: document.getElementById("app").getAttribute("data-mode"),
    goal: document.getElementById("puzzle-task").textContent || "",
  }));
  assert(landed.mode === "puzzle" && landed.goal.includes(withP.practice),
    `${withP.id}:按下去落在同一母题的题目上`, JSON.stringify(landed));

  // back to the course for the checks that follow
  await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "learn").click());
  await page.waitForTimeout(500);
}

// a wrong move on a one-answer task is refused, with that task's own hint
{
  // whichever lesson opens on a single-answer move task — naming one by id
  // meant that adding a task to the front of that lesson silently retargeted
  // this check at a task it was never written for
  const les = LESSONS.find((l) => l.tasks[0].type === "move" && l.tasks[0].goal === "one-of"
    && l.tasks[0].retry && (l.tasks[0].accept || []).length === 1);
  if (les) {
    await page.evaluate((want) => {
      const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
      rows.find((r) => (r.textContent || "").includes(want))?.click();
    }, les.title);
    await page.waitForTimeout(500);
    await settle();
    const task = les.tasks[0];
    const g = new Chess(task.fen);
    const right = task.solution[0];
    const wrong = g.moves({ verbose: true }).find((m) => m.san !== right);
    await move(wrong.from, wrong.to);
    assert((await occupied()) === squaresOf(task.fen), "走错之后局面退回原样");
    const hint = await toasts();
    assert(hint.length > 0 && hint !== "", "走错给的是这一课自己的提示", hint);
    const rm = new Chess(task.fen).moves({ verbose: true }).find((m) => m.san === right);
    await move(rm.from, rm.to);
    const advanced = await page.evaluate(() => document.getElementById("lesson-task").textContent);
    assert(!advanced.includes(les.tasks[0].prompt), "走对之后进到下一题", advanced.slice(0, 40));
  }
}

// P5 的验收条件:每个「题型 × 难度」组合非空,或该维度不出现。缺陷 14 的
// 症状是七个组合为空 —— 选中之后列表一片空白,而筛选是记住的,下次再来
// 还是空的。断言两半:提供筛选的四类每一档都有题,不提供的三类根本没有
// 这一行,而不是有一行按了没用。
await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "puzzle").click());
await page.waitForTimeout(400);
{
  const pick = async (cat, tier) => page.evaluate(([c, t]) => {
    const cb = [...document.querySelectorAll("#puzzle-cat-seg button")].find((b) => b.dataset.cat === c);
    if (!cb) return { ok: false };
    cb.click();
    const row = document.getElementById("row-puzzle-tier");
    const shown = !row.hidden && getComputedStyle(row).display !== "none";
    const tb = [...document.querySelectorAll("#puzzle-tier-seg button")].find((b) => b.dataset.tier === t);
    if (tb) tb.click();
    return { ok: true, shown, n: document.getElementById("puzzle-list").children.length };
  }, [cat, tier]);

  for (const cat of ["tac", "real", "def", "op"]) {
    for (const tier of ["easy", "mid", "hard"]) {
      const r = await pick(cat, tier);
      await page.waitForTimeout(150);
      assert(r.ok && r.shown && r.n > 0, `${cat} × ${tier}:这一档有题(${r.n})`);
    }
  }
  // reset, then the three mate categories must not offer the axis at all
  await pick("tac", "all");
  for (const cat of ["m1", "m2", "m3"]) {
    const r = await pick(cat, "all");
    await page.waitForTimeout(150);
    assert(r.ok && !r.shown, `${cat}:不提供难度筛选这一行`);
  }
  await pick("tac", "all");
}

// --- the real-game tactics ------------------------------------------------
await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "puzzle").click());
await page.waitForTimeout(400);
const hasTab = await page.evaluate(() => {
  const btn = [...document.querySelectorAll("#puzzle-cat-seg button")].find((b) => b.dataset.cat === "real");
  if (!btn) return false;
  btn.click();
  return true;
});
await page.waitForTimeout(500);
assert(hasTab, "题型里有「实战」这一档");
assert(REAL.length >= 15, `实战题有 ${REAL.length} 道`);

if (hasTab && REAL.length) {
  const listed = await page.evaluate(() => document.getElementById("puzzle-list").children.length);
  assert(listed === REAL.length, "实战题全部出现在列表里", `${listed}/${REAL.length}`);

  const goal = await page.evaluate(() => document.getElementById("puzzle-task").textContent || "");
  assert(/满盘\s*\d+\s*个子/.test(goal) && /净得\s*\d+\s*分/.test(goal), "题面写明子数与净得", goal.trim());
  assert(!/\{\d\}/.test(goal), "题面没有漏翻的占位符");

  // whichever puzzle the list opens on is the first one
  const p = REAL[0];
  const g = new Chess(p.fen);
  const wrong = g.moves({ verbose: true }).find((m) => m.san !== p.line[0]);
  await move(wrong.from, wrong.to);
  assert((await occupied()) === squaresOf(p.fen), "走错会被退回,棋盘不留痕");
  assert(/只有一步|不是最强/.test(await toasts()), "走错给的是实战题自己的提示", await toasts());

  const key = new Chess(p.fen).moves({ verbose: true }).find((m) => m.san === p.line[0]);
  await move(key.from, key.to);
  await page.waitForTimeout(500);
  const end = new Chess(p.fen);
  for (const san of p.line) end.move(san);
  assert((await occupied()) === squaresOf(end.fen()),
    "关键着之后自动走完演示,棋盘停在线路末端", `期望 ${squaresOf(end.fen())}`);

  // the difficulty filter has to actually split this category
  const tiers = new Set(REAL.map((q) => {
    const loud = /[+#x]/.test(q.line[0]);
    return !loud ? "hard" : q.gain >= 5 ? "easy" : q.gain >= 3 ? "mid" : "hard";
  }));
  assert(tiers.size === 3, "难度筛选在这一档里分得开三档", [...tiers].join("/"));
}

// --- the course actually reaches the screen in every language ---------------
// 1.21 added 1027 Japanese strings. Everything above runs in the default
// Chinese, so without this the whole translation could be unreachable — a
// wrong table name in app.js would leave the guards green and the screen
// English. Switch languages for real and read the lesson off the page.
{
  const kana = /[぀-ヿ]/;
  const latinWord = /[A-Za-z]{4,}/;
  // The puzzle section above left the page in puzzle mode, so the lesson panel
  // still held the last lesson opened — all three languages read back the same
  // stale Chinese and two assertions failed on the test's own mistake, not the
  // app's. Go back to learn mode first.
  await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "learn").click());
  await page.waitForTimeout(500);
  for (const [lang, wants] of [["ja", "kana"], ["en", "latin"], ["zh-CN", "han"]]) {
    const switched = await page.evaluate((id) => {
      const b = document.querySelector(`button[data-lang="${id}"]`);
      if (!b) return false;
      b.click();
      return true;
    }, lang);
    assert(switched, `${lang}:界面上有这个语言的按钮`);
    if (!switched) continue;
    await page.waitForTimeout(500);
    await page.evaluate(() => {
      const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
      if (rows[0]) rows[0].click();
    });
    await page.waitForTimeout(500);
    const shown = await page.evaluate(() => ({
      title: document.querySelector("#lesson-title, .lesson-title")?.textContent || "",
      body: document.getElementById("lesson-text").textContent || "",
    }));
    assert(shown.body.length > 20, `${lang}:第一课的课文渲染出来了`, JSON.stringify(shown).slice(0, 120));
    if (wants === "kana") {
      assert(kana.test(shown.body), "ja:课文里有假名,不是回退到了英文或中文", shown.body.slice(0, 80));
    }
    if (wants === "latin") {
      assert(latinWord.test(shown.body), "en:课文是英文", shown.body.slice(0, 80));
      assert(!kana.test(shown.body), "en:英文课文里不该混进假名", shown.body.slice(0, 80));
    }
    if (wants === "han") {
      assert(/[一-鿿]/.test(shown.body) && !kana.test(shown.body), "zh-CN:切回中文后课文是中文", shown.body.slice(0, 80));
    }
  }
}

// --- 为你出一题:三级阶梯在真页面上各走一级 ---------------------------------
// picker.js 的纯函数有单测;这里按的是真按钮 —— 读到的存档、跳到的题、说出
// 的理由,三样都得对得上。每一级用「只有这一级的条件为真」的存档进门,所以
// toast 说的理由不可能靠巧合对。
{
  const openWith = async (puzzles) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((pz) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (pz) localStorage.setItem("chess.v1.puzzles", JSON.stringify(pz));
    }, puzzles);
    const page = await ctx.newPage();
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1000);
    return { ctx, page };
  };
  const smart = async (page) => {
    await page.click("#puzzle-smart");
    await page.waitForTimeout(500);
    return page.evaluate(() => ({
      toast: document.getElementById("toast").textContent.trim(),
      cat: JSON.parse(localStorage.getItem("chess.v1.puzzles")).cat,
      task: (document.getElementById("puzzle-task") || {}).textContent || "",
    }));
  };

  // 复习级:欠着一题,推荐必须先还债
  {
    const { ctx, page } = await openWith({ v: 1, idv: 2, solved: {}, missed: { "w-hangq": { s: 0, n: 1 } }, cat: "m1" });
    const r = await smart(page);
    assert(r.cat === "review" && /先清复习/.test(r.toast), "欠着复习时,按钮把人带进复习队列", r.toast);
    assert(/还欠 1 题/.test(r.toast), "……而且说清了欠几题", r.toast);
    await ctx.close();
  }
  // 弱项级:def 三次全错的存档,推荐落在防守
  {
    const { ctx, page } = await openWith({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1",
      tally: { def: { miss: 3, solve: 0 }, m1: { miss: 0, solve: 4 } } });
    const r = await smart(page);
    assert(r.cat === "def" && /防守.*错得最多/.test(r.toast), "错误率最高的类别被点名(防守)", r.toast);
    await ctx.close();
  }
  // 探索级:没有任何历史,推荐去覆盖最少的类别,并说明是探索
  {
    const { ctx, page } = await openWith(null);
    const r = await smart(page);
    assert(/没怎么练过/.test(r.toast), "没有数据时说的是「去没练过的地方」,不是假装知道弱项", r.toast);
    assert(r.cat && r.cat !== "review", "……并真的切到了一个具体类别(" + r.cat + ")");
    await ctx.close();
  }
}

// --- 做题战绩:推荐的记忆终于看得见,而且两张嘴说同一个类别 ------------------
{
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1",
      tally: { def: { miss: 3, solve: 0 }, m1: { miss: 0, solve: 4 } } }));
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1000);
  const tally = await pg.evaluate(() => ({
    headShown: !document.getElementById("puzzle-tally-head").hidden,
    rows: [...document.querySelectorAll("#puzzle-tally-body .stat-row")].map((r) => r.textContent.trim()),
  }));
  assert(tally.headShown && tally.rows.length === 2, "有作答记录的两个类别各占一行,其余不画", tally.rows.join(" | "));
  assert(/防守.*错得最多/.test(tally.rows[0]), "错误率最高的一行排最前并带标记", tally.rows[0]);
  assert(/失手 3/.test(tally.rows[0]) && /解出 4/.test(tally.rows[1]), "数字就是存档里的数字", tally.rows.join(" | "));
  // the same page, the other mouth: the toast must name the same category
  await pg.evaluate(() => document.querySelector('#side [data-tab="play"]').click());
  await pg.waitForTimeout(300);
  await pg.click("#puzzle-smart");
  await pg.waitForTimeout(500);
  const toast2 = await pg.evaluate(() => document.getElementById("toast").textContent.trim());
  assert(/防守.*错得最多/.test(toast2), "推荐 toast 与记录页标的是同一个类别", toast2);
  await ctx2.close();
}
// 空 tally:整节不出现
{
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx2.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1000);
  assert(await pg.evaluate(() => document.getElementById("puzzle-tally-head").hidden),
    "没有任何作答记录时,「做题战绩」整节不画");
  await ctx2.close();
}

// --- 执黑背谱:同一条谱换把椅子 ---------------------------------------------
// 静态守卫盯的是源码形状;这里验的是真棋盘上的三件事:执黑时棋盘翻转且白方
// 谱着已经走出、应错被退回并有教练说法、整条线应完只写 `:b` 键 —— 白方进度
// 一格不动。第一条线的期望着法由测试自己从 ECO 书推出,和应用同一来源。
{
  for (const f of ["openings.js", "drills.js"]) {
    vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), data, { filename: "module" });
  }
  const rows = data.ChessDrills.drillLines(data.CHESS_OPENINGS)
    .map(([eco, nameId, seq]) => ({ eco, nameId, seq, line: seq.split(" ") }))
    .sort((a, b) => (a.eco < b.eco ? -1 : a.eco > b.eco ? 1
      : (data.CHESS_OPENING_NAMES[a.nameId] || "").localeCompare(data.CHESS_OPENING_NAMES[b.nameId] || "", "zh")));
  const first = rows[0];
  const firstId = data.ChessDrills.drillId(first.eco, first.seq);
  // the canvas reader labels cells as if unflipped, so on a flipped board a
  // real square shows up under its point-mirrored name
  const mirror = (sqs) => sqs.split(",").map((s) =>
    "abcdefgh"[7 - (s.charCodeAt(0) - 97)] + (9 - +s[1])).sort().join(",");

  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "op" }));
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1000);

  const occ = () => pg.evaluate(() => {
    const c = document.getElementById("board"); const g = c.getContext("2d");
    const step = c.width / 8; const on = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
      const w = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x, y, w, w).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
    }
    return on.sort().join(",");
  });
  const tapB = async (s) => { // black chair: the board is flipped
    const p = await pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
      const co = 7 - f, ro = 7 - rk, z = r.width / 8;
      return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
    }, s);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(240);
  };
  const moveB = async (a, b) => { await tapB(a); await tapB(b); await pg.waitForTimeout(420); };

  // the side row exists in the op category, White in front
  const seg = await pg.evaluate(() => {
    const row = document.getElementById("row-op-side");
    return { shown: !!row && !row.hidden,
      active: document.querySelector("#op-side-seg button.active")?.dataset.side };
  });
  assert(seg.shown && seg.active === "w", "开局类有「执方」一行,默认执白", JSON.stringify(seg));

  // sit down on Black's side: board flips and White's book move is already out
  await pg.click('#op-side-seg button[data-side="b"]');
  await pg.waitForTimeout(600);
  const g2 = new Chess(); g2.move(first.line[0]);
  assert(await occ() === mirror(squaresOf(g2.fen())),
    "执黑开题:棋盘翻转,白方第一着已经走出", `期望镜像 ${first.line[0]}`);
  const taskB = await pg.evaluate(() => document.getElementById("puzzle-task").textContent || "");
  assert(/执黑/.test(taskB), "题面写明这是执黑练习", taskB.trim());

  // a wrong reply is taken back, with the coach naming why
  const wrong = g2.moves({ verbose: true }).find((m) => m.san !== first.line[1]);
  await moveB(wrong.from, wrong.to);
  assert(await occ() === mirror(squaresOf(g2.fen())), "应错被退回,棋盘不留痕");
  const why = await pg.evaluate(() => document.getElementById("toast").textContent.trim());
  assert(why.length > 4, "应错有教练的说法,不是无声拒绝", why);

  // answer the whole line: each Black book move, White's reply plays itself
  for (let i = 1; i < first.line.length; i += 2) {
    const m = g2.moves({ verbose: true }).find((x) => x.san === first.line[i]);
    await moveB(m.from, m.to);
    g2.move(first.line[i]);
    if (i + 1 < first.line.length) g2.move(first.line[i + 1]);
  }
  await pg.waitForTimeout(600);
  const after = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(!!after.solved[firstId + ":b"], "应完整条线,解出记在 `:b` 键上");
  assert(!after.solved[firstId], "……白方那把椅子的进度一格没动");

  // back on White's side: no pre-played move, and the row is op-only (P3)
  await pg.click('#op-side-seg button[data-side="w"]');
  await pg.waitForTimeout(600);
  assert(await occ() === squaresOf(new Chess().fen()), "切回执白:初始局面,没有预走的着");
  await pg.evaluate(() => [...document.querySelectorAll("#puzzle-cat-seg button")].find((b) => b.dataset.cat === "m1").click());
  await pg.waitForTimeout(400);
  assert(await pg.evaluate(() => document.getElementById("row-op-side").hidden),
    "别的题型里「执方」这一行不存在");
  await ctx2.close();
}

// --- 错题自炼:自己的失着变成题,在真页面上走一遍 ----------------------------
// 挖题函数是纯的,单测直接喂分析数组;这里验的是「已入库的错题」在界面上的
// 全部承诺:没有错题时标签不存在(P3),有则出现;题面写明实战走了什么、亏了
// 多少;重蹈覆辙和一般走错各有各的说法;做对写 solved、做错进复习队列;执黑
// 的错题棋盘翻转 —— 全部骑在现成轨道上。
{
  // a real position pair so every move in the drill is a legal chess fact
  const gW = new Chess(); // start: "played e4 (??), engine wanted Nf3" — synthetic but legal
  const wFen = gW.fen();
  gW.move("e4");
  const bFen = gW.fen(); // black to move after 1.e4: "played e5, engine wanted c5"
  const MINES_FIXTURE = [
    { id: "mine:t1", cat: "mine", fen: wFen, solution: ["Nf3"], played: "e4", loss: 350, ply: 4, t: 1700000000000 },
    { id: "mine:t2", cat: "mine", fen: bFen, solution: ["c5"], played: "e5", loss: 210, ply: 5, t: 1700000000000, side: "b" },
  ];

  // no mines: the tab must not exist (P3 — absent, not greyed)
  {
    const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx2.addInitScript(() => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
    });
    const pg = await ctx2.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(900);
    assert(await pg.evaluate(() => document.querySelector('#puzzle-cat-seg button[data-cat="mine"]').hidden),
      "没有错题时,「错题」标签不存在");
    await ctx2.close();
  }

  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript((mines) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.mines", JSON.stringify({ v: 1, list: mines }));
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "mine" }));
  }, MINES_FIXTURE);
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);

  const tapAt = async (s, flipped) => {
    const p = await pg.evaluate(([x, fl]) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
      const co = fl ? 7 - f : f, ro = fl ? 7 - rk : rk, z = r.width / 8;
      return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
    }, [s, !!flipped]);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(240);
  };
  const mv2 = async (a, b, fl) => { await tapAt(a, fl); await tapAt(b, fl); await pg.waitForTimeout(360); };
  const toastText = () => pg.evaluate(() => document.getElementById("toast").textContent.trim());

  // the tab exists, the first drill is served, and the goal names the sin
  const seg = await pg.evaluate(() => {
    const b = document.querySelector('#puzzle-cat-seg button[data-cat="mine"]');
    return { hidden: b.hidden, active: b.classList.contains("active") };
  });
  assert(!seg.hidden && seg.active, "有错题时「错题」标签出现且被选中", JSON.stringify(seg));
  const goal = await pg.evaluate(() => document.getElementById("puzzle-task").textContent || "");
  assert(/e4/.test(goal) && /更强/.test(goal) && /3\.5/.test(goal),
    "题面写明实战走了 e4、当时亏 3.5 分", goal.trim());
  const listNames = await pg.evaluate(() => {
    document.querySelector("details.reading-index").open = true;
    return document.getElementById("puzzle-list").textContent;
  });
  assert(/错题 11-1[45] · 第 3 手/.test(listNames), "题名是日期加手数,不是编造的棋名", listNames.slice(0, 60));

  // repeating the game's move gets its own message; another wrong move the generic one
  await mv2("e2", "e4");
  assert(/实战里丢分的那一手/.test(await toastText()), "重蹈覆辙被单独点名", await toastText());
  await mv2("d2", "d4");
  assert(/更强的一手/.test(await toastText()), "一般走错说的是「引擎另有更强一手」", await toastText());
  // …and both wrongs queued it for review
  let st = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(!!st.missed["mine:t1"], "走错的错题进了复习队列");

  // the right move solves it and says so in the mine voice
  await mv2("g1", "f3");
  assert(/找回了这一手/.test(await toastText()), "做对的话音是「找回了这一手」", await toastText());
  st = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(st.solved["mine:t1"] === true, "解出写进 solved,和普通题同一条轨");

  // the black drill flips the board — same rails as the black opening drills
  await pg.click("#puzzle-next");
  await pg.waitForTimeout(500);
  const occ2 = await pg.evaluate(() => {
    const c = document.getElementById("board"); const g = c.getContext("2d");
    const step = c.width / 8; const on = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
      const w = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x, y, w, w).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
    }
    return on.sort().join(",");
  });
  const mirror = (sqs) => sqs.split(",").map((s) =>
    "abcdefgh"[7 - (s.charCodeAt(0) - 97)] + (9 - +s[1])).sort().join(",");
  assert(occ2 === mirror(squaresOf(bFen)), "执黑的错题棋盘翻转,局面就是失着前那一刻");
  await mv2("c7", "c5", true);
  assert(/找回了这一手/.test(await toastText()), "执黑错题照样能解", await toastText());
  await ctx2.close();
}

// --- 今天的训练 + 进步:教练排课在真页面上走一步,进步区按数据显隐 ----------
{
  // A. 有欠账的存档:课表第一步是清复习,真解掉那题后课表自己前进
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: { "w-hangq": { s: 0, n: 1 } }, cat: "m1" }));
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel").catch(() => {});

  const btnText = () => pg.evaluate(() => document.getElementById("daily-btn").textContent.trim());
  assert(await btnText() === "今天的训练", "开工前按钮只是一句邀请,不报进度");
  await pg.click("#daily-btn");
  await pg.waitForTimeout(700);
  const step1 = await btnText();
  assert(/第 1\/\d 步 · 先清复习 1 题/.test(step1), "第一步永远是欠账", step1);
  const st1 = await pg.evaluate(() => ({
    mode: JSON.parse(localStorage.getItem("chess.v1.settings")).mode,
    cat: JSON.parse(localStorage.getItem("chess.v1.puzzles")).cat,
  }));
  assert(st1.mode === "puzzle" && st1.cat === "review", "点它真的把人带到复习队列", JSON.stringify(st1));
  // solve the one owed puzzle (w-hangq: Rxd6) — the queue empties, the plan advances
  const tapP = async (s) => {
    const p = await pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
      return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
    }, s);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(240);
  };
  await tapP("d2"); await tapP("d6");
  await pg.waitForTimeout(600);
  const step2 = await btnText();
  assert(/第 2\/\d 步/.test(step2), "清完欠账,课表自己走到第二步", step2);
  await ctx2.close();

  // B. 进步区:没有数据整节不画;种入两周的档案就出现,数字如实
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx3.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg3 = await ctx3.newPage();
  await pg3.goto(`http://127.0.0.1:${PORT}/`);
  await pg3.waitForTimeout(900);
  assert(await pg3.evaluate(() => document.getElementById("trend-head").hidden),
    "没有任何进步数据时,「进步」整节不存在(P3)");
  await ctx3.close();

  const ctx4 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx4.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    // two ISO weeks of defence answers around "now", plus mined/redeemed this week
    const now = Date.now(), W = 7 * 86400000;
    const wk = (t) => { // the app's own weekKey algorithm, restated for the seed
      const d = new Date(t);
      const th = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + 3);
      const j4 = new Date(th.getFullYear(), 0, 4);
      const n = 1 + Math.round(((th - j4) / 86400000 - 3 + ((j4.getDay() + 6) % 7)) / 7);
      return th.getFullYear() + "-W" + String(n).padStart(2, "0");
    };
    const weeks = {};
    weeks[wk(now - W)] = { cats: { def: { m: 2, s: 2 } }, mined: 0, red: 0 };
    weeks[wk(now)] = { cats: { def: { m: 0, s: 3 } }, mined: 3, red: 1 };
    localStorage.setItem("chess.v1.progress", JSON.stringify({ v: 1, weeks, days: {} }));
    // three analysed games for the sparkline
    localStorage.setItem("chess.v1.stats", JSON.stringify({ v: 2, games: [
      { id: "g1", t: now - 3 * W, diff: "normal", color: "w", result: "loss", moves: 40, pgn: "1. e4 e5", acc: 62 },
      { id: "g2", t: now - W, diff: "normal", color: "w", result: "win", moves: 40, pgn: "1. e4 e5", acc: 71 },
      { id: "g3", t: now, diff: "normal", color: "w", result: "win", moves: 40, pgn: "1. e4 e5", acc: 78 },
    ] }));
  });
  const pg4 = await ctx4.newPage();
  pg4.on("pageerror", (e) => errs.push(e.message));
  await pg4.goto(`http://127.0.0.1:${PORT}/`);
  await pg4.waitForTimeout(900);
  const trend = await pg4.evaluate(() => ({
    head: !document.getElementById("trend-head").hidden,
    curve: !document.getElementById("trend-acc").hidden,
    rows: [...document.querySelectorAll("#trend-body .stat-row")].map((r) => r.textContent.trim()),
  }));
  assert(trend.head && trend.curve, "有数据时「进步」节与准确率走势都画出来了", JSON.stringify(trend));
  assert(trend.rows.some((r) => /防守/.test(r) && /本周 0%/.test(r) && /上周 50%/.test(r)),
    "防守一行:本周 0% 对上周 50% — 数字就是档案里的数字", trend.rows.join(" | "));
  assert(trend.rows.some((r) => /错题/.test(r) && /收 3/.test(r) && /找回 1/.test(r)),
    "错题一行:本周收 3 · 找回 1", trend.rows.join(" | "));
  await ctx4.close();
}

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
console.log(failed ? `\n${failed} 项未通过` : "\nall passed");
process.exit(failed ? 1 : 0);
