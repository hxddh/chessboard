/**
 * Ten annotated classic games — the 「读棋」 module of the intermediate course
 * (docs/v6-plan.md §Q3.5). Every game is public domain, and every move list
 * is replayed end to end by scripts/test-classics.mjs under chess.js
 * `load_pgn({ sloppy: true })`, so a mistyped move fails the build rather than
 * shipping as a "classic" nobody can step through.
 *
 * Shape: { id, white, black, event, year, eco, result, pgn, notes: [{ply, text}] }.
 * `ply` counts half-moves from 1 (1.e4 is ply 1, 1...e5 is ply 2); a note is
 * shown once that ply has been played. Only prose is translated —
 * classics-en.js / classics-ja.js carry { [id]: { white, black, event,
 * notes: { [ply]: text } } } and the test asserts the ply sets match.
 * @module classics
 */
  export const CHESS_CLASSICS = [
    {
      id: "morphy-opera-1858",
      white: "保罗·莫菲", black: "布伦瑞克公爵与伊苏阿尔伯爵",
      event: "巴黎歌剧院", year: 1858, eco: "C41", result: "1-0",
      pgn: "1.e4 e5 2.Nf3 d6 3.d4 Bg4 4.dxe5 Bxf3 5.Qxf3 dxe5 6.Bc4 Nf6 7.Qb3 Qe7 8.Nc3 c6 9.Bg5 b5 10.Nxb5 cxb5 11.Bxb5+ Nbd7 12.O-O-O Rd8 13.Rxd7 Rxd7 14.Rd1 Qe6 15.Bxd7+ Nxd7 16.Qb8+ Nxb8 17.Rd8# 1-0",
      notes: [
        { ply: 6, text: "3...Bg4 把象早早牵在 f3 上，下一步就得用象换马。开局里轻易交出双象，代价要到中局才付。" },
        { ply: 13, text: "7.Qb3 一子攻两处：f7 和 b7。黑方只救得了一个。" },
        { ply: 15, text: "8.Nc3！莫菲不吃 b7 兵。吃了兵要用两步收回后，他宁愿再出一个子。出子领先，才是这盘棋真正的本钱。" },
        { ply: 19, text: "10.Nxb5 弃马打开 b 线和 a4–e8 斜线。黑王还在中央，所有开放线都通向它。" },
        { ply: 23, text: "12.O-O-O 长易位带着车一起上 d 线，牵住 d7 马 —— 一步棋，两件事。" },
        { ply: 25, text: "13.Rxd7 弃车换马：消除 f6 马的支撑，让 d 线的牵制再压一层。" },
        { ply: 31, text: "16.Qb8+！弃后引离：b8 的马被迫离开 d7，底线就没有人守了。" },
        { ply: 33, text: "17.Rd8#。白方用后和马换来黑方整队子力没能出动的时间 —— 这就是「开局先出子」的全部理由。" },
      ],
    },
    {
      id: "anderssen-kieseritzky-1851",
      white: "阿道夫·安德森", black: "利昂内尔·基泽里茨基",
      event: "伦敦（不朽之局）", year: 1851, eco: "C33", result: "1-0",
      pgn: "1.e4 e5 2.f4 exf4 3.Bc4 Qh4+ 4.Kf1 b5 5.Bxb5 Nf6 6.Nf3 Qh6 7.d3 Nh5 8.Nh4 Qg5 9.Nf5 c6 10.g4 Nf6 11.Rg1 cxb5 12.h4 Qg6 13.h5 Qg5 14.Qf3 Ng8 15.Bxf4 Qf6 16.Nc3 Bc5 17.Nd5 Qxb2 18.Bd6 Bxg1 19.e5 Qxa1+ 20.Ke2 Na6 21.Nxg7+ Kd8 22.Qf6+ Nxf6 23.Be7# 1-0",
      notes: [
        { ply: 6, text: "3...Qh4+ 让白王失去易位权，但后从此要被白方的每一个出子追着跑。早出后，赢的是一步，输的是好几步。" },
        { ply: 21, text: "11.Rg1 主动放弃易位，把车摆上 g 线。安德森的王待在 f1 也没关系 —— 黑方没有一个子能过来。" },
        { ply: 31, text: "16.Nc3。数一数：白方四个轻子全部出动，黑方只有一个后在外面。" },
        { ply: 34, text: "17...Qxb2 吃兵，落后出子还去抢子 —— 后离开防线的这一步，是全盘的转折点。" },
        { ply: 35, text: "18.Bd6！！两个车同时送给黑方。安德森算准了：吃车花的两步，正好够他把杀网织完。" },
        { ply: 38, text: "19...Qxa1+ 拿到第二个车。黑方多了两车一象，却没有一个子在自己王的附近。" },
        { ply: 41, text: "21.Nxg7+ 开始收网：马、象、后三个子对着 e7/f6 那一小片格子。" },
        { ply: 45, text: "23.Be7#。白方只剩三个轻子，黑方子力几乎完整 —— 但在王身边，能用的子数才算数。" },
      ],
    },
    {
      id: "anderssen-dufresne-1852",
      white: "阿道夫·安德森", black: "让·杜弗雷纳",
      event: "柏林（常青之局）", year: 1852, eco: "C52", result: "1-0",
      pgn: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.b4 Bxb4 5.c3 Ba5 6.d4 exd4 7.O-O d3 8.Qb3 Qf6 9.e5 Qg6 10.Re1 Nge7 11.Ba3 b5 12.Qxb5 Rb8 13.Qa4 Bb6 14.Nbd2 Bb7 15.Ne4 Qf5 16.Bxd3 Qh5 17.Nf6+ gxf6 18.exf6 Rg8 19.Rad1 Qxf3 20.Rxe7+ Nxe7 21.Qxd7+ Kxd7 22.Bf5+ Ke8 23.Bd7+ Kf8 24.Bxe7# 1-0",
      notes: [
        { ply: 7, text: "4.b4 伊文思弃兵：用一个兵换黑象两步时间，再用 c3、d4 抢中心。" },
        { ply: 13, text: "7.O-O 不理会 d4 兵，先把王送到安全处。安德森的账很简单：一个兵换一个回合。" },
        { ply: 21, text: "11.Ba3 把象放在 a3–f8 斜线上，黑王从此不能短易位。这一步管住了黑方整个下半盘的计划。" },
        { ply: 33, text: "17.Nf6+ 弃马打开 g 线，也把 f6 兵楔进黑王的门口。" },
        { ply: 37, text: "19.Rad1！！全盘最著名的一步安静着：没有将军，没有吃子，只是把 d 线的车调上来 —— 后面 Rxe7 与 Qxd7 两个弃子都靠它。" },
        { ply: 38, text: "19...Qxf3 吃马看似白方漏算了，其实黑后离开的正是它必须守住的 e7、d7 两格。" },
        { ply: 39, text: "20.Rxe7+ 引入：把马拉到 e7，让它挡住自己王的退路。" },
        { ply: 41, text: "21.Qxd7+！！弃后引王：黑王被拉到 d7，两个象接力将军。" },
        { ply: 47, text: "24.Bxe7#。整个组合的每一步都在利用第 19 步车站上 d 线后打开的那条线。" },
      ],
    },
    {
      id: "steinitz-bardeleben-1895",
      white: "威廉·斯坦尼茨", black: "库尔特·冯·巴德莱本",
      event: "黑斯廷斯", year: 1895, eco: "C54", result: "1-0",
      pgn: "1.e4 e5 2.Nf3 Nc6 3.Bc4 Bc5 4.c3 Nf6 5.d4 exd4 6.cxd4 Bb4+ 7.Nc3 d5 8.exd5 Nxd5 9.O-O Be6 10.Bg5 Be7 11.Bxd5 Bxd5 12.Nxd5 Qxd5 13.Bxe7 Nxe7 14.Re1 f6 15.Qe2 Qd7 16.Rac1 c6 17.d5 cxd5 18.Nd4 Kf7 19.Ne6 Rhc8 20.Qg4 g6 21.Ng5+ Ke8 22.Rxe7+ Kf8 23.Rf7+ Kg8 24.Rg7+ Kh8 25.Rxh7+ 1-0",
      notes: [
        { ply: 13, text: "7.Nc3 弃兵换出子。斯坦尼茨是「稳健派」，但他同样懂：王没易位时，时间比一个兵值钱。" },
        { ply: 27, text: "14.Re1 牵住 e7 马，黑王被卡在中央 —— 从这一刻起黑方再也没机会易位。" },
        { ply: 33, text: "17.d5！在黑王还没回家之前打开中央。原则：对方王在中间，就开线。" },
        { ply: 39, text: "20.Qg4 同时威胁 Qxg7 和 Qxd7 —— 一子攻两处。" },
        { ply: 43, text: "22.Rxe7+！！这个车谁都吃不得：Kxe7 后 Re1+ 追杀，Qxe7 则 Rxc8+ 底线先丢车。" },
        { ply: 45, text: "23.Rf7+ 车继续贴着黑王走，始终不能被吃，因为 d7 后与 c8 车之间的过载还在。" },
        { ply: 49, text: "25.Rxh7+ 后巴德莱本离席认输。斯坦尼茨当场演示了后面的 10 步杀：Kg8 Rg7+ Kh8 Qh4+ Kxg7 Qh7+ Kf8 Qh8+ Ke7 Qg7+ Ke8 Qg8+ Ke7 Qf7+ Kd8 Qf8+ Qe8 Nf7+ Kd7 Qd6#。" },
      ],
    },
    {
      id: "lasker-bauer-1889",
      white: "伊曼纽尔·拉斯克", black: "约翰·鲍尔",
      event: "阿姆斯特丹", year: 1889, eco: "A03", result: "1-0",
      pgn: "1.f4 d5 2.e3 Nf6 3.b3 e6 4.Bb2 Be7 5.Bd3 b6 6.Nc3 Bb7 7.Nf3 Nbd7 8.O-O O-O 9.Ne2 c5 10.Ng3 Qc7 11.Ne5 Nxe5 12.Bxe5 Qc6 13.Qe2 a6 14.Nh5 Nxh5 15.Bxh7+ Kxh7 16.Qxh5+ Kg8 17.Bxg7 Kxg7 18.Qg4+ Kh7 19.Rf3 e5 20.Rh3+ Qh6 21.Rxh6+ Kxh6 22.Qd7 Bf6 23.Qxb7 Kg7 24.Rf1 Rab8 25.Qd7 Rfd8 26.Qg4+ Kf8 27.fxe5 Bg7 28.e6 Rb7 29.Qg6 f6 30.Rxf6+ Bxf6 31.Qxf6+ Ke8 32.Qh8+ Ke7 33.Qg7+ Kxe6 34.Qxb7 Rd6 35.Qxa6 d4 36.exd4 cxd4 37.h4 d3 38.Qxd3 1-0",
      notes: [
        { ply: 9, text: "5.Bd3 —— 两个象分别瞄着 h7 和 g7。整盘棋的杀法，从这两条斜线上就已经排好了。" },
        { ply: 19, text: "10.Ng3 马从 c3 绕到 g3，为的是下一步跳 h5 去换掉 f6 马 —— 黑王身边唯一的守卫。" },
        { ply: 27, text: "14.Nh5 消除防守者：f6 马一走，h7 和 g7 就只剩兵自己守。" },
        { ply: 29, text: "15.Bxh7+！第一个象。Kxh7 后 Qxh5+ 逼王回 g8。" },
        { ply: 33, text: "17.Bxg7！！第二个象。「双象弃杀」的样板：两个象各撕开一格，后和车从缺口进来。" },
        { ply: 37, text: "19.Rf3 提车上第 3 横线 —— 车经 h3 加入攻势，黑方只能用后挡。" },
        { ply: 43, text: "22.Qd7！组合的最后一环：后同时攻击 b7 和 e7 两个象，把弃掉的子力收回来。多出的子力加上暴露的黑王，胜负已定。" },
        { ply: 75, text: "38.Qxd3。白方从第 15 步起弃掉的每一个子，最终都靠第 22 步的双攻收回，还多出一个兵的残局。" },
      ],
    },
    {
      id: "pillsbury-tarrasch-1895",
      white: "哈里·皮尔斯伯里", black: "西格伯特·塔拉什",
      event: "黑斯廷斯", year: 1895, eco: "D63", result: "1-0",
      pgn: "1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Bg5 Be7 5.Nf3 Nbd7 6.Rc1 O-O 7.e3 b6 8.cxd5 exd5 9.Bd3 Bb7 10.O-O c5 11.Re1 c4 12.Bb1 a6 13.Ne5 b5 14.f4 Re8 15.Qf3 Nf8 16.Ne2 Ne4 17.Bxe7 Rxe7 18.Bxe4 dxe4 19.Qg3 f6 20.Ng4 Kh8 21.f5 Qd7 22.Rf1 Rd8 23.Rf4 Qd6 24.Qh4 Rde8 25.Nc3 Bd5 26.Nf2 Qc6 27.Rf1 b4 28.Ne2 Qa4 29.Ng4 Nd7 30.R4f2 Kg8 31.Nc1 c3 32.b3 Qc6 33.h3 a5 34.Nh2 a4 35.g4 axb3 36.axb3 Ra8 37.g5 Ra3 38.Ng4 Bxb3 39.Rg2 Kh8 40.gxf6 gxf6 41.Nxb3 Rxb3 42.Nh6 Rg7 43.Rxg7 Kxg7 44.Qg3+ Kxh6 45.Kh1 Qd5 46.Rg1 Qxf5 47.Qh4+ Qh5 48.Qf4+ Qg5 49.Rxg5 fxg5 50.Qd6+ Kh5 51.Qxd7 c2 52.Qxh7# 1-0",
      notes: [
        { ply: 22, text: "11...c4 塔拉什在后翼抢空间，但松开了对 d4 的压力，也把 e5 格送给白马。" },
        { ply: 25, text: "13.Ne5 马占前哨：这格黑方没有兵能赶它走。" },
        { ply: 27, text: "14.f4 两个计划开始赛跑：白方推 f 兵攻王翼，黑方推后翼多数兵造通路兵。" },
        { ply: 41, text: "21.f5 兵推到 f5，把黑方的 e6 格和 g6 格都拿走 —— 黑王的呼吸空间在缩小。" },
        { ply: 62, text: "31...c3 黑方的通路兵到了第 6 横线，连着 b4 兵一起往前压。谁的计划先到终点，谁就赢。" },
        { ply: 69, text: "35.g4 皮尔斯伯里也推兵：g4–g5 拆开 f6，白方所有重子都对着 g 线。" },
        { ply: 83, text: "42.Nh6 马跳进黑王的门口，g 线上的杀威胁逼黑车回防。黑方的后翼兵还差两步。" },
        { ply: 87, text: "44.Qg3+ 黑王被拖出来。之后每一步都是将军 —— 黑方那两个通路兵再也没有机会走。" },
        { ply: 103, text: "52.Qxh7#。攻王的计划比造通路兵的计划快了一步，一步就够了。" },
      ],
    },
    {
      id: "capablanca-marshall-1918",
      white: "何塞·劳尔·卡帕布兰卡", black: "弗兰克·马歇尔",
      event: "纽约", year: 1918, eco: "C89", result: "1-0",
      pgn: "1.e4 e5 2.Nf3 Nc6 3.Bb5 a6 4.Ba4 Nf6 5.O-O Be7 6.Re1 b5 7.Bb3 O-O 8.c3 d5 9.exd5 Nxd5 10.Nxe5 Nxe5 11.Rxe5 Nf6 12.Re1 Bd6 13.h3 Ng4 14.Qf3 Qh4 15.d4 Nxf2 16.Re2 Bg4 17.hxg4 Bh2+ 18.Kf1 Bg3 19.Rxf2 Qh1+ 20.Ke2 Bxf2 21.Bd2 Bh4 22.Qh3 Rae8+ 23.Kd3 Qf1+ 24.Kc2 Bf2 25.Qf3 Qg1 26.Bd5 c5 27.dxc5 Bxc5 28.b4 Bd6 29.a4 a5 30.axb5 axb4 31.Ra6 bxc3 32.Nxc3 Bb4 33.b6 Bxc3 34.Bxc3 h6 35.b7 Re3 36.Bxf7+ 1-0",
      notes: [
        { ply: 16, text: "8...d5 马歇尔弃兵：这是「马歇尔攻击」第一次在正式比赛亮相，据说他为此准备了多年。" },
        { ply: 26, text: "13...Ng4 弃马开始进攻。卡帕布兰卡事先并不知道这一切，只能在棋盘上一步步算。" },
        { ply: 29, text: "15.d4 不去救子，而是打开 c1 象的斜线。防守时最好的一步常常是出一个子。" },
        { ply: 37, text: "19.Rxf2 还回一个车换掉最危险的进攻子。少子但王安全，胜过多子却挨将。" },
        { ply: 45, text: "23.Kd3 白王亲自走出去 —— 到 c2 之后它在自己子力后面反而最安全。" },
        { ply: 51, text: "26.Bd5 进攻打完了，卡帕布兰卡开始用多出来的轻子和后翼多数兵做文章。" },
        { ply: 65, text: "33.b6 通路兵开始跑，黑方的进攻子力全在王翼，赶不回来。" },
        { ply: 71, text: "36.Bxf7+ 马歇尔认输：b 兵升变挡不住。防守的模板 —— 先还子稳住王，再用剩下的优势赢。" },
      ],
    },
    {
      id: "reti-bogoljubov-1924",
      white: "理查德·雷蒂", black: "叶菲姆·博戈柳博夫",
      event: "纽约", year: 1924, eco: "A13", result: "1-0",
      pgn: "1.Nf3 Nf6 2.c4 e6 3.g3 d5 4.Bg2 Bd6 5.O-O O-O 6.b3 Re8 7.Bb2 Nbd7 8.d4 c6 9.Nbd2 Ne4 10.Nxe4 dxe4 11.Ne5 f5 12.f3 exf3 13.Bxf3 Qc7 14.Nxd7 Bxd7 15.e4 e5 16.c5 Bf8 17.Qc2 exd4 18.exf5 Rad8 19.Bh5 Re5 20.Bxd4 Rxf5 21.Rxf5 Bxf5 22.Qxf5 Rxd4 23.Rf1 Rd8 24.Bf7+ Kh8 25.Be8 1-0",
      notes: [
        { ply: 5, text: "3.g3 超现代派的开局：不急着用兵占中心，先用两个象从侧翼盯住中心。" },
        { ply: 23, text: "12.f3 拆掉黑方的 e4 兵，f 线打开后 f1 车直接对着黑王。" },
        { ply: 29, text: "15.e4 到这一步白方的中心才推出来 —— 时机在于黑方已经没有子能反攻它。" },
        { ply: 31, text: "16.c5 引离：黑象被赶回 f8，不能再守住 e5。" },
        { ply: 37, text: "19.Bh5！攻击 e8 车，同时让开 f 线。黑车不管走哪，f 线都会打开。" },
        { ply: 43, text: "22.Qxf5 白方一直在换掉黑王身边的守卫，剩下的都是攻击子。" },
        { ply: 47, text: "24.Bf7+ 把王赶到角落，f8 象被牵在底线上。" },
        { ply: 49, text: "25.Be8！安静的一步收官：象堵住 e8，威胁 Qf8+ 与 Qxf8 —— 黑方没有一个子能同时解决这两件事。" },
      ],
    },
    {
      id: "rotlewi-rubinstein-1907",
      white: "格尔什·罗特列维", black: "阿基巴·鲁宾斯坦",
      event: "罗兹", year: 1907, eco: "D32", result: "0-1",
      pgn: "1.d4 d5 2.Nf3 e6 3.e3 c5 4.c4 Nc6 5.Nc3 Nf6 6.dxc5 Bxc5 7.a3 a6 8.b4 Bd6 9.Bb2 O-O 10.Qd2 Qe7 11.Bd3 dxc4 12.Bxc4 b5 13.Bd3 Rd8 14.Qe2 Bb7 15.O-O Ne5 16.Nxe5 Bxe5 17.f4 Bc7 18.e4 Rac8 19.e5 Bb6+ 20.Kh1 Ng4 21.Be4 Qh4 22.g3 Rxc3 23.gxh4 Rd2 24.Qxd2 Bxe4+ 25.Qg2 Rh3 0-1",
      notes: [
        { ply: 19, text: "10.Qd2？后站在 d 线上，之后被黑车追着走了两步 —— 对称的局面里，多花的每一步都会记账。" },
        { ply: 25, text: "13.Bd3 白象在 d3、c4 之间来回走了三次。鲁宾斯坦比对手多出了整整两步出子。" },
        { ply: 36, text: "18...Rac8 黑方两个车分别对着 c 线和 d 线，两个象对着白王 —— 每个子都在攻击线上。" },
        { ply: 41, text: "21.Be4 挡住 b7 象的斜线，但这个象自己就是下一步弃子的目标。" },
        { ply: 44, text: "22...Rxc3！！鲁宾斯坦的不朽组合从这里开始：先弃车，不理会自己的后被攻。" },
        { ply: 46, text: "23...Rd2！！第二个车也送出去：无论白方吃哪个，两个象和车会在 h 线上合围。" },
        { ply: 48, text: "24...Bxe4+ 闪将：象吃象带将军，白后被迫挡到 g2。" },
        { ply: 50, text: "25...Rh3！白方认输：Rxh2# 与 Bxg2# 无法同时防住。黑方总共弃了后和车，换来一个安静的车走。" },
      ],
    },
    {
      id: "bernstein-capablanca-1914",
      white: "奥西普·伯恩斯坦", black: "何塞·劳尔·卡帕布兰卡",
      event: "莫斯科", year: 1914, eco: "D63", result: "0-1",
      pgn: "1.d4 d5 2.c4 e6 3.Nc3 Nf6 4.Nf3 Be7 5.Bg5 O-O 6.e3 Nbd7 7.Rc1 b6 8.cxd5 exd5 9.Qa4 Bb7 10.Ba6 Bxa6 11.Qxa6 c5 12.Bxf6 Nxf6 13.dxc5 bxc5 14.O-O Qb6 15.Qe2 c4 16.Rfd1 Rfd8 17.Nd4 Bb4 18.b3 Rac8 19.bxc4 dxc4 20.Rc2 Bxc3 21.Rxc3 Nd5 22.Rc2 c3 23.Rdc1 Rc5 24.Nb3 Rc6 25.Nd4 Rc7 26.Nb5 Rc5 27.Nxc3 Nxc3 28.Rxc3 Rxc3 29.Rxc3 Qb2 0-1",
      notes: [
        { ply: 19, text: "10.Ba6 换掉黑方的白格象。伯恩斯坦的计划是攻黑方的悬兵 c5/d5。" },
        { ply: 26, text: "13...bxc5 黑方得到 c5、d5 一对悬兵：它们既是目标，也是随时能推进的力量。" },
        { ply: 30, text: "15...c4！卡帕布兰卡推掉悬兵，换来一个受保护的通路兵。悬兵的处理原则：要么推进变通路兵，要么就会被围攻。" },
        { ply: 34, text: "17...Bb4 牵住 c3 马 —— 通路兵前进路上的障碍要一个个清掉。" },
        { ply: 44, text: "22...c3 通路兵到了第 6 横线，白方两个车都被它钉在 c 线上。" },
        { ply: 51, text: "26.Nb5？白方以为吃掉 c3 兵就能解脱。" },
        { ply: 53, text: "27.Nxc3 吃兵。到 29.Rxc3 为止，白方多了一个兵 —— 但看看白方的底线：王没有气孔，车又离开了第 1 横线。" },
        { ply: 58, text: "29...Qb2！！白方认输：Qxb2 则 Rd1#；Rc2 则 Qb1+ 再吃车；Qe1 则 Qxc3 Qxc3 Rd1+ 底线杀。一步安静的后走，用底线弱点顶住了整条 c 线。" },
      ],
    },
  ];
