/**
 * The keyboard reference, the native menu and the live region (a11y.js).
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { build } from "../bundle.mjs";
import { assert, root, ctx, loadModule, allAppSource } from "./harness.mjs";

export async function run() {
  // The keyboard reference and the native menu. 1.9 moved the panel from Tab to
  // P and nothing anywhere said so — not a tooltip, not a menu, not a help sheet.
  // These lock in both halves of the fix and, more importantly, that they agree.
  {
    const appSrc = allAppSource;
    const htmlK = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const zon = fs.readFileSync(path.join(root, "app.zon"), "utf8");

    assert(/id="keys-modal"/.test(htmlK), "the shortcut sheet exists");
    // 6.1: the two tables live in native-commands.js and are exported as data,
    // so everything below reads the objects the app itself reads rather than a
    // regex over app.js's source (v6-plan Q1.7).
    loadModule(ctx, "src/web/js/native-commands.js");
    const NC = { KEY_HELP: ctx.KEY_HELP, MENU_ACCEL: ctx.MENU_ACCEL,
                 accelText: ctx.accelText, commandModes: ctx.commandModes,
                 create: ctx.createNativeCommands };
    assert(Array.isArray(NC.KEY_HELP), "the shortcut sheet is built from a table");
    const helpKeys = NC.KEY_HELP.map((r) => r.k);
    assert(helpKeys.length >= 10, "the sheet lists the shortcuts (" + helpKeys.length + ")");

    // every letter the global handler binds must appear in the sheet
    const sheetKeys = new Set(NC.KEY_HELP.flatMap((r) => r.keys).map((k) => k.toLowerCase()));
    for (const key of ["p", "n", "z", "h", "f"]) {
      assert(sheetKeys.has(key), "the sheet lists the " + key.toUpperCase() + " shortcut");
    }
    assert(/"\?"/.test(appSrc) && /openKeyHelp/.test(appSrc),
      "\"?\" opens the sheet — the one shortcut the sheet cannot teach");

    // and every language must be able to read it
    loadModule(ctx, "src/web/js/i18n.js");
    const dictK = ctx.ChessI18n.DICT;
    for (const lang of Object.keys(dictK)) {
      const missing = helpKeys.filter((k) => !(k in dictK[lang]));
      assert(missing.length === 0,
        lang + " translates the whole shortcut sheet" + (missing.length ? " (missing " + missing.join(", ") + ")" : ""));
    }

    // The native menu was declared-but-empty from 1.0 to 1.9: main.zig forwarded
    // menu commands to the page and app.zon defined no menus, so on a desktop
    // app the menu bar had nothing in it.
    // 1.18: the per-platform manifest. `close_policy = "hide"` is what macOS
    // wants and a *comptime error* on windows without a tray, so app.zon has to
    // stay portable and the macOS variant is derived from it. Both halves are
    // checked here, because getting either wrong breaks a platform build in CI
    // rather than in anything a test would otherwise notice.
    assert(!/close_policy/.test(zon),
      "app.zon stays portable — close_policy belongs in the derived macOS manifest, and \"hide\" here would fail the windows build at comptime");
    {
      const gen = path.join(root, "scripts/gen-manifest.mjs");
      assert(fs.existsSync(gen), "the manifest generator exists");
      const out = path.join(root, "build", "app.macos.test.zon");
      const r = spawnSync(process.execPath, [gen, "macos", "--out", "build/app.macos.test.zon"],
        { cwd: root, encoding: "utf8" });
      assert(r.status === 0, "the macOS manifest generates" + (r.status ? " — " + (r.stderr || "").trim() : ""));
      if (r.status === 0) {
        const mac = fs.readFileSync(out, "utf8");
        assert(/\.close_policy = "hide"/.test(mac), "the macOS manifest closes to hidden");
        // derived, not duplicated: everything else must survive verbatim.
        // Compared with line endings normalised — a Windows checkout is CRLF,
        // and this assertion is about content, not about newlines. (That the
        // generator must not *mix* the two is a separate claim, below.)
        const lf = (t) => t.replace(/\r\n/g, "\n");
        const stripped = lf(mac).replace(/^\/\/.*\n/gm, "").replace(/\s*\.close_policy = "hide",\n/, "\n");
        assert(stripped.trim() === lf(zon).replace(/^\/\/.*\n/gm, "").trim(),
          "the macOS manifest differs from app.zon by exactly the close policy");
        const crlf = (mac.match(/\r\n/g) || []).length;
        const bare = (mac.match(/(?<!\r)\n/g) || []).length;
        assert(crlf === 0 || bare === 0,
          "the derived manifest keeps one kind of line ending" +
          (crlf && bare ? ` — 混了 ${crlf} 个 CRLF 和 ${bare} 个 LF` : ""));
        fs.rmSync(out, { force: true });
      }
      // and the build has to be able to point at it
      const buildZig = fs.readFileSync(path.join(root, "build.zig"), "utf8");
      assert(/b\.option\(\[\]const u8, "manifest"/.test(buildZig), "build.zig takes -Dmanifest");
      assert(!/root_source_file = b\.path\("app\.zon"\)/.test(buildZig),
        "every manifest import goes through -Dmanifest, not a hardcoded app.zon");
      const macWf = fs.readFileSync(path.join(root, ".github/workflows/build-macos.yml"), "utf8");
      const winWf = fs.readFileSync(path.join(root, ".github/workflows/build-windows.yml"), "utf8");
      assert(/gen-manifest\.mjs macos/.test(macWf) && /-Dmanifest=build\/app\.macos\.zon/.test(macWf),
        "the macOS build compiles against the derived manifest");
      assert(/--manifest build\/app\.macos\.zon/.test(macWf),
        "and packages against it too — the exe and the bundle must agree");
      assert(!/gen-manifest|-Dmanifest/.test(winWf),
        "the windows build stays on app.zon, where close_policy is the default quit");
    }

    // No declared menu item may claim a key the macOS app menu already owns.
    // AppKit installs About/Hide/Hide Others/Show All/Quit *before* the declared
    // menus, and resolves a key equivalent by walking the tree in order — so a
    // collision does not merely lose, it silently does the system thing instead.
    // 引擎提示 sat on ⌘H from 1.10 to 1.17: the menu item was dead and the
    // keystroke hid the app.
    {
      const RESERVED = [
        { key: "h", mods: ["primary"], what: "系统的「隐藏应用」⌘H" },
        { key: "h", mods: ["primary", "option"], what: "系统的「隐藏其他」⌘⌥H" },
        { key: "q", mods: ["primary"], what: "系统的「退出」⌘Q" },
      ];
      const items = [...zon.matchAll(/\.key = "([^"]+)", \.modifiers = \.\{([^}]*)\}/g)].map((m) => ({
        key: m[1],
        mods: [...m[2].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort(),
      }));
      assert(items.length >= 6, "the menu items declare their keys (" + items.length + ")");
      const clash = [];
      for (const it of items) {
        for (const r of RESERVED) {
          if (it.key === r.key && it.mods.join("+") === r.mods.slice().sort().join("+")) clash.push(r.what);
        }
      }
      assert(clash.length === 0,
        "no menu item collides with a key the macOS app menu owns" + (clash.length ? " — 撞上了 " + clash.join("、") : ""));
    }

    assert(/\.menus = \.\{[\s\S]*?\.command = "/.test(zon), "app.zon declares native menu items");
    const commands = [...zon.matchAll(/\.command = "([a-z.]+)"/g)].map((m) => m[1]);
    assert(commands.length >= 6, "the menu carries the main actions (" + commands.length + ")");
    // Asked of the real handler map: build one against a recording app, fire
    // every command app.zon declares, and see that each one did something.
    const fired = [];
    const rec = (name) => (...a) => fired.push(name + (a.length ? ":" + a.join(",") : ""));
    // The smallest document the sheet can be built into: enough of a node for
    // appendChild / replaceChildren / classList, and nothing else.
    const fakeNode = (tag) => ({
      tag, kids: [], text: "", className: "", onclick: null,
      classList: {
        set: new Set(),
        contains(c) { return this.set.has(c); },
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
      },
      set textContent(v) { this.text = String(v); },
      get textContent() { return this.text; },
      appendChild(n) { this.kids.push(n); },
      replaceChildren() { this.kids.length = 0; },
    });
    const fakeDoc = () => {
      const byId = new Map();
      for (const id of ["keys-modal", "keys-list", "keys-close"]) byId.set(id, fakeNode(id));
      return { byId, getElementById: (id) => byId.get(id) || null, createElement: fakeNode };
    };
    const menuApp = (over) => Object.assign({
      doc: fakeDoc(), t: (k) => k,
      // the sheet is a dialog like any other: opening it is what puts "show" on
      // it, which is also how the module knows it is up
      Dlg: { open: (m) => { rec("dlg.open")(); m.classList.add("show"); },
             close: (m) => { rec("dlg.close")(); if (m) m.classList.remove("show"); } },
      store: { session: { mode: "ai" }, game: { flipped: false, viewIndex: 3 } },
      dialogOpen: () => false,
      requestNewGame: rec("game.new"), undo: rec("game.undo"), requestHint: rec("game.hint"),
      setFlipped: rec("setFlipped"), togglePanel: rec("view.panel"),
      setViewIndex: rec("setViewIndex"), escapeKey: rec("escapeKey"), go: rec("go"),
    }, over || {});
    const dead = [];
    for (const c of commands) {
      fired.length = 0;
      // every mode this command is legal in gets a turn, since the gate is
      // per-mode and "ai" alone would call a puzzle-only command dead
      for (const mode of [...NC.commandModes(c), "ai"]) {
        const app = menuApp({ store: { session: { mode }, game: { flipped: false, viewIndex: 3 } } });
        NC.create(app).run(c);
      }
      if (!fired.length) dead.push(c);
    }
    assert(dead.length === 0,
      "every menu item does something" + (dead.length ? " — dead: " + dead.join(", ") : ""));
    // v8-2-plan T4: 开局书 goes to the 棋谱库 page — from in front of a page too,
    // where the board's commands stay inert
    {
      fired.length = 0;
      NC.create(menuApp({ pageShown: () => true, store: { session: { mode: "puzzle" }, game: { flipped: false, viewIndex: 3 } } })).run("view.repertoire");
      NC.create(menuApp({ pageShown: () => true })).run("game.flip");
      assert(fired.join() === "go:library", "the 开局书 menu item opens the 棋谱库 page from any view (fired: " + (fired.join() || "nothing") + ")");
    }
    assert(/handlers\.shortcut/.test(fs.readFileSync(path.join(root, "src/web/js/host.js"), "utf8")),
      "the host bridge forwards the shortcut event");
    assert(/shortcut: \(detail\)/.test(appSrc), "app.js subscribes to it");
    // 5.2.1: Escape is a declared shortcut, because the AppKit shell never
    // delivered the raw key to the page — and the page runs the same routine
    // from either door, dialog gates included
    assert(/\.shortcuts = \.\{[\s\S]*?\.id = "view\.escape", \.key = "escape"/.test(zon),
      "app.zon declares Escape as the view.escape shortcut");
    // 6.1: asked of the handler, not of app.js's text. Escape is the one
    // command that has to get through with a dialog in front of it — it is how
    // the dialog closes — so fire it against an app that says a dialog is open
    // and watch escapeKey() run anyway.
    {
      fired.length = 0;
      NC.create(menuApp({ dialogOpen: () => true })).run("view.escape");
      assert(fired.join() === "escapeKey",
        "the shortcut runs escapeKey() before the dialog and mode gates (fired: " +
        (fired.join() || "nothing") + ")");
    }
    // …and the window's own Escape is checked by pressing it — see the a11y
    // block below, where the handler now lives.
    // 7.3 §3: escapeKey's three effects — close the top dialog, release a pinned
    // preview, shut the panel — were one source-text assertion asking that they
    // appear in that order in the file. All three are now pressed: the dialog
    // and the toast in test-board-e2e.mjs, the pinned preview and the panel in
    // test-review-e2e.mjs. `action` class, retired.

    // The shortcut sheet is the only screen that tells anyone what the keyboard
    // does, and for eight releases it did not mention a single one of the eight
    // accelerators the menu bar was offering. It does now, from MENU_ACCEL —
    // which is a *copy* of app.zon, because the page cannot read app.zon. So
    // hold the copy to the original in both directions: an accelerator the
    // manifest never declared is a lie printed on the help screen, and a menu
    // item missing from the table is a shortcut the help screen still hides.
    {
      const DISPLAY = { n: "N", z: "Z", h: "H", f: "F", "\\\\": "\\", "[": "[", "]": "]", "/": "/" };
      const declared = new Map();
      for (const m of zon.matchAll(/\.command = "([a-z.]+)", \.key = "([^"]+)", \.modifiers = \.\{([^}]*)\}/g)) {
        declared.set(m[1], {
          key: DISPLAY[m[2]] || m[2].toUpperCase(),
          mods: [...m[3].matchAll(/"([a-z]+)"/g)].map((x) => x[1]).sort().join("+"),
        });
      }
      assert(declared.size === commands.length,
        "every menu item declares a key (" + declared.size + "/" + commands.length + ")");
      assert(NC.MENU_ACCEL && Object.keys(NC.MENU_ACCEL).length,
        "native-commands.js carries the accelerator table the sheet prints");
      const listed = new Map();
      for (const [id, a] of Object.entries(NC.MENU_ACCEL)) {
        listed.set(id, { key: a.key, mods: [...a.mods].sort().join("+") });
      }
      const wrong = [];
      for (const [id, want] of declared) {
        const got = listed.get(id);
        if (!got) wrong.push(id + ": 表里没有");
        else if (got.key !== want.key || got.mods !== want.mods)
          wrong.push(id + ": app.zon 是 " + want.mods + "+" + want.key + "，表里写的是 " + got.mods + "+" + got.key);
      }
      for (const id of listed.keys()) if (!declared.has(id)) wrong.push(id + ": 表里有，app.zon 里没有");
      assert(wrong.length === 0,
        "the sheet's accelerators are app.zon's, exactly" + (wrong.length ? " — " + wrong.join("；") : ""));

      // …and the sheet has to actually print them: a table nothing reads is the
      // 1.18 close_policy shape all over again.
      // 6.1: asked of the sheet it actually builds. Render into a fake document
      // and look for the accelerator beside the letter — a table nothing reads
      // is the 1.18 close_policy shape all over again, and only a render can
      // tell the difference.
      {
        const app = menuApp({});
        NC.create(app).renderKeyHelp();
        const kbds = app.doc.byId.get("keys-list").kids.flatMap((n) => n.kids || []);
        const accels = kbds.filter((k) => k.className === "accel").map((k) => k.textContent);
        assert(accels.length >= 6 && accels.includes(NC.accelText("game.new", false)),
          "renderKeyHelp draws the accelerator (" + accels.length + " printed: " +
          accels.slice(0, 4).join(" ") + "…)");
      }
      assert(/kbd\.accel\s*\{/.test(fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8")),
        "…and it is styled");

      // Both doors, one gate. Every command the menu can fire has to be reachable
      // from KEY_HELP, because KEY_HELP is what says which modes it applies in —
      // a command with no row would be gated to nothing and silently dead.
      const ungated = [...declared.keys()].filter((c) => NC.commandModes(c).size === 0);
      assert(ungated.length === 0,
        "every menu command has a row saying which modes it belongs to" +
        (ungated.length ? " — 没有: " + ungated.join(", ") : ""));
      // Both gates, asked of the gate rather than of the two lines that spell
      // it. This used to be a regex over app.js matching `if (dialogOpen())`
      // followed by `if (!commandModes(id)…)`, with the line break written
      // `\s*` because an earlier version wrote `\n` and died on the Windows
      // job *after* the v2.3.0 tag and draft release already existed. A test
      // that can be broken by a line ending was never testing the gate. This
      // one fires the command and looks at what happened: ⌘N over a dialog and
      // ⌘F inside 做题 are the two measured defects the gate exists for.
      {
        const blocked = [];
        fired.length = 0;
        NC.create(menuApp({ dialogOpen: () => true })).run("game.new");
        if (fired.length) blocked.push("dialog gate: " + fired.join());
        fired.length = 0;
        NC.create(menuApp({ store: { session: { mode: "puzzle" }, game: { flipped: false, viewIndex: 3 } } }))
          .run("game.flip");
        if (fired.length) blocked.push("mode gate: " + fired.join());
        // …and the same command in a mode it belongs to still runs, so the two
        // gates are a gate and not a wall
        fired.length = 0;
        NC.create(menuApp({})).run("game.flip");
        if (fired.join() !== "setFlipped:true") blocked.push("ai mode: " + (fired.join() || "nothing"));
        assert(blocked.length === 0,
          "the native command passes the dialog gate and the mode gate before it runs" +
          (blocked.length ? " —— " + blocked.join("；") : ""));
      }
    }
  }

  // 6.1: the keyboard and the live region, asked of a11y.js rather than of
  // app.js's source (v6-plan Q1.7). Three of the guards below replace regexes
  // that matched the handler's text; the rest are new, because once the handler
  // is a function you can call, the things worth checking are what it does.
  {
    loadModule(ctx, "src/web/js/a11y.js");
    const createA11y = ctx.createA11y;
    const fired = [];
    const rec = (name) => (...a) => fired.push(name + (a.length ? ":" + a.join(",") : ""));
    const live = { textContent: "" };
    /** A board with a piece on e4 and nothing anywhere else. */
    const fakeGame = { get: (sq) => (sq === "e4" ? { color: "w", type: "p" } : null) };
    const a11yApp = (over) => Object.assign({
      doc: { body: {}, getElementById: (id) => (id === "board-live" ? live : null) },
      t: (k) => k, tf: (k, v) => k + "(" + v.join(",") + ")", draw: () => {},
      store: { session: { mode: "ai" }, ui: {}, game: { flipped: false, viewIndex: 4, selection: null } },
      viewGame: () => fakeGame,
      sanHistory: () => ["e4", "e5"],
      statusText: () => "status",
      onSquareClick: rec("click"),
      escapeKey: rec("escapeKey"),
      dialogOpen: () => false, promoOpen: () => false, confirmOpen: () => false,
      keyHelpOpen: () => false,
      openKeyHelp: rec("openKeyHelp"), closeKeyHelp: rec("closeKeyHelp"),
      finishPromotion: rec("finishPromotion"), finishConfirm: rec("finishConfirm"),
      togglePanel: rec("togglePanel"), toast: rec("toast"),
      startLearnTask: rec("startLearnTask"), learnUndo: rec("learnUndo"), learnHint: rec("learnHint"),
      startPuzzleAt: rec("startPuzzleAt"), nextPuzzle: rec("nextPuzzle"),
      showPuzzleAnswer: rec("showPuzzleAnswer"),
      setViewIndex: rec("setViewIndex"), undo: rec("undo"),
      requestNewGame: rec("requestNewGame"), requestHint: rec("requestHint"),
      setFlipped: rec("setFlipped"),
    }, over || {});
    const press = (key, over, extra) => {
      fired.length = 0;
      const app = a11yApp(over);
      createA11y(app).onKeyDown(Object.assign({ key, preventDefault() {}, target: {} }, extra || {}));
      return { fired: fired.join(), app };
    };

    // Escape is the first thing the handler looks at, and it runs the one
    // routine app.js keeps — the same routine the native view.escape shortcut
    // reaches. This was a regex over app.js for the literal line.
    assert(press("Escape").fired === "escapeKey",
      "…and the window's own Escape runs the same routine");

    // The F key is one of the three doors onto setFlipped, and the only one
    // that is a key. It is inert in the trainer, where the board is authored.
    assert(press("f").fired === "setFlipped:true", "F turns the board over");
    assert(press("f", { store: { session: { mode: "puzzle", puzzle: { cat: "tac", idx: 0 } },
                                 ui: {}, game: { flipped: false, viewIndex: 0, selection: null } } }).fired === "",
      "…and does nothing in 做题, where the board is the puzzle's");

    // A letter typed into a text field is text (v6-plan D8). The FEN box used
    // to be the only field and guarded itself; the guard lives in the handler.
    assert(press("n", null, { target: { tagName: "INPUT" } }).fired === "",
      "a letter typed into a field is text, not a shortcut");
    assert(press("n").fired === "requestNewGame", "…and the same letter outside one is the shortcut");

    // Nothing acts on the game from behind a dialog — except Escape, above.
    assert(press("z", { dialogOpen: () => true }).fired === "",
      "no game key reaches the board through a dialog");

    // "?" is the exception it has always been: it opens its own sheet, and
    // closes it again.
    assert(press("?").fired === "openKeyHelp", "\"?\" opens the shortcut sheet");
    assert(press("?", { keyHelpOpen: () => true }).fired === "closeKeyHelp", "…and closes it");

    // The live region. #board-live is the only place this app speaks to a
    // screen reader; the cursor keys are what write it.
    {
      const app = a11yApp({});
      const A = createA11y(app);
      A.announce("hello");
      assert(live.textContent === "hello", "announce() writes the live region");
      assert(A.describeSquare("e4") === "e4 · live.pieceW(piece.p)", "a square is named with what stands on it");
      assert(A.describeSquare("d4") === "d4 · live.empty", "…and an empty one says so");
      app.store.ui.keyboardCursor = "e4";
      A.moveCursor(1, 0);
      assert(app.store.ui.keyboardCursor === "f4", "the cursor follows the arrow key");
      assert(live.textContent === "f4 · live.empty", "…and the new square is announced");
      // arrows follow what the player sees, so they invert with the board
      app.store.game.flipped = true;
      A.moveCursor(1, 0);
      assert(app.store.ui.keyboardCursor === "e4", "a flipped board inverts the arrows");
    }
  }
}
