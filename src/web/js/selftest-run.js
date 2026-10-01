/**
 * The packaged app's self-test (CHESS_SELFTEST=1, see main.zig): questions
 * asked of the page as shipped, each answered on its own, the verdict handed
 * to the native side, which records it and exits.
 *
 *   engine   can it start Stockfish and get a legal move (7.5)
 *   appdata  does the native save file take a write and give it back (7.6)
 *   chunk    does a lazy chunk arrive over zero:// and answer a lookup (7.6)
 *   restart  does localStorage keep a marker: every run reports the marker
 *            it found and writes a fresh one; scripts/selftest-app.mjs
 *            launches the app twice and checks that the second run found
 *            the first run's (7.6)
 *   sound    the default sound set's buffers build and render, offline (7.7)
 *   idb, chunkSync, nativeIo — selftest-native.js (v8-1-plan N3)
 *
 * `ok` is true only when every check passes, and `err` names the ones that
 * did not. The checks say `pass`, never `ok`: main.zig decides the exit
 * code by looking for `"ok":true` anywhere in the report.
 *
 * v8-2-plan V1 step 2: an on-demand chunk (chunk-selftest.js), no longer a
 * function in app.js — the first frame never needs it, and the main bundle
 * had no room for the automation build's scenarios (selftest-scenarios.js)
 * beside it. app.js hands in what the checks touch; when main.zig names a
 * scenario (CHESS_SELFTEST_SCENARIO), that runs instead of these checks.
 * @module selftest-run
 */
import { runScenario } from "./selftest-scenarios.js";

const within = (p, ms, what) => Promise.race([p, new Promise((_, reject) =>
  setTimeout(() => reject(new Error("timeout " + Math.round(ms / 1000) + "s: " + what)), ms))]);
const errText = (err) => String((err && (err.message || err)) || "unknown");
const nonce = (tag) => tag + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

/**
 * @param {true|string} mode what Host.selftestMode answered: true for the
 *   self-test, a scenario's name for the automation build's driver
 * @param {object} d app.js's bag: Host, Persist, Chess, ChessEngine, ChessEco,
 *   ChessLazy, Audio2, loadChunk, atBoot (selftest-boot.js SELFTEST_BOOT),
 *   useLang(id), langId(), importPgnToLibrary(text, label)
 */
export function runSelftest(mode, d) {
  const t = { within, errText, nonce };
  return mode === true ? runChecks(d, t) : runScenario(String(mode), Object.assign({}, d, t));
}

async function runChecks(d, { within, errText, nonce }) {
  const { Host, Persist, Chess, ChessEngine, ChessEco, ChessLazy, Audio2, loadChunk } = d;
  const t0 = performance.now();
  const report = {
    ok: false,
    version: typeof __CHESS_VERSION__ === "string" ? __CHESS_VERSION__ : "?",
    wasm: typeof WebAssembly === "object",
    ua: navigator.userAgent,
    checks: {},
  };

  // First, so the WebView has the whole run to commit it to disk before
  // main.zig exits the process (see MARKER_SETTLE_MS below). The marker is
  // outside the profile on purpose (persist.js SELFTEST_KEY).
  const markerAt = performance.now();
  const restart = report.checks.restart = { pass: false };
  try {
    restart.wrote = nonce("m");
    const swap = Persist.swapSelftestMarker(restart.wrote);
    restart.found = swap.found;
    if (!swap.stored) throw new Error("localStorage did not keep the marker");
    restart.pass = true;
  } catch (err) { restart.err = errText(err); }
  // v8-1-plan N3: idb, chunkSync, nativeIo (selftest-native.js, in chunk-libdb.js)
  Object.assign(report.checks, await within(loadChunk("chunk-libdb.js", "CHESS_LIBDB"), 15000, "chunk-libdb.js").then((m) => m.runNativeSelftest({ Host, within, errText, nonce, atBoot: d.atBoot,
    useLang: d.useLang })).catch((err) => ({ idb: { pass: false, err: errText(err) }, chunkSync: { pass: false, err: errText(err) }, nativeIo: { pass: false, err: errText(err) } })));

  const engine = report.checks.engine = { pass: false };
  const te = performance.now();
  try {
    if (!ChessEngine) throw new Error("no engine module");
    const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
    // 60 s is twice the engine's own boot timeout
    const mv = await within(ChessEngine.bestMove(start, "normal"), 60000, "engine move");
    if (!mv || !mv.from || !mv.to) throw new Error("no move");
    const legal = new Chess(start).move({ from: mv.from, to: mv.to, promotion: mv.promotion || "q" });
    if (!legal) throw new Error("illegal move " + mv.from + mv.to);
    engine.pass = true;
    engine.move = report.move = legal.san;
  } catch (err) { engine.err = errText(err); }
  engine.ms = Math.round(performance.now() - te);

  // v8-0-plan F3: the round trip goes through the per-key store the
  // profile now lives in, under a key of its own ("selftest", which
  // persist.js never lists), so it can neither disturb the profile nor be
  // disturbed by persist's own flushes. The payload is the whole profile,
  // so on a real one it is as large as a real write — past 512 KiB it
  // crosses the bridge in pieces, which is what this checks.
  const appdata = report.checks.appdata = { pass: false };
  try {
    const text = JSON.stringify(Object.assign(Persist.exportAll(), { selftest: nonce("a") }));
    const wrote = await within(Host.appdataWriteKey("selftest", text), 10000, "appdataWrite");
    if (wrote == null) throw new Error("no native save file here (appdataWrite answered null)");
    if (wrote !== true) throw new Error("appdataWrite answered " + JSON.stringify(wrote));
    const back = await within(Host.appdataReadKey("selftest"), 10000, "appdataRead");
    appdata.bytes = text.length;
    if (!back || back.text !== text) {
      throw new Error("read back " + (back && typeof back.text === "string"
        ? back.text.length + " bytes that are not what was written" : JSON.stringify(back)));
    }
    appdata.pass = true;
  } catch (err) { appdata.err = errText(err); }

  // the road renderOpening() takes: eco-lookup.js injects js/chunk-eco.js
  // as a classic script over zero://, then answers from its table
  const chunk = report.checks.chunk = { pass: false, preloaded: ChessEco.loaded() };
  try {
    await within(ChessEco.ready(), 15000, "chunk-eco.js");
    const hit = ChessEco.openingForGame(["e4", "c5"]);
    if (!hit || hit.eco !== "B20") throw new Error("1.e4 c5 looked up as " + JSON.stringify(hit));
    // v8-0-plan F5: the language chunks and the mined puzzles take the same
    // road; a package without them would be Chinese-only and a short book
    await within(ChessLazy.ensureLang("ja"), 15000, "chunk-lang-*.js");
    await within(ChessLazy.ensureMined(), 15000, "chunk-mined.js");
    chunk.pass = true;
    chunk.name = hit.eco + " " + ChessEco.localName(hit, d.langId());
  } catch (err) { chunk.err = errText(err); }

  // the default sound set renders here: buffers built and rendered offline,
  // no gesture needed and nothing heard (audio.js selftest, 7.7)
  const sound = report.checks.sound = { pass: false };
  try {
    Object.assign(sound, await within(Audio2.selftest(), 15000, "sound render"));
  } catch (err) { sound.err = errText(err); }

  // A WebView commits localStorage to disk on a timer of its own (Chromium's
  // is a few seconds), and main.zig exits the moment the report arrives: a
  // marker written just before that could be lost for a reason no player's
  // session meets. Give it a floor.
  const MARKER_SETTLE_MS = 6000;
  const settle = MARKER_SETTLE_MS - (performance.now() - markerAt);
  if (restart.pass && settle > 0) await new Promise((r) => setTimeout(r, settle));

  const failed = Object.keys(report.checks).filter((k) => !report.checks[k].pass);
  report.ok = failed.length === 0;
  if (failed.length) report.err = failed.map((k) => k + ": " + (report.checks[k].err || "failed")).join("; ");
  report.ms = Math.round(performance.now() - t0);
  await Host.selftestReport(report);
}

export const CHESS_SELFTEST_RUN = { runSelftest };
