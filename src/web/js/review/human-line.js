/**
 * 「人会怎么走」：复盘和分析棋盘的引擎栏下面，同水平的人在这里走什么。
 *
 * 13.0 I (docs/v13-0-plan.md §2). The engine lines say what is best; this
 * line says what a person of your rating plays here — Maia's policy for the
 * band nearest your engine-game rating (1500 without one): the three most
 * played moves and how often. Two notes ride on it, both about the game's
 * own moves, and only a player's (in a game against the engine, yours):
 *
 * - the move the game played from here, when fewer than 5% of the band
 *   play it — 「少有人走」;
 * - on a ? / ??, when at least 30% of the band play that move too — then it
 *   is this band's common mistake, worth drilling (the 10.0 coach's line).
 *
 * The net runs in the Maia worker (human/worker.js, through human-lazy.js),
 * never on the page's thread; answers are kept per position, one question is
 * in flight at a time and only the latest position waits behind it. If the
 * weights cannot load, the line stays away for the session.
 *
 * Part of chunk-human.js, not the first paint: app.js holds the stand-in
 * (human-lazy.js's createHumanLineLazy), which asks for the chunk the first
 * time the line is wanted and hands over this bag, with chess.js's Chess
 * and the worker's maker in it (the chunk carries no copy of either).
 * @module review/human-line
 */
const BANDS = [1100, 1300, 1500, 1700, 1900];
/** Below this share of the band, the game's move is 「少有人走」. */
const RARE = 0.05;
/** At or above this share, a ? / ?? is the band's common mistake. */
const COMMON = 0.3;

/** The Maia band for a rating: the nearest of 1100 … 1900, 1500 without one. */
export function bandOf(r) {
  if (!Number.isFinite(r)) return 1500;
  return BANDS.reduce((a, b) => (Math.abs(b - r) < Math.abs(a - r) ? b : a));
}

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createHumanLine(d) {
  const { doc, store, t, tf, viewGame, gameAt, sanHistory, analysisFor, inModal, loadStats, writeSan, setText, Chess, engine } = d;
  const document = doc;
  /** band|fen chain → [{uci, p}] */
  const answers = new Map();
  let busy = false, dead = false;
  /** asked for while one was in flight: the latest two (the cursor's, and the ply before it) */
  let waiting = [];
  /** the positions up to the cursor, memoised on the cursor */
  let chain = { key: "", fens: [] };

  function band() {
    const s = loadStats();
    return bandOf(s && s.rating ? s.rating.r : NaN);
  }
  function wanted() {
    return !dead && store.ui.humanLine !== false && !inModal() && !store.session.retry && !store.session.editor &&
      (store.session.mode === "ai" || store.session.mode === "pvp") &&
      (!!store.session.analysisBoard || !!analysisFor());
  }
  /** The FENs of plies max(0, n − 7) … n of the line on the board: the net reads eight. */
  function fensTo(n) {
    const out = [];
    for (let k = Math.max(0, n - 7); k <= n; k++) out.push(gameAt(k).fen());
    return out;
  }
  function fensAtCursor() {
    const vi = store.game.viewIndex;
    const key = vi + "|" + viewGame().fen();
    if (chain.key !== key) chain = { key, fens: fensTo(vi) };
    return chain.fens;
  }
  const keyOf = (b, fens) => b + "|" + fens.join("/");
  /** Whose move ply `i` is (the side to move in gameAt(i)). */
  const mine = (i) => store.session.mode !== "ai" || gameAt(i).turn() === store.session.humanColor;

  /** The band's answer for these positions: from memory, or asked for (null meanwhile). */
  function answer(b, fens) {
    const key = keyOf(b, fens);
    if (answers.has(key)) return answers.get(key);
    if (busy) { waiting = waiting.filter((w) => keyOf(w.b, w.fens) !== key).concat([{ b, fens }]).slice(-2); return null; }
    busy = true;
    const fen = fens[fens.length - 1];
    const legal = new Chess(fen).moves({ verbose: true }).map((m) => m.from + m.to + (m.promotion || ""));
    engine().then((H) => H.policy(b, fens, legal, 6000)).then((r) => {
      if (answers.size > 400) answers.delete(answers.keys().next().value);
      answers.set(key, r.pol);
    }, () => { dead = true; }).then(() => {
      busy = false;
      const w = waiting.find((x) => !answers.has(keyOf(x.b, x.fens)));
      waiting = waiting.filter((x) => x !== w);
      if (w && !dead) answer(w.b, w.fens);
      sync();
    });
    return null;
  }

  /** The SAN of `uci` from `fen`. */
  function sanOf(fen, uci) {
    const m = new Chess(fen).move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
    return m ? m.san : uci;
  }
  /** The UCI of the game's ply `i` (the move from gameAt(i)). */
  function uciAt(i) {
    const h = sanHistory();
    if (i < 0 || i >= h.length) return null;
    const m = gameAt(i).move(h[i]);
    return m ? m.from + m.to + (m.promotion || "") : null;
  }

  function el() {
    const box = document.getElementById("human-line");
    if (!box) return null;
    // under the engine lines the board is reading: the review's, else 持续分析's
    const anchor = document.getElementById(analysisFor() ? "pv-line" : "live-line");
    if (anchor && box.previousElementSibling !== anchor) anchor.after(box);
    return box;
  }

  function sync() {
    const box = el();
    if (!box) return;
    if (!wanted()) { box.hidden = true; box.replaceChildren(); delete box.dataset.key; return; }
    const b = band();
    const vi = store.game.viewIndex;
    const fens = fensAtCursor();
    const fen = fens[fens.length - 1];
    const pol = new Chess(fen).moves().length ? answer(b, fens) : [];
    // the game's move from here, and the move that came here when it is a ? / ??
    const next = mine(vi) ? uciAt(vi) : null;
    const a = analysisFor();
    const tag = a && a.tags && vi > 0 ? a.tags[vi - 1] : null;
    const prevFens = (tag === "?" || tag === "??") && mine(vi - 1) ? fensTo(vi - 1) : null;
    const prevPol = prevFens ? answer(b, prevFens) : null;
    const prevUci = prevFens ? uciAt(vi - 1) : null;
    const key = JSON.stringify([b, fen, pol && pol.slice(0, 3), next, prevPol && prevUci, store.ui.langId]);
    box.hidden = false;
    if (box.dataset.key === key) return;
    box.dataset.key = key;
    box.replaceChildren();
    const head = document.createElement("span");
    head.className = "hl-k";
    head.textContent = tf("hl.head", [b]);
    box.appendChild(head);
    if (!pol) { box.appendChild(document.createTextNode("…")); box.setAttribute("aria-busy", "true"); return; }
    box.removeAttribute("aria-busy");
    const turn = fen.split(" ")[1] === "b" ? "b" : "w";
    const top = pol.filter((r) => r.p >= 0.03).slice(0, 3);
    top.forEach((r, i) => {
      const mv = document.createElement("span");
      mv.className = "hl-mv";
      const san = document.createElement("span");
      writeSan(san, sanOf(fen, r.uci), turn);
      mv.append(i ? " · " : "", san, " " + Math.round(r.p * 100) + "%");
      box.appendChild(mv);
    });
    if (next) {
      const hit = pol.find((r) => r.uci === next);
      if (!hit || hit.p < RARE) {
        const rare = document.createElement("span");
        rare.className = "hl-rare";
        const san = document.createElement("span");
        writeSan(san, sanOf(fen, next), turn);
        // 「本局 {0} 少有人走」: the move drawn where the sentence puts it
        const [pre, post] = t("hl.rare").split("{0}");
        rare.append(pre, san, post || "");
        box.appendChild(rare);
      }
    }
    if (prevPol && prevUci) {
      const hit = prevPol.find((r) => r.uci === prevUci);
      if (hit && hit.p >= COMMON) {
        const common = document.createElement("p");
        common.className = "hl-common";
        setText(common, tf("hl.common", [b, Math.round(hit.p * 100)]));
        box.appendChild(common);
      }
    }
  }

  return { sync, bandOf };
}
