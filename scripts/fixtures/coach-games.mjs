/**
 * Low-skill engine games for the coach measurement (v8-0-plan B3) — written
 * by `node scripts/test-coach.mjs gen`, do not edit.
 *
 * Stockfish at UCI Skill Level 0–3 against itself from a four-ply random
 * opening, 40 ms a move — the recipe scripts/mine-puzzles.mjs uses because
 * weak settings blunder the way people do. The 28-game corpus is mostly
 * master play; its ?? are few and mostly deep. These are the other kind.
 */
export const COACH_GAMES = [
  { name: "low-skill 1 (skill 0–3)",
    san: "c4 Nc6 b3 e6 Nc3 b6 Bb2 Nf6 d4 d5 e3 a6 Bd3 Bd6 Nf3 Ne7 Qe2 Ng6 O-O-O dxc4 Bxg6 fxg6 Ne5 Bb7 bxc4 Bxg2 Qe1 Bb7 f3 O-O Qe2 Bxe5 dxe5 Nd7 e4 Rf7 h4 Qe7 h5 g5 Nd5 Bxd5 cxd5 h6 Kb1 Nc5 Rhg1 Qd7 Rg3 Rd8 Rd2 Rdf8 Ba3 a5 Bxc5 bxc5 Kc1 Qa4 dxe6 Re7 Qa6 Kh7 Rc2 Rb8 Qc4 Qc6 a3 Qe8 Rf2 Qf8 Qxc5 Qf4+ Kc2 Rxe6 Rd2 a4 Qxc7 Rb2+ Kxb2 Qxd2+ Ka1 Qd4+ Kb1 Qe3 Qf7 Qb3+ Ka1 Qc3+ Ka2 Qb3+ Ka1 Qxa3+ Kb1 Rb6+ Kc2 Rb2+ Kc1 Qc3+ Kd1 Qd4+ Ke1 Qc3+ Kf1 Qc1#".split(" ") },
  { name: "low-skill 2 (skill 2–1)",
    san: "Nc3 h5 d3 h4 e4 e5 f4 exf4 Bxf4 d6 Qd2 Be7 d4 c6 O-O-O b5 Nf3 Qa5 Re1 Na6 a4 b4 Nb5 Be6 Nxd6+ Bxd6 Bxd6 Qxa4 Qe3 Rh5 Kd2 O-O-O Be5 f6 Bf4 g5 Bxg5 Rxg5 Bxa6+ Qxa6 Nxg5 fxg5 d5 Qb6 Ra1 Kb7 c4 cxd5 cxd5 a5 Rhc1 Ne7 Rc5 Bxd5 Ke1 Be6 Qxg5 Nc6 Rb5 Bc4 Qg7+ Bf7 Raxa5 Rd1+ Kxd1 Nd8 Ke1 h3 Qd4 Qxb5 Rxb5+ Kc7 gxh3 Ba2 Qa7+ Kc6 Rc5+ Kd6 Qc7+ Ke6 Qe5+ Kf7 Rc7+ Kg6 Qf5+ Kh6 Rh7#".split(" ") },
  { name: "low-skill 3 (skill 0–0)",
    san: "b4 g5 d4 d6 Bxg5 Nc6 a3 h6 Bc1 e5 e3 exd4 exd4 a6 Nf3 Nf6 h3 Rg8 g3 Qd7 c4 Qf5 Be3 Ne7 Bg2 Nh5 g4 Qd7 Nc3 a5 d5 f5 Nd4 axb4 Nce2 bxa3 gxh5 Bg7 O-O Be5 f3 f4 Nxf4 Nf5 Re1 Qg7 Qd2 Ra4 Ra2 Nh4 Kh1 Kf7 Rg1 Qg5 Nfe6 Qg3 f4 Nxg2 Qxg2 Qxg2+ Rgxg2 Bh8 Nb5 Rxg2 Nd8+ Ke8 Rxg2 a2 Rxa2 Bd4 Ne6 Rxa2 Nbxc7+ Kf7 Nxd4 Ra3 Bf2 Bd7 Ncb5 Ra2 Bg1 Bxb5 cxb5 Ra4 Be3 Ra5 Bf2 Kf6 Bh4+ Kf7 Kg2 Ra4 Ne2 Re4 Kf2 Rb4 b6 Rb5 Kf3 Rc5 Ke4 Kf8 Bf2 Ke8 f5 Kf7 Bd4 Ra5 h4 Ra2".split(" ") },
  { name: "low-skill 4 (skill 0–0)",
    san: "f4 a6 Nf3 c5 b3 e6 e3 b6 Bd3 Ra7 c4 f5 O-O g6 Bb2 e5 Bxe5 d5 Bxh8 dxc4 Be2 cxb3 a3 Be6 Ng5 Bd5 Nc3 Bxg2 Rf2 b2 Rb1 Ba8 Bf1 Nf6 Rxb2 Ng4 Qb3 Nxf2 Kxf2 h6 Ne6 Qh4+ Kg1 c4 Qd1 Bc5 d4 cxd3 Bd4 Rd7 Nxc5 bxc5 Rxb8+ Kf7 Qb3+ Rd5 Rxa8 g5 Qxd5+ Kg6 Be5 a5 Ra6+ Kh5 Bxd3 Qg4+ Qg2 gxf4 Be2 fxe3 h3 Kg5 Ne4+ Kh5 Qxg4+ fxg4 Bxg4+ Kh4 Bf6#".split(" ") },
  { name: "low-skill 5 (skill 0–1)",
    san: "d4 a5 e3 f5 h3 d5 Be2 b6 Nf3 e6 g4 Bd6 c4 Ne7 Nc3 Bb7 Bd2 Qd7 Rg1 g6 a3 O-O h4 dxc4 Bxc4 Nd5 Qb3 a4 Qc2 Qc6 Nb5 Nd7 gxf5 Ba6 Rg4 exf5 Ng5 Bxb5 Bxb5 Qxc2 Rc1 Qxb2 Bc6 Ne7 Rc3 Nxc6 Rxc6 fxg4 e4 Qxd4 Rxd6 cxd6 Bf4 Rxf4 Nxh7 Rxf2 Ng5 Re8 Nh3 Rxe4#".split(" ") },
  { name: "low-skill 6 (skill 2–1)",
    san: "Nf3 b5 h3 g5 a4 b4 Nxg5 e6 d3 Bg7 g3 Nc6 Bg2 Bb7 O-O Rb8 e4 Nge7 Nd2 Ng6 f4 f6 Ngf3 f5 Nc4 Nd4 Kh2 d5 Nxd4 O-O e5 dxc4 Nc6 cxd3 Nxb8 dxc2 Qxc2 Be4 Qc4 Bxg2 Qxe6+ Kh8 Nc6 Qd3 Kxg2 Rg8 Rf3 Qe4 Qd7 Bxe5 Qd3 Nh4+ Kf2 Qxc6 gxh4 Bf6 Rg3 Rxg3 Qxg3 h6 Qf3 Bxh4+ Kg2 Qa6 Be3 Be7 Rd1 Bh4 Kh1 Qxa4 Bd4+ Kh7 Rg1 Qd7 Be5 a6 Qg2 Qf7 b3 a5 Qa8 Bf6 Bxf6 Qf8 Qxf8 c5 Rg7#".split(" ") },
  { name: "low-skill 7 (skill 0–0)",
    san: "g3 d6 e3 Kd7 Nf3 Ke8 Nd4 e5 Nb3 Nf6 Nc3 c6 d3 g6 e4 a6 f3 Ra7 Qd2 b5 Qf2 c5 Be3 Rb7 Rc1 Bg7 Ra1 b4 Nd5 Be6 Bg5 h5 Bxf6 Bxf6 Nxf6+ Ke7 d4 Kxf6 d5 Bc8 Nd2 Nd7 b3 Rb8 a4 a5 Bb5 Ra8 Kd1 Ke7 Qe3 h4 Bc6 Rb8 Rg1 Ba6 g4 c4 bxc4 Qb6 Qg5+ f6 Qxg6 Qe3 Re1 Qf2 Bxd7 Kxd7 Qg7+ Kd8 Qxh8+ Kc7 Qh7+ Kc8 Qf5+ Kd8 Rb1 Qd4 g5 Kc7 Qh7+ Kb6 Qg6 Rc8 gxf6 Rxc4 f7 b3 f8=Q Rc3 Qb8+ Kc5 Qgxd6#".split(" ") },
  { name: "low-skill 8 (skill 2–2)",
    san: "f3 b5 b4 g5 e3 Bg7 d4 Bb7 c3 Nf6 h3 Nh5 h4 g4 fxg4 Nf6 g5 Ne4 Bd3 a5 Qg4 Nd6 Ne2 O-O Ng3 f5 Bxf5 axb4 h5 e6 Bc2 b3 Bxb3 c5 dxc5 Qc8 g6 Qxc5 Rf1 Rxf1+ Nxf1 Nc6 h6 Bxh6 Ba3 Qf5 Qxf5 Nxf5 gxh7+ Kh8 g4 Nxe3 Bc5 Nxf1 Kxf1 Bf8 Bxf8 Ne5 Bd6 Nf3 Na3 Ng5 Nxb5 Rc8 Ke1 Kxh7 Bf4 Kg6 Bc2+ Kg7 Bd1 Ne4 Nd6 Nc5 Nxc8 Nd3+ Ke2 Nxf4+ Kf2 Nd5 Nd6 Bc6 Bf3 Nxc3 Nc8 d5 Rh1 e5 Rc1 e4 Rxc3 Ba4 Ne7 d4 Nf5+ Kh7 Nxd4 Bd7 Rc7 Kg8 Ke3 Bb5 Nxb5 Kf8 g5 Ke8 g6 Kf8 Be2 Kg8".split(" ") },
  { name: "low-skill 9 (skill 1–1)",
    san: "g3 g6 Nh3 f6 c4 e5 Nc3 Nc6 e3 d6 Bg2 h5 b4 Nxb4 O-O Nh6 d4 c6 Rb1 Na6 f4 Be7 d5 O-O Nf2 Rb8 Kh1 Ng4 e4 b5 f5 bxc4 Nxg4 cxd5 Nh6+ Kg7 Rxb8 Nxb8 fxg6 Rh8 Qxh5 Qe8 Nf5+ Bxf5 Qxf5 Bd8 Bf3 Na6 Bh5 d4 Nd5 Rxh5 Qxh5 Qe6 Qh6+ Kg8 Qh7+ Kf8 Qh8+ Qg8 Bh6+ Ke8 Qxg8+ Kd7 Qf7+ Kc8 g7 Nc7 Rb1 a5 g8=R Ne8 Qb7#".split(" ") },
  { name: "low-skill 10 (skill 1–1)",
    san: "c3 b6 Nf3 Nf6 Qc2 e6 e4 Bb7 Bd3 Ng4 b4 a5 b5 f5 h3 fxe4 Bxe4 Nf6 Bxb7 c6 bxc6 Ra7 Ne5 a4 Nxd7 Bd6 Nxf6+ Qxf6 Qe4 Bg3 Kd1 Rxb7 c7 Kd7 cxb8=R Rbxb8 f3 b5 Ba3 Rb6 h4 Rc6 Rf1 h5 Rh1 Rc4 d4 Bf4 Re1 Rb8 Qd3 Qxh4 Qg6 e5 Qf7+ Kc8 Qe8+ Qd8 Rxe5 Bxe5 Qe6+ Kb7 Qxe5 Qe8 Qg5 Ka6 Bb4 h4 Bc5 Qe6 Kc2 b4 Qe7 Qxe7 Bxe7 Rbc8 Bc5 R4xc5 dxc5 h3 gxh3 Rxc5 Kd1 Rf5 f4 Rd5+ Kc2 Kb5 cxb4 Kc4 Nc3 Rd4 a3 g5 Rd1 Rxd1 Kxd1 Kb3 Nxa4 gxf4 Kd2 Kxa4 h4 Kb3 Ke2 Kb2 b5 Ka2 b6 Kb1".split(" ") },
  { name: "low-skill 11 (skill 3–1)",
    san: "e3 c5 Be2 c4 Bxc4 d5 Bb3 Nc6 Qe2 e5 d4 Nf6 dxe5 Nd7 Nc3 Bb4 Bd2 d4 exd4 Nxd4 Bxf7+ Kf8 Qh5 Nxc2+ Kf1 Bxc3 Bc4 Nxe5 Bxc3 Nxc4 Rc1 N2e3+ Ke1 Nxg2+ Kf1 Nh4 Qe2 Nb6 b3 Nd5 Qc4 Nxc3 Qxc3 Bf5 Qg3 Kg8 Ne2 h6 a3 Rc8 Ra1 Qf6 Rc1 Rd8 Rg1 Bd3 Rd1 Nf3 Rxd3 Nxh2+ Kg2 Rf8 Kxh2 Rh7 Kg2 Qc6+ f3 h5 Kh1 h4 Qh3 Qa6 Qd7 Qxd3 Qxd3 b5 Qd6 a6 Qd5+ Rf7 Rc1 g6 Nf4 Rh5 Nxh5 a5 Rc7 Kh7 Nf6+ Kg7 Rxf7+ Kh6 Rh7#".split(" ") },
  { name: "low-skill 12 (skill 1–3)",
    san: "a3 h6 c3 Nc6 b4 a6 d4 d5 g3 Bf5 Bg2 e5 dxe5 g5 f4 g4 Qxd5 Qxd5 Bxd5 f6 h3 O-O-O e4 Nce7 Ne2 fxe5 exf5 Rxd5 fxe5 Nc6 hxg4 Nxe5 Ra2 Rd7 Nd2 Nd3+ Kf1 Nf6 Nc4 Nxc1 Nxc1 Rd1+ Kg2 Rxh1 Nb3 Rd1 Re2 Rd3 b5 axb5 Nb2 Rd8 c4 b4 g5 Ne4 Nd3 Rg8 Nxb4 Nxg5 Nc6 Bxa3 Nxd8 Rxd8 Ra2 Be7 Ra5 c6 f6 Bf8 Re5 Nf7 Re7 Bxe7 fxe7 Rh8 c5 Re8 Nd2 Rxe7 Nf3 Re5 Nh4 Rxc5 Ng6 Rb5 g4 Rb4 Ne7+ Kd7 Nf5 Kc7 Kh2 Ng5 Kg3 Rb3+ Kg2 Rb2+ Kg1 b5 Ng7 Ra2 Ne8+ Kd8 Nd6 b4 Kf1 Kd7 Ne4 Ra1+".split(" ") },
];
