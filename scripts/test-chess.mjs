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

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
