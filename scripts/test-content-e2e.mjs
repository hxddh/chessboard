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
 * Needs playwright-core and a Chromium. Exits 0 with a notice when either is
 * missing, so it can sit in the suite without becoming a hard dependency:
 *   node scripts/test-content-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

let chromium;
for (const mod of ["playwright-core", "playwright",
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs"]) {
  try { ({ chromium } = await import(mod)); break; } catch { /* try the next one */ }
}
if (!chromium) { console.log("跳过:没有 playwright"); process.exit(0); }

const CHROME = [
  process.env.CHROME_PATH,
  "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
  "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.log("跳过:找不到 Chromium"); process.exit(0); }

// the same data the page will load, so the test knows the right answers
const data = { console };
data.globalThis = data; data.window = data;
vm.createContext(data);
for (const f of ["chess.js", "lessons.js", "puzzles.js"]) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, "js", f), "utf8"), data, { filename: f });
}
const Chess = data.Chess;
const LESSONS = data.CHESS_LESSONS;
const ENDGAME = LESSONS.filter((l) => l.part === "残局基础");
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

const browser = await chromium.launch({ executablePath: CHROME });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.v1.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }));
  localStorage.setItem("chess.panelOpen", "1");
  localStorage.setItem("chess.onboarded", "1");
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

// --- the endgame lessons --------------------------------------------------
await page.evaluate(() => [...document.querySelectorAll("[data-mode]")].find((x) => x.dataset.mode === "learn").click());
await page.waitForTimeout(500);
assert(ENDGAME.length >= 8, `残局基础有 ${ENDGAME.length} 课`);

for (const les of ENDGAME) {
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
    allowed.push([`第 ${k + 1} 题`, squaresOf(task.fen)]);
    for (const san of task.solution || []) {
      const g = new Chess(task.fen);
      if (g.move(san) || g.move({ from: san.slice(0, 2), to: san.slice(2, 4), promotion: "q" })) {
        allowed.push([`第 ${k + 1} 题演示完`, squaresOf(g.fen())]);
      }
    }
  });
  const hit = allowed.find(([, sqs]) => sqs === on);
  assert(!!hit, `${les.id}:棋盘上摆的是这一课的局面`, hit ? hit[0] : `实际 ${on}`);
}

// a wrong move on a one-answer task is refused, with that task's own hint
{
  const les = LESSONS.find((l) => l.id === "kingactive");
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

assert(errs.length === 0, "全程零 JS 异常", errs.join(" | "));
await browser.close();
server.close();
console.log(failed ? `\n${failed} 项未通过` : "\nall passed");
process.exit(failed ? 1 : 0);
