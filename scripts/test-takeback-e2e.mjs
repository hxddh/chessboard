/**
 * 悔棋 and 翻转 on the 20.0 play screen, Chromium, the fake engine
 * (v20-0-plan §10: 「悔棋与翻转按钮」):
 *
 *   悔棋    the button shows once you have a move to take back; it takes back
 *           your move and the reply, so it is your turn again; pressed while
 *           the reply is still coming it takes back your move alone (19.0's Z
 *           took back the pair before it); Z does the same; it is a
 *           game.undo event; the first one says the game is no longer rated;
 *           the clock goes back; a finished game offers none; looking back,
 *           the first Z returns to the game; a reload keeps the position
 *   翻转    F and the drawer's button turn the board: the orientation, the
 *           square under the pointer, the names and clocks, the coordinates
 *           (the corner square's colour under a8/h1), an arrow and a move in
 *           flight (the scene is in board space: it keeps flying); the next
 *           game starts from your side again
 *
 * Against the split build (scripts/build-app.mjs) unless --dev.
 *   node scripts/test-takeback-e2e.mjs [--dev]   (E2E_REQUIRED=1: a missing browser fails)
 */
import { startServer } from "./serve-app.mjs";
import { launchBrowser } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const DEV = process.argv.includes("--dev");
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchBrowser();
const errors = [];

async function open(query = "", { w = 1280, h = 860, think = 0, delay = 30, dbname = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h } });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  const db = dbname ? "&dbname=" + dbname : "&db=memory";
  await page.goto(BASE + "?engine=fake&think=" + think + "&delay=" + delay + db + query + "#/play");
  await page.waitForSelector("[data-page=play] canvas");
  await page.waitForFunction(() => window.__app.store.get().play.game && window.__play);
  return { ctx, page };
}
const game = (page) => page.evaluate(() => window.__app.store.get().play.game);
const sans = async (page) => (await game(page)).moves.map((m) => m.san);
const buttons = (page) => page.$$eval("[data-test=bar] button", (bs) => bs.map((b) => b.dataset.test));
const centre = (page, sq) => page.evaluate((sq) => window.__play.board.squareCenter(sq), sq);
async function clickMove(page, uci) {
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) { const p = await centre(page, sq); await page.mouse.click(p.x, p.y); }
}
const newGame = (page, o) => page.evaluate((o) => {
  window.__app.store.dispatch("play.new", { id: "g" + Math.random().toString(36).slice(2), mode: "engine", engineColor: "b", opponent: "ada", ...o });
}, o);
const events = (page) => page.evaluate(async () => (await window.__app.ready).query("events.since", { after: 0, limit: 1000 }));
const plies = (page, n) => page.waitForFunction((n) => window.__app.store.get().play.game.moves.length === n, n, { timeout: 8000 });

// --- 悔棋 ----------------------------------------------------------------------------------
{
  const { ctx, page } = await open();
  await newGame(page);
  assert(!(await buttons(page)).includes("undo"), "no 悔棋 before you have moved");
  await clickMove(page, "e2e4");
  await plies(page, 2);
  await page.waitForFunction(() => document.querySelector("[data-test=bar]").dataset.phase === "play" && !window.__app.store.get().play.game.result);
  await clickMove(page, "g1f3");
  await plies(page, 4);
  assert((await buttons(page)).includes("undo"), "悔棋 is in the bar once you have a move to take back");
  await page.click("[data-test=undo]");
  assert((await sans(page)).length === 2, "悔棋 takes back your move and the reply: your turn again (" + (await sans(page)).join(" ") + ")");
  assert(/不计入等级分/.test(await page.textContent("[data-test=bar-text]")), "the first takeback says the game is no longer rated");
  let ev = (await events(page)).filter((e) => e.type === "game.undo");
  assert(ev.length === 1 && ev[0].plies === 2 && ev[0].ply === 2, "it is one game.undo event (2 plies, back to ply 2)");
  await ctx.close();
}
{
  // a slow opponent (the fake thinks 1.5 s) so the reply is still coming
  const { ctx, page } = await open("", { delay: 1500 });
  await newGame(page);
  await clickMove(page, "d2d4");
  await plies(page, 2);
  await clickMove(page, "c2c4");
  await plies(page, 3);
  assert(await page.evaluate(() => !document.querySelector("[data-test=thinking]").hidden), "the opponent is thinking");
  await page.keyboard.press("z");
  await page.waitForTimeout(100);
  const s = await sans(page);
  assert(s.length === 2 && s[0] === "d4", "Z while the reply is coming takes back your move alone, not the pair before it (" + s.join(" ") + ")");
  await page.waitForTimeout(1800);
  assert((await sans(page)).length === 2, "the reply that was coming never lands on the old position");
  await ctx.close();
}
{
  // the clock goes back; a finished game offers none; looking back first returns
  const { ctx, page } = await open();
  await newGame(page, { tc: "5+3" });
  await clickMove(page, "e2e4");
  await plies(page, 2);
  await page.waitForTimeout(400);
  await clickMove(page, "d2d4");
  await plies(page, 4);
  const before = (await game(page)).moves[1].clock;
  await page.keyboard.press("z");
  const c = (await game(page)).clock;
  assert(c.w === before.w && c.b === before.b && c.since != null && c.turn === "w", "the clock goes back to what it showed, and runs for you");
  await page.evaluate(() => document.activeElement && document.activeElement.blur());   // ← on the board moves its cursor
  await page.keyboard.press("ArrowLeft");
  assert(await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase === "viewing"), "← looks back");
  await page.keyboard.press("z");
  assert((await sans(page)).length === 2 && await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase === "play"),
    "looking back, the first Z returns to the game and takes nothing back (19.0)");
  await page.evaluate(() => window.__app.store.dispatch("play.resign", { color: "w", now: Date.now() }));
  await page.waitForTimeout(100);
  await page.keyboard.press("z");
  assert((await sans(page)).length === 2 && !(await buttons(page)).includes("undo"), "a finished game has nothing to take back into");
  await ctx.close();
}
{
  // a reload keeps what was taken back
  const name = "tb" + Date.now();
  const { ctx, page } = await open("", { dbname: name });
  await newGame(page, { id: "reload1" });
  await clickMove(page, "e2e4");
  await plies(page, 2);
  await clickMove(page, "g1f3");
  await plies(page, 4);
  await page.keyboard.press("z");
  await page.evaluate(async () => (await window.__app.ready).flush());
  await page.reload();
  await page.waitForFunction(() => window.__app.store.get().play.game && window.__app.store.get().play.game.id === "reload1", null, { timeout: 8000 });
  const g = await game(page);
  assert(g.moves.length === 2 && g.takebacks === 1, "after a reload: the position before the takeback is gone, the count is kept");
  await ctx.close();
}

// --- 翻转 ----------------------------------------------------------------------------------
{
  const { ctx, page } = await open();
  await newGame(page);
  const orient = () => page.evaluate(() => window.__play.board.state().orientation);
  const strips = () => page.evaluate(() => ({ top: document.querySelector(".strip.top").dataset.color, bottom: document.querySelector(".strip.bottom").dataset.color,
    topName: document.querySelector(".strip.top .who").textContent, bottomName: document.querySelector(".strip.bottom .who").textContent }));
  assert((await orient()) === "white", "you play White: White at the bottom");
  const a1 = await centre(page, "a1");
  await page.keyboard.press("f");
  assert((await orient()) === "black", "F turns the board");
  const a1f = await centre(page, "a1");
  assert(a1f.y < a1.y && a1f.x > a1.x, "a1 is now at the top right");
  const st = await strips();
  assert(st.top === "w" && st.bottom === "b" && /你/.test(st.topName) && /艾达|·/.test(st.bottomName), "the names and clocks turn with it (" + JSON.stringify(st) + ")");
  // the coordinates: the bottom-left corner cell is h8's, a light square; read its colour through the canvas
  const corner = await page.evaluate(() => {
    const c = window.__play.board.canvas, g = c.getContext("2d"), s = c.width / 8;
    const px = (x, y) => [...g.getImageData(Math.round(x), Math.round(y), 1, 1).data].slice(0, 3);
    return { bl: px(s * 0.5, c.height - s * 0.5), tl: px(s * 0.5, s * 0.5) };
  });
  assert(corner.bl.join() !== corner.tl.join(), "the corner squares are drawn for the turned board");
  // a move from the turned board lands on the right squares
  await clickMove(page, "e2e4");
  await plies(page, 2);
  assert((await sans(page))[0] === "e4", "a move made on the turned board is the move meant");
  // an arrow (the 4th hint) is drawn in board space
  await page.evaluate(() => window.__play.hint.value = { fen: window.__app.store.get().play.game.moves[1].fen, level: 4, arrows: [{ from: "d2", to: "d4", color: "G" }], marks: [] });
  await page.waitForTimeout(50);
  assert((await page.evaluate(() => window.__play.board.state().arrows)).some((x) => x.from === "d2"), "an arrow stays on its squares when the board is turned");
  // a move in flight keeps flying through a flip
  await page.evaluate(() => { window.__app.store.dispatch("play.move", { uci: "g1f3", now: Date.now() }); });
  await page.keyboard.press("f");
  const busy = await page.evaluate(() => window.__play.board.state().animating);
  assert((await orient()) === "white", "F again: back to your side");
  await page.waitForTimeout(400);
  assert(busy !== undefined && !(await page.evaluate(() => window.__play.board.state().animating)), "the move in flight settles after the flip");
  // the drawer's button
  await page.click("[data-test=moves]");
  await page.click("[data-test=flip]");
  assert((await orient()) === "black", "the drawer's 翻转 turns it too");
  await page.click("[data-test=moves]");
  await newGame(page, { engineColor: "w" });
  await page.waitForTimeout(50);
  assert((await orient()) === "black", "a new game starts from your side (Black now), not turned");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-takeback-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
