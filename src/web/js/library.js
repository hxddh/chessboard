/**
 * 棋谱库 — the player's own games, in bulk.
 *
 * `mistakes.js` opens with the argument this module finishes:
 *
 *   「任何现成题库都给不了的那一种内容，是这个玩家真正输掉的那些棋。」
 *
 * That is right, and until 7.0 it was true of almost nobody's games. The loop
 * closed only for games played *inside* this app, and `analyzeGame` works on
 * the one game currently on the board — two buttons, one game. Importing a
 * multi-game PGN made you pick a single game out of it. Anyone who plays
 * online has hundreds of games elsewhere and no way to point this app at them,
 * so the app's most convincing claim covered a rounding error of real play.
 *
 * This module is the model for fixing that: a library of imported games, each
 * carrying its own analysis once it has one, and the arithmetic that turns a
 * few hundred analysed games into statements worth acting on.
 *
 * Pure on purpose — PGN text and analysis arrays in, plain objects out. No
 * engine, no DOM, no clock, no store. The app owns the scheduling (which game
 * to analyse next, when to stop), the persistence, and every string the player
 * reads. That split is what lets the whole of it be tested without a browser.
 * @module library
 */

/**
 * How many games the library holds.
 *
 * A season of online play, not an archive: the value of this feature is in
 * "what am I doing wrong lately", and a diagnosis averaged over five years of
 * play answers a question nobody asked. Beyond it, the oldest go first — and
 * the *imported* date is what orders them, not the date in the PGN, because a
 * batch someone imports today is what they came here to look at.
 */
const MAX_GAMES = 500;

/** Phase boundaries by full-move number, for the per-phase accuracy split. */
const OPENING_UNTIL = 12;
const MIDDLE_UNTIL = 32;

/**
 * A stable id for one game.
 *
 * From the moves and the seven-tag roster, not from the import order or a
 * counter: importing the same export twice must not double every game, and
 * that is exactly what a player does when they re-download their archive to
 * pick up the last week.
 */
function gameId(headers, sans) {
  const h = (k) => {
    const row = (headers || []).find(([key]) => key === k);
    return row ? row[1] : "";
  };
  const s = [h("Event"), h("Site"), h("Date"), h("Round"), h("White"), h("Black"), h("Result"),
    (sans || []).join(" ")].join("|");
  let a = 5381;
  for (let i = 0; i < s.length; i++) a = ((a << 5) + a + s.charCodeAt(i)) >>> 0;
  return "lib:" + a.toString(36);
}

/**
 * Which side the player was, from the names they answer to.
 *
 * `null` when neither side matches: a game between two other people is worth
 * keeping (it may be one they are studying) but must never be folded into
 * "your accuracy". Guessing here would quietly poison every number this
 * module produces, so it does not guess.
 */
function sideOf(headers, names) {
  const want = new Set((names || []).map((n) => String(n).trim().toLowerCase()).filter(Boolean));
  if (!want.size) return null;
  const at = (k) => {
    const row = (headers || []).find(([key]) => key === k);
    return row ? String(row[1]).trim().toLowerCase() : "";
  };
  const w = want.has(at("White"));
  const b = want.has(at("Black"));
  if (w && !b) return "w";
  if (b && !w) return "b";
  return null;
}

/** The result from this player's chair: 'win' | 'loss' | 'draw' | null. */
function outcomeFor(result, side) {
  if (!side) return null;
  if (result === "1/2-1/2") return "draw";
  if (result === "1-0") return side === "w" ? "win" : "loss";
  if (result === "0-1") return side === "b" ? "win" : "loss";
  return null;
}

/**
 * One library entry from a parsed game.
 * @param {{headers: Array<[string,string]>, root: object, result: string}} game
 * @param {string[]} sans mainline SAN, in order
 * @param {string[]} names the player's own names, for `side`
 * @param {number} now ms epoch
 */
function entryFrom(game, sans, names, now) {
  const headers = (game && game.headers) || [];
  const side = sideOf(headers, names);
  const tag = (k) => {
    const row = headers.find(([key]) => key === k);
    return row ? row[1] : "";
  };
  return {
    id: gameId(headers, sans),
    t: now,
    white: tag("White"),
    black: tag("Black"),
    date: tag("Date"),
    event: tag("Event"),
    result: (game && game.result) || "*",
    plies: sans.length,
    /**
     * The mainline, space-separated SAN.
     *
     * The whole game and not just its length, because a diagnosis that can
     * only say "your endgames lose 120cp a move" is a number, not an
     * explanation: the player has to be able to open the game it came from.
     * Joined rather than an array — a few hundred games' worth of one-element
     * JSON strings is most of what this record would otherwise weigh.
     */
    sans: sans.join(" "),
    side,
    outcome: outcomeFor((game && game.result) || "*", side),
    /** set by the app once the analysis pass has run over this game */
    an: null,
  };
}

/**
 * Merge freshly imported entries into the library.
 *
 * Re-importing an archive is the normal case, not the exception, so an id
 * already present is left exactly as it was — including its analysis, which
 * cost minutes of engine time and must not be thrown away by a re-import.
 * @returns {{list: object[], added: number, dup: number, dropped: string[]}}
 */
function addGames(list, fresh) {
  const have = new Set((list || []).map((g) => g.id));
  const out = (list || []).slice();
  let added = 0, dup = 0;
  for (const g of fresh || []) {
    if (have.has(g.id)) { dup++; continue; }
    have.add(g.id);
    out.push(g);
    added++;
  }
  const dropped = [];
  if (out.length > MAX_GAMES) {
    out.sort((a, b) => (a.t || 0) - (b.t || 0));
    while (out.length > MAX_GAMES) dropped.push(out.shift().id);
  }
  out.sort((a, b) => (b.t || 0) - (a.t || 0));
  return { list: out, added, dup, dropped };
}

/** Games still needing an analysis pass, oldest import first. */
function pending(list) {
  return (list || []).filter((g) => g && !g.an && g.plies > 0).sort((a, b) => (a.t || 0) - (b.t || 0));
}

/** The phase a full-move number falls in. */
function phaseOf(moveNo) {
  if (moveNo <= OPENING_UNTIL) return "opening";
  if (moveNo <= MIDDLE_UNTIL) return "middle";
  return "end";
}

/**
 * Fold one game's analysis into the running totals.
 *
 * `an` is what the app's analysis pass produced for this game, in the shape
 * the report already uses: `{ acc: {w,b}, acpl: {w,b}, tags: [], losses: [] }`
 * where `tags[i]` and `losses[i]` belong to ply `i` (0-based, so ply 0 is
 * White's first move). Only the player's own plies count — the opponent's
 * blunders are not this player's to learn from.
 */
function foldGame(totals, g) {
  if (!g || !g.an || !g.side) return totals;
  const side = g.side;
  const an = g.an;
  totals.games++;
  if (g.outcome) totals.outcome[g.outcome]++;
  if (Number.isFinite(an.acc && an.acc[side])) {
    totals.accSum += an.acc[side];
    totals.accN++;
  }
  const tags = Array.isArray(an.tags) ? an.tags : [];
  const losses = Array.isArray(an.losses) ? an.losses : [];
  for (let i = 0; i < tags.length; i++) {
    // ply i is White's when i is even
    if ((i % 2 === 0 ? "w" : "b") !== side) continue;
    const moveNo = Math.floor(i / 2) + 1;
    const ph = totals.phase[phaseOf(moveNo)];
    ph.plies++;
    const loss = Number(losses[i]);
    if (Number.isFinite(loss)) { ph.lossSum += loss; ph.lossN++; }
    const tag = tags[i];
    if (tag === "?" || tag === "??") {
      ph.bad++;
      totals.worstPly[moveNo] = (totals.worstPly[moveNo] || 0) + 1;
      if (g.motifs && g.motifs[i]) {
        totals.motif[g.motifs[i]] = (totals.motif[g.motifs[i]] || 0) + 1;
      }
    }
  }
  if (g.eco) {
    const row = totals.eco[g.eco] || (totals.eco[g.eco] = { n: 0, win: 0, loss: 0, draw: 0, name: g.ecoName || "" });
    row.n++;
    if (g.outcome) row[g.outcome]++;
  }
  return totals;
}

function emptyTotals() {
  return {
    games: 0, accSum: 0, accN: 0,
    outcome: { win: 0, loss: 0, draw: 0 },
    phase: {
      opening: { plies: 0, bad: 0, lossSum: 0, lossN: 0 },
      middle: { plies: 0, bad: 0, lossSum: 0, lossN: 0 },
      end: { plies: 0, bad: 0, lossSum: 0, lossN: 0 },
    },
    motif: {},
    eco: {},
    worstPly: {},
  };
}

/**
 * The diagnosis: what the analysed games in `list` say about this player.
 *
 * `minGames` is a floor, not a formality. Below it the module returns
 * `{ enough: false }` and the app says so rather than drawing a chart of
 * three games — 5.1 already learned that lesson for single-game reports
 * ("只分析了 N 着，还不足以评价整体表现") and the same honesty applies here,
 * with more force: the whole selling point of this page is that it speaks
 * from a sample a single game cannot provide.
 */
function diagnose(list, minGames) {
  const floor = Number.isFinite(minGames) ? minGames : 20;
  const analysed = (list || []).filter((g) => g && g.an && g.side);
  if (analysed.length < floor) {
    return { enough: false, have: analysed.length, need: floor };
  }
  const T = emptyTotals();
  for (const g of analysed) foldGame(T, g);
  const phase = {};
  for (const k of ["opening", "middle", "end"]) {
    const p = T.phase[k];
    phase[k] = {
      plies: p.plies,
      acpl: p.lossN ? Math.round(p.lossSum / p.lossN) : null,
      badRate: p.plies ? p.bad / p.plies : null,
    };
  }
  const motifs = Object.entries(T.motif).map(([k, n]) => ({ motif: k, n })).sort((a, b) => b.n - a.n);
  const ecos = Object.entries(T.eco).map(([eco, r]) => ({
    eco, name: r.name, n: r.n, win: r.win, loss: r.loss, draw: r.draw,
    score: r.n ? (r.win + r.draw / 2) / r.n : null,
  })).sort((a, b) => b.n - a.n);
  // the move number where this player's serious mistakes cluster
  const peak = Object.entries(T.worstPly).map(([mv, n]) => ({ move: Number(mv), n }))
    .sort((a, b) => b.n - a.n || a.move - b.move)[0] || null;
  return {
    enough: true,
    games: T.games,
    outcome: T.outcome,
    acc: T.accN ? Math.round((T.accSum / T.accN) * 10) / 10 : null,
    phase,
    motifs,
    ecos,
    peak,
    /**
     * The one phase to work on: the weakest by ACPL, but only when it is
     * clearly weaker than the best one. A five-point gap is noise dressed as
     * advice, and this page exists to tell people what to practise.
     */
    weakestPhase: (() => {
      const rows = ["opening", "middle", "end"]
        .map((k) => ({ k, acpl: phase[k].acpl, plies: phase[k].plies }))
        .filter((r) => r.acpl != null && r.plies >= 30);
      if (rows.length < 2) return null;
      rows.sort((a, b) => b.acpl - a.acpl);
      const worst = rows[0], best = rows[rows.length - 1];
      return worst.acpl - best.acpl >= 20 ? worst.k : null;
    })(),
  };
}

export const ChessLibrary = {
  MAX_GAMES, OPENING_UNTIL, MIDDLE_UNTIL,
  gameId, sideOf, outcomeFor, entryFrom, addGames, pending, phaseOf, diagnose,
};
