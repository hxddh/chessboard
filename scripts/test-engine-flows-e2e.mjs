/**
 * The engine's flows, end to end, on the REAL Stockfish (v7-5-plan §2).
 *
 * Every other *-e2e.mjs except test-engine-e2e serves `js/engine-src.js` as a
 * one-line stub. That proves the wiring around the engine and nothing about
 * the engine's answers reaching the page: a change to the shape analyze()
 * returns, or a search slower than some timeout, leaves every stub test green.
 * test-engine-e2e only asks "does the engine start and reply to 1. e4". This
 * file asks the next question — once it has started, does each feature that
 * needs it get the right thing back:
 *
 *   1 人机      vs computer (beginner tier) replies within 20 s; H gives a legal move
 *   2 失着提醒  e4 … Qh5 … Qxf7+ hangs the queen: the mm.blunder toast appears
 *   3 分析/精析 a 13-ply game with a known blunder gets ? / ?? marks and an
 *               accuracy line; 精析 finishes too
 *   4 持续分析  switched on, a principal variation shows within 6 s
 *   5 棋谱库    three games imported and analysed, no null in any an.scalars,
 *               and opening one shows its marks without a new engine search
 *   6 教学对练  卢塞纳 Rc1–d1+ gets a reply from the engine
 *
 * v7-6-plan §1 and §6 added:
 *
 *   7  持续分析+棋谱库  live analysis on, a library pass, one step back mid-pass:
 *                      every game still finishes and the live line comes back
 *   8  分析中锁棋谱    during 精析, 存为变着 / 编辑注释 / a board move are refused
 *   9  分析存盘        an analysis survives a reload and a 对局历史 load, no search
 *   10 精析回写库      精析 of a library game writes budget/accuracy back, via reviseMines
 *   11 再深一遍        the 400 ms re-pass of one library game, reviseMines included
 *   12 人机高档棋钟    hard / normal send their UCI_Elo; a short clock caps movetime
 *   13 多主变          multipv=3 in 分析 and in 持续分析
 *   14 FEN黑先         a [SetUp] game with Black to move is numbered and marked right
 *
 * v7-8-plan §3 added:
 *
 *   15 为什么          9. a3's reason names 捉双 and 车; 再试一次 marks a3 wrong
 *                      and the engine's move right
 *
 * Each scenario gets a fresh browser context, so one flow's engine state
 * cannot carry the next. Only key results are asserted: what the engine says
 * varies run to run, the fact that it reaches the page does not.
 *
 * Runs on whichever engine E2E_BROWSER names (see e2e-browser.mjs). Generates
 * engine-src.js first when it is missing or a stub.
 *
 *   node scripts/test-engine-flows-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";
import { Chess } from "../src/web/js/chess.js";
import { ChessMistakes } from "../src/web/js/mistakes.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

{
  const src = path.join(ROOT, "js", "engine-src.js");
  // sync-dist's own threshold for "carries the whole wasm"
  if (!fs.existsSync(src) || fs.statSync(src).size <= 2000000) {
    execFileSync(process.execPath, [path.join(HERE, "gen-engine-src.mjs")], { stdio: "inherit" });
  }
}

const { launchBrowser, ENGINE } = await import("./e2e-browser.mjs");

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
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
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg, extra != null ? " " + extra : ""); }
};

const browser = await launchBrowser();
console.log("引擎:", ENGINE, "· 页面:", ROOT);
const T0 = Date.now();

/**
 * The Blackburne Shilling trap, stopped one move short of mate: 4. Nxe5? and
 * 5. Nxf7?? are there for any budget to mark, and the last position is not
 * terminal, so a live search on it has a line to show (…Nf3#).
 */
const TRAP = '[Event "flows"]\n[Site "-"]\n[Date "2026.09.20"]\n[White "hxddh"]\n[Black "rival"]\n[Result "*"]\n\n' +
  "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 *\n";
const LIB_PGN = [
  TRAP,
  '[Event "flows"]\n[Site "-"]\n[Date "2026.09.21"]\n[White "rival"]\n[Black "hxddh"]\n[Result "*"]\n\n' +
    "1. d4 d5 2. c4 e6 3. Nc3 Nf6 4. Bg5 Be7 5. e3 O-O *\n",
  '[Event "flows"]\n[Site "-"]\n[Date "2026.09.22"]\n[White "hxddh"]\n[Black "rival"]\n[Result "*"]\n\n' +
    "1. e4 c5 2. Nf3 d6 3. d4 cxd4 4. Nxd4 Nf6 5. Nc3 a6 *\n",
].join("\n");

const tmpFile = (name, text) => {
  const f = path.join(HERE, "..", "node_modules", ".cache", name);
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
  return f;
};

/** A fresh context and page in `mode`, with the side panel on screen. */
async function openPage(settings, seed) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript(([s, sd]) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify(Object.assign(
      { langId: "zh-CN", sideTab: "play", soundOn: false }, s)));
    localStorage.setItem("chess.panelOpen", "1");
    // stored state the scenario starts from — written on the first load only,
    // so a reload sees what the page itself wrote since
    if (sd && !sessionStorage.getItem("flows.seeded")) {
      for (const [k, v] of Object.entries(sd)) localStorage.setItem(k, v);
      sessionStorage.setItem("flows.seeded", "1");
    }
    // every toast the page shows, in order — the next one replaces the text
    window.__toasts = [];
    let last = "";
    new MutationObserver(() => {
      const el = document.getElementById("toast");
      const s2 = el ? (el.textContent || "").trim() : "";
      if (s2 && s2 !== last) window.__toasts.push(s2);
      last = s2;
    }).observe(document, { subtree: true, childList: true, characterData: true });
    // every search the page asks the engine for
    const W = window.Worker;
    window.__go = 0;
    window.__uci = [];
    window.Worker = function (...a) {
      const w = new W(...a);
      const pm = w.postMessage.bind(w);
      w.postMessage = (m, ...r) => {
        if (typeof m === "string" && /^go\b/.test(m)) window.__go++;
        // what was asked, in order: the tier (UCI_Elo), the budget (movetime)
        if (typeof m === "string" && /^(go|setoption|uci|isready)\b/.test(m)) window.__uci.push(m);
        return pm(m, ...r);
      };
      return w;
    };
    window.Worker.prototype = W.prototype;
  }, [settings, seed || null]);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push("pageerror: " + e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  // the onboarding picker, when it shows at all
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  await page.waitForTimeout(150);
  return { ctx, page, errs };
}

async function clickMove(page, from, to) {
  const xy = (sq) => page.evaluate((q) => {
    const r = document.getElementById("board").getBoundingClientRect();
    const sz = r.width / 8;
    return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * sz, y: r.top + (8 - Number(q[1]) + 0.5) * sz };
  }, sq);
  const a = await xy(from); await page.mouse.click(a.x, a.y); await page.waitForTimeout(150);
  const b = await xy(to); await page.mouse.click(b.x, b.y);
}

const plies = (page) => page.evaluate(() => document.querySelectorAll(".move-list .mlmove:not(.mlgap)").length);

/** Poll `fn` until it returns truthy or `ms` pass; the last value either way. */
async function until(fn, ms, step = 200) {
  const t0 = Date.now();
  let v;
  for (;;) {
    v = await fn();
    if (v || Date.now() - t0 > ms) return v;
    await new Promise((r) => setTimeout(r, step));
  }
}

/** The live game's position, read from what the page saves. */
async function savedGame(page) {
  const pgn = await page.evaluate(() => {
    try { return JSON.parse(localStorage.getItem("chess.v1.save") || "null").pgn; } catch { return null; }
  });
  const g = new Chess();
  if (pgn) g.load_pgn(pgn, { sloppy: true });
  return g;
}

/** Wait until the saved game is `n` plies long (the page saves after each move). */
const savedAt = (page, n, ms) => until(async () => {
  const g = await savedGame(page);
  return g.history().length >= n ? g : null;
}, ms);

async function importVia(page, button, text, name) {
  const file = tmpFile(name, text);
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click(button)]);
  await chooser.setFiles(file);
  await page.waitForTimeout(700);
}

/** 打开 lives under 更多 in the 棋谱与局面 group. */
async function openPgn(page, text) {
  if (!(await page.isVisible("#pgn-open"))) await page.click("#more-tools");
  await importVia(page, "#pgn-open", text, "flows-trap.pgn");
}

/** 分析 is running: its button has become the stop control. */
const anBusy = (page) => page.evaluate(() => /停/.test(document.getElementById("an-run").textContent || ""));

/** Press 分析 or 精析 and wait for the pass to finish; its wall time in ms. */
async function runAn(page, sel, ms) {
  const t0 = Date.now();
  await page.click(sel);
  await until(() => anBusy(page), 3000, 50);
  await until(async () => !(await anBusy(page)), ms);
  return Date.now() - t0;
}

/** What the page shows of an analysis: the marks (with their ply), the accuracy line. */
const readAn = (page) => page.evaluate(() => {
  const acc = document.getElementById("acc-line");
  return {
    tags: [...document.querySelectorAll(".move-list .mlmove")].filter((b) => b.querySelector(".mvtag"))
      .map((b) => b.dataset.i + b.querySelector(".mvtag").textContent.trim()),
    acc: acc && !acc.hidden ? (acc.textContent || "").trim() : "",
    btn: (document.getElementById("an-run").textContent || "").trim(),
  };
});

const libOf = (page) => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library") || "null"));
const minesOf = (page) => page.evaluate(() =>
  (JSON.parse(localStorage.getItem("chess.v1.mines") || "null") || { list: [] }).list);

/** Import LIB_PGN into the library, claim hxddh's games and run the pass to the end. */
async function libraryPass(page, file) {
  await page.click("#tab-record");
  await importVia(page, "#lib-import", LIB_PGN, file);
  await page.click("#lib-names");
  await page.keyboard.type("hxddh");
  await page.click("#lib-analyse");
  return until(async () => {
    const x = await libOf(page);
    return x && x.games.length === 3 && x.games.every((g) => g.an) ? x : null;
  }, 120000, 500);
}

/**
 * A drill the library could have minted at 300 ms from hxddh's 1. e4 — a
 * move no pass calls ??. Deeper than a 200 ms pass, so only a 400 ms one may
 * judge it; that pass's reviseMines has to withdraw it. Its absence afterwards
 * is the proof the deeper pass went through reviseMines at all.
 */
const START_FEN = new Chess().fen();
const FAKE_DRILL = { id: ChessMistakes.mineId(START_FEN, "e4"), cat: "mine", fen: START_FEN,
  solution: ["d4"], played: "e4", loss: 300, ply: 0, rev: { budget: 300, src: "lib" } };
const FAKE_MINES = JSON.stringify({ v: 1, list: [FAKE_DRILL] });

// FLOWS_ONLY=人机,棋谱库 runs just those (a local convenience while debugging)
const ONLY = (process.env.FLOWS_ONLY || "").split(",").filter(Boolean);
const scenario = async (name, fn) => {
  if (ONLY.length && !ONLY.includes(name)) return;
  const t0 = Date.now();
  try { await fn(); } catch (e) { failed++; console.error("FAIL:", name, "threw:", e.message.split("\n")[0]); }
  console.log("  —", name, ((Date.now() - t0) / 1000).toFixed(1) + "s");
};

// --- 1. 人机：应着 + 提示 -----------------------------------------------------
await scenario("人机", async () => {
  const { ctx, page, errs } = await openPage({ mode: "ai" });
  await clickMove(page, "e2", "e4");
  const t0 = Date.now();
  const n = await until(() => plies(page).then((p) => p >= 2 ? p : 0), 20000, 150);
  assert(n >= 2, "人机·新手档：1. e4 之后 20 秒内引擎应着(" + (Date.now() - t0) + "ms)");
  const g = await savedAt(page, 2, 3000);
  await page.waitForTimeout(300);
  const before = (await page.evaluate(() => window.__toasts.length));
  await page.keyboard.press("h");
  const hint = await until(() => page.evaluate((k) =>
    window.__toasts.slice(k).find((s) => /^提示 · /.test(s)) || null, before), 10000);
  const san = hint ? hint.replace(/^提示 · /, "").trim() : "";
  const legal = g ? g.moves() : [];
  assert(!!hint && legal.includes(san), "按 H：提示给出当前局面里一手合法的棋", hint + " / " + (g && g.fen()));
  assert(!errs.length, "人机：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 2. 失着提醒 --------------------------------------------------------------
await scenario("失着提醒", async () => {
  let done = false;
  for (let attempt = 1; attempt <= 5 && !done; attempt++) {
    const { ctx, page, errs } = await openPage({ mode: "ai" });
    try {
      await clickMove(page, "e2", "e4");
      let g = await savedAt(page, 2, 20000);
      if (!g || !g.moves({ verbose: true }).some((m) => m.from === "d1" && m.to === "h5")) {
        console.log("  第", attempt, "次：Qh5 走不了，重来"); continue;
      }
      await page.waitForTimeout(300);
      await clickMove(page, "d1", "h5");
      g = await savedAt(page, 4, 20000);
      const qxf7 = g && g.moves({ verbose: true }).find((m) => m.from === "h5" && m.to === "f7");
      if (!qxf7) { console.log("  第", attempt, "次：Qxf7 走不了(" + (g && g.history().join(" ")) + ")，重来"); continue; }
      // the queen has to hang there: something of Black's must take on f7
      const probe = new Chess(g.fen());
      probe.move(qxf7);
      if (!probe.moves({ verbose: true }).some((m) => m.to === "f7")) {
        console.log("  第", attempt, "次：f7 上的后没人吃得到，重来"); continue;
      }
      await page.waitForTimeout(300);
      const k = await page.evaluate(() => window.__toasts.length);
      await clickMove(page, "h5", "f7");
      const reply = await savedAt(page, 6, 20000);
      const t0 = Date.now();
      const hit = await until(() => page.evaluate((i) =>
        window.__toasts.slice(i).find((s) => /可能是严重失误/.test(s)) || null, k), 8000);
      assert(!!reply && !!hit, "失着提醒：" + (g.history().join(" ")) + " Qxf7+ 之后出现 mm.blunder 提示(引擎应着后 " +
        (Date.now() - t0) + "ms)", JSON.stringify(await page.evaluate(() => window.__toasts)));
      assert(!errs.length, "失着提醒：页面没有报错", errs.join(" / "));
      done = true;
    } finally { await ctx.close(); }
  }
  if (!done) assert(false, "失着提醒：5 次都没走到 Qxf7+ 送后的局面");
});

// --- 3. 分析 / 精析 ------------------------------------------------------------
await scenario("分析/精析", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, TRAP);
  assert(await plies(page) === 13, "分析：导入 13 半着的对局", await plies(page));
  const busy = () => page.evaluate(() => /停/.test(document.getElementById("an-run").textContent || ""));
  const run = async (sel, ms) => {
    const t0 = Date.now();
    await page.click(sel);
    await until(busy, 3000, 50);
    await until(async () => !(await busy()), ms);
    return Date.now() - t0;
  };
  const read = () => page.evaluate(() => {
    const acc = document.getElementById("acc-line");
    return {
      tags: [...document.querySelectorAll(".move-list .mvtag")].map((e) => e.textContent.trim()),
      acc: acc && !acc.hidden ? (acc.textContent || "").trim() : "",
      btn: (document.getElementById("an-run").textContent || "").trim(),
    };
  });
  const ms = await run("#an-run", 60000);
  let r = await read();
  assert(r.tags.some((t) => t === "?" || t === "??") && !!r.acc,
    "分析：" + (ms / 1000).toFixed(1) + " 秒完成，标出 ? / ??，精准度一行不为空", JSON.stringify(r));
  const msDeep = await run("#an-deep", 90000);
  r = await read();
  assert(!/停/.test(r.btn) && r.tags.some((t) => t === "?" || t === "??") && !!r.acc,
    "精析：" + (msDeep / 1000).toFixed(1) + " 秒完成，标注和精准度都还在", JSON.stringify(r));
  assert(!errs.length, "分析：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 4. 持续分析 --------------------------------------------------------------
await scenario("持续分析", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, TRAP);
  await page.click("#an-live");
  const pressed = await page.getAttribute("#an-live", "aria-pressed");
  const t0 = Date.now();
  const pv = await until(() => page.evaluate(() => {
    const el = document.getElementById("live-line");
    if (!el || el.hidden) return null;
    const chips = [...el.querySelectorAll(".pv-chip")].map((c) => c.textContent.trim()).filter(Boolean);
    return chips.length ? chips.join(" ") : null;
  }), 6000, 100);
  assert(pressed === "true" && !!pv, "持续分析：打开后 aria-pressed=true，" + (Date.now() - t0) + "ms 内出现主变", pv);
  assert(!errs.length, "持续分析：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 5. 棋谱库 ----------------------------------------------------------------
await scenario("棋谱库", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp", sideTab: "record" });
  await page.click("#tab-record").catch(() => {});
  await importVia(page, "#lib-import", LIB_PGN, "flows-lib.pgn");
  // the real path (v7-6-plan §6): type the name and go straight for 分析 —
  // the field's `change` fires on the way, as focus leaves it for the button
  await page.click("#lib-names");
  await page.keyboard.type("hxddh");
  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library") || "null"));
  let l = await lib();
  assert(l && l.games.length === 3, "棋谱库：三局进库", l && l.games.length);
  const t0 = Date.now();
  // the pass may already have started on its own when the names came in
  const running = await page.evaluate(() => /停/.test((document.getElementById("lib-analyse") || {}).textContent || ""));
  const visible = await page.isVisible("#lib-analyse");
  // did the click reach the button, and did the pass start? WebKit once lost
  // this click outright (the button kept its label, no toast, no search)
  await page.evaluate(() => {
    window.__libClicks = 0;
    document.addEventListener("click", (e) => {
      if (e.target && e.target.id === "lib-analyse") window.__libClicks++;
    }, true);
  });
  const started = () => until(() => page.evaluate(() =>
    /停/.test((document.getElementById("lib-analyse") || {}).textContent || "")), 3000, 100);
  let clicks = 0;
  if (!running && visible) {
    await page.click("#lib-analyse");
    clicks = 1;
    if (!(await started())) {
      console.log("棋谱库 · 第一下点击没有开始分析:", JSON.stringify(await page.evaluate(() => ({
        clicks: window.__libClicks, active: document.activeElement && document.activeElement.id,
        text: (document.getElementById("lib-analyse") || {}).textContent }))));
      await page.click("#lib-analyse");
      clicks = 2;
    }
  }
  assert(running || clicks === 1, "棋谱库：点一下「分析」就开始了", "点了 " + clicks + " 下");
  l = await until(async () => {
    const x = await lib();
    return x && x.games.every((g) => g.an) ? x : null;
  }, 120000, 500);
  const ms = Date.now() - t0;
  // what the page looked like, printed only when the pass did not finish —
  // the first WebKit run failed here with nothing to go on
  if (!l) {
    console.log("棋谱库 · 未完成时的页面:", JSON.stringify(await page.evaluate(() => {
      const b = document.getElementById("lib-analyse");
      const st = document.getElementById("lib-body");
      let x = null;
      try { x = JSON.parse(localStorage.getItem("chess.v1.library") || "null"); } catch (_) { /* shown as null */ }
      return {
        button: b ? { hidden: b.hidden, text: b.textContent.trim() } : null,
        status: st ? st.textContent.trim().slice(0, 300) : null,
        toasts: window.__toasts, go: window.__go,
        games: x ? x.games.map((g) => ({ an: !!g.an, unplayable: !!g.unplayable, side: g.side || null })) : null,
      };
    })), "running=" + running, "visible=" + visible);
  }
  const nulls = l ? l.games.map((g) => g.an.scalars.filter((s) => s == null).length) : [];
  assert(!!l && nulls.every((n) => n === 0) && l.games.every((g) => g.an.scalars.length === g.plies + 1),
    "棋谱库：三局 " + (ms / 1000).toFixed(1) + " 秒全部分析完，an.scalars 里没有 null", JSON.stringify(nulls));
  assert(!!l && l.games.every((g) => g.side), "棋谱库：打的名字在点「分析」的路上生效，三局都认领为我的");
  await page.waitForTimeout(500);
  await page.click("#lib-open");
  await page.waitForTimeout(300);
  const trap = (l || (await lib())).games.find((g) => /Nxf7/.test(g.sans));
  const go0 = await page.evaluate(() => window.__go);
  await page.click(`#lib-list button[data-lib="${trap.id}"]`);
  const c0 = Date.now();
  const tags = await until(() => page.evaluate(() => {
    const t = [...document.querySelectorAll(".move-list .mvtag")].map((e) => e.textContent.trim());
    return t.length ? t : null;
  }), 1000, 50);
  const go1 = await page.evaluate(() => window.__go);
  assert(!!tags && tags.some((t) => t === "?" || t === "??"),
    "棋谱库：点开那局，" + (Date.now() - c0) + "ms 内标注就在", JSON.stringify(tags));
  assert(go1 === go0, "棋谱库：打开时引擎没有重跑(go " + go0 + " → " + go1 + ")");
  assert(!errs.length, "棋谱库：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 6. 教学对练 --------------------------------------------------------------
await scenario("教学对练", async () => {
  const { ctx, page, errs } = await openPage({ mode: "learn" });
  // 卢塞纳：1K1k4/1P6/8/8/8/8/r7/2R5 w
  const found = await page.evaluate(() => {
    const rows = [...document.getElementById("lesson-list").querySelectorAll("button, .lesson-row")];
    const r = rows.find((x) => /卢塞纳/.test(x.textContent || ""));
    if (r) r.click();
    return !!r;
  });
  assert(found, "教学对练：课程列表里有卢塞纳");
  await page.waitForTimeout(800);
  const occ = (sq) => page.evaluate((q) => {
    const c = document.getElementById("board"), g = c.getContext("2d");
    const step = c.width / 8, f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
    const d = g.getImageData(Math.round(f * step + step * 0.2), Math.round(rk * step + step * 0.2),
      Math.round(step * 0.6), Math.round(step * 0.6)).data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) { const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]; lo = Math.min(lo, l); hi = Math.max(hi, l); }
    return hi - lo > 60;
  }, sq);
  const before = { d8: await occ("d8"), a2: await occ("a2") };
  await clickMove(page, "c1", "d1");
  const t0 = Date.now();
  // Black is in check from d1: the king leaves d8 or the a2 rook interposes
  const replied = await until(async () => !(await occ("d8")) || !(await occ("a2")), 15000, 250);
  assert(before.d8 && before.a2 && replied,
    "教学对练：卢塞纳 Rc1–d1+ 之后，引擎 " + (Date.now() - t0) + "ms 内应了一手", JSON.stringify(before));
  assert(!errs.length, "教学对练：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 7. 持续分析 + 棋谱库 (v7-6-plan §1a) -----------------------------------
// Live analysis on, then a library pass, then one step back on the board in
// the middle of it. Up to 7.5 that step re-armed `go infinite`, which took
// the engine's exclusive lock for good: the pass stopped at "17/23" and never
// moved again. Every game has to finish, and the live line has to come back.
await scenario("持续分析+棋谱库", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, TRAP);
  await page.click("#an-live");
  const livePv = () => page.evaluate(() => {
    const el = document.getElementById("live-line");
    return !!el && !el.hidden && el.querySelectorAll(".pv-chip").length > 0;
  });
  assert(!!(await until(livePv, 6000, 100)), "持续分析+棋谱库：持续分析先跑起来了");
  await page.click("#tab-record");
  await importVia(page, "#lib-import", LIB_PGN, "flows-lib-live.pgn");
  await page.click("#lib-names");
  await page.keyboard.type("hxddh");
  await page.click("#lib-analyse");
  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library") || "null"));
  // mid-pass: wait for the first game to be filed, then step back one move
  const first = await until(async () => {
    const x = await lib();
    return x && x.games.some((g) => g.an) ? x : null;
  }, 40000, 200);
  const go0 = await page.evaluate(() => window.__go);
  await page.evaluate(() => document.getElementById("rep-prev").click());
  const t0 = Date.now();
  const l = await until(async () => {
    const x = await lib();
    return x && x.games.every((g) => g.an) ? x : null;
  }, 90000, 500);
  if (!l) {
    console.log("持续分析+棋谱库 · 卡住时:", JSON.stringify(await page.evaluate(() => ({
      button: (document.getElementById("lib-analyse") || {}).textContent,
      status: ((document.getElementById("lib-body") || {}).textContent || "").slice(0, 200),
      go: window.__go }))), "go0=" + go0);
  }
  assert(!!first && !!l, "持续分析+棋谱库：翻了一步之后，三局仍然全部分析完(" + ((Date.now() - t0) / 1000).toFixed(1) + "s)");
  // the pass is over and 持续分析 is still on: it picks up where the board is
  // — a fresh search, not the chips the pass left standing
  const back = await until(() => page.evaluate(() => {
    const idle = !/停/.test((document.getElementById("lib-analyse") || {}).textContent || "");
    const gos = window.__uci.filter((m) => /^go\b/.test(m));
    return idle && /^go infinite/.test(gos[gos.length - 1] || "");
  }), 8000, 150);
  const on = await page.getAttribute("#an-live", "aria-pressed");
  assert(!!back && on === "true", "持续分析+棋谱库：分析跑完后持续分析自己接上");
  assert(!errs.length, "持续分析+棋谱库：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 8. 分析中不许改棋谱 (v7-6-plan §1b) -------------------------------------
// 存为变着 / 编辑注释 / a move on the board all change what the running pass
// is keyed on, and up to 7.5 one click threw a half-done 精析 away without a
// word. While it runs they are disabled (or refused, for the board); after
// it, they work again.
await scenario("分析中锁棋谱", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, TRAP);
  const busy = () => page.evaluate(() => /停/.test(document.getElementById("an-run").textContent || ""));
  await page.click("#an-run");
  await until(busy, 3000, 50);
  await until(async () => !(await busy()), 60000);
  const state = () => page.evaluate(() => {
    const save = document.querySelector("#pv-line .pv-act");
    return { save: save ? save.disabled : null, plies: document.querySelectorAll(".move-list .mlmove:not(.mlgap)").length };
  });
  const before = await state();
  const kDeep = await page.evaluate(() => window.__toasts.length);
  await page.click("#an-deep");
  await until(busy, 3000, 50);
  // a couple of plies in, like the 7.5 walkthrough's 「停止 3/7」
  await until(() => page.evaluate(() => /停止 [3-9]/.test(document.getElementById("an-run").textContent || "")), 20000, 50);
  const during = await state();
  await page.click("#move-list .mlmenu");
  const menu = await page.evaluate(() => ({
    open: !document.getElementById("move-menu").hidden,
    note: document.getElementById("mm-note").disabled,
    del: document.getElementById("mm-delete").disabled,
  }));
  await page.keyboard.press("Escape").catch(() => {});
  await page.mouse.click(5, 5);
  // the pointer does not give up either: a board move is refused, and says why
  const k = await page.evaluate(() => window.__toasts.length);
  await clickMove(page, "e4", "e2");
  const refused = await until(() => page.evaluate((i) =>
    window.__toasts.slice(i).find((s) => /分析进行中/.test(s)) || null, k), 2000, 100);
  const mid = await state();
  await until(async () => !(await busy()), 90000);
  const after = await state();
  const toasts = await page.evaluate((i) => window.__toasts.slice(i), kDeep);
  assert(before.save === false, "分析中锁棋谱：分析完成后「存为变着」可点", JSON.stringify(before));
  assert(during.save === true && menu.open && menu.note && menu.del,
    "分析中锁棋谱：精析进行中「存为变着」「编辑注释」「删除分支」都不可点", JSON.stringify({ during, menu }));
  assert(!!refused && mid.plies === 13, "分析中锁棋谱：精析进行中在棋盘上走子被拒，并说明原因", JSON.stringify({ refused, mid }));
  assert(after.save === false && after.plies === 13 && toasts.some((s) => /^分析完成/.test(s)) &&
    !toasts.some((s) => /已存为变着/.test(s)),
    "分析中锁棋谱：精析照常跑完，之后「存为变着」又能点了", JSON.stringify({ after, toasts }));
  assert(!errs.length, "分析中锁棋谱：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 9. 分析结果存盘 (v7-6-plan §1c) -----------------------------------------
// A 分析 is 13 s of engine time on a 60-ply game. Up to 7.5 a reload threw it
// away, and so did loading the same game back from 对局历史. Both now put it
// back from storage — and without asking the engine for a single search.
await scenario("分析存盘", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, TRAP);
  await runAn(page, "#an-run", 60000);
  const r0 = await readAn(page);
  assert(r0.tags.length > 0 && !!r0.acc, "分析存盘：先分析一遍", JSON.stringify(r0));
  await page.reload();
  await page.waitForTimeout(900);
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  const r1 = await until(() => readAn(page).then((r) => (r.acc ? r : null)), 3000, 100);
  const go1 = await page.evaluate(() => window.__go);
  assert(!!r1 && r1.acc === r0.acc && r1.tags.join(",") === r0.tags.join(",") && go1 === 0 && !/停/.test(r1.btn),
    "分析存盘：刷新以后精准度和标注都还在，引擎一次没跑(go " + go1 + ")", JSON.stringify({ r0, r1 }));
  const kept = await page.evaluate(() => localStorage.getItem("chess.v1.analyses"));
  assert(!errs.length, "分析存盘：页面没有报错", errs.join(" / "));
  await ctx.close();

  // 对局历史: a fresh profile holding only that store and a record of this game
  const stats = { v: 2, games: [{ id: "flows-h1", t: Date.now() - 60000, diff: "beginner", color: "b",
    result: "loss", moves: 13, pgn: TRAP, ending: "" }] };
  // pvp until the load: an ai board would offer the position to the engine
  // the moment it lands, before the record's colour is restored (the same
  // search 7.5 already made and cancelled) — that is not what is measured here
  const p2 = await openPage({ mode: "pvp", sideTab: "record" },
    { "chess.v1.analyses": kept, "chess.v1.stats": JSON.stringify(stats) });
  await p2.page.click("#tab-record").catch(() => {});
  const row = await until(() => p2.page.isVisible('#hist-body button[data-hist="0"]'), 3000, 100);
  if (row) await p2.page.click('#hist-body button[data-hist="0"]');
  const r2 = await until(() => readAn(p2.page).then((r) => (r.acc && r.tags.length ? r : null)), 3000, 100);
  const go2 = await p2.page.evaluate(() => window.__go);
  assert(!!r2 && r2.acc === r0.acc && r2.tags.join(",") === r0.tags.join(",") && go2 === 0,
    "分析存盘：从对局历史载入同一局，分析直接回来，引擎一次没跑(go " + go2 + ")", JSON.stringify({ row, r2 }));
  assert(!p2.errs.length, "分析存盘：对局历史这一步页面没有报错", p2.errs.join(" / "));
  await p2.ctx.close();
});

// --- 10. 精析回写棋谱库 (v7-6-plan §1c) ----------------------------------------
// 7.5: open a library game, 精析 it, and the library still said budget 200
// and the old accuracy. The deeper look now goes back to the entry the way
// 「再深一遍」 does, drills included (reviseMines).
await scenario("精析回写库", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp", sideTab: "record" }, { "chess.v1.mines": FAKE_MINES });
  const l0 = await libraryPass(page, "flows-lib-deep1.pgn");
  const trap0 = l0 && l0.games.find((g) => /Nxf7/.test(g.sans));
  const fake0 = (await minesOf(page)).some((m) => m.id === FAKE_DRILL.id);
  assert(!!trap0 && trap0.an.budget === 200 && fake0, "精析回写库：库分析完，那局 budget 200，300ms 的假题还在",
    JSON.stringify({ budget: trap0 && trap0.an.budget, fake0 }));
  await page.waitForTimeout(500);
  await page.click("#lib-open");
  await page.waitForTimeout(300);
  await page.click(`#lib-list button[data-lib="${trap0.id}"]`);
  await page.waitForTimeout(500);
  await page.click("#tab-play");
  const ms = await runAn(page, "#an-deep", 90000);
  const shown = await readAn(page);
  const l1 = await libOf(page);
  const trap1 = l1.games.find((g) => g.id === trap0.id);
  const others = l1.games.filter((g) => g.id !== trap0.id).map((g) => g.an.budget);
  const pct = (shown.acc.match(/(\d+)%/g) || []).map((x) => Number(x.replace("%", "")));
  assert(trap1.an.budget === 400 && pct.length === 2 && pct[0] === trap1.an.acc.w && pct[1] === trap1.an.acc.b &&
    others.every((b) => b === 200),
    "精析回写库：精析 " + (ms / 1000).toFixed(1) + " 秒完成，库里那局 budget 200 → 400，精准度和界面一致，别的局不动",
    JSON.stringify({ budget: trap1.an.budget, acc: trap1.an.acc, shown: shown.acc, others }));
  const fake1 = (await minesOf(page)).some((m) => m.id === FAKE_DRILL.id);
  assert(!fake1, "精析回写库：回写走了 reviseMines，300ms 的假题被 400ms 撤回");
  assert(!errs.length, "精析回写库：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 11. 再深一遍 (v7-6-plan §6.2) ---------------------------------------------
await scenario("再深一遍", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp", sideTab: "record" }, { "chess.v1.mines": FAKE_MINES });
  const l0 = await libraryPass(page, "flows-lib-deep2.pgn");
  const trap0 = l0 && l0.games.find((g) => /Nxf7/.test(g.sans));
  await page.waitForTimeout(500);
  await page.click("#lib-open");
  await page.waitForTimeout(300);
  const k = await page.evaluate(() => window.__toasts.length);
  const t0 = Date.now();
  await page.click(`#lib-list button[data-lib-deep="${trap0.id}"]`);
  const l1 = await until(async () => {
    const x = await libOf(page);
    const g = x && x.games.find((e) => e.id === trap0.id);
    return g && g.an.budget === 400 ? x : null;
  }, 60000, 300);
  const done = await until(() => page.evaluate((i) =>
    window.__toasts.slice(i).find((s) => /深分析完/.test(s)) || null, k), 3000, 100);
  const g1 = l1 && l1.games.find((e) => e.id === trap0.id);
  assert(!!g1 && g1.an.scalars.every((x) => x != null) && g1.an.scalars.length === g1.plies + 1 && !!done,
    "再深一遍：" + ((Date.now() - t0) / 1000).toFixed(1) + " 秒按 400ms 重析完那一局，没有空洞，并报告结果", done);
  const fake1 = (await minesOf(page)).some((m) => m.id === FAKE_DRILL.id);
  assert(!fake1 && /撤销 [1-9]/.test(done || ""), "再深一遍：reviseMines 撤回了 300ms 的假题", done);
  assert(!errs.length, "再深一遍：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 12. 人机·高档 + 棋钟 (v7-6-plan §6.3) ---------------------------------------
// hard is UCI_Elo 2200 at 900 ms and normal 1700 at 700 ms; a clock caps the
// think time at a thirtieth of what is left on it (never below 150).
await scenario("人机高档棋钟", async () => {
  // Black's clock stands at 20 s with White to move, so it does not tick while
  // the engine boots (~10 s from a cold page here); the budget is then
  // 20000 / 30 ≈ 666 ms, under hard's own 900
  const save = { v: 1, pgn: '[Event "flows"]\n[Result "*"]\n\n1. e4 e5 *', savedAt: Date.now(),
    clock: { tc: "3", w: 170000, b: 20000, started: true } };
  const hard = await openPage({ mode: "ai", difficulty: "hard", humanColor: "w", timeControl: "3" },
    { "chess.v1.save": JSON.stringify(save) });
  // the boot the page starts on its own for an ai game: wait for it to answer
  const ready = await until(() => hard.page.evaluate(() => window.__uci.includes("uci")), 30000, 200);
  await hard.page.waitForTimeout(3000);
  await clickMove(hard.page, "g1", "f3");
  const t0 = Date.now();
  const n = await until(() => plies(hard.page).then((p) => (p >= 4 ? p : 0)), 15000, 100);
  const uci = await hard.page.evaluate(() => window.__uci);
  const g = await savedAt(hard.page, 4, 3000);
  const clk = await hard.page.evaluate(() => (JSON.parse(localStorage.getItem("chess.v1.save") || "{}").clock) || null);
  const ms = uci.filter((m) => /^go movetime/.test(m)).map((m) => Number(m.split(" ")[2]));
  assert(!!ready && n >= 4 && uci.includes("setoption name UCI_Elo value 2200") && ms.length === 1 && ms[0] >= 600 && ms[0] < 667,
    "人机高档棋钟：hard 档、黑方钟上 20 秒，引擎按 UCI_Elo 2200、压到 " + ms[0] + "ms(不是 900)应着(" + (Date.now() - t0) + "ms)", JSON.stringify({ ready, n, uci }));
  assert(!!g && !!clk && clk.b < 20000 && clk.b > 15000 && clk.w <= 170000, "人机高档棋钟：引擎那一侧的钟在走", JSON.stringify(clk));
  assert(!hard.errs.length, "人机高档棋钟：页面没有报错", hard.errs.join(" / "));
  await hard.ctx.close();

  const normal = await openPage({ mode: "ai", difficulty: "normal", humanColor: "w", timeControl: "5+3" });
  await clickMove(normal.page, "e2", "e4");
  const n2 = await until(() => plies(normal.page).then((p) => (p >= 2 ? p : 0)), 15000, 100);
  const uci2 = await normal.page.evaluate(() => window.__uci);
  assert(n2 >= 2 && uci2.includes("setoption name UCI_Elo value 1700") && uci2.includes("go movetime 700"),
    "人机高档棋钟：normal 档、5+3 钟上时间充足，按 UCI_Elo 1700 / 700ms 应着", JSON.stringify(uci2));
  assert(!normal.errs.length, "人机高档棋钟：normal 档页面没有报错", normal.errs.join(" / "));
  await normal.ctx.close();
});

// --- 13. multipv=3：分析与持续分析 (v7-6-plan §6.4) ------------------------------
await scenario("多主变", async () => {
  const { ctx, page, errs } = await openPage({ mode: "pvp", multipv: 3 });
  await openPgn(page, TRAP);
  await runAn(page, "#an-run", 90000);
  const alt = await page.evaluate(() => document.querySelectorAll("#pv-line .pv-alt-row").length);
  const uci = await page.evaluate(() => window.__uci);
  assert(alt === 2 && uci.includes("setoption name MultiPV value 3"),
    "多主变：multipv=3 分析，最后一个局面下列出另外两条变化", JSON.stringify({ alt }));
  await page.click("#an-live");
  const rows = await until(() => page.evaluate(() => {
    const el = document.getElementById("live-line");
    const n = el && !el.hidden ? el.querySelectorAll(".pv-alt-row").length : 0;
    return n === 3 ? n : 0;
  }), 6000, 100);
  assert(rows === 3, "多主变：持续分析同时显示三条主变", rows);
  assert(!errs.length, "多主变：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 14. 从 FEN 起始、黑先的对局 (v7-6-plan §6.5) --------------------------------
// The trap again, handed over after 1. e4: Black moves first and the list
// opens on "1. … e5". Every mark has to land on the move it judges — an
// off-by-one here moves White's blunders onto Black's replies.
await scenario("FEN黑先", async () => {
  const FEN = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
  const pgn = '[Event "flows"]\n[Site "-"]\n[Date "2026.09.25"]\n[White "hxddh"]\n[Black "rival"]\n[Result "*"]\n' +
    '[SetUp "1"]\n[FEN "' + FEN + '"]\n\n1... e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 *\n';
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, pgn);
  const head = await page.evaluate(() => {
    const row = document.querySelector(".move-list .mlrow");
    return row ? { no: (row.querySelector(".mlnum") || {}).textContent, gap: !!row.querySelector(".mlgap") } : null;
  });
  assert((await plies(page)) === 12 && !!head && head.no === "1." && head.gap, "FEN黑先：12 半着，棋谱从「1. … e5」开始", JSON.stringify(head));
  await runAn(page, "#an-run", 60000);
  const r = await readAn(page);
  const sans = ["e5", "Nf3", "Nc6", "Bc4", "Nd4", "Nxe5", "Qg5", "Nxf7", "Qxg2", "Rf1", "Qxe4+", "Be2"];
  // data-i is the ply, 1-based: odd plies are Black's here. The accuracy is
  // the report card's headline now (v7-7-plan §5): each figure over its side
  const marked = r.tags.filter((x) => /\?$/.test(x)).map((x) => sans[parseInt(x, 10) - 1]);
  assert(marked.length > 0 && marked.some((s) => s === "Nxe5" || s === "Nxf7") && !!r.acc && /\d+%\s*白.*\d+%\s*黑/.test(r.acc),
    "FEN黑先：分析完，? / ?? 落在白方的 Nxe5 / Nxf7 上，双方精准度都有", JSON.stringify({ marked, acc: r.acc }));
  assert(!errs.length, "FEN黑先：页面没有报错", errs.join(" / "));
  await ctx.close();
});

// --- 15. 为什么 + 再试一次 (v7-8-plan §3) ---------------------------------------
// The walk-through game x02: 9. a3 walks into …Nxc2+, the knight hitting king
// and rook at once. The report has to say so — 捉双 and 车 — and 再试一次 from
// the position before 9. a3 has to mark a3 wrong and the engine's move right.
// The fixed-line version of the same sentence is in test-explain.mjs; this is
// the real engine's line reaching the page.
await scenario("为什么", async () => {
  const pgn = '[Event "flows"]\n[Site "-"]\n[Date "2026.09.26"]\n[White "hxddh"]\n[Black "rival"]\n[Result "*"]\n\n' +
    "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nf6 4. Ng5 d5 5. exd5 Nxd5 6. Nxf7 Kxf7 7. Qf3+ Ke6 8. Nc3 Nb4 9. a3 Nxc2+ 10. Kd1 Nxa1 11. Nxd5 Kd6 *\n";
  const { ctx, page, errs } = await openPage({ mode: "pvp" });
  await openPgn(page, pgn);
  assert((await plies(page)) === 22, "为什么：导入 22 半着的对局", await plies(page));
  await runAn(page, "#an-run", 90000);
  // 9. a3 is ply 16 (0-based), data-i 17 in the move list
  const tag = await page.evaluate(() => {
    const b = document.querySelector('.move-list .mlmove[data-i="17"] .mvtag');
    return b ? b.textContent.trim() : "";
  });
  assert(tag === "?" || tag === "??", "为什么：9. a3 被标成 ? 或 ??", tag);
  const row = await page.evaluate(() => {
    const r = document.querySelector('.rv-moment[data-ply="16"]');
    return r ? { why: r.querySelector(".rv-mo-why").textContent, retry: !!r.querySelector(".rv-mo-retry") } : null;
  });
  assert(!!row && /捉双/.test(row.why) && /车/.test(row.why) && row.retry,
    "为什么：报告里 9. a3 的说明有「捉双」和「车」，旁边是「再试一次」", JSON.stringify(row));
  // on the move itself, under the engine line
  await page.click('.rv-moment[data-ply="16"] .rv-mo-jump');
  await page.waitForTimeout(200);
  const at = await page.evaluate(() => {
    const w = document.getElementById("why-line");
    return w && !w.hidden ? w.textContent : "";
  });
  assert(/捉双/.test(at) && /车/.test(at), "为什么：光标停在 9. a3 上，引擎线下面也是这一句", at);
  if (process.env.FLOWS_SHOTS) await page.screenshot({ path: process.env.FLOWS_SHOTS + "/why-line.png" });

  // 再试一次: a3 again is wrong
  await page.click('.rv-moment[data-ply="16"] .rv-mo-retry');
  await page.waitForTimeout(200);
  const box = await page.evaluate(() => {
    const b = document.getElementById("retry-box");
    return { shown: !!b && !b.hidden, pv: !document.getElementById("pv-line").hidden, ask: b ? b.textContent : "" };
  });
  assert(box.shown && !box.pv && /第 9 回合/.test(box.ask), "再试一次：出现练习框，问第 9 回合；引擎线收起（那是答案）", JSON.stringify(box));
  await clickMove(page, "a2", "a3");
  const wrong = await until(() => page.evaluate(() => {
    const v = document.querySelector("#retry-box .rt-verdict");
    return v && v.classList.contains("is-wrong") ? {
      best: (document.querySelector("#retry-box .rt-best .why-san") || {}).title || "",
      why: (document.querySelector("#retry-box .rt-why") || {}).textContent || "",
    } : null;
  }), 5000);
  assert(!!wrong && !!wrong.best && /捉双/.test(wrong.why), "再试一次：再走 a3 判错，给出引擎最佳和那一句", JSON.stringify(wrong));
  if (process.env.FLOWS_SHOTS) await page.screenshot({ path: process.env.FLOWS_SHOTS + "/retry-wrong.png" });
  // …and the engine's move is right
  await page.click("#rt-again");
  await page.waitForTimeout(150);
  const g = new Chess("r1bq1b1r/ppp3pp/4k3/3np3/1nB5/2N2Q2/PPPP1PPP/R1B1K2R w KQ - 4 9");
  const mv = wrong ? g.move(wrong.best) : null;
  if (mv) await clickMove(page, mv.from, mv.to);
  const right = await until(() => page.evaluate(() => {
    const v = document.querySelector("#retry-box .rt-verdict");
    return !!v && v.classList.contains("is-right");
  }), 20000);
  assert(!!mv && right, "再试一次：走引擎最佳 " + (mv && mv.san) + " 判对");
  if (process.env.FLOWS_SHOTS) await page.screenshot({ path: process.env.FLOWS_SHOTS + "/retry-right.png" });
  await page.click("#rt-back");
  await page.waitForTimeout(200);
  const back = await page.evaluate(() => ({
    box: document.getElementById("retry-box").hidden,
    why: !document.getElementById("why-line").hidden,
    sel: (document.querySelector(".move-list .mlmove.cur, .move-list .mlmove[aria-current]") || {}).dataset,
  }));
  assert(back.box && back.why, "再试一次：「回到复盘」回到 9. a3 这一手，说明还在", JSON.stringify(back));
  assert(!errs.length, "为什么：页面没有报错", errs.join(" / "));
  await ctx.close();
});

await browser.close();
server.close();
console.log("用时", ((Date.now() - T0) / 1000).toFixed(1) + "s");
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("engine flows e2e: all passed");
