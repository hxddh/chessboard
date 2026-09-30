/**
 * Browser check for 从 Lichess / Chess.com 同步 (v8-0-plan C2), with the
 * native bridge stubbed: the request itself is main.zig's, and its parsing of
 * both sites' answers is covered by the Zig tests there. What only a running
 * page can settle is the flow around it:
 *   - 允许联网同步 is off on a fresh profile, and nothing is asked of the
 *     native side until the player turns it on AND presses 同步;
 *   - offline, rate-limited and no-such-user each read as their own line;
 *   - the games land in the library, the name is claimed (你在棋谱里的名字),
 *     and they are pending — the library's analysis queue;
 *   - the choice survives a reload; the dialog works from the keyboard and in
 *     the other two languages; without a bridge it says so and asks nothing.
 *
 * Same harness as the other browser checks (see e2e-browser.mjs).
 *   node scripts/test-sync-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { lichessAnswer, chesscomAnswer } from "./sync-fixtures.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
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

/** Two games the way main.zig answers: one PGN text, newest first. */
const TWO_GAMES = "[Event \"Let's Play!\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.20\"]\n[White \"last_opp\"]\n" +
  "[Black \"Sync_Tester\"]\n[Result \"0-1\"]\n\n1. f3 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58.1]} 2. g4 {[%clk 0:02:57]} 2... Qh4# {[%clk 0:02:55]} 0-1" +
  "\n\n[Event \"Live Chess\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.02\"]\n[White \"sync_tester\"]\n[Black \"first_opp\"]\n[Result \"1-0\"]\n\n" +
  "1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58.1]} 2. Qh5 {[%clk 0:02:57]} 2... Nc6 {[%clk 0:02:55]} 3. Bc4 {[%clk 0:02:56]} 3... Nf6 {[%clk 0:02:50]} 4. Qxf7# {[%clk 0:02:55]} 1-0";

/**
 * A page; `bridge` stubs window.zero. Every chess.fetchGames call is logged in
 * window.__calls and answered with window.__answer; everything else the app
 * asks the bridge gets `true`, as in the other suites.
 */
async function open({ bridge = true, lang = "zh-CN", seedSync = null, mode = "ai", seedSave = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang });
  await ctx.addInitScript(({ bridge, lang, seedSync, mode, seedSave }) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("chess.v1.settings", JSON.stringify({ mode, langId: lang, sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (seedSync) localStorage.setItem("chess.v1.sync", JSON.stringify(seedSync));
      if (seedSave) localStorage.setItem("chess.v1.save", JSON.stringify(seedSave));
    }
    window.__calls = [];
    window.__answer = { error: "offline" };
    // v8-1-plan N1 / T4: an answer can be held back (__delay ms), as the
    // native side's is while the network works, and chess.fetchProgress
    // answers meanwhile with __progress
    window.__delay = 0;
    window.__progress = { busy: false, count: 0 };
    window.__progressAsks = 0;
    window.__answeredAt = 0;
    if (!bridge) return;
    window.zero = {
      invoke: (cmd, payload) => {
        // v8-1-plan N2: the file dialogs are chess.openPgn / chess.saveText now
        if (cmd === "chess.openPgn" || cmd === "chess.saveText") return Promise.resolve({ cancelled: true });
        if (cmd === "chess.fetchProgress") { window.__progressAsks++; return Promise.resolve(window.__progress); }
        if (cmd !== "chess.fetchGames") return Promise.resolve(true);
        window.__calls.push(payload);
        const a = window.__answer;
        const settle = (ok, no) => {
          window.__answeredAt = Date.now();
          if (a === "reject") no(new Error("permission_denied")); else ok(a);
        };
        return new Promise((ok, no) => { if (window.__delay > 0) setTimeout(() => settle(ok, no), window.__delay); else settle(ok, no); });
      },
      on: () => () => {},
      off: () => {},
      platform: { supports: () => Promise.resolve(true) },
      os: { addRecentDocument: () => Promise.resolve(true), clearRecentDocuments: () => Promise.resolve(true),
        showNotification: () => Promise.resolve(true), revealPath: () => Promise.resolve(true) },
      clipboard: { readText: () => Promise.resolve(""), writeText: () => Promise.resolve(true) },
    };
  }, { bridge, lang, seedSync, mode, seedSave });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  return { ctx, page, errs };
}
const toLibrary = async (page) => { await page.click('#rail [data-view="library"]'); await page.waitForTimeout(250); };
const openSync = async (page) => { await page.click("#lib-sync"); await page.waitForSelector("#sync-modal.show", { timeout: 3000 }); };
const dlg = (page) => page.evaluate(() => {
  const m = document.getElementById("sync-modal");
  const on = (id) => { const b = document.getElementById(id); return b ? [...b.children].filter((x) => x.getAttribute("aria-pressed") === "true").map((x) => x.textContent) : []; };
  return m && {
    shown: m.classList.contains("show"),
    title: document.getElementById("sync-title").textContent,
    note: document.getElementById("sync-note").textContent,
    allow: !document.getElementById("sync-allow").hidden,
    go: !document.getElementById("sync-go").disabled,
    user: document.getElementById("sync-user").value,
    site: on("sync-site"),
    focus: document.activeElement && document.activeElement.id,
    text: m.textContent,
    calls: window.__calls.length,
  };
});
/** The library as the app holds it (library-ui.js's e2e view), once C1's chunk is in. */
const libView = async (page) => {
  await page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready, null, { timeout: 5000 }).catch(() => {});
  return page.evaluate(() => { const l = window.__chess.library(); return { names: l.names, games: l.games }; });
};
const stored = (page, key) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || "null"), key);

// --- 1. off by default: the switch says so, and nothing is asked of the shell --
{
  const { ctx, page, errs } = await open();
  const sw0 = await page.evaluate(() => {
    const b = document.getElementById("opt-netsync");
    return b && { pressed: b.getAttribute("aria-pressed"), label: b.getAttribute("aria-labelledby") && document.getElementById(b.getAttribute("aria-labelledby")).textContent };
  });
  assert(sw0 && sw0.pressed === "false" && sw0.label === "允许联网同步", "C2: 偏好设置里有「允许联网同步」，默认关（" + JSON.stringify(sw0) + "）");
  await toLibrary(page);
  await openSync(page);
  let d = await dlg(page);
  assert(d.shown && d.title === "从网站同步" && d.text.includes("Lichess") && d.text.includes("Chess.com"), "C2: 棋谱库的「从网站同步」打开对话框，两个网站可选（" + d.title + "）");
  assert(d.allow && !d.go && d.note.includes("默认关闭"), "C2: 开关关着：同步按钮不可按，给出说明和「允许联网同步」（" + JSON.stringify({ allow: d.allow, go: d.go, note: d.note }) + "）");
  assert(d.focus === "sync-user", "C2: 焦点落在用户名框（" + d.focus + "）");
  assert(JSON.stringify(d.site) === '["Lichess"]', "C2: 默认 Lichess（" + JSON.stringify(d.site) + "）");
  await page.fill("#sync-user", "sync_tester");
  await page.press("#sync-user", "Enter");
  await page.waitForTimeout(200);
  d = await dlg(page);
  assert(d.calls === 0, "C2: 开关关着时回车也不发请求（" + d.calls + " 次）");
  // turning it on here is the explicit act; it is the same stored switch
  await page.click("#sync-allow");
  d = await dlg(page);
  const s1 = await stored(page, "chess.v1.sync");
  assert(!d.allow && d.go && s1 && s1.on === true, "C2: 在对话框里允许之后可以同步，开关存了下来（" + JSON.stringify(s1) + "）");
  assert(d.calls === 0, "C2: 允许本身不发请求");
  assert(errs.length === 0, "off: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 2. each failure has its own line; a bad name never leaves the page ------
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await toLibrary(page);
  await openSync(page);
  await page.fill("#sync-user", "a b");
  await page.click("#sync-go");
  await page.waitForTimeout(150);
  let d = await dlg(page);
  assert(d.calls === 0 && d.note.includes("2 到 30"), "C2: 名字不合规矩：先在页面里拦下，不发请求（" + d.note + "）");
  const say = async (answer) => {
    await page.evaluate((a) => { window.__answer = a; }, answer);
    await page.click("#sync-go");
    await page.waitForFunction(() => !document.getElementById("sync-go").disabled, null, { timeout: 3000 });
    return (await dlg(page)).note;
  };
  await page.fill("#sync-user", "sync_tester");
  const cases = [
    [{ error: "offline" }, "连不上 Lichess"],
    ["reject", "连不上 Lichess"],
    [{ error: "rate_limited" }, "Lichess 暂时限制了请求"],
    [{ error: "not_found" }, "Lichess 上没有用户 sync_tester"],
    [{ error: "http", status: 503 }, "HTTP 503"],
    [{ pgn: "", count: 0 }, "Lichess 上还没有 sync_tester 的对局"],
  ];
  for (const [answer, want] of cases) {
    const note = await say(answer);
    assert(note.includes(want), "C2: " + JSON.stringify(answer) + " → 「" + note + "」");
  }
  d = await dlg(page);
  assert(d.shown, "C2: 出错时对话框留着，可以改了再试");
  const calls = await page.evaluate(() => window.__calls);
  assert(calls.length === cases.length && JSON.stringify(calls[0]) === '{"site":"lichess","user":"sync_tester","max":20}',
    "C2: 发给原生层的只有网站、用户名和局数（" + JSON.stringify(calls[0]) + "）");
  const lib = await stored(page, "chess.v1.library");
  assert(!lib || !lib.games || lib.games.length === 0, "C2: 失败时棋谱库里什么也没多");
  assert(errs.length === 0, "errors: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3. the games land, claimed and queued; the choice survives a reload ------
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await toLibrary(page);
  await openSync(page);
  await page.click('#sync-site [data-v="chesscom"]');
  await page.fill("#sync-user", "Sync_Tester");
  await page.evaluate((pgn) => { window.__answer = { pgn, count: 2 }; }, TWO_GAMES);
  // from the keyboard: Enter in the name field is 同步
  await page.press("#sync-user", "Enter");
  await page.waitForFunction(() => !document.getElementById("sync-modal").classList.contains("show"), null, { timeout: 5000 });
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__calls);
  assert(JSON.stringify(calls) === '[{"site":"chesscom","user":"Sync_Tester","max":20}]', "C2: Chess.com、最近 20 局（" + JSON.stringify(calls) + "）");
  // v8-0-plan C1: the games live in IndexedDB now; chess.v1.library is a header
  const lib = await libView(page);
  const games = (lib && lib.games) || [];
  assert(games.length === 2, "C2: 两局进了棋谱库（" + games.length + "）");
  assert(lib && lib.names.includes("Sync_Tester"), "C2: 名字自动认领（" + JSON.stringify(lib && lib.names) + "）");
  assert(games.every((g) => g.side && g.outcome === "win"), "C2: 两局都认出是你下的（" + JSON.stringify(games.map((g) => [g.side, g.outcome])) + "）");
  assert(games.every((g) => g.an == null), "C2: 两局都在分析队列里（未分析）");
  const ui = await page.evaluate(() => ({
    names: document.getElementById("lib-names").value,
    analyse: (document.getElementById("lib-analyse") || {}).textContent || "",
    toast: [...document.querySelectorAll(".toast")].map((x) => x.textContent).join(" | "),
  }));
  assert(ui.names.includes("Sync_Tester"), "C2: 名字框里也写上了（" + ui.names + "）");
  assert(/2/.test(ui.analyse), "C2: 「分析」按钮数到了这两局（" + ui.analyse + "）");
  // M5 合并（C2 × C1）：同步进来的棋走 C1 的导入 —— 列表上标着来源，进了局面
  // 索引，开局浏览器数得到它们
  const idx = await page.evaluate(() => {
    const c = window.__chess.libDb();
    const at = c && c.gamesWithPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    return at && { total: at.total, moves: at.moves.map((m) => m.san + ":" + m.n).join(" ") };
  });
  assert(idx && idx.total === 2 && idx.moves === "e4:1 f3:1", "C2 × C1: 两局进了局面索引（起始局面 e4、f3 各 1 局）（" + JSON.stringify(idx) + "）");
  await page.click("#lib-open");
  await page.waitForSelector("#lib-list-modal.show", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const tags = await page.evaluate(() => [...document.querySelectorAll("#lib-list button[data-lib] .pick-tag")].map((x) => x.textContent));
  assert(tags.length === 2 && tags.every((x) => x === "Chess.com"), "C2 × C1: 列表上两局都标着 Chess.com（" + JSON.stringify(tags) + "）");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  await page.click("#lib-explorer");
  await page.waitForTimeout(300);
  let xp = [];
  for (let i = 0; i < 60; i++) {
    xp = await page.evaluate(() => [...document.querySelectorAll("#xp-list .xp-row")].map((b) => b.dataset.san + ":" + b.querySelector(".xp-n").textContent));
    if (xp.length === 2) break;
    await page.waitForTimeout(50);
  }
  assert(xp.join(" ") === "e4:1 f3:1", "C2 × C3: 开局浏览器在起始局面数到这两局（" + xp.join(" ") + "）");
  await toLibrary(page);
  // the same sync again adds nothing (the library's ids), and says so
  await openSync(page);
  let d = await dlg(page);
  assert(d.user === "Sync_Tester" && JSON.stringify(d.site) === '["Chess.com"]',
    "C2: 再打开时记得上次的网站和名字（" + JSON.stringify([d.user, d.site]) + "）");
  await page.click("#sync-go");
  await page.waitForFunction(() => !document.getElementById("sync-modal").classList.contains("show"), null, { timeout: 5000 });
  const lib2 = await libView(page);
  assert(lib2.games.length === 2 && lib2.names.filter((n) => n.toLowerCase() === "sync_tester").length === 1,
    "C2: 再同步一次不重复进库、不重复认领（" + lib2.games.length + " 局，" + JSON.stringify(lib2.names) + "）");
  // reload: the switch and the last choice come back
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  const pressed = await page.evaluate(() => document.getElementById("opt-netsync").getAttribute("aria-pressed"));
  assert(pressed === "true", "C2: 重启后开关还开着（" + pressed + "）");
  await toLibrary(page);
  await openSync(page);
  d = await dlg(page);
  assert(d.user === "Sync_Tester" && JSON.stringify(d.site) === '["Chess.com"]', "C2: 重启后对话框记得上次的选择");
  // Escape closes it (the app's one Escape path, dialog.js closeTop)
  await page.keyboard.press("Escape");
  await page.waitForTimeout(150);
  d = await dlg(page);
  assert(!d.shown, "C2: Esc 关掉对话框");
  // …and the preferences switch turns it back off
  await page.click("#prefs-open");
  await page.waitForTimeout(200);
  await page.click("#opt-netsync");
  const s = await stored(page, "chess.v1.sync");
  assert(s.on === false && s.user === "Sync_Tester", "C2: 在偏好设置里关掉，名字留着（" + JSON.stringify(s) + "）");
  assert(errs.length === 0, "success: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3b. what the sites really sent (src/sync-fixtures/, scripts/sync-fixtures.mjs)
// The bridge answers with the text main.zig makes of the real responses:
// Lichess thibault's 5 blitz games, then Chess.com erik's last month — 9
// standard games (8 daily, 1 rapid; its 4 Chess960 games never reach the page).
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await toLibrary(page);
  const syncAs = async (site, user, answer) => {
    await openSync(page);
    await page.click(`#sync-site [data-v="${site}"]`);
    await page.fill("#sync-user", user);
    await page.evaluate((a) => { window.__answer = a; }, answer);
    await page.click("#sync-go");
    await page.waitForFunction(() => !document.getElementById("sync-modal").classList.contains("show"), null, { timeout: 8000 });
    await page.waitForTimeout(400);
  };
  const li = lichessAnswer(), cc = chesscomAnswer();
  await syncAs("lichess", "thibault", li);
  let lib = await libView(page);
  assert(lib.games.length === 5 && lib.names.includes("thibault"), "C2 real: Lichess 的 5 局进库，thibault 认领了（" + lib.games.length + "，" + JSON.stringify(lib.names) + "）");
  await syncAs("chesscom", "erik", cc);
  lib = await libView(page);
  const games = lib.games;
  assert(games.length === 14 && lib.names.includes("thibault") && lib.names.includes("erik"),
    "C2 real: 再加 Chess.com 的 9 局共 14 局，两个名字都认领（" + games.length + "，" + JSON.stringify(lib.names) + "）");
  assert(games.every((g) => (g.side === "w" || g.side === "b") && g.outcome && g.an == null),
    "C2 real: 14 局都认出执哪方、胜负，都在分析队列里（" + JSON.stringify(games.map((g) => [g.side, g.outcome])) + "）");
  assert(games.every((g) => Array.isArray(g.clk) && g.clk.length === g.plies), "C2 real: 每一手的钟都带进了棋谱库");
  const idx = await page.evaluate(() => {
    const at = window.__chess.libDb().gamesWithPosition("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1");
    return at && { total: at.total, moves: at.moves.map((m) => m.san + ":" + m.n).join(" ") };
  });
  assert(idx && idx.total === 14 && idx.moves === "e4:10 d4:4", "C2 real: 局面索引数到 14 局，起始局面 e4 10、d4 4（" + JSON.stringify(idx) + "）");
  await page.click("#lib-open");
  await page.waitForSelector("#lib-list-modal.show", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(300);
  const tags = await page.evaluate(() => [...document.querySelectorAll("#lib-list button[data-lib] .pick-tag")].map((x) => x.textContent));
  const n = (s) => tags.filter((x) => x === s).length;
  assert(tags.length === 14 && n("Lichess") === 5 && n("Chess.com") === 9, "C2 real: 列表上 5 局标 Lichess、9 局标 Chess.com（" + JSON.stringify(tags) + "）");
  await page.keyboard.press("Escape");
  const calls = await page.evaluate(() => window.__calls);
  assert(JSON.stringify(calls) === '[{"site":"lichess","user":"thibault","max":20},{"site":"chesscom","user":"erik","max":20}]',
    "C2 real: 两次请求各带网站、名字、局数（" + JSON.stringify(calls) + "）");
  assert(errs.length === 0, "real: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3c. M5 review P3-2: a pass running — said in the dialog, nothing fetched --
// The import refuses games while the engine is on the library; the sync used
// to fetch them anyway, close the dialog and leave only a toast behind.
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await page.evaluate(() => localStorage.setItem("chess.v1.library", JSON.stringify({ v: 1, names: ["me"], games: [
    { id: "lib:p1", t: 1, white: "me", black: "x", date: "?", event: "", result: "1-0", plies: 2, sans: "e4 e5", fen: "", side: "w", outcome: "win", an: null }] })));
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await toLibrary(page);
  await libView(page);
  // an engine that never answers: the pass stays on its first game
  await page.evaluate(() => {
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = () => new Promise(() => {});
  });
  await page.click("#lib-analyse");
  await page.waitForTimeout(300);
  await openSync(page);
  await page.fill("#sync-user", "sync_tester");
  await page.evaluate((pgn) => { window.__answer = { pgn, count: 2 }; }, TWO_GAMES);
  await page.click("#sync-go");
  await page.waitForTimeout(400);
  const d = await dlg(page);
  assert(d.shown && d.calls === 0 && d.note.includes("引擎正忙"),
    "P3-2: 分析进行中按同步：对话框留着说引擎正忙，不去取棋（" + JSON.stringify({ shown: d.shown, calls: d.calls, note: d.note }) + "）");
  assert(errs.length === 0, "busy: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3c'. 8.1 M2 review P1-1: a pass begun while the games are on their way --
// The import used to turn them away with a toast — and the sync's mark moved
// on regardless, so they were never asked for again. Now they wait for the
// pass, said in the dialog, and go in when it is over; nothing else records
// how far a sync got, so a sync closed before that simply asks again.
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await page.evaluate(() => localStorage.setItem("chess.v1.library", JSON.stringify({ v: 1, names: ["me"], games: [
    { id: "lib:p1", t: 1, white: "me", black: "x", date: "?", event: "", result: "1-0", plies: 2, sans: "e4 e5", fen: "", side: "w", outcome: "win", an: null }] })));
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await toLibrary(page);
  await libView(page);
  // an engine the test lets go of: the pass stays on its first game until then
  await page.evaluate(() => {
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = () => new Promise((ok) => { window.__free = () => ok(null); });
  });
  await openSync(page);
  await page.click('#sync-site [data-v="chesscom"]');
  await page.fill("#sync-user", "Sync_Tester");
  await page.evaluate((pgn) => { window.__answer = { pgn, count: 2 }; window.__delay = 1500; }, TWO_GAMES);
  await page.click("#sync-go");
  await page.waitForTimeout(200);
  // the pass starts while the games are out (its button is under the dialog)
  await page.evaluate(() => document.getElementById("lib-analyse").click());
  await page.waitForFunction(() => window.__answeredAt > 0, null, { timeout: 5000 });
  await page.waitForTimeout(1200);
  let d = await dlg(page);
  let lib = await libView(page);
  assert(d.shown && d.note.includes("引擎正忙") && lib.games.length === 1,
    "P1-1: 应答到时分析在跑：对话框说引擎正忙，棋先等着、还没进库（" + JSON.stringify({ shown: d.shown, note: d.note, games: lib.games.length }) + "）");
  // stop the pass: 暂停, and the engine's search comes back
  await page.evaluate(() => { document.getElementById("lib-analyse").click(); if (window.__free) window.__free(); });
  await page.waitForFunction(() => !document.getElementById("sync-modal").classList.contains("show"), null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(800);
  lib = await libView(page);
  d = await dlg(page);
  assert(!d.shown && lib.games.length === 3 && lib.names.includes("Sync_Tester"),
    "P1-1: 分析一停，两局就进了库，对话框关上（" + JSON.stringify({ shown: d.shown, games: lib.games.length, names: lib.names }) + "）");
  assert(errs.length === 0, "P1-1: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3d. v8-1-plan N1: a sync that takes 8 s leaves the board to the player ---
// The native side answers after its network work, off the shell's loop; the
// page's side of that is one Promise, and nothing on the page may wait on it.
// The bridge holds its answer 8 s. Meanwhile the dialog is closed, the move
// list is scrolled and a move is made on the board — each stamped by the page
// when it happened, and every stamp has to come before the answer's. 8.1 M2
// review P2-4: 8 s rather than the plan's 3, so that a slow CI runner (the
// board's first click alone is a 0.6–1.6 s long task here) has seconds of
// margin, not hundreds of milliseconds.
{
  // a 48-ply game in progress (two players), White to move: the move list overflows
  const moves = "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Nb8 d4 Nbd7 Nbd2 Bb7 Bc2 Re8 Nf1 Bf8 Ng3 g6 a4 c5 d5 c4 Bg5 h6 Be3 Nc5 Qd2 h5 Bg5 Be7 Ra3 Kg7 Rea1 Rh8 Qe2 Qc7 Bd2 Rab8".split(" ");
  const pgn = '[Event "n1"]\n[Result "*"]\n\n' + moves.map((m, i) => (i % 2 ? m : (i / 2 + 1) + ". " + m)).join(" ") + " *";
  const { ctx, page, errs } = await open({ mode: "pvp", seedSync: { v: 1, on: true }, seedSave: { v: 1, pgn, savedAt: Date.now() } });
  const plies = () => page.evaluate(() => document.querySelectorAll("#move-list .mlmove:not(.mlgap)").length);
  const before = await plies();
  assert(before === 48, "N1: 一盘 48 步的对局摆在棋盘上（" + before + "）");
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  await toLibrary(page);
  await openSync(page);
  await page.fill("#sync-user", "sync_tester");
  await page.evaluate(({ pgn, before }) => {
    window.__answer = { pgn, count: 2, last: 1790000000000 };
    window.__delay = 8000;
    // the page's own stamps: the move landing in the list, the list scrolling
    window.__movedAt = 0;
    window.__scrolledAt = 0;
    const list = document.getElementById("move-list");
    new MutationObserver(() => {
      if (!window.__movedAt && list.querySelectorAll(".mlmove:not(.mlgap)").length > before) window.__movedAt = Date.now();
    }).observe(list, { childList: true, subtree: true });
    list.addEventListener("scroll", () => { if (!window.__scrolledAt && list.scrollTop > 0) window.__scrolledAt = Date.now(); });
  }, { pgn: TWO_GAMES, before });
  const t0 = await page.evaluate(() => Date.now());
  await page.click("#sync-go");
  const busyNote = (await dlg(page)).note;
  // straight to the board, no waiting on anything the sync does
  await page.keyboard.press("Escape");
  await page.click('#rail [data-view="play"]');
  await page.evaluate(() => { document.getElementById("move-list").scrollTop = 0; });
  const box = await page.evaluate(() => { const m = document.getElementById("move-list"); const r = m.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, over: m.scrollHeight > m.clientHeight + 20 }; });
  await page.mouse.move(box.x, box.y);
  await page.mouse.wheel(0, 400);
  for (const s of ["b2", "b3"]) { const p = await at(s); await page.mouse.click(p.x, p.y); }
  // …then the answer lands, and is imported
  await page.waitForFunction(() => window.__answeredAt > 0, null, { timeout: 15000 });
  await page.waitForTimeout(600);
  const st = await page.evaluate(() => ({ moved: window.__movedAt, scrolled: window.__scrolledAt, answered: window.__answeredAt }));
  const rel = (x) => (x ? x - t0 : "—");
  assert(busyNote.includes("正在从 Lichess 取棋"), "N1: 按下同步，对话框说正在取棋（" + busyNote + "）");
  assert(await plies() === before + 1 && st.moved > 0 && st.moved < st.answered,
    "N1: 同步进行中在棋盘上走了一步（b3 落进着法列表于 " + rel(st.moved) + " ms，应答于 " + rel(st.answered) + " ms）");
  assert(box.over && st.scrolled > 0 && st.scrolled < st.answered,
    "N1: 同步进行中着法列表滚得动（滚动于 " + rel(st.scrolled) + " ms，应答于 " + rel(st.answered) + " ms）");
  assert(st.answered - t0 >= 7900, "N1: 应答确实晚了 8 秒（" + rel(st.answered) + " ms）");
  const lib = await libView(page);
  assert(lib.games.length === 2, "N1: 8 秒后应答到了，两局照常进库（" + lib.games.length + "）");
  const s = await stored(page, "chess.v1.sync");
  assert(s && !("last" in s), "T4（评审 P2-2）：不再另记「上次」——下次从哪里开始看棋谱库（" + JSON.stringify(s) + "）");
  assert(errs.length === 0, "N1: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 3e. v8-1-plan T4: incremental, how many, analyse after — and they stick ---
{
  const { ctx, page, errs } = await open({ seedSync: { v: 1, on: true } });
  await toLibrary(page);
  await libView(page);
  // an engine that never answers, so a started pass shows (and stays on its first game)
  await page.evaluate(() => {
    window.__analysed = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.analyze = () => { window.__analysed++; return new Promise(() => {}); };
  });
  const syncWith = async (answer, max) => {
    await openSync(page);
    await page.click('#sync-site [data-v="chesscom"]');
    if (max) await page.click(`#sync-max [data-v="${max}"]`);
    await page.fill("#sync-user", "Sync_Tester");
    await page.evaluate((a) => { window.__answer = a; }, answer);
    await page.click("#sync-go");
    await page.waitForFunction(() => !document.getElementById("sync-go").disabled || !document.getElementById("sync-modal").classList.contains("show"), null, { timeout: 5000 });
    await page.waitForTimeout(500);
  };
  let d;
  await openSync(page);
  d = await page.evaluate(() => ({
    max: [...document.querySelectorAll("#sync-max button")].map((b) => b.textContent + (b.getAttribute("aria-pressed") === "true" ? "*" : "")).join(" "),
    analyse: document.getElementById("sync-analyse").getAttribute("aria-pressed"),
    label: document.getElementById("sync-max-k").textContent,
  }));
  assert(d.max === "20* 50 100" && d.analyse === "false" && d.label.includes("最多"), "T4: 局数 20 / 50 / 100，默认 20；同步后分析默认关（" + JSON.stringify(d) + "）");
  await page.keyboard.press("Escape");
  // first sync: no since; 50 chosen. The answer is held 2 s, and the dialog
  // reads 已取到 k 局 off chess.fetchProgress meanwhile, following the count
  await page.evaluate(() => { window.__delay = 2000; window.__progress = { busy: true, count: 2 }; });
  const note = () => page.evaluate(() => document.getElementById("sync-note").textContent);
  const progressSeen = [];
  const watching = (async () => {
    for (let i = 0; i < 60; i++) {
      const n = await note();
      if (!progressSeen.includes(n) && n.includes("已取到")) progressSeen.push(n);
      if (n.includes("已取到 2 局")) await page.evaluate(() => { window.__progress = { busy: true, count: 5 }; });
      await page.waitForTimeout(50);
    }
  })();
  await syncWith({ pgn: TWO_GAMES, count: 2, last: 1790000000000 }, 50);
  await watching;
  assert(JSON.stringify(progressSeen) === '["正在从 Chess.com 取棋…已取到 2 局","正在从 Chess.com 取棋…已取到 5 局"]',
    "T4: 取棋时对话框说「已取到 k 局」，数字跟着原生层走（" + JSON.stringify(progressSeen) + "）");
  const asks = await page.evaluate(() => window.__progressAsks);
  await page.waitForTimeout(900);
  assert(asks > 0 && await page.evaluate(() => window.__progressAsks) === asks, "T4: 应答到了就不再问进度（问过 " + asks + " 次）");
  await page.evaluate(() => { window.__delay = 0; window.__progress = { busy: false, count: 0 }; });
  assert(await page.evaluate(() => window.__analysed) === 0, "T4: 同步后分析关着：进库之后没有开始分析");
  // second: since comes from the library — its newest Chess.com game of this
  // name (2026.09.20, the name in another case is the same account) less 14
  // days, and the one game of theirs already inside that asked for on top
  await syncWith({ pgn: "", count: 0 }, 100);
  d = await dlg(page);
  assert(d.shown && d.note.includes("Chess.com 上没有 Sync_Tester 的新对局"), "T4: 增量同步没有新棋：说「没有新对局」（" + d.note + "）");
  const calls = await page.evaluate(() => window.__calls);
  const since1 = Date.UTC(2026, 8, 20) - 14 * 86400000;
  assert(JSON.stringify(calls) === JSON.stringify([{ site: "chesscom", user: "Sync_Tester", max: 50 }, { site: "chesscom", user: "Sync_Tester", max: 101, since: since1 }]),
    "T4（评审 P2-2/P2-3）: 第二次 since = 库里最新一局那天 − 14 天，局数 = 选的 100 + 重叠里已有的 1（" + JSON.stringify(calls) + "）");
  let s = await stored(page, "chess.v1.sync");
  assert(s.max === 100 && !("last" in s), "T4: 选项存下了，没有另记的记号（" + JSON.stringify(s) + "）");
  // analyse after sync, on; the next sync's new game starts the library's pass
  await page.click("#sync-analyse");
  await page.keyboard.press("Escape");
  const ONE = "[Event \"Live Chess\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.29\"]\n[White \"sync_tester\"]\n[Black \"newer\"]\n[Result \"1-0\"]\n\n1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7# 1-0";
  await syncWith({ pgn: ONE, count: 1, last: 1790100000000 });
  const lib = await libView(page);
  const run = await page.evaluate(() => ({ n: window.__analysed, label: (document.getElementById("lib-analyse") || {}).textContent || "" }));
  assert(lib.games.length === 3 && run.n > 0 && run.label.includes("暂停"), "T4: 同步后分析开着：新的一局进库后，棋谱库的批量分析开始了（" + JSON.stringify({ games: lib.games.length, run }) + "）");
  s = await stored(page, "chess.v1.sync");
  const calls3 = await page.evaluate(() => window.__calls);
  assert(s.analyse === true && calls3[2].since === since1 && calls3[2].max === 101,
    "T4: 开关存下了；第三次仍从库里推（since 不变，100 + 1）（" + JSON.stringify({ s, call: calls3[2] }) + "）");

  // a reload: the choices come back
  await page.reload();
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
  await toLibrary(page);
  await openSync(page);
  d = await page.evaluate(() => ({
    max: [...document.querySelectorAll("#sync-max button")].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent).join(),
    analyse: document.getElementById("sync-analyse").getAttribute("aria-pressed"),
  }));
  assert(d.max === "100" && d.analyse === "true", "T4: 重启后记得最多 100 局、同步后分析开着（" + JSON.stringify(d) + "）");
  await page.keyboard.press("Escape");
  // the new game (2026.09.29) is in the library now: after the restart the
  // next sync starts from it — nothing but the library says how far it got
  await syncWith({ pgn: "", count: 0 });
  const calls4 = await page.evaluate(() => window.__calls);
  assert(calls4.length === 1 && calls4[0].since === Date.UTC(2026, 8, 29) - 14 * 86400000 && calls4[0].max === 102,
    "T4（评审 P2-2）: 新的一局进库后（重启之后），since 跟着库走到它那天 − 14 天，100 + 重叠里已有的 2（" + JSON.stringify(calls4) + "）");
  assert(errs.length === 0, "T4: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 4. no bridge (a browser): it says so and asks nothing ---------------------
{
  const { ctx, page, errs } = await open({ bridge: false, seedSync: { v: 1, on: true } });
  await toLibrary(page);
  await openSync(page);
  const d = await dlg(page);
  assert(!d.go && !d.allow && d.note.includes("桌面应用"), "C2: 浏览器里：说只在桌面应用可用，按钮不可按（" + d.note + "）");
  assert(errs.length === 0, "no bridge: 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

// --- 5. the other two languages: no Chinese left in the dialog ----------------
for (const lang of ["en", "ja"]) {
  const { ctx, page, errs } = await open({ lang, seedSync: { v: 1, on: false } });
  await page.waitForTimeout(400);
  await toLibrary(page);
  await openSync(page);
  const d = await dlg(page);
  const han = (d.text.match(/[一-鿿]/g) || []).join("");
  // Japanese uses kanji; what must not appear is a Chinese-only string
  const leak = lang === "en" ? han : (d.text.includes("联网") || d.text.includes("用户名") ? "zh" : "");
  assert(!leak, lang + ": 对话框里没有中文（" + leak + "）");
  // words only: the switch (T4's 同步后分析) has none, and its hit area
  // reaches past its box on purpose (styles.css .switch::after)
  const cut = await page.evaluate(() => [...document.querySelectorAll("#sync-modal button, #sync-modal .setting-k")]
    .filter((b) => b.offsetParent && b.textContent.trim() && b.scrollWidth > b.clientWidth + 1).map((b) => b.textContent));
  assert(cut.length === 0, lang + ": 按钮和标签的字没有被截断（" + cut.join(" / ") + "）");
  // …and T4's words are there, in this language
  const t4 = await page.evaluate(() => ({ limit: document.getElementById("sync-max-k").textContent, an: document.getElementById("sync-analyse-k").textContent }));
  const want = lang === "en" ? ["New games since last time, at most", "Analyse the games after syncing"] : ["前回以降の新しい対局（最大）", "同期したら解析を始める"];
  assert(t4.limit === want[0] && t4.an === want[1], lang + ": T4 的两个选项说的是这种语言（" + JSON.stringify(t4) + "）");
  assert(errs.length === 0, lang + ": 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
