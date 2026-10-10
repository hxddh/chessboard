/**
 * 今天的训练 — the coach's lesson plan for one sitting.
 *
 * Every signal this reads already existed: the review queue knows what is
 * owed, the personal book (mistakes.js) knows what was blundered, the tally
 * knows the weak category, the course knows the next lesson, the stats know
 * whether a game was played today. What did not exist was anyone reading
 * them *together*: each surface answered its own question and "what should
 * these fifteen minutes be" stayed the player's homework. This module is
 * that reading, in a fixed and explainable order:
 *
 *   1. review — debts first, always. Unfinished business beats novelty
 *      (the picker's own first rule, applied to the session).
 *   2. mine   — your own blunders next: the highest-value content the app
 *      holds, and the whole point of banking them.
 *   3. weak   — two puzzles in the tally's worst category.
 *   4. lib    — analyse what the library still owes. 7.1 added it because
 *      the library is where steps 2 and 3 get their content from: an
 *      imported archive nobody ever presses 分析 on is a folder, not a
 *      coach. It is the one step that asks for time rather than answers.
 *   5. lesson / opening — forward motion: the next unfinished lesson, or an
 *      unsolved opening line when the course is done.
 *   6. game   — play, if today has had none. Training that never becomes a
 *      game is the opening-trainer mistake all over again.
 *
 * v10-0-plan T5: the sitting is at most `MAX_STEPS` of these, taken in the
 * order above with the repertoire's due moves (`repdue`) between the
 * weakness and the library — what is owed before what is new — and a
 * brand-new profile (`fresh`: nothing played, solved or learnt yet) is
 * given the first lesson alone, not a list of things it has no reason to
 * know about yet.
 *
 * A step only exists when its source has something to serve (P3 in time:
 * an inapplicable step is not listed). The plan never grabs the wheel —
 * the caller renders it as an invitation, exactly like 为你出一题.
 *
 * Pure: signals in, steps out; completion is judged on before/after
 * snapshots the caller takes. No store, no DOM, no i18n, no clock.
 * @module planner
 */

/** How much of each thing one sitting asks for. */
const DOSE = { review: 3, mine: 2, weak: 2, rep: 5, focusOne: 1 };

/** v10-0-plan T5: a sitting is a short list — three things, each one line. */
const MAX_STEPS = 3;

/**
 * Compose the sitting from the signals.
 *
 * @param {object} sig {
 *   owed: number,          // review queue length
 *   mineUnsolved: number,  // unsolved personal drills
 *   weakCat: string|null,  // Picker.weakest().cat, if any
 *   weakMotif: string|null,// Picker.weakestMotif().motif, if any (5.2)
 *   libMotif: string|null, // what the library diagnosis says catches you (7.1)
 *   libQueued: number,     // imported games still waiting to be analysed (7.1)
 *   lessonNext: number,    // index of first unfinished lesson, or -1
 *   opUnsolved: boolean,   // any unsolved opening line (either chair)
 *   playedToday: boolean,  // a game was played today, here or elsewhere
 *   repDue: number,        // repertoire moves due today (T5)
 *   fresh: boolean,        // nothing played, solved or learnt yet (T5)
 *   placed: boolean,       // placed on first run and no game played yet (T1)
 *   focus: object|null,    // this week's first unfinished focus item, with `at` (T3)
 * }
 * @returns {{steps: Array<{kind: string, cat?: string, n?: number, i?: number}>}}
 */
function plan(sig) {
  // v10-0-plan T1: someone the placement just matched with an opponent is
  // asked to play them first — what they said they came for
  if (sig.placed) return { steps: [{ kind: "game" }].concat(plan(Object.assign({}, sig, { placed: false, fresh: false, playedToday: true })).steps).slice(0, MAX_STEPS) };
  if (sig.fresh && sig.lessonNext >= 0) return { steps: [{ kind: "lesson", i: sig.lessonNext }] };
  const steps = [];
  if (sig.owed > 0) steps.push({ kind: "review", n: Math.min(sig.owed, DOSE.review) });
  if (sig.mineUnsolved > 0) steps.push({ kind: "mine", n: Math.min(sig.mineUnsolved, DOSE.mine) });
  // the weak step repeats what review/mine already cover only when the weak
  // category is a real third thing — a session of three copies of one idea
  // is one idea, not a session
  // v10-0-plan T3: this week's focus is the sharpest statement of all — what
  // the player's own games say, made into a week's work — and takes the
  // weakness step's place; a sitting does a dose of it, not the whole week
  if (sig.focus) steps.push({ kind: "focus", item: sig.focus, n: Math.min(DOSE[sig.focus.kind === "motif" ? "weak" : "focusOne"], sig.focus.n - (sig.focus.at || 0)) });
  // 5.2: a motif the player keeps missing is the sharper statement of the
  // same weakness — it replaces the shelf step rather than joining it, so
  // the sitting still says one thing about weakness
  else if (sig.weakMotif) steps.push({ kind: "motif", motif: sig.weakMotif, n: DOSE.weak });
  // 7.1: failing that, what the player's OWN GAMES say catches them. The
  // puzzle tally only knows the puzzles they have attempted here, so someone
  // who imported an archive and has answered nothing yet — the exact person
  // the library is for — used to get no weakness step at all. A diagnosis
  // drawn from twenty real games is the better evidence anyway; it is second
  // only because the tally measures answers this app watched.
  else if (sig.libMotif) steps.push({ kind: "motif", motif: sig.libMotif, n: DOSE.weak, from: "lib" });
  else if (sig.weakCat && sig.weakCat !== "mine") steps.push({ kind: "weak", cat: sig.weakCat, n: DOSE.weak });
  if (sig.repDue > 0) steps.push({ kind: "repdue", n: Math.min(sig.repDue, DOSE.rep) });
  if (sig.libQueued > 0) steps.push({ kind: "lib", n: sig.libQueued });
  if (sig.lessonNext >= 0) steps.push({ kind: "lesson", i: sig.lessonNext });
  else if (sig.opUnsolved) steps.push({ kind: "op" });
  if (!sig.playedToday) steps.push({ kind: "game" });
  return { steps: steps.slice(0, MAX_STEPS) };
}

/**
 * Snapshot the completion-relevant counters. The caller takes one of these
 * when a step starts and again when asked "is it done"; the judgement below
 * compares the two. Counters, not events — no wiring into every solve path.
 *
 * @param {object} src {
 *   owed: number,               // review queue length
 *   byCat: {cat: attempts},     // lifetime tally attempts per category
 *   byMotif: {motif: attempts}, // lifetime motif tally attempts (5.2)
 *   lessonsDone: number,
 *   opSolved: number,           // solved opening drills, both chairs
 *   games: number,              // recorded games
 * }
 */
function snap(src) {
  return {
    owed: src.owed,
    byCat: Object.assign({}, src.byCat || {}),
    byMotif: Object.assign({}, src.byMotif || {}),
    lessonsDone: src.lessonsDone,
    opSolved: src.opSolved,
    repDue: src.repDue || 0,
    focus: Object.assign({}, src.focus || {}),
    games: src.games,
    libAnalysed: src.libAnalysed || 0,
  };
}

/**
 * Has this step been earned since `before`?
 *
 * Deliberately generous where the sources move on their own: the review
 * queue can shrink below the dose because SRS graduated something — an
 * empty queue completes the step regardless of how it emptied. Every rule
 * is a counter delta, so abandoning the session mid-step costs nothing and
 * fakes nothing.
 */
function stepDone(step, before, after) {
  const dcat = (c) => (after.byCat[c] || 0) - (before.byCat[c] || 0);
  const dall = (s) => Object.values(s.byCat).reduce((n, x) => n + x, 0);
  switch (step.kind) {
    // answers given in the review queue land in each puzzle's own category,
    // and one clean solve does not graduate a puzzle (SRS wants two) — so
    // `owed` barely moves during honest work. The dose is therefore counted
    // in answers, anywhere; an emptied queue completes the step regardless.
    case "review": return after.owed === 0 || dall(after) - dall(before) >= step.n;
    case "mine": return dcat("mine") >= step.n;
    case "weak": return dcat(step.cat) >= step.n;
    case "motif": return ((after.byMotif || {})[step.motif] || 0) - ((before.byMotif || {})[step.motif] || 0) >= step.n;
    case "lesson": return after.lessonsDone > before.lessonsDone;
    case "op": return after.opSolved > before.opSolved;
    // the due moves are graded one by one; the step is done when the dose
    // has gone out of the queue, or the queue is empty
    case "focus": { const k = focusKey(step.item); return ((after.focus || {})[k] || 0) - ((before.focus || {})[k] || 0) >= step.n; }
    case "repdue": return after.repDue === 0 || before.repDue - after.repDue >= step.n;
    case "game": return after.games > before.games;
    // one analysed game completes it: the pass runs for as long as the player
    // leaves it running, and a step that only ticks when the whole queue is
    // empty would stay unfinished for an hour
    case "lib": return after.libAnalysed > before.libAnalysed;
    default: return false;
  }
}

/** A focus item's key in snap().focus — the counters' progress on it. */
function focusKey(it) { return it.kind + ":" + (it.motif || it.family || ""); }

export const ChessPlanner = { DOSE, MAX_STEPS, plan, snap, stepDone, focusKey };
