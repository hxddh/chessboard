/**
 * The opponents' names, their one line of character (the new-game sheet),
 * and what they say — at most three lines a game (v20-0-plan §3 P1): a
 * greeting, one reaction when your move turns the game, and one at the end.
 * Ids are core/opponents.js's; the names and faces are 19.0's.
 *
 *   hello   when the game starts
 *   react   once, when your move costs it a lot (opponents/mind.js surprised)
 *   won / lost / drawn / resign   the result, from its side
 * A line it does not have falls back to `_`.
 * @module opponents/lines.zh
 */
export default {
  _: {
    hello: "请多指教。", react: "这步我没想到。",
    won: "谢谢你的对局。", lost: "你下得好。", drawn: "和了，下得不错。", resign: "我认输了。",
  },
  friend: { name: "朋友", note: "两个人，一块棋盘" },
  pip: { name: "皮普", note: "刚学会怎么走子，常常看漏你的吃子。",
    hello: "我刚学会马怎么走！", react: "咦？我的子呢？", won: "我赢了？真的吗！", lost: "再来一盘吧！" },
  tomo: { name: "托莫", note: "下了几个月，比皮普稳，还是会丢子。",
    hello: "随便下下，别太认真。", react: "哎呀，没看见。", won: "运气不错。", lost: "下次我会小心的。" },
  lina: { name: "莉娜", note: "照书上下：抢中心、出轻子、早易位。",
    hello: "先出子，再易位。", react: "书上没写这一步……", lost: "我回去再读读书。" },
  kai: { name: "凯", note: "爱进攻，子力总往你的王那边压。",
    hello: "小心你的王。", react: "好吧，这下我得防守了。", won: "进攻就是最好的防守。", lost: "攻过头了。", resign: "攻不动了，我认输。" },
  ada: { name: "艾达", note: "像真人那样下，稳，但偶尔还会大失误。",
    hello: "慢慢下。", react: "嗯，这步厉害。", lost: "这盘是你的。" },
  ben: { name: "本", note: "会算两三步，喜欢吃得到的子。",
    hello: "今天想赢一盘。", react: "等等，让我再看看。", won: "终于赢了一盘！", lost: "又输了，再来！" },
  vera: { name: "薇拉", note: "俱乐部棋手，开局熟，中局会犯错。",
    hello: "来一盘吧。", react: "这步我没想到。", won: "好对局。", lost: "你今天状态不错。", resign: "不下了，你赢了。" },
  sol: { name: "索尔", note: "沉得住气，喜欢慢慢挤压。",
    hello: "不着急，慢慢来。", react: "有意思。", won: "耐心赢了。", drawn: "公平的结果。" },
  leo: { name: "利奥", note: "手快，有时快过了头。",
    hello: "下快棋吗？", react: "哦——好手。", won: "快就是好。", lost: "下次慢一点。" },
  ivy: { name: "艾薇", note: "很少丢子，要赢她得有真东西。",
    hello: "请。", react: "这步不错。", lost: "你应得的。", resign: "我认输。" },
  max: { name: "马克斯", note: "强手，开局准，残局细。",
    hello: "认真下吧。", react: "嗯？没料到。", won: "残局见真章。", lost: "佩服。", resign: "到此为止，你赢了。" },
  iris: { name: "艾瑞丝", note: "像大师一样看得深，失误很少。",
    hello: "希望是一盘好棋。", react: "我漏算了。", lost: "漂亮。", resign: "我认输，下得漂亮。" },
  otto: { name: "奥托", note: "老练的大师，几乎不给机会。",
    hello: "开始吧。", react: "嗯，这步有力。", won: "多谢。", lost: "难得。", resign: "我认输。" },
  zoe: { name: "佐伊", note: "比奥托还强，下得又准又冷静。",
    hello: "祝你好运。", react: "厉害。", lost: "了不起。", resign: "我认输。" },
  fish: { name: "Stockfish", note: "全力的 Stockfish：不是人，也不让人。",
    hello: "全力。", react: "评估改变了。", won: "将杀。", lost: "……", drawn: "和棋。", resign: "认输。" },
};
