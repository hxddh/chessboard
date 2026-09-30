/**
 * The opponents (v8-0-plan B4): the ladder's ratings, the named personas that
 * package a rung with a style, the engine's clock plan, when it resigns and
 * when it offers a draw, and the player's own rating against all of that.
 *
 * Pure — numbers and ids in, numbers and ids out. The app (app.js,
 * opponents-ui.js) and the calibration harness (scripts/test-ladder.mjs) both
 * read the rules from here, so a calibration game ends the way an app game
 * ends and the ratings the dialog shows are the ones the harness measured.
 * @module opponents
 */
import { ChessRating } from "./rating.js";

/** The rungs, weakest first. Every id has a row in engine.js TIERS. */
const LEVELS = ["beginner", "casual", "learner", "improver", "steady", "solid", "easy", "easyplus", "normalminus", "normal", "hard", "extreme"];

/**
 * Each rung's rating, and how sure the fit is about it (±, one standard
 * error). From a round-robin of all rungs against each other in node
 * Stockfish, fitted as Bradley–Terry by maximum likelihood and put on the
 * familiar scale by two anchors: 初级 = 1320 and 中级 = 1700, the two UCI_Elo
 * numbers the app shipped with. docs/measured.json `ladder` has the games and
 * the fit; scripts/test-chess.mjs fails if these stop agreeing with it.
 */
const RATING = {
  beginner: 70, casual: 266, learner: 409, improver: 608, steady: 752, solid: 941,
  easy: 1320, easyplus: 1418, normalminus: 1662, normal: 1700, hard: 1994, extreme: 2633,
};
const RATING_SE = {
  beginner: 0, casual: 23, learner: 24, improver: 26, steady: 28, solid: 31,
  easy: 95, easyplus: 106, normalminus: 119, normal: 126, hard: 144, extreme: 238,
};

/**
 * v8-1-plan T1: which ladder a game was rated against. 8.1 re-stepped the
 * ladder and fitted every rung again, so the same id can stand for another
 * number now. A game is scored against the ratings of the ladder it was
 * played on: a record filed from 8.1 on carries `lad`, and one without it
 * is 8.0's and keeps 8.0's numbers — a profile replayed from its games
 * (rateHistory) comes out exactly where it stood.
 */
const LADDER = 2;
const RATING_80 = {
  beginner: 70, casual: 266, learner: 409, improver: 608, steady: 752, solid: 941,
  easy: 1320, easyplus: 1418, normalminus: 1662, normal: 1700, hard: 1994, extreme: 2633,
};
const RATING_SE_80 = {
  beginner: 0, casual: 23, learner: 24, improver: 26, steady: 28, solid: 31,
  easy: 95, easyplus: 106, normalminus: 119, normal: 126, hard: 144, extreme: 238,
};

/**
 * The personas: one per rung, each with a style from persona.js and an icon
 * from icons.js. The name, the opening line and the end-of-game line are
 * i18n keys (`op.<id>.name` / `.hello` / `.bye`); 7.8's rule holds for the
 * lines — they state facts (the style, the opening played), never a
 * judgement of the player or a feeling of the machine.
 *
 * Styles sit on the win-chance rungs only. There a style is a lean inside
 * the rung's own draw and the round-robin kept the rung's step; on a UCI_Elo
 * rung it has to overrule the engine's pick, and measured both ways it moved
 * the rung by hundreds of points (~+450 choosing near the best line, ~−500
 * held to moves no better than the engine's own). A persona's rating has to
 * be its rung's, so those personas play plain; every style is still one
 * 自定义 click away on any rung.
 */
const PERSONAS = [
  { id: "pip", level: "beginner", style: "off", icon: "puzzle" },
  { id: "tomo", level: "casual", style: "off", icon: "hourglass" },
  { id: "lina", level: "learner", style: "principled", icon: "book-open" },
  { id: "kai", level: "improver", style: "attacker", icon: "flame" },
  { id: "ada", level: "steady", style: "off", icon: "target" },
  { id: "remy", level: "solid", style: "principled", icon: "scale" },
  { id: "juno", level: "skilled", style: "off", icon: "lightbulb" },
  { id: "ben", level: "easy", style: "off", icon: "graduation-cap" },
  { id: "nico", level: "easyplus", style: "off", icon: "coins" },
  { id: "vera", level: "normalminus", style: "off", icon: "swords" },
  { id: "sol", level: "normal", style: "off", icon: "star" },
  { id: "leo", level: "normalplus", style: "off", icon: "zap" },
  { id: "max", level: "hard", style: "off", icon: "crown" },
  { id: "iris", level: "hardplus", style: "off", icon: "eye" },
  { id: "otto", level: "expert", style: "off", icon: "medal" },
  { id: "fish", level: "extreme", style: "off", icon: "bot" },
];


/**
 * Names for the PGN tag, one per rung. This was a hand-written object that
 * predated the 1.19 "casual" rung and never grew one, so a casual game
 * exported as "Stockfish 19 (casual)" — the raw id leaking into a file other
 * programs read. The self-check requires an entry here for every rung.
 */
const EN_NAME = {
  beginner: "Beginner", casual: "Casual", learner: "Practice", improver: "Improving", steady: "Steady",
  solid: "Solid", easy: "Easy", easyplus: "Easy+", normalminus: "Normal-", normal: "Normal", hard: "Hard", extreme: "Max",
};

function personaById(id) { return PERSONAS.find((p) => p.id === id) || null; }
/** The persona a (rung, style) pair is, or null for a combination of one's own. */
function personaFor(level, style) {
  return PERSONAS.find((p) => p.level === level && p.style === (style || "off")) || null;
}
function ratingOf(level) { return Number.isFinite(RATING[level]) ? RATING[level] : null; }

// --- the clock -----------------------------------------------------------

/** engine.js NODES_PER_MS (test-chess holds the two equal): node counts as time. */
const NODES_PER_MS = 450;
/** Share of the remaining clock one move may use, plus most of the increment. */
const MOVES_TO_GO = 40;
/**
 * The longest a reply may take by the wall clock in a timed game. A rung is
 * calibrated at its own movetime, so the search never runs past that (it
 * would be a stronger opponent than the rating says — the drift the plan
 * warns about); what grows with a long control is the pace, up to this.
 */
const PACE_CAP_MS = 3000;

/**
 * How long the engine searches and how long its reply takes, on a clock.
 *
 * Through 7.9 the budget was `clock / 30` and it only ever shortened a search,
 * so the engine answered a 10-minute game as fast as a 3-minute one and
 * spent almost none of its clock. Now the allocation is the remaining time
 * over 40 plus three quarters of the increment; the search takes the
 * allocation up to the rung's calibrated movetime, and the reply is paced to
 * the allocation up to PACE_CAP_MS — so a long control is played at a human
 * tempo by an opponent exactly as strong as its rating.
 *
 * @param {object} tier   engine.js TIERS row
 * @param {number} clockMs the engine's remaining time
 * @param {number} incMs   increment per move
 * @returns {{search: number, pace: number}} milliseconds
 */
function thinkPlan(tier, clockMs, incMs) {
  const alloc = Math.max(0, clockMs) / MOVES_TO_GO + 0.75 * Math.max(0, incMs || 0);
  // (v8-1-plan T1: a node rung's calibrated search is its count, in engine.js's ms)
  const cap = tier && tier.movetime ? tier.movetime : tier && tier.nodes ? Math.round(tier.nodes / NODES_PER_MS) : 0;
  const search = cap ? Math.max(120, Math.min(cap, alloc)) : 0;
  // never pace a reply past what the clock can afford: under ten seconds the
  // allocation is already small, and a flag lost to a pause would be absurd
  const pace = Math.round(Math.max(tier && tier.depth ? 120 : 0, Math.min(PACE_CAP_MS, alloc / 2)));
  return { search: Math.round(search), pace: Math.min(pace, Math.max(0, clockMs / 20)) };
}

// --- resigning and offering a draw ---------------------------------------

/** A position the engine's own search calls this lost, three moves running. */
const RESIGN_CP = 1000;
const RESIGN_RUN = 3;
/** A mate against it, found twice running. */
const MATED = 100000 - 200;
/** Not before this many of its own moves: an early swing is not a verdict. */
const RESIGN_AFTER = 10;

/**
 * Should the engine resign? `scores` are its own evaluations after its last
 * moves (engine.js bestMove `.score`, side-to-move = the engine), oldest
 * first. Sustained, not momentary: a shallow rung sees a phantom −1000 in a
 * tactic it half-reads and then finds the way out.
 */
function shouldResign(scores) {
  const s = (scores || []).filter((x) => Number.isFinite(x));
  if (s.length < RESIGN_AFTER) return false;
  const last = (n) => s.slice(-n);
  if (last(2).length === 2 && last(2).every((x) => x <= -MATED)) return true;
  return last(RESIGN_RUN).every((x) => x <= -RESIGN_CP);
}

/** Dead level: the engine's eval within this, this many moves running… */
const DRAW_CP = 20;
const DRAW_RUN = 8;
/** …late enough that it is an ending, not a quiet opening… */
const DRAW_AFTER_PLY = 60;
/** …and nothing has changed on the board for this many plies. */
const DRAW_QUIET_PLIES = 10;
/** After an offer is declined, not again for this many plies. */
const DRAW_AGAIN_PLIES = 20;

/**
 * Should the engine offer a draw? Only in a dead-level position: its own
 * eval flat at 0 for eight moves, past move 30, and no capture or pawn move
 * for five moves (the halfmove clock) — shuffling, not playing.
 *
 * @param {number[]} scores its own evaluations, oldest first
 * @param {number} ply plies played
 * @param {number} halfmove the FEN's halfmove clock
 * @param {number|null} lastOfferPly when it last offered, or null
 */
function shouldOfferDraw(scores, ply, halfmove, lastOfferPly) {
  const s = (scores || []).filter((x) => Number.isFinite(x));
  if (ply < DRAW_AFTER_PLY || s.length < DRAW_RUN) return false;
  if (!(halfmove >= DRAW_QUIET_PLIES)) return false;
  if (lastOfferPly != null && ply - lastOfferPly < DRAW_AGAIN_PLIES) return false;
  return s.slice(-DRAW_RUN).every((x) => Math.abs(x) <= DRAW_CP);
}

/** The engine takes a draw the player offers unless it is ahead by this. */
const ACCEPT_CP = 60;
function acceptsDraw(engineCp) { return engineCp == null || engineCp < ACCEPT_CP; }

// --- your rating -----------------------------------------------------------

/**
 * The rung's rating as an opponent in Glicko-2: its point estimate, and a
 * deviation no smaller than 30 — the fit's own error, floored so one game is
 * never scored against an opponent the maths treats as exactly known.
 */
function opponentOf(level, lad) {
  // an 8.0 game (no `lad`) against a rung 8.0 had: 8.0's numbers
  const old = lad == null && Number.isFinite(RATING_80[level]);
  const r = old ? RATING_80[level] : ratingOf(level);
  if (r == null) return null;
  return { r, rd: Math.max(30, (old ? RATING_SE_80 : RATING_SE)[level] || 0) };
}

const SCORE = { win: 1, draw: 0.5, loss: 0 };

/**
 * The player's engine-game rating after one more game. A separate rating
 * from the puzzle one: solving and playing are different skills, and a
 * number that mixed them would be neither. Idle time widens the deviation
 * the same way it does for puzzles (rating.js decayIdle).
 *
 * @param {{r,rd,vol,at?}|null} rating stored rating, or null for a newcomer
 * @param {string} level the rung played
 * @param {"win"|"draw"|"loss"} result
 * @param {number} now ms
 * @param {number} [lad] the record's ladder (none: 8.0's)
 * @returns {{r,rd,vol,at,n}|null} null when the game does not count
 */
function rateGame(rating, level, result, now, lad) {
  const opp = opponentOf(level, lad);
  if (!opp || !(result in SCORE)) return null;
  let cur = rating && Number.isFinite(rating.r) ? rating : ChessRating.newRating();
  const days = rating && rating.at ? (now - rating.at) / 86400000 : 0;
  if (days > 0) cur = ChessRating.decayIdle(cur, days);
  const next = ChessRating.update(cur, [{ r: opp.r, rd: opp.rd, score: SCORE[result] }]);
  return { r: next.r, rd: next.rd, vol: next.vol, at: now, n: ((rating && rating.n) || 0) + 1 };
}

/**
 * Performance rating over some games: the rating at which the expected
 * score against these opponents equals the score made (the FIDE definition,
 * solved rather than read off the table). Clamped 400 above the strongest
 * and below the weakest opponent, so 5/5 is a number and not infinity.
 *
 * @param {Array<{level: string, result: string, lad?: number}>} games
 * @returns {number|null}
 */
function performance(games) {
  const g = (games || []).filter((x) => opponentOf(x.level, x.lad) && x.result in SCORE);
  if (!g.length) return null;
  const opp = g.map((x) => opponentOf(x.level, x.lad).r);
  const score = g.reduce((a, x) => a + SCORE[x.result], 0);
  const lo = Math.min(...opp) - 400, hi = Math.max(...opp) + 400;
  const expected = (r) => opp.reduce((a, o) => a + 1 / (1 + Math.pow(10, (o - r) / 400)), 0);
  if (score <= expected(lo)) return Math.round(lo);
  if (score >= expected(hi)) return Math.round(hi);
  let a = lo, b = hi;
  for (let i = 0; i < 60; i++) {
    const m = (a + b) / 2;
    if (expected(m) < score) a = m; else b = m;
  }
  return Math.round((a + b) / 2);
}

/** How many recent games against a rung the move-up advice looks at. */
const ADVICE_GAMES = 5;
/**
 * Move up, move down, or stay: a rung the player scores 70%+ against over
 * the last five games is too easy, 25% or less too hard. The rating agrees
 * or the advice is not given — a lucky streak against a rung the rating
 * says is well above the player is a streak, not a level.
 *
 * @param {Array<{level: string, result: string}>} recent games, oldest first
 * @param {string} level the current rung
 * @param {{r:number, rd:number}|null} rating the player's rating
 * @returns {"up"|"down"|null}
 */
function advice(recent, level, rating) {
  const i = LEVELS.indexOf(level);
  if (i < 0) return null;
  const mine = (recent || []).filter((x) => x.level === level && x.result in SCORE).slice(-ADVICE_GAMES);
  if (mine.length < ADVICE_GAMES) return null;
  const pct = mine.reduce((a, x) => a + SCORE[x.result], 0) / mine.length;
  const r = ratingOf(level);
  const mineR = rating && Number.isFinite(rating.r) ? rating.r : null;
  if (pct >= 0.7 && i < LEVELS.length - 1 && (mineR == null || mineR >= r)) return "up";
  if (pct <= 0.25 && i > 0 && (mineR == null || mineR <= r)) return "down";
  return null;
}

/**
 * The rating a history of engine games adds up to, oldest first — how a
 * profile that played before v8-0-plan B4 gets its number: its own games, replayed.
 * A stored rating is not derived again; this runs only when there is none.
 *
 * @param {Array<{t:number, diff:string, result:string}>} games stats records
 * @returns {{r,rd,vol,at,n}|null} null when none of them counts
 */
function rateHistory(games) {
  let r = null;
  for (const g of (games || []).slice().sort((a, b) => (a.t || 0) - (b.t || 0))) {
    if (g.unrated) continue; // recorded, not rated (#89 review: opponents-lazy.js opponent)
    const next = rateGame(r, g.diff, g.result, g.t || 0, g.lad);
    if (next) r = next;
  }
  return r;
}

/**
 * File one finished game into the stats record's rating (v8-0-plan B4):
 * the rating before and after, what the last ten games perform at, and the
 * move-up / move-down advice for the rung just played. `stats` is changed
 * in place — its `rating` — and the game record gains `rb` (before),
 * `ra` (after) and `perf` (the shape the progress page reads).
 *
 * @returns {{before: ?object, after: object, perf: ?number, advice: ?string}|null}
 */
function fileRating(stats, rec, now) {
  if (!stats || !rec) return null;
  // only the games before this one: a game filed late (the chunk was still
  // loading) may already have later games after it in the list (Codex #89)
  if (rec.unrated) return null; // recorded, not rated (#89 review)
  const games = stats.games || [];
  const at = games.indexOf(rec);
  // …and the unrated ones before it are no part of its performance or advice
  const prior = (at >= 0 ? games.slice(0, at) : games).filter((g) => !g.unrated);
  const before = validRating(stats.rating) ? stats.rating : rateHistory(prior);
  // filed now: against today's ladder, and it says so for any later replay
  if (rec.lad == null) rec.lad = LADDER;
  const after = rateGame(before, rec.diff, rec.result, now, rec.lad);
  if (!after) return null;
  stats.rating = after;
  // the rating series 「我的」 draws: each engine game carries the rating it
  // left the player on and the performance of the ten games up to it
  const recent = prior.slice(-(PERF_GAMES - 1)).concat([rec])
    .map((g) => ({ level: g.diff, result: g.result, lad: g.lad }));
  const perf = performance(recent);
  rec.rb = before ? Math.round(before.r) : null;
  rec.ra = Math.round(after.r);
  rec.perf = perf;
  // the advice reads this rung's own last games, however many others came between (Codex #89)
  const rung = prior.filter((g) => g.diff === rec.diff).slice(-(ADVICE_GAMES - 1)).concat([rec])
    .map((g) => ({ level: g.diff, result: g.result }));
  return { before, after, perf, advice: advice(rung, rec.diff, after) };
}
/** How many recent games the performance rating is taken over. */
const PERF_GAMES = 10;

/** A stored rating that can be used as one (persist.js vets the same shape). */
function validRating(r) {
  return !!r && typeof r === "object" && [r.r, r.rd, r.vol].every((x) => Number.isFinite(x)) &&
    r.rd > 0 && r.vol > 0;
}

/**
 * The player's engine-game rating from a stats record: the stored one, or —
 * for a profile from before v8-0-plan B4 that has games and no rating yet — its games
 * replayed (remembered, so a repaint does not replay 500 games).
 */
let memo = { games: null, n: -1, r: null };
function ratingOfStats(stats) {
  if (!stats) return null;
  if (validRating(stats.rating)) return stats.rating;
  const g = Array.isArray(stats.games) ? stats.games : [];
  if (memo.games !== g || memo.n !== g.length) memo = { games: g, n: g.length, r: rateHistory(g) };
  return memo.r;
}

/**
 * v8-1-plan T1: the new-game dialog shows the personas a segment at a time —
 * 入门 / 进阶 / 高手 — each the rungs from its first one up to the next
 * segment's first. 入门 is the hand-weakened rungs (they play a step below
 * UCI_Elo's floor); 进阶 starts at 初级, the first Stockfish-limited rung.
 */
const SEGMENTS = [null, "easy", "hard"]; // where each starts (the first at the bottom)
function segmentOf(level) {
  const i = LEVELS.indexOf(level);
  let seg = 0;
  SEGMENTS.forEach((id, k) => { if (id && i >= LEVELS.indexOf(id)) seg = k; });
  return seg;
}

/** The persona one rung up or down from `level`. */
function neighbour(level, dir) {
  const i = LEVELS.indexOf(level) + (dir === "up" ? 1 : -1);
  if (i < 0 || i >= LEVELS.length) return null;
  return PERSONAS.find((p) => p.level === LEVELS[i]) || null;
}

export const Opponents = {
  LEVELS, RATING, RATING_SE, LADDER, RATING_80, PERSONAS, EN_NAME, PACE_CAP_MS, NODES_PER_MS,
  personaById, personaFor, ratingOf, thinkPlan, shouldResign, shouldOfferDraw, acceptsDraw,
  opponentOf, rateGame, rateHistory, fileRating, validRating, ratingOfStats, performance, advice, neighbour,
  SEGMENTS, segmentOf,
};
