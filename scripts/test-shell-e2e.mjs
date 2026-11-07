/**
 * The app inside the shell (services/shell.js, 20.0 E3), Chromium or WebKit,
 * with a stub `window.zero` that records what the page invokes and lets the
 * test emit what main.zig emits:
 *
 *   menu         a "shortcut" event per menu command: 我 / 下 / 学 / 设置 are
 *                places; 翻转棋盘 and 悔棋 act on 下; 新对局 from 我 opens 下
 *                and its sheet; ⌘Z in a text field undoes the text, not a move
 *   language     chess.setMenuLanguage at start and on every change
 *   open files   "open:files": each waiting file is read (chess.openedFile,
 *                in pieces) and imported on 我; a file that could not be read
 *                is named; files waiting before the page came are read at start
 *   browser      without the shell nothing of this loads
 *
 *   node scripts/test-shell-e2e.mjs [--dev]   (E2E_REQUIRED=1: a missing browser fails)
 */
import { startServer } from "./serve-app.mjs";
import { launchBrowser } from "./app/browser.mjs";

process.removeAllListeners("warning");
let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };
const DEV = process.argv.includes("--dev");
if (!DEV) await (await import("./build-app.mjs")).buildApp({ quiet: true });
const srv = await startServer();
const BASE = DEV ? srv.url : srv.dist;
const browser = await launchBrowser();
const errors = [];

const PGN1 = '[Event "A"]\n[White "Me"]\n[Black "X"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n\n[Event "B"]\n[White "Y"]\n[Black "Me"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n';
const PGN2 = '[Event "C"]\n[White "Me"]\n[Black "Z"]\n[Result "1/2-1/2"]\n\n1. d4 d5 2. c4 e6 1/2-1/2\n';

/** The stub shell: `__queue` holds the files chess.openedFile hands out, in pieces of 40 bytes. */
const STUB = (waiting) => `(() => {
  const listeners = {};
  const b64 = (u) => { let s = ""; for (const x of u) s += String.fromCharCode(x); return btoa(s); };
  window.__calls = [];
  window.__queue = ${JSON.stringify(waiting)};
  let cur = null;
  window.__emit = (name, detail) => (listeners[name] || []).forEach((fn) => fn(detail));
  window.zero = {
    on(name, fn) { (listeners[name] ||= []).push(fn); return () => {}; },
    async invoke(cmd, p) {
      window.__calls.push([cmd, p]);
      if (cmd === "chess.setMenuLanguage") return { ok: true, applied: true, lang: p.lang };
      if (cmd === "chess.openedFile") {
        if (p && p.token) {
          const part = cur.bytes.subarray(p.offset, p.offset + 40);
          return { b64: b64(part), more: p.offset + 40 < cur.bytes.length };
        }
        const next = window.__queue.shift();
        if (!next) return { none: true };
        if (next.error) return { error: next.error, name: next.name };
        cur = { bytes: new TextEncoder().encode(next.text) };
        const part = cur.bytes.subarray(0, 40);
        return { name: next.name, b64: b64(part), more: cur.bytes.length > 40, token: 3 };
      }
      throw new Error("no " + cmd);
    },
  };
})();`;

async function open(waiting = [], hash = "#/play") {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(STUB(waiting));
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(e.message + " " + (e.stack || "").split("\n").slice(0, 3).join(" ")));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  await page.goto(BASE + "?engine=fake&db=memory&autoreview=0" + hash);
  await page.waitForFunction(() => window.__app && window.__app.shell);
  await page.evaluate(() => window.__app.shell);
  return { ctx, page };
}
const path = (page) => page.evaluate(() => window.__app.router.route.peek().path + (window.__app.router.route.peek().rest.length ? "/" + window.__app.router.route.peek().rest.join("/") : ""));
const menu = (page, cmd) => page.evaluate((c) => window.__emit("shortcut", { id: c, command: c }), cmd);
const calls = (page, cmd) => page.evaluate((c) => window.__calls.filter(([x]) => x === c).map(([, p]) => p), cmd);
const count = (page) => page.evaluate(async () => (await window.__app.ready).query("table.count", { table: "library" }));

// --- the menu ------------------------------------------------------------------------------
{
  const { ctx, page } = await open();
  await page.waitForSelector("[data-page=play] canvas");
  assert(!!(await page.evaluate(() => window.__app.shell)), "in the shell, the shell module starts after the first page");
  const langs = await calls(page, "chess.setMenuLanguage");
  assert(langs.length >= 1 && langs[0].lang === "zh", "the menu bar is told the language at start (" + JSON.stringify(langs) + ")");

  await menu(page, "go.me");
  await page.waitForSelector("[data-test=library]");
  assert(await path(page) === "/me", "我 (go.me) opens 我");
  await menu(page, "go.learn");
  await page.waitForFunction(() => window.__app.router.route.peek().path === "/learn");
  assert(true, "学 (go.learn) opens 学");
  await menu(page, "go.settings");
  await page.waitForFunction(() => window.__app.router.route.peek().path === "/settings");
  assert(true, "设置… (go.settings) opens 设置");

  // 新对局 from elsewhere: 下, and its sheet
  await menu(page, "game.new");
  await page.waitForSelector("[data-test=opp-card]", { timeout: 10000 });
  assert(await path(page) === "/play", "新对局 (game.new) from 设置 opens 下 and the new-game sheet");
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.querySelector("[data-test=opp-card]"));

  await menu(page, "game.flip");
  await page.waitForFunction(() => window.__play.flipped.peek() === true);
  assert(true, "翻转棋盘 (game.flip) flips the board on 下");
  await menu(page, "game.flip");
  await page.waitForFunction(() => window.__play.flipped.peek() === false);

  // 悔棋: a move, then the menu takes it back
  await page.evaluate(() => window.__app.store.dispatch("play.new", { id: "shell-e2e", mode: "pvp" }));
  await page.evaluate(() => window.__app.store.dispatch("play.move", { uci: "e2e4", now: Date.now() }));
  const plies = () => page.evaluate(() => window.__app.store.get().play.game.moves.length);
  const before = await plies();
  await menu(page, "game.undo");
  await page.waitForTimeout(300);
  assert(before === 1 && await plies() === 0, "悔棋 (game.undo) takes the move back (" + before + " → " + await plies() + ")");

  // ⌘Z in a text field: the field's undo, never a move
  await page.evaluate(() => window.__app.store.dispatch("play.move", { uci: "e2e4", now: Date.now() }));
  await menu(page, "go.me");
  await page.waitForSelector("[data-test=library]");
  const box = await page.$("[data-test=library] input");
  if (box) {
    await box.focus();
    await page.keyboard.type("abc");
    await menu(page, "game.undo");
    await page.waitForTimeout(300);
    assert(await plies() === 1, "⌘Z (game.undo) in 我's search box does not take a move back");
  } else {
    assert(await plies() === 1, "game.undo off 下 takes no move back");
  }

  // the language
  await page.evaluate(() => window.__app.store.dispatch("settings.set", { key: "lang", value: "en" }));
  await page.waitForFunction(() => window.__calls.some(([c, p]) => c === "chess.setMenuLanguage" && p.lang === "en"));
  assert(true, "a language change rebuilds the menu bar (chess.setMenuLanguage en)");
  await ctx.close();
}

// --- files the OS hands over --------------------------------------------------------------------
{
  // one waiting before the page came
  const { ctx, page } = await open([{ name: "open-1.pgn", text: PGN1 }]);
  await page.waitForFunction(() => /done/.test((document.querySelector("[data-test=import-status]") || {}).dataset?.state || ""), null, { timeout: 30000 });
  assert(await path(page) === "/me" && await count(page) === 2, "a file waiting at start is imported on 我 (" + await count(page) + " games)");
  const reads = await calls(page, "chess.openedFile");
  assert(reads.some((p) => p.token === 3 && p.offset > 0), "read in pieces by its token");

  // one while the app runs, from 下
  await page.evaluate(() => { document.querySelector("[data-test=import-status]").dataset.state = ""; });
  await menu(page, "go.play");
  await page.waitForFunction(() => window.__app.router.route.peek().path === "/play");
  await page.evaluate((t) => { window.__queue.push({ name: "open-2.pgn", text: t }, { name: "bad.pgn", error: "read_failed" }); window.__emit("open:files", { waiting: 2 }); }, PGN2);
  await page.waitForFunction(() => /error/.test(document.querySelector("[data-test=import-status]")?.dataset.state || ""), null, { timeout: 30000 });
  const text = await page.textContent("[data-test=import-status]");
  assert(await path(page) === "/me" && await count(page) === 3, "a file opened while 下 is on screen: 我, imported (" + await count(page) + " games)");
  assert(/bad\.pgn/.test(text), "a file that could not be read is named (" + text + ")");
  await ctx.close();
}

// --- a browser: none of it -------------------------------------------------------------------------
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  const loaded = [];
  page.on("request", (r) => loaded.push(r.url()));
  await page.goto(BASE + "?engine=fake&db=memory#/play");
  await page.waitForSelector("[data-page=play] canvas");
  await page.waitForTimeout(500);
  assert(!loaded.some((u) => /shell\.js|shell-[^/]*\.js/.test(u)) && await page.evaluate(async () => (await window.__app.shell) === null), "in a browser the shell module is never loaded");
  await ctx.close();
}

const real = errors.filter((e) => !/favicon/.test(e));
assert(real.length === 0, "no page errors" + (real.length ? ": " + real.join(" | ") : ""));
await browser.close();
await srv.close();
console.log("\ntest-shell-e2e: " + passed + " passed, " + failed + " failed");
process.exit(failed ? 1 : 0);
