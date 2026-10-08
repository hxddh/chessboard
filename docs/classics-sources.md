# 名局的出处（v8-4-plan T2）

`src/web/js/classics-more.js` 的三十局，每一局的着法都从公开的 PGN 合集里取来，再和至少一份别的合集逐着对照。下面每局列出：

- **used**：着法取自的文件；
- 其余各行：对照过的文件与结果。「same moves」= 逐着相同；「first differs at ply N」= 从第 N 个半回合起不同；「same N plies, then M more」= 前 N 个半回合相同，该来源多记了 M 个半回合；「stops after ply N」= 该来源到第 N 个半回合为止都相同、之后没记。

取法与对照的规矩：

- 只用代理能直接访问的来源（raw.githubusercontent.com 上的公开仓库）。lichess.org、chessgames.com、pgnmentor.com、wikipedia 在本机代理下都连不上，没有绕道。
- 多数局取自 rozim/ChessData 的 `PgnMentor/`（pgnmentor.com 各棋手文件的镜像）。对照优先找来源不同的合集：Jan van Reem 的赛事档案（gbtami/JvR-archive，`www.endgame.nl/`）、Britbase 的黑斯廷斯档案（rozim/ChessData `Britbase/`）、frankkopp/Chessly 的 `classics.pgn` 与 `perle.pgn`、DHTMLGoodies 的 `greatgames.pgn`、scoutfish 的 `immortal_games.pgn` / `great_masters.pgn`、tsoj/chessattackingscore 的攻击名局集，以及几个单局文件。和 PgnMentor 格式一模一样的棋手文件（DHTMLGoodies、tomgp、Chesspector 的 `<棋手>.pgn`、PgnMentor 里对手的文件）多半同源，列出来但不算独立对照。
- 来源之间有分歧时，取多数来源一致的版本；终局多记或少记几步时，只收各来源都一致的部分。分歧写在各局的「note」里。
- 对照用的脚本在 scratch 里跑（逐个文件解析 PGN、用 chess.js 重放、比较半回合序列），不进仓库。进仓库的检查是 `scripts/test-classics.mjs`（重放、结果、注释位置与所引着法）和 `docs/classics-verified.json`（引擎核对，`scripts/verify-classics.mjs`）。

读棋原有的十局（`classics.js`，6.0 起）不在本表内，着法没有改动。

下面的路径都省去了前缀 `https://raw.githubusercontent.com/`。

### labourdonnais-mcdonnell-1834

- used: rozim/ChessData/master/PgnMentor/McDonnell.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same 72 plies, then 4 more — mcostalba/scoutfish/master/pgn/immortal_games.pgn
- note: scoutfish 在 36...Ne3 之后还多记了 4 个半回合；PgnMentor 与 Chessly 都止于 36...Ne3（白方认输），这里也止于此。PgnMentor 把它记作第四次对抗赛、总第 50 局。

### paulsen-morphy-1857

- used: rozim/ChessData/master/PgnMentor/Morphy.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- first differs at ply 42 (52 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/Test_PGN/perle.pgn
- same moves — rozim/ChessData/master/PgnMentor/Paulsen.pgn
- note: Chessly 的 classics.pgn 少了 21.Kg1 Bxf3+ 22.Kf1 Bg2+ 23.Kg1 这一次重复；PgnMentor、greatgames、perle 三份都有，取三份的版本。

### bird-morphy-1858

- used: rozim/ChessData/master/PgnMentor/Morphy.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn

### zukertort-blackburne-1883

- used: rozim/ChessData/master/PgnMentor/Zukertort.pgn
- first differs at ply 42 (63 plies) — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- first differs at ply 42 (65 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/Test_PGN/perle.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/lond1883.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/london.pgn
- same moves — rozim/ChessData/master/PgnMentor/Blackburne.pgn
- note: greatgames 与 Chessly 记的是 21...f6（于是 22.exf6 是普通吃兵）；PgnMentor、JvR 的两份档案与 perle 都是 21...f5 22.exf6（吃过路兵），取后者。

### chigorin-steinitz-1890

- used: rozim/ChessData/master/PgnMentor/Chigorin.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/cc-history.pgn
- same moves — rozim/ChessData/master/PgnMentor/Steinitz.pgn

### steinitz-chigorin-1892

- used: rozim/ChessData/master/PgnMentor/Steinitz.pgn
- same 55 plies, then 2 more — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same 55 plies, then 2 more — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — rozim/ChessData/master/PgnMentor/Chigorin.pgn
- same moves — mcostalba/scoutfish/master/pgn/immortal_games.pgn
- note: greatgames 与 Chessly 在 28.Qxd4+ 之后又记了 28...Kf5 29.Qf4#；PgnMentor 与 scoutfish 止于 28.Qxd4+ 黑方认输。取各来源一致的部分。

### pillsbury-lasker-1896

- used: rozim/ChessData/master/PgnMentor/Pillsbury.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves, stops after ply 62 — frankkopp/Chessly/master/src/main/resources/book/Test_PGN/perle.pgn
- same moves — rozim/ChessData/master/PgnMentor/Lasker.pgn
- note: PgnMentor 记作 1895 年（圣彼得堡 1895/96 赛事的起始年），Chessly 与 greatgames 记作 1896；这里写 1896，赛事名写 1895/96。

### pillsbury-lasker-1904

- used: rozim/ChessData/master/PgnMentor/Pillsbury.pgn
- first differs at ply 36 (59 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/cs1904.pgn
- same moves — rozim/ChessData/master/PgnMentor/Lasker.pgn
- note: Chessly 记作 18...Qb5 与 29...Kf8；PgnMentor 与 JvR 的剑桥泉赛事档案（cs1904.pgn）都是 18...Qb4、29...Kg8，取后者。

### rubinstein-lasker-1909

- used: rozim/ChessData/master/PgnMentor/Rubinstein.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/endgame.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/stp1909.pgn
- same moves — rozim/ChessData/master/PgnMentor/Lasker.pgn

### levitsky-marshall-1912

- used: rozim/ChessData/master/PgnMentor/Marshall.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/dsb.pgn

### edlasker-thomas-1912

- used: tsoj/chessattackingscore/main/data/attacking_games/HM%20ATTACK.pgn
- same moves — fsegouin/chess-gym/main/data/broadcasts/lasker-thomas-1912.pgn
- note: PgnMentor 没有这一局。tsoj 的攻击名局集与 chess-gym 的单局文件（1912-10-29，伦敦）逐着相同；chusst 与 perle 的版本开局次序不同（1.d4 f5 … 8.Bd3 Bb7 9.Ne5 O-O），第 18 个半回合之后一致；也有书把最后一步记作 18.O-O-O#（注释里写明）。

### lasker-capablanca-1914

- used: rozim/ChessData/master/PgnMentor/Lasker.pgn
- same moves — siromermer/Chesspector-app/main/assets/pgn_masters/Lasker_selected.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/stp1914.pgn
- same moves — rozim/ChessData/master/PgnMentor/Capablanca.pgn

### nimzowitsch-tarrasch-1914

- used: rozim/ChessData/master/PgnMentor/Tarrasch.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/Nimzowitsch.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/stp1914.pgn
- same moves — rozim/ChessData/master/PgnMentor/Nimzowitsch.pgn
- same moves — tomgp/chess-canvas/master/pgn/Nimzowitsch.pgn

### bogoljubov-alekhine-1922

- used: rozim/ChessData/master/PgnMentor/Alekhine.pgn
- same moves — siromermer/Chesspector-app/main/assets/pgn_masters/Alekhine_selected.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- first differs at ply 101 (106 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — rozim/ChessData/master/PgnMentor/Bogoljubow.pgn
- first differs at ply 101 (106 plies) — rozim/ChessData/master/Old/old.pgn
- note: 第 51 步分两派：PgnMentor、greatgames（及同源的 Chesspector）记 51.Kf2，rozim 的 Old/old.pgn 与 Chessly 记 51.Ke2。两种走法在 52.Ke3 之后是同一个局面，这里用 PgnMentor 的 51.Kf2，开场白里写明。

### saemisch-nimzowitsch-1923

- used: rozim/ChessData/master/PgnMentor/Nimzowitsch.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/Nimzowitsch.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- first differs at ply 49 (50 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/nimzowitsch.pgn
- same moves — mcostalba/scoutfish/master/pgn/great_masters.pgn
- same moves — tomgp/chess-canvas/master/pgn/Nimzowitsch.pgn
- note: Chessly 记作 25.Rge1；PgnMentor、JvR、greatgames、great_masters 都是 25.Rce1，取后者。great_masters.pgn 的 Result 标签误写成 1-0，着法相同。

### reti-capablanca-1924

- used: rozim/ChessData/master/PgnMentor/Reti.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/NewYork24.pgn
- same moves — rozim/ChessData/master/PgnMentor/Capablanca.pgn

### capablanca-tartakower-1924

- used: rozim/ChessData/master/PgnMentor/Capablanca.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/NewYork24.pgn
- same moves — rozim/ChessData/master/PgnMentor/Tartakower.pgn

### torre-lasker-1925

- used: rozim/ChessData/master/PgnMentor/Lasker.pgn
- same moves — siromermer/Chesspector-app/main/assets/pgn_masters/Lasker_selected.pgn
- same moves — tsoj/chessattackingscore/main/data/attacking_games/Attacking%20the%20King%20and%20the%20Kings%20of%20the%20attack.pgn

### reti-alekhine-1925

- used: rozim/ChessData/master/PgnMentor/Reti.pgn
- same moves — oriolarcas/chusst/main/pgn2yaml/games/Richard%20Reti_vs_Alexander%20Alekhine_1925.pgn
- same 80 plies, then 4 more — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- first differs at ply 39 (84 plies) — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/Alekhine.pgn
- same 80 plies, then 4 more — rozim/ChessData/master/PgnMentor/Alekhine.pgn
- same moves, stops after ply 63 — mcostalba/scoutfish/master/pgn/great_masters.pgn
- same moves — tsoj/chessattackingscore/main/data/attacking_games/Attacking%20Themes.pgn
- note: PgnMentor 与 greatgames 在 40...Nd4 之后多记 41.Rf2 Nxf3+ 42.Rxf3 Bd5；JvR、chusst、tsoj 三份止于 40...Nd4。这里只收五份都一致的前 80 个半回合（开场白写明）。Chessly 在第 20 步多了一次 Bg2 Bh3 Bf3 Bg4 的重复，不取。

### alekhine-nimzowitsch-1930

- used: rozim/ChessData/master/PgnMentor/Alekhine.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/Nimzowitsch.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- first differs at ply 60 (60 plies) — gbtami/JvR-archive/master/www.endgame.nl/Alekhine.pgn
- same moves — rozim/ChessData/master/PgnMentor/Nimzowitsch.pgn
- same moves — tomgp/chess-canvas/master/pgn/Nimzowitsch.pgn
- note: JvR 的 Alekhine.pgn 在第 30 步记作 30...Qe8 并提前结束；PgnMentor、Chessly、greatgames 系的文件都是 30...h5 31.Kh2 g6 32.g3，取后者。

### sultankhan-capablanca-1930

- used: rozim/ChessData/master/PgnMentor/Capablanca.pgn
- same moves — rozim/ChessData/master/Britbase/pghast30.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- note: Britbase 的 pghast30.pgn 记的日期是 1930-12-31（黑斯廷斯 1930/31）。

### menchik-euwe-1931

- used: rozim/ChessData/master/PgnMentor/Euwe.pgn
- same moves — rozim/ChessData/master/Britbase/pghast30.pgn
- first differs at ply 29 (57 plies) — rozim/ChessData/master/PgnMentor/Bogoljubow.pgn
- note: 第二份来源是 Britbase 的黑斯廷斯档案（pghast30.pgn，1931-12-29）。

### alekhine-lasker-1934

- used: rozim/ChessData/master/PgnMentor/Alekhine.pgn
- same moves — rozim/ChessData/master/PgnMentor/Lasker.pgn
- same moves — tsoj/chessattackingscore/main/data/attacking_games/Attacking%20Themes.pgn

### euwe-alekhine-1935

- used: rozim/ChessData/master/PgnMentor/Euwe.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/euwem.pgn
- same moves — rozim/ChessData/master/PgnMentor/Alekhine.pgn

### botvinnik-vidmar-1936

- used: MenaceSan/DotChess/master/DotChess/Games/Mikhail%20Botvinnik%20vs%20Milan%20Vidmar.pgn
- same moves — AlwaysLearningNewStuff/Chess/main/From_0_to_2K_ELO/PAWN%20STRUCTURES/ISOLATED_PAWN/ILLUSTRATIVE_GAMES/USING%20ISOLANI/KINGSIDE%20ATTACK/botvinnik_vidmar_1936.pgn
- note: PgnMentor 的次序是 4.Bg5 Be7 5.Nc3；DotChess 与 AlwaysLearningNewStuff 两份单局文件是 4.Nc3 Be7 5.Bg5，第 5 步之后完全相同，取两份一致的次序（开场白写明）。

### keres-alekhine-1937

- used: rozim/ChessData/master/PgnMentor/Keres.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — rozim/ChessData/master/PgnMentor/Alekhine.pgn

### botvinnik-capablanca-1938

- used: rozim/ChessData/master/PgnMentor/Botvinnik.pgn
- same moves — DHTMLGoodies/dhtmlchess/master/pgn/greatgames.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/avro1938.pgn
- same moves — rozim/ChessData/master/PgnMentor/Capablanca.pgn
- same moves — mcostalba/scoutfish/master/pgn/immortal_games.pgn

### fine-botvinnik-1938

- used: rozim/ChessData/master/PgnMentor/Fine.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — gbtami/JvR-archive/master/www.endgame.nl/avro1938.pgn
- same moves — rozim/ChessData/master/PgnMentor/Botvinnik.pgn

### smyslov-kottnauer-1946

- used: rozim/ChessData/master/PgnMentor/Smyslov.pgn
- same moves — frankkopp/Chessly/master/src/main/resources/book/PNG_Openings/classics.pgn
- same moves — mcostalba/scoutfish/master/pgn/great_masters.pgn

### botvinnik-keres-1948

- used: rozim/ChessData/master/PgnMentor/Botvinnik.pgn
- same moves — rozim/ChessData/master/PgnMentor/Keres.pgn
- same moves — tsoj/chessattackingscore/main/data/attacking_games/Attacking%20Themes.pgn
