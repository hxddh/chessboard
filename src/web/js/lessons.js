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
 *   drill  — play out a basic mate against the engine (black defends)
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
    // —— 第五部分 · 开局入门 ——
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
    // —— 第六部分 · 实战杀法 ——
    {
      id: "drill-queen", part: "实战杀法", title: "后杀单王(引擎陪练)",
      text: [
        "K+Q 对单王是最基础的必胜残局:用后一圈圈压缩黑王活动空间(让后与黑王保持一个「马步」的距离最稳,不会随手逼和),再把自己的王走近,最后在边线将死。",
        "引擎会执黑全力逃跑 —— 千万小心逼和!",
      ],
      tasks: [
        { type: "drill", fen: "4k3/8/8/8/8/8/8/Q3K3 w - - 0 1",
          prompt: "用后 + 王将死黑王(逼和或超过 50 回合判失败重来)" },
      ],
    },
    {
      id: "drill-rook", part: "实战杀法", title: "车杀单王(引擎陪练)",
      text: [
        "K+R 对单王同样必胜,但更考验步法:用车封锁一条线把黑王逼向边线,王与王「对面」时用车将军。",
        "完成这一课,你就掌握了最重要的两个基础残局 —— 去人机·入门开始第一局,或到「做题」模式继续磨杀型!",
      ],
      tasks: [
        { type: "drill", fen: "4k3/8/8/8/8/8/8/R3K3 w - - 0 1",
          prompt: "用车 + 王将死黑王(比后杀更需要耐心)" },
      ],
    },
  ];
})(typeof window !== "undefined" ? window : globalThis);
