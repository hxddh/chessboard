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
 * @module lessons
 */
(function (global) {
  const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

  global.CHESS_LESSONS = [
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
      id: "setup", part: "认识棋盘", title: "棋子·摆法·对局目标",
      text: [
        "每方 16 个棋子:8 兵、2 车、2 马、2 象、1 后、1 王。",
        "底线从角向内依次是车、马、象;后站在与自己同色的格子上(白后 d1 浅格、黑后 d8 深格),王在 e 线;兵排在第二排。",
        "对局目标:将死对方的王 —— 让它被攻击且无路可逃。",
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
      id: "fork", part: "吃子与价值", title: "捉双:一子攻两个",
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
      id: "skewer", part: "吃子与价值", title: "串击:逼开前面吃后面",
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
      id: "discovery", part: "吃子与价值", title: "闪击:挪一子,露一击",
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
    // —— 第四部分 · 规则与胜负 ——
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
      id: "pin", part: "规则与胜负", title: "牵制:动不了的子",
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
        "除了逼和,还有这些情况判和:双方都无子力将杀(如王对王)、同一局面重复三次、连续 50 回合无吃子无动兵、双方协议和棋。",
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
        "这三课的杀型(阶梯、闷杀、底线杀)覆盖了绝大多数实战收官画面,「做题」模式里还有成套的杀型题等你磨。",
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
    // —— 第七部分 · 实战杀法 ——
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
        "完成这一课,你就掌握了最重要的两个基础残局 —— 去人机·入门开始第一局,或到「做题」模式继续磨杀型!",
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
  ];
})(typeof window !== "undefined" ? window : globalThis);
