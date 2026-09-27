/**
 * The audit's oracle for scripts/test-coach.mjs (v8-0-plan B3).
 *
 * Each coach sentence makes one or two claims — "the refutation is X", "it
 * is a fork", "you lose the rook", "better was Y" — and each is checked here
 * against a DEEPER search than the one that produced it (1500 ms against the
 * pass's 200 ms) and against simple board facts written independently of
 * motif.js: whether a man could be taken back, whether a line piece stands
 * on two men, whether the deep line ever takes the man a motif is about. The
 * oracle is deliberately blunt; a verdict it cannot reach is "ok?" and goes
 * to a human reading (docs/coach-audit-8.0.md records both).
 *
 * @module coach-oracle
 */
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const other = (c) => (c === "w" ? "b" : "w");

function play(g, m) {
  let mv = null;
  try { mv = g.move(m); } catch (_) { mv = null; }
  return mv;
}
function withTurn(fen, c) { const p = fen.split(" "); p[1] = c; p[3] = "-"; return p.join(" "); }

/** Walk a SAN line; the move records, stopping at the first that will not play. */
function walk(Chess, fen, sans) {
  const g = new Chess(fen);
  const out = [];
  for (const s of sans) { const m = play(g, s); if (!m) break; out.push(m); if (g.in_checkmate()) { out.mate = true; break; } }
  return out;
}
/**
 * Material `side` wins along `moves`, walked to a quiet point: at least four
 * plies, then on while the last move was a capture (the exchange is not over).
 */
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
/** Can `color` legally move onto `sq` in `fen` (whoever is on move)? */
function canTake(Chess, fen, sq, color) {
  let g;
  try { g = new Chess(withTurn(fen, color)); } catch (_) { return false; }
  return (g.moves({ verbose: true }) || []).some((m) => m.to === sq);
}
/** Squares the man on `sq` attacks, from chess.js's own move generator. */
function attacks(Chess, fen, sq) {
  const g = new Chess(fen);
  const p = g.get(sq);
  if (!p) return [];
  // put an enemy stand-in on every empty or friendly square? No — ask the
  // generator with the owner on move, and add pawn diagonals by hand
  let moves = [];
  try { moves = new Chess(withTurn(fen, p.color)).moves({ square: sq, verbose: true }) || []; } catch (_) { moves = []; }
  const out = new Set(moves.filter((m) => m.captured).map((m) => m.to));
  return [...out];
}
const mover = (fen) => fen.split(" ")[1];
const cpFor = (scalar, side) => (scalar == null ? null : side === "w" ? scalar : -scalar);

/**
 * @param {object} r      a row: fen, played, ex (explainMistake), key, line, bestLine
 * @param {object} d      deep searches: after (post-mistake), before, reply (post-refutation), best (post-better)
 * @returns {{verdict: "ok"|"wrong"|"none", reason: string}}
 */
export function oracle(r, d, Chess) {
  const ex = r.ex;
  if (!r.key || !ex) return { verdict: "none", reason: "没有句子" };
  const side = mover(r.fen);
  const them = other(side);
  const g = new Chess(r.fen);
  const pm = play(g, r.played);
  const afterFen = g.fen();
  const credit = pm && pm.captured ? VALUE[pm.captured] : 0;
  const dAfterMe = cpFor(d.after.scalar, side);
  const why = [];

  // --- the better move ------------------------------------------------------
  const betterOk = () => {
    if (!ex.better) return true;
    const bx = d.best ? cpFor(d.best.scalar, side) : null;
    if (d.before.pv[0] === ex.better.san) { why.push("深搜首选同为 " + ex.better.san); return true; }
    if (bx != null && dAfterMe != null && bx - dAfterMe >= 50) { why.push(`深搜：${ex.better.san} 比所走好 ${bx - dAfterMe}cp`); return true; }
    why.push(`深搜：${ex.better.san} ${bx} 对所走 ${dAfterMe}，不算更好`);
    return false;
  };
  // --- the refutation as the deep search plays it ----------------------------
  const replyLine = () => (ex.refute ? [ex.refute.san].concat(d.reply ? d.reply.pv : []) : []);
  const replyOk = () => {
    if (!ex.refute) return false;
    if (d.after.pv[0] === ex.refute.san) return true;
    const rx = d.reply ? cpFor(d.reply.scalar, side) : null;
    // the reply is sound when the position after it is as bad for the mover as the deep best
    if (rx != null && dAfterMe != null && rx - dAfterMe <= 80) return true;
    why.push(`深搜不认 ${ex.refute.san}（之后 ${rx}，最佳 ${dAfterMe}）`);
    return false;
  };
  const lossOk = (piece) => {
    const net = -netAlong(walk(Chess, afterFen, replyLine()), side) - credit;
    const need = VALUE[piece] >= 3 ? 2 : 1;
    if (d.after.scalar != null && Math.abs(d.after.scalar) >= 9000 && cpFor(d.after.scalar, side) < 0) { why.push("深搜：被杀"); return true; }
    if (net >= need) { why.push(`深搜线上净丢 ${net}`); return true; }
    why.push(`深搜线上净丢 ${net}，撑不起「丢${piece}」`);
    return false;
  };
  const mateOk = (who) => {
    const s = who === side ? d.before.scalar : d.after.scalar;
    const ok = s != null && Math.abs(s) >= 9000 && cpFor(s, who) > 0;
    why.push(ok ? "深搜：确为杀" : "深搜：不是强制杀 (" + s + ")");
    return ok;
  };

  // --- motif facts, independent of motif.js ----------------------------------
  const motifOk = (motif, fen, line, attacker, credit0) => {
    const ms = walk(Chess, fen, line);
    if (!ms.length) { why.push("线走不通"); return false; }
    const m0 = ms[0];
    const g1 = new Chess(fen); play(g1, m0.san);
    const f1 = g1.fen();
    const net = netAlong(ms, attacker) - credit0;
    const victim = other(attacker);
    const laterTakes = (pred) => ms.some((x, i) => i > 0 && i % 2 === 0 && x.captured && pred(x));
    // a man captured for free by the first move is the whole story, whatever else is true
    const firstFree = m0.captured && VALUE[m0.captured] >= 3 && !canTake(Chess, f1, m0.to, victim);
    switch (motif) {
      case "hanging": {
        const cheap = m0.piece !== "k" && VALUE[m0.piece] < VALUE[m0.captured || "p"];
        const ok = !!m0.captured && VALUE[m0.captured] >= 3 && (firstFree || cheap) && net >= 2;
        why.push(ok ? `${m0.san} 吃${m0.captured}：${firstFree ? "吃不回" : "以小吃大"}，深搜净得 ${net}` : `${m0.san}：不是白吃（净 ${net}）`);
        return ok;
      }
      case "fork": {
        const hit = attacks(Chess, f1, m0.to).filter((s) => { const p = g1.get(s); return p && (p.type === "k" || VALUE[p.type] >= 3); });
        const check = g1.in_check();
        const n = hit.length + (check && !hit.some((s) => g1.get(s).type === "k") ? 1 : 0);
        if (n < 2) { why.push(`${m0.san} 之后只打到 ${n} 个目标`); return false; }
        if (firstFree) { why.push(`${m0.san} 本身就是白吃一子，要说的是挂着的子`); return false; }
        const took = laterTakes((x) => x.from === m0.to && hit.includes(x.to));
        why.push(took ? `捉双：深搜线上吃到了 (${net})` : "捉双：深搜线上没吃到");
        return took && net >= 1;
      }
      case "pin": {
        if (firstFree) { why.push(`${m0.san} 白吃一子——是挂着的子，不是牵制`); return false; }
        // the man taken later must have been unable to move off its square
        const took = ms.find((x, i) => i > 0 && i % 2 === 0 && x.captured && VALUE[x.captured] >= 1);
        if (!took) { why.push("牵制：深搜线上没吃到被牵制的子"); return false; }
        const gv = new Chess(withTurn(f1, victim));
        const legal = (gv.moves({ square: took.to, verbose: true }) || []).length;
        const pseudo = (gv.moves({ square: took.to, verbose: true, legal: false }) || []).length;
        const pinned = legal < pseudo;
        why.push(pinned ? `牵制：${took.to} 的子动不了，深搜线上被吃` : `牵制：${took.to} 的子并没有被钉住`);
        return pinned && net >= 2;
      }
      case "skewer": {
        if (firstFree) { why.push("首着白吃一子"); return false; }
        const took = laterTakes((x) => x.from === m0.to);
        why.push(took ? "串击：深搜线上后面的子被吃" : "串击：深搜线上没吃到后面的子");
        return took && net >= 2;
      }
      case "discovered": case "double": {
        const ok = g1.in_check() && (net >= 2 || ms.mate);
        why.push(ok ? "闪将 / 双将，深搜得子或杀" : "闪将：深搜不得子");
        return ok;
      }
      case "mateThreat": {
        const ok = net >= 2 || !!ms.mate;
        why.push(ok ? "威胁杀，深搜得子或杀" : "威胁杀：深搜不得子");
        return ok;
      }
      default: {
        const ok = net >= 2 || !!ms.mate;
        why.push(`${motif}：深搜线净得 ${net}${ok ? "" : "，不够"}（其余由人读）`);
        return ok;
      }
    }
  };

  const k = r.key;
  let ok = true;
  const rl = replyLine();
  switch (k) {
    case "ex.better": ok = betterOk(); break;
    case "ex.mate1": case "ex.mateN": case "ex.mate1Motif": case "ex.mateNMotif": ok = mateOk(side); break;
    case "ex.allowsMate1": case "ex.allowsMate": case "ex.allowsMate1Motif": case "ex.allowsMateMotif": ok = mateOk(them); break;
    case "ex.loss": ok = replyOk() && lossOk(ex.lost.piece); break;
    case "ex.motifLoss": ok = replyOk() && motifOk(ex.refute.motif, afterFen, rl, them, credit) && lossOk(ex.lost.piece); break;
    case "ex.motif": ok = replyOk() && motifOk(ex.refute.motif, afterFen, rl, them, credit); break;
    case "ex.forkHits": {
      // a statement of fact: the piece that moved attacks those two
      const g1 = new Chess(afterFen); const m0 = play(g1, ex.refute.san);
      const types = attacks(Chess, g1.fen(), m0.to).map((s) => g1.get(s).type);
      if (g1.in_check()) types.push("k");
      ok = ex.refute.hits.slice(0, 2).every((t) => types.includes(t)) && !canTake(Chess, g1.fen(), m0.to, side);
      // and a non-king target has to be worth taking: loose (no man of the
      // mover's hits its square, check or no check) or worth more than the forker
      const loose = (sq) => {
        const probe = new Chess(withTurn(g1.fen(), side));
        probe.remove(sq);
        probe.put({ type: "n", color: them }, sq);
        return !(probe.moves({ verbose: true, legal: false }) || []).some((m) => m.to === sq);
      };
      const targets = attacks(Chess, g1.fen(), m0.to).filter((s) => g1.get(s).type !== "k");
      const worth = targets.some((s) => VALUE[g1.get(s).type] > VALUE[m0.piece] || loose(s));
      if (!worth) why.push("被打到的子有保护、也不比它值钱：不是真的捉双");
      ok = ok && worth;
      why.push(ok ? `${m0.san} 确实同时打到 ${ex.refute.hits.slice(0, 2).join("、")}，且吃不掉它` : `${m0.san} 打不到所说的两个子，或者它自己能被吃`);
      ok = ok && replyOk();
      break;
    }
    case "ex.hanging": case "ex.hangingCheap": {
      ok = replyOk() && motifOk("hanging", afterFen, rl, them, credit);
      const g1 = new Chess(afterFen); const m0 = play(g1, ex.refute.san);
      const back = canTake(Chess, g1.fen(), m0.to, side);
      if (k === "ex.hanging" && back) { why.push("说没有保护，其实能吃回"); ok = false; }
      if (k === "ex.hangingCheap" && !(VALUE[m0.piece] < VALUE[m0.captured])) { why.push("并非以小吃大"); ok = false; }
      break;
    }
    case "ex.threatHanging": case "ex.threatCheap": case "ex.threatMate": {
      // null move before the mistake: the same reply already worked
      const gN = new Chess(withTurn(r.fen, them));
      const t0 = walk(Chess, afterFen, [ex.threat.san])[0];
      const m = t0 ? play(gN, { from: t0.from, to: t0.to, promotion: "q" }) : null;
      if (!m) { ok = false; why.push("走之前这步棋并不成立"); break; }
      if (k === "ex.threatMate") { ok = gN.in_checkmate() && mateOk(them); why.push(gN.in_checkmate() ? "走之前就威胁一步杀" : "走之前并无一步杀"); break; }
      const pre = !!m.captured && VALUE[m.captured] >= 3 && (!canTake(Chess, gN.fen(), m.to, side) || VALUE[m.piece] < VALUE[m.captured]);
      // the sentence says 「没有保护住」 only when nothing could take back
      if (k === "ex.threatHanging" && canTake(Chess, gN.fen(), m.to, side)) { why.push("说没有保护，其实有保护"); ok = false; break; }
      why.push(pre ? `走之前 ${m.san} 就能白吃${m.captured}` : "走之前并不能白吃");
      ok = pre && replyOk() && motifOk("hanging", afterFen, rl, them, credit);
      break;
    }
    case "ex.perpetual": {
      const ms = walk(Chess, afterFen, rl);
      ok = Math.abs(d.after.scalar || 999) <= 30 && ms.filter((m) => m.color === them).every((m) => /[+#]$/.test(m.san));
      why.push(ok ? "深搜 0.00 附近，且线上全是将军" : "深搜不是长将");
      break;
    }
    case "ex.betterHanging": case "ex.betterCheap": case "ex.betterMotif": {
      ok = betterOk() && motifOk(k === "ex.betterMotif" ? ex.better.motif : "hanging", r.fen,
        [ex.better.san].concat(d.best ? d.best.pv : []), side, 0);
      break;
    }
    default: why.push("未知句型"); ok = false;
  }
  return { verdict: ok ? "ok" : "wrong", reason: why.join("；") };
}
