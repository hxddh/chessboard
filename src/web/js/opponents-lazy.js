/**
 * The bundle's side of the opponents (v8-0-plan B4): a stand-in with the
 * same methods as opponents-ui.js, which loads js/chunk-opponents.js at
 * startup and forwards to it once it is there.
 *
 * Why a chunk: F5's first-paint budget. The ladder, the persona cards, the
 * rating maths and the styles are ~22 KB the first frame does not use, and
 * the bundle had 10 KB left. Until the chunk lands (a local script, so
 * milliseconds) every method answers the way 7.9 did — the strip says
 * Stockfish, a move is not paced, nothing resigns — and a game filed before
 * it lands is rated when it does. When it lands, `onReady` repaints.
 * @module opponents-lazy
 */
import { loadChunk } from "./chunk.js";

const CHUNK = { file: "chunk-opponents.js", global: "CHESS_OPPONENTS" };


/** @param {object} d opponents-ui.js's bag, plus loadStats and onReady */
export function createOpponentsLazy(d) {
  let mod = null, ui = null;
  const late = []; // filings waiting for the chunk
  const call = (name, dflt) => (...a) => (ui ? ui[name](...a) : dflt);
  const facade = {
    strip: (level, style) => (ui ? ui.strip(level, style) : { icon: "bot", name: "Stockfish", level: d.diffName(level) }),
    plan: call("plan", null), resigns: call("resigns", false), onOpen: call("onOpen", null),
    mount: call("mount"), paint: call("paint"), reset: call("reset"), maybeOffer: call("maybeOffer"),
    syncOffer: call("syncOffer"), wireOffer: call("wireOffer"), paintHello: call("paintHello"),
    paintCard: call("paintCard"), applyAdvice: call("applyAdvice"),
    /** persona.js, for engine.js's styled pick — null until the chunk is in */
    style: () => (mod ? mod.ChessPersona : null),
    /** Rate a filed game: `done(filing, late)`, now or when the chunk lands. */
    file(stats, rec, done) {
      const run = (isLate) => done(Object.assign({ id: rec.id, level: rec.diff }, mod.Opponents.fileRating(stats, rec, rec.t)), isLate);
      if (mod) run(false); else late.push(() => run(true));
    },
    ready: () => !!mod,
    /** the rung's name in a PGN tag (the raw id until the chunk is in) */
    enName: (id) => (mod && mod.Opponents.EN_NAME[id]) || id,
  };
  // after the first frame, not before it: F5's first paint fetches no chunk
  // but the boot one (test-board-e2e holds it to that)
  const later = (fn) => (typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(() => setTimeout(fn, 0)) : setTimeout(fn, 0));
  later(() => loadChunk(CHUNK.file, CHUNK.global).then((m) => {
    mod = m;
    ui = m.createOpponentsUI(Object.assign({}, d, { rating: () => m.Opponents.ratingOfStats(d.loadStats()) }));
    ui.mount();
    ui.wireOffer();
    for (const fn of late.splice(0)) fn();
    d.onReady();
  }, () => { /* no chunk: the game plays on as 7.9 did */ }));
  return facade;
}
