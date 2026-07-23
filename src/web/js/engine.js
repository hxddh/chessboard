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
(function (global) {
  /** difficulty id → UCI settings; elo:null = full strength */
  const TIERS = {
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
   * @returns {Promise<{from,to,promotion|null}|null>} null when stale/failed.
   */
  function bestMove(fen, diff) {
    return exclusive(() => bestMoveInner(fen, diff));
  }

  async function bestMoveInner(fen, diff) {
    await init();
    const tier = TIERS[diff] || TIERS.normal;
    const myGen = ++gen;
    // drain any stray bestmove from a cancelled search: the engine processes
    // commands in order, so its readyok arrives after that bestmove.
    const drain = waitFor((l) => l === "readyok", 5000);
    send("isready");
    await drain;
    if (myGen !== gen) return null;
    if (tier.elo != null) {
      send("setoption name UCI_LimitStrength value true");
      send("setoption name UCI_Elo value " + tier.elo);
    } else {
      send("setoption name UCI_LimitStrength value false");
    }
    send("position fen " + fen);
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), tier.movetime + 15000);
    send("go movetime " + tier.movetime);
    const line = await wait;
    if (myGen !== gen) return null; // game moved on (undo/new/import)
    const uci = line.split(/\s+/)[1];
    if (!uci || uci === "(none)") return null;
    return {
      from: uci.slice(0, 2),
      to: uci.slice(2, 4),
      promotion: uci.length > 4 ? uci[4] : null,
    };
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
    send("setoption name UCI_LimitStrength value false");
    send("position fen " + fen);
    let score = null; // last reported, side-to-move perspective
    const collect = (line) => {
      if (typeof line !== "string") return;
      const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
      if (m) score = { kind: m[1], val: Number(m[2]) };
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
    };
  }

  global.ChessEngine = { init, isReady, bestMove, analyze, newGame, cancel, TIERS };
})(typeof window !== "undefined" ? window : globalThis);
