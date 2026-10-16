/**
 * The course and the puzzle set: lessons, their translations, the opening
 * names and ideas, and every puzzle position, in every content language.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { compileModuleSync, CHUNKS } from "../bundle.mjs";
import { assert, root, ctx, Chess, loadModule, srcOf } from "./harness.mjs";
import { CONTENT_LANGS, initLanguages, sfx, untranslated, checkJapanese } from "./lang.mjs";

export async function run() {
  // lessons: every FEN valid, every solution legal and goal-satisfying,
  // star paths clear all stars without ever checking the decorative kings
  initLanguages();

  {
    loadModule(ctx, "src/web/js/lessons.js");
    // v8-2-plan T1: the advanced part 3 is a chunk of its own, words and all;
    // every check below holds it to the same rules as the rest of the course
    for (const f of ["lessons-adv.js", "lessons-adv-en.js", "lessons-adv-ja.js"]) loadModule(ctx, "src/web/js/" + f);
    const lessons = ctx.CHESS_LESSONS.concat(ctx.CHESS_LESSONS_ADV_ZH);
    assert(Array.isArray(lessons) && lessons.length >= 28, "lessons loaded (" + (lessons ? lessons.length : 0) + ")");
    const ids = new Set();
    let bad = 0;
    const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
    for (const L of lessons) {
      if (!L.id || ids.has(L.id)) { fail("lesson id missing/duplicate", L.id); continue; }
      ids.add(L.id);
      if (!L.title || !L.part || !Array.isArray(L.text) || !L.text.length) fail(L.id, "missing title/part/text");
      if (!Array.isArray(L.tasks) || !L.tasks.length) { fail(L.id, "no tasks"); continue; }
      for (const [ti, t] of L.tasks.entries()) {
        const tag = L.id + "#" + ti;
        const v = new Chess().validate_fen(t.fen);
        if (!v.valid) { fail(tag, "invalid FEN:", v.error); continue; }
        if (t.type === "tap") {
          if (!Array.isArray(t.steps) || !t.steps.length) { fail(tag, "tap without steps"); continue; }
          const g = new Chess(t.fen);
          for (const s of t.steps) {
            if (!s.tip || !Array.isArray(s.squares) || !s.squares.length) fail(tag, "bad tap step");
            for (const sq of s.squares) if (!/^[a-h][1-8]$/.test(sq)) fail(tag, "bad square", sq);
          }
          void g;
        } else if (t.type === "stars") {
          let g = new Chess(t.fen);
          const stars = new Set(t.stars);
          if (!t.solution || !t.solution.length) fail(tag, "stars task without solution");
          for (const uci of t.solution) {
            const mv = g.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: "q" });
            if (!mv) { fail(tag, "illegal star move", uci); break; }
            if (t.only && mv.piece !== t.only) fail(tag, "moved wrong piece", uci);
            stars.delete(mv.to);
            // the runtime hands the turn back to the student after each move
            const f = g.fen().split(" ");
            f[1] = "w"; f[3] = "-";
            g = new Chess(f.join(" "));
            if (g.in_check()) fail(tag, "star path checks a king after", uci);
          }
          if (stars.size) fail(tag, "solution leaves stars uncleared:", [...stars].join(","));
        } else if (t.type === "move") {
          const g = new Chess(t.fen);
          const mv = g.move(t.solution[0]);
          if (!mv) { fail(tag, "solution illegal:", t.solution[0]); continue; }
          if (mv.san !== t.solution[0]) fail(tag, "non-canonical solution SAN", t.solution[0], "≠", mv.san);
          const okByGoal =
            t.goal === "any" ? true :
            t.goal === "check" ? g.in_check() :
            t.goal === "mate" ? g.in_checkmate() :
            t.goal === "castle-k" ? mv.flags.includes("k") :
            t.goal === "castle-q" ? mv.flags.includes("q") :
            t.goal === "ep" ? mv.flags.includes("e") :
            t.goal === "promote" ? !!mv.promotion :
            t.goal === "capture" ? (mv.to === t.target && !!mv.captured) :
            t.goal === "one-of" ? (Array.isArray(t.accept) && t.accept.includes(mv.san)) :
            t.goal === "safe" ? !g.moves({ verbose: true }).some((m) => m.to === mv.to) :
            t.goal === "draw-insufficient" ? g.insufficient_material() : false;
          if (!okByGoal) fail(tag, "solution does not satisfy goal", t.goal);
          // The `accept` list is what a one-of task actually grades against
          // (app.js: `task.accept.includes(mv.san)` — an exact SAN compare, no
          // normalising). Until 1.20 only solution[0] was checked, so the REST of
          // the list was never looked at: drill-bishops offered eleven "any of
          // these" bishop moves of which five could never match — four squares no
          // bishop on that colour complex can reach, plus "Bf4", which is a
          // perfectly good move the lesson meant to allow but which the engine
          // spells "Bf4+". A student playing it got the retry hint.
          for (const san of t.accept || []) {
            const g3 = new Chess(t.fen);
            const am = g3.move(san);
            if (!am) {
              const alt = ["+", "#"].map((s) => san + s).find((s) => { const p = new Chess(t.fen); return !!p.move(s); });
              fail(tag, "accept entry not playable:", san, alt ? `— the engine spells it "${alt}"` : "— no such move here");
            } else if (am.san !== san) {
              fail(tag, "accept entry is not canonical SAN:", san, "≠", am.san);
            }
          }
          if (t.trap) {
            const g2 = new Chess(t.fen);
            const tm = g2.move(t.trap);
            if (!tm) fail(tag, "trap move illegal:", t.trap);
            else if (!g2.in_stalemate()) fail(tag, "trap move is not stalemate:", t.trap);
          }
        } else if (t.type === "drill") {
          const g = new Chess(t.fen);
          if (g.game_over()) fail(tag, "drill starts game-over");
        } else {
          fail(tag, "unknown task type", t.type);
        }
        if (!t.prompt) fail(tag, "missing prompt");
      }
    }
    assert(bad === 0, "all lesson tasks valid");

    // Curriculum shape. Up to 1.9 the course jumped straight from "three opening
    // principles" to the endgame: a student finished all 38 lessons knowing how
    // to fork and how to mate with a rook, and had never been told what to do on
    // move 12. The middlegame block has to stay, and it has to stay *between*
    // those two — a section is only a bridge if it is in the middle.
    {
      const parts = lessons.map((l) => l.part);
      const firstOf = (p) => parts.indexOf(p);
      const lastOf = (p) => parts.lastIndexOf(p);
      const MG = "中局思路";
      assert(firstOf(MG) !== -1, "the curriculum has a middlegame section");
      const mgLessons = lessons.filter((l) => l.part === MG);
      assert(mgLessons.length >= 6,
        "the middlegame section is a section, not a footnote (" + mgLessons.length + " lessons)");
      assert(lastOf("开局入门") < firstOf(MG),
        "the middlegame comes after the opening");
      assert(lastOf(MG) < firstOf("残局基础"),
        "the middlegame comes before the endgame");
      // every middlegame lesson has to be practised, not just read
      const noTask = mgLessons.filter((l) => !(l.tasks || []).length).map((l) => l.id);
      assert(noTask.length === 0,
        "every middlegame lesson has something to do" + (noTask.length ? ": " + noTask.join(", ") : ""));
      // the endgame block is the one every beginner reaches last and needs most
      const egLessons = lessons.filter((l) => l.part === "残局基础");
      assert(egLessons.length >= 8,
        "the endgame section is a section too (" + egLessons.length + " lessons)");
      // and the opening is the one they reach FIRST after the rules. Through
      // 1.18 it had two lessons — three principles and a trap the lesson itself
      // says not to rely on — against 7 middlegame and 8 endgame, with the next
      // stop being 109 ECO lines to memorise. Whatever else gets added, this
      // section does not get to be the thin one again.
      const opLessons = lessons.filter((l) => l.part === "开局入门");
      assert(opLessons.length >= 8,
        "the opening section is a section too (" + opLessons.length + " lessons)");
      // 1.19 set that floor for the three game-phase sections only, and the
      // thinnest section in the whole course turned out to be the one a beginner
      // meets FIRST: "认识棋盘" had two lessons and six sentences carrying the
      // board, the coordinates, all sixteen men, the back-rank order, the queen's
      // colour and the object of the game — against eight on the opening. The
      // floor now covers every section, so no part of the course gets to be the
      // thin one, entry included.
      const order = [];
      for (const p of parts) if (!order.includes(p)) order.push(p);
      const counts = order.map((p) => [p, lessons.filter((l) => l.part === p).length]);
      const thin = counts.filter(([, n]) => n < 7);
      assert(thin.length === 0,
        "every section of the course is a real section — "
        + counts.map(([p, n]) => p + " " + n).join(", ")
        + (thin.length ? " — too thin: " + thin.map(([p, n]) => p + " (" + n + ")").join(", ") : ""));
      // A part name that appears, stops, and comes back would split a section in
      // the lesson list while still counting as one here.
      for (const p of order) {
        const idx = lessons.map((l, i) => (l.part === p ? i : -1)).filter((i) => i >= 0);
        assert(idx[idx.length - 1] - idx[0] === idx.length - 1, "section «" + p + "» is contiguous");
      }
    }

    // Emphasis markers have to be paired. The course marks its key sentence with
    // `**…**`; through 1.16 the renderer set textContent, so readers saw the
    // asterisks rather than the emphasis — 24 paragraphs of it. Now that app.js
    // renders them, an unpaired marker would print a stray `**` instead, so the
    // data is checked here and the splitter is exercised below.
    {
      const strayZh = lessons.filter((l) => (l.text || []).some((p) => (p.split("**").length - 1) % 2));
      assert(strayZh.length === 0,
        "every ** in a lesson is closed" + (strayZh.length ? ": " + strayZh.map((l) => l.id).join(", ") : ""));

      // app.js needs a DOM to load, so lift the one function out and run it
      // against a stub — the alternative is trusting a renderer nobody checks
      const fnSrc = srcOf("lessonParagraph");
      assert(!!fnSrc, "app.js still has lessonParagraph");
      const stubDoc = {
        createElement: (tag) => ({ tag, kids: [], textContent: "", appendChild(k) { this.kids.push(k); } }),
        createTextNode: (text) => ({ text }),
      };
      const paragraph = new Function("document", "return " + fnSrc)(stubDoc);
      const flat = (el) => el.kids.map((k) => (k.text !== undefined ? k.text : "<b>" + k.textContent + "</b>")).join("");
      const cases = [
        ["plain text", "plain text"],
        ["before**middle**after", "before<b>middle</b>after"],
        ["**lead**tail", "<b>lead</b>tail"],
        ["**a**and**b**", "<b>a</b>and<b>b</b>"],
        ["one ** stray marker", "one ** stray marker"],
        ["", ""],
      ];
      let markBad = 0;
      for (const [src, want] of cases) {
        const got = flat(paragraph(src));
        if (got !== want) { markBad++; console.error("FAIL: lessonParagraph(" + JSON.stringify(src) + ") = " + JSON.stringify(got)); }
      }
      assert(markBad === 0, "lessonParagraph renders ** as emphasis and leaves a stray marker alone");
    }

    // English lessons: every lesson must be covered, and every entry must line
    // up with the Chinese original — a translation that describes a different
    // task is worse than none at all. 1.5 shipped a 9-lesson "pilot" while the
    // release notes said the English UI was done; coverage is asserted now.
  // A translation file that index.html never loads is a translation nobody can
  // read. 1.21 wrote 1027 Japanese strings, passed every data check, and shipped
  // them unreachable for exactly as long as it took the browser test to open the
  // page in Japanese — the guards were all looking at the files, and no one was
  // looking at the <script> tags.
  //
  // index.html no longer names the files — it loads one bundle — so the question
  // moved with them: not "is there a <script> tag" but "does the bundle contain
  // this translation". Reachability is now a property of the import graph, which
  // is what it should have been all along.
  //
  // v8-0-plan F5 moved it once more: each language is a chunk now, so the
  // question is "does that language's chunk carry this translation, is the
  // chunk built, and is it what the language loads".
  {
    const missing = [];
    for (const lang of CONTENT_LANGS) {
      const entry = "src/web/js/lang-" + lang + ".js";
      const chunked = fs.existsSync(path.join(root, entry)) ? compileModuleSync(path.join(root, entry)) : "";
      for (const kind of ["lessons", "puzzles", "openings", "i18n"]) {
        const name = `CHESS_${kind.toUpperCase()}_${sfx(lang)}`;
        if (!chunked.includes(name)) missing.push(`${kind}-${lang}.js`);
      }
      const file = "chunk-lang-" + lang + ".js";
      if (!CHUNKS.some((c) => c.entry === entry && path.basename(c.out) === file)) missing.push(file + " (not in CHUNKS)");
      const lazySrc = fs.readFileSync(path.join(root, "src/web/js/lazy-content.js"), "utf8");
      const row = new RegExp("\\n\\s*\"?" + lang + "\"?: \\[([^\\n]*)\\]").exec(lazySrc);
      if (!row || !row[1].includes(file)) missing.push(file + " (not in LANG_CHUNKS." + lang + ")");
    }
    assert(missing.length === 0,
      "every language's chunk carries its content translation" + (missing.length ? " — missing " + missing.join(", ") : ""));
  }

  for (const lang of CONTENT_LANGS) {
    const file = "src/web/js/lessons-" + lang + ".js";
    assert(fs.existsSync(path.join(root, file)), file + " exists");
    if (!fs.existsSync(path.join(root, file))) continue;
    loadModule(ctx, file);
    const en = Object.assign({}, ctx["CHESS_LESSONS_" + sfx(lang)], ctx["CHESS_LESSONS_ADV_" + sfx(lang)]);
    const uncovered = lessons.filter((L) => !en || !en[L.id]).map((L) => L.id);
    for (const id of uncovered) console.error("FAIL: lesson has no " + lang + " text: " + id);
    assert(uncovered.length === 0, "all " + lessons.length + " lessons have " + lang + " text");
    if (!en) continue;
    let badEn = 0;
    const failEn = (...m) => { badEn++; console.error("FAIL:", ...m); };
    const byId = new Map(lessons.map((L) => [L.id, L]));
    for (const [id, tr] of Object.entries(en)) {
      const L = byId.get(id);
      if (!L) { failEn("translation for unknown lesson", id); continue; }
      if (!tr.title || !tr.part) failEn(id, "translation missing title/part");
      if (!Array.isArray(tr.text) || tr.text.length !== L.text.length) {
        failEn(id, "text paragraph count differs:", tr.text && tr.text.length, "vs", L.text.length);
      }
      if (tr.tasks) {
        // Fewer translated tasks than real ones used to pass silently, which is
        // how a task added to the Chinese course ships showing Chinese prose to
        // an English reader — the overlay is indexed, so the extra task simply
        // has no entry. The count has to match exactly.
        if (tr.tasks.length !== L.tasks.length) {
          failEn(id, "task count differs:", tr.tasks.length, "vs", L.tasks.length);
        }
        tr.tasks.forEach((tt, i) => {
          const real = L.tasks[i];
          if (!real) return;
          if (tt.steps) {
            const realSteps = real.steps ? real.steps.length : 0;
            if (tt.steps.length !== realSteps) failEn(id + "#" + i, "tap step count differs:", tt.steps.length, "vs", realSteps);
          }
          if (real.retry && !tt.retry) failEn(id + "#" + i, "task has a retry hint but no translation");
          if (!tt.prompt) failEn(id + "#" + i, "task has no translated prompt");
        });
      }
      // a translation must not smuggle in chess data
      for (const k of Object.keys(tr)) {
        if (!["part", "title", "text", "tasks"].includes(k)) failEn(id, "unexpected key in translation:", k);
      }
    }
    assert(badEn === 0, lang + " lessons match the originals");

    // Nothing may survive untranslated — see `untranslated` for what that means
    // in each language.
    let leftOver = 0;
    const walk = (v, src, where) => {
      if (typeof v === "string") {
        if (untranslated(lang, v, typeof src === "string" ? src : null)) {
          leftOver++;
          console.error("FAIL: untranslated " + lang + " lesson " + where + ": " + v);
        }
        return;
      }
      if (Array.isArray(v)) return v.forEach((x, i) => walk(x, Array.isArray(src) ? src[i] : null, where + "[" + i + "]"));
      if (v && typeof v === "object") {
        return Object.entries(v).forEach(([k, x]) => walk(x, src && typeof src === "object" ? src[k] : null, where + "." + k));
      }
    };
    for (const [id, tr] of Object.entries(en)) {
      const L = byId.get(id);
      walk(tr, L ? { part: L.part, title: L.title, text: L.text, tasks: L.tasks } : null, lang + "." + id);
    }
    assert(leftOver === 0, lang + " lesson text is actually translated");
    // …and the corpus as a whole has to read like the language. Pasting the
    // Chinese course in wholesale would pass the per-string check for any
    // sentence that got one character changed; it could not pass this.
    // Loose English words drifting into the prose (I left "attacked" and "good"
    // sitting in two Japanese sentences while writing this file, and caught them
    // by eye — twice), and third scripts the Latin scan cannot see (a Russian
    // двух also made it in). Both live in checkJapanese now, shared with the
    // opening and puzzle tables.
    if (lang === "ja") checkJapanese("ja lesson prose", en, 0.9, 400);
  }
  }

  // 7.6: `**…**` is bold only where lessonParagraph() renders it — the lesson
  // paragraphs. A task's prompt, a step's tip and a retry line are set as plain
  // text, so markup there reached the reader as asterisks: 「是**深**格」 in
  // lesson 2, 「**新的**子」 in the tempo lesson, in all three languages.
  {
    const stray = [];
    const walk = (o, where) => {
      if (typeof o === "string") { if (o.includes("**") && !/\.text\[\d+\]$/.test(where)) stray.push(where); return; }
      if (Array.isArray(o)) o.forEach((x, i) => walk(x, where + "[" + i + "]"));
      else if (o && typeof o === "object") for (const k of Object.keys(o)) walk(o[k], where + "." + k);
    };
    for (const L of ctx.CHESS_LESSONS.concat(ctx.CHESS_LESSONS_ADV_ZH)) walk(L, "zh:" + L.id);
    for (const lang of CONTENT_LANGS) {
      for (const [id, tr] of Object.entries(Object.assign({}, ctx["CHESS_LESSONS_" + sfx(lang)], ctx["CHESS_LESSONS_ADV_" + sfx(lang)]))) walk(tr, lang + ":" + id);
    }
    assert(stray.length === 0, "课文里的 ** 只出现在会被渲染成粗体的段落里" +
      (stray.length ? " — " + stray.join(", ") : ""));
  }

  // 7.6: one measure, one word. The analysis line under the curve said
  // Precision (ja 精度) while the report beside it said Accuracy (ja 正確度).
  for (const [lang, dict] of Object.entries(ctx.ChessI18n.DICT)) {
    assert(dict["acc.label"] === dict["rv.acc"],
      lang + ": 分析行与回顾用同一个词称呼精准度 (" + dict["acc.label"] + " / " + dict["rv.acc"] + ")");
  }

  // English names for puzzles and openings: the app falls back to the Chinese
  // name when one is missing, so only a coverage check keeps English mode honest
  {
    loadModule(ctx, "src/web/js/puzzles.js");
    loadModule(ctx, "src/web/js/openings.js");
    const pz = ctx.CHESS_PUZZLES;
    const op = ctx.CHESS_OPENINGS;
    const opNames = new Set(op.map((o) => o[1]));
    let bad = 0;
    const fail = (...m) => { bad++; console.error("FAIL:", ...m); };

  for (const lang of CONTENT_LANGS) {
    for (const kind of ["puzzles", "openings"]) {
      const f = "src/web/js/" + kind + "-" + lang + ".js";
      assert(fs.existsSync(path.join(root, f)), f + " exists");
      if (fs.existsSync(path.join(root, f))) {
        loadModule(ctx, f);
      }
    }
    const pzEn = ctx["CHESS_PUZZLES_" + sfx(lang)] || {};
    const opEn = ctx["CHESS_OPENINGS_" + sfx(lang)] || {};

    bad = 0;
    for (const p of pz) {
      const tr = pzEn[p.id];
      if (!tr) { fail("puzzle has no " + lang + " name:", p.id); continue; }
      if (!tr.name || untranslated(lang, tr.name, p.name)) fail("puzzle name not translated (" + lang + "):", p.id, tr.name);
      // a motif is shown in the goal line, so it must be translated wherever one exists
      if (!!p.motif !== !!tr.motif) fail("puzzle motif mismatch (" + lang + "):", p.id, p.motif, "vs", tr.motif);
      if (tr.motif && untranslated(lang, tr.motif, p.motif)) fail("puzzle motif not translated (" + lang + "):", p.id, tr.motif);
    }
    for (const id of Object.keys(pzEn)) {
      if (!pz.some((p) => p.id === id)) fail(lang + " text for unknown puzzle:", id);
    }
    assert(bad === 0, "all " + pz.length + " puzzles have " + lang + " names");

    bad = 0;
    // ids since 1.25, so the "did anyone actually translate this" comparison has
    // to reach for the Chinese name rather than the key
    const opZh = ctx.CHESS_OPENING_NAMES;
    for (const n of opNames) {
      if (!opZh[n]) { fail("opening id has no Chinese name:", n); continue; }
      if (!opEn[n]) { fail("opening has no " + lang + " name:", n); continue; }
      if (untranslated(lang, opEn[n], opZh[n])) fail("opening name not translated (" + lang + "):", opZh[n], "->", opEn[n]);
    }
    for (const n of Object.keys(opZh)) {
      if (!opNames.has(n)) fail("Chinese name for unknown opening id:", n);
    }
    for (const n of Object.keys(opEn)) {
      if (!opNames.has(n)) fail(lang + " name for unknown opening:", n);
    }
    assert(bad === 0, "all " + opNames.size + " opening names have " + lang + " text");
  }
  // The drills also show the line's idea. Only lines long enough to be drilled
  // (≥6 plies, the same filter app.js applies) ever display one, so that is
  // exactly the set that needs translating — no more, no less.
  for (const lang of CONTENT_LANGS) {
    bad = 0;
    const ideaEn = ctx["CHESS_OPENING_IDEAS_" + sfx(lang)] || {};
    const drilled = op.filter((o) => o[2].split(" ").length >= 6);
    const ideaOf = new Map(drilled.map((o) => [o[1], o[3]]));
    for (const [, name, , idea] of drilled) {
      if (!idea) { fail("drilled opening has no idea line:", name); continue; }
      if (!ideaEn[name]) { fail("opening idea has no " + lang + " text:", name); continue; }
      if (untranslated(lang, ideaEn[name], ideaOf.get(name))) fail("opening idea not translated (" + lang + "):", name);
    }
    for (const n of Object.keys(ideaEn)) {
      if (!drilled.some((o) => o[1] === n)) fail(lang + " idea for an opening that is never drilled:", n);
    }
    assert(bad === 0, "all " + drilled.length + " drilled openings have a " + lang + " idea");
  }

  // --- a translation table is keyed by an id, never by prose ------------------
  // openings-en.js and openings-ja.js were both keyed by the Chinese name until
  // 1.25, which made every opening name two things at once: the copy shown to a
  // Chinese reader, and the join key for two other languages. Editing it as copy
  // silently unkeyed both translations, and the failure mode was invisible —
  // openingName() falls back to its argument, so all three languages quietly
  // showed the Chinese string and nothing failed. Lessons and puzzles were
  // already id-keyed; this makes the rule the same everywhere.
  {
    const cjk = /[\u3040-\u30ff\u4e00-\u9fff]/;
    const proseKeys = [];
    for (const lang of CONTENT_LANGS) {
      for (const name of ["CHESS_LESSONS_", "CHESS_PUZZLES_", "CHESS_OPENINGS_", "CHESS_OPENING_IDEAS_"]) {
        const tbl = ctx[name + sfx(lang)];
        if (!tbl) continue;
        for (const k of Object.keys(tbl)) if (cjk.test(k)) proseKeys.push(name + sfx(lang) + "[" + k + "]");
      }
    }
    for (const k of proseKeys.slice(0, 10)) console.error("  " + k);
    assert(proseKeys.length === 0,
      "no content translation table is keyed by prose" +
      (proseKeys.length ? " — " + proseKeys.length + " such keys" : ""));
  }

  // …and the name has to actually describe the moves. Every check above is about
  // coverage — each name has a translation, nothing is orphaned — and coverage
  // says nothing about whether a name is TRUE of the line it sits on. C24 was
  // "中心开局·比萨普变例" from the day it was added: the moves are 1.e4 e5 2.Bc4,
  // which is the Bishop's Opening (C23 in this very file is 主教开局), while the
  // Centre Game is C21. Both translators quietly wrote "Bishop's Opening", so
  // only the Chinese reader saw a name belonging to a different opening.
  //
  // The table is written from chess fact rather than derived from the file —
  // derived rules can only ever certify that today's names agree with today's
  // names, which is exactly the check that let C24 through. Only move orders
  // where the prefix genuinely pins the family are listed: 1.e4 c5 is NOT here,
  // because 史密斯-莫拉弃兵 is legitimately its own family, and 2.Bc4 lines split
  // into 意大利/埃文斯/双马 further down. Each row states a naming fact that has
  // to hold for every line that starts that way.
  {
    const FAMILY_BY_LINE = [
      ["e4 e5 Bc4", "主教开局"],
      ["e4 e5 d4", "中心对局"],
      ["e4 e5 f4", "王翼弃兵"],
      ["e4 e5 Nc3", "维也纳开局"],
      ["e4 e5 Nf3 Nc6 Bb5", "西班牙开局"],
      ["e4 e5 Nf3 Nc6 d4", "苏格兰"],
      ["e4 e5 Nf3 d6", "菲利多尔防御"],
      ["e4 e6", "法兰西防御"],
      ["e4 c6", "卡罗"],
      ["e4 Nf6", "阿廖欣防御"],
      ["e4 d5", "斯堪的纳维亚防御"],
      ["d4 f5", "荷兰防御"],
      ["d4 d5 c4 c6", "斯拉夫"],
      ["d4 Nf6 c4 e6 Nc3 Bb4", "尼姆佐-印度防御"],
    ];
    bad = 0;
    for (const [line, family] of FAMILY_BY_LINE) {
      const hits = op.filter((o) => (o[2] + " ").startsWith(line + " "));
      // a rule matching nothing is a rule that stopped guarding anything
      if (!hits.length) { fail("no opening starts with " + line + " — stale naming rule"); continue; }
      for (const o of hits) {
        // o[1] is the line id as of 1.25; the Chinese name this rule is about
        // now lives in CHESS_OPENING_NAMES beside it
        const zhName = ctx.CHESS_OPENING_NAMES[o[1]];
        if (!zhName || !zhName.includes(family)) {
          fail("opening " + o[0] + ' "' + zhName + '" plays ' + line + ", so its name must say " + family);
        }
      }
    }
    assert(bad === 0, "every opening name describes the line it sits on (" + FAMILY_BY_LINE.length + " rules)");
  }

  // The same three scans lessons-ja gets. 1.21 added 452 Japanese strings across
  // these three tables and none of them were ever looked at: the scans were
  // written inside the lesson loop, so "the Japanese is checked" was true of a
  // third of the Japanese. Floors differ by corpus, not by standard — see
  // checkJapanese.
  {
    checkJapanese("ja opening names", ctx.CHESS_OPENINGS_JA || {}, 0.95, 150);
    checkJapanese("ja opening ideas", ctx.CHESS_OPENING_IDEAS_JA || {}, 0.95, 100);
    // 実戦 01–23 are kanji and digits, and legitimately so
    checkJapanese("ja puzzle names", ctx.CHESS_PUZZLES_JA || {}, 0.85, 160);
  }
  }

  // puzzles: legal positions (white to move, black not already in check),
  // m1 solutions mate, m2 first moves FORCE mate against every defense
  {
    loadModule(ctx, "src/web/js/puzzles.js");
    const puzzles = ctx.CHESS_PUZZLES;
    assert(Array.isArray(puzzles) && puzzles.length >= 51, "puzzles loaded (" + (puzzles ? puzzles.length : 0) + ")");
    const matingMoves = (g) => g.moves().filter((m) => {
      g.move(m); const mate = g.in_checkmate(); g.undo(); return mate;
    });
    /** a mate-in-one for whoever is to move, or null */
    const mateIn1 = (g) => matingMoves(g)[0] || null;
    function whiteHasForcedMate(g, n) {
      for (const m of g.moves()) {
        g.move(m);
        const mate = g.in_checkmate();
        const deeper = !mate && n > 1 && !g.game_over() && blackForcedLost(g, n - 1);
        g.undo();
        if (mate || deeper) return true;
      }
      return false;
    }
    function blackForcedLost(g, n) {
      const replies = g.moves();
      if (!replies.length) return false;
      for (const r of replies) {
        g.move(r);
        const lost = whiteHasForcedMate(g, n);
        g.undo();
        if (!lost) return false;
      }
      return true;
    }
    const mateNextForced = (g) => blackForcedLost(g, 1);
    const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    /** one-recapture-level material swing of playing `san` (puzzles are designed
        so deeper exchanges never matter) */
    function swing(fen, san) {
      const t = new Chess(fen);
      const mv = t.move(san);
      if (!mv) return null;
      let gain = mv.captured ? VAL[mv.captured] : 0;
      if (t.moves({ verbose: true }).some((m) => m.to === mv.to)) gain -= VAL[mv.piece];
      return gain;
    }
    /** best net capture on `to` for the side to move (legal recaptures only) */
    function bestCapture(g, to) {
      let best = null;
      for (const m of g.moves({ verbose: true })) {
        if (m.to !== to || !m.captured) continue;
        const t = new Chess(g.fen());
        t.move(m);
        let gain = VAL[m.captured];
        if (t.moves({ verbose: true }).some((r) => r.to === to)) gain -= VAL[m.piece];
        if (best == null || gain > best) best = gain;
      }
      return best;
    }
    const ids = new Set();
    let bad = 0;
    const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
    for (const p of puzzles) {
      if (!p.id || ids.has(p.id)) { fail("puzzle id missing/duplicate", p.id); continue; }
      ids.add(p.id);
      if (!p.name || !["m1", "m2", "m3", "win", "tac", "real", "def", "draw"].includes(p.cat)) { fail(p.id, "bad name/cat"); continue; }
      const v = new Chess().validate_fen(p.fen);
      if (!v.valid) { fail(p.id, "invalid FEN:", v.error); continue; }
      if (p.fen.split(" ")[1] !== "w") { fail(p.id, "not white to move"); continue; }
      // the side NOT to move must not be in check (position would be illegal)
      const flipped = new Chess(p.fen.replace(" w ", " b "));
      if (flipped.in_check()) { fail(p.id, "black already in check"); continue; }
      // tactical motifs: force winning `target` by ≥ gain against every defense
      if (p.cat === "tac") {
        if (typeof p.gain !== "number" || p.gain < 1) { fail(p.id, "tac needs gain ≥ 1"); continue; }
        if (!/^[a-h][1-8]$/.test(p.target || "")) { fail(p.id, "tac needs a target square"); continue; }
        if (!Array.isArray(p.line) || !p.line.length) { fail(p.id, "tac needs a display line"); continue; }
        const gt = new Chess(p.fen);
        const fm = gt.move(p.first);
        if (!fm) { fail(p.id, "tac first illegal:", p.first); continue; }
        if (fm.san !== p.first || p.line[0] !== p.first) fail(p.id, "tac first/line mismatch");
        if (p.line.length === 1) {
          // discovered/one-move: the first move itself captures target for ≥ gain
          if (fm.to !== p.target || !fm.captured) { fail(p.id, "1-ply tac must capture target"); continue; }
          let net = VAL[fm.captured];
          if (gt.moves({ verbose: true }).some((r) => r.to === p.target)) net -= VAL[fm.piece];
          if (net < p.gain) fail(p.id, "1-ply tac net " + net + " < gain " + p.gain);
        } else if (p.line.length === 3) {
          // skewer/fork: every black reply lets white capture target ≥ gain.
          // Pin motifs (牵制) attack an immobilized piece instead — their first
          // move builds the attack quietly, so no check is required there.
          if (p.motif !== "牵制" && !gt.in_check()) fail(p.id, "3-ply tac first move should check");
          const replies = gt.moves();
          if (!replies.length) { fail(p.id, "no black reply (should not mate here)"); continue; }
          for (const r of replies) {
            gt.move(r);
            const cap = bestCapture(gt, p.target);
            gt.undo();
            if (cap == null || cap < p.gain) { fail(p.id, "tac refuted by " + r + " (cap " + cap + ")"); break; }
          }
          // the stored line must be legal and end capturing the target
          const gl = new Chess(p.fen);
          gl.move(p.line[0]);
          const rr = gl.move(p.line[1]);
          const cc = rr ? gl.move(p.line[2]) : null;
          if (!rr || !cc) fail(p.id, "stored tac line illegal");
          else if (cc.to !== p.target || !cc.captured) fail(p.id, "stored line does not capture target");
        } else {
          fail(p.id, "tac line must be 1 or 3 plies");
        }
        continue;
      }
      // Real-game tactics claim four things about the diagram, and all four are
      // what separates them from the constructed ones: a crowded board, White
      // not already down material (a recapture is not a tactic — that rule alone
      // rejected 30 of the first 48 candidates), more than one capture on offer
      // so the key move cannot be found by elimination, and a stored line whose
      // material swing really is the advertised `gain`. That the key move is the
      // *only* one that wins is an engine claim, checked by
      // scripts/test-tactics.mjs rather than here.
      if (p.cat === "real") {
        if (typeof p.gain !== "number" || p.gain < 2) { fail(p.id, "real needs gain ≥ 2"); continue; }
        const men = (p.fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
        if (men < 20) { fail(p.id, "real needs a middlegame: " + men + " men"); continue; }
        if (men !== p.men) { fail(p.id, "real men " + p.men + " != " + men + " on the board"); continue; }
        if (!Array.isArray(p.line) || p.line.length !== 3) { fail(p.id, "real line is 3 plies"); continue; }
        const g0 = new Chess(p.fen);
        const bal = (fen) => {
          let n = 0;
          for (const row of new Chess(fen).board()) for (const q of row) {
            if (q) n += (q.color === "w" ? 1 : -1) * (VAL[q.type] || 0);
          }
          return n;
        };
        if (bal(p.fen) < 0) { fail(p.id, "white is already down material — this is a recapture"); continue; }
        if (g0.moves({ verbose: true }).filter((m) => m.captured).length < 2) {
          fail(p.id, "only one capture on the board — findable by elimination"); continue;
        }
        let ok = true;
        for (const san of p.line) {
          const mv = g0.move(san, { sloppy: false });
          if (!mv || mv.san !== san) { fail(p.id, "real line illegal/non-canonical at " + san); ok = false; break; }
        }
        if (!ok) continue;
        const swing = bal(g0.fen()) - bal(p.fen);
        if (swing !== p.gain) fail(p.id, "real gain " + p.gain + " but the line swings " + swing);
        continue;
      }
      // Defensive puzzles claim something specific: Black is threatening mate in
      // one *right now*, and the stored answer takes that mate off the board.
      // Both halves are checked, because a "defence" against a threat that was
      // never there teaches the opposite of what it says on the tin. Unlike the
      // mates, these do not have to be unique — the runtime accepts any move
      // that holds, because in a real game any move that holds is correct — but
      // there must be at least one move that loses, or there is nothing to find.
      if (p.cat === "def") {
        if (!Array.isArray(p.solution) || p.solution.length !== 1) { fail(p.id, "def solution is one move"); continue; }
        const bl = new Chess(p.fen.replace(" w ", " b "));
        const threat = mateIn1(bl);
        if (!threat) { fail(p.id, "black is not actually threatening mate in 1"); continue; }
        const gd = new Chess(p.fen);
        const all = gd.moves();
        const holds = all.filter((m) => {
          gd.move(m);
          const ok = gd.game_over() || !mateIn1(gd);
          gd.undo();
          return ok;
        });
        if (!holds.includes(p.solution[0])) {
          fail(p.id, "solution " + p.solution[0] + " does not stop " + threat);
        }
        if (!holds.length) fail(p.id, "no defence exists — the position is already lost");
        if (holds.length >= all.length) fail(p.id, "every move holds — nothing to find");
        // the tier is derived from this number, so a stale one silently
        // mis-sorts the puzzle in the difficulty filter
        if (p.saves !== holds.length) {
          fail(p.id, "saves is " + p.saves + " but " + holds.length + " moves actually hold");
        }
        continue;
      }

      // Drawing puzzles: White is losing and one line holds the half point. The
      // line has to *end* in a real draw — a stalemate, or a repetition reached
      // by checks that Black could not sidestep.
      if (p.cat === "draw") {
        if (!Array.isArray(p.solution) || p.solution.length < 2) { fail(p.id, "draw needs a line"); continue; }
        const gd = new Chess(p.fen);
        const seen = [gd.fen().split(" ").slice(0, 4).join(" ")];
        let broke = false, allChecks = true;
        for (let i = 0; i < p.solution.length; i++) {
          const m = gd.move(p.solution[i]);
          if (!m) { fail(p.id, "draw line illegal at ply " + i + ":", p.solution[i]); broke = true; break; }
          if (m.san !== p.solution[i]) fail(p.id, "non-canonical SAN", p.solution[i], "≠", m.san);
          if (i % 2 === 0 && !gd.in_check()) allChecks = false;
          // A perpetual only saves the game if Black cannot sidestep it, so
          // every reply in that line has to be forced. A stalemate trick is the
          // opposite kind of claim — it is bait, and bait Black is free to
          // decline — so there the requirement is that Black *can* go wrong.
          if (p.via === "perpetual" && i % 2 === 0 && i + 1 < p.solution.length && gd.moves().length !== 1) {
            fail(p.id, "black has a choice at ply " + (i + 1) + " (" + gd.moves().length + " replies)");
          }
          if (p.via === "stalemate" && i % 2 === 0 && gd.moves().length < 3) {
            fail(p.id, "the trap is not a trap — black has almost no choice");
          }
          seen.push(gd.fen().split(" ").slice(0, 4).join(" "));
        }
        if (broke) continue;
        const last = seen[seen.length - 1];
        const repeats = seen.filter((f) => f === last).length >= 2;
        const stalemate = gd.in_stalemate();
        if (p.via === "stalemate") {
          if (!stalemate) fail(p.id, "line does not end in stalemate");
          // the bait has to be worth taking, or nobody would take it
          const bait = new Chess(p.fen);
          bait.move(p.solution[0]);
          const grab = bait.move(p.solution[1]);
          if (!grab || !grab.captured) fail(p.id, "black's reply is not the capture that springs the trap");
          // and White has to be genuinely lost, or a draw is not a save
          const VALS = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
          let wm = 0, bm = 0;
          for (const row of new Chess(p.fen).board()) for (const s of row || []) {
            if (s) (s.color === "w" ? (wm += VALS[s.type]) : (bm += VALS[s.type]));
          }
          if (bm - wm < 4) fail(p.id, "white is not losing (deficit " + (bm - wm) + ") — nothing to save");
        } else if (p.via === "perpetual") {
          if (!allChecks) fail(p.id, "perpetual line contains a move that is not a check");
          if (!repeats) fail(p.id, "perpetual line does not repeat the position");
        } else {
          fail(p.id, "draw puzzle needs via: stalemate | perpetual");
        }
        continue;
      }

      const g = new Chess(p.fen);
      const mv = g.move(p.solution[0]);
      if (!mv) { fail(p.id, "solution[0] illegal:", p.solution[0]); continue; }
      if (mv.san !== p.solution[0]) fail(p.id, "non-canonical SAN", p.solution[0], "≠", mv.san);
      if (p.cat === "win") {
        if (typeof p.gain !== "number" || p.gain < 1) { fail(p.id, "win puzzle needs gain ≥ 1"); continue; }
        if (p.solution.length === 1) {
          // one-mover: the stored move must be the UNIQUE best material swing
          const s0 = swing(p.fen, p.solution[0]);
          if (s0 == null || s0 < p.gain) { fail(p.id, "solution swing", s0, "< gain", p.gain); continue; }
          for (const alt of new Chess(p.fen).moves()) {
            if (alt === p.solution[0]) continue;
            const sa = swing(p.fen, alt);
            if (sa != null && sa >= p.gain) fail(p.id, "not unique: " + alt + " also gains " + sa);
          }
        }
        if (p.solution.length === 3) {
          // forced two-mover: black has exactly one legal reply
          const replies = g.moves();
          if (replies.length !== 1) fail(p.id, "black reply not forced (" + replies.length + " moves)");
          else if (replies[0] !== p.solution[1]) fail(p.id, "stored reply mismatch:", replies[0]);
          const rm = g.move(p.solution[1]);
          const wm = rm ? g.move(p.solution[2]) : null;
          if (!rm || !wm) { fail(p.id, "two-mover line illegal"); continue; }
          if (wm.san !== p.solution[2]) fail(p.id, "non-canonical SAN", p.solution[2]);
          if (!wm.captured || VAL[wm.captured] < p.gain) fail(p.id, "final capture below gain");
        } else if (p.solution.length !== 1) {
          fail(p.id, "win solutions are 1 or 3 plies");
        }
        continue;
      }
      const totalMoves = { m1: 1, m2: 2, m3: 3 }[p.cat];
      if (p.cat === "m1") {
        if (p.solution.length !== 1) fail(p.id, "m1 solution must be one move");
        if (!g.in_checkmate()) fail(p.id, "m1 solution does not mate");
      } else {
        if (p.solution.length !== totalMoves * 2 - 1) { fail(p.id, "wrong solution length"); continue; }
        if (g.in_checkmate() || g.game_over()) { fail(p.id, "first move already ends the game"); continue; }
        // no shortcut: the puzzle must genuinely need its full move budget
        if (whiteHasForcedMate(new Chess(p.fen), totalMoves - 1)) {
          fail(p.id, "solvable in fewer moves — belongs in an easier category");
        }
        if (!blackForcedLost(g, totalMoves - 1)) fail(p.id, "first move does not force mate");
        let broke = false;
        for (let i = 1; i < p.solution.length; i++) {
          const m = g.move(p.solution[i]);
          if (!m) { fail(p.id, "solution[" + i + "] illegal:", p.solution[i]); broke = true; break; }
          if (m.san !== p.solution[i]) fail(p.id, "non-canonical SAN", p.solution[i], "≠", m.san);
        }
        if (!broke && !g.in_checkmate()) fail(p.id, "line does not end in mate");
      }
    }
    assert(bad === 0, "all puzzles legal and forced");

    // A puzzle title is a promise about the solution, and v1.6 broke that promise
    // at scale: eight mates titled "two rooks close the net" were answered by a
    // KING move, because the "the named piece must be the one that moves" rule
    // was only applied to the capture puzzles.
    //
    // This check is deliberately scoped to the machine-generated sets. A
    // hand-written title is prose - "take the hanging queen" names the piece you
    // capture, "skewer wins the queen" names the piece you win three plies later
    // - and no lint reads that correctly. A generator, by contrast, mints titles
    // mechanically and can mislabel fifty puzzles without anyone noticing, so its
    // titles must name the piece that plays the key move.
    const GENERATED = /^(m2-net|m3-hunt|w-gen|t-gen)-/;
    const PIECE_WORDS = {
      k: ["\u738b", "king"], q: ["\u540e", "queen"], r: ["\u8f66", "rook"],
      b: ["\u8c61", "bishop"], n: ["\u9a6c", "knight"], p: ["\u5175", "pawn"],
    };
    let named = 0, generatedSeen = 0;
    for (const p of puzzles) {
      if (!GENERATED.test(p.id)) continue;
      generatedSeen++;
      const key = (p.line || p.solution || [])[0];
      const mv = new Chess(p.fen).move(key);
      if (!mv) continue;
      const zh = p.name || "";
      const enRaw = (ctx.CHESS_PUZZLES_EN[p.id] || {}).name || "";
      const moverWords = PIECE_WORDS[mv.piece];
      // both languages must name it — an OR here would let an English user read
      // "discovered check wins the bishop" while a knight does the work
      const zhOk = zh.includes(moverWords[0]);
      const enOk = enRaw.toLowerCase().includes(moverWords[1]);
      if (zhOk && enOk) continue;
      named++;
      console.error("FAIL: " + p.id + " titled \"" + zh + "\" / \"" + enRaw + "\" — " +
        (zhOk ? "the English name" : enOk ? "the Chinese name" : "neither name") +
        " omits the " + mv.piece + " that plays its key move " + key);
    }
    assert(generatedSeen > 0, "generated-title check has puzzles to check (" + generatedSeen + ")");
    assert(named === 0, "every generated puzzle title names the piece that plays its key move");

    // Variety, again scoped to the generated set. v1.6's generated block was
    // 21/23 "K + two pieces vs a lone king" and every position looked the same.
    // Hand-authored lone-king mates are deliberate — the Arabian mate, the
    // two-bishop mate and the quiet-move zugzwangs are *taught* on a bare board
    // so the pattern is unmistakable — so the rule must not touch them.
    const genMates = puzzles.filter((p) => GENERATED.test(p.id) && ["m1", "m2", "m3"].includes(p.cat));
    const lonelyKing = genMates.filter((p) => (p.fen.split(" ")[0].match(/[a-z]/g) || []).length <= 1);
    assert(genMates.length > 0 && lonelyKing.length <= genMates.length * 0.35,
      "generated mates are not all the same shape (" + lonelyKing.length + "/" + genMates.length +
      " face a lone king)");
  }
}
