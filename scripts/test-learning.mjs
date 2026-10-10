/**
 * Node tests for the 6.0 learning system (docs/v6-plan.md §Q3):
 * rating.js (Glicko-2), srs.js (time axis), opening-tree.js, the Lichess
 * importer and its gate. Run: node scripts/test-learning.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import zlib from "zlib";
import { spawnSync } from "child_process";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { gate, positionGate, mirrorLine } from "./lib/puzzle-gate.mjs";
import { THEMES, themeContext, verifyThemes } from "./lib/puzzle-themes.mjs";
import { CHUNKS, lichessChunks } from "./bundle.mjs";
import {
  parseCsv, runPipeline, convert, mirrorFen, mirrorUci, mapThemes, categoryOf, THEME_MAP, themeKey, bandOf, seededRng,
  admissible, cellOf, qualityKey, createPools, selectPuzzles, encodeRow,
} from "./import-puzzles.mjs";

const ctx = loadAppModules([
  "src/web/js/chess.js", "src/web/js/rating.js", "src/web/js/srs.js",
  "src/web/js/opening-tree.js", "src/web/js/openings.js", "src/web/js/puzzles.js",
  "src/web/js/motif.js", "src/web/js/puzzle-db.js",
  // the index chunk-mined.js puts on the window (mined-chunk.js)
  "src/web/js/puzzles-lc-index.js",
]);
const Chess = ctx.Chess;

let failed = 0;
function assert(cond, msg) {
  if (!cond) { failed++; console.error("FAIL:", msg); }
  else console.log("ok:", msg);
}
const near = (a, b, tol) => Math.abs(a - b) <= tol;

// ---------------------------------------------------------------- rating
{
  const R = ctx.ChessRating;
  const fresh = R.newRating();
  assert(fresh.r === 1500 && fresh.rd === 350 && fresh.vol === 0.06, "a new rating is the paper's default 1500/350/0.06");

  // Glickman 2012, "Example of the Glicko-2 system": 1500/200/0.06 beats
  // 1400/30, loses to 1550/100 and 1700/300, tau 0.5 → 1464.06 / 151.52 / 0.05999
  const p = R.update({ r: 1500, rd: 200, vol: 0.06 },
    [{ r: 1400, rd: 30, score: 1 }, { r: 1550, rd: 100, score: 0 }, { r: 1700, rd: 300, score: 0 }], { tau: 0.5 });
  assert(near(p.r, 1464.06, 0.01), "paper example: r = 1464.06 (" + p.r.toFixed(2) + ")");
  assert(near(p.rd, 151.52, 0.01), "paper example: rd = 151.52 (" + p.rd.toFixed(2) + ")");
  assert(near(p.vol, 0.05999, 0.00001), "paper example: vol = 0.05999 (" + p.vol.toFixed(5) + ")");

  // Q3 acceptance: the rating moves with the answer, in the right direction
  const puzzle = { r: 1500, rd: 80, vol: 0.01 };
  const win = R.rate1v1(R.newRating(), puzzle, 1);
  const loss = R.rate1v1(R.newRating(), puzzle, 0);
  assert(win.player.r > 1500 && loss.player.r < 1500, "a solve raises the player, a miss lowers it (" + win.player.r.toFixed(0) + " / " + loss.player.r.toFixed(0) + ")");
  assert(win.puzzle.r < 1500 && loss.puzzle.r > 1500, "…and the puzzle moves the other way (" + win.puzzle.r.toFixed(1) + " / " + loss.puzzle.r.toFixed(1) + ")");
  assert(win.player.rd < 350 && win.puzzle.rd < 80, "an answer makes both sides more certain");
  assert(win.puzzle.vol === R.PUZZLE.vol, "the puzzle's volatility stays pinned");
  assert(Math.abs(win.puzzle.r - 1500) < Math.abs(win.player.r - 1500), "a puzzle rated by many moves less than a player rated by nothing");
  // rd floor: a puzzle answered a thousand times still listens
  let q = { r: 1500, rd: 80, vol: 0.01 }, pl = { r: 1500, rd: 60, vol: 0.06 };
  for (let i = 0; i < 1000; i++) q = R.rate1v1(pl, q, i % 2).puzzle;
  assert(q.rd >= R.PUZZLE.rdFloor, "puzzle rd never drops below the floor (" + q.rd.toFixed(1) + ")");
  // no games: only uncertainty grows
  const idle = R.update({ r: 1600, rd: 50, vol: 0.06 }, []);
  assert(idle.r === 1600 && idle.rd > 50, "a period without answers widens rd and leaves r alone");
  // expected score is symmetric and monotone
  const a = { r: 1500, rd: 50 }, b = { r: 1700, rd: 50 };
  assert(near(R.expectedScore(a, b) + R.expectedScore(b, a), 1, 1e-12), "E(a,b) + E(b,a) = 1");
  assert(R.expectedScore(a, b) < 0.5 && R.expectedScore(a, a) === 0.5, "the weaker side expects less than half");
  const range = R.pickRange({ r: 1500, rd: 50 });
  assert(range.lo === 1350 && range.hi === 1650, "pickRange defaults to ±150 for a settled rating");
  assert(R.pickRange({ r: 1500, rd: 350 }).lo < 1350, "…and widens while the rating is uncertain");
  assert(R.pickRange({ r: 1500, rd: 50 }, 100).hi === 1600, "width is a parameter");

  // v8-0-plan B1: a newcomer who misses one easy puzzle (a hand-written m1,
  // 1100/200) lost 396 points in one answer — out of the band they were
  // being served from and into puzzles far too easy for them. One answer
  // may move a rating by at most the pick band's half-width.
  const firstMiss = R.rate1v1(R.newRating(), { r: 1100, rd: 200, vol: 0.06 }, 0).player;
  const firstHit = R.rate1v1(R.newRating(), { r: 1900, rd: 200, vol: 0.06 }, 1).player;
  assert(1500 - firstMiss.r <= 150 && firstMiss.r < 1500, "first miss on an easy puzzle moves a new player at most 150 (" + (firstMiss.r - 1500).toFixed(0) + ")");
  assert(firstHit.r - 1500 <= 150 && firstHit.r > 1500, "…and a first solve of a hard one at most +150 (" + (firstHit.r - 1500).toFixed(0) + ")");
  assert(firstMiss.rd < 350 && R.isProvisional(firstMiss), "the capped answer still narrows rd, and the rating stays provisional (" + firstMiss.rd.toFixed(0) + ")");
  const settled = R.rate1v1({ r: 1500, rd: 60, vol: 0.06 }, { r: 1500, rd: 80, vol: 0.01 }, 1).player;
  const settledRaw = R.update({ r: 1500, rd: 60, vol: 0.06 }, [{ r: 1500, rd: 80, score: 1 }]);
  assert(settled.r === settledRaw.r, "a settled rating is plain Glicko-2 — the cap never binds there");
}

// ---------------------------------------------------------------- rating model, simulated
// v8-0-plan B1 acceptance: a virtual player of fixed strength answers
// puzzles, each correctly with the Glicko win-expectancy of that strength
// against the puzzle; the app's own update (rate1v1, cap included) rates
// every answer. The model is right if (a) the rating finds the strength, and
// (b) the correct-rate, bucketed by puzzle − player rating at the moment of
// answering, is the curve the rating itself predicts. Seeded, so the numbers
// below are the same on every run.
{
  const R = ctx.ChessRating;
  const PUZZLE_RD = 75; // what a Lichess puzzle carries after thousands of plays
  const truth = (T, pr) => R.expectedScore({ r: T, rd: 0 }, { r: pr, rd: PUZZLE_RD });
  const bins = {}; // (puzzle − player) in 100-point bins → [answers, correct, predicted]
  for (const T of [900, 1500, 2100]) {
    const rng = seededRng(T);
    let pl = R.newRating();
    const tail = [];
    for (let i = 0; i < 3000; i++) {
      // a spread of ±300 around the current estimate, wider than pickRange,
      // so the curve is measured on both flanks and not only near 50%
      const pr = pl.r + (rng() * 600 - 300);
      const puzzle = { r: pr, rd: PUZZLE_RD, vol: 0.01 };
      const correct = rng() < truth(T, pr) ? 1 : 0;
      if (i >= 500) {
        const k = Math.max(-300, Math.min(200, Math.floor((pr - pl.r) / 100) * 100));
        const b = bins[k] || (bins[k] = [0, 0, 0]);
        b[0]++; b[1] += correct; b[2] += R.expectedScore(pl, puzzle);
      }
      pl = R.rate1v1(pl, puzzle, correct).player;
      if (i >= 1500) tail.push(pl.r);
    }
    const mean = tail.reduce((a, b) => a + b, 0) / tail.length;
    assert(Math.abs(mean - T) <= 40, "simulated player of strength " + T + " is rated " + mean.toFixed(0) + " (±40)");
    assert(!R.isProvisional(pl), "…and no longer provisional after 3000 answers (rd " + pl.rd.toFixed(0) + ")");
  }
  const keys = Object.keys(bins).map(Number).sort((a, b) => a - b);
  let prev = 1, worst = 0;
  for (const k of keys) {
    const [n, c, e] = bins[k];
    const got = c / n, want = e / n;
    worst = Math.max(worst, Math.abs(got - want));
    assert(got < prev, "correct-rate falls as the puzzle gets harder (" + k + ".." + (k + 99) + ": " + (got * 100).toFixed(1) + "%)");
    prev = got;
  }
  assert(worst <= 0.04, "correct-rate by (puzzle − player) matches the Glicko prediction within 4 points in every bin (worst " + (worst * 100).toFixed(1) + ")");
}

// ---------------------------------------------------------------- srs
{
  const S = ctx.ChessSrs;
  const DAY = S.DAY;
  const T0 = Date.UTC(2026, 0, 10);

  // the count axis alone, without a clock: null on graduation
  let e = S.onMiss(undefined);
  assert(S.isDue(e), "count axis: a missed puzzle enters the queue");
  e = S.onSolve(e);
  assert(e && S.isDue(e) && e.s === 1, "count axis: one clean solve is not enough");
  assert(S.onSolve(e) === null, "count axis: the second consecutive clean solve graduates");
  assert(S.entry(true) === null && !S.isDue(true), "count axis: what is not an entry is not in the queue");
  assert(S.onSolve(undefined) === null, "count axis: solving an unqueued puzzle is a no-op");
  assert(S.entry({ s: 1, n: 2 }).due === 0 && S.entry({ s: 1, n: 2 }).ivl === 0, "an entry without dates reads as overdue");

  // the time axis: 1 → 3 → 7 → 21
  let t = S.onMiss(undefined, T0);
  assert(t.due === T0 && t.ivl === 0 && S.isDue(t), "a miss is due at once");
  t = S.onSolve(t, T0);
  assert(t.s === 1 && t.ivl === 1 && t.due === T0 + DAY, "first clean solve: due tomorrow");
  assert(S.isDue(t), "…and still owed by count (streak 1 < GRADUATE)");
  assert(!S.isDue(t, T0 + 1000) && S.isDue(t, T0 + DAY), "…but with a clock it is not due until tomorrow");
  t = S.onSolve(t, T0 + DAY);
  assert(t && t.s === 2 && t.ivl === 3 && t.due === T0 + 4 * DAY, "second clean solve: graduated by count, due again in 3 days");
  assert(!S.isDue(t), "a graduated puzzle no longer owes the queue (picker rung 1 leaves it alone)");
  assert(!S.dueBy(t, T0 + 3 * DAY) && S.dueBy(t, T0 + 4 * DAY), "…yet is due by date on its day, which is how the solve path lets it climb the ladder");
  assert(S.progress(t)[0] === S.GRADUATE, "…and shows full progress");
  assert(S.dueCount({ x: t }, T0 + 4 * DAY) === 1 && S.dueCount({ x: t }, T0 + 3 * DAY) === 0, "…but the retention check is counted on its day");
  t = S.onSolve(t, T0 + 4 * DAY);
  assert(t.ivl === 7, "third: 7 days");
  t = S.onSolve(t, t.due);
  assert(t.ivl === 21, "fourth: 21 days");
  assert(S.onSolve(t, t.due) === null, "a clean solve on the last rung retires the puzzle");
  // a miss on the ladder resets everything
  const back = S.onMiss({ s: 3, n: 5, ivl: 7, due: T0 }, T0 + 9 * DAY);
  assert(back.s === 0 && back.ivl === 0 && back.due === T0 + 9 * DAY && back.n === 6 && S.isDue(back), "a miss at a retention check puts it back in the queue, due now");

  // Q3 acceptance: offline 14 days, back today → today's load ≤ cap
  const state = {};
  for (let i = 0; i < 40; i++) state["p" + i] = { s: i % 2, n: 1, ivl: 1, due: T0 - (i % 14) * DAY };
  state.undated = { s: 0, n: 1 };
  const CAP = 10;
  const today = S.dueQueue(state, T0, CAP);
  assert(today.length === CAP, "14 days away, 41 due: today serves " + today.length + " (cap " + CAP + ")");
  assert(today[0] === "undated", "the entry with no date is the most overdue and comes first");
  assert(S.dueCount(state, T0) === CAP, "after spreading, dueCount(today) == cap");
  assert(S.dueCount(state, T0 + DAY) === 2 * CAP, "tomorrow adds the next batch");
  assert(S.dueCount(state, T0 + 3 * DAY) === 40 && S.dueCount(state, T0 + 4 * DAY) === 41, "the whole backlog drains at cap a day");
  const moved = Object.keys(state).filter((id) => !today.includes(id));
  assert(moved.length === 31 && moved.every((id) => state[id].due > T0 && state[id].due <= T0 + 4 * DAY && state[id].s === (Number(id.slice(1)) % 2)),
    "rescheduled entries keep their streak and only move their date forward");
  // a second call the same day serves the same batch again (idempotent)
  assert(S.dueQueue(state, T0, CAP).join() === today.join(), "dueQueue on the same day is idempotent");
  // nothing due → empty, and a small queue is served whole
  assert(S.dueQueue({ a: { s: 0, n: 1, due: T0 + DAY } }, T0, 5).length === 0, "not yet due: nothing");
  assert(S.dueQueue({ a: { s: 0, n: 1, due: T0 } }, T0, 5).join() === "a", "under the cap: everything due");
  // most overdue first, least-learned within a day
  const ord = S.dueQueue({ a: { s: 1, n: 1, due: T0 - DAY }, b: { s: 0, n: 1, due: T0 - DAY }, c: { s: 0, n: 1, due: T0 - 3 * DAY } }, T0, 9);
  assert(ord.join() === "c,b,a", "most overdue first, then least-learned (" + ord.join() + ")");
}

// ---------------------------------------------------------------- opening tree
{
  const T = ctx.ChessOpeningTree;
  const lines = ctx.CHESS_OPENINGS;
  const tree = T.buildTree(lines);
  assert(tree.count === lines.length, "root counts every line (" + tree.count + ")");

  // every original line is reachable as a path and stored where it ends
  let missing = 0;
  for (const row of lines) {
    const sans = row[2].split(" ");
    const n = T.nodeAt(tree, sans);
    if (!n || !n.lines.some((l) => l.id === row[1] && l.eco === row[0])) missing++;
  }
  assert(missing === 0, "all " + lines.length + " book lines are reachable paths in the tree");

  // children are legal moves and their weights are line counts
  let illegal = 0, weightBad = 0, branchPoints = 0;
  (function walk(sans, g) {
    const kids = T.childrenAt(tree, sans);
    if (kids.length > 1) branchPoints++;
    const node = T.nodeAt(tree, sans);
    const through = kids.reduce((n, k) => n + k.count, 0) + node.lines.length;
    if (through !== node.count) weightBad++;
    for (const k of kids) {
      const m = g.move(k.san);
      if (!m || m.san !== k.san) { illegal++; continue; }
      walk(sans.concat(k.san), g);
      g.undo();
    }
  })([], new Chess());
  assert(illegal === 0, "every child in the tree is a legal, canonical move");
  assert(weightBad === 0, "a node's weight = lines ending here + lines through its children");
  assert(branchPoints > 20, "the book branches in " + branchPoints + " places");
  assert(T.childrenAt(tree, ["a4", "h5"]).length === 0, "off-book path has no children");
  assert(T.weightedPick(tree, ["a4", "h5"], Math.random) === null, "…and nothing to pick");

  // picks are always legal children; the main line is picked more
  const e4 = T.childrenAt(tree, ["e4"]);
  const top = e4.slice().sort((a, b) => b.count - a.count)[0];
  const rng = seededRng(7);
  const tally = {};
  let offList = 0;
  for (let i = 0; i < 400; i++) {
    const s = T.weightedPick(tree, ["e4"], rng);
    if (!e4.some((k) => k.san === s)) offList++;
    tally[s] = (tally[s] || 0) + 1;
  }
  assert(offList === 0, "400 picks after 1.e4 are all book children");
  assert(Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0] === top.san,
    "the child with the most lines (" + top.san + ", " + top.count + ") is picked most");

  // Q3 acceptance: the opponent varies at the same branch point
  const rng2 = seededRng(1);
  let varied = false;
  for (const sans of [["e4"], ["d4"], ["e4", "e5", "Nf3"], ["d4", "d5"]]) {
    if (T.childrenAt(tree, sans).length < 2) continue;
    const seen = new Set();
    for (let i = 0; i < 20; i++) seen.add(T.weightedPick(tree, sans, rng2));
    if (seen.size >= 2) { varied = true; break; }
  }
  assert(varied, "a seeded rng gives two different children at a branch point within 20 draws");

  // leaves: exactly the lines no other line extends
  const leaves = T.leafLines(tree);
  const seqs = lines.map((r) => r[2]);
  const expect = lines.filter((r) => !seqs.some((s) => s !== r[2] && s.startsWith(r[2] + " ")));
  assert(leaves.length === expect.length, "leafLines returns the " + expect.length + " maximal lines (" + leaves.length + ")");
  assert(leaves.every((l) => T.childrenAt(tree, l.sans).length === 0), "…each with nothing beyond it in the book");
}

// ---------------------------------------------------------------- mirrorFen
{
  const start = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
  assert(mirrorFen(start) === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 0 1", "mirroring the start position only flips the side to move");
  const f = "r3k2r/8/8/3Pp3/8/8/8/R3K2R w Kq e6 0 20";
  const m = mirrorFen(f);
  assert(m === "r3k2r/8/8/8/3pP3/8/8/R3K2R b Qk e3 0 20", "ranks flip, colours swap, castling sides swap, ep rank mirrors (" + m + ")");
  assert(mirrorFen(m) === f, "mirror is an involution");
  assert(new Chess().validate_fen(m).valid, "the mirror of a legal position is legal");
  assert(mirrorUci("e2e4") === "e7e5" && mirrorUci("a7a8q") === "a2a1q", "mirrorUci flips ranks and keeps the promotion");
  // tactical facts survive the mirror: a mate stays a mate
  // Black to move, ...Ra1# on the board; mirrored it is the book's m1-backrank-r, Ra8#
  const g = new Chess(mirrorFen("r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1"));
  const mv = g.move({ from: "a1", to: "a8" });
  assert(mv && g.in_checkmate(), "a back-rank mate mirrored is still a back-rank mate");
  let bad = 0;
  const cnt = (fen, re) => (fen.split(" ")[0].match(re) || []).length;
  for (const p of ctx.CHESS_PUZZLES) {
    const mm = mirrorFen(p.fen);
    if (!new Chess().validate_fen(mm).valid) bad++;
    // colours swapped: Black now has exactly the men White had
    if (cnt(p.fen, /[A-Z]/g) !== cnt(mm, /[a-z]/g) || cnt(p.fen, /[a-z]/g) !== cnt(mm, /[A-Z]/g)) bad++;
  }
  assert(bad === 0, "mirrorFen keeps every hand-written puzzle legal with the colours swapped");
}

// ---------------------------------------------------------------- the gate, on the hand-written set
{
  let bad = 0;
  for (const p of ctx.CHESS_PUZZLES) {
    if (p.cat === "draw") continue; // the importer has no source of draws, so no gate was ported
    const r = gate(Chess, p);
    if (!r.ok) { bad++; console.error("  gate rejects hand-written", p.id, r.reason); }
  }
  assert(bad === 0, "the ported gate accepts every hand-written puzzle it has a rule for");
  assert(!gate(Chess, { cat: "m1", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", solution: ["Ra7"] }).ok, "…and rejects a non-mate sold as m1");
  assert(!gate(Chess, { cat: "m2", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", solution: ["Ra7", "Kf8", "Ra8+"] }).ok, "…and an m2 with a one-move shortcut");
  assert(!positionGate(Chess, "6k1/5ppp/8/8/8/8/8/R5K1 b - - 0 1").ok, "…and a black-to-move position");
}

// ---------------------------------------------------------------- the importer on the fixture
{
  const csvPath = path.join(ROOT, "scripts/fixtures/lichess-sample.csv");
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  assert(rows.length === 58, "fixture parses to 58 rows (" + rows.length + ")");
  assert(rows[0].id === "F0000" && rows[0].moves.length === 2 && rows[0].rating === 600, "columns land in the right fields");

  assert(mapThemes("fork mateIn2 short").cat === "m2", "a mate theme outranks a motif theme");
  assert(mapThemes("pin fork").motif === "fork" && mapThemes("endgame crushing") === null, "first match in THEME_MAP order; unknown themes map to nothing");
  assert(THEME_MAP.every(([, t]) => ["m1", "m2", "m3", "tac", "win", "def"].includes(t.cat)), "every mapped category has a gate");
  assert(categoryOf("endgame crushing").cat === "tac" && categoryOf("advantage sacrifice").cat === "tac",
    "v8-0-plan B1: a crushing/advantage line is graded as a tactic (its gate proves the material)");
  assert(categoryOf("mate mateIn4 long") === null && categoryOf("equality endgame") === null, "…but a mate in four and an equal line have no gate");

  const opt = { perTheme: 100, perBand: 50, max: 2000, seed: 1 };
  const { puzzles, stats } = runPipeline(Chess, rows, opt);
  assert(puzzles.length === 49, "49 puzzles emitted (" + puzzles.length + ")");
  assert(stats.unmapped === 3, "3 rows skipped for unmapped themes (deflection, capturingDefender, equality)");
  const rejected = Object.values(stats.rejected).reduce((n, x) => n + x, 0);
  assert(rejected === 6, "6 rows rejected (" + rejected + ")");
  const expectReasons = [
    ["R0052", /solvable in fewer moves/, "mateIn2 with a mate in one"],
    ["R0053", /does not mate/, "mateIn1 that does not mate"],
    ["R0054", /swings -3 < gain/, "fork that loses material"],
    ["R0055", /solution move illegal/, "illegal solution move"],
    ["R0056", /not actually threatening/, "defence against no threat"],
    ["R0057", /opponent move illegal/, "illegal opponent move"],
  ];
  for (const [id, re, why] of expectReasons) assert(re.test(stats.rejectedIds[id] || ""), "rejected " + id + ": " + why);
  const cats = {};
  for (const p of puzzles) cats[p.cat] = (cats[p.cat] || 0) + 1;
  assert(cats.m1 === 8 && cats.m2 === 8 && cats.m3 === 5 && cats.tac === 12 && cats.def === 8 && cats.win === 8,
    "categories: " + JSON.stringify(cats));
  const motifs = new Set(puzzles.filter((p) => p.motif).map((p) => p.motif));
  assert(["fork", "pin", "skewer", "discovered"].every((m) => motifs.has(m)), "motifs use motif.js names: " + [...motifs].join(","));

  // shape of an emitted entry — v8-0-plan B1: the solver keeps its side
  const shapeBad = puzzles.filter((p) => !/^lc-/.test(p.id) || p.src !== "lichess" || !p.url || !Number.isFinite(p.rating) ||
    !Array.isArray(p.solution) || !p.solution.length || (p.fen.split(" ")[1] === "b") !== (p.side === "b"));
  assert(shapeBad.length === 0, "every entry is {id:lc-…, cat, fen, solution, rating, src, url}, and side:\"b\" exactly when Black is to move");
  const blacks = puzzles.filter((p) => p.side === "b");
  assert(blacks.length >= 20 && blacks.length < puzzles.length, "black-to-move rows stay black (" + blacks.length + " of " + puzzles.length + "), none mirrored");
  assert(puzzles.filter((p) => p.cat === "tac" || p.cat === "win").every((p) => p.gain >= 1), "tac/win entries carry the gain the gate measured");
  assert(puzzles.filter((p) => p.cat === "def").every((p) => p.saves >= 1), "def entries carry the number of saving moves");
  assert(new Set(puzzles.map((p) => p.id)).size === puzzles.length, "ids are unique");

  // every emitted puzzle passes the same gate as the hand-written ones —
  // a black one on its mirror (puzzle-gate.mjs gate → mirrorLine)
  let gateBad = 0;
  for (const p of puzzles) { const r = gate(Chess, p); if (!r.ok) { gateBad++; console.error("  ", p.id, r.reason); } }
  assert(gateBad === 0, "all emitted puzzles pass the hand-written gate, black ones included");
  assert(!gate(Chess, { cat: "m1", fen: "r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1", solution: ["Ra2"] }).ok, "…and the mirrored gate still rejects a black non-mate");

  // a black row is exactly the hand-written white puzzle, seen from the other chair
  const byOrig = {};
  for (const p of ctx.CHESS_PUZZLES) byOrig[p.fen.split(" ").slice(0, 4).join(" ")] = p;
  const blackRows = rows.filter((r) => /^F/.test(r.id) && r.fen.split(" ")[1] === "w");
  assert(blackRows.length === 26, "26 fixture rows have the solver on Black (" + blackRows.length + ")");
  let backHome = 0, mapped = 0;
  for (const r of blackRows) {
    if (!mapThemes(r.themes)) continue;
    mapped++;
    const c = convert(Chess, r);
    const m = c.ok && c.puzzle.side === "b" ? mirrorLine(Chess, c.puzzle.fen, c.puzzle.solution) : null;
    const hand = m && byOrig[m.fen.split(" ").slice(0, 4).join(" ")];
    if (hand) backHome++;
    else console.error("  not a hand-written position after mirroring:", r.id, c.ok ? c.puzzle.fen : c.reason);
  }
  assert(backHome === mapped, "every mapped black row is stored black, and mirrors to a hand-written white puzzle (" + backHome + "/" + mapped + ")");
  // the miner keeps the old white-to-move form (its 1002 ids depend on it)
  const legacy = runPipeline(Chess, rows, Object.assign({ mirror: true }, opt));
  assert(legacy.puzzles.length === 49 && legacy.puzzles.every((p) => p.fen.split(" ")[1] === "w" && !p.side),
    "--mirror (mine-puzzles.mjs) still puts every solver on White");

  // quotas and determinism
  const small = runPipeline(Chess, rows, { perTheme: 3, perBand: 50, max: 2000, seed: 1 });
  assert(Object.values(small.stats.byTheme).every((n) => n <= 3) && small.stats.quota > 0, "--per-theme caps each category/motif");
  const band = runPipeline(Chess, rows, { perTheme: 100, perBand: 2, max: 2000, seed: 1 });
  assert(Object.values(band.stats.byBand).every((n) => n <= 2) && Object.keys(band.stats.byBand).every((b) => Number(b) % 200 === 0),
    "--per-band caps each 200-point band");
  assert(band.puzzles.every((p) => bandOf(p.rating) % 200 === 0), "bands are multiples of 200");
  const capped = runPipeline(Chess, rows, { perTheme: 100, perBand: 50, max: 10, seed: 1 });
  assert(capped.puzzles.length === 10, "--max caps the total");
  const again = runPipeline(Chess, rows, opt);
  assert(JSON.stringify(again.puzzles) === JSON.stringify(puzzles), "same seed, same output");
  const other = runPipeline(Chess, rows, { perTheme: 100, perBand: 50, max: 10, seed: 2 });
  assert(other.puzzles.map((p) => p.id).join() !== capped.puzzles.map((p) => p.id).join(), "a different seed samples differently");
  assert(themeKey({ cat: "tac", motif: "fork" }) === "tac/fork" && themeKey({ cat: "m1" }) === "m1", "theme keys");
}

// ---------------------------------------------------------------- theme checks (v8-0-plan B1)
// Every Lichess tag the importer keeps has a check that holds on a real line
// and fails on one it does not describe. The positions are the hand-written
// set's where one fits (so the claim is about a puzzle the app already has).
{
  const motifOf = ctx.motifOf;
  const hand = Object.fromEntries(ctx.CHESS_PUZZLES.map((p) => [p.id, p]));
  const lineOf = (p) => p.solution || p.line;
  const holds = (tag, fen, solution, gated) => {
    const c = themeContext(Chess, fen, solution);
    return !!c && verifyThemes(c, tag, motifOf, gated).ids.length === 1;
  };
  const H = (id, tag, gated) => holds(tag, hand[id].fen, lineOf(hand[id]), gated);
  assert(THEMES.length >= 20 && new Set(THEMES.map((t) => t.id)).size === THEMES.length,
    "≥ 20 checkable themes, ids unique (" + THEMES.length + ")");
  const cases = [
    // [tag, holds?, fen, solution, gated category, why]
    ["underPromotion", true, "7k/5P2/6K1/8/8/8/8/8 w - - 0 1", ["f8=R+"], null, "promotes to a rook"],
    ["underPromotion", false, "7k/5P2/6K1/8/8/8/8/8 w - - 0 1", ["f8=Q+"], null, "a queen is not an under-promotion"],
    ["enPassant", true, "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1", ["exd6"], null, "exd6 e.p."],
    ["enPassant", false, "4k3/8/8/3pP3/8/8/8/4K3 w - - 0 1", ["e6"], null, "a push is not e.p."],
    ["castling", true, "4k3/8/8/8/8/8/8/4K2R w K - 0 1", ["O-O"], null, "O-O"],
    ["castling", false, "4k3/8/8/8/8/8/8/4K2R w K - 0 1", ["Kf1"], null, "a king walk"],
    ["doubleCheck", true, "4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1", ["Bc6+"], null, "bishop checks, rook uncovered"],
    ["doubleCheck", false, "4k3/8/8/8/4B3/8/8/4R1K1 w - - 0 1", ["Bd5"], null, "no check at all"],
    ["attackingF2F7", true, "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1", ["Qxf7#"], null, "Qxf7#"],
    ["attackingF2F7", true, mirrorFen("r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 0 1"), ["Qxf2#"], null, "…and Black's Qxf2#"],
    ["discoveredAttack", true, "4k3/8/8/4q3/8/2N5/8/B6K w - - 0 1", ["Nd5"], null, "the knight uncovers the bishop on the queen"],
    ["discoveredAttack", false, "4k3/8/8/4q3/8/2N5/8/B6K w - - 0 1", ["Kg2"], null, "the king moves, the knight still blocks"],
    ["pawnEndgame", true, "8/8/4k3/8/4P3/4K3/8/8 w - - 0 1", ["Kd3"], null, "kings and pawns"],
    ["rookEndgame", true, "8/8/4k3/8/4P3/4K3/8/R6r w - - 0 1", ["Kd3"], null, "rooks and pawns"],
    ["rookEndgame", false, "8/8/4k3/8/4P3/4K3/8/RN5r w - - 0 1", ["Kd3"], null, "a knight too is not a rook ending"],
    ["knightEndgame", true, "8/8/4k3/8/4P3/4K3/8/N7 w - - 0 1", ["Kd3"], null, "a knight"],
    ["bishopEndgame", true, "8/8/4k3/8/4P3/4K3/8/B6b w - - 0 1", ["Kd3"], null, "bishops"],
    ["queenEndgame", true, "8/8/4k3/8/4P3/4K3/8/Q6q w - - 0 1", ["Kd3"], null, "queens"],
    ["queenRookEndgame", true, "8/8/4k3/8/4P3/4K3/8/QR5r w - - 0 1", ["Kd3"], null, "queen and rooks"],
    ["queenRookEndgame", false, "8/8/4k3/8/4P3/4K3/8/Q6q w - - 0 1", ["Kd3"], null, "no rook"],
    ["advancedPawn", false, "8/8/4k3/8/8/4K3/4P3/8 w - - 0 1", ["e4"], null, "a pawn to the fourth"],
    ["hangingPiece", false, "4k3/8/2p5/3n4/8/8/8/3QK3 w - - 0 1", ["Qxd5"], null, "a guarded knight is not hanging"],
    ["defensiveMove", false, "4k3/8/8/8/8/8/8/4K3 w - - 0 1", ["Kd1"], "tac", "only the def gate proves a defence"],
  ];
  for (const [tag, want, fen, sol, gated, why] of cases) {
    assert(holds(tag, fen, sol, gated) === want, "theme " + tag + (want ? " holds: " : " does not hold: ") + why);
  }
  assert(H("m1-smother", "smotheredMate") && !H("m1-q-knight", "smotheredMate"), "smotheredMate: Nf7# holds, a queen mate does not");
  assert(H("m1-arabian", "arabianMate") && !H("m1-backrank-r", "arabianMate"), "arabianMate: rook + knight in the corner");
  assert(H("m1-backrank-r", "backRankMate") && !H("m1-edge-r", "backRankMate"), "backRankMate: on the back rank, not the h-file");
  assert(H("m1-promo", "promotion") && !H("m1-promo", "underPromotion"), "promotion: f8=Q#, which is not an under-promotion");
  assert(H("m2-q-sac", "sacrifice") && !H("m2-rr-sac", "sacrifice"), "sacrifice: the queen for a rook, not a rook for a rook");
  assert(H("m2-corner-h8", "quietMove") && !H("m1-backrank-r", "quietMove"), "quietMove: Kg6 is quiet, Ra8# is not");
  assert(H("m3-promo", "advancedPawn"), "advancedPawn: d7 on the way to d8");
  assert(H("w-hangq", "hangingPiece"), "hangingPiece: Rxd6 takes an unguarded queen");
  for (const [id, tag] of [["t-skewer-h", "skewer"], ["t-pin-e", "pin"]]) {
    assert(holds(tag, hand[id].fen, [hand[id].first], null), tag + ": motif.js finds it in " + id);
  }
  assert(H("m1-backrank-r", "mateIn1", "m1") && !H("m1-backrank-r", "mateIn1", "tac"), "mate lengths are the gate's verdict, not the tag's");

  // the tag that puts a row in its cell must hold; any other failing tag is dropped
  const row = parseCsv("PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags\n" +
    "T1,5pk1/6pp/8/8/8/8/8/R5K1 b - - 0 1,f8f7 a1a8,900,75,95,5000,backRankMate mateIn1 fork short,https://lichess.org/t1,\n" +
    "T2,5pk1/6pp/8/8/8/8/8/R5K1 b - - 0 1,f8f7 a1a8,900,75,95,5000,smotheredMate mateIn1,https://lichess.org/t2,\n" +
    "T3,rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1,e2e4 d8h4,900,75,95,5000,crushing opening,https://lichess.org/t3,\n");
  const t1 = convert(Chess, row[0], { motifOf });
  assert(t1.ok && t1.puzzle.themes.join() === "backRank,m1" && t1.puzzle.dropped.join() === "fork",
    "backRank + mateIn1 hold, the fork tag is dropped (" + (t1.ok ? t1.puzzle.themes + " / " + t1.puzzle.dropped : t1.reason) + ")");
  const t2 = convert(Chess, row[1], { motifOf });
  assert(!t2.ok && t2.stage === "theme" && /smotheredMate/.test(t2.reason), "a row whose cell tag fails is rejected (" + t2.reason + ")");
  const t3 = convert(Chess, row[2], { motifOf });
  assert(!t3.ok, "a crushing line with no checkable tag or no material is not imported (" + t3.reason + ")");

  // review of PR #87: Lichess's discoveredAttack is a discovered ATTACK; the
  // app's "discovered" is a discovered CHECK (闪将). Nc6 uncovers Rd1 on the
  // queen and forks queen and rook — no check anywhere, and the fork is what
  // motif.js names, so the label is the fork.
  const [da] = parseCsv("PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags\n" +
    "T4,1r1q2k1/5ppp/8/8/3N4/8/5PPP/3R2K1 b - - 0 1,g8h8 d4c6 d8f6 c6b8,1500,80,90,500,advantage discoveredAttack fork middlegame short,https://lichess.org/t4,\n");
  const t4 = convert(Chess, da, { motifOf });
  assert(t4.ok && t4.puzzle.motif === "fork" && t4.puzzle.themes.join() === "discoveredAttack,fork",
    "discoveredAttack without a check is 闪击, not 闪将, and the verified fork is the label (" +
    (t4.ok ? t4.puzzle.motif + " / " + t4.puzzle.themes : t4.reason) + ")");
  if (t4.ok) {
    const d4 = ctx.ChessPuzzleDb.decodeRow(JSON.parse(JSON.stringify(encodeRow(t4.puzzle))));
    assert(d4.motif === "fork" && d4.themes.includes("discoveredAttack") && !d4.themes.includes("discovered"),
      "…and the stored row decodes to the same label (" + d4.motif + " / " + d4.themes + ")");
  }
  const dcOf = (fen, sol) => verifyThemes(themeContext(Chess, fen, sol), "discoveredAttack", motifOf, "tac").ids.join();
  assert(dcOf("4k3/1q6/8/8/4N3/8/8/4R1K1 w - - 0 1", ["Nc5+"]) === "discovered",
    "…while a discoveredAttack row that IS a discovered check keeps 闪将 (" + dcOf("4k3/1q6/8/8/4N3/8/8/4R1K1 w - - 0 1", ["Nc5+"]) + ")");
  assert(dcOf("4k3/8/8/4q3/8/2N5/8/B6K w - - 0 1", ["Nd5"]) === "discoveredAttack", "…and a plain one is 闪击");
  const ictx = loadAppModules(["src/web/js/lang-en.js", "src/web/js/lang-ja.js", "src/web/js/i18n.js"]);
  for (const lang of ["zh-CN", "en", "ja"]) {
    assert(!!ictx.ChessI18n.DICT[lang]["motif.discoveredAttack"], lang + " names the discoveredAttack theme");
  }
}

// ---------------------------------------------------------------- the stratified import, end to end
// v8-0-plan B1: stream (.csv or .csv.zst) → pools per (theme × band) cell →
// gate + theme checks → round-robin selection → one chunk per band + an index.
{
  const motifOf = ctx.motifOf;
  const csvPath = path.join(ROOT, "scripts/fixtures/lichess-sample.csv");
  const rows = parseCsv(fs.readFileSync(csvPath, "utf8"));
  // the cheap filters: the reject rows are unpopular and little played
  assert(rows.filter((r) => admissible(r, {})).length === 49 && !admissible(rows.find((r) => r.id === "R0052"), {}),
    "default filters admit the 49 good rows and not the unpopular R rows (" + rows.filter((r) => admissible(r, {})).length + ")");
  assert(cellOf(rows[0]) === "m1@600" && cellOf({ themes: "fork mateIn2", rating: 1450 }) === "m2@1400",
    "a row's cell is its rarest checkable theme × its band");
  assert(qualityKey({ id: "a", popularity: 95, plays: 9000 }, 1)[0] > qualityKey({ id: "b", popularity: 80, plays: 90000 }, 1)[0],
    "popularity ranks first");

  const pools = createPools({ pool: 1 });
  for (const r of rows) pools.add(r);
  const one = pools.done();
  assert([...one.values()].every((l) => l.length === 1), "--pool bounds each cell while streaming");

  const all = createPools({});
  for (const r of rows) all.add(r);
  const cells = all.done();
  const sel = selectPuzzles(Chess, cells, motifOf, {});
  assert(sel.puzzles.length === 49 && sel.stats.sides.b >= 20, "49 selected, black ones kept black (" + sel.stats.sides.b + ")");
  assert(sel.puzzles.every((p) => p.themes.length >= 1 && gate(Chess, p).ok), "each selected puzzle carries ≥ 1 checked theme and passes the gate");
  const capped = selectPuzzles(Chess, cells, motifOf, { max: 12 });
  const cellsHit = new Set(capped.puzzles.map((p) => p.themes[0] + "@" + bandOf(p.rating)));
  assert(capped.puzzles.length === 12 && cellsHit.size === 12, "round-robin: the first 12 come from 12 different cells");
  const perCell = selectPuzzles(Chess, cells, motifOf, { perCell: 1 });
  assert(Object.values(perCell.stats.byCell).every((n) => n <= 1), "--per-cell caps a cell");
  assert(JSON.stringify(selectPuzzles(Chess, cells, motifOf, { max: 12 }).puzzles) === JSON.stringify(capped.puzzles), "same seed, same selection");

  // the compact row round-trips through puzzle-db.js
  const Db = ctx.ChessPuzzleDb;
  const rt = sel.puzzles.filter((p) => {
    const d = Db.decodeRow(JSON.parse(JSON.stringify(encodeRow(p))));
    const want = Object.assign({}, p);
    delete want.url;
    return JSON.stringify(Object.entries(d).sort()) !== JSON.stringify(Object.entries(want).sort());
  });
  assert(rt.length === 0, "encodeRow → decodeRow gives back every field the app reads (" + (rt[0] ? rt[0].id : "") + ")");

  // the CLI, from a .csv.zst (Node's zlib compresses the fixture here; the
  // real file comes from database.lichess.org) — writes the index and bands
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lichess-import-"));
  const zst = path.join(dir, "sample.csv.zst");
  fs.writeFileSync(zst, zlib.zstdCompressSync(fs.readFileSync(csvPath)));
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), zst, "--out-dir", dir, "--seed", "1"], { encoding: "utf8" });
  assert(r.status === 0, "CLI exits 0 on a .csv.zst (" + (r.stderr || "").trim().split("\n")[0] + ")");
  assert(/lines 59, admissible 49, .*accepted 49 \(w 25 \/ b 24\)/.test(r.stdout), "CLI streams 59 lines and accepts 49 (" + r.stdout.split("\n")[0] + ")");
  const r2 = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), csvPath, "--out-dir", path.join(dir, "plain"), "--seed", "1"], { encoding: "utf8" });
  assert(r2.status === 0 && fs.readFileSync(path.join(dir, "plain/puzzles-lc-index.js"), "utf8") === fs.readFileSync(path.join(dir, "puzzles-lc-index.js"), "utf8"),
    "…and the plain .csv gives the identical output");
  // the real export is written by pzstd: a skippable frame holding the next
  // frame's size before every frame, which Node's zstd stream rejects. Two
  // frames, each with that header, must read as the one file.
  const csvBuf = fs.readFileSync(csvPath);
  const cut = csvBuf.indexOf(10, csvBuf.length >> 1) + 1;
  const pz = Buffer.concat([csvBuf.subarray(0, cut), csvBuf.subarray(cut)].map((part) => {
    const frame = zlib.zstdCompressSync(part);
    const head = Buffer.alloc(12);
    head.writeUInt32LE(0x184d2a50, 0); head.writeUInt32LE(4, 4); head.writeUInt32LE(frame.length, 8);
    return Buffer.concat([head, frame]);
  }));
  const pzPath = path.join(dir, "pzstd.csv.zst");
  fs.writeFileSync(pzPath, pz);
  const r3 = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), pzPath, "--out-dir", path.join(dir, "pz"), "--seed", "1"], { encoding: "utf8" });
  assert(r3.status === 0 && fs.readFileSync(path.join(dir, "pz/puzzles-lc-index.js"), "utf8") === fs.readFileSync(path.join(dir, "puzzles-lc-index.js"), "utf8"),
    "…and so does a pzstd file (skippable frames before each frame) (" + (r3.stderr || r3.stdout || "").trim().split("\n")[0] + ")");
  // --exclude: a verify-puzzles report's worse ids are never imported
  const firstId = JSON.parse(fs.readFileSync(path.join(dir, "puzzles-lc-index.js"), "utf8").match(/LC_INDEX = (.*);/)[1]).total > 0 &&
    fs.readFileSync(csvPath, "utf8").split("\n")[1].split(",")[0];
  const shipped = (d) => fs.readdirSync(path.join(d, "lichess")).map((f) => fs.readFileSync(path.join(d, "lichess", f), "utf8")).join("");
  const report = path.join(dir, "worse.json");
  // the ids as verify-puzzles.mjs writes them: the app's, "lc-" + the Lichess id (Codex #89)
  fs.writeFileSync(report, JSON.stringify({ worseAny: [{ id: "lc-" + firstId, ply: 0 }] }));
  const r5 = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), csvPath, "--out-dir", path.join(dir, "ex"), "--seed", "1", "--exclude", report], { encoding: "utf8" });
  assert(r5.status === 0 && shipped(dir).includes(JSON.stringify(firstId)) && !shipped(path.join(dir, "ex")).includes(JSON.stringify(firstId)) &&
    /accepted 48 /.test(r5.stdout), "--exclude report.json drops the reported id (" + firstId + ", " + r5.stdout.split("\n")[0] + ")");
  // Codex #89: a pzstd file cut off right after a size header (its frame never
  // came — a truncated download) fails too, instead of importing what it has
  const cutPath = path.join(dir, "cut.csv.zst");
  const firstFrameEnd = 12 + pz.readUInt32LE(8);
  fs.writeFileSync(cutPath, pz.subarray(0, firstFrameEnd + 12));
  const r6 = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), cutPath, "--out-dir", path.join(dir, "cut"), "--seed", "1"], { encoding: "utf8" });
  assert(r6.status !== 0, "a pzstd file cut off after a size header exits non-zero (status " + r6.status + ")");
  // a file that is not zstd at all fails the run instead of importing 0 rows
  const junk = path.join(dir, "junk.csv.zst");
  fs.writeFileSync(junk, Buffer.from("this is not zstd at all, not even close"));
  const r4 = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), junk, "--out-dir", path.join(dir, "junk"), "--seed", "1"], { encoding: "utf8" });
  assert(r4.status !== 0, "a corrupt .zst exits non-zero (status " + r4.status + ")");
  const lctx = loadAppModules([path.join(dir, "puzzles-lc-index.js")]);
  const idx = lctx.LC_INDEX;
  const bandFiles = fs.readdirSync(path.join(dir, "lichess")).sort();
  assert(idx.total === 49 && idx.sides.b === 24 && idx.bands.reduce((n, b) => n + b.n, 0) === 49, "index: 49 puzzles, 24 black, counted per band");
  assert(bandFiles.length === idx.bands.length && idx.bands.every((b) => bandFiles.includes("band-" + String(b.band).padStart(4, "0") + ".js")),
    "one band file per index band (" + bandFiles.join(",") + ")");
  const chunks = lichessChunks(path.join(dir, "lichess"));
  assert(chunks.length === idx.bands.length && idx.bands.every((b) => {
    const c = Db.bandChunk(b.band);
    return chunks.some((k) => path.basename(k.out) === c.file && k.global === c.global);
  }), "bundle.mjs builds every band under the file and global puzzle-db.js asks for");
  let decoded = 0, inRange = true;
  for (const b of idx.bands) {
    const bctx = loadAppModules([path.join(dir, "lichess", "band-" + String(b.band).padStart(4, "0") + ".js")]);
    const list = bctx[Db.bandChunk(b.band).global].map(Db.decodeRow);
    decoded += list.length;
    inRange = inRange && list.length === b.n && list.every((p) => p.rating >= b.lo && p.rating <= b.hi && bandOf(p.rating) === b.band);
  }
  assert(decoded === 49 && inRange, "every band decodes to its count, inside its rating range");
  assert(Object.values(idx.themes).every((t) => t.bands.length === idx.bands.length) && idx.themes.m1.n === 8, "per-theme counts per band");
  const idxBytes = fs.statSync(path.join(dir, "puzzles-lc-index.js")).size;
  assert(idxBytes < 4000, "the index is small (" + idxBytes + " bytes) — it rides in chunk-mined.js, fetched right after the first paint");
  fs.rmSync(dir, { recursive: true, force: true });

  // the index is not in the main bundle: it rides in chunk-mined.js. Located
  // by its binding, not by how esbuild spaces it: the output is minified
  // (v8-1-plan F2), identifiers kept, and a renamed copy (LC_INDEX2) counts.
  const bundled = fs.readFileSync(path.join(ROOT, "src/web/js/bundle.js"), "utf8");
  const minedChunk = fs.readFileSync(path.join(ROOT, "src/web/js/chunk-mined.js"), "utf8");
  const LC_INDEX_DECL = /\bLC_INDEX\d*\s*=\s*\{/;
  assert(!LC_INDEX_DECL.test(bundled) && LC_INDEX_DECL.test(minedChunk), "the Lichess index is in chunk-mined.js, not in bundle.js");
  // what ships today: the committed index, and chunks exactly for its bands
  assert(ctx.ChessPuzzleDb.index.bands.length === CHUNKS.filter((c) => /chunk-lc-\d{4}\.js$/.test(c.out)).length,
    "CHUNKS carries one Lichess chunk per band of the committed index (" + ctx.ChessPuzzleDb.index.bands.length + ")");
}

// --- the mined set (scripts/mine-puzzles.mjs) -------------------------------
// Generated content is held to the hand-written standard: every entry passes
// the same gate for its category, is white to move, carries its provenance
// and an estimated rating, and repeats no hand-written position. The floors
// are the size the book shipped with; a regeneration may only raise them.
{
  const mctx = loadAppModules(["src/web/js/puzzles-mined.js"]);
  const mined = mctx.MINED_PUZZLES;
  // 980 since v8-0-plan B1: the whole set re-checked at depth 18 and the 22
  // lines with any solver move ≥ 50cp below the engine's best retired
  // (verify-puzzles.mjs --retire)
  assert(Array.isArray(mined) && mined.length >= 980, "mined set loaded (" + (mined ? mined.length : 0) + ")");
  // v8-0-plan §5: the header said 1023 while the array held 1002 — the
  // count a reader sees first must be the count that ships
  const headN = (/\* (\d+) puzzles/.exec(fs.readFileSync(path.join(ROOT, "src/web/js/puzzles-mined.js"), "utf8")) || [])[1];
  assert(Number(headN) === mined.length, "puzzles-mined.js header count matches the array (" + headN + " vs " + mined.length + ")");
  const ids = new Set(), fens = new Set(ctx.CHESS_PUZZLES.map((p) => p.fen));
  let bad = 0;
  const fail = (...m) => { bad++; console.error("FAIL:", ...m); };
  for (const p of mined) {
    if (!/^mn-/.test(p.id) || ids.has(p.id)) fail("mined id missing or duplicate:", p.id);
    ids.add(p.id);
    if (p.src !== "mined") fail(p.id, "does not say where it came from");
    if (!Number.isFinite(p.rating) || p.rating < 800 || p.rating > 2400) fail(p.id, "rating out of range:", p.rating);
    if (p.fen.split(" ")[1] !== "w") fail(p.id, "not white to move");
    if (fens.has(p.fen)) fail(p.id, "repeats a hand-written position");
    if (!["m1", "m2", "m3", "tac", "win"].includes(p.cat)) fail(p.id, "unexpected category", p.cat);
    const g = gate(Chess, p);
    if (!g.ok) fail(p.id, "fails the", p.cat, "gate:", g.reason);
    if (p.motif && !["fork", "pin", "skewer", "discovered", "double"].includes(p.motif)) fail(p.id, "unknown motif", p.motif);
  }
  assert(bad === 0, "every mined puzzle passes its category's gate and carries provenance");
  const byCat = {}, byMotif = {};
  for (const p of mined) { byCat[p.cat] = (byCat[p.cat] || 0) + 1; if (p.motif) byMotif[p.motif] = (byMotif[p.motif] || 0) + 1; }
  console.log("mined by category:", JSON.stringify(byCat), "motifs:", JSON.stringify(byMotif));
  // the shipped floors per category and motif — a regeneration may only raise them
  // 7.0 lowered every tac/win floor here, and it is the only time that is
  // allowed to happen — but it took two goes to get the number right, and the
  // first one was wrong in BOTH directions.
  //
  // The first cut of scripts/test-mined.mjs judged a puzzle by whether its
  // stored answer was the engine's #1, not by how much worse it was, and
  // `--fix` retired 39 on that basis. Rank is the wrong question: two moves a
  // centipawn apart swap places between runs, so the same puzzle came back
  // `tied` in one pass and `not-best` in the next. Re-judged on the measured
  // margin (`best − stored`, `searchmoves` for a stored move outside the top
  // lines), the real answer is 21 — 26 of that 39 were fine and were restored,
  // and 8 genuinely worse ones had been waved through. Every retirement now
  // carries a number: the smallest margin is 60cp, and several are the engine
  // holding a forced mate the stored answer does not.
  //
  // Getting this number right took three goes, and the first two were not
  // wrong about chess — they were wrong about measurement:
  //
  //   1. judged by RANK ("is the stored answer the engine's #1") instead of by
  //      margin, so a 1cp difference was retired like a 262cp one;
  //   2. judged by margin, but still searched without clearing the engine's
  //      transposition table between puzzles, so every result depended on what
  //      had been searched before it — two passes disagreed about the best
  //      move, about the margin, and even about whether a forced mate existed.
  //
  // `ucinewgame` fixed the second (the same 60-puzzle sample now reproduces
  // item for item), and the retirements made on those runs were reverted
  // rather than kept: a deletion is only as good as the measurement behind it.
  // These floors come from the first pass that reproduces.
  //
  // A floor that kept the pre-gate number would have had exactly one way to be
  // satisfied: putting wrong puzzles back.
  const FLOOR = { m1: 42, m2: 33, m3: 54, tac: 551, win: 300 };
  const MOTIF_FLOOR = { fork: 131, pin: 109, skewer: 50, discovered: 5, double: 9 };
  // 6.1: §5 of docs/v6-plan.md wants ≥ 50 puzzles in every 200-point rating
  // band. 6.0 shipped three bands short and did not say so; 6.1 re-rated the
  // set from measured difficulty and topped up the thin bands from fresh
  // mining, which got eight of the nine bands there. The 2200–2399 band is
  // still short and is pinned at what it actually is, not at what the plan
  // wants: engine self-play at low skill produces hanging pieces in bulk and
  // genuinely hard positions rarely, so that band cannot be filled from this
  // source. A number here that lies would be worse than one that is short.
  // 2200 was short before the gate ran (engine self-play at low skill makes
  // hanging pieces in bulk and genuinely hard positions rarely); 1200 and 1600
  // dipped under 50 because the retirements landed slightly more on the harder
  // half. Pinned at what they actually are rather than at what §5 wants:
  // topping them up would mean regenerating ids, and a changed id orphans a
  // player's progress (6.0 → 6.1 kept all 958 for exactly that reason).
  // v8-0-plan B1 re-checked all of it at depth 18 and retired the 22 lines with a
  // solver move ≥ 50cp below the engine's best (verify-puzzles.mjs --retire):
  // the floors above and the short bands below are what is left, 1800 among them.
  const BAND_FLOOR = 50, BAND_SHORT = { 1200: 47, 1600: 45, 1800: 49, 2000: 46, 2200: 24, 2400: 44 };
  for (const [c, n] of Object.entries(FLOOR)) assert((byCat[c] || 0) >= n, "mined " + c + " ≥ " + n + " (" + (byCat[c] || 0) + ")");
  for (const [m, n] of Object.entries(MOTIF_FLOOR)) assert((byMotif[m] || 0) >= n, "mined motif " + m + " ≥ " + n + " (" + (byMotif[m] || 0) + ")");
  {
    const band = {};
    for (const p of mined) { const b = Math.floor(p.rating / 200) * 200; band[b] = (band[b] || 0) + 1; }
    for (const [b, n] of Object.entries(band)) {
      const want = BAND_SHORT[b] != null ? BAND_SHORT[b] : BAND_FLOOR;
      assert(n >= want, "mined band " + b + "–" + (Number(b) + 199) + " ≥ " + want + " (" + n + ")" +
        (BAND_SHORT[b] != null ? " —— 未达 §5 的 50，按实际钉住" : ""));
    }
    const short = Object.keys(band).filter((b) => band[b] < BAND_FLOOR);
    assert(short.length <= Object.keys(BAND_SHORT).length,
      "只有记录在案的那些分段不足 50（不足的是 " + (short.join(", ") || "无") + "）");
  }

}

// --- 7.0: 评级会随时间松动（rating.js 的文件头承诺过，而它从没接上线）-------
//
// 6.1 复查发现：整个应用只调 rate1v1，而那条路每次都在收紧 rd。文件头写着选
// Glicko-2 而不是 Elo 的理由是「让离开一个月的玩家评级能重新快速移动」，
// 而唯一能让 rd 回升的分支（update(player, [])）全仓库没有任何地方调用。
{
  const R = ctx.ChessRating;
  const settled = { r: 1400, rd: 61, vol: 0.06 };

  // 先把「为什么不是反复跑空评分期」钉住：那条路一年只从 61 走到 97，
  // 兑现不了文件头承诺的那件事。这条断言是 decayIdle 存在的理由。
  let weekly = { ...settled };
  for (let i = 0; i < 52; i++) weekly = R.update(weekly, []);
  assert(weekly.rd < 100, "Glicko-2 的空评分期一年只把 rd 抬到 " + weekly.rd.toFixed(0) + "，所以不能只靠它");

  assert(R.decayIdle(settled, 0) === settled, "闲置 0 天是恒等，连新对象都不建");
  assert(R.decayIdle(settled, -5) === settled, "负数天数同样是恒等");
  assert(R.decayIdle(settled, NaN) === settled, "非数字同样是恒等");

  const d30 = R.decayIdle(settled, 30);
  assert(d30.rd > settled.rd + 40, "闲置 30 天后 rd 明显回升（" + settled.rd + " → " + d30.rd.toFixed(0) + "）");
  assert(d30.r === settled.r && d30.vol === settled.vol, "……只动把握程度，不动评级本身，也不动波动率");

  const d365 = R.decayIdle(settled, 365);
  assert(Math.abs(d365.rd - R.DEFAULT.rd) < 1, "闲置一年回到新手的 350（标定就是这么定的）");
  assert(R.decayIdle(settled, 10000).rd === R.DEFAULT.rd, "……并且封顶在 350，不会比从没答过题的人还不确定");

  // rd² 对天数可加，所以「每天开一次」和「一次性闲置 N 天」落在同一处——
  // app.js 正是靠这条性质做到每次访问都结算而不需要会话标志
  let daily = { ...settled };
  for (let i = 0; i < 30; i++) daily = R.decayIdle(daily, 1);
  assert(Math.abs(daily.rd - d30.rd) < 0.5, "三十次一天的结算 == 一次三十天的结算（" + daily.rd.toFixed(1) + " vs " + d30.rd.toFixed(1) + "）");

  // 真正要的效果：回来之后评级能重新快速移动
  const hard = { r: 1800, rd: 60, vol: 0.01 };
  let stale = { ...settled }, fresh = { ...settled };
  stale = R.decayIdle(stale, 90);
  for (let i = 0; i < 5; i++) { stale = R.rate1v1(stale, hard, 1).player; fresh = R.rate1v1(fresh, hard, 1).player; }
  const moved = stale.r - settled.r, stuck = fresh.r - settled.r;
  assert(moved > stuck * 1.5, "闲置三个月后答对五题，评级的移动幅度远大于不衰减的情形（" +
    moved.toFixed(0) + " vs " + stuck.toFixed(0) + " 分）");

  // 选题区间也跟着放宽，这才是玩家能看见的后果
  const wide = R.pickRange(d30), narrow = R.pickRange(settled);
  assert((wide.hi - wide.lo) > (narrow.hi - narrow.lo), "……出题区间随之放宽，而不是照着三个月前的区间出题");
}

// --- v8-0-plan §5: 暂定评级标「?」 ------------------------------------------
// The record page printed 「1104 ±180」 for a rating two answers old. A wide
// deviation is marked the way Lichess marks it: provisional above RD 110.
{
  const R = ctx.ChessRating;
  assert(typeof R.isProvisional === "function", "rating.js says whether a rating is provisional");
  if (typeof R.isProvisional === "function") {
    assert(R.isProvisional(R.newRating()), "a new rating (RD 350) is provisional");
    assert(!R.isProvisional({ r: 1500, rd: 60, vol: 0.06 }), "a settled rating (RD 60) is not");
    // how many first answers until the 「?」 goes: about a dozen, not one and not a hundred
    let pl = R.newRating(), n = 0;
    while (R.isProvisional(pl) && n < 200) { pl = R.rate1v1(pl, { r: 1500, rd: 150, vol: 0.01 }, n % 2).player; n++; }
    assert(n >= 5 && n <= 30, "the 「?」 goes after a dozen or so answers (" + n + ")");
    const back = R.decayIdle({ r: 1500, rd: 60, vol: 0.06 }, 3650);
    assert(R.isProvisional(back), "…and comes back after a long absence (RD " + Math.round(back.rd) + ")");
  }
}

// --- v8-0-plan §5: 开局题默认从常见开局开始 ----------------------------------
// Sorted by ECO alone the first drill was always A01 Nimzo-Larsen (1.b3).
{
  const dctx = loadAppModules(["src/web/js/openings.js", "src/web/js/drills.js"]);
  const D = dctx.ChessDrills;
  assert(typeof D.orderDrills === "function", "drills.js orders the drills");
  if (typeof D.orderDrills === "function") {
    const drills = D.drillLines(dctx.CHESS_OPENINGS).map(([eco, nameId]) => ({ eco, nameId }));
    const ordered = D.orderDrills(drills, dctx.CHESS_OPENING_NAMES);
    assert(ordered.length === drills.length, "ordering keeps every drill (" + ordered.length + ")");
    assert(ordered[0].nameId === "italian-game", "the first drill is the Italian Game (" + ordered[0].eco + " " + ordered[0].nameId + ")");
    const ids = new Set(drills.map((d) => d.nameId));
    const missing = D.COMMON_OPENINGS.filter((id) => !ids.has(id));
    assert(missing.length === 0, "every common opening named is a drill in the book", missing.join(", "));
    const head = ordered.slice(0, D.COMMON_OPENINGS.length).map((d) => d.nameId);
    assert(JSON.stringify(head) === JSON.stringify(D.COMMON_OPENINGS), "the common openings come first, in teaching order");
    const rest = ordered.slice(D.COMMON_OPENINGS.length).map((d) => d.eco);
    assert(rest.every((e, i) => i === 0 || rest[i - 1] <= e), "…and the rest keep ECO order");
    assert(ordered.slice(0, 10).some((d) => d.eco[0] === "B") && ordered.slice(0, 10).some((d) => d.eco[0] === "C"),
      "the first ten include 1.e4 e5 and the Sicilian");
  }
}

// --- v8-0-plan B1: the theme list and the two runs (trainer/themes.js, runs.js)
{
  const tctx = loadAppModules(["src/web/js/trainer/themes.js", "src/web/js/trainer/runs.js"]);
  const Th = tctx.ChessThemes, Ru = tctx.ChessRuns;
  // the browser lists exactly what the importer verifies, in its order
  assert(JSON.stringify(Th.THEME_IDS) === JSON.stringify(THEMES.flatMap((x) => (x.alt ? [x.id, x.alt] : [x.id]))),
    "trainer/themes.js lists the importer's verifiable themes, same ids, same order (" + Th.THEME_IDS.length + ")");
  assert(JSON.stringify(Th.themesOf({ id: "lc-x", cat: "tac", themes: ["fork", "nope", "sacrifice"] }, "pin")) === JSON.stringify(["fork", "sacrifice"]),
    "an imported puzzle keeps its verified themes, unknown ids dropped, the motif ignored");
  assert(JSON.stringify(Th.themesOf({ id: "h1", cat: "m2" }, null)) === JSON.stringify(["m2"]), "a hand-written mate is its mate length");
  assert(JSON.stringify(Th.themesOf({ id: "h2", cat: "tac" }, "skewer")) === JSON.stringify(["skewer"]), "…a tactic is its motif");
  assert(Th.themesOf({ id: "h3", cat: "op" }, null).length === 0, "…an opening drill has no theme");
  const st = {};
  Th.themeRecord(st, "fork").solve = 2;
  Th.themeRecord(st, "fork").miss = 1;
  assert(Th.attemptsIn(st, "fork") === 3 && Th.attemptsIn(st, "pin") === 0, "first answers per theme add up");
  const rows = [{ id: "fork", name: "捉双", n: 5, tried: 3 }, { id: "pin", name: "牵制", n: 4, tried: 0 }, { id: "backRank", name: "Back-rank mate", n: 2, tried: 1 }];
  assert(Th.filterThemes(rows, "", "all").length === 3, "no filter: every theme");
  assert(Th.filterThemes(rows, "", "new").map((r) => r.id).join() === "pin", "「没练过」: the themes with no answer");
  assert(Th.filterThemes(rows, "", "started").map((r) => r.id).join() === "fork,backRank", "「练过」: the themes answered in");
  assert(Th.filterThemes(rows, "牵", "all").map((r) => r.id).join() === "pin", "search reads the shown name");
  assert(Th.filterThemes(rows, "BACK", "all").map((r) => r.id).join() === "backRank", "…case-blind, and the id too");

  // runs: harder as they go, strikes, the clock, the best score
  const pool = [];
  for (let r = 400; r <= 2600; r += 10) pool.push({ id: "p" + r, r });
  const rate = (p) => p.r;
  for (const kind of Ru.RUN_KINDS) {
    const run = Ru.newRun(kind, 0, 42);
    const got = [];
    for (let i = 0; i < 12; i++) {
      const p = Ru.pickNext(run, pool, rate);
      Ru.served(run, p);
      got.push(p.r);
      assert(Math.abs(p.r - Ru.targetOf(run)) <= Ru.SPREAD, kind + ": puzzle " + (i + 1) + " is near the run's target (" + p.r + " vs " + Ru.targetOf(run) + ")");
      Ru.onSolve(run);
    }
    const early = got.slice(0, 4).reduce((a, b) => a + b) / 4, late = got.slice(-4).reduce((a, b) => a + b) / 4;
    assert(late - early >= 200, kind + ": the run gets harder (" + Math.round(early) + " → " + Math.round(late) + ")");
    assert(new Set(run.used).size === run.used.length, kind + ": no puzzle twice in a run");
    assert(run.score === 12, kind + ": each solve scores");
  }
  const rush = Ru.newRun("rush", 1000, 1);
  Ru.onMiss(rush); Ru.onMiss(rush);
  assert(!rush.over, "rush: two misses and the run goes on");
  Ru.onMiss(rush);
  assert(rush.over && rush.why === "strikes", "rush: the third miss ends it");
  const clocked = Ru.newRun("rush", 1000, 1);
  assert(Ru.timeLeft(clocked, 1000) === 180000, "rush: three minutes on the clock");
  assert(!Ru.checkClock(clocked, 180999) && Ru.checkClock(clocked, 181000) && clocked.why === "time", "rush: ends when the clock runs out");
  const streak = Ru.newRun("streak", 0, 1);
  assert(Ru.timeLeft(streak, 1e12) === Infinity && !Ru.checkClock(streak, 1e12), "streak: no clock");
  Ru.onSolve(streak); Ru.onSolve(streak); Ru.onMiss(streak);
  assert(streak.over && streak.why === "streak" && streak.score === 2, "streak: the first miss ends it, the solves are the score");
  // v10-0-plan T1: 定级 — six answers, the aim following them with halving steps
  {
    const pl = Ru.newRun("place", 0, 1, 900);
    assert(Ru.targetOf(pl) === 900 && !Ru.RUN_KINDS.includes("place"), "place: starts where it is told, and is not a panel button");
    Ru.onSolve(pl); assert(Ru.targetOf(pl) === 1200, "place: a solve aims 300 higher");
    Ru.onMiss(pl); assert(Ru.targetOf(pl) === 1000 && !pl.over, "place: a miss aims 200 lower, and does not end it");
    Ru.onSolve(pl); Ru.onSolve(pl); Ru.onMiss(pl);
    assert(!pl.over && Ru.targetOf(pl) === 1175, "place: 150, 100, 75 (" + Ru.targetOf(pl) + ")");
    Ru.onSolve(pl);
    assert(pl.over && pl.why === "placed" && Ru.targetOf(pl) === 1225, "place: the sixth answer ends it at the estimate");
    assert(!Ru.recordBest({}, pl), "place: a placement is not a best score");
    const low = Ru.newRun("place", 0, 1, 900);
    for (let i = 0; i < 6; i++) Ru.onMiss(low);
    assert(low.est === 400, "place: six misses stay on the scale (" + low.est + ")");
  }
  const pst = {};
  assert(Ru.recordBest(pst, streak) && Ru.bestOf(pst, "streak") === 2, "a first score is a best");
  const worse = Ru.newRun("streak", 0, 1); Ru.onSolve(worse);
  assert(!Ru.recordBest(pst, worse) && Ru.bestOf(pst, "streak") === 2, "a lower score leaves the best alone");
  assert(Ru.bestOf(pst, "rush") === 0, "…and each kind keeps its own");
  assert(Ru.pickNext(Ru.newRun("rush", 0, 1), [], rate) === null, "an empty pool serves nothing");
}

// --- retired puzzles leave no review debt (Codex on #88) ----------------------
// caf32fa retired these 22 mined puzzles (verify-puzzles.mjs --retire) with no
// migration of the puzzle state: a missed one was owed for ever. Every one of
// them must be out of the book and dropped by the load-time forgetRetired().
{
  const RETIRED_CAF32FA = [
    "mn-201-5-62", "mn-201-60-17", "mn-201-77-37", "mn-201-82-28", "mn-203-26-47", "mn-301-37-33",
    "mn-301-46-63", "mn-301-82-13", "mn-302-104-71", "mn-302-133-53", "mn-302-39-55", "mn-302-61-64",
    "mn-303-116-48", "mn-303-13-29", "mn-303-141-10", "mn-201-63-26", "mn-202-18-70", "mn-301-101-54",
    "mn-301-8-51", "mn-302-1-59", "mn-101-14-80", "mn-202-37-62",
  ];
  const rctx = loadAppModules(["src/web/js/puzzles-mined.js", "src/web/js/openings.js", "src/web/js/drills.js"]);
  const book = new Set(ctx.CHESS_PUZZLES.concat(rctx.MINED_PUZZLES).map((p) => p.id));
  assert(RETIRED_CAF32FA.length === 22 && RETIRED_CAF32FA.every((id) => !book.has(id)), "#88: the 22 retired ids are out of the book");
  const live = ["w-hangq", rctx.MINED_PUZZLES[0].id];
  const keep = ["lc-00008", "mine:abc", "rep-xyz"]; // lazily loaded / their own lifecycle
  const entry = { s: 0, n: 1 };
  const st = { missed: {}, solved: {}, pr: {} };
  for (const id of RETIRED_CAF32FA.concat(live, keep)) { st.missed[id] = entry; st.solved[id] = true; st.pr[id] = { r: 1500 }; }
  const n = rctx.ChessDrills.forgetRetired(st, (id) => book.has(id));
  assert(n === 22 * 3, "#88: forgetRetired drops each retired id from missed, solved and pr (" + n + ")");
  const left = (m) => Object.keys(m).sort().join(",");
  const want = live.concat(keep).sort().join(",");
  assert(left(st.missed) === want && left(st.solved) === want && left(st.pr) === want,
    "#88: …and keeps the live ones, Lichess ids (bands load on demand), mine: and rep- ids");
  assert(rctx.ChessDrills.forgetRetired(st, (id) => book.has(id)) === 0, "#88: a second pass has nothing left to do");
}

// ---------------------------------------------------------------- v8-1-plan T6: bank puzzles in the review queue
{
  const bctx = loadAppModules(["src/web/js/srs.js", "src/web/js/trainer/bank-review.js", "src/web/js/learning.js"]);
  const S = bctx.ChessSrs;
  // a fake bank: two bands, loaded only when asked (puzzle-db.js's contract)
  const bands = { 1200: [{ id: "lc-aaa", rating: 1234 }, { id: "lc-bbb", rating: 1301 }], 1400: [{ id: "lc-ccc", rating: 1450 }] };
  const loaded = new Set();
  const asked = [];
  let fail = false;
  const Db = {
    band: (b) => (loaded.has(b) ? bands[b] || [] : null),
    ensureBand: (b) => { asked.push(b); if (fail) return Promise.reject(new Error("x")); loaded.add(b); return Promise.resolve(bands[b] || []); },
  };
  const B = bctx.createBankReview({ Db, Srs: S });
  const now = Date.now();
  // a queue of local ids only: no bank ids, no `bank` table — nothing to wait for, nothing changes
  const old = { missed: { "w-hangq": S.onMiss(null, now - 1000), "mn-00012": { s: 0, n: 1 } }, solved: {} };
  const before = JSON.stringify(old);
  assert(!B.wait(old, now, () => {}) && B.pending(old, now).length === 0 && B.prune(old) === 0 && JSON.stringify(old) === before,
    "T6: a queue with no bank ids loads as it was: no wait, no change");
  assert(bctx.isBankId("lc-aaa") && !bctx.isBankId("mn-00012") && !bctx.isBankId(null), "T6: bank ids are the lc- ones");

  // missed: queued by id, its band noted beside the entry
  const st = { missed: {}, solved: {}, pr: {} };
  st.missed["lc-bbb"] = S.onMiss(st.missed["lc-bbb"], now - 5000);
  B.note(st, { id: "lc-bbb", rating: 1301 });
  assert(st.bank["lc-bbb"] === 1200 && Object.keys(st.missed["lc-bbb"]).sort().join() === "due,ivl,n,s",
    "T6: a missed bank puzzle is queued by id (the SRS entry unchanged) and its band noted beside it");
  assert(B.resolve(st, "lc-bbb") === null, "T6: …and cannot be served before its band is here");
  assert(B.pending(st, now).join() === "1200", "T6: the due bank puzzle needs band 1200");
  // not due yet: nothing to wait for
  const later = { missed: { "lc-bbb": { s: 1, n: 2, due: now + 86400000, ivl: 1 } }, bank: { "lc-bbb": 1200 } };
  assert(B.pending(later, now).length === 0, "T6: a bank puzzle not due today asks for no band");

  // the wait: the band loads, then the review goes on
  let ran = 0;
  const waited = B.wait(st, now, () => { ran++; });
  await new Promise((r) => setTimeout(r, 0));
  assert(waited && ran === 1 && asked.join() === "1200", "T6: the review waits for the band, then runs once");
  assert(B.resolve(st, "lc-bbb") && B.resolve(st, "lc-bbb").id === "lc-bbb", "T6: …after which the queued id resolves to its puzzle");
  assert(!B.wait(st, now, () => { ran++; }) && ran === 1, "T6: a second wait finds the band here and does not wait");

  // an entry with no band noted (merged from elsewhere): its puzzle rating is the guess, bands either side too
  const guess = { missed: { "lc-ccc": S.onMiss(null, now - 1) }, pr: { "lc-ccc": { r: 1390 } } };
  assert(B.bandsOf(guess, "lc-ccc").join() === "1200,1000,1400", "T6: without a noted band, the rated band and its neighbours");
  assert(B.pending(guess, now).join() === "1000", "T6: band 1200 is here and lacks it, so the next guess is asked");
  const g2 = B.wait(guess, now, () => {});
  await new Promise((r) => setTimeout(r, 0));
  const g3 = B.wait(guess, now, () => {});
  await new Promise((r) => setTimeout(r, 0));
  assert(g2 && g3 && B.resolve(guess, "lc-ccc") && B.resolve(guess, "lc-ccc").id === "lc-ccc", "T6: …and found in the band it really is in");

  // a bank id no band it could be in holds is retired once those bands are here
  const gone = { missed: { "lc-zzz": S.onMiss(null, now - 1), "lc-bbb": S.onMiss(null, now - 1) }, bank: { "lc-zzz": 1400, "lc-bbb": 1200 } };
  assert(B.prune(gone) === 1 && !("lc-zzz" in gone.missed) && !("lc-zzz" in gone.bank) && "lc-bbb" in gone.missed,
    "T6: an id its band does not hold leaves the queue (and the band table); the others stay");
  const unknown = { missed: { "lc-yyy": S.onMiss(null, now - 1) } };
  assert(B.bandsOf(unknown, "lc-yyy").length === 0 && B.prune(unknown) === 1, "T6: an id with no band at all is not owed for ever");

  // a band that fails to load: reported, and the review goes on with what is here
  fail = true;
  const f = { missed: { "lc-qqq": S.onMiss(null, now - 1) }, bank: { "lc-qqq": 2000 } };
  let failedN = 0, thenN = 0;
  assert(B.wait(f, now, () => { thenN++; }, () => { failedN++; }), "T6: a band not here is waited for");
  await new Promise((r) => setTimeout(r, 0));
  assert(failedN === 1 && thenN === 1 && "lc-qqq" in f.missed, "T6: a failed band is reported, the review goes on, the entry is kept");
  assert(!B.wait(f, now, () => {}), "T6: …and the same band is not asked again this session (no loop)");

  // a graduation takes the band note with it
  B.forget(st, "lc-bbb");
  assert(!("lc-bbb" in st.bank), "T6: forget drops the band note");

  // learning import: the band table travels with the queue
  const L = bctx.ChessLearning;
  const cur = { puzzles: JSON.stringify({ solved: {}, missed: { "lc-bbb": { s: 0, n: 1 } }, bank: { "lc-bbb": 1200 } }) };
  const inc = { kind: L.LEARNING_KIND, v: 1, data: { puzzles: { solved: {}, missed: { "lc-ccc": { s: 0, n: 1 } }, bank: { "lc-ccc": 1400 } } } };
  const merged = L.merge(cur, inc, 100).puzzles;
  assert(merged.bank && merged.bank["lc-bbb"] === 1200 && merged.bank["lc-ccc"] === 1400, "T6: importing learning data keeps both sides' band notes");
  const plain = L.merge({ puzzles: JSON.stringify({ solved: {}, missed: {} }) }, { kind: L.LEARNING_KIND, v: 1, data: { puzzles: { solved: {}, missed: {} } } }, 100).puzzles;
  assert(!("bank" in plain), "T6: …and adds no table to a state that had none");
  // M3 评审: the review queue merges by the srs.js fields ({s, n, due, ivl}), not a `streak` no entry has
  {
    const pc = { puzzles: JSON.stringify({ solved: {}, missed: { p1: { s: 0, n: 1, due: 5, ivl: 0 }, p2: { s: 2, n: 3, due: 9, ivl: 3 } } }) };
    const pi = { kind: L.LEARNING_KIND, v: 1, data: { puzzles: { solved: {}, missed: { p1: { s: 1, n: 2, due: 7, ivl: 1 }, p2: { s: 1, n: 5, due: 1, ivl: 1 } } } } };
    const mp = L.merge(pc, pi, 100).puzzles.missed;
    assert(mp.p1.s === 1 && mp.p1.due === 7 && mp.p2.s === 2 && mp.p2.due === 9,
      "M3: importing learning data keeps the queue entry further up the ladder, from either side", JSON.stringify(mp));
  }
  // M2 review (v8-2-plan T2/T3): 名局猜着's results (learn.gs) and 看 N 步 / 盲走's
  // records (puzzles.vis) travel in the learning file — they used to be dropped
  {
    const lc = { learn: JSON.stringify({ v: 1, done: {}, last: 3, gs: { g1: { w: { same: 5, n: 20, avg: 9, at: 100 } }, g2: { b: { same: 1, n: 9, avg: 20, at: 300 } } } }) };
    const li = { kind: L.LEARNING_KIND, v: 1, data: { learn: { v: 1, done: {}, last: 1,
      gs: { g1: { w: { same: 7, n: 20, avg: 4, at: 200 }, b: { same: 2, n: 18, avg: 12, at: 50 } }, g2: { b: { same: 3, n: 9, avg: 8, at: 250 } }, g3: { w: { same: 0, n: 1, avg: 30, at: 9 } } } } } };
    const gs = L.merge(lc, li, 100).learn.gs;
    assert(gs && gs.g1.w.at === 200 && gs.g1.b.at === 50 && gs.g2.b.at === 300 && gs.g3.w.at === 9,
      "M2: learn.gs merges per game and side, the later result winning, from either side", JSON.stringify(gs));
    assert(!("gs" in L.merge({ learn: JSON.stringify({ v: 1, done: {}, last: 0 }) }, { kind: L.LEARNING_KIND, v: 1, data: { learn: { v: 1, done: {}, last: 0 } } }, 100).learn),
      "M2: …and adds no gs to a state that had none");
    const pc = { puzzles: JSON.stringify({ solved: {}, missed: {}, vis: { look: { rating: { r: 1400 }, solve: 5, miss: 2, at: 100, q: { "a|2|1": { s: 0, n: 1, due: 5, ivl: 0 }, "b|3|2": { s: 2, n: 3, due: 9, ivl: 3 } } } } }) };
    const pi = { kind: L.LEARNING_KIND, v: 1, data: { puzzles: { solved: {}, missed: {}, vis: {
      look: { rating: { r: 1600 }, solve: 3, miss: 4, at: 200, q: { "a|2|1": { s: 1, n: 2, due: 7, ivl: 1 }, "b|3|2": { s: 1, n: 5, due: 1, ivl: 1 }, "c|4|3": { s: 0, n: 1, due: 2, ivl: 0 } } },
      blind: { rating: { r: 1300 }, solve: 1, miss: 1, at: 150, q: { m1: { s: 0, n: 1, due: 3, ivl: 0 } } } } } } };
    const vis = L.merge(pc, pi, 100).puzzles.vis;
    assert(vis && vis.look.rating.r === 1600 && vis.look.at === 200 && vis.look.solve === 5 && vis.look.miss === 4,
      "M2: puzzles.vis takes the later rating and the larger counts per mode", JSON.stringify(vis && vis.look));
    assert(vis.look.q["a|2|1"].s === 1 && vis.look.q["b|3|2"].s === 2 && vis.look.q["c|4|3"] && vis.blind && vis.blind.q.m1,
      "M2: …and its review queues merge as `missed` does (further up the ladder wins); a mode only the file has comes in whole", JSON.stringify(vis.look.q));
    const again = L.merge({ puzzles: JSON.stringify(L.merge(pc, pi, 100).puzzles) }, pi, 100).puzzles.vis;
    assert(JSON.stringify(again) === JSON.stringify(vis), "M2: the same file imported twice is a no-op for vis");
    assert(!("eng" in vis.look), "v8-4-plan T1: …and adds no eng to records that had none");
    // v8-4-plan T1: a look review's engine plies come in from either side
    const pe = JSON.parse(pc.puzzles);
    pe.vis.look.eng = { "a|2|1": "x1:e2e4" };
    const ie = JSON.parse(JSON.stringify(pi));
    ie.data.puzzles.vis.look.eng = { "c|4|3": "y2:d2d4" };
    const ve = L.merge({ puzzles: JSON.stringify(pe) }, ie, 100).puzzles.vis.look;
    assert(ve.eng && ve.eng["a|2|1"] === "x1:e2e4" && ve.eng["c|4|3"] === "y2:d2d4",
      "v8-4-plan T1: vis.look.eng (a review's engine plies) merges as a union, whichever record is later", JSON.stringify(ve.eng));
  }
  {
    const repCur = { repertoire: JSON.stringify({ v: 1, w: [], b: [], db: 2, n: 0, sig: "x" }) };
    const repInc = { kind: L.LEARNING_KIND, v: 1, data: { repertoire: { v: 1, w: [{ id: "rep-a", sans: "e4 e5" }], b: [], cards: { "w|k": { s: 3, n: 3, due: 9, ivl: 7 } } } } };
    const mr = L.merge(repCur, repInc, 100).repertoire;
    assert(mr.cards && mr.cards["w|k"].s === 3 && mr.w.length === 1, "M3: a learning file's repertoire cards survive the merge (the records take them after)");
    const noCards = L.merge(repCur, { kind: L.LEARNING_KIND, v: 1, data: { repertoire: { v: 1, w: [], b: [] } } }, 100).repertoire;
    assert(!("cards" in noCards), "M3: …and a file without them adds none");
  }

  // M3 评审 ------------------------------------------------------------------
  // a guessed band is one the bank has: past either end is the end band
  {
    const idxBands = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2600];
    const Dx = { band: () => null, ensureBand: () => Promise.resolve([]), indexReady: () => true,
      bandFor: (r) => { const b = Math.floor(r / 200) * 200; return b <= 600 ? 600 : b >= 2600 ? 2600 : b; } };
    const Bx = bctx.createBankReview({ Db: Dx, Srs: S });
    const lo = { missed: { "lc-lo": S.onMiss(null, now - 1) }, pr: { "lc-lo": { r: 450 } } };
    const hi = { missed: { "lc-hi": S.onMiss(null, now - 1) }, pr: { "lc-hi": { r: 2750 } } };
    assert(Bx.bandsOf(lo, "lc-lo").join() === "600" && Bx.bandsOf(hi, "lc-hi").join() === "2600,2400",
      "M3: guessed bands are clamped to the bands the bank has (" + Bx.bandsOf(lo, "lc-lo") + " / " + Bx.bandsOf(hi, "lc-hi") + ")");
    assert(Bx.bandsOf(lo, "lc-lo").every((b) => idxBands.includes(b)), "M3: …never a band with no chunk (200, 400, 2800)");
  }
  // a second wait while the band is still on its way waits too (it used to go on without it)
  {
    let release; const loadedX = new Set(); let calls = 0;
    const Dx = { band: (b) => (loadedX.has(b) ? bands[b] : null),
      ensureBand: (b) => { calls++; return new Promise((r) => { release = () => { loadedX.add(b); r(bands[b]); }; }); } };
    const Bx = bctx.createBankReview({ Db: Dx, Srs: S });
    const sx = { missed: { "lc-aaa": S.onMiss(null, now - 1) }, bank: { "lc-aaa": 1200 } };
    let a = 0, b = 0;
    const w1 = Bx.wait(sx, now, () => { a++; });
    const w2 = Bx.wait(sx, now, () => { b++; });
    await new Promise((r) => setTimeout(r, 0));
    assert(w1 && w2 && a === 0 && b === 0 && calls === 1, "M3: a second wait while the band loads chains onto the same load", JSON.stringify({ w1, w2, calls }));
    release();
    await new Promise((r) => setTimeout(r, 0));
    assert(a === 1 && b === 1 && Bx.resolve(sx, "lc-aaa"), "M3: …and both go on once it is here");
  }
  // pending() prunes an id every band of it has come without (another path loaded them)
  {
    const Dx = { band: (b) => bands[b] || [], ensureBand: (b) => Promise.resolve(bands[b] || []) };
    const Bx = bctx.createBankReview({ Db: Dx, Srs: S });
    const sx = { missed: { "lc-gone": S.onMiss(null, now - 1) }, bank: { "lc-gone": 1400 } };
    assert(Bx.pending(sx, now).length === 0 && !("lc-gone" in sx.missed) && !("lc-gone" in sx.bank),
      "M3: pending() drops a queued id its loaded band does not hold");
  }
  // the day's dose: an id nothing can serve yet takes no slot, and is not pushed to a later day
  {
    const Dx = { band: (b) => (b === 1200 ? bands[1200] : null), ensureBand: () => new Promise(() => {}) };
    const Bx = bctx.createBankReview({ Db: Dx, Srs: S });
    const sx = { missed: {}, bank: {} };
    for (let i = 0; i < 25; i++) { sx.missed["lc-x" + i] = { s: 0, n: 1, due: now - 100000 - i, ivl: 0 }; sx.bank["lc-x" + i] = 1400; }
    sx.missed["lc-aaa"] = { s: 0, n: 1, due: now - 10, ivl: 0 }; sx.bank["lc-aaa"] = 1200;
    sx.missed["w-1"] = { s: 0, n: 1, due: now - 20, ivl: 0 };
    const book = new Map([["w-1", { id: "w-1" }]]);
    const list = Bx.reviewList(sx, now, 20, (id) => book.get(id) || null);
    assert(list.map((p) => p.id).sort().join() === "lc-aaa,w-1", "M3: 25 bank ids with no band here do not crowd out the two that can be served", list.map((p) => p.id).join());
    assert(Object.keys(sx.missed).filter((id) => id.startsWith("lc-x")).every((id) => sx.missed[id].due < now),
      "M3: …and they stay due today, not pushed to later days for slots they could not use");
  }
}

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
console.log("all learning tests passed");
