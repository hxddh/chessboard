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

/** Is srs.js entry `a` further up the review ladder than `b`? (rung, then answers) */
function further(a, b) {
  const sa = num(a && a.s), sb = num(b && b.s);
  return sa > sb || (sa === sb && num(a && a.n) > num(b && b.n));
}

function mergeLearn(cur, inc) {
  const c = obj(cur), i = obj(inc);
  const out = Object.assign({}, c, {
    v: Math.max(num(c.v), num(i.v)) || 1,
    done: unionKeys(c.done, i.done),
    last: Math.max(num(c.last), num(i.last)),
  });
  // v8-1-plan T2: the endgame camp rides in the same key. Done is a union;
  // a review entry further up the srs.js ladder wins, a tie keeps the local
  // one (as mergePuzzles does with `missed`). M3 评审: an endgame done here
  // with no review entry left has graduated out of the queue — an older
  // file's entry for it is not brought back.
  if (c.eg || i.eg) {
    const ce = obj(c.eg), ie = obj(i.eg);
    const srs = Object.assign({}, obj(ce.srs));
    const graduated = (id) => id in obj(ce.done) && !(id in obj(ce.srs));
    for (const [id, e] of Object.entries(obj(ie.srs))) {
      if (graduated(id)) continue;
      if (!srs[id] || further(e, srs[id])) srs[id] = e;
    }
    out.eg = Object.assign({}, ce, { done: unionKeys(ce.done, ie.done), srs });
  }
  // v8-2-plan T3 (M2 review): 名局猜着's last result per game and side, the
  // later one (`at`) winning — it is a record of the last try, not a best
  if (c.gs || i.gs) {
    const gs = Object.assign({}, obj(c.gs));
    for (const [id, r] of Object.entries(obj(i.gs))) {
      const m = gs[id] = Object.assign({}, obj(gs[id]));
      for (const [side, x] of Object.entries(obj(r))) if (!m[side] || num(obj(x).at) > num(m[side].at)) m[side] = x;
    }
    out.gs = gs;
  }
  return out;
}

/** Review queues by id: the entry further up the ladder wins, a tie keeps the local one. */
function mergeQueue(cur, inc) {
  const q = Object.assign({}, obj(cur));
  // M3 评审: srs.js entries are {s, n, due, ivl} — the old compare read a
  // `streak` no entry has, so the local entry always won
  for (const [id, e] of Object.entries(obj(inc))) if (!q[id] || further(e, q[id])) q[id] = e;
  return q;
}

function mergePuzzles(cur, inc) {
  const c = obj(cur), i = obj(inc);
  const out = Object.assign({}, c, {
    solved: unionKeys(c.solved, i.solved),
    missed: mergeQueue(c.missed, i.missed),
    tally: maxCounters(c.tally, i.tally),
  });
  // v8-1-plan T6: a queued bank puzzle's band travels with its entry
  // (trainer/bank-review.js); without it the review can only guess the band
  if (c.bank || i.bank) out.bank = unionKeys(c.bank, i.bank);
  // v8-2-plan T2 (M2 review): 看 N 步 / 盲走 per mode — the rating of the
  // later record (`at`), the larger counts, and the review queue as `missed`
  if (c.vis || i.vis) {
    const vis = out.vis = Object.assign({}, obj(c.vis));
    for (const [k, b] of Object.entries(obj(i.vis))) {
      const a = obj(vis[k]), bb = obj(b);
      vis[k] = Object.assign({}, num(bb.at) > num(a.at) ? bb : a,
        { solve: Math.max(num(a.solve), num(bb.solve)), miss: Math.max(num(a.miss), num(bb.miss)), q: mergeQueue(a.q, bb.q) });
      // v8-4-plan T1: a look review's engine plies, from either side
      if (a.eng || bb.eng) vis[k].eng = Object.assign({}, obj(a.eng), obj(bb.eng));
    }
  }
  return out;
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
  let added = false;
  for (const g of arr(c.games)) if (g && g.id) byId.set(g.id, g);
  for (const g of arr(i.games)) {
    if (!g || !g.id) continue;
    const have = byId.get(g.id);
    if (!have || num(g.t) > num(have.t)) { byId.set(g.id, g); added = true; }
  }
  const games = [...byId.values()].sort((a, b) => num(a.t) - num(b.t));
  const out = Object.assign({}, c, { v: Math.max(num(c.v), num(i.v)) || 1, games });
  // #89 review: this machine's stored rating does not add up the games that
  // came in — dropped, so opponents.js ratingOfStats replays the merged list
  if (added) delete out.rating;
  return out;
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
  // M3 评审: the file's card schedules ride along until the repertoire's
  // records take them (repertoire-ui.js takeCards)
  if (i.cards && typeof i.cards === "object" && !Array.isArray(i.cards)) out.cards = i.cards;
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
