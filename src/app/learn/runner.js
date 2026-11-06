/**
 * One item on the board: what the board shows, what the bar says, and what a
 * move does — for every kind the queue serves (v20-0-plan §6 S1: lesson,
 * puzzle, endgame, classic, opening are item types, not sections).
 *
 *   lesson   the skill's explanation; 开始练习 ends it
 *   stars    a move mini-game (learn/minigame.js): collect every target
 *   move     one move that meets a goal (learn/goals.js)
 *   line     a line to play — a puzzle, an opening, a mistake from your game:
 *            your moves are checked, the other side's are played for you
 *   drill    an endgame against the engine, to its goal
 *   game     a game against an opponent near your level (the page starts it)
 *
 * No DOM: `view` and `bar` are signals the page renders; `move(from, to)`
 * comes from the board; `onDone({ ok, tries, revealed })` once it is over.
 * @module learn/runner
 */
import { signal } from "../lib/signal.js";
import { Chess } from "../core/chess.js";
import * as MG from "./minigame.js";
import { judge } from "./goals.js";
import { explainMove, explainText } from "../core/explain.js";

const REPLY_MS = 450, RESET_MS = 900;
const sideOf = (fen) => (fen.split(" ")[1] === "b" ? "b" : "w");
const COLOR = { w: "white", b: "black" };
const uciOf = (m) => m.from + m.to + (m.promotion || "");
const lastOf = (m) => (m ? { from: m.from, to: m.to } : null);
const arrowOf = (fen, san) => {
  const m = new Chess(fen).move(san);
  return m ? [{ from: m.from, to: m.to, color: "G" }] : [];
};
const destsOf = (fen) => {
  const d = new Map();
  for (const m of new Chess(fen).moves({ verbose: true })) { if (!d.has(m.from)) d.set(m.from, []); d.get(m.from).push(m.to); }
  return d;
};
/** A move from the board as chess.js takes it; a pawn to the last rank becomes `promo` (default a queen). */
function tryMove(g, from, to, promo = "q") {
  const legal = g.moves({ verbose: true }).filter((m) => m.from === from && m.to === to);
  if (!legal.length) return null;
  return g.move(legal.find((m) => (m.promotion || "q") === promo) || legal[0]);
}

/**
 * What the move just tried did — the one explainer (core/explain.js), from
 * the board alone: the fact about *this* move (it is not mate: the king
 * escapes to …; it leaves the queen to be taken; it left the book …), never
 * the task again.
 */
function why(fen, move, ctx, t) {
  const res = explainMove(fen, move, ctx);
  return res && res.key ? { res, text: explainText(res, t, { extra: true }) } : null;
}

export function createRunner(item, { t, engine, later = (ms, fn) => setTimeout(fn, ms), onDone }) {
  const view = signal({ fen: item.fen, orientation: "white", movable: "none", dests: null, marks: [], arrows: [], lastMove: null, check: null });
  const bar = signal({ text: "", tone: null, actions: [] });
  let over = false, tries = 0, alive = true;
  const timers = [];
  const wait = (ms, fn) => timers.push(later(ms, () => { if (alive) fn(); }));
  const finish = (r) => { if (over) return; over = true; view.value = { ...view.peek(), movable: "none" }; onDone({ tries: Math.max(1, tries), ...r }); };
  const say = (text, tone = null, actions = bar.peek().actions) => { bar.value = { text, tone, actions }; };

  const kinds = {
    lesson() {
      view.value = { ...view.peek(), fen: item.fen || "8/8/8/8/8/8/8/8 w - - 0 1", dests: new Map() };
      say(t("learn.lessonReady"), null, [{ id: "start", label: t("learn.start"), primary: true, fn: () => finish({ ok: true }) }]);
      return {};
    },

    stars() {
      let g = MG.start(item.fen, item.targets, item.only);
      const show = (lastMove = null) => {
        view.value = { fen: MG.fenOfGame(g), orientation: "white", movable: g.done ? "none" : "white", dests: MG.destsOf(g),
          marks: g.left.map((sq) => ({ sq, color: "Y" })), arrows: [], lastMove, check: null };
      };
      const prompt = () => item.prompt || t("learn.collect", item.targets.length);
      const reset = () => { g = MG.start(item.fen, item.targets, item.only); show(); say(prompt()); };
      show();
      say(prompt(), null, [{ id: "reset", label: t("learn.reset"), fn: () => !over && reset() }]);
      return {
        move(from, to) {
          const h = MG.play(g, from, to);
          if (!h) return;
          g = h;
          show({ from, to });
          if (!g.done) { say(prompt() + " · " + t("learn.left2", g.left.length)); return; }
          tries = g.moves <= item.par ? 1 : 2;
          say(g.moves <= item.par ? t("learn.rightPar", g.moves) : t("learn.rightOver", g.moves, item.par), "good", []);
          finish({ ok: true });
        },
      };
    },

    move() {
      const side = sideOf(item.fen);
      const show = (fen, lastMove = null, arrows = []) => {
        view.value = { fen, orientation: COLOR[side], movable: over || fen !== item.fen ? "none" : COLOR[side],
          dests: destsOf(fen), marks: [], arrows, lastMove, check: true };
      };
      const prompt = item.prompt || t(item.promptKey || "puzzle.find");
      show(item.fen);
      const reveal = () => {
        if (over) return;
        show(item.fen, null, arrowOf(item.fen, item.answer));
        say(t("learn.shown", item.answer), null, []);
        finish({ ok: false, revealed: true });
      };
      say(prompt, null, [{ id: "answer", label: t("learn.answer"), fn: reveal }]);
      return {
        move(from, to) {
          const g = new Chess(item.fen);
          const mv = tryMove(g, from, to);
          if (!mv) return;
          tries++;
          const r = judge(item.fen, uciOf(mv), item);
          show(r.fen, lastOf(mv));
          if (r.ok) { say(t("learn.right") + " —— " + r.san, "good", []); finish({ ok: true }); return; }
          const w = why(item.fen, uciOf(mv), { kind: "lesson", goal: item.goal, expected: item.answer }, t);
          say(w ? t("learn.wrongWhy", w.text) : item.retry || (item.goal === "mate" ? t("learn.wrongMate", r.san) : t("learn.wrong")), "bad");
          wait(RESET_MS, () => { if (!over) show(item.fen); });
        },
      };
    },

    line() {
      const you = item.side;
      const g = new Chess(item.fen);
      let k = 0;                                  // index into item.line: the next move to be played
      let last = null;
      let intent = "";                            // a classic: what the master's move (just played by you) does
      const show = (arrows = []) => {
        const fen = g.fen();
        const yours = !over && sideOf(fen) === you && k < item.line.length;
        view.value = { fen, orientation: COLOR[you], movable: yours ? COLOR[you] : "none", dests: destsOf(fen), marks: [],
          arrows, lastMove: last, check: true };
      };
      const prompt = () => item.mode === "opening" ? t("learn.opening", item.name)
        : item.mode === "classic" ? t("learn.classic", item.name)
        : item.mode === "mistake" ? (item.played ? t("learn.mistake", item.played) : t("learn.mistakePlain"))
        : you === "b" ? t("puzzle.findBlack") : t("puzzle.find");
      const reply = () => {
        if (k >= item.line.length) { say(item.idea ? item.idea : t("learn.right"), "good", []); finish({ ok: true }); return; }
        wait(REPLY_MS, () => {
          const m = g.move(item.line[k++]);
          last = lastOf(m);
          show();
          if (k >= item.line.length) { say(item.idea || t("learn.right"), "good", []); finish({ ok: true }); }
          else say((intent || "") + t("learn.theirMove", m.san) + " —— " + t("learn.yourMove"));
          intent = "";
        });
      };
      const reveal = () => {
        if (over) return;
        show(arrowOf(g.fen(), item.line[k]));
        say(t("learn.shown", item.line[k]), null, []);
        finish({ ok: false, revealed: true });
      };
      show();
      say(prompt(), null, [{ id: "answer", label: t("learn.answer"), fn: reveal }]);
      // an opening for Black starts with White's move
      if (sideOf(item.fen) !== you) reply();
      return {
        move(from, to) {
          if (over || sideOf(g.fen()) !== you) return;
          const want = new Chess(g.fen()).move(item.line[k]);
          const mv = tryMove(g, from, to, want && want.from === from && want.to === to ? want.promotion || "q" : "q");
          if (!mv) return;
          if (!tries) tries = 1;
          const mates = g.in_checkmate();
          if ((want && uciOf(mv) === uciOf(want)) || (mates && item.mode !== "opening")) {
            if (item.mode === "classic" && !mates) {
              // the master's intent, said of your move now that it is the master's
              g.undo();
              const x = why(g.fen(), uciOf(mv), { kind: "classic" }, t);
              g.move(mv);
              intent = x && x.res.reason === "describe" && x.res.key !== "ex.describe" ? t("learn.classicSame", x.text) : "";
            }
            k++;
            last = lastOf(mv);
            if (mates) k = item.line.length;
            show();
            reply();
            return;
          }
          // wrong: shown a moment, taken back — and said what *this* move does
          tries++;
          last = lastOf(mv);
          show();
          g.undo();
          const here = g.fen();
          const w = item.mode === "opening" ? why(here, uciOf(mv), { kind: "opening", book: [item.line[k]] }, t)
            : item.mode === "classic" ? why(here, uciOf(mv), { kind: "classic", expected: item.line[k] }, t)
            : why(here, uciOf(mv), { kind: "lesson" }, t);
          const plain = item.mode === "opening" ? t("learn.openingWrong") : item.mode === "classic" ? t("learn.classicWrong") : t("learn.wrong");
          say(!w ? plain : item.mode === "opening" ? t("learn.openingWrongWhy", w.text) : item.mode === "classic" ? t("learn.classicWrongWhy", w.text) : t("learn.wrongWhy", w.text), "bad");
          // a classic: what players of your level play here, when the engine knows (Maia)
          if (item.mode === "classic" && engine && engine.humanMoves) {
            const at = k, before = bar.peek().text;
            Promise.resolve().then(() => engine.humanMoves(here, 1500)).then((dist) => {
              if (!alive || over || k !== at || bar.peek().text !== before || !Array.isArray(dist) || !dist.length) return;
              const x = explainMove(here, uciOf(mv), { kind: "classic", expected: item.line[at], human: dist, rating: 1500 });
              if (x && x.key) say(t("learn.classicWrongWhy", explainText(x, t, { extra: true })), "bad");
            }).catch(() => {});
          }
          wait(RESET_MS, () => { if (!over) { last = null; show(); } });
        },
      };
    },

    drill() {
      const you = sideOf(item.fen);
      const g = new Chess(item.fen);
      let last = null, busy = false, moves = 0;
      const goalText = item.goal === "draw" ? t("learn.drillDraw") : item.goal === "promote" ? t("learn.drillPromote") : t("learn.drillWin");
      const show = () => {
        const fen = g.fen();
        view.value = { fen, orientation: COLOR[you], movable: !over && !busy && sideOf(fen) === you ? COLOR[you] : "none",
          dests: destsOf(fen), marks: [], arrows: [], lastMove: last, check: true };
      };
      const restart = () => { while (g.history().length) g.undo(); last = null; busy = false; moves = 0; show(); say(goalText + (item.prompt ? " —— " + item.prompt : "")); };
      /** Over? true: reached; false: missed; null: play on. */
      const verdict = (mv) => {
        if (item.goal === "promote" && mv && mv.color === you && mv.promotion) return true;
        if (g.in_checkmate()) return sideOf(g.fen()) !== you;
        if (g.in_draw() || g.in_stalemate()) return item.goal === "draw";
        if (mv && mv.color !== you && mv.promotion && item.goal === "draw") return false;
        if (moves >= 50) return item.goal === "draw";
        return null;
      };
      let lastWhy = null;                         // the fact about your last move that cost the goal, if one is proved
      const end = (ok) => {
        const plain = ok ? t("learn.drillWon") : item.goal === "draw" ? t("learn.drillLost") : t("learn.drillFailed");
        say(!ok && lastWhy ? t("learn.drillStop", lastWhy) : plain, ok ? "good" : "bad", []);
        finish({ ok });
      };
      show();
      say(goalText + (item.prompt ? " —— " + item.prompt : ""), null, [{ id: "reset", label: t("learn.reset"), fn: () => !over && restart() }]);
      return {
        async move(from, to) {
          if (over || busy || sideOf(g.fen()) !== you) return;
          const before = g.fen();
          const mv = tryMove(g, from, to);
          if (!mv) return;
          moves++;
          last = lastOf(mv);
          busy = true;
          show();
          // 残局丢胜当场停: a win the board proves gone (king and pawn against king, solved
          // exactly) stops the drill on this move, and says what the move gave away
          const w = why(before, uciOf(mv), { kind: "endgame", goal: item.goal }, t);
          const E = w && w.res.facts.endgame;
          if (E && (E.left7th || E.leftBehind || E.square || E.kpk && E.kpk.lost)) lastWhy = w.text;
          if (E && E.kpk && E.kpk.lost && item.goal !== "draw") return end(false);
          let v = verdict(mv);
          if (v !== null) return end(v);
          let r = null;
          try { r = await engine.bestMove(g.fen(), { budget: { ms: 250 } }); } catch { r = null; }
          if (!alive || over) return;
          const reply = r && r.move ? g.move({ from: r.move.slice(0, 2), to: r.move.slice(2, 4), promotion: r.move[4] || "q" }) : null;
          busy = false;
          if (reply) last = lastOf(reply);
          show();
          v = verdict(reply);
          if (v !== null) end(v);
        },
      };
    },

    game() {
      view.value = { ...view.peek(), fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", dests: new Map() };
      return {};
    },
  };

  const k = (kinds[item.kind] || kinds.lesson)();
  return {
    view, bar,
    move: (from, to) => { if (!over && k.move) return k.move(from, to); },
    get over() { return over; },
    finish,
    dispose() { alive = false; timers.length = 0; },
  };
}
