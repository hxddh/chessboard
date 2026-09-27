# 教练解释抽检（v8-0-plan B3）

复盘里每个 `?` / `??` 下面的一句「为什么」，改之前和改之后各抽 100 条，逐条核对。

## 怎么量的

- **样本**：`scripts/test-coach.mjs` 在两套语料上跑复盘（每手 200 ms，和 app 的 `SCAN_BUDGET` 一样），按 `app.js mistakeFacts()` 的调用方式生成句子。语料是 `scripts/fixtures/corpus.mjs` 的 28 局（表里记作「名局」）和 `scripts/fixtures/coach-games.mjs` 的 12 局低档引擎对局（「低档」，挖题脚本的配方：弱档会像人一样挂子、走进捉双）。
- **同一批 100 条**：全部 `??`（83 条，两套交替），再用 `?` 补满。改前改后是同样的 100 手，只是说明换了代码。
- **引擎输出固定**：200 ms 的搜索每次不一样。所有搜索结果缓存在 `scripts/fixtures/coach-analysis.json`（按预算和 FEN），改前改后读的是同一份，差别只来自代码。
- **oracle**（`scripts/lib/coach-oracle.mjs`）：每句话拆成几个断言——应着是什么、是什么母题、丢了什么、更好的是什么——各自用 **1500 ms 的深搜**和一组独立于 `motif.js` 写的棋盘事实去核：这个子能不能被吃回、被捉双的子是不是真的值得吃、被牵制的子是不是真的动不了、深搜线上有没有真的吃到。
- **人工复核**：改后所有带母题的句子（52 条）逐条摆棋盘读过；改前的句子也读过。oracle 对「丢的是哪个子」「是不是真的捉双」判得粗，漏放了 4 条错句（都是 7.x 的），表里标「人工：」，计入错误。改后没有需要人工推翻的判定。

## 结果

| | 改前（7.x） | 改后 |
|---|---|---|
| 100 条里说错的 | **26**（26%） | **1**（1%） |
| 其中不止「更好的是 X」的断言 | 50 条，错 26 | 63 条，错 1 |
| `??` 说出母题（两套合计 83 手） | 27（32.5%） | 49（59.0%） |
| `??` 说出母题（28 局名局，45 手） | 18（40.0%） | 35（77.8%） |
| `??` 说出母题（低档对局，38 手） | 9（23.7%） | 14（36.8%） |

数字由 `node scripts/test-coach.mjs --record=before|after` 写进 `docs/measured.json` 的 `coachCoverage`（改前用 `--lib=` 指向 7.x 的 `explain.js` / `motif.js`）。

**改前的 26 条错**：
- 牵制误报 11 条。其中 8 条是同一个形状——4.Bg5?? ♛xg5、5.Bh4?? ♛xh4、8…Bg4?? ♕xg4、20.Ra3?? ♜xa3（以及对面「更好的是」的同一手）：子只是没有保护、被白吃，`motif.js` 却因为吃子的后/车后面恰好有两个子排成一线而报「牵制」（计划里走查的「4.Ng5??」就是这一类）。另 3 条被说成牵制的子其实动得了。
- 捉双误报 11 条：首着本身白吃一个子（♕xd7 吃后，4 条），被「捉」的子有保护、不值得吃（♜xg2+、♕g7+、♛e2+ 打王和有保护的子，♖xf7、♕xd6 打两个有保护的象），或者深搜线上捉双的子自己被吃掉（♞xf2+、♛d3+）。
- 串击 1 条：深搜线上没吃到后面的子。
- 丢子说错 3 条：对换掉的大子被当成损失 2 条（「丢后」「丢车」其实是丢马、丢象），深搜不认 1 条。

**改后的 1 条错**：低档对局 8…fxe4?? 「对方 ♗xe4 之后丢兵」。200 ms 的线上确实丢兵，1500 ms 的深搜线上子力扯平（黑方的问题是王翼被攻，不是兵）。这是「只说子力得失」那一档的句子，不带母题。

## 母题：哪些达到了精度，哪些回退

19 个母题键（`motif.js` 的 `LINE_MOTIF_KEYS`）：挂着的子、长将、中间着、闪将、双将、闪击、捉双、绝望子、消除保护、过载、引离、引入、牵制、串击、X 光、困子、杀棋威胁、升变、底线杀。每个都有「证明它的那条线」：几何成立之外，引擎线必须真的兑现（被捉双的子被吃、被牵制的子在原地被吃、防守者被消除后它保护的子被吃……），否则不说。每个检测器都有一正一反的单元测试（`scripts/test-explain.mjs`）。

在这批语料上真正出现、因而**量得出精度**的：挂着的子（全部 211 手里说出 59 次，含「没理会对方的威胁」14 次；抽检 100 条里 49 条，全对）、捉双（5 次；抽检 3 条）、闪击（2 次）、绝望子（1 次）。闪击和绝望子没落进抽检，摆棋盘读过也都成立。抽检里这几类没有错句。

其余母题（牵制、串击、闪将、双将、消除保护、过载、引离、引入、X 光、困子、杀棋威胁、升变、长将、中间着、底线杀）在 211 手失误里**一次也没被说出**：7.x 报出的 17 个牵制经深搜核对全部不成立，新规则下一个都没留下。它们的精度只由单元测试（正反各一）担保，没有抽样数字；遇到它们而线不兑现时，句子**回退到只说子力得失**（「对方 X 之后丢 Y」）或「更好的是 X」，这是检测器自己的行为，不另开开关。

「没有保护住」只用于真的吃不回的子；有保护、被价值更低的子吃掉的（17.Nf6+ gxf6），句子改说「兵吃马，换不回来」——这是抽检里读出来的。

## 两份表

### 改前（7.x）

<!-- audit:before:begin -->

| # | 集 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | 名局 | ?? | `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` | Bd6 | 更好的是 ♖e1 | 对 | 深搜首选同为 Re1 |
| 2 | 低档 | ?? | `r2qk2r/2p3pp/pp1bpnp1/4N3/2PP4/2N1P3/PB2QPbP/2KR3R w kq - 0 14` | Qe1 | 对方 ♝xh1 之后丢车 | 对 | 深搜线上净丢 2 |
| 3 | 名局 | ?? | `rnb1k1nr/p2p1ppp/3B4/1pbN1N1P/4P1P1/3P1Q2/PqP5/R4KR1 b kq - 1 18` | Bxg1 | 更好的是 ♛xa1+ | 对 | 深搜首选同为 Qxa1+ |
| 4 | 低档 | ?? | `r1b1k1nr/p3bpp1/n1pp4/qN6/Pp1PPB1p/5N2/1PPQ2PP/2K1RB1R b kq - 1 12` | Be6 | 更好的是 cxb5 | 对 | 深搜：cxb5 比所走好 363cp |
| 5 | 名局 | ?? | `rnb1k1nr/p2p1ppp/3B4/1p1NPN1P/6P1/3P1Q2/P1P1K3/q5b1 b kq - 1 20` | Na6 | 让对方有 ♘xg7+ 起的 3 步杀 | 对 | 深搜：确为杀 |
| 6 | 低档 | ?? | `2kr2n1/p7/n1p1bp2/6r1/qp1PP2p/4QN2/1PPK2PP/4RB1R w - - 0 20` | Bxa6+ | 更好的是 ♘xg5 | 对 | 深搜首选同为 Nxg5 |
| 7 | 名局 | ?? | `1r2k2r/pbppnppp/1bn5/4P2q/Q3N3/B1PB1N2/P4PPP/R3R1K1 w k - 1 17` | Nf6+ | 对方 gxf6 之后丢马 | 对 | 深搜线上净丢 2 |
| 8 | 低档 | ?? | `2kr2n1/p7/q1p1b3/6p1/1p1PP2p/4Q3/1PPK2PP/4R2R w - - 0 22` | d5 | 对方 ♝xd5 之后丢兵 | 对 | 深搜线上净丢 2 |
| 9 | 名局 | ?? | `1r2k1r1/pbppnp1p/1bn2P2/7q/Q7/B1PB1N2/P4PPP/3RR1K1 b - - 2 19` | Qxf3 | （无） | 空 | 没有句子 |
| 10 | 低档 | ?? | `2kr2n1/p7/q1p1b3/3P2p1/1p2P2p/4Q3/1PPK2PP/4R2R b - - 0 22` | Qb6 | 更好的是 ♝xd5 | 对 | 深搜首选同为 Bxd5 |
| 11 | 名局 | ?? | `3r3r/1R3p1p/6p1/1p6/2q5/5PP1/1Q5P/1K1k1B2 b - - 5 36` | Rd2 | 漏看了 ♖d7 牵制，丢后 | **错** | 牵制：c4 的子并没有被钉住 |
| 12 | 低档 | ?? | `3r2n1/pk6/1qp1b3/3P2p1/1pP1P2p/4Q3/1P1K2PP/R6R b - c3 0 24` | cxd5 | 更好的是 bxc3+ | 对 | 深搜首选同为 bxc3+ |
| 13 | 名局 | ?? | `R3qr1k/2pb2p1/5n1p/5p2/1pPPpP1P/2QnP1P1/3N2R1/3N2KB b - - 0 30` | bxc3 | 更好的是 ♛xa8 | 对 | 深搜首选同为 Qxa8 |
| 14 | 低档 | ?? | `3r4/1k2n3/1q6/p1Rb2p1/1p2P2p/4Q3/1P4PP/R3K3 b - - 1 28` | Be6 | 更好的是 ♝c6 | 对 | 深搜首选同为 Bc6 |
| 15 | 名局 | ?? | `rnbqkbnr/pp3ppp/2p1p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4` | Bg5 | 漏看了 ♛xg5 牵制，丢象 | **错** | Qxg5 白吃一子——是挂着的子，不是牵制 |
| 16 | 低档 | ?? | `2b4b/1pp2k2/3pN2p/1N1P3P/r1P2P2/p3B2P/R5r1/7K w - - 0 33` | Nd8+ | 更好的是 ♔xg2 | 对 | 深搜首选同为 Kxg2 |
| 17 | 名局 | ?? | `rnbqkbnr/pp3ppp/2p1p3/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 1 4` | h6 | 对方 ♗xd8 之后丢后 | 对 | 深搜线上净丢 6 |
| 18 | 低档 | ?? | `2bNk2b/1pp5/3p3p/1N1P3P/r1P2P2/4B2P/R7/7K b - - 0 35` | Bd4 | 对方 ♖xa4 之后丢车 | 对 | 深搜线上净丢 2 |
| 19 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR w KQkq - 0 5` | Bh4 | 漏看了 ♛xh4 牵制，丢象 | **错** | Qxh4 白吃一子——是挂着的子，不是牵制 |
| 20 | 低档 | ?? | `1nbqkbnr/r2p3p/pp2p1p1/2p2p2/2P2P2/1P1BPN2/PB1P2PP/RN1Q1RK1 b k - 1 8` | e5 | 漏看了 ♗xe5 捉双，丢马 | 对 | 捉双：深搜线上吃到了 (4)；深搜线上净丢 4 |
| 21 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/3p4/2PP3B/2N5/PP2PPPP/R2QKBNR b KQkq - 1 5` | dxc4 | 对方 ♗xd8 之后丢后 | 对 | 深搜线上净丢 5 |
| 22 | 低档 | ?? | `r4rk1/2pn3p/bpqbp1p1/1N1n1P2/p1BP3P/P3PN2/1PQB1P2/R3K1R1 w Q - 1 18` | Rg4 | 对方 ♝xb5 之后丢后 | **错** | 人工：后是对换（…Qxc2 Bxc2），丢的是 b5 马（oracle：深搜线上净丢 4） |
| 23 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/8/2pP3B/2N5/PP2PPPP/R2QKBNR w KQkq - 0 6` | e4 | 漏看了 ♛xh4 牵制，丢象 | **错** | Qxh4 白吃一子——是挂着的子，不是牵制 |
| 24 | 低档 | ?? | `6rk/p1p3bp/2N1Q1n1/4Pp2/Pp2qP2/5RPP/1P4K1/R1B5 w - - 3 25` | Qd7 | 漏看了 ♛e2+ 捉双，同时攻击王和车 | **错** | 被打到的子有保护、也不比它值钱：不是真的捉双；Qe2+ 打不到所说的两个子，或者它自己能被吃 |
| 25 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/8/2pPP2B/2N5/PP3PPP/R2QKBNR b KQkq e3 0 6` | g5 | 更好的是 ♛xh4（牵制） | **错** | 深搜首选同为 Qxh4；Qxh4 白吃一子——是挂着的子，不是牵制 |
| 26 | 低档 | ?? | `6rk/p1pQ2bp/2N3n1/4Pp2/Pp2qP2/5RPP/1P4K1/R1B5 b - - 4 25` | Bxe5 | 更好的是 ♛e2+（捉双） | 对 | 深搜首选同为 Qe2+；捉双：深搜线上吃到了 (100) |
| 27 | 名局 | ?? | `r2qk1nr/1b1n1p2/p1p1p2p/1p2P1p1/2pP4/2b2BB1/PP2NPPP/R2Q1RK1 w kq - 0 13` | bxc3 | 更好的是 ♘xc3 | 对 | 深搜首选同为 Nxc3 |
| 28 | 低档 | ?? | `1n1qk2r/1r3p2/p2pbNp1/2p1p2p/1p2P3/1N1P1PP1/PPP2Q1P/R3KB1R b K - 0 18` | Ke7 | 更好的是 ♛xf6 | 对 | 深搜首选同为 Qxf6 |
| 29 | 名局 | ?? | `r2qk1nr/1b1n1p2/p1p1p2p/1p2P1p1/2pP4/2P2BB1/P3NPPP/R2Q1RK1 b kq - 0 13` | c5 | 对方 ♗xb7 之后丢象 | 对 | 深搜线上净丢 3 |
| 30 | 低档 | ?? | `1n1q3r/1r2kp2/p2pbNp1/2p1p2p/1p2P3/1N1P1PP1/PPP2Q1P/R3KB1R w K - 1 19` | d4 | 对方 ♚xf6 之后丢马 | 对 | 深搜线上净丢 3 |
| 31 | 名局 | ?? | `r2qk1nr/1b1n1p2/p3p2p/1pp1P1p1/2pP4/2P2BB1/P3NPPP/R2Q1RK1 w kq - 0 14` | a4 | 更好的是 ♗xb7 | 对 | 深搜首选同为 Bxb7 |
| 32 | 低档 | ?? | `1r5r/3nkp2/bqBp2p1/p2Pp3/PpP1P1Pp/4QP2/2PN3P/R2K2R1 w - - 1 31` | Qg5+ | 对方 f6 之后丢车 | 对 | 深搜线上净丢 8 |
| 33 | 名局 | ?? | `r2qk1nr/1b1n1p2/p3p2p/1pp1P1p1/P1pP4/2P2BB1/4NPPP/R2Q1RK1 b kq a3 0 14` | Nb6 | 对方 ♗xb7 之后丢象 | 对 | 深搜线上净丢 3 |
| 34 | 低档 | ?? | `1r5r/3nk3/bqBp1pQ1/p2Pp3/PpP1P1Pp/5P2/2PN3P/R2K2R1 b - - 0 32` | Qe3 | 漏看了 ♕g7+ 捉双，同时攻击王和车 | **错** | 被打到的子有保护、也不比它值钱：不是真的捉双；Qg7+ 打不到所说的两个子，或者它自己能被吃 |
| 35 | 名局 | ?? | `r2qk1nr/1b3p2/pn2p2p/1pp1P1p1/P1pP4/2P2BB1/4NPPP/R2Q1RK1 w kq - 1 15` | axb5 | 更好的是 ♗xb7 | 对 | 深搜首选同为 Bxb7 |
| 36 | 低档 | ?? | `rn1q1rk1/1bppp1bp/3n4/pp3BP1/1P1P2QP/2P1P1N1/P5P1/RNB1K2R b KQ - 0 14` | axb4 | （无） | 空 | 没有句子 |
| 37 | 名局 | ?? | `r2qk1nr/1b3p2/pn2p2p/1Pp1P1p1/2pP4/2P2BB1/4NPPP/R2Q1RK1 b kq - 0 15` | axb5 | 对方 ♗xb7 之后丢车 | **错** | 人工：线上车是对换（…Rxa1 Qxa1），丢的是 b7 象（oracle：深搜线上净丢 2） |
| 38 | 低档 | ?? | `rn1q1rk1/1bppp1bp/3n4/1p3BP1/1p1P2QP/2P1P1N1/P5P1/RNB1K2R w KQ - 0 15` | h5 | 更好的是 ♗xh7+ | 对 | 深搜首选同为 Bxh7+ |
| 39 | 名局 | ?? | `r2qk1nr/1b3p2/1n2p2p/1pp1P1p1/2pP4/2P2BB1/4NPPP/R2Q1RK1 w kq - 0 16` | Rxa8 | 更好的是 ♗xb7 | 对 | 深搜首选同为 Bxb7 |
| 40 | 低档 | ?? | `rn1q1rk1/1bpp2bp/3np3/1p3BPP/1p1P2Q1/2P1P1N1/P5P1/RNB1K2R w KQ - 0 16` | Bc2 | 更好的是 ♗xh7+ | 对 | 深搜首选同为 Bxh7+ |
| 41 | 名局 | ?? | `r3kb1r/2qb1pR1/p2ppP2/1pn4p/3NP3/2N2Q1B/PPP4P/2KR4 b kq - 3 18` | O-O-O | 漏看了 ♖xf7 捉双，丢兵 | **错** | 人工：f7 上的车打到的 d7、f8 两个象都有保护，不值得吃：不是捉双（oracle：捉双：深搜线上吃到了 (1)；深搜线上净丢 1） |
| 42 | 低档 | ?? | `rn1q1rk1/1bpp2bp/3np3/1p4PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 17` | c5 | 更好的是 ♝xg2 | 对 | 深搜首选同为 Bxg2 |
| 43 | 名局 | ?? | `2rq1rk1/pb2bppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 b - - 0 16` | Qd7 | 漏看了 ♕xd7 捉双，丢后 | **错** | Qxd7 本身就是白吃一子，要说的是挂着的子 |
| 44 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pp3PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R w KQ c6 0 18` | dxc5 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 45 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 w - - 1 17` | b4 | 更好的是 ♕xd7（捉双） | **错** | 深搜首选同为 Qxd7；Qxd7 本身就是白吃一子，要说的是挂着的子 |
| 46 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 18` | Qc8 | 对方 h6 之后丢马 | 对 | 深搜线上净丢 2 |
| 47 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/1P2p3/4P1P1/P4PBP/2RQ1RK1 b - - 0 17` | cxb4 | 漏看了 ♕xd7 捉双，丢后 | **错** | Qxd7 本身就是白吃一子，要说的是挂着的子 |
| 48 | 低档 | ?? | `rnq2rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 1 19` | g6 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 49 | 名局 | ?? | `2r2rk1/pb1qbppp/8/4B3/1p2p3/4P1P1/P4PBP/2RQ1RK1 w - - 0 18` | Qb3 | 更好的是 ♕xd7（捉双） | **错** | 深搜首选同为 Qxd7；Qxd7 本身就是白吃一子，要说的是挂着的子 |
| 50 | 低档 | ?? | `rn3rk1/1b1p2bp/3np1P1/1pq4P/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 0 20` | Rf1 | 更好的是 ♗xe6+ | 对 | 深搜首选同为 Bxe6+ |
| 51 | 名局 | ?? | `2r2rk1/pb2bppp/8/3qB3/1p2p3/1Q2P1P1/P4PBP/2R2RK1 w - - 2 19` | Qxb4 | 对方 ♝xb4 之后丢后 | 对 | 深搜线上净丢 8 |
| 52 | 低档 | ?? | `r5k1/1b1p3p/2nnp1Pb/1pq5/6Q1/BBP1P3/P5P1/RN2KN2 b Q - 1 23` | Qf5 | 更好的是 ♜xa3（串击） | **错** | 深搜首选同为 Rxa3；串击：深搜线上没吃到后面的子 |
| 53 | 名局 | ?? | `2r2rk1/pb2bppp/8/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 b - - 0 19` | Bd6 | 漏看了 ♕xd6 捉双，丢后 | **错** | 人工：♕xd6 吃的是被攻击两次、保护一次的象，后是对换掉的；丢的是象，也不是捉双（oracle：捉双：深搜线上吃到了 (3)；深搜线上净丢 3） |
| 54 | 低档 | ?? | `r4B1k/1b1p3P/2n1p3/1p6/6P1/1BP5/P7/RN3K2 b - - 0 29` | Ne5 | 更好的是 ♜xf8+ | 对 | 深搜首选同为 Rxf8+ |
| 55 | 名局 | ?? | `2r2rk1/pb3ppp/3b4/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 w - - 1 20` | Rfd1 | 对方 ♝xb4 之后丢后 | 对 | 深搜线上净丢 9 |
| 56 | 低档 | ?? | `1rbq1rk1/p3b3/n1pp1pp1/1p1PpP1p/2P1P1n1/2N3P1/P4NBP/1RBQ1R1K b - - 0 16` | bxc4 | 更好的是 ♞xf2+（捉双） | **错** | 深搜首选同为 Nxf2+；捉双：深搜线上没吃到 |
| 57 | 名局 | ?? | `2r2rk1/pb3ppp/3b4/3qB3/1Q2p3/4P1P1/P4PBP/2RR2K1 b - - 2 20` | Rc4 | 更好的是 ♝xb4 | 对 | 深搜：Bxb4 比所走好 1252cp |
| 58 | 低档 | ?? | `rn1qkb1r/1bpp2pp/1p2p3/pP3p2/4P1n1/2PB1N1P/P1QP1PP1/RNB1K2R b KQkq - 0 8` | fxe4 | 漏看了 ♗xe4 牵制，丢兵 | **错** | 牵制：e4 的子并没有被钉住 |
| 59 | 名局 | ?? | `5rk1/1b3ppp/8/p2q4/1B2p3/4P1P1/P4PBP/2RR2K1 w - a6 0 23` | Bxa5 | 对方 ♛xa5 之后丢象 | 对 | 深搜线上净丢 2 |
| 60 | 低档 | ?? | `r1bq1k1r/pp1n1Bpp/8/4P2Q/1b6/2N5/PPnB1PPP/R4KNR b - - 1 13` | Bxc3 | 更好的是 ♞xe5 | 对 | 深搜首选同为 Nxe5 |
| 61 | 名局 | ?? | `4n2Q/pb1p1kp1/4qp1B/1p6/3P3R/P5N1/2r3PP/R5K1 w - - 1 24` | Rc1 | 漏看了 ♜xg2+ 捉双，同时攻击王和马 | **错** | 被打到的子有保护、也不比它值钱：不是真的捉双；Rxg2+ 打不到所说的两个子，或者它自己能被吃 |
| 62 | 低档 | ?? | `r1bq1k1r/pp1n1Bpp/8/4P2Q/8/2b5/PPnB1PPP/R4KNR w - - 0 14` | Bc4 | 对方 ♞xe5 之后丢象 | **错** | 深搜线上净丢 1，撑不起「丢b」 |
| 63 | 名局 | ?? | `r1bqkbnr/1p3ppp/p1p5/4p3/4PP2/3B4/PPP3PP/RNBQ1RK1 b kq f3 0 8` | Bg4 | 漏看了 ♕xg4 牵制，丢象 | **错** | Qxg4 白吃一子——是挂着的子，不是牵制 |
| 64 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B5/PPn2PPP/2R2KNR b - - 1 16` | N2e3+ | 更好的是 ♛d3+（捉双） | **错** | 深搜首选同为 Qd3+；捉双：深搜线上没吃到 |
| 65 | 名局 | ?? | `r2qkbnr/1p3ppp/p1p5/4p3/4PPb1/3B4/PPP3PP/RNBQ1RK1 w kq - 1 9` | Qe1 | 更好的是 ♕xg4（牵制） | **错** | 深搜首选同为 Qxg4；Qxg4 白吃一子——是挂着的子，不是牵制 |
| 66 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B1n3/PP3PPP/2R2KNR w - - 2 17` | Ke1 | 更好的是 fxe3 | 对 | 深搜首选同为 fxe3 |
| 67 | 名局 | ?? | `r2q1rk1/3n1pp1/p1pp2b1/1p2p1Bp/4P1PP/3P1N2/PPP1QP2/2KR3R b - - 1 15` | Qb6 | 更好的是 f6 | 对 | 深搜首选同为 f6 |
| 68 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B1n3/PP3PPP/2R1K1NR b - - 3 17` | Nxg2+ | 更好的是 ♞d5 | 对 | 深搜首选同为 Nd5 |
| 69 | 名局 | ?? | `r2q1rk1/3nbppp/b3p3/n1p1P3/p2p1B1P/P2PN1P1/2P2PBN/R2QR1K1 w - - 0 17` | Bf1 | 对方 dxe3 之后丢马 | 对 | 深搜线上净丢 2 |
| 70 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n4n/2B5/PP3P1P/2R2KNR w - - 2 19` | Qe2 | 更好的是 ♗b4+ | 对 | 深搜：Bb4+ 比所走好 471cp |
| 71 | 名局 | ?? | `r2q1rk1/3nbppp/b3p3/n1p1P3/p2p1B1P/P2PN1P1/2P2P1N/R2QRBK1 b - - 1 17` | Nb6 | 更好的是 dxe3 | 对 | 深搜首选同为 dxe3 |
| 72 | 低档 | ?? | `3r2kr/pp4p1/5q1p/8/8/PP1R1nQ1/4NP1P/5KR1 b - - 0 30` | Nxh2+ | 更好的是 ♜xd3 | 对 | 深搜首选同为 Rxd3 |
| 73 | 名局 | ?? | `r4rk1/ppp4p/2npb2b/3Nn3/2P1PPp1/1P1B2Pq/PB2N3/R2Q1RK1 w - - 1 20` | Rc1 | 更好的是 ♗xe5 | 对 | 深搜首选同为 Bxe5 |
| 74 | 低档 | ?? | `5rkr/pp4p1/5q1p/8/8/PP1R2Q1/4NP1K/6R1 b - - 0 32` | Rh7 | 更好的是 ♛xf2+（捉双） | 对 | 深搜首选同为 Qxf2+；捉双：深搜线上吃到了 (10) |
| 75 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/2P1BN1P/2BQ1PP1/R3RNK1 w - - 7 20` | Ra3 | 漏看了 ♜xa3 牵制，丢车 | **错** | Rxa3 白吃一子——是挂着的子，不是牵制 |
| 76 | 低档 | ?? | `2k2b1r/1pp5/p4n1p/5P2/1PN3P1/P1P3P1/R5K1/2N4r w - - 0 23` | Nb3 | 更好的是 ♔xh1 | 对 | 深搜首选同为 Kxh1 |
| 77 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/R1P1BN1P/2BQ1PP1/4RNK1 b - - 8 20` | Qd8 | 更好的是 ♜xa3（牵制） | **错** | 深搜首选同为 Rxa3；Rxa3 白吃一子——是挂着的子，不是牵制 |
| 78 | 名局 | ?? | `r2qrbk1/1pp2ppp/2n5/p2bp3/Q7/P2PBNP1/1PR1PPBP/2R3K1 b - - 6 15` | Nb8 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 79 | 名局 | ?? | `r1b1k2r/p4ppp/2n1p3/1p6/3PP3/P4N2/3qBPPP/R3K2R w KQkq - 0 14` | Nxd2 | 更好的是 ♔xd2 | 对 | 深搜首选同为 Kxd2 |
| 80 | 名局 | ?? | `r1b2rk1/p4ppp/2n1p3/1p6/3PP3/P7/3NBPPP/R4RK1 b - - 2 15` | Bb7 | 更好的是 ♞xd4 | 对 | 深搜首选同为 Nxd4 |
| 81 | 名局 | ?? | `2r2rk1/pb3ppp/2n1p3/1p6/3PP3/PN6/4BPPP/R1R3K1 b - - 6 17` | Na5 | 对方 ♘xa5 之后丢马 | 对 | 深搜线上净丢 3 |
| 82 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP3PP1/3QR1K1 w - - 1 17` | Qd2 | 漏看了 ♞e4 捉双，丢车 | 对 | 捉双：深搜线上吃到了 (2)；深搜线上净丢 2 |
| 83 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP1Q1PP1/4R1K1 b - - 2 17` | Rfe8 | 更好的是 ♞e4（捉双） | 对 | 深搜首选同为 Ne4；捉双：深搜线上吃到了 (2) |
| 84 | 名局 | ? | `rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6` | Nf6 | 漏看了 ♕b3 牵制，丢兵 | **错** | 牵制：f7 的子并没有被钉住 |
| 85 | 低档 | ? | `r1bqk2r/2p1nppp/pp1bpn2/3p4/2PP4/1PNBPN2/PB2QPPP/R3K2R b KQkq - 5 9` | Ng6 | 更好的是 ♝b7 | 对 | 深搜首选同为 Bb7 |
| 86 | 名局 | ? | `rn2kb1r/pp2qppp/2p2n2/4p1B1/2B1P3/1QN5/PPP2PPP/R3K2R b KQkq - 1 9` | b5 | 更好的是 ♛c7 | 对 | 深搜：Qc7 比所走好 61cp |
| 87 | 低档 | ? | `r1bqk2r/2p2ppp/pp1bpnn1/8/2pP4/1PNBPN2/PB2QPPP/2KR3R w kq - 0 11` | Bxg6 | 更好的是 bxc4 | 对 | 深搜首选同为 bxc4 |
| 88 | 名局 | ? | `r1bqk2r/pppp1ppp/2n2n2/8/1bBPP3/2N2N2/PP3PPP/R1BQK2R b KQkq - 2 7` | d5 | 更好的是 ♞xe4 | 对 | 深搜首选同为 Nxe4 |
| 89 | 低档 | ? | `r1bqk2r/2p3pp/pp1bpnp1/8/2pP4/1PN1PN2/PB2QPPP/2KR3R w kq - 0 12` | Ne5 | 更好的是 e4 | 对 | 深搜首选同为 e4 |
| 90 | 名局 | ? | `r3k2r/pppqn1pp/5p2/8/3P4/5N2/PP2QPPP/2R1R1K1 b kq - 3 16` | c6 | 更好的是 ♚f7 | 对 | 深搜首选同为 Kf7 |
| 91 | 低档 | ? | `r2qk2r/1bp3pp/pp1bpnp1/4N3/2PP4/2N1P3/PB2QPPP/2KR3R b kq - 0 13` | Bxg2 | 更好的是 ♛e7 | 对 | 深搜首选同为 Qe7 |
| 92 | 名局 | ? | `r6r/pp1qnkpp/4Np2/3p4/8/8/PP2QPPP/2R1R1K1 b - - 3 19` | Rhc8 | 更好的是 ♞c6 | 对 | 深搜：Nc6 比所走好 128cp |
| 93 | 低档 | ? | `r2q1rk1/1bpn2pp/pp2p1p1/4P3/2P1P3/2N2P2/PB2Q2P/2KR3R b - - 0 18` | Rf7 | 更好的是 ♛g5+ | 对 | 深搜首选同为 Qg5+ |
| 94 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p5/1B3Nqn/4Pp2/3P4/PPP3PP/RNBQ1K1R w kq - 0 10` | g4 | 更好的是 ♗a4 | 对 | 深搜首选同为 Ba4 |
| 95 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/4P1pP/2P1P3/2N2P2/PB2Q3/2KR3R w - - 0 21` | Nd5 | 对方 exd5 之后丢马 | 对 | 深搜线上净丢 2 |
| 96 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p2n2/1B3Nq1/4PpP1/3P4/PPP4P/RNBQ1KR1 b kq - 2 11` | cxb5 | 更好的是 h5 | 对 | 深搜首选同为 h5 |
| 97 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/3NP1pP/2P1P3/5P2/PB2Q3/2KR3R b - - 1 21` | Bxd5 | 更好的是 exd5 | 对 | 深搜首选同为 exd5 |
| 98 | 名局 | ? | `rnb1kbnr/p2p1ppp/5q2/1p3N1P/4PBP1/2NP1Q2/PPP5/R4KR1 b kq - 2 16` | Bc5 | 更好的是 ♛c6 | 对 | 深搜首选同为 Qc6 |
| 99 | 低档 | ? | `1r2q3/2p1r1pk/4P2p/p1p1P1pP/2Q1P3/P4PR1/5R2/2K5 b - - 2 35` | Qf8 | 更好的是 ♜xe6 | 对 | 深搜首选同为 Rxe6 |
| 100 | 名局 | ? | `rnb1k1nr/p2p1ppp/3B4/1p1N1N1P/4P1P1/3P1Q2/PqP5/R4Kb1 w kq - 0 19` | e5 | 对方 ♛xa1+ 之后丢车 | 对 | 深搜线上净丢 5 |

<!-- audit:before:end -->


### 改后

<!-- audit:after:begin -->

| # | 集 | 标 | FEN（走之前） | 走的 | 说明（中文） | 判定 | 依据 |
|---|---|---|---|---|---|---|---|
| 1 | 名局 | ?? | `rnb1k1nr/p2p1ppp/8/1pbN1N1P/4PBP1/3P1Q2/PqP5/R4KR1 w kq - 0 18` | Bd6 | 没理会对方 ♛xa1+ 的威胁，车没有保护住 | 对 | 走之前 Qxa1+ 就能白吃r；Qxa1+ 吃r：吃不回，深搜净得 5 |
| 2 | 低档 | ?? | `r2qk2r/2p3pp/pp1bpnp1/4N3/2PP4/2N1P3/PB2QPbP/2KR3R w kq - 0 14` | Qe1 | 没理会对方 ♝xh1 的威胁，象吃车，换不回来 | 对 | 走之前 Bxh1 就能白吃r；Bxh1 吃r：以小吃大，深搜净得 2 |
| 3 | 名局 | ?? | `rnb1k1nr/p2p1ppp/3B4/1pbN1N1P/4P1P1/3P1Q2/PqP5/R4KR1 b kq - 1 18` | Bxg1 | 更好的是 ♛xa1+，吃掉没有保护住的车 | 对 | 深搜首选同为 Qxa1+；Qxa1+ 吃r：吃不回，深搜净得 5 |
| 4 | 低档 | ?? | `r1b1k1nr/p3bpp1/n1pp4/qN6/Pp1PPB1p/5N2/1PPQ2PP/2K1RB1R b kq - 1 12` | Be6 | 更好的是 cxb5，兵吃马，净赚子力 | 对 | 深搜：cxb5 比所走好 363cp；cxb5 吃n：以小吃大，深搜净得 2 |
| 5 | 名局 | ?? | `rnb1k1nr/p2p1ppp/3B4/1p1NPN1P/6P1/3P1Q2/P1P1K3/q5b1 b kq - 1 20` | Na6 | 让对方有 ♘xg7+ 起的 3 步杀 | 对 | 深搜：确为杀 |
| 6 | 低档 | ?? | `2kr2n1/p7/n1p1bp2/6r1/qp1PP2p/4QN2/1PPK2PP/4RB1R w - - 0 20` | Bxa6+ | 更好的是 ♘xg5，马吃车，净赚子力 | 对 | 深搜首选同为 Nxg5；Nxg5 吃r：以小吃大，深搜净得 2 |
| 7 | 名局 | ?? | `1r2k2r/pbppnppp/1bn5/4P2q/Q3N3/B1PB1N2/P4PPP/R3R1K1 w k - 1 17` | Nf6+ | 漏看了 gxf6，兵吃马，换不回来 | 对 | gxf6 吃n：以小吃大，深搜净得 2 |
| 8 | 低档 | ?? | `2kr2n1/p7/q1p1b3/6p1/1p1PP2p/4Q3/1PPK2PP/4R2R w - - 0 22` | d5 | 对方 ♝xd5 之后丢兵 | 对 | 深搜线上净丢 2 |
| 9 | 名局 | ?? | `1r2k1r1/pbppnp1p/1bn2P2/7q/Q7/B1PB1N2/P4PPP/3RR1K1 b - - 2 19` | Qxf3 | （无） | 空 | 没有句子 |
| 10 | 低档 | ?? | `2kr2n1/p7/q1p1b3/3P2p1/1p2P2p/4Q3/1PPK2PP/4R2R b - - 0 22` | Qb6 | 更好的是 ♝xd5 | 对 | 深搜首选同为 Bxd5 |
| 11 | 名局 | ?? | `3r3r/1R3p1p/6p1/1p6/2q5/5PP1/1Q5P/1K1k1B2 b - - 5 36` | Rd2 | 对方 ♖d7 之后丢后 | 对 | 深搜线上净丢 6 |
| 12 | 低档 | ?? | `3r2n1/pk6/1qp1b3/3P2p1/1pP1P2p/4Q3/1P1K2PP/R6R b - c3 0 24` | cxd5 | 更好的是 bxc3+ | 对 | 深搜首选同为 bxc3+ |
| 13 | 名局 | ?? | `R3qr1k/2pb2p1/5n1p/5p2/1pPPpP1P/2QnP1P1/3N2R1/3N2KB b - - 0 30` | bxc3 | 更好的是 ♛xa8，吃掉没有保护住的车 | 对 | 深搜首选同为 Qxa8；Qxa8 吃r：吃不回，深搜净得 5 |
| 14 | 低档 | ?? | `3r4/1k2n3/1q6/p1Rb2p1/1p2P2p/4Q3/1P4PP/R3K3 b - - 1 28` | Be6 | 更好的是 ♝c6 | 对 | 深搜首选同为 Bc6 |
| 15 | 名局 | ?? | `rnbqkbnr/pp3ppp/2p1p3/3p4/2PP4/2N5/PP2PPPP/R1BQKBNR w KQkq - 0 4` | Bg5 | 漏看了 ♛xg5，象没有保护住 | 对 | Qxg5 吃b：吃不回，深搜净得 3 |
| 16 | 低档 | ?? | `2b4b/1pp2k2/3pN2p/1N1P3P/r1P2P2/p3B2P/R5r1/7K w - - 0 33` | Nd8+ | 更好的是 ♔xg2，吃掉没有保护住的车 | 对 | 深搜首选同为 Kxg2；Kxg2 吃r：吃不回，深搜净得 6 |
| 17 | 名局 | ?? | `rnbqkbnr/pp3ppp/2p1p3/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR b KQkq - 1 4` | h6 | 没理会对方 ♗xd8 的威胁，象吃后，换不回来 | 对 | 走之前 Bxd8 就能白吃q；Bxd8 吃q：以小吃大，深搜净得 6 |
| 18 | 低档 | ?? | `2bNk2b/1pp5/3p3p/1N1P3P/r1P2P2/4B2P/R7/7K b - - 0 35` | Bd4 | 没理会对方 ♖xa4 的威胁，车没有保护住 | 对 | 走之前 Rxa4 就能白吃r；Rxa4 吃r：吃不回，深搜净得 2 |
| 19 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/3p2B1/2PP4/2N5/PP2PPPP/R2QKBNR w KQkq - 0 5` | Bh4 | 漏看了 ♛xh4，象没有保护住 | 对 | Qxh4 吃b：吃不回，深搜净得 3 |
| 20 | 低档 | ?? | `1nbqkbnr/r2p3p/pp2p1p1/2p2p2/2P2P2/1P1BPN2/PB1P2PP/RN1Q1RK1 b k - 1 8` | e5 | 漏看了 ♗xe5 捉双，丢马 | 对 | 捉双：深搜线上吃到了 (4)；深搜线上净丢 4 |
| 21 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/3p4/2PP3B/2N5/PP2PPPP/R2QKBNR b KQkq - 1 5` | dxc4 | 没理会对方 ♗xd8 的威胁，象吃后，换不回来 | 对 | 走之前 Bxd8 就能白吃q；Bxd8 吃q：以小吃大，深搜净得 5 |
| 22 | 低档 | ?? | `r4rk1/2pn3p/bpqbp1p1/1N1n1P2/p1BP3P/P3PN2/1PQB1P2/R3K1R1 w Q - 1 18` | Rg4 | 对方 ♝xb5 之后丢马 | 对 | 深搜线上净丢 4 |
| 23 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/8/2pP3B/2N5/PP2PPPP/R2QKBNR w KQkq - 0 6` | e4 | 没理会对方 ♛xh4 的威胁，象没有保护住 | 对 | 走之前 Qxh4 就能白吃b；Qxh4 吃b：吃不回，深搜净得 2 |
| 24 | 低档 | ?? | `6rk/p1p3bp/2N1Q1n1/4Pp2/Pp2qP2/5RPP/1P4K1/R1B5 w - - 3 25` | Qd7 | 更好的是 ♗e3 | 对 | 深搜首选同为 Be3 |
| 25 | 名局 | ?? | `rnbqkbnr/pp3pp1/2p1p2p/8/2pPP2B/2N5/PP3PPP/R2QKBNR b KQkq e3 0 6` | g5 | 更好的是 ♛xh4，吃掉没有保护住的象 | 对 | 深搜首选同为 Qxh4；Qxh4 吃b：吃不回，深搜净得 2 |
| 26 | 低档 | ?? | `6rk/p1pQ2bp/2N3n1/4Pp2/Pp2qP2/5RPP/1P4K1/R1B5 b - - 4 25` | Bxe5 | 更好的是 ♛e2+ | 对 | 深搜首选同为 Qe2+ |
| 27 | 名局 | ?? | `r2qk1nr/1b1n1p2/p1p1p2p/1p2P1p1/2pP4/2b2BB1/PP2NPPP/R2Q1RK1 w kq - 0 13` | bxc3 | 更好的是 ♘xc3，吃掉没有保护住的象 | 对 | 深搜首选同为 Nxc3；Nxc3 吃b：吃不回，深搜净得 3 |
| 28 | 低档 | ?? | `1n1qk2r/1r3p2/p2pbNp1/2p1p2p/1p2P3/1N1P1PP1/PPP2Q1P/R3KB1R b K - 0 18` | Ke7 | 更好的是 ♛xf6，吃掉没有保护住的马 | 对 | 深搜首选同为 Qxf6；Qxf6 吃n：吃不回，深搜净得 3 |
| 29 | 名局 | ?? | `r2qk1nr/1b1n1p2/p1p1p2p/1p2P1p1/2pP4/2P2BB1/P3NPPP/R2Q1RK1 b kq - 0 13` | c5 | 漏看了 ♗xb7，象没有保护住 | 对 | Bxb7 吃b：吃不回，深搜净得 3 |
| 30 | 低档 | ?? | `1n1q3r/1r2kp2/p2pbNp1/2p1p2p/1p2P3/1N1P1PP1/PPP2Q1P/R3KB1R w K - 1 19` | d4 | 没理会对方 ♚xf6 的威胁，马没有保护住 | 对 | 走之前 Kxf6 就能白吃n；Kxf6 吃n：吃不回，深搜净得 3 |
| 31 | 名局 | ?? | `r2qk1nr/1b1n1p2/p3p2p/1pp1P1p1/2pP4/2P2BB1/P3NPPP/R2Q1RK1 w kq - 0 14` | a4 | 更好的是 ♗xb7，吃掉没有保护住的象 | 对 | 深搜首选同为 Bxb7；Bxb7 吃b：吃不回，深搜净得 3 |
| 32 | 低档 | ?? | `1r5r/3nkp2/bqBp2p1/p2Pp3/PpP1P1Pp/4QP2/2PN3P/R2K2R1 w - - 1 31` | Qg5+ | 对方 f6 之后丢车 | 对 | 深搜线上净丢 8 |
| 33 | 名局 | ?? | `r2qk1nr/1b1n1p2/p3p2p/1pp1P1p1/P1pP4/2P2BB1/4NPPP/R2Q1RK1 b kq a3 0 14` | Nb6 | 没理会对方 ♗xb7 的威胁，象没有保护住 | 对 | 走之前 Bxb7 就能白吃b；Bxb7 吃b：吃不回，深搜净得 3 |
| 34 | 低档 | ?? | `1r5r/3nk3/bqBp1pQ1/p2Pp3/PpP1P1Pp/5P2/2PN3P/R2K2R1 b - - 0 32` | Qe3 | 更好的是 ♛xg1+，吃掉没有保护住的车 | 对 | 深搜首选同为 Qxg1+；Qxg1+ 吃r：吃不回，深搜净得 6 |
| 35 | 名局 | ?? | `r2qk1nr/1b3p2/pn2p2p/1pp1P1p1/P1pP4/2P2BB1/4NPPP/R2Q1RK1 w kq - 1 15` | axb5 | 更好的是 ♗xb7，吃掉没有保护住的象 | 对 | 深搜首选同为 Bxb7；Bxb7 吃b：吃不回，深搜净得 3 |
| 36 | 低档 | ?? | `rn1q1rk1/1bppp1bp/3n4/pp3BP1/1P1P2QP/2P1P1N1/P5P1/RNB1K2R b KQ - 0 14` | axb4 | （无） | 空 | 没有句子 |
| 37 | 名局 | ?? | `r2qk1nr/1b3p2/pn2p2p/1Pp1P1p1/2pP4/2P2BB1/4NPPP/R2Q1RK1 b kq - 0 15` | axb5 | 没理会对方 ♗xb7 的威胁，象没有保护住 | 对 | 走之前 Bxb7 就能白吃b；Bxb7 吃b：吃不回，深搜净得 2 |
| 38 | 低档 | ?? | `rn1q1rk1/1bppp1bp/3n4/1p3BP1/1p1P2QP/2P1P1N1/P5P1/RNB1K2R w KQ - 0 15` | h5 | 更好的是 ♗xh7+ | 对 | 深搜首选同为 Bxh7+ |
| 39 | 名局 | ?? | `r2qk1nr/1b3p2/1n2p2p/1pp1P1p1/2pP4/2P2BB1/4NPPP/R2Q1RK1 w kq - 0 16` | Rxa8 | 更好的是 ♗xb7，吃掉没有保护住的象 | 对 | 深搜首选同为 Bxb7；Bxb7 吃b：吃不回，深搜净得 3 |
| 40 | 低档 | ?? | `rn1q1rk1/1bpp2bp/3np3/1p3BPP/1p1P2Q1/2P1P1N1/P5P1/RNB1K2R w KQ - 0 16` | Bc2 | 更好的是 ♗xh7+ | 对 | 深搜首选同为 Bxh7+ |
| 41 | 名局 | ?? | `r3kb1r/2qb1pR1/p2ppP2/1pn4p/3NP3/2N2Q1B/PPP4P/2KR4 b kq - 3 18` | O-O-O | 对方 ♖xf7 之后丢兵 | 对 | 深搜线上净丢 1 |
| 42 | 低档 | ?? | `rn1q1rk1/1bpp2bp/3np3/1p4PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 17` | c5 | 更好的是 ♝xg2 | 对 | 深搜首选同为 Bxg2 |
| 43 | 名局 | ?? | `2rq1rk1/pb2bppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 b - - 0 16` | Qd7 | 漏看了 ♕xd7，后没有保护住 | 对 | Qxd7 吃q：吃不回，深搜净得 12 |
| 44 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pp3PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R w KQ c6 0 18` | dxc5 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 45 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 w - - 1 17` | b4 | 更好的是 ♕xd7，吃掉没有保护住的后 | 对 | 深搜首选同为 Qxd7；Qxd7 吃q：吃不回，深搜净得 12 |
| 46 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 18` | Qc8 | 对方 h6 之后丢马 | 对 | 深搜线上净丢 2 |
| 47 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/1P2p3/4P1P1/P4PBP/2RQ1RK1 b - - 0 17` | cxb4 | 没理会对方 ♕xd7 的威胁，后没有保护住 | 对 | 走之前 Qxd7 就能白吃q；Qxd7 吃q：吃不回，深搜净得 9 |
| 48 | 低档 | ?? | `rnq2rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 1 19` | g6 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 49 | 名局 | ?? | `2r2rk1/pb1qbppp/8/4B3/1p2p3/4P1P1/P4PBP/2RQ1RK1 w - - 0 18` | Qb3 | 更好的是 ♕xd7，吃掉没有保护住的后 | 对 | 深搜首选同为 Qxd7；Qxd7 吃q：吃不回，深搜净得 10 |
| 50 | 低档 | ?? | `rn3rk1/1b1p2bp/3np1P1/1pq4P/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 0 20` | Rf1 | 更好的是 ♗xe6+ | 对 | 深搜首选同为 Bxe6+ |
| 51 | 名局 | ?? | `2r2rk1/pb2bppp/8/3qB3/1p2p3/1Q2P1P1/P4PBP/2R2RK1 w - - 2 19` | Qxb4 | 漏看了 ♝xb4，后没有保护住 | 对 | Bxb4 吃q：吃不回，深搜净得 8 |
| 52 | 低档 | ?? | `r5k1/1b1p3p/2nnp1Pb/1pq5/6Q1/BBP1P3/P5P1/RN2KN2 b Q - 1 23` | Qf5 | 更好的是 ♜xa3 | 对 | 深搜首选同为 Rxa3 |
| 53 | 名局 | ?? | `2r2rk1/pb2bppp/8/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 b - - 0 19` | Bd6 | 对方 ♕xd6 之后丢象 | 对 | 深搜线上净丢 3 |
| 54 | 低档 | ?? | `r4B1k/1b1p3P/2n1p3/1p6/6P1/1BP5/P7/RN3K2 b - - 0 29` | Ne5 | 更好的是 ♜xf8+，吃掉没有保护住的象 | 对 | 深搜首选同为 Rxf8+；Rxf8+ 吃b：吃不回，深搜净得 3 |
| 55 | 名局 | ?? | `2r2rk1/pb3ppp/3b4/3qB3/1Q2p3/4P1P1/P4PBP/2R2RK1 w - - 1 20` | Rfd1 | 没理会对方 ♝xb4 的威胁，后没有保护住 | 对 | 走之前 Bxb4 就能白吃q；Bxb4 吃q：吃不回，深搜净得 9 |
| 56 | 低档 | ?? | `1rbq1rk1/p3b3/n1pp1pp1/1p1PpP1p/2P1P1n1/2N3P1/P4NBP/1RBQ1R1K b - - 0 16` | bxc4 | 更好的是 ♞xf2+ | 对 | 深搜首选同为 Nxf2+ |
| 57 | 名局 | ?? | `2r2rk1/pb3ppp/3b4/3qB3/1Q2p3/4P1P1/P4PBP/2RR2K1 b - - 2 20` | Rc4 | 更好的是 ♝xb4，吃掉没有保护住的后 | 对 | 深搜：Bxb4 比所走好 1252cp；Bxb4 吃q：吃不回，深搜净得 9 |
| 58 | 低档 | ?? | `rn1qkb1r/1bpp2pp/1p2p3/pP3p2/4P1n1/2PB1N1P/P1QP1PP1/RNB1K2R b KQkq - 0 8` | fxe4 | 对方 ♗xe4 之后丢兵 | **错** | 深搜线上净丢 0，撑不起「丢p」 |
| 59 | 名局 | ?? | `5rk1/1b3ppp/8/p2q4/1B2p3/4P1P1/P4PBP/2RR2K1 w - a6 0 23` | Bxa5 | 漏看了 ♛xa5，象没有保护住 | 对 | Qxa5 吃b：吃不回，深搜净得 2 |
| 60 | 低档 | ?? | `r1bq1k1r/pp1n1Bpp/8/4P2Q/1b6/2N5/PPnB1PPP/R4KNR b - - 1 13` | Bxc3 | 更好的是 ♞xe5 | 对 | 深搜首选同为 Nxe5 |
| 61 | 名局 | ?? | `4n2Q/pb1p1kp1/4qp1B/1p6/3P3R/P5N1/2r3PP/R5K1 w - - 1 24` | Rc1 | 更好的是 d5 | 对 | 深搜首选同为 d5 |
| 62 | 低档 | ?? | `r1bq1k1r/pp1n1Bpp/8/4P2Q/8/2b5/PPnB1PPP/R4KNR w - - 0 14` | Bc4 | 对方 ♞xe5 之后丢兵 | 对 | 深搜线上净丢 1 |
| 63 | 名局 | ?? | `r1bqkbnr/1p3ppp/p1p5/4p3/4PP2/3B4/PPP3PP/RNBQ1RK1 b kq f3 0 8` | Bg4 | 漏看了 ♕xg4，象没有保护住 | 对 | Qxg4 吃b：吃不回，深搜净得 3 |
| 64 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B5/PPn2PPP/2R2KNR b - - 1 16` | N2e3+ | 漏看了 fxe3，兵吃马，换不回来 | 对 | fxe3 吃n：以小吃大，深搜净得 2 |
| 65 | 名局 | ?? | `r2qkbnr/1p3ppp/p1p5/4p3/4PPb1/3B4/PPP3PP/RNBQ1RK1 w kq - 1 9` | Qe1 | 更好的是 ♕xg4，吃掉没有保护住的象 | 对 | 深搜首选同为 Qxg4；Qxg4 吃b：吃不回，深搜净得 3 |
| 66 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B1n3/PP3PPP/2R2KNR w - - 2 17` | Ke1 | 更好的是 fxe3，兵吃马，净赚子力 | 对 | 深搜首选同为 fxe3；fxe3 吃n：以小吃大，深搜净得 2 |
| 67 | 名局 | ?? | `r2q1rk1/3n1pp1/p1pp2b1/1p2p1Bp/4P1PP/3P1N2/PPP1QP2/2KR3R b - - 1 15` | Qb6 | 更好的是 f6 | 对 | 深搜首选同为 f6 |
| 68 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n5/2B1n3/PP3PPP/2R1K1NR b - - 3 17` | Nxg2+ | 更好的是 ♞d5 | 对 | 深搜首选同为 Nd5 |
| 69 | 名局 | ?? | `r2q1rk1/3nbppp/b3p3/n1p1P3/p2p1B1P/P2PN1P1/2P2PBN/R2QR1K1 w - - 0 17` | Bf1 | 漏看了 dxe3，兵吃马，换不回来 | 对 | dxe3 吃n：以小吃大，深搜净得 2 |
| 70 | 低档 | ?? | `r1bq1k1r/pp4pp/8/7Q/2n4n/2B5/PP3P1P/2R2KNR w - - 2 19` | Qe2 | 更好的是 ♗b4+ | 对 | 深搜：Bb4+ 比所走好 471cp |
| 71 | 名局 | ?? | `r2q1rk1/3nbppp/b3p3/n1p1P3/p2p1B1P/P2PN1P1/2P2P1N/R2QRBK1 b - - 1 17` | Nb6 | 更好的是 dxe3，兵吃马，净赚子力 | 对 | 深搜首选同为 dxe3；dxe3 吃n：以小吃大，深搜净得 2 |
| 72 | 低档 | ?? | `3r2kr/pp4p1/5q1p/8/8/PP1R1nQ1/4NP1P/5KR1 b - - 0 30` | Nxh2+ | 更好的是 ♜xd3，吃掉没有保护住的车 | 对 | 深搜首选同为 Rxd3；Rxd3 吃r：吃不回，深搜净得 5 |
| 73 | 名局 | ?? | `r4rk1/ppp4p/2npb2b/3Nn3/2P1PPp1/1P1B2Pq/PB2N3/R2Q1RK1 w - - 1 20` | Rc1 | 更好的是 ♗xe5 | 对 | 深搜首选同为 Bxe5 |
| 74 | 低档 | ?? | `5rkr/pp4p1/5q1p/8/8/PP1R2Q1/4NP1K/6R1 b - - 0 32` | Rh7 | 更好的是 ♛xf2+ | 对 | 深搜首选同为 Qxf2+ |
| 75 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/2P1BN1P/2BQ1PP1/R3RNK1 w - - 7 20` | Ra3 | 漏看了 ♜xa3，车没有保护住 | 对 | Rxa3 吃r：吃不回，深搜净得 5 |
| 76 | 低档 | ?? | `2k2b1r/1pp5/p4n1p/5P2/1PN3P1/P1P3P1/R5K1/2N4r w - - 0 23` | Nb3 | 更好的是 ♔xh1，吃掉没有保护住的车 | 对 | 深搜首选同为 Kxh1；Kxh1 吃r：吃不回，深搜净得 4 |
| 77 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/R1P1BN1P/2BQ1PP1/4RNK1 b - - 8 20` | Qd8 | 更好的是 ♜xa3，吃掉没有保护住的车 | 对 | 深搜首选同为 Rxa3；Rxa3 吃r：吃不回，深搜净得 5 |
| 78 | 名局 | ?? | `r2qrbk1/1pp2ppp/2n5/p2bp3/Q7/P2PBNP1/1PR1PPBP/2R3K1 b - - 6 15` | Nb8 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 79 | 名局 | ?? | `r1b1k2r/p4ppp/2n1p3/1p6/3PP3/P4N2/3qBPPP/R3K2R w KQkq - 0 14` | Nxd2 | 更好的是 ♔xd2，吃掉没有保护住的后 | 对 | 深搜首选同为 Kxd2；Kxd2 吃q：吃不回，深搜净得 9 |
| 80 | 名局 | ?? | `r1b2rk1/p4ppp/2n1p3/1p6/3PP3/P7/3NBPPP/R4RK1 b - - 2 15` | Bb7 | 更好的是 ♞xd4 | 对 | 深搜首选同为 Nxd4 |
| 81 | 名局 | ?? | `2r2rk1/pb3ppp/2n1p3/1p6/3PP3/PN6/4BPPP/R1R3K1 b - - 6 17` | Na5 | 漏看了 ♘xa5，马没有保护住 | 对 | Nxa5 吃n：吃不回，深搜净得 3 |
| 82 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP3PP1/3QR1K1 w - - 1 17` | Qd2 | 漏看了 ♞e4 捉双，丢车 | 对 | 捉双：深搜线上吃到了 (2)；深搜线上净丢 2 |
| 83 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP1Q1PP1/4R1K1 b - - 2 17` | Rfe8 | 更好的是 ♞e4（捉双） | 对 | 深搜首选同为 Ne4；捉双：深搜线上吃到了 (2) |
| 84 | 名局 | ? | `rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6` | Nf6 | 对方 ♕b3 之后丢兵 | 对 | 深搜线上净丢 1 |
| 85 | 低档 | ? | `r1bqk2r/2p1nppp/pp1bpn2/3p4/2PP4/1PNBPN2/PB2QPPP/R3K2R b KQkq - 5 9` | Ng6 | 更好的是 ♝b7 | 对 | 深搜首选同为 Bb7 |
| 86 | 名局 | ? | `rn2kb1r/pp2qppp/2p2n2/4p1B1/2B1P3/1QN5/PPP2PPP/R3K2R b KQkq - 1 9` | b5 | 更好的是 ♛c7 | 对 | 深搜：Qc7 比所走好 61cp |
| 87 | 低档 | ? | `r1bqk2r/2p2ppp/pp1bpnn1/8/2pP4/1PNBPN2/PB2QPPP/2KR3R w kq - 0 11` | Bxg6 | 更好的是 bxc4 | 对 | 深搜首选同为 bxc4 |
| 88 | 名局 | ? | `r1bqk2r/pppp1ppp/2n2n2/8/1bBPP3/2N2N2/PP3PPP/R1BQK2R b KQkq - 2 7` | d5 | 更好的是 ♞xe4 | 对 | 深搜首选同为 Nxe4 |
| 89 | 低档 | ? | `r1bqk2r/2p3pp/pp1bpnp1/8/2pP4/1PN1PN2/PB2QPPP/2KR3R w kq - 0 12` | Ne5 | 更好的是 e4 | 对 | 深搜首选同为 e4 |
| 90 | 名局 | ? | `r3k2r/pppqn1pp/5p2/8/3P4/5N2/PP2QPPP/2R1R1K1 b kq - 3 16` | c6 | 更好的是 ♚f7 | 对 | 深搜首选同为 Kf7 |
| 91 | 低档 | ? | `r2qk2r/1bp3pp/pp1bpnp1/4N3/2PP4/2N1P3/PB2QPPP/2KR3R b kq - 0 13` | Bxg2 | 更好的是 ♛e7 | 对 | 深搜首选同为 Qe7 |
| 92 | 名局 | ? | `r6r/pp1qnkpp/4Np2/3p4/8/8/PP2QPPP/2R1R1K1 b - - 3 19` | Rhc8 | 更好的是 ♞c6 | 对 | 深搜：Nc6 比所走好 128cp |
| 93 | 低档 | ? | `r2q1rk1/1bpn2pp/pp2p1p1/4P3/2P1P3/2N2P2/PB2Q2P/2KR3R b - - 0 18` | Rf7 | 更好的是 ♛g5+ | 对 | 深搜首选同为 Qg5+ |
| 94 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p5/1B3Nqn/4Pp2/3P4/PPP3PP/RNBQ1K1R w kq - 0 10` | g4 | 更好的是 ♗a4 | 对 | 深搜首选同为 Ba4 |
| 95 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/4P1pP/2P1P3/2N2P2/PB2Q3/2KR3R w - - 0 21` | Nd5 | 漏看了 exd5，兵吃马，换不回来 | 对 | exd5 吃n：以小吃大，深搜净得 2 |
| 96 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p2n2/1B3Nq1/4PpP1/3P4/PPP4P/RNBQ1KR1 b kq - 2 11` | cxb5 | 更好的是 h5 | 对 | 深搜首选同为 h5 |
| 97 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/3NP1pP/2P1P3/5P2/PB2Q3/2KR3R b - - 1 21` | Bxd5 | 更好的是 exd5，兵吃马，净赚子力 | 对 | 深搜首选同为 exd5；exd5 吃n：以小吃大，深搜净得 2 |
| 98 | 名局 | ? | `rnb1kbnr/p2p1ppp/5q2/1p3N1P/4PBP1/2NP1Q2/PPP5/R4KR1 b kq - 2 16` | Bc5 | 更好的是 ♛c6 | 对 | 深搜首选同为 Qc6 |
| 99 | 低档 | ? | `1r2q3/2p1r1pk/4P2p/p1p1P1pP/2Q1P3/P4PR1/5R2/2K5 b - - 2 35` | Qf8 | 更好的是 ♜xe6 | 对 | 深搜首选同为 Rxe6 |
| 100 | 名局 | ? | `rnb1k1nr/p2p1ppp/3B4/1p1N1N1P/4P1P1/3P1Q2/PqP5/R4Kb1 w kq - 0 19` | e5 | 没理会对方 ♛xa1+ 的威胁，车没有保护住 | 对 | 走之前 Qxa1+ 就能白吃r；Qxa1+ 吃r：吃不回，深搜净得 5 |

<!-- audit:after:end -->
