/**
 * Three of the packaged self-test's checks (v8-1-plan N3) — the questions
 * only the packaged app can answer, because Playwright's WebKit and Chromium
 * load the page over http(s) and the app loads it over zero://. app.js
 * runSelftest adds them to its report; scripts/selftest-app.mjs launches the
 * app twice and reads both reports.
 *
 *   idb        IndexedDB works on this WebView's custom scheme: the library's
 *              own database (library-db.js, v8-0-plan C1) takes a marker and
 *              gives it back, and — the restart scheme — the second launch
 *              must find the one the first launch wrote. If it cannot, the
 *              library runs on its localStorage fallback and the 10,000-game
 *              ceiling is not reached (v8-1-plan N3 says what follows).
 *   chunkSync  the language chunks chunk-boot.js document.write()s ahead of
 *              bundle.js had run by the time bundle.js did — the first frame
 *              is in the saved language (v8-0-plan F5, so far only seen on
 *              CI's WebKit). A launch that planned no chunk (Chinese) cannot
 *              show it, so it switches the next launch to English, and
 *              selftest-app.mjs requires one launch that did.
 *   nativeIo   chess.openPgn / chess.saveText (v8-1-plan N2) are registered,
 *              allowed and answer, and this platform gives the native side
 *              both file dialogs — asked with `probe`, which opens nothing:
 *              nobody is there to close a dialog.
 *
 * Checks say `pass`, never `ok`: main.zig decides the exit code by looking
 * for `"ok":true` anywhere in the report.
 *
 * It rides in chunk-libdb.js (library-page.js exports it), not in bundle.js:
 * the main bundle's budget has no room for code only a self-test runs, and
 * the library's chunk is where IndexedDB lives anyway. The one thing that
 * has to be in bundle.js — what was on the window when it ran — is
 * selftest-boot.js, handed in as `atBoot`.
 * @module selftest-native
 */
/** library-db.js DB_NAME / DB_VERSION and its stores; scripts/test-persist.mjs holds the two together. */
const IDB_NAME = "chessboard.library";
const IDB_VERSION = 2;
/** The key in the library's "meta" store the marker lives under. */
const IDB_KEY = "selftest";

const done = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error || new Error("request failed"));
});

/**
 * Open the library's database the way library-db.js does — same name, same
 * version, the same stores made if they are not there, so opening it
 * here first can never leave the library a database without its stores.
 */
function openLibraryDb(idb) {
  const req = idb.open(IDB_NAME, IDB_VERSION);
  req.onupgradeneeded = () => {
    const d = req.result;
    if (!d.objectStoreNames.contains("games")) d.createObjectStore("games", { keyPath: "id" });
    if (!d.objectStoreNames.contains("meta")) d.createObjectStore("meta");
    if (!d.objectStoreNames.contains("repertoire")) d.createObjectStore("repertoire", { keyPath: "id" });
  };
  req.onblocked = () => {};
  return done(req);
}

/** The marker the last launch left, then this launch's in its place, read back. */
async function swapIdbMarker(marker) {
  const idb = globalThis.indexedDB;
  if (!idb || typeof idb.open !== "function") throw new Error("no indexedDB on this WebView");
  let db;
  try { db = await openLibraryDb(idb); }
  catch (err) { throw new Error("indexedDB.open(\"" + IDB_NAME + "\") failed: " + String((err && (err.name || err.message)) || err)); }
  try {
    const tx = db.transaction(["meta"], "readwrite");
    const meta = tx.objectStore("meta");
    const found = await done(meta.get(IDB_KEY));
    meta.put(marker, IDB_KEY);
    await new Promise((resolve, reject) => {
      tx.oncomplete = resolve;
      tx.onabort = tx.onerror = () => reject(tx.error || new Error("transaction failed"));
    });
    const back = await done(db.transaction(["meta"], "readonly").objectStore("meta").get(IDB_KEY));
    if (back !== marker) throw new Error("read back " + JSON.stringify(back) + " after writing " + JSON.stringify(marker));
    return { found: typeof found === "string" ? found : null };
  } finally {
    try { db.close(); } catch (_) { /* closed */ }
  }
}

/**
 * @param {object} d
 * @param {object} d.Host host.js
 * @param {(p: Promise<any>, ms: number, what: string) => Promise<any>} d.within
 * @param {(err: any) => string} d.errText
 * @param {(tag: string) => string} d.nonce
 * @param {(id: string) => void} d.useLang switch the app's language and save it
 * @param {{plan: string[], here: object}} d.atBoot selftest-boot.js SELFTEST_BOOT
 * @returns {Promise<object>} {idb, chunkSync, nativeIo}
 */
export async function runNativeSelftest(d) {
  const checks = {};

  const idb = checks.idb = { pass: false };
  try {
    idb.wrote = d.nonce("i");
    const got = await d.within(swapIdbMarker(idb.wrote), 10000, "indexedDB");
    idb.found = got.found;
    idb.pass = true;
  } catch (err) { idb.err = "IndexedDB on this WebView's zero:// origin: " + d.errText(err); }

  const langs = d.atBoot.plan.filter((f) => /^chunk-lang-/.test(f));
  const late = langs.filter((f) => !d.atBoot.here[f]);
  const chunkSync = checks.chunkSync = { pass: late.length === 0, planned: langs };
  if (late.length) {
    chunkSync.err = "planned by chunk-boot.js but not run before bundle.js (document.write): " + late.join(", ");
  } else if (!langs.length) {
    // a Chinese launch has nothing to show; the next one will
    chunkSync.next = "en";
    try { d.useLang("en"); } catch (err) { chunkSync.pass = false; chunkSync.err = "could not switch the next launch to en: " + d.errText(err); }
  }

  const io = checks.nativeIo = { pass: false };
  try {
    const answers = await d.within(d.Host.probeFileCommands(), 10000, "chess.openPgn / chess.saveText probe");
    const wrong = [];
    for (const cmd of ["openPgn", "saveText"]) {
      const a = answers[cmd];
      if (!a || a.probe !== true) wrong.push("chess." + cmd + " is not registered or refused: " + ((a && a.error) || JSON.stringify(a)));
      else if (a.dialogs !== true) wrong.push("chess." + cmd + ": this platform gives the native side no file dialog");
    }
    if (wrong.length) throw new Error(wrong.join("; "));
    io.pass = true;
  } catch (err) { io.err = d.errText(err); }

  return checks;
}
