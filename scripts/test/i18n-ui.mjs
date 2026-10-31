/**
 * i18n parity and use, the markup, and the house rules the interface code is
 * held to: dialogs, motion, the move list, toasts, components, storage.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { build } from "../bundle.mjs";
import { BOARDS as MARK_BOARDS } from "../lib/mark-colour.mjs";
import { assert, root, ctx, loadModule, WEB_JS, webJsFiles, WEB_MODULES, allAppSource, srcOf, allSourceExcept, appModuleEntries, scriptFiles } from "./harness.mjs";
import { han, untranslated } from "./lang.mjs";

export async function run() {
  // i18n: every key present in the base language must exist in the others, or
  // switching language would silently blank parts of the UI
  {
    loadModule(ctx, "src/web/js/i18n.js");
    const I = ctx.ChessI18n;
    const langs = I.available().map((l) => l.id);
    assert(langs.includes("zh-CN") && langs.length >= 2, "at least two languages (" + langs.join(",") + ")");
    const baseKeys = Object.keys(I.DICT["zh-CN"]);
    let missing = 0;
    for (const id of langs) {
      for (const k of baseKeys) {
        if (!(k in I.DICT[id])) { missing++; console.error("FAIL: " + id + " missing key " + k); }
      }
    }
    assert(missing === 0, "every language covers all " + baseKeys.length + " UI keys");
    I.setLang("en");
    assert(I.t("chrome.hint") === "Hint", "lookup follows the active language");
    // M5 review P3-5: the explorer row's count takes the plural form, as lib.count does
    assert(I.tf("xp.row", ["e4", 1, 100, 0, 0]).startsWith("e4: 1 game, ") && I.tf("xp.row", ["d4", 2, 50, 0, 50]).startsWith("d4: 2 games, "),
      "en xp.row says 1 game / 2 games (" + I.tf("xp.row", ["e4", 1, 100, 0, 0]) + ")");

    // First-run language detection. Until 1.7 the app always booted in Chinese,
    // so an English-locale newcomer met a Chinese first-run dialog and never saw
    // any of the translation work. A stored preference still wins — this is only
    // consulted when there is nothing saved at all.
    const det = (langs) => I.detectLang({ languages: langs, language: langs[0] || "" });
    assert(det(["en-US"]) === "en", "en-US picks English");
    assert(det(["en-GB", "zh-CN"]) === "en", "the first understood tag wins");
    assert(det(["zh-CN"]) === "zh-CN", "zh-CN picks Chinese");
    assert(det(["zh-TW"]) === "zh-CN", "any Chinese variant picks Chinese");
    assert(det(["ja-JP"]) === "ja", "ja-JP picks Japanese");
    assert(det(["ja"]) === "ja", "a bare ja tag picks Japanese");
    assert(det(["fr-FR"]) === "zh-CN", "an unsupported locale falls back to the base language");
    assert(det([]) === "zh-CN", "no locale information falls back");
    assert(I.detectLang({}) === "zh-CN", "a navigator with no language fields falls back");
    I.setLang("en");
    assert(I.t("nope.missing") === "nope.missing", "unknown keys fall back to the key itself");
    I.setLang("zh-CN");

    // Every key the markup references must exist, and no non-base language may
    // leave a Chinese string behind — v1.4 shipped the data-i18n-title mechanism
    // without ever using it, so 52 tooltips silently stayed Chinese in English.
    const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const referenced = new Set([
      ...[...html.matchAll(/data-i18n="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/data-i18n-title="([^"]+)"/g)].map((m) => m[1]),
      ...[...html.matchAll(/data-i18n-aria="([^"]+)"/g)].map((m) => m[1]),
    ]);
    let unknown = 0;
    for (const k of referenced) {
      if (!(k in I.DICT["zh-CN"])) { unknown++; console.error("FAIL: markup uses undefined key " + k); }
    }
    assert(unknown === 0, "all " + referenced.size + " keys used by index.html are defined");

    // --- a key may be written only once per dictionary -----------------------
    // The parity check above asks "does every key exist in every language", and
    // a duplicate makes that *more* true, not less — which is exactly how
    // tip.60–tip.64 sat in all three dictionaries twice from 1.20 to 1.25. The
    // later block won, so five controls showed another control's tooltip in all
    // three languages: 做题·防守 said "走子音效", 陪练风格·标准 said "重做本课任务",
    // and so on. The object literal itself cannot tell you — by the time it is
    // an object the loser is gone — so this reads the source text.
    {
      const src = fs.readFileSync(path.join(root, "src/web/js/i18n.js"), "utf8");
      // v8-0-plan F5: English and Japanese are files of their own now
      const blocks = src.split(/\n {4}(?:"zh-CN"|en|ja): \{\n/).slice(1)
        .concat(["i18n-en.js", "i18n-ja.js"].map((f) => fs.readFileSync(path.join(root, "src/web/js", f), "utf8")));
      const dups = [];
      blocks.forEach((blk, i) => {
        const lang = ["zh-CN", "en", "ja"][i] || "#" + i;
        const seen = new Set();
        // not line-anchored: several keys share a line in places, and a
        // duplicate hiding in the second half of one is exactly the shape that
        // shipped — tip.60–64 sat in a five-line block right under the block
        // they shadowed.
        for (const m of blk.matchAll(/"([a-zA-Z][\w.-]*)":/g)) {
          if (seen.has(m[1])) dups.push(lang + " defines " + m[1] + " twice");
          seen.add(m[1]);
        }
      });
      for (const d of dups) console.error("  " + d);
      assert(dups.length === 0, "no key is defined twice in any dictionary");
    }

    // --- and every key that is written is read somewhere ---------------------
    // The reverse direction of the check above. A numbered namespace could not
    // be proofread — `tip.62` tells you nothing about which control it belongs
    // to, so a stale key was indistinguishable from a live one and the only way
    // to find out was to change it and look. Semantic keys make the question
    // answerable, and this makes it answered: a key nobody reads is either dead
    // weight or a control that lost its label.
    {
      const sources = ["src/web/index.html", ...webJsFiles(WEB_JS)
        // the dictionaries define keys rather than read them; so do the chunks
        // built from them (v8-0-plan F5)
        .filter((f) => f.endsWith(".js") && f !== "bundle.js" && !/^i18n(-\w+)?\.js$/.test(f) && !f.startsWith("chunk-"))
        .map((f) => "src/web/js/" + f)]
        .map((f) => fs.readFileSync(path.join(root, f), "utf8")).join("\n");
      //
      // Some keys are only ever built, never written out: `t("themeName." + id)`,
      // `t("piece." + type)`, `t("pz.n." + n)`. A key counts as read when its
      // full text appears, or when any dotted prefix of it appears as a string
      // literal — which is as close as a text scan gets to following the
      // concatenation, and errs towards keeping a key rather than deleting a
      // live one.
      const prefixes = new Set([...sources.matchAll(/["']([a-zA-Z][\w.]*\.)["']/g)].map((m) => m[1]));
      const read = (k) => sources.includes(k) ||
        k.split(".").map((_, i, a) => a.slice(0, i + 1).join(".") + ".").some((p) => prefixes.has(p));
      const unused = Object.keys(I.DICT["zh-CN"]).filter((k) => !read(k) && k !== "lang.name");
      for (const k of unused) console.error("  unread key: " + k);
      assert(unused.length === 0, "every one of the " + baseKeys.length + " keys is read by some control");
    }

    // --- v8-2-plan F4: a sentence is one key, never glued from pieces ---------
    // `t("learn.lessonPre") + n + t("learn.lessonPost")` only reads right in a
    // language that puts the number where Chinese does. v8-0-plan §6 counted 25
    // of them; F4 made each a whole-sentence key read with tf(), and labels side
    // by side go through tdot() (src/web/js/tdot.js), whose separator is a key
    // too. scripts/lib/i18n-concat.mjs is the scanner: `+` / `+=` touching an
    // i18n call, an i18n call inside a template's `${}`, translated fragments
    // `.join()`ed. Sources are CRLF on a Windows checkout; it normalises first.
    {
      const { findConcats, callEnds } = await import("../lib/i18n-concat.mjs");
      const { F4_RENDERS } = await import("../lib/i18n-f4-renders.mjs");
      // Every entry here is a place that may still glue translated text, with
      // the reason it may. Keep it short, and say why.
      const ALLOWED = [
        // the row's memo key (reconcile): compared, never shown
        'library-page.js: (g) => [store.ui.langId, g.src === "local" ? localLabel(g) : d.libraryLabel(g) + LibraryQuery.siteOf(g), subOf(g),',
        // a list entry's tick, number and length around the puzzle's name: marks, not words
        'trainer/puzzles.js: b.textContent = (store.session.puzzleState.solved[p.id] ? "✓ " : "") + (i + 1) + ". " + puzzleName(p) + (len && "  " + len);',
      ];
      const hits = [];
      for (const [file, text] of WEB_MODULES) {
        for (const h of findConcats(text)) {
          if (!ALLOWED.includes(file + ": " + h.text)) hits.push(file + ":" + h.line + " [" + h.kind + "] " + h.text);
        }
      }
      for (const h of hits) console.error("  glued: " + h);
      assert(hits.length === 0, "8.2 F4: no interface text is glued together from translations (" + hits.length + " places)");

      // …and it does catch them. The shapes it has to see, and the ones it must
      // not (a "+" in a message, a comment or a regex; arithmetic in tf's own
      // values; a method that only shares the name), in LF and in CRLF.
      const red = [
        'x = t("a") + n;', 'x = n + t("a");', 'x += tf("a", [1]);', 'x = `${t("a")} ${n}`;',
        'x = [t("a"), n].join(" · ");', 'x = [n, tf("a", [1])].filter(Boolean).join(" · ");',
        'const ps = [];\nps.push(t("a"));\nx = ps.join(" · ");', 'x = I18n.t("a") + n;',
        'x = sideName(s) + " · " + n;', 'x = tdot(a, b) + "…";',
        // M3 评审: a group with a translation in it, .concat, a name taken
        // straight from one, a module's own wrapper (and trainer/visual-modes.js's w)
        'x = (a ? tf("a", [1]) : tf("b", [2])) + " · " + n;', 'x = res + " · " + (foe || t("a"));', 'x = t("a").concat(n);',
        'x = n.concat(" · ", t("a"));', 'function f() { const res = won ? t("w") : t("l");\n  return res + " · " + n; }',
        'function lab(r) { return tdot(t("a"), r); }\nx = lab(r) + " · " + n;', 'const sw = (c) => w(c);\nx = sw("b") + " " + n;',
        'x = w("nth", [1, 2]) + " · " + n;',
        // v8-3-plan F3: the same name, reached by the data flow of one scope —
        // assigned later, second in a declaration list, in parentheses, copied
        // to another name, and glued with a template instead of `+`
        'function f() { let s;\n  if (a) s = t("a"); else s = t("b");\n  return s + n; }', 'function f() { let a = 1, s = t("a");\n  return s + n; }',
        'function f() { const s = (a ? t("a") : t("b"));\n  return s + n; }', 'function f() { const s = t("a");\n  const u = s;\n  return u + n; }',
        'function f() { const s = t("a");\n  const u = n || s;\n  el.title = u + n; }', 'function f() { const s = t("a");\n  return `${s} ${n}`; }',
        // an inner block's own `s` ends with the block; the outer one is back after it
        'function f() { const s = t("a");\n  if (a) { const s = 1; g(s + n); }\n  return s + n; }',
        'function f() { const s = t("a");\n  { const s = t("b"); g(s + n); } }',
      ];
      const green = [
        'x = "t(\\"a\\") + n";', '// t("a") + n', 'x = /t\\("a"\\) \\+/.test(s);', 'x = tf("a", [n + 1]);',
        'x = o.t("a") + n;', 'x = tdot(t("a"), n);', 'x = [t("a"), n].join(t("ui.dot"));',
        'function f() { const ls = [t("a")]; g(ls); }\nfunction g(ls) { return ls.join("\\n"); }',
        'x = (n + 1) + " · " + m;', 'const res = f(t("a"));\nx = res + n;', 'const res = t("a");\nx = res.length + 1;',
        'function f() { const res = t("a"); }\nfunction g() { return res + n; }', 'x = [a].concat(b);',
        // v8-3-plan F3: a name tested, measured or handed on is not the text
        'function f() { const s = t("a");\n  const k = s ? 1 : 2;\n  return k + n; }', 'function f() { const s = t("a");\n  const k = s.length;\n  return `${k}` + n; }',
        'function f() { let s;\n  s = g(t("a"));\n  return s + n; }', 'function f() { let s;\n  s = t("a"); }\nfunction g() { let s = 0;\n  return s + 1; }',
        'const f = (s) => t(s);\nx = `${n}`;',
        // Codex review on #105: an inner declaration of the same name is another binding
        'let s; s = t("a"); { const s = 1; x = s + n; }', 'function f() { const s = t("a");\n  for (const s of xs) g(s + 1); }',
        'function f() { const s = t("a");\n  for (let s = 0; s < 3; s++) { g(s + 1); } }',
      ];
      const crlf = (s) => s.replace(/\n/g, "\r\n");
      assert(red.every((s) => findConcats(s).length > 0 && findConcats(crlf(s)).length > 0),
        "8.2 F4: the guard goes red on each way of gluing (" + red.filter((s) => !findConcats(s).length).join(" | ") + ")");
      assert(green.every((s) => findConcats(s).length === 0 && findConcats(crlf(s)).length === 0),
        "8.2 F4: …and stays green on what is not (" + green.filter((s) => findConcats(s).length).join(" | ") + ")");
      // The real sources: put `+ " · "` back after every translated call in
      // every module, the way 8.1 wrote them, and every one is reported.
      let calls = 0, caught = 0;
      for (const [, text] of WEB_MODULES) {
        const src = text.replace(/\r\n/g, "\n");
        const ends = callEnds(src).sort((a, b) => a - b);   // an outer call ends after its inner ones
        if (!ends.length) continue;
        let glued = "";
        ends.forEach((at, i) => { glued += src.slice(i ? ends[i - 1] : 0, at) + ' + " · "'; });
        glued += src.slice(ends[ends.length - 1]);
        calls += ends.length;
        caught += Math.min(ends.length, findConcats(crlf(glued)).length);
      }
      assert(calls > 500 && caught === calls,
        "8.2 F4: putting a `+` after any of the " + calls + " translated calls turns the guard red (" + caught + " caught)");

      // A fragment key is the dictionary's half of a concatenation — 「已导出 」
      // waiting for a name, " 局精准度" for what comes before it. None is left:
      // no value starts or ends with a space, in any language (the separators
      // are the exception they look like).
      const SEPARATORS = new Set(["ui.dot", "rv.dot"]);
      const frags = [];
      for (const id of langs) {
        for (const [k, v] of Object.entries(I.DICT[id])) {
          if (!SEPARATORS.has(k) && typeof v === "string" && (v === "" || /^\s|\s$/.test(v))) frags.push(id + " " + k + ": " + JSON.stringify(v));
        }
      }
      for (const f of frags) console.error("  fragment key: " + f);
      assert(frags.length === 0, "8.2 F4: no dictionary entry is a sentence fragment (" + frags.length + ")");

      // What people read did not change: every converted site's new expression,
      // in all three languages, against what the old concatenation rendered.
      loadModule(ctx, "src/web/js/tdot.js");
      const diff = (id) => I.t("diff." + id);
      const changed = [];
      ["zh-CN", "en", "ja"].forEach((id, li) => {
        I.setLang(id);
        for (const row of F4_RENDERS) {
          const got = row[1](I.t, I.tf, ctx.tdot, diff);
          if (got !== row[2 + li]) changed.push(id + " " + row[0] + ": " + JSON.stringify(got) + " (was " + JSON.stringify(row[2 + li]) + ")");
        }
      });
      I.setLang("zh-CN");
      for (const c of changed) console.error("  changed: " + c);
      assert(changed.length === 0, "8.2 F4: the " + F4_RENDERS.length + " converted sentences read exactly as before in zh-CN, en and ja");
    }

    // --- v15-0-plan S1: one name per action, in all three languages ---
    // The review was 复盘, 分析, 精析 and 持续分析 (Review / Analyse / Live
    // analysis, 振り返り / 解析 / 検討): one word for looking back over a
    // game, one for the engine on the board. A new game had five labels and
    // "again" six; each now has the names the plan gives it.
    {
      const old = { "zh-CN": /分析|精析|下一盘|重做|新局(?!面)/, en: /[Aa]naly[sz]/, ja: /解析|検討|新規/ };
      const stray = [];
      for (const id of ["zh-CN", "en", "ja"]) {
        for (const [k, v] of Object.entries(I.DICT[id])) if (old[id].test(v)) stray.push(id + " " + k + ": " + v.slice(0, 40));
      }
      for (const x of stray) console.error("  old word: " + x);
      assert(stray.length === 0, "15.0 S1: no 分析 / 精析 / 下一盘 / 重做 / 新局, Analyse, 解析 / 検討 / 新規 left in the dictionaries (" + stray.length + ")");
      const names = {
        "chrome.new": ["新对局", "New game", "新しい対局"], "keys.new": ["新对局", "New game", "新しい対局"], "today.newGame": ["新对局", "New game", "新しい対局"],
        "go.again": ["再来一盘", "Play again", "もう一局"],
        "act.restart": ["重来", "Restart", "やり直す"], "act.puzzleRetry": ["重来", "Restart", "やり直す"],
        "rv.retry": ["再试一次", "Try again", "もう一度"],
        "act.analyze": ["复盘", "Review", "振り返る"], "act.deep": ["精细复盘", "Deep review", "精密な振り返り"], "act.live": ["实时引擎", "Live engine", "エンジン常時表示"],
      };
      const off = [];
      ["zh-CN", "en", "ja"].forEach((id, li) => { for (const [k, want] of Object.entries(names)) if (I.DICT[id][k] !== want[li]) off.push(id + " " + k + ": " + I.DICT[id][k]); });
      for (const x of off) console.error("  name: " + x);
      assert(off.length === 0, "15.0 S1: new game, play again, restart, try again, review, deep review and live engine have one name each (" + off.length + ")");
    }

    // --- v8-3-plan T4: English counts that can be 1 take tf's {n:one|other} ---
    // Each key renders its count with 1 and with 2 (the other values fixed).
    // Chinese and Japanese do not inflect: their entries keep bare {n}, so they
    // read exactly as a plain substitution would.
    {
      const PLURALS = [
        ["stats.gamesN", (n) => [n], "1 game", "2 games"],
        ["msg.learning.imported", (n) => [n], "Merged — the personal book now holds 1 drill", "Merged — the personal book now holds 2 drills"],
        ["pz.goalOp", (n) => ["Italian", n], "Italian · play the book line as White for 1 move", "Italian · play the book line as White for 2 moves"],
        ["pz.goalOpB", (n) => ["Italian", n], "Italian · answer the book line as Black for 1 move", "Italian · answer the book line as Black for 2 moves"],
        ["pz.moveN", (n) => [n], "1 move", "2 moves"],
        ["dlg.retryHere", (n) => [5, n], "Resume from move 5; what follows (1 move) stays as a variation. Continue?", "Resume from move 5; what follows (2 moves) stays as a variation. Continue?"],
        ["aria.cal", (n) => [18, n], "Played or solved on 1 day in the last 18 weeks", "Played or solved on 2 days in the last 18 weeks"],
        ["me.m.clockV", (n) => [n, n, "4%"], "1 blunder in 1 move on a low clock · 4% otherwise", "2 blunders in 2 moves on a low clock · 4% otherwise"],
        ["msg.analysis.kept", (n) => [n], "Review stopped · kept the first 1 ply", "Review stopped · kept the first 2 plies"],
        ["rep.removeAsk", (n) => ["e4", "White", n, 1], "Take e4 out of your repertoire (White)? 1 line through it will be cut short, 1 of them removed entirely. You can undo this afterwards.",
          "Take e4 out of your repertoire (White)? 2 lines through it will be cut short, 1 of them removed entirely. You can undo this afterwards."],
        ["lib.addedNone", (n) => [n], "Nothing added: the file's 1 game was already in the library", "Nothing added: the file's 2 games were already in the library"],
        ["diag.peakRange", (n) => [1, 40, n], "The chart covers moves 1–40; its tallest bar is 1 game.", "The chart covers moves 1–40; its tallest bar is 2 games."],
        ["live.selectedN", (n) => ["e2", n], "Selected e2 · 1 legal move", "Selected e2 · 2 legal moves"],
        ["theme.sub", (n) => [n, 0], "1 puzzle · 0 answered", "2 puzzles · 0 answered"],
        ["theme.count", (n) => [n], "1 theme", "2 themes"],
      ];
      const wrong = [];
      for (const id of ["zh-CN", "en", "ja"]) {
        I.setLang(id);
        for (const [k, vals, one, two] of PLURALS) {
          for (const n of [1, 2]) {
            const got = I.tf(k, vals(n));
            const want = id === "en" ? (n === 1 ? one : two)
              : I.DICT[id][k].replace(/\{(\d+)\}/g, (m, i) => String(vals(n)[Number(i)]));
            if (got !== want || (id !== "en" && /\{\d+:/.test(I.DICT[id][k]))) wrong.push(id + " " + k + "(" + n + "): " + JSON.stringify(got));
          }
        }
      }
      I.setLang("zh-CN");
      for (const w of wrong) console.error("  plural: " + w);
      assert(wrong.length === 0, "8.3 T4: the " + PLURALS.length + " English counts say 1 game / 2 games; zh-CN and ja unchanged");
    }

    // Coordinates belong on the frame, not on a1/h1 where they were painted over
    // the rooks. The gutters are DOM, so the canvas must not draw them any more.
    {
      const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/function drawCoords\(/.test(boardSrc), "the frame gutters are filled from board.js");
      assert(!/fillText\(\s*(fileChar|rankChar)/.test(boardSrc),
        "no coordinate is painted inside a square any more");
      assert(/id="coord-files"/.test(html) && /id="coord-ranks"/.test(html),
        "both coordinate gutters exist in the markup");
    }

    // Keyboard access: Tab must reach the controls, and focus must be visible.
    {
      const appSrc2 = allAppSource;
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      // 1.8 bound Tab to the panel and called preventDefault, so focus could not
      // move anywhere by keyboard — the board had a full keyboard cursor and no
      // way to reach a single other control.
      const hijack = /ev\.key === "Tab"[^\n]*preventDefault/.test(appSrc2);
      assert(!hijack, "Tab is left to the browser for focus navigation");
      assert(/:focus-visible\s*\{[^}]*outline:\s*2px/.test(css),
        "a visible focus ring is defined for keyboard users");
    }

    // Dialogs. Freeing Tab in 1.9 made "walk out of an open dialog" reachable
    // for the first time; on the shipped build focus left the FEN dialog after
    // 4 presses, the slots and confirm dialogs after 1, and none of the six
    // carried aria-modal. These guard the module that fixed it and the two
    // call-site mistakes that caused the worst of it.
    {
      const dlgPath = path.join(root, "src/web/js/dialog.js");
      assert(fs.existsSync(dlgPath), "the shared dialog module exists");
      const dlg = fs.readFileSync(dlgPath, "utf8");
      // v8-0-plan F4: every module but dialog.js, which is the helper itself
      const appSrc3 = allSourceExcept("dialog.js");
      assert(/aria-modal/.test(dlg), "dialog.js sets aria-modal while a dialog is open");
      assert(/function handleTab/.test(dlg) && /shiftKey/.test(dlg),
        "dialog.js wraps Tab in both directions");
      assert(/handleTab\(ev\)/.test(appSrc3), "app.js installs the Tab wrap");

      // Every dialog must go through the helper. A stray classList.add("show")
      // is a dialog with no focus trap, no aria-modal and no focus return —
      // exactly the state all six were in before 1.10. The toast is not a
      // dialog and uses the same class, so it is the one allowed exception.
      const strays = [...appSrc3.matchAll(/^.*classList\.(?:add|remove)\("show"\).*$/gm)]
        .map((m) => m[0].trim())
        .filter((line) => !/toastTimer|el\.classList/.test(line));
      assert(strays.length === 0,
        "every dialog opens and closes through ChessDialog" +
        (strays.length ? " — stray: " + strays[0] : ""));

      // The FEN field swallowed *every* keydown so board shortcuts would not
      // fire while typing a position. Escape and Tab are not shortcuts; eating
      // them made the dialog's own auto-focused control the one place it could
      // not be dismissed from.
      const fenGuard = /if \(ev\.key !== "Escape" && ev\.key !== "Tab"\) ev\.stopPropagation\(\);/;
      assert(fenGuard.test(appSrc3), "the FEN field lets Escape and Tab through");
    }

    // v8-0-plan A5: the one curve reaches the canvas. board.js eased its slide
    // with a quadratic of its own (1 − (1 − t)²) beside the stylesheet's
    // cubic-bezier, so a piece and the panel next to it moved on two curves.
    // Now the canvas reads --ease and eases through motion.js's lookup table:
    // no easing formula in board.js, every timed effect through ease(), and
    // the table is the stylesheet's curve — checked against an independent
    // solve of the same Bézier.
    {
      const board = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(!/const easeOut|1 - \(1 - t\) \* \(1 - t\)|t \* \(2 - t\)/.test(board),
        "the canvas has no easing curve of its own (no quadratic easeOut)");
      assert(/from "\.\/motion\.js"/.test(board) && /getPropertyValue\("--ease"\)/.test(board),
        "…it reads --ease and eases through motion.js");
      // every animation's progress — (now − x.start) / its length — goes through ease()
      const timed = board.split("\n").filter((l) => /\(now - _?\w+(\.\w+)?\.start\) \//.test(l) && !/function fxAt/.test(l));
      const bare = timed.filter((l) => !/ease\(/.test(l));
      assert(timed.length >= 2 && bare.length === 0,
        "every timed canvas effect is eased on that curve (" + timed.length + " sites" + (bare.length ? "; bare: " + bare.map((l) => l.trim()).join(" | ") : "") + ")");
      const fx = /function fxAt\(f, ms, now\) \{([^}]*)\}/.exec(board);
      assert(!!fx && !/ease/.test(fx[1]), "fxAt is the linear progress; its callers ease it");
      const fxUses = [...board.matchAll(/fxAt\(/g)].length - 1;
      const fxEased = [...board.matchAll(/ease\(fxAt\(/g)].length + [...board.matchAll(/Math\.sin\(Math\.PI \* ease\(pp\)\)/g)].length;
      assert(fxUses >= 4 && fxEased === fxUses, "…and every fxAt() progress is eased too (" + fxEased + " of " + fxUses + ")");
      // the table is the curve
      loadModule(ctx, "src/web/js/motion.js");
      const M = ctx.ChessMotion;
      const cssE = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const decl = /--ease:\s*([^;]+);/.exec(cssE);
      const v = M && decl ? M.parseBezier(decl[1]) : null;
      assert(!!v && v.length === 4, "--ease is a cubic-bezier the canvas can read (" + (decl && decl[1]) + ")");
      if (v) {
        const e = M.easeFromCss(decl[1]);
        const bz = (a, b, u) => 3 * a * u * (1 - u) * (1 - u) + 3 * b * u * u * (1 - u) + u * u * u;
        let worst = 0;
        for (let i = 0; i <= 40; i++) {
          const t = i / 40;
          let lo = 0, hi = 1;
          for (let k = 0; k < 60; k++) { const mid = (lo + hi) / 2; if (bz(v[0], v[2], mid) < t) lo = mid; else hi = mid; }
          worst = Math.max(worst, Math.abs(e(t) - bz(v[1], v[3], (lo + hi) / 2)));
        }
        assert(worst < 0.003, "the canvas curve is the stylesheet's curve (max error " + worst.toFixed(5) + " < 0.003)");
        assert(e(0) === 0 && e(1) === 1, "…and it starts and ends exactly");
      }
      // reduced motion stops every one of them: no effect starts, so no frame is drawn for it
      const notes = /function noteChanges\(m, now\) \{([\s\S]*?)\n  \}/.exec(board);
      assert(!!notes && (notes[1].match(/!_reduceMotion \?/g) || []).length === 3,
        "reduced motion: none of the three board effects (lift, check pulse, badge) starts");
    }

    // "Reduce motion" is an accessibility setting, and it says *reduce*.
    // 1.9 honoured it with one rule against 25 animated declarations; 1.10
    // over-corrected and flattened all 25, including twelve that only cross-fade
    // a colour and carry state meaning. Both directions get a guard.
    {
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const block = /@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/.exec(css);
      assert(block, "there is a prefers-reduced-motion block");
      assert(/\*,\s*\*::before,\s*\*::after/.test(block[1]),
        "reduced motion applies to everything, not a hand-listed subset");
      assert(/animation-duration:[^;]*!important/.test(block[1]),
        "reduced motion stops keyframe animations");
      // the override is on the property list, so motion is dropped and colour
      // survives — a blanket transition-duration would take both
      const props = /transition-property:([^;]*)!important/.exec(block[1]);
      assert(props, "reduced motion narrows transition-property rather than killing duration");
      assert(!/transition-duration:[^;]*!important/.test(block[1]),
        "colour fades keep their own duration");
      const kept = props[1].split(",").map((p) => p.trim()).filter(Boolean);
      for (const safe of ["color", "background-color", "border-color", "opacity"]) {
        assert(kept.includes(safe), "colour/opacity fades survive reduced motion (" + safe + ")");
      }
      for (const moving of ["transform", "width", "height", "padding", "all"]) {
        assert(!kept.includes(moving), "reduced motion drops " + moving);
      }
    }

    // Motion on a chess board should answer one question: what changed that I
    // did not do myself? Up to 1.10 the rule was the opposite — every move the
    // player made was animated (a dragged piece even snapped back to its origin
    // and slid forward again), while three of the four opponent replies appeared
    // instantly. These lock the direction in.
    {
      const appSrc = allAppSource;
      assert(/function animateReply\(mv\)/.test(appSrc),
        "opponent replies go through one helper");
      // nothing may call the raw animator except that helper — a direct call is
      // how the player's own move got animated in the first place
      const raw = [...appSrc.matchAll(/^.*BoardView\.animateMove\(.*$/gm)].map((m) => m[0].trim());
      // (7.7 §9 added a fourth argument, the captured man who fades out under the
      // reply; the call is still the one, in the one place)
      assert(raw.length === 1 && /animateMove\(mv\.from, mv\.to, castleRook\(mv\), taken\)/.test(raw[0]),
        "the board animator has exactly one caller, inside animateReply" +
        (raw.length === 1 ? "" : " — extra: " + raw.join(" ;; ")));
      // and every opponent-reply site must use it
      const replies = (appSrc.match(/animateReply\(/g) || []).length - 1; // minus the definition
      assert(replies >= 4,
        "all four opponent-reply paths animate (engine game, lesson drill, " +
        "scripted puzzle line, mate-puzzle defence) — found " + replies);

      // castling moves two men; chess.js reports only the king's
      assert(/function castleRook\(mv\)/.test(appSrc), "the rook's half of a castle is derived");
      const rook = srcOf("castleRook");
      assert(/"h" \+ rank/.test(rook) && /"f" \+ rank/.test(rook), "king-side rook h→f");
      assert(/"a" \+ rank/.test(rook) && /"d" \+ rank/.test(rook), "queen-side rook a→d");

      const boardSrc2 = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/_anim\.segs/.test(boardSrc2), "the animator carries a list of segments, not one pair");
    }

    // Toggling the panel can change the board's size a great deal — measured
    // across window shapes: +5% at 1100x900, +20% at 1000x900, +84% at
    // 1000x1000. Watching the board grow by that much is worse than finding it
    // bigger, so the size change must not be transitioned.
    {
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const wrap = /#board-wrap \{[\s\S]*?\n    \}/.exec(css);
      assert(wrap, "found the #board-wrap rule");
      const tr = /transition:([^;]*);/.exec(wrap[0]);
      if (tr) {
        for (const p2 of ["width", "height"]) {
          assert(!new RegExp("\\b" + p2 + "\\b").test(tr[1]),
            "the board's " + p2 + " is not animated when the panel toggles");
        }
      }
      // the stage's padding is the same layout change seen from outside
      const stage = /\n    \.stage \{[\s\S]*?\n    \}/.exec(css);
      assert(stage && !/transition:[^;]*padding/.test(stage[0]),
        "the stage's padding is not animated either — animating one and not the " +
        "other makes the board overflow mid-transition");
    }

    // The motion a player sees most is a piece sliding across the board, and it
    // is canvas + requestAnimationFrame — no media query in the stylesheet can
    // reach it. 1.10 shipped honouring the setting everywhere except there.
    {
      const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/matchMedia\("\(prefers-reduced-motion: reduce\)"\)/.test(boardSrc),
        "the board animator reads the reduced-motion setting");
      const fn = /function animateMove\([\s\S]*?\n  \}/.exec(boardSrc);
      assert(fn, "found animateMove");
      assert(/_reduceMotion\) \{ _anim = null; return; \}/.test(fn[1] || fn[0]),
        "animateMove lands the piece with no glide when motion is reduced");
      assert(/addEventListener\("change"/.test(boardSrc),
        "the setting is watched, not read once at startup");
    }

    // The move list was capped at a flat 176px — seven move pairs whether the
    // window was 800px tall or 1400px.
    {
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const rule = /\.move-list \{ max-height: ([^;]+); \}/.exec(css);
      assert(rule, "the move list has an explicit height cap");
      assert(/100vh/.test(rule[1]) && /176px/.test(rule[1]),
        "the cap grows with the window and floors at the old 176px (" + rule[1] + ")");
    }

    // The shipped default window must not make the board smaller than the space
    // allows. Side by side, the board is min(width - panel, height - chrome) —
    // when the first term wins, the window wastes height and the board shrinks.
    // 960x900 did exactly that: 648px of board with 252px of empty height.
    {
      const zon = fs.readFileSync(path.join(root, "app.zon"), "utf8");
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const num = (re, src) => { const m = re.exec(src); return m ? Number(m[1]) : NaN; };
      const w = num(/\.width = (\d+)/, zon), h = num(/\.height = (\d+)/, zon);
      // 7.7 (v7-7-plan §1g): the panel is clamp(floor, Nvw, cap) — a function
      // of the window — and the board's height also pays for the two player
      // strips, so both enter the sum
      // M2 (v8-0-plan A1 × A2): of the play view — the window less the rail,
      // which a window this wide has (≥ 821px) — and the rail comes out of
      // the board's free width too
      const sw = /--side-w:\s*clamp\((\d+)px,\s*([\d.]+) \* var\(--pv-w\),\s*(\d+)px\)/.exec(css);
      const rail = w >= 821 ? num(/@media \(min-width: 821px\) \{\s*:root \{ --rail-w: (\d+)px/, css) : 0;
      const pv = w - rail;
      const side = sw ? Math.min(Number(sw[3]), Math.max(Number(sw[1]), pv * Number(sw[2]))) : NaN;
      const chrome = num(/--chrome-h:\s*(\d+)px/, css) + 2 * num(/--strip-h:\s*(\d+)px/, css);
      assert([w, h, rail, side, chrome].every(Number.isFinite),
        "read the default window (" + w + "x" + h + ") and the panel metrics (" + side + "/" + chrome + ", rail " + rail + ")");
      assert(pv - side >= h - chrome,
        "the default window fits the rail and the panel without shrinking the board (" +
        (pv - side) + "px of width vs " + (h - chrome) + "px of height)");
    }

    // 9.0 S5: the panel is one pane (its 设置 tab became the settings page).
    // A section that ends up outside it is invisible — the failure mode is
    // silent, so it gets a check.
    const paneIds = [...html.matchAll(/<div class="side-pane" id="(pane-[a-z]+)"/g)].map((m) => m[1]);
    assert(paneIds.join() === "pane-play", "found the one panel pane (" + paneIds.join(", ") + ")");
    const aside = /<aside class="side"[\s\S]*?<\/aside>/.exec(html)[0];
    let orphan = 0;
    // walk the aside, tracking whether we are inside a pane when a section opens
    let depthInPane = false;
    for (const line of aside.split("\n")) {
      if (/<div class="side-pane"/.test(line)) depthInPane = true;
      else if (/<!-- \/pane-/.test(line)) depthInPane = false;
      else if (/<section class="side-section/.test(line) && !depthInPane) {
        orphan++;
        console.error("FAIL: side-section outside every pane: " + line.trim().slice(0, 70));
      }
    }
    assert(orphan === 0, "every panel section lives inside a tab pane");

    const han = /[一-鿿]/;
    // Languages that legitimately write in Han characters — for those, "contains
    // Han" says nothing. Everywhere else it is the signal that a key was added
    // and the Chinese pasted straight in.
    const HAN_OK = new Set(["ja"]);
    // …so for a Han-writing language the test is instead "is it the *same string*
    // as the Chinese?", with an explicit list of the few that genuinely are. The
    // list has to be maintained by hand, which is the point: each entry is a
    // decision someone made, not an oversight that slipped through.
    const SHARED_WITH_ZH = {
      // (Through 8.4 the rungs' tooltips were 「Stockfish UCI_Elo 1700」 — a
      // product name and an engine setting, the same in every language and
      // listed here. v9-0-plan S6 made them the card's rating in words, so they
      // are translated now and the list lost them.)
      // `lm.tip2` is a drill's outcome and the technique it teaches, two
      // sentences. Japanese and Chinese both end a sentence with 。 — it is
      // translated, and the translation is the same mark.
      // v8-2-plan F4's templates that hold no words, only placeholders and the
      // marks around them: `ui.dot` / `rv.dot` (the separator between labels,
      // on screen and, wider, on the review picture), `ui.pair`
      // (a label and its number), `pz.catNo` (「战术 #12」), `lib.sfPlayer`
      // (a PGN player name), and `live.pieceW` — 「白{0}」, the colour of a
      // piece as the screen reader says it, one character in both.
      // `rv.marks` is 「?! · ? · ??」 — the move marks themselves, which are the
      // same three symbols in every chess-playing language. They label the row
      // whose value is 「3 · 2 · 1」, term lining up with term; spelling them out
      // as words is what the row is getting away from.
      ja: new Set(["act.fen", "hist.pgn", "live.pieceW", "ed.crK", "ed.crQ", "rv.marks",
        "lm.tip2", "ui.dot", "rv.dot", "ui.pair", "pz.catNo", "lib.sfPlayer",
        // the strongest rung (v9-0-plan S6): 全力 is the Japanese word too —
        // the ja persona lines said 「全力の Stockfish」 before it was a name
        "diff.extreme"]),
    };
    let untranslated = 0;
    for (const id of langs) {
      if (id === "zh-CN") continue;
      const shared = SHARED_WITH_ZH[id] || new Set();
      for (const [k, v] of Object.entries(I.DICT[id])) {
        if (!HAN_OK.has(id)) {
          if (han.test(v)) { untranslated++; console.error("FAIL: " + id + " leaves Chinese in " + k + ": " + v); }
          continue;
        }
        if (v === I.DICT["zh-CN"][k] && !shared.has(k)) {
          untranslated++;
          console.error("FAIL: " + id + " is character-for-character the Chinese in " + k + ": " + v);
        }
      }
      for (const k of shared) {
        if (I.DICT[id][k] !== I.DICT["zh-CN"][k]) {
          untranslated++;
          console.error("FAIL: " + id + " no longer shares " + k + " with Chinese — drop it from the list");
        }
      }
    }
    assert(untranslated === 0, "non-Chinese languages contain no untranslated strings");

    // The first thing a newcomer reads is "N interactive lessons" — in three
    // languages, none of which knows how many there actually are.
    // v8-2-plan T1: the course is lessons.js and the advanced part 3's chunk
    const courseSize = ctx.CHESS_LESSONS.length + ctx.CHESS_LESSONS_ADV_ZH.length;
    let miscounted = 0;
    for (const id of langs) {
      const m = /(\d+)/.exec(I.DICT[id]["ob.newSub"] || "");
      if (!m || Number(m[1]) !== courseSize) {
        miscounted++;
        console.error("FAIL: " + id + " promises " + (m ? m[1] : "?") + " lessons, there are " + courseSize);
      }
    }
    assert(miscounted === 0, "every language's onboarding blurb counts the lessons correctly");

    // Every visible Chinese tooltip in the markup must be wired for translation.
    const titled = [...html.matchAll(/<[^>]*\stitle="([^"]*)"[^>]*>/g)];
    let bareTitles = 0;
    for (const m of titled) {
      if (!han.test(m[1])) continue;
      if (!/data-i18n-title=/.test(m[0])) { bareTitles++; console.error("FAIL: untranslatable tooltip: " + m[1]); }
    }
    assert(bareTitles === 0, "every Chinese tooltip carries data-i18n-title");

    // Same rule for aria-label. An untranslated one is invisible to anyone
    // testing by eye but is exactly what a screen-reader user hears, and v1.5
    // shipped all 25 of them in Chinese while claiming the English UI was done.
    const labelled = [...html.matchAll(/<[^>]*\saria-label="([^"]*)"[^>]*>/g)];
    let bareLabels = 0;
    for (const m of labelled) {
      if (!han.test(m[1])) continue;
      if (!/data-i18n-aria=/.test(m[0])) { bareLabels++; console.error("FAIL: untranslatable aria-label: " + m[1]); }
    }
    assert(bareLabels === 0, "every Chinese aria-label carries data-i18n-aria");

    // Any element carrying visible Chinese text must be wired for translation.
    // The promotion dialog — a modal every real game reaches — had no data-i18n
    // at all, so the key-coverage check above could never notice it.
    let bareText = 0;
    // Comments are not markup. This scan used to run over them too, so writing
    // 「a visible <h3> against 「升变为」」 in a note about why a heading changed
    // reported the note as an untranslated heading.
    const htmlNoComments = html.replace(/<!--[\s\S]*?-->/g, "");
    for (const m of htmlNoComments.matchAll(/<(h3|button|span|div|p)\b([^>]*)>([^<]*[一-鿿][^<]*)</g)) {
      const [, tag, attrs, text] = m;
      if (/data-i18n=/.test(attrs)) continue;
      if (/\sid="(status|moves|white-role|black-role|clock-[wb])"/.test(attrs)) continue; // written by sync()
      bareText++;
      console.error("FAIL: untranslatable <" + tag + "> text: " + text.trim());
    }
    assert(bareText === 0, "every Chinese label in index.html carries data-i18n");

    // No inline style attribute in the markup. Every token guard in this file
    // reads styles.css; none of them can see a `style=` attribute, and that is
    // where the values that drifted off the scales went. The confirm dialog's
    // message was the only typography in the app off the seven-step type scale
    // (14px) and off the three leading tokens (1.5), and four `margin-top`s were
    // 14 and 10 against a spacing scale that has neither. Both were invisible for
    // as long as they were inline. Closing the hole is worth more than the four
    // rules it costs.
    const inlineStyles = [...htmlNoComments.matchAll(/<(\w+)[^>]*\sstyle="([^"]*)"/g)]
      .map((m) => "<" + m[1] + " style=\"" + m[2] + "\"");
    for (const s of inlineStyles) console.error("FAIL: inline style: " + s);
    assert(inlineStyles.length === 0,
      "no inline style attribute in index.html — the one place the token guards cannot look");

    // The same hole, one level down: a style set from JavaScript. The save-slot
    // rows were built with `row.style.cssText = "display:flex;gap:6px;..."` and
    // `load.style.flex = "1"` — the history row's CSS restated inline, where no
    // guard here could compare them. What is left is runtime state, which is
    // what an inline style is legitimately for: four cursors, the eval bar's
    // computed fill width, and touch-action. Layout constants belong in the
    // stylesheet with everything that checks them.
    const LAYOUT_PROPS = /\.style\.(cssText|flex|display|padding|margin|gap|fontSize|font|lineHeight|gridTemplate\w*|borderRadius|alignItems|justifyContent)\b\s*=/;
    // v8-0-plan F4: every module, reported by file and line
    const appJs = allAppSource;
    const jsInline = [...WEB_MODULES].flatMap(([file, text]) => text.split("\n")
      .map((l, i) => [file + ":" + (i + 1), l])
      .filter(([, l]) => LAYOUT_PROPS.test(l) && !/^\s*(\/\/|\*)/.test(l)));
    for (const [at, l] of jsInline) console.error("FAIL: layout written inline at " + at + " — " + l.trim());
    assert(jsInline.length === 0,
      "no layout constant is set from JavaScript — the stylesheet is where the guards can see it");

    // A dialog that holds a list gets the wide box. Three of them do — the game
    // history, the save slots and the multi-game PGN picker — and each was found
    // separately: 2.1.2 widened the history and did not go looking for the other
    // two, so both kept wrapping their rows for another two versions. Structural
    // rather than three names, so a fourth list cannot repeat it.
    const listDialogs = [...htmlNoComments.matchAll(
      /<div class="modal-bg" id="([^"]+)"[\s\S]*?<div class="(modal[^"]*)">([\s\S]*?)<\/div>\s*<\/div>/g)];
    let narrowLists = 0;
    for (const [, id, cls, body] of listDialogs) {
      if (!/class="pick-list"/.test(body)) continue;
      if (/\bwide\b/.test(cls)) continue;
      narrowLists++;
      console.error("FAIL: " + id + " holds a list of sentences in the narrow box");
    }
    assert(narrowLists === 0,
      "every dialog holding a list gets the wide box, not only the one that was noticed first");

    // "Is this a new user" is asked of the snapshot persist took before anything
    // wrote, not of four keys read at the end of init. Read there it was false
    // for every user the app ever had: the puzzle store writes an empty record at
    // import time and that write lands in the same bag the reads come out of, so
    // the first-run guide never opened and detectLang() was never called —
    // measured on the shipped 2.1.4, four system languages, Chinese every time.
    {
      assert(/const firstRun = Persist\.wasEmpty\(\);/.test(appJs),
        "firstRun comes from the snapshot, not from reading keys back");
      assert(!/const firstRun = !Persist\.get/.test(appJs),
        "…and not from the four reads that the app's own init had already invalidated");
      const persistSrc = fs.readFileSync(path.join(root, "src/web/js/persist.js"), "utf8");
      assert(/foundEmpty = Object\.entries\(bag\)/.test(persistSrc),
        "…which persist records inside load(), before any migration or write");
      // and the write that broke it does not happen at load at all
      const load = /function loadPuzzleState\(\) \{[\s\S]*?\n  \}/.exec(appJs);
      assert(load && !/Persist\.set/.test(load[0]) && !/store\.session\.puzzleState = loadPuzzleState\(\);\s*\n\s*(if[^\n]*)?Persist\.set/.test(appJs),
        "the puzzle record is not written at load (an empty record is what made firstRun false)");
    }

    // No suite may seed a storage key this app does not own. Three of them set
    // `chess.onboarded` — a key that left KEYS long ago and nothing has read
    // since — so they looked like they were suppressing the first-run guide while
    // the real reason it never appeared was the bug above. A test that suppresses
    // something by accident is a test that cannot notice it is broken.
    {
      // the key list, read from the module that owns it
      const keySrc = fs.readFileSync(path.join(root, "src/web/js/persist.js"), "utf8");
      // KEYS plus the sidecars persist.js declares beside it (SCHEMA_KEY,
      // STAMP_KEY). 6.1: "chess.schema" used to be written in here by hand and
      // "chess.writtenAt" was simply missing, so a suite that seeded the stamp —
      // which is how you make a cache look older than the file, the whole point
      // of the recovery tests — was told it had invented a key. Read both from
      // the module instead, so a third sidecar cannot repeat the trick.
      const known = new Set([...keySrc.matchAll(/^\s+\w+: "(chess\.[^"]+)",/gm)].map((m) => m[1])
        .concat([...keySrc.matchAll(/^export const \w+_KEY = "(chess\.[^"]+)";/gm)].map((m) => m[1])));
      let stray = 0;
      // every suite, this one's modules under scripts/test/ included
      for (const f of scriptFiles().filter((n) => /^test(?:-.*\.mjs$|\/)/.test(n))) {
        const src = fs.readFileSync(path.join(root, "scripts", f), "utf8");
        for (const m of src.matchAll(/localStorage\.setItem\(\s*["']([^"']+)["']/g)) {
          if (known.has(m[1])) continue;
          stray++;
          console.error("FAIL: " + f + " seeds an unknown key: " + m[1]);
        }
      }
      assert(stray === 0, "no suite seeds a storage key the app does not own");
    }

    // No Chinese string literal may reach the DOM from app.js. v1.5 translated
    // the static markup and left 169 runtime literals — task prompts, puzzle
    // feedback, every toast — so English mode stayed half Chinese where it
    // mattered most. This is the check that would have caught it.
    // v8-0-plan F4: the scan runs per module over APP_MODULES; the source checks
    // after it read every module but the three that own what they forbid here
    // (persist.js the storage keys, host.js the storage calls, board.js the
    // coordinate gutters and its colour table), and the three with a sanctioned
    // copy (lazy-content.js names the settings key for chunk-boot.js, v8-0-plan
    // F5; library-sum.js the library header's for it, v8-1-plan F3;
    // analysis-store.js strips its own record's `sig`, not the history's).
    const appSrc = allSourceExcept("persist.js", "host.js", "board.js", "lazy-content.js", "library-sum.js", "analysis-store.js");
    let literals = 0;
    for (const [file, text] of appModuleEntries()) {
      let inBlockComment = false;
      text.split("\n").forEach((line, i) => {
        const trimmed = line.trim();
        if (trimmed.startsWith("/*")) inBlockComment = true;
        if (inBlockComment) { if (trimmed.includes("*/")) inBlockComment = false; return; }
        if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
        for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
          if (!han.test(m[1])) continue;
          literals++;
          console.error("FAIL: " + file + ":" + (i + 1) + " hard-codes Chinese: " + m[1]);
        }
      });
    }
    assert(literals === 0, "app.js routes every user-visible string through t()");

    // Every key app.js asks for at runtime must exist. Dynamic lookups
    // (t("piece." + type)) are skipped — the prefixes are checked by hand.
    let unknownRuntime = 0;
    for (const m of appSrc.matchAll(/\btf?\("([a-zA-Z][\w.-]*)"/g)) {
      if (m[1].endsWith(".")) continue;
      if (!(m[1] in I.DICT["zh-CN"])) {
        unknownRuntime++;
        console.error("FAIL: app.js uses undefined key " + m[1]);
      }
    }
    assert(unknownRuntime === 0, "every runtime key app.js requests is defined");

    // Lesson prose must reach the screen through taskText(), which is where the
    // translation lookup lives. Reading `task.prompt` (or a step's `.tip`)
    // straight off the lesson is how every move/stars/drill prompt in the course
    // stayed Chinese in English mode from 1.6 to 1.8 — the translations were in
    // lessons-en.js the whole time, simply never asked for.
    const taskTextFn = srcOf("taskText");
    assert(/^function taskText\(lesson, ti\) \{/.test(taskTextFn), "found the lesson-prose accessor");
    const outside = appSrc.replace(taskTextFn, "");
    let rawProse = 0;
    for (const m of outside.matchAll(/\btask\.(prompt|retry)\b|\.steps\[[^\]]*\]\.tip\b/g)) {
      rawProse++;
      console.error("FAIL: lesson prose read straight off the data: " + m[0]);
    }
    assert(rawProse === 0, "lesson prose always goes through the translation lookup");

    // Every ending marker written into a stats record must be understood by the
    // history reader. A game that ended by resignation or agreement is not over
    // by its moves alone, so an unhandled marker would put the position back on
    // the board as live — and in an engine game that means Stockfish quietly
    // playing on from a game the player finished weeks ago.
    const markers = [...appSrc.matchAll(/recordOutcome\([^)]*"([a-zA-Z]+)"\)/g)].map((m) => m[1]);
    const restore = srcOf("restoreEnding");
    const handled = restore ? [...restore.matchAll(/end === "([a-zA-Z]+)"/g)].map((m) => m[1]) : [];
    let unhandled = 0;
    assert(markers.length >= 3 && handled.length >= 3, "found the ending markers and the history reader");
    for (const k of new Set(markers)) {
      if (!handled.includes(k)) { unhandled++; console.error("FAIL: history cannot restore the #" + k + " ending"); }
    }
    assert(unhandled === 0, "all " + new Set(markers).size + " ending markers survive a trip through the history");

    // …and the ending must not live inside the movetext any more. Until 1.25 a
    // record's `sig` was the PGN with a "#resigned"-style marker glued on, so
    // reading either one back meant a regex — safe only because a checkmate PGN
    // happens to end in a bare "#". 缺陷 13: they are three fields now.
    assert(/function historyPgn\(rec\) \{\s*return String\(rec\.pgn \|\| ""\);/.test(appSrc),
      "the PGN is its own field, not a substring of the identity");
    assert(/function historyEnding\(rec\) \{\s*return String\(rec\.ending \|\| ""\);/.test(appSrc),
      "…and so is the ending");
    assert(!/rec\.sig/.test(appSrc), "nothing reads the old packed signature");
    // identity is issued, never derived from what was played
    assert(/function newRecordId\(\)/.test(appSrc), "records get an issued id");
    assert(/store\.game\.recordedId/.test(appSrc) && !/statsRecordedSig/.test(appSrc),
      "the game on the board remembers which record it is, by id");
    assert(/s\.games\.find\(\(g\) => g\.id === store\.game\.recordedId\)/.test(appSrc),
      "accuracy is filed by id, not by walking to the last PGN that matches");

    // --- three claims the copy was making that were not true ------------------
    {
      // 缺陷 31: 「满强度」 promises unlimited *strength*, and reads as unlimited
      // *time*. It only turns off UCI_LimitStrength — the search is still 1.2s a
      // move, the same as every other tier.
      for (const lang of ["zh-CN", "en", "ja"]) {
        const label = I.DICT[lang]["diff.extreme"];
        assert(!/满强度|Full strength|フルパワー/.test(label),
          lang + " no longer calls the top tier “full strength” — " + label);
      }
      // 10.0 M0: the rung is chosen on its opponent's card, and the card's
      // words (the persona's hello, its tooltip) are what say it in each language
      const lines = fs.readFileSync(path.join(root, "src/web/js/opponents-lines.js"), "utf8");
      const fishHellos = [...lines.matchAll(/fish: \{[^}]*hello: "([^"]*)"/g)].map((m) => m[1]);
      assert(fishHellos.length === 3 && fishHellos.every((h) => /1\.2/.test(h)),
        "…and its card says what it actually does (" + fishHellos.join(" / ") + ")");
      // and the engine really does still time-limit it
      const eng = fs.readFileSync(path.join(root, "src/web/js/engine.js"), "utf8");
      assert(/extreme: \{ elo: null, movetime: 1200 \}/.test(eng),
        "…which is 1200ms, as the tooltip now says");

      // 缺陷 30: "changing style does not change strength" was half a sentence.
      // 450cp of slack is about half a piece a move.
      for (const lang of ["zh-CN", "en", "ja"]) {
        const note = I.DICT[lang]["side.personaNote"];
        assert(/半个子|half a piece|半駒/.test(note),
          lang + " says how far a style may wander — " + note);
        assert(/杀|mate|詰み/.test(note), lang + " …and what it will not give up");
      }

      // 缺陷 22: the number is not the number online sites call "accuracy" —
      // they compute it from win probability and get 60–75% where this gets 37%.
      assert(I.DICT["zh-CN"]["acc.label"] !== "准确率",
        "the metric is not called by the name that means something else");
      for (const lang of ["zh-CN", "en", "ja"]) {
        assert(/胜率|win probability|勝率/.test(I.DICT[lang]["tip.accuracy"]),
          lang + " explains what the other number is");
      }
    }

    // --- motifs are derived, and only where the position is unambiguous -------
    // 21 of 168 carried one, all in `tac`, so "practise pins today" reached 21
    // puzzles while the 23 real-game and 37 capture sets went unlabelled. 缺陷 28.
    // Hand-tagging 147 positions is how labels start being wrong, so this is
    // derived from the position the way the difficulty tier already is.
    {
      loadModule(ctx, "src/web/js/motif.js");
      const M = ctx.motifOf;
      assert(typeof M === "function", "motif.js exports a pure classifier");

      // Known shapes, hand-built so the rule is checked rather than just
      // exercised. Nf6+ from h5 hits the king on g8 and the rook on e8.
      assert(M("4r1k1/8/8/7N/8/8/8/7K w - - 0 1", "Nf6+", ctx.Chess) === "fork",
        "a knight hitting king and rook is a fork");
      // a rook pinning a knight to its king along the file
      assert(M("4k3/8/4n3/8/8/8/8/4R2K w - - 0 1", "Re4", ctx.Chess) === "pin",
        "a rook lining up on a knight in front of its king is a pin");
      // the same geometry with the values swapped is a skewer
      assert(M("4q3/8/4k3/8/8/8/8/4R2K w - - 0 1", "Re4+", ctx.Chess) === "skewer",
        "…and with the king in front it is a skewer");
      // nothing certain reports nothing
      assert(M("8/8/8/8/8/8/4P3/4K2k w - - 0 1", "e4", ctx.Chess) === null,
        "a quiet pawn push is not given a motif it does not have");

      // and it agrees with the labels a human already wrote
      loadModule(ctx, "src/web/js/puzzles.js");
      const HAND = { "闪将": "discovered", "牵制": "pin", "串击": "skewer", "捉双": "fork" };
      let agree = 0, differ = 0;
      for (const p of ctx.CHESS_PUZZLES) {
        if (!p.motif || !HAND[p.motif] || !p.fen) continue;
        const line = p.line || p.solution || [];
        if (!line.length) continue;
        const d = M(p.fen, line[0], ctx.Chess);
        if (d === HAND[p.motif]) agree++;
        else if (d) { differ++; console.error("  " + p.id + ": hand " + p.motif + ", derived " + d); }
      }
      // one disagreement is known and is the derivation being MORE specific:
      // t-disco-q is a discovered check that is also a double check
      assert(differ <= 1,
        "the derivation agrees with the hand labels (" + agree + " agree, " + differ + " differ)");

      // 7.6: what the tally records is what the card says. motifKeyOf() takes a
      // written label first, through app.js's own table; a label with no key
      // (引离, 消除防守者, 过载) records none — t-deflect-r's Re8+ derives as a
      // fork, and it used to be counted as one under a card that said 引离.
      const HK = ctx.HAND_MOTIF_KEY || {};
      const keyOf = (p) => ctx.puzzleMotifKey(p, HK, () => M(p.fen, (p.line || p.solution)[0], ctx.Chess));
      const dr = ctx.CHESS_PUZZLES.find((p) => p.id === "t-deflect-r");
      assert(dr && M(dr.fen, dr.line[0], ctx.Chess) === "fork" && keyOf(dr) === null,
        "「把车引离底线」显示引离,就不再被记成捉双");
      for (const [label, key] of Object.entries(HAND)) {
        assert(HK[label] === key, "手写的「" + label + "」记作 " + key);
      }
    }

    // --- one set of kinds (9.0 S3) --------------------------------------------
    // 8.x offered a difficulty filter beside twelve categories and twenty-eight
    // themes — three ways to slice one book, one of them (the tier) the mate
    // categories under another name (缺陷 14). 9.0 has six kinds, the same in
    // both books, and serves each near the player's rating; no filter is left.
    {
      const modesSrc = fs.readFileSync(path.join(root, "src/web/js/trainer/puzzle-modes.js"), "utf8");
      const groups = /export const PUZZLE_GROUPS = \[([^\]]*)\]/.exec(modesSrc);
      assert(groups && groups[1].replace(/\s/g, "") === '"mate","tactic","endgame","defense","opening","mine"',
        "S3: six kinds — 杀棋 / 战术 / 残局 / 防守 / 开局 / 我的错题 (" + (groups ? groups[1] : "missing") + ")");
      const tiles = [...html.matchAll(/data-group="([a-z]+)"/g)].map((m) => m[1]);
      assert(tiles.join() === "mate,tactic,endgame,defense,opening,mine", "S3: a tile per kind, in that order (" + tiles.join() + ")");
      assert(/function groupList\(g\) \{\s*return localInGroup\(g\)\.concat\(lcPool\(\)\.filter/.test(modesSrc),
        "S3: a kind pools the built-in book and the Lichess bands");
      assert(!/row-puzzle-tier|puzzle-tier-seg|puzzle-cat-seg|tierApplies/.test(html + appSrc),
        "S3: no difficulty filter and no category row are left");
    }

    // --- the move list: figurine notation, one typeface -----------------------
    // `Nf3` is English algebraic — N for Knight, a word two of this app's three
    // languages do not use. The vector pieces are already loaded for the board.
    // And the row mixed SF Mono 12px (the move number) with the interface sans
    // at 13px (the move) in a three-character span. P4.4.
    {
      assert(/function writeSan\(node, san, color\)/.test(appSrc), "moves are written through one helper");
      assert(/node\.setAttribute\("aria-label", san\)/.test(appSrc),
        "…and the full SAN stays as the accessible name");
      const ws = srcOf("writeSan");
      // 17.0 F: figurines.js answers only for K Q R B N, so a pawn move's
      // file letter and castling's O stay text
      assert(/figurineSvg\(san\[0\]\)/.test(ws), "only the leading piece letter becomes a piece");
      assert(/san\.slice\(1\)/.test(ws), "…the rest of the move is text");
      const cssM2 = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const num = /\.mlnum \{([^}]*)\}/.exec(cssM2);
      const mvRule = /\n\s*\.mlmove \{([^}]*)\}/.exec(cssM2);
      const sizeOf = (r) => ((r && /font-size: ([\d.]+rem)/.exec(r[1])) || [])[1];
      // 7.9 §2a: 15px now, both of them. 9.0 V1: 14px, the body step — the
      // type scale lost its 15 (four roles: 30 / 16 / 14 / 12)
      assert(num && sizeOf(num) === "0.875rem" && sizeOf(num) === sizeOf(mvRule),
        "the move number is the same size as the move beside it (" + sizeOf(num) + " / " + sizeOf(mvRule) + ")");
      // 7.9 §2c: no chip behind the number, and set like the move so the
      // baselines agree (the measurement is in test-layout-e2e)
      assert(num && !/background/.test(num[1]) && !/border-radius/.test(num[1]),
        "…and it stands on the page, not in a box");
      assert(num && /padding: 4px /.test(num[1]) && /height: var\(--row-h-sm\)/.test(num[1]) &&
        /line-height: var\(--lh-tight\)/.test(num[1]),
        "…set in the move's box and leading, so the two share a baseline");
      assert(num && /tabular-nums/.test(num[1]), "…and still a column of figures");
      assert(!/\.mlnum num/.test(appSrc), "…without borrowing the mono stack for it");
    }

    // --- the exported image is a file, not a screenshot of this theme --------
    // It painted on --card (a 3–4% white overlay in wood and night) with --text
    // on top, so exporting from either produced near-white text on near-white
    // and dropping it into a white document produced a blank rectangle. 缺陷 2.
    // The turning-point line ended "—— 点此跳转", removed by a regex that only
    // worked on the full-width dash, so the English build printed "tap to jump"
    // into the image. 缺陷 5. And nine fillText calls, no measureText, no
    // wrapping: over-long text left the canvas rather than ellipsizing. 缺陷 21.
    {
      // 6.0: the image moved to report.js with its palette and font stack
      const repSrc = fs.readFileSync(path.join(root, "src/web/js/report.js"), "utf8");
      const at = repSrc.indexOf("function render(d)");
      const rep = repSrc.slice(at, repSrc.indexOf("\n  }\n", at));
      assert(/REPORT_INK/.test(rep) && !/pick\("--card"/.test(rep),
        "the export has its own opaque palette, not the theme's");
      assert(/const REPORT_INK = \{[^}]*bg: "#/.test(repSrc), "…and it is a literal, on purpose");
      assert(/rv\.turningPointPlain/.test(rep), "the turning point uses the plain key");
      assert(!/replace\(\/\\s\*——/.test(rep), "…and no regex trims the screen's tail off it");
      for (const lang of ["zh-CN", "en", "ja"]) {
        assert("rv.turningPointPlain" in I.DICT[lang], lang + " has the plain turning-point line");
        assert(!/点此跳转|tap to jump|タップで移動/.test(I.DICT[lang]["rv.turningPointPlain"]),
          lang + "'s plain line says nothing about tapping");
      }
      assert(/measureText/.test(rep), "text is measured before it is drawn");
      assert(/function text\(str, x, y, maxW/.test(rep), "…through one wrapping helper");
      const raw = (rep.match(/ctx\.fillText\(/g) || []).length;
      assert(raw <= 4, "…and almost nothing writes unmeasured (" + raw + " raw fillText)");
      // one font stack, and it is the app's
      const fonts = new Set([...rep.matchAll(/ctx\.font = "([^"]*)"/g)].map((m) => m[1]));
      assert(fonts.size === 0, "no font string is written in place (" + [...fonts].join(" | ") + ")");
      assert(/const REPORT_FONT = /.test(repSrc), "…there is one stack for the image");
      assert(/ChessReport\.render\(\{/.test(appSrc), "…and app.js only hands it what it reads");
    }

    // --- the ending sound is decided by who won ------------------------------
    // Every ending asked "is the game over" rather than "who won", so being
    // checkmated played the victory fanfare, losing on time played it, and
    // *resigning* played it. Resigning to Stockfish sounded like an
    // achievement. 缺陷 1.
    {
      const aud = fs.readFileSync(path.join(root, "src/web/js/audio.js"), "utf8");
      assert(/function playLoss\(\)/.test(aud), "there is a sound for losing");
      assert(/playRefused|playLift|playCastle|playPromote/.test(aud),
        "…and for the refusal, the lift, the castle and the promotion");
      // one master node, so four voices in the same 200ms cannot sum into a click
      const audCode = aud.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const direct = (audCode.match(/connect\(ctx\.destination\)/g) || []).length;
      assert(direct === 1, "every voice goes through the master node (" + direct + " direct)");
      assert(/createDynamicsCompressor/.test(aud), "…which is what stops a pile-up clipping");
      assert(/function wobble\(/.test(audCode) && !/Math\.random/.test(audCode),
        "repeated moves are not identical, and not random either");

      // and app.js decides by winner, in one place
      assert(/function playEnding\(winner\)/.test(appSrc), "one place decides the ending sound");
      const ending = srcOf("playEnding");
      const outsideEnding = appSrc.replace(ending, "");
      const wins = (outsideEnding.match(/Audio2\.playWin\(\)/g) || []).length;
      // the two that remain are the student finishing a lesson and solving a
      // puzzle — those really are wins, and have no loser
      assert(wins === 2, "nothing else reaches for the fanfare directly (" + wins + ")");
      assert(/playLoss\(\)/.test(ending), "…and it can play the losing one");
      // resignation specifically: the case that was most obviously wrong
      const res = appSrc.indexOf("store.game.resigned = side;");
      assert(/playEnding\(side === "w" \? "b" : "w"\)/.test(appSrc.slice(res, res + 300)),
        "resigning plays the sound for the side that did not resign");
    }

    // --- the stylesheet is sectioned by component, not by version ------------
    // `/* v1.9 polish */` and `/* --- stats (v0.3) --- */` are an append log:
    // they say when a rule arrived and nothing about what it belongs to. The
    // history-filter rules sat under "v1.10", three hundred lines from the rest
    // of the history.
    {
      const cssV = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const stamps = [...cssV.matchAll(/^\s*\/\* (?:---)? ?v\d+\.\d+/gm)].map((m) => m[0].trim());
      for (const v of stamps) console.error("  version heading: " + v);
      assert(stamps.length === 0,
        "no section is named after the version that added it" +
        (stamps.length ? " — " + stamps.length + " left" : ""));
    }

    // --- three toast tiers ---------------------------------------------------
    // 110 toasts, one visual. "已复制 PGN" is a receipt you may ignore; "你违背
    // 了开局原则" is the app correcting you, which in the teaching and puzzle
    // modes is the entire product; "引擎启动失败" means a feature is gone until
    // you restart. Same background, same size, same 2.2 seconds — after which
    // there was no evidence the third had ever happened. 缺陷 20.
    {
      // by the opening paren, not the whole parameter list: the signature grew a
      // third parameter (a fault that can be retried carries the retry), and a
      // slice keyed to the old one silently matched nothing — this whole block
      // then asserted against an empty string and passed
      const t3 = srcOf("toast");
      assert(/^function toast\(msg, tier/.test(t3), "found toast(msg, tier…)");
      assert(/TOAST_MS/.test(appSrc) && /ok: 2200/.test(appSrc), "the three tiers have three lifetimes");
      assert(/fault: 0/.test(appSrc), "…and the fault tier does not dismiss itself");
      assert(/el\.onclick = ms \? null :/.test(t3),
        "…so it offers a way out that is not waiting");
      const cssT = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      for (const cls of [".toast.t-fix", ".toast.t-fault"]) {
        assert(cssT.includes(cls), cls + " is styled apart from a receipt");
      }
      // and the tiers are actually used — a tier nobody passes is a tier that
      // does not exist
      const faults = (appSrc.match(/, "fault"\)/g) || []).length;
      const fixes = (appSrc.match(/, "fix"\)/g) || []).length;
      assert(faults >= 10, "the fault tier is used (" + faults + " call sites)");
      assert(fixes >= 10, "the correction tier is used (" + fixes + " call sites)");
      // 7.5: the blunder coach asks you to press Z. On the default tier it was a
      // green "success" receipt gone in 2.2 s — before it could be read and acted on
      const blunders = appSrc.match(/toast\(tf\("mm\.blunder"[^;]*;/g) || [];
      assert(blunders.length >= 1 && blunders.every((c) => /, "fix"\);$/.test(c)),
        "the blunder warning is a correction (fix tier, 4.2 s), not a receipt: " + blunders.join(" | "));
    }

    // --- one implementation per component, and no orphan rules ---------------
    // The app had two segmented controls: `.theme-row`, which everything uses,
    // and an iOS-style `.pill` with its own button sizing, its own active
    // treatment and its own light-theme override — and no users left in the
    // markup at all. A spare implementation cannot be kept in step with the real
    // one, and it is where "why do these two rows of buttons not match" starts.
    {
      const cssC = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const htmlC = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      // 7.2: the 棋谱库 markup is built in library-ui.js now, so the app's
      // source alone no longer accounts for every class it wears
      // 7.9: and fit-row.js sets the panel's width class (.side-wide)
      // 10.0 M0: every hand-written module, not app.js and two others — the
      // classes a page wears are set all over src/web/js now
      const appC = [];
      const walkJs = (dir) => {
        for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
          const p = path.join(dir, f.name);
          if (f.isDirectory()) walkJs(p);
          else if (/\.js$/.test(f.name) && !/^(bundle|chunk-|engine-src)/.test(f.name)) appC.push(fs.readFileSync(p, "utf8"));
        }
      };
      walkJs(path.join(root, "src/web/js"));
      const jsC = appC.join("\n");
      // 10.0 M0: every class a selector names, wherever it stands in the
      // selector — it used to read only the ones that began a line (346 of
      // 435), and .review-h, the second of a pair, had outlived its markup
      const sels = [];
      {
        let buf = "";
        for (const ch of cssC.replace(/\/\*[\s\S]*?\*\//g, "")) {
          if (ch === "{") { sels.push(buf); buf = ""; } else if (ch === "}" || ch === ";") buf = ""; else buf += ch;
        }
      }
      const defined = new Set();
      for (const sel of sels) if (!/^\s*@/.test(sel)) for (const m of sel.matchAll(/\.([a-zA-Z][\w-]*)/g)) defined.add(m[1]);
      // classes put together at run time: the grade on a move (" g-" + grade,
      // app.js) and a retry's verdict ("is-" + verdict, review/retry.js)
      const BUILT = [[/^g-/, /" g-" \+/], [/^is-(right|wrong)$/, /"is-" \+ r\.verdict/]];
      const orphans = [];
      for (const c of defined) {
        // a search of the markup and the modules: classes are set as literals,
        // as parts of a multi-class string ("mlnum num"), and as concatenations
        // ("mvtag " + tier), so anything narrower reports rules that are very
        // much in use. A hyphen is part of a class name, so it bounds the match.
        const used = new RegExp("(?<![\\w-])" + c.replace(/-/g, "\\-") + "(?![\\w-])");
        if (used.test(htmlC) || used.test(jsC)) continue;
        if (BUILT.some(([name, maker]) => name.test(c) && maker.test(jsC))) continue;
        orphans.push(c);
      }
      for (const c of orphans) console.error("  no markup uses ." + c);
      assert(orphans.length === 0,
        "every class the stylesheet defines is worn by something" +
        (orphans.length ? " — " + orphans.length + " orphan(s)" : " (" + defined.size + " classes)"));
      // 10.0 M0: and every custom property it declares is read — by a var()
      // in the sheet, or by the app (getPropertyValue / setProperty / markup)
      const cssNoComments = cssC.replace(/\/\*[\s\S]*?\*\//g, "");
      const declared = new Set([...cssNoComments.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
      const readVar = new Set([...cssNoComments.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]));
      const unread = [...declared].filter((v) => !readVar.has(v) && !jsC.includes(v) && !htmlC.includes(v));
      for (const v of unread) console.error("  nothing reads " + v);
      assert(unread.length === 0, "every custom property the stylesheet declares is read (" + declared.size + " declared)" +
        (unread.length ? " — unread: " + unread.join(", ") : ""));
    }

    // --- the board's marks sit on one scale ----------------------------------
    // Ten marks carried ten geometries: three ring radii (.44 / .45 / .46) and
    // seven stroke weights. The visible cost was the drag ring sitting on the
    // legal-target ring as two almost-concentric circles of different thickness,
    // which reads as a rendering fault. 缺陷 16. And the four boards' mark
    // strengths were eleven independent numbers times four — per-board tuning is
    // right, eleven free variables is not. 缺陷 15.
    {
      const b = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(/const MARK = \{/.test(b), "the mark scale is declared");
      const strokes = [...b.matchAll(/lineWidth = (?:Math\.max\([\d.]+, )?step \* ([^;)]+)/g)].map((m) => m[1].trim());
      const off = strokes.filter((v) => !/MARK\.(hair|line|bold|arrow)/.test(v) && !/_drag\.legal/.test(v));
      for (const v of off) console.error("  stroke off the scale: step * " + v);
      assert(off.length === 0, "every mark stroke picks a step (" + strokes.length + " strokes)");
      const radii = [...b.matchAll(/ctx\.arc\([^,]+, [^,]+, step \* ([^,]+),/g)].map((m) => m[1].trim());
      const rOff = radii.filter((v) => !/MARK\.(ring|dot)/.test(v));
      for (const v of rOff) console.error("  radius off the scale: step * " + v);
      assert(rOff.length === 0, "…and every ring picks one of the two radii (" + radii.length + " rings)");

      // and the four boards tune strength by choosing a step, not a number
      const cssM = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      // Each board colour is declared exactly four times — once per board — and
      // nowhere else. A stray later declaration at the same specificity silently
      // wins for every board: 1.25 briefly carried a duplicated :root block
      // after the palettes, which repainted night, day and notebook with wood's
      // squares. Nothing failed — the browser checks count pieces, and the
      // contrast check reads the palette blocks rather than the cascade.
      for (const v of ["--sq-light", "--sq-dark", "--sq-sel", "--sq-check", "--coord-ink", "--board-frame"]) {
        const n = (cssM.match(new RegExp("\\n *" + v + ":", "g")) || []).length;
        assert(n === MARK_BOARDS.length, v + " is declared once per board and nowhere else (" + n + ")");
      }
      for (const step of ["--mark-strong", "--mark-mid", "--mark-soft"]) {
        assert(new RegExp(step + ":").test(cssM), step + " is declared once");
      }
      // the fourth component specifically — the first three are the colour
      const loose = [...cssM.matchAll(/(--sq-(?:sel|last|check|hint|star|flash|dot|ring)): rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]/g)]
        .map((m) => m[1]);
      for (const v of new Set(loose)) console.error("  free alpha: " + v);
      assert(loose.length === 0,
        "no board writes a mark strength of its own" + (loose.length ? " — " + loose.length : ""));
    }

    // --- the Japanese interface gets Japanese type ---------------------------
    // The base stack's three CJK faces are all Simplified Chinese, including
    // "Hiragino Sans GB" — GB as in 国标, which is Hiragino's SC cut and not its
    // Japanese one. So Japanese kanji have been drawn in Chinese forms since
    // 1.21. applyLanguage() sets documentElement.lang correctly and always has;
    // the stylesheet simply had no :lang() rule to hang off it. 缺陷 7.
    {
      const cssL = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const ja = /html:lang\(ja\)[\s\S]*?\{([\s\S]*?)\}/.exec(cssL);
      assert(!!ja, "there is a :lang(ja) rule");
      assert(/Hiragino Kaku Gothic ProN|Hiragino Sans"|Yu Gothic|Noto Sans JP/.test(ja[1]),
        "…and it names Japanese faces");
      assert(!/Hiragino Sans GB|PingFang SC|Microsoft YaHei/.test(ja[1]),
        "…and none of the Simplified-Chinese ones");
      // controls inherit nothing from body on any engine — a font stack that
      // stops at <body> leaves every button in the wrong typeface
      for (const el of ["input", "button"]) {
        assert(new RegExp("html:lang\\(ja\\) " + el).test(cssL),
          "the Japanese stack reaches <" + el + "> too");
      }
      assert(/documentElement\.setAttribute\("lang", store\.ui\.langId\)/.test(appSrc),
        "…and lang is set on the document for it to match");
    }

    // --- one judgement scale, read by the stylesheet and by the canvas -------
    // The eval curve painted `?`/`??` with two hard-coded hexes; the move-list
    // annotations used two *different* hard-coded hexes plus --danger; and the
    // eval bar drew White and Black as #f2f2ee on #1d1d1b, which on the two
    // light themes is a white bar on a near-white card — the bar disappeared
    // entirely. Three copies of one idea, none reachable by a theme. 缺陷 8.
    {
      const cssJ = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      for (const v of ["--judge-soft", "--judge-mid", "--judge-bad", "--side-white", "--side-black"]) {
        const n = (cssJ.match(new RegExp(v + ":", "g")) || []).length;
        assert(n === 4, "all four shells answer for " + v + " (" + n + ")");
      }
      assert(/\.mvtag\.t-soft \{ color: var\(--judge-soft\)/.test(cssJ), "the move list reads the scale");
      assert(/background: var\(--side-black\)/.test(cssJ) && /background: var\(--side-white\)/.test(cssJ),
        "the eval bar reads the two sides");
      assert(/function judgeColours\(\)/.test(appSrc), "the canvas reads the same tokens");
      // the only literals left are the fallbacks inside that one accessor, for
      // a document that has not applied a stylesheet yet
      // (board.js keeps its own token table with the same fallbacks — the
      // board's accessor, not a copy in drawing code — so it is left out)
      const elsewhere = allSourceExcept("board.js").replace(srcOf("judgeColours"), "");
      assert(!/#e05252|#e0a03c|#c9b458/.test(elsewhere),
        "…and no drawing code holds a copy of them");
    }

    // --- keyed lists keep the nodes they can ---------------------------------
    // The move list is rebuilt on every move, the history at up to 500 rows on
    // every filter change. Rebuilding throws the nodes away, and with them the
    // scroll position (put back by hand afterwards) and the focus (not put back
    // at all — Tab to a move, let the clock tick, and focus is on <body>).
    {
      const el = (tag) => {
        const n = { tagName: tag.toUpperCase(), dataset: {}, childNodes: [], children: [] };
        n.replaceChildren = (...k) => { n.childNodes = k; n.children = k; };
        return n;
      };
      const parent = el("div");
      parent.insertBefore = (node, before) => {
        const at = before ? parent.childNodes.indexOf(before) : parent.childNodes.length;
        const was = parent.childNodes.indexOf(node);
        if (was >= 0) parent.childNodes.splice(was, 1);
        parent.childNodes.splice(at > parent.childNodes.length ? parent.childNodes.length : at, 0, node);
        parent.children = parent.childNodes;
      };
      parent.removeChild = (node) => {
        const at = parent.childNodes.indexOf(node);
        if (at >= 0) parent.childNodes.splice(at, 1);
        parent.children = parent.childNodes;
      };
      Object.defineProperty(parent, "lastChild", { get: () => parent.childNodes[parent.childNodes.length - 1] });

      const ctx2 = { console, document: { createElement: el } };
      ctx2.globalThis = ctx2; ctx2.window = ctx2;
      vm.createContext(ctx2);
      loadModule(ctx2, "src/web/js/keyed.js");
      const { reconcile } = ctx2;

      const build = (it) => { const n = el("div"); n.textContent = it.v; return n; };
      const items = [{ k: "a", v: 1 }, { k: "b", v: 2 }, { k: "c", v: 3 }];
      let n = reconcile(parent, items, (i) => i.k, (i) => i.v, build);
      assert(n === 3 && parent.childNodes.length === 3, "a first render builds every row");
      const before = parent.childNodes.slice();

      // nothing changed
      n = reconcile(parent, items, (i) => i.k, (i) => i.v, build);
      assert(n === 0, "an unchanged list rebuilds nothing");
      assert(parent.childNodes.every((node, i) => node === before[i]),
        "…and every node is the same node it was");

      // one row's content changes
      const items2 = [{ k: "a", v: 1 }, { k: "b", v: 9 }, { k: "c", v: 3 }];
      n = reconcile(parent, items2, (i) => i.k, (i) => i.v, build);
      assert(n === 1, "one changed row rebuilds one row (" + n + ")");
      assert(parent.childNodes[0] === before[0] && parent.childNodes[2] === before[2],
        "…and leaves its neighbours alone");

      // a row is removed
      n = reconcile(parent, [items2[0], items2[2]], (i) => i.k, (i) => i.v, build);
      assert(parent.childNodes.length === 2 && n === 0,
        "dropping a row rebuilds nothing and shortens the list");
      // …and reordering moves nodes rather than remaking them
      const kept = parent.childNodes.slice();
      n = reconcile(parent, [items2[2], items2[0]], (i) => i.k, (i) => i.v, build);
      assert(n === 0 && parent.childNodes[0] === kept[1] && parent.childNodes[1] === kept[0],
        "reordering moves the nodes it already has");
    }

    // --- the board owns the board --------------------------------------------
    // draw() takes a model and paints it; nothing is pushed in ahead of time.
    // The drag was the exception: setDrag() handed the renderer a copy of
    // something the app already held in store.ui.dragging, so one fact lived in
    // two places and only one of them was reachable from a test.
    {
      const b = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
      assert(!/function setDrag/.test(b), "the board has no drag setter");
      assert(!/^\s*let _drag/m.test(b), "…and holds no drag state of its own");
      assert(/const _drag = m\.drag \|\| null;/.test(b), "the drag comes in with the model");
      assert(!/BoardView\.setDrag/.test(appSrc), "and nothing pushes one in");
      // the coordinates are the board's too — painted from board.js, never by a
      // DOM overlay the app maintains in parallel
      assert(/function drawCoords\(/.test(b) && !/coord-files/.test(appSrc),
        "the coordinate gutters are filled by the board, not by app.js");
    }

    // --- nothing builds the DOM by concatenating markup ----------------------
    // P1 acceptance: `grep -c innerHTML` is 0. Most of the twenty uses were
    // `el.innerHTML = ""`, which is a clear rather than a parse — but it is the
    // same habit, and the two that did build markup (the captured-piece strip,
    // the coordinate gutters) learned it from the ones that did not. The
    // replacement is replaceChildren(), which also states the intent: this list
    // is being replaced, not appended to.
    {
      const dir = path.join(root, "src/web/js");
      const offenders = [];
      for (const f of webJsFiles(dir).filter((n) => n !== "bundle.js")) {
        const src = fs.readFileSync(path.join(dir, f), "utf8");
        const n = (src.match(/\.innerHTML\b/g) || []).length;
        if (n) offenders.push(f + " (" + n + ")");
      }
      for (const o of offenders) console.error("  innerHTML in " + o);
      assert(offenders.length === 0,
        "no module writes the DOM through innerHTML" + (offenders.length ? " — " + offenders.join(", ") : ""));
    }

    // --- storage goes through one door, and a failed write is heard ----------
    // host.js has always returned true/false from storageSet() and caught its
    // own exception. All eleven call sites in app.js dropped that value, every
    // one inside an empty `catch (_) {}` — so a full or blocked quota looked
    // exactly like a save. The app kept showing lesson progress, puzzle
    // progress, statistics and achievements for the rest of the session and lost
    // all of it at the next launch. 缺陷 3. And eight keys with three separate
    // version conventions had no single entry point, so "clear my data" was a
    // list somebody maintained by hand. 缺陷 33.
    {
      const direct = (appSrc.match(/Host\.storage(Set|Get|Remove)\(/g) || []).length;
      assert(direct === 0,
        "app.js does not touch storage directly (" + direct + " call(s) left)");
      const empties = (appSrc.match(/storage\w*\([^)]*\)[^;]*;\s*\}\s*catch \(_\) \{\}/g) || []).length;
      assert(empties === 0, "no storage call is left inside an empty catch");

      const per = fs.readFileSync(path.join(root, "src/web/js/persist.js"), "utf8");
      assert(/const ok = host\.storageSet\(key, value\)/.test(per) && /if \(ok\)/.test(per),
        "persist.js reads the value host.js returns");
      assert(/onWriteFailure/.test(per), "…and a failure is announced");
      assert(/function clearAll\(\)[\s\S]{0,200}?for \(const name of Object\.keys\(KEYS\)\)/.test(per),
        "clearing is derived from the key list, not typed out again");
      assert(/export const SCHEMA = 3;/.test(per) && !/MIGRATIONS/.test(per),
        "there is one schema version, 9.0's own, and nothing that reads an older profile");
      // every key the app owns is in the list — a key added elsewhere would be
      // written but never cleared
      const keys = [...per.matchAll(/^  \w+: "(chess\.[\w.]+)"/gm)].map((m) => m[1]);
      // 6.0 added the quarantine key (v6-plan D2); 7.0 the games library;
      // 7.2 the player's own opening book; 7.6 the board's finished analyses;
      // v8-0-plan C2 the online-sync switch and the name it last asked for
      assert(keys.length === 15, "all fifteen keys are declared in one place (" + keys.length + ")");
      for (const k of keys) {
        assert(!appSrc.includes('"' + k + '"'), "app.js no longer names " + k + " itself");
      }
      // the failure notice must not be a toast: a toast leaves, and this is the
      // one message that has to still be there a minute later
      assert(/function showStorageFault\(\)/.test(appSrc), "a storage failure gets its own notice");
      const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
      const rule = /\.storage-fault \{([^}]*)\}/.exec(css);
      assert(!!rule, ".storage-fault is styled");
      assert(!/transition|opacity/.test(rule[1]), "…and does not fade away like a confirmation");
    }

    // --- Escape closes the topmost dialog, and the list exists once -----------
    // It was seven `classList.contains("show")` tests in a fixed hand-written
    // order, plus the same seven again inside dialogOpen(). An eighth dialog
    // meant editing two places; a wrong order reported nothing. 缺陷 19.
    {
      // 5.2.1: the handler is escapeKey(), reached from the key and from the
      // native shortcut alike
      const esc = srcOf("escapeKey");
      assert(!!esc, "found the Escape handler");
      // comments only; the point is that no *code* tests a dialog by hand
      const code = esc.replace(/\/\/.*$/gm, "");
      const chain = (code.match(/classList\.contains\("show"\)/g) || []).length;
      assert(chain === 0, "Escape tests no dialog by hand (" + chain + " left)");
      assert(/Dlg\.closeTop\(\)/.test(esc), "…it asks for the top of the stack");
      // dialogOpen() is one answer from one place
      assert(/function dialogOpen\(\) \{\s*return Dlg\.anyOpen\(\);/.test(appSrc),
        "\"is a dialog open\" is answered by the module that opens them");
      // every dialog says how it closes, once, where it is built
      const wire = srcOf("wireDialogs");
      assert(!!wire, "the closers are registered in one block");
      const registered = (wire.match(/Dlg\.register\(/g) || []).length;
      // the seven that exist today; the assertion is that the count matches the
      // markup, so an eighth dialog cannot be added without registering it
      const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      const modals = (html.match(/class="modal-bg/g) || []).length;
      assert(registered === modals,
        "every one of the " + modals + " dialogs is registered (" + registered + " registered)");
      // and the stack is open-order, not document order: a confirmation raised
      // from inside the slot list has to win regardless of the markup
      const dlg = fs.readFileSync(path.join(root, "src/web/js/dialog.js"), "utf8");
      assert(/stack\.push\(el\)/.test(dlg) && /stack\.indexOf\(el\)/.test(dlg),
        "dialog.js keeps an open-order stack");
      assert(/for \(let i = stack\.length - 1; i >= 0; i--\)/.test(dlg),
        "…and reads it from the top down");
    }

    // the editor reports failures as keys — each must resolve in every language
    const editorSrc = fs.readFileSync(path.join(root, "src/web/js/editor.js"), "utf8");
    const edKeys = [...editorSrc.matchAll(/"(edErr\.[A-Za-z]+)"/g)].map((m) => m[1]);
    let badEd = 0;
    for (const k of new Set(edKeys)) {
      if (!(k in I.DICT["zh-CN"])) { badEd++; console.error("FAIL: editor emits undefined key " + k); }
    }
    assert(badEd === 0, "all " + new Set(edKeys).size + " editor error keys are defined");
  }
}
