/** 対局 —— 対局画面と盤上の振り返り（日本語）。キーは play.zh.js と同じ。{0} {1} は引数。 */
export default {
  // the shell around the pages (main.js, index.html) and the board's name for screen readers
  "app.title": "チェス", "nav.aria": "メインナビゲーション", "nav.learn": "学ぶ", "nav.play": "指す", "nav.me": "わたし", "nav.settings": "設定",
  "app.loadFailed": "ページを読み込めませんでした：{0}", "board.aria": "チェス盤",

  // opponents: names and lines are opponents/lines.ja.js
  "opp.thinking": "考え中", "new.weaker": "弱い相手", "new.stronger": "強い相手",
  "side.you": "あなた", "side.w": "白", "side.b": "黒",

  // the context bar while playing
  "bar.yourTurn": "あなたの番", "bar.theirTurn": "{0}が考え中…", "bar.toMove": "{0}の手番", "bar.check": "チェック！",
  "bar.viewing": "{0} 手目を表示中", "bar.live": "現局面に戻る",
  "act.hint": "ヒント", "act.draw": "引き分け", "act.resign": "投了", "act.moves": "棋譜", "act.new": "新しい対局",
  "act.cancel": "キャンセル", "act.confirmResign": "投了する", "act.offerDraw": "引き分け提案", "act.claimDraw": "引き分けを宣言",
  "confirm.resign": "投了しますか？", "confirm.draw": "相手に引き分けを提案しますか？", "confirm.claim": "引き分けを宣言できます：{0}。",
  "claim.threefold": "同じ局面が 3 回現れた", "claim.fifty": "50 手のあいだ駒取りもポーンの移動もない",
  "draw.declined": "{0}は引き分けを断りました。対局を続けます。", "draw.thinking": "{0}が検討中…",
  "act.undo": "待った", "act.flip": "反転", "act.flipKey": "盤を反転（F）",
  "undo.unrated": "待ったをしたので、この対局はレーティングに数えません。",

  // the coach before a move (P2)
  "coach.ask": "ちょっと待って —— 相手の狙いは？", "coach.rethink": "考え直す", "coach.play": "この手で指す",
  "coach.checking": "…",

  // layered hints (P3)
  "hint.threat": "まず相手の狙いを見よう：{0}", "hint.threatMate": "相手は {0} を狙っている。それはメイトだ。",
  "hint.threatPiece": "相手は {0} であなたの{1}を取ろうとしている。", "hint.threatCheck": "チェックされている。まずチェックを防ごう。",
  "hint.noThreat": "相手にいま直接の狙いはない。",
  "hint.forcing": "次に、あなたのチェックと駒取りを見よう：{0}", "hint.noForcing": "チェックも駒取りもない。まだ動いていない駒はどれ？",
  "hint.idea": "ここでの考え方：{0}", "hint.ideaMate": "メイトがある", "hint.ideaCapture": "駒を取って得をする",
  "hint.ideaCheck": "チェックして相手に応じさせる", "hint.ideaQuiet": "駒の位置をよくする",
  "hint.move": "{0} と指す", "hint.wait": "ちょっと考えさせて…", "act.hintMore": "もっとヒント",

  // the end of a game
  "res.win": "あなたの勝ち", "res.loss": "あなたの負け", "res.draw": "引き分け", "res.white": "白の勝ち", "res.black": "黒の勝ち",
  "reason.checkmate": "チェックメイト", "reason.stalemate": "ステイルメイト", "reason.insufficient": "駒数不足", "reason.fivefold": "5 回同形",
  "reason.seventy-five": "75 手ルール", "reason.resign": "投了", "reason.timeout": "時間切れ", "reason.timeoutDraw": "時間切れ、ただし相手にメイトする駒がない",
  "reason.agreement": "合意で引き分け", "reason.threefold": "3 回同形", "reason.fifty": "50 手ルール",

  // the new game sheet
  "new.title": "新しい対局", "new.opponent": "相手", "new.color": "手番", "new.clock": "持ち時間", "new.coach": "指す前に確認",
  "new.start": "開始", "color.w": "白", "color.random": "ランダム", "color.b": "黒", "clock.none": "時間なし",

  // promotion
  "promo.title": "昇格先",

  // the move list drawer and the report
  "drawer.title": "棋譜", "drawer.first": "最初へ", "drawer.prev": "1 手戻る", "drawer.next": "1 手進む", "drawer.last": "最後へ",
  "report.title": "詳しいレポート", "report.accuracy": "正確度 {0}", "report.copy": "PGN をコピー", "toast.copied": "コピーしました",

  // the review on the board (P5)
  "rv.running": "振り返り中… {0}/{1}", "rv.card": "{0} 手目、あなたは {1} と指した（{2}）。", "rv.cardOf": "{0}/{1}",
  "rv.tryAgain": "ここにはもっと良い手があった。考えてみる？", "rv.answer": "答えを見る", "rv.next": "次へ", "rv.finish": "終了",
  "rv.report": "詳しいレポート", "rv.same": "それは対局で指した手です。", "rv.right": "正解！ {0} がここでの最善手です。",
  "rv.alsoGood": "{0} でも大丈夫。エンジンの一番手は {1}。", "rv.wrong": "{0} もよくない：{1}", "rv.wrongPlain": "{0} もよくない。もう一度考えよう。",
  "rv.checking": "{0} を確認中…", "rv.ruleMate": "相手の {0} でメイト", "rv.rulePiece": "相手の {0} であなたの{1}を取られる", "rv.better": "{0} が良かった。", "rv.done": "振り返り完了。", "rv.clean": "この対局に見直すべき場面はありません。",
  "rv.noEngine": "今回は振り返りができませんでした：{0}",
  "grade.blunder": "大悪手", "grade.mistake": "悪手", "grade.miss": "好機逸失", "grade.inaccuracy": "軽い緩手",
  "grade.brilliant": "妙手", "grade.only": "唯一の手", "grade.best": "最善手", "grade.excellent": "好手", "grade.good": "まずまず", "grade.book": "定跡",
};
