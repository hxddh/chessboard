/**
 * 下 — the play screen (v20-0-plan §3 P2–P5). Board first; under it one
 * context bar that holds only what the moment needs; the move list is a
 * drawer; no evaluation while a game is on; toasts only for receipts.
 *
 *   playing     提示 · 和棋 · 认输 · 着法 · 新对局
 *   the coach   a move that hangs a man or allows mate is held *before* it is
 *               committed: 对方在威胁什么？ [再想想] [就走这步]
 *   hints       threat → checks and captures → the idea → the arrow
 *   the end     one quiet moment, then the review on the board (review/review.js)
 *
 * State lives in the store (state/play.js); this page keeps only what is on
 * screen: which bar, which hint, which position is being looked at.
 * @module pages/play
 */
import { h } from "../lib/dom.js";
import { signal, computed, effect, untrack, batch } from "../lib/signal.js";
import { createBoard } from "../board/board.js";
import { loadSet } from "../board/pieces.js";
import { readFen } from "../board/geometry.js";
import { selectFen, selectFens, selectLastMove } from "../state/play.js";
import { coachOn } from "../state/settings.js";
import { turnOf, applyMove, claimable, parseUci } from "../core/rules.js";
import { Chess } from "../core/chess.js";
import { left, format } from "../core/clock.js";
import { opponentById, coachBudget, DEFAULT_OPPONENT } from "../core/opponents.js";
import { acceptsDraw, ownOf, surprised } from "../opponents/mind.js";
import { oppText, sayLine } from "../opponents/lines.js";
import { portrait } from "../opponents/portraits.js";
import { dangerAfter, shouldAsk, threatNow, checksAndCaptures } from "../core/coach.js";
import { explainMistake, lineMotif, sanText } from "../core/explain.js";
import { sansOf } from "../core/pass.js";
import { scalarOf, winPct } from "../core/winpct.js";
import { newId } from "../services/db.js";
import { playText } from "../text/play.js";
import { createSound, moveSound } from "./play-sound.js";
import { openSheet } from "./play-sheet.js";
import { createDrawer } from "./play-drawer.js";
import { createReview } from "../review/review.js";

const COLOR = { w: "white", b: "black" };
const other = (c) => (c === "w" ? "b" : "w");
/** The side "you" play: the one the engine does not; null when two people share the board. */
const humanOf = (g) => (g && g.mode === "engine" ? other(g.engineColor) : null);
const COACH_MS = 150, HINT_MS = 400, RESULT_MS = 1600, SAY_MS = 7000;
const oppName = (g) => (g && g.mode === "engine" ? oppText(opponentById(g.opponent).id, "name") : "");

/** One move apart (a castle with a capture changes four squares): slide; further, the board just changes. */
function nearby(a, b) {
  if (a === b) return true;
  const p = readFen(a), q = readFen(b);
  let diff = 0;
  for (const [sq, c] of p) if (q.get(sq) !== c) diff++;
  for (const sq of q.keys()) if (!p.has(sq)) diff++;
  return diff <= 4;
}

export function mount(el, { store, engine, ready }) {
  const t = playText();
  const params = new URLSearchParams(location.search);
  const thinkScale = params.has("think") ? Number(params.get("think")) : 1;
  const review = createReview({ engine, db: ready, t, budget: Number(params.get("review")) || undefined });
  const sound = createSound(() => store.get().settings.sound !== "off");

  const game = store.select((s) => s.play.game);
  const fen = store.select(selectFen);
  const lastMove = store.select(selectLastMove);
  const settings = store.select((s) => s.settings);

  // what is on screen, and nothing else
  const mode = signal("play");        // play | checking | coach | confirm-resign | confirm-draw | confirm-claim | draw-wait | result
  const note = signal(null);          // { text, tone } in the bar while playing
  const hint = signal({ fen: null, level: 0, arrows: [], marks: [] });
  const viewAt = signal(null);        // a position index being looked at; null: the live one
  const pending = signal(null);       // the move the coach holds: { uci, san, fen, lastMove, rule }
  const thinking = signal(false);
  const said = signal(null);          // the opponent's line on screen: { text, key }
  /** per game: the opponent's looks (opponents/mind.js), which of its ≤ 3 lines it has said */
  const minds = new Map();
  const mindOf = (g) => { let m = minds.get(g.id); if (!m) minds.set(g.id, m = { looks: [], said: new Set() }); return m; };
  const reportShown = signal(false);
  const asked = new Map();            // gameId → questions asked
  const timers = new Set();
  const later = (ms, fn) => { const id = setTimeout(() => { timers.delete(id); fn(); }, ms); timers.add(id); return id; };

  // --- layout ------------------------------------------------------------------
  const boardEl = h("div", { class: "board-box", "data-test": "board" });
  const evalFill = h("div", { class: "eval-fill" });
  const evalBar = h("div", { class: "evalbar", "data-test": "evalbar", hidden: true, "aria-hidden": "true" }, evalFill);
  const strip = (pos) => {
    const face = h("span", { class: "strip-face" }), name = h("span", { class: "who" });
    const clock = h("span", { class: "clock", "data-test": "clock-" + pos });
    const think = h("span", { class: "thinking", "data-test": pos === "top" ? "thinking" : null, hidden: true }, t("opp.thinking"), h("i"), h("i"), h("i"));
    const say = h("span", { class: "say", "data-test": pos === "top" ? "opp-line" : null, hidden: true });
    return { el: h("div", { class: "strip " + pos }, h("span", { class: "strip-id" }, face, name, think), say, clock), name, clock, face, think, say };
  };
  const top = strip("top"), bottom = strip("bottom");
  const barText = h("p", { class: "bar-text", "data-test": "bar-text", "aria-live": "polite" });
  const barActions = h("div", { class: "bar-actions" });
  const bar = h("div", { class: "bar", "data-test": "bar" }, barText, barActions);
  const toastEl = h("div", { class: "toast", role: "status", "data-test": "toast", hidden: true });
  const drawer = createDrawer({ t, onPick: (i) => look(i), onStep: (d) => step(d), onCopy: copyPgn });
  const stage = h("div", { class: "stage" }, top.el, h("div", { class: "board-row" }, evalBar, boardEl), bottom.el, bar);
  const root = h("div", { class: "play" }, stage, drawer.el, toastEl);
  el.append(root);

  const s0 = settings.peek();
  const board = createBoard(boardEl, {
    fen: fen.peek(), pieceSet: s0.pieceSet, theme: s0.boardTheme, movable: "none",
    onMove: ({ from, to, premove }) => onBoardMove(from, to, premove),
    onReady: () => performance.mark("app:board"),
  });

  // --- actions -----------------------------------------------------------------
  const fensNow = () => selectFens(store.get());
  const yourTurn = (g, f) => !!g && !g.result && (g.mode === "pvp" || turnOf(f) === humanOf(g));

  function commit(uci) {
    const g = store.get().play.game;
    const before = selectFen(store.get());
    let next;
    try { next = store.dispatch("play.move", { uci, now: Date.now() }); } catch (e) { console.warn(e.message); return; }
    const m = next.play.game.moves[next.play.game.moves.length - 1];
    const piece = new Chess(before).get(uci.slice(0, 2));
    sound.play(moveSound(m.san), piece && piece.type);
    batch(() => { note.value = null; hint.value = { fen: null, level: 0, arrows: [], marks: [] }; if (g) mode.value = mode.peek() === "draw-wait" ? "draw-wait" : "play"; });
  }

  function onBoardMove(from, to, premove) {
    const g = game.peek();
    if (!g) return;
    if (review.state.peek().phase === "card") {
      return promotion(review.board.peek().fen, from, to, premove).then((p) => p != null && review.tryMove(from + to + p));
    }
    if (viewAt.peek() != null || pending.peek()) return;
    promotion(fen.peek(), from, to, premove).then((p) => { if (p != null) attempt(from + to + p); });
  }

  /** The piece a pawn becomes: "" for no promotion, null when the picker was dismissed. Synchronous when there is nothing to ask. */
  function promotion(f, from, to, premove) {
    const g = new Chess(f);
    const p = g.get(from);
    const promo = p && p.type === "p" && (to[1] === "8" || to[1] === "1");
    if (!promo) return { then: (fn) => fn("") };
    if (premove) return { then: (fn) => fn("q") };
    return pickPromotion(to, p.color);
  }

  function attempt(uci) {
    const g = game.peek(), f = fen.peek();
    const human = humanOf(g);
    const left = (asked.get(g.id) || 0) < budgetFor(g);
    if (g.coach && human && turnOf(f) === human && left) {
      const rule = dangerAfter(f, uci);
      if (rule) return hold(uci, rule);
    }
    commit(uci);
  }

  /** Questions per game: by level, and at least three when the player switched them on for a strong level. */
  const budgetFor = (g) => (g.coach ? coachBudget(store.get().settings.level) || 3 : 0);

  /** The coach looks before the move goes in: the board shows it, nothing is committed. */
  async function hold(uci, rule) {
    const g = game.peek(), f = fen.peek();
    const mv = applyMove(f, uci);
    batch(() => {
      pending.value = { uci, san: mv.san, fen: mv.fen, lastMove: { from: uci.slice(0, 2), to: uci.slice(2, 4) }, rule };
      mode.value = "checking";
    });
    let before = null, after = null;
    try {
      [before, after] = await Promise.all([
        engine.analyse(f, { lines: 1, budget: { ms: COACH_MS } }),
        engine.analyse(mv.fen, { lines: 1, budget: { ms: COACH_MS } }),
      ]);
    } catch { /* the board's facts alone decide */ }
    if (!pending.peek() || pending.peek().uci !== uci || fen.peek() !== f) return;
    const b = before && before.lines[0], a = after && after.lines[0];
    const facts = b && a ? explainMistake({ fen: f, played: mv.san, best: b.moves[0], line: sansOf(mv.fen, a.moves, 6) }) : null;
    const d = shouldAsk({ rule, facts, before: b ? scalarOf(b.score) : null, after: a ? scalarOf(a.score) : null, side: turnOf(f) });
    if (!d.ask) { pending.value = null; commit(uci); return; }
    asked.set(g.id, (asked.get(g.id) || 0) + 1);
    pending.value = { ...pending.peek(), why: d.why, drop: d.drop };
    mode.value = "coach";
  }

  function coachAnswer(play) {
    const p = pending.peek(), g = game.peek();
    if (!p) return;
    ready.then((db) => db.append({ type: "coach.prompt", gameId: g.id, ply: g.moves.length, uci: p.uci, why: p.why || null,
      choice: play ? "play" : "rethink" }));
    batch(() => { pending.value = null; mode.value = "play"; });
    if (play) commit(p.uci);
  }

  // --- hints (P3): threat → checks and captures → the idea → the arrow ------------
  let hintLine = null;
  function nextHint() {
    const f = fen.peek(), g = game.peek();
    const h0 = hint.peek();
    const level = h0.fen === f ? Math.min(4, h0.level + 1) : 1;
    if (level === 1 || !hintLine || hintLine.fen !== f) {
      hintLine = { fen: f, p: engine.analyse(f, { lines: 1, budget: { ms: HINT_MS } }).then((a) => a.lines[0] || null).catch(() => null) };
    }
    ready.then((db) => db.append({ type: "hint.used", gameId: g.id, ply: g.moves.length, level }));
    const me = turnOf(f);
    if (level === 1) {
      const th = threatNow(f);
      const text = !th ? t("hint.noThreat") : th.kind === "check" ? t("hint.threatCheck")
        : th.kind === "mate" ? t("hint.threatMate", sanText(th.san))
        : t("hint.threatPiece", sanText(th.san), t("piece." + th.piece));
      setHint(f, 1, text, [], []);
    } else if (level === 2) {
      const cc = checksAndCaptures(f);
      const all = [...cc.checks, ...cc.captures];
      const text = all.length ? t("hint.forcing", all.slice(0, 5).map((m) => sanText(m.san)).join("、")) : t("hint.noForcing");
      setHint(f, 2, text, [], [...new Set(all.map((m) => m.from))].map((sq) => ({ sq, color: "G" })));
    } else {
      setHint(f, level, t("hint.wait"), [], hint.peek().marks);
      hintLine.p.then((line) => {
        if (fen.peek() !== f || hint.peek().fen !== f) return;
        if (!line) { setHint(f, level, t("hint.noThreat"), [], []); return; }
        const sans = sansOf(f, line.moves, 6);
        const best = parseUci(line.moves[0]);
        if (level === 3) {
          const lm = lineMotif(f, sans);
          const mates = line.score.mate != null && (line.score.mate > 0) === (me === "w");
          const idea = lm ? t("motif." + lm.motif) : mates ? t("hint.ideaMate") : /x/.test(sans[0]) ? t("hint.ideaCapture")
            : /[+#]$/.test(sans[0]) ? t("hint.ideaCheck") : t("hint.ideaQuiet");
          setHint(f, 3, t("hint.idea", idea), [], []);
        } else {
          setHint(f, 4, t("hint.move", sanText(sans[0])), [{ from: best.from, to: best.to, color: "G" }], [{ sq: best.from, color: "G" }]);
        }
      });
    }
  }
  function setHint(f, level, text, arrows, marks) {
    batch(() => { hint.value = { fen: f, level, arrows, marks }; note.value = { text, tone: "hint" }; });
  }

  // --- draw, resign ------------------------------------------------------------------
  function offerDraw() {
    const g = game.peek();
    const claim = claimable(fensNow());
    mode.value = claim ? "confirm-claim" : "confirm-draw";
  }
  async function confirmDraw() {
    const g = game.peek();
    if (mode.peek() === "confirm-claim") { store.dispatch("play.draw", { reason: claimable(fensNow()), now: Date.now() }); return; }
    if (g.mode === "pvp") { store.dispatch("play.draw", { reason: "agreement", now: Date.now() }); return; }
    mode.value = "draw-wait";
    const f = fen.peek();
    let a = null;
    try { a = (await engine.analyse(f, { lines: 1, budget: { ms: 200 } })).lines[0]; } catch { a = null; }
    const cur = game.peek();
    if (!cur || cur.id !== g.id || cur.result) return;
    // its own look, from its side: it takes the draw when it is worse, by its character (core/opponents.js)
    const own = a ? (turnOf(f) === g.engineColor ? 1 : -1) * ownOf(a.score, f) : 0;
    if (acceptsDraw(opponentById(g.opponent), own, cur.moves.length)) {
      store.dispatch("play.draw", { reason: "agreement", now: Date.now() });
    } else {
      batch(() => { mode.value = "play"; note.value = { text: t("draw.declined", oppName(g)), tone: null }; });
    }
  }
  function resign() {
    const g = game.peek();
    store.dispatch("play.resign", { color: humanOf(g) || turnOf(fen.peek()), now: Date.now() });
  }

  // --- new game ------------------------------------------------------------------------
  let closeSheet = null;
  function newGame() {
    if (closeSheet) return;
    const g = game.peek(), st = store.get().settings;
    const last = {
      opponent: g && g.mode === "engine" ? g.opponent || DEFAULT_OPPONENT : g ? "friend" : DEFAULT_OPPONENT,
      color: g && g.mode === "engine" ? humanOf(g) : "w", tc: g && g.clock ? g.clock.id : "none",
      coach: g && g.mode === "engine" ? g.coach : coachOn(st),
    };
    closeSheet = openSheet(root, {
      t, last,
      onClose: () => { closeSheet = null; },
      onStart: (c) => {
        closeSheet = null;
        const color = c.color === "random" ? (Math.random() < 0.5 ? "w" : "b") : c.color;
        const friend = c.opponent === "friend";
        review.close();
        batch(() => { mode.value = "play"; note.value = null; viewAt.value = null; pending.value = null; reportShown.value = false; said.value = null; });
        store.dispatch("play.new", { id: newId(), mode: friend ? "pvp" : "engine", engineColor: friend ? null : other(color),
          opponent: friend ? null : c.opponent, tc: c.tc === "none" ? null : c.tc, coach: !friend && c.coach });
        sound.play("start");
      },
    });
  }

  // --- looking back -----------------------------------------------------------------------
  function look(i) {
    const n = fensNow().length - 1;
    const idx = Math.max(0, Math.min(n, i));
    viewAt.value = idx === n && !game.peek().result ? null : idx;
  }
  function step(d) {
    const n = fensNow().length - 1;
    const cur = viewAt.peek() ?? n;
    look(cur + d);
  }
  function copyPgn() {
    const g = game.peek();
    const sans = g.moves.map((m, i) => (i % 2 === 0 ? (i / 2 + 1) + ". " : "") + m.san).join(" ");
    const text = sans + (g.result ? " " + g.result.result : "");
    Promise.resolve(navigator.clipboard && navigator.clipboard.writeText(text)).catch(() => {}).then(() => toast(t("toast.copied")));
  }
  function toast(text) {
    toastEl.textContent = text;
    toastEl.hidden = false;
    later(1800, () => { toastEl.hidden = true; });
  }
  function toggleDrawer() {
    drawer.open = !drawer.open;
    reportShown.value = drawer.open;
    if (!drawer.open) viewAt.value = null;
    else drawer.setCursor(viewAt.peek() ?? fensNow().length - 1);
  }

  // --- promotion picker -----------------------------------------------------------------
  let promoClose = null;
  function pickPromotion(to, color) {
    if (promoClose) promoClose(null);
    return new Promise((resolve) => {
      const s = store.get().settings;
      const orient = board.state().orientation;
      const file = to.charCodeAt(0) - 97;
      const col = orient === "black" ? 7 - file : file;
      const pickEl = h("div", { class: "promo", role: "dialog", "aria-label": t("promo.title"), "data-test": "promo",
        style: `left:${col * 12.5}%;${(to[1] === "8") === (orient === "white") ? "top:0" : "bottom:0"}` });
      const done = (p) => { pickEl.remove(); removeEventListener("keydown", onKey); promoClose = null; resolve(p); };
      for (const p of ["q", "n", "r", "b"]) {
        const img = h("img", { alt: t("piece." + p) });
        loadSet(s.pieceSet).then((imgs) => { img.src = imgs[color + p].src; });
        pickEl.append(h("button", { type: "button", "data-test": "promo-" + p, "aria-label": t("piece." + p), onclick: () => done(p) }, img));
      }
      const onKey = (e) => { if (e.key === "Escape") done(null); };
      addEventListener("keydown", onKey);
      promoClose = done;
      boardEl.append(pickEl);
      pickEl.querySelector("button").focus();
    });
  }

  // --- the bar --------------------------------------------------------------------------
  const btn = (id, label, onclick, cls = "") => h("button", { type: "button", "data-test": id, class: cls, onclick }, label);
  const barModel = computed(() => {
    const g = game.value, f = fen.value, m = mode.value, rv = review.state.value;
    if (!g) return { phase: "idle", text: "…", actions: [] };
    const human = humanOf(g);
    const opp = oppName(g);
    const moves = btn("moves", t("act.moves"), toggleDrawer, "quiet");
    const fresh = btn("new", t("act.new"), newGame, "quiet");
    if (rv.phase !== "idle" && m !== "result") return reviewBar(rv, g, moves, fresh);
    if (m === "result" || g.result) {
      return { phase: "result", text: resultText(g), tone: "moment", actions: [moves, fresh] };
    }
    if (viewAt.value != null) {
      return { phase: "viewing", text: t("bar.viewing", viewAt.value), actions: [btn("live", t("bar.live"), () => { viewAt.value = null; }, "primary"), moves] };
    }
    if (m === "checking") return { phase: "checking", text: t("coach.checking"), actions: [] };
    if (m === "coach") {
      return { phase: "coach", text: t("coach.ask"), tone: "coach", actions: [
        btn("rethink", t("coach.rethink"), () => coachAnswer(false), "primary"), btn("play-anyway", t("coach.play"), () => coachAnswer(true))] };
    }
    if (m === "confirm-resign") {
      return { phase: "confirm", text: t("confirm.resign"), actions: [
        btn("confirm", t("act.confirmResign"), resign, "danger"), btn("cancel", t("act.cancel"), () => { mode.value = "play"; })] };
    }
    if (m === "confirm-draw" || m === "confirm-claim") {
      const claim = m === "confirm-claim" ? claimable(selectFens(store.state.value)) : null;
      return { phase: "confirm", text: claim ? t("confirm.claim", t("claim." + claim)) : t("confirm.draw"), actions: [
        btn("confirm", claim ? t("act.claimDraw") : t("act.offerDraw"), confirmDraw, "primary"), btn("cancel", t("act.cancel"), () => { mode.value = "play"; })] };
    }
    const n = note.value;
    const mine = yourTurn(g, f);
    const text = n ? n.text : m === "draw-wait" ? t("draw.thinking", opp) : !mine && g.mode === "engine" ? t("bar.theirTurn", opp)
      : g.mode === "pvp" ? t("bar.toMove", t("side." + turnOf(f))) : new Chess(f).in_check() ? t("bar.check") : t("bar.yourTurn");
    const hintLabel = hint.value.fen === f && hint.value.level > 0 && hint.value.level < 4 ? t("act.hintMore") : t("act.hint");
    const hintBtn = btn("hint", hintLabel, nextHint, "");
    hintBtn.disabled = !mine || hint.value.fen === f && hint.value.level >= 4;
    return { phase: "play", text, tone: n ? n.tone : null, actions: [hintBtn,
      btn("draw", t("act.draw"), offerDraw, "quiet"), btn("resign", t("act.resign"), () => { mode.value = "confirm-resign"; }, "quiet"), moves, fresh] };
  });

  function reviewBar(rv, g, moves, fresh) {
    const report = btn("report", t("rv.report"), () => { if (!drawer.open) toggleDrawer(); }, "quiet");
    if (rv.phase === "running") return { phase: "review-running", text: t("rv.running", rv.done, rv.total), actions: [moves, fresh] };
    if (rv.phase === "failed") return { phase: "review-failed", text: t("rv.noEngine", rv.error), actions: [moves, fresh] };
    if (rv.phase === "empty") return { phase: "review-empty", text: resultText(g) + " · " + t("rv.clean"), actions: [report, fresh] };
    if (rv.phase === "done") return { phase: "review-done", text: resultText(g) + " · " + t("rv.done"), actions: [report, btn("new", t("act.new"), newGame, "primary")] };
    // a card
    const last = rv.k + 1 >= rv.count;
    const text = rv.note || review.headline() + " " + t("rv.tryAgain");
    const next = btn("rv-next", last ? t("rv.finish") : t("rv.next"), () => review.next(), rv.solved || rv.shown ? "primary" : "quiet");
    const actions = rv.solved || rv.shown ? [next, report] : [btn("rv-answer", t("rv.answer"), () => review.answer(), "primary"), next, report];
    return { phase: "review-card", text, tone: rv.tone, count: t("rv.cardOf", rv.k + 1, rv.count), actions };
  }

  function resultText(g) {
    const r = g.result;
    if (!r) return "";
    const human = humanOf(g);
    const head = r.result === "1/2-1/2" ? t("res.draw") : !human ? t(r.result === "1-0" ? "res.white" : "res.black")
      : (r.result === "1-0") === (human === "w") ? t("res.win") : t("res.loss");
    return head + " · " + t("reason." + r.reason);
  }

  const stops = [];
  stops.push(effect(() => {
    const b = barModel.value;
    bar.dataset.phase = b.phase;
    bar.dataset.tone = b.tone || "";
    barText.replaceChildren(b.count ? h("span", { class: "bar-count", text: b.count }) : "", b.text);
    barActions.replaceChildren(...b.actions);
  }));

  // --- the board ----------------------------------------------------------------------------
  stops.push(effect(() => {
    const s = settings.value;
    board.set({ pieceSet: s.pieceSet, theme: s.boardTheme });
  }));

  const view = computed(() => {
    const g = game.value, f = fen.value;
    const human = humanOf(g);
    const orientation = human === "b" ? "black" : "white";
    const rb = review.board.value;
    if (rb) return { ...rb, marks: [] };
    const p = pending.value;
    if (p) return { fen: p.fen, lastMove: p.lastMove, movable: "none", orientation, arrows: [], marks: [] };
    const at = viewAt.value;
    if (at != null && g) {
      const fens = selectFens(store.state.value);
      const m = g.moves[at - 1];
      return { fen: fens[at], lastMove: m ? { from: m.uci.slice(0, 2), to: m.uci.slice(2, 4) } : null, movable: "none", orientation,
        arrows: [], marks: [], evalAt: review.data ? review.scalarAt(at) : undefined };
    }
    const hv = hint.value.fen === f ? hint.value : null;
    const movable = !g || g.result || mode.value !== "play" && mode.value !== "draw-wait" ? "none" : human ? COLOR[human] : "both";
    return { fen: f, lastMove: lastMove.value, movable, orientation, arrows: hv ? hv.arrows : [], marks: hv ? hv.marks : [] };
  });
  let shownFen = fen.peek();
  stops.push(effect(() => {
    const v = view.value;
    const animate = nearby(shownFen, v.fen);
    shownFen = v.fen;
    board.set({ fen: v.fen, lastMove: v.lastMove, movable: v.movable, orientation: v.orientation, arrows: v.arrows, marks: v.marks, animate });
    // the evaluation only once the game is over (v20-0-plan §3 P4)
    const showEval = v.evalAt != null && !!game.value && !!game.value.result;
    evalBar.hidden = !showEval;
    if (showEval) {
      const w = winPct(v.evalAt);
      evalFill.style.height = (v.orientation === "black" ? 100 - w : w).toFixed(1) + "%";
      evalBar.dataset.side = v.orientation;
    }
    untrack(() => drawer.setCursor(viewAt.value ?? (review.board.value ? null : fensNow().length - 1)));
  }));

  // the drawer's rows: one appended per move; the report's marks once the review has them
  stops.push(effect(() => {
    const g = game.value;
    drawer.setMoves(g ? g.moves : [], g && g.id);
  }));
  stops.push(effect(() => {
    const rv = review.state.value, g = game.value;
    const has = rv.phase === "card" || rv.phase === "done" || rv.phase === "empty";
    untrack(() => drawer.setReport(has ? review.report() : null, g && (humanOf(g) || null)));
  }));

  // --- names and clocks ----------------------------------------------------------------------
  stops.push(effect(() => {
    const g = game.value;
    if (!g) return;
    const human = humanOf(g);
    const bottomColor = human || "w";
    const opp = g.mode === "engine" ? opponentById(g.opponent) : null;
    top.name.textContent = opp ? oppText(opp.id, "name") + " · " + opp.rating : t("side." + other(bottomColor));
    top.face.replaceChildren(...(opp ? [portrait(opp.id, "portrait small")] : []));
    bottom.name.textContent = g.mode === "engine" ? t("side.you") : t("side." + bottomColor);
    top.el.dataset.color = other(bottomColor);
    bottom.el.dataset.color = bottomColor;
  }));
  let tick = null;
  function drawClocks() {
    const g = store.get().play.game;
    if (!g || !g.clock) { top.clock.textContent = bottom.clock.textContent = ""; return; }
    const now = Date.now();
    const bottomColor = humanOf(g) || "w";
    for (const [s, c] of [[bottom, bottomColor], [top, other(bottomColor)]]) {
      const ms = left(g.clock, c, now);
      const txt = format(ms);
      if (s.clock.textContent !== txt) s.clock.textContent = txt;
      s.clock.classList.toggle("running", g.clock.since != null && g.clock.turn === c && !g.result);
      s.clock.classList.toggle("low", ms < 20000);
    }
    if (!g.result && g.clock.since != null && left(g.clock, g.clock.turn, now) <= 0) {
      store.dispatch("play.flag", { color: g.clock.turn, now });
    }
  }
  stops.push(effect(() => {
    const g = game.value;
    untrack(drawClocks);
    const running = !!(g && g.clock && !g.result);
    if (running && !tick) tick = setInterval(drawClocks, 100);
    if (!running && tick) { clearInterval(tick); tick = null; }
  }));

  // --- the opponent's moves ----------------------------------------------------------------
  // engine.bestMove plays the profile's whole turn (opponents/mind.js): the
  // move, how long a person would think over it, its look, a resignation.
  // The page shows the thinking, waits the rest of the think time, and says
  // at most three lines a game: hello, one reaction, the result.
  function say(g, key) {
    const m = mindOf(g);
    const end = (k) => k !== "hello" && k !== "react";
    if (m.said.has(key) || (end(key) && [...m.said].some(end))) return;
    const text = sayLine(opponentById(g.opponent).id, key);
    if (!text) return;
    m.said.add(key);
    said.value = { text, key };
    if (key === "hello" || key === "react") later(SAY_MS, () => { if (said.peek() && said.peek().text === text) said.value = null; });
  }
  stops.push(effect(() => {
    const g = game.value, f = fen.value;
    if (!g || g.mode !== "engine" || g.result || turnOf(f) !== g.engineColor || pending.value) return;
    untrack(() => { thinking.value = true; });
    let live = true;
    const prof = opponentById(g.opponent);
    const mind = mindOf(g);
    const fens = selectFens(store.get());
    const ctx = { history: fens.slice(0, -1), looks: mind.looks.slice() };
    if (g.clock) { ctx.clockMs = left(g.clock, g.engineColor, Date.now()); ctx.incMs = (g.clock.inc || 0); }
    const t0 = Date.now();
    engine.bestMove(f, prof, ctx).then((r) => {
      if (!live || selectFen(store.get()) !== f) return;
      const prev = mind.looks[mind.looks.length - 1];
      if (Number.isFinite(r.look)) mind.looks.push(r.look);
      const wait = Math.max(0, (r.thinkMs || 0) * thinkScale - (Date.now() - t0));
      const play = () => {
        const cur = store.get().play.game;
        if (!live || selectFen(store.get()) !== f || !cur || cur.result) return;
        untrack(() => { thinking.value = false; });
        if (r.resign) { say(cur, "resign"); store.dispatch("play.resign", { color: cur.engineColor, now: Date.now() }); return; }
        if (!r.move) return;
        if (surprised(prev, r.look)) say(cur, "react");
        commit(r.move);
      };
      if (wait > 5) later(wait, play); else play();
    }).catch((e) => console.warn("engine:", e.message));
    return () => { live = false; untrack(() => { thinking.value = false; }); };
  }));
  // a game that starts on your move still gets its hello
  stops.push(effect(() => {
    const g = game.value;
    if (g && g.mode === "engine" && !g.result && !g.moves.length) untrack(() => say(g, "hello"));
  }));
  stops.push(effect(() => {
    const on = thinking.value;
    top.think.hidden = !on;
    top.el.toggleAttribute("data-thinking", on);
  }));
  stops.push(effect(() => {
    const s = said.value;
    top.say.hidden = !s;
    top.say.textContent = s ? s.text : "";
    if (s) top.say.dataset.key = s.key;
  }));

  // --- the end, once; then the review --------------------------------------------------------
  // A game that ends here gets its moment (a sound, the result in the bar)
  // and then the review; one that comes back finished from the db goes
  // straight to its stored review.
  const openReview = (g) => review.open(g, { orientation: humanOf(g) === "b" ? "black" : "white", sides: humanOf(g) ? [humanOf(g)] : ["w", "b"] });
  function moment(g) {
    const human = humanOf(g);
    if (human) {
      // its one line at the end (none after its own resignation: that was the line)
      const r = g.result.result;
      say(g, r === "1/2-1/2" ? "drawn" : (r === "1-0") === (g.engineColor === "w") ? "won" : "lost");
    }
    sound.play(g.result.result === "1/2-1/2" ? "draw" : !human || (g.result.result === "1-0") === (human === "w") ? "win" : "loss");
    batch(() => { mode.value = "result"; pending.value = null; note.value = null; viewAt.value = null; });
    later(RESULT_MS, () => {
      if (store.get().play.game !== g) return;
      mode.value = "play";
      openReview(g);
    });
  }
  stops.push(store.subscribe(({ name, prev, next }) => {
    const g = next.play.game, was = prev.play.game;
    if (!g || !g.result || (was && was.id === g.id && was.result)) return;
    if (name === "play.restore") openReview(g); else moment(g);
  }));
  if (game.peek() && game.peek().result) openReview(game.peek());

  // keys: ← → walk the moves when nothing else has the keyboard
  function onKey(e) {
    if (e.target && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key === "ArrowLeft" && document.activeElement !== board.canvas) { step(-1); e.preventDefault(); }
    else if (e.key === "ArrowRight" && document.activeElement !== board.canvas) { step(1); e.preventDefault(); }
  }
  addEventListener("keydown", onKey);

  ready.then(() => {
    const g = store.get().play.game;
    if (!g) return;
    store.dispatch("play.resume", { now: Date.now() });
  });

  // for the e2e and the console
  window.__play = { board, review, sound, get mode() { return mode.peek(); }, hint, pending };

  return () => {
    stops.forEach((s) => s());
    timers.forEach(clearTimeout);
    if (tick) clearInterval(tick);
    removeEventListener("keydown", onKey);
    if (closeSheet) closeSheet();
    review.close();
    sound.close();
    board.destroy();
  };
}
