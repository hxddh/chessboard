/**
 * The three languages in the browser (v20-0-plan §6 S4), Chromium at
 * 1024×700, the app served as ES modules, the fake engine:
 *
 *   first run   the system's locale decides (en-US → English, ja-JP →
 *               Japanese, zh-CN → Chinese) and the first paint is already in it
 *   en, ja      下 (the game, the new-game sheet), 学 (placement, a lesson, a
 *               position, the skill map), 我 and 设置: no Chinese left on
 *               screen, nothing sticking out of its box or the window, no
 *               text cut short (an ellipsis or a clipped line)
 *   switching   设置 → English re-renders the page at once (no reload), the
 *               choice is a settings.set event, and it survives a reload
 *   lazy        the Chinese first paint fetches no language chunk
 *
 *   node scripts/test-lang-e2e.mjs      (E2E_REQUIRED=1: a missing browser fails)
 *   SHOTS=dir  also saves screenshots there
 */
import fs from "fs";
import path from "path";
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };

const srv = await startServer();
const browser = await launchChromium();
const errors = [];
const SIZE = { width: 1024, height: 700 };
const LOCALE = { zh: "zh-CN", en: "en-US", ja: "ja-JP" };

async function open(lang, hash = "#/play", query = "?engine=fake&db=memory") {
  const ctx = await browser.newContext({ viewport: SIZE, reducedMotion: "reduce", locale: LOCALE[lang] });
  const page = await ctx.newPage();
  const fetched = [];
  page.on("request", (r) => fetched.push(r.url()));
  page.on("pageerror", (e) => errors.push(lang + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(lang + ": " + m.text()); });
  await page.goto(srv.url + query + hash);
  await page.waitForSelector("[data-page]");
  return { ctx, page, fetched };
}

/**
 * What is wrong with the page in `lang`: Chinese still showing, an element
 * wider than the window or than its own box, a line cut short.
 */
function audit(page, lang) {
  return page.evaluate((lang) => {
    // Han in English; in Japanese, the simplified forms Japanese never writes
    const zh = lang === "zh" ? /$^/ : lang === "en" ? /[㐀-鿿]/ : /[这们个吗认输谁赢让还车马盘开时间对说过军题级练习页复杀吃种么样为进选动现线边给]/;
    const out = [];
    const shown = (el) => { const s = getComputedStyle(el); const r = el.getBoundingClientRect(); return s.visibility !== "hidden" && s.display !== "none" && r.width > 0 && r.height > 0; };
    const walker = document.createTreeWalker(document.getElementById("app"), NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = n.nodeValue.trim();
      const el = n.parentElement;
      if (!text || !el || !shown(el) || el.closest("option")) continue;
      if (zh.test(text)) out.push("Chinese: " + JSON.stringify(text.slice(0, 60)) + " in <" + el.tagName.toLowerCase() + " " + (el.dataset.test || el.className || "") + ">");
    }
    for (const el of document.querySelectorAll("#app [aria-label], #app [title]")) {
      const v = el.getAttribute("aria-label") || el.getAttribute("title");
      if (zh.test(v)) out.push("Chinese label: " + JSON.stringify(v));
    }
    for (const el of document.querySelectorAll("#app select option")) if (zh.test(el.textContent) && !el.hasAttribute("lang")) out.push("Chinese option: " + el.textContent);
    if (document.documentElement.scrollWidth > innerWidth + 1) out.push("the page scrolls sideways (" + document.documentElement.scrollWidth + " > " + innerWidth + ")");
    // 下 is laid out to fit the window: the board and its bar never need scrolling
    const outlet = document.getElementById("outlet");
    if (document.querySelector("[data-page=play]") && outlet.scrollHeight > outlet.clientHeight + 1) out.push("下 does not fit the window (" + outlet.scrollHeight + " > " + outlet.clientHeight + ")");
    if (outlet.scrollWidth > outlet.clientWidth + 1) out.push("the page is wider than the window (" + outlet.scrollWidth + ")");
    for (const el of document.querySelectorAll("#app *")) {
      if (!shown(el) || el.closest("svg") || el.tagName === "CANVAS") continue;
      const r = el.getBoundingClientRect(), s = getComputedStyle(el);
      if (r.right > innerWidth + 1 || r.left < -1) out.push("off screen: <" + el.tagName.toLowerCase() + " " + (el.dataset.test || el.className || "") + "> " + Math.round(r.left) + "–" + Math.round(r.right));
      const hasText = [...el.childNodes].some((c) => c.nodeType === 3 && c.nodeValue.trim());
      if (!hasText) continue;
      const clips = s.overflowX !== "visible" || s.textOverflow === "ellipsis";
      if (clips && el.scrollWidth > el.clientWidth + 1) out.push("cut short: " + JSON.stringify(el.textContent.trim().slice(0, 50)) + " (" + el.scrollWidth + " > " + el.clientWidth + ")");
      if (s.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 2 && s.overflowY !== "auto" && s.overflowY !== "scroll") out.push("clipped: " + JSON.stringify(el.textContent.trim().slice(0, 50)));
      // a button or label whose text runs out of it
      if ((el.tagName === "BUTTON" || el.tagName === "A") && el.scrollWidth > el.clientWidth + 1) out.push("overflows its button: " + JSON.stringify(el.textContent.trim().slice(0, 50)));
      // …or breaks over two lines inside it (a label squeezed by its neighbours)
      if (el.closest("button, a, [data-test=why], .chip")) {
        for (const c of el.childNodes) {
          if (c.nodeType !== 3 || !c.nodeValue.trim()) continue;
          const range = document.createRange();
          range.selectNodeContents(c);
          const lines = new Set([...range.getClientRects()].map((q) => Math.round(q.top)));
          if (lines.size > 1 && c.nodeValue.trim().length < 30) out.push("a short label breaks over " + lines.size + " lines: " + JSON.stringify(c.nodeValue.trim()));
        }
      }
    }
    return out;
  }, lang);
}
async function check(page, lang, what) {
  await page.waitForTimeout(60);
  const bad = await audit(page, lang);
  assert(bad.length === 0, lang + " " + what + ": no Chinese, nothing cut or sticking out" + (bad.length ? " — " + [...new Set(bad)].slice(0, 8).join(" | ") : ""));
  await shot(page, lang + "-" + what.replace(/\W+/g, "-"));
}

// --- the first run follows the system; the Chinese first paint fetches no language chunk -----------------------
for (const lang of ["zh", "en", "ja"]) {
  const { ctx, page, fetched } = await open(lang);
  await page.waitForSelector("[data-page=play] canvas");
  const got = await page.evaluate(() => ({ lang: document.documentElement.lang, nav: [...document.querySelectorAll("[data-nav]")].map((a) => a.textContent).join(" "),
    setting: window.__app.store.get().settings.lang }));
  const want = { zh: ["zh-CN", "学 下 我 设置"], en: ["en", "Learn Play Me Settings"], ja: ["ja", "学ぶ 指す わたし 設定"] }[lang];
  assert(got.lang === want[0] && got.nav === want[1] && got.setting === lang, "system locale " + LOCALE[lang] + " → " + lang + " on the first run (" + JSON.stringify(got) + ")");
  const chunks = fetched.filter((u) => /\/(pack|words)\.(en|ja)/.test(u));
  if (lang === "zh") assert(chunks.length === 0, "the Chinese first paint fetches no language chunk (" + chunks.join(" ") + ")");
  else assert(chunks.some((u) => u.includes("pack." + lang)) && !chunks.some((u) => u.includes("words.")), lang + ": the first paint fetches the interface, not the lessons (" + chunks.map((u) => u.split("/").pop()).join(" ") + ")");
  await ctx.close();
}

// --- every page in English and Japanese (and Chinese, for the layout alone) ----------------------------------
for (const lang of ["zh", "en", "ja"]) {
  {
    const { ctx, page } = await open(lang, "#/play");
    await page.waitForSelector("[data-page=play] canvas");
    // a move each way, so the bar, the move list and the opponent's line have something to say
    await page.evaluate(() => window.__app.store.dispatch("play.move", { uci: "e2e4" }));
    await page.waitForFunction(() => window.__app.store.get().play.game.moves.length >= 2, null, { timeout: 8000 }).catch(() => {});
    await check(page, lang, "play");
    await page.click("[data-test=new]");
    await page.waitForSelector("[data-test=sheet]");
    for (let i = 0; i < 16; i++) {
      await check(page, lang, "new-game sheet, opponent " + i);
      if (await page.$eval("[data-test=opp-next]", (b) => b.disabled)) break;
      await page.click("[data-test=opp-next]");
    }
    await page.click("[data-test=sheet-close]");
    await page.click("[data-test=resign]").catch(() => {});
    const confirm = await page.$("[data-test=confirm]");
    if (confirm) { await confirm.click(); await page.waitForTimeout(150); await check(page, lang, "play after resigning"); }
    await ctx.close();
  }
  {
    const { ctx, page } = await open(lang, "#/learn", "?engine=fake&db=memory&chain=60");
    await page.waitForSelector("[data-test=place]:not([hidden])");
    await check(page, lang, "learn placement");
    await page.click("[data-test=place-new]");
    await page.waitForFunction(() => window.__learn && window.__learn.item);
    const text = await page.textContent("[data-test=lesson-text]");
    if (lang === "zh") { await check(page, lang, "learn lesson"); await ctx.close(); continue; }
    assert(text.trim().length > 20, lang + ": the first lesson's text is there (" + text.trim().slice(0, 40) + "…)");
    await check(page, lang, "learn lesson");
    await page.click("[data-test=act-start]");
    await page.waitForFunction(() => window.__learn.item && window.__learn.item.kind !== "lesson");
    await check(page, lang, "learn position");
    await page.click("[data-test=open-map]");
    await page.waitForSelector("[data-test=skill-map]:not([hidden])");
    await check(page, lang, "skill map");
    await page.click("[data-skill=fork]");
    await check(page, lang, "skill map, a locked skill");
    await ctx.close();
  }
  for (const route of ["me", "settings"]) {
    const { ctx, page } = await open(lang, "#/" + route);
    await page.waitForSelector("[data-page=" + route + "]");
    await page.waitForTimeout(200);
    await check(page, lang, route);
    await ctx.close();
  }
}

// --- switching in 设置: no reload, an event, and it stays -----------------------------------------------------
{
  const { ctx, page } = await open("zh", "#/settings", "?engine=fake&dbname=lang-e2e");
  await page.waitForSelector("[data-test=set-lang]");
  await page.evaluate(() => { window.__noReload = true; });
  await page.selectOption("[data-test=set-lang]", "en");
  await page.waitForFunction(() => document.querySelector("[data-page=settings] h1").textContent === "Settings");
  const s = await page.evaluate(async () => {
    const db = await window.__app.ready;
    await db.flush();
    return { same: window.__noReload === true, lang: document.documentElement.lang, nav: document.querySelector('[data-nav][href="#/play"]').textContent,
      saved: (await db.query("settings.all")).lang };
  });
  assert(s.same && s.lang === "en" && s.nav === "Play", "设置 → English: the page and the shell re-render without a reload (" + JSON.stringify(s) + ")");
  assert(s.saved === "en", "the choice is a settings.set event in the db (" + s.saved + ")");
  await page.click('a[href="#/play"]');
  await page.waitForSelector("[data-page=play] canvas");
  assert(/[A-Za-z]/.test(await page.textContent("[data-test=bar-text]")), "下 is in English after the switch");
  await page.goto(srv.url + "?engine=fake&dbname=lang-e2e#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden]), [data-test=learn]");
  await page.waitForFunction(() => document.documentElement.lang === "en");
  assert(true, "after a reload the chosen language stays (zh-CN system locale)");
  await page.goto(srv.url + "?engine=fake&dbname=lang-e2e#/settings");
  await page.waitForSelector("[data-test=set-lang]");
  await page.selectOption("[data-test=set-lang]", "ja");
  await page.waitForFunction(() => document.querySelector("[data-page=settings] h1").textContent === "設定");
  await page.selectOption("[data-test=set-lang]", "zh");
  await page.waitForFunction(() => document.querySelector("[data-page=settings] h1").textContent === "设置" && document.documentElement.lang === "zh-CN");
  assert(true, "and on to Japanese and back to Chinese");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-lang-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
