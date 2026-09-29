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
async function open({ bridge = true, lang = "zh-CN", seedSync = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: lang });
  await ctx.addInitScript(({ bridge, lang, seedSync }) => {
    if (!sessionStorage.getItem("seeded")) {
      sessionStorage.setItem("seeded", "1");
      localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "ai", langId: lang, sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (seedSync) localStorage.setItem("chess.v1.sync", JSON.stringify(seedSync));
    }
    window.__calls = [];
    window.__answer = { error: "offline" };
    if (!bridge) return;
    window.zero = {
      invoke: (cmd, payload) => {
        // v8-1-plan N2: the file dialogs are chess.openPgn / chess.saveText now
        if (cmd === "chess.openPgn" || cmd === "chess.saveText") return Promise.resolve({ cancelled: true });
        if (cmd !== "chess.fetchGames") return Promise.resolve(true);
        window.__calls.push(payload);
        const a = window.__answer;
        return a === "reject" ? Promise.reject(new Error("permission_denied")) : Promise.resolve(a);
      },
      on: () => () => {},
      off: () => {},
      platform: { supports: () => Promise.resolve(true) },
      os: { addRecentDocument: () => Promise.resolve(true), clearRecentDocuments: () => Promise.resolve(true),
        showNotification: () => Promise.resolve(true), revealPath: () => Promise.resolve(true) },
      clipboard: { readText: () => Promise.resolve(""), writeText: () => Promise.resolve(true) },
    };
  }, { bridge, lang, seedSync });
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
  const fits = await page.evaluate(() => [...document.querySelectorAll("#sync-modal button, #sync-modal .setting-k")]
    .filter((b) => b.offsetParent).every((b) => b.scrollWidth <= b.clientWidth + 1));
  assert(fits, lang + ": 按钮和标签的字没有被截断");
  assert(errs.length === 0, lang + ": 没有页面异常 " + errs.join(" / "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " failed"); process.exit(1); }
console.log("all passed");
