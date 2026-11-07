/**
 * The Native SDK bridge, driven against a fake host.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { assert, root, ctx, loadModule, allAppSource } from "./harness.mjs";

export async function run() {
  // --- the Native SDK bridge, driven against a fake host ------------------
  // There is no way to run the packaged app from here, so the next best thing is
  // to stand up a `zero` that records what it was asked and assert the shape of
  // every call: the capability query happens, it is cached, a platform that says
  // "no" is taken at its word, and every one of these is best-effort — a Dock
  // menu entry that cannot be added must never turn opening a PGN into an error.
  {
    const load = (zero) => {
      const c = { console, TextEncoder, TextDecoder, btoa, atob, navigator: {}, document: {} };
      c.globalThis = c;
      c.window = c;
      if (zero) c.zero = zero;
      vm.createContext(c);
      loadModule(c, "src/web/js/host.js");
      return c.ChessHost;
    };

    // a host that supports everything, and counts what it is asked
    const calls = [];
    const yes = {
      platform: { supports: (v) => { calls.push(["supports", v.feature]); return Promise.resolve(true); } },
      os: {
        addRecentDocument: (v) => { calls.push(["addRecent", v.path]); return Promise.resolve(true); },
        clearRecentDocuments: () => { calls.push(["clearRecent"]); return Promise.resolve(true); },
        showNotification: (v) => { calls.push(["notify", v.title, v.body]); return Promise.resolve(true); },
      },
    };
    const H = load(yes);
    await H.addRecentDocument("/games/spanish.pgn");
    await H.notify({ title: "T", body: "B" });
    await H.clearRecentDocuments();
    assert(calls.some((c) => c[0] === "addRecent" && c[1] === "/games/spanish.pgn"),
      "an opened PGN is offered to the recent-documents list");
    assert(calls.some((c) => c[0] === "notify" && c[1] === "T" && c[2] === "B"),
      "a notification carries its title and body");
    assert(calls.some((c) => c[0] === "clearRecent"), "clearing local data clears the list too");
    // asked once per feature, not once per call
    await H.addRecentDocument("/games/again.pgn");
    const probes = calls.filter((c) => c[0] === "supports" && c[1] === "recent_documents").length;
    assert(probes === 1, "the capability query is cached (" + probes + " probe(s) for two calls)");

    // a host that supports nothing: nothing is attempted, nothing throws
    const tried = [];
    const no = {
      platform: { supports: () => Promise.resolve(false) },
      os: {
        addRecentDocument: () => { tried.push("addRecent"); return Promise.resolve(true); },
        clearRecentDocuments: () => { tried.push("clearRecent"); return Promise.resolve(true); },
        showNotification: () => { tried.push("notify"); return Promise.resolve(true); },
      },
    };
    const H2 = load(no);
    await H2.addRecentDocument("/x.pgn");
    await H2.clearRecentDocuments();
    const shown = await H2.notify({ title: "T" });
    assert(tried.length === 0, "a platform that says no is taken at its word (" + tried.join(",") + ")");
    assert(shown === false, "notify reports that nothing was shown");

    // a host whose calls reject: still best-effort, never an exception upward
    const H3 = load({
      platform: { supports: () => Promise.resolve(true) },
      os: {
        addRecentDocument: () => Promise.reject(new Error("nope")),
        clearRecentDocuments: () => Promise.reject(new Error("nope")),
        showNotification: () => Promise.reject(new Error("nope")),
      },
    });
    let threw = null;
    try {
      await H3.addRecentDocument("/x.pgn");
      await H3.clearRecentDocuments();
      assert((await H3.notify({ title: "T" })) === false, "a rejected notification reports false");
    } catch (e) { threw = e.message; }
    assert(threw === null, "a failing host never throws into the app" + (threw ? " — " + threw : ""));

    // no bridge at all (a plain browser): every one of these is a no-op
    const H4 = load(null);
    let threw2 = null;
    try {
      await H4.addRecentDocument("/x.pgn");
      await H4.clearRecentDocuments();
      assert((await H4.notify({ title: "T" })) === false, "no bridge means no notification");
      assert((await H4.supports("notifications", false)) === false, "no bridge falls back to the default");
    } catch (e) { threw2 = e.message; }
    assert(threw2 === null, "the bridge additions are safe in a plain browser" + (threw2 ? " — " + threw2 : ""));

    // readTextFile answers with an object now, because a bare base64 string had
    // no room to say "that was not the whole file". The native side reads into a
    // 256 KiB buffer; when a PGN library overflowed it, the first 256 KiB came
    // back looking exactly like a complete file, so the games past the cut were
    // gone and the one straddling it arrived as a syntax error.
    const b64 = (s) => Buffer.from(s, "utf8").toString("base64");
    const readHost = (result) => load({ invoke: () => Promise.resolve(result) });
    assert(await readHost({ b64: b64("1. e4 e5") }).readTextFile("/a.pgn") === "1. e4 e5",
      "a complete read decodes to its text");
    assert(await readHost(b64("1. e4 e5")).readTextFile("/a.pgn") === "1. e4 e5",
      "the older bare-string result still decodes");
    let big = null;
    try { await readHost({ tooLarge: true, limit: 262144 }).readTextFile("/library.pgn"); }
    catch (e) { big = e; }
    assert(big !== null, "an oversized file is refused, not silently truncated");
    assert(big && big.name === H.FILE_TOO_LARGE, "the refusal is distinguishable from a parse failure");
    assert(big && big.limit === 262144, "the refusal carries the limit, so the message can name it");
    let junk = null;
    try { await readHost(null).readTextFile("/a.pgn"); } catch (e) { junk = e; }
    assert(junk !== null, "a malformed bridge result is an error, not undefined text");

    // and the app actually calls them, at the places that matter
    const appSrc = allAppSource;
    for (const [what, re] of [
      // 6.0: one exportText() serves PGN and the learning file; only a PGN is a document
      ["the export dialog", /Host\.saveText\(\{ title, name, text, recent, onStaged \}\)/], // v8-1-plan N2: main.zig adds it; onStaged: v8-2-plan F5
      // 7.0: the picker takes a sink (the library import reuses it), so what
      // this looks for is the call, not the one destination it used to have
      ["the open dialog", /Host\.openPgn\(\{ title: t\("dlg\.openPgn"\), recent: true \}\)/],
      ["a dropped file", /importPgnText\(await Host\.readTextFile\(p\), p\);\s*\n\s*Host\.addRecentDocument\(p\);/],
      ["clearing the save", /Persist\.clearAll\(\);[\s\S]{0,320}?Host\.clearRecentDocuments\(\);/],
    ]) assert(re.test(appSrc), "recent documents is recorded from " + what);
    assert(/if \(!store\.ui\.appForeground\) Host\.notify\(/.test(appSrc),
      "the analysis notification only fires when the app is in the background");
    // The difficulty ladder is declared once. A hand-written second copy in
    // loadSettings meant a tier added to DIFF_IDS would be accepted by the UI and
    // then dropped on the next launch.
    {
      const ids = /const DIFF_IDS = \[([^\]]*)\]/.exec(appSrc);
      assert(ids, "app.js declares DIFF_IDS");
      const list = [...ids[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]);
      assert(list.length >= 5, "the ladder has rungs (" + list.join(", ") + ")");
      // 1.19 wrote this as a test for one exact array literal — the copy that
      // existed at the time. That catches the instance, not the class: `DIFF_EN`
      // in pgnForExport is an OBJECT keyed by the same ids, it predated the
      // "casual" rung, and it sailed straight through, exporting the raw id into
      // a PGN tag. The rule that actually holds is: any literal that enumerates
      // the ladder must enumerate ALL of it. A complete map stays correct when a
      // rung is added — a partial one silently drops it.
      // A rung shows up either as a quoted string ("beginner") or as an object
      // key (beginner:). The first version of this check only looked for the
      // quoted form and so still missed DIFF_EN, whose keys are bare — the guard
      // reproduced the very blind spot it was written to close.
      const names = (lit) => list.filter((id) =>
        new RegExp('"' + id + '"|\\b' + id + '\\s*:').test(lit));
      const flatLiterals = appSrc.match(/[[{][^[\]{}]*[\]}]/g) || [];
      const partial = flatLiterals
        .map((lit) => ({ lit, hit: names(lit) }))
        .filter(({ hit }) => hit.length >= 3 && hit.length < list.length);
      assert(partial.length === 0,
        "every literal that enumerates the difficulty ladder enumerates all of it"
        + (partial.length
          ? " — missing " + partial.map((p) => list.filter((id) => !p.hit.includes(id)).join("/")
            + " in `" + p.lit.replace(/\s+/g, " ").slice(0, 70) + "`").join("; ")
          : ""));
      assert(/DIFF_IDS\.includes\(s\.difficulty\)/.test(appSrc),
        "the saved difficulty is validated against DIFF_IDS itself");
      const engSrc = fs.readFileSync(path.join(root, "src/web/js/engine.js"), "utf8");
      const missing = list.filter((id) => !new RegExp("\\n\\s*" + id + ": \\{").test(engSrc));
      assert(missing.length === 0,
        "every rung has engine settings" + (missing.length ? " — missing: " + missing.join(", ") : ""));
      // 10.0 M0: a rung is chosen by its opponent's card — so every rung has one
      const oppSrc = fs.readFileSync(path.join(root, "src/web/js/opponents.js"), "utf8");
      const noCard = list.filter((id) => !new RegExp('level: "' + id + '"').test(oppSrc));
      assert(noCard.length === 0,
        "every rung has an opponent card (opponents.js PERSONAS)" + (noCard.length ? " — missing: " + noCard.join(", ") : ""));
      const dict = ctx.ChessI18n.DICT;
      for (const lang of Object.keys(dict)) {
        const gaps = list.filter((id) => !("diff." + id in dict[lang]));
        assert(gaps.length === 0, lang + " names every rung" + (gaps.length ? " — missing " + gaps.join(", ") : ""));
      }
    }

    assert(/activate: \(\) => \{ store\.ui\.appForeground = true;/.test(appSrc)
      && /deactivate: \(\) => \{ store\.ui\.appForeground = false;/.test(appSrc),
      "both lifecycle events maintain the foreground flag");
    // 1.18: and both of them have to poke the clock. The tick charges elapsed
    // wall time, so an app that keeps running out of sight keeps billing it —
    // measured at 1.17, 8.4s in the background cost 9s of clock. Now that
    // closing the window on macOS hides the app rather than ending it, that is
    // the normal path, not the unlucky one.
    assert(/activate: \(\) => \{ store\.ui\.appForeground = true; syncClockTimer\(\)/.test(appSrc)
      && /deactivate: \(\) => \{ store\.ui\.appForeground = false; saveGame\(\); syncClockTimer\(\)/.test(appSrc),
      "both lifecycle events stop and restart the clock");
    assert(/function clockRunning\(\)[\s\S]{0,200}?&& appAwake\(\);/.test(appSrc),
      "the clock only runs while somebody is in front of the board");
    assert(/function appAwake\(\)[\s\S]{0,300}?visibilityState !== "hidden"/.test(appSrc),
      "being away counts by the web signal as well as the native one");
  }
}
