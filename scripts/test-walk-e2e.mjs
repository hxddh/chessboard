/**
 * The 18.0 walkthrough's bugs, each red on 17.0.0 first (docs/v18-0-plan.md
 * §7½). R1, the move list under the pointer:
 *
 * Clicking a move moves the replay cursor, and the list scrolls to keep it in
 * view. The scroll slides another move under a pointer that never moved, the
 * browser reports that as a mouseover, and through 17.0 the hover preview
 * took the board: click 13…h6, see 「预览 · 第 34 着」. A click is a commit;
 * the preview may come back only once the hand really moves.
 *
 *   node scripts/test-walk-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { settle } from "./lib/settle.mjs";
import { OPERA, playOpera } from "./lib/opera-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
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
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg, extra || ""); }
};

const browser = await launchBrowser();
if (!browser) { server.close(); process.exit(0); }
console.log("引擎:", ENGINE);
// short enough that the 33-ply Opera game overflows the list and has to scroll
const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood" }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
await playOpera(page);
await settle(page);

const state = () => page.evaluate(() => {
  const ml = document.getElementById("move-list");
  const cur = ml.querySelector("button.current");
  return {
    badge: document.getElementById("preview-badge").hidden ? null : document.getElementById("preview-badge").textContent,
    current: cur ? cur.dataset.i || cur.dataset.node : null,
    scrollable: ml.scrollHeight > ml.clientHeight + 4,
  };
});
const s0 = await state();
assert(s0.scrollable, "the Opera game overflows the move list at this height", JSON.stringify(s0));

// sweep to a move in the middle of the visible list and click it: the cursor
// moves there and the list scrolls to keep it in view, which slides another
// move under the still pointer
const target = await page.evaluate(() => {
  const ml = document.getElementById("move-list");
  const mr = ml.getBoundingClientRect();
  const bs = [...ml.querySelectorAll("button[data-i]")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.top >= mr.top && r.bottom <= mr.bottom;
  });
  const b = bs[6];
  const r = b.getBoundingClientRect();
  return { i: b.dataset.i, x: r.left + r.width / 2, y: r.top + r.height / 2, st: ml.scrollTop };
});
await page.mouse.move(target.x, target.y, { steps: 3 });
await page.waitForTimeout(200);
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(700);
const s1 = await state();
const moved = await page.evaluate(() => document.getElementById("move-list").scrollTop);
console.log("  clicked " + target.i + "; list scrolled " + target.st + " → " + moved + "; current " + s1.current + "; badge " + s1.badge);
assert(moved !== target.st, "the click scrolled the list (the case that slid another move under the pointer)");
assert(s1.current === target.i && s1.badge === null,
  "after the click the board shows the clicked move, not a preview of the one that scrolled under the pointer", JSON.stringify(s1));

// a real move of the hand brings the preview back
await page.mouse.move(target.x + 30, target.y + 3, { steps: 3 });
await page.waitForTimeout(200);
const s2 = await state();
assert(s2.badge !== null, "……and once the pointer really moves, sweeping the list previews again", JSON.stringify(s2));

// 18.0 P (the audit's keyboard finding): the move list is one Tab stop,
// the arrows walk it
const kb = await page.evaluate(() => {
  const all = [...document.querySelectorAll("#move-list button.mlmove[data-node]:not(.mlgap)")];
  return { n: all.length, stops: all.filter((b) => b.tabIndex === 0).length };
});
assert(kb.n > 20 && kb.stops === 1, "P: the move list is one Tab stop, not one per move", JSON.stringify(kb));
const walked = await page.evaluate(() => {
  const all = [...document.querySelectorAll("#move-list button.mlmove[data-node]:not(.mlgap)")];
  const stop = all.find((b) => b.tabIndex === 0);
  stop.focus();
  const from = all.indexOf(stop);
  stop.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true, cancelable: true }));
  const now = all.indexOf(document.activeElement);
  return { from, now, stops: all.filter((b) => b.tabIndex === 0).length };
});
assert(walked.now === walked.from - 1 && walked.stops === 1, "P: ← moves the focus to the move before, and the stop with it", JSON.stringify(walked));

assert(errs.length === 0, "no page errors — " + errs.join(" / "));
await ctx.close();

// --- 18.0 R2: a profile that never chose opens with the panel out ----------
// Through 17.0 the launch read 「panelOpen === "1"」, so a new profile — and
// every profile that had never touched the ☰ — met 下棋 as a bare board with
// no move list, no 复盘, no 新对局, the panel parked off the window's edge.
// The sheet layouts (portrait, ≤ 900 px) still start closed: there the panel
// lies over the board.
for (const [w, h, want] of [[1440, 900, true], [1024, 700, true], [600, 900, false]]) {
  const c = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
  await c.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood" }));
  });
  const pg = await c.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const r = await pg.evaluate(() => {
    const side = document.getElementById("side").getBoundingClientRect();
    return { open: document.getElementById("app").classList.contains("panel-open"),
      inWindow: side.left >= 0 && side.right <= window.innerWidth + 0.5 };
  });
  assert(r.open === want && (!want || r.inWindow),
    w + " × " + h + ", nothing saved: the panel starts " + (want ? "open, inside the window" : "closed (it is a sheet over the board)"), JSON.stringify(r));
  // a choice once made is kept
  await pg.evaluate((o) => localStorage.setItem("chess.panelOpen", o ? "0" : "1"), want);
  await pg.reload();
  await pg.waitForTimeout(900);
  await pg.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const again = await pg.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
  assert(again === !want, "……and a saved choice still wins on the next launch");
  await c.close();
}

// --- 18.0 R5: the review queue says what it does ---------------------------
// Miss 一步杀 #1, open 复习, solve it once: it is due again tomorrow (two
// clean solves in a row leave the queue), so 下一题 must not say 「错题都清光了」.
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood", view: "train" }));
  });
  const pg = await c.newPage();
  const pe = [];
  pg.on("pageerror", (e) => pe.push(e.message));
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1200);
  const sq = async (q) => {
    const xy = await pg.evaluate((q) => {
      const r = document.getElementById("board").getBoundingClientRect();
      const f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
      return { x: r.left + (f + 0.5) * r.width / 8, y: r.top + (rk + 0.5) * r.height / 8 };
    }, q);
    await pg.mouse.click(xy.x, xy.y);
    await pg.waitForTimeout(250);
  };
  const fen0 = await pg.evaluate(() => window.__chess.puzzle());
  assert(fen0 === "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", "R5: a new profile opens on 一步杀 #1 (Ra8#)", fen0);
  await sq("a1"); await sq("a5");                 // a miss
  await pg.waitForTimeout(1000);
  const sub = await pg.evaluate(() => document.querySelector("#pz-review .pz-review-sub, #pz-review small, #pz-review") .textContent);
  assert(!/隔几天再来一次/.test(sub) && /马上再做一次/.test(sub), "R5: 复习 says a miss comes back at once, then days later", sub.replace(/\s+/g, " "));
  await pg.click("#pz-review");
  await pg.waitForTimeout(1200);
  await sq("a1"); await sq("a8");                 // solved once, in 复习
  await pg.waitForTimeout(1200);
  const toasts = [];
  await pg.exposeFunction("__toast", (x) => toasts.push(x));
  await pg.evaluate(() => {
    new MutationObserver(() => {
      for (const e of document.querySelectorAll("[role=status], #toast")) {
        const x = e.textContent.trim();
        if (x && e.__said !== x) { e.__said = x; window.__toast(x); }
      }
    }).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  await pg.click("#puzzle-next");
  await pg.waitForTimeout(1200);
  const said = toasts.join(" | ");
  assert(!/清光/.test(said) && /今天的复习做完了/.test(said),
    "R5: solved once and due tomorrow, 下一题 says today's review is done — not 「错题都清光了」", said);
  assert(pe.length === 0, "R5: no page errors — " + pe.join(" / "));
  await c.close();
}

// --- 18.0 R6: 今天's 继续 moves on ---------------------------------------
// 第 1 课 finished and still the bookmark: the card offers 第 2 课, not 第 1 课 again.
{
  const c = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood", view: "home", ob: { n: 1, done: true } }));
    localStorage.setItem("chess.learn", JSON.stringify({ v: 1, done: { board: true }, last: 0 }));
  });
  const pg = await c.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1200);
  await pg.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  await pg.click('.rail-btn[data-view="home"]').catch(() => {});
  await pg.waitForTimeout(600);
  const txt = await pg.evaluate(() => (document.querySelector('#today-cont .today-c[data-seg="course"]') || {}).textContent || "");
  assert(/第 2 课/.test(txt) && !/第 1 课/.test(txt), "R6: 第 1 课 done, 今天's 继续 offers 第 2 课", txt.replace(/\s+/g, " ").slice(0, 80));
  await c.close();
}

// --- 18.0 R7: a lesson at 600 px shows the lesson, not the game -----------
{
  const c = await browser.newContext({ viewport: { width: 600, height: 900 }, locale: "zh-CN" });
  await c.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood", ob: { n: 1, done: true } }));
  });
  const pg = await c.newPage();
  await pg.goto(`http://127.0.0.1:${PORT}/`);
  await pg.waitForTimeout(1200);
  await pg.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  await pg.click('.rail-btn[data-view="play"]').catch(() => {});
  await pg.waitForTimeout(400);
  await playOpera(pg, 12);                    // a game with moves behind the lesson
  await settle(pg);
  const stripPlay = await pg.evaluate(() => { const e = document.getElementById("move-strip"); return !!e && getComputedStyle(e).display !== "none"; });
  await pg.click('.rail-btn[data-view="train"]');
  await pg.waitForTimeout(500);
  await pg.evaluate(() => { const b = [...document.querySelectorAll("button")].find((x) => x.offsetParent && x.textContent.trim() === "课程"); if (b) b.click(); });
  await pg.waitForTimeout(900);
  const r = await pg.evaluate(() => {
    const e = document.getElementById("move-strip");
    return { view: document.getElementById("app").getAttribute("data-view"),
      strip: !!e && getComputedStyle(e).display !== "none" && e.textContent.trim().length > 0,
      mark: (document.getElementById("tr-mark") || {}).textContent || "" };
  });
  assert(stripPlay, "R7: (the strip is there while playing at 600 px)");
  assert(r.view === "train" && !r.strip, "R7: at 600 px the lesson's drawer has no strip of the game's moves", JSON.stringify(r));
  assert(!/^\d+\/\d+$/.test(r.mark.trim()), "R7: the lesson's task mark is named, not a bare 「1/2」", r.mark);
  await c.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
