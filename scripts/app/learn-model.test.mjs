/**
 * The learner model and the queue (src/app/learn): a projection of the
 * events (recomputed = folded as it came), the caps (≤ 3 review cards a
 * game, ≤ 15 new cards a day), the gating (nothing served that needs a
 * skill not reached), placement lighting skills, one visible rating, the
 * weekly line.
 */
import { project, apply, initialState, visibleRating, isLit, isReached, frontier, weekly, stageOf, today,
  NEW_CARDS_PER_DAY, CARDS_PER_GAME } from "../../src/app/learn/model.js";
import { plan, next, itemOf, todayOf } from "../../src/app/learn/queue.js";
import { newRun, pickNext, step, placeEvent } from "../../src/app/learn/placement.js";
import { SKILLS, SKILL, STAGES, ancestors } from "../../src/app/content/skills.js";
import { ITEMS, PRACTICE } from "../../src/app/content/practice.js";
import { DAY } from "../../src/app/learn/fsrs.js";

const T0 = Date.UTC(2026, 10, 2, 8, 0, 0);
const opp = (id) => ({ pip: 600, lin: 1000, vera: 1500 })[id] ?? null;

/** A seeded player who answers what the queue serves, right with probability `p`. */
function simulate({ steps = 300, p = 0.85, seed = 7, place = null, check = () => {}, perDay = 25 } = {}) {
  let s = seed;
  const rnd = () => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s / 4294967296; };
  const events = [];
  let id = 0, now = T0;
  const st = initialState();
  const push = (e) => { const ev = { ...e, id: ++id, at: now }; events.push(ev); apply(st, ev, { opponentRating: opp }); };
  push(place || { type: "learn.place", rating: 400, how: "new" });
  for (let i = 0; i < steps; i++) {
    if (i % perDay === perDay - 1) now += DAY; else now += 40000;
    const n = next(st, now);
    if (!n) break;
    const it = itemOf(st, n.id);
    check(st, n, it, now);
    if (it.kind === "game") {
      const gameId = "g" + i;
      push({ type: "learn.game", item: n.id, gameId });
      push({ type: "game.start", gameId, mode: "engine", engineColor: "b", opponent: "pip" });
      push({ type: "game.end", gameId, result: rnd() < 0.5 ? "1-0" : "0-1", reason: "mate" });
      continue;
    }
    const ok = it.kind === "lesson" || rnd() < p;
    push({ type: "learn.answer", item: n.id, skill: it.skill, kind: it.kind, ok, tries: ok ? 1 : 2, revealed: !ok, rating: it.rating });
  }
  return { st, events, now };
}

export default function (test) {
  test("model: recomputing from the events gives the same state, folded in any chunks", (a) => {
    const { st, events } = simulate({ steps: 250 });
    const again = project(events, { opponentRating: opp });
    a.deepEqual(JSON.parse(JSON.stringify(again)), JSON.parse(JSON.stringify(st)), "project(all) = folded one by one");
    const chunked = initialState();
    for (let i = 0; i < events.length; i += 17) for (const e of events.slice(i, i + 17)) apply(chunked, e, { opponentRating: opp });
    a.deepEqual(JSON.parse(JSON.stringify(chunked)), JSON.parse(JSON.stringify(st)), "in chunks");
    // folding an event twice changes nothing (a page reading the table again)
    for (const e of events.slice(-30)) apply(chunked, e, { opponentRating: opp });
    a.deepEqual(JSON.parse(JSON.stringify(chunked)), JSON.parse(JSON.stringify(st)), "idempotent by event id");
  });

  test("model: a beginner is never served what needs a skill not reached", (a) => {
    let served = 0, lessons = 0;
    simulate({ steps: 600, p: 0.8, check: (st, n, it) => {
      served++;
      if (it.kind === "lesson") lessons++;
      if (it.kind === "game") { a.ok(isLit(st, "mate"), "a game before 将死"); return; }
      if (it.mode === "mistake") return;
      const sk = it.skill;
      a.ok(sk && (isReached(st, sk) || isLit(st, sk)), n.id + ": its skill " + sk + " is reached");
      for (const need of it.needs || []) a.ok(need === sk || isLit(st, need) || ancestors(sk).has(need) && isLit(st, need),
        n.id + " needs " + need + " before it is lit");
      if (it.kind === "lesson") a.ok(!isLit(st, sk), "no lesson for a lit skill " + sk);
    } });
    a.ok(served > 500 && lessons >= 10, "served " + served + ", lessons " + lessons);
  });

  test("model: a beginner climbs — skills light one after another, the rating rises", (a) => {
    const { st } = simulate({ steps: 600, p: 0.9 });
    const lit = SKILLS.filter((s) => isLit(st, s.id)).map((s) => s.id);
    a.ok(lit.length >= 12, "lit " + lit.length + ": " + lit.join(" "));
    a.ok(lit.includes("rook") && lit.includes("mate"), "the moves, then mate");
    a.ok(visibleRating(st) > 450, "rating " + visibleRating(st));
    a.ok(st.curve.length >= 2 && st.curve[st.curve.length - 1][1] > st.curve[0][1], "a growth curve that grows");
  });

  test("model: placement ≥ 1200 lights the skills below it and never brings their lessons back", (a) => {
    const place = { type: "learn.place", rating: 1300, how: "often" };
    const st0 = project([{ ...place, id: 1, at: T0 }]);
    for (const s of SKILLS) a.equal(isLit(st0, s.id), s.level < 1300, s.id + " lit by placement");
    a.equal(visibleRating(st0), 1300);
    simulate({ steps: 300, place, check: (st, n, it) => {
      if (it.kind === "lesson") a.ok(!isLit(st, it.skill) && SKILL[it.skill].level >= 1300, "lesson " + it.skill);
      if (n.why === "new") a.ok(!isLit(st, it.skill), "new item from a lit skill " + it.skill);
    } });
  });

  test("model: placement runs six answers, steps halving, and starts where it says", (a) => {
    let run = newRun("knows");
    a.equal(run.est, 900);
    const seen = [];
    while (!run.over) { const id = pickNext(run); seen.push(ITEMS[id].rating); run = step(run, id, true); }
    a.equal(seen.length, 6);
    a.equal(run.est, 900 + 300 + 200 + 150 + 100 + 75 + 50);
    a.ok(Math.abs(seen[1] - 1200) <= 60, "the second aimed at 1200 (" + seen[1] + ")");
    a.deepEqual(placeEvent(run), { type: "learn.place", rating: 1775, how: "knows" });
    a.equal(placeEvent(null).rating, 400);
  });

  test("model: ≤ 3 review cards per game, ≤ 15 new cards per day", (a) => {
    const events = [];
    let id = 0;
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    for (let g = 0; g < 8; g++) for (let k = 0; k < 6; k++) {
      events.push({ id: ++id, at: T0 + g * 1000 + k, type: "review.finding", gameId: "g" + g, ply: 6 + k, motif: "fork", fen, best: "f3f7", san: "Nc3" });
    }
    const st = project(events);
    const per = {};
    for (const cid of Object.keys(st.cards)) { const g = cid.split(":")[1]; per[g] = (per[g] || 0) + 1; }
    a.ok(Object.values(per).every((n) => n <= CARDS_PER_GAME), JSON.stringify(per));
    a.equal(Object.keys(st.cards).length, NEW_CARDS_PER_DAY, "the day's cap holds across games");
    a.equal(itemOf(st, "rv:g0:6").line[0], "Qxf7#", "the card's answer is the engine's move, as SAN");
    // answers count against the same cap; the next day has room again
    const more = Object.keys(ITEMS).filter((x) => ITEMS[x].kind === "line").slice(0, 20)
      .map((item, i) => ({ id: ++id, at: T0 + 50000 + i, type: "learn.answer", item, skill: ITEMS[item].skill, kind: "line", ok: true, tries: 1 }));
    const st2 = project([...events, ...more]);
    a.equal(Object.keys(st2.cards).length, NEW_CARDS_PER_DAY, "no new cards past 15 on one day");
    const st3 = project([...events, ...more.map((e) => ({ ...e, at: e.at + DAY }))]);
    a.equal(Object.keys(st3.cards).length, NEW_CARDS_PER_DAY * 2, "15 more the next day");
    // the finding is evidence against fork
    a.ok(st.skills.fork.m === 0 && st.skills.fork.weakAt > 0);
  });

  test("model: review.retry is the card's first review; the weekly line compares weeks", (a) => {
    const fen = "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5Q2/PPPP1PPP/RNB1K1NR w KQkq - 4 4";
    const ev = [
      { id: 1, at: T0, type: "review.finding", gameId: "a", ply: 6, motif: "fork", fen, best: "f3f7", san: "Nc3" },
      { id: 2, at: T0 + 5000, type: "review.retry", gameId: "a", ply: 6, uci: "f3f7", ok: true },
      { id: 3, at: T0 + 9000, type: "review.retry", gameId: "a", ply: 6, uci: "f3f7", ok: true },
    ];
    const st = project(ev);
    a.equal(st.cards["rv:a:6"].reps, 1, "only the first try counts");
    const w = [];
    let id = 10;
    for (let i = 0; i < 5; i++) w.push({ id: ++id, at: T0 + i * 1000, type: "review.finding", gameId: "w" + i, ply: 1, motif: "fork" });
    w.push({ id: ++id, at: T0 + 8 * DAY, type: "review.finding", gameId: "x", ply: 1, motif: "fork" });
    const line = weekly(project(w), T0 + 9 * DAY);
    a.deepEqual(line, { motif: "fork", last: 5, now: 1 });
    a.equal(weekly(project([]), T0), null);
  });

  test("queue: today's lesson is 10–15 minutes, alternates reviews and the new skill, then a game", (a) => {
    const { st, now } = simulate({ steps: 120, p: 0.7, perDay: 1000 });
    const later = now + 2 * DAY;
    const p = plan(st, later);
    const t = todayOf(st, later);
    a.ok(t.left >= 10 && t.left <= 16, "planned " + t.left + " minutes");
    const whys = p.map((x) => x.why);
    a.ok(whys.includes("review") && (whys.includes("new") || whys.includes("lesson")), whys.join(" "));
    a.equal(whys.filter((w) => w === "game").length <= 1, true);
    a.ok(next(st, later), "something next");
  });

  test("queue: the minutes left today only go down as the day's items are done", (a) => {
    // a beginner's first day: rook, bishop, queen — the plan's own sum went 3 → 7 at each new lesson
    const ev = [{ id: 1, at: T0, type: "learn.place", rating: 400, how: "new" }];
    const shown = [];
    let id = 1;
    for (let i = 0; i < 12; i++) {
      const st = project(ev);
      const t = todayOf(st, T0 + i * 60000 + 1);
      if (!t.count) break;
      shown.push(t.shown);
      const n = next(st, T0 + i * 60000 + 1);
      ev.push({ id: ++id, at: T0 + i * 60000 + 1, type: "learn.answer", item: n.id, skill: n.skill, kind: n.kind, ok: true, tries: 1, revealed: false });
    }
    a.ok(shown.length >= 6, "a day of items: " + shown.join(" "));
    a.ok(shown.every((x, i) => i === 0 || x <= shown[i - 1]), "never up: " + shown.join(" "));
  });

  test("queue: the stage goal and one rating", (a) => {
    const st = project([{ id: 1, at: T0, type: "learn.place", rating: 1300, how: "often" }]);
    const s = stageOf(st, STAGES);
    a.equal(s.rating, 1500);
    a.ok(s.missing.length > 0 && s.missing.every((id) => SKILL[id].level < 1500));
    a.equal(typeof visibleRating(st), "number");
    a.equal(today(st, T0).cards, 0);
    a.ok(frontier(st).every((id) => SKILL[id].level >= 1300));
  });
}
