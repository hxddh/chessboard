/**
 * Browser check for the autosave: what the app remembers across a restart.
 *
 * This is the test that was missing. A position loaded from the editor or from
 * 载入 FEN is saved the instant it is loaded — before its first move — so the
 * saved PGN is tag pairs and nothing else. chess.js's load_pgn refuses that
 * shape, the launch path read the refusal as "no save at all", and then
 * overwrote the position with the standard array. Set up a study position,
 * close the app before playing into it, and it was gone without a message.
 *
 * The unit tests can prove ChessPgn.startFen recovers the FEN; only a real
 * page can prove the app comes back standing on it. Both halves are here: the
 * save is written through the actual UI, and the restart is a real reload
 * against the same localStorage.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when either is
 * missing, so it can sit in the suite without becoming a hard dependency —
 * except under E2E_REQUIRED=1, where a skip is a failure. The release gate
 * sets it, so "the browser tests passed" cannot mean "they never ran":
 *   node scripts/test-persist-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
// the app's own rules engine, for reading an export back the way a reader would
import { Chess } from "../src/web/js/chess.js";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the 9MB engine is generated, not committed; nothing here needs it
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

/** A context that has never run the app, with the panel open on 对局. */
async function freshContext() {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  return ctx;
}

async function open(ctx) {
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  return { page, errs };
}

/**
 * The position the app is actually standing on.
 *
 * The board is a canvas, so there is nothing to query — but 载入 FEN opens
 * pre-filled with the live position, which is the app telling us where it
 * thinks it is. Read it and close the dialog again.
 */
async function shownFen(page) {
  // 更多 is a toggle, so only press it when the row is actually closed
  if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) {
    await page.click("#more-tools");
  }
  await page.click("#fen-load-open");
  const v = await page.inputValue("#fen-input");
  await page.click("#fen-cancel");
  return v;
}

const STUDY = "8/8/4k3/8/8/8/4P3/4K3 w - - 0 1";
const PLACEMENT = STUDY.split(" ")[0];

// --- 1. the whole user path: load a FEN, close the app, open it again -------
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);

  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(500);

  const saved = await page.evaluate(() => localStorage.getItem("chess.v1.save"));
  const savedPgn = saved ? JSON.parse(saved).pgn : "";
  assert(/\[FEN "/.test(savedPgn), "loading a FEN writes an autosave that names the position");
  assert(!/\d+\.\s/.test(savedPgn), "…and it has no movetext yet, which is the whole difficulty");

  // restart: a new page against the same storage is exactly what a relaunch is
  await page.close();
  const second = await open(ctx);
  const back = await second.page.evaluate(() => localStorage.getItem("chess.v1.save"));
  const backPgn = back ? JSON.parse(back).pgn : "";
  assert(/\[FEN "/.test(backPgn),
    "the position is still in the autosave after a restart — got " + JSON.stringify(backPgn));
  assert(backPgn.includes(STUDY), "…and it is the same position, not the standard array");
  const live = await shownFen(second.page);
  assert(live.split(" ")[0] === PLACEMENT,
    "the board comes back standing on the studied position — shows " + live);
  assert(errs.length === 0 && second.errs.length === 0,
    "no JS exception on either run — " + errs.concat(second.errs).join(" / "));
  await ctx.close();
}

// --- 2. a position with moves played into it still restores, as it always did
{
  const ctx = await freshContext();
  const { page } = await open(ctx);
  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(400);

  const xy = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4"]) { const p = await xy(sq); await page.mouse.click(p.x, p.y); }
  await page.waitForTimeout(400);

  await page.close();
  const second = await open(ctx);
  const moves = await second.page.evaluate(() => {
    const raw = localStorage.getItem("chess.v1.save");
    return raw ? JSON.parse(raw).pgn : "";
  });
  assert(/e4/.test(moves), "a move played into a custom position survives the restart");
  assert(moves.includes(STUDY), "…and the position it started from survives with it");
  await ctx.close();
}

// --- 3. a set-up position round-trips through a save slot ------------------
// The slot writes a PGN and the loader reads one back through the ordinary
// import path, so the same movetext-free shape has to survive both ends. It
// used not to survive either: the slot refused to save a game with no moves,
// and the importer called the result malformed.
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  await page.click("#more-tools");
  await page.click("#fen-load-open");
  await page.fill("#fen-input", STUDY);
  await page.click("#fen-load");
  await page.waitForTimeout(400);

  await page.click("#slots-open");
  await page.click("#slots-list button[data-save='0']");
  await page.waitForTimeout(300);
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.slots") || "{}"));
  const slot0 = stored && stored.slots && stored.slots[0];
  assert(!!slot0, "a position with no moves yet can be parked in a slot");
  assert(slot0 && slot0.pgn.includes(STUDY), "…and the slot holds the position itself");
  await page.click("#slots-close");

  // wipe the board, then read the slot back
  await page.click("#btn-new");
  await page.click("#ng-start");   // v7-8-plan §4: the new-game dialog, one step
  await page.waitForTimeout(300);
  await page.click("#slots-open");
  await page.click("#slots-list button[data-load='0']");
  await page.waitForTimeout(400);
  await page.click("#confirm-ok").catch(() => {});
  await page.waitForTimeout(500);
  const live = await shownFen(page);
  assert(live.split(" ")[0] === PLACEMENT,
    "loading the slot puts the position back on the board — shows " + live);
  assert(errs.length === 0, "no JS exception through the slot round trip — " + errs.join(" / "));
  await ctx.close();
}

// --- 4. the ordinary game is untouched by all of this ----------------------
{
  const ctx = await freshContext();
  const { page } = await open(ctx);
  const xy = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["e2", "e4", "e7", "e5"]) { const p = await xy(sq); await page.mouse.click(p.x, p.y); }
  await page.waitForTimeout(400);
  await page.close();
  const second = await open(ctx);
  const pgn = await second.page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.save") || "{}").pgn || "");
  assert(/1\. e4 e5/.test(pgn), "a game from the standard array still restores — got " + JSON.stringify(pgn));
  assert(!/\[FEN "/.test(pgn), "…without inventing a SetUp header for it");
  await ctx.close();
}

// --- exporting a file, under every shape the bridge comes in --------------
// The reported symptom was "I exported the report and cannot find the image".
// Two causes, both of which the app reported as success or as the player's own
// doing:
//   · no `zero.dialogs.saveFile` — the helper answered `null`, which is also
//     how the SDK says Cancel, so the app said 「已取消导出」, wrote nothing,
//     and never reached the browser fallback that was sitting right there.
//   · no `zero.os.revealPath` — the write succeeded, the folder never opened,
//     and the toast named the file and not the place.
// The rule this pins: pressing export either produces a file or says why, and
// when nothing opens to show you, the toast carries the path.
{
  const SHAPES = [
    { id: "无 zero", zero: false, dialogs: false, reveal: false },
    { id: "有 zero 无 dialogs", zero: true, dialogs: false, reveal: false },
    { id: "有 dialogs 无 revealPath", zero: true, dialogs: true, reveal: false },
    { id: "桥接齐全", zero: true, dialogs: true, reveal: true },
  ];
  for (const shape of SHAPES) {
    const ctx = await browser.newContext({ acceptDownloads: true });
    await ctx.addInitScript((sh) => {
      window.__wrote = [];
      // a fresh profile opens on the first-run picker, which sits over the
      // panel; and the export links live on the play tab with the panel open
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (!sh.zero) return;
      const z = {
        invoke: (cmd, args) => { window.__wrote.push(args && args.path); return Promise.resolve({}); },
        on: () => () => {},
        platform: { supports: () => Promise.resolve(true) },
        os: {},
      };
      if (sh.dialogs) z.dialogs = { saveFile: (o) => Promise.resolve("/tmp/exported/" + o.defaultName) };
      if (sh.reveal) z.os.revealPath = () => Promise.resolve();
      window.zero = z;
    }, shape);
    const { page } = await open(ctx);
    await page.click("#pick-cancel", { timeout: 600 }).catch(() => {});
    for (const sq of ["e2", "e4", "e7", "e5"]) {
      const pt = await page.evaluate((sqr) => {
        const c = document.getElementById("board"), r = c.getBoundingClientRect();
        return { x: r.left + (sqr.charCodeAt(0) - 97 + 0.5) * (r.width / 8),
                 y: r.top + (8 - Number(sqr[1]) + 0.5) * (r.height / 8) };
      }, sq);
      await page.mouse.click(pt.x, pt.y);
    }
    await page.waitForTimeout(400);
    let downloaded = null;
    page.on("download", (d) => { downloaded = d.suggestedFilename(); });
    await page.click("#pgn-download");
    await page.waitForTimeout(900);
    const said = await page.evaluate(() => document.getElementById("toast").textContent.trim());
    const wrote = await page.evaluate(() => window.__wrote || []);
    const landed = !!downloaded || wrote.length > 0;
    assert(landed, shape.id + ": 导出真的产生了一个文件 — 提示是「" + said + "」");
    assert(!/取消|Cancel|中止/.test(said),
      shape.id + ": 没有把「这个版本没有文件对话框」说成玩家取消 — 「" + said + "」");
    if (shape.zero && shape.dialogs && !shape.reveal)
      assert(said.includes("/tmp/exported/"),
        shape.id + ": 文件夹没打开时,提示里得有路径 — 「" + said + "」");
    await ctx.close();
  }
}

// --- 一局下完之后,它记下了什么 ---------------------------------------------
// 记录页签(统计 / 对局历史 / 成就)此前只被版式套件「看过」:没有任何测试把
// 一局棋下到底,再回头看那三样有没有变。这条路坏掉是静默的 —— 战绩悄悄不
// 记了,没有任何提示条会说。手工驱动过一遍,是好的;这一节把它钉住。
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", humanColor: "w", difficulty: "beginner",
      langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const { page, errs } = await open(ctx);
  await page.evaluate(() => {
    window.__toasts = [];
    const el = document.getElementById("toast");
    const note = () => { const s = (el.textContent || "").trim(); if (s && window.__toasts[window.__toasts.length - 1] !== s) window.__toasts.push(s); };
    new MutationObserver(note).observe(el, { childList: true, subtree: true, characterData: true });
    note();
  });
  // 一个照本宣科的引擎:这一节要的是「下完之后」,不是引擎的判断
  await page.evaluate(() => {
    window.__chess.engine.isReady = () => true;
    const rs = [{ from: "e7", to: "e5" }, { from: "b8", to: "c6" }, { from: "g8", to: "f6" }];
    let i = 0;
    window.__chess.engine.bestMove = async () => rs[i++] || null;
  });
  const at = (sq) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  const mv = async (a, b) => {
    for (const sq of [a, b]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(170); }
    await page.waitForTimeout(480);
  };
  // 学者将杀:人赢
  await mv("e2", "e4"); await mv("f1", "c4"); await mv("d1", "h5"); await mv("h5", "f7");
  await page.waitForTimeout(900);
  // 记下从头到尾出现过的每一条提示条。终局会前后脚冒出两条 —— 解锁的成就,
  // 和「本局结束 —— 去分析」,后者顶掉前者 —— 所以「某一刻屏幕上那一条」是
  // 抽签;第一版在这里抽输过一次。盯着元素变,而不是隔一会儿看一眼。
  const toasts = await page.evaluate(() => window.__toasts || []);
  const status = await page.evaluate(() => (document.getElementById("status") || {}).textContent);
  assert(/将死/.test(status), `下到将死(状态「${status}」)`);
  assert(toasts.some((x) => /成就/.test(x)),
    `…而且当场报出了解锁的成就(这段时间里的提示条:${JSON.stringify(toasts.map((x) => x.slice(0, 14)))})`);

  const saved = await page.evaluate(() => {
    const raw = localStorage.getItem("chess.v1.stats");
    return raw ? (JSON.parse(raw).games || []) : [];
  });
  assert(saved.length === 1 && saved[0].result === "win" && saved[0].diff === "beginner" &&
    saved[0].moves === 7 && saved[0].color === "w",
    `存下来的是这一局:胜、新手、执白、7 着(${JSON.stringify(saved.map((g) => [g.result, g.diff, g.moves]))})`);
  assert(typeof saved[0].pgn === "string" && /Qxf7#|xf7#/.test(saved[0].pgn),
    "…连棋谱一起存了(末手是将杀的那一手)");

  await page.keyboard.press("Escape");   // 复盘邀请挡在前面
  await page.waitForTimeout(300);
  await page.click('#rail button[data-view="me"]');   // v8-0-plan A1: the record is the 我的 page
  await page.waitForTimeout(500);
  const stats = await page.evaluate(() =>
    (document.getElementById("sec-stats") || {}).textContent.replace(/\s+/g, " "));
  assert(/1\s*胜/.test(stats) && /0\s*负/.test(stats), `统计段记到了这一胜(「${stats.slice(0, 40)}」)`);
  // the key is chess.v1.achv — persist.js KEYS, not the name the section has
  const ach = await page.evaluate(() => {
    const raw = localStorage.getItem("chess.v1.achv");
    if (!raw) return 0;
    const got = JSON.parse(raw);
    return Array.isArray(got) ? got.length : Object.keys(got).filter((k) => k !== "v").length;
  });
  assert(ach >= 1, `成就真的落了盘(解锁 ${ach} 个)`);

  // v8-0-plan C1: 「全部 N 局」 opens the library's list on its 本机 games
  await page.click("#hist-open");
  await page.waitForTimeout(800);
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#lib-list .hist-row")).map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  assert(rows.length === 1 && /胜/.test(rows[0]) && /新手/.test(rows[0]),
    `对局历史里就是这一行(「${(rows[0] || "").slice(0, 40)}」)`);
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 把别处的棋谱喂进来 -----------------------------------------------------
// pgn.js 的纯函数有单测(切分、标签、摘要、起始局面),而这条唯一能把外部数据
// 送进这个应用的路 —— 选局窗、覆盖前的确认、坏输入的下场 —— 一次都没被驱动
// 过。用剪贴板走「粘贴棋谱」,因为那是不依赖原生桥就能走通的那一半。
{
  // A fake native bridge holds the clipboard, not the browser's. Two reasons,
  // and the second one is why this had to be rewritten: Host.readClipboard
  // asks zero.clipboard first and only falls back to navigator.clipboard, so
  // the bridge IS the path the packaged app takes; and `permissions:
  // ["clipboard-read"]` is a Chromium-only idea — WebKit answers
  // `Unknown permission: clipboard-write` and the whole suite dies before its
  // first assertion. The release gate runs both engines, so a section that
  // only stands up on one of them is a section that does not stand up.
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__clip = "";
    window.zero = {
      invoke: () => Promise.resolve(true),
      on: () => () => {},
      off: () => {},
      platform: { supports: () => Promise.resolve(true) },
      os: { addRecentDocument: () => Promise.resolve(true), clearRecentDocuments: () => Promise.resolve(true),
        showNotification: () => Promise.resolve(true), revealPath: () => Promise.resolve(true) },
      clipboard: {
        readText: () => Promise.resolve(window.__clip),
        writeText: (t) => { window.__clip = String(t); return Promise.resolve(true); },
      },
      dialogs: { openFile: () => Promise.resolve(null), saveFile: () => Promise.resolve(null) },
    };
  });
  const { page, errs } = await open(ctx);
  const clip = (text) => page.evaluate((x) => { window.__clip = x; }, text);
  const answerIfAsked = async () => {
    if (await page.isVisible("#confirm-modal.show").catch(() => false)) {
      await page.click("#confirm-ok"); await page.waitForTimeout(600);
      return true;
    }
    return false;
  };
  const paste = async () => {
    if (!(await page.isVisible("#pgn-paste"))) { await page.click("#more-tools"); await page.waitForTimeout(250); }
    await page.click("#pgn-paste");
    await page.waitForTimeout(700);
  };
  const seen = () => page.evaluate(() => ({
    plies: document.querySelectorAll(".move-list .mlmove").length,
    picker: !!document.querySelector("#pick-modal.show"),
    toast: ((document.querySelector(".toast.show") || {}).textContent || "").trim(),
  }));

  await clip('[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n');
  await paste();
  const one = await seen();
  assert(one.plies === 6 && !one.picker, `一局的棋谱直接进来了(${one.plies} 着)`);

  const game = (w, b, r, mv) => `[Event "E"]\n[White "${w}"]\n[Black "${b}"]\n[Result "${r}"]\n\n${mv}\n`;
  await clip([game("甲", "乙", "1-0", "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0"),
    game("Carlsen", "Nakamura", "0-1", "1. d4 d5 2. c4 e6 0-1"),
    game("丙", "丁", "1/2-1/2", "1. Nf3 Nf6 1/2-1/2")].join("\n"));
  await paste();
  const many = await seen();
  assert(many.picker, "三局的棋谱先问你要哪一局");
  const rows = await page.evaluate(() =>
    Array.from(document.querySelectorAll("#pick-modal .pick-list button")).map((r) => r.textContent.replace(/\s+/g, " ").trim()));
  assert(rows.length === 3 && /甲/.test(rows[0]) && /Carlsen/.test(rows[1]) && /1\/2/.test(rows[2]),
    `…三行都在,而且写着谁对谁、什么结果(${JSON.stringify(rows.map((r) => r.slice(0, 18)))})`);
  await page.click("#pick-modal .pick-list button");
  await page.waitForTimeout(600);
  assert(await answerIfAsked(), "选中一局之后,它先问「导入将替换当前对局」");
  const picked = await seen();
  assert(picked.plies === 7, `…答应了才换,而且换成的正是选的那一局(7 着,实际 ${picked.plies})`);
  const last = await page.evaluate(() => {
    const b = document.querySelectorAll(".move-list .mlmove");
    return b.length ? (b[b.length - 1].getAttribute("aria-label") || b[b.length - 1].textContent).trim() : "";
  });
  assert(/f7#/.test(last), `…末手是那一记将杀(「${last}」)`);

  for (const [what, text] of [["一句话", "这不是棋谱，只是一句话。"],
    ["走法非法的棋谱", '[Event "X"]\n\n1. e4 e5 2. Nf3 Nf6 3. Ke2 Ke7 4. Qxq9 1-0\n']]) {
    const before = (await seen()).plies;
    await clip(text);
    await paste();
    await answerIfAsked();
    const after = await seen();
    assert(/无法解析|PGN/.test(after.toast) && after.plies === before,
      `喂它${what}:说得出「读不懂」,而且没动现在这局(「${after.toast.slice(0, 16)}」,${before} → ${after.plies} 着)`);
  }
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 6. the way out: 复制棋谱 / FEN, and whether they can be read back ------
//
// Every other section here is about data coming IN — a FEN loaded, a save
// restored, a PGN pasted. This is the only way data leaves the app, and until
// now nothing drove it: 复制棋谱 and FEN were two of the twenty-three controls
// that no test had ever pressed. An export nobody reads back is a claim, and a
// wrong one is silent — you find out in the other program, later.
//
// So the check is a round trip through the same chess.js the app ships: the
// copied movetext must replay to the same position the app says it is in, and
// the copied FEN must be that position written out.
//
// The clipboard is the fake native bridge again, for the reasons section 5
// gives: it is the path the packaged app takes, and `permissions:
// ["clipboard-read"]` is Chromium-only.
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood", timeControl: "3+2" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__writes = [];
    window.zero = {
      invoke: () => Promise.resolve(true), on: () => () => {}, off: () => {},
      platform: { supports: () => Promise.resolve(false) },
      clipboard: {
        readText: () => Promise.resolve(""),
        writeText: (t) => { window.__writes.push(String(t)); return Promise.resolve(true); },
      },
    };
  });
  const { page, errs } = await open(ctx);
  const view = () => page.evaluate(() => [...document.querySelectorAll("#orient-seg button")]
    .filter((b) => b.classList.contains("active")).map((b) => b.dataset.orient)[0]);
  const play = async (sqr) => {
    const flipped = (await view()) === "b";
    const pt = await page.evaluate(([x, fl]) => {
      const c = document.getElementById("board"), r = c.getBoundingClientRect();
      let f = x.charCodeAt(0) - 97, rk = 8 - Number(x[1]);
      if (fl) { f = 7 - f; rk = 7 - rk; }
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, [sqr, flipped]);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(220);
  };
  // A game worth exporting: a castle and a capture, not four quiet pawn moves.
  const SQUARES = ["e2", "e4", "e7", "e5", "g1", "f3", "b8", "c6", "f1", "c4",
    "f8", "c5", "e1", "g1", "g8", "f6", "f3", "e5", "c6", "e5"];
  for (const sq of SQUARES) await play(sq);
  await page.waitForTimeout(400);
  const PLAYED = "e4 e5 Nf3 Nc6 Bc4 Bc5 O-O Nf6 Nxe5 Nxe5";

  await page.click("#pgn-copy");
  await page.waitForTimeout(500);
  if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) {
    await page.click("#more-tools");
    await page.waitForTimeout(300);
  }
  await page.click("#fen-copy");
  await page.waitForTimeout(500);
  const writes = await page.evaluate(() => window.__writes.slice());
  assert(writes.length === 2, `两次复制各交给桥一次(${writes.length})`);
  const pgn = writes[0] || "", fen = writes[1] || "";

  // Read it back the way a reader would — with the same rules engine, outside
  // the app. This is the half that catches a movetext that is merely
  // plausible: it has to replay, and it has to land where the app says it is.
  const g = new Chess();
  const parsed = g.load_pgn(pgn);
  assert(parsed, "复制出去的棋谱,拿另一份引擎读得回来");
  assert(g.history().join(" ") === PLAYED, `……而且是刚才下的那十着(「${g.history().join(" ")}」)`);
  assert(g.fen() === fen, `……回放到的局面,正是「FEN」复制出去的那一个\n    棋谱回放 ${g.fen()}\n    FEN 复制 ${fen}`);

  // …and the other half: hand it back to the app itself, which is what
  // carrying a game between two copies of this app actually does.
  await page.evaluate((text) => { window.__clip = text; window.zero.clipboard.readText = () => Promise.resolve(text); }, pgn);
  if (!(await page.isVisible("#pgn-paste"))) { await page.click("#more-tools"); await page.waitForTimeout(250); }
  await page.click("#pgn-paste");
  await page.waitForTimeout(800);
  if (await page.isVisible("#confirm-modal.show").catch(() => false)) {
    await page.click("#confirm-ok"); await page.waitForTimeout(600);
  }
  const backIn = await shownFen(page);
  assert(backIn === fen, `……应用自己也读得回来,落在同一个局面\n    导入后 ${backIn}\n    导出时 ${fen}`);
  // the tags a reader needs, and the clock among them
  for (const tag of ["Event", "Site", "Date", "White", "Black", "Result", "TimeControl"]) {
    assert(new RegExp('\\[' + tag + ' "').test(pgn), `棋谱带着 [${tag}] 标签`);
  }
  assert(/\[TimeControl "180\+2"\]/.test(pgn), "……而且棋钟写的是这局真的用的 3+2(180+2)");
  assert(/1\. e4 e5/.test(pgn) && /O-O/.test(pgn) && /Nxe5/.test(pgn),
    "……走子文本里易位和吃子都在");
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 7. 协议和棋 survives the restart ---------------------------------------
// 「提和」 was another control no test had pressed. A finished game whose
// ending is not saved comes back as a game still in progress — the same shape
// as the 1.21.1 defect where a zero-move study position came back as the
// standard array. resigned and drawClaimed ride in the same payload field.
{
  const ctx = await freshContext();
  const { page, errs } = await open(ctx);
  const view = () => page.evaluate(() => [...document.querySelectorAll("#orient-seg button")]
    .filter((b) => b.classList.contains("active")).map((b) => b.dataset.orient)[0]);
  const play = async (sqr) => {
    const flipped = (await view()) === "b";
    const pt = await page.evaluate(([x, fl]) => {
      const c = document.getElementById("board"), r = c.getBoundingClientRect();
      let f = x.charCodeAt(0) - 97, rk = 8 - Number(x[1]);
      if (fl) { f = 7 - f; rk = 7 - rk; }
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, [sqr, flipped]);
    await page.mouse.click(pt.x, pt.y);
    await page.waitForTimeout(220);
  };
  for (const sq of ["e2", "e4", "e7", "e5"]) await play(sq);
  await page.waitForTimeout(300);
  await page.click("#btn-offerdraw");
  await page.waitForTimeout(600);
  const asked = await page.evaluate(() => (document.getElementById("confirm-message") || {}).textContent || "");
  assert(/和棋/.test(asked), `双人提和会先问一句(「${asked.slice(0, 20)}」)`);
  await page.click("#confirm-ok");
  await page.waitForTimeout(800);
  const ended = await page.evaluate(() => ({
    status: document.getElementById("status").textContent.trim(),
    save: JSON.parse(localStorage.getItem("chess.v1.save") || "null"),
  }));
  assert(/和棋/.test(ended.status), `答应之后这局就是和棋(「${ended.status}」)`);
  assert(ended.save && ended.save.drawAgreed === true, "……而且存档里记着它是协议和的");

  await page.reload();
  await page.waitForTimeout(1200);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const back = await page.evaluate(() => ({
    status: document.getElementById("status").textContent.trim(),
    rows: [...document.querySelectorAll(".mlrow")].length,
  }));
  assert(/和棋/.test(back.status), `重开之后它还是和棋,不是「白方走子」(「${back.status}」)`);
  const before = back.rows;
  await play("g1"); await play("f3");
  await page.waitForTimeout(300);
  const after = await page.evaluate(() => [...document.querySelectorAll(".mlrow")].length);
  assert(after === before, `……棋盘也是冻住的,不能接着下(${before} → ${after} 行)`);
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 8. 数据进来的另外两扇门:文件对话框,和 FEN 的剪贴板粘贴 -----------------
// 「粘贴棋谱」在上面走过了;还有两扇门从没被驱动过。「打开」是真机清单里
// 两桩旧案的案发地 —— 256 KiB 截断和 Windows 路径的 \\ —— 它们都发生在
// openFile → readTextFile 这一段桥上,而这段桥从没在测试里走通过一次。
// 「从剪贴板粘贴」是 FEN 对话框里唯一碰桥的按钮。
{
  const PGN_TEXT = '[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *\n';
  const FEN_AFTER_E4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const openBridged = async (o) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript(([opts, pgn]) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      window.__calls = [];
      window.zero = {
        on: () => () => {}, off: () => {},
        platform: { supports: () => Promise.resolve(false) },
        dialogs: { openFile: async () => { window.__calls.push("openFile"); return opts.pick; } },
        clipboard: {
          readText: async () => { if (opts.clipFail) throw new Error("nope"); return opts.clip || ""; },
          writeText: async () => true,
        },
        invoke: async (cmd) => {
          window.__calls.push(cmd);
          if (cmd === "chess.readTextFile") {
            const bytes = new TextEncoder().encode(pgn);
            let bin = ""; for (const b of bytes) bin += String.fromCharCode(b);
            return { b64: btoa(bin) };
          }
          return {};
        },
      };
    }, [o, PGN_TEXT]);
    const { page, errs } = await open(ctx);
    return { ctx, page, errs };
  };
  const rows = (page) => page.evaluate(() => document.querySelectorAll(".mlrow").length);
  const moreOpen = async (page) => {
    if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) await page.click("#more-tools");
  };

  // 打开:选了文件 → 桥上走 openFile 然后 readTextFile → 对局被换成文件里的
  {
    const { ctx, page, errs } = await openBridged({ pick: ["/tmp/game.pgn"] });
    await moreOpen(page);
    await page.click("#pgn-open");
    await page.waitForTimeout(700);
    assert((await rows(page)) === 2, "「打开」把文件里的两回合棋谱装了进来");
    // 6.0: the profile mirror writes on its own clock and the dialog's path
    // is issued before it is read — neither is a second road into the file;
    // 7.5: nor is the one self-test probe every page load makes
    const calls = (await page.evaluate(() => window.__calls))
      .filter((c) => c !== "chess.appdataWrite" && c !== "chess.appdataRead" && c !== "chess.selftestMode");
    assert(calls.join("→") === "openFile→chess.issuePath→chess.readTextFile",
      `……走的是文件对话框 → 桥上读文件这一条,别无他路(${calls.join("→")})`);
    assert(await page.evaluate(() => document.getElementById("status").textContent.trim()) === "白方走子",
      "……装完轮到白方(1.e4 e5 2.Nf3 Nc6 之后)");
    assert(errs.length === 0, `打开:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
  // 打开:取消 → 什么都不发生。null 是「用户改主意了」,不是错误,更不是空文件
  {
    const { ctx, page } = await openBridged({ pick: null });
    const fenBefore = await shownFen(page);
    await moreOpen(page);
    await page.click("#pgn-open");
    await page.waitForTimeout(500);
    assert((await shownFen(page)) === fenBefore, "「打开」后取消:局面一个字都没动");
    await ctx.close();
  }
  // 从剪贴板粘贴:填进输入框(去掉首尾空白),载入后真的站在那个局面上
  {
    const { ctx, page } = await openBridged({ clip: "  " + FEN_AFTER_E4 + "  " });
    await moreOpen(page);
    await page.click("#fen-load-open");
    await page.click("#fen-from-clip");
    await page.waitForTimeout(400);
    assert((await page.inputValue("#fen-input")) === FEN_AFTER_E4,
      "「从剪贴板粘贴」把剪贴板里的 FEN 填进输入框,首尾空白已去掉");
    await page.click("#fen-load");
    await page.waitForTimeout(500);
    assert(/黑方/.test(await page.evaluate(() => document.getElementById("status").textContent.trim())),
      "……载入之后轮到黑方,正是那个 FEN 说的");
    await ctx.close();
  }
  // 从剪贴板粘贴:桥抛异常 → 有一条故障提示,而不是安静地什么都不做
  {
    const { ctx, page } = await openBridged({ clipFail: true });
    await moreOpen(page);
    await page.click("#fen-load-open");
    await page.click("#fen-from-clip");
    await page.waitForTimeout(400);
    const toast = await page.evaluate(() => {
      const t = document.getElementById("toast");
      return t && t.classList.contains("show") ? t.textContent.trim() : "";
    });
    assert(/剪贴板/.test(toast), `……读不到剪贴板时它说了出来(「${toast}」)`);
    await ctx.close();
  }
}

// --- 9. 6.0 的三条行为断言(v6-plan D1 / D2 / D5) -------------------------------
// 每条都曾只有源码正则在守;这里是它们各自的第一条真页面测试。
{
  const bridged = async (init) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((extra) => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
      if (extra.corruptStats) localStorage.setItem("chess.v1.stats", "{not json");
      window.__writes = [];
      window.zero = {
        on: () => () => {}, off: () => {},
        platform: { supports: () => Promise.resolve(false) },
        clipboard: {
          readText: async () => extra.clip || "",
          writeText: async (t) => { window.__writes.push(String(t)); return true; },
        },
        invoke: async () => ({}),
      };
    }, init);
    const { page, errs } = await open(ctx);
    return { ctx, page, errs };
  };
  const moreOpen = async (page) => {
    if (await page.evaluate(() => !!document.getElementById("more-row").hidden)) await page.click("#more-tools");
  };

  // D1:一局没有将死却写着 1-0 的棋谱,导出时结果记号只有一个,而且还是 1-0
  {
    const { ctx, page, errs } = await bridged({ clip: '[Event "T"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 1-0\n' });
    await moreOpen(page);
    await page.click("#pgn-paste");
    await page.waitForTimeout(700);
    if (await page.isVisible("#confirm-modal.show").catch(() => false)) { await page.click("#confirm-ok"); await page.waitForTimeout(600); }
    await moreOpen(page);
    await page.click("#pgn-copy");
    await page.waitForTimeout(300);
    const out = await page.evaluate(() => window.__writes[window.__writes.length - 1] || "");
    const body = out.split("\n\n").pop() || "";
    const tokens = body.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/g) || [];
    assert(tokens.length === 1, `导出的着法文本里只有一个结果记号(${JSON.stringify(tokens)})`);
    assert(/\[Result "1-0"\]/.test(out) && /1-0\s*$/.test(body.trim()), "……而且是文件里说的那个 1-0,不是 *");
    assert(errs.length === 0, "D1:全程没有页面异常");
    await ctx.close();
  }

  // D2:一份读不出来的 stats,启动时横幅说了出来,原值被搁置而不是被覆盖
  {
    const { ctx, page, errs } = await bridged({ corruptStats: true });
    const banner = await page.evaluate(() => {
      const el = document.getElementById("profile-fault");
      return el && !el.hidden ? el.textContent : "";
    });
    assert(/stats/.test(banner), `坏掉的记录有横幅,并点名是哪一份(「${banner.slice(0, 40)}」)`);
    const q = await page.evaluate(() => localStorage.getItem("chess.v1.quarantine") || "");
    assert(/\{not json/.test(q), "……原值原样进了隔离区");
    // 走一步,让 stats 有机会被重写;隔离区里的那份还在
    await page.evaluate(() => { window.__chess.engine.isReady = () => true; });
    const q2 = await page.evaluate(() => localStorage.getItem("chess.v1.quarantine") || "");
    assert(/\{not json/.test(q2), "……之后也没有被清掉");
    assert(errs.length === 0, "D2:全程没有页面异常");
    await ctx.close();
  }

  // D5:对手的应着与复盘导航,读屏软件听得到着法
  {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript(() => {
      localStorage.setItem("chess.v1.settings", JSON.stringify({
        mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood", difficulty: "easy", humanColor: "w" }));
      localStorage.setItem("chess.panelOpen", "1");
    });
    const { page, errs } = await open(ctx);
    await page.evaluate(() => {
      window.__chess.engine.isReady = () => true;
      window.__chess.engine.bestMove = async () => ({ from: "e7", to: "e5" });
    });
    const at = (sq) => page.evaluate((n) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, sq);
    for (const sq of ["e2", "e4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(170); }
    await page.waitForTimeout(900);
    const said = () => page.evaluate(() => (document.getElementById("board-live") || {}).textContent || "");
    assert(/e5/.test(await said()), `引擎应着之后 #board-live 念出了那一着(「${await said()}」)`);
    // the arrows move the keyboard cursor while the board has focus — replay
    // navigation is what they do everywhere else
    await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(200);
    assert(/e4/.test(await said()), `← 之后念出了停在哪一着之后(「${await said()}」)`);
    await page.keyboard.press("Home");
    await page.waitForTimeout(200);
    assert(/开局/.test(await said()), `Home 之后说回到开局(「${await said()}」)`);
    assert(errs.length === 0, "D5:全程没有页面异常");
    await ctx.close();
  }
}

// --- 10. Persist.recover():档案文件与浏览器缓存谁说了算 (v6-plan §8.1) -----
//
// 6.1 在这条路上修了四处丢档,四处都有单测(test-chess.mjs「6.1 — 7. the boot
// race」往下),但这个套件从来没有走过 recover() 一次 —— 而这四处修的恰恰是
// **启动顺序**:谁先写、谁先读、写完谁还能再写。顺序是页面的事,不是模块的
// 事,所以它们各自在这里再走一遍,连着真正的重新载入。
//
// 桥沿用本文件第 8 节的假桥办法,只是这次假的是 chess.appdataRead /
// appdataWrite。那个「文件」和这一段自己的记账放在 sessionStorage 里:它跨得
// 过一次 location.reload()(这一段的一半问题只有跨过那次重新载入才看得见),
// 又不在应用的 localStorage 命名空间里 —— 测试脚手架不该混进档案的键里,
// test-chess.mjs 有一条守卫专门盯着这件事。
{
  const FILE_PGN = '[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n' +
    '[White "?"]\n[Black "?"]\n[Result "*"]\n\n1. d4 d5 2. c4 *';
  const CACHE_PGN = '[Event "?"]\n[Site "?"]\n[Date "????.??.??"]\n[Round "?"]\n' +
    '[White "?"]\n[Black "?"]\n[Result "*"]\n\n1. e4 e5 *';
  const SETTINGS = JSON.stringify({
    mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" });
  const profileDoc = (pgn, writtenAt) => JSON.stringify({
    app: "chessboard", schema: 1, writtenAt,
    keys: { save: JSON.stringify({ v: 1, pgn }), settings: SETTINGS } });

  /**
   * 一个装着假档案文件的浏览器上下文。
   *
   * `file` 是文件的内容:null = 这台机器上还没有这个文件,"" = 文件在但是空
   * 的(写了一半被打断),别的字符串 = 文件里就是这些字节。
   * `cachePgn` 是启动时 localStorage 里已经存着的那一局。
   * `readDelay` 让桥上的读慢下来 —— 6.1 的第一处丢档就发生在读还没回来、
   * 启动时的写已经排上队的那几百毫秒里(MIRROR_DELAY 是 400 ms)。
   */
  const bootWithFile = async ({ file, cachePgn, settings, readDelay = 700 }) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript(([file, cachePgn, settings, readDelay]) => {
      const S = sessionStorage;                 // 脚手架自己的抽屉,不是档案的
      const num = (k) => Number(S.getItem(k) || "0") || 0;
      const bump = (k) => S.setItem(k, String(num(k) + 1));
      // 只在第一次启动时布置现场:重新载入之后这段还会跑一遍,那一遍必须
      // 看到的是上一遍留下的状态,不是重新摆好的现场
      if (S.getItem("e2e.armed") == null) {
        S.setItem("e2e.armed", "1");
        if (file != null) S.setItem("e2e.file", file);
        S.setItem("e2e.writes", "0");
        S.setItem("e2e.writesBeforeRead", "0");
        S.setItem("e2e.reloads", "0");
        if (cachePgn) {
          localStorage.setItem("chess.v1.save", JSON.stringify({ v: 1, pgn: cachePgn }));
          localStorage.setItem("chess.v1.settings", settings);
        }
      } else {
        bump("e2e.reloads");
      }
      localStorage.setItem("chess.panelOpen", "1");
      const enc = (s) => {
        const b = new TextEncoder().encode(s);
        let x = ""; for (const c of b) x += String.fromCharCode(c);
        return btoa(x);
      };
      const dec = (b64) => {
        const bin = atob(b64); const u = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(u);
      };
      let readDone = false;
      // v8-0-plan F3:带 key 的读写是分键存储里的那一个文件(store/<key>.json),
      // 不带的是 6.x–7.x 那一整份 chessboard.json —— 迁移就是从后者读、往前者写
      const slot = (arg) => (arg && arg.key ? "e2e.store." + arg.key : "e2e.file");
      window.zero = {
        on: () => () => {}, off: () => {},
        platform: { supports: () => Promise.resolve(false) },
        clipboard: { readText: async () => "", writeText: async () => true },
        invoke: async (cmd, arg) => {
          if (cmd === "chess.appdataRead") {
            await new Promise((r) => setTimeout(r, readDelay));
            readDone = true;
            const f = S.getItem(slot(arg));
            if (f == null) return { missing: true };
            if (f === "") return { empty: true };
            return { b64: enc(f) };
          }
          if (cmd === "chess.appdataWrite") {
            // 「在 recover() 读回来之前」是这一节要证明的事,所以它由桥自己
            // 记下来 —— 测试进程这边的墙上时钟在慢机器上量不准这个
            if (!readDone) bump("e2e.writesBeforeRead");
            bump("e2e.writes");
            S.setItem(slot(arg), dec(arg.b64));
            return { ok: true };
          }
          return {};
        },
      };
      // 重新载入之前页面还会做什么 —— 这个探针住在页面里,因为「恢复之后、
      // 重新载入之前」那 1.2 秒是页面自己的时间,测试进程插不进去
      const watch = () => {
        const save = localStorage.getItem("chess.v1.save") || "";
        if (/1\. d4/.test(save)) {
          if (S.getItem("e2e.probed") == null) {
            S.setItem("e2e.probed", "1");
            // beforeunload → saveGame():单测第 8 条说的就是这一下
            window.dispatchEvent(new Event("beforeunload"));
            S.setItem("e2e.saveAfterUnload", localStorage.getItem("chess.v1.save") || "");
          }
          return;
        }
        setTimeout(watch, 10);
      };
      setTimeout(watch, 10);
    }, [file, cachePgn, settings || SETTINGS, readDelay]);
    const { page, errs } = await open(ctx);
    return { ctx, page, errs };
  };
  const probe = (page, k) => page.evaluate((key) => sessionStorage.getItem(key), k);
  const lsSave = (page) => page.evaluate(() => localStorage.getItem("chess.v1.save") || "");
  const moves = (page) => page.evaluate(() =>
    [...document.querySelectorAll(".move-list .mlmove")].map((m) => m.getAttribute("aria-label")).join(" "));
  const toastNow = (page) => page.evaluate(() => {
    const el = document.getElementById("toast");
    return el && el.classList.contains("show")
      ? { text: el.textContent.replace("✕", "").trim(), fault: el.classList.contains("t-fault") }
      : { text: "", fault: false };
  });
  const waitForFileToast = (page) => page.waitForFunction(() => {
    const el = document.getElementById("toast");
    return !!el && el.classList.contains("show") && /数据文件/.test(el.textContent || "");
  }, null, { timeout: 20000 }).catch(() => {});

  // (a) 缓存被清空 + 文件完好 → 应用最终跑在文件里的那份上,而且文件没有先
  // 被一份空档案盖掉。6.0 的顺序是反的:启动的写抢在 recover() 前面落地,
  // recover() 再从自己刚毁掉的文件里「恢复」,还告诉用户恢复成功了。
  {
    const { ctx, page, errs } = await bootWithFile({ file: profileDoc(FILE_PGN, 9000), cachePgn: null });
    await page.waitForFunction(() => Number(sessionStorage.getItem("e2e.reloads") || "0") > 0,
      null, { timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(1200);
    assert((await probe(page, "e2e.writesBeforeRead")) === "0",
      `recover() 读回来之前,一个字节都没写进文件(写了 ${await probe(page, "e2e.writesBeforeRead")} 次)`);
    assert((await probe(page, "e2e.reloads")) === "1",
      `恢复之后页面重新载入了一次(${await probe(page, "e2e.reloads")})`);
    const line = await moves(page);
    assert(line === "d4 d5 c4", `重新载入之后应用跑在文件里的那局上(「${line}」)`);
    assert(/1\. d4/.test(await lsSave(page)), "……localStorage 里也换成了文件里的那份");
    assert(/1\. d4/.test(await probe(page, "e2e.file") || ""),
      "……而文件还是文件:没有被启动时的空档案盖过");
    // v8-0-plan F3:重新载入之后的那一趟把这份档案迁进了分键存储 —— 每个键一个
    // 文件,外加一份清单;旧的整份文件原样留着,给降级回 7.x 的人
    await page.waitForFunction(() => sessionStorage.getItem("e2e.store.meta") != null, null, { timeout: 5000 }).catch(() => {});
    const meta = JSON.parse(await probe(page, "e2e.store.meta") || "null");
    assert(!!meta && meta.schema === 2 && meta.keys.includes("save") && meta.keys.includes("settings"),
      `迁移:分键存储有了清单,schema 2,列着 save 与 settings(${JSON.stringify(meta)})`);
    assert(/1\. d4/.test(await probe(page, "e2e.store.save") || ""),
      "迁移:save 这个键单独成了一个文件,内容就是旧文件里那一局");

    // (b) 恢复之后到重新载入之间,页面再做什么都不许盖掉刚恢复的东西
    assert((await probe(page, "e2e.probed")) === "1", "恢复与重新载入之间的那一下探针真的按下去了");
    assert(/1\. d4/.test(await probe(page, "e2e.saveAfterUnload") || ""),
      `……那之后 beforeunload 的 saveGame() 没有把它写回旧的那局(「${(await probe(page, "e2e.saveAfterUnload") || "").slice(-14)}」)`);
    assert(errs.length === 0, `recover (a)(b):全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (c) 文件读不出来 → 横幅说一句,这一趟继续用缓存里的档案
  {
    const { ctx, page, errs } = await bootWithFile({ file: "{not json at all", cachePgn: CACHE_PGN });
    await waitForFileToast(page);
    const tst = await toastNow(page);
    assert(/读不出来/.test(tst.text), `读不出来的档案文件有横幅(「${tst.text}」)`);
    assert(tst.fault, "……而且是故障级的(t-fault),不会自己溜走");
    const line = await moves(page);
    assert(line === "e4 e5", `……这一趟还是缓存里的那局棋(「${line}」)`);
    assert((await probe(page, "e2e.reloads")) === "0", "……没有重新载入:坏文件不是「更新的一方」");
    assert(/1\. e4/.test(await lsSave(page)), "……缓存原样还在");
    // 文案(msg.profile.fileBad)承诺「原文件未被覆盖」,这条盯着它是真的。
    // 这个洞本来是有的:recover() 的 finally 会开闸(releaseMirror),启动时
    // 排队的那次镜像写随即落在这份坏文件上,MIRROR_DELAY 之后原文件就没了
    // —— 用户被告知留着的那一份,正是他唯一能拿去恢复的副本。这条 e2e 把
    // 它抓了出来,persist.js 现在遇到读不出来的文件就把镜像闸死一整场。
    await page.waitForTimeout(1500);
    const still = await probe(page, "e2e.file");
    assert(still === "{not json at all",
      "坏文件原样还在,一个字节没动 —— 文案承诺的「原文件未被覆盖」是真的");
    assert((await probe(page, "e2e.writes")) === "0", "……整场一次镜像写都没发生");
    assert(errs.length === 0, `recover (c):全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (d) 长度为零的文件 → 同样报出来,而且**不**当作新装
  {
    const { ctx, page, errs } = await bootWithFile({ file: "", cachePgn: CACHE_PGN });
    await waitForFileToast(page);
    const tst = await toastNow(page);
    assert(/读不出来/.test(tst.text), `空文件(写了一半被打断)也报出来,不当无事发生(「${tst.text}」)`);
    assert(tst.fault, "……同样是故障级的");
    const line = await moves(page);
    assert(line === "e4 e5", `……缓存里的那局棋照旧在跑(「${line}」)`);
    assert((await probe(page, "e2e.reloads")) === "0", "……也没有重新载入");
    assert(errs.length === 0, `recover (d):全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (d 的对照组) 文件根本不存在 = 真·新装:一句话都不该说。少了这一条,上面
  // 两条只证明了「启动时会弹横幅」,证明不了「它认得出这是损坏」。
  {
    const { ctx, page, errs } = await bootWithFile({ file: null, cachePgn: CACHE_PGN });
    await page.waitForTimeout(3000);
    const tst = await toastNow(page);
    assert(!/数据文件/.test(tst.text), `文件不存在是新装,不是损坏:没有横幅(「${tst.text}」)`);
    assert((await moves(page)) === "e4 e5", "……缓存里的那局棋照旧");
    // v8-0-plan F3:镜像是分键的 —— save 自己一个文件
    await page.waitForFunction(() => sessionStorage.getItem("e2e.store.meta") != null, null, { timeout: 5000 }).catch(() => {});
    assert(/1\. e4/.test(await probe(page, "e2e.store.save") || ""),
      "……而且缓存被镜像到了这台机器的分键存储里,下一次启动就有得读了");
    assert(errs.length === 0, `recover (新装):全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
}

// --- 11. v8-0-plan F3:2 MB 的存档,导出 → 清空 → 导回,逐键相等 ---------------
//
// 7.9 之前这条路是断的,而且断得很安静:SDK 的桥一帧最多 1 MiB(0.10.1 的
// bridge.max_message_bytes / max_result_bytes),原生 readTextFile 又只收
// 256 KiB。500 局战绩加上棋谱库和分析,「导出全部数据」只能退回剪贴板,
// 「导入全部数据」直接被拒。每次自动保存还要把**整份**档案逐字节拼成 base64
// 过桥 —— 2 MB 要 86 ms(计划里的实测),主线程整个卡住,而且照样超过那 1 MiB,写不进去。
//
// 这里的假桥照原生的样子做:一帧超过 1 MiB 就拒(SDK 的 PayloadTooLarge),
// 分块写按 txn/total/offset 暂存、收齐才落盘,分块读每次最多 512 KiB 并告诉
// 页面还有没有(more)。每次应答都在自己的宏任务里交回,所以「上一次应答交回
// → 下一次调用发出」之间的时间,正是页面在主线程上连续干活的那一段。
function fakeNative(opts) {
  const LIMIT = 1024 * 1024, CHUNK = 512 * 1024, MAX = 16 * 1024 * 1024;
  const S = sessionStorage;
  const b64enc = (u8) => {
    let s = "";
    for (let i = 0; i < u8.length; i += 24576) s += btoa(String.fromCharCode.apply(null, u8.subarray(i, i + 24576)));
    return s;
  };
  const b64dec = (s) => {
    const bin = atob(s); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u;
  };
  // the native store: key → bytes ("" is the 6.x–7.x chessboard.json). With
  // `persist` it lives in sessionStorage so it survives a reload, like a disk.
  const store = new Map();
  if (opts.persist) {
    for (let i = 0; i < S.length; i++) {
      const k = S.key(i);
      if (k.startsWith("f3.store.")) store.set(k.slice(9), b64dec(S.getItem(k)));
    }
  }
  const keep = (k, u8) => { store.set(k, u8); if (opts.persist) S.setItem("f3.store." + k, b64enc(u8)); };
  const files = new Map();
  const stages = new Map();
  window.__files = files;
  window.__store = store;
  window.__seg = { at: 0, max: 0 };
  window.__big = 0;   // bridge frames the fake refused for being over 1 MiB
  const log = (k, n) => {
    const l = JSON.parse(S.getItem("f3.log") || "[]");
    l.push([k, n]);
    S.setItem("f3.log", JSON.stringify(l));
  };
  const receive = (target, a) => {
    const bytes = b64dec(a.b64 || "");
    if (a.total == null) return { done: bytes };
    if (a.total > MAX) return { answer: { tooLarge: true, limit: MAX } };
    let st = stages.get(a.txn);
    if (a.offset === 0) { st = { target, data: new Uint8Array(a.total), filled: 0 }; stages.set(a.txn, st); }
    if (!st || st.target !== target || st.filled !== a.offset || a.offset + bytes.length > a.total) {
      stages.delete(a.txn);
      return { answer: { error: "stage_lost" } };
    }
    st.data.set(bytes, a.offset);
    st.filled += bytes.length;
    if (st.filled < a.total) return { answer: { ok: true, pending: true } };
    stages.delete(a.txn);
    return { done: st.data };
  };
  const chunkOf = (u8, a, extra) => {
    const off = a.offset || 0;
    if (!off && u8.length > MAX) return { tooLarge: true, limit: MAX };
    return Object.assign({ b64: b64enc(u8.subarray(off, off + CHUNK)), more: off + CHUNK < u8.length }, extra);
  };
  const answer = (cmd, a) => {
    if (cmd === "chess.issuePath") return { ok: true };
    if (cmd === "chess.selftestMode") return { on: false };
    if (cmd === "chess.writeTextFile") {
      const r = receive("path:" + a.path, a);
      if (r.answer) return r.answer;
      files.set(a.path, r.done);
      return true;
    }
    if (cmd === "chess.readTextFile") {
      const f = files.get(a.path);
      if (!f) throw new Error("HandlerFailed");
      return chunkOf(f, a);
    }
    if (cmd === "chess.appdataWrite") {
      const k = a.key || "";
      const r = receive("appdata:" + k, a);
      if (r.answer) return r.answer;
      keep(k, r.done);
      log(k, r.done.length);
      return { ok: true };
    }
    if (cmd === "chess.appdataRead") {
      const f = store.get(a.key || "");
      if (!f) return { missing: true };
      if (!f.length) return { empty: true };
      return chunkOf(f, a, { bak: false });
    }
    return {};
  };
  window.zero = {
    on: () => () => {}, off: () => {},
    platform: { supports: (o) => Promise.resolve(!!o && o.feature === "dialogs") },
    dialogs: {
      saveFile: async () => "/Users/me/all.json",
      openFile: async () => ["/Users/me/all.json"],
      showMessage: async () => "primary",
    },
    clipboard: { readText: async () => "", writeText: async (t) => { window.__clip = String(t); return true; } },
    invoke: (cmd, a) => {
      // the page's continuous work since the last answer came back. An idle
      // gap (the 400 ms debounce, a person) is far longer than any real slice.
      const now = performance.now();
      if (window.__seg.at && now - window.__seg.at < 200) window.__seg.max = Math.max(window.__seg.max, now - window.__seg.at);
      window.__seg.at = 0;
      const frame = JSON.stringify({ id: "0123456789abcdef", command: cmd, payload: a || {} }).length;
      return new Promise((resolve, reject) => setTimeout(() => {
        let r, err = null;
        if (frame > LIMIT) { window.__big++; err = new Error("PayloadTooLarge: Bridge request is too large"); }
        else {
          try {
            r = answer(cmd, a || {});
            if (JSON.stringify(r).length + 64 > LIMIT) { window.__big++; err = new Error("response over the bridge limit"); }
          } catch (e) { err = e; }
        }
        window.__seg.at = performance.now();
        if (err) reject(err); else resolve(r);
      }, 0));
    },
  };
}

/** A profile of about `mb` megabytes, in the shapes the app reads (ACCEPT). */
function seedProfile(mb) {
  const S = sessionStorage;
  if (S.getItem("f3.seeded")) return;
  S.setItem("f3.seeded", "1");
  const line = "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 ";
  const stats = { v: 2, games: [] };
  for (let i = 0; i < 500; i++) {
    stats.games.push({ id: "g" + i, t: 1758000000000 + i * 60000, result: i % 3 ? "1-0" : "0-1", mode: "ai",
      diff: "normal", color: i % 2 ? "b" : "w", ending: "mate", pgn: line + line + "1-0" });
  }
  const library = { v: 1, names: ["hxddh"], games: [] };
  const target = mb * 1024 * 1024 - JSON.stringify(stats).length;
  for (let i = 0; JSON.stringify(library).length < target; i++) {
    const sans = line.replace(/\d+\. /g, "").trim().repeat(3);
    library.games.push({ id: "lib:" + i.toString(36), sans, plies: 60, added: 1758000000000 + i,
      headers: [["Event", "Rated blitz"], ["White", "hxddh"], ["Black", "rival" + i], ["Result", "1-0"]],
      pgn: '[White "hxddh"]\n[Black "rival' + i + '"]\n\n' + line.repeat(8) + "1-0" });
  }
  localStorage.setItem("chess.v1.stats", JSON.stringify(stats));
  localStorage.setItem("chess.v1.library", JSON.stringify(library));
  localStorage.setItem("chess.v1.save", JSON.stringify({ v: 1, pgn: '[Event "?"]\n[Result "*"]\n\n1. e4 e5 *' }));
}

const PROFILE_KEYS = ["save", "settings", "stats", "learn", "puzzles", "mines", "progress", "achv", "slots",
  "library", "repertoire", "analyses"].map((k) => "chess.v1." + k).concat(["chess.panelOpen"]);
const snapshot = (page) => page.evaluate((keys) => Object.fromEntries(keys.map((k) => [k, localStorage.getItem(k)])), PROFILE_KEYS);

{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  await ctx.addInitScript(seedProfile, 2);
  await ctx.addInitScript(fakeNative, { persist: false });
  const { page, errs } = await open(ctx);

  // (a) the first launch writes the whole profile into the per-key store —
  // the largest mirror write there is. No slice of it may hold the main
  // thread past a frame. v8-0-plan C1: the library moves into IndexedDB on
  // this launch, so its games reach the store as the 64 shards (lib00 …
  // lib3f) under a small header, not as one `library` file.
  const shardBytes = () => page.evaluate(() => {
    const dec = (u8) => (u8 ? new TextDecoder().decode(u8) : "");
    let meta = null;
    try { meta = JSON.parse(dec(window.__store.get("meta"))); } catch (_) { meta = null; }
    if (!meta || !/"db":2/.test(dec(window.__store.get((meta.files && meta.files.library) || "library")))) return -1;
    let n = 0, games = 0;
    for (const k of meta.keys) {
      if (!/^lib[0-3][0-9a-f]$/.test(k)) continue;
      const text = dec(window.__store.get(meta.files[k] || k));
      n += text.length;
      games += JSON.parse(text).games.length;
    }
    return { n, games };
  });
  await page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready, null, { timeout: 30000 }).catch(() => {});
  const libCount = await page.evaluate(() => window.__chess.library().games.length);
  await page.waitForFunction((want) => {
    const dec = (u8) => (u8 ? new TextDecoder().decode(u8) : "");
    try {
      const meta = JSON.parse(dec(window.__store.get("meta")));
      if (!/"db":2/.test(dec(window.__store.get((meta.files && meta.files.library) || "library")))) return false;
      let games = 0;
      for (const k of meta.keys) if (/^lib[0-3][0-9a-f]$/.test(k)) games += JSON.parse(dec(window.__store.get(meta.files[k] || k))).games.length;
      return games === want;
    } catch (_) { return false; }
  }, libCount, { timeout: 90000, polling: 250 }).catch(() => {});
  const shards = await shardBytes();
  const full = await page.evaluate(() => ({ meta: window.__store.has("meta"), seg: window.__seg.max, big: window.__big }));
  console.log(`  镜像·整份写入(2 MB):最长一段主线程 ${full.seg.toFixed(1)} ms,棋谱库 ${libCount} 局在分片里 ${shards.n} 字节`);
  assert(full.meta && shards.n > 1024 * 1024 && shards.games === libCount,
    `2 MB 的档案整份进了原生存储:棋谱库的 ${libCount} 局都在分片里(${shards.games} 局,${shards.n} 字节)`);
  assert(full.big === 0, `……没有一帧超过桥的 1 MiB(被拒 ${full.big} 次)`);
  assert(full.seg <= 16, `……写的过程中,主线程上最长的一段 ≤ 16 ms(${full.seg.toFixed(1)} ms)`);

  // (b) export: one file, compact, the whole of it
  await page.evaluate(() => document.getElementById("alldata-export").click());
  await page.waitForFunction(() => window.__files.has("/Users/me/all.json") || window.__clip != null, null, { timeout: 15000 }).catch(() => {});
  const exp = await page.evaluate(() => {
    const f = window.__files.get("/Users/me/all.json");
    const text = f ? new TextDecoder().decode(f) : "";
    return { size: f ? f.length : 0, pretty: /\n {2}"/.test(text), clip: window.__clip != null, text };
  });
  assert(exp.size >= 2 * 1024 * 1024 && !exp.clip,
    `「导出全部数据」写成了一个 ≥ 2 MB 的文件,没有退回剪贴板(${exp.size} 字节${exp.clip ? ",进了剪贴板" : ""})`);
  assert(exp.size > 0 && !exp.pretty, "……而且是紧凑 JSON,不是缩进两格的那种");
  const doc = exp.text ? JSON.parse(exp.text) : { keys: {} };

  // (c) a typical save — one move's worth, on top of the 2 MB profile. Before
  // F3 this re-serialised and re-encoded all 2 MB, byte by byte.
  await page.waitForTimeout(600);   // let the export's own flush settle
  await page.evaluate(() => { window.__seg.max = 0; window.__seg.at = 0; });
  // one move (2. Nf3), so the save really changed; then flush it at once,
  // before the 400 ms debounce, from a task this test can time
  const sq = (n) => page.evaluate((s) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, n);
  const g1 = await sq("g1"), f3 = await sq("f3");
  await page.mouse.click(g1.x, g1.y);
  await page.waitForTimeout(120);
  await page.mouse.click(f3.x, f3.y);
  await page.evaluate(() => { window.__seg.max = 0; window.__seg.at = 0; });
  const first = await page.evaluate(() => {
    const t0 = performance.now();
    // the first bridge call measures from here too: the flush starts in a
    // microtask of this same task, after the line below returns
    window.__seg.at = t0;
    window.dispatchEvent(new Event("pagehide"));   // saveGame() + flushMirror(), in this one task
    return performance.now() - t0;
  });
  await page.waitForTimeout(800);
  const typical = Math.max(first, await page.evaluate(() => window.__seg.max));
  const savedMove = await page.evaluate(() => {
    const f = window.__store.get("save");
    return !!f && /Nf3/.test(new TextDecoder().decode(f));
  });
  console.log(`  镜像·一次普通保存:主线程最长一段 ${typical.toFixed(1)} ms(其中同步起步 ${first.toFixed(1)} ms)`);
  assert(savedMove, "走了 2. Nf3 之后,原生存储里的 save 就是这一局");
  assert(typical <= 16, `一次普通保存的镜像写,主线程上每段 ≤ 16 ms(${typical.toFixed(1)} ms)`);

  // (d) clear → import the file → every key is what was exported
  await page.evaluate((keys) => { for (const k of keys) localStorage.removeItem(k); }, PROFILE_KEYS);
  await page.evaluate(() => document.getElementById("alldata-import").click());
  await page.waitForFunction(() => /已导入全部数据/.test((document.getElementById("toast") || {}).textContent || ""),
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(2500);   // the import reloads the page after 900 ms
  const after = await snapshot(page);
  const diff = PROFILE_KEYS.filter((k) => {
    const name = k.replace(/^chess\.(v1\.)?/, "").replace(/^achv$/, "achievements");
    const want = doc.keys[name] == null ? null : doc.keys[name];
    return after[k] !== want;
  });
  assert(!!doc.keys.library && diff.length === 0,
    `导回之后逐键相等(${PROFILE_KEYS.length} 个键${diff.length ? ",不相等:" + diff.join(", ") : ""})`);
  // v8-0-plan C1: …and the library's games, which are in the file as shards
  // and in IndexedDB after the import, not in localStorage
  const shardsInFile = Object.keys(doc.keys).filter((k) => /^lib[0-3][0-9a-f]$/.test(k));
  await page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready, null, { timeout: 30000 }).catch(() => {});
  const back = await page.evaluate(() => window.__chess.library().games.length);
  assert(shardsInFile.length > 0 && back === libCount,
    `整份导出里有棋谱库的 ${shardsInFile.length} 个分片;清空再导回,${libCount} 局一局不少(${back})`);
  assert(errs.length === 0, `2 MB 导出导入:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 12. v8-0-plan F3:从 7.x 的整份文件迁到分键存储,之后只写变过的键 ----------
{
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    const S = sessionStorage;
    if (S.getItem("f3.armed")) return;
    S.setItem("f3.armed", "1");
    // a 7.x profile: schema 1 in the cache, and the one-document mirror file
    // holding the same revision
    const settings = JSON.stringify({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" });
    const games = [];
    for (let i = 0; i < 80; i++) {
      games.push({ id: "lib:" + i, sans: "e4 e5 Nf3 Nc6 Bb5 a6", plies: 6, added: 1758000000000 + i,
        headers: [["White", "hxddh"], ["Black", "r" + i]], pgn: "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *" });
    }
    const keys = {
      settings,
      save: JSON.stringify({ v: 1, pgn: '[Event "?"]\n[Result "*"]\n\n1. d4 d5 *' }),
      stats: JSON.stringify({ v: 1, games: [{ t: 1, sig: "e4 e5#mate", result: "1-0" }] }),
      library: JSON.stringify({ v: 1, names: ["hxddh"], games }),
      learn: JSON.stringify({ v: 1, done: { a: 1 } }),
      panelOpen: "1",
    };
    const map = { settings: "chess.v1.settings", save: "chess.v1.save", stats: "chess.v1.stats",
      library: "chess.v1.library", learn: "chess.v1.learn", panelOpen: "chess.panelOpen" };
    for (const [n, v] of Object.entries(keys)) localStorage.setItem(map[n], v);
    localStorage.setItem("chess.schema", "1");
    localStorage.setItem("chess.writtenAt", "5000");
    const doc = JSON.stringify({ app: "chessboard", schema: 1, writtenAt: 5000, keys });
    const u8 = new TextEncoder().encode(doc);
    let bin = ""; for (const b of u8) bin += String.fromCharCode(b);
    S.setItem("f3.store.", btoa(bin));
    S.setItem("f3.legacy", doc);
  });
  await ctx.addInitScript(fakeNative, { persist: true });
  const { page, errs } = await open(ctx);
  await page.waitForFunction(() => window.__store.has("meta"), null, { timeout: 15000 }).catch(() => {});
  // v8-0-plan C1: …and the library's migration into IndexedDB has reached the store
  await page.waitForFunction(() => {
    try {
      const meta = JSON.parse(new TextDecoder().decode(window.__store.get("meta")));
      return /"db":2/.test(new TextDecoder().decode(window.__store.get((meta.files && meta.files.library) || "library")));
    } catch (_) { return false; }
  }, null, { timeout: 15000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(600);
  const got = await page.evaluate(() => {
    const dec = (u8) => (u8 ? new TextDecoder().decode(u8) : null);
    const legacy = JSON.parse(sessionStorage.getItem("f3.legacy"));
    const meta = JSON.parse(dec(window.__store.get("meta")) || "null");
    const lsKey = (n) => (n === "panelOpen" ? "chess.panelOpen" : "chess.v1." + n);
    const file = (n) => dec(window.__store.get((meta && meta.files && meta.files[n]) || n));
    const unequal = Object.keys(legacy.keys).filter((n) => file(n) !== localStorage.getItem(lsKey(n)));
    // v8-0-plan C1: the library's games moved to IndexedDB and reach the
    // store as shards; the old file's games are all in them, unchanged
    const want = JSON.parse(legacy.keys.library).games;
    const got = [];
    for (const k of (meta && meta.keys) || []) if (/^lib[0-3][0-9a-f]$/.test(k)) got.push(...JSON.parse(file(k)).games);
    const byId = new Map(got.map((g) => [g.id, JSON.stringify(g)]));
    return { meta, unequal, legacyKept: dec(window.__store.get("")) === sessionStorage.getItem("f3.legacy"),
      schema: localStorage.getItem("chess.schema"),
      libSame: got.length === want.length && want.every((g) => byId.get(g.id) === JSON.stringify(g)) && /"db":2/.test(file("library")) };
  });
  assert(!!got.meta && got.meta.schema === 2 && got.meta.app === "chessboard",
    `7.x 的档案第一次用分键存储打开:分键存储有了清单,schema 2(${JSON.stringify(got.meta && { schema: got.meta.schema, keys: got.meta.keys })})`);
  assert(got.unequal.length === 0 && got.libSame, `……旧文件里的每个键都成了自己的文件,内容逐字相等;棋谱库的 80 局在分片里,一局不差(不等:${got.unequal.join(", ") || "无"})`);
  assert(got.legacyKept, "……旧的整份 chessboard.json 一个字节没动,留给降级的人");
  assert(got.schema === "2", `……缓存的 schema 记成了 2(${got.schema})`);

  // second launch: nothing changed, so nothing big is rewritten
  await page.evaluate(() => sessionStorage.setItem("f3.log", "[]"));
  await page.reload();
  await page.waitForTimeout(1800);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const boot2 = await page.evaluate(() => JSON.parse(sessionStorage.getItem("f3.log") || "[]").map((e) => e[0]));
  assert(!boot2.includes("library") && !boot2.includes("stats"),
    `第二次启动:没变的大键不重写(这一趟写了:${boot2.join(", ") || "无"})`);

  // one move: the save changes, the library does not
  await page.evaluate(() => sessionStorage.setItem("f3.log", "[]"));
  const at = (sq) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, sq);
  for (const sq of ["c2", "c4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(170); }
  await page.waitForTimeout(1200);
  const moved = await page.evaluate(() => JSON.parse(sessionStorage.getItem("f3.log") || "[]").map((e) => e[0]));
  assert(moved.includes("save") && moved.includes("meta"), `走一步:save 和清单写了(${moved.join(", ")})`);
  assert(!moved.includes("library") && !moved.includes("stats") && !moved.includes(""),
    "……棋谱库、战绩和旧的整份文件都没有被重写");
  assert(errs.length === 0, `迁移:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 13. v8-0-plan C1:IndexedDB 没了,原生存储里的分片把棋谱库找回来 ----------
// The games live in IndexedDB now, which is the WebView's — "remove website
// data" takes it, and localStorage with it or not. Either way the store's
// shards are what a restore comes from.
{
  const games = [];
  for (let i = 0; i < 5; i++) {
    games.push({ id: "lib:c1" + i, t: 1758000000000 + i, white: "hxddh", black: "r" + i, date: "2026.09.0" + (i + 1),
      event: "x", result: "1-0", plies: 4, sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win", an: null });
  }
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((lib) => {
    if (sessionStorage.getItem("c1.seeded")) return;
    sessionStorage.setItem("c1.seeded", "1");
    localStorage.setItem("chess.v1.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.v1.library", lib);
  }, JSON.stringify({ v: 1, names: ["hxddh"], games }));
  await ctx.addInitScript(fakeNative, { persist: true });
  const { page, errs } = await open(ctx);
  const ready = () => page.waitForFunction(() => window.__chess && window.__chess.library && window.__chess.library().ready,
    null, { timeout: 30000 }).catch(() => {});
  const inStore = () => page.evaluate(() => {
    try {
      const dec = (u8) => new TextDecoder().decode(u8);
      const meta = JSON.parse(dec(window.__store.get("meta")));
      let n = 0;
      for (const k of meta.keys) if (/^lib[0-3][0-9a-f]$/.test(k)) n += JSON.parse(dec(window.__store.get(meta.files[k] || k))).games.length;
      return n;
    } catch (_) { return 0; }
  });
  await ready();
  await page.waitForFunction(() => {
    try {
      const meta = JSON.parse(new TextDecoder().decode(window.__store.get("meta")));
      return meta.keys.some((k) => /^lib[0-3][0-9a-f]$/.test(k));
    } catch (_) { return false; }
  }, null, { timeout: 15000, polling: 200 }).catch(() => {});
  await page.waitForTimeout(800);
  assert(await inStore() === 5, `C1:迁移之后,五局都在原生存储的分片里(${await inStore()})`);

  // (a) IndexedDB gone, localStorage kept: the header counts five, the store has them
  await page.evaluate(() => new Promise((res) => {
    const r = indexedDB.deleteDatabase("chessboard.library");
    r.onsuccess = r.onerror = r.onblocked = () => res();
  }));
  await page.reload();
  await page.waitForTimeout(900);
  await ready();
  await page.waitForTimeout(500);
  const a = await page.evaluate(() => ({ n: window.__chess.library().games.length, toast: document.getElementById("toast").textContent }));
  assert(a.n === 5 && /找回 5 局/.test(a.toast), `C1:IndexedDB 被清掉、localStorage 还在:从分片里找回五局,并且说了(${a.n};「${a.toast}」)`);

  // (b) all of the WebView's data gone: the store restores the profile and its games
  await page.evaluate(() => new Promise((res) => {
    localStorage.clear();
    const r = indexedDB.deleteDatabase("chessboard.library");
    r.onsuccess = r.onerror = r.onblocked = () => res();
  }));
  await page.reload();
  // recover() restores, then the page reloads itself onto the restored profile
  await page.waitForTimeout(4000);
  await ready();
  await page.waitForTimeout(500);
  const b = await page.evaluate(() => ({ n: window.__chess.library().games.length, mode: window.__chess.library().mode,
    header: JSON.parse(localStorage.getItem("chess.v1.library") || "null") }));
  assert(b.n === 5 && b.mode === "idb" && b.header && b.header.db === 2,
    `C1:网页数据全没了:从原生存储恢复整份档案,棋谱库五局回到 IndexedDB(${b.n}, ${b.mode})`);
  assert(errs.length === 0, `C1 恢复:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- v8-0-plan A3: 7.x 的主题设置,开 8.0 之后还是那个样子 ---------------------
// themeId used to choose the shell and the board together; it is migrated to
// appearance × board (js/look.js, every case in test-persist.mjs). Here, in a
// page: each 7.x profile opens in its own shell, the migrated fields are
// written back, and the second launch — which reads them, not themeId —
// lands on the same thing. A first run follows the system, on the flat board.
{
  const cases = [
    [{ themeId: "wood" }, "wood/wood", "dark/wood"],
    [{ themeId: "night" }, "night/green", "dark/green"],
    [{ themeId: "day" }, "day/wood", "light/wood"],
    [{ themeId: "notebook" }, "notebook/blue", "light/blue"],
    [{ themeId: "night", followSystem: true }, "notebook/green", "system/green"],
    [{ themeId: "wood", pieceSet: "merida" }, "wood/wood", "dark/wood"],
    [null, "day/wood", "system/wood"],
  ];
  for (const [old, attrs, saved] of cases) {
    const tag = old ? JSON.stringify(old) : "新用户";
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, locale: "zh-CN", colorScheme: "light" });
    await ctx.addInitScript((o) => {
      // seeded once: the reload below must read what the app wrote back
      if (sessionStorage.getItem("seeded")) return;
      sessionStorage.setItem("seeded", "1");
      if (o) localStorage.setItem("chess.v1.settings", JSON.stringify(Object.assign({ mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false }, o)));
    }, old);
    const { page, errs } = await open(ctx);
    const read = () => page.evaluate(() => {
      const root = document.documentElement;
      const s = JSON.parse(localStorage.getItem("chess.v1.settings") || "{}");
      return { attrs: root.dataset.theme + "/" + root.dataset.board, frame: root.dataset.frame,
        saved: s.appearance + "/" + s.boardId, frameSaved: s.boardFrame, pieceSet: s.pieceSet };
    });
    // anything that saves settings writes the migrated look back
    await page.evaluate(() => document.getElementById("opt-coords").click());
    await page.evaluate(() => document.getElementById("opt-coords").click());
    await page.waitForTimeout(300);
    const first = await read();
    assert(first.attrs === attrs && first.frame === "flat", `A3 ${tag}:打开是 ${attrs}、平盘(实际 ${first.attrs}、${first.frame})`);
    assert(first.saved === saved && first.frameSaved === "flat" && first.pieceSet === (old && old.pieceSet || "cburnett"),
      `A3 ${tag}:写回的设置是 ${saved}/flat/${(old && old.pieceSet) || "cburnett"}(实际 ${first.saved}/${first.frameSaved}/${first.pieceSet})`);
    await page.reload();
    await page.waitForTimeout(900);
    const second = await read();
    assert(second.attrs === attrs && second.saved === saved, `A3 ${tag}:第二次启动读新字段,仍是 ${attrs}(实际 ${second.attrs})`);
    assert(errs.length === 0, `A3 ${tag}:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
}

await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
