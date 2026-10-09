/**
 * v8-0-plan C1 — the library as a database, without a browser.
 *
 * Three pure layers the browser e2e (test-library-e2e) then wires together:
 *   * library-query.js: the position key and index, the search, the name
 *     claim, the whole-library PGN;
 *   * library-db.js: the store over a Map backend (the same interface as the
 *     IndexedDB one), where the games read back from the native shards are
 *     taken in, and made to fail half way;
 *   * library.js: the 10,000-game cap, and what entryFrom now keeps.
 *
 * 跑：node scripts/test-library-db.mjs
 */
import { Chess } from "../src/web/js/chess.js";
import { ChessPgnParser } from "../src/web/js/pgn-parser.js";
import { ChessLibrary as L } from "../src/web/js/library.js";
import { LibraryQuery as Q } from "../src/web/js/library-query.js";
import { LibraryDb as D } from "../src/web/js/library-db.js";
import * as S from "../src/web/js/library-sum.js";

let failed = 0;
const assert = (cond, msg, extra) => {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg + (extra != null ? "  " + extra : "")); }
};
const T0 = 1758000000000;
const START = new Chess().fen();

/** A game as the importer makes it: parse, mainline, entry, index. */
function imported(pgn, names, pk) {
  const g = ChessPgnParser.parsePgn(pgn).games[0];
  const sans = [], fens = [g.root.fen];
  for (let n = g.root; n.children.length; n = n.children[0]) { sans.push(n.children[0].san); fens.push(n.children[0].fen); }
  const e = L.entryFrom(g, sans, names || [], T0);
  if (pk) pk.set(e.id, Q.keysOfFens(fens));
  return e;
}
const PGNS = [
  '[Event "Rated blitz"]\n[Site "https://lichess.org/abc"]\n[Date "2026.09.01"]\n[Round "-"]\n[White "hxddh"]\n[Black "rival"]\n[Result "1-0"]\n[TimeControl "180+2"]\n\n1. e4 {[%clk 0:03:00]} e5 {[%clk 0:02:59]} 2. Nf3 {[%clk 0:02:58]} Nc6 {[%clk 0:02:55]} 3. Bb5 a6 1-0\n',
  '[Event "Rated rapid"]\n[Site "lichess"]\n[Date "2026.08.15"]\n[White "rival"]\n[Black "hxddh"]\n[Result "0-1"]\n[TimeControl "600+0"]\n\n1. e4 e5 2. Nf3 Nf6 3. Nxe5 d6 0-1\n',
  '[Event "Rated bullet"]\n[Site "lichess"]\n[Date "2025.12.31"]\n[White "hxddh"]\n[Black "someone \\"quoted\\""]\n[Result "1/2-1/2"]\n[TimeControl "60+0"]\n\n1. d4 d5 2. c4 e6 1/2-1/2\n',
  '[Event "Daily"]\n[Site "chess.com"]\n[Date "2026.??.??"]\n[White "friend"]\n[Black "hxddh"]\n[Result "1-0"]\n[TimeControl "1/86400"]\n\n1. e4 c5 2. Nf3 d6 1-0\n',
  '[Event "Study"]\n[Date "2026.09.04"]\n[White "hxddh"]\n[Black "coach"]\n[Result "1-0"]\n[SetUp "1"]\n[FEN "8/8/4k3/8/8/8/4P3/4K3 b - - 3 40"]\n\n40... Kd5 41. Kd2 Ke4 1-0\n',
];

// --- 1. the position key and index ------------------------------------------
{
  assert(Q.positionKey(START) === "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq", "the key is FEN minus counters and en passant");
  const a = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
  const b = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 5 9";
  assert(Q.positionKey(a) === Q.positionKey(b) && Q.hashKey(Q.positionKey(a)) === Q.hashKey(Q.positionKey(b)),
    "…so the same position after a double step, or after shuffling, is one key");
  const h = Q.hashKey("x");
  assert(Number.isSafeInteger(h) && h >= 0 && h < 2 ** 53 && Q.hashKey("x") === h && Q.hashKey("y") !== h,
    "hashKey is a deterministic 53-bit integer (exact in a Float64Array)");
  const pk = new Map();
  const e = imported(PGNS[0], ["hxddh"], pk);
  const replay = Q.keysOfGame(e, Chess);
  assert(replay && replay.length === e.plies + 1 && replay.every((x, i) => x === pk.get(e.id)[i]),
    "the index made from the parse equals the one made by replaying the stored entry");
  const fenGame = imported(PGNS[4], ["hxddh"], pk);
  assert(Q.keysOfGame(fenGame, Chess).length === 4 && Q.keysOfGame({ sans: "e4 Ke2 Qxh7", fen: "" }, Chess) === null,
    "…from a [FEN] start too; a game that does not replay has no index (null), and is kept");
  // 10,000 distinct positions, no collision
  const seen = new Set();
  const g = new Chess();
  let n = 0;
  for (let i = 0; i < 2000 && n < 10000; i++) {
    g.reset();
    for (let p = 0; p < 12; p++) {
      const ms = g.moves();
      if (!ms.length) break;
      g.move(ms[(i * 7 + p * 13) % ms.length]);
      seen.add(Q.positionKey(g.fen()));
    }
    n = seen.size;
  }
  const hashes = new Set([...seen].map(Q.hashKey));
  assert(hashes.size === seen.size, `no two of ${seen.size} distinct positions share a hash`);
}

// --- 2. the search -------------------------------------------------------------
const pk = new Map();
const games = PGNS.map((p) => imported(p, ["hxddh"], pk));
const local = { id: "loc:g1", src: "local", ref: "g1", t: T0, diff: "normal", opp: "中级", side: "w", outcome: "win",
  result: "1-0", date: "2026.09.10", sans: "e4 e5 Nf3", plies: 3, fen: "" };
pk.set(local.id, Q.keysOfGame(local, Chess));
const all = games.concat([local]);
const pkOf = (g) => pk.get(g.id) || null;
const ids = (q) => Q.query(all, q, pkOf).map((g) => g.event || g.id).join(",");
{
  assert(Q.query(all, {}, pkOf).length === all.length, "an empty query is every game");
  assert(ids({ opponent: "RIVAL" }) === "Rated blitz,Rated rapid", "opponent: the other chair's name, any case (" + ids({ opponent: "RIVAL" }) + ")");
  assert(ids({ opponent: "hxddh" }) === "", "…never the player's own name");
  assert(ids({ opponent: "中级" }) === "loc:g1", "…a 本机 game's opponent is its level");
  assert(ids({ text: "quoted" }) === "Rated bullet" && ids({ text: "chess.com" }) === "Daily", "text: names, event and site");
  games[0].eco = "C60"; games[0].ecoName = "Ruy Lopez";
  games[1].eco = "C42"; games[1].ecoName = "Petrov's Defence";
  assert(ids({ eco: "c6" }) === "Rated blitz" && ids({ eco: "C" }) === "Rated blitz,Rated rapid" && ids({ text: "petrov" }) === "Rated rapid",
    "eco is a prefix (B, B2, B20); the opening name is searched as text");
  assert(ids({ from: "2026-09-01" }) === "Rated blitz,Daily,Study,loc:g1",
    "from a date, inclusive — 2026.??.?? could be any day of 2026 (" + ids({ from: "2026-09-01" }) + ")");
  assert(ids({ to: "2025-12-31" }) === "Rated bullet", "to a date, inclusive");
  assert(ids({ from: "2026-01-01", to: "2026-08-31" }) === "Rated rapid,Daily",
    "a range; a date with an unknown month and day (2026.??.??) is in any range its year can reach (" + ids({ from: "2026-01-01", to: "2026-08-31" }) + ")");
  assert(ids({ from: "2027-01-01" }) === "", "…and out of one it cannot");
  assert(ids({ result: "win" }) === "Rated blitz,Rated rapid,Study,loc:g1" && ids({ result: "draw" }) === "Rated bullet",
    "result from the player's chair (" + ids({ result: "win" }) + ")");
  assert(ids({ result: "1-0" }) === "Rated blitz,Daily,Study,loc:g1", "…or the board's");
  assert(ids({ color: "b" }) === "Rated rapid,Daily", "colour: the chair the player sat in");
  assert(ids({ tc: "blitz" }) === "Rated blitz" && ids({ tc: "rapid" }) === "Rated rapid" && ids({ tc: "bullet" }) === "Rated bullet" &&
    ids({ tc: "daily" }) === "Daily", "time control: Lichess's speed rule (base + 40 × increment)");
  assert(Q.tcClass("180+2") === "blitz" && Q.tcClass("120+1") === "bullet" && Q.tcClass("900+10") === "rapid" &&
    Q.tcClass("1800+20") === "classical" && Q.tcClass("-") === "" && Q.tcClass("") === "", "tcClass at the edges");
  assert(ids({ src: "local" }) === "loc:g1" && ids({ src: "import" }).split(",").length === 5, "source: 本机 or imported");
  const afterE4E5 = "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2";
  assert(ids({ position: afterE4E5 }) === "Rated blitz,Rated rapid,loc:g1", "contains a position (1. e4 e5)");
  assert(ids({ position: afterE4E5, color: "w", tc: "blitz" }) === "Rated blitz", "…and the filters combine");
  assert(ids({ position: Q.positionKey(afterE4E5) }) === ids({ position: afterE4E5 }), "…by FEN or by key");
}

// --- 3. gamesWithPosition: what was played next, with results ---------------
{
  const r = Q.gamesWithPosition(all, "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2", pkOf);
  assert(r.total === 3 && r.white === 2 && r.black === 1 && r.draws === 0, "three games reach 1. e4 e5: two White wins, one Black (" + JSON.stringify(r) + ")");
  assert(r.moves.length === 1 && r.moves[0].san === "Nf3" && r.moves[0].n === 3 && r.moves[0].white === 2 && r.moves[0].black === 1,
    "…all three went 2. Nf3, counted with their results");
  const s = Q.gamesWithPosition(all, START, pkOf);
  assert(s.total === 5 && s.moves[0].san === "e4" && s.moves[0].n === 4 && s.moves[1].san === "d4",
    "from the start: five games (the [FEN] one is not there), e4 ×4 then d4 (" + s.moves.map((m) => m.san + m.n).join(" ") + ")");
  const end = Q.gamesWithPosition(all, "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", pkOf);
  assert(end.total === 3 && end.moves.reduce((a, m) => a + m.n, 0) === 2, "a game that ends in the position counts, with no next move");
  // a game that passes a position twice counts once, with its first move
  const rep = { id: "rep", result: "1/2-1/2", sans: "Nf3 Nf6 Ng1 Ng8 e4", plies: 5, fen: "" };
  const rp = Q.gamesWithPosition([rep], START, () => Q.keysOfGame(rep, Chess));
  assert(rp.total === 1 && rp.moves[0].san === "Nf3" && rp.draws === 1, "a repetition counts the game once, with the move it played first");
}

// --- 4. claim: the name on most of the games -------------------------------
{
  const mk = (w, b) => ({ white: w, black: b });
  const c = Q.inferName([mk("hxddh", "a"), mk("b", "HXDDH"), mk("hxddh", "c"), mk("d", "e")]);
  assert(c && c.name === "hxddh" && c.n === 3 && c.of === 4, "the name on 3 of 4 games, case folded, spelled the way it is spelled most");
  assert(Q.inferName([mk("a", "b"), mk("c", "d"), mk("e", "f")]) === null, "a file of other people's games names nobody");
  assert(Q.inferName([mk("a", "b"), mk("a", "b")]) === null, "two names on every game: a tie is not a claim");
  assert(Q.inferName([mk("me", "x")]) === null, "one game is not evidence");
  assert(Q.inferName([mk("me", "x"), mk("me", "y"), mk("p", "q"), mk("r", "s"), mk("t", "u")]) === null, "fewer than half is not enough");
  assert(Q.inferName([mk("me", "x"), mk("me", "y"), { src: "local", white: "", black: "" }]).of === 2, "本机 games do not vote");
}

// --- 5. the whole-library PGN: export, import, the same games ---------------
{
  const clk = games[0];
  assert(Array.isArray(clk.clk) && clk.clk[0] === 180 && clk.site === "https://lichess.org/abc" && clk.round === "-" && clk.tc === "180+2",
    "entryFrom keeps Site, Round and TimeControl (for the search and the export), and the clock");
  const text = games.map(Q.entryPgn).join("\n");
  const back = ChessPgnParser.splitGames(text).map((chunk) => {
    const g = ChessPgnParser.parsePgn(chunk).games[0];
    const sans = [];
    for (let n = g.root; n.children.length; n = n.children[0]) sans.push(n.children[0].san);
    return L.entryFrom(g, sans, ["hxddh"], T0 + 1);
  });
  const diff = [];
  games.forEach((g, i) => {
    for (const f of Q.PGN_FIELDS) {
      if (JSON.stringify(g[f]) !== JSON.stringify(back[i] && back[i][f])) diff.push(i + "." + f + ": " + JSON.stringify(g[f]) + " → " + JSON.stringify(back[i] && back[i][f]));
    }
  });
  assert(back.length === games.length && diff.length === 0, "export → import: every game back field for field (" + Q.PGN_FIELDS.length + " fields)" + (diff.length ? " — " + diff.join("; ") : ""));
  // an entry from before Site and Round were kept: its id came from tags it
  // no longer has, and LibId carries it across
  const old = Object.assign({}, games[1], { id: "lib:1q2w3e" });
  delete old.site;
  const one = ChessPgnParser.parsePgn(Q.entryPgn(old)).games[0];
  const s2 = []; for (let n = one.root; n.children.length; n = n.children[0]) s2.push(n.children[0].san);
  assert(L.entryFrom(one, s2, [], T0).id === "lib:1q2w3e", "an old entry's id survives the round trip ([LibId])");
  const forged = ChessPgnParser.parsePgn('[LibId "../../etc"]\n\n1. e4 *').games[0];
  assert(L.entryFrom(forged, ["e4"], [], T0).id.startsWith("lib:") && L.entryFrom(forged, ["e4"], [], T0).id !== "../../etc",
    "…and a LibId that is not one of ours is ignored");
  const black = Q.entryPgn(games[4]);
  assert(/\[FEN "8\/8\/4k3\/8\/8\/8\/4P3\/4K3 b - - 3 40"\]/.test(black) && /40\.\.\. Kd5 41\. Kd2 Ke4/.test(black),
    "a black-to-move [FEN] game is numbered from its own move (40… Kd5)");
}

// --- 5b. the opening from the parse's positions = openingForGame's replay ----
{
  const { ECO_BY_KEY } = await import("../src/web/js/eco.js");
  globalThis.ECO_BY_KEY = ECO_BY_KEY;
  const { ChessEco } = await import("../src/web/js/eco-lookup.js");
  const g = new Chess();
  let seed = 11, same = 0, n = 0, hits = 0;
  const rnd = (k) => { seed = (Math.imul(seed, 1103515245) + 12345) >>> 0; return seed % k; };
  const diffs = [];
  for (let i = 0; i < 1500; i++) {
    g.reset();
    const fens = [g.fen()], sans = [];
    for (let p = 0; p < 30; p++) {
      // mostly book moves early (the table's first choice), then anything
      const ms = g.moves();
      if (!ms.length) break;
      const m = p < 10 && rnd(3) ? ms[0] : ms[rnd(ms.length)];
      g.move(m);
      sans.push(m);
      fens.push(g.fen());
    }
    const a = Q.ecoOfFens(fens, ECO_BY_KEY);
    const b = ChessEco.openingForGame(sans.slice(0, 24), null);
    n++;
    if (b) hits++;
    if (JSON.stringify(a && [a.eco, a.name]) === JSON.stringify(b && [b.eco, b.name])) same++;
    else if (diffs.length < 3) diffs.push(sans.slice(0, 8).join(" ") + ": " + JSON.stringify(a) + " vs " + JSON.stringify(b));
  }
  // the book's own lines too, where en passant and transpositions live
  for (const pgn of PGNS) {
    const gm = ChessPgnParser.parsePgn(pgn).games[0];
    const fens = [gm.root.fen], sans = [];
    for (let x = gm.root; x.children.length; x = x.children[0]) { sans.push(x.children[0].san); fens.push(x.children[0].fen); }
    const a = Q.ecoOfFens(fens, ECO_BY_KEY);
    const b = ChessEco.openingForGame(sans.slice(0, 24), gm.root.fen === START ? null : gm.root.fen);
    n++;
    if (JSON.stringify(a && [a.eco, a.name]) === JSON.stringify(b && [b.eco, b.name])) same++;
  }
  assert(same === n && hits > 100, `the opening read off the parse's positions is openingForGame's, game for game (${same}/${n}, ${hits} with a hit)` + (diffs.length ? " — " + diffs.join("; ") : ""));
}

// --- 6. library.js: the cap, and re-importing an archive ---------------------
{
  assert(L.MAX_GAMES === 10000, "the library holds 10,000 games (was 500)");
  const mk = (i) => ({ id: "x" + i, t: T0 + i, sans: "e4", plies: 1 });
  const big = Array.from({ length: 10000 }, (_, i) => mk(i));
  const t0 = performance.now();
  const r = L.addGames(big, big.map((g) => Object.assign({}, g, { clk: [1] })));
  const ms = performance.now() - t0;
  assert(r.dup === 10000 && r.added === 0 && r.list.every((g) => g.clk) && ms < 1000,
    `re-importing 10,000 games is linear, not quadratic (${ms.toFixed(0)} ms), and each picks up its clock`);
  const over = L.addGames(big, [mk(10000), mk(10001)]);
  assert(over.list.length === 10000 && over.dropped.join() === "x0,x1", "past the cap the oldest imports go first");
}

// --- 7. library-db.js: importRecords, the games read back from the native shards --
/** Entries as the importer and the analysis pass leave them. */
const FIXTURES = {
  // an analysed game, and one never analysed
  plain: { v: 1, games: [
    { id: "lib:70a", t: T0, white: "hxddh", black: "r1", date: "2026.01.01", event: "e", result: "1-0", plies: 4,
      sans: "e4 e5 Nf3 Nc6", fen: "", side: "w", outcome: "win",
      an: { acc: { w: 81.2, b: 60 }, acpl: { w: 30, b: 90 }, tags: [null, "?", null, "??"], losses: [0, 120, 5, 400], scalars: [20, 25, -100, -90, -500], budget: 120 } },
    { id: "lib:70b", t: T0 + 1, white: "x", black: "y", date: "?", event: "", result: "*", plies: 2, sans: "d4 d5", fen: "", side: null, outcome: null, an: null },
  ] },
  // motifs, an unplayable game, an opening
  marked: { v: 1, games: [
    { id: "lib:72a", t: T0 + 2, white: "alt", black: "r2", date: "2026.02.02", event: "e", result: "0-1", plies: 2, sans: "f3 e5",
      fen: "", side: "w", outcome: "loss", eco: "A00", ecoName: "Barnes Opening",
      an: { acc: { w: 20, b: 90 }, acpl: { w: 200, b: 10 }, tags: ["?", null], losses: [150, 0], scalars: [20, -130, -120], bests: ["e2e4", null], budget: 200 },
      motifs: { 0: "hanging" } },
    { id: "lib:72b", t: T0 + 3, white: "hxddh", black: "r3", date: "2026.02.03", event: "e", result: "1-0", plies: 3, sans: "e4 Ke7 Qh5",
      fen: "", side: "w", outcome: "win", an: null, unplayable: true },
  ] },
  // a clock, a [FEN] start, a deepened analysis
  clocked: { v: 1, games: [
    { id: "lib:80a", t: T0 + 4, white: "hxddh", black: "coach", date: "2026.09.04", event: "Study", result: "1-0", plies: 3,
      sans: "Kd5 Kd2 Ke4", fen: "8/8/4k3/8/8/8/4P3/4K3 b - - 3 40", side: "w", outcome: "win", clk: [30, 29, 28],
      an: { acc: { w: 99, b: 99 }, acpl: { w: 0, b: 0 }, tags: [null, null, null], losses: [0, 0, 0], scalars: [0, 0, 0, 0], budget: 400 } },
  ] },
};
for (const [shape, lib] of Object.entries(FIXTURES)) {
  const be = D.memoryBackend();
  const st = D.createLibraryStore({ backend: be, Chess });
  const r = await st.importRecords(lib.games);
  assert(r.ok && r.moved === lib.games.length, `${shape}: importRecords() takes ${lib.games.length} games in (${JSON.stringify(r)})`);
  const same = lib.games.every((g) => JSON.stringify(be.games.get(g.id)) === JSON.stringify(g));
  assert(same && be.games.size === lib.games.length, `${shape}: every game is in the store exactly as it was, field for field`);
  assert(be.meta.size === 0, `${shape}: …and no second copy of them is kept (M5 review P3-3)`);
  await st.load();
  await st.indexMissing(50, async () => {});
  const indexed = st.games.filter((g) => st.pkOf(g)).map((g) => g.id).sort().join(",");
  const want = lib.games.filter((g) => Q.keysOfGame(g, Chess)).map((g) => g.id).sort().join(",");
  assert(indexed === want, `${shape}: load + index: every replayable game gets its position index (${indexed})`);
  const shardsOut = [...st.shards().keys()].map((s) => JSON.parse(st.shardText(s)).games).flat();
  assert(shardsOut.length === lib.games.length && shardsOut.every((g) => !("pk" in g) && JSON.stringify(g) === JSON.stringify(lib.games.find((x) => x.id === g.id))),
    `${shape}: the native shards hold the same entries, without the index`);
}

// a refused write (the quota): nothing claims success, nothing is half-written
{
  const be = D.memoryBackend();
  be.fail.put = "QuotaExceededError";
  const st = D.createLibraryStore({ backend: be, Chess });
  const r = await st.importRecords(FIXTURES.plain.games);
  assert(!r.ok && r.error === "QuotaExceededError" && be.games.size === 0,
    "a quota error: importRecords() says so, and no game is half-written (" + JSON.stringify(r) + ")");
  delete be.fail.put;
  const again = await st.importRecords(FIXTURES.plain.games);
  assert(again.ok && be.games.size === 2, "…the next launch simply takes them in again");
}

// a write that "succeeds" and loses a game: caught by the read-back
{
  const be = D.memoryBackend();
  const put = be.put;
  be.put = async (records) => put(records.slice(1));
  const st = D.createLibraryStore({ backend: be, Chess });
  const r = await st.importRecords(FIXTURES.marked.games);
  assert(!r.ok && r.error === "readback" && r.missing === 1, "a game missing on read-back fails the import (" + JSON.stringify(r) + ")");
}

// half the games already in the store (a recovery cut short, or a second
// window that got there first) — no duplicate, no loss, the stored copy stands
{
  const be = D.memoryBackend();
  const lib = FIXTURES.plain;
  await be.put([Object.assign({}, lib.games[0], { pk: new Float64Array([1, 2]), an: null })]);
  const st = D.createLibraryStore({ backend: be, Chess });
  const r = await st.importRecords(lib.games);
  assert(r.ok && r.moved === 1 && be.games.size === 2 && be.games.get("lib:70a").pk.length === 2 && be.games.get("lib:70a").an === null,
    "an import run again: two games, not three, and the stored copy (with its index) stands");
  // two windows taking the same games in at once, under the store lock
  const be2 = D.memoryBackend();
  let inLock = 0, maxIn = 0;
  const q = [];
  const withLock = (fn) => {
    const run = async () => { inLock++; maxIn = Math.max(maxIn, inLock); try { return await fn(); } finally { inLock--; } };
    const p = (q.length ? q[q.length - 1] : Promise.resolve()).then(run, run);
    q.push(p);
    return p;
  };
  const a = D.createLibraryStore({ backend: be2, Chess, withLock });
  const b = D.createLibraryStore({ backend: be2, Chess, withLock });
  const [ra, rb] = await Promise.all([a.importRecords(FIXTURES.marked.games), b.importRecords(FIXTURES.marked.games)]);
  assert(ra.ok && rb.ok && be2.games.size === 2 && maxIn === 1, "two windows importing together: one at a time under the lock, the same two games");
}

// restoreShards: an exported or native copy replaces the imported games, in
// one transaction, and leaves the 本机 ones
{
  const be = D.memoryBackend();
  const st = D.createLibraryStore({ backend: be, Chess });
  await st.importRecords(FIXTURES.marked.games);
  await be.put([{ id: "loc:9", src: "local", sans: "e4", plies: 1 }]);
  await st.load();
  const text = JSON.stringify({ v: 1, games: FIXTURES.clocked.games });
  const n = await st.restoreShards({ lib12: text });
  assert(n === 1 && be.games.has("lib:80a") && !be.games.has("lib:72a") && be.games.has("loc:9") && st.games.length === 1,
    "restoreShards: the document's games replace the imported ones; the 本机 cache stays");
}

// M5 review P2-2: the background index writes its records outside the save
// chain. A clear, a drop or a restore landing between two of its slices must
// not see the games it took away written back by the slice after.
{
  const seed = () => {
    const be = D.memoryBackend();
    for (let i = 0; i < 50; i++) be.games.set("lib:" + i, { id: "lib:" + i, t: i, sans: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7", plies: 10 });
    return be;
  };
  const during = async (act) => {
    const be = seed();
    const st = D.createLibraryStore({ backend: be, Chess });
    await st.load();
    let paused = 0;
    await st.indexMissing(0, async () => { if (++paused === 1) await act(st, be); });
    return { be, st, paused };
  };
  let r = await during(async (st) => { if (typeof st.clear === "function") { st.halt(); await st.clear(); } });
  assert(typeof r.st.clear === "function" && r.be.games.size === 0,
    "P2-2: 清除全部存档 while the index is being built leaves no record behind (" + r.be.games.size + ")");
  r = await during(async (st) => { st.games = st.games.filter((g) => g.id !== "lib:7" && g.id !== "lib:30"); await st.drop(["lib:7", "lib:30"]); });
  assert(!r.be.games.has("lib:7") && !r.be.games.has("lib:30") && r.be.games.size === 48,
    "P2-2: a game dropped (library over its cap) while indexing is not written back (" + r.be.games.size + ")");
  r = await during(async (st) => { await st.restoreShards({ lib00: JSON.stringify({ v: 1, games: [{ id: "lib:new", sans: "d4", plies: 1 }] }) }); });
  assert(r.be.games.size === 1 && r.be.games.has("lib:new"),
    "P2-2: a restore while indexing is not followed by the old games coming back (" + [...r.be.games.keys()].slice(0, 4).join(",") + "…)");
  r = await during(async () => {});
  assert(r.be.games.size === 50 && [...r.be.games.values()].every((g) => g.pk), "P2-2: …left alone, every game is indexed and written");
}

// --- 8. v8-1-plan F3: the list's summary, kept beside the games ------------------
// Every write path keeps the stored summary equal to what summaryOf says of
// the records the store holds; readSummary hands it out only when the header's
// id and the record count vouch for it.
{
  /** The stored summary, checked against the stored records: {ok, why, rows}. */
  const check = (be) => {
    const rows = new Map();
    let why = "";
    for (const [k, text] of be.meta) {
      if (!k.startsWith(S.SUM_KEY)) continue;
      for (const r of JSON.parse(text)) {
        if (rows.has(r.id)) why += " twice:" + r.id;
        if (S.SUM_KEY + Q.shardOf(r.id) !== k) why += " wrong-shard:" + r.id;
        rows.set(r.id, r);
      }
    }
    for (const [id, rec] of be.games) {
      const { pk, ...entry } = rec;
      const want = JSON.stringify(D.summaryOf(entry));
      if (!rows.has(id)) why += " missing:" + id;
      else if (JSON.stringify(rows.get(id)) !== want) why += " stale:" + id;
    }
    for (const id of rows.keys()) if (!be.games.has(id)) why += " extra:" + id;
    return { ok: !why, why, rows };
  };
  /** A store over a fresh backend, loaded and in step (the page's boot). */
  const boot = async (be) => {
    const st = D.createLibraryStore({ backend: be, Chess });
    await st.load();
    const id = await st.syncSummary(50, async () => {});
    return { st, id };
  };
  const pk = new Map();
  const entries = PGNS.map((p) => imported(p, ["hxddh"], pk));
  const withPk = (g) => { const k = pk.get(g.id); if (k) g.pk = k; return g; };

  // an empty library gets an id, and nothing else
  const be = D.memoryBackend();
  let { st, id } = await boot(be);
  assert(typeof id === "string" && id && be.meta.get(S.SUM_ID) === id && st.sumId() === id,
    "F3 summary: a library gets an id once it is in step (" + id + ")");
  // import: the entries and their rows in one write
  for (const e of entries) st.indexFens(e.id, [START]);
  await st.save(entries);
  let c = check(be);
  assert(c.ok && c.rows.size === entries.length, "F3 summary: an import writes a row for every game (" + c.rows.size + c.why + ")");
  let rows = await st.readSummary(id);
  assert(rows && rows.length === entries.length && !rows.some((r) => "sans" in r || "pk" in r || "an" in r && typeof r.an !== "number"),
    "F3 summary: readSummary hands the rows out — no moves, no index, no analysis arrays");
  assert((await st.readSummary("other")) === null && (await st.readSummary(null)) === null,
    "F3 summary: …only under the id the header carries (a build without the summary drops it)");
  // the pass analyses a game; the player claims another: both rows follow
  const a = entries[0];
  a.an = { acc: { w: 71.26, b: 40 }, tags: ["?", null, "??", null, null, "?"], budget: 200 };
  entries[3].side = "b"; entries[3].outcome = "win";
  await st.save([a, entries[3]]);
  c = check(be);
  const ra = c.rows.get(a.id);
  assert(c.ok && ra.an === 200 && ra.acc === 71.26 && ra.bad === 2 && c.rows.get(entries[3].id).sd === "b",
    "F3 summary: analysis and claim reach the row (acc, mistakes, depth, side" + c.why + ")");
  // remove (over the cap, 清除 of one): the row goes with the record
  await st.drop([entries[1].id]);
  c = check(be);
  assert(c.ok && !c.rows.has(entries[1].id), "F3 summary: a dropped game's row goes in the same write" + c.why);
  // 本机 (syncLocal): saved and dropped like the imported ones, marked as theirs
  const loc = { id: "loc:g1", src: "local", ref: "g1", t: T0 + 9, diff: "hard", side: "b", outcome: "draw", result: "1/2-1/2",
    white: "", black: "", date: "2026.09.20", sans: "d4 d5", plies: 2, fen: "", pgnLen: 40, acc: 88, tc: "300+0" };
  await st.save([loc]);
  c = check(be);
  const rl = c.rows.get("loc:g1");
  assert(c.ok && rl.src === "local" && rl.acc === 88 && rl.df === "hard" && rl.ref === "g1", "F3 summary: a 本机 game's row carries its level, record and accuracy" + c.why);
  await st.drop(["loc:g1"]);
  assert(check(be).ok && !check(be).rows.has("loc:g1"), "F3 summary: …and goes when the play history drops it");
  // the background index writes records whose rows did not change: no summary write
  let metaWrites = 0;
  const put0 = be.put;
  be.put = async (recs, m) => { if (m) metaWrites++; return put0(recs, m); };
  await st.save(entries.filter((g) => g.id !== entries[1].id));
  be.put = put0;
  assert(metaWrites === 0, "F3 summary: rewriting games whose rows are unchanged writes no shard (" + metaWrites + ")");
  // a refused write: neither games nor rows land; the next write of that shard brings the row
  be.fail.put = "QuotaExceededError";
  entries[2].eco = "D06"; entries[2].ecoName = "Queen's Gambit";
  let threw = false;
  try { await st.save([entries[2]]); } catch (_) { threw = true; }
  delete be.fail.put;
  c = check(be);
  assert(threw && c.ok && c.rows.get(entries[2].id).eco !== "D06", "F3 summary: a refused write leaves records and rows as they were" + c.why);
  await st.save([entries[2]]);
  c = check(be);
  assert(c.ok && c.rows.get(entries[2].id).eco === "D06", "F3 summary: …and the retry writes both" + c.why);

  // the recovery path's import after load: a game the store holds stays as
  // stored, a new one comes in with its row
  const other = Object.assign({}, entries[0], { an: { acc: { w: 90, b: 10 }, tags: [], budget: 800 } });
  const fresh = Object.assign({}, entries[0], { id: "lib:import-new" });
  const r = await st.importRecords([other, fresh]);
  c = check(be);
  assert(r.ok && r.moved === 1 && c.ok && c.rows.get(entries[0].id).an !== 800 && c.rows.has("lib:import-new"),
    "F3 summary: importRecords() keeps the stored copy's row and adds the new game's" + c.why);

  // restore from the native shards: the imported rows replaced, 本机 rows kept
  await st.save([loc]);
  // the page keeps the store's list current (library-page.js save: st.games = list)
  st.games = [...be.games.values()].filter((g) => g.src !== "local").map(({ pk: _k, ...g }) => g);
  await st.restoreShards({ lib00: JSON.stringify({ v: 1, games: FIXTURES.clocked.games }) });
  c = check(be);
  assert(c.ok && c.rows.size === 2 && c.rows.has("lib:80a") && c.rows.has("loc:g1"),
    "F3 summary: restoreShards replaces the imported rows in the same transaction, keeps 本机 (" + [...c.rows.keys()] + ")" + c.why);

  // 清除全部存档: the rows go with the games; the id stays
  await st.clear();
  c = check(be);
  assert(c.ok && c.rows.size === 0 && be.meta.get(S.SUM_ID) === id && (await st.readSummary(id)).length === 0,
    "F3 summary: a clear empties the summary with the store" + c.why);
}

// the summary written by someone who does not keep it (a window that never
// heard of a game) is never handed out wrong, and the next boot mends it
{
  const be = D.memoryBackend();
  const pk = new Map();
  const es = PGNS.map((p) => imported(p, ["hxddh"], pk));
  const a = D.createLibraryStore({ backend: be, Chess });
  await a.load();
  const id = await a.syncSummary(50, null);
  await a.save(es.slice(0, 3));
  // a writer that keeps no summary imports two games (records only): even
  // under the old id the count gives it away
  await be.put(es.slice(3).map((g) => Object.assign({}, g)));
  assert((await a.readSummary(id)) === null, "F3 summary: records the summary does not cover → no summary (the list waits for the games)");
  // …and re-analyses a game in place (same count): the row is stale until the next boot's sync
  const stale = Object.assign({}, es[0], { an: { acc: { w: 55, b: 45 }, tags: [], budget: 400 } });
  await be.put([stale]);
  const b = D.createLibraryStore({ backend: be, Chess });
  await b.load();
  const id2 = await b.syncSummary(0, async () => {});
  const rows = await b.readSummary(id2);
  const r0 = rows && rows.find((r) => r.id === es[0].id);
  assert(id2 === id && rows && rows.length === 5 && r0 && r0.an === 400 && r0.acc === 55,
    "F3 summary: the boot after it rewrites the shards that disagree, under the same id");
  // two windows: B loaded before A imported; A's peer message is how B learns
  const w1 = D.createLibraryStore({ backend: be, Chess });
  const w2 = D.createLibraryStore({ backend: be, Chess });
  await w1.load(); await w2.load();
  const fresh = imported('[White "p"]\n[Black "q"]\n[Result "1-0"]\n\n1. c4 e5 1-0\n', ["p"], pk);
  const sameShard = Object.assign({}, es[1], { id: es[1].id, eco: "Z99" });
  await w1.save([fresh]);
  await w2.read([fresh.id]);   // BroadcastChannel → read(ids)
  await w2.save([sameShard, Object.assign({}, fresh, { eco: "A10" })]);
  const n = be.games.size;
  const all = await w2.readSummary(id);
  assert(all && all.length === n && all.find((r) => r.id === fresh.id).eco === "A10",
    "F3 summary: a second window that read the first one's game back keeps its row when it writes (" + (all && all.length) + "/" + n + ")");
  // …and one that did not hear of it drops the row — which the count catches
  const late = imported('[White "r"]\n[Black "s"]\n[Result "0-1"]\n\n1. g3 d5 0-1\n', [], pk);
  let k = 0;
  while (Q.shardOf("lib:mate" + k) !== Q.shardOf(late.id)) k++;
  const mate = { id: "lib:mate" + k, t: T0, white: "m", black: "n", date: "2026.01.01", result: "*", plies: 1, sans: "e4", fen: "" };
  await w1.save([mate]);
  const w3 = D.createLibraryStore({ backend: be, Chess });
  await w3.load();
  await w1.save([late]);   // w3 is not told
  await w3.save([Object.assign({}, mate, { eco: "Y00" })]);
  assert((await w3.readSummary(id)) === null,
    "F3 summary: …and a window that never heard of a game cannot make the summary lie: the count no longer matches");
  const w4 = D.createLibraryStore({ backend: be, Chess });
  await w4.load();
  await w4.syncSummary(0, async () => {});
  const back = await w4.readSummary(id);
  assert(back && back.length === be.games.size && back.some((r) => r.id === late.id), "F3 summary: …until the next boot puts it right")
}

// the list's stand-ins search like the entries (everything but the position)
{
  const pk = new Map();
  const es = PGNS.map((p) => imported(p, ["hxddh"], pk));
  es[0].an = { acc: { w: 80, b: 20 }, tags: ["?"], budget: 200 };
  es[1].eco = "C42"; es[1].ecoName = "Petrov's Defense";
  const stubs = es.map((g) => D.stubOf(JSON.parse(JSON.stringify(D.summaryOf(g)))));
  const qs = [{ text: "rival" }, { opponent: "friend" }, { eco: "C4" }, { text: "petrov" }, { from: "2026-01-01", to: "2026-08-31" },
    { result: "win" }, { result: "1-0" }, { color: "b" }, { tc: "blitz" }, { tc: "correspondence" }, { src: "import" }, { text: "lichess" }];
  const ids = (list, q) => Q.query(list, q, null).map((g) => g.id).join(",");
  const bad = qs.filter((q) => ids(es, q) !== ids(stubs, q));
  assert(bad.length === 0 && qs.every((q) => ids(es, q) !== undefined),
    "F3 stubs: every query but the position answers the same over the summary as over the entries" + (bad.length ? " — " + JSON.stringify(bad) : ""));
  const s0 = stubs[0];
  assert(s0.stub && s0.stub.an === 200 && s0.stub.acc === 80 && s0.stub.bad === 1 && !s0.an && !s0.sans && Q.siteOf(s0) === Q.siteOf(es[0]),
    "F3 stubs: a stand-in carries what its row showed of the analysis, and no moves");
}

// chunk-boot.js reads the header by its raw key: the one persist.js owns
{
  const { KEYS } = await import("../src/web/js/persist.js");
  assert(S.HEADER_KEY === KEYS.library && S.DB_NAME === D.DB_NAME, "F3: library-sum.js names the header persist.js keeps, and the database library-db.js opens");
  const store = (v) => ({ getItem: () => v });
  const g = globalThis;
  const got = (raw) => { g[S.PREFETCH_GLOBAL] = null; const r = S.bootPrefetch(store(raw), null); const p = g[S.PREFETCH_GLOBAL]; g[S.PREFETCH_GLOBAL] = null; return r && !!p; };
  assert(got(JSON.stringify({ v: 1, names: [], n: 5, sum: "s1" })) &&
    !got(JSON.stringify({ v: 1, names: [], n: 5 })) && !got(null),
    "F3: chunk-boot.js asks for the summary only for a header with a summary id");
  assert(S.opensOnLibrary(JSON.stringify({ view: "library" })) && !S.opensOnLibrary(JSON.stringify({ view: "play" })) && !S.opensOnLibrary("{x"),
    "F3: …and puts the library's chunk ahead of the bundle only when the app opens on the library page");
}

if (failed) { console.error("\n" + failed + " failure(s)"); process.exit(1); }
console.log("\nall library-db tests passed");
