/**
 * 日本語のオープニング名。キーは openings.js の行 id。
 *
 * openings.js が ECO コードと手順の唯一の出典で、このファイルは名前だけを
 * 置き換える。キーに ECO コードを使わないのは、複数の項目が同じコードを
 * 共有する（A00 だけでフランク・オープニング 5 種）ため。1.25 まで使って
 * いた中国語名もやめた —— 名前は文言であり、openings.js 側で一語直すだけで
 * このファイルと英語版のキーが同時に外れ、症状は「どの言語でも中国語名に
 * 戻る」だけで、テストは何も言わなかった。
 *
 * 表記は日本のチェス書に倣い、原則カタカナ音写。「交換変化」「主変化」の
 * ように定訳のある部分だけ漢語にしている。
 *
 * scripts/test-chess.mjs が、openings.js の全ての異なる名前にここの項目が
 * あること、ここに孤児がないことを検査する。
 * @module openings-ja
 */
  export const CHESS_OPENINGS_JA = {
    // A — フランク・オープニング
    "polish-sokolsky-opening": "ポーランド・オープニング（ソコルスキー）",
    "grobs-attack": "グロブ・アタック",
    "hungarian-opening": "ハンガリー・オープニング",
    "van-t-kruijs-opening": "ファント・クライス・オープニング",
    "dunst-opening": "ダンスト・オープニング",
    "larsens-opening": "ラーセン・オープニング",
    "birds-opening": "バード・オープニング",
    "reti-opening": "レティ・オープニング",
    "kings-indian-attack": "キングズ・インディアン・アタック",
    "english-opening": "イングリッシュ・オープニング",
    "english-opening-symmetrical-variation": "イングリッシュ・オープニング：対称変化",
    "queens-pawn-opening": "クイーンズ・ポーン・オープニング",
    "old-benoni-defense": "オールド・ベノニ・ディフェンス",
    "indian-defense": "インディアン・ディフェンス",
    "trompowsky-attack": "トロンポフスキー・アタック",
    "london-system": "ロンドン・システム",
    "budapest-gambit": "ブダペスト・ギャンビット",
    "old-indian-defense": "オールド・インディアン・ディフェンス",
    "benoni-defense": "ベノニ・ディフェンス",
    "benko-volga-gambit": "ベンコー（ヴォルガ）・ギャンビット",
    "modern-benoni": "モダン・ベノニ",
    "dutch-defense": "オランダ・ディフェンス",
    "kings-indian-attack-main-line": "キングズ・インディアン・アタック：主変化",
    "reti-opening-main-line": "レティ・オープニング：主変化",
    "english-opening-reversed-sicilian": "イングリッシュ・オープニング：逆シシリアン",
    "english-symmetrical-main-line": "イングリッシュ対称形：主変化",
    "trompowsky-attack-main-line": "トロンポフスキー・アタック：主変化",
    "london-system-vs-kings-indian": "ロンドン・システム 対 キングズ・インディアン",
    "benko-gambit-accepted": "ベンコー・ギャンビット：アクセプテッド",
    "modern-benoni-main-line": "モダン・ベノニ：主変化",
    "dutch-defence-leningrad": "オランダ・ディフェンス：レニングラード変化",
    "dutch-defence-classical": "オランダ・ディフェンス：クラシカル変化",
    "dutch-defence-stonewall": "オランダ・ディフェンス：ストーンウォール変化",

    // B — 1.e4（フレンチ以外の半オープン）
    "kings-pawn-opening": "キングズ・ポーン・オープニング",
    "nimzowitsch-defense": "ニムゾヴィッチ・ディフェンス",
    "scandinavian-defense": "スカンジナビア・ディフェンス",
    "alekhines-defense": "アリョーヒン・ディフェンス",
    "alekhines-defense-modern-variation": "アリョーヒン・ディフェンス：モダン変化",
    "modern-defense": "モダン・ディフェンス",
    "pirc-defense": "ピルツ・ディフェンス",
    "caro-kann-defense": "カロ・カン・ディフェンス",
    "caro-kann-defense-advance-variation": "カロ・カン・ディフェンス：アドバンス変化",
    "caro-kann-defense-exchange-variation": "カロ・カン・ディフェンス：交換変化",
    "caro-kann-defense-classical-variation": "カロ・カン・ディフェンス：クラシカル変化",
    "sicilian-defense": "シシリアン・ディフェンス",
    "smith-morra-gambit": "スミス・モラ・ギャンビット",
    "sicilian-defense-alapin-variation": "シシリアン・ディフェンス：アラピン変化",
    "closed-sicilian": "クローズド・シシリアン",
    "sicilian-defense-sveshnikov-variation": "シシリアン・ディフェンス：スヴェシニコフ変化",
    "sicilian-defense-accelerated-dragon": "シシリアン・ディフェンス：加速ドラゴン",
    "sicilian-defense-kan-variation": "シシリアン・ディフェンス：カン変化",
    "sicilian-defense-dragon-variation": "シシリアン・ディフェンス：ドラゴン変化",
    "sicilian-defense-scheveningen-variation": "シシリアン・ディフェンス：シェベニンゲン変化",
    "sicilian-defense-najdorf-variation": "シシリアン・ディフェンス：ナイドルフ変化",
    "scandinavian-defence-main-line": "スカンジナビア・ディフェンス：主変化",
    "alekhines-defence-four-pawns-attack": "アリョーヒン・ディフェンス：フォー・ポーンズ・アタック",
    "alekhines-defence-modern-main-line": "アリョーヒン・ディフェンス：モダン主変化",
    "modern-defence-austrian-attack": "モダン・ディフェンス：オーストリアン・アタック",
    "pirc-defence-classical": "ピルツ・ディフェンス：クラシカル変化",
    "caro-kann-advance": "カロ・カン：アドバンス変化",
    "caro-kann-panov-attack": "カロ・カン：パノフ・アタック",
    "caro-kann-classical-short-castles": "カロ・カン：クラシカル・短いキャスリング",
    "caro-kann-classical": "カロ・カン：クラシカル変化",
    "smith-morra-gambit-main": "シシリアン・ディフェンス：スミス・モラ・ギャンビット",
    "sicilian-alapin-2-nf6": "シシリアン・アラピン：2...Nf6",
    "closed-sicilian-main": "シシリアン・ディフェンス：クローズド変化",
    "sicilian-rossolimo-nd4": "シシリアン・ロッソリモ：...Nd4 変化",
    "sicilian-sveshnikov": "シシリアン・スヴェシニコフ",
    "accelerated-dragon-maroczy-bind": "加速ドラゴン：マロツィ・バインド",
    "sicilian-taimanov": "シシリアン・タイマノフ",
    "sicilian-rossolimo": "シシリアン・ロッソリモ",
    "sicilian-dragon-yugoslav-attack": "シシリアン・ドラゴン：ユーゴスラフ・アタック",
    "sicilian-scheveningen": "シシリアン・シェベニンゲン",
    "sicilian-najdorf": "シシリアン・ナイドルフ",

    // C — フレンチと 1.e4 e5
    "french-defense": "フレンチ・ディフェンス",
    "french-defense-exchange-variation": "フレンチ・ディフェンス：交換変化",
    "french-defense-advance-variation": "フレンチ・ディフェンス：アドバンス変化",
    "french-defense-tarrasch-variation": "フレンチ・ディフェンス：タラッシュ変化",
    "french-defense-classical-variation": "フレンチ・ディフェンス：クラシカル変化",
    "french-defense-winawer-variation": "フレンチ・ディフェンス：ウィナワー変化",
    "kings-pawn-game": "キングズ・ポーン・ゲーム",
    "center-game": "センター・ゲーム",
    "bishops-opening": "ビショップズ・オープニング",
    "vienna-game": "ウィーン・ゲーム",
    "kings-gambit": "キングズ・ギャンビット",
    "kings-gambit-accepted": "キングズ・ギャンビット：アクセプテッド",
    "kings-knight-opening": "キングズ・ナイト・オープニング",
    "philidor-defense": "フィリドール・ディフェンス",
    "russian-petrov-defense": "ロシアン（ペトロフ）・ディフェンス",
    "scotch-game": "スコッチ・ゲーム",
    "three-knights-game": "スリー・ナイツ・ゲーム",
    "four-knights-game": "フォー・ナイツ・ゲーム",
    "four-knights-game-spanish-variation": "フォー・ナイツ・ゲーム：スパニッシュ変化",
    "italian-game": "イタリアン・ゲーム",
    "evans-gambit": "エヴァンス・ギャンビット",
    "italian-game-classical-variation": "イタリアン・ゲーム：クラシカル変化",
    "two-knights-defense": "ツー・ナイツ・ディフェンス",
    "two-knights-defense-knight-attack": "ツー・ナイツ・ディフェンス：ナイト・アタック",
    "ruy-lopez-spanish-opening": "ルイ・ロペス（スパニッシュ・オープニング）",
    "ruy-lopez-berlin-defense": "ルイ・ロペス：ベルリン・ディフェンス",
    "ruy-lopez-exchange-variation": "ルイ・ロペス：交換変化",
    "ruy-lopez": "ルイ・ロペス",
    "ruy-lopez-closed-variation": "ルイ・ロペス：クローズド変化",
    "french-defence-kings-indian-attack": "フレンチ・ディフェンス：キングズ・インディアン・アタック",
    "french-exchange-symmetrical": "フレンチ交換：対称形",
    "french-advance": "フレンチ・アドバンス",
    "french-tarrasch-open-variation": "フレンチ・タラッシュ：オープン変化",
    "french-classical": "フレンチ・クラシカル",
    "french-winawer": "フレンチ・ウィナワー",
    "bishops-opening-berlin-defence": "ビショップズ・オープニング：ベルリン・ディフェンス",
    "vienna-gambit": "ウィーン・ギャンビット",
    "kings-gambit-kieseritzky": "キングズ・ギャンビット：キーゼリツキー変化",
    "philidor-defence-classical": "フィリドール・ディフェンス：クラシカル変化",
    "petrov-defence": "ペトロフ・ディフェンス",
    "scotch-gambit": "スコッチ・ギャンビット",
    "scotch-game-classical": "スコッチ・ゲーム：クラシカル変化",
    "four-knights-game-main": "フォー・ナイツ・ディフェンス",
    "italian-game-giuoco-pianissimo": "イタリアン・ゲーム：ジュオコ・ピアニッシモ",
    "evans-gambit-main": "イタリアン・ゲーム：エヴァンス・ギャンビット",
    "italian-game-giuoco-piano": "イタリアン・ゲーム：ジュオコ・ピアノ",
    "two-knights-defence": "イタリアン・ゲーム：ツー・ナイツ・ディフェンス",
    "ruy-lopez-berlin-anti-berlin": "ルイ・ロペス：ベルリン・アンチベルリン",
    "ruy-lopez-berlin-endgame": "ルイ・ロペス：ベルリン・エンドゲーム",
    "ruy-lopez-exchange-main-line": "ルイ・ロペス：交換主変化",
    "ruy-lopez-closed-main-line": "ルイ・ロペス：クローズド主変化",
    "ruy-lopez-marshall-attack": "ルイ・ロペス：マーシャル・アタック",

    // D・E — 1.d4 の閉鎖系とインディアン系
    "queens-pawn-game": "クイーンズ・ポーン・ゲーム",
    "richter-veresov-attack": "リヒテル・ヴェレソフ・アタック",
    "colle-system": "コル・システム",
    "queens-gambit": "クイーンズ・ギャンビット",
    "chigorin-defense": "チゴリン・ディフェンス",
    "albin-countergambit": "アルビン・カウンターギャンビット",
    "slav-defense": "スラブ・ディフェンス",
    "queens-gambit-accepted": "クイーンズ・ギャンビット：アクセプテッド",
    "queens-gambit-declined": "クイーンズ・ギャンビット：ディクラインド",
    "queens-gambit-declined-exchange-variation": "クイーンズ・ギャンビット・ディクラインド：交換変化",
    "semi-slav-defense": "セミスラブ・ディフェンス",
    "grunfeld-defense": "グリュンフェルト・ディフェンス",
    "grunfeld-defense-exchange-variation": "グリュンフェルト・ディフェンス：交換変化",
    "london-system-main-line": "ロンドン・システム：主変化",
    "slav-defence-exchange": "スラブ・ディフェンス：交換変化",
    "slav-defence-main-line": "スラブ・ディフェンス：主変化",
    "queens-gambit-accepted-main": "クイーンズ・ギャンビット・アクセプテッド",
    "semi-slav-noteboom": "セミスラブ：ノーテボーム変化",
    "tarrasch-defence": "タラッシュ・ディフェンス",
    "qgd-exchange-minority-attack": "QGD 交換：ミノリティ・アタック",
    "semi-slav-anti-meran": "セミスラブ：アンチ・メラン",
    "semi-slav-meran": "セミスラブ：メラン変化",
    "queens-gambit-declined-tartakower": "クイーンズ・ギャンビット・ディクラインド：タルタコワー変化",
    "grunfeld-defence-modern-exchange": "グリュンフェルト・ディフェンス：現代交換変化",
    "grunfeld-exchange-classical": "グリュンフェルト交換：クラシカル",
    "catalan-opening": "カタラン・オープニング",
    "queens-indian-defense": "クイーンズ・インディアン・ディフェンス",
    "nimzo-indian-defense": "ニムゾ・インディアン・ディフェンス",
    "nimzo-indian-defense-classical-variation": "ニムゾ・インディアン・ディフェンス：クラシカル変化",
    "nimzo-indian-defense-rubinstein-system": "ニムゾ・インディアン・ディフェンス：ルビンシュタイン・システム",
    "kings-indian-defense": "キングズ・インディアン・ディフェンス",
    "catalan-opening-closed": "カタラン・オープニング：クローズド変化",
    "queens-indian-defence": "クイーンズ・インディアン・ディフェンス（後翼）",
    "nimzo-indian-classical": "ニムゾ・インディアン：クラシカル変化",
    "nimzo-indian-rubinstein": "ニムゾ・インディアン：ルビンシュタイン変化",
    "kings-indian-fianchetto": "キングズ・インディアン：フィアンケット変化",
    "kings-indian-defence-classical": "キングズ・インディアン・ディフェンス：クラシカル変化",
    "kings-indian-defence-samisch": "キングズ・インディアン・ディフェンス：ゼーミッシュ変化",
  };

  /**
   * 定跡トレーニングで表示される「この変化が何を狙っているか」の一文。
   * 6 手以上の変化だけが表示対象なので、翻訳が要るのもちょうどその集合。
   */
  export const CHESS_OPENING_IDEAS_JA = {
    "benko-volga-gambit":
      "黒は b ポーンを捨てて a・b 線をこじ開け、二枚のルークとビショップでクイーンサイドに持続的な圧力をかける —— ポーン 1 個で長期の主導権を買う。",
    "modern-benoni":
      "黒はスペースの不利を受け入れ、その代わり e6 で白のポーン・チェーンを崩し、...b5 でクイーンサイドの反撃を狙う。",
    "kings-indian-attack-main-line":
      "キングズ・インディアン・ディフェンスを白番でやる形。同じ配置で黒のほぼ全ての応手に対応でき、e4-e5 と伸ばしてからキングサイドへ突っ込む。",
    "reti-opening-main-line":
      "白は中央ポーンをすぐには伸ばさず、二枚のビショップで遠くから中央を睨む。黒の形が決まってから d4 か e4 かを選ぶ。",
    "english-opening-reversed-sicilian":
      "シシリアンの黒番の形を、白番で一手多く持って指す。イングリッシュを理解する一番の近道は、まずシシリアンを理解すること。",
    "english-symmetrical-main-line":
      "両者同形。先に対称を崩した側がその代償を負う。ここで問われるのは暗記ではなく、いつ動くかの判断。",
    "trompowsky-attack-main-line":
      "白は 2 手目でビショップを出し、黒のインディアン系の準備を全部外す。7 手目の c4 は b2 をあっさり渡す手 —— 黒クイーンがポーンを取りに行く数手を、白は全部駒組みに使う。",
    "london-system-vs-kings-indian":
      "同じロンドンの形をキングズ・インディアンにぶつける。Bf4 で先に e5 を押さえ、h3 でビショップに h2 の逃げ道を用意しておく。",
    "benko-gambit-accepted":
      "黒はポーンを 1 個渡して a 線と b 線を完全に開き、二枚のルークとビショップで一局を通じて白のクイーンサイドを圧迫する。ポーンは戻らないが、圧力は消えない。",
    "modern-benoni-main-line":
      "黒はスペースの不利と引き換えに、e 線のルーク・g7 のビショップ・クイーンサイドの ...b5 を得る。快適さではなく、主導権を取りにいく。",
    "dutch-defence-leningrad":
      "黒はキングズ・インディアンのビショップの形をオランダの f5 ポーンに接続する。g7 のビショップが大斜線を通り、f 線も開いていて、攻め筋が二本ある。",
    "dutch-defence-classical":
      "黒は 1 手目からキングサイドのポーンを伸ばして e4 を争う。代償は e8-h5 の斜線に残る永久の緩み。玉を攻めたい人の選択。",
    "dutch-defence-stonewall":
      "黒は d5-e6-f5-c6 で壁を築いて e4 を完全に塞ぎ、駒をすべてキングサイドへ寄せる。代償は e5 のマスと、自分のポーンの後ろに閉じ込められた白マスビショップ。承知のうえの取引。",
    "alekhines-defense-modern-variation":
      "黒はわざとナイトをポーンに追わせ、白のポーンを伸びすぎさせてから、その伸びたポーンを攻め返す。",
    "caro-kann-defense-exchange-variation":
      "交換後は構造が対称で見通しがよい。白はわずかな優位と速い駒組み、黒は安全と単純化を狙う。",
    "caro-kann-defense-classical-variation":
      "黒はまず「悪いビショップ」問題を片付ける。c8 のビショップを e6 のポーンより先に外へ出し、それから落ち着いて陣形を整える。",
    "sicilian-defense-sveshnikov-variation":
      "黒は ...e5 で中央を取り白のナイトを追い返す。代償は d5 が永久に弱くなること —— スペースと弱点を交換する、鋭い取引。",
    "sicilian-defense-accelerated-dragon":
      "g7 のビショップが大斜線から中央を遠隔で支配し、...d5 の突破と組み合わせる。通常のドラゴンより一手速い。",
    "sicilian-defense-kan-variation":
      "...a6 で先に Nb5 を消し、...b5 のクイーンサイド拡張と ...Bb7 の大斜線を準備する。",
    "sicilian-defense-dragon-variation":
      "黒のビショップが g7 に出て「ドラゴン」の形になり、両者が別々のサイドを攻める。白は h ポーンを突いて玉へ、黒は c 線から反撃。",
    "sicilian-defense-scheveningen-variation":
      "黒は d6+e6 の低いが堅い陣を築き、駒を後ろに隠したまま ...d5 や ...b5 の反撃の機会を待つ。",
    "sicilian-defense-najdorf-variation":
      "...a6 こそがナイドルフの魂。b5 のマスを消し、...e5 の中央奪取と ...b5 のクイーンサイド拡張を準備する。",
    "scandinavian-defence-main-line":
      "黒は 1 手目から中央に挑戦する。代償はクイーンが Nc3 で追われること。利点は形が単純で分岐が少なく、開幕研究で潰されにくいこと。",
    "alekhines-defence-four-pawns-attack":
      "白は中央ポーン 4 つを全部伸ばす。黒を押し潰すか、このポーン・チェーンが自壊するかのどちらか。アリョーヒン・ディフェンスが望んでいるのはまさにこれ。",
    "alekhines-defence-modern-main-line":
      "黒はわざとナイトを追わせ、白ポーンを前へ前へと誘い、伸びきったチェーンを噛み返す。開幕における「誘い込み」の典型。",
    "modern-defence-austrian-attack":
      "ピルツよりナイトを出すのが遅い。黒は先にビショップを大斜線へ、クイーンサイドを広げ、白の陣形を見てからナイトの位置を決める。",
    "pirc-defence-classical":
      "黒は中央を争わず、まず白に取らせておいてから ...c6 ...e5 と横から押し返す。忍耐と、圧迫された局面を怖がらない胆力が要る。",
    "caro-kann-advance":
      "白は中央を閉じてスペースを取る。黒の急所は白マスビショップを先に f5 へ出すこと —— e6 で閉じ込められたら、この将棋は指せない。ビショップが出たら ...Ne7-g6 で e5 を噛みに戻る。",
    "caro-kann-panov-attack":
      "白はカロ・カンを孤立ポーンの局面に変える。d4 は孤立するが、代わりに駒が働き e5・c5 という二つの前哨点が手に入る。孤立ポーンの指し方の標準教材。",
    "caro-kann-classical-short-castles":
      "白は h4 を突かず、素直に駒組みして短くキャスリングする。h4-h5 の変化よりずっと穏やかで、黒も指しやすい。",
    "caro-kann-classical":
      "カロ・カンの要点は、白マスビショップを e6 に閉じ込められる前に外へ出すこと。代償は白が h4-h5 でスペースを取り、黒のビショップがしばらく h7 に立つこと。",
    "smith-morra-gambit-main":
      "白はポーン 1 個で c 線と d 線の二本のオープン・ファイル、そして黒より二手速い駒組みを買う。黒が一度遅れると押し切られる。",
    "sicilian-alapin-2-nf6":
      "白は 2 手目から d4 で大きな中央を作る準備をし、シシリアンの主要理論を丸ごと回避する。支払うのは駒組み一手分。",
    "closed-sicilian-main":
      "白は中央ポーンを交換せず、シシリアンをキングズ・インディアン・アタック式の攻め合いにする。白は f4-f5 でキングサイド、黒は ...b5 でクイーンサイド。理論の暗記は不要。",
    "sicilian-rossolimo-nd4":
      "黒はナイトを交換させず、そのままキャスリングして駒を出す。白は d4-e5 と中央を作り、ポーン・チェーンのぶつかり合いになる。",
    "sicilian-sveshnikov":
      "黒は自ら d5 に永久の穴を残し、その代わり e5 のスペース・二枚のビショップ・...b5 の前進を得る。二十年前は自殺行為とされ、今は主流。",
    "accelerated-dragon-maroczy-bind":
      "白は c4+e4 の二つのポーンで d5 を完全に押さえ、黒はしばらく ...d5 も ...b5 も突けない。束縛を解くには駒交換 —— この一課をここで覚える人は多い。",
    "sicilian-taimanov":
      "黒は d ポーンとキング側ビショップの位置を保留し、クイーンを早めに c7 へ出して c 線と e4 に圧力をかける。柔軟さが最大の武器。",
    "sicilian-rossolimo":
      "白は 3 手目で黒ナイトを交換し、シシリアン主要変化の理論の海に入らない。黒は二枚のビショップ、白はきれいなポーン構造と分かりやすい計画を得る。",
    "sicilian-dragon-yugoslav-attack":
      "両者反対側にキャスリングし、それぞれポーンを突き合う。先に攻め切った方が勝つ。黒の g7 ビショップは大斜線ごしに b2 まで届いていて、白はまさにそこを狙う。",
    "sicilian-scheveningen":
      "d6+e6 の「小さな中央」は低いが弱点がない。黒は白がポーンを突いて隙を作るのを待って反撃する。シシリアンの中で最も忍耐を要する変化。",
    "sicilian-najdorf":
      "...a6 は一見のんびりだが、実際は ...b5 の準備であり、白の駒を b5 に入れさせないための一手。黒は d5 に穴を残す代わり、クイーンサイドの主導権を丸ごと取る。",
    "french-defense-exchange-variation":
      "ポーン構造は対称、キャスリングも同じ方向。駒がより働き、先に e 線に圧力をかけた側が優勢になる。",
    "french-defense-classical-variation":
      "黒はナイトを出して直接 e4 に挑戦し、白はたいてい e5 と伸ばして閉じる。以後は d4/d5 のポーン・チェーンをめぐる力比べになる。",
    "french-defense-winawer-variation":
      "黒のビショップが c3 のナイトをピンして e4 を直接圧迫する。白は a3 でビショップに態度を迫り、二枚のビショップと中央のポーン優位を得ることが多い。",
    "scotch-game":
      "白は早い段階で中央を開き、駒を一気に働かせる —— 構造の対称性と引き換えに駒組みの速さを取る。",
    "four-knights-game":
      "双方が対称に軽い駒を出す、最も正統な「開幕三原則」の開局。初心者向き。",
    "four-knights-game-spanish-variation":
      "対称形の中で白が先に Bb5 と一手加えて c6 に圧力をかけ、均衡を崩そうとする。",
    "italian-game":
      "双方のビショップが相手の最も弱いマス（f7/f2）を狙う、典型的な「静かなイタリアン」のゆっくりした駒組み。",
    "evans-gambit":
      "白は b ポーンを捨てて時間を買う。c3+d4 の強力な中央と速い駒組みによる激しい攻めが代償として手に入る。",
    "italian-game-classical-variation":
      "c3 は d4 の準備。白は中央のポーン陣を築き、ビショップの利きを実際のスペースに変えていく。",
    "two-knights-defense":
      "黒は e5 を受けずにナイトで e4 に反撃し、戦術的に複雑な変化へ持ち込む。",
    "two-knights-defense-knight-attack":
      "白のナイトが f7 に飛び込む —— 最も古い罠の一つ。黒は慌ててポーンを守るのではなく ...d5 で反撃しなければならない。",
    "ruy-lopez-berlin-defense":
      "黒は ...a6 を省いて直ちにナイトで e4 を攻める。交換のあとは駒数の少ない、構造の堅い終盤型の局面になる。",
    "ruy-lopez-exchange-variation":
      "白は自ら良いビショップを交換し、代わりに黒のポーン構造を崩す。狙いは終盤での勝利。",
    "ruy-lopez":
      "白のビショップが a4 に引いてピンの圧力を保ち、黒は ...b5 という反撃の資源を得る —— スパニッシュの分岐点。",
    "ruy-lopez-closed-variation":
      "双方が駒組みとキャスリングを終え、白は c3+d4 で中央を作る準備、黒は ...d5 かクイーンサイド拡張の機会をうかがう。",
    "french-defence-kings-indian-attack":
      "白はフレンチの理論の森に入らず、キングズ・インディアン・アタックの形に組み替える。e4-e5 で中央を閉じ、以後は全ての駒をキングサイドへ。",
    "french-exchange-symmetrical":
      "最も対称的なフレンチ。両者の形は瓜二つ。勝ちたければ自分から均衡を破るしかなく、その一手には必ず代償がある。",
    "french-advance":
      "中央が固まると、将棋は両サイドの別々の戦いになる。白はキングサイド、黒は d4 と c 線。黒の白マスビショップがこの一局で最も置き場に困る駒。",
    "french-tarrasch-open-variation":
      "白は Nd2 で ...Bb4 のピンをかわすが、代わりにナイトが自分のビショップをふさぐ。局面は開きやすく、しばしば孤立ポーン構造になる。",
    "french-classical":
      "白は e5 まで伸ばしてスペースを取り、黒はナイトを d7 に引いてから c5 でチェーンの根元を叩く。典型的なチェーンの攻め合い —— 一方はキングサイド、一方は土台。",
    "french-winawer":
      "黒はビショップとナイトを交換して白に c3 の重複ポーンを作らせ、そのうえで d4 を集中攻撃する。白が得るのは二枚のビショップとキングサイドの攻撃権。",
    "bishops-opening-berlin-defence":
      "白は先にビショップ、あとからナイトを出す。イタリアンにもウィーンにも、独自の変化にも移行できる。ペトロフ・ディフェンスを避ける常用の小道。",
    "vienna-gambit":
      "キングズ・ギャンビットの穏健版。先にナイトを出してから f4 を突く。黒の ...d5 だけが正しい反撃。",
    "kings-gambit-kieseritzky":
      "ロマン派時代の主要変化。白は 2 手目で f ポーンを捨て、中央と f 線を買う。今日では最善とは言えないが、チェスを学ぶ人は一度は指すべき変化。",
    "philidor-defence-classical":
      "黒はナイトではなくポーンで e5 を支える。狭いが堅い。注意すべきは f7 —— 白のビショップとルークがそこを睨んでいる。",
    "petrov-defence":
      "黒は e5 を守らず、対称に取り返す。局面は均衡した明快なものになりやすく、黒が安全を求めるときの古典的な選択。",
    "scotch-gambit":
      "白は d4 を取り返さず、ビショップを出して時間を取る。7 手目の e5 でナイトを追い、Bb5 でピン。双方とも正確な読みが要る —— この変化では一手の遅れが一駒の遅れになる。",
    "scotch-game-classical":
      "3 手目で中央ポーンを交換し、局面はすぐ開く。白はじわじわ締めるのではなく、駒組みの速さで一手先んじることを狙う。",
    "four-knights-game-main":
      "四つのナイトが先に出て、局面は対称で静か。これが教えるのは「駒を出す・キャスリングする・それから計画を立てる」という順番そのもの。",
    "italian-game-giuoco-pianissimo":
      "「最も遅い将棋」。白は d4 を急がず、まず全ての駒を最良のマスへ置く。理論を暗記したくない、駒の置き方を学びたい人向け。",
    "evans-gambit-main":
      "白は b ポーンで先手を買う。c3 と d4 が一気に決まって大きな中央ができ、ビショップも c4 の斜線に戻る。19 世紀の攻撃兵器だが、今なお鋭い。",
    "italian-game-giuoco-piano":
      "両者ともビショップを最も長い斜線に置き、ゆっくり d4 を準備する。現代の指し方は d4 ではなく d3 —— まず形を作り、それから突く。",
    "two-knights-defence":
      "黒はポーンを 1 個捨てて白ナイトを帰らせ、駒組みの先行と e 線・d 線の二本のオープン・ファイルを得る。初心者が「ポーンを捨てて速度を買う」を初めて味わう場所。",
    "ruy-lopez-berlin-anti-berlin":
      "白は d3 でベルリン終盤を避け、局面を中盤に留める。ここ十年の最高峰でよく見る選択 —— クイーンを交換せず、将棋を続ける。",
    "ruy-lopez-berlin-endgame":
      "クイーンが早々に盤を降り、黒はキャスリング権を失う代わりに二枚のビショップと崩れにくいポーン構造を得る。スパニッシュを一局まるごと終盤にしてしまう —— それが最高峰で多用される理由。",
    "ruy-lopez-exchange-main-line":
      "白は自ら黒の構造を崩して終盤の優位を買う。黒は c 線に重複ポーン、白はキングサイド 4 対 3 のきれいな多数ポーン。代償として黒は二枚のビショップを得る。",
    "ruy-lopez-closed-main-line":
      "スパニッシュの本流。白は c3 で d4 を支え、h3 で ...Bg4 を未然に防ぎ、隙のない準備を終えてから動く。黒は ...b5 ...d6 で e5 を固める。双方急がず、勝負は中盤から。",
    "ruy-lopez-marshall-attack":
      "黒は 8 手目に e ポーンを捨て、e 線・d5 の中央・キングサイドへ向いた駒を得る。百年たっても白はこのポーンがタダだと証明できていない。",
    "slav-defense":
      "黒は c6 で d5 を支えつつ、c8 のビショップの出口を残す —— クイーンズ・ギャンビットより柔軟な中央の守り方。",
    "queens-gambit-declined-exchange-variation":
      "交換後は古典的な「ミノリティ・アタック」の構造になる。白はクイーンサイドでポーンを前進させ、黒はキングサイドに機会を探す。",
    "queens-gambit-declined":
      "双方が交換を急がず着実に駒を出す。白は中央の張りを保ち、黒は ...dxc4 か ...c5 の機会を待つ。",
    "semi-slav-defense":
      "黒は ...dxc4 でポーンを取る筋と ...b5 で広げる筋の両方を残す。理論が最も深い変化の一つ。",
    "grunfeld-defense":
      "黒はまず白に大きな中央を作らせ、それから ...c5 と g7 のビショップで横から解体する —— 典型的な「超近代」の発想。",
    "grunfeld-defense-exchange-variation":
      "白は理想的な大中央ポーン陣を手に入れ、黒は持ち駒を全てその中央の解体に賭ける。",
    "london-system-main-line":
      "白は黒の指し手をほとんど見ずに d4-Nf3-Bf4-e3-c3-Nbd2 の形を固定する。暗記量は極めて少ないが、代わりに黒へ難しい問題を出せない。",
    "slav-defence-exchange":
      "完全に対称なポーン構造で、白は一手多いだけ。引き分けに見えるが、この種の局面で先手の一手を現金化するのは難しく、しかし決して消えもしない。",
    "slav-defence-main-line":
      "...c6 で白マスビショップに f5 の出口を用意してから c4 を取る。ここがスラブがクイーンズ・ギャンビットより快適な理由 —— ビショップが自分のポーンに閉じ込められない。",
    "queens-gambit-accepted-main":
      "黒はそのポーンを守り切るつもりはなく、それを ...c5 で中央を叩く時間に換える。序盤で早々にクイーンを交換するのは、快適な終盤へ直行したいから。",
    "semi-slav-noteboom":
      "黒は c4 を確保し ...b5 で守り、クイーンサイドに連結した二つのポーンを得る。白は中央と二枚のビショップ。二種類の優位が正面衝突する。",
    "tarrasch-defence":
      "黒は自ら孤立ポーンを引き受け、その代わり全ての駒の通り道と e4・c4 という二つの前哨点を得る。駒の働きが構造の弱点を償えるか —— この将棋はそれを問う。",
    "qgd-exchange-minority-attack":
      "白は c ポーンを交換して形を決め、クイーンサイドの少数ポーンを b4-b5 と前進させて c6 を叩く準備をする。この計画には名前があり、「ミノリティ・アタック」という。",
    "semi-slav-anti-meran":
      "白は Qc2 で先に e4 と h7 を睨み、黒に快適なメランを指させない。遅いが、より堅実。",
    "semi-slav-meran":
      "黒は c4 を取ってから ...b5 ...c5 とクイーンサイドに二つ分のスペースを奪い、白は e4 で中央から反撃する。双方とも速い。一手遅れた方が負ける。",
    "queens-gambit-declined-tartakower":
      "黒は ...b6 で最も扱いにくい白マスビショップを大斜線へ出し、二組の駒を交換して息をつく。クイーンズ・ギャンビット・ディクラインドの現代的な標準処理。",
    "grunfeld-defence-modern-exchange":
      "白はルークを b1 に回して ...Qa5 を先に防ぎ、Be2 で落ち着いて駒を出す。交換変化の中で現在最も主流の指し方。",
    "grunfeld-exchange-classical":
      "黒は白に大きな中央を作らせ、g7 のビショップと ...c5 の二方向からそれを解体する。「まず作らせ、それから壊す」がグリュンフェルトの思想の全て。",
    "catalan-opening":
      "白のビショップが g2 から大斜線を遠隔支配し、d5 に圧力をかけ続ける。堅実かつ柔軟な現代的システム。",
    "queens-indian-defense":
      "黒のビショップが b7 から e4 のマスを遠隔支配し、ナイトと協力して中央の要所をしっかり押さえる。",
    "nimzo-indian-defense":
      "黒のビショップが c3 のナイトをピンして e4 のマスを争う —— ビショップ 1 枚の働きで、白に二枚のビショップを渡す取引。",
    "nimzo-indian-defense-classical-variation":
      "白はクイーンを c2 に置いて構造を崩されるのを先に防ぎ、二枚のビショップの優位を保つ。",
    "nimzo-indian-defense-rubinstein-system":
      "白は最も素直な形で駒を出し、ポーン構造の傷を受け入れる代わりに中央と二枚のビショップを取る。",
    "kings-indian-defense":
      "黒はいったん中央を明け渡し、...e5 か ...c5 で反撃する。キングサイドにキャスリングしてからは全力で攻める —— 極めて鋭いシステム。",
    "catalan-opening-closed":
      "白は g2 の大斜線にビショップを置き、黒に c4 を取らせてから数手かけてポーンを取り返す。取り返した頃には、ビショップはもう良い位置に立っている。",
    "queens-indian-defence":
      "c3 はすでに Nf3 が占めているので、黒は ...b6 に切り替えて遠くから e4 を制する。一局を通じて争点は e4 のマス一つ。",
    "nimzo-indian-classical":
      "白はクイーンでビショップを取り返すのでポーン構造は傷まない —— 代償はクイーンが早く盤上に晒されることと、駒組みが二手遅れること。",
    "nimzo-indian-rubinstein":
      "黒は 3 手目でビショップを使って c3 のナイトをピンし、交換して白に c3 の重複ポーンを残す準備をする。ビショップとナイトを交換して構造を決める、最も古典的な一例。",
    "kings-indian-fianchetto":
      "白もビショップを大斜線に置き、黒の g7 ビショップの利きを先に遮る。キングズ・インディアンに対する最も堅実な一組。",
    "kings-indian-defence-classical":
      "中央が固まると両者は別々にポーンを突く。白は c4-c5 でクイーンサイド、黒は ...f5-f4-g5 で白玉へ。盤上でこれほど戦線がはっきり分かれる攻め合いは珍しい。",
    "kings-indian-defence-samisch":
      "白は f3 で e4 を支えてから g4-h4 と玉へ直進する。キングズ・インディアンで最も遠慮のない一手法。互いに反対の翼を攻め、一手でも遅れた側が詰む。",
  };
