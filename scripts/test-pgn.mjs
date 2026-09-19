/**
 * Node tests for the PGN parser/serializer and the game tree.
 * Run: node scripts/test-pgn.mjs
 *
 * The fixtures under scripts/fixtures/pgn are the acceptance corpus from
 * docs/v6-plan.md §Q2.2: every file must parse (chess.js checks each move),
 * and parse → serialize → parse must be semantically equal to the first parse.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const FIXTURES = path.join(root, "scripts/fixtures/pgn");

const ctx = { console, Date, performance, JSON };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
for (const rel of ["src/web/js/chess.js", "src/web/js/pgn-parser.js", "src/web/js/game-tree.js"]) {
  vm.runInContext(compileModuleSync(path.join(root, rel)), ctx, { filename: path.basename(rel) });
}
const { Chess, ChessPgnParser: P, ChessTree: T } = ctx;

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
function throwsWith(fn, re) {
  try { fn(); return null; } catch (e) { return re.test(e.message) ? e : (console.error("  threw: " + e.message), null); }
}

/** Header order is presentation, so compare the set of pairs. */
function canonHeaders(h) {
  return h.map(([k, v]) => k + "=" + v).sort();
}
function canonNode(n) {
  return {
    san: n.san, from: n.from, to: n.to, promotion: n.promotion, fen: n.fen, comment: n.comment,
    nags: n.nags, shapes: n.shapes, children: n.children.map(canonNode),
  };
}
function canonGame(g) {
  return JSON.stringify({ headers: canonHeaders(g.headers), result: g.result, root: canonNode(g.root) });
}
/** every san in the tree is legal from its parent's fen and lands on the node's fen */
function legal(node) {
  for (const c of node.children) {
    const g = new Chess(node.fen);
    const mv = g.move(c.san);
    if (!mv || g.fen() !== c.fen) return false;
    if (!legal(c)) return false;
  }
  return true;
}

// --- the corpus -----------------------------------------------------------
{
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".pgn")).sort();
  assert(files.length >= 20, "at least 20 fixtures (" + files.length + ")");
  for (const f of files) {
    const text = fs.readFileSync(path.join(FIXTURES, f), "utf8");
    let parsed = null;
    try { parsed = P.parsePgn(text); } catch (e) { console.error("  " + f + ": " + e.message); }
    assert(parsed && parsed.games.length >= 1, f + " parses");
    if (!parsed) continue;
    for (const g of parsed.games) {
      assert(legal(g.root), f + ": every move is legal and every fen matches");
      const out = P.serializePgn(g);
      // tag pairs are one line each by definition; the width rule is for movetext
      const movetext = out.replace(/^(?:\[[^\n]*\]\n)*\n?/, "");
      assert(movetext.split("\n").every((l) => l.length <= 80), f + ": no exported movetext line exceeds 80 columns");
      const results = (movetext.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/g) || []).length;
      assert(results === 1, f + ": the result token appears exactly once in the movetext (" + results + ")");
      assert(movetext.trim().endsWith(g.result), f + ": ...and it is the last token");
      let again = null;
      try { again = P.parsePgn(out).games[0]; } catch (e) { console.error("  " + f + " re-parse: " + e.message + "\n" + out); }
      assert(again && canonGame(again) === canonGame(g), f + ": parse(serialize(parse(x))) == parse(x)");
      // and the export is a fixed point: serialize(parse(serialize(x))) == serialize(x)
      assert(again && P.serializePgn(again) === out, f + ": serialize is idempotent");
      // through the tree and back
      const tree = T.fromPgnGame(g);
      assert(T.mainlineSans(tree).join(" ") === mainlineSans(g.root).join(" "), f + ": tree keeps the mainline");
      const back = T.toPgnGame(tree, g.headers);
      assert(canonGame({ ...back, result: g.result }) === canonGame(g), f + ": tree → game is lossless");
      const copy = T.deserialize(T.serialize(tree));
      assert(JSON.stringify(copy) === JSON.stringify(tree), f + ": tree serialize → deserialize is identity");
    }
  }
}
function mainlineSans(root) {
  const out = [];
  let n = root.children[0];
  while (n) { out.push(n.san); n = n.children[0]; }
  return out;
}

// --- the known load_pgn failures (docs/v6-plan.md D1 / §1.2) ---------------
{
  const chess = new Chess();
  const semi = fs.readFileSync(path.join(FIXTURES, "semicolon-comment-question.pgn"), "utf8");
  assert(!chess.load_pgn(semi), "chess.js still rejects a ';' comment containing '?'");
  const g = P.parsePgn(semi).games[0];
  assert(mainlineSans(g.root).join(" ") === "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7", "...we parse it");
  assert(g.root.children[0].children[0].comment === "is this the best? probably ?!", "...and keep the comment text verbatim");
  assert(g.root.children[0].children[0].nags.length === 0, "...without turning '?!' inside it into a NAG");

  const nb = fs.readFileSync(path.join(FIXTURES, "no-blank-line.pgn"), "utf8");
  assert(mainlineSans(P.parsePgn(nb).games[0].root).length === 10, "headers with no blank line before the moves parse");
  assert(P.parsePgn(nb).games[0].headers.length === 7, "...with all seven tags");

  const zeros = fs.readFileSync(path.join(FIXTURES, "castling-zeros.pgn"), "utf8");
  assert(!chess.load_pgn(zeros), "chess.js still rejects 0-0 with digit zeros");
  const zg = P.parsePgn(zeros).games[0];
  const sans = mainlineSans(zg.root);
  assert(sans.includes("O-O-O") && sans.includes("O-O"), "0-0-0 and 0-0 become O-O-O and O-O");
  assert(!/0-0/.test(P.serializePgn(zg)), "...and are exported with letters");

  const esc = P.parsePgn(fs.readFileSync(path.join(FIXTURES, "escaped-quotes.pgn"), "utf8")).games[0];
  const h = Object.fromEntries(esc.headers);
  assert(h.Event === 'The "Immortal" Game (replayed)', "\\\" in a tag value is unescaped");
  assert(h.Site === "C:\\pgn\\files", "\\\\ in a tag value is unescaped");
  assert(h.White === 'O"Brien, Pat', "...also mid-word");
  const out = P.serializePgn(esc);
  assert(out.includes('[Event "The \\"Immortal\\" Game (replayed)"]'), "quotes are escaped again on export");
  assert(out.includes('[Site "C:\\\\pgn\\\\files"]'), "backslashes are escaped again on export");

  // D1: header says 1-0 and the movetext ends 1-0 — the export must not say it twice
  const one = P.parsePgn('[Event "x"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 1-0\n').games[0];
  assert(one.result === "1-0", "the result token is read");
  const s = P.serializePgn(one);
  assert(s.trim().endsWith("2. Nf3 1-0") && (s.match(/1-0/g) || []).length === 2,
    "export ends with the result exactly once (plus the tag)");
  const noTok = P.parsePgn('[Result "0-1"]\n\n1. e4 e5\n').games[0];
  assert(noTok.result === "0-1", "a missing result token falls back to the Result tag");
  assert(P.parsePgn("1. e4 e5").games[0].result === "*", "...and to * when there is neither");
}

// --- tokenizer / parser details --------------------------------------------
{
  const g = P.parsePgn("\uFEFF[Event \"bom\"]\r\n\r\n1. e4 e5 *\r\n").games[0];
  assert(g.headers[0][1] === "bom" && mainlineSans(g.root).length === 2, "BOM and CRLF are stripped");

  const v = P.parsePgn("1. e4 e5 (1... c5 2. Nf3 (2. c3 d5) 2... d6) (1... e6) 2. Nf3 *").games[0];
  const e4 = v.root.children[0];
  assert(e4.children.map((c) => c.san).join(",") === "e5,c5,e6", "variations become siblings after the mainline move");
  assert(e4.children[1].children.map((c) => c.san).join(",") === "Nf3,c3", "nested variation attaches one level down");
  assert(e4.children[1].children[0].children[0].san === "d6", "and the outer variation continues after the inner one closes");

  const n = P.parsePgn("1. e4 $1 $14 e5?! 2. Nf3! Nc6?? 3. Bb5!? a6? 4. Ba4!! *").games[0];
  const line = [];
  for (let c = n.root.children[0]; c; c = c.children[0]) line.push(c.nags.join("+"));
  assert(line.join(" ") === "1+14 6 1 4 5 2 3", "numeric NAGs and every suffix map to the standard numbers");
  assert(P.serializePgn(n).includes("1. e4 $1 $14 e5 $6 2. Nf3 $1 Nc6 $4 3. Bb5 $5 a6 $2 4. Ba4 $3 *"),
    "NAGs are exported as $n");

  const sh = P.parsePgn("1. e4 { [%csl Gd4,Re4] [%cal Ge4d5,Rd1h5] centre } e5 *").games[0];
  const n1 = sh.root.children[0];
  assert(n1.comment === "centre", "shape commands are stripped from the comment text");
  assert(JSON.stringify(n1.shapes) === JSON.stringify({
    arrows: [{ from: "e4", to: "d5", color: "G" }, { from: "d1", to: "h5", color: "R" }],
    circles: [{ sq: "d4", color: "G" }, { sq: "e4", color: "R" }],
  }), "...and parsed into arrows and circles");
  assert(P.serializePgn(sh).includes("{ [%csl Gd4,Re4] [%cal Ge4d5,Rd1h5] centre }"), "shapes are written back as commands");
  const clk = P.parsePgn("1. e4 { [%clk 0:03:00] [%eval 0.2] } e5 *").games[0];
  assert(clk.root.children[0].comment === "[%clk 0:03:00] [%eval 0.2]", "%clk and %eval stay in the comment verbatim");

  const ml = P.parsePgn("1. e4 {a\nb\n  c} e5 {x} {y} *").games[0];
  assert(ml.root.children[0].comment === "a b c", "newlines inside a comment collapse to spaces");
  assert(ml.root.children[0].children[0].comment === "x y", "two comments on one move are joined");

  const fen = "4k3/8/8/8/8/8/8/4K2R w K - 0 1";
  const pos = P.parsePgn('[SetUp "1"]\n[FEN "' + fen + '"]\n\n*').games[0];
  assert(pos.root.fen === fen && pos.root.children.length === 0, "SetUp/FEN with no moves is a game");
  assert(P.serializePgn(pos).trim().endsWith("*"), "...and exports as its result alone");
  const bfirst = P.parsePgn('[FEN "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1"]\n\n1... e5 2. Nf3 *').games[0];
  assert(P.serializePgn(bfirst).includes("1... e5 2. Nf3 *"), "a black first move gets N... on export");
  const rc = P.parsePgn("{ before } 1. e4 e5 *").games[0];
  assert(rc.root.comment === "before" && P.serializePgn(rc).startsWith("{ before } 1. e4"), "a comment before move one is the game comment");
  const pre = P.parsePgn("1. e4 ( {alt} 1. d4 ) e5 *").games[0];
  assert(pre.root.children[1].san === "d4" && pre.root.children[1].comment === "alt" && rc.root.children[0].comment === null,
    "a comment between '(' and the variation's first move belongs to that move");
  assert(P.serializePgn(pre).includes("1. e4 ( 1. d4 { alt } ) 1... e5 *"), "...and black is renumbered after a variation");

  const dup = P.parsePgn("1. e4 (1. e4 e5) e5 *").games[0];
  assert(dup.root.children.length === 1, "a variation repeating the mainline move does not fork it");

  const wide = P.serializePgn(P.parsePgn(fs.readFileSync(path.join(FIXTURES, "long-comment-wrap.pgn"), "utf8")).games[0], { width: 40 });
  assert(wide.split("\n").every((l) => l.length <= 40), "width is honoured");
  assert(!/\S \n|\n /.test(wide), "lines break between tokens only, never inside one");

  const g2 = P.parsePgn('[White "a"]\n1. e4 *\n[White "b"]\n1. d4 *').games;
  assert(g2.length === 2 && g2[1].headers[0][1] === "b", "a tag after movetext starts the next game");
  assert(P.parsePgn(fs.readFileSync(path.join(FIXTURES, "multi-game.pgn"), "utf8")).games.map((g) => g.result).join(" ") ===
    "1-0 0-1 1/2-1/2", "multi-game file: three games, three results");
}

// --- errors name the spot ---------------------------------------------------
{
  const e = throwsWith(() => P.parsePgn('[Event "x"]\n\n1. e4 e5 2. Nf9 *'), /illegal move "Nf9"/);
  assert(!!e && e.line === 3 && e.column === 13 && e.token === "Nf9", "illegal move: line, column and token are reported");
  assert(!!e && /line 3, column 13/.test(e.message), "...in the message too");
  const e2 = throwsWith(() => P.parsePgn("1. e4 e5 (1... c5"), /unterminated variation/);
  assert(!!e2, "an unclosed '(' is an error");
  const e3 = throwsWith(() => P.parsePgn("1. e4 {never closed"), /unterminated comment/);
  assert(!!e3 && e3.line === 1 && e3.column === 7, "an unclosed '{' is an error at the brace");
  const e4 = throwsWith(() => P.parsePgn('[FEN "not a fen"]\n\n*'), /invalid FEN/);
  assert(!!e4, "a bad FEN tag is an error");
  const e5 = throwsWith(() => P.parsePgn("1. e4 e5 2. Nf3 )"), /unmatched/);
  assert(!!e5, "a stray ')' is an error");
}

// --- splitGames -------------------------------------------------------------
{
  const text = fs.readFileSync(path.join(FIXTURES, "games-without-event.pgn"), "utf8");
  const parts = P.splitGames(text);
  assert(parts.length === 2 && parts[1].startsWith('[White "Second"]'), "games without [Event] split at the tag after movetext");
  const bare = P.splitGames("1. e4 e5 1-0\n\n1. d4 d5 *\n");
  assert(bare.length === 2 && bare[1] === "1. d4 d5 *", "bare games split after the result, keeping the move number");
  assert(P.splitGames("1. e4 { [Event not a tag } e5 *").length === 1, "a '[' inside a comment is not a boundary");
  assert(P.splitGames("").length === 0 && P.splitGames("  \n").length === 0, "empty input yields no games");
  const multi = fs.readFileSync(path.join(FIXTURES, "multi-game.pgn"), "utf8");
  assert(P.splitGames(multi).length === 3, "three games in the multi-game fixture");
  assert(P.splitGames(multi).every((c) => P.parsePgn(c).games.length === 1), "...each chunk parses on its own");
}

// --- the tree -----------------------------------------------------------------
{
  const t = T.createTree();
  assert(t.root.id === 0 && t.root.fen === P.START_FEN, "a new tree is the start position at id 0");
  const e4 = T.addMove(t, 0, "e4");
  const e5 = T.addMove(t, e4.id, { from: "e7", to: "e5" });
  const nf3 = T.addMove(t, e5.id, "Nf3");
  assert(e4.id === 1 && e5.id === 2 && nf3.id === 3, "ids increment");
  assert(T.mainlineSans(t).join(" ") === "e4 e5 Nf3", "mainline follows first children");
  const c5 = T.addMove(t, e4.id, "c5");
  assert(e4.children[1] === c5 && T.mainlineSans(t).join(" ") === "e4 e5 Nf3", "a second move from a node is a variation");
  assert(T.addMove(t, e4.id, "e5") === e5, "replaying an existing move returns that node, no fork");
  assert(T.addMove(t, e4.id, "e7e5") === e5, "...also from sloppy notation");
  const nc3 = T.addMove(t, c5.id, "Nc3");
  const nf3b = T.addMove(t, c5.id, "Nf3");
  assert(T.pathTo(t, nf3b.id).map((n) => n.san).join(" ") === "e4 c5 Nf3", "pathTo lists the moves down to the node");
  assert(T.fenAt(nf3b) === new Chess("rnbqkbnr/pp1ppppp/8/2p5/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2").fen() ||
    T.fenAt(nf3b).startsWith("rnbqkbnr/pp1ppppp/8/2p5/4P3/5N2/PPPP1PPP/RNBQKB1R b"), "fenAt is the position after the move");

  T.promote(t, nf3b.id);
  assert(c5.children[0] === nf3b && c5.children[1] === nc3, "promote makes the variation first at its own branch");
  assert(T.mainlineSans(t).join(" ") === "e4 e5 Nf3", "...without touching the mainline above");
  T.promoteToMain(t, nf3b.id);
  assert(T.mainlineSans(t).join(" ") === "e4 c5 Nf3", "promoteToMain lifts the whole line");
  assert(e4.children[1] === e5, "the old mainline is now the first variation");

  assert(T.deleteNode(t, e5.id) === e4, "deleteNode returns the parent");
  assert(T.nodeAt(t, e5.id) === null && T.nodeAt(t, nf3.id) === null, "...and the subtree is gone");
  assert(T.parentOf(t, nf3b.id) === c5 && T.parentOf(t, 0) === null, "parentOf");
  let threw = false;
  try { T.deleteNode(t, 0); } catch { threw = true; }
  assert(threw, "the root cannot be deleted");
  threw = false;
  try { T.addMove(t, 0, "Ke2"); } catch { threw = true; }
  assert(threw, "an illegal move throws");

  T.setComment(t, nf3b.id, "  Open   Sicilian\n next ");
  T.setNags(t, nf3b.id, [1, "14", 0, -2]);
  T.setShapes(t, nf3b.id, { arrows: [{ from: "f3", to: "d4", color: "G" }], circles: [{ sq: "d4", color: "R" }] });
  assert(nf3b.comment === "Open Sicilian next" && nf3b.nags.join() === "1,14", "setComment / setNags normalise");
  const game = T.toPgnGame(t, { Event: "Tree", Result: "1-0" });
  assert(game.result === "1-0" && game.root.id === undefined, "toPgnGame reads Result and strips ids");
  assert(P.serializePgn(game) ===
    '[Event "Tree"]\n[Result "1-0"]\n\n1. e4 c5 2. Nf3 $1 $14 { [%csl Rd4] [%cal Gf3d4] Open Sicilian next } ( 2. Nc3 )\n1-0\n',
    "the tree exports as expected PGN");

  const t2 = T.deserialize(T.serialize(t));
  assert(JSON.stringify(t2) === JSON.stringify(t), "serialize → deserialize is the identity");
  assert(T.addMove(t2, nf3b.id, "d6").id === t.nextId, "...and ids keep counting from where they were");
  threw = false;
  try { T.deserialize('{"root":{"fen":1}}'); } catch { threw = true; }
  assert(threw, "a malformed blob is refused");

  const fenTree = T.createTree("4k3/8/8/8/8/8/8/4K2R w K - 0 1");
  T.addMove(fenTree, 0, "O-O");
  const fg = T.toPgnGame(fenTree, [["Event", "pos"]]);
  assert(fg.headers.some(([k, v]) => k === "SetUp" && v === "1") && fg.headers.some(([k]) => k === "FEN"),
    "a non-standard start adds SetUp and FEN tags");
  assert(P.serializePgn(fg).includes("1. O-O *"), "...and exports from that position");
  const rt = T.fromPgnGame(P.parsePgn(P.serializePgn(fg)).games[0]);
  assert(rt.startFen === fenTree.startFen && T.mainlineSans(rt).join() === "O-O", "fromPgnGame keeps the start position");
}

if (failed) {
  console.error(failed + " test(s) failed");
  process.exit(1);
}
console.log("all passed");
