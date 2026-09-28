/**
 * Replay SAN fast enough to index a library (v8-0-plan C3).
 *
 * The library stores each game as its SAN, and the explorer needs the
 * position before every move. chess.js answers that at ~50 µs a ply — its
 * `move("Nf3")` writes the SAN of every legal move (each one made, tested
 * for check and mate, unmade) to find the one it was given — and the
 * repetition key's en-passant test (ChessFide.positionKey) costs as much
 * again: 500 games × 50 plies came to 3.4 s, measured. This board does only
 * what replaying a *recorded* game needs: find the piece the SAN names,
 * move it, and say the key. Legality is taken on trust from the import
 * (library.js keeps only games chess.js parsed), with two exceptions where
 * the SAN alone cannot say which piece moved or whether an en-passant right
 * exists — there the king-safety test below decides, as FIDE does.
 *
 * `key()` is exactly ChessFide.positionKey — placement, side, castling, and
 * the en-passant square only when a capture there is legal; the static test
 * holds the two equal over thousands of random games.
 * @module explorer/replay
 */

const FILES = "abcdefgh";
const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const KNIGHT = [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]];
const KING = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];
const ROOK = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const BISHOP = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const SAN = /^([NBRQK])?([a-h])?([1-8])?x?([a-h][1-8])(?:=?([NBRQ]))?[+#]?$/;

const sq = (s) => FILES.indexOf(s[0]) + 8 * (Number(s[1]) - 1);
const name = (i) => FILES[i & 7] + ((i >> 3) + 1);
const white = (p) => p !== "." && p === p.toUpperCase();
const colour = (p) => (p === "." ? null : white(p) ? "w" : "b");
const onBoard = (f, r) => f >= 0 && f < 8 && r >= 0 && r < 8;

/** Is square `i` attacked by side `by` on board `b` (64 chars, a1 = 0)? */
function attacked(b, i, by) {
  const f = i & 7, r = i >> 3;
  const own = (p, t) => p !== "." && colour(p) === by && p.toLowerCase() === t;
  const pr = by === "w" ? r - 1 : r + 1; // where an attacking pawn stands
  for (const df of [-1, 1]) if (onBoard(f + df, pr) && own(b[pr * 8 + f + df], "p")) return true;
  for (const [df, dr] of KNIGHT) if (onBoard(f + df, r + dr) && own(b[(r + dr) * 8 + f + df], "n")) return true;
  for (const [df, dr] of KING) if (onBoard(f + df, r + dr) && own(b[(r + dr) * 8 + f + df], "k")) return true;
  for (const [dirs, t] of [[ROOK, "r"], [BISHOP, "b"]]) {
    for (const [df, dr] of dirs) {
      for (let k = 1; onBoard(f + df * k, r + dr * k); k++) {
        const p = b[(r + dr * k) * 8 + f + df * k];
        if (p === ".") continue;
        if (own(p, t) || own(p, "q")) return true;
        break;
      }
    }
  }
  return false;
}

/** Can the piece on `from` reach `to` by its move shape, nothing in between? */
function reaches(b, from, to, t) {
  const df = (to & 7) - (from & 7), dr = (to >> 3) - (from >> 3);
  const adf = Math.abs(df), adr = Math.abs(dr);
  if (t === "n") return (adf === 1 && adr === 2) || (adf === 2 && adr === 1);
  if (t === "k") return adf <= 1 && adr <= 1 && (adf || adr);
  const straight = !df || !dr, diag = adf === adr;
  if ((t === "r" && !straight) || (t === "b" && !diag) || (t === "q" && !straight && !diag) || (!df && !dr)) return false;
  const sf = Math.sign(df), sr = Math.sign(dr);
  for (let k = 1; k < Math.max(adf, adr); k++) if (b[from + (sr * 8 + sf) * k] !== ".") return false;
  return true;
}

/**
 * A board to replay SAN on.
 * @param {string} [fen] a start position (the standard array by default)
 */
export function createReplay(fen) {
  const f = String(fen || START).split(" ");
  const b = [];
  f[0].split("/").reverse().forEach((row) => { for (const c of row) { if (/\d/.test(c)) for (let k = 0; k < Number(c); k++) b.push("."); else b.push(c); } });
  let side = f[1] === "b" ? "b" : "w", castle = f[2] && f[2] !== "-" ? f[2] : "", ep = f[3] && f[3] !== "-" ? sq(f[3]) : -1;
  const kingOf = (s) => b.indexOf(s === "w" ? "K" : "k");
  /** Would making from→to (plus an en-passant removal) leave `side`'s king attacked? */
  function leavesCheck(from, to, epTake) {
    const save = [b[from], b[to], epTake >= 0 ? b[epTake] : null];
    b[to] = b[from]; b[from] = ".";
    if (epTake >= 0) b[epTake] = ".";
    const bad = attacked(b, kingOf(side), side === "w" ? "b" : "w");
    b[from] = save[0]; b[to] = save[1];
    if (epTake >= 0) b[epTake] = save[2];
    return bad;
  }
  const dropRights = (i) => {
    const lose = { 0: "Q", 7: "K", 56: "q", 63: "k" }[i];
    if (lose) castle = castle.replace(lose, "");
  };

  /** Play one SAN. @returns {boolean} false when it cannot be read here */
  function move(san) {
    const s = String(san).replace(/[+#?!]+$/, "");
    const up = side === "w";
    const back = up ? 0 : 56;
    if (s === "O-O" || s === "O-O-O") {
      const long = s === "O-O-O";
      const k = back + 4, r = back + (long ? 0 : 7);
      b[back + (long ? 2 : 6)] = b[k]; b[back + (long ? 3 : 5)] = b[r];
      b[k] = "."; b[r] = ".";
      castle = castle.replace(up ? /[KQ]/g : /[kq]/g, "");
      ep = -1;
      side = up ? "b" : "w";
      return true;
    }
    const m = SAN.exec(s);
    if (!m) return false;
    const t = (m[1] || "P").toLowerCase(), to = sq(m[4]);
    const mine = up ? t.toUpperCase() : t;
    let from = -1, epTake = -1;
    if (t === "p") {
      const dir = up ? 8 : -8;
      if (m[2] && FILES.indexOf(m[2]) !== (to & 7)) { // a capture: from the named file, one rank back
        from = to - dir + (FILES.indexOf(m[2]) - (to & 7));
        if (to === ep && b[to] === ".") epTake = to - dir;
      } else from = b[to - dir] === mine ? to - dir : to - 2 * dir;
      if (b[from] !== mine) return false;
    } else {
      const cands = [];
      for (let i = 0; i < 64; i++) {
        if (b[i] !== mine) continue;
        if (m[2] && FILES[i & 7] !== m[2]) continue;
        if (m[3] && String((i >> 3) + 1) !== m[3]) continue;
        if (reaches(b, i, to, t)) cands.push(i);
      }
      // two pieces can reach, and the SAN names neither: one of them is pinned
      const legal = cands.length > 1 ? cands.filter((i) => !leavesCheck(i, to, -1)) : cands;
      if (legal.length !== 1) return false;
      from = legal[0];
    }
    const target = b[to];
    if (target !== "." && colour(target) === side) return false;
    b[to] = m[5] ? (up ? m[5] : m[5].toLowerCase()) : b[from];
    b[from] = ".";
    if (epTake >= 0) b[epTake] = ".";
    if (t === "k") castle = castle.replace(up ? /[KQ]/g : /[kq]/g, "");
    dropRights(from); dropRights(to);
    ep = t === "p" && Math.abs(to - from) === 16 ? (from + to) / 2 : -1;
    side = up ? "b" : "w";
    return true;
  }

  /** ChessFide.positionKey of the position on the board. */
  function key() {
    const rows = [];
    for (let r = 7; r >= 0; r--) {
      let row = "", n = 0;
      for (let c = 0; c < 8; c++) {
        const p = b[r * 8 + c];
        if (p === ".") { n++; continue; }
        if (n) { row += n; n = 0; }
        row += p;
      }
      rows.push(n ? row + n : row);
    }
    let e = "-";
    if (ep >= 0) {
      // the right exists only if a pawn can take there without exposing its king
      const pawn = side === "w" ? "P" : "p", pushed = ep + (side === "w" ? -8 : 8);
      for (const df of [-1, 1]) {
        const at = pushed + df;
        if ((pushed & 7) + df < 0 || (pushed & 7) + df > 7 || b[at] !== pawn) continue;
        if (!leavesCheck(at, ep, pushed)) { e = name(ep); break; }
      }
    }
    return rows.join("/") + " " + side + " " + (castle || "-") + " " + e;
  }

  return { move, key };
}
