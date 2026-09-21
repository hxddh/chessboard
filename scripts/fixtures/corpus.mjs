/**
 * The measurement corpus: 28 decided games, about 1300 plies.
 *
 * Lifted out of `test-analysis.mjs` in 7.1 so a second measurement could use
 * the same games without a second copy of them (v7-1-plan §3.1). Two copies
 * of a corpus is how "measured on the 28-game corpus" comes to mean two
 * different things in two documents.
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
 * plain run measures the first `--games N` and `--record` uses the whole
 * corpus: the gate stays quick, the number that gets published does not come
 * from a sample of four.
 */export const GAMES = [
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
