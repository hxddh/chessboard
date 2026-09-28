/**
 * The personas' names and their two lines, in the three languages
 * (v8-0-plan B4). Content, like a lesson's text, not interface: it ships in
 * the opponents chunk (opponents-chunk.js) rather than in the first-paint
 * dictionary, and scripts/test-chess.mjs holds it to what the dictionary
 * checks hold keys to — every persona in every language, and 7.8's rule:
 * the lines state facts (the rung, the style, the opening, what was counted),
 * never a judgement of the player or a feeling of the machine.
 *
 * `bye` is filled with {0} the opening, {1} the moves, {2} the engine's
 * captures, {3} its checks; a persona without its own says the shared one.
 * @module opponents-lines
 */
export const OP_LINES = {
  "zh-CN": {
    say: "{0}：{1}", bye: "本局开局：{0}，共 {1} 回合。", noOpening: "未收录的开局",
    pip: { name: "皮普", hello: "新手档，不带风格：会主动犯错，常常丢子。" },
    tomo: { name: "托莫", hello: "休闲档，不带风格：比新手准，仍会丢子。", bye: "本局开局：{0}，共 {1} 回合，托莫吃子 {2} 次。" },
    lina: { name: "莉娜", hello: "练习档，重原则：抢中心、出轻子、早易位。" },
    kai: { name: "凯", hello: "进步档，爱进攻：子力往你的王那边压。", bye: "本局开局：{0}；凯将军 {3} 次。" },
    ada: { name: "艾达", hello: "稳健档，不带风格：算三步，很少大失误。" },
    remy: { name: "雷米", hello: "扎实档，重原则：开局按三原则出子。" },
    ben: { name: "本", hello: "初级档，不带风格：Stockfish 限制在 UCI_Elo 1320。" },
    nico: { name: "尼可", hello: "初级+ 档，不带风格：Stockfish 限制在 UCI_Elo 1450。", bye: "本局开局：{0}；尼可吃子 {2} 次。" },
    vera: { name: "薇拉", hello: "中级− 档，不带风格：Stockfish 限制在 UCI_Elo 1575。", bye: "本局开局：{0}；薇拉将军 {3} 次。" },
    sol: { name: "索尔", hello: "中级档，不带风格：Stockfish 限制在 UCI_Elo 1700。" },
    max: { name: "马克斯", hello: "高级档，不带风格：Stockfish 限制在 UCI_Elo 2200。", bye: "本局开局：{0}；马克斯将军 {3} 次。" },
    fish: { name: "Stockfish", hello: "不限档：满强度的 Stockfish 19，每步 1.2 秒。" },
  },
  "en": {
    say: "{0}: {1}", bye: "Opening: {0}. {1} moves.", noOpening: "an opening not in the book",
    pip: { name: "Pip", hello: "Gentle, no style: makes mistakes on purpose and often drops a piece." },
    tomo: { name: "Tomo", hello: "Casual, no style: sharper than Gentle, still drops pieces.", bye: "Opening: {0}. {1} moves; Tomo captured {2} times." },
    lina: { name: "Lina", hello: "Practice, by the book: centre first, minor pieces out, castle early." },
    kai: { name: "Kai", hello: "Improving, attacker: keeps bringing pieces toward your king.", bye: "Opening: {0}. Kai gave check {3} times." },
    ada: { name: "Ada", hello: "Steady, no style: looks three moves ahead and seldom blunders." },
    remy: { name: "Remy", hello: "Solid, by the book: develops by the three opening principles." },
    ben: { name: "Ben", hello: "Novice, no style: Stockfish limited to UCI_Elo 1320." },
    nico: { name: "Nico", hello: "Novice+, no style: Stockfish limited to UCI_Elo 1450.", bye: "Opening: {0}. Nico captured {2} times." },
    vera: { name: "Vera", hello: "Intermediate−, no style: Stockfish limited to UCI_Elo 1575.", bye: "Opening: {0}. Vera gave check {3} times." },
    sol: { name: "Sol", hello: "Intermediate, no style: Stockfish limited to UCI_Elo 1700." },
    max: { name: "Max", hello: "Advanced, no style: Stockfish limited to UCI_Elo 2200.", bye: "Opening: {0}. Max gave check {3} times." },
    fish: { name: "Stockfish", hello: "Unrated: Stockfish 19 at full strength, 1.2 seconds a move." },
  },
  "ja": {
    say: "{0}：{1}", bye: "序盤：{0}。{1} 手。", noOpening: "定跡集にない序盤",
    pip: { name: "ピップ", hello: "やさしい、スタイルなし：わざとミスをし、よく駒を落とす。" },
    tomo: { name: "トモ", hello: "お気軽、スタイルなし：やさしいより正確だが、まだ駒を落とす。", bye: "序盤：{0}。{1} 手、トモが駒を取ったのは {2} 回。" },
    lina: { name: "リナ", hello: "練習、定跡どおり：中央、小駒の展開、早めのキャスリング。" },
    kai: { name: "カイ", hello: "上達、攻め好み：駒をあなたの王のほうへ寄せ続ける。", bye: "序盤：{0}。カイのチェックは {3} 回。" },
    ada: { name: "エイダ", hello: "堅実、スタイルなし：3 手先まで読み、大きなミスはまれ。" },
    remy: { name: "レミー", hello: "手堅い、定跡どおり：序盤の三原則どおりに駒を出す。" },
    ben: { name: "ベン", hello: "初級、スタイルなし：UCI_Elo 1320 に制限した Stockfish。" },
    nico: { name: "ニコ", hello: "初級+、スタイルなし：UCI_Elo 1450 に制限した Stockfish。", bye: "序盤：{0}。ニコが駒を取ったのは {2} 回。" },
    vera: { name: "ヴェラ", hello: "中級−、スタイルなし：UCI_Elo 1575 に制限した Stockfish。", bye: "序盤：{0}。ヴェラのチェックは {3} 回。" },
    sol: { name: "ソル", hello: "中級、スタイルなし：UCI_Elo 1700 に制限した Stockfish。" },
    max: { name: "マックス", hello: "上級、スタイルなし：UCI_Elo 2200 に制限した Stockfish。", bye: "序盤：{0}。マックスのチェックは {3} 回。" },
    fish: { name: "Stockfish", hello: "無制限：全力の Stockfish 19、1 手 1.2 秒。" },
  },
};
