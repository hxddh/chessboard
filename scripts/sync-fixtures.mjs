/**
 * The real Lichess / Chess.com answers in src/sync-fixtures/ (v8-0-plan C2),
 * as sync.zig chess.fetchGames hands them to the page: {pgn, count}, the games
 * newest first (oldest first for a since= request), each trimmed, a blank line between. The framing is the one
 * sync.zig's lichessAnswer / chesscomMonth apply — its Zig tests pin their
 * output on these same files (5 Lichess games; 9 of the Chess.com month's 13,
 * its four Chess960 games left out) — so the page-side suites import what the
 * app would really be given, not a sample written from the docs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "sync-fixtures");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
/** sync.zig SyncAnswer.add: std.mem.trim(u8, game, " \t\r\n") */
const trim = (s) => s.replace(/^[ \t\r\n]+|[ \t\r\n]+$/g, "");
const answer = (games, max) => {
  const kept = games.map(trim).filter(Boolean).slice(0, max);
  return { pgn: kept.join("\n\n"), count: kept.length };
};

/** Lichess (thibault, 5 blitz games): one PGN text, cut where an [Event line starts. */
export function lichessAnswer(max = 20) {
  const body = read("lichess.body");
  const starts = [...body.matchAll(/^\[Event /gm)].map((m) => m.index);
  return answer(starts.map((s, i) => body.slice(s, starts[i + 1] ?? body.length)), max);
}

/** sync.zig pgnUtcMs: when a Lichess game started (UTCDate / UTCTime), ms, or null. */
export function utcMsOf(game) {
  const d = /\[UTCDate "(\d{4})\.(\d{2})\.(\d{2})"\]/.exec(game), t = /\[UTCTime "(\d{2}):(\d{2}):(\d{2})"\]/.exec(game);
  return d && t ? Date.UTC(+d[1], +d[2] - 1, +d[3], +t[1], +t[2], +t[3]) : null;
}

/**
 * v8-2-plan V2: the earliest `since` the 2026-09-30 run can have sent
 * (2026-08-31T17:26:54Z: its Fetch step's start less 30 days; the log does
 * not print it) — sync.zig's LICHESS_SINCE_REAL_SENT.
 */
export const LICHESS_SINCE_SENT = Date.UTC(2026, 7, 31, 17, 26, 54);

/**
 * Lichess (thibault) to an incremental sync's request — since=, sort=dateAsc,
 * max=20 — as sync.zig lichessAnswer hands it on: in the order sent (oldest
 * first), games begun before `since` dropped, the first `max` kept.
 */
export function lichessSinceAnswer(max = 20, since = LICHESS_SINCE_SENT) {
  const body = read("lichess-since.body");
  const starts = [...body.matchAll(/^\[Event /gm)].map((m) => m.index);
  const games = starts.map((s, i) => body.slice(s, starts[i + 1] ?? body.length));
  return answer(games.filter((g) => { const ms = utcMsOf(g); return ms == null || ms >= since; }), max);
}

/** Chess.com (erik, 2026/09): the month lists oldest first; standard chess only. */
export function chesscomAnswer(max = 20) {
  const month = JSON.parse(read("chesscom-month.body"));
  return answer(month.games.filter((g) => (g.rules || "chess") === "chess").reverse().map((g) => g.pgn || ""), max);
}
