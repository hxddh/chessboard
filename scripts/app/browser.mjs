/**
 * The browser for the app's e2e (src/app served as modules): Chromium by
 * default (WebView2 on Windows is Chromium), WebKit with BROWSER=webkit
 * (WKWebView on macOS is WebKit). A missing browser is a skip, and a failure
 * under E2E_REQUIRED=1.
 *
 * Everything a suite checks about behaviour runs on both. What only Chromium
 * can measure (the DevTools protocol: Performance.getMetrics, layout counts,
 * the longtask entry type) is skipped on WebKit with `chromiumOnly(what, why)`,
 * which says so in the output, never silently.
 *
 *   BROWSER=webkit node scripts/test-play-e2e.mjs
 */
import fs from "fs";

export const ENGINE = String(process.env.BROWSER || "chromium").toLowerCase();
export const CHROMIUM = ENGINE === "chromium";
export const WEBKIT = ENGINE === "webkit";

/**
 * The timing budgets (first paint, board drawn, Maia-3 per evaluation, a
 * frame gap while importing, a sound's start) are set on headless Chromium,
 * the engine WebView2 is. Headless WebKitGTK on a Linux runner is not the
 * WKWebView macOS ships (another port, software compositing), so its times
 * are printed and held to twice the budget: a regression of kind still fails,
 * the port's own speed does not. Budgets that are behaviour, not speed (a
 * tween's 250 ms, the snap-back's ≤ 180 ms), keep their bounds on both.
 */
export const PERF_SLACK = CHROMIUM ? 1 : 2;

export function skip(why) {
  if (process.env.E2E_REQUIRED === "1") { console.error("E2E_REQUIRED=1, but " + why); process.exit(1); }
  console.log("skipped: " + why);
  process.exit(0);
}

/**
 * true (and a "skipped" line) when this run is not Chromium: the caller then
 * leaves out a measurement only Chromium can make. `why` says what makes it
 * Chromium-only.
 */
export function chromiumOnly(what, why) {
  if (CHROMIUM) return false;
  console.log("skipped on " + ENGINE + ": " + what + " — " + why);
  return true;
}

async function playwright() {
  for (const mod of ["playwright-core", "playwright"]) {
    try { return await import(mod); } catch { /* next */ }
  }
  skip("no playwright");
}

export async function launchBrowser() {
  if (!["chromium", "webkit"].includes(ENGINE)) skip("BROWSER=" + ENGINE + " is not chromium or webkit");
  const pw = await playwright();
  let browser;
  if (CHROMIUM) {
    const exe = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
      "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"]
      .find((p) => p && fs.existsSync(p));
    if (exe) browser = await pw.chromium.launch({ executablePath: exe });
  }
  if (!browser) {
    const type = pw[ENGINE];
    let managed = null;
    try { managed = type.executablePath(); } catch { /* none */ }
    if (!managed || !fs.existsSync(managed)) skip("no " + ENGINE + " executable (npx playwright install " + ENGINE + ")");
    browser = await type.launch();
  }
  console.log("browser: " + ENGINE + " " + browser.version());
  return zhByDefault(browser);
}

/**
 * The app starts in the system's language (text/lang.js) and the browsers'
 * is en-US: every context is zh-CN unless the test asks for another locale,
 * so the suites written against the Chinese text keep reading Chinese.
 */
function zhByDefault(browser) {
  const newContext = browser.newContext.bind(browser), newPage = browser.newPage.bind(browser);
  browser.newContext = (o = {}) => newContext({ locale: "zh-CN", ...o });
  browser.newPage = (o = {}) => newPage({ locale: "zh-CN", ...o });
  return browser;
}
