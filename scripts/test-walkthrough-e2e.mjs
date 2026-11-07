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
 *   the low ones  in zh, en and ja: no rating and an inviting empty curve on a
 *                 new profile (L4); the library's dates in one form (L5); 设置's
 *                 level not named like 我's rating (L7); a lesson's side says each
 *                 thing once (L8); the stage's count and list agree (L9); one
 *                 element for [data-test=moves] (L11); a settings change survives
 *                 a reload right after it (the native run's language switch)
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

// --- the low ones (§11 L4–L11) and the settings written at once, in all three languages -----------------
const WORDS = {
  zh: { level: "你的水平", placeGo: "去定级" },
  en: { level: "Your level", placeGo: "Take the placement" },
  ja: { level: "あなたの強さ", placeGo: "レベル判定を受ける" },
};
const dice = (a, b) => {
  const grams = (s) => { const g = new Map(); s = s.replace(/\s+/g, ""); for (let i = 0; i < s.length - 1; i++) g.set(s.slice(i, i + 2), (g.get(s.slice(i, i + 2)) || 0) + 1); return g; };
  const x = grams(a), y = grams(b);
  let both = 0, n = 0;
  for (const [k, v] of x) { both += Math.min(v, y.get(k) || 0); n += v; }
  for (const v of y.values()) n += v;
  return n ? (2 * both) / n : 0;
};
for (const lang of ["zh", "en", "ja"]) {
  const { ctx, page } = await context();
  const q = BASE + "?engine=fake&think=0&chain=60&autoreview=0&lang=" + lang + "&dbname=wt-low-" + lang + "-" + Date.now();
  // L4: a new profile — no number, an empty curve that says what will be there, and the way to a number
  await page.goto(q + "#/me");
  await page.waitForSelector("[data-test=rating]");
  const fresh = await page.evaluate(() => {
    const card = document.querySelector("[data-test=rating]").closest(".card");
    return { known: document.querySelector("[data-test=rating]").dataset.known, h2: card.querySelector("h2").textContent,
      nums: [...card.innerText.matchAll(/\b\d{3,4}\b/g)].map((m) => m[0]),
      empty: !!document.querySelector("[data-test=curve-empty]") && getComputedStyle(document.querySelector("[data-test=curve-empty]")).display !== "none",
      emptyText: (document.querySelector("[data-test=curve-empty]") || {}).textContent || "", go: !!document.querySelector("[data-test=go-place]") };
  });
  assert(fresh.known === "0" && fresh.nums.length === 0 && fresh.empty && fresh.emptyText.length > 4 && fresh.go,
    lang + " L4: a new profile shows no rating, an empty curve with words, and the placement (" + JSON.stringify(fresh) + ")");
  // L9 before the placement too: the count and the list agree
  const stage = await page.evaluate(() => {
    const c = document.querySelector("[data-test=stage-count]");
    return c ? { text: c.textContent, total: +c.dataset.total, shown: +c.dataset.shown, li: document.querySelectorAll("[data-test=stage-needs] li").length } : null;
  });
  assert(stage && stage.li === stage.shown && stage.text.includes(String(stage.total)) && (stage.total === stage.li || stage.text.includes(String(stage.li))),
    lang + " L9: the stage's line names what is listed (" + JSON.stringify(stage) + ")");
  // L7: 我's heading and 设置's level are two different words
  assert(fresh.h2 === WORDS[lang].level, lang + " 我's heading: " + fresh.h2);
  await page.click("[data-test=go-place]");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  // L8: the lesson's side says each thing once
  await place(page, "new");
  await page.waitForFunction(() => window.__learn.item && window.__learn.item.kind === "lesson", null, { timeout: 8000 }).catch(() => {});
  const side = await page.evaluate(() => {
    const vis = (e) => e && !e.hidden && getComputedStyle(e).display !== "none" && e.textContent.trim();
    const why = document.querySelector("[data-test=skill-why]");
    return { kind: window.__learn.item && window.__learn.item.kind, blocks: [...(vis(why) ? [why.textContent] : []), ...[...document.querySelectorAll("[data-test=lesson-text] p")].map((p) => p.textContent)] };
  });
  let worst = 0;
  for (let i = 0; i < side.blocks.length; i++) for (let j = i + 1; j < side.blocks.length; j++) worst = Math.max(worst, dice(side.blocks[i], side.blocks[j]));
  assert(side.kind === "lesson" && side.blocks.length >= 1 && worst < 0.5, lang + " L8: the lesson's side repeats nothing (" + side.kind + ", " + side.blocks.length + " blocks, most alike " + worst.toFixed(2) + ")");
  // L4 after it: a number
  await page.click('a[href="#/me"]');
  await page.waitForSelector("[data-test=rating][data-known='1']");
  assert(/^\d{3,4}$/.test(await page.textContent("[data-test=rating]")), lang + " L4: placed — the number (" + await page.textContent("[data-test=rating]") + ")");
  // L5: a PGN's date, a partial one and a game played here, in one form
  await page.evaluate(async () => {
    const m = await import("./library/import.js");
    const one = (d, foe) => `[White "Me"]\n[Black "${foe}"]\n[Result "0-1"]\n[Date "${d}"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n`;
    await m.importFile(one("2026.10.20", "Foe") + "\n" + one("2024.03.??", "Other"), { db: await window.__app.ready, name: "dates.pgn" });
    const st = window.__app.store;
    st.dispatch("play.new", { id: "wt-dates", mode: "pvp" });
    for (const u of ["f2f3", "e7e5", "g2g4", "d8h4"]) st.dispatch("play.move", { uci: u, now: Date.now() });
    await (await window.__app.ready).flush();
  });
  await page.reload();   // already on #/me: a reload draws the list afresh
  await page.waitForFunction(() => document.querySelectorAll("[data-test=lib-row]").length >= 3, null, { timeout: 8000 }).catch(() => {});
  const when = await page.$$eval("[data-test=lib-row] .when", (es) => es.map((e) => e.textContent));
  const shape = (s) => s.replace(/\d+/g, "#").replace(/[A-Za-z]+/g, "M");
  const full = when.filter((w) => /2026/.test(w));
  assert(when.length >= 3 && full.length === 2 && shape(full[0]) === shape(full[1]) && !when.some((w) => /\d{4}\.\d/.test(w)),
    lang + " L5: the library's dates in one form (" + when.join(" | ") + ")");
  // L7: 设置's level is not 我's 「…水平」
  await page.goto(q + "#/settings");
  await page.waitForSelector("[data-test=set-level]");
  const setLabel = await page.$eval("[data-test=set-level]", (s) => s.closest("label").querySelector("span").textContent);
  assert(setLabel !== WORDS[lang].level && !setLabel.toLowerCase().includes({ zh: "水平", en: "level", ja: "強さ" }[lang]), lang + " L7: 设置 says " + setLabel + ", 我 says " + WORDS[lang].level);
  await ctx.close();
}

// --- L11: one element for [data-test=moves]; the settings written at once (a reload right after) -----------
{
  const { ctx, page } = await context();
  const q = BASE + "?engine=fake&think=0&autoreview=0&dbname=wt-hooks-" + Date.now();
  await page.goto(q + "#/play");
  await page.waitForSelector("[data-page=play] canvas");
  await page.click("[data-test=moves-toggle]");
  await page.waitForSelector("ol[data-test=moves]");
  assert(await page.$$eval("[data-test=moves]", (es) => es.length) === 1, "L11: [data-test=moves] is the move list alone");
  await page.goto(q + "#/settings");
  await page.waitForSelector("[data-test=set-lang]");
  await page.selectOption("[data-test=set-lang]", "en");
  // no wait: the page goes away right after the choice, as an app quit (or killed) right after it would
  await page.reload();
  await page.waitForSelector("[data-test=set-lang]");
  await page.waitForFunction(() => window.__app.store.get().settings.lang !== undefined);
  const back = await page.evaluate(() => window.__app.store.get().settings.lang);
  assert(back === "en", "a language chosen just before the page went away is the language it comes back in (" + back + ")");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-walkthrough-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
