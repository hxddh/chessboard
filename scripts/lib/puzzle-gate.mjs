/**
 * The puzzle gate, as functions.
 *
 * scripts/test-chess.mjs proves every hand-written puzzle: mates are forced
 * against every defence by a small exhaustive solver, captures are the unique
 * best material swing, defences really stop a mate that was really
 * threatened. Those checks lived inline in the test loop, which was fine for
 * 168 puzzles typed by hand and useless for 2 000 sampled from Lichess: the
 * importer needs to ask the same questions of each candidate *before* it is
 * written down. So the questions are here, one function per category, and
 * the importer and the tests call the same code — an imported puzzle passes
 * exactly what a hand-written one passes, or it is not emitted.
 *
 * Faithful port: same solver, same material rules, same reasons. `Chess` is
 * injected so this stays a pure module with no idea where the rules engine
 * comes from. Every gate returns `{ ok: true, ... }` or `{ ok: false, reason }`.
 */

export const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/** material balance from White's side */
export function balance(Chess, fen) {
  let n = 0;
  for (const row of new Chess(fen).board()) for (const q of row) {
    if (q) n += (q.color === "w" ? 1 : -1) * (VAL[q.type] || 0);
  }
  return n;
}

const bad = (reason) => ({ ok: false, reason });

/** the shape every category shares: legal, white to move, black not in check */
export function positionGate(Chess, fen) {
  const v = new Chess().validate_fen(fen);
  if (!v.valid) return bad("invalid FEN: " + v.error);
  if (fen.split(" ")[1] !== "w") return bad("not white to move");
  const flipped = new Chess(fen.replace(" w ", " b "));
  if (flipped.in_check()) return bad("black already in check");
  return { ok: true };
}

// ---- the exhaustive mate solver (ported verbatim from test-chess.mjs) ----
function matingMoves(g) {
  return g.moves().filter((m) => { g.move(m); const mate = g.in_checkmate(); g.undo(); return mate; });
}
/** a mate-in-one for whoever is to move, or null */
export function mateIn1(g) { return matingMoves(g)[0] || null; }
export function whiteHasForcedMate(g, n) {
  for (const m of g.moves()) {
    g.move(m);
    const mate = g.in_checkmate();
    const deeper = !mate && n > 1 && !g.game_over() && blackForcedLost(g, n - 1);
    g.undo();
    if (mate || deeper) return true;
  }
  return false;
}
export function blackForcedLost(g, n) {
  const replies = g.moves();
  if (!replies.length) return false;
  for (const r of replies) {
    g.move(r);
    const lost = whiteHasForcedMate(g, n);
    g.undo();
    if (!lost) return false;
  }
  return true;
}

/**
 * m1 / m2 / m3: the stored line is legal and canonical, ends in mate, needs
 * its whole budget (no shorter mate exists), and the first move forces mate
 * whatever Black does.
 * @param {number} n mate in n
 */
export function mateGate(Chess, fen, solution, n) {
  if (!Array.isArray(solution) || !solution.length) return bad("no solution");
  const g = new Chess(fen);
  const mv = g.move(solution[0]);
  if (!mv) return bad("solution[0] illegal: " + solution[0]);
  if (mv.san !== solution[0]) return bad("non-canonical SAN " + solution[0] + " ≠ " + mv.san);
  if (n === 1) {
    if (solution.length !== 1) return bad("m1 solution must be one move");
    if (!g.in_checkmate()) return bad("m1 solution does not mate");
    return { ok: true };
  }
  if (solution.length !== n * 2 - 1) return bad("wrong solution length");
  if (g.in_checkmate() || g.game_over()) return bad("first move already ends the game");
  if (whiteHasForcedMate(new Chess(fen), n - 1)) return bad("solvable in fewer moves — belongs in an easier category");
  if (!blackForcedLost(g, n - 1)) return bad("first move does not force mate");
  for (let i = 1; i < solution.length; i++) {
    const m = g.move(solution[i]);
    if (!m) return bad("solution[" + i + "] illegal: " + solution[i]);
    if (m.san !== solution[i]) return bad("non-canonical SAN " + solution[i] + " ≠ " + m.san);
  }
  if (!g.in_checkmate()) return bad("line does not end in mate");
  return { ok: true };
}

/** one-recapture-level material swing of playing `san` */
export function swing(Chess, fen, san) {
  const t = new Chess(fen);
  const mv = t.move(san);
  if (!mv) return null;
  let gain = mv.captured ? VAL[mv.captured] : 0;
  if (t.moves({ verbose: true }).some((m) => m.to === mv.to)) gain -= VAL[mv.piece];
  return gain;
}

/** best net capture on `to` for the side to move (legal recaptures only) */
export function bestCapture(Chess, g, to) {
  let best = null;
  for (const m of g.moves({ verbose: true })) {
    if (m.to !== to || !m.captured) continue;
    const t = new Chess(g.fen());
    t.move(m);
    let gain = VAL[m.captured];
    if (t.moves({ verbose: true }).some((r) => r.to === to)) gain -= VAL[m.piece];
    if (best == null || gain > best) best = gain;
  }
  return best;
}

/**
 * win: a one-mover is the UNIQUE best swing ≥ gain; a two-mover has exactly
 * one legal Black reply and ends by taking ≥ gain.
 */
export function winGate(Chess, fen, solution, gain) {
  if (typeof gain !== "number" || gain < 1) return bad("win puzzle needs gain ≥ 1");
  const g = new Chess(fen);
  const mv = g.move(solution[0]);
  if (!mv) return bad("solution[0] illegal: " + solution[0]);
  if (mv.san !== solution[0]) return bad("non-canonical SAN " + solution[0] + " ≠ " + mv.san);
  if (solution.length === 1) {
    const s0 = swing(Chess, fen, solution[0]);
    if (s0 == null || s0 < gain) return bad("solution swing " + s0 + " < gain " + gain);
    for (const alt of new Chess(fen).moves()) {
      if (alt === solution[0]) continue;
      const sa = swing(Chess, fen, alt);
      if (sa != null && sa >= gain) return bad("not unique: " + alt + " also gains " + sa);
    }
    return { ok: true };
  }
  if (solution.length !== 3) return bad("win solutions are 1 or 3 plies");
  const replies = g.moves();
  if (replies.length !== 1) return bad("black reply not forced (" + replies.length + " moves)");
  if (replies[0] !== solution[1]) return bad("stored reply mismatch: " + replies[0]);
  const rm = g.move(solution[1]);
  const wm = rm ? g.move(solution[2]) : null;
  if (!rm || !wm) return bad("two-mover line illegal");
  if (wm.san !== solution[2]) return bad("non-canonical SAN " + solution[2]);
  if (!wm.captured || VAL[wm.captured] < gain) return bad("final capture below gain");
  return { ok: true };
}

/**
 * tac, hand-written shape: `first` wins `target` by ≥ `gain` against every
 * defence — a 1-ply discovered capture, or check → any reply → capture.
 * Pins (牵制) build the attack quietly, so no check is required there.
 */
export function tacGate(Chess, fen, p) {
  if (typeof p.gain !== "number" || p.gain < 1) return bad("tac needs gain ≥ 1");
  if (!/^[a-h][1-8]$/.test(p.target || "")) return bad("tac needs a target square");
  if (!Array.isArray(p.line) || !p.line.length) return bad("tac needs a display line");
  const gt = new Chess(fen);
  const fm = gt.move(p.first);
  if (!fm) return bad("tac first illegal: " + p.first);
  if (fm.san !== p.first || p.line[0] !== p.first) return bad("tac first/line mismatch");
  if (p.line.length === 1) {
    if (fm.to !== p.target || !fm.captured) return bad("1-ply tac must capture target");
    let net = VAL[fm.captured];
    if (gt.moves({ verbose: true }).some((r) => r.to === p.target)) net -= VAL[fm.piece];
    if (net < p.gain) return bad("1-ply tac net " + net + " < gain " + p.gain);
    return { ok: true };
  }
  if (p.line.length !== 3) return bad("tac line must be 1 or 3 plies");
  if (p.motif !== "牵制" && !gt.in_check()) return bad("3-ply tac first move should check");
  const replies = gt.moves();
  if (!replies.length) return bad("no black reply (should not mate here)");
  for (const r of replies) {
    gt.move(r);
    const cap = bestCapture(Chess, gt, p.target);
    gt.undo();
    if (cap == null || cap < p.gain) return bad("tac refuted by " + r + " (cap " + cap + ")");
  }
  const gl = new Chess(fen);
  gl.move(p.line[0]);
  const rr = gl.move(p.line[1]);
  const cc = rr ? gl.move(p.line[2]) : null;
  if (!rr || !cc) return bad("stored tac line illegal");
  if (cc.to !== p.target || !cc.captured) return bad("stored line does not capture target");
  return { ok: true };
}

/**
 * Material swing of a whole line, White's side, with the one-ply recapture
 * check the hand-written gates apply: if Black can take back on the square
 * the last move landed on, that piece is counted as lost. Lines end on a
 * White move (odd length) — an imported line that ends on Black's move has
 * nothing for the solver to find on its last ply.
 * @returns {{ok:true, swing:number, mate:boolean}|{ok:false, reason:string}}
 */
export function lineSwing(Chess, fen, solution) {
  if (!Array.isArray(solution) || !solution.length) return bad("no solution");
  if (solution.length % 2 === 0) return bad("line must end on a White move");
  const g = new Chess(fen);
  let last = null;
  for (let i = 0; i < solution.length; i++) {
    const m = g.move(solution[i]);
    if (!m) return bad("line illegal at ply " + i + ": " + solution[i]);
    if (m.san !== solution[i]) return bad("non-canonical SAN " + solution[i] + " ≠ " + m.san);
    last = m;
  }
  let net = balance(Chess, g.fen()) - balance(Chess, fen);
  const mate = g.in_checkmate();
  if (!mate && g.moves({ verbose: true }).some((r) => r.to === last.to)) net -= VAL[g.get(last.to).type];
  return { ok: true, swing: net, mate };
}

/**
 * Imported tactic (fork / pin / skewer / discovered / double): the line is
 * legal and canonical and its swing, after Black's best one-ply recapture,
 * is at least `gain`. Mate on the last ply also counts — a fork that ends in
 * mate has won more than material.
 */
export function swingGate(Chess, fen, solution, gain) {
  if (typeof gain !== "number" || gain < 1) return bad("tactic needs gain ≥ 1");
  const r = lineSwing(Chess, fen, solution);
  if (!r.ok) return r;
  if (!r.mate && r.swing < gain) return bad("line swings " + r.swing + " < gain " + gain);
  return { ok: true, swing: r.swing };
}

/**
 * def: Black is threatening mate in one *right now*, the stored move takes
 * it off the board, at least one move does not, and `saves` (when given)
 * equals the number of moves that hold.
 * @returns {{ok:true, saves:number, threat:string}|{ok:false, reason:string}}
 */
export function defGate(Chess, fen, solution, saves) {
  if (!Array.isArray(solution) || solution.length !== 1) return bad("def solution is one move");
  const bl = new Chess(fen.replace(" w ", " b "));
  const threat = mateIn1(bl);
  if (!threat) return bad("black is not actually threatening mate in 1");
  const gd = new Chess(fen);
  const all = gd.moves();
  const holds = all.filter((m) => {
    gd.move(m);
    const ok = gd.game_over() || !mateIn1(gd);
    gd.undo();
    return ok;
  });
  if (!holds.includes(solution[0])) return bad("solution " + solution[0] + " does not stop " + threat);
  if (!holds.length) return bad("no defence exists — the position is already lost");
  if (holds.length >= all.length) return bad("every move holds — nothing to find");
  if (saves != null && saves !== holds.length) return bad("saves is " + saves + " but " + holds.length + " moves actually hold");
  return { ok: true, saves: holds.length, threat };
}

/**
 * real: a crowded board (≥ 20 men, and `men` stored right), White not already
 * down material (a recapture is not a tactic), more than one capture on
 * offer so the key move cannot be found by elimination, and a 3-ply line
 * whose swing is exactly the advertised gain. Uniqueness of the key move is
 * an engine claim (scripts/test-tactics.mjs), not checked here.
 */
export function realGate(Chess, fen, p) {
  if (typeof p.gain !== "number" || p.gain < 2) return bad("real needs gain ≥ 2");
  const men = (fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
  if (men < 20) return bad("real needs a middlegame: " + men + " men");
  if (men !== p.men) return bad("real men " + p.men + " != " + men + " on the board");
  if (!Array.isArray(p.line) || p.line.length !== 3) return bad("real line is 3 plies");
  const g0 = new Chess(fen);
  if (balance(Chess, fen) < 0) return bad("white is already down material — this is a recapture");
  if (g0.moves({ verbose: true }).filter((m) => m.captured).length < 2) return bad("only one capture on the board — findable by elimination");
  for (const san of p.line) {
    const mv = g0.move(san, { sloppy: false });
    if (!mv || mv.san !== san) return bad("real line illegal/non-canonical at " + san);
  }
  const sw = balance(Chess, g0.fen()) - balance(Chess, fen);
  if (sw !== p.gain) return bad("real gain " + p.gain + " but the line swings " + sw);
  return { ok: true };
}

/**
 * One entry point for a puzzle in the repo's stored shape (puzzles.js or
 * puzzles-lichess.js): dispatches on `cat`.
 */
export function gate(Chess, p) {
  const pos = positionGate(Chess, p.fen);
  if (!pos.ok) return pos;
  switch (p.cat) {
    case "m1": return mateGate(Chess, p.fen, p.solution, 1);
    case "m2": return mateGate(Chess, p.fen, p.solution, 2);
    case "m3": return mateGate(Chess, p.fen, p.solution, 3);
    case "win": return winGate(Chess, p.fen, p.solution, p.gain);
    case "tac": return p.first ? tacGate(Chess, p.fen, p) : swingGate(Chess, p.fen, p.solution, p.gain);
    case "def": return defGate(Chess, p.fen, p.solution, p.saves);
    case "real": return realGate(Chess, p.fen, p);
    default: return bad("no gate for cat " + p.cat);
  }
}
