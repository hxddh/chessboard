/**
 * Online sync goes through the native layer; the charts' one dress; the way
 * in for recordings.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { CHUNKS } from "../bundle.mjs";
import { assert, root, WEB_MODULES, allAppSource } from "./harness.mjs";

export async function run() {
  // --- v8-0-plan C2: online sync goes through the native layer, never the page --
  //
  // The page holds a bridge that writes files (index.html's CSP comment), and
  // C2 is the first feature that talks to another host. It does so from
  // main.zig (chess.fetchGames), so the page's policy stays exactly what it
  // was: a connect-src that grew a lichess.org would be a page that can send
  // anything it reads to it. Held to the letter, not to "still has 'self'".
  {
    const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const metas = html.match(/<meta http-equiv="Content-Security-Policy" content="[^"]*"/g) || [];
    assert(metas.length === 1 && metas[0].endsWith("content=\"default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; " +
      "style-src 'self'; img-src 'self' data:; worker-src blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'\""),
    "C2: the page's CSP is unchanged — one policy, connect-src 'self' (" + metas.join(" | ") + ")");
    const hostJs = fs.readFileSync(path.join(root, "src/web/js/host.js"), "utf8");
    assert(hostJs.includes('zero.invoke("chess.fetchGames"'), "C2: host.js asks the native side for the games");
    // no page code reaches either site itself (the URLs live in main.zig)
    const remote = /lichess\.org\/api|api\.chess\.com|XMLHttpRequest|\bfetch\(\s*["'`]https?:/.test(allAppSource);
    assert(!remote, "C2: no page module requests Lichess or Chess.com directly");
    // the dialog is a chunk (the first-paint budget had ~3 KB left): only the
    // switch's paint and the loader are in the bundle (prefs-ui.js)
    assert(CHUNKS.some((c) => c.entry === "src/web/js/sync-ui.js" && c.global === "createSyncUI"),
      "C2: the sync dialog is an on-demand chunk (chunk-sync.js)");
    // v8-2-plan V1: and the automation build's sync scenario, which runs only
    // under CHESS_SELFTEST and against the fake server sync.zig's CHESS_SYNC_BASE names
    const callers = [...WEB_MODULES].filter(([file, text]) => /\.fetchGames\(/.test(text) && file !== "host.js").map(([file]) => file).sort();
    // v10-0-plan A1: …and 分析一局, for one Lichess game by its id, behind the same switch
    assert(callers.join() === "analyse-entry.js,selftest-scenarios.js,sync-ui.js", "C2: only the sync dialog, 分析一局 (and the self-test's sync scenario) call fetchGames (" + callers.join(", ") + ")");
  }

  // --- 12.0 C: the charts' one dress ------------------------------------------
  // Five readers through 11.0 took their own colours — the rating and accuracy
  // sparklines drew their line in --accent, the brightest ink on the page for
  // the least important picture on it. Now every chart reads the --chart-*
  // tokens through charts.js, and the geometry of a sparkline is a pure
  // function this file can hold.
  {
    const { sparkPoints } = await import("../../src/web/js/charts.js");
    const pts = sparkPoints([1000, 1100, 1200], 1000, 1200, 200, 100, 4);
    assert(pts[0].x === 4 && pts[2].x === 196 && pts[0].y === 96 && pts[2].y === 4 && pts[1].y === 50,
      "12.0 C: a sparkline spans its box inside the margin, low at the bottom (" + JSON.stringify(pts) + ")");
    const clamp = sparkPoints([0, 2000], 1000, 1200, 200, 100, 4);
    assert(clamp[0].y === 96 && clamp[1].y === 4, "12.0 C: a value outside the window is held to its edge, not drawn off the canvas");
    const one = sparkPoints([1500], 1500, 1500, 200, 100, 4);
    assert(one.length === 1 && one[0].x === 100 && Number.isFinite(one[0].y), "12.0 C: one value stands in the middle, with no division by zero");
    assert(sparkPoints([], 0, 1, 200, 100, 4).length === 0, "12.0 C: no data, no points");
    const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    for (const tk of ["--chart-line", "--chart-area", "--chart-grid", "--chart-now", "--chart-label"])
      assert((css.match(new RegExp("\\n\\s*" + tk + ":", "g")) || []).length === 1, "12.0 C: " + tk + " is declared once");
    const drawers = ["review/eval-graph.js", "diag-charts.js", "me-page.js", "app.js"];
    const direct = drawers.filter((f) => /getPropertyValue\("--(?:muted|accent|data|line|text)"\)/.test(fs.readFileSync(path.join(root, "src/web/js", f), "utf8")));
    assert(direct.length === 0, "12.0 C: the charts read their colours from charts.js, not each its own (" + direct.join(", ") + ")");
  }

  // --- 12.0 A: the way in for recordings (scripts/sound-kit.mjs) ---------------
  // None ship — no recording could be found whose licence GPLv3 carries and
  // whose source could be checked (sound-bank.js) — so the packer is held here,
  // on WAVs made in memory: what it takes, what it refuses, and the budget.
  {
    const { packKit, parseWav, kitModules, KIT_BUDGET } = await import("../sound-kit.mjs");
    const wav = (seconds, { rate = 44100, bits = 16, channels = 1 } = {}) => {
      const n = Math.round(seconds * rate) * channels * (bits / 8);
      const b = Buffer.alloc(44 + n);
      b.write("RIFF", 0); b.writeUInt32LE(36 + n, 4); b.write("WAVE", 8);
      b.write("fmt ", 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(channels, 22);
      b.writeUInt32LE(rate, 24); b.writeUInt32LE(rate * channels * bits / 8, 28); b.writeUInt16LE(channels * bits / 8, 32); b.writeUInt16LE(bits, 34);
      b.write("data", 36); b.writeUInt32LE(n, 40);
      return b;
    };
    const names = ["move", "capture"];
    const ok = packKit([{ file: "move-2.wav", bytes: wav(0.1) }, { file: "move-1.wav", bytes: wav(0.12) }, { file: "capture-1.wav", bytes: wav(0.2) }], names);
    assert(ok.names.join() === "capture,move" && ok.kit.move.length === 2 && Buffer.from(ok.kit.move[0], "base64").length === wav(0.12).length,
      "12.0 A: the kit packs each event's takes in file order, base64");
    const refuse = (files, re) => { try { packKit(files, names); return false; } catch (e) { return re.test(e.message); } };
    assert(refuse([{ file: "boom-1.wav", bytes: wav(0.1) }], /name it/), "12.0 A: a file not named for an event is refused");
    assert(refuse([{ file: "move-1.wav", bytes: wav(0.1, { bits: 8 }) }], /16-bit/), "12.0 A: …and one that is not 16-bit PCM");
    assert(refuse([{ file: "move-1.wav", bytes: wav(2.5) }], /at most 2/), "12.0 A: …and one longer than two seconds");
    const big = Array.from({ length: 4 }, (_, i) => ({ file: "move-" + i + ".wav", bytes: wav(1.0) }));
    assert(refuse(big, /budget/) && KIT_BUDGET === 300 * 1024, "12.0 A: …and a kit over 300 KB in all");
    assert(parseWav(Buffer.from("not a wav file at all, no header here at all.....")) instanceof Error, "12.0 A: not a WAV is an error, not a crash");
    const empty = kitModules(packKit([], names));
    const shipped = fs.readFileSync(path.join(root, "src/web/js/sound-kit-names.js"), "utf8");
    assert(shipped.replace(/\r\n/g, "\n") === empty.names, "12.0 A: no recordings ship, and the generated list says so (sound-kit-names.js is what the script writes for an empty sounds/)");
    assert(fs.existsSync(path.join(root, "sounds/CREDITS.md")), "12.0 A: sounds/CREDITS.md says what a recording needs to come in");
  }
}
