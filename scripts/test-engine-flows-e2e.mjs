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
async function openPage(settings) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 }, locale: "zh-CN" });
  await ctx.addInitScript((s) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify(Object.assign(
      { langId: "zh-CN", sideTab: "play", soundOn: false }, s)));
    localStorage.setItem("chess.panelOpen", "1");
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
    window.Worker = function (...a) {
      const w = new W(...a);
      const pm = w.postMessage.bind(w);
      w.postMessage = (m, ...r) => {
        if (typeof m === "string" && /^go\b/.test(m)) window.__go++;
        return pm(m, ...r);
      };
      return w;
    };
    window.Worker.prototype = W.prototype;
  }, settings);
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
  await page.fill("#lib-names", "hxddh");
  await page.dispatchEvent("#lib-names", "change");
  await page.waitForTimeout(300);
  const lib = () => page.evaluate(() => JSON.parse(localStorage.getItem("chess.v1.library") || "null"));
  let l = await lib();
  assert(l && l.games.length === 3 && l.games.every((g) => g.side), "棋谱库：三局进库，都认领为我的", l && l.games.length);
  const t0 = Date.now();
  // the pass may already have started on its own when the names came in
  const running = await page.evaluate(() => /停/.test((document.getElementById("lib-analyse") || {}).textContent || ""));
  if (!running && await page.isVisible("#lib-analyse")) await page.click("#lib-analyse");
  l = await until(async () => {
    const x = await lib();
    return x && x.games.every((g) => g.an) ? x : null;
  }, 120000, 500);
  const ms = Date.now() - t0;
  const nulls = l ? l.games.map((g) => g.an.scalars.filter((s) => s == null).length) : [];
  assert(!!l && nulls.every((n) => n === 0) && l.games.every((g) => g.an.scalars.length === g.plies + 1),
    "棋谱库：三局 " + (ms / 1000).toFixed(1) + " 秒全部分析完，an.scalars 里没有 null", JSON.stringify(nulls));
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

await browser.close();
server.close();
console.log("用时", ((Date.now() - T0) / 1000).toFixed(1) + "s");
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("engine flows e2e: all passed");
