/**
 * 看 N 步后与盲走收官：两个算棋与看棋的专项（v8-2-plan T2）。
 *
 * Built into js/chunk-visual.js (scripts/bundle.mjs) and fetched the first
 * time one of the two is started, or 「我的」 has a record of them to show —
 * the bundle keeps only trainer/visual.js, which loads this and hands it the
 * trainer's pieces (the bag trainer/puzzles.js gives the modes).
 *
 *   看 N 步后 look    a position from the book stays on the board while the
 *                     next N plies are listed as text (SAN — the app writes
 *                     piece letters, not localised ones); then one question
 *                     about the position after them, worked out by chess.js:
 *                     which piece can take on a square, which piece can give
 *                     check (click the square it stands on NOW), or whether
 *                     the side to move has a mate in one (play it, or 「没有」).
 *                     N starts at 2 and moves up one with every right answer,
 *                     down one with every wrong one, between 2 and 6.
 *   盲走收官 blind    a mate in one or two from the book is shown for three
 *                     seconds, then its men are hidden (the board keeps its
 *                     squares and coordinates); the moves are typed (SAN or
 *                     UCI) or clicked, and judged by the trainer exactly as
 *                     the puzzle is judged in 做题. A solve moves the next one
 *                     up to a mate in two, a miss back to a mate in one.
 *
 * A set is SET questions. It is a run in the trainer's sense (puzzle-modes.js
 * startRun): store.session.run is its record, with `own` set to this module,
 * so everything that already knows a run owns the board — the practice rows
 * standing down, 结束 / 再来一局, a load parking it, leaving 做题 ending it —
 * holds for these two as well, and the best score is filed with the others
 * (runs.js recordBest, puzzleState.runs[kind]).
 *
 * What is its own, in puzzleState.vis[kind] (the puzzle state's file, so
 * export, sync and 清除 carry it like `themes` and `runs`):
 *
 *   rating      a Glicko-2 rating per mode — the step puzzle-rating.js and
 *               the themes use, against the question's rating (look: from N
 *               and the question; blind: the puzzle's own, plus BLIND_PLUS)
 *   solve/miss  answers, all of them; the week's are Progress'd as the
 *               category `look` / `blind`, which is how 「我的」's 进步 rows
 *               show them
 *   q           the review queue: key → srs.js entry. A wrong answer (or
 *               答案) queues the question; a set starts with what is due
 *               (at most REVIEW_MAX) before anything new, and answers to a
 *               review move its entry along the ladder but not the rating.
 *               A look key is `puzzle id|N|question seed` — enough to build
 *               the same question again; a blind key is the puzzle's id.
 *
 * Deterministic: the set's seed is the clock when it starts, and question k
 * is a pure function of the seed, k, the level it is asked at and the book
 * (hand-written plus mined, in id order — never the player's own drills, and
 * never the order the mined chunk happened to join in). Same seed, same
 * answers → the same set (test-trainer-e2e (h)).
 *
 * Words are [zh-CN, en, ja], as in endgames.js: the chunk carries all three.
 * @module trainer/visual-modes
 */

/** Questions in a set. */
export const SET = 10;
/** Reviews due at the start of a set that are served before new ones. */
export const REVIEW_MAX = 5;
/** How long the blind position is shown before its men go (ms). */
export const SHOW_MS = 3000;
/** A hidden board is harder than the same puzzle in 做题. */
const BLIND_PLUS = 150;
/** The ply counts look asks for. */
export const N_MIN = 2, N_MAX = 6;
const LOOK_CATS = ["m1", "m2", "m3", "win", "tac", "real", "def", "draw"];
const BLIND_CATS = ["m1", "m2"];
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const LANG_AT = { "zh-CN": 0, en: 1, ja: 2 };

const W = {
  ruleLook: ["看 N 步：盘面不动，读完着法再答题 · 共 {0} 题", "Look ahead: the board stays still — read the moves, then answer · {0} questions", "N手先読み：盤は動かない。指し手を読んでから答える · 全 {0} 問"],
  ruleBlind: ["盲走收官：局面只亮 3 秒，之后凭记忆走出杀着 · 共 {0} 题", "Blind mate: the position shows for 3 seconds, then mate from memory · {0} puzzles", "目隠し詰め：局面は 3 秒だけ表示、あとは記憶で詰ます · 全 {0} 問"],
  nth: ["第 {0}/{1} 题", "Question {0} of {1}", "{0}/{1} 問目"],
  lvl: ["看 {0} 步", "{0} plies ahead", "{0} 手先"],
  review: ["复习", "Review", "復習"],
  over: ["这一组做完了：答对 {0}/{1}", "Set complete: {0} of {1} right", "セット終了：{1} 問中 {0} 問正解"],
  moves: ["接下来：{0}", "Then: {0}", "この後：{0}"],
  qCap: ["{0}走。{0}哪个子能吃掉 {1} 上的{2}？点它现在所在的格，或输入格子（如 e4）。", "{0} to move. Which {0} piece can capture the {2} on {1}? Click the square it stands on now, or type the square (e.g. e4).", "{0}番。{1} の{2}を取れる{0}の駒はどれ？今いるマスをクリックするか、マス名（例 e4）を入力。"],
  qCheck: ["{0}走。{0}哪个子走一步就能将军？点它现在所在的格，或输入格子（如 e4）。", "{0} to move. Which {0} piece can give check? Click the square it stands on now, or type the square (e.g. e4).", "{0}番。王手をかけられる{0}の駒はどれ？今いるマスをクリックするか、マス名（例 e4）を入力。"],
  qMate: ["{0}走。{0}有一步杀吗？有就走出来（点起点再点终点，或输入着法）；没有就按「没有」。", "{0} to move. Does {0} have a mate in one? Play it (click from and to, or type the move) — or choose “None”.", "{0}番。{0}に一手詰めはある？あれば指す（元のマス→行き先をクリック、または指し手を入力）。なければ「なし」。"],
  qBlind: ["{0}：{1}。", "{0}: {1}.", "{0}：{1}。"],
  none: ["没有", "None", "なし"],
  go: ["确定", "Answer", "解答"],
  next: ["下一题", "Next", "次へ"],
  phLook: ["格子或着法，如 e4、Qh7#", "Square or move, e.g. e4, Qh7#", "マスか指し手（例 e4、Qh7#）"],
  phBlind: ["输入着法，如 Qh7# 或 d1h5", "Type a move, e.g. Qh7# or d1h5", "指し手を入力（例 Qh7#、d1h5）"],
  input: ["你的答案", "Your answer", "あなたの答え"],
  ok: ["答对了！", "Correct!", "正解！"],
  ansCap: ["能吃的是：{0}", "It could be taken from: {0}", "取れるのは：{0}"],
  ansCheck: ["能将军的是：{0}", "Check could come from: {0}", "王手をかけられるのは：{0}"],
  ansMate: ["一步杀：{0}", "Mate in one: {0}", "一手詰め：{0}"],
  ansNoMate: ["没有一步杀", "There is no mate in one", "一手詰めはない"],
  ansLine: ["正解：{0}", "Solution: {0}", "正解：{0}"],
  bad: ["看不懂这个答案：请输入格子（如 e4）或着法（如 Nf3）", "Could not read that: type a square (e4) or a move (Nf3)", "読み取れません：マス（e4）か指し手（Nf3）を入力"],
  illegal: ["这步走不了：{0}", "Not a legal move: {0}", "指せない手です：{0}"],
  pos: ["局面：{0}", "Position: {0}", "局面：{0}"],
  showing: ["记住局面，3 秒后棋子隐藏", "Memorise the position — the pieces hide in 3 seconds", "局面を覚えて。3 秒後に駒が消えます"],
  hidden: ["棋子已隐藏，凭记忆走：输入着法，或点起点再点终点", "Pieces hidden — play from memory: type the move, or click from and to", "駒を隠しました。記憶で指す：指し手を入力、または元のマス→行き先をクリック"],
  reply: ["对方应 {0}，轮到你", "Reply: {0} — your move", "相手の応手 {0}。あなたの番"],
  played: ["已走：{0}", "Played: {0}", "指した手：{0}"],
  rating: ["{0}评级 {1}", "{0} rating {1}", "{0}のレーティング {1}"],
  meH: ["计算专项", "Calculation", "読みの特訓"],
  meRow: ["评级 {0} · 对 {1} / 错 {2} · 最佳 {3}", "Rating {0} · {1} right / {2} wrong · best {3}", "レーティング {0} · 正解 {1} / 不正解 {2} · 最高 {3}"],
  meDue: ["{0} · 复习 {1} 题", "{0} · review {1}", "{0} · 復習 {1} 問"],
  white: ["白方", "White", "白"],
  black: ["黑方", "Black", "黒"],
  on: ["{0} 上的{1}", "the {1} on {0}", "{0} の{1}"],
  p: ["兵", "pawn", "ポーン"], n: ["马", "knight", "ナイト"], b: ["象", "bishop", "ビショップ"],
  r: ["车", "rook", "ルーク"], q: ["后", "queen", "クイーン"], k: ["王", "king", "キング"],
  sep: ["、", ", ", "、"],
  semi: ["；", "; ", "；"],
};

/** A seeded generator (runs.js's), so a set can be rebuilt from its seed. */
export function rng(seed) {
  let s = (seed >>> 0) || 1;
  return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; };
}
/** One seed from several numbers. */
export function mix(...xs) {
  let h = 0x811c9dc5;
  for (const x of xs) { h = Math.imul(h ^ (x >>> 0), 16777619) >>> 0; h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0; }
  return (h ^ (h >>> 15)) >>> 0;
}

const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
/** The book look draws from: a position, one of the tactical categories, in id order. */
export function lookPool(puzzles) {
  const seen = new Set();
  return puzzles.filter((p) => p && p.fen && LOOK_CATS.includes(p.cat) && !seen.has(p.id) && seen.add(p.id)).sort(byId);
}
/** …and blind: the mates in one and two, by category. */
export function blindPool(puzzles) {
  const all = lookPool(puzzles).filter((p) => BLIND_CATS.includes(p.cat) && Array.isArray(p.solution));
  return BLIND_CATS.map((c) => all.filter((p) => p.cat === c));
}

/**
 * The next ply once the puzzle's own line has run out: a capture that pays,
 * a check, a move that does not leave the piece hanging, and a little of the
 * seed between moves that are otherwise alike — never one that ends the game.
 */
function pickMove(g, r) {
  let best = null, top = -Infinity;
  for (const m of g.moves({ verbose: true })) {
    let s = r() * 1.5 + (m.captured ? 3 * VAL[m.captured] : 0);
    g.move(m);
    if (g.game_over()) s -= 100;
    else {
      if (g.in_check()) s += 1;
      if (g.moves({ verbose: true }).some((x) => x.to === m.to)) s -= 2 * VAL[m.piece];
    }
    g.undo();
    if (s > top) { top = s; best = m; }
  }
  return best;
}

/** Every move of the side to move that mates. */
function matesOf(g) {
  const out = [];
  for (const m of g.moves({ verbose: true })) {
    g.move(m);
    if (g.in_checkmate()) out.push({ from: m.from, to: m.to, promotion: m.promotion, san: m.san });
    g.undo();
  }
  return out;
}

/**
 * Question `qseed` about puzzle `p` after `n` plies, or null when the line
 * cannot be played that far or the game ends on the way.
 * @param {Function} Chess chess.js
 */
export function buildLook(Chess, p, n, qseed) {
  const r = rng(qseed);
  const g = new Chess(p.fen);
  const start = g.fen();
  const line = p.line || p.solution || [];
  const sans = [];
  let last = null;
  for (let i = 0; i < n; i++) {
    const mv = i < line.length ? g.move(line[i]) : (() => { const m = pickMove(g, r); return m ? g.move(m) : null; })();
    if (!mv || g.game_over()) return null;
    sans.push(mv.san);
    last = { from: mv.from, to: mv.to };
  }
  const side = g.turn();
  const moves = g.moves({ verbose: true });
  const mates = matesOf(g);
  const kinds = [];
  // a mate is asked for more often when there is one — and sometimes when
  // there is none, so that the question itself never gives the answer away
  kinds.push({ t: "mate", w: mates.length ? 4 : 0.6 });
  // en passant is left out: its `to` is the empty square behind the pawn it
  // takes, and 「哪个子能吃掉 X 上的…」 needs a man on X (M2 review)
  const caps = [...new Set(moves.filter((m) => m.captured && !m.flags.includes("e")).map((m) => m.to))].sort();
  if (caps.length) kinds.push({ t: "cap", w: 2 });
  const checks = [...new Set(moves.filter((m) => /[+#]$/.test(m.san)).map((m) => m.from))].sort();
  if (checks.length) kinds.push({ t: "check", w: 2 });
  // a side with no capture, no check and no mate (often one just checked)
  // could only be asked 「有一步杀吗」 — a set full of 「没有」: another position
  if (kinds.length === 1 && !mates.length) return null;
  let x = r() * kinds.reduce((a, k) => a + k.w, 0);
  const kind = kinds.find((k) => (x -= k.w) < 0) || kinds[0];
  const q = { key: p.id + "|" + n + "|" + qseed, pid: p.id, n, start, sans, fen: g.fen(), last, t: kind.t, side };
  if (kind.t === "cap") {
    q.sq = caps[Math.floor(r() * caps.length)];
    q.target = g.get(q.sq);
    q.answers = [...new Set(moves.filter((m) => m.captured && m.to === q.sq).map((m) => m.from))].sort();
  } else if (kind.t === "check") {
    q.answers = checks;
  } else q.mates = mates;
  // the question's rating: longer is harder, and so is a mate over a capture
  q.r = 900 + 150 * (n - N_MIN) + (kind.t === "mate" ? 150 : kind.t === "check" ? 100 : 50);
  return q;
}

/**
 * Question k of the set with seed `seed`, asked at `n` plies. A played-on
 * position seldom holds a mate in one, so about a third of the draws come
 * from the mates whose solution is one ply longer than `n` — the n plies
 * listed, and the mate the last one is left for.
 */
export function lookQuestion(Chess, pool, seed, k, n) {
  if (!pool.length) return null;
  const ready = pool.filter((p) => /^m\d$/.test(p.cat) && Array.isArray(p.solution) && p.solution.length === n + 1);
  for (let tries = 0; tries < 60; tries++) {
    const qseed = mix(seed, k, n, tries);
    const r = rng(qseed ^ 0x5bd1e995);
    const from = ready.length && r() < 0.35 ? ready : pool;
    const p = from[Math.floor(r() * from.length)];
    const q = buildLook(Chess, p, n, qseed);
    if (q) return q;
  }
  return null;
}

/** Puzzle k of the blind set at level `lvl` (0 mate in one, 1 mate in two), none already used. */
export function blindPick(pools, seed, k, lvl, used) {
  const list = (pools[lvl] || []).filter((p) => !(used && used.includes(p.id)));
  return list.length ? list[Math.floor(rng(mix(seed, k, lvl))() * list.length)] : null;
}

/**
 * What was typed: a square, 「没有」, or a move legal in `fen` (SAN, or UCI
 * such as e2e4 — chess.js's sloppy parse; castling with O or the digit 0).
 * `moveFirst` wants a move (a mate question, a blind move): "e4" is the pawn
 * move, and what is no legal move — "b8" or "bxa8" with the promotion piece
 * left out among them — is null, for the caller's 「走不了」, never a square
 * that would be judged as an answer.
 */
export function parseAnswer(Chess, fen, text, moveFirst) {
  const t0 = String(text || "").trim();
  const s = /^[0o]-[0o](-[0o])?[+#]?$/i.test(t0) ? t0.toUpperCase().replace(/0/g, "O") : t0;
  if (!s) return null;
  if (/^(none|no|-|0|没有|无|なし|ない)$/i.test(s)) return { none: true };
  const sq = /^[a-h][1-8]$/i.test(s) ? { sq: s.toLowerCase() } : null;
  if (sq && !moveFirst) return sq;
  const g = new Chess(fen);
  const m = g.move(s, { sloppy: true }) || g.move(s.replace(/^([a-h][1-8])-?([a-h][1-8])([qrbn])?$/i, (_, a, b, c) => a.toLowerCase() + b.toLowerCase() + (c || "").toLowerCase()), { sloppy: true });
  if (m) return { move: { from: m.from, to: m.to, promotion: m.promotion }, san: m.san };
  return moveFirst ? null : sq;
}

/** Is `ans` right for look question `q`? */
export function judgeLook(Chess, q, ans) {
  if (!ans) return false;
  if (q.t === "mate") {
    if (ans.none) return !q.mates.length;
    const mv = ans.move || null;
    return !!mv && q.mates.some((m) => m.from === mv.from && m.to === mv.to);
  }
  const from = ans.sq || (ans.move && ans.move.from);
  if (!from || !q.answers.includes(from)) return false;
  // a typed move must be the move asked about, not just any move of that piece
  if (ans.move) {
    const g = new Chess(q.fen);
    const m = g.move(Object.assign({ promotion: "q" }, ans.move));
    return !!m && (q.t === "cap" ? m.to === q.sq : /[+#]$/.test(m.san));
  }
  return true;
}

/** "1. e4 e5 2. Nf3" from the side and move number of `fen`. */
export function lineText(fen, sans) {
  const f = String(fen).split(" ");
  let no = Number(f[5]) || 1, w = f[1] !== "b";
  return sans.map((s, i) => {
    const t = w ? no + ". " + s : i === 0 ? no + "… " + s : s;
    if (!w) no++;
    w = !w;
    return t;
  }).join(" ");
}

/**
 * The modes, over the trainer's pieces.
 * @param {object} d trainer/visual.js's bag: the book, the ratings, the
 *   trainer's seat / move / side, the modes' startRun / finishRun, Chess and
 *   ChessRating, and `mined` (the mined set, which may have arrived before
 *   it joined the book)
 */
export function createVisualModes(d) {
  const {
    store, t, tf, el, avail, setText, sync, Audio2, Chess, ChessRating, Srs, Progress, ALL_PUZZLES, mined,
    seatPuzzle, puzzleMove, puzzleHumanSide, puzzleRating, savePuzzleState, saveProgress, startRun, finishRun,
  } = d;
  const lang = () => LANG_AT[store.ui.langId] || 0;
  const w = (k, args) => {
    const s = W[k][lang()] || W[k][0];
    return args ? s.replace(/\{(\d)\}/g, (_, i) => (args[i] == null ? "" : String(args[i]))) : s;
  };
  const sideW = (c) => w(c === "b" ? "black" : "white");
  /** "Black knight", 「黑马」, 「黒のナイト」 */
  const manW = (pc) => (lang() === 1 ? sideW(pc.color) + " " + w(pc.type) : lang() === 2 ? sideW(pc.color) + "の" + w(pc.type) : sideW(pc.color).slice(0, 1) + w(pc.type));
  const ratingText = (r) => Math.round(r.r) + (ChessRating.isProvisional(r) ? "?" : "");

  // worked out again only when the book grows (the mined set joining late)
  const pools = { at: "", look: null, blind: null };
  function book() {
    const m = (mined && mined()) || [];
    const at = ALL_PUZZLES.length + ":" + m.length;
    if (pools.at !== at) {
      const all = ALL_PUZZLES.concat(m);
      Object.assign(pools, { at, look: lookPool(all), blind: blindPool(all) });
    }
    return pools;
  }

  /** puzzleState.vis[kind], made whole: an old save has none, a hand-edited one may be anything */
  function rec(kind) {
    const st = store.session.puzzleState;
    if (!st.vis || typeof st.vis !== "object") st.vis = {};
    let m = st.vis[kind];
    if (!m || typeof m !== "object") m = st.vis[kind] = {};
    if (!m.q || typeof m.q !== "object") m.q = {};
    return m;
  }
  /** Review keys due now, most overdue first. */
  function due(kind, now) {
    const q = rec(kind).q;
    return Object.keys(q).filter((k) => Srs.dueBy(q[k], now)).sort((a, b) => Srs.entry(q[a]).due - Srs.entry(q[b]).due);
  }

  const api = { make, serve, render, click, solved, missed, answer, renderMe };

  /** A new set: trainer/visual.js calls this, puzzle-modes.js startRun takes it from there. */
  function make(kind) {
    const now = Date.now();
    book();
    return { kind, own: api, seed: (now >>> 0) || 1, score: 0, strikes: 0, k: 0, used: [], startedAt: now,
      endsAt: 0, over: false, last: null, n: N_MIN, lvl: 0, due: due(kind, now).slice(0, REVIEW_MAX), total: SET };
  }

  /** The next question of the set on the board, or the set's end. */
  function serve(run) {
    if (run.over) return;
    if (run.k >= run.total) { run.why = "done"; finishRun(run); return; }
    const k = run.k;
    const key = k < run.due.length ? run.due[k] : null;
    run.k++;
    if (run.kind === "look") {
      const pool = book().look;
      let q = null;
      if (key) {
        const [pid, n, qs] = key.split("|");
        const p = pool.find((x) => x.id === pid);
        q = p ? buildLook(Chess, p, Number(n), Number(qs) >>> 0) : null;
      } else {
        // a question that cannot be put into words is skipped for another,
        // never seated: the card would be left half drawn (M2 review)
        for (let i = 0; i < 4 && !(q && asked(q)); i++) q = lookQuestion(Chess, pool, i ? mix(run.seed, i) : run.seed, k, run.n);
      }
      if (!q || !asked(q)) {
        if (key) { delete rec("look").q[key]; savePuzzleState(); serve(run); return; }
        run.why = "spent"; finishRun(run); return;
      }
      const p = { id: "look:" + q.key, cat: "look", fen: q.start, solution: [], side: q.start.split(" ")[1], vq: q, review: !!key };
      run.used.push(p.id);
      seatPuzzle("look", k, p, run);
      say(w("moves", [lineText(q.start, q.sans)]) + " " + asked(q));
    } else {
      const pools2 = book().blind;
      let p = key ? pools2[0].concat(pools2[1]).find((x) => x.id === key) : blindPick(pools2, run.seed, k, run.lvl, run.used);
      if (key && !p) { delete rec("blind").q[key]; savePuzzleState(); serve(run); return; }
      if (!p) p = blindPick(pools2, run.seed, k, 1 - run.lvl, run.used);
      if (!p) { run.why = "spent"; finishRun(run); return; }
      run.used.push(p.id);
      seatPuzzle("blind", k, p, run);
      const pz = store.session.puzzle;
      pz.review = !!key;
      pz.said = pz.g.history().length;
      // the men stay three seconds; the flag is on the puzzle, so a set parked
      // meanwhile (leaveTrainer) comes back with them hidden as they should be
      setTimeout(() => {
        // answered inside the three seconds: the answer's board stays shown
        if (pz.done) return;
        pz.hidden = true;
        if (store.session.puzzle === pz) { say(w("hidden")); sync(); }
      }, SHOW_MS);
      say(blindGoal(p) + " " + w("pos", [menText(pz.g)]) + " " + w("showing"));
    }
    sync();
    focusIn();
  }

  /** The men of `g`, as the piece letters and squares a reader can hold. */
  function menText(g) {
    const out = { w: [], b: [] };
    const order = "kqrbnp";
    for (const row of g.board()) for (const x of row) if (x) out[x.color].push(x);
    const fmt = (xs) => xs.sort((a, b) => order.indexOf(a.type) - order.indexOf(b.type) || (a.square < b.square ? -1 : 1))
      .map((x) => (x.type === "p" ? "" : x.type.toUpperCase()) + x.square).join(" ");
    return sideW("w") + " " + fmt(out.w) + w("semi") + sideW("b") + " " + fmt(out.b);
  }
  function blindGoal(p) {
    return w("qBlind", [sideW(new Chess(p.fen).turn()), t("pz.cat." + p.cat)]);
  }
  function question(q) {
    const s = sideW(q.side);
    if (q.t === "cap") return w("qCap", [s, q.sq, manW(q.target)]);
    if (q.t === "check") return w("qCheck", [s]);
    return w("qMate", [s]);
  }
  /** The question in words, or "" when it cannot be put (serve skips such a one). */
  const asked = (q) => { try { return question(q); } catch (_) { return ""; } };
  /** What the right answer was, in words. */
  function explain(q) {
    const g = new Chess(q.fen);
    const at = (sq) => w("on", [sq, manW(g.get(sq))]);
    if (q.t === "cap") return w("ansCap", [q.answers.map(at).join(w("sep"))]);
    if (q.t === "check") return w("ansCheck", [q.answers.map(at).join(w("sep"))]);
    return q.mates.length ? w("ansMate", [q.mates.map((m) => m.san).join(w("sep"))]) : w("ansNoMate");
  }

  // --- answering ---------------------------------------------------------------

  const cur = () => {
    const pz = store.session.puzzle;
    return pz && pz.run && pz.run.own === api && store.session.run === pz.run ? pz : null;
  };

  /** A look answer: right or wrong, the board then shows the position asked about. */
  function answerLook(ans) {
    const pz = cur();
    if (!pz || pz.done || !pz.p.vq) return;
    const q = pz.p.vq;
    const ok = judgeLook(Chess, q, ans);
    pz.g = new Chess(q.fen);
    pz.last = q.last;
    const sq = ans.move ? ans.move.to : ans.sq;
    pz.mark = sq ? { sq, ok } : null;
    if (q.t === "mate" && q.mates.length) pz.helpArrow = { from: q.mates[0].from, to: q.mates[0].to };
    // a wrong answer sounds as a wrong move does; a right one is not a won
    // game, and the fanfare is kept for those (test-chess: playEnding)
    if (!ok) Audio2.playWrong();
    settle(pz, ok, explain(q), q.key, q.r);
  }

  /** The trainer's verdicts on a blind move (puzzle-modes.js runSolved / runMissed). */
  function solved(pz) {
    const p = pz.p;
    settle(pz, true, w("ansLine", [p.solution.join(" ")]), p.id, puzzleRating(p).r + BLIND_PLUS);
  }
  function missed(pz, reason) {
    if (pz.p.vq) return; // look is never judged by the trainer
    pz.done = true;
    store.game.selection = null;
    Audio2.playWrong();
    // the next stored move, as the arrow 答案 draws in 做题
    const probe = new Chess(pz.g.fen());
    const next = pz.p.solution[pz.stage * 2];
    const mv = next ? probe.move(next) : null;
    if (mv) pz.helpArrow = { from: mv.from, to: mv.to };
    settle(pz, false, (reason ? reason + " · " : "") + w("ansLine", [pz.p.solution.join(" ")]), pz.p.id, puzzleRating(pz.p).r + BLIND_PLUS);
  }
  /** 答案 (H): this one is given up. */
  function answer(pz) {
    if (pz.p.vq) { answerLook({}); return; }
    missed(pz, t("run.gaveUp"));
  }

  /**
   * File the answer: the set's score and level, the mode's rating (first
   * answers only — a review moves its queue entry, not the rating), the
   * queue, the week's record; then the card.
   */
  function settle(pz, ok, sub, key, qr) {
    const run = pz.run;
    const kind = run.kind;
    const now = Date.now();
    pz.done = true;
    pz.hidden = false;
    store.game.selection = null;
    run.last = ok ? "ok" : "miss";
    if (ok) run.score++; else run.strikes++;
    if (kind === "look") run.n = Math.max(N_MIN, Math.min(N_MAX, run.n + (ok ? 1 : -1)));
    else run.lvl = ok ? 1 : 0;
    const m = rec(kind);
    const review = !!(pz.review || pz.p.review);
    if (!review) {
      const before = m.rating || ChessRating.newRating();
      m.rating = ChessRating.rate1v1(before, { r: qr, rd: 150, vol: 0.06 }, ok ? 1 : 0).player;
      pz.rating = { now: Math.round(m.rating.r), delta: Math.round(m.rating.r) - Math.round(before.r), provisional: ChessRating.isProvisional(m.rating) };
    }
    m[ok ? "solve" : "miss"] = (m[ok ? "solve" : "miss"] || 0) + 1;
    m.at = now;
    if (!ok) m.q[key] = Srs.onMiss(m.q[key], now);
    else if (m.q[key]) {
      const next = Srs.onSolve(m.q[key], now);
      if (next) m.q[key] = next; else delete m.q[key];
    }
    Progress.recordAnswer(store.session.progress, kind, !ok, now);
    saveProgress();
    savePuzzleState();
    pz.fb = { ok, head: ok ? w("ok") : t("run.missed"), sub };
    if (run.k >= run.total) { run.why = "done"; finishRun(run); } else store.commit("session", "sync");
    // the next step is one key away: 下一题, or 再来一局 once the set is done
    const to = el(run.over ? "pz-run-again" : "pz-vis-next");
    if (to && inCard()) to.focus();
  }

  /** A square on the board, in look: the answer, or the first half of a move. */
  function click(sq) {
    const pz = cur();
    if (!pz || pz.done || !pz.p.vq) return false;
    const q = pz.p.vq;
    if (q.t !== "mate") { answerLook({ sq }); return true; }
    const sel = store.game.selection;
    if (!sel) { store.game.selection = { sq, targets: [] }; sync(); return true; }
    store.game.selection = null;
    if (sel.sq === sq) { sync(); return true; }
    answerLook({ move: { from: sel.sq, to: sq } });
    return true;
  }

  /** The field: an answer in look, a move in blind. */
  function submit() {
    const pz = cur();
    const inp = el("pz-vis-in");
    if (!pz || pz.done || !inp) return;
    const text = inp.value;
    if (pz.p.vq) {
      const a = parseAnswer(Chess, pz.p.vq.fen, text, pz.p.vq.t === "mate");
      if (!a) { say(pz.p.vq.t === "mate" ? w("illegal", [text.trim()]) : w("bad")); return; }
      inp.value = "";
      answerLook(a);
      return;
    }
    if (pz.g.turn() !== puzzleHumanSide() || pz.verifying) return;
    const a = parseAnswer(Chess, pz.g.fen(), text, true);
    if (!a || !a.move) { say(w("illegal", [text.trim()])); return; }
    inp.value = "";
    puzzleMove(a.move.from, a.move.to, a.move.promotion || "q");
  }

  // --- the card ------------------------------------------------------------------

  /** One sentence for the screen reader: emptied first, so the same words are read again. */
  function say(s) {
    const n = el("pz-vis-say");
    if (!n) return;
    n.textContent = "";
    setTimeout(() => { n.textContent = s; }, 60);
  }
  const inCard = () => {
    const a = document.activeElement;
    const sec = el("sec-puzzle");
    return !a || a === document.body || (sec && sec.contains(a));
  };
  function focusIn() {
    const inp = el("pz-vis-in");
    if (inp && inCard()) inp.focus();
  }

  /** The set's card (puzzle-modes.js render, after the run card it shares). */
  function render(run) {
    const pz = cur();
    const kind = run.kind;
    const m = rec(kind);
    const done = pz ? pz.done : true;
    const q = pz && pz.p.vq;
    const head = run.over ? w("over", [run.score, run.k])
      : w(kind === "look" ? "ruleLook" : "ruleBlind", [run.total]) + " · " + w("nth", [run.k, run.total])
        + (pz && (pz.review || pz.p.review) ? " · " + w("review") : kind === "look" && q ? " · " + w("lvl", [q.n]) : "");
    setText(el("pz-run-head"), head);
    setText(el("pz-run-best"), (run.over && run.newBest ? tf("run.newBest", [run.score]) : tf("run.best", [(store.session.puzzleState.runs || {})[kind] ? store.session.puzzleState.runs[kind].best : 0]))
      + " · " + w("rating", [t("pz.cat." + kind), m.rating ? ratingText(m.rating) : "—"]));
    const moves = el("pz-vis-moves");
    const ask = el("pz-vis-q");
    if (q) {
      setText(moves, w("moves", [lineText(q.start, q.sans)]));
      setText(ask, asked(q));
    } else if (pz) {
      const h = pz.g.history();
      setText(moves, pz.hidden ? (h.length ? w("played", [lineText(pz.p.fen, h)]) : "") : w("pos", [menText(new Chess(pz.p.fen))]));
      setText(ask, blindGoal(pz.p) + " " + (pz.hidden ? w("hidden") : w("showing")));
      // the reply to a right first move of a mate in two: said, since it cannot be seen
      if (!pz.done && h.length > pz.said) {
        pz.said = h.length;
        if (h.length % 2 === 0) say(w("reply", [h[h.length - 1]]));
      }
    } else { setText(moves, ""); setText(ask, ""); }
    avail(moves, !!(moves && moves.textContent));
    const inp = el("pz-vis-in");
    if (inp) {
      inp.placeholder = w(q ? "phLook" : "phBlind");
      inp.setAttribute("aria-label", w("input"));
      inp.disabled = done;
    }
    setText(el("pz-vis-go"), w("go"));
    avail(el("pz-vis-row"), !done);
    const none = el("pz-vis-none");
    setText(none, w("none"));
    avail(none, !done && !!q && q.t === "mate");
    const next = el("pz-vis-next");
    setText(next, w("next"));
    avail(next, done && !run.over && !!pz);
  }

  // --- 「我的」 -------------------------------------------------------------------

  /** The section on 「我的」: each mode's rating, answers, best, and what is due. */
  function renderMe() {
    const sec = el("sec-vis");
    if (!sec) return;
    const st = store.session.puzzleState;
    const kinds = ["look", "blind"];
    const any = kinds.some((k) => st.vis && st.vis[k] && ((st.vis[k].solve || 0) + (st.vis[k].miss || 0) > 0));
    sec.hidden = !any;
    if (!any) return;
    setText(el("vis-h"), w("meH"));
    const now = Date.now();
    el("vis-body").replaceChildren(...kinds.map((k) => {
      const m = rec(k);
      const row = document.createElement("div");
      row.className = "stat-row";
      const a = document.createElement("span");
      a.className = "stat-k";
      a.textContent = t("pz.cat." + k);
      const b = document.createElement("span");
      b.className = "stat-v num";
      b.textContent = w("meRow", [m.rating ? ratingText(m.rating) : "—", m.solve || 0, m.miss || 0, (st.runs && st.runs[k] && st.runs[k].best) || 0]);
      row.append(a, b);
      return row;
    }));
    for (const k of kinds) {
      const b = el("vis-" + k);
      if (!b) continue;
      const n = due(k, now).length;
      b.textContent = n ? w("meDue", [t("pz.cat." + k), n]) : t("pz.cat." + k);
      b.onclick = () => startRun(k);
    }
  }

  // wired once, when the chunk arrives
  {
    const inp = el("pz-vis-in");
    if (inp) inp.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); submit(); } };
    const go = el("pz-vis-go");
    if (go) go.onclick = () => submit();
    const none = el("pz-vis-none");
    if (none) none.onclick = () => answerLook({ none: true });
    const next = el("pz-vis-next");
    if (next) next.onclick = () => {
      const run = store.session.run;
      if (run && run.own === api && !run.over) serve(run);
    };
  }

  return api;
}

export const CHESS_VISUAL = { createVisualModes, lookPool, blindPool, lookQuestion, buildLook, blindPick, parseAnswer, judgeLook, lineText, rng, mix, SET, N_MIN, N_MAX };
