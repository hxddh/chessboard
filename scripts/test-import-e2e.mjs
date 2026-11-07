/**
 * 导入 PGN on 我 (ADR 0003 「导入」), Chromium, the fake engine:
 *
 *   browser    the picker is the browser's: a PGN with comments, variations
 *              and NAGs comes in; the count and the report say so; your
 *              rated games move 你的水平; importing it again adds nothing
 *   19.0       「导出全部数据」 (scripts/app/fixtures/v19-export.json) imports
 *              its history, library and slot games
 *   bad input  a malformed PGN: the good game comes in, each bad one is listed
 *              with its line; a file that is not PGN says so
 *   native     in the app the picker is chess.openPgn (a stub zero.invoke that
 *              answers in pieces, as dialogs.zig does); cancelling does nothing
 *   large      3,000 games: the page keeps painting (no frame gap ≥ 250 ms)
 *              and every game is in the library
 *
 *   node scripts/test-import-e2e.mjs [--dev]   (E2E_REQUIRED=1: a missing browser fails)
 */
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const DEV = process.argv.includes("--dev");
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchChromium();
const errors = [];
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), "app", "fixtures");
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "import-e2e-"));
const file = (name, text) => { const p = path.join(TMP, name); fs.writeFileSync(p, text); return p; };

const STUDY = `[Event "Club"]
[White "Me"]
[Black "Rival"]
[BlackElo "900"]
[Result "1-0"]

1. e4 {open} e5 2. Nf3 $1 (2. f4 exf4) 2... Nc6 3. Bc4!? Nd4?? 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 1-0

[Event "Club"]
[White "Rival2"]
[Black "Me"]
[WhiteElo "950"]
[Result "0-1"]

1. f3 e5 2. g4 Qh4# 0-1

[Event "Club"]
[White "Me"]
[Black "Rival3"]
[BlackElo "1000"]
[Result "1/2-1/2"]

1. d4 d5 2. c4 e6 3. Nc3 Nf6 1/2-1/2
`;

async function open({ init = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?engine=fake&db=memory#/me");
  await page.waitForSelector("[data-test=import-pgn]");
  return { ctx, page };
}
const status = (page) => page.$eval("[data-test=import-status]", (e) => ({ text: e.textContent, state: e.dataset.state || "" }));
const waitDone = (page, timeout = 60000) => page.waitForFunction(() => /done|error/.test(document.querySelector("[data-test=import-status]").dataset.state || ""), null, { timeout });
async function pick(page, p) {
  await page.$eval("[data-test=import-status]", (e) => { e.dataset.state = ""; });
  const [chooser] = await Promise.all([page.waitForEvent("filechooser"), page.click("[data-test=import-pgn]")]);
  await chooser.setFiles(p);
  await waitDone(page);
}
const count = (page) => page.evaluate(async () => (await window.__app.ready).query("table.count", { table: "library" }));
const rating = (page) => page.$eval("[data-test=rating]", (e) => Number(e.dataset.rating));

// --- a PGN through the browser's picker --------------------------------------------------
{
  const { ctx, page } = await open();
  assert(/还没有导入/.test(await page.textContent("[data-test=lib-count]")), "an empty library says how to fill it");
  const r0 = await rating(page);
  await pick(page, file("study.pgn", STUDY));
  let s = await status(page);
  assert(s.state === "done" && /导入了 3 局/.test(s.text) && /Me/.test(s.text), "three games imported, and whose they are (" + s.text + ")");
  assert(await count(page) === 3 && /3 局/.test(await page.textContent("[data-test=lib-count]")), "the library has them");
  const lib = await page.evaluate(async () => (await window.__app.ready).query("events.since", { after: 0, limit: 100 }));
  const imp = lib.filter((e) => e.type === "game.import");
  assert(imp.length === 3 && imp[0].sans.startsWith("e4 e5 Nf3 Nc6 Bc4 Nd4") && imp.every((e) => e.you && e.opp), "one game.import event a game: the mainline, your side, the opponent's rating");
  const r1 = await rating(page);
  assert(r1 !== r0, "your rated games moved 你的水平 (" + r0 + " → " + r1 + ")");
  await pick(page, file("study-again.pgn", STUDY));
  s = await status(page);
  assert(/没有新的对局/.test(s.text) && /3 局已经在棋谱库里/.test(s.text) && await count(page) === 3, "importing it again adds nothing (" + s.text + ")");

  // 19.0's 「导出全部数据」
  await pick(page, path.join(FIX, "v19-export.json"));
  s = await status(page);
  assert(/19\.0/.test(s.text) && /导入了 6 局/.test(s.text) && await count(page) === 9, "19.0's export: history, library and slot games (" + s.text + ")");

  // bad input
  await pick(page, path.join(FIX, "malformed.pgn"));
  s = await status(page);
  const errs = await page.$$eval("[data-test=import-errors] li", (ls) => ls.map((l) => l.textContent));
  assert(/导入了 1 局/.test(s.text) && /3 局读不了/.test(s.text), "a malformed file: the good game comes, the bad ones are counted (" + s.text + ")");
  assert(errs.length === 3 && /第 15 行.*不合法的着法 Nf9/.test(errs[0]) && /括号/.test(errs[1]) && /FEN/.test(errs[2]), "each bad game named with its line and why (" + errs.join(" | ") + ")");
  await pick(page, file("list.txt", "milk\neggs\nbread\n"));
  s = await status(page);
  assert(s.state === "error" && /没有找到对局/.test(s.text), "a file that is not PGN says so (" + s.text + ")");
  await pick(page, file("other.json", "{\"hello\": 1}"));
  assert(/不是 19\.0/.test((await status(page)).text), "a JSON file that is not 19.0's export says so");
  await ctx.close();
}

// --- in the app: chess.openPgn, in pieces ------------------------------------------------------
{
  const text = STUDY;
  const init = `(() => {
    const bytes = new TextEncoder().encode(${JSON.stringify(text)});
    const b64 = (u) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
    const PIECE = 100;
    window.__calls = [];
    window.__cancel = false;
    window.zero = { invoke: async (cmd, p) => {
      window.__calls.push([cmd, p]);
      if (cmd !== "chess.openPgn") throw new Error("no " + cmd);
      if (window.__cancel) return { cancelled: true };
      const off = p.offset || 0;
      const part = bytes.subarray(off, off + PIECE);
      return { name: "study.pgn", b64: b64(part), more: off + PIECE < bytes.length, token: 7 };
    } };
  })();`;
  const { ctx, page } = await open({ init });
  await page.evaluate(() => { window.__cancel = true; });
  await page.click("[data-test=import-pgn]");
  await page.waitForTimeout(200);
  assert((await status(page)).text === "" && await count(page) === 0, "cancelling the native dialog does nothing");
  await page.evaluate(() => { window.__cancel = false; });
  await page.click("[data-test=import-pgn]");
  await waitDone(page);
  const calls = await page.evaluate(() => window.__calls.filter(([c]) => c === "chess.openPgn").map(([, p]) => p));
  assert(calls.length > 2 && calls[1].title && calls.slice(2).every((p) => p.token === 7 && p.offset > 0), "the native dialog, then the file in pieces by its token (" + calls.length + " calls)");
  assert(/导入了 3 局/.test((await status(page)).text) && await count(page) === 3, "a file read in pieces imports whole");
  await ctx.close();
}

// --- a large file: the page keeps painting ----------------------------------------------------
{
  const one = (i) => `[Event "Blitz ${i}"]\n[Site "x"]\n[White "Me"]\n[Black "Opp${i % 40}"]\n[BlackElo "${800 + (i % 50) * 10}"]\n[Result "${i % 3 ? "1-0" : "0-1"}"]\n\n` +
    `1. e4 e5 2. Nf3 Nc6 3. Bb5 {Ruy} a6 (3... Nf6 4. O-O) 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 9. h3 Nb8 10. d4 Nbd7 ${i % 3 ? "1-0" : "0-1"}\n`;
  const big = file("big.pgn", Array.from({ length: 3000 }, (_, i) => one(i)).join("\n"));
  const { ctx, page } = await open();
  await page.evaluate(() => {
    window.__gap = 0;
    let last = performance.now();
    const tick = (t) => { window.__gap = Math.max(window.__gap, t - last); last = t; window.__raf = requestAnimationFrame(tick); };
    window.__raf = requestAnimationFrame(tick);
  });
  const t0 = Date.now();
  await pick(page, big);
  const ms = Date.now() - t0;
  const gap = await page.evaluate(() => { cancelAnimationFrame(window.__raf); return window.__gap; });
  assert(await count(page) === 3000, "3,000 games in the library (" + ms + " ms)");
  assert(gap < 250, "the page kept painting while it read and saved them (longest frame gap " + Math.round(gap) + " ms)");
  console.log("MEASURED " + JSON.stringify({ import3000_ms: ms, import3000_max_frame_gap_ms: Math.round(gap) }));
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log("\ntest-import-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
