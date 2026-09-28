/**
 * UI localisation.
 *
 * Scope is the whole app: chrome (buttons, headings, status lines), every
 * runtime message, and — since 1.6 — the teaching content too, which lives in
 * its own files beside the originals (lessons-en.js, puzzles-en.js,
 * openings-en.js) so a translation can never disagree with the chess.
 *
 * Static markup opts in with `data-i18n` (text), `data-i18n-title` (tooltip)
 * or `data-i18n-aria` (aria-label); dynamic strings call `t(key)`, or
 * `tf(key, vals)` when a value has to be spliced into a sentence. Unknown keys
 * fall back to the zh-CN string, and then to the key itself, so a missing
 * translation degrades to readable text instead of blank UI.
 *
 * Keys are semantic, and name the control rather than the order it was typed
 * in: `tip.persona.off`, `msg.draw.claimedRepetition`, `tip.cat.def`. Until
 * 1.25 the two largest namespaces were numbered by entry order — 75 `tip.NN`
 * and 71 `m.NN`, 35% of all copy — and a numbered key cannot be proofread:
 * `tip.62` tells you nothing about which button it labels, so a wrong string
 * is only findable by changing it and looking. It also cannot collide
 * *visibly*: tip.60–64 were defined twice in every dictionary from 1.20 to
 * 1.25, the later block won, and five controls wore another control's tooltip
 * in all three languages while the key-parity check below reported everything
 * present — because a duplicate makes parity more true, not less.
 *
 * 7.9 §4c, the house style for the English (and the Japanese follows it):
 * buttons, headings and short labels are sentence case — "Take lesson 1",
 * "Next in the course", never "the next lesson" — with no full stop; a
 * description (the line of prose under or beside a control, an empty state,
 * a hint) is a whole sentence that could stand on its own, capitalised and
 * ending in a full stop. 7.8.0 had both "Solve a tactics puzzle" and "no game
 * played today" on one card, and "twenty analysed buy a diagnosis".
 *
 * scripts/test-chess.mjs enforces the invariants that keep this honest: key
 * parity across languages, no key defined twice in a dictionary, no key left
 * unread by any control, no Chinese left in a non-Chinese table, no Chinese
 * literal reaching the DOM from app.js, and full coverage of the content files.
 * @module i18n
 */
import { LANG_IDS, LANG_NAMES, FALLBACK_LANG, detectLang as detectFrom } from "./lang-ids.js";

  const DICT = {
    "zh-CN": {
      "motif.fork": "捉双",
      "motif.pin": "牵制",
      "motif.skewer": "串击",
      "motif.discovered": "闪将",
      "motif.double": "双将",
      "motif.hanging": "挂着的子",
      "motif.backRank": "底线杀",
      "motif.mateThreat": "杀棋威胁",
      "motif.trapped": "困子",
      "motif.removeDefender": "消除保护",
      "motif.overload": "过载",
      "motif.deflection": "引离",
      "motif.decoy": "引入",
      "motif.xray": "X 光",
      "motif.zwischenzug": "中间着",
      "motif.desperado": "绝望子",
      "motif.promotion": "升变",
      "motif.perpetual": "长将",
      "motif.discoveredAttack": "闪击",
      "side.contents": "目录",
      "side.puzzleList": "题目列表",
      "side.danger": "清除数据",
      "side.learning": "学习数据", "act.learningExport": "导出", "act.learningImport": "导入",
      "side.allData": "全部数据", "act.allExport": "导出", "act.allImport": "导入", "act.about": "关于",
      "tip.allData.export": "把本机全部数据（对局、存档槽、设置、战绩、学习数据）存成一个文件", "tip.allData.import": "用导出的文件整个替换本机数据", "tip.about": "版本、许可与致谢",
      "dlg.exportAll": "导出全部数据", "dlg.importAll": "导入全部数据：本机现有的对局、存档槽、设置、战绩与学习数据将被文件里的整个替换。", "msg.allData.badFile": "这不是本应用导出的数据文件", "msg.allData.imported": "已导入全部数据，正在重新载入…",
      "msg.profile.restored": "已从本机数据文件恢复档案，正在重新载入…", "msg.profile.fileBad": "本机数据文件读不出来，本次用浏览器缓存里的档案；原文件未被覆盖",
      "about.title": "关于国际象棋", "about.version": "版本", "about.license": "许可", "about.source": "源码", "about.credits": "致谢", "about.dataPath": "数据位置",
      "about.licenseText": "GPLv3 —— 自由软件，源码随发布提供", "about.creditsText": "Stockfish 19（GPLv3）· chess.js（BSD-2）· cburnett 棋子（Colin M.L. Burnett，GPLv2+；「经典」一套为其 Wikimedia 重绘版，GFDL / BSD / GPL / CC BY-SA 3.0 多重许可）· Merida 棋子（Armando Hernandez Marroquin，GPLv2+）· Chessnut 棋子（Alexis Luengas，Apache 2.0）· Fantasy / Celtic / Spatial 棋子（Maurizio Monge，MIT）· lichess chess-openings（CC0）· 木质音效为本项目自制（物理模型实时合成，GPLv3）· Lucide 图标（ISC；其中 10 个源自 Feather，MIT）",
      // 7.7 (v7-7-plan §2–§4, §7): the result card, the puzzle feedback card,
      // the lesson dots and the tool row's tooltips
      "go.analyse": "分析这盘",
      "go.again": "再来一盘",
      "go.switch": "换个对手",
      "go.youWin": "你赢了",
      "go.youLose": "你输了",
      "go.whiteWins": "白方胜",
      "go.blackWins": "黑方胜",
      "go.draw": "和棋",
      "go.r.mate": "将杀",
      "go.r.flag": "{0}超时",
      "go.r.flagDraw": "超时 · 对方子力不足以将杀",
      "go.r.resign": "{0}认输",
      "go.r.agreed": "协议和棋",
      "go.r.threefold": "判和 · 同一局面三次重复",
      "go.r.fifty": "判和 · 50 回合无吃子无动兵",
      "go.r.stalemate": "逼和",
      "go.r.insufficient": "双方子力都不足以将杀",
      "go.r.fivefold": "同一局面五次重复",
      "go.r.seventyfive": "75 回合无吃子无动兵",
      "go.r.file": "棋谱里记录的结果",
      "pz.fb.best": "最佳着！",
      "pz.fb.keepGoing": "对了，接着走",
      "pz.fb.retry": "再想想",
      "pz.fb.streak": "连对 {0} 题",
      "pz.fb.showHint": "看提示",
      "aria.lessonDots": "本课进度",
      "tip.reviewOpen": "复盘：分析、精析、持续分析",
      "tip.pgn.export": "把这盘存成 PGN 文件",
      "tip.more": "更多：粘贴、打开、FEN",
      "about.dataUnknown": "浏览器存储（无原生数据文件）", "act.checkUpdate": "检查更新", "msg.update.latest": "已是最新版本", "msg.update.available": "有新版本 {0} —— 链接已复制到剪贴板", "msg.update.failed": "暂时无法检查更新", "msg.link.copied": "链接已复制到剪贴板",
      "msg.menuLang.restart": "菜单语言将在下次启动时生效", "app.title": "国际象棋",
      "side.volume": "音量", "tip.volume": "音效音量", "side.soundSet": "音色", "tip.soundSet": "木质：木头棋子落在木头棋盘上；经典：7.6 以前的合成音", "soundSet.wood": "木质", "soundSet.classic": "经典", "side.coords": "坐标", "tip.coords": "在棋盘上标出 a–h 与 1–8", "side.coordsAt": "坐标位置", "coords.out": "盘外", "coords.in": "盘内", "side.softMark": "存疑标注", "tip.softMark": "复盘里显示 ?! —— 同一局面跑两遍只有约一半重合，默认不显示", "side.blindfold": "盲棋", "tip.blindfold": "不画棋子，只画标记 —— 靠记忆下", "side.engineArrows": "显示引擎箭头", "tip.engineArrows": "持续分析与复盘时，把引擎前三条线的第一步画成棋盘上的箭头",
      "msg.blind.on": "盲棋：棋子已隐藏", "msg.blind.off": "棋子已显示",
      "side.engine": "引擎", "side.hash": "置换表", "tip.hash": "引擎的置换表大小（MB）", "side.multipv": "分析线数", "tip.multipv": "复盘与持续分析同时给出几条变化",
      "tip.learning.export": "把错题本、复习队列、课程进度和战绩存成一个文件", "tip.learning.import": "从导出的文件合并回来，不会覆盖本机已有的进度",
      "dlg.exportLearning": "导出学习数据", "dlg.importLearning": "导入学习数据：与本机已有的进度合并，不覆盖任何一方。",
      "msg.learning.badFile": "这不是本应用导出的学习数据文件", "msg.learning.imported": "已合并 —— 错题本现有 {0} 道",
      "act.clearLearn": "清除教学进度",
      "act.clearStats": "清除统计与历史",
      "msg.storage.failed": "保存失败 —— 本机存储写不进去。这一局之后的进度、统计与成就都不会被记住，重开会回到上次成功保存的状态。",
      "msg.storage.corrupt": "有一份记录读不出来（{0}），已原样搁置、没有覆盖。设置页「全部数据 → 导出」会把它一起带出来。",
      "msg.fault.happened": "出了问题 —— 当前局面已保存。若再次发生，请复制诊断信息反馈。", "msg.fault.copy": "复制诊断信息", "msg.fault.copied": "已复制诊断信息",
      "lang.name": "中文",
      // first-run onboarding (ob.*)
      "ob.title": "先从哪里开始？",
      "ob.newLabel": "我是新手，从零开始学",
      "ob.newSub": "96 课互动教程，从认棋盘到中级战术与残局，每课一个任务",
      "ob.knowLabel": "我会下棋，直接开局",
      "ob.knowSub": "与 Stockfish 对弈，难度可随时在侧栏调整",
      "ob.later": "先看看棋盘", "ob.recommended": "推荐",
      // post-game review (rv.*)
      "rv.title": "对局回顾",
      // "what next?" line under the statistics (rec.*)
      "rec.lessons": "教学还剩 {1} 课未完成（已完成 {0}）—— 打好基础再回来对弈",
      "rec.harder": "近几局几乎全胜 —— 可以试试「{0}」难度了",
      "rec.easier": "近几局都输了 —— 换到「{0}」难度会更有收获",
      "rec.review": "近几局胜少负多 —— 「做题 → 复习」还有 {0} 道错题等着你",
      "rec.puzzles": "近几局胜少负多 —— 去「做题」练练战术眼，实战会更稳",
      "rv.acc": "精准度", "rv.acpl": "平均失分", "rv.marks": "?! · ? · ??",
      "rv.kind.soft": "小失误", "rv.kind.mid": "失误", "rv.kind.bad": "严重失误",
      "rv.keyMoments": "关键时刻",
      "rv.grade.brilliant": "妙着", "rv.grade.only": "仅此一着", "rv.grade.best": "最佳", "rv.grade.excellent": "优秀",
      "rv.grade.good": "良好", "rv.grade.book": "谱着", "rv.grade.miss": "错失良机",
      "rv.turningPointPlain": "关键一步：第 {0} 回合 {1} 走 {2}，胜率掉了 {3} 个百分点",
      "rv.jumpTip": "跳到这一步之后的局面",
      "rv.bank": "把这一手收进错题",
      "rv.bankTip": "按错题自炼的规矩把这个转折点收进「错题」题集",
      "ex.mate1": "有 {0} 一步杀没走",
      "ex.mateN": "有 {0} 起的 {1} 步杀没走",
      "ex.allowsMate": "让对方有 {0} 起的 {1} 步杀",
      "ex.allowsMate1": "让对方 {0} 一步杀",
      "ex.motifLoss": "漏看了 {0} {1}，丢{2}",
      "ex.motif": "漏看了 {0} {1}",
      "ex.forkHits": "漏看了 {0} {1}，同时攻击{2}和{3}",
      "ex.loss": "对方 {0} 之后丢{1}",
      "ex.betterMotif": "更好的是 {0}（{1}）",
      "ex.better": "更好的是 {0}",
      "ex.mate1Motif": "有 {0} 一步杀没走（{1}）",
      "ex.mateNMotif": "有 {0} 起的 {1} 步杀没走（{2}）",
      "ex.threatMate": "没防住对方 {0} 一步杀的威胁",
      "ex.allowsMate1Motif": "让对方 {0} 一步杀（{1}）",
      "ex.allowsMateMotif": "让对方有 {0} 起的 {1} 步杀（{2}）",
      "ex.threatHanging": "没理会对方 {0} 的威胁，{1}没有保护住",
      "ex.perpetual": "让对方 {0} 起长将",
      "ex.hanging": "漏看了 {0}，{1}没有保护住",
      "ex.betterHanging": "更好的是 {0}，吃掉没有保护住的{1}",
      "ex.hangingCheap": "漏看了 {0}，{2}吃{1}，换不回来",
      "ex.threatCheap": "没理会对方 {0} 的威胁，{2}吃{1}，换不回来",
      "ex.betterCheap": "更好的是 {0}，{2}吃{1}，净赚子力",
      "rv.mistakes": "失着",
      "rv.retry": "再试一次",
      "rv.curveCap": "白方胜率",
      "rv.km.prev": "上一个关键时刻",
      "rv.km.next": "下一个关键时刻",
      "rv.km.why": "为什么",
      "rv.km.lines": "看引擎线",
      "rv.km.win": "胜率 {0}% → {1}%",
      "rv.km.whyGood": "换任何别的走法，胜率都至少少 {0} 个百分点。",
      "rv.km.whyDrop": "这一着让胜率从 {0}% 掉到 {1}%。",
      "rv.learn": "从错误中学 · {0}",
      "tip.learn": "把本局所有 ? 与 ?? 串成一组「再试一次」，一处接一处练",
      "rt.progress": "从错误中学 · {0} / {1}",
      "rt.next": "下一个",
      "rt.finish": "完成",
      "rt.learnDone": "练完了：{0} / {1} 处找对了",
      "rt.ask": "再试一次：第 {0} 回合，{1}走哪一步？",
      "rt.checking": "引擎正在判断这一手…",
      "rt.right": "走对了",
      "rt.wrong": "不对",
      "rt.best": "引擎的最佳：{0}",
      "rt.again": "再走一次",
      "rt.back": "回到复盘",
      "rt.noEngine": "引擎还没就绪，判断不了这一手",
      "rv.banked": "已收进错题 · 正解 {0}",
      "rv.bankDup": "这一手已经在错题里",
      "rv.bankNone": "引擎的选择与实战相同，没什么可练",
      "rv.verdict.blunders": "严重失误偏多 —— 每步先检查对方的将军、吃子和捉双",
      "rv.verdict.oneBlunder": "只有一次严重失误 —— 找出它，下一盘就少丢一分",
      "rv.verdict.mistakes": "失误较多 —— 落子前多算一步对方的回应",
      "rv.verdict.excellent": "发挥出色 —— 可以挑战更高难度了",
      "rv.verdict.solid": "下得稳健 —— 继续保持",
      "rv.verdict.roomToGrow": "还有提升空间 —— 到「做题」练练战术眼",
      "rv.verdict.tooShort": "只分析了 {0} 着 —— 还不足以评价整体表现",
      "rv.verdict.excellentPlain": "发挥出色",
      // learn mode (lm.*) — task prompts, feedback and drill outcomes
      "lm.demoIntro": "先看一遍演示 —— 点击棋盘可跳过",
      "lm.yourTurn": "到你了！",
      "lm.answerShown": "已为你标出答案",
      "lm.demoing": "演示中 —— 点击棋盘跳过，看完就轮到你",
      "lm.taskDone": "完成！",
      "lm.tapNext": "点「下一课」继续",
      "lm.allDone": "全部课程完成！",
      "lm.sparThinking": "陪练思考中…",
      "lm.wrongSquare": "不是这格 —— {0}",
      "lm.onlyPiece": "这一课请只用{0}",
      "lm.stalemateFail": "逼和了！黑王没被将军又无路可走，判和 —— 重来",
      "lm.retry": "没达成目标，再试试",
      "lm.promoWin": "升变成功！K+Q 收官你早就会了",
      "lm.mateDefLost": "被将死了 —— 防守失败，重来",
      "lm.blackQueened": "黑兵升变了 —— 防守失败，重来",
      "lm.mated": "被将死了 —— 重来",
      "lm.stalemated": "逼和了 —— 和棋，重来",
      "lm.drawn": "和棋了 —— 重来",
      "lmTip.philidor": "菲利多防御：车先停在第三横线，等白兵推上来再从后面连续将军",
      "lmTip.stalemate": "别把对方的格子全占光 —— 留一格给它，或者先将军再收网",
      "lmTip.bringKing": "自己的王也要走上去帮忙，光靠车和后赶不动对方的王",
      "lmTip.driveToEdge": "先把对方的王逼到棋盘边上，中间的王杀不掉",
      "lmTip.escortPawn": "王走到兵前面开路，兵自己走不到底线",
      "lmTip.method": "按步骤来：把对方的王赶到边上，自己的王顶上去，最后一击",
      "lmTip.ownKing": "多子还被将死，是自己的王进了对方的火力线 —— 先看自己的王安不安全",
      "lm.tipSep": "。",
      "lm.noEngine": "引擎不可用，无法陪练",
      "lm.lostMaterial": "大子丢了，无法将杀 —— 重来",
      "lm.nextSubtask": "完成！下一小题",
      "lm.toBeginnerAi": "去人机·新手",
      "lm.restarted": "本课重来",
      "lm.noDemo": "本任务没有演示",
      "lm.progressReset": "教学进度已重置",
      "lm.firstGame": "人机对弈 · 新手 —— 开始你的第一局！",
      // puzzle mode (pz.*)
      "pz.forcing": "强制手段",
      "pz.goalOp": "{0} · 执白照谱走完 {1} 回合",
      "pz.goalOpB": "{0} · 执黑照谱应完 {1} 回合",
      "pz.moveUnit": "回合",
      "ntf.analysisDone": "分析完成",
      "ntf.libraryTitle": "棋谱库",
      "ntf.libraryBody": "已分析 {0}/{1} 局",
      "ntf.libraryDone": "{0} 局分析完了",
      "st.quietMoves": "{0} 回合无进展",
      "pz.goalWin": "{0} · 白先，吃掉最大的战利品（净得 {1} 分）",
      "pz.goalTac": "{0} · {1} · 白先强制得子（净得 {2} 分）",
      "pz.goalReal": "{0} · 满盘 {1} 个子，白先 —— 只有这一步能得子（净得 {2} 分）",
      "pz.goalDef": "{0} · 黑方下一步就要将死你 —— 找出接得住的一手",
      "pz.goalDraw": "{0} · 白方已经输定了 —— 把最后能动的子送出去，对方一吃就成僵局",
      "pz.goalMate": "{0} · 白先，{1}步内将死",
      "pz.n.1": "一", "pz.n.2": "两", "pz.n.3": "三",
      "pz.wrongCapture": "吃它不划算 —— 数数保护者再算算分",
      "pz.notTheMove": "这一步不是最强的 —— 满盘找一找，只有一步能真的得子",
      "pz.biggerPrize": "有更大的战利品等着你",
      "pz.findMotif": "找{0} —— 先用将军逼住对方",
      "pz.takeTarget": "抓住时机吃掉目标子",
      "pz.stillMate": "还是没接住 —— {1}接着走 {0} 就将死了",
      "pz.notDrawn": "这一手和不了 —— 想想怎么逼成僵局或长将",
      "pz.offBook": "这不是谱着",
      "pz.notMateYetMove": "还不是将死 —— {1}可走 {0}",
      "pz.notMateYet": "还不是将死",
      "pz.refuted": "不能强制将死 —— {1}可用 {0} 化解",
      "pz.noForcedMate": "这步不能强制将死",
      "pz.doneOp": "背谱完成", "pz.doneWin": "得子成功", "pz.doneMate": "解出",
      "pz.doneReal": "抓住了",
      "pz.doneDef": "接住了", "pz.doneDraw": "和棋保住了",
      "pz.reviewEmptyDone": "错题都清光了 · 干得漂亮！",
      "pz.missedCount": "错题 {0} 道",
      "pz.solvedCount": "已解 {0}/{1}",
      "pz.solvedNext": "解出！点「下一题」继续",
      "pz.nth": "第 {0} 题",
      "pz.idea": "思路",
      "pz.noMissed": "还没有错题 —— 答错或看答案的题会进复习",
      "pz.restarted": "重新开始本题",
      // roles shown beside the clocks
      "role.student": "学员（执白）", "role.sparring": "引擎陪练",
      "role.you": "你（执白）", "role.youB": "你（执黑）", "role.puzzle": "题目",
      // confirm dialogs (dlg.*)
      "dlg.newGame": "开始新局将清空当前对局，是否继续？",
      "dlg.retryHere": "从第 {0} 着继续重下，其后 {1} 着留作变着，是否继续？",
      "dlg.resign": "{0}认输，结束本局？",
      "dlg.whoResigns": "哪一方认输？",
      "dlg.whiteResigns": "白方认输", "dlg.blackResigns": "黑方认输",
      "dlg.drawBoth": "双方都同意和棋吗？",
      "dlg.drawAgree": "同意和棋", "dlg.drawPlayOn": "继续下",
      "dlg.exportPgn": "导出 PGN", "dlg.openPgn": "打开 PGN",
      "dlg.pickGame": "这份 PGN 含 {0} 局，选择要导入的一局",
      "dlg.importPgn": "导入将替换当前对局，是否继续？",
      "dlg.importPgnTitle": "导入 PGN", "dlg.import": "导入",
      "dlg.clearStats": "清零人机对局统计？对局历史也会一并删除。", "dlg.clearStatsTitle": "清零统计",
      "dlg.resetLearn": "清空全部教学进度，从第一课重新开始？", "dlg.resetLearnTitle": "重置教学",
      "dlg.clearSave": "清除自动存档并开始新局？", "dlg.clear": "清除",
      "dlg.loadSlot": "读取存档槽将替换当前对局，是否继续？",
      "dlg.loadSlotTitle": "读取存档槽", "dlg.loadSlotOk": "读取",
      // misc runtime messages (mm.*)
      "mm.promoted": "已升变为{0}",
      "mm.goLiveFirst": "请先「回到最新一着」再走子",
      "mm.backToMove": "已回到第 {0} 着，继续对弈",
      "mm.blunder": "刚才的 {0} 可能是严重失误 —— 可按 Z 悔棋重想",
      "mm.plies": "{0} 着",
      "mm.fileTooLarge": "文件超过 {0} KB，读不进来 —— 请先把棋谱库拆小再导入",
      "act.reportExport": "导出复盘图", "tip.reportExport": "把复盘结论存成一张图",
      "rv.exportTitle": "导出复盘图", "rv.noReport": "先分析这局棋，才有复盘可以导出",
      "mm.moveCount.one": "{0} 回合", "mm.moveCount.other": "{0} 回合",
      "mm.clipboard": "剪贴板",
      "mm.positionLoaded": "已载入局面",
      "mm.engineInitFailed": "引擎初始化失败",
      "an.pv": "引擎",
      // 6.0 analysis board: the game tree, variations, shapes (v6-plan Q2.1–Q2.4)
      "act.backMain": "回主线", "tip.backMain": "回到本局主线，光标停在同一深度",
      "act.tryHere": "从这里试走", "act.save": "保存",
      "an.pvSave": "存为变着", "tip.pvSave": "把这条引擎变化写进棋谱，作为当前局面的变着",
      "msg.pgnLocked": "分析进行中，这时改棋谱会让它作废。先停止分析",
      "ml.menu": "着法操作", "ml.promote": "升为主线", "ml.delete": "删除分支", "ml.editNote": "编辑注释",
      "dlg.deleteBranch": "删除从 {0} 起的这条分支及其后的所有着法？",
      "note.title": "注释", "note.titleFor": "注释 · {0}", "note.placeholder": "写下这一着的想法…",
      "msg.variation.promoted": "已升为主线", "msg.variation.deleted": "已删除分支",
      "msg.variation.saved": "已存为变着", "msg.variation.stale": "这条变化在当前局面走不通",
      "board.previewPly": "预览 · 第 {0} 着", "board.previewPv": "预览 · 引擎变化", "board.previewEsc": "Esc 返回实战",
      "curve.at": "第 {0} 着",
      "curve.hover": "第 {0} 回合 {1} {2}",
      "stats.wld": "{0}胜 {1}负 {2}和",
      "idle.last": "上一局", "idle.ready": "准备开始",
      "idle.vsEngine": "与引擎对弈", "idle.vsHuman": "双人同屏",
      "idle.tip": "走一步棋就会出现棋谱；完局后点「分析」可以看回顾报告",
      "aria.boardKeys": "棋盘 · 方向键移动光标，回车选子与落子，Esc 取消选择",
      "aria.panel": "侧栏", "aria.side": "对局面板", "aria.board": "棋盘",
      "aria.lessonList": "课程列表", "aria.puzzleList": "题目列表", "aria.puzzleTier": "题目难度",
      "aria.palette": "棋子", "aria.moveList": "着法列表", "aria.evalCurve": "局势曲线",
      "aria.evalBar": "当前局面形势", "rv.evalNone": "未测",
      "aria.confirm": "确认",
      "promo.title": "升变为", "pick.title": "选择",
      "pz.cat": "题型", "pz.cat.m1": "一步杀", "pz.cat.m2": "两步杀", "pz.cat.m3": "三步杀",
      "pz.cat.win": "吃子", "pz.cat.tac": "战术", "pz.cat.op": "开局", "pz.cat.review": "复习",
      "pz.cat.mine": "错题",
      "tip.cat.mine": "错题：复盘标为 ?? 的你自己的失着，重摆一遍找对的那手",
      "pz.goalMine": "实战里你走了 {0} —— 找出更强的一手",
      "pz.mineCost": "当时亏 {0} 分",
      "pz.mineName": "错题 {0} · 第 {1} 手",
      "pz.mine.repeat": "这正是实战里丢分的那一手",
      "pz.mine.stronger": "引擎在这里另有更强的一手",
      "pz.mine.whyLoss": "实战的 {0} 亏了约 {1} 分。", "pz.mine.whyLine": "{0} 之后大致是 {1}。",
      "pz.mine.alsoFine": "{0} 也成立 —— 与最佳着只差 {1} 分", "pz.mine.altCost": "比最佳着亏 {0} 分",
      "pz.doneMine": "找回了这一手",
      "msg.mined": "收进 {0} 道错题",
      "msg.minesRevised": "更正 {0} 道错题的答案", "msg.minesWithdrawn": "撤销 {0} 道不再成立的错题",
      "daily.btn": "今天的训练",
      "tip.daily": "按复习欠账、错题、弱项和课程进度排出这一节练习",
      "daily.of": "第 {0}/{1} 步",
      "daily.review": "先清复习 {0} 题",
      "daily.mine": "你的错题 {0} 道",
      "daily.weak": "弱项「{0}」两道",
      "daily.motif": "母题「{0}」两道", "daily.motifDone": "这个母题的题都做完了 —— 换别的练",
      "daily.lesson": "学一节新课",
      "daily.op": "背一条谱",
      "daily.lib": "分析棋谱库里还没分析的 {0} 局",
      "daily.game": "来一盘",
      "daily.rest": "没有欠账，也没有没练过的 —— 自由练习，或直接来一盘",
      "daily.begin": "这一节共 {0} 步，从头一步开始",
      "daily.done": "今日课毕",
      "daily.streak": "连续 {0} 天",
      "daily.planAria": "这一节的步骤",
      "daily.why.review": "到期的复习", "daily.why.mine": "你走错过的局面", "daily.why.weak": "战绩最弱的题型",
      "daily.why.lesson": "课程的下一课", "daily.why.op": "还没走熟的开局", "daily.why.game": "今天还没下过棋",
      "daily.why.motif": "反复出错的战术主题",
      "side.trend": "进步",
      "aria.trendAcc": "准确率走势",
      "tip.trendAcc": "最近分析过的对局的准确率，按时间排列",
      "trend.row": "本周正确率 {0} · 上周 {1}",
      "trend.rowNew": "本周正确率 {0}",
      "trend.rowPrev": "上周正确率 {0} · 本周还没答过",
      "trend.mines": "本周收 {0} · 找回 {1}",
      "pz.cat.real": "实战",
      "tip.real": "实战战术：20 子以上的中局，只有一步能得子",
      "pz.cat.def": "防守", "pz.cat.draw": "求和",
      "pz.smart": "为你出一题", "tip.puzzle.smart": "按你的复习欠账和错误率挑下一题",
      "pz.smart.review": "先清复习：还欠 {0} 题",
      "pz.smart.weak": "「{0}」是你错得最多的一类",
      "pz.smart.motif": "「{0}」是你反复错的母题 —— 来一道",
      "pz.line": "接下来", "pz.lineStart": "题面",
      "pz.smart.explore": "去还没怎么练过的「{0}」看看",
      "pz.smart.rated": "一道和你评级相当的题（{0}）", "pz.rating": "评级", "pz.ratingOf": "评级 {0}", "rec.rating": "做题评级", "rec.ratingRd": "±{0}", "aria.trendRating": "做题评级走势", "tip.trendRating": "最近 60 次首答后的评级",
      "rec.due": "复习到期 {0} · 明天 {1}",
      "study.part": "名局", "study.head": "读棋", "study.intro": "{0}，{1} 年 · {2} · 结果 {3}。用 ← → 逐着读，注释随着法出现；随时可以走别的着法试试。", "study.noNote": "（这一手没有注释）", "study.of": "第 {0} 手",
      "pz.smart.done": "全书都做完了 —— 没有可推荐的了",
      "side.puzzleTally": "做题战绩",
      "rec.tally": "解出 {0} · 失手 {1}",
      "rec.weakMark": "错得最多",
      "pz.side": "执方",
      "tip.opSide.w": "执白照谱走，黑方谱着自动应出",
      "tip.opSide.b": "执黑照谱应，白方谱着自动走出",
      "chrome.hint": "提示", "chrome.undo": "悔棋", "chrome.new": "新局",
      "chrome.answer": "答案", "chrome.thinking": "思考中",
      "side.game": "对局", "side.difficulty": "难度", "side.color": "执子",
      "side.clock": "棋钟", "side.sound": "音效",
      "look.appearance": "外观", "look.system": "跟随系统", "look.light": "浅色", "look.dark": "深色", "tip.look.appearance": "界面用浅色还是深色；跟随系统时随系统的深色模式切换", "look.board": "棋盘", "look.frame": "边框", "frame.flat": "平盘", "frame.frame": "木框", "tip.look.frame": "平盘：坐标写在格子里；木框：木质边框，坐标印在框上",
      "side.textSize": "字号", "text.s": "小", "text.m": "标准", "text.l": "大", "tip.textSize": "整个界面的文字大小",
      "side.pieces": "棋子样式", "pieces.cburnett": "标准", "pieces.merida": "梅里达", "pieces.chessnut": "栗子", "pieces.fantasy": "奇幻", "pieces.celtic": "凯尔特", "pieces.spatial": "立体", "pieces.classic": "经典",
      "side.coach": "失着提醒", "side.autoflip": "自动翻转", "side.language": "语言",
      "side.orientation": "棋盘方向",
      "side.moves": "棋谱", "side.stats": "统计", "side.ach": "成就",
      "learn.donePre": "完成 ", "learn.doneOf": "已完成的课数",
      "side.learn": "教学", "side.puzzle": "做题", "side.editor": "编辑局面",
      "mode.ai": "人机", "mode.pvp": "双人", "mode.learn": "教学", "mode.puzzle": "做题",
      "diff.groupSpar": "陪练档", "diff.groupEngine": "棋力档",
      "tip.diffEasy": "Stockfish UCI_Elo 1320（该选项的下限）", "tip.diffNormal": "Stockfish UCI_Elo 1700", "tip.diffHard": "Stockfish UCI_Elo 2200",
      "side.personaNote": "风格会让它偏离最优着法（最多约半个子），但不会送掉已经算到的杀",
      "ach.next": "下一个够得着的：", "ach.got": "已解锁", "ach.locked": "还差一点",
      "ach.more": "还有 {0} 个", "ach.less": "收起",
      "rec.emptyLead": "这一页记你下过的棋：战绩、每局的棋谱、十五个成就 —— 现在还空着，下面三件事，每件都开一个头。",
      "rec.goLearn": "上第 1 课", "rec.goPuzzle": "做一道战术题", "rec.goPlay": "和引擎下一局",
      "rec.unlocks": "解锁「{0}」", "rec.winUnlocks": "赢下来解锁「{0}」",
      "diff.beginner": "新手", "diff.easy": "初级", "diff.normal": "中级",
      "diff.casual": "休闲",
      "tip.casual": "比新手准一些，但还会犯错 —— 打赢新手之后的下一格",
      "diff.hard": "高级", "diff.extreme": "不限档",
      "color.white": "执白", "color.black": "执黑", "color.random": "随机", "ng.title": "新对局", "ng.endsCurrent": "会结束当前这盘", "ng.start": "开始", "ng.pvpColor": "下方执子",
      "clock.off": "无棋钟",
      "boardName.wood": "木", "boardName.green": "绿", "boardName.blue": "蓝", "boardName.paper": "纸墨", "boardName.marble": "大理石",
      "act.analyze": "分析", "act.deep": "精析", "act.stop": "停止", "act.retryHere": "从这里续下",
      "act.live": "持续分析", "tip.live": "引擎持续分析棋盘上的局面，跟随复盘游标", "an.depth": "深度", "an.win": "胜率", "an.line": "第 {0} 线",
      "msg.premove.set": "已预走 {0}", "msg.premove.dropped": "预走已失效",
      "act.pgnCopy": "复制", "act.export": "导出", "act.paste": "粘贴", "act.open": "打开",
      "act.fen": "FEN", "act.loadFen": "载入 FEN", "act.editor": "编辑",
      "act.offerDraw": "提和", "act.claimDraw": "判和", "act.resign": "认输",
      "act.clearSave": "清除存档", "act.reset": "重置", "act.clear": "清零",
      "act.close": "关闭",
      "act.cancel": "取消", "act.ok": "确定", "act.load": "载入", "act.start": "开始对局",
      "act.restart": "重来", "act.retry": "重试", "act.demo": "演示", "act.next": "下一课",
      "act.practice": "接着练 {0} 题",
      "act.puzzleRetry": "重做", "act.puzzleNext": "下一题",
      "turn.white": "白方走子", "turn.black": "黑方走子", "turn.check": "将军！",
      "vs.white": "白", "vs.black": "黑", "vs.p1": "玩家 1", "vs.p2": "玩家 2",
      "st.thinking": "引擎思考中…", "st.replay": "复盘", "st.mateWhite": "将死 · 白方胜",
      "st.mateBlack": "将死 · 黑方胜", "st.stalemate": "逼和 · 和棋",
      "st.insufficient": "子力不足 · 和棋", "st.drawAgreed": "协议和棋 · 和棋",
      "st.claimThreefold": "判和 · 三次重复", "st.claimFifty": "判和 · 50 回合无吃子无动兵",
      "st.autoFivefold": "五次重复 · 自动判和", "st.autoSeventyfive": "75 回合无进展 · 自动判和",
      "st.claimable": "可判和", "st.resignWhite": "白方认输 · 黑方胜", "st.resignBlack": "黑方认输 · 白方胜",
      "st.result10": "1-0 · 白方胜", "st.result01": "0-1 · 黑方胜", "st.resultDraw": "½-½ · 和棋",
      "st.flagDraw": "超时 · 和棋（对方无子力将杀）", "st.flagWhite": "超时 · 黑方胜", "st.flagBlack": "超时 · 白方胜",
      "st.editing": "编辑局面中", "st.editingReady": "可开始对局",
      "st.learn": "教学模式", "st.puzzle": "做题练习", "st.lessonDone": "课程完成", "st.puzzleDone": "解出 · 下一题",
      "ach.unlocked": "成就解锁",
      "brand": "国际象棋", "vs.player": "你",
      "stats.emptyHint": "人机对局分出胜负后，自动记在这里。",
      "stats.hint": "人机完局自动记录", "stats.hintAcc": " · 精准度来自「分析」",
      "stats.hintNoAcc": " · 完局后点「分析」可记录精准度",
      "stats.games": "共 ", "stats.gamesSuffix": " 局",
      "stats.recentAcc": "近 ", "stats.recentAccSuffix": " 局精准度", "stats.latest": "最近 ",
      "tipRun.analyze": "快速评估每一步（120ms/步），标注失着",
      "tipRun.stop": "停止分析（保留已算出的部分）",
      "tipRun.claimThreefold": "同一局面已第三次出现，可依规则判和",
      "tipRun.claimFifty": "已连续 50 回合无吃子无动兵，可依规则判和",
      "ach.first-lesson.n": "初学乍练", "ach.first-lesson.d": "完成第 1 课",
      "ach.all-lessons.n": "规则通关", "ach.all-lessons.d": "完成全部教学课程",
      "ach.first-puzzle.n": "初试身手", "ach.first-puzzle.d": "解出第 1 道题",
      "ach.puzzle-10.n": "战术之眼", "ach.puzzle-10.d": "累计解出 10 道题",
      "ach.puzzle-30.n": "熟能生巧", "ach.puzzle-30.d": "累计解出 30 道题",
      "ach.puzzle-75.n": "百炼成钢", "ach.puzzle-75.d": "累计解出 75 道题",
      "ach.all-mates.n": "杀法大师", "ach.all-mates.d": "解出全部杀王题",
      "ach.all-tactics.n": "战术行家", "ach.all-tactics.d": "解出全部战术母题",
      "ach.all-openings.n": "开局博士", "ach.all-openings.d": "背完全部开局线路",
      "ach.all-real.n": "实战眼", "ach.all-real.d": "解出全部实战战术题",
      "ach.first-win.n": "首胜", "ach.first-win.d": "人机对弈赢下第 1 局",
      "ach.win-10.n": "常胜将军", "ach.win-10.d": "人机累计胜 10 局",
      "ach.extreme-win.n": "屠龙", "ach.extreme-win.d": "在「极限」难度赢一局",
      "ach.veteran.n": "身经百战", "ach.veteran.d": "人机累计对局 50 局",
      "ach.completionist.n": "圆满", "ach.completionist.d": "解锁上面全部成就",
      // runtime messages (toasts, status fragments)
      "msg.engine.noMove": "引擎未能走子",
      "msg.engine.unavailable": "引擎不可用",
      "msg.replay.returnToLive": "请先回到最新一着",
      "msg.engine.noHint": "引擎未能给出提示",
      "msg.engine.bootFailed": "引擎没能启动 —— 人机对弈、提示和分析暂时用不了。可以重试；若仍不行，请复制诊断信息反馈。",
      "st.engineDown": "引擎没能启动",
      "side.white": "白方",
      "side.black": "黑方",
      "msg.export.cancelled": "已取消导出",
      "msg.export.done": "已导出 ",
      "msg.export.doneAt": "已导出到 ",
      "msg.export.inDownloads": " —— 在下载文件夹里",
      "msg.export.restrictedCopied": "导出受限，PGN 已复制到剪贴板",
      "msg.export.bridgeCopied": "文件对话框不可用 —— 内容已复制到剪贴板", "msg.export.tooLargeCopied": "文件太大，没有写入 —— 内容已复制到剪贴板", "msg.export.bridgeFailed": "文件对话框不可用，图片没有保存",
      "msg.import.empty": "没有可导入的内容",
      "msg.import.badPgn": "无法解析 PGN 棋谱",
      "msg.import.cancelled": "已取消导入",
      "msg.clipboard.readFailed": "无法读取剪贴板",
      "msg.file.readFailed": "无法读取文件",
      "msg.export.noGame": "还没有棋谱可导出",
      "msg.copy.noGame": "还没有棋谱可复制",
      "msg.analysis.noGame": "还没有对局可分析",
      "msg.copy.fenDone": "FEN 已复制",
      "msg.copy.pgnDone": "PGN 已复制（含对局标签）",
      "msg.copy.failed": "复制失败",
      "msg.stats.cleared": "统计已清零",
      "msg.save.cleared": "存档已清除",
      "msg.save.restored": "已恢复上次对局",
      "msg.analysis.doneClean": "分析完成 · 没有明显失着",
      "msg.analysis.donePrefix": "分析完成 · ",
      "msg.analysis.doneSuffix": " 处失着",
      "msg.analysis.stopped": "已停止分析",
      "msg.analysis.keptPrefix": "已停止分析 · 保留前 ",
      "msg.analysis.keptSuffix": " 步结果",
      "msg.analysis.deepStopped": "加深已停止，部分着法按快速扫描评级",
      "msg.draw.offerOnYourTurn": "轮到你走棋时才能提和",
      "msg.draw.offerTooEarly": "开局阶段引擎不接受提和",
      "msg.draw.offerSent": "已向引擎提和，评估中…",
      "msg.draw.offerDeclined": "引擎拒绝提和 —— 它觉得局面更好，继续下",
      "msg.draw.claimUnavailable": "当前不可判和 —— 需要三次重复或 50 回合无进展",
      "msg.over.flagged": "已超时 · 按 N 开新局",
      "msg.over.resigned": "本局已认输 · 按 N 开新局",
      "msg.over.drawAgreed": "本局已协议和棋 · 按 N 开新局",
      "msg.over.drawClaimed": "本局已判和 · 按 N 开新局",
      "msg.view.black": "黑方视角",
      "msg.view.white": "白方视角",
      "msg.sound.on": "音效已开",
      "msg.sound.off": "音效已关",
      "msg.coach.on": "失着提醒已开 · 严重失误时会提示悔棋",
      "msg.coach.off": "失着提醒已关",
      "msg.autoflip.on": "自动翻转已开 · 棋盘跟随走子方",
      "msg.autoflip.off": "自动翻转已关",
      "msg.fen.loaded": "已载入 FEN 局面",
      "msg.editor.started": "已按编辑的局面开始对局",
      "msg.editor.exited": "已退出编辑局面",
      "msg.editor.cancelled": "已取消编辑",
      "msg.editor.hint": "编辑局面 · 选一个棋子再点棋盘，点已有棋子可清除",
      "msg.editor.unavailable": "编辑器不可用",
      "msg.mode.needPlay": "请先切换到人机或双人模式",
      "msg.fen.empty": "请输入 FEN",
      "msg.fen.invalid": "FEN 不合法",
      "msg.import.donePrefix": "已导入 ",
      "side.persona": "陪练风格",
      "persona.off": "标准", "persona.greedy": "贪吃子",
      "persona.principled": "重原则", "persona.attacker": "爱进攻",
      "msg.side.whiteChosen": "执白 · 白方视角",
      "msg.side.blackChosen": "执黑 · 黑方视角",
      "tip.slots": "存档槽：保存或读取多局棋",
      "learn.lessonPre": "第 ", "learn.lessonPost": " 课",
      "act.slots": "存档槽", "slots.title": "存档槽",
      "slots.hint": "点存档槽读取，或用「保存到此槽」写入当前对局",
      "slots.empty": "空槽", "slots.save": "保存到此槽", "slots.delete": "删除",
      "slots.saved": "已保存到存档槽 ", "slots.loaded": "已读取存档槽 ", "slots.deleted": "已删除存档槽 ",
      "slots.nothing": "当前没有可保存的对局", "slots.slot": "槽 ",
      "act.playOn": "接实战", "tip.playOn": "从这个开局局面接着与引擎对弈",
      "act.drillSource": "看那局棋", "tip.drillSource": "打开这道题挖出来的那一局，停在那一手",
      "pz.playOn": "接实战 · {0} —— 从这个局面继续与引擎对弈",
      "opc.hangs": "这步把{0}送掉了 —— 对方可以 {1}",
      "opc.kingMove": "王一动就再也不能王车易位 —— 开局先把王送进安全的角落",
      "opc.earlyQueen": "后出得太早 —— 对方每出一个子都能顺手打她，你反倒落后",
      "opc.samePiece": "同一个子在开局连动两次 —— 先把还没出动的子力调出来",
      "opc.castle": "该给王安家了 —— 王车易位是开局的头等大事",
      "opc.develop": "先出子 —— 马和象要尽早离开底线，推兵可以稍后",
      "opc.centre": "争中心 —— 中央的兵和格子决定之后所有子力的活动空间",
      "opc.edgePawn": "边兵既不争中心也不放子力出来 —— 开局别在这上面花步数",
      "opc.sound": "这一步本身不坏 —— 只是这条谱走的是另一路，先照谱走完，再自由发挥",
      "opc.generic": "这不是谱着 —— 开局只做三件事：出子、控中心、王入安全",
      "act.groupReview": "复盘", "act.groupFile": "棋谱与局面", "act.groupGame": "本局",
      "act.more": "更多", "act.less": "收起",
      "mat.takenW": "白方已吃掉的子", "mat.takenB": "黑方已吃掉的子",
      "tab.play": "对局", "tab.setup": "设置",
      // v8-0-plan A1: the rail, the home page, the preferences window
      "nav.aria": "主导航", "nav.home": "首页", "nav.play": "下棋",
      "nav.puzzle": "谜题", "nav.learn": "学习", "nav.library": "棋谱库",
      "nav.me": "我的", "nav.prefs": "偏好", "tip.prefs": "偏好设置（Ctrl 或 ⌘ 加逗号）",
      "prefs.title": "偏好设置", "prefs.look": "外观", "prefs.langSound": "语言与声音", "side.display": "显示",
      "ng.mode": "对手", "home.continue": "继续上次", "home.next": "下一步建议",
      "home.cont.go": "继续", "home.cont.learn": "上次在上课", "home.cont.puzzle": "上次在做题",
      "home.cont.live": "{0}对局进行中 · 第 {1} 回合", "home.cont.over": "上一盘已经下完", "home.cont.review": "看这盘",
      "home.cont.none": "棋盘上还没有对局", "home.daily.go": "开始", "home.next.lesson": "下一课：第 {0} 课 · {1}",
      "home.next.learn": "去上课", "home.next.review": "有 {0} 道错题到了复习的时候", "home.next.smart": "按你的弱项挑一道题",
      "aria.tabs": "面板分区",
      // 7.0 棋谱库
      "lib.title": "棋谱库", "lib.import": "导入棋谱文件", "lib.diagnose": "看诊断",
      "pz.repBook": "书上走的是 {0}",
      "rep.title": "我的开局书", "rep.importW": "导入执白开局书", "rep.importB": "导入执黑开局书",
      "rep.drill": "开始背", "rep.clear": "清空", "rep.count": "{0} 条",
      "rep.empty": "还没有你自己的开局书：导入一份带变着的 PGN，每一条变着都是一道题。",
      "rep.lines": "书里的线", "rep.bySide": "执白 {0} · 执黑 {1}", "rep.learnt": "背下来 {0}/{1}",
      "rep.gapsTitle": "你下过、书里却没有的开局：",
      "rep.gapRecord": "{0} 局 · 输 {1}",
      "rep.added": "进书 {0} 条（{1} 条已经在里面了）", "rep.addedNone": "这 {0} 条书里都已经有了",
      "rep.dropped": "上限 {0} 条，最早进来的 {1} 条退了出去",
      "rep.clearAsk": "清空自己的开局书？背过的进度也会跟着没有。", "rep.clearTitle": "清空开局书",
      "rep.skippedSetUp": "跳过 {0} 局：开局书是从起始局面开始的一串着法，那几局从别的局面开始",
      "rep.badGames": "{0} 局读不懂，跳过了；其余的照常进书",
      "rep.clearOk": "清空", "rep.cleared": "开局书已清空", "rep.unnamed": "自己的线",
      "pz.cat.rep": "开局书", "tip.cat.rep": "我的开局书：背你自己导进来的那套开局，走偏了当场告诉你书上走什么",
      "lib.names": "你在棋谱里的名字",
      "lib.namesHint": "用逗号分隔多个账号名；大小写不论。认不出来的棋局会照样留着，只是不算进「你的」数字里。",
      "lib.empty": "导入你在别处下的棋，攒够二十局分析就给一份诊断。",
      "lib.count": "{0} 局", "lib.claimed": "认出是你的 {0} 局", "lib.analysed": "已分析 {0} 局",
      "lib.queued": "待分析 {0} 局",
      "lib.analyse": "分析剩下的 {0} 局", "lib.pause": "暂停分析",
      "lib.analyseEta": "分析剩下的 {0} 局（约 {1}）", "lib.etaMin": "{0} 分钟", "lib.etaHour": "{0} 小时",
      "lib.working": "正在分析第 {0}/{1} 局 · {2}",
      "lib.added": "收进 {0} 局，重复的 {1} 局跳过了", "lib.addedNone": "这个文件里的 {0} 局全都已经在库里了",
      "lib.dropped": "库满 {0} 局，最早导入的 {1} 局被挤出去了",
      "lib.noneClaimed": "一局都没认出是你下的 —— 在上面填上你在棋谱里的名字",
      "lib.needMore": "还差 {0} 局才够给诊断（已分析 {1}/{2}）",
      "lib.busy": "引擎正忙，等这轮分析完再导",
      "lib.all": "全部 {0} 局", "lib.listTitle": "棋谱库",
      "lib.bySort": "排序", "lib.sortNew": "最近导入", "lib.sortWorst": "我下得最差",
      "lib.listHint": "点一局载入棋盘 —— 分析结果一起带过去，引擎不会重跑一遍。",
      "lib.clearPick": "清除筛选",
      "lib.rowAcc": "精准度 {0}%", "lib.rowBad": "{0} 处失误",
      "lib.rowPending": "还没分析", "lib.rowUnplayable": "着法重放不出来",
      "lib.unknownFoe": "对手不详", "lib.loaded": "已从棋谱库载入 · {0}",
      "lib.minedDone": "分析了 {0} 局，收进错题 {1} 道",
      "lib.unplayable": "{0} 局的着法重放不出来，跳过了（棋谱本身有问题，不是分析失败）",
      "lib.deepen": "再深一遍", "tip.libDeepen": "用 400 毫秒重新分析这一局（原本是 200），并据此修正它挖出来的错题",
      "lib.deepable": "{0} 局是 200 毫秒快扫出来的，可以再深一遍",
      "lib.deepWorking": "正在深分析 {0} …… {1}",
      "lib.deepDone": "{0} 深分析完：撤销 {1} 道、改答 {2} 道、新增 {3} 道",
      "lib.deepCut": "这一局没分析完，原来的分析原样留着",
      "lib.passCut": "引擎两次都没给出评估，分析先停在这里；没分析完的那一局原样留着",
      "diag.title": "棋谱库诊断",
      "diag.from": "{0} 局已分析的棋，全部从你这一边读",
      "diag.record": "战绩", "diag.wld": "{0} 胜 {1} 负 {2} 和",
      "diag.acc": "平均精准度", "diag.phase": "分阶段", "diag.phaseOpening": "开局（前 {0} 回合）",
      "diag.phaseMiddle": "中局", "diag.phaseEnd": "残局",
      "diag.acpl": "{0} 厘兵/手", "diag.badRate": "失误率 {0}%",
      "diag.weakest": "该练的是{0} —— 这一段每手平均亏 {1} 厘兵，比你最好的那一段多亏 {2}。",
      "diag.noWeakest": "三个阶段差不多，没有哪一段明显拖后腿。",
      "diag.peak": "失误最密集的是第 {0} 回合，{1} 局里栽在这里。",
      "diag.motifs": "栽在哪些战术上", "diag.motifN": "{0} 次",
      "diag.ecos": "开局战绩", "diag.ecoRow": "{0} 局 · 得分率 {1}%",
      "diag.openThese": "点开这些棋局",
      "diag.chartTop": "上限 {0}",
      "diag.peakRange": "这张图覆盖第 {0}–{1} 回合，最高的一根是 {2} 局。",
      "diag.legendWin": "胜", "diag.legendDraw": "和", "diag.legendLoss": "负",
      "diag.chartPhase": "开局、中局、残局各自每手亏多少厘兵",
      "diag.chartPeak": "失误落在第几回合的分布",
      "diag.chartEco": "每个开局的胜、和、负",
      "diag.pickMotif": "只看被「{0}」打中的那些局",
      "diag.pickEco": "只看 {0} 的那些局",
      "diag.pickPeak": "只看在第 {0} 回合栽过的那些局",
      "hist.title": "对局历史", "hist.all": "全部 {0} 局", "hist.open": "查看全部对局历史",
      "hist.empty": "还没有下完的人机对局。",
      "hist.hint": "点一局载入棋盘复盘：可跑「分析」看回顾报告、导出 PGN、另存到存档槽",
      "hist.win": "胜", "hist.loss": "负", "hist.draw": "和",
      "hist.white": "执白", "hist.black": "执黑",
      "hist.any": "全部", "hist.byResult": "按结果筛选", "hist.byColor": "按执子筛选",
      "keys.title": "快捷键",
      "keys.panel": "开合侧栏", "keys.new": "新局", "keys.undo": "悔棋",
      "keys.hint": "引擎提示", "keys.flip": "翻转棋盘",
      "keys.step": "翻棋谱：上一手 / 下一手（光标模式里是移动光标）", "keys.ends": "翻棋谱：回到开局 / 跳到最新（光标模式里是跳到角上）",
      "keys.tab": "在界面控件之间移动焦点（浏览器行为，本应用不占用）",
      "keys.esc": "关闭对话框、退出编辑器、收起侧栏",
      "keys.prefs": "打开偏好设置（macOS 用 ⌘，其余用 Ctrl）",
      "keys.help": "打开这份快捷键表",
      "keys.promo": "升变时选后 / 车 / 象 / 马",
      "keys.board": "棋盘光标模式：Tab 移到棋盘或按回车进入；方向键移动光标，回车选子与落子，Esc 退出",
      "keys.retry": "重做当前这题",
      "keys.next": "下一题", "keys.lessonHint": "本课提示", "keys.answer": "看答案",
      "hist.noneMatch": "没有符合条件的对局", "hist.showing": "符合条件 {0} 局，共 {1} 局",
      "hist.acc": "精准度 {0}%", "hist.today": "今天", "hist.yesterday": "昨天",
      "hist.loaded": "已载入历史对局 · {0}",
      "hist.pgn": "PGN", "hist.pgnCopied": "已复制该局 PGN",
      "dlg.loadHist": "载入这局历史对局将替换当前对局，是否继续？",
      "dlg.loadHistTitle": "载入历史对局", "dlg.loadHistOk": "载入",
      "dlg.loadLib": "从棋谱库载入这一局将替换当前对局，是否继续？",
      "dlg.loadLibTitle": "载入棋谱库对局", "dlg.loadLibOk": "载入",
      "pz.tier": "难度", "pz.all": "全部", "pz.easy": "简单", "pz.mid": "中等", "pz.hard": "较难",
      "pz.noneInTier": "该难度下暂无题目",
      "pz.fromLesson": "接着练：{0}",
      "pz.tierCleared": "难度筛选已清空，好让这道题显示出来",
      "edErr.pawnBackRank": "兵不能停在第 1 或第 8 横线",
      "edErr.noWhiteKing": "白方必须有且只有一个王", "edErr.manyWhiteKings": "白方有多个王",
      "edErr.noBlackKing": "黑方必须有且只有一个王", "edErr.manyBlackKings": "黑方有多个王",
      "edErr.invalid": "局面不合法", "edErr.otherInCheck": "轮到走子的一方之外不能处于被将军状态",
      "edErr.alreadyMate": "该局面已经将死，无法开局", "edErr.alreadyStalemate": "该局面已经逼和，无法开局",
      "ed.ep": "吃过路兵格", "ed.epNone": "无",
      "ed.eraser": "橡皮：点格子清除棋子",
      "ed.hint": "选棋子 → 点棋盘", "ed.turn": "轮到", "ed.castling": "易位权",
      "ed.clear": "清空棋盘", "ed.reset": "初始局面",
      "ed.white": "白方", "ed.black": "黑方",
      "ed.crK": "白 O-O", "ed.crQ": "白 O-O-O", "ed.crk": "黑 O-O", "ed.crq": "黑 O-O-O",
      "fen.title": "载入 FEN 局面", "fen.fromClip": "从剪贴板粘贴",
      "hint.analysis": "分析后曲线可点击跳转 · ?! 小失误 · ? 失误 · ?? 严重失误",
      "acc.label": "精准度",
      "live.focused": "棋盘已聚焦", "live.empty": "空格", "live.selected": "已选中",
      "live.targets": "个落点", "live.cleared": "已取消选择", "live.start": "回到开局",
      "piece.p": "兵", "piece.n": "马", "piece.b": "象", "piece.r": "车", "piece.q": "后", "piece.k": "王",
      // tooltips (generated alongside index.html's data-i18n-title attributes)
      "tip.diff.extreme": "不限制棋力等级 —— 仍是每步 1.2 秒，不是无限时间",
      "tip.cat.m1": "一步将死",
      "tip.claimDraw": "三次重复或 50 回合无进展时可判和",
      "tip.cat.m3": "三步将死（双车赶王）",
      "tip.replay.prev": "上一着 （←）",
      "tip.replay.next": "下一着 （→）",
      "tip.puzzle.next": "下一道未解的题 （N）",
      "tip.clock.off": "不限时",
      "tip.mode.ai": "与 Stockfish 引擎对弈",
      "tip.cat.m2": "两步将死（含引子与静着）",
      "tip.fen.load": "从 FEN 载入局面",
      "tip.pgn.paste": "从剪贴板粘贴 PGN",
      "tip.diff.beginner": "会主动犯错的陪练，适合教学毕业第一局",
      "tip.panel.toggle": "侧栏 （P）",
      "tip.promote.q": "升变为后 （Q）",
      "tip.promote.b": "升变为象 （B）",
      "tip.promote.r": "升变为车 （R）",
      "tip.promote.n": "升变为马 （N）",
      "tip.mode.pvp": "双人同屏对弈",
      "tip.cat.win": "吃子战术：选出净得子力最多的一吃",
      "tip.editor.reset": "回到初始局面",
      "tip.retryHere": "回到复盘所在的一着继续下，其后着法留作变着",
      "tip.cat.review": "复习：重做答错或看过答案的题，做对即移出",
      "tip.pgn.copy": "复制 PGN（含标准对局标签）",
      "tip.fen.copy": "复制当前局面 FEN",
      "tip.replay.start": "开局 （Home）",
      "tip.cat.op": "开局练习：照谱走主流开局，执白执黑都能练",
      "tip.hint": "引擎提示 （H）",
      "tip.analysis.run": "快速评估每一步（120ms/步），标注失着",
      "tip.undo": "悔棋 （Z）",
      "tip.cat.tac": "战术母题：串击/闪将/牵制/捉双 —— 强制得子",
      "tip.pgn.open": "打开 PGN 文件（也可直接拖入窗口）",
      "tip.color.white": "执白先行",
      "tip.color.black": "执黑后行",
      "tip.offerDraw": "提议和棋（双人：双方确认；人机：引擎按局面判断）",
      "tip.editor.open": "摆出任意局面再开始对局",
      "tip.newGame": "新局 （N）",
      "tip.puzzle.answer": "标出当前一步的正解 （H）",
      "tip.clock.10": "每方 10 分钟",
      "tip.clock.3": "每方 3 分钟",
      "tip.clock.3plus2": "每方 3 分钟，每步加 2 秒",
      "tip.clock.5": "每方 5 分钟",
      "tip.clock.5plus3": "每方 5 分钟，每步加 3 秒",
      "tip.autoflip": "每步走完后棋盘转向走子方",
      "tip.analysis.deep": "深度评估每一步（400ms/步），更准但更慢",
      "tip.learn.reset": "清空教学进度，从第一课重新开始",
      "tip.editor.clear": "清空棋盘",
      "tip.evalCurve": "点击跳转到对应局面",
      "tip.accuracy": "按每一步的胜率变化换算，与在线平台的「准确率」同一口径",
      "tip.replay.end": "终局 （End）",
      "tip.flip": "翻转棋盘 （F）",
      "tip.resign": "认输并结束本局",
      "tip.coach": "走出严重失误时提示悔棋重想",
      "tip.cat.def": "防守：黑方下一步就要将死，找出接得住的一手",
      "tip.cat.draw": "求和：已经必败，逼成僵局或长将保住半分",
      "tip.persona.off": "不加风格，引擎按难度正常发挥",
      "tip.persona.greedy": "见子就吃，会主动踩进你的捉双和牵制",
      "tip.persona.principled": "按开局三原则出子：抢中心、快出轻子、尽早易位",
      "tip.persona.attacker": "子力一直往你的王那边压（实测每一手都落在你王三格以内），练防守用",
      "tip.sound": "走子音效",
      "tip.lesson.next": "进入下一课",
      "tip.lesson.practice": "去做同一母题的题目，课上只练了一次",
      "tip.lesson.restart": "重做本课任务 （R）",
      "tip.puzzle.retry": "重新开始本题 （R）",
      "tip.lesson.demo": "重看本任务的走法演示",
    },
  };

  const FALLBACK = FALLBACK_LANG;
  let lang = FALLBACK;

  /**
   * The dictionary for `id`, or null while its chunk has not arrived.
   *
   * v8-0-plan F5: only the Chinese source is in the bundle. English and
   * Japanese come in js/chunk-lang-*.js, which put CHESS_I18N_EN / _JA on the
   * window — usually before this module runs at all (chunk-boot.js loads the
   * saved language's chunk ahead of bundle.js), otherwise when the app asks
   * for it (lazy-content.js ensureLang). Adopted into DICT the first time it
   * is seen, so every reader of DICT sees the same table.
   */
  function dict(id) {
    if (!DICT[id] && id !== FALLBACK && LANG_IDS.includes(id)) {
      const got = globalThis["CHESS_I18N_" + id.toUpperCase().replace(/-/g, "_")];
      if (got) DICT[id] = got;
    }
    return DICT[id] || null;
  }
  for (const id of LANG_IDS) dict(id);

  function available() {
    return LANG_IDS.map((id) => ({ id, name: LANG_NAMES[id] }));
  }

  /**
   * Any known language is accepted whether or not its dictionary is here:
   * a saved "en" read before the chunk arrives must stay "en", or the next
   * saveSettings() would write the player's choice away. t() falls back to
   * the Chinese key by key meanwhile, as it always has for a missing string.
   */
  function setLang(id) {
    lang = LANG_IDS.includes(id) ? id : FALLBACK;
    return lang;
  }

  function getLang() { return lang; }

  /** Is `id`'s dictionary here? (v8-0-plan F5) */
  function hasLang(id) { return !!dict(id); }

  /** First-run guess from the system locale — lang-ids.js, shared with chunk-boot.js. */
  function detectLang(nav) { return detectFrom(nav); }

  function t(key) {
    const table = dict(lang) || DICT[FALLBACK];
    if (key in table) return table[key];
    const base = DICT[FALLBACK];
    return key in base ? base[key] : key;
  }

  /**
   * Translate with positional substitution: `{0}`, `{1}`, … are replaced by
   * `vals` in order. Sentences that splice in a value need this rather than
   * string concatenation — word order is not the same in every language, and
   * a concatenated "还不是将死 —— 黑方可走 " + move cannot be rendered as
   * "Not mate yet — Black escapes with " + move without hard-coding it.
   * @param {string} key
   * @param {Array} vals
   */
  /**
   * t() with values spliced in. `{0}` is the value; `{0:move|moves}` is the
   * value followed by the word for its count — the branch is chosen with
   * Intl.PluralRules for the current language (6.0, v6-plan Q3.6), so
   * English stops saying "1 moves" while Chinese and Japanese, which do not
   * inflect, simply never use the form.
   */
  const pluralRules = {};
  function pluralOf(n) {
    try {
      if (!pluralRules[lang]) pluralRules[lang] = new Intl.PluralRules(lang);
      return pluralRules[lang].select(Number(n));
    } catch (_) { return Number(n) === 1 ? "one" : "other"; }
  }
  function tf(key, vals) {
    const s = t(key);
    return s.replace(/\{(\d+)(?::([^|}]*)\|([^}]*))?\}/g, (m, i, one, other) => {
      const v = vals && vals[Number(i)];
      const text = v === undefined || v === null ? "" : String(v);
      if (one === undefined) return text;
      return text + " " + (pluralOf(v) === "one" ? one : other);
    });
  }

  /** A date or time in the app's language, not the system's (6.0). */
  function fmtDate(ts, opts) {
    try { return new Date(ts).toLocaleString(lang, opts || { dateStyle: "short" }); }
    catch (_) { return new Date(ts).toLocaleString(); }
  }

  /**
   * Apply translations to every annotated node in `root`:
   * `data-i18n` → text, `data-i18n-title` → tooltip, `data-i18n-aria` →
   * aria-label. The aria pass matters as much as the visible one: an
   * untranslated aria-label is a screen-reader user hearing the wrong
   * language, which is invisible to anyone testing by eye.
   */
  function apply(root) {
    const scope = root || (typeof document !== "undefined" ? document : null);
    if (!scope) return;
    scope.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    scope.querySelectorAll("[data-i18n-title]").forEach((el) => {
      el.setAttribute("title", t(el.getAttribute("data-i18n-title")));
    });
    scope.querySelectorAll("[data-i18n-aria]").forEach((el) => {
      el.setAttribute("aria-label", t(el.getAttribute("data-i18n-aria")));
    });
    // 6.0: the comment box is the first field with a placeholder worth translating
    scope.querySelectorAll("[data-i18n-placeholder]").forEach((el) => {
      el.setAttribute("placeholder", t(el.getAttribute("data-i18n-placeholder")));
    });
  }

  export const ChessI18n = { t, tf, fmtDate, apply, setLang, getLang, hasLang, detectLang, available, DICT };
