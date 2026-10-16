/**
 * State that is let go of and held on to, free variables, imports read off the
 * global, and the renderer drawing every model shape.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { compileModuleSync } from "../bundle.mjs";
import { assert, root, Chess, loadModule, webJsFiles, allAppSource } from "./harness.mjs";

export async function run() {
  // --- state that has to be let go of, and state that has to be held on to ---
  // Three bugs of the same family, all invisible from the outside: something the
  // app remembers about "the current game" outlived the game, or something worth
  // remembering was dropped on the floor. Source-level guards, because each one
  // lives inside app.js's IIFE where a unit test cannot reach it.
  {
    const appSrc = allAppSource;
    const fn = (name) => {
      const i = appSrc.indexOf("function " + name + "(");
      if (i < 0) return "";
      let depth = 0;
      for (let k = appSrc.indexOf("{", i); k < appSrc.length; k++) {
        if (appSrc[k] === "{") depth++;
        else if (appSrc[k] === "}" && --depth === 0) return appSrc.slice(i, k + 1);
      }
      return "";
    };

    // The analyser must not ask chess.js whether the game is over: game_over()
    // is true at threefold and at 50 moves, both of which this app plays on
    // through, and every such ply was scored a flat 0.
    // comments stripped: the line explaining why game_over() is wrong here names
    // it, and would otherwise trip the check it exists to document
    const code = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    // v8-0-plan B2: the pass's walk over the positions moved to review-pass.js
    // runPass; analyzeGame calls it, and the rules below hold over both
    assert(/ChessReviewPass\.runPass\(/.test(fn("analyzeGame")), "analyzeGame runs the pass through review-pass.js");
    const analyze = code(fn("analyzeGame")) + code(fn("runPass"));
    assert(analyze.length > 0, "analyzeGame is still a named function");
    assert(!/\.game_over\(\)/.test(analyze),
      "the analyser never consults chess.js game_over()");
    assert(/Fide\.positionFinished\(/.test(analyze),
      "the analyser uses the app's own terminal rule");
    assert(/repSeen/.test(analyze),
      "the analyser counts repetitions itself, so it can tell fivefold from threefold");

    // A PGN is not a game identity: play the same seven moves twice in a session
    // and the second game inherited the first one's signature, which read as
    // "already recorded" and kept it out of the stats for good. Records carry an
    // issued id since 1.25 (缺陷 13), and the flag the game on the board holds is
    // "which record am I", so it still has to be cleared when the game is not
    // that game any more.
    for (const [where, src] of [["新局", fn("startNewGame")], ["清除存档", appSrc]]) {
      assert(src.length > 0, where + " is still there to check");
    }
    // v7-8-plan §4: requestNewGame() opens the dialog; the reset itself is startNewGame()
    const newGame = fn("startNewGame");
    assert(/recordedId = null/.test(newGame), "a new game is not the last game's record");
    assert(/analysis = null/.test(newGame), "a new game forgets the last game's analysis");
    const clearSave = appSrc.slice(appSrc.indexOf('Persist.clearAll()'));
    assert(/recordedId = null/.test(clearSave.slice(0, 900)),
      "clearing the save clears it too");
    // and the accuracy write-back must not hand its number to an older game that
    // happens to have been played the same way
    const rec = fn("recordAccuracy");
    assert(rec.length > 0 && !/g\.acc != null/.test(rec),
      "accuracy no longer needs the already-annotated heuristic — an id is exact");

    // A position set up but not yet played into is a real thing to keep.
    const load = fn("tryLoadSave");
    assert(/ChessPgn.*startFen/s.test(load), "the launch path can restore a movetext-free save");
    assert(/sanHistory\(\)\.length > 0 \|\| !!startFen\(\)/.test(load),
      "a custom starting position counts as something to resume");
    assert(/!sanHistory\(\)\.length && !startFen\(\)/.test(fn("saveToSlot")),
      "a slot accepts a set-up position with no moves yet");
    const imp = fn("importPgnText");
    assert(/ChessPgn.*startFen/s.test(imp), "importing accepts a position-only PGN");
  }

  // --- free variables: the one lint rule that would have saved 1.12 and 1.13 ---
  // `CHECK` was read in board.js and declared nowhere, so every check threw
  // inside draw() before a single piece was painted. Two versions shipped that
  // way because the assertions above are static and the stress sweeps never
  // produced a check.
  //
  // scripts/scope-check.mjs used to close that door by walking every file and
  // reporting identifiers read but never bound — the check a module system does
  // for free. The files are ES modules now: an unresolved name is either an
  // import that does not exist (a build error, below) or a genuine global. So
  // the rule survives as "the bundle builds", which is stricter — scope-check
  // could only see the names, the bundler has to actually resolve them.
  {
    let err = null;
    try { compileModuleSync(path.join(root, "src/web/js/app.js")); }
    catch (e) { err = e; }
    if (err) console.error("  " + (err.message || err));
    assert(!err, "no identifier is read without being bound (the bundle resolves)");
  }

  // --- the other half of that rule: a name that is imported is not also read
  // off the global object.
  //
  // The 1.25 conversion left two of these behind. board.js kept
  // `global.CHESS_PIECE_SVGS` and engine.js kept `global.ChessPersona` while both
  // files had just grown a real `import` for the same name — so the import was
  // live and the read was `undefined`, and neither the unit tests nor the six
  // browser checks noticed, because both call sites degrade quietly (glyph
  // fallback for the pieces, the plain engine move for the sparring style).
  // A silent fallback is the worst shape for this bug: nothing throws, the
  // product just gets a little worse. The bundle resolving cannot catch it —
  // `global.X` resolves fine, it is simply the wrong X.
  {
    const bad = [];
    const dir = path.join(root, "src/web/js");
    for (const f of webJsFiles(dir).filter((n) => n !== "bundle.js")) {
      const src = fs.readFileSync(path.join(dir, f), "utf8");
      const imported = new Set();
      for (const m of src.matchAll(/^import \{([^}]+)\} from/gm)) {
        for (const n of m[1].split(",")) imported.add(n.trim());
      }
      if (!imported.size) continue;
      for (const m of src.matchAll(/\b(?:global|window|globalThis)\.([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
        if (imported.has(m[1])) bad.push(`${f}: reads global.${m[1]}, but imports ${m[1]}`);
      }
    }
    for (const b of new Set(bad)) console.error("  " + b);
    assert(bad.length === 0, "no module reads a name off the global that it also imports");
  }

  // --- the renderer draws every model shape without throwing ---
  // The complement to the check above: that one proves the *names* resolve, this
  // one proves the *branches* run. draw() has nine optional fields — selection,
  // legal targets, last move, check, hint arrow, stars, flash, cursor, flip —
  // and the suite had never taken most of those branches at all. A recording
  // stub for the 2D context is enough: we are not checking pixels here, only
  // that every branch executes. Pixels are checked in the browser (e2e).
  {
    const calls = [];
    const stubCtx = new Proxy({}, {
      get(t, k) {
        if (k === "createRadialGradient") return () => ({ addColorStop: (o, c) => calls.push(["stop", o, c]) });
        if (k === "getImageData") return () => ({ data: new Uint8ClampedArray(4) });
        if (k === "measureText") return () => ({ width: 10 });
        if (typeof k === "string" && !(k in t)) return (...a) => calls.push([k, ...a]);
        return t[k];
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    const canvas = { width: 512, height: 512, getContext: () => stubCtx,
      getBoundingClientRect: () => ({ width: 512, height: 512 }) };

    const bctx = { console, Math, Object, Array, String, Number, JSON, Date, performance,
      isNaN, parseInt, parseFloat };
    bctx.globalThis = bctx;
    bctx.window = bctx;
    // no matchMedia and no Image: board.js must survive both (it guards for them)
    bctx.document = {
      documentElement: {},
      getElementById: () => null,
      createElement: () => canvas,
    };
    bctx.getComputedStyle = () => ({ getPropertyValue: () => "" });
    bctx.requestAnimationFrame = () => 0;
    vm.createContext(bctx);
    loadModule(bctx, "src/web/js/board.js");
    const View = bctx.ChessBoardView;
    assert(!!View, "board.js loads with no DOM");

    const g0 = new Chess("r1bqkb1r/pppp1ppp/2n2n2/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
    const position = g0.board();
    const base = () => ({ position, flipped: false, selected: null, legalTargets: [],
      lastMove: null, checkSquare: null, hintMove: null, stars: [],
      flashSquare: null, cursor: null });
    // v8-2-plan F3: until the shell shows a view, and while a page lies over
    // the board, a draw is owed, not made; uncovered, the board draws
    View.attach(canvas, base);
    View.draw();
    const owed = calls.length;
    View.cover(false);
    assert(owed === 0 && calls.length > 0, `F3: a covered board draws nothing, uncovered it draws (${owed} / ${calls.length} calls)`);
    calls.length = 0;
    const opts = {
      flipped: [true],
      selected: ["e4"],
      legalTargets: [["e5", "d5"]],
      lastMove: [{ from: "f1", to: "b5" }],
      checkSquare: ["e8"],
      hintMove: [{ from: "b5", to: "c6" }],
      stars: [["d4", "e4"]],
      flashSquare: ["d4"],
      cursor: ["a1"],
      // the drag became part of the model in 1.25 (P1.6) — it used to be pushed
      // in through setDrag(), which meant this sweep could not reach it at all
      drag: [{ from: "e2", x: 100, y: 100, over: "e4", legal: true },
             { from: "e2", x: 100, y: 100, over: "a8", legal: false }],
    };
    const shapes = [base()];
    for (const [k, vals] of Object.entries(opts))
      for (const v of vals) shapes.push({ ...base(), [k]: v });
    // every marker at once — the shape no real game reaches by accident
    const all = base();
    for (const [k, vals] of Object.entries(opts)) all[k] = vals[0];
    shapes.push(all);

    let drew = 0, threw = null, checkStops = 0;
    for (const m of shapes) {
      View.attach(canvas, () => m);
      try { View.draw(); drew++; }
      catch (e) { threw = threw || `${e.message} (model: ${JSON.stringify(m).slice(0, 90)}…)`; }
    }
    for (const c of calls) if (c[0] === "stop") checkStops++;
    assert(threw === null, "draw() survives all " + shapes.length + " model shapes" + (threw ? " — " + threw : ""));
    assert(drew === shapes.length, "drew " + drew + "/" + shapes.length + " shapes");
    // the branch that shipped broken twice: prove it painted, not just that it
    // did not throw. Three stops per check gradient (v7-7-plan §6: a hot core,
    // the token's strength a third of the way out, gone by the corners) on
    // two of the shapes.
    assert(checkStops === 6, "the check gradient painted on both shapes that set checkSquare (" + checkStops + " stops)");
    // and prove the marks come from the theme, not from constants in the file.
    // paintPiece is excluded on purpose: the men are pure black and white on
    // every board, which is both the convention and what keeps the outline
    // contrast assertion above 4.5:1 — a theme must not touch them.
    const src = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
    const draws = src.slice(src.indexOf("function draw("));
    const marks = draws.slice(0, draws.indexOf("function paintPiece("))
      + draws.slice(draws.indexOf("let dragPiece = null;"));
    const literals = marks.match(/(?:fillStyle|strokeStyle)\s*=\s*"(?:rgba?\(|#)/g) || [];
    assert(literals.length === 0, "every board mark is painted from a theme token (" + literals.length + " literal(s) left)");
  }
}
