/**
 * Two measurements the code has been guessing at.
 *
 * P6 of docs/refactor-plan.md holds the questions that had to be measured
 * before anything was changed, because in both cases the obvious fix and the
 * obvious opposite fix are equally plausible from reading the source:
 *
 *   缺陷 23 — the move list annotates `?!` at 50cp, `?` at 100 and `??` at 300,
 *   and the quick scan gives each position 120ms. If 120ms of search wobbles by
 *   tens of centipawns on its own, then the `?!` band is inside the noise and
 *   the same game scanned twice tells two different stories. **Measured here by
 *   scanning the same games twice and comparing the tag sets**, at the quick
 *   scan's 120ms and at the deep pass's 400ms.
 *
 *   v6-plan Q2.5 — the same question for the win-percentage classification
 *   (review.js winPct / classifyByWinPct, cut-offs 5 / 10 / 20 points). It
 *   costs no extra engine time: the same two eval tracks are re-tagged the
 *   second way, and `winPctNoise` is written next to `scanNoise` with the
 *   same method so the two can be read side by side. The plan's acceptance
 *   is `?!` two-pass agreement ≥ 60% at 120ms; whatever comes out is recorded.
 *
 *   缺陷 32 — the beginner tier is `{skill:0, depth:2, multipv:10,
 *   worstBias:0.2}`: two times in ten it plays the worst candidate, and the
 *   other eight it picks uniformly among however many candidates came back.
 *   The claim in the defect is that the candidate count tracks the phase, so
 *   the tier quietly gets stronger as the board empties. **Measured here by
 *   counting the lines the engine actually returns at each phase**, together
 *   with the score spread across those lines — because if the count is flat
 *   and the spread is not, the sampling is what needs weighting, not the count.
 *
 * A measurement more than a test: it prints a table and, with --record,
 * writes docs/measured.json so prose can quote it instead of restating it.
 * Nothing here decides on its own that a threshold should move. The few
 * assertions are about the measurement's own sanity (both passes covered
 * every position, a rate is a rate, the sweep was taken), not its verdict.
 *
 * Runs Stockfish directly in node, mirroring the UCI sequence in
 * src/web/js/engine.js — same caveat as test-strength.mjs: it catches option
 * and threshold regressions, not the browser worker plumbing.
 *
 * Opt-in and slow (minutes). Run:
 *   node scripts/test-analysis.mjs [--record] [--ms=120,400] [--games=N]
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { createRequire } from "module";
import { fileURLToPath } from "url";
import { compileModuleSync } from "./bundle.mjs";
import { record, RECORDING } from "./measurements.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const require = createRequire(import.meta.url);

const enginePath = path.join(root, "third_party/stockfish/stockfish-19-lite-single.js");
const wasmPath = path.join(root, "third_party/stockfish/stockfish-19-lite-single.wasm");
if (!fs.existsSync(enginePath) || !fs.existsSync(wasmPath)) {
  console.log("skip: vendored Stockfish not found at third_party/stockfish/");
  process.exit(0);
}

// chess.js for legality, review.js for the very thresholds under test — read
// from the app so this cannot drift from what the move list actually annotates
const ctx = { console, Date, performance };
ctx.globalThis = ctx;
ctx.window = ctx;
vm.createContext(ctx);
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/chess.js")), ctx, { filename: "module" });
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/review.js")), ctx, { filename: "module" });
const Chess = ctx.Chess;
const Review = ctx.ChessReview;

const engCtx = { console };
engCtx.globalThis = engCtx;
engCtx.window = engCtx;
vm.createContext(engCtx);
vm.runInContext(compileModuleSync(path.join(root, "src/web/js/engine.js")), engCtx, { filename: "module" });
const TIERS = engCtx.ChessEngine.TIERS;

const msArg = (process.argv.find((a) => a.startsWith("--ms=")) || "").slice(5);
// 6.1: how many of the 28 games this run measures. --record takes them all
// (about twenty minutes); a plain run takes the first few so the gate is
// quick. See the corpus note at the top of this file.
const gamesArg = Number((process.argv.find((a) => a.startsWith("--games=")) || "").slice(8));
const GAME_LIMIT = Number.isFinite(gamesArg) && gamesArg > 0 ? gamesArg : (RECORDING ? Infinity : 6);
const MOVETIMES = msArg ? msArg.split(",").map(Number).filter((n) => n > 0) : [120, 400];

/**
 * Two complete games, played by hand rather than by this engine.
 *
 * A self-played game would make the measurement circular: positions the engine
 * chose are positions it already agrees about, and agreement is the thing being
 * measured. These are decided games with real mistakes in them — which is what
 * the annotation is for.
 *
 * 6.1: the corpus was four games, 168 plies. An agreement rate computed from
 * eleven `?!` events has a confidence interval wide enough to drive through,
 * and 6.0 published one anyway (docs/v6-plan.md §8). It is 28 games and about
 * 1300 plies now. Ten of the added games are the opening and middlegame of a
 * famous game, cut where the transcription this file was built from ends —
 * every one was played through chess.js before it was written down here, and
 * a partial game measures annotation stability exactly as well as a whole one.
 *
 * Running all of them twice at two budgets takes roughly twenty minutes, so a
 * plain run measures the first `--games N` (default 6) and `--record` uses the
 * whole corpus: the gate stays quick, the number that gets published does not
 * come from a sample of four.
 */
const GAMES = [
  { name: "Morphy–Duke of Brunswick & Count Isouard, Paris 1858",
    san: "e4 e5 Nf3 d6 d4 Bg4 dxe5 Bxf3 Qxf3 dxe5 Bc4 Nf6 Qb3 Qe7 Nc3 c6 Bg5 b5 Nxb5 cxb5 Bxb5+ Nbd7 O-O-O Rd8 Rxd7 Rxd7 Rd1 Qe6 Bxd7+ Nxd7 Qb8+ Nxb8 Rd8#".split(" ") },
  { name: "Steinitz–von Bardeleben, Hastings 1895",
    san: ("e4 e5 Nf3 Nc6 Bc4 Bc5 c3 Nf6 d4 exd4 cxd4 Bb4+ Nc3 d5 exd5 Nxd5 O-O Be6 Bg5 Be7 " +
      "Bxd5 Bxd5 Nxd5 Qxd5 Bxe7 Nxe7 Re1 f6 Qe2 Qd7 Rac1 c6 d5 cxd5 Nd4 Kf7 Ne6 Rhc8 Qg4 g6 " +
      "Ng5+ Ke8 Rxe7+").split(" ") },
  { name: "Anderssen–Kieseritzky, London 1851",
    san: ("e4 e5 f4 exf4 Bc4 Qh4+ Kf1 b5 Bxb5 Nf6 Nf3 Qh6 d3 Nh5 Nh4 Qg5 Nf5 c6 g4 Nf6 Rg1 cxb5 " +
      "h4 Qg6 h5 Qg5 Qf3 Ng8 Bxf4 Qf6 Nc3 Bc5 Nd5 Qxb2 Bd6 Bxg1 e5 Qxa1+ Ke2 Na6 Nxg7+ Kd8 " +
      "Qf6+ Nxf6 Be7#").split(" ") },
  { name: "Anderssen–Dufresne, Berlin 1852",
    san: ("e4 e5 Nf3 Nc6 Bc4 Bc5 b4 Bxb4 c3 Ba5 d4 exd4 O-O d3 Qb3 Qf6 e5 Qg6 Re1 Nge7 Ba3 b5 " +
      "Qxb5 Rb8 Qa4 Bb6 Nbd2 Bb7 Ne4 Qf5 Bxd3 Qh5 Nf6+ gxf6 exf6 Rg8 Rad1 Qxf3 Rxe7+ Nxe7 " +
      "Qxd7+ Kxd7 Bf5+ Ke8 Bd7+ Kf8 Bxe7#").split(" ") },
  { name: "Capablanca–Marshall, New York 1918",
    san: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 O-O c3 d5 exd5 Nxd5 Nxe5 Nxe5 Rxe5 Nf6 Re1 Bd6 h3 Ng4 Qf3 Qh4 d4 Nxf2 Re2 Bg4 hxg4 Bh2+ Kf1 Bg3 Rxf2 Qh1+ Ke2 Bxf2 Bd2 Bh4 Qh3 Rae8+ Kd3 Qf1+ Kc2 Bf2 Qf3 Qg1 Bd5 c5 dxc5 Bxc5 b4 Bd6 a4 a5 axb5 axb4 Ra6 bxc3 Nxc3 Bb4 b6 Bxc3 Bxc3 h6 b7 Re3 Bxf7+ Rxf7 b8=Q+ Kh7 Rxh6+ gxh6".split(" ") },  // 记到抄录为止
  { name: "Kasparov–Topalov, Wijk aan Zee 1999",
    san: "e4 d6 d4 Nf6 Nc3 g6 Be3 Bg7 Qd2 c6 f3 b5 Nge2 Nbd7 Bh6 Bxh6 Qxh6 Bb7 a3 e5 O-O-O Qe7 Kb1 a6 Nc1 O-O-O Nb3 exd4 Rxd4 c5 Rd1 Nb6 g3 Kb8 Na5 Ba8 Bh3 d5 Qf4+ Ka7 Rhe1 d4 Nd5 Nbxd5 exd5 Qd6 Rxd4 cxd4 Re7+ Kb6 Qxd4+ Kxa5 b4+ Ka4 Qc3 Qxd5 Ra7 Bb7 Rxb7 Qc4 Qxf6 Kxa3 Qxa6+ Kxb4 c3+ Kxc3 Qa1+ Kd2 Qb2+ Kd1 Bf1 Rd2 Rd7 Rxd7 Bxc4 bxc4 Qxh8 Rd3 Qa8 c3 Qa4+ Ke1 f4".split(" ") },
  { name: "Fischer–Spassky, Reykjavik 1972 g6",
    san: "c4 e6 Nf3 d5 d4 Nf6 Nc3 Be7 Bg5 O-O e3 h6 Bh4 b6 cxd5 Nxd5 Bxe7 Qxe7 Nxd5 exd5 Rc1 Be6 Qa4 c5 Qa3 Rc8 Bb5 a6 dxc5 bxc5 O-O Ra7 Be2 Nd7 Nd4 Qf8 Nxe6 fxe6 e4 d4 f4 Qe7 e5 Rb8 Bc4 Kh8 Qh3 Nf8 b3 a5 f5 exf5 Rxf5 Nh7 Rcf1 Qd8 Qg3 Re7 h4 Rbb7 e6 Rbc7 Qe5 Qe8 a4 Qd8 R1f2 Qe8 R2f3 Qd8 Bd3 Qe8 Qe4 Nf6 Rxf6 gxf6 Rxf6 Kg8 Bc4 Kh8 Qf4".split(" ") },
  { name: "Alekhine–Bogoljubov, Hastings 1922",
    san: "d4 f5 c4 Nf6 g3 e6 Bg2 Bb4+ Bd2 Bxd2+ Nxd2 Nc6 Ngf3 O-O O-O d6 Qb3 Kh8 Qc3 e5 e3 a5 b3 Qe8 a3 Qh5 h4 Ng4 Ng5 Bd7 f3 Nf6 f4 e4 Rfd1 h6 Nh3 d5 Nf1 Ne7 a4 Nc6 Rd2 Nb4 Bh1 Qe8 Rg2 dxc4 bxc4 Bxa4 Nf2 Bd7 Nd2 b5 Nd1 Nd3 Rxa5 b4 Rxa8 bxc3 Rxe8 c2 Rxf8+ Kh7 Nf2 c1=Q+ Nf1 Ne1 Rh2 Qxc4 Rb8 Bb5 Rxb5 Qxb5 g4 Nf3+ Bxf3 exf3 gxf5 Qe2 d5 Kg8 h5 Kh7 e4 Nxe4 Nxe4 Qxe4 d6 cxd6 f6 gxf6 Rd2 Qe2 Rxe2 fxe2 Kf2 exf1=Q+ Kxf1 Kg7 Kf2 Kf7 Ke3 Ke6 Ke4 d5+".split(" ") },
  { name: "Reti–Alekhine, Baden-Baden 1925",
    san: "g3 e5 Nf3 e4 Nd4 d5 d3 exd3 Qxd3 Nf6 Bg2 Bb4+ Bd2 Bxd2+ Nxd2 O-O c4 Na6 cxd5 Nb4 Qc4 Nbxd5 N2b3 c6 O-O Re8 Rfd1 Bg4 Rd2 Qc8 Nc5 Bh3 Bf3 Bg4 Bg2 Bh3 Bf3 Bg4 Bg2 Bh3".split(" ") },
  { name: "Anand–Carlsen, Chennai 2013 g5",
    san: "c4 e6 d4 d5 Nc3 c6 Bg5 h6 Bh4 dxc4 e4 g5 Bg3 b5 Be2 Bb7 Bf3 a6 e5 Nd7 Nge2 Bb4 O-O Bxc3 bxc3 c5 a4 Nb6 axb5 axb5 Rxa8 Bxa8".split(" ") },  // 记到抄录为止
  { name: "Spassky–Fischer, Reykjavik 1972 g13",
    san: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7 g4 b5 Bxf6 Nxf6 g5 Nd7 f5 Nc5 f6 gxf6 gxf6 Bf8 Rg1 h5 Bh3 Bd7 Rg7 O-O-O".split(" ") },  // 记到抄录为止
  { name: "Kasparov–Karpov, Seville 1987 g24",
    san: "c4 e6 Nf3 Nf6 g3 d5 b3 Be7 Bg2 O-O O-O b6 Nc3 Bb7 cxd5 exd5 d4 Nbd7 Bf4 c5 dxc5 bxc5 Rc1 Rc8 Ne5 Nxe5 Bxe5 Ne4 Nxe4 dxe4 e3 Qd7 b4 cxb4 Qb3 Qd5 Qxb4 Bd6 Rfd1 Rc4 Bxd6 Rxb4 Bxb4 a5 Bxa5".split(" ") },
  { name: "Ivanchuk–Yusupov, Brussels 1991",
    san: "c4 e5 g3 d6 Bg2 g6 d4 Nd7 Nc3 Bg7 Nf3 Ngf6 O-O O-O Qc2 Re8 Rd1 c6 b3 Qe7 Ba3 e4 Ng5 e3 f4 Nf8 b4 Bf5 Qb3 h6 Nf3 Ng4 b5 g5 bxc6 bxc6 Ne5 gxf4 Nxc6 Qg5 Bxd6 Ng6 Nd5 Qh5 h4 Nxh4 gxh4 Qxh4".split(" ") },
  { name: "Geller–Euwe, Zurich 1953",
    san: "d4 Nf6 c4 e6 Nc3 Bb4 e3 c5 a3 Bxc3+ bxc3 b6 Bd3 Bb7 f3 Nc6 Ne2 O-O O-O Na5 e4 Ne8 Ng3 cxd4 cxd4 Rc8 f4 Nxc4 f5 f6 Rf4 b5 Rh4 Qb6 e5 Nxe5 fxe6 Nxd3 Qxd3 Qxe6 Qxh7+ Kf7 Bh6 Rh8 Qxh8 Rc2 Rc1 Rxg2+ Kf1 Qb3 Ke1 Qf3".split(" ") },
  { name: "Rotlewi–Rubinstein, Lodz 1907",
    san: "d4 d5 Nf3 e6 e3 c5 c4 Nc6 Nc3 Nf6 dxc5 Bxc5 a3 a6 b4 Bd6 Bb2 O-O Qd2 Qe7 Bd3 dxc4 Bxc4 b5 Bd3 Rd8 Qe2 Bb7 O-O Ne5 Nxe5 Bxe5 f4 Bc7 e4 Rac8 e5 Bb6+ Kh1 Ng4 Be4 Qh4 g3 Rxc3 gxh4 Rd2 Qxd2 Bxe4+ Qg2 Rh3".split(" ") },
  { name: "Bronstein–Ljubojevic, Petropolis 1973",
    san: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nc6 Nxc6 dxc6 O-O e5 f4 Bg4 Qe1 exf4 Bxf4 Nf6 Nd2 Bd6 Bg3 O-O Nc4 Bxg3 hxg3 Qe7 Qf2 Nd7 Rae1 Ne5 Nxe5 Qxe5 Re3 Rad8 Rfe1 Qd4 Bf1".split(" ") },  // 记到抄录为止
  { name: "Nimzowitsch–Capablanca, St Petersburg 1914",
    san: "e4 e5 Nf3 Nc6 Bb5 a6 Bxc6 dxc6 d3 Bg4 h3 Bh5 Nbd2 Nf6 Qe2 Bd6 Nc4 Nd7 Be3 O-O O-O-O b5 Nxd6 cxd6 g4 Bg6 h4 h5 Bg5 Qb6".split(" ") },  // 记到抄录为止
  { name: "Kramnik–Kasparov, London 2000 g2",
    san: "d4 Nf6 c4 e6 Nf3 d5 Nc3 Be7 Bg5 h6 Bh4 O-O e3 Ne4 Bxe7 Qxe7 cxd5 Nxc3 bxc3 exd5 Qb3 Rd8 c4 dxc4 Bxc4 Nc6 Qc3 a6 O-O Qf6 Rfe1 b5 Bd3 Bb7".split(" ") },  // 记到抄录为止
  { name: "Fischer–Myagmarsuren, Sousse 1967",
    san: "e4 e6 d3 d5 Nd2 Nf6 g3 c5 Bg2 Nc6 Ngf3 Be7 O-O O-O Re1 b5 e5 Nd7 Nf1 a5 h4 b4 Bf4 a4 a3 bxa3 bxa3 Na5 Ne3 Ba6 Nh2 d4 Bf1 Nb6".split(" ") },  // 记到抄录为止
  { name: "Polugaevsky–Nezhmetdinov, Sochi 1958",
    san: "d4 Nf6 c4 d6 Nc3 e5 e4 exd4 Qxd4 Nc6 Qd2 g6 b3 Bg7 Bb2 O-O Bd3 Ng4 Nge2 Qh4 Ng3 Nge5 O-O f5 f3 Bh6 Qd1 f4 Nge2 g5 Nd5 g4 g3 fxg3 hxg3 Qh3 f4 Be6 Rc1 Rf7".split(" ") },  // 记到抄录为止
  { name: "Short–Timman, Tilburg 1991",
    san: "e4 Nf6 e5 Nd5 d4 d6 Nf3 g6 Bc4 Nb6 Bb3 Bg7 Qe2 Nc6 O-O O-O h3 a5 a4 dxe5 dxe5 Nd4 Nxd4 Qxd4 Re1 e6 Nd2 Nd5 Nf3 Qc5 Qe4 Qb4 Bc4 Nb6 b3 Nxc4 bxc4 Re8 Rd1 Qc5 Qh4 b6 Be3 Qc6 Bh6 Bh8 Rd8 Bb7 Rad1 Bg7 R8d7 Rf8 Bxg7 Kxg7 R1d4 Rae8 Qf6+ Kg8 h4 h5 Kh2 Rc8 Kg3 Rce8 Kf4 Bc8 Kg5".split(" ") },
  { name: "Karpov–Unzicker, Nice 1974",
    san: "e4 e5 Nf3 Nc6 Bb5 a6 Ba4 Nf6 O-O Be7 Re1 b5 Bb3 d6 c3 O-O h3 Na5 Bc2 c5 d4 Qc7 Nbd2 Nc6 d5 Nd8 a4 Rb8 axb5 axb5 b4 Nb7 Nf1 Bd7 Be3 Ra8 Qd2 Rfc8 Ra3 Qd8 Rea1 Qe8".split(" ") },  // 记到抄录为止
  { name: "Botvinnik–Portisch, Monte Carlo 1968",
    san: "c4 e5 Nc3 Nf6 g3 d5 cxd5 Nxd5 Bg2 Be6 Nf3 Nc6 O-O Nb6 d3 Be7 a3 a5 Be3 O-O Na4 Nxa4 Qxa4 Bd5 Rfc1 Re8 Rc2 Bf8 Rac1 Nb8 Rxc7 Bc6 R1xc6 bxc6 Rxf7 h6 Rb7 Qc8 Qc4+ Kh8 Nh4".split(" ") },
  { name: "Averbakh–Kotov, Zurich 1953",
    san: "d4 Nf6 c4 d6 Nf3 Nbd7 Nc3 e5 e4 Be7 Be2 O-O O-O c6 Rb1 Re8 d5 Bf8 Be3 Ng4 Bg5 f6 Bh4 g5 Bg3 Nh6 h4 gxh4 Bxh4 Ng4 Bg3".split(" ") },  // 记到抄录为止
  { name: "Spassky–Petrosian, Moscow 1969 g19",
    san: "d4 Nf6 c4 e6 Nf3 d5 Nc3 c5 cxd5 Nxd5 e4 Nxc3 bxc3 cxd4 cxd4 Nc6 Bc4 b5 Be2 Bb4+ Bd2 Qa5 a3 Bxd2+ Qxd2 Qxd2+ Nxd2 O-O O-O Bb7 Rfc1 Rac8 Nb3 Na5 Nxa5".split(" ") },
  { name: "Bronstein–Keres, Gothenburg 1955",
    san: "e4 c5 Nf3 d6 d4 cxd4 Nxd4 Nf6 Nc3 a6 Bg5 e6 f4 Be7 Qf3 Qc7 O-O-O Nbd7 g4 b5 Bxf6 Nxf6 g5 Nd7 f5 Nc5 f6 gxf6 gxf6 Bf8 Rg1 h5 Bh3 Bd7".split(" ") },
  { name: "Tarrasch–Euwe, Bad Pistyan 1922",
    san: "d4 d5 c4 e6 Nc3 Nf6 Bg5 Nbd7 e3 Be7 Nf3 O-O Rc1 c6 Bd3 dxc4 Bxc4 Nd5 Bxe7 Qxe7 O-O Nxc3 Rxc3 e5 Bb3 exd4 exd4 Nf6 Re1 Qd6 h3 Bf5 Qd2 Rfe8 Rce3 Rxe3 Rxe3 Re8 Rxe8+ Nxe8".split(" ") },
  { name: "Fischer–Tal, Bled 1961",
    san: "e4 c5 Nf3 e6 d4 cxd4 Nxd4 a6 Bd3 Nf6 O-O Qc7 Nd2 Nc6 Nxc6 dxc6 f4 e5 f5 Be7 Nc4 b5 Ne3 O-O Qe2 Bd6 Kh1 a5 a4 b4 c3 bxc3 bxc3 Rb8 Bd2 Rb2".split(" ") },
];

// --- engine driver (mirrors src/web/js/engine.js) -------------------------
const listeners = [];
const engine = {
  wasmBinary: new Uint8Array(fs.readFileSync(wasmPath)),
  listener: (line) => { for (const l of listeners.slice()) l(line); },
};
const factory = require(enginePath);
await (factory.length >= 1 ? factory(engine) : factory()(engine));
await new Promise((resolve) => {
  const tick = () => (engine._isReady && !engine._isReady() ? setTimeout(tick, 10) : resolve());
  tick();
});
const send = (cmd) => engine.ccall("command", null, ["string"], [cmd], { async: /^go\b/.test(cmd) });
function waitFor(pred, ms = 30000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { drop(); reject(new Error("engine timeout")); }, ms);
    const h = (line) => { if (pred(line)) { clearTimeout(timer); drop(); resolve(line); } };
    const drop = () => { const i = listeners.indexOf(h); if (i >= 0) listeners.splice(i, 1); };
    listeners.push(h);
  });
}
async function ready() { const w = waitFor((l) => l === "readyok", 10000); send("isready"); await w; }
const uciWait = waitFor((l) => l === "uciok", 20000);
send("uci");
await uciWait;

const infoScore = (line) => {
  const m = line.match(/\bscore (cp|mate) (-?\d+)\b/);
  if (!m) return null;
  return { kind: m[1], val: Number(m[2]) };
};

/** app.js evalScalar(), to the letter — side-to-move score → White's point of view */
function evalScalar(score, turn) {
  if (!score) return null;
  const sign = turn === "w" ? 1 : -1;
  if (score.kind === "mate") {
    const mag = 10000 - Math.min(Math.abs(score.val), 50) * 10;
    return score.val > 0 ? sign * mag : -sign * mag;
  }
  return sign * score.val;
}

/** One quick-scan probe, the same UCI sequence analyzeInner() sends. */
async function scan(fen, ms) {
  await ready();
  send("setoption name MultiPV value 1");
  send("setoption name Skill Level value 20");
  send("setoption name UCI_LimitStrength value false");
  send("position fen " + fen);
  let score = null;
  const collect = (l) => { const s = infoScore(l); if (s) score = s; };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), ms + 20000);
  send("go movetime " + ms);
  try { await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  return evalScalar(score, fen.split(" ")[1] === "b" ? "b" : "w");
}

/** Every position of a game, the way analyzeGame() walks it. */
function fensOf(sans) {
  const g = new Chess();
  const fens = [g.fen()];
  for (const san of sans) {
    if (!g.move(san)) throw new Error("illegal SAN in fixture: " + san);
    fens.push(g.fen());
  }
  return fens;
}

/** The tag the move list would print for each ply of one eval track. */
function tagsOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.markFor(Review.lossOf(a, b, side)));
  }
  return out;
}

/** The centipawn loss of each ply of one eval track — markFor()'s input. */
function lossesOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.lossOf(a, b, side));
  }
  return out;
}

/**
 * How reproducible would the lowest band be at `cut` instead of 50?
 *
 * Swept over the eval tracks already recorded, so trying ten thresholds costs
 * nothing and the answer is measured rather than argued. A threshold is only
 * worth moving to if the marks it prints survive a second scan.
 */
function agreementAt(pairs, lo, hi) {
  let a = 0, b = 0, both = 0;
  for (const [la, lb] of pairs) {
    for (let i = 0; i < la.length; i++) {
      const inA = la[i] != null && la[i] >= lo && la[i] < hi;
      const inB = lb[i] != null && lb[i] >= lo && lb[i] < hi;
      if (inA) a++;
      if (inB) b++;
      if (inA && inB) both++;
    }
  }
  const union = a + b - both;
  return { runA: a, runB: b, both, agreePct: union ? Math.round((both / union) * 100) : 0 };
}

const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
let failed = 0;
function assert(cond, msg) {
  if (cond) console.log("ok   " + msg);
  else { failed++; console.error("FAIL " + msg); }
}

/** The win-percentage drop of each ply of one eval track — classifyByWinPct()'s input. */
function dropsOf(scalars) {
  const out = [];
  for (let i = 1; i < scalars.length; i++) {
    const side = i % 2 === 1 ? "w" : "b";
    const a = scalars[i - 1], b = scalars[i];
    out.push(a == null || b == null ? null : Review.winPctDrop(a, b, side));
  }
  return out;
}

/** Jaccard agreement of two tag tracks, per tag. */
function tagAgreement(tA, tB, keys) {
  const agree = {};
  for (const k of keys) {
    let a = 0, b = 0, both = 0;
    for (let i = 0; i < tA.length; i++) {
      if (tA[i] === k) a++;
      if (tB[i] === k) b++;
      if (tA[i] === k && tB[i] === k) both++;
    }
    agree[k] = { a, b, both };
  }
  return agree;
}
const quantile = (xs, q) => {
  if (!xs.length) return 0;
  const s = xs.slice().sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};

// =========================================================================
// 缺陷 23 — does the same game scanned twice tell the same story?
// =========================================================================
const scanOut = { what: "同一局连跑两次快扫,比较两次的标注集合与逐点评估抖动",
  script: "scripts/test-analysis.mjs --record",
  thresholds: { inaccuracy: Review.INACCURACY, mistake: Review.MISTAKE, blunder: Review.BLUNDER },
  games: Math.min(GAMES.length, GAME_LIMIT), byMovetime: {} };
const wpOut = { what: "同一两遍快扫的评估轨迹,改按胜率降幅分类(review.js classifyByWinPct),比较两次的标注集合",
  script: "scripts/test-analysis.mjs --record",
  thresholds: { inaccuracy: Review.WIN_INACCURACY, mistake: Review.WIN_MISTAKE, blunder: Review.WIN_BLUNDER },
  games: Math.min(GAMES.length, GAME_LIMIT), byMovetime: {} };
const TAGS = ["?!", "?", "??"];

for (const ms of MOVETIMES) {
  const jitter = [];
  const agree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
  const wpAgree = { "?!": { a: 0, b: 0, both: 0 }, "?": { a: 0, b: 0, both: 0 }, "??": { a: 0, b: 0, both: 0 } };
  const lossPairs = [], dropPairs = [];
  let plies = 0, wpPlies = 0;
  for (const game of GAMES.slice(0, GAME_LIMIT)) {
    const fens = fensOf(game.san);
    const runA = [], runB = [];
    for (const fen of fens) runA.push(await scan(fen, ms));
    for (const fen of fens) runB.push(await scan(fen, ms));
    assert(runA.length === fens.length && runB.length === fens.length,
      `${ms}ms · ${game.name.split(",")[0]}: both passes scored every one of the ${fens.length} positions`);
    {
      const wA = dropsOf(runA).map(Review.classifyByWinPct), wB = dropsOf(runB).map(Review.classifyByWinPct);
      dropPairs.push([dropsOf(runA), dropsOf(runB)]);
      wpPlies += wA.length;
      const g = tagAgreement(wA, wB, TAGS);
      for (const k of TAGS) { wpAgree[k].a += g[k].a; wpAgree[k].b += g[k].b; wpAgree[k].both += g[k].both; }
    }
    for (let i = 0; i < fens.length; i++) {
      // mate scores are ±10000-ish and would swamp a centipawn jitter figure
      if (runA[i] == null || runB[i] == null) continue;
      if (Math.abs(runA[i]) > 9000 || Math.abs(runB[i]) > 9000) continue;
      jitter.push(Math.abs(runA[i] - runB[i]));
    }
    const tA = tagsOf(runA), tB = tagsOf(runB);
    lossPairs.push([lossesOf(runA), lossesOf(runB)]);
    plies += tA.length;
    for (const k of Object.keys(agree)) {
      for (let i = 0; i < tA.length; i++) {
        if (tA[i] === k) agree[k].a++;
        if (tB[i] === k) agree[k].b++;
        if (tA[i] === k && tB[i] === k) agree[k].both++;
      }
    }
  }
  const row = { plies, jitterMedian: quantile(jitter, 0.5), jitterP90: quantile(jitter, 0.9), tags: {} };
  for (const [k, v] of Object.entries(agree)) {
    // Jaccard: of every ply either run called `k`, how many did both call it
    const union = v.a + v.b - v.both;
    row.tags[k] = { runA: v.a, runB: v.b, both: v.both, agreePct: pct(v.both, union) };
  }
  scanOut.byMovetime[String(ms)] = row;
  console.log(`\n--- 缺陷 23 · 快扫 ${ms}ms ---`);
  console.log(`  逐点评估抖动: 中位 ${row.jitterMedian}cp · 九成位 ${row.jitterP90}cp`);
  for (const [k, v] of Object.entries(row.tags)) {
    console.log(`  ${k.padEnd(2)}  第一次 ${String(v.runA).padStart(2)} 处 · 第二次 ${String(v.runB).padStart(2)} 处 · 两次都标 ${String(v.both).padStart(2)} 处 · 重合率 ${v.agreePct}%`);
  }
  // Where would the lowest band have to sit for its marks to survive a second
  // scan? Swept over the tracks just recorded — no extra engine time.
  row.sweep = {};
  console.log("  ?! 门槛扫描(下界 → 重合率,上界仍是 " + Review.MISTAKE + "):");
  for (const cut of [40, 50, 60, 70, 80, 90]) {
    const r = agreementAt(lossPairs, cut, Review.MISTAKE);
    row.sweep[String(cut)] = r;
    console.log(`    ${String(cut).padStart(3)}cp  两次各 ${String(r.runA).padStart(2)}/${String(r.runB).padStart(2)} 处 · 重合 ${String(r.both).padStart(2)} · ${r.agreePct}%`);
  }

  // The same tracks, tagged by win-percentage drop. agreeRate is the 0..1
  // form of agreePct, so a reader of the JSON can take either.
  // cpSameRun repeats the centipawn figures of *these* two passes, so the
  // side-by-side is within one run — scanNoise may have been recorded on
  // another day and another machine.
  const wpRow = { plies: wpPlies, tags: {}, cpSameRun: row.tags, sweep: {} };
  assert(wpPlies === plies, `${ms}ms · win% tagged the same ${plies} plies the centipawn pass did`);
  for (const [k, v] of Object.entries(wpAgree)) {
    const union = v.a + v.b - v.both;
    wpRow.tags[k] = { runA: v.a, runB: v.b, both: v.both, agreePct: pct(v.both, union),
      agreeRate: union ? Math.round((v.both / union) * 1000) / 1000 : 0 };
    assert(wpRow.tags[k].agreeRate >= 0 && wpRow.tags[k].agreeRate <= 1, `${ms}ms · ${k} win% agreement is a rate (${wpRow.tags[k].agreeRate})`);
  }
  console.log(`\n--- Q2.5 · 同一轨迹按胜率差分类 ${ms}ms(?! ${Review.WIN_INACCURACY} / ? ${Review.WIN_MISTAKE} / ?? ${Review.WIN_BLUNDER} 个百分点)---`);
  for (const [k, v] of Object.entries(wpRow.tags)) {
    const cpv = row.tags[k];
    console.log(`  ${k.padEnd(2)}  第一次 ${String(v.runA).padStart(2)} 处 · 第二次 ${String(v.runB).padStart(2)} 处 · 两次都标 ${String(v.both).padStart(2)} 处 · 重合率 ${v.agreePct}%(厘兵 ${cpv.agreePct}%)`);
  }
  // `band` moves only the ?! floor (upper edge stays at the next cut-off, as
  // the centipawn sweep does; at 10 the ?! band is gone and the row reads the
  // ? band). `atLeast` counts every move flagged at all from `cut` up — the
  // question a player asking "is this move marked or not" is really asking.
  console.log("  ?! 门槛扫描(胜率百分点 → 重合率):");
  for (const cut of [3, 5, 7, 10]) {
    const hi = cut < Review.WIN_MISTAKE ? Review.WIN_MISTAKE : Review.WIN_BLUNDER;
    const band = agreementAt(dropPairs, cut, hi), atLeast = agreementAt(dropPairs, cut, Infinity);
    wpRow.sweep[String(cut)] = { band: { hi, ...band }, atLeast };
    console.log(`    ${String(cut).padStart(3)} 点  区间 [${cut},${hi}) 两次各 ${String(band.runA).padStart(2)}/${String(band.runB).padStart(2)} · 重合 ${band.agreePct}% · 及以上 两次各 ${String(atLeast.runA).padStart(2)}/${String(atLeast.runB).padStart(2)} · 重合 ${atLeast.agreePct}%`);
  }
  assert(["3", "5", "7", "10"].every((c) => wpRow.sweep[c] && Number.isFinite(wpRow.sweep[c].band.agreePct)),
    `${ms}ms · the 3/5/7/10-point sweep was taken`);
  wpOut.byMovetime[String(ms)] = wpRow;
}

// =========================================================================
// 缺陷 32 — is the beginner tier's strength a function of candidate count?
// =========================================================================
const tier = TIERS.beginner;

/** Every candidate the beginner tier's own search returns for `fen`. */
async function candidates(fen) {
  await ready();
  send("setoption name MultiPV value " + (tier.multipv || 1));
  send("setoption name UCI_LimitStrength value false");
  send("setoption name Skill Level value " + (tier.skill != null ? tier.skill : 20));
  send("position fen " + fen);
  const cands = new Map();
  const collect = (line) => {
    if (typeof line !== "string") return;
    const mv = line.match(/\bmultipv (\d+)\b/);
    const pv = line.match(/\bpv\s+([a-h][1-8][a-h][1-8][qrbn]?)/);
    const sc = infoScore(line);
    if (mv && pv) cands.set(Number(mv[1]), { uci: pv[1], cp: sc && sc.kind === "cp" ? sc.val : (sc ? (sc.val > 0 ? 9000 : -9000) : null) });
  };
  listeners.push(collect);
  const w = waitFor((l) => typeof l === "string" && l.startsWith("bestmove"), (tier.movetime || 2000) + 20000);
  send(tier.depth ? "go depth " + tier.depth : "go movetime " + tier.movetime);
  try { await w; } finally { listeners.splice(listeners.indexOf(collect), 1); }
  return [...cands.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** Opening / middlegame / endgame, by men left on the board. */
const phaseOf = (fen) => {
  const men = (fen.split(" ")[0].match(/[a-zA-Z]/g) || []).length;
  return men >= 26 ? "opening" : men >= 14 ? "middlegame" : "endgame";
};

const mvOut = { what: "新手档自己的搜索设置下,每个局面实际返回几条候选、候选之间差多少分",
  script: "scripts/test-analysis.mjs --record",
  tier: { skill: tier.skill, depth: tier.depth, multipv: tier.multipv, worstBias: tier.worstBias },
  // The change this measurement was taken to justify, and what happened when
  // it was tried anyway. Kept here because a rejected option with numbers on
  // it is what stops the same idea being re-proposed from first principles.
  weightedSamplingTried: {
    what: "把八成的均匀抽样改成按与首选的分差加权(exp(-gap/K)),量新手 bot 的得分率",
    script: "scripts/test-novice.mjs --tier=<id> --games=32",
    baselineScorePct: { beginner: 56, casual: 27 },
    runs: [
      { spreadK: { beginner: 250, casual: 180 }, scorePct: { beginner: 33, casual: 6 } },
      { spreadK: { beginner: 700, casual: 500 }, scorePct: { beginner: 38, casual: 8 } },
    ],
    verdict: "不采用:两档都远强于既定标定,要补回来只能把 worstBias 抬回 1.19 已经否掉的 0.6 附近",
  },
  phases: {} };
// Four decided games never reach an endgame — all four are mating attacks —
// so the phase the defect is actually about would have had no data at all.
// The endgame positions come from the app's own shipped content (the endgame
// lessons and the draw/defence puzzles) rather than being invented here: those
// are the positions a player using this app really arrives at.
const extra = [];
{
  const cCtx = { console, Date, performance };
  cCtx.globalThis = cCtx;
  cCtx.window = cCtx;
  vm.createContext(cCtx);
  for (const m of ["lessons.js", "puzzles.js"]) {
    vm.runInContext(compileModuleSync(path.join(root, "src/web/js/" + m)), cCtx, { filename: "module" });
  }
  const seen = new Set();
  const take = (fen) => {
    if (!fen || seen.has(fen)) return;
    seen.add(fen);
    let probe;
    try { probe = new Chess(fen); } catch (_) { return; }
    if (!probe.fen() || probe.game_over()) return;
    if (phaseOf(fen) !== "endgame") return;
    extra.push(fen);
  };
  for (const L of cCtx.CHESS_LESSONS || []) for (const t of L.tasks || []) take(t.fen);
  for (const p of cCtx.CHESS_PUZZLES || []) take(p.fen);
}
console.log(`\n(残局局面 ${extra.length} 个,取自课程与题库 —— 四局对局全是杀王局,走不到残局)`);

const rows = [];
for (const fen of GAMES.flatMap((g) => fensOf(g.san)).concat(extra)) {
  {
    const probe = new Chess(fen);
    if (probe.game_over()) continue;
    const legal = probe.moves().length;
    const cs = await candidates(fen);
    const scored = cs.filter((c) => c.cp != null);
    rows.push({
      phase: phaseOf(fen), legal, n: cs.length,
      // what a uniform pick actually costs: best candidate minus the mean of
      // the rest, in centipawns, from the mover's point of view
      spread: scored.length >= 2 ? scored[0].cp - Math.round(scored.slice(1).reduce((a, c) => a + c.cp, 0) / (scored.length - 1)) : null,
      worst: scored.length >= 2 ? scored[0].cp - Math.min(...scored.map((c) => c.cp)) : null,
    });
  }
}
console.log(`\n--- 缺陷 32 · 新手档候选条数 (multipv ${tier.multipv}, depth ${tier.depth}) ---`);
for (const ph of ["opening", "middlegame", "endgame"]) {
  const r = rows.filter((x) => x.phase === ph);
  if (!r.length) continue;
  const mean = (xs) => (xs.length ? Math.round((xs.reduce((a, b) => a + b, 0) / xs.length) * 10) / 10 : null);
  const spreads = r.map((x) => x.spread).filter((x) => x != null);
  const worsts = r.map((x) => x.worst).filter((x) => x != null);
  const row = {
    positions: r.length,
    legalMean: mean(r.map((x) => x.legal)),
    candidatesMean: mean(r.map((x) => x.n)),
    candidatesMin: Math.min(...r.map((x) => x.n)),
    cappedPct: pct(r.filter((x) => x.n >= (tier.multipv || 1)).length, r.length),
    spreadMean: mean(spreads),
    spreadMedian: quantile(spreads, 0.5),
    worstGapMedian: quantile(worsts, 0.5),
  };
  mvOut.phases[ph] = row;
  console.log(`  ${ph.padEnd(11)} ${String(row.positions).padStart(3)} 个局面 · 合法着法均 ${row.legalMean} · 候选均 ${row.candidatesMean}(最少 ${row.candidatesMin},满 ${tier.multipv} 条的占 ${row.cappedPct}%)`);
  console.log(`  ${" ".repeat(11)}     首选领先其余均值 ${row.spreadMean}cp(中位 ${row.spreadMedian})· 首选与最差差 ${row.worstGapMedian}cp(中位)`);
}

if (RECORDING) {
  record("scanNoise", scanOut);
  record("winPctNoise", wpOut);
  record("multipvPhase", mvOut);
} else {
  console.log("\n（只打印,没写入。加 --record 才写 docs/measured.json）");
}
if (failed) { console.error(failed + " check(s) failed"); process.exit(1); }
process.exit(0);
