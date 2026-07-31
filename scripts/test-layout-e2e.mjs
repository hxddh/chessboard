/**
 * Browser check for the side panel's layout — the things a screenshot shows
 * and no unit test can.
 *
 * Everything here was found by looking at a running window, and every one of
 * them is a claim about geometry that only a laid-out page can settle:
 *
 *   - a wrapped segment row's last button was as wide as the whole panel,
 *     because `flex: 1 1 30%` lets the last line share itself out. A full
 *     width filled button is this UI's word for "primary action", and 满强度
 *     / 爱进攻 were wearing it for no reason other than 4 % 3 == 1.
 *   - "2 players" and "レッスン" wrapped to two lines inside a mode tab.
 *   - a lesson with no sparring partner still drew the opponent card, with an
 *     em dash where the opponent's name goes.
 *   - the ✕ in the tab row was the same height, in the same row, aligned with
 *     three tabs, and was not a tab.
 *   - 演示 was permanently greyed out on every lesson that has no demo.
 *
 * Reading widths off the real box model is the point: "they fit" and "they are
 * the same size" are exactly the claims that get made from memory and are
 * wrong. Same harness as the other browser checks (see e2e-browser.mjs);
 * skips cleanly without a browser unless E2E_REQUIRED=1.
 *   node scripts/test-layout-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";

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
const assert = (cond, msg) => {
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

/**
 * The app, opened in one language and one mode, panel open on a given tab.
 * The settings key is written before the page runs, which is how the app
 * itself restores them — nothing here clicks through the onboarding.
 */
async function open(lang, mode, tab) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: lang });
  await ctx.addInitScript(([l, m, tb]) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: m, langId: l, sideTab: tb, soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  }, [lang, mode, tab]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  // there is normally no game picker to dismiss; a full 30s default timeout
  // per context turns this file into a five-minute test for nothing
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  return { ctx, page, errs };
}

const LANGS = ["zh-CN", "en", "ja"];

// --- 1. no button in a wrapped row is wider than the others ----------------
// The bug was specifically the *last* one on a short final line, so measuring
// max/min across the row catches it without knowing which row wraps.
{
  for (const lang of LANGS) {
    const { ctx, page, errs } = await open(lang, "ai", "setup");
    // The "are these buttons the same width" measurement moved to
    // test-chess.mjs (P2.8): equal widths are a consequence of the wrapped
    // segment being a grid with shared columns, and that is one declaration,
    // checkable in milliseconds and in every language at once. What a browser
    // is still needed for is whether the rows are *there* and whether opening
    // the panel in this language throws.
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".theme-row.wrap")].filter((r) => r.offsetParent).length);
    assert(rows > 0, lang + ": the wrapped segments are on screen (" + rows + ")");
    assert(errs.length === 0, lang + ": no JS exception — " + errs.join(" / "));
    await ctx.close();
  }
}

// --- 2. mode tabs are one line tall in every language ----------------------
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    const tabs = await page.evaluate(() => [...document.querySelectorAll("#mode-seg button")].map((b) => ({
      text: b.textContent.trim(),
      h: Math.round(b.getBoundingClientRect().height),
      // scrollWidth > clientWidth is the label running out of its box
      over: b.scrollWidth - b.clientWidth,
    })));
    assert(tabs.length === 4, lang + ": four mode tabs");
    const rowH = await page.evaluate(() =>
      parseInt(getComputedStyle(document.documentElement).getPropertyValue("--row-h"), 10));
    for (const t of tabs) {
      assert(t.h <= rowH + 1, lang + ": “" + t.text + "” is one row tall (" + t.h + " ≤ " + rowH + ")");
      assert(t.over <= 0, lang + ": “" + t.text + "” fits its tab without clipping (over by " + t.over + ")");
    }
    await ctx.close();
  }
}

// --- 3. the difficulty labels read in order, and the two scales are two ----
// The 1.24 regression: the sparring tier and the engine's floor were near
// synonyms in English (Beginner / Novice) and Japanese (入門 / 初級), with the
// *stronger* of the pair being the one that reads weaker.
// Distinctness is not enough — "Beginner" and "Novice" are distinct strings,
// and that pair is exactly what shipped. The labels are frozen here instead,
// so changing one is a deliberate act with this note attached to it: the two
// sparring tiers must not borrow the ladder's vocabulary, because the ladder
// starts *above* them and a reader who knows the word "novice" will read it
// as the weaker of the two.
{
  const EXPECT = {
    "zh-CN": { spar: ["新手", "休闲"], engine: ["初级", "中级", "高级", "满强度"] },
    en: { spar: ["Gentle", "Casual"], engine: ["Novice", "Intermediate", "Advanced", "Full strength"] },
    ja: { spar: ["やさしい", "お気軽"], engine: ["初級", "中級", "上級", "フルパワー"] },
  };
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "setup");
    const labels = await page.evaluate(() => ({
      spar: [...document.querySelectorAll("#diff-seg button")].map((b) => b.textContent.trim()),
      engine: [...document.querySelectorAll("#diff-seg-engine button")].map((b) => b.textContent.trim()),
      groups: [...document.querySelectorAll("#row-difficulty .diff-group")].map((s) => s.textContent.trim()),
      // there must be no third heading above the two group labels
      keys: [...document.querySelectorAll("#row-difficulty .setting-k")].length,
    }));
    assert(labels.spar.length === 2 && labels.engine.length === 4, lang + ": 2 sparring tiers, 4 engine tiers");
    assert(labels.groups.length === 2, lang + ": both groups are labelled");
    assert(labels.keys === 0, lang + ": no redundant 难度 heading above the group labels");
    const all = labels.spar.concat(labels.engine);
    assert(new Set(all).size === all.length, lang + ": all six labels are distinct — " + all.join(" / "));
    assert(JSON.stringify(labels.spar) === JSON.stringify(EXPECT[lang].spar),
      lang + ": the sparring pair is the reviewed one — " + labels.spar.join(" / "));
    assert(JSON.stringify(labels.engine) === JSON.stringify(EXPECT[lang].engine),
      lang + ": the engine ladder is the reviewed one — " + labels.engine.join(" / "));
    await ctx.close();
  }
}

// --- 4. the tab row holds tabs only ---------------------------------------
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const kids = await page.evaluate(() => [...document.querySelector(".side-tabs").children]
    .map((el) => el.getAttribute("role")));
  assert(kids.length === 3 && kids.every((r) => r === "tab"),
    "the tab row contains three tabs and nothing else — got " + JSON.stringify(kids));
  // and the panel is still closable without it
  await page.click("#toggle-panel");
  await page.waitForTimeout(400);
  const open1 = await page.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
  assert(!open1, "the topbar ☰ still closes the panel");
  await page.keyboard.press("p");
  await page.waitForTimeout(400);
  const open2 = await page.evaluate(() => document.getElementById("app").classList.contains("panel-open"));
  assert(open2, "…and P still opens it");
  await ctx.close();
}

// --- 5. a lesson with no opponent draws no opponent ------------------------
{
  const { ctx, page } = await open("zh-CN", "learn", "play");
  const vs = await page.evaluate(() => {
    const bar = document.getElementById("vs-bar");
    const right = bar.querySelector(".vs-right");
    return {
      solo: bar.classList.contains("solo"),
      rightShown: !!right.offsetParent,
      role: document.getElementById("black-role").textContent.trim(),
    };
  });
  assert(vs.solo, "lesson 1 has no sparring partner, so the bar is in solo mode");
  assert(!vs.rightShown, "…and the opponent half is not drawn at all");
  assert(vs.role !== "—", "…rather than drawn with an em dash for a name");
  await ctx.close();
}

// --- 6. 演示 is present when it works and absent when it cannot ------------
{
  const { ctx, page } = await open("zh-CN", "learn", "play");
  const state = await page.evaluate(() => {
    const b = document.getElementById("lesson-demo");
    return { hidden: b.hidden, disabled: b.disabled };
  });
  // whichever way lesson 1 falls, the button is never "visible and dead"
  assert(!(state.hidden === false && state.disabled === true),
    "演示 is never shown permanently greyed out — hidden=" + state.hidden + " disabled=" + state.disabled);
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
