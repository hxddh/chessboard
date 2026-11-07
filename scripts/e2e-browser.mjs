/**
 * Shared bootstrap for the browser E2E checks: find Playwright, pick an
 * engine, launch it.
 *
 * Why two engines. The app ships no browser of its own — it hands the page to
 * whatever the platform provides, and the two platforms provide different
 * engines:
 *
 *   Windows   WebView2, which is Chromium
 *   macOS     WKWebView, which is WebKit
 *
 * So a Chromium-only test run is a faithful stand-in for exactly half the
 * shipped product. It proves the logic — the empty board, the clock running in
 * the background, the position lost on restart — and it cannot see anything
 * that is WebKit-specific. `E2E_BROWSER=webkit` covers the other half.
 *
 * Neither is the real thing. A WebView is not a browser, and this still does
 * not exercise the native bridge at all. It is the closest a headless check
 * can get to the two engines the app actually runs on.
 *
 * Env:
 *   E2E_BROWSER   chromium (default) | webkit
 *   E2E_REQUIRED  1 = a missing browser fails instead of skipping
 *   CHROME_PATH   explicit Chromium binary, when not one of the usual ones
 *   WEBKIT_PATH   explicit WebKit launcher, same idea
 * @module e2e-browser
 */
import fs from "fs";
import { buildIfStale } from "./bundle.mjs";

// index.html loads one generated script, so every E2E has to build before it
// serves. Doing it here rather than in each of the six keeps "the page the
// test sees" and "the page the app ships" the same artifact by construction.
await buildIfStale();

export const ENGINE = (process.env.E2E_BROWSER || "chromium").toLowerCase();

// A missing browser is a skip locally and a failure in the release gate: these
// checks silently exiting 0 is exactly how they managed to sit in the suite for
// several versions without ever guarding a release.
const REQUIRED = process.env.E2E_REQUIRED === "1";

/** Bow out — quietly by default, loudly when something is gating on this. */
export function skip(why) {
  if (REQUIRED) { console.error("E2E_REQUIRED=1,但" + why); process.exit(1); }
  console.log("跳过:" + why);
  process.exit(0);
}

let pw = null;
for (const mod of ["playwright-core", "playwright",
  "/opt/node22/lib/node_modules/playwright/node_modules/playwright-core/index.mjs"]) {
  try { pw = await import(mod); break; } catch { /* try the next one */ }
}

/** Chromium builds that are commonly already on the machine. */
function chromiumPath() {
  return [
    process.env.CHROME_PATH,
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome",
    "/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome",
  ].find((p) => p && fs.existsSync(p)) || null;
}

/**
 * A launched browser for the engine this run is testing, or a clean exit when
 * there is none to launch.
 */
export async function launchBrowser() {
  if (!pw) skip("没有 playwright");
  // Whitelisted rather than "whatever Playwright has": these two are the two
  // engines the app actually ships on, and a typo'd E2E_BROWSER must not read
  // as a browser that merely happens not to be installed.
  if (ENGINE !== "chromium" && ENGINE !== "webkit") {
    skip("E2E_BROWSER=" + ENGINE + " 不是这个项目要测的引擎(只认 chromium / webkit)");
  }
  const type = pw[ENGINE];
  if (!type) skip("playwright 装的这一份没有 " + ENGINE);

  const explicit = ENGINE === "chromium" ? chromiumPath() : (process.env.WEBKIT_PATH || null);
  if (explicit) return type.launch({ executablePath: explicit });

  // otherwise let Playwright use the build it manages itself — but check it is
  // actually on disk first, so "not installed" reads as a skip rather than as
  // a launch failure halfway through a test
  let managed = null;
  try { managed = type.executablePath(); } catch { /* not resolvable */ }
  if (!managed || !fs.existsSync(managed)) skip("找不到 " + ENGINE + " 可执行文件");
  return type.launch();
}
