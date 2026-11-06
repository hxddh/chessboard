/**
 * Browser checks for the 20.0 app (src/app), in Chromium, served as ES
 * modules by scripts/serve-app.mjs:
 *
 *   router     #/learn #/play #/me #/settings, each page fetched on first visit only
 *   board      two boards on one page, independently playable; click, drag
 *              and keyboard make legal moves only
 *   play       two players and against the engine; a reload restores the game
 *   db         the contract suite against IndexedDB
 *   engine     the wasm Stockfish backend returns legal best moves
 *   measured   on the split build (scripts/build-app.mjs, ADR 0001): first paint and
 *              board drawn, the modules the first paint loads, script time per
 *              move over 100 moves, bytes per move
 *
 *   node scripts/test-app-e2e.mjs          (E2E_REQUIRED=1: a missing browser fails)
 */
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

// src/web/js has no package.json saying "module"; Node's reparse notice is noise here
process.removeAllListeners("warning");
const { Chess } = await import("../src/web/js/chess.js");

let failed = 0, passed = 0;
const assert = (cond, msg) => {
  if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); }
};
const median = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a.length ? a[a.length >> 1] : NaN; };
const p90 = (xs) => { const a = xs.slice().sort((p, q) => p - q); return a[Math.min(a.length - 1, Math.floor(a.length * 0.9))]; };

const srv = await startServer();
const browser = await launchChromium();
const errors = [];

async function open(query = "?engine=fake", { hash = "", ctxOpts = {}, base = srv.url } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, ...ctxOpts });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(base + query + hash);
  await page.waitForSelector("[data-page]");
  return { ctx, page };
}
const frames = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
const plies = (page) => page.evaluate(() => (window.__app.store.get().play.game?.moves || []).map((m) => m.san));
const newGame = (page, mode) => page.evaluate((mode) => window.__app.store.dispatch("play.new",
  { id: Date.now().toString(36).padStart(9, "0") + Math.random().toString(36).slice(2, 6), mode, engineColor: mode === "engine" ? "b" : null, opponent: "lin" }), mode);

/** Client centre of `sq` on the play page's board (orientation read from the page). */
async function centre(page, sq, sel = "[data-test=board] canvas") {
  return page.evaluate(([sq, sel]) => {
    const c = document.querySelector(sel), r = c.getBoundingClientRect();
    const black = window.__app.store.get().play.game?.engineColor === "w";
    let col = sq.charCodeAt(0) - 97, row = 8 - Number(sq[1]);
    if (black) { col = 7 - col; row = 7 - row; }
    return { x: r.left + (col + 0.5) * r.width / 8, y: r.top + (row + 0.5) * r.height / 8 };
  }, [sq, sel]);
}
async function clickSq(page, sq) { const p = await centre(page, sq); await page.mouse.click(p.x, p.y); }
async function clickMove(page, uci) { await clickSq(page, uci.slice(0, 2)); await clickSq(page, uci.slice(2, 4)); }
async function drag(page, from, to, sel) {
  const a = await centre(page, from, sel), b = await centre(page, to, sel);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 4 });
  await page.mouse.move(b.x, b.y, { steps: 4 });
  await page.mouse.up();
}

// --- router ---------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  const page = await ctx.newPage();
  const fetched = [];
  page.on("request", (r) => { const m = /\/src\/app\/pages\/(\w+)\.js/.exec(r.url()); if (m) fetched.push(m[1]); });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(srv.url + "?engine=fake&db=memory");
  await page.waitForSelector("[data-page=play]");
  assert((await page.evaluate(() => location.hash)) === "#/play", "an empty hash lands on #/play");
  assert(!fetched.includes("learn") && !fetched.includes("me") && !fetched.includes("settings"), "only the play page is fetched at start (" + fetched.join(",") + ")");
  for (const name of ["learn", "me", "settings", "play", "learn"]) {
    await page.click(`a[href="#/${name}"]`);
    await page.waitForSelector(`[data-page=${name}]`);
    assert((await page.$$("[data-page]")).length === 1, "#/" + name + " mounts one page");
  }
  const counts = fetched.reduce((m, n) => ((m[n] = (m[n] || 0) + 1), m), {});
  assert(Object.values(counts).every((n) => n === 1) && Object.keys(counts).length === 4,
    "each page module fetched once, on its first visit " + JSON.stringify(counts));
  assert(await page.$eval('a[href="#/learn"]', (a) => a.hasAttribute("aria-current")), "the nav marks the current page");
  await page.goto(srv.url + "?engine=fake&db=memory#/nowhere");
  await page.waitForSelector("[data-page=play]");
  assert((await page.evaluate(() => location.hash)) === "#/play", "an unknown hash falls back to #/play");
  await page.goto(srv.url + "?engine=fake&db=memory#/settings");
  await page.waitForSelector("[data-page=settings]");
  assert(true, "#/settings is reachable directly");
  await ctx.close();
}

// --- play: click, drag, keyboard; legal moves only; reload restores ------------------
{
  const q = "?engine=fake&think=0&dbname=e2e-play-" + Date.now();
  const { ctx, page } = await open(q);
  await page.waitForFunction(() => window.__app.store.get().play.game);
  await newGame(page, "pvp");
  await frames(page);
  await clickMove(page, "e2e4");
  await clickMove(page, "e7e5");
  await frames(page);
  assert((await plies(page)).join(" ") === "e4 e5", "click, click: e4 e5");
  await clickMove(page, "e1e3");
  await clickMove(page, "d1d4");
  await frames(page);
  assert((await plies(page)).length === 2, "illegal clicks move nothing");
  await drag(page, "g1", "f3");
  await frames(page);
  assert((await plies(page)).join(" ") === "e4 e5 Nf3", "drag g1→f3");
  await drag(page, "b8", "b4");
  await frames(page);
  assert((await plies(page)).length === 3, "an illegal drop moves nothing");
  // keyboard: the cursor starts on e2 for White; Black is to move, so walk to b8
  await page.focus("[data-test=board] canvas");
  const keys = async (...ks) => { for (const k of ks) await page.keyboard.press(k); };
  await keys("Enter", "ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp");
  await keys("Enter", "ArrowDown", "ArrowDown", "ArrowDown", "Enter");   // b8 → b5: not a knight move
  await frames(page);
  assert((await plies(page)).length === 3, "an illegal keyboard move moves nothing");
  await keys("ArrowUp", "ArrowUp", "ArrowUp", "Enter", "ArrowRight", "ArrowDown", "ArrowDown", "Enter");   // b8 → c6
  await frames(page);
  const afterKeys = await plies(page);
  assert(afterKeys.join(" ") === "e4 e5 Nf3 Nc6", "keyboard b8→c6 (" + afterKeys.join(" ") + ")");
  const moves = await page.evaluate(() => window.__app.store.get().play.game.moves.map((m) => m.uci));
  const g = new Chess();
  assert(moves.every((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] })), "every move made is legal");
  await page.evaluate(() => window.__app.store.dispatch("play.undo", { plies: 1 }));
  assert((await plies(page)).length === 3, "undo takes one ply back in a two-player game");
  await page.waitForTimeout(50);
  await page.reload();
  await page.waitForFunction(() => window.__app.store.get().play.game);
  await page.waitForSelector("[data-test=moves] li:nth-child(3)", { state: "attached" });
  assert((await plies(page)).join(" ") === "e4 e5 Nf3", "a reload restores the game, undo included");

  // against the engine
  await newGame(page, "engine");
  await clickMove(page, "d2d4");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 2);
  const reply = (await plies(page))[1];
  assert(!!reply, "the engine answered " + reply);
  await clickMove(page, "e2e4");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 4);
  await page.waitForTimeout(50);
  await page.reload();
  await page.waitForFunction(() => window.__app.store.get().play.game?.moves.length === 4);
  await page.waitForSelector("[data-test=board] canvas");
  const g2 = await page.evaluate(() => window.__app.store.get().play.game);
  assert(g2.mode === "engine" && g2.engineColor === "b", "a reload restores a game against the engine");
  await clickMove(page, "g1f3");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 6);
  assert(true, "and the engine keeps playing after it");
  await ctx.close();
}

// --- premove against a slow engine ---------------------------------------------
{
  const { ctx, page } = await open("?engine=fake&delay=600&db=memory&think=0");
  await page.waitForFunction(() => window.__app.store.get().play.game);
  await newGame(page, "engine");
  await clickMove(page, "d2d4");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length === 2);
  await clickMove(page, "b1c3");
  await clickMove(page, "a2a3");          // the engine is still thinking: a premove
  const queued = await page.evaluate(() => window.__app.store.get().play.game.moves.length);
  assert(queued === 3, "while the engine thinks, the second move waits (" + queued + " plies)");
  await page.waitForFunction(() => window.__app.store.get().play.game.moves.length >= 5, null, { timeout: 5000 }).catch(() => {});
  const ms = await page.evaluate(() => window.__app.store.get().play.game.moves.map((m) => m.uci));
  assert(ms[2] === "b1c3" && ms[4] === "a2a3", "the premove is played the moment the engine has replied (" + ms.join(" ") + ")");
  await ctx.close();
}

// --- two boards on one page ---------------------------------------------------
{
  const { ctx, page } = await open("?engine=fake&db=memory");
  await page.evaluate(async () => {
    const { createBoard } = await import("./board/board.js");
    const { applyMove, START_FEN } = await import("./core/rules.js");
    const host = document.createElement("div");
    host.style.cssText = "position:fixed;inset:0;display:flex;gap:20px;padding:20px;background:#000;z-index:9";
    document.body.append(host);
    window.__boards = [];
    for (const [i, orientation] of [[0, "white"], [1, "black"]]) {
      const el = document.createElement("div");
      el.id = "b" + i;
      el.style.cssText = "width:400px;height:400px";
      host.append(el);
      const rec = { fen: START_FEN, moves: [] };
      rec.board = createBoard(el, {
        orientation, theme: i ? "green" : "blue", pieceSet: i ? "cburnett" : "classic",
        onMove({ from, to }) {
          const m = applyMove(rec.fen, from + to);
          if (!m) { rec.illegal = (rec.illegal || 0) + 1; return; }
          rec.fen = m.fen; rec.moves.push(m.uci);
          rec.board.set({ fen: m.fen, lastMove: { from, to } });
        },
      });
      window.__boards.push(rec);
    }
  });
  const at = (i, sq) => page.evaluate(([i, sq]) => window.__boards[i].board.squareCenter(sq), [i, sq]);
  const click2 = async (i, a, b) => { for (const s of [a, b]) { const p = await at(i, s); await page.mouse.click(p.x, p.y); } };
  await click2(0, "e2", "e4");
  await click2(1, "d2", "d4");
  await click2(1, "d7", "d5");
  // a drag on board 1 (Black's view) — its squares are mirrored
  const a = await at(1, "c2"), b = await at(1, "c4");
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 6 }); await page.mouse.up();
  await click2(0, "e7", "e6");
  const st = await page.evaluate(() => window.__boards.map((r) => ({ moves: r.moves, illegal: r.illegal || 0, sel: r.board.state().selected })));
  assert(st[0].moves.join(" ") === "e2e4 e7e6", "board 1 played its own moves (" + st[0].moves.join(" ") + ")");
  assert(st[1].moves.join(" ") === "d2d4 d7d5 c2c4", "board 2 played its own moves (" + st[1].moves.join(" ") + ")");
  assert(st.every((s) => s.illegal === 0), "neither board ever offered an illegal move");
  // a selection on one board does not touch the other
  const p0 = await at(0, "g1"); await page.mouse.click(p0.x, p0.y);
  const sel = await page.evaluate(() => window.__boards.map((r) => r.board.state().selected));
  assert(sel[0] === "g1" && sel[1] === null, "selection is per board");
  // random clicking on both boards: whatever moves comes out is legal
  let seed = 11;
  const pick = (n) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return (seed >>> 8) % n; };
  // half the targets are random squares, half legal ones: both kinds get tried
  const sqs = [];
  for (const f of "abcdefgh") for (let r = 1; r <= 8; r++) sqs.push(f + r);
  for (let i = 0; i < 160; i++) {
    const k = pick(2);
    const fen = await page.evaluate((k) => window.__boards[k].fen, k);
    const g = new Chess(fen);
    const mine = sqs.filter((q) => { const p = g.get(q); return p && p.color === g.turn(); });
    if (!g.moves().length) continue;
    const from = mine[pick(mine.length)];
    const legal = g.moves({ square: from, verbose: true }).map((m) => m.to);
    const to = legal.length && pick(2) ? legal[pick(legal.length)] : sqs[pick(64)];
    for (const q of [from, to]) { const p = await at(k, q); await page.mouse.click(p.x, p.y); }
  }
  const rnd = await page.evaluate(() => window.__boards.map((r) => ({ n: r.moves.length, illegal: r.illegal || 0, moves: r.moves })));
  assert(rnd.every((r) => r.illegal === 0), "random clicks: no illegal move reached onMove (" + rnd.map((r) => r.n).join(", ") + " moves)");
  const leg = rnd.every((r) => { const g = new Chess(); return r.moves.every((u) => g.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: "q" })); });
  assert(leg, "and every move on both boards replays legally");
  // tween: a move animates for ~250 ms, then stops asking for frames
  const anim = await page.evaluate(async () => {
    const r = window.__boards[0];
    const { applyMove } = await import("./core/rules.js");
    const legal = (await import("./core/rules.js")).legalDests(r.fen);
    const [from, tos] = [...legal][0];
    const m = applyMove(r.fen, from + tos[0]);
    r.fen = m.fen;
    r.board.set({ fen: m.fen });
    const during = r.board.state().animating;
    await new Promise((res) => setTimeout(res, 400));
    return { during, after: r.board.state().animating };
  });
  assert(anim.during && !anim.after, "a move tweens and then settles");
  await ctx.close();
  // under prefers-reduced-motion nothing tweens
  const rm = await open("?engine=fake&db=memory", { ctxOpts: { reducedMotion: "reduce" } });
  const still = await rm.page.evaluate(async () => {
    const { createBoard } = await import("./board/board.js");
    const el = document.createElement("div"); el.style.cssText = "width:300px;height:300px"; document.body.append(el);
    const b = createBoard(el, {});
    b.set({ fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1", lastMove: { from: "e2", to: "e4" } });
    return b.state().animating;
  });
  assert(still === false, "reduced motion: no tween at all");
  await rm.ctx.close();
}

// --- db contract on IndexedDB ------------------------------------------------------
{
  const { ctx, page } = await open("?engine=fake&db=memory");
  const r = await page.evaluate(async () => {
    const { createHarness } = await import("/scripts/app/harness.mjs");
    const { default: dbContract } = await import("/scripts/app/db-contract.mjs");
    const { createDb, idbBackend } = await import("./services/db.js");
    const logs = [];
    const h = createHarness((l) => logs.push(l));
    dbContract(h.test, (name) => createDb(idbBackend(name)), "indexeddb: ");
    const out = await h.run();
    return { ...out, logs };
  });
  for (const l of r.logs) console.error(l);
  assert(r.failed === 0 && r.passed > 10, "db contract on IndexedDB: " + r.passed + " passed, " + r.failed + " failed");
  await ctx.close();
}

// --- engine: Stockfish wasm ------------------------------------------------------
{
  const { ctx, page } = await open("?engine=fake&db=memory");
  // the way WKWebView's zero:// answers (ADR 0001 probe): the body, but no
  // headers — so no application/wasm, and streaming compilation would refuse it
  let stripped = 0;
  await ctx.route(/stockfish-19-lite-single\.wasm/, async (route) => {
    const r = await route.fetch();
    stripped++;
    await route.fulfill({ status: 200, headers: {}, body: await r.body() });
  });
  const r = await page.evaluate(async () => {
    const { createHarness } = await import("/scripts/app/harness.mjs");
    const { default: engineContract } = await import("/scripts/app/engine-contract.mjs");
    const { createEngineService, stockfishBackend } = await import("./services/engine.js");
    const logs = [];
    const h = createHarness((l) => logs.push(l));
    const svc = createEngineService(stockfishBackend());
    const t0 = performance.now();
    engineContract(h.test, () => svc, { label: "wasm: ", budget: { depth: 8 } });
    const out = await h.run();
    svc.dispose();
    return { ...out, logs, ms: performance.now() - t0 };
  });
  for (const l of r.logs) console.error(l);
  assert(stripped > 0, "the .wasm was served without headers (" + stripped + ")");
  assert(r.failed === 0 && r.passed >= 7, "engine contract on Stockfish wasm, its .wasm served without headers: " + r.passed + " passed, " + r.failed + " failed (" + (r.ms / 1000).toFixed(1) + " s)");
  await ctx.close();
}

// --- measured, on the split build ---------------------------------------------------
const report = {};
const { buildApp } = await import("./build-app.mjs");
const built = await buildApp({ quiet: true });
report.firstPaintKB = Math.round(built.firstBytes / 102.4) / 10;
{
  // first paint and board drawn: a cold context each time, median of five
  const paints = [], boards = [];
  let fetched = [];
  for (let i = 0; i < 5; i++) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    const page = await ctx.newPage();
    const got = [];
    page.on("request", (r) => { const m = /\/dist-app\/([^?]+)/.exec(r.url()); if (m) got.push(m[1]); });
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(srv.dist + "?engine=fake&db=memory");
    await page.waitForSelector("[data-page=play] canvas");
    await page.waitForFunction(() => performance.getEntriesByName("app:board").length > 0);
    await frames(page);
    const t = await page.evaluate(() => ({
      fcp: performance.getEntriesByName("first-contentful-paint")[0]?.startTime,
      board: performance.getEntriesByName("app:board")[0]?.startTime,
    }));
    paints.push(t.fcp); boards.push(t.board);
    fetched = got;
    await ctx.close();
  }
  report.firstPaintMs = median(paints);
  report.boardReadyMs = median(boards);
  console.log("first contentful paint: median " + report.firstPaintMs.toFixed(0) + " ms (" + paints.map((x) => x.toFixed(0)).join(", ") +
    ") · board drawn (pieces on it): " + report.boardReadyMs.toFixed(0) + " ms (" + boards.map((x) => x.toFixed(0)).join(", ") + ")" +
    " · first paint loads " + built.first.length + " modules, " + report.firstPaintKB + " KB");
  assert(report.firstPaintMs <= 220, "first paint ≤ 220 ms (v20-0-plan §1)");
  assert(report.boardReadyMs <= 250, "board drawn ≤ 250 ms on the split build (ADR 0001)");
  const pages = fetched.filter((f) => /^(learn|me|settings)-/.test(f));
  assert(pages.length === 0 && fetched.some((f) => /^play-/.test(f)), "the first paint loads the play page and no other page (" + fetched.join(" ") + ")");
  assert(fetched.filter((f) => /^pieces-/.test(f)).length === 1, "and one piece set");
}
{
  // 100 moves through the real input path, as scripts/perf-e2e.mjs measures 19.0
  const PLIES = 100;
  const line = (() => {
    for (let seed = 1; seed < 500; seed++) {
      let s = seed;
      const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
      const g = new Chess(), out = [];
      while (out.length < PLIES) {
        const all = g.moves({ verbose: true }).filter((m) => !m.promotion);
        const quiet = all.filter((m) => !m.captured);
        const pool = quiet.length && rnd() < 0.9 ? quiet : all;
        const order = pool.map((m) => [rnd(), m]).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
        let pick = null;
        for (const m of order) { g.move(m); if (!g.game_over()) { pick = m; break; } g.undo(); }
        if (!pick) break;
        out.push(pick.from + pick.to);
      }
      if (out.length === PLIES) return out;
    }
    throw new Error("no clean game");
  })();
  const { ctx, page } = await open("?engine=fake&think=0&dbname=e2e-perf-" + Date.now(), { ctxOpts: { reducedMotion: "reduce" }, base: srv.dist });
  await page.waitForFunction(() => window.__app.store.get().play.game);
  await newGame(page, "pvp");
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Performance.enable");
  const scriptMs = async () => (await cdp.send("Performance.getMetrics")).metrics.find((m) => m.name === "ScriptDuration").value * 1000;
  const bytes0 = await page.evaluate(async () => (await window.__app.ready).stats().bytes);
  const per = [];
  for (let i = 0; i < line.length; i++) {
    const t0 = await scriptMs();
    await clickMove(page, line[i]);
    await page.waitForFunction((n) => document.querySelectorAll("[data-test=moves] li").length >= n, i + 1, { timeout: 5000 }).catch(() => {});
    await frames(page);
    per.push((await scriptMs()) - t0);
  }
  const n = (await plies(page)).length;
  assert(n === PLIES, "100 moves went in through the board (" + n + ")");
  const st = await page.evaluate(async () => { const db = await window.__app.ready; await db.flush(); return db.stats(); });
  report.scriptMsMedian = median(per);
  report.scriptMsP90 = p90(per);
  report.scriptMsLast20 = median(per.slice(-20));
  report.scriptMsFirst20 = median(per.slice(0, 20));
  report.bytesPerMove = (st.bytes - bytes0) / PLIES;
  console.log("script time per move: median " + report.scriptMsMedian.toFixed(2) + " ms · p90 " + report.scriptMsP90.toFixed(2) +
    " ms · moves 1–20 " + report.scriptMsFirst20.toFixed(2) + " ms · moves 81–100 " + report.scriptMsLast20.toFixed(2) + " ms");
  console.log("db: " + report.bytesPerMove.toFixed(0) + " bytes written per move (" + (st.bytes - bytes0) + " B for " + PLIES + " plies, " + st.writes + " transactions in all)");
  assert(report.scriptMsMedian <= 6.5, "≤ 6.5 ms of script per move on the split build (v20-0-plan §1)");
  assert(report.scriptMsLast20 <= report.scriptMsFirst20 * 1.5 + 0.5, "a late move costs no more than an early one");
  assert(report.bytesPerMove * 160 <= 100 * 1024, "a 160-ply game would write ≤ 100 KB");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));

await browser.close();
await srv.close();
console.log("\ntest-app-e2e: " + passed + " passed, " + failed + " failed");
console.log("MEASURED " + JSON.stringify(report));
process.exit(failed ? 1 : 0);
