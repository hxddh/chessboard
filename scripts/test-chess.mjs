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
        // skewer/deflection: every black reply lets white capture target ≥ gain
        if (!gt.in_check()) fail(p.id, "3-ply tac first move should check");
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
