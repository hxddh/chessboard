/**
 * 跨局指标：一局说不出、许多局才说得出的事（v8-0-plan B5）。
 *
 * Aimchess's three dimensions, read off games this app already keeps:
 *   化优为胜  of the games where you stood +2 or better, how many you won;
 *   逆境求生  of the games where you stood −2 or worse, how many you saved;
 *   时间紧    how often a move made on a low clock was a ??, against the rest.
 * Plus the page's other derived series: the engine-game rating curve, the
 * practice calendar and the strengths / weaknesses by theme.
 *
 * The 7.1 rule holds for every figure here: a chart that cannot be drawn
 * does not exist. Each metric carries the number of games it needs (`need`)
 * and has no value (`rate: null`) below it — the page says how many more.
 *
 * Pure: records in, figures out. No store, no DOM, no i18n, no Date.now().
 * @module progress-metrics
 */
import { ChessProgress } from "./progress.js";

/** "Winning" and "lost" are ±2 pawns, from the player's chair. */
export const ADV_CP = 200;
/** Games that reached +2 before a conversion rate means anything. */
export const MIN_CONVERT = 5;
/** Games that reached −2 before a resilience rate means anything. */
export const MIN_RESIL = 5;
/** Analysed games with clock readings before the time-pressure figure. */
export const MIN_CLOCK = 10;
/**
 * A move is made under time pressure when the mover's clock, before it, is
 * below this share of that side's first reading: 18 s in 3+0, 90 s in 15+10.
 * A share rather than a number of seconds, because 30 s is an age in bullet
 * and a crisis in classical.
 */
export const PRESSURE = 0.1;
/** First answers in a puzzle theme before its rating ranks it. */
export const MIN_THEME = 5;
/** Weeks the calendar shows — the column count that fits a phone. */
export const HEAT_WEEKS = 18;

/**
 * Seconds from one `[%clk h:mm:ss]` command (Lichess writes whole seconds,
 * chess.com tenths), or null when the comment carries none.
 */
export function clkOf(comment) {
  const m = /\[%clk\s+(?:(\d+):)?(\d{1,2}):(\d{1,2}(?:\.\d+)?)\s*\]/.exec(String(comment || ""));
  if (!m) return null;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

/**
 * The mainline's clock readings, one per ply (whole seconds, null where a
 * move has none), or null when the game has no clock at all.
 * @param {object} root a pgn-parser tree
 */
export function clocksOf(root) {
  const out = [];
  let any = false;
  for (let n = root; n && n.children && n.children.length; n = n.children[0]) {
    const s = clkOf(n.children[0].comment);
    if (s != null) any = true;
    out.push(s == null ? null : Math.round(s));
  }
  return any ? out : null;
}

/**
 * One game, reduced to what the metrics count.
 *
 * `g` is the common shape of a library entry and an engine-game record:
 * `side` ("w"|"b"), `outcome` ("win"|"loss"|"draw"), and either the analysis
 * arrays (`scalars`, white's view in centipawns, one per position; `tags`,
 * one per ply) or the already-reduced `hi` / `lo` an engine game files.
 * `clk` is one reading per ply, `fen` the start (a black-to-move start shifts
 * whose ply is whose).
 */
export function factsOf(g) {
  if (!g || (g.side !== "w" && g.side !== "b") || !["win", "loss", "draw"].includes(g.outcome)) return null;
  const sgn = g.side === "w" ? 1 : -1;
  let hi = Number.isFinite(g.hi) ? g.hi : null;
  let lo = Number.isFinite(g.lo) ? g.lo : null;
  if (Array.isArray(g.scalars)) {
    for (const s of g.scalars) {
      if (!Number.isFinite(s)) continue;
      const v = s * sgn;
      if (hi == null || v > hi) hi = v;
      if (lo == null || v < lo) lo = v;
    }
  }
  const f = { outcome: g.outcome, hi, lo, clocked: false, press: { n: 0, b: 0 }, calm: { n: 0, b: 0 } };
  const clk = Array.isArray(g.clk) ? g.clk : null;
  const tags = Array.isArray(g.tags) ? g.tags : null;
  if (!clk || !tags) return f;
  const first = String(g.fen || "").trim().split(/\s+/)[1] === "b" ? "b" : "w";
  const mine = (i) => (i % 2 === 0) === (first === g.side);
  let base = null;
  for (let i = 0; i < clk.length; i++) if (mine(i) && Number.isFinite(clk[i])) { base = clk[i]; break; }
  if (!base) return f;
  f.clocked = true;
  // a tag is null both for a sound move and for one never measured; the
  // scalars on either side of the move say which
  const sc = Array.isArray(g.scalars) ? g.scalars : null;
  for (let i = 0; i < tags.length; i++) {
    if (!mine(i) || (sc && !(Number.isFinite(sc[i]) && Number.isFinite(sc[i + 1])))) continue;
    // the clock before this move is the one after this side's previous move;
    // the first move starts on the first reading
    const before = i >= 2 && Number.isFinite(clk[i - 2]) ? clk[i - 2] : (i < 2 ? base : null);
    if (before == null) continue;
    const bucket = before < base * PRESSURE ? f.press : f.calm;
    bucket.n++;
    if (tags[i] === "??") bucket.b++;
  }
  return f;
}

/**
 * The three cross-game metrics over a list of `factsOf` results.
 * Each: `n` the games that count, `need` the floor, and the figures only
 * once `n >= need` (`rate` null below it).
 */
export function crossGame(facts) {
  const fs = (facts || []).filter(Boolean);
  const up = fs.filter((f) => f.hi != null && f.hi >= ADV_CP);
  const down = fs.filter((f) => f.lo != null && f.lo <= -ADV_CP);
  const won = (xs) => xs.filter((f) => f.outcome === "win").length;
  const drawn = (xs) => xs.filter((f) => f.outcome === "draw").length;
  const convert = { n: up.length, need: MIN_CONVERT, won: won(up), rate: null };
  if (convert.n >= convert.need) convert.rate = convert.won / convert.n;
  const resil = { n: down.length, need: MIN_RESIL, won: won(down), drawn: drawn(down), rate: null };
  if (resil.n >= resil.need) resil.rate = (resil.won + resil.drawn) / resil.n;
  const clocked = fs.filter((f) => f.clocked);
  const press = { n: 0, b: 0 }, calm = { n: 0, b: 0 };
  for (const f of clocked) {
    press.n += f.press.n; press.b += f.press.b;
    calm.n += f.calm.n; calm.b += f.calm.b;
  }
  const clock = { n: clocked.length, need: MIN_CLOCK, press, calm, rate: null, calmRate: null };
  if (clock.n >= clock.need) {
    clock.rate = press.n ? press.b / press.n : null;
    clock.calmRate = calm.n ? calm.b / calm.n : null;
  }
  return { convert, resil, clock };
}

/**
 * An engine game's rating after it. v8-0-plan B4 files it on the stats
 * record as `ra` (opponents.js fileRating); this line is the one hook the
 * curve reads, so a different field is a one-line change here.
 */
export const ratingAfter = (g) => (g && Number.isFinite(g.ra) ? g.ra : null);

/** The engine-game rating curve: [{t, r}] in play order, the last `maxN`. */
export function gameRatingSeries(games, maxN) {
  return (games || [])
    .filter((g) => ratingAfter(g) != null && Number.isFinite(g.t))
    .sort((a, b) => a.t - b.t)
    .slice(-(maxN || 60))
    .map((g) => ({ t: g.t, r: ratingAfter(g) }));
}

/** How much happened on each local day: {dayKey: count} from instants. */
export function dayCounts(stamps) {
  const out = {};
  for (const t of stamps || []) {
    if (!Number.isFinite(t) || t <= 0) continue;
    const k = ChessProgress.dayKey(t);
    out[k] = (out[k] || 0) + 1;
  }
  return out;
}

/**
 * The calendar: `weeks` Monday-first columns ending with this week, and the
 * streaks. `cells[i]` is {key, n, col, row}; days after today are left out.
 * `cur` counts back from today (or from yesterday, as Progress.streak does:
 * reading the page before today's practice does not break the run), `best`
 * is the longest run anywhere in `counts`.
 */
export function heatGrid(counts, now, weeks) {
  const W = weeks || HEAT_WEEKS;
  const day = 86400000;
  const today = new Date(now);
  const noon = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 12).getTime();
  const dow = (today.getDay() + 6) % 7; // Monday 0
  const start = noon - (dow + (W - 1) * 7) * day;
  const cells = [];
  let active = 0;
  for (let i = 0; i <= (W - 1) * 7 + dow; i++) {
    // step by calendar date, not by 24 h, so a DST change cannot skip a day
    const d = new Date(start);
    d.setDate(d.getDate() + i);
    const key = ChessProgress.dayKey(d.getTime());
    const n = (counts && counts[key]) || 0;
    if (n) active++;
    cells.push({ key, n, col: Math.floor(i / 7), row: i % 7 });
  }
  const has = (k) => !!(counts && counts[k]);
  const back = (t, i) => { const d = new Date(t); d.setDate(d.getDate() - i); return ChessProgress.dayKey(d.getTime()); };
  let cur = 0;
  const anchor = has(back(noon, 0)) ? 0 : 1;
  while (has(back(noon, anchor + cur))) cur++;
  let best = 0;
  const keys = Object.keys(counts || {}).filter((k) => counts[k] > 0).sort();
  let run = 0, prev = null;
  for (const k of keys) {
    const t = new Date(k + "T12:00:00").getTime();
    run = prev != null && back(t, 1) === prev ? run + 1 : 1;
    if (run > best) best = run;
    prev = k;
  }
  return { cells, weeks: W, active, cur, best };
}

/**
 * Strengths and weaknesses, from the two records that name them.
 *
 * Puzzles: every theme answered at least MIN_THEME times, ranked by its own
 * rating (v8-0-plan B1) — the top of the list is a strength, the bottom a
 * weakness, and a theme is never both. Games: `diag` is Library.diagnose's
 * answer at the diagnosis page's own floor, so the two pages cannot
 * disagree — its most-missed motifs are weaknesses, and among openings met
 * three times or more the best and worst scores are one of each.
 * @returns {{strong: object[], weak: object[]}}
 */
export function strengths(themes, diag) {
  const strong = [], weak = [];
  const rows = Object.entries(themes || {})
    .filter(([, r]) => r && (r.solve || 0) + (r.miss || 0) >= MIN_THEME && r.rating && Number.isFinite(r.rating.r))
    .map(([id, r]) => ({ kind: "theme", id, r: Math.round(r.rating.r) }))
    .sort((a, b) => b.r - a.r || (a.id < b.id ? -1 : 1));
  const k = Math.min(3, Math.floor(rows.length / 2));
  strong.push(...rows.slice(0, k));
  weak.push(...rows.slice(rows.length - k).reverse());
  if (diag && diag.enough) {
    for (const m of (diag.motifs || []).slice(0, 3)) weak.push({ kind: "motif", id: m.motif, n: m.n });
    const ecos = (diag.ecos || []).filter((e) => e.n >= 3 && e.score != null)
      .slice().sort((a, b) => b.score - a.score || b.n - a.n);
    if (ecos.length >= 2) {
      const hi = ecos[0], lo = ecos[ecos.length - 1];
      if (hi.score >= 0.5) strong.push({ kind: "eco", id: hi.eco, name: hi.name, score: hi.score, n: hi.n });
      if (lo.score < 0.5) weak.push({ kind: "eco", id: lo.eco, name: lo.name, score: lo.score, n: lo.n });
    }
  }
  return { strong, weak };
}

export const ChessProgressMetrics = {
  ADV_CP, MIN_CONVERT, MIN_RESIL, MIN_CLOCK, PRESSURE, MIN_THEME, HEAT_WEEKS,
  clkOf, clocksOf, factsOf, crossGame, ratingAfter, gameRatingSeries, dayCounts, heatGrid, strengths,
};
