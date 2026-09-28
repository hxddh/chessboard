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
   * deliberately taking the worst one. Measured: 106 ACPL, a serious (≥300cp)
   * mistake in 14% of moves, median loss 42 — so half its moves stay sensible.
   *
   * Figures from docs/measured.json (scripts/test-strength.mjs --record);
   * test-chess.mjs fails if this comment stops agreeing with the file.
   *
   * v8-0-plan B4 — the ladder, twelve rungs, each a step (60–75%) above the
   * last in games between them (docs/measured.json `ladder`, the ratings):
   *
   * - `beginner` worstBias 0.2 → 0.15 and `casual` 6 → 8 candidates, worstBias
   *   0.15 → 0.12. Played against each other the 1.19 `casual` scored 91%
   *   against `beginner` — three rungs above it, not one.
   * - `learner` … `solid` fill the cliff between 休闲 and 初级 (the careful
   *   novice bot scored 29% on one side of it and next to nothing on the
   *   other; UCI_Elo stops at 1320, so UCI cannot fill it). They are
   *   handicapped here, but not by playing the worst candidate on purpose:
   *   each samples its MultiPV list weighted by the win chance a candidate
   *   gives away (`winT`, in win-percentage points: a move that costs `winT`
   *   is e^-1 as likely as the best one), a little deeper per rung. A small
   *   slip is common and a dropped piece rare, which is how a player at that
   *   level loses. The list's length moves the strength as much as the
   *   temperature (12 candidates at winT 60 played level with `casual`; 8
   *   scored 82% against it).
   * - `easyplus` / `normalminus`: 1700 scored 94% against 1320, three rungs
   *   apart, not one.
   *
   * These notes sit here and not beside the rows: a comment inside the
   * literal ships in the bundle (esbuild keeps it), and F5's budget is bytes.
   */
  const TIERS = {
    // 1.19 re-calibration. `worstBias` was 0.6 — six moves in ten were the
    // WORST of ten candidates — and the tier was not weak so much as
    // self-destructive: a bot playing random legal moves that merely avoided
    // dropping a piece to an immediate recapture scored 81% against it over 24
    // games. Meanwhile the next rung up was Elo 1320, so a learner who beat
    // this one had nowhere to go. The same bot now scores 59% here and 40% on
    // `casual` over 100 games (29% until v8-0-plan B4 gave it more
    // candidates), and less on each of the four rungs B4 put above it, down
    // to near nothing at 1320 — a ladder with rungs instead of a cliff.
    // (Those were 56% and 27% until 7.1.1: they were
    // measured under Stockfish 18, 7.0 swapped in SF19 lite-single, and
    // nobody re-ran the match. Re-measured at 5×20 games per tier, the
    // figures moved up ~3 points — a weaker engine makes a weaker tier.)
    //
    // Those two numbers are docs/measured.json's, not this comment's: run
    // `node scripts/test-novice.mjs --record` to change them, and
    // test-chess.mjs fails if this comment and README stop agreeing with the
    // file. Until 1.25 this comment said 66% / 25% with no game count while
    // README said 56% / 27% over 32, and there was no way to tell which run
    // either came from — the script printed to a terminal and forgot. The 24
    // games named above are the *previous* calibration's, and are staying: a
    // before number is what makes an after number mean something.
    // 2.0 measured and left alone. 缺陷 32 said the tier's strength is a
    // function of the MultiPV candidate count, which moves with the phase.
    // Measured over 391 positions (docs/measured.json `multipvPhase`): the
    // count barely moves — 9.9 / 8.2 / 8.8 candidates across opening /
    // middlegame / endgame — because there are almost always more than ten
    // legal moves even when there are only eighteen. What does move, by four
    // times, is how far apart the candidates are: 115 / 235 / 479cp between
    // the best and the worst. So a uniform pick gives away four times as much
    // per move in an endgame.
    //
    // Weighting the pick by that gap was then tried and measured, twice, and
    // is NOT shipped: at spreadK 250 the novice's score rate fell 56% → 33%
    // and 27% → 6%, and at 700 — soft enough to touch only the catastrophic
    // tail — still 38% and 8%. That tail is load-bearing. Buying phase
    // uniformity means raising `worstBias` back toward the 0.6 that the 1.19
    // calibration above deliberately walked away from as self-destructive,
    // which is a worse tier bought with a worse mechanism. The plan's own
    // condition for making the change ("若相关性强" — if the candidate count
    // really tracks the phase) is not met, so it is not made.
    beginner: { skill: 0, depth: 2, multipv: 10, worstBias: 0.15, minMs: 350 },
    casual: { skill: 0, depth: 2, multipv: 8, worstBias: 0.12, minMs: 350 },
    learner: { skill: 1, depth: 2, multipv: 10, winT: 37, minMs: 350 },
    improver: { skill: 2, depth: 2, multipv: 10, winT: 24, minMs: 350 },
    steady: { skill: 3, depth: 3, multipv: 8, winT: 19, minMs: 350 },
    solid: { skill: 4, depth: 4, multipv: 8, winT: 14, minMs: 350 },
    easy: { elo: 1320, movetime: 500 },
    easyplus: { elo: 1450, movetime: 570 },
    normalminus: { elo: 1575, movetime: 630 },
    normal: { elo: 1700, movetime: 700 },
    hard: { elo: 2200, movetime: 900 },
    extreme: { elo: null, movetime: 1200 },
  };

  let worker = null;
  let wasmBytes = null; // decoded once, handed to every worker this session builds
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
      "    // 7.4: a wasm that will not compile rejects this promise, and",
      "    // nothing used to listen: the page waited out its 30 s boot timeout",
      "    // with nothing to say. The reason is now sent back as a line.",
      "    var fail = function (e) { postMessage('__sf_fail__ ' + String(e && (e.message || e))); };",
      "    var p;",
      "    try { p = __F.length >= 1 ? __F(eng) : __F()(eng); } catch (e) { fail(e); return; }",
      "    p.then(function ready() {",
      "      if (eng._isReady && !eng._isReady()) { return setTimeout(ready, 10); }",
      "      __engine = eng;",
      "      postMessage('__sf_ready__');",
      "    }, fail);",
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

  /**
   * 6.0: a timeout is a symptom, not a verdict. Before 6.0 waitFor() only
   * rejected, and the worker it left behind kept whatever search had hung —
   * the next `isready` then queued behind it, timed out too, and the engine
   * was dead for the rest of the session with isReady() still saying true.
   * Now the first timeout tells the search to stop; a second timeout in a row
   * is taken as a wedged worker, which is terminated so the next init()
   * builds a fresh one.
   */
  let strikes = 0;
  let strikeKind = null; // what kind of wait the current run of strikes is about
  let booted = false; // uciok seen on the current worker
  const pending = new Set(); // every live waitFor: {timer, reject}
  /**
   * 6.1: the two strikes have to be about the same thing.
   *
   * Every search drains with an `isready` first, so a worker that answers
   * `isready` but never finishes a search used to alternate strike / reset
   * forever — the 6.0 rebuild above never fired, which is precisely the
   * pre-6.0 failure it was written to end. Strikes are now counted per kind
   * of wait ("search", "ready", "boot"), and only progress of that same kind
   * clears them: a readyok is no evidence that searching works.
   */
  function onTimeout(kind) {
    if (kind !== strikeKind) { strikeKind = kind; strikes = 0; }
    strikes++;
    if (strikes >= 2) { teardown(); return; }
    send("stop");
  }
  function onProgress(kind) {
    if (kind === strikeKind) { strikes = 0; strikeKind = null; }
  }
  function teardown(reason) {
    booted = false;
    if (worker) { try { worker.terminate(); } catch (_) { /* already gone */ } }
    worker = null;
    readyPromise = null;
    lineHandlers = [];
    strikes = 0;
    strikeKind = null;
    gen++;
    // 6.1: whoever was waiting on this worker is waiting on nothing now. Left
    // pending, a search's 24-hour wait held the exclusive() chain forever and
    // every later search queued behind a worker that no longer existed.
    const orphans = [...pending];
    pending.clear();
    for (const w of orphans) {
      clearTimeout(w.timer);
      w.reject(new Error(reason || "engine torn down"));
    }
  }

  function waitFor(pred, timeoutMs, kind) {
    return new Promise((resolve, reject) => {
      // 6.1: which worker this wait belongs to. A timer left over from a torn
      // down (or cancelled) search used to strike whatever worker was running
      // when it finally fired.
      const myGen = gen;
      const entry = { timer: 0, reject };
      const timer = setTimeout(() => {
        pending.delete(entry);
        lineHandlers = lineHandlers.filter((h) => h !== handler);
        if (myGen === gen) onTimeout(kind);
        reject(new Error("engine timeout"));
      }, timeoutMs || 20000);
      entry.timer = timer;
      pending.add(entry);
      function handler(line) {
        if (pred(line)) {
          clearTimeout(timer);
          pending.delete(entry);
          if (myGen === gen) onProgress(kind);
          lineHandlers = lineHandlers.filter((h) => h !== handler);
          resolve(line);
        }
      }
      lineHandlers.push(handler);
    });
  }

  /**
   * 6.0: the engine sources arrive when the engine is first wanted.
   *
   * index.html used to load engine-src.js — 9.7 MB of base64 in a string
   * literal — with a blocking <script> before the app itself, so the first
   * paint waited on parsing a payload the first paint does not use. The tag is
   * now injected here, on demand. zero:// cannot fetch() a packaged file but
   * it can load a classic script, which is the same road index.html takes.
   * The string is dropped from the window once decoded: the worker owns the
   * bytes from then on and nothing else needs 9.7 MB of text around.
   */
  let sourcesPromise = null;
  let loaderSrc = null; // kept for the same reason as wasmBytes: rebuilds
  function haveSources() {
    return !!(loaderSrc || global.CHESS_SF_LOADER) && !!(wasmBytes || global.CHESS_SF_WASM_B64);
  }
  function loadSources() {
    if (haveSources()) return Promise.resolve();
    // 6.1: only a *pending* injection is shared. A settled one used to be
    // returned forever, so an init() that found the globals gone — which is
    // exactly what a rebuild after teardown finds, since the base64 is
    // blanked below — got a resolved promise and no script.
    if (sourcesPromise) return sourcesPromise;
    sourcesPromise = new Promise((resolve, reject) => {
      const doc = global.document;
      if (!doc || !doc.head) { reject(new Error("engine sources missing")); return; }
      const el = doc.createElement("script");
      el.src = "js/engine-src.js";
      el.async = true;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error("engine sources failed to load"));
      doc.head.appendChild(el);
    });
    const mine = sourcesPromise;
    const forget = () => { if (sourcesPromise === mine) sourcesPromise = null; };
    mine.then(forget, forget);
    return mine;
  }

  // 7.4: a boot that failed stays failed until retry(). Every consumer —
  // bestMove, analyze, the live line — boots lazily through init(), and
  // before this each of them built a fresh worker on every call after a
  // failure, while only the callers that went through app.js's bootEngine()
  // ever told the user. Now the failure is sticky here, and it is reported
  // once through onBootFail() whichever caller hit it first.
  let bootError = null;
  const bootFailListeners = [];
  function onBootFail(fn) { bootFailListeners.push(fn); }
  /** Clear a failed boot so the next init() really tries again. */
  function retry() { bootError = null; }

  /** Boot the engine (idempotent). Resolves when UCI handshake completes. */
  function init() {
    if (bootError) return Promise.reject(bootError);
    if (readyPromise) return readyPromise;
    readyPromise = (async () => {
      await loadSources();
      const loaderText = global.CHESS_SF_LOADER || loaderSrc;
      if (!loaderText) throw new Error("engine sources missing");
      loaderSrc = loaderText;
      // the base64 is needed once; after that the decoded bytes are the source
      // of truth, and a rebuilt worker is built from them alone.
      if (!wasmBytes) {
        const wasmB64 = global.CHESS_SF_WASM_B64;
        if (!wasmB64) throw new Error("engine sources missing");
        wasmBytes = b64ToBuffer(wasmB64);
        global.CHESS_SF_WASM_B64 = "";
      }
      const blobUrl = URL.createObjectURL(new Blob([workerSource(loaderText)], { type: "text/javascript" }));
      worker = new Worker(blobUrl);
      worker.onmessage = (ev) => onLine(ev.data);
      // a worker that throws inside the wasm never sends __sf_ready__; without
      // this the init promise waited out its 30 s and the worker lingered
      // 7.4: …and the rejection carries what the worker said, because the
      // page shows it as the diagnostic text of the "engine did not start"
      // notice
      worker.onerror = (ev) => teardown("engine worker error: " + ((ev && ev.message) || "unknown"));
      const readyWait = waitFor((l) => l === "__sf_ready__" ||
        (typeof l === "string" && l.startsWith("__sf_fail__")), 30000, "boot");
      // the buffer is transferred, not copied: the worker is its only reader.
      // A rebuilt worker (teardown after a hang) needs the bytes again, so a
      // copy is handed over and the decoded original stays here.
      const payload = wasmBytes.slice(0);
      worker.postMessage({ type: "init", wasm: payload }, [payload]);
      const said = await readyWait;
      if (said !== "__sf_ready__") throw new Error("engine boot failed: " + said.slice(12).trim());
      const uciWait = waitFor((l) => l === "uciok", 10000, "boot");
      send("uci");
      await uciWait;
      booted = true;
      return true;
    })();
    // a failed boot leaves no worker behind: isReady() used to keep answering
    // true after init() rejected, because only the promise was cleared
    const mine = readyPromise;
    mine.catch((err) => {
      teardown();
      // a teardown for a hang clears readyPromise without failing it; only
      // a boot that itself rejected is sticky
      bootError = err instanceof Error ? err : new Error(String(err));
      for (const fn of bootFailListeners) { try { fn(bootError); } catch (_) { /* a listener must not break the engine */ } }
    });
    return mine;
  }

  function isReady() {
    return !!worker && booted;
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
    // persona.js arrives with the opponents chunk (opponents-lazy.js), as `style`
    const P = persona && persona.style;
    const styled = persona && persona.id && persona.id !== "off" && P;
    let base = TIERS[diff] || TIERS.normal;
    // (a win-chance rung keeps its own list: its size is part of its strength)
    if (styled && !base.winT) base = Object.assign({}, base, { multipv: Math.max(base.multipv || 0, 14) });
    // Clock pressure only shortens time-based tiers; depth-based ones are
    // already near-instant and have nothing to trim.
    // v8-0-plan B4: `maxMs` may be a plan {search, pace} from opponents.js —
    // search time capped at the rung's calibrated movetime, pace the wall
    // time the reply takes. A bare number is the old cap.
    const plan = maxMs && typeof maxMs === "object" ? maxMs : null;
    const cap = plan ? plan.search : maxMs;
    const pace = plan && Number.isFinite(plan.pace) ? plan.pace : null;
    const tier = cap && base.movetime && !base.depth
      ? Object.assign({}, base, { movetime: Math.max(120, Math.min(base.movetime, Math.floor(cap))) })
      : base;
    const startedAt = Date.now();
    const myGen = ++gen;
    // drain any stray bestmove from a cancelled search: the engine processes
    // commands in order, so its readyok arrives after that bestmove.
    const drain = waitFor((l) => l === "readyok", 5000, "ready");
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
    // v8-0-plan B4: what the engine thinks of its own position, for the
    // resign and draw-offer rules (opponents.js): the first line's score, on
    // every tier — a MultiPV tier's best candidate is its first line.
    let ownScore = null;
    const collect = (line) => {
      if (typeof line !== "string" || !/^info\b/.test(line)) return;
      const mv = line.match(/\bmultipv (\d+)\b/);
      const sc = infoScore(line);
      if (sc != null && (!mv || mv[1] === "1") && !/\b(lower|upper)bound\b/.test(line)) ownScore = sc;
      if (!tier.multipv) return;
      const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
      if (!mv || !pv) return;
      cands.set(Number(mv[1]), { uci: pv[1], score: sc });
    };
    lineHandlers.push(collect);
    const budget = (tier.movetime || 2000) + 15000;
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), budget, "search");
    send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
    let line;
    try { line = await wait; }
    finally { lineHandlers = lineHandlers.filter((h) => h !== collect); }
    if (myGen !== gen) return null; // game moved on (undo/new/import)
    let picked = parseUci(line.split(/\s+/)[1]);
    if (tier.multipv && cands.size > 1 && tier.winT) {
      // the win-chance rungs weigh a style into the same draw instead of
      // letting it overrule the draw: the strength stays the rung's
      const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      const lean = styled ? P.lean(fen, list, persona.id, persona.Chess) : null;
      picked = parseUci(pickCandidate(list, tier, Math.random, lean)) || picked;
    } else if (tier.multipv && cands.size > 1) {
      const list = [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
      // strength first, then style: the tier decides how good the move is
      // allowed to be, the personality decides which of the moves that good
      // it actually likes
      if (tier.worstBias) picked = pickHandicapped(cands, tier) || picked;
      if (styled) {
        // v8-0-plan B4: no better than the rung's own choice (persona.js)
        const own = picked && list.find((c) => c.uci === picked.from + picked.to + (picked.promotion || ""));
        const styledUci = own ? P.pick(fen, list, persona.id, persona.Chess, own.score) : null;
        if (styledUci) picked = parseUci(styledUci);
      } else if (!tier.worstBias) {
        picked = pickHandicapped(cands, tier) || picked;
      }
    }
    // depth-limited searches return almost instantly — hold the move briefly so
    // the opponent still reads as "thinking" instead of snapping back.
    // v8-0-plan B4: a clocked game paces the reply to the clock instead
    // (opponents.js thinkPlan) — longer in a long game, never past the cap.
    const hold = pace != null ? pace : tier.minMs;
    if (picked && hold) {
      const left = hold - (Date.now() - startedAt);
      if (left > 0) await new Promise((r) => setTimeout(r, left));
      if (myGen !== gen) return null;
    }
    if (picked) picked.score = ownScore;
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
    const uci = pickCandidate(list, tier, Math.random);
    return uci ? parseUci(uci) : null;
  }

  /**
   * Which candidate a handicap tier plays — the whole rule, in one place.
   *
   * This existed three times: here, in scripts/test-strength.mjs and in
   * scripts/test-novice.mjs, which is to say the two scripts that *measure*
   * the tier each carried their own copy of the thing being measured. Now they
   * call this, and `rng` is a parameter because the scripts need a seeded
   * generator (a measurement has to be a fact about the code, not about the
   * day) while the app wants Math.random.
   *
   * **Uniform on purpose, now that it has been measured.** The eight-in-ten
   * case picks uniformly among the candidates, so how much it costs depends on
   * how far apart they are — 115cp between best and worst in the opening, 479
   * in the endgame (docs/measured.json `multipvPhase`). Weighting the pick by
   * that gap is the obvious repair and it was tried: see the note above the
   * `beginner` row for the two runs that say it takes the tier from a 56%
   * opponent to a 33% one. The spread is what makes this tier weak, not an
   * accident in how it is weak.
   *
   * @param {Array<{uci:string, score:number|null}>} list candidates, best first
   * @param {object} tier   the tier row (worstBias)
   * @param {Function} rng  () => [0,1)
   * @returns {string|null} the chosen UCI move
   */
  function pickCandidate(list, tier, rng, lean) {
    if (!list || !list.length) return null;
    const scored = list.filter((c) => c.score != null);
    // never throw away a forced mate the tier already found — losing on
    // purpose from a winning position reads as a broken engine, not a weak one
    if (scored.length && scored[0].score >= 100000 - 50) return list[0].uci;
    if (tier.winT && scored.length) return pickByWinLoss(list, tier.winT, rng, lean);
    if (tier.worstBias && rng() < tier.worstBias && scored.length) {
      const worst = scored.reduce((a, b) => (b.score < a.score ? b : a));
      return worst.uci;
    }
    return list[Math.floor(rng() * list.length)].uci;
  }

  /**
   * Lichess's win chance for a centipawn score, 0–100 (the curve the
   * review's accuracy uses too). Mate scores sit at the two ends.
   */
  function winPct(cp) {
    const c = Math.max(-10000, Math.min(10000, cp));
    return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * c)) - 1);
  }

  /**
   * v8-0-plan B4: the win-chance rungs' draw. Each candidate weighs
   * e^(−loss / winT), the loss being the win percentage it gives away against
   * the best line. Win percentage and not centipawns because a pawn matters
   * far more at 0.0 than at +6: the same 100cp slip is a real mistake in a
   * level game and noise in a won one, so a sampler in centipawns throws its
   * won games away and plays its level ones like a club player.
   *
   * `lean` (persona.js) is a style, and it chooses only *among moves as good
   * as the one drawn*: the draw fixes how much win chance this move gives
   * away, and the style then takes, of the candidates within a fifth of
   * `winT` of that loss, the one it likes best. Weighting the draw by the
   * style instead was tried and measured: at these depths the capture a
   * greedy style reaches for is usually the good move, and the round-robin
   * put the greedy rung 260–750 Elo above its own plain self.
   */
  function pickByWinLoss(list, winT, rng, lean) {
    const top = winPct(Math.max(...list.filter((c) => c.score != null).map((c) => c.score)));
    const loss = list.map((c) => (c.score == null ? null : top - winPct(c.score)));
    const w = loss.map((l) => (l == null ? 0 : Math.exp(-l / winT)));
    const sum = w.reduce((a, b) => a + b, 0);
    if (!(sum > 0)) return list[0].uci;
    let x = rng() * sum;
    let k = list.length - 1;
    for (let i = 0; i < list.length; i++) { x -= w[i]; if (x < 0) { k = i; break; } }
    const drawn = k;
    if (lean && lean[drawn] != null) {
      const band = Math.max(1, winT / 5);
      for (let i = 0; i < list.length; i++) {
        if (lean[i] != null && loss[i] != null && Math.abs(loss[i] - loss[drawn]) <= band && lean[i] > lean[k]) k = i;
      }
    }
    return list[k].uci;
  }

  /**
   * 6.0: the knobs a player may turn. Hash is the one that matters on a
   * single-threaded lite build; Threads stays at 1 because this wasm has no
   * SharedArrayBuffer to run more on. Applied before every full-strength
   * search, like every other sticky option.
   */
  const options = { hash: 32 };
  function setOptions(o) {
    if (o && Number.isFinite(o.hash)) {
      const hash = Math.max(1, Math.min(512, Math.round(o.hash)));
      // 6.1: Hash changes what the search finds, so everything already in the
      // eval cache was computed by a different engine. Served on, it would
      // hide the very change the player just asked for.
      if (hash !== options.hash) { options.hash = hash; evalCache.clear(); }
    }
    return { ...options };
  }
  function getOptions() { return { ...options }; }

  /**
   * v8-0-plan B2: an analysis search is a fixed number of nodes, not a fixed
   * time. `go movetime` stops wherever the clock runs out, and where that is
   * depends on the machine, the page's other work, the GC — the same game
   * analysed twice told two stories (docs/measured.json `winPctNoise`, 7.9 at
   * 200 ms: `??` agreed 82%, `?` 64%, `?!` 45%). Stockfish is single-threaded
   * here, so a node-limited search from a clean state is a pure function of
   * the position and the options.
   *
   * "Clean state" is the other half: `ucinewgame` before every analysis
   * search clears the history tables as well as the hash. Without it a search
   * depends on whatever was searched before it — the coach, a hint, the
   * previous ply — and two passes over one game walk the engine through
   * different states (scripts/test-mined.mjs learned this first).
   *
   * Callers still speak in ms-equivalent budgets (120 / 200 / 400): stored
   * analyses, drills and the library compare budgets to decide which pass was
   * deeper, and that ordering keeps its meaning. A budget is converted here,
   * at the rate this build searches: in node over 110 corpus positions,
   * `go movetime 200` reached a median 96k nodes (depth 15), and 90k nodes
   * from a cleared state took a median 185 ms plus ~15 ms for the clear — so
   * 分析 costs what it did (docs/measured.json `reviewPass` has the wall time
   * of the whole pipeline).
   */
  const NODES_PER_MS = 450;
  /** The node count one analysis `budget` (ms-equivalent) searches. */
  function nodesFor(budget) {
    return Math.max(1000, Math.round((budget || 120) * NODES_PER_MS));
  }

  /**
   * 6.0: evaluations already paid for.
   *
   * The coach, the hint and the review each searched the same position again
   * from nothing (v6-plan §1.2). A result is keyed by the position — FEN
   * without the fullmove number, which does not change what the engine sees
   * (the halfmove clock stays: it feeds the fifty-move rule, so the same
   * board at clock 0 and at clock 99 are different positions). Bounded and
   * LRU: a long session must not keep every position it ever looked at.
   *
   * v8-0-plan B2: served only to a request for exactly the budget that
   * produced it. Through 7.9 a deeper result also answered a shallower
   * request — harmless for a hint, fatal for reproducibility: a position the
   * review had deepened came back from the cache on the next pass as its
   * quick scan, so the second pass started from different numbers.
   */
  const EVAL_CACHE_MAX = 512;
  const evalCache = new Map();
  function cacheKey(fen, budget, multipv) {
    const f = fen.split(" ");
    return f.slice(0, 5).join(" ") + "|" + (multipv || 1) + "|" + nodesFor(budget);
  }
  function cachedEval(fen, budget, multipv) {
    const k = cacheKey(fen, budget, multipv);
    const hit = evalCache.get(k);
    if (!hit) return null;
    evalCache.delete(k); evalCache.set(k, hit); // refresh recency
    return hit;
  }
  function rememberEval(fen, budget, multipv, result) {
    if (!result) return;
    const k = cacheKey(fen, budget, multipv);
    evalCache.delete(k);
    evalCache.set(k, result);
    while (evalCache.size > EVAL_CACHE_MAX) evalCache.delete(evalCache.keys().next().value);
  }

  /**
   * Full-strength eval of `fen` for review analysis.
   * @param {number} budget ms-equivalent, searched as nodesFor(budget) nodes
   * @param {object} [opts] `{multipv}` asks for that many lines (1–5); the
   *   result then also carries `lines: [{pv, cp, mate}]`, best first
   * @returns {Promise<{cp,mate,turn,best,pv,lines,nodes}|null>} score in
   *   side-to-move terms (`turn` = that side); null when stale/failed.
   */
  function analyze(fen, budget, opts) {
    const multipv = opts && opts.multipv ? Math.max(1, Math.min(5, opts.multipv | 0)) : 1;
    const hit = cachedEval(fen, budget, multipv);
    if (hit) return Promise.resolve(hit);
    return exclusive(() => analyzeInner(fen, budget, multipv)).then((r) => {
      rememberEval(fen, budget, multipv, r);
      return r;
    });
  }

  /** Parse one `info` line into what the review keeps of it. */
  function readInfo(line, into) {
    const mv = line.match(/\bmultipv (\d+)\b/);
    const idx = mv ? Number(mv[1]) : 1;
    const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
    const pm = line.match(/\bpv\s+(.+)$/);
    const dm = line.match(/\bdepth (\d+)\b/);
    if (!m && !pm) return;
    const slot = into.get(idx) || { cp: null, mate: null, pv: null, depth: 0 };
    if (m) { slot.cp = m[1] === "cp" ? Number(m[2]) : null; slot.mate = m[1] === "mate" ? Number(m[2]) : null; }
    if (pm) slot.pv = pm[1].trim().split(/\s+/);
    if (dm) slot.depth = Number(dm[1]);
    into.set(idx, slot);
  }

  function fullStrengthOptions(multipv) {
    // all sticky from a handicap game — analysis is always full strength
    send("setoption name MultiPV value " + (multipv || 1));
    send("setoption name Skill Level value 20");
    send("setoption name UCI_LimitStrength value false");
    send("setoption name Hash value " + options.hash);
  }

  function linesOf(slots) {
    return [...slots.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
  }

  async function analyzeInner(fen, budget, multipv) {
    await init();
    const myGen = ++gen;
    // a clean engine for every analysis search — see NODES_PER_MS
    send("ucinewgame");
    const drain = waitFor((l) => l === "readyok", 5000, "ready");
    send("isready");
    await drain;
    if (myGen !== gen) return null;
    const nodes = nodesFor(budget);
    fullStrengthOptions(multipv);
    send("position fen " + fen);
    const slots = new Map();
    const collect = (line) => { if (typeof line === "string") readInfo(line, slots); };
    lineHandlers.push(collect);
    // the timeout still reads as time: a slow machine needs longer per node,
    // and a search is "hung" only well past what any machine would need
    const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), nodes / 50 + 15000, "search");
    send("go nodes " + nodes);
    let line;
    try { line = await wait; }
    finally { lineHandlers = lineHandlers.filter((h) => h !== collect); }
    if (myGen !== gen) return null;
    const uci = line.split(/\s+/)[1];
    const lines = linesOf(slots);
    const top = lines[0] || { cp: null, mate: null, pv: null };
    return {
      cp: top.cp,
      mate: top.mate,
      turn: fen.split(" ")[1] === "b" ? "b" : "w",
      best: uci && uci !== "(none)" ? uci : null,
      pv: top.pv || null,
      lines,
      nodes,
    };
  }

  /**
   * 6.0: continuous analysis — `go infinite` on one position, reporting every
   * improvement until told to stop.
   *
   * Holds the exclusive lock for as long as it runs, so a game move queued
   * behind it waits; the caller is expected to stop it before the game
   * resumes. Returns the stop function; `onUpdate` receives
   * `{depth, lines: [{pv, cp, mate, depth}], turn}` on each new info line.
   */
  function analyzeInfinite(fen, opts, onUpdate) {
    const multipv = opts && opts.multipv ? Math.max(1, Math.min(5, opts.multipv | 0)) : 1;
    let stopped = false;
    let started = false; // our own `go infinite` is on the worker
    let release = null;
    const done = new Promise((r) => { release = r; });
    exclusive(async () => {
      if (stopped) return;
      await init();
      const myGen = ++gen;
      const drain = waitFor((l) => l === "readyok", 5000, "ready");
      send("isready");
      await drain;
      if (myGen !== gen || stopped) return;
      fullStrengthOptions(multipv);
      send("position fen " + fen);
      const slots = new Map();
      const turn = fen.split(" ")[1] === "b" ? "b" : "w";
      const collect = (line) => {
        if (typeof line !== "string" || !/^info\b/.test(line)) return;
        readInfo(line, slots);
        const lines = linesOf(slots);
        if (lines.length && onUpdate) onUpdate({ depth: lines[0].depth, lines, turn });
      };
      lineHandlers.push(collect);
      const wait = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), 24 * 3600 * 1000, "search");
      started = true;
      send("go infinite");
      try { await wait; } catch (_) { /* stopped or torn down */ }
      finally { lineHandlers = lineHandlers.filter((h) => h !== collect); }
    }).then(release, release);
    return function stop() {
      if (stopped) return done;
      stopped = true;
      // 6.1: only if this call's own search is the one running. While the body
      // is still queued behind another search, a `stop` here reached Stockfish
      // in the middle of *that* search — which then returned a truncated
      // result that analyze() cached as a full-budget one.
      if (started && worker) send("stop");
      return done;
    };
  }

  export const ChessEngine = { init, retry, onBootFail, isReady, bestMove, analyze, analyzeInfinite, newGame, cancel, setOptions, getOptions, TIERS, pickCandidate, winPct, nodesFor, NODES_PER_MS };
