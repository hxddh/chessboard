/**
 * Stockfish engine manager: builds a Blob worker from the embedded loader
 * (engine-src.js globals), feeds it the wasm via postMessage, and exposes a
 * promise-based move API with Elo-limited difficulty tiers.
 *
 * Worker construction notes (hard-won under zero:// in the goban project):
 *  - workers cannot be loaded from packaged URLs → Blob source only
 *  - the loader's own worker auto-mode resolves the wasm by URL (broken in a
 *    Blob) → fake window/document so it exports the bare factory instead,
 *    then inject wasmBinary directly — zero URL resolution anywhere.
 * @module engine
 */
import { ChessPersona } from "./persona.js";
// `global` here means the real global object, and exactly two names on it:
// CHESS_SF_LOADER and CHESS_SF_WASM_B64, written by the separate classic
// script scripts/gen-engine-src.mjs generates. Everything else this module
// needs is imported.
const global = typeof window !== "undefined" ? window : globalThis;
  /**
   * difficulty id → search settings; elo:null = full strength.
   *
   * `beginner` is handicapped in this module rather than by UCI alone:
   * UCI_Elo bottoms out at 1320 and even Skill Level 1 only reaches ~27 ACPL
   * (measured — see scripts/test-strength.mjs), i.e. still a solid club player.
   * A real beginner opponent needs to hang material sometimes, so the tier
   * runs a shallow MultiPV search and samples among the candidates, often
   * deliberately taking the worst one. Measured: ~150 ACPL with ~1 serious
   * (≥300cp) mistake every four moves, while half its moves stay sensible.
   */
  const TIERS = {
    // 1.19 re-calibration. `worstBias` was 0.6 — six moves in ten were the
    // WORST of ten candidates — and the tier was not weak so much as
    // self-destructive: a bot playing random legal moves that merely avoided
    // dropping a piece to an immediate recapture scored 81% against it over 24
    // games. Meanwhile the next rung up was Elo 1320, so a learner who beat
    // this one had nowhere to go. Measured with scripts/test-novice.mjs, the
    // same bot now scores 66% here and 25% on `casual`, and near nothing at
    // 1320 — a ladder with rungs instead of a cliff.
    beginner: { skill: 0, depth: 2, multipv: 10, worstBias: 0.2, minMs: 350 },
    casual: { skill: 0, depth: 2, multipv: 6, worstBias: 0.15, minMs: 350 },
    easy: { elo: 1320, movetime: 500 },
    normal: { elo: 1700, movetime: 700 },
    hard: { elo: 2200, movetime: 900 },
    extreme: { elo: null, movetime: 1200 },
  };

  let worker = null;
  let readyPromise = null;
  let lineHandlers = [];
  let gen = 0;
  let chain = Promise.resolve();

  /** Serialize searches on the single worker (game moves vs analysis). */
  function exclusive(fn) {
    const run = chain.then(fn, fn);
    chain = run.then(() => {}, () => {});
    return run;
  }

  function workerSource(loaderText) {
    return [
      "var module = { exports: {} };",
      "var exports = module.exports;",
      "// fake web page: keeps the loader off its URL-based worker auto-mode",
      "var window = self;",
      "var document = {};",
      loaderText,
      "var __F = module.exports;",
      "var __engine = null;",
      "onmessage = function (ev) {",
      "  var msg = ev.data;",
      "  if (msg && msg.type === 'init') {",
      "    var eng = {",
      "      wasmBinary: new Uint8Array(msg.wasm),",
      "      listener: function (line) { postMessage(line); },",
      "    };",
      "    var p = __F.length >= 1 ? __F(eng) : __F()(eng);",
      "    p.then(function ready() {",
      "      if (eng._isReady && !eng._isReady()) { return setTimeout(ready, 10); }",
      "      __engine = eng;",
      "      postMessage('__sf_ready__');",
      "    });",
      "    return;",
      "  }",
      "  if (typeof msg === 'string' && __engine) {",
      "    __engine.ccall('command', null, ['string'], [msg], { async: /^go\\b/.test(msg) });",
      "  }",
      "};",
    ].join("\n");
  }

  function b64ToBuffer(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
  }

  function onLine(line) {
    for (const h of lineHandlers.slice()) h(line);
  }

  function send(cmd) {
    if (worker) worker.postMessage(cmd);
  }

  function waitFor(pred, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        lineHandlers = lineHandlers.filter((h) => h !== handler);
        reject(new Error("engine timeout"));
      }, timeoutMs || 20000);
      function handler(line) {
        if (pred(line)) {
          clearTimeout(timer);
          lineHandlers = lineHandlers.filter((h) => h !== handler);
          resolve(line);
        }
      }
      lineHandlers.push(handler);
    });
  }

  /** Boot the engine (idempotent). Resolves when UCI handshake completes. */
  function init() {
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      const loaderText = global.CHESS_SF_LOADER;
      const wasmB64 = global.CHESS_SF_WASM_B64;
      if (!loaderText || !wasmB64) throw new Error("engine sources missing");
      const blobUrl = URL.createObjectURL(new Blob([workerSource(loaderText)], { type: "text/javascript" }));
      worker = new Worker(blobUrl);
      worker.onmessage = (ev) => onLine(ev.data);
      const readyWait = waitFor((l) => l === "__sf_ready__", 30000);
      worker.postMessage({ type: "init", wasm: b64ToBuffer(wasmB64) });
      await readyWait;
      const uciWait = waitFor((l) => l === "uciok", 10000);
      send("uci");
      await uciWait;
      return true;
    })();
    readyPromise.catch(() => { readyPromise = null; });
    return readyPromise;
  }

  function isReady() {
    return !!worker;
  }

  /** Abandon any in-flight search results (game changed under it). */
  function cancel() {
    gen++;
    if (worker) send("stop");
  }

  function newGame() {
    gen++;
    if (worker) send("ucinewgame");
  }

  /**
   * Best move for `fen` at difficulty tier `diff`.
   * @param maxMs optional think-time cap (clocked games) — never below 120ms.
   * @returns {Promise<{from,to,promotion|null}|null>} null when stale/failed.
   */
  /**
   * @param {string} fen position to move from
   * @param {string} diff difficulty tier id
   * @param {number} [maxMs] clock pressure: shorten the search to fit
   * @param {{id: string, Chess: Function}} [persona] sparring personality —
   *   see persona.js. Supplying one forces a MultiPV search even on tiers
   *   that would otherwise take the single best move, because a personality
   *   has nothing to choose between without candidates.
   */
  function bestMove(fen, diff, maxMs, persona) {
    return exclusive(() => bestMoveInner(fen, diff, maxMs, persona));
  }

  function parseUci(uci) {
    if (!uci || uci === "(none)") return null;
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : null,
    };
  }

  /** score of an `info` line in centipawns from the side to move */
  function infoScore(line) {
    const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
    if (!m) return null;
    const v = Number(m[2]);
    return m[1] === "mate" ? (v > 0 ? 100000 - v : -100000 - v) : v;
  }

  async function bestMoveInner(fen, diff, maxMs, persona) {
    await init();
    const styled = persona && persona.id && persona.id !== "off" && ChessPersona;
    let base = TIERS[diff] || TIERS.normal;
    if (styled) base = Object.assign({}, base, { multipv: Math.max(base.multipv || 0, 14) });
    // Clock pressure only shortens time-based tiers; depth-based ones are
    // already near-instant and have nothing to trim.
    const tier = maxMs && base.movetime && !base.depth
      ? Object.assign({}, base, { movetime: Math.max(120, Math.min(base.movetime, Math.floor(maxMs))) })
      : base;
    const startedAt = Date.now();
    const myGen = ++gen;
    // drain any stray bestmove from a cancelled search: the engine processes
    // commands in order, so its readyok arrives after that bestmove.
    const drain = waitFor((l) => l === "readyok", 5000);
    send("isready");
    await drain;
    if (myGen !== gen) return null;
    // UCI options are sticky on the worker — always set every knob a tier
    // could have touched so no search inherits another tier's handicap.
    send("setoption name MultiPV value " + (tier.multipv || 1));
    if (tier.skill != null) {
      send("setoption name UCI_LimitStrength value false");
      send("setoption name Skill Level value " + tier.skill);
    } else if (tier.elo != null) {
      send("setoption name Skill Level value 20");
      send("setoption name UCI_LimitStrength value true");
      send("setoption name UCI_Elo value " + tier.elo);
    } else {
      send("setoption name Skill Level value 20");
      send("setoption name UCI_LimitStrength value false");
    }
    send("position fen " + fen);
    // MultiPV tiers need every candidate line, not just the final bestmove
    const cands = new Map(); // multipv index → {uci, score}
    const collect = (line) => {
      if (typeof line !== "string" || !tier.multipv) return;
      const mv = line.match(/\bmultipv (\d+)\b/);
      const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (!mv || !pv) return;
      cands.set(Number(mv[1]), { uci: pv[1], score: infoScore(line) });
    };
    if (tier.multipv) lineHandlers.push(collect);
    const budget = (tier.movetime || 2000) + 15000;
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), budget);
    send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
    let line;
    try { line = await wait; }
    finally { if (tier.multipv) lineHandlers = lineHandlers.filter((h) => h !== collect); }
    if (myGen !== gen) return null; // game moved on (undo/new/import)
    let picked = parseUci(line.split(/\s+/)[1]);
    if (tier.multipv && cands.size > 1) {
      const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      // strength first, then style: the tier decides how good the move is
      // allowed to be, the personality decides which of the moves that good
      // it actually likes
      if (tier.worstBias) picked = pickHandicapped(cands, tier) || picked;
      if (styled) {
        const styledUci = ChessPersona.pick(fen, list, persona.id, persona.Chess);
        if (styledUci) picked = parseUci(styledUci);
      } else if (!tier.worstBias) {
        picked = pickHandicapped(cands, tier) || picked;
      }
    }
    // depth-limited searches return almost instantly — hold the move briefly so
    // the opponent still reads as "thinking" instead of snapping back.
    if (picked && tier.minMs) {
      const left = tier.minMs - (Date.now() - startedAt);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (myGen !== gen) return null;
    }
    return picked;
  }

  /**
   * Weakened move choice for handicap tiers: sample among the MultiPV
   * candidates instead of always taking the best one. `worstBias` is the
   * chance of deliberately playing the worst candidate found — that is what
   * makes a beginner opponent actually lose material rather than merely
   * play second-best moves.
   */
  function pickHandicapped(cands, tier) {
    const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
    if (!list.length) return null;
    const scored = list.filter((c) => c.score != null);
    // never throw away a forced mate the tier already found — losing on
    // purpose from a winning position reads as a broken engine, not a weak one
    if (scored.length && scored[0].score >= 100000 - 50) return parseUci(list[0].uci);
    if (tier.worstBias && Math.random() < tier.worstBias && scored.length) {
      const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
      return parseUci(worst.uci);
    }
    return parseUci(list[Math.floor(Math.random() * list.length)].uci);
  }

  /**
   * Full-strength eval of `fen` for review analysis.
   * @returns {Promise<{cp,mate,turn,best}|null>} score in side-to-move terms
   * (`turn` = that side); null when stale/failed.
   */
  function analyze(fen, movetime) {
    return exclusive(() => analyzeInner(fen, movetime));
  }

  async function analyzeInner(fen, movetime) {
    await init();
    const myGen = ++gen;
    const drain = waitFor((l) => l === "readyok", 5000);
    send("isready");
    await drain;
    if (myGen !== gen) return null;
    const ms = movetime || 120;
    // all sticky from a handicap game — analysis is always full strength
    send("setoption name MultiPV value 1");
    send("setoption name Skill Level value 20");
    send("setoption name UCI_LimitStrength value false");
    send("position fen " + fen);
    let score = null; // last reported, side-to-move perspective
    let pv = null; // last reported principal variation (uci moves)
    const collect = (line) => {
      if (typeof line !== "string") return;
      const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
      if (m) score = { kind: m[1], val: Number(m[2]) };
      const pm = line.match(/\bpv\s+(.+)$/);
      if (pm) pv = pm[1].trim().split(/\s+/);
    };
    lineHandlers.push(collect);
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), ms + 15000);
    send("go movetime " + ms);
    let line;
    try { line = await wait; }
    finally { lineHandlers = lineHandlers.filter((h) => h !== collect); }
    if (myGen !== gen) return null;
    const uci = line.split(/\s+/)[1];
    return {
      cp: score && score.kind === "cp" ? score.val : null,
      mate: score && score.kind === "mate" ? score.val : null,
      turn: fen.split(" ")[1] === "b" ? "b" : "w",
      best: uci && uci !== "(none)" ? uci : null,
      pv: pv || null,
    };
  }

  export const ChessEngine = { init, isReady, bestMove, analyze, newGame, cancel, TIERS };
