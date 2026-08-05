/**
 * Does the clock stop when the app goes away, and does it charge nothing for
 * the time it was away?
 *
 * The tick subtracts elapsed `Date.now()`, so an app that keeps running out of
 * sight keeps billing wall-clock time to a player who cannot see the board.
 * Measured at 1.17: 8.4 seconds in the background cost 9 seconds of clock with
 * nobody playing. Reachable by switching away then; from 1.18 macOS closes the
 * window to a hidden app, which makes it the ordinary path.
 *
 * The first attempt at this test drove the browser's own visibility by
 * focusing a second tab — headless keeps the first page `visible`, so it
 * measured nothing and "passed" a bug that was still there. This drives the
 * native signal instead: a fake bridge fires app:deactivate / app:activate,
 * which is the pair a close_policy = "hide" window actually produces.
 *
 * Needs playwright-core and a browser (see scripts/e2e-browser.mjs —
 * E2E_BROWSER=chromium|webkit picks the engine). Exits 0 with a notice when either is
 * missing:  node scripts/test-clock-e2e.mjs
 */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'src', 'web');

import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
const M = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const sv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/js/engine-src.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('//'); return; }
  try { const d = fs.readFileSync(path.join(ROOT, p)); r.writeHead(200, { 'content-type': M[path.extname(p)] || 'application/octet-stream' }); r.end(d); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise((r) => sv.listen(0, r));
const PORT = sv.address().port;
const b = await launchBrowser();
console.log("引擎:", ENGINE);
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
await c.addInitScript(() => {
  localStorage.setItem('chess.v1.settings', JSON.stringify({
    mode: 'pvp', langId: 'zh-CN', sideTab: 'play', soundOn: false, timeControl: '3' }));
  localStorage.setItem('chess.panelOpen', '1');
  const listeners = {};
  window.zero = {
    invoke: () => Promise.resolve(true),
    on: (n, cb) => { (listeners[n] ||= []).push(cb); return () => {}; },
    off: () => {},
    platform: { supports: () => Promise.resolve(true) },
    os: { addRecentDocument: () => Promise.resolve(true), clearRecentDocuments: () => Promise.resolve(true),
          showNotification: () => Promise.resolve(true), revealPath: () => Promise.resolve(true) },
    clipboard: { readText: () => Promise.resolve(''), writeText: () => Promise.resolve(true) },
    dialogs: { openFile: () => Promise.resolve(null), saveFile: () => Promise.resolve(null) },
  };
  window.__fire = (n, d) => { for (const cb of (listeners[n] || [])) cb(d); };
});
const pg = await c.newPage();
const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
await pg.goto(`http://127.0.0.1:${PORT}/`); await pg.waitForTimeout(1200);
await pg.click('#pick-cancel').catch(() => {});

const sq = async (s) => pg.evaluate((x) => {
  const cv = document.getElementById('board'), r = cv.getBoundingClientRect();
  const f = x.charCodeAt(0) - 97, rk = 8 - +x[1];
  const fl = document.body.classList.contains('flipped');
  const co = fl ? 7 - f : f, ro = fl ? 7 - rk : rk, z = r.width / 8;
  return { x: r.left + (co + .5) * z, y: r.top + (ro + .5) * z };
}, s);
const mv = async (a, z) => {
  const p = await sq(a); await pg.mouse.click(p.x, p.y); await pg.waitForTimeout(80);
  const q = await sq(z); await pg.mouse.click(q.x, q.y); await pg.waitForTimeout(300);
};
/** the two clock readouts, as seconds */
const clockSecs = () => pg.evaluate(() => {
  const to = (t) => { const m = /^(\d+):(\d\d)$/.exec(t.trim()); return m ? +m[1] * 60 + +m[2] : null; };
  return [...document.querySelectorAll('#clock-w, #clock-b, .clock-val, .clock')]
    .map((x) => to(x.textContent)).filter((v) => v !== null);
});

let bad = 0;
const chk = (ok, msg, extra) => { console.log((ok ? 'ok   ' : 'BUG  ') + msg + (extra ? '  ' + extra : '')); if (!ok) bad++; };

await mv('e2', 'e4');                       // starts the clock, Black now on move
await pg.waitForTimeout(1200);
// The baseline is taken AFTER the app has been told it is away, not before.
// Read it first and the measurement includes everything that happens between
// the readout and the deactivate actually being handled — two evaluate
// round-trips — and that time is time the app is still in front of somebody,
// so the clock is supposed to run. Under load that gap reached 3 seconds and
// this assertion reported the app as billing in the background when it was
// not. Measuring from after the handler asks the stricter question anyway:
// while away, does the clock move at all?
await pg.evaluate(() => window.__fire('app:deactivate', {}));
await pg.waitForTimeout(400);                 // let the handler stop the timer
const before = await clockSecs();
console.log('切走(且已处理)之后:', before.join(' / '));
const away0 = Date.now();
await new Promise((r) => setTimeout(r, 6000));
const during = await clockSecs();
await pg.evaluate(() => window.__fire('app:activate', {}));
await pg.waitForTimeout(300);
const after = await clockSecs();
const away = ((Date.now() - away0) / 1000).toFixed(1);

console.log(`离开 ${away} 秒期间读数:`, during.join(' / '));
console.log('回来之后:', after.join(' / '));
const lost = Math.max(...before.map((v, i) => v - (during[i] ?? v)));
chk(lost <= 1, `离开 ${away} 秒,时钟最多只掉 1 秒`, `实际掉了 ${lost} 秒`);

// and it must start again once we are back
await pg.waitForTimeout(2500);
const running = await clockSecs();
const moved = Math.max(...after.map((v, i) => v - (running[i] ?? v)));
chk(moved >= 1, '回到前台后时钟重新走起来', `2.5 秒里走了 ${moved} 秒`);

// --- 加秒、旗落,以及旗落之后 ------------------------------------------------
// 这个套件此前只回答一个问题:切走之后时钟会不会空跑。棋钟自己的实战面 ——
// 走一步加不加秒、时间真的走光了会怎样、走光之后还能不能继续走 —— 一条都没
// 有被驱动过,因为「等三分钟」在测试里是不可接受的成本。
//
// 那就把应用看到的时间调快:棋钟是按 Date.now() 的差值扣的,把 Date.now 加速
// 40 倍,3 分钟的钟 4.5 秒就走完。加速的是「应用读到的现在」,不是 setTimeout,
// 所以点击、渲染、动画都按真实速度走,只有计时被压缩 —— 量的还是同一段代码。
{
  const c2 = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
  await c2.addInitScript(() => {
    const t0 = Date.now(), real = Date.now;
    Date.now = () => t0 + (real() - t0) * 40;
    localStorage.setItem('chess.v1.settings', JSON.stringify({
      mode: 'pvp', langId: 'zh-CN', sideTab: 'setup', soundOn: false, themeId: 'wood' }));
    localStorage.setItem('chess.panelOpen', '1');
  });
  const p2 = await c2.newPage();
  const errs2 = []; p2.on('pageerror', (e) => errs2.push(e.message));
  await p2.goto(`http://127.0.0.1:${PORT}/`); await p2.waitForTimeout(900);
  await p2.click('#pick-cancel').catch(() => {});
  // 棋钟那一行在「对局」那段折叠里
  await p2.click('#fold-game > summary'); await p2.waitForTimeout(300);
  await p2.click('#clock-seg button[data-tc="3+2"]'); await p2.waitForTimeout(400);

  const secs2 = () => p2.evaluate(() => {
    const to = (t) => { const m = /^(\d+):(\d\d)$/.exec(t.trim()); return m ? +m[1] * 60 + +m[2] : null; };
    return [...document.querySelectorAll('#clock-w, #clock-b, .clock-val, .clock')]
      .map((x) => to(x.textContent)).filter((v) => v !== null);
  });
  const sq2 = async (x) => p2.evaluate((n) => {
    const cv = document.getElementById('board'), r = cv.getBoundingClientRect();
    const f = n.charCodeAt(0) - 97, rk = 8 - +n[1], z = r.width / 8;
    return { x: r.left + (f + .5) * z, y: r.top + (rk + .5) * z };
  }, x);
  const mv2 = async (a, z) => {
    for (const s2 of [a, z]) { const q = await sq2(s2); await p2.mouse.click(q.x, q.y); await p2.waitForTimeout(120); }
    await p2.waitForTimeout(250);
  };
  const start = await secs2();
  chk(start.length === 2 && start.every((v) => v === 180), '3+2:两边各三分钟', JSON.stringify(start));
  await mv2('e2', 'e4');
  const afterMove = await secs2();
  chk(afterMove[0] > 180, '走一步棋,走子方加了两秒(3+2 的 +2 真的加上了)', `白方 ${afterMove[0]} 秒`);
  await mv2('e7', 'e5');

  // 现在轮白,让它的时间在加速下走光(3 分钟 ÷ 40 ≈ 4.6 秒)
  let flagged = null;
  for (let i = 0; i < 15 && !flagged; i++) {
    await p2.waitForTimeout(1000);
    const st = await p2.evaluate(() => (document.getElementById('status') || {}).textContent || '');
    if (/超时/.test(st)) flagged = st;
  }
  chk(!!flagged, '时间走光了,这局就结束了', flagged || '(等了 15 秒还没结束)');
  chk(/黑方胜/.test(flagged || ''), '…而且输的是旗落的那一方(白方)', flagged || '');
  const zero = await secs2();
  chk(zero[0] === 0, '…走光的那一边停在 0:00,不会走成负数', JSON.stringify(zero));
  const before2 = await p2.evaluate(() => document.querySelectorAll('.move-list .mlmove').length);
  await mv2('g1', 'f3');
  const after2 = await p2.evaluate(() => document.querySelectorAll('.move-list .mlmove').length);
  chk(before2 === after2, '…棋盘冻住了,旗落之后走不动了', `${before2} → ${after2} 着`);
  if (errs2.length) errs.push(...errs2);
  await c2.close();
}

console.log('\nJS 异常:', errs.length ? errs : '无');
console.log(bad ? `\n${bad} 项不对` : '\n全部通过');
await b.close(); sv.close();
process.exit(bad || errs.length ? 1 : 0);
