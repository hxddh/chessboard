/**
 * The opponents (v20-0-plan §3 P1, ADR 0004: an opponent is a profile; the
 * engine service decides who plays it). Fifteen people, weakest first, and
 * `friend` — two people at one board.
 *
 *   id       names, lines and faces live in opponents/ (lines.zh.js, portraits.js)
 *   rating   what the sheet shows: the ladder's fit, docs/measured.json
 *            `ladder20` (scripts/ladder20.mjs; scripts/test/opponents20.mjs fails
 *            when the two disagree) — not the number passed to the net
 *   play     Maia-3: { maia: the rating the net is given, temperature?, topP?,
 *                      style?: "attacker" | "principled", sees?: mates it spots
 *                      when converting, convertT? }
 *            Stockfish: { elo: UCI_Elo, nodes }, or full strength on a few hundred or
 *            thousand nodes (19.0's 大师+ … 强力+ rungs did the same) · 全力: { nodes: 400000 }
 *   pace     think-time scale (opponents/think.js), 1 = average
 *   resign   { cp, n, after }: resigns when its own look is ≤ −cp on n moves
 *            running, not before ply `after`; null: plays on to the end
 *   draw     { worse }: takes a draw it is offered when its look is ≤ −worse
 *            (or, past ply 60, when it is dead level)
 * @module core/opponents
 */
export const OPPONENTS = [
  { id: "pip", rating: 1100, play: { maia: 600 }, pace: 0.7, resign: null, draw: { worse: 400 } },
  { id: "tomo", rating: 1250, play: { maia: 800 }, pace: 0.75, resign: null, draw: { worse: 300 } },
  { id: "lina", rating: 1400, play: { maia: 1050, style: "principled" }, pace: 0.85, resign: { cp: 1500, n: 4, after: 40 }, draw: { worse: 250 } },
  { id: "kai", rating: 1500, play: { maia: 1300, style: "attacker" }, pace: 0.8, resign: { cp: 1500, n: 4, after: 40 }, draw: { worse: 300 } },
  { id: "ada", rating: 1600, play: { maia: 1600 }, pace: 0.9, resign: { cp: 1200, n: 3, after: 30 }, draw: { worse: 200 } },
  { id: "vera", rating: 1700, play: { maia: 2000, sees: 2 }, pace: 1, resign: { cp: 1000, n: 3, after: 24 }, draw: { worse: 150 } },
  { id: "leo", rating: 1900, play: { maia: 2200, sees: 2 }, pace: 0.8, resign: { cp: 900, n: 3, after: 24 }, draw: { worse: 150 } },
  { id: "ivy", rating: 2000, play: { maia: 2600, sees: 3 }, pace: 1.05, resign: { cp: 800, n: 3, after: 20 }, draw: { worse: 100 } },
  { id: "max", rating: 2100, play: { maia: 2600, temperature: 0.6, sees: 3 }, pace: 1.1, resign: { cp: 800, n: 2, after: 20 }, draw: { worse: 100 } },
  { id: "iris", rating: 2250, play: { elo: 2400, nodes: 60000 }, pace: 1.1, resign: { cp: 700, n: 2, after: 20 }, draw: { worse: 80 } },
  { id: "otto", rating: 2400, play: { elo: 2700, nodes: 120000 }, pace: 1.1, resign: { cp: 700, n: 2, after: 20 }, draw: { worse: 80 } },
  { id: "zoe", rating: 2600, play: { elo: 2850, nodes: 150000 }, pace: 1.05, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 60 } },
  { id: "nora", rating: 2800, play: { nodes: 300 }, pace: 1.05, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 60 } },
  { id: "kit", rating: 3000, play: { nodes: 2500 }, pace: 1, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 50 } },
  { id: "fish", rating: 3200, play: { nodes: 400000 }, pace: 0.9, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 50 } },
  { id: "friend", rating: null },
];
export const DEFAULT_OPPONENT = "ada";
export const LADDER = OPPONENTS.filter((o) => o.play);
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
