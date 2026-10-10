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
/** M2 review: a file held back (ms) or refused ("fail") — the advanced lessons' chunk */
const held = {};
const server = http.createServer(async (req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  if (held[p] === "fail") { res.writeHead(404); res.end(); return; }
  if (held[p]) await new Promise((r) => setTimeout(r, held[p]));
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
  localStorage.setItem("chess.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(1000);
await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

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
      // v8-0-plan A5: the top-right corner carries a move's ✓ / ✗ badge — a
      // mark on the square, not a man on it
      const px = (i / 4) % w, py = Math.floor(i / 4 / w);
      if (px > w * 0.5 && py < w * 0.5) continue;
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
// the toast element is reused rather than re-added, so read its live text.
// 7.7 (v7-7-plan §4): a puzzle's right / wrong is said on its feedback card
// beside the board, so that is read with the toasts.
const toasts = () => page.evaluate(() => [...document.querySelectorAll(".toast, #puzzle-feedback")].map((x) => x.textContent).join(" | "));
/** a lesson demonstrates its first move on entry, and swallows a click while it does */
const settle = async () => {
  for (let i = 0; i < 40; i++) {
    const busy = await page.evaluate(() => /演示中|Showing/.test(document.getElementById("lesson-task").textContent));
    if (!busy) break;
    await page.waitForTimeout(150);
  }
  await page.waitForTimeout(200);
};

/**
 * 9.0 S3: into 训练 at segment `seg` (course | puzzle | endgame | classic) —
 * the rail's 训练, then the switch over the panel. The old mode segment
 * ([data-mode] learn / puzzle) is gone; this is the player's way in now.
 */
async function toTrain(pg, seg) {
  const lit = () => pg.evaluate(() => {
    const row = document.getElementById("train-seg");
    const b = row && !row.hidden && row.querySelector("button[data-seg].active");
    return b ? b.dataset.seg : null;
  });
  if (!(await lit())) { await pg.click('#rail button[data-view="train"]'); await pg.waitForTimeout(300); }
  if ((await lit()) !== seg) { await pg.click('#train-seg button[data-seg="' + seg + '"]'); await pg.waitForTimeout(300); }
  // the list is drawn only while its fold is open (9.0 S3: a kind is thousands)
  if (seg === "puzzle") await openPuzzleList(pg);
  return lit();
}
async function openPuzzleList(pg) {
  const shut = await pg.evaluate(() => { const f = document.getElementById("pz-list-fold"); return !!f && !f.open; });
  if (shut) { await pg.click("#pz-list-fold > summary"); await pg.waitForTimeout(200); }
}

/**
 * 9.0 S1: 今天's hero card — the plan's step (or the game in progress) on a
 * board, its go button, and the plan as a list of steps. Read on the page
 * itself (the rail's 今天): it is drawn only where it is seen.
 */
async function todayHero(pg) {
  await pg.click('#rail button[data-view="home"]');
  await pg.waitForTimeout(400);
  return pg.evaluate(() => ({
    view: document.getElementById("app").getAttribute("data-view"),
    title: document.getElementById("today-hero-title").textContent.trim(),
    meta: document.getElementById("today-hero-meta").textContent.trim(),
    go: document.getElementById("today-go").textContent.trim(),
    steps: [...document.querySelectorAll("#daily-plan .daily-step")].map((li) => ({
      what: (li.querySelector(".daily-what") || {}).textContent || "",
      cur: li.classList.contains("current"), done: li.classList.contains("done") })),
  }));
}

// --- every lesson in the course -------------------------------------------
// Through 1.19 this loop ran over the opening and endgame blocks only — 16 of
// 57 lessons. The other 41 had never been opened in a real page. Extending it
// turned up no app defect, but it did turn up a limitation in THIS file:
// `occupied()` reads pieces off the canvas by luminance spread, and a stars
// lesson paints its star markers on empty squares, which read exactly like
// pieces. So the expected set for a stars task is pieces ∪ stars-not-yet-taken.
assert(await toTrain(page, "course") === "course", "9.0 S3：从导航进训练 · 课程");
await page.waitForTimeout(200);
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
    fen: window.__chess.puzzle(),
  }));
  // 10.0 M0: the goal line no longer names the motif (it gave the answer
  // away), so the puzzle is identified by its position — one of the set the
  // button draws from, the tactics labelled with the lesson's motif
  const place = (f) => (f || "").split(" ")[0];
  const pool = data.CHESS_PUZZLES.filter((p) => p.cat === "tac" && p.motif === withP.practice).map((p) => place(p.fen));
  assert(landed.mode === "puzzle" && pool.includes(place(landed.fen)) && !landed.goal.includes(withP.practice),
    `${withP.id}:按下去落在同一母题的题目上(题面不说母题)`, JSON.stringify(landed));

  // back to the course for the checks that follow
  await toTrain(page, "course");
  await page.waitForTimeout(200);
}

// 10.0 M0: a tap task counts its taps in words of its own (点第 x 处，共 n 处),
// not as a bare (1/3) beside the lesson's dots and Today's 第 x 项
{
  const les = LESSONS.find((l) => l.tasks[0].type === "tap");
  await page.evaluate((want) => {
    const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
    rows.find((r) => (r.textContent || "").includes(want))?.click();
  }, les.title);
  await page.waitForTimeout(500);
  await settle();
  const said = await page.evaluate(() => document.getElementById("lesson-task").textContent);
  const n = les.tasks[0].steps.length;
  assert(said.endsWith("（点第 1 处，共 " + n + " 处）") && !/\(\d\/\d\)/.test(said), "10.0 M0 点格子的题按「第几处」计数", said);
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

// P5 的验收条件是「选得到的就有题」—— 缺陷 14 是选中之后列表一片空白。9.0 S3
// 起难度筛选（#row-puzzle-tier）和题型行都没有了，选得到的是六块「按类做题」：
// 每一块亮着的都得有题、点下去棋盘上有题、列表不空，而且亮的就是点的那块。
await toTrain(page, "puzzle");
await page.waitForTimeout(400);
{
  const tiles = await page.evaluate(() => [...document.querySelectorAll("#pz-groups button[data-group]")]
    .filter((b) => !b.hidden).map((b) => ({ g: b.dataset.group, n: (b.querySelector(".pz-tile-n") || {}).textContent || "" })));
  assert(tiles.length === 5 && !tiles.some((x) => x.g === "mine"), "9.0 S3：没有错题时五块按类做题（我的错题不出现）", JSON.stringify(tiles));
  for (const { g, n } of tiles) {
    await page.click('#pz-groups button[data-group="' + g + '"]');
    let r = null;
    for (let i = 0; i < 30; i++) {
      await page.waitForTimeout(150);
      r = await page.evaluate((x) => ({
        lit: [...document.querySelectorAll("#pz-groups button.active")].map((b) => b.dataset.group),
        n: document.getElementById("puzzle-list").children.length,
        task: document.getElementById("puzzle-task").textContent || "",
      }), g);
      if (r.n > 0 && !/载入|loading/i.test(r.task)) break;
    }
    const count = Number((/\d+/.exec(n) || ["0"])[0]);
    assert(count > 0 && r.n > 0 && r.lit.length === 1 && r.lit[0] === g && r.task.length > 0,
      `9.0 S3 ${g}：这一块有题（${n}），点下去列表 ${r.n} 道、棋盘上有题，亮的就是它`, JSON.stringify(r).slice(0, 160));
  }
}

// --- the real-game tactics ------------------------------------------------
// 9.0 S3: 实战 is no tab of its own any more — it is part of 战术 (win · tac ·
// real, with the Lichess tactics), and a real-game puzzle is opened from that
// tile's list.
await toTrain(page, "puzzle");
await page.waitForTimeout(400);
await page.click('#pz-groups button[data-group="tactic"]');
await page.waitForTimeout(800);
const realRow = (name) => new RegExp("^(✓ )?\\d+\\. " + name + "$");
const realListed = () => page.evaluate((re) => [...document.querySelectorAll("#puzzle-list button[data-i]")]
  .filter((b) => new RegExp(re).test(b.textContent)).map((b) => b.textContent), realRow("实战 \\d\\d").source);
const hasTab = (await realListed()).length > 0;
assert(hasTab, "「战术」这一块里有实战题");
assert(REAL.length >= 15, `实战题有 ${REAL.length} 道`);

if (hasTab && REAL.length) {
  const listed = (await realListed()).length;
  assert(listed === REAL.length, "实战题全部出现在「战术」的列表里", `${listed}/${REAL.length}`);
  const openedReal = await page.evaluate((re) => {
    const b = [...document.querySelectorAll("#puzzle-list button[data-i]")].find((x) => new RegExp(re).test(x.textContent));
    if (b) b.click();
    return !!b;
  }, realRow(REAL[0].name).source);
  await page.waitForTimeout(500);
  assert(openedReal, `从列表里点开${REAL[0].name}`);

  const goal = await page.evaluate(() => document.getElementById("puzzle-task").textContent || "");
  assert(/满盘\s*\d+\s*个子/.test(goal) && /净得\s*\d+\s*分/.test(goal), "题面写明子数与净得", goal.trim());
  assert(!/\{\d\}/.test(goal), "题面没有漏翻的占位符");

  // the one just opened from the list
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

  // the filter is gone (9.0 S3), the tiers are not: a local puzzle's rating
  // is its tier's (puzzle-rating.js), so 实战 has to span all three
  const tiers = new Set(REAL.map((q) => {
    const loud = /[+#x]/.test(q.line[0]);
    return !loud ? "hard" : q.gain >= 5 ? "easy" : q.gain >= 3 ? "mid" : "hard";
  }));
  assert(tiers.size === 3, "实战题分得开三档难度（三档题目评级）", [...tiers].join("/"));
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
  await toTrain(page, "course");
  await page.waitForTimeout(300);
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
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (pz) localStorage.setItem("chess.puzzles", JSON.stringify(pz));
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
      cat: JSON.parse(localStorage.getItem("chess.puzzles")).cat,
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
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "record", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1",
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
  // 9.0: the tally is on 我的, 为你出一题 on 训练 · 谜题
  await toTrain(pg, "puzzle");
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
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, appearance: "dark", boardId: "wood" }));
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
  const rows = data.ChessDrills.orderDrills(data.ChessDrills.drillLines(data.CHESS_OPENINGS)
    .map(([eco, nameId, seq]) => ({ eco, nameId, seq, line: seq.split(" ") })), data.CHESS_OPENING_NAMES);
  const first = rows[0];
  const firstId = data.ChessDrills.drillId(first.eco, first.seq);
  // the canvas reader labels cells as if unflipped, so on a flipped board a
  // real square shows up under its point-mirrored name
  const mirror = (sqs) => sqs.split(",").map((s) =>
    "abcdefgh"[7 - (s.charCodeAt(0) - 97)] + (9 - +s[1])).sort().join(",");

  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "op" }));
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
        // v8-0-plan A5: the top-right corner is a move's ✓ / ✗ badge, not a man
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        if (px > w * 0.5 && py < w * 0.5) continue;
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
  // not any book reply either: the tree takes every book move (7.6), and after
  // 1.e4 the first legal reply a Black could pick may well be one of them
  const bookReplies = new Set(data.CHESS_OPENINGS.map((r) => r[2].split(" "))
    .filter((sans) => sans[0] === first.line[0] && sans[1]).map((sans) => sans[1]));
  const wrong = g2.moves({ verbose: true }).find((m) => m.san !== first.line[1] && !bookReplies.has(m.san));
  await moveB(wrong.from, wrong.to);
  assert(await occ() === mirror(squaresOf(g2.fen())), "应错被退回,棋盘不留痕");
  // 7.7: on the puzzle's feedback card (a cross, 再想想, the coach's reason)
  const why = await pg.evaluate(() => document.getElementById("puzzle-fb-sub").textContent.trim());
  assert(why.length > 4, "应错有教练的说法,不是无声拒绝", why);

  // answer the whole line: each Black book move, White's reply plays itself.
  // White's reply is weighted among the book's children (6.0), so it is read
  // off the board rather than assumed to be the line's; Black answers with a
  // book move from wherever that leads, until the book runs out (a leaf).
  const walked = [first.line[0]];
  const bookNext = () => {
    const nx = [];
    for (const [, , seq] of data.CHESS_OPENINGS) {
      const sans = seq.split(" ");
      if (sans.length > walked.length && walked.every((x, i) => sans[i] === x)) nx.push(sans[walked.length]);
    }
    return nx.includes(first.line[walked.length]) ? first.line[walked.length] : nx[0];
  };
  for (let guard = 0; guard < 40; guard++) {
    const san = bookNext();
    if (!san) break;
    const m = g2.moves({ verbose: true }).find((x) => x.san === san);
    await moveB(m.from, m.to);
    g2.move(san); walked.push(san);
    if (!bookNext()) break;
    // White's reply plays itself after a pause, and WebKit on CI can be
    // slower than the fixed wait (#85): poll until the board has moved on
    // from the position Black just made, rather than reading it once
    const mine = mirror(squaresOf(g2.fen()));
    let seen = await occ();
    for (let t = 0; t < 40 && seen === mine; t++) { await pg.waitForTimeout(100); seen = await occ(); }
    // the reply by name, from the board's live region (announceLastMove):
    // occupancy alone cannot tell two captures by the same piece apart —
    // after …Nxe4, 9.Nxe4 and 9.Nxf7 both leave g5 and land on an occupied
    // square, and guessing the wrong one lost the line (CI, #85)
    const said = ((await pg.evaluate(() => document.getElementById("board-live")?.textContent || "")).trim().split(/\s+/).pop() || "");
    const legal = g2.moves();
    const reply = legal.includes(said) && (() => { const t = new Chess(g2.fen()); t.move(said); return mirror(squaresOf(t.fen())) === seen; })() ? said
      : legal.find((w) => { const t = new Chess(g2.fen()); t.move(w); return mirror(squaresOf(t.fen())) === seen; });
    if (!reply) break;
    g2.move(reply); walked.push(reply);
  }
  // The solve is recorded once the line's last move has landed: poll for it
  // (up to 4 s) instead of trusting one fixed pause. White's replies are weighted among the book's children, so the walk can
  // leave the puzzle's own line (after 1.e4 e5 2.Nf3 Nc6 it may go 3.Bb5).
  // Then the app credits the line actually played (the leaf's drill, and any
  // shorter drill the path completed) — so the key to expect is the opened
  // puzzle's only if the walk stayed on its line; otherwise any Black key.
  const stayed = first.line.every((san, i) => i >= walked.length || walked[i] === san);
  const credited = (a) => a && a.solved && (stayed ? !!a.solved[firstId + ":b"]
    : Object.keys(a.solved).some((k) => k.endsWith(":b") && a.solved[k]));
  let after = null;
  for (let t = 0; t < 40; t++) {
    await pg.waitForTimeout(100);
    after = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
    if (credited(after)) break;
  }
  assert(credited(after), "应完整条线,解出记在 `:b` 键上" + (stayed ? "" : "(白方应着离开了这道题的线,记在实际走完的那条线上)"), walked.join(" "));
  assert(!after.solved[firstId], "……白方那把椅子的进度一格没动");

  // back on White's side: no pre-played move, and the row is op-only (P3)
  await pg.click('#op-side-seg button[data-side="w"]');
  await pg.waitForTimeout(600);
  assert(await occ() === squaresOf(new Chess().fen()), "切回执白:初始局面,没有预走的着");
  // 7.6 (Codex on #79): the tree accepts any book move, so the player can
  // finish on a leaf shorter than any drill (e.g. 1.b4 is a whole book line).
  // That leaf is no drill of its own: the credit has to land on the drill that
  // was opened, or it is counted nowhere — not in 背下来 N/M, not by the plan
  const firstMoves = new Map();
  for (const [, , seq] of data.CHESS_OPENINGS) {
    const sans = seq.split(" ");
    const k = sans[0];
    if (!firstMoves.has(k)) firstMoves.set(k, []);
    firstMoves.get(k).push(sans.length);
  }
  const leaf = [...firstMoves].find(([m, lens]) => m !== first.line[0] && lens.every((n) => n === 1));
  if (leaf) {
    const lm = new Chess().moves({ verbose: true }).find((x) => x.san === leaf[0]);
    const tapW = async (s) => {
      const p = await pg.evaluate((x) => {
        const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
        const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
        return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
      }, s);
      await pg.mouse.click(p.x, p.y);
      await pg.waitForTimeout(240);
    };
    await tapW(lm.from); await tapW(lm.to);
    await pg.waitForTimeout(700);
    const st = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
    const known = new Set(rows.map((r) => data.ChessDrills.drillId(r.eco, r.seq)));
    const credited = Object.keys(st.solved).filter((k) => !k.endsWith(":b"));
    assert(credited.length === 1 && credited[0] === firstId && known.has(credited[0]),
      `走到比任何一题都短的书上叶子（1.${leaf[0]}），记账落在开题的那道题上，不是一个谁也数不到的 id`,
      JSON.stringify(credited));
    // back to the start for what follows
    await pg.click('#op-side-seg button[data-side="w"]');
    await pg.waitForTimeout(600);
  }
  assert(await pg.evaluate(() => { const b = document.querySelector('#pz-groups button[data-group="opening"]'); return b.classList.contains("active") && !document.querySelector('#pz-groups button[data-group="mate"]').classList.contains("active"); }),
    "9.0 S3：背谱时亮的是「开局」这一块");
  await pg.click('#pz-groups button[data-group="mate"]');
  await pg.waitForTimeout(400);
  assert(await pg.evaluate(() => document.getElementById("row-op-side").hidden),
    "别的题型里「执方」这一行不存在（换到杀棋）");
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
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
    });
    const pg = await ctx2.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(900);
    assert(await pg.evaluate(() => document.querySelector('#pz-groups button[data-group="mine"]').hidden),
      "没有错题时,「我的错题」这一块不存在");
    await ctx2.close();
  }

  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript((mines) => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.mines", JSON.stringify({ v: 1, list: mines }));
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "mine" }));
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
  // 7.7 (v7-7-plan §4): the drill's verdict is on the feedback card
  const toastText = () => pg.evaluate(() => document.getElementById("puzzle-feedback").textContent.trim());

  // the tab exists, the first drill is served, and the goal names the sin
  const seg = await pg.evaluate(() => {
    const b = document.querySelector('#pz-groups button[data-group="mine"]');
    return { hidden: b.hidden, active: b.classList.contains("active"), n: b.querySelector(".pz-tile-n").textContent };
  });
  assert(!seg.hidden && seg.active && /2/.test(seg.n), "有错题时「我的错题」这一块出现、被选中、数着 2 道", JSON.stringify(seg));
  const goal = await pg.evaluate(() => document.getElementById("puzzle-task").textContent || "");
  assert(/e4/.test(goal) && /更强/.test(goal) && /3\.5/.test(goal),
    "题面写明实战走了 e4、当时亏 3.5 分", goal.trim());
  await openPuzzleList(pg);
  const listNames = await pg.evaluate(() => {
    return document.getElementById("puzzle-list").textContent;
  });
  assert(/错题 11-1[45] · 第 3 手/.test(listNames), "题名是日期加手数,不是编造的棋名", listNames.slice(0, 60));

  // repeating the game's move gets its own message; another wrong move the generic one
  await mv2("e2", "e4");
  assert(/实战里丢分的那一手/.test(await toastText()), "重蹈覆辙被单独点名", await toastText());
  await mv2("d2", "d4");
  assert(/更强的一手/.test(await toastText()), "一般走错说的是「引擎另有更强一手」", await toastText());
  // …and both wrongs queued it for review
  let st = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
  assert(!!st.missed["mine:t1"], "走错的错题进了复习队列");

  // the right move solves it and says so in the mine voice
  await mv2("g1", "f3");
  assert(/找回了这一手/.test(await toastText()), "做对的话音是「找回了这一手」", await toastText());
  st = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
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
        // v8-0-plan A5: the top-right corner is a move's ✓ / ✗ badge, not a man
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        if (px > w * 0.5 && py < w * 0.5) continue;
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
  // v8-0-plan B1: the hover hint (grabbableAt) admitted White's men only, so
  // over a black drill — and every black Lichess puzzle to come — the pawn
  // you are meant to move showed the plain arrow, not the grab hand. Then
  // solve it by dragging.
  {
    const at = (s) => pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
      return { x: r.left + (7 - f + .5) * z, y: r.top + (7 - rk + .5) * z };
    }, s);
    const a = await at("c7"), b = await at("c5");
    await pg.mouse.move(a.x - 3, a.y - 3); await pg.mouse.move(a.x, a.y, { steps: 2 });
    const cursor = await pg.evaluate(() => document.getElementById("board").style.cursor);
    assert(cursor === "grab", "执黑错题:鼠标移到黑兵上是「抓手」", cursor);
    await pg.mouse.down();
    await pg.mouse.move(a.x + 6, a.y + 6, { steps: 3 });
    await pg.mouse.move(b.x, b.y, { steps: 6 }); await pg.mouse.up();
    await pg.waitForTimeout(600);
  }
  assert(/找回了这一手/.test(await toastText()), "执黑错题照样能解——拖子也行", await toastText());
  await ctx2.close();
}

// --- 今天的训练 + 进步:教练排课在真页面上走一步,进步区按数据显隐 ----------
{
  // A. 有欠账的存档:课表第一步是清复习,真解掉那题后课表自己前进
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: { "w-hangq": { s: 0, n: 1 } }, cat: "m1" }));
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

  // 9.0 S1: the plan is 今天's hero card; its go button (#today-go) starts it
  const h0 = await todayHero(pg);
  assert(h0.view === "home" && h0.go === "开始" && h0.steps.length > 1 && !h0.steps.some((x) => x.cur || x.done),
    "开工前:今天的主卡片按钮是「开始」,课表里没有哪一步算开始了", JSON.stringify(h0));
  assert(/^先清复习 1 题$/.test(h0.title) && /到期的复习/.test(h0.meta) && /今天第 1 项，共 \d 项/.test(h0.meta) && h0.steps[0].what === h0.title,
    "第一步永远是欠账(主卡片和课表第一行都是它)", JSON.stringify(h0));
  await pg.click("#today-go");
  await pg.waitForTimeout(700);
  const st1 = await pg.evaluate(() => ({
    mode: JSON.parse(localStorage.getItem("chess.settings")).mode,
    cat: JSON.parse(localStorage.getItem("chess.puzzles")).cat,
    view: document.getElementById("app").getAttribute("data-view"),
  }));
  assert(st1.mode === "puzzle" && st1.cat === "review" && st1.view === "train", "点「开始」真的把人带到训练 · 复习队列", JSON.stringify(st1));
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
  const h2 = await todayHero(pg);
  const step2 = h2.title;
  assert(/今天第 2 项，共 \d 项/.test(h2.meta) && h2.go === "接着做" && h2.steps[0].done && h2.steps[1].cur && !/复习/.test(step2),
    "清完欠账,课表自己走到第二步(今天的按钮成了「接着做」)", JSON.stringify(h2));
  await pg.click('#rail button[data-view="train"]');
  await pg.waitForTimeout(400);
  // 7.6 §3g: the prominent 下一题 on the solved puzzle follows the plan. The
  // review queue is empty now, and 7.5 answered 下一题 there with 「复习清空了」
  // and 一步杀 — the plan's second step (上一课新的) was never reached from it.
  assert(await pg.evaluate(() => document.getElementById("puzzle-next").classList.contains("primary")),
    "解出之后「下一题」是那个醒目的按钮");
  await pg.click("#puzzle-next");
  await pg.waitForTimeout(700);
  const st2 = await pg.evaluate(() => ({
    mode: JSON.parse(localStorage.getItem("chess.settings")).mode,
    cat: JSON.parse(localStorage.getItem("chess.puzzles")).cat,
  }));
  assert(/学一节新课/.test(step2) ? st2.mode === "learn" : st2.cat !== "m1",
    "计划进行中,「下一题」进的是计划的下一步(" + step2 + "),不是一步杀", JSON.stringify(st2));
  await ctx2.close();

  // B. 进步区:没有数据整节不画;种入两周的档案就出现,数字如实
  const ctx3 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx3.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, appearance: "dark", boardId: "wood" }));
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
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "record", soundOn: false, appearance: "dark", boardId: "wood" }));
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
    localStorage.setItem("chess.progress", JSON.stringify({ v: 1, weeks, days: {} }));
    // three analysed games for the sparkline
    localStorage.setItem("chess.stats", JSON.stringify({ v: 2, games: [
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
  // 7.6: the figure is the solve rate and says so — a clean week of three
  // solves reads 100%, not the old unlabelled miss rate "0%"
  assert(trend.rows.some((r) => /防守/.test(r) && /本周正确率 100%/.test(r) && /上周 50%/.test(r)),
    "防守一行:本周正确率 100% 对上周 50% — 数字就是档案里的数字,且写明是正确率", trend.rows.join(" | "));
  assert(trend.rows.some((r) => /错题/.test(r) && /收 3/.test(r) && /找回 1/.test(r)),
    "错题一行:本周收 3 · 找回 1", trend.rows.join(" | "));
  await ctx4.close();
}

// --- 摸得到的复盘:悬停着法,棋盘跟着;移开,回到原位 -------------------------
// 曲线拖拽与 PV 悬停需要分析数据(无头起不了引擎,由源码守卫+单测盯);着法
// 列表的悬停预览只要有棋谱就能验:双人局走两步,悬停第一步 —— 棋盘显示第一
// 步后的局面而光标一格没动;移开 —— 棋盘立刻回到第二步后。
{
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood", autoFlipPvp: false }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});

  const tap2 = async (s) => {
    const p = await pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
      return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
    }, s);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(220);
  };
  const occ2 = () => pg.evaluate(() => {
    const c = document.getElementById("board"); const g = c.getContext("2d");
    const step = c.width / 8; const on = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
      const w = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x, y, w, w).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        // v8-0-plan A5: the top-right corner is a move's ✓ / ✗ badge, not a man
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        if (px > w * 0.5 && py < w * 0.5) continue;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
    }
    return on.sort().join(",");
  });

  await tap2("e2"); await tap2("e4");
  await tap2("e7"); await tap2("e5");
  const g2 = new Chess(); g2.move("e4");
  const afterOne = squaresOf(g2.fen());
  g2.move("e5");
  const afterTwo = squaresOf(g2.fen());
  assert(await occ2() === afterTwo, "双人局走了 1. e4 e5,棋盘停在第二步后");

  await pg.hover('#move-list button[data-i="1"]');
  await pg.waitForTimeout(250);
  assert(await occ2() === afterOne, "悬停第一步:棋盘显示那一步之后的局面");
  const cur = await pg.evaluate(() =>
    document.querySelector("#move-list .current")?.dataset.i || "");
  assert(cur === "2", "……而落子光标一格没动(current 仍在第 2 步)", cur);

  await pg.mouse.move(40, 40);
  await pg.waitForTimeout(250);
  assert(await occ2() === afterTwo, "移开指针:棋盘立刻回到落子处,不留预览");
  await ctx2.close();
}

// --- 6.1(复查):以将杀 / 逼和局面开局的 [FEN] 必须能导入 ------------------
//
// 6.1 把 ChessEditor.validate 接进了 PGN 导入,用来挡住 chess.js 会接受的
// 不可能局面。但 validate 还有一条只属于编辑器的规则:没有合法着法就拒绝——
// 摆一个已经结束的局面在编辑器里确实没意义,而一份从将杀局面起始的研究文件,
// 或一局已经下完的棋,是再正常不过的 PGN,6.1 之前一直导得进来。
//
// 走拖放这条真实入口:#pgn-open 在折叠起来的面板里,点不到,而拖放和它进的是
// 同一个 importPgnText。盯的是产品行为,不是 app.js 的源码形状。
{
  const ctx3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  const pg = await ctx3.newPage();
  pg.on("pageerror", (e) => errs.push("import-fen: " + e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/index.html`);
  await pg.waitForSelector("#board");
  await pg.waitForTimeout(600);

  const boardOf = () => pg.evaluate(() => {
    const c = document.getElementById("board"); const g = c.getContext("2d");
    const step = c.width / 8; const on = [];
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x = Math.round(f * step + step * 0.2), y = Math.round(r * step + step * 0.2);
      const w = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x, y, w, w).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        // v8-0-plan A5: the top-right corner is a move's ✓ / ✗ badge, not a man
        const px = (i / 4) % w, py = Math.floor(i / 4 / w);
        if (px > w * 0.5 && py < w * 0.5) continue;
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l; if (l > hi) hi = l;
      }
      if (hi - lo > 60) on.push("abcdefgh"[f] + (8 - r));
    }
    return on.sort().join(",");
  });
  const drop = async (name, text) => {
    // 不用 new DataTransfer() / new DragEvent():两者在 WebKit 上不一定能构造,
    // 而处理器只读 ev.dataTransfer.files[0],一个普通对象就够,两个引擎都能跑
    await pg.evaluate(({ name, text }) => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", {
        value: { files: [new File([text], name, { type: "application/x-chess-pgn" })] },
      });
      window.dispatchEvent(ev);
    }, { name, text });
    await pg.waitForTimeout(1200);
  };
  const studyPgn = (fen) => [
    '[Event "Study"]', '[Site "?"]', '[Date "????.??.??"]', '[Round "?"]',
    '[White "?"]', '[Black "?"]', '[Result "1-0"]',
    '[SetUp "1"]', `[FEN "${fen}"]`, "", "1-0", "",
  ].join("\n");

  const MATE_FEN = "7k/5KQ1/8/8/8/8/8/8 b - - 0 1";
  await drop("mate.pgn", studyPgn(MATE_FEN));
  assert(await boardOf() === squaresOf(MATE_FEN),
    "将杀局面的 [FEN] 导进来了,棋盘就是文件里那三个子", await boardOf());

  // 而编辑器那条真正的守卫没被削弱:不可能的局面照样挡在门外,棋盘一动不动
  await drop("two-kings.pgn", studyPgn("4k3/8/8/8/8/8/8/K3K3 w - - 0 1"));
  assert(await boardOf() === squaresOf(MATE_FEN),
    "两个白王的 [FEN] 仍被拒,棋盘停在上一份文件上", await boardOf());
  await ctx3.close();
}

// --- 7.6:导入的棋局,结果只说结果,对阵栏用棋谱里的名字 ---------------------
// [Result "1-0"] 只记了谁赢,没记为什么;状态栏原来写「黑方认输」—— 编出来的
// 原因。对阵栏原来写「玩家 1 / 玩家 2」,文件里明明有 [White] / [Black]。
{
  const ctx5 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx5.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx5.newPage();
  pg.on("pageerror", (e) => errs.push("import-result: " + e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/index.html`);
  await pg.waitForSelector("#board");
  await pg.waitForTimeout(600);
  const drop = async (text) => {
    await pg.evaluate((text) => {
      const ev = new Event("drop", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "dataTransfer", {
        value: { files: [new File([text], "g.pgn", { type: "application/x-chess-pgn" })] },
      });
      window.dispatchEvent(ev);
    }, text);
    await pg.waitForTimeout(1000);
    if (await pg.isVisible("#confirm-ok")) { await pg.click("#confirm-ok"); await pg.waitForTimeout(800); }
  };
  const seen = () => pg.evaluate(() => ({
    status: (document.getElementById("status") || {}).textContent || "",
    w: document.getElementById("white-role").textContent,
    b: document.getElementById("black-role").textContent,
  }));
  await drop('[Event "Club"]\n[White "Anderssen"]\n[Black "Kieseritzky"]\n[Result "1-0"]\n\n1. e4 e5 2. f4 exf4 1-0\n');
  let s = await seen();
  assert(/1-0/.test(s.status) && /白方胜/.test(s.status) && !/认输/.test(s.status),
    "导入的 1-0:状态栏只说「1-0 · 白方胜」,不编一个认输的原因", s.status);
  assert(s.w === "Anderssen" && s.b === "Kieseritzky",
    "对阵栏用棋谱里的 White / Black 名字", JSON.stringify(s));
  await drop('[Event "?"]\n[White "?"]\n[Black "?"]\n[Result "1/2-1/2"]\n\n1. d4 d5 1/2-1/2\n');
  s = await seen();
  assert(/½-½/.test(s.status) && !/协议/.test(s.status),
    "导入的和棋同样只说结果,不说「协议和棋」", s.status);
  assert(s.w === "玩家 1" && s.b === "玩家 2", "名字是「?」的棋谱,退回玩家 1 / 玩家 2", JSON.stringify(s));
  await ctx5.close();
}

// 顶栏与题面,同屏两处,不说同一句话 (7.3 B4)
// 7.2 的顶栏 chip 直接返回 puzzleGoalText():
//   顶栏  「实战里你走了 d3 —— 找出更强的一手 · 当时亏 3.2 分」
//   题面  「第 1 题 · 实战里你走了 d3 —— 找出更强的一手 · 当时亏 3.2 分 · 评级 1500」
// 一字不差。现在顶栏说「第几题 · 哪一类」,题面说目标、细节与来源。
// 三语各跑一遍:重复是从一句共用的文案里来的,不是从中文里来的。
{
  const MINE = [{ id: "mine:a", cat: "mine",
    fen: "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
    solution: ["Ng5"], played: "d3", loss: 320, ply: 6, t: 1758200000000,
    rev: { budget: 200, src: "lib" }, from: { kind: "lib", id: "g0" }, motif: "fork" }];
  for (const lang of ["zh-CN", "en", "ja"]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang });
    await ctx.addInitScript(([l, mines]) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "puzzle", langId: l, sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.mines", JSON.stringify({ v: 1, list: mines }));
      localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "mine" }));
    }, [lang, MINE]);
    const pg = await ctx.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(1000);
    const seen = await pg.evaluate(() => ({
      chip: (document.getElementById("status") || {}).textContent || "",
      task: (document.getElementById("puzzle-task") || {}).textContent || "",
    }));
    assert(seen.chip.length > 0 && seen.task.length > 0,
      lang + ":顶栏与题面都有字", JSON.stringify(seen));
    assert(!seen.task.includes(seen.chip) && !seen.chip.includes(seen.task),
      lang + ":顶栏不是题面的一截,题面也不是顶栏的一截", JSON.stringify(seen));
    // 再严一点:任意 8 个字的连续片段都不该同时出现在两处。整句相同只是
    // 最刺眼的那种重复,半句相同一样是同屏读两遍。
    //
    // 这一条在 CI 上抓到过一个真的:英文里顶栏是「Puzzle 1」,题面末尾是
    // 「Puzzle 1500」—— 一个是第几题,一个是这道题的评级,两个毫不相干的数
    // 戴着同一个名词并排站着(三语都这样,英文最糟,两串字面上就是前缀关系)。
    // 评级的那个名字已经改成 Rated / 评级 / レーティング,叫它本来是的东西。
    const shared = (() => {
      const N = 8;
      for (let i = 0; i + N <= seen.chip.length; i++) {
        const frag = seen.chip.slice(i, i + N);
        if (seen.task.includes(frag)) return frag;
      }
      return "";
    })();
    assert(!shared, lang + ":两处没有 8 字以上的重叠" + (shared ? "(「" + shared + "」)" : ""),
      JSON.stringify(seen));
    // 顶栏确实说了「第几题」——这是它接手的那件事
    assert(/\d/.test(seen.chip), lang + ":顶栏报出第几题", seen.chip);
    // 这里原本还断言「题面上没有四位数的评级」—— 写错了。B1 定下的规则是
    // 背谱类(op / rep)不进评级,**别的都进**,错题也在内(isRatedCat =
    // !isOpeningCat)。错题的题面本来就该带着它的评级,7.2 起的既有断言也是
    // 这么钉的。这条是照着计划文档里一句顺带的话写的,不是照着规则写的。
    await ctx.close();
  }
}

// --- 7.5 §3:开局书外的开局,族名也说中文 -----------------------------------
// 1.e4 c5 2.Bc4 是 B20 Sicilian Defense: Bowdler Attack,开局书没有这条线。
// 以前侧栏整条显示英文;现在族名本地化、变例名保留英文。表是按需加载的分块,
// 所以等它到了再读。
{
  const ctx5 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx5.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood", autoFlipPvp: false }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await ctx5.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const tap5 = async (s) => {
    const p = await pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
      return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
    }, s);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(220);
  };
  await tap5("e2"); await tap5("e4");
  await tap5("c7"); await tap5("c5");
  await tap5("f1"); await tap5("c4");
  let line = "";
  for (let i = 0; i < 30; i++) {
    line = await pg.evaluate(() => document.getElementById("opening-line").textContent);
    if (/B20/.test(line) && /Bowdler/.test(line)) break;
    await pg.waitForTimeout(150);
  }
  assert(line === "B20 · 西西里防御：Bowdler Attack", "开局书外的 B20:族名说中文,变例名保留英文", line);
  await ctx5.close();
}

// --- v8-0-plan F5:分块之后,首帧仍是存下的语言 ------------------------------
// 英文、日文(字典 + 课文题名开局名)和挖掘题都搬出了 bundle.js。index.html
// 先跑 chunk-boot.js,按存下的设置把要用的分块写在 bundle.js 前面。这里在
// DOMContentLoaded 那一刻读页面 —— bundle 同步跑完、任何「晚到再补」都还没
// 发生的时刻:那时标题和界面字若还是中文,就是闪了一帧错的语言。
{
  const han = /[一-鿿]/;
  for (const [lang, mode, want] of [
    ["en", "puzzle", ["chunk-lang-en.js", "chunk-mined.js"]],
    ["ja", "pvp", ["chunk-lang-en.js", "chunk-lang-ja.js"]],
    ["zh-CN", "pvp", []],
  ]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await c.addInitScript(([l, m]) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: m, langId: l, sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      document.addEventListener("DOMContentLoaded", () => {
        const res = performance.getEntriesByType("resource").map((r) => r.name.split("/").pop());
        window.__dcl = {
          title: document.title,
          lang: document.documentElement.lang,
          // the rail's labels: the first [data-i18n] on the page is the
          // rail's 今天 now, and in Japanese that is all kanji (今日) — the
          // rail as a whole says whether the words are the saved language's
          undo: [...document.querySelectorAll("#rail [data-i18n]")].map((e) => e.textContent).join(" / "),
          chunks: res.filter((n) => /^chunk-/.test(n)),
          mined: !!window.MINED_PUZZLES,
          pz: (document.getElementById("puzzle-progress") || {}).textContent || "",
        };
      });
    }, [lang, mode]);
    const pg = await c.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(1500);
    const r = await pg.evaluate(() => Object.assign({}, window.__dcl, {
      later: performance.getEntriesByType("resource").map((e) => e.name.split("/").pop()).filter((n) => /^chunk-/.test(n)),
      pzLater: (document.getElementById("puzzle-progress") || {}).textContent || "",
    }));
    assert(r.lang === lang, `F5 ${lang}:DOMContentLoaded 时 <html lang> 已经是 ${lang}`, r.lang);
    if (lang === "zh-CN") assert(han.test(r.title), "F5 zh-CN:首帧标题是中文", r.title);
    else if (lang === "en") assert(!han.test(r.title) && !han.test(r.undo), "F5 en:首帧标题和界面字没有一帧中文", r.title + " / " + r.undo);
    // 日文也写汉字,看假名
    else assert(/[぀-ヿ]/.test(r.title) && /[぀-ヿ]/.test(r.undo), "F5 ja:首帧标题和界面字已是日文", r.title + " / " + r.undo);
    // which chunks, not in what order: WebKit lists two script fetches that
    // start together in the other order from Chromium (CI, #85)
    const early = r.chunks.filter((n) => n !== "chunk-boot.js").sort();
    assert(JSON.stringify(early) === JSON.stringify([...want].sort()),
      `F5 ${lang}/${mode}:首帧前取的分块正好是要用的那几个`, early.join(", ") || "(无)");
    if (mode === "puzzle") {
      assert(r.mined && r.pz === r.pzLater, "F5:以做题模式启动,挖掘题在首帧前就在,题数不会在首帧后跳一下", r.pz + " → " + r.pzLater);
    } else {
      assert(!r.mined && r.later.includes("chunk-mined.js"), "F5:其余模式首帧不带挖掘题,首帧后才取", r.later.join(", "));
    }
    await c.close();
  }
}

// Codex on #85: a language whose chunk is still on its way must not land
// after the player has already picked another one. Red before: 日本語 (slow
// chunk) then back to 中文 — the Japanese load finished last and switched the
// page, and the saved setting, to Japanese.
{
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const pg = await c.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.route(/chunk-lang-(en|ja)\.js/, async (route) => { await new Promise((r) => setTimeout(r, 1200)); await route.continue(); });
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1200);
  await pg.evaluate(() => document.querySelector('#lang-seg button[data-lang="ja"]').click());
  await pg.waitForTimeout(100);
  await pg.evaluate(() => document.querySelector('#lang-seg button[data-lang="zh-CN"]').click());
  await pg.waitForTimeout(2500);
  const r = await pg.evaluate(() => ({ lang: document.documentElement.lang,
    saved: JSON.parse(localStorage.getItem("chess.settings") || "{}").langId }));
  assert(r.lang === "zh-CN" && r.saved === "zh-CN", "F5:换到还在加载的语言后又换回中文,晚到的分块不再把界面切过去", JSON.stringify(r));
  await c.close();
}

// --- v8-0-plan §5: 暂定评级标「定级中」(9.0 S6 之前是「?」),开局题从常见开局开始 -------------------
// Red before §5: the record page printed 「1104 ±200」 for a rating two
// answers old, and the opening list began at A01 Nimzo-Larsen (1.b3).
{
  for (const [rd, want, label] of [[200, "1104（定级中）", "暂定"], [60, "1104", "稳定"]]) {
    const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await c.addInitScript((d) => {
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "puzzle", langId: "zh-CN", sideTab: "record", soundOn: false }));
      localStorage.setItem("chess.panelOpen", "1");
      const now = Date.now();
      localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "m1",
        tally: { m1: { miss: 1, solve: 2 } }, rating: { r: 1104, rd: d, vol: 0.06 }, ratedAt: now, rhist: [{ t: now - 1000, r: 1180 }, { t: now, r: 1104 }] }));
    }, rd);
    const pg = await c.newPage();
    pg.on("pageerror", (e) => errs.push(e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(1000);
    await pg.click('#rail button[data-view="me"]').catch(() => {});
    await pg.waitForTimeout(300);
    const meta = await pg.evaluate(() => (document.getElementById("rating-meta") || {}).textContent || "");
    const m = /谜题等级分 (\S+)/.exec(meta);
    assert(!!m && m[1] === want, `§5 ${label}评级(RD ${rd})写作「${want}」`, meta);
    await c.close();
  }
  // the opening list opens on the Italian Game, not on 1.b3
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "puzzle", langId: "zh-CN", soundOn: false }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "op" }));
  });
  const pg = await c.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1000);
  await openPuzzleList(pg);
  const first = await pg.evaluate(() => {
    const cur = document.querySelector("#puzzle-list .lesson-item.current");
    return cur ? cur.textContent.trim() : "";
  });
  assert(/^1\. C50 意大利开局/.test(first), "§5 开局题默认第一道是意大利开局", first);
  await c.close();
}

// --- Codex on #88: a retired puzzle's review is not a debt for ever ----------
// caf32fa retired 22 mined puzzles with no migration: a profile that had
// missed one kept it in `missed`, owedNow() counted it and the 复习 list
// (which resolves ids against the book) dropped it — a review step in
// today's plan nothing could serve. Red before: 「先清复习 2 题」, and after
// the one live review was solved the plan still sat on the review step.
{
  const ctx2 = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx2.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, cat: "m1",
      solved: { "mn-201-60-17": true, "m1-smother": true, "lc-00008": true },
      missed: { "mn-201-5-62": { s: 0, n: 1 }, "w-hangq": { s: 0, n: 1 } },
      pr: { "mn-201-5-62": { r: 1300, rd: 90, vol: 0.06 } } }));
  });
  const pg = await ctx2.newPage();
  pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1200);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const stored = () => pg.evaluate(() => JSON.parse(localStorage.getItem("chess.puzzles")));
  const st0 = await stored();
  assert(!st0.missed["mn-201-5-62"] && !st0.solved["mn-201-60-17"] && !(st0.pr || {})["mn-201-5-62"],
    "#88: 退役题的复习、已解、评级记录在载入时清掉并存回", JSON.stringify(st0.missed));
  assert(!!st0.missed["w-hangq"] && st0.solved["m1-smother"] && st0.solved["lc-00008"],
    "#88: 还在书里的题、Lichess 题（分段按需加载）不动", JSON.stringify(st0.solved));
  const h1 = await todayHero(pg);
  assert(/^先清复习 1 题$/.test(h1.title), "#88: 今天的主卡片只欠还在书里的那 1 题", JSON.stringify(h1));
  await pg.click("#today-go");
  await pg.waitForTimeout(700);
  await openPuzzleList(pg);
  const task = await pg.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem("chess.puzzles")).cat,
    list: [...document.querySelectorAll("#puzzle-list .lesson-item")].length,
  }));
  assert(task.cat === "review" && task.list === 1, "#88: 复习类别端上来的就是那 1 题", JSON.stringify(task));
  const tapP = async (s) => {
    const p = await pg.evaluate((x) => {
      const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
      const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
      return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
    }, s);
    await pg.mouse.click(p.x, p.y);
    await pg.waitForTimeout(240);
  };
  await tapP("d2"); await tapP("d6"); // w-hangq: Rxd6
  await pg.waitForTimeout(600);
  const h2 = await todayHero(pg);
  assert(/今天第 2 项，共 \d 项/.test(h2.meta) && !/复习/.test(h2.title), "#88: 解掉那 1 题，课表离开复习这一步", JSON.stringify(h2));
  // a reload does not bring the retired ids back
  await pg.reload();
  await pg.waitForTimeout(1200);
  const st1 = await stored();
  assert(!st1.missed["mn-201-5-62"] && !st1.solved["mn-201-60-17"], "#88: 重开之后退役题也没回来");
  await ctx2.close();
}

// --- 9.0 S3: 训练's segments — each its own catalog, each where it was left;
// 名局 is one list of the forty, read or guessed by a switch ------------------
{
  const c = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done: {}, last: 5 }));
  });
  const pg = await c.newPage();
  pg.on("pageerror", (e) => errs.push("segs: " + e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1000);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const look = () => pg.evaluate(() => {
    const cur = document.querySelector("#lesson-list .lesson-item.current");
    const sw = document.getElementById("classic-mode");
    return {
      seg: (document.querySelector("#train-seg button.active") || { dataset: {} }).dataset.seg || null,
      title: document.getElementById("lesson-title").textContent,
      // 10.0 M0: a classic's players are the line over the board; the card's
      // title is where it was played (or, guessing, what you are doing)
      game: document.getElementById("lesson-title").dataset.strip || "",
      head: document.getElementById("lesson-list-h").textContent,
      n: { i: document.querySelectorAll("#lesson-list button[data-i]").length, c: document.querySelectorAll("#lesson-list button[data-c]").length,
        gs: document.querySelectorAll("#lesson-list button[data-gs]").length, eg: document.querySelectorAll("#lesson-list button[data-eg]").length },
      cur: cur ? { c: cur.dataset.c, gs: cur.dataset.gs, i: cur.dataset.i, text: cur.textContent.replace(/^✓ /, "") } : null,
      sw: sw.hidden ? null : (sw.querySelector("button.active") || { dataset: {} }).dataset.cmode,
    };
  });
  const until = async (fn, ms = 4000) => { let v; for (let t = 0; t < ms; t += 150) { v = await look(); if (fn(v)) return v; await pg.waitForTimeout(150); } return v; };
  const settings = () => pg.evaluate(() => JSON.parse(localStorage.getItem("chess.settings") || "{}"));

  await toTrain(pg, "course");
  let v = await until((x) => /^第 6 课/.test(x.title));
  assert(v.seg === "course" && /^第 6 课/.test(v.title) && v.n.i > 90 && !v.n.c && !v.n.gs && !v.n.eg && /^全部 \d+ 课$/.test(v.head) && v.sw === null,
    "S3 课程:从书签上的第 6 课开始,目录只有课程,名局的开关不在", JSON.stringify(v));
  await pg.evaluate(() => document.querySelector('#lesson-list button[data-i="8"]').click());
  v = await until((x) => /^第 9 课/.test(x.title));
  assert(/^第 9 课/.test(v.title), "S3 课程:目录里点开第 9 课", v.title);

  await pg.click('#train-seg button[data-seg="classic"]');
  // the thirty more are a chunk: the list is the forty once it is in
  v = await until((x) => x.seg === "classic" && !!x.cur && x.n.c === 40, 8000);
  assert(v.seg === "classic" && v.sw === "read" && v.n.c === 40 && !v.n.i && !v.n.gs && !v.n.eg && /全部 40 局/.test(v.head) && v.cur.c === "0" && v.game === v.cur.text,
    "S3 名局:默认读谱,目录是 40 局(没有课、没有猜着的第二份),从第一局读起", JSON.stringify(v));
  await pg.evaluate(() => document.querySelector('#lesson-list button[data-c="2"]').click());
  v = await until((x) => x.cur && x.cur.c === "2");
  const game2 = v.cur.text;
  assert(v.cur.c === "2" && v.game === game2, "S3 名局:点开第三局,读的就是它", JSON.stringify(v));

  // the switch: the same game, guessed — then read again
  await pg.click('#classic-mode button[data-cmode="guess"]');
  // the guess runner is a chunk: its title is written once it is here
  v = await until((x) => x.sw === "guess" && x.cur && x.cur.gs === "2" && /猜/.test(x.title));
  assert(v.sw === "guess" && v.n.gs === 40 && !v.n.c && v.cur.gs === "2" && v.cur.text === game2 && v.game === game2 && /猜/.test(v.title) && !v.title.includes(game2.split(" – ")[0]),
    "S3 名局:开关拨到猜着,还是这一局,改成猜着", JSON.stringify(v));
  assert((await settings()).classicMode === "guess", "S3 名局:猜着存进设置", JSON.stringify(await settings()));
  await pg.click('#classic-mode button[data-cmode="read"]');
  v = await until((x) => x.sw === "read" && x.cur && x.cur.c === "2");
  assert(v.sw === "read" && v.cur.c === "2" && v.game === game2, "S3 名局:拨回读谱,还是这一局,读谱", JSON.stringify(v));

  // each segment where it was left
  await pg.click('#train-seg button[data-seg="course"]');
  v = await until((x) => x.seg === "course" && /^第 9 课/.test(x.title));
  assert(v.seg === "course" && /^第 9 课/.test(v.title) && v.n.i > 90 && !v.n.c && v.sw === null, "S3:切回课程,接着第 9 课", JSON.stringify(v));
  await pg.click('#train-seg button[data-seg="puzzle"]');
  await pg.waitForTimeout(500);
  const pz = await pg.evaluate(() => ({ mode: document.getElementById("app").getAttribute("data-mode"), view: document.getElementById("app").getAttribute("data-view"),
    learn: !document.getElementById("sec-learn").hidden, picker: !document.getElementById("pz-groups-sec").hidden }));
  assert(pz.mode === "puzzle" && pz.view === "train" && !pz.learn && pz.picker, "S3:谜题这一段是做题,换了面板", JSON.stringify(pz));
  await pg.click('#train-seg button[data-seg="classic"]');
  v = await until((x) => x.seg === "classic" && x.cur && x.cur.c === "2");
  assert(v.cur && v.cur.c === "2" && v.game === game2, "S3:做完题再回名局,还是第三局", JSON.stringify(v));
  const lk = await pg.evaluate(() => JSON.parse(localStorage.getItem("chess.learn")));
  assert(lk.last === 8 && lk.cl === 2, "S3:learn 键记着课程的书签和名局的那一局", JSON.stringify({ last: lk.last, cl: lk.cl }));

  // guessed, then left: back after a reload, 名局 still guesses that game
  await pg.click('#classic-mode button[data-cmode="guess"]');
  await until((x) => x.sw === "guess");
  await pg.click('#train-seg button[data-seg="course"]');
  await until((x) => x.seg === "course");
  assert((await settings()).trainSeg === "course", "S3:设置里记着在训练的哪一段", JSON.stringify(await settings()));
  await pg.click('#rail button[data-view="home"]');
  await pg.waitForTimeout(300);
  await pg.reload();
  await pg.waitForTimeout(1200);
  await pg.click('#rail button[data-view="train"]');
  v = await until((x) => x.seg === "course" && /^第 9 课/.test(x.title));
  assert(v.seg === "course" && /^第 9 课/.test(v.title), "S3:重开以后从导航进训练,回到离开时的课程第 9 课", JSON.stringify(v));
  await pg.click('#train-seg button[data-seg="classic"]');
  // the guess runner is a chunk: its title is written once it is here
  v = await until((x) => x.sw === "guess" && x.cur && x.cur.gs === "2" && /猜/.test(x.title));
  assert(v.sw === "guess" && v.cur && v.cur.gs === "2" && /猜/.test(v.title), "S3:重开以后名局还是猜着、还是第三局", JSON.stringify(v));
  await c.close();
}

// --- v8-2-plan T1: 进阶课程第三部 24 课，三种语言各走一遍 --------------------
// The 24 lessons are a chunk (chunk-lessons-adv.js), so none of them is in the
// course walk above, which reads lessons.js. Here each language gets a fresh
// page: wait for the chunk to put the two new parts in the list, then open
// every lesson by its title in that language, read its words off the page,
// play every step's answer on the board, and see the lesson marked done. The
// first lesson also takes a wrong move and must answer with that language's
// retry hint. zh-CN starts with nothing done, so each lesson opens with its
// demo — skipped with a click, as a player would.
{
  const advData = { console };
  advData.globalThis = advData; advData.window = advData;
  vm.createContext(advData);
  for (const f of ["chess.js", "lessons-adv-chunk.js"]) {
    vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), advData, { filename: "module" });
  }
  const ADV = advData.CHESS_LESSONS_ADV;
  const AdvChess = advData.Chess;
  assert(ADV && ADV.lessons.length === 24, "T1:分块里有 24 课");
  const plain = (s) => String(s).replace(/\*\*/g, "");
  const words = (lang, L) => (lang === "zh-CN" ? L : Object.assign({}, ADV[lang][L.id], { tasks: ADV[lang][L.id].tasks }));
  // The three languages walk side by side, a page each: the time is the
  // runner's 900 ms between steps, not work, and 219 steps one after another
  // added seven minutes to a suite CI runs as a single job (v8-2-plan V4).
  await Promise.all(["zh-CN", "en", "ja"].map(async (lang) => {
    const c3 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await c3.addInitScript((id) => {
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "learn", langId: id, sideTab: "play", soundOn: false }));
      localStorage.setItem("chess.panelOpen", "1");
    }, lang);
    const pg = await c3.newPage();
    pg.on("pageerror", (e) => errs.push(lang + ": " + e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(1000);
    await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
    const tapQ = async (s) => {
      const p = await pg.evaluate((x) => {
        const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
        const f = x.charCodeAt(0) - 97, rk = 8 - +x[1], z = r.width / 8;
        return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
      }, s);
      await pg.mouse.click(p.x, p.y);
      await pg.waitForTimeout(200);
    };
    /** the entry demo plays on a first visit; a click on the board skips it */
    const skipDemo = async () => {
      for (let i = 0; i < 20; i++) {
        const busy = await pg.evaluate(() => { const b = document.getElementById("lesson-demo"); return !!b && !b.hidden && b.disabled; });
        if (!busy) return;
        await tapQ("a1");
        await pg.waitForTimeout(300);
      }
    };
    const first = words(lang, ADV.lessons[0]).title;
    let listed = false;
    for (let i = 0; i < 40 && !listed; i++) {
      listed = await pg.evaluate((t) => [...document.querySelectorAll("#lesson-list button")].some((b) => b.textContent.endsWith(t)), first);
      if (!listed) await pg.waitForTimeout(150);
    }
    assert(listed, `T1 ${lang}:分块到了以后，目录里出现进阶课程`);
    const parts = await pg.evaluate(() => [...document.querySelectorAll("#lesson-list .lesson-part")].map((h) => h.textContent));
    for (const grp of ["cl", "po"]) {
      const L = ADV.lessons.find((x) => x.id.startsWith(grp));
      // 9.0 S3: a unit's head carries its progress (「计算 0/12」)
      assert(parts.some((h) => h === words(lang, L).part || h.startsWith(words(lang, L).part + " ")), `T1 ${lang}:目录里有「${words(lang, L).part}」这一部分`, parts.join(" | "));
    }
    let walked = 0;
    for (const [li, L] of ADV.lessons.entries()) {
      const W = words(lang, L);
      const opened = await pg.evaluate((t) => {
        const b = [...document.querySelectorAll("#lesson-list button")].find((x) => x.textContent.endsWith(t));
        if (!b) return false;
        b.click();
        return true;
      }, W.title);
      if (!opened) { assert(false, `T1 ${lang} ${L.id}:目录里点得开`); continue; }
      await pg.waitForTimeout(400);
      const shown = await pg.evaluate(() => ({
        title: document.getElementById("lesson-title").textContent,
        body: document.getElementById("lesson-text").textContent,
        paras: document.querySelectorAll("#lesson-text p").length,
      }));
      const textOk = shown.title.includes(W.title) && shown.paras === W.text.length && shown.body.includes(plain(W.text[0]).slice(0, 12));
      let stepsOk = true, why = "";
      for (const [ti, t] of L.tasks.entries()) {
        await skipDemo();
        const prompt = await pg.evaluate(() => document.getElementById("lesson-task").textContent);
        if (!prompt.includes(W.tasks[ti].prompt)) { stepsOk = false; why = `第 ${ti + 1} 步提示「${prompt.slice(0, 30)}」`; }
        const g = new AdvChess(t.fen);
        if (li === 0 && ti === 0) {
          // a wrong move first: taken back, with this language's retry hint
          const wrong = g.moves({ verbose: true }).find((m) => !(t.accept || []).includes(m.san) && !m.promotion);
          await tapQ(wrong.from); await tapQ(wrong.to);
          await pg.waitForTimeout(300);
          const said = await pg.evaluate(() => document.getElementById("toast").textContent);
          assert(said.includes(W.tasks[0].retry), `T1 ${lang}:走错时提示这一步的「${lang === "zh-CN" ? "再想想" : "retry"}」`, said.slice(0, 60));
          await skipDemo();
        }
        const mv = g.move(t.solution[0]);
        await tapQ(mv.from); await tapQ(mv.to);
        await pg.waitForTimeout(ti + 1 < L.tasks.length ? 1100 : 400);
      }
      const done = await pg.evaluate((id) => ({
        dots: document.getElementById("lesson-dots").classList.contains("complete"),
        saved: !!((JSON.parse(localStorage.getItem("chess.learn") || "{}").done || {})[id]),
      }), L.id);
      if (textOk && stepsOk && done.dots && done.saved) walked++;
      else assert(false, `T1 ${lang} ${L.id}:课文、每一步和完成标记`, JSON.stringify({ textOk, stepsOk, why, done, title: shown.title.slice(0, 40) }));
    }
    assert(walked === 24, `T1 ${lang}:24 课逐课走完 —— 课文、每一步的提示与答案、完成标记（${walked}/24）`);
    const marks = await pg.evaluate((titles) => titles.filter((t) =>
      [...document.querySelectorAll("#lesson-list button")].some((b) => b.textContent.endsWith(t) && b.textContent.startsWith("✓"))).length,
    ADV.lessons.map((L) => words(lang, L).title));
    assert(marks === 24, `T1 ${lang}:目录里 24 课都打上了 ✓`, marks);
    const prog = await pg.evaluate(() => document.getElementById("learn-progress").textContent);
    assert(/24\/120/.test(prog), `T1 ${lang}:进度按 120 课算，完成 24`, prog);
    await c3.close();
  }));
  // The course's first 96 done: the home page's 下一步建议 names lesson 97 —
  // a placeholder until the chunk is here — and its button opens that lesson,
  // the jump 今天的训练 makes too (dailyJump). The jump asks for a lesson
  // whose tasks may not have arrived; it has to open once they do.
  {
    const c4 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await c4.addInitScript((ids) => {
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false, view: "home" }));
      localStorage.setItem("chess.panelOpen", "1");
      const done = {};
      for (const id of ids) done[id] = true;
      localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done, last: 95 }));
    }, LESSONS.map((L) => L.id));
    const pg = await c4.newPage();
    pg.on("pageerror", (e) => errs.push("home: " + e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`);
    await pg.waitForTimeout(1000);
    await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
    // 9.0 S1: 今天's hero is the plan's step — 学一节新课, the course's next
    // lesson — and its go opens it; the 继续 card then names it, read from the chunk
    const want = "第 97 课 · " + ADV.lessons[0].title;
    const hero = await pg.evaluate(() => ({ view: document.getElementById("app").getAttribute("data-view"),
      title: document.getElementById("today-hero-title").textContent, meta: document.getElementById("today-hero-meta").textContent }));
    assert(hero.view === "home" && /学一节新课/.test(hero.title) && /课程的下一课/.test(hero.meta),
      "T1:前 96 课都学完，今天的主卡片是「学一节新课」（课程的下一课）", JSON.stringify(hero));
    await pg.click("#today-go");
    let title = "";
    for (let i = 0; i < 40 && !title.includes(ADV.lessons[0].title); i++) {
      await pg.waitForTimeout(150);
      title = await pg.evaluate(() => document.getElementById("lesson-title").textContent);
    }
    assert(title.includes("第 97 课") && title.includes(ADV.lessons[0].title), "T1:点「开始」打开的就是第 97 课，题名读自分块", title);
    await pg.click('#rail button[data-view="home"]');
    let line = "";
    for (let i = 0; i < 40 && !line.includes(want); i++) {
      await pg.waitForTimeout(150);
      line = await pg.evaluate(() => (document.querySelector('#today-cont .today-c[data-seg="course"] b') || {}).textContent || "");
    }
    assert(line.includes(want), "T1:回到今天，「继续」的课程卡写着第 97 课和分块里的题名", line.slice(0, 60));
    await c4.close();
  }
  // M2 review: the bookmark on lesson 101, the chunk slow and then refused —
  // 学习 used to be a blank page meanwhile, and for good on a 404
  for (const mode of [2500, "fail"]) {
    held["/js/chunk-lessons-adv.js"] = mode;
    const c5 = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
    await c5.addInitScript(() => {
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false, view: "play" }));
      localStorage.setItem("chess.panelOpen", "1");
      localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done: {}, last: 100 }));
    });
    const pg = await c5.newPage();
    pg.on("pageerror", (e) => errs.push("adv " + mode + ": " + e.message));
    await pg.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "domcontentloaded" });
    await pg.waitForTimeout(1000);
    await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
    await pg.click('.rail-btn[data-view="train"]');
    await pg.waitForTimeout(600);
    const look = () => pg.evaluate(() => ({ title: document.getElementById("lesson-title").textContent,
      list: document.querySelectorAll("#lesson-list button[data-i]").length, head: document.getElementById("lesson-list-h").textContent,
      seg: (document.querySelector("#train-seg button.active") || { dataset: {} }).dataset.seg,
      toast: (document.getElementById("toast") || {}).textContent || "",
      last: JSON.parse(localStorage.getItem("chess.learn") || "{}").last }));
    const w = await look();
    // 9.0 S3: 训练 opens on 课程; its catalog is the course's 96 lessons that are in
    assert(/^第 96 课/.test(w.title) && w.seg === "course" && w.list === 96 && /全部 96 课/.test(w.head) && w.last === 100,
      "M2 T1:书签在第 101 课、分块" + (mode === "fail" ? "取不到" : "还没到") + "时，学习页先开第 96 课和目录，书签不动", JSON.stringify(w).slice(0, 160));
    if (mode === "fail") {
      assert(/进阶课程没能载入/.test(w.toast), "M2 T1:分块取不到，提示一句", w.toast);
    } else {
      let t = "";
      for (let i = 0; i < 40 && !t.includes("第 101 课"); i++) { await pg.waitForTimeout(150); t = await pg.evaluate(() => document.getElementById("lesson-title").textContent); }
      assert(t.includes("第 101 课") && t.includes(ADV.lessons[4].title), "M2 T1:分块一到就开书签上的第 101 课", t);
    }
    await c5.close();
  }
  delete held["/js/chunk-lessons-adv.js"];
}

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
console.log(failed ? `\n${failed} 项未通过` : "\nall passed");
process.exit(failed ? 1 : 0);
