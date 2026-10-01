/**
 * 你的开局书（v8-1-plan T3）的浏览器检查。
 *
 * rep-book.js 的算术（换序合并、排期、PGN 往返、迁移、反推）由
 * scripts/test-rep-book.mjs 在 Node 里核对；这里证明的是它接到了应用上：
 *
 *   1. 8.0 形状的老开局书在真的 IndexedDB 里迁移：线一字不动，按局面的记录
 *      写进它自己的数据库 chessboard.repertoire（棋谱库的 chessboard.library
 *      留在版本 1，8.0 照常打开），原值备份，背过的线带着进度；
 *      重启之后照原样读回。
 *   2. 开局浏览器的「我的」与开局书的记录逐局面逐着一致，和「书」分开标；
 *      执白 / 执黑两本书切换。
 *   3. 在开局浏览器里加一着、拿掉一着（鼠标和键盘），「加进开局书」加上棋盘上
 *      走到这里的着法；读屏读得到按下与否。
 *   4. 复习到期的着：只出到期的局面，答对就排到以后，答错留着；重启后排期还在。
 *   5. 棋谱库反推：「你常走 X，开局书写的是 Y」。
 *   6. 导出 PGN（带变着）再导进一个空档案，逐节点相等。
 *   7. 英文、日文：新文字都在、不截断。
 *   v8-2-plan T4（线搬进新的数据库 chessboard.replines；chessboard.repertoire 不升版本）：
 *   8. 2,000 条线导入、复习、导出 PGN 再导回逐节点相等；重启读回；8.1 照常
 *      打开开局书的库、头上的 400 条副本；8.1 改过书之后回来；导出 /
 *      导入全部数据带着线。
 *   9. 8.1 的档案（头上的线 + 版本 1 的数据库）升上来，什么都不丢。
 *  10. 没有 IndexedDB：整本书写在头上（lf）；IndexedDB 回来再搬进去；又没有
 *      了、也没有本机分片：只用副本、不写，改动叠回去。
 *  11. 原生菜单「开局书」：从哪一页都到这一节；对话框开着不动；快捷键表。
 *  12. 「今天到期」每分钟核一次、过午夜也变；窗口看不见时不核（page.clock）。
 *
 * 引擎是桩。需要 playwright-core 与浏览器（scripts/e2e-browser.mjs）：
 *   node scripts/test-repertoire-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { compileModuleSync } from "./bundle.mjs";

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
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok  ", msg);
  else { failed++; console.error("FAIL", msg, extra != null ? " " + extra : ""); }
};

// chess.js, the key and the ids, in Node: what the page must agree with
const nctx = { console, Date, Math, JSON };
nctx.globalThis = nctx; nctx.window = nctx;
vm.createContext(nctx);
for (const f of ["chess.js", "fide.js", "drills.js", "repertoire.js", "rep-book.js", "rep-lines.js"]) vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), nctx, { filename: f });
/** The book `{w, b}` out of the "lines" store's rows (v8-2-plan T4). */
const bookOfRows = (rows) => nctx.ChessRepLines.bookOf(rows || []);
const keyAfter = (sans) => { const g = new nctx.Chess(); for (const s of sans) g.move(s); return nctx.ChessFide.positionKey(g.fen(), g); };
const line = (sans, eco, name) => ({ id: "rep-" + nctx.ChessDrills.hash36(sans), sans, eco: eco || "", name: name || "" });

const browser = await launchBrowser();
console.log("引擎:", ENGINE);

/** An 8.0 book: two White lines that transpose into each other, one Black line. */
const BOOK80 = { v: 1,
  w: [line("e4 e5 Nf3 Nc6 Bb5 a6", "C68", "Ruy Lopez"), line("Nf3 Nc6 e4 e5 Bc4", "C50", "Italian Game")],
  b: [line("d4 Nf6 c4 e6", "E00", "Indian Defense")] };
/** Four games you played as White: three times Nc3 where the book says Bb5 / Bc4. */
const GAMES = [
  ["e4 e5 Nf3 Nc6 Nc3 Bc5", "1-0"], ["e4 e5 Nf3 Nc6 Nc3 Nf6", "0-1"], ["e4 e5 Nf3 Nc6 Nc3 Bb4", "1-0"], ["e4 e5 Nf3 Nc6 Bb5 a6", "1/2-1/2"],
].map(([sans, result], i) => ({ id: "lib:r" + i, t: 1758000000000 - i, white: "me", black: "x" + i, date: "", event: "",
  result, plies: sans.split(" ").length, sans, fen: "", side: "w", outcome: result === "1-0" ? "win" : result === "0-1" ? "loss" : "draw", an: null }));

async function context(opts) {
  const o = Object.assign({ lang: "zh-CN", view: "play", book: BOOK80, games: null, solved: {}, width: 1400, height: 1000, explorer: { open: true } }, opts);
  const ctx = await browser.newContext({ viewport: { width: o.width, height: o.height }, locale: o.lang, acceptDownloads: true });
  await ctx.addInitScript((o) => {
    if (sessionStorage.getItem("seeded")) return; // a reload keeps what the app saved
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "pvp", langId: o.lang, sideTab: "play", view: o.view, soundOn: false, themeId: "wood", explorer: o.explorer }));
    localStorage.setItem("chess.panelOpen", "1");
    if (o.book) localStorage.setItem("chess.v1.repertoire", JSON.stringify(o.book));
    localStorage.setItem("chess.v1.puzzles", JSON.stringify({ v: 1, idv: 2, solved: o.solved, missed: {}, cat: "m1" }));
    if (o.games) localStorage.setItem("chess.v1.library", JSON.stringify({ v: 1, games: o.games, names: ["me"], claimAsked: true }));
  }, o);
  return ctx;
}

async function open(ctx, page0) {
  const page = page0 || await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await ready(page);
  await page.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  return { page, errs };
}
/** Until chunk-rep.js has booted (after the library's chunk). */
async function ready(page) {
  await page.waitForFunction(() => window.__chess && window.__chess.rep && window.__chess.rep(), null, { timeout: 20000 }).catch(() => {});
  await page.waitForTimeout(200);
}

/** The records as the page holds them: {id: "san>to,…"} and the cards. */
const records = (page) => page.evaluate(() => {
  const out = {};
  const all = [...window.__chess.rep().records()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  for (const [id, r] of all) out[id] = { moves: r.moves.map((m) => m.san), card: r.card || null, path: r.path };
  return out;
});
/**
 * The records as IndexedDB holds them (their own database, store "repertoire"); `lib`: the library's version.
 * v8-2-plan T4: `lines` / `cards` from chessboard.replines, `linesVersion` its version (null: not there).
 */
const idbRecords = (page) => page.evaluate(async () => {
  const libVersion = () => new Promise((r) => { const q = indexedDB.open("chessboard.library"); q.onsuccess = () => { const v = q.result.version; q.result.close(); r(v); }; q.onerror = () => r(null); });
  // opened without a version only when it exists: an open would create an empty one
  const replines = async () => {
    const dbs = await indexedDB.databases();
    if (!dbs.some((x) => x.name === "chessboard.replines")) return { linesVersion: null, lines: null, cards: null };
    return new Promise((resolve) => {
      const q = indexedDB.open("chessboard.replines");
      q.onsuccess = () => {
        const db = q.result;
        const tx = db.transaction(["lines", "cards"], "readonly");
        const lines = tx.objectStore("lines").getAll(), cards = tx.objectStore("cards").getAll();
        tx.oncomplete = () => { db.close(); resolve({ linesVersion: db.version, lines: lines.result, cards: cards.result }); };
      };
      q.onerror = () => resolve({ linesVersion: null, lines: null, cards: null });
    });
  };
  const out = await new Promise((resolve) => {
    const req = indexedDB.open("chessboard.repertoire");
    req.onsuccess = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("repertoire")) { resolve({ version: db.version, rows: null, stores: [...db.objectStoreNames] }); db.close(); return; }
      const tx = db.transaction(["repertoire", "meta"], "readonly");
      const all = tx.objectStore("repertoire").getAll();
      const keys = tx.objectStore("meta").getAllKeys();
      tx.oncomplete = () => { const o = { version: db.version, rows: all.result, meta: keys.result.map(String), stores: [...db.objectStoreNames] }; db.close(); resolve(o); };
    };
    req.onerror = () => resolve(null);
  });
  if (!out) return null;
  return Object.assign(out, await replines(), { lib: await libVersion() });
});
const header = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.repertoire") || "null"));

/** The explorer's rows: move, 书, 我的, and the toggle beside it. */
const xpRows = (page) => page.evaluate(() => [...document.querySelectorAll("#xp-list > li")].map((li) => {
  const b = li.querySelector(".xp-row"), tg = li.querySelector(".xp-tog");
  return { san: b.dataset.san, book: !!b.querySelector(".xp-book"), mine: !!b.querySelector(".xp-mine"), label: b.getAttribute("aria-label"),
    pressed: tg ? tg.getAttribute("aria-pressed") : null, tlabel: tg ? tg.getAttribute("aria-label") : null };
}));
const waitFor = async (page, fn, pred, ms = 3000) => {
  let r = null;
  for (let i = 0; i < ms / 50; i++) { r = await fn(page); if (pred(r)) return r; await page.waitForTimeout(50); }
  return r;
};

/** Click on the board: a square's centre (`flip`: Black at the bottom — the trainer's Black drills). */
async function tapAt(page, sq, flip) {
  const p = await page.evaluate(([x, flip]) => {
    const cv = document.getElementById("board"), r = cv.getBoundingClientRect();
    const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
    const co = flip ? 7 - f : f, ro = flip ? 7 - rk : rk, z = r.width / 8;
    return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
  }, [sq, !!flip]);
  await page.mouse.click(p.x, p.y);
  await page.waitForTimeout(200);
}
/** Play a move by clicking the explorer's row for it. */
async function playRow(page, san) {
  await page.click(`#xp-list .xp-row[data-san="${san}"]`);
  await page.waitForTimeout(250);
}

// --- 1. 8.0 的老开局书迁进 IndexedDB -------------------------------------------
let migratedRecords = null;
{
  const ctx = await context({ solved: { [BOOK80.w[0].id]: true } });
  const { page, errs } = await open(ctx);
  const h = await header(page);
  assert(h && h.db === 2 && h.n > 0 && typeof h.sig === "string", "头上多了 db 2、记录数和签名", JSON.stringify(h && { db: h.db, n: h.n, sig: h.sig }));
  assert(JSON.stringify(h.w) === JSON.stringify(BOOK80.w) && JSON.stringify(h.b) === JSON.stringify(BOOK80.b),
    "线一字不动：7.2–8.0 照读，按线练的进度照挂");
  const idb = await idbRecords(page);
  assert(idb && idb.version === 1 && idb.stores.join() === "meta,repertoire" && Array.isArray(idb.rows) && idb.rows.length === h.n,
    `开局书自己的数据库 chessboard.repertoire（版本 1，两张表——v8-2-plan T4 不升版本，8.1 照常打开），repertoire 表里 ${idb && idb.rows && idb.rows.length} 条，与头上的数一致`, JSON.stringify(idb && { v: idb.version, stores: idb.stores, n: idb.rows && idb.rows.length }));
  assert(idb.lines && JSON.stringify(bookOfRows(idb.lines)) === JSON.stringify({ w: BOOK80.w, b: BOOK80.b }) && h.ln === 3,
    "v8-2-plan T4：线进了 chessboard.replines 的 lines 表，一条不少、先后不变；头上 ln 3", JSON.stringify({ ln: h.ln, lines: idb.lines && idb.lines.length }));
  assert(idb.linesVersion === 1 && idb.cards.length === Object.values(await records(page)).filter((r) => r.card).length,
    "……卡片的副本也在那里，一张不少（8.1 降级时看不到的局面靠它找回）", JSON.stringify({ v: idb.linesVersion, cards: idb.cards && idb.cards.length }));
  assert(idb.lib === 1, "M3 评审：棋谱库的数据库还是版本 1——8.0 打开它不会 VersionError", String(idb.lib));
  assert(idb.meta.some((k) => k.startsWith("rep-v1:")), "迁移前的原值备份在 meta 表里", JSON.stringify(idb.meta));
  const recs = await records(page);
  migratedRecords = recs;
  const at = recs["w|" + keyAfter(["e4", "e5", "Nf3", "Nc6"])];
  assert(at && at.moves.join() === "Bb5,Bc4", "两条换序的线在同一局面合并：Bb5、Bc4", JSON.stringify(at));
  // 背下来的那条线上的卡从第一级开始（一天后到期），没背过的是新卡
  const onL1 = ["", "e4 e5", "e4 e5 Nf3 Nc6"].map((p) => recs["w|" + keyAfter(p ? p.split(" ") : [])]);
  assert(onL1.every((r) => r && r.card && r.card.s === 1), "背过的线（8.0 的 solved）带着进度成了卡片", JSON.stringify(onL1.map((r) => r && r.card)));
  const black = recs["b|" + keyAfter(["d4"])];
  assert(black && black.card && black.card.s === 0 && black.moves.join() === "Nf6", "执黑那本：对方走 d4 之后是我的一张新卡");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  // 重启：头对得上，直接用存着的记录
  await page.reload();
  await ready(page);
  const again = await records(page);
  assert(JSON.stringify(again) === JSON.stringify(recs), "重启后按局面的记录与卡片原样读回");
  await ctx.close();
}

// --- 2 / 3. 开局浏览器：「我的」逐着一致；加一着、拿掉一着 ------------------------
{
  const ctx = await context({});
  const { page, errs } = await open(ctx);
  // 执白那本：沿 1. e4 e5 2. Nf3 Nc6 每一步核对「我的」
  const path = [];
  const checkMarks = async (side) => {
    const recs = await records(page);
    const want = (recs[side + "|" + keyAfter(path)] || { moves: [] }).moves.slice().sort().join();
    const rows = await waitFor(page, xpRows, (r) => r.length > 0);
    const got = rows.filter((r) => r.mine).map((r) => r.san).sort().join();
    const toggles = rows.filter((r) => r.pressed === "true").map((r) => r.san).sort().join();
    return { want, got, toggles, rows };
  };
  let bad = [];
  for (const san of ["e4", "e5", "Nf3", "Nc6", null]) {
    const m = await checkMarks("w");
    if (m.want !== m.got || m.want !== m.toggles) bad.push(path.join(" ") + ": " + m.want + " / " + m.got + " / " + m.toggles);
    if (san) { await playRow(page, san); path.push(san); }
  }
  assert(!bad.length, "沿主线五个局面，「我的」与按下的开关都等于开局书在这个局面的着法", bad.join(" | "));
  let rows = await xpRows(page);
  const bb5 = rows.find((r) => r.san === "Bb5");
  assert(bb5 && bb5.mine && bb5.book, "Bb5 既标「书」也标「我的」");
  assert(rows.some((r) => r.book && !r.mine) || rows.every((r) => r.mine), "「书」和「我的」是两种标记，各标各的", JSON.stringify(rows.map((r) => [r.san, r.book, r.mine])));
  assert(/我的/.test(bb5.label) && bb5.tlabel === "Bb5 · 我的开局书（执白）", "读屏：行读出「我的」，开关读出着法与哪一本书", bb5.label + " | " + bb5.tlabel);
  // 执黑那本：同一局面，黑方书里没有这些
  await page.click('#xp-rep button[data-side="b"]');
  await page.waitForTimeout(200);
  rows = await xpRows(page);
  assert(rows.every((r) => !r.mine && r.pressed === "false"), "切到执黑那本：这个局面它一着也没有");
  assert(await page.getAttribute('#xp-rep button[data-side="b"]', "aria-pressed") === "true", "执黑按下，aria-pressed 跟着变");
  await page.click('#xp-rep button[data-side="w"]');
  await page.waitForTimeout(200);

  // 鼠标：在 2... Nc6 之后把 d4 加进执白书
  const before = (await header(page)).w.length;
  await page.click('#xp-list .xp-tog[data-san="d4"]').catch(async () => {
    // d4 may have no game and no book entry here: no row, so the board adds it instead
  });
  await page.waitForTimeout(300);
  rows = await xpRows(page);
  let d4 = rows.find((r) => r.san === "d4");
  const h1 = await header(page);
  let recs = await records(page);
  assert(d4 && d4.mine && d4.pressed === "true" && h1.w.length === before + 1 && recs["w|" + keyAfter(path)].moves.includes("d4"),
    "点开关：d4 进了执白书（线多一条，这个局面的记录多一着，行上标「我的」）", JSON.stringify({ d4, n: h1.w.length }));
  const idb1 = await idbRecords(page);
  assert(idb1.rows.find((r) => r.id === "w|" + keyAfter(path)).moves.some((m) => m.san === "d4"), "……IndexedDB 里的记录也有了 d4");
  // 键盘：Tab 到 d4 的开关，空格拿掉；焦点留在同一个开关上
  await page.focus('#xp-list .xp-tog[data-san="d4"]');
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  const focus = await page.evaluate(() => ({ cls: document.activeElement.className, san: document.activeElement.dataset.san, pressed: document.activeElement.getAttribute("aria-pressed") }));
  recs = await records(page);
  assert(!recs["w|" + keyAfter(path)].moves.includes("d4") && (await header(page)).w.length === before,
    "键盘空格：d4 从书里拿掉，线回到原来的条数");
  assert(focus.cls === "xp-tog" && focus.san === "d4" && focus.pressed === "false", "焦点留在同一着的开关上，读屏读到「未按下」", JSON.stringify(focus));
  // 拿掉一着是按局面拿：Bc4 经两种着法顺序都到这里，拿掉之后两条线都不再有它
  await page.click('#xp-list .xp-tog[data-san="Bc4"]');
  await page.waitForTimeout(300);
  const h2 = await header(page);
  assert(h2.w.every((l) => !/Bc4/.test(l.sans)) && h2.w.some((l) => l.sans === "Nf3 Nc6 e4 e5"),
    "拿掉 Bc4：另一种着法顺序的那条线截在它之前，其余的线不动", JSON.stringify(h2.w.map((l) => l.sans)));
  assert(h2.w.find((l) => l.sans === "e4 e5 Nf3 Nc6 Bb5 a6").id === BOOK80.w[0].id, "没经过 Bc4 的线 id 不变");
  // 「加进开局书」：棋盘上走到这里的着法整条加进去
  await playRow(page, "Bb5");
  await playRow(page, "a6");
  await tapAt(page, "b5"); await tapAt(page, "a4");
  await page.waitForTimeout(300);
  await page.click("#xp-add");
  await page.waitForTimeout(300);
  const h3 = await header(page);
  assert(h3.w.some((l) => l.sans === "e4 e5 Nf3 Nc6 Bb5 a6 Ba4"), "「加进开局书」把棋盘上走到这里的七手加进执白书", JSON.stringify(h3.w.map((l) => l.sans)));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  // 重启：加的、拿的都还在
  await page.reload();
  await ready(page);
  const h4 = await header(page);
  assert(JSON.stringify(h4.w) === JSON.stringify(h3.w) && h4.db === 2, "重启之后书还是这样");
  await ctx.close();
}

// --- 3b. 一下拿掉整条线要先问；每次拿掉都能撤销（M3 评审 P2-2） ----------------------
{
  const ctx = await context({ solved: { [BOOK80.w[0].id]: true } });
  const { page, errs } = await open(ctx);
  const recs0 = await records(page);
  const h0 = await header(page);
  const modalShown = () => page.evaluate(() => { const m = document.getElementById("confirm-modal"); return !!m && !m.hidden && getComputedStyle(m).display !== "none"; });
  // 起始局面点 e4 的 ✓：Ruy Lopez 那条整条没了——先问
  await waitFor(page, xpRows, (r) => r.some((x) => x.san === "e4" && x.pressed === "true"));
  await page.click('#xp-list .xp-tog[data-san="e4"]');
  await page.waitForTimeout(300);
  assert(await modalShown(), "起始局面拿掉 e4：先弹确认框");
  const ask = await page.textContent("#confirm-message");
  assert(/e4/.test(ask) && /1 条线会截短，其中 1 条整条删掉/.test(ask), "确认框说出拿掉哪一着、几条线受影响、几条整条删掉", ask);
  await page.click("#confirm-cancel");
  await page.waitForTimeout(300);
  assert(JSON.stringify((await header(page)).w) === JSON.stringify(h0.w), "取消：书一着不动");
  // 键盘：Tab 到开关、空格，确认框里回车
  await page.focus('#xp-list .xp-tog[data-san="e4"]');
  await page.keyboard.press("Space");
  await page.waitForTimeout(300);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(400);
  const h1 = await header(page);
  const st1 = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  assert(h1.w.map((l) => l.sans).join() === "Nf3 Nc6 e4 e5 Bc4" && !st1.solved[BOOK80.w[0].id],
    "确认后：从起始局面走 e4 的线整条删掉（换序那条不经过这一着，不动），背过的进度跟着走", JSON.stringify({ w: h1.w.map((l) => l.sans), solved: Object.keys(st1.solved) }));
  const undo = await page.evaluate(() => { const b = document.querySelector("#toast.show .toast-action"); return b ? b.textContent : null; });
  assert(undo === "撤销", "提示里有「撤销」按钮", String(undo));
  // 键盘也能撤销：焦点给到提示里的按钮、回车
  await page.focus("#toast .toast-action");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(500);
  const h2 = await header(page);
  const st2 = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.puzzles")));
  const recs2 = await records(page);
  assert(JSON.stringify(h2.w) === JSON.stringify(h0.w) && st2.solved[BOOK80.w[0].id],
    "撤销：线原样回来（id 不变），按线练的进度也回来", JSON.stringify(h2.w.map((l) => l.sans)));
  assert(JSON.stringify(recs2) === JSON.stringify(recs0), "撤销：按局面的记录和卡片一张不差");
  const e4 = (await waitFor(page, xpRows, (r) => r.some((x) => x.san === "e4" && x.pressed === "true"))).find((x) => x.san === "e4");
  assert(e4 && e4.pressed === "true", "撤销之后开关又是按下的");
  // 只截短一条线：不问，直接拿掉，照样能撤销
  for (const san of ["e4", "e5", "Nf3", "Nc6"]) await playRow(page, san);
  await page.click('#xp-list .xp-tog[data-san="Bc4"]');
  await page.waitForTimeout(300);
  assert(!(await modalShown()), "截短一条线不弹确认框");
  assert(!(await header(page)).w.some((l) => /Bc4/.test(l.sans)), "……Bc4 拿掉了");
  await page.click("#toast .toast-action");
  await page.waitForTimeout(400);
  assert(JSON.stringify((await header(page)).w) === JSON.stringify(h0.w), "点「撤销」：Bc4 回来");
  // 执黑那本不留只有白方一着的「线」：起始局面给执黑书加 e4 被拒
  await page.click('#xp-rep button[data-side="b"]');
  await page.waitForTimeout(200);
  await page.reload();
  await ready(page);
  const hb = (await header(page)).b.length;
  await page.click('#xp-list .xp-tog[data-san="e4"]').catch(() => {});
  await page.waitForTimeout(300);
  assert((await header(page)).b.length === hb, "执黑的书不收只有 1. e4 的一条线");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 3c. 分块还在启动时改了书：头不替旧的记录担保（M3 评审 P2-3） -----------------------
{
  const ctx = await context({});
  // 迁移写完后读回 repertoire 表（第二次 getAll）晚 2.5 秒回来——启动已经按
  // 那时的线建好了记录、还在等：这段时间里在浏览器里加一着
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("slowRep")) return;
    sessionStorage.setItem("slowRep", "1");
    const orig = IDBObjectStore.prototype.getAll;
    let n = 0;
    IDBObjectStore.prototype.getAll = function (...a) {
      const req = orig.apply(this, a);
      if (this.name !== "repertoire" || ++n !== 2) return req;
      const late = { result: undefined, error: null, onsuccess: null, onerror: null };
      req.onsuccess = () => setTimeout(() => { late.result = req.result; if (late.onsuccess) late.onsuccess(); }, 2500);
      req.onerror = () => { late.error = req.error; if (late.onerror) late.onerror(); };
      return late;
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  await page.waitForSelector('#xp-list .xp-row[data-san="d4"]', { timeout: 10000 });
  const early = await page.evaluate(() => !(window.__chess && window.__chess.rep && window.__chess.rep()));
  await playRow(page, "d4");
  await page.click("#xp-add");
  await page.waitForTimeout(200);
  assert(early && (await header(page)).w.some((l) => l.sans === "d4"), "分块到之前：d4 进了执白书的线");
  await ready(page);
  const start = keyAfter([]);
  let recs = await records(page);
  assert(recs["w|" + start] && recs["w|" + start].moves.includes("d4"), "分块到了：按局面的记录也有 d4（启动时的编辑重新索引了）", JSON.stringify(recs["w|" + start]));
  // 下次启动：头对得上的就是记录本身
  await page.reload();
  await ready(page);
  recs = await records(page);
  const h = await header(page);
  assert(recs["w|" + start] && recs["w|" + start].moves.includes("d4") && Object.keys(recs).length === h.n,
    "重启：记录里有 d4，条数与头上一致", JSON.stringify({ n: h.n, recs: Object.keys(recs).length }));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 4. 复习到期的着 ---------------------------------------------------------
{
  const ctx = await context({ view: "library" });
  const { page, errs } = await open(ctx);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(300);
  const total = Object.values(migratedRecords).filter((r) => r.card).length;
  const dueText = await page.textContent("#rep-due-n");
  assert(new RegExp("^" + total + " 着$").test(dueText.trim()), `记录页：今天到期 ${total} 着（全是新卡）`, dueText);
  assert(await page.isVisible("#rep-due"), "「复习到期的着」按钮出来了");
  await page.click("#rep-due");
  await page.waitForTimeout(700);
  const st = await page.evaluate(() => ({
    cat: JSON.parse(localStorage.getItem("chess.v1.puzzles")).cat,
    task: document.getElementById("puzzle-task").textContent, prog: document.getElementById("puzzle-progress").textContent,
    tab: document.querySelector('#puzzle-cat-seg button[data-cat="rep"]').classList.contains("active"),
    p: window.__chess.rep().dueDrills()[0],
  }));
  assert(st.cat === "repdue" && st.tab && /还有 \d+ 着/.test(st.prog), "进了做题页的「开局书」，只练到期的着", JSON.stringify({ cat: st.cat, prog: st.prog }));
  assert(/这里你的开局书走哪一着/.test(st.task), "题面：这里你的开局书走哪一着", st.task);
  // 第一张是起始局面（最浅的先问）：执白走 e4 或 Nf3 都对
  assert(st.p.pre.length === 0 && st.p.answers.join() === "e4,Nf3", "最浅的局面先问：起始局面，书里 e4、Nf3 都算", JSON.stringify(st.p));
  const recBefore = await records(page);
  await tapAt(page, "e2"); await tapAt(page, "e4");
  await page.waitForTimeout(400);
  const fb = await page.textContent("#puzzle-feedback");
  let recs = await records(page);
  const start = recs["w|" + keyAfter([])];
  assert(start.card.s === 1 && start.card.ivl === 1 && start.card.due > Date.now() + 23 * 3600e3, "答对：这张卡上一级、一天后到期", JSON.stringify(start.card));
  assert(fb.trim().length > 0, "反馈卡说对了", fb.trim());
  const dueNow = await page.evaluate(() => window.__chess.rep().dueCount());
  assert(dueNow === total - 1, `答对的那张离开到期列表：${total} → ${dueNow}`);
  // 下一题：另一张到期的卡，前面的着法替你走好了
  await page.click("#puzzle-next");
  await page.waitForTimeout(500);
  // the card on the board, from its position: side to move and key
  const fen = await page.evaluate(() => window.__chess.puzzle());
  const g2 = new nctx.Chess(fen);
  const p2 = { card: g2.turn() + "|" + nctx.ChessFide.positionKey(fen, g2) };
  p2.answers = (await records(page))[p2.card].moves;
  const hist = await page.evaluate(() => document.getElementById("puzzle-progress").textContent);
  assert(g2.history().length === 0 && fen !== new nctx.Chess().fen() && /还有 \d+ 着/.test(hist), "下一张到期的卡：走到它的着法已经在棋盘上", fen);
  // 答错：一步不在书里的棋 —— 这张卡回到最底一级、立刻到期，并告诉你书上走什么
  const wm = g2.moves({ verbose: true }).find((m) => !p2.answers.includes(m.san) && m.piece === "p");
  const wrongSq = [wm.from, wm.to];
  await tapAt(page, wrongSq[0], g2.turn() === "b"); await tapAt(page, wrongSq[1], g2.turn() === "b");
  await page.waitForTimeout(400);
  const fb2 = await page.textContent("#puzzle-feedback");
  recs = await records(page);
  const c2 = recs[p2.card].card;
  assert(c2.s === 0 && c2.n >= 1 && c2.due <= Date.now(), "答错：连对归零、仍然到期", JSON.stringify(c2));
  assert(p2.answers.some((a) => fb2.includes(a)), "反馈卡说出书上的着法", fb2.trim());
  const missed = await page.evaluate(() => Object.keys(JSON.parse(localStorage.getItem("chess.v1.puzzles")).missed || {}));
  assert(!missed.some((k) => k.startsWith("repc:")), "卡片不进题目的复习队列（它有自己的排期）", JSON.stringify(missed));
  // 重启：排期还在
  await page.reload();
  await ready(page);
  const after = await records(page);
  assert(after["w|" + keyAfter([])].card.s === 1 && after[p2.card].card.s === 0, "重启之后卡片的排期原样还在");
  // M3 评审：启动时分块还没到，也回到「复习到期的着」，不退回按线练
  const resumed = await page.evaluate(() => ({ cat: JSON.parse(localStorage.getItem("chess.v1.puzzles")).cat, prog: document.getElementById("puzzle-progress").textContent }));
  assert(resumed.cat === "repdue" && /还有 \d+ 着/.test(resumed.prog), "重启：还在「复习到期的着」", JSON.stringify(resumed));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  void recBefore;
  await ctx.close();
}

// --- 5. 棋谱库反推 ------------------------------------------------------------
{
  const ctx = await context({ view: "library", games: GAMES });
  const { page, errs } = await open(ctx);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  const cross = await waitFor(page, (p) => p.evaluate(() => [...document.querySelectorAll("#rep-cross li")].map((li) => li.textContent)),
    (r) => r && r.length > 0, 8000);
  assert(cross.length === 1 && cross[0] === "执白 · 1. e4 e5 2. Nf3 Nc6：你常走 Nc3（4 局里 3 局），开局书写的是 Bb5 / Bc4",
    "棋谱库反推：这个局面你常走 Nc3，开局书写的是 Bb5 / Bc4", JSON.stringify(cross));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 6. 导出 PGN，再导进一个空档案：逐节点相等 -----------------------------------
{
  const ctx = await context({ view: "library" });
  const { page } = await open(ctx);
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(300);
  const want = await records(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#rep-export")]);
  const file = await dl.path();
  const text = fs.readFileSync(file, "utf8");
  assert(/\[RepSide "w"\]/.test(text) && /\[RepSide "b"\]/.test(text) && /\(/.test(text), "导出的 PGN 两本书各一局，带变着");
  await ctx.close();
  const ctx2 = await context({ view: "library", book: null });
  const { page: p2, errs } = await open(ctx2);
  await p2.click('#rail button[data-view="library"]').catch(() => {});
  const pgn = path.join(HERE, "..", "node_modules", ".cache", "rep-e2e.pgn");
  fs.mkdirSync(path.dirname(pgn), { recursive: true });
  fs.writeFileSync(pgn, text);
  // 从「导入执白」那个按钮进来：带 [RepSide] 的局各回各的书
  const [chooser] = await Promise.all([p2.waitForEvent("filechooser"), p2.click("#rep-import-w")]);
  await chooser.setFiles(pgn);
  await p2.waitForTimeout(800);
  const got = await records(p2);
  const shape = (rs) => Object.keys(rs).sort().map((id) => id + ":" + rs[id].moves.join(",")).join("\n");
  assert(shape(got) === shape(want), `导回的书与导出前逐节点相等（${Object.keys(want).length} 个节点，着法与先后）`,
    shape(got).split("\n").length + " vs " + Object.keys(want).length);
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx2.close();
}

// --- 6b. 学习数据带着卡片的排期走；全部数据带着开局书的分片（M3 评审） ------------------------
{
  const ctx = await context({ view: "me" });
  const { page } = await open(ctx);
  // 答对一张卡：它的排期往后走（学习数据要带着它）
  const graded = await page.evaluate(() => {
    const c = window.__chess.rep();
    const x = [...c.records().values()].find((r) => r.card);
    c.grade({ card: x.id }, true);
    return { id: x.id, card: c.records().get(x.id).card };
  });
  const clickHidden = (p, id) => p.evaluate((id) => document.getElementById(id).click(), id);
  const [dl] = await Promise.all([page.waitForEvent("download"), clickHidden(page, "learning-export")]);
  const doc = JSON.parse(fs.readFileSync(await dl.path(), "utf8"));
  const cards = doc.data.repertoire && doc.data.repertoire.cards;
  assert(cards && cards[graded.id] && cards[graded.id].s === graded.card.s && graded.card.s >= 1, "导出学习数据：开局书每张卡的排期都在文件里", JSON.stringify(cards && cards[graded.id]));
  const [dl2] = await Promise.all([page.waitForEvent("download"), clickHidden(page, "alldata-export")]);
  const all = JSON.parse(fs.readFileSync(await dl2.path(), "utf8"));
  const hdr = JSON.parse(all.keys.repertoire);
  const shardRecs = Object.keys(all.keys).filter((k) => /^rep[0-3]$/.test(k)).reduce((n, k) => n + JSON.parse(all.keys[k]).rep.length, 0);
  assert(hdr.db === 2 && shardRecs === hdr.n, "导出全部数据：头上说几条记录，文件里的分片就有几条", JSON.stringify({ n: hdr.n, shardRecs }));
  await ctx.close();
  // 导进一个同一本书、还没答过的档案：那张卡回到文件里的排期
  const ctx2 = await context({ view: "me" });
  const { page: p2, errs } = await open(ctx2);
  const file = path.join(HERE, "..", "node_modules", ".cache", "rep-e2e-learning.json");
  fs.writeFileSync(file, JSON.stringify(doc));
  await clickHidden(p2, "learning-import");
  await p2.waitForTimeout(300);
  const [chooser] = await Promise.all([p2.waitForEvent("filechooser"), p2.click("#confirm-ok")]);
  await chooser.setFiles(file);
  await p2.waitForTimeout(800);
  const back = await p2.evaluate((id) => window.__chess.rep().records().get(id).card, graded.id);
  assert(back && back.s === graded.card.s && back.due === graded.card.due, "导入学习数据：卡片的排期跟着回来", JSON.stringify(back));
  const h = await header(p2);
  assert(!("cards" in h) && h.db === 2, "……头上不留 cards，照旧担保记录");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx2.close();
}

// --- 7. 英文、日文：新文字都在，不截断 --------------------------------------------
for (const [lang, want] of [["en", { add: "Add to repertoire", mine: "Mine", due: "Review due moves" }], ["ja", { add: "定跡書に追加", mine: "自分", due: "期限の手を復習" }]]) {
  for (const width of [1400, 1024]) {
    const ctx = await context({ lang, width });
    const { page, errs } = await open(ctx);
    const r = await waitFor(page, (p) => p.evaluate(() => {
      const add = document.getElementById("xp-add"), seg = document.getElementById("xp-rep");
      const mine = document.querySelector("#xp-list .xp-mine");
      const spill = (el) => el && (el.scrollWidth > el.clientWidth + 1 || el.scrollHeight > el.clientHeight + 1);
      return { add: add.textContent.trim(), mine: mine ? mine.textContent : null, segs: [...seg.querySelectorAll("button")].map((b) => b.textContent.trim()),
        spill: [add, ...seg.querySelectorAll("button"), ...document.querySelectorAll("#xp-list .xp-row")].filter(spill).map((e) => e.textContent.trim()),
        sideways: document.getElementById("explorer").scrollWidth - document.getElementById("explorer").clientWidth,
        due: document.getElementById("rep-due").textContent.trim() };
    }), (x) => x.mine != null, 4000);
    const tag = `${lang} ${width}`;
    assert(r.add === want.add && r.mine === want.mine && r.due === want.due, `${tag}：新文字是这门语言的`, JSON.stringify(r));
    assert(!r.segs.some((s) => /[一-鿿]/.test(s)) || lang === "ja", `${tag}：执白 / 执黑换成这门语言`, r.segs.join());
    assert(r.spill.length === 0 && r.sideways <= 0, `${tag}：按钮、行都不截断，面板不横向滚动`, JSON.stringify(r.spill) + " " + r.sideways);
    assert(errs.length === 0, `${tag}：没有页面异常`, errs.join(" / "));
    await ctx.close();
  }
}

// --- 8. v8-2-plan T4：2,000 条线——导入、复习、导出 PGN 再导回逐节点相等；降级、全部数据 -----
/** `n` legal lines from the start: a binary tree `plies` deep, the same every run (Node's chess.js). */
function treeLines(n, plies) {
  const out = [];
  const g = new nctx.Chess();
  const walk = (acc) => {
    if (out.length >= n) return;
    const ms = acc.length < plies ? g.moves() : [];
    if (!ms.length) { out.push(acc.join(" ")); return; }
    for (const m of [...new Set([ms[0], ms[ms.length - 1]])]) {
      g.move(m); acc.push(m); walk(acc); acc.pop(); g.undo();
      if (out.length >= n) return;
    }
  };
  walk([]);
  return out;
}
/** One game per line — what a repertoire file with no variations looks like. */
const pgnOfLines = (lines) => lines.map((l, i) => `[Event "L${i}"]\n\n` + l.split(" ").map((s, j) => (j % 2 ? "" : j / 2 + 1 + ". ") + s).join(" ") + " *\n").join("\n");
const cacheFile = (name, text) => {
  const f = path.join(HERE, "..", "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};
const shape = (rs) => Object.keys(rs).sort().map((id) => id + ":" + rs[id].moves.join(",")).join("\n");
const clickHidden = (p, id) => p.evaluate((id) => document.getElementById(id).click(), id);
/** Import a PGN through 「导入执白开局书」 (the 棋谱库 page's button). */
async function importWhite(page, file) {
  await page.click('#rail button[data-view="library"]').catch(() => {});
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("#rep-import-w")]);
  await chooser.setFiles(file);
}
let big = null;
{
  const LINES = treeLines(2000, 11);
  assert(LINES.length === 2000 && new Set(LINES).size === 2000, "2000 条不同的线（11 个半着的二叉树）");
  const ctx = await context({ view: "library", book: null });
  const { page, errs } = await open(ctx);
  const t0 = Date.now();
  await importWhite(page, cacheFile("rep-e2e-2000.pgn", pgnOfLines(LINES)));
  let h = await waitFor(page, header, (x) => x && x.ln === 2000, 30000);
  const took = Date.now() - t0;
  assert(h && h.ln === 2000 && h.w.length === 400 && h.db === 2, `导入 2000 条：一条不丢（8.1 只留 400 条）；头上留前 400 条、ln 2000（${took} ms）`, JSON.stringify(h && { ln: h.ln, w: h.w.length }));
  // the lines land after the header (one write behind the records)
  let idb = await waitFor(page, idbRecords, (x) => x && x.lines && x.lines.length === 2000, 15000);
  const stored = bookOfRows(idb.lines);
  assert(stored.w.length === 2000 && stored.w.map((l) => l.sans).join("|") === LINES.join("|") && idb.rows.length === h.n,
    "lines 表里 2000 条、按导入的先后；记录数与头上一致", JSON.stringify({ lines: stored.w.length, recs: idb.rows.length, n: h.n }));
  // (by id and moves: the ECO names may be filled in between the two reads)
  const ids = (ls) => ls.map((l) => l.id + "=" + l.sans).join("|");
  assert(ids(h.w) === ids(stored.w.slice(0, 400)) && h.w.every((l) => l.id && typeof l.sans === "string" && l.sans),
    "降级用的副本：头上的 400 条就是书里最早的 400 条，8.0 / 8.1 的 loadBook 条条认得");
  assert(/2000/.test(await page.textContent("#rep-meta")), "记录页说 2000 条", await page.textContent("#rep-meta"));
  // 复习：到期的第一张（起始局面），在棋盘上答
  await page.click("#rep-due");
  await page.waitForTimeout(700);
  const p0 = await page.evaluate(() => window.__chess.rep().dueDrills()[0]);
  const g0 = new nctx.Chess(await page.evaluate(() => window.__chess.puzzle()));
  const mv = g0.moves({ verbose: true }).find((m) => m.san === p0.answers[0]);
  await tapAt(page, mv.from); await tapAt(page, mv.to);
  await page.waitForTimeout(400);
  const card = await page.evaluate((id) => window.__chess.rep().records().get(id).card, p0.card);
  assert(p0.pre.length === 0 && card.s === 1 && card.due > Date.now() + 23 * 3600e3, "复习：答对一张，排到明天", JSON.stringify(card));
  // 导出 PGN
  await page.click('#rail button[data-view="library"]');
  const want = await records(page);
  const [dl] = await Promise.all([page.waitForEvent("download"), page.click("#rep-export")]);
  const text = fs.readFileSync(await dl.path(), "utf8");
  // 重启：整本书从数据库读回
  await page.reload();
  await ready(page);
  assert((await page.evaluate(() => window.__chess.rep().records().size)) === Object.keys(want).length && /2000/.test(await page.textContent("#rep-meta")),
    "重启：2000 条线、全部记录从数据库读回（头上只有 400 条）");
  // 8.1 打开开局书的数据库：它要版本 1，库还是版本 1、两张表（v8-2-plan T4：线在另一个库里）
  const v81 = await page.evaluate(() => new Promise((r) => { const q = indexedDB.open("chessboard.repertoire", 1); q.onsuccess = () => { const s = [...q.result.objectStoreNames].join(); q.result.close(); r("opened " + s); }; q.onerror = () => r(q.error && q.error.name); }));
  assert(v81 === "opened meta,repertoire", "8.1 按版本 1 打开开局书的数据库：照常打开（不会 VersionError）", v81);
  // 降级到 8.1 改了书：头上拿掉第 6 条、加一条，写回时没有 ln（8.1 的 saveBook 只写 v w b db n sig gen）
  const gone = h.w[5];
  const added = line("e4 e5 Ke2");
  await page.evaluate(([gone, added]) => {
    const x = JSON.parse(localStorage.getItem("chess.v1.repertoire"));
    const back = { v: 1, w: x.w.filter((l) => l.id !== gone).concat([added]), b: x.b, db: 2, n: 7, sig: "81", gen: x.gen + 1 };
    localStorage.setItem("chess.v1.repertoire", JSON.stringify(back));
  }, [gone.id, added]);
  await page.reload();
  await ready(page);
  h = await waitFor(page, header, (x) => x && x.ln === 2000, 10000);
  idb = await idbRecords(page);
  const after = bookOfRows(idb.lines).w;
  assert(after.length === 2000 && !after.some((l) => l.id === gone.id) && after.some((l) => l.sans === "e4 e5 Ke2") && after.some((l) => l.sans === LINES[1999]) && h.ln === 2000,
    "回到 8.2：8.1 拿掉的那条没了、加的那条在，头上看不到的 1600 条一条不少，ln 回来", JSON.stringify({ n: after.length, ln: h.ln }));
  big = { lines: after, recs: await records(page) };
  // 导出全部数据：分片里带着线
  await page.click('#rail button[data-view="me"]');
  const [dl2] = await Promise.all([page.waitForEvent("download"), clickHidden(page, "alldata-export")]);
  const all = JSON.parse(fs.readFileSync(await dl2.path(), "utf8"));
  const shardLines = Object.keys(all.keys).filter((k) => /^rep[0-3]$/.test(k)).reduce((n, k) => n + (JSON.parse(all.keys[k]).lines || []).length, 0);
  assert(shardLines === 2000 && JSON.parse(all.keys.repertoire).ln === 2000, "导出全部数据：分片里带着全部 2000 条线", String(shardLines));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
  // 导入全部数据进一个空档案：整本书回来
  const ctx2 = await context({ view: "me", book: null });
  const { page: p2, errs: e2 } = await open(ctx2);
  await clickHidden(p2, "alldata-import");
  await p2.waitForTimeout(300);
  const [chooser] = await Promise.all([p2.waitForEvent("filechooser"), p2.click("#confirm-ok")]);
  await chooser.setFiles(cacheFile("rep-e2e-all.json", JSON.stringify(all)));
  await p2.waitForEvent("load", { timeout: 15000 }).catch(() => {});
  await ready(p2);
  const idb2 = await idbRecords(p2);
  assert(bookOfRows(idb2.lines).w.map((l) => l.id).join() === big.lines.map((l) => l.id).join() && shape(await records(p2)) === shape(big.recs),
    "导入全部数据：2000 条线按原来的先后进库，按局面的记录逐节点相同", JSON.stringify({ lines: idb2.lines && idb2.lines.length }));
  assert(e2.length === 0, "没有页面异常", e2.join(" / "));
  await ctx2.close();
  // 导出的 PGN 导进一个空档案：逐节点相等
  const ctx3 = await context({ view: "library", book: null });
  const { page: p3, errs: e3 } = await open(ctx3);
  await importWhite(p3, cacheFile("rep-e2e-2000-export.pgn", text));
  await waitFor(p3, header, (x) => x && x.n > 0, 30000);
  const got = await records(p3);
  assert(shape(got) === shape(want), `2000 条的书导出 PGN 再导回：逐节点相等（${Object.keys(want).length} 个节点）`, Object.keys(got).length + " vs " + Object.keys(want).length);
  assert(e3.length === 0, "没有页面异常", e3.join(" / "));
  await ctx3.close();
}

// --- 9. v8-2-plan T4：8.1 的档案（头上的线 + 版本 1 的数据库）升上来，什么都不丢 ---------------
{
  const B = nctx.ChessRepBook;
  const recs = B.indexBook({ w: BOOK80.w, b: BOOK80.b });
  for (const x of recs.values()) if (x.card) x.card = { s: 3, n: 3, due: Date.now() + 5 * 86400e3, ivl: 7 };
  const rows = JSON.parse(JSON.stringify([...recs.values()]));
  const head81 = Object.assign({}, BOOK80, { db: 2, n: rows.length, sig: B.sigOf(BOOK80), gen: 1000 });
  const ctx = await context({ book: head81 });
  // 8.1 写下的数据库：版本 1，repertoire 与 meta 两张表
  await ctx.addInitScript((rows) => {
    if (sessionStorage.getItem("seed81")) return;
    sessionStorage.setItem("seed81", "1");
    const q = indexedDB.open("chessboard.repertoire", 1);
    q.onupgradeneeded = () => {
      const d = q.result;
      const s = d.createObjectStore("repertoire", { keyPath: "id" });
      d.createObjectStore("meta");
      for (const r of rows) s.put(r);
      q.transaction.objectStore("meta").put(1000, "rep-gen");
    };
    q.onsuccess = () => q.result.close();
  }, rows);
  const { page, errs } = await open(ctx);
  const h = await header(page);
  const idb = await idbRecords(page);
  const got = await records(page);
  assert(idb.version === 1 && idb.stores.join() === "meta,repertoire" && JSON.stringify(bookOfRows(idb.lines)) === JSON.stringify({ w: BOOK80.w, b: BOOK80.b }),
    "8.1 → 8.2：开局书的数据库原样（版本 1、两张表），线进了 chessboard.replines，一条不少", JSON.stringify({ v: idb.version, stores: idb.stores, lines: idb.lines && idb.lines.length }));
  const cards = Object.values(got).filter((r) => r.card);
  assert(Object.keys(got).length === rows.length && cards.length && cards.every((r) => r.card.s === 3 && r.card.ivl === 7),
    "……按局面的记录与卡片排期原样（不重建、不重播种）", JSON.stringify(cards.map((r) => r.card.s)));
  assert(JSON.stringify(h.w) === JSON.stringify(BOOK80.w) && JSON.stringify(h.b) === JSON.stringify(BOOK80.b) && h.ln === 3 && h.db === 2,
    "……头上的线一字不动：降级回 8.1 / 8.0 读到的就是原来那本书", JSON.stringify({ ln: h.ln }));
  assert(idb.meta.some((k) => k.startsWith("rep-v2:")), "……迁移前的头备份在 meta 表（rep-v2:）", JSON.stringify(idb.meta));
  await page.reload();
  await ready(page);
  assert(shape(await records(page)) === shape(got), "重启：照原样读回");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 10. v8-2-plan T4：没有 IndexedDB 的时候 -------------------------------------------
{
  const ctx = await context({ view: "library" });
  // sessionStorage noIdb: "1"（默认）这次没有 IndexedDB，"0" 有
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("noIdb") !== "0") Object.defineProperty(window, "indexedDB", { configurable: true, get: () => undefined });
  });
  const { page, errs } = await open(ctx);
  const mode = () => page.evaluate(() => window.__chess.rep() && window.__chess.rep().mode());
  assert((await mode()) === "memory", "没有 IndexedDB：开局书在内存里，照常打开", await mode());
  const LINES = treeLines(450, 9);
  await importWhite(page, cacheFile("rep-e2e-450.pgn", pgnOfLines(LINES)));
  let h = await waitFor(page, header, (x) => x && x.w.length > 400, 20000);
  assert(h.lf === 1 && h.w.length === 452 && !("ln" in h), "导入 450 条：头上写整本书（lf），不截成 400 条", JSON.stringify({ w: h.w.length, lf: h.lf }));
  await page.reload();
  await ready(page);
  assert(/453/.test(await page.textContent("#rep-meta")) && (await mode()) === "memory", "重启（还是没有 IndexedDB）：453 条都在", await page.textContent("#rep-meta"));
  // IndexedDB 回来了：线搬进去，头上只留副本
  await page.evaluate(() => sessionStorage.setItem("noIdb", "0"));
  await page.reload();
  await ready(page);
  h = await header(page);
  let idb = await waitFor(page, idbRecords, (x) => x && x.lines && x.lines.length === 453, 10000);
  assert((await mode()) === "idb" && idb.lines.length === 453 && h.w.length === 400 && h.ln === 453 && !h.lf,
    "IndexedDB 回来：453 条进 lines 表，头上只留 400 条副本", JSON.stringify({ lines: idb.lines && idb.lines.length, w: h.w.length, ln: h.ln }));
  // 又没有了：头上的 400 条够不着后面的线——这次什么都不写，改动记在头上
  await page.evaluate(() => sessionStorage.setItem("noIdb", "1"));
  await page.reload();
  await ready(page);
  const held = await page.evaluate(() => window.__chess.rep().held());
  assert(held && /401/.test(await page.textContent("#rep-meta")), "又没有 IndexedDB、也没有本机分片：先用头上的副本，不写任何分片", await page.textContent("#rep-meta"));
  await importWhite(page, cacheFile("rep-e2e-one.pgn", "1. e4 e5 2. Ke2 *\n"));
  h = await waitFor(page, header, (x) => x && x.w.some((l) => l.sans === "e4 e5 Ke2"), 8000);
  assert(h.ln === 453 && h.db === 2 && h.w.length === 401, "……这时导入一条：记在头上，ln 照旧", JSON.stringify({ ln: h.ln, w: h.w.length }));
  await page.evaluate(() => sessionStorage.setItem("noIdb", "0"));
  await page.reload();
  await ready(page);
  idb = await waitFor(page, idbRecords, (x) => x && x.lines && x.lines.length === 454, 10000);
  const w = bookOfRows(idb.lines).w;
  assert(w.length === 453 && w.some((l) => l.sans === "e4 e5 Ke2") && w.some((l) => l.sans === LINES[449]),
    "IndexedDB 回来：那一条叠进整本书，后面的线一条不少", String(w.length));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 11. v8-2-plan T4：原生菜单「开局书」（视图 ⌘⇧O）---------------------------------------
{
  const ctx = await context({ view: "play" });
  await ctx.addInitScript(() => {
    window.__handlers = {};
    window.zero = {
      on: (n, cb) => { (window.__handlers[n] = window.__handlers[n] || []).push(cb); return () => {}; },
      invoke: async () => ({}),
      platform: { supports: async () => false },
    };
    window.__fire = (command) => { for (const cb of window.__handlers.shortcut || []) cb({ command, id: command, windowId: 1 }); };
  });
  const { page, errs } = await open(ctx);
  const fire = async (c) => { await page.evaluate((x) => window.__fire(x), c); await page.waitForTimeout(400); };
  const where = () => page.evaluate(() => {
    const pg = document.getElementById("page-library"), sec = document.getElementById("sec-rep");
    const r = sec.getBoundingClientRect();
    return { shown: !!pg && !pg.hidden, view: (document.querySelector('#rail button[aria-current="page"]') || {}).dataset?.view, top: Math.round(r.top), h: innerHeight };
  });
  for (const from of ["play", "me"]) {
    if (from !== "play") { await page.click('#rail button[data-view="' + from + '"]'); await page.waitForTimeout(300); }
    await fire("view.repertoire");
    const w = await where();
    assert(w.shown && w.view === "library" && w.top >= 0 && w.top < w.h, `从「${from}」按菜单「开局书」：到棋谱库页，「我的开局书」一节在眼前`, JSON.stringify(w));
    await page.click('#rail button[data-view="play"]');
    await page.waitForTimeout(300);
  }
  // 快捷键表里有它，带 ⌘⇧O / Ctrl+Shift+O
  await fire("help.keys");
  const sheet = await page.evaluate(() => [...document.querySelectorAll("#keys-list dt")].map((dt) => dt.textContent + "=" + dt.nextElementSibling.textContent));
  assert(sheet.some((r) => /^(⌘⇧O|Ctrl\+Shift\+O)=我的开局书$/.test(r)), "快捷键表：「我的开局书」一行带菜单的快捷键", JSON.stringify(sheet.slice(-2)));
  // 对话框开着的时候不动
  await fire("view.repertoire");
  assert(!(await where()).shown, "对话框开着：菜单「开局书」不动（和其它菜单项同一道门）");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 12. v8-2-plan T4：「今天到期」每分钟核一次，过午夜也变；窗口看不见时不算 ----------------------
{
  const ctx = await context({ view: "library" });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // 当地时间 23:58:00 开始
  const t0 = new Date(2026, 9, 1, 23, 58, 0).getTime();
  await page.clock.install({ time: t0 });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await ready(page);
  await page.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  await page.click('#rail button[data-view="library"]').catch(() => {});
  await page.waitForTimeout(300);
  const dueText = () => page.textContent("#rep-due-n").then((s) => s.trim());
  // 所有卡都排到十天后；两张排在午夜后 20 秒，一张在 23:59:40
  const midnight = new Date(2026, 9, 2, 0, 0, 0).getTime();
  await page.evaluate(([midnight]) => {
    const cards = [...window.__chess.rep().records().values()].filter((x) => x.card);
    cards.forEach((x, i) => { x.card.due = i < 2 ? midnight + 20000 : i === 2 ? midnight - 20000 : midnight + 10 * 86400e3; });
    document.dispatchEvent(new Event("visibilitychange"));
  }, [midnight]);
  await page.waitForTimeout(100);
  assert((await dueText()) === "0 着", "排完之后：今天到期 0 着（窗口回到前台时就核了一次）", await dueText());
  // 一分钟后（23:59:0x）还不到 23:59:40
  await page.clock.runFor(60000);
  assert((await dueText()) === "0 着", "23:59：还没有到期的", await dueText());
  // 下一分钟（00:00:0x）：23:59:40 那张到了——不用重画整页，每分钟核一次就看到
  await page.clock.runFor(60000);
  assert((await dueText()) === "1 着", "每分钟核一次：23:59:40 到期的那张算上了", await dueText());
  // 窗口看不见的那一分钟（跨过 00:00:20）：不核，也不重画
  await page.evaluate(() => Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }));
  await page.clock.runFor(60000);
  assert((await dueText()) === "1 着", "窗口看不见的那一分钟：不核", await dueText());
  await page.evaluate(() => { delete document.visibilityState; document.dispatchEvent(new Event("visibilitychange")); });
  await page.waitForTimeout(100);
  assert((await dueText()) === "3 着" && await page.isVisible("#rep-due"), "回到前台（已过午夜）：今天到期 3 着，「复习到期的着」出来了", await dueText());
  // 下一个午夜，数目没变也重画一次（日期变了）
  const node = await page.evaluateHandle(() => document.getElementById("rep-due-n"));
  await page.clock.runFor(24 * 3600e3);
  const same = await page.evaluate((n) => n === document.getElementById("rep-due-n"), node);
  assert(!same, "又一个午夜：日期变了就重画", String(same));
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

// --- 13. M3 评审 P2：头读不出来不丢线；分块还没启动时「清除全部存档」也清两个库 -------------------
{
  const LINES = treeLines(450, 9);
  const ctx = await context({ view: "library", book: null });
  const { page, errs } = await open(ctx);
  await importWhite(page, cacheFile("rep-e2e-450.pgn", pgnOfLines(LINES)));
  let h = await waitFor(page, header, (x) => x && x.ln === 450, 20000);
  const lines450 = async () => { const x = await waitFor(page, idbRecords, (v) => v && v.lines && v.lines.length >= 450, 5000); return bookOfRows(x && x.lines).w; };
  assert(h && h.w.length === 400 && (await lines450()).length === 450, "导入 450 条：头上 400 条，库里 450 条");
  const good = JSON.stringify(h);
  // the header becomes unreadable (a truncated write): persist.js quarantines it
  await page.evaluate((g) => localStorage.setItem("chess.v1.repertoire", g.slice(0, 200)), good);
  await page.reload();
  await ready(page);
  h = await waitFor(page, header, (x) => x && x.ln === 450, 5000);
  let got = await lines450();
  const quarantined = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.quarantine") || "[]").some((e) => e.name === "repertoire"));
  assert(got.length === 450 && got.map((l) => l.sans).join("|") === LINES.join("|") && /450/.test(await page.textContent("#rep-meta")),
    "头读不出来（被隔离）重启：库里 450 条一条不删，书里也是 450 条", JSON.stringify({ idb: got.length, meta: await page.textContent("#rep-meta"), quarantined }));
  assert(quarantined && h && h.ln === 450 && h.w.length === 400, "……坏的头进了隔离区，头按库里的书重写（400 条、ln 450）", JSON.stringify(h && { ln: h.ln, w: h.w.length }));
  // the old header put back (from the quarantine): nothing changes
  await page.evaluate((g) => localStorage.setItem("chess.v1.repertoire", g), good);
  await page.reload();
  await ready(page);
  got = await lines450();
  assert(got.length === 450 && (await header(page)).ln === 450, "把原来的头放回去再重启：还是 450 条", String(got.length));
  // 清除全部存档 while chunk-rep.js is still on its way: the two databases go by name
  let release;
  const held = new Promise((r) => { release = r; });
  await page.route("**/js/chunk-rep.js", async (route) => { await held; await route.continue(); });
  await page.reload();
  await page.waitForFunction(() => window.__chess && window.__chess.rep, null, { timeout: 20000 });
  await page.click("#pick-cancel", { timeout: 1000 }).catch(() => {});
  const booted = await page.evaluate(() => !!window.__chess.rep());
  await clickHidden(page, "clear-save");
  await page.click("#confirm-ok");
  await page.waitForTimeout(500);
  const dbs = await page.evaluate(async () => (await indexedDB.databases()).map((x) => x.name).filter((n) => /^chessboard\.rep/.test(n)));
  assert(!booted && dbs.length === 0, "分块还没启动时清除全部存档：chessboard.repertoire 与 chessboard.replines 都删掉了", JSON.stringify({ booted, dbs }));
  release();
  await ready(page);
  const after = await idbRecords(page);
  assert(after && !(after.rows || []).length && !(after.lines || []).length && !(await page.evaluate(() => window.__chess.rep().records().size)),
    "……分块随后启动：没有线、没有记录（不从库里读回来）", JSON.stringify(after && { rows: (after.rows || []).length, lines: (after.lines || []).length }));
  await page.unroute("**/js/chunk-rep.js");
  assert(errs.length === 0, "没有页面异常", errs.join(" / "));
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
