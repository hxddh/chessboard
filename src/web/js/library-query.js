/**
 * 棋谱库的查询层 — search, the position index, the name claim and the
 * whole-library PGN (v8-0-plan C1).
 *
 * library.js is the model of one game and of the diagnosis; this is the model
 * of *many*: 1 万局 kept in IndexedDB (library-db.js) and searched here. Pure
 * like library.js — entries in, entries out, no DOM, no store, no clock — so
 * node runs every rule without a browser (scripts/test-library-db.mjs), and
 * it lives in the chunk (libdb-chunk.js), not in the first-paint bundle.
 *
 * The seam for C3's opening explorer. Both calls take the entries (imported
 * games and 本机 games alike: library-ui.js `libraryGames()`) and `pkOf(g)`,
 * which gives a game's position index (library-db.js keeps it beside the
 * entry, never inside it):
 *
 *   LibraryQuery.positionKey(fen) → "placement side castling"
 *       the key a position is filed under. FEN minus the two counters and
 *       minus the en-passant square: two games that reach the same position
 *       one by a double step and one not are the same position to someone
 *       asking "what did I play here", and a key that told them apart would
 *       split the move counts for nothing.
 *
 *   LibraryQuery.gamesWithPosition(games, fenOrKey, pkOf) →
 *     { total, white, draws, black,         // games through the position, by result
 *       moves: [{ san, n, white, draws, black }],   // the move played next, most played first
 *       ids: [...] }                        // the games, in `games` order
 *       White / draws / Black are the board's results (1-0, ½-½, 0-1), not
 *       the player's: an explorer counts for the side to move either way. A
 *       game that reaches the position twice counts once, with the move it
 *       played the first time. A game that ends there has no next move.
 *
 *   LibraryQuery.query(games, q, pkOf) → the entries that match, in order.
 *     q: { text, opponent, eco, from, to, result, color, tc, src, position }
 *       text      any of: either name, event, site, ECO code, opening name
 *       opponent  the other chair's name (either name when unclaimed)
 *       eco       an ECO prefix: "B" · "B2" · "B20"
 *       from / to "YYYY-MM-DD" or "YYYY.MM.DD", inclusive; a game with no
 *                 date is out as soon as either is set
 *       result    "win" | "loss" | "draw" (the player's chair) or
 *                 "1-0" | "0-1" | "1/2-1/2" (the board's)
 *       color     "w" | "b" — the chair the player sat in
 *       tc        "bullet" | "blitz" | "rapid" | "classical" | "daily"
 *       src       "local" (本机, played in this app) | "import"
 *       position  a FEN or a positionKey — games that passed through it
 *
 * Position index: `pk` is one 53-bit hash per position of the mainline, the
 * start included (plies + 1 of them), in a Float64Array — every one exact,
 * because 2^53 is where a double stops counting integers. A search is then
 * one indexOf per game: 10,000 games of 80 plies is 800,000 comparisons, a
 * few milliseconds, with no index structure to keep in step on every save.
 * At 53 bits a false match needs two of ~10^6 positions to collide among
 * 2^53: about one chance in 10^4 per library, which a move count can carry.
 * @module library-query
 */

/** The speeds the time-control filter knows (tcClass). */
const TC_CLASSES = ["bullet", "blitz", "rapid", "classical", "daily"];

/** v8-0-plan C1: FEN without its counters and en-passant square. */
function positionKey(fen) {
  const p = String(fen || "").trim().split(/\s+/);
  return p.slice(0, 3).join(" ");
}

/** Does this look like a FEN rather than an already-made key? */
function isFen(s) {
  return String(s || "").trim().split(/\s+/).length > 3;
}

/**
 * A 53-bit hash of a string (cyrb53, public domain): two 32-bit lanes mixed
 * into one integer a double holds exactly.
 */
function hashKey(str) {
  const s = String(str);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

/** The index of a game whose positions are known: one hash per FEN. */
function keysOfFens(fens) {
  const out = new Float64Array(fens.length);
  for (let i = 0; i < fens.length; i++) out[i] = hashKey(positionKey(fens[i]));
  return out;
}

/**
 * The index of a stored entry, by replaying it — for games that arrive
 * without their positions (a migrated library, a restored one). null when
 * the moves do not replay: such a game is kept, it just cannot be found by
 * position.
 * @param {{sans: string, fen?: string}} g
 * @param {Function} Chess chess.js
 */
function keysOfGame(g, Chess) {
  const sans = String((g && g.sans) || "").split(" ").filter(Boolean);
  let c;
  try { c = g.fen ? new Chess(g.fen) : new Chess(); } catch (_) { return null; }
  const fens = [c.fen()];
  for (const san of sans) {
    let mv = null;
    try { mv = c.move(san, { sloppy: true }); } catch (_) { mv = null; }
    if (!mv) return null;
    fens.push(c.fen());
  }
  return keysOfFens(fens);
}

/**
 * Which of the five speeds a PGN TimeControl is — Lichess's own rule, the
 * estimated duration base + 40 × increment: under 3 minutes bullet, under 8
 * blitz, under 25 rapid. "1/86400" (a move a day) is daily; "-" and "?" are
 * no clock, which is no class.
 */
function tcClass(tc) {
  const s = String(tc || "").trim();
  if (!s || s === "-" || s === "?") return "";
  if (s.includes("/")) return "daily";
  const m = /^(\d+)(?:\+(\d+))?$/.exec(s);
  if (!m) return "";
  const est = Number(m[1]) + 40 * Number(m[2] || 0);
  if (est < 180) return "bullet";
  if (est < 480) return "blitz";
  if (est < 1500) return "rapid";
  return "classical";
}

/** "2026.09.01" / "2026-09-01" → "2026-09-01"; unknown parts widen to the range's edge. */
function dateKey(d, edge) {
  const m = /^(\d{4}|\?{4})[.\-/](\d{2}|\?{2})[.\-/](\d{2}|\?{2})$/.exec(String(d || "").trim());
  if (!m || m[1].includes("?")) return "";
  const fill = (part) => (part.includes("?") ? (edge === "hi" ? "99" : "00") : part);
  return m[1] + "-" + fill(m[2]) + "-" + fill(m[3]);
}

/** The board's result, from any of the shapes it is stored in. */
function boardResult(g) {
  const r = String((g && g.result) || "*");
  return r === "1-0" || r === "0-1" || r === "1/2-1/2" ? r : "*";
}

const lc = (s) => String(s || "").toLowerCase();

/** The other chair's name, or both when the game is not claimed. */
function opponentOf(g) {
  if (g.opp) return lc(g.opp);
  if (g.side === "w") return lc(g.black);
  if (g.side === "b") return lc(g.white);
  return lc(g.white) + "\n" + lc(g.black);
}

/**
 * The filter, compiled once per query: every test is a closure over the
 * already-lowered query, so ten thousand games pay for the parsing once.
 */
function compile(q, pkOf) {
  const tests = [];
  const text = lc(q.text).trim();
  if (text) {
    tests.push((g) => [g.white, g.black, g.opp, g.event, g.site, g.eco, g.ecoName, g.openingName]
      .some((s) => s && lc(s).includes(text)));
  }
  const opp = lc(q.opponent).trim();
  if (opp) tests.push((g) => opponentOf(g).includes(opp));
  const eco = String(q.eco || "").trim().toUpperCase();
  if (eco) tests.push((g) => String(g.eco || "").toUpperCase().startsWith(eco));
  const from = dateKey(String(q.from || "").replace(/-/g, "."), "lo");
  const to = dateKey(String(q.to || "").replace(/-/g, "."), "hi");
  if (from || to) {
    tests.push((g) => {
      const lo = dateKey(g.date, "lo"), hi = dateKey(g.date, "hi");
      if (!lo) return false;
      return (!from || hi >= from) && (!to || lo <= to);
    });
  }
  const res = q.result && q.result !== "all" ? q.result : "";
  if (res === "win" || res === "loss" || res === "draw") tests.push((g) => g.outcome === res);
  else if (res) tests.push((g) => boardResult(g) === res);
  if (q.color === "w" || q.color === "b") tests.push((g) => g.side === q.color);
  if (TC_CLASSES.includes(q.tc)) tests.push((g) => tcClass(g.tc) === q.tc);
  if (q.src === "local") tests.push((g) => g.src === "local");
  else if (q.src === "import") tests.push((g) => g.src !== "local");
  if (q.position) {
    const h = hashKey(isFen(q.position) ? positionKey(q.position) : String(q.position));
    tests.push((g) => { const pk = pkOf && pkOf(g); return !!pk && pk.indexOf(h) >= 0; });
  }
  return tests;
}

/** @returns {object[]} the entries of `games` that match `q`, in order */
function query(games, q, pkOf) {
  const tests = compile(q || {}, pkOf);
  const list = games || [];
  if (!tests.length) return list.slice();
  const out = [];
  outer: for (const g of list) {
    if (!g) continue;
    for (const t of tests) if (!t(g)) continue outer;
    out.push(g);
  }
  return out;
}

/** The mainline as an array, split once per entry. */
const splitCache = new WeakMap();
function sansOf(g) {
  let a = splitCache.get(g);
  if (!a || a.src !== g.sans) {
    a = { src: g.sans, list: String(g.sans || "").split(" ").filter(Boolean) };
    splitCache.set(g, a);
  }
  return a.list;
}

/** See the header: the explorer's question, answered from these games. */
function gamesWithPosition(games, fenOrKey, pkOf) {
  const h = hashKey(isFen(fenOrKey) ? positionKey(fenOrKey) : String(fenOrKey || ""));
  const out = { total: 0, white: 0, draws: 0, black: 0, moves: [], ids: [] };
  const byMove = new Map();
  for (const g of games || []) {
    const pk = g && pkOf ? pkOf(g) : null;
    if (!pk) continue;
    const i = pk.indexOf(h);
    if (i < 0) continue;
    const r = boardResult(g);
    const k = r === "1-0" ? "white" : r === "0-1" ? "black" : r === "1/2-1/2" ? "draws" : null;
    out.total++;
    out.ids.push(g.id);
    if (k) out[k]++;
    const san = sansOf(g)[i];
    if (!san) continue;
    let row = byMove.get(san);
    if (!row) { row = { san, n: 0, white: 0, draws: 0, black: 0 }; byMove.set(san, row); }
    row.n++;
    if (k) row[k]++;
  }
  out.moves = [...byMove.values()].sort((a, b) => b.n - a.n || (a.san < b.san ? -1 : 1));
  return out;
}

/**
 * v8-0-plan C1: who "you" are, from the games themselves.
 *
 * The name on the most games, when it is on at least half of them and on
 * more than any other name — an archive downloaded from one account has its
 * owner in every game, and a file of other people's games has nobody who
 * qualifies, which is the answer "do not guess" (library.js sideOf) wants.
 * Case-insensitive, like the claim itself; the spelling returned is the one
 * seen most.
 * @returns {{name: string, n: number, of: number}|null}
 */
function inferName(games) {
  const count = new Map();
  let of = 0;
  for (const g of games || []) {
    if (!g || g.src === "local") continue;
    of++;
    const seen = new Set();
    for (const raw of [g.white, g.black]) {
      const name = String(raw || "").trim();
      const key = name.toLowerCase();
      if (!name || name === "?" || seen.has(key)) continue;
      seen.add(key);
      let row = count.get(key);
      if (!row) { row = { n: 0, spell: new Map() }; count.set(key, row); }
      row.n++;
      row.spell.set(name, (row.spell.get(name) || 0) + 1);
    }
  }
  const rows = [...count.values()].sort((a, b) => b.n - a.n);
  const best = rows[0];
  if (!best || best.n < 2 || best.n * 2 < of || (rows[1] && rows[1].n === best.n)) return null;
  const name = [...best.spell.entries()].sort((a, b) => b[1] - a[1])[0][0];
  return { name, n: best.n, of };
}

/**
 * The deepest ECO entry along a game's positions — what eco-lookup.js
 * openingForGame answers for its first 24 plies, without the replay: an
 * import (and a 本机 game) has every position from the parse already. The
 * table's keys keep the en-passant square only when a capture is possible
 * (fide.js positionKey), and chess.js writes it after every double step, so
 * a position is looked up both ways.
 * @param {string[]} fens the start and the position after each ply
 * @param {object} table eco.js ECO_BY_KEY
 * @returns {{eco: string, name: string}|null}
 */
function ecoOfFens(fens, table) {
  let best = null;
  for (let i = 0; i < fens.length && i <= 24; i++) {
    const p = String(fens[i]).split(" ");
    const hit = table[p.slice(0, 4).join(" ")] || table[p.slice(0, 3).join(" ") + " -"];
    if (hit) best = hit;
  }
  return best ? { eco: best[0], name: best[1] || "" } : null;
}

/** How many native shards the library is mirrored in (persist.js BULK). */
const SHARDS = 64;
/** The native shard an entry is mirrored in: "lib00" … "lib3f". */
function shardOf(id) {
  let a = 5381;
  const s = String(id);
  for (let i = 0; i < s.length; i++) a = ((a << 5) + a + s.charCodeAt(i)) >>> 0;
  return "lib" + (a % SHARDS).toString(16).padStart(2, "0");
}

/** A PGN tag value, escaped the way the reader unescapes it. */
function tagValue(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** "h:mm:ss" for a [%clk] comment. */
function clockText(s) {
  const n = Math.max(0, Math.round(Number(s) || 0));
  const two = (x) => String(x).padStart(2, "0");
  return Math.floor(n / 3600) + ":" + two(Math.floor(n / 60) % 60) + ":" + two(n % 60);
}

/**
 * One entry as PGN, for the whole-library export (v8-0-plan C1: 整库导出和导回
 * 逐局相等). Everything entryFrom kept comes back: the tags it read, the
 * start position, the mainline and its [%clk] readings — and `LibId`, so a
 * re-import files the game under the id it had, even for an entry imported
 * before Site and Round were kept (its id was made from tags this record no
 * longer has). A tag entryFrom stored empty is left out, so it is read back
 * empty rather than as "?". `extra`, tag pairs written after LibId, is how a
 * 本机 game carries its record (library-local.js localPgn, v8-1-plan T5).
 */
function entryPgn(g, extra) {
  const tags = [["Event", g.event], ["Site", g.site], ["Date", g.date], ["Round", g.round],
    ["White", g.white], ["Black", g.black], ["Result", g.result || "*"]];
  if (g.fen) tags.push(["SetUp", "1"], ["FEN", g.fen]);
  if (g.tc) tags.push(["TimeControl", g.tc]);
  tags.push(["LibId", g.id]);
  if (Array.isArray(extra)) tags.push(...extra);
  let head = "";
  for (const [k, v] of tags) if (v != null && v !== "") head += "[" + k + " \"" + tagValue(v) + "\"]\n";
  const sans = String(g.sans || "").split(" ").filter(Boolean);
  const start = g.fen ? String(g.fen).trim().split(/\s+/) : [];
  const first = start[1] === "b" ? "b" : "w";
  const startNo = Number(start[5]) >= 1 ? Math.floor(Number(start[5])) : 1;
  const out = [];
  sans.forEach((san, i) => {
    const moveNo = startNo + Math.floor((i + (first === "b" ? 1 : 0)) / 2);
    if (i === 0 && first === "b") out.push(moveNo + "...");
    else if ((i % 2 === 0) === (first === "w")) out.push(moveNo + ".");
    out.push(san);
    const c = Array.isArray(g.clk) ? g.clk[i] : null;
    if (c != null) out.push("{[%clk " + clockText(c) + "]}");
  });
  out.push(g.result || "*");
  return head + "\n" + out.join(" ") + "\n";
}

/**
 * v8-0-plan C2 × C1: which site an imported game came from, by its PGN
 * `Site` — the list's source tag. A synced game (sync-ui.js) and the same
 * site's download imported by hand say the same thing; both sites write
 * `Site` into every game (Lichess its game URL, Chess.com "Chess.com").
 * The names are the sites' own, the same in every language.
 * @returns {"Lichess"|"Chess.com"|""}
 */
function siteOf(g) {
  const s = g && g.src !== "local" ? String(g.site || "") : "";
  return /^(https?:\/\/)?([\w-]+\.)?lichess\.org(\/|$)/i.test(s) ? "Lichess"
    : /^(https?:\/\/)?(www\.)?chess\.com(\/|$)/i.test(s) ? "Chess.com" : "";
}

/** The fields a PGN round trip carries — what "逐局相等" compares. */
const PGN_FIELDS = ["id", "white", "black", "date", "event", "site", "round", "result", "plies", "sans", "fen", "tc", "clk"];

export const LibraryQuery = {
  SHARDS, TC_CLASSES, PGN_FIELDS,
  positionKey, hashKey, keysOfFens, keysOfGame, tcClass, dateKey, query, gamesWithPosition,
  inferName, shardOf, entryPgn, ecoOfFens, siteOf,
};
