/**
 * Node tests for the vendored rules engine (chess.js) — the app's single
 * source of truth for legality. Run: node scripts/test-chess.mjs
 */
import crypto from "crypto";
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";
import { compileModuleSync, CHUNKS, build, BUNDLE_BUDGET } from "./bundle.mjs";
import { measureMarks, markChroma, markLook, boardDistinct, LAST_CHROMA_CEILING, CHROMA_CEILING, SEP_FLOOR_BOARD as SEP_FLOOR_BY_BOARD, BOARDS as MARK_BOARDS, MARKS,
  LOOK_MARKS, LOOK_CHROMA_CEILING, LOOK_DE_CEILING, BOARD_DISTINCT_FLOOR } from "./lib/mark-colour.mjs";

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
  // v8-0-plan F5: the en/ja dictionaries and content are chunks the page puts
  // on the window before the bundle runs; the suite does the same, so every
  // check below still sees all three languages in ChessI18n.DICT.
  if (path.basename(abs) === "i18n.js") {
    for (const f of ["lang-en.js", "lang-ja.js"]) {
      vm.runInContext(compileModuleSync(path.join(root, "src/web/js", f)), context, { filename: f });
    }
  }
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

// --- v8-0-plan F4: a source check names a symbol, not a file ---------------
//
// About 150 checks in this file read app.js's source as text (111 of them are
// in the register at the end), and up to 7.9 each did so by its file name. F4 splits that file into modules, and
// every function it moves would have turned the checks that mention it red
// with nothing actually wrong. So they read `allAppSource` instead: every
// hand-written module in src/web/js, app.js first, the generated ones (the
// bundle, its chunks, the engine source) left out. `srcOf(name)` returns one
// declaration's text from whichever module holds it. A check that really is
// about one file — the markup, the stylesheet, a workflow, a module's own
// exported contract — still reads that file by name.
const WEB_JS = path.join(root, "src/web/js");
const GENERATED_JS = /^(?:bundle|engine-src|chunk-.+)\.js$/;
/**
 * Every .js under `dir`, as paths relative to it ("app.js", "review/panel.js").
 * F4 moves app.js's regions into folders (review/, trainer/), and a scan that
 * read only the top level would stop seeing the code it was written for.
 * lichess/ is left out: the import script writes it (v8-0-plan B1).
 */
const webJsFiles = (dir) => fs.readdirSync(dir, { recursive: true })
  .map((f) => String(f).split(path.sep).join("/"))
  .filter((f) => f.endsWith(".js") && !f.startsWith("lichess/"));
/** file name → source for every hand-written module in `dir`, app.js first */
function readWebModules(dir) {
  const names = webJsFiles(dir).filter((f) => !GENERATED_JS.test(f)).sort();
  names.sort((a, b) => (b === "app.js") - (a === "app.js"));
  return new Map(names.map((f) => [f, fs.readFileSync(path.join(dir, f), "utf8")]));
}
const joinModules = (mods) => [...mods.values()].join("\n");
/**
 * The text of `function name(…) {…}` or `const|let|var name = …;` in `text`,
 * or "" if it is not declared there. Brackets are matched with strings and
 * comments skipped, so a "}" inside a message does not end the body early.
 */
function declarationIn(text, name) {
  const id = name.replace(/[$]/g, "\\$");
  const m = new RegExp("(?:^|[^\\w$.])((?:async\\s+)?function\\*?\\s+" + id + "\\s*\\(|(?:const|let|var)\\s+" + id + "\\s*=)").exec(text);
  if (!m) return "";
  const start = m.index + m[0].length - m[1].length;
  const isFn = /function/.test(m[1]);
  let depth = 0, seenBody = false;
  for (let k = start + m[1].length - (isFn ? 1 : 0); k < text.length; k++) {
    const c = text[k];
    if (c === '"' || c === "'" || c === "`") {
      for (k++; k < text.length && text[k] !== c; k++) if (text[k] === "\\") k++;
      continue;
    }
    if (c === "/" && text[k + 1] === "/") { k = text.indexOf("\n", k); if (k < 0) break; continue; }
    if (c === "/" && text[k + 1] === "*") { k = text.indexOf("*/", k) + 1; if (k <= 0) break; continue; }
    if (c === "/" && /[(,=:[!&|?{};]\s*$|\breturn\s*$/.test(text.slice(Math.max(0, k - 12), k))) {
      // a regex literal: `/"/` or `/\}/` must not open a string or close a block
      k++;
      for (let cls = false; k < text.length && text[k] !== "\n"; k++) {
        if (text[k] === "\\") k++;
        else if (text[k] === "[") cls = true;
        else if (text[k] === "]") cls = false;
        else if (text[k] === "/" && !cls) break;
      }
      continue;
    }
    if (c === "(" || c === "[" || c === "{") { depth++; if (c === "{") seenBody = true; }
    else if (c === ")" || c === "]" || c === "}") {
      depth--;
      // a function ends with the brace that closes its body, a binding with
      // the `;` at its own depth (the house style never leans on ASI)
      if (isFn && depth === 0 && c === "}" && seenBody) return text.slice(start, k + 1);
    } else if (!isFn && depth === 0 && c === ";") {
      return text.slice(start, k + 1);
    }
  }
  return "";
}
/** { file, text } of the module that declares `name`, or null */
function findSymbol(mods, name) {
  for (const [file, text] of mods) {
    const hit = declarationIn(text, name);
    if (hit) return { file, text: hit };
  }
  return null;
}
const WEB_MODULES = readWebModules(WEB_JS);
const allAppSource = joinModules(WEB_MODULES);
const srcOf = (name) => (findSymbol(WEB_MODULES, name) || { text: "" }).text;
// A negative check — "app.js never spells X, module Y owns it" — becomes "no
// module but Y spells X": the owner is left out and everything else is read,
// so the rule still holds wherever app.js's code goes next.
const allSourceExcept = (...owners) =>
  joinModules(new Map([...WEB_MODULES].filter(([f]) => !owners.includes(f))));
// The per-line house rules (no module-level `let`, no Chinese literal reaching
// the DOM) were written for app.js, and the data modules — lessons, puzzles,
// the dictionaries — are Chinese by design. A module carved out of app.js
// joins this list in the same PR, so the rules follow the code they were
// written for.
const APP_MODULES = ["app.js", "appearance-ui.js", "settings-ui.js", "shell.js", "prefs-ui.js", "review-pass.js", "review/eval-graph.js", "review/retry.js", "review/panel.js", "review/lines.js", "review/analysis.js", "review/board-marks.js",
  "trainer/content.js", "trainer/lessons.js", "trainer/puzzles.js", "trainer/today.js", "trainer/puzzle-modes.js",
  "trainer/puzzle-book.js", "trainer/puzzle-rating.js", "trainer/puzzle-openings.js", "trainer/puzzle-mine.js", "trainer/guess.js",
  "me-page.js", "game-end.js", "review/moments.js", "opponents-ui.js", "io.js", "game-controller.js"];
const appModuleEntries = () => APP_MODULES.map((f) => [f, WEB_MODULES.get(f) || ""]);

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

// --- 6.0: perft — the rules engine is vendored, so its move generator is
// trusted; this is the one gate that would catch a bad vendor bump. Node
// counts are the published ones (chessprogramming.org/Perft_Results).
{
  function perft(g, d) {
    if (d === 0) return 1;
    let n = 0;
    for (const m of g.moves({ verbose: true })) { g.move(m); n += perft(g, d - 1); g.undo(); }
    return n;
  }
  const CASES = [
    ["start", "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", 3, 8902],
    ["kiwipete", "r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1", 2, 2039],
    ["position 3", "8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1", 3, 2812],
    ["position 4", "r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1", 2, 264],
    ["position 5", "rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8", 2, 1486],
  ];
  for (const [name, fen, depth, want] of CASES) {
    const got = perft(new Chess(fen), depth);
    assert(got === want, `perft ${name} depth ${depth} = ${want} (got ${got})`);
  }
}

// --- 6.0: rule edges the app's own tests never covered
{
  // a pinned pawn may not capture en passant when that exposes its king
  const g = new Chess("8/8/8/2k5/3Pp3/8/8/4K2R b K d3 0 1");
  // …but here the pin is along the e-file: black king e8? use a diagonal pin
  const pinned = new Chess("4k3/8/8/8/1b1Pp3/8/8/3K4 b - d3 0 1");
  assert(pinned.moves().some((m) => m === "exd3"), "e.p. is legal when nothing is pinned through it");
  const pinnedRank = new Chess("8/8/8/8/k2Pp2R/8/8/4K3 b - d3 0 1");
  assert(!pinnedRank.moves().some((m) => m === "exd3"),
    "e.p. is illegal when both pawns leave a rank pin on the king (the classic horizontal case)");
  assert(g.moves().some((m) => m === "exd3"), "e.p. with a rook on the other file is fine");
  // castling through check is illegal; castling out of check is illegal
  const through = new Chess("4k3/8/8/8/8/8/5r2/4K2R w K - 0 1");
  assert(!through.moves().includes("O-O"), "cannot castle through an attacked square (f1)");
  const outOf = new Chess("4k3/8/8/8/8/8/4r3/4K2R w K - 0 1");
  assert(!outOf.moves().includes("O-O"), "cannot castle out of check");
  // a promotion that captures the rook takes the castling right with it
  const cap = new Chess("r3k3/1P6/8/8/8/8/8/4K3 w q - 0 1");
  cap.move({ from: "b7", to: "a8", promotion: "q" });
  assert(cap.fen().split(" ")[2] === "-", "capturing the a8 rook by promotion clears black's queenside right");
  // insufficient material: same-coloured bishops draw, opposite-coloured do not
  // c8 and f1 are both light squares; c8 and c1 are not
  assert(new Chess("2b1k3/8/8/8/8/8/8/4KB2 w - - 0 1").insufficient_material(),
    "KB vs KB on the same colour is insufficient");
  assert(!new Chess("2b1k3/8/8/8/8/8/8/2B1K3 w - - 0 1").insufficient_material(),
    "KB vs KB on opposite colours is not (a mate exists)");
  assert(!new Chess("4k3/8/8/8/8/8/8/1NN1K3 w - - 0 1").insufficient_material(),
    "KNN vs K is not insufficient by chess.js (FIDE 5.2.2: a helpmate exists)");
}

// --- 6.0: the exporter owns the result token (v6-plan D1)
{
  const { ChessPgn } = await import("../src/web/js/pgn.js");
  assert(ChessPgn.stripResult("1. e4 e5 2. Nf3 1-0") === "1. e4 e5 2. Nf3", "a trailing 1-0 is stripped");
  assert(ChessPgn.stripResult("1. e4 e5 *") === "1. e4 e5", "a trailing * is stripped");
  assert(ChessPgn.stripResult("1. e4 e5 1/2-1/2\n") === "1. e4 e5", "a trailing draw token is stripped");
  assert(ChessPgn.stripResult("1. e4 e5") === "1. e4 e5", "nothing to strip leaves the text alone");
  const g = new Chess();
  g.load_pgn('[Event "x"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0', { sloppy: true });
  const body = ChessPgn.stripResult(g.pgn().split("\n\n").pop());
  assert(!/1-0/.test(body), "chess.js's own trailing result is gone from the movetext");
  assert(/ChessPgn\.stripResult\(game\.pgn\(\)/.test(srcOf("pgnForExport")),
    "…and the exporter strips it before appending its own");
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
  const src = allAppSource;
  assert(/isOpeningCat\(p\.cat\)[\s\S]{0,400}?plies <= 8 \? "easy" : plies <= 16 \? "mid" : "hard"/.test(src),
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
  // 9.0 V1 (设计语言 v2): the 8pt rhythm — 4 · 8 · 12 in a group · 16 in a
  // card · 24 between blocks · 32 · 40 · 48, and 2 for a hairline's
  // neighbour. 6 and 20 left the scale (they were 8.x's in-betweens); the
  // page margins (32 / 40) joined it.
  const SPACE = new Set(["0px", "2px", "4px", "8px", "12px", "16px", "24px", "32px", "40px", "48px"]);
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

    // 7.7 §9: a press and a keyboard focus look the same on every button. Both
    // are declared once for all of them rather than per family — per-family is
    // how the tabs, the move list and the toast's own buttons went without a
    // pressed state while the action grid had one.
    assert(/:where\(button\):active\s*\{[^}]*transform/.test(stripped),
      "every button has a pressed state (:where(button):active)");
    assert(/(^|\})\s*:focus-visible\s*\{[^}]*outline:\s*2px solid/.test(stripped),
      "…and every focusable thing the one focus ring");
    const ringOff = [...stripped.matchAll(/([^{}]*button[^{}]*:focus[^{}]*)\{([^{}]*)\}/g)]
      .filter((m) => /outline\s*:\s*(none|0)\b/.test(m[2])).map((m) => m[1].trim());
    assert(ringOff.length === 0,
      "no button rule takes the ring away" + (ringOff.length ? " — " + ringOff.join(" ;; ") : ""));

    // …and nothing waits for a transition the stylesheet does not declare.
    // app.js carried a transitionend handler for #board-wrap's width/height
    // for several versions, with a comment explaining that the panel toggle
    // animates them over 280ms. The stylesheet says the opposite, in its own
    // comment, and has since 1.13: the board snaps to its new size on purpose
    // (+84% at 1000x1000 — watching that grow is worse than finding it grown).
    // So the branch never ran. The comment was simply older than the CSS, and
    // this repo's comments are the most valuable thing in it precisely because
    // they record measurements — which makes a stale one expensive. Defect 11.
    const appSrcT = allAppSource;
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
    // 9.0 S5: a settings category is a button too — its height is the
    // buttons' token in the narrow row (the two-heights guard below)
    const catH = /\.set-cat \{[^}]*height: 36px/.test(stripped) || /\.set-cat\s*\{[^}]*min-height:\s*var\(--ctl-h\)/.test(stripped);
    assert(catH, "the narrow settings row's categories are a control's height");
  }

  // The chrome is one strip, so everything standing in it is one height and one
  // baseline. It used to run three (36 / 32 / 27.4) and two baselines, because
  // the mode row sized itself from --row-h, the buttons were a literal 32, and
  // the status pill had no height at all — it was 4px of padding around
  // whatever the text measured. Nothing in the bar shared a unit, which is why
  // it could not be aligned, only nudged.
  {
    // 7.7 (v7-7-plan §2): the status pill left the bar — whose move it is is
    // the lit player strip now, and the sentence is .sr-only. 7.9 §1a: 悔棋
    // and 提示 left it too, for the opponent's strip, so the bar holds ☰
    // alone, at the small control height. 9.0 V3: ☰ is the strip's last
    // control now, and the icon button is the small control height wherever
    // it stands.
    assert(/\n    \.icon-btn \{[^}]*height:\s*var\(--ctl-h-sm\)/.test(stripped),
      "the icon button (☰ among them) is the small control height");
    assert(/\.ps-tools \.tool-btn \{[^}]*height:\s*var\(--ctl-h-sm\)/.test(stripped),
      "…and so are the two tools on the opponent's strip (7.9 §1a)");
    const chrome = /\n    \.chrome \{([\s\S]*?)\n    \}/.exec(stripped);
    assert(chrome, ".chrome is styled");
    const pad = /padding:\s*([^;]+);/.exec(chrome[1]);
    assert(pad && pad[1].trim().split(/\s+/).length === 2,
      "the bar's left and right insets are the same (" + (pad ? pad[1].trim() : "?") + ")");
  }

  // the replay bar was the heaviest object in a panel of text links: a filled,
  // bordered slab of 10800px², nine times the area of anything else in it.
  // 7.7 took it down to a hairline and four bare glyphs; 7.9 §1c gave it back
  // an edge — one outlined bar in four cells, Lichess's shape — but still no
  // fill: the weight is the outline, not a slab.
  {
    const bar = /\.replay-bar\s*\{([^}]*)\}/.exec(stripped);
    assert(!!bar, ".replay-bar is styled");
    assert(/background:\s*transparent/.test(bar[1]), "the replay bar carries no fill");
    assert(/\bborder:\s*1px/.test(bar[1]) && /border-radius:\s*var\(--radius-/.test(bar[1]),
      "…and is one rounded container (7.9 §1c)");
    assert(/repeat\(4,\s*minmax\(0,\s*1fr\)\)/.test(bar[1]), "…of four equal cells");
    const cell = /\.replay-bar button\s*\{([^}]*)\}/.exec(stripped);
    assert(cell && /transition:[^;]*var\(--dur-quick\) var\(--ease\)/.test(cell[1]),
      "…whose hover and press use --dur-quick and the one curve");
    assert(/\.replay-bar button:hover:not\(:disabled\)/.test(stripped),
      "…and a disabled cell answers no hover");
  }

  // 7.9 §1e: two control heights, and no third — the same kind of guard as
  // the type scale and the one easing curve. 7.8.0 measured 36px buttons (18
  // of them) beside 28px ones (悔棋/提示 over the board, 重来/下一课, 重做/
  // 下一题), and on the puzzle page the two sat one under the other. Every
  // rule that sizes a button takes its height from --ctl-h or --ctl-h-sm.
  // What counts as a button is the selector's last compound: `button`, a
  // `*-btn` class, or one of the button classes that do not say so in their
  // name. A pseudo-element is not the button (#theme-seg's swatch), and the
  // promotion picker is squares of the board, sized as 12.5% of it.
  {
    const tok = (n) => new RegExp(n + ":\\s*(\\d+)px").exec(stripped);
    const big = tok("--ctl-h"), small = tok("--ctl-h-sm");
    assert(big && big[1] === "36" && small && small[1] === "32",
      "two control-height tokens: --ctl-h 36px and --ctl-h-sm 32px (" +
      (big ? big[1] : "?") + " / " + (small ? small[1] : "?") + ")");
    assert(!/--chrome-ctl-h/.test(stripped), "…and the chrome's 28px token is gone");
    const BUTTON = /(^|[\s>+~(,])(button|\.[\w-]+-btn|\.tool-ic|\.tool-txt|\.go-close|\.daily-head)(?![\w-])/;
    const EXEMPT = /\.promo-row|::/;
    const off = [];
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const sels = m[1].split(",").map((x) => x.trim()).filter(Boolean);
      const last = (sel) => sel.split(/\s*[\s>+~]\s*(?![^(]*\))/).pop();
      if (!sels.some((sel) => !EXEMPT.test(sel) && BUTTON.test(" " + last(sel)))) continue;
      for (const d of m[2].matchAll(/(?<![\w-])(height|min-height)\s*:\s*([^;]+);/g)) {
        const v = d[2].trim();
        if (!/^(var\(--ctl-h(-sm)?\)|auto)$/.test(v)) off.push(m[1].trim().replace(/\s+/g, " ") + " { " + d[1] + ": " + v + " }");
      }
    }
    assert(off.length === 0,
      "every button height comes from --ctl-h or --ctl-h-sm" + (off.length ? " — off it: " + off.join(" ;; ") : ""));
  }

  // type: six steps, and no half pixels
  // 6.0: the same seven steps, in rem (16px root) so the text-size setting
  // scales the whole sheet together (v6-plan Q3.6)
  // 7.9 §2a: the panel moved up a step — 12px (0.75rem) left the scale and
  // 14px (0.875rem) took its place. Still seven.
  // 9.0 V1 (设计语言 v2): four roles, not seven sizes — 30 a result figure
  // (and a page's title) · 16 a card's or a block's title · 14 the body and
  // every button · 12 what is said beside it — plus 13 for the two heading
  // levels (section 600, field label 400) and 11 for coordinates and badges
  // only. 15 and 19 had no role and left; 12 came back as the aside.
  const TYPE = new Set(["0.6875rem", "0.75rem", "0.8125rem", "0.875rem", "1rem", "1.875rem"]);
  const badType = [...stripped.matchAll(/font-size:\s*([^;{}]+);/g)]
    .map((m) => m[1].trim())
    .filter((v) => /^\d/.test(v) && !TYPE.has(v));
  assert(badType.length === 0,
    "type stays on the scale" + (badType.length ? " — off it: " + [...new Set(badType)].join(", ") : ""));
  // design-constraints.md: 字号 7 档、行高 3 档、时长 3 档 —— 不要新增档位.
  // The membership sets above are the scale, so widening one is how a step
  // gets added: this makes that edit fail here rather than pass quietly.
  assert(TYPE.size === 6, "the type scale still has six steps (" + TYPE.size + ")");

  // The bundle targets Safari 15 (scripts/bundle.mjs), and container queries
  // arrived in Safari 16: a rule inside @container is simply not there on
  // 15, so 7.9 §1d's tool labels never showed (Codex, #84). Width-dependent
  // rules key on a class the page sets instead.
  assert(!/@container\b|\bcontainer(?:-type|-name)?\s*:/.test(stripped),
    "styles.css uses no container queries — the bundle targets Safari 15");

  // 9.0 V1 — 设计语言 v2 (docs/design-constraints.md §0, design/v9-m0/v9.css).
  // Measured on 8.4.0: nine button looks, six card looks, five heading
  // styles, four segment implementations, dashed boxes inside solid cards.
  {
    // no dashed frame: a dashed box reads as a placeholder waiting for
    // content, and every one of them was an empty state or a box in a box
    assert(!/\bdashed\b/.test(stripped), "no dashed border or rule anywhere (9.0 V1)");
    // one heading voice in every language: 13/600 muted, never in capitals
    // with tracking — 「STATS」 beside 「统计」 was two systems for one level
    assert(!/text-transform:\s*uppercase/.test(stripped), "no heading is set in capitals (9.0 V1)");
    const tracked = [...stripped.matchAll(/letter-spacing:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/^0(px)?$/.test(v));
    assert(tracked.length <= 1,
      "no tracking but the frame's coordinates (" + tracked.join(", ") + ")");
    for (const sel of [".side-h", ".act-k"]) {
      const r = new RegExp("\\n\\s*" + sel.replace(/[.]/g, "\\.") + " \\{([\\s\\S]*?)\\}").exec(stripped);
      assert(r && /font-size:\s*0\.8125rem/.test(r[1]) && /font-weight:\s*600/.test(r[1]) && /color:\s*var\(--muted\)/.test(r[1]),
        sel + " is the section heading: 13/600 in the muted ink");
    }
    // one accent, three uses: the primary button, the current move, the
    // selected state (and the focus ring, which is the selected state of the
    // keyboard). Every rule that paints with it says which in its selector;
    // the register is the four that do not, and it only shrinks.
    const ACCENT_OK = /primary|current|\.active|selected|pressed|expanded|focus|is-active|:hover|aria-current/;
    const ACCENT_KNOWN = new Map([
      [":root", "declares --accent-soft and --accent-line"],
      [".think-dot", "the engine is thinking: the board's one live dot"],
      [".range", "the volume slider's thumb (accent-color)"],
      [".xp-mine", "「我的」 — your own book's move, the selected tint"],
    ]);
    const stray = [];
    for (const m of stripped.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      if (!/var\(--accent(-soft|-line)?\)/.test(m[2])) continue;
      const sel = m[1].trim().replace(/\s+/g, " ");
      if (sel.startsWith("@") || ACCENT_OK.test(sel) || ACCENT_KNOWN.has(sel)) continue;
      stray.push(sel);
    }
    assert(stray.length === 0,
      "the accent paints only a primary button, the current move or a selected state" + (stray.length ? " — also: " + stray.join(" ;; ") : ""));
    // four button kinds, each spelt once per family
    for (const k of [".act-btn.primary {", ".tool-btn.primary {", ".act-btn.danger {", ".tool-btn.danger {"])
      assert(stripped.split(k).length === 2, "one declaration of " + k.slice(0, -2));
    // two surfaces: a card is opaque — no film of white over another card
    for (const theme of ["wood", "night", "day", "notebook"]) {
      const v = new RegExp("--" + theme + "-card:\\s*([^;]+);").exec(stripped);
      assert(v && /^#[0-9a-f]{6}$/i.test(v[1].trim()), theme + ": a card is the raised surface, opaque (" + (v && v[1]) + ")");
      const p = new RegExp("--" + theme + "-panel:\\s*([^;]+);").exec(stripped);
      assert(p && p[1].trim() === v[1].trim(), theme + ": …the same raised surface a dialog is");
      const a = new RegExp("--" + theme + "-accent:\\s*([^;]+);").exec(stripped);
      // 10.0 M0: one accent, and no second name for it — --primary-from/-to
      // and --on-primary were declared in all four themes and read by nothing
      assert(a && !new RegExp("--" + theme + "-(primary-from|primary-to|on-primary):").test(stripped),
        theme + ": one accent, with no second set of names for it (" + (a && a[1]) + ")");
    }
  }

  // 9.0 V2: the bundled face — Inter (OFL), the Latin variable subset, first
  // in the stack and ahead of the CJK faces, and shipped with its licence.
  {
    const face = /@font-face\s*\{([^}]*)\}/.exec(stripped);
    assert(face && /font-family:\s*"Inter Var"/.test(face[1]) && /url\("fonts\/inter-latin-wght-normal\.woff2"\)/.test(face[1]) &&
      /font-display:\s*swap/.test(face[1]) && /unicode-range:/.test(face[1]),
      "Inter is declared once, from fonts/, swap, Latin only");
    const woff = path.join(root, "src/web/fonts/inter-latin-wght-normal.woff2");
    assert(fs.existsSync(woff) && fs.statSync(woff).size <= 60 * 1024,
      "…the file is there and small (" + (fs.existsSync(woff) ? fs.statSync(woff).size : 0) + " bytes ≤ 60 KB)");
    assert(fs.existsSync(path.join(root, "src/web/fonts/Inter-OFL.txt")) &&
      /SIL Open Font License/.test(fs.readFileSync(path.join(root, "src/web/fonts/Inter-OFL.txt"), "utf8")),
      "…with its SIL OFL beside it");
    const ui = /--font-ui:\s*([^;]+);/.exec(stripped);
    assert(ui && /^"Inter Var",\s*"PingFang SC"/.test(ui[1].trim()), "the interface stack opens Inter → PingFang SC (" + (ui && ui[1].slice(0, 40)) + ")");
    const ja = /html:lang\(ja\)\s*\{\s*--font-ui:\s*([^;]+);/.exec(stripped);
    assert(ja && /^"Inter Var",\s*"Hiragino Kaku Gothic ProN"/.test(ja[1].trim()), "…and the Japanese one Inter → the Japanese faces");
    assert(/text-autospace:\s*ideograph-alpha/.test(stripped), "text-autospace is on where it is supported");
    const sync = fs.readFileSync(path.join(root, "scripts/sync-dist.mjs"), "utf8");
    assert(/"src\/web\/fonts\/inter-latin-wght-normal\.woff2", "fonts\/inter-latin-wght-normal\.woff2"/.test(sync) &&
      /"src\/web\/fonts\/Inter-OFL\.txt", "licenses\/Inter-OFL\.txt"/.test(sync),
      "sync-dist.mjs packages the font and its licence (macOS and Windows both build frontend/dist with it)");
  }

  // 7.9 §2b: numbers are the interface face with tabular figures. The mono
  // stack made every counter, the accuracy figure and the clock look like
  // terminal output beside the prose; this keeps it from coming back through
  // the token, and keeps every user of the token tabular.
  {
    const fn = /--font-num:\s*([^;]+);/.exec(stripped);
    assert(!!fn, "--font-num is declared");
    const monoNames = /SF Mono|Menlo|Consolas|ui-monospace|monospace/i;
    const stackOf = (v) => v.replace(/var\(--font-ui\)/, ((/--font-ui:\s*([^;]+);/.exec(stripped)) || [, ""])[1]);
    assert(fn && !monoNames.test(stackOf(fn[1])),
      "--font-num names no monospace family (" + (fn ? fn[1].trim() : "") + ")");
    const users = [...stripped.matchAll(/\{([^{}]*font-family: var\(--font-num\)[^{}]*)\}/g)].map((m) => m[1]);
    assert(users.length > 0 && users.every((b) => /font-variant-numeric: tabular-nums/.test(b)),
      "…and every rule that sets it asks for tabular figures (" + users.length + " rules)");
  }
  assert(SPACE.size === 10, "the spacing scale still has ten steps (" + SPACE.size + ")");

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
  // 9.0 V1: two — 400 and 600. 500 was a third emphasis between them (a
  // button's label, a setting's name, a toast) and the CJK faces have no
  // honest 500 on Windows. The bundled face's @font-face declares the
  // range it carries (100 900), which is not a weight anything is set in.
  {
    const ws = [...stripped.replace(/@font-face\s*\{[^}]*\}/g, "").matchAll(/font-weight:\s*(\d+)/g)].map((m) => m[1]);
    const bad = ws.filter((w) => !["400", "600"].includes(w));
    assert(bad.length === 0,
      "two weights only" + (bad.length ? " — also found: " + [...new Set(bad)].join(", ") : ""));
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
    // 2.2 turned this row into the same count-decided grid the segment rows
    // use. The rule it replaced said "wrap, never fix a column count", and
    // that was right for a row of text links of different widths — it is the
    // wrong rule for a row of boxes, where a wrapping flex line lets whatever
    // landed on the last line share it and come out double width. A box twice
    // its neighbours' width is this UI's word for "the primary action", and
    // that word now belongs to .primary alone.
    assert(/display:\s*grid/.test(row[1]), "action rows are a grid, so every action is the same width");
    assert(/auto-fill/.test(row[1]),
      "…laid out by the actions that are actually there, not by counting children " +
      "(判和/重下 come and go, and a display:none child still counts in :has(:nth-child))");
    assert(!/auto-fit/.test(row[1]),
      "…and auto-FILL, so the last action left in a row keeps one action's width " +
      "instead of stretching across the panel and competing with the filled one");
    assert(/grid-auto-rows:\s*1fr/.test(row[1]), "…and every row of it is the same height");
    assert(!/space-between/.test(row[1]), "no space-between — that is what made every row different");

    // ONE control family. The segment buttons and the action buttons share a
    // single declaration block; if someone splits them again, this fails.
    // 9.0 V1: what they share — type, one line, the press — is still that
    // one block; the box is no longer shared: a segment is a place in a
    // tray (.theme-row is the box), an action is a secondary button.
    assert(/\.theme-row button,\s*\.act-btn \{/.test(stripped),
      "the segment control and the action button are declared together, not twice");
    const box = /\.theme-row button,\s*\.act-btn \{([\s\S]*?)\}/.exec(stripped);
    assert(box && /white-space:\s*nowrap/.test(box[1]) && /font-size:\s*0\.875rem/.test(box[1]) && /font-weight:\s*600/.test(box[1]),
      "…one line, 14/600, for both (9.0 V1: a label never wraps — a row that cannot hold it steps its columns down)");
    assert(!/overflow-wrap:\s*break-word|hyphens:\s*auto/.test((/\.theme-row button,\s*\.act-btn \{[^}]*\}\s*(\.theme-row button,\s*\.act-btn \{[^}]*\})?/.exec(stripped) || [""])[0]),
      "…and no rule left that breaks a label over two lines");
    const tray = /\n    \.theme-row \{([^}]*)\}/.exec(stripped);
    assert(tray && /box-shadow:\s*inset 0 0 0 1px/.test(tray[1]) && /background:\s*var\(--card\)/.test(tray[1]),
      "the segment's tray is the box: the raised surface and one hairline (9.0 V1)");
    const act = /\n    \.act-btn \{([^}]*)\}/.exec(stripped);
    assert(act && /border:\s*1px solid var\(--line-strong\)/.test(act[1]),
      "…and an action is the secondary button — the strong hairline on the raised surface");

    // P3's acceptance criterion, at the level of the rule rather than the
    // screen: dimming a control that cannot be used is not a milder way of
    // obeying "no visible disabled controls", it is the thing being rejected
    const off = /\.act-btn:disabled \{([^}]*)\}/.exec(stripped);
    assert(off && /display:\s*none/.test(off[1]),
      "a disabled action is not rendered at all");
    assert(off && !/opacity/.test(off[1]), "…not dimmed into a hole in the row");

    // one row, one shape: danger is a colour, not a different control. Now
    // that every neighbour is a box too, the box is no longer what marks it.
    const dRule = /\.act-btn\.danger \{([^}]*)\}/.exec(stripped);
    assert(dRule, "found the danger rule");
    assert(/color:\s*var\(--danger\)/.test(dRule[1]), "danger says it in colour");

    // At most one filled action exists as a rule at all — the count is a
    // runtime property (see test-layout-e2e), but the weight must be declared
    // exactly once so there is only one way to spell "the thing to press".
    assert((stripped.match(/\.act-btn\.primary \{/g) || []).length === 1,
      "there is exactly one declaration of the primary weight");

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
  // Mode is a plain `.theme-row.wrap` segment — on the settings page until
  // v8-0-plan A1, in the new-game dialog since (人机 / 双人; the rail has
  // 谜题 and 学习).
  {
    const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    assert(!/mode-nav/.test(stripped), "no `.mode-nav` idiom is left in the stylesheet");
    assert(!/class="[^"]*mode-nav/.test(markup), "…and nothing in the markup asks for one");
    const seg = /<div class="([^"]*)" id="mode-seg"/.exec(markup);
    assert(seg && /\btheme-row\b/.test(seg[1]) && /\bwrap\b/.test(seg[1]),
      "the mode segment is styled by the same rule as every other segment (" + (seg ? seg[1] : "missing") + ")");
  }

  // The settings page, read in order. Claims about the order and the
  // naming rather than about any one control, so they are cheapest to make
  // against the markup.
  {
    const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    // the three dictionaries, wherever they live (v8-0-plan F5 split them)
    const i18nSrc = ["i18n.js", "i18n-en.js", "i18n-ja.js"]
      .map((f) => fs.readFileSync(path.join(root, "src/web/js", f), "utf8")).join("\n");
    // 9.0 S5: one place — six categories, in the list's order, each naming a
    // pane that exists; no second settings surface in the panel or a window
    const cats = [...markup.matchAll(/role="tab" class="set-cat" id="cat-([a-z]+)" data-cat="\1"[^>]*aria-controls="set-\1"/g)].map((m) => m[1]);
    assert(cats.join() === "general,board,sound,game,data,advanced",
      "S5: the settings page runs 通用 → 棋盘 → 声音 → 对局 → 数据 → 高级 (" + cats.join(" → ") + ")");
    assert(cats.every((c) => markup.includes('<div class="set-pane" id="set-' + c + '"')),
      "S5: every category points at a pane that exists");
    assert(!/id="pane-setup"|id="prefs-modal"|id="tab-setup"/.test(markup),
      "S5: no 设置 tab in the panel and no preferences window — the page is the one place");
    // the language is the first thing on the first category (task i)
    const general = markup.slice(markup.indexOf('id="set-general"'), markup.indexOf('id="set-board"'));
    assert(general.indexOf('id="lang-seg"') > 0 && general.indexOf('id="lang-seg"') < general.indexOf('id="text-seg"'),
      "S5: the language is the first row of 通用");
    // the deletions are the last group of 数据: 2.1 had them in the middle
    // of a page, the only red on it
    const data = markup.slice(markup.indexOf('id="set-data"'), markup.indexOf('id="set-advanced"'));
    const dHeads = [...data.matchAll(/data-i18n="((?:side|lib)\.[a-zA-Z]+)"[^>]*>/g)].map((m) => m[1])
      .filter((k) => ["lib.sync", "side.learning", "side.allData", "side.danger"].includes(k));
    assert(dHeads[dHeads.length - 1] === "side.danger",
      "S5: 数据 ends on 清除数据 (" + dHeads.join(" → ") + ")");
    // the next game's choices are the new-game dialog's, and only there
    const ng = markup.slice(markup.indexOf('id="newgame-modal"'), markup.indexOf('id="confirm-modal"'));
    // 10.0 M0: the rung is the opponent card (row-opponent); the two rows of
    // rung names that repeated the cards are gone
    assert(["row-opponent", "row-persona", "row-color", "row-clock"].every((id) => ng.includes('id="' + id + '"')) &&
      !ng.includes('data-diff="'),
      "S5: opponent, style, side and clock live in the new-game dialog — the rung is chosen on the cards only");

    // The heading is a promise about what is inside. 「外观」 once held the
    // language and the sound; since A1 each has its own group, and the rows
    // left on the settings page are about the board in front of you.
    for (const [lang, look, disp] of [["zh-CN", "外观", "显示"], ["en", "Appearance", "Display"], ["ja", "外観", "表示"]])
      assert(new RegExp('"prefs\\.look":\\s*"' + look + '"').test(i18nSrc) && new RegExp('"side\\.display":\\s*"' + disp + '"').test(i18nSrc),
        lang + ": the appearance group and the board-view group are named for what they hold (" + look + " / " + disp + ")");

    // A hint that counts the controls above it is a hint that goes wrong the
    // first time one of them is not rendered — and 「清除统计与历史」 is not,
    // until there is a game to clear. Measured: the line said three, the page
    // showed two.
    for (const m of i18nSrc.matchAll(/"hint\.danger":\s*"([^"]*)"/g))
      assert(!/三|three|3|２|二/i.test(m[1]),
        "the deletion hint does not name a count — «" + m[1] + "»");
  }

  // One implementation of which way round the board faces.
  //
  // Three doors lead to it: the settings segment, the F key and the native
  // View menu. The comment over NATIVE_COMMANDS says both halves "end up here
  // so there is one implementation and the two can never drift" — and they had
  // drifted, in exactly this action: the button announced the new view in a
  // toast, the key and the menu changed it in silence.
  {
    const app = allAppSource;
    const writes = [...app.matchAll(/store\.game\.flipped\s*=(?!=)/g)].length;
    // the assignments that remain are: the initial state, two authored-view
    // resets (lesson, puzzle), the loaded-record restore, the editor reset,
    // and setFlipped itself. 名局猜着 (v8-2-plan T3) faces the side being
    // guessed through its board model, as a puzzle does: writing the flag
    // turned the play board's saved setting over for good (M2 review)
    assert(/function setFlipped\(/.test(app), "setFlipped is the one place the view turns");
    // Two of the three doors are still spelled in app.js; the third is the
    // native View menu, which moved to native-commands.js in 6.1 and is
    // checked by firing it (see the native-menu block above, "ai mode").
    // One of the three doors is still spelled in app.js; the F key moved to
    // a11y.js and the native View menu to native-commands.js in 6.1, and both
    // are checked by pressing them (see the keyboard blocks above).
    for (const caller of [/setFlipped\(b\.dataset\.orient === "b"\)/])
      assert(caller.test(app), "…and it is what the three doors call — " + caller.source.slice(0, 26));
    assert(writes <= 8, "no door writes store.game.flipped for itself (" + writes + " assignments)");
  }

  // Naming a side, and naming the other one, are one character apart when
  // written out — and eight places wrote them out. The exported review image
  // had both of its inverted: the column holding White's accuracy, mistakes
  // and blunders was headed 黑方, and the turning point named the wrong player
  // as the one who played it, while the identical report in the panel named
  // them right. A picture you hand to somebody else, with the two players
  // swapped, in the one part of this app whose whole purpose is to be handed
  // to somebody else. Nobody had run docs/manual-check.md F6.
  {
    const app = allAppSource;
    assert(/const sideName = \(s\) => t\(s === "w" \? "side\.white" : "side\.black"\);/.test(app),
      "sideName is the one place a side is named");
    assert(/const otherSideName = \(s\) => t\(s === "w" \? "side\.black" : "side\.white"\);/.test(app),
      "…and otherSideName the one place its opponent is");
    // no third spelling anywhere else in the file. Comments are not code: the
    // paragraph above sideName quotes the shape it replaced, and a scan that
    // reads comments reports the explanation as the defect — the same way the
    // Chinese-label scan once reported a note about a heading as a heading.
    const code = app.replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n").filter((l) => !/^\s*\/\//.test(l)).join("\n");
    const inline = code.split("\n")
      .filter((l) => /\?[^\n]*"side\.(white|black)"/.test(l))
      .filter((l) => !/const (sideName|otherSideName) = /.test(l))
      .map((l) => l.trim());
    for (const x of inline) console.error("FAIL: a side named by hand: " + x);
    assert(inline.length === 0,
      "every side is named through one of the two, so the two cannot be swapped by eye");
  }

  // Every group heading in the panel is a heading. Three of them were a
  // <span class="side-h"> because they live inside a <summary> — same size,
  // same weight, same colour, and invisible to anything navigating by heading.
  {
    const markup = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const spans = [...markup.matchAll(/<span class="side-h"[^>]*>([^<]*)</g)].map((m) => m[1]);
    assert(spans.length === 0,
      "no group heading is a <span> (" + spans.join(", ") + ")");
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
    // 6.0: the scale is in rem now (see TYPE above); a step is still a step
    assert(/font-size:\s*[\d.]+rem/.test(co[1]), "coordinates sit on the type scale");
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
  // fixed in P0.5. v10-0-plan E5: the register it emptied is gone — zero is the rule.
  {
    const defined = new Set([...stripped.matchAll(/(--[\w-]+)\s*:/g)].map((m) => m[1]));
    const dangling = [...new Set([...stripped.matchAll(/var\(\s*(--[\w-]+)/g)].map((m) => m[1]))]
      .filter((v) => !defined.has(v));
    for (const v of dangling) console.error("  var(" + v + ") names no token");
    assert(dangling.length === 0,
      "no var() names a missing token" + (dangling.length ? " — " + dangling.join(", ") : ""));
  }

  // --- no new bare colour outside the theme blocks --------------------------
  // A colour written in place is a colour that cannot answer "what does this
  // look like in the other three themes". The ones below are the ones that
  // already shipped, listed rather than tolerated: this is the register P2
  // empties. Defect 8 — the eval bar's two hard-coded sides and the two
  // hard-coded blunder golds — was the last four, and left in P2.3. Anything not on this list fails, so the count only goes down.
  {
    // 9.0 V1 emptied it: #fff (the switch's knob, a hover mix) and #000 (a
    // toast's darkening mix, a mask's opaque stop) became tokens, and
    // #4a90d9 was a var(--accent) fallback that was never reached.
    // (#9a3412 / #1e3a5f, the notebook theme's ♔ ♚ side marks, left with
    // the match bar (7.7) — the strips draw each side as a disc in
    // --side-white / --side-black)
    // v10-0-plan E5: the register 9.0 V1 emptied is gone — zero is the rule
    const found = [...new Set((body.match(/#[0-9a-fA-F]{3,8}\b/g) || []).map((c) => c.toLowerCase()))];
    for (const c of found) console.error("  bare colour outside the themes: " + c);
    assert(found.length === 0,
      "no colour is written in place outside the themes" + (found.length ? " — " + found.join(", ") : ""));
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
                     "--accent", "--danger", "--control", "--line"]) {
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
  for (const board of MARK_BOARDS) {
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
  // P0.5). v10-0-plan E5: no register — zero is the rule.
  {
    const raw = [...boardSrc.matchAll(/ctx\.fillRect\(([^)]*)\)/g)]
      .map((m) => m[1].trim())
      .filter((a) => !a.startsWith("...cellRect("));
    for (const a of raw) console.error("  fillRect(" + a + ") does not go through cellRect()");
    assert(raw.length === 0, "every square fill goes through cellRect() (" + raw.length + " raw)");
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
    /invalidatePaint\(\)/.test(allAppSource),
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
  for (const theme of MARK_BOARDS) {
    const sel = theme === "wood" ? /:root, \[data-board="wood"\]\s*\{([\s\S]*?)\n    \}/
      : new RegExp('\\[data-board="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n    \\}');
    const blk = sel.exec(css2)[1];
    for (const which of ["--sq-light", "--sq-dark"]) {
      const hex = new RegExp(which + ":\\s*(#[0-9a-fA-F]{6})").exec(blk)[1];
      const r = ratio(0, lum(hex));
      assert(r >= 4.5, theme + " " + which + " keeps the piece outline legible (" + r.toFixed(2) + ":1)");
    }
  }

  // 7.7 §6: a mark is one colour, whichever square it lands on. On 7.6.0 the
  // wood last-move green composited to lime over the light square and olive
  // over the dark one, and the selection was a second, different yellow. The
  // measure is the hue term of CIEDE2000 between the two composites
  // (scripts/lib/mark-colour.mjs); 7.6.0 ran to 5.7 on four marks, 7.7 to 4.6.
  // The ceiling sits under every one of the old values, so re-tinting a mark
  // back towards olive fails here rather than on somebody's screen. And the
  // marks must stay apart from each other: a last-move tint that matches the
  // selection on the same square is two marks saying one thing.
  {
    const HUE_CEILING = 5.0;
    const SEP_FLOOR = 10;
    const now = measureMarks(css2);
    for (const b of MARK_BOARDS) {
      for (const k of MARKS) {
        const v = now[b].marks[k];
        assert(v.dH <= HUE_CEILING,
          b + " " + k + ": the same hue on the light and the dark square (ΔE00 hue term " + v.dH + " ≤ " + HUE_CEILING + ")");
      }
      assert(now[b].sep >= SEP_FLOOR,
        b + ": every two marks stay apart on the same square (closest ΔE00 " + now[b].sep + ", " + now[b].sepPair + ")");
      // 7.9 §3: quieter marks, not closer ones — no board below what 7.8.0 had
      assert(now[b].sep >= SEP_FLOOR_BY_BOARD[b],
        b + ": the marks at least as far apart as 7.8.0 (closest ΔE00 " + now[b].sep + " ≥ " + SEP_FLOOR_BY_BOARD[b] + ")");
    }
    // …and what docs/measured.json says is what ships: a retune without a
    // re-record is a stale number, and a stale number is worse than none
    const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).markHue;
    assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify(now),
      "docs/measured.json markHue.after is these palettes (re-run scripts/measure-marks.mjs --record)");
  }
  // 7.8 §6: …and not louder than it needs to be. The hue term kept the wood
  // last-move tint one colour on both squares; over the light square that
  // colour was a bright lime (C* 54.1 on 7.7.0). The ceiling is set against
  // Lichess's default board measured the same way (C* 52.4 — see
  // LAST_CHROMA_CEILING) and sits under it, so a last move reads as a tint,
  // not as a highlighter pen. Recorded as markChroma beside markHue.
  // 7.9 §3: every mark has a ceiling — the selection had run to 57, louder
  // than the last move it sits one step above, and the notebook hint to 68.
  // Last and selection ≤ 47, check and hint ≤ 52 (CHROMA_CEILING).
  {
    const now = markChroma(css2);
    for (const b of MARK_BOARDS) {
      assert(now[b].last <= LAST_CHROMA_CEILING,
        b + " last move: a soft tint over the light square (C* " + now[b].last + " ≤ " + LAST_CHROMA_CEILING + ")");
      for (const k of MARKS) {
        assert(now[b][k] <= CHROMA_CEILING[k],
          b + " " + k + ": under its chroma ceiling over the light square (C* " + now[b][k] + " ≤ " + CHROMA_CEILING[k] + ")");
      }
    }
    const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).markChroma;
    assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify(now) &&
      JSON.stringify(recorded.ceiling) === JSON.stringify(CHROMA_CEILING),
      "docs/measured.json markChroma.after is these palettes (re-run scripts/measure-marks.mjs --record)");
  }
  // v8-0-plan A3: the same mark on both squares, on every board. The two
  // checks above look at the light square (chroma) and at the hue term;
  // this one looks at the whole mark on both: its chroma over the light AND
  // the dark square under one ceiling, and the ΔE00 between the two
  // composites under another — a mark that is a tint on one square and a
  // stain on the other fails here. 7.9.0's wood check was C* 55.1 over the
  // dark square (ceiling 52), which the light-square check never saw. The
  // engine arrow is measured with them. And the boards must be boards: the
  // closest two dark squares ΔE00 ≥ 10 (7.9.0: 木 and 日, 6.4).
  {
    const look = markLook(css2);
    for (const b of MARK_BOARDS) {
      for (const k of Object.keys(LOOK_MARKS)) {
        const v = look[b][k];
        assert(!!v && Math.max(v.cl, v.cd) <= LOOK_CHROMA_CEILING[k],
          b + " " + k + ": under its chroma ceiling over both squares (C* " + (v && v.cl) + " / " + (v && v.cd) + " ≤ " + LOOK_CHROMA_CEILING[k] + ")");
        assert(!!v && v.dE <= LOOK_DE_CEILING,
          b + " " + k + ": the same mark on the light and the dark square (ΔE00 " + (v && v.dE) + " ≤ " + LOOK_DE_CEILING + ")");
      }
    }
    const apart = boardDistinct(css2);
    assert(apart.min >= BOARD_DISTINCT_FLOOR,
      "every two boards are two boards (closest dark squares ΔE00 " + apart.min + ", " + apart.pair + " ≥ " + BOARD_DISTINCT_FLOOR + ")");
    // the list measured is the list offered
    const lookSrc = fs.readFileSync(path.join(root, "src/web/js/look.js"), "utf8");
    const offered = [...lookSrc.matchAll(/\{ id: "(\w+)", warm: (?:true|false) \}/g)].map((m) => m[1]);
    assert(offered.join(",") === MARK_BOARDS.join(","),
      "the boards measured are the boards look.js offers (" + offered.join(",") + ")");
    const recorded = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).boardLook;
    assert(!!recorded && JSON.stringify(recorded.after) === JSON.stringify({ marks: look, distinct: apart }) &&
      JSON.stringify(recorded.ceiling) === JSON.stringify({ chroma: LOOK_CHROMA_CEILING, dE: LOOK_DE_CEILING, distinct: BOARD_DISTINCT_FLOOR }),
      "docs/measured.json boardLook.after is these palettes (re-run scripts/measure-marks.mjs --record)");
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
  // v8-0-plan B4: given the rung's own choice, a style picks nothing better
  // than it — red before B4: a styled UCI_Elo rung played far above itself
  {
    const own = [{ uci: "d2d4", score: 30 }, { uci: "b1c3", score: 10 }, { uci: "f1c4", score: 5 }, { uci: "d1e2", score: -20 }];
    const got = P.pick(fen, own, "principled", Chess, -20);
    assert(got === null || got === "d1e2", "B4: a style never picks a better move than the rung's own (" + got + ")");
    assert(["b1c3", "f1c4"].includes(P.pick(fen, own, "principled", Chess, 10)), "B4: …and still has a say among moves as good as it");
  }

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

// v8-0-plan B4: the opponents — the ladder, the personas, the engine's clock
// plan, when it resigns and offers a draw, and the player's engine-game
// rating. opponents.js and time-control.js are pure, so all of it is checked
// here without an engine; scripts/test-ladder.mjs is the measurement.
{
  loadModule(ctx, "src/web/js/engine.js");
  loadModule(ctx, "src/web/js/opponents.js");
  loadModule(ctx, "src/web/js/time-control.js");
  loadModule(ctx, "src/web/js/icons.js");
  const O = ctx.Opponents, TC = ctx.TimeControl, E = ctx.ChessEngine;
  assert(O && TC && E, "B4: opponents.js and time-control.js load");

  // the ladder: one list, and it is the app's
  const appIds = /const DIFF_IDS = \[([^\]]*)\]/.exec(allAppSource);
  const appList = appIds ? [...appIds[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]) : [];
  assert(JSON.stringify(appList) === JSON.stringify(O.LEVELS),
    "B4: the ladder in opponents.js is app.js's DIFF_IDS, rung for rung (" + O.LEVELS.join(",") + ")");
  assert(O.LEVELS.every((id) => E.TIERS[id]), "B4: every rung has engine settings");
  const between = O.LEVELS.slice(O.LEVELS.indexOf("casual") + 1, O.LEVELS.indexOf("easy"));
  assert(between.length >= 3 && between.length <= 5 && between.every((id) => E.TIERS[id].winT > 0 && E.TIERS[id].depth),
    "B4: 3–5 rungs between 休闲 and 初级 (v8-1-plan T1 added one), each depth-limited and sampling by win-chance loss (" + between.join(",") + ")");
  // v8-1-plan T1: from 初级 up, Stockfish's own UCI_Elo searched to the depth
  // it picks its move at (1 + its Skill level: deeper changes nothing but the
  // time), then node-limited full strength, then 不限档
  {
    const up = O.LEVELS.slice(O.LEVELS.indexOf("easy"), O.LEVELS.indexOf("extreme"));
    const lvl = (elo) => { const e = (elo - 1320) / 1870; return Math.min(19, Math.max(0, ((37.2473 * e - 40.8525) * e + 22.2944) * e - 0.311438)); };
    const elo = up.filter((id) => E.TIERS[id].elo != null), nodes = up.filter((id) => E.TIERS[id].nodes);
    // (the plan expected 8–10 between 初级 and 不限档 and 1–2 by nodes; the
    // games asked for 13, four by nodes — docs/v8-1-plan.md §9 M3)
    assert(up.length >= 8 && elo.length + nodes.length === up.length && nodes.length >= 1 &&
      up.indexOf(nodes[0]) === elo.length && nodes.every((id, i) => i === 0 || E.TIERS[id].nodes > E.TIERS[nodes[i - 1]].nodes),
      "T1: from 初级 up to 不限档, UCI_Elo rungs, then node-limited ones in growing counts (" + up.join(",") + ")");
    const off = elo.filter((id) => E.TIERS[id].depth !== 1 + Math.floor(lvl(E.TIERS[id].elo)) || !E.TIERS[id].minMs);
    assert(off.length === 0, "T1: each UCI_Elo rung searches to its pick depth, and holds its reply like a depth rung" + (off.length ? " — " + off : ""));
    assert(E.searchCmd({ depth: 3 }, Math.random) === "go depth 3" && E.searchCmd({ movetime: 700 }, Math.random) === "go movetime 700" &&
      E.searchCmd({ nodes: 10000 }, () => 0) === "go nodes 8500" && E.searchCmd({ nodes: 10000 }, () => 1) === "go nodes 11500" &&
      // (no floor: analysis's nodesFor floor of 1000 once turned a 400-node rung into a fixed 1000)
      E.searchCmd({ nodes: 400 }, () => 0.5) === "go nodes 400",
      "T1: a node rung's count is drawn ±15% a move, so the same moves do not get the same game");
  }
  assert(between.every((id) => E.TIERS[id].skill <= 5), "B4: …at a low Skill Level");
  {
    assert(O.LEVELS.every((id) => typeof O.EN_NAME[id] === "string"), "B4: every rung has a PGN name");
  }

  // the win-chance draw: the best line most often, a blunder rarely, and a
  // forced mate never thrown away
  {
    let seed = 7;
    const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const list = [{ uci: "a2a3", score: 20 }, { uci: "b2b3", score: 0 }, { uci: "c2c3", score: -40 }, { uci: "d2d4", score: -600 }];
    const tier = { winT: 8 };
    const tally = {};
    for (let i = 0; i < 2000; i++) { const u = E.pickCandidate(list, tier, rng); tally[u] = (tally[u] || 0) + 1; }
    assert(tally.a2a3 > tally.b2b3 && tally.b2b3 > (tally.c2c3 || 0) && (tally.d2d4 || 0) < 20,
      "B4: winT sampling favours the best, and a piece-losing move is rare (" + JSON.stringify(tally) + ")");
    assert(E.pickCandidate([{ uci: "a2a3", score: 99990 }, { uci: "b2b3", score: 0 }], tier, rng) === "a2a3",
      "B4: …and never trades a found mate away");
    // a style chooses only among moves as good as the one drawn
    const lean = [0, 0, 500, 900];
    const styled = {};
    for (let i = 0; i < 2000; i++) { const u = E.pickCandidate(list, tier, rng, lean); styled[u] = (styled[u] || 0) + 1; }
    assert((styled.d2d4 || 0) < 20,
      "B4: a style's lean does not reach a move far worse than the one drawn (" + JSON.stringify(styled) + ")");
    assert(Math.abs(E.winPct(0) - 50) < 1e-9 && E.winPct(300) > 70 && E.winPct(-300) < 30, "B4: win chance is Lichess's curve");
  }

  // personas: one per rung (v8-1-plan T1: 8–12 until the ladder was re-stepped), a style persona.js knows, an icon icons.js draws
  assert(O.PERSONAS.length === O.LEVELS.length, "B4: a persona for every rung (" + O.PERSONAS.length + ")");
  // 9.0 S2: the dialog shows eight personas, the ladder around the pick —
  // in ladder order, so a window of the list is a stretch of the ladder
  assert(O.PERSONAS.every((p, i) => i === 0 || O.LEVELS.indexOf(p.level) > O.LEVELS.indexOf(O.PERSONAS[i - 1].level)),
    "S2: the personas run in ladder order, so eight in a row are neighbours");
  assert(/const SHOWN = 8;/.test(fs.readFileSync(path.join(root, "src/web/js/opponents-ui.js"), "utf8")),
    "S2: the dialog shows eight opponent cards");
  assert(new Set(O.PERSONAS.map((p) => p.level)).size === O.PERSONAS.length && O.PERSONAS.every((p) => O.LEVELS.includes(p.level)),
    "B4: each persona is its own rung of the ladder");
  assert(O.PERSONAS.every((p) => ctx.ChessPersona.IDS.includes(p.style)), "B4: each persona's style is one persona.js plays");
  assert(new Set(O.PERSONAS.map((p) => p.icon)).size === O.PERSONAS.length &&
    O.PERSONAS.every((p) => ctx.ChessIcons.NAMES ? ctx.ChessIcons.NAMES.includes(p.icon) : /\S/.test(p.icon)),
    "B4: every persona has its own avatar icon");
  {
    const icons = fs.readFileSync(path.join(root, "src/web/js/icons.js"), "utf8");
    const missing = O.PERSONAS.filter((p) => !icons.includes('"' + p.icon + '": ['));
    assert(missing.length === 0, "B4: …drawn from icons.js's own shapes" + (missing.length ? " — missing " + missing.map((p) => p.icon) : ""));
  }
  assert(O.personaFor("easy", "off") && O.personaFor("easy", "off").level === "easy" && O.personaFor("easy", "greedy") === null,
    "B4: a (rung, style) pair is a persona or a combination of one's own");
  loadModule(ctx, "src/web/js/i18n.js");
  // the personas' words are content (opponents-lines.js, in the chunk), held
  // to what the dictionary checks hold keys to
  loadModule(ctx, "src/web/js/opponents-lines.js");
  const LINES = ctx.OP_LINES;
  assert(JSON.stringify(Object.keys(LINES).sort()) === JSON.stringify(Object.keys(ctx.ChessI18n.DICT).sort()),
    "B4: the persona lines come in every interface language (" + Object.keys(LINES) + ")");
  for (const lang of Object.keys(LINES)) {
    const T = LINES[lang];
    // the end-of-game line is the persona's own or the shared `bye`
    const gaps = O.PERSONAS.filter((p) => !T[p.id] || !T[p.id].name || !T[p.id].hello).map((p) => p.id)
      .concat(["say", "bye", "noOpening"].filter((k) => !T[k]));
    assert(gaps.length === 0, "B4: " + lang + " names every persona and gives it both lines" + (gaps.length ? " — " + gaps.slice(0, 4) : ""));
    if (lang !== "zh-CN") {
      const same = O.PERSONAS.filter((p) => p.id !== "fish" && T[p.id].hello === LINES["zh-CN"][p.id].hello);
      assert(same.length === 0, "B4: " + lang + " persona lines are translated");
    }
    if (lang === "zh-CN") {
      const half = Object.values(T).flatMap((v) => (typeof v === "string" ? [v] : [v.hello, v.bye || ""])).filter((x) => /[\u4e00-\u9fff][,;:?!]|[,;:?!][\u4e00-\u9fff]/.test(x));
      assert(half.length === 0, "B4: the Chinese persona lines use full-width punctuation" + (half.length ? " — " + half[0] : ""));
    }
    // 7.8's rule: facts, not feelings — no line judges the player or has the
    // machine feel something about the game
    const JUDGE = lang === "en" ? /\b(good|great|nice|well played|brilliant|bad|poor|terrible|happy|sad|sorry|enjoy|fun|love|hate|luck)\b/i
      : lang === "ja" ? /(すごい|素晴らし|上手|下手|残念|楽しい|嬉しい|悲しい|ごめん|頑張)/ : /(好棋|漂亮|厉害|精彩|可惜|遗憾|开心|高兴|难过|抱歉|加油|运气|真棒|太好)/;
    const judged = O.PERSONAS.flatMap((p) => [T[p.id].hello, T[p.id].bye]).concat([T.bye]).filter((s) => JUDGE.test(s || ""));
    assert(judged.length === 0, "B4: " + lang + " persona lines state facts only (7.8)" + (judged.length ? " — " + judged[0] : ""));
  }

  // --- v9-0-plan S6: the interface speaks the player's words ---------------
  // 8.4 told the player 「Stockfish 限制在 UCI_Elo 1700」, 「置换表」,
  // 「MultiPV 6」, 「（120ms/步）」, 「结论已查 Syzygy 残局库核对」, 「7.6 以前的
  // 合成音」 and 「1500?」 — engine settings, version numbers and a statistic's
  // error bar, where the player wanted to know what the thing does for them.
  // Nothing user-facing — the three dictionaries, the persona lines, the
  // fallback text and tooltips in index.html — may say these again. The
  // register is for a key in the 高级 (engine) settings group that truly needs
  // one of the words in its tooltip; it may only shrink (S6 left it empty).
  {
    const TECH = /UCI_Elo|UCI_LimitStrength|MultiPV|Syzygy|ms\/步|ms\/move|\d\s?ms\b|毫秒|ミリ秒|\bnodes?\b|节点|ノード|置换表|置換表|hash table|ハッシュ表|\d\.\d+\s?(以前|之前|より前)|before \d\.\d|实测|実測|measured:|一半重合|agree about half|一致するのは約半分|±\{\d\}/i;
    // v10-0-plan E5: the register S6 emptied is gone — none is the rule
    const leaks = [];
    for (const [lang, dict] of Object.entries(ctx.ChessI18n.DICT)) {
      for (const [k, v] of Object.entries(dict)) {
        if (!TECH.test(v)) continue;
        leaks.push(lang + " " + k + ": " + v);
      }
    }
    for (const [lang, T] of Object.entries(LINES)) {
      for (const p of O.PERSONAS) for (const line of ["hello", "bye"]) {
        if (TECH.test(T[p.id][line] || "")) leaks.push(lang + " op." + p.id + "." + line + ": " + T[p.id][line]);
      }
    }
    // index.html's own text and tooltips, outside comments and scripts
    const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8")
      .replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
    for (const m of html.matchAll(/\s(?:title|aria-label|placeholder)="([^"]*)"|>([^<>]+)</g)) {
      const s = m[1] != null ? m[1] : m[2];
      if (TECH.test(s)) leaks.push("index.html: " + s.trim());
    }
    for (const l of leaks) console.error("  implementation detail on screen — " + l);
    assert(leaks.length === 0, "S6: no engine settings, version numbers or error bars in the interface's words" + (leaks.length ? " — " + leaks.length + " leak(s)" : ""));

    // one thing, one number: a persona's lines and a rung's tooltip quote
    // the rating the card shows (opponents.js, measured), never another
    const TIP_OF = { easy: "tip.diffEasy", normal: "tip.diffNormal", hard: "tip.diffHard", casual: "tip.casual" };
    const wrong = [];
    for (const p of O.PERSONAS) {
      const want = String(O.ratingOf(p.level));
      const texts = Object.entries(LINES).flatMap(([lang, T]) => [[lang + " op." + p.id + ".hello", T[p.id].hello], [lang + " op." + p.id + ".bye", T[p.id].bye || ""]])
        .concat(Object.entries(ctx.ChessI18n.DICT).map(([lang, d]) => { const k = TIP_OF[p.level] || "tip.diff." + p.level; return [lang + " " + k, d[k] || ""]; }));
      for (const [where, s] of texts) {
        for (const m of s.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/(?<![\d.])\d{3,4}(?![\d.])/g)) {
          if (m[0] !== want) wrong.push(where + " says " + m[0] + ", the card says " + want);
        }
      }
    }
    for (const w of wrong) console.error("  " + w);
    assert(wrong.length === 0, "S6: every rating a persona line or rung tooltip quotes is the one on its card" + (wrong.length ? " — " + wrong.length + " differ" : ""));

    // a provisional rating says so in words; it is not a number with a 「?」
    const provSrc = ["src/web/js/opponents-ui.js", "src/web/js/trainer/puzzle-rating.js", "src/web/js/trainer/puzzle-modes.js",
      "src/web/js/trainer/visual-modes.js", "src/web/js/trainer/puzzles.js"]
      .map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]);
    const marked = provSrc.filter(([, s]) => /(isProvisional\([^)]*\)|\.provisional|\.rd > \d+)\s*\?\s*"\?"/.test(s)).map(([f]) => f);
    assert(marked.length === 0, "S6: a provisional rating reads 定级中 / Provisional / 判定中, not 「1500?」" + (marked.length ? " — " + marked : ""));
    for (const [lang, want] of [["zh-CN", "定级中"], ["en", "Provisional"], ["ja", "判定中"]]) {
      assert(new RegExp(want, "i").test(ctx.ChessI18n.DICT[lang]["rating.prov"] || ""), "S6: " + lang + " calls a provisional rating " + want);
    }
    // the two ratings have one name each (M0): 对局等级分 and 谜题等级分
    const NAMES = { "zh-CN": ["对局等级分", "谜题等级分", /评级/], en: ["Game rating", "Puzzle rating", /(?!)/], ja: ["対局レーティング", "パズルレーティング", /パズルのレーティング|問題レーティング|エンジン戦のレーティング/] };
    for (const [lang, [game, puzzle, old]] of Object.entries(NAMES)) {
      const d = ctx.ChessI18n.DICT[lang];
      assert(d["me.gameRating"] === game && d["rec.rating"] === puzzle, "S6: " + lang + " names the ratings " + game + " / " + puzzle + " (" + d["me.gameRating"] + " / " + d["rec.rating"] + ")");
      const stale = Object.entries(d).filter(([, v]) => old.test(v)).map(([k]) => k);
      assert(stale.length === 0, "S6: " + lang + " has no other name for a rating left" + (stale.length ? " — " + stale.slice(0, 5) : ""));
    }
    // and the strongest rung has one name: its label is what the endgame
    // camp calls its engine, and what index.html's fallback text says
    for (const [lang, d] of Object.entries(ctx.ChessI18n.DICT)) {
      assert(d["eg.engine"].includes(d["diff.extreme"]), "S6: " + lang + " endgame engine is the top rung by name (" + d["eg.engine"] + " / " + d["diff.extreme"] + ")");
      // 8.4's achievement called it a fourth thing: 「极限」 / "Max level" / 「最強」
      assert(d["ach.extreme-win.d"].includes(d["diff.extreme"]), "S6: " + lang + " achievement names the top rung as the button does (" + d["ach.extreme-win.d"] + ")");
    }

  }

  // the clock: presets, a custom control in its own id, and nothing else
  assert(TC.parse("15+10").base === 900 && TC.parse("15+10").inc === 10 && TC.parse("30").base === 1800 && TC.parse("30").inc === 0,
    "B4: 15+10 and 30+0 are presets");
  assert(TC.parse("c20+5").base === 1200 && TC.parse("c20+5").inc === 5 && TC.isCustom("c20+5") && !TC.isCustom("5+3"),
    "B4: a custom control is c<minutes>+<increment>");
  assert(TC.parse("c0+5") === null && TC.parse("c181+0") === null && TC.parse("c10+61") === null && TC.parse("off") === null && TC.parse("toString") === null,
    "B4: …inside its bounds, and nothing else parses");
  assert(TC.customId(999, -3) === "c180+0" && TC.customId("7", "2") === "c7+2",
    "B4: custom ids are clamped into bounds");

  // the engine on a clock: search capped at the rung's calibrated movetime,
  // pace growing with the clock up to its own cap, never past a 20th of it
  {
    const easy = E.TIERS.extreme; // (v8-1-plan T1: the one movetime rung left)
    const blitz = O.thinkPlan(easy, 180000, 0), rapid = O.thinkPlan(easy, 1800000, 0), low = O.thinkPlan(easy, 4000, 0);
    assert(blitz.search <= easy.movetime && rapid.search === easy.movetime,
      "B4: a long control does not search past the rung's calibrated movetime (" + blitz.search + " / " + rapid.search + ")");
    assert(rapid.pace > blitz.pace && rapid.pace <= O.PACE_CAP_MS, "B4: …but its pace grows with the clock, up to the cap (" + blitz.pace + " → " + rapid.pace + ")");
    assert(low.search < easy.movetime && low.pace <= 4000 / 20, "B4: short of time it searches less and does not stall (" + low.search + " / " + low.pace + ")");
    assert(O.thinkPlan(easy, 10000, 10000).search > O.thinkPlan(easy, 10000, 0).search, "B4: the increment counts");
    const d = O.thinkPlan(E.TIERS.beginner, 600000, 0);
    assert(d.search === 0 && d.pace > 0, "B4: a depth rung is not given a movetime, only a pace");
    // M3 评审: …but a ceiling from the clock, so a deep rung on a nearly flagged 1+0 cannot outlast it
    const flag = O.thinkPlan(E.TIERS.master, 2000, 0);
    assert(flag.ceil > 0 && flag.ceil <= 2000 / 40 + 1 && flag.pace <= 2000 / 20 && O.thinkPlan(E.TIERS.extreme, 2000, 0).ceil === 0,
      "M3: a depth rung with 2 s left is bounded by the clock (" + JSON.stringify(flag) + ")");
    // v8-1-plan T1: a node rung's count is its calibrated search, in engine.js's own nodes per ms
    const nr = { nodes: 90000 };
    assert(O.NODES_PER_MS === E.NODES_PER_MS && O.thinkPlan(nr, 1800000, 0).search === 200 && O.thinkPlan(nr, 4000, 0).search < 200,
      "T1: a node rung searches its count on a long clock and fewer nodes short of time");
  }

  // resigning and offering a draw
  assert(!O.shouldResign([-1200, -1200, -1200]), "B4: no resignation in the first moves");
  const quiet = new Array(10).fill(30);
  assert(O.shouldResign(quiet.concat([-1100, -1500, -2000])), "B4: resigns after three moves at −10 or worse");
  assert(!O.shouldResign(quiet.concat([-1100, -300, -2000])), "B4: …sustained, not a single dip");
  assert(O.shouldResign(quiet.concat([-99990, -99992])), "B4: …or two moves into a mate against it");
  const level = new Array(12).fill(5);
  assert(O.shouldOfferDraw(level, 80, 12, null), "B4: offers a draw in a dead-level, quiet ending");
  assert(!O.shouldOfferDraw(level, 40, 12, null) && !O.shouldOfferDraw(level, 80, 2, null) && !O.shouldOfferDraw(level.concat([90]), 80, 12, null),
    "B4: …not in the opening, not while things still change, not when it is ahead");
  assert(!O.shouldOfferDraw(level, 80, 12, 70) && O.shouldOfferDraw(level, 100, 12, 70), "B4: …and not again straight after a decline");

  // your rating: Glicko-2 against the rungs, apart from the puzzle one
  {
    const stats = { v: 2, games: [] };
    const now = Date.UTC(2026, 8, 1);
    const recA = { id: "a", t: now, diff: "normal", result: "win" };
    const f1 = O.fileRating(stats, recA, now);
    assert(f1 && f1.before === null && f1.after.r > 1500 && stats.rating === f1.after, "B4: a first win moves a newcomer up, stored on the stats record");
    const rec = { id: "b", t: now + 1000, diff: "normal", result: "loss" };
    const f2 = O.fileRating(stats, rec, now + 1000);
    assert(f2.after.r < f1.after.r && rec.rb === Math.round(f1.after.r) && rec.ra === Math.round(f2.after.r) && Number.isFinite(rec.perf),
      "B4: each game carries rb / ra / perf (ra is what 「我的」 draws: progress-metrics.js ratingAfter)");
    const replay = O.rateHistory([recA, rec]);
    assert(Math.round(replay.r) === Math.round(f2.after.r), "B4: a profile from before B4 gets its rating by replaying its games");
    assert(recA.lad === O.LADDER && rec.lad === O.LADDER, "T1: a game filed now says which ladder it was rated against");
    // v8-1-plan T1: an 8.0 profile — records with no `lad`, on the twelve
    // 8.0 rungs — replays to the rating 8.0's own code gave it (computed on
    // 1972e19, before the ladder was re-stepped): the new ratings of the
    // same ids do not reach back into games played against the old ones
    {
      const ids80 = ["beginner", "casual", "learner", "improver", "steady", "solid", "easy", "easyplus", "normalminus", "normal", "hard", "extreme"];
      const res = ["win", "loss", "draw", "win", "loss"];
      const t0 = Date.UTC(2026, 5, 1);
      const old = [];
      for (let i = 0; i < 36; i++) old.push({ id: "g" + i, t: t0 + i * 86400000 * (i % 3 === 0 ? 3 : 1), diff: ids80[(i * 5) % 12], result: res[i % 5] });
      const r80 = O.rateHistory(old);
      assert(Math.abs(r80.r - 1228.7012797742468) < 1e-6 && Math.abs(r80.rd - 179.47270731277916) < 1e-6 &&
        Math.abs(r80.vol - 0.06009909724615745) < 1e-9 && r80.n === 36,
        "T1: an 8.0 profile's games replay to the same Glicko-2 rating as on 8.0 (" + (r80 && r80.r) + ")");
      assert(O.performance(old.slice(-10).map((g) => ({ level: g.diff, result: g.result }))) === 1309,
        "T1: …and the same performance rating over its last ten");
      assert(ids80.every((id) => O.opponentOf(id).r === O.RATING_80[id]) &&
        O.LEVELS.every((id) => O.opponentOf(id, O.LADDER).r === O.RATING[id]),
        "T1: an unmarked record is rated against 8.0's ladder, a marked one against today's");
      const replayed = O.rateHistory(old.concat([Object.assign({}, old[0], { id: "new", t: t0 + 400 * 86400000, lad: O.LADDER })]));
      assert(replayed.n === 37, "T1: old and new records replay together");
    }
    assert(O.ratingOfStats({ v: 2, games: [{ t: now, diff: "normal", result: "win" }] }).r > 1500, "B4: …when it has none stored");
    const s1700 = O.ratingOf("normal");
    assert(O.performance([{ level: "normal", result: "draw" }]) === s1700, "B4: performance of a draw is the opponent's rating");
    assert(O.performance([{ level: "normal", result: "win" }]) === s1700 + 400, "B4: …and a perfect score is capped at +400");
    const five = (r, level) => new Array(5).fill({ level, result: r });
    assert(O.advice(five("win", "normal"), "normal", { r: 1800, rd: 60 }) === "up" &&
      O.advice(five("loss", "normal"), "normal", { r: 1500, rd: 60 }) === "down" &&
      O.advice(five("win", "normal"), "normal", { r: 1400, rd: 60 }) === null &&
      O.advice(five("win", "normal").slice(1), "normal", null) === null,
      "B4: move up after 70%+ over five, down after 25% or less — when the rating agrees");
    assert(O.neighbour("normal", "up").level === O.LEVELS[O.LEVELS.indexOf("normal") + 1], "B4: …to the persona one rung over");
    // Codex #89: five wins at one rung, each separated by two games at others,
    // still earn the move-up advice — the rung's own history, not the last ten overall
    {
      const other = O.LEVELS.find((l) => l !== "normal");
      const mix = { v: 2, games: [] };
      let t = now, last = null;
      for (let k = 0; k < 5; k++) {
        for (let j = 0; j < 2 && k > 0; j++) { const g = { id: "o" + k + j, t: ++t, diff: other, result: "draw" }; O.fileRating(mix, g, t); mix.games.push(g); }
        const g = { id: "n" + k, t: ++t, diff: "normal", result: "win" };
        mix.rating = { r: 1900, rd: 60, vol: 0.06, at: t, n: 20 };
        last = O.fileRating(mix, g, t);
        mix.games.push(g);
      }
      assert(last && last.advice === "up", "B4: five wins at a rung spread among other games still earn 「升一档」 (" + (last && last.advice) + ")");
    }
    // Codex #89: two games filed before the chunk landed are both in stats.games
    // when they are rated — each is rated from what came before it, in order
    {
      const g1 = { id: "q1", t: now, diff: "normal", result: "win" }, g2 = { id: "q2", t: now + 1000, diff: "normal", result: "loss" };
      const queued = { v: 2, games: [g1, g2] };
      O.fileRating(queued, g1, g1.t);
      O.fileRating(queued, g2, g2.t);
      const seq = { v: 2, games: [] };
      O.fileRating(seq, g1, g1.t); seq.games.push(g1);
      const g2b = Object.assign({}, g2);
      O.fileRating(seq, g2b, g2.t);
      assert(queued.rating.n === 2 && Math.round(queued.rating.r) === Math.round(seq.rating.r) && g1.ra > g2.ra,
        "B4: games rated late, in order, come out as if rated on time (n " + queued.rating.n + ")");
    }
    // #89 review: a game recorded unrated (its rung changed mid-game, or a
    // position set up by hand) moves nothing, filed or replayed
    {
      const st = { v: 2, games: [] };
      const file = (g) => { const f = O.fileRating(st, g, g.t); st.games.push(g); return f; };
      file({ id: "u1", t: now, diff: "normal", result: "win" });
      const kept = st.rating;
      const u = { id: "u2", t: now + 1000, diff: "extreme", result: "win", unrated: "changed" };
      const fu = file(u);
      file({ id: "u3", t: now + 2000, diff: "normal", result: "win" });
      const replay = O.rateHistory(st.games);
      assert(fu === null && u.ra === undefined && st.rating.n === 2 && kept.n === 1 && Math.round(replay.r) === Math.round(st.rating.r) && replay.n === 2,
        "B4: an unrated game is recorded but neither filed nor replayed into the rating (" + JSON.stringify({ fu: !!fu, n: st.rating.n, replay: replay.n }) + ")");
    }
  }

  // the app's hooks — few lines, each where the thing happens
  const mt = srcOf("maybeEngineTurn");
  assert(/OppUI\.plan\(engineSide\)/.test(mt), "B4: the engine's budget is opponents.js's clock plan");
  assert(/if \(OppUI\.resigns\(mv\)\) return;[\s\S]*gameMove\(/.test(mt), "B4: the engine resigns before it would play its move");
  assert(/OppUI\.maybeOffer\(\)/.test(mt), "B4: …and offers a draw after one");
  assert(/OppUI\.file\(s, rec/.test(srcOf("recordOutcome")) && /recordOutcome\(result, ""\)/.test(srcOf("recordGameIfOver")),
    "B4: every filed engine game goes through one door, which rates it");
  {
    const ui = fs.readFileSync(path.join(root, "src/web/js/opponents-ui.js"), "utf8");
    const paintBody = /function paint\(\) \{([\s\S]*?)\n  \}/.exec(ui);
    assert(paintBody && !/replaceChildren|innerHTML|appendChild|createElement/.test(paintBody[1]),
      "B4: the persona cards are relabelled in place, never rebuilt (7.6)");
    const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    assert(/id="draw-offer"[^>]*hidden[\s\S]{0,300}id="draw-accept"[\s\S]{0,200}id="draw-decline"/.test(html),
      "B4: the draw offer is static markup, shown and hidden, not built");
    for (const tc of ["15+10", "30", "custom"]) assert(html.includes('data-tc="' + tc + '"'), "B4: the clock row offers " + tc);
  }

  // the ratings are the measured ones
  const lad = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).ladder;
  assert(!!lad && lad.rating, "B4: docs/measured.json holds the ladder run");
  if (lad && lad.rating) {
    const off = O.LEVELS.filter((id) => O.RATING[id] !== lad.rating[id] || O.RATING_SE[id] !== lad.ratingSe[id]);
    assert(off.length === 0, "B4: opponents.js's ratings are docs/measured.json's" + (off.length ? " — " + off.join(",") : ""));
    assert(O.LEVELS.every((id, i) => i === 0 || O.RATING[id] > O.RATING[O.LEVELS[i - 1]]), "B4: the ladder is monotone");
    assert(lad.rating.easy === 1320 && lad.rating.normal === 1700, "B4: anchored at 1320 and 1700");
    // the plan's acceptance (B4 for 新手 → 扎实, v8-1-plan T1 for the whole
    // ladder): every step one the stronger side scores 60–75% on, as fitted.
    // Each step's 95% interval is recorded beside it (`fitCi`, `h2hCi`) —
    // this holds the point estimate, which is what the games say; the
    // intervals say how sure (docs/v8-1-plan.md §9 M3).
    const outside = lad.adjacent.filter((a) => !(a.fitPct >= 60 && a.fitPct <= 75));
    assert(lad.adjacent.length === O.LEVELS.length - 1 && lad.adjacent.every((a, i) => a.lower === O.LEVELS[i] && a.upper === O.LEVELS[i + 1]) &&
      outside.length === 0 && lad.adjacent.every((a) => Array.isArray(a.fitCi) && a.fitCi[0] <= a.fitPct && a.fitPct <= a.fitCi[1]),
      "T1: 新手 → 不限档, every step 60–75%, each with its interval (" + outside.map((a) => a.upper + " " + a.fitPct + "%").join(", ") + ")");
    assert(Number.isFinite(lad.engineHours) && lad.played > 0 && lad.games === lad.played + lad.carried,
      "T1: the record says how many games were played for it, how many carried, and the engine time");
    const stale = O.LEVELS.filter((id) => JSON.stringify(lad.settings[id]) !== JSON.stringify(Object.assign({}, E.TIERS[id],
      { style: (O.PERSONAS.find((p) => p.level === id) || {}).style || "off" })));
    assert(stale.length === 0, "B4: the run measured the rungs that ship (re-run scripts/test-ladder.mjs)" + (stale.length ? " — " + stale.join(",") : ""));
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

// The review curve's move axis (A4): where each move begins, and the first
// ply of a game that starts with Black to move (Codex #89: "30…" is move 30)
{
  loadModule(ctx, "src/web/js/review/eval-graph.js");
  const ticks = ctx.axisTicks;
  const w = ticks(6, "w", (i) => 1 + Math.floor(i / 2), 1).map((x) => x.no);
  const b = ticks(6, "b", (i) => 30 + Math.floor((i + 1) / 2), 1);
  assert(JSON.stringify(w) === "[1,2,3]", "A4: a game from the start labels moves 1, 2, 3 (" + w + ")");
  assert(b[0] && b[0].i === 0 && b[0].no === 30 && JSON.stringify(b.map((x) => x.no)) === "[30,31,32,33]",
    "A4: a game starting 30… labels move 30 on its first ply, then 31 on White's (" + JSON.stringify(b) + ")");
  assert(ctx.tickEvery(50, 52) === 1 && ctx.tickEvery(1, 3) === 1 && ctx.tickEvery(1, 60) === 10,
    "A4: the label interval follows the moves plotted — a three-move study from move 50 labels every move (" + ctx.tickEvery(50, 52) + ")");
  const b10 = ticks(6, "b", (i) => 31 + Math.floor((i + 1) / 2), 10);
  assert(b10.length && b10[0].i === 0 && b10[0].no === 31, "A4: …and the first ply is labelled even off the interval (31… at every 10: " + JSON.stringify(b10) + ")");
}

// A5: the result badges of a variation that the rules end are that
// variation's result, not the mainline's resignation (Codex #89)
{
  loadModule(ctx, "src/web/js/game-end.js");
  const staleGame = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"); // Black to move, stalemated
  const kingAt = (g, side) => { for (const row of g.board()) for (const x of row) if (x && x.type === "k" && x.color === side) return x.square; return null; };
  const ge = (onMain) => ctx.createGameEnd({
    store: { session: { mode: "pvp" }, game: { resigned: "b" } }, t: (k) => k, tf: (k) => k, sideName: (s) => s, game: staleGame,
    el: () => null, setText() {}, avail() {}, toast() {}, sanHistory: () => ["x"], analysisFor: () => null,
    appGameOver: () => true, resultFromFile: () => false, gameResultToken: () => "1-0", timeoutIsDraw: () => false,
    autoDrawReason: () => null, isLive: () => true, kingSquare: kingAt, onMainline: () => onMain, onEnding() {},
  });
  const off = ge(false).resultBadges();
  assert(off && off.length === 2 && off.every((b) => b.kind === "draw"),
    "A5: a stalemated variation of a resigned game carries ½ on both kings (" + JSON.stringify(off) + ")");
  // …and a variation that is not over has no ending at all: no card, no badges
  const openGame = new Chess("7k/8/6K1/8/8/8/5Q2/8 b - - 0 1");
  const geOpen = ctx.createGameEnd({
    store: { session: { mode: "pvp" }, game: { resigned: "b" } }, t: (k) => k, tf: (k) => k, sideName: (s) => s, game: openGame,
    el: () => null, setText() {}, avail() {}, toast() {}, sanHistory: () => ["x"], analysisFor: () => null,
    appGameOver: () => true, resultFromFile: () => false, gameResultToken: () => "1-0", timeoutIsDraw: () => false,
    autoDrawReason: () => null, isLive: () => true, kingSquare: kingAt, onMainline: () => false, onEnding() {},
  });
  assert(geOpen.gameEnding() === null && geOpen.resultBadges() === null,
    "A5: an unfinished variation of a resigned game has no ending — the result card and the badges stay away");
  assert(ge(false).gameEnding().token === "1/2-1/2", "A5: …a stalemated one ends in a draw, whatever the mainline did");
  const main = ge(true).resultBadges();
  assert(main && main.find((b) => b.sq === "g6").kind === "win", "A5: …the mainline keeps the game's own result (" + JSON.stringify(main) + ")");
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

  const appSrc = allAppSource;
  // v8-0-plan F4: one function's text from whichever module declares it
  const fnOf = srcOf;
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
    const strays = appModuleEntries().flatMap(([, text]) => [...text.matchAll(/^  let ([A-Za-z_$][\w$]*)/gm)])
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
    // 6.0: one commitAll() instead of three commits — a view that hears about
    // every slice is told once (draw() ran three times per sync() before)
    const notCommit = calls.filter((n) => n !== "commit" && n !== "commitAll");
    for (const n of notCommit) console.error("  sync() still calls " + n + "()");
    assert(notCommit.length === 0,
      "sync() does nothing but commit" + (notCommit.length ? " — also calls " + [...new Set(notCommit)].join(", ") : ""));
    assert(/store\.commitAll\(\["game", "session", "ui"\]/.test(body), "sync() commits game, session and ui in one pass");
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
  // v8-0-plan F2: the doors expire them, not the commit — a replay step
  // commits too, and must not cost a walk of the whole game
  assert(/function forgetHistory\(\) \{\s*store\.game\._vh = null;\s*store\.game\._san = null;/.test(appSrc),
    "one function expires the history caches");
  for (const door of ["gameLoad", "gameLoadPgn", "gameReset"]) {
    assert(/forgetHistory\(\)/.test(fnOf(door)), door + "() starts the history over");
  }
  assert(/_vh\.concat\(r\)/.test(fnOf("gameMove")) && /_vh\.slice\(0, -1\)/.test(fnOf("gameUndo")),
    "gameMove() / gameUndo() edit the history by one entry");
  const gameSub = appSrc.slice(appSrc.indexOf('store.subscribe("game", () => {')).split("});")[0];
  assert(gameSub.length > 0 && !/_vh = null|forgetHistory/.test(gameSub),
    "…and the game commit no longer throws it away");
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
  // five models: the game, the puzzle, the lesson, 再试一次 (v7-8-plan §3)
  // and 名局猜着 (v8-2-plan T3, trainer/guess.js)
  assert((appSrc.match(/mated: g\.in_checkmate\(\)/g) || []).length === 5,
    "every board model says whether the check is mate");

  // the analyser must not carry a fifth copy of the numbers
  const analyze = fnOf("analyzeGame");
  // 6.0: by win-percentage drop (v6-plan Q2.5), still through review.js
  assert(/Review\.classifyByWinPct\(Review\.winPctDrop\(/.test(analyze), "the analyser tags moves through review.js");
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
  // v8-0-plan B2: kept by the pass itself (review-pass.js runPass), which analyzeGame files
  assert(/bests\[i\] = e && typeof e\.best/.test(fnOf("runPass")), "the analyser keeps the engine's own move");
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

  // the app must build the id from the module, not from a loop index again
  // (v8-0-plan F4: read from every module but the one that owns the id)
  const appSrc = allSourceExcept("drills.js");
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
    for (const k of keys.concat("lm.tip2")) {
      assert(dicts[lang] && dicts[lang][k], k + " is written in " + lang);
    }
  }

  // every module but the one that derives the advice, and the dictionaries
  const appSrc = allSourceExcept("drills.js", "i18n.js", "i18n-en.js", "i18n-ja.js");
  // the wiring: the outcome line must actually carry the advice, and the
  // wording must live in the dictionary rather than being pasted into app.js
  assert(/ChessDrills\.drillAdvice\(/.test(appSrc), "drillOutcome asks drills.js for the technique");
  // (v8-2-plan F4: one template with both sentences in it, no longer a
  // separator key glued between them)
  assert(/tf\("lm\.tip2", \[t\(key\), t\(tip\)\]\)/.test(appSrc),
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
  const appSrc = allAppSource;
  assert(/p\.cat === "tac" && p\.motif === L\.practice/.test(appSrc),
    "app.js finds the practice puzzles by motif");
  assert(/id="lesson-practice"/.test(fs.readFileSync(path.join(root, "src/web/index.html"), "utf8")),
    "the lesson view has somewhere to press");
  // a lesson with no puzzles must offer no button rather than a dead one — the
  // whole P3 rule about visible disabled controls applies here too
  assert(/practice\.hidden = !rest\.total/.test(appSrc),
    "a lesson with no matching puzzles hides the button instead of disabling it");
  // 9.0 S3: there is no tier filter left to hide the puzzle the jump promised
  assert(!/puzzleTierFilter/.test(appSrc),
    "no difficulty filter stands between the jump and the puzzle it promised");
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
    const accFrom = srcOf("accuracyFrom");
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
  // s is a fragment (fewer than MIN_JUDGED own moves): a side that made a
  // blunder is told about the blunder, a side that made none is told the
  // sample is too short — not that it plays excellently (audit F5)
  assert(R.verdictKey(s, "b") === "rv.verdict.tooShort", "a clean fragment is a fragment, not excellence");
  assert(R.verdictKey(null, "w") === null, "no summary yields no verdict");
  {
    // twenty own moves each, all clean: now it is a game and the verdict may speak
    const n = R.MIN_JUDGED * 2 * 2;
    const flat = new Array(n + 1).fill(0);
    const moves = new Array(n).fill("e4");
    const long = R.summarize(flat, moves, "w");
    assert(long.judged.w === R.MIN_JUDGED * 2 && long.judged.b === R.MIN_JUDGED * 2,
      "summarize counts the judged moves per side");
    assert(R.verdictKey(long, "b") === "rv.verdict.excellent", "a clean full game reads as excellent");
    assert(R.longEnough(long) && !R.longEnough(s), "the curve floor is the same sample floor");
    const two = R.summarize([0, 10, 0], ["e4", "e5"], "w");
    assert(R.verdictKey(two, "w") === "rv.verdict.tooShort" && R.verdictKey(two, "b") === "rv.verdict.tooShort",
      "1.e4 e5 earns nobody a level-up");
  }
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

// 为你出一题: the picker's three rungs, each firing only when its condition is
// really true — the reason the interface says out loud must never be a guess
{
  loadModule(ctx, "src/web/js/srs.js");
  loadModule(ctx, "src/web/js/picker.js");
  const S = ctx.ChessSrs;
  const P = ctx.ChessPicker;
  const BOOK = [
    { id: "a1", cat: "m1" }, { id: "a2", cat: "m1" },
    { id: "b1", cat: "win" }, { id: "b2", cat: "win" }, { id: "b3", cat: "win" },
    { id: "c1", cat: "def" }, { id: "c2", cat: "def" },
  ];
  const fresh = () => ({ v: 1, solved: {}, missed: {}, cat: "m1" });

  // 7.3 B1: 「和你水平相当」这一档只认真有评级的题。没有评级的那几类，
  // `ratingOf` 返回 null —— 这一档必须把 null 当成「不在这把尺上」，而不是
  // 当成 0 分（那会让它们挤满整条带子的下沿）。调用方（app.js isRatedCat）
  // owns 这个判断，所以这里验的是「null 被当回事」。
  {
    const st = fresh();
    st.rhist = [{ t: 1, r: 1500 }];
    const book = BOOK.concat([{ id: "r1", cat: "rep" }, { id: "o1", cat: "op" }]);
    const ratingOf = (p) => (p.cat === "rep" || p.cat === "op" ? null : 1500);
    const pick = P.pickNext(st, book, S, () => "mid", () => null, ratingOf, { lo: 1400, hi: 1600 });
    assert(pick.kind !== "rated" || (pick.cat !== "rep" && pick.cat !== "op"),
      "没有评级的题不会被「和你水平相当」挑中 —— null 不是 0 分",
      JSON.stringify(pick));
    // ……而真有评级的照旧挑得出来
    const only = P.pickNext(st, [{ id: "z1", cat: "win" }], S, () => "mid", () => null,
      () => 1500, { lo: 1400, hi: 1600 });
    assert(only.kind === "rated" && only.id === "z1", "有评级的题照旧挑得出来", JSON.stringify(only));
  }

  // rung 1: anything due beats everything else, and the queue's own order picks
  {
    const st = fresh();
    st.missed.b2 = { s: 0, n: 2 };
    st.missed.c1 = { s: 1, n: 1 };
    const r = P.pickNext(st, BOOK, S);
    assert(r.kind === "review" && r.due === 2, "the queue outranks every recommendation (" + r.kind + ", 欠 " + r.due + ")");
    assert(r.id === "b2", "…and the least-learned one comes first (" + r.id + ")");
    // 6.0 review: a puzzle solved once today is owed by count but scheduled
    // for tomorrow — the smart pick must not serve it again at once
    const st4 = fresh();
    const T = 1_700_000_000_000;
    st4.missed.b2 = S.onSolve(S.onMiss(undefined, T), T);
    assert(P.pickNext(st4, BOOK, S, undefined, undefined, undefined, null, T + 1000).kind !== "review",
      "a puzzle due tomorrow is not served today by the smart pick");
    assert(P.pickNext(st4, BOOK, S, undefined, undefined, undefined, null, T + S.DAY + 1).kind === "review",
      "…and is served once its day has come");
  }
  // rung 2: a weakness needs MIN_ATTEMPTS answers AND at least one miss
  {
    const st = fresh();
    for (let i = 0; i < P.MIN_ATTEMPTS; i++) P.recordAnswer(st, "def", true);
    P.recordAnswer(st, "win", false);
    const r = P.pickNext(st, BOOK, S);
    assert(r.kind === "weak" && r.cat === "def", "the worst lifetime miss rate wins (" + r.cat + ")");
    assert(r.id === "c1", "…serving that category's first unsolved puzzle");
    // below the attempt floor the same misses are noise, not a verdict
    const st2 = fresh();
    for (let i = 0; i < P.MIN_ATTEMPTS - 1; i++) P.recordAnswer(st2, "def", true);
    assert(P.pickNext(st2, BOOK, S).kind === "explore",
      P.MIN_ATTEMPTS - 1 + " 次作答还不够下「你最弱」的结论 — falls through to explore");
    // …and a category with many answers but zero misses is never "weak"
    const st3 = fresh();
    for (let i = 0; i < 5; i++) P.recordAnswer(st3, "win", false);
    assert(P.pickNext(st3, BOOK, S).kind === "explore", "all-solves history is strength, not weakness");
  }
  // a weak category with nothing left to serve falls out of the running
  {
    const st = fresh();
    for (let i = 0; i < 4; i++) P.recordAnswer(st, "def", true);
    st.solved.c1 = true; st.solved.c2 = true;
    const r = P.pickNext(st, BOOK, S);
    assert(r.kind !== "weak" || r.cat !== "def", "a fully-solved category cannot be recommended (" + r.kind + ")");
  }
  // 5.2 · rung 2a: a motif the player keeps missing outranks a weak shelf
  {
    const MOTIF = { a1: null, a2: null, b1: "fork", b2: "pin", b3: "fork", c1: null, c2: null };
    const motifOf = (p) => MOTIF[p.id];
    const st = fresh();
    for (let i = 0; i < P.MIN_ATTEMPTS; i++) P.recordAnswer(st, "win", true, "fork");
    P.recordAnswer(st, "def", true);   // one miss on def: below the floor, noise
    assert(P.motifTally(st, "fork").miss === P.MIN_ATTEMPTS && P.catTally(st, "win").miss === P.MIN_ATTEMPTS,
      "an answer lands in the shelf tally and the motif tally at once");
    assert(P.weakestMotif(st, ["fork", "pin"]).motif === "fork", "the worst motif rate wins by the same rule");
    const r = P.pickNext(st, BOOK, S, null, motifOf);
    assert(r.kind === "motif" && r.motif === "fork" && r.id === "b1",
      "a weak motif is served with an unsolved puzzle about it (" + r.kind + "/" + r.id + ")");
    const withMine = BOOK.concat([{ id: "m1", cat: "mine" }]);
    const r2 = P.pickNext(st, withMine, S, null, (p) => (p.id === "m1" ? "fork" : MOTIF[p.id]));
    assert(r2.id === "m1", "…and the player's own drill about it comes before a canned one");
    st.solved.b1 = true; st.solved.b3 = true;
    assert(P.pickNext(st, BOOK, S, null, motifOf).kind !== "motif", "a motif with nothing left to serve falls out");
    assert(P.pickNext(st, BOOK, S).kind !== "motif", "without a motif reader the rung does not exist");
  }
  // rung 3: no usable history → least-covered category, first unsolved
  {
    const st = fresh();
    st.solved.a1 = true; st.solved.a2 = true; st.solved.b1 = true;
    const r = P.pickNext(st, BOOK, S);
    assert(r.kind === "explore" && r.cat === "def" && r.id === "c1",
      "with no history it widens coverage: least-touched category first (" + r.cat + ")");
  }
  // rung 4: a fully solved book says so instead of inventing a pick
  {
    const st = fresh();
    for (const p of BOOK) st.solved[p.id] = true;
    assert(P.pickNext(st, BOOK, S).kind === "done", "an exhausted book is reported, not papered over");
  }
  // M3 评审 P2-1: a queued bank puzzle is for the review rung only. Handed to
  // the other rungs it was picked as "weak"/"rated"/"explore" by its own cat,
  // then looked up in a list it is not in — a different puzzle was served
  // and the book never reported done.
  {
    const T = Date.parse("2026-09-30T12:00:00Z");
    const bank = [{ id: "lc-abc", cat: "tac", src: "lichess", rating: 1500 }];
    const st = fresh();
    for (const p of BOOK) st.solved[p.id] = true;
    st.missed["lc-abc"] = { s: 0, n: 1, due: T + S.DAY, ivl: 0 };
    assert(P.pickNext(st, BOOK, S, null, null, null, null, T, bank).kind === "done",
      "a whole book solved is still done while a bank puzzle waits for tomorrow");
    st.missed["lc-abc"].due = T - 1;
    const r = P.pickNext(st, BOOK, S, null, null, null, null, T, bank);
    assert(r.kind === "review" && r.id === "lc-abc", "…and a due one is served by the review rung", JSON.stringify(r));
    const st2 = fresh(); st2.missed["lc-abc"] = { s: 0, n: 1, due: T + S.DAY, ivl: 0 };
    const rated = P.pickNext(st2, BOOK, S, null, null, (p) => p.rating || null, { lo: 1400, hi: 1600 }, T, bank);
    assert(rated.id !== "lc-abc", "the rating rung never picks a queued bank puzzle", JSON.stringify(rated));
  }
  // the tally survives what the queue forgets: graduation deletes the entry,
  // the lifetime record keeps the miss — this is the whole reason it exists
  {
    const st = fresh();
    st.missed.c1 = S.onMiss(undefined); P.recordAnswer(st, "def", true);
    let e = S.onSolve(st.missed.c1); e = S.onSolve(e);
    assert(e === null, "the puzzle graduates out of the queue");
    delete st.missed.c1;
    assert(P.catTally(st, "def").miss === 1, "…but the tally still remembers the miss");
  }
  // the two write points in app.js actually feed the tally — a picker whose
  // memory nobody writes would quietly degrade into the explore rung forever
  {
    const appSrc = allAppSource;
    const missBody = srcOf("markMissed");
    assert(missBody.includes("Picker.recordAnswer") && missBody.includes("true"),
      "markMissed writes the miss into the lifetime tally");
    assert(/misses === 0 && !store\.session\.puzzle\.usedAnswer[\s\S]{0,200}Picker\.recordAnswer\(store\.session\.puzzleState, store\.session\.puzzle\.p\.cat, false, motifKeyOf\(store\.session\.puzzle\.p\)\)/.test(appSrc),
      "a clean first solve writes the solve — and only a clean one");
  }

  // the weak rung climbs from the bottom: told "you struggle here", the next
  // move must not be the category's hardest member
  {
    const st = fresh();
    for (let i = 0; i < P.MIN_ATTEMPTS; i++) P.recordAnswer(st, "win", true);
    const tierOf = (p) => ({ b1: "hard", b2: "mid", b3: "easy" })[p.id];
    const r = P.pickNext(st, BOOK, S, tierOf);
    assert(r.kind === "weak" && r.id === "b3", "弱项类内先端最容易的一道(" + r.id + ")");
    // without tierOf the book order stands — the parameter is opt-in
    assert(P.pickNext(st, BOOK, S).id === "b1", "不带 tierOf 时仍是册序");
  }
  // weakest() is exported because two surfaces speak about weakness — the
  // toast and the record page marker — and they must read one rule
  {
    const st = fresh();
    for (let i = 0; i < 4; i++) P.recordAnswer(st, "def", true);
    P.recordAnswer(st, "win", false);
    const w = P.weakest(st, ["m1", "win", "def"]);
    assert(w && w.cat === "def", "weakest() 独立可调,答案与选题一致");
    const appSrc2 = allAppSource;
    assert(/renderPuzzleTally[\s\S]{0,1200}Picker\.weakest\(/.test(appSrc2),
      "记录页的「错得最多」标记读的是同一个 Picker.weakest");
    assert(/puzzle-review-nudge[\s\S]{0,400}store\.session\.puzzle\.done && owed > 0/.test(appSrc2),
      "解后复习提示只在「做完了且队列欠着」时画 — 不适用则不画");
  }

  // recordAnswer tolerates the states written before it existed
  {
    const st = { v: 1, solved: {}, missed: {} };  // no tally field at all
    P.recordAnswer(st, "m1", false);
    assert(st.tally.m1.solve === 1 && st.tally.m1.miss === 0, "a pre-2.4 state grows the tally in place");
  }
}

// 执黑背谱: every opening line gets a Black sibling that rides the existing
// rails (solved keys, review queue, picker) under a new `:b` id, and every
// place that assumed "the solver is White" now reads the puzzle's side.
{
  const appSrc = allAppSource;
  // the sibling set: same lines, `:b` ids (so nobody's White progress moves),
  // and both sets are in the one book every rail iterates
  assert(/OPENING_DRILLS_B = OPENING_DRILLS\.map\(\(d\) => Object\.assign\(\{\}, d, \{ id: d\.id \+ ":b", side: "b" \}\)\)/.test(appSrc),
    "the Black set is the White set under `:b` ids, nothing re-transcribed");
  assert(/ALL_PUZZLES = PUZZLES\.concat\(OPENING_DRILLS, OPENING_DRILLS_B\)/.test(appSrc),
    "both chairs are in the book every rail iterates");
  // one chair shown at a time, picked by the side segment
  assert(/cat === "op" \? ALL_PUZZLES\.filter\(\(p\) => p\.cat === "op" && \(p\.side === "b"\) === \(store\.session\.puzzleState\.opSide === "b"\)\)/.test(appSrc),
    "the op list shows the chair the side segment picked");
  // playing Black: the app opens with White's book move before you answer
  assert(/isOpeningCat\(p\.cat\) && p\.side === "b"[\s\S]{0,200}g\.move\(p\.line\[0\]\)[\s\S]{0,200}stage = 1/.test(appSrc),
    "a Black drill opens with White's first book move already played");
  // the board faces the chair you sit in
  assert(/flipped: store\.session\.puzzle\.p\.side === "b"/.test(appSrc),
    "puzzleModel flips the board for Black drills");
  // input, answer arrow and the hint slot all ask the same question
  assert(/function puzzleHumanSide\(\)/.test(appSrc) &&
    /function puzzleClick\(sq\) \{[\s\S]{0,200}g\.turn\(\) !== puzzleHumanSide\(\)/.test(appSrc) &&
    /piece\.color === puzzleHumanSide\(\)/.test(appSrc) &&
    /function showPuzzleAnswer\(\) \{[\s\S]{0,200}g\.turn\(\) !== puzzleHumanSide\(\)/.test(appSrc),
    "clicks, selection and the answer arrow all read the solver's chair from the puzzle");
  // 接实战 keeps the chair — retired from the register in 7.2 and replaced by
  // a behavioural test (scripts/test-library-e2e.mjs 第 10 组: 「接实战」把刚
  // 背完的那条线带上棋盘). This is the register's whole argument, demonstrated:
  // the regex matched an expression that ran AFTER stopPuzzles() had nulled
  // the object it reads, so the assertion passed for three versions while the
  // button threw on every press.
  // the badge kept its meaning: op achievements count the White set only
  assert(/opSolved[\s\S]{0,120}p\.side !== "b"/.test(appSrc) || /side !== "b"[\s\S]{0,240}opSolved/.test(appSrc),
    "achievement totals still mean the White book — doubling them silently would cheapen earned badges");
  // 为你出一题 can serve a pick from the hidden chair
  assert(/isOpeningCat\(picked\.cat\)[\s\S]{0,120}opSide = picked\.side === "b" \? "b" : "w"/.test(appSrc),
    "the recommender switches chairs so its pick is always servable");
  // the side row is drawn only where there are two chairs (P3: absent, not greyed)
  assert(/function syncOpSideSeg\(cat\) \{[\s\S]{0,120}avail\(el\("row-op-side"\), isOpeningCat\(cat\)\)/.test(appSrc),
    "the 执白/执黑 row exists only in the opening category");
  const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
  assert(/id="op-side-seg"[\s\S]{0,400}data-side="w"[\s\S]{0,400}data-side="b"/.test(html),
    "the side segment offers exactly the two chairs");
}

// 错题自炼: the review pass's own judgement becomes the player's personal
// book. The miner is pure (analysis arrays in, drills out) so it is tested
// directly; the wiring — who may write the book, who reads it, and who is
// forbidden from reading it — is held by source guards.
{
  loadModule(ctx, "src/web/js/mistakes.js");
  const M = ctx.ChessMistakes;
  const C = ctx.Chess;
  // a real two-ply game so every fen/san/best is a legal chess fact
  const g = new C();
  const fens = [g.fen()];
  const sans = ["e4", "e5"];
  for (const m of sans) { g.move(m); fens.push(g.fen()); }
  // losses are the CALLER's, already clamped to the eval window — 7.1 moved
  // that arithmetic out of this module (v7-1-plan C4)
  const base = { fens, sans, tags: ["??", "??"], bests: ["g1f3", "g8f6"],
    scalars: [30, -370, 20], losses: [400, 390] };

  // only the asked-for side is mined, and the answer is the engine's move in SAN
  const w = M.candidatesFrom(base, "w", C);
  assert(w.length === 1 && w[0].solution[0] === "Nf3" && w[0].played === "e4",
    "a White ?? becomes a drill whose answer is the engine's move");
  assert(w[0].loss === 400, "the cost is the same arithmetic the tag came from (" + w[0].loss + ")");
  assert(w[0].side === undefined && w[0].cat === "mine" && w[0].fen === fens[0],
    "the drill is an ordinary puzzle at the position the mistake was played from");
  const b = M.candidatesFrom(base, "b", C);
  assert(b.length === 1 && b[0].solution[0] === "Nf6" && b[0].side === "b" && b[0].loss === 390,
    "a Black ?? flips the sign and carries side:\"b\" — the black-drill rails do the rest");

  // what is NOT mined: ?! plies, plies without a stored best, best === played.
  // v10-0-plan T2: a ? is a lesson too (100–300 cp) — only the ?! stays out
  assert(M.candidatesFrom({ ...base, tags: ["?!", "??"] }, "w", C).length === 0,
    "a ?! is not a lesson — only ? and ?? plies are banked");
  assert(M.candidatesFrom({ ...base, tags: ["?", "??"] }, "w", C).length === 1,
    "T2: a ? becomes a drill like a ??");
  // T2: the new arrivals are named, and queued for review once each
  {
    const r = M.addMines([], w, 5000, new Set());
    assert(r.ids.length === 1 && r.ids[0] === w[0].id, "T2: addMines names what it added (" + r.ids + ")");
    const missed = {};
    const onMiss = (v, now) => ({ s: 0, n: 1, due: now, ivl: 0 });
    assert(M.queueFresh(missed, r.ids, 5000, onMiss) === 1 && missed[w[0].id].due === 5000,
      "T2: a new drill is owed a review at once");
    missed[w[0].id] = { s: 1, n: 2, due: 9000, ivl: 1 };
    assert(M.queueFresh(missed, r.ids, 6000, onMiss) === 0 && missed[w[0].id].due === 9000,
      "T2: …and one already in the queue keeps its place on the ladder");
    assert(M.addMines(r.list, w, 7000, new Set()).ids.length === 0, "T2: the same drill again adds nothing to queue");
  }
  assert(M.candidatesFrom({ ...base, bests: [null, "g8f6"] }, "w", C).length === 0,
    "a judgement without a stored answer is not a drill");
  assert(M.candidatesFrom({ ...base, bests: ["e2e4", "g8f6"] }, "w", C).length === 0,
    "best === played can happen on a lost position — nothing to teach, skip");

  // a pass that hands over no losses still mints drills — they just carry no
  // cost figure, the same as a terminal ply always has
  {
    const noLoss = M.candidatesFrom({ ...base, losses: undefined }, "w", C);
    assert(noLoss.length === 1 && noLoss[0].loss === null,
      "no losses from the caller → a drill with no cost, not a wrong cost");
    const mate = M.candidatesFrom({ ...base, losses: [1000, 390] }, "w", C);
    assert(mate[0].loss === 1000,
      "a thrown-away mate costs the most the scale can express, not 99.5 pawns",
      String(mate[0].loss));
  }

  // the id is the position and the sin, not the game — re-analysis dedups
  assert(M.mineId(fens[0], "e4") === M.mineId(fens[0], "e4") &&
         M.mineId(fens[0], "e4") !== M.mineId(fens[0], "d4"),
    "ids are stable per (position, played) and distinct across moves");
  {
    const once = M.addMines([], w, 1000, new Set());
    const twice = M.addMines(once.list, w, 2000, new Set());
    assert(once.added === 1 && twice.added === 0 && twice.list.length === 1,
      "re-analysing the same game banks nothing twice");
  }
  // the cap retires solved drills first, then the oldest, and reports what left
  {
    const many = [];
    for (let i = 0; i < M.MAX_MINES; i++) many.push({ id: "mine:x" + i, cat: "mine", fen: "f", solution: ["a"], t: i });
    const r = M.addMines(many, [{ id: "mine:new", cat: "mine", fen: "f2", solution: ["b"] }], 9999,
      new Set(["mine:x5"]));
    assert(r.list.length === M.MAX_MINES && r.dropped.length === 1 && r.dropped[0] === "mine:x5",
      "over the cap, a solved drill retires before any unsolved one");
    const r2 = M.addMines(r.list, [{ id: "mine:new2", cat: "mine", fen: "f3", solution: ["c"] }], 10000, new Set());
    assert(r2.dropped[0] === "mine:x0", "with nothing solved, the oldest retires");
  }
  // 7.1 §6.3 (v7-1-plan §1.2): a bulk import must not evict every motif the
  // player had been working on. One import is one batch with one timestamp,
  // and the old oldest-first rule walked straight through them.
  {
    const MOTIFS = ["fork", "pin", "skewer", "discovered"];
    const book = [];
    for (let i = 0; i < M.MAX_MINES; i++) {
      book.push({ id: "mine:old" + i, cat: "mine", fen: "f" + i, solution: ["a"],
        motif: MOTIFS[i % MOTIFS.length], t: 1000 + i });
    }
    // 200 fresh drills, all one motif, all stamped with the same import time
    const flood = [];
    for (let i = 0; i < 200; i++) {
      flood.push({ id: "mine:new" + i, cat: "mine", fen: "n" + i, solution: ["b"], motif: "fork" });
    }
    const r = M.addMines(book, flood, 99999, new Set());
    assert(r.list.length === M.MAX_MINES, "上限照旧是上限", String(r.list.length));
    const left = {};
    for (const m of r.list) left[m.motif] = (left[m.motif] || 0) + 1;
    for (const k of MOTIFS) {
      if (k === "fork") continue;
      assert(left[k] >= M.KEEP_PER_MOTIF,
        "一次两百道的导入之后，「" + k + "」还留着它最近的 " + M.KEEP_PER_MOTIF + " 道",
        JSON.stringify(left));
    }
    // the ones kept are the NEWEST of each motif, not an arbitrary few
    const pins = r.list.filter((m) => m.motif === "pin").map((m) => m.t).sort((a, b) => b - a);
    const allPins = book.filter((m) => m.motif === "pin").map((m) => m.t).sort((a, b) => b - a);
    assert(pins[0] === allPins[0], "留下的是这个母题最近的那些，不是随便几道");
    // and the quota is a preference, not a guarantee: the cap still wins
    const onlyOne = [];
    for (let i = 0; i < M.MAX_MINES; i++) {
      onlyOne.push({ id: "mine:z" + i, cat: "mine", fen: "z" + i, solution: ["a"], motif: "fork", t: i });
    }
    const r2 = M.addMines(onlyOne, [{ id: "mine:zz", cat: "mine", fen: "zz", solution: ["c"], motif: "fork" }],
      50000, new Set());
    assert(r2.list.length === M.MAX_MINES && r2.dropped.length === 1,
      "所有幸存者都在配额里的时候，上限依然是上限", JSON.stringify(r2.dropped));
  }

  // --- 5.1: a deeper pass may correct or withdraw what a quick pass banked --
  {
    const g = new C(); const fen = g.fen();
    const quick = M.drillFrom(fen, "e4", "g1f3", 310, 0, C, { budget: 120, src: "auto" });
    const book = M.addMines([], [quick], 1000, new Set()).list;
    assert(book[0].rev && book[0].rev.budget === 120, "a drill remembers the budget that minted it");
    // the deep pass prefers d4 and finds the loss smaller
    const deep = M.drillFrom(fen, "e4", "d2d4", 150, 0, C, { budget: 400, src: "auto" });
    const rv = M.reviseMines(book, [deep], null, "w", { budget: 400 });
    assert(rv.updated.length === 1 && rv.list[0].solution[0] === "d4" && rv.list[0].loss === 150 &&
           rv.list[0].rev.budget === 400 && rv.list[0].id === quick.id && rv.list[0].t === 1000,
      "a deeper pass corrects the answer in place — same id, same arrival, new answer sheet");
    // …and a shallower pass may not
    const shallow = M.drillFrom(fen, "e4", "c2c4", 90, 0, C, { budget: 60, src: "auto" });
    const rv2 = M.reviseMines(rv.list, [shallow], null, "w", { budget: 60 });
    assert(rv2.updated.length === 0 && rv2.list[0].solution[0] === "d4", "a quick pass never overrules a deep one");
    // the same game re-analysed deeper, and e4 is no longer a mistake: the drill goes
    const rv3 = M.reviseMines(rv.list, [], { fens: [fen], sans: ["e4"], tags: ["?!"] }, "w", { budget: 400 });
    assert(rv3.retired.length === 1 && rv3.list.length === 0, "a ?? that does not survive the depth is withdrawn");
    // …while a ?? that the deeper pass calls a ? stays (10.0 T2: both are drills)
    const rvQ = M.reviseMines(rv.list, [], { fens: [fen], sans: ["e4"], tags: ["?"] }, "w", { budget: 400 });
    assert(rvQ.retired.length === 0 && rvQ.list.length === 1, "T2: a ?? the deeper pass calls a ? stays a drill");
    // and the same at a shallower depth is not believed
    const rv4 = M.reviseMines(rv.list, [], { fens: [fen], sans: ["e4"], tags: ["?!"] }, "w", { budget: 120 });
    assert(rv4.retired.length === 0, "…but only from a pass at least as deep");
    // 7.2: and the commonest verdict of all — "that move was fine", which is
    // a null tag — withdraws it too, as long as the pass really did measure
    // the ply. Until 7.2 a null tag was read as "never measured", so the
    // deeper pass could only withdraw a ?? it had downgraded to ? or ?!.
    const clean = { fens: [fen, "x"], sans: ["e4"], tags: [null], scalars: [20, 25] };
    const rv5 = M.reviseMines(rv.list, [], clean, "w", { budget: 400 });
    assert(rv5.retired.length === 1 && rv5.list.length === 0,
      "深一趟说「这一手没问题」，那道题也该撤 —— 这才是撤销里最常见的一种");
    // …but a ply the pass never reached still withdraws nothing: same null tag,
    // no evaluation behind it
    const unmeasured = { fens: [fen, "x"], sans: ["e4"], tags: [null], scalars: [20, null] };
    assert(M.reviseMines(rv.list, [], unmeasured, "w", { budget: 400 }).retired.length === 0,
      "没测到的那一手不算「没问题」—— 分数缺一头就什么都不说");
    assert(M.reviseMines(rv.list, [], { fens: [fen, "x"], sans: ["e4"], tags: [null] }, "w", { budget: 400 }).retired.length === 0,
      "连分数都没给的 pass，照旧只认显式的 ?/?!");
    // alternatives: accepted when they cost less than a mistake against the best
    assert(M.judgeAlt(50, 20, "w", 100).ok && M.judgeAlt(50, 20, "w", 100).loss === 30, "a move 30cp short of the best is accepted");
    assert(!M.judgeAlt(50, -80, "w", 100).ok, "a move 130cp short is not");
    assert(M.judgeAlt(-50, -20, "b", 100).loss === 30 && M.judgeAlt(-50, 80, "b", 100).ok === false &&
           M.judgeAlt(-50, -80, "b", 100).loss === 0,
      "the loss is read from the mover's side for Black too");
    const m = Object.assign({}, deep, { alts: ["c4"] });
    assert(M.isAccepted(m, "d4") && M.isAccepted(m, "c4") && !M.isAccepted(m, "e4"),
      "the stored best and a confirmed alternative are both answers; the sin is not");
  }
  // --- 5.1: learning data travels, and importing twice changes nothing ------
  {
    loadModule(ctx, "src/web/js/learning.js");
    const L = ctx.ChessLearning;
    const bag = {
      learn: JSON.stringify({ v: 1, done: { l1: true }, last: 3 }),
      puzzles: JSON.stringify({ v: 1, idv: 2, solved: { a: true }, missed: { b: { s: 1, n: 1, due: 5, ivl: 1 } }, tally: { m1: 4 } }),
      mines: JSON.stringify({ v: 1, list: [{ id: "mine:1", cat: "mine", fen: "f", solution: ["a"], t: 1, rev: { budget: 120 } }] }),
      progress: null, achievements: JSON.stringify({ seen: ["first"] }),
      stats: JSON.stringify({ v: 2, games: [{ id: "g1", t: 10 }] }),
    };
    const doc = L.pack(bag, 5);
    assert(L.isLearningDoc(doc) && Object.keys(doc.data).length === 5 && !("progress" in doc.data),
      "pack writes every stored learning key and skips the empty ones");
    assert(!L.isLearningDoc({ kind: "pgn" }) && !L.isLearningDoc(null), "a foreign file is refused");
    const other = {
      kind: doc.kind, v: 1, exportedAt: 6, data: {
        learn: { v: 1, done: { l2: true }, last: 1 },
        puzzles: { v: 1, solved: { c: true }, missed: { b: { s: 2, n: 2, due: 9, ivl: 3 } }, tally: { m1: 2, m2: 9 } },
        mines: { v: 1, list: [{ id: "mine:1", cat: "mine", fen: "f", solution: ["z"], t: 1, rev: { budget: 400 } },
                             { id: "mine:2", cat: "mine", fen: "f2", solution: ["b"], t: 2 }] },
        achievements: { seen: ["second"] },
        stats: { v: 2, games: [{ id: "g2", t: 20 }] },
      } };
    const m1 = L.merge(bag, other, 50);
    assert(m1.learn.done.l1 && m1.learn.done.l2 && m1.learn.last === 3, "lessons done are unioned, the bookmark keeps the further one");
    assert(m1.puzzles.solved.a && m1.puzzles.solved.c && m1.puzzles.missed.b.s === 2 &&   // srs.js entries (M3 评审: this fixture used to carry a `streak` no entry has)
           m1.puzzles.tally.m1 === 4 && m1.puzzles.tally.m2 === 9,
      "solves union, the review entry further along wins, counters take the max and never the sum");
    assert(m1.mines.list.length === 2 && m1.mines.list.find((x) => x.id === "mine:1").solution[0] === "z",
      "the book unions by id and the deeper analysis wins a clash");
    assert(m1.stats.games.length === 2 && m1.achievements.seen.length === 2, "games and badges are unioned");
    const bag2 = {}; for (const k of Object.keys(m1)) bag2[k] = JSON.stringify(m1[k]);
    const m2 = L.merge(bag2, other, 50);
    assert(JSON.stringify(m2) === JSON.stringify(m1), "importing the same file again is a no-op");
    // #89 review: imported games count. Machine A: forty wins against 中级,
    // filed one by one; machine B (a new install): one loss against 新手.
    // B's stored rating (798) was kept, and the forty never counted.
    const O = ctx.Opponents, day = 86400000, t0 = Date.parse("2026-06-01");
    const filed = (games) => {
      const st = { v: 2, games: [] };
      for (const g of games) { O.fileRating(st, g, g.t); st.games.push(g); }
      return st;
    };
    const sA = filed(Array.from({ length: 40 }, (_, i) => ({ id: "a" + i, t: t0 + i * day, diff: "normal", result: "win" })));
    const sB = filed([{ id: "b0", t: t0 + 41 * day, diff: "beginner", result: "loss" }]);
    const ms = L.merge({ stats: JSON.stringify(sB) }, L.pack({ stats: JSON.stringify(sA) }, 5), 50).stats;
    const all = O.rateHistory(ms.games);
    assert(ms.games.length === 41 && Math.round(O.ratingOfStats(ms).r) === Math.round(all.r) && all.n === 41 &&
      Math.round(all.r) !== Math.round(sB.rating.r),
      "#89: games imported from another machine count — the merged rating replays all 41, not B's stored " +
      Math.round(sB.rating.r) + " (" + Math.round(O.ratingOfStats(ms).r) + " vs " + Math.round(all.r) + ")");
    const again = L.merge({ stats: JSON.stringify(sB) }, L.pack({ stats: JSON.stringify(sB) }, 6), 50).stats;
    assert(again.rating && Math.round(again.rating.r) === Math.round(sB.rating.r), "#89: …and an import that adds nothing keeps the stored rating");
  }
  // --- 7.4 D6: the repertoire travels with the reviews it is owed ----------
  {
    const L = ctx.ChessLearning;
    assert(L.LEARNING_KEYS.includes("repertoire"), "the repertoire is learning data — it goes in the file");
    // a line's id is repertoire.js's to mint (from the moves), so the test
    // asks it rather than inventing strings the merge would not reproduce
    loadModule(ctx, "src/web/js/repertoire.js");
    const repId = (sans) => ctx.ChessRepertoire.addLines([], [sans], null).lines[0].id;
    const A = repId("e4 e5 Nf3"), B = repId("d4 Nf6 c4"), SHORT = repId("e4 e5");
    // machine A: a book with one white and one black line, a review owed to
    // each, and one owed to a line A dropped long ago
    const book = { v: 1,
      w: [{ id: A, sans: "e4 e5 Nf3", eco: "C40", name: "王翼马" }],
      b: [{ id: B, sans: "d4 Nf6 c4", eco: "", name: "" }] };
    const bagA = {
      puzzles: JSON.stringify({ v: 1, idv: 2, solved: {}, tally: {},
        missed: { [A]: { streak: 1 }, [B + ":b"]: { streak: 0 }, "rep-gone": { streak: 0 }, "m1-3": { streak: 0 } } }),
      repertoire: JSON.stringify(book),
    };
    const doc = L.pack(bagA, 7);
    assert(doc.data.repertoire && doc.data.repertoire.w.length === 1,
      "pack carries the book, not just the reviews that point into it");
    // machine B has no book at all: after the import the book is there and
    // every review it can serve came with it — the orphan did not
    const mB = L.merge({ puzzles: null, repertoire: null }, doc, 50);
    assert(mB.repertoire && mB.repertoire.w[0].id === A && mB.repertoire.b[0].id === B,
      "the book arrives with its ids — the progress hanging off them still resolves",
      JSON.stringify(mB.repertoire));
    assert(mB.repertoire.w[0].eco === "C40", "…and its names", JSON.stringify(mB.repertoire.w[0]));
    const missedB = Object.keys(mB.puzzles.missed).sort();
    assert(JSON.stringify(missedB) === JSON.stringify(["m1-3", A, B + ":b"].sort()),
      "a rep- review whose line is not in the merged book is dropped; the rest stay (the :b chair included)",
      JSON.stringify(missedB));
    // a 7.3 file: reviews but no book. Merged onto a machine with no book,
    // the rep- reviews have nothing to be served from and do not come in
    const old = { kind: doc.kind, v: 1, exportedAt: 1, data: { puzzles: JSON.parse(bagA.puzzles) } };
    const mOld = L.merge({ puzzles: null, repertoire: null }, old, 50);
    assert(Object.keys(mOld.puzzles.missed).join() === "m1-3",
      "a file without a book brings no rep- reviews onto a machine without one",
      JSON.stringify(Object.keys(mOld.puzzles.missed)));
    // …and onto a machine that HAS the book, they are kept
    const mOld2 = L.merge({ puzzles: null, repertoire: JSON.stringify(book) }, old, 50);
    assert(A in mOld2.puzzles.missed && !("rep-gone" in mOld2.puzzles.missed),
      "onto a machine that has the book, the reviews it can serve are kept");
    // the two books merge by the book's own rules: a deeper line replaces the
    // shorter one, and the review owed to the shorter id goes with it
    const bagC = {
      puzzles: JSON.stringify({ v: 1, solved: { [SHORT]: 1, "m1-3": 1 }, tally: {}, missed: { [SHORT]: { streak: 0 } } }),
      repertoire: JSON.stringify({ v: 1, w: [{ id: SHORT, sans: "e4 e5", eco: "", name: "" }], b: [] }),
    };
    const mC = L.merge(bagC, doc, 50);
    assert(mC.repertoire.w.length === 1 && mC.repertoire.w[0].sans === "e4 e5 Nf3",
      "a deeper incoming line replaces the shorter local one", JSON.stringify(mC.repertoire.w));
    assert(!(SHORT in mC.puzzles.missed), "…and the review owed to the replaced line goes too");
    // Codex review on #76: `solved` needs the same filter, or re-importing the
    // short line later would show it done without ever having been practised
    assert(!(SHORT in mC.puzzles.solved) && mC.puzzles.solved["m1-3"] === 1,
      "…and so does its solved mark — only the rep- id, nothing else", JSON.stringify(mC.puzzles.solved));
    const bagC2 = {}; for (const k of Object.keys(mC)) bagC2[k] = JSON.stringify(mC[k]);
    assert(JSON.stringify(L.merge(bagC2, doc, 50)) === JSON.stringify(mC),
      "importing the same file again is still a no-op with a book in it");
  }

  // --- the wiring ---------------------------------------------------------
  const appSrc = allAppSource;
  // the book every serving rail reads is the live one…
  // 6.0: two more arguments — the rating of a puzzle and the player's band
  // v8-1-plan T6: the queued bank puzzles whose bands are here go to the review rung only (M3 评审 P2-1)
  assert(/const pick = Picker\.pickNext\(store\.session\.puzzleState, bookNow\(\), Srs, puzzleTier, motifKeyOf,\s*puzzleRatingOf[^;]*reviewBank\(\)\)/.test(appSrc),
    "为你出一题 reads the live book — a mined drill can be recommended");
  // 6.0: the queue is what is due today (srs.js dueQueue), each id looked up in the live book
  // (M3 评审: through bank-review.js reviewList, which gives slots only to what can be served)
  assert(/function bookFinder\(\) \{\s*const m = new Map\(bookNow\(\)\.map[\s\S]*\? Bank\.reviewList\(store\.session\.puzzleState, Date\.now\(\), REVIEW_CAP, bookFinder\(\)\)/.test(appSrc),
    "the review queue reads the live book — a missed drill comes back due");
  // …and the achievements deliberately do not
  const achBlock = /const solvedIn[\s\S]{0,1400}opTotal:[^\n]*\n/.exec(appSrc);
  assert(achBlock && !achBlock[0].includes("bookNow") && achBlock[0].includes("ALL_PUZZLES"),
    "achievement totals stay on the frozen book — badges must not drift with a set that retires itself");
  // mining happens where the judgement is born, for the player's side only
  assert(/if \(store\.session\.mode === "ai"\) \{[\s\S]{0,900}Mistakes\.candidatesFrom\(pass, store\.session\.humanColor, Chess, rev\)/.test(appSrc) &&
         /const pass = \{ fens, sans: h, tags, bests, scalars, pvs, losses: plyLosses\(fens, scalars\) \}/.test(appSrc),
    "analyzeGame banks the human side's ?? plies, and only in games with a human side");
  // 7.1 C4: the drill's cost comes from the one clamped routine, not from a
  // third copy of the subtraction (v7-1-plan §3.4)
  assert(/const raw = a\.losses \? a\.losses\[i\] : null;/
           .test(fs.readFileSync(path.join(root, "src/web/js/mistakes.js"), "utf8")),
    "mistakes.js takes the loss from the caller — the clamp has one home");
  // 5.1: …after letting the pass revise what the book already says about this
  // game — corrected answers and withdrawn ?? — through the same module
  assert(/Mistakes\.reviseMines\(store\.session\.mines, cands, pass, store\.session\.humanColor, rev\)/.test(appSrc) &&
         /Mistakes\.addMines\(rv\.list, cands, Date\.now\(\), solvedIds\)/.test(appSrc),
    "a deeper pass revises the book before extending it (audit F2)");
  // 7.1: and the library's pass banks them too — v7-plan §6.3, which 7.0
  // shipped without and then recorded in neither of §10's two tables
  // 7.2 (P2): 棋谱库那一整块搬进了 library-ui.js，这两条跟着它走 —— 也因此
  // 不再算在 app.js 的登记册里
  const libUiSrc = fs.readFileSync(path.join(root, "src/web/js/library-ui.js"), "utf8");
  assert(/run\.mined \+= mineLibraryGame\(next, r\.pass, LIB_BUDGET\)\.added/.test(libUiSrc),
    "每分析完一局棋谱库的棋，就把这一局的失误收进错题本");
  assert(/function mineLibraryGame[\s\S]{0,900}Mistakes\.reviseMines\(store\.session\.mines, cands, pass, entry\.side, rev\)[\s\S]{0,300}Mistakes\.addMines\(rv\.list, cands, Date\.now\(\), solvedIds\)/.test(libUiSrc),
    "棋谱库走的是和棋盘同一套规则，先修正再扩充，不是第二份实现");
  assert(/withMotifs\(Mistakes\.candidatesFrom\(/.test(appSrc),
    "每道错题带着它的母题 —— 分层保留靠它，否则一次导入会冲掉一整类");
  assert(/Mistakes\.isAccepted\(p, mv\.san\)/.test(appSrc) && /Mistakes\.judgeAlt\(cpBest, cpAlt, side, Review\.MISTAKE\)/.test(appSrc),
    "a personal drill accepts a verified alternative, not only the stored string (audit F3)");
  assert(/for \(const id of r\.dropped\) \{\s*delete store\.session\.puzzleState\.solved\[id\];\s*delete store\.session\.puzzleState\.missed\[id\];/.test(appSrc),
    "a retired drill takes its solved/missed entries with it — no orphan reviews owed");
  // the tab exists exactly while the book does (P3), and the cat is real
  // v10-0-plan T2: the tile is always there; empty, it says how it fills
  assert(!/if \(g === "mine"\) b\.hidden/.test(appSrc) && /g === "mine" && !n \? t\("pz\.mineNone"\)/.test(appSrc),
    "T2: the 我的错题 tile is always drawn, and says how it fills while empty");
  assert(/"op", "rep", "mine", "review"\]/.test(appSrc) && /real: true, mine: true \}/.test(appSrc),
    "mine is a real category on the scripted-grading rail");
  assert(/\(cat === "review" \|\| cat === "mine" \|\| cat === "rep"\) && !puzzlesInCat\(cat\)\.length/.test(appSrc),
    "an emptied personal book does not strand the player");
  const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
  assert(/data-group="mine" aria-pressed/.test(html), "T2: …and the tile is not hidden in the page either");
}

// 摸得到的复盘: hovering the move list or a PV chip puts that position on the
// board; the curve can be scrubbed; the turning point can be banked by hand.
// The one pure piece — drillFrom — is tested directly; everything that wires
// a pointer to the board is held by source guards.
{
  loadModule(ctx, "src/web/js/mistakes.js");
  const M = ctx.ChessMistakes;
  const C = ctx.Chess;
  const g = new C();
  const fen = g.fen();

  // one rule, two callers: the hand-banked drill IS the auto-mined drill
  const hand = M.drillFrom(fen, "e4", "g1f3", 412.4, 0, C);
  assert(hand && hand.solution[0] === "Nf3" && hand.loss === 412 && hand.ply === 0,
    "drillFrom mints a drill from one judged ply (answer in SAN, loss rounded)");
  const auto = M.candidatesFrom({ fens: [fen, new C(fen).move("e4") && "x"], sans: ["e4"],
    tags: ["??"], bests: ["g1f3"], scalars: [30, -370] }, "w", C)[0];
  assert(auto && auto.id === hand.id && auto.solution[0] === hand.solution[0],
    "auto-mined and hand-banked drills for the same mistake share one id — dedup rests on this");
  // …and that id is a function of (position, played move) ONLY. Sharing one
  // code path made the assertion above tautological; this one is not: a drill
  // keyed on the answer would re-mint the same mistake whenever a deeper pass
  // changed the engine's preference.
  assert(hand.id === M.mineId(fen, "e4"),
    "the id is derived from the position and the sin, never from the answer");
  assert(M.drillFrom(fen, "e4", "e2e4", 100, 0, C) === null,
    "best === played teaches nothing, and mints nothing");
  assert(M.drillFrom(fen, "e4", null, 100, 0, C) === null, "no stored best, no drill");
  {
    const gb = new C(); gb.move("e4");
    const d = M.drillFrom(gb.fen(), "e5", "c7c5", 90, 1, C);
    assert(d && d.side === "b" && d.solution[0] === "c5",
      "a black-to-move ply carries side:\"b\" — the flipped-board rails read it");
  }

  // 7.2 A2: the drill remembers the game it came from, on both paths
  {
    const libD = M.drillFrom(fen, "e4", "g1f3", 300, 0, C, { budget: 200, src: "lib", from: { kind: "lib", id: "L1" } });
    assert(libD.from && libD.from.kind === "lib" && libD.from.id === "L1",
      "一道从棋谱库挖出来的错题记得它是库里哪一局");
    const gameD = M.drillFrom(fen, "e4", "g1f3", 300, 0, C, { budget: 200, src: "auto", from: { kind: "game", id: "r7" } });
    assert(gameD.from && gameD.from.kind === "game" && gameD.from.id === "r7",
      "棋盘上挖出来的那条路同样记得它是哪一条战绩");
    // no source is a legal state — the board path has none until the game is
    // filed, and every drill banked before 7.2 has none either
    assert(M.drillFrom(fen, "e4", "g1f3", 300, 0, C, { budget: 200, src: "auto" }).from === undefined,
      "没有来源就是没有来源 —— 不编一个出来");
    // …and a revision does not lose it: reviseMines replaces `rev` wholesale,
    // which is exactly why the source does not live inside `rev`
    const book = [libD];
    const deeper = M.drillFrom(fen, "e4", "d2d4", 150, 0, C, { budget: 400, src: "lib", from: { kind: "lib", id: "L1" } });
    const rv = M.reviseMines(book, [deeper], null, "w", { budget: 400, src: "lib" });
    assert(rv.list[0].solution[0] === "d4" && rv.list[0].from && rv.list[0].from.id === "L1",
      "精析改了答案，来源还在 —— 来源不是判断的一部分");
    // a drill banked before 7.2 learns its source from the next pass that meets it
    const old7 = M.drillFrom(fen, "e4", "g1f3", 300, 0, C, { budget: 200, src: "auto" });
    const again = M.reviseMines([old7], [libD], null, "w", { budget: 200, src: "lib" });
    assert(again.list[0].from && again.list[0].from.id === "L1" && again.filled.length === 1,
      "7.2 之前存下的老题，下一趟遇见它时补上来源");
    // …but never overwritten: the first game to mine a position stays its answer
    const other = M.drillFrom(fen, "e4", "g1f3", 300, 0, C, { budget: 200, src: "lib", from: { kind: "lib", id: "L2" } });
    const keep = M.reviseMines([libD], [other], null, "w", { budget: 200, src: "lib" });
    assert(keep.list[0].from.id === "L1" && keep.filled.length === 0,
      "同一个局面再被别的一局挖到，来源仍然是第一局");
  }

  const appSrc = allAppSource;
  // the preview: held under the pointer, never over a drag, and the trainer
  // modes return before it so it can only ever replace the plain game view
  const modelFn = /BoardView\.attach\(canvas[\s\S]{0,700}store\.ui\.preview && !store\.ui\.dragging/.exec(appSrc);
  assert(modelFn && modelFn[0].includes('editorModel()') && modelFn[0].includes('puzzleModel()'),
    "the preview branch sits after the trainer returns and yields to a drag");
  assert(/function setBoardPreview\(p\) \{[\s\S]{0,200}BoardView\.draw\(\);/.test(appSrc) &&
         !/function setBoardPreview\(p\) \{[\s\S]{0,200}sync\(\)/.test(appSrc),
    "holding a preview repaints the canvas only — a hover must not run the whole sync");
  // 7.3 §3: the move list's hover/leave and the curve's click/scrub were four
  // source-text assertions apiece — `action` class, the class 7.2 proved can
  // hold a button nobody can press. They are now pressed for real, in
  // scripts/test-review-e2e.mjs: the pointer goes onto a move row and the
  // board follows, comes off and the board comes back; the curve is clicked
  // on the right and dragged to the left and the cursor travels with it.
  // PV chips: built from the stored line, previewed off the board's position
  // 5.1 moved the line-walk into previewPvChip() so hover, focus and Enter
  // share it; the property is the same — the walk starts from the board's own
  // position, on a scratch game, never on `game`.
  {
    loadModule(ctx, "src/web/js/preview.js");
    const P = ctx.ChessPreview;
    const g0 = new C();
    const pv = P.pvPreview(C, g0.fen(), "e4 e5 Nf3", 1);
    assert(pv && pv.kind === "pv" && pv.last.to === "e5" && pv.position[4][4].color === "w" && pv.position[3][4].color === "b",
      "pvPreview walks the line k+1 moves deep on a scratch game and reports the last move");
    assert(P.pvPreview(C, g0.fen(), "e4 Zz9 Nf3", 2).last.to === "e4", "…and stops at the first move the position refuses");
    assert(P.pvPreview(C, g0.fen(), null, 0) === null, "no line, no preview");
    const g1 = new C(); g1.move("f3"); g1.move("e5"); g1.move("g4"); const qh4 = g1.move("Qh4");
    const ply = P.plyPreview(g1, qh4, 4);
    assert(ply.kind === "ply" && ply.ply === 4 && ply.check === "e1" && ply.last.from === "d8",
      "plyPreview marks the checked king and the move that reached the position");
  }
  // 7.3 §3: the chips' click, their focus and their Enter/Space were six more
  // `action` assertions. Pressed for real in test-review-e2e.mjs — clicked,
  // then focused with nothing pressed, then dismissed with Esc — so what is
  // asserted is that the board changes, not that the listener is spelled a
  // particular way. The line-walk itself (pvPreview) stays under unit test
  // directly above: that one is `shape`, and it is a pure function.
  assert(/function setViewIndex\(n\) \{[\s\S]{0,200}clearPreview\(\)/.test(appSrc),
    "explicit navigation releases any preview — the board can never disagree with the cursor");
  assert(/store\.subscribe\("game", releaseOrphanPreview\)/.test(appSrc) &&
         /store\.subscribe\("session", releaseOrphanPreview\)/.test(appSrc),
    "a preview nobody holds any more is released on the next commit");
  // the bank button: only where the analysis stored an answer, via the shared rule
  assert(/const bestUci = a && a\.bests \? a\.bests\[sum\.worst\.ply\] : null;\s*if \(bestUci\) \{/.test(appSrc),
    "拿去练 is drawn only when the analysis holds an answer for the turning point (P3)");
  // 7.6: the drill is built by worstDrill(), which the button also asks to
  // learn whether the turning point is banked already
  assert(/function worstDrill\(worst, bestUci\) \{[\s\S]{0,300}Mistakes\.drillFrom\(/.test(appSrc) &&
         /function bankWorst\(worst, bestUci\) \{\s*const cand = worstDrill\(worst, bestUci\);[\s\S]{0,600}Mistakes\.addMines\(/.test(appSrc),
    "the hand bank goes through the same drillFrom + addMines the miner uses");
}

// 进步档案: totals cannot show change, so answers are ALSO banked into ISO
// weeks — alongside, never instead of, the lifetime tally. Pure module, so
// the clock is an argument and history is whatever the test says it is.
{
  loadModule(ctx, "src/web/js/progress.js");
  const P = ctx.ChessProgress;
  const D = (s) => new Date(s + "T12:00:00").getTime();
  // ISO week facts, checked against the calendar, not the implementation
  assert(P.weekKey(D("2026-01-01")) === "2026-W01", "2026-01-01 (Thursday) is 2026-W01");
  assert(P.weekKey(D("2026-01-04")) === "2026-W01" && P.weekKey(D("2026-01-05")) === "2026-W02",
    "the ISO week turns on Monday, not Sunday");
  assert(P.weekKey(D("2027-01-01")) === "2026-W53", "2027-01-01 (Friday) still belongs to 2026-W53");
  {
    const g = P.emptyRecord();
    P.recordAnswer(g, "def", true, D("2026-08-10"));
    P.recordAnswer(g, "def", false, D("2026-08-12"));
    P.recordAnswer(g, "def", false, D("2026-08-18"));
    const rows = P.weekOverWeek(g, D("2026-08-19"));
    const def = rows.find((r) => r.cat === "def");
    assert(def && def.prev === 0.5 && def.now === 1, "本周对上周:正确率各算各的周(7.6:答对的比例,不是失手率)");
    // buckets are additive history — the lifetime tally is not consulted
    P.recordMined(g, 3, D("2026-08-18"));
    P.recordRedeemed(g, D("2026-08-18"));
    const wk = g.weeks[P.weekKey(D("2026-08-18"))];
    assert(wk.mined === 3 && wk.red === 1, "收进与找回也各记各的周");
  }
  {
    const g = P.emptyRecord();
    for (let i = 0; i < P.MAX_WEEKS + 8; i++) P.recordAnswer(g, "m1", false, D("2025-01-06") + i * 7 * 86400000);
    assert(Object.keys(g.weeks).length === P.MAX_WEEKS, "半年之外的周被剪掉 — 档案不是仓库");
  }
  {
    const g = P.emptyRecord();
    const today = D("2026-08-20");
    P.recordSession(g, today - 2 * 86400000);
    P.recordSession(g, today - 86400000);
    assert(P.streak(g, today) === 2, "昨天收尾的连击今天读仍算数(不惩罚先看后练)");
    P.recordSession(g, today);
    assert(P.streak(g, today) === 3, "今天练完接上");
    const g2 = P.emptyRecord();
    P.recordSession(g2, today - 3 * 86400000);
    assert(P.streak(g2, today) === 0, "隔了两天,连击归零 — 不粉饰");
  }
  assert(P.accSeries([{ t: 3, acc: 90 }, { t: 1, acc: 80 }, { t: 2 }], 10).map((x) => x.acc).join(",") === "80,90",
    "准确率序列只取分析过的局,按时间排");
  assert(P.coerce({ v: 9 }).weeks && P.coerce(null).days, "看不懂的存档回退为空档案,不炸");
}

// 今天的训练: the planner reads every signal the app already had, together,
// in a fixed and explainable order — and a step exists only while its source
// has something to serve (P3 in time).
{
  loadModule(ctx, "src/web/js/planner.js");
  const PL = ctx.ChessPlanner;
  const full = PL.plan({ owed: 5, mineUnsolved: 4, weakCat: "def", lessonNext: 3, opUnsolved: true, playedToday: false });
  // v10-0-plan T5: at most three, in the same order — the rest wait their turn
  assert(full.steps.map((x) => x.kind).join(",") === "review,mine,weak" && PL.MAX_STEPS === 3,
    "满信号:欠账→错题→弱项,最多三项(前进与对局排在后面)");
  assert(PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, lessonNext: 3, opUnsolved: true, playedToday: false })
    .steps.map((x) => x.kind).join(",") === "lesson,game", "没欠账时:前进→对局,课程在时开局线让位");
  // T5: the repertoire's due moves come after the weakness, before the library
  const rp = PL.plan({ owed: 2, repDue: 9, libQueued: 4, lessonNext: 3, playedToday: false });
  assert(rp.steps.map((x) => x.kind).join(",") === "review,repdue,lib" && rp.steps[1].n === PL.DOSE.rep,
    "T5:开局书到期的着在欠账之后、棋谱库之前,剂量封顶", JSON.stringify(rp.steps));
  {
    const b = PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, repDue: 9 });
    assert(PL.stepDone({ kind: "repdue", n: 5 }, b, PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, repDue: 4 })) &&
      !PL.stepDone({ kind: "repdue", n: 5 }, b, PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, repDue: 6 })),
      "T5:开局书一步,剂量的着出了队列才算完成");
  }
  // T5: a brand-new profile is given the first lesson, and nothing else
  const fresh0 = PL.plan({ owed: 0, mineUnsolved: 0, lessonNext: 0, opUnsolved: true, playedToday: false, fresh: true });
  assert(fresh0.steps.length === 1 && fresh0.steps[0].kind === "lesson" && fresh0.steps[0].i === 0,
    "T5:新档案只有一项 —— 第 1 课", JSON.stringify(fresh0.steps));
  // T3: this week's focus takes the weakness step's place, a dose at a time
  const fz = PL.plan({ owed: 0, weakMotif: "pin", lessonNext: 3, playedToday: false,
    focus: { kind: "motif", motif: "fork", n: 10, at: 9 } });
  assert(fz.steps.map((x) => x.kind).join(",") === "focus,lesson,game" && fz.steps[0].n === 1,
    "T3:本周重点取代弱项那一步,剂量不超过这一项还剩的", JSON.stringify(fz.steps));
  {
    const k = PL.focusKey({ kind: "motif", motif: "fork" });
    const b = PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, focus: { [k]: 3 } });
    const a2 = PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, focus: { [k]: 5 } });
    assert(PL.stepDone({ kind: "focus", item: { kind: "motif", motif: "fork" }, n: 2 }, b, a2) &&
      !PL.stepDone({ kind: "focus", item: { kind: "motif", motif: "fork" }, n: 3 }, b, a2), "T3:本周重点一步按这一项的进度记");
  }
  {
    loadModule(ctx, "src/web/js/focus.js");
    const F = ctx.ChessFocus;
    assert(F.compose({ enough: false, have: 7, need: 20 }).need === 13 && !F.compose({ enough: false, have: 7, need: 20 }).items.length,
      "T3:局数不够时不排重点,只说还差几局");
    const diag = { enough: true, weakestPhase: "end", motifs: [{ motif: "fork", n: 9 }, { motif: "pin", n: 4 }],
      ecos: [{ eco: "C60", name: "西班牙", n: 8, score: 0.7 }, { eco: "B20", name: "西西里", n: 6, score: 0.4 }, { eco: "A00", name: "x", n: 2, score: 0 }] };
    const c = F.compose(diag, { opDrills: (f) => (f === "B2" ? 7 : 0) });
    assert(c.items.map((x) => x.kind).join() === "motif,endgame,opening" && c.items[0].motif === "fork" &&
      c.items[2].family === "B2" && c.items[2].n === 3, "T3:母题、最弱的阶段、得分不到一半的开局(局数够、有开局线可练)", JSON.stringify(c.items));
    const mid = F.compose(Object.assign({}, diag, { weakestPhase: "middle" }), { opDrills: () => 0 });
    assert(mid.items.map((x) => x.motif || x.kind).join() === "fork,pin", "T3:中局最弱时排第二个母题;没有开局线可练就不排开局", JSON.stringify(mid.items));
    const cnt = { byMotif: { fork: 4 }, egDone: 2, opSolved: (f) => (f === "B2" ? 1 : 0) };
    const base = F.snapshot(cnt, c.items);
    const now = { byMotif: { fork: 20 }, egDone: 4, opSolved: () => 1 };
    assert(F.progressOf(c.items[0], base, now) === 10 && F.progressOf(c.items[1], base, now) === 2 && F.progressOf(c.items[2], base, now) === 0,
      "T3:进度从这一周开始时的计数算起,封顶在剂量");
    let asked = 0;
    const dx = () => { asked++; return diag; };
    const w1 = F.weekOf(null, "2026-W41", dx, { opDrills: () => 1 }, cnt, 25);
    const w2 = F.weekOf(w1.focus, "2026-W41", dx, { opDrills: () => 1 }, cnt, 30);
    const w3 = F.weekOf(w1.focus, "2026-W42", dx, { opDrills: () => 1 }, cnt, 30);
    assert(w1.fresh && !w2.fresh && w2.focus === w1.focus && w3.fresh && asked === 2, "T3:一周排一次,同一周里不重排");
    const e1 = F.weekOf(null, "2026-W41", () => ({ enough: false, have: 5, need: 20 }), {}, cnt, 5);
    assert(!F.weekOf(e1.focus, "2026-W41", dx, {}, cnt, 5).fresh && F.weekOf(e1.focus, "2026-W41", dx, { opDrills: () => 0 }, cnt, 6).fresh,
      "T3:没排出来的一周,分析的局数变了才再问");
  }
  // T1: placed on the first run — the game against the chosen opponent first
  const placed = PL.plan({ owed: 0, mineUnsolved: 0, lessonNext: 0, opUnsolved: true, playedToday: false, placed: true });
  assert(placed.steps.map((x) => x.kind).join(",") === "game,lesson", "T1:定级之后,第一件事是和配好的对手下一盘", JSON.stringify(placed.steps));
  assert(full.steps[0].n === PL.DOSE.review && full.steps[1].n === 2 && full.steps[2].cat === "def",
    "剂量封顶,弱项带着它的类别");
  const lean = PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, lessonNext: -1, opUnsolved: true, playedToday: true });
  assert(lean.steps.map((x) => x.kind).join(",") === "op", "没欠账、课上完、今天下过棋:只剩背谱");
  assert(PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, lessonNext: -1, opUnsolved: false, playedToday: true }).steps.length === 0,
    "什么都不缺时,课表是空的 — 不硬凑");
  assert(PL.plan({ owed: 0, mineUnsolved: 2, weakCat: "mine", lessonNext: -1, opUnsolved: false, playedToday: true })
    .steps.map((x) => x.kind).join(",") === "mine",
    "弱项恰好是错题类时不重复排 — 一个想法不算两步");
  // 5.2: a weak motif replaces the weak shelf — one statement about weakness
  const motifPlan = PL.plan({ owed: 0, mineUnsolved: 0, weakCat: "tac", weakMotif: "fork", lessonNext: -1, opUnsolved: false, playedToday: true });
  assert(motifPlan.steps.map((x) => x.kind).join(",") === "motif" && motifPlan.steps[0].motif === "fork",
    "母题弱项取代题型弱项，不并列");
  {
    const b = PL.snap({ owed: 0, byCat: {}, byMotif: { fork: 3 }, lessonsDone: 0, opSolved: 0, games: 0 });
    const a2 = PL.snap({ owed: 0, byCat: {}, byMotif: { fork: 5 }, lessonsDone: 0, opSolved: 0, games: 0 });
    assert(PL.stepDone({ kind: "motif", motif: "fork", n: 2 }, b, a2) && !PL.stepDone({ kind: "motif", motif: "pin", n: 2 }, b, a2),
      "母题步按该母题的答题数记");
  }
  // 7.1 (v7-1-plan §1.3): the library is a signal the coach can see
  {
    // someone who imported an archive and has answered nothing here yet: the
    // puzzle tally is empty, so 7.0 gave them no weakness step at all
    const fresh = PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, weakMotif: null,
      libMotif: "fork", libQueued: 0, lessonNext: -1, opUnsolved: false, playedToday: true });
    assert(fresh.steps.map((x) => x.kind).join(",") === "motif" &&
           fresh.steps[0].motif === "fork" && fresh.steps[0].from === "lib",
      "题库战绩一片空白时，弱项从你自己的棋里读", JSON.stringify(fresh.steps));
    // …but the tally still wins when it has something to say: it measures
    // answers this app watched
    const both = PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, weakMotif: "pin",
      libMotif: "fork", libQueued: 0, lessonNext: -1, opUnsolved: false, playedToday: true });
    assert(both.steps[0].motif === "pin" && both.steps[0].from === undefined,
      "题库有话说的时候，还是题库说了算");
    const queued = PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, weakMotif: null,
      libMotif: null, libQueued: 12, lessonNext: -1, opUnsolved: false, playedToday: true });
    assert(queued.steps.map((x) => x.kind).join(",") === "lib" && queued.steps[0].n === 12,
      "导进来没分析的棋，本身就是今天该干的一件事", JSON.stringify(queued.steps));
    assert(PL.plan({ owed: 0, mineUnsolved: 0, weakCat: null, weakMotif: null, libMotif: null,
      libQueued: 0, lessonNext: -1, opUnsolved: false, playedToday: true }).steps.length === 0,
      "库里没有欠着的，就不摆这一步 — 这一页一贯的规矩");
    const b = PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, libAnalysed: 3 });
    const a2 = PL.snap({ owed: 0, byCat: {}, lessonsDone: 0, opSolved: 0, games: 0, libAnalysed: 4 });
    assert(PL.stepDone({ kind: "lib", n: 12 }, b, a2) && !PL.stepDone({ kind: "lib", n: 12 }, b, b),
      "分析完一局就算这一步做到了 — 整个队列清空要一小时，那不是一步");
  }

  // completion is counter deltas, so quitting mid-step costs nothing
  const before = PL.snap({ owed: 3, byCat: { def: 10, mine: 2 }, lessonsDone: 1, opSolved: 5, games: 7 });
  const after = (o) => PL.snap(Object.assign({ owed: 3, byCat: { def: 10, mine: 2 }, lessonsDone: 1, opSolved: 5, games: 7 }, o));
  assert(PL.stepDone({ kind: "review", n: 3 }, before, after({ owed: 0 })),
    "复习队列自己清空也算完成 — SRS 毕业不是没练");
  // one clean solve does not graduate (SRS wants two), so owed barely moves
  // during honest work: the dose counts answers, not graduations
  assert(PL.stepDone({ kind: "review", n: 3 }, before, after({ owed: 3, byCat: { def: 12, mine: 3 } })),
    "答满剂量就算完成 — 欠账数不动是 SRS 的事,不是没练");
  assert(!PL.stepDone({ kind: "review", n: 3 }, before, after({ owed: 1, byCat: { def: 11, mine: 2 } })),
    "只答了一题欠着三题的剂量,还没完");
  assert(PL.stepDone({ kind: "weak", cat: "def", n: 2 }, before, after({ byCat: { def: 12, mine: 2 } })),
    "弱项按类内答题数记,不问对错 — 练了就是练了");
  assert(PL.stepDone({ kind: "mine", n: 2 }, before, after({ byCat: { def: 10, mine: 4 } })), "错题同理");
  assert(PL.stepDone({ kind: "lesson", i: 1 }, before, after({ lessonsDone: 2 })), "课以完成数记");
  assert(PL.stepDone({ kind: "game" }, before, after({ games: 8 })), "对局以入档记");
  assert(!PL.stepDone({ kind: "game" }, before, after({})), "没下就是没下");
}

// --- the wiring: who writes the buckets, who reads the plan ---------------
{
  const appSrc = allAppSource;
  assert(/Picker\.recordAnswer\(store\.session\.puzzleState, p\.cat, true, motifKeyOf\(p\)\);[\s\S]{0,200}Progress\.recordAnswer\(store\.session\.progress, p\.cat, true, Date\.now\(\)\)/.test(appSrc),
    "每次失手同时写进周桶 — 记忆与总账同一落笔点");
  assert(/Picker\.recordAnswer\(store\.session\.puzzleState, store\.session\.puzzle\.p\.cat, false, motifKeyOf\(store\.session\.puzzle\.p\)\);\s*Progress\.recordAnswer\(store\.session\.progress, store\.session\.puzzle\.p\.cat, false, Date\.now\(\)\)/.test(appSrc),
    "干净解出同样双写");
  assert(/p\.cat === "mine"\) Progress\.recordRedeemed/.test(appSrc),
    "错题干净解出记一次「找回」");
  assert(/Progress\.recordMined\(store\.session\.progress, r\.added/.test(appSrc),
    "挖进的错题记进当周");
  assert(/store\.subscribe\("session", syncDailyUI\);\s*store\.subscribe\("game", syncDailyUI\)/.test(appSrc),
    "课表在 session 与 game 两个切片上都会醒 — 对局一步也是进度");
  assert(/renderPuzzleTally\(\);\s*renderTrends\(\)/.test(appSrc),
    "记录页画完战绩画进步");
  // 7.1 A3: the coach and the progress page can see the library
  assert(/playedToday: games\.some[\s\S]{0,200}store\.session\.library\.some\(\(g\) => g\.side && Progress\.dayKey\(libPlayedAt\(g\)\) === today\)/.test(appSrc),
    "在别处下的棋也是今天下过棋 —— 7.0 只读本地战绩，导进来今早的快棋还被劝去下一盘");
  assert(/libMotif: libWeakMotif\(\)/.test(appSrc) && /libQueued: Library\.pending\(/.test(appSrc),
    "日课读得到棋谱库说的弱项和还欠着的分析");
  assert(/const d = Library\.diagnose\(store\.session\.library, LIB_MIN_GAMES\);\s*return d\.enough/.test(appSrc),
    "教练用的是诊断页同一个门槛 —— 两个门槛就是两张嘴");
  assert(/Progress\.accSeries\(loadStats\(\)\.games\.concat\(libPoints\), 30\)/.test(appSrc),
    "准确率走势把棋谱库里的棋并进同一条轴");
  assert(/function dailyJump\(step\) \{[\s\S]{0,400}switchMode\("learn"\)/.test(appSrc),
    "跳步走的是换模式的那一个函数(导航栏也走它),不是旁路");
  const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
  // 9.0 S1: the plan's entrance is 今天's card (its button and its steps)
  assert(/id="today-go"/.test(html) && /id="daily-plan"/.test(html) && /id="trend-head" hidden/.test(html) && /id="trend-acc" hidden/.test(html),
    "训练入口在(今天的主卡),进步区默认不画,有数据才出现(P3)");
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
    const { findConcats, callEnds } = await import("./lib/i18n-concat.mjs");
    const { F4_RENDERS } = await import("./lib/i18n-f4-renders.mjs");
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
      ["msg.analysis.kept", (n) => [n], "Analysis stopped · kept the first 1 ply", "Analysis stopped · kept the first 2 plies"],
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
    for (const f of fs.readdirSync(path.join(root, "scripts")).filter((n) => /^test-.*\.mjs$/.test(n))) {
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
    assert(/SAN_PIECE\[san\[0\]\]/.test(ws), "only the leading piece letter becomes a piece");
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

// 7.7 (v7-7-plan §7): no emoji in the interface. Emoji are the one kind of
// glyph each platform draws in its own house style — the same badge was a
// glossy picture on macOS and a flat one on Windows — so the achievements,
// the ✅ / 🎉 / 👀 / ⚠️ in the messages and the 🔒 on a locked badge were
// replaced by the Lucide line icons in icons.js. The scan covers the markup,
// the stylesheet and every script the page ships (i18n strings included),
// comments stripped. The chess symbols U+2654–265F are pieces, not emoji
// (the promotion dialog and the editor palette draw with them), and are
// excluded — although ♟ carries the pictographic property since Emoji 11.
// v10-0-plan E5: the register that listed what was left is gone — none is the rule.
{
  const web = path.join(root, "src/web");
  const files = ["index.html", "styles.css", ...webJsFiles(path.join(web, "js"))
    .filter((f) => f.endsWith(".js") && !["bundle.js", "engine-src.js"].includes(f)).map((f) => "js/" + f)];
  const found = new Map();
  for (const f of files) {
    const src = fs.readFileSync(path.join(web, f), "utf8")
      .replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const hits = [...src.matchAll(/\p{Extended_Pictographic}/gu)].map((m) => m[0]).filter((c) => !/[♔-♟]/u.test(c));
    if (hits.length) found.set(f, [...new Set(hits)].join(""));
  }
  for (const [f, e] of found) console.error("  emoji in " + f + ": " + e);
  assert(found.size === 0, "the interface draws no emoji" + (found.size ? " — " + [...found.keys()].join(", ") : ""));
  // …and every achievement names an icon that exists
  const iconSrc = fs.readFileSync(path.join(web, "js/icons.js"), "utf8");
  const achSrc = fs.readFileSync(path.join(web, "js/achievements.js"), "utf8");
  const missing = [...achSrc.matchAll(/icon: "([^"]+)"/g)].map((m) => m[1])
    .filter((n) => !iconSrc.includes("\n    " + JSON.stringify(n) + ": [["));
  assert(missing.length === 0, "every achievement's icon is in icons.js" + (missing.length ? " — " + missing.join(", ") : ""));
}

// 5.1: the Chinese and Japanese copy uses full-width punctuation. One pass of
// scripts/cjk-punct.mjs --fix converted 826 strings; this keeps the next
// string honest without anyone having to remember the rule.
{
  const { scan } = await import("./cjk-punct.mjs");
  const hits = scan(false);
  for (const h of hits.slice(0, 12)) console.error("  半角标点: " + h.file + ":" + h.line + " 「" + h.from.slice(0, 40) + "」");
  assert(hits.length === 0, "every Chinese and Japanese string uses full-width punctuation" +
    (hits.length ? " (" + hits.length + " to fix: node scripts/cjk-punct.mjs --fix)" : ""));
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
  const minedPuzzles = (() => {
    const mctx = { console, Date, performance };
    mctx.globalThis = mctx; mctx.window = mctx;
    vm.createContext(mctx);
    loadModule(mctx, "src/web/js/puzzles-mined.js");
    return mctx.MINED_PUZZLES.length;
  })();
  const claims = [
    // v8-2-plan T1: the whole course — lessons.js plus the advanced part 3's chunk
    [/零基础 (\d+) 课/, lessons + ctx.CHESS_LESSONS_ADV_ZH.length, "the course size in the teaching row"],
    [/lessons-adv\.js\s+# 进阶课程第三部 (\d+) 课/, ctx.CHESS_LESSONS_ADV_ZH.length, "the advanced part 3 in the file map"],
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
    // 7.0: the mined set was the one content number README stated and nothing
    // checked — it still said 1023 after the depth-18 gate retired 39 of them.
    // Every other count on this page has had a guard since 6.1; this one was
    // simply missed.
    [/引擎自弈挖出 (\d+) 题/, minedPuzzles, "the mined-puzzle count in the 做题 row"],
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
      // 7.1.1: the game count is no longer baked into this pattern. It read
      // /32 盘对新手得分率/ — so the moment the count changed, the guard
      // stopped matching and reported "README no longer states it" instead of
      // the mismatch it exists to find. A guard that hard-codes the number it
      // is checking around is a guard with an expiry date.
      check("README", readme, /盘对新手得分率 \*\*(\d+)%\*\*/, nov.beginner.careful.scorePct, "the beginner score rate");
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
      // 7.1 (v7-1-plan §3.1): §6.4's acceptance, and the prose that quotes it.
      // The same rule as the tier figures — a re-record has to drag the
      // documents with it, or the number in the release notes is a number
      // nobody ran.
      {
        const mc = measured.motifCoverage;
        assert(!!mc && Number.isFinite(mc.explainedPct),
          "docs/measured.json holds a motif-coverage run (§6.4 的验收)");
        if (mc) {
          assert(mc.games === 28 && mc.plies === 1320,
            "覆盖率是在那 28 局 1320 半着的语料上量的，不是别的样本 (" + mc.games + "/" + mc.plies + ")");
          assert(typeof mc.caveat === "string" && /正确性没有人工抽样核对过/.test(mc.caveat),
            "记录里带着「只量了覆盖率」那句话 —— 数字单独流传出去就是在骗人");
          for (const rel of ["README.md", ".github/release-notes/v7.1.0.md", "docs/v7-1-plan.md"]) {
            const text = fs.readFileSync(path.join(root, rel), "utf8");
            if (!/母题解释|覆盖率/.test(text)) continue;
            const nums = [...text.matchAll(/(\d+(?:\.\d+)?)%\s*的失误/g)].map((x) => Number(x[1]));
            for (const n of nums) {
              assert(n === mc.explainedPct,
                rel + " 引的覆盖率就是量出来的那个 (" + n + " vs " + mc.explainedPct + ")");
            }
          }
        }
      }
      // 7.1.1: the novice bands must be the recorded mean ± 3σ.
      //
      // This is the guard the repo did not have, and its absence cost a
      // release. 7.0 swapped the engine; docs/measured.json's noviceScore
      // still described Stockfish 18; the bands in test-novice.mjs were
      // drawn around those stale figures; and v7.1.0 failed its release gate
      // on a tier that had not changed at all. Nothing anywhere connected
      // "the engine moved" to "this calibration is now fiction".
      //
      // Now it does: re-record noviceScore and this fails until the bands in
      // test-novice.mjs are carried along with it. Same rule as the tier
      // figures and the review cut-offs — a number that ships has to be the
      // number that was measured.
      {
        const nv = measured.noviceScore;
        assert(!!nv && nv.tiers, "docs/measured.json holds a novice-score run");
        const src = fs.readFileSync(path.join(root, "scripts/test-novice.mjs"), "utf8");
        const bandsBlock = /const BANDS = \{([\s\S]*?)\n  \};/.exec(src);
        assert(!!bandsBlock, "test-novice.mjs still declares its bands in one block");
        for (const [tier, rec] of Object.entries((nv && nv.tiers) || {})) {
          const row = new RegExp(tier + ": \\{ careful: \\[(-?\\d+), (-?\\d+)\\]").exec(bandsBlock ? bandsBlock[1] : "");
          assert(!!row, tier + " 有一条 careful 区间");
          if (!row || !rec.careful) continue;
          const mean = rec.careful.scorePct, sd = rec.careful.sdPct;
          assert(Number.isFinite(sd),
            tier + " 的记录带着实测标准差 —— 没有它，区间宽度就只能靠猜（跑 --repeat）");
          if (!Number.isFinite(sd)) continue;
          const lo = Math.max(0, Math.floor(mean - 3 * sd));
          const hi = Math.min(100, Math.ceil(mean + 3 * sd));
          assert(Number(row[1]) === lo && Number(row[2]) === hi,
            tier + " 的区间就是记录里的均值 ±3σ（" + row[1] + "–" + row[2] +
            " vs " + lo + "–" + hi + "；重测过就把区间一起改）");
        }
      }
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
        ...webJsFiles(WEB_JS)
          .filter((n) => !["bundle.js", "pieces.js", "chess.js"].includes(n))
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

// --- 6.0: the native mirror and recovery (v6-plan Q1.1), on a fake host
{
  const { createPersist, KEYS } = await import("../src/web/js/persist.js");
  const mem = () => {
    const m = new Map();
    return {
      m,
      storageGet: (k) => (m.has(k) ? m.get(k) : null),
      storageSet: (k, v) => { m.set(k, String(v)); return true; },
      storageRemove: (k) => { m.delete(k); },
      hasZero: () => true,
    };
  };
  // a host with a per-key store: `initial` is a profile document's JSON
  // (written as its key files and a manifest) or, when it is not one, the
  // manifest's text as it is; `file` reads the profile back as one document
  // (the manifest as it is when it does not parse), and `writes` counts
  // commits — manifest writes
  const withFile = (text) => {
    const h = mem();
    h.store = new Map();
    h.writes = 0;
    let initial = null;
    try { initial = text == null ? null : JSON.parse(text); } catch (_) { initial = null; }
    if (text != null && !(initial && initial.keys)) h.store.set("meta", text);
    else if (initial) {
      for (const [k, v] of Object.entries(initial.keys)) h.store.set(k, v);
      h.store.set("meta", JSON.stringify({ app: "chessboard", schema: initial.schema, writtenAt: initial.writtenAt,
        keys: Object.keys(initial.keys), files: Object.fromEntries(Object.keys(initial.keys).map((k) => [k, k])) }));
    }
    h.appdataReadKey = async (k) => (h.store.has(k) ? { text: h.store.get(k) } : { missing: true });
    h.appdataWriteKey = async (k, t) => { h.store.set(k, t); if (k === "meta") h.writes++; return true; };
    Object.defineProperty(h, "file", { get() {
      const raw = h.store.get("meta");
      let m = null;
      try { m = JSON.parse(raw); } catch (_) { return raw == null ? null : raw; }
      const keys = {};
      for (const k of m.keys) keys[k] = h.store.get(m.files[k]);
      return JSON.stringify({ app: m.app, schema: m.schema, writtenAt: m.writtenAt, keys });
    } });
    return h;
  };
  const tick = (ms) => new Promise((r) => setTimeout(r, ms));

  // 1. a write reaches the file, once, whole
  {
    const h = withFile(null);
    const P = createPersist(h, () => {});
    P.load();
    // 6.1: the mirror is gated on recover(); the boot path always reconciles
    // before it is allowed to write over the file (see scheduleMirror)
    await P.recover();
    P.set("settings", "{\"a\":1}");
    P.set("learn", "{\"b\":2}");
    await tick(600);
    const doc = JSON.parse(h.file);
    assert(h.writes === 1 && doc.keys.settings === "{\"a\":1}" && doc.keys.learn === "{\"b\":2}",
      "two writes in a burst become one mirror commit (" + h.writes + ")");
    assert(doc.app === "chessboard" && typeof doc.writtenAt === "number", "…stamped as ours");
    // 6.0 review: the mirror used to take its own Date.now() ~400ms after the
    // cache stamp, so every next launch read "file newer than cache" and
    // restored + reloaded a profile that was already in sync
    assert(String(doc.writtenAt) === h.m.get("chess.writtenAt"),
      "…with the cache's own revision stamp, not a later one (" + doc.writtenAt + " vs " + h.m.get("chess.writtenAt") + ")");
    const P2 = createPersist(h, () => {});
    P2.load();
    assert((await P2.recover()) === "kept", "…so a synchronized profile is kept on the next launch, not restored");
  }
  // 2. empty cache + a file = the file is restored
  {
    const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 5000,
      keys: { stats: "{\"v\":2,\"games\":[]}", learn: "{\"v\":1}" } }));
    const P = createPersist(h, () => {});
    P.load();
    assert(P.wasEmpty(), "the cache was empty");
    const r = await P.recover();
    assert(r === "restored", "recover() takes the file when the cache is empty (" + r + ")");
    assert(P.get("stats") === "{\"v\":2,\"games\":[]}" && h.m.get(KEYS.learn) === "{\"v\":1}",
      "…and every key in the file is back in storage");
  }
  // 3. a live cache newer than the file keeps the cache, and re-mirrors it
  {
    const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 5000, keys: { learn: "old" } }));
    h.m.set(KEYS.learn, "new"); h.m.set("chess.writtenAt", "9000");
    const P = createPersist(h, () => {});
    P.load();
    const r = await P.recover();
    assert(r === "kept" && P.get("learn") === "new", "a newer cache is kept over an older file (" + r + ")");
    await tick(600);
    assert(JSON.parse(h.file).keys.learn === "new", "…and the file is brought up to date");
  }
  // 4. a cache older than the file yields to it (data written on another launch that this cache missed)
  {
    const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000, keys: { learn: "file" } }));
    h.m.set(KEYS.learn, "cache"); h.m.set("chess.writtenAt", "5000");
    const P = createPersist(h, () => {});
    P.load();
    const r = await P.recover();
    assert(r === "restored" && P.get("learn") === "file", "an older cache yields to the file (" + r + ")");
  }
  // 5. export / restore round-trip and the failure latch
  {
    const h = withFile(null);
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    await P.recover();
    P.set("slots", "{\"v\":1}");
    const doc = P.exportAll();
    assert(doc.keys.slots === "{\"v\":1}" && P.isProfileDoc(doc), "exportAll() is a profile document");
    P.clearAll();
    assert(P.get("slots") == null, "clearAll() empties the cache");
    P.restoreAll(doc);
    assert(P.get("slots") === "{\"v\":1}", "restoreAll() brings it back");
    h.appdataWriteKey = async () => { throw new Error("disk full"); };
    P.set("slots", "x");
    await tick(600);
    assert(failed && failed.key === "appdata", "a refused mirror write latches the failure like a refused cache write");
  }
  // 6.1 — 7. the boot race: a cleared cache, an intact file, a slow read.
  // Before 6.1 the boot writes armed the 400ms mirror while recover() was
  // still in flight, so an empty profile reached the file first, recover()
  // then read back what it had just destroyed, and the user was told their
  // profile had been restored.
  {
    const good = JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000,
      keys: { stats: "{\"v\":2,\"games\":[1]}", learn: "{\"v\":1,\"done\":1}" } });
    const h = withFile(good);
    const read = h.appdataReadKey;
    h.appdataReadKey = async (k) => { await tick(900); return read(k); };  // slower than MIRROR_DELAY
    const P = createPersist(h, () => {});
    P.load();
    const pending = P.recover();
    P.set("settings", "{\"fresh\":1}");   // what loadSettings/saveGame do on boot
    P.set("save", "{\"v\":1,\"pgn\":\"\"}");
    await tick(600);                      // the old mirror would have fired here
    assert(h.writes === 0, "no mirror write reaches the file before recover() has run (" + h.writes + ")");
    assert(JSON.parse(h.file).keys.stats === "{\"v\":2,\"games\":[1]}", "…so the good file is still the good file");
    const r = await pending;
    assert(r === "restored", "…and the file wins over the cache the boot just wrote (" + r + ")");
    assert(P.get("stats") === "{\"v\":2,\"games\":[1]}", "…with the real stats back in storage");
  }
  // 8. after a restore nothing may write again: the page is still standing on
  // its pre-restore state and is about to reload onto the new one
  {
    const h = withFile(JSON.stringify({ app: "chessboard", schema: 3, writtenAt: 9000, keys: { save: "{\"v\":1,\"pgn\":\"real\"}" } }));
    h.m.set("chess.writtenAt", "5000"); h.m.set(KEYS.save, "{\"v\":1,\"pgn\":\"stale\"}");
    const P = createPersist(h, () => {});
    P.load();
    assert((await P.recover()) === "restored", "the older cache yields to the file");
    P.set("save", "{\"v\":1,\"pgn\":\"stale\"}");   // beforeunload → saveGame() during the reload delay
    await tick(600);
    assert(P.get("save") === "{\"v\":1,\"pgn\":\"real\"}", "a write after a restore does not clobber what was restored");
    assert(h.writes === 0, "…and nothing stale reaches the file either (" + h.writes + ")");
  }
  // 9. a restore that cannot be written is reported, not silently half-done
  {
    const h = withFile(null);
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    await P.recover();
    const doc = { app: "chessboard", schema: 3, writtenAt: 1, keys: { learn: "a", stats: "b" } };
    let allow = 1;
    const realSet = h.storageSet;
    h.storageSet = (k, v) => (allow-- > 0 ? realSet(k, v) : false);   // quota dies mid-restore
    const ok = P.restoreAll(doc);
    assert(ok === false, "restoreAll() reports a refused write instead of returning as if it wrote");
    assert(failed && failed.key === "restore", "…and latches the failure so the app can say so");
    h.storageSet = realSet;
  }
  // 10. a file that exists and holds nothing is damage, not a fresh install
  {
    const h = withFile(null);
    h.appdataReadKey = async () => ({ empty: true });
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    const r = await P.recover();
    assert(r === "corrupt", "a zero-length profile file reads as corrupt, not missing (" + r + ")");
    assert(failed && failed.key === "appdataCorrupt", "…and the user is told");
  }
  // 11b. …and the damaged file is genuinely left alone. The banner promises
  // exactly that, and the recovery e2e caught it being false: recover()'s own
  // finally released the mirror, and the write the boot path had queued
  // replaced the damaged bytes within MIRROR_DELAY — the one copy the user was
  // told was kept, destroyed moments after they were told.
  {
    const damaged = "{not json at all";
    const h = withFile(damaged);
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    P.set("save", "{\"v\":1,\"pgn\":\"whatever the boot path writes\"}");
    const r = await P.recover();
    await tick(700);
    assert(r === "corrupt" && failed && failed.key === "appdataCorrupt", "an unreadable file is reported (" + r + ")");
    assert(h.writes === 0 && h.file === damaged,
      "…and nothing overwrites it, which is what the banner promises (" + h.writes + " write(s))");
    P.set("learn", "later in the same session");
    await tick(700);
    assert(h.writes === 0 && h.file === damaged, "…for the rest of the session, not just the first moment");
  }
  // 11. an unreadable file is reported too — before 6.1 it returned "none" in
  // silence and the broken file was left in place forever
  {
    const h = withFile("{not json at all");
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    const r = await P.recover();
    assert(r === "corrupt", "a file that will not parse reads as corrupt (" + r + ")");
    assert(failed && failed.key === "appdataCorrupt", "…and says so once");
  }
  // 12. the quarantine keeps the evidence it promises to keep
  {
    const h = mem();
    const P = createPersist(h, () => {});
    h.m.set(KEYS.learn, "{oops");
    P.load();
    for (let i = 0; i < 12; i++) { P.load(); P.read("learn"); }   // twelve launches, one bad key
    const list = JSON.parse(P.get("quarantine"));
    assert(list.length === 1 && list[0].raw === "{oops",
      "the same unreadable value is kept once, not pushed on every launch (" + list.length + ")");
    P.clearAll();
    assert(P.get("quarantine") != null, "clearAll() does not destroy the quarantined evidence");
    P.restoreAll({ app: "chessboard", schema: 3, writtenAt: 1, keys: {} });
    assert(P.get("quarantine") != null, "…and neither does a restore");
  }
  // 13. a cache that cannot stamp itself must not report the write as kept:
  // an unstamped cache reads as older than it is and the file overwrites it
  {
    const h = mem();
    let failed = null;
    const P = createPersist(h, (info) => { failed = info; });
    P.load();
    const realSet = h.storageSet;
    h.storageSet = (k, v) => (k === "chess.writtenAt" ? false : realSet(k, v));
    assert(P.set("learn", "x") === false, "a refused revision stamp is a refused write");
    assert(failed && failed.key === "learn", "…and latches");
    h.storageSet = realSet;
  }
  // 14. no bridge at all: nothing mirrors, nothing fails, recover() says none
  {
    const h = mem();
    const P = createPersist(h, () => { throw new Error("must not be called"); });
    P.load();
    P.set("learn", "x");
    assert(await P.recover() === "none", "a browser has no file and no error");
  }
}

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
  // carries their doors. v9-0-plan §8 第 4 条 set it at 8.4.0 + 20 KB;
  // v10-0-plan E6 moves it to 9.0.0 (923,333 bytes, e3fc6df) + 20 KB
  const BUNDLE_BYTES_100 = 923333 + 20000;
  assert(bundleBytes <= BUNDLE_BYTES_100,
    "v10-0-plan E6: bundle.js grows at most 20 KB over 9.0.0 (" + bundleBytes + (bundleBytes <= BUNDLE_BYTES_100 ? " ≤ " : " > ") + BUNDLE_BYTES_100 + " bytes)");
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
      [{ langId: "zh-CN", mode: "ai" }, null, ""],
      [{ langId: "en" }, null, "chunk-lang-en.js"],
      // Japanese reads English as its bridge, so it takes both, English first
      [{ langId: "ja" }, null, "chunk-lang-en.js chunk-lang-ja.js"],
      // settings without a language are the Chinese default, whatever the OS says
      [{ mode: "ai" }, { languages: ["en-US"] }, ""],
      // no settings at all is a first run: the system locale decides
      [null, { languages: ["ja-JP", "en"] }, "chunk-lang-en.js chunk-lang-ja.js"],
      [null, { languages: ["zh-TW"] }, ""],
      [{ langId: "en", mode: "puzzle", pieceSet: "merida" }, null, "chunk-lang-en.js chunk-mined.js chunk-merida.js"],
      // v8-0-plan A3: every set outside the bundle is fetched ahead of the
      // bundle for the player who chose it; the two inside it need nothing
      [{ pieceSet: "fantasy" }, null, "chunk-pieces-fantasy.js"],
      [{ pieceSet: "chessnut" }, null, "chunk-pieces-chessnut.js"],
      [{ pieceSet: "cburnett" }, null, ""],
      [{ pieceSet: "classic" }, null, ""],
      [{ pieceSet: "toString" }, null, ""],
      [{ langId: "xx" }, null, ""],
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
      assert(ids.length >= 7 && ids[0] === "cburnett", "seven sets, the default first (" + ids.join(", ") + ")");
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
        const inBundle = id === "cburnett" || id === "classic";
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

// --- v8-2-plan V1: the automation build is tested, never released ------------
//
// -Dautomation=true compiles in the SDK's automation server: a dropbox under
// the app's working directory through which any local process can call
// chess.*. build-macos.yml / build-windows.yml build it as a second package of
// the same commit to drive it (scripts/automation-scenarios.mjs). What ships
// is the other one: the job that uploads the Chessboard-* artifacts release.yml
// downloads must not build with automation, the automation job must upload no
// Chessboard-* artifact and nothing to a release, and release.yml attaches
// exactly the three files by name. Comments are dropped first: they may say
// what they like about the other job.
{
  const code = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
    .split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
  /** The jobs of a workflow, by name: each one's text up to the next job. */
  const jobsOf = (text) => {
    const body = text.slice(text.indexOf("\njobs:\n") + 7);
    const out = {};
    const heads = [...body.matchAll(/^  ([\w-]+):\n/gm)];
    heads.forEach((m, i) => { out[m[1]] = body.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : body.length); });
    return out;
  };
  for (const rel of [".github/workflows/build-macos.yml", ".github/workflows/build-windows.yml"]) {
    const jobs = jobsOf(code(rel));
    const auto = Object.entries(jobs).filter(([, j]) => /-Dautomation=true/.test(j));
    const shipping = Object.entries(jobs).filter(([, j]) => /name: Chessboard-/.test(j) || /gh release upload/.test(j));
    assert(auto.length === 1 && auto[0][0] === "automation", rel + ": one job builds with -Dautomation=true, `automation` (" + auto.map(([n]) => n).join(", ") + ")");
    assert(shipping.length === 1 && shipping[0][0] === "build", rel + ": only `build` uploads a Chessboard-* artifact or to a release (" + shipping.map(([n]) => n).join(", ") + ")");
    assert(!/-Dautomation/.test(jobs.build || ""), rel + ": the shipped package is built without automation");
    const a = jobs.automation || "";
    assert(!/name: Chessboard-|gh release|upload-artifact[\s\S]*?path: dist\//.test(a) && /--output dist-auto\//.test(a) && !/--output dist\//.test(a),
      rel + ": the automation job packages into dist-auto/ and uploads no package (only its report)");
    assert(/timeout-minutes: 20\b/.test(a), rel + ": the automation job has its 20-minute limit");
    assert(/node scripts\/automation-smoke\.mjs/.test(a) && /node scripts\/automation-scenarios\.mjs/.test(a), rel + ": the automation job runs the smoke test and the scenarios");
    // §9 M4: a job its own limit stops ends "cancelled", which continue-on-error
    // does not cover and which skips `publish`; a step's limit ends it "failed"
    for (const step of ["automation smoke", "automation scenarios"]) {
      const lim = /^\s*timeout-minutes: (\d+)/m.exec(a.slice(a.indexOf("name: " + step)).split(/\n      - /)[0]);
      assert(lim && +lim[1] < 20, rel + ": the `" + step + "` step has its own limit under the job's 20 minutes");
    }
  }
  const rel = code(".github/workflows/release.yml");
  assert(/pattern: Chessboard-\*/.test(rel) && (rel.match(/uses: actions\/download-artifact@/g) || []).length === 1,
    "release.yml downloads only the Chessboard-* artifacts (never automation-report-*)");
  const attached = (/gh release create[\s\S]*?\n\s*(dist\/[^\n]*)\n/.exec(rel) || [])[1] || "";
  assert(attached.trim() === "dist/Chessboard-macOS-arm64.zip dist/Chessboard-macOS-arm64.dmg dist/Chessboard-Windows-x64.zip",
    "release.yml attaches exactly the three shipped packages (" + attached.trim() + ")");
  assert(!/dist-auto|-Dautomation/.test(rel), "release.yml never names the automation build");
}

// v8-3-plan V1 (8.2.1): the packaged app is launched outside the checkout. The
// checkout has a frontend/dist of its own, and the Windows build read its page
// from the current directory: started from the repository the self-test and
// the release went green while the app, started from Explorer, had no page.
{
  const strip = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
    .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
  const selftest = strip("scripts/selftest-app.mjs");
  const spawnCall = (/spawn\(([\s\S]*?)\}\);/.exec(selftest) || [])[1] || "";
  assert(/\bcwd\b/.test(spawnCall) && !/cwd:\s*(process\.cwd|root|ROOT)/.test(spawnCall) && /path\.resolve\(exe\)/.test(spawnCall) &&
    /launch\(1,\s*dir\)/.test(selftest) && /launch\(2,\s*path\.dirname\(path\.resolve\(exe\)\)\)/.test(selftest),
    "selftest-app.mjs starts the packaged app by an absolute path, first in its temp folder, then in the executable's own folder (a double click), never in the checkout");
  // v8-3-plan §8 第 4 条: Windows automation is a gate like macOS
  for (const wf of [".github/workflows/build-windows.yml", ".github/workflows/build-macos.yml"]) {
    const text = fs.readFileSync(path.join(root, wf), "utf8").replace(/\r\n/g, "\n");
    const job = text.slice(text.indexOf("\n  automation:\n"));
    assert(!/^    continue-on-error:/m.test(job) && !/not a gate/.test(job.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")),
      wf + ": the automation job is a gate (no continue-on-error, not named \"not a gate\")");
  }
  const lib = strip("scripts/lib/automation.mjs");
  assert(/spawn\(path\.resolve\(exe\),\s*\[\],\s*\{\s*cwd:\s*work\b/.test(lib),
    "automation launches start the app in their work folder");
  const main = fs.readFileSync(path.join(root, "src/main.zig"), "utf8");
  assert(/fn resolveAssetRoot\(/.test(main) && /app_state\.resolveAssetRoot\(\);/.test(main) &&
    /\.dist = self\.asset_root/.test(main),
    "main.zig points the WebView at the page beside the exe (resolveAssetRoot), in both the source and source_fn");
}

// v8-4-plan V1: an exe directory the user cannot write to moves WebView2's
// user data to %LOCALAPPDATA%\Chessboard\WebView2 — set in main() before the
// runner creates the WebView2 environment — and the Windows build proves it
// by running the packaged self-test from a copy it has denied writes to.
{
  const code = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
    .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
  const main = code("src/main.zig");
  const mainFn = main.slice(main.indexOf("pub fn main("));
  const call = mainFn.indexOf("app_state.resolveWebView2UserData();");
  assert(/fn resolveWebView2UserData\(/.test(main) && call > 0 && call < mainFn.indexOf("runner.runWithOptions("),
    "main.zig calls resolveWebView2UserData() in main(), before the runner starts");
  assert(/"WEBVIEW2_USER_DATA_FOLDER"/.test(main) && /\\\\Chessboard\\\\WebView2/.test(main) && /SetEnvironmentVariableW\(/.test(main),
    "main.zig sets WEBVIEW2_USER_DATA_FOLDER to <LOCALAPPDATA>\\Chessboard\\WebView2 through SetEnvironmentVariableW");
  const wf = code(".github/workflows/build-windows.yml");
  const build = wf.slice(wf.indexOf("\n  build:\n"), wf.indexOf("\n  automation:\n"));
  const step = (name) => build.indexOf("- name: " + name + "\n");
  const ro = step("self-test the packaged app from a read-only folder");
  const roBody = ro < 0 ? "" : build.slice(ro, build.indexOf("\n      - ", ro + 1));
  assert(ro > 0 && ro < step("self-test the packaged app") && ro < step("zip package"),
    "build-windows.yml: the read-only self-test runs in the build job, before the regular self-test and the zip");
  assert(/timeout-minutes: \d+/.test(roBody) && /icacls \$ro \/deny "\*S-1-1-0:\(OI\)\(CI\)\(WD,AD\)" \/T/.test(roBody) &&
    /the deny did not take/.test(roBody) && /node scripts\/selftest-app\.mjs \$exe/.test(roBody) &&
    /'Chessboard\\WebView2'/.test(roBody) && /no WebView2 data in/.test(roBody) && /WebView2 data beside the exe/.test(roBody),
    "build-windows.yml: the read-only step denies writes with icacls, checks the deny took, runs selftest-app.mjs, and wants the data in %LOCALAPPDATA%\\Chessboard\\WebView2");
}

// v8-2-plan §9 M4 评审修正: a live automation run writes into the machine's real
// WebView storage (same bundle id; WKWebView ignores $HOME), so off a CI
// runner both drivers refuse unless told --real-profile-ok; --null never asks.
{
  const { liveProfileRefusal } = await import("./lib/automation.mjs");
  assert(liveProfileRefusal("x", [], {}) && liveProfileRefusal("x", [], { CI: "false", GITHUB_ACTIONS: "0" }), "a live automation run off CI is refused");
  assert(liveProfileRefusal("x", [], { CI: "true" }) === null && liveProfileRefusal("x", [], { GITHUB_ACTIONS: "true" }) === null &&
    liveProfileRefusal("x", ["--real-profile-ok"], {}) === null, "a live automation run goes ahead on CI or with --real-profile-ok");
  const env = { ...process.env };
  delete env.CI;
  delete env.GITHUB_ACTIONS;
  for (const s of ["automation-smoke.mjs", "automation-scenarios.mjs"]) {
    // package.json stands in for the exe: a refusal comes before any launch
    const r = spawnSync(process.execPath, [path.join(__dirname, s), path.join(root, "package.json")], { cwd: root, env, encoding: "utf8", timeout: 20000 });
    assert(r.status === 1 && /^REFUSED: .*--real-profile-ok/m.test(r.stderr), s + " live mode refuses off CI without --real-profile-ok (exit " + r.status + ": " + (r.stderr || "").trim().slice(0, 120) + ")");
  }
}

// v8-3-plan T1 / T2: 看 N 步 / 盲走 draw from the bank's band for the mode's
// rating, and look's plies past the puzzle's line are the engine's move at
// the review's budget — the rule without an engine (pickMove) where it has none
{
  const vctx = { console };
  vctx.globalThis = vctx;
  vctx.window = vctx;
  vm.createContext(vctx);
  loadModule(vctx, "src/web/js/chess.js");
  loadModule(vctx, "src/web/js/trainer/visual-modes.js");
  const V = vctx.CHESS_VISUAL, C = vctx.Chess;
  const ana = fs.readFileSync(path.join(root, "src/web/js/review/analysis.js"), "utf8");
  assert(Number((/const SCAN_BUDGET = (\d+);/.exec(ana) || [])[1]) === V.LOOK_BUDGET,
    "visual-modes LOOK_BUDGET is the review's SCAN_BUDGET (" + V.LOOK_BUDGET + ")");
  const idx = { bands: [{ band: 600 }, { band: 800 }, { band: 1000 }], themes: { m1: { bands: [30, 5, 25] }, m2: { bands: [40, 40, 3] } } };
  assert(V.bankBand(idx, 600, ["m1", "m2"]) === 600 && V.bankBand(idx, 800, ["m1", "m2"]) === 600 && V.bankBand(idx, 1000, ["m1", "m2"]) === 600 &&
    V.bankBand(idx, 800, []) === 800 && V.bankBand({ bands: idx.bands, themes: {} }, 1000, ["m1"]) === 1000,
    "bankBand: the rating's band, or the nearest holding a set's worth of each mate, or the rating's band when none does");
  assert(V.keyBand("lc-ab|1400") === 1400 && V.keyBand("lc-ab|3|99|1400") === 1400 && V.keyBand("m1-x|3|99") === null &&
    V.keyBand("m1-x") === null && V.keyBand("lc-ab") === null, "keyBand: a bank review key ends in its band, a local one has none");
  const A = { id: "lc-a" }, B = { id: "b" }, Cq = { id: "c" };
  assert(V.blindNext([[A], []], [[B], [Cq]], 7, 0, 1, []) === Cq && V.blindNext([[A], []], [[B], [Cq]], 7, 0, 0, []) === A &&
    V.blindNext([[A], []], [[B], [Cq]], 7, 0, 0, ["lc-a"]) === B && V.blindNext(null, [[B], []], 7, 0, 1, []) === B &&
    V.blindNext(null, [[], []], 7, 0, 0, []) === null,
    "blindNext: the level asked for from the bank, then the local book, then the other level");
  // the Italian, Black to move; the puzzle's line is one ply, the engine plays two
  const p = { id: "lc-t", src: "lichess", rating: 1450, cat: "tac", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3", solution: ["Nf6"] };
  const asked = [];
  const eng = { "r1bqkb1r/pppp1ppp/2n2n2/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4": "f3g5", "r1bqkb1r/pppp1ppp/2n2n2/4p1N1/2B1P3/8/PPPP1PPP/RNBQK2R b KQkq - 5 4": "d7d5" };
  const best = async (fen) => { asked.push(fen); return eng[fen] || null; };
  const q = await V.buildLook(C, p, 3, 11, best);
  const q2 = await V.buildLook(C, p, 3, 11, best);
  assert(q && q.sans.join(" ") === "Nf6 Ng5 d5" && asked.length === 4 && JSON.stringify(q) === JSON.stringify(q2) && /^lc-t\|3\|11\|1400$/.test(q.key),
    "buildLook: the puzzle's line first, then the engine's moves (asked only past the line), the same question twice, the key ends in the band", q && q.sans.join(" ") + " " + asked.length + " " + (q && q.key));
  const none = await V.buildLook(C, p, 3, 11, async () => null);
  const bad = await V.buildLook(C, p, 3, 11, async () => "a1a1");
  const rule = await V.buildLook(C, p, 3, 11);
  assert(rule && JSON.stringify(none) === JSON.stringify(rule) && JSON.stringify(bad) === JSON.stringify(rule) && rule.sans[0] === "Nf6",
    "buildLook: no engine move (none, or one that is not legal) — pickMove's rule, exactly as without an engine", rule && rule.sans.join(" "));
  const pool = V.lookPool([p, Object.assign({}, p, { id: "lc-u", solution: ["Nf6", "Ng5"] })]);
  const a = await V.lookQuestion(C, pool, 99, 0, 3, best), b = await V.lookQuestion(C, pool, 99, 0, 3, best);
  assert(a && JSON.stringify(a) === JSON.stringify(b), "lookQuestion with the engine: the same seed, the same question", a && a.key);
}

// v8-4-plan T1: 看 N 步's first question no longer waits for searches. Twelve
// whole sets (four seeds × three answer patterns, N moving 2–6 with them)
// over the hand-written book dressed as bank puzzles, with an "engine" that
// is a pure function of the FEN, as the real one is: the same seed and the
// same answers give the same 120 questions, key for key. Then a review:
// built from the plies its key kept (engPlies), with no engine at all, it is
// the question the engine built.
{
  const vctx = { console };
  vctx.globalThis = vctx;
  vctx.window = vctx;
  vm.createContext(vctx);
  loadModule(vctx, "src/web/js/chess.js");
  loadModule(vctx, "src/web/js/puzzles.js");
  loadModule(vctx, "src/web/js/trainer/visual-modes.js");
  const V = vctx.CHESS_VISUAL, C = vctx.Chess;
  const pool = V.lookPool(vctx.CHESS_PUZZLES.map((p) => Object.assign({}, p, { id: "lc-" + p.id, src: "lichess", rating: 1450 })));
  const fnv = (s) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0; return h; };
  let searches = 0;
  const best = async (fen) => {
    searches++;
    const ms = new C(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || "")).sort();
    return ms.length ? ms[fnv(fen) % ms.length] : null;
  };
  const asked = (q) => q.t !== "cap" || !!q.target;
  const sets = async () => {
    const out = [], qs = [];
    for (const seed of [1, 99, 1790600000, 4000000007]) for (const pat of [0, 0x3ff, 0x2b5]) {
      let n = 2;
      const keys = [];
      for (let k = 0; k < 10; k++) {
        const q = await V.lookNth(C, pool, seed, k, n, best, asked);
        keys.push(q ? q.key + " " + q.sans.join(" ") + " " + q.t : "null");
        if (q) qs.push(q);
        n = Math.max(2, Math.min(6, n + ((pat >> k) & 1 ? 1 : -1)));
      }
      out.push(seed + "/" + pat + ": " + keys.join(", "));
    }
    return { sha: crypto.createHash("sha256").update(out.join("\n")).digest("hex"), qs };
  };
  const first = await sets();
  const once = searches;
  const again = await sets();
  const qs = first.qs;
  assert(pool.length === 168 && first.sha === again.sha && qs.length >= 100 && once > 50,
    "v8-4-plan T1: twelve whole 看 N 步 sets (seed × answers) come out the same twice, question for question (" + qs.length + " questions, " + once + " searches)", first.sha.slice(0, 12) + " / " + again.sha.slice(0, 12) + " / pool " + pool.length);
  // plies kept with the key → the same question with no engine; none kept → the search
  let same = 0, plied = 0, quiet = 0;
  const noEngine = () => { throw new Error("searched"); };
  for (const q of qs.slice(0, 60)) {
    const p = pool.find((x) => x.id === q.pid);
    const seen = new Map();
    const tee = async (fen) => { const u = await best(fen); if (u) seen.set(V.fenTag(fen), u); return u; };
    const again = await V.buildLook(C, p, q.n, Number(q.key.split("|")[2]), tee);
    const eng = V.engPlies(C, again, seen);
    const kept = V.engFrom(eng);
    const rebuilt = await V.buildLook(C, p, q.n, Number(q.key.split("|")[2]), (fen) => (kept.has(V.fenTag(fen)) ? Promise.resolve(kept.get(V.fenTag(fen))) : noEngine()));
    if (JSON.stringify(again) === JSON.stringify(q) && JSON.stringify(rebuilt) === JSON.stringify(q)) same++;
    if (eng) plied++;
    if (q.n <= (p.line || p.solution).length && !eng) quiet++;
  }
  assert(same === 60 && plied >= 10 && quiet >= 10,
    "v8-4-plan T1: a review rebuilt from the engine plies its key kept is the engine's question, with no search (" + plied + " with plies, " + quiet + " inside the puzzle's own line)", same + "/60");
  assert(V.engFrom("a1:e2e4,b2:zz,c3:e7e8q,,d4").size === 2 && V.engFrom(null).size === 0 && V.engPlies(C, qs[0], new Map()) === "",
    "v8-4-plan T1: engFrom keeps only what reads as a move; engPlies of a question with no engine answer is empty");
}

// --- 7.0: every suite package.json runs, CI runs too -------------------------
//
// 6.1 found that `checks.yml`'s static job named three scripts by hand while
// `npm run test:static` listed eight, so four suites had never once run in PR
// CI. It fixed the static job — and left the same hand-written list in place
// for the e2e job, for the release workflow's e2e loop, and for the engine
// suite. A fix that is a one-time edit is not a fix; this is the assertion
// that makes the next added suite fail loudly instead of silently never
// running.
{
  const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
  const scriptsIn = (cmd) => [...String(cmd || "").matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map((m) => m[1]);
  const checksWf = fs.readFileSync(path.join(root, ".github/workflows/checks.yml"), "utf8").replace(/\r\n/g, "\n");
  const releaseWf = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");
  // Only the e2e lists are spelled out: both workflows run `test:static` and
  // `test:engine` through npm, which is the shape that cannot drift. The e2e
  // loop cannot, because each browser engine needs its own env.
  for (const [group, where, text] of [
    ["test:e2e", "checks.yml", checksWf],
    ["test:e2e", "release.yml", releaseWf],
  ]) {
    const want = scriptsIn(pkg.scripts[group]);
    const missing = want.filter((f) => !text.includes(f));
    assert(missing.length === 0,
      where + " runs every suite in " + group + " (" + want.length + ")" +
      (missing.length ? " —— 漏了 " + missing.join(", ") : ""));
  }
  // 7.1 (v7-1-plan §3.2): the engine gate is tiered now, and a tier that
  // quietly stops running is exactly the failure this whole block exists to
  // prevent. Three places, one rule each.
  const nightlyWf = fs.readFileSync(path.join(root, ".github/workflows/nightly.yml"), "utf8");
  assert(/--sample=150/.test(checksWf),
    "PR CI 跑抽样的题库门禁 —— 7.0 之前 PR 上一条引擎检查都没有");
  // 7.6: release.yml runs the sampled tier as a matrix, one job per script,
  // so it no longer says `npm run test:engine:sample`. Each command of that
  // npm script must appear in it verbatim, arguments included — a matrix that
  // dropped a script, or dropped `--sample=150` and so ran the two-hour full
  // sweep, fails here just as a missing `npm run` line did.
  const sampleCmds = String(pkg.scripts["test:engine:sample"]).split("&&").map((c) => c.trim()).filter(Boolean);
  const sampleMissing = sampleCmds.filter((c) => !releaseWf.includes(c));
  const fullMined = [...releaseWf.matchAll(/scripts\/test-mined\.mjs(?! --sample=)/g)].length;
  assert((/npm run test:engine:sample/.test(releaseWf) || sampleMissing.length === 0) &&
    !/run: npm run test:engine$/m.test(releaseWf) && fullMined === 0,
    "发布跑的是抽样档，不是两个半小时的全量" +
    (sampleMissing.length ? " —— 漏了 " + sampleMissing.join(", ") : "") +
    (fullMined ? " —— test-mined 没带 --sample" : ""));
  // 7.6: the gates are parallel jobs now, and what used to make "red means
  // no release" true by construction — one job, steps in a row — no longer
  // does. The job that tags and publishes must `needs:` every other job.
  {
    const jobsAt = releaseWf.search(/^jobs:\s*$/m);
    const heads = [...releaseWf.slice(jobsAt).matchAll(/^  ([\w-]+):\s*$/gm)];
    const jobNames = heads.map((m) => m[1]);
    const body = {};
    heads.forEach((m, i) => { body[m[1]] = releaseWf.slice(jobsAt).slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined); });
    const tagger = jobNames.filter((j) => /git push/.test(body[j]) || /--draft=false/.test(body[j]));
    const tagBody = tagger.length === 1 ? body[tagger[0]] : "";
    const needs = ((tagBody.match(/^    needs:\s*\[([^\]]*)\]/m) || [])[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
    const unguarded = jobNames.filter((j) => j !== tagger[0] && !needs.includes(j));
    assert(tagger.length === 1 && jobNames.length > 1 && unguarded.length === 0,
      "release.yml 里打 tag、发布的那个 job needs 其余每一个 job —— 任何一项红了都不发" +
      (tagger.length !== 1 ? "（找到 " + tagger.length + " 个打 tag / 发布的 job）" : "") +
      (unguarded.length ? " —— 没等 " + unguarded.join(", ") : ""));
  }
  // v8-0-plan F1: PR CI is cut up to be fast, and each cut has a way to
  // quietly stop checking something. One assertion per cut.
  {
    const { parseShard, inShard } = await import("./e2e-shard.mjs");
    // the partition itself: every scenario in exactly one shard, for every n
    let partitionOk = true;
    for (let n = 1; n <= 6; n++) {
      for (let k = 0; k < 200; k++) {
        let hits = 0;
        for (let i = 1; i <= n; i++) if (inShard(k, parseShard(i + "/" + n))) hits++;
        if (hits !== 1) partitionOk = false;
      }
    }
    const bad = ["0/4", "5/4", "1/0", "a/b", "2", "1/4/2"].filter((s) => { try { parseShard(s); return true; } catch { return false; } });
    const all = parseShard(""), unset = parseShard(undefined);
    assert(partitionOk && bad.length === 0 && all.count === 1 && unset.count === 1,
      "SHARD=i/n 把每个场景恰好分进一片；不设 SHARD 就是全部；写错的 SHARD 直接报错" +
      (bad.length ? " —— 没拒绝 " + bad.join(", ") : ""));
    // the suite: every top-level block is gated, and the gate is called
    // nowhere else — an ungated block runs in every shard, and a gate called
    // inside a loop shifts every later scenario's index
    const layoutSrc = fs.readFileSync(path.join(root, "scripts/test-layout-e2e.mjs"), "utf8");
    const ungated = [...layoutSrc.matchAll(/^(?:\{|for \(|for await \(|while \(|do \{)[^\n]*/gm)].map((m) => m[0].slice(0, 40));
    const gates = (layoutSrc.match(/^if \(scenario\(\)\) (?:\{|for \()/gm) || []).length;
    const layoutCode = layoutSrc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
    const calls = (layoutCode.match(/\bscenario\(\)/g) || []).length;
    assert(/makeScenarioGate\(process\.env\.SHARD\)/.test(layoutSrc) && gates >= 70 && calls === gates && ungated.length === 0,
      "test-layout-e2e 顶层每个场景都以 `if (scenario())` 开头（" + gates + " 个）" +
      (ungated.length ? " —— 没分片的：" + ungated.join(" | ") : "") +
      (calls !== gates ? " —— scenario() 在门之外还被调了 " + (calls - gates) + " 次" : ""));
    // v8-3-plan V4: a 400 ms fallback in the layout probe carries its own
    // evidence (scenario, resizes asked for and seen, rAFs, visibility) and is
    // counted in the job summary, zero included
    {
      const { PAGE_HOOK, makeFrameWatch } = await import("./lib/frame-watch.mjs");
      const lines = [];
      let now = 1000;
      const fw = makeFrameWatch({ shard: parseShard("3/4"), scenario: () => 42, log: (l) => lines.push(l), keep: 2, clock: () => now });
      const asked = [];
      const fakePage = { setViewportSize: async (s) => { asked.push(s.width + "x" + s.height); } };
      const empty = fw.summary();
      for (const w of [540, 559, 560]) { await fw.resize(fakePage, { width: w, height: 600 }); now += 100; }
      const rec = fw.miss("5b 560×600 open", { rafs: 0, vis: "visible" });
      const tmp = path.join((await import("os")).tmpdir(), "frame-watch-" + process.pid + ".md");
      fs.rmSync(tmp, { force: true });
      const wrote = fw.writeSummary(tmp) && fs.readFileSync(tmp, "utf8");
      fs.rmSync(tmp, { force: true });
      const many = makeFrameWatch({ shard: parseShard("1/5"), log: () => {} });
      for (let i = 0; i < 9; i++) many.miss("5b " + i, {});
      const capped = many.summary();
      const hook = String(PAGE_HOOK);
      const layoutHooked = /addInitScript\(PAGE_HOOK\)/.test(layoutSrc) && /frames\.miss\(/.test(layoutSrc) &&
        /frames\.resize\(page/.test(layoutSrc) && /process\.on\("exit", \(\) => frames\.writeSummary\(\)\)/.test(layoutSrc);
      assert(asked.join() === "540x600,559x600,560x600" && fw.count === 1 &&
        JSON.stringify(rec.asked) === "[[559,600,200],[560,600,100]]" && rec.scenario === 42 && rec.shard === "3/4" &&
        lines.length === 1 && lines[0].startsWith("FRAME-MISS {") && JSON.parse(lines[0].slice(11)).page.rafs === 0 &&
        /layout shard 3\/4: 0 次/.test(empty) && /layout shard 3\/4: 1 次.*#42 5b 560×600 open/.test(wrote) &&
        fw.writeSummary("") === false && /: 9 次.*5b 5，另 3 处/.test(capped) && !/5b 6/.test(capped) && (hook.match(/\braf\(/g) || []).length === 1 && layoutHooked,
        "布局分片 400 ms 兜底时记下场景、最近几次视口变化（要的与页面收到的）、rAF 数与可见性，并在作业摘要里按分片计数（v8-3-plan V4）");
    }
    // both workflows: the layout shards are exactly 1/n..n/n, and wired
    for (const [where, text] of [["checks.yml", checksWf], ["release.yml", releaseWf]]) {
      const shards = [...text.matchAll(/suites: scripts\/test-layout-e2e\.mjs\s*\n\s*shard: (\d+)\/(\d+)/g)].map((m) => [+m[1], +m[2]]);
      const n = shards.length ? shards[0][1] : 0;
      const idx = shards.map(([i]) => i).sort((a, b) => a - b).join(",");
      const whole = /suites:[^\n]*test-layout-e2e\.mjs[^\n]*\n(?!\s*shard:)/.test(text);
      assert(n >= 2 && shards.every(([, m]) => m === n) && idx === Array.from({ length: n }, (_, i) => i + 1).join(",") &&
        !whole && /SHARD: \$\{\{ matrix\.group\.shard \}\}/.test(text),
        where + " 把布局套件切成 1/n…n/n 全部的片，并把 SHARD 传进去（" + shards.map((s) => s.join("/")).join(" ") + "）");
    }
    // v8-4-plan V3: the FRAME-MISS count reaches the job summary in the
    // release rehearsal too, not only in checks.yml. The suite writes it
    // itself (asserted above), so what each workflow has to keep is the step
    // that runs the shard: the same loop in both, a plain `node` on the host
    // (no container, no override of GITHUB_STEP_SUMMARY). And the tally that
    // adds the counts up across saved job logs reads timestamped lines.
    {
      const suiteStep = (text) => {
        const at = text.indexOf("      - name: ${{ matrix.group.name }}\n");
        return at < 0 ? "" : text.slice(at).split(/\n\n|\n  [\w-]+:\s*\n/)[0];
      };
      const cs = suiteStep(checksWf), rs = suiteStep(releaseWf);
      const host = (text) => !/^\s+container:/m.test(text) && !/GITHUB_STEP_SUMMARY\s*:/.test(text);
      const { tally } = await import("./frame-miss-tally.mjs");
      const log = [
        "2026-10-08T01:02:03.4567890Z ok   5b 560×600",
        '2026-10-08T01:02:04.0000000Z FRAME-MISS {"shard":"2/5","scenario":17,"where":"5b 560×600 open","asked":[],"page":{"rafs":0}}',
        "FRAME-MISS {not json",
        "- layout shard 2/5: 2 次量取没等到两帧（明细见日志里的 FRAME-MISS 行）",
      ].join("\r\n");
      const t = tally(log);
      assert(cs.length > 0 && cs === rs && /node "\$s"/.test(cs) && /SUITES: \$\{\{ matrix\.group\.suites \}\}/.test(cs) &&
        host(checksWf) && host(releaseWf) && /FRAME-MISS/.test(checksWf) && /FRAME-MISS/.test(releaseWf) &&
        t.length === 2 && t[0].shard === "2/5" && t[0].scenario === 17 && t[1].raw === "{not json" && tally("").length === 0,
        "release.yml 与 checks.yml 的布局分片用同一个步骤跑、FRAME-MISS 计数都进作业摘要；frame-miss-tally 从带时间戳的作业日志里数（v8-4-plan V3）");
    }
    // v8-4-plan V2: no browser job runs `install --with-deps` (apt-get update
    // and ~180 packages from the mirror, 441 s on a slow day); each one takes
    // its engine's system packages through scripts/ci-browser-deps.mjs and the
    // cache, the same five steps everywhere, before the browser itself
    {
      const D = await import("./ci-browser-deps.mjs");
      const block = (pin) => [
        "      - name: install playwright", "        id: pw", "        run: |",
        "          npm install --no-save playwright@" + pin,
        "          node scripts/ci-browser-deps.mjs key ${{ matrix.engine }}",
      ].join("\n");
      const tail = [
        "      - name: restore ${{ matrix.engine }}'s system packages", "        uses: actions/cache/restore@v6", "        with:",
        "          path: ${{ steps.pw.outputs.dir }}", "          key: ${{ steps.pw.outputs.key }}",
        "      - name: system packages for ${{ matrix.engine }}", "        id: deps",
        "        run: node scripts/ci-browser-deps.mjs install ${{ matrix.engine }}",
        "      - name: cache ${{ matrix.engine }}'s system packages", "        if: steps.deps.outputs.save == 'true'",
        "        uses: actions/cache/save@v6", "        with:",
        "          path: ${{ steps.pw.outputs.dir }}", "          key: ${{ steps.pw.outputs.key }}",
        "      - name: install ${{ matrix.engine }}",
      ].join("\n");
      const bad = [];
      let installs = 0;
      for (const [where, text] of [["checks.yml", checksWf], ["release.yml", releaseWf]]) {
        const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
        if (/--with-deps/.test(code)) bad.push(where + " 还有 --with-deps");
        for (const m of code.matchAll(/npx --yes playwright@(\S+) install \$\{\{ matrix\.engine \}\}\s*$/gm)) {
          installs++;
          const before = code.slice(0, m.index);
          const at = before.lastIndexOf(block(m[1]));
          if (at < 0 || !before.slice(at + block(m[1]).length).replace(/^\n/, "").startsWith(tail)) bad.push(where + " 的 playwright@" + m[1] + " 前面不是那五步");
        }
      }
      const key = (v, e, iv) => D.cacheKey({ version: v, engine: e, env: { ImageOS: "ubuntu24", ImageVersion: iv }, arch: "x64" });
      let noVersion = false;
      try { D.cacheKey({ version: "", engine: "webkit" }); } catch { noVersion = true; }
      assert(installs === 3 && bad.length === 0 &&
        key("1.64.0", "webkit", "20261005.1") === "playwright-1.64.0-webkit-debs-ubuntu24-20261005.1-x64" &&
        key("1.64.0", "webkit", "20261012.1") !== key("1.64.0", "webkit", "20261005.1") &&
        key("1.65.0", "webkit", "20261005.1") !== key("1.64.0", "webkit", "20261005.1") &&
        key("1.64.0", "chromium", "20261005.1") !== key("1.64.0", "webkit", "20261005.1") && noVersion &&
        /Dir::Cache::Archives "\/var\/cache\/apt\/playwright-debs\/"/.test(D.aptConf()) &&
        D.debsIn(path.join(root, "no-such-dir")).length === 0,
        "浏览器作业的系统依赖走缓存（键是 Playwright 版本 + 引擎 + runner 镜像），不再 --with-deps 每次从 apt 镜像下（" + installs + " 处；v8-4-plan V2）" +
        (bad.length ? " —— " + bad.join("；") : ""));
    }
    // v8-2-plan V4: both workflows run the same browser groups (release.yml
    // is where a group that drifted would first matter), no suite runs in
    // two groups, and no job in checks.yml can hang for GitHub's six hours
    const groupBlock = (text) => {
      const at = text.search(/^        group:\s*$/m);
      return at < 0 ? "" : text.slice(at, text.indexOf("\n    name: browser", at) + 1);
    };
    // [name, suites, shard, timeout]; a group the pattern misses (no timeout)
    // leaves the count short of the block's `name:` lines
    const groupsOf = (text) => [...groupBlock(text).matchAll(/name: ([^\n]+)\n\s*suites: ([^\n]+)\n(?:\s*shard: ([^\n]+)\n)?\s*timeout: (\d+)\n/g)]
      .map((m) => [m[1], m[2], m[3] || "", +m[4]]);
    const groupCount = (text) => (groupBlock(text).match(/^\s*(?:- )?name: /gm) || []).length;
    const cg = groupsOf(checksWf), rg = groupsOf(releaseWf);
    const suiteUse = {};
    for (const [, suites, shard] of cg) for (const f of suites.split(/\s+/)) if (!shard) suiteUse[f] = (suiteUse[f] || 0) + 1;
    const twice = Object.keys(suiteUse).filter((f) => suiteUse[f] > 1);
    assert(cg.length >= 10 && cg.length === groupCount(checksWf) && rg.length === groupCount(releaseWf) &&
      JSON.stringify(cg) === JSON.stringify(rg) && twice.length === 0 && cg.every((g) => g[3] > 0 && g[3] <= 60),
      "checks.yml 与 release.yml 的浏览器分组逐条相同、每组有自己的超时（" + cg.map((g) => g[0] + " " + g[3]).join("，") + "）" +
      (twice.length ? " —— 跑了两遍：" + twice.join(", ") : ""));
    // v10-0-plan E2: the groups a pull request runs on Chromium only are
    // groups of the list above, whole (an exclusion has to match exactly, or
    // it silently excludes nothing), the PR's alone, and only WebKit's
    {
      const m = /exclude: \$\{\{ github\.event_name == 'pull_request' && fromJSON\('(.*)'\) \|\| fromJSON\('\[\]'\) \}\}/.exec(checksWf);
      const ex = m ? JSON.parse(m[1].replace(/''/g, "'")) : [];
      const asRow = (g) => JSON.stringify([g.name, g.suites, g.shard || "", g.timeout]);
      const rows = new Set(cg.map((g) => JSON.stringify(g)));
      const names = ex.map((e) => e.group && e.group.name).sort().join(", ");
      assert(ex.length === 7 && ex.every((e) => e.engine === "webkit" && rows.has(asRow(e.group))) &&
        names === "board + clock, lessons, panel layout 1/5, panel layout 2/5, panel layout 3/5, panel layout 4/5, panel layout 5/5" &&
        !/exclude:/.test(releaseWf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")),
        "E2：PR 上布局五片、课程、棋盘 + 棋钟只跑 Chromium（排除项与分组逐字段相同），发布照跑两个引擎（" + names + "）");
      assert(/^  reuse:$/m.test(releaseWf) && /checks\.yml\/runs\?head_sha=\$\{SHA\}&event=push&status=success/.test(releaseWf) &&
        /^  static:\n    needs: reuse\n    if: needs\.reuse\.outputs\.green != 'true'/m.test(releaseWf) &&
        /^  browser:\n    needs: reuse\n    if: needs\.reuse\.outputs\.green != 'true'/m.test(releaseWf) &&
        /needs: \[preflight, reuse, static, engine, browser, build-macos, build-windows\]\n[\s\S]{0,200}if: \$\{\{ !cancelled\(\) && !contains\(needs\.\*\.result, 'failure'\) && !contains\(needs\.\*\.result, 'cancelled'\) \}\}/.test(releaseWf),
        "E2：同一提交在 main 上的 checks 已绿时，发布复用静态与浏览器两道门；引擎门与两个平台构建照跑；失败或取消照样不发布");
    }
    // v10-0-plan E4: every id in the page is one something uses — a script,
    // the stylesheet, the page's own aria-*/for, or a test. Twenty were
    // not (9.0 review); an id nothing reads is a name that only looks used.
    // The ids built by joining (`"result-" + side`, `id + "-cv"`) are named.
    {
      const page = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
      const rest = page.replace(/\bid="[^"]+"/g, "");
      const read = [...WEB_MODULES.values()].join("\n") + fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8") +
        fs.readdirSync(path.join(root, "scripts")).filter((n) => n.endsWith(".mjs") && !n.startsWith("_")).map((n) => fs.readFileSync(path.join(root, "scripts", n), "utf8")).join("\n");
      const JOINED = new Set(["result-w", "result-b", "today-r-game-cv", "today-r-pz-cv"]);
      const esc = (x) => x.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
      const unread = ids.filter((id) => !JOINED.has(id) &&
        !new RegExp("(?:aria-[a-z]+|for)=\"[^\"]*\\b" + esc(id) + "\\b").test(rest) &&
        !new RegExp("[\"'`#]" + esc(id) + "(?![\\w-])").test(read));
      assert(unread.length === 0, "E4：页面里每个 id 都有人用（脚本、样式、页面自己的 aria / for，或测试）" + (unread.length ? " —— 没人用：" + unread.join(", ") : ""));
    }
    // v8-3-plan V4: any suite may be sharded now (engine flows too), not only
    // the layout one. A sharded group holds that one suite alone (SHARD would
    // cut every suite in it), its shards are exactly 1/n..n/n, it runs in no
    // unsharded group, and the suite reads SHARD through the gate
    const sharded = {};
    for (const [, suites, shard] of cg) if (shard) (sharded[suites] = sharded[suites] || []).push(shard);
    const badShards = Object.entries(sharded).filter(([suites, list]) => {
      const n = +list[0].split("/")[1];
      const idx = list.map((s) => s.split("/")).filter(([, m]) => +m === n).map(([i]) => +i).sort((a, b) => a - b).join(",");
      const suiteText = /^scripts\/[\w-]+\.mjs$/.test(suites) && fs.existsSync(path.join(root, suites)) ? fs.readFileSync(path.join(root, suites), "utf8") : "";
      return n < 2 || list.length !== n || idx !== Array.from({ length: n }, (_, i) => i + 1).join(",") ||
        suiteUse[suites] || !/makeScenarioGate\(process\.env\.SHARD\)/.test(suiteText);
    }).map(([s]) => s);
    assert(Object.keys(sharded).length >= 2 && badShards.length === 0,
      "分片的套件各自独占分组、1/n…n/n 齐全、没有另在不分片的组里跑、读的是 SHARD（" +
      Object.entries(sharded).map(([s, l]) => s.replace(/^scripts\//, "") + " ×" + l.length).join("，") + "）" +
      (badShards.length ? " —— 不对：" + badShards.join(", ") : ""));
    const cJobsAt = checksWf.search(/^jobs:\s*$/m);
    const cHeads = [...checksWf.slice(cJobsAt).matchAll(/^  ([\w-]+):\s*$/gm)];
    const noLimit = cHeads.filter((m, i) => {
      const body = checksWf.slice(cJobsAt).slice(m.index, i + 1 < cHeads.length ? cHeads[i + 1].index : undefined);
      return !/^    timeout-minutes: (\d+|\$\{\{ matrix\.group\.timeout \}\})\s*$/m.test(body);
    }).map((m) => m[1]);
    assert(cHeads.length >= 4 && noLimit.length === 0,
      "checks.yml 每个 job 都有 timeout-minutes（" + cHeads.length + " 个）" + (noLimit.length ? " —— 没有：" + noLimit.join(", ") : ""));
    // the PR wall-clock is computed from the run, not typed in
    const WC = await import("./ci-wallclock.mjs");
    const job = (name, c, s, e, concl = "success") => ({ run_id: 7, head_sha: "abcdef12", name, created_at: c, started_at: s, completed_at: e, conclusion: concl });
    const wc = WC.wallClock([job("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:13:00Z"),
      job("b", "2026-01-01T00:00:05Z", "2026-01-01T00:00:30Z", "2026-01-01T00:14:30Z"),
      { name: "skipped", conclusion: "skipped", started_at: null }]);
    let stillRunning = false;
    try { WC.wallClock([job("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", null)]); } catch { stillRunning = true; }
    const runs = WC.merge([{ run: 1, wall: 20, green: true }, { run: 2, wall: 14, green: true }], [{ run: 1, wall: 12, green: true }, { run: 3, wall: 15, green: true }]);
    assert(wc.wall === 14.5 && wc.critical === "b" && wc.criticalMin === 14 && wc.jobs === 2 && wc.green && stillRunning &&
      runs.map((r) => r.wall).join() === "12,14,15" && WC.lastThreeOk(runs) && !WC.lastThreeOk(runs.slice(1)) &&
      !WC.lastThreeOk(runs.concat({ run: 4, wall: 15.1, green: true })),
      "PR 墙钟从作业的起止时间算（第一个排队 → 最后一个结束），同一 run 重记是替换，最近三次全绿且 ≤ 15 分钟才算达标");
    // v8-2-plan V4 (M1 评审): the screenshots job is continue-on-error — its
    // failure leaves the PR green, so it leaves the run green here too
    const T = ["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:05:00Z"];
    const shotsOnly = [job("unit", ...T), job("screenshots (webkit, not a gate)", ...T, "failure")];
    const realFail = [job("unit", ...T, "failure"), job("screenshots (webkit, not a gate)", ...T)];
    assert(WC.wallClock(shotsOnly).green && WC.wallClock(shotsOnly, { conclusion: "success" }).green &&
      !WC.wallClock(realFail).green && !WC.wallClock(realFail, { conclusion: "failure" }).green &&
      !WC.wallClock(shotsOnly, { conclusion: "failure" }).green && WC.wallClock(realFail).notGreen.join() === "unit: failure",
      "PR 墙钟的「全绿」看 run 自己的结论；没有 run 时不算 continue-on-error 的作业（截图）");
    const coe = cHeads.map((m, i) => checksWf.slice(cJobsAt).slice(m.index, i + 1 < cHeads.length ? cHeads[i + 1].index : undefined))
      .filter((body) => /^    continue-on-error: true\s*$/m.test(body));
    assert(coe.length >= 1 && coe.every((body) => /^    name: .*\bnot a gate\b/m.test(body) && WC.notAGate(body.match(/^    name: (.*)$/m)[1])),
      "checks.yml 里 continue-on-error 的作业名字都写着「not a gate」—— ci-wallclock 没有 run 结论时靠它认（" + coe.length + " 个）");
    // checks.yml: push only for main, stale PR runs cancelled, the sampled
    // puzzle search on ubuntu only, and Windows native compiled on every PR
    const zigAt = checksWf.search(/^  zig:\s*$/m);
    const zigJob = zigAt < 0 ? "" : checksWf.slice(zigAt).split(/\n  [\w-]+:\s*\n/)[0];
    assert(/^on:\s*\n  push:\s*\n    branches: \[main\]\s*$/m.test(checksWf),
      "checks.yml 的 push 只在 main 上跑 —— 其余分支有 PR 就够了，不再同一棵树跑两遍");
    assert(/^concurrency:\s*\n  group: checks-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}\s*\n  cancel-in-progress: true\s*$/m.test(checksWf),
      "checks.yml 取消同一个 PR 上被新提交顶掉的旧运行");
    // v8-3-plan V4: in a job of its own (`mined`), no longer a step of static
    const minedAt = checksWf.search(/^  mined:\s*$/m);
    const minedJob = minedAt < 0 ? "" : checksWf.slice(minedAt).split(/\n  [\w-]+:\s*\n/)[0];
    assert(/^    runs-on: ubuntu-latest\s*$/m.test(minedJob) && /run: node scripts\/test-mined\.mjs --sample=150/.test(minedJob) &&
      /run: python3 scripts\/test-verify-endgames\.py/.test(minedJob) &&
      (checksWf.match(/scripts\/test-mined\.mjs/g) || []).length === 1,
      "150 题抽样校验只在 ubuntu 上跑一遍（自己一个作业）—— 它和平台无关");
    assert(/os: windows-latest\s*\n\s*flags: -Dplatform=windows/.test(zigJob) && /os: macos-latest/.test(zigJob) &&
      /run: zig build test \$\{\{ matrix\.flags \}\}/.test(zigJob) && /runs-on: \$\{\{ matrix\.os \}\}/.test(zigJob),
      "checks.yml 的 zig job 在 windows-latest 上编译并跑 zig build test —— PR 上也编译 Windows 原生");
  }
  assert(/run: npm run test:engine$/m.test(nightlyWf),
    "全量那一趟有人跑 —— 抽样只覆盖 15%，剩下的 85% 在 nightly");
  assert(scriptsIn(pkg.scripts["test:engine:sample"]).length === scriptsIn(pkg.scripts["test:engine"]).length,
    "抽样档少的是搜索量，不是脚本数 —— 抽样不等于少跑几个套件");
}

// --- 7.0: every FEN this app ships must be a position that can exist ---------
//
// `ChessEditor.validate` has known since 6.0 that a pawn cannot stand on its
// own back rank — and nothing had ever run the app's OWN content through it.
// One knight lesson drew the "surrounded by your own pawns" box from c1 to e3,
// which puts three white pawns on the first rank. chess.js accepts it and
// Stockfish 18 evaluated it, so it shipped and was played for eleven versions.
//
// Stockfish 19 does not: `position fen` on that square set aborts the whole
// wasm module with `RuntimeError: unreachable`. An aborted module is not a
// crashed search — every later ccall hits the same trap, so 6.1's engine
// self-healing cannot get back from it either. The engine upgrade turned a
// cosmetic illegality into a dead engine on a beginner lesson.
//
// So: run the content through the guard that already existed.
{
  const Ed = ctx.ChessEditor;
  const seen = new Set();
  let bad = 0, checked = 0;
  const vet = (fen, where) => {
    if (!fen || seen.has(fen)) return;
    seen.add(fen);
    checked++;
    // allowTerminal: a puzzle may start from a position with no legal move
    // (a mate to recognise); that is content, not corruption. Everything
    // structural — piece counts, kings, pawns on a back rank, an impossible
    // en-passant square — is what this is here for.
    let why = null;
    try { why = Ed.validate(Ed.fromFen(fen, ctx.Chess), ctx.Chess, { allowTerminal: true }); }
    catch (err) { why = "threw: " + err.message; }
    if (why) { bad++; console.error("FAIL: " + where + " 的局面不合法 (" + why + "): " + fen); }
  };
  for (const L of (ctx.CHESS_LESSONS || []).concat(ctx.CHESS_LESSONS_ADV_ZH || [])) {
    for (const t of L.tasks || []) vet(t.fen, "课程 " + L.id);
  }
  for (const p of ctx.CHESS_PUZZLES || []) vet(p.fen, "题目 " + p.id);
  // the mined set too — it is generated, which is exactly the reason a bad
  // position could arrive in bulk without anyone typing it
  {
    const mctx = { console, Date, performance };
    mctx.globalThis = mctx; mctx.window = mctx;
    vm.createContext(mctx);
    loadModule(mctx, "src/web/js/puzzles-mined.js");
    for (const p of mctx.MINED_PUZZLES || []) vet(p.fen, "挖掘题 " + p.id);
  }
  assert(checked > 1000, "课程、题目与挖掘题的局面都取到了 (" + checked + ")");
  assert(bad === 0, "每一个随应用发布的局面都是真能出现的局面 —— " +
    "兵不在底线、王各一个、吃过路兵格站得住 (" + checked + " 个)");
}

// --- 6.1: an impossible [FEN] must not be quietly repaired -------------------
//
// ChessEditor exists to reject positions chess.js accepts. fromFen() used to
// build its board with `new Chess(fen).board()`, and chess.js tracks one king
// square per colour, so a FEN with two white kings arrived at validate() with
// one already dropped: the guard said yes and the app loaded a position that
// was not the one in the file. The no-king half worked, which is why it went
// unseen.
{
  loadModule(ctx, "src/web/js/editor.js");
  const E6 = ctx.ChessEditor;
  const two = "4k3/8/8/8/8/8/8/K3K3 w - - 0 1";
  assert(new Chess().validate_fen(two).valid, "chess.js itself accepts two white kings");
  const st = E6.fromFen(two, Chess);
  const kings = st.board.flat().filter((p) => p && p.type === "k" && p.color === "w").length;
  assert(kings === 2, "fromFen() reads the board field as written (" + kings + " white kings)");
  assert(E6.validate(st, Chess) === "edErr.manyWhiteKings", "…so validate() can reject it");
  const one = "4k3/8/8/8/8/8/8/4K3 w - - 0 1";
  assert(E6.validate(E6.fromFen(one, Chess), Chess) === null, "…and an ordinary position still passes");
  assert(E6.boardFromFenField("8/8/8/8/8/8/8") === null, "a board field with seven ranks is not a board");
  assert(E6.boardFromFenField("9/8/8/8/8/8/8/8") === null, "…nor is one with nine empty squares in a rank");
}

// --- 6.1 (review): a terminal [FEN] is a normal file, not an invalid one -----
//
// The import path reuses ChessEditor.validate for the structural and
// reachability checks. validate() also refuses a position with no legal move,
// which is right for the editor (there would be nothing to play) and wrong
// here: a game that starts from a checkmate or a stalemate is an ordinary
// study or a finished game, and those files were importable before 6.1 wired
// the validator in. opts.allowTerminal separates the two policies.
{
  const E7 = ctx.ChessEditor;
  const mate = "7k/5KQ1/8/8/8/8/8/8 b - - 0 1";
  const stale = "7k/5Q2/6K1/8/8/8/8/8 b - - 0 1";
  const mp = new Chess(mate), sp = new Chess(stale);
  assert(mp.in_checkmate(), "the mate fixture really is a checkmate");
  assert(sp.in_stalemate(), "the stalemate fixture really is a stalemate");
  assert(E7.validate(E7.fromFen(mate, Chess), Chess) === "edErr.alreadyMate",
    "the editor still refuses to set up a finished position");
  assert(E7.validate(E7.fromFen(stale, Chess), Chess) === "edErr.alreadyStalemate", "…stalemate too");
  assert(E7.validate(E7.fromFen(mate, Chess), Chess, { allowTerminal: true }) === null,
    "…and the import path takes a checkmate [FEN]");
  assert(E7.validate(E7.fromFen(stale, Chess), Chess, { allowTerminal: true }) === null,
    "…and a stalemate [FEN]");
  // allowTerminal relaxes only that one rule — everything above it still bites
  assert(E7.validate(E7.fromFen("4k3/8/8/8/8/8/8/K3K3 w - - 0 1", Chess), Chess, { allowTerminal: true })
    === "edErr.manyWhiteKings", "…while two white kings are still rejected");
  // app.js's own wiring is checked where it can be checked behaviourally —
  // scripts/test-content-e2e.mjs imports a PGN whose [FEN] is a checkmate and
  // asserts the board loads it. A source-text assertion here would be a fifth
  // entry in a register that only ever shrinks.
}

// --- 7.3: the sheet breakpoint is one string, asked of the browser ---------
//
// The narrow-portrait layout exists in CSS (a media query) and the app has to
// know when it is in force (the onboarding must not end by raising a sheet
// over the board). Two copies of "560px" in two languages is exactly the kind
// of pair that drifts, so app.js asks `matchMedia` with the *same query text*
// — and this asserts the two strings really are the same one.
{
  const appSrc = allAppSource;
  const cssSrc = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
  const m = /const SHEET_QUERY = "([^"]+)"/.exec(appSrc);
  assert(!!m, "app.js 把那条媒体查询写成一个具名常量");
  if (m) {
    assert(cssSrc.includes("@media " + m[1]),
      "……而样式表里就是同一条查询，一字不差（" + m[1] + "）");
  }
  // 用它的地方只有一处：引导结束时要不要把面板打开
  assert((appSrc.match(/panelCoversBoard\(\)/g) || []).length >= 2,
    "定义它、并且真的有人用它 —— 常量本身不是护栏");
}

// --- v8-0-plan A2: when the wide layout is used, as a rule ------------------
// play-layout.js decides `pv-wide` from the play view's size and the
// stylesheet's lengths. The rule is "≥ 1280 wide, landscape, and the board no
// smaller than in the two-column layout" — so here: the five acceptance sizes
// land where A2 says, a tall 1280 window keeps the old layout (the wide one
// would shrink its board), and the lengths the function reads are the ones
// the stylesheet declares.
{
  const { boardEdges, isWide, WIDE_MIN } = await import("../src/web/js/play-layout.js");
  const cssSrc = fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8");
  const tok = (n) => { const m = new RegExp(n + ":\\s*(\\d+)px").exec(cssSrc); return m ? Number(m[1]) : NaN; };
  const k = { chrome: tok("--chrome-h"), strip: tok("--strip-h"), pad: tok("--stage-pad"), padY: tok("--stage-pad-y"),
              info: tok("--info-w"), gap: tok("--info-gap"), sideMax: tok("--side-max-wide") };
  assert(Object.values(k).every(Number.isFinite), "A2：宽布局用到的长度样式表里都有（" + JSON.stringify(k) + "）");
  assert(WIDE_MIN === 1280, "A2：宽布局从 1280 起算");
  // M2 (A1 × A2): 30% of the play view, which is the window less the rail
  assert(cssSrc.includes("--side-w: clamp(284px, 0.3 * var(--pv-w), 440px);") && cssSrc.includes("--pv-w: calc(100vw - var(--rail-w));"),
    "A2：两栏布局的面板宽度是 clamp(284px, 30% 下棋视图, 440px)，下棋视图 = 窗口 − 导航栏，boardEdges 按同一条算");
  const at = (w, h) => isWide(w, h, k);
  assert(!at(1024, 768) && at(1280, 800) && at(1440, 900) && at(1920, 1080) && !at(600, 900) && !at(1400, 900),
    "A2：1280 / 1440 / 1920 用宽布局，1024、600 与 1400×900 不用（1400 那里宽布局的棋盘比两栏小）");
  assert(!at(1280, 1024), "A2：1280×1024 不用 —— 那里宽布局会让棋盘变小");
  for (const [w, h] of [[1280, 800], [1366, 768], [1440, 900], [1920, 1080], [2560, 1440]]) {
    const e = boardEdges(w, h, k);
    const two = Math.min(440, Math.max(284, 0.3 * w));
    assert(!at(w, h) || (e.wide >= e.two && e.right >= two && e.right <= Math.max(two, k.sideMax)),
      `A2：${w}×${h} 棋盘 ${e.two} → ${e.wide}，右栏 ${two} → ${e.right}（不窄于两栏布局，至多 ${k.sideMax}）`);
  }
  // M2 (A2 × A1): the two-column panel stretches into what the height-bound
  // board leaves, up to --side-max-wide — one formula, written twice: here in
  // boardEdges (sideTwo) and in styles.css (#app --side-w, ≥ 821px)
  const flat = cssSrc.replace(/\s+/g, " ");
  assert(flat.includes("--side-w: clamp(clamp(284px, 0.3 * var(--pv-w), 440px), var(--pv-w) - 2 * var(--stage-pad) - (var(--pv-h) - var(--chrome-h) - 2 * var(--strip-h) - var(--stage-pad-y)), var(--side-max-wide));"),
    "M2：两栏面板 = clamp(两栏下限, 视图宽 − 边距 − 棋盘, --side-max-wide)，样式表里就是这一条");
  for (const [w, h] of [[960, 768], [1216, 800], [1376, 900], [1136, 900], [1336, 900], [1856, 1080]]) {
    const e = boardEdges(w, h, k);
    const high = h - k.chrome - 2 * k.strip - k.padY;
    const want = Math.min(k.sideMax, Math.max(e.side, w - 2 * k.pad - high));
    assert(e.sideTwo === want && e.two === Math.min(high, w - e.side - 2 * k.pad) && (e.sideTwo === k.sideMax || e.two < high || w - e.sideTwo - 2 * k.pad === e.two),
      `M2：视图 ${w}×${h} 两栏面板 ${e.side} → ${e.sideTwo}，棋盘仍是 ${e.two}（面板只拿棋盘留下的宽度，至多 ${k.sideMax}）`);
  }
}

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
  const APP_JS_LINE_CEILING = 5722; // 10.0: 5,744 → 5722
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

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
