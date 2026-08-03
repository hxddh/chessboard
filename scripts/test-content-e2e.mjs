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

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
console.log(failed ? `\n${failed} 项未通过` : "\nall passed");
process.exit(failed ? 1 : 0);
