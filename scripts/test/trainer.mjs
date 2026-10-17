/**
 * The trainer: the opening coach, review scheduling, 为你出一题, 执黑背谱,
 * 错题自炼, the hover preview, 进步档案 and 今天的训练, and their wiring.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, ctx, Chess, loadModule, allAppSource, srcOf } from "./harness.mjs";

export async function run() {
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
      // 14.0 A2: the answer is the hint module's second level (puzzle-hint.js)
      /function showPuzzleAnswer\(\) \{ Hint\.show\(\); \}/.test(appSrc) &&
      /function show\(\) \{[\s\S]{0,200}pz\.g\.turn\(\) !== puzzleHumanSide\(\)/.test(appSrc),
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
    // (Codex on #113: an imported game has a "you" only when it is this app's own record)
    assert(/const hasYou = store\.session\.mode === "ai" && !store\.session\.analysisBoard &&\s*\(!store\.game\.imported \|\| store\.game\.recordedId != null\);/.test(appSrc) &&
           /if \(hasYou\) \{[\s\S]{0,900}Mistakes\.candidatesFrom\(pass, store\.session\.humanColor, Chess, rev\)/.test(appSrc) &&
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
}
