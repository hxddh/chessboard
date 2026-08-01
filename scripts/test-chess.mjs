/**
 * Node tests for the vendored rules engine (chess.js) — the app's single
 * source of truth for legality. Run: node scripts/test-chess.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { compileModuleSync } from "./bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");

/**
 * Run one app module inside a vm context, exports landing as globals.
 *
 * Up to 1.25 this was `vm.runInContext(readFileSync(f))` at 26 call sites: the
 * files were IIFEs writing to `global`, so running one *was* loading it, and
 * the test had to know the load order (openings.js before the openings tests,
 * pieces.js before board.js). They are ES modules now, so this compiles them —
 * imports and all — and publishes the exports the way the old wrapper did.
 * The order is the bundler's to work out; the call sites just name what they
 * want.
 */
function loadModule(context, rel) {
  const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
  vm.runInContext(compileModuleSync(abs), context, { filename: path.basename(abs) });
}
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
loadModule(ctx, "src/web/js/chess.js");
const Chess = ctx.Chess;

/** shapes handed to the headless render check (scripts/test-render.mjs) */
let boardShapes = [];
let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}

// start position basics
{
  const g = new Chess();
  assert(g.moves().length === 20, "20 legal moves from start");
  assert(g.turn() === "w", "white to move");
  assert(g.fen() === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", "start FEN");
}

// scholar's mate → checkmate detection
{
  const g = new Chess();
  for (const m of ["e4", "e5", "Bc4", "Nc6", "Qh5", "Nf6", "Qxf7#"]) {
    assert(g.move(m) !== null, "move " + m);
  }
  assert(g.in_checkmate(), "scholar's mate is checkmate");
  assert(g.game_over(), "game over");
}

// pinned piece cannot move (self-check is illegal)
{
  const g = new Chess("4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1");
  // Ne2 is pinned by the e4 rook against the e1 king
  assert(!g.in_check(), "not currently in check");
  assert(g.move("Nc3") === null, "moving the pinned knight is illegal");
  assert(g.move("Kd1") !== null, "king step aside is legal");
}

// fool's mate position is mate (every move illegal)
{
  const g = new Chess("rnb1kbnr/pppp1ppp/8/4p3/6Pq/5P2/PPPPP2P/RNBQKBNR w KQkq - 1 3");
  assert(g.in_check(), "white in check");
  assert(g.in_checkmate(), "fool's mate is checkmate");
  assert(g.moves().length === 0, "no legal moves");
}

// castling
{
  const g = new Chess("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4");
  const mv = g.move("O-O");
  assert(mv !== null && mv.flags.includes("k"), "kingside castle");
  assert(g.get("g1") && g.get("g1").type === "k", "king on g1");
  assert(g.get("f1") && g.get("f1").type === "r", "rook on f1");
}

// en passant
{
  const g = new Chess("rnbqkbnr/ppp1p1pp/8/3pPp2/8/8/PPPP1PPP/RNBQKBNR w KQkq f6 0 3");
  const mv = g.move("exf6");
  assert(mv !== null && mv.flags.includes("e"), "en passant capture");
}

// promotion
{
  const g = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
  const mv = g.move({ from: "a7", to: "a8", promotion: "q" });
  assert(mv !== null && mv.promotion === "q", "promotion to queen");
  assert(g.get("a8").type === "q", "queen on a8");
}

// underpromotion (the in-app chooser relies on all four pieces working)
for (const p of ["r", "b", "n"]) {
  const g = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
  const mv = g.move({ from: "a7", to: "a8", promotion: p });
  assert(mv !== null && mv.promotion === p, "underpromotion to " + p);
  assert(g.get("a8").type === p, p + " on a8");
}

// stalemate
{
  const g = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1");
  assert(g.in_stalemate(), "stalemate detected");
  assert(!g.in_checkmate(), "stalemate is not mate");
}

// insufficient material
{
  const g = new Chess("8/8/8/4k3/8/8/4K3/8 w - - 0 1");
  assert(g.insufficient_material(), "K vs K insufficient material");
}

// PGN round-trip
{
  const g = new Chess();
  for (const m of ["d4", "d5", "c4", "e6", "Nc3", "Nf6"]) g.move(m);
  const pgn = g.pgn();
  const g2 = new Chess();
  assert(g2.load_pgn(pgn), "PGN loads");
  assert(g2.history().length === 6, "PGN history length");
  assert(g2.fen() === g.fen(), "PGN round-trip FEN match");
}

// FEN round-trip after moves
{
  const g = new Chess();
  g.move("e4"); g.move("c5");
  const g2 = new Chess(g.fen());
  assert(g2.fen() === g.fen(), "FEN round-trip");
  assert(g2.moves().length === g.moves().length, "same legal moves from FEN");
}

// undo restores position
{
  const g = new Chess();
  const before = g.fen();
  g.move("e4");
  g.undo();
  assert(g.fen() === before, "undo restores start");
}

// FEN-start PGN: load_pgn honors [SetUp]/[FEN]; pgn() preserves them;
// replaying history from the header FEN reproduces the final position
// (the app's replay/analysis/retry all rely on this)
{
  const startFen = "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1";
  const pgn = '[SetUp "1"]\n[FEN "' + startFen + '"]\n\n1. Qa8+ Kd7 2. Qb7+ Kd6';
  const g = new Chess();
  assert(g.load_pgn(pgn, { sloppy: true }), "FEN-start PGN loads");
  assert(g.header().FEN === startFen && g.header().SetUp === "1", "FEN header retained");
  const r = new Chess(startFen);
  for (const san of g.history()) assert(r.move(san) !== null, "replay-from-header move " + san);
  assert(r.fen() === g.fen(), "replay from header FEN reproduces the game");
  const g2 = new Chess();
  assert(g2.load_pgn(g.pgn()) && g2.fen() === g.fen(), "FEN-start save/restore round-trip");
  g.reset();
  assert(!g.header().FEN, "reset clears the FEN header for a fresh game");
}

// opening book: every line must be legal, canonical SAN, unique, well-formed
{
  loadModule(ctx, "src/web/js/openings.js");
  const book = ctx.CHESS_OPENINGS;
  assert(Array.isArray(book) && book.length > 50, "opening book loaded (" + (book ? book.length : 0) + " entries)");
  const seen = new Set();
  let bad = 0;
  for (const entry of book) {
    const [eco, name, seq] = entry;
    if (!/^[A-E]\d\d$/.test(eco)) { bad++; console.error("FAIL: bad ECO code", eco, name); continue; }
    if (typeof name !== "string" || !name) { bad++; console.error("FAIL: bad name for", eco); continue; }
    if (seen.has(seq)) { bad++; console.error("FAIL: duplicate line", eco, seq); continue; }
    seen.add(seq);
    const g = new Chess();
    for (const san of seq.split(" ")) {
      const mv = g.move(san);
      if (!mv) { bad++; console.error("FAIL: illegal move", san, "in", eco, name, "(" + seq + ")"); break; }
      if (mv.san !== san) { bad++; console.error("FAIL: non-canonical SAN", san, "≠", mv.san, "in", eco, name); break; }
    }
  }
  assert(bad === 0, "all opening lines legal, canonical and unique");

  // Depth. Only lines of six plies or more become drills, and until 1.15 there
  // were 38 of them with the longest running ten plies — five moves, which is
  // not an opening anyone can rehearse into a game. Soundness of the lines
  // themselves is a separate, slower check: scripts/test-openings.mjs plays
  // each one out and asks the engine whether it ends anywhere near equal.
  const drills = book.filter(([, , seq]) => seq.split(" ").length >= 6);
  const deep = drills.filter(([, , seq]) => seq.split(" ").length >= 14);
  assert(drills.length >= 100, "at least 100 lines are long enough to drill (" + drills.length + ")");
  assert(deep.length >= 60, "at least 60 drills run 14 plies or more (" + deep.length + ")");
  const longest = Math.max(...drills.map(([, , seq]) => seq.split(" ").length));
  assert(longest >= 18, "the longest line runs at least 18 plies (" + longest + ")");

  // Every drilled line needs its own name, because the name is the key both
  // the English table and the idea table are looked up by — two lines sharing
  // a name silently share one explanation.
  const drillNames = drills.map((e) => e[1]);
  const dupName = drillNames.find((n, i) => drillNames.indexOf(n) !== i);
  assert(!dupName, "every drilled line has its own name" + (dupName ? " — repeated: " + dupName : ""));

  // The difficulty filter has to actually split this category. It never did:
  // an opening drill carries no FEN, so every term in the tactic scale except
  // length silently skipped, leaving score = (plies-1)*1.5 + 3 — at least 10.5
  // for the shortest line in the book against a "hard" threshold of 6. All 38
  // drills in 1.14 were "hard", and nobody noticed because 38 rows fit on a
  // screen. Mirror the rule here so a future edit cannot collapse it again.
  const opTier = (plies) => (plies <= 8 ? "easy" : plies <= 16 ? "mid" : "hard");
  const bands = {};
  for (const [, , seq] of drills) {
    const b2 = opTier(seq.split(" ").length);
    bands[b2] = (bands[b2] || 0) + 1;
  }
  const src = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  assert(/cat === "op"[\s\S]{0,400}?plies <= 8 \? "easy" : plies <= 16 \? "mid" : "hard"/.test(src),
    "opening drills get their own tier rule rather than the tactic scale");
  assert(Object.keys(bands).length === 3 && Math.min(...Object.values(bands)) >= 15,
    "the difficulty filter splits the drills three ways (" + JSON.stringify(bands) + ")");
}

// lessons: every FEN valid, every solution legal and goal-satisfying,
// star paths clear all stars without ever checking the decorative kings
loadModule(ctx, "src/web/js/i18n.js");
// Every interface language other than the Chinese source needs content of its
// own. Through 1.20 this was hard-coded to English, which is precisely how ja
// ended up with a 589-key interface — not one key missing — wrapped around
// English lessons: the guard enforced trilingual chrome and bilingual
// teaching, and the gap it left is exactly the gap that existed.
const CONTENT_LANGS = Object.keys(ctx.ChessI18n.DICT).filter((l) => l !== "zh-CN");
assert(CONTENT_LANGS.length >= 2, "there is more than one content language (" + CONTENT_LANGS.join(", ") + ")");
/** the global suffix a language's tables use: en → _EN, ja → _JA */
const sfx = (lang) => lang.toUpperCase().replace(/-/g, "_");
const han = /[一-鿿]/;
const kana = /[぀-ヿ]/;
/**
 * "Still untranslated" reads differently per language. English must contain
 * no Han at all. Japanese *writes* in Han, so the same test would be nonsense;
 * there the precise signal is a string left character-for-character identical
 * to the Chinese original.
 *
 * The first version of this also flagged any Han-without-kana string, on the
 * theory that natural Japanese prose always carries some kana. It does — but
 * short LABELS need not: "実戦 01" is perfectly good Japanese and was reported
 * as untranslated. The per-string rule is now exact, and the kana heuristic
 * moved to `kanaRatio` below, where it is applied to the corpus rather than to
 * individual strings.
 */
const untranslated = (lang, str, source) => {
  if (typeof str !== "string" || !str) return false;
  if (lang === "ja") return str === source;
  return han.test(str);
};
/** share of a language's strings that carry kana — a corpus-level smell test */
function kanaRatio(root) {
  let total = 0, withKana = 0;
  const walk = (v) => {
    if (typeof v === "string") { if (v.trim()) { total++; if (kana.test(v)) withKana++; } return; }
    if (Array.isArray(v)) return v.forEach(walk);
    if (v && typeof v === "object") return Object.values(v).forEach(walk);
  };
  walk(root);
  return total ? withKana / total : 1;
}

// ---------------------------------------------------------- Japanese scanners
// These were written for lessons-ja and lived inside that loop, which is why
// openings-ja and puzzles-ja — 452 more strings, added in 1.21 — were never
// scanned at all. They were clean when this was hoisted, which is the only
// reason nothing was found; a corpus nobody scans stays clean by luck.

/**
 * Latin runs that are legitimate inside Japanese chess prose: SAN moves, file
 * letters, roman numerals, a few UI keys and abbreviations. Opening ideas also
 * chain moves with hyphens and plus signs ("d4-Nf3-Bf4-e3", "c4+e4"), so a
 * token is legitimate when every piece of it is.
 */
const NOTATION = /^(?:[KQRBNP]?[a-h]?[1-8]?x?[a-h][1-8](?:=[QRBN])?[+#]?|O-O(?:-O)?|[A-Za-z]|I{1,3}|IV|VI{0,3}|Ctrl(?:\+Z)?|ECO|QGD)$/;
const notation = (word) => word.split(/[-+]/).filter(Boolean).every((part) => NOTATION.test(part));

/**
 * Scripts Japanese text legitimately uses, plus the punctuation and symbols the
 * prose actually carries: the multiplication sign in "8×8", the Command glyph,
 * "≠", arrows, em dashes.
 */
const JA_OK = /[　-〿぀-ヿ一-鿿＀-￯ -~‐-‧‰-⁞←-⇿①-⓿■-⛿×≠⌘–—]/;

/** walk every string in a nested value, reporting `path: string` positions */
function eachString(root, where, fn) {
  const walk = (v, p) => {
    if (typeof v === "string") return fn(v, p);
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, p + "[" + i + "]"));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, p + "." + k));
  };
  walk(root, where);
}

/**
 * The three corpus-level checks on a Japanese table: it reads as Japanese, no
 * loose English drifted into the prose, and no third script leaked in.
 *
 * `kanaMin` is per-corpus because kana density is a property of what the table
 * holds, not of the language. Prose is ~100%; a table of short labels is not,
 * and puzzles-ja is 87% purely because "実戦 01"–"実戦 23" are kanji and digits.
 * That is the same fact this file already records above `untranslated` — the
 * threshold states it rather than being tuned until it passes.
 */
function checkJapanese(label, table, kanaMin, minStrings) {
  // An empty table passes every check below — kanaRatio returns 1, and neither
  // scan has anything to walk. That is how a renamed global would turn this
  // into three lines of `ok` guarding nothing, so count first.
  let strings = 0;
  eachString(table, label, (v) => { if (v.trim()) strings++; });
  assert(strings >= minStrings, label + ": found " + strings + " strings, expected at least " + minStrings);

  const ratio = kanaRatio(table);
  assert(ratio >= kanaMin, label + " reads as Japanese (kana in " + Math.round(ratio * 100) + "% of strings, floor " + Math.round(kanaMin * 100) + "%)");

  let latin = 0;
  eachString(table, label, (v, where) => {
    for (const w of v.match(/[A-Za-z][A-Za-z0-9=+#-]*/g) || []) {
      if (notation(w)) continue;
      latin++;
      console.error("FAIL: stray English word in " + where + ": " + w);
    }
  });
  assert(latin === 0, label + " carries no stray English words");

  let alien = 0;
  eachString(table, label, (v, where) => {
    for (const ch of v) {
      if (JA_OK.test(ch)) continue;
      alien++;
      console.error("FAIL: character outside Japanese scripts in " + where + ": " + ch +
        " (U+" + ch.codePointAt(0).toString(16).toUpperCase() + ")");
    }
  });
  assert(alien === 0, label + " uses only Japanese scripts");
}

{
  loadModule(ctx, "src/web/js/lessons.js");
  const lessons = ctx.CHESS_LESSONS;
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
    const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
    const fnSrc = (appSrc.match(/function lessonParagraph[\s\S]*?\n {2}\}/) || [])[0];
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
{
  const bundled = compileModuleSync(path.join(root, "src/web/js/app.js"));
  const missing = [];
  for (const lang of CONTENT_LANGS) {
    for (const kind of ["lessons", "puzzles", "openings"]) {
      const name = `CHESS_${kind.toUpperCase()}_${sfx(lang)}`;
      if (!bundled.includes(name)) missing.push(`${kind}-${lang}.js`);
    }
  }
  assert(missing.length === 0,
    "the bundle contains every content translation" + (missing.length ? " — missing " + missing.join(", ") : ""));
}

for (const lang of CONTENT_LANGS) {
  const file = "src/web/js/lessons-" + lang + ".js";
  assert(fs.existsSync(path.join(root, file)), file + " exists");
  if (!fs.existsSync(path.join(root, file))) continue;
  loadModule(ctx, file);
  const en = ctx["CHESS_LESSONS_" + sfx(lang)];
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

// The keyboard reference and the native menu. 1.9 moved the panel from Tab to
// P and nothing anywhere said so — not a tooltip, not a menu, not a help sheet.
// These lock in both halves of the fix and, more importantly, that they agree.
{
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  const htmlK = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
  const zon = fs.readFileSync(path.join(root, "app.zon"), "utf8");

  assert(/id="keys-modal"/.test(htmlK), "the shortcut sheet exists");
  const table = /const KEY_HELP = \[([\s\S]*?)\];/.exec(appSrc);
  assert(table, "the shortcut sheet is built from a table");
  const helpKeys = [...table[1].matchAll(/k: "(keys\.[a-z]+)"/g)].map((m) => m[1]);
  assert(helpKeys.length >= 10, "the sheet lists the shortcuts (" + helpKeys.length + ")");

  // every letter the global handler binds must appear in the sheet
  const listed = table[1].toLowerCase();
  for (const key of ["p", "n", "z", "h", "f"]) {
    assert(new RegExp('"' + key + '"', "i").test(table[1]),
      "the sheet lists the " + key.toUpperCase() + " shortcut");
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
  const handled = /const NATIVE_COMMANDS = \{([\s\S]*?)\n  \};/.exec(appSrc);
  assert(handled, "app.js handles native menu commands");
  const unhandled = commands.filter((c) => !handled[1].includes('"' + c + '"'));
  assert(unhandled.length === 0,
    "every menu item does something" + (unhandled.length ? " — dead: " + unhandled.join(", ") : ""));
  assert(/handlers\.shortcut/.test(fs.readFileSync(path.join(root, "src/web/js/host.js"), "utf8")),
    "the host bridge forwards the shortcut event");
  assert(/shortcut: \(detail\)/.test(appSrc), "app.js subscribes to it");
}

// The design system. Every one of these numbers was measured on 1.11 and every
// one of them was a symptom of the same thing: no scale, so each new rule
// picked whatever value looked right that day. 12 font sizes including 10.5,
// 11.5 and 12.5px; 17 distinct paddings from 1px to 22px; 10 radii while three
// radius tokens already existed unused; 25 hard-coded hex colours outside the
// theme blocks. None of it is a bug. All of it is why the app looked assembled
// rather than designed.
{
  const css = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, "");

  // spacing: an 8-step scale, and nothing between the steps
  const SPACE = new Set(["0px", "2px", "4px", "6px", "8px", "12px", "16px", "20px", "24px"]);
  const strays = [];
  for (const m of stripped.matchAll(/\b(padding|margin|gap|row-gap|column-gap)(?:-\w+)?\s*:\s*([^;{}]+);/g)) {
    if (/var\(|calc/.test(m[2])) continue;
    for (const tok of m[2].trim().split(/\s+/)) {
      if (/^\d+(\.\d+)?px$/.test(tok) && !SPACE.has(tok)) strays.push(m[1] + ": " + tok);
    }
  }
  assert(strays.length === 0,
    "spacing stays on the 8-step scale" + (strays.length ? " — off it: " + [...new Set(strays)].slice(0, 6).join(", ") : ""));

  // motion: three durations and one curve, the same shape the type scale and
  // the leading scale already have. 1.13 was running seven durations and three
  // easings across 21 transitions, plus a fourth number written in board.js.
  {
    const bare = [];
    const eases = new Set();
    const durs = new Set();
    for (const m of stripped.matchAll(/\btransition\s*:\s*([^;{}]+);/g)) {
      for (const v of m[1].match(/(?<![\w-])\.?\d*\.?\d+m?s/g) || []) bare.push(v);
      for (const v of m[1].match(/var\(--dur-\w+\)/g) || []) durs.add(v);
      for (const v of m[1].match(/(?<![\w-])(ease-in-out|ease-in|ease-out|linear|ease|cubic-bezier\([^)]*\))/g) || []) eases.add(v);
      for (const v of m[1].match(/var\(--ease\)/g) || []) eases.add("var(--ease)");
    }
    assert(bare.length === 0,
      "no transition writes a duration in place" + (bare.length ? " — " + [...new Set(bare)].join(", ") : ""));
    assert(durs.size <= 3, "transitions use at most three duration tokens (" + [...durs].join(", ") + ")");
    assert(eases.size === 1 && eases.has("var(--ease)"),
      "one easing curve, everywhere (" + [...eases].join(", ") + ")");
    const board = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
    assert(/getPropertyValue\("--dur-base"\)/.test(board),
      "the board's slide reads --dur-base rather than a number of its own");
    assert(!/dur:\s*\d/.test(board), "no hard-coded animation duration left in board.js");

    // …and nothing waits for a transition the stylesheet does not declare.
    // app.js carried a transitionend handler for #board-wrap's width/height
    // for several versions, with a comment explaining that the panel toggle
    // animates them over 280ms. The stylesheet says the opposite, in its own
    // comment, and has since 1.13: the board snaps to its new size on purpose
    // (+84% at 1000x1000 — watching that grow is worse than finding it grown).
    // So the branch never ran. The comment was simply older than the CSS, and
    // this repo's comments are the most valuable thing in it precisely because
    // they record measurements — which makes a stale one expensive. Defect 11.
    const appSrcT = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
    const transitioned = new Set();
    for (const m of stripped.matchAll(/#board-wrap[^{}]*\{([^{}]*)\}/g)) {
      for (const t of (m[1].match(/transition:\s*([^;]+);/) || [, ""])[1].split(","))
        transitioned.add(t.trim().split(/\s+/)[0]);
    }
    for (const prop of ["width", "height"]) {
      const waits = new RegExp('propertyName === "' + prop + '"').test(appSrcT);
      assert(!waits || transitioned.has(prop),
        "nothing waits for a #board-wrap " + prop + " transition the stylesheet never declares");
    }
  }

  // vertical rhythm: one control height, one label height, and gaps that are
  // multiples of 8. Declared spacing was already on the scale before this; the
  // *rendered* gaps were 8 / 12.5 / 39.9 / 80.8, because a block's height was
  // whatever its text happened to occupy.
  {
    const heights = [...stripped.matchAll(/min-height:\s*([^;{}]+);/g)].map((m) => m[1].trim());
    const stray = heights.filter((v) => /^\d/.test(v) && v !== "0" && v !== "0px");
    assert(stray.length === 0,
      "every control height comes from a token" + (stray.length ? " — off it: " + [...new Set(stray)].join(", ") : ""));
    for (const tokName of ["--row-h", "--row-h-sm", "--label-h"])
      assert(new RegExp(tokName + ":\\s*\\d+px").test(stripped), tokName + " is defined");
    const tabH = /\.side-tabs button\[role="tab"\]\s*\{[^}]*min-height:\s*var\(--row-h\)/.test(stripped);
    assert(tabH, "the tab row's height comes from --row-h");
  }

  // The chrome is one strip, so everything standing in it is one height and one
  // baseline. It used to run three (36 / 32 / 27.4) and two baselines, because
  // the mode row sized itself from --row-h, the buttons were a literal 32, and
  // the status pill had no height at all — it was 4px of padding around
  // whatever the text measured. Nothing in the bar shared a unit, which is why
  // it could not be aligned, only nudged.
  {
    assert(/--chrome-ctl-h:\s*\d+px/.test(stripped), "the chrome has one control-height token");
    for (const sel of [/\.chrome \.tool-btn \{[^}]*height:\s*var\(--chrome-ctl-h\)/,
                       /\.chrome \.icon-btn \{[^}]*height:\s*var\(--chrome-ctl-h\)/,
                       /\.status-pill \{[^}]*height:\s*var\(--chrome-ctl-h\)/])
      assert(sel.test(stripped), "…and every control in it is that height — " + sel.source.slice(0, 22));
    const chrome = /\n    \.chrome \{([\s\S]*?)\n    \}/.exec(stripped);
    assert(chrome, ".chrome is styled");
    const pad = /padding:\s*([^;]+);/.exec(chrome[1]);
    assert(pad && pad[1].trim().split(/\s+/).length === 2,
      "the bar's left and right insets are the same (" + (pad ? pad[1].trim() : "?") + ")");
  }

  // the replay bar was the heaviest object in a panel of text links: a filled,
  // bordered slab of 10800px², nine times the area of anything else in it
  {
    const bar = /\.replay-bar\s*\{([^}]*)\}/.exec(stripped);
    assert(!!bar, ".replay-bar is styled");
    assert(/background:\s*transparent/.test(bar[1]), "the replay bar carries no fill");
    assert(!/\bborder:\s*1px/.test(bar[1]), "the replay bar is a rule, not a box");
  }

  // type: six steps, and no half pixels
  const TYPE = new Set(["11px", "12px", "13px", "15px", "16px", "19px", "30px"]);
  const badType = [...stripped.matchAll(/font-size:\s*([^;{}]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => /^\d/.test(v) && !TYPE.has(v));
  assert(badType.length === 0,
    "type stays on the scale" + (badType.length ? " — off it: " + [...new Set(badType)].join(", ") : ""));
  // design-constraints.md: 字号 7 档、行高 3 档、时长 3 档 —— 不要新增档位.
  // The membership sets above are the scale, so widening one is how a step
  // gets added: this makes that edit fail here rather than pass quietly.
  assert(TYPE.size === 7, "the type scale still has seven steps (" + TYPE.size + ")");
  assert(SPACE.size === 9, "the spacing scale still has nine steps (" + SPACE.size + ")");

  // leading: three steps, declared as tokens. 1.12 collapsed font-size and
  // left line-height running seven values including the UA's `normal`, which
  // differs per font — so a Chinese line and a Latin line in the same list sat
  // at different rhythms.
  {
    const lhs = [...stripped.matchAll(/line-height:\s*([^;{}]+);/g)].map((m) => m[1].trim());
    const raw = lhs.filter((v) => !/^var\(--lh-(tight|body|prose)\)$/.test(v));
    assert(raw.length === 0,
      "leading comes from the three tokens" + (raw.length ? " — raw: " + [...new Set(raw)].join(", ") : ""));
    assert(/--lh-tight:/.test(stripped) && /--lh-body:/.test(stripped) && /--lh-prose:/.test(stripped),
      "the three leading steps are declared");
    // and body must set one, or `normal` leaks into every unstyled run
    assert(/html, body \{[\s\S]*?line-height: var\(--lh-body\)/.test(stripped),
      "the document has a default leading");
  }

  // weight: three, not five. 650 and 700 were doing 600's job under other names.
  {
    const ws = [...stripped.matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
    const bad = ws.filter((w) => !["400", "500", "600"].includes(w));
    assert(bad.length === 0,
      "three weights only" + (bad.length ? " — also found: " + [...new Set(bad)].join(", ") : ""));
  }

  // The action rows, and the two ways this has been got wrong. As
  // flex + space-between + wrap they laid out differently in every group —
  // 3 items spread edge to edge, 4 packed tight at widths 40–64, a 5th
  // orphaned on its own line. As three equal columns the rhythm was fixed and
  // the labels broke instead: a 1fr column is the same width whatever is in
  // it, so 清除全部存档 was cut to 清除有 while PGN sat in a column twice the
  // width of its word. What is guarded now is the middle: sized by content,
  // wrapping, shrinkable — and still no space-between, which is the thing
  // that made each row its own rhythm.
  {
    const row = /\.link-row \{([\s\S]*?)\}/.exec(stripped);
    assert(row, "found the action row rule");
    assert(/display:\s*flex/.test(row[1]) && /flex-wrap:\s*wrap/.test(row[1]),
      "action rows wrap rather than forcing a column count");
    assert(!/grid-template-columns/.test(row[1]),
      "no fixed column count — an equal column is only right when the contents are equal");
    assert(!/space-between/.test(row[1]), "no space-between — that is what made every row different");

    // the pair that did the clipping: a box pinned to a column narrower than
    // its text, and text forbidden to wrap out of it
    const link = /\.text-link \{([\s\S]*?)\}/.exec(stripped);
    assert(link, "found the action link rule");
    assert(!/white-space:\s*nowrap/.test(link[1]),
      "a label too long for its row wraps rather than being cut");
    assert(!/width:\s*100%/.test(link[1]), "…and is sized by its content, not by its column");

    // P3's acceptance criterion, at the level of the rule rather than the
    // screen: dimming a control that cannot be used is not a milder way of
    // obeying "no visible disabled controls", it is the thing being rejected
    const off = /\.text-link:disabled \{([^}]*)\}/.exec(stripped);
    assert(off && /display:\s*none/.test(off[1]),
      "a disabled action link is not rendered at all");
    assert(off && !/opacity/.test(off[1]), "…not dimmed into a hole in the row");

    // one row, one visual weight: the danger link says what it is in colour,
    // not by being the only outlined control among its neighbours
    const dz = stripped.slice(stripped.indexOf(".text-link.danger"));
    const dRule = /\.text-link\.danger:not\(:disabled\) \{([^}]*)\}/.exec(dz);
    assert(dRule, "found the danger link rule");
    assert(!/border/.test(dRule[1]),
      "the danger link carries no border its row-mates lack");

    // The same rule for wrapped segments, and for the same reason. With
    // `flex: 1 1 30%` the items on a last line share it between them, so a
    // row of four became three normal buttons and one running the full width
    // of the panel — and a full-width filled button is this UI's word for
    // "the primary action here". 满强度 and 爱进攻 read as buttons you were
    // being pushed toward, purely because 4 % 3 == 1.
    //
    // This used to be checked by measuring button widths in a browser, in
    // three languages (test-layout-e2e.mjs). A pixel assertion answers "did
    // it come out equal this time"; the invariant is "the columns are shared",
    // and that is a property of one declaration. P2.8.
    const wrapRow = /\.theme-row\.wrap \{([\s\S]*?)\}/.exec(stripped);
    assert(wrapRow, "found the wrapped-segment rule");
    assert(/display:\s*grid/.test(wrapRow[1]), "wrapped segments are a grid");
    assert(/grid-template-columns:\s*repeat\(auto-fit/.test(wrapRow[1]),
      "…with shared columns, so every button is one size");
    assert(!/flex:\s*1 1 \d+%/.test(stripped),
      "no `flex: 1 1 N%` anywhere — that is the shape that made the fourth button a primary");
  }

  // The segment has one implementation and one modifier. `.mode-nav` was a
  // second idiom kept alive for a single row — an underline, a panel-era
  // `margin-top: 12px` and a group border drawn for a tab row that was no
  // longer underneath it. It rode 6px below the chrome's centre line and 2.5px
  // past its bottom edge for a whole release, and no rule in this file could
  // notice, because it was the only user of every declaration it carried.
  // Mode is a plain `.theme-row.wrap` segment on the settings page now.
  {
    const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    assert(!/mode-nav/.test(stripped), "no `.mode-nav` idiom is left in the stylesheet");
    assert(!/class="[^"]*mode-nav/.test(markup), "…and nothing in the markup asks for one");
    const seg = /<div class="([^"]*)" id="mode-seg"/.exec(markup);
    assert(seg && /\btheme-row\b/.test(seg[1]) && /\bwrap\b/.test(seg[1]),
      "the mode segment is styled by the same rule as every other segment (" + (seg ? seg[1] : "missing") + ")");
  }

  // the board is set into its frame: concentric radii want 16 - 17 < 0
  {
    const canvasRule = /\n    canvas \{([\s\S]*?)\n    \}/.exec(stripped);
    assert(canvasRule && /border-radius:\s*0/.test(canvasRule[1]),
      "the board's corners are square, not rounder-than-concentric");
    assert(/#board-wrap::after/.test(stripped) && /--board-edge/.test(stripped),
      "a hairline finishes the join between squares and frame");
  }

  // coordinates: an integer step, not a value computed from a length. The
  // clamp() they used resolved to 12.24px with 0.4896px of tracking, which is
  // also how they slipped past the type-scale check.
  {
    const co = /\.coords \{([\s\S]*?)\n    \}/.exec(stripped);
    assert(co, "found the coordinate rule");
    assert(!/clamp\(/.test(co[1]), "coordinates are not sized by a computed length");
    assert(/font-size:\s*\d+px/.test(co[1]), "coordinates sit on the type scale");
  }

  // radius: the tokens exist; use them
  // 0 is a decision, not a stray value: the board is square-cornered on
  // purpose (concentric radii — see styles.css)
  const OK_RADIUS = /^(0|var\(--radius-(sm|md|lg)\)|999px|50%|3px|var\(--radius-sm\) var\(--radius-sm\) 0 0|calc\()/;
  const badRadius = [...stripped.matchAll(/border-radius:\s*([^;{}]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => !OK_RADIUS.test(v));
  assert(badRadius.length === 0,
    "radii come from the tokens" + (badRadius.length ? " — raw: " + [...new Set(badRadius)].join(", ") : ""));

  // colour: the danger red used to be one salmon that ignored all four themes
  // scoped past the theme blocks: that is where the literal belongs, once
  const body = stripped.slice(stripped.indexOf("* { box-sizing"));
  assert(!/#e0(7a6a|5252)/.test(body), "nothing outside the themes writes the danger red literally");
  assert(!/linear-gradient\(180deg, #f0d2a8/.test(body),
    "the primary button's colour comes from the theme too");
  // --- every var() names a token that exists -------------------------------
  // The rule design-constraints.md states as "格子颜色归主题 token, canvas 去读"
  // generalised: a token reference that resolves to nothing is not a
  // compile error in CSS, it is a property that silently does not apply. So
  // .mlmove {color: var(--fg)} has been reading a token that does not exist
  // since it was written — 56 tokens are defined and none of them is --fg (the
  // themes call it --text) — and it looks correct only because the colour it
  // fails to set is the colour it would have inherited anyway. Defect 9,
  // fixed in P0.5 — the register below is empty and stays empty.
  {
    const KNOWN_DANGLING = new Set();
    const defined = new Set([...stripped.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const dangling = [...new Set([...stripped.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))]
      .filter((v) => !defined.has(v));
    const fresh = dangling.filter((v) => !KNOWN_DANGLING.has(v));
    for (const v of fresh) console.error("  var(" + v + ") names no token");
    assert(fresh.length === 0,
      "no new var() names a missing token" + (fresh.length ? " — " + fresh.join(", ") : ""));
    const gone = [...KNOWN_DANGLING].filter((v) => !dangling.includes(v));
    assert(gone.length === 0,
      "the register lists no dangling token that is already fixed" +
      (gone.length ? " — drop " + gone.join(", ") : ""));
  }

  // --- no new bare colour outside the theme blocks --------------------------
  // A colour written in place is a colour that cannot answer "what does this
  // look like in the other three themes". The ones below are the ones that
  // already shipped, listed rather than tolerated: this is the register P2
  // empties. Defect 8 — the eval bar's two hard-coded sides and the two
  // hard-coded blunder golds — was the last four, and left in P2.3. Anything not on this list fails, so the count only goes down.
  {
    const KNOWN = new Map([
      ["#fff", "two white paper fills (notebook theme's own surface)"],
      ["#000", "two color-mix() darkening steps, not a paint colour"],
      ["#9a3412", "notebook promotion mark, white side"],
      ["#1e3a5f", "notebook promotion mark, black side"],
      ["#4a90d9", "var(--accent) fallback, never reached"],
    ]);
    const found = new Set((body.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((c) => c.toLowerCase()));
    const fresh = [...found].filter((c) => !KNOWN.has(c));
    for (const c of fresh) console.error("  new bare colour outside the themes: " + c);
    assert(fresh.length === 0,
      "no colour is written in place that was not already there" +
      (fresh.length ? " — " + fresh.join(", ") : " (" + found.size + " known, all registered)"));
    const gone = [...KNOWN.keys()].filter((c) => !found.has(c));
    assert(gone.length === 0,
      "the register lists no colour that is already gone" + (gone.length ? " — drop " + gone.join(", ") : ""));
  }

  // A theme answers for the interface; a board palette answers for the board.
  // They were one block until 1.25, which is why every theme restated thirteen
  // square colours and neither could move without the other.
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const sel = theme === "wood" ? ":root, \\[data-theme=\"wood\"\\]" : "\\[data-theme=\"" + theme + "\"\\]";
    const blk = new RegExp(sel + "\\s*\\{([\\s\\S]*?)\\n    \\}").exec(stripped);
    assert(blk, theme + " theme block found");
    // layer 2, the whole of what a theme declares
    for (const v of ["--surface", "--surface-raised", "--ink", "--ink-muted",
                     "--accent", "--danger", "--control", "--line", "--primary-from"]) {
      assert(blk[1].includes(v + ":"), theme + " declares the " + v + " role");
    }
    // …and nothing from layer 3: a theme that names a component variable is a
    // theme that has to be edited when a component is added
    for (const v of ["--panel:", "--btn:", "--card:", "--text:"]) {
      assert(!blk[1].includes("\n      " + v), theme + " does not restate " + v.slice(0, -1));
    }
    // …nor any square colour
    assert(!/--sq-/.test(blk[1]), theme + " leaves the board to the board palette");
  }
  for (const board of ["wood", "night", "day", "notebook"]) {
    const sel = board === "wood" ? ":root, \\[data-board=\"wood\"\\]" : "\\[data-board=\"" + board + "\"\\]";
    const blk = new RegExp(sel + "\\s*\\{([\\s\\S]*?)\\n    \\}").exec(stripped);
    assert(blk, board + " board palette found");
    for (const v of ["--sq-light", "--sq-dark", "--sq-sel", "--sq-last", "--sq-check",
                     "--sq-dot", "--sq-ring", "--coord-ink", "--board-frame"]) {
      assert(blk[1].includes(v + ":"), board + " board defines " + v);
    }
  }
  // layer 3 is declared once, for all four
  {
    const comp = /\n    :root \{([\s\S]*?)\n    \}/.exec(stripped.slice(stripped.indexOf('[data-theme="notebook"]')));
    assert(comp && /--panel: var\(--surface-raised\)/.test(comp[1]),
      "component variables are declared once, in terms of the roles");
  }
}

// The board is what a player looks at essentially the whole time, and until
// 1.11 all four themes painted it identically — the squares were constants in
// board.js, so a theme could change the frame and nothing inside it.
{
  const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
  assert(/--sq-light/.test(boardSrc) && /getComputedStyle/.test(boardSrc),
    "the board reads its colours from the theme");
  assert(!/const LIGHT = "#/.test(boardSrc) && !/const DARK = "#/.test(boardSrc),
    "no square colour is hard-coded in the renderer any more");

  // design-constraints.md: 每处格子平涂必须走 cellRect() 取整. A fractional
  // fillRect boundary lands between device pixels and the two squares either
  // side of it get antialiased edges — a visible seam at some board sizes,
  // and only at some, which is why it survives being looked at. The lesson
  // success flash was the one site that bypassed it (defect 10, fixed in
  // P0.5); the register is empty and stays empty.
  {
    const KNOWN_RAW_FILLS = 0;
    const raw = [...boardSrc.matchAll(/ctx\.fillRect\(([^)]*)\)/g)]
      .map((m) => m[1].trim())
      .filter((a) => !a.startsWith("...cellRect("));
    for (const a of raw) console.error("  fillRect(" + a + ") does not go through cellRect()");
    assert(raw.length <= KNOWN_RAW_FILLS,
      "every square fill goes through cellRect() (" + raw.length + " raw, " + KNOWN_RAW_FILLS + " registered)");
    assert(raw.length === KNOWN_RAW_FILLS,
      "the raw-fill count still matches the register (" + raw.length + " vs " + KNOWN_RAW_FILLS + ")");
  }

  // design-constraints.md said 棋子精灵只缓存一个尺寸 round(step), because
  // changing size re-rasterises twelve pieces. That reasoning is about *board*
  // sizes, which change with the window. P4.3 caches a second, fixed size —
  // round(step × LIFT) — because the alternative was scaling the board sprite
  // up 12% at draw time, which made the one piece under the pointer the only
  // stretched bitmap on the board (缺陷 18). Two, and not a third.
  assert(/size !== Math\.round\(_spriteSize \* LIFT\)/.test(boardSrc),
    "the sprite cache holds the board size and the lifted size");
  assert(!/drawImage\(sprite,[^)]*,\s*Math\.round\(sz\),\s*Math\.round\(sz\)\)/.test(boardSrc),
    "…and nothing is scaled up at draw time any more");
  // …and every piece stands on something
  assert(/function paintContactShadow\(/.test(boardSrc), "pieces have a contact shadow");
  assert(/P\.pieceShadow/.test(boardSrc), "…in a colour the board palette chooses");
  assert(/invalidatePaint/.test(boardSrc) &&
    /invalidatePaint\(\)/.test(fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8")),
    "switching theme re-reads them");

  // and the pieces have to stay legible on every one of them. The cburnett
  // vectors are pure black and white with a black outline, so what has to
  // carry is that outline against both square colours.
  const css2 = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
  const lum = (hex) => {
    const n = hex.replace("#", "");
    const ch = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255)
      .map((v) => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)));
    return 0.2126 * ch[0] + 0.7152 * ch[1] + 0.0722 * ch[2];
  };
  const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  // the square colours moved to the board palettes in 1.25 — the question is
  // still "can you see a black outline on this square", which is a property of
  // the board, not of the interface around it
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const sel = theme === "wood" ? /:root, \[data-board="wood"\]\s*\{([\s\S]*?)\n    \}/
      : new RegExp('\\[data-board="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n    \\}');
    const blk = sel.exec(css2)[1];
    for (const which of ["--sq-light", "--sq-dark"]) {
      const hex = new RegExp(which + ":\\s*(#[0-9a-fA-F]{6})").exec(blk)[1];
      const r = ratio(0, lum(hex));
      assert(r >= 4.5, theme + " " + which + " keeps the piece outline legible (" + r.toFixed(2) + ":1)");
    }
  }
}

// Sparring personalities. `pick` is pure — candidates in, one of them out —
// so the whole contract is testable without ever starting the engine.
{
  loadModule(ctx, "src/web/js/persona.js");
  const P = ctx.ChessPersona;
  assert(P && typeof P.pick === "function", "persona module loaded");
  assert(P.IDS[0] === "off", "\"off\" is the first personality, i.e. the default");

  // A knight on f3 with a free pawn on e5 to take, or quiet developing moves.
  const fen = "rnbqkb1r/pppp1ppp/5n2/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
  const cands = [
    { uci: "d2d4", score: 30 },     // best, quiet
    { uci: "f3e5", score: -60 },    // grabs the pawn, slightly worse
    { uci: "b1c3", score: 10 },     // develops a knight
    { uci: "f1c4", score: 5 },      // develops a bishop
    { uci: "d1e2", score: -20 },    // early queen move
  ];
  assert(P.pick(fen, cands, "greedy", Chess) === "f3e5",
    "the greedy personality takes the pawn");
  assert(["b1c3", "f1c4"].includes(P.pick(fen, cands, "principled", Chess)),
    "the by-the-book personality develops a piece");
  assert(P.pick(fen, cands, "off", Chess) === null,
    "\"off\" leaves the engine's own choice alone");

  // The safety rails, which are the whole reason a personality is playable.
  const wild = [{ uci: "d2d4", score: 30 }, { uci: "f3e5", score: -900 }];
  assert(P.pick(fen, wild, "greedy", Chess) !== "f3e5",
    "no personality follows a capture that is far outside its slack");
  const mating = [{ uci: "d2d4", score: 99999 }, { uci: "f3e5", score: 10 }];
  assert(P.pick(fen, mating, "greedy", Chess) === null,
    "a forced mate is never traded away for a capture");
  assert(P.pick(fen, [{ uci: "d2d4", score: 30 }], "greedy", Chess) === null,
    "one candidate is no choice at all");

  // Every personality must be reachable from the panel and named in every
  // language — a style you cannot select is a style that does not exist.
  const htmlP = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
  const inMarkup = [...htmlP.matchAll(/data-persona="([a-z]+)"/g)].map((m) => m[1]);
  assert(P.IDS.every((id) => inMarkup.includes(id)) && inMarkup.length === P.IDS.length,
    "every personality has a button (" + inMarkup.join(", ") + ")");
  loadModule(ctx, "src/web/js/i18n.js");
  const dict = ctx.ChessI18n.DICT;
  for (const lang of Object.keys(dict)) {
    const missing = P.IDS.filter((id) => !("persona." + id in dict[lang]));
    assert(missing.length === 0, lang + " names every personality");
  }
}

// FIDE draw arithmetic: repetition counting and the 6.9 material test decide
// real game results, so they get their own checks
{
  loadModule(ctx, "src/web/js/fide.js");
  const F = ctx.ChessFide;
  assert(F.halfmoveClock("8/8/8/8/8/8/8/K6k w - - 37 90") === 37, "halfmove clock parsed");
  // shuffling knights back and forth repeats the start position
  const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8"];
  assert(F.repetitionCount(null, [], Chess) === 1, "start position seen once");
  assert(F.repetitionCount(null, shuffle, Chess) === 2, "one cycle repeats the start twice");
  assert(F.repetitionCount(null, [...shuffle, ...shuffle], Chess) === 3, "two cycles reach threefold");
  assert(F.repetitionCount(null, [...shuffle, ...shuffle, ...shuffle, ...shuffle], Chess) === 5,
    "four cycles reach fivefold");
  // a repetition must match castling rights too: moving a rook out and back
  // changes the rights, so the position is NOT the same as before
  const rookOut = ["Nf3", "Nf6", "Rg1", "Rg8", "Rh1", "Rh8"];
  assert(F.repetitionCount(null, rookOut, Chess) === 1,
    "losing castling rights breaks the repetition");

  // FIDE 9.2 compares the *available moves*, not the raw FEN. A double pawn
  // push writes an ep target even when nobody can take there, so the same
  // shuffle behind 1.e4 e5 must still reach threefold.
  const pawnsFirst = ["e4", "e5", ...shuffle, ...shuffle];
  assert(F.repetitionCount(null, pawnsFirst, Chess) === 3,
    "a phantom ep square does not break the repetition");
  assert(F.positionKey(new Chess("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1").fen(),
    null, Chess).endsWith(" -"), "unusable ep right is normalised away");
  // ...but a real one is a genuine difference and must be kept
  const epLive = new Chess("4k3/8/8/8/3p4/8/2P5/4K3 w - - 0 1");
  epLive.move("c4");
  assert(F.positionKey(epLive.fen(), epLive).endsWith(" c3"), "playable ep right is preserved");
  // pinned capturer: the ep move is not legal, so the right does not exist
  const epPinned = new Chess("8/8/8/K2pP2q/8/8/8/7k w - d6 0 1");
  assert(F.positionKey(epPinned.fen(), epPinned).endsWith(" -"),
    "ep right that would expose the king is normalised away");

  const boardOf = (fen) => new Chess(fen).board();
  const mat = (fen, color) => F.hasMatingMaterial(boardOf(fen), color);
  assert(mat("8/8/8/8/8/8/4P3/K6k w - - 0 1", "w"), "K+P can mate");
  assert(mat("8/8/8/8/8/8/8/KR5k w - - 0 1", "w"), "K+R can mate");
  assert(!mat("8/8/8/8/8/8/8/K6k w - - 0 1", "w"), "bare king cannot mate");
  assert(!mat("8/8/8/8/8/8/8/KB5k w - - 0 1", "w"), "K+B alone cannot mate");
  assert(!mat("8/8/8/8/8/8/8/KN5k w - - 0 1", "w"), "K+N vs bare K cannot mate");
  assert(mat("8/8/8/8/8/8/7p/KN5k w - - 0 1", "w"), "K+N can mate when the opponent has a blocker");
  assert(mat("8/8/8/8/8/8/8/KNN4k w - - 0 1", "w"), "two knights can mate (helpmate exists)");
  // c1 and f1 are opposite colours → real mating material
  assert(mat("7k/8/8/8/8/8/8/K1B2B2 w - - 0 1", "w"), "opposite-coloured bishops can mate");
  // c1 and a3 are both dark; a bare king can never be mated by them
  assert(!mat("7k/8/8/8/8/B7/8/K1B5 w - - 0 1", "w"), "same-coloured bishops vs bare king cannot mate");
  assert(mat("7k/7p/8/8/8/B7/8/K1B5 w - - 0 1", "w"), "same-coloured bishops can mate if the opponent has other material");

  // positionFinished: the whole point is that it is NOT chess.js game_over().
  // The analyser used game_over() per position and scored every claimable draw
  // a flat 0, which flattened the eval curve mid-game and mis-tagged every
  // move after it — while the live game, correctly, played straight on.
  const fin = (fen, reps) => F.positionFinished(new Chess(fen), reps);
  const rookEnd = "8/8/8/4k3/8/8/R7/4K3 w - - {h} 80";
  const at = (h) => rookEnd.replace("{h}", String(h));
  assert(new Chess(at(100)).game_over(), "chess.js does end the game at the 50-move mark");
  assert(!fin(at(100), 1), "50 moves is claimable, not finished");
  assert(!fin(at(149), 1), "149 halfmoves is still claimable");
  assert(fin(at(150), 1), "75 moves ends the game by law");
  assert(!fin(at(0), 3), "threefold is claimable, not finished");
  assert(!fin(at(0), 4), "fourfold is still claimable");
  assert(fin(at(0), 5), "fivefold ends the game by law");
  assert(fin("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", 1), "checkmate is finished");
  assert(fin("7k/5Q2/5K2/8/8/8/8/8 b - - 0 1", 1), "stalemate is finished");
  assert(fin("7k/8/6K1/8/8/8/8/8 w - - 0 1", 1), "insufficient material is finished");
  // a mating move on the 75-move boundary is mate, not a draw
  assert(fin("7k/5Q2/6K1/8/8/8/8/8 b - - 150 90", 1), "mate outranks the 75-move rule");
  // and it agrees with the app's own live rule everywhere it is defined:
  // naturalGameOver() = checkmate | stalemate | insufficient | autoDrawReason()
  for (const [fen, reps] of [[at(0), 1], [at(100), 1], [at(150), 1], [at(0), 3], [at(0), 5]]) {
    const g = new Chess(fen);
    const live = g.in_checkmate() || g.in_stalemate() || g.insufficient_material() ||
      reps >= 5 || F.halfmoveClock(g.fen()) >= 150;
    assert(F.positionFinished(g, reps) === live,
      "positionFinished matches the live rule at " + fen + " x" + reps);
  }
}

// The eval bar and the one set of mistake thresholds behind it.
{
  loadModule(ctx, "src/web/js/review.js");
  const R = ctx.ChessReview;
  // "nobody asked the engine" must not render as "the engine says level" —
  // a bar that draws both at 50% is the most confident lie a review can tell
  assert(R.evalBar(null) === null, "an unmeasured position has no bar position");
  assert(R.evalBar(undefined) === null, "…and neither does a missing one");
  assert(R.evalBar(0) === 0.5, "level is the middle");
  assert(R.evalBar(600) === 1 && R.evalBar(-600) === 0, "±6 pawns fills the bar");
  assert(R.evalBar(10000) === 1 && R.evalBar(-10000) === 0, "a mate score clamps, it does not overflow");
  assert(R.evalBar(300) === 0.75 && R.evalBar(-300) === 0.25, "the scale is linear in between");
  assert(R.evalBar(NaN) === null, "a NaN is unmeasured, not a full bar");

  // one source for the thresholds: the move list, the curve markers and the
  // best-move arrow all read this. It used to be four hand-written copies.
  assert(R.markFor(0) === null && R.markFor(49) === null, "a cheap move earns no tag");
  assert(R.markFor(R.INACCURACY) === "?!", "the inaccuracy threshold is inclusive");
  assert(R.markFor(R.MISTAKE) === "?", "the mistake threshold is inclusive");
  assert(R.markFor(R.BLUNDER) === "??", "the blunder threshold is inclusive");
  assert(R.markFor(R.MISTAKE - 1) === "?!" && R.markFor(R.BLUNDER - 1) === "?", "each band stops where the next begins");
  assert(!R.isMistake(null) && R.isMistake("?!") && R.isMistake("?") && R.isMistake("??"),
    "isMistake covers exactly the tagged moves");

  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  const fnOf = (name) => {
    const i = appSrc.indexOf("function " + name + "(");
    if (i < 0) return "";
    let depth = 0;
    for (let k = appSrc.indexOf("{", i); k < appSrc.length; k++) {
      if (appSrc[k] === "{") depth++;
      else if (appSrc[k] === "}" && --depth === 0) return appSrc.slice(i, k + 1);
    }
    return "";
  };
  // analysisFor() sits in the render path. `analysis.sig` is a PGN, and
  // game.pgn() costs ~3.3ms on an 80-move game — a fifth of a 60fps frame.
  // 1.22 put the best-move arrow in the board model, which is rebuilt on every
  // draw() including every animation frame, so a 12-frame replay slide spent
  // ~40ms serialising the same PGN twelve times. The memo has to be exact, not
  // just fast: dropped on every sync(), and keyed on the analysis object so
  // that replacing it invalidates without seven assignment sites remembering.
  const af = fnOf("analysisFor");
  assert(/store\.session\._analysisTick/.test(af), "analysisFor is memoised");
  assert(/_analysisTick\.a === store\.session\.analysis/.test(af), "…and the memo notices a new analysis object");
  // --- the state lives in the store, not in a `let` beside its reader ------
  // 56 module-level `let`s down 5 300 lines meant "what is the state of this
  // app" could only be answered by reading the whole file, and — worse —
  // nothing could observe a change: every write was followed by a hand-written
  // sync() call, and sync() had to rebuild everything precisely because the
  // one thing it never knew was what had changed. P1.1 moved them into three
  // slices; this keeps them there.
  {
    // `_recSeq` is not state: it is a monotonic counter that only ever feeds
    // newRecordId(), never read, never rendered, never persisted. Putting it
    // in a slice would say it is something the app is *about*.
    const strays = [...appSrc.matchAll(/^  let ([A-Za-z_$][\w$]*)/gm)]
      .map((m) => m[1]).filter((n) => n !== "_recSeq");
    for (const n of strays) console.error("  module-level let: " + n);
    assert(strays.length === 0,
      "no state is declared beside its reader" +
      (strays.length ? " — " + strays.length + " module-level let(s)" : " (all in the store)"));
    assert(/const store = createStore\(\{/.test(appSrc), "…and the store is where it went");
    for (const slice of ["game", "session", "ui"]) {
      assert(new RegExp("\\n    " + slice + ": \\{").test(appSrc), "the " + slice + " slice exists");
    }
  }

  // --- sync() is three commits, not a function that knows how to draw -------
  // It was 80 lines inline plus nine sub-syncs, called from 65 places, and
  // every one of those places got the full rebuild — because the one thing it
  // never knew was what had changed. The views are split by what they are
  // about and subscribe to the slice they read; sync() now only says "some
  // things moved".
  {
    const body = fnOf("sync");
    const calls = [...body.matchAll(/\b(\w+)\(/g)].map((m) => m[1]).filter((n) => n !== "sync");
    const notCommit = calls.filter((n) => n !== "commit");
    for (const n of notCommit) console.error("  sync() still calls " + n + "()");
    assert(notCommit.length === 0,
      "sync() does nothing but commit" + (notCommit.length ? " — also calls " + [...new Set(notCommit)].join(", ") : ""));
    for (const slice of ["game", "session", "ui"]) {
      assert(new RegExp('store\\.commit\\("' + slice + '"').test(body), "sync() commits " + slice);
    }
    assert(/function wireViews\(\)/.test(appSrc), "the view wiring is in one readable block");
    for (const view of ["renderStatusPill", "renderReplayBar", "renderGameActions"]) {
      assert(new RegExp("function " + view + "\\(").test(appSrc), view + "() exists");
      assert(new RegExp('store\\.subscribe\\("\\w+", ' + view + "\\)").test(appSrc), "…and is subscribed");
    }
    // the ids are in index.html, which is loaded once — a lookup can only ever
    // return the same node, and sync() was doing thirty-odd per pass on a path
    // that ran on every clock tick
    assert(/function el\(id\) \{[\s\S]{0,200}?_nodes\.set/.test(appSrc), "getElementById is memoised behind el()");
    for (const v of ["renderStatusPill", "renderReplayBar", "renderGameActions"]) {
      assert(!/document\.getElementById/.test(fnOf(v)), v + "() goes through el()");
    }
  }

  // The memo used to be dropped at the top of sync(), which was correct only
  // while "sync() runs after every state change" stayed true — an invariant
  // held by hand at 65 call sites. The game commit drops it now, from inside
  // the mutation rather than after somebody remembers to sync.
  assert(/store\.subscribe\("game",[\s\S]{0,500}?store\.session\._analysisTick = null/.test(appSrc),
    "…and the game commit drops it, so no frame can outlive a state change");

  // Every mutation of `game` goes through one of the five doors, because those
  // doors are what announce the change. A raw game.move() somewhere else
  // leaves viewGame()/sanHistory() describing the position before it — a stale
  // board that repaints happily.
  //
  // The caches exist because rebuilding the board model replays the whole game
  // (chess.js has no move list to read), and the model is rebuilt on every
  // draw() — every animation frame, every pointermove of a drag. Measured at
  // 120 plies: 19.3ms per repaint before, 0.23ms after, and flat with length
  // instead of linear.
  const RAW_MUTATION = /\bgame\.(move\(|undo\(\)|load\(|load_pgn\(|reset\(\))/g;
  const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  const doors = noComments(appSrc).match(RAW_MUTATION) || [];
  // the five doors themselves are the only place the raw calls may appear
  assert(doors.length === 5,
    "only the five gameXxx() doors touch game directly (" + doors.length + " raw call(s))");
  for (const door of ["function gameMove(", "function gameUndo(", "function gameLoad(",
    "function gameLoadPgn(", "function gameReset("]) {
    assert(appSrc.includes(door), "the door " + door + "…) exists");
  }
  // Each door announces itself, and the announcement is what expires the
  // caches. Until 1.25 they bumped a `gameVersion` counter and every cache
  // compared itself against it — a hand-rolled invalidation signal, which is
  // exactly what a commit already is.
  for (const door of ["gameMove", "gameUndo", "gameLoad", "gameLoadPgn", "gameReset"]) {
    assert(/store\.commit\("game", "/.test(fnOf(door)), door + "() commits the game slice");
  }
  assert(!/gameVersion/.test(noComments(appSrc)), "no hand-kept version counter is left");
  assert(/store\.subscribe\("game",[\s\S]{0,400}?_vh = null[\s\S]{0,200}?_san = null/.test(appSrc),
    "the game commit is what expires the history caches");
  const vh = fnOf("verboseHistory");
  assert(/if \(!store\.game\._vh\)/.test(vh), "the verbose history is cached");
  assert(/if \(!store\.game\._san\)/.test(fnOf("sanHistory")), "…and so is the SAN list");
  assert(/verboseHistory\(\)\.map/.test(fnOf("sanHistory")),
    "…derived from it rather than walking the game a second time");
  assert(/store\.game\._view && store\.game\._view\.i === store\.game\.viewIndex/.test(fnOf("viewGame")),
    "the replayed position is cached against the cursor, and dropped when the game moves");

  // checkmate must not render as an ordinary check
  const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
  assert(/m\.mated/.test(boardSrc), "the board draws checkmate differently from check");
  assert((appSrc.match(/mated: g\.in_checkmate\(\)/g) || []).length === 3,
    "every board model says whether the check is mate");

  // the analyser must not carry a fifth copy of the numbers
  const analyze = fnOf("analyzeGame");
  assert(/Review\.markFor\(/.test(analyze), "the analyser tags moves through review.js");
  assert(!/loss >= \d+/.test(analyze), "the analyser holds no thresholds of its own");

  // the eval bar reads the analysis and nothing else — no engine call, which
  // is what keeps it review-only and unable to become a live answer key
  const bar = fnOf("drawEvalBar");
  assert(bar.length > 0, "drawEvalBar exists");
  assert(!/ChessEngine|analyze\(/.test(bar), "the eval bar never asks the engine anything");
  assert(/analysisFor\(\)/.test(bar) && /a\.scalars\[store\.game\.viewIndex\]/.test(bar),
    "the eval bar shows the position the board is standing on");
  assert(/rv\.evalNone/.test(bar), "an unmeasured position says so on screen");

  // the best-move arrow is derived, never stored: nothing to clear on a new
  // game, nothing that can drift out of step with the board
  const arrow = fnOf("bestArrowAt");
  assert(arrow.length > 0, "bestArrowAt exists");
  assert(/Review\.isMistake\(a\.tags\[i\]\)/.test(arrow),
    "the arrow appears only where the move played was a mistake");
  assert(/hintMove: isLive\(\) \? store\.session\.hintMove : bestArrowAt\(store\.game\.viewIndex\)/.test(appSrc),
    "the arrow is replay-only — never an answer key during a live game");
  assert(!/bestArrow\s*=/.test(appSrc), "the arrow is computed, not held in a variable");
  // and the analysis has to actually carry the engine's choice
  assert(/bests\[i\] = e\.best/.test(analyze), "the analyser keeps the engine's own move");
  assert(/analysis = \{ sig, scalars, tags, pvs, bests,/.test(appSrc), "…and files it with the rest");
}

// Opening-drill identity. The drills are generated from the book rather than
// authored, so their ids are computed — and a computed id that encodes WHERE a
// row sits rather than WHAT it is turns the next content update into a silent
// progress wipe. That is not a hypothetical: with the old positional id,
// inserting one deep line moved 108 of 109 ids onto a different drill.
{
  loadModule(ctx, "src/web/js/drills.js");
  const D = ctx.ChessDrills;
  const book = ctx.CHESS_OPENINGS;
  const idsOf = (b) => D.drillLines(b).map((r) => D.drillId(r[0], r[2]));

  const base = idsOf(book);
  assert(base.length > 100, "the book still yields a drill list (" + base.length + ")");
  assert(new Set(base).size === base.length, "no two drills share an id");

  // THE regression: adding coverage must not touch anybody's existing ids
  const inserted = book.slice();
  const firstDeep = inserted.findIndex((r) => r[2].split(" ").length >= D.MIN_PLIES);
  inserted.splice(firstDeep + 1, 0, ["A05", "列蒂开局·新变例", "Nf3 Nf6 g3 d5 Bg2 e6"]);
  const afterInsert = new Set(idsOf(inserted));
  const survived = base.filter((id) => afterInsert.has(id)).length;
  assert(survived === base.length,
    "inserting a line keeps every existing drill id (" + survived + "/" + base.length + ")");

  // removing one must not shift the others either
  const removed = book.slice();
  removed.splice(firstDeep, 1);
  const afterRemove = new Set(idsOf(removed));
  const kept = base.filter((id) => afterRemove.has(id)).length;
  assert(kept === base.length - 1,
    "removing a line takes exactly its own id with it (" + kept + "/" + (base.length - 1) + ")");

  // a name correction — C24 got one in 1.21.1 — must cost nobody their progress
  const renamed = book.map((r) => (r[2].split(" ").length >= D.MIN_PLIES ? [r[0], r[1] + "(改名)", r[2], r[3]] : r));
  assert(idsOf(renamed).join() === base.join(), "renaming a line keeps its id");
  // whitespace is authored by hand and must not reach the id
  assert(D.drillId("C24", "e4 e5  Bc4   Nf6") === D.drillId("C24", "e4 e5 Bc4 Nf6"),
    "spacing in the book does not change an id");
  // …but different moves are a different drill, and should be
  assert(D.drillId("C24", "e4 e5 Bc4 Nf6") !== D.drillId("C24", "e4 e5 Bc4 Nc6"),
    "a different line is a different drill");

  // the one-time migration off the positional ids
  const legacy = D.legacyIdMap();
  const deep = D.drillLines(book);
  const liveIds = new Set(base);
  // The table describes the book as it stood when positional ids were retired.
  // The book has grown since, so it does NOT cover every current drill — a
  // drill added later never had a positional id. What must hold forever is the
  // other direction: nothing in the table dangles.
  const dangling = Object.entries(legacy).filter(([, id]) => !liveIds.has(id));
  assert(dangling.length === 0,
    "every frozen legacy id still names a live drill" +
      (dangling.length ? " — dangling: " + dangling.slice(0, 3).map(([k]) => k).join(", ") : ""));
  assert(Object.keys(legacy).length <= base.length,
    "the frozen table cannot name more drills than the book holds");
  // The table is FROZEN, not derived: it has to keep describing the book the
  // positional ids were written against, and it must not move when the book
  // grows. Deriving it made the migration correct only for someone upgrading
  // from that exact book — which says nothing about a player who skips the
  // release. Measured: with a derived table, inserting one line dropped 66 to
  // 108 of the 109 drills.
  assert(D.legacyIdMap.length === 0, "the legacy map takes no book — it is data, not a derivation");
  const grown = book.slice();
  grown.splice(firstDeep + 1, 0, ["A05", "列蒂开局·又一条", "Nf3 d5 g3 c6 Bg2 Bf5"]);
  assert(JSON.stringify(D.legacyIdMap()) === JSON.stringify(legacy),
    "growing the book does not move the frozen table");
  // a legacy key still resolves to the same drill after the book grows
  const afterGrow = new Set(idsOf(grown));
  // compared against the frozen table's own size, not the live book's: the
  // book grows, the table does not, and that is the entire point of freezing
  // it. (This assertion originally compared against the live count and went
  // red the first time a line was actually added — caught by the very case it
  // was written to cover.)
  const frozenCount = Object.keys(legacy).length;
  const stillThere = Object.values(legacy).filter((id) => afterGrow.has(id)).length;
  assert(stillThere === frozenCount,
    "every migrated id still names a live drill after the book grows (" + stillThere + "/" + frozenCount + ")");
  const store = { ["op-" + deep[0][0] + "-0"]: true, "m1-ladder": true, "op-A05-9999": true };
  const moved = D.migrateIds(store, legacy);
  assert(moved === 1, "the one legacy key that still names a row is rewritten (" + moved + ")");
  assert(store[D.drillId(deep[0][0], deep[0][2])] === true, "a solved drill keeps its solve");
  assert(store["m1-ladder"] === true, "a hand-written puzzle id is left alone");
  assert(!("op-A05-9999" in store), "a legacy key naming a row that is gone is dropped, not kept forever");
  // an ECO letter outside A–E was never one of ours and is not touched
  const alien = { "op-Z99-4": true };
  assert(D.migrateIds(alien, legacy) === 0 && alien["op-Z99-4"] === true,
    "a key that only looks like a drill id is left alone");
  // and it is idempotent — the launch path runs it on every load until marked
  assert(D.migrateIds(store, legacy) === 0, "migrating twice is a no-op");

  // the app must build the id from the module, not from a loop index again
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  assert(/Drills\.drillId\(/.test(appSrc), "app.js derives the drill id from drills.js");
  assert(!/"op-"\s*\+\s*eco\s*\+\s*"-"\s*\+\s*i\b/.test(appSrc),
    "app.js never rebuilds a drill id from its position");
}

// A failed drill has to teach the technique, not just name the result. Every
// one of the six failure lines used to describe what happened — "被将死了 ——
// 重来" — while the opening drills say which principle you broke, which is the
// feedback design the rest of the app is measured against. 缺陷 26.
{
  const D = ctx.ChessDrills;
  const G = (fen) => new Chess(fen);
  const adv = (fen, goal, how) => D.drillAdvice(G(fen), goal, how);

  // the advice is read off the position: same failure, different board,
  // different technique — which is the whole point of deriving it
  assert(adv("8/8/8/8/8/6k1/6p1/6K1 w - - 0 1", "draw", "queened") === "lmTip.philidor",
    "a defence that let the pawn through is told the Philidor method");
  assert(adv("7k/8/8/8/8/8/8/6QK w - - 0 1", "win", "stalemate") === "lmTip.stalemate",
    "a stalemated mating drill is told to leave a square or check");
  // queen up, own king still at home, enemy king in the far corner
  assert(adv("7k/8/8/8/8/8/8/K5Q1 w - - 0 1", "win", "draw") === "lmTip.bringKing",
    "a drawn heavy-piece drill with a distant king is told to bring the king up");
  // kings together, defender still in the middle
  assert(adv("8/8/8/3k4/3K4/8/8/7Q w - - 0 1", "win", "draw") === "lmTip.driveToEdge",
    "…and one with a central defender is told to drive it to the edge");
  assert(adv("7k/8/8/8/8/8/P7/K7 w - - 0 1", "win", "draw") === "lmTip.escortPawn",
    "a drawn pawn drill with the king left behind is told to escort the pawn");
  assert(adv("7k/8/8/8/8/8/8/6QK b - - 0 1", "win", "mated") === "lmTip.ownKing",
    "being mated a queen up is told to look at its own king");
  // and where nothing is certain it says nothing rather than guessing
  assert(adv("7k/8/8/8/8/8/8/K7 w - - 0 1", "draw", "mated") === null,
    "no rule matched means no advice, not a guess");

  // every key it can return has to exist in all three languages
  const advSrc = fs.readFileSync(path.join(root, "src/web/js/drills.js"), "utf8");
  const body = advSrc.slice(advSrc.indexOf("function drillAdvice"));
  const keys = [...new Set((body.match(/"lmTip\.[A-Za-z]+"/g) || []).map((k) => k.slice(1, -1)))];
  assert(keys.length === 7, "drillAdvice offers seven techniques (" + keys.length + ")");
  loadModule(ctx, "src/web/js/i18n.js");
  const dicts = ctx.ChessI18n.DICT;
  for (const lang of ["zh-CN", "en", "ja"]) {
    for (const k of keys.concat("lm.tipSep")) {
      assert(dicts[lang] && dicts[lang][k], k + " is written in " + lang);
    }
  }

  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  // the wiring: the outcome line must actually carry the advice, and the
  // wording must live in the dictionary rather than being pasted into app.js
  assert(/ChessDrills\.drillAdvice\(/.test(appSrc), "drillOutcome asks drills.js for the technique");
  assert(/t\(key\) \+ t\("lm\.tipSep"\) \+ t\(tip\)/.test(appSrc),
    "the joining punctuation is translated too, not hard-coded");
  assert(!/lmTip\./.test(appSrc.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g, "")),
    "app.js names no technique itself — it prints whatever the position derives");
}

// The course meets a tactical motif once and moves on, while the puzzle set
// holds 21 more `tac` puzzles on those same motifs that nothing ever pointed
// at. 缺陷 24. The link is a motif string on both sides rather than a list of
// puzzle ids, so this checks it from both ends: a lesson that points nowhere,
// and a puzzle nothing points at, are the two ways it can rot.
{
  const lessons = ctx.CHESS_LESSONS;
  const tac = ctx.CHESS_PUZZLES.filter((p) => p.cat === "tac");
  assert(tac.length === 21, "the tac set is still 21 puzzles (" + tac.length + ")");
  const taught = lessons.filter((L) => L.practice);
  assert(taught.length >= 7, "at least seven lessons continue into the puzzle set (" + taught.length + ")");
  for (const L of taught) {
    const n = tac.filter((p) => p.motif === L.practice).length;
    assert(n > 0, "lesson " + L.id + " points at puzzles that exist (" + L.practice + ")");
  }
  // and nothing is stranded: every tac puzzle is reachable from some lesson
  const claimed = new Set(taught.map((L) => L.practice));
  const orphan = tac.filter((p) => !claimed.has(p.motif));
  assert(orphan.length === 0,
    "every tac puzzle is reachable from a lesson (" + orphan.map((p) => p.id + "/" + p.motif).join(", ") + ")");

  // the runtime must match on the motif, not on a list that stops covering new
  // puzzles the moment one is added
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  assert(/p\.cat === "tac" && p\.motif === L\.practice/.test(appSrc),
    "app.js finds the practice puzzles by motif");
  assert(/id="lesson-practice"/.test(fs.readFileSync(path.join(root, "src/web/index.html"), "utf8")),
    "the lesson view has somewhere to press");
  // a lesson with no puzzles must offer no button rather than a dead one — the
  // whole P3 rule about visible disabled controls applies here too
  assert(/practice\.hidden = !rest\.total/.test(appSrc),
    "a lesson with no matching puzzles hides the button instead of disabling it");
  assert(/store\.session\.puzzleTierFilter = "all"/.test(appSrc),
    "the jump clears a tier filter that would hide the puzzle it promised");
}

// PGN utilities: splitting a multi-game file must not lose games (importing a
// database used to silently keep only the last one)
{
  loadModule(ctx, "src/web/js/pgn.js");
  const P = ctx.ChessPgn;
  const one = '[Event "A"]\n[White "X"]\n[Black "Y"]\n[Result "1-0"]\n\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\n';
  const two = one + '\n[Event "B"]\n[White "P"]\n[Black "Q"]\n[Result "0-1"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n';
  assert(P.splitGames("").length === 0, "empty PGN yields no games");
  assert(P.splitGames(one).length === 1, "single-game PGN stays one game");
  const games = P.splitGames(two);
  assert(games.length === 2, "two-game PGN splits into two (" + games.length + ")");
  assert(P.tag(games[0], "White") === "X" && P.tag(games[1], "White") === "P", "each chunk keeps its own tags");
  // bare movetext has no [Event] tag at all — must still come back importable
  assert(P.splitGames("1. e4 e5 2. Nf3").length === 1, "tagless movetext is one game");
  for (const g of games) {
    const probe = new Chess();
    assert(probe.load_pgn(g, { sloppy: true }) && probe.history().length > 0, "split chunk parses: " + P.tag(g, "Event"));
  }
  const s = P.summary(games[1]);
  assert(s.white === "P" && s.black === "Q" && s.result === "0-1" && s.plies === 4,
    "summary reads headers and counts plies (" + JSON.stringify(s) + ")");

  // startFen: a game with no moves yet. This is the shape the autosave, the
  // save slots and the exporter all produce the moment a position is set up
  // and before it is played into — and chess.js refuses to parse it, which is
  // how "edit a position, close the app" used to lose the position outright.
  const POS = "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1";
  const held = new Chess(POS);
  held.header("SetUp", "1", "FEN", POS);
  const autosaved = held.pgn(); // literally what saveGame() writes
  assert(!new Chess().load_pgn(autosaved), "chess.js still rejects a movetext-free PGN");
  assert(P.startFen(autosaved) === POS, "startFen recovers the position load_pgn drops");
  assert(P.startFen(autosaved + "*\n") === POS, "a lone result token does not hide the FEN");
  assert(P.startFen(one) === null, "a game from the standard array declares no start FEN");
  assert(P.startFen("") === null && P.startFen(null) === null, "no PGN, no start FEN");
  // [FEN] without [SetUp "1"] is not a set-up game under the PGN spec
  assert(P.startFen('[FEN "' + POS + '"]\n\n') === null, "FEN without SetUp is ignored");
  assert(P.startFen('[SetUp "0"]\n[FEN "' + POS + '"]\n\n') === null, "SetUp 0 is ignored");
  assert(new Chess().validate_fen(P.startFen(autosaved)).valid, "the recovered FEN is loadable");
  // an exported set-up position must survive the round trip back in
  const exported = '[Event "?"]\n[SetUp "1"]\n[FEN "' + POS + '"]\n\n*\n';
  assert(P.startFen(exported) === POS, "an exported position round-trips");
}

// position editor: FEN generation plus the legality rules chess.js does not
// enforce on its own (an editor must never hand the game an unplayable FEN)
{
  loadModule(ctx, "src/web/js/editor.js");
  const E = ctx.ChessEditor;
  const start = E.fromFen(new Chess().fen(), Chess);
  assert(E.toFen(start) === new Chess().fen().replace(/ \S+ \d+ \d+$/, " - 0 1"),
    "round-trips the start position (" + E.toFen(start) + ")");
  assert(E.validate(start, Chess) === null, "start position is playable");

  const put = (state, sq, piece) => {
    const { r, c } = E.indexOf(sq);
    state.board[r][c] = piece;
    return state;
  };
  const bare = () => ({ board: E.emptyBoard(), turn: "w", castling: { K: false, Q: false, k: false, q: false } });

  let st = bare();
  assert(E.validate(st, Chess) === "edErr.noWhiteKing", "empty board is rejected");
  put(st, "e1", { type: "k", color: "w" });
  assert(E.validate(st, Chess) === "edErr.noBlackKing", "missing black king is rejected");
  put(st, "e8", { type: "k", color: "b" });
  assert(E.validate(st, Chess) === null, "two lone kings are playable");
  put(st, "d1", { type: "k", color: "w" });
  assert(E.validate(st, Chess) === "edErr.manyWhiteKings", "second white king is rejected");

  st = bare();
  put(st, "e1", { type: "k", color: "w" });
  put(st, "e8", { type: "k", color: "b" });
  put(st, "a1", { type: "p", color: "w" });
  assert(E.validate(st, Chess) === "edErr.pawnBackRank", "pawn on the first rank is rejected");

  // white to move while black is already in check is unreachable in a real game
  st = bare();
  put(st, "e1", { type: "k", color: "w" });
  put(st, "e8", { type: "k", color: "b" });
  put(st, "e7", { type: "r", color: "w" });
  assert(E.validate(st, Chess) === "edErr.otherInCheck", "side not to move in check is rejected");

  // castling rights are dropped when the placement cannot support them
  st = bare();
  put(st, "e1", { type: "k", color: "w" });
  put(st, "e8", { type: "k", color: "b" });
  st.castling.K = true; // no rook on h1
  assert(E.toFen(st).split(" ")[2] === "-", "unsupported castling right is filtered out");
  put(st, "h1", { type: "r", color: "w" });
  assert(E.toFen(st).split(" ")[2] === "K", "supported castling right is kept");
}

// post-game review: the report is what the user reads instead of the raw
// numbers, so the arithmetic behind it gets its own checks
{
  loadModule(ctx, "src/web/js/review.js");
  const R = ctx.ChessReview;
  assert(R.summarize(null, [], "w") === null, "no analysis yields no report");
  assert(R.summarize([0], [], "w") === null, "a game with no moves yields no report");

  // White drops 4 pawns on ply 2 (a blunder); Black plays perfectly.
  //   scalars: start 0, after w1 0, after b1 0, after w2 -400, after b2 -400
  const scalars = [0, 0, 0, -400, -400];
  const history = ["e4", "e5", "Qh5", "Nc6"];
  const s = R.summarize(scalars, history, "w");
  assert(s.counts.w.blunder === 1, "white's 400cp drop counts as a blunder");
  assert(s.counts.b.blunder === 0 && s.counts.b.mistake === 0, "black's moves cost nothing");
  assert(s.worst && s.worst.san === "Qh5", "the turning point is the costliest move (" + (s.worst && s.worst.san) + ")");
  assert(s.worst.side === "w" && s.worst.ply === 2, "turning point attributed to the right side and ply");
  assert(s.worst.moveNo === 2, "turning point reported as move 2");
  assert(s.acpl.w === 200 && s.acpl.b === 0, "acpl averaged per side (w=" + s.acpl.w + ", b=" + s.acpl.b + ")");
  assert(s.acc.b === 100, "a flawless side scores 100%");
  assert(s.acc.w < s.acc.b, "the blundering side scores lower");

  // A game that starts from an edited position with Black to move: ply 0 is
  // Black's, so the losses must not be filed under White.
  const s2 = R.summarize([0, -400, -400], ["Qh4", "Nf3"], "b");
  assert(s2.counts.b.blunder === 0 && s2.counts.w.blunder === 0,
    "a swing in Black's favour is nobody's blunder");
  const s3 = R.summarize([0, 400, 400], ["Qh4", "Nf3"], "b");
  assert(s3.counts.b.blunder === 1 && s3.counts.w.blunder === 0,
    "with Black moving first, Black's blunder is filed under Black");

  // unmeasured plies (an aborted analysis) are skipped, never scored as perfect
  assert(R.summarize([0, null, -400], ["e4", "Qh5"], "w") === null,
    "an analysis with nothing measurable yields no report");

  // --- one accuracy formula, and the two side rules agree on it -------------
  // The clamp, the mean and the exponential existed twice until 1.25 — here
  // and as app.js accuracyFrom() — differing only in how each worked out whose
  // move a ply was. review.js owns the arithmetic now, but the two side rules
  // are still two: this one counts parity from the first mover, the app reads
  // the side to move off the FEN it already has. Nothing forced them to agree,
  // and nothing ever checked. 缺陷 6.
  {
    const g = new Chess();
    const line = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Nf6", "Ng5", "d5", "exd5", "Nxd5"];
    const fens = [g.fen()];
    for (const m of line) { g.move(m); fens.push(g.fen()); }
    // a track with real, uneven losses on both sides
    const scalars = [20, 10, 35, 30, 60, 55, 300, 40, 55, -120, 25];

    const viaFen = R.lossesBySide(scalars, (i) => (fens[i].split(" ")[1] === "w" ? "w" : "b"));
    const viaParity = R.lossesBySide(scalars, (i) => (i % 2 === 0 ? "w" : "b"));
    assert(JSON.stringify(viaFen) === JSON.stringify(viaParity),
      "the FEN side rule and the parity side rule split the same game the same way");

    const summary = R.summarize(scalars, line, "w");
    const appAcc = { w: R.accuracyOf(viaFen.w), b: R.accuracyOf(viaFen.b) };
    assert(summary.acpl.w === appAcc.w.acpl && summary.acpl.b === appAcc.b.acpl,
      "…and the report and the accuracy line quote the same ACPL (" +
      summary.acpl.w + "/" + appAcc.w.acpl + ", " + summary.acpl.b + "/" + appAcc.b.acpl + ")");
    assert(summary.acc.w === appAcc.w.acc && summary.acc.b === appAcc.b.acc,
      "…and the same accuracy (" + summary.acc.w + "/" + appAcc.w.acc + ")");

    // and app.js does not carry a second copy of the arithmetic any more
    const appTxt = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
    const at = appTxt.indexOf("function accuracyFrom(");
    const accFrom = appTxt.slice(at, appTxt.indexOf("\n  }", at));
    assert(/Review\.lossesBySide/.test(accFrom) && /Review\.accuracyOf/.test(accFrom),
      "app.js gets its accuracy from review.js");
    assert(!/Math\.exp/.test(accFrom) && !/Math\.min\(1000/.test(accFrom),
      "…and holds no clamp or curve of its own");
  }
  const s4 = R.summarize([0, -400, null, -400], ["e4", "Nf3", "Qh5"], "w");
  assert(s4.measured === 1, "only the measurable plies are scored (" + s4.measured + ")");
  assert(s4.counts.w.blunder === 1 && s4.acpl.b === null,
    "a side with no measured move gets no accuracy rather than 100%");

  // thresholds line up with the ?!/?/?? marks in the move list
  const grade = (loss) => R.summarize([0, -loss], ["e4"], "w").counts.w;
  assert(grade(49).inaccuracy === 0, "49cp is not yet an inaccuracy");
  assert(grade(50).inaccuracy === 1, "50cp is an inaccuracy");
  assert(grade(100).mistake === 1, "100cp is a mistake");
  assert(grade(300).blunder === 1, "300cp is a blunder");

  assert(R.verdictKey(s, "w") === "rv.verdict.oneBlunder", "one blunder gets its own verdict");
  assert(R.verdictKey(s, "b") === "rv.verdict.excellent", "a clean game reads as excellent");
  assert(R.verdictKey(null, "w") === null, "no summary yields no verdict");
}

// material: who is up, and what each side has taken
{
  loadModule(ctx, "src/web/js/material.js");
  const M = ctx.ChessMaterial;
  const start = new Chess();
  assert(M.diff(start.board()) === 0, "the start position is level");
  assert(M.summary(start.board(), start.board(), []).w.length === 0, "nothing captured at the start");

  // 1.e4 d5 2.exd5 Qxd5 3.Nc3 Qxa2 — White has taken a pawn, Black a pawn and a pawn
  const g = new Chess();
  for (const san of ["e4", "d5", "exd5", "Qxd5", "Nc3", "Qxa2"]) assert(g.move(san) !== null, "played " + san);
  const s1 = M.summary(new Chess().board(), g.board(), []);
  assert(s1.w.join("") === "p", "White has taken one pawn (" + s1.w.join("") + ")");
  assert(s1.b.join("") === "pp", "Black has taken two pawns (" + s1.b.join("") + ")");
  assert(s1.diff === -1, "Black is a pawn up (diff " + s1.diff + ")");

  // a promotion must not be reported as a captured pawn
  const promo = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1");
  const before = new Chess("8/P6k/8/8/8/8/7K/8 w - - 0 1").board();
  promo.move({ from: "a7", to: "a8", promotion: "q" });
  const raw = M.summary(before, promo.board(), []);
  assert(raw.b.join("") === "p", "without the promotion list the pawn looks captured");
  const fixed = M.summary(before, promo.board(), [{ color: "w", promotion: "q" }]);
  assert(fixed.b.length === 0, "…and with it, nothing is reported as captured");
  assert(fixed.diff === 9, "the new queen counts towards the lead (diff " + fixed.diff + ")");

  // the difference is read off the board, so an edited starting position is fine
  const odd = new Chess("4k3/8/8/8/8/8/8/R3K3 w - - 0 1");
  assert(M.diff(odd.board()) === 5, "a lone rook is a five-pawn lead");
  assert(M.summary(odd.board(), odd.board(), []).w.length === 0,
    "a position that started that way reports no captures");

  // the display order is biggest prize first
  const mixed = new Chess("4k3/8/8/8/8/8/8/4K3 w - - 0 1");
  const many = M.summary(new Chess().board(), mixed.board(), []);
  assert(many.w[0] === "q" && many.w[many.w.length - 1] === "p", "captured pieces list queens first, pawns last");
  assert(many.w.length === 15 && many.b.length === 15, "…and every missing piece is listed");
}

// opening coach: the drills used to answer every wrong move with "not the
// book move", which is the one thing the player already knew
{
  loadModule(ctx, "src/web/js/opening-coach.js");
  const OC = ctx.ChessOpeningCoach;
  const why = (prior, played, book) => {
    const r = OC.critique("", prior, played, book, Chess);
    return r && r.key;
  };
  const ITALIAN = ["e4", "e5", "Nf3", "Nc6"];
  const READY_TO_CASTLE = ["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"];

  assert(why(ITALIAN, "Nh4", "Bc4") === "opc.hangs", "a piece left en prise is the first thing said");
  const hang = OC.critique("", ITALIAN, "Nh4", "Bc4", Chess);
  assert(hang.vals[0] === "piece.n" && hang.vals[1] === "Qxh4",
    "…naming the piece and the refutation (" + hang.vals.join(", ") + ")");
  assert(why(READY_TO_CASTLE, "Kf1", "O-O") === "opc.kingMove", "a king move that burns castling rights is called out");
  assert(why(ITALIAN, "Qe2", "Bc4") === "opc.earlyQueen", "the queen out before the minor pieces is called out");
  assert(why(["e4", "e5", "Nf3", "Nc6", "Bc4", "Bc5"], "Bb3", "O-O") === "opc.samePiece",
    "moving the same bishop twice while the king waits is called out");
  assert(why(READY_TO_CASTLE, "a3", "O-O") === "opc.castle", "not castling when the line does is called out");
  assert(why(["d4", "Nf6", "c4", "e6"], "a3", "Nc3") === "opc.develop", "a pawn shuffle instead of development is called out");
  assert(why([], "h4", "e4") === "opc.centre", "ignoring the centre is called out");
  assert(why(["e4", "e5", "Nf3", "Nc6"], "h3", "Bc4") === "opc.develop", "…and an edge pawn instead of a piece is development advice");

  // A move can be perfectly good and still not be this line. Inventing a
  // fault for 1.Nf3 or 1.d4 would teach something false.
  assert(why([], "Nf3", "e4") === "opc.sound", "a sound developing move is not called a mistake");
  assert(why([], "d4", "e4") === "opc.sound", "a sound central move is not called a mistake");

  // Material the line was always going to shed — a gambit pawn, or here a rook
  // already under fire that neither candidate saves — is not this move's
  // fault. Only a loss the book move avoids gets reported.
  const ROOK_EN_PRISE = "4k2b/8/8/8/8/8/8/R3K2R w KQ - 0 1"; // Bh8 hits the undefended a1
  assert(OC.critique(ROOK_EN_PRISE, [], "Rf1", "Rg1", Chess).key !== "opc.hangs",
    "material already lost before the move is not blamed on it");
  assert(OC.critique(ROOK_EN_PRISE, [], "Rf1", "Rb1", Chess).key === "opc.hangs",
    "…but material the book move would have saved is");

  assert(OC.critique("", ITALIAN, "Nxe4", "Bc4", Chess) === null, "an illegal move yields no critique");
  assert(OC.critique("", ["nonsense"], "e4", "d4", Chess) === null, "an unreplayable line yields no critique");
  assert(OC.hanging("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", Chess).gain === 0,
    "nothing hangs in the start position");

  // every key the coach can emit must exist in every language
  const coachSrc = fs.readFileSync(path.join(root, "src/web/js/opening-coach.js"), "utf8");
  const coachKeys = [...coachSrc.matchAll(/key: "(opc\.[a-zA-Z]+)"/g)].map((m) => m[1]);
  assert(coachKeys.length >= 8, "found " + coachKeys.length + " coach messages");
  loadModule(ctx, "src/web/js/i18n.js");
  const DICT = ctx.ChessI18n.DICT;
  let missingCoach = 0;
  for (const k of new Set(coachKeys)) {
    for (const lang of Object.keys(DICT)) {
      if (!(k in DICT[lang])) { missingCoach++; console.error("FAIL: " + lang + " is missing " + k); }
    }
  }
  assert(missingCoach === 0, "every coach message is translated in every language");
}

// puzzle review scheduling: a puzzle used to graduate on the first correct
// answer, which was usually given seconds after reading the solution
{
  loadModule(ctx, "src/web/js/srs.js");
  const S = ctx.ChessSrs;
  assert(S.GRADUATE >= 2, "graduating takes more than one correct answer");
  assert(!S.isDue(undefined), "an unseen puzzle is not in the queue");

  // miss -> solve -> solve is the full cycle
  let e = S.onMiss(undefined);
  assert(S.isDue(e), "a missed puzzle enters the queue");
  e = S.onSolve(e);
  assert(e && S.isDue(e), "one correct answer is not enough to graduate");
  e = S.onSolve(e);
  assert(e === null, "the second consecutive correct answer graduates it");

  // a miss part-way through resets the streak
  let f = S.onSolve(S.onMiss(undefined));
  assert(S.entry(f).s === 1, "streak advanced to 1");
  f = S.onMiss(f);
  assert(S.entry(f).s === 0, "a later miss resets the streak");
  assert(S.entry(f).n === 3, "but the times-seen count keeps growing across misses and solves");

  // 1.6 stored a bare `true`; those entries must keep working
  assert(S.isDue(true), "a legacy boolean entry is still due");
  assert(S.entry(true).s === 0, "a legacy entry starts at streak 0");
  assert(S.onSolve(true) !== null, "a legacy entry does not graduate on one solve");

  // solving something that was never missed is a no-op
  assert(S.onSolve(undefined) === null, "solving an unqueued puzzle changes nothing");

  // ordering puts the least-learned first, so the one just solved goes last
  const state = { a: { s: 1, n: 3 }, b: { s: 0, n: 1 }, c: { s: 0, n: 5 } };
  assert(S.order(["a", "b", "c"], state).join(",") === "c,b,a",
    "queue order is least-learned first, most-seen first within a streak (" +
    S.order(["a", "b", "c"], state).join(",") + ")");

  const [done, total] = S.progress({ s: 1, n: 2 });
  assert(done === 1 && total === S.GRADUATE, "progress reports streak against the target");
}

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
    const blocks = src.split(/\n {4}(?:"zh-CN"|en|ja): \{\n/).slice(1);
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
    const sources = ["src/web/index.html", ...fs.readdirSync(path.join(root, "src/web/js"))
      .filter((f) => f.endsWith(".js") && f !== "bundle.js" && f !== "i18n.js")
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
    const appSrc2 = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
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
    const appSrc3 = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
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
    const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
    assert(/function animateReply\(mv\)/.test(appSrc),
      "opponent replies go through one helper");
    // nothing may call the raw animator except that helper — a direct call is
    // how the player's own move got animated in the first place
    const raw = [...appSrc.matchAll(/^.*BoardView\.animateMove\(.*$/gm)].map((m) => m[0].trim());
    assert(raw.length === 1 && /animateMove\(mv\.from, mv\.to, castleRook\(mv\)\)/.test(raw[0]),
      "the board animator has exactly one caller, inside animateReply" +
      (raw.length === 1 ? "" : " — extra: " + raw.join(" ;; ")));
    // and every opponent-reply site must use it
    const replies = (appSrc.match(/animateReply\(/g) || []).length - 1; // minus the definition
    assert(replies >= 4,
      "all four opponent-reply paths animate (engine game, lesson drill, " +
      "scripted puzzle line, mate-puzzle defence) — found " + replies);

    // castling moves two men; chess.js reports only the king's
    assert(/function castleRook\(mv\)/.test(appSrc), "the rook's half of a castle is derived");
    const rook = /function castleRook[\s\S]*?\n  \}/.exec(appSrc)[0];
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
    const side = num(/--side-w:\s*(\d+)px/, css), chrome = num(/--chrome-h:\s*(\d+)px/, css);
    assert([w, h, side, chrome].every(Number.isFinite),
      "read the default window (" + w + "x" + h + ") and the panel metrics (" + side + "/" + chrome + ")");
    assert(w - side >= h - chrome,
      "the default window fits the panel without shrinking the board (" +
      (w - side) + "px of width vs " + (h - chrome) + "px of height)");
  }

  // The panel is split into three tabs. A section that ends up outside a pane
  // is invisible in every tab — the failure mode is silent, so it gets a check.
  const paneIds = [...html.matchAll(/<div class="side-pane" id="(pane-[a-z]+)"/g)].map((m) => m[1]);
  assert(paneIds.length === 3, "found the three panel panes (" + paneIds.join(", ") + ")");
  const tabControls = [...html.matchAll(/role="tab"[^>]*aria-controls="([^"]+)"/g)].map((m) => m[1]);
  assert(tabControls.length === 3 && tabControls.every((c) => paneIds.includes(c)),
    "every tab points at a pane that exists");
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
    // The two plain Elo tooltips are a product name and a number — there is
    // nothing in them to translate. (The labels themselves are words: 1.24
    // briefly put the Elo values ON the buttons, which was wrong. UCI_Elo is
    // an engine setting, its floor of 1320 is already above a real beginner,
    // and this app never gives the player a rating to compare against.)
    // `lm.tipSep` is the punctuation between a drill's outcome and the
    // technique it teaches. Japanese and Chinese both end a sentence with 。 —
    // it is translated, and the translation is the same mark.
    ja: new Set(["act.pgnCopy", "act.fen", "hist.pgn", "vs.white", "stats.gamesSuffix",
      "learn.lessonPre", "ed.crK", "ed.crQ",
      "tip.diffNormal", "tip.diffHard", "lm.tipSep"]),
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
  let miscounted = 0;
  for (const id of langs) {
    const m = /(\d+)/.exec(I.DICT[id]["ob.newSub"] || "");
    if (!m || Number(m[1]) !== ctx.CHESS_LESSONS.length) {
      miscounted++;
      console.error("FAIL: " + id + " promises " + (m ? m[1] : "?") + " lessons, there are " + ctx.CHESS_LESSONS.length);
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
  for (const m of html.matchAll(/<(h3|button|span|div|p)\b([^>]*)>([^<]*[一-鿿][^<]*)</g)) {
    const [, tag, attrs, text] = m;
    if (/data-i18n=/.test(attrs)) continue;
    if (/\sid="(status|moves|white-role|black-role|clock-[wb])"/.test(attrs)) continue; // written by sync()
    bareText++;
    console.error("FAIL: untranslatable <" + tag + "> text: " + text.trim());
  }
  assert(bareText === 0, "every Chinese label in index.html carries data-i18n");

  // No Chinese string literal may reach the DOM from app.js. v1.5 translated
  // the static markup and left 169 runtime literals — task prompts, puzzle
  // feedback, every toast — so English mode stayed half Chinese where it
  // mattered most. This is the check that would have caught it.
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  let literals = 0;
  let inBlockComment = false;
  appSrc.split("\n").forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("/*")) inBlockComment = true;
    if (inBlockComment) { if (trimmed.includes("*/")) inBlockComment = false; return; }
    if (trimmed.startsWith("//") || trimmed.startsWith("*")) return;
    for (const m of line.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)) {
      if (!han.test(m[1])) continue;
      literals++;
      console.error("FAIL: app.js:" + (i + 1) + " hard-codes Chinese: " + m[1]);
    }
  });
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
  const taskTextFn = /function taskText\(lesson, ti\) \{[\s\S]*?\n  \}/.exec(appSrc);
  assert(!!taskTextFn, "found the lesson-prose accessor");
  const outside = appSrc.replace(taskTextFn[0], "");
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
  const restore = /function restoreEnding\(rec\) \{[\s\S]*?\n  \}/.exec(appSrc);
  const handled = restore ? [...restore[0].matchAll(/end === "([a-zA-Z]+)"/g)].map((m) => m[1]) : [];
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
  // and the v1 stats file still opens
  assert(/if \(s && s\.v === 1 && Array\.isArray\(s\.games\)\)/.test(appSrc),
    "a v1 stats file is migrated rather than dropped");

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
    assert(/1\.2/.test(I.DICT["zh-CN"]["tip.diff.extreme"]),
      "…and its tooltip says what it actually does");
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
  }

  // --- every "category × difficulty" combination is non-empty, or absent ----
  // P5 acceptance. puzzleTier()'s dominant term is (plies − 1) × 1.5, and in
  // the three mate categories the ply count is a written-in constant (1/3/5),
  // contributing 0, 3 and 6 while everything else together moves the score by
  // at most ±4.5 — never across a 3-point band. So the tier was the category
  // under another name, seven of the eighteen combinations were empty, and
  // picking one showed a blank list. The filter is remembered, so the next
  // visit to that category still looked empty. 缺陷 14.
  //
  // Fixed as (A): the categories where difficulty is not a separate axis do
  // not offer the filter. This asserts both halves — the ones that offer it
  // have every band populated, and the ones that do not are declared.
  {
    const appTier = appSrc.slice(appSrc.indexOf("const TIER_CATS = new Set("));
    const declared = /const TIER_CATS = new Set\(\[([^\]]*)\]\)/.exec(appTier);
    assert(!!declared, "the categories with a real difficulty axis are declared");
    const cats = declared[1].match(/"(\w+)"/g).map((x) => x.replace(/"/g, ""));
    for (const m of ["m1", "m2", "m3"]) {
      assert(!cats.includes(m), m + " does not offer a filter that repeats its own name");
    }
    assert(cats.includes("tac") && cats.includes("def") && cats.includes("op") && cats.includes("real"),
      "…and the four that do keep it — " + cats.join(", "));
    assert(/!tierApplies\(cat\)/.test(appSrc), "the filter is bypassed where it does not apply");
    assert(/avail\(el\("row-puzzle-tier"\), /.test(appSrc),
      "…and the row is absent rather than dead");
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
    const at = appSrc.indexOf("function writeSan(node, san, color)");
    const ws = appSrc.slice(at, appSrc.indexOf("\n  }", at));
    assert(/SAN_PIECE\[san\[0\]\]/.test(ws), "only the leading piece letter becomes a piece");
    assert(/san\.slice\(1\)/.test(ws), "…the rest of the move is text");
    const cssM2 = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
    const num = /\.mlnum \{([^}]*)\}/.exec(cssM2);
    assert(num && /font-size: 13px/.test(num[1]),
      "the move number is the same size as the move beside it");
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
    const at = appSrc.indexOf("function renderReportCanvas()");
    const rep = appSrc.slice(at, appSrc.indexOf("\n  }\n", at));
    assert(/REPORT_INK/.test(rep) && !/pick\("--card"/.test(rep),
      "the export has its own opaque palette, not the theme's");
    assert(/const REPORT_INK = \{[^}]*bg: "#/.test(appSrc), "…and it is a literal, on purpose");
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
    assert(/const REPORT_FONT = /.test(appSrc), "…there is one stack for the image");
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
    const outsideEnding = appSrc.slice(0, appSrc.indexOf("function playEnding(winner)")) +
      appSrc.slice(appSrc.indexOf("\n  }", appSrc.indexOf("function playEnding(winner)")));
    const wins = (outsideEnding.match(/Audio2\.playWin\(\)/g) || []).length;
    // the two that remain are the student finishing a lesson and solving a
    // puzzle — those really are wins, and have no loser
    assert(wins === 2, "nothing else reaches for the fanfare directly (" + wins + ")");
    const endAt = appSrc.indexOf("function playEnding(winner)");
    const ending = appSrc.slice(endAt, appSrc.indexOf("\n  }", endAt));
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
    const tAt = appSrc.indexOf("function toast(msg, tier)");
    const t3 = appSrc.slice(tAt, appSrc.indexOf("\n  }", tAt));
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
    const appC = appSrc;
    // class selectors the stylesheet defines, minus state/modifier suffixes
    const defined = new Set([...cssC.matchAll(/^\s*\.([a-z][a-z0-9-]*)/gm)].map((m) => m[1]));
    const orphans = [];
    for (const c of defined) {
      // a word-boundary search of the markup and the app: classes are set as
      // literals, as parts of a multi-class string ("mlnum num"), and as
      // concatenations ("mvtag " + tier), so anything narrower reports rules
      // that are very much in use
      const used = new RegExp("\\b" + c.replace(/-/g, "\\-") + "\\b");
      if (!used.test(htmlC) && !used.test(appC)) orphans.push(c);
    }
    for (const c of orphans) console.error("  no markup uses ." + c);
    assert(orphans.length === 0,
      "every class the stylesheet defines is worn by something" +
      (orphans.length ? " — " + orphans.length + " orphan(s)" : " (" + defined.size + " classes)"));
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
      assert(n === 4, v + " is declared once per board and nowhere else (" + n + ")");
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
      assert(n === 4, "all four board palettes answer for " + v + " (" + n + ")");
    }
    assert(/\.mvtag\.t-soft \{ color: var\(--judge-soft\)/.test(cssJ), "the move list reads the scale");
    assert(/background: var\(--side-black\)/.test(cssJ) && /background: var\(--side-white\)/.test(cssJ),
      "the eval bar reads the two sides");
    assert(/function judgeColours\(\)/.test(appSrc), "the canvas reads the same tokens");
    // the only literals left are the fallbacks inside that one accessor, for
    // a document that has not applied a stylesheet yet
    const at = appSrc.indexOf("function judgeColours()");
    const elsewhere = appSrc.slice(0, at) + appSrc.slice(appSrc.indexOf("\n  }", at));
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
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js") && n !== "bundle.js")) {
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
    assert(/export const SCHEMA = \d+/.test(per) && /MIGRATIONS/.test(per),
      "there is one schema version, and a place for migrations to queue");
    // every key the app owns is in the list — a key added elsewhere would be
    // written but never cleared
    const keys = [...per.matchAll(/^  \w+: "(chess\.[\w.]+)"/gm)].map((m) => m[1]);
    assert(keys.length === 8, "all eight keys are declared in one place (" + keys.length + ")");
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
    const esc = /if \(ev\.key === "Escape"\) \{[\s\S]*?\n    \}/.exec(appSrc);
    assert(!!esc, "found the Escape handler");
    // comments only; the point is that no *code* tests a dialog by hand
    const code = esc[0].replace(/\/\/.*$/gm, "");
    const chain = (code.match(/classList\.contains\("show"\)/g) || []).length;
    assert(chain === 0, "Escape tests no dialog by hand (" + chain + " left)");
    assert(/Dlg\.closeTop\(\)/.test(esc[0]), "…it asks for the top of the stack");
    // dialogOpen() is one answer from one place
    assert(/function dialogOpen\(\) \{\s*return Dlg\.anyOpen\(\);/.test(appSrc),
      "\"is a dialog open\" is answered by the module that opens them");
    // every dialog says how it closes, once, where it is built
    const wire = /function wireDialogs\(\) \{[\s\S]*?\n  \}/.exec(appSrc);
    assert(!!wire, "the closers are registered in one block");
    const registered = (wire[0].match(/Dlg\.register\(/g) || []).length;
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

// achievements: well-formed, unique, each reachable from some summary, and the
// meta "completionist" resolves from the others
{
  loadModule(ctx, "src/web/js/achievements.js");
  const ach = ctx.CHESS_ACHIEVEMENTS;
  assert(Array.isArray(ach) && ach.length >= 10, "achievements loaded (" + (ach ? ach.length : 0) + ")");
  const ids = new Set();
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  // a maxed-out summary should unlock everything, an empty one nothing (except
  // completionist is gated on others so it also stays locked when empty)
  const full = {
    lessonsDone: 99, lessonsTotal: 28, puzzleSolvedCount: 99,
    matesSolved: 23, matesTotal: 23, tacSolved: 6, tacTotal: 6, realSolved: 24, realTotal: 24,
    opSolved: 38, opTotal: 38, wins: 99, losses: 0, draws: 0, games: 99, extremeWins: 9,
    otherUnlocked: 12, otherTotal: 12,
  };
  const empty = {
    lessonsDone: 0, lessonsTotal: 28, puzzleSolvedCount: 0,
    matesSolved: 0, matesTotal: 23, tacSolved: 0, tacTotal: 6, realSolved: 0, realTotal: 24,
    opSolved: 0, opTotal: 38, wins: 0, losses: 5, draws: 0, games: 5, extremeWins: 0,
    otherUnlocked: 0, otherTotal: 12,
  };
  for (const a of ach) {
    if (!a.id || ids.has(a.id)) { fail("achievement id missing/duplicate", a.id); continue; }
    ids.add(a.id);
    if (!a.icon || !a.name || !a.desc) fail(a.id, "missing icon/name/desc");
    if (typeof a.test !== "function") { fail(a.id, "test not a function"); continue; }
    if (!a.test(full)) fail(a.id, "not unlocked by a maxed summary");
    if (a.test(empty)) fail(a.id, "unlocked by an empty summary");
  }
  assert(bad === 0, "all achievements well-formed and reachable");
}

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
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
  for (const [what, re] of [
    ["the export dialog", /Host\.revealPath\(path\);\s*\n\s*Host\.addRecentDocument\(path\);/],
    ["the open dialog", /importPgnText\(text, paths\[0\]\);\s*\n\s*Host\.addRecentDocument\(paths\[0\]\);/],
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
    const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const noBtn = list.filter((id) => !html.includes('data-diff="' + id + '"'));
    assert(noBtn.length === 0,
      "every rung has a button" + (noBtn.length ? " — missing: " + noBtn.join(", ") : ""));
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

// --- state that has to be let go of, and state that has to be held on to ---
// Three bugs of the same family, all invisible from the outside: something the
// app remembers about "the current game" outlived the game, or something worth
// remembering was dropped on the floor. Source-level guards, because each one
// lives inside app.js's IIFE where a unit test cannot reach it.
{
  const appSrc = fs.readFileSync(path.join(root, "src/web/js/app.js"), "utf8");
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
  const analyze = code(fn("analyzeGame"));
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
  for (const [where, src] of [["新局", fn("requestNewGame")], ["清除存档", appSrc]]) {
    assert(src.length > 0, where + " is still there to check");
  }
  const newGame = fn("requestNewGame");
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
  for (const f of fs.readdirSync(dir).filter((n) => n.endsWith(".js") && n !== "bundle.js")) {
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
  // did not throw. Two stops per check gradient, on two of the shapes.
  assert(checkStops === 4, "the check gradient painted on both shapes that set checkSquare (" + checkStops + " stops)");
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

// README quotes its own numbers, and they drift. Through 1.20 it advertised
// "57 课" in three places (the course had 67) and both "572 个界面键" and
// "526 条" for a dictionary of 589 — and 1.20 was a release *about* the course
// growing, which is exactly when nobody rereads the README. Each claim below
// is checked against the thing it describes.
{
  const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
  const lessons = ctx.CHESS_LESSONS.length;
  const keys = Object.keys(ctx.ChessI18n.DICT["zh-CN"]).length;
  const puzzles = ctx.CHESS_PUZZLES.length;
  const openings = new Set(ctx.CHESS_OPENINGS.map((o) => o[1])).size;
  // same filter app.js uses to decide a line is long enough to drill
  const drilledOpenings = ctx.CHESS_OPENINGS.filter((o) => o[2].split(" ").length >= 6).length;
  const claims = [
    [/零基础 (\d+) 课/, lessons, "the course size in the teaching row"],
    [/教学课程 (\d+) 课/, lessons, "the course size in the file map"],
    [/英文全译 (\d+) 课/, lessons, "the English course size"],
    [/(\d+) 个界面键三语齐备/, keys, "the interface-key count"],
    [/zh-CN \/ en \/ ja 各 (\d+) 条/, keys, "the dictionary size in the file map"],
    // Anchored to the file-map line. Unanchored, `/题库 (\d+) 题/` matched only
    // this line anyway — the 做题 row wrote 题库(**273 题**) with no space, so
    // the one number a reader meets first was the one number nobody checked.
    // It was also 战术 164 + 开局线路 109 added together and labelled 题, which
    // no count in the code equals. The row now states the two numbers it is
    // made of, and both are checked.
    [/js\/puzzles\.js\s+# 题库 (\d+) 题/, puzzles, "the puzzle count in the file map"],
    [/战术题库 (\d+) 题/, puzzles, "the tactics-puzzle count in the 做题 row"],
    [/开局线路 (\d+) 条/, drilledOpenings, "the drilled-opening count in the 做题 row"],
    [/开局题执白照谱背 \*\*(\d+) 条\*\*主流线路/, drilledOpenings, "the drilled-opening count in the drill sentence"],
    [/内置 \*\*(\d+) 条\*\* ECO 库/, ctx.CHESS_OPENINGS.length, "the ECO library size"],
  ];
  let stale = 0;
  for (const [re, actual, what] of claims) {
    const m = re.exec(readme);
    if (!m) { stale++; console.error("FAIL: README no longer states " + what + " (" + re + ")"); continue; }
    if (Number(m[1]) !== actual) {
      stale++;
      console.error("FAIL: README says " + m[1] + " for " + what + ", but it is " + actual);
    }
  }
  void openings;
  assert(stale === 0, "every count README quotes matches the code");

  // --- and every measured figure it quotes matches the run that produced it -
  // Defect 12: the handicap tiers' score rate lived in two places and agreed
  // in neither. README said 56% / 27% over 32 games; engine.js's comment said
  // 66% / 25% with no game count (the 24 games it names are the *previous*
  // calibration, worstBias 0.6). The script that produces the number printed
  // it and forgot. docs/measured.json is now where a run lands, and this is
  // what stops prose from drifting off it again.
  {
    const measured = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8"));
    // Comment prose wraps, and a `// ` at the start of the next line sits in
    // the middle of a sentence — flatten it so a phrase can be matched at all.
    //
    // `\r` goes first, and that is not defensive tidying. A Windows runner
    // checks out with CRLF, so flattening `…27% on\r\n    // \`casual\`…` leaves
    // the \r sitting mid-sentence where the break was, and every quoted phrase
    // that happens to span a line break stops matching. It cost the 2.0
    // release: ubuntu green, macOS green, Windows red on five assertions, and
    // the failure arrived after the tag had already been pushed. Read normalised
    // and the text is the same text on every platform.
    const normalise = (t) => t.replace(/\r\n/g, "\n");
    const readSrc = (rel) => normalise(fs.readFileSync(path.join(root, rel), "utf8"));
    const flattenSlashes = (t) => t.replace(/\n\s*\/\/ ?/g, " ");
    const engineSrc = readSrc("src/web/js/engine.js");
    const engineFlat = flattenSlashes(engineSrc);
    // The regression itself, reproduced on whatever platform this is running
    // on: flatten a CRLF copy of the same file and it must come out as the
    // same text. Asserting "engineFlat has no \r" would pass trivially on a
    // LF checkout — which is precisely how the bug reached a release runner
    // with ubuntu and macOS green.
    {
      // Run the real path — normalise() then the real flatten — over a CRLF
      // copy. Drop the normalisation and this differs, on any platform.
      const asCrlf = engineSrc.replace(/\n/g, "\r\n");
      assert(flattenSlashes(normalise(asCrlf)) === engineFlat,
        "the measured-figure checks read the same text on a CRLF checkout as on a LF one");
    }

    const nov = measured.noviceScore && measured.noviceScore.tiers;
    let off = 0;
    const check = (where, text, re, actual, what) => {
      const m = re.exec(text);
      if (!m) { off++; console.error("FAIL: " + where + " no longer states " + what); return; }
      if (Number(m[1]) !== actual) {
        off++;
        console.error("FAIL: " + where + " says " + m[1] + " for " + what + ", measured is " + actual);
      }
    };
    assert(!!nov && !!nov.beginner && !!nov.casual,
      "docs/measured.json holds a novice-score run for both handicap tiers");
    if (nov && nov.beginner && nov.casual) {
      // the `careful` bot is the one both texts quote — a bot that only avoids
      // dropping a piece to an immediate recapture, i.e. about what a raw
      // beginner sees
      check("README", readme, /32 盘对新手得分率 \*\*(\d+)%\*\*/, nov.beginner.careful.scorePct, "the beginner score rate");
      check("README", readme, /对休闲 \*\*(\d+)%\*\*/, nov.casual.careful.scorePct, "the casual score rate");
      check("engine.js", engineFlat, /now scores (\d+)% here/, nov.beginner.careful.scorePct, "the beginner score rate");
      check("engine.js", engineFlat, /and (\d+)% on `casual`/, nov.casual.careful.scorePct, "the casual score rate");
      // anchored past the `casual` clause: the *other* "24 games" in this
      // comment is the previous calibration's, and it is meant to stay
      check("engine.js", engineFlat, /on `casual` over (\d+) games/, nov.beginner.careful.games, "the game count");
      check("README", readme, /机器人，(\d+) 盘对新手/, nov.beginner.careful.games, "the game count");
      // the settings the run used must still be the settings that ship, or the
      // figure describes a tier that no longer exists
      for (const [tier, rec] of [["beginner", nov.beginner], ["casual", nov.casual]]) {
        const row = new RegExp("\\n\\s*" + tier + ": \\{([^}]*)\\}").exec(engineSrc);
        for (const [k, v] of Object.entries(rec.settings || {})) {
          const got = new RegExp(k + ":\\s*([\\d.]+)").exec(row ? row[1] : "");
          if (!got || Number(got[1]) !== v) {
            off++;
            console.error("FAIL: " + tier + "." + k + " is " + (got && got[1]) +
              " but the recorded run used " + v + " — re-record");
          }
        }
      }
    }
    // the ACPL side of the same rule
    const acpl = measured.tierAcpl && measured.tierAcpl.tiers;
    assert(!!acpl && !!acpl.beginner, "docs/measured.json holds an ACPL run");
    if (acpl && acpl.beginner) {
      const b = acpl.beginner;
      check("engine.js", engineFlat, /Measured: (\d+) ACPL/, b.acpl, "the beginner ACPL");
      check("engine.js", engineFlat, /mistake in (\d+)% of moves/, Math.round((b.serious / b.n) * 100), "the beginner blunder rate");
      check("engine.js", engineFlat, /median loss (\d+)/, b.median, "the beginner median loss");
    }
    assert(off === 0, "README and engine.js quote docs/measured.json, and it describes the tiers that ship");

    // P6 / 缺陷 23. The annotation cut-offs were measured against the quick
    // scan's own noise and deliberately left where they are — which only means
    // anything while the numbers that were measured are the numbers that ship.
    // Move one of them and this fails until the scan is re-run, because the
    // recorded agreement rates describe 50/100/300 and nothing else.
    {
      const scan = measured.scanNoise;
      assert(!!scan && !!scan.byMovetime, "docs/measured.json holds a scan-noise run");
      if (scan && scan.thresholds) {
        const rv = fs.readFileSync(path.join(root, "src/web/js/review.js"), "utf8");
        const got = /const INACCURACY = (\d+), MISTAKE = (\d+), BLUNDER = (\d+);/.exec(rv);
        assert(!!got, "review.js still declares the three cut-offs on one line");
        if (got) {
          const want = [scan.thresholds.inaccuracy, scan.thresholds.mistake, scan.thresholds.blunder];
          const have = [Number(got[1]), Number(got[2]), Number(got[3])];
          assert(want.join("/") === have.join("/"),
            "the cut-offs that ship are the cut-offs that were measured (" + have.join("/") +
            " vs recorded " + want.join("/") + " — re-run scripts/test-analysis.mjs --record)");
        }
        // and the sweep has to have actually been run, or "no better value
        // exists" is an opinion rather than a result
        const sweeps = Object.values(scan.byMovetime).map((r) => Object.keys(r.sweep || {}).length);
        assert(sweeps.length >= 2 && sweeps.every((n) => n >= 5),
          "…and the ?! threshold was swept, not just asserted");
        // review.js's own comment quotes this run — same rule as the tier
        // figures: a re-record has to drag the prose with it
        const flattenStars = (t) => t.replace(/\n\s*\* ?/g, " ");
        const rvRaw = readSrc("src/web/js/review.js");
        const rvSrc = flattenStars(rvRaw);
        assert(flattenStars(normalise(rvRaw.replace(/\n/g, "\r\n"))) === rvSrc,
          "…and so do review.js's");
        const q = scan.byMovetime["120"];
        check("review.js", rvSrc, /moves by a median (\d+)cp between runs/, q.jitterMedian, "the scan jitter median");
        check("review.js", rvSrc, /(\d+)cp at the ninth percentile/, q.jitterP90, "the scan jitter p90");
        check("review.js", rvSrc, /both runs called it (\d+)% of the time/, q.tags["?!"].agreePct, "the ?! agreement");
        check("review.js", rvSrc, /`\?` reaches (\d+)%/, q.tags["?"].agreePct, "the ? agreement");
        check("review.js", rvSrc, /and `\?\?` (\d+)%/, q.tags["??"].agreePct, "the ?? agreement");
        const sweepQuote = [40, 50, 60, 70, 80, 90].map((k) => q.sweep[String(k)].agreePct).join("/");
        const sweepSaid = /agreement wanders \(([\d/]+)\)/.exec(rvSrc);
        assert(!!sweepSaid && sweepSaid[1] === sweepQuote,
          "review.js quotes the recorded ?! sweep (" + (sweepSaid ? sweepSaid[1] : "—") +
          " vs measured " + sweepQuote + ")");
        assert(off === 0, "review.js's measured figures are the recorded ones");
      }
    }

    // 缺陷 32. The candidate-weighting arm was measured and rejected; the tier
    // rows must therefore not carry the knob, or the comment is describing
    // code that is not there.
    {
      const mv = measured.multipvPhase;
      assert(!!mv && !!mv.phases && !!mv.phases.endgame,
        "docs/measured.json holds a candidate-count run that reached the endgame");
      const rows = (engineSrc.match(/^\s*(?:beginner|casual): \{.*$/gm) || []).join("\n");
      assert(rows.length > 0 && !/spreadK/.test(rows),
        "the rejected weighting is not half-shipped as an unused tier option");
      assert(!!(mv && mv.weightedSamplingTried),
        "…and the runs that rejected it are on the record");
    }
  }

  // The 怎么玩 heading carries a version and nothing checked it, so it sat at
  // v1.16 through five releases. app.zon is the only place the version is real.
  const zonVersion = /\.version\s*=\s*"([^"]+)"/.exec(
    fs.readFileSync(path.join(root, "app.zon"), "utf8"));
  const headingVersion = /^## 怎么玩（v([\d.]+)）/m.exec(readme);
  assert(zonVersion && headingVersion, "README 怎么玩 heading and app.zon both state a version");
  if (zonVersion && headingVersion) {
    // Compared at major.minor. That section describes what the app does, which
    // is what a minor bump changes and a patch bump does not — pinning the
    // patch digit too would make every fix release edit a heading it did not
    // change, and a rule people edit to shut up is a rule they stop reading.
    const minor = (v) => v.split(".").slice(0, 2).join(".");
    assert(minor(headingVersion[1]) === minor(zonVersion[1]),
      "README 怎么玩 heading tracks app.zon (README v" + headingVersion[1] + " vs " + zonVersion[1] + ")");

    // "Am I being run directly?" must not be answered by string-pasting
    // `file://` onto argv[1]. On Windows argv[1] is `D:\\a\\…\\x.mjs` while
    // import.meta.url is `file:///D:/a/…/x.mjs`, so the comparison is false and
    // the main block silently does not run — no output, no error, exit 0.
    // scripts/bundle.mjs had it, and the Windows release build therefore
    // produced no bundle.js and failed three commands later on `cp`, with a
    // message that named the wrong thing. Both this and the CRLF bug above
    // shipped green on ubuntu and macOS.
    {
      const bad = [];
      for (const n of fs.readdirSync(path.join(root, "scripts"))) {
        if (!n.endsWith(".mjs")) continue;
        const src = fs.readFileSync(path.join(root, "scripts", n), "utf8");
        if (/file:\/\/\$\{\s*process\.argv\[1\]\s*\}/.test(src)) bad.push("scripts/" + n);
      }
      assert(bad.length === 0,
        "no script decides \"run directly?\" by pasting file:// onto argv[1] (" + bad.join(", ") + ")");
    }

    // The release workflow does `test -f .github/release-notes/<tag>.md` and
    // stops if it is missing — after tagging, and only when someone runs it.
    // Every version this repo has shipped has a notes file; the check for
    // whether the current one does should not wait for release day.
    {
      const notes = path.join(root, ".github/release-notes/v" + zonVersion[1] + ".md");
      assert(fs.existsSync(notes),
        "the version in app.zon has release notes (.github/release-notes/v" + zonVersion[1] + ".md)");
      if (fs.existsSync(notes)) {
        const text = fs.readFileSync(notes, "utf8");
        // the heading names the version, so a copied file cannot ship describing another one
        const head = /^## 国际象棋 v([\d.]+)/m.exec(text);
        const minorOf = (v) => v.split(".").slice(0, 2).join(".");
        assert(!!head && minorOf(head[1]) === minorOf(zonVersion[1]),
          "…and its heading names that version (" + (head ? head[1] : "—") + " vs " + zonVersion[1] + ")");
      }
    }

    // The defect list's own tally has to match its own marks. It claims
    // "33 条缺陷已修 31 条" in the header and then marks each entry ✅ or
    // strikes it through, which is two statements of the same fact written in
    // two places — exactly the shape that goes stale (缺陷 12 was a number
    // retyped in three files). Counted rather than trusted.
    {
      const dc = fs.readFileSync(path.join(root, "docs/design-constraints.md"), "utf8");
      const fixed = (dc.match(/^\d+\. ✅ /gm) || []).length;
      const kept = (dc.match(/^\d+\. ~~/gm) || []).length;
      const said = /下面 (\d+) 条缺陷已修 (\d+) 条/.exec(dc);
      assert(!!said, "design-constraints.md states its own tally");
      if (said) {
        assert(Number(said[2]) === fixed,
          "…and the ✅ marks match it (" + fixed + " marked vs " + said[2] + " claimed)");
        assert(Number(said[1]) === fixed + kept,
          "…and every defect is either marked fixed or struck through (" +
          (fixed + kept) + " accounted for, " + said[1] + " claimed)");
      }
    }

    // …and no comment may cite a version the app has not reached. Writing
    // "until 1.19 this did X" beside the code that changed is the most useful
    // habit in this repo, and it is also the easiest way to describe a release
    // that was never cut: during the P-1→P6 work seven files came to say
    // "until 1.26" while app.zon sat at 1.25.0, and the release then went out
    // as 2.0 — so 1.26 named nothing, twice over. Same failure as the heading
    // above, one level down, and the reason a version bump now has to drag
    // every claim about it along.
    //
    // Only the phrasings the repo actually uses for a version claim are
    // matched — a bare "1.5" is a line width, not a release.
    {
      const cur = zonVersion[1].split(".").slice(0, 2).map(Number);
      const newer = (v) => {
        const [maj, min] = v.split(".").map(Number);
        return maj > cur[0] || (maj === cur[0] && min > cur[1]);
      };
      const files = [
        ...fs.readdirSync(path.join(root, "src/web/js"))
          .filter((n) => n.endsWith(".js") && !["bundle.js", "pieces.js", "chess.js"].includes(n))
          .map((n) => "src/web/js/" + n),
        ...fs.readdirSync(path.join(root, "scripts")).filter((n) => n.endsWith(".mjs")).map((n) => "scripts/" + n),
        "README.md", "docs/design-constraints.md", "docs/refactor-plan.md",
      ];
      // The version may be written 1.19 or 1.19.1, and the boundary has to
      // exclude a preceding digit or dot or "1.19.1 起" matches as "19.1".
      const CLAIM = /(?:\b(?:[Uu]ntil|[Ss]ince|[Ii]n)\s+(?<![\d.])(\d+\.\d+(?:\.\d+)?)\b)|(?:(?<![\d.])(\d+\.\d+(?:\.\d+)?)\s*(?:之前|起|开始|把|改|加))/g;
      const ahead = [];
      for (const rel of files) {
        const src = fs.readFileSync(path.join(root, rel), "utf8");
        for (const m of src.matchAll(CLAIM)) {
          const v = m[1] || m[2];
          if (v && newer(v)) ahead.push(rel + " → " + v);
        }
      }
      assert(ahead.length === 0,
        "no comment claims a version newer than app.zon " + zonVersion[1] +
        " (" + [...new Set(ahead)].slice(0, 5).join(", ") + ")");
    }
  }
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
