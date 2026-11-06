/**
 * King and pawn against king, solved exactly by retrograde analysis — the
 * endgame drills' verdict that needs no engine (v20-0-plan §4 F1: 「你让出了
 * 对王」 is said only when the position after the move is proved a draw and
 * the one before was proved a win).
 *
 * The usual bitbase recipe: every position with White's pawn, either side on
 * move, classified WIN (for the pawn's side) or DRAW by iterating to a fixed
 * point. A pawn that reaches the eighth rank safely (the new queen not
 * simply taken) wins; Black taking the pawn, or being stalemated, draws.
 * 2 × 64 × 64 × 48 positions, solved once on first use (about half a second).
 * @module core/facts-kpk
 */
import { load, gridOf } from "./facts.js";

const UNKNOWN = 0, WIN = 1, DRAW = 2;
let table = null;

const F = (s) => s & 7, R = (s) => s >> 3;
const dist = (a, b) => Math.max(Math.abs(F(a) - F(b)), Math.abs(R(a) - R(b)));
const KDIR = [-9, -8, -7, -1, 1, 7, 8, 9];
function kingSteps(s) {
  const out = [];
  for (const d of KDIR) {
    const t = s + d;
    if (t < 0 || t > 63 || Math.abs(F(t) - F(s)) > 1) continue;
    out.push(t);
  }
  return out;
}
const STEPS = Array.from({ length: 64 }, (_, s) => kingSteps(s));
// index: stm (0 white, 1 black) | wk | bk | pawn (8..55 → 0..47)
const idx = (stm, wk, bk, p) => ((stm * 64 + wk) * 64 + bk) * 48 + (p - 8);
const pawnHits = (p, s) => R(s) === R(p) + 1 && Math.abs(F(s) - F(p)) === 1;

function solve() {
  const t = new Int8Array(2 * 64 * 64 * 48);
  const legal = (stm, wk, bk, p) => {
    if (wk === bk || wk === p || bk === p || dist(wk, bk) <= 1) return false;
    // White to move with Black in check from the pawn cannot arise from a legal Black move
    if (stm === 0 && pawnHits(p, bk)) return false;
    return true;
  };
  const ILLEGAL = 3;
  for (let stm = 0; stm < 2; stm++) for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 8; p < 56; p++) {
    if (!legal(stm, wk, bk, p)) t[idx(stm, wk, bk, p)] = ILLEGAL;
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (let stm = 0; stm < 2; stm++) for (let wk = 0; wk < 64; wk++) for (let bk = 0; bk < 64; bk++) for (let p = 8; p < 56; p++) {
      const i = idx(stm, wk, bk, p);
      if (t[i] !== UNKNOWN) continue;
      let r = UNKNOWN;
      if (stm === 0) {
        // White: any move to a WIN wins; all moves to DRAW draw
        let allDraw = true, any = false;
        for (const s of STEPS[wk]) {
          if (s === p || dist(s, bk) <= 1) continue;
          any = true;
          const v = t[idx(1, s, bk, p)];
          if (v === WIN) { r = WIN; break; }
          if (v !== DRAW) allDraw = false;
        }
        if (r !== WIN) {
          const one = p + 8;
          if (one !== wk && one !== bk) {
            any = true;
            if (R(one) === 7) {
              // a queen the black king cannot simply take
              if (dist(bk, one) > 1 || dist(wk, one) <= 1) r = WIN;
            } else {
              const v = t[idx(1, wk, bk, one)];
              if (v === WIN) r = WIN; else if (v !== DRAW) allDraw = false;
              const two = p + 16;
              if (r !== WIN && R(p) === 1 && two !== wk && two !== bk) {
                const v2 = t[idx(1, wk, bk, two)];
                if (v2 === WIN) r = WIN; else if (v2 !== DRAW) allDraw = false;
              }
            }
          }
          if (r !== WIN && any && allDraw) r = DRAW;
          if (!any) r = DRAW;
        }
      } else {
        let allWin = true, any = false;
        for (const s of STEPS[bk]) {
          if (s === wk || dist(s, wk) <= 1 || pawnHits(p, s)) continue;
          any = true;
          if (s === p) { r = DRAW; break; }        // the pawn is taken, and nothing guards it (dist checked)
          const v = t[idx(0, wk, s, p)];
          if (v === DRAW) { r = DRAW; break; }
          if (v !== WIN) allWin = false;
        }
        if (r !== DRAW) {
          if (!any) r = pawnHits(p, bk) ? WIN : DRAW;   // mate cannot happen here; no move and not in check is stalemate
          else if (allWin) r = WIN;
        }
      }
      if (r !== UNKNOWN) { t[i] = r; changed = true; }
    }
  }
  return t;
}

/**
 * The exact verdict of a king-and-pawn-against-king position: "win" (for the
 * pawn's side) or "draw"; null when `fen` is not that ending.
 * @returns {null|{ result: "win"|"draw", strong: "w"|"b" }}
 */
export function kpk(fen) {
  const g = load(fen);
  if (!g) return null;
  const grid = gridOf(g);
  const men = Object.entries(grid);
  if (men.length !== 3) return null;
  const pawn = men.find(([, p]) => p.type === "p");
  if (!pawn || men.filter(([, p]) => p.type === "k").length !== 2) return null;
  const strong = pawn[1].color;
  const sq = (s) => {
    const f = s.charCodeAt(0) - 97, r = Number(s[1]) - 1;
    return (strong === "w" ? r : 7 - r) * 8 + f;
  };
  const wk = sq(men.find(([, p]) => p.type === "k" && p.color === strong)[0]);
  const bk = sq(men.find(([, p]) => p.type === "k" && p.color !== strong)[0]);
  const p = sq(pawn[0]);
  if (p < 8 || p > 55) return null;
  if (!table) table = solve();
  const stm = g.turn() === strong ? 0 : 1;
  const v = table[idx(stm, wk, bk, p)];
  return v === WIN ? { result: "win", strong } : v === DRAW || v === 0 ? { result: "draw", strong } : null;
}
