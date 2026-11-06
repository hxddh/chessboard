/**
 * The audit's oracle for scripts/audit-explain.mjs (v20-0-plan §4 F1/F2).
 *
 * The 19.0 sentences are judged by the 14.0 oracle (coach-oracle.mjs),
 * unchanged. The v2 sentences make claims of three kinds, each checked here
 * against the deep search (1 M nodes: d.after / d.before / d.reply / d.best,
 * the positions after the move, before it, after the claimed reply, after
 * the better move) and against board facts written apart from core/facts.js
 * (plain chess.js move generation, no static exchange):
 *
 *   what the reply does   the deep search accepts the reply (its first
 *                         choice, or as good within 0.8), and along the reply
 *                         and the deep line from it the mover ends down what
 *                         is named (a pawn 1, a piece 2) — walked to a quiet point
 *   what is on the board  the threat / the loose man / the guard / the
 *                         double attack is there, as the rules have it
 *   what the better move  the deep search prefers it (first choice, or ≥ 0.5
 *   does                  better than the move played) and its line wins
 *
 * A positional sentence is right when the deep search calls the move a
 * mistake against the better one (≥ 0.5), the deep line after it loses no
 * material for the mover (else the material is the story), and the fact
 * holds on the board.
 * @module explain-oracle
 */
import { oracle as oracle14 } from "./coach-oracle.mjs";

const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const other = (c) => (c === "w" ? "b" : "w");
const withTurn = (fen, c) => { const p = fen.split(" "); p[1] = c; p[3] = "-"; return p.join(" "); };
const cpFor = (s, side) => (s == null ? null : side === "w" ? s : -s);

function play(g, m) { try { return g.move(m) || null; } catch { return null; } }
function load(Chess, fen) { try { return new Chess(fen); } catch { return null; } }
function walk(Chess, fen, sans) {
  const g = load(Chess, fen);
  const out = [];
  if (!g) return out;
  for (const s of sans) { const m = play(g, s); if (!m) break; out.push(m); if (g.in_checkmate()) { out.mate = true; break; } }
  return out;
}
/** what `side` wins along `moves`, to a quiet point (coach-oracle's netAlong) */
function netAlong(moves, side) {
  let s = 0, n = 0;
  for (const m of moves) {
    const sign = m.color === side ? 1 : -1;
    if (m.captured) s += sign * VALUE[m.captured];
    if (m.promotion) s += sign * (VALUE[m.promotion] - 1);
    n++;
    if (n >= 4 && !m.captured && n % 2 === 0) break;
  }
  if (moves.mate) s += moves[moves.length - 1].color === side ? 100 : -100;
  return s;
}
/** `color`'s legal moves onto `sq`, with a stand-in of the other colour there (so a guard of its own man counts) */
function reachers(Chess, fen, sq, color) {
  const g = load(Chess, withTurn(fen, color));
  if (!g) return [];
  const here = g.get(sq);
  if (here && here.color === color) { g.remove(sq); g.put({ type: "n", color: other(color) }, sq); }
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return []; }
  return ms.filter((m) => m.to === sq);
}
/**
 * Does `color` win the man on `sq` by starting the captures there? The
 * exchange searched in full (every capturer, each side free to stop), not the
 * cheapest-first rule core/facts.js uses — the two are written apart.
 */
function wins(Chess, fen, sq, color) {
  const g = load(Chess, withTurn(fen, color));
  const p = g && g.get(sq);
  if (!p || p.color === color || p.type === "k") return false;
  return exchange(g, sq, 0) > 0;
}
function exchange(g, sq, depth) {
  if (depth > 6) return 0;
  let best = 0;
  let ms = [];
  try { ms = g.moves({ verbose: true }) || []; } catch { return 0; }
  for (const m of ms) {
    if (m.to !== sq || !m.captured) continue;
    g.move(m);
    const v = VALUE[m.captured] + (m.promotion ? VALUE[m.promotion] - 1 : 0) - exchange(g, sq, depth + 1);
    g.undo();
    if (v > best) best = v;
  }
  return best;
}
function mateInOne(Chess, fen) {
  const g = load(Chess, fen);
  if (!g) return false;
  for (const m of g.moves({ verbose: true })) { g.move(m); const mate = g.in_checkmate(); g.undo(); if (mate) return true; }
  return false;
}
const sqOfArg = (a) => (a && a.sq) || null;

export function oracle(r, d, Chess) {
  if (!r.res) return oracle14({ ...r, ex: r.ex }, d, Chess);
  const res = r.res;
  if (!res.key) return { verdict: "none", reason: "没有句子" };
  if (res.args == null) return oracle14({ ...r, ex: res.facts.ex19, key: res.key }, d, Chess);

  const why = [];
  const side = r.fen.split(" ")[1], them = other(side);
  const g0 = load(Chess, r.fen);
  const pm = play(g0, r.played);
  const afterFen = g0.fen();
  const credit = (pm.captured ? VALUE[pm.captured] : 0) + (pm.promotion ? VALUE[pm.promotion] - 1 : 0);
  const args = res.args;
  const f = res.facts;
  const dAfter = cpFor(d.after && d.after.scalar, side);
  const dBefore = cpFor(d.before && d.before.scalar, side);

  const replySan = (f.ex19 && f.ex19.refute && f.ex19.refute.san) || (r.line && r.line[0]);
  const replyOk = () => {
    if (!replySan) { why.push("没有应着"); return false; }
    if (d.after.pv[0] === replySan) { why.push("深搜首选同为 " + replySan); return true; }
    const rx = d.reply ? cpFor(d.reply.scalar, side) : null;
    if (rx != null && dAfter != null && rx - dAfter <= 80) { why.push(`深搜认可 ${replySan}（${rx} 对最佳 ${dAfter}）`); return true; }
    why.push(`深搜不认 ${replySan}（之后 ${rx}，最佳 ${dAfter}）`);
    return false;
  };
  const lost = () => -netAlong(walk(Chess, afterFen, [replySan].concat(d.reply ? d.reply.pv : [])), side) - credit;
  const lossOk = (piece) => {
    if (d.after.scalar != null && Math.abs(d.after.scalar) >= 9000 && dAfter < 0) { why.push("深搜：被杀"); return true; }
    const net = lost(), need = VALUE[piece] >= 3 ? 2 : 1;
    why.push(`深搜线上净丢 ${net}${net >= need ? "" : "，撑不起「丢" + piece + "」"}`);
    return net >= need;
  };
  const betterSan = f.best;
  const betterOk = () => {
    if (!betterSan) { why.push("没有更好的一步"); return false; }
    if (d.before.pv[0] === betterSan) { why.push("深搜首选同为 " + betterSan); return true; }
    const bx = d.best ? cpFor(d.best.scalar, side) : null;
    if (bx != null && dAfter != null && bx - dAfter >= 50) { why.push(`深搜：${betterSan} 比所走好 ${bx - dAfter}cp`); return true; }
    why.push(`深搜：${betterSan} ${bx} 对所走 ${dAfter}，不算更好`);
    return false;
  };
  const moveBad = () => {
    const ok = dBefore != null && dAfter != null && dBefore - dAfter >= 50;
    why.push(ok ? `深搜：这步丢了 ${dBefore - dAfter}cp` : `深搜：这步只差 ${dBefore - dAfter}cp`);
    return ok;
  };
  const sanTo = (fen, san, color) => { const g = load(Chess, withTurn(fen, color)); const m = g && play(g, san); return m; };

  let ok = false;
  const k = res.key;
  switch (k) {
    case "ex.threatFree": case "ex.threatTake": {
      // before the move, with the opponent on move, the same capture already took the man
      const m = sanTo(r.fen, args[0].san, them);
      const pre = !!m && m.captured === args[1].piece && wins(Chess, withTurn(r.fen, them), m.to, them);
      const free = !!m && !reachers(Chess, r.fen, m.to, side).length;
      why.push(pre ? `走之前 ${args[0].san} 就能吃${args[1].piece}` : "走之前并不能吃");
      if (k === "ex.threatFree" && !free) why.push("说没有保护，其实有保护");
      ok = pre && (k !== "ex.threatFree" || free) && replyOk() && lossOk(args[1].piece);
      break;
    }
    case "ex.movedFree": case "ex.movedTake": {
      const free = !reachers(Chess, afterFen, pm.to, side).length;
      const w = wins(Chess, afterFen, pm.to, them);
      why.push(w ? `${pm.to} 的子会被吃` : `${pm.to} 的子吃不掉`);
      if (k === "ex.movedFree" && !free) why.push("说没有保护，其实有保护");
      ok = w && (k !== "ex.movedFree" || free) && replyOk() && lossOk(args[1].piece);
      break;
    }
    case "ex.unguarded": case "ex.looseAfter": {
      const sq = sqOfArg(args[1]);
      const guardedBefore = reachers(Chess, r.fen, sq, side).some((m) => m.from === pm.from);
      if (k === "ex.unguarded") why.push(guardedBefore ? `走之前 ${pm.from} 保护着 ${sq}` : `${pm.from} 本来就不保护 ${sq}`);
      const w = wins(Chess, afterFen, sq, them);
      why.push(w ? `之后 ${sq} 会被吃` : `之后 ${sq} 吃不掉`);
      ok = (k !== "ex.unguarded" || guardedBefore) && w && replyOk() && lossOk(args[2].piece);
      break;
    }
    case "ex.overloaded": {
      const o = f.overloaded;
      const a = reachers(Chess, afterFen, o.aSq, side), b = reachers(Chess, afterFen, o.bSq, side);
      const sole = a.length === 1 && b.length === 1 && a[0].from === o.at && b[0].from === o.at;
      why.push(sole ? `${o.at} 是 ${o.aSq}、${o.bSq} 唯一的保护` : "并非唯一的保护");
      ok = sole && replyOk() && lost() >= 1;
      break;
    }
    case "ex.replyThreat": case "ex.replyTwo": case "ex.replyMate": {
      const h = load(Chess, afterFen); const rm = play(h, args[0].san);
      const fen1 = h.fen();
      if (k === "ex.replyMate") { ok = !!rm && mateInOne(Chess, withTurn(fen1, them)); why.push(ok ? "应着之后威胁一步杀" : "应着之后并无一步杀"); }
      else {
        const targets = (k === "ex.replyTwo" ? [args[1].piece, args[2].piece] : [args[1].piece]);
        const g1 = load(Chess, fen1);
        const sqs = [];
        for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
          const sq = "abcdefgh"[ff] + (8 - rr); const p = g1.board()[rr][ff];
          if (p && p.color === side && wins(Chess, withTurn(fen1, them), sq, them)) sqs.push({ sq, type: p.type });
        }
        const by = k === "ex.replyTwo" ? sqs.filter((x) => reachers(Chess, fen1, x.sq, them).some((m) => m.from === rm.to)) : sqs;
        ok = targets.every((t) => by.some((x) => x.type === t));
        why.push(ok ? `应着之后威胁吃 ${targets.join("、")}` : `应着之后吃不到 ${targets.join("、")}`);
      }
      ok = ok && replyOk() && moveBad();
      break;
    }
    case "ex.reply2Threat": case "ex.reply2Mate": {
      const ms = walk(Chess, afterFen, [args[0].san, r.line[1], args[1].san]);
      if (ms.length < 3) { why.push("线走不通"); ok = false; break; }
      const h = load(Chess, afterFen); for (const m of ms) play(h, m.san);
      const fen3 = h.fen();
      if (k === "ex.reply2Mate") { ok = mateInOne(Chess, withTurn(fen3, them)); why.push(ok ? "两步之后威胁一步杀" : "两步之后并无一步杀"); }
      else {
        const g3 = load(Chess, fen3);
        let any = false;
        for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
          const p = g3.board()[rr][ff];
          if (p && p.color === side && p.type === args[2].piece && wins(Chess, withTurn(fen3, them), "abcdefgh"[ff] + (8 - rr), them)) any = true;
        }
        ok = any; why.push(any ? `两步之后威胁吃${args[2].piece}` : `两步之后吃不到${args[2].piece}`);
      }
      ok = ok && replyOk() && moveBad();
      break;
    }
    case "ex.replyCombo": {
      const ms = walk(Chess, afterFen, [args[0].san, args[1].san, args[2].san]);
      const net = ms.length === 3 ? -netAlong(ms, side) - credit : -99;
      why.push(ms.length === 3 ? `三步之内对方净得 ${net}` : "线走不通");
      ok = ms.length === 3 && ms[2].captured === args[3].piece && net >= 2 && replyOk() && moveBad();
      break;
    }
    case "ex.betterThreat": case "ex.betterTwo": case "ex.betterThreatMate": {
      const h = load(Chess, r.fen); const bm = play(h, betterSan);
      const fenB = h.fen();
      if (k === "ex.betterThreatMate") { ok = mateInOne(Chess, withTurn(fenB, side)); why.push(ok ? "更好的那步威胁一步杀" : "并不威胁一步杀"); }
      else {
        const targets = k === "ex.betterTwo" ? [args[1].piece, args[2].piece] : [args[1].piece];
        const gB = load(Chess, fenB);
        const sqs = [];
        for (let rr = 0; rr < 8; rr++) for (let ff = 0; ff < 8; ff++) {
          const sq = "abcdefgh"[ff] + (8 - rr); const p = gB.board()[rr][ff];
          if (p && p.color === them && wins(Chess, withTurn(fenB, side), sq, side)) sqs.push({ sq, type: p.type });
        }
        const by = k === "ex.betterTwo" ? sqs.filter((x) => reachers(Chess, fenB, x.sq, side).some((m) => m.from === bm.to)) : sqs;
        ok = targets.every((t) => by.some((x) => x.type === t));
        why.push(ok ? `更好的那步威胁吃 ${targets.join("、")}` : "更好的那步吃不到所说的子");
      }
      ok = ok && betterOk();
      break;
    }
    case "ex.betterTakes": case "ex.betterTakesFree": {
      const h = load(Chess, r.fen); const bm = play(h, betterSan);
      const free = !!bm && !reachers(Chess, h.fen(), bm.to, them).length;
      const net = netAlong(walk(Chess, r.fen, [betterSan].concat(d.best ? d.best.pv : [])), side);
      why.push(`深搜线上净得 ${net}`);
      if (k === "ex.betterTakesFree" && !free) why.push("说没有保护，其实能吃回");
      ok = !!bm && bm.captured === args[1].piece && (k !== "ex.betterTakesFree" || free) && net >= 1 && betterOk();
      break;
    }
    case "ex.betterCombo": {
      const ms = walk(Chess, r.fen, [args[0].san, args[1].san, args[2].san]);
      const net = ms.length === 3 ? netAlong(ms, side) : -99;
      const deepNet = netAlong(walk(Chess, r.fen, [betterSan].concat(d.best ? d.best.pv : [])), side);
      why.push(`三步之内净得 ${net}，深搜线上 ${deepNet}`);
      ok = ms.length === 3 && ms[2].captured === args[3].piece && net >= 1 && betterOk();
      break;
    }
    case "ex.loss": {
      ok = replyOk() && lossOk(args[1].piece);
      break;
    }
    default: {
      if (/^ex\.pos\./.test(k)) {
        const deepLoss = lost();
        const fact = positionalHolds(Chess, k, r.fen, afterFen, pm, side, replySan, args);
        why.push(fact ? "棋盘上成立" : "棋盘上不成立");
        if (deepLoss >= 1) why.push(`深搜线上丢 ${deepLoss}：子力才是原因`);
        ok = fact && deepLoss < 1 && betterOk() && moveBad();
      } else { why.push("未知句型"); ok = false; }
    }
  }
  return { verdict: ok ? "ok" : "wrong", reason: why.join("；") };
}

/** The positional facts, recounted plainly on the position after the move and the reply. */
function positionalHolds(Chess, k, fen, afterFen, pm, side, replySan, args) {
  const g = load(Chess, afterFen);
  if (replySan) play(g, replySan);
  const at = (f) => { const x = load(Chess, f); const out = {}; for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) { const p = x.board()[r][c]; if (p) out["abcdefgh"[c] + (8 - r)] = p; } return out; };
  const B = at(g.fen()), B0 = at(fen);
  const pawns = (b, c) => Object.keys(b).filter((s) => b[s].type === "p" && b[s].color === c);
  const fileN = (s) => s.charCodeAt(0) - 97;
  switch (k) {
    case "ex.pos.isolated": {
      const sq = args[1].sq, mine = pawns(B, side);
      // the pawn may have been the one that recaptured: an isolated pawn of the mover on that file
      const onFile = mine.filter((s) => s[0] === sq[0]);
      return onFile.length > 0 && !mine.some((s) => Math.abs(fileN(s) - fileN(sq)) === 1);
    }
    case "ex.pos.doubled": return pawns(B, side).filter((s) => s[0] === args[1].file).length >= 2;
    case "ex.pos.backward": {
      const sq = args[1].sq, mine = pawns(B, side);
      const up = side === "w" ? 1 : -1;
      const behindOrLevel = mine.filter((s) => Math.abs(fileN(s) - fileN(sq)) === 1 && (Number(s[1]) - Number(sq[1])) * up <= 0);
      return mine.includes(sq) && behindOrLevel.length === 0;
    }
    case "ex.pos.passed": {
      const sq = args[1].sq, them = other(side);
      const up = them === "w" ? 1 : -1;
      return pawns(B, them).includes(sq) && !pawns(B, side).some((s) => Math.abs(fileN(s) - fileN(sq)) <= 1 && (Number(s[1]) - Number(sq[1])) * up > 0);
    }
    case "ex.pos.shelter": return pm.piece === "p" && Object.keys(B0).some((s) => B0[s].type === "k" && B0[s].color === side && Math.abs(fileN(s) - fileN(pm.from)) <= 1);
    case "ex.pos.openFile": {
      const file = args[1].file;
      return !pawns(B, side).some((s) => s[0] === file) && pawns(B0, side).some((s) => s[0] === file);
    }
    case "ex.pos.outpost": {
      const sq = args[1].sq, them = other(side);
      const up = them === "w" ? 1 : -1;
      const guarded = pawns(B, them).some((s) => Math.abs(fileN(s) - fileN(sq)) === 1 && Number(sq[1]) - Number(s[1]) === up);
      const hitters = pawns(B, side).some((s) => Math.abs(fileN(s) - fileN(sq)) === 1 && (Number(s[1]) - Number(sq[1])) * up > 0);
      return guarded && !hitters;
    }
    case "ex.pos.bishopPair": {
      const bs = (b, c) => Object.keys(b).filter((s) => b[s].type === "b" && b[s].color === c).length;
      return pm.piece === "b" && pm.captured === "n" && bs(B0, side) >= 2 && bs(B, side) < 2 && bs(B, other(side)) >= 2;
    }
    case "ex.pos.badBishop": return pm.piece === "p";
    default: return false;
  }
}
