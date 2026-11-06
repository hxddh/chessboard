/**
 * Chromium for the app's e2e, the way scripts/e2e-browser.mjs finds it but
 * without building the 19.0 bundle (src/app is served as modules). A missing
 * browser is a skip, and a failure under E2E_REQUIRED=1.
 */
import fs from "fs";

export function skip(why) {
  if (process.env.E2E_REQUIRED === "1") { console.error("E2E_REQUIRED=1, but " + why); process.exit(1); }
  console.log("skipped: " + why);
  process.exit(0);
}

export async function launchChromium() {
  let pw = null;
  for (const mod of ["playwright-core", "playwright"]) {
    try { pw = await import(mod); break; } catch { /* next */ }
  }
  if (!pw) skip("no playwright");
  const exe = [process.env.CHROME_PATH, "/opt/pw-browsers/chromium-1243/chrome-linux64/chrome",
    "/opt/pw-browsers/chromium-1194/chrome-linux/chrome", "/usr/bin/chromium", "/usr/bin/google-chrome"]
    .find((p) => p && fs.existsSync(p));
  if (exe) return pw.chromium.launch({ executablePath: exe });
  let managed = null;
  try { managed = pw.chromium.executablePath(); } catch { /* none */ }
  if (!managed || !fs.existsSync(managed)) skip("no Chromium executable");
  return pw.chromium.launch();
}
