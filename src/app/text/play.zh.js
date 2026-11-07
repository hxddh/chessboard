/** 下 — the play screen and the review on the board, in Chinese. Keys are semantic; {0} {1} are arguments. */
export default {
  // the shell around the pages (main.js, index.html) and the board's name for screen readers
  "app.title": "国际象棋", "nav.aria": "主导航", "nav.learn": "学", "nav.play": "下", "nav.me": "我", "nav.settings": "设置",
  "app.loadFailed": "页面加载失败：{0}", "board.aria": "棋盘",

  // opponents: names and lines are opponents/lines.zh.js
  "opp.thinking": "在想", "new.weaker": "弱一点的对手", "new.stronger": "强一点的对手",
  "side.you": "你", "side.w": "白方", "side.b": "黑方",

  // the context bar while playing
  "bar.yourTurn": "轮到你", "bar.theirTurn": "{0}在想…", "bar.toMove": "{0}走棋", "bar.check": "将军！",
  "bar.viewing": "在看第 {0} 步", "bar.live": "回到当前",
  "act.hint": "提示", "act.draw": "和棋", "act.resign": "认输", "act.moves": "着法", "act.new": "新对局",
  "act.cancel": "取消", "act.confirmResign": "认输", "act.offerDraw": "提和", "act.claimDraw": "要求和棋",
  "confirm.resign": "确定认输吗？", "confirm.draw": "向对手提和？", "confirm.claim": "可以要求和棋：{0}。",
  "claim.threefold": "同一局面出现了三次", "claim.fifty": "五十步内没有吃子和走兵",
  "draw.declined": "{0}没有接受和棋，接着下。", "draw.thinking": "{0}在考虑…",
  "act.undo": "悔棋", "act.flip": "翻转", "act.flipKey": "翻转棋盘（F）",
  "undo.unrated": "悔了棋，这盘不计入等级分。",

  // the coach before a move (P2)
  "coach.ask": "等一下——对方在威胁什么？", "coach.rethink": "再想想", "coach.play": "就走这步",
  "coach.checking": "…",

  // layered hints (P3)
  "hint.threat": "先看对方在威胁什么：{0}", "hint.threatMate": "对方想走 {0}，那是杀棋。",
  "hint.threatPiece": "对方想走 {0}，吃掉你的{1}。", "hint.threatCheck": "你被将军了，先应将。",
  "hint.noThreat": "对方现在没有直接的威胁。",
  "hint.forcing": "再看你的将军和吃子：{0}", "hint.noForcing": "你没有将军或吃子；想想哪个子还没出动。",
  "hint.idea": "这里的想法：{0}", "hint.ideaMate": "这里有杀棋", "hint.ideaCapture": "吃子得利",
  "hint.ideaCheck": "将军，逼对方应", "hint.ideaQuiet": "改善一个子的位置",
  "hint.move": "走 {0}", "hint.wait": "让我想一下…", "act.hintMore": "再提示",

  // the end of a game
  "res.win": "你赢了", "res.loss": "你输了", "res.draw": "和棋", "res.white": "白方胜", "res.black": "黑方胜",
  "reason.checkmate": "将死", "reason.stalemate": "逼和", "reason.insufficient": "子力不足", "reason.fivefold": "五次重复",
  "reason.seventy-five": "七十五步", "reason.resign": "认输", "reason.timeout": "超时", "reason.timeoutDraw": "超时，但对方子力不足",
  "reason.agreement": "协议和棋", "reason.threefold": "三次重复", "reason.fifty": "五十步",

  // the new game sheet
  "new.title": "新对局", "new.opponent": "对手", "new.color": "执", "new.clock": "用时", "new.coach": "落子前提醒",
  "new.start": "开始", "color.w": "白", "color.random": "随机", "color.b": "黑", "clock.none": "不计时",

  // promotion
  "promo.title": "升变为",

  // the move list drawer and the report
  "drawer.title": "着法", "drawer.first": "回到开头", "drawer.prev": "上一步", "drawer.next": "下一步", "drawer.last": "最后一步",
  "report.title": "完整报告", "report.accuracy": "准确度 {0}", "report.copy": "复制棋谱", "toast.copied": "已复制",

  // the review on the board (P5)
  "rv.waiting": "还在看这盘的其余部分，好了就接着下一处…", "rv.running": "复盘中… {0}/{1}", "rv.card": "第 {0} 回合，你走了 {1}（{2}）。", "rv.cardOf": "{0}/{1}",
  "rv.tryAgain": "这里有更好的一步，再想想？", "rv.answer": "看答案", "rv.next": "下一处", "rv.finish": "完成",
  "rv.report": "完整报告", "rv.same": "这就是对局里那一步。", "rv.right": "对了！{0} 是这里最好的一步。",
  "rv.alsoGood": "{0} 也可以。引擎最喜欢的是 {1}。", "rv.wrong": "{0} 也不好：{1}", "rv.wrongPlain": "{0} 也不好，再想想。",
  "rv.checking": "看看 {0}…", "rv.ruleMate": "对方 {0} 就杀棋了", "rv.rulePiece": "对方 {0} 吃掉你的{1}", "rv.better": "更好的是 {0}。", "rv.done": "复盘完成。", "rv.clean": "这盘没有需要回看的地方。",
  "rv.noEngine": "这次没能复盘：{0}",
  "grade.blunder": "严重失误", "grade.mistake": "失误", "grade.miss": "错失良机", "grade.inaccuracy": "小失误",
  "grade.brilliant": "妙着", "grade.only": "仅此一着", "grade.best": "最佳", "grade.excellent": "优秀", "grade.good": "良好", "grade.book": "谱着",
};
