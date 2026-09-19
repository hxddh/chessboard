/**
 * Node tests for the 6.0 learning system (docs/v6-plan.md §Q3):
 * rating.js (Glicko-2), srs.js (time axis), opening-tree.js, the Lichess
 * importer and its gate. Run: node scripts/test-learning.mjs
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { gate, positionGate } from "./lib/puzzle-gate.mjs";
import { parseCsv, runPipeline, convert, mirrorFen, mirrorUci, mapThemes, THEME_MAP, themeKey, bandOf, seededRng }
  from "./import-puzzles.mjs";

const ctx = loadAppModules([
  "src/web/js/chess.js", "src/web/js/rating.js", "src/web/js/srs.js",
  "src/web/js/opening-tree.js", "src/web/js/openings.js", "src/web/js/puzzles.js",
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
}

// ---------------------------------------------------------------- srs
{
  const S = ctx.ChessSrs;
  const DAY = S.DAY;
  const T0 = Date.UTC(2026, 0, 10);

  // the pre-6.0 contract, verbatim: no dates, count-based, null on graduation
  let e = S.onMiss(undefined);
  assert(S.isDue(e), "legacy: a missed puzzle enters the queue");
  e = S.onSolve(e);
  assert(e && S.isDue(e) && e.s === 1, "legacy: one clean solve is not enough");
  assert(S.onSolve(e) === null, "legacy: the second consecutive clean solve graduates");
  assert(S.isDue(true) && S.entry(true).s === 0 && S.entry(true).due === 0, "legacy: a 1.6 boolean entry is due, streak 0, overdue since forever");
  assert(S.onSolve(undefined) === null, "legacy: solving an unqueued puzzle is a no-op");
  assert(S.entry({ s: 1, n: 2 }).due === 0 && S.entry({ s: 1, n: 2 }).ivl === 0, "a 1.7 entry without dates reads as overdue");

  // the time axis: 1 → 3 → 7 → 21
  let t = S.onMiss(undefined, T0);
  assert(t.due === T0 && t.ivl === 0 && S.isDue(t), "a miss is due at once");
  t = S.onSolve(t, T0);
  assert(t.s === 1 && t.ivl === 1 && t.due === T0 + DAY, "first clean solve: due tomorrow");
  assert(S.isDue(t), "…and still owed by count (streak 1 < GRADUATE)");
  t = S.onSolve(t, T0 + DAY);
  assert(t && t.s === 2 && t.ivl === 3 && t.due === T0 + 4 * DAY, "second clean solve: graduated by count, due again in 3 days");
  assert(!S.isDue(t), "a graduated puzzle no longer owes the queue (picker rung 1 leaves it alone)");
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
  state.legacy = true;
  const CAP = 10;
  const today = S.dueQueue(state, T0, CAP);
  assert(today.length === CAP, "14 days away, 41 due: today serves " + today.length + " (cap " + CAP + ")");
  assert(today[0] === "legacy", "the entry with no date is the most overdue and comes first");
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

  // shape of an emitted entry
  const shapeBad = puzzles.filter((p) => !/^lc-/.test(p.id) || p.src !== "lichess" || !p.url || !Number.isFinite(p.rating) ||
    !Array.isArray(p.solution) || !p.solution.length || p.fen.split(" ")[1] !== "w");
  assert(shapeBad.length === 0, "every entry is {id:lc-…, cat, fen (white to move), solution, rating, src, url}");
  assert(puzzles.filter((p) => p.cat === "tac" || p.cat === "win").every((p) => p.gain >= 1), "tac/win entries carry the gain the gate measured");
  assert(puzzles.filter((p) => p.cat === "def").every((p) => p.saves >= 1), "def entries carry the number of saving moves");
  assert(new Set(puzzles.map((p) => p.id)).size === puzzles.length, "ids are unique");

  // every emitted puzzle passes the same gate as the hand-written ones
  let gateBad = 0;
  for (const p of puzzles) { const r = gate(Chess, p); if (!r.ok) { gateBad++; console.error("  ", p.id, r.reason); } }
  assert(gateBad === 0, "all emitted puzzles pass the hand-written gate");

  // mirrored rows come back as the very positions they were derived from
  const byOrig = {};
  for (const p of ctx.CHESS_PUZZLES) byOrig[p.fen.split(" ").slice(0, 4).join(" ")] = p.id;
  const mirroredRows = rows.filter((r) => /^F/.test(r.id) && r.fen.split(" ")[1] === "w");
  assert(mirroredRows.length === 26, "26 fixture rows have the solver on Black (" + mirroredRows.length + ")");
  let backHome = 0;
  for (const r of mirroredRows) {
    const c = convert(Chess, r);
    if (c.ok && byOrig[c.puzzle.fen.split(" ").slice(0, 4).join(" ")]) backHome++;
    else if (c.ok) console.error("  not a hand-written position after mirroring:", r.id, c.puzzle.fen);
  }
  const mappedMirrored = mirroredRows.filter((r) => mapThemes(r.themes)).length;
  assert(backHome === mappedMirrored, "every mapped black-to-move row normalises to a hand-written white-to-move puzzle (" + backHome + "/" + mappedMirrored + ")");

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

  // the CLI writes an importable module with the CC0 notice
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lichess-import-"));
  const out = path.join(dir, "puzzles-lichess.js");
  const r = spawnSync(process.execPath, [path.join(ROOT, "scripts/import-puzzles.mjs"), csvPath, "--out", out,
    "--per-theme", "100", "--per-band", "50", "--max", "2000", "--seed", "1"], { encoding: "utf8" });
  assert(r.status === 0, "CLI exits 0 (" + (r.stderr || "").trim().split("\n")[0] + ")");
  assert(/emitted 49/.test(r.stdout), "CLI reports 49 emitted");
  const text = fs.readFileSync(out, "utf8");
  assert(/CC0/.test(text) && /export const LICHESS_PUZZLES = \[/.test(text), "output states the CC0 licence and exports LICHESS_PUZZLES");
  const mod = await import(out);
  assert(mod.LICHESS_PUZZLES.length === 49 && JSON.stringify(mod.LICHESS_PUZZLES) === JSON.stringify(puzzles), "the written module round-trips the pipeline output");
  fs.rmSync(dir, { recursive: true, force: true });
}

// --- the mined set (scripts/mine-puzzles.mjs) -------------------------------
// Generated content is held to the hand-written standard: every entry passes
// the same gate for its category, is white to move, carries its provenance
// and an estimated rating, and repeats no hand-written position. The floors
// are the size the book shipped with; a regeneration may only raise them.
{
  const mctx = loadAppModules(["src/web/js/puzzles-mined.js"]);
  const mined = mctx.MINED_PUZZLES;
  assert(Array.isArray(mined) && mined.length >= 787, "mined set loaded (" + (mined ? mined.length : 0) + ")");
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
  const FLOOR = { m1: 24, m2: 19, m3: 25, tac: 419, win: 300 };
  const MOTIF_FLOOR = { fork: 94, pin: 82, skewer: 39, discovered: 8, double: 6 };
  for (const [c, n] of Object.entries(FLOOR)) assert((byCat[c] || 0) >= n, "mined " + c + " ≥ " + n + " (" + (byCat[c] || 0) + ")");
  for (const [m, n] of Object.entries(MOTIF_FLOOR)) assert((byMotif[m] || 0) >= n, "mined motif " + m + " ≥ " + n + " (" + (byMotif[m] || 0) + ")");
}

if (failed) { console.error(failed + " failure(s)"); process.exit(1); }
console.log("all learning tests passed");
