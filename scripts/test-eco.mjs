/**
 * The position-keyed ECO table and its lookup (v6-plan Q2.7).
 *
 * Three claims that a prefix book cannot make: a transposition classifies
 * the same as the main move order, a game started from a `[FEN]` classifies
 * at all, and every line of the curated book is found in the full table.
 *
 * The last one is not quite true, and the test says so precisely: the book
 * and lichess file some deep lines under neighbouring codes (the book's
 * "Ruy Lopez, Closed Main Line" is C88 in the book, C92 by the 17th ply in
 * lichess). Those are registered below, by book line, and the register may
 * only shrink — an entry that stops mismatching must be deleted, a new
 * mismatch fails. Same rule as the other registers in scripts/test-chess.mjs.
 *
 * Run: node scripts/test-eco.mjs
 */
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ctx = { console };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const m of ["chess.js", "eco-lookup.js", "openings.js", "openings-en.js", "openings-ja.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", m)), ctx, { filename: m });
}
const { Chess, ChessEco, CHESS_OPENINGS, CHESS_OPENING_NAMES, CHESS_OPENINGS_JA } = ctx;

let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}

/**
 * Book lines whose deepest table position lichess files under another code.
 * `book id` → lichess code at the deepest hit. Shrink-only.
 */
const TOLERATED = {
  "A01 nimzo-larsen-main": "A13",
  "A13 reti-opening-main-line": "A14",
  "A58 benko-gambit-accepted": "A59",
  "A70 modern-benoni-main-line": "A76",
  "A95 dutch-defence-stonewall": "A90",
  "B02 alekhines-defence-four-pawns-attack": "B03",
  "B07 pirc-defense": "B00",
  "B23 closed-sicilian-main": "B25",
  "B34 sicilian-defense-accelerated-dragon": "B32",
  "B47 sicilian-taimanov": "B49",
  "B51 sicilian-rossolimo": "B31",
  "B84 sicilian-scheveningen": "B83",
  "C00 french-defence-kings-indian-attack": "A08",
  "C44 scotch-gambit": "C54",
  "C50 italian-game-giuoco-pianissimo": "C54",
  "C58 two-knights-defence": "C59",
  "C88 ruy-lopez-closed-main-line": "C92",
  "D00 london-jobava": "D01",
  "D10 slav-defence-exchange": "D14",
  "D45 semi-slav-anti-meran": "D46",
  "D87 grunfeld-exchange-classical": "D86",
  "E00 indian-defense": "A50",
  "E06 catalan-opening-closed": "E05",
  "E53 nimzo-indian-rubinstein": "E58",
  "E60 kings-indian-fianchetto": "E69",
  "E81 kings-indian-defence-samisch": "E87",
};

// --- the table itself ---------------------------------------------------
assert(ChessEco.size >= 3000, "the table has at least 3000 positions (" + ChessEco.size + ")");

// --- transposition ------------------------------------------------------
{
  const a = ChessEco.openingForGame("e4 e5 Nf3 Nc6 Bc4".split(" "));
  const b = ChessEco.openingForGame("e4 e5 Bc4 Nc6 Nf3".split(" "));
  assert(a && a.eco === "C50" && a.name === "Italian Game", "1.e4 e5 2.Nf3 Nc6 3.Bc4 is C50 Italian Game");
  assert(b && b.eco === "C50" && b.name === "Italian Game" && b.ply === 5,
    "…and so is the transposition 1.e4 e5 2.Bc4 Nc6 3.Nf3, at the same depth");
  // a chess.js instance classifies the same as its SAN list, and is left intact
  const g = new Chess();
  for (const san of ["e4", "e5", "Bc4", "Nc6", "Nf3"]) g.move(san);
  const c = ChessEco.openingForGame(g);
  assert(c && c.eco === "C50" && g.history().length === 5 && g.fen().startsWith("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b"),
    "a chess.js instance classifies the same and keeps its history");
  assert(ChessEco.lookupPosition(g) && ChessEco.lookupPosition(g).eco === "C50", "lookupPosition() sees the same position");
}

// --- FEN start ----------------------------------------------------------
{
  // the Najdorf position handed over as a FEN, no moves at all
  const fen = "rnbqkb1r/1p2pppp/p2p1n2/8/3NP3/2N5/PPP2PPP/R1BQKB1R w KQkq - 0 6";
  const h = ChessEco.openingForGame([], fen);
  assert(h && h.eco === "B90" && h.ply === 0, "a FEN-start game classifies from its start position (" + (h && h.eco + " " + h.name) + ")");
  // …and keeps refining as moves are played from it
  const h2 = ChessEco.openingForGame(["Be3", "e5"], fen);
  assert(h2 && h2.eco === "B90" && h2.ply >= 1 && /English Attack/.test(h2.name),
    "…and follows moves played from the FEN (" + (h2 && h2.name) + ")");
  const g = new Chess(fen);
  g.move("Be3");
  assert(ChessEco.openingForGame(g) && ChessEco.openingForGame(g).eco === "B90", "a chess.js instance loaded from a FEN classifies too");
  assert(ChessEco.openingForGame(["a3", "a6", "Ra2"]) === null || ChessEco.openingForGame(["a3", "a6", "Ra2"]).ply < 3,
    "a position outside the table falls back to the deepest one inside it");
}

// --- the curated book, line by line ------------------------------------
{
  const mismatched = new Set();
  let recognised = 0;
  for (const [eco, id, moves] of CHESS_OPENINGS) {
    const hit = ChessEco.openingForGame(moves.split(" "));
    if (!hit) { failed++; console.error("FAIL " + eco + " " + id + " is not in the table at any ply"); continue; }
    recognised++;
    if (hit.eco === eco) continue;
    const k = eco + " " + id;
    mismatched.add(k);
    if (TOLERATED[k] !== hit.eco) { failed++; console.error("FAIL " + k + " → " + hit.eco + " " + hit.name + " (not tolerated)"); }
  }
  assert(recognised === CHESS_OPENINGS.length, "every book line reaches a table position (" + recognised + "/" + CHESS_OPENINGS.length + ")");
  const agree = CHESS_OPENINGS.length - mismatched.size;
  assert(agree >= CHESS_OPENINGS.length - Object.keys(TOLERATED).length,
    "the book's ECO code agrees with lichess on " + agree + "/" + CHESS_OPENINGS.length + " lines; " + mismatched.size + " tolerated");
  const stale = Object.keys(TOLERATED).filter((k) => !mismatched.has(k));
  assert(stale.length === 0, "the tolerated register only shrinks (" + (stale.length ? "delete: " + stale.join(", ") : "all still mismatch") + ")");
}

// --- names --------------------------------------------------------------
{
  const it = { eco: "C50", name: "Italian Game" };
  assert(ChessEco.localName(it, "en") === "Italian Game", "English shows the lichess name");
  assert(ChessEco.localName(it, "zh-CN") === CHESS_OPENING_NAMES["italian-game"], "Chinese shows the book's name for a joined entry (" + ChessEco.localName(it, "zh-CN") + ")");
  assert(ChessEco.localName(it, "ja") === CHESS_OPENINGS_JA["italian-game"], "Japanese too (" + ChessEco.localName(it, "ja") + ")");
  const far = { eco: "A00", name: "Formation: Hippopotamus Attack" };
  assert(ChessEco.localName(far, "zh-CN") === far.name, "an entry the book does not have falls back to English");
  const joined = Object.keys(ChessEco.BOOK_ID_BY_ENTRY).length;
  assert(joined >= 100, "the book lends its translations to " + joined + " table entries");
  assert(ChessEco.ecoName("B90") === "Sicilian Defense: Najdorf Variation", "ecoName() gives the family name of a code (" + ChessEco.ecoName("B90") + ")");
  assert(ChessEco.ecoName("Z99") === null, "…and null for a code that is not one");
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
