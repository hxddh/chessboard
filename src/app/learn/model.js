/**
 * The learner model (v20-0-plan §2 L2): a pure projection of the event
 * table. Folding the same events gives the same state, whether all at once
 * or a few at a time (scripts/app/learn-model.test.mjs), so it is never
 * stored — the learn page and 我 fold what the db holds.
 *
 * Evidence it reads:
 *   learn.place  { rating, how }                  placement: lights every skill below the rating
 *   learn.answer { item, skill, ok, tries, revealed, rating, kind, placement? }
 *   learn.game   { item, gameId }                 a targeted game was started from the queue
 *   review.finding { gameId, ply, motif, fen, best, san }   your own mistake: evidence against
 *                the motif's skills, and a review card (≤ 3 per game)
 *   review.retry { gameId, ply, ok }              the first try on that card
 *   game.start / game.end                         the game rating
 *   game.undo                                     悔棋: that game is not rated
 *   game.import { you, opp, result }              an imported game: the game rating, like one played here
 *   import.file { you, added }                    a file read; one without your name makes 我 ask 「这是你吗」
 *   library.you { name }                          the answer: the games under that name that were nobody's
 *                                                 rate as yours now (null: none of these)
 *
 * State, per skill: mastery `m` (0…1, a moving average of answers), the
 * positions solved, `lit` (has it: placed, or ≥ 3 solved and m ≥ 0.6);
 * per item: an FSRS card (learn/fsrs.js); one visible rating; the day's
 * counts (new cards ≤ 15 a day); the misses by motif for the weekly line.
 * @module learn/model
 */
import { fsrs, AGAIN, HARD, GOOD, DAY } from "./fsrs.js";
import { ChessRating } from "../core/rating.js";
import { applyMove } from "../core/rules.js";
import { SKILLS, SKILL, BY_MOTIF } from "../content/skills.js";

export const NEW_CARDS_PER_DAY = 15;
export const CARDS_PER_GAME = 3;
export const LIT_SOLVED = 3, LIT_M = 0.6, WEAK_M = 0.45;
const ALPHA = 0.3;
/** Minutes an item takes, for the day's 10–15 minute lesson. */
export const MINUTES = { lesson: 1.5, stars: 1, move: 1, line: 1.5, drill: 4, game: 10 };
/** A beginner's rating before any evidence. */
export const START_RATING = 400;
/** Items that do not become cards: the walk-the-board games teach a move, they are not facts to keep. */
const NO_CARD = new Set(["stars", "lesson", "game"]);

const dayOf = (at, tz) => Math.floor((at - tz * 60000) / DAY);

export function initialState() {
  return {
    lastId: 0, placed: null,
    puzzle: { r: START_RATING, rd: 350, vol: 0.06 }, game: null, games: 0, openGames: {}, unrated: 0, imported: 0,
    skills: {}, cards: {}, extra: {}, items: {}, days: {}, perGame: {}, misses: [], curve: [],
    // imported games whose side is not known yet: id → [white, black, whiteElo, blackElo, result]
    unclaimed: {}, ask: { file: 0, answered: 0 },
  };
}

const skillOf = (st, id) => (st.skills[id] ||= { m: 0, n: 0, solved: [], lit: false, by: null, lesson: false, at: 0, weakAt: 0 });
const dayRec = (st, d) => (st.days[d] ||= { cards: 0, minutes: 0, answers: 0, ok: 0, games: 0, items: [] });

/** The one number on screen: the puzzle rating, blended with the game rating once there are three games. */
export function visibleRating(st) {
  const p = st.puzzle.r;
  const r = st.game && st.games >= 3 ? (2 * p + st.game.r) / 3 : p;
  return Math.round(r);
}

function mark(st, at, tz) {
  const d = dayOf(at, tz), r = visibleRating(st);
  const last = st.curve[st.curve.length - 1];
  if (last && last[0] === d) last[1] = r; else st.curve.push([d, r]);
}

function light(st, id, by, at) {
  const s = skillOf(st, id);
  if (!s.lit) { s.lit = true; s.by = by; s.at = at; }
}

function addCard(st, id, at, tz, data) {
  const d = dayRec(st, dayOf(at, tz));
  if (d.cards >= NEW_CARDS_PER_DAY) return null;
  d.cards++;
  st.cards[id] = { ...fsrs.newCard(at), ...data, created: at };
  return st.cards[id];
}

const gradeOf = (e) => (e.revealed || !e.ok ? AGAIN : e.tries > 1 || e.hinted ? HARD : GOOD);

function answer(st, e, tz) {
  const d = dayRec(st, dayOf(e.at, tz));
  const kind = e.kind || "line";
  if (e.placement) return;            // a placement answer moves only the placement (learn.place)
  d.minutes += MINUTES[kind] || 1;
  d.items.push(e.item);
  if (kind === "lesson") { if (e.skill) skillOf(st, e.skill).lesson = true; return; }
  d.answers++;
  if (e.ok && !e.revealed) d.ok++;
  const g = gradeOf(e);
  const rec = (st.items[e.item] ||= { n: 0, ok: 0, last: 0 });
  rec.n++; if (g !== AGAIN) rec.ok++; rec.last = e.at;
  if (e.skill && SKILL[e.skill]) {
    const s = skillOf(st, e.skill);
    s.n++;
    s.m += ALPHA * ((g === GOOD ? 1 : g === HARD ? 0.6 : 0) - s.m);
    if (g !== AGAIN && !s.solved.includes(e.item)) s.solved.push(e.item);
    if (!s.lit && s.solved.length >= LIT_SOLVED && s.m >= LIT_M) light(st, e.skill, "practice", e.at);
    if (g === AGAIN && SKILL[e.skill].motifs[0]) st.misses.push([e.at, SKILL[e.skill].motifs[0]]);
  }
  if (Number.isFinite(e.rating)) {
    const score = g === GOOD ? 1 : g === HARD ? 0.5 : 0;
    st.puzzle = ChessRating.rate1v1(st.puzzle, { r: e.rating, rd: 100, vol: 0.01 }, score).player;
  }
  let card = st.cards[e.item];
  if (!card && !NO_CARD.has(kind)) card = addCard(st, e.item, e.at, tz, { skill: e.skill || null });
  if (card) st.cards[e.item] = { ...card, ...fsrs.review(card, g, e.at) };
}

function finding(st, e, tz) {
  if (e.motif) st.misses.push([e.at, e.motif]);
  const skills = (e.motif && BY_MOTIF[e.motif]) || [];
  for (const id of skills) {
    const s = skillOf(st, id);
    s.m += ALPHA * (0 - s.m);
    s.weakAt = e.at;
  }
  const n = st.perGame[e.gameId] || 0;
  if (n >= CARDS_PER_GAME || !e.fen || !e.best) return;
  const best = applyMove(e.fen, e.best);
  if (!best) return;
  const id = "rv:" + e.gameId + ":" + e.ply;
  if (st.cards[id]) return;
  const card = addCard(st, id, e.at, tz, { skill: skills[0] || null });
  if (!card) return;
  st.perGame[e.gameId] = n + 1;
  st.extra[id] = { id, kind: "line", mode: "mistake", skill: skills[0] || null, fen: e.fen, line: [best.san], played: e.san || null,
    side: e.fen.split(" ")[1], motif: e.motif || null, gameId: e.gameId, ply: e.ply, needs: [] };
}

function retry(st, e) {
  const id = "rv:" + e.gameId + ":" + e.ply;
  const card = st.cards[id];
  if (!card || card.retried) return;
  st.cards[id] = { ...card, ...fsrs.review(card, e.ok ? GOOD : AGAIN, e.at), retried: true };
}

function gameEnd(st, e, tz) {
  const g = st.openGames[e.gameId];
  if (!g) return;
  delete st.openGames[e.gameId];
  if (g.takeback) { st.unrated++; dayRec(st, dayOf(e.at, tz)).games++; return; }
  const score = e.result === "1/2-1/2" ? 0.5 : (e.result === "1-0") === (g.you === "w") ? 1 : 0;
  st.game ||= { r: st.puzzle.r, rd: 200, vol: 0.06 };
  st.game = ChessRating.update(st.game, [{ r: g.opp, rd: 60, score }]);
  st.games++;
  dayRec(st, dayOf(e.at, tz)).games++;
}

/**
 * An imported game (library/import.js) is a game like one played here: when
 * it is known which side was yours and how strong the other side was, its
 * result moves the game rating. It does not count towards today's games —
 * it was played some other day.
 */
const RESULTS = ["1-0", "0-1", "1/2-1/2"];
function rateImported(st, you, opp, result) {
  if (!Number.isFinite(opp) || !RESULTS.includes(result)) return false;
  const score = result === "1/2-1/2" ? 0.5 : (result === "1-0") === (you === "w") ? 1 : 0;
  st.game ||= { r: st.puzzle.r, rd: 200, vol: 0.06 };
  st.game = ChessRating.update(st.game, [{ r: opp, rd: 60, score }]);
  st.games++;
  return true;
}
function imported(st, e) {
  st.imported++;
  const you = e.you === "w" || e.you === "b" ? e.you : null;
  if (you) return rateImported(st, you, e.opp, e.result);
  // nobody's yet: kept until 「这是你吗」 names a side (library.you)
  if ((e.white || e.black) && e.gameId) st.unclaimed[e.gameId] = [e.white || "", e.black || "", e.whiteElo ?? null, e.blackElo ?? null, e.result];
  return false;
}

/**
 * 「这是你吗」 answered: every game still nobody's with that name on one side
 * is yours on that side, and rates against the other side's Elo — the
 * games a file's import could not place (v20-0-plan §10). null: none of
 * these; the question is put away until the next file without a name.
 */
function claimed(st, e) {
  st.ask.answered = e.id ?? st.ask.file;
  if (!e.name) return;
  for (const [id, [white, black, we, be, result]] of Object.entries(st.unclaimed)) {
    const you = white === e.name ? "w" : black === e.name ? "b" : null;
    if (!you) continue;
    delete st.unclaimed[id];
    rateImported(st, you, you === "w" ? be : we, result);
  }
}

/**
 * The names to offer when 我 asks 「这是你吗」: the most frequent ones among
 * the games still nobody's, with how many games each — [] when there is
 * nothing to ask (no such games, or the last file's question was answered).
 */
export function youCandidates(st, max = 4) {
  if (!(st.ask.file > st.ask.answered)) return [];
  const n = new Map();
  for (const [white, black] of Object.values(st.unclaimed)) for (const name of new Set([white, black])) if (name) n.set(name, (n.get(name) || 0) + 1);
  return [...n].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).slice(0, max).map(([name, games]) => ({ name, games }));
}

/**
 * Apply one event to `st` (mutating it; `project` gives a fresh state).
 * @param {object} st   from initialState()
 * @param {object} e    a stored event (id, at, type, …)
 * @param {{ tz?: number, opponentRating?: (id: string) => number|null }} [o]
 *        tz: minutes west of UTC (Date#getTimezoneOffset), for where a day starts
 */
export function apply(st, e, { tz = 0, opponentRating = () => null } = {}) {
  if (e.id != null) {
    if (e.id <= st.lastId) return st;     // already folded
    st.lastId = e.id;
  }
  switch (e.type) {
    case "learn.place": {
      st.placed = { rating: e.rating, how: e.how || null, at: e.at };
      st.puzzle = { r: e.rating, rd: e.how === "new" ? 350 : 150, vol: 0.06 };
      if (e.how !== "new") for (const s of SKILLS) if (s.level < e.rating) { light(st, s.id, "place", e.at); skillOf(st, s.id).m = Math.max(skillOf(st, s.id).m, 0.8); }
      break;
    }
    case "learn.answer": answer(st, e, tz); break;
    case "learn.game": { const d = dayRec(st, dayOf(e.at, tz)); d.minutes += MINUTES.game; d.items.push(e.item); break; }
    case "review.finding": finding(st, e, tz); break;
    case "review.retry": retry(st, e); break;
    case "game.start":
      if (e.mode === "engine" && e.opponent) {
        const opp = opponentRating(e.opponent);
        if (Number.isFinite(opp)) st.openGames[e.gameId] = { opp, you: e.engineColor === "w" ? "b" : "w" };
      }
      return st;
    case "game.undo":
      // 悔棋 in a rated game: the game still counts, its result does not move the rating
      if (st.openGames[e.gameId]) st.openGames[e.gameId].takeback = true;
      return st;
    case "game.end": gameEnd(st, e, tz); break;
    case "game.import": imported(st, e); break;
    case "import.file":
      // a file whose games carry names but none of them yours (library/import.js inferName)
      if (!e.you && e.added) st.ask.file = e.id ?? st.ask.answered + 1;
      return st;
    case "library.you": claimed(st, e); break;
    default: return st;
  }
  mark(st, e.at, tz);
  return st;
}

/** The model from a list of events (oldest first). */
export function project(events, o) {
  const st = initialState();
  for (const e of events) apply(st, e, o);
  return st;
}

// --- reading the state ---------------------------------------------------------------

export const isLit = (st, id) => !!(st.skills[id] && st.skills[id].lit);
/** Reached: every prerequisite is lit. */
export const isReached = (st, id) => SKILL[id].needs.every((p) => isLit(st, p));
export const mastery = (st, id) => (st.skills[id] ? st.skills[id].m : 0);
export const isWeak = (st, id) => isLit(st, id) && !!st.skills[id].weakAt && mastery(st, id) < WEAK_M;

/** Reached and not lit, the lowest level first (then the graph's order). */
export function frontier(st) {
  return SKILLS.filter((s) => !isLit(st, s.id) && isReached(st, s.id))
    .sort((a, b) => a.level - b.level || SKILLS.indexOf(a) - SKILLS.indexOf(b)).map((s) => s.id);
}

export const today = (st, now, tz = 0) => st.days[dayOf(now, tz)] || { cards: 0, minutes: 0, answers: 0, ok: 0, games: 0, items: [] };
export const dueCards = (st, now) => Object.entries(st.cards).filter(([, c]) => c.due <= now).sort((a, b) => a[1].due - b[1].due || (a[0] < b[0] ? -1 : 1)).map(([id]) => id);

/**
 * The week's line (v20-0-plan §2 L5): the motif missed most in the seven
 * days before this week, and how often this week. null when there is
 * nothing to compare.
 */
export function weekly(st, now) {
  const week = 7 * DAY;
  const count = (lo, hi) => st.misses.reduce((m, [at, k]) => (at >= lo && at < hi ? ((m[k] = (m[k] || 0) + 1), m) : m), {});
  const last = count(now - 2 * week, now - week), cur = count(now - week, now + 1);
  const top = Object.entries(last).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))[0];
  if (!top) return null;
  return { motif: top[0], last: top[1], now: cur[top[0]] || 0 };
}

/** The current stage: the first goal not yet met (rating below it or a skill it needs not lit). */
export function stageOf(st, stages) {
  const r = visibleRating(st);
  for (const g of stages) {
    const missing = g.skills.filter((id) => !isLit(st, id));
    if (r < g.rating || missing.length) return { ...g, missing, reached: false };
  }
  return { ...stages[stages.length - 1], missing: [], reached: true };
}
