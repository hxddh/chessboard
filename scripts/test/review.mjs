/**
 * Draw arithmetic, the review curve and badges, the eval bar and its
 * thresholds, and the store and sync() behind the board.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, ctx, Chess, loadModule, WEB_JS, allAppSource, srcOf, appModuleEntries } from "./harness.mjs";

export async function run() {
  // FIDE draw arithmetic: repetition counting and the 6.9 material test decide
  // real game results, so they get their own checks
  {
    loadModule(ctx, "src/web/js/fide.js");
    const F = ctx.ChessFide;
    assert(F.halfmoveClock("8/8/8/8/8/8/8/K6k w - - 37 90") === 37, "halfmove clock parsed");
    // shuffling knights back and forth repeats the start position
    const shuffle = ["Nf3", "Nf6", "Ng1", "Ng8"];
    assert(F.repetitionCount(null, [], Chess) === 1, "start position seen once");
    assert(F.repetitionCount(null, shuffle, Chess) === 2, "one cycle repeats the start twice");
    assert(F.repetitionCount(null, [...shuffle, ...shuffle], Chess) === 3, "two cycles reach threefold");
    assert(F.repetitionCount(null, [...shuffle, ...shuffle, ...shuffle, ...shuffle], Chess) === 5,
      "four cycles reach fivefold");
    // a repetition must match castling rights too: moving a rook out and back
    // changes the rights, so the position is NOT the same as before
    const rookOut = ["Nf3", "Nf6", "Rg1", "Rg8", "Rh1", "Rh8"];
    assert(F.repetitionCount(null, rookOut, Chess) === 1,
      "losing castling rights breaks the repetition");

    // FIDE 9.2 compares the *available moves*, not the raw FEN. A double pawn
    // push writes an ep target even when nobody can take there, so the same
    // shuffle behind 1.e4 e5 must still reach threefold.
    const pawnsFirst = ["e4", "e5", ...shuffle, ...shuffle];
    assert(F.repetitionCount(null, pawnsFirst, Chess) === 3,
      "a phantom ep square does not break the repetition");
    assert(F.positionKey(new Chess("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1").fen(),
      null, Chess).endsWith(" -"), "unusable ep right is normalised away");
    // ...but a real one is a genuine difference and must be kept
    const epLive = new Chess("4k3/8/8/8/3p4/8/2P5/4K3 w - - 0 1");
    epLive.move("c4");
    assert(F.positionKey(epLive.fen(), epLive).endsWith(" c3"), "playable ep right is preserved");
    // pinned capturer: the ep move is not legal, so the right does not exist
    const epPinned = new Chess("8/8/8/K2pP2q/8/8/8/7k w - d6 0 1");
    assert(F.positionKey(epPinned.fen(), epPinned).endsWith(" -"),
      "ep right that would expose the king is normalised away");
    // 14.0 A3: the board is read first (no pawn beside the pushed one: no
    // move generation); the key must be the move generation's, everywhere.
    // Random games with every double step, both colours, edge files, pins
    {
      const full = (g) => { const h = g.fen().split(" ").slice(0, 4); if (h[3] !== "-" && !g.moves({ verbose: true }).some((m) => m.flags.includes("e"))) h[3] = "-"; return h.join(" "); };
      let seed = 7, checked = 0, withEp = 0, bad = null;
      const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
      for (let game = 0; game < 120 && !bad; game++) {
        const g = new Chess();
        for (let ply = 0; ply < 60 && !g.game_over(); ply++) {
          const ms = g.moves({ verbose: true });
          const pawnPushes = ms.filter((m) => m.flags.includes("b") || m.flags.includes("e"));
          const m = pawnPushes.length && rnd() < 0.5 ? pawnPushes[Math.floor(rnd() * pawnPushes.length)] : ms[Math.floor(rnd() * ms.length)];
          g.move(m);
          checked++;
          if (g.fen().split(" ")[3] !== "-") withEp++;
          if (F.positionKey(g.fen(), g) !== full(g) || F.positionKey(g.fen(), null, Chess) !== full(g)) { bad = g.fen(); break; }
        }
      }
      assert(!bad && withEp > 200, "14.0 A3: the ep check from the board gives the move generation's key (" + checked + " positions, " + withEp + " with an ep square)", bad);
    }

    const boardOf = (fen) => new Chess(fen).board();
    const mat = (fen, color) => F.hasMatingMaterial(boardOf(fen), color);
    assert(mat("8/8/8/8/8/8/4P3/K6k w - - 0 1", "w"), "K+P can mate");
    assert(mat("8/8/8/8/8/8/8/KR5k w - - 0 1", "w"), "K+R can mate");
    assert(!mat("8/8/8/8/8/8/8/K6k w - - 0 1", "w"), "bare king cannot mate");
    assert(!mat("8/8/8/8/8/8/8/KB5k w - - 0 1", "w"), "K+B alone cannot mate");
    assert(!mat("8/8/8/8/8/8/8/KN5k w - - 0 1", "w"), "K+N vs bare K cannot mate");
    assert(mat("8/8/8/8/8/8/7p/KN5k w - - 0 1", "w"), "K+N can mate when the opponent has a blocker");
    assert(mat("8/8/8/8/8/8/8/KNN4k w - - 0 1", "w"), "two knights can mate (helpmate exists)");
    // c1 and f1 are opposite colours → real mating material
    assert(mat("7k/8/8/8/8/8/8/K1B2B2 w - - 0 1", "w"), "opposite-coloured bishops can mate");
    // c1 and a3 are both dark; a bare king can never be mated by them
    assert(!mat("7k/8/8/8/8/B7/8/K1B5 w - - 0 1", "w"), "same-coloured bishops vs bare king cannot mate");
    assert(mat("7k/7p/8/8/8/B7/8/K1B5 w - - 0 1", "w"), "same-coloured bishops can mate if the opponent has other material");

    // positionFinished: the whole point is that it is NOT chess.js game_over().
    // The analyser used game_over() per position and scored every claimable draw
    // a flat 0, which flattened the eval curve mid-game and mis-tagged every
    // move after it — while the live game, correctly, played straight on.
    const fin = (fen, reps) => F.positionFinished(new Chess(fen), reps);
    const rookEnd = "8/8/8/4k3/8/8/R7/4K3 w - - {h} 80";
    const at = (h) => rookEnd.replace("{h}", String(h));
    assert(new Chess(at(100)).game_over(), "chess.js does end the game at the 50-move mark");
    assert(!fin(at(100), 1), "50 moves is claimable, not finished");
    assert(!fin(at(149), 1), "149 halfmoves is still claimable");
    assert(fin(at(150), 1), "75 moves ends the game by law");
    assert(!fin(at(0), 3), "threefold is claimable, not finished");
    assert(!fin(at(0), 4), "fourfold is still claimable");
    assert(fin(at(0), 5), "fivefold ends the game by law");
    assert(fin("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1", 1), "checkmate is finished");
    assert(fin("7k/5Q2/5K2/8/8/8/8/8 b - - 0 1", 1), "stalemate is finished");
    assert(fin("7k/8/6K1/8/8/8/8/8 w - - 0 1", 1), "insufficient material is finished");
    // a mating move on the 75-move boundary is mate, not a draw
    assert(fin("7k/5Q2/6K1/8/8/8/8/8 b - - 150 90", 1), "mate outranks the 75-move rule");
    // and it agrees with the app's own live rule everywhere it is defined:
    // naturalGameOver() = checkmate | stalemate | insufficient | autoDrawReason()
    for (const [fen, reps] of [[at(0), 1], [at(100), 1], [at(150), 1], [at(0), 3], [at(0), 5]]) {
      const g = new Chess(fen);
      const live = g.in_checkmate() || g.in_stalemate() || g.insufficient_material() ||
        reps >= 5 || F.halfmoveClock(g.fen()) >= 150;
      assert(F.positionFinished(g, reps) === live,
        "positionFinished matches the live rule at " + fen + " x" + reps);
    }
  }

  // The review curve's move axis (A4): where each move begins, and the first
  // ply of a game that starts with Black to move (Codex #89: "30…" is move 30)
  {
    loadModule(ctx, "src/web/js/review/eval-graph.js");
    const ticks = ctx.axisTicks;
    const w = ticks(6, "w", (i) => 1 + Math.floor(i / 2), 1).map((x) => x.no);
    const b = ticks(6, "b", (i) => 30 + Math.floor((i + 1) / 2), 1);
    assert(JSON.stringify(w) === "[1,2,3]", "A4: a game from the start labels moves 1, 2, 3 (" + w + ")");
    assert(b[0] && b[0].i === 0 && b[0].no === 30 && JSON.stringify(b.map((x) => x.no)) === "[30,31,32,33]",
      "A4: a game starting 30… labels move 30 on its first ply, then 31 on White's (" + JSON.stringify(b) + ")");
    assert(ctx.tickEvery(50, 52) === 1 && ctx.tickEvery(1, 3) === 1 && ctx.tickEvery(1, 60) === 10,
      "A4: the label interval follows the moves plotted — a three-move study from move 50 labels every move (" + ctx.tickEvery(50, 52) + ")");
    const b10 = ticks(6, "b", (i) => 31 + Math.floor((i + 1) / 2), 10);
    assert(b10.length && b10[0].i === 0 && b10[0].no === 31, "A4: …and the first ply is labelled even off the interval (31… at every 10: " + JSON.stringify(b10) + ")");
  }

  // A5: the result badges of a variation that the rules end are that
  // variation's result, not the mainline's resignation (Codex #89)
  {
    loadModule(ctx, "src/web/js/game-end.js");
    const staleGame = new Chess("7k/5Q2/6K1/8/8/8/8/8 b - - 0 1"); // Black to move, stalemated
    const kingAt = (g, side) => { for (const row of g.board()) for (const x of row) if (x && x.type === "k" && x.color === side) return x.square; return null; };
    const ge = (onMain) => ctx.createGameEnd({
      store: { session: { mode: "pvp" }, game: { resigned: "b" } }, t: (k) => k, tf: (k) => k, sideName: (s) => s, game: staleGame,
      el: () => null, setText() {}, avail() {}, toast() {}, sanHistory: () => ["x"], analysisFor: () => null,
      appGameOver: () => true, resultFromFile: () => false, gameResultToken: () => "1-0", timeoutIsDraw: () => false,
      autoDrawReason: () => null, isLive: () => true, kingSquare: kingAt, onMainline: () => onMain, onEnding() {},
    });
    const off = ge(false).resultBadges();
    assert(off && off.length === 2 && off.every((b) => b.kind === "draw"),
      "A5: a stalemated variation of a resigned game carries ½ on both kings (" + JSON.stringify(off) + ")");
    // …and a variation that is not over has no ending at all: no card, no badges
    const openGame = new Chess("7k/8/6K1/8/8/8/5Q2/8 b - - 0 1");
    const geOpen = ctx.createGameEnd({
      store: { session: { mode: "pvp" }, game: { resigned: "b" } }, t: (k) => k, tf: (k) => k, sideName: (s) => s, game: openGame,
      el: () => null, setText() {}, avail() {}, toast() {}, sanHistory: () => ["x"], analysisFor: () => null,
      appGameOver: () => true, resultFromFile: () => false, gameResultToken: () => "1-0", timeoutIsDraw: () => false,
      autoDrawReason: () => null, isLive: () => true, kingSquare: kingAt, onMainline: () => false, onEnding() {},
    });
    assert(geOpen.gameEnding() === null && geOpen.resultBadges() === null,
      "A5: an unfinished variation of a resigned game has no ending — the result card and the badges stay away");
    assert(ge(false).gameEnding().token === "1/2-1/2", "A5: …a stalemated one ends in a draw, whatever the mainline did");
    const main = ge(true).resultBadges();
    assert(main && main.find((b) => b.sq === "g6").kind === "win", "A5: …the mainline keeps the game's own result (" + JSON.stringify(main) + ")");
  }

  // The eval bar and the one set of mistake thresholds behind it.
  {
    loadModule(ctx, "src/web/js/review.js");
    const R = ctx.ChessReview;
    // "nobody asked the engine" must not render as "the engine says level" —
    // a bar that draws both at 50% is the most confident lie a review can tell
    assert(R.evalBar(null) === null, "an unmeasured position has no bar position");
    assert(R.evalBar(undefined) === null, "…and neither does a missing one");
    assert(R.evalBar(0) === 0.5, "level is the middle");
    assert(R.evalBar(600) === 1 && R.evalBar(-600) === 0, "±6 pawns fills the bar");
    assert(R.evalBar(10000) === 1 && R.evalBar(-10000) === 0, "a mate score clamps, it does not overflow");
    assert(R.evalBar(300) === 0.75 && R.evalBar(-300) === 0.25, "the scale is linear in between");
    assert(R.evalBar(NaN) === null, "a NaN is unmeasured, not a full bar");

    // one source for the thresholds: the move list, the curve markers and the
    // best-move arrow all read this. It used to be four hand-written copies.
    assert(R.markFor(0) === null && R.markFor(49) === null, "a cheap move earns no tag");
    assert(R.markFor(R.INACCURACY) === "?!", "the inaccuracy threshold is inclusive");
    assert(R.markFor(R.MISTAKE) === "?", "the mistake threshold is inclusive");
    assert(R.markFor(R.BLUNDER) === "??", "the blunder threshold is inclusive");
    assert(R.markFor(R.MISTAKE - 1) === "?!" && R.markFor(R.BLUNDER - 1) === "?", "each band stops where the next begins");
    assert(!R.isMistake(null) && R.isMistake("?!") && R.isMistake("?") && R.isMistake("??"),
      "isMistake covers exactly the tagged moves");

    const appSrc = allAppSource;
    // v8-0-plan F4: one function's text from whichever module declares it
    const fnOf = srcOf;
    // analysisFor() sits in the render path. `analysis.sig` is a PGN, and
    // game.pgn() costs ~3.3ms on an 80-move game — a fifth of a 60fps frame.
    // 1.22 put the best-move arrow in the board model, which is rebuilt on every
    // draw() including every animation frame, so a 12-frame replay slide spent
    // ~40ms serialising the same PGN twelve times. The memo has to be exact, not
    // just fast: dropped on every sync(), and keyed on the analysis object so
    // that replacing it invalidates without seven assignment sites remembering.
    const af = fnOf("analysisFor");
    assert(/store\.session\._analysisTick/.test(af), "analysisFor is memoised");
    assert(/_analysisTick\.a === store\.session\.analysis/.test(af), "…and the memo notices a new analysis object");
    // --- the state lives in the store, not in a `let` beside its reader ------
    // 56 module-level `let`s down 5 300 lines meant "what is the state of this
    // app" could only be answered by reading the whole file, and — worse —
    // nothing could observe a change: every write was followed by a hand-written
    // sync() call, and sync() had to rebuild everything precisely because the
    // one thing it never knew was what had changed. P1.1 moved them into three
    // slices; this keeps them there.
    {
      // `_recSeq` is not state: it is a monotonic counter that only ever feeds
      // newRecordId(), never read, never rendered, never persisted. Putting it
      // in a slice would say it is something the app is *about*.
      const strays = appModuleEntries().flatMap(([, text]) => [...text.matchAll(/^  let ([A-Za-z_$][\w$]*)/gm)])
        .map((m) => m[1]).filter((n) => n !== "_recSeq");
      for (const n of strays) console.error("  module-level let: " + n);
      assert(strays.length === 0,
        "no state is declared beside its reader" +
        (strays.length ? " — " + strays.length + " module-level let(s)" : " (all in the store)"));
      const stateFile = path.join(WEB_JS, "app-state.js");
      assert(/const store = createStore\(initialState\(\)\);/.test(appSrc) && fs.existsSync(stateFile) &&
        /export function initialState\(\) \{\s*return \{\s*game: \{/.test(fs.readFileSync(stateFile, "utf8")), "…and the store is where it went (app-state.js's initialState)");
      for (const slice of ["game", "session", "ui"]) {
        assert(new RegExp("\\n    " + slice + ": \\{").test(appSrc), "the " + slice + " slice exists");
      }
    }

    // --- sync() is three commits, not a function that knows how to draw -------
    // It was 80 lines inline plus nine sub-syncs, called from 65 places, and
    // every one of those places got the full rebuild — because the one thing it
    // never knew was what had changed. The views are split by what they are
    // about and subscribe to the slice they read; sync() now only says "some
    // things moved".
    {
      const body = fnOf("sync");
      const calls = [...body.matchAll(/\b(\w+)\(/g)].map((m) => m[1]).filter((n) => n !== "sync");
      // 6.0: one commitAll() instead of three commits — a view that hears about
      // every slice is told once (draw() ran three times per sync() before)
      const notCommit = calls.filter((n) => n !== "commit" && n !== "commitAll");
      for (const n of notCommit) console.error("  sync() still calls " + n + "()");
      assert(notCommit.length === 0,
        "sync() does nothing but commit" + (notCommit.length ? " — also calls " + [...new Set(notCommit)].join(", ") : ""));
      assert(/store\.commitAll\(\["game", "session", "ui"\]/.test(body), "sync() commits game, session and ui in one pass");
      assert(/function wireViews\(\)/.test(appSrc), "the view wiring is in one readable block");
      for (const view of ["renderStatusPill", "renderReplayBar", "renderGameActions"]) {
        assert(new RegExp("function " + view + "\\(").test(appSrc), view + "() exists");
        assert(new RegExp('store\\.subscribe\\("\\w+", ' + view + "\\)").test(appSrc), "…and is subscribed");
      }
      // the ids are in index.html, which is loaded once — a lookup can only ever
      // return the same node, and sync() was doing thirty-odd per pass on a path
      // that ran on every clock tick
      assert(/function el\(id\) \{[\s\S]{0,200}?_nodes\.set/.test(appSrc), "getElementById is memoised behind el()");
      for (const v of ["renderStatusPill", "renderReplayBar", "renderGameActions"]) {
        assert(!/document\.getElementById/.test(fnOf(v)), v + "() goes through el()");
      }
    }

    // The memo used to be dropped at the top of sync(), which was correct only
    // while "sync() runs after every state change" stayed true — an invariant
    // held by hand at 65 call sites. The game commit drops it now, from inside
    // the mutation rather than after somebody remembers to sync.
    assert(/store\.subscribe\("game",[\s\S]{0,500}?store\.session\._analysisTick = null/.test(appSrc),
      "…and the game commit drops it, so no frame can outlive a state change");

    // Every mutation of `game` goes through one of the five doors, because those
    // doors are what announce the change. A raw game.move() somewhere else
    // leaves viewGame()/sanHistory() describing the position before it — a stale
    // board that repaints happily.
    //
    // The caches exist because rebuilding the board model replays the whole game
    // (chess.js has no move list to read), and the model is rebuilt on every
    // draw() — every animation frame, every pointermove of a drag. Measured at
    // 120 plies: 19.3ms per repaint before, 0.23ms after, and flat with length
    // instead of linear.
    const RAW_MUTATION = /\bgame\.(move\(|undo\(\)|load\(|load_pgn\(|reset\(\))/g;
    const noComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    const doors = noComments(appSrc).match(RAW_MUTATION) || [];
    // the five doors themselves are the only place the raw calls may appear
    assert(doors.length === 5,
      "only the five gameXxx() doors touch game directly (" + doors.length + " raw call(s))");
    for (const door of ["function gameMove(", "function gameUndo(", "function gameLoad(",
      "function gameLoadPgn(", "function gameReset("]) {
      assert(appSrc.includes(door), "the door " + door + "…) exists");
    }
    // Each door announces itself, and the announcement is what expires the
    // caches. Until 1.25 they bumped a `gameVersion` counter and every cache
    // compared itself against it — a hand-rolled invalidation signal, which is
    // exactly what a commit already is.
    for (const door of ["gameMove", "gameUndo", "gameLoad", "gameLoadPgn", "gameReset"]) {
      assert(/store\.commit\("game", "/.test(fnOf(door)), door + "() commits the game slice");
    }
    assert(!/gameVersion/.test(noComments(appSrc)), "no hand-kept version counter is left");
    // v8-0-plan F2: the doors expire them, not the commit — a replay step
    // commits too, and must not cost a walk of the whole game
    assert(/function forgetHistory\(\) \{\s*store\.game\._vh = null;\s*store\.game\._san = null;/.test(appSrc),
      "one function expires the history caches");
    for (const door of ["gameLoad", "gameLoadPgn", "gameReset"]) {
      assert(/forgetHistory\(\)/.test(fnOf(door)), door + "() starts the history over");
    }
    assert(/_vh\.concat\(r\)/.test(fnOf("gameMove")) && /_vh\.slice\(0, -1\)/.test(fnOf("gameUndo")),
      "gameMove() / gameUndo() edit the history by one entry");
    const gameSub = appSrc.slice(appSrc.indexOf('store.subscribe("game", () => {')).split("});")[0];
    assert(gameSub.length > 0 && !/_vh = null|forgetHistory/.test(gameSub),
      "…and the game commit no longer throws it away");
    const vh = fnOf("verboseHistory");
    assert(/if \(!store\.game\._vh\)/.test(vh), "the verbose history is cached");
    assert(/if \(!store\.game\._san\)/.test(fnOf("sanHistory")), "…and so is the SAN list");
    assert(/verboseHistory\(\)\.map/.test(fnOf("sanHistory")),
      "…derived from it rather than walking the game a second time");
    assert(/store\.game\._view && store\.game\._view\.i === store\.game\.viewIndex/.test(fnOf("viewGame")),
      "the replayed position is cached against the cursor, and dropped when the game moves");

    // checkmate must not render as an ordinary check
    const boardSrc = fs.readFileSync(path.join(root, "src/web/js/board.js"), "utf8");
    assert(/m\.mated/.test(boardSrc), "the board draws checkmate differently from check");
    // five models: the game, the puzzle, the lesson, 再试一次 (v7-8-plan §3)
    // and 名局猜着 (v8-2-plan T3, trainer/guess.js)
    assert((appSrc.match(/mated: g\.in_checkmate\(\)/g) || []).length === 5,
      "every board model says whether the check is mate");

    // the analyser must not carry a fifth copy of the numbers
    const analyze = fnOf("analyzeGame");
    // 6.0: by win-percentage drop (v6-plan Q2.5), still through review.js
    assert(/Review\.classifyByWinPct\(Review\.winPctDrop\(/.test(analyze), "the analyser tags moves through review.js");
    assert(!/loss >= \d+/.test(analyze), "the analyser holds no thresholds of its own");

    // the eval bar reads the analysis and nothing else — no engine call, which
    // is what keeps it review-only and unable to become a live answer key
    const bar = fnOf("drawEvalBar");
    assert(bar.length > 0, "drawEvalBar exists");
    assert(!/ChessEngine|analyze\(/.test(bar), "the eval bar never asks the engine anything");
    assert(/analysisFor\(\)/.test(bar) && /a\.scalars\[store\.game\.viewIndex\]/.test(bar),
      "the eval bar shows the position the board is standing on");
    assert(/rv\.evalNone/.test(bar), "an unmeasured position says so on screen");

    // the best-move arrow is derived, never stored: nothing to clear on a new
    // game, nothing that can drift out of step with the board
    const arrow = fnOf("bestArrowAt");
    assert(arrow.length > 0, "bestArrowAt exists");
    assert(/Review\.isMistake\(a\.tags\[i\]\)/.test(arrow),
      "the arrow appears only where the move played was a mistake");
    assert(/hintMove: isLive\(\) \? store\.session\.hintMove : bestArrowAt\(store\.game\.viewIndex\)/.test(appSrc),
      "the arrow is replay-only — never an answer key during a live game");
    assert(!/bestArrow\s*=/.test(appSrc), "the arrow is computed, not held in a variable");
    // and the analysis has to actually carry the engine's choice
    // v8-0-plan B2: kept by the pass itself (review-pass.js runPass), which analyzeGame files
    assert(/bests\[i\] = e && typeof e\.best/.test(fnOf("runPass")), "the analyser keeps the engine's own move");
    assert(/analysis = \{ sig, scalars, tags, pvs, bests,/.test(appSrc), "…and files it with the rest");
  }
}
