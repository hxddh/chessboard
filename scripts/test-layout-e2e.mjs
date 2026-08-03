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
// Every measurement in this file was taken at one window size until 2.1.2 —
// 1400x900, sometimes 1200 or 1280 — while app.zon lets the window go down to
// 520x520. A panel column is 239px at 1400 and the whole layout argument rests
// on numbers like that, so "it fits" was only ever established at the widest
// end. `viewport` lets a section re-run at the narrow end; see 4c.
async function open(lang, mode, tab, theme = "wood", viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, locale: lang });
  // The theme is chosen at load. Setting data-theme on a page already living in
  // another one leaves a mixture — the theme blocks and the component block
  // have equal specificity, so which wins depends on source order, not on the
  // attribute — and a measurement taken then reads one theme's ink on another
  // theme's paper.
  await ctx.addInitScript(([l, m, tb, th]) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: m, langId: l, sideTab: tb, soundOn: false, themeId: th }));
    localStorage.setItem("chess.panelOpen", "1");
  }, [lang, mode, tab, theme]);
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
    // the game settings fold shut by default since P3.2 — open it, that is
    // where the wrapped segments live
    const rows = await page.evaluate(() => {
      const f = document.getElementById("fold-game");
      if (f) f.open = true;
      return [...document.querySelectorAll(".theme-row.wrap")].filter((r) => r.offsetParent).length;
    });
    assert(rows > 0, lang + ": the wrapped segments are on screen (" + rows + ")");
    assert(errs.length === 0, lang + ": no JS exception — " + errs.join(" / "));
    await ctx.close();
  }
}

// --- 2. the mode segment reads as one control in every language ------------
// It is a `.theme-row.wrap` on the settings page now, the same control the
// difficulty, the persona and the theme use. Same requirement as any segment:
// every button the same size, no label clipped, nothing past the panel edge.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "setup");
    const seg = await page.evaluate(() => {
      const el = document.getElementById("mode-seg");
      const pane = el.closest(".side-pane").getBoundingClientRect();
      return {
        buttons: [...el.querySelectorAll("button")].map((b) => ({
          text: b.textContent.trim(),
          h: Math.round(b.getBoundingClientRect().height),
          // scrollWidth > clientWidth is the label running out of its box
          over: b.scrollWidth - b.clientWidth,
          pastPane: Math.round(b.getBoundingClientRect().right - pane.right),
        })),
        visible: !!el.offsetParent,
      };
    });
    assert(seg.visible, lang + ": the mode segment is on the settings page");
    assert(seg.buttons.length === 4, lang + ": four modes");
    const heights = [...new Set(seg.buttons.map((b) => b.h))];
    assert(heights.length === 1,
      lang + ": every mode is the same height (" + heights.join(", ") + ")");
    for (const b of seg.buttons) {
      assert(b.over <= 0, lang + ": “" + b.text + "” fits its button (over by " + b.over + ")");
      assert(b.pastPane <= 1, lang + ": “" + b.text + "” stays inside the panel (past by " + b.pastPane + ")");
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
  // The top rung is 不限档 / Unrated / 無制限 since P5.8: 「满强度」 promised
  // unlimited strength and read as unlimited time, while the search is still
  // 1.2 seconds a move like every other tier. 缺陷 31.
  const EXPECT = {
    "zh-CN": { spar: ["新手", "休闲"], engine: ["初级", "中级", "高级", "不限档"] },
    en: { spar: ["Gentle", "Casual"], engine: ["Novice", "Intermediate", "Advanced", "Unrated"] },
    ja: { spar: ["やさしい", "お気軽"], engine: ["初級", "中級", "上級", "無制限"] },
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

// --- 3b. the bar over the board holds the move, and nothing else -----------
// Those 44px were permanently reserved above a board that is height-bound in
// every window this ships in, so they came off the board's edge: 5.2% of it at
// 1400x900, 8.7% at 640x560. What they held was three things on three clocks —
// a mode switch used once a session, a status that changes every ply, and
// tools used mid-move — in three heights and two baselines, because nothing in
// the row shared a unit. It is 32px now, and it holds one sentence and the two
// actions that belong to the move being made.
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const where = await page.evaluate(() => {
    const seg = document.getElementById("mode-seg");
    return {
      inChrome: !!(seg && seg.closest(".chrome")),
      inPanel: !!(seg && seg.closest(".side")),
      navRowsInPanel: document.querySelectorAll(".side .mode-nav, .side .side-tabs").length,
      onSetupPane: !!(seg && seg.closest("#pane-setup")),
    };
  });
  assert(!where.inChrome, "the mode switch is off the bar over the board");
  assert(where.inPanel && where.onSetupPane, "…and on the settings page");
  assert(where.navRowsInPanel === 1,
    "the panel still has one navigation row, not two (" + where.navRowsInPanel + ")");

  // …and the chrome carries one meaning per element: whose move, the two
  // actions for the move being made, the panel toggle. The wordmark and the
  // unlabelled move counter went in 2.0; mode, flip and new game went here.
  const chrome = await page.evaluate(() => ({
    brand: document.querySelectorAll(".chrome .brand").length,
    counter: document.querySelectorAll(".chrome #moves").length,
    pill: (document.getElementById("status") || {}).textContent || "",
    ids: [...document.querySelectorAll(".chrome button")].map((b) => b.id),
    // the one filled button in the app was "new game", over the board
    primaries: document.querySelectorAll(".chrome .primary").length,
  }));
  assert(chrome.brand === 0, "the wordmark is gone from the chrome");
  assert(chrome.counter === 0, "…and so is the unlabelled move counter");
  assert(chrome.pill.length <= 16,
    "the status pill holds a phrase, not a sentence (" + chrome.pill.length + " chars: " + chrome.pill + ")");
  assert(JSON.stringify(chrome.ids) === JSON.stringify(["undo", "btn-hint", "toggle-panel"]),
    "the bar is take-back, hint, panel — in that order (" + chrome.ids.join(", ") + ")");
  assert(chrome.primaries === 0,
    "nothing over the board is styled as the action to take");

  // Undo is absent until there is a move to take back, and this group is
  // right-aligned, so whatever appears pushes only what is to its left. With
  // undo in the middle it pushed 提示 56px sideways and landed in the pixels
  // 提示 had just left — two clicks in one place, help then take-back.
  const shift = await page.evaluate(async () => {
    const at = () => [...document.querySelectorAll(".chrome button")]
      .map((b) => ({ id: b.id, l: Math.round(b.getBoundingClientRect().left),
                     shown: getComputedStyle(b).visibility === "visible" }));
    const before = at();
    const cv = document.getElementById("board");
    const r = cv.getBoundingClientRect(), s = r.width / 8;
    const click = (c, rw) => {
      for (const type of ["pointerdown", "pointerup", "click"])
        cv.dispatchEvent(new MouseEvent(type,
          { clientX: r.left + (c + 0.5) * s, clientY: r.top + (rw + 0.5) * s, bubbles: true }));
    };
    click(4, 6); await new Promise((z) => setTimeout(z, 150));
    click(4, 4); await new Promise((z) => setTimeout(z, 500));
    return { before, after: at() };
  });
  const moved = shift.after.filter((a) => {
    const b = shift.before.find((x) => x.id === a.id);
    return b && Math.abs(b.l - a.l) > 1;
  });
  const undoBefore = shift.before.find((b) => b.id === "undo");
  const undoAfter = shift.after.find((b) => b.id === "undo");
  assert(undoBefore && !undoBefore.shown, "take-back is not shown with nothing to take back");
  assert(undoAfter && undoAfter.shown, "…and is shown once there is");
  assert(moved.length === 0,
    "…without moving anything in the bar, itself included (moved: " +
    moved.map((m) => m.id).join(", ") + ")");
  // it is the trade that is dangerous: after 1.e4 it is the engine's move, so
  // hint goes away in the same repaint that take-back arrives
  const hintBefore = shift.before.find((b) => b.id === "btn-hint");
  const hintAfter = shift.after.find((b) => b.id === "btn-hint");
  assert(hintBefore.shown && !hintAfter.shown,
    "hint leaves in the same repaint — after 1.e4 it is the engine's move");
  assert(hintAfter.l === hintBefore.l && undoAfter.l !== hintBefore.l,
    "…keeping its own slot rather than handing it to take-back (hint " +
    hintBefore.l + "→" + hintAfter.l + ", take-back at " + undoAfter.l + ")");
  // a slot nobody can use is a slot nobody can tab into
  const reach = await page.evaluate(() =>
    [...document.querySelectorAll(".chrome button")]
      .filter((b) => getComputedStyle(b).visibility !== "visible")
      .every((b) => b.offsetParent === null || !b.checkVisibility({ visibilityProperty: true })));
  assert(reach, "an empty slot is not reachable by keyboard");
  await ctx.close();
}

// --- 3b2. one height, one baseline ----------------------------------------
// The alignment this bar could never reach: 36 / 32 / 27.4px and baselines
// 26.5 / 25.3, because the mode row sized from --row-h, the buttons were a
// literal 32 and the pill was 4px of padding around whatever the text
// measured. It is also 12px from the left edge and 8px from the right.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    const bar = await page.evaluate(async () => {
      // shut the panel: with it open the right inset is the panel's width plus
      // the gap, so the two sides are only comparable here
      document.getElementById("toggle-panel").click();
      await new Promise((z) => setTimeout(z, 400));
      const ch = document.querySelector(".chrome");
      const cr = ch.getBoundingClientRect();
      const items = [document.querySelector(".status-pill"),
                     ...document.querySelectorAll(".chrome button")]
        .filter((e) => e && e.getBoundingClientRect().width > 0);
      const cs = getComputedStyle(ch);
      return {
        chrome: { t: cr.top, b: cr.bottom },
        padL: parseFloat(cs.paddingLeft), padR: parseFloat(cs.paddingRight),
        items: items.map((e) => {
          const b = e.getBoundingClientRect();
          return { id: e.id || e.className, h: Math.round(b.height * 10) / 10,
                   mid: Math.round((b.top + b.bottom) / 2 * 10) / 10,
                   past: Math.round((b.bottom - cr.bottom) * 10) / 10 };
        }),
      };
    });
    const heights = [...new Set(bar.items.map((i) => i.h))];
    const mids = [...new Set(bar.items.map((i) => i.mid))];
    assert(heights.length === 1,
      lang + ": everything in the bar is one height (" + heights.join(", ") + ")");
    assert(mids.length === 1,
      lang + ": …on one centre line (" + mids.join(", ") + ")");
    const barMid = Math.round((bar.chrome.t + bar.chrome.b) / 2 * 10) / 10;
    assert(Math.abs(mids[0] - barMid) <= 0.5,
      lang + ": …which is the bar's own (" + mids[0] + " vs " + barMid + ")");
    for (const i of bar.items)
      assert(i.past <= 0, lang + ": " + i.id + " stays inside the bar (past by " + i.past + ")");
    assert(bar.padL === bar.padR,
      lang + ": the bar's insets match (" + bar.padL + " / " + bar.padR + ")");
    await ctx.close();
  }
}

// --- 3c. the spine: the game is still readable with the panel shut ---------
// Closing the panel used to take whose-move, the clocks, the last move and the
// material difference with it, and leave the board on a plain colour — which is
// the state a small window plays in permanently. P3.6.
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const shut = await page.evaluate(async () => {
    document.getElementById("toggle-panel").click();
    await new Promise((r) => setTimeout(r, 300));
    const s = document.getElementById("spine");
    return { hidden: s.hidden, turn: document.getElementById("spine-turn").textContent };
  });
  assert(!shut.hidden, "the spine appears when the panel closes");
  assert(shut.turn.trim().length > 0, "…and says whose move it is — " + shut.turn);
  const open2 = await page.evaluate(async () => {
    document.getElementById("toggle-panel").click();
    await new Promise((r) => setTimeout(r, 300));
    return document.getElementById("spine").hidden;
  });
  assert(open2, "…and stands down when the panel is back: the panel says it all in more detail");
  await ctx.close();
}

// --- 3d. no visible control is disabled -----------------------------------
// P3's acceptance criterion, and P3.3's whole content. At 0 moves twelve
// visible controls were explicitly disabled — take back, the five replay keys,
// resume-from-here, copy PGN, export, offer draw, claim draw, resign, plus
// analyse and deep-analyse. A disabled control is a promise the interface is
// not keeping: it occupies the layout, it names an action, and it does
// nothing. Grouping actions by tense means the ones that cannot apply are not
// there at all.
//
// Confirmation buttons are the stated exception — a destructive action asking
// "are you sure" may hold its confirm until the box is read.
for (const [when, setup] of [
  ["开局前", async () => {}],
  ["进行中", async (page) => {
    // two plies, played through the board like a person would
    for (const sq of ["e2", "e4", "e7", "e5"]) {
      const c = await page.evaluate((s2) => {
        const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
        const f = s2.charCodeAt(0) - 97, rk = 8 - Number(s2[1]);
        return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(c.x, c.y);
      await page.waitForTimeout(120);
    }
  }],
]) {
  const { ctx, page } = await open("zh-CN", "ai", "play");
  await setup(page);
  await page.waitForTimeout(400);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("button, input, select")) {
      if (!b.disabled) continue;
      if (!b.offsetParent && getComputedStyle(b).position !== "fixed") continue; // not rendered
      if (b.closest(".modal-bg")) continue;                                      // a dialog's own controls
      out.push(b.id || b.textContent.trim().slice(0, 12) || b.className);
    }
    return out;
  });
  for (const b of bad) console.error("  visible but disabled: " + b);
  assert(bad.length === 0,
    when + ":屏幕上没有被禁用的可见控件" + (bad.length ? " —— " + bad.join(", ") : ""));
  await ctx.close();
}

// --- 3h. nothing is truncated, in any language, on any theme --------------
// P4.7, as a gate rather than a review: after a remake, the thing that breaks
// first is a label that fits in the language it was designed in. A clipped
// label is detectable — scrollWidth exceeds clientWidth — so it need not be
// looked for by eye. The status pill is exempt: it ellipsizes on purpose.
for (const lang of LANGS) {
  for (const theme of ["wood", "day"]) {
    const { ctx, page } = await open(lang, "ai", "setup");
    await page.evaluate((th) => {
      document.documentElement.setAttribute("data-theme", th);
      const f = document.getElementById("fold-game");
      if (f) f.open = true;
    }, theme);
    await page.waitForTimeout(250);
    const clipped = await page.evaluate(() => {
      const out = [];
      for (const e of document.querySelectorAll("button, .setting-k, .side-h, .act-k, .vs-role")) {
        if (!e.offsetParent) continue;
        if (e.id === "status" || e.closest("#status")) continue;   // ellipsizes on purpose
        if (e.classList.contains("switch")) continue;              // a knob, not a label
        if (e.scrollWidth > e.clientWidth + 1) {
          out.push((e.id || e.textContent.trim().slice(0, 14)) + " " + e.scrollWidth + ">" + e.clientWidth);
        }
      }
      return out;
    });
    for (const c of clipped) console.error("  clipped: " + c);
    assert(clipped.length === 0,
      lang + "/" + theme + ":没有被裁掉的标签" + (clipped.length ? " —— " + clipped.join(", ") : ""));
    await ctx.close();
  }
}

// --- 3i. nothing in the panel is cut off by the panel's edge --------------
// Measured, not guessed: on the code before this check, the three deletion
// buttons came to 90 + 102 + 66 plus gaps = 266px inside a 240px pane, and the
// last 26px — the tail of 清除全部存档 — was clipped by the pane. 3h above did
// not see it, and could not: it asks each label whether *it* scrolls, and a
// <button> with overflow: visible whose text runs past its box reports a
// scrollWidth clamped to its own padding box. The overflow is only visible on
// the ancestor that clips, and that ancestor is a scroller.
//
// So the question asked here is the one the eye asks: does anything stick out
// past the right edge of the panel. Element right edges, not scrollWidth —
// which also means the two things that deliberately paint outside their boxes
// are silent by construction rather than by exception, because both are
// pseudo-elements and neither is in the DOM: the switch's ::after hit target
// (inset -6px -2px) and the disclosure ›, which is rotated 90° when open.
for (const tab of ["play", "setup", "record"]) {
  const { ctx, page } = await open("zh-CN", "ai", tab);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#side details")) d.open = true;
  });
  await page.waitForTimeout(300);
  const out = await page.evaluate(() => {
    const side = document.getElementById("side");
    const edge = side.getBoundingClientRect().right;
    const res = [];
    for (const e of side.querySelectorAll("*")) {
      if (!e.offsetParent) continue;
      const r = e.getBoundingClientRect();
      if (r.width === 0) continue;
      if (r.right > edge + 1) {
        res.push((e.id || e.className || e.tagName) + " right=" + Math.round(r.right) +
          " panel=" + Math.round(edge));
      }
    }
    return res;
  });
  for (const o of out) console.error("  past the panel edge: " + o);
  assert(out.length === 0,
    tab + " 标签页:没有控件被面板边缘裁掉" + (out.length ? " —— " + out.join(", ") : ""));
  await ctx.close();
}

// --- 3j. no disabled control is on screen, in any tab ----------------------
// 3d asks this of the play tab at two moments in a game. The dimmed action
// links that prompted this were in the *setup* tab, where 3d never looked:
// `offsetParent` is null for anything in a pane that is not showing, so a
// check that only ever opens one tab cannot see the other two.
for (const tab of ["play", "setup", "record"]) {
  const { ctx, page } = await open("zh-CN", "ai", tab);
  await page.evaluate(() => {
    for (const d of document.querySelectorAll("#side details")) d.open = true;
  });
  await page.waitForTimeout(300);
  const bad = await page.evaluate(() => {
    const out = [];
    for (const b of document.querySelectorAll("#side button, #side input, #side select")) {
      if (!b.disabled) continue;
      if (!b.offsetParent && getComputedStyle(b).position !== "fixed") continue;
      if (b.closest(".modal-bg")) continue;
      out.push(b.id || b.textContent.trim().slice(0, 12) || b.className);
    }
    return out;
  });
  for (const b of bad) console.error("  visible but disabled: " + b);
  assert(bad.length === 0,
    tab + " 标签页:侧栏里没有被禁用的可见控件" + (bad.length ? " —— " + bad.join(", ") : ""));
  await ctx.close();
}

// --- 3k. every design token resolves, in every theme -----------------------
// The two worst defects in 2.0.0 were both invisible to a source-text check
// and both trivially visible here.
//
// One: a comment carrying the words `/* v1.9 polish */` closed itself early —
// CSS comments do not nest — and the parser's recovery swallowed the whole
// `:root, [data-theme="wood"]` block, i.e. every raw value and every semantic
// role of the DEFAULT theme. 271 rules parsed instead of 272; the panel
// rendered white with black text.
//
// Two: seven component variables were written `--accent: var(--accent)`. A
// custom property that references itself is invalid at computed-value time, so
// --accent, --danger, --primary-* and the three --on-* resolved to nothing in
// all four themes. The active tab's underline fell back to currentColor and
// the deletion links were not red.
//
// The unit suite has "every var() names a token that exists" — and it passed
// both times, because both tokens do exist in the text. Existing is not
// resolving. Only a browser can tell the difference.
{
  const TOKENS = ["--bg","--panel","--panel-border","--text","--muted","--accent","--win",
    "--btn","--btn-hover","--btn-ghost","--card","--card-border",
    "--primary-from","--primary-to","--danger","--on-primary","--on-accent","--on-danger"];
  for (const theme of ["wood","night","day","notebook"]) {
    const { ctx, page } = await open("zh-CN", "ai", "setup", theme);
    const empty = await page.evaluate((names) => {
      const cs = getComputedStyle(document.documentElement);
      return names.filter((n) => !cs.getPropertyValue(n).trim());
    }, TOKENS);
    for (const e of empty) console.error("  unresolved in " + theme + ": " + e);
    assert(empty.length === 0,
      theme + ":每个设计 token 都解析得出值" + (empty.length ? " —— 空的:" + empty.join(", ") : ""));
    await ctx.close();
  }
  // …and the stylesheet parsed whole: a swallowed block is a missing rule
  const { ctx, page } = await open("zh-CN", "ai", "setup");
  const sel = await page.evaluate(() => {
    const sh = [...document.styleSheets].find((s2) => (s2.href || "").includes("styles.css"));
    return [...sh.cssRules].map((r) => r.selectorText || "").filter(Boolean);
  });
  for (const want of [":root, [data-theme=\"wood\"]", "[data-theme=\"night\"]",
                      "[data-theme=\"day\"]", "[data-theme=\"notebook\"]"]) {
    assert(sel.includes(want), "样式表完整解析:" + want + " 这一块在");
  }
  await ctx.close();
}

// --- 3l. keyboard focus is visible ----------------------------------------
// The ring is color-mix(… var(--accent) …), so when --accent died the whole
// `outline` declaration went with it — and `outline-offset: 2px` from the same
// rule still applied, which is how you could tell the rule was matching and
// only that one line was being dropped. The comment above that rule exists
// because the app once shipped with the UA default at about 1.0:1. It was
// back to nothing.
{
  const { ctx, page } = await open("zh-CN", "ai", "setup");
  const bad = [];
  for (let i = 0; i < 14; i++) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(50);
    const r = await page.evaluate(() => {
      const e = document.activeElement;
      if (!e || e === document.body) return null;
      if (e.id === "board") return null;              // draws its own on-canvas cursor
      const cs = getComputedStyle(e);
      const ring = (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) ||
                   cs.boxShadow !== "none" ||
                   e.matches(".text-input");           // inputs mark focus on the border
      return ring ? null : (e.id || e.className || e.tagName);
    });
    if (r) bad.push(r);
  }
  assert(bad.length === 0,
    "键盘 Tab 到的每个控件都有可见焦点环" + (bad.length ? " —— 没有的:" + [...new Set(bad)].join(", ") : ""));
  await ctx.close();
}

// --- 3m. body text clears WCAG AA, in every theme --------------------------
// The board's own contrast has been measured since 1.11 and is quoted in the
// README; the interface text never was. 2.0.0 ran --day-muted at 3.79:1 and
// --notebook-muted at 3.86:1 against their own backgrounds — below the 4.5 an
// AA body text needs — across the mode row, the panel tabs, the player roles
// and every group label. wood and night cleared it.
//
// Two things this had to get right before it could be trusted, both of which
// it got wrong first. A fresh page per theme, not `setAttribute` on a page
// already loaded in another one: the theme blocks and the component block have
// equal specificity, so flipping the attribute mid-life leaves a mixture and
// the measurement reads one theme's ink on another theme's paper. And colours
// resolved through a canvas rather than by parsing the computed string:
// color-mix() computes to `color(srgb 0.72 0.61 0.49)`, whose components are
// 0–1, and reading those as 0–255 makes every mixed background look black —
// which is what briefly "found" a 1.13:1 badge that is really 7:1.
for (const theme of ["wood", "night", "day", "notebook"]) {
  const { ctx, page } = await open("zh-CN", "ai", "setup", theme);
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) d.open = true; });
  await page.waitForTimeout(250);
  const low = await page.evaluate(() => {
    const cv = document.createElement("canvas"); cv.width = cv.height = 1;
    const g2 = cv.getContext("2d", { willReadFrequently: true });
    const rgba = (css) => { g2.clearRect(0, 0, 1, 1); g2.fillStyle = "#000"; g2.fillStyle = css;
      g2.fillRect(0, 0, 1, 1); return [...g2.getImageData(0, 0, 1, 1).data]; };
    const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    const L = ([r, g3, b]) => 0.2126 * lin(r) + 0.7152 * lin(g3) + 0.0722 * lin(b);
    const bgOf = (e) => { let n = e; while (n) { const cs = getComputedStyle(n);
      if (cs.backgroundImage !== "none") return null;   // a gradient has no one colour
      const c = rgba(cs.backgroundColor); if (c[3] > 242) return c.slice(0, 3); n = n.parentElement; }
      return [255, 255, 255]; };
    const out = [];
    for (const e of document.querySelectorAll("#side *, .chrome *")) {
      if (!e.offsetParent) continue;
      if (![...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
      const cs = getComputedStyle(e);
      const fg = rgba(cs.color); if (fg[3] < 242) continue;
      if (parseFloat(cs.opacity) < 0.95) continue;
      const bg = bgOf(e); if (!bg) continue;
      const l1 = L(fg.slice(0, 3)), l2 = L(bg);
      const cr = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const size = parseFloat(cs.fontSize);
      const big = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
      if (cr < (big ? 3 : 4.5)) out.push((e.id || e.className || e.tagName) + " " + cr.toFixed(2));
    }
    return [...new Set(out)];
  });
  for (const l of low.slice(0, 6)) console.error("  low contrast in " + theme + ": " + l);
  assert(low.length === 0,
    theme + ":界面文字都达到 WCAG AA" + (low.length ? " —— " + low.length + " 处:" + low.slice(0, 3).join(", ") : ""));
  await ctx.close();
}

// --- 3n. every control has an accessible name -----------------------------
// 2.0.0's 失着提醒 and 自动翻转 switches had none: a screen reader announced
// "button, pressed" and nothing else. The sound switch beside them had a
// title, so the row read differently to a sighted user and to a blind one.
{
  const { ctx, page } = await open("zh-CN", "ai", "setup");
  await page.evaluate(() => { for (const d of document.querySelectorAll("details")) d.open = true; });
  await page.waitForTimeout(250);
  const anon = await page.evaluate(() =>
    [...document.querySelectorAll("button, input, select, [role=tab]")]
      .filter((e) => e.offsetParent)
      .filter((e) => !(e.getAttribute("aria-label") || e.textContent.trim() ||
                       e.title || e.getAttribute("aria-labelledby")))
      .map((e) => e.id || e.className || e.tagName));
  assert(anon.length === 0,
    "每个可见控件都有可读的名称" + (anon.length ? " —— 没有的:" + anon.join(", ") : ""));
  await ctx.close();
}

// --- 3g. the reading modes get a reading layout ---------------------------
// 72 lessons of prose in a 284px panel wrapped at about twenty characters a
// line, with the text, the task, three controls and the entire table of
// contents stacked in that one column. P3.5.
{
  const { ctx, page } = await open("zh-CN", "learn", "play");
  await page.waitForTimeout(400);
  const st = await page.evaluate(() => {
    const side = document.getElementById("side");
    const idx = document.querySelector("#sec-learn .reading-index");
    return {
      mode: document.getElementById("app").getAttribute("data-mode"),
      width: Math.round(side.getBoundingClientRect().width),
      indexFolded: idx ? !idx.open : null,
      indexItemsVisible: idx ? [...idx.querySelectorAll("button, .lesson-row")].filter((b) => b.offsetParent).length : -1,
      taskOwnSurface: !!document.querySelector("#lesson-task"),
    };
  });
  assert(st.mode === "learn", "the app says which mode it is in, so the layout can follow");
  assert(st.width >= 340, "the reading column is wider than the playing one (" + st.width + "px)");
  assert(st.indexFolded, "the table of contents is folded away by default");
  assert(st.indexItemsVisible === 0,
    "…so 72 lessons are not stacked under the one you are reading (" + st.indexItemsVisible + ")");
  assert(st.taskOwnSurface, "the task sits on its own surface, apart from the prose");
  await ctx.close();
}
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const w = await page.evaluate(() => Math.round(document.getElementById("side").getBoundingClientRect().width));
  assert(w <= 300, "…and the playing layout is exactly where it was (" + w + "px)");
  await ctx.close();
}

// --- 3f. settings read as a summary, and open on request ------------------
// Eighteen equal-weight buttons stood open permanently — six difficulties,
// four sparring styles, two colours, six clocks — in front of someone who
// mostly wants to know what the current ones are. P3.2.
{
  const { ctx, page } = await open("zh-CN", "ai", "setup");
  const st = await page.evaluate(() => {
    const f = document.getElementById("fold-game");
    const shut = { open: f.open, text: document.getElementById("game-summary").textContent,
      visibleButtons: [...f.querySelectorAll("button")].filter((b) => b.offsetParent).length };
    f.open = true;
    return { shut, openButtons: [...f.querySelectorAll("button")].filter((b) => b.offsetParent).length };
  });
  assert(!st.shut.open, "the game settings start folded");
  assert(st.shut.visibleButtons === 0, "…so none of the buttons is on screen (" + st.shut.visibleButtons + ")");
  assert(st.openButtons >= 14, "…and they are all there when you open it (" + st.openButtons + ")");
  // the summary has to actually say the four things
  const parts = st.shut.text.split(" · ").filter(Boolean);
  assert(parts.length >= 3,
    "the summary reads the current settings in one line — “" + st.shut.text + "”");
  await ctx.close();
}

// --- 3e. destructive actions are in one place, off the playing screen -----
// Four unrecoverable actions in four locations under three different words for
// "destroy" — 清除存档 pinned in red at the foot of the panel, 重置 in the
// lesson header, 清零 in the statistics header, 认输 in the game group — all of
// them permanent furniture a stray click away while you play. P3.7.
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const found = await page.evaluate(() => {
    const danger = [...document.querySelectorAll(".text-link.danger, .danger")]
      .filter((b) => b.tagName === "BUTTON");
    return {
      onPlayTab: danger.filter((b) => b.closest("#pane-play") && b.offsetParent).map((b) => b.id),
      inFoot: document.querySelectorAll(".side-foot").length,
      grouped: [...document.querySelectorAll("#pane-setup .text-link.danger")].map((b) => b.id).sort(),
    };
  });
  assert(found.inFoot === 0, "nothing irreversible is pinned to the foot of the panel");
  assert(JSON.stringify(found.grouped) === JSON.stringify(["clear-save", "learn-reset", "stats-clear"]),
    "the three data deletions live together under one heading — " + found.grouped.join(", "));
  // resign is the exception, and it is a move rather than a deletion: it stays
  // with the game, and P3.3 already made it present only while one is running
  assert(found.onPlayTab.every((id) => id === "btn-resign"),
    "the play tab carries no deletion — " + found.onPlayTab.join(", "));
  await ctx.close();
}

// --- 3o. a segmented control has no orphan segment ------------------------
// `auto-fit` with a 64px floor resolves to three columns in a 284px panel
// whatever the control holds, so every four-item segment laid out 3 + 1 — the
// mode row, the engine ladder, the sparring styles — while the theme row, also
// four items but a plain flex `.theme-row`, sat four-across two centimetres
// below. A segment alone on a line reads as a different kind of thing.
// 2.0.0 met this family once already and made the two rows equal *height*,
// which tidied the orphan without removing it.
{
  for (const lang of LANGS) {
    for (const mode of ["ai", "pvp", "learn", "puzzle"]) {
      const { ctx, page } = await open(lang, mode, "setup");
      const rows = await page.evaluate(() => {
        const f = document.getElementById("fold-game");
        if (f) f.open = true;
        const out = [];
        for (const g of document.querySelectorAll(".theme-row")) {
          if (!g.offsetParent) continue;
          const bs = [...g.querySelectorAll("button")];
          if (bs.length < 2) continue;
          const lines = new Map();
          for (const b of bs) {
            const t = Math.round(b.getBoundingClientRect().top);
            lines.set(t, (lines.get(t) || 0) + 1);
          }
          out.push({ id: g.id || g.className, n: bs.length,
                     lines: [...lines.entries()].sort((a, b) => a[0] - b[0]).map((e) => e[1]) });
        }
        return out;
      });
      assert(rows.length > 0, lang + "/" + mode + ": segments are on screen");
      for (const g of rows)
        assert(g.lines.length === 1 || g.lines[g.lines.length - 1] > 1,
          lang + "/" + mode + ": " + g.id + " has no segment alone on the last line (" +
          g.n + " → " + g.lines.join("+") + ")");
      await ctx.close();
    }
  }
}

// --- 3p. a group that has nothing to show is not on screen ----------------
// Hiding the <details> and leaving its <section> standing left 33px of nothing
// with the group's dividing rule still under it, on the settings page of both
// teaching modes — which reads as a group that failed to load. Same shape as
// the 「本局」 heading standing over a single 「新局」 at move 0.
{
  for (const mode of ["ai", "pvp", "learn", "puzzle"]) {
    for (const tab of ["play", "setup", "record"]) {
      const { ctx, page } = await open("zh-CN", mode, tab);
      const empties = await page.evaluate(() => {
        const pane = document.querySelector(".side-pane:not([hidden])");
        const out = [];
        for (const g of pane.querySelectorAll("section, .act-group")) {
          if (!g.offsetParent) continue;
          // a group folded shut is showing exactly what it means to show: its
          // heading, its summary line, and the arrow that opens it
          if (g.querySelector("details:not([open])")) continue;
          const heading = g.querySelector(".side-h, .act-k");
          const items = [...g.querySelectorAll("button, input, a")]
            .filter((e) => e.offsetParent && getComputedStyle(e).visibility === "visible");
          if (!heading) continue;
          if (items.length <= 1 && !g.querySelector(".stats-body, .hist-body, .ach-body, .move-list, .lesson-text"))
            out.push({ h: heading.textContent.trim(), n: items.length,
                       items: items.map((e) => e.textContent.trim().slice(0, 8)) });
        }
        return out;
      });
      for (const e of empties)
        assert(false, mode + "/" + tab + ": 「" + e.h + "」 is a heading over " +
          (e.n ? "a single item (" + e.items.join(",") + ")" : "nothing"));
      assert(empties.length === 0, mode + "/" + tab + ": every group on screen has a group in it");
      await ctx.close();
    }
  }
}

// --- 3q. the achievement grid is a grid of achievements -------------------
// The suggestion card and the two group headings were children of the same
// two-column grid as the badges, so each took one cell and left the other half
// blank — the panel opened on a bordered card beside a gap. And the names:
// 2.0.1 stopped them overflowing with `overflow-wrap: anywhere`, which stopped
// the overflow by breaking the word instead — nine of fifteen read 规则通/关,
// 熟能生/巧, 杀法大/师.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    const r = await page.evaluate(() => {
      const body = document.getElementById("ach-body");
      const br = body.getBoundingClientRect();
      const full = [...body.querySelectorAll(".ach-next, .ach-group")].map((e) => {
        const b = e.getBoundingClientRect();
        return { c: e.className, spans: Math.round(b.width) >= Math.round(br.width) - 1 };
      });
      // A name may wrap when it is genuinely wider than the space it has —
      // "Consistent winner" is two words and 17 characters in a 130px cell.
      // What it may not do is wrap while it would have fitted, which is what
      // was happening: the 0/111 counter sat on the same line and squeezed it
      // until `overflow-wrap: anywhere` broke 规则通/关 rather than the row
      // giving way. Measure the name on one line and compare with the room.
      const wrapped = [...body.querySelectorAll(".ach-nm")].map((n) => {
        const lh = parseFloat(getComputedStyle(n).lineHeight);
        const lines = Math.round(n.getBoundingClientRect().height / lh);
        if (lines <= 1) return null;
        const probe = n.cloneNode(true);
        probe.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto";
        n.parentElement.appendChild(probe);
        const need = probe.getBoundingClientRect().width;
        probe.remove();
        const room = n.parentElement.getBoundingClientRect().width -
          [...n.parentElement.children].filter((e) => e !== n)
            .reduce((a, e) => a + e.getBoundingClientRect().width + 6, 0) - 16;
        return need <= room ? { t: n.textContent.trim(), lines, need: Math.round(need), room: Math.round(room) } : null;
      }).filter(Boolean);
      const over = [...body.querySelectorAll(".ach-item")]
        .map((e) => Math.round(e.getBoundingClientRect().right - br.right)).filter((x) => x > 1);
      const badges = [...body.querySelectorAll(".ach-item")].map((e) => ({
        t: (e.querySelector(".ach-nm") || {}).textContent || "",
        h: Math.round(e.getBoundingClientRect().height) }));
      return { full, wrapped, over, badges, cols: getComputedStyle(body).gridTemplateColumns.split(" ").length };
    });
    for (const f of r.full)
      assert(f.spans, lang + ": ." + f.c.split(" ")[0] + " spans the grid rather than taking one badge's cell");
    assert(r.wrapped.length === 0,
      lang + ": no achievement name is broken while its row had the room — " +
      r.wrapped.map((w) => w.t + " (" + w.need + "px into " + w.room + ")").join(", "));
    assert(r.over.length === 0, lang + ": no badge runs past the grid (" + r.over.join(", ") + ")");
    // Fifteen badges are a list, and a list has one row height. In two columns
    // each row took its own: a name that wrapped, or a counter that dropped to
    // a second line, raised that row and left its neighbours alone. Measured on
    // the shipped build — Chinese 33 and 55, English 33/54/55/76/90, Japanese
    // 33/54/55/68/76. One column at the full panel width fits every name in
    // every language on one line with the counter beside it, which is the same
    // row the statistics directly above it are already made of.
    const heights = [...new Set(r.badges.map((b) => b.h))];
    assert(r.cols === 1, lang + ": the badges are one list, not two columns (" + r.cols + ")");
    assert(heights.length === 1,
      lang + ": every badge is the same height (" + heights.join(", ") + ") — tallest is 「" +
      (r.badges.find((b) => b.h === Math.max(...heights)) || {}).t + "」");
    await ctx.close();
  }
}

// --- 3s. the transport keys are one control -------------------------------
// «  ‹  ●  ›  »  — five keys whose positions relative to each other are what
// they mean, and which come and go with the replay position. Under `flex: 1`
// that meant two visible keys took 97px each and five took 37: press ‹ once at
// the live position and every key snapped to a third of its width while ‹
// itself jumped 61px left, out from under the pointer about to press it again.
// Third instance of the family, after the chrome's take-back/hint trade.
{
  const { ctx, page } = await open("zh-CN", "pvp", "play");
  const bar = () => page.evaluate(() =>
    [...document.querySelectorAll("#replay-seg button")].map((b) => ({
      id: b.id,
      l: Math.round(b.getBoundingClientRect().left),
      w: Math.round(b.getBoundingClientRect().width),
      shown: getComputedStyle(b).visibility === "visible",
    })));
  const clickSquares = async (list) => {
    for (const sq of list) {
      const pt = await page.evaluate((s) => {
        const c = document.getElementById("board"), r = c.getBoundingClientRect();
        return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                 y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
      await page.waitForTimeout(220);
    }
  };
  await clickSquares(["e2", "e4", "e7", "e5"]);
  const atLive = await bar();
  await page.click("#rep-prev");
  await page.waitForTimeout(400);
  const backOne = await bar();
  assert(atLive.length === 5 && backOne.length === 5, "five transport keys");
  const widths = [...new Set(atLive.concat(backOne).map((b) => b.w))];
  assert(widths.length === 1,
    "every transport key is the same width in every state (" + widths.join(", ") + ")");
  const moved = backOne.filter((b) => {
    const before = atLive.find((x) => x.id === b.id);
    return before && Math.abs(before.l - b.l) > 1;
  });
  assert(moved.length === 0,
    "…and stepping back moves none of them (" + moved.map((m) => m.id).join(", ") + ")");
  assert(atLive.filter((b) => b.shown).length < 5 && backOne.every((b) => b.shown),
    "…while still only offering the ones that lead somewhere");
  // one number, one place: the chip that repeated the 棋谱 heading's count is gone
  const counters = await page.evaluate(() => document.querySelectorAll("#replay-seg #moves").length);
  assert(counters === 0, "the replay bar does not repeat the move counter above it");
  await ctx.close();
}

// --- 3t. the message strip speaks, and the one that stays can be sent away -
// #toast carries all 110 of this app's messages, including 「引擎启动失败」,
// and had no role and no aria-live — while the board beside it has had a live
// region since the keyboard work and the storage banner sets role=alert
// explicitly. And the fault tier, the one that deliberately does not leave on
// its own, had no way out but a mouse landing on a div: not focusable, no ✕
// (the docblock said there was one), and Escape — which closes everything else
// transient in this app — did nothing, while it sat over the board's back rank.
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  // the stubbed engine makes 提示 fail, which is a real fault through the real
  // code path rather than a synthetic one
  await page.click("#btn-hint").catch(() => {});
  await page.waitForTimeout(900);
  const t = await page.evaluate(() => {
    const el = document.getElementById("toast");
    const close = el.querySelector(".toast-close");
    if (close) close.focus();
    return {
      shown: el.classList.contains("show"),
      fault: el.classList.contains("t-fault"),
      role: el.getAttribute("role"),
      live: el.getAttribute("aria-live"),
      hasClose: !!close,
      closeNamed: !!(close && (close.getAttribute("aria-label") || "").trim()),
      closeFocused: !!close && document.activeElement === close,
    };
  });
  assert(t.shown && t.fault, "a failed hint raises a fault toast — " + JSON.stringify(t));
  assert(t.role === "alert" && t.live === "assertive",
    "…that a screen reader is told about (" + t.role + "/" + t.live + ")");
  assert(t.hasClose && t.closeNamed && t.closeFocused,
    "…with a close control that is focusable and named");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  assert(await page.evaluate(() => !document.getElementById("toast").classList.contains("show")),
    "…and Escape sends it away, like everything else transient here");
  // the receipt tier is polite, not assertive: it must not interrupt
  const ok = await page.evaluate(async () => {
    document.getElementById("theme-seg") || 0;
    document.getElementById("tab-setup").click();
    await new Promise((r) => setTimeout(r, 300));
    document.querySelector('#theme-seg button[data-theme="night"]').click();
    await new Promise((r) => setTimeout(r, 300));
    const el = document.getElementById("toast");
    return { role: el.getAttribute("role"), live: el.getAttribute("aria-live"),
             close: !!el.querySelector(".toast-close") };
  });
  assert(ok.role === "status" && ok.live === "polite",
    "a receipt is announced politely (" + ok.role + "/" + ok.live + ")");
  assert(!ok.close, "…and carries no close control, because it leaves on its own");
  await ctx.close();
}

// --- 3u. a list of facts is a list, not six of one and one of another ------
// The six difficulty rows and the accuracy row are one list and read as one.
// In English the accuracy row wrapped both its halves and stood 42px against
// the others' 23 — 「Accuracy, last 10 games」 against 「69% · latest 78%」 in
// a 239px row. Chinese and Japanese never showed it.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [], diffs = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
      for (let i = 0; i < 20; i++) games.push({ id: "g" + i, t: Date.now() - i * 864e5,
        diff: diffs[i % 6], color: i % 2 ? "w" : "b", result: ["win", "loss", "draw"][i % 3],
        moves: 8 + i * 4, pgn: '[Event "?"]\n\n1. e4 e5 1/2-1/2', ending: "", acc: 40 + i * 2, acpl: 120 - i * 4 });
      localStorage.setItem("chess.v1.stats", JSON.stringify({ v: 2, games }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    const rows = await page.evaluate(() =>
      [...document.querySelectorAll(".stat-row")].filter((e) => e.offsetParent).map((e) => ({
        h: Math.round(e.getBoundingClientRect().height),
        k: (e.querySelector(".stat-k") || {}).textContent || "",
      })));
    assert(rows.length >= 6, lang + ": the statistics are on screen (" + rows.length + " rows)");
    const heights = [...new Set(rows.map((r) => r.h))];
    assert(heights.length === 1,
      lang + ": every row in the list is the same height (" + heights.join(", ") + ") — tallest is 「" +
      (rows.find((r) => r.h === Math.max(...heights)) || {}).k + "」");
    await ctx.close();
  }
}

// --- 3v. a dialog is called what it says it is ----------------------------
// Every dialog carried its title twice — an aria-label on the box and a
// visible <h3>, from two different i18n keys — and two of the pairs had
// drifted apart (「升变」/「升变为」, 「载入 FEN」/「载入 FEN 局面」). The
// confirm dialog was not merely drifted: its heading is written fresh for each
// question, while its aria-label was the fixed word 「确认」. Ask to delete
// every save and the screen said 「清除存档」 while a screen reader said
// 「确认」 — the most consequential dialog in the app, announced as nothing in
// particular.
{
  const { ctx, page } = await open("zh-CN", "ai", "setup");
  const dialogs = await page.evaluate(() =>
    [...document.querySelectorAll(".modal-bg")].map((d) => {
      const by = d.getAttribute("aria-labelledby");
      const target = by ? document.getElementById(by) : null;
      const h = d.querySelector("h3");
      return { id: d.id, by, label: d.getAttribute("aria-label"),
               pointsAtHeading: !!target && target === h,
               name: target ? target.textContent.trim() : null,
               heading: h ? h.textContent.trim() : null };
    }));
  assert(dialogs.length >= 7, "the dialogs are in the markup (" + dialogs.length + ")");
  for (const d of dialogs) {
    assert(!d.label, d.id + ": carries no second copy of its title as an aria-label");
    assert(d.pointsAtHeading, d.id + ": is named by the heading you can see (" + d.by + ")");
    assert(d.name && d.name === d.heading, d.id + ": 「" + d.name + "」 = 「" + d.heading + "」");
  }
  // and the one whose heading changes: what it is called must change with it
  const asked = await page.evaluate(async () => {
    document.getElementById("clear-save").click();
    await new Promise((r) => setTimeout(r, 500));
    const d = document.getElementById("confirm-modal");
    const by = document.getElementById(d.getAttribute("aria-labelledby"));
    return { open: d.classList.contains("show"), name: by ? by.textContent.trim() : null };
  });
  assert(asked.open, "asking to delete every save opens the confirm dialog");
  // …and every dialog is still a card. Widening one of them, I split the
  // `.modal` rule to add the modifier and left the background, the border, the
  // padding and the shadow behind in the modifier — so the six that are not
  // wide became bare text over the board. Nothing in this file noticed: every
  // check here reads geometry or names, and none of them asks whether the box
  // is a box. The save-slot dialog lost 34px of height and that was the only
  // trace.
  const boxes = await page.evaluate(() =>
    [...document.querySelectorAll(".modal-bg > .modal")].map((m) => {
      const cs = getComputedStyle(m);
      return { id: m.parentElement.id, bg: cs.backgroundColor,
               pad: parseFloat(cs.paddingTop), border: parseFloat(cs.borderTopWidth),
               w: Math.round(m.getBoundingClientRect().width) };
    }));
  for (const b of boxes) {
    assert(!/rgba\(0, 0, 0, 0\)|transparent/.test(b.bg),
      b.id + ": is drawn on something, not straight onto the board (" + b.bg + ")");
    assert(b.pad >= 12, b.id + ": keeps its padding (" + b.pad + ")");
    assert(b.border > 0, b.id + ": keeps its border (" + b.border + ")");
  }
  assert(asked.name && asked.name !== "确认",
    "…and it is announced by what it is asking, not by the word 「确认」 — 「" + asked.name + "」");
  await ctx.close();
}

// --- 3r. the settings page reads as one page ------------------------------
// Four groups, and the order is the argument: what you are doing, how this game
// is set, what the app looks like, and — last, always last — the three things
// that delete data. 2.1 had the deletions in the middle, the only red on the
// page, between the two groups you actually come here to adjust.
{
  for (const mode of ["ai", "learn"]) {
    const { ctx, page } = await open("zh-CN", mode, "setup");
    const secs = await page.evaluate(() =>
      [...document.querySelectorAll("#pane-setup > section")]
        .filter((s) => s.offsetParent)
        .map((s) => (s.querySelector(".side-h") || {}).textContent || "?"));
    assert(secs[0] === "模式", mode + ": mode comes first — " + secs.join(" → "));
    assert(secs[secs.length - 1] === "清除数据",
      mode + ": the deletions come last — " + secs.join(" → "));
    assert(secs.includes("对局") === (mode === "ai"),
      mode + ": the game group is present exactly when there is a game to set — " + secs.join(" → "));
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
// --- 3w. a label stays inside the control it names -------------------------
// `.tool-btn` is 32px tall and does not wrap; four of them at `flex: 1` in the
// editor's 239px row could not shrink below their own padding plus their
// longest word, so the labels wrapped inside a box that had no room for a
// second line and the text came out through the border. Measured on the
// shipped build: 「开始对局」 as two stacked lines in Chinese, 「Start game」
// with the button itself 32px past the panel's edge in English, and in
// Japanese 「キャンセル」 as three lines with its last character hanging below
// the pill. scrollHeight against clientHeight catches the whole class — any
// control anywhere whose text needs more room than the control has — which is
// why this is not written against the editor.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    await page.click("#editor-open", { timeout: 2000 }).catch(() => {});
    await page.waitForTimeout(500);
    const spilled = await page.evaluate(() =>
      [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent && b.scrollHeight > b.clientHeight + 1)
        .map((b) => b.textContent.trim() + " (" + b.scrollHeight + " needs " +
          b.clientHeight + " has, in #" + (b.closest("[id]") || {}).id + ")"));
    assert(spilled.length === 0,
      lang + ": every label fits inside its own button" +
      (spilled.length ? " — " + spilled.join("; ") : ""));
    // …and the row itself stays inside the panel it lives in
    const past = await page.evaluate(() => {
      const row = document.querySelector("#sec-editor .lesson-controls");
      if (!row) return null;
      const r = row.getBoundingClientRect();
      return [...row.querySelectorAll("button")]
        .filter((b) => b.getBoundingClientRect().right > r.right + 1)
        .map((b) => b.textContent.trim());
    });
    assert(past && past.length === 0,
      lang + ": no editor button reaches past the row" +
      (past && past.length ? " — " + past.join(", ") : ""));
    await ctx.close();
  }
}

// --- 3x. a segment of ten is still one control -----------------------------
// The puzzle type filter is the only segment in the app with more than four
// items, and it was the one the `.theme-row.wrap` comment claimed to have
// handled: "five or more fall back to three". It did not — `auto-fit` with a
// 64px floor resolves to four columns in a 335px panel — and at four columns
// 「Win material」 needed 79px in a 78px cell. One label one pixel too wide,
// and `grid-auto-rows: 1fr` passed its wrapped height to all ten buttons: the
// whole control half again as tall, in English only.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "puzzle", "play");
    const seg = await page.evaluate(() => {
      const g = document.getElementById("puzzle-cat-seg");
      const bs = [...g.querySelectorAll("button")];
      const one = bs.map((b) => {
        const c = b.cloneNode(true);
        c.style.cssText = "position:absolute;visibility:hidden;white-space:nowrap;width:auto";
        g.appendChild(c);
        const need = Math.ceil(c.getBoundingClientRect().width);
        c.remove();
        return { t: b.textContent.trim(), need, w: Math.round(b.getBoundingClientRect().width) };
      });
      return { cols: getComputedStyle(g).gridTemplateColumns.split(" ").length,
               heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
               tight: one.filter((x) => x.need > x.w) };
    });
    assert(seg.cols === 3, lang + ": ten items lay out three across (" + seg.cols + ")");
    assert(seg.heights.length === 1 && seg.heights[0] < 40,
      lang + ": every type is one line tall (" + seg.heights.join(", ") + ")");
    assert(seg.tight.length === 0,
      lang + ": no type name is wider than its cell" +
      (seg.tight.length ? " — " + seg.tight.map((x) => "「" + x.t + "」 " + x.need + " in " + x.w).join(", ") : ""));
    await ctx.close();
  }
}

// --- 3y. a refusal is heard, not only seen ---------------------------------
// Two places tell you why the app will not do what you asked, and both wrote
// into a plain <p>: the editor's reason the position is illegal (which is also
// the reason 「开始对局」 is greyed out) and the FEN dialog's reason the string
// was rejected. Text arriving in an element that is not a live region is text
// a screen reader never mentions — the same defect the toast had, in the two
// spots where the app is saying no. The FEN field also went red without ever
// being marked invalid, so the ring was the whole message.
{
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const attrs = await page.evaluate(() => {
    const g = (id) => {
      const e = document.getElementById(id);
      return e && { role: e.getAttribute("role"), live: e.getAttribute("aria-live") };
    };
    return { ed: g("editor-error"), fen: g("fen-error"),
             describedBy: document.getElementById("fen-input").getAttribute("aria-describedby") };
  });
  for (const [id, a] of [["editor-error", attrs.ed], ["fen-error", attrs.fen]]) {
    assert(a && a.role === "status" && a.live === "polite",
      id + " is a live region before anything is written into it (" +
      (a ? a.role + "/" + a.live : "missing") + ")");
  }
  assert(attrs.describedBy === "fen-error", "the FEN field points at its own reason");
  // and a rejected FEN really marks the field invalid
  const bad = await page.evaluate(async () => {
    document.getElementById("fen-load-open").click();
    await new Promise((r) => setTimeout(r, 400));
    const input = document.getElementById("fen-input");
    input.value = "not a fen";
    document.getElementById("fen-load").click();
    await new Promise((r) => setTimeout(r, 300));
    return { invalid: input.getAttribute("aria-invalid"), red: input.classList.contains("bad"),
             why: document.getElementById("fen-error").textContent.trim() };
  });
  assert(bad.red && bad.why, "a rejected FEN turns the field red and says why — 「" + bad.why + "」");
  assert(bad.invalid === "true", "…and the field is marked invalid, not only coloured (" + bad.invalid + ")");
  await ctx.close();
}

// --- 3z. the shortcut sheet describes the mode you are in ------------------
// The keydown handler has always been partitioned by mode — learn and puzzle
// return before the replay keys, N and F are reached — and the sheet was one
// flat list of thirteen rows shown identically everywhere. In 做题 it offered
// 「Z 悔棋」, 「F 翻转棋盘」 and the two replay rows, none of which do anything
// there, and it called N 「新局」 when in that mode N is the next puzzle. The
// only screen that tells you what the keyboard does was wrong in two of the
// app's four modes.
{
  const expect = {
    ai:     { has: ["新局", "悔棋", "翻转棋盘"], hasnt: ["下一题", "看答案", "重做当前这题"] },
    learn:  { has: ["重做当前这题", "悔棋", "本课提示"], hasnt: ["新局", "翻转棋盘", "下一题"] },
    puzzle: { has: ["下一题", "看答案", "重做当前这题"], hasnt: ["新局", "悔棋", "翻转棋盘"] },
  };
  for (const mode of Object.keys(expect)) {
    const { ctx, page } = await open("zh-CN", mode, "play");
    // the sheet has no button — 「?」 and the native Help menu are its two doors
    await page.keyboard.press("Shift+Slash");
    await page.waitForTimeout(400);
    const rows = await page.evaluate(async () => {
      const l = document.getElementById("keys-list");
      const out = [];
      for (let i = 0; i < l.children.length; i += 2)
        out.push({ keys: [...l.children[i].querySelectorAll("kbd")].map((k) => k.textContent).join("/"),
                   what: l.children[i + 1].textContent.trim() });
      return out;
    });
    assert(rows.length > 0, mode + ": the shortcut sheet has rows (" + rows.length + ")");
    const text = rows.map((r) => r.what);
    for (const want of expect[mode].has)
      assert(text.includes(want), mode + ": the sheet lists 「" + want + "」");
    for (const no of expect[mode].hasnt)
      assert(!text.includes(no),
        mode + ": the sheet does not offer 「" + no + "」, which does nothing here");
    // and the four that work everywhere are always there
    for (const k of ["P", "Tab", "Esc", "?"])
      assert(rows.some((r) => r.keys.split("/").includes(k)), mode + ": " + k + " is listed");
    await ctx.close();
  }
}

// --- 4a. the game list is a list, and its filters are labelled -------------
// Two defects in the dialog you open to find an old game.
// The rows: 「date · N moves · X% accuracy」 on one line, in a 380px box that
// left the line 262px. English needs 263 for a game played yesterday, because
// the relative form 「yesterday 12:55 AM」 is longer than the absolute
// 「7/31/2026」 that older games get — one pixel, and 12 of 40 rows stood 67px
// against the other 28 at 51. The box is what was wrong: this is the only
// dialog holding a scrolling list of sentences, and it was the width of the
// ones holding a single question.
// The filters: two segments side by side at `flex: 0 1 auto`, whose auto basis
// is the content width of a grid of `minmax(0, 1fr)` columns — zero. They
// never grew. Measured in Chinese: four result buttons sharing 60px and three
// colour buttons 94px inside a 418px row, and at 26px a column 「执白」 wrapped
// to three lines, so the colour filter stood 79px beside a 35px result filter.
// Stacked, full width, and each one now carries as a visible label the string
// that was only ever its aria-label — two 「全部」 buttons above each other,
// both active, with nothing on screen saying what either row filtered.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "record");
    await page.evaluate(() => {
      const games = [], diffs = ["beginner", "casual", "easy", "normal", "hard", "extreme"];
      for (let i = 0; i < 40; i++) games.push({ id: "g" + i, t: Date.now() - i * 36e5,
        diff: diffs[i % 6], color: i % 2 ? "w" : "b", result: ["win", "loss", "draw"][i % 3],
        moves: 8 + i * 3, pgn: '[Event "?"]\n\n1. e4 e5 1/2-1/2', ending: "", acc: 40 + i, acpl: 120 - i * 2 });
      localStorage.setItem("chess.v1.stats", JSON.stringify({ v: 2, games }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    await page.click("#hist-open", { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#hist-modal .hist-row")].filter((e) => e.offsetParent);
      const segs = [...document.querySelectorAll(".hist-filters .theme-row")].map((seg) => {
        const by = seg.getAttribute("aria-labelledby");
        const label = by ? document.getElementById(by) : null;
        const bs = [...seg.querySelectorAll("button")];
        return { id: seg.id, label: label && label.offsetParent ? label.textContent.trim() : null,
                 stray: seg.getAttribute("aria-label"),
                 heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
                 widths: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().width)))],
                 spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1).map((b) => b.textContent.trim()) };
      });
      return { n: rows.length,
               rowH: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               segs };
    });
    assert(r.n >= 20, lang + ": the history dialog is showing the games (" + r.n + ")");
    assert(r.rowH.length === 1,
      lang + ": every game in the list is the same height (" + r.rowH.join(", ") + ")");
    assert(r.segs.length === 2, lang + ": both filters are there (" + r.segs.length + ")");
    for (const s of r.segs) {
      assert(s.label, s.id + " (" + lang + "): carries a label you can see, not only one you can hear");
      assert(!s.stray, s.id + " (" + lang + "): and not a second copy of it as an aria-label");
      assert(s.heights.length === 1 && s.heights[0] < 40,
        s.id + " (" + lang + "): every segment is one line tall (" + s.heights.join(", ") + ")");
      assert(s.widths.length === 1,
        s.id + " (" + lang + "): every segment is the same width (" + s.widths.join(", ") + ")");
      assert(s.spill.length === 0,
        s.id + " (" + lang + "): no filter label breaks out of its button" +
        (s.spill.length ? " — " + s.spill.join(", ") : ""));
    }
    await ctx.close();
  }
}

// --- 4b. the spine gets its own strip, like the bar at the other end -------
// The chrome bar's height is held out of the board so its gradient never sits
// on rank 8 — the comment on `.stage` says exactly that. The spine is the same
// case at the bottom: a 24px pill pinned 6px off the floor, over a board
// fitted to within 6px of what it is given. Nothing was held out for it.
// Measured with the panel shut, before the fix: the pill ran 490–514 while the
// a–h letters ran 498–513 at 520x520, and 870–894 against 878–893 at
// 1400x900 — the last 7px of rank 1 and the whole file row, at every size,
// with the pill's own text lying across c–f.
{
  for (const [w, h] of [[1400, 900], [900, 700], [520, 520]]) {
    const { ctx, page } = await open("zh-CN", "ai", "play", "wood", { width: w, height: h });
    await page.keyboard.press("p");          // shut the panel: the spine's whole reason to exist
    await page.waitForTimeout(500);
    const r = await page.evaluate(() => {
      const app = document.getElementById("app");
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      const sp = document.getElementById("spine");
      const sr = sp && !sp.hidden ? sp.getBoundingClientRect() : null;
      return { shut: !app.classList.contains("panel-open"),
               wrapBottom: Math.round(wrap.bottom), board: Math.round(wrap.width),
               spine: sr ? { top: Math.round(sr.top), bottom: Math.round(sr.bottom) } : null,
               vh: innerHeight };
    });
    assert(r.shut, w + "x" + h + ": the panel is shut");
    assert(r.spine, w + "x" + h + ": …and the spine is what is left of the game");
    assert(r.spine.top >= r.wrapBottom - 1,
      w + "x" + h + ": the spine starts below the board, not on it (spine " +
      r.spine.top + ", board ends " + r.wrapBottom + ")");
    assert(r.spine.bottom <= r.vh,
      w + "x" + h + ": …and ends inside the window (" + r.spine.bottom + " of " + r.vh + ")");
    await ctx.close();
  }
  // and with the panel open the strip is not held: nothing is drawn there, and
  // a board that changed size when the spine appeared would be the defect the
  // chrome's two fixed slots exist to prevent, one axis over
  const { ctx, page } = await open("zh-CN", "ai", "play");
  const tok = await page.evaluate(() =>
    getComputedStyle(document.getElementById("app")).getPropertyValue("--spine-h").trim());
  assert(tok === "0px", "with the panel open nothing is reserved for the spine (" + tok + ")");
  await ctx.close();
}

// --- 4c. the smallest window the app allows ------------------------------
// app.zon sets min_width/min_height to 520 and every assertion in this file was
// written at 1400x900. docs/manual-check.md D5 ("缩到某个尺寸就不再变小，布局
// 不塌") is the only thing that ever covered the other end, and nobody has run
// it. These are the same questions the wide checks ask, asked at 520.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play", "wood", { width: 520, height: 520 });
    const r = await page.evaluate(() => {
      const de = document.documentElement;
      const past = [...document.querySelectorAll("body *")]
        .filter((e) => e.offsetParent && e.getBoundingClientRect().right > innerWidth + 1)
        .map((e) => ((e.textContent || "").trim().slice(0, 14) || e.tagName) +
                    " +" + Math.round(e.getBoundingClientRect().right - innerWidth));
      const spilled = [...document.querySelectorAll("button")]
        .filter((b) => b.offsetParent && b.scrollHeight > b.clientHeight + 1)
        .map((b) => b.textContent.trim().slice(0, 14));
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      return { hScroll: de.scrollWidth > de.clientWidth + 1,
               past: past.slice(0, 5), spilled: [...new Set(spilled)].slice(0, 5),
               board: Math.round(wrap.width),
               boardIn: wrap.bottom <= innerHeight + 1 && wrap.right <= innerWidth + 1 };
    });
    assert(!r.hScroll, lang + " @520: the page does not scroll sideways");
    assert(r.past.length === 0,
      lang + " @520: nothing is drawn past the window edge" +
      (r.past.length ? " — " + r.past.join(", ") : ""));
    assert(r.spilled.length === 0,
      lang + " @520: no label breaks out of its button" +
      (r.spilled.length ? " — " + r.spilled.join(", ") : ""));
    assert(r.boardIn && r.board > 300,
      lang + " @520: the board is whole and still the biggest thing on screen (" + r.board + "px)");
    await ctx.close();
  }
}

// --- 4d. a lesson button holds its own label ------------------------------
// The same defect as the editor's action row, in the teaching track, left
// there when 2.1.2 fixed the editor. `.tool-btn` is 32px tall and does not
// wrap, so a label that needs two lines came out through the bottom of the
// pill. Measured on the shipped 2.1.3, every lesson offering all four buttons
// leaked in all three languages — 「接着练 2 题」 as 「接着练 2 / 题」 with
// 「题」 hanging under the border, 「Practise (2)」 and 「Next lesson」 both in
// English, 「続けて2問」 and 「次のレッスン」 in Japanese. Lesson 72 leaks with
// only two buttons: 「Play the Beginner engine」, the one button the whole
// teaching track exists to reach.
// Not the editor's fix — that row overflowed sideways and needed 2×2. This one
// fits across; what it did not fit was the label inside the box.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "learn", "play");
    const n = await page.evaluate(() => document.querySelectorAll("#lesson-list .lesson-item").length);
    assert(n > 60, lang + ": the course is loaded (" + n + " lessons)");
    // the lessons that show all four, plus the last one — its label is the
    // longest in the file and it appears in a two-button row
    const probes = [17, 19, 21, n - 1];
    for (const i of probes) {
      const r = await page.evaluate(async (i) => {
        const it = document.querySelectorAll("#lesson-list .lesson-item")[i];
        if (it) it.click();
        await new Promise((r) => setTimeout(r, 150));
        const row = document.querySelector("#sec-learn .lesson-controls");
        const bs = [...row.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent);
        const rr = row.getBoundingClientRect();
        return { n: bs.length, labels: bs.map((b) => b.textContent.trim()),
                 heights: [...new Set(bs.map((b) => Math.round(b.getBoundingClientRect().height)))],
                 spill: bs.filter((b) => b.scrollHeight > b.clientHeight + 1)
                   .map((b) => b.textContent.trim() + " (" + b.scrollHeight + ">" + b.clientHeight + ")"),
                 past: bs.filter((b) => b.getBoundingClientRect().right > rr.right + 1)
                   .map((b) => b.textContent.trim()) };
      }, i);
      const at = lang + " lesson " + (i + 1) + " (" + r.n + " buttons)";
      assert(r.spill.length === 0,
        at + ": every label stays inside its button" +
        (r.spill.length ? " — " + r.spill.join("; ") : ""));
      assert(r.past.length === 0,
        at + ": and no button reaches past the row" +
        (r.past.length ? " — " + r.past.join(", ") : ""));
      assert(r.heights.length === 1,
        at + ": the row is one control, one height (" + r.heights.join(", ") + ")");
    }
    await ctx.close();
  }
}

// --- 4e. five save slots are five of the same thing -----------------------
// All four facts shared the second line — 「Engine · Unrated · 3 moves ·
// 8/2/2026, 8:59:30 AM」 — and in English that is 249px of text in 228, so the
// two filled slots stood 71px and 87px against the three empty ones' 55. Five
// identical things in three heights, in the dialog whose whole job is letting
// you compare them. Now the row is the shape the history list already uses:
// what kind of game on the first line, how long and when on the second — and
// the dialog is the wide one, because this is the second list of sentences in
// the app and 2.1.2 only widened the first.
{
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    await page.evaluate(() => {
      const mk = (d) => ({ pgn: '[Event "?"]\n[Result "*"]\n\n1. d4 d5 2. c4 e6 3. Nc3 Nf6 *',
                           savedAt: Date.now() - 1e7, mode: "ai", diff: d });
      localStorage.setItem("chess.v1.slots",
        JSON.stringify({ v: 1, slots: [mk("extreme"), mk("beginner"), null, null, null] }));
    });
    await page.reload();
    await page.waitForTimeout(900);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    await page.click("#slots-open", { timeout: 2500 }).catch(() => {});
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#slots-list > *")].filter((e) => e.offsetParent);
      const box = document.querySelector("#slots-modal .modal");
      return { n: rows.length,
               wide: box.classList.contains("wide"),
               heights: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               inline: rows.filter((e) => e.getAttribute("style")).length,
               spill: rows.filter((e) => e.scrollHeight > e.clientHeight + 1)
                 .map((e) => (e.textContent || "").trim().slice(0, 24)) };
    });
    assert(r.n === 5, lang + ": five slots (" + r.n + ")");
    assert(r.wide, lang + ": the slot list gets the wide box, like the other list of sentences");
    assert(r.heights.length === 1,
      lang + ": a filled slot is the same height as an empty one (" + r.heights.join(", ") + ")");
    assert(r.inline === 0, lang + ": the row is built from a class, not an inline style");
    assert(r.spill.length === 0,
      lang + ": nothing overflows a slot row" + (r.spill.length ? " — " + r.spill.join(", ") : ""));
    await ctx.close();
  }
}

// --- 4f. the game picker is the third list, found the same way ------------
// A PGN file may hold a database, and the picker lists what is in it: one row
// per game, 「N. White — Black  result」 over 「event · date · plies」. Real
// games vary in name and event length, so the rows varied with them — measured
// on a four-game file, 55px and 71px in all three languages. The same shape as
// the history rows and the save slots, in the same 380px box, found two
// versions after the first one was fixed. Guarded structurally in
// test-chess.mjs as well: any dialog holding a `.pick-list` gets the wide box.
{
  const GAMES = [
    ["Linares Super Tournament 1994", "Kasparov, Garry", "Karpov, Anatoly", "1-0"],
    ["Ch", "Li, Y", "Wu, X", "1/2-1/2"],
    ["World Championship Match, Game 6", "Nepomniachtchi, Ian", "Carlsen, Magnus", "0-1"],
    ["Op", "Ivanov, A", "Petrov, B", "1-0"],
  ];
  const PGN = GAMES.map(([ev, w, b, r], i) =>
    '[Event "' + ev + '"]\n[Site "Somewhere"]\n[Date "199' + i + '.02.1' + i + '"]\n' +
    '[White "' + w + '"]\n[Black "' + b + '"]\n[Result "' + r + '"]\n\n' +
    '1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 ' + r).join("\n\n");
  for (const lang of LANGS) {
    const { ctx, page } = await open(lang, "ai", "play");
    const opened = await page.evaluate(async (pgn) => {
      const dt = new DataTransfer();
      dt.items.add(new File([pgn], "games.pgn", { type: "application/x-chess-pgn" }));
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 900));
      return document.getElementById("pick-modal").classList.contains("show");
    }, PGN);
    assert(opened, lang + ": a four-game PGN opens the picker");
    const r = await page.evaluate(() => {
      const box = document.querySelector("#pick-modal .modal");
      const rows = [...document.querySelectorAll("#pick-list .pick-item")];
      return { wide: box.classList.contains("wide"), n: rows.length,
               heights: [...new Set(rows.map((e) => Math.round(e.getBoundingClientRect().height)))],
               tallest: (rows.find((e) => e.getBoundingClientRect().height ===
                 Math.max(...rows.map((x) => x.getBoundingClientRect().height))) || {}).textContent };
    });
    assert(r.n === 4, lang + ": all four games are listed (" + r.n + ")");
    assert(r.wide, lang + ": the picker gets the wide box");
    assert(r.heights.length === 1,
      lang + ": every game in the list is the same height (" + r.heights.join(", ") + ") — tallest is 「" +
      (r.tallest || "").trim().replace(/\s+/g, " ").slice(0, 40) + "」");
    await ctx.close();
  }
}

// --- 4g. the first launch, which nothing here had ever exercised -----------
// Every context in this file seeds localStorage before the page loads, so the
// one path every new user takes — cold start — was untested by construction.
// It was also broken: `firstRun` was computed by reading four keys at the end
// of init, and the puzzle store writes an empty record at import time, into the
// same bag those reads come out of. So it was false for everybody, and it gates
// two things — the first-run guide, and `detectLang()`.
// Measured on the shipped 2.1.4 with clean storage: en-US, ja-JP, zh-CN and
// de-DE all came up in Chinese, and the guide never appeared. Both of those are
// what docs/manual-check.md A3 names as the failure, and A3 has never been run.
{
  // de-DE is here on purpose: an unsupported locale falls back to Chinese by
  // design (test-chess pins fr-FR → zh-CN), so it proves the fallback still
  // works rather than that everything is Chinese again.
  for (const [locale, lang, tab] of [
    ["en-US", "en", "Play"], ["ja-JP", "ja", "対局"],
    ["zh-CN", "zh-CN", "对局"], ["de-DE", "zh-CN", "对局"],
  ]) {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale });
    const page = await ctx.newPage();          // nothing seeded: a new install
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1200);
    const r = await page.evaluate(() => ({
      shown: document.getElementById("pick-modal").classList.contains("show"),
      items: document.querySelectorAll("#pick-list .pick-item").length,
      firstTab: (document.getElementById("tab-play") || {}).textContent,
      stored: JSON.parse(localStorage.getItem("chess.v1.settings") || "{}").langId,
    }));
    assert(r.shown, locale + ": a new install opens the guide");
    assert(r.items === 2, locale + ": …with both ways in (" + r.items + ")");
    assert(r.stored === lang, locale + ": the app starts in the system's language (" + r.stored + ")");
    assert((r.firstTab || "").trim() === tab,
      locale + ": …and the interface is in it — 「" + (r.firstTab || "").trim() + "」");
    // choosing an answer closes it, and it does not come back
    const after = await page.evaluate(async () => {
      document.querySelector("#pick-list .pick-item").click();
      await new Promise((r) => setTimeout(r, 600));
      return document.getElementById("pick-modal").classList.contains("show");
    });
    assert(!after, locale + ": answering it closes it");
    await page.reload();
    await page.waitForTimeout(1100);
    const again = await page.evaluate(() =>
      document.getElementById("pick-modal").classList.contains("show"));
    assert(!again, locale + ": and the second launch is not a first launch");
    await ctx.close();
  }
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
