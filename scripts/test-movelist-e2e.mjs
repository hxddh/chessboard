/**
 * Browser check for the move list under the pointer (18.0 R1).
 *
 * Clicking a move moves the replay cursor, and the list scrolls to keep it in
 * view. The scroll slides another move under a pointer that never moved, the
 * browser reports that as a mouseover, and through 17.0 the hover preview
 * took the board: click 13…h6, see 「预览 · 第 34 着」. A click is a commit;
 * the preview may come back only once the hand really moves.
 *
 *   node scripts/test-movelist-e2e.mjs
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";
import { launchBrowser, ENGINE } from "./e2e-browser.mjs";
import { settle } from "./lib/settle.mjs";
import { OPERA, playOpera } from "./lib/opera-fixture.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..", "src", "web");
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
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok:", msg);
  else { failed++; console.error("FAIL:", msg, extra || ""); }
};

const browser = await launchBrowser();
if (!browser) { server.close(); process.exit(0); }
console.log("引擎:", ENGINE);
// short enough that the 33-ply Opera game overflows the list and has to scroll
const ctx = await browser.newContext({ viewport: { width: 1280, height: 640 }, locale: "zh-CN" });
await ctx.addInitScript(() => {
  localStorage.setItem("chess.settings", JSON.stringify({
    mode: "pvp", langId: "zh-CN", soundOn: false, appearance: "light", boardId: "wood" }));
  localStorage.setItem("chess.panelOpen", "1");
});
const page = await ctx.newPage();
const errs = [];
page.on("pageerror", (e) => errs.push(e.message));
await page.goto(`http://127.0.0.1:${PORT}/`);
await page.waitForTimeout(900);
await page.click("#pick-cancel", { timeout: 1500 }).catch(() => {});
await playOpera(page);
await settle(page);

const state = () => page.evaluate(() => {
  const ml = document.getElementById("move-list");
  const cur = ml.querySelector("button.current");
  return {
    badge: document.getElementById("preview-badge").hidden ? null : document.getElementById("preview-badge").textContent,
    current: cur ? cur.dataset.i || cur.dataset.node : null,
    scrollable: ml.scrollHeight > ml.clientHeight + 4,
  };
});
const s0 = await state();
assert(s0.scrollable, "the Opera game overflows the move list at this height", JSON.stringify(s0));

// sweep to a move in the middle of the visible list and click it: the cursor
// moves there and the list scrolls to keep it in view, which slides another
// move under the still pointer
const target = await page.evaluate(() => {
  const ml = document.getElementById("move-list");
  const mr = ml.getBoundingClientRect();
  const bs = [...ml.querySelectorAll("button[data-i]")].filter((b) => {
    const r = b.getBoundingClientRect();
    return r.top >= mr.top && r.bottom <= mr.bottom;
  });
  const b = bs[6];
  const r = b.getBoundingClientRect();
  return { i: b.dataset.i, x: r.left + r.width / 2, y: r.top + r.height / 2, st: ml.scrollTop };
});
await page.mouse.move(target.x, target.y, { steps: 3 });
await page.waitForTimeout(200);
await page.mouse.click(target.x, target.y);
await page.waitForTimeout(700);
const s1 = await state();
const moved = await page.evaluate(() => document.getElementById("move-list").scrollTop);
console.log("  clicked " + target.i + "; list scrolled " + target.st + " → " + moved + "; current " + s1.current + "; badge " + s1.badge);
assert(moved !== target.st, "the click scrolled the list (the case that slid another move under the pointer)");
assert(s1.current === target.i && s1.badge === null,
  "after the click the board shows the clicked move, not a preview of the one that scrolled under the pointer", JSON.stringify(s1));

// a real move of the hand brings the preview back
await page.mouse.move(target.x + 30, target.y + 3, { steps: 3 });
await page.waitForTimeout(200);
const s2 = await state();
assert(s2.badge !== null, "……and once the pointer really moves, sweeping the list previews again", JSON.stringify(s2));

assert(errs.length === 0, "no page errors — " + errs.join(" / "));
await browser.close();
server.close();
if (failed) { console.error(failed + " 项失败"); process.exit(1); }
console.log("all passed");
