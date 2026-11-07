/**
 * The game being played: state shape and actions.
 *
 *   play: { game: null | {
 *     id, mode: "pvp" | "engine", engineColor: "w" | "b" | null, opponent: id | null, coach: boolean,
 *     startFen, moves: [{ uci, san, fen, clock? }], result: null | { result, reason },
 *     clock: null | core/clock, takebacks?: number (悔棋 so far)
 *   } }
 *
 * Time is an argument (`now`), never read here: the same actions replay a
 * game from its events (play.restore), so what is on screen after a reload
 * is what was on screen before it.
 * @module state/play
 */
import { applyMove, outcome, claimable, canMateAfterFlag, turnOf, START_FEN } from "../core/rules.js";
import { newClock, afterMove, stop } from "../core/clock.js";

export const initialPlay = { game: null };

const fenOf = (game) => game.moves.length ? game.moves[game.moves.length - 1].fen : game.startFen;
const ended = (game, result, now) => ({ ...game, result, clock: stop(game.clock, now) });

function withMove(game, uci, now) {
  if (game.result) throw new Error("play.move: the game is over");
  const before = fenOf(game);
  const mv = applyMove(before, uci);
  if (!mv) throw new Error("play.move: illegal " + uci);
  const clock = game.clock ? afterMove(game.clock, turnOf(before), now) : null;
  const move = { uci: mv.uci, san: mv.san, fen: mv.fen };
  if (clock) move.clock = { w: clock.w, b: clock.b };
  const moves = [...game.moves, move];
  const result = outcome([game.startFen, ...moves.map((m) => m.fen)]);
  const next = { ...game, moves, clock };
  return result ? ended(next, result, now) : next;
}

const winner = (loser) => (loser === "w" ? "0-1" : "1-0");

/**
 * How many plies 悔棋 takes back for `color`: to before its last move, so a
 * reply already made goes too, and a move still being answered goes alone.
 * 0 when `color` has not moved. (19.0 took back "the next pair" when the
 * reply was still coming — v20-0-plan §3 走查.)
 */
export function takebackPlies(game, color) {
  const fens = [game.startFen, ...game.moves.map((m) => m.fen)];
  for (let i = game.moves.length - 1; i >= 0; i--) if (turnOf(fens[i]) === color) return game.moves.length - i;
  return 0;
}

export const playActions = {
  "play.new": (s, { id, mode = "pvp", engineColor = null, startFen = START_FEN, opponent = null, tc = null, coach = false }) =>
    ({ ...s, play: { game: { id, mode, engineColor: mode === "engine" ? engineColor || "b" : null,
      opponent: mode === "engine" ? opponent : null, coach: mode === "engine" && !!coach,
      startFen, moves: [], result: null, clock: newClock(tc) } } }),

  "play.move": (s, { uci, now = 0 }) => ({ ...s, play: { game: withMove(s.play.game, uci, now) } }),

  /**
   * 悔棋: take moves back. `color` given: back to before that side's last
   * move (its reply included, so it is that side's turn again); else `plies`.
   * A finished game has nothing to take back into (19.0's rule), so it is
   * left alone, as is a side that has not moved. The clock goes back to what
   * it showed then and runs again from `now`; `takebacks` counts them (a game
   * with one is not rated: learn/model.js).
   */
  "play.undo": (s, { plies = 1, color = null, now = 0 } = {}) => {
    const g = s.play.game;
    if (!g || g.result) return s;
    const k = color ? takebackPlies(g, color) : Math.min(plies, g.moves.length);
    if (k <= 0) return s;
    const moves = g.moves.slice(0, g.moves.length - k);
    let clock = g.clock;
    if (clock) {
      const last = moves.length ? moves[moves.length - 1].clock : null;
      const fen = moves.length ? moves[moves.length - 1].fen : g.startFen;
      clock = { ...clock, w: last ? last.w : clock.base, b: last ? last.b : clock.base, turn: turnOf(fen), since: moves.length ? now : null };
    }
    return { ...s, play: { game: { ...g, moves, clock, result: null, takebacks: (g.takebacks || 0) + 1 } } };
  },

  "play.resign": (s, { color, now = 0 }) => {
    const g = s.play.game;
    if (g.result) return s;
    return { ...s, play: { game: ended(g, { result: winner(color), reason: "resign" }, now) } };
  },

  /** A draw: agreed, or claimed under 9.2 / 9.3 (refused when there is nothing to claim). */
  "play.draw": (s, { reason = "agreement", now = 0 }) => {
    const g = s.play.game;
    if (g.result) return s;
    if (reason !== "agreement" && claimable([g.startFen, ...g.moves.map((m) => m.fen)]) !== reason) {
      throw new Error("play.draw: nothing to claim");
    }
    return { ...s, play: { game: ended(g, { result: "1/2-1/2", reason }, now) } };
  },

  /** `color`'s flag fell: a loss, or a draw when the other side cannot mate (6.9). */
  "play.flag": (s, { color, now = 0 }) => {
    const g = s.play.game;
    if (g.result || !g.clock) return s;
    const result = canMateAfterFlag(fenOf(g), color) ? { result: winner(color), reason: "timeout" }
      : { result: "1/2-1/2", reason: "timeoutDraw" };
    return { ...s, play: { game: ended({ ...g, clock: { ...g.clock, [color]: 0 } }, result, now) } };
  },

  /** The clock runs again from `now` (after a reload, the time away is not charged). */
  "play.resume": (s, { now }) => {
    const g = s.play.game;
    if (!g || g.result || !g.clock || !g.moves.length || g.clock.since != null) return s;
    return { ...s, play: { game: { ...g, clock: { ...g.clock, since: now, turn: turnOf(fenOf(g)) } } } };
  },

  /** A whole game at once, from its stored row and moves. */
  "play.restore": (s, { game, moves }) => {
    let g = { id: game.id, mode: game.mode, engineColor: game.engineColor || null, opponent: game.opponent || null,
      coach: !!game.coach, startFen: game.startFen || START_FEN, moves: [], result: null, clock: null };
    if (game.takebacks) g.takebacks = game.takebacks;
    for (const m of moves) g = withMove(g, m.uci, 0);
    const clock = newClock(game.tc);
    if (clock) {
      const last = moves.length ? moves[moves.length - 1].clock : null;
      g = { ...g, clock: { ...clock, ...(last || {}), turn: turnOf(fenOf(g)), since: null } };
      g.moves = g.moves.map((m, i) => (moves[i].clock ? { ...m, clock: moves[i].clock } : m));
    }
    if (!g.result && game.result) g = { ...g, result: game.result };
    return { ...s, play: { game: g } };
  },
};

/** Selectors (pure; the page wraps them with store.select). */
export const selectGame = (s) => s.play.game;
export const selectFen = (s) => (s.play.game ? fenOf(s.play.game) : START_FEN);
export const selectFens = (s) => (s.play.game ? [s.play.game.startFen, ...s.play.game.moves.map((m) => m.fen)] : [START_FEN]);
export const selectLastMove = (s) => {
  const g = s.play.game;
  const m = g && g.moves[g.moves.length - 1];
  return m ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : null;
};
