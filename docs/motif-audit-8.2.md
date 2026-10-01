# 长将与困子重抽（v8-2-plan T5）

8.1 的母题抽样（`docs/motif-audit-8.1.md`）里，长将、困子各 25 条错 3 条（12%），照 B3 的规矩回退成只说子力得失（`explain.js MATERIAL_ONLY`）。这一轮改了 `motif.js` 的两个检测器，用同一套办法重新抽样、重新判。两种都是 25 条错 0 条，恢复说出母题。其余 17 种母题没有动，表里照抄 8.1 的样本和判定。

## 检测器改了什么

- **长将**（`dPerpetual`）。8.1 的条件是：失着前走棋方 ≥ +150，失着后评估在 ±15 之内，线上攻方每步都将军。错的三条，王都能从将军里走出去（…Kf8 Rxh7），或者根本不是和棋。
  - 现在另要在棋盘上**证明**能重复：线上第一步将军之后，对方每一种应着，攻方都有一步将军接得上；照这样走下去，总会回到已经出现过的局面。
  - 证明用迭代加深，先试两次将军内的循环，最多六次将军，最多看 2,000 个局面。在 node 里最坏约 0.5 秒，只在前面三个条件都满足时才跑。
  - 「重复」认的是同一摆法、同一方走。
- **困子**（`dTrapped`）。错的三条都是后被钉在王前（…Qxd4 Bc5、…Qxe6 Bd5、…Qxf5 Bh3）：被钉住的子能走的那几步当然都丢。
  - 现在要是这个子不顾王时能走的着比合法着多，就不算困子；这和 oracle 里早就写着的「被钉在王前是牵制」是同一条。
  - 「每个去处都会丢子」的判法不变：对方能以小吃大，或者那一格没有保护。

8.1 的回退名单在新代码下重读（`sample-motifs.mjs explain`，用存下的引擎线，不重跑引擎）：

- 说成长将的 42 条只剩 7 条；
- 说成困子的 100 条剩 48 条，去掉的 52 条全是「后被钉住、象一挡」的形状；
- 其余 17 种母题一条也没变。

8.1 判错的六条都不再说成这两个母题（`test-explain.mjs`，改前六条全红）。

长将剩得太少，不够抽 22 条，于是补跑了 app 的复盘：

- 用的是 Lichess 谜题库里「解法里攻方步步将军、主题是 equality」的行，全库 1,557 行，`scan --shapes --k=1500` 取了 1,500 行；
- 去掉 8.1 已经试过的，按顺序跑了 449 行，又找到 25 条；
- 找到 32 条就停了，没把候选行全跑完。

## 怎么量的

和 8.1 完全一样，见 `docs/motif-audit-8.1.md`「怎么量的」：

- app 的预算是 270,000 节点、MultiPV 3；
- 判定是 1,000,000 节点的深搜，判定规则（`scripts/lib/motif-oracle.mjs`）一字未改；
- 每个母题按固定种子取 25 条，仓库对局优先。

具体到这两种：

- **困子**：从 8.1 那批 app 结果（重读后）说成困子的 48 条里取 25 条，其中 12 条也在 8.1 的样本里，13 条第一次判；
- **长将**：从重读后的 7 条加上补跑的 25 条里取 25 条，其中 5 条也在 8.1 的样本里。

**人工复核**：

- 每种抽读了 3 条，没有要推翻 oracle 的；
- 长将读的是 1ojpm（♖g4+ Kf3 ♖g3+ Ke4 ♖g4+，深搜同一条线）、DxJFQ（♜d1+ Kh2 ♜d2+ Kh1 ♜d1+）、1VSCb；
- 困子读的是 coach-games 的 low-skill 2 第 34 手（f4 的象，g5 之后 e5 / g3 / d6 / c7 / b8 每格都丢）、InBCu、QEFPF。

**还要记一笔**：新的长将要的是「将得下去、回得来」，比 oracle 的规则（失着后深搜是和棋，深搜线上前 8 步攻方步步将军）严。8.1 那 42 条里 oracle 判对的 39 条，大多数在棋盘上证明不了；有的是王走得出去，有的是不将军也和。这些现在只说子力或更好的着，不再说「起长将」。

`node scripts/sample-motifs.mjs report --in=<8.1 其余 17 种的判定 + 这两种的新判定> --named=… --record --fixture=scripts/fixtures/motif-sample.json --doc=docs/motif-audit-8.2.md --doc-motifs=perpetual,trapped` 把下表写进 `docs/measured.json motifPrecision`。表只列这一轮重抽的两种；其余 17 种的案例见 8.1 的文档。

<!-- sample:begin -->

| 母题 | 抽样 | 错 | 错误率 | 结果 |
|---|---|---|---|---|
| hanging | 25 | 0 | 0% | 保留 |
| perpetual | 25 | 0 | 0% | 保留 |
| double | 25 | 0 | 0% | 保留 |
| discovered | 25 | 0 | 0% | 保留 |
| discoveredAttack | 25 | 0 | 0% | 保留 |
| fork | 25 | 1 | 4% | 保留 |
| zwischenzug | 25 | 0 | 0% | 保留 |
| desperado | 25 | 1 | 4% | 保留 |
| removeDefender | 25 | 0 | 0% | 保留 |
| overload | 22 | 0 | 0% | 保留 |
| deflection | 25 | 1 | 4% | 保留 |
| decoy | 23 | 0 | 0% | 保留 |
| pin | 25 | 0 | 0% | 保留 |
| skewer | 25 | 1 | 4% | 保留 |
| xray | 25 | 0 | 0% | 保留 |
| trapped | 25 | 0 | 0% | 保留 |
| mateThreat | 25 | 0 | 0% | 保留 |
| promotion | 25 | 0 | 0% | 保留 |
| backRank | 25 | 0 | 0% | 保留 |

### perpetual

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。失着前深搜对走棋方 ≥ +150，失着后深搜在 ±30 之内；深搜线里攻方每一步都是将军，至少两步。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [1ojpm](https://lichess.org/buSFsZeL/black#56) | ?? | `8/2p3p1/2p1p3/b2p1k1P/P2P1P2/2r1N3/3K3P/6R1 b - - 1 28` | Kxf4 | 让对方 ♖g4+ 起长将 | 对 | 失着前 -459，之后 0，深搜线步步将军 |
| 2 | [4Vddg](https://lichess.org/ops2AqOz/black#60) | ?? | `8/4Q1kp/p5p1/1p1q1p2/8/7P/PPr2PP1/6K1 b - - 3 30` | Kh8 | 让对方 ♕f8+ 起长将 | 对 | 失着前 -573，之后 0，深搜线步步将军 |
| 3 | [5On7j](https://lichess.org/MLr8impt/black#50) | ?? | `5rk1/4bpp1/p3pn1Q/2p1B3/r7/3P1q1P/1PP2P1K/1R4R1 b - - 0 25` | g6 | 让对方 ♖xg6+ 起长将 | 对 | 失着前 -911，之后 0，深搜线步步将军 |
| 4 | [1a4k2](https://lichess.org/SfQOWae8/black#74) | ?? | `2kr4/p6R/1pN1p3/1PnpP3/2n5/2P5/KP3r2/1R6 b - - 6 37` | Rdf8 | 让对方 ♘xa7+ 起长将 | 对 | 失着前 -394，之后 0，深搜线步步将军 |
| 5 | [7br8y](https://lichess.org/YgUmrzei/black#58) | ?? | `r4rk1/2q2p2/4p2Q/1R6/p2pn3/3P3P/2P2PP1/6K1 b - - 0 29` | Rab8 | 让对方 ♖g5+ 起长将 | 对 | 失着前 -999，之后 0，深搜线步步将军 |
| 6 | [0WJBy](https://lichess.org/WhKGRDip/black#64) | ?? | `rk5r/pp2b1p1/4Bn1p/8/7q/1P3P2/P1Q4P/2R4K b - - 3 32` | a5 | 让对方 ♕c7+ 起长将 | 对 | 失着前 -632，之后 0，深搜线步步将军 |
| 7 | [xnif2](https://lichess.org/rUExkSWV/black#46) | ?? | `r1b3k1/pp4bp/2n3p1/4p1N1/P2P4/B1p1PB1q/2P2R2/R2K4 b - - 1 23` | Qh4 | 让对方 ♗d5+ 起长将 | 对 | 失着前 -721，之后 0，深搜线步步将军 |
| 8 | [2DAvb](https://lichess.org/z8k3ed4R/black#62) | ?? | `4rrk1/p2q1pp1/1p6/2b3R1/7Q/1P2p2P/P5PN/2R4K b - - 3 31` | e2 | 让对方 ♖xg7+ 起长将 | 对 | 失着前 -522，之后 0，深搜线步步将军 |
| 9 | [03FL5](https://lichess.org/ifsXHnPY/black#66) | ?? | `5r2/p1q2p1k/5Q1p/3p1N2/8/1P5P/P4KP1/4r3 b - - 1 33` | Qe5 | 让对方 ♕xh6+ 起长将 | 对 | 失着前 -1425，之后 0，深搜线步步将军 |
| 10 | [EFmqu](https://lichess.org/gNkLskCK/black#58) | ?? | `2krr3/1pp3RR/p7/5p2/2b5/4n3/P3B1P1/2K5 b - - 1 29` | Bxe2 | 让对方 ♖xc7+ 起长将 | 对 | 失着前 -664，之后 0，深搜线步步将军 |
| 11 | [3asDC](https://lichess.org/EUG1emWC#97) | ?? | `2k5/8/8/6RP/4p3/4NnP1/5PK1/1r6 w - - 1 49` | Rg4 | 让对方 ♜g1+ 起长将 | 对 | 失着前 548，之后 0，深搜线步步将军 |
| 12 | [DxJFQ](https://lichess.org/rEg51nkx#71) | ?? | `4r3/5R2/3p2p1/p2r2P1/5P2/1P3k1P/P3R3/6K1 w - - 5 36` | Rxe8 | 让对方 ♜d1+ 起长将 | 对 | 失着前 409，之后 0，深搜线步步将军 |
| 13 | [EOv4j](https://lichess.org/PMNR8ShS#61) | ?? | `8/1p4rk/1p1Q4/4nR1p/5p1q/5P2/PPP3P1/5RK1 w - - 4 31` | Qxe5 | 让对方 ♜xg2+ 起长将 | 对 | 失着前 578，之后 0，深搜线步步将军 |
| 14 | [F00UM](https://lichess.org/QHI1BIMq/black#50) | ?? | `r4rk1/1p1b1q1p/4p1RQ/p1p1P3/2BnpP2/1P6/P4P1P/2K3R1 b - - 0 25` | hxg6 | 让对方 ♖xg6+ 起长将 | 对 | 失着前 -380，之后 0，深搜线步步将军 |
| 15 | [18317](https://lichess.org/PzwxNeUE/black#88) | ?? | `2rr4/4Q3/2p5/1p1k4/1P2p1p1/5qP1/PB5P/6K1 b - - 0 44` | e3 | 让对方 ♕e5+ 起长将 | 对 | 失着前 -1570，之后 0，深搜线步步将军 |
| 16 | [3Zscr](https://lichess.org/3SxfLgv2#65) | ?? | `5r2/3N3p/p2pQ1pk/8/3pPq1P/1r3P1K/PP4P1/R6R w - - 0 33` | Nxf8 | 让对方 ♜xf3+ 起长将 | 对 | 失着前 1086，之后 0，深搜线步步将军 |
| 17 | [DxwJB](https://lichess.org/uE8n5AS5#57) | ?? | `3q3k/6rp/2Rp4/1p5r/1P3p2/2P2P2/6PP/3Q1R1K w - - 0 29` | Rxd6 | 让对方 ♜xh2+ 起长将 | 对 | 失着前 489，之后 0，深搜线步步将军 |
| 18 | [1VSCb](https://lichess.org/ocyBdOag#93) | ?? | `8/2RQ1pk1/5qp1/3P4/6pP/4P3/5PK1/8 w - - 0 47` | Kg3 | 让对方 ♛f3+ 起长将 | 对 | 失着前 955，之后 0，深搜线步步将军 |
| 19 | [EX4tj](https://lichess.org/LQuCh8lt/black#42) | ?? | `r2q1rk1/1np1b1p1/3pb2B/p2Ppp1Q/1Pp1N3/7P/P1B2PP1/R5K1 b - - 0 21` | gxh6 | 让对方 ♕g6+ 起长将 | 对 | 失着前 -652，之后 0，深搜线步步将军 |
| 20 | [6InTr](https://lichess.org/bep0K4P5#65) | ?? | `6k1/4Rp2/p2p2pp/1p3q2/3b4/PP1N1b1P/2Q3P1/3R3K w - - 0 33` | gxf3 | 让对方 ♛xh3+ 起长将 | 对 | 失着前 517，之后 0，深搜线步步将军 |
| 21 | [AwByz](https://lichess.org/IVRmGThD/black#74) | ?? | `3r4/pkq4p/b3p3/8/B7/5Q1P/P4PP1/6K1 b - - 6 37` | Kc8 | 让对方 ♕a8+ 起长将 | 对 | 失着前 -582，之后 0，深搜线步步将军 |
| 22 | [GL9I2](https://lichess.org/HnMdI9YP/black#44) | ?? | `6rk/pbp2p1p/1pq2p2/8/5Q2/1P3P2/P1P3PP/5RK1 b - - 2 22` | Qxc2 | 让对方 ♕xf6+ 起长将 | 对 | 失着前 -537，之后 0，深搜线步步将军 |
| 23 | [34Bax](https://lichess.org/LlVoJmJA/black#74) | ?? | `7k/2p3pp/1p2B1p1/8/8/pP6/P2RK3/q7 b - - 8 37` | h6 | 让对方 ♖d8+ 起长将 | 对 | 失着前 -758，之后 0，深搜线步步将军 |
| 24 | [Z9vWU](https://lichess.org/7XMQWpK7/black#90) | ?? | `8/5pkp/8/1N4p1/3Q4/2N2K2/1r6/q7 b - - 4 45` | Kg8 | 让对方 ♕d8+ 起长将 | 对 | 失着前 -426，之后 0，深搜线步步将军 |
| 25 | [FA2Lx](https://lichess.org/nKR5ZYQT#75) | ?? | `6rk/3N3p/p1p2pq1/4p3/2P2p2/PPQ2P1P/3R2PK/8 w - - 6 38` | Nxe5 | 让对方 ♛g3+ 起长将 | 对 | 失着前 516，之后 0，深搜线步步将军 |

### trapped

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步是不吃子、不将军的一步；它打到的某个 ≥ 3 分的子原地和每一个去处都会被得子地吃掉，而且不是因为被钉在王前（那是牵制）；深搜线里吃到了这种子，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | low-skill 2 (skill 2–1) ply 34 | ? | `2kr2n1/p5p1/n1p1bp2/4B2r/qp1PP2p/4QN2/1PPK2PP/4RB1R w - - 0 18` | Bf4 | 漏看了 g5 困子，丢象 | 对 | f4 的子无处可逃，深搜吃到，净得 2 |
| 2 | [InBCu](https://lichess.org/mMfOIKSv#33) | ?? | `rn2kr2/3bpp1Q/2pP2p1/pp6/3q2PP/2N2P1R/PPP5/2K2RN1 w q - 0 17` | dxe7 | 漏看了 ♜h8 困子，丢后 | 对 | h7 的子无处可逃，深搜吃到，净得 3 |
| 3 | [DbLXw](https://lichess.org/SFywzDhk/black#146) | ?? | `8/8/1p2k3/pP1p4/P2P4/2K5/1n2N3/8 b - - 23 73` | Nxa4+ | 漏看了 ♔b3 困子，丢马 | 对 | a4 的子无处可逃，深搜吃到，净得 2 |
| 4 | [GW4qb](https://lichess.org/3BoZYp02/black#42) | ?? | `1kbr2r1/pp5p/2n1pp1q/P2p4/2pP4/2P2NP1/1QP2PP1/1R2RBK1 b - - 0 21` | Nxa5 | 漏看了 ♕b5 困子，丢马 | 对 | a5 的子无处可逃，深搜吃到，净得 2 |
| 5 | [Qz932](https://lichess.org/BpdEsZkf/black#48) | ?? | `r5k1/1b3pp1/n4p1p/p2P4/1p2P3/4Q1Pq/4BP1N/2R3K1 b - - 1 24` | Rc8 | 漏看了 ♗g4 困子，丢后 | 对 | h3 的子无处可逃，深搜吃到，净得 6 |
| 6 | [QEFPF](https://lichess.org/UQ0MMD6D#31) | ?? | `r4rk1/2q1b1pp/pp2p3/1bppPp2/3P4/P1P1QN2/1P1N1PPP/R4RK1 w - - 0 16` | Rfe1 | 漏看了 f4 困子，丢后 | 对 | e3 的子无处可逃，深搜吃到，净得 6 |
| 7 | [HTyrm](https://lichess.org/5WpvltFy#33) | ?? | `r2q1rk1/pp2bppp/4p3/2p1N3/2PP2P1/3QPR1P/PP6/R5K1 w - - 0 17` | Raf1 | 漏看了 f6 困子，丢马 | 对 | e5 的子无处可逃，深搜吃到，净得 3 |
| 8 | [WQ29y](https://lichess.org/IZ6ncWvG/black#80) | ?? | `7k/pp5p/2p1r1p1/q4p2/3pP3/3P1P2/PPK2N2/4R1R1 b - - 9 40` | Qxa2 | 漏看了 ♖a1 困子，丢后 | 对 | a2 的子无处可逃，深搜吃到，净得 3 |
| 9 | [td7kK](https://lichess.org/BTQfcOVY#51) | ?? | `8/1p1n2bp/p1p1k3/7B/4p3/1P2B2P/P1P3P1/6K1 w - - 2 26` | Be8 | 漏看了 ♞f6 困子，丢象 | 对 | e8 的子无处可逃，深搜吃到，净得 2 |
| 10 | [8njxf](https://lichess.org/IRz0tdda#33) | ?? | `3qr1k1/2p2ppp/p1p1bn2/1rbp3P/3Q2P1/1P1P1P2/PBPN4/2KR1B1R w - - 3 17` | Qc3 | 漏看了 d4 困子，丢后 | 对 | c3 的子无处可逃，深搜吃到，净得 6 |
| 11 | [Mveds](https://lichess.org/EyhMUYgJ/black#86) | ?? | `4r1k1/pbr3p1/1p2p1Np/5p1q/P2P4/6R1/3Q2P1/5BK1 b - - 3 43` | Rf7 | 漏看了 ♗e2 困子，丢后 | 对 | h5 的子无处可逃，深搜吃到，净得 6 |
| 12 | [hG0XR](https://lichess.org/upva4dYn/black#12) | ?? | `rnb1k1nr/pppp1ppp/4p3/1P6/Pb6/2N5/1qPPPPPP/1R1QKBNR b Kkq - 3 6` | Qa3 | 漏看了 ♖b3 困子，丢后 | 对 | a3 的子无处可逃，深搜吃到，净得 4 |
| 13 | [6SbkF](https://lichess.org/43Lq0UDx/black#60) | ?? | `3r2k1/5p1p/p3p1n1/6Bq/2P1Q3/4P2N/5PPK/8 b - - 1 30` | Rd2 | 漏看了 g4 困子，丢后 | 对 | h5 的子无处可逃，深搜吃到，净得 6 |
| 14 | [h0cAK](https://lichess.org/0GP3dsTi/black#42) | ?? | `2r1r1k1/pp1b1pbp/3p2p1/P2P4/4PP2/3R1N1P/1P2NqP1/2BQ3K b - - 0 21` | Bb5 | 漏看了 ♗e3 困子，丢后 | 对 | f2 的子无处可逃，深搜吃到，净得 9 |
| 15 | [nsE4c](https://lichess.org/DQsjg8Ms/black#14) | ?? | `rn2k1nr/pp2ppbp/1qpp2p1/8/3PPPb1/P1N1BN2/1PP3PP/R2QKB1R b KQkq - 0 7` | Qxb2 | 漏看了 ♘a4 困子，丢后 | 对 | b2 的子无处可逃，深搜吃到，净得 3 |
| 16 | [YMkVl](https://lichess.org/FXTMmMXT/black#40) | ?? | `r4rk1/5pp1/p1pR1b1p/4p3/2Q1P3/2N2P2/PPP2qPP/3R3K b - - 2 20` | Qxc2 | 漏看了 ♖6d2 困子，丢后 | 对 | c2 的子无处可逃，深搜吃到，净得 3 |
| 17 | [IJHAa](https://lichess.org/JleskwqU/black#30) | ?? | `2kr3r/p1ppnppp/1p2p3/4P3/3PQ1P1/2P3P1/PP6/R1B1KNq1 b Q - 0 15` | Nd5 | 漏看了 ♗e3 困子，丢后 | 对 | g1 的子无处可逃，深搜吃到，净得 6 |
| 18 | [AAtLu](https://lichess.org/9Ub7t6a8#51) | ?? | `r2q1r2/1p2b1pk/4p2p/p2pPp1Q/P2P4/1BP4P/1P4P1/R4R1K w - - 1 26` | Rf3 | 漏看了 g6 困子，丢后 | 对 | h5 的子无处可逃，深搜吃到，净得 8 |
| 19 | [Xmafq](https://lichess.org/nOlAv0oC/black#18) | ?? | `r3kb1r/ppp1pppp/2n2n2/7b/2PPq3/4BN1P/PP3PP1/R2QKBNR b KQkq - 2 9` | e5 | 漏看了 ♗d3 困子，丢后 | 对 | e4 的子无处可逃，深搜吃到，净得 8 |
| 20 | [mxN7u](https://lichess.org/THlEWvRo#51) | ?? | `7r/4bkp1/2q2n2/1N1p2Q1/3PpB1p/2P5/5PPP/1R4K1 w - - 0 26` | h3 | 漏看了 ♜h5 困子，丢后 | 对 | g5 的子无处可逃，深搜吃到，净得 4 |
| 21 | [wk6Zh](https://lichess.org/97JX7tCR/black#50) | ?? | `r3r1k1/1p1n1ppp/pP6/P2p1b1n/2pP3q/5P2/1RPBN1BP/2Q2K1R b - - 7 25` | Re6 | 漏看了 ♗g5 困子，丢后 | 对 | h4 的子无处可逃，深搜吃到，净得 5 |
| 22 | [JpIEG](https://lichess.org/4agmPHzF/black#24) | ?? | `r1b1r1k1/ppp2ppp/1bnp1qn1/8/1P1NP3/N1P1B1P1/P2Q1PBP/R4RK1 b - - 2 12` | Nce5 | 漏看了 ♗g5 困子，丢后 | 对 | f6 的子无处可逃，深搜吃到，净得 6 |
| 23 | [quYK5](https://lichess.org/URHOb1tz/black#28) | ?? | `rn2kb1r/pp2pppp/2p5/7P/2P1q3/8/PP1BBPP1/R2QK2R b KQkq - 1 14` | Qxg2 | 漏看了 ♗f3 困子，丢后 | 对 | g2 的子无处可逃，深搜吃到，净得 3 |
| 24 | [CNSqa](https://lichess.org/jgLexbyd/black#20) | ?? | `rn1q1rk1/pp2bppp/5n2/2pP4/2B3b1/2NQ1N2/PP3PPP/R1B2RK1 b - - 4 10` | Nbd7 | 漏看了 d6 困子，丢象 | 对 | e7 的子无处可逃，深搜吃到，净得 2 |
| 25 | [PZ9Gu](https://lichess.org/7ZTxUbyf#27) | ?? | `3r1rk1/ppq1bpp1/2p2n1p/4pb2/Q1P5/2N1PN1P/PP2BPP1/3R1RK1 w - - 6 14` | Qxa7 | 漏看了 ♜a8 困子，丢后 | 对 | a7 的子无处可逃，深搜吃到，净得 5（深搜在失着后局面上的主线） |

<!-- sample:end -->
