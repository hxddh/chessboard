/**
 * Browser check for the sounds: which voice plays, for which event, in a real
 * page.
 *
 * This is the suite that was missing, and it was missing in a particular way —
 * every other browser suite starts its page with `soundOn: false`, because a
 * test that makes noise is a nuisance and silence was the cheap fix. So the
 * whole audio path had never been executed anywhere: not the dispatch that
 * decides winning from losing (`playEnding`), not the one that decides what a
 * single move sounds like (`moveSound`), not the enable flag itself. The one
 * thing docs/manual-check.md F5 asks a human to listen for — that resigning
 * does not play the victory fanfare — was untested code the whole time.
 *
 * The instrument is a tap on the Web Audio API rather than on the app: every
 * `createOscillator`/`createBufferSource` records the name of the function
 * that started it and the frequencies it was given. That measures what is
 * actually audible, needs nothing exported for the test's benefit, and cannot
 * pass by mistake — if the app plays no sound at all, the tap sees nothing and
 * every assertion below fails.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs).
 * Exits 0 with a notice when either is missing, except under E2E_REQUIRED=1:
 *   node scripts/test-audio-e2e.mjs
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
 * The tap, and what it hears.
 *
 * Voices are named by the frequencies they are given, not by the function that
 * started them. Reading the stack was the first instrument and it worked — on
 * Chromium. The release gate runs every browser suite under WebKit too, whose
 * stacks are formatted differently and whose frames nobody here can check, and
 * a probe that quietly returns "?" on half the gate is worse than no probe.
 * Pitch is the sound itself: the same numbers on any engine, and readable
 * straight out of audio.js.
 *
 * The wobbled ones (a placement, a castling rook) move ±3% and are matched by
 * range; everything else is exact.
 */
const TAP = (settings) => {
  window.__voices = [];
  const AC = window.AudioContext || window.webkitAudioContext;
  const co = AC.prototype.createOscillator, cb = AC.prototype.createBufferSource;
  AC.prototype.createOscillator = function () {
    const o = co.call(this);
    const fs = [];
    const sv = o.frequency.setValueAtTime.bind(o.frequency);
    o.frequency.setValueAtTime = (v, t) => { fs.push(Math.round(v)); return sv(v, t); };
    // the ramp target too: a black piece being placed starts at 195 and a
    // refusal starts at 196, and nothing but where they are heading tells
    // them apart
    const rp = o.frequency.exponentialRampToValueAtTime.bind(o.frequency);
    o.frequency.exponentialRampToValueAtTime = (v, t) => { fs.push(Math.round(v)); return rp(v, t); };
    const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(o.frequency), "value");
    Object.defineProperty(o.frequency, "value", {
      get: () => d.get.call(o.frequency),
      set: (v) => { fs.push(Math.round(v)); d.set.call(o.frequency, v); },
    });
    const st = o.start.bind(o);
    o.start = (t) => { window.__voices.push(fs); return st(t); };
    return o;
  };
  AC.prototype.createBufferSource = function () {
    const s = cb.call(this);
    const st = s.start.bind(s);
    s.start = (t) => { window.__voices.push(["noise"]); return st(t); };
    return s;
  };
  localStorage.setItem("chess.v1.settings", JSON.stringify(settings));
  localStorage.setItem("chess.panelOpen", "1");
};

/**
 * One burst of voices → the events a listener would name.
 *
 * Runs in Node, on the numbers the tap collected, so a failure prints what was
 * actually heard rather than a boolean.
 */
function nameVoices(voices) {
  const near = (v, hz) => typeof v === "number" && Math.abs(v - hz) <= hz * 0.045;
  // (start, target) — audio.js gives every voice its own pair, and the pair is
  // what survives the ±3% wobble on the ones that have it
  const is = (fs, a, b) => near(fs[0], a) && (b == null || near(fs[1], b));
  const out = [];
  let noises = 0, bodies = 0;
  for (const fs of voices) {
    if (fs[0] === "noise") { noises++; continue; }
    if (is(fs, 255, 190) || is(fs, 195, 145)) { bodies++; continue; }
    if (is(fs, 196, 155)) { out.push("拒绝"); continue; }
    if (is(fs, 232) || is(fs, 178)) { out.push("王车易位"); continue; }
    if (is(fs, 120, 85)) { out.push("吃子"); continue; }
    if (is(fs, 110, 87)) { out.push("升变"); continue; }
    if (is(fs, 1567)) { out.push("将军"); continue; }
    // the ending chords are counted together, below — one note says nothing
    if ([523, 659, 784, 1046, 440, 370].some((hz) => near(fs[0], hz))) continue;
    out.push(fs.join("→"));  // an unrecognised voice is reported, not swallowed
  }
  // a placement is a clack plus a body; a lift is a clack on its own
  for (let i = 0; i < bodies; i++) out.unshift("落子");
  for (let i = 0; i < noises - bodies; i++) out.unshift("拿起");
  const has = (hz) => voices.some((fs) => near(fs[0], hz));
  // the endings share notes: only winning reaches the top of the arpeggio
  if (has(784) || has(1046)) out.push("胜利");
  else if (has(659) && has(523)) out.push("和棋");
  if (has(440) && has(370)) out.push("失败");
  return out;
}

/** A page with the tap installed and the first-run picker dismissed. */
async function open(settings) {
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 900 }, locale: "zh-CN" });
  await ctx.addInitScript(TAP, { langId: "zh-CN", sideTab: "play", soundOn: true,
    themeId: "wood", ...settings });
  const page = await ctx.newPage();
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(`http://127.0.0.1:${PORT}/`);
  await page.waitForTimeout(900);
  await page.click("#pick-cancel").catch(() => {});
  const at = (s) => page.evaluate((n) => {
    const cv = document.getElementById("board"); const r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - Number(n[1]);
    const flip = document.body.classList.contains("flipped");
    const col = flip ? 7 - f : f, row = flip ? 7 - rk : rk;
    return { x: r.left + (col + 0.5) * (r.width / 8), y: r.top + (row + 0.5) * (r.height / 8) };
  }, s);
  const api = {
    page, errs, at,
    /** the events a listener would name, since the last drain */
    async heard(waitMs = 350) {
      await page.waitForTimeout(waitMs);
      const raw = await page.evaluate(() => {
        const v = window.__voices.slice();
        window.__voices.length = 0;
        return v;
      });
      return nameVoices(raw);
    },
    async click(sq) { const p = await at(sq); await page.mouse.click(p.x, p.y); await page.waitForTimeout(120); },
    async move(a, b) { await api.click(a); await api.click(b); },
    async drag(a, b) {
      const p = await at(a), q = await at(b);
      await page.mouse.move(p.x, p.y); await page.mouse.down();
      await page.mouse.move(p.x + 8, p.y - 8, { steps: 3 });
      await page.mouse.move(q.x, q.y, { steps: 6 }); await page.mouse.up();
      await page.waitForTimeout(120);
    },
    close: () => ctx.close(),
  };
  return api;
}

/** Hand the page an engine that answers from a fixed list. */
const scriptEngine = (page, replies) => page.evaluate((rs) => {
  window.__chess.engine.isReady = () => true;
  let i = 0;
  window.__chess.engine.bestMove = async () => rs[i++] || null;
}, replies);

// --- 关掉音效,就是真的一声不出 -------------------------------------------
{
  const a = await open({ mode: "pvp", soundOn: false });
  await a.heard();
  await a.move("e2", "e4");
  assert((await a.heard()).length === 0, "音效关着时,走一步棋不发出任何声音");
  await a.click("e7");
  assert((await a.heard()).length === 0, "…拿起棋子也不发出任何声音");
  await a.close();
}

// --- 拿起来、放下去、被拒绝,是三件不同的事 --------------------------------
// 到 2.1.5 为止,前两件的声音是反的:单击拿起一枚棋子播的是 playRefused
// ——「不行」那一声闷响——而单击一个它去不了的格子,一声不响。原因是拿起
// 之后紧跟的 pointerup 落在棋子自己的格子上,被当成「放回原处」。
{
  const a = await open({ mode: "pvp" });
  await a.heard();
  await a.click("e2");
  const lift = await a.heard();
  assert(JSON.stringify(lift) === '["拿起"]',
    `单击拿起一枚棋子:这是拿起的声音,不是拒绝的声音(听到 ${JSON.stringify(lift)})`);
  await a.click("a5");
  const no = await a.heard();
  assert(JSON.stringify(no) === '["拒绝"]',
    `单击一个它去不了的格子:这才是拒绝(听到 ${JSON.stringify(no)})`);
  await a.click("e2"); await a.heard();
  await a.click("e4");
  const played = await a.heard();
  assert(JSON.stringify(played) === '["落子"]', `走成了就只是落子声(听到 ${JSON.stringify(played)})`);
  await a.drag("e7", "e5");
  const dragged = await a.heard();
  assert(dragged.includes("拿起") && dragged.includes("落子") && !dragged.includes("拒绝"),
    `拖着走:先拿起,再落子(听到 ${JSON.stringify(dragged)})`);
  await a.drag("d2", "d8");
  const bad = await a.heard();
  assert(bad.includes("拿起") && bad.includes("拒绝"),
    `拖到一个去不了的格子:拿起,然后被拒(听到 ${JSON.stringify(bad)})`);
  await a.drag("d2", "d2");
  const home = await a.heard();
  assert(home.includes("拒绝"), `拖起来又放回原处,也是拒绝(棋子会飞回去,听到 ${JSON.stringify(home)})`);
  assert(a.errs.length === 0, `全程没有页面异常${a.errs.length ? " — " + a.errs[0] : ""}`);
  await a.close();
}

// --- 一步棋里的层次:吃子、将军、王车易位、升变 ----------------------------
{
  const a = await open({ mode: "pvp" });
  // 1.e4 d5 2.exd5 — 吃子
  await a.move("e2", "e4"); await a.move("d7", "d5"); await a.heard();
  await a.move("e4", "d5");
  const took = await a.heard();
  assert(took.includes("吃子"), `吃子多一声更重的闷响(听到 ${JSON.stringify(took)})`);
  // 2...Qxd5 3.Nc3 Qe5+ — 将军
  await a.move("d8", "d5"); await a.move("b1", "c3"); await a.heard();
  await a.move("d5", "e5");
  const ck = await a.heard();
  assert(ck.includes("将军"), `将军多一声提示音(听到 ${JSON.stringify(ck)})`);
  assert(a.errs.length === 0, `全程没有页面异常${a.errs.length ? " — " + a.errs[0] : ""}`);
  await a.close();
}

// 王车易位另起一局:上面那局在 Qe5+ 之后白方必须应将,接不下去
{
  const a = await open({ mode: "pvp" });
  // 1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.O-O
  for (const [f, t2] of [["e2", "e4"], ["e7", "e5"], ["g1", "f3"], ["b8", "c6"],
    ["f1", "c4"], ["f8", "c5"]]) await a.move(f, t2);
  await a.heard();
  await a.move("e1", "g1");
  const cas = await a.heard();
  assert(cas.includes("王车易位"), `王车易位是两枚棋子,两声(听到 ${JSON.stringify(cas)})`);
  assert(a.errs.length === 0, `全程没有页面异常${a.errs.length ? " — " + a.errs[0] : ""}`);
  await a.close();
}

// 升变:兵走到底线变成更重的东西,不是号角
{
  const a = await open({ mode: "pvp" });
  // 1.h4 g5 2.hxg5 h5 3.g6 h4 4.g7 h3 5.gxh8=Q
  for (const [f, t2] of [["h2", "h4"], ["g7", "g5"], ["h4", "g5"], ["h7", "h5"],
    ["g5", "g6"], ["h5", "h4"], ["g6", "g7"], ["h4", "h3"]]) await a.move(f, t2);
  await a.heard();
  await a.move("g7", "h8");
  await a.page.click('#promo-modal .promo-row button[data-p="q"]');
  const pro = await a.heard(600);
  assert(pro.includes("升变"),
    `升变是同一枚棋子变重了,不是号角(听到 ${JSON.stringify(pro)})`);
  assert(!pro.includes("胜利"), "…升变不是赢棋");
  assert(a.errs.length === 0, `全程没有页面异常${a.errs.length ? " — " + a.errs[0] : ""}`);
  await a.close();
}

// --- 终局的声音由「谁赢了」决定,不由「结束了没有」决定 ---------------------
// 缺陷 1 的现场:2.0 之前被将死、超时、认输都播胜利号角。这一节把那张分派
// 表真的走一遍——它此前从未被任何测试执行过。

// 人把引擎将死了
{
  const a = await open({ mode: "ai", humanColor: "w" });
  await scriptEngine(a.page, [{ from: "e7", to: "e5" }, { from: "b8", to: "c6" }, { from: "g8", to: "f6" }]);
  await a.move("e2", "e4"); await a.move("f1", "c4"); await a.move("d1", "h5");
  await a.heard();
  await a.move("h5", "f7"); // 学者将杀
  const end = await a.heard(700);
  assert(end.includes("胜利"), `人赢了:胜利号角(听到 ${JSON.stringify(end)})`);
  assert(!end.includes("失败"), "…而且没有同时响起失败的那两声");
  await a.close();
}

// 引擎把人将死了
{
  const a = await open({ mode: "ai", humanColor: "w" });
  await scriptEngine(a.page, [{ from: "e7", to: "e5" }, { from: "d8", to: "h4" }]);
  await a.move("f2", "f3"); await a.heard();
  await a.move("g2", "g4"); // 愚人将杀,黑方 Qh4#
  const end = await a.heard(900);
  assert(end.includes("失败"), `人输了:落下去的那两个音(听到 ${JSON.stringify(end)})`);
  assert(!end.includes("胜利"), "…而不是胜利号角");
  await a.close();
}

// 认输 —— docs/manual-check.md F5 让人耳朵去听的那一条
{
  const a = await open({ mode: "ai", humanColor: "w" });
  await scriptEngine(a.page, [{ from: "e7", to: "e5" }]);
  await a.move("e2", "e4");
  await a.heard(700);
  await a.page.click("#btn-resign");
  await a.page.waitForTimeout(200);
  await a.page.click("#confirm-ok");
  const end = await a.heard(700);
  assert(end.includes("失败"), `认输是输(听到 ${JSON.stringify(end)})`);
  assert(!end.includes("胜利"), "…认输不播胜利号角(manual-check F5)");
  await a.close();
}

// 双人对局里认输:屋里有人赢了,所以是赢
{
  const a = await open({ mode: "pvp" });
  await a.move("e2", "e4"); await a.heard();
  await a.page.click("#btn-resign");
  await a.page.waitForTimeout(200);
  await a.page.click("#confirm-ok"); // 白方认输
  const end = await a.heard(700);
  assert(end.includes("胜利"), `双人对局:一方认输,另一方赢了(听到 ${JSON.stringify(end)})`);
  await a.close();
}

// 和棋:既不是赢也不是输
{
  const a = await open({ mode: "pvp" });
  // 三次重复:马出去又回来,两遍
  for (const [f, t2] of [["g1", "f3"], ["g8", "f6"], ["f3", "g1"], ["f6", "g8"],
    ["g1", "f3"], ["g8", "f6"], ["f3", "g1"], ["f6", "g8"]]) await a.move(f, t2);
  await a.heard();
  await a.page.click("#btn-claimdraw");
  const end = await a.heard(700);
  assert(end.includes("和棋"), `判和是和(听到 ${JSON.stringify(end)})`);
  assert(!end.includes("胜利") && !end.includes("失败"),
    "…既不响胜利也不响失败");
  assert(a.errs.length === 0, `全程没有页面异常${a.errs.length ? " — " + a.errs[0] : ""}`);
  await a.close();
}

await browser.close();
server.close();
if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
