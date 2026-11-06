/**
 * Opponent profiles (ADR 0004: an opponent is a profile; the engine service
 * decides who plays it). A short list for now — the Maia-3 profiles replace
 * it behind the same fields. `friend` is two people at one board.
 *
 *   { id, rating, thinkMs: [fast, slow], resign?: winPct below which it resigns }
 * Names live in the page dictionary (opp.<id>), not here.
 * @module core/opponents
 */
export const OPPONENTS = [
  { id: "pip", rating: 600, thinkMs: [500, 1500] },
  { id: "lin", rating: 1000, thinkMs: [500, 2000] },
  { id: "vera", rating: 1500, thinkMs: [600, 2500] },
  { id: "max", rating: 2000, thinkMs: [700, 3000] },
  { id: "friend", rating: null },
];
export const DEFAULT_OPPONENT = "lin";
export const opponentById = (id) => OPPONENTS.find((o) => o.id === id) || OPPONENTS.find((o) => o.id === DEFAULT_OPPONENT);

/**
 * How many times the coach may ask before a move, per game (v20-0-plan
 * §3 P2): beginners 5, up to 1500 fewer, from 1500 none.
 */
export function coachBudget(level) {
  if (!Number.isFinite(level)) return 5;
  if (level < 1000) return 5;
  if (level < 1500) return 3;
  return 0;
}
