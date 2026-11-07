/**
 * The opponents (v20-0-plan §3 P1, ADR 0004: an opponent is a profile; the
 * engine service decides who plays it). Sixteen people, weakest first, and
 * `friend` — two people at one board.
 *
 *   id       names, lines and faces live in opponents/ (lines.zh.js, portraits.js)
 *   rating   what the sheet shows: the ladder's fit, docs/measured.json
 *            `ladder20` (scripts/ladder20.mjs; scripts/app/ladder20.test.mjs fails
 *            when the two disagree) — not the number passed to the net
 *   play     Maia-3: { maia: the rating the net is given (0–2600: below the
 *                      600 it was trained from, the rating embedding is a
 *                      straight line on, and the net keeps getting looser —
 *                      §10), temperature?, topP?,
 *                      style?: "attacker" | "principled", sees?: mates it spots
 *                      when converting, convertT?, convertAs?: the
 *                      rating whose moves it converts with (default its own
 *                      + 400, up to 1600), keep?: the win % it stays careful
 *                      down to once converting (default 70) }
 *            Stockfish: { elo: UCI_Elo, nodes }, or full strength on a thousand
 *            nodes (19.0's 大师+ … 强力+ rungs did the same) · 全力: { nodes: 400000 }
 *   pace     think-time scale (opponents/think.js), 1 = average
 *   resign   { cp, n, after }: resigns when its own look is ≤ −cp on n moves
 *            running, not before ply `after`; null: plays on to the end
 *   draw     { worse }: takes a draw it is offered when its look is ≤ −worse
 *            (or, past ply 60, when it is dead level)
 * @module core/opponents
 */
export const OPPONENTS = [
  { id: "pip", rating: 551, play: { maia: 0, temperature: 2, sees: 3, convertAs: 1200, convertT: 0.3, keep: 60 }, pace: 0.7, resign: null, draw: { worse: 400 } },
  { id: "tomo", rating: 680, play: { maia: 150, sees: 3, convertAs: 1200, convertT: 0.3, keep: 60 }, pace: 0.75, resign: null, draw: { worse: 300 } },
  { id: "lina", rating: 854, play: { maia: 350, style: "principled", sees: 3, convertAs: 1200, convertT: 0.3, keep: 60 }, pace: 0.85, resign: { cp: 1500, n: 4, after: 40 }, draw: { worse: 250 } },
  { id: "kai", rating: 1062, play: { maia: 500, style: "attacker", sees: 3, convertAs: 1200, convertT: 0.3, keep: 60 }, pace: 0.8, resign: { cp: 1500, n: 4, after: 40 }, draw: { worse: 300 } },
  { id: "ada", rating: 1225, play: { maia: 700, sees: 3, convertT: 0.3, keep: 60 }, pace: 0.9, resign: { cp: 1500, n: 4, after: 40 }, draw: { worse: 250 } },
  { id: "ben", rating: 1438, play: { maia: 1200 }, pace: 0.9, resign: { cp: 1200, n: 3, after: 30 }, draw: { worse: 200 } },
  { id: "vera", rating: 1579, play: { maia: 1750 }, pace: 1, resign: { cp: 1000, n: 3, after: 24 }, draw: { worse: 150 } },
  { id: "leo", rating: 1733, play: { maia: 2250, sees: 2 }, pace: 0.8, resign: { cp: 900, n: 3, after: 24 }, draw: { worse: 150 } },
  { id: "ivy", rating: 1962, play: { maia: 2600, temperature: 0.65, sees: 3 }, pace: 1.05, resign: { cp: 800, n: 2, after: 20 }, draw: { worse: 100 } },
  { id: "max", rating: 2145, play: { elo: 2400, nodes: 60000 }, pace: 1.1, resign: { cp: 700, n: 2, after: 20 }, draw: { worse: 80 } },
  { id: "iris", rating: 2344, play: { elo: 2625, nodes: 120000 }, pace: 1.1, resign: { cp: 700, n: 2, after: 20 }, draw: { worse: 80 } },
  { id: "otto", rating: 2578, play: { elo: 2800, nodes: 150000 }, pace: 1.1, resign: { cp: 700, n: 2, after: 20 }, draw: { worse: 80 } },
  { id: "zoe", rating: 2760, play: { elo: 2875, nodes: 150000 }, pace: 1.05, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 60 } },
  { id: "nora", rating: 2917, play: { elo: 3000, nodes: 150000 }, pace: 1.05, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 60 } },
  { id: "kit", rating: 3136, play: { nodes: 1000 }, pace: 1, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 50 } },
  { id: "fish", rating: 3305, play: { nodes: 400000 }, pace: 0.9, resign: { cp: 600, n: 2, after: 20 }, draw: { worse: 50 } },
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
