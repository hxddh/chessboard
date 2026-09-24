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
// 6.1: eco.js is a chunk now — at runtime the page injects it as its own
// script and eco-lookup.js reads the global it defines. Loading it into this
// context first is the same arrangement, and without it every lookup here
// answers null, which is exactly what a missing chunk looks like.
for (const m of ["chess.js", "eco.js", "eco-lookup.js", "openings.js", "openings-en.js", "openings-ja.js", "openings-family-zh.js", "openings-family-ja.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js", m)), ctx, { filename: m });
}
const { Chess, ChessEco, CHESS_OPENINGS, CHESS_OPENING_NAMES, CHESS_OPENINGS_JA, OPENING_FAMILIES_ZH, OPENING_FAMILIES_JA } = ctx;

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
  assert(ChessEco.localName(far, "en") === far.name, "English is unchanged for an entry the book does not have");
  assert(ChessEco.localName({ eco: "Z99", name: "Nonexistent Family: Something" }, "zh-CN") === "Nonexistent Family: Something",
    "a family with no translation falls back to the English name");
}

// --- 7.5 §3: families ------------------------------------------------------
//
// The book translates ~195 lines; the other 3600-odd table entries show their
// family (the text before the first colon) in the reader's language and keep
// the variation in English. Every family in the table must be in both
// dictionaries — a lichess table update that brings a new family fails here.
{
  const families = new Map();
  for (const [, name] of Object.values(ctx.ECO_BY_KEY)) {
    const f = name.split(":")[0];
    families.set(f, (families.get(f) || 0) + 1);
  }
  for (const [lang, tbl] of [["zh-CN", OPENING_FAMILIES_ZH], ["ja", OPENING_FAMILIES_JA]]) {
    const missing = [...families.keys()].filter((f) => !tbl[f]);
    assert(missing.length === 0, "every one of the " + families.size + " families in eco.js has a " + lang + " name" +
      (missing.length ? " — missing: " + missing.join(" | ") : ""));
    const orphan = Object.keys(tbl).filter((f) => !families.has(f));
    assert(orphan.length === 0, "…and the " + lang + " dictionary has no family the table lacks" +
      (orphan.length ? " — orphans: " + orphan.join(" | ") : ""));
    const ascii = Object.entries(tbl).filter(([, v]) => /[:,;()]/.test(v));
    assert(ascii.length === 0, "…and no " + lang + " family name carries ASCII punctuation" +
      (ascii.length ? " — " + ascii.map(([k]) => k).join(" | ") : ""));
  }

  // a non-book line: the family translated, the variation left in English
  const bowdler = ChessEco.openingForGame("e4 c5 Bc4".split(" "));
  assert(bowdler && bowdler.eco === "B20" && bowdler.name === "Sicilian Defense: Bowdler Attack",
    "1.e4 c5 2.Bc4 is B20 Sicilian Defense: Bowdler Attack (" + (bowdler && bowdler.name) + ")");
  assert(!ChessEco.BOOK_ID_BY_ENTRY["B20|Sicilian Defense: Bowdler Attack"], "…which the book does not translate");
  assert(ChessEco.localName(bowdler, "zh-CN") === OPENING_FAMILIES_ZH["Sicilian Defense"] + "：Bowdler Attack",
    "Chinese shows the family in Chinese and the rest in English (" + ChessEco.localName(bowdler, "zh-CN") + ")");
  assert(ChessEco.localName(bowdler, "ja") === OPENING_FAMILIES_JA["Sicilian Defense"] + "：Bowdler Attack",
    "Japanese too (" + ChessEco.localName(bowdler, "ja") + ")");
  assert(ChessEco.localName(bowdler, "en") === "Sicilian Defense: Bowdler Attack", "English is unchanged");
  const greco = { eco: "C54", name: "Italian Game: Giuoco Piano, Greco's Attack" };
  assert(ChessEco.localName(greco, "zh-CN") === "意大利开局：Giuoco Piano, Greco's Attack",
    "the plan's example reads 意大利开局：Giuoco Piano, Greco's Attack (" + ChessEco.localName(greco, "zh-CN") + ")");
  const far = { eco: "A00", name: "Formation: Hippopotamus Attack" };
  assert(ChessEco.localName(far, "zh-CN") === OPENING_FAMILIES_ZH.Formation + "：Hippopotamus Attack",
    "…and so does an A00 oddity (" + ChessEco.localName(far, "zh-CN") + ")");
  // a name with no colon is all family
  const kg = { eco: "Z99", name: "King's Gambit" };
  assert(ChessEco.localName(kg, "zh-CN") === OPENING_FAMILIES_ZH["King's Gambit"], "a name with no colon is translated whole");

  // a family the book also names must be spelt the same way here, so one
  // opening never appears under two names: for every book line whose table
  // entry is a bare family name, the dictionary agrees with the book
  // (a trailing parenthetical is the book's gloss — 西班牙开局（鲁伊·洛佩斯）—
  // and the book's Japanese "X：アクセプテッド" is written "X・アクセプテッド"
  // here, since a family is followed by its own "：variation").
  //
  // Where the book itself uses two names, or lends a bare family's name to a
  // line that is really something narrower, the pair is registered below.
  // Shrink-only, like TOLERATED.
  const FAMILY_TOLERATED = {
    // book: 1.d4 后兵开局, 1.d4 d5 后兵对局 — lichess calls both "Queen's Pawn Game"
    "A40|Queen's Pawn Game zh": true, "A40|Queen's Pawn Game ja": true,
    // book: 1.e4 王兵开局, 1.e4 e5 王兵对局 — lichess calls both "King's Pawn Game"
    "B00|King's Pawn Game zh": true, "B00|King's Pawn Game ja": true,
    // book: 沃尔加-贝科弃兵 for the gambit, 贝科弃兵·接受 for the acceptance
    "A57|Benko Gambit zh": true,
    // book: both 俄罗斯防御（彼得罗夫） and 彼得罗夫防御; ロシアン（ペトロフ） and ペトロフ
    "C42|Petrov's Defense zh": true, "C42|Petrov's Defense ja": true,
    // the book's "Center Game" line ends on the capture lichess calls Accepted
    "C21|Center Game Accepted zh": true, "C21|Center Game Accepted ja": true,
    // a deep book line (London vs King's Indian) whose last position lichess files here
    "A48|London System, with Be2 zh": true, "A48|London System, with Be2 ja": true,
  };
  const norm = (s) => s.replace(/（[^）]*）$/, "").replace(/（[^）]*）・/, "・").replace(/：/g, "・");
  const disagree = [];
  const seen = new Set();
  for (const [k, id] of Object.entries(ChessEco.BOOK_ID_BY_ENTRY)) {
    const name = k.slice(k.indexOf("|") + 1);
    if (name.includes(":")) continue;
    for (const [lang, fam, book] of [["zh", OPENING_FAMILIES_ZH, CHESS_OPENING_NAMES], ["ja", OPENING_FAMILIES_JA, CHESS_OPENINGS_JA]]) {
      if (!fam[name] || norm(fam[name]) === norm(book[id])) continue;
      seen.add(k + " " + lang);
      if (!FAMILY_TOLERATED[k + " " + lang]) disagree.push(k + " " + lang + ": " + fam[name] + " ≠ book " + book[id]);
    }
  }
  assert(disagree.length === 0, "family names agree with the book where the book names the bare family" +
    (disagree.length ? " — " + disagree.join("; ") : ""));
  const staleFam = Object.keys(FAMILY_TOLERATED).filter((k) => !seen.has(k));
  assert(staleFam.length === 0, "…and the family register only shrinks" + (staleFam.length ? " (delete: " + staleFam.join(", ") + ")" : ""));

  // coverage in the reader's language: no table entry falls back to all-English
  const english = Object.values(ctx.ECO_BY_KEY).filter(([eco, name]) => ChessEco.localName({ eco, name }, "zh-CN") === name);
  assert(english.length === 0, "no table entry shows an all-English name in Chinese (" + english.length + ")");
  const joined = Object.keys(ChessEco.BOOK_ID_BY_ENTRY).length;
  assert(joined >= 100, "the book lends its translations to " + joined + " table entries");
  assert(ChessEco.ecoName("B90") === "Sicilian Defense: Najdorf Variation", "ecoName() gives the family name of a code (" + ChessEco.ecoName("B90") + ")");
  assert(ChessEco.ecoName("Z99") === null, "…and null for a code that is not one");
}

// --- 6.1 (review): the book join must survive the table arriving late -------
//
// Every context above preloads eco.js, which is *not* the runtime order: the
// table is a chunk, injected after first paint, so eco-lookup.js is evaluated
// while window.ECO_BY_KEY is undefined. BOOK_ID_BY_ENTRY used to be built by
// an eager IIFE at that moment — openingForGame returned null for every book
// line, the map came out empty and stayed empty for the rest of the session,
// and localName() fell back to the English lichess name for Chinese and
// Japanese for ever. This context reproduces the real order.
{
  const late = { console };
  late.globalThis = late;
  late.window = late;
  vm.createContext(late);
  // note the absence of eco.js here — exactly what the page sees at boot
  for (const m of ["chess.js", "eco-lookup.js", "openings.js", "openings-en.js", "openings-ja.js"]) {
    vm.runInContext(compileModuleSync(path.join(root, "src/web/js", m)), late, { filename: m });
  }
  const E = late.ChessEco;
  assert(!E.loaded(), "the table is absent while eco-lookup.js is evaluated");
  assert(E.openingForGame(["e4", "e5"]) === null, "…so a lookup answers null, as designed");

  // now the chunk lands, the way loadChunk's injected script lands
  vm.runInContext(compileModuleSync(path.join(root, "src/web/js/eco.js")), late, { filename: "eco.js" });
  const hit = E.openingForGame(["e4", "e5"]);
  assert(hit && hit.eco, "once the chunk is here the lookup works again");

  // the point of the test: the localised name, not the English fallback
  const zh = E.localName(hit, "zh-CN");
  assert(zh !== hit.name, "localName() gives the Chinese name, not the English fallback (" + zh + ")");
  assert(Object.keys(E.BOOK_ID_BY_ENTRY).length > 100,
    "…because the book join is built on first use, not at load (" + Object.keys(E.BOOK_ID_BY_ENTRY).length + " entries)");

  // and it agrees with the eager context above, so laziness changed nothing else
  const eager = ChessEco.localName(ChessEco.openingForGame(["e4", "e5"]), "zh-CN");
  assert(zh === eager, "…and it matches the preloaded context (" + zh + " / " + eager + ")");
}

if (failed) { console.error(failed + " test(s) failed"); process.exit(1); }
console.log("all passed");
