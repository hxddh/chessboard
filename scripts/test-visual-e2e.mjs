/**
 * Visual baseline (ADR 0005): every page of the app at 1440×900, 1024×700
 * and 600×900, screenshotted in Chromium and compared with the committed
 * baseline in scripts/visual-baseline/. A shot differs when more than
 * MAX_RATIO of its pixels move by more than TOLERANCE in any channel (or its
 * size changed); a missing baseline is a difference too.
 *
 * The page is held still so a difference is a change in the app, not in the
 * run: a fresh profile (the in-memory db), the fake engine, Chinese, the
 * date starting at FIXED_TIME in Asia/Shanghai, reduced motion, the fonts
 * loaded, two frames after the page settled.
 *
 * The baseline is what CI's runner draws (ubuntu-26.04, the pinned
 * Playwright's Chromium): fonts and anti-aliasing differ between machines, so
 * a local run compares against it only on the same image. Updating it needs
 * the explicit flag, after a person has looked at the new shots:
 *
 *   node scripts/test-visual-e2e.mjs                 compare (E2E_REQUIRED=1: a missing browser fails)
 *   node scripts/test-visual-e2e.mjs --update        write the shots as the new baseline
 *   OUT=dir                                          where the shots and diffs go (default shots/visual)
 *
 * CI (checks.yml `visual`) uploads OUT when the comparison fails: the shots
 * it took, a diff image per changed shot (changed pixels in red over a faded
 * copy) and report.json. To accept a change, run with --update on the same
 * image, or copy the uploaded shots into scripts/visual-baseline/.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { startServer } from "./serve-app.mjs";
import { launchChromium } from "./app/browser.mjs";

process.removeAllListeners("warning");
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
export const BASELINE = path.join(ROOT, "scripts/visual-baseline");
const OUT = path.resolve(process.env.OUT || path.join(ROOT, "shots/visual"));
const UPDATE = process.argv.includes("--update");
export const VIEWPORTS = [[1440, 900], [1024, 700], [600, 900]];
export const PAGES = ["play", "learn", "me", "settings"];
/** a channel moving by this much or less is anti-aliasing, not a change */
const TOLERANCE = 24;
/** the share of a shot's pixels that may move by more than TOLERANCE */
const MAX_RATIO = 0.002;
const FIXED_TIME = "2026-11-07T10:00:00+08:00";

let failed = 0, passed = 0;
const assert = (cond, msg) => { if (cond) { passed++; console.log("ok:", msg); } else { failed++; console.error("FAIL:", msg); } };

const srv = await startServer();
const browser = await launchChromium();
fs.mkdirSync(OUT, { recursive: true });
if (UPDATE) fs.mkdirSync(BASELINE, { recursive: true });
const errors = [];

/** One page at one size, held still. */
async function shoot(name, [width, height]) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1, reducedMotion: "reduce",
    locale: "zh-CN", timezoneId: "Asia/Shanghai", colorScheme: "light" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(name + ": " + e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(name + ": " + m.text()); });
  // the date starts at FIXED_TIME and runs on from there (a frozen clock stops
  // the board's own timing; Playwright's fixed time is frozen)
  await page.addInitScript((at) => {
    const Real = Date, off = Real.parse(at) - Real.now();
    class FixedDate extends Real {
      constructor(...a) { if (a.length) super(...a); else super(Real.now() + off); }
      static now() { return Real.now() + off; }
    }
    globalThis.Date = FixedDate;
  }, FIXED_TIME);
  await page.goto(srv.url + "?engine=fake&db=memory#/" + name);
  await page.waitForSelector("[data-page=" + name + "]");
  if (name === "play") await page.waitForFunction(() => performance.getEntriesByName("app:board").length > 0);
  await page.evaluate(async () => {
    await document.fonts.ready;
    for (let i = 0; i < 3; i++) await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await page.waitForTimeout(300);
  const png = await page.screenshot({ animations: "disabled", caret: "hide" });
  await ctx.close();
  return png;
}

/** Compare two PNGs in the browser: { width, height, changed, ratio, diff (PNG of the changes) } or { size } on a size change. */
async function compare(page, a, b) {
  const r = await page.evaluate(async ([a, b, tol]) => {
    const load = (b64) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = "data:image/png;base64," + b64; });
    const [ia, ib] = await Promise.all([load(a), load(b)]);
    if (ia.width !== ib.width || ia.height !== ib.height) return { size: [ia.width, ia.height, ib.width, ib.height] };
    const w = ia.width, h = ia.height;
    const px = (img) => { const c = new OffscreenCanvas(w, h); const g = c.getContext("2d"); g.drawImage(img, 0, 0); return g.getImageData(0, 0, w, h); };
    const da = px(ia), db = px(ib);
    const out = new ImageData(w, h);
    let changed = 0;
    for (let i = 0; i < da.data.length; i += 4) {
      const d = Math.max(Math.abs(da.data[i] - db.data[i]), Math.abs(da.data[i + 1] - db.data[i + 1]), Math.abs(da.data[i + 2] - db.data[i + 2]));
      if (d > tol) { changed++; out.data[i] = 230; out.data[i + 1] = 20; out.data[i + 2] = 20; out.data[i + 3] = 255; }
      else { const y = (db.data[i] + db.data[i + 1] + db.data[i + 2]) / 3; out.data[i] = out.data[i + 1] = out.data[i + 2] = 200 + y / 5; out.data[i + 3] = 255; }
    }
    let diff = null;
    if (changed) {
      const c = new OffscreenCanvas(w, h); c.getContext("2d").putImageData(out, 0, 0);
      const blob = await c.convertToBlob({ type: "image/png" });
      diff = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(",")[1]); fr.readAsDataURL(blob); });
    }
    return { width: w, height: h, changed, ratio: changed / (w * h), diff };
  }, [a.toString("base64"), b.toString("base64"), TOLERANCE]);
  return r;
}

const report = [];
const judge = await (await browser.newContext()).newPage();
await judge.goto(srv.url + "?engine=fake&db=memory#/settings");
for (const name of PAGES) {
  for (const vp of VIEWPORTS) {
    const file = name + "-" + vp[0] + "x" + vp[1] + ".png";
    const png = await shoot(name, vp);
    fs.writeFileSync(path.join(OUT, file), png);
    const base = path.join(BASELINE, file);
    if (UPDATE) {
      fs.writeFileSync(base, png);
      console.log("baseline: " + path.relative(ROOT, base));
      report.push({ file, updated: true });
      continue;
    }
    if (!fs.existsSync(base)) {
      report.push({ file, missing: true });
      assert(false, file + ": no baseline (scripts/visual-baseline/" + file + ") — look at " + path.join(OUT, file) + ", then --update");
      continue;
    }
    const r = await compare(judge, fs.readFileSync(base), png);
    if (r.size) {
      report.push({ file, size: r.size });
      assert(false, file + ": the size changed (" + r.size.slice(0, 2).join("×") + " → " + r.size.slice(2).join("×") + ")");
      continue;
    }
    if (r.diff) fs.writeFileSync(path.join(OUT, file.replace(/\.png$/, ".diff.png")), Buffer.from(r.diff, "base64"));
    report.push({ file, changed: r.changed, ratio: +r.ratio.toFixed(5) });
    assert(r.ratio <= MAX_RATIO, file + ": " + r.changed + " pixels changed (" + (r.ratio * 100).toFixed(2) + "%, at most " + (MAX_RATIO * 100).toFixed(1) + "%)");
  }
}
// the set itself: a baseline nobody takes any more is a page that went away
if (!UPDATE && fs.existsSync(BASELINE)) {
  const want = new Set(PAGES.flatMap((n) => VIEWPORTS.map((v) => n + "-" + v[0] + "x" + v[1] + ".png")));
  const stale = fs.readdirSync(BASELINE).filter((f) => f.endsWith(".png") && !want.has(f));
  assert(stale.length === 0, "every baseline is still taken" + (stale.length ? " — stale: " + stale.join(", ") : ""));
}
assert(errors.length === 0, "no page errors" + (errors.length ? ": " + errors.slice(0, 5).join(" | ") : ""));
fs.writeFileSync(path.join(OUT, "report.json"), JSON.stringify({ tolerance: TOLERANCE, maxRatio: MAX_RATIO, shots: report }, null, 2));
await browser.close();
await srv.close();
console.log("\ntest-visual-e2e: " + passed + " passed, " + failed + " failed" + (UPDATE ? " (baseline updated)" : ""));
process.exit(failed ? 1 : 0);
