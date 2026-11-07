/**
 * Browser checks for 学 and 我 (v20-0-plan §2 L, §6 S1/S2), Chromium, the
 * app served as ES modules (scripts/serve-app.mjs), the fake engine:
 *
 *   beginner   没下过 → the first lesson (车怎么走) on the board; the mini-game
 *              played square by square to the end; it chains to the next;
 *              the skill map one tap away, the current skill marked
 *   placement  常下棋 → six puzzles solved on the board; ≥ 1200 placed; the
 *              next 40 items never a lesson of a lit skill; no item from a
 *              skill not reached
 *   caps       six findings in one game → ≤ 3 review cards; twenty answers
 *              in a day → ≤ 15 new cards
 *   你这一步   lessons, endgames, classics, openings: the feedback says a fact
 *              about the move just played (v20-0-plan §4 F1), not the task again
 *   我         one rating on screen (no other rating-like number outside
 *              the stage goal and the games list), the curve, the stage,
 *              the weekly line from the events
 *
 *   node scripts/test-learn-e2e.mjs      (E2E_REQUIRED=1: a missing browser fails)
 *   SHOTS=dir  also saves screenshots there
 */
import fs from "fs";
import path from "path";
import { startServer } from "./serve-app.mjs";
import { launchBrowser } from "./app/browser.mjs";

process.removeAllListeners("warning");
const MG = await import("../src/app/learn/minigame.js");
const { Chess } = await import("../src/app/core/chess.js");

let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const SHOTS = process.env.SHOTS || "";
if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: path.join(SHOTS, name + ".png") }); };

const srv = await startServer();
const browser = await launchBrowser();
const errors = [];

async function open(hash, { query = "?engine=fake&db=memory&chain=60", size = { width: 1280, height: 860 } } = {}) {
  const ctx = await browser.newContext({ viewport: size, reducedMotion: "reduce" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(srv.url + query + hash);
  await page.waitForSelector("[data-page]");
  return { ctx, page };
}
const item = (page) => page.evaluate(() => window.__learn && window.__learn.item && JSON.parse(JSON.stringify(window.__learn.item)));
async function click(page, sq) {
  const p = await page.evaluate((sq) => window.__learn.square(sq), sq);
  await page.mouse.click(p.x, p.y);
}
async function playUci(page, uci) { await click(page, uci.slice(0, 2)); await click(page, uci.slice(2, 4)); }
const waitItem = (page, notId) => page.waitForFunction((id) => window.__learn && window.__learn.item && window.__learn.item.id !== id, notId, { timeout: 8000 });

/** Play an item to its end through the board, the right way. */
async function solve(page, it) {
  if (it.kind === "lesson") { await page.click("[data-test=act-start]"); return; }
  if (it.kind === "stars") { for (const u of MG.solve(it.fen, it.targets, it.only).path) await playUci(page, u); return; }
  if (it.kind === "move") {
    const m = new Chess(it.fen).move(it.answer);
    await playUci(page, m.from + m.to);
    return;
  }
  if (it.kind === "line") {
    const g = new Chess(it.fen);
    for (let k = 0; k < it.line.length; k++) {
      const before = g.fen().split(" ")[0];
      const m = g.move(it.line[k]);
      if (m.color !== it.side) continue;
      // the board offers our side this position (the reply before it has been played)
      await page.waitForFunction((b) => { const s = window.__learn.board(); return s.movable !== "none" && s.fen.split(" ")[0] === b; }, before, { timeout: 5000 });
      await playUci(page, m.from + m.to);
    }
    return;
  }
  await page.evaluate(() => window.__learn.answer(true));
}

// --- beginner --------------------------------------------------------------------------
{
  const { ctx, page } = await open("#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await shot(page, "01-placement");
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn.item);
  let it = await item(page);
  assert(it.kind === "lesson" && it.skill === "rook", "没下过 → the first thing is the rook's lesson (" + it.id + ")");
  assert((await page.textContent("[data-test=skill-name]")).includes("车"), "the side names the skill");
  await shot(page, "02-first-lesson");
  await page.click("[data-test=act-start]");
  await waitItem(page, it.id);
  it = await item(page);
  assert(it.kind === "stars" && it.skill === "rook", "it chains to a rook mini-game (" + it.id + ")");
  await shot(page, "03-mini-game");
  await solve(page, it);
  await page.waitForFunction(() => document.querySelector("[data-test=learn-bar-box]").dataset.tone === "good");
  assert(true, "the mini-game played square by square ends good");
  await waitItem(page, it.id);
  const it2 = await item(page);
  assert(it2.id !== it.id && it2.skill === "rook", "and chains on by itself (" + it2.id + ")");
  // one tap to the map
  await page.click("[data-test=open-map]");
  await page.waitForSelector("[data-test=skill-map]:not([hidden])");
  const now = await page.$eval("[data-skill=rook]", (b) => b.dataset.state);
  const locked = await page.$eval("[data-skill=fork]", (b) => b.dataset.state);
  assert(now === "now" && locked === "locked", "the map marks where you are (" + now + ") and what is locked (" + locked + ")");
  await page.click("[data-skill=bishop]");
  assert(await page.$eval("[data-test=practice-skill]", (b) => b.disabled), "a skill not reached cannot be practised yet");
  await shot(page, "04-skill-map");
  await page.click("[data-test=open-map]");
  await page.waitForSelector("[data-test=skill-map]", { state: "hidden" });
  // a few more, played through: nothing served needs a skill not reached
  let bad = [];
  for (let i = 0; i < 12; i++) {
    const x = await item(page);
    const check = await page.evaluate((x) => {
      const m = window.__learn.model;
      const lit = (id) => window.__learn.lit(id);
      return (x.needs || []).filter((n) => n !== x.skill && !lit(n));
    }, x);
    if (check.length) bad.push(x.id + ":" + check.join(","));
    await solve(page, x);
    await waitItem(page, x.id);
  }
  assert(bad.length === 0, "twelve more items played on the board, none needing a skill not lit " + bad.join(" "));
  await ctx.close();
}

// --- placement ≥ 1200 ----------------------------------------------------------------------
{
  const { ctx, page } = await open("#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.click("[data-test=place-often]");
  for (let k = 0; k < 6; k++) {
    await page.waitForFunction((k) => window.__learn.item && window.__learn.why === "place" && document.querySelector("[data-test=why]").textContent.includes(String(k + 1)), k);
    const it = await item(page);
    if (k === 0) await shot(page, "05-placement-puzzle");
    await solve(page, it);
    if (k < 5) await waitItem(page, it.id);
  }
  await page.waitForFunction(() => window.__learn.model && window.__learn.model.placed);
  const rating = await page.evaluate(() => window.__learn.rating());
  assert(rating >= 1200, "six right answers place ≥ 1200 (" + rating + ")");
  await page.waitForFunction(() => window.__learn.why !== "place");
  const wrong = [];
  const kinds = {};
  for (let i = 0; i < 40; i++) {
    const it = await item(page);
    kinds[it.kind] = (kinds[it.kind] || 0) + 1;
    const lit = it.skill ? await page.evaluate((id) => window.__learn.lit(id), it.skill) : false;
    if (it.kind === "lesson" && lit) wrong.push(it.id);
    await page.evaluate(() => window.__learn.answer(true));
    if (i === 3) await shot(page, "06-after-placement");
    await page.waitForFunction((id) => window.__learn.item && window.__learn.item.id !== id, it.id, { timeout: 6000 }).catch(() => page.evaluate(() => window.__learn.next()));
  }
  assert(wrong.length === 0, "40 items after placing ≥ 1200: no lesson of a lit skill " + JSON.stringify(kinds) + (wrong.length ? " — " + wrong.join(" ") : ""));
  await ctx.close();
}

// --- 你这一步 (v20-0-plan §4 F1): the feedback states a fact about the move just played ----------
{
  const { ctx, page } = await open("#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn.item);
  const barText = () => page.textContent("[data-test=learn-bar]");
  const startItem = async (id) => {
    await page.evaluate((id) => window.__learn.start(id), id);
    await page.waitForFunction((id) => window.__learn.item && window.__learn.item.id === id && window.__learn.board().movable !== "none", id);
    return item(page);
  };
  const waitBar = (re) => page.waitForFunction((src) => new RegExp(src).test(document.querySelector("[data-test=learn-bar]").textContent), re.source, { timeout: 6000 })
    .then(() => true, () => false);

  // a lesson: 7k/Q7/6K1 — mate with the queen; Qf7 is not mate, it is stalemate, and the bar says so of Qf7
  let it = await startItem("ls:goal:0");
  await playUci(page, "a7f7");
  assert(await waitBar(/Qf7 之后对方没有被将军，却一步也走不了/), "lesson: a wrong move is explained as what it did (" + await barText() + ")");
  const txt = await barText();
  assert(!txt.includes(it.prompt) && !(it.retry && txt.includes(it.retry)), "…not the task said again");
  await shot(page, "09-lesson-why");

  // an endgame: only Kg3 wins; Kh3 gives up the opposition and the drill stops on that move
  it = await startItem("dr:kp-distant");
  await playUci(page, "h2h3");
  assert(await waitBar(/你让出了对王：Kh3 之后只能和棋/), "endgame: it stops at once, saying what Kh3 gave away (" + await barText() + ")");
  assert(await page.evaluate(() => window.__learn.board().movable === "none"), "…and the drill is over");
  await shot(page, "10-endgame-why");

  // a classic: Morphy at the opera, 7.Qb3; guessing Nc3 is told what Nc3 does, then the master's move what it does
  it = await startItem("cl:morphy-opera-1858:12");
  await playUci(page, "b1c3");
  assert(await waitBar(/Nc3 出动了马.*大师走的不是这步/), "classic: the wrong guess is told what it does (" + await barText() + ")");
  await page.waitForFunction(() => window.__learn.board().fen.startsWith("rn1qkb1r/ppp2ppp/5n2/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R"));
  await page.waitForFunction(() => window.__learn.board().movable !== "none");
  await playUci(page, "f3b3");
  assert(await waitBar(/Qb3 同时攻击 b7 和 f7，和大师想的一样/), "classic: the master's move, guessed, is told its intent (" + await barText() + ")");
  await shot(page, "11-classic-why");

  // an opening: the Italian; 1.d4 is off this book, and the bar names the book move and the move played
  it = await startItem("op:italian-game");
  await playUci(page, "d2d4");
  assert(await waitBar(/d4 离开了你的开局书，常见的是 e4/), "opening: the move is said to leave the book, the common one named (" + await barText() + ")");
  await shot(page, "12-opening-why");
  await ctx.close();
}

// --- caps, through the db --------------------------------------------------------------------
{
  const { ctx, page } = await open("#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn.item);
  const r = await page.evaluate(async () => {
    const db = await window.__app.ready;
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    for (let k = 0; k < 6; k++) db.append({ type: "review.finding", gameId: "game-a", ply: 6 + k, motif: "fork", fen, best: "f3f7", san: "Nc3" });
    const { ITEMS } = await import("/src/app/content/practice.js");
    const ids = Object.keys(ITEMS).filter((id) => ITEMS[id].kind === "line").slice(0, 20);
    for (const id of ids) db.append({ type: "learn.answer", item: id, skill: ITEMS[id].skill, kind: "line", ok: true, tries: 1 });
    await db.flush();
    window.__learn.next();
    await new Promise((res) => setTimeout(res, 300));
    const { learnerFor } = await import("/src/app/learn/service.js");
    const L = learnerFor(db);
    await L.refresh();
    const cards = Object.keys(L.model.cards);
    return { fromGame: cards.filter((c) => c.startsWith("rv:game-a:")).length, all: cards.length };
  });
  assert(r.fromGame <= 3, "six findings in one game make ≤ 3 review cards (" + r.fromGame + ")");
  assert(r.all <= 15, "and the day's new cards stay ≤ 15 (" + r.all + ")");
  await ctx.close();
}

// --- 我: one rating, the curve, the stage, the week ---------------------------------------------
{
  const { ctx, page } = await open("#/learn");
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.evaluate(async () => {
    const db = await window.__app.ready;
    const day = 86400000, now = Date.now();
    db.append({ type: "learn.place", rating: 1000, how: "knows", at: now - 15 * day });
    for (let i = 0; i < 5; i++) db.append({ type: "review.finding", gameId: "w" + i, ply: 3, motif: "fork", at: now - 10 * day + i });
    db.append({ type: "review.finding", gameId: "x", ply: 3, motif: "fork", at: now - day });
    await db.flush();
  });
  await page.click('a[href="#/me"]');
  await page.waitForSelector("[data-test=rating]");
  const shown = await page.evaluate(() => {
    const skip = (n) => n.closest && n.closest("[data-test=stage-goal], [data-test=games], [data-test=week]");
    const out = [];
    const walk = (n) => {
      if (n.nodeType === 3) { if (!skip(n.parentElement)) for (const m of n.textContent.matchAll(/\b\d{3,4}\b/g)) out.push(+m[0]); return; }
      if (n.nodeType === 1 && (n.hidden || getComputedStyle(n).display === "none")) return;
      for (const c of n.childNodes) walk(c);
    };
    walk(document.querySelector("#app"));
    return { nums: out, rating: document.querySelectorAll("[data-test=rating]").length };
  });
  assert(shown.rating === 1 && shown.nums.length === 1, "我 shows one rating and no other rating-like number (" + JSON.stringify(shown) + ")");
  const week = await page.textContent("[data-test=week]");
  assert(/上周你漏看捉双 5 次，本周 1 次/.test(week), "the weekly line from the events: " + week);
  assert(await page.$("[data-test=curve] polyline"), "the growth curve");
  assert((await page.textContent("[data-test=stage-goal]")).includes("1200"), "the next stage: 1200");
  assert(await page.$eval("[data-test=import-pgn]", (b) => !b.disabled) && await page.$("[data-test=lib-count]"), "我 has the library and its 导入 PGN (scripts/test-import-e2e.mjs drives it)");
  await shot(page, "07-me");
  // and the learn page: still one rating at most (none while learning)
  await page.click('a[href="#/learn"]');
  await page.waitForFunction(() => window.__learn && window.__learn.item);
  const nums = await page.evaluate(() => [...document.querySelector("[data-page=learn]").innerText.matchAll(/\b\d{3,4}\b/g)].map((m) => +m[0]));
  assert(nums.length <= 1, "学 shows no second rating (" + nums.join(",") + ")");
  await ctx.close();
}

// --- narrow window -------------------------------------------------------------------------------
{
  const { ctx, page } = await open("#/learn", { size: { width: 600, height: 900 } });
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn.item);
  const fits = await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1);
  assert(fits, "600 px wide: no sideways scroll");
  await shot(page, "08-narrow");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-learn-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
