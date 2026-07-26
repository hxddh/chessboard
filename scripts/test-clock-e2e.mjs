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
 * Needs playwright-core and a Chromium. Exits 0 with a notice when either is
 * missing:  node scripts/test-clock-e2e.mjs
 */
import http from 'http'; import fs from 'fs'; import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..', 'src', 'web');

let chromium;
for (const mod of ['playwright-core', 'playwright',
  '/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs']) {
  try { ({ chromium } = await import(mod)); break; } catch { /* try the next one */ }
}
if (!chromium) { console.log('跳过:没有 playwright'); process.exit(0); }
const CHROME = [
  process.env.CHROME_PATH,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome',
].find((p) => p && fs.existsSync(p));
if (!CHROME) { console.log('跳过:找不到 Chromium'); process.exit(0); }
const M = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript' };
const sv = http.createServer((q, r) => {
  let p = q.url.split('?')[0]; if (p === '/') p = '/index.html';
  if (p === '/js/engine-src.js') { r.writeHead(200, { 'content-type': 'text/javascript' }); r.end('//'); return; }
  try { const d = fs.readFileSync(path.join(ROOT, p)); r.writeHead(200, { 'content-type': M[path.extname(p)] || 'application/octet-stream' }); r.end(d); }
  catch { r.writeHead(404); r.end(); }
});
await new Promise((r) => sv.listen(0, r));
const PORT = sv.address().port;
const b = await chromium.launch({ executablePath: CHROME });
const c = await b.newContext({ viewport: { width: 1280, height: 900 }, locale: 'zh-CN' });
await c.addInitScript(() => {
  localStorage.setItem('chess.v1.settings', JSON.stringify({
    mode: 'pvp', langId: 'zh-CN', sideTab: 'play', soundOn: false, timeControl: '3' }));
  localStorage.setItem('chess.panelOpen', '1'); localStorage.setItem('chess.onboarded', '1');
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
const before = await clockSecs();
console.log('切走前:', before.join(' / '));

await pg.evaluate(() => window.__fire('app:deactivate', {}));
const away0 = Date.now();
await new Promise((r) => setTimeout(r, 6000));
const during = await clockSecs();
await pg.evaluate(() => window.__fire('app:activate', {}));
await pg.waitForTimeout(300);
const after = await clockSecs();
const away = ((Date.now() - away0) / 1000).toFixed(1);

console.log(`离开 ${away} 秒期间读数:`, during.join(' / '));
console.log('回来之后:', after.join(' / '));
const lost = Math.max(...before.map((v, i) => v - (after[i] ?? v)));
chk(lost <= 1, `离开 ${away} 秒,时钟最多只掉 1 秒`, `实际掉了 ${lost} 秒`);

// and it must start again once we are back
await pg.waitForTimeout(2500);
const running = await clockSecs();
const moved = Math.max(...after.map((v, i) => v - (running[i] ?? v)));
chk(moved >= 1, '回到前台后时钟重新走起来', `2.5 秒里走了 ${moved} 秒`);

console.log('\nJS 异常:', errs.length ? errs : '无');
console.log(bad ? `\n${bad} 项不对` : '\n全部通过');
await b.close(); sv.close();
process.exit(bad || errs.length ? 1 : 0);
