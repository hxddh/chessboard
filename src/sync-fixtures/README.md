# Real sync responses (v8-0-plan C2)

Fetched on 2026-09-29 (05:21 UTC) by the manual workflow `.github/workflows/sync-samples.yml`
(defaults: Lichess `thibault`, Chess.com `erik`, max 5), with the URLs and the User-Agent
`chessboard (+https://github.com/hxddh/chessboard)` that `src/main.zig` `chess.fetchGames` uses,
and copied here byte for byte from the run's log. They are public games of public accounts.

| file | request | status |
| --- | --- | --- |
| `lichess.body` | `https://lichess.org/api/games/user/thibault?max=5&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false` | 200 `application/x-chess-pgn`, 5 games |
| `lichess-missing.body` | `https://lichess.org/api/games/user/no-such-user-chessboard-sample-404?max=1` | 404 `text/html` (a web page, not JSON) |
| `chesscom-archives.body` | `https://api.chess.com/pub/player/erik/games/archives` | 200 JSON, 231 months since 2007/07 |
| `chesscom-month.body` | `https://api.chess.com/pub/player/erik/games/2026/09` (the last archive) | 200 JSON, 13 games: 9 `chess`, 4 `chess960` |
| `chesscom-missing.body` | `https://api.chess.com/pub/player/no-such-user-chessboard-sample-404/games/archives` | 404 JSON `{"code":0,"message":…}` |

`headers.txt` has each response's status line and headers (the per-visitor Cloudflare cookie
removed). Read by the Zig tests in `src/main.zig` (`@embedFile`) and by `scripts/test-sync.mjs` /
`scripts/test-sync-e2e.mjs` (through `scripts/sync-fixtures.mjs`). `.gitattributes` keeps the bytes
as fetched on every checkout (no CRLF on Windows).
