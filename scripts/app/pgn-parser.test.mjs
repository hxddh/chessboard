/**
 * The PGN parser and serializer (src/app/library/pgn-parser.js, 19.0's
 * pgn-parser.js moved unchanged), held to 19.0's regression suite
 * (v19.0.0:scripts/test-pgn.mjs), ported: the fixture corpus
 * (fixtures/pgn, docs/v6-plan.md §Q2.2: every file parses, every move is
 * legal, parse → serialize → parse is the same game, the export is a fixed
 * point), what chess.js's load_pgn gets wrong, the tokenizer's details, the
 * confirmed import/export defects one by one, errors that name the spot,
 * splitGames, comment braces and backslashes (6.1 / 7.0), a seeded random
 * round trip, and the large-file yield (7.5).
 *
 * Left out with 19.0's game-tree.js, which 20.0 does not have: the tree's
 * own edits, its index and its serialize; the round trips through it. The
 * fuzz builds the parser's own node shape instead of a tree.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Chess } from "../../src/app/core/chessjs.js";
import { ChessPgnParser as P } from "../../src/app/library/pgn-parser.js";

const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures/pgn");

function throwsWith(fn, re) {
  try { fn(); return null; } catch (e) { return re.test(e.message) ? e : null; }
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
/**
 * Every san in the tree is legal from its parent's fen and lands on the
 * node's fen. A null move is the exception the parser makes: it is not a
 * move chess.js can play, so it and everything after it in that line keep
 * the position the line stopped at, and that is what is checked instead.
 */
function legal(node, stopped) {
  for (const c of node.children) {
    if (stopped || c.san === P.NULL_SAN) {
      if (c.fen !== node.fen || c.from !== null || c.to !== null) return false;
      if (!legal(c, true)) return false;
      continue;
    }
    const g = new Chess(node.fen);
    const mv = g.move(c.san);
    if (!mv || g.fen() !== c.fen) return false;
    if (!legal(c, false)) return false;
  }
  return true;
}
function mainlineSans(root) {
  const out = [];
  let n = root.children[0];
  while (n) { out.push(n.san); n = n.children[0]; }
  return out;
}

export default (test) => {
  // --- the corpus -----------------------------------------------------------
  const files = fs.readdirSync(FIXTURES).filter((f) => f.endsWith(".pgn")).sort();
  test("pgn corpus: at least 20 fixtures", (a) => a.ok(files.length >= 20, String(files.length)));
  for (const f of files) {
    test("pgn corpus: " + f, (a) => {
      const assert = (c, m) => a.ok(c, m);
      const text = fs.readFileSync(path.join(FIXTURES, f), "utf8");
      const parsed = P.parsePgn(text);
      assert(parsed.games.length >= 1, f + " parses");
      for (const g of parsed.games) {
        assert(legal(g.root), f + ": every move is legal and every fen matches");
        const out = P.serializePgn(g);
        // tag pairs are one line each by definition; the width rule is for movetext
        const movetext = out.replace(/^(?:\[[^\n]*\]\n)*\n?/, "");
        assert(movetext.split("\n").every((l) => l.length <= 80), f + ": no exported movetext line exceeds 80 columns");
        const results = (movetext.match(/(?:^|\s)(1-0|0-1|1\/2-1\/2|\*)(?=\s|$)/g) || []).length;
        assert(results === 1, f + ": the result token appears exactly once in the movetext (" + results + ")");
        assert(movetext.trim().endsWith(g.result), f + ": ...and it is the last token");
        const again = P.parsePgn(out).games[0];
        assert(again && canonGame(again) === canonGame(g), f + ": parse(serialize(parse(x))) == parse(x)");
        // and the export is a fixed point: serialize(parse(serialize(x))) == serialize(x)
        assert(P.serializePgn(again) === out, f + ": serialize is idempotent");
      }
    });
  }

  test("pgn: what chess.js load_pgn gets wrong (v6-plan D1 / §1.2)", (a) => {
    const assert = (c, m) => a.ok(c, m);
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
  });

  test("pgn: tokenizer and parser details", (a) => {
    const assert = (c, m) => a.ok(c, m);
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
  });

  test("pgn: the confirmed import/export defects", (a) => {
    const assert = (c, m) => a.ok(c, m);
    // 1. castling with zeros and a check or mate suffix
    const ck = P.parsePgn('[FEN "5k2/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. 0-0+ *').games[0];
    assert(mainlineSans(ck.root).join(" ") === "O-O+", "0-0+ is castling with a check, not an unexpected character");
    const mate = P.parsePgn('[FEN "3k4/2p1p3/B4N2/8/8/8/8/R3K3 w Q - 0 1"]\n\n1. 0-0-0# 1-0').games[0];
    assert(mainlineSans(mate.root).join(" ") === "O-O-O#", "0-0-0# too");
    const ckn = P.parsePgn('[FEN "5k2/8/8/8/8/8/8/4K2R w K - 0 1"]\n\n1. 0-0+! *').games[0];
    assert(ckn.root.children[0].nags.join() === "1", "...and a suffix annotation after it is still a NAG");

    // 2. null moves
    const nm = P.parsePgn("1. e4 e5 2. -- Nf6 *").games[0];
    assert(mainlineSans(nm.root).join(" ") === "e4 e5 -- Nf6", "'--' is a null move, not a tokenizer error");
    const e5 = nm.root.children[0].children[0];
    assert(e5.children[0].san === P.NULL_SAN && e5.children[0].fen === e5.fen && e5.children[0].from === null,
      "...it keeps the position before it rather than inventing one");
    assert(e5.children[0].children[0].fen === e5.fen, "...and the moves after it are recorded, not applied");
    assert(mainlineSans(P.parsePgn("1. e4 e5 2. Z0 Nf6 *").games[0].root).join(" ") === "e4 e5 -- Nf6", "Z0 is the same null move");
    const nmOut = P.serializePgn(nm);
    assert(/2\. -- Nf6/.test(nmOut), "...exported as '--', with no move number invented for the move after it");
    assert(canonGame(P.parsePgn(nmOut).games[0]) === canonGame(nm), "...and the round trip is exact");
    assert(P.splitGames("1. e4 e5 2. -- Nf6 *\n\n1. d4 d5 *").length === 2, "a null move no longer costs a whole file its games");

    // 3. a variation repeating the mainline move must not steal the mainline
    const st = P.parsePgn("1. e4 e5 (1... e5 2. d4) 2. Nf3 Nc6 *").games[0];
    assert(mainlineSans(st.root).join(" ") === "e4 e5 Nf3 Nc6", "the mainline continuation owns children[0], not the RAV's");
    const stE5 = st.root.children[0].children[0];
    assert(stE5.children.map((c) => c.san).join(",") === "Nf3,d4", "...and the RAV's continuation is the variation");
    assert(P.parsePgn("1. e4 (1. e4 e5) e5 *").games[0].root.children.length === 1, "...while the dedupe still does not fork");

    // 4. the result the movetext ended with is the game's, with no Result tag (19.0 checked it through the tree too)
    const nores = P.parsePgn("1. e4 e5 2. Nf3 1-0").games[0];
    assert(nores.result === "1-0", "the result the movetext ended with is the game's");
    assert(P.serializePgn(nores).trim().endsWith("1-0"), "...so the export does not turn 1-0 into *");

    // 5. a single token wider than the line
    const url = "https://example.org/a/" + "long-".repeat(20) + "path";
    const wide = P.parsePgn("1. e4 { see " + url + " } e5 *").games[0];
    const wideOut = P.serializePgn(wide);
    assert(wideOut.split("\n").every((l) => l.length <= 80), "a URL longer than the line is broken, not pushed past 80 columns");
    assert(canonGame(P.parsePgn(wideOut).games[0]) === canonGame(wide), "...losslessly: the comment comes back whole");
    const many = "[%cal " + ["e2e4", "d2d4", "g1f3", "b1c3", "f1c4", "c1f4", "d1d2", "e1g1", "a2a4", "h2h4"]
      .map((x) => "G" + x).join(",") + "]";
    const arr = P.parsePgn("1. e4 { " + many + " } e5 *").games[0];
    const arrOut = P.serializePgn(arr);
    assert(arrOut.split("\n").every((l) => l.length <= 80), "a long shape list is broken after a comma");
    assert(canonGame(P.parsePgn(arrOut).games[0]) === canonGame(arr), "...and every arrow comes back");

    // 6. "}" inside a comment is escaped, not rewritten. 7.0 changed the
    // spelling from "\\}" to "\\R": a private escape over a *literal brace*
    // forces the reader to decide, at the brace, whether the comment ends,
    // and 6.1's heuristic got our own files wrong. The old spelling still
    // decodes, so anything 6.0/6.1 wrote keeps opening.
    const brace = P.parsePgn("1. e4 { a brace \\R and a backslash \\\\ } e5 *").games[0];
    assert(brace.root.children[0].comment === "a brace } and a backslash \\", "'\\R' and '\\\\' decode to '}' and '\\'");
    const legacyBrace = P.parsePgn("1. e4 { a brace \\} and a backslash \\\\ } e5 *").games[0];
    assert(legacyBrace.root.children[0].comment === "a brace } and a backslash \\", "...and the 6.0/6.1 spelling still decodes");
    const braceOut = P.serializePgn(brace);
    assert(braceOut.includes("{ a brace \\R and a backslash \\\\ }"), "...and are written back escaped, never as ']' and never as a literal brace");
    assert(canonGame(P.parsePgn(braceOut).games[0]) === canonGame(brace), "...so the user's text survives the round trip");

    // 7. a comment in a moveless variation belongs to nobody
    const mv = P.parsePgn("1. e4 ( {alt} ) e5 2. Nf3 *").games[0];
    assert(mv.root.children[0].children[0].san === "e5" && mv.root.children[0].children[0].comment === null,
      "a comment in a variation with no move does not leak onto the next mainline move");
    assert(mv.root.children.length === 1 && mv.root.children[0].children.length === 1, "...and adds no phantom node");
    const two = P.parsePgn("1. e4 ( {a} {b} 1. d4 ) e5 *").games[0];
    assert(two.root.children[1].comment === "a b" && two.root.children[0].comment === null,
      "...while two comments before a variation's first move both belong to it");

    // 8. the "e.p." suffix
    const ep = P.parsePgn("1. e4 h6 2. e5 d5 3. exd6 e.p. Qxd6 *").games[0];
    assert(mainlineSans(ep.root).join(" ") === "e4 h6 e5 d5 exd6 Qxd6", "'e.p.' after a capture is ignored, not fatal");

    // 9. figurine SAN
    const fig = P.parsePgn("1. ♘f3 d5 2. ♙d4 ♞f6 *").games[0];
    assert(mainlineSans(fig.root).join(" ") === "Nf3 d5 d4 Nf6", "figurine pieces map to letters and the pawn glyph to nothing");
    const figErr = throwsWith(() => P.parsePgn("1. ♘z9 *"), /illegal move/);
    assert(!!figErr, "...and a figurine move that is illegal is an illegal move, not a character error");

    // 10. the cheap ones
    const lit = P.parsePgn("1. e4 { type \\[%cal Ge2e4] to draw } e5 *").games[0];
    assert(lit.root.children[0].comment === "type [%cal Ge2e4] to draw" && lit.root.children[0].shapes.arrows.length === 0,
      "an escaped '[%cal ...]' stays text and draws nothing");
    assert(canonGame(P.parsePgn(P.serializePgn(lit)).games[0]) === canonGame(lit), "...and stays text on the way out and back");
    const bad = P.parsePgn("1. e4 { [%cal Ge2e4,oops] } e5 *").games[0];
    assert(bad.root.children[0].shapes.arrows.length === 0 && bad.root.children[0].comment === "[%cal Ge2e4,oops]",
      "a shape list with a malformed entry is kept as text, not half-read and half-dropped");
    assert(canonGame(P.parsePgn(P.serializePgn(bad)).games[0]) === canonGame(bad), "...and survives the round trip");
    assert(P.parsePgn("1. e4 $12345678 e5 *").games[0].root.children[0].nags.join() === "12345678",
      "a long NAG number is read whole, not truncated to eight bytes");
    assert(!!throwsWith(() => P.parsePgn("1. e4 $ e5 *"), /malformed NAG/), "...and '$' with no digits is still an error");
  });

  test("pgn: errors name the spot", (a) => {
    const assert = (c, m) => a.ok(c, m);
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
  });

  test("pgn: splitGames", (a) => {
    const assert = (c, m) => a.ok(c, m);
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
  });

  // 6.1 (review): a foreign comment may end with a backslash
  //
  // PGN defines no escape inside a brace comment: the first "}" ends it, full
  // stop. This module defines one anyway so that a "}" the user typed survives
  // a round trip (escapeCommentText). Applied unconditionally, that private
  // reading turns a perfectly valid foreign comment like "{C:\path\}" into
  // either an unterminated-comment error or a comment that silently swallows
  // the movetext up to some later brace. The private reading now only wins
  // where it can be true: it has to terminate, and the span it claims past the
  // standard's "}" must not contain a "{" — which our own output never does.

  test("pgn: a foreign comment may end with a backslash (6.1)", (a) => {
    const assert = (c, m) => a.ok(c, m);
    const firstComment = (pgn) => {
      const g = P.parsePgn(pgn).games[0];
      const walk = (n) => { if (n.comment) return n.comment; for (const c of n.children) { const r = walk(c); if (r) return r; } return null; };
      return walk(g.root);
    };

    // 1. the case the review found: a trailing backslash with nothing after it
    assert(firstComment("1. e4 {C:\\path\\}") === "C:\\path\\",
      "a comment ending in a backslash ends at its own brace");

    // 2. the silent half — it must not eat the movetext up to the next brace
    {
      const g = P.parsePgn("1. e4 {C:\\path\\} e5 {fine} 2. Nf3").games[0];
      const sans = [];
      let n = g.root;
      while (n.children.length) { n = n.children[0]; sans.push(n.san); }
      assert(sans.join(" ") === "e4 e5 Nf3", "…and the moves after it are still moves (" + sans.join(" ") + ")");
    }

    // 3. our own round trip still carries a literal "}" and a backslash through
    {
      const g = P.parsePgn("1. e4").games[0];
      g.root.children[0].comment = "a } b \\ c";
      const out = P.serializePgn(g);
      assert(/\\R/.test(out) && !out.includes("\\}"), "the exporter escapes a brace and emits no literal one");
      assert(firstComment(out) === "a } b \\ c", "…and reading it back gives the text unchanged");
    }

    // 4. a comment with no closing brace anywhere is still an error
    assert(throwsWith(() => P.parsePgn("1. e4 {never closed"), /unterminated comment/),
      "a comment with no closing brace at all is still rejected");
  });

  // 7.0: a "}" in a comment once made a file unopenable
  //
  // 6.1 把私有转义写成 "\}"，也就是「一个字面右花括号，请别当成结束」。读的时候
  // 就必须在那个花括号上猜：它是结束，还是被转义了？6.1 的启发式对我们自己写的
  // 文件猜错了——注释里出现 "}" 再出现 "{"，要么静默截断，要么整份文件解析失败。
  // 存档槽位存的就是 PGN 文本，所以那是永久丢档。
  //
  // 7.0 把花括号写成 "\R"，序列化后的注释体里一个字面 "}" 都没有，读的时候就不
  // 用猜了：第一个 "}" 就是结束，也就是标准的规则。

  test("pgn: braces in comments round-trip (7.0)", (a) => {
    const assert = (c, m) => a.ok(c, m);
    const firstComment = (pgn) => {
      const g = P.parsePgn(pgn).games[0];
      const walk = (n) => { if (n.comment) return n.comment; for (const c of n.children) { const r = walk(c); if (r) return r; } return null; };
      return walk(g.root);
    };
    const mainline = (pgn) => {
      const g = P.parsePgn(pgn).games[0];
      const s = []; let n = g.root;
      while (n.children.length) { n = n.children[0]; s.push(n.san); }
      return s.join(" ");
    };
    // 6.1 下这五条各自会截断或抛错
    for (const text of ["}{", "} x {", "a}b{c", "}}{{", "} [%cal Ge2e4] {", "}", "{", "\\R", "a\\Rb"]) {
      const g = P.parsePgn("1. e4").games[0];
      g.root.children[0].comment = text;
      const out = P.serializePgn(g);
      const back = firstComment(out);
      assert(back === text, "注释 " + JSON.stringify(text) + " 原样往返（得到 " + JSON.stringify(back) + "）");
    }
    // 而且后面的着法还是着法，不会被吞进注释
    {
      const g = P.parsePgn("1. e4 e5 2. Nf3").games[0];
      g.root.children[0].comment = "a}b{c";
      const out = P.serializePgn(g);
      assert(mainline(out) === "e4 e5 Nf3", "……且其后的着法一手不少");
    }
    // 外部文件以反斜杠结尾的注释仍然正确（6.1 修的那条不能回退）
    assert(firstComment("1. e4 {C:\\path\\}") === "C:\\path\\", "外部注释以反斜杠结尾，按标准在它自己的花括号处结束");
    assert(mainline("1. e4 {C:\\path\\} e5 {fine} 2. Nf3") === "e4 e5 Nf3", "……且不吞掉后面的着法");
    // 真正没有结束花括号的仍然报错
    assert(throwsWith(() => P.parsePgn("1. e4 {never closed"), /unterminated comment/), "全篇没有右花括号仍然报错");
  });

  // 7.0: a seeded random round trip. The brace defect above was found by a random
  // round trip, not by reading the code: it only shows on "a } then a {" in one comment,
  // which no hand-written case thought of. So the machine stays, its seed fixed. 19.0 built
  // the games with game-tree.js; this builds the parser's own node shape, with the tree's
  // rules: a move already there is not added twice, a comment's whitespace collapses.
  test("pgn: a seeded random game round-trips field by field (7.0)", (a) => {
    let seed = 20260920;
    const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
    const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
    const COMMENTS = [null, "简单", "a } b", "back\\slash", "path\\", "[%cal Gd1d4]",
      "line1\nline2", "a".repeat(120), "半角:; 分号", "{nested}", "%", "$5", "1-0",
      "((()))", "  spaced  ", "}{", "a}b{c", "}}{{", "\\R", "a\\Rb", "]", "[", "\\", "\\\\", "}{"];
    const NAGSETS = [[], [1], [2, 14], [123], [1, 2, 3, 4, 5], [255]];
    const SHAPES = [{ arrows: [], circles: [] },
      { arrows: [{ from: "e2", to: "e4", color: "G" }], circles: [] },
      { arrows: [], circles: [{ sq: "d4", color: "R" }] },
      { arrows: [{ from: "a1", to: "h8", color: "B" }], circles: [{ sq: "e5", color: "Y" }] }];
    const node = (fen) => ({ san: null, from: null, to: null, promotion: null, fen, comment: null, nags: [], shapes: { arrows: [], circles: [] }, children: [] });
    const addMove = (parent, san) => {
      const g = new Chess(parent.fen);
      const m = g.move(san);
      const had = parent.children.find((c) => c.san === m.san);
      if (had) return had;
      const n = Object.assign(node(g.fen()), { san: m.san, from: m.from, to: m.to, promotion: m.promotion || null });
      parent.children.push(n);
      return n;
    };
    const canonN = (n) => ({ san: n.san, comment: n.comment, nags: (n.nags || []).slice().sort((x, y) => x - y), shapes: n.shapes, children: n.children.map(canonN) });
    const canonT = (g) => JSON.stringify({ fen: g.root.fen, result: g.result, root: canonN(g.root) });

    let bad = 0, cases = 0;
    const why = [];
    for (let iter = 0; iter < 250 && bad < 3; iter++) {
      const game = { headers: [["Event", "fuzz"]], root: node(P.START_FEN), result: "*" };
      const frontier = [game.root];
      for (let step = 0; step < 14; step++) {
        const at = pick(frontier);
        const ms = new Chess(at.fen).moves();
        if (!ms.length) continue;
        const nd = addMove(at, pick(ms));
        if (rnd() < 0.6) { const t = pick(COMMENTS); nd.comment = t == null ? null : String(t).replace(/\s+/g, " ").trim() || null; }
        if (rnd() < 0.4) nd.nags = pick(NAGSETS).slice();
        if (rnd() < 0.3) { const sh = pick(SHAPES); nd.shapes = { arrows: sh.arrows.map((x) => ({ ...x })), circles: sh.circles.map((x) => ({ ...x })) }; }
        frontier.push(nd);
        if (frontier.length > 6) frontier.shift();
      }
      game.result = pick(["1-0", "0-1", "1/2-1/2", "*"]);
      cases++;
      let out = "", back;
      try {
        out = P.serializePgn(game);
        back = P.parsePgn(out).games[0];
      } catch (e) { bad++; why.push("iter " + iter + " threw: " + e.message + "\n" + out); continue; }
      if (canonT(game) !== canonT(back)) { bad++; why.push("iter " + iter + " differs\n" + out); }
    }
    a.ok(bad === 0, cases + " random games, " + bad + " not equal after the round trip\n" + why.join("\n"));
    a.ok(cases === 250, "250 games (" + cases + ")");
  });

  // 7.5: a large file does not freeze the window
  // 画面不动。现在 parseGamesAsync 每跑 ~16ms 让一次线程；这里用插桩的 pause
  // 量两次让出之间最长的一段同步时间（切分也算在第一段里），要求不超过 50ms。

  test("pgn: a large file yields while it parses, and splitting is linear (7.5)", async (a) => {
    const assert = (c, m) => a.ok(c, m);
    const game = (k) => `[Event "g${k}"]\n[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n` +
      (k % 97 === 13 ? "1. e4 e5 2. Ke3 Nc6 1-0" // illegal: this one must come back null
        : "1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O) 4. Ba4 Nf6 5. O-O Be7 6. Re1 b5 7. Bb3 d6 8. c3 O-O 1-0") + "\n\n";
    const big = (n) => Array.from({ length: n }, (_, k) => game(k)).join("");
    const N = 1000;
    const text = big(N);
    const now = () => performance.now();
    // best of three: on a busy CI runner one garbage-collection pause can push a
    // single slice past 50ms (a shared macOS runner measured 66ms once), while
    // the regression this guards — a parse that never yields — costs seconds
    // on every run, so the minimum still catches it
    let worst = Infinity, pauses = 0, chunks = [], games = [];
    for (let run = 0; run < 3 && worst >= 50; run++) {
      let last = now(), w = 0, p = 0;
      chunks = P.splitGames(text);
      games = await P.parseGamesAsync(chunks, {
        now,
        pause: async () => { w = Math.max(w, now() - last); p++; await null; last = now(); },
      });
      w = Math.max(w, now() - last);
      if (w < worst) { worst = w; pauses = p; }
    }
    const bad = Array.from({ length: N }, (_, k) => k).filter((k) => k % 97 === 13).length;
    assert(chunks.length === N && games.length === N, `${N} 局切出 ${chunks.length} 段、解析出 ${games.length} 个槽位`);
    assert(games.filter((g) => !g).length === bad, `坏的 ${bad} 局是 null，其余照常 —— 一局坏不连累别的`);
    assert(games[1] && games[1].headers.some(([k, v]) => k === "Event" && v === "g1"), "槽位按文件顺序");
    assert(pauses > 0 && worst < 50,
      `${N} 局：解析中让出线程 ${pauses} 次，最长一段同步 ${worst.toFixed(1)}ms（< 50ms）`);
    // splitting stays linear: it looked for the move number in all the text
    // before every boundary, so 4× the games cost ~16× the time (8000 局 9.4s)
    // Best of five on 3000 / 12000 games: at 1500 games the split took ~19ms on
    // a shared macOS runner, where one GC pause read the ratio as 8.1 (CI,
    // PR #98). A quadratic split still reads ~16× here; linear ~4×.
    const time = (n) => { const t = big(n); let best = Infinity;
      for (let r = 0; r < 5; r++) { const t0 = now(); P.splitGames(t); best = Math.min(best, now() - t0); } return best; };
    const s1 = time(3000), s4 = time(12000);
    assert(s4 / s1 < 8, `切分是线性的：3000 局 ${s1.toFixed(0)}ms，12000 局 ${s4.toFixed(0)}ms（比值 ${(s4 / s1).toFixed(1)} < 8）`);
  });

};
