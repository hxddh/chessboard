/**
 * 你的开局书（v8-1-plan T3）的浏览器检查。
 *
 * rep-book.js 的算术（换序合并、排期、PGN 往返、迁移、反推）由
 * scripts/test-rep-book.mjs 在 Node 里核对；这里证明的是它接到了应用上：
 *
 *   1. 8.0 形状的老开局书在真的 IndexedDB 里迁移：线一字不动，按局面的记录
 *      写进 chessboard.library 的 repertoire 表，原值备份，背过的线带着进度；
 *      重启之后照原样读回。
 *   2. 开局浏览器的「我的」与开局书的记录逐局面逐着一致，和「书」分开标；
 *      执白 / 执黑两本书切换。
 *   3. 在开局浏览器里加一着、拿掉一着（鼠标和键盘），「加进开局书」加上棋盘上
 *      走到这里的着法；读屏读得到按下与否。
 *   4. 复习到期的着：只出到期的局面，答对就排到以后，答错留着；重启后排期还在。
 *   5. 棋谱库反推：「你常走 X，开局书写的是 Y」。
 *   6. 导出 PGN（带变着）再导进一个空档案，逐节点相等。
 *   7. 英文、日文：新文字都在、不截断。
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
for (const f of ["chess.js", "fide.js", "drills.js"]) vm.runInContext(compileModuleSync(path.join(ROOT, "js", f)), nctx, { filename: f });
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
/** The records as IndexedDB holds them (the library's database, store "repertoire"). */
const idbRecords = (page) => page.evaluate(() => new Promise((resolve) => {
  const req = indexedDB.open("chessboard.library");
  req.onsuccess = () => {
    const db = req.result;
    if (!db.objectStoreNames.contains("repertoire")) { resolve({ version: db.version, rows: null }); db.close(); return; }
    const tx = db.transaction(["repertoire", "meta"], "readonly");
    const all = tx.objectStore("repertoire").getAll();
    const keys = tx.objectStore("meta").getAllKeys();
    tx.oncomplete = () => { resolve({ version: db.version, rows: all.result, meta: keys.result.map(String) }); db.close(); };
  };
  req.onerror = () => resolve(null);
}));
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
  assert(idb && idb.version === 2 && Array.isArray(idb.rows) && idb.rows.length === h.n,
    `棋谱库的数据库升到 2，repertoire 表里 ${idb && idb.rows && idb.rows.length} 条，与头上的数一致`, JSON.stringify(idb && { v: idb.version, n: idb.rows && idb.rows.length }));
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

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
