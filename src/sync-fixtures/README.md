# Real sync responses (v8-0-plan C2)

Fetched on 2026-09-29 (05:21 UTC) by the manual workflow `.github/workflows/sync-samples.yml` (run 36525450431)
(defaults: Lichess `thibault`, Chess.com `erik`, max 5), with the URLs and the User-Agent
`chessboard (+https://github.com/hxddh/chessboard)` that `src/main.zig` `chess.fetchGames` uses,
and copied here byte for byte from the run's log. They are public games of public accounts.

| file | request | status |
| --- | --- | --- |
| `lichess.body` | `https://lichess.org/api/games/user/thibault?max=5&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false` | 200 `application/x-chess-pgn`, 5 games |
| `lichess-since.body` | `https://lichess.org/api/games/user/thibault?max=20&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false&since=<run time − 30 days>&sort=dateAsc` (fetched 2026-09-30, see below) | 200 `application/x-chess-pgn`, 20 games, oldest first: 2026-09-10 06:36:17 → 2026-09-12 20:30:55 UTC |
| `lichess-missing.body` | `https://lichess.org/api/games/user/no-such-user-chessboard-sample-404?max=1` | 404 `text/html` (a web page, not JSON) |
| `chesscom-archives.body` | `https://api.chess.com/pub/player/erik/games/archives` | 200 JSON, 231 months since 2007/07 |
| `chesscom-month.body` | `https://api.chess.com/pub/player/erik/games/2026/09` (the last archive) | 200 JSON, 13 games: 9 `chess`, 4 `chess960` |
| `chesscom-missing.body` | `https://api.chess.com/pub/player/no-such-user-chessboard-sample-404/games/archives` | 404 JSON `{"code":0,"message":…}` |

`lichess-since.body` came from a second run, 2026-09-30 (17:27 UTC, run 36751390621, `max` 20),
with the incremental sync's URL (`src/main.zig` lichessUrl with a `since`, v8-1-plan T4 / M2 review
P2-2): `since=` the run's clock less 30 days, `sort=dateAsc`. The log does not print that `since`; the
Fetch step began at 17:26:54 and the answer is dated 17:27:01, so it lay in 2026-08-31 17:26:54–17:27:01
UTC. The games run in strictly ascending UTCDate / UTCTime (v8-2-plan V2). The other files are still
the 2026-09-29 ones: in that second run Chess.com answered 404 for erik's 2026/09 month.

`headers.txt` has each response's status line and headers (the per-visitor Cloudflare cookie
removed). Read by the Zig tests in `src/main.zig` (`@embedFile`) and by `scripts/test-sync.mjs` /
`scripts/test-sync-e2e.mjs` (through `scripts/sync-fixtures.mjs`). `.gitattributes` keeps the bytes
as fetched on every checkout (no CRLF on Windows).
