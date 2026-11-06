/**
 * The 20.0 opponents in Node: the app's engine service over Maia-3 (in this
 * thread) and the vendored Stockfish, and one game between two profiles the
 * way the app plays it — engine.bestMove(fen, profile, ctx) with the same
 * history and looks, resignation by opponents/mind.js. Shared by
 * scripts/ladder20.mjs and scripts/test-convert.mjs.
 */
import { createEngineService } from "../../src/app/services/engine.js";
import { maia3Backend, inlineRunner } from "../../src/app/services/maia3/backend.js";
import { Chess } from "../../src/app/core/chess.js";
import { loadInNode } from "../app/maia3-parity.mjs";
import { nodeStockfish } from "./sf-backend.mjs";

export async function nodeService() {
  const sf = await nodeStockfish();
  const svc = createEngineService(maia3Backend({ analyst: sf, runner: inlineRunner(loadInNode()) }));
  return { svc, sf };
}

export function rngFrom(seed) {
  let x = (seed >>> 0) || 1;
  // xorshift32: a pairing's games are repeatable
  return () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x / 4294967296; };
}
export function seedOf(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/**
 * One game. Ends by the rules, by a resignation, or at `cap` plies (a draw;
 * `capWins` scores it for the side the last look favours by ≥ 600 instead —
 * not used by the ladder).
 * @param {object} o { svc, white, black, startFen?, opening? (SAN list), random, cap?, onMove? }
 */
export async function playGame({ svc, white, black, startFen, opening = [], random, cap = 300, onMove }) {
  const g = startFen ? new Chess(startFen) : new Chess();
  for (const san of opening) g.move(san);
  const fens = startFen ? [startFen] : [new Chess().fen()];
  // the opening's positions are the game so far (Maia-3's history)
  { const h = new Chess(startFen || undefined); for (const san of opening) { h.move(san); fens.push(h.fen()); } }
  const looks = { w: [], b: [] };
  let plies = 0;
  const think = { w: [], b: [] };
  while (!g.game_over() && plies < cap) {
    const side = g.turn();
    const prof = side === "w" ? white : black;
    const fen = g.fen();
    const r = await svc.bestMove(fen, prof, { history: fens.slice(0, -1), looks: looks[side], random });
    looks[side].push(r.look);
    think[side].push(r.thinkMs);
    if (r.resign) return { result: side === "w" ? "0-1" : "1-0", how: "resign", plies, fen, think, looks };
    if (!r.move) break;
    const mv = g.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] || "q" });
    if (!mv) throw new Error("illegal " + r.move + " in " + fen);
    fens.push(g.fen());
    plies++;
    if (onMove) onMove({ side, uci: r.move, san: mv.san, fen, r });
  }
  if (g.in_checkmate()) return { result: g.turn() === "w" ? "0-1" : "1-0", how: "mate", plies, fen: g.fen(), think, looks };
  return { result: "1/2", how: g.game_over() ? "rules" : "cap", plies, fen: g.fen(), think, looks };
}
