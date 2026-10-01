# 母题精度抽样（v8-1-plan T6）

B3（`docs/coach-audit-8.0.md`）在 40 局上只量得出 4 个母题的精度：挂着的子、捉双、闪击、绝望子，其余 15 个一次都没被说出来。这一轮给 19 个母题每个至少 20 条真实对局里的样本，逐条判对错；错误率超过 5% 的母题照 B3 的规矩回退到只说子力得失（`explain.js MATERIAL_ONLY`）。

> v8-2-plan T5：长将、困子改了检测器之后重抽，各 25 条错 0 条，已经恢复说出母题，见 `docs/motif-audit-8.2.md`。这份文档里这两种的样本和 12% 出自 8.1 的旧检测器；`docs/measured.json motifPrecision` 现在记的是 8.2 的数字。

## 怎么量的

- **样本从哪来**：全是真实对局。
  - Lichess 谜题库（database.lichess.org，CC0，2026-09 的导出，6,100,952 行）。每一行是一盘真实对局里的局面，外加对局里真的走出的那一步（`Moves` 的第一步）——谜题就是从这步失着里生出来的。按 Lichess 主题各抽 600 行、全库均匀抽 6,000 行；稀有母题再按解法的形状（前三步谁在哪一格吃了什么、整题是不是杀）各抽 400 行（候选行没有全部试完：主题组每组试了前 250 行，形状组试到这个母题够数为止）。主题和形状只决定**试哪些行**：一行算不算某个母题的样本，看的是 app 自己说了什么，app 从不读 Lichess 的主题。
  - 仓库里的对局：`scripts/fixtures/corpus.mjs`（28 局）、`coach-games.mjs`（12 局低档引擎对局）、`src/sync-fixtures/` 里同步下来的 Lichess / Chess.com 样本。
- **app 怎么说**：照复盘的做法重跑。失着前后两个局面就是复盘要加深的位置（`review-grade.js deepTargets`），所以都按加深的预算搜：600 ms 当量 = 270,000 节点、MultiPV 3、每次先 `ucinewgame`，主变留 5 步（`review-pass.js`）；标成 `?` / `??` 的才算失着；`explain.js` 的调用和 `review/retry.js mistakeFacts()` 一样。句子说出了哪个母题（`explainMotif`），这一条就是那个母题的样本。
- **试了多少**：谜题库 3,646 行（app 标成 `?` / `??` 的 3,488 行），仓库和同步样本 54 盘对局里的 324 手 `?` / `??`；合计 3,812 手失着，1,606 句说出了母题（`measured.json motifPrecision.tried`，每个母题说出了几次在 `found`）。样本 470 条里 11 条来自仓库对局。那 54 盘棋一共说出 86 次母题（挂着的子 55、捉双 12，其余 19 次散在 9 个母题），稀有母题只能从谜题库里找；而且整盘重跑最慢，跑完时挂着的子、捉双等母题的样本已经抽定，「仓库对局优先」只对后抽的母题起了作用。
- **抽哪几条**：每个母题从说出它的全部案例里按固定种子取 25 条（仓库对局优先），不足 25 条的全取——过载一共只说出 22 次、引入 23 次，全部在样本里。一个母题的样本在它开始判定时抽定，之后再找到的案例不再换进来。
- **怎么判**：`scripts/lib/motif-oracle.mjs`。用 1,000,000 节点的深搜（app 加深预算的 3.7 倍；B3 的 oracle 是 7.5 倍，这里 470 条、每条 2–4 次搜索，在共用的机器上 2,000,000 节点跑不完）核对三件事：所说的那步棋站得住；母题的几何在棋盘上成立（这些事实在 oracle 里另写，不调用 `motif.js`）；「那步棋 + 深搜自己的后续」真的兑现了母题——吃到了母题说的那个子、或将死，并且得到了该得的子力。每个母题的规则写在下面各节的开头。整句（含「丢什么」「更好的是什么」）另用 B3 的 `coach-oracle.mjs` 判一遍，记在 `scripts/fixtures/motif-sample.json` 里，但错误率算的是母题。
- **人工复核**：oracle 判错的每一条都摆棋盘读过；判对的每个母题抽读 3 条。读下来推翻 oracle 的，写进 `motif-oracle.mjs HUMAN`，表里标「人工：」。

`node scripts/sample-motifs.mjs report --record` 把下表写进 `docs/measured.json` 的 `motifPrecision`；`scripts/test-explain.mjs` 读 `motif-sample.json`，核对回退名单就是表里超过 5% 的那些，且每条样本在现在的代码下仍说出（或不再说出）同一个母题。

**规则是读案例读出来的，所有案例按同一套规则判**：第一版规则判出的错，逐条摆棋盘读，读出规则本身不对的地方就改规则，再用存下的深搜结果把全部 470 条重判一遍（`sample-motifs.mjs rejudge`，不重跑引擎）。改过的几处：

- 「净得」原来数满四步就停，数不到将军之后才兑现的得子（…Kd8 Qxe8+ Kxe8 Nxd6+ Kd7 Nxf5）；现在将军和应将也算「还在进行」。
- 深搜的主变常被置换表截短（…Nf3+ Kf1 Qg1+ 就没了）：失着后局面上深搜自己的主变若以同一步开头，也算一条深搜线；「将死」也认深搜的杀棋分数。
- 捉双：吃回失着刚吃掉的子不算「白吃」（34…Rxc7 Qxf5+ 是拿回车，赢的是同时被打到的马）；被打到的子由别的子吃掉也算兑现（Qxe5+ … Qxd8+ Rxd8 Nxb5）。
- 牵制：被钉住的子沿着牵制线走开后被吃（…Bh4 Qxh4 Rxh4），或者离开线、身后的子被吃（…Qxc3 bxc3 Rxb1），都算兑现。
- 串击：前面的子走不开、在原地被吃也算；但这一步本身是将军时不算（…Qb8+ Bf8 Qxc7 是捉双）。
- 困子：被钉在王前、走不开的子是牵制，不是困子。
- 升变：兵的赛跑不在六步里结账，深搜评估 ≥ +300 也算。

**回退的两个**：

- **长将**（3/25 错）：两条是失着后深搜确为和棋，但深搜的和法不是一路将军（…Kf8 Rxh7 Re7，或对方先吃掉车）；一条深搜根本不是和棋（+4.22）。
- **困子**（3/25 错）：三条都是后被钉在王前（…Qxd4 Bc5、…Qxe6 Bd5、…Qxf5 Bh3）。`motif.js dTrapped` 问的是「每个去处都会丢」，被钉住的子能走的几步当然都丢；改检测器（排除被钉住的子）之后要重新抽样才能再说出来，这一版先回退。

**保留下来但错了一条的**（1/25 = 4%）：捉双（♕xg3 只是吃回、自己能被吃）、串击（♕b8+ 其实是捉双）、引离（♜e1+ 之后对方不吃，深搜赢的是 d1 车）、绝望子（♕xc5 之后深搜不在 c5 吃回，后是在 a5 换掉的）。

**人工推翻 oracle 的**：两条，同一盘同步样本里相邻的两手（过载，…Qxf3 Rxf3 Rxd4 Rxe7+：对方先换后再吃回，次序不同，过载成立）。判对的每个母题抽读了 3 条，没有要推翻的。

## 结果


<!-- sample:begin -->

| 母题 | 抽样 | 错 | 错误率 | 结果 |
|---|---|---|---|---|
| hanging | 25 | 0 | 0% | 保留 |
| perpetual | 25 | 3 | 12% | **回退到只说子力** |
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
| trapped | 25 | 3 | 12% | **回退到只说子力** |
| mateThreat | 25 | 0 | 0% | 保留 |
| promotion | 25 | 0 | 0% | 保留 |
| backRank | 25 | 0 | 0% | 保留 |

### hanging

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步吃掉 ≥ 3 分的子，对方合法地吃不回（说「没保护」时）或是以小吃大（说「换不回来」时），且不是背后的闪将让它吃不回；深搜线净得 ≥ 2。「没理会威胁」另要求走之前同一步已能白吃。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | Anderssen–Dufresne, Berlin 1852 ply 32 | ?? | `1r2k2r/pbppnppp/1bn5/4P2q/Q3N3/B1PB1N2/P4PPP/R3R1K1 w k - 1 17` | Nf6+ | 漏看了 gxf6，兵吃马，换不回来 | 对 | gxf6 以小吃大，深搜净得 2 |
| 2 | Anderssen–Kieseritzky, London 1851 ply 35 | ?? | `rnb1k1nr/p2p1ppp/3B4/1pbN1N1P/4P1P1/3P1Q2/PqP5/R4KR1 b kq - 1 18` | Bxg1 | 更好的是 ♛xa1+，吃掉没有保护住的车 | 对 | Qxa1+ 吃不回，深搜净得 5 |
| 3 | [kRiZ0](https://lichess.org/pgItvSJ0/black#58) | ?? | `1b2r1k1/p4pp1/3q4/3p4/Q2PrRP1/4P2P/1P1B4/R5K1 b - - 0 29` | Rxf4 | 漏看了 ♕xe8+，车没有保护住 | 对 | Qxe8+ 吃不回，深搜净得 5 |
| 4 | [cvU56](https://lichess.org/lnqHJdMl/black#42) | ?? | `4rrk1/p2nb1pp/1q6/1p2PpB1/2pPB2Q/2P2R1P/PP4P1/R6K b - - 1 21` | Bxg5 | 更好的是 fxe4，兵吃象，净赚子力 | 对 | fxe4 以小吃大，深搜净得 2 |
| 5 | [Q34Cr](https://lichess.org/DMifR0ve/black#48) | ?? | `2r3k1/4npp1/p3R2p/3p4/3P2Q1/2rB3P/Pq3PP1/4R1K1 b - - 0 24` | Rxd3 | 更好的是 fxe6，兵吃车，净赚子力 | 对 | fxe6 以小吃大，深搜净得 4 |
| 6 | [OpEkW](https://lichess.org/xMzCI4LJ#63) | ?? | `1n6/1Q2rp2/P1p1pkpp/3pq3/8/6NP/1P3PP1/2R3K1 w - - 1 32` | Qxe7+ | 漏看了 ♚xe7，后没有保护住 | 对 | Kxe7 吃不回，深搜净得 5 |
| 7 | [ifg9R](https://lichess.org/KHeR7Xe1#37) | ?? | `4r1k1/2p1bppp/2np4/2B5/4P3/RPN5/1PP2PPP/6K1 w - - 1 19` | Nd5 | 没理会对方 dxc5 的威胁，象没有保护住 | 对 | dxc5 吃不回，深搜净得 3 |
| 8 | [L6X3A](https://lichess.org/Fgq5XGzV/black#58) | ?? | `1k1rR3/ppp3pp/3b1p2/8/6B1/2P4P/Pr4n1/4R2K b - - 3 29` | Be7 | 漏看了 ♖1xe7，象没有保护住 | 对 | R1xe7 吃不回，深搜净得 8 |
| 9 | [ilM07](https://lichess.org/tWOZrWa2#35) | ?? | `r4r2/pb4pk/1pn4p/2pRNp2/2B4P/2P3P1/PPP2P2/1K5R w - - 3 18` | Rd7 | 漏看了 ♞xe5，马没有保护住 | 对 | Nxe5 吃不回，深搜净得 3 |
| 10 | [s0xYw](https://lichess.org/JMptHtEV/black#54) | ?? | `3r2k1/b4p2/p3q1p1/1p6/3p1PRQ/1P6/P1r3PP/B2R3K b - - 5 27` | Qe2 | 没理会对方 ♕xd8+ 的威胁，车没有保护住 | 对 | Qxd8+ 吃不回，深搜净得 6 |
| 11 | [WcAGJ](https://lichess.org/6oGtTBJ7/black#90) | ?? | `8/8/pk4np/3p3P/P2P2P1/1K1N1p2/8/8 b - - 1 45` | Nf4 | 漏看了 ♘xf4，马没有保护住 | 对 | Nxf4 吃不回，深搜净得 3 |
| 12 | [HOEsc](https://lichess.org/qk2OW84C#89) | ?? | `8/7k/4P3/3PBr2/7p/1p2P2P/4K1P1/8 w - - 1 45` | e7 | 没理会对方 ♜xe5 的威胁，象没有保护住 | 对 | Rxe5 吃不回，深搜净得 3 |
| 13 | [EknVc](https://lichess.org/EM0VMU1G/black#58) | ?? | `2r3k1/4Npp1/p3p2p/1p2P3/1Pb5/P3qNP1/5PP1/3R2K1 b - - 0 29` | Kf8 | 漏看了 ♘xc8，车没有保护住 | 对 | Nxc8 吃不回，深搜净得 9 |
| 14 | Anderssen–Kieseritzky, London 1851 ply 34 | ?? | `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` | Bd6 | 没理会对方 ♛xa1+ 的威胁，车没有保护住 | 对 | Qxa1+ 吃不回，深搜净得 5 |
| 15 | Anderssen–Kieseritzky, London 1851 ply 36 | ?? | `rnb1k1nr/p2p1ppp/3B4/1p1N1N1P/4P1P1/3P1Q2/PqP5/R4Kb1 w kq - 0 19` | e5 | 没理会对方 ♛xa1+ 的威胁，车没有保护住 | 对 | Qxa1+ 吃不回，深搜净得 5 |
| 16 | [8Zi1o](https://lichess.org/uPfFeQA4#47) | ?? | `2rr4/pp2ppk1/1n5p/q4b2/2P3pP/4Q1B1/P3BPP1/3RR1K1 w - - 7 24` | Rxd8 | 漏看了 ♛xe1+，车没有保护住 | 对 | Qxe1+ 吃不回，深搜净得 4 |
| 17 | [M63wy](https://lichess.org/CTw0aylV#63) | ?? | `6k1/2p4p/3r4/6q1/p3p3/Pn1bP1P1/RQ3PB1/3R2K1 w - - 0 32` | Bxe4 | 漏看了 ♝xe4，象没有保护住 | 对 | Bxe4 吃不回，深搜净得 2 |
| 18 | [BYURn](https://lichess.org/P9plcmJv#43) | ?? | `5r2/3q1pk1/r1Npp1p1/p6p/3NP1bP/8/PPPQ4/2K3RR w - - 0 22` | Nb8 | 漏看了 ♜xb8，马没有保护住 | 对 | Rxb8 吃不回，深搜净得 5 |
| 19 | [P8Ybt](https://lichess.org/P2Y5Pkfz#37) | ?? | `r1b2rk1/2p3bp/p3p3/1p1pP3/6p1/PP1BP3/1BP3PP/R4RK1 w - - 0 19` | Bxh7+ | 漏看了 ♚xh7，象没有保护住 | 对 | Kxh7 吃不回，深搜净得 2 |
| 20 | [88gf8](https://lichess.org/JRTT2LhO#69) | ?? | `8/6pk/8/3Q1pq1/4p3/3Q2p1/6P1/R5K1 w - - 0 35` | Qe3 | 漏看了 ♛xe3+，后没有保护住 | 对 | Qxe3+ 吃不回，深搜净得 14 |
| 21 | [Bdpg1](https://lichess.org/3DMFbula/black#66) | ?? | `3r4/4bkp1/p4pNp/3qp2Q/1P6/N1r4P/P4PP1/1R4K1 b - - 5 33` | Kg8 | 漏看了 ♘xe7+，象没有保护住 | 对 | Nxe7+ 吃不回，深搜净得 9 |
| 22 | [9Fctn](https://lichess.org/YiE8ZH3H/black#76) | ?? | `4r1k1/pp4Q1/2p2qB1/3p4/8/P1P2PR1/6PP/5K2 b - - 0 38` | Qxg7 | 更好的是 ♚xg7，吃掉没有保护住的后 | 对 | Kxg7 吃不回，深搜净得 4 |
| 23 | [ELOop](https://lichess.org/WjpSf3Zv#19) | ?? | `rn1qk1nr/pbpp2bp/1p2p3/4P1p1/3P1p2/3B2B1/PPPN1PPP/RN1Q1RK1 w kq - 0 10` | Bxf4 | 漏看了 gxf4，象没有保护住 | 对 | gxf4 吃不回，深搜净得 2 |
| 24 | [fa0BF](https://lichess.org/Y2EGXP4K#21) | ?? | `r2qk1nr/pb1p1pbp/1p2p1p1/3P4/2n2B2/2N3P1/PP2NPBP/R2QK2R w KQkq - 0 11` | dxe6 | 漏看了 ♝xg2，象没有保护住 | 对 | Bxg2 吃不回，深搜净得 2 |
| 25 | [jG3XU](https://lichess.org/oACkcaM3/black#30) | ?? | `2kr4/1pp2pp1/p2q1n2/3PP3/1n4p1/6P1/PPP2PBr/R1BQ1RK1 b - - 0 15` | Qxe5 | 没理会对方 ♔xh2 的威胁，车没有保护住 | 对 | Kxh2 吃不回，深搜净得 4 |

### perpetual

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。失着前深搜对走棋方 ≥ +150，失着后深搜在 ±30 之内；深搜线里攻方每一步都是将军，至少两步。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [xnif2](https://lichess.org/rUExkSWV/black#46) | ?? | `r1b3k1/pp4bp/2n3p1/4p1N1/P2P4/B1p1PB1q/2P2R2/R2K4 b - - 1 23` | Qh4 | 让对方 ♗d5+ 起长将 | 对 | 失着前 -721，之后 0，深搜线步步将军 |
| 2 | [WEQE4](https://lichess.org/6kBARar0#65) | ?? | `7k/ppp3p1/3p2rp/2b5/4R2q/P6P/2P2PK1/2B1QR2 w - - 3 33` | Rg4 | 让对方 ♜xg4+ 起长将 | 对 | 失着前 514，之后 0，深搜线步步将军 |
| 3 | [ufTFJ](https://lichess.org/aoLA9mNb#89) | ?? | `7k/4q1p1/Bp5p/1P2pQ1P/P3Pn2/3P4/8/5R1K w - - 3 45` | Rf3 | 让对方 ♛h4+ 起长将 | 对 | 失着前 713，之后 0，深搜线步步将军 |
| 4 | [0K2m2](https://lichess.org/ZmcU2UUf#125) | ?? | `8/8/5N2/8/r2p4/4KP1k/8/6R1 w - - 0 63` | Kf2 | 让对方 ♜a2+ 起长将 | 对 | 失着前 570，之后 0，深搜线步步将军 |
| 5 | [bKEBE](https://lichess.org/R0YDd407/black#70) | ?? | `5rk1/2RR2pp/ppp5/8/1P6/P3r2P/5pPK/8 b - - 2 35` | Rf6 | 让对方 ♖xg7+ 起长将 | **错** | 深搜线上攻方不是步步将军 |
| 6 | [HQaJg](https://lichess.org/Zfd4Ql0E/black#66) | ?? | `3r4/1p3k1R/2p2q2/p2p2r1/P1n5/2P1PQ2/1P2KP2/2R5 b - - 15 33` | Rg7 | 让对方 ♖xg7+ 起长将 | **错** | 失着后深搜 422，不是和棋 |
| 7 | [y3X1Q](https://lichess.org/DqXy2r1Z/black#48) | ?? | `1r3k1r/p1p2bpp/2B5/4P3/1q6/3P2P1/2P1Q2P/3K1R2 b - - 5 24` | Qc3 | 让对方 ♖xf7+ 起长将 | 对 | 失着前 -439，之后 0，深搜线步步将军 |
| 8 | [bJNIS](https://lichess.org/85SzrSDP/black#74) | ?? | `r7/6pk/7p/8/1P2P1P1/PQ3PKP/3q4/8 b - - 10 37` | g5 | 让对方 ♕f7+ 起长将 | 对 | 失着前 -692，之后 0，深搜线步步将军 |
| 9 | [oXmFy](https://lichess.org/gUcKYDly/black#80) | ?? | `4Q3/2p1b1pk/3p4/2p1p2p/2q5/3b3P/1P4PN/6BK b - - 1 40` | Bf6 | 让对方 ♕xh5+ 起长将 | 对 | 失着前 -416，之后 0，深搜线步步将军 |
| 10 | [1VSCb](https://lichess.org/ocyBdOag#93) | ?? | `8/2RQ1pk1/5qp1/3P4/6pP/4P3/5PK1/8 w - - 0 47` | Kg3 | 让对方 ♛f3+ 起长将 | 对 | 失着前 955，之后 0，深搜线步步将军 |
| 11 | [0aaOY](https://lichess.org/LYC9GFrV/black#70) | ?? | `3r2k1/5R1p/6p1/p4p2/1q1p1P1Q/7P/P1p3P1/4R2K b - - 0 35` | Kxf7 | 让对方 ♕xh7+ 起长将 | 对 | 失着前 -425，之后 0，深搜线步步将军 |
| 12 | [ZWrc5](https://lichess.org/NXlHdBN5#85) | ?? | `6k1/pr4bp/6p1/3NP3/2P1pP1P/6P1/4Q1KR/q7 w - - 4 43` | Qxe4 | 让对方 ♜b2+ 起长将 | 对 | 失着前 405，之后 0，深搜线步步将军（深搜在失着后局面上的主线） |
| 13 | [q6MFY](https://lichess.org/yRUczBoL#63) | ?? | `r1r3k1/6pp/p1p1p2q/4Q3/1P1BP3/3P1PPn/P4K2/2R4R w - - 5 32` | Rxh3 | 让对方 ♛d2+ 起长将 | 对 | 失着前 640，之后 0，深搜线步步将军 |
| 14 | [NW6To](https://lichess.org/wttboUYw#77) | ?? | `1Q6/6bk/3P2pp/5q2/8/7P/PPK5/3R4 w - - 3 39` | Rd3 | 让对方 ♛f2+ 起长将 | 对 | 失着前 532，之后 0，深搜线步步将军 |
| 15 | [n12Rw](https://lichess.org/xrPIWnC7/black#70) | ?? | `1k6/1r4pp/1p4r1/4p3/4P3/3R1P1P/q5PK/5Q2 b - - 3 35` | Qa6 | 让对方 ♖d8+ 起长将 | **错** | 深搜线上攻方不是步步将军 |
| 16 | [18317](https://lichess.org/PzwxNeUE/black#88) | ?? | `2rr4/4Q3/2p5/1p1k4/1P2p1p1/5qP1/PB5P/6K1 b - - 0 44` | e3 | 让对方 ♕e5+ 起长将 | 对 | 失着前 -1570，之后 0，深搜线步步将军 |
| 17 | [21CK4](https://lichess.org/QmL0tIHq/black#98) | ?? | `2r4k/6p1/3qP1Qp/p7/1pP3N1/1P5K/P5P1/8 b - - 2 49` | Rc6 | 让对方 ♕e8+ 起长将 | 对 | 失着前 -220，之后 0，深搜线步步将军 |
| 18 | [2DAvb](https://lichess.org/z8k3ed4R/black#62) | ?? | `4rrk1/p2q1pp1/1p6/2b3R1/7Q/1P2p2P/P5PN/2R4K b - - 3 31` | e2 | 让对方 ♖xg7+ 起长将 | 对 | 失着前 -522，之后 0，深搜线步步将军 |
| 19 | [03FL5](https://lichess.org/ifsXHnPY/black#66) | ?? | `5r2/p1q2p1k/5Q1p/3p1N2/8/1P5P/P4KP1/4r3 b - - 1 33` | Qe5 | 让对方 ♕xh6+ 起长将 | 对 | 失着前 -1425，之后 0，深搜线步步将军 |
| 20 | [M4I7r](https://lichess.org/Klc3EFik#71) | ?? | `2k5/2b5/2Q5/4p3/2P3q1/8/P4PP1/4R1K1 w - - 2 36` | Rxe5 | 让对方 ♛d1+ 起长将 | 对 | 失着前 829，之后 0，深搜线步步将军 |
| 21 | [1bRcC](https://lichess.org/nUmiPBRv#65) | ?? | `8/3n1rk1/pp1Q2pp/2q5/P1P1P1B1/1P5P/6P1/3R3K w - - 3 33` | Bxd7 | 让对方 ♜f1+ 起长将 | 对 | 失着前 394，之后 0，深搜线步步将军 |
| 22 | [JW0KY](https://lichess.org/JMBdlYFx/black#50) | ?? | `r4r2/1p2Q1k1/p6n/3qp1pR/8/3b4/PPP2P2/R3K3 b Q - 1 25` | Rf7 | 让对方 ♕xg5+ 起长将 | 对 | 失着前 -659，之后 0，深搜线步步将军 |
| 23 | [w0vPe](https://lichess.org/2ng7ajum#77) | ?? | `4k3/5RR1/2p5/pp6/5PP1/1P6/P1Prr3/2K5 w - - 1 39` | Ra7 | 让对方 ♜xc2+ 起长将 | 对 | 失着前 548，之后 0，深搜线步步将军 |
| 24 | [ZnXHp](https://lichess.org/SprV9JgF/black#46) | ?? | `r2r1k2/pp3ppQ/4b2p/8/6q1/b3P3/4BPPP/1R1R1K2 b - - 9 23` | Qg6 | 让对方 ♕h8+ 起长将 | 对 | 失着前 -441，之后 6，深搜线步步将军 |
| 25 | [2SaBk](https://lichess.org/yW14Xnyc/black#70) | ?? | `4QR2/1p4pp/5pk1/3p4/8/4PpPq/3P1K2/1r6 b - - 3 35` | Kh6 | 让对方 ♖xf6+ 起长将 | 对 | 失着前 -9940，之后 0，深搜线步步将军 |

### double

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步之后王同时被两个子将军；深搜线得子 ≥ 1 或将死。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [zVJcU](https://lichess.org/pY5Gumn3#17) | ?? | `r3kb1r/ppp1qppp/3p1n2/3Pn3/5Bb1/2N5/PPPQBPPP/R3K1NR w KQkq - 4 9` | Bxg4 | 漏看了 ♞f3+ 双将，丢后 | 对 | 双将，深搜净得 6 |
| 2 | [L9eQX](https://lichess.org/uByyYyrR/black#72) | ?? | `r5k1/p5p1/1p3p2/1P1R2p1/2Q5/2Pn1PPP/P3q3/7K b - - 2 36` | Qf2 | 漏看了 ♖d8+ 双将，丢马 | 对 | 双将，深搜净得 8 |
| 3 | [66HLA](https://lichess.org/CtjG6mNd#61) | ?? | `2r2rk1/4bppp/2q5/3n4/1pN2P2/3P1QP1/PBRR2KP/8 w - - 6 31` | Qg4 | 漏看了 ♞e3+ 双将，丢后 | 对 | 双将，深搜净得 9 |
| 4 | [7TnVQ](https://lichess.org/FobmJp9g#25) | ?? | `4kbnr/2p1p1pp/8/qN2Pb2/1n1P1p2/1B3N2/1P3PPP/2BQK2R w Kk - 1 13` | Ba4 | 漏看了 ♞c2+ 双将，丢象 | 对 | 双将，深搜净得 2 |
| 5 | [vaujq](https://lichess.org/9V9Rvv9e#35) | ?? | `rn3rk1/p3bpp1/1p1p2q1/1QpPp1Bp/2P1n2P/5BP1/PP3P2/1K1R2NR w - - 0 18` | Bxe7 | 漏看了 ♞c3+ 双将，丢后 | 对 | 双将，深搜净得 3 |
| 6 | [zeUvS](https://lichess.org/dc04jrKX/black#86) | ?? | `8/p2P2p1/5rkp/2P5/6BK/5PQP/5q2/8 b - - 4 43` | Qxc5 | 漏看了 ♗f5+ 双将 | 对 | 双将，深搜净得 5 |
| 7 | [luZcR](https://lichess.org/f8sbkchH/black#18) | ?? | `r2qkbnr/p4ppp/4b3/1N1Bp3/Q2n2P1/8/PP1PPP1P/R1B1K1NR b KQkq - 0 9` | Qxd5 | 漏看了 ♘c7+ 双将，丢后 | 对 | 双将，深搜净得 3 |
| 8 | [EEPoh](https://lichess.org/1DYqFhbe#55) | ?? | `5b1k/pN4pp/1q6/3Bp3/2Pn4/P2Q2PP/1P6/6K1 w - - 3 28` | b4 | 漏看了 ♞f3+ 双将 | 对 | 双将，深搜净得 6（深搜在失着后局面上的主线） |
| 9 | [xKJiR](https://lichess.org/wuBH90Lw/black#36) | ?? | `r2q1r2/1ppbbpkp/p2p1n2/4p1N1/4P3/1PP3RP/1P3PP1/RN1Q2K1 b - - 5 18` | Rg8 | 漏看了 ♘e6+ 双将，丢后 | 对 | 双将，深搜净得 6 |
| 10 | [066ld](https://lichess.org/ePT7GGwS/black#90) | ?? | `7r/6p1/3p4/4p1P1/R1Nnk3/2r5/5P1p/R6K b - - 1 45` | Nf5 | 漏看了 ♘xd6+ 双将，丢马 | 对 | 双将，深搜净得 3 |
| 11 | [0DkuZ](https://lichess.org/fd9b6gHf#25) | ?? | `r4rk1/pp4pp/1qB1pn2/3p4/8/8/PPP2KPP/RNBQR3 w - - 1 13` | Be3 | 漏看了 ♞g4+ 双将，丢象 | 对 | 双将，深搜净得 3 |
| 12 | [cleBf](https://lichess.org/WbXxVcQg/black#52) | ?? | `5rkq/pbp5/1pn3PB/4p1Q1/3P4/2P5/P1P2P2/2K5 b - - 4 26` | Rf7 | 漏看了 gxf7+ 双将，丢车 | 对 | 双将，深搜净得 9 |
| 13 | [xeYMW](https://lichess.org/KLhwZGfx#55) | ?? | `6r1/p4p2/5k1p/5p2/2B3b1/1PP2P2/P2r2KP/R4R2 w - - 1 28` | Rf2 | 漏看了 ♝h3+ 双将，丢车 | 对 | 双将，深搜净得 2 |
| 14 | [JzW1D](https://lichess.org/5w65GQuD#89) | ?? | `1r6/6R1/3k4/3p1Bp1/1P3b1r/2PK1R1P/8/8 w - - 1 45` | Kd4 | 漏看了 ♝e5+ 双将，丢车 | 对 | 双将，深搜净得 5 |
| 15 | [SPS8V](https://lichess.org/PF99Fu6g/black#44) | ?? | `2kr1b1r/pb1q4/1p1pp3/6pp/PPNn1p2/2QB1P2/3N2PP/R4RK1 b - - 1 22` | Bg7 | 漏看了 ♘xb6+ 双将，丢后 | 对 | 双将，深搜净得 7 |
| 16 | [Aa31x](https://lichess.org/3i7XEKPy#17) | ?? | `rnb1k2r/ppppqp1p/8/6p1/2B1np1b/3P1NP1/PPP1K2P/RNBQ2R1 w kq - 0 9` | gxh4 | 漏看了 ♞c3+ 双将，丢后 | 对 | 双将，深搜净得 6 |
| 17 | [Dozdv](https://lichess.org/Ep8eA4u3#53) | ?? | `3r1r2/qp1nk1b1/2p2pp1/P6p/1PNnPp2/3P2PB/1B1Q3P/R4RK1 w - - 0 27` | Qxf4 | 漏看了 ♞e2+ 双将，丢后 | 对 | 双将，深搜净得 5 |
| 18 | [px8gs](https://lichess.org/1yLX9VQ6/black#66) | ?? | `3r2k1/p6p/4Rqp1/8/1PQ5/P1pp4/5PPP/6K1 b - - 0 33` | Qd4 | 漏看了 ♖xg6+ 双将 | 对 | 双将，深搜净得 6 |
| 19 | [NZcl9](https://lichess.org/1i3nY1kQ/black#18) | ?? | `rnbq3r/pp2pkbp/4P1p1/2p5/6n1/5N2/PPPP2PP/RNBQ1RK1 b - - 0 9` | Bxe6 | 漏看了 ♘g5+ 双将，丢象 | 对 | 双将，深搜净得 5 |
| 20 | [wYzHG](https://lichess.org/a4e6jygJ#29) | ?? | `r3r1k1/ppp2ppp/2bp4/6q1/3QPn2/P1N2P1P/1PP2BP1/2KR3R w - - 5 15` | g4 | 漏看了 ♞e2+ 双将，丢后 | 对 | 双将，深搜净得 6 |
| 21 | [Ufefh](https://lichess.org/HkeoEZTB#51) | ?? | `6rr/1p1kbp2/p2p4/P3pP2/1P1PP3/6pp/3BQ1P1/5R1K w - - 0 26` | b5 | 漏看了 hxg2+ 双将 | 对 | 双将，深搜净得 5 |
| 22 | [QACXx](https://lichess.org/wV4mpels#77) | ?? | `2b2rk1/R7/3p3q/3P4/2PN1np1/6P1/1Q3pK1/1R3B2 w - - 2 39` | Kxf2 | 漏看了 ♞d3+ 双将，丢后 | 对 | 双将，深搜净得 8（深搜在失着后局面上的主线） |
| 23 | [Wq6Oi](https://lichess.org/PW04AcTG#75) | ?? | `4k3/pp4R1/3qpr2/2p1n3/3pPQ2/1P1P3P/P1P4K/5R2 w - - 0 38` | Qxf6 | 漏看了 ♞g4+ 双将 | 对 | 双将，深搜净得 4 |
| 24 | [SJaw5](https://lichess.org/ZeQBfNry#69) | ?? | `1r6/4Q3/1p1PRnk1/2p3q1/8/2P2pp1/1P3P2/3R2K1 w - - 0 35` | Rd2 | 漏看了 gxf2+ 双将，丢车 | 对 | 双将，深搜净得 4 |
| 25 | [zZooa](https://lichess.org/o8MrhT1M#31) | ?? | `r3k2r/5ppp/p3qb2/1pppn3/4N3/P2P2QP/1PP2PP1/R1B1K2R w KQkq - 0 16` | Nxc5 | 漏看了 ♞xd3+ 双将，丢马 | 对 | 双将，深搜净得 3 |

### discovered

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步之后是将军，将军的子不是走动的那个，而是走动的子让开了线；走动的子本身不将军（否则是双将）；深搜线得子 ≥ 1 或将死。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [QIbwz](https://lichess.org/W8t0kI1d#69) | ?? | `8/1p5R/2b3p1/3n1k2/3B4/6KP/P5P1/8 w - - 1 35` | Kf3 | 漏看了 ♞f6+ 闪将，丢车 | 对 | 闪将，深搜净得 5 |
| 2 | [7ayT0](https://lichess.org/GFuCOn9R/black#54) | ?? | `8/1pp2k2/p2p1b2/3P4/4PQb1/3B4/PPPK1Pq1/4B2r b - - 4 27` | Kg6 | 漏看了 e5+ 闪将，丢象 | 对 | 闪将，深搜净得 5 |
| 3 | [7iVVF](https://lichess.org/pCawlRKO/black#52) | ?? | `2kr3r/qpp5/2b1R3/p1Pn4/P2P4/B5QB/8/2R3K1 b - - 0 26` | Qa6 | 漏看了 ♖xc6+ 闪将，丢后 | 对 | 闪将，深搜净得 12 |
| 4 | [umS9i](https://lichess.org/RZwZVft6/black#52) | ?? | `3q1r2/p2pb1k1/1prNb1p1/2p1Pp1p/5P2/P1B2Q2/1P4PP/3RR1K1 b - - 1 26` | Bxd6 | 漏看了 exd6+ 闪将，丢象 | 对 | 闪将，深搜净得 3 |
| 5 | [0bTPx](https://lichess.org/YpQQu2ar#27) | ?? | `1rb2rk1/1p1n1pbp/pq1p1np1/2pP4/P3P3/2NB1P2/1P1BN1PP/R2Q1RK1 w - - 5 14` | Rb1 | 漏看了 c4+ 闪将，丢象 | 对 | 闪将，深搜净得 3 |
| 6 | [vViAQ](https://lichess.org/PHVU0Wzi#59) | ?? | `8/1pb2k1p/p1p3p1/P7/1P1P1p2/2P4P/4QPP1/1q2B1K1 w - - 0 30` | Kh2 | 漏看了 f3+ 闪将，丢后 | 对 | 闪将，深搜净得 9 |
| 7 | [Jcxoy](https://lichess.org/4JdaXTAm/black#48) | ?? | `4k1r1/p4p2/2b1pN2/1p2PpBp/3p3P/P1r5/4nPP1/R4R1K b - - 3 24` | Kd8 | 漏看了 ♘xg8+ 闪将，丢车 | 对 | 闪将，深搜净得 6 |
| 8 | [g1UzM](https://lichess.org/7RNE0op6#17) | ?? | `rnb2b1r/pppkqNpp/5p2/3p3Q/4nP2/3B4/PPPP2PP/RNB1K2R w KQ - 4 9` | Nxh8 | 漏看了 ♞g3+ 闪将，丢后 | 对 | 闪将，深搜净得 4 |
| 9 | [JtnaC](https://lichess.org/ivoMRUzh#85) | ?? | `8/pp6/6pk/4Q1N1/6P1/P1p4P/1P6/Kb3r2 w - - 1 43` | Qe2 | 漏看了 ♝d3+ 闪将，丢后 | 对 | 闪将，深搜净得 4 |
| 10 | [iuPeY](https://lichess.org/Luj7nrPK#63) | ?? | `5r2/p4Bkp/1q4p1/1Pn5/5Q2/5P2/P5PP/3R1RK1 w - - 0 32` | Rd5 | 漏看了 ♞e6+ 闪将，丢后 | 对 | 闪将，深搜净得 9 |
| 11 | [qRt0K](https://lichess.org/AtApuT4O#27) | ?? | `r1bqk2r/pp1p4/2p2p2/2b4p/3pPPp1/1B1P4/PPPB2PP/R2Q1RK1 w kq - 0 14` | c3 | 漏看了 dxc3+ 闪将，丢兵 | 对 | 闪将，深搜净得 4 |
| 12 | [PiNSn](https://lichess.org/VRKDsTAA/black#22) | ?? | `r1b1k1nr/pp3ppp/2P1p1q1/1B2n1B1/4P1Q1/2P5/P4PPP/R3K1NR b KQkq - 0 11` | Nxg4 | 漏看了 cxb7+ 闪将，丢车 | 对 | 闪将，深搜净得 5 |
| 13 | [3NMlK](https://lichess.org/LvrchPMU/black#46) | ?? | `2r1r1k1/1b1n1pp1/pq1p1nNp/1p2pP2/2P1P3/P6P/BPPNQRPK/3R4 b - - 0 23` | fxg6 | 漏看了 c5+ 闪将，丢后 | 对 | 闪将，深搜净得 6 |
| 14 | [cqUEd](https://lichess.org/oC2oDItD/black#34) | ?? | `rn1q2k1/p1pp3p/1p3bB1/3b4/6Q1/1P2P3/P4P1P/3R1RK1 b - - 0 17` | Be6 | 漏看了 ♗f5+ 闪将，丢象 | 对 | 闪将，深搜净得 3 |
| 15 | [Dcjyw](https://lichess.org/dLBwxysT#73) | ?? | `8/1n6/3b1pkp/2pPp1p1/1pP3P1/1P1NBP1P/5K2/8 w - - 1 37` | Kg3 | 漏看了 e4+ 闪将，丢马 | 对 | 闪将，深搜净得 3 |
| 16 | [sOfCy](https://lichess.org/ej15wpLX/black#102) | ?? | `4r2k/3r1q1p/2pP1PN1/2p5/p7/P6R/6Q1/6K1 b - - 0 51` | Kg8 | 漏看了 ♘e5+ 闪将，丢后 | 对 | 闪将，深搜净得 10 |
| 17 | [2FbNS](https://lichess.org/sUcZez6O/black#48) | ?? | `3rrbk1/pp3N1p/1n3Pp1/2q3Q1/2Pp1B2/8/P5PP/4RRK1 b - - 0 24` | Kxf7 | 更好的是 d3+（闪将） | 对 | 闪将，深搜净得 3 |
| 18 | [mTOgV](https://lichess.org/3CFhj7eM/black#48) | ?? | `2r1r1k1/8/p1q3Bb/1p1bp2p/8/5PQ1/PPP3PP/1K1R3R b - - 0 24` | Bf4 | 漏看了 ♗xe8+ 闪将，丢车 | 对 | 闪将，深搜净得 5 |
| 19 | [WfKNE](https://lichess.org/4ytFB2bY#29) | ?? | `rn4k1/pp4pp/2p3p1/2b5/4P1P1/7P/PPP2rB1/R1BR2K1 w - - 0 15` | Rd8+ | 漏看了 ♜f8+ 闪将，丢车 | 对 | 闪将，深搜净得 5 |
| 20 | [Tofqy](https://lichess.org/3lqSgvdZ/black#44) | ?? | `5r2/1Bq2pkp/pp1rp1p1/2p1R3/P7/2Q5/1PP2PPP/R5K1 b - - 1 22` | Qxb7 | 漏看了 ♖d5+ 闪将，丢车 | 对 | 闪将，深搜净得 2 |
| 21 | [vHpED](https://lichess.org/w29aCNbG/black#32) | ?? | `r2qr3/1ppbbppk/p2p1n1p/8/3PP3/1N2BN1P/PPQ2PP1/R2R2K1 b - - 0 16` | Bf8 | 漏看了 e5+ 闪将，丢马 | 对 | 闪将，深搜净得 1 |
| 22 | [osxFY](https://lichess.org/LzHnu62C#15) | ?? | `rn2kb1r/ppp1qppp/8/8/2Npn1b1/8/PPPPBPPP/RNBQK2R w KQkq - 2 8` | Bxg4 | 漏看了 ♞c3+ 闪将，丢后 | 对 | 闪将，深搜净得 3 |
| 23 | [lzfFZ](https://lichess.org/CLLTjLKL/black#58) | ?? | `r3r1k1/6Rp/5ppB/p3p3/P3P3/8/1pq2PPP/3R2K1 b - - 1 29` | Kf8 | 漏看了 ♖c7+ 闪将，丢后 | 对 | 闪将，深搜净得 9 |
| 24 | [WTk39](https://lichess.org/aapaFBWw/black#96) | ?? | `8/1q2b1k1/3PQ3/p3P1p1/3B4/pP4K1/8/4r3 b - - 0 48` | Bxd6 | 漏看了 exd6+ 闪将，丢车 | 对 | 闪将，深搜净得 7 |
| 25 | [fugLE](https://lichess.org/Kkv62H8n#63) | ?? | `4r3/p2r1k2/1p4pp/8/1PPb3P/4p1P1/1P5N/R3R1K1 w - - 0 32` | Rad1 | 漏看了 e2+ 闪将，丢车 | 对 | 闪将，深搜净得 4 |

### discoveredAttack

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。走动的子让开了一条线，线后的长兵器由此新打到对方 ≥ 3 分的子；深搜线里攻方随后吃到了被新打到的子或走动的子所打的子，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [lnHxI](https://lichess.org/Ua3kuqz4/black#28) | ?? | `r1b2k1r/pp1pnNpp/4p3/4P3/3q1P2/3B4/P5PP/R2QK2R b KQ - 0 14` | Kxf7 | 漏看了 ♗g6+ 闪击，丢后 | 对 | 闪击 d4，深搜吃到，净得 3 |
| 2 | [jwzb2](https://lichess.org/YfHPsRfr#25) | ?? | `2kr2nr/pp4pp/2n1bp2/2p3P1/6qP/3P1N2/PPP1P1B1/R1BQK2R w KQ - 5 13` | Bh3 | 漏看了 ♛g3+ 闪击，丢象 | 对 | 闪击 h3，深搜吃到，净得 3 |
| 3 | [QeTCs](https://lichess.org/TzskbaHX/black#50) | ?? | `r2q1r2/4ppk1/3p2p1/2pP1P2/1p4QP/8/BPP3P1/R4K2 b - - 0 25` | Qd7 | 漏看了 f6+ 闪击，丢后 | 对 | 闪击 d7，深搜吃到，净得 8 |
| 4 | [u3YEF](https://lichess.org/7ypQqmk1/black#56) | ?? | `4r3/1p3ppk/3b3p/p2p1q2/P3rPN1/5RQP/1P4P1/5R1K b - - 11 28` | g5 | 漏看了 fxg5 闪击，丢兵 | 对 | 闪击 f5、d6，深搜吃到，净得 1 |
| 5 | [2DQyt](https://lichess.org/q6zeXBmK/black#36) | ?? | `r5k1/pp3ppp/2q1pn2/2b3B1/8/P1N5/1P3PPP/2RQ2K1 b - - 0 18` | Ne4 | 漏看了 ♘xe4 闪击，丢象 | 对 | 闪击 c5，深搜吃到，净得 3 |
| 6 | [zpv0f](https://lichess.org/fsadaBll/black#68) | ?? | `5rk1/4q1p1/7p/p3PB1Q/1p6/1Ppp4/P4bPP/5R1K b - - 3 34` | Qxe5 | 漏看了 ♗h7+ 闪击，丢后 | 对 | 闪击 e5，深搜吃到，净得 5 |
| 7 | [LP8MN](https://lichess.org/VWwYkAeG/black#66) | ?? | `7k/pb2r2P/1p1N4/6qB/3ppp1B/P7/1PP2PP1/1K5R b - - 1 33` | Qxh5 | 漏看了 ♗f6+ 闪击，丢后 | 对 | 闪击 h5，深搜吃到，净得 8 |
| 8 | [Ifm9I](https://lichess.org/tvLWGPhL/black#50) | ?? | `2r2rk1/5p1p/p5p1/3q4/2ppN1P1/P3bQ2/BPP4P/5R1K b - - 3 25` | f5 | 漏看了 ♘f6+ 闪击，丢后 | 对 | 闪击 d5，深搜吃到，净得 9 |
| 9 | [YRl0K](https://lichess.org/rTiIjEsb/black#60) | ?? | `2r2rk1/5p1p/2p4b/1p1pPp2/pPnP3q/P1P2R1P/1B2Q1B1/5RK1 b - - 7 30` | Qe4 | 漏看了 ♖g3+ 闪击，丢后 | 对 | 闪击 e4，深搜吃到，净得 4 |
| 10 | [cK5q7](https://lichess.org/xwqojBD8#29) | ?? | `r6r/pb2kppp/1p1bp3/3n4/Q2PBP1q/8/PP4PP/RNB2R1K w - - 2 15` | Nc3 | 漏看了 ♞xc3 闪击，丢象 | 对 | 闪击 e4，深搜吃到，净得 3 |
| 11 | [80ydF](https://lichess.org/tZghwXLL/black#28) | ?? | `1rbqr1k1/b1p2ppp/p1np1n2/Pp6/3NP3/1BP1B2P/1P3PP1/RN1QR1K1 b - - 0 14` | Bd7 | 漏看了 ♘xc6 闪击，丢象 | 对 | 闪击 a7，深搜吃到，净得 3 |
| 12 | [qllok](https://lichess.org/19T5W0Dd/black#40) | ?? | `r2qk2r/pp2b3/5n2/3p1Q1p/P2P2p1/N1P3PP/1P4P1/R4RK1 b kq - 2 20` | Qd7 | 漏看了 ♕g6+ 闪击，丢马 | 对 | 闪击 f6，深搜吃到，净得 3 |
| 13 | [hicqx](https://lichess.org/qYbOE9F8/black#42) | ?? | `r5k1/pb3ppp/1p3n2/2p5/2pP1B2/1Pq5/P1B3P1/2R2QK1 b - - 3 21` | Ng4 | 漏看了 ♗xh7+ 闪击，丢后 | 对 | 闪击 c3，深搜吃到，净得 7 |
| 14 | [tm2Zm](https://lichess.org/GSCFdVN1#19) | ?? | `r1bq1rk1/ppp2ppp/2nb4/1B1Q4/4p3/2P2N2/PPP2PPP/R1B1R1K1 w - - 0 10` | Rxe4 | 漏看了 ♝xh2+ 闪击，丢后 | 对 | 闪击 d5，深搜吃到，净得 6 |
| 15 | [AVfJZ](https://lichess.org/oSHA2Yvw#31) | ?? | `3r1rk1/pp1b1pp1/2n3qp/1B1Q4/3N4/2P1P3/P4PPP/R4RK1 w - - 1 16` | Qf3 | 漏看了 ♞xd4 闪击，丢象 | 对 | 闪击 b5，深搜吃到，净得 3 |
| 16 | [dtoET](https://lichess.org/DrDpo2pR/black#38) | ?? | `1nkr4/1ppqr1bp/3p4/1P6/3PNpb1/2P5/1BQN2PP/R3R1K1 b - - 2 19` | Qxb5 | 漏看了 ♘xd6+ 闪击，丢车 | 对 | 闪击 e7，深搜吃到，净得 2 |
| 17 | [M8SJ5](https://lichess.org/GPVjDeGI/black#18) | ?? | `rnb1k2r/1p2bppp/pq1ppn2/6B1/3NPP2/2NB4/PPPQ2PP/R3K2R b KQkq - 4 9` | Qxd4 | 漏看了 ♗b5+ 闪击，丢后 | 对 | 闪击 d4，深搜吃到，净得 3 |
| 18 | [QNiXy](https://lichess.org/8uUtMAVi/black#60) | ?? | `2r5/5kbp/4p1p1/p4p2/P1BPn3/1P2P2P/5PP1/2R3K1 b - - 3 30` | Nd2 | 漏看了 ♗xe6+ 闪击，丢车 | 对 | 闪击 c8，深搜吃到，净得 3 |
| 19 | [kTC92](https://lichess.org/65NUbOpY#35) | ?? | `3r1rk1/1p4pp/p1nbbp2/4p1B1/4Q1P1/1NPB1P1q/P1P4P/2KR3R w - - 0 18` | Bf1 | 漏看了 ♝a3+ 闪击，丢车 | 对 | 闪击 d1，深搜吃到，净得 8 |
| 20 | [mlosj](https://lichess.org/NGyZadLf#61) | ?? | `4r1q1/1ppbk1bN/p3p1Q1/2p3N1/3P1P2/4P3/PP6/2KR4 w - - 0 31` | dxc5 | 漏看了 ♝xb2+ 闪击，丢后 | 对 | 闪击 g6，深搜吃到，净得 6 |
| 21 | [ZNo2C](https://lichess.org/ogIYmMvO#27) | ?? | `rq3rk1/1b1n1pbp/3p1np1/ppp3B1/3P4/1P2PN2/P2NBPPP/2RQR1K1 w - - 0 14` | Bxb5 | 漏看了 ♝xf3 闪击，丢象 | 对 | 闪击 b5，深搜吃到，净得 1 |
| 22 | [rnFgA](https://lichess.org/XPiJBDpq#55) | ?? | `3r3k/5p1p/5p2/p1p1qP2/1p1nB3/PPQ1R2P/2P2PP1/6K1 w - - 0 28` | axb4 | 漏看了 ♞e2+ 闪击，丢后 | 对 | 闪击 c3，深搜吃到，净得 4 |
| 23 | [9djEZ](https://lichess.org/kQ3eWaee#59) | ?? | `8/2p2p1p/2Rb2rk/8/3B4/2PP2P1/P4P1p/6K1 w - - 0 30` | Kxh2 | 漏看了 ♝xg3+ 闪击，丢车 | 对 | 闪击 c6，深搜吃到，净得 2 |
| 24 | [NGsK8](https://lichess.org/7kpVjsmp#37) | ?? | `r3r3/1p2bk1p/pBp2p2/5b2/R7/1PNP4/1PP2PPP/4R1K1 w - - 4 19` | f3 | 漏看了 ♝c5+ 闪击，丢车 | 对 | 闪击 e1，深搜吃到，净得 2 |
| 25 | [nOI5i](https://lichess.org/j5shFqvq/black#34) | ?? | `r1b1k2r/5ppp/pq2pn2/1p2B3/1bp5/2N1P3/R1PQBPPP/5RK1 b kq - 0 17` | Nd5 | 漏看了 ♘xd5 闪击，丢象 | 对 | 闪击 b4，深搜吃到，净得 3 |

### fork

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。走到的子同时打到两个目标（王、或 ≥ 3 分的子），这步本身不是白吃一子（吃回失着刚吃掉的不算）；深搜线里随后在原格吃到了被打到的子之一（多半是这个子自己，也可以是捉双让出来的别的子），净得 ≥ 1。只说「同时攻击 X 和 Y」时：确实打到这两个，它自己吃不掉，且至少一个非王目标没有保护或比它值钱。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [z2UYl](https://lichess.org/xFXN0QW5/black#34) | ?? | `r1b1kb2/p3np2/4p2p/q3P3/PpQP4/5N2/5PPP/R4RK1 b q - 0 17` | Nd5 | 漏看了 ♕c6+ 捉双，丢车 | 对 | 捉双 e8、d5、a8、c8，深搜吃到，净得 5 |
| 2 | [u5SK7](https://lichess.org/Gc3JbVjO/black#62) | ?? | `r5k1/p5p1/4p3/1pp1P3/3pN2K/P2P1qP1/1NP5/R7 b - - 0 31` | Kf7 | 漏看了 ♘g5+ 捉双，丢后 | 对 | 捉双 f7、f3，深搜吃到，净得 9 |
| 3 | [oYNoh](https://lichess.org/dttdrtba/black#36) | ?? | `r1b1k3/1p2bprp/p1N5/7q/3pN3/8/PP1B1PPP/2KRR3 b q - 1 18` | bxc6 | 漏看了 ♘f6+ 捉双，丢后 | 对 | 捉双 e8、h5，深搜吃到，净得 6 |
| 4 | [ybjeZ](https://lichess.org/d8GjawEf/black#50) | ?? | `5r2/1pNr2kp/1p3bp1/3B1p2/2PR4/1P5P/P5P1/2R2K2 b - - 0 25` | Bxd4 | 漏看了 ♘e6+ 捉双，同时攻击王和车 | 对 | Ne6+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 5 | [mMObE](https://lichess.org/4OchGUvP/black#96) | ?? | `8/4k3/3N3p/3K2p1/5p2/6b1/8/8 b - - 1 48` | f3 | 漏看了 ♘f5+ 捉双，丢象 | 对 | 捉双 e7、g3，深搜吃到，净得 3 |
| 6 | [uaSxN](https://lichess.org/ZU2hb6Vg/black#44) | ?? | `1n1r2k1/5ppp/p3pn2/2q5/b1PN4/P1P1P2P/3RBPP1/1RB3K1 b - - 6 22` | h6 | 漏看了 ♘xe6 捉双，丢后 | 对 | 捉双 d8、c5，深搜吃到，净得 3 |
| 7 | [oW28F](https://lichess.org/nEE4kEYq#57) | ?? | `4r3/p1r3k1/1pp2pq1/3p1Q1p/3Pn1pP/3NP3/PP6/1K1N2RR w - - 2 29` | Qf1 | 漏看了 ♞d2+ 捉双，丢后 | 对 | 捉双 f1、b1，深搜吃到，净得 9 |
| 8 | [ugRMT](https://lichess.org/NaKwDcc6#45) | ?? | `3r1r1k/pp3ppB/8/7b/3R3P/P1N1P1q1/1PQK2P1/7R w - - 1 23` | Rxd8 | 漏看了 ♛xg2+ 捉双，同时攻击王和车 | 对 | Qxg2+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 9 | [pp9V6](https://lichess.org/8Ji2aszi#89) | ?? | `6k1/4R1p1/2p2n2/p3NP2/Pr2PKp1/8/7P/8 w - - 1 45` | Nxg4 | 漏看了 ♞d5+ 捉双，丢车 | 对 | 捉双 e7、f4，深搜吃到，净得 4 |
| 10 | [TAyIq](https://lichess.org/AyK4lY7Z/black#96) | ?? | `3r3k/5R1n/p2p2P1/1p1Pp3/1P2N2P/P4pK1/2r5/8 b - - 0 48` | Nf8 | 漏看了 g7+ 捉双，同时攻击王和马 | 对 | g7+ 同时打到 k、n，吃不掉它，目标值得吃 |
| 11 | [tY8yi](https://lichess.org/ltuW6LTt/black#68) | ?? | `8/ppR1r1pk/3q3p/3P1r2/8/1P3n2/PBQ4P/2R4K b - - 1 34` | Rxc7 | 漏看了 ♕xf5+ 捉双，同时攻击王和马 | 对 | Qxf5+ 同时打到 k、n，吃不掉它，目标值得吃 |
| 12 | [jpkW4](https://lichess.org/EyhQbOZm/black#76) | ?? | `2r3k1/7p/4p3/p2p3N/1p2q1PP/1Pn5/1P6/K4RR1 b - - 5 38` | Ra8 | 漏看了 ♘f6+ 捉双，丢后 | 对 | 捉双 g8、e4，深搜吃到，净得 9 |
| 13 | [69BAp](https://lichess.org/iIyRKwA0/black#34) | ?? | `r2qr3/1b1n1kpp/1p3n2/1Np3B1/8/8/PP3PPP/R2QR1K1 b - - 0 17` | h6 | 漏看了 ♘d6+ 捉双，同时攻击王和车 | 对 | Nd6+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 14 | [B3sP8](https://lichess.org/DuFOU5Rb/black#24) | ?? | `r2qk2r/pp1b1ppp/8/1BbQn3/8/2N5/PP1P1PPP/R1B1K2R b KQkq - 0 12` | Bxb5 | 漏看了 ♕xe5+ 捉双，同时攻击王和象 | 对 | Qxe5+ 同时打到 k、b，吃不掉它，目标值得吃 |
| 15 | [W9e2E](https://lichess.org/7JMLw6PB/black#44) | ?? | `2r2rk1/5p1p/p2pp1p1/1p1Pb1q1/2n1P2P/2N2QBn/PP4PK/1BR1R3 b - - 2 22` | Bxg3+ | 漏看了 ♕xg3 捉双，同时攻击后和马 | **错** | Qxg3 自己能被吃掉 |
| 16 | [FIKdp](https://lichess.org/d2sPK1kn/black#60) | ?? | `r2q4/1p4kp/4n1pN/p3N3/3p3P/P7/1PP5/2K2Q2 b - - 0 30` | Kxh6 | 漏看了 ♘f7+ 捉双，丢后 | 对 | 捉双 d8、h6，深搜吃到，净得 3 |
| 17 | [oTcDA](https://lichess.org/9efEoRaT#59) | ?? | `6k1/Qb3r2/p2r4/1p5p/6pb/6R1/PP3PP1/1R4K1 w - - 2 30` | Re3 | 漏看了 ♝xf2+ 捉双，同时攻击王和车 | 对 | Bxf2+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 18 | [cXODj](https://lichess.org/TP37dY0f#33) | ?? | `2kr3r/R1pq1pp1/4bn2/1P2p2p/3nP2N/2bP1PP1/3B2BP/2Q2RK1 w - - 0 17` | Bxc3 | 漏看了 ♞e2+ 捉双，丢后 | 对 | 捉双 c3、g1、c1，深搜吃到，净得 4 |
| 19 | [mtwPd](https://lichess.org/aRWtzGuR/black#52) | ?? | `2r3k1/1b4qp/1p4p1/3pPB2/3P1R2/pPr1R2Q/P6P/6K1 b - - 0 26` | Rxe3 | 漏看了 ♗e6+ 捉双，同时攻击王和车 | 对 | Be6+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 20 | [Fm33X](https://lichess.org/Q4hDybKz#109) | ?? | `1k3r2/7R/1p6/1Pn1R3/8/8/5P2/5K2 w - - 3 55` | Ke1 | 漏看了 ♞d3+ 捉双，丢车 | 对 | 捉双 e5、e1，深搜吃到，净得 5 |
| 21 | [TQVJh](https://lichess.org/H3nIIh1B#101) | ?? | `2r5/5p2/2Pn3p/1PRbk1p1/P7/4P3/5KP1/2R5 w - - 7 51` | Rd1 | 漏看了 ♞e4+ 捉双，丢车 | 对 | 捉双 c5、f2，深搜吃到，净得 5 |
| 22 | [HkWfR](https://lichess.org/RffP7OvB#67) | ?? | `8/1p1n4/7k/2p3pb/P2B4/1B1Q4/2P1q1PP/6K1 w - - 0 34` | Be3 | 漏看了 ♛e1+ 捉双，丢象 | 对 | 捉双 g1、e3，深搜吃到，净得 3 |
| 23 | [mFEMX](https://lichess.org/vQkHjcRP/black#72) | ?? | `8/1k1r4/2p1Rp2/1PB3pp/8/2bp2PP/5PK1/8 b - - 0 36` | d2 | 漏看了 bxc6+ 捉双，同时攻击王和车 | 对 | bxc6+ 同时打到 k、r，吃不掉它，目标值得吃 |
| 24 | [UUbcl](https://lichess.org/VgWitzse/black#58) | ?? | `r1b3k1/2p2p2/P2p2p1/7p/Q7/1R1qPB2/3P2PP/6K1 b - - 3 29` | Rxa6 | 漏看了 ♕e8+ 捉双，同时攻击王和象 | 对 | Qe8+ 同时打到 k、b，吃不掉它，目标值得吃 |
| 25 | [Xvkgg](https://lichess.org/TA3TEVhK/black#84) | ?? | `4B1k1/2R4p/6p1/p1b3P1/8/8/r7/7K b - - 3 42` | Bb4 | 漏看了 ♗f7+ 捉双，丢车 | 对 | 捉双 g8、a2，深搜吃到，净得 5 |

### zwischenzug

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。失着是吃子，对方本可以立刻吃回，却先走一步将军或吃子；深搜线里随后仍在原格吃回，扣掉失着吃到的，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [GUiO7](https://lichess.org/t2ME6ifP/black#54) | ?? | `3rr1k1/3R1ppp/8/1p6/2n5/P4N1P/1P2RPP1/6K1 b - - 4 27` | Nxb2 | 漏看了 ♖xd8 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 2 | [bUizD](https://lichess.org/1bwSZQLX#33) | ?? | `3rk2r/ppp1q1bp/2n3p1/1N1Q4/4p3/P3P1P1/1PPNKPP1/R6R w k - 1 17` | Qxe4 | 漏看了 ♜xd2+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 5 |
| 3 | [LVwER](https://lichess.org/TijqD35p/black#64) | ?? | `k1r5/1b5q/p2R4/4Q1pp/PP2Pp2/2P5/5PPP/6K1 b - - 0 32` | Qxe4 | 漏看了 ♖xa6+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 4 | [mpts5](https://lichess.org/anPAJvYZ/black#40) | ?? | `r4rk1/pp3pp1/2p2q1p/2Pnn3/3Q3P/5P2/PB3PB1/R5RK b - - 3 20` | Nxf3 | 漏看了 ♕xf6 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 5 | [OsXHu](https://lichess.org/HBMkXh6M/black#34) | ?? | `r2qr1k1/1pp2ppp/p7/3p4/8/1PPP2Q1/1P2bPPP/RN2R1K1 b - - 4 17` | Bxd3 | 漏看了 ♖xe8+ 中间着，丢象 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 6 | [p6BUh](https://lichess.org/tnUvjJxK#23) | ?? | `r1bq1rk1/p4pp1/p4b1p/2Pp4/8/2N1PN1P/PP3PP1/R2QK2R w KQ - 0 12` | Qxd5 | 漏看了 ♝xc3+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 8 |
| 7 | [QvJxE](https://lichess.org/BKbtgaLk/black#28) | ?? | `r6r/pp2k1pp/1b2pp2/3p1b2/3PnB1N/2PB4/PP3PPP/R3K2R b KQ - 1 14` | Nxf2 | 漏看了 ♘xf5+ 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 8 | [yXjO6](https://lichess.org/E7qWc0BF/black#50) | ?? | `r4rk1/pp3qb1/4n3/3NPR1p/3P4/3Q4/PP4PP/R5K1 b - - 0 25` | Qxf5 | 漏看了 ♘e7+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 9 | [4bIQb](https://lichess.org/OIVhf2YM/black#56) | ?? | `r5r1/p1pn1k2/1p1p4/3PpR2/2P1Pq2/P1P1Qp2/5P1P/2K3R1 b - - 8 28` | Qxf5 | 漏看了 ♖xg8 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 10 | [5hBuA](https://lichess.org/i8lzoGkd#21) | ?? | `rnb2rk1/pp3ppp/3p1n2/2qPp3/4P3/2B2P2/PP4PP/2RQKBNR w K - 2 11` | Bxe5 | 漏看了 ♛e3+ 中间着，丢象 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 11 | [IqlXZ](https://lichess.org/AaBSNLWx/black#24) | ?? | `r1b1k2r/pp1p1pp1/2n1p2p/8/2PPn3/1Pq2N2/P2N1PPP/R1Q1KB1R b KQkq - 3 12` | Nxd4 | 漏看了 ♕xc3 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 12 | [6XRS7](https://lichess.org/s3XSSv9y#63) | ?? | `1R6/1p2r2k/7p/4rRp1/8/7P/5PP1/6K1 w - - 0 32` | Rxb7 | 漏看了 ♜e1+ 中间着，丢车 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 13 | [9uWTp](https://lichess.org/2zMP1PIt/black#72) | ?? | `7r/4p1k1/pq1pBp2/3QnRp1/1PP4r/P6P/6P1/4R2K b - - 3 36` | Rxc4 | 漏看了 ♖fxe5 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 14 | [5pFH2](https://lichess.org/Rmr9oKCb/black#16) | ?? | `r1b1kbnr/pp3ppp/2n5/qBPp4/3Q4/2N5/PP3PPP/R1B1K1NR b KQkq - 2 8` | Qxb5 | 漏看了 ♕e3+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 6 |
| 15 | [ysnYG](https://lichess.org/WWxDRWQg#65) | ?? | `4r1k1/1Q2ppbp/4p1p1/p3P3/1p1R4/4BN1P/2P2PPK/1q6 w - - 4 33` | Qxe7 | 漏看了 ♝xe5+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 6 |
| 16 | [SZKLo](https://lichess.org/uulqMqzY/black#56) | ?? | `3r2k1/1R4p1/1p1P3p/p3p3/8/4qP2/PP5P/3Q3K b - - 0 28` | Rxd6 | 漏看了 ♖b8+ 中间着，丢车 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 17 | [yzZg8](https://lichess.org/S8OPbdXe#45) | ?? | `1kr2b1r/pp1q2p1/4p3/3pPnPp/P2P1N2/3QB3/1P5P/R4RK1 w - - 1 23` | Nxe6 | 漏看了 ♞xe3 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 18 | [gCEXA](https://lichess.org/5PkAUpuQ/black#68) | ?? | `8/pp3p1k/2pb1r2/7p/3P4/4RqP1/PP3P1P/5QK1 b - - 1 34` | Qxe3 | 漏看了 ♕b1+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 19 | [qfY1w](https://lichess.org/J0lug22H/black#138) | ?? | `8/4Bp2/4bPk1/8/4K3/5r2/4R3/8 b - - 14 69` | Rxf6 | 漏看了 ♖g2+ 中间着，丢车 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 20 | [3OFSl](https://lichess.org/81Aecw7T/black#50) | ?? | `r4rk1/pp5p/2p5/2PpB1p1/3Pn3/7Q/5pPP/2R1qR1K b - - 3 25` | Qxc1 | 漏看了 ♕e6+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 21 | [6oQCF](https://lichess.org/MfztPbhZ/black#54) | ?? | `2k3r1/pp3p2/3b4/3P1pBp/5PrP/P7/1PK5/3R2R1 b - - 4 27` | Bxf4 | 漏看了 ♖xg4 中间着，丢象 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 22 | [MjjYs](https://lichess.org/bwEs3xnB#23) | ?? | `r1bq2k1/2p2rp1/p1n2n1p/1pp1p3/4P3/2P2N2/PP3PPP/RNBQR1K1 w - - 0 12` | Nxe5 | 漏看了 ♛xd1 中间着，丢马 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 23 | [UwG64](https://lichess.org/zJvp7fCE/black#26) | ?? | `r1bqr1k1/ppp2pp1/5n1p/b3p2P/3pN1P1/P3P3/1BPP1PB1/R2QK2R b KQ - 2 13` | Bxg4 | 漏看了 ♘xf6+ 中间着，丢象 | 对 | 中间着后吃回，扣掉失着所得净得 2 |
| 24 | [t46OJ](https://lichess.org/cRCJFb27#51) | ?? | `r3r1k1/1pp4p/3p2p1/3P4/P1P5/5PP1/1qpQ3P/R1R3K1 w - - 0 26` | Qxc2 | 漏看了 ♜e1+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 4 |
| 25 | [cwU2O](https://lichess.org/AkIN9OXB/black#48) | ?? | `2r2k2/p4pp1/1p1R3p/4p3/1Pq5/2P3P1/2Q1PPKP/8 b - - 0 24` | Qxc3 | 漏看了 ♖d8+ 中间着，丢后 | 对 | 中间着后吃回，扣掉失着所得净得 3 |

### desperado

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。吃子的子在走之前已经保不住（被攻击且无保护，或被更便宜的子攻击），而正是失着造成的；它吃的不是攻击它的子，随后在那里被吃掉；扣掉失着吃到的，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | low-skill 5 (skill 0–1) ply 29 | ? | `rn3rk1/1bpq3p/1p1bp1p1/3n1p2/p1BP2PP/P1N1PN2/1PQB1P2/R3K1R1 b Q - 1 15` | Qc6 | 漏看了 ♗xd5 绝望子，丢兵 | 对 | 保不住的子先吃一子，扣掉失着所得净得 1 |
| 2 | Kramnik–Kasparov, London 2000 g2 ply 31 | ? | `r1br2k1/1pp2pp1/p1n2q1p/8/2BP4/2Q1PN2/P4PPP/R3R1K1 b - - 3 16` | b5 | 漏看了 ♗xf7+ 绝望子，丢兵 | 对 | 保不住的子先吃一子，扣掉失着所得净得 1 |
| 3 | [Slgxt](https://lichess.org/CT1ZKBqW/black#36) | ?? | `r6r/p3bkpp/4Rnn1/2p5/3q4/1Q2B3/PPP3PP/RN4K1 b - - 1 18` | Qd5 | 漏看了 ♖xf6+ 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 7 |
| 4 | [qvlce](https://lichess.org/ygf7fdgZ/black#68) | ?? | `3r2k1/P4p2/4bqp1/2Q4p/5P1P/2pp2P1/5PBK/3R4 b - - 0 34` | c2 | 漏看了 ♖xd3 绝望子，丢兵 | 对 | 保不住的子先吃一子，扣掉失着所得净得 4 |
| 5 | [H1Ebo](https://lichess.org/4jZv0miu/black#46) | ?? | `2r2rk1/p2nqpp1/Qp2p2p/3n4/3P4/P3PNBP/5PP1/1RR3K1 b - - 12 23` | Nb8 | 漏看了 ♕xc8 绝望子，丢车 | 对 | 保不住的子先吃一子，扣掉失着所得净得 1 |
| 6 | [C12AD](https://lichess.org/YNt73yg2#57) | ?? | `5rnk/pq4b1/1p3r1p/2p1pB1R/2PpP3/3P2B1/PP2QPK1/7R w - - 1 29` | Bxe5 | 漏看了 ♜xf5 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 2 |
| 7 | [10Wqx](https://lichess.org/Ff1YZgah/black#86) | ?? | `8/4k3/p4nr1/1p2pR2/3qP3/P6P/4Q1P1/7K b - - 0 43` | Qxe4 | 漏看了 ♖xe5+ 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 5 |
| 8 | [psWeP](https://lichess.org/KEZMQO8O/black#92) | ?? | `1r6/4k1P1/4p2K/4P3/p7/1p6/1R5P/8 b - - 4 46` | a3 | 漏看了 ♖xb3 绝望子，丢兵 | 对 | 保不住的子先吃一子，扣掉失着所得净得 4 |
| 9 | [74wVZ](https://lichess.org/5IK2dqad#21) | ?? | `r1b2rk1/pppp1ppp/3q1n2/2b5/2PNP3/P2PB3/1P3PPP/R2QKB1R w KQ - 3 11` | b4 | 漏看了 ♝xd4 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 10 | [l5ox4](https://lichess.org/WVQM208J#37) | ?? | `3r1rk1/p1p3pp/8/1pP1Pp2/2qn1B2/P1P3P1/2Q1PP1P/R4RK1 w - - 3 19` | Qd3 | 漏看了 ♞xe2+ 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 7 |
| 11 | [neN9k](https://lichess.org/auOb4ywK#27) | ?? | `2kr3r/ppq2ppp/2p2n2/2b5/4P1b1/2N2N2/PPPB1PPP/R2QR1K1 w - - 1 14` | h3 | 漏看了 ♝xf3 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 12 | [5K6yY](https://lichess.org/I3y4ye0V/black#56) | ?? | `r2q2k1/4bp2/5np1/3pQ1B1/8/3B3P/5PP1/2R3K1 b - - 1 28` | Nd7 | 漏看了 ♕xe7 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 13 | [8kY3y](https://lichess.org/AQGILSC9/black#36) | ?? | `r3k2r/1ppqnpp1/pbn1b2p/1N1pN3/BP1P1B2/P7/2P3PP/R3QRK1 b kq - 1 18` | Nxe5 | 漏看了 ♘xc7+ 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 4 |
| 14 | [mBhhc](https://lichess.org/1CuqQthZ#55) | ?? | `2r5/1b3pk1/1p1p1np1/p2Pp2p/3rPq2/1PN2P1P/P1RN1QP1/2R3K1 w - - 2 28` | Nb5 | 漏看了 ♜xd2 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 15 | [QkQAi](https://lichess.org/VmeNpdpE#23) | ?? | `r4rk1/pp2bppp/n1pp1n2/q5B1/2PQP1b1/2N2N2/PP2BPPP/3RR1K1 w - - 9 12` | h3 | 漏看了 ♝xf3 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 16 | [Ou1Gl](https://lichess.org/byQHV8D3#21) | ?? | `r3k2r/pbq2ppp/2pbpn2/2p1N3/Q2PpB2/2P5/PP3PPP/RN3RK1 w kq - 2 11` | dxc5 | 漏看了 ♝xe5 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 2 |
| 17 | [UoaWl](https://lichess.org/gwgQrffP#61) | ?? | `3r3k/4p1rp/p2q1p2/3B1Q2/2P5/1P4P1/P1R1PP1P/6K1 w - - 3 31` | c5 | 漏看了 ♛xd5 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 18 | [JPnDw](https://lichess.org/KLePJI02/black#44) | ?? | `1r4k1/2q1bppp/4p3/r2pP3/2pP4/P1Q5/3B1PPP/R4RK1 b - - 3 22` | Rb3 | 漏看了 ♕xa5 绝望子，丢车 | 对 | 保不住的子先吃一子，扣掉失着所得净得 4 |
| 19 | [YL2B4](https://lichess.org/1HPkUbiM/black#56) | ?? | `2rr2k1/3n3p/p3N1p1/8/1R4P1/8/PbP2P1P/4R1K1 b - - 5 28` | Rb8 | 漏看了 ♖xb2 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 20 | [6eIxe](https://lichess.org/IxDKgRCY/black#34) | ?? | `r1b1r1k1/1p3pbp/1npQ2p1/q1n5/p1P1P3/P1N2PPP/1P2NBB1/R3R1K1 b - - 0 17` | Nxc4 | 漏看了 ♕xc5 绝望子，丢马 | **错** | 深搜线上它没有随后被吃 |
| 21 | [wfW1g](https://lichess.org/NBGB5Jha/black#82) | ?? | `8/5p2/6pp/4P3/3k1P2/1p1r2P1/1R2K2P/8 b - - 3 41` | Kc3 | 漏看了 ♖xb3+ 绝望子，丢兵 | 对 | 保不住的子先吃一子，扣掉失着所得净得 1 |
| 22 | [8l69f](https://lichess.org/CH6bWSSY#33) | ?? | `r3nrk1/1pp3b1/p2p1qpp/3Pp3/2P5/2N2NP1/PP3P1P/R2QR1K1 w - - 1 17` | Ne4 | 漏看了 ♛xf3 绝望子，丢马 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |
| 23 | [ZR5Fg](https://lichess.org/XqYaHUoI#57) | ?? | `5Q2/1p1kn1p1/p5Pr/8/1PPpP2p/8/P6P/6K1 w - - 1 29` | Qxg7 | 漏看了 ♜xg6+ 绝望子，丢后 | 对 | 保不住的子先吃一子，扣掉失着所得净得 4 |
| 24 | [fKu0y](https://lichess.org/xKYzu9mS/black#22) | ?? | `r2q1rk1/pppn1pp1/4p2p/3p1b2/2PPnB2/P1PBPN2/2Q2PPP/R3K2R b KQ - 4 11` | dxc4 | 漏看了 ♗xe4 绝望子，丢象 | 对 | 保不住的子先吃一子，扣掉失着所得净得 2 |
| 25 | [XIbd0](https://lichess.org/CsRsW0fu/black#76) | ?? | `6r1/p3k3/1p1bp3/1Pp1qp2/P3n3/4QRPp/5P1N/4R1K1 b - - 4 38` | f4 | 漏看了 ♕xe4 绝望子，丢马 | 对 | 保不住的子先吃一子，扣掉失着所得净得 3 |

### removeDefender

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步吃掉的子原本保护着另一个 ≥ 3 分的子；对方吃回后那个子已无保护，攻方下一步吃掉它；净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [BMbCk](https://lichess.org/ySiASYww#13) | ?? | `rn2kb1r/pp2pppp/2p2n2/7q/3P2b1/2N2N2/PPP1BPPP/R1BQK2R w KQkq - 5 7` | Bg5 | 漏看了 ♝xf3 消除保护，丢象 | 对 | 消除 f3 的保护者后吃掉 g5，净得 3 |
| 2 | [TwYGm](https://lichess.org/GKvOwVLG#49) | ?? | `r3r3/1pp4k/3p2pp/5pq1/p1PQ4/P6P/1P3PB1/3RR1K1 w - - 2 25` | Qd2 | 漏看了 ♛xd2 消除保护，丢车 | 对 | 消除 d2 的保护者后吃掉 e1，净得 5 |
| 3 | [6ETt8](https://lichess.org/zDlwklhE/black#28) | ?? | `1r3rk1/2pqbppp/p2p1n2/1p2P1B1/3Q4/8/PPP2PPP/RN3RK1 b - - 0 14` | dxe5 | 漏看了 ♕xd7 消除保护，丢象 | 对 | 消除 d7 的保护者后吃掉 e7，净得 2 |
| 4 | [04tJF](https://lichess.org/o6qsKQqM#55) | ?? | `5r1k/pp5p/n1q5/3Q1Bp1/4P3/2b2P2/PP5P/6RK w - - 0 28` | bxc3 | 更好的是 ♕xc6（消除保护） | 对 | 消除 c6 的保护者后吃掉 c3，净得 3 |
| 5 | [01U3J](https://lichess.org/S7dtyWl6/black#48) | ?? | `r3q1k1/p5b1/npp3p1/3n1pB1/Q1b1p3/2N1PP1P/PP4BN/3R2K1 b - - 1 24` | Nab4 | 漏看了 ♘xd5 消除保护，丢马 | 对 | 消除 d5 的保护者后吃掉 b4，净得 2 |
| 6 | [PgT9N](https://lichess.org/SMchrkNc#63) | ?? | `6k1/5p1p/p4qp1/8/2R5/KPN1Q3/P1r2r2/6R1 w - - 0 32` | Qd4 | 漏看了 ♛xd4 消除保护，丢马 | 对 | 消除 d4 的保护者后吃掉 c3，净得 3 |
| 7 | [u4Zi0](https://lichess.org/X31IWcCR#33) | ?? | `r1b1r3/3n1pkp/p2p1qp1/1p1P4/3QB3/P4N1P/1PP2PP1/R3K2R w KQ - 3 17` | O-O | 漏看了 ♛xd4 消除保护，丢象 | 对 | 消除 d4 的保护者后吃掉 e4，净得 3 |
| 8 | [78oR2](https://lichess.org/KQxeQkqD/black#56) | ?? | `3R1r1k/4Q1bp/6p1/1p3p2/p7/1B5P/Pq3PP1/6K1 b - - 1 28` | Qf6 | 漏看了 ♕xf6 消除保护，丢车 | 对 | 消除 f6 的保护者后吃掉 f8，净得 6 |
| 9 | [uvgE4](https://lichess.org/zsRNn4Cu/black#30) | ?? | `r2q1rk1/p4ppp/1p2pn2/2b5/Q3b3/2B2N2/PP2BPPP/3R1RK1 b - - 1 15` | Qe7 | 漏看了 ♗xf6 消除保护，丢象 | 对 | 消除 f6 的保护者后吃掉 e4，净得 2 |
| 10 | [m2uQw](https://lichess.org/k1ghkdHA/black#68) | ?? | `3r4/1R1nk3/r2p1npp/p2Pp3/P3N3/6PP/3N1P1K/1R6 b - - 7 34` | Rc8 | 漏看了 ♘xf6 消除保护，丢马 | 对 | 消除 f6 的保护者后吃掉 d7，净得 3 |
| 11 | [Gl4La](https://lichess.org/qK3Bq4e7#37) | ?? | `1brqr1k1/p2n2pp/2p2pb1/4p3/2P1N1P1/BP5P/P2PQPB1/R3R1K1 w - - 2 19` | Bd6 | 漏看了 ♝xe4 消除保护，丢象 | 对 | 消除 e4 的保护者后吃掉 d6，净得 3 |
| 12 | [Galpn](https://lichess.org/iU4mxl7i#31) | ? | `r1b2rk1/ppp3p1/3p2qp/3P1p2/1PBbp3/P2PBQ1P/2P2PP1/1R3RK1 w - - 0 16` | Qg3 | 漏看了 ♛xg3 消除保护，丢象 | 对 | 消除 g3 的保护者后吃掉 e3，净得 3 |
| 13 | [GhKhT](https://lichess.org/DAf2g1u5#27) | ?? | `r3qrk1/ppp3bp/n2p2p1/3P1b2/1PP2p2/P1N2N2/3QBPPP/R3K2R w KQ - 0 14` | O-O | 漏看了 ♝xc3 消除保护，丢象 | 对 | 消除 c3 的保护者后吃掉 e2，净得 3 |
| 14 | [eNAWD](https://lichess.org/ixZvSoFh/black#60) | ?? | `Rn1rrk2/1PR2p1p/6p1/3p4/5P2/6P1/4P2P/6K1 b - - 0 30` | Rd7 | 漏看了 ♖xb8 消除保护，丢马 | 对 | 消除 b8 的保护者后吃掉 d7，净得 3 |
| 15 | [WIZer](https://lichess.org/jCcQttdU#27) | ?? | `r1b1k2r/pp3ppp/1q2pP2/8/1bBQ4/5N2/P4PPP/RN2K2R w KQkq - 1 14` | Nc3 | 漏看了 ♛xd4 消除保护，丢马 | 对 | 消除 d4 的保护者后吃掉 c3，净得 6 |
| 16 | [m3VXc](https://lichess.org/fB6qjVXg#31) | ?? | `r4rk1/pppq2pp/2n1pp2/5n2/2PPb2B/4PN2/P2QBPPP/R2R2K1 w - - 3 16` | Qb2 | 漏看了 ♝xf3 消除保护，丢象 | 对 | 消除 f3 的保护者后吃掉 h4，净得 3 |
| 17 | [pT2DC](https://lichess.org/76iOuyuB#27) | ?? | `r4rk1/3bbppp/1qn1pn2/pp1pN1B1/3P4/1BN5/PPP2PPP/R2Q1RK1 w - - 0 14` | Nxd7 | 更好的是 ♗xf6（消除保护） | 对 | 消除 f6 的保护者后吃掉 d7，净得 2 |
| 18 | [5gAuk](https://lichess.org/PZTIEh3O#27) | ?? | `r3k2r/pb3ppp/2n1p3/bBp4q/8/2P2N2/PP2QPPP/R1B2RK1 w kq - 5 14` | Ne5 | 漏看了 ♛xe2 消除保护，丢马 | 对 | 消除 e2 的保护者后吃掉 e5，净得 3 |
| 19 | [PrQL4](https://lichess.org/8NtbdHvc/black#50) | ?? | `7r/2qnkppp/4p3/1Q6/8/2N3P1/4PP1P/3R2K1 b - - 4 25` | Rb8 | 漏看了 ♖xd7+ 消除保护，丢马 | 对 | 消除 d7 的保护者后吃掉 b8，净得 3 |
| 20 | [kNKVI](https://lichess.org/1jn9FrJt#47) | ?? | `2r2rk1/1p3pp1/1bn1q2p/pN1pP3/P2P4/2P2QP1/3B3P/R4RK1 w - - 9 24` | Nd6 | 漏看了 ♞xe5 消除保护，丢马 | 对 | 消除 e5 的保护者后吃掉 d6，净得 4 |
| 21 | [stYUn](https://lichess.org/bzb31VYt#51) | ?? | `3r1rk1/p1R2p1p/1p2q1p1/2nN4/2PQPR2/1P4P1/P6P/6K1 w - - 7 26` | Re7 | 漏看了 ♜xd5 消除保护，丢马 | 对 | 消除 d5 的保护者后吃掉 e7，净得 3 |
| 22 | [g1xXa](https://lichess.org/B0QeVI9u/black#58) | ?? | `r5k1/1p3ppp/p1p3b1/P2p4/1P1B3N/2Pn2R1/4r1PP/5RK1 b - - 1 29` | Rae8 | 漏看了 ♘xg6 消除保护，丢马 | 对 | 消除 g6 的保护者后吃掉 d3，净得 3 |
| 23 | [jB871](https://lichess.org/uiAhlegJ/black#32) | ?? | `2k4r/ppprpp1p/5npb/3P4/7q/P1N1BQP1/1PP2P1P/3RK2R b K - 0 16` | Qh5 | 漏看了 ♕xh5 消除保护，丢象 | 对 | 消除 h5 的保护者后吃掉 h6，净得 3 |
| 24 | [DdVVr](https://lichess.org/eG2tqvyc/black#30) | ?? | `r2q1rk1/ppp2pp1/2n1P3/2b2bNQ/3p4/2P5/P4PPP/R1B2RK1 b - - 0 15` | Bg6 | 漏看了 exf7+ 消除保护，丢象 | 对 | 消除 f7 的保护者后吃掉 g6，净得 3 |
| 25 | [2bILs](https://lichess.org/uxQjVAHH#39) | ?? | `3r1rk1/ppq2ppp/2n2n2/8/4b3/P4N1P/1P1BBPP1/2RQ1RK1 w - - 2 20` | Qb3 | 漏看了 ♝xf3 消除保护，丢象 | 对 | 消除 f3 的保护者后吃掉 d2，净得 3 |

### overload

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步是吃子；对方吃回用的子原本还保护着另一个 ≥ 3 分的子，被引开后那个子无保护，攻方下一步吃掉它；净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | Manito011235–thibault ply 56 | ? | `3r4/1p1rn1kp/p1q2pp1/8/3b1PP1/2NR1Q2/PPP2B2/2K1R3 w - - 2 29` | Qxc6 | 更好的是 ♗xd4（过载） | 对 | 人工：同上一手：Bxd4 之后 …Qxf3 Rxf3 Rxd4 Rxe7+，d7 车过载，e7 马丢掉（oracle：对方没有在那一格吃回） |
| 2 | [vQAFo](https://lichess.org/dOuROnbB/black#40) | ?? | `2rq1rk1/pp2bppp/4p3/1b1nP3/1P6/PQ3NP1/1B3PBP/R1R3K1 b - - 6 20` | Bg5 | 漏看了 ♖xc8 过载，丢象 | 对 | d8 的子被引到 c8，g5 失去保护被吃，净得 3 |
| 3 | [3DTXY](https://lichess.org/qdRq1Hhi#61) | ?? | `6k1/p5p1/1p3pQr/8/5P2/4q1pP/P1P3B1/1R3R1K w - - 1 31` | Qe4 | 漏看了 ♜xh3+ 过载，丢后 | 对 | g2 的子被引到 h3，e4 失去保护被吃，净得 6 |
| 4 | [ckSEK](https://lichess.org/JKDc30S8/black#34) | ?? | `rn3rk1/pp3p2/4pqnp/3p4/6Pb/3Q1N1P/PPP3K1/RNB3R1 b - - 1 17` | Nf4+ | 漏看了 ♗xf4 过载，丢象 | 对 | f6 的子被引到 f4，h4 失去保护被吃，净得 3 |
| 5 | [9DUrh](https://lichess.org/aP4HS9Rr/black#46) | ?? | `3r3k/2q3pp/8/p1p3Q1/2N5/1P2P2P/PB3rPb/R6K b - - 3 23` | Bg3 | 漏看了 ♗xg7+ 过载，丢车 | 对 | c7 的子被引到 g7，d8 失去保护被吃，净得 3 |
| 6 | [N4yOQ](https://lichess.org/I9hvkitL#33) | ?? | `r2qr1k1/1p3pbp/p1n3p1/2PN4/8/1P5P/P4PP1/R1BQR1K1 w - - 1 17` | Rb1 | 漏看了 ♜xe1+ 过载，丢马 | 对 | d1 的子被引到 e1，d5 失去保护被吃，净得 3 |
| 7 | [gaRCs](https://lichess.org/oelcxY3X#77) | ?? | `8/5ppk/7p/8/8/3q2PP/2r2P1K/1Q3R2 w - - 4 39` | Qd1 | 漏看了 ♜xf2+ 过载，丢后 | 对 | f1 的子被引到 f2，d1 失去保护被吃，净得 5 |
| 8 | [5hEHT](https://lichess.org/6dD33Kha/black#28) | ?? | `r2q1rk1/ppp1np1p/2bp1Qp1/8/2B1P3/2N5/PPP2PPP/3R1RK1 b - - 2 14` | Nc8 | 漏看了 ♗xf7+ 过载，丢后 | 对 | f8 的子被引到 f7，d8 失去保护被吃，净得 7 |
| 9 | [x0NUb](https://lichess.org/Q3lbacnQ/black#78) | ?? | `4r3/1p1Q1p1k/2p3p1/p2p2P1/5p1P/PP3P2/3qrRK1/5R2 b - - 1 39` | R8e7 | 漏看了 ♕xe7 过载，丢车 | 对 | e2 的子被引到 e7，d2 失去保护被吃，净得 5 |
| 10 | [8AnHQ](https://lichess.org/MQa0aKg5/black#54) | ?? | `1r3q1k/Q5pp/2p5/3p1p2/3B4/1P6/3n2PP/3R2K1 b - - 0 27` | Nxb3 | 漏看了 ♗xg7+ 过载，丢车 | 对 | f8 的子被引到 g7，b8 失去保护被吃，净得 5 |
| 11 | Manito011235–thibault ply 55 | ? | `3r4/1p1rn1kp/p3qpp1/8/3b1PP1/2NR1Q2/PPP2B2/2K1R3 b - - 1 28` | Qc6 | 漏看了 ♗xd4 过载，丢马 | 对 | 人工：对方先换后（…Qxf3 Rxf3）再在 d4 吃回，它保护的 e7 马随即被 Rxe7+ 吃掉：过载成立，只是次序不同（oracle：对方没有在那一格吃回） |
| 12 | [uIhQH](https://lichess.org/qFEEIqa8/black#42) | ?? | `3r1rk1/2q2ppp/p3pb2/4B3/6R1/2PB2Q1/5PPP/3R2K1 b - - 0 21` | Bxe5 | 漏看了 ♖xg7+ 过载，丢后 | 对 | e5 的子被引到 g7，c7 失去保护被吃，净得 2 |
| 13 | [L1oND](https://lichess.org/iHdr78wo/black#38) | ?? | `6k1/pp3ppp/1qpr1n2/4r3/4P3/2N2RQ1/PPP3PP/1R5K b - - 1 19` | Rde6 | 漏看了 ♖xf6 过载，丢马 | 对 | e6 的子被引到 f6，e5 失去保护被吃，净得 3 |
| 14 | [2LNkw](https://lichess.org/4hCDHBBm/black#54) | ?? | `2rr2k1/p4p1p/1p3qp1/3R4/2B1n1Q1/1P5P/P4PP1/5RK1 b - - 0 27` | Nd2 | 漏看了 ♖xd2 过载，丢马 | 对 | d8 的子被引到 d2，c8 失去保护被吃，净得 3 |
| 15 | [JXaBE](https://lichess.org/gWdpgWWx/black#50) | ?? | `r5k1/1bq2pp1/p3rn1p/2n1p3/2p1P3/2P1QPNP/P1B3PN/2RR2K1 b - - 7 25` | Rd8 | 漏看了 ♖xd8+ 过载，丢马 | 对 | c7 的子被引到 d8，c5 失去保护被吃，净得 3 |
| 16 | [WreGp](https://lichess.org/6op4xLav/black#40) | ?? | `r5k1/p1pq1p1p/1p4p1/4Rb2/2B5/1QP5/PP3PPP/6K1 b - - 0 20` | Re8 | 漏看了 ♗xf7+ 过载，丢车 | 对 | d7 的子被引到 f7，e8 失去保护被吃，净得 3 |
| 17 | [dtBTF](https://lichess.org/J0bxDnzR/black#40) | ?? | `r4rk1/pp1nQp1p/2pP2p1/5bB1/2B5/1Pq2N2/P4PPP/4R1K1 b - - 2 20` | Rae8 | 漏看了 ♗xf7+ 过载，丢车 | 对 | f8 的子被引到 f7，e8 失去保护被吃，净得 3 |
| 18 | [8OH2t](https://lichess.org/Q2LBggng#47) | ?? | `2r2rk1/5ppp/8/1p1Pp3/3qP3/3p3P/1P1Q2P1/2RR3K w - - 0 24` | Qxd3 | 漏看了 ♛xd3 过载，丢车 | 对 | d1 的子被引到 d3，c1 失去保护被吃，净得 3 |
| 19 | [9h9Oa](https://lichess.org/TJ4BS0iO#43) | ?? | `2r3k1/4bbpp/pqr4n/1p1ppP2/8/1P4QP/PB1NB1P1/2R2R1K w - - 0 22` | Bxe5 | 漏看了 ♞xf5 过载，丢车 | 对 | f1 的子被引到 f5，c1 失去保护被吃，净得 2 |
| 20 | [m5DEE](https://lichess.org/7A9uaMKl#51) | ?? | `5r1k/1pp3pn/1pqp3p/4pN2/4P3/2BQ3P/1P2RPP1/6K1 w - - 0 26` | Qd5 | 漏看了 ♛xd5 过载，丢马 | 对 | e4 的子被引到 d5，f5 失去保护被吃，净得 3 |
| 21 | [tb28n](https://lichess.org/3uBVMvtP#35) | ?? | `4r1k1/2rbppbp/p2p2p1/1p1P4/2q5/P1P1BP2/1P1QN1PP/3R1RK1 w - - 3 18` | Bh6 | 漏看了 ♝xh6 过载，丢马 | 对 | d2 的子被引到 h6，e2 失去保护被吃，净得 3 |
| 22 | [vCnBu](https://lichess.org/l4mPuF1s#69) | ?? | `4r1k1/6pp/p7/1qB2pP1/5P2/3b3P/1P3Q1K/2R5 w - - 9 35` | Re1 | 漏看了 ♜xe1 过载，丢象 | 对 | f2 的子被引到 e1，c5 失去保护被吃，净得 3 |

### deflection

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步不是吃子（弃子）；对方吃它用的子原本保护着另一个 ≥ 3 分的子，被引开后那个子无保护，攻方下一步吃掉它；净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [u6UOs](https://lichess.org/CRxfCCd3/black#68) | ?? | `2q1r2k/6bp/p2P3p/8/2r1pBP1/1Q5P/P5B1/4R1K1 b - - 6 34` | e3 | 漏看了 d7 引离，丢车 | 对 | c8 的子被引到 d7，c4 失去保护被吃，净得 4 |
| 2 | [npu9G](https://lichess.org/0kha1kER#51) | ?? | `r3r1k1/1bp3p1/p4q1p/1p2NQ2/P2P1n2/1PP3N1/5P1P/R2R2K1 w - - 2 26` | axb5 | 漏看了 ♞e2+ 引离，丢后 | 对 | g3 的子被引到 e2，f5 失去保护被吃，净得 4 |
| 3 | [S3vja](https://lichess.org/ieeNnDCb#35) | ?? | `1k2r3/pp1q2pp/8/2p5/3n2n1/2NP1Q2/PPPB1PPP/R5K1 w - - 2 18` | Qd5 | 漏看了 ♞e2+ 引离，丢后 | 对 | c3 的子被引到 e2，d5 失去保护被吃，净得 6 |
| 4 | [mwbi7](https://lichess.org/730Yxlg4#55) | ?? | `4rbk1/1p3p1p/p2Q1pp1/5P2/qPP5/P4R1P/6P1/3R3K w - - 1 28` | Qd7 | 漏看了 ♜e1+ 引离，丢后 | **错** | 对方没有在那一格吃回 |
| 5 | [8b5BJ](https://lichess.org/gVzDwArI/black#64) | ?? | `1r4k1/2Q2p1p/4p1pb/p3P3/1q6/1P3N1P/P5P1/3R3K b - - 5 32` | Qb6 | 漏看了 ♖d8+ 引离，丢后 | 对 | b8 的子被引到 d8，b6 失去保护被吃，净得 4 |
| 6 | [kqAy6](https://lichess.org/7Hi9wqkZ/black#50) | ?? | `2r3k1/pQ3pp1/3q3p/2p5/8/P6P/5PP1/4R1K1 b - - 3 25` | Qc7 | 漏看了 ♖e8+ 引离，丢后 | 对 | c8 的子被引到 e8，c7 失去保护被吃，净得 4 |
| 7 | [9kWXD](https://lichess.org/2OkkGLT2#53) | ?? | `3r1k2/1p1r1p1p/p5p1/3n1N2/8/3RP3/PP3KPP/3R4 w - - 0 27` | e4 | 漏看了 ♞c3 引离，丢车 | 对 | d3 的子被引到 c3，d1 失去保护被吃，净得 2 |
| 8 | [LzIoM](https://lichess.org/Js0ZA5Gi/black#66) | ?? | `4r2k/p5p1/2p1qnQp/8/3P3P/8/1P4P1/5R1K b - - 1 33` | Nd5 | 漏看了 ♖f8+ 引离，丢后 | 对 | e8 的子被引到 f8，e6 失去保护被吃，净得 4 |
| 9 | [0z8E8](https://lichess.org/Jd7yVAg5#51) | ?? | `2r3k1/5ppp/8/1q6/8/2P2P2/P1Q1r1PP/2RR3K w - - 7 26` | Qd3 | 漏看了 ♜e1+ 引离，丢后 | 对 | d1 的子被引到 e1，d3 失去保护被吃，净得 4 |
| 10 | [o0ARf](https://lichess.org/2kBEwtmz/black#64) | ?? | `r1r3k1/5pp1/2q1p3/8/1p4PP/1P3NK1/P2R1P2/3Q4 b - - 0 32` | Qc1 | 漏看了 ♖d8+ 引离，丢后 | 对 | c8 的子被引到 d8，c1 失去保护被吃，净得 3 |
| 11 | [ORQtj](https://lichess.org/O02DEuCS#57) | ?? | `qr4k1/5ppp/1n2p3/BQ1p4/3P4/P3PP2/6PP/1R4K1 w - - 3 29` | a4 | 漏看了 ♞d7 引离，丢车 | 对 | b5 的子被引到 d7，b1 失去保护被吃，净得 2 |
| 12 | [nFFqW](https://lichess.org/SJPyS8pa#47) | ?? | `r1bk4/pp6/1np2p2/3p3B/2nP2pP/qPPQ4/P2RNPP1/2K4R w - - 1 24` | Kb1 | 漏看了 ♝f5 引离，丢车 | 对 | d3 的子被引到 f5，d2 失去保护被吃，净得 2 |
| 13 | [YsVhu](https://lichess.org/JTeY12b1#57) | ?? | `4r2k/1pq3p1/p6p/8/6Q1/7P/PP3PP1/3R2K1 w - - 0 29` | Qd7 | 漏看了 ♜e1+ 引离，丢后 | 对 | d1 的子被引到 e1，d7 失去保护被吃，净得 4 |
| 14 | [57wQs](https://lichess.org/igqrA5Ke/black#48) | ?? | `2rq3k/p5p1/1p5p/2p1Q3/3p4/3P3P/PPP3P1/5RK1 b - - 1 24` | Qc7 | 漏看了 ♖f8+ 引离，丢后 | 对 | c8 的子被引到 f8，c7 失去保护被吃，净得 4 |
| 15 | [YmgNi](https://lichess.org/ZnOnws0k/black#42) | ?? | `4rr1k/1pp3pp/1n1b4/p5N1/P2PR1bq/1BP2p1P/1PQ2P2/R1B3K1 b - - 0 21` | Bf5 | 漏看了 ♘f7+ 引离，丢车 | 对 | f8 的子被引到 f7，e8 失去保护被吃，净得 7 |
| 16 | [MLYYs](https://lichess.org/hGQamInm/black#68) | ?? | `2r4k/6p1/Q4p1p/1p2pP2/8/P1q4P/6P1/3R3K b - - 0 34` | Qc6 | 漏看了 ♖d8+ 引离，丢后 | 对 | c8 的子被引到 d8，c6 失去保护被吃，净得 4 |
| 17 | [fYDBv](https://lichess.org/NfS08tzV/black#90) | ?? | `8/p2p1p2/1p2p3/6Bk/1P3Q2/6P1/2P1qn2/2K5 b - - 17 45` | Qe4 | 漏看了 g4+ 引离，丢后 | 对 | f2 的子被引到 g4，e4 失去保护被吃，净得 5 |
| 18 | [pnTix](https://lichess.org/kjaNPq6g#63) | ?? | `5r2/p4pk1/1p6/6pp/1P3n1q/4RQ2/P5B1/3R2K1 w - - 2 32` | Qg3 | 漏看了 ♞e2+ 引离，丢后 | 对 | e3 的子被引到 e2，g3 失去保护被吃，净得 6 |
| 19 | [cYxyr](https://lichess.org/rjtn8vBf/black#66) | ?? | `2q2rk1/5pp1/1P4np/8/3QP3/2P3P1/5P2/R5K1 b - - 0 33` | Rd8 | 漏看了 b7 引离，丢车 | 对 | c8 的子被引到 b7，d8 失去保护被吃，净得 4 |
| 20 | [GCBCc](https://lichess.org/O4g5QrSo#35) | ?? | `r1qr2k1/1p3pbp/p1p3p1/4B2n/2PQ4/P1N1P2P/1P3PP1/R4RK1 w - - 2 18` | Qc5 | 漏看了 b6 引离，丢象 | 对 | c5 的子被引到 b6，e5 失去保护被吃，净得 2 |
| 21 | [WQpSu](https://lichess.org/pdJSu60o#37) | ?? | `r3r3/pp2Qpkp/6p1/1q6/8/1P6/P4PPP/R2R2K1 w - - 1 19` | Qd7 | 漏看了 ♜e1+ 引离，丢后 | 对 | d1 的子被引到 e1，d7 失去保护被吃，净得 4 |
| 22 | [so2D7](https://lichess.org/hBfM5Qdc/black#58) | ?? | `r7/1p5k/p1p3np/3p1q2/3Q2PP/2P5/PP3P2/4R1K1 b - - 0 29` | Qf4 | 漏看了 ♖e7+ 引离，丢后 | 对 | g6 的子被引到 e7，f4 失去保护被吃，净得 4 |
| 23 | [aSWoZ](https://lichess.org/jfD6OlGa/black#36) | ? | `rn2k2r/p4p1p/1p2p1p1/1BqpP3/7Q/1R5P/P1P2PP1/5RK1 b kq - 1 18` | Nc6 | 漏看了 ♕b4 引离 | 对 | c5 的子被引到 b4，c6 失去保护被吃，净得 3 |
| 24 | [mWgU4](https://lichess.org/BINnXu9m/black#38) | ?? | `r3k2r/qp3ppp/4p1n1/1p1pP3/1Q6/1P3N2/P4PPP/2R2RK1 b kq - 1 19` | Qa5 | 漏看了 ♖c8+ 引离，丢后 | 对 | a8 的子被引到 c8，a5 失去保护被吃，净得 4 |
| 25 | [N4XPb](https://lichess.org/1FPkrqtT/black#60) | ?? | `4b1k1/p3Q2p/1p1p1Pp1/5p2/q4P2/3P2N1/1P3K1P/8 b - - 3 30` | Qd7 | 漏看了 f7+ 引离，丢后 | 对 | e8 的子被引到 f7，d7 失去保护被吃，净得 8 |

### decoy

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步不是吃子（弃子），对方的王或后吃了它；攻方下一步打到了站在那里的王或后；深搜线得子 ≥ 1 或将死。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [Ddvwp](https://lichess.org/rIRD9nw7/black#126) | ?? | `8/1kP3b1/3Bp2p/2K1P3/2B3p1/6P1/8/1r6 b - - 4 63` | Rb2 | 漏看了 ♗a6+ 引入 | 对 | 把王引到 a6 后打到它，深搜将死 |
| 2 | [QgSt3](https://lichess.org/zC42zNbH/black#56) | ?? | `4r3/2pQ1b2/2p2Pkp/ppq1r1p1/4P2P/2N5/PPP3P1/4R2K b - - 0 28` | Qd6 | 漏看了 h5+ 引入，丢象 | 对 | 把王引到 h5 后打到它，深搜净得 2 |
| 3 | [2UKbk](https://lichess.org/zDiyoDne/black#74) | ?? | `1R6/1P2rppk/4p2p/1n1p4/8/6P1/4qPBP/2R3K1 b - - 0 37` | Nd6 | 漏看了 ♖h8+ 引入 | 对 | 把王引到 h8 后打到它，深搜净得 3 |
| 4 | [6jZHr](https://lichess.org/MmaGRNWO/black#80) | ?? | `8/p4pqp/2pQ2k1/5pr1/1P6/PK5R/7P/8 b - - 1 40` | Qf6 | 漏看了 ♖h6+ 引入，丢后 | 对 | 把王引到 h6 后打到它，深搜净得 5 |
| 5 | [BVQ2Z](https://lichess.org/E3Gv83mW/black#84) | ?? | `8/3Q3p/5p1P/p2p2p1/6k1/4P3/P4P1K/1q6 b - - 1 42` | Qf5 | 漏看了 f3+ 引入，丢后 | 对 | 把王引到 f3 后打到它，深搜净得 9 |
| 6 | [Ho9vI](https://lichess.org/9eHroAWs/black#78) | ?? | `8/4Q1kp/5p1n/p3pP1P/Pp2P1p1/8/1P6/1K1B2q1 b - - 2 39` | Nf7 | 漏看了 h6+ 引入 | 对 | 把王引到 h6 后打到它，深搜净得 3 |
| 7 | [oow22](https://lichess.org/LTJCtOfQ/black#62) | ?? | `r1r5/7k/4p1pP/pp1q2N1/1b3B2/5P2/PPp5/K1Q4R b - - 1 31` | Kh8 | 漏看了 ♗e5+ 引入 | 对 | 把后引到 e5 后打到它，深搜净得 6 |
| 8 | [aO0Bd](https://lichess.org/vhWAhDcJ/black#82) | ?? | `2R5/p1P2pk1/1b4p1/7p/8/1B4PK/5r2/8 b - - 0 41` | Rb2 | 漏看了 ♖g8+ 引入 | 对 | 把王引到 g8 后打到它，深搜净得 4 |
| 9 | [pXB2a](https://lichess.org/B9aWhU3k#103) | ?? | `2r5/2P5/8/1R6/3R4/2k3P1/p4PKP/r7 w - - 2 52` | Rd8 | 漏看了 ♜g1+ 引入 | 对 | 把王引到 g1 后打到它，深搜净得 3 |
| 10 | [pUkFR](https://lichess.org/DJmIG8vR#55) | ?? | `6k1/R5p1/1p5p/1Qp5/P7/2P4r/1P4P1/1q4K1 w - - 1 28` | Qf1 | 漏看了 ♜h1+ 引入，丢后 | 对 | 把王引到 h1 后打到它，深搜净得 4 |
| 11 | [YevA0](https://lichess.org/YPFGdlf0#57) | ?? | `5bk1/5p1p/4p1p1/4P3/p2BqP2/4P1P1/PP1RQK1P/2r5 w - - 15 29` | Qf3 | 漏看了 ♜f1+ 引入，丢后 | 对 | 把王引到 f1 后打到它，深搜净得 4 |
| 12 | [6Ehjh](https://lichess.org/pAfotTUx/black#94) | ?? | `8/pp4R1/6k1/P4q2/8/3Q4/1Pr3rP/1K6 b - - 5 47` | Kf6 | 漏看了 ♖f7+ 引入，丢后 | 对 | 把王引到 f7 后打到它，深搜净得 5 |
| 13 | [mjL3V](https://lichess.org/pEIz99y8#75) | ?? | `8/8/2p3k1/1pb1p2p/4P3/2P2PK1/1P4P1/4B3 w - - 0 38` | Bf2 | 漏看了 h4+ 引入，丢象 | 对 | 把王引到 h4 后打到它，深搜净得 2 |
| 14 | [5gUNE](https://lichess.org/LgWvDtfp/black#88) | ?? | `1k1r1b2/4n3/2P1Q2p/1P2Pp2/3p1Pp1/r5P1/5B1P/6K1 b - - 0 44` | d3 | 漏看了 c7+ 引入 | 对 | 把王引到 c7 后打到它，深搜净得 4 |
| 15 | [mUUDy](https://lichess.org/3TWVsasT#83) | ?? | `7k/8/3P2Q1/8/pbB1pP1q/4P3/1P3KP1/8 w - - 1 42` | Qg3 | 漏看了 ♝e1+ 引入，丢后 | 对 | 把王引到 e1 后打到它，深搜净得 6 |
| 16 | [Kc6O3](https://lichess.org/3vRaB1tU#63) | ?? | `8/p4B1k/6pr/2p1pQ2/3qP3/2N3P1/PPP3K1/8 w - - 0 32` | Qf2 | 漏看了 ♜h2+ 引入，丢后 | 对 | 把王引到 h2 后打到它，深搜净得 7 |
| 17 | [xMDjw](https://lichess.org/aKSsXe5L/black#26) | ?? | `r1b4r/ppqpn1kp/6p1/4b3/4P3/2N2QP1/PP3P1P/R1B2RK1 b - - 0 13` | Rf8 | 漏看了 ♗h6+ 引入，丢车 | 对 | 把王引到 h6 后打到它，深搜净得 5 |
| 18 | [38dY5](https://lichess.org/yNE3aGNm#99) | ?? | `8/8/7P/3k4/3p4/8/p2R1PPK/r7 w - - 0 50` | h7 | 漏看了 ♜h1+ 引入 | 对 | 把王引到 h1 后打到它，深搜净得 3 |
| 19 | [Pk7bA](https://lichess.org/kIr3f1s1#63) | ?? | `rbR5/1p3k2/p1p5/3p1pn1/3P4/2PB1P1P/PPQ3P1/4RK1q w - - 3 32` | Kf2 | 漏看了 ♝g3+ 引入，丢车 | 对 | 把王引到 g3 后打到它，深搜净得 2 |
| 20 | [8yVoB](https://lichess.org/NfDeMHoX/black#30) | ?? | `1r1q1rk1/ppp2pp1/3p1n1p/8/1Q2P1bB/2P5/P1PN1PPP/R4RK1 b - - 3 15` | Qe7 | 漏看了 e5 引入，丢马 | 对 | 把后引到 e5 后打到它，深搜净得 2 |
| 21 | [wi7nn](https://lichess.org/6qMXSzuI/black#92) | ?? | `8/P7/7p/8/P7/6k1/3r1b2/5R1K b - - 0 46` | Be3 | 漏看了 ♖f3+ 引入 | 对 | 把王引到 f3 后打到它，深搜净得 3 |
| 22 | [m6LW4](https://lichess.org/2FkMaWJ3/black#72) | ?? | `r3r3/4kp2/5qpQ/pp6/4N2P/P7/1P4P1/3R3K b - - 4 36` | Rh8 | 漏看了 ♖d7+ 引入，丢后 | 对 | 把王引到 d7 后打到它，深搜净得 4 |
| 23 | [eaj5Q](https://lichess.org/qOfpX6JX#85) | ?? | `8/1Q3ppk/4n3/8/1K2P2p/5r2/P6P/8 w - - 0 43` | a4 | 漏看了 ♜b3+ 引入 | 对 | 把王引到 b3 后打到它，深搜净得 4 |

### pin

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步之后有一个子站在攻方长兵器与它身后更值钱的己方子（或王）之间；深搜线里它被吃掉（原地，或沿着牵制线走开之后），或它离开了线、身后的子被吃；这步本身不是白吃一子；算到那一吃之后，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | low-skill 2 (skill 2–1) ply 57 | ? | `3r4/1k2n3/1q2b3/p1R3Q1/1p2P2p/8/1P4PP/R3K3 b - - 0 29` | Nc6 | 漏看了 ♖b5 牵制，丢后 | 对 | b6 的子被 b5 钉在 b7 前面，深搜线上吃到，净得 4 |
| 2 | low-skill 5 (skill 0–1) ply 35 | ? | `r4rk1/2pn3p/bpqbp1p1/1N1n1P2/p1BP2RP/P3PN2/1PQB1P2/R3K3 b Q - 2 18` | exf5 | 更好的是 ♝xb5（牵制） | 对 | f5 的子被 f8 钉在 f3 前面，深搜线上吃到，净得 6 |
| 3 | low-skill 5 (skill 0–1) ply 34 | ?? | `r4rk1/2pn3p/bpqbp1p1/1N1n1P2/p1BP3P/P3PN2/1PQB1P2/R3K1R1 w Q - 1 18` | Rg4 | 漏看了 ♝xb5 牵制，丢马 | 对 | f5 的子被 f8 钉在 f3 前面，深搜线上吃到，净得 6 |
| 4 | [dT2y6](https://lichess.org/NyKbInlc#67) | ?? | `3r2k1/6pp/p2b1p2/3p1b1q/PP1P1P1P/4R3/1P1B1Q1P/R6K w - - 3 34` | Qf3 | 漏看了 ♝e4 牵制，丢后 | 对 | f3 的子被 e4 钉在 h1 前面，深搜线上吃到，净得 6 |
| 5 | [oAMKx](https://lichess.org/l5rBz32a#41) | ?? | `1r2r1k1/3b1pp1/2p4p/q3p3/4R3/2b3B1/PPQ2PPP/1R3BK1 w - - 0 21` | Qxc3 | 漏看了 ♛xc3 牵制，丢后 | 对 | b2 的子被 b8 钉在 b1 前面，深搜线上吃到，净得 2 |
| 6 | [C6hsk](https://lichess.org/lxvG6UYh#61) | ?? | `2rr4/pq1k2p1/3b1pPp/1PpRpP2/P1R1P3/5N1P/2Q5/6K1 w - - 1 31` | Rcxc5 | 漏看了 ♛b6 牵制 | 对 | c5 的子被 c8 钉在 c2 前面，深搜线上吃到，净得 3 |
| 7 | [VR09y](https://lichess.org/dVbWPaYk#29) | ?? | `2r2rk1/pp2bppp/2n5/2pq4/P4p2/1P1P4/1BPQN1PP/2KR3R w - - 0 15` | Qxf4 | 漏看了 ♝g5 牵制，丢后 | 对 | f4 的子被 g5 钉在 c1 前面，深搜线上吃到，净得 5 |
| 8 | [SXcF2](https://lichess.org/nObeqTfE#35) | ?? | `1rk4r/2p3Rp/3b4/7q/3Q4/2N5/PPP3PP/R5K1 w - - 1 18` | h3 | 漏看了 ♝c5 牵制，丢后 | 对 | d4 的子被 c5 钉在 g1 前面，深搜线上吃到，净得 6 |
| 9 | [x3xuz](https://lichess.org/PNvmHosF/black#30) | ?? | `r3kb1r/ppp2ppp/4q3/8/8/2P1PB2/PP2Q2P/R3KR2 b Qkq - 0 15` | O-O-O | 漏看了 ♗g4 牵制，丢后 | 对 | e6 的子被 g4 钉在 c8 前面，深搜线上吃到，净得 7 |
| 10 | [jiXt2](https://lichess.org/pvg1hUD2#135) | ?? | `r7/2k5/3p4/N2Pp3/K1p1Pp2/1R3P2/8/8 w - - 0 68` | Rc3 | 漏看了 ♚b6 牵制，丢马 | 对 | a5 的子被 a8 钉在 a4 前面，深搜线上吃到，净得 2 |
| 11 | [TYzuY](https://lichess.org/9thzT2cv/black#16) | ?? | `rn2kb1r/ppp2ppp/2q1pn2/5b2/3P4/P1N1P3/1P3PPP/R1BQKBNR b KQkq - 4 8` | Ne4 | 漏看了 ♗b5 牵制，丢后 | 对 | c6 的子被 b5 钉在 e8 前面，深搜线上吃到，净得 6 |
| 12 | [4uusJ](https://lichess.org/f8SE8Ogb#53) | ?? | `r4rk1/p2q2p1/1p2b2p/3p4/3P2PP/1PN2R2/1PP3Q1/3K3R w - - 1 27` | Rg1 | 漏看了 ♝xg4 牵制 | 对 | f3 的子被 g4 钉在 d1 前面，深搜线上吃到，净得 2 |
| 13 | [PrxoV](https://lichess.org/gGQnoZ4T/black#44) | ?? | `r3r1k1/ppp2pbp/2b3p1/8/3qNQ2/2P5/PP3PPP/1RB1R1K1 b - - 0 22` | Qc4 | 更好的是 ♛d3（牵制） | 对 | e4 的子被 e8 钉在 e1 前面，深搜线上吃到，净得 3 |
| 14 | [kBYqu](https://lichess.org/GwAeOdUY#111) | ?? | `3k4/8/3K4/1p1R4/1P1P4/2b4p/8/8 w - - 0 56` | Rc5 | 漏看了 ♝xb4 牵制，丢车 | 对 | c5 的子被 b4 钉在 d6 前面，深搜线上吃到，净得 5 |
| 15 | [iMi8A](https://lichess.org/Dp7KfP6L/black#72) | ?? | `2r1r1k1/pp3Rp1/3b2p1/7q/7P/2PB1Nn1/PP3Q2/3R2K1 b - - 0 36` | Kxf7 | 更好的是 ♝c5（牵制） | 对 | f2 的子被 c5 钉在 g1 前面，深搜线上吃到，净得 7 |
| 16 | [QBW7x](https://lichess.org/4rQjXRQB#99) | ?? | `6k1/3NK1p1/7p/7P/6P1/8/1b6/8 w - - 7 50` | Nc5 | 漏看了 ♝a3 牵制，丢马 | 对 | c5 的子被 a3 钉在 e7 前面，深搜线上吃到，净得 3 |
| 17 | [DLp8Q](https://lichess.org/h25mZmvX/black#70) | ?? | `1k6/p2n3p/2p5/4nPB1/3bK3/1P4P1/P5N1/8 b - - 5 35` | Bf2 | 漏看了 ♗f4 牵制 | 对 | e5 的子被 f4 钉在 b8 前面，深搜线上吃到，净得 2 |
| 18 | [KliiJ](https://lichess.org/IyXIL7K3/black#46) | ?? | `5qk1/p1p3pp/8/1n1pN1Qb/3P4/1PPP4/P5PP/6K1 b - - 1 23` | Bg6 | 漏看了 ♘xg6 牵制，丢兵 | 对 | d5 的子被 g5 钉在 b5 前面，深搜线上吃到，净得 1 |
| 19 | [8z5eU](https://lichess.org/NE5rj9gE#125) | ?? | `8/8/5p2/2P2N1b/5k2/3K4/8/8 w - - 2 63` | c6 | 漏看了 ♝g6 牵制，丢马 | 对 | f5 的子被 g6 钉在 d3 前面，深搜线上吃到，净得 3 |
| 20 | [QqUTN](https://lichess.org/c8Y7X9Xv#67) | ?? | `5n1k/p1r4p/2pp1p2/4PP1R/qp1P4/2PB1N2/1K4Q1/8 w - - 0 34` | Qc2 | 漏看了 ♛a3+ 牵制，丢兵 | 对 | c3 的子被 a3 钉在 d3 前面，深搜线上吃到，净得 1 |
| 21 | [v6NT8](https://lichess.org/gOzrFyry#101) | ?? | `8/4bk2/4b3/1P2P2r/8/8/5KQ1/8 w - - 3 51` | Qg3 | 漏看了 ♝h4 牵制，丢后 | 对 | g3 的子被 h4 钉在 f2 前面，深搜线上吃到，净得 6 |
| 22 | [GQ2l5](https://lichess.org/15Gp2DsQ/black#72) | ?? | `8/8/1R3pqk/2p1p2p/2PpP2P/3r2P1/5QK1/8 b - - 1 36` | Re3 | 漏看了 ♖xf6 牵制 | 对 | g6 的子被 f6 钉在 h6 前面，深搜线上吃到，净得 4 |
| 23 | [g0imF](https://lichess.org/FwAkVH0D/black#98) | ?? | `8/pk6/b3P1p1/1p4b1/4K3/2P5/8/5R2 b - - 1 49` | Be7 | 漏看了 ♖f7 牵制，丢象 | 对 | e7 的子被 f7 钉在 b7 前面，深搜线上吃到，净得 3 |
| 24 | [asjjs](https://lichess.org/pirgHuYk#47) | ?? | `1r4nr/4bkp1/2B1pp2/1p6/3P3P/8/PP1B1P2/R3K1R1 w Q - 1 24` | O-O-O | 漏看了 ♜c8 牵制，丢象 | 对 | c6 的子被 c8 钉在 c1 前面，深搜线上吃到，净得 3 |
| 25 | [5lU7N](https://lichess.org/IXlv4azj#49) | ?? | `r5k1/p3r2p/1pp3p1/2p1bp2/4P2P/2PPB3/PP2K1P1/1R1R4 w - - 0 25` | exf5 | 漏看了 ♝f4 牵制，丢象 | 对 | e3 的子被 e7 钉在 e2 前面，深搜线上吃到，净得 2 |

### skewer

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。走到的长兵器线上前面是更值钱的子（或王），后面是 ≥ 3 分的子；深搜线里前面的子让开、后面的子被吃；或者前面的子走不开、在原地被吃（这步是将军时不算：那是捉双）；净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [6dZ5n](https://lichess.org/NdWCumsH#103) | ?? | `6rk/p7/8/5R2/2P1R3/4P1KP/6P1/3n3r w - - 1 52` | Kf3 | 漏看了 ♜f1+ 串击，丢车 | 对 | 串击 f3→f5，深搜吃到，净得 2 |
| 2 | [G7LU8](https://lichess.org/wXDazU5e#103) | ?? | `8/2p3R1/1k1p4/1p1Pp3/2r1P3/4PK2/7R/8 w - - 2 52` | Ke2 | 漏看了 ♜c2+ 串击，丢车 | 对 | 串击 e2→h2，深搜吃到，净得 5 |
| 3 | [cCZ1a](https://lichess.org/4MU3qL8m/black#78) | ?? | `8/6kp/ppq2P2/1n3P2/1P6/P1p1Q3/7P/2B3K1 b - - 0 39` | Kxf6 | 漏看了 ♕h6+ 串击，丢后 | 对 | 串击 f6→c6，深搜吃到，净得 7 |
| 4 | [UWmQS](https://lichess.org/9RndYZ0N/black#46) | ?? | `2r3k1/pQ4pp/2pb1p2/3p1q2/3P1P2/8/PP1B2PP/4R1K1 b - - 0 23` | Rc7 | 漏看了 ♕b8+ 串击，丢象 | **错** | 深搜线上没吃到线上的子 |
| 5 | [MzM21](https://lichess.org/vpK4qiu3#81) | ?? | `8/5R2/p3p2k/8/1Pp5/P1Rb4/8/4r1K1 w - - 1 41` | Kf2 | 漏看了 ♜f1+ 串击，丢车 | 对 | 串击 f2→f7，深搜吃到，净得 5 |
| 6 | [pVnii](https://lichess.org/4HBWu7Me/black#128) | ?? | `8/5pp1/8/3kP2p/p1q4P/P4RBK/6P1/8 b - - 13 64` | Ke4 | 漏看了 ♖f4+ 串击，丢后 | 对 | 串击 e4→c4，深搜吃到，净得 3 |
| 7 | [r5Mbc](https://lichess.org/yLFUEyaA/black#68) | ?? | `4k3/6R1/7r/1rp2p1p/1b1PpP2/4P2p/2K4P/R7 b - - 1 34` | Rb8 | 漏看了 ♖g8+ 串击，丢车 | 对 | 串击 e8→b8，深搜吃到，净得 5 |
| 8 | [aI6Bj](https://lichess.org/XT2emInI/black#26) | ?? | `4rb1r/pp1k1ppp/2np4/2p2q2/4N3/3Q4/PPP2PPP/R1B1R1K1 b - - 7 13` | Nb4 | 漏看了 ♕b5+ 串击，丢车 | 对 | 串击 d7→e8，深搜吃到，净得 3 |
| 9 | [cqh3R](https://lichess.org/iBb8lt5u#61) | ?? | `6rk/2p2p1n/1p1p4/p2PbPq1/8/P2R3Q/1P2BP1P/1R3K2 w - - 4 31` | Bf3 | 漏看了 ♛g1+ 串击，丢车 | 对 | 串击 f1→b1，深搜吃到，净得 5 |
| 10 | [Lb1wT](https://lichess.org/z2XL8NPu/black#54) | ?? | `5Q1R/ppkr4/2p5/3pqp2/8/P7/1PP5/1K6 b - - 5 27` | f4 | 漏看了 ♕b8+ 串击，丢后 | 对 | 串击 c7→e5，深搜吃到，净得 9 |
| 11 | [9RfxO](https://lichess.org/1LvyQMya#55) | ?? | `6k1/4Rp1p/p1q3p1/1pp1n3/3b1Q2/6P1/PP3P1P/R5K1 w - - 1 28` | Kf1 | 漏看了 ♛h1+ 串击，丢车 | 对 | 串击 f1→a1，深搜吃到，净得 5 |
| 12 | [sFCKD](https://lichess.org/1hjZv2gJ/black#36) | ?? | `2rqr3/pp2kp2/3bp1BB/3p4/2n2P2/2P5/PP4PP/R2Q1RK1 b - - 0 18` | fxg6 | 漏看了 ♗g5+ 串击，丢后 | 对 | 串击 e7→d8，深搜吃到，净得 3 |
| 13 | [oI3JI](https://lichess.org/o83iUlHS#97) | ?? | `8/3bkp2/6p1/1p1KPnNp/1P3P1P/1BP5/8/8 w - - 1 49` | Nf3 | 漏看了 ♝e6+ 串击，丢象 | 对 | 串击 d5→b3，深搜吃到，净得 2 |
| 14 | [vFsEF](https://lichess.org/T3p3j3EG/black#66) | ?? | `2r5/4kp1p/5p2/8/3bP3/2p2PP1/2K4P/2R2B2 b - - 1 33` | Ke6 | 漏看了 ♗h3+ 串击，丢车 | 对 | 串击 e6→c8，深搜吃到，净得 5 |
| 15 | [nZilC](https://lichess.org/oSYudG33/black#60) | ?? | `1r1qRr2/2p3pk/p6p/2nP1p2/B7/5P2/P3R1PP/4Q1K1 b - - 2 30` | Rxe8 | 漏看了 ♖xe8 串击，丢车 | 对 | 串击 d8→b8，深搜吃到，净得 1 |
| 16 | [nQ98J](https://lichess.org/DQwgFHPi#43) | ?? | `3r4/R4ppp/2kb4/3p4/5P2/3Rr3/PPP3PP/2K5 w - - 0 22` | Rxe3 | 更好的是 ♖a6+（串击） | 对 | 串击 c6→d6，深搜吃到，净得 3 |
| 17 | [3XkQh](https://lichess.org/WOWIjBo3#43) | ?? | `2kr3r/1bpqbpp1/pp5p/3PQ3/4P1PP/3P4/PP1NN3/1K1R3R w - - 1 22` | Nd4 | 漏看了 ♝f6 串击，丢马 | 对 | 串击 e5→d4，深搜吃到，净得 6 |
| 18 | [dA0NW](https://lichess.org/YSOr2HEW/black#100) | ?? | `4R3/8/2k5/1p3p1p/1b4b1/4P1P1/5K2/8 b - - 5 50` | Bc3 | 漏看了 ♖c8+ 串击，丢象 | 对 | 串击 c6→c3，深搜吃到，净得 3 |
| 19 | [swE9q](https://lichess.org/b2re6XJV#113) | ?? | `8/2r3k1/6p1/2P3P1/3K2b1/1P6/2PR4/8 w - - 1 57` | Kd5 | 漏看了 ♜d7+ 串击，丢车 | 对 | 串击 d5→d2，深搜吃到，净得 5 |
| 20 | [ESKY1](https://lichess.org/M9JAjV3K#79) | ?? | `6k1/p1R5/7R/8/8/1P2KP2/r4P1P/3r4 w - - 2 40` | Re6 | 漏看了 ♜e1+ 串击，丢车 | 对 | 串击 e3→e6，深搜吃到，净得 5 |
| 21 | [5j5Uq](https://lichess.org/vXKYZQ7I/black#38) | ?? | `2kr3r/p1p2q2/1bQ1bp2/3P2p1/4P1p1/2P3B1/PP3PPP/R3K2R b KQ - 0 19` | Rxd5 | 漏看了 ♕a8+ 串击，丢车 | 对 | 串击 c8→h8，深搜吃到，净得 4 |
| 22 | [QdM3v](https://lichess.org/gIyoNWbP/black#74) | ?? | `8/pp2r3/5p1R/2Pp1kP1/8/2P1P3/PP3r2/2K5 b - - 0 37` | Rxe3 | 漏看了 ♖xf6+ 串击，丢车 | 对 | 串击 f5→f2，深搜吃到，净得 5 |
| 23 | [ERFEJ](https://lichess.org/6wPIRovS#81) | ?? | `4r3/2R1P3/pp2kP2/3bP1p1/3P3p/P2K2n1/8/6R1 w - - 8 41` | Rb1 | 漏看了 ♝e4+ 串击，丢车 | 对 | 串击 d3→b1，深搜吃到，净得 5 |
| 24 | [Sdaos](https://lichess.org/3IasFhGe/black#58) | ?? | `8/1R4pp/1p2kp2/1Bp1pn2/2P5/7P/5PPK/r7 b - - 6 29` | g5 | 漏看了 ♗d7+ 串击，丢马 | 对 | 串击 e6→f5，深搜吃到，净得 3 |
| 25 | [qAPGu](https://lichess.org/U6DnRHOz#99) | ?? | `8/2kP2R1/8/8/P7/6p1/6K1/3r4 w - - 0 50` | Kxg3 | 漏看了 ♜g1+ 串击，丢车 | 对 | 串击 g3→g7，深搜吃到，净得 5 |

### xray

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。吃子、被吃回、再由原先被挡在后面的长兵器在同一格吃回（走之前它打不到那一格）；净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [9dwj8](https://lichess.org/6kDFWPAT#47) | ? | `3rrnk1/1p3bpp/p1p5/2P1q3/3p4/P1N1PR2/1PB3PP/R3Q1K1 w - - 0 24` | exd4 | 漏看了 ♛xe1+ X 光，丢车 | 对 | e8 隔着 e5 支援，净得 4 |
| 2 | [0QfuJ](https://lichess.org/im0CHZCs/black#66) | ?? | `7r/pb3pk1/1p2pqpp/3p2P1/1P1P1P2/2P1Q2R/P1B5/6K1 b - - 0 33` | hxg5 | 漏看了 fxg5 X 光，丢后 | 对 | e3 隔着 f4 支援，净得 3 |
| 3 | [ZP6pB](https://lichess.org/Z8I5whEo/black#32) | ?? | `r2r2k1/pp2ppbp/2p3p1/4Pb2/5P2/2B2N2/PPPR2PP/2KR4 b - - 4 16` | Bh6 | 漏看了 ♖xd8+ X 光，丢车 | 对 | d1 隔着 d2 支援，净得 5 |
| 4 | [MeyGA](https://lichess.org/EXdEq8Uv/black#38) | ?? | `1r4k1/1bq2ppp/B1p1pn2/2bpN3/3P4/2N1P3/1Q3PPP/1R4K1 b - - 1 19` | Bxa6 | 漏看了 ♕xb8+ X 光，丢车 | 对 | b1 隔着 b2 支援，净得 2 |
| 5 | [KQ6RL](https://lichess.org/ulLXw154/black#50) | ?? | `3r3k/1p3r1p/2p1qppQ/p1b1p1N1/P3P3/2Pn1RN1/1P4PP/5R1K b - - 3 25` | fxg5 | 漏看了 ♖xf7 X 光，丢后 | 对 | f1 隔着 f3 支援，净得 4 |
| 6 | [0bXP6](https://lichess.org/cqec4ipm#37) | ?? | `3rr1k1/p5p1/2pq2np/5b2/4pp2/P1BP1N1P/1PP1RPP1/R2Q2K1 w - - 0 19` | dxe4 | 漏看了 ♛xd1+ X 光，丢车 | 对 | d8 隔着 d6 支援，净得 5 |
| 7 | [tO2XD](https://lichess.org/evAD8BKd#65) | ?? | `2b3k1/8/4q2p/1p1pP1p1/p1pPp2Q/P1P1N3/1P4PP/6K1 w - - 0 33` | Qg4 | 漏看了 ♛xg4 X 光，丢马 | 对 | c8 隔着 e6 支援，净得 3 |
| 8 | [Byk13](https://lichess.org/10e5V3Ev#55) | ?? | `2r2nk1/pp4p1/2r1p3/3p2pP/1q1P4/2N1QP2/PP6/1KRR4 w - - 0 28` | Qxg5 | 漏看了 ♜xc3 X 光，丢马 | 对 | c8 隔着 c6 支援，净得 2 |
| 9 | [OF3bV](https://lichess.org/kgpjYH9g/black#48) | ?? | `1r3r1k/p4p1p/1p6/2pNR3/2P5/3P2Pq/PP3P1P/4R1K1 b - - 2 24` | Rfe8 | 漏看了 ♖xe8+ X 光，丢车 | 对 | e1 隔着 e5 支援，净得 5 |
| 10 | [NWCJG](https://lichess.org/mz3IPyPb/black#46) | ?? | `r1r5/1q2bpkp/pp3n2/8/1P2n3/P3QNP1/1B3PKP/R3R3 b - - 1 23` | h6 | 漏看了 ♕xe4 X 光，丢马 | 对 | e1 隔着 e3 支援，净得 3 |
| 11 | [IMYS1](https://lichess.org/DwiIRs95/black#54) | ?? | `3r1r2/p1k1qp2/2ppnR1p/6p1/2B1P1Q1/6PP/P7/5R1K b - - 5 27` | Nc5 | 漏看了 ♖xf7 X 光 | 对 | f1 隔着 f6 支援，净得 5 |
| 12 | [Heoo7](https://lichess.org/TtYWFNP6#41) | ?? | `2r2rk1/ppq3p1/5p1p/3Rp3/2NnP1PP/3Q4/PPP2P2/2KR4 w - - 4 21` | c3 | 漏看了 ♛xc4 X 光，丢马 | 对 | c8 隔着 c7 支援，净得 3 |
| 13 | [vVwNf](https://lichess.org/WeXrd0f6/black#42) | ?? | `r5k1/pp1q2pp/2n5/3pp3/3P1r2/2PQ2RP/PP1N4/2K3R1 b - - 1 21` | e4 | 漏看了 ♖xg7+ X 光，丢后 | 对 | g1 隔着 g3 支援，净得 5 |
| 14 | [5T7DO](https://lichess.org/5yaZUYBI/black#54) | ?? | `8/pp1r1ppk/4p1np/2pq4/8/P1P1Q1PP/1P3P1K/2B1R3 b - - 0 27` | Ne5 | 漏看了 ♕xe5 X 光，丢马 | 对 | e1 隔着 e3 支援，净得 3 |
| 15 | [X4RLi](https://lichess.org/0CkpIMNL/black#62) | ?? | `2r2rk1/p1P5/1p1b2pp/7q/PP1Q4/5P1P/6P1/2RR3K b - - 0 31` | Qe5 | 漏看了 ♕xd6 X 光，丢象 | 对 | d1 隔着 d4 支援，净得 3 |
| 16 | [wJgj8](https://lichess.org/hL4lOiSO/black#52) | ?? | `r7/pp4kp/3p4/2p5/5rb1/1B2q1b1/PPPN2R1/R5QK b - - 7 26` | Bf2 | 漏看了 ♖xg4+ X 光，丢象 | 对 | g1 隔着 g2 支援，净得 3 |
| 17 | [xP51v](https://lichess.org/OqQ9BylA/black#50) | ?? | `2r4r/4Rpkp/1p1p1n2/1q1P4/3Q1PP1/1P6/2P4P/1K1R4 b - - 0 25` | Qxd5 | 漏看了 ♕xd5 X 光，丢马 | 对 | d1 隔着 d4 支援，净得 2 |
| 18 | [P2ViA](https://lichess.org/e7TpdPBq#61) | ?? | `4r3/1q2rpk1/p4nbp/1p1nN1p1/3P4/3Q2BP/P4PP1/1BR1R1K1 w - - 4 31` | Nxg6 | 漏看了 ♜xe1+ X 光，丢车 | 对 | e8 隔着 e7 支援，净得 3 |
| 19 | [dNxrL](https://lichess.org/8EuGlrEE#45) | ?? | `2r3k1/2qn1ppp/4p3/1B1nP3/P2P4/2r5/3Q1PPP/R1R1N1K1 w - - 9 23` | Bxd7 | 漏看了 ♜xc1 X 光，丢车 | 对 | c7 隔着 c3 支援，净得 2 |
| 20 | [TGjvl](https://lichess.org/KPTbGLYk#71) | ?? | `2rr3k/1p1q3p/2p2p2/2B2Pp1/PPQ1P1P1/3RK2P/6n1/7R w - - 7 36` | Kf2 | 漏看了 ♛xd3 X 光，丢车 | 对 | d8 隔着 d7 支援，净得 2 |
| 21 | [FvnCr](https://lichess.org/pSnlHbtB/black#32) | ?? | `r3r1k1/1pq2ppp/2pb1p2/p2n4/P2PR1bP/1P3NP1/2PN1PB1/R3Q1K1 b - - 2 16` | Bf5 | 漏看了 ♖xe8+ X 光，丢车 | 对 | e1 隔着 e4 支援，净得 5 |
| 22 | [ZTb1R](https://lichess.org/4Khkr3Cp/black#74) | ?? | `2rb4/1p4k1/p1r1pqp1/3p2Np/1PP1p2P/P3P1P1/2R1QPK1/2R5 b - - 3 37` | Rxc4 | 漏看了 ♖xc4 X 光，丢车 | 对 | c1 隔着 c2 支援，净得 4 |
| 23 | [aNzDA](https://lichess.org/hP851uIG/black#38) | ?? | `2kr3r/1pp4p/p3q2n/2PpPpp1/P2P4/2P2P1b/3Q1R1P/RNB3K1 b - - 0 19` | g4 | 漏看了 ♕xh6 X 光，丢马 | 对 | c1 隔着 d2 支援，净得 3 |
| 24 | [BO55h](https://lichess.org/sv2lg2pX/black#52) | ?? | `2r3k1/p1Prqppp/1p2p3/3p4/QP6/2R5/5PPP/2R3K1 b - - 2 26` | Rdxc7 | 漏看了 ♖xc7 X 光，丢后 | 对 | c1 隔着 c3 支援，净得 4 |
| 25 | [w33p9](https://lichess.org/hFD2T4X9/black#40) | ?? | `1rbr2k1/5ppp/pq2p3/2npP3/8/2N2N2/PPQ1RPPP/3R2K1 b - - 3 20` | Qxb2 | 漏看了 ♕xb2 X 光，丢车 | 对 | e2 隔着 c2 支援，净得 4 |

### trapped

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步是不吃子、不将军的一步；它打到的某个 ≥ 3 分的子原地和每一个去处都会被得子地吃掉，而且不是因为被钉在王前（那是牵制）；深搜线里吃到了这种子，净得 ≥ 1。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [HTyrm](https://lichess.org/5WpvltFy#33) | ?? | `r2q1rk1/pp2bppp/4p3/2p1N3/2PP2P1/3QPR1P/PP6/R5K1 w - - 0 17` | Raf1 | 漏看了 f6 困子，丢马 | 对 | e5 的子无处可逃，深搜吃到，净得 3 |
| 2 | [I1Hm0](https://lichess.org/Wt2gys1O#87) | ?? | `1k6/3b3p/B1p3p1/2Pp1pP1/5P1P/4P3/4K3/8 w - - 7 44` | Kd3 | 漏看了 ♚a7 困子，丢象 | 对 | a6 的子无处可逃，深搜吃到，净得 2 |
| 3 | [vjhai](https://lichess.org/hbJ1VFAe/black#50) | ?? | `2rq1rk1/1pb5/p3Rn1p/6p1/1P6/PQ4B1/5PPP/R5K1 b - - 0 25` | Kh8 | 漏看了 ♖d1 困子，丢后 | 对 | d8 的子无处可逃，深搜吃到，净得 4 |
| 4 | [GJMQC](https://lichess.org/gZXXTI6U/black#16) | ?? | `r1bqkb1r/pp1npppp/5n2/3p4/3PNB2/4P3/PP3PPP/2RQKBNR b Kkq - 4 8` | Nxe4 | 漏看了 ♗c7 困子，丢后 | 对 | d8 的子无处可逃，深搜吃到，净得 3 |
| 5 | [0wllg](https://lichess.org/YZ2OtE6m/black#18) | ?? | `rnb1k2r/p4ppp/1pp1pn2/3p4/1qPP4/P1N1PN1P/1P3PP1/R2QKB1R b KQkq - 0 9` | Qxb2 | 漏看了 ♘a4 困子，丢后 | 对 | b2 的子无处可逃，深搜吃到，净得 3 |
| 6 | [Xmafq](https://lichess.org/nOlAv0oC/black#18) | ?? | `r3kb1r/ppp1pppp/2n2n2/7b/2PPq3/4BN1P/PP3PP1/R2QKBNR b KQkq - 2 9` | e5 | 漏看了 ♗d3 困子，丢后 | 对 | e4 的子无处可逃，深搜吃到，净得 8 |
| 7 | [td7kK](https://lichess.org/BTQfcOVY#51) | ?? | `8/1p1n2bp/p1p1k3/7B/4p3/1P2B2P/P1P3P1/6K1 w - - 2 26` | Be8 | 漏看了 ♞f6 困子，丢象 | 对 | e8 的子无处可逃，深搜吃到，净得 2 |
| 8 | [dlksP](https://lichess.org/e63owm1L#39) | ?? | `r5k1/6pp/ppbqpr2/3p1p2/3PnP1Q/N2B4/PP3PPP/R3R1K1 w - - 5 20` | f3 | 漏看了 ♜h6 困子，丢后 | 对 | h4 的子无处可逃，深搜吃到，净得 4 |
| 9 | [JpIEG](https://lichess.org/4agmPHzF/black#24) | ?? | `r1b1r1k1/ppp2ppp/1bnp1qn1/8/1P1NP3/N1P1B1P1/P2Q1PBP/R4RK1 b - - 2 12` | Nce5 | 漏看了 ♗g5 困子，丢后 | 对 | f6 的子无处可逃，深搜吃到，净得 6 |
| 10 | [DbLXw](https://lichess.org/SFywzDhk/black#146) | ?? | `8/8/1p2k3/pP1p4/P2P4/2K5/1n2N3/8 b - - 23 73` | Nxa4+ | 漏看了 ♔b3 困子，丢马 | 对 | a4 的子无处可逃，深搜吃到，净得 2 |
| 11 | [hG0XR](https://lichess.org/upva4dYn/black#12) | ?? | `rnb1k1nr/pppp1ppp/4p3/1P6/Pb6/2N5/1qPPPPPP/1R1QKBNR b Kkq - 3 6` | Qa3 | 漏看了 ♖b3 困子，丢后 | 对 | a3 的子无处可逃，深搜吃到，净得 4 |
| 12 | [CDfx9](https://lichess.org/I5TIvECO#39) | ?? | `2r3k1/Qbqn1p1p/1p3p2/1Ppp4/7N/3P1B2/2P2PPP/5RK1 w - - 4 20` | Nf5 | 漏看了 ♜a8 困子，丢后 | 对 | a7 的子无处可逃，深搜吃到，净得 3 |
| 13 | [WQ29y](https://lichess.org/IZ6ncWvG/black#80) | ?? | `7k/pp5p/2p1r1p1/q4p2/3pP3/3P1P2/PPK2N2/4R1R1 b - - 9 40` | Qxa2 | 漏看了 ♖a1 困子，丢后 | 对 | a2 的子无处可逃，深搜吃到，净得 3 |
| 14 | [V9epA](https://lichess.org/omqQ8qaR/black#60) | ?? | `5rk1/pp4pp/2ppq1b1/1N2P1n1/2P5/P3R1P1/1P3rBP/2R1Q2K b - - 2 30` | cxb5 | 漏看了 ♗d5 困子，丢后 | **错** | e6 的子是被钉在王前（牵制），不是困子 |
| 15 | [6SbkF](https://lichess.org/43Lq0UDx/black#60) | ?? | `3r2k1/5p1p/p3p1n1/6Bq/2P1Q3/4P2N/5PPK/8 b - - 1 30` | Rd2 | 漏看了 g4 困子，丢后 | 对 | h5 的子无处可逃，深搜吃到，净得 6 |
| 16 | [PZ9Gu](https://lichess.org/7ZTxUbyf#27) | ?? | `3r1rk1/ppq1bpp1/2p2n1p/4pb2/Q1P5/2N1PN1P/PP2BPP1/3R1RK1 w - - 6 14` | Qxa7 | 漏看了 ♜a8 困子，丢后 | 对 | a7 的子无处可逃，深搜吃到，净得 5（深搜在失着后局面上的主线） |
| 17 | [7Qvjk](https://lichess.org/vXmMMe4K#61) | ?? | `2br1k2/1q3pr1/pp6/3p2b1/2pP1Q2/2N1P1P1/PPB2P1P/2R2RK1 w - - 3 31` | Qe5 | 漏看了 f6 困子，丢后 | 对 | e5 的子无处可逃，深搜吃到，净得 8 |
| 18 | [YoHIz](https://lichess.org/KKARnlk2#39) | ?? | `2r2rk1/1p1qb1pp/p4n2/3p4/P2n1N2/2P3PP/1P4B1/R2Q1RK1 w - - 0 20` | Qxd4 | 漏看了 ♝c5 困子，丢后 | **错** | d4 的子是被钉在王前（牵制），不是困子 |
| 19 | [wk6Zh](https://lichess.org/97JX7tCR/black#50) | ?? | `r3r1k1/1p1n1ppp/pP6/P2p1b1n/2pP3q/5P2/1RPBN1BP/2Q2K1R b - - 7 25` | Re6 | 漏看了 ♗g5 困子，丢后 | 对 | h4 的子无处可逃，深搜吃到，净得 5 |
| 20 | [k8aIk](https://lichess.org/6G3mEzuQ/black#22) | ?? | `2kr2nr/pppq2pp/2np4/4pP2/3b3P/1PN2P2/PBPPQP2/2KR1B1R b - - 0 11` | Qxf5 | 漏看了 ♗h3 困子，丢后 | **错** | f5 的子是被钉在王前（牵制），不是困子 |
| 21 | [zTVzu](https://lichess.org/Qya53l6H#45) | ?? | `1r3rk1/p3q1pp/2p3b1/1p6/1RpPP3/P1P2P2/2Q3PP/2B2RK1 w - - 1 23` | Qb2 | 漏看了 a5 困子，丢车 | 对 | b4 的子无处可逃，深搜吃到，净得 4 |
| 22 | [nk79i](https://lichess.org/rCIWy3PG#27) | ?? | `r2q1rk1/pp3p1p/6p1/2bp3n/2P1bQ2/P1N1P3/1B1P1PPP/R3KB1R w KQ - 4 14` | Qe5 | 漏看了 ♜e8 困子，丢后 | 对 | e5 的子无处可逃，深搜吃到，净得 3 |
| 23 | [nsE4c](https://lichess.org/DQsjg8Ms/black#14) | ?? | `rn2k1nr/pp2ppbp/1qpp2p1/8/3PPPb1/P1N1BN2/1PP3PP/R2QKB1R b KQkq - 0 7` | Qxb2 | 漏看了 ♘a4 困子，丢后 | 对 | b2 的子无处可逃，深搜吃到，净得 3 |
| 24 | [8njxf](https://lichess.org/IRz0tdda#33) | ?? | `3qr1k1/2p2ppp/p1p1bn2/1rbp3P/3Q2P1/1P1P1P2/PBPN4/2KR1B1R w - - 3 17` | Qc3 | 漏看了 d4 困子，丢后 | 对 | c3 的子无处可逃，深搜吃到，净得 6 |
| 25 | [o2ZC7](https://lichess.org/Q24VASJA/black#58) | ?? | `2b2rk1/p4r1p/1p2p3/3pRp2/3P2p1/1QP3P1/PP1q3P/4RBK1 b - - 2 29` | f4 | 漏看了 ♖d1 困子，丢后 | 对 | d2 的子无处可逃，深搜吃到，净得 5 |

### mateThreat

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。这步不将军；这步之后（让攻方再走一步）有一步杀，这步之前没有；深搜线得子 ≥ 1 或将死。「没理会威胁」：走之前同一步就是杀，且失着之后深搜确为杀。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [6MbtC](https://lichess.org/Cl6HDgzI#43) | ?? | `5rk1/1p2pp2/5bpp/1Q6/p5PP/P1q2P2/2P3B1/1K1R3R w - - 0 22` | Rd3 | 没防住对方 ♛a1# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 2 | [h9ziE](https://lichess.org/JJxXdZeK/black#28) | ?? | `rn3rk1/pp2ppb1/7p/q1p1P1N1/3P2b1/2P3B1/P1Q1BPPP/R3K2R b KQ - 0 14` | Bxe2 | 没防住对方 ♕h7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 3 | [5g6OS](https://lichess.org/URAZkKvS#59) | ?? | `2r2r2/b2q1pk1/p2p2p1/1p1Bp1Nn/1P2P3/2PP3R/3Q1P1K/6R1 w - - 4 30` | Nxf7 | 漏看了 ♞f4 杀棋威胁 | 对 | 威胁一步杀，深搜净得 7 |
| 4 | [NWfJc](https://lichess.org/MMaMvKeq/black#30) | ? | `r1b2k1r/ppN2ppp/2n3q1/7Q/2B5/8/PPPpRPPP/R5K1 b - - 0 15` | Qxh5 | 没防住对方 ♖e8# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 5 | [wwd0H](https://lichess.org/DDtMJvW9#103) | ?? | `8/2P4R/5b1p/4k3/4p3/4Kp1P/5P2/8 w - - 2 52` | c8=Q | 没防住对方 ♝g5# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 6 | [CNm9a](https://lichess.org/VrzJ8WbM#35) | ?? | `r1bqr1k1/pp3Npp/2p2b2/7Q/2nP4/2P5/PP3PPP/RNB1R1K1 w - - 5 18` | Nxd8 | 没防住对方 ♜xe1# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 7 | [KsJRH](https://lichess.org/PCzxHSMS/black#36) | ?? | `rn2r1k1/pp3ppp/8/8/2BP2b1/5N2/PP3KPP/R3R3 b - - 5 18` | Bxf3 | 没防住对方 ♖xe8# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 8 | [yudRQ](https://lichess.org/mAud28Cz/black#30) | ?? | `r1b1r1k1/pp3ppp/5b2/1Qp5/1n1p2P1/1P5P/qBPP1P2/2KR1BNR b - - 1 15` | d3 | 没防住对方 ♕xe8# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 9 | [N417J](https://lichess.org/T4l56PS7/black#34) | ? | `r1b2r1k/3p2pp/p1R2pq1/4pn2/2B4P/Q1N1B3/PPP2PP1/2K4R b - - 0 17` | dxc6 | 没防住对方 ♕xf8# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 10 | [eP8WG](https://lichess.org/HGlVTkes/black#24) | ?? | `1nbqkbnr/3r1ppp/8/p2B4/Pp2N3/5N2/1P2QPPP/R1B1K2R b KQk - 4 12` | Rxd5 | 没防住对方 ♘f6# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 11 | [s5GaP](https://lichess.org/F07TwkDP#55) | ?? | `2Q3R1/p3rp2/4pkp1/4qp2/8/2P5/PP3PPP/6K1 w - - 7 28` | Qd8 | 没防住对方 ♛e1# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 12 | [utX7Y](https://lichess.org/JZIKAixR#41) | ?? | `r2r2k1/1p3pp1/p1nb1np1/3Pq1N1/2P1p1P1/2N1B2P/PP1Q1P2/2R2RK1 w - - 4 21` | a3 | 没防住对方 ♛h2# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 13 | [sh2yb](https://lichess.org/AakoRDbY/black#32) | ?? | `1r1q1rk1/2p1bppn/bp1p3p/p7/P1PBP1Q1/1P4P1/3N1PBP/R4RK1 b - - 2 16` | Bc8 | 没防住对方 ♕xg7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 14 | [nfeLU](https://lichess.org/O8a6Dg9I#31) | ?? | `rn1q2rk/pp5p/5p2/2Q3b1/4P1b1/1B6/PPP2PPP/RN2K1NR w KQ - 1 16` | Bxg8 | 没防住对方 ♛d1# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 15 | [KiEhV](https://lichess.org/MVDAqhSl/black#48) | ?? | `r2q1r1k/1b4p1/1p1pBb1B/2p4Q/4P3/P1Pn3P/1P3PP1/R4RK1 b - - 0 24` | Bg5 | 没防住对方 ♗xg5# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 16 | [bLxfo](https://lichess.org/5nbq7zKQ/black#20) | ?? | `3rkbnr/ppp2ppp/2n5/8/4N3/5bP1/PPP2PBP/RNB1R1K1 b k - 0 10` | Bxg2 | 没防住对方 ♘f6# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 17 | [mNPtd](https://lichess.org/DjHNFc4X/black#24) | ?? | `r2qkbnr/pp2pp1p/6p1/1N1P4/QPn5/5N2/P4PPP/R1B1K2R b KQkq - 2 12` | Nb6 | 没防住对方 ♘c7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 18 | [VkfKM](https://lichess.org/WiOWTPpL/black#106) | ?? | `6k1/R2R4/8/1r4p1/6K1/1r6/8/8 b - - 18 53` | Rb6 | 没防住对方 ♖d8# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 19 | [zv7V8](https://lichess.org/LwB0hofj/black#64) | ? | `3R4/5pkp/p7/1p3PPB/1Pb1P2p/2r5/3K4/8 b - - 4 32` | Rg3 | 没防住对方 f6# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 20 | [gtnzl](https://lichess.org/tZdwbsVL/black#32) | ?? | `2rq1rk1/1p3pp1/p3bb1p/3p4/8/P1NQP3/1PB2PPP/R4RK1 b - - 1 16` | b5 | 没防住对方 ♕h7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 21 | [ntQ0U](https://lichess.org/UgNOyhjy/black#90) | ?? | `1r2R3/2p2Pk1/3p2P1/7P/8/8/pp5K/8 b - - 1 45` | b1=Q | 没防住对方 f8=Q# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 22 | [xwNle](https://lichess.org/iVLVPVyV/black#14) | ?? | `r1bqkb1r/pppp1ppp/2n5/2nQP3/2B5/5N2/PPP2PPP/RNB1K2R b KQkq - 4 7` | Nb4 | 没防住对方 ♕xf7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 23 | [BzhYN](https://lichess.org/DZSmjpgB#23) | ?? | `r3k2r/ppp3pp/2n5/2bpp2n/4P2q/1B6/PPP3PP/RNBQNR1K w kq - 1 12` | Nf3 | 没防住对方 ♞g3# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 24 | [xYKUe](https://lichess.org/uXZYWBz0/black#70) | ?? | `7k/6pN/8/p3pp2/1pP5/1Pn2PP1/5rPR/2K5 b - - 0 35` | e4 | 没防住对方 ♘f6# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |
| 25 | [0ywMo](https://lichess.org/V4RpHrOp/black#10) | ?? | `r1bqkbnr/pppp1p1p/2n3p1/3Q4/2BpP3/8/PPP2PPP/RNB1K1NR b KQkq - 1 5` | Nf6 | 没防住对方 ♕xf7# 一步杀的威胁 | 对 | 走之前同一步就是杀，失着后深搜确为杀 |

### promotion

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。深搜线前六步内攻方升变，净得 ≥ 3、将死，或深搜评估这步之后攻方 ≥ +300（兵的赛跑不在六步里结账）。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [IDz82](https://lichess.org/czZvbjuk#75) | ?? | `8/7p/3Q2bk/1B3pp1/4p3/7P/1pr2PP1/6K1 w - - 2 38` | Qb4 | 漏看了 ♜c1+ 升变 | 对 | 升变，深搜净得 8 |
| 2 | [9Piet](https://lichess.org/2VTsgF7o/black#94) | ?? | `8/2PR2p1/2r3k1/8/4KP1p/8/8/8 b - - 3 47` | h3 | 漏看了 ♖d6+ 升变 | 对 | 升变，深搜净得 3 |
| 3 | [aRViL](https://lichess.org/nkqRR9Rk#127) | ?? | `8/8/4R2p/4b3/8/7k/p1K5/8 w - - 0 64` | Ra6 | 漏看了 a1=Q 升变 | 对 | 升变，深搜净得 4 |
| 4 | [aqk4j](https://lichess.org/3OVANuEZ#113) | ?? | `8/8/6p1/P1K4p/1Pp1bP1P/6P1/2R1pk2/8 w - - 2 57` | Rc1 | 漏看了 c3 升变 | 对 | 升变，深搜评估 +677 |
| 5 | [uXBeI](https://lichess.org/FiR2Wgzm/black#90) | ?? | `5r2/p7/2PR4/8/4K3/PP6/2P3p1/5k2 b - - 2 45` | g1=Q | 更好的是 ♜e8+（升变） | 对 | 升变，深搜净得 8 |
| 6 | [D23Ta](https://lichess.org/6xi9gvsr/black#72) | ?? | `8/5kp1/1P3b1p/2B1p3/5p2/5P1P/2r3P1/1R4K1 b - - 0 36` | Rxc5 | 漏看了 b7 升变 | 对 | 升变，深搜净得 5 |
| 7 | [dFTui](https://lichess.org/sxcg6kzV#83) | ?? | `8/2K2k1p/6p1/3P2P1/R6P/2P5/p1r5/8 w - - 2 42` | Ra3 | 漏看了 ♜xc3+ 升变，丢兵 | 对 | 升变，深搜净得 4 |
| 8 | [86Abz](https://lichess.org/6VDFS2Qf/black#104) | ?? | `8/6pp/R6P/5rk1/8/8/2K5/8 b - - 0 52` | Rf6 | 漏看了 hxg7 升变，丢兵 | 对 | 升变，深搜净得 4 |
| 9 | [jrQLr](https://lichess.org/yLUcTRBI/black#74) | ?? | `1kb5/2q2P2/p1n1p2p/1p1pN1P1/5K2/1P2Q3/6P1/8 b - - 0 37` | hxg5+ | 漏看了 ♔xg5 升变，丢兵 | 对 | 升变，深搜净得 5 |
| 10 | [loDHm](https://lichess.org/MFt0l2Uv/black#82) | ?? | `6k1/6p1/3P2p1/3K4/1R6/7p/P7/2r5 b - - 0 41` | g5 | 漏看了 d7 升变 | 对 | 升变，深搜净得 8 |
| 11 | [gzqVN](https://lichess.org/61MbAJeL/black#82) | ?? | `8/2P2B1k/p6p/3pP3/2pPb2K/P7/7P/6r1 b - - 0 41` | c3 | 漏看了 c8=Q 升变，丢兵 | 对 | 升变，深搜净得 9 |
| 12 | [gMnCF](https://lichess.org/enkCYX9C/black#52) | ?? | `6k1/P4p1p/1n2p1p1/3p4/1R6/1P4P1/2r2P1P/6K1 b - - 1 26` | Rc6 | 漏看了 ♖xb6 升变，丢马 | 对 | 升变，深搜净得 6 |
| 13 | [v2mXH](https://lichess.org/r79mDH2y#133) | ?? | `2k5/6R1/K7/P7/8/8/1r4p1/8 w - - 13 67` | Ka7 | 漏看了 ♜b7+ 升变 | 对 | 升变，深搜净得 3 |
| 14 | [PJ5KQ](https://lichess.org/LJEqASXn#115) | ?? | `8/PK6/8/1B4p1/5kP1/8/8/r7 w - - 3 58` | a8=Q | 更好的是 ♗a6（升变） | 对 | 升变，深搜净得 9 |
| 15 | [ZQLSJ](https://lichess.org/iFdErkoH#105) | ?? | `7R/2P5/8/8/1P1K1p2/P4Pk1/2r4p/8 w - - 1 53` | Rh7 | 漏看了 ♜xc7 升变，丢兵 | 对 | 升变，深搜净得 4 |
| 16 | [n26PK](https://lichess.org/MfG1y2ns/black#84) | ?? | `8/4R1P1/p7/2k3rp/2pp1Nb1/P7/1KP5/8 b - - 0 42` | h4 | 漏看了 ♖e5+ 升变 | 对 | 升变，深搜净得 3 |
| 17 | [xbKTG](https://lichess.org/ir6vDqNW/black#84) | ?? | `3N4/5Pk1/4p1P1/8/p1p5/P3r3/2K5/8 b - - 1 42` | e5 | 漏看了 ♘e6+ 升变 | 对 | 升变，深搜净得 11 |
| 18 | [U14SH](https://lichess.org/68oOg1VF/black#72) | ?? | `2k2r2/pp3P1p/2pQn3/8/2q5/8/PP4PP/3R3K b - - 0 36` | Rd8 | 漏看了 ♕xd8+ 升变，丢车 | 对 | 升变，深搜净得 4 |
| 19 | [hY88h](https://lichess.org/K3eC2YMi#71) | ?? | `3r4/6PR/1pk5/p1pp4/P3RP2/1Pb2K2/8/8 w - - 0 36` | Rh8 | 更好的是 ♖e6+（升变） | 对 | 升变，深搜将死 |
| 20 | [hBpL5](https://lichess.org/xiDxPYN5/black#122) | ?? | `8/1P5R/8/8/5K2/1r3P2/7p/6k1 b - - 0 61` | Rxb7 | 更好的是 h1=R（升变） | 对 | 升变，深搜净得 4 |
| 21 | [cK05i](https://lichess.org/kmoyRaQd/black#118) | ? | `2k5/2r5/4p1KP/8/5P2/3p2p1/R7/8 b - - 0 59` | Rc2 | 漏看了 h7 升变 | 对 | 升变，深搜净得 3 |
| 22 | [jOOJl](https://lichess.org/RRD4tXmw/black#92) | ?? | `8/2KP4/p7/8/1P5k/3q4/8/8 b - - 1 46` | Kg5 | 漏看了 d8=Q+ 升变 | 对 | 升变，深搜净得 8 |
| 23 | [KPYwH](https://lichess.org/R68UdMyb/black#74) | ?? | `8/3k2B1/1p3P2/p1pp1R2/8/1P6/P1PPq3/2K5 b - - 6 37` | Qe6 | 漏看了 f7 升变 | 对 | 升变，深搜净得 3 |
| 24 | [O29LO](https://lichess.org/T2FDGbyD/black#102) | ?? | `8/8/P2k4/5p2/1N3P2/2b2K2/8/8 b - - 0 51` | Bxb4 | 漏看了 a7 升变 | 对 | 升变，深搜净得 5 |
| 25 | [CFjl5](https://lichess.org/gHNZJda0/black#94) | ?? | `8/P7/Rn3r1k/7p/7P/2P3K1/8/8 b - - 0 47` | Kg6 | 漏看了 ♖xb6 升变，丢马 | 对 | 升变，深搜净得 6 |

### backRank

判定规则：所说的那步棋经深搜成立（反击：深搜首选，或与首选差 ≤ 80cp；更好的着：深搜首选，或比所走好 ≥ 50cp）。「净得」数到至少第四步、再数完还在进行的交换和将军；「将死」是线上将死或深搜分数为杀。深搜确认是杀，深搜线的最后一步由车或后在对方底线上将死，王在底线，王前面一排的格子都被自己的子占着、其中至少两个兵。

| # | 来源 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | [07PAM](https://lichess.org/iaB2yluE/black#42) | ?? | `r5k1/pp3ppp/4r3/3q4/Q2p4/3P3P/PP3PP1/4RRK1 b - - 1 21` | Rae8 | 让对方有 ♕xe8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 2 | [3rkM7](https://lichess.org/okxEa6DT#79) | ?? | `8/p1N2pk1/2p4p/5Q2/8/4P3/q4PPP/3R2KR w - - 12 40` | Rd7 | 让对方有 ♛a1+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 3 | [A8J2V](https://lichess.org/RsAzLuje#57) | ?? | `5rk1/4Qp1p/4pRp1/1p6/r7/P7/2P1q1PP/5R1K w - - 12 29` | Rxf7 | 让对方有 ♛xf1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 4 | [B14Xs](https://lichess.org/jpiQXnkY/black#56) | ?? | `r5k1/p5pp/4p3/2ppP3/1B1q4/P3pQ2/6PP/5R1K b - - 1 28` | cxb4 | 让对方有 ♕f7+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 5 | [3ypdJ](https://lichess.org/3jgZHIGd#59) | ?? | `5r2/p5pk/2R4p/1p3q2/8/2P5/PP4PP/3Q2K1 w - - 1 30` | Rd6 | 让对方有 ♛f2+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 6 | [hz4M3](https://lichess.org/8PVLKg3k/black#48) | ?? | `4r1k1/1p3ppp/p4b2/8/3Nr3/2P2Q2/Pq4PP/R4R1K b - - 1 24` | Bxd4 | 让对方有 ♕xf7+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 7 | [f6Vg4](https://lichess.org/j85Zui6K/black#70) | ?? | `r5k1/1b2Q1pp/p5q1/P2p4/1Pp1p3/8/5RPP/5K2 b - - 4 35` | Qc6 | 让对方有 ♕f7+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 8 | [lt4AU](https://lichess.org/eUxa9l3x/black#78) | ?? | `6k1/p3q1pp/1p6/3Q4/3P4/1PP2P1P/b5P1/5K2 b - - 4 39` | Kh8 | 让对方有 ♕a8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 9 | [ptv2h](https://lichess.org/3X3pT6u1/black#42) | ?? | `4r1k1/ppp1rppp/3p4/1Qn5/q2N4/5P2/PPP3PP/R3RK2 b - - 2 21` | Qxd4 | 让对方有 ♕xe8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 10 | [dz0Qz](https://lichess.org/qjMDUvDn/black#26) | ?? | `1r2k2r/p2pnppp/b1p5/4q3/4P1Q1/1N6/PPP2PPP/2KR3R b k - 5 13` | c5 | 让对方有 ♕xd7+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 11 | [DlqlI](https://lichess.org/wDiI7kpI#45) | ?? | `4r1k1/pp3ppp/2q2b2/3p4/P2P4/1Q2B3/1P3PPP/4R1K1 w - - 0 23` | Rc1 | 让对方有 ♛xc1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 12 | [mOr1p](https://lichess.org/db8fo5Vt/black#58) | ?? | `4r1k1/p2Q2pp/2p5/2P1q3/3p4/4r2P/P5P1/5RK1 b - - 1 29` | d3 | 让对方有 ♕f7+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 13 | [yUb6a](https://lichess.org/OCC5umNm/black#52) | ?? | `r3r1k1/1Q3ppp/p5q1/1pP5/3P4/P3R1Pn/1B3P2/R4K2 b - - 0 26` | Rxe3 | 让对方有 ♕xa8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 14 | [aoJ5P](https://lichess.org/0x0ogMNm#63) | ?? | `8/2R5/1p1kb2p/6p1/4q3/2Q5/PP3PPP/6K1 w - - 12 32` | Ra7 | 让对方有 ♛b1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 15 | [ULLYp](https://lichess.org/s2GEULVw#55) | ? | `6k1/4q2p/2b3pB/1r1p1pN1/2nP4/2P5/5PPP/4R1K1 w - - 0 28` | Rxe7 | 让对方有 ♜b1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 16 | [PDyW6](https://lichess.org/h0DBRG7S#59) | ?? | `1r1R4/p4pk1/2p3pp/3pr2B/6Q1/2P5/5PPP/1q1R2K1 w - - 2 30` | Bxg6 | 让对方有 ♜e1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 17 | [NGdGd](https://lichess.org/JC34OCnr#37) | ?? | `2kr3r/p4p1p/2p2Qp1/8/4p3/N1Pq3N/PP3PPP/R4K2 w - - 2 19` | Kg1 | 让对方有 ♛d1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 18 | [ns8oH](https://lichess.org/EUdDna33#75) | ?? | `8/R4R2/3r3p/2b1p1pk/1p2P3/5P1P/PPP3P1/2K5 w - - 5 38` | Ra5 | 让对方有 ♝e3+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 19 | [2k8AV](https://lichess.org/2UqmjPMq#79) | ?? | `8/1k6/8/2Qp4/3P4/3BP3/5qPP/r1n2R1K w - - 4 40` | Rxc1 | 让对方有 ♛e1+ 起的 3 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 20 | [8HqFv](https://lichess.org/WIZHxUDr/black#60) | ? | `1k4r1/ppp5/2q1p3/7p/2P4P/6Q1/PP5K/4RR2 b - - 0 30` | Rxg3 | 让对方有 ♖f8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 21 | [ve6cO](https://lichess.org/Gi5jStfo/black#80) | ?? | `7k/1pp3pp/3p3q/5r2/1P3p2/2P1np1r/PQ4RN/4R2K b - - 5 40` | Nxg2 | 让对方有 ♖e8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 22 | [oG53I](https://lichess.org/79xISJeP#45) | ?? | `2r2rk1/1p1b2p1/p2Q3p/4p1b1/2q1PN2/2N2R2/PPP3PP/5R1K w - - 0 23` | Ng6 | 让对方有 ♛xf1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 23 | [xvHKT](https://lichess.org/OdUfIZwz#47) | ?? | `8/ppp3kp/4bqp1/2b1p3/3nQ1PP/1P3N2/PBPP4/2K2B2 w - - 1 24` | Nxd4 | 让对方有 ♛xf1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 24 | [mpKe2](https://lichess.org/5jZtHbKn/black#54) | ?? | `2r3k1/5ppp/p1r5/3N1Q2/3P4/1q3P1P/1nR3P1/2R3K1 b - - 0 27` | Rxc2 | 让对方有 ♕xc8+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |
| 25 | [OJP2X](https://lichess.org/z29bMYBp#51) | ?? | `r1r3k1/5pp1/1Rp4p/p7/P2PQ3/q3P3/5PPP/2R3K1 w - - 4 26` | Rbxc6 | 让对方有 ♛xc1+ 起的 2 步杀（底线杀） | 对 | 底线杀：王被自己的兵堵住 |

<!-- sample:end -->
