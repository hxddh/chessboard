/**
 * Zero-basis interactive chess curriculum — hand-authored, fully offline.
 * scripts/test-chess.mjs replays every task's `solution` against chess.js to
 * verify FENs load, moves are legal/canonical, goals are met, and star paths
 * never check the decorative kings.
 *
 * Task types (runtime in app.js):
 *   tap    — click squares by coordinate/piece (steps: [{tip, squares}])
 *   stars  — move the lesson piece to clear every star square; opponent
 *            never replies (the runtime hands the turn back)
 *   move   — make one move satisfying `goal`:
 *            check | any | mate | castle-k | castle-q | ep | promote
 *   drill  — play out a basic mate against the engine (black defends at the
 *            weakest tier unless the task sets `engine`)
 *
 * A lesson may also carry `practice`: the motif whose puzzles continue it.
 * 「吃子与价值」 teaches eight tactical motifs and gives each exactly one
 * exercise, while the puzzle set's `tac` category holds 21 more of the very
 * same motifs that the course never mentions — a beginner who has just met
 * the fork has nowhere to go but the next lesson. 缺陷 24. The value is the
 * puzzle's own `motif` string, matched at runtime rather than listed here as
 * ids: scripts/test-chess.mjs checks both directions, so a motif renamed on
 * one side and not the other fails the build instead of quietly unlinking.
 * @module lessons
 */
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  export const CHESS_LESSONS = [
    // —— 第一部分 · 认识棋盘 ——
    {
      id: "board", part: "认识棋盘", title: "棋盘与坐标",
      text: [
        "国际象棋在 8×8 共 64 格的棋盘上进行,浅色格与深色格相间。",
        "从白方视角看:横排叫「横线」,由近到远编号 1–8;竖排叫「直线」,从左到右编号 a–h。每个格子由字母+数字定位,如 e4。",
        "摆放棋盘时右下角必须是浅色格(h1)。",
      ],
      tasks: [
        { type: "tap", fen: START, prompt: "在棋盘上找到指定坐标", steps: [
          { tip: "点击 e4 格(e 线与第 4 横线交汇处)", squares: ["e4"] },
          { tip: "点击 a1 格(白方左下角)", squares: ["a1"] },
          { tip: "点击 h8 格(黑方那侧的角落)", squares: ["h8"] },
        ] },
      ],
    },
    {
      id: "squares", part: "认识棋盘", title: "浅格与深格",
      text: [
        "64 格里 32 格浅、32 格深,横竖都是交替的 —— 所以**同一条斜线上的格子永远同色**。",
        "这一条不是装饰,它决定了一个子的一辈子:**象只能斜着走,所以它从开局到终局只会踩一种颜色**。白方两个象一个走浅格、一个走深格,合起来才盖得住全盘。",
        "也是因为这条,「后站在与自己同色的格子上」才好记:白后 d1 是浅格,黑后 d8 是深格。",
      ],
      tasks: [
        { type: "tap", fen: START, prompt: "看清楚哪格深、哪格浅", steps: [
          { tip: "点击 a1 —— 白方左下角,是**深**格", squares: ["a1"] },
          { tip: "点击 h1 —— 白方右下角,是**浅**格(摆盘时右下角必须是浅格)", squares: ["h1"] },
          { tip: "点击白方两个象中站深格的那个(c1)", squares: ["c1"] },
          { tip: "再点站浅格的那个(f1)", squares: ["f1"] },
        ] },
      ],
    },
    {
      id: "setup", part: "认识棋盘", title: "开局怎么摆",
      text: [
        "每方 16 个棋子:8 兵、2 车、2 马、2 象、1 后、1 王。",
        "底线从角向内依次是车、马、象;后站在与自己同色的格子上(白后 d1 浅格、黑后 d8 深格),王在 e 线;兵排在第二排。",
        "记不住顺序时就记两句:**车在角上,马在车旁,象挨着马**,剩下中间两格给后和王 —— 后先挑自己的颜色,王拿剩下那格。",
      ],
      tasks: [
        { type: "tap", fen: START, prompt: "认一认各个棋子", steps: [
          { tip: "点击白方的后(d1,「白后站浅格」)", squares: ["d1"] },
          { tip: "点击黑方的王(e 线上)", squares: ["e8"] },
          { tip: "点击白方任意一个马(紧挨角上的车)", squares: ["b1", "g1"] },
          { tip: "点击黑方任意一个象(挨着后和王)", squares: ["c8", "f8"] },
        ] },
      ],
    },
    {
      id: "pieces", part: "认识棋盘", title: "六种棋子,各值多少",
      text: [
        "六种棋子,力量差得很远。棋手用一套约定俗成的**身价**来估算,单位是「兵」:",
        "**兵 1 分 · 马 3 分 · 象 3 分 · 车 5 分 · 后 9 分**。王不标价 —— 它丢了棋就结束了,没得换。",
        "这套数字不是规则,是**换子时的算盘**:拿马(3)换车(5)是赚,拿车(5)换马(3)是亏。后面「吃子与价值」整整一部分都建在这五个数字上,现在先把它们记住。",
      ],
      tasks: [
        { type: "tap", fen: START, prompt: "按身价从高到低点一遍白方的子", steps: [
          { tip: "先点最值钱的:白后(9 分)", squares: ["d1"] },
          { tip: "再点白方任意一个车(5 分)", squares: ["a1", "h1"] },
          { tip: "再点任意一个马或象(都是 3 分)", squares: ["b1", "g1", "c1", "f1"] },
          { tip: "最后点任意一个兵(1 分)", squares: ["a2", "b2", "c2", "d2", "e2", "f2", "g2", "h2"] },
        ] },
      ],
    },
    {
      id: "turns", part: "认识棋盘", title: "轮流走:白方先行",
      text: [
        "两人轮流,**一次只走一个子,一步也不能不走**(轮到你就必须走,这一条到残局会变得很要命)。",
        "**白方先行。** 白走一步、黑走一步,合起来算一个回合,记作「1. e4 e5」—— 前面的数字就是回合数。",
        "棋盘上方那行标着现在轮到谁。轮到对方时你点不动自己的子,这不是卡住了,是规则。",
      ],
      tasks: [
        { type: "move", fen: START, goal: "any", prompt: "轮到白方 —— 随便走一步,把先手用掉",
          retry: "点一个白子,再点它能去的格子", solution: ["e4"] },
      ],
    },
    {
      id: "howtomove", part: "认识棋盘", title: "在这里怎么走一步棋",
      text: [
        "两种走法随你用:**点一下要走的子,再点目标格**;或者直接把子**拖**过去。",
        "选中之后棋盘会把这个子能去的格子标出来 —— 点错了子就点一下别处取消,不算走棋。",
        "真走错了也能反悔:**⌘Z / Ctrl+Z 悔棋**。课程里走错会自动退回来并给一句提示,所以放心试。",
      ],
      tasks: [
        { type: "move", fen: START, goal: "one-of", accept: ["e4", "d4", "Nf3", "Nc3"],
          prompt: "试一下:选中一个中心兵或一个马,把它走出去(e4 / d4 / Nf3 / Nc3 都算)",
          retry: "先点中那个子,它能去的格子会亮起来;再点其中一格",
          solution: ["e4"] },
      ],
    },
    {
      id: "goal", part: "认识棋盘", title: "赢是「将死」,不是把子吃光",
      text: [
        "**吃光对方的子不是目标,也从来不会发生。** 目标只有一个:把对方的**王将死** —— 王正被攻击(将军),而且**逃、挡、吃**三条路全没有。",
        "王永远不会真的被吃掉:棋一到将死就结束了。所以王没有身价,也不能被拿去交换。",
        "还有一种结局是**和棋**:轮到走却没有合法着且没被将军(逼和)、子力不足以将死、双方同意,等等。和棋各得半分 —— 输棋的一方常常是靠它救回来的。",
      ],
      tasks: [
        { type: "move", fen: "7k/Q7/6K1/8/8/8/8/8 w - - 0 1", goal: "mate",
          prompt: "白后加白王,一步将死 —— 把后走到 g7",
          retry: "Qg7:后紧贴黑王,身后有白王撑着,黑王吃不掉也躲不开",
          solution: ["Qg7#"] },
      ],
    },
    // —— 第二部分 · 棋子走法 ——
    {
      id: "pawn", part: "棋子走法", title: "兵:直走斜吃",
      text: [
        "兵每次向前直走一格,永远不能后退。",
        "首次移动时可以选择直进两格。",
        "吃子方式特殊:斜前一格吃子,不能直着吃。",
      ],
      tasks: [
        { type: "stars", fen: "7k/8/8/8/8/3p4/4P3/K7 w - - 0 1", only: "p",
          prompt: "用 e2 兵:先斜吃 d3 黑兵,再一路直进到 d5(逐格吃星)",
          stars: ["d3", "d4", "d5"], solution: ["e2d3", "d3d4", "d4d5"] },
        { type: "stars", fen: "7k/8/8/8/8/8/P7/K7 w - - 0 1", only: "p",
          prompt: "兵还没动过 —— 用首步特权,直接两格跳到 a4",
          stars: ["a4"], solution: ["a2a4"] },
        { type: "stars", fen: "7k/8/8/3pp3/4P3/8/8/K7 w - - 0 1", only: "p",
          prompt: "e4 兵被 e5 黑兵顶住 —— 直进不了(点兵看看,e5 不会亮),只能斜吃 d5",
          stars: ["d5"], solution: ["e4d5"] },
      ],
    },
    {
      id: "rook", part: "棋子走法", title: "车:横冲直撞",
      text: [
        "车沿横线或直线走任意格数,不能越子。",
        "车是重子,残局威力巨大;它还参与「王车易位」(后面会学)。",
      ],
      tasks: [
        { type: "stars", fen: "7k/8/8/8/8/8/2R5/K7 w - - 0 1", only: "r",
          prompt: "用车沿直线吃掉全部 3 颗星",
          stars: ["c7", "g7", "g2"], solution: ["c2c7", "c7g7", "g7g2"] },
        { type: "stars", fen: "k7/8/8/8/2P5/8/8/K1R5 w - - 0 1", only: "r",
          prompt: "自己的 c4 兵挡住了直路 —— 车不能越子,绕行:h1 → h7 → c7",
          stars: ["h1", "h7", "c7"], solution: ["c1h1", "h1h7", "h7c7"] },
        { type: "stars", fen: "k7/8/8/8/8/3p3p/8/K2R4 w - - 0 1", only: "r",
          prompt: "车吃子和走路一样顺:先吃 d3 兵,再横扫 h3 兵,最后占领 h6",
          stars: ["d3", "h3", "h6"], solution: ["d1d3", "d3h3", "h3h6"] },
      ],
    },
    {
      id: "bishop", part: "棋子走法", title: "象:斜线飞行",
      text: [
        "象沿斜线走任意格数,不能越子。",
        "每个象一辈子只能走一种颜色的格子 —— 开局时你有一个浅格象和一个深格象。",
      ],
      tasks: [
        { type: "stars", fen: "k7/8/8/8/8/8/8/2B4K w - - 0 1", only: "b",
          prompt: "用象沿斜线吃掉 2 颗星",
          stars: ["g5", "d8"], solution: ["c1g5", "g5d8"] },
        { type: "stars", fen: "k7/8/8/8/8/8/8/B6K w - - 0 1", only: "b",
          prompt: "a1–h8 大斜线是象的高速路:先停 d4,冲到 h8,再折返 c3",
          stars: ["d4", "h8", "c3"], solution: ["a1d4", "d4h8", "h8c3"] },
        { type: "stars", fen: "k7/2p5/8/8/8/1p4p1/8/K3B3 w - - 0 1", only: "b",
          prompt: "深格象吃深格子:先吃 g3 兵,再远程吃 c7 兵 —— b3 那个兵在浅格,这辈子都轮不到你吃",
          stars: ["g3", "c7"], solution: ["e1g3", "g3c7"] },
      ],
    },
    {
      id: "knight", part: "棋子走法", title: "马:日字跳跃",
      text: [
        "马走「日」字:直两格再拐一格(共 8 个方向)。",
        "马是唯一可以越过其他棋子的棋子,没有「蹩马腿」。",
      ],
      tasks: [
        { type: "stars", fen: "7k/8/8/8/8/8/8/1N4K1 w - - 0 1", only: "n",
          prompt: "用马连跳 3 颗星",
          stars: ["c3", "d5", "f6"], solution: ["b1c3", "c3d5", "d5f6"] },
        { type: "stars", fen: "k7/8/8/8/8/2PPP3/2PNP3/K1PPP3 w - - 0 1", only: "n",
          prompt: "马被自家兵团团围住?没关系,它会跳!从包围圈里连踩 3 颗星",
          stars: ["f3", "e5", "c4"], solution: ["d2f3", "f3e5", "e5c4"] },
        { type: "stars", fen: "k7/8/8/8/8/8/8/K5N1 w - - 0 1", only: "n",
          prompt: "马的路线要提前规划:两跳踩到 e5 的星(先想好中转格再动手)",
          stars: ["e5"], solution: ["g1f3", "f3e5"] },
      ],
    },
    {
      id: "queen", part: "棋子走法", title: "后:全能重炮",
      text: [
        "后 = 车 + 象:横、竖、斜任意方向走任意格数,不能越子。",
        "后是最强的棋子,但也因此最怕被白白换掉 —— 别过早出后。",
      ],
      tasks: [
        { type: "stars", fen: "7k/8/8/8/8/8/8/K2Q4 w - - 0 1", only: "q",
          prompt: "用后横、竖、斜三种走法各吃一颗星",
          stars: ["d5", "g5", "g2"], solution: ["d1d5", "d5g5", "g5g2"] },
        { type: "stars", fen: "7k/1p6/8/8/8/8/8/K3Q3 w - - 0 1", only: "q",
          prompt: "后的组合拳:斜线到 b4,直线吃掉 b7 兵,再斜线插到 g2",
          stars: ["b4", "b7", "g2"], solution: ["e1b4", "b4b7", "b7g2"] },
        { type: "stars", fen: "7k/8/2p1p3/8/2p1p3/8/8/K3Q3 w - - 0 1", only: "q",
          prompt: "收割练习:四颗星全在黑兵身上,按 e4 → c6 → c4 → e6 的顺序吃光",
          stars: ["e4", "c6", "c4", "e6"], solution: ["e1e4", "e4c6", "c6c4", "c4e6"] },
      ],
    },
    {
      id: "king", part: "棋子走法", title: "王:一步一格",
      text: [
        "王朝任意方向走一格。",
        "王不能走进被对方攻击的格子(不能「送将」)—— 保护好它,它被将死对局就结束了。",
      ],
      tasks: [
        { type: "stars", fen: "k7/8/8/8/8/8/4K3/8 w - - 0 1", only: "k",
          prompt: "用王一步一步踩过 3 颗星",
          stars: ["e3", "d4", "c5"], solution: ["e2e3", "e3d4", "d4c5"] },
      ],
    },
    {
      id: "kingsafe", part: "棋子走法", title: "王的禁区:不能送吃",
      text: [
        "王永远不能走进被对方攻击的格子 —— 点王的时候,那些格子根本不会亮起来。",
        "试试看:黑车封住了整条横线和直线,王只能从被自己兵挡住车火力的一侧绕过去。",
      ],
      tasks: [
        { type: "stars", fen: "7k/8/8/8/r3P3/8/4K3/8 w - - 0 1", only: "k",
          prompt: "把王走到 e6 的星星上 —— 注意黑车封锁的格子进不去,从右边绕",
          stars: ["e6"], solution: ["e2f3", "f3f4", "f4f5", "f5e6"] },
      ],
    },
    // —— 第三部分 · 吃子与价值 ——
    {
      id: "values", part: "吃子与价值", title: "子力价值:别做亏本交换",
      text: [
        "常用价值:兵 1 分 · 马/象 3 分(轻子)· 车 5 分 · 后 9 分;王无价 —— 丢了就输。",
        "交换前先算账:用 3 分的马吃掉 5 分的车是赚的,用后换车就是大亏。",
      ],
      tasks: [
        { type: "tap", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          prompt: "按价值认一认棋子", steps: [
          { tip: "后最强,约 9 分 —— 点击白后(d1)", squares: ["d1"] },
          { tip: "车约 5 分,第二强 —— 点击黑方任意一个车(角上)", squares: ["a8", "h8"] },
          { tip: "马和象都约 3 分,称「轻子」—— 点击白方任意一个象", squares: ["c1", "f1"] },
          { tip: "兵只值 1 分,但升变潜力无限 —— 点击 e2 兵", squares: ["e2"] },
        ] },
      ],
    },
    {
      id: "protect", part: "吃子与价值", title: "吃子前先看保护",
      text: [
        "能吃 ≠ 该吃:吃掉一个有保护的子,对方会立刻吃回来。",
        "规则:吃子之前,数一数这个子有几个保护者 —— 用高价值的子去吃受保护的低价值子,几乎总是亏的。",
      ],
      tasks: [
        { type: "move", fen: "kr6/1p6/8/3Q3p/8/8/8/7K w - - 0 1", goal: "capture", target: "h5",
          prompt: "白后能吃到两个兵:b7 兵有车保护,h5 兵没有 —— 吃掉安全的那个",
          retry: "b7 兵有 b8 车保护!吃它会用 9 分的后换 1 分的兵,大亏 —— 吃没有保护的兵",
          solution: ["Qxh5"] },
      ],
    },
    {
      id: "defend", part: "吃子与价值", title: "救受攻的子",
      text: [
        "对方走完棋,先问自己:他在威胁什么?我的子是不是正被攻击?",
        "被攻击的高价值子要马上处理:走开、有保护地防守、或者干脆吃掉攻击者。",
      ],
      tasks: [
        { type: "move", fen: "k7/8/8/3Q3r/8/8/8/K7 w - - 0 1", goal: "safe", only: "q",
          prompt: "黑车正沿第 5 横线攻击你的后!把后移到安全的格子(或者干脆吃掉黑车)",
          retry: "那格还在黑方火力之下,后会被白吃 —— 再想想", solution: ["Qd1"] },
      ],
    },
    {
      id: "fork", part: "吃子与价值", title: "捉双:一子攻两个", practice: "捉双",
      text: [
        "一个子同时攻击对方两个目标,叫「捉双」—— 对方只救得了一个。",
        "带将军的捉双最凶:对方必须先应将,另一个目标就归你了。马是捉双大师(它的攻击别人挡不住)。",
      ],
      tasks: [
        { type: "move", fen: "k3r3/pp6/8/1N6/8/8/8/6K1 w - - 0 1", goal: "one-of",
          accept: ["Nc7+"],
          prompt: "用马跳到同时攻击黑王和 e8 车的格子(还是将军!)",
          retry: "找一个能同时攻到 a8 王和 e8 车的马位", solution: ["Nc7+"] },
        { type: "move", fen: "1k2r3/ppN5/8/8/8/8/8/6K1 w - - 0 1", goal: "capture", target: "e8",
          prompt: "黑王应将走开了 —— 收获时间:吃掉 e8 的车",
          retry: "吃 e8 的车,这就是捉双的战利品", solution: ["Nxe8"] },
      ],
    },
    {
      id: "skewer", part: "吃子与价值", title: "串击:逼开前面吃后面", practice: "串击",
      text: [
        "串击是牵制的反面:攻击一条线上**前面**的高价值子,逼它让开,再吃它**身后**的子。",
        "最狠的是「王在前」的串击 —— 将军!王必须让位,身后的子就归你了。",
      ],
      tasks: [
        { type: "move", fen: "7q/8/8/7k/8/8/4K3/R7 w - - 0 1", goal: "one-of",
          accept: ["Rh1+"],
          prompt: "把车移到 h 线将军 —— 黑王和它身后的后串在一条线上",
          retry: "让车到 h1,沿 h 线把王和后串起来", solution: ["Rh1+"] },
        { type: "move", fen: "7q/6k1/8/8/8/8/8/7R w - - 0 1", goal: "capture", target: "h8",
          prompt: "黑王被迫让开了 —— 沿 h 线吃掉身后的后",
          retry: "沿 h 线吃 h8 的后,这就是串击的收获", solution: ["Rxh8"] },
      ],
    },
    {
      id: "discovery", part: "吃子与价值", title: "闪击:挪一子,露一击", practice: "闪将",
      text: [
        "一个子挪开,让它**身后**同线的子发起攻击,叫「闪击」。挪开的子还能顺手吃子或占位 —— 一步两用。",
        "最强的是「闪将」:挪子露出的是**将军**。对方只能应将,挪开的子抢到的东西保不住了。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/5q2/8/4N3/8/8/4R1K1 w - - 0 1", goal: "capture", target: "f6",
          prompt: "e4 的马身后是 e1 车、正对着黑王 —— 用马吃掉 f6 的后,同时露出车的闪将",
          retry: "让马去吃 f6 的后(它一挪开,e 线车就将军了)", solution: ["Nxf6+"] },
      ],
    },
    {
      id: "trade", part: "吃子与价值", title: "换子:什么时候划算",
      text: [
        "「兑子」就是我吃你一个、你吃回我一个。划不划算,直接拿身价相减:**用 3 分的马换 5 分的车,净赚 2 分**;反过来就是亏 2 分。",
        "只有一种情况例外要小心:**能吃不等于该吃**。吃之前先看一眼 —— 我吃完,对方能不能吃回来?能吃回来,就得把两边的分都算进去。",
        "还有一条经验:**领先的时候多换子,落后的时候少换子**。你多一个车,盘上子越少,这个车越说了算。",
      ],
      tasks: [
        { type: "move", fen: "6k1/5ppp/8/8/1r6/3N4/5PPP/6K1 w - - 0 1", goal: "capture", target: "b4",
          prompt: "d3 的马(3 分)能吃 b4 的车(5 分),而且吃完没有子能吃回来 —— 吃",
          retry: "Nxb4:马跳到 b4 吃掉车,净赚 2 分;先数一遍谁能吃回 b4,答案是没有",
          solution: ["Nxb4"] },
      ],
    },
    // —— 第四部分 · 规则与胜负 ——
    {
      id: "deflect", part: "吃子与价值", title: "引离:把守家的子调走", practice: "引离",
      text: [
        "一个子之所以安全,常常是因为**有别的子在守它**。想吃它,不一定要正面强攻 —— 先想办法把守它的那个子**调走**。",
        "最干脆的调法是将军:对方必须应将,守家的子被迫离开岗位,你要吃的东西就没人管了。",
      ],
      tasks: [
        { type: "move", fen: "3r2k1/5ppp/8/3n4/8/8/5PBP/4R1K1 w - - 0 1", goal: "one-of",
          accept: ["Re8+"],
          prompt: "d5 的黑马由 d8 的车守着。走 e8 车将军 —— 黑车只能吃掉它,d 线一松,马就没人管了",
          retry: "先想想:是谁在守 d5 的马?怎样逼它离开 d 线", solution: ["Re8+"] },
      ],
    },
    {
      id: "remove", part: "吃子与价值", title: "消除防守者:直接把守家的子吃掉", practice: "消除防守者",
      text: [
        "调走守家的子有两种办法:逼它走开(引离),或者**干脆吃掉它**。",
        "换子的时候多问一句:我吃掉的这个子,正在守着什么?它一消失,那样东西就归你了。",
      ],
      tasks: [
        { type: "move", fen: "1r2k3/3n1ppp/8/8/6B1/8/5PPP/1R4K1 w - - 0 1", goal: "one-of",
          accept: ["Bxd7+"],
          prompt: "b8 的黑车由 d7 的马守着。用象吃掉这匹马(还带将军)—— 车就孤零零地站在那儿了",
          retry: "别急着吃车 —— 先看谁在守它", solution: ["Bxd7+"] },
      ],
    },
    {
      id: "overload", part: "吃子与价值", title: "过载:一个子干不了两份活", practice: "过载",
      text: [
        "一个子同时守两样东西,叫「过载」。它看上去两边都顾得上,其实**只要逼它顾一边,另一边就塌了**。",
        "看到对方某个子身兼两职,就去攻它守着的其中一样 —— 它救得了这个,救不了那个。",
      ],
      tasks: [
        { type: "move", fen: "2r3k1/5ppp/8/2n5/8/B7/5PPP/4R1K1 w - - 0 1", goal: "one-of",
          accept: ["Re8+"],
          prompt: "c8 的黑车既守底线又守 c5 的马 —— 两份活。走 e8 车将军,逼它去管底线",
          retry: "找那个身兼两职的子,再逼它二选一", solution: ["Re8+"] },
      ],
    },
    {
      id: "decoy", part: "吃子与价值", title: "引入:把子骗到你想要它待的格",
      text: [
        "引离是把子**赶走**,引入正相反 —— 把子**骗过来**,骗到一个它站上去就要倒霉的格子。",
        "常见的做法是弃子将军:对方不得不吃,而吃完之后,他的王正好站进了你的马叉里。",
      ],
      tasks: [
        { type: "move", fen: "3q2k1/5pp1/8/6N1/8/8/8/6KR w - - 0 1", goal: "one-of",
          accept: ["Rh8+"],
          prompt: "把车送到 h8 将军 —— 黑王只能吃。吃完之后王站到 h8,马从 f7 正好同时叉住王和后",
          retry: "先想好:王被骗到哪一格,你的马就能叉到它和后?", solution: ["Rh8+"] },
      ],
    },
    {
      id: "interfere", part: "吃子与价值", title: "拦截:把守家的那条线切断",
      text: [
        "守家的子靠一条线看住目标 —— 横线、竖线或斜线。**在这条线中间插一个子**,视线一断,目标就失守了。",
        "插进去的子往往会被吃,所以要么它有人保护,要么吃它的代价比丢掉目标更大。",
      ],
      tasks: [
        { type: "move", fen: "1r4k1/5ppp/8/RbP5/2N5/8/8/6K1 w - - 0 1", goal: "one-of",
          accept: ["Nb6"],
          prompt: "b8 的黑车沿 b 线守着 b5 的象。把马跳到 b6 切断这条线 —— 马有 c5 兵保护,吃它是亏的",
          retry: "黑车是沿哪条线守着象的?在中间放一个有人保护的子", solution: ["Nb6"] },
      ],
    },
    {
      id: "check", part: "规则与胜负", title: "将军与应将",
      text: [
        "攻击对方的王叫「将军」。被将军的一方必须立刻解除,方法只有三种:走开王、用子阻挡、吃掉攻击子。",
        "不存在「不理会将军」—— 界面只会让你选合法的应将走法。",
      ],
      tasks: [
        { type: "move", fen: "7k/8/8/8/3Q4/8/8/K7 w - - 0 1", goal: "check",
          prompt: "用白后走一步,将军黑王(不止一种走法)",
          retry: "这步没有攻击到黑王,再试试", solution: ["Qd8+"] },
        { type: "move", fen: "4r2k/8/8/8/8/8/8/2B1K3 w - - 0 1", goal: "any",
          prompt: "白王正被黑车将军!应法一/二:走开王,或用象挡在中间",
          solution: ["Be3"] },
        { type: "move", fen: "R3r2k/8/8/8/8/8/8/4K3 w - - 0 1", goal: "capture", target: "e8",
          prompt: "又被黑车将军!这次用应法三 —— 用你 a8 的车吃掉攻击子",
          retry: "吃掉 e8 的黑车才能一劳永逸解除将军", solution: ["Rxe8+"] },
      ],
    },
    {
      id: "pin", part: "规则与胜负", title: "牵制:动不了的子", practice: "牵制",
      text: [
        "如果一个子走开会让自己的王暴露在将军之下,规则禁止它移动 —— 这个子被「牵制」了。",
        "被完全牵制的子点击后不会亮出任何落点 —— 不是出了故障,是规则不允许。破解:走开王离开牵制线、挡住牵制线,或吃掉牵制子。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/4r3/8/4N3/4K3 w - - 0 1", goal: "one-of",
          accept: ["Kd1", "Kf1", "Kd2", "Kf2"],
          prompt: "先点 e2 的马试试 —— 它被 e4 黑车牵制,一格都动不了!改走王离开 e 线,解除牵制",
          retry: "马还被牵着呢 —— 把王走离 e 线", solution: ["Kd2"] },
      ],
    },
    {
      id: "mate", part: "规则与胜负", title: "将死:终结对局",
      text: [
        "被将军且无任何合法应对 = 将死,对局立即结束,将死方获胜。",
        "最常见的杀型之一是「底线杀」:王被自己的兵挡住退路,重子在底线将军。",
        "想多练杀型?去「模式 → 做题」,一步杀/两步杀题库等着你。",
      ],
      tasks: [
        { type: "move", fen: "6k1/5ppp/8/8/8/8/8/4R1K1 w - - 0 1", goal: "mate",
          prompt: "一步将死:黑王被自己的兵困在底线",
          retry: "还不是将死,再想想底线", solution: ["Re8#"] },
        { type: "move", fen: "7k/8/5K2/8/8/8/8/6Q1 w - - 0 1", goal: "mate",
          prompt: "一步将死:白王已经贴近,用后完成致命一击",
          retry: "还不是将死 —— 后要既将军又有王保护", solution: ["Qg7#"] },
      ],
    },
    {
      id: "stalemate", part: "规则与胜负", title: "逼和:大优也会和棋",
      text: [
        "轮到一方走棋、没被将军、却一步合法棋都没有 = 逼和,判和棋!",
        "大占优势时最容易随手逼和,葬送胜局 —— 永远给对方王留一条「合法的活路」直到将死它。",
      ],
      tasks: [
        { type: "move", fen: "k7/3Q4/1K6/8/8/8/8/8 w - - 0 1", goal: "mate", failOnStalemate: true,
          prompt: "一步将死黑王 —— 小心!有一步看似厉害的棋会造成逼和",
          retry: "还不是将死,再试试", solution: ["Qb7#"], trap: "Qc7" },
      ],
    },
    {
      id: "castle", part: "规则与胜负", title: "王车易位:一步走两子",
      text: [
        "王向车的方向横走两格,车跳到王的另一侧 —— 一步同时保王、出车。",
        "条件:王和该车都没动过;两者之间无子;王不在将军中、不经过也不落在被攻击的格子。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/8/8/8/4K2R w K - 0 1", goal: "castle-k",
          prompt: "短易位:点击白王,再点 g1", retry: "这不是易位 —— 王要横走两格到 g1", solution: ["O-O"] },
        { type: "move", fen: "4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", goal: "castle-q",
          prompt: "长易位:点击白王,再点 c1", retry: "这不是易位 —— 王要横走两格到 c1", solution: ["O-O-O"] },
      ],
    },
    {
      id: "enpassant", part: "规则与胜负", title: "吃过路兵",
      text: [
        "对方的兵刚用首步特权两格越过你兵的攻击格时,你可以在下一步立即像它只走了一格那样斜吃它 —— 这就是「吃过路兵」。",
        "机会只有一回合,不马上吃就永久失效。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 3", goal: "ep",
          prompt: "黑兵刚从 d7 两格到 d5 —— 用 e5 兵吃过路兵(落点 d6)",
          retry: "要斜吃到 d6 才是吃过路兵", solution: ["exd6"] },
      ],
    },
    {
      id: "promotion", part: "规则与胜负", title: "升变:小兵变后",
      text: [
        "兵走到对方底线必须立刻升变为后、车、象或马(不能保持是兵,也不能变王)。",
        "绝大多数时候升后;偶尔升马可以立刻将军,或升车/象避免逼和。",
      ],
      tasks: [
        { type: "move", fen: "4k3/P7/8/8/8/8/8/4K3 w - - 0 1", goal: "promote",
          prompt: "把 a7 兵推到底线,在弹窗里选择升变(顺便会将军!)",
          solution: ["a8=Q+"] },
      ],
    },
    {
      id: "draws", part: "规则与胜负", title: "和棋的各种方式",
      text: [
        "除了逼和,还有这些情况和棋:双方都无子力将杀(如王对王,自动判和)、同一局面重复三次或连续 50 回合无吃子无动兵(这两种要由棋手**主动声明**,本应用的「判和」按钮亮起时点它即可;拖到五次重复或 75 回合会自动判和)、双方协议和棋。",
        "顺带一提:劣势太大时可以「认输」体面结束 —— 棋谱区有认输按钮。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/r7/1K6/8/8/8 w - - 0 1", goal: "draw-insufficient",
          prompt: "吃掉黑方最后一个车 —— 只剩王对王,子力不足自动判和",
          retry: "先吃掉那个车试试", solution: ["Kxa5"] },
      ],
    },
    {
      id: "notation", part: "规则与胜负", title: "看懂棋谱:代数记谱法",
      text: [
        "字母代表棋子:K 王 · Q 后 · R 车 · B 象 · N 马;兵不写字母,只写落点格。",
        "常用符号:x 吃子 · + 将军 · # 将死 · O-O 短易位 · O-O-O 长易位 · =Q 升变为后。学会这些,右侧的着法表和复盘就都能看懂了。",
      ],
      tasks: [
        { type: "tap", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          prompt: "读着法,点落点", steps: [
          { tip: "「e4」= 兵走到 e4(兵只写落点)—— 点击 e4", squares: ["e4"] },
          { tip: "「Nf3」= 马跳到 f3(N 是马)—— 点击 f3", squares: ["f3"] },
          { tip: "「Qxd5」= 后吃到 d5(x 表示吃子)—— 点击 d5", squares: ["d5"] },
          { tip: "「O-O」= 短易位,白王会落在… —— 点击 g1", squares: ["g1"] },
        ] },
      ],
    },
    // —— 第五部分 · 杀型积木 ——
    {
      id: "ladder", part: "杀型积木", title: "双车阶梯杀",
      text: [
        "两个重子(车/后)轮流「封线 + 将军」,像爬梯子一样把对方王一排一排推到边线将死 —— 这是最容易掌握的必杀技术。",
        "口诀:一个封住王的去路,另一个从旁边一线将军;王退一排,就再爬一档。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/8/8/RR6/6K1 w - - 0 1", goal: "one-of",
          accept: ["Ra7", "Rb7"],
          prompt: "第一档:用任意一个车占住第 7 横线,把黑王关在底线",
          retry: "先别急着将军 —— 用车封住第 7 横线(a7 或 b7)", solution: ["Rb7"] },
        { type: "move", fen: "3k4/1R6/8/8/8/8/R7/6K1 w - - 0 1", goal: "mate",
          prompt: "第二档:b7 车看住第 7 线,另一个车沿 a 线冲到底线将死!",
          retry: "让 a2 车直冲 a8 —— 第 8 横线将军,第 7 横线已被封死", solution: ["Ra8#"] },
      ],
    },
    {
      id: "smother", part: "杀型积木", title: "闷杀:马的绝技",
      text: [
        "王被自己的棋子围得水泄不通时,一次将军就是将死 —— 马是唯一能「隔着子将军」的棋子,所以闷杀几乎是马的专利。",
        "标准画面:王缩在角落,旁边全是自己人,马跳到 f7(或 f2)一锤定音。",
      ],
      tasks: [
        { type: "tap", fen: "6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1",
          prompt: "先看清:黑王为什么无路可逃?", steps: [
          { tip: "点击占住 g8 逃生格的黑车", squares: ["g8"] },
          { tip: "点击堵住王路的 g7 兵", squares: ["g7"] },
          { tip: "点击堵住王路的 h7 兵", squares: ["h7"] },
        ] },
        { type: "move", fen: "6rk/6pp/8/6N1/8/8/8/K7 w - - 0 1", goal: "mate",
          prompt: "黑王被自己人围死了 —— 马跳进去,完成闷杀!",
          retry: "找那个能将军 h8 王、又谁都吃不到的马位(f7)", solution: ["Nf7#"] },
      ],
    },
    {
      id: "qrladder", part: "杀型积木", title: "后车配合:绞杀边线",
      text: [
        "后 + 车打阶梯和双车一样,而且后封线更严密 —— 但也更容易随手逼和,记得永远给王留活路直到将死。",
        "阶梯是「把王赶到边上」这一类的代表。接下来四课换个思路:**王已经在边上或角上了,怎么一步收网**。",
      ],
      tasks: [
        { type: "move", fen: "3k4/8/8/8/8/8/1Q5R/6K1 w - - 0 1", goal: "one-of",
          accept: ["Qb7"],
          prompt: "后先封第 7 横线(站 b7,离黑王一格远 —— 贴太近容易逼和)",
          retry: "让后上 b7:整条第 7 线 + c8 都在火力之下,黑王只能在底线挪", solution: ["Qb7"] },
        { type: "move", fen: "4k3/1Q6/8/8/8/8/7R/6K1 w - - 0 1", goal: "mate",
          prompt: "黑王只能沿底线逃 —— 车从 h 线冲到底线,绞杀完成!",
          retry: "Rh8 将军后,第 7 线全被后看住 —— 就是它", solution: ["Rh8#"] },
      ],
    },
    {
      id: "backrank", part: "杀型积木", title: "底线杀:被自己的兵闷死",
      text: [
        "**实战里最常见的杀型,而且多半发生在双方都没注意的时候。** 王易位到 g1/g8 之后,前面三个兵一个没动 —— 它们挡住了自己王唯一的出口。",
        "这时一个车或后冲到底线将军,王**上不去**(兵挡着)、**躲不开**(左右都在车的火力线上),就是将死。整个过程一个子都不用牺牲。",
        "防它也只要一步:**提前推一个兵**(常见的是 h 兵),给王开一扇「气窗」。老手在没事的时候就会顺手推掉。",
      ],
      tasks: [
        { type: "move", fen: "6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1", goal: "mate",
          prompt: "黑王在 g8,f7/g7/h7 三个兵一个没动 —— 车冲底线",
          retry: "Ra8:底线将军。黑王想上第 7 线,可 f7、g7、h7 全被自己的兵占着",
          solution: ["Ra8#"] },
        { type: "move", fen: "6k1/r4ppp/8/8/8/8/8/4R1K1 w - - 0 1", goal: "mate",
          prompt: "黑车在 a7 —— 它守得住底线吗?算清楚再走",
          retry: "Re8:a7 的车在第 7 线上,够不着底线,也挡不到 e8–g8 之间(只有 f8 能挡,它去不了)",
          solution: ["Re8#"] },
      ],
    },
    {
      id: "qkiss", part: "杀型积木", title: "后贴脸杀:靠上去,但要有人撑",
      text: [
        "后**紧贴**着对方的王将军,叫「贴脸」。后能同时封住王周围一圈格子,所以王往往一格都走不了。",
        "关键在**撑腰**:后贴上去自己也在王的攻击范围里,**必须有另一个子保护这个格子**,否则黑王一口吃掉,你白送一个后。这一课的撑腰角色是 b2 的象 —— 它盯着 a1–h8 整条长斜线。",
        "所以贴脸杀的检查清单只有两条:**后贴得上去吗?那一格有人保护吗?** 两条都是「是」,才是杀;只有第一条,那是送后。",
      ],
      tasks: [
        { type: "move", fen: "7k/8/6Q1/8/8/8/1B6/6K1 w - - 0 1", goal: "mate",
          prompt: "b2 的象看住了 g7 —— 把后贴上去",
          retry: "Qg7:后紧贴黑王,g7 由 b2 的象保护着,黑王吃不掉,h7、g8 又都被后封死",
          solution: ["Qg7#"] },
        { type: "move", fen: "7k/7p/8/8/8/2Q5/1B6/6K1 w - - 0 1", goal: "mate",
          prompt: "这次黑王自己还有个 h7 兵堵着退路 —— 同样一步",
          retry: "Qg7:还是那条长斜线撑着 g7,而 h7 被黑方自己的兵占了",
          solution: ["Qg7#"] },
      ],
    },
    {
      id: "arabian", part: "杀型积木", title: "阿拉伯杀:车和马的老搭档",
      text: [
        "**车 + 马**是配合最好的一对杀棋组合,因为它们的火力形状完全不重叠 —— 马管得住车管不到的斜角。",
        "标准形状:王在角上,**马站在离角两格的位置**(比如王 h8、马 f6),它一个子就同时看住了 **g8** 和 **h7**。车再冲到 h7 将军,车本身由马保护着。",
        "记法很简单:**马先就位盖住两个逃跑口,车最后进来将军。** 顺序反了,车会被白吃。",
      ],
      tasks: [
        { type: "move", fen: "7k/8/5N2/8/8/8/8/6KR w - - 0 1", goal: "mate",
          prompt: "f6 的马已经盖住了 g8 和 h7 —— 车沿 h 线冲上去",
          retry: "Rh7:车将军,而 h7 有 f6 的马保护;黑王去 g8 也是马的火力范围",
          solution: ["Rh7#"] },
        { type: "move", fen: "k7/8/2N5/8/8/8/8/R5K1 w - - 0 1", goal: "mate",
          prompt: "换个角落:黑王 a8,马在 c6 —— 同样的形状,车走哪?",
          retry: "Ra7:c6 的马看住了 a7(保护车)和 b8(堵退路),和上一题是同一个图形",
          solution: ["Ra7#"] },
      ],
    },
    {
      id: "boden", part: "杀型积木", title: "博登杀:两条斜线交叉",
      text: [
        "**两个象**分别走浅格和深格 —— 所以它们的火力永远不重叠,一旦交叉起来就能织出王逃不掉的网。这正是第一部分「浅格与深格」那条的兑现。",
        "典型场景是对方**长易位**之后:王在 c8,自己的车占着 d8、兵占着 d7,退路本来就被自己人堵了一半。一个象从 a6 沿 a6–c8 斜线将军,另一个象从 f4 沿 f4–b8 斜线把 b8、c7 一并盖住。",
        "两条斜线一交叉,王的四个方向全满了 —— 这就是博登杀。它常常是弃一个后换来的,因为一旦成型就是必杀。",
      ],
      tasks: [
        { type: "move", fen: "2kr4/p2p4/8/8/2B2B2/8/8/6K1 w - - 0 1", goal: "mate",
          prompt: "f4 的象已经盖住 b8 和 c7 —— 另一个象走到 a6 那条斜线上",
          retry: "Ba6:沿 a6–b7–c8 将军。b8、c7 归 f4 的象管,d8、d7 被黑方自己的车和兵占着",
          solution: ["Ba6#"] },
        { type: "move", fen: "2kr4/p2p4/8/8/5B2/8/4B3/6K1 w - - 0 1", goal: "mate",
          prompt: "同样的局面,象这次在 e2 —— 走到同一格去",
          retry: "Ba6:e2–d3–c4–b5–a6 一路畅通,到位就是同一张网",
          solution: ["Ba6#"] },
      ],
    },
    // —— 第六部分 · 开局入门 ——
    {
      id: "opening", part: "开局入门", title: "开局三原则",
      text: [
        "原则一:抢占中心 —— d4/e4/d5/e5 四格是全盘要冲,子力越靠近中心控制力越强。",
        "原则二:快出轻子 —— 先出马和象,别反复走同一个子,别过早出动后。",
        "原则三:尽早易位 —— 把王藏进角落,车也顺势出动(就是前面学过的王车易位)。",
      ],
      tasks: [
        { type: "tap", fen: START, prompt: "开局要点", steps: [
          { tip: "点击中心四格中的任意一格(d4 / e4 / d5 / e5)", squares: ["d4", "e4", "d5", "e5"] },
          { tip: "开局优先出动轻子 —— 点击白方任意一个马或象", squares: ["b1", "g1", "c1", "f1"] },
        ] },
        { type: "move", fen: START, goal: "one-of", accept: ["e4", "d4"],
          prompt: "走出最经典的第一步:把 e 兵或 d 兵挺进中心两格",
          retry: "试试 e2–e4 或 d2–d4,一步抢占中心", solution: ["e4"] },
      ],
    },
    // 1.19:开局入门从 2 课补到 8 课。中局 7 课、残局 8 课,而开局 —— 学完
    // 规则之后第一个撞上的阶段 —— 只有「三原则」和「学者杀」两课,下一站
    // 直接是做题里 109 条 ECO 主变。这六课补的就是那一段:每课一条能带走
    // 的规则,能数的地方都给了数(马在 f3 控 8 格、在 h3 只控 4 格)。
    {
      id: "op-firstmove", part: "开局入门", title: "第一步:一步棋同时做三件事",
      text: [
        "开局第一步几乎总是 **e4 或 d4**。不是因为约定俗成,而是因为这一步同时做成三件事:占住中心、给象让出斜线、给后让出斜线。",
        "开局时白方 20 个合法着法里,**f1 象和 d1 后一个都动不了** —— 它们被自己的兵挡得死死的。推一步 e4,象立刻有 5 个格子可去,后有 4 个。一步棋放出两个大子。",
        "推边兵(a4、h4 之类)一件也做不成:不碰中心,不给谁让路,还在自己王的旁边留了个洞。",
      ],
      tasks: [
        { type: "tap", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          prompt: "先看清楚被挡住的是谁 —— 点出来",
          steps: [
            { tip: "白方右边这个象,前面被 e2 兵堵着,一步也走不了 —— 点 f1", squares: ["f1"] },
            { tip: "白后也一样,被 d2 和 e2 挡在家里 —— 点 d1", squares: ["d1"] },
          ] },
        { type: "move", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", goal: "one-of",
          accept: ["e4", "d4"],
          prompt: "走一步,同时占中心 + 给象和后让路",
          retry: "推边兵或者跳马都做不到「一步放出两个大子」。挺 e 兵或 d 兵两格试试。",
          solution: ["e4"] },
        { type: "tap", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1",
          prompt: "e4 走完了 —— 点出刚刚被放出来的那条斜线上,象现在能去的最远一格",
          steps: [
            { tip: "f1 象现在沿 f1–a6 这条斜线出去,最远能到 a6 —— 点 a6", squares: ["a6"] },
          ] },
      ],
    },
    {
      id: "op-knights", part: "开局入门", title: "马往中心跳,别往边上跳",
      text: [
        "「马在边上是废物」是句老话,而且能数出来:**空盘上,马站在 f3 能去 8 个格子,站在 h3 只能去 4 个** —— 整整少一半。",
        "所以开局出马,几乎总是 **Nf3 和 Nc3**(黑方对应 Nf6、Nc6)。这两格既靠中心,又正好盯住中心格。",
        "Na3、Nh3 这种边上的马,不但控制的格子少,还挡不住对方的中心,下一步往往还得再挪一次 —— 等于白走一步。",
      ],
      tasks: [
        { type: "tap", fen: "7k/8/8/8/8/5N2/8/K7 w - - 0 1",
          prompt: "先数中心的马 —— f3 的马一共能去 8 个格子,点出其中三个",
          steps: [
            { tip: "往中心那一边跳 —— 点 e5 或 d4", squares: ["e5", "d4"] },
            { tip: "再点一个 —— g5 或 d2", squares: ["g5", "d2"] },
            { tip: "还有 —— h4、e1、g1、h2 都在它的范围里,点一个", squares: ["h4", "e1", "g1", "h2"] },
          ] },
        { type: "tap", fen: "7k/8/8/8/8/7N/8/K7 w - - 0 1",
          prompt: "换到边上 —— 点出 h3 马能去的格子(只有四个,点其中一个)",
          steps: [
            { tip: "h3 的马只够得到 f4、g5、f2、g1 这四格 —— 比 f3 少了一半", squares: ["f4", "g5", "f2", "g1"] },
          ] },
        { type: "move", fen: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 1", goal: "one-of",
          accept: ["Nf3", "Nc3"],
          prompt: "e4 已经走了 —— 把马跳到该去的地方",
          retry: "Na3 / Nh3 都在边上,控制的格子少一半,下一步还得再挪。往中心跳:Nf3 或 Nc3。",
          solution: ["Nf3"] },
      ],
    },
    {
      id: "op-tempo", part: "开局入门", title: "开局一个子只走一次",
      text: [
        "开局比的是**谁先把子力摆好**。你每走一步,只有把一个新的子带出来,才算真的赚到;把已经出来的子挪来挪去,等于原地踏步。",
        "最常见的赔本买卖是**被追着走**:子出得太早、位置又不安全,对方一边攻你一边出子。你挪一步,他出一个子 —— 挪三次,他就多出三个子。",
        "所以出子之前先想一句:**这一格,它待得住吗?** 待不住的位置,早出去就是白送步数。",
      ],
      tasks: [
        { type: "move", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", goal: "one-of",
          accept: ["Nf3", "Nc3", "Bc4", "Bb5", "d4", "d3", "Be2"],
          prompt: "轮白走 —— 带一个**新的**子出来",
          retry: "再动一次已经走过的 e 兵、或者早早把后放出去,都不叫出子。让一个还没动过的子上场。",
          solution: ["Nf3"] },
        { type: "tap", fen: "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 4 4",
          prompt: "白方三步走完:e4、Nf3、Bb5 —— 点出这三步里**最后一个**上场的子",
          steps: [
            { tip: "b5 的象是第三个出场的。三步棋、三个不同的子,一步没浪费 —— 点 b5", squares: ["b5"] },
          ] },
        { type: "move", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", goal: "one-of",
          accept: ["Nc6", "Nf6", "d6", "Bc5", "Be7", "d5"],
          prompt: "换黑方 —— 同样的道理,带个新子出来(顺手护住 e5 兵更好)",
          retry: "别再推兵或者把刚走过的子挪一遍。让一个新的子上场,比如马跳 c6 顺便看住 e5。",
          solution: ["Nc6"] },
      ],
    },
    {
      id: "op-pawnmoves", part: "开局入门", title: "兵推出去就收不回来",
      text: [
        "所有棋子里只有兵**不能后退**。别的子走错了还能挪回来,兵推出去就是永久的 —— 它身后留下的格子,这盘棋再也守不住了。",
        "所以开局推兵要省着用:通常就是**中心那一两个兵**,用来占中心和给子力让路。多推一个兵,就多一个补不回来的洞。",
        "王前面的兵尤其要小心。易位之后 f、g、h 三个兵是王的屋顶,随手推一个,屋顶就漏了。",
      ],
      tasks: [
        { type: "tap", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1",
          prompt: "先认准开局值得推的是哪两个兵",
          steps: [
            { tip: "占中心、给子力让路的就这两个 —— 点 e2 或 d2", squares: ["e2", "d2"] },
          ] },
        { type: "tap", fen: "rnbq1rk1/ppp1ppbp/3p1np1/8/2PP4/2N2N2/PP2PPPP/R1BQKB1R w KQ - 0 7",
          prompt: "黑方刚易位到王翼 —— 点出替它挡着的那三个兵里,最不该乱动的一个",
          steps: [
            { tip: "g6 已经推过一格来放象了;剩下 f7、g7、h7 是王的屋顶。推 h7 或 f7 都会开口子 —— 点 f7 或 h7", squares: ["f7", "h7"] },
          ] },
        { type: "move", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R b KQkq - 1 2", goal: "one-of",
          accept: ["Nc6", "Nf6", "d6", "Bc5", "Be7"],
          prompt: "轮黑走 —— 别再推兵了,出个子",
          retry: "a6、h6、b6 这类边兵推出去既不占中心也不放子,还留下永久的洞。出子。",
          solution: ["Nc6"] },
      ],
    },
    {
      id: "op-castle", part: "开局入门", title: "别拖易位:中路一开,王最怕待在中间",
      text: [
        "开局阶段中心的兵会互相吃掉,e 线和 d 线迟早会打开。**线一开,还站在 e1/e8 的王就正对着对方的车和后。**",
        "所以易位不是「有空再说」,而是开局三件事里有明确期限的一件:**通常在头 10 步之内完成**。轻子出来两三个,就该易位了。",
        "反过来也一样:看到对方的王迟迟不易位,就该想办法把中路撬开 —— 那是他最脆弱的地方。",
      ],
      tasks: [
        { type: "move", fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQK2R w KQkq - 6 5", goal: "castle-k",
          prompt: "白方三个轻子已经出来了,王翼也空了 —— 该做的事只有一件",
          retry: "再出子当然也行,但王还留在 e1、中路随时会开。先把王送进角落:王翼易位。",
          solution: ["O-O"] },
        { type: "tap", fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 7 5",
          prompt: "白方易位好了,轮黑 —— 点出黑王现在待的那一格,它还在中路",
          steps: [
            { tip: "黑王还在 e8,正对着将来会打开的 e 线 —— 点 e8", squares: ["e8"] },
          ] },
        { type: "move", fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 b kq - 7 5", goal: "castle-k",
          prompt: "轮到黑方了 —— 做同样的事",
          retry: "黑方也是三个轻子出来了、王翼空了。把王送进角落。",
          solution: ["O-O"] },
      ],
    },
    {
      id: "op-italian", part: "开局入门", title: "你的第一个开局:意大利",
      text: [
        "把三原则连起来走,就是一个真正的开局。最适合入门的一个叫**意大利开局**:1.e4 e5 2.Nf3 Nc6 3.Bc4。",
        "三步棋,三件事,一步不浪费:**e4 占中心并放出象和后;Nf3 出子并攻 e5;Bc4 出子并瞄准 f7**(黑王前面唯一只有王护着的软肋)。黑方照样子应对,棋就是均势。",
        "开局不用背。记住它每一步在干什么,遇到对方走别的,你也照三原则应付得了。想背线路的话,做题里的「开局」一档有 109 条主变,按 ECO 排好了。",
      ],
      tasks: [
        { type: "move", fen: "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1", goal: "one-of",
          accept: ["e4"],
          prompt: "意大利第一步",
          retry: "意大利开局从 e4 开始 —— 占中心,同时放出象和后。",
          solution: ["e4"] },
        { type: "move", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2", goal: "one-of",
          accept: ["Nf3"],
          prompt: "黑方也走了 e5 —— 第二步:出一个子,顺手攻它的 e5 兵",
          retry: "Nf3:出子 + 攻 e5,一步两件事。",
          solution: ["Nf3"] },
        { type: "move", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/4P3/5N2/PPPP1PPP/RNBQKB1R w KQkq - 2 3", goal: "one-of",
          accept: ["Bc4"],
          prompt: "黑方 Nc6 护住了 e5 —— 第三步:把象放到瞄准 f7 的那条斜线上",
          retry: "Bc4 —— 象从 f1 出到 c4,正对着 f7,这就是意大利。",
          solution: ["Bc4"] },
        { type: "tap", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/5N2/PPPP1PPP/RNBQK2R b KQkq - 3 3",
          prompt: "意大利摆好了 —— 点出白象正瞄着的那个软肋",
          steps: [
            { tip: "f7 是黑方底线上唯一只有王护着的格子,c4 的象正对着它 —— 点 f7", squares: ["f7"] },
          ] },
      ],
    },
    {
      id: "firstgame", part: "开局入门", title: "第一盘完整棋:学者杀",
      text: [
        "把开局原则串成一盘真棋 —— 顺便认识最著名的开局陷阱「学者杀」:4 步将死不设防的对手。",
        "它靠的是双子夹击 f7(黑方王前只有王保护的软肋)。但记住:对手只要应对正确(如 g6 + Nf6),早出的后反而会被追着打 —— 所以它是用来「认识」的,不是用来依赖的。",
      ],
      tasks: [
        { type: "move", fen: START, goal: "one-of", accept: ["e4"],
          prompt: "第 1 步:王兵挺进两格,抢中心、开出后和象的通道",
          retry: "走 e2–e4", solution: ["e4"] },
        { type: "move", fen: "rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2",
          goal: "one-of", accept: ["Bc4"],
          prompt: "黑方 1…e5 跟进。第 2 步:出象到 c4,斜线直指 f7",
          retry: "把 f1 象拉到 c4,瞄准黑方最弱的 f7 格", solution: ["Bc4"] },
        { type: "move", fen: "r1bqkbnr/pppp1ppp/2n5/4p3/2B1P3/8/PPPP1PPP/RNBQK1NR w KQkq - 2 3",
          goal: "one-of", accept: ["Qh5"],
          prompt: "黑方 2…Nc6 出马。第 3 步:后上 h5 —— 同时叮住 e5 兵和 f7 格",
          retry: "让后走到 h5,和 c4 象形成对 f7 的双重瞄准", solution: ["Qh5"] },
        { type: "move", fen: "r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4",
          goal: "mate",
          prompt: "黑方 3…Nf6?? 没看见威胁!第 4 步:一步终结这盘棋",
          retry: "后吃 f7 —— 有 c4 象保护,王吃不回来", solution: ["Qxf7#"] },
        { type: "tap", fen: START, prompt: "复盘要点:记住双方的软肋", steps: [
          { tip: "点击黑方的软肋 f7 —— 开局阶段只有王一个保护者", squares: ["f7"] },
          { tip: "白方同理 —— 点击 f2,守好你自己的这一格", squares: ["f2"] },
        ] },
      ],
    },
    // —— 第七部分 · 中局思路 ——
    // 到 1.9 为止,课程从「开局三原则」直接跳到残局。学完的人知道怎么捉双、
    // 怎么车杀单王,却没人告诉过他开完局之后该干什么 —— 而那正是初学者在
    // 真棋里卡住最久的一段。这七课不教招法,教「往哪看」:线、格、兵型,
    // 以及兑子和进攻各自的前提。
    {
      id: "mg-plan", part: "中局思路", title: "开完局之后:先问三个问题",
      text: [
        "开局结束的标志是:轻子都出来了,王已经易位,车之间没有别的子挡着。接下来没有现成的口诀,只有三个问题。",
        "一问王安全吗 —— 自己的和对方的。二问我哪个子最差 —— 站得最憋屈的那个,下一步就该轮到它。三问对方在图谋什么 —— 他上一步是冲着哪里去的。",
        "中局不是「想出妙手」,是把最差的子换个地方站。妙手是这么攒出来的。",
      ],
      tasks: [
        { type: "tap", fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 6 5",
          prompt: "白方已经易位。找出还没上场的子",
          steps: [
            { tip: "点击白方还留在底线上没动过的马", squares: ["b1"] },
            { tip: "点击白方还被兵挡在家里的象", squares: ["c1"] },
            { tip: "对方的王还站在中间没易位 —— 点击黑王", squares: ["e8"] },
          ] },
        { type: "move", fen: "r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/5N2/PPPP1PPP/RNBQ1RK1 w kq - 6 5",
          goal: "one-of", accept: ["d3", "d4"],
          prompt: "c1 象是白方最差的子,而挡住它的是 d 兵 —— 把 d 兵推上去给它让路",
          retry: "走 d2–d3 或 d2–d4,象的斜线就通了", solution: ["d3"] },
      ],
    },
    {
      id: "mg-openfile", part: "中局思路", title: "开放线:车的高速公路",
      text: [
        "一条直线上双方都没有兵,就叫「开放线」。车在自己的底线上几乎没用,一站上开放线就能一路打到对方家里。",
        "所以兑掉兵之后的第一件事,往往就是把车调到刚刚空出来的那条线上。两个车叠在同一条开放线上更凶,叫「叠车」。",
        "记一句话:兵开路,车跟进。",
      ],
      tasks: [
        { type: "tap", fen: "r4rk1/pp3ppp/2n1pn2/8/8/2N1PN2/PP3PPP/R4RK1 w - - 0 1",
          prompt: "找出这盘棋的开放线",
          steps: [
            { tip: "c 线和 d 线上双方都没有兵 —— 点击 c 线或 d 线的底格", squares: ["c1", "d1"] },
          ] },
        { type: "move", fen: "r4rk1/pp3ppp/2n1pn2/8/8/2N1PN2/PP3PPP/R4RK1 w - - 0 1",
          goal: "one-of", accept: ["Rac1", "Rfc1", "Rad1", "Rfd1"],
          prompt: "把一个车调到 c 线或 d 线上",
          retry: "两个车都能过去:走 Rc1 或 Rd1(任选一个车)", solution: ["Rac1"] },
      ],
    },
    {
      id: "mg-outpost", part: "中局思路", title: "前哨:马站上赶不走的格",
      text: [
        "如果对方左右两条线上的兵都没了,那个格子就再也没有兵能来赶你 —— 这叫「前哨」。",
        "马最适合占前哨:它跳得慢,一旦站稳就长期起作用,而且是唯一能越过别的子的兵种。象和车在前哨上也很舒服。",
        "看兵型找前哨:哪里缺了兵,哪里就有洞。",
      ],
      tasks: [
        { type: "tap", fen: "r2q1rk1/ppp3pp/4pn2/8/8/2N1PN2/PPP3PP/R2Q1RK1 w - - 0 1",
          prompt: "黑方的 d 兵和 f 兵都不在了 —— 找出那个洞",
          steps: [
            { tip: "点击 e5:它左右两边的 d 兵、f 兵黑方都没有了,谁站上去都赶不走", squares: ["e5"] },
          ] },
        { type: "move", fen: "r2q1rk1/ppp3pp/4pn2/8/8/2N1PN2/PPP3PP/R2Q1RK1 w - - 0 1",
          goal: "one-of", accept: ["Ne5"],
          prompt: "把马跳到 e5 这个前哨上",
          retry: "f3 的马一步就能到 e5", solution: ["Ne5"] },
      ],
    },
    {
      id: "mg-pawns", part: "中局思路", title: "兵型:叠兵、孤兵、洞",
      text: [
        "兵是全盘唯一不能后退的子,所以兵一走,留下的弱点就是永久的。看懂兵型,就等于看懂了这盘棋的长期走向。",
        "叠兵:同一条线上两个自己的兵,前面那个挡住后面那个,两个都走不动,还互相帮不上忙。",
        "孤兵:左右相邻两条线上都没有己方的兵,没有任何兵能保护它,只能靠大子看着 —— 大子被拴住了,就等于少了一个子。",
      ],
      tasks: [
        { type: "tap", fen: "r3k2r/pp3ppp/8/3p4/8/2P5/PPP2PPP/R3K2R w KQkq - 0 1",
          prompt: "认一认这盘棋里的两种弱兵",
          steps: [
            { tip: "白方的 c 线上叠了两个兵 —— 点击其中任意一个", squares: ["c2", "c3"] },
            { tip: "黑方的 d5 兵左右都没有己方的兵 —— 点击这个孤兵", squares: ["d5"] },
            { tip: "孤兵前面那一格永远没有兵能守 —— 点击 d4,那是给马准备的位置", squares: ["d4"] },
          ] },
      ],
    },
    {
      id: "mg-passer", part: "中局思路", title: "通路兵:会自己长大的子",
      text: [
        "一个兵前面那条线上没有敌兵,左右相邻两条线上也没有敌兵挡在它前方 —— 它就是「通路兵」,一路走到底就变成后。",
        "通路兵越往前越值钱,而且它逼得对方必须留人看着,等于对方少一个子在别处打仗。",
        "所以中局兑子的时候要顺手算一笔账:兑完之后谁有通路兵。有通路兵的一方,进入残局往往就赢了。",
      ],
      tasks: [
        { type: "tap", fen: "6k1/5ppp/8/2P5/8/8/5PPP/6K1 w - - 0 1",
          prompt: "找出这盘棋唯一的通路兵",
          steps: [
            { tip: "点击 c5 的白兵:b、c、d 三条线上黑方一个兵也没有,它一路无人可挡", squares: ["c5"] },
          ] },
        { type: "move", fen: "6k1/5ppp/8/2P5/8/8/5PPP/6K1 w - - 0 1",
          goal: "one-of", accept: ["c6"],
          prompt: "把通路兵往前推一格",
          retry: "走 c5–c6", solution: ["c6"] },
      ],
    },
    {
      id: "mg-trade", part: "中局思路", title: "什么时候该兑子",
      text: [
        "兑子不是「打平」,它总是对某一方更有利,关键看你处在哪一边。",
        "多子的时候兑子不兑兵:场上子越少,你多出来的那个子越显眼,最后剩它一个横着走。少子的时候正好相反 —— 留住子力,把局面搅复杂。",
        "还有一种情况:自己的子挤在一起施展不开,就主动兑掉一两个,给剩下的子腾地方。",
      ],
      tasks: [
        { type: "move", fen: "3q1rk1/ppp2ppp/8/8/8/8/PPP2PPP/3QRRK1 w - - 0 1",
          goal: "one-of", accept: ["Qxd8"],
          prompt: "白方多一个车。多子的一方要兑子 —— 沿 d 线兑掉后",
          retry: "d 线是通的,走 Qxd8", solution: ["Qxd8"] },
        { type: "move", fen: "3r2k1/ppp2ppp/8/8/8/8/PPP2PPP/4RRK1 w - - 0 1",
          goal: "one-of", accept: ["Rd1"],
          prompt: "后已经兑掉了,继续兑 —— 把车摆到 d 线上和黑车对脸",
          retry: "e1 的车走到 d1", solution: ["Rd1"] },
      ],
    },
    {
      id: "mg-attack", part: "中局思路", title: "王翼进攻:先集结,再冲锋",
      text: [
        "进攻不是靠一个子发狠,是靠人多。规矩很朴素:你在王那一侧的子,要比对方守在那里的子多。",
        "所以真正的进攻是从「调子」开始的 —— 每一步都往那个方向再加一个子,加到比对方多为止,再动手。手上只有两个子就冲的,基本都被反打。",
        "对方王前的兵一旦动过(比如走了 h6、g6),那里就有了抓手 —— 那正是要数人头的地方。",
      ],
      tasks: [
        { type: "tap", fen: "r1bq1rk1/ppp2ppp/3p1n2/8/8/3B1N2/PPP2PPP/R1BQ1RK1 w - - 0 1",
          prompt: "数一数白方已经有几个子指着黑方的王",
          steps: [
            { tip: "点击 d3 的象:它的斜线一直通到 h7,正对着黑王的门口", squares: ["d3"] },
            { tip: "点击 f3 的马:它随时能跳到 g5,那是王翼进攻的老位置", squares: ["f3"] },
          ] },
        { type: "move", fen: "r1bq1rk1/ppp2ppp/3p1n2/8/8/3B1N2/PPP2PPP/R1BQ1RK1 w - - 0 1",
          goal: "one-of", accept: ["Re1"],
          prompt: "两个子还不够。e 线是空的 —— 把车调上去,凑够第三个",
          retry: "f1 的车走到 e1", solution: ["Re1"] },
      ],
    },
    // —— 第八部分 · 残局基础 ——
    // 两条只用一个兵、一个王就能讲清的规律。放在 K+P 陪练之前:
    // 「方块规则」回答「追不追得上」,「对王」回答「推不推得过去」——
    // 不先讲这两条,drill-pawn 就只能靠试错。
    {
      id: "square", part: "残局基础", title: "方块规则:追不追得上兵",
      text: [
        "兵要走几步到底线,就以这几格为边长,从兵所在格向底线方向画一个正方形 —— 这就是兵的「方块」。",
        "**轮到防守方走时**,只要王能踏进这个方块,就一定追得上兵;进不去,兵就一定升变。不用一步步算,画个方块就知道结果。",
        "反过来对进攻方也一样:兵每往前一步,方块就缩小一圈,对方王可能就被关在外面了。",
      ],
      tasks: [
        { type: "tap", fen: "8/8/8/2k5/7P/8/8/K7 b - - 0 1",
          prompt: "先把方块画出来 —— 按提示点三个角",
          steps: [
            { tip: "兵在 h4,还要 4 步才到 h8 —— 先点这条路的终点 h8", squares: ["h8"] },
            { tip: "边长 4 格:从 h8 沿第 8 横线往左数 4 格 —— 点 d8", squares: ["d8"] },
            { tip: "再回到兵所在的第 4 横线 —— 点 d4,方块 h4–h8–d8–d4 就画好了", squares: ["d4"] },
          ] },
        { type: "tap", fen: "8/8/8/2k5/7P/8/8/K7 b - - 0 1",
          prompt: "黑王在 c5、方块外面,但轮到黑走 —— 点它该踏进方块的格子",
          steps: [
            { tip: "方块的左边界是 d 线 —— 黑王一步就能踏上去(d4 / d5 / d6 都行),之后一路追上 h 兵", squares: ["d4", "d5", "d6"] },
          ] },
        { type: "move", fen: "8/8/8/2k5/7P/8/8/K7 w - - 0 1", goal: "one-of",
          accept: ["h5"],
          prompt: "换成白先 —— 走一步让黑王再也进不了方块(此局只有这一步能赢)",
          retry: "动王没用,王离得太远 —— 推兵!兵一进,方块缩到 e 线,黑王就被关在外面了",
          solution: ["h5"] },
      ],
    },
    {
      id: "opposition", part: "残局基础", title: "对王:谁先让开谁吃亏",
      text: [
        "两个王在同一条线上、正中间只隔一格,谁都不能再靠近 —— 这叫「对王」(opposition)。",
        "关键在于:**轮到谁走,谁就必须先让开**。所以「取得对王」就是把走棋的义务丢给对方,自己反而占了先。",
        "王兵残局的胜负常常只差这一手:王在兵前面还不够,还要拿到对王。拿不到时,就用兵走一步「等一着」,把义务还给对方。",
      ],
      // 前两题是「点格子」而不是「走一步」:光王对光王在规则上已经是和棋,
      // 引擎不会再接受任何一步 —— 认对王这件事本来也只需要认出格子。
      tasks: [
        { type: "tap", fen: "8/4k3/8/4K3/8/8/8/8 w - - 0 1",
          prompt: "认一认对王的样子",
          steps: [
            { tip: "两王同在 e 线,中间只隔一格 —— 点这一格 e6(两个王谁都进不去)", squares: ["e6"] },
          ] },
        { type: "tap", fen: "8/8/8/4k3/8/8/4K3/8 w - - 0 1",
          prompt: "轮到白走 —— 点白王该去的那一格",
          steps: [
            { tip: "要和 e5 的黑王同线、正中间只隔一格 —— 只有 e3 满足(斜着走就不是对王了)", squares: ["e3"] },
          ] },
        { type: "move", fen: "8/4k3/8/4K3/8/8/4P3/8 w - - 0 1", goal: "one-of",
          accept: ["e3", "e4"],
          prompt: "白王已在兵前,但对王在黑方手里 —— 别动王,用兵走一步「等一着」,把走棋的义务还给黑方",
          retry: "王一动就丢掉了兵前的好位置 —— 手上还有一个兵可以走,用它来等一手",
          solution: ["e3"] },
      ],
    },
    // 1.17:残局基础从 2 课补到 8 课。选题标准是「一条能带走的规则」——
    // 关键格、错色象、车在兵后、兑子方向、候补兵、王要出动,每条都在
    // scripts/test-chess.mjs 里被引擎复核过(错色象靠自我对弈证明,不靠分数)。
    {
      id: "keysquares", part: "残局基础", title: "关键格:王站对了,兵一定进",
      text: [
        "王兵对单王,胜负不取决于兵走得多快,而取决于**王能不能站到对的格子上**。这些格子叫「关键格」。",
        "兵过了第 4 横线之后,它的关键格就是正前方那三格。以 e5 兵为例,关键格是 d6、e6、f6 —— 白王只要占住其中任何一个,不管轮谁走,这个兵一定能升变。",
        "所以王兵残局的正确下法是:**先把王送上关键格,兵最后再推**。反过来先推兵、王跟在后面,常常就只能和棋。",
      ],
      tasks: [
        { type: "tap", fen: "7k/8/8/4P3/8/8/8/K7 w - - 0 1",
          prompt: "e5 兵的三个关键格在哪里 —— 逐个点出来",
          steps: [
            { tip: "兵正前方那一格 —— 点 e6", squares: ["e6"] },
            { tip: "它左边那一格 —— 点 d6", squares: ["d6"] },
            { tip: "它右边那一格 —— 点 f6", squares: ["f6"] },
          ] },
        { type: "move", fen: "8/5k2/8/3KP3/8/8/8/8 w - - 0 1", goal: "one-of",
          accept: ["Kd6"],
          prompt: "白王一步就能踏上关键格 —— 别推兵,走王",
          retry: "推兵只会把兵送到黑王面前。三个关键格 d6/e6/f6 里,现在只有一个走得进去",
          solution: ["Kd6"] },
        { type: "drill", fen: "8/5k2/8/3KP3/8/8/8/8 w - - 0 1", winOn: "promote",
          prompt: "实战:先上关键格,再推兵 —— 把这个 e 兵送到底线升变" },
      ],
    },
    {
      id: "wrongbishop", part: "残局基础", title: "错色象:多一个象也和棋",
      text: [
        "边线兵(a 兵或 h 兵)加一个象,是残局里最有名的陷阱:**如果象控制不到升变格,防守方的王只要坐进那个角,就是和棋** —— 多一个整子也赢不了。",
        "原因很简单:兵只能从这一条边线升变,升变格的颜色是固定的。象走单色格,颜色不对就永远踏不上那一格,也就永远赶不走坐在角里的王。",
        "所以拿到这种残局要先看两件事:**升变格是什么颜色,我的象是什么颜色**。反过来轮到自己防守,就认准那个角往里钻。",
      ],
      tasks: [
        { type: "tap", fen: "7k/8/6K1/7P/8/8/8/5B2 w - - 0 1",
          prompt: "白方多一象一兵,却赢不了 —— 先看两个格子的颜色",
          steps: [
            { tip: "h 兵只能从这一格升变 —— 点 h8,它是深色格", squares: ["h8"] },
            { tip: "再看象自己站的格子 —— 点 f1,浅色。象一辈子只走一种颜色,h8 它永远踏不上", squares: ["f1"] },
          ] },
        { type: "tap", fen: "7k/8/6K1/7P/8/8/8/5B2 w - - 0 1",
          prompt: "黑王只要待在两个格子上就绝对安全 —— 点出其中一格",
          steps: [
            { tip: "h8 和 g8:白方既无法用象将军它,也无法把它赶走(想赶就成逼和) —— 点 h8 或 g8", squares: ["h8", "g8"] },
          ] },
        { type: "move", fen: "1b6/8/8/8/5k1p/8/5K2/8 w - - 0 1", goal: "one-of",
          accept: ["Kg2", "Kg1", "Kf1"],
          prompt: "换你防守:黑方有错色象加 h 兵 —— 白王往哪儿走才守得住?",
          retry: "往 e 线跑就离角越来越远,黑王会一步步把你逼死。朝 h1 那个角走 —— 黑象是深色格的,够不到 h1",
          solution: ["Kg1"] },
      ],
    },
    {
      id: "rookbehind", part: "残局基础", title: "车要放在通路兵后面",
      text: [
        "车兵残局有一条几乎不出错的规矩:**车放在通路兵的后面**。自己的兵后面,或者对方的兵后面,都算。",
        "道理在于兵每往前走一步,后面的车射程不变、而前面挡路的车能站的格子越来越少。**推兵的一方越推越强,挡兵的一方越挡越憋。**",
        "所以看到通路兵,先问一句:我的车在它后面吗?对方的车又在哪里?这一个问题常常就决定了这盘残局。",
      ],
      tasks: [
        { type: "move", fen: "r7/8/8/8/P7/8/4R3/K6k w - - 0 1", goal: "one-of",
          accept: ["Ra2"],
          prompt: "白方有一个 a 兵,黑车正挡在它前面 —— 把白车放到该在的位置",
          retry: "车要到通路兵的后面去,也就是同一条线上、兵的下方",
          solution: ["Ra2"] },
        { type: "tap", fen: "r7/8/8/8/P7/8/R7/K6k b - - 0 1",
          prompt: "现在两台车都在 a 线上 —— 点出那台越来越憋的",
          steps: [
            { tip: "白兵每推一步,a8 的黑车能站的格子就少一个;而 a2 的白车射程从头到尾不变 —— 点 a8", squares: ["a8"] },
          ] },
      ],
    },
    {
      id: "pawntrade", part: "残局基础", title: "多子兑子,少子兑兵",
      text: [
        "残局里最实用的一条交换原则:**自己多子的时候换子,自己少子的时候换兵**。",
        "多子方换掉一对子,剩下的子力比例就更悬殊 —— 多一个兵在满盘子力里不算什么,换到只剩王和兵,那一个兵就是胜负。少子方反过来:兵换光了,对方多的那个兵也就没用了。",
        "所以拿着多一个兵的残局,看到能换的子就换;反过来落后一个兵,要死死抓住自己的兵不放,宁可换掉车和象。",
      ],
      tasks: [
        { type: "move", fen: "4rk2/5ppp/8/8/2P5/8/4RPPP/6K1 w - - 0 1", goal: "capture",
          target: "e8",
          prompt: "白方多一个 c 兵 —— 按原则,该做的交换就在眼前",
          retry: "多子的一方要换子。e 线上正好有一对车面对面",
          solution: ["Rxe8+"] },
        { type: "tap", fen: "5k2/5ppp/8/8/2P5/8/5PPP/6K1 w - - 0 1",
          prompt: "车换掉之后就是这个局面 —— 点出决定胜负的那个兵",
          steps: [
            { tip: "王翼三对三谁也吃不掉谁,后翼白方多出来的这个兵没人管 —— 点 c4", squares: ["c4"] },
          ] },
      ],
    },
    {
      id: "majority", part: "残局基础", title: "兵多的一侧:先推没人挡的那个兵",
      text: [
        "一侧的兵比对方多,叫「多数兵」。多数兵的价值不在于多,而在于**能挤出一个通路兵**。",
        "推法有讲究:**先推那个对面没有兵挡着的兵**(叫「候补兵」)。它一路无阻,能把对方的兵逼得动起来,后面的兵才跟得上去;先推被挡住的那个,只会把自己堵死。",
        "反过来防守也是这条:对方开始推候补兵时,别急着用兵去顶 —— 顶上去往往正合他意。",
      ],
      tasks: [
        { type: "tap", fen: "6k1/pp3ppp/8/8/8/8/PPP3PP/6K1 w - - 0 1",
          prompt: "白方后翼三个兵对两个 —— 点出该先推的那一个",
          steps: [
            { tip: "a 线、b 线上黑方都有兵挡着,只有 c 线对面是空的 —— 点 c2", squares: ["c2"] },
          ] },
        { type: "move", fen: "6k1/pp3ppp/8/8/8/8/PPP3PP/6K1 w - - 0 1", goal: "one-of",
          accept: ["c4", "c3"],
          prompt: "把候补兵推出去",
          retry: "先动的应该是对面没有兵挡着的那一个 —— c 兵。a 兵、b 兵现在都推不开",
          solution: ["c4"] },
      ],
    },
    {
      id: "kingactive", part: "残局基础", title: "残局里,王是主力",
      text: [
        "中局要把王藏好,残局正相反:子力换得差不多之后,**王是一个能攻能守的强子,不出来就等于少一个子在下棋**。",
        "王在残局里的价值大约相当于一个象多一点。它能护送自己的兵、能挡住对方的兵、能一格一格把对方的王逼开 —— 这些事别的子都替不了。",
        "所以残局的第一个念头往往不是走兵,而是:**我的王现在该往哪儿走**。往中心走,往兵多的一边走,往对方通路兵的必经之路上走。",
      ],
      tasks: [
        // 白王原本摆在 g1,那是「已经被将军」的局面 —— 合法,但这一课要教的是
        // 王往哪儿走的选择,不是应将。挪到 g2 之后才是一道真正的选择题。
        { type: "move", fen: "8/8/8/8/8/4k3/5pK1/8 w - - 0 1", goal: "one-of",
          accept: ["Kf1"],
          prompt: "黑兵下一步就升变,白方只有一步能守住 —— 别的走法全都会被将死",
          retry: "王必须挡在兵的升变路上。往 g3、h1、h2、h3 让都是让开 f 线,兵一进底线就完了",
          solution: ["Kf1"] },
        { type: "move", fen: "4k3/8/8/8/8/8/4P3/4K3 w - - 0 1", goal: "one-of",
          accept: ["Kd2", "Kf2"],
          prompt: "一王一兵对单王,轮白走 —— 先走王还是先推兵?这一步就定胜负",
          retry: "推兵就是和棋:兵冲在前面,王跟不上,黑王迎面挡住就完了。王先行,走到兵的前面去开路",
          solution: ["Kf2"] },
      ],
    },
    // —— 第九部分 · 实战杀法 ——
    {
      id: "drill-pawn", part: "实战杀法", title: "王兵残局:护送升变(引擎陪练)",
      text: [
        "K+P 对单王是最常见的残局:王走在兵的**前面**开路,抢住兵前方的关键格(与对方王「对王」),小兵才推得过去。",
        "王先行、兵慢推;升变成功即获胜 —— 小心别把对方王憋成逼和。卡住时点顶栏「提示」看引擎推荐。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/4K3/8/4P3/8 w - - 0 1", goal: "one-of",
          accept: ["Kd5", "Ke5", "Kf5"],
          prompt: "热身:第一步该动谁?王先行 —— 走到兵的前面开路(d5 / e5 / f5 都对)",
          retry: "别急着推兵!先动王,王要走在兵前面才能抢到关键格", solution: ["Ke5"] },
        { type: "drill", fen: "4k3/8/8/8/4K3/8/4P3/8 w - - 0 1", winOn: "promote",
          prompt: "实战:用王开路护送 e 兵到底线升变(升变即胜;逼和或丢兵判失败重来)" },
      ],
    },
    {
      id: "drill-queen", part: "实战杀法", title: "后杀单王(引擎陪练)",
      text: [
        "K+Q 对单王是最基础的必胜残局,三步套路:① 后保持与黑王「马步」距离,一圈圈锁死它;② 自己的王走近助攻;③ 王到位后在边线将死。",
        "「马步」距离是防逼和的保险:后既锁住王,又永远不会贴脸没收它的最后一格。卡住时点顶栏「提示」。",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1", goal: "one-of",
          accept: ["Qf6", "Qg7"],
          prompt: "热身①:把后走到与黑王成「日」字的格子(f6 或 g7),锁住它又不逼和",
          retry: "找与 e8 王成马步的格子 —— f6 或 g7,别贴脸也别放跑", solution: ["Qf6"] },
        { type: "move", fen: "k7/8/2K5/8/8/8/8/1Q6 w - - 0 1", goal: "mate",
          prompt: "热身②:王已助攻到位 —— 一步将死(想想哪个将军格有自己王的保护)",
          retry: "b8 和 c8 都会被王吃掉或逃出 —— 沿 b 线上到有王保护的那格", solution: ["Qb7#"] },
        { type: "drill", fen: "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
          prompt: "实战:用后 + 王将死黑王(逼和或超过 50 回合判失败重来)" },
      ],
    },
    {
      id: "drill-rook", part: "实战杀法", title: "车杀单王(引擎陪练)",
      text: [
        "K+R 对单王同样必胜,但更考验步法:① 车封一条线当栅栏,把黑王限制在越来越小的区域;② 自己的王走近,与黑王正面「对王」;③ 对上王的那一刻,车将军就是将死或再逼近一线。",
        "完成这一课,你就掌握了最重要的两个基础残局 —— 去人机·新手开始第一局(它会主动犯错,专为第一局准备),或到「做题」模式继续磨杀型!",
      ],
      tasks: [
        { type: "move", fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1", goal: "one-of",
          accept: ["Ra7"],
          prompt: "热身①:车上第 7 横线当栅栏,把黑王关在底线",
          retry: "把 a1 车提到 a7 —— 整条第 7 线就是黑王翻不过的栅栏", solution: ["Ra7"] },
        { type: "move", fen: "4k3/R7/4K3/8/8/8/8/8 w - - 0 1", goal: "mate",
          prompt: "热身②:两王已经正面「对王」—— 车沿底线将死!",
          retry: "王对王时黑王躲不开底线将军 —— 车冲到第 8 横线", solution: ["Ra8#"] },
        { type: "drill", fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
          prompt: "实战:用车 + 王将死黑王(比后杀更需要耐心,记得可以用「提示」)" },
      ],
    },
    {
      id: "drill-bishops", part: "实战杀法", title: "双象杀单王(引擎陪练)",
      text: [
        "两个象控制两种颜色的格子,配合王可以把对方王逼进**角落**将死 —— 注意:必须逼到象能控制的那个角(与其中一象同色的角)。",
        "步骤:两象并肩站在相邻斜线上织成一张网,王在后面把黑王一格格推向角落。",
      ],
      tasks: [
        { type: "move", fen: "8/8/8/4k3/8/8/8/KBB5 w - - 0 1", goal: "one-of",
          // Both bishops start in the corner: Bb1 is light-squared (a2/c2/d3/
          // e4/f5/g6/h7), Bc1 dark (b2/a3/d2/e3/f4/g5/h6). Up to 1.19 this list
          // also offered Bc3/Bb3/Bc4/Bd5 — squares neither bishop can reach —
          // and "Bf4" without the check mark the engine writes. Five of eleven
          // could never match, and app.js compares SAN exactly.
          // 长端全收,短端(Ba2/Ba3)不收 —— 那两格正是课文说的反面:象走过去
          // 只剩一两格活动范围,谈不上「控制中心」。
          accept: ["Bb2+", "Bd2", "Be3", "Bf4+", "Bg5", "Bh6", "Bc2", "Bd3", "Be4", "Bf5", "Bg6", "Bh7"],
          prompt: "热身:先把一个象走到中心大斜线上开始织网(任意一象向中心方向走都可以)",
          retry: "让象离开底角,走到能控制中心的斜线上", solution: ["Bd2"] },
        { type: "drill", fen: "8/8/8/4k3/8/8/8/KBB5 w - - 0 1",
          prompt: "实战:双象 + 王把黑王逼进角落将死(逼和或超 50 回合判失败重来)" },
      ],
    },
    {
      id: "drill-lucena", part: "实战杀法", title: "卢塞纳:车兵残局搭桥",
      text: [
        "「卢塞纳」是车兵残局最重要的**取胜**技术:己方王站在兵前挡路、对方车在后面不停将军时,用自己的车在第 4 横线**搭一座桥**替王挡住将军,王就能让开、兵顺利升变。",
        "记住三步:① 把车放到兵前方第 4 横线;② 王从兵前挪出来;③ 对方将军时用车在中间挡一手(这就是「桥」)。",
      ],
      tasks: [
        { type: "drill", fen: "1K1k4/1P6/8/8/8/8/r7/2R5 w - - 0 1", winOn: "promote",
          prompt: "护送 b 兵升变(升变即胜;丢兵或和棋判失败重来)" },
      ],
    },
    {
      id: "drill-philidor", part: "实战杀法", title: "菲利多尔:车兵残局守和",
      text: [
        "残局不只有赢,更要会**守**。「菲利多尔防守」是少一兵时求和的看家本领:把车横在自己的**第 3 横线**上,对方的王就过不来;等它的兵推到第 3 横线时,立刻把车撤到底线,从**背后连续将军**。",
        "这一课你执白**少一个兵**,目标不是取胜而是**守成和棋** —— 逼和、子力不足、50 回合无进展都算成功。",
      ],
      tasks: [
        { type: "drill", fen: "r7/8/8/4k3/4p3/1R6/8/4K3 w - - 0 1", winOn: "draw", engine: "normal",
          prompt: "守和:车守住第 3 横线别让黑王过来(和棋即成功;被将死或黑兵升变判失败重来)" },
      ],
    },
    {
      id: "drill-qvr", part: "实战杀法", title: "后对车(进阶挑战)",
      text: [
        "K+Q 对 K+R 是必胜但**最难**的基础残局之一:后要靠不断将军与捉双,把黑车从王身边逼开吃掉,再用后杀王。",
        "技巧:让黑王与黑车站到「马步」或同一直线上,用将军捉双一举得车。这一课很难 —— 用「提示」也不丢人。",
      ],
      tasks: [
        { type: "drill", fen: "8/8/8/3k4/8/8/4r3/K5Q1 w - - 0 1",
          prompt: "实战:用后 + 王赢下黑车并将死(逼和或超 50 回合判失败重来)" },
      ],
    },
  ];
