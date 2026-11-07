/**
 * Opening drills: their identity, what a failed one teaches, and the
 * tactical motifs the course and the puzzle set share.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, ctx, Chess, loadModule, allAppSource, allSourceExcept } from "./harness.mjs";

export async function run() {
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
}
