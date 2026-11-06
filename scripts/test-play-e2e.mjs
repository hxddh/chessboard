/**
 * The 20.0 play screen and the review on the board, in Chromium, against the
 * fake engine (scripts/serve-app.mjs serves src/app as modules; ?think=0
 * drops the opponent's human-like pauses):
 *
 *   layout      ≤ 12 controls on the play screen (drawer shut and open) and in
 *               the new-game sheet; no evaluation bar while a game is on
 *   new game    opponent, colour and clock from the sheet; the clock runs, with increment
 *   moves       promotion picker; sounds for move, capture, check, castle, promote;
 *               the checked king's square glows
 *   endings     resign and draw ask first; a threefold repetition can be claimed;
 *               the result shows once
 *   P2 coach    a hanging move is held and asked about before it is committed,
 *               and before any reply; 再想想 takes it back, 就走这步 plays it
 *   P3 hints    the first press draws no arrow; the fourth draws one
 *   P5 review   ≤ 3 cards, only your moves while undecided; the board stands on
 *               the first card (B3); a wrong try is explained for that move (B6);
 *               no 为什么 toggle (B9); each move once in the report; findings
 *               are events; a reload restores the review without a second pass (B1)
 *   measured    the time to review a 60-ply game
 *
 * Against the split build (scripts/build-app.mjs) unless --dev.
 *
 *   node scripts/test-play-e2e.mjs [--dev] [--shots=dir]   (E2E_REQUIRED=1: a missing browser fails)
 *   REAL_ENGINE=1 …   also time the 60-ply review on Stockfish wasm
 */
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");
const { Chess } = await import("../src/web/js/chess.js");
const SHOTS = (process.argv.find((a) => a.startsWith("--shots=")) || "").slice(8) || null;

let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); }
};
const DEV = process.argv.includes("--dev");
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchChromium();
const errors = [];
const report = {};

async function open(query = "", { w = 1440, h = 900, ctxOpts = {}, engine = "fake", think = 0 } = {}) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...ctxOpts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?think=" + think + (engine === "fake" ? "&engine=fake" : "") + query);
  await page.waitForSelector("[data-page=play] canvas");
  await page.waitForFunction(() => window.__app.store.get().play.game && window.__play);
  return { ctx, page };
}
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: SHOTS + "/" + name + ".png" }); };
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const game = (page) => page.evaluate(() => window.__app.store.get().play.game);
const bar = (page) => page.$eval("[data-test=bar]", (e) => ({ phase: e.dataset.phase, text: e.querySelector("[data-test=bar-text]").textContent,
  buttons: [...e.querySelectorAll("button")].map((b) => b.dataset.test) }));
const waitPhase = (page, phase, timeout = 8000) => page.waitForFunction((p) => document.querySelector("[data-test=bar]")?.dataset.phase === p, phase, { timeout });
/** A new game straight into the store, the way the sheet makes one. */
const newGame = (page, o) => page.evaluate((o) => {
  window.__app.store.dispatch("play.new", { id: "g" + Math.random().toString(36).slice(2), mode: "engine", engineColor: "b", opponent: "ada", ...o });
}, o);
const controls = (page) => page.$$eval("[data-page=play] :is(button, select, input, a, canvas, [tabindex]):not([hidden] *)", (els) =>
  els.filter((e) => e.offsetParent !== null && !e.closest("[hidden]")).map((e) => e.dataset.test || e.tagName.toLowerCase()));

/** Step the sheet's opponent card (‹ ›) to `id`. */
async function pickOpponent(page, id) {
  for (let i = 0; i < 20 && !(await page.$eval("[data-test=opp-prev]", (b) => b.disabled)); i++) await page.click("[data-test=opp-prev]");
  for (let i = 0; i < 20 && (await page.$eval("[data-test=opp-card]", (c) => c.dataset.id)) !== id; i++) await page.click("[data-test=opp-next]");
}
async function centre(page, sq) {
  return page.evaluate((sq) => window.__play.board.squareCenter(sq), sq);
}
async function clickMove(page, uci) {
  for (const sq of [uci.slice(0, 2), uci.slice(2, 4)]) { const p = await centre(page, sq); await page.mouse.click(p.x, p.y); }
}
async function drag(page, from, to) {
  const a = await centre(page, from), b = await centre(page, to);
  await page.mouse.move(a.x, a.y); await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 }); await page.mouse.up();
}
/** A game played straight into the store (and so into the db), move by move. */
const playLine = (page, o, ucis, resign) => page.evaluate(([o, ucis, resign]) => {
  const st = window.__app.store;
  st.dispatch("play.new", { mode: "engine", engineColor: "b", opponent: "ada", ...o });
  for (const uci of ucis) st.dispatch("play.move", { uci, now: Date.now() });
  if (resign) st.dispatch("play.resign", { color: resign, now: Date.now() });
}, [o, ucis, resign]);
const sansToUci = (sans, fen) => { const g = new Chess(fen); return sans.map((s) => { const m = g.move(s); return m.from + m.to + (m.promotion || ""); }); };

// --- layout: controls, the sheet, no evaluation in play --------------------------------
{
  const { ctx, page } = await open("&db=memory");
  await frames(page);
  const c = await controls(page);
  assert(c.length <= 12, "the play screen has ≤ 12 controls (" + c.length + ": " + c.join(" ") + ")");
  assert((await bar(page)).phase === "play", "one context bar, in its playing state");
  assert(await page.$eval("[data-test=evalbar]", (e) => e.hidden), "no evaluation bar while a game is on");
  await shot(page, "play-1440");
  await page.click("[data-test=moves]");
  const c2 = await controls(page);
  assert(c2.length <= 12 && !(await page.$eval("[data-test=drawer]", (e) => e.hidden)), "the move drawer opens; still ≤ 12 controls (" + c2.length + ")");
  await page.click("[data-test=moves]");
  await page.click("[data-test=new]");
  await page.waitForSelector("[data-test=sheet]");
  const c3 = await page.$$eval("[data-test=sheet] :is(button, select, input)", (els) => els.length);
  assert(c3 <= 12, "the new-game sheet has ≤ 12 controls (" + c3 + ")");
  await shot(page, "new-game-sheet");
  // vera, Black, 3+2
  await pickOpponent(page, "vera");
  assert(/^薇拉$/.test(await page.textContent("[data-test=opp-name]")) && /\d/.test(await page.textContent("[data-test=opp-rating]")) &&
    (await page.textContent("[data-test=opp-note]")).length > 4 && await page.$("[data-test=opp-card] .portrait svg"),
    "the sheet shows one opponent at a time: face, name, rating, a line of character");
  await page.click("[data-test=color-b]");
  await page.selectOption("[data-test=clock]", "3+2");
  await page.click("[data-test=start]");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 1, null, { timeout: 5000 });
  const g = await game(page);
  assert(g.opponent === "vera" && g.engineColor === "w" && g.clock && g.clock.id === "3+2", "the sheet made vera (White) vs you (Black), 3+2");
  assert((await page.evaluate(() => window.__play.board.state().orientation)) === "black", "the board turns to your side");
  const t0 = await page.$eval("[data-test=clock-bottom]", (e) => e.textContent);
  await page.waitForTimeout(1300);
  const t1 = await page.$eval("[data-test=clock-bottom]", (e) => e.textContent);
  assert(/^(3:00|2:5\d)$/.test(t0) && t1 !== t0, "your clock runs once the opponent has moved (" + t0 + " → " + t1 + ")");
  const reply = (await game(page)).moves[0].uci;
  await clickMove(page, reply[1] === "2" && reply[0] === "e" ? "e7e5" : "d7d5");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length >= 2);
  const after = (await game(page)).moves[1].clock;
  assert(after && after.b > 178000, "the increment is credited after your move (" + (after && after.b) + " ms)");
  await ctx.close();
}

// --- moves: promotion, sounds, check glow ------------------------------------------------
{
  const { ctx, page } = await open("&db=memory");
  // pvp so both sides are played from the board
  await page.evaluate(() => window.__app.store.dispatch("play.new", { id: "p1", mode: "pvp",
    startFen: "4k3/1P6/8/8/8/8/8/R3K2R w KQ - 0 1" }));
  await frames(page);
  await clickMove(page, "e1g1");                       // castle
  await clickMove(page, "e8d7");
  await clickMove(page, "b7b8");                       // promote: the picker
  await page.waitForSelector("[data-test=promo]");
  assert((await game(page)).moves.length === 2, "the promotion waits for the picker");
  await shot(page, "promotion");
  await page.click("[data-test=promo-n]");
  await frames(page);
  let g = await game(page);
  assert(g.moves[2].san === "b8=N+", "the picker's knight is played (" + g.moves[2].san + ")");
  const chk = await page.evaluate(() => window.__play.board.state().check);
  assert(chk === "d7", "the checked king's square glows (" + chk + ")");
  await clickMove(page, "d7c7");
  await clickMove(page, "a1a7");                       // check from the rook
  await clickMove(page, "c7b8");                       // the king takes the knight
  await frames(page);
  const played = await page.evaluate(() => window.__play.sound.played.slice());
  for (const s of ["castle", "move", "promote", "check"]) assert(played.includes(s), "sound: " + s);
  g = await game(page);
  assert(g.moves[5] && g.moves[5].san === "Kxb8" && played[played.length - 1] === "capture", "sound: capture (" + g.moves.map((m) => m.san).join(" ") + ")");
  await ctx.close();
}
{
  // a capture, plainly
  const { ctx, page } = await open("&db=memory");
  await page.evaluate(() => window.__app.store.dispatch("play.new", { id: "p2", mode: "pvp",
    startFen: "4k3/8/8/3p4/4P3/8/8/4K3 w - - 0 1" }));
  await frames(page);
  await clickMove(page, "e4d5");
  assert((await page.evaluate(() => window.__play.sound.played.slice(-1)[0])) === "capture", "sound: capture");
  await ctx.close();
}

// --- endings: resign asks; a threefold can be claimed; the result once ----------------------
{
  const { ctx, page } = await open("&db=memory");
  await page.evaluate(() => window.__app.store.dispatch("play.new", { id: "r1", mode: "pvp" }));
  for (const u of ["g1f3", "g8f6", "f3g1", "f6g8", "g1f3", "g8f6", "f3g1", "f6g8"]) await clickMove(page, u);
  await page.click("[data-test=draw]");
  let b = await bar(page);
  assert(b.phase === "confirm" && b.text.includes("三次"), "和棋 after a threefold offers the claim (" + b.text + ")");
  await page.click("[data-test=cancel]");
  assert((await bar(page)).phase === "play" && !(await game(page)).result, "cancel: nothing happened");
  await page.click("[data-test=draw]");
  await page.click("[data-test=confirm]");
  let g = await game(page);
  assert(g.result && g.result.reason === "threefold", "the claim draws by threefold repetition");
  b = await bar(page);
  assert(b.phase === "result" && b.text.includes("三次重复"), "the result, once, in the bar (" + b.text + ")");
  await ctx.close();
}
{
  const { ctx, page } = await open("&db=memory");
  await newGame(page, {});
  await page.click("[data-test=resign]");
  assert((await bar(page)).phase === "confirm" && !(await game(page)).result, "认输 asks first");
  await page.click("[data-test=confirm]");
  const g = await game(page);
  assert(g.result && g.result.result === "0-1" && g.result.reason === "resign", "and then resigns");
  const b = await bar(page);
  assert(b.phase === "result" && b.text.startsWith("你输了"), "the result moment (" + b.text + ")");
  const results = await page.evaluate(() => window.__play.sound.played.filter((s) => s === "loss").length);
  assert(results === 1, "the ending sounds once");
  await ctx.close();
}

// --- P2: the coach asks before the move is committed ------------------------------------------
{
  const { ctx, page } = await open("&db=memory&delay=50");
  // 1.e4 d6: Qg4?? hangs the queen to …Bxg4
  await newGame(page, { coach: true, startFen: "rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2" });
  await frames(page);
  await drag(page, "d1", "g4");
  await waitPhase(page, "coach");
  let b = await bar(page);
  let g = await game(page);
  assert(b.text.includes("对方在威胁什么"), "the coach asks: " + b.text);
  assert(g.moves.length === 0, "…before the move is committed, and before any reply (" + g.moves.length + " plies)");
  await shot(page, "coach-before-commit");
  await page.waitForTimeout(300);
  assert((await game(page)).moves.length === 0, "nobody moves while the question is open");
  await page.click("[data-test=rethink]");
  await frames(page);
  g = await game(page);
  const st = await page.evaluate(() => window.__play.board.state());
  assert(g.moves.length === 0 && st.fen.startsWith("rnbqkbnr/ppp1pppp/3p4/8/4P3/8/PPPP1PPP/RNBQKBNR"), "再想想: the queen is back on d1");
  await drag(page, "d1", "g4");
  await waitPhase(page, "coach");
  await page.click("[data-test=play-anyway]");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 2, null, { timeout: 5000 });
  g = await game(page);
  assert(g.moves[0].san === "Qg4", "就走这步: the move is played, and then the reply (" + g.moves.map((m) => m.san).join(" ") + ")");
  // a sound move is not questioned
  await newGame(page, { coach: true });
  await clickMove(page, "g1f3");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 2, null, { timeout: 5000 });
  assert(true, "a safe move goes straight in");
  const ev = await page.evaluate(async () => (await (await window.__app.ready).query("events.since", { after: 0 })).filter((e) => e.type === "coach.prompt"));
  assert(ev.length === 2 && ev[0].choice === "rethink" && ev[1].choice === "play", "each question is an event (" + ev.map((e) => e.choice) + ")");
  await ctx.close();
}

// --- P3: layered hints -------------------------------------------------------------------------
{
  const { ctx, page } = await open("&db=memory");
  // 1.e4 e5 2.Qh5 Nc6 3.Bc4: Black to move faces Qxf7#; play Black
  await newGame(page, { engineColor: "w", startFen: "r1bqkbnr/pppp1ppp/2n5/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 3 3" });
  await frames(page);
  await page.click("[data-test=hint]");
  await frames(page);
  let st = await page.evaluate(() => window.__play.board.state());
  let b = await bar(page);
  assert(st.arrows.length === 0, "first press: no arrow");
  assert(b.text.includes("Qxf7#") || b.text.includes("♕xf7#"), "first press: the threat (" + b.text + ")");
  await shot(page, "hint-1");
  await page.click("[data-test=hint]");
  b = await bar(page);
  st = await page.evaluate(() => window.__play.board.state());
  assert(st.arrows.length === 0 && b.text.includes("将军") && b.text.includes("吃子"), "second press: checks and captures, still no arrow (" + b.text + ")");
  await page.click("[data-test=hint]");
  await page.waitForFunction(() => !document.querySelector("[data-test=bar-text]").textContent.includes("想一下"));
  b = await bar(page);
  st = await page.evaluate(() => window.__play.board.state());
  assert(st.arrows.length === 0 && b.text.includes("想法"), "third press: the idea, no arrow (" + b.text + ")");
  await page.click("[data-test=hint]");
  await page.waitForFunction(() => window.__play.board.state().arrows.length === 1);
  st = await page.evaluate(() => window.__play.board.state());
  assert(st.arrows.length === 1, "fourth press: the piece and the square (" + JSON.stringify(st.arrows) + ")");
  await shot(page, "hint-4");
  await ctx.close();
}

// --- P5: the review on the board -------------------------------------------------------------
const REVIEW_GAME = "e4 e5 Nf3 Nc6 Nd4 exd4 Ba6 bxa6 d3 Nf6".split(" ");   // 3.Nd4?? and 4.Ba6?, then lost
{
  const dbname = "e2e-review-" + Date.now();
  let { ctx, page } = await open("&dbname=" + dbname);
  const ucis = sansToUci(REVIEW_GAME);
  await playLine(page, { id: "rv1" }, ucis);
  await page.click("[data-test=resign]");
  await page.click("[data-test=confirm]");
  await waitPhase(page, "result");
  await waitPhase(page, "review-card", 10000);
  const fens = await page.evaluate(() => window.__play.review.data.fens);
  const moments = await page.evaluate(() => window.__play.review.data.moments);
  assert(moments.length >= 1 && moments.length <= 3, "≤ 3 turning points (" + moments.map((m) => m.ply + ":" + m.san + ":" + m.grade) + ")");
  assert(moments.every((m) => m.side === "w"), "only your own moves");
  assert(moments.every((m) => m.before >= 15), "only while the game was undecided");
  let st = await page.evaluate(() => window.__play.board.state());
  assert(st.fen === fens[moments[0].ply], "the board stands on the first card's position (B3)");
  let b = await bar(page);
  assert(b.text.includes(moments[0].san.replace(/^N/, "♘")) || b.text.includes(moments[0].san), "the card names the move played (" + b.text + ")");
  assert(!b.buttons.some((x) => /why/.test(x || "")) && !(await page.$$eval("[data-page=play] button", (bs) => bs.some((x) => x.textContent.includes("为什么")))), "no 为什么 toggle (B9)");
  assert(!(await page.$eval("[data-test=evalbar]", (e) => e.hidden)), "the evaluation shows in the review");
  await shot(page, "review-card");
  // a wrong try that is not the game's move: explained for itself (B6)
  await clickMove(page, "f1a6");
  await page.waitForFunction(() => document.querySelector("[data-test=bar]").dataset.tone === "bad", null, { timeout: 5000 });
  b = await bar(page);
  assert(b.text.includes("a6") && !b.text.includes("d4"), "a wrong try is explained for that move (B6): " + b.text);
  await shot(page, "review-wrong-try");
  await page.waitForFunction(() => window.__play.board.state().movable !== "none", null, { timeout: 4000 });
  st = await page.evaluate(() => window.__play.board.state());
  assert(st.fen === fens[moments[0].ply], "and the card's position comes back to try again");
  // the game's own move again
  const playedUci = sansToUci([moments[0].san], fens[moments[0].ply])[0];
  await clickMove(page, playedUci);
  await page.waitForFunction(() => document.querySelector("[data-test=bar]").dataset.tone === "bad");
  b = await bar(page);
  assert(b.text.includes("对局里那一步"), "the game's move again: said so (" + b.text + ")");
  await page.waitForFunction(() => window.__play.board.state().movable !== "none", null, { timeout: 4000 });
  // the engine's move
  await clickMove(page, moments[0].best);
  await page.waitForFunction(() => document.querySelector("[data-test=bar]").dataset.tone === "good", null, { timeout: 5000 });
  b = await bar(page);
  assert(b.text.includes("对了"), "the best move: 对了 (" + b.text + ")");
  // through the cards
  for (let k = 1; k < moments.length; k++) {
    await page.click("[data-test=rv-next]");
    st = await page.evaluate(() => window.__play.board.state());
    assert(st.fen === fens[moments[k].ply], "card " + (k + 1) + " stands on its position");
    await page.click("[data-test=rv-answer]");
    st = await page.evaluate(() => window.__play.board.state());
    assert(st.arrows.length === 1, "看答案 draws the engine's move");
  }
  await page.click("[data-test=rv-next]");
  await waitPhase(page, "review-done");
  await page.click("[data-test=report]");
  const rows = await page.$$eval("[data-test=moves] li", (els) => els.map((e) => e.dataset.ply));
  assert(rows.length === REVIEW_GAME.length && new Set(rows).size === rows.length, "the full report shows each move once (" + rows.length + ")");
  const head = await page.$eval("[data-test=report-head]", (e) => e.textContent);
  assert(/准确度 \d+/.test(head), "one accuracy figure: " + head);
  await shot(page, "review-report");
  const ev = await page.evaluate(async () => (await (await window.__app.ready).query("events.since", { after: 0 })));
  const findings = ev.filter((e) => e.type === "review.finding");
  assert(findings.length === moments.length && findings.every((f) => Number.isInteger(f.ply) && f.severity && "motif" in f),
    "each turning point is a review.finding event (" + JSON.stringify(findings.map((f) => ({ ply: f.ply, severity: f.severity, motif: f.motif }))) + ")");
  assert(ev.some((e) => e.type === "review.retry" && e.ok === false) && ev.some((e) => e.type === "review.retry" && e.ok === true), "tries are events too");
  const rowsDb = await page.evaluate(async () => (await (await window.__app.ready).query("analysis.get", { gameId: "rv1" })).length);
  assert(rowsDb === REVIEW_GAME.length + 1, "the analysis table holds one row per position (" + rowsDb + ")");
  await page.waitForTimeout(100);
  // reload: the review is still there, and the pass does not run again (B1)
  await page.reload();
  await page.waitForFunction(() => window.__play && document.querySelector("[data-test=bar]")?.dataset.phase?.startsWith("review-"));
  const phases = await page.evaluate(() => document.querySelector("[data-test=bar]").dataset.phase);
  assert(phases === "review-done", "after a reload the finished review is back (" + phases + ")");
  const ev2 = await page.evaluate(async () => (await (await window.__app.ready).query("events.since", { after: 0 })).filter((e) => e.type === "review.analysis").length);
  assert(ev2 === 1, "and was not run a second time");
  await page.click("[data-test=report]");
  const marks = await page.$$eval("[data-test=moves] li.moment", (els) => els.length);
  assert(marks === moments.length, "the report still marks the turning points after the reload");
  await ctx.close();

  // a review left half way: back on its first card after a reload
  ({ ctx, page } = await open("&dbname=" + dbname + "-b"));
  await playLine(page, { id: "rv2" }, ucis, "w");
  await waitPhase(page, "review-card", 10000);
  await page.waitForTimeout(100);
  await page.reload();
  await waitPhase(page, "review-card", 10000);
  const st2 = await page.evaluate(() => ({ fen: window.__play.board.state().fen, f0: window.__play.review.data.fens[window.__play.review.data.moments[0].ply] }));
  assert(st2.fen === st2.f0, "a review left on a card comes back on its first card (B1 + B3)");
  await ctx.close();
}

// --- P1 the opponent: a quiet 在想, its lines, resigning a hopeless game ------------------------
{
  // the human pace on (?think=1): the fake engine answers at once, the page holds the reply for the think time
  const { ctx, page } = await open("&db=memory", { think: 1 });
  await newGame(page, { opponent: "pip" });
  await page.waitForSelector("[data-test=opp-line]:not([hidden])", { timeout: 3000 });
  const hello = await page.textContent("[data-test=opp-line]");
  assert(/^皮普：/.test(hello), "the opponent greets you when the game starts (" + hello + ")");
  assert(await page.$eval("[data-test=thinking]", (e) => e.hidden), "no 在想 while it is your move");
  await clickMove(page, "e2e4");
  const seen = await page.waitForSelector("[data-test=thinking]:not([hidden])", { timeout: 2000 }).then(() => true).catch(() => false);
  const t0 = Date.now();
  const barWhile = (await bar(page)).text;
  assert(seen && /在想/.test(await page.textContent("[data-test=thinking]")) && /皮普在想/.test(barWhile), "while it thinks, its strip shows a quiet 在想 (" + barWhile + ")");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 2, null, { timeout: 8000 });
  const took = Date.now() - t0;
  assert(took >= 400 && await page.$eval("[data-test=thinking]", (e) => e.hidden), "it replies after a human pause (" + took + " ms), and 在想 goes");
  await shot(page, "opponent-thinking");
  await ctx.close();
}
{
  // a queen and two rooks down: 马克斯 resigns (two hopeless looks running); its line says so
  const { ctx, page } = await open("&db=memory");
  await newGame(page, { opponent: "max", startFen: "4k3/8/8/8/8/8/8/RR1QK3 w - - 0 40" });
  for (const uci of ["a1a2", "a2a3", "a3a4"]) {
    const g = await game(page);
    if (g.result) break;
    await page.waitForFunction(() => { const g = window.__app.store.get().play.game; return g.result || g.moves.length % 2 === 0; }, null, { timeout: 5000 });
    if ((await game(page)).result) break;
    await page.evaluate((u) => window.__app.store.dispatch("play.move", { uci: u, now: Date.now() }), uci);
  }
  await page.waitForFunction(() => window.__app.store.get().play.game.result, null, { timeout: 8000 }).catch(() => {});
  const g = await game(page);
  const line = await page.textContent("[data-test=opp-line]");
  assert(g.result && g.result.reason === "resign" && g.result.result === "1-0", "the opponent resigns a hopeless position (" + JSON.stringify(g.result) + ", " + g.moves.length + " plies)");
  assert(/^马克斯：.*(赢|认输)/.test(line), "with its one line at the end (" + line + ")");
  await ctx.close();
}

// --- measured: a 60-ply game ---------------------------------------------------------------------
{
  const { COACH_GAMES } = await import("./fixtures/coach-games.mjs");
  const sans = COACH_GAMES[0].san.slice(0, 60);
  const ucis = sansToUci(sans);
  for (const engine of ["fake", ...(process.env.REAL_ENGINE ? ["stockfish"] : [])]) {
    // the fake answers at once here (its default pretends 30 ms a search)
    const { ctx, page } = await open("&db=memory&delay=0", { engine });
    const t0 = await page.evaluate(() => performance.now());
    await playLine(page, { id: "m60" }, ucis, "w");
    await waitPhase(page, "review-card", 600000).catch(() => {});
    const ms = (await page.evaluate(() => performance.now())) - t0 - 1600;   // less the result moment
    report["review60_" + engine + "_ms"] = Math.round(ms);
    const searches = await page.evaluate(() => window.__play.review.data && window.__play.review.data.p.deep.filter(Boolean).length + window.__play.review.data.fens.length);
    console.log("review of a 60-ply game (" + engine + " engine, " + searches + " searches): " + (ms / 1000).toFixed(2) + " s after the result moment");
    await ctx.close();
  }
  assert(report.review60_fake_ms < 3000, "the review's own work for 60 plies stays under 3 s (fake engine)");
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-play-e2e: " + passed + " passed, " + failed + " failed");
console.log("MEASURED " + JSON.stringify(report));
process.exit(failed ? 1 : 0);
