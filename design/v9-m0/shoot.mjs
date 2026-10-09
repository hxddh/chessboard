// 重拍设计稿截图：node design/v9-m0/shoot.mjs [只拍名字里含这段的]
// Playwright + /opt/pw-browsers 的 Chromium（不跑 playwright install），2× 像素。
import { fileURLToPath } from "url";
import path from "path";
let pw;
for (const m of ["playwright-core", "playwright", "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs"]) {
  try { pw = await import(m); break; } catch { /* next */ }
}
const dir = path.dirname(fileURLToPath(import.meta.url));
const only = process.argv[2] || "";
const browser = await pw.chromium.launch({ executablePath: process.env.CHROME_PATH || "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
const jobs = [];
for (const name of ["today", "today-en", "play-gameover", "train-puzzles", "review", "settings"]) {
  for (const w of [1440, 600]) jobs.push({ name, w, theme: "wood", out: `${name}-${w}` });
}
jobs.push({ name: "today", w: 1440, theme: "day", out: "today-1440-day" });
jobs.push({ name: "today", w: 600, theme: "day", out: "today-600-day" });
for (const j of jobs) {
  if (only && !j.out.includes(only)) continue;
  const page = await browser.newPage({ viewport: { width: j.w, height: 900 }, deviceScaleFactor: 2 });
  const errs = [];
  page.on("pageerror", (e) => errs.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errs.push(m.text()); });
  await page.goto(`file://${dir}/${j.name}.html?theme=${j.theme}`);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(250);
  // 检查：横向滚动、按钮换行
  const report = await page.evaluate(() => {
    const out = [];
    if (document.documentElement.scrollWidth > innerWidth) out.push("hscroll " + document.documentElement.scrollWidth);
    for (const b of document.querySelectorAll(".btn, .seg > button, .toolbar > button")) {
      const r = b.getBoundingClientRect();
      if (b.scrollWidth > b.clientWidth + 1) out.push("btn overflow: " + b.textContent.trim());
    }
    for (const e of document.querySelectorAll("body *")) {
      const r = e.getBoundingClientRect();
      if (r.width && r.right > innerWidth + 0.5 && getComputedStyle(e).position !== "fixed" && !e.closest(".page")) out.push("off-right: " + e.className + " " + Math.round(r.right));
    }
    const b = document.querySelector(".stage .board");
    if (b) out.push("board " + Math.round(b.getBoundingClientRect().width) + " @y " + Math.round(b.getBoundingClientRect().top) + "-" + Math.round(b.getBoundingClientRect().bottom));
    const p = document.querySelector(".panel");
    if (p) out.push("panel top " + Math.round(p.getBoundingClientRect().top));
    return out.slice(0, 12);
  });
  await page.screenshot({ path: `${dir}/shots/${j.out}.png` });
  console.log(j.out, errs.join(" | "), report.join(" ; "));
  await page.close();
}
await browser.close();
