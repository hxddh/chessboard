/**
 * Learning data, in and out of the app.
 *
 * The personal book, the review queue, the lesson progress, the statistics
 * and the badges are the one kind of content this app holds that nobody can
 * download again. Until 5.1 they lived in one machine's storage behind two
 * buttons that could only delete them (audit, 5.1 work package B). This module
 * is the file they travel in and the rule for bringing one back.
 *
 * Pure: bags of stored JSON in, a bag out. No storage, no DOM, no i18n. The
 * caller owns reading and writing the keys (persist.js) and re-deriving the
 * views.
 *
 * Merging is deliberately conservative — importing a file must never make the
 * book smaller or the record worse:
 *   - sets (lessons done, puzzles solved, badges seen) are unioned
 *   - lists with ids (mines, games) are unioned by id; on a clash the entry
 *     with the deeper analysis (mines) or the later timestamp (games) wins
 *   - per-id review entries (missed) keep whichever has the longer streak
 *   - counters (tally, streaks) take the larger value, never the sum — the
 *     same file imported twice must be a no-op
 *   - the repertoire merges by repertoire.js's own rules (addLines, imported
 *     rather than copied so the two cannot drift), and a `rep-` review entry
 *     whose line is not in the merged book is dropped
 * @module learning
 */
import { ChessRepertoire } from "./repertoire.js";

export const LEARNING_KIND = "chessboard-learning";
export const LEARNING_VERSION = 1;

/**
 * The keys that make up "learning data"; everything else is the game.
 *
 * `repertoire` belongs here too (7.4 D6). 7.2 put `rep-*` entries into
 * `puzzles.missed` and left the book they point at out of the file, so
 * importing on another machine brought a queue of reviews for lines that
 * machine did not have.
 */
export const LEARNING_KEYS = ["learn", "puzzles", "mines", "progress", "achievements", "stats", "repertoire"];

/**
 * @param {Record<string, string|null>} bag raw stored strings by key name
 * @param {number} now
 * @returns {object} the document to write to a file
 */
function pack(bag, now) {
  const data = {};
  for (const k of LEARNING_KEYS) {
    const raw = bag[k];
    if (raw == null) continue;
    try { data[k] = JSON.parse(raw); } catch (_) { /* a broken key is not exported */ }
  }
  return { kind: LEARNING_KIND, v: LEARNING_VERSION, exportedAt: now, data };
}

/** Is this parsed JSON a learning file this version can read? */
function isLearningDoc(doc) {
  return !!doc && doc.kind === LEARNING_KIND && Number.isInteger(doc.v) && doc.v >= 1 &&
    doc.v <= LEARNING_VERSION && doc.data && typeof doc.data === "object";
}

const obj = (x) => (x && typeof x === "object" && !Array.isArray(x) ? x : {});
const arr = (x) => (Array.isArray(x) ? x : []);
const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : 0);

function unionKeys(a, b) {
  const out = Object.assign({}, obj(a));
  for (const [k, v] of Object.entries(obj(b))) if (!(k in out)) out[k] = v;
  return out;
}

function maxCounters(a, b) {
  const out = Object.assign({}, obj(a));
  for (const [k, v] of Object.entries(obj(b))) {
    if (typeof v === "number") out[k] = Math.max(num(out[k]), v);
    else if (v && typeof v === "object" && !Array.isArray(v)) out[k] = maxCounters(out[k], v);
    else if (!(k in out)) out[k] = v;
  }
  return out;
}

function mergeLearn(cur, inc) {
  const c = obj(cur), i = obj(inc);
  return Object.assign({}, c, {
    v: Math.max(num(c.v), num(i.v)) || 1,
    done: unionKeys(c.done, i.done),
    last: Math.max(num(c.last), num(i.last)),
  });
}

function mergePuzzles(cur, inc) {
  const c = obj(cur), i = obj(inc);
  const missed = Object.assign({}, obj(c.missed));
  for (const [id, e] of Object.entries(obj(i.missed))) {
    const mine = missed[id];
    // the entry further along the review ladder wins; a tie keeps the local one
    if (!mine || num(e && e.streak) > num(mine.streak)) missed[id] = e;
  }
  return Object.assign({}, c, {
    solved: unionKeys(c.solved, i.solved),
    missed,
    tally: maxCounters(c.tally, i.tally),
  });
}

function mergeMines(cur, inc, maxMines) {
  const c = obj(cur), i = obj(inc);
  const byId = new Map();
  for (const m of arr(c.list)) if (m && m.id) byId.set(m.id, m);
  for (const m of arr(i.list)) {
    if (!m || !m.id) continue;
    const have = byId.get(m.id);
    const deeper = (x) => (x && x.rev ? num(x.rev.budget) : 0);
    if (!have || deeper(m) > deeper(have)) byId.set(m.id, m);
  }
  let list = [...byId.values()].sort((a, b) => num(a.t) - num(b.t));
  if (list.length > maxMines) list = list.slice(list.length - maxMines);
  return Object.assign({}, c, { v: Math.max(num(c.v), num(i.v)) || 1, list });
}

function mergeStats(cur, inc) {
  const c = obj(cur), i = obj(inc);
  const byId = new Map();
  for (const g of arr(c.games)) if (g && g.id) byId.set(g.id, g);
  for (const g of arr(i.games)) {
    if (!g || !g.id) continue;
    const have = byId.get(g.id);
    if (!have || num(g.t) > num(have.t)) byId.set(g.id, g);
  }
  const games = [...byId.values()].sort((a, b) => num(a.t) - num(b.t));
  return Object.assign({}, c, { v: Math.max(num(c.v), num(i.v)) || 1, games });
}

function mergeAchievements(cur, inc) {
  const c = obj(cur), i = obj(inc);
  return Object.assign({}, c, { seen: [...new Set(arr(c.seen).concat(arr(i.seen)))] });
}

/**
 * Two books into one, side by side, through the book's own merge: a line
 * already here is kept with its id (and so its progress), a deeper line
 * replaces the shorter one it extends, the cap holds. The incoming names
 * ride along — addLines asks for a name only for lines it adds.
 */
function mergeRepertoire(cur, inc) {
  const c = obj(cur), i = obj(inc);
  const out = { v: 1 };
  for (const side of ["w", "b"]) {
    const ok = (l) => l && typeof l.id === "string" && typeof l.sans === "string" && l.sans;
    const mine = arr(c[side]).filter(ok);
    const theirs = arr(i[side]).filter(ok);
    const named = new Map(theirs.map((l) => [l.sans, l]));
    const nameOf = (sans) => {
      const l = named.get(sans);
      return l && l.eco ? { eco: l.eco, name: l.name || "" } : null;
    };
    out[side] = ChessRepertoire.addLines(mine, theirs.map((l) => l.sans), nameOf).lines;
  }
  return out;
}

/** Every drill id a book can serve — the `:b` suffix is the black chair's. */
function repIds(book) {
  const b = obj(book);
  const ids = new Set();
  for (const l of arr(b.w)) if (l && l.id) ids.add(l.id);
  for (const l of arr(b.b)) if (l && l.id) ids.add(l.id + ":b");
  return ids;
}

function mergeProgress(cur, inc) {
  // days practised is a set of day keys; streak-like counters take the max
  const c = obj(cur), i = obj(inc);
  const out = maxCounters(c, i);
  if (Array.isArray(c.days) || Array.isArray(i.days)) out.days = [...new Set(arr(c.days).concat(arr(i.days)))].sort();
  return out;
}

/**
 * @param {Record<string, string|null>} bag current raw stored strings
 * @param {object} doc a parsed learning file (isLearningDoc must hold)
 * @param {number} maxMines the personal book's cap
 * @returns {Record<string, object>} merged values by key, ready for setJson
 */
function merge(bag, doc, maxMines) {
  const parse = (raw) => { try { return raw == null ? null : JSON.parse(raw); } catch (_) { return null; } };
  const d = doc.data;
  const out = {};
  const each = { learn: mergeLearn, puzzles: mergePuzzles, stats: mergeStats, achievements: mergeAchievements,
    progress: mergeProgress, repertoire: mergeRepertoire };
  for (const k of LEARNING_KEYS) {
    if (!(k in d)) continue;
    const cur = parse(bag[k]);
    out[k] = k === "mines" ? mergeMines(cur, d[k], maxMines) : each[k](cur, d[k]);
  }
  // A `rep-` review is owed to a line in a book. After the merge, the book is
  // the merged one (or this machine's, when the file carried none — a 7.3
  // export); an entry nothing in it can serve is dropped rather than counted
  // for ever by `owedNow()`. `solved` gets the same filter, as forgetDrills()
  // does on the app's own paths: a line the merge replaced or evicted keeps
  // no "solved" mark, or re-importing it later would show it done unpractised.
  const puzzles = out.puzzles || (out.repertoire ? parse(bag.puzzles) : null);
  if (puzzles) {
    const ids = repIds(out.repertoire || parse(bag.repertoire));
    const keep = (m) => {
      const kept = {};
      for (const [id, e] of Object.entries(obj(m))) {
        if (!id.startsWith("rep-") || ids.has(id)) kept[id] = e;
      }
      return kept;
    };
    out.puzzles = Object.assign({}, puzzles, { missed: keep(puzzles.missed), solved: keep(puzzles.solved) });
  }
  return out;
}

export const ChessLearning = { LEARNING_KIND, LEARNING_VERSION, LEARNING_KEYS, pack, isLearningDoc, merge };
