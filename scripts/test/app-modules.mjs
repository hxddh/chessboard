/**
 * Where app.js's regions went (v8-0-plan F4 and after): the symbol lookup,
 * app.js's ceiling, dependency order, and each region's module.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import { assert, joinModules, declarationIn, findSymbol, WEB_MODULES, srcOf, APP_MODULES } from "./harness.mjs";

export async function run() {
  // --- v8-0-plan F4: the lookup survives the move it exists for --------------
  //
  // The point of srcOf() and allAppSource is that cutting a function out of
  // app.js into a module of its own changes no check's answer. So do exactly
  // that, in memory: lift a real helper and a real constant out of the module
  // that holds them (app.js, as of this writing) into a new one, and ask again.
  // (Done for real on disk as well when this landed: castleRook moved to its own
  // file with an import, and this suite stayed green; the 7.9 suite against the
  // same tree failed "the rook's half of a castle is derived" and then threw on
  // the next line, so the 430 checks after it never ran.)
  {
    const moved = new Map(WEB_MODULES);
    const from = {};
    const shipped = [];
    for (const name of ["castleRook", "SHEET_QUERY"]) {
      const hit = findSymbol(WEB_MODULES, name);
      assert(!!hit, name + " is declared somewhere (" + (hit ? hit.file : "nowhere") + ")");
      if (!hit) continue;
      from[name] = hit.file;
      moved.set(hit.file, moved.get(hit.file).replace(hit.text, ""));
      shipped.push("export " + hit.text);
    }
    moved.set("f4-sample.js", shipped.join("\n\n") + "\n");
    for (const name of Object.keys(from)) {
      const hit = findSymbol(moved, name);
      assert(!declarationIn(moved.get(from[name]), name), name + ": after the move " + from[name] + " no longer declares it");
      assert(hit && hit.file === "f4-sample.js" && hit.text === srcOf(name),
        name + ": …and the lookup finds the same text in its new module (" + (hit ? hit.file : "nothing") + ")");
      assert(joinModules(moved).includes(srcOf(name)), name + ": …and so does every check reading allAppSource");
    }
    // the scanner's edges: a "}" in a string or a regex, default parameters,
    // `async`, and a member of the same name that is not the declaration
    const tricky = 'obj.f = 1;\nasync function f(a = { x: "}" }) {\n  return /"}/.test(a) ? "{" : `}`;\n}\nfunction g() {}\n' +
      "const K = { a: '}', b: [1, 2] };\nconst L = 2;\n";
    assert(declarationIn(tricky, "f") === 'async function f(a = { x: "}" }) {\n  return /"}/.test(a) ? "{" : `}`;\n}',
      "declarationIn skips braces inside strings and regex literals and keeps `async`");
    assert(declarationIn(tricky, "K") === "const K = { a: '}', b: [1, 2] };", "…and ends a binding at its own `;`");
    assert(declarationIn(tricky, "h") === "", "…and finds nothing for a name that is not declared");
  }

  // --- v9-0-plan §H: app.js may only shrink ---------------------------------
  //
  // A goal that nothing checks drifts. The ceiling is app.js's line count once
  // 9.0 had put down its history (M1), and it may only go down — lower it in
  // the PR that moves code out.
  {
    const APP_JS_LINE_CEILING = 5186; // 10.0: 5,744 → 5722; 13.0 E: → 5387 (app-state.js, about-ui.js); 14.0 E: → 5189 (save-slots.js, material-strip.js); 15.0 P: → 5186
    const lines = (WEB_MODULES.get("app.js").match(/\n/g) || []).length;
    assert(lines <= APP_JS_LINE_CEILING,
      "app.js only shrinks: " + lines + " lines (ceiling " + APP_JS_LINE_CEILING + "; move code out rather than in)");
  }

  // --- Codex on #88: a module is never handed a binding declared after it ----
  //
  // The F4 modules are created in app.js as createX({ …deps }). A dependency
  // named there but declared further down — a `const { name } = Later` — is read
  // before it exists: a TDZ throw at load under native ES modules, and under the
  // bundle (esbuild turns the top-level consts into vars) a silent `undefined`
  // the module keeps for good. evalScalar reached trainer/puzzles.js that way
  // once review/analysis.js had turned it from a hoisted function into a
  // destructured const. Later bindings go in as forwarders, `(x) => name(x)`.
  {
    const src = WEB_MODULES.get("app.js");
    const declAt = new Map();
    for (const m of src.matchAll(/^  (?:const|let) (\{[^}]*\}|[A-Za-z_$][\w$]*)\s*=/gm)) {
      const at = m.index;
      const names = m[1].startsWith("{")
        ? m[1].slice(1, -1).split(",").map((x) => x.trim().split(":").pop().trim()).filter(Boolean) : [m[1]];
      for (const n of names) if (!declAt.has(n)) declAt.set(n, at);
    }
    const hoisted = new Set([...src.matchAll(/^  (?:async )?function ([\w$]+)/gm)].map((x) => x[1]));
    const early = [];
    for (const m of src.matchAll(/^  (?:const [\w${}, ]+ = )?(create[A-Z]\w*)\(\{/gm)) {
      let i = m.index + m[0].length, depth = 1;
      const from = i;
      while (depth && i < src.length) { const c = src[i++]; if (c === "{") depth++; else if (c === "}") depth--; }
      let d = 0, cur = "";
      const parts = [];
      for (const c of src.slice(from, i - 1)) {
        if ("({[".includes(c)) d++;
        if (")}]".includes(c)) d--;
        if (c === "," && d === 0) { parts.push(cur); cur = ""; } else cur += c;
      }
      parts.push(cur);
      for (const part of parts) {
        const e = part.trim();
        const val = e.includes(":") ? e.split(":").slice(1).join(":").trim() : e;
        if (!/^[A-Za-z_$][\w$.]*$/.test(val)) continue;   // a forwarder or an expression
        const id = val.split(".")[0];
        if (hoisted.has(id) || !declAt.has(id)) continue;
        if (declAt.get(id) > m.index) early.push(m[1] + " ← " + id);
      }
    }
    assert(early.length === 0, "no F4 module is handed a binding app.js declares after creating it (" + (early.join(", ") || "none") + ")");
  }

  // --- v8-0-plan F4 (M2): the settings page lives in settings-ui.js ----------
  // The panel's settings code — the view that paints every segment and switch,
  // the theme, and the handlers behind them — is one module with its
  // dependencies handed in (createLibraryUI's shape). app.js keeps a one-line
  // door for each of the names the rest of it calls.
  {
    assert(WEB_MODULES.has("settings-ui.js") && WEB_MODULES.get("settings-ui.js").includes("export function createSettingsUI(d)"),
      "F4: settings-ui.js exports createSettingsUI(d)");
    assert(APP_MODULES.includes("settings-ui.js"), "F4: settings-ui.js follows app.js's house rules (APP_MODULES)");
    const app = WEB_MODULES.get("app.js");
    assert(!["theme-seg", "multipv-seg", "opt-blind"].some((id) => app.includes('getElementById("' + id + '")')),
      "F4: app.js no longer wires the settings page's controls");
  }

  // --- v8-0-plan F4 (M3): the review region lives in review/ --------------
  // Analysis, the review panel, 再试一次 and the eval graphs are modules under
  // review/, each with its dependencies handed in (createLibraryUI's shape).
  // app.js names what it still calls with one destructuring per module.
  {
    const REVIEW_OWNERS = {
      "review/eval-graph.js": ["judgeColours", "drawEvalBar", "evalText", "drawEvalCurve"],
      "review/retry.js": ["mistakeFacts", "writeWhy", "renderMistakeList", "renderWhyLine", "startRetry", "endRetry", "resetRetry", "retryModel", "retryClick", "retryMove", "renderRetry"],
      "review/panel.js": ["setAnalyzeUI", "sideRows", "renderReview", "worstDrill", "bankWorst", "renderReportCanvas", "exportReport"],
      "review/lines.js": ["engineArrowKey", "winLabel", "liveAllowed", "stopLiveAnalysis", "syncLiveAnalysis", "renderLiveAnalysis", "paintLive", "deskHead", "lineRows", "paintLineRow", "lineScore", "scalarLine", "reviewLines"],
      "review/analysis.js": ["evalScalar", "analysisFor", "SCAN_BUDGET", "analyzeGame", "analysesList", "fileAnalysis", "recallAnalysis", "restoreAnalysis", "plyLosses", "withMotifs", "accuracyFrom", "recordAccuracy"],
      "review/board-marks.js": ["engineArrows", "uciArrow", "bestArrowAt", "annotationAt"],
    };
    for (const [file, names] of Object.entries(REVIEW_OWNERS)) {
      assert(APP_MODULES.includes(file), "F4: " + file + " follows app.js's house rules (APP_MODULES)");
    }
  }

  // --- v8-0-plan F4 (M3): the trainer lives in src/web/js/trainer/ ----------
  // Lessons, puzzles, today's plan and the words they share are four factories
  // with their dependencies handed in (createLibraryUI's shape); app.js keeps
  // one destructuring door per module.
  {
    const homes = {
      "trainer/content.js": ["createTrainerContent", "puzzleName", "lessonText", "motifKeyOf"],
      "trainer/lessons.js": ["createLessonsUI", "startLesson", "learnMove", "syncLearnUI", "startClassic"],
      "trainer/puzzles.js": ["createPuzzlesUI", "puzzleMove", "syncPuzzleUI"],
      "trainer/today.js": ["createTodayUI", "dailySignals", "dailyJump", "renderPuzzleTally"],
      // v8-0-plan B5 (M4): the 我的 page grows in its own module
      "me-page.js": ["createMePage", "drawAccTrend", "renderAchRows"],
    };
    for (const [file, names] of Object.entries(homes)) {
      assert(APP_MODULES.includes(file), "F4: " + file + " follows app.js's house rules (APP_MODULES)");
    }
  }

  // --- v8-2-plan F1: trainer/puzzles.js split by what each part is for -------
  // The book, the ratings, the opening drills, the personal drills and the mate
  // searches are modules of their own; puzzles.js keeps the flow (seat, judge,
  // file, next), the way out into a game and the panel, and creates the parts
  // with their dependencies handed in. A new way to train is one more module
  // beside them (T2), not more lines in the 1,825 this file had.
  {
    const homes = {
      "trainer/puzzle-book.js": ["createPuzzleBook", "bookNow", "puzzlesInCat", "puzzleTier", "owedNow", "loadPuzzleState"],
      "trainer/puzzle-rating.js": ["createPuzzleRating", "ratePuzzleOnce", "playerRating", "markMissed", "clearMissed"],
      "trainer/puzzle-openings.js": ["createPuzzleOpenings", "opTreeMove", "opCurrent", "openingWhy"],
      "trainer/puzzle-mine.js": ["createPuzzleMine", "verifyAlt", "mineWhy", "renderPuzzleLine"],
      "trainer/puzzle-mate.js": ["whiteHasForcedMate", "blackForcedLost", "bestDefense"],
      "trainer/puzzles.js": ["createPuzzlesUI", "seatPuzzle", "puzzleMove", "puzzleSolved", "paintPuzzlePanel"],
    };
    for (const [file, names] of Object.entries(homes)) {
      // the mate searches are pure functions of a chess.js game, like runs.js
      // and themes.js: no factory, no bag, none of app.js's house rules to follow
      if (file !== "trainer/puzzle-mate.js") assert(APP_MODULES.includes(file), "F1: " + file + " follows app.js's house rules (APP_MODULES)");
    }
    const lines = WEB_MODULES.get("trainer/puzzles.js").split("\n").length;
    assert(lines <= 1000, "F1: trainer/puzzles.js is the trainer's middle, not the whole of it (" + lines + " lines)");
    // M1 评审: what the trainer hands app.js is the list the one file returned,
    // named one by one — a spread of the book would let app.js reach any of
    // its insides without anyone deciding it should
    // Windows checks the tree out with CRLF (the static job runs there too)
    const pz = WEB_MODULES.get("trainer/puzzles.js").replace(/\r\n/g, "\n");
    const ret = (pz.match(/\n  return \{\n([\s\S]*?)\n  \};\n\}\s*$/) || [])[1];
    const handed = (ret || "").replace(/closeThemes: \(\) => Modes\.closeThemes\(\)/, "closeThemes").split(/[\s,]+/).filter(Boolean).sort();
    const app = WEB_MODULES.get("app.js").replace(/\r\n/g, "\n");
    const taken = ((app.match(/const \{([^}]*)\} = PuzzlesUI;/) || [])[1] || "").split(/[\s,]+/).filter(Boolean)
      .concat([...app.matchAll(/PuzzlesUI\.(\w+)/g)].map((m) => m[1]));
    const spreads = (ret || "").match(/\.\.\.\w+/g) || [];
    assert(ret != null && !spreads.length && handed.join() === [...new Set(taken)].sort().join(),
      "F1: createPuzzlesUI returns exactly the names app.js takes from it, one by one (" +
      (ret == null ? "no return { … } found at the end of the file" : handed.length + " names" +
        (spreads.length ? ", spreads " + spreads.join(" ") : "")) + ")");
  }

  // --- v8-1-plan F3 (M4): the rest of app.js's regions, the same way --------
  // Files in and out (io.js) and the game's flow (game-controller.js) are one
  // factory each, with their dependencies handed in; app.js names what it still
  // calls with one destructuring per module. A module created before the one
  // it borrows from is handed forwarders (see the Codex on #88 check above).
  {
    const homes = {
      "io.js": ["createIO", "copyText", "pgnForExport", "exportText", "pickFromList", "importPgnText", "openPgnFile",
        "importLearningText", "exportAllData", "importAllDataText"],
      "game-controller.js": ["createGameController", "canTakeBack", "undo", "requestNewGame", "openNewGame", "startNewGame",
        "retryFromHere", "doResign", "recordOutcome", "coachAfterEngineReply", "doOfferDraw", "doClaimDraw", "gameResultToken",
        "adoptHeaderResult"],
    };
    for (const [file, names] of Object.entries(homes)) {
      assert(APP_MODULES.includes(file), "F3: " + file + " follows app.js's house rules (APP_MODULES)");
    }
  }
}
