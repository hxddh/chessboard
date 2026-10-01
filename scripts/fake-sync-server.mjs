/**
 * A stand-in for Lichess and Chess.com on the CI runner (v8-2-plan V1 step 2):
 * the automation build's `sync` scenario (src/web/js/selftest-scenarios.js)
 * syncs against this, never the real sites — main.zig swaps the sites' host
 * for CHESS_SYNC_BASE in self-test mode only, and keeps every path and query.
 *
 * Its answers are made of the real ones in src/sync-fixtures/ (the same bytes
 * the Zig tests and scripts/test-sync.mjs read):
 *
 *   GET /api/games/user/<name>?max=&since=&sort=   Lichess
 *       `games` (100) games built from the 25 real ones — each with its own
 *       Site and its own start time, an hour apart, the newest first (oldest
 *       first from `since` with sort=dateAsc, as Lichess does) — streamed one
 *       game every `delayMs` (100 ms), chunked, as a slow site would; the
 *       stream's start and end are recorded (`streams`), so the driver can
 *       tell which of its main-loop samples fell inside one (R6)
 *   GET /pub/player/<name>/games/archives          Chess.com's month list:
 *       2026/08 (empty) and 2026/09 — under api.chess.com, as the real list
 *       is: main.zig refuses a month anywhere else, and rebases each one
 *   GET /pub/player/<name>/games/2026/09           the real month: 13 games,
 *       4 of them Chess960 (which the app must leave out)
 *
 * and by name, for the error paths: `missing_user` gets the sites' real 404
 * pages, `limited_user` a 429, `offline_user` a connection closed without an
 * answer (main.zig reads that as offline, as it does an unreachable host).
 * Every request is recorded (`requests`: path, query, when).
 *
 *   import { startFakeSyncServer } from "./fake-sync-server.mjs";
 *   const fake = await startFakeSyncServer({ delayMs: 100 });  // fake.base, fake.requests, fake.close()
 *   node scripts/fake-sync-server.mjs [--port 8123] [--delay 100] [--games 100]
 */
import fs from "fs";
import http from "http";
import path from "path";
import { fileURLToPath } from "url";

const DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "sync-fixtures");
const read = (f) => fs.readFileSync(path.join(DIR, f), "utf8");
const split = (body) => {
  const starts = [...body.matchAll(/^\[Event /gm)].map((m) => m.index);
  return starts.map((s, i) => body.slice(s, starts[i + 1] ?? body.length).replace(/\s+$/, ""));
};
/** The 25 real Lichess games the fake ones are made of. */
const TEMPLATES = split(read("lichess.body")).concat(split(read("lichess-since.body")));
/** When the oldest fake game began: 2026-09-01 00:00 UTC. */
export const FAKE_START = Date.UTC(2026, 8, 1);
export const HOUR = 3600 * 1000;

const pad = (n) => String(n).padStart(2, "0");
const tag = (game, name, value) => game.replace(new RegExp("^\\[" + name + " \"[^\"]*\"\\]$", "m"), "[" + name + " \"" + value + "\"]");

/**
 * `n` Lichess games, oldest first: game i is a real one with Site
 * https://lichess.org/fake<i> and its start at FAKE_START + i hours.
 * @returns {{pgn: string, ms: number}[]}
 */
export function fakeGames(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const ms = FAKE_START + i * HOUR;
    const d = new Date(ms);
    const date = d.getUTCFullYear() + "." + pad(d.getUTCMonth() + 1) + "." + pad(d.getUTCDate());
    const time = pad(d.getUTCHours()) + ":" + pad(d.getUTCMinutes()) + ":" + pad(d.getUTCSeconds());
    let g = TEMPLATES[i % TEMPLATES.length];
    g = tag(g, "Site", "https://lichess.org/fake" + String(i).padStart(4, "0"));
    g = tag(tag(tag(g, "Date", date), "UTCDate", date), "UTCTime", time);
    out.push({ pgn: g, ms });
  }
  return out;
}

/**
 * @param {{port?: number, delayMs?: number, games?: number, log?: (line: string) => void}} [o]
 * @returns {Promise<{base: string, port: number, requests: object[], streams: {start: number, end: number|null}[], close: () => Promise<void>}>}
 */
export async function startFakeSyncServer(o = {}) {
  const delayMs = o.delayMs ?? 100;
  const games = fakeGames(o.games ?? 100);
  const requests = [], streams = [];
  const sockets = new Set();
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, "http://127.0.0.1");
    const at = Date.now();
    requests.push({ at, path: url.pathname, query: Object.fromEntries(url.searchParams), ua: req.headers["user-agent"] || "" });
    if (o.log) o.log(req.method + " " + req.url);
    const send = (status, type, body) => { res.writeHead(status, { "content-type": type }); res.end(body); };
    let m = /^\/api\/games\/user\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    const who = m ? m[1] : (/^\/pub\/player\/([a-z0-9_-]+)\/games\//.exec(url.pathname) || [])[1];
    if (who === "offline_user") { req.socket.destroy(); return; }
    if (who === "limited_user") { send(429, "text/plain", "Too Many Requests"); return; }
    if (m) {
      if (who === "missing_user") { send(404, "text/html; charset=utf-8", read("lichess-missing.body")); return; }
      const max = Math.max(1, Number(url.searchParams.get("max")) || 20);
      const since = Number(url.searchParams.get("since")) || 0;
      let list = games.filter((g) => g.ms >= since);
      if (!(since && url.searchParams.get("sort") === "dateAsc")) list = list.slice().reverse();
      list = list.slice(0, max);
      res.writeHead(200, { "content-type": "application/x-chess-pgn" });
      const stream = { start: Date.now(), end: null, games: list.length };
      streams.push(stream);
      for (const g of list) {
        if (res.destroyed) break;
        res.write(g.pgn + "\n\n\n");
        await sleep(delayMs);
      }
      res.end();
      stream.end = Date.now();
      return;
    }
    m = /^\/pub\/player\/([a-z0-9_-]+)\/games\/(archives|(\d{4})\/(\d{2}))$/.exec(url.pathname);
    if (m) {
      await sleep(delayMs);
      if (who === "missing_user") { send(404, "application/json", read("chesscom-missing.body")); return; }
      if (m[2] === "archives") {
        const list = ["2026/08", "2026/09"].map((ym) => "https://api.chess.com/pub/player/" + who + "/games/" + ym);
        send(200, "application/json", JSON.stringify({ archives: list }));
      } else {
        send(200, "application/json", m[2] === "2026/09" ? read("chesscom-month.body") : "{\"games\":[]}");
      }
      return;
    }
    send(404, "text/plain", "not here");
  });
  server.on("connection", (s) => { sockets.add(s); s.on("close", () => sockets.delete(s)); });
  await new Promise((r) => server.listen(o.port || 0, "127.0.0.1", r));
  const port = server.address().port;
  return {
    base: "http://127.0.0.1:" + port, port, requests, streams,
    close: () => new Promise((r) => { for (const s of sockets) s.destroy(); server.close(() => r()); }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = (name, dflt) => { const i = process.argv.indexOf(name); return i > 0 ? Number(process.argv[i + 1]) : dflt; };
  const fake = await startFakeSyncServer({ port: arg("--port", 0), delayMs: arg("--delay", 100), games: arg("--games", 100), log: (l) => console.log(l) });
  console.log("fake sync server: " + fake.base);
}
