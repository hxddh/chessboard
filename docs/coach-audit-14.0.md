# 教练解释抽检（v14-0-plan B）

14.0 B 给复盘的一句「为什么」加了一种说法：更好的那步**能赢下什么**（`ex.betterWins`，「更好的是 ♝xd5，能赢下对方一个兵」）。原来这些手只说「更好的是 X」。

## 怎么量的

和 [8.0 的抽检](coach-audit-8.0.md) 同一套办法、同一批 100 手、同一份引擎缓存：`node scripts/test-coach.mjs --audit=docs/coach-audit-14.0.md`。oracle 新增一条：说「能赢下 X」的，深搜沿更好那步走到安静处，净得要撑得起 X（小子及以上至少 2，兵至少 1），且那步本身要被深搜认作更好。

## 结果

- 100 条错 1（1%），8.0 改后是 1 条，同一条：第 58 条「对方 ♗xe4 之后丢兵」，是兵换兵，7.x 起就有的句子。
- 新句 `ex.betterWins` 10 条，全对；其中「♛xf2+ 能赢下一个兵」深搜净得 10（后面是杀），说少了，不算错。
- 只说「更好的是 X」的从 35 条降到 25 条。
- 全量（211 手 ? / ??）：说出具体原因的 57.8%（8.0 改后 44%），说出母题的 31.8%；?? 说出母题或杀的 60.2%。

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
| 10 | 低档 | ?? | `2kr2n1/p7/q1p1b3/3P2p1/1p2P2p/4Q3/1PPK2PP/4R2R b - - 0 22` | Qb6 | 更好的是 ♝xd5，能赢下对方一个兵 | 对 | 深搜首选同为 Bxd5；深搜线上净得 2 |
| 11 | 名局 | ?? | `3r3r/1R3p1p/6p1/1p6/2q5/5PP1/1Q5P/1K1k1B2 b - - 5 36` | Rd2 | 对方 ♖d7 之后丢后 | 对 | 深搜线上净丢 6 |
| 12 | 低档 | ?? | `3r2n1/pk6/1qp1b3/3P2p1/1pP1P2p/4Q3/1P1K2PP/R6R b - c3 0 24` | cxd5 | 更好的是 bxc3+，能赢下对方一个兵 | 对 | 深搜首选同为 bxc3+；深搜线上净得 1 |
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
| 42 | 低档 | ?? | `rn1q1rk1/1bpp2bp/3np3/1p4PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 17` | c5 | 更好的是 ♝xg2，能赢下对方一个兵 | 对 | 深搜首选同为 Bxg2；深搜线上净得 1 |
| 43 | 名局 | ?? | `2rq1rk1/pb2bppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 b - - 0 16` | Qd7 | 漏看了 ♕xd7，后没有保护住 | 对 | Qxd7 吃q：吃不回，深搜净得 12 |
| 44 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pp3PP/3P2Q1/1BP1P1N1/P5P1/RNB1K2R w KQ c6 0 18` | dxc5 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 45 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/4p3/1P2P1P1/P4PBP/2RQ1RK1 w - - 1 17` | b4 | 更好的是 ♕xd7，吃掉没有保护住的后 | 对 | 深搜首选同为 Qxd7；Qxd7 吃q：吃不回，深搜净得 12 |
| 46 | 低档 | ?? | `rn1q1rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R b KQ - 0 18` | Qc8 | 对方 h6 之后丢马 | 对 | 深搜线上净丢 2 |
| 47 | 名局 | ?? | `2r2rk1/pb1qbppp/8/2p1B3/1P2p3/4P1P1/P4PBP/2RQ1RK1 b - - 0 17` | cxb4 | 没理会对方 ♕xd7 的威胁，后没有保护住 | 对 | 走之前 Qxd7 就能白吃q；Qxd7 吃q：吃不回，深搜净得 9 |
| 48 | 低档 | ?? | `rnq2rk1/1b1p2bp/3np3/1pP3PP/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 1 19` | g6 | 更好的是 h6，能赢下对方一个马 | 对 | 深搜首选同为 h6；深搜线上净得 2 |
| 49 | 名局 | ?? | `2r2rk1/pb1qbppp/8/4B3/1p2p3/4P1P1/P4PBP/2RQ1RK1 w - - 0 18` | Qb3 | 更好的是 ♕xd7，吃掉没有保护住的后 | 对 | 深搜首选同为 Qxd7；Qxd7 吃q：吃不回，深搜净得 10 |
| 50 | 低档 | ?? | `rn3rk1/1b1p2bp/3np1P1/1pq4P/6Q1/1BP1P1N1/P5P1/RNB1K2R w KQ - 0 20` | Rf1 | 更好的是 ♗xe6+ | 对 | 深搜首选同为 Bxe6+ |
| 51 | 名局 | ?? | `2r2rk1/pb2bppp/8/3qB3/1p2p3/1Q2P1P1/P4PBP/2R2RK1 w - - 2 19` | Qxb4 | 漏看了 ♝xb4，后没有保护住 | 对 | Bxb4 吃q：吃不回，深搜净得 8 |
| 52 | 低档 | ?? | `r5k1/1b1p3p/2nnp1Pb/1pq5/6Q1/BBP1P3/P5P1/RN2KN2 b Q - 1 23` | Qf5 | 更好的是 ♜xa3，能赢下对方一个象 | 对 | 深搜首选同为 Rxa3；深搜线上净得 3 |
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
| 74 | 低档 | ?? | `5rkr/pp4p1/5q1p/8/8/PP1R2Q1/4NP1K/6R1 b - - 0 32` | Rh7 | 更好的是 ♛xf2+，能赢下对方一个兵 | 对 | 深搜首选同为 Qxf2+；深搜线上净得 10 |
| 75 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/2P1BN1P/2BQ1PP1/R3RNK1 w - - 7 20` | Ra3 | 漏看了 ♜xa3，车没有保护住 | 对 | Rxa3 吃r：吃不回，深搜净得 5 |
| 76 | 低档 | ?? | `2k2b1r/1pp5/p4n1p/5P2/1PN3P1/P1P3P1/R5K1/2N4r w - - 0 23` | Nb3 | 更好的是 ♔xh1，吃掉没有保护住的车 | 对 | 深搜首选同为 Kxh1；Kxh1 吃r：吃不回，深搜净得 4 |
| 77 | 名局 | ?? | `r1r3k1/1nqbbppp/3p1n2/1ppPp3/1P2P3/R1P1BN1P/2BQ1PP1/4RNK1 b - - 8 20` | Qd8 | 更好的是 ♜xa3，吃掉没有保护住的车 | 对 | 深搜首选同为 Rxa3；Rxa3 吃r：吃不回，深搜净得 5 |
| 78 | 名局 | ?? | `r2qrbk1/1pp2ppp/2n5/p2bp3/Q7/P2PBNP1/1PR1PPBP/2R3K1 b - - 6 15` | Nb8 | 更好的是 h6 | 对 | 深搜首选同为 h6 |
| 79 | 名局 | ?? | `r1b1k2r/p4ppp/2n1p3/1p6/3PP3/P4N2/3qBPPP/R3K2R w KQkq - 0 14` | Nxd2 | 更好的是 ♔xd2，吃掉没有保护住的后 | 对 | 深搜首选同为 Kxd2；Kxd2 吃q：吃不回，深搜净得 9 |
| 80 | 名局 | ?? | `r1b2rk1/p4ppp/2n1p3/1p6/3PP3/P7/3NBPPP/R4RK1 b - - 2 15` | Bb7 | 更好的是 ♞xd4，能赢下对方一个兵 | 对 | 深搜首选同为 Nxd4；深搜线上净得 1 |
| 81 | 名局 | ?? | `2r2rk1/pb3ppp/2n1p3/1p6/3PP3/PN6/4BPPP/R1R3K1 b - - 6 17` | Na5 | 漏看了 ♘xa5，马没有保护住 | 对 | Nxa5 吃n：吃不回，深搜净得 3 |
| 82 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP3PP1/3QR1K1 w - - 1 17` | Qd2 | 漏看了 ♞e4 捉双，丢车 | 对 | 捉双：深搜线上吃到了 (2)；深搜线上净丢 2 |
| 83 | 名局 | ?? | `r4rk1/pp3ppp/2pq1n2/5b2/3P4/1BR2N1P/PP1Q1PP1/4R1K1 b - - 2 17` | Rfe8 | 更好的是 ♞e4（捉双） | 对 | 深搜首选同为 Ne4；捉双：深搜线上吃到了 (2) |
| 84 | 名局 | ? | `rn1qkbnr/ppp2ppp/8/4p3/2B1P3/5Q2/PPP2PPP/RNB1K2R b KQkq - 1 6` | Nf6 | 对方 ♕b3 之后丢兵 | 对 | 深搜线上净丢 1 |
| 85 | 低档 | ? | `r1bqk2r/2p1nppp/pp1bpn2/3p4/2PP4/1PNBPN2/PB2QPPP/R3K2R b KQkq - 5 9` | Ng6 | 更好的是 ♝b7 | 对 | 深搜首选同为 Bb7 |
| 86 | 名局 | ? | `rn2kb1r/pp2qppp/2p2n2/4p1B1/2B1P3/1QN5/PPP2PPP/R3K2R b KQkq - 1 9` | b5 | 更好的是 ♛c7 | 对 | 深搜：Qc7 比所走好 61cp |
| 87 | 低档 | ? | `r1bqk2r/2p2ppp/pp1bpnn1/8/2pP4/1PNBPN2/PB2QPPP/2KR3R w kq - 0 11` | Bxg6 | 更好的是 bxc4，能赢下对方一个兵 | 对 | 深搜首选同为 bxc4；深搜线上净得 1 |
| 88 | 名局 | ? | `r1bqk2r/pppp1ppp/2n2n2/8/1bBPP3/2N2N2/PP3PPP/R1BQK2R b KQkq - 2 7` | d5 | 更好的是 ♞xe4，能赢下对方一个兵 | 对 | 深搜首选同为 Nxe4；深搜线上净得 1 |
| 89 | 低档 | ? | `r1bqk2r/2p3pp/pp1bpnp1/8/2pP4/1PN1PN2/PB2QPPP/2KR3R w kq - 0 12` | Ne5 | 更好的是 e4 | 对 | 深搜首选同为 e4 |
| 90 | 名局 | ? | `r3k2r/pppqn1pp/5p2/8/3P4/5N2/PP2QPPP/2R1R1K1 b kq - 3 16` | c6 | 更好的是 ♚f7 | 对 | 深搜首选同为 Kf7 |
| 91 | 低档 | ? | `r2qk2r/1bp3pp/pp1bpnp1/4N3/2PP4/2N1P3/PB2QPPP/2KR3R b kq - 0 13` | Bxg2 | 更好的是 ♛e7 | 对 | 深搜首选同为 Qe7 |
| 92 | 名局 | ? | `r6r/pp1qnkpp/4Np2/3p4/8/8/PP2QPPP/2R1R1K1 b - - 3 19` | Rhc8 | 更好的是 ♞c6 | 对 | 深搜：Nc6 比所走好 128cp |
| 93 | 低档 | ? | `r2q1rk1/1bpn2pp/pp2p1p1/4P3/2P1P3/2N2P2/PB2Q2P/2KR3R b - - 0 18` | Rf7 | 更好的是 ♛g5+，能赢下对方一个兵 | 对 | 深搜首选同为 Qg5+；深搜线上净得 1 |
| 94 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p5/1B3Nqn/4Pp2/3P4/PPP3PP/RNBQ1K1R w kq - 0 10` | g4 | 更好的是 ♗a4 | 对 | 深搜首选同为 Ba4 |
| 95 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/4P1pP/2P1P3/2N2P2/PB2Q3/2KR3R w - - 0 21` | Nd5 | 漏看了 exd5，兵吃马，换不回来 | 对 | exd5 吃n：以小吃大，深搜净得 2 |
| 96 | 名局 | ? | `rnb1kb1r/p2p1ppp/2p2n2/1B3Nq1/4PpP1/3P4/PPP4P/RNBQ1KR1 b kq - 2 11` | cxb5 | 更好的是 h5 | 对 | 深搜首选同为 h5 |
| 97 | 低档 | ? | `r5k1/1bpnqrpp/pp2p3/3NP1pP/2P1P3/5P2/PB2Q3/2KR3R b - - 1 21` | Bxd5 | 更好的是 exd5，兵吃马，净赚子力 | 对 | 深搜首选同为 exd5；exd5 吃n：以小吃大，深搜净得 2 |
| 98 | 名局 | ? | `rnb1kbnr/p2p1ppp/5q2/1p3N1P/4PBP1/2NP1Q2/PPP5/R4KR1 b kq - 2 16` | Bc5 | 更好的是 ♛c6 | 对 | 深搜首选同为 Qc6 |
| 99 | 低档 | ? | `1r2q3/2p1r1pk/4P2p/p1p1P1pP/2Q1P3/P4PR1/5R2/2K5 b - - 2 35` | Qf8 | 更好的是 ♜xe6 | 对 | 深搜首选同为 Rxe6 |
| 100 | 名局 | ? | `rnb1k1nr/p2p1ppp/3B4/1p1N1N1P/4P1P1/3P1Q2/PqP5/R4Kb1 w kq - 0 19` | e5 | 没理会对方 ♛xa1+ 的威胁，车没有保护住 | 对 | 走之前 Qxa1+ 就能白吃r；Qxa1+ 吃r：吃不回，深搜净得 5 |

<!-- audit:after:end -->
