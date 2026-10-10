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
import { CBURNETT_PIECE_SVGS } from "../src/web/js/pieces-cburnett.js";
import { Chess } from "../src/web/js/chess.js";

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

/**
 * 9.0 S5: settings live on one page (#page-settings), opened from the rail's
 * gear, one category (#set-<cat>) showing at a time; the board comes back
 * with the rail's 下棋. Driven the way a person drives it, by clicks.
 */
const toSettings = async (page, cat) => {
  await page.click('#rail button[data-view="settings"]'); await page.waitForTimeout(200);
  if (cat) { await page.click("#cat-" + cat); await page.waitForTimeout(150); }
};
const toPlay = async (page) => {
  await page.click('#rail button[data-view="play"]'); await page.waitForTimeout(250);
};

/** A shell's name (data-theme) as the look that gives it (look.js shellFor). */
const lookOf = (th) => ({ wood: { appearance: "dark", boardId: "wood" }, night: { appearance: "dark", boardId: "green" },
  day: { appearance: "light", boardId: "wood" }, notebook: { appearance: "light", boardId: "blue" } })[th] || {};

/** Play `line` in a fresh page and report what the board and the panel show. */
async function play(theme, line) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  // a shell's name, or (v8-0-plan A3) the look's own fields
  const look = typeof theme === "string" ? lookOf(theme) : theme;
  await ctx.addInitScript((lk) => {
    localStorage.setItem("chess.settings", JSON.stringify(Object.assign({
      mode: "pvp", langId: "zh-CN", soundOn: false }, lk)));
    localStorage.setItem("chess.panelOpen", "1");
  }, look);
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const xy = (s) => page.evaluate((sq) => {
    const c = document.getElementById("board");
    const r = c.getBoundingClientRect();
    const f = sq.charCodeAt(0) - 97, rk = 8 - Number(sq[1]);
    // the app puts no "flipped" class anywhere — the orientation segment is
    // where that state is rendered, so that is what a test can read
    const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
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
    // 7.7: the status sentence is screen-reader text now (#status, .sr-only);
    // the words are the same, and the result card says it on screen
    const pill = document.getElementById("status");
    return { pieces, status: pill ? pill.textContent.trim() : "",
      // the moves, not every button: the current move now carries a
      // 「…」 menu handle beside it (v6-plan Q2.1)
      plies: document.querySelectorAll(".move-list .mlmove").length };
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
// v8-0-plan A3: the five boards, on the flat board and in the frame — the
// textures and the paper board's ink men must leave every piece countable
for (const [boardId, boardFrame, appearance] of [["wood", "flat", "system"], ["green", "flat", "dark"],
  ["blue", "frame", "light"], ["paper", "flat", "light"], ["marble", "frame", "dark"]]) {
  const tag = boardId + "/" + boardFrame;
  const r = await play({ appearance, boardId, boardFrame }, CHECK_LINE);
  assert(r.errs.length === 0, `${tag}:将军时无页面异常${r.errs.length ? " — " + r.errs[0] : ""}`);
  assert(r.pieces >= 30, `${tag}:将军后棋子仍在(数到 ${r.pieces} 个)`);
  assert(r.plies === 3, `${tag}:着法表记到第 3 手(实际 ${r.plies})`);
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
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", soundOn: false,
      appearance: "dark", boardId: "wood", humanColor: "w" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
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

// --- 棋盘画出来的,是不是这盘棋 -------------------------------------------
// 这个套件此前只会数「有多少个格子上站着东西」。谁站在哪一格、上一手有没
// 有被标出来、选中之后可走点对不对、翻转是不是真的镜像了 —— 一个都没量
// 过,而这些正是画布上唯一能出错的地方(DOM 测试一条都够不着)。
//
// 仪器:逐格取一张 8×8 的「墨迹」掩码 —— 与该格四角(棋子够不到的地方)颜
// 色相差够远的像素。掩码只认形状,所以同一种子在深浅两种格子上读出来是同
// 一串;再配一个墨迹的平均亮度,把黑子白子分开。实测:同型异格差 0–2 位,
// 异型差 8 位以上,空格全 0。
const READ_BOARD = () => {
  const c = document.getElementById("board");
  const g = c.getContext("2d");
  const step = c.width / 8;
  const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
  const out = { __w: c.width };
  for (let sr = 0; sr < 8; sr++) for (let sc = 0; sc < 8; sc++) {
    const n = Math.round(step);
    const d = g.getImageData(Math.round(sc * step), Math.round(sr * step), n, n).data;
    const corner = (cx, cy) => { const i = (cy * n + cx) * 4; return [d[i], d[i + 1], d[i + 2]]; };
    const cs = [corner(1, 1), corner(n - 2, 1), corner(1, n - 2), corner(n - 2, n - 2)];
    const bg = [0, 1, 2].map((k) => Math.round(cs.reduce((a, v) => a + v[k], 0) / cs.length));
    const far = (i) => Math.abs(d[i] - bg[0]) + Math.abs(d[i + 1] - bg[1]) + Math.abs(d[i + 2] - bg[2]) > 90;
    let bits = "";
    for (let by = 0; by < 8; by++) for (let bx = 0; bx < 8; bx++) {
      let inked = 0, seen = 0;
      const x1 = Math.floor((bx * n) / 8), x2 = Math.floor(((bx + 1) * n) / 8);
      const y1 = Math.floor((by * n) / 8), y2 = Math.floor(((by + 1) * n) / 8);
      for (let y = y1; y < y2; y++) for (let x = x1; x < x2; x++) { seen++; if (far((y * n + x) * 4)) inked++; }
      bits += inked / seen > 0.35 ? "1" : "0";
    }
    // The colour of the man standing there. Every piece is drawn with a dark
    // outline AND a lighter highlight, which defeats every summary of the ink
    // taken one number at a time: the mean puts a white knight on a dark
    // square (94) under a black pawn on a light one (83); the 80th percentile
    // pins both at 255; the median splits white 105–255 from black 0 but a
    // white queen reads 9. All three measured, on this board. What does hold
    // is the balance — a white man is mostly fill with a thin outline, a black
    // man mostly fill with a thin highlight — so: very-bright ink over
    // very-dark ink. White 50–204, black 0–39.
    const inks = [];
    let bgSum = [0, 0, 0], bgN = 0;
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const i = (y * n + x) * 4;
      if (far(i)) inks.push(0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2]);
      else { bgSum = [bgSum[0] + d[i], bgSum[1] + d[i + 1], bgSum[2] + d[i + 2]]; bgN++; }
    }
    const hi = inks.filter((v) => v >= 200).length, lo = inks.filter((v) => v <= 70).length;
    const cell = {
      ink: bits, bg, sr, sc,
      lum: inks.length ? (lo ? Math.round((100 * hi) / lo) : 9999) : null,
      // everything that is not the piece, averaged: the corner colour cannot
      // see the check wash, which is a radial gradient faded out by the corners
      bgMean: bgN ? bgSum.map((v) => Math.round(v / bgN)) : null,
    };
    const f = flip ? 7 - sc : sc, r = flip ? 7 - sr : sr;
    out["abcdefgh"[f] + (8 - r)] = cell;
    // also by where it actually is on screen: everything else in here is keyed
    // by square NAME, and a name is exactly what a broken flip still gets right
    out["@" + sr + sc] = cell;
  }
  return out;
};

const EMPTY = "0".repeat(64);
// Two renders of the same piece are not bit-identical: cell edges are rounded
// to whole pixels, so flipping the board or redrawing after a move can shift a
// mask by a bit or three (measured max: 3, on the knights, which are the least
// symmetric men here). Two DIFFERENT pieces are 8–14 apart, so this tolerance
// keeps a factor of three in hand.
const SAME = 4;
const ham = (a, b) => a.split("").filter((x, i) => x !== b[i]).length;
const SQUARES = [];
for (const f of "abcdefgh") for (let r = 1; r <= 8; r++) SQUARES.push(f + r);

{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
    const col = flip ? 7 - f : f, row = flip ? 7 - rk : rk;
    return { x: r.left + (col + 0.5) * (r.width / 8), y: r.top + (row + 0.5) * (r.height / 8) };
  }, s);
  const tap = async (s) => { const p = await at(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); };
  const play = async (a, b) => { await tap(a); await tap(b); await page.waitForTimeout(420); };
  const read = () => page.evaluate(READ_BOARD);

  // 先点一个空格:棋盘拿到焦点,键盘光标环就此停在 e4 —— 让它在每一张读数
  // 里都在,而不是中途冒出来被当成变化。（第一次量的时候它就冒出来过。)
  await tap("a3");
  const base = await read();

  // 开局的三十二个子
  const occupied = SQUARES.filter((s) => base[s].ink !== EMPTY && s !== "e4");
  const shouldHave = SQUARES.filter((s) => /[1278]$/.test(s));
  assert(occupied.length === 32 && shouldHave.every((s) => base[s].ink !== EMPTY),
    `开局:三十二个子,一二七八横线各就各位(数到 ${occupied.length} 个)`);
  assert(SQUARES.filter((s) => /[3456]$/.test(s) && s !== "e4").every((s) => base[s].ink === EMPTY),
    "…中间四行一个子都没有");
  const light = shouldHave.filter((s) => /[12]$/.test(s)).map((s) => base[s].lum);
  const dark = shouldHave.filter((s) => /[78]$/.test(s)).map((s) => base[s].lum);
  // no threshold: every white man reads lighter than every black man, which is
  // the claim — 白 50–204 对 黑 0–39 when this was written
  assert(Math.min(...light) > Math.max(...dark),
    `白子在下、黑子在上(白 ${Math.min(...light)}–${Math.max(...light)},黑 ${Math.min(...dark)}–${Math.max(...dark)})`);
  const pawns = "abcdefgh".split("").map((f) => base[f + "2"].ink);
  assert(pawns.every((p) => ham(p, pawns[0]) <= SAME), "八个兵是同一枚兵画了八遍");
  assert(ham(base.b1.ink, base.g1.ink) <= SAME && ham(base.b1.ink, base.e2.ink) >= 8,
    `两匹马彼此一样,而马不是兵(马↔马 ${ham(base.b1.ink, base.g1.ink)} 位,马↔兵 ${ham(base.b1.ink, base.e2.ink)} 位)`);

  // 选中之后冒出来的,是这枚子真能去的地方
  await tap("g1");
  const sel = await read();
  const dots = SQUARES.filter((s) => base[s].ink === EMPTY && sel[s].ink !== EMPTY);
  assert(JSON.stringify(dots.sort()) === '["f3","h3"]',
    `选中马,亮起来的正是它能去的两格(亮起 ${JSON.stringify(dots)})`);
  assert(JSON.stringify(sel.g1.bg) !== JSON.stringify(base.g1.bg), "…而它自己也被标出来了");
  await tap("a3"); // 点空处,取消
  const off = await read();
  assert(SQUARES.every((s) => off[s].ink === base[s].ink), "点开别处,记号全部收回");

  // 1.d4 e5 2.dxe5 Bb4+ —— 走子、吃子、将军,一条线走完
  await play("d2", "d4");
  const m1 = await read();
  assert(m1.d2.ink === EMPTY, "走过之后,起点格上什么都没有了");
  assert(ham(m1.d4.ink, base.d2.ink) <= SAME && m1.d4.lum > 40,
    `落点上站着的正是那枚兵(差 ${ham(m1.d4.ink, base.d2.ink)} 位)`);
  const tinted = SQUARES.filter((s) => JSON.stringify(m1[s].bg) !== JSON.stringify(base[s].bg));
  assert(JSON.stringify(tinted.sort()) === '["d2","d4"]',
    `上一手标的是刚走过的两格,别的一格没动(标了 ${JSON.stringify(tinted)})`);

  await play("e7", "e5");
  const before = await read();
  await play("d4", "e5");
  const took = await read();
  assert(took.d4.ink === EMPTY, "吃子:白兵离开了 d4");
  assert(ham(took.e5.ink, before.d4.ink) <= SAME && took.e5.lum > 40 && before.e5.lum < 40,
    `…而 e5 上换成了白兵(此前亮暗比 ${before.e5.lum},此后 ${took.e5.lum})`);
  const still = SQUARES.filter((s) => s !== "e4" && took[s].ink !== EMPTY);
  assert(still.length === 31, `…棋盘上少了一个子(数到 ${still.length})`);

  await play("f8", "b4");
  const chk = await read();
  assert(JSON.stringify(chk.e1.bgMean) !== JSON.stringify(took.e1.bgMean),
    "将军:被将的王那一格底色变了");
  // f8/b4 gain the last-move tint and d4/e5 lose it — that is the same move
  const expected = ["e1", "f8", "b4", "d4", "e5"];
  const alsoChanged = SQUARES.filter((s) => !expected.includes(s) &&
    JSON.stringify(chk[s].bgMean) !== JSON.stringify(took[s].bgMean));
  assert(alsoChanged.length === 0, `…而且只有它和这一手的四格变(另有 ${JSON.stringify(alsoChanged)})`);

  // 翻转:内容跟着格名走,像素真的镜像
  const beforeFlip = await read();
  const a1was = beforeFlip.a1;
  await page.keyboard.press("f");
  await page.waitForTimeout(700);
  const flipped = await read();
  assert(await page.evaluate(() => !!document.querySelector('#orient-seg button[data-orient="b"].active')),
    "翻转:视角切到了黑方");
  const moved = SQUARES.filter((s) => ham(flipped[s].ink, beforeFlip[s].ink) > SAME);
  assert(moved.length === 0, `翻转后每一格上还是原来那个东西(变了的:${JSON.stringify(moved)})`);
  // by screen position, not by name: the left-bottom cell held the white rook
  // and must now hold what h8 held — a broken flip that only relabels the
  // coordinates would still put a1 "at" the top right by name
  assert(ham(beforeFlip["@70"].ink, a1was.ink) === 0 && a1was.lum > 40,
    "翻转前:左下角那一格站着白车");
  assert(ham(flipped["@70"].ink, beforeFlip.h8.ink) <= SAME && flipped["@70"].lum < 40,
    `翻转后:左下角那一格换成了 h8 上的黑车(差 ${ham(flipped["@70"].ink, beforeFlip.h8.ink)} 位,亮暗比 ${flipped["@70"].lum})`);

  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// 拖着走的时候,棋子是真的离开了原来那一格
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  const read = () => page.evaluate(READ_BOARD);
  const from = await at("g1"), to = await at("f3");
  const before = await read();
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y - 10, { steps: 3 });
  await page.mouse.move((from.x + to.x) / 2, (from.y + to.y) / 2, { steps: 6 });
  await page.waitForTimeout(150);
  const mid = await read();
  assert(ham(mid.g1.ink, before.g1.ink) > 6,
    `拖到半路:这枚子已经不在 g1 上了(差 ${ham(mid.g1.ink, before.g1.ink)} 位)`);
  await page.mouse.move(to.x, to.y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(600);
  const after = await read();
  assert(after.g1.ink === EMPTY && ham(after.f3.ink, before.g1.ink) <= SAME,
    `松手:它落在了 f3 上(g1 空=${after.g1.ink === EMPTY},差 ${ham(after.f3.ink, before.g1.ink)} 位)`);
  await ctx.close();
}

// --- 用键盘下棋,以及它说了什么 ---------------------------------------------
// 棋盘是个 role="application" 的可聚焦控件:方向键移光标、回车选中和落子、
// Esc 取消、Home/End 跳到角上,每一步还往 #board-live 里写一句话给读屏软件。
// 这套东西一条都没有被驱动过 —— 七套浏览器测试里唯一一次 keyboard.press
// 是按 f 翻转棋盘。它本身是好的（这一节量的就是「好」长什么样），但它没有
// 守卫,而 2.1.6 那两个 Esc 缺陷就住在这条路上。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const said = () => page.evaluate(() => (document.getElementById("board-live") || {}).textContent);
  const key = async (k, ms = 160) => { await page.keyboard.press(k); await page.waitForTimeout(ms); };
  const read = () => page.evaluate(READ_BOARD);

  await page.focus("#board");
  await page.waitForTimeout(200);
  assert(/棋盘已聚焦/.test(await said()), `聚焦棋盘时,读屏那一行说它被聚焦了(「${await said()}」)`);
  await key("ArrowDown"); await key("ArrowDown");
  assert((await said()).includes("e2") && (await said()).includes("白兵"),
    `光标停在哪一格,它就报哪一格上站着谁(「${await said()}」)`);
  const beforeSel = await read();
  await key("Enter", 220);
  const picked = await said();
  assert(/已选中/.test(picked) && picked.includes("2"),
    `回车拿起棋子,并报出有几个落点(「${picked}」)`);
  const sel = await read();
  const dots = SQUARES.filter((q) => beforeSel[q].ink === EMPTY && sel[q].ink !== EMPTY);
  assert(JSON.stringify(dots.sort()) === '["e3","e4"]',
    `…画布上亮起来的也正是那两格(${JSON.stringify(dots)})`);
  await key("Escape", 220);
  assert(/已取消/.test(await said()), `Esc 取消选择,并且说出来了(「${await said()}」)`);
  const off = await read();
  assert(SQUARES.every((q) => off[q].ink === beforeSel[q].ink), "…画布上的记号也跟着收回");
  assert(await page.evaluate(() => document.getElementById("app").classList.contains("panel-open")),
    "…而且没有顺手把侧栏关掉:有选中时 Esc 是棋盘的");

  await key("Enter", 220);           // 重新选中 e2
  await key("ArrowUp"); await key("ArrowUp");
  await key("Enter", 600);           // 落到 e4
  const played = await read();
  assert(played.e2.ink === EMPTY && ham(played.e4.ink, beforeSel.e2.ink) <= SAME,
    "键盘走出来的棋,画布上和手走的是一回事(e2 空了,e4 上是那枚兵)");
  assert(await page.evaluate(() => document.querySelectorAll(".move-list .mlmove").length) === 1,
    "…着法表也记下了这一手");
  await key("Home", 220);
  assert((await said()).includes("a8"), `Home 跳到 a8(「${await said()}」)`);
  await key("End", 220);
  assert((await said()).includes("h1"), `End 跳到 h1(「${await said()}」)`);
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 7.8 §1a / §7.2:鼠标走完一步,再按 ← -----------------------------------
// 7.7 的样子:鼠标一点棋盘,焦点就在棋盘上;之后的 ← → Home End 全被一个没画
// 出来的键盘光标吃掉 —— 按 ←,什么也没发生。现在光标没画出来时,这几个键翻
// 棋谱;回车(或 Tab 到棋盘)才进光标模式,Esc 退出。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  for (const sq of ["e2", "e4", "e7", "e5", "g1", "f3"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); }
  // viewIndex, read off the move list: which ply carries .current (0 = none)
  const view = () => page.evaluate(() => {
    const ms = [...document.querySelectorAll(".move-list .mlmove:not(.mlgap)")];
    return ms.findIndex((b) => b.classList.contains("current")) + 1;
  });
  // the cursor is a near-white ring along the top edge inside its square
  const ringed = (sq) => page.evaluate((s) => {
    const c = document.getElementById("board");
    const g = c.getContext("2d");
    const step = c.width / 8;
    const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    const x0 = Math.round(f * step + step * 0.3), w = Math.round(step * 0.4);
    let best = 0;
    for (let y = Math.round(rk * step + 1); y < Math.round(rk * step + step * 0.14); y++) {
      const d = g.getImageData(x0, y, w, 1).data;
      let white = 0;
      for (let i = 0; i < d.length; i += 4) if (d[i] > 235 && d[i + 1] > 235 && d[i + 2] > 235) white++;
      best = Math.max(best, white / w);
    }
    return best > 0.8;
  }, sq);
  const key = async (k) => { await page.keyboard.press(k); await page.waitForTimeout(200); };
  const focus = () => page.evaluate(() => document.activeElement && document.activeElement.id);
  assert(await focus() === "board" && await view() === 3, `§1a 鼠标走完三手,焦点在棋盘上,停在第 3 手(${await focus()} / ${await view()})`);
  await key("ArrowLeft");
  assert(await view() === 2 && !(await ringed("e4")), `§1a 按 ←,退回第 2 手,光标没有画出来(${await view()})`);
  await key("ArrowRight");
  assert(await view() === 3, `§1a 按 →,回到第 3 手(${await view()})`);
  await key("Home");
  assert(await view() === 0, `§1a 按 Home,回到开局(${await view()})`);
  await key("End");
  assert(await view() === 3, `§1a 按 End,跳到最新(${await view()})`);
  await key("Enter");
  assert(await ringed("e4"), "§1a 按回车,进入光标模式:光标画出来了");
  await key("ArrowLeft");
  assert(await view() === 3 && await ringed("d4"), `§1a 光标模式里按 ←,光标挪到 d4,棋谱不动(${await view()})`);
  await key("Escape");
  assert(!(await ringed("d4")) && await focus() === "board", "§1a Esc 退出光标模式,焦点仍在棋盘上");
  await key("ArrowLeft");
  assert(await view() === 2, `§1a 退出之后按 ←,又是翻棋谱(${await view()})`);
  await ctx.close();
}

// --- 7.8 §1b / §7.2:翻棋谱时,棋谱区不上下跳 ---------------------------------
// 7.7 的「今天的训练」只在「对局中、停在最新局面」时让位:一退回,卡片冒出来,
// 棋谱被推下去约 160px;回到最新,又收回去。现在有棋谱就不出现。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  // 9.0 S1: the panel's 今天的训练 row (#daily-row) is gone — the plan is 今天's
  // hero card. What this guarded is kept: nothing in the panel shows or hides
  // while the moves are stepped through (the panel's visible parts, as a list).
  const daily = () => page.evaluate(() => [...document.querySelectorAll("#pane-play > *")]
    .filter((e) => !e.hidden && e.getClientRects().length > 0).map((e) => e.id || e.className).join(","));
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  // 22 plies: 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d3 d6 6.O-O O-O 7.Re1 a6
  // 8.a4 h6 9.h3 Re8 10.Nbd2 Be6 11.Bb5 Bd7
  const line = "e2e4 e7e5 g1f3 b8c6 f1c4 f8c5 c2c3 g8f6 d2d3 d7d6 e1g1 e8g8 f1e1 a7a6 a2a4 h7h6 h2h3 f8e8 b1d2 c8e6 c4b5 e6d7".split(" ");
  for (const m of line) {
    for (const sq of [m.slice(0, 2), m.slice(2)]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(100); }
  }
  const n = await page.evaluate(() => document.querySelectorAll(".move-list .mlmove:not(.mlgap)").length);
  assert(n === 22, `§1b 走完 22 着(${n})`);
  const top = () => page.evaluate(() => document.getElementById("move-list").getBoundingClientRect().top);
  const t0 = await top();
  const seen = new Set();
  const cards = new Set([await daily()]);
  for (const k of [...Array(22).fill("ArrowLeft"), ...Array(22).fill("ArrowRight")]) {
    await page.keyboard.press(k);
    await page.waitForTimeout(40);
    seen.add(await top());
    cards.add(await daily());
  }
  assert(seen.size === 1 && seen.has(t0),
    `§1b 从最新退到开局再回到最新,每一步棋谱区上缘都在 ${t0}px(见过:${[...seen].join(", ")})`);
  assert(cards.size === 1, "§1b …其间侧栏里没有卡片冒出来或收起(" + [...cards].join(" | ") + ")");
  await ctx.close();
}

// --- 7.8 §1c / §7.2:升变在棋盘上选 ------------------------------------------
// 7.7 的升变是窗口正中的对话框,棋盘被模糊,四个按钮里是 Unicode 空心字符。
// 现在四个棋子画在升变格那一列上,从升变格往里排,用的是棋盘那一套棋子;棋盘
// 不模糊。白黑、正反视角、边线和中间列都量;点、按键、取消三条路都走。
{
  // white pawns a7 d7, black pawns a2 d2
  const FEN = "7k/P2P4/8/8/8/8/p2p4/7K";
  const setup = async (turn, set, flip) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript(([s, f]) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood", pieceSet: s, flipped: f, autoFlipPvp: false }));
      localStorage.setItem("chess.panelOpen", "1");
    }, [set, flip]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1000);
    await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
    await page.evaluate(async (fen) => {
      document.getElementById("fen-load-open").click();
      await new Promise((r) => setTimeout(r, 300));
      document.getElementById("fen-input").value = fen;
      document.getElementById("fen-load").click();
      await new Promise((r) => setTimeout(r, 300));
    }, FEN + " " + turn + " - - 0 1");
    return { ctx, page, errs };
  };
  const at = (page, s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
    let f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    if (flip) { f = 7 - f; rk = 7 - rk; }
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  const click = async (page, s) => { const p = await at(page, s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); };
  const chooser = (page) => page.evaluate(() => {
    const m = document.getElementById("promo-modal");
    const b = document.getElementById("board").getBoundingClientRect();
    return {
      open: m.classList.contains("show"), role: m.getAttribute("role"), modal: m.getAttribute("aria-modal"),
      blur: getComputedStyle(m).backdropFilter, board: [b.left, b.top, b.right, b.bottom],
      pieces: [...m.querySelectorAll("button[data-p]")].map((x) => {
        const r = x.getBoundingClientRect();
        const img = x.querySelector("img");
        return { p: x.dataset.p, name: x.textContent.trim(), cx: (r.left + r.right) / 2, cy: (r.top + r.bottom) / 2,
                 r: [r.left, r.top, r.right, r.bottom],
                 svg: img && img.src.startsWith("data:image/svg+xml") ? decodeURIComponent(img.src.split(",").slice(1).join(",")) : "" };
      }),
      focus: document.activeElement && document.activeElement.dataset.p,
    };
  });
  const lastSan = (page) => page.evaluate(() => {
    const ms = [...document.querySelectorAll(".move-list .mlmove:not(.mlgap)")];
    return ms.length ? ms[ms.length - 1].getAttribute("aria-label") : "";
  });
  const cases = [
    { turn: "w", flip: false, from: "a7", to: "a8" }, { turn: "w", flip: false, from: "d7", to: "d8" },
    { turn: "w", flip: true, from: "a7", to: "a8" }, { turn: "b", flip: false, from: "d2", to: "d1" },
    { turn: "b", flip: true, from: "a2", to: "a1" }, { turn: "b", flip: true, from: "d2", to: "d1" },
  ];
  for (const c of cases) {
    const tag = `${c.turn === "w" ? "白" : "黑"}方 ${c.from}-${c.to}${c.flip ? "(反转)" : ""}`;
    const { ctx, page, errs } = await setup(c.turn, "cburnett", c.flip);
    await click(page, c.from); await click(page, c.to);
    const s = await chooser(page);
    const target = await at(page, c.to);
    const step = (s.board[2] - s.board[0]) / 8;
    const inside = s.pieces.every((x) => x.r[0] >= s.board[0] - 1 && x.r[2] <= s.board[2] + 1 && x.r[1] >= s.board[1] - 1 && x.r[3] <= s.board[3] + 1);
    const column = s.pieces.every((x) => Math.abs(x.cx - target.x) < 2);
    const inward = s.pieces.every((x, i) => Math.abs(Math.abs(x.cy - target.y) - i * step) < 2) &&
      s.pieces.every((x) => (x.cy - target.y) * (target.y < (s.board[1] + s.board[3]) / 2 ? 1 : -1) >= -1);
    assert(s.open && s.role === "dialog" && s.modal === "true", `§1c ${tag}:选择器是一个模态 dialog`);
    assert(inside && column && inward,
      `§1c ${tag}:四个棋子都在棋盘内、在 ${c.to} 那一列、从升变格往里排(${s.pieces.map((x) => x.p + "@" + Math.round(x.cx) + "," + Math.round(x.cy)).join(" ")})`);
    assert(s.pieces.every((x) => x.svg === CBURNETT_PIECE_SVGS[c.turn + x.p]),
      `§1c ${tag}:画的是棋盘那一套(cburnett)的${c.turn === "w" ? "白" : "黑"}子,不是 Unicode 字符`);
    assert(s.blur === "none" || s.blur === "", `§1c ${tag}:棋盘不模糊(${s.blur})`);
    assert(s.pieces.map((x) => x.name).join("") === "后车象马" && s.focus === "q", `§1c ${tag}:读屏名字照旧、焦点在「后」上`);
    // three paths: a click, a key, a cancel
    if (c.from === "a7" && !c.flip) {
      const r = s.pieces.find((x) => x.p === "n");
      await page.mouse.click(r.cx, r.cy); await page.waitForTimeout(250);
      assert(!(await chooser(page)).open && await lastSan(page) === "a8=N", `§1c ${tag}:点马,升变成马(${await lastSan(page)})`);
    } else if (c.from === "d7") {
      await page.keyboard.press("r"); await page.waitForTimeout(250);
      assert(!(await chooser(page)).open && (await lastSan(page)).startsWith("d8=R"), `§1c ${tag}:按 R,升变成车(${await lastSan(page)})`);
    } else if (c.from === "d2" && !c.flip) {
      await page.keyboard.press("Escape"); await page.waitForTimeout(250);
      assert(!(await chooser(page)).open && await lastSan(page) === "", `§1c ${tag}:Esc 取消,这一步没有走`);
      await click(page, c.from); await click(page, c.to);
      await page.keyboard.press("b"); await page.waitForTimeout(250);
      assert((await lastSan(page)).startsWith("d1=B"), `§1c ${tag}:取消之后再走一次,按 B 升变成象(${await lastSan(page)})`);
    } else {
      const other = await at(page, c.from[0] === "a" ? "e4" : "h4");
      await page.mouse.click(other.x, other.y); await page.waitForTimeout(250);
      assert(!(await chooser(page)).open && await lastSan(page) === "", `§1c ${tag}:点棋盘别处,取消,这一步没有走`);
    }
    assert(errs.length === 0, `§1c ${tag}:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
  // the other piece set: the chooser follows the setting
  {
    const { ctx, page } = await setup("w", "merida", false);
    await click(page, "a7"); await click(page, "a8");
    const s = await chooser(page);
    assert(s.open && s.pieces.every((x) => x.svg.includes('viewBox="0 0 50 50"')),
      "§1c 换成 Merida,选择器里画的也是 Merida");
    await ctx.close();
  }
}

// --- 棋盘拿着焦点的时候,Esc 还是不是「让它消失」的意思 ----------------------
// 实测已发布的 2.1.6:不是。canvas 的 keydown 把每一个 Escape 都吞掉,而只在
// 有选中时才真的做事 —— 于是提示条、编辑器出口、收面板这三层全部够不着,
// 偏偏棋盘就是你一碰棋子焦点就在的地方。同一个错误在 1.10 的 FEN 输入框、
// 后来的升变对话框上各修过一次,这是它的第三处。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", humanColor: "w", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  await page.evaluate(() => {
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.bestMove = async () => { throw new Error("engine down"); };
  });
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  for (const sq of ["e2", "e4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); }
  await page.waitForFunction(() => !!document.querySelector(".toast.show .toast-action"), null,
    { timeout: 8000 }).catch(() => {});
  const up = await page.evaluate(() => ({
    toast: !!document.querySelector(".toast.show"),
    focused: document.activeElement && document.activeElement.id,
  }));
  assert(up.toast && up.focused === "board",
    `引擎报错的提示条挂在那里,而焦点在棋盘上(提示条=${up.toast},焦点=${up.focused})`);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  assert(!(await page.evaluate(() => !!document.querySelector(".toast.show"))),
    "按 Esc,它就走了 —— 哪怕焦点在棋盘上");
  await ctx.close();
}

// --- 局面编辑器:第一次真的用它摆一个局面 ------------------------------------
// editor.js 的纯函数(棋盘→FEN、能不能开局)有单测,而这块面板此前只被版式套
// 件「看过」:没有人放过一枚子、刷过一笔、读过那句不合法的理由,也没有人从
// 三个出口里走出来过。三个出口正是 2.1.6 里 Esc 那个缺陷的现场。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  const tap = async (s) => { const p = await at(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); };
  const brush = (c, t) => page.click(`#editor-palette button[data-color="${c}"][data-type="${t}"]`);
  const why = () => page.evaluate(() => (document.getElementById("editor-error") || {}).textContent);
  const open = () => page.evaluate(() => !(document.getElementById("sec-editor") || {}).hidden);
  const read = () => page.evaluate(READ_BOARD);
  // 9.0 S2: 编辑局面 is in the tool row's ⋯ (#more-row), not on the row itself
  const openEditor = async () => {
    if (!(await page.isVisible("#editor-open"))) { await page.click("#more-tools"); await page.waitForTimeout(150); }
    await page.click("#editor-open");
  };

  await openEditor();
  await page.waitForTimeout(400);
  assert(await open(), "编辑器打开了");
  await page.click("#editor-clear");
  await page.waitForTimeout(250);
  assert(/白方.*王/.test(await why()), `空棋盘上,它说得出缺什么(「${await why()}」)`);
  assert(!(await page.isEnabled("#editor-apply")), "…而且开始不了这局棋");
  await brush("w", "k"); await tap("e1");
  assert(/黑方.*王/.test(await why()), `放了白王,它接着说下一件缺的(「${await why()}」)`);
  await brush("b", "k"); await tap("e8");
  assert((await why()) === "", `两个王都在,它就不说话了(「${await why()}」)`);
  assert(await page.isEnabled("#editor-apply"), "…开始对局也亮了");

  // 拖着刷一排兵:编辑器里按住拖过去是一笔,不是四次点击
  await brush("w", "p");
  const a2 = await at("a2"), d2 = await at("d2");
  await page.mouse.move(a2.x, a2.y); await page.mouse.down();
  await page.mouse.move(d2.x, d2.y, { steps: 12 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const painted = await read();
  // e4 again holds the keyboard focus ring, not a piece: placing men means
  // clicking the board, and clicking the board focuses it
  const men = SQUARES.filter((q) => q !== "e4" && painted[q].ink !== EMPTY);
  assert(men.length === 6 && ["a2", "b2", "c2", "d2"].every((q) => painted[q].ink !== EMPTY),
    `拖着刷过去是一笔四个兵(盘上共 ${men.length} 个子:${JSON.stringify(men)})`);

  // 三个出口,一个一个走
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);  // 先关掉进入时的提示条
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
  assert(!(await open()), "Esc 退出编辑器,面板跟着收起(2.1.6 之前它会留在屏幕上)");
  await openEditor(); await page.waitForTimeout(400);
  await page.click("#editor-cancel"); await page.waitForTimeout(400);
  assert(!(await open()), "「取消」退出,面板收起");
  await openEditor(); await page.waitForTimeout(400);
  await page.click("#editor-clear"); await page.waitForTimeout(200);
  await brush("w", "k"); await tap("e1");
  await brush("b", "k"); await tap("e8");
  // and something to play with: two bare kings is dead drawn the moment it
  // starts, and the status pill would say so instead of whose move it is
  await brush("w", "q"); await tap("d1");
  await page.click("#editor-apply"); await page.waitForTimeout(600);
  assert(!(await open()), "「开始对局」退出,面板收起");
  const started = await page.evaluate(() => ({
    status: (document.getElementById("status") || {}).textContent,
    plies: document.querySelectorAll(".move-list .mlmove").length,
  }));
  assert(/白方走子/.test(started.status) && started.plies === 0,
    `…而且真的从摆好的这个局面重新开始(状态「${started.status}」,着法 ${started.plies})`);
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 双人认输的三键问句,和从复盘中间重下 -----------------------------------
// confirm-alt 是全应用唯一的第三颗确认键,只在这一个问句里出现;它和
// retry-here 一样,此前从没被任何测试指名道姓地按过。三键问句按错一颗就是
// 把胜负判给错的一方;重下按错就是把后半盘棋丢给错的人 —— 都是一次点击
// 定生死的地方,值得逐颗按一遍。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, s);
  const tap = async (s) => { const p = await at(s); await page.mouse.click(p.x, p.y); await page.waitForTimeout(150); };
  const mv = async (a, b) => { await tap(a); await tap(b); await page.waitForTimeout(260); };
  const status = () => page.evaluate(() => document.getElementById("status").textContent.trim());
  const rows = () => page.evaluate(() => document.querySelectorAll(".mlrow").length);

  await mv("e2", "e4"); await mv("e7", "e5");
  await mv("g1", "f3"); await mv("b8", "c6");

  // 三键问句:双人模式里「认输」得先问是谁认输
  await page.click("#btn-resign");
  await page.waitForTimeout(350);
  const btns = await page.evaluate(() => ({
    ok: document.getElementById("confirm-ok").textContent,
    alt: document.getElementById("confirm-alt").textContent,
    altShown: !document.getElementById("confirm-alt").hidden,
  }));
  assert(btns.altShown && btns.ok === "白方认输" && btns.alt === "黑方认输",
    `三键问句把两种认输各给了一颗键(${btns.ok} / ${btns.alt})`);
  // 第一颗按「取消」:改主意不该动任何东西
  await page.click("#confirm-cancel");
  await page.waitForTimeout(250);
  assert(/白方走子/.test(await status()), "按「取消」:这局照下,轮到白方");
  // 再问一次,这次按第三颗:黑方认输 → 白方胜
  await page.click("#btn-resign");
  await page.waitForTimeout(250);
  await page.click("#confirm-alt");
  await page.waitForTimeout(400);
  assert(/黑方认输.*白方胜/.test(await status()), `第三颗键把胜负判给了对的一方(「${await status()}」)`);
  const afterResign = await rows();
  // v8-0-plan A5: the result card floats over the board's middle now; put it
  // away, so the taps below land on the squares and not on its buttons
  await page.click("#go-close"); await page.waitForTimeout(200);
  await mv("f1", "c4");
  assert((await rows()) === afterResign, "认输之后棋盘冻住,走不动");

  // 从复盘中间重下:先用界面上的那对箭头(不是键盘)退回去
  await page.click("#rep-start"); await page.waitForTimeout(200);
  await page.click("#rep-next"); await page.waitForTimeout(200);
  await page.click("#rep-next"); await page.waitForTimeout(200);
  const lit = await page.evaluate(() => {
    const c = document.querySelector(".mlmove.current");
    return c ? c.textContent.trim() : "";
  });
  assert(lit === "e5", `复盘箭头真的在走(高亮着法「${lit}」)`);
  await page.click("#retry-here");
  await page.waitForTimeout(300);
  const ask = await page.evaluate(() => document.getElementById("confirm-message").textContent.trim());
  // 6.0: the moves after the cut are kept as a variation, not dropped (v6-plan Q2.3)
  assert(/2 着/.test(ask) && /变着/.test(ask), `重下先说清代价(「${ask}」)`);
  await page.click("#confirm-ok");
  await page.waitForTimeout(400);
  assert((await rows()) === 1 && /白方走子/.test(await status()),
    "确认后着法真的截断到 1.e4 e5,认输的结局一并撤销,白方接着走");
  await mv("d2", "d4");
  assert((await rows()) === 2, "……而且真的能接着下");
  assert(errs.length === 0, `全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 6.1: §5 里四条没人认领的验收 (v6-plan §8.2) ---------------------------
//
// §7「按 §2 的编号逐条对账」对的是实现项,§5 的验收项没有人对,于是「首屏到
// 可交互 < 1 s」「走一步棋 draw() 恰一次」「预走在对手走完后 ≤ 1 帧」三条在
// 仓库里一条断言都找不到,盲棋与升主线也一样。下面四段一段一条。

// --- 预走:对手走完之后 ≤ 1 帧 (v6-plan §5 Q2) ------------------------------
// 量的是帧,不是毫秒。睡一觉再看着法表,「≤ 1 帧」和「≤ 1 秒」看起来一模一样,
// 而 runPremove() 的整个设计就是那一帧:它把走子排在 requestAnimationFrame
// 里,好让应手先被看见落下。所以计数器也住在页面里,数 rAF。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", langId: "zh-CN", soundOn: false,
      appearance: "dark", boardId: "wood", humanColor: "w", difficulty: "easy" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  // 引擎的应手由测试放行:预走要在「引擎正在想」的那段时间里排上队,而那段
  // 时间有多长必须是我们说了算,不能靠运气
  await page.evaluate(() => {
    window.__release = null;
    window.__chess.engine.isReady = () => true;
    window.__chess.engine.bestMove = () => new Promise((res) => {
      window.__release = () => res({ from: "e7", to: "e5" });
    });
  });
  const sq = async (name) => {
    const c = await page.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(140);
  };
  await sq("e2"); await sq("e4");
  await page.waitForFunction(() => !!window.__release, null, { timeout: 8000 });
  const plies = () => page.evaluate(() => document.querySelectorAll(".move-list .mlmove").length);
  assert((await plies()) === 1, "白方走了 1.e4,引擎还在想");
  // 排一步预走 Ng1-f3。轮不到我们走,所以这两下点击只可能是预走。
  await sq("g1"); await sq("f3");
  const queued = await page.evaluate(() => {
    const t = document.getElementById("toast");
    return t && t.classList.contains("show") ? t.textContent : "";
  });
  assert(/预走/.test(queued), `引擎想棋的时候点两下,排的是预走(「${queued.replace("✕", "")}」)`);
  assert((await plies()) === 1, "……而且它还没走:着法表仍然只有 1.e4");

  const beat = await page.evaluate(async () => {
    const count = () => document.querySelectorAll(".move-list .mlmove").length;
    let frame = 0, reply = -1, pre = -1;
    const done = new Promise((res) => {
      const tick = () => {
        frame++;
        const n = count();
        if (n >= 2 && reply < 0) reply = frame;
        if (n >= 3 && pre < 0) { pre = frame; res(); return; }
        if (frame > 240) { res(); return; }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    // 计数器先排进 rAF 队列,再放引擎走子:这样每一帧我们都先看一眼,应手
    // 落在第 reply 帧被看见,预走最快只能在下一帧被看见 —— 量到的 1 就是
    // 「一帧之内」的下界,不是四舍五入出来的。
    window.__release();
    await done;
    return { reply, pre };
  });
  assert(beat.reply > 0, `引擎的应手落了下来(第 ${beat.reply} 帧)`);
  assert(beat.pre > 0, `预走执行了(第 ${beat.pre} 帧)`);
  assert(beat.pre - beat.reply <= 1,
    `预走在对手走完后 ≤ 1 帧执行(应手第 ${beat.reply} 帧,预走第 ${beat.pre} 帧,差 ${beat.pre - beat.reply} 帧)`);
  const line = await page.evaluate(() =>
    [...document.querySelectorAll(".move-list .mlmove")].map((m) => m.getAttribute("aria-label")).join(" "));
  assert(line === "e4 e5 Nf3", `……走的是排队的那一着(「${line}」)`);
  assert(errs.length === 0, `预走:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 盲棋:棋子不画,坐标与播报照旧 (v6-plan §2 Q2.8) ------------------------
// 盲棋是「只把人拿掉」,不是「把棋盘关掉」。最容易写错的正是这一点:连坐标
// 和 #board-live 一起藏起来,读屏用户就彻底没得下了 —— 而那恰好是盲棋唯一
// 的受众之一。三件事各一条断言。
// 同一页接着做升主线:变着建出来、升上去,主线换人,老主线降成变着。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const sq = async (name) => {
    const c = await page.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(140);
  };
  /** 棋盘上还站着几个人 —— 和本文件开头 play() 用的是同一把尺子 */
  const men = () => page.evaluate(() => {
    const c = document.getElementById("board");
    const g = c.getContext("2d");
    const step = c.width / 8;
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
    return pieces;
  });
  const frame = () => page.evaluate(() => ({
    files: (document.getElementById("coord-files").textContent || "").trim(),
    ranks: (document.getElementById("coord-ranks").textContent || "").trim(),
    filesShown: !!document.getElementById("coord-files").offsetParent,
    ranksShown: !!document.getElementById("coord-ranks").offsetParent,
  }));

  for (const s of ["e2", "e4", "e7", "e5", "g1", "f3"]) await sq(s);
  await page.waitForTimeout(300);
  const before = await men();
  assert(before >= 28, `开着的棋盘上看得见棋子(数到 ${before} 个)`);

  // 9.0 S5: 盲棋 is in the settings page's 棋盘 category (was the 设置 tab)
  await toSettings(page, "board");
  await page.click("#opt-blind"); await page.waitForTimeout(300);
  assert((await page.getAttribute("#opt-blind", "aria-pressed")) === "true", "盲棋开关按下了");
  await toPlay(page); await page.waitForTimeout(250);

  assert((await men()) === 0, `盲棋:一个棋子都不画(数到 ${await men()} 个)`);
  const co = await frame();
  assert(co.files === "abcdefgh" && co.ranks === "87654321",
    `……坐标还印在边框上(「${co.files}」/「${co.ranks}」)`);
  assert(co.filesShown && co.ranksShown, "……而且真的看得见,不是留在 DOM 里被藏起来");
  // 播报:盲棋唯一还能告诉人「这里站着谁」的东西
  await page.evaluate(() => { document.getElementById("board").focus(); });
  await page.keyboard.press("ArrowUp");
  await page.waitForTimeout(250);
  const said = await page.evaluate(() => (document.getElementById("board-live") || {}).textContent || "");
  assert(said.trim().length > 0, `……#board-live 照旧在说话(「${said}」)`);
  // 还能接着下:棋子看不见不等于棋盘停了
  await sq("b8"); await sq("c6");
  const n = await page.evaluate(() => document.querySelectorAll(".move-list .mlmove").length);
  assert(n === 4, `……看不见也照样走得动(着法表 ${n} 手)`);
  await toSettings(page, "board");
  await page.click("#opt-blind"); await page.waitForTimeout(300);
  await toPlay(page); await page.waitForTimeout(250);
  assert((await men()) >= 28, `关掉盲棋,人又都回来了(数到 ${await men()} 个)`);

  // --- 升主线:把变着提上去,老主线自己退到变着里 (v6-plan §5 Q2) ----------
  const notation = () => page.evaluate(() => ({
    main: [...document.querySelectorAll("#move-list .mlmove:not(.mlgap)")].map((b) => b.getAttribute("aria-label")),
    vars: [...document.querySelectorAll("#move-list .mlv")].map((b) => b.getAttribute("aria-label")),
  }));
  const before2 = await notation();
  assert(before2.main.join(" ") === "e4 e5 Nf3 Nc6" && before2.vars.length === 0,
    `升主线之前:一条主线,没有变着(「${before2.main.join(" ")}」)`);
  // 回到第 2 手之后,走一条别的:复盘位置上的一着会开成变着。data-i 是着法
  // 的序号,点它是「站到这一着之前」,所以要站在 1.e4 e5 之后得点第 3 着。
  await page.click('#move-list .mlmove[data-i="2"]');
  await page.waitForTimeout(300);
  await sq("f1"); await sq("c4");
  await page.waitForTimeout(300);
  await sq("b8"); await sq("c6");
  await page.waitForTimeout(300);
  const mid = await notation();
  assert(mid.vars.join(" ") === "Bc4 Nc6", `变着建起来了(「${mid.vars.join(" ")}」)`);
  assert(mid.main.join(" ") === "e4 e5 Nf3 Nc6", "……主线一个字没动");
  // 右键那一着 → 升主线
  await page.click('#move-list .mlv[aria-label="Bc4"]', { button: "right" });
  await page.waitForTimeout(250);
  assert(await page.isVisible("#move-menu"), "右键开出了着法菜单");
  await page.click("#mm-promote");
  await page.waitForTimeout(400);
  const after = await notation();
  assert(after.main.join(" ") === "e4 e5 Bc4 Nc6", `升主线之后主线换了人(「${after.main.join(" ")}」)`);
  assert(after.vars.join(" ") === "Nf3 Nc6", `……老主线退成了变着(「${after.vars.join(" ")}」)`);
  assert(errs.length === 0, `盲棋与升主线:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 走一步棋 draw() 画几遍 (v6-plan §5 Q1) --------------------------------
//
// app.js 里 draw() 是模块内的一个名字,bundle 之后页面上没有它;但它每次都
// 落到 BoardView.draw(),而 BoardView.draw() 每次都向 #board 要一次 2d 上下
// 文,整个仓库里再没有第二处向 #board 要上下文。所以「画了几遍」是可以从页
// 面上数的:数 getContext。
//
// 数出来的不是 1,是 2 —— §5 的「走一步棋 draw() 恰一次」不成立。两遍各有出
// 处:gameMove() 里 store.commit("game") 一遍,收尾的 sync() 里 commitAll()
// 又一遍(§7 自己写的是「commitAll 一次通知」,漏算了 gameMove 那一次)。
// 这里按 test-chess.mjs 的登记册办法记下这个 2:只减不增,哪天真收成 1,这
// 条会当场失败,改数字的人顺手就把 §5 对上了账。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__paints = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) {
      if (this.id === "board") window.__paints++;
      return real.apply(this, a);
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // 动画是时间,不是状态:滑行中的每一帧都要重画,那不是「走一步棋画了几遍」
  // 要问的事。reduced-motion 下走子直接落位(board.js animateMove),量到的就
  // 只剩状态变化引起的重画。
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const sq = async (name) => {
    const c = await page.evaluate((s) => {
      const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
      const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
    }, name);
    await page.mouse.click(c.x, c.y);
    await page.waitForTimeout(250);
  };
  const REGISTERED = 2;   // 登记册:只减不增
  for (const [from, to, label] of [["e2", "e4", "1.e4"], ["e7", "e5", "1...e5"], ["g1", "f3", "2.Nf3"]]) {
    await sq(from);                                   // 选子也要重画一遍,不算
    await page.evaluate(() => { window.__paints = 0; });
    await sq(to);
    await page.waitForTimeout(500);
    const n = await page.evaluate(() => window.__paints);
    assert(n <= REGISTERED, `${label}:走一步棋重画 ${n} 遍(登记 ${REGISTERED},只减不增)`);
    assert(n === REGISTERED,
      `${label}:登记册保持精确(${n} vs ${REGISTERED} —— §5 说的是 1,收到 1 的那天改这个数)`);
  }
  assert(errs.length === 0, `draw() 计数:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 首屏到可交互 < 1 s,引擎未加载 (v6-plan §5 Q1) -------------------------
//
// 「可交互」在这块棋盘上有确切的意思:canvas 上挂着 pointerdown,而且它已经
// 被画过一遍 —— 在那之前点下去什么都不会发生。两件事都能在页面里打上时间戳,
// 于是这条验收量的是 navigation start 到两者中较晚的那一个,用 Performance
// API 的时间轴,不是测试进程这边的墙上时钟(那把浏览器启动也算了进去)。
// 引擎没加载:本文件的 http 服务把 js/engine-src.js 换成了一行注释。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    window.__t = { painted: null, wired: null };
    const realCtx = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) {
      if (this.id === "board" && window.__t.painted == null) window.__t.painted = performance.now();
      return realCtx.apply(this, a);
    };
    const realAdd = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...rest) {
      if (type === "pointerdown" && this.id === "board" && window.__t.wired == null) {
        window.__t.wired = performance.now();
      }
      return realAdd.call(this, type, ...rest);
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  // commit,不是 load:load 等的是这台机器把 1200×900 的页面栅格化完,那是
  // 容器的事,不是这个应用的事
  await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: "commit" });
  await page.waitForFunction(() => window.__t && window.__t.painted != null && window.__t.wired != null,
    null, { timeout: 30000 });
  const t = await page.evaluate(() => {
    const nav = performance.getEntriesByType("navigation")[0];
    return {
      painted: window.__t.painted,
      wired: window.__t.wired,
      start: nav ? nav.startTime : 0,
      // v8-0-plan F5: with the time each fetch started, so "before the
      // first paint" is a question the timeline answers
      res: performance.getEntriesByType("resource").map((r) => ({ name: r.name.split("/").pop(), at: r.startTime })),
    };
  });
  const interactive = Math.round(Math.max(t.painted, t.wired) - t.start);
  assert(interactive < 1000, `首屏到可交互 ${interactive} ms < 1000 ms(棋盘画好 ${Math.round(t.painted)} ms,pointerdown 挂上 ${Math.round(t.wired)} ms)`);
  // 6.1 把 ECO 表(462 KB)搬出了首屏包,改成用到才取(js/chunk-eco.js)。
  // 它要是又回到首屏里,上面那个数字会慢慢爬回去而没人知道为什么。
  // v8-0-plan F5 起 index.html 先跑 chunk-boot.js(几百字节,只负责替已存
  // 的语言写 script 标签);中文用户它什么都不写。挖掘题在首屏之后才取。
  const early = t.res.filter((r) => /^chunk-/.test(r.name) && r.at < t.painted && r.name !== "chunk-boot.js");
  assert(early.length === 0,
    `……而且首屏前除 chunk-boot.js 外一个 chunk 都没取(取了:${early.map((r) => r.name).join(", ")})`);
  // 「可交互」得是真的:这时候点下去,棋真的能走
  await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
  const c = await page.evaluate(() => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const at = (s) => { const f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
      return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) }; };
    return { a: at("e2"), b: at("e4") };
  });
  await page.mouse.click(c.a.x, c.a.y); await page.waitForTimeout(200);
  await page.mouse.click(c.b.x, c.b.y); await page.waitForTimeout(400);
  const played = await page.evaluate(() =>
    [...document.querySelectorAll(".move-list .mlmove")].map((m) => m.getAttribute("aria-label")).join(" "));
  assert(played === "e4", `……而「可交互」是真的可交互:点下去棋就走了(「${played}」)`);
  assert(errs.length === 0, `首屏:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- v8-0-plan F5:十二张棋子图全部解码完,只重画一次 -------------------------
//
// 7.9 之前每张图 onload 都清空精灵缓存、整盘重画:首次加载一共画 12 次,
// 无 GPU 的环境里每次约 150 ms,全部排在 DOMContentLoaded 之前。现在十二张
// 一起 decode(),完了换上、画一次。计数来自 board.js 本身
// (window.__chess.board().imageRedraws);整盘重画的总数另外从 canvas 这边
// 数一遍(每次 draw() 都从 a8 那一格的 fillRect(0, 0, …) 开始),两边互证。
// 换 Merida 也只画一次,而 Merida 是按需取的 chunk。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    window.__full = 0;
    const real = CanvasRenderingContext2D.prototype.fillRect;
    CanvasRenderingContext2D.prototype.fillRect = function (x, y, ...rest) {
      if (this.canvas && this.canvas.id === "board" && x === 0 && y === 0) window.__full++;
      return real.call(this, x, y, ...rest);
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForFunction(() => window.__chess && window.__chess.board && window.__chess.board().imageRedraws >= 1,
    null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  const r = await page.evaluate(() => ({
    image: window.__chess && window.__chess.board ? window.__chess.board().imageRedraws : -1,
    full: window.__full,
  }));
  assert(r.image === 1, `首次加载:棋子图解码完只重画了一次(${r.image} 次)`);
  // 12 张图各画一次时这里是 17;留出启动本身那几次 sync()
  assert(r.full > 0 && r.full < 12, `首次加载:整盘重画 ${r.full} 次 < 12(每张图一次的时候是 17)`);
  // 换成 Merida:按需取 chunk-merida.js,解码完再一次画
  // v8-0-plan A3: no piece chunk is fetched at startup — not even for the
  // picker's previews, which wait until their row is on screen
  const early = await page.evaluate(() => performance.getEntriesByType("resource")
    .filter((e) => /chunk-(merida|pieces-\w+)\.js$/.test(e.name)).map((e) => e.name.split("/").pop()));
  assert(early.length === 0, `启动时不取任何棋子分块(取了:${early.join(", ") || "无"})`);
  await page.evaluate(() => { const b = document.querySelector('[data-piece-set="merida"]'); if (b) b.click(); });
  await page.waitForFunction(() => window.__chess.board().imageRedraws >= 2, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const m = await page.evaluate(() => ({
    image: window.__chess.board().imageRedraws,
    fetched: performance.getEntriesByType("resource").some((e) => /chunk-merida\.js$/.test(e.name)),
  }));
  assert(m.fetched && m.image === 2, `换 Merida:取了 chunk-merida.js,解码完只多画一次(共 ${m.image} 次)`);
  // …and the same for a set that is new with A3
  await page.evaluate(() => { const b = document.querySelector('[data-piece-set="fantasy"]'); if (b) b.click(); });
  await page.waitForFunction(() => window.__chess.board().imageRedraws >= 3, null, { timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(800);
  const f = await page.evaluate(() => ({
    image: window.__chess.board().imageRedraws,
    fetched: performance.getEntriesByType("resource").some((e) => /chunk-pieces-fantasy\.js$/.test(e.name)),
    saved: JSON.parse(localStorage.getItem("chess.settings") || "{}").pieceSet,
  }));
  assert(f.fetched && f.image === 3 && f.saved === "fantasy",
    `换 Fantasy:取了 chunk-pieces-fantasy.js,只多画一次(共 ${f.image} 次),设置里记下 ${f.saved}`);
  assert(errs.length === 0, `棋子图:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// Codex on #85: the first decode of the standard set finishing while Merida
// is picked (its chunk still on the way), then a switch back to standard —
// red before: the finished decode was dropped as superseded but still marked
// the standard set as "decoding", so the switch back returned at once and the
// board stayed on the glyph fallback for good.
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    // a slow decode, so the switch can land while it runs
    const real = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = function () {
      return new Promise((r) => setTimeout(r, 1200)).then(() => real.call(this));
    };
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.route(/chunk-merida\.js/, async (route) => { await new Promise((r) => setTimeout(r, 5000)); await route.continue(); });
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(200);
  await page.evaluate(() => document.querySelector('[data-piece-set="merida"]').click());
  await page.waitForTimeout(1800);   // the standard set's decode ends, Merida still loading
  await page.evaluate(() => document.querySelector('[data-piece-set="cburnett"]').click());
  await page.waitForFunction(() => window.__chess.board().imageRedraws >= 1, null, { timeout: 4000 }).catch(() => {});
  const n = await page.evaluate(() => window.__chess.board().imageRedraws);
  assert(n >= 1, `标准→梅里达(还在取)→标准:标准棋子图照样装上(重画 ${n} 次)`);
  assert(errs.length === 0, `棋子图来回切:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- 7.6:做题时,读屏那一行念的是题板上对方的应着 ---------------------------
// announceLastMove() 读的是主对局 `game`,而题目下在自己的棋盘上:整段做题
// 期间 #board-live 停在上一盘棋的最后一着,对方的应着一次也没念过。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "puzzle", langId: "zh-CN", soundOn: false, appearance: "dark", boardId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
    localStorage.setItem("chess.puzzles", JSON.stringify({ v: 1, idv: 2, solved: {}, missed: {}, cat: "op" }));
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  const at = (sq) => page.evaluate((s) => {
    const r = document.getElementById("board").getBoundingClientRect();
    return { x: r.left + (s.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(s[1]) + 0.5) * (r.height / 8) };
  }, sq);
  // any book move is accepted in an opening drill; 1.e4 is in the book
  for (const sq of ["e2", "e4"]) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(250); }
  await page.waitForTimeout(500);
  const said = await page.evaluate(() => (document.getElementById("board-live") || {}).textContent || "");
  assert(/^1… [a-hKQRBNO]/.test(said.trim()), `做开局题:走完 1.e4,读屏念出对方的应着(「${said}」)`);
  assert(errs.length === 0, `做题读屏:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- v7-8-plan §5: 坐标 盘外 / 盘内, and the tab fade ------------------------
// Both red before 7.8's change: there was no 「坐标位置」 control (the click
// below times out), and the tab pane slid in with reveal-in, not pane-in.
// 9.0 S5: the panel has no tabs any more; what was "the board does not move
// between the two tabs" is now "the board does not move for a visit to the
// settings page", and the fade is the settings page's own (a .page, pane-in).
{
  const rectsFor = async (w, h, coordsIn, theme) => {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, locale: "zh-CN" });
    // v8-0-plan A3: 盘外 / 盘内 is a choice on the wooden frame only (a flat
    // board has nothing to print on), so these two runs are framed
    await ctx.addInitScript((th) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", soundOn: false,
        appearance: th === "day" ? "light" : "dark", boardId: "wood", boardFrame: "frame" }));
      localStorage.setItem("chess.panelOpen", "1");
    }, theme);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
    // chosen the way a person chooses it: on the settings page's 棋盘 (9.0 S5;
    // the preferences window of v8-0-plan A1 before it)
    await toSettings(page, "board");
    await page.click(`#coords-seg button[data-coords="${coordsIn ? "in" : "out"}"]`, { timeout: 2000 });
    await toPlay(page);
    await page.waitForTimeout(300);
    const rects = [];
    const rectNow = () => page.evaluate(() => {
      const r = document.getElementById("board").getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].join(",");
    });
    // the board, then again after a round trip through 设置 (twice: the
    // second visit opens on the remembered category)
    rects.push(await rectNow());
    for (const cat of ["general", null]) {
      await toSettings(page, cat);
      await toPlay(page);
      rects.push(await rectNow());
    }
    const geo = await page.evaluate(() => {
      const board = document.getElementById("board").getBoundingClientRect();
      const wrap = document.getElementById("board-wrap").getBoundingClientRect();
      const step = board.width / 8;
      const span = (id, i) => document.getElementById(id).children[i];
      const box = (el) => { const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, r: r.right, b: r.bottom }; };
      // the ink box of the text, not the span: a Range over its text node
      const ink = (el) => { const rg = document.createRange(); rg.selectNodeContents(el); return box(rg); };
      const css = getComputedStyle(document.documentElement);
      const tok = (n) => { const d = document.createElement("span"); d.style.color = css.getPropertyValue(n); document.body.appendChild(d); const c = getComputedStyle(d).color; d.remove(); return c; };
      // the gauge is review-only; shown here only to read where the layout puts it
      const g = document.getElementById("eval-bar-row");
      g.hidden = false;
      const gauge = box(g);
      g.hidden = true;
      return {
        board: { x: board.x, y: board.y, r: board.right, b: board.bottom }, frame: board.x - wrap.x, step,
        a: ink(span("coord-files", 0)), h: ink(span("coord-files", 7)),
        r8: ink(span("coord-ranks", 0)), r1: ink(span("coord-ranks", 7)),
        aInk: getComputedStyle(span("coord-files", 0)).color, bInk: getComputedStyle(span("coord-files", 1)).color,
        r8Ink: getComputedStyle(span("coord-ranks", 0)).color,
        light: tok("--sq-light"), dark: tok("--sq-dark"),
        gauge, wrapX: wrap.x, wrapY: wrap.y, wrapB: wrap.bottom,
      };
    });
    await ctx.close();
    return { rects, geo, errs };
  };
  for (const [w, h] of [[1200, 900], [600, 900]]) {
    const out = await rectsFor(w, h, false, "wood");
    const inn = await rectsFor(w, h, true, "wood");
    assert(new Set(out.rects).size === 1, `${w}×${h} 坐标盘外:去一趟设置页再回来,棋盘矩形逐像素不变(${[...new Set(out.rects)].join(" / ")})`);
    assert(new Set(inn.rects).size === 1, `${w}×${h} 坐标盘内:同样逐像素不变(${[...new Set(inn.rects)].join(" / ")})`);
    assert(inn.geo.frame < out.geo.frame && inn.geo.step > out.geo.step,
      `${w}×${h} 盘内时外框收窄(${out.geo.frame} → ${inn.geo.frame}px),格子随之变大(${out.geo.step.toFixed(1)} → ${inn.geo.step.toFixed(1)})`);
    const g = inn.geo, s = g.step, B = g.board;
    // a in a1's bottom-right quarter, h in h1's; 8 in a8's top-left quarter, 1 in a1's
    const inQuarter = (k, col, row, right, bottom) => {
      const x0 = B.x + col * s, y0 = B.y + row * s;
      const qx = right ? [x0 + s / 2, x0 + s] : [x0, x0 + s / 2];
      const qy = bottom ? [y0 + s / 2, y0 + s] : [y0, y0 + s / 2];
      return k.x >= qx[0] - 0.5 && k.r <= qx[1] + 0.5 && k.y >= qy[0] - 0.5 && k.b <= qy[1] + 0.5;
    };
    assert(inQuarter(g.a, 0, 7, true, true) && inQuarter(g.h, 7, 7, true, true),
      `${w}×${h} 盘内:a–h 在第一横排格子的右下角`);
    assert(inQuarter(g.r8, 0, 0, false, false) && inQuarter(g.r1, 0, 7, false, false),
      `${w}×${h} 盘内:1–8 在 a 列格子的左上角`);
    assert(g.aInk === g.light && g.bInk === g.dark && g.r8Ink === g.dark,
      `${w}×${h} 盘内:字色与所在格子反色(a1 深格写浅色 ${g.aInk},b1 浅格写深色 ${g.bInk},a8 浅格写深色 ${g.r8Ink})`);
    // v8-0-plan A4: level with the frame, not with the squares (it ran from
    // the squares' top edge, 17px under the frame's)
    const gaugeOk = g.gauge.r <= B.x + 0.5 && Math.abs(g.gauge.y - g.wrapY) <= 1 && Math.abs(g.gauge.b - g.wrapB) <= 1;
    assert(gaugeOk, `${w}×${h} 盘内:竖评估条仍在棋盘左侧、与外框上下对齐(条 ${g.gauge.x.toFixed(0)}–${g.gauge.r.toFixed(0)} × ${g.gauge.y.toFixed(0)}–${g.gauge.b.toFixed(0)},格子从 ${B.x.toFixed(0)} 起,框 ${g.wrapY.toFixed(0)}–${g.wrapB.toFixed(0)})`);
    assert(!out.errs.length && !inn.errs.length, `${w}×${h} 坐标两种位置:没有页面异常`);
  }
  // a light theme: same rules, its own square colours
  const day = await rectsFor(1200, 900, true, "day");
  assert(day.geo.aInk === day.geo.light && day.geo.bInk === day.geo.dark, `日间主题盘内:字色取这套主题自己的格子色(${day.geo.aInk} / ${day.geo.bInk})`);

  // the fade: one pane drawn, fading in over --dur-base; none under reduced
  // motion. 9.0 S5: the side tabs are gone, so it is the settings page that
  // comes in (pane-in, like every .page), showing one category at a time.
  for (const reduced of [false, true]) {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN", reducedMotion: reduced ? "reduce" : "no-preference" });
    await ctx.addInitScript(() => {
      localStorage.setItem("chess.settings", JSON.stringify({ mode: "pvp", langId: "zh-CN", soundOn: false }));
      localStorage.setItem("chess.panelOpen", "1");
    });
    const page = await ctx.newPage();
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(900);
    if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
    const r = await page.evaluate(() => {
      document.querySelector('#rail button[data-view="settings"]').click();
      document.getElementById("cat-sound").click();
      const shown = [...document.querySelectorAll("#page-settings .set-pane")].filter((p) => !p.hidden).map((p) => p.id);
      const cs = getComputedStyle(document.getElementById("page-settings"));
      const base = getComputedStyle(document.documentElement).getPropertyValue("--dur-base").trim();
      const ms = (v) => (/ms$/.test(v) ? parseFloat(v) : parseFloat(v) * 1000);
      return { shown, name: cs.animationName, dur: cs.animationDuration, base, same: ms(cs.animationDuration) === ms(base), durMs: ms(cs.animationDuration) };
    });
    if (!reduced) {
      assert(r.shown.length === 1 && r.shown[0] === "set-sound" && r.name === "pane-in" && r.same,
        `打开设置页:只画选中的那一类(${r.shown.join(",")}),页面用 pane-in 淡入,时长就是 --dur-base(${r.dur} / ${r.base})`);
    } else {
      assert(r.shown.length === 1 && r.durMs <= 1,
        `减少动态效果:设置页出现不淡入(${r.dur})`);
    }
    await ctx.close();
  }
}

// --- v7-8-plan §4: one dialog for a new game ------------------------------
// Red before 7.8: #btn-new raised the 「清空当前对局？」 confirm (no
// #newgame-modal), 换个对手 switched to the settings tab, and there was no 随机.
// 9.0 S5: the rows are the dialog's own now — no 「对局」 fold on a settings
// tab to borrow them from and give them back to — so "they went home" became
// "they are still the dialog's, and the settings page has none of them".
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    if (sessionStorage.getItem("seeded")) return;
    sessionStorage.setItem("seeded", "1");
    localStorage.setItem("chess.settings", JSON.stringify({
      mode: "ai", difficulty: "normal", humanColor: "w", langId: "zh-CN", soundOn: false }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
  const tap = async (s) => {
    const p = await page.evaluate((n) => {
      const r = document.getElementById("board").getBoundingClientRect();
      return { x: r.left + (n.charCodeAt(0) - 97 + 0.5) * (r.width / 8), y: r.top + (8 - Number(n[1]) + 0.5) * (r.height / 8) };
    }, s);
    await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
  };
  const state = () => page.evaluate(() => {
    const m = document.getElementById("newgame-modal");
    const s = JSON.parse(localStorage.getItem("chess.settings") || "{}");
    return {
      open: !!m && m.classList.contains("show"),
      confirm: document.getElementById("confirm-modal").classList.contains("show"),
      warn: !!m && !document.getElementById("ng-warn").hidden,
      // the rows showing besides 人机 / 双人 (row-mode), in order
      rows: m ? [...document.getElementById("ng-host").children].filter((r) => !r.hidden && r.id !== "row-mode").map((r) => r.id) : [],
      plies: document.querySelectorAll(".mlmove").length,
      view: document.getElementById("app").getAttribute("data-view"),
      settingsShown: !document.getElementById("page-settings").hidden,
      // 10.0 M0: the rung is the lit opponent card (the rows of rung names are gone)
      cardActive: (document.querySelector("#op-grid .op-card.active") || {}).dataset?.op,
      level: document.getElementById("black-level").textContent.trim(),
      settings: s,
      focus: document.activeElement && (document.activeElement.id || document.activeElement.dataset.op || document.activeElement.dataset.diff || document.activeElement.textContent.trim()),
      // 9.0 S5: the rows live in the dialog (style in its 更多选项 fold),
      // whether it is open or not, and nowhere on the settings page
      rowsHome: ["row-opponent", "row-color", "row-clock"].every((id) => document.getElementById(id).parentElement.id === "ng-host")
        && document.getElementById("row-persona").parentElement.id === "ng-custom-body" && !document.getElementById("row-difficulty")
        && !document.querySelector("#page-settings #op-grid, #page-settings #persona-seg, #page-settings #color-seg, #page-settings #clock-seg"),
    };
  });
  const stateBefore = await state();
  assert(stateBefore.rowsHome, "开局前:对手、执子、棋钟、风格都在新对局对话框里(风格在「更多选项」里),设置页上没有它们");

  // a game in progress: one step, the warning in the dialog, no second box
  await tap("e2"); await tap("e4"); await page.waitForTimeout(400);
  await page.click("#btn-new"); await page.waitForTimeout(300);
  let s = await state();
  assert(s.open && !s.confirm, `「新局」打开新对局对话框,不再先弹确认框(对话框 ${s.open} / 确认框 ${s.confirm})`);
  assert(s.warn, "……对局进行中,对话框顶上写着「会结束当前这盘」");
  // v8-0-plan B4: the opponent is a persona card first; rung and style are
  // folded under 自定义 (9.0 S5: after the side and the clock, and the
  // dialog's own rows rather than nodes borrowed from the settings page)
  const inFold = await page.evaluate(() => !!document.getElementById("row-persona").closest("#ng-custom"));
  assert(JSON.stringify(s.rows) === JSON.stringify(["row-opponent", "row-color", "row-clock", "ng-custom"]) && inFold && s.rowsHome,
    `……里面是角色卡、执子、棋钟,风格收在「更多选项」里(${s.rows.join(",")})`);
  assert(s.focus === "ng-start", `……焦点在「开始」上,直接回车就是再来一盘同样的(${s.focus})`);
  // the draft is not the game: choosing 执黑 here changes nothing until 开始
  await page.click('#ng-host #color-seg button[data-color="b"]'); await page.waitForTimeout(200);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  s = await state();
  assert(!s.open && s.plies === 1 && s.settings.humanColor === "w" && s.rowsHome,
    `Esc 关掉:这盘还在(${s.plies} 着),执子没变(${s.settings.humanColor}),控件仍在对话框里`);

  // Tab stays in the dialog and walks it top to bottom
  await page.click("#btn-new"); await page.waitForTimeout(300);
  const order = await page.evaluate(() => {
    const m = document.getElementById("newgame-modal");
    return [...m.querySelectorAll("button")].filter((b) => !b.hidden && b.offsetParent).map((b) => b.id || b.dataset.mode || (b.dataset.seg && "seg" + b.dataset.seg) || b.dataset.op || b.dataset.diff || b.dataset.persona || b.dataset.color || b.dataset.tc);
  });
  await page.keyboard.press("Tab"); await page.waitForTimeout(80);
  const wrapped = (await state()).focus;
  await page.keyboard.press("Shift+Tab"); await page.waitForTimeout(80);
  const back = (await state()).focus;
  // v8-1-plan T1 → 9.0 S2: no segment tabs (入门 / 进阶 / 高手) any more — the
  // eight cards around the pick (中级 is 索尔, so 本 … 艾瑞丝) come straight after 人机 / 双人
  const cardsNow = () => page.evaluate(() => [...document.querySelectorAll("#op-grid .op-card")].filter((b) => !b.hidden)
    .map((b) => b.dataset.op + (b.classList.contains("active") && b.getAttribute("aria-pressed") === "true" ? "*" : "")).join(","));
  assert(order[0] === "ai" && order[1] === "pvp" && order.slice(2, 10).join() === "ben,nico,vera,sol,leo,ivy,max,iris" && order[order.length - 2] === "ng-cancel" && order[order.length - 1] === "ng-start" && wrapped === "人机" && back === "ng-start",
    `Tab 顺序:对手(人机 / 双人) → 八张角色卡 → … → 棋钟 → 取消 → 开始,从「开始」再 Tab 回到第一个(${order.slice(0, 10).join(",")}…${order.slice(-2).join(",")};${wrapped} / ${back})`);
  assert(!(await page.$("#op-seg")), "S2: 角色卡上面没有「入门 / 进阶 / 高手」分段了");
  // change the opponent and start: one step, the strip and the dialog's cards agree
  await page.click('#ng-host #op-grid .op-card[data-op="max"]'); await page.waitForTimeout(150);
  await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  s = await state();
  assert(!s.open && !s.confirm && s.plies === 0, `回车 = 开始:一步就开了新局(${s.plies} 着,没有第二个确认框)`);
  assert(s.settings.difficulty === "hard" && s.cardActive === "max" && /高级/.test(s.level),
    `新档位写进设置、对话框里亮的是这张卡、对阵条上是「${s.level}」`);
  assert(s.rowsHome, "……控件仍是对话框自己的,设置页上没有");

  // 9.0 S2: the eight cards are a window on the ladder that holds the pick and
  // moves with it. 10.0 M0: 更多选项 open shows the whole ladder — the one
  // place a rung is chosen (the two rows of rung names under it are gone)
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);
  const w0 = await cardsNow();
  assert(w0 === "sol,leo,ivy,max*,iris,otto,hugo,zoe", `S2:选了马克斯(高级)再开对话框,八张卡是他和他两边的人,他亮着(${w0})`);
  await page.click("#ng-custom > summary"); await page.waitForTimeout(200);
  const w1 = await cardsNow();
  assert(w1.split(",").length === 21 && w1.includes("max*") && !(await page.$("#diff-seg, #diff-seg-engine")),
    `10.0 M0:打开「更多选项」,角色卡展开成全部 21 位,马克斯亮着,下面不再有第二排档位(${w1})`);
  await page.click('#ng-host #op-grid .op-card[data-op="pip"]'); await page.waitForTimeout(200);
  await page.click("#ng-custom > summary"); await page.waitForTimeout(200);
  const w2 = await cardsNow();
  assert(w2 === "pip*,tomo,lina,kai,ada,remy,ben,nico", `S2:选了皮普再收起,八张卡挪到梯子底,皮普亮着(${w2})`);
  await page.click('#ng-host #op-grid .op-card[data-op="ben"]'); await page.waitForTimeout(200);
  const w3 = await cardsNow();
  assert(w3.split(",").length === 8 && w3.includes("ben*"), `S2:收起时选本,八张卡的窗口跟着他(${w3})`);
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  s = await state();
  assert(!s.open && s.settings.difficulty === "hard", `……Esc 不开始:设置里还是高级(${s.settings.difficulty})`);

  // no moves: no warning. 随机 is offered, and remembered
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);   // hidden with no moves on the board; N and the menu reach the same handler
  s = await state();
  assert(s.open && !s.warn, "没有着法时不写「会结束当前这盘」");
  await page.click('#ng-host #color-seg button[data-color="random"]'); await page.waitForTimeout(150);
  await page.click("#ng-start"); await page.waitForTimeout(500);
  s = await state();
  assert(s.settings.colorRandom === true && ["w", "b"].includes(s.settings.humanColor),
    `执子「随机」:抽到了一方(${s.settings.humanColor}),并记住这次选的是随机`);
  // 9.0 S5: the side is only chosen in the dialog; outside it 随机 stays hidden
  const randomHidden = await page.evaluate(() => document.querySelector('#color-seg button[data-color="random"]').hidden
    && !document.querySelector("#page-settings #color-seg"));
  assert(randomHidden, "……对话框关着时「随机」这一格藏着,设置页上也没有执子 —— 那是开局的选项,不是换边");
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);   // hidden with no moves on the board; N and the menu reach the same handler
  const pre = await page.evaluate(() => (document.querySelector("#ng-host #color-seg button.active") || {}).dataset?.color);
  assert(pre === "random", `再开对话框,预选的仍是上次的「随机」(${pre})`);
  await page.click("#ng-cancel"); await page.waitForTimeout(300);
  // …until a side is picked: that is a side, not 随机 (Codex, #83). 9.0 S5:
  // the dialog is the one place a side is picked, so it is picked there
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);
  await page.click('#ng-host #color-seg button[data-color="w"]'); await page.waitForTimeout(150);
  await page.click("#ng-start"); await page.waitForTimeout(500);
  const picked = (await state()).settings;
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);
  const fixed = await page.evaluate(() => (document.querySelector("#ng-host #color-seg button.active") || {}).dataset?.color);
  assert(fixed === "w" && picked.humanColor === "w" && picked.colorRandom !== true,
    `在新对局里选了白方开局,下次对话框预选白方,不再是「随机」(${fixed};设置 ${picked.humanColor} / 随机 ${picked.colorRandom})`);
  await page.click("#ng-cancel"); await page.waitForTimeout(300);

  // the result bar's 再来一盘 opens the same dialog (9.0 M1: 换个对手 was
  // the same dialog again, and is gone)
  await page.evaluate(() => document.getElementById("go-again").click()); await page.waitForTimeout(300);
  s = await state();
  assert(s.open && s.view === "play" && !s.settingsShown, `「再来一盘」打开同一个对话框,留在棋盘上(${s.view})`);
  assert(await page.evaluate(() => !document.getElementById("go-switch")), "结果条上不再有「换个对手」，再来一盘就是那个对话框");
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);

  // two players: only who plays White (the bottom side) and the clock.
  // v8-0-plan A1: 双人 is chosen in the dialog, with the game it starts
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);   // hidden with no moves on the board; N and the menu reach the same handler
  await page.click('#ng-host #mode-seg button[data-mode="pvp"]'); await page.waitForTimeout(200);
  s = await state();
  // 9.0 S2: 更多选项 stays (the rarer clocks are in it); its style row hides
  const pvpFold = await page.evaluate(() => String(document.getElementById("row-persona").hidden));
  assert(s.open && JSON.stringify(s.rows) === JSON.stringify(["row-color", "row-clock", "ng-custom"]) && pvpFold === "true",
    `双人模式只显示「谁执白」、棋钟和「更多选项」(里面没有风格)(${s.rows.join(",")} / ${pvpFold})`);
  await page.click('#ng-host #color-seg button[data-color="b"]'); await page.waitForTimeout(150);
  // 9.0 S2: 5+3 is under 更多选项, which stays in 双人 (its style row hides)
  await page.click("#ng-custom > summary"); await page.waitForTimeout(150);
  await page.click('#ng-custom #clock-seg-more button[data-tc="5+3"]'); await page.waitForTimeout(150);
  await page.click("#ng-start"); await page.waitForTimeout(400);
  s = await state();
  const flipped = await page.evaluate(() => !!document.querySelector('#orient-seg button[data-orient="b"].active'));
  assert(s.settings.timeControl === "5+3" && flipped, `双人:棋钟 5+3、下方执黑(棋盘翻转 ${flipped})`);
  // with 自动转向 on, the board faces whoever is to move — a bottom side
  // chosen here would be undone the moment the game starts (Codex, #83).
  // 9.0 S5: 自动翻转 is in the settings page's 对局 category
  await toSettings(page, "game");
  await page.click("#opt-autoflip"); await page.waitForTimeout(150);
  await toPlay(page);
  await page.evaluate(() => document.getElementById("btn-new").click()); await page.waitForTimeout(300);
  s = await state();
  assert(s.open && JSON.stringify(s.rows) === JSON.stringify(["row-clock", "ng-custom"]),
    `双人、自动转向开着:不问哪一方在下方,只有棋钟(和收着更多棋钟的「更多选项」)(${s.rows.join(",")})`);
  await page.click("#ng-start"); await page.waitForTimeout(400);
  const white = await page.evaluate(() => !!document.querySelector('#orient-seg button[data-orient="w"].active'));
  assert(white, "双人、自动转向开着:开局白方在下方");
  assert(errs.length === 0, `新对局对话框:全程没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

// --- v8-0-plan §5: the small fixes that live on the board ------------------
// Red before §5: (a) at move 0 no control on screen opened the new-game
// dialog — 新局 waits for a game to end; (b) 「我会下棋」 closed the guide on a
// game against 初级 that nobody had been asked about; (c) 悔棋 stood beside a
// mated king, and Z took the mate back.
{
  const seeded = async (mode) => {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
    await ctx.addInitScript((m) => {
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: m, difficulty: "normal", humanColor: "w", langId: "zh-CN", soundOn: false }));
      localStorage.setItem("chess.panelOpen", "1");
    }, mode);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1000);
    await page.click("#pick-cancel", { timeout: 800 }).catch(() => {});
    return { ctx, page, errs };
  };
  const ngState = (page) => page.evaluate(() => ({
    open: document.getElementById("newgame-modal").classList.contains("show"),
    focus: document.activeElement && (document.activeElement.id || document.activeElement.dataset.op || document.activeElement.dataset.diff || ""),
    plies: document.querySelectorAll(".mlmove").length,
  }));

  // (a) move 0: a visible way in, in both playing modes
  for (const [mode, label, focus] of [["ai", "换个对手", "sol"], ["pvp", "新局", "ng-start"]]) {
    const { ctx, page, errs } = await seeded(mode);
    const b = await page.evaluate(() => {
      const e = document.getElementById("idle-new");
      return e ? { shown: !!e.offsetParent, text: e.textContent.trim() } : null;
    });
    assert(!!b && b.shown && b.text === label,
      `§5 ${mode} 一步未走:棋盘旁有「${label}」可点(${JSON.stringify(b)})`);
    if (b && b.shown) {
      await page.click("#idle-new"); await page.waitForTimeout(300);
      const s = await ngState(page);
      assert(s.open && s.focus === focus, `§5 ${mode} …点它打开新对局对话框,焦点在 ${focus}(${JSON.stringify(s)})`);
      await page.keyboard.press("Escape"); await page.waitForTimeout(300);
    }
    // …and it goes once the game has begun: 本局's 新局 takes over
    const tap = async (sq) => {
      const p = await page.evaluate((q) => {
        const r = document.getElementById("board").getBoundingClientRect(), z = r.width / 8;
        return { x: r.left + (q.charCodeAt(0) - 97 + 0.5) * z, y: r.top + (8 - Number(q[1]) + 0.5) * z };
      }, sq);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
    };
    await tap("e2"); await tap("e4"); await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      idle: !!(document.getElementById("idle-new") || {}).offsetParent,
      btnNew: !!document.getElementById("btn-new").offsetParent,
    }));
    assert(!after.idle && after.btnNew, `§5 ${mode} 走了一步之后:它让位给「本局」里的新局(${JSON.stringify(after)})`);
    assert(errs.length === 0, `§5 ${mode}:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (b) first launch, 「我会下棋」: the dialog, on the opponent
  {
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
    const page = await ctx.newPage();          // nothing seeded: a new install
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1200);
    const guide = await page.evaluate(() => document.querySelectorAll("#pick-list .pick-item").length);
    assert(guide === 2, `§5 新安装:引导里两条路(${guide})`);
    await page.evaluate(() => document.querySelectorAll("#pick-list .pick-item")[1].click());
    await page.waitForTimeout(500);
    let s = await ngState(page);
    const pick = await page.evaluate(() => ({
      guide: document.getElementById("pick-modal").classList.contains("show"),
      diff: (document.querySelector("#ng-host #op-grid .op-card.active") || {}).dataset?.op,
    }));
    assert(!pick.guide && s.open, `§5 选「我会下棋」:引导关掉,新对局对话框打开(${JSON.stringify(s)})`);
    assert(pick.diff === "ben" && s.focus === "ben", `§5 …预选初级(本),焦点在他的角色卡上(${pick.diff} / ${s.focus})`);
    await page.keyboard.press("Enter"); await page.waitForTimeout(500);
    s = await ngState(page);
    const set = await page.evaluate(() => JSON.parse(localStorage.getItem("chess.settings") || "{}"));
    assert(!s.open && set.mode === "ai" && set.difficulty === "easy", `§5 …回车开局:人机、初级(${set.mode} / ${set.difficulty})`);
    assert(errs.length === 0, `§5 首次启动:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (c) a finished game: no 悔棋, and Z does not take the mate back
  {
    const { ctx, page, errs } = await seeded("pvp");
    const tap = async (sq) => {
      const p = await page.evaluate((q) => {
        const r = document.getElementById("board").getBoundingClientRect(), z = r.width / 8;
        const flip = !!document.querySelector('#orient-seg button[data-orient="b"].active');
        const f = q.charCodeAt(0) - 97, rk = 8 - Number(q[1]);
        return { x: r.left + ((flip ? 7 - f : f) + 0.5) * z, y: r.top + ((flip ? 7 - rk : rk) + 0.5) * z };
      }, sq);
      await page.mouse.click(p.x, p.y); await page.waitForTimeout(150);
    };
    for (const [a, b] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) { await tap(a); await tap(b); await page.waitForTimeout(250); }
    const undoShown = () => page.evaluate(() => {
      const u = document.getElementById("undo");
      return !!u && !u.hidden && !u.classList.contains("slot-empty");
    });
    const r = await page.evaluate(() => ({
      plies: document.querySelectorAll(".mlmove").length,
      card: !document.getElementById("go-card").hidden,
      again: !document.getElementById("go-again").hidden,
    }));
    assert(r.plies === 4 && r.card, `§5 愚者杀:四着,结果卡片在(${JSON.stringify(r)})`);
    assert(!(await undoShown()), "§5 终局之后「悔棋」不在");
    assert(r.again, "§5 …自己下完的一盘,「再来一盘」还在");
    await page.keyboard.press("z"); await page.waitForTimeout(300);
    const plies = await page.evaluate(() => document.querySelectorAll(".mlmove").length);
    assert(plies === 4, `§5 …按 Z 也不把杀棋收回去(${plies} 着)`);
    assert(errs.length === 0, `§5 终局:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (d) a game opened from a file, still unfinished: someone's record, so no
  // 悔棋 either — the finished ones already lost it to the ending itself
  {
    const { ctx, page, errs } = await seeded("pvp");
    await page.evaluate(async () => {
      const pgn = '[Event "Club"]\n[White "alice"]\n[Black "bob"]\n[Result "*"]\n\n1. e4 e5 2. Nf3 Nc6 *\n';
      const dt = new DataTransfer();
      dt.items.add(new File([pgn], "one.pgn", { type: "application/x-chess-pgn" }));
      document.body.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await new Promise((r) => setTimeout(r, 900));
    });
    if (await page.evaluate(() => document.getElementById("confirm-modal").classList.contains("show"))) {
      await page.click("#confirm-ok"); await page.waitForTimeout(500);
    }
    const r = await page.evaluate(() => {
      const u = document.getElementById("undo");
      return { plies: document.querySelectorAll(".mlmove").length, undo: !!u && !u.hidden && !u.classList.contains("slot-empty") };
    });
    assert(r.plies === 4 && !r.undo, `§5 打开的棋谱(未终局):没有「悔棋」(${JSON.stringify(r)})`);
    await page.keyboard.press("z"); await page.waitForTimeout(300);
    const plies = await page.evaluate(() => document.querySelectorAll(".mlmove").length);
    assert(plies === 4, `§5 …按 Z 也不改(${plies} 着)`);
    assert(errs.length === 0, `§5 打开棋谱:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
}

// --- v8-0-plan A3: 棋盘与棋子的新材质 ----------------------------------------
// Red before A3: a first run drew the 17px wooden frame (data-frame did not
// exist), the black king was the 7.x redrawing, and there was no picker to
// click. The flat board, the new default set and the pickers, measured.
{
  const open = async (settings, vp, scheme) => {
    const ctx = await browser.newContext({ viewport: vp || { width: 1200, height: 900 }, locale: "zh-CN", colorScheme: scheme || "light" });
    await ctx.addInitScript((s) => {
      if (s) localStorage.setItem("chess.settings", JSON.stringify(s));
      localStorage.setItem("chess.panelOpen", "1");
    }, settings);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForFunction(() => window.__chess && window.__chess.board && window.__chess.board().imageRedraws >= 1,
      null, { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(400);
    if (await page.isVisible("#pick-cancel")) await page.click("#pick-cancel");
    return { ctx, page, errs };
  };
  const geometry = (page) => page.evaluate(() => {
    const board = document.getElementById("board").getBoundingClientRect();
    const wrap = document.getElementById("board-wrap").getBoundingClientRect();
    const root = document.documentElement;
    return { frame: board.x - wrap.x, step: board.width / 8, radius: parseFloat(getComputedStyle(document.getElementById("board")).borderTopLeftRadius),
      wrapBg: getComputedStyle(document.getElementById("board-wrap")).backgroundImage,
      attrs: [root.dataset.theme, root.dataset.board, root.dataset.frame].join("/"),
      coords: document.getElementById("app").getAttribute("data-coords") };
  });
  // 9.0 S5: no side tabs; the board's rect is read on the play view, first
  // straight away, then after a round trip through the settings page
  const rectOn = async (page, via) => {
    if (via) await toSettings(page, via);
    await toPlay(page);
    return page.evaluate(() => {
      const r = document.getElementById("board").getBoundingClientRect();
      return [r.x, r.y, r.width, r.height].join(",");
    });
  };
  // 1 · a first run: flat, rounded 2–4px, coordinates in the squares, the
  //     wood board in the light shell of a light system — and the rect holds
  //     across a visit to 设置 (the 7.7 invariant, re-proved on the new default)
  for (const vp of [{ width: 1200, height: 900 }, { width: 600, height: 900 }]) {
    const at = vp.width + "×" + vp.height;
    const flat = await open(null, vp);
    const g = await geometry(flat.page);
    assert(g.attrs === "day/wood/flat", `A3 ${at} 新用户:浅色系统下是浅色外壳、木盘、平盘(${g.attrs})`);
    assert(g.frame === 0 && g.wrapBg === "none", `A3 ${at} 平盘没有木框(外框 ${g.frame}px,背景 ${g.wrapBg})`);
    assert(g.radius >= 2 && g.radius <= 4, `A3 ${at} 平盘圆角 2–4px(${g.radius}px)`);
    assert(g.coords === "in", `A3 ${at} 平盘坐标写在格子里(data-coords=${g.coords})`);
    const rects = [];
    for (const via of [null, "board", "general"]) rects.push(await rectOn(flat.page, via));
    assert(new Set(rects).size === 1, `A3 ${at} 平盘:去一趟设置页再回来,棋盘矩形逐像素不变(${[...new Set(rects)].join(" / ")})`);
    assert(flat.errs.length === 0, `A3 ${at} 新用户:没有页面异常${flat.errs.length ? " — " + flat.errs[0] : ""}`);
    await flat.ctx.close();
    // the wooden frame is still there, one choice away, as it was
    const framed = await open({ mode: "pvp", langId: "zh-CN", appearance: "dark", boardId: "wood", boardFrame: "frame" }, vp);
    const h = await geometry(framed.page);
    assert(h.attrs === "wood/wood/frame" && h.frame === 17 && /gradient/.test(h.wrapBg) && h.coords === "out",
      `A3 ${at} 选木框:17px 木框、渐变、坐标印在框上,与 7.x 相同(${h.attrs},${h.frame}px,${h.coords})`);
    assert(g.step > h.step, `A3 ${at} 平盘的格子比木框大(${h.step.toFixed(1)} → ${g.step.toFixed(1)})`);
    await framed.ctx.close();
  }

  // 2 · the black king reads as black at 1×. The stand-in for the plan's
  //     blind test: the mean luminance of the king's ink (every pixel that is
  //     not the bare square) on e8 and on e1. The 7.x drawing put a heavy
  //     white outline round the black king — 54 levels between the two kings;
  //     the original cburnett, 79. The floor sits between them.
  const KING_GAP_FLOOR = 70;
  const kingGap = async (set) => {
    const { ctx, page } = await open({ mode: "pvp", langId: "zh-CN", appearance: "light", boardId: "wood", boardFrame: "flat", pieceSet: set },
      { width: 1440, height: 900 });
    await page.waitForTimeout(600);
    const r = await page.evaluate(() => {
      const c = document.getElementById("board");
      const g = c.getContext("2d");
      const step = c.width / 8;
      const mean = (col, row) => {
        const n = Math.round(step);
        const d = g.getImageData(Math.round(col * step), Math.round(row * step), n, n).data;
        let ink = 0, sum = 0;
        for (let i = 0; i < d.length; i += 4) {
          if (Math.abs(d[i] - d[0]) + Math.abs(d[i + 1] - d[1]) + Math.abs(d[i + 2] - d[2]) < 60) continue;
          ink++; sum += 0.2126 * d[i] + 0.7152 * d[i + 1] + 0.0722 * d[i + 2];
        }
        return ink ? sum / ink : 0;
      };
      return { dpr: window.devicePixelRatio, black: mean(4, 0), white: mean(4, 7) };
    });
    await ctx.close();
    return r;
  };
  const now = await kingGap("cburnett");
  const was = await kingGap("classic");
  assert(now.dpr === 1 && now.white - now.black >= KING_GAP_FLOOR,
    `A3 1× 默认棋子:黑王与白王的墨色亮度差 ${(now.white - now.black).toFixed(0)} ≥ ${KING_GAP_FLOOR}(黑 ${now.black.toFixed(0)},白 ${now.white.toFixed(0)})`);
  assert(was.white - was.black < KING_GAP_FLOOR,
    `A3 1× 7.x 的重绘版(「经典」)是这条线要拦的:差 ${(was.white - was.black).toFixed(0)} < ${KING_GAP_FLOOR}`);

  // 3 · the pickers: each choice lands on the page and in the settings, and
  //     the appearance answers the system while it follows it
  {
    const { ctx, page, errs } = await open({ mode: "pvp", langId: "zh-CN" }, null, "dark");
    const state = () => page.evaluate(() => {
      const root = document.documentElement;
      const s = JSON.parse(localStorage.getItem("chess.settings") || "{}");
      const on = (sel) => [...document.querySelectorAll(sel)].filter((b) => b.getAttribute("aria-pressed") === "true").map((b) => b.textContent.trim());
      return { attrs: [root.dataset.theme, root.dataset.board, root.dataset.frame].join("/"),
        saved: [s.appearance, s.boardId, s.boardFrame, s.pieceSet].join("/"),
        pressed: [on("#appearance-seg button"), on("#board-pick-seg button"), on("#frame-seg button")].map((x) => x.join("")).join("/") };
    });
    let st = await state();
    assert(st.attrs === "wood/wood/flat" && st.pressed === "跟随系统/木/平盘",
      `A3 选择器:深色系统下跟随系统 = 深色外壳(${st.attrs};按下的是 ${st.pressed})`);
    // the pickers live on the settings page (9.0 S5; the preferences window of
    // v8-0-plan A1 before it), opened the way a person opens it: board, frame
    // and pieces under 棋盘, light / dark under 通用
    await toSettings(page, "board");
    const pick = async (sel) => { await page.click(sel); await page.waitForTimeout(250); };
    await pick('#board-pick-seg button[data-board-id="green"]');
    st = await state();
    assert(st.attrs === "night/green/flat" && st.saved.startsWith("system/green/flat"),
      `A3 选绿盘:冷色棋盘配冷色外壳(${st.attrs}),设置里记下(${st.saved})`);
    const appIn = await page.evaluate(() => !!document.querySelector("#set-general #appearance-seg"));
    assert(appIn, "9.0 S5 浅色 / 深色在设置页的「通用」里,不在「棋盘」里");
    await pick("#cat-general");
    await pick('#appearance-seg button[data-appearance="light"]');
    await pick("#cat-board");
    await pick('#frame-seg button[data-frame="frame"]');
    st = await state();
    assert(st.attrs === "notebook/green/frame" && st.saved.startsWith("light/green/frame") && st.pressed === "浅色/绿/木框",
      `A3 选浅色、木框:${st.attrs},${st.saved},按下 ${st.pressed}`);
    // the texture: marble's veins are on the canvas, not only in a variable.
    // 9.0 S5: the settings page covers the board, so it is read back on the
    // play view — the board a person sees after choosing
    await pick('#board-pick-seg button[data-board-id="marble"]');
    await toPlay(page);
    const spread = await page.evaluate(() => {
      const c = document.getElementById("board"), g = c.getContext("2d"), step = c.width / 8;
      // an empty square (d5 — light on this side) across its middle
      const d = g.getImageData(Math.round(3 * step + step * 0.1), Math.round(3 * step + step * 0.1), Math.round(step * 0.8), Math.round(step * 0.8)).data;
      const seen = new Set();
      for (let i = 0; i < d.length; i += 4) seen.add(d[i] + "," + d[i + 1] + "," + d[i + 2]);
      return seen.size;
    });
    assert(spread > 20, `A3 大理石:空格子上有纹理(${spread} 种颜色,平涂只有 1 种)`);
    await toSettings(page, "board");
    // the kings in the piece picker: fetched once the row is on screen
    await page.evaluate(() => document.getElementById("piece-pick-seg").scrollIntoView());
    await page.waitForFunction(() => [...document.querySelectorAll("#piece-pick-seg img")].every((i) => i.src.startsWith("data:image/svg")),
      null, { timeout: 8000 }).catch(() => {});
    const kings = await page.evaluate(() => [...document.querySelectorAll("#piece-pick-seg img")].filter((i) => i.src.startsWith("data:image/svg")).length);
    assert(kings === 14, `A3 棋子选择器:七套各画出黑白两王(${kings} / 14)`);
    assert(errs.length === 0, `A3 选择器:没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
}

// --- v8-0-plan A5：关键时刻与动效 --------------------------------------------
// The ending on the board (a badge on each king, the result card floating
// over the squares), a puzzle move's ✓ / ✗ on its square — green for right,
// and no red anywhere on the board for a solve, even a solve by mate —, the
// achievement toast with its badge and a longer life, the selected piece
// lifted with its legal squares fading in, and all of it still under reduced
// motion. Paint is read off the canvas; the colours off the theme tokens.
{
  const A5 = "/tmp/claude-0/-home-user-chessboard/b4147711-97e5-5ada-9636-d97168cd9145/scratchpad/M4-view/shots-a5";
  const SHOTS = process.env.A5_SHOTS ? A5 : null;
  if (SHOTS) fs.mkdirSync(SHOTS, { recursive: true });
  const openA5 = async (settings, opts = {}) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 860 }, locale: "zh-CN" });
    await ctx.addInitScript(([st, pz]) => {
      localStorage.setItem("chess.settings", JSON.stringify(Object.assign({ langId: "zh-CN", soundOn: false,
        appearance: "dark", boardId: "wood", boardFrame: "flat" }, st)));
      localStorage.setItem("chess.panelOpen", "1");
      if (pz) localStorage.setItem("chess.puzzles", JSON.stringify(pz));
    }, [settings, opts.puzzles || null]);
    const page = await ctx.newPage();
    const errs = [];
    page.on("pageerror", (e) => errs.push(e.message));
    if (opts.reduce) await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto(`http://127.0.0.1:${PORT}/`);
    await page.waitForTimeout(1000);
    await page.click("#pick-cancel", { timeout: 500 }).catch(() => {});
    return { ctx, page, errs };
  };
  // a square's centre on the page, and the corner badge's pixel on the canvas
  const at = (page, sq, flip) => page.evaluate(([s, fl]) => {
    const r = document.getElementById("board").getBoundingClientRect();
    let f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    if (fl) { f = 7 - f; rk = 7 - rk; }
    return { x: r.left + (f + 0.5) * (r.width / 8), y: r.top + (rk + 0.5) * (r.height / 8) };
  }, [sq, flip]);
  const tap = async (page, sq, flip) => { const p = await at(page, sq, flip); await page.mouse.click(p.x, p.y); await page.waitForTimeout(160); };
  const paintAt = (page, sq, flip, where) => page.evaluate(([s, fl, w]) => {
    const cv = document.getElementById("board");
    const step = cv.width / 8;
    let f = s.charCodeAt(0) - 97, rk = 8 - Number(s[1]);
    if (fl) { f = 7 - f; rk = 7 - rk; }
    // the reveal badges' corner (board.js): centre 0.19 of a square in,
    // radius 0.15 — read near its top, clear of the glyph or the tick
    const x = w === "badge" ? (f + 1) * step - step * 0.19 : f * step + step * (w === "edge" ? 0.12 : 0.5);
    const y = w === "badge" ? rk * step + step * 0.19 - step * 0.15 * 0.7 : rk * step + step * (w === "edge" ? 0.88 : 0.5);
    const d = cv.getContext("2d").getImageData(Math.round(x), Math.round(y), 1, 1).data;
    return [d[0], d[1], d[2]];
  }, [sq, flip, where]);
  const token = (page, name) => page.evaluate((n) => {
    const s = document.createElement("span");
    s.style.color = getComputedStyle(document.documentElement).getPropertyValue(n);
    document.body.appendChild(s);
    const c = (getComputedStyle(s).color.match(/\d+/g) || []).map(Number).slice(0, 3);
    s.remove();
    return c;
  }, name);
  const near = (a, b, tol = 14) => a.length === 3 && b.length === 3 && a.every((v, i) => Math.abs(v - b[i]) <= tol);

  // (1) the end of a game: the kings carry the result, the bar takes the bottom strip's place
  {
    const { ctx, page, errs } = await openA5({ mode: "pvp" });
    for (const [a, b] of [["f2", "f3"], ["e7", "e5"], ["g2", "g4"], ["d8", "h4"]]) { await tap(page, a); await tap(page, b); await page.waitForTimeout(200); }
    await page.waitForTimeout(700);
    const good = await token(page, "--judge-good"), bad = await token(page, "--judge-bad");
    const e1 = await paintAt(page, "e1", false, "badge"), e8 = await paintAt(page, "e8", false, "badge");
    assert(near(e1, bad) && near(e8, good),
      `A5 终局：被将杀的白王角上是 --judge-bad 的徽标，黑王角上是 --judge-good（${e1} / ${e8}）`);
    const card = await page.evaluate(async () => {
      const c = document.getElementById("go-card"), w = document.getElementById("board-wrap");
      await Promise.all((c.getAnimations ? c.getAnimations() : []).map((a) => a.finished.catch(() => {})));
      const r = c.getBoundingClientRect(), b = w.getBoundingClientRect();
      const cv = document.getElementById("board").getBoundingClientRect();
      const s = document.querySelector(".pstrip.at-bottom");
      return { shown: !!c.offsetParent, clear: r.top >= cv.bottom - 0.5, under: Math.abs(r.left - b.left) <= 1 && Math.abs(r.right - b.right) <= 1,
        strip: getComputedStyle(s).visibility, result: document.getElementById("go-result").textContent };
    });
    assert(card.shown && card.clear && card.under && card.strip === "hidden",
      `9.0 M1 终局：结果条在棋盘下沿、占底部玩家栏的位置，不压 64 格（${JSON.stringify(card)}）`);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/end-of-game.png" });
    // stepping back into the game: the card and the badges step aside
    await page.click("#rep-prev");
    await page.waitForTimeout(600);
    const back = await page.evaluate(() => !document.getElementById("go-card").hidden);
    const e1b = await paintAt(page, "e1", false, "badge");
    assert(!back && !near(e1b, bad), `A5 终局：退回一步，结果卡和王上的徽标都让开（卡 ${back}，${e1b}）`);
    await page.click("#rep-end");
    await page.waitForTimeout(600);
    await page.click("#go-close");
    await page.waitForTimeout(300);
    const closed = await page.evaluate(() => document.getElementById("go-card").hidden);
    assert(closed && near(await paintAt(page, "e1", false, "badge"), bad), "A5 终局：✕ 收起结果卡，王上的徽标还在");
    assert(errs.length === 0, `A5 终局：没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (1b) Codex #89: a finished game branched from an earlier move — the leaf of
  // the variation is not the game's end, and its kings carry no result
  {
    const { ctx, page, errs } = await openA5({ mode: "pvp" });
    for (const [a, b] of [["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"]]) { await tap(page, a); await tap(page, b); await page.waitForTimeout(200); }
    // Black resigns: an ending the rules do not make, on the mainline's last position
    await page.click("#btn-resign");
    await page.waitForTimeout(300);
    await page.click("#confirm-alt");
    await page.waitForTimeout(600);
    await page.click("#go-close").catch(() => {});
    await page.waitForTimeout(300);
    const good = await token(page, "--judge-good"), bad = await token(page, "--judge-bad");
    const endW = await paintAt(page, "e1", false, "badge"), endB = await paintAt(page, "e8", false, "badge");
    // stand before 2…Nc6 and play 2…Nf6 instead: a variation, its leaf on the board
    await page.click('#move-list .mlmove[data-i="3"]');
    await page.waitForTimeout(400);
    await tap(page, "g8"); await tap(page, "f6");
    await page.waitForTimeout(700);
    const vW = await paintAt(page, "e1", false, "badge"), vB = await paintAt(page, "e8", false, "badge");
    const cardOnVar = await page.evaluate(() => !document.getElementById("go-card").hidden);
    assert(!cardOnVar, "A5 终局：变着上没有结果卡（这盘棋的结局不在这条线上）");
    const line = await page.evaluate(() => !!document.querySelector('#move-list .mlv[aria-label="Nf6"]') ? "Nf6" : document.getElementById("move-list").innerText);
    assert(near(endW, good) && near(endB, bad), `A5 终局：黑方认输，最后局面的王上有徽标（${endW} / ${endB}）`);
    assert(line === "Nf6" && !near(vW, good) && !near(vB, bad), `A5 终局：从中途走出的变着，末端的王上没有这盘棋的结果（${vW} / ${vB} · ${line}）`);
    assert(errs.length === 0, `A5 变着：没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (2) a puzzle: ✗ in red for a wrong move, ✓ in green for the right one, no red for the solve
  {
    const { ctx, page, errs } = await openA5({ mode: "puzzle" }, { puzzles: { v: 1, idv: 2, solved: {}, missed: {}, cat: "m1" } });
    await page.waitForTimeout(600);
    const fen = await page.evaluate(() => (window.__chess.puzzle ? window.__chess.puzzle() : null));
    const g = new Chess(fen || undefined);
    const flip = g.turn() === "b";
    const moves = g.moves({ verbose: true });
    const mate = moves.find((m) => { const p = new Chess(fen); p.move(m); return p.in_checkmate(); });
    const miss = moves.find((m) => { const p = new Chess(fen); p.move(m); return !p.in_checkmate() && !p.in_check(); }) ||
      moves.find((m) => m !== mate);
    assert(!!fen && !!mate && !!miss, `A5 做题：一道一步杀（${fen}）`);
    const good = await token(page, "--judge-good"), bad = await token(page, "--judge-bad");
    await tap(page, miss.from, flip); await tap(page, miss.to, flip);
    await page.waitForTimeout(700);
    const x = await paintAt(page, miss.to, flip, "badge");
    const fb = await page.evaluate(() => document.getElementById("puzzle-feedback").className);
    assert(/bad/.test(fb) && near(x, bad), `A5 做题：走错，${miss.san} 的目标格角上是红色 ✗（${x} vs ${bad}）`);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/puzzle-wrong.png" });
    await tap(page, mate.from, flip); await tap(page, mate.to, flip);
    await page.waitForTimeout(900);
    const ok = await paintAt(page, mate.to, flip, "badge");
    assert(near(ok, good), `A5 做题：走对，${mate.san} 的目标格角上是绿色 ✓（${ok} vs ${good}）`);
    // the mated king: the solve is not signalled in the check's red
    const after = new Chess(fen); after.move(mate);
    let kingSq = null;
    after.board().forEach((row, r) => row.forEach((pc, c) => { if (pc && pc.type === "k" && pc.color === after.turn()) kingSq = "abcdefgh"[c] + (8 - r); }));
    // red, measured as how much redder than its own square colour a point is:
    // the check's glow and ring sit round the king, off the piece
    const redShift = () => page.evaluate(() => {
      const cv = document.getElementById("board");
      const step = cv.width / 8, ctx2 = cv.getContext("2d");
      const css = getComputedStyle(document.documentElement);
      const rgb = (v) => { const e = document.createElement("span"); e.style.color = v; document.body.appendChild(e);
        const c = getComputedStyle(e).color.match(/\d+/g).map(Number); e.remove(); return c; };
      const light = rgb(css.getPropertyValue("--sq-light")), dark = rgb(css.getPropertyValue("--sq-dark"));
      const out = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const base = (r + c) % 2 === 0 ? light : dark;
        let worst = 0;
        for (const [fx, fy] of [[0.1, 0.5], [0.9, 0.5], [0.5, 0.92]]) {
          const d = ctx2.getImageData(Math.round(c * step + step * fx), Math.round(r * step + step * fy), 1, 1).data;
          // red pulls red away from green AND from blue; 9.0 V1's brass last
          // move pulls it from blue alone (it is yellow), and is not red
          worst = Math.max(worst, Math.min((d[0] - d[1]) - (base[0] - base[1]), (d[0] - d[2]) - (base[0] - base[2])));
        }
        out.push(worst);
      }
      return out;
    });
    const shifts = await redShift();
    const f = kingSq.charCodeAt(0) - 97, rk = 8 - Number(kingSq[1]);
    const ki = (flip ? 7 - rk : rk) * 8 + (flip ? 7 - f : f);
    assert(shifts[ki] < 20, `A5 做题：解出（将杀）之后，被杀的王格上没有将军的红光 —— 成功不用红色（红移 ${shifts[ki]}）`);
    // nowhere on the board, in fact
    const red = shifts.filter((x) => x >= 20).length;
    assert(red === 0, `A5 做题：解出时整块棋盘上没有一格发红（${red} 格）`);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/puzzle-right.png" });
    // (3) the achievement the first solve unlocks: its badge's icon, and it stays
    await page.waitForFunction(() => /成就/.test(document.getElementById("toast").textContent), null, { timeout: 6000 }).catch(() => {});
    const t0 = await page.evaluate(() => {
      const t = document.getElementById("toast");
      return { text: t.textContent, cls: t.className, icon: !!t.querySelector("svg.toast-ic") };
    });
    assert(/成就/.test(t0.text) && t0.icon && /t-ach/.test(t0.cls), `A5 成就：toast 带徽章图标（${t0.text} · ${t0.cls}）`);
    if (SHOTS) await page.screenshot({ path: SHOTS + "/achievement.png" });
    await page.waitForTimeout(4500);
    const t1 = await page.evaluate(() => ({ show: document.getElementById("toast").classList.contains("show"), text: document.getElementById("toast").textContent }));
    assert(t1.show && /成就/.test(t1.text), `A5 成就：4.5 秒后还在（旧的只留 2.2 秒）（${t1.show}）`);
    assert(errs.length === 0, `A5 做题：没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }

  // (4) selection: the piece lifts, the legal squares fade in — and under
  // reduced motion both are simply there, drawn once
  const foot = (page) => page.evaluate(() => {
    // the e2 pawn's foot: the lowest of its lightest pixels down the square's middle
    const cv = document.getElementById("board");
    const step = cv.width / 8, c2 = cv.getContext("2d");
    const col = (y) => { const d = c2.getImageData(Math.round(4 * step + step / 2), Math.round(6 * step + y), 1, 1).data; return d[0] + d[1] + d[2]; };
    let lowest = 0;
    for (let y = 0; y < step; y++) if (col(y) > 720) lowest = y;
    return lowest;
  });
  const counts = {};
  for (const reduce of [false, true]) {
    const { ctx, page, errs } = await openA5({ mode: "pvp" }, { reduce });
    const down = await foot(page);
    const dotBefore = await paintAt(page, "e4", false, "centre");
    await page.evaluate(() => { window.__paints = 0; const real = HTMLCanvasElement.prototype.getContext;
      HTMLCanvasElement.prototype.getContext = function (...a) { if (this.id === "board") window.__paints++; return real.apply(this, a); }; });
    const p = await at(page, "e2");
    await page.mouse.click(p.x, p.y);
    await page.waitForTimeout(500);
    // counted before this test reads the canvas itself (a read is a getContext too)
    const paints = await page.evaluate(() => window.__paints);
    const late = await paintAt(page, "e4", false, "centre");
    const lifted = await foot(page);
    counts[reduce ? "reduce" : "normal"] = paints;
    const tag = reduce ? "减少动态效果" : "正常";
    assert(late.some((v, i) => Math.abs(v - dotBefore[i]) > 8), `A5 选子（${tag}）：合法着点画出来了（${dotBefore} → ${late}）`);
    assert(lifted > 0 && down - lifted >= 2, `A5 选子（${tag}）：选中的兵抬起来一点（脚底 ${down} → ${lifted}px）`);
    assert(errs.length === 0, `A5 选子（${tag}）：没有页面异常${errs.length ? " — " + errs[0] : ""}`);
    await ctx.close();
  }
  assert(counts.normal - counts.reduce >= 2,
    `A5 选子：正常时抬起与淡入要画几帧，减少动态效果时一帧不多画（${counts.normal} 帧 / ${counts.reduce} 帧）`);
}

// --- v8-2-plan F3：启动时棋盘出几帧 -----------------------------------------
//
// 没有 GPU 的 Chromium 里，一帧带棋盘的画布要栅格化 0.35–0.85 s，而这一条之前
// 一次启动要画十遍棋盘：开在棋谱库页上时一遍都看不见（页面盖在棋盘上），棋谱
// 库的读取却排在这些帧后面。现在：页面盖着的时候不画，回到棋盘时画一遍；每个
// 棋子脚下的接触阴影是一张模糊过一次的小图，不再每个棋子跑一次 blur 滤镜（32
// 个滤镜就是那 0.35–0.85 s 的几乎全部）。
{
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem("f3.seeded")) {
      sessionStorage.setItem("f3.seeded", "1");
      localStorage.setItem("chess.settings", JSON.stringify({
        mode: "pvp", langId: "zh-CN", view: "library", soundOn: false, appearance: "dark", boardId: "wood" }));
      localStorage.setItem("chess.panelOpen", "1");
    }
    window.__paints = 0;
    window.__blurs = 0;
    const real = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (...a) {
      if (this.id === "board") window.__paints++;
      return real.apply(this, a);
    };
    const f = Object.getOwnPropertyDescriptor(CanvasRenderingContext2D.prototype, "filter");
    if (f && f.set) {
      Object.defineProperty(CanvasRenderingContext2D.prototype, "filter", { get: f.get, configurable: true,
        set(v) { if (this.canvas && this.canvas.id === "board" && /blur/.test(v)) window.__blurs++; f.set.call(this, v); } });
    }
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1500);
  const under = await page.evaluate(() => ({ paints: window.__paints, page: !document.getElementById("page-library").hidden }));
  assert(under.page && under.paints === 0, `F3 开在棋谱库页上：被盖住的棋盘一遍都不画（画了 ${under.paints} 遍）`);
  await page.click('#rail button[data-view="play"]');
  await page.waitForTimeout(300);
  const back = await page.evaluate(() => window.__paints);
  // the e1 king's square: the board under it is drawn, and so is the king
  const px = await page.evaluate(() => {
    const c = document.getElementById("board");
    const s = c.width / 8;
    return [...c.getContext("2d").getImageData(Math.round(4.5 * s), Math.round(7.5 * s), 1, 1).data];
  });
  assert(back >= 1 && px[3] === 255, `F3 回到棋盘：画出来了（${back} 遍，e1 ${px}）`);
  // a launch on the board (the view was saved); the sprites are in by now,
  // so one more draw has every man on it
  await page.reload();
  await page.waitForTimeout(1500);
  await page.evaluate(() => { window.__blurs = 0; window.dispatchEvent(new Event("resize")); });
  await page.waitForTimeout(300);
  const blurs = await page.evaluate(() => window.__blurs);
  assert(blurs === 0, `F3 棋子的接触阴影不在棋盘画布上逐个跑 blur 滤镜（一遍画了 ${blurs} 个）`);
  assert(errs.length === 0, `F3 棋盘帧：没有页面异常${errs.length ? " — " + errs[0] : ""}`);
  await ctx.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
