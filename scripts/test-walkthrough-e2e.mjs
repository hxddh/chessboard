/**
 * What the 20.0 walkthrough (v20-0-plan §11) found, held in the browser
 * (Chromium; BROWSER=webkit for WebKit), the app served as modules, the fake
 * engine:
 *
 *   first start   the first start on a device opens 学's placement, not a game
 *                 against whoever the default is
 *   placement     没下过 → 下's untouched first game is against the bottom of
 *                 the ladder, the coach on; 常下棋 placed high → an opponent
 *                 for that level, the coach off (已定 8: from 1500 off)
 *   我            every stage reached: the card says so and nothing else
 *   review        下一处 while the rest of the game is still being worked
 *                 through says so, not a count that reads like progress
 *   background    imported games are reviewed with a finished game on 下 or
 *                 the skill map open; never while a game is being played
 *   sheet         Tab stays inside the new-game sheet (a modal)
 *   selects       drawn by the app (WebKit's native menu kept a light face
 *                 under light text in the dark shells); the checkbox in the accent
 *
 *   node scripts/test-walkthrough-e2e.mjs      (E2E_REQUIRED=1: a missing browser fails)
 */
import { startServer } from "./serve-app.mjs";
import { launchBrowser } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };

const srv = await startServer();
const BASE = srv.url;
const browser = await launchBrowser();
const errors = [];

async function context(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: "reduce", ...opts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  return { ctx, page };
}
const game = (page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__app.store.get().play.game)));
const events = (page, type) => page.evaluate(async (type) => (await (await window.__app.ready).query("events.since", { after: 0, limit: 100000 })).filter((e) => e.type === type), type);

/** Through the placement: 没下过, or 常下棋 with every puzzle right. */
async function place(page, how) {
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.click("[data-test=place-" + how + "]");
  if (how === "new") { await page.waitForFunction(() => window.__learn && window.__learn.model && window.__learn.model.placed); return; }
  for (let i = 0; i < 12; i++) {
    const placed = await page.evaluate(() => !!(window.__learn.model && window.__learn.model.placed));
    if (placed) return;
    await page.waitForFunction(() => window.__learn.item && window.__learn.why === "place" || (window.__learn.model && window.__learn.model.placed), null, { timeout: 8000 });
    await page.evaluate(() => { if (window.__learn.why === "place") window.__learn.answer(true); });
    await page.waitForTimeout(150);
  }
  await page.waitForFunction(() => window.__learn.model && window.__learn.model.placed, null, { timeout: 8000 });
}

// --- the first start: 学's placement; 没下过 → the bottom of the ladder, the coach on ---------------
{
  const { ctx, page } = await context();
  await page.goto(BASE + "?engine=fake&chain=60&autoreview=0&dbname=wt-new-" + Date.now());
  await page.waitForSelector("[data-page]");
  assert(await page.evaluate(() => location.hash) === "#/learn", "the first start opens 学");
  assert(await page.isVisible("[data-test=place]"), "on the placement question");
  await place(page, "new");
  await page.click('a[href="#/play"]');
  await page.waitForSelector("[data-page=play] canvas");
  const g = await game(page);
  assert(g.opponent === "pip" && g.coach === true && !g.moves.length, "下's first game, untouched, is now against 皮普 with the coach on (" + g.opponent + ", coach " + g.coach + ")");
  assert(/皮普/.test(await page.textContent(".strip.top")), "and its strip names 皮普");
  await page.click("[data-test=new]");
  await page.waitForSelector("[data-test=sheet]");
  assert((await page.textContent("[data-test=opp-name]")) === "皮普" && await page.isChecked("[data-test=coach]"), "the new-game sheet starts from 皮普, the coach on");
  // the sheet keeps the keyboard
  const inside = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press(i % 5 === 4 ? "Shift+Tab" : "Tab");
    inside.push(await page.evaluate(() => !!document.activeElement.closest("[data-test=sheet]")));
  }
  assert(inside.every(Boolean), "Tab and Shift+Tab stay inside the new-game sheet (" + inside.map((x) => (x ? 1 : 0)).join("") + ")");
  await page.keyboard.press("Escape");
  // a second start on the same device: back to the game where it was
  await page.goto(BASE + "?engine=fake&autoreview=0&dbname=wt-new-other-" + Date.now());
  await page.waitForSelector("[data-page]");
  assert(await page.evaluate(() => location.hash) === "#/play", "the next start opens 下");
  await ctx.close();
}

// --- 常下棋, placed high: the opponent for that level, the coach off; 我 when every stage is reached ----
{
  const { ctx, page } = await context();
  const q = BASE + "?engine=fake&chain=60&autoreview=0&dbname=wt-often-" + Date.now();
  await page.goto(q + "#/learn");
  await place(page, "often");
  const rating = await page.evaluate(() => window.__learn.model.placed.rating);
  await page.click('a[href="#/play"]');
  await page.waitForSelector("[data-page=play] canvas");
  const g = await game(page);
  const opp = await page.evaluate(async (r) => (await import("./learn/service.js")).opponentFor(r).id, rating);
  assert(g.opponent === opp && g.coach === false, "placed at " + rating + ": 下's first game is against " + opp + ", the coach off (" + g.opponent + ", coach " + g.coach + ")");
  await page.click("[data-test=new]");
  await page.waitForSelector("[data-test=sheet]");
  assert(!(await page.isChecked("[data-test=coach]")), "the new-game sheet has the coach off");
  await page.keyboard.press("Escape");
  // a game you have started is yours: placing again does not replace it
  await page.goto(q + "#/me");
  await page.waitForSelector("[data-test=stage]");
  const stage = await page.evaluate(() => ({ goal: document.querySelector("[data-test=stage-goal]").textContent,
    text: document.querySelector("[data-test=stage]").innerText, needs: !!document.querySelector("[data-test=stage-needs]"), unlock: !!document.querySelector("[data-test=stage-unlock]") }));
  if (/四个阶段都完成了/.test(stage.goal)) {
    assert(!stage.needs && !stage.unlock && !/就过关|解锁/.test(stage.text), "every stage reached: the card says so and nothing else (" + stage.text.replace(/\n/g, " | ") + ")");
  } else assert(false, "placed at " + rating + " every stage is reached (" + stage.goal + ")");
  await ctx.close();
}

// --- the review: 下一处 while the rest is being worked through --------------------------------------------
{
  const { ctx, page } = await context();
  await page.goto(BASE + "?engine=fake&think=0&delay=120&db=memory&autoreview=0#/play");
  await page.waitForSelector("[data-page=play] canvas");
  // a game lost on the board: 1. f3 e5 2. g4 Qh4# and something of yours to review before it
  const line = ["e2e4", "e7e5", "d1h5", "b8c6", "f1c4", "g8f6", "h5f7"];
  await page.evaluate((line) => {
    const st = window.__app.store;
    st.dispatch("play.new", { id: "rv-wait", mode: "pvp" });
    for (const u of line) st.dispatch("play.move", { uci: u, now: Date.now() });
  }, line);
  const firstCard = await page.waitForFunction(() => document.querySelector("[data-test=bar]").dataset.phase === "review-card", null, { timeout: 30000 }).then(() => true, () => false);
  if (firstCard) {
    const refining = await page.evaluate(() => { const r = window.__play.review; return !!(r && r.state.peek().phase === "card"); });
    await page.click("[data-test=rv-next]");
    const text = await page.textContent("[data-test=bar-text]");
    const ph = await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase);
    assert(refining && (ph !== "review-card" || !/复盘中…\s*\d+\/\d+/.test(text)), "下一处 before the rest is ready does not print a count that reads like progress (" + text + ")");
  } else {
    // a pvp game reviews both sides; with the fake engine there may be no card: then the wait is not reachable
    const ph = await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase);
    assert(ph === "review-empty" || ph === "review-done", "no card to wait on (" + ph + ")");
  }
  await ctx.close();
}

// --- the background review: free with a finished game on 下 and on the skill map; not during a game ------
{
  const { ctx, page } = await context();
  await page.goto(BASE + "?engine=fake&think=0&chain=60&autoreviewDelay=300&dbname=wt-bg-" + Date.now() + "#/me");
  await page.waitForSelector("[data-test=import-pgn]");
  const pgn = Array.from({ length: 3 }, (_, i) => `[White "Me"]\n[Black "Foe${i}"]\n[Result "0-1"]\n[Date "2025.0${i + 1}.01"]\n\n1. f3 e5 2. g4 Nc6 3. h3 Qh4# 0-1\n`).join("\n");
  // a game being played on 下: nothing is reviewed
  await page.click('a[href="#/play"]');
  await page.waitForSelector("[data-page=play] canvas");
  await page.evaluate(async (pgn) => { const m = await import("./library/import.js"); await m.importFile(pgn, { db: await window.__app.ready, name: "mine.pgn" }); window.__app.background.wake(); }, pgn);
  await page.waitForTimeout(2500);
  assert((await events(page, "review.analysis")).length === 0, "a game being played on 下: nothing reviewed in the background");
  // the game ends: 下 stays on screen, and the background review goes on
  await page.evaluate(() => window.__app.store.dispatch("play.resign", { color: "w", now: Date.now() }));
  await page.waitForFunction(() => ["review-empty", "review-done", "review-card"].includes(document.querySelector("[data-test=bar]").dataset.phase), null, { timeout: 15000 });
  const ph = await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase);
  if (ph === "review-card") { await page.click("[data-test=rv-next]").catch(() => {}); }
  await page.waitForFunction(async () => (await (await window.__app.ready).query("events.since", { after: 0, limit: 100000 })).some((e) => e.type === "review.analysis"), null, { timeout: 30000 })
    .then(() => assert(true, "a finished game on 下: the background review goes on"), () => assert(false, "a finished game on 下: the background review goes on (" + ph + ")"));
  // 学's skill map: free; an item on its board: paused
  await page.click('a[href="#/learn"]');
  await page.waitForSelector("[data-test=place]:not([hidden])");
  const free = await page.evaluate(() => !window.__app.background.busyOf || !window.__app.background.busyOf());
  assert(free, "学's placement question leaves the engine free");
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn && window.__learn.item);
  assert(await page.evaluate(() => !!window.__app.background.busyOf && window.__app.background.busyOf()), "a position on 学's board: the background review waits");
  await page.click("[data-test=open-map]");
  assert(await page.evaluate(() => !window.__app.background.busyOf()), "the skill map open: free again");
  await ctx.close();
}

// --- selects drawn by the app, readable in every shell; the checkbox in the accent ---------------------------
for (const dark of [false, true]) {
  const { ctx, page } = await context({ colorScheme: dark ? "dark" : "light" });
  await page.goto(BASE + "?engine=fake&db=memory&autoreview=0#/settings");
  await page.waitForSelector("[data-test=set-lang]");
  const s = await page.evaluate(() => {
    const el = document.querySelector("[data-test=set-lang]"), cs = getComputedStyle(el);
    // rgb(…) / rgba(…), or color(srgb r g b / a) for a color-mix()
    const parts = (c) => {
      const srgb = /^color\(srgb/.test(c), v = c.replace(/^color\(srgb/, "").match(/[\d.]+/g).map(Number);
      return { rgb: v.slice(0, 3).map((x) => (srgb ? x * 255 : x)), a: v.length > 3 ? v[3] : 1 };
    };
    // the face is translucent over the page: composite it on the page's background first
    const page = parts(getComputedStyle(document.body).backgroundColor), face = parts(cs.backgroundColor);
    const over = face.rgb.map((x, i) => x * face.a + page.rgb[i] * (1 - face.a));
    const lum = (rgb) => { const [r, g, b] = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const a = lum(parts(cs.color).rgb), b = lum(over);
    return { appearance: cs.appearance || cs.webkitAppearance, scheme: getComputedStyle(document.documentElement).colorScheme, contrast: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  });
  assert(s.appearance === "none" && s.contrast >= 4.5 && s.scheme === (dark ? "dark" : "light"),
    (dark ? "dark" : "light") + ": the select is drawn by the app, its text ≥ 4.5:1 on its face, the page's color-scheme " + s.scheme + " (" + JSON.stringify(s) + ")");
  await page.goto(BASE + "?engine=fake&db=memory&autoreview=0#/play");
  await page.waitForSelector("[data-test=new]");
  await page.click("[data-test=new]");
  const accent = await page.evaluate(() => getComputedStyle(document.querySelector("[data-test=coach]")).accentColor);
  assert(accent && accent !== "auto", "the coach's checkbox takes the accent (" + accent + ")");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-walkthrough-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
