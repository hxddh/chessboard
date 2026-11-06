/**
 * The explainer's sentences (core/explain.js), in Chinese — one dictionary
 * merged into every page's (text/play.js, text/learn.js), so a move is
 * explained the same way wherever it is played. Keys are the same in every
 * language; en and ja are one more module each. {0} {1} … are moves (SAN),
 * pieces (piece.*), squares and motifs, in the order the explainer gives them.
 * @module text/explain.zh
 */
export default {
  // —— 19.0 的句子（战术与子力）——
  "ex.mate1": "有 {0} 一步杀没走", "ex.mateN": "有 {0} 起的 {1} 步杀没走",
  "ex.allowsMate": "让对方有 {0} 起的 {1} 步杀", "ex.allowsMate1": "让对方 {0} 一步杀",
  "ex.motifLoss": "漏看了 {0} {1}，丢{2}", "ex.motif": "漏看了 {0} {1}", "ex.forkHits": "漏看了 {0} {1}，同时攻击{2}和{3}",
  "ex.loss": "对方 {0} 之后丢{1}", "ex.betterMotif": "更好的是 {0}（{1}）", "ex.better": "更好的是 {0}",
  "ex.betterWins": "更好的是 {0}，能赢下对方一个{1}", "ex.mate1Motif": "有 {0} 一步杀没走（{1}）",
  "ex.mateNMotif": "有 {0} 起的 {1} 步杀没走（{2}）", "ex.threatMate": "没防住对方 {0} 一步杀的威胁",
  "ex.allowsMate1Motif": "让对方 {0} 一步杀（{1}）", "ex.allowsMateMotif": "让对方有 {0} 起的 {1} 步杀（{2}）",
  "ex.threatHanging": "没理会对方 {0} 的威胁，{1}没有保护住", "ex.perpetual": "让对方 {0} 起长将",
  "ex.hanging": "漏看了 {0}，{1}没有保护住", "ex.betterHanging": "更好的是 {0}，吃掉没有保护住的{1}",
  "ex.hangingCheap": "漏看了 {0}，{2}吃{1}，换不回来", "ex.threatCheap": "没理会对方 {0} 的威胁，{2}吃{1}，换不回来",
  "ex.betterCheap": "更好的是 {0}，{2}吃{1}，净赚子力",
  "motif.fork": "捉双", "motif.pin": "牵制", "motif.skewer": "串击", "motif.discovered": "闪将", "motif.double": "双将",
  "motif.hanging": "挂着的子", "motif.backRank": "底线杀", "motif.mateThreat": "杀棋威胁", "motif.trapped": "困子",
  "motif.removeDefender": "消除保护", "motif.overload": "过载", "motif.deflection": "引离", "motif.decoy": "引入",
  "motif.xray": "X 光", "motif.zwischenzug": "中间着", "motif.desperado": "绝望子", "motif.promotion": "升变",
  "motif.perpetual": "长将", "motif.discoveredAttack": "闪击",
  "piece.p": "兵", "piece.n": "马", "piece.b": "象", "piece.r": "车", "piece.q": "后", "piece.k": "王",

  // —— v2：你这一步漏了什么、松了什么 ——
  "ex.threatFree": "没理会对方 {0} 的威胁：你的{1}没有保护", "ex.threatTake": "没理会对方 {0} 的威胁：你的{1}守不住，换下来亏子",
  "ex.movedFree": "{0} 走到了没有保护的格子，{1}会被白吃", "ex.movedTake": "{0} 之后你的{1}守不住：对方用{2}去吃，换下来你亏子",
  "ex.unguarded": "你的{0}走开后，{1} 的{2}就没人保护了", "ex.looseAfter": "{0} 之后，{1} 的{2}没有保护住",
  "ex.overloaded": "你的{0}负担过重：既要保护{1}又要保护{2}，对方 {3} 就抓住了这一点",
  "ex.replyThreat": "对方 {0} 之后威胁吃你的{1}", "ex.replyTwo": "对方 {0} 之后同时攻击你的{1}和{2}",
  "ex.replyCombo": "对方 {0}，你 {1} 之后，{2} 吃掉你的{3}", "ex.replyMate": "对方 {0} 之后威胁 {1} 杀棋",
  "ex.reply2Threat": "对方先走 {0}，再走 {1}，就威胁吃你的{2}", "ex.reply2Mate": "对方先走 {0}，再走 {1}，就威胁 {2} 杀棋",
  "ex.betterParries": "更好的是 {0}，先解除对方 {1} 的威胁", "ex.betterThreat": "更好的是 {0}，它威胁吃掉对方的{1}",
  "ex.betterThreatMate": "更好的是 {0}，它威胁 {1} 杀棋", "ex.betterTakesFree": "更好的是 {0}，吃掉没有保护住的{1}", "ex.betterTakes": "更好的是 {0}：对方的{1}守不住，吃下来净赚",
  "ex.betterCombo": "更好的是 {0}：对方 {1} 之后，{2} 吃掉{3}",
  "ex.betterTwo": "更好的是 {0}，同时攻击对方的{1}和{2}",
  // —— v2：局面（只在引擎评估也明显变化时说）——
  "ex.pos.shelter": "{0} 动了王前的兵，王的掩护变弱了", "ex.pos.openFile": "{0} 让{1}对着你的王打开了",
  "ex.pos.isolated": "{0} 之后，{1} 兵成了孤兵", "ex.pos.doubled": "{0} 之后，你在{1}线上成了叠兵",
  "ex.pos.backward": "{0} 之后，{1} 兵成了落后兵", "ex.pos.passed": "{0} 让对方的 {1} 兵成了通路兵",
  "ex.pos.outpost": "{0} 之后，对方的马有了一个赶不走的前哨 {1}", "ex.pos.bishopPair": "{0} 用象换了马，双象给了对方", "ex.pos.badBishop": "{0} 把兵放在象的同色格上，象被自己的兵堵住了",
  "ex.file": "{0} 线", "ex.mateWord": "将死",
  // —— v2：课、残局、名局、开局 ——
  "ex.stalemate": "{0} 之后对方没有被将军，却一步也走不了 —— 这是逼和", "ex.notMate": "{0} 是将军，但对方可以走 {1}",
  "ex.noCheckMate": "{0} 没有将军，不可能是将死", "ex.noCheck": "{0} 没有将军", "ex.noCapture": "{0} 没有吃子",
  "ex.lostOpposition": "你让出了对王：{0} 之后，对方走 {1} 和你的王正面相对，只能和棋了",
  "ex.missedOpposition": "你让出了对王：{0} 之后只能和棋，{1} 才能和对方的王隔奇数格相对",
  "ex.pushedEarly": "{0} 推兵太早：王还没站到兵的前面，现在只能和棋了", "ex.lostWin": "{0} 之后只能和棋了",
  "ex.square": "{0} 没有推兵：对方的王走进了兵的方块，{1} 本来能跑到底",
  "ex.left7th": "{0}：车离开了第七横线", "ex.leftBehindMine": "{0}：车离开了你的通路兵 {1} 的后面",
  "ex.leftBehindTheirs": "{0}：车不再从后面看住对方的通路兵 {1}",
  "ex.offBook": "{0} 离开了你的开局书，常见的是 {1}",
  "ex.natural": "{0} 分的人这里也常这样走（约 {1}）—— 这是一个很自然的错", "ex.people": "{0} 分的人这里常走 {1}", "ex.peopleToo": "{0} 分的人这里也常这么走",
  "ex.masterTwo": "大师这一步同时瞄着 {0} 和 {1}",
  // —— v2：这一步做到了什么 ——
  "ex.good": "{0} {1}", "ex.capture": "{0} 吃掉了对方的{1}，净赚", "ex.captureEven": "{0} 吃掉了对方的{1}，但会被吃回",
  "ex.attackTwo": "{0} 同时攻击 {1} 和 {2}", "ex.attackMate": "{0} 威胁 {1} 杀棋", "ex.attack": "{0} 威胁吃掉对方的{1}",
  "ex.defends": "{0} 解除了对方 {1} 的威胁", "ex.check": "{0} 是将军", "ex.castle": "{0} 把王藏到了安全的地方",
  "ex.develop": "{0} 出动了{1}", "ex.push": "{0} 推进了通路兵", "ex.describe": "{0}",
};
