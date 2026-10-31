/**
 * The on-demand chunks stay out of the first-paint bundle, and its budget.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { compileModuleSync, CHUNKS, build, BUNDLE_BUDGET } from "../bundle.mjs";
import { assert, root, loadModule } from "./harness.mjs";

export async function run() {
  // --- 6.1: the on-demand chunks stay out of the first-paint bundle ----------
  //
  // The whole point of CHUNKS is that index.html does not parse them before the
  // board appears. One stray `import "./eco.js"` anywhere in app.js's graph and
  // esbuild pulls the whole table back in, the bundle silently grows by a third
  // and nothing else notices. And a chunk that is built but not packaged is an
  // app whose opening names never appear, so the dist list is checked too.
  {
    // Build first: bundle.js and the chunks are generated and gitignored, so a
    // fresh checkout (CI) has neither, and this block reads both. compileModuleSync
    // elsewhere in this file compiles single modules, which does not produce them.
    const bundleSrc = await build({ write: true });
    const syncSrc = fs.readFileSync(path.join(root, "scripts/sync-dist.mjs"), "utf8");
    for (const c of CHUNKS) {
      const out = path.join(root, c.out);
      assert(fs.existsSync(out), c.out + " is built alongside the bundle");
      const chunkSrc = fs.readFileSync(out, "utf8");
      assert(new RegExp("window\\[k\\]").test(chunkSrc) || chunkSrc.includes(c.global),
        c.out + " puts " + c.global + " on the window");
      // the table's own bulk must not be in the bundle: compare a distinctive
      // slice of the chunk against the bundle rather than trusting a name.
      // (Not for the boot chunk: it is the plan lazy-content.js also gives the
      // bundle, and it is a few hundred bytes of code rather than a payload.)
      if (c.boot) continue;
      const probe = chunkSrc.slice(Math.floor(chunkSrc.length / 2), Math.floor(chunkSrc.length / 2) + 120);
      assert(!bundleSrc.includes(probe), c.out + "'s payload is not also inside bundle.js");
      // …and by symbol (v8-1-plan F2): the chunk's global is never declared or
      // assigned in the bundle. Identifiers survive the minifier, so this holds
      // where a slice of code does not — chunk-report.js and chunk-sync.js
      // pulled back in by a static import were caught by this line only: their
      // middle 120 bytes do not reappear verbatim once bundled with the rest.
      if (c.global) {
        const decl = new RegExp("\\b(?:function|class)\\s+" + c.global + "\\d*\\b|(?<![.\\w$])" + c.global + "\\d*\\s*=(?!=)");
        assert(!decl.test(bundleSrc), c.out + ": bundle.js does not declare " + c.global);
      }
    }

    // The first-paint budget (bundle.mjs BUNDLE_BUDGET), and it is a line, not
    // a one-time measurement: one static import of a chunk's module and
    // esbuild inlines it again without a word. Minified bytes (v8-1-plan F2).
    const bundleBytes = Buffer.byteLength(bundleSrc, "utf8");
    console.log("  bundle.js " + bundleBytes + " bytes minified (budget " + BUNDLE_BUDGET + ")");
    assert(bundleBytes <= BUNDLE_BUDGET,
      "bundle.js stays within the first-paint budget (" + bundleBytes + (bundleBytes <= BUNDLE_BUDGET ? " ≤ " : " > ") + BUNDLE_BUDGET + " bytes)");
    // …and the release's own, tighter line: new pages go in chunks, the bundle
    // carries their doors. v9-0-plan §8 第 4 条 set it at 8.4.0 + 20 KB; 10.0
    // and 11.0 moved it one release on each time (9.0.0 923,333 bytes, 10.1.0
    // 942,990 bytes, + 20 KB). 14.0 E turns it round: the course's paragraphs
    // and tasks went to chunk-lessons-body.js, and the release stays at least
    // 20 KB under 13.0.0 (962,723 bytes, 4e83c16) — room 14.0's pages spend
    // 15.0 P: v15-0-plan §3's line, 860,000 bytes (14.0.0 shipped 888,759):
    // the classic set's figurines rounded, the Chinese opening ideas and the
    // family / variation names in chunks of their own
    const BUNDLE_BYTES_150 = 860000;
    assert(bundleBytes <= BUNDLE_BYTES_150,
      "15.0: bundle.js stays within v15-0-plan's 860,000 bytes (" + bundleBytes + (bundleBytes <= BUNDLE_BYTES_150 ? " ≤ " : " > ") + BUNDLE_BYTES_150 + " bytes)");
    // 17.0 E: v17-0-plan §4 — the textures' code and the classic set went
    // (842,636 bytes measured); the line is that and 2,364 bytes of room
    const BUNDLE_BYTES_170 = 845000;
    assert(bundleBytes <= BUNDLE_BYTES_170,
      "17.0: bundle.js stays within v17-0-plan's 845,000 bytes (" + bundleBytes + (bundleBytes <= BUNDLE_BYTES_170 ? " ≤ " : " > ") + BUNDLE_BYTES_170 + " bytes)");
    // …minified without renaming: a player's stack trace still names the code
    assert(/\bfunction createSettingsUI\(/.test(bundleSrc) && !/\n\s{2,}\S/.test(bundleSrc.slice(0, 20000)),
      "F2: bundle.js is minified (no indented lines) and keeps its identifiers (createSettingsUI)");

    // The boot chunk is the one index.html loads, and it loads before the
    // bundle — that order is the whole reason the first frame is in the right
    // language. Every other chunk is on demand and must not be named there.
    {
      const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      const boots = CHUNKS.filter((c) => c.boot);
      assert(boots.length === 1, "exactly one chunk is the boot chunk");
      const bootAt = html.indexOf('<script src="js/' + path.basename(boots[0].out) + '"></script>');
      const bundleAt = html.indexOf('<script src="js/bundle.js"></script>');
      assert(bootAt > 0 && bundleAt > bootAt, "index.html runs " + path.basename(boots[0].out) + " before bundle.js");
      const named = CHUNKS.filter((c) => !c.boot && html.includes(path.basename(c.out)));
      assert(named.length === 0, "index.html names no on-demand chunk (" + named.map((c) => c.out).join(", ") + ")");
    }

    // …and what it loads: lazy-content.js bootPlan, from the settings as stored
    {
      const lctx = { console };
      lctx.globalThis = lctx;
      lctx.window = lctx;
      vm.createContext(lctx);
      loadModule(lctx, "src/web/js/lazy-content.js");
      const plan = (settings, nav) => lctx.bootPlan(settings == null ? null : JSON.stringify(settings), nav).join(" ");
      const cases = [
        [{ langId: "zh-CN", mode: "ai" }, null, "chunk-merida.js"],
        [{ langId: "en" }, null, "chunk-lang-en.js chunk-merida.js"],
        // Japanese reads English as its bridge, so it takes both, English first
        [{ langId: "ja" }, null, "chunk-lang-en.js chunk-lang-ja.js chunk-merida.js"],
        // settings without a language are the Chinese default, whatever the OS says
        [{ mode: "ai" }, { languages: ["en-US"] }, "chunk-merida.js"],
        // no settings at all is a first run: the system locale decides
        [null, { languages: ["ja-JP", "en"] }, "chunk-lang-en.js chunk-lang-ja.js chunk-merida.js"],
        [null, { languages: ["zh-TW"] }, "chunk-merida.js"],
        [{ langId: "en", mode: "puzzle", pieceSet: "merida" }, null, "chunk-lang-en.js chunk-mined.js chunk-merida.js"],
        // v8-0-plan A3: every set outside the bundle is fetched ahead of the
        // bundle for the player who chose it; the one inside it needs nothing.
        // 16.0 V: and the default, Merida, for everyone else — a 15.x save's
        // unpicked cburnett included (look.js readLook)
        [{ pieceSet: "fantasy" }, null, "chunk-pieces-fantasy.js"],
        [{ pieceSet: "chessnut" }, null, "chunk-pieces-chessnut.js"],
        [{ pieceSet: "cburnett" }, null, "chunk-merida.js"],
        [{ pieceSet: "cburnett", pieceSetPicked: true }, null, "chunk-pieces-cburnett.js"],
        [{ pieceSet: "classic" }, null, "chunk-pieces-classic.js"], // 17.0 F: out of the bundle too
        [{ pieceSet: "toString" }, null, "chunk-merida.js"],
        [{ langId: "xx" }, null, "chunk-merida.js"],
      ];
      for (const [settings, nav, want] of cases) {
        const got = plan(settings, nav);
        assert(got === want, "bootPlan(" + JSON.stringify(settings) + ", " + JSON.stringify(nav) + ") = [" + got + "], want [" + want + "]");
      }
      assert(lctx.bootPlan("{not json", null).join(" ") === lctx.bootPlan(null, null).join(" "),
        "unreadable settings are treated as none");
      // every chunk the plan or the app can ask for is one the bundler builds,
      // under the global it promises
      const asked = [...Object.values(lctx.LANG_CHUNKS).flat(), lctx.MINED_CHUNK, ...Object.values(lctx.PIECE_CHUNKS), ...Object.values(lctx.REVIEW_CHUNKS || {})];
      assert(lctx.PIECE_CHUNKS.merida === lctx.MERIDA_CHUNK, "Merida is one of the piece chunks, under its M1 file name");
      // v8-0-plan A3: every set offered is licence-cleared where it lives and
      // where the user reads it. The module header names the author, the
      // source it was taken from and the licence relied on; the About panel
      // (all three languages) and README's 许可 section name it too. Only
      // GPL-compatible licences: GPL, Apache 2.0, MIT, CC BY(-SA) 4.0.
      {
        const lookSrc = fs.readFileSync(path.join(root, "src/web/js/look.js"), "utf8");
        const ids = JSON.parse(/PIECE_SET_IDS = (\[[^\]]*\])/.exec(lookSrc)[1]);
        const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
        const credits = ["i18n.js", "i18n-en.js", "i18n-ja.js"].map((f) =>
          /"about\.creditsText": "([^"]*)"/.exec(fs.readFileSync(path.join(root, "src/web/js", f), "utf8"))[1]);
        const LICENCE = /\b(GPLv[23]\+?|GPL|Apache (License )?2\.0|MIT|CC BY(-SA)? 4\.0)\b/;
        const AUTHOR = { cburnett: "Burnett", classic: "Cburnett", merida: "Armando Hernandez Marroquin",
          chessnut: "Alexis Luengas", fantasy: "Maurizio Monge", celtic: "Maurizio Monge", spatial: "Maurizio Monge" };
        assert(ids.length >= 7 && ids[0] === "merida", "seven sets, the default first (" + ids.join(", ") + ")");
        for (const id of ids) {
          const file = id === "classic" ? "pieces.js" : "pieces-" + id + ".js";
          const src = fs.existsSync(path.join(root, "src/web/js", file)) ? fs.readFileSync(path.join(root, "src/web/js", file), "utf8") : "";
          const head = (/^\/\*\*([\s\S]*?)\*\//.exec(src) || ["", ""])[1];
          assert(!!src && LICENCE.test(head) && head.includes(AUTHOR[id]),
            "piece set " + id + ": " + file + " names its author and a GPL-compatible licence in its header");
          assert(readme.includes(file), "README 许可 names " + file);
          const name = id === "classic" ? null : AUTHOR[id];
          if (name) assert(credits.every((c) => c.includes(name)), "the About panel credits " + name + " in all three languages");
          // in the bundle, or a chunk that is built
          const inBundle = false; // 16.0 V: cburnett left the bundle; 17.0 F: classic too
          assert(inBundle || (lctx.PIECE_CHUNKS[id] && CHUNKS.some((c) => c.entry === "src/web/js/" + file && path.basename(c.out) === lctx.PIECE_CHUNKS[id].file)),
            "piece set " + id + " is " + (inBundle ? "in the bundle" : "its own chunk, built from " + file));
        }
      }
      for (const a of asked) {
        assert(CHUNKS.some((c) => path.basename(c.out) === a.file && c.global === a.global),
          a.file + " (" + a.global + ") is in CHUNKS, so it is built and packaged");
      }
      loadModule(lctx, "src/web/js/persist.js");
      assert(lctx.SETTINGS_KEY === lctx.KEYS.settings, "the boot chunk reads the key persist.js writes the settings under");
    }

    // i18n.js with only the Chinese dictionary on board — the state of the
    // page between a language switch and its chunk arriving
    {
      const ictx = { console, Intl };
      ictx.globalThis = ictx;
      ictx.window = ictx;
      vm.createContext(ictx);
      const run = (f) => vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), ictx, { filename: f });
      run("i18n.js");
      const I = ictx.ChessI18n;
      assert(Object.keys(I.DICT).join(",") === "zh-CN", "the bundle's i18n.js carries the Chinese dictionary only");
      assert(I.available().map((l) => l.id).join(",") === "zh-CN,en,ja",
        "…yet the picker still lists all three languages");
      // a saved choice read before its chunk must survive, or the next
      // saveSettings() would write it away
      assert(I.setLang("en") === "en" && !I.hasLang("en"), "setLang keeps a known language whose dictionary is not here yet");
      assert(I.t("app.title") === I.DICT["zh-CN"]["app.title"], "…and t() falls back to the Chinese meanwhile");
      assert(I.setLang("xx") === "zh-CN", "an unknown language is still the fallback");
      run("lang-en.js");
      I.setLang("en");
      assert(I.hasLang("en") && I.t("app.title") !== I.DICT["zh-CN"]["app.title"], "the English chunk, once here, is read without reloading i18n.js");
      run("lang-ja.js");
      for (const l of I.available()) {
        assert(I.hasLang(l.id) && I.DICT[l.id]["lang.name"] === l.name,
          "lang-ids.js names " + l.id + " as its dictionary does (" + l.name + ")");
      }
    }
    assert(/CHUNKS\.map/.test(syncSrc), "sync-dist.mjs takes the chunk list from the bundler, not a second copy");
    assert(fs.readFileSync(path.join(root, ".gitignore"), "utf8").includes("chunk-*.js"),
      "the generated chunks are gitignored like the bundle");

    // Every path that produces frontend/dist calls that one script. This is the
    // check that was missing: sync-dist.mjs learned about CHUNKS, and the three
    // shell copies that predate it (package.sh and the two build workflows) kept
    // naming bundle.js and engine-src.js by hand, so the packaged app would have
    // shipped without chunk-eco.js and lost every opening name. A guard on the
    // one script is not a guard on the product while three other copies exist.
    for (const rel of ["scripts/package.sh", ".github/workflows/build-macos.yml", ".github/workflows/build-windows.yml"]) {
      // named `wf` rather than the obvious short name: the register at the end
      // of this file counts a few variable names as app.js source-text
      // assertions, and a workflow file is not app.js.
      const wf = fs.readFileSync(path.join(root, rel), "utf8");
      assert(/node scripts\/sync-dist\.mjs/.test(wf), rel + " builds frontend/dist with sync-dist.mjs");
      const copies = wf.split("\n").filter((l) => !l.trim().startsWith("#") && /\bcp\b.*\b(bundle|engine-src)\.js/.test(l));
      assert(copies.length === 0, rel + " does not hand-copy the dist file list (found: " + copies.join(" | ") + ")");
    }
  }
}
