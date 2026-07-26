/**
 * Node tests for the vendored rules engine (chess.js) — the app's single
 * source of truth for legality. Run: node scripts/test-chess.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { scanAll } from "./scope-check.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/chess.js"), "utf8"), ctx, { filename: "chess.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/openings.js"), "utf8"), ctx, { filename: "openings.js" });
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
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/lessons.js"), "utf8"), ctx, { filename: "lessons.js" });
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
  }

  // English lessons: every lesson must be covered, and every entry must line
  // up with the Chinese original — a translation that describes a different
  // task is worse than none at all. 1.5 shipped a 9-lesson "pilot" while the
  // release notes said the English UI was done; coverage is asserted now.
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/lessons-en.js"), "utf8"), ctx, { filename: "lessons-en.js" });
  const en = ctx.CHESS_LESSONS_EN;
  const uncovered = lessons.filter((L) => !en || !en[L.id]).map((L) => L.id);
  for (const id of uncovered) console.error("FAIL: lesson has no English text: " + id);
  assert(uncovered.length === 0, "all " + lessons.length + " lessons have English text");
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
      if (tr.tasks.length > L.tasks.length) failEn(id, "more translated tasks than real ones");
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
  assert(badEn === 0, "English lessons match the originals");

  // No Chinese may survive in the English lesson text itself.
  let hanEn = 0;
  const walk = (v, where) => {
    if (typeof v === "string") { if (/[一-鿿]/.test(v)) { hanEn++; console.error("FAIL: Chinese in English lesson " + where + ": " + v); } return; }
    if (Array.isArray(v)) return v.forEach((x, i) => walk(x, where + "[" + i + "]"));
    if (v && typeof v === "object") return Object.entries(v).forEach(([k, x]) => walk(x, where + "." + k));
  };
  walk(en, "en");
  assert(hanEn === 0, "English lesson text contains no Chinese");
}

// English names for puzzles and openings: the app falls back to the Chinese
// name when one is missing, so only a coverage check keeps English mode honest
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/puzzles.js"), "utf8"), ctx, { filename: "puzzles.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/puzzles-en.js"), "utf8"), ctx, { filename: "puzzles-en.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/openings.js"), "utf8"), ctx, { filename: "openings.js" });
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/openings-en.js"), "utf8"), ctx, { filename: "openings-en.js" });
  const pz = ctx.CHESS_PUZZLES, pzEn = ctx.CHESS_PUZZLES_EN;
  const op = ctx.CHESS_OPENINGS, opEn = ctx.CHESS_OPENINGS_EN;
  const han = /[一-鿿]/;
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };

  for (const p of pz) {
    const tr = pzEn[p.id];
    if (!tr) { fail("puzzle has no English name:", p.id); continue; }
    if (!tr.name || han.test(tr.name)) fail("puzzle name not translated:", p.id, tr.name);
    // a motif is shown in the goal line, so it must be translated wherever one exists
    if (!!p.motif !== !!tr.motif) fail("puzzle motif mismatch:", p.id, p.motif, "vs", tr.motif);
    if (tr.motif && han.test(tr.motif)) fail("puzzle motif not translated:", p.id, tr.motif);
  }
  for (const id of Object.keys(pzEn)) {
    if (!pz.some((p) => p.id === id)) fail("English text for unknown puzzle:", id);
  }
  assert(bad === 0, "all " + pz.length + " puzzles have English names");

  bad = 0;
  const opNames = new Set(op.map((o) => o[1]));
  for (const n of opNames) {
    if (!opEn[n]) { fail("opening has no English name:", n); continue; }
    if (han.test(opEn[n])) fail("opening name not translated:", n, "->", opEn[n]);
  }
  for (const n of Object.keys(opEn)) {
    if (!opNames.has(n)) fail("English name for unknown opening:", n);
  }
  assert(bad === 0, "all " + opNames.size + " opening names have English text");

  // The drills also show the line's idea. Only lines long enough to be drilled
  // (≥6 plies, the same filter app.js applies) ever display one, so that is
  // exactly the set that needs translating — no more, no less.
  bad = 0;
  const ideaEn = ctx.CHESS_OPENING_IDEAS_EN || {};
  const drilled = op.filter((o) => o[2].split(" ").length >= 6);
  for (const [, name, , idea] of drilled) {
    if (!idea) { fail("drilled opening has no idea line:", name); continue; }
    if (!ideaEn[name]) { fail("opening idea has no English text:", name); continue; }
    if (han.test(ideaEn[name])) fail("opening idea not translated:", name);
  }
  for (const n of Object.keys(ideaEn)) {
    if (!drilled.some((o) => o[1] === n)) fail("English idea for an opening that is never drilled:", n);
  }
  assert(bad === 0, "all " + drilled.length + " drilled openings have an English idea");
}

// puzzles: legal positions (white to move, black not already in check),
// m1 solutions mate, m2 first moves FORCE mate against every defense
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/puzzles.js"), "utf8"), ctx, { filename: "puzzles.js" });
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
    if (!p.name || !["m1", "m2", "m3", "win", "tac", "def", "draw"].includes(p.cat)) { fail(p.id, "bad name/cat"); continue; }
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/i18n.js"), "utf8"), ctx, { filename: "i18n.js" });
  const dictK = ctx.ChessI18n.DICT;
  for (const lang of Object.keys(dictK)) {
    const missing = helpKeys.filter((k) => !(k in dictK[lang]));
    assert(missing.length === 0,
      lang + " translates the whole shortcut sheet" + (missing.length ? " (missing " + missing.join(", ") + ")" : ""));
  }

  // The native menu was declared-but-empty from 1.0 to 1.9: main.zig forwarded
  // menu commands to the page and app.zon defined no menus, so on a desktop
  // app the menu bar had nothing in it.
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
    // the two rows that pick a view are one control, not two
    const modeH = /\.theme-row\.mode-nav button\s*\{[^}]*min-height:\s*var\(--row-h\)/.test(stripped);
    const tabH = /\.side-tabs button\[role="tab"\]\s*\{[^}]*min-height:\s*var\(--row-h\)/.test(stripped);
    assert(modeH && tabH, "the mode row and the tab row are the same height token");
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

  // the action rows share one set of columns. As flex + space-between + wrap
  // they laid out differently in every group — 3 items spread edge to edge,
  // 4 packed tight at widths 40–64, a 5th orphaned on its own line.
  {
    const row = /\.link-row \{([\s\S]*?)\}/.exec(stripped);
    assert(row, "found the action row rule");
    assert(/display:\s*grid/.test(row[1]), "action rows are a grid");
    assert(/grid-template-columns:\s*repeat\(3/.test(row[1]), "three fixed columns");
    assert(!/space-between/.test(row[1]), "no space-between — that is what made every row different");
  }

  // mode and tabs are both navigation, so they get one grammar. Until 1.12
  // they were a 12px pill row and an underlined tab row stacked together.
  {
    const mode = /\.theme-row\.mode-nav button \{([\s\S]*?)\n    \}/.exec(stripped);
    assert(mode, "the mode row has its own rule");
    assert(/border-bottom:\s*2px solid/.test(mode[1]), "mode marks selection with an underline, like the tabs");
    assert(!/border-radius:\s*var\(--radius-md\)/.test(mode[1]), "no pill");
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
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const sel = theme === "wood" ? ":root, \\[data-theme=\"wood\"\\]" : "\\[data-theme=\"" + theme + "\"\\]";
    const blk = new RegExp(sel + "\\s*\\{([\\s\\S]*?)\\n    \\}").exec(stripped);
    assert(blk, theme + " theme block found");
    for (const v of ["--sq-light", "--sq-dark", "--sq-sel", "--sq-last", "--sq-check",
                     "--sq-dot", "--sq-ring", "--coord-ink", "--danger", "--primary-from"]) {
      assert(blk[1].includes(v + ":"), theme + " defines " + v);
    }
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
  for (const theme of ["wood", "night", "day", "notebook"]) {
    const sel = theme === "wood" ? /:root, \[data-theme="wood"\]\s*\{([\s\S]*?)\n    \}/
      : new RegExp('\\[data-theme="' + theme + '"\\]\\s*\\{([\\s\\S]*?)\\n    \\}');
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/persona.js"), "utf8"), ctx, { filename: "persona.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/i18n.js"), "utf8"), ctx, { filename: "i18n.js" });
  const dict = ctx.ChessI18n.DICT;
  for (const lang of Object.keys(dict)) {
    const missing = P.IDS.filter((id) => !("persona." + id in dict[lang]));
    assert(missing.length === 0, lang + " names every personality");
  }
}

// FIDE draw arithmetic: repetition counting and the 6.9 material test decide
// real game results, so they get their own checks
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/fide.js"), "utf8"), ctx, { filename: "fide.js" });
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
}

// PGN utilities: splitting a multi-game file must not lose games (importing a
// database used to silently keep only the last one)
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/pgn.js"), "utf8"), ctx, { filename: "pgn.js" });
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
}

// position editor: FEN generation plus the legality rules chess.js does not
// enforce on its own (an editor must never hand the game an unplayable FEN)
{
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/editor.js"), "utf8"), ctx, { filename: "editor.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/review.js"), "utf8"), ctx, { filename: "review.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/material.js"), "utf8"), ctx, { filename: "material.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/opening-coach.js"), "utf8"), ctx, { filename: "opening-coach.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/i18n.js"), "utf8"), ctx, { filename: "i18n.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/srs.js"), "utf8"), ctx, { filename: "srs.js" });
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/i18n.js"), "utf8"), ctx, { filename: "i18n.js" });
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
    ja: new Set(["act.pgnCopy", "act.fen", "hist.pgn", "vs.white", "stats.gamesSuffix",
      "learn.lessonPre", "ed.crK", "ed.crQ"]),
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
  const markers = [...appSrc.matchAll(/recordOutcome\([^)]*"#([a-zA-Z]+)"/g)].map((m) => m[1]);
  const restore = /function restoreEnding\(rec\) \{[\s\S]*?\n  \}/.exec(appSrc);
  const handled = restore ? [...restore[0].matchAll(/end === "([a-zA-Z]+)"/g)].map((m) => m[1]) : [];
  let unhandled = 0;
  assert(markers.length >= 3 && handled.length >= 3, "found the ending markers and the history reader");
  for (const k of new Set(markers)) {
    if (!handled.includes(k)) { unhandled++; console.error("FAIL: history cannot restore the #" + k + " ending"); }
  }
  assert(unhandled === 0, "all " + new Set(markers).size + " ending markers survive a trip through the history");

  // …and the marker must never be mistaken for part of the movetext. A
  // checkmate ends in a bare "#", which the stripper has to leave alone.
  const stripper = /historyPgn\(rec\) \{\s*return String\(rec\.sig \|\| ""\)\.replace\((\/[^/]+\/[a-z]*)/.exec(appSrc);
  assert(!!stripper, "found the sig → PGN stripper");
  const stripRe = new RegExp(stripper[1].slice(1, stripper[1].lastIndexOf("/")), stripper[1].slice(stripper[1].lastIndexOf("/") + 1));
  const mate = "1. e4 e5 2. Bc4 Nc6 3. Qh5 Nf6 4. Qxf7#";
  assert(mate.replace(stripRe, "") === mate, "a checkmate's # survives the stripper");
  for (const k of new Set(markers)) {
    assert((mate + "#" + k).replace(stripRe, "") === mate, "the #" + k + " marker is stripped, the mate is not");
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/achievements.js"), "utf8"), ctx, { filename: "achievements.js" });
  const ach = ctx.CHESS_ACHIEVEMENTS;
  assert(Array.isArray(ach) && ach.length >= 10, "achievements loaded (" + (ach ? ach.length : 0) + ")");
  const ids = new Set();
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  // a maxed-out summary should unlock everything, an empty one nothing (except
  // completionist is gated on others so it also stays locked when empty)
  const full = {
    lessonsDone: 99, lessonsTotal: 28, puzzleSolvedCount: 99,
    matesSolved: 23, matesTotal: 23, tacSolved: 6, tacTotal: 6,
    opSolved: 38, opTotal: 38, wins: 99, losses: 0, draws: 0, games: 99, extremeWins: 9,
    otherUnlocked: 11, otherTotal: 11,
  };
  const empty = {
    lessonsDone: 0, lessonsTotal: 28, puzzleSolvedCount: 0,
    matesSolved: 0, matesTotal: 23, tacSolved: 0, tacTotal: 6,
    opSolved: 0, opTotal: 38, wins: 0, losses: 5, draws: 0, games: 5, extremeWins: 0,
    otherUnlocked: 0, otherTotal: 11,
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

// --- free variables: the one lint rule that would have saved 1.12 and 1.13 ---
// `CHECK` was read in board.js and declared nowhere, so every check threw
// inside draw() before a single piece was painted. Two versions shipped that
// way because the assertions above are static and the stress sweeps never
// produced a check. scripts/scope-check.mjs closes that door for good.
{
  const bad = scanAll();
  for (const b of bad) console.error("  " + b);
  assert(bad.length === 0, "no identifier is read without being bound");
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
  vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8"), bctx, { filename: "board.js" });
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

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
