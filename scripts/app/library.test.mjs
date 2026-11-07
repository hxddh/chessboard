/**
 * The library on 我 without a browser: the list (library/list.js — one list
 * of imported and played games, search, result, year, pages), the background
 * review's choice of games and its caps (library/records.js pickGames) and the
 * review itself (library/autoreview.js, review/review.js reviewQuietly: the
 * same events as the review on the board, paused while the engine is busy),
 * and 「这是你吗」 (learn/model.js library.you: the games under that name
 * rate as yours; db.js projects the side into the library rows).
 */
import { entriesOf, filterEntries, pageOf, yearsOf, outcomeOf, claimsFor, PAGE_SIZE } from "../../src/app/library/list.js";
import { pickGames, gameOfRecord, dateOf, AUTO_RECENT, AUTO_PER_DAY } from "../../src/app/library/records.js";
import { startAutoReview } from "../../src/app/library/autoreview.js";
import { importFile } from "../../src/app/library/import.js";
import { createDb, memoryBackend } from "../../src/app/services/db.js";
import { createEngineService, fakeBackend } from "../../src/app/services/engine.js";
import { project, initialState, apply, youCandidates } from "../../src/app/learn/model.js";

const noPause = () => Promise.resolve();
const DAY = 86400000;
// Blackburne–Shilling: White (you, below) takes the bait and is mated
const TRAP = "e4 e5 Nf3 Nc6 Bc4 Nd4 Nxe5 Qg5 Nxf7 Qxg2 Rf1 Qxe4+ Be2 Nf3#";
const pgn = (white, black, result, moves = "1. e4 e5 2. Nf3 Nc6 3. Bc4 Nd4 4. Nxe5 Qg5 5. Nxf7 Qxg2 6. Rf1 Qxe4+ 7. Be2 Nf3#", extra = "") =>
  `[White "${white}"]\n[Black "${black}"]\n[Result "${result}"]\n${extra}\n${moves} ${result}\n`;

const lib = (o) => ({ id: o.id, white: "A", black: "B", result: "1-0", you: "w", plies: 20, date: "2024.05.01", sans: "e4 e5", ...o });

export default function (test) {
  test("list: imported and played games in one list, newest first; unfinished games left out", (a) => {
    const rows = [lib({ id: "i1", date: "2023.01.02" }), lib({ id: "i2", date: "2025.03.04", you: "b", result: "1-0" }), lib({ id: "i3", date: "", importedAt: Date.UTC(2024, 0, 1), you: null })];
    const games = [{ id: "g1", mode: "engine", engineColor: "b", opponent: "pip", startedAt: Date.UTC(2026, 1, 1), result: { result: "1-0" } },
      { id: "g2", mode: "pvp", startedAt: Date.UTC(2026, 2, 1), result: null }];
    const es = entriesOf(rows, games, () => ({ white: "You", black: "Pip" }));
    a.deepEqual(es.map((e) => e.id), ["g1", "i2", "i3", "i1"]);
    a.equal(es[0].kind, "played"); a.equal(es[0].you, "w"); a.equal(outcomeOf(es[0]), "win");
    a.equal(outcomeOf(es[1]), "loss", "you were Black, 1-0");
    a.equal(outcomeOf(es[2]), null, "not known which side was yours");
    a.deepEqual(yearsOf(es), [2026, 2025, 2024, 2023]);
  });
  test("list: search by name, event or date; filter by result and year; pages", (a) => {
    const rows = Array.from({ length: 95 }, (_, i) => lib({ id: "g" + i, black: i % 2 ? "Magnus" : "Hikaru", event: i % 5 ? "Club" : "Open",
      result: i % 3 === 0 ? "1-0" : i % 3 === 1 ? "0-1" : "1/2-1/2", date: (2020 + (i % 4)) + ".06.0" + (1 + (i % 9)) }));
    const es = entriesOf(rows, []);
    a.equal(filterEntries(es, { q: "magnus" }).length, 47, "a name, any case");
    a.equal(filterEntries(es, { q: "magnus open" }).length, filterEntries(es, {}).filter((e) => e.black === "Magnus" && e.event === "Open").length, "every word");
    a.equal(filterEntries(es, { q: "2021.06" }).length, es.filter((e) => e.dateText.startsWith("2021")).length, "the date as written");
    a.equal(filterEntries(es, { result: "win" }).length, 32);
    a.equal(filterEntries(es, { result: "draw" }).length, 31);
    a.equal(filterEntries(es, { year: "2022" }).length, es.filter((e) => e.dateText.startsWith("2022")).length);
    const p0 = pageOf(es, 0), last = pageOf(es, 99);
    a.equal(p0.rows.length, PAGE_SIZE); a.equal(p0.pages, Math.ceil(95 / PAGE_SIZE));
    a.equal(last.page, p0.pages - 1, "a page past the end is the last one"); a.equal(last.rows.length, 95 - (p0.pages - 1) * PAGE_SIZE);
    a.equal(pageOf([], 3).pages, 1);
  });
  test("list: thousands of games filter and page in a few milliseconds", (a) => {
    const rows = Array.from({ length: 5000 }, (_, i) => lib({ id: "x" + i, black: "Opp" + (i % 300), date: (2000 + (i % 26)) + ".01.01" }));
    const t0 = performance.now();
    const es = entriesOf(rows, []);
    const hit = filterEntries(es, { q: "opp17", result: "win", year: "2010" });
    pageOf(hit, 0);
    const ms = performance.now() - t0;
    a.ok(hit.length > 0 && ms < 250, "5,000 games: " + ms.toFixed(1) + " ms");
  });
  test("records: the date of a row; a row replayed into the review's game", (a) => {
    a.equal(dateOf({ date: "2024.03.05" }), Date.UTC(2024, 2, 5));
    a.equal(dateOf({ date: "2024.??.??" }), Date.UTC(2024, 0, 1));
    a.equal(dateOf({ date: "????.??.??", playedAt: 7 }), 7);
    a.equal(dateOf({ importedAt: 9 }), 9);
    const g = gameOfRecord({ id: "z", sans: TRAP });
    a.equal(g.moves.length, 14); a.equal(g.moves[13].san, "Nf3#"); a.equal(g.moves[0].uci, "e2e4");
    a.equal(gameOfRecord({ id: "bad", sans: "e4 Ke7 Qh5" }), null, "an illegal move: no game");
  });
  test("records: the background review takes the 20 most recent of your games, 5 a day, long enough, not done yet", (a) => {
    const now = Date.UTC(2026, 10, 7, 12);
    const rows = Array.from({ length: 40 }, (_, i) => lib({ id: "r" + String(i).padStart(2, "0"), date: (1990 + i) + ".01.01" }));
    rows.push(lib({ id: "nobody", date: "2030.01.01", you: null }), lib({ id: "short", date: "2031.01.01", plies: 6 }));
    let pick = pickGames(rows, now);
    a.deepEqual(pick.map((r) => r.id), ["r39", "r38", "r37", "r36", "r35"], "newest first, five a day; nobody's and short games skipped");
    for (const r of rows.slice(30)) r.analysed = { at: now - 3 * DAY, auto: true };
    pick = pickGames(rows, now);
    a.deepEqual(pick.map((r) => r.id), ["r29", "r28", "r27", "r26", "r25"], "the done ones are skipped");
    for (const r of rows.slice(20, 30)) r.analysed = { at: now - 3 * DAY, auto: true };
    a.equal(pickGames(rows, now).length, 0, "only the " + AUTO_RECENT + " most recent: older ones are left alone");
    for (const r of rows) delete r.analysed;
    for (const r of rows.slice(35)) r.analysed = { at: now - 1000, auto: true };
    a.equal(pickGames(rows, now).length, 0, AUTO_PER_DAY + " done today: no more until tomorrow");
    a.equal(pickGames(rows, now + DAY).length, AUTO_PER_DAY);
  });
  test("model: 「这是你吗」 — games nobody's are kept, a name makes them yours and rates them", (a) => {
    const ev = [];
    let id = 0;
    const push = (e) => ev.push({ id: ++id, at: 1000 + id, ...e });
    for (let i = 0; i < 6; i++) push({ type: "game.import", gameId: "n" + i, white: i % 2 ? "Rival" + i : "Ann", black: i % 2 ? "Ann" : "Bob" + i,
      whiteElo: 1200, blackElo: 1300, result: i % 3 ? "1-0" : "0-1", you: null, opp: null });
    push({ type: "import.file", you: null, added: 6 });
    let st = project(ev);
    a.equal(st.games, 0, "nothing rated yet");
    const names = youCandidates(st);
    a.deepEqual(names[0], { name: "Ann", games: 6 }, "the name in every game first");
    a.ok(names.length <= 4);
    push({ type: "library.you", name: "Ann", games: [] });
    st = project(ev);
    a.equal(st.games, 6, "all six rated now"); a.ok(st.game && Number.isFinite(st.game.r));
    a.deepEqual(youCandidates(st), [], "answered: nothing to ask");
    a.equal(Object.keys(st.unclaimed).length, 0);
    // folded a few at a time, the same
    const inc = initialState();
    for (const e of ev) apply(inc, e);
    a.equal(inc.game.r, st.game.r);
    // none of these: put away until the next file without a name
    const ev2 = ev.slice(0, 7);
    ev2.push({ id: 8, at: 2000, type: "library.you", name: null, games: [] });
    const st2 = project(ev2);
    a.equal(st2.games, 0); a.deepEqual(youCandidates(st2), []);
    ev2.push({ id: 9, at: 2001, type: "import.file", you: null, added: 1 });
    a.ok(youCandidates(project(ev2)).length > 0, "a new file asks again");
  });
  test("db: library.you gives the rows their side; a review marks the library row analysed", async (a) => {
    const db = await createDb(memoryBackend());
    await importFile(pgn("Ann", "Bob", "1-0", "1. e4 e5", "[BlackElo \"1400\"]") + "\n" + pgn("Cat", "Dan", "0-1", "1. d4 d5", "[WhiteElo \"1500\"]"), { db, pause: noPause });
    let rows = await db.query("library.all");
    a.ok(rows.every((r) => !r.you), "two names, two games: nobody is inferred");
    const games = claimsFor(rows, "Ann");
    a.deepEqual(games.map((g) => g.slice(1)), [["w", 1400]]);
    await db.append({ type: "library.you", name: "Ann", games });
    rows = await db.query("library.all");
    const ann = rows.find((r) => r.white === "Ann");
    a.equal(ann.you, "w"); a.equal(ann.opp, 1400); a.ok(!rows.find((r) => r.white === "Cat").you);
    await db.append({ type: "review.analysis", gameId: ann.id, rows: [{}, {}], auto: true, budget: { review: "normal" } });
    const got = await db.query("library.get", { id: ann.id });
    a.ok(got.analysed && got.analysed.auto, "analysed, by the background review");
    a.equal((await db.query("analysis.get", { gameId: ann.id })).length, 2);
    await db.append({ type: "review.done", gameId: ann.id });
    a.ok((await db.query("library.get", { id: ann.id })).reviewed);
  });
  test("autoreview: your imported games reviewed one at a time — findings and cards like a played game's; paused while busy", async (a) => {
    const db = await createDb(memoryBackend());
    const text = [pgn("Me", "Rival", "0-1", undefined, "[Date \"2025.01.01\"]\n[WhiteElo \"900\"]\n[BlackElo \"1000\"]"),
      pgn("Me", "Other", "0-1", undefined, "[Date \"2025.01.02\"]\n[Round \"2\"]\n[BlackElo \"1100\"]"),
      pgn("Me", "Third", "1-0", "1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7#", "[Date \"2025.01.03\"]")].join("\n");
    const r = await importFile(text, { db, pause: noPause });
    a.equal(r.you, "Me");
    const fake = fakeBackend();
    const engine = createEngineService(fake);
    let busy = true;
    const done = [];
    const bg = startAutoReview({ engine, db, busy: () => busy, budget: { depth: 1 }, onDone: (id) => done.push(id), idle: (f) => setTimeout(f, 0) });
    await new Promise((res) => setTimeout(res, 300));
    a.equal(fake.calls, 0, "busy: not one search");
    a.ok(bg.status.paused, "and it says it is paused");
    busy = false;
    await bg.settled();
    await bg.stop();
    a.equal(done.length, 2, "two games long enough (the third has 7 plies)");
    const ev = await db.query("events.since", { after: 0, limit: 1000 });
    const an = ev.filter((e) => e.type === "review.analysis");
    a.ok(an.length === 2 && an.every((e) => e.auto), "each stored, marked auto");
    const finds = ev.filter((e) => e.type === "review.finding");
    a.ok(finds.length >= 2 && finds.every((f) => f.side === "w" && f.fen && f.best && f.auto), "your mistakes only, each with its position and the better move (" + finds.length + ")");
    const st = project(ev);
    const cards = Object.keys(st.cards).filter((k) => k.startsWith("rv:imp:"));
    a.ok(cards.length >= 2 && cards.length <= 6, "they become review cards, ≤ 3 a game (" + cards.length + ")");
    const rows = await db.query("library.all");
    a.equal(rows.filter((x) => x.analysed).length, 2);
    // reopened: nothing left to do now
    const fake2 = fakeBackend();
    const bg2 = startAutoReview({ engine: createEngineService(fake2), db, busy: () => false, budget: { depth: 1 }, idle: (f) => setTimeout(f, 0) });
    await bg2.settled(); await bg2.stop();
    a.equal(fake2.calls, 0, "a game reviewed is never reviewed twice");
  });
  test("autoreview: busy in the middle of a game — the pass waits where it is and finishes", async (a) => {
    const db = await createDb(memoryBackend());
    await importFile(pgn("Me", "R", "0-1") + "\n" + pgn("Me", "S", "0-1", undefined, "[Round \"2\"]"), { db, pause: noPause });
    const fake = fakeBackend();
    let busy = false;
    const engine = createEngineService({ ...fake, search: async (fen, o) => { if (fake.calls === 5) busy = true; return fake.search(fen, o); } });
    const bg = startAutoReview({ engine, db, busy: () => busy, budget: { depth: 1 }, idle: (f) => setTimeout(f, 0) });
    await new Promise((res) => setTimeout(res, 200));
    const stuck = fake.calls;
    a.ok(busy && stuck <= 6 && bg.status.paused, "paused after the search under way (" + stuck + " searches)");
    await new Promise((res) => setTimeout(res, 200));
    a.equal(fake.calls, stuck, "and stays paused");
    busy = false;
    await bg.settled(); await bg.stop();
    a.equal((await db.query("library.all")).filter((x) => x.analysed).length, 2, "then both games finish");
  });
}
