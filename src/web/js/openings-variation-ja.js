/**
 * オープニング「変化」の日本語名（7.8、v7-8-plan §6）—— キーは lichess の
 * ECO 表（eco.js）の名前のコロンより後ろをカンマで切った一区切り
 * （"Italian Game: Two Knights Defense, Fried Liver Attack" なら
 * "Two Knights Defense" と "Fried Liver Attack"）。キーは表の英語名そのもので、
 * 文案ではなく id として使う —— openings-family-ja.js と同じ（設計約束
 * 「内容の翻訳表は id で引く」）。
 *
 * どれを収めるかは scripts/test-eco.mjs が本アプリ自身のデータ（定跡書 195 本の
 * 各手、名局 10 局、講座と問題集の局面）から出現回数を数えて決める上位 60 区切り。
 * 表記は定跡書（openings-ja.js）の書き方に合わせる。定着した日本語名のないものは
 * 無理に訳さず、テストの NO_ESTABLISHED_NAME に載せて英語のまま残す。
 *
 * 「フライド・リバー・アタック」は上位 60 には入らないが、計画が名指しした例なので
 * 別に収める。
 * @module openings-variation-ja
 */
  export const OPENING_VARIATIONS_JA = {
    "Normal Variation": "ノーマル変化",
    "Main Line": "主変化",
    "Classical Variation": "クラシカル変化",
    "Fianchetto Variation": "フィアンケット変化",
    "Queen's Knight Variation": "クイーンズ・ナイト変化",
    "Normal Defense": "ノーマル・ディフェンス",
    "Symmetrical Variation": "対称変化",
    "Modern Variation": "モダン変化",
    "Open": "オープン変化",
    "Modern Variations": "モダン変化",
    "Exchange Variation": "交換変化",
    "Evans Gambit": "エヴァンス・ギャンビット",
    "Modern Line": "モダン・ライン",
    "King's English Variation": "キングズ・イングリッシュ変化",
    "Two Knights Defense": "ツー・ナイツ・ディフェンス",
    "Orthodox Defense": "オーソドックス・ディフェンス",
    "Berlin Defense": "ベルリン・ディフェンス",
    "Sämisch Variation": "ゼーミッシュ変化",
    "Closed": "クローズド変化",
    "Advance Variation": "アドバンス変化",
    "Dragon Variation": "ドラゴン変化",
    "Classical Defense": "クラシカル・ディフェンス",
    "Orthodox Variation": "オーソドックス変化",
    "Nimzowitsch Variation": "ニムゾヴィッチ変化",
    "Yugoslav Attack": "ユーゴスラフ・アタック",
    "Czech Variation": "チェコ変化",
    "Taimanov Variation": "タイマノフ変化",
    "Normal Line": "ノーマル・ライン",
    "Anti-Nimzo-Indian": "アンチ・ニムゾ・インディアン",
    "Fianchetto Attack": "フィアンケット・アタック",
    "Giuoco Pianissimo": "ジュオコ・ピアニッシモ",
    "Spanish Variation": "スパニッシュ変化",
    "Four Knights Variation": "フォー・ナイツ変化",
    "Bishop's Gambit": "ビショップズ・ギャンビット",
    "Steinitz Variation": "シュタイニッツ変化",
    "Scheveningen Variation": "シェベニンゲン変化",
    "Alapin Variation": "アラピン変化",
    "Four Pawns Attack": "フォー・ポーンズ・アタック",
    "Kieseritzky Gambit": "キーゼリツキー・ギャンビット",
    "Chigorin Variation": "チゴリン変化",
    "Two Knights Variation": "ツー・ナイツ変化",
    "Greco Gambit": "グレコ・ギャンビット",
    "Accelerated Dragon": "加速ドラゴン",
    "Gligoric System": "グリゴリッチ・システム",
    "Vienna Gambit": "ウィーン・ギャンビット",
    "Bernstein Defense": "ベルンシュタイン・ディフェンス",
    "French Variation": "フレンチ変化",
    "Neo-Orthodox Variation": "ネオ・オーソドックス変化",
    "Prague Variation": "プラハ変化",
    "Evans Gambit Accepted": "エヴァンス・ギャンビット・アクセプテッド",
    "Falkbeer Variation": "ファルクベーア変化",
    "Winawer Variation": "ウィナワー変化",
    "Tarrasch Variation": "タラッシュ変化",
    "Fried Liver Attack": "フライド・リバー・アタック",
  };
