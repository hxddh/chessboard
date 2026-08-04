/**
 * Browser check for the board: play into a real check and a real checkmate and
 * assert the pieces are still there.
 *
 * This is the test that was missing. 1.12 shipped a `CHECK is not defined` in
 * draw(), thrown before the piece loop, so from the first check onward the
 * board showed 64 squares and nothing standing on them — and the status pill
 * and move list froze, because the throw unwound the rest of sync(). Two
 * releases went out that way. The Node-side render fuzz in test-chess.mjs now
 * runs every draw() branch in CI; this one proves the same thing end to end,
 * against a real canvas, through real clicks.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when either is
 * missing, so it can sit in the suite without becoming a hard dependency —
 * except under E2E_REQUIRED=1, where a skip is a failure. The release gate
 * sets it, so "the browser tests passed" cannot mean "they never ran":
 *   node scripts/test-board-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";

const MIME = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript" };
const server = http.createServer((req, res) => {
  let p = req.url.split("?")[0];
  if (p === "/") p = "/index.html";
  // the 9MB engine is generated, not committed; the board never needs it
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

/** Play `line` in a fresh page and report what the board and the panel show. */
async function play(theme, line) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript((th) => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: th }));
    localStorage.setItem("chess.panelOpen", "1");
  }, theme);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel").catch(() => {});
  const xy = (s) => page.evaluate((sq) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = sq.charCodeAt(0) - 97, rk = 8 - Number(sq[1]);
    const flip = document.body.classList.contains("flipped");
    const col = flip ? 7 - f : f, row = flip ? 7 - rk : rk;
    const sz = r.width / 8;
    return { x: r.left + (col + 0.5) * sz, y: r.top + (row + 0.5) * sz };
  }, s);
  for (const [a, b] of line) {
    const p = await xy(a); await page.mouse.click(p.x, p.y); await page.waitForTimeout(90);
    const q = await xy(b); await page.mouse.click(q.x, q.y); await page.waitForTimeout(220);
  }
  await page.waitForTimeout(500);
  const seen = await page.evaluate(() => {
    const c = document.getElementById("board");
    const g = c.getContext("2d");
    const step = c.width / 8;
    // A piece is present when the middle of the square is not flat. Comparing
    // the centre against the square's own colour looked obvious and was wrong:
    // in the notebook theme the light square is #e8ecf3 and a white piece is
    // near-white, so six men "vanished" from a board that was drawing all 32.
    // Every piece in this set carries a black outline, so luminance *spread*
    // over the middle of the square sees them all, on any theme.
    let pieces = 0;
    for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
      const x0 = Math.round(f * step + step * 0.2), y0 = Math.round(r * step + step * 0.2);
      const n = Math.max(4, Math.round(step * 0.6));
      const d = g.getImageData(x0, y0, n, n).data;
      let lo = 255, hi = 0;
      for (let i = 0; i < d.length; i += 4) {
        const l = 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        if (l < lo) lo = l;
        if (l > hi) hi = l;
      }
      if (hi - lo > 60) pieces++;
    }
    const pill = document.querySelector(".status-pill");
    return { pieces, status: pill ? pill.textContent.trim() : "",
      plies: document.querySelectorAll(".move-list button").length };
  });
  await ctx.close();
  return { ...seen, errs };
}

// 1.e4 d5 2.Bb5+ — a plain check on move two, three legal answers
const CHECK_LINE = [["e2", "e4"], ["d7", "d5"], ["f1", "b5"]];
// scholar's mate — check and game over in the same move
const MATE_LINE = [["e2", "e4"], ["e7", "e5"], ["f1", "c4"], ["b8", "c6"],
  ["d1", "h5"], ["g8", "f6"], ["h5", "f7"]];

for (const theme of ["wood", "night", "day", "notebook"]) {
  const r = await play(theme, CHECK_LINE);
  assert(r.errs.length === 0, `${theme}:将军时无页面异常${r.errs.length ? " — " + r.errs[0] : ""}`);
  // 32 men are still on the board after 1.e4 d5 2.Bb5+ (nothing has been taken)
  assert(r.pieces >= 30, `${theme}:将军后棋子仍在(数到 ${r.pieces} 个)`);
  assert(r.plies === 3, `${theme}:着法表记到第 3 手(实际 ${r.plies})`);
}

{
  const r = await play("wood", MATE_LINE);
  assert(r.errs.length === 0, `将死时无页面异常${r.errs.length ? " — " + r.errs[0] : ""}`);
  assert(r.pieces >= 29, `将死后棋子仍在(数到 ${r.pieces} 个)`);
  assert(/将死/.test(r.status), `将死后状态是"将死",实际是"${r.status}"`);
  assert(r.plies === 7, `着法表记满 7 手(实际 ${r.plies})`);
}

// --- 引擎走不动的时候，这局棋不该就此卡死 ---------------------------------
// 实测已发布的 2.1.5：人机对局里引擎一次给不出着法，这局就永远停在引擎那一
// 边 —— 人走不了（不是他的回合），没有任何东西会重试，而面板给出的三条路
// 全是毁掉这局：悔棋、新局、认输。提示条说出了问题，然后就没有然后了。
// 现在失败先自动重来一次（引擎掉一次多半是 worker 没了，再问一次不要钱），
// 两次都不成才报出来，并且报的时候带上「重试」。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", sideTab: "play", soundOn: false,
      themeId: "wood", humanColor: "w" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel").catch(() => {});
  let asked = 0;
  await page.evaluate(() => {
    window.__asked = 0;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.bestMove = async () => { window.__asked++; throw new Error("engine down"); };
  });
  const sq = async (name) => {
    const c = await page.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await page.mouse.click(c.x, c.y);
  };
  await sq("e2"); await sq("e4");
  // 等这件事发生，而不是猜它多久发生：先自动重来一次，两次都不成才报出来，
  // 固定睡一觉的写法会在慢一点的机器上量到中间态
  await page.waitForFunction(
    () => !!document.querySelector(".toast.show .toast-action"), null,
    { timeout: 8000 }).catch(() => {});
  const down = await page.evaluate(() => ({
    asked: window.__asked,
    plies: document.querySelectorAll(".move-list .mlmove").length,
    action: (document.querySelector(".toast.show .toast-action") || {}).textContent,
    isButton: (document.querySelector(".toast.show .toast-action") || {}).tagName,
  }));
  assert(down.asked >= 2, `一次失败之后会自己再问一遍引擎(问了 ${down.asked} 次)`);
  assert(down.plies === 1, "两次都失败时,棋盘停在人走过的那一手");
  assert(down.action && down.action.trim() === "重试",
    `提示条带着出路,而不只是问题(「${(down.action || "").trim()}」)`);
  assert(down.isButton === "BUTTON", "…而且那是个真的按钮,能用键盘按到");
  // 引擎恢复之后按下去,这局接着走
  await page.evaluate(() => {
    window.__chess.engine.bestMove = async () => ({ from: "e7", to: "e5" });
  });
  // 按不到就按不到 —— 让后面两条以断言的形式报出来,而不是让整个套件死在
  // 一次 30 秒的点击超时上
  await page.click(".toast.show .toast-action", { timeout: 3000 }).catch(() => {});
  await page.waitForTimeout(1200);
  const back = await page.evaluate(() => ({
    plies: document.querySelectorAll(".move-list .mlmove").length,
    status: (document.getElementById("status") || {}).textContent,
  }));
  assert(back.plies === 2, `按下重试,引擎补上了那一手(着法数 ${back.plies})`);
  assert(/白方/.test(back.status || ""), `…轮次回到人这边(状态"${back.status}")`);
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
