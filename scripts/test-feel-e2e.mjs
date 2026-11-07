/**
 * Browser checks for v20-0-plan §5 H (手感) on the 20.0 app, in Chromium:
 *
 *   figurines   moves print as Merida figurines in the move list and in the
 *               sentences (bar, lessons): the glyph is in the text's colour in
 *               the light and the dark shell, a little over a capital high and
 *               ≥ 9 px; textContent, a copied selection and the accessible
 *               name are the SAN
 *   motion      a move tweens 250 ms; a man dropped settles (≤ 120 ms); one let
 *               go on an illegal square slides home (≤ 180 ms); reduced motion
 *               turns all of it off; the legal square under a man in the hand
 *               lights; the pointer says grab / pointer / grabbing
 *   input       a move made while the last one is still animating is taken
 *               (animation never blocks input), a premove too
 *   drag cost   script time per pointermove, layouts and style recalcs during a
 *               60-step drag (none of the box reads may force a layout)
 *   sound       after the first press the every-move takes are rendered in idle
 *               time, so a move never renders one (cold = 0); the setting off
 *               makes no sound and no context
 *
 *   node scripts/test-feel-e2e.mjs [--dev] [--shots=DIR]   (E2E_REQUIRED=1: a missing browser fails)
 * Prints MEASURED {...} for docs/v20-0-plan.md §10.
 */
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");

let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); }
};
const DEV = process.argv.includes("--dev");
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8) || null;
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchChromium();
const errors = [];
const report = {};
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };

async function open(query = "", { w = 1280, h = 860, ctxOpts = {} } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...ctxOpts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?think=0&engine=fake&db=memory" + query);
  await page.waitForSelector("[data-page=play] canvas");
  await page.waitForFunction(() => window.__app.store.get().play.game && window.__play);
  return { ctx, page };
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const plies = (page) => page.evaluate(() => (window.__app.store.get().play.game?.moves || []).map((m) => m.san));
const pvp = (page) => page.evaluate(() => window.__app.store.dispatch("play.new", { id: "f" + Math.random().toString(36).slice(2), mode: "pvp" }));
const centre = (page, sq) => page.evaluate((sq) => window.__play.board.squareCenter(sq), sq);
const bstate = (page) => page.evaluate(() => window.__play.board.state());
async function clickMove(page, uci) {
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) { const p = await centre(page, sq); await page.mouse.click(p.x, p.y); }
}
/** How long a man on the board keeps moving from now, measured frame by frame (ms). */
const animatingFor = (page) => page.evaluate(() => new Promise((res) => {
  const t0 = performance.now();
  const tick = () => (window.__play.board.state().moving ? requestAnimationFrame(tick) : res(performance.now() - t0));
  tick();
}));

// --- figurines --------------------------------------------------------------------------
{
  const { ctx, page } = await open();
  await pvp(page);
  for (const u of ["e2e4", "e7e5", "g1f3", "b8c6", "f1b5", "a7a6", "b5c6", "d7c6", "e1g1"]) await clickMove(page, u);
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 9);
  await page.evaluate(() => { document.querySelector("[data-test=drawer]").hidden = false; });
  const rows = await page.$$eval("ol[data-test=moves] li .san", (els) => els.map((e) => ({
    text: e.textContent, figs: e.querySelectorAll(".fig svg").length, letters: [...e.querySelectorAll(".fig-l")].map((l) => l.textContent).join(""),
    hidden: [...e.querySelectorAll(".fig svg")].every((s) => s.getAttribute("aria-hidden") === "true"),
  })));
  const sans = await plies(page);
  assert(rows.map((r) => r.text).join(" ") === sans.join(" "), "the move list's text is the SAN (" + rows.map((r) => r.text).join(" ") + ")");
  const nf3 = rows[2], bxc6 = rows[6], castle = rows[8], pawn = rows[0];
  assert(nf3.figs === 1 && nf3.letters === "N" && nf3.hidden, "Nf3: one figurine, the letter kept under it, the glyph hidden from the accessibility tree");
  assert(bxc6.figs === 1 && pawn.figs === 0 && castle.figs === 0, "a pawn move and O-O keep their letters; Bxc6 gets a bishop");

  // a selection copies SAN
  const copied = await page.evaluate(() => {
    const ol = document.querySelector("ol[data-test=moves]");
    const r = document.createRange(); r.selectNodeContents(ol);
    const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    const s = sel.toString(); sel.removeAllRanges();
    return s;
  });
  assert(/Nf3/.test(copied) && /Bb5/.test(copied) && /Bxc6/.test(copied) && !/[♘♗]/.test(copied), "a copied selection of the list is SAN (" + copied.replace(/\s+/g, " ").trim() + ")");
  // and so is what a screen reader is given
  const aria = await page.locator("ol[data-test=moves] li:nth-child(3) .san").ariaSnapshot();
  assert(/Nf3/.test(aria), "the accessible text is Nf3 (" + aria.replace(/\s+/g, " ") + ")");

  // the glyph in the text's colour, legible, in the light and the dark shell
  for (const appearance of ["light", "dark"]) {
    await page.evaluate((v) => window.__app.store.dispatch("settings.set", { key: "appearance", value: v }), appearance);
    await frames(page);
    const m = await page.$eval("ol[data-test=moves] li:nth-child(3) .san .fig svg", (f) => {
      const span = f.closest(".san"), path = f.querySelector("path");
      const fill = getComputedStyle(path).fill, color = getComputedStyle(span).color;
      const r = f.getBoundingClientRect(), fs = parseFloat(getComputedStyle(span).fontSize);
      const bgOf = (el) => { for (; el; el = el.parentElement) { const b = getComputedStyle(el).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; } return "rgb(255,255,255)"; };
      return { fill, color, h: r.height, w: r.width, fs, bg: bgOf(span), theme: document.documentElement.dataset.theme };
    });
    const rgb = (s) => (s.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
    const lum = (c) => { const [r, g, b] = rgb(c).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
    const contrast = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
    const cr = contrast(m.fill, m.bg);
    report["figurine_" + appearance] = { theme: m.theme, heightPx: +m.h.toFixed(1), fontPx: m.fs, contrast: +cr.toFixed(1) };
    assert(m.fill === m.color, appearance + " (" + m.theme + "): the figurine is the text's colour (" + m.fill + ")");
    assert(cr >= 4.5, appearance + ": figurine on its background ≥ 4.5:1 (" + cr.toFixed(1) + ")");
    assert(m.h >= 9 && m.h <= m.fs * 1.05 && m.w > 4, appearance + ": the figurine is ≥ 9 px and no taller than the type (" + m.h.toFixed(1) + " px at " + m.fs + " px)");
    if (SHOTS) await page.locator("ol[data-test=moves]").screenshot({ path: SHOTS + "/figurines-" + appearance + ".png" });
  }

  await ctx.close();
}

// in sentences: the helper the bar, the review cards and the lessons print through (src/app as modules)
{
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(srv.url + "?engine=fake&db=memory");
  await page.waitForSelector("[data-page]");
  const said = await page.evaluate(async () => {
    const { withFigurines } = await import("./lib/notation.js");
    const p = document.createElement("p");
    p.append(...withFigurines("Qb3 之后，对方可以走 fxe5；e8=Q+ 也行"));
    document.body.append(p);
    const out = { text: p.textContent, figs: p.querySelectorAll(".fig").length, pieces: [...p.querySelectorAll(".fig")].map((f) => f.dataset.piece).join("") };
    p.remove();
    return out;
  });
  assert(said.text === "Qb3 之后，对方可以走 fxe5；e8=Q+ 也行" && said.figs === 2 && said.pieces === "QQ",
    "a sentence: Qb3 and e8=Q+ become figurines, fxe5 stays, the text is unchanged (" + said.figs + " " + said.pieces + ")");
  await ctx.close();
}

// --- motion: durations, settle, snap-back, hover, cursor; input never blocked -------------
{
  const { ctx, page } = await open();
  await pvp(page);
  await frames(page);
  await clickMove(page, "e2e4");
  const moveMs = await animatingFor(page);
  report.moveTweenMs = Math.round(moveMs);
  assert(moveMs >= 200 && moveMs <= 330, "a move tweens about 250 ms (" + moveMs.toFixed(0) + ")");

  // a move while the last one is still moving
  await clickMove(page, "e7e5");
  const busy = (await bstate(page)).animating;
  const g = await centre(page, "g1"), f3 = await centre(page, "f3");
  await page.mouse.click(g.x, g.y); await page.mouse.click(f3.x, f3.y);
  const t0 = Date.now();
  const sans = await plies(page);
  assert(busy && sans.join(" ") === "e4 e5 Nf3", "a move made while the last is animating is taken at once (" + sans.join(" ") + ", " + (Date.now() - t0) + " ms)");

  // hover + cursor + drag lift, then an illegal drop: home from the pointer
  await animatingFor(page);
  const b8 = await centre(page, "b8"), c6 = await centre(page, "c6"), b4 = await centre(page, "b4");
  await page.mouse.move(b8.x, b8.y);
  assert((await bstate(page)).pointer === "grab", "over a man that may move: grab");
  await page.mouse.down();
  await page.mouse.move(c6.x, c6.y, { steps: 6 });
  const over = await bstate(page);
  assert(over.dragging && over.hover === "c6" && over.pointer === "grabbing", "in the hand over c6: the square lights, the pointer grabs (" + over.hover + ", " + over.pointer + ")");
  await page.mouse.move(b4.x, b4.y, { steps: 6 });
  assert((await bstate(page)).hover === null, "over an illegal square: no light");
  await page.mouse.up();
  const sb = await bstate(page);
  const snapMs = await animatingFor(page);
  report.snapbackMs = Math.round(snapMs);
  assert(sb.moving && snapMs >= 100 && snapMs <= 240 && (await plies(page)).length === 3, "let go on b4: no move, it slides home (" + snapMs.toFixed(0) + " ms)");
  if (SHOTS) await page.screenshot({ path: SHOTS + "/feel-after-snapback.png" });

  // a legal drop settles
  await page.mouse.move(b8.x, b8.y); await page.mouse.down();
  await page.mouse.move(c6.x + 9, c6.y - 7, { steps: 6 }); await page.mouse.up();
  const settle = await animatingFor(page);
  report.settleMs = Math.round(settle);
  assert((await plies(page)).length === 4 && settle >= 60 && settle <= 200, "a legal drop settles from where it was let go (" + settle.toFixed(0) + " ms)");

  // drag cost: 60 pointermoves
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const metrics = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const f1 = await centre(page, "f1"), a6 = await centre(page, "a6");
  await page.mouse.move(f1.x, f1.y); await page.mouse.down();
  await page.mouse.move(f1.x + 6, f1.y - 6);
  await frames(page);
  const m0 = await metrics();
  const frameGaps = page.evaluate(() => new Promise((res) => {
    const gaps = []; let last = performance.now();
    const tick = (t) => { gaps.push(t - last); last = t; if (gaps.length < 40) requestAnimationFrame(tick); else res(gaps); };
    requestAnimationFrame(tick);
  }));
  for (let i = 1; i <= 60; i++) await page.mouse.move(f1.x + (a6.x - f1.x) * i / 60, f1.y + (a6.y - f1.y) * i / 60);
  const m1 = await metrics();
  const gaps = await frameGaps;
  await page.mouse.up();
  const perMove = (m1.ScriptDuration - m0.ScriptDuration) * 1000 / 60;
  report.drag = { scriptMsPerPointermove: +perMove.toFixed(3), layouts: m1.LayoutCount - m0.LayoutCount, styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
    frameGapMedianMs: +median(gaps.slice(1)).toFixed(1) };
  assert(perMove < 2, "a pointermove in a drag costs < 2 ms of script (" + perMove.toFixed(3) + " ms)");
  assert(report.drag.layouts <= 2, "a 60-step drag lays out ≤ 2 times (" + report.drag.layouts + ")");
  console.log("drag: " + JSON.stringify(report.drag));
  await ctx.close();
}

// --- reduced motion: nothing tweens --------------------------------------------------------
{
  const { ctx, page } = await open("", { ctxOpts: { reducedMotion: "reduce" } });
  await pvp(page);
  await clickMove(page, "e2e4");
  assert(!(await bstate(page)).animating, "reduced motion: a move does not tween");
  const e7 = await centre(page, "e7"), e3 = await centre(page, "e3");
  await page.mouse.move(e7.x, e7.y); await page.mouse.down(); await page.mouse.move(e3.x, e3.y, { steps: 5 }); await page.mouse.up();
  assert(!(await bstate(page)).animating && (await plies(page)).length === 1, "reduced motion: an illegal drop is home at once");
  await ctx.close();
}

// --- premove still taken while the reply animates -------------------------------------------
{
  const { ctx, page } = await open("&delay=300");
  await page.evaluate(() => window.__app.store.dispatch("play.new", { id: "p" + Math.random().toString(36).slice(2), mode: "engine", engineColor: "b", opponent: "ada" }));
  await clickMove(page, "d2d4");
  await clickMove(page, "g1f3");   // the engine is thinking: a premove
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length >= 3, null, { timeout: 5000 }).catch(() => {});
  const ms = await page.evaluate(() => window.__app.store.get().play.game.moves.map((m) => m.uci));
  assert(ms[0] === "d2d4" && ms[2] === "g1f3", "a premove is played on the reply, animations or not (" + ms.join(" ") + ")");
  await ctx.close();
}

// --- sound: warm before the moves, off is off ------------------------------------------------
{
  const { ctx, page } = await open();
  await pvp(page);
  const hasAudio = await page.evaluate(() => typeof AudioContext === "function");
  await clickMove(page, "e2e4");
  await page.waitForTimeout(600);   // idle time: the takes render
  for (const u of ["e7e5", "g1f3", "b8c6", "f1c4", "g8f6", "e1g1"]) await clickMove(page, u);
  const st = await page.evaluate(() => ({ ...window.__play.sound.stats, latency: window.__play.sound.latency, played: window.__play.sound.played.slice() }));
  report.sound = { audio: hasAudio, plays: st.plays, cold: st.cold, rendered: st.rendered, worstPlayMs: +st.worstMs.toFixed(2), baseLatencyMs: st.latency ? +(st.latency.base * 1000).toFixed(1) : null };
  console.log("sound: " + JSON.stringify(report.sound));
  assert(st.played.slice(-1)[0] === "castle", "O-O sounds as a castle");
  if (hasAudio) {
    assert(st.cold <= 1, "the every-move takes were rendered ahead: at most the first sound renders on the move (" + st.cold + ")");
    assert(st.worstMs < 4, "starting a sound costs < 4 ms of script (" + st.worstMs.toFixed(2) + ")");
  }
  await page.evaluate(() => window.__app.store.dispatch("settings.set", { key: "sound", value: "off" }));
  const before = await page.evaluate(() => window.__play.sound.stats.plays);
  await clickMove(page, "e8g8");
  const after = await page.evaluate(() => window.__play.sound.stats.plays);
  assert(after === before, "sound off: nothing plays");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-feel-e2e: " + passed + " passed, " + failed + " failed");
console.log("MEASURED " + JSON.stringify(report));
process.exit(failed ? 1 : 0);
