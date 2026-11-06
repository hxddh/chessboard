/**
 * The board's scene graph, pure: pieces and overlays (highlights, legal-move
 * hints, arrows, marks) as nodes whose numeric props tween.
 *
 * Pieces keep an identity across positions. A new placement is matched to the
 * old one the way a person reads it: a man on the same square is the same man;
 * a man that appears is the nearest one of its kind that disappeared (so a
 * castle slides both king and rook); a queen on the last rank with no queen
 * gone is the pawn that promoted; whatever disappeared unmatched was captured
 * and fades out where it stood.
 *
 * Positions are in board space (x = file, y = rank, 0–7); the renderer maps
 * them to the screen, so flipping the board never animates.
 * @module board/scene
 */
import { cubicInOut, progress, lerpProps } from "./tween.js";
import { sqFile, sqRank } from "./geometry.js";

export function createScene() {
  const pieces = new Map();   // id → node
  const bySq = new Map();     // square → id, live pieces only
  const overlays = new Map(); // key → node
  let nextId = 1;
  let placed = false;

  const at = (sq, alpha = 1, scale = 1) => ({ x: sqFile(sq), y: sqRank(sq), alpha, scale });
  const valueOf = (n, now) => lerpProps(n.from, n.to, cubicInOut(progress(n.start, n.dur, now)));
  function retarget(n, to, now, dur) {
    n.from = valueOf(n, now);
    n.to = to;
    n.start = now;
    n.dur = dur;
  }
  const dist = (a, b) => Math.hypot(sqFile(a) - sqFile(b), sqRank(a) - sqRank(b));

  /**
   * @param {Map<string, string>} placement square → piece code
   * @param {{ now: number, ms: number, snap?: Iterable<string> }} o
   *   `snap`: squares whose arriving piece lands without a tween (a drop)
   * @returns {{ moved: Array<{id: number, from: string, to: string}>, captured: string[], appeared: string[] }}
   */
  function setPieces(placement, { now, ms, snap = [] }) {
    const snapSet = new Set(snap);
    const dur = placed ? ms : 0;
    placed = true;
    const keep = new Map(), missing = [];
    for (const [sq, code] of placement) {
      const id = bySq.get(sq);
      if (id && pieces.get(id).code === code) keep.set(sq, id);
      else missing.push([sq, code]);
    }
    let vanished = [...bySq].filter(([sq]) => !keep.has(sq)).map(([, id]) => pieces.get(id));
    const out = { moved: [], captured: [], appeared: [] };
    const take = (code, sq, test) => {
      let best = null;
      for (const n of vanished) if (test(n) && (!best || dist(n.sq, sq) < dist(best.sq, sq))) best = n;
      if (best) vanished = vanished.filter((n) => n !== best);
      return best;
    };
    for (const [sq, code] of missing) {
      let n = take(code, sq, (v) => v.code === code);
      const lastRank = sqRank(sq) === (code[0] === "w" ? 7 : 0);
      if (!n && lastRank && code[1] !== "p") n = take(code, sq, (v) => v.code === code[0] + "p");
      if (n) {
        out.moved.push({ id: n.id, from: n.sq, to: sq });
        n.code = code;
        n.sq = sq;
        retarget(n, at(sq), now, snapSet.has(sq) ? 0 : dur);
        keep.set(sq, n.id);
      } else {
        const id = nextId++;
        pieces.set(id, { id, code, sq, from: at(sq, 0), to: at(sq), start: now, dur, leaving: false });
        keep.set(sq, id);
        out.appeared.push(sq);
      }
    }
    for (const n of vanished) {
      out.captured.push(n.sq);
      n.leaving = true;
      if (dur <= 0) pieces.delete(n.id);
      else retarget(n, at(n.sq, 0, 0.8), now, dur);
    }
    bySq.clear();
    for (const [sq, id] of keep) bySq.set(sq, id);
    return out;
  }

  /**
   * @param {Array<{key: string, kind: string, color?: string, alpha?: number}>} list
   *   each with numeric props (x, y, x2, y2…) that tween, and `alpha` (default 1)
   */
  function setOverlays(list, { now, ms }) {
    const seen = new Set();
    for (const o of list) {
      const { key, kind, color, ...props } = o;
      seen.add(key);
      const to = { alpha: 1, ...props };
      const n = overlays.get(key);
      if (!n) overlays.set(key, { key, kind, color, from: { ...to, alpha: 0 }, to, start: now, dur: ms, leaving: false });
      else {
        n.kind = kind; n.color = color; n.leaving = false;
        const same = Object.keys(to).every((k) => n.to[k] === to[k]);
        if (!same) retarget(n, to, now, ms);
      }
    }
    for (const n of overlays.values()) {
      if (seen.has(n.key) || n.leaving) continue;
      n.leaving = true;
      if (ms <= 0) overlays.delete(n.key);
      else retarget(n, { ...n.to, alpha: 0 }, now, ms);
    }
  }

  /** Everything as it stands at `now`, leaving nodes first so arrivals draw over them. */
  function frame(now) {
    let busy = false;
    const ps = [], os = [];
    for (const n of pieces.values()) {
      const p = progress(n.start, n.dur, now);
      if (p >= 1 && n.leaving) { pieces.delete(n.id); continue; }
      if (p < 1) busy = true;
      ps.push({ id: n.id, code: n.code, sq: n.sq, leaving: n.leaving, ...valueOf(n, now) });
    }
    ps.sort((a, b) => (b.leaving - a.leaving));
    for (const n of overlays.values()) {
      const p = progress(n.start, n.dur, now);
      if (p >= 1 && n.leaving) { overlays.delete(n.key); continue; }
      if (p < 1) busy = true;
      os.push({ key: n.key, kind: n.kind, color: n.color, ...valueOf(n, now) });
    }
    return { pieces: ps, overlays: os, busy };
  }

  /** Stop every tween where it would end (reduced motion switched on mid-flight). */
  function finish() {
    for (const n of [...pieces.values(), ...overlays.values()]) n.dur = 0;
  }

  return { setPieces, setOverlays, frame, finish, pieceAt: (sq) => (bySq.has(sq) ? pieces.get(bySq.get(sq)) : null) };
}
