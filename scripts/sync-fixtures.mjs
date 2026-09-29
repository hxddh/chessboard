/**
 * The real Lichess / Chess.com answers in src/sync-fixtures/ (v8-0-plan C2),
 * as main.zig chess.fetchGames hands them to the page: {pgn, count}, the games
 * newest first, each trimmed, a blank line between. The framing is the one
 * main.zig's lichessAnswer / chesscomMonth apply — its Zig tests pin their
 * output on these same files (5 Lichess games; 9 of the Chess.com month's 13,
 * its four Chess960 games left out) — so the page-side suites import what the
 * app would really be given, not a sample written from the docs.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "sync-fixtures");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
/** main.zig SyncAnswer.add: std.mem.trim(u8, game, " \t\r\n") */
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

/** Chess.com (erik, 2026/09): the month lists oldest first; standard chess only. */
export function chesscomAnswer(max = 20) {
  const month = JSON.parse(read("chesscom-month.body"));
  return answer(month.games.filter((g) => (g.rules || "chess") === "chess").reverse().map((g) => g.pgn || ""), max);
}
