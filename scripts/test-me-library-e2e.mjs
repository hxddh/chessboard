/**
 * 我's library, and the follow-ups around it — Chromium, the fake engine:
 *
 *   list        imported and played games in one list; search by name, filter
 *               by result and year, pages of 30 for 76 games
 *   a game      a row opens #/me/game/<id>: the board, the move drawer, ← / →,
 *               back to the list; 复盘这盘 runs the review on the board (cards)
 *   这是你吗     a file whose names do not say which one is yours: the most
 *               frequent names offered; choosing one is a library.you event,
 *               the rows learn their side and 你的水平 moves; 都不是 too
 *   background  your imported games are reviewed while you are not playing:
 *               nothing while 下 is on screen, then the day's five, newest
 *               first, with findings that become review cards in 学
 *   学          the next game names its opponent (zh / en / ja); the boards make
 *               sound, and none with the sound off
 *   设置         every piece set has a label, never a raw id
 *
 *   node scripts/test-me-library-e2e.mjs [--dev]   (E2E_REQUIRED=1: a missing browser fails)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const DEV = process.argv.includes("--dev");
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchChromium();
const errors = [];
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "me-library-e2e-"));
const file = (name, text) => { const p = path.join(TMP, name); fs.writeFileSync(p, text); return p; };

// Blackburne–Shilling: White (you) takes the bait and is mated — mistakes for the review to find
const TRAP = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#";
const SHORT = "1. d4 d5 2. c4 e6";
const game = ({ white = "Me", black, result, date, moves = TRAP, elo = 1000, event = "Club" }) =>
  `[Event "${event}"]\n[Date "${date}"]\n[White "${white}"]\n[Black "${black}"]\n[BlackElo "${elo}"]\n[Result "${result}"]\n\n${moves} ${result}\n`;

async function open(hash = "#/me", { query = "", locale } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 }, ...(locale ? { locale } : {}) });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?engine=fake&db=memory&chain=60" + query + hash);
  await page.waitForSelector("[data-page]");
  return { ctx, page };
}
async function pick(page, p) {
  await page.waitForSelector("[data-test=import-pgn]");
  await page.$eval("[data-test=import-status]", (e) => { e.dataset.state = ""; });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-test=import-pgn]")]);
  await chooser.setFiles(p);
  await page.waitForFunction(() => /done|error/.test(document.querySelector("[data-test=import-status]").dataset.state || ""), null, { timeout: 60000 });
  await page.waitForTimeout(150);
}
const events = (page, type) => page.evaluate(async (type) => (await (await window.__app.ready).query("events.since", { after: 0, limit: 100000 })).filter((e) => e.type === type), type);
const libRows = (page) => page.evaluate(async () => (await window.__app.ready).query("library.all"));
const rows = (page) => page.$$eval("[data-test=lib-row]", (bs) => bs.map((b) => ({ id: b.dataset.gameId, text: b.textContent, outcome: b.dataset.outcome })));
const settle = (page) => page.waitForTimeout(250);
/** Poll an async check in the page until it holds (waitForFunction takes a promise for an answer). */
async function until(page, fn, arg, timeout = 30000) {
  const t0 = Date.now();
  for (;;) {
    if (await page.evaluate(fn, arg)) return true;
    if (Date.now() - t0 > timeout) return false;
    await page.waitForTimeout(100);
  }
}

// --- the list: 75 imported and one played; search, result, year, pages ------------------------------
{
  const { ctx, page } = await open("#/play", { query: "&autoreview=0" });
  await page.waitForFunction(() => window.__app.store.get().play.game);
  // one game played here and finished: you resign against the default opponent
  await page.evaluate(() => window.__app.store.dispatch("play.resign", { color: "w", now: Date.now() }));
  await page.click('a[href="#/me"]');
  const many = Array.from({ length: 75 }, (_, i) => game({ black: i % 3 ? "Rival" + (i % 7) : "Nemesis", result: ["1-0", "0-1", "1/2-1/2"][i % 3],
    date: (2019 + (i % 5)) + "." + String(1 + (i % 12)).padStart(2, "0") + ".10", moves: i % 2 ? TRAP : SHORT, event: "Club " + i }));
  await pick(page, file("many.pgn", many.join("\n")));
  let r = await rows(page);
  assert(r.length === 30, "a page of 30 rows, not 76 (" + r.length + ")");
  assert(/76/.test(await page.textContent("[data-test=lib-total]")) && /1 \/ 3/.test(await page.textContent("[data-test=lib-page]")), "76 games in three pages: " + await page.textContent("[data-test=lib-page]"));
  assert(/在这里下的/.test(r[0].text) && r[0].outcome === "loss", "the game played here is first (newest), a loss: " + r[0].text);
  await page.click("[data-test=lib-next]"); await page.click("[data-test=lib-next]");
  assert((await rows(page)).length === 16 && await page.$eval("[data-test=lib-next]", (b) => b.disabled), "the last page has the other 16");
  await page.fill("[data-test=lib-search]", "nemesis");
  await settle(page);
  r = await rows(page);
  assert(r.length === 25 && r.every((x) => /Nemesis/.test(x.text)), "search by the opponent's name, back on page 1 (" + r.length + ")");
  await page.selectOption("[data-test=lib-result]", "win");
  r = await rows(page);
  assert(r.length === 25 && r.every((x) => x.outcome === "win"), "and by result: Nemesis lost every one (" + r.length + ")");
  await page.selectOption("[data-test=lib-result]", "draw");
  assert((await rows(page)).length === 0 && await page.$("[data-test=lib-none]"), "no draws with Nemesis: it says nothing matches");
  await page.fill("[data-test=lib-search]", "");
  await page.selectOption("[data-test=lib-result]", "all");
  await settle(page);
  const years = await page.$$eval("[data-test=lib-year] option", (os) => os.map((o) => o.value));
  assert(years[0] === "all" && years.slice(1).every((y, i, a) => !i || Number(a[i - 1]) > Number(y)) && years.includes("2019") && years.includes("2023"), "the years, newest first: " + years.join(","));
  await page.selectOption("[data-test=lib-year]", "2021");
  r = await rows(page);
  assert(r.length === 15 && r.every((x) => /2021/.test(x.text)), "by year (" + r.length + ")");

  // --- a game on the board -------------------------------------------------------------------------
  const id = (await libRows(page)).find((g) => g.event === "Club 1").id;
  await page.fill("[data-test=lib-search]", "rival1");
  await page.selectOption("[data-test=lib-year]", "2020");
  await settle(page);
  await page.click(`[data-test=lib-row][data-game-id="${id}"]`);
  await page.waitForSelector("[data-test=lib-game] [data-test=game-board] canvas");
  await page.waitForFunction(() => window.__libGame && window.__libGame.info);
  assert(decodeURIComponent(await page.evaluate(() => location.hash)) === "#/me/game/" + id, "the row opens #/me/game/<id>");
  assert(await page.$eval("[data-test=me]", (e) => e.hidden) && /Me 对 Rival1/.test(await page.textContent("[data-test=game-title]")), "the game in place of the list: " + await page.textContent("[data-test=game-title]"));
  const moves = await page.$$eval("[data-test=lib-game] [data-test=moves] li", (ls) => ls.map((l) => l.textContent));
  assert(moves.length === 14 && moves[13].includes("Nf3#") && await page.$("[data-test=lib-game] [data-test=moves] .fig"), "the move drawer, in figurines (" + moves.length + " moves)");
  assert(await page.evaluate(() => window.__libGame.at) === 14 && /14 \/ 14/.test(await page.textContent("[data-test=game-bar]")), "it opens on the final position");
  await page.keyboard.press("ArrowLeft"); await page.keyboard.press("ArrowLeft");
  const back2 = await page.evaluate(() => ({ at: window.__libGame.at, fen: window.__libGame.board.state().fen, focus: document.activeElement && document.activeElement.outerHTML.slice(0, 60) }));
  assert(back2.at === 12 && back2.fen.startsWith("r1b1kbnr/pppp1Npp/8/8/2Bnq3/8/PPPP1P1P/RNBQKR2 w"), "← steps back on the board (" + JSON.stringify(back2) + ")");
  await page.keyboard.press("ArrowRight"); await page.keyboard.press("ArrowRight");
  const fwd = await page.evaluate(() => ({ at: window.__libGame.at, played: window.__libGame.sound.played.slice(-2) }));
  assert(fwd.at === 14 && fwd.played.join(" ") === "move check", "→ steps forward, each move heard (Be2, Nf3#: " + fwd.played.join(" ") + ")");
  await page.click("[data-test=lib-game] [data-test=moves] li[data-ply='0'] .san");
  assert(await page.evaluate(() => window.__libGame.at) === 1, "a move in the drawer shows its position");
  await page.keyboard.press("Home");
  assert(/起始局面/.test(await page.textContent("[data-test=game-bar]")), "Home: the start");

  // 复盘这盘
  await page.click("[data-test=game-review]");
  await page.waitForFunction(() => ["card", "done", "empty", "failed"].includes(document.querySelector("[data-test=game-bar-box]").dataset.phase), null, { timeout: 30000 });
  const phase = await page.$eval("[data-test=game-bar-box]", (e) => e.dataset.phase);
  assert(phase === "card", "复盘这盘: the review's first card on the board (" + phase + ": " + await page.textContent("[data-test=game-bar]") + ")");
  if (phase === "card") {
    const before = await page.textContent("[data-test=game-bar]");
    await page.click("[data-test=rv-answer]");
    const arrows = await page.evaluate(() => (window.__libGame.board.state().arrows || []).length);
    assert(arrows >= 1 && (await page.textContent("[data-test=game-bar]")) !== before, "看答案: the better move as an arrow, and why");
  }
  await until(page, async (id) => (await (await window.__app.ready).query("events.since", { after: 0, limit: 100000 })).some((e) => e.type === "review.analysis" && e.gameId === id), id);
  assert((await events(page, "review.finding")).some((e) => e.gameId === id && e.side === "w"), "the review is stored and its findings (your moves: White) go to the learner model");
  await page.click("[data-test=game-back]");
  await page.waitForSelector("[data-test=me]:not([hidden])");
  assert(!(await page.$("[data-test=lib-game]")) && (await page.evaluate(() => location.hash)) === "#/me", "back: the list again");
  await settle(page);
  assert((await rows(page)).some((x) => x.id === id && /已复盘/.test(x.text)), "the game shows as reviewed");

  // the game played here opens too
  const played = (await page.evaluate(async () => (await (await window.__app.ready).query("games.all")).find((g) => g.result))).id;
  await page.fill("[data-test=lib-search]", "");
  await page.selectOption("[data-test=lib-year]", "all");
  await settle(page);
  await page.click(`[data-test=lib-row][data-game-id="${played}"]`);
  await page.waitForFunction(() => window.__libGame && window.__libGame.info);
  assert(/你/.test(await page.textContent("[data-test=game-title]")) && /负/.test(await page.textContent("[data-test=game-meta]")), "a game played here: you, and the loss (" + await page.textContent("[data-test=game-title]") + " · " + await page.textContent("[data-test=game-meta]") + ")");
  await page.evaluate(() => window.__app.router.go("/me/game/nothing-here"));
  await page.waitForFunction(() => window.__libGame && window.__libGame.info === false);
  assert(/棋谱库里没有这盘棋/.test(await page.textContent("[data-test=game-bar]")), "an id that is not there says so");
  await ctx.close();
}

// --- 这是你吗 --------------------------------------------------------------------------------------------
{
  const { ctx, page } = await open("#/me", { query: "&autoreview=0" });
  await page.waitForSelector("[data-test=rating]");
  const r0 = await page.$eval("[data-test=rating]", (e) => Number(e.dataset.rating));
  // a club's games: "Ann" in 4 of 10, the others once or twice — no name in half of them
  const names = [["Ann", "Bob"], ["Cid", "Ann"], ["Ann", "Dee"], ["Eve", "Ann"], ["Bob", "Cid"], ["Dee", "Eve"], ["Fay", "Gus"], ["Gus", "Hal"], ["Hal", "Fay"], ["Ivy", "Bob"]];
  const club = (m) => names.map(([w, b], i) => `[White "${w}"]\n[Black "${b}"]\n[WhiteElo "${1100 + i * 10}"]\n[BlackElo "${1200 + i * 10}"]\n[Result "${i % 2 ? "0-1" : "1-0"}"]\n\n1. e4 e5 2. Nf3 ${m} ${i % 2 ? "0-1" : "1-0"}\n`).join("\n");
  await pick(page, file("club.pgn", club("Nc6")));
  await page.waitForSelector("[data-test=you-ask]:not([hidden])");
  const offered = await page.$$eval("[data-test=you-name]", (bs) => bs.map((b) => b.dataset.name + ":" + b.textContent));
  assert(offered.length >= 2 && offered.length <= 4 && offered[0].startsWith("Ann:") && /4 局/.test(offered[0]), "这是你吗: the most frequent names, Ann first with her count (" + offered.join(" | ") + ")");
  await page.click('[data-test=you-name][data-name="Ann"]');
  await page.waitForSelector("[data-test=you-ask][hidden]", { state: "attached" });
  const ev = await events(page, "library.you");
  assert(ev.length === 1 && ev[0].name === "Ann" && ev[0].games.length === 4, "the choice is an event, with the four games it makes yours");
  const mine = (await libRows(page)).filter((g) => g.you);
  assert(mine.length === 4 && mine.every((g) => (g.you === "w" ? g.white : g.black) === "Ann" && Number.isFinite(g.opp)), "the rows learn their side and the opponent's rating");
  await page.waitForFunction((r0) => Number(document.querySelector("[data-test=rating]").dataset.rating) !== r0, r0, { timeout: 5000 }).catch(() => {});
  const r1 = await page.$eval("[data-test=rating]", (e) => Number(e.dataset.rating));
  assert(r1 !== r0, "the four games re-feed 你的水平 (" + r0 + " → " + r1 + ")");
  assert(/你是「Ann」：4 局/.test(await page.textContent("[data-test=import-status]")), "and it says so: " + await page.textContent("[data-test=import-status]"));
  // 都不是, on the next such file
  await pick(page, file("club2.pgn", club("Nf6")));
  await page.waitForSelector("[data-test=you-ask]:not([hidden])");
  await page.click("[data-test=you-none]");
  await page.waitForSelector("[data-test=you-ask][hidden]", { state: "attached" });
  const ev2 = await events(page, "library.you");
  assert(ev2.length === 2 && ev2[1].name === null && ev2[1].games.length === 0, "都不是: an event too, and nothing changes");
  await ctx.close();
}

// --- the background review -------------------------------------------------------------------------------
{
  const { ctx, page } = await open("#/me", { query: "&autoreviewDelay=1500" });
  const mine = Array.from({ length: 7 }, (_, i) => game({ black: "Foe" + i, result: "0-1", date: "2025.0" + (1 + i) + ".01" }));
  await pick(page, file("mine.pgn", mine.join("\n")));
  // 下 on screen: the engine is the game's
  await page.click('a[href="#/play"]');
  await page.waitForTimeout(3500);
  assert((await events(page, "review.analysis")).length === 0, "nothing reviewed while 下 is on screen");
  assert(await page.evaluate(() => !!(window.__app.background.bg && window.__app.background.bg.status.paused)), "the background review says it is paused");
  await page.click('a[href="#/me"]');
  await until(page, async () => (await (await window.__app.ready).query("events.since", { after: 0, limit: 100000 })).filter((e) => e.type === "review.analysis").length >= 5, null, 60000);
  await page.waitForTimeout(1500);
  const an = await events(page, "review.analysis");
  assert(an.length === 5 && an.every((e) => e.auto), "on 我: five games reviewed (the day's cap), marked auto (" + an.length + ")");
  const done = (await libRows(page)).filter((g) => g.analysed).map((g) => g.date).sort();
  assert(done.join(",") === "2025.03.01,2025.04.01,2025.05.01,2025.06.01,2025.07.01", "the most recent first: " + done.join(","));
  const finds = await events(page, "review.finding");
  assert(finds.length >= 5 && finds.every((f) => f.side === "w" && f.auto && f.fen && f.best), "findings: your own moves, each with its position and the better move (" + finds.length + ")");
  assert((await rows(page)).filter((x) => /已复盘/.test(x.text)).length === 5, "the list shows them as reviewed");
  await page.click('a[href="#/learn"]');
  await page.waitForFunction(() => window.__learn && window.__learn.model && window.__learn.model.lastId > 0);
  const n = await page.evaluate(() => Object.keys(window.__learn.model.cards).filter((k) => k.startsWith("rv:imp:")).length);
  assert(n >= 5 && n <= 15, "they are review cards in 学, ≤ 3 a game (" + n + ")");
  await ctx.close();
}

// --- 学: the next game names its opponent, in each language ----------------------------------------------
for (const [lang, generic] of [["zh", "水平相近"], ["en", "near your level"], ["ja", "近い強さ"]]) {
  const { ctx, page } = await open("#/learn", { query: "&autoreview=0&lang=" + lang });
  await page.waitForFunction(() => window.__learn && window.__learn.model);
  await page.evaluate(() => window.__learn.start("game:800"));
  await page.waitForSelector("[data-test=act-play]");
  const line = await page.textContent("[data-test=learn-bar]");
  assert(!line.includes(generic) && line.length > 4, lang + ": 学's next game names its opponent: " + line);
  await ctx.close();
}

// --- 学: the boards are heard, under the sound setting ----------------------------------------------------
{
  const { ctx, page } = await open("#/learn", { query: "&autoreview=0" });
  await page.waitForSelector("[data-test=place]:not([hidden])");
  await page.click("[data-test=place-new]");
  await page.waitForFunction(() => window.__learn.item);
  const startItem = async (id) => {
    await page.evaluate((id) => window.__learn.start(id), id);
    await page.waitForFunction((id) => window.__learn.item && window.__learn.item.id === id && window.__learn.board().movable !== "none", id);
  };
  const click = async (sq) => { const p = await page.evaluate((sq) => window.__learn.square(sq), sq); await page.mouse.click(p.x, p.y); };
  // 7k/Q7/6K1: Qf7 is not mate (stalemate) — a move, then a wrong answer; Qg7 is
  await startItem("ls:goal:0");
  const plays0 = await page.evaluate(() => window.__learn.sound.stats.plays);
  await click("a7"); await click("f7");
  await page.waitForFunction(() => window.__learn.sound.played.includes("wrong"), null, { timeout: 5000 }).catch(() => {});
  let heard = await page.evaluate(() => ({ played: window.__learn.sound.played.slice(), plays: window.__learn.sound.stats.plays }));
  assert(heard.played.includes("move") && heard.played.includes("wrong") && heard.plays > plays0, "学: a move is heard, and a wrong answer (" + heard.played.join(" ") + ")");
  await page.waitForFunction(() => window.__learn.board().movable !== "none" && window.__learn.board().fen.startsWith("7k/Q7"), null, { timeout: 5000 });
  await click("a7"); await click("g7");
  await page.waitForFunction(() => window.__learn.sound.played.includes("star"), null, { timeout: 5000 }).catch(() => {});
  heard = await page.evaluate(() => window.__learn.sound.played.slice());
  assert(heard.includes("check") && heard.includes("star"), "…a mate (check) and a right answer (" + heard.join(" ") + ")");
  // the sound off: the same moves, nothing played
  await page.evaluate(() => window.__app.store.dispatch("settings.set", { key: "sound", value: "off" }));
  await startItem("ls:goal:0");
  const before = await page.evaluate(() => window.__learn.sound.stats.plays);
  await click("a7"); await click("f7");
  await page.waitForTimeout(600);
  assert(await page.evaluate(() => window.__learn.sound.stats.plays) === before, "with the sound off, 学 is silent");
  await ctx.close();
}

// --- 设置: piece-set labels ------------------------------------------------------------------------------
{
  const { ctx, page } = await open("#/settings", { query: "&autoreview=0" });
  await page.waitForSelector("[data-test=set-pieceSet]");
  const opts = await page.$$eval("[data-test=set-pieceSet] option", (os) => os.map((o) => [o.value, o.textContent]));
  assert(opts.length >= 3 && opts.every(([v, l]) => l && l !== v), "every piece set has a label, not its id: " + opts.map((o) => o.join("=")).join(" "));
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log("\ntest-me-library-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
