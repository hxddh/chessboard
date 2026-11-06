/**
 * The game being played: state shape and actions.
 *
 *   play: { game: null | {
 *     id, mode: "pvp" | "engine", engineColor: "w" | "b" | null,
 *     startFen, moves: [{ uci, san, fen }], result: null | { result, reason }
 *   } }
 *
 * The same actions replay a game from its events (play.restore), so what is
 * on screen after a reload is what was on screen before it.
 * @module state/play
 */
import { applyMove, outcome, START_FEN } from "../core/rules.js";

export const initialPlay = { game: null };

const fenOf = (game) => game.moves.length ? game.moves[game.moves.length - 1].fen : game.startFen;

function withMove(game, uci) {
  if (game.result) throw new Error("play.move: the game is over");
  const mv = applyMove(fenOf(game), uci);
  if (!mv) throw new Error("play.move: illegal " + uci);
  const moves = [...game.moves, { uci: mv.uci, san: mv.san, fen: mv.fen }];
  const result = outcome([game.startFen, ...moves.map((m) => m.fen)]);
  return { ...game, moves, result };
}

export const playActions = {
  "play.new": (s, { id, mode = "pvp", engineColor = null, startFen = START_FEN }) =>
    ({ ...s, play: { game: { id, mode, engineColor: mode === "engine" ? engineColor || "b" : null, startFen, moves: [], result: null } } }),

  "play.move": (s, { uci }) => ({ ...s, play: { game: withMove(s.play.game, uci) } }),

  "play.undo": (s, { plies = 1 } = {}) => {
    const g = s.play.game;
    const n = Math.max(0, g.moves.length - plies);
    return { ...s, play: { game: { ...g, moves: g.moves.slice(0, n), result: null } } };
  },

  "play.resign": (s, { color }) => {
    const g = s.play.game;
    if (g.result) return s;
    return { ...s, play: { game: { ...g, result: { result: color === "w" ? "0-1" : "1-0", reason: "resign" } } } };
  },

  /** A whole game at once, from its stored row and moves. */
  "play.restore": (s, { game, moves }) => {
    let g = { id: game.id, mode: game.mode, engineColor: game.engineColor || null,
      startFen: game.startFen || START_FEN, moves: [], result: null };
    for (const m of moves) g = withMove(g, m.uci);
    if (!g.result && game.result) g = { ...g, result: game.result };
    return { ...s, play: { game: g } };
  },
};

/** Selectors (pure; the page wraps them with store.select). */
export const selectGame = (s) => s.play.game;
export const selectFen = (s) => (s.play.game ? fenOf(s.play.game) : START_FEN);
export const selectLastMove = (s) => {
  const g = s.play.game;
  const m = g && g.moves[g.moves.length - 1];
  return m ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : null;
};
