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
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel").catch(() => {});
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
    localStorage.setItem("chess.v1.settings", JSON.stringify({
      mode: "pvp", langId: "zh-CN", sideTab: "play", soundOn: false, themeId: "wood" }));
    localStorage.setItem("chess.panelOpen", "1");
  });
  const page = await ctx.newPage();
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(1000);
  await page.click("#pick-cancel").catch(() => {});
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

await browser.close();
server.close();
if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
