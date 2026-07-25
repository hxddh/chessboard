/**
 * Node tests for the vendored rules engine (chess.js) — the app's single
 * source of truth for legality. Run: node scripts/test-chess.mjs
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(root, "src/web/js/chess.js"), "utf8"), ctx, { filename: "chess.js" });
const Chess = ctx.Chess;

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
    if (!p.name || !["m1", "m2", "m3", "win", "tac"].includes(p.cat)) { fail(p.id, "bad name/cat"); continue; }
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

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
