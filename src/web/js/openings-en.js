/**
 * English opening names, keyed by the Chinese name in openings.js.
 *
 * openings.js stays the single source of truth for the ECO code and the move
 * order; this file only renames. The key is the Chinese name rather than the
 * ECO code because several entries share a code (A00 alone covers five flank
 * openings), so the code is not unique enough to translate by.
 *
 * scripts/test-chess.mjs checks every distinct name in openings.js has an
 * entry here and that nothing here is orphaned.
 * @module openings-en
 */
(function (global) {
  global.CHESS_OPENINGS_EN = {
    // A — flank openings
    "波兰开局（索科尔斯基）": "Polish (Sokolsky) Opening",
    "格罗布开局": "Grob's Attack",
    "匈牙利开局": "Hungarian Opening",
    "范特克鲁伊斯开局": "Van 't Kruijs Opening",
    "邓斯特开局": "Dunst Opening",
    "拉尔森开局": "Larsen's Opening",
    "伯德开局": "Bird's Opening",
    "列蒂开局": "Réti Opening",
    "王翼印度攻击": "King's Indian Attack",
    "英国式开局": "English Opening",
    "英国式开局·对称变例": "English Opening: Symmetrical Variation",
    // A — queen's pawn sidelines and Indian defences
    "后兵开局": "Queen's Pawn Opening",
    "老贝诺尼防御": "Old Benoni Defense",
    "印度防御": "Indian Defense",
    "特龙波夫斯基进攻": "Trompowsky Attack",
    "伦敦体系": "London System",
    "布达佩斯弃兵": "Budapest Gambit",
    "老印度防御": "Old Indian Defense",
    "贝诺尼防御": "Benoni Defense",
    "沃尔加-贝科弃兵": "Benko (Volga) Gambit",
    "现代贝诺尼": "Modern Benoni",
    "荷兰防御": "Dutch Defense",
    // B — semi-open games
    "王兵开局": "King's Pawn Opening",
    "尼姆佐维奇防御": "Nimzowitsch Defense",
    "斯堪的纳维亚防御": "Scandinavian Defense",
    "阿廖欣防御": "Alekhine's Defense",
    "阿廖欣防御·现代变例": "Alekhine's Defense: Modern Variation",
    "现代防御": "Modern Defense",
    "皮尔茨防御": "Pirc Defense",
    "卡罗-卡恩防御": "Caro-Kann Defense",
    "卡罗-卡恩防御·前进变例": "Caro-Kann Defense: Advance Variation",
    "卡罗-卡恩防御·交换变例": "Caro-Kann Defense: Exchange Variation",
    "卡罗-卡恩防御·经典变例": "Caro-Kann Defense: Classical Variation",
    "西西里防御": "Sicilian Defense",
    "史密斯-莫拉弃兵": "Smith-Morra Gambit",
    "西西里防御·阿拉平变例": "Sicilian Defense: Alapin Variation",
    "封闭西西里": "Closed Sicilian",
    "西西里防御·斯维什尼科夫变例": "Sicilian Defense: Sveshnikov Variation",
    "西西里防御·加速龙式": "Sicilian Defense: Accelerated Dragon",
    "西西里防御·卡恩变例": "Sicilian Defense: Kan Variation",
    "西西里防御·龙式变例": "Sicilian Defense: Dragon Variation",
    "西西里防御·谢文宁根变例": "Sicilian Defense: Scheveningen Variation",
    "西西里防御·纳伊道夫变例": "Sicilian Defense: Najdorf Variation",
    // C — open games and the French
    "法兰西防御": "French Defense",
    "法兰西防御·交换变例": "French Defense: Exchange Variation",
    "法兰西防御·前进变例": "French Defense: Advance Variation",
    "法兰西防御·塔拉什变例": "French Defense: Tarrasch Variation",
    "法兰西防御·经典变例": "French Defense: Classical Variation",
    "法兰西防御·维纳韦尔变例": "French Defense: Winawer Variation",
    "王兵对局": "King's Pawn Game",
    "中心对局": "Center Game",
    "主教开局": "Bishop's Opening",
    "维也纳开局": "Vienna Game",
    "王翼弃兵": "King's Gambit",
    "王翼弃兵·接受": "King's Gambit Accepted",
    "王马开局": "King's Knight Opening",
    "菲利多尔防御": "Philidor Defense",
    "俄罗斯防御（彼得罗夫）": "Russian (Petrov) Defense",
    "苏格兰开局": "Scotch Game",
    "三马开局": "Three Knights Game",
    "四马开局": "Four Knights Game",
    "四马开局·西班牙变例": "Four Knights Game: Spanish Variation",
    "意大利开局": "Italian Game",
    "埃文斯弃兵": "Evans Gambit",
    "意大利开局·经典变例": "Italian Game: Classical Variation",
    "双马防御": "Two Knights Defense",
    "双马防御·骑士进攻": "Two Knights Defense: Knight Attack",
    "西班牙开局（鲁伊·洛佩斯）": "Ruy Lopez (Spanish Opening)",
    "西班牙开局·柏林防御": "Ruy Lopez: Berlin Defense",
    "西班牙开局·交换变例": "Ruy Lopez: Exchange Variation",
    "西班牙开局": "Ruy Lopez",
    "西班牙开局·封闭变例": "Ruy Lopez: Closed Variation",
    // D/E — closed games and Indian defences
    "后兵对局": "Queen's Pawn Game",
    "里希特-维列索夫进攻": "Richter-Veresov Attack",
    "科列体系": "Colle System",
    "后翼弃兵": "Queen's Gambit",
    "奇戈林防御": "Chigorin Defense",
    "阿尔宾反弃兵": "Albin Countergambit",
    "斯拉夫防御": "Slav Defense",
    "后翼弃兵·接受": "Queen's Gambit Accepted",
    "后翼弃兵·拒绝": "Queen's Gambit Declined",
    "后翼弃兵·交换变例": "Queen's Gambit Declined: Exchange Variation",
    "半斯拉夫防御": "Semi-Slav Defense",
    "格林菲尔德防御": "Grünfeld Defense",
    "格林菲尔德防御·交换变例": "Grünfeld Defense: Exchange Variation",
    "卡塔兰开局": "Catalan Opening",
    "新印度防御": "Queen's Indian Defense",
    "尼姆佐-印度防御": "Nimzo-Indian Defense",
    "尼姆佐-印度防御·经典变例": "Nimzo-Indian Defense: Classical Variation",
    "尼姆佐-印度防御·鲁宾斯坦体系": "Nimzo-Indian Defense: Rubinstein System",
    "王翼印度防御": "King's Indian Defense",
      // —— 1.15 ——
    "西班牙开局·封闭主变": "Ruy Lopez, Closed Main Line",
    "西班牙开局·马歇尔攻击": "Ruy Lopez, Marshall Attack",
    "西班牙开局·交换主变": "Ruy Lopez, Exchange Main Line",
    "西班牙开局·柏林残局": "Ruy Lopez, Berlin Endgame",
    "意大利开局·朱奥科·皮亚诺": "Italian Game, Giuoco Piano",
    "意大利开局·两马防御": "Two Knights Defence",
    "意大利开局·埃文斯弃兵": "Evans Gambit",
    "苏格兰开局·古典变例": "Scotch Game, Classical",
    "彼得罗夫防御": "Petrov Defence",
    "王翼弃兵·基泽利茨基": "King's Gambit, Kieseritzky",
    "维也纳开局·弃兵变例": "Vienna Gambit",
    "四马防御": "Four Knights Game",
    "菲利多尔防御·古典变例": "Philidor Defence, Classical",
    "斯堪的纳维亚防御·主变": "Scandinavian Defence, Main Line",
    "阿廖欣防御·现代主变": "Alekhine's Defence, Modern Main Line",
    "皮尔茨防御·古典变例": "Pirc Defence, Classical",
    "现代防御·奥地利攻击": "Modern Defence, Austrian Attack",
    "卡罗-康防御·古典变例": "Caro-Kann, Classical",
    "卡罗-康防御·进攻变例": "Caro-Kann, Advance",
    "卡罗-康防御·帕诺夫进攻": "Caro-Kann, Panov Attack",
    "西西里防御·纳伊道夫": "Sicilian Najdorf",
    "西西里防御·龙式·南斯拉夫攻击": "Sicilian Dragon, Yugoslav Attack",
    "西西里防御·斯维什尼科夫": "Sicilian Sveshnikov",
    "西西里防御·加速龙·马洛奇束缚": "Accelerated Dragon, Maroczy Bind",
    "西西里防御·舍维宁根": "Sicilian Scheveningen",
    "西西里防御·泰马诺夫": "Sicilian Taimanov",
    "西西里防御·封闭变例": "Closed Sicilian",
    "西西里防御·阿拉平·2...Nf6": "Sicilian Alapin, 2...Nf6",
    "法兰西防御·温纳瓦尔": "French Winawer",
    "法兰西防御·古典变例": "French Classical",
    "法兰西防御·塔拉什·开放变例": "French Tarrasch, Open Variation",
    "法兰西防御·进攻变例": "French Advance",
    "后翼弃兵·塔尔塔科维尔": "Queen's Gambit Declined, Tartakower",
    "后翼弃兵·交换·少数派进攻": "QGD Exchange, Minority Attack",
    "斯拉夫防御·主变": "Slav Defence, Main Line",
    "半斯拉夫防御·梅兰变例": "Semi-Slav, Meran",
    "后翼弃兵接受": "Queen's Gambit Accepted",
    "塔拉什防御": "Tarrasch Defence",
    "伦敦体系·主变": "London System, Main Line",
    "尼姆佐-印度防御·鲁宾斯坦": "Nimzo-Indian, Rubinstein",
    "后翼印度防御": "Queen's Indian Defence",
    "国王印度防御·古典变例": "King's Indian Defence, Classical",
    "格林菲尔德防御·交换·古典": "Grünfeld Exchange, Classical",
    "现代贝诺尼·主变": "Modern Benoni, Main Line",
    "贝科弃兵·接受": "Benko Gambit, Accepted",
    "加泰罗尼亚开局·封闭变例": "Catalan Opening, Closed",
    "荷兰防御·古典变例": "Dutch Defence, Classical",
    "英国式开局·反西西里": "English Opening, Reversed Sicilian",
    "英国式开局·对称主变": "English Symmetrical, Main Line",
    "列蒂开局·主变": "Réti Opening, Main Line",
    "王翼印度攻击·主变": "King's Indian Attack, Main Line",
    "西西里防御·史密斯-莫拉弃兵": "Smith-Morra Gambit",
    "法兰西防御·王翼印度式": "French Defence, King's Indian Attack",
    "意大利开局·极慢变例": "Italian Game, Giuoco Pianissimo",
    "格林菲尔德防御·现代交换": "Grünfeld Defence, Modern Exchange",
    "尼姆佐-印度防御·古典变例": "Nimzo-Indian, Classical",
    "卡罗-康防御·古典·短易位": "Caro-Kann, Classical, Short Castles",
    "荷兰防御·列宁格勒变例": "Dutch Defence, Leningrad",
    "半斯拉夫防御·反梅兰": "Semi-Slav, Anti-Meran",
    "西班牙开局·柏林·反柏林": "Ruy Lopez, Berlin, Anti-Berlin",
    "西西里防御·罗索利莫": "Sicilian Rossolimo",
    "西西里防御·罗索利莫·保象变例": "Sicilian Rossolimo, ...Nd4",
    "斯拉夫防御·交换变例": "Slav Defence, Exchange",
    "特龙波夫斯基进攻·主变": "Trompowsky Attack, Main Line",
    "伦敦体系·对国王印度": "London System vs King's Indian",
    "中心开局·比萨普变例": "Bishop's Opening, Berlin Defence",
    "苏格兰弃兵": "Scotch Gambit",
    "阿廖欣防御·四兵攻击": "Alekhine's Defence, Four Pawns Attack",
    "国王印度防御·菲安凯托变例": "King's Indian, Fianchetto",
    "半斯拉夫防御·诺特博姆": "Semi-Slav, Noteboom",
    "法兰西防御·交换·对称变例": "French Exchange, Symmetrical",
};

  /**
   * English text for the "idea" line the opening drills show under the task.
   *
   * Same key as the names above — the Chinese name in openings.js — and the
   * same rule: openings.js owns the moves, this file owns only the words. Only
   * the 38 lines long enough to be drilled carry an idea, so only those need an
   * entry; scripts/test-chess.mjs checks that set exactly.
   */
  global.CHESS_OPENING_IDEAS_EN = {
    "沃尔加-贝科弃兵": "Black gives up the b-pawn to rip open the a- and b-files, then leans on the queenside forever with two rooks and the bishop — a pawn for lasting pressure.",
    "现代贝诺尼": "Black accepts less space in return for the ...e6 break against White's pawn chain, with ...b5 to follow on the queenside.",
    "阿廖欣防御·现代变例": "Black invites the knight to be chased, luring White's pawns too far forward, then turns round and attacks the overextended chain.",
    "卡罗-卡恩防御·交换变例": "The exchange leaves a symmetrical, clear-cut position: White plays for a small edge and fast development, Black for solidity and simplification.",
    "卡罗-卡恩防御·经典变例": "Black solves the problem piece first — the c8 bishop comes out before ...e6 shuts it in — and only then completes development.",
    "西西里防御·斯维什尼科夫变例": "...e5 grabs the centre and kicks the knight, at the permanent cost of the d5 square: sharp space for a weak square.",
    "西西里防御·加速龙式": "The g7 bishop eyes the long diagonal while ...d5 comes in one go — the Dragon's idea, a tempo faster.",
    "西西里防御·卡恩变例": "...a6 takes b5 away from the knights and prepares ...b5 on the wing with ...Bb7 behind it.",
    "西西里防御·龙式变例": "The bishop goes to g7 and both sides attack on opposite wings: White throws the h-pawn at the king, Black comes down the c-file.",
    "西西里防御·谢文宁根变例": "Black builds the small, solid d6+e6 shell, keeps the pieces behind it, and waits for ...d5 or ...b5.",
    "西西里防御·纳伊道夫变例": "...a6 is the soul of the Najdorf: it covers b5 and prepares both ...e5 for the centre and ...b5 on the queenside.",
    "法兰西防御·交换变例": "Symmetrical pawns and castling on the same side: whoever gets the more active pieces and presses first on the e-file stands better.",
    "法兰西防御·经典变例": "Black develops straight at e4; White usually pushes e5 to lock it, and the game turns on the d4/d5 pawn chains.",
    "法兰西防御·维纳韦尔变例": "The bishop pins the c3 knight to hit e4 at once; White plays a3 to make it decide, taking the bishop pair and a big centre in return.",
    "苏格兰开局": "White opens the centre early and gets the pieces out fast — symmetry of structure traded for speed of development.",
    "四马开局": "Both sides bring the minor pieces out symmetrically: the most orthodox opening there is, and the one that follows the three opening rules most literally.",
    "四马开局·西班牙变例": "Inside the symmetry White adds Bb5 to press on c6, trying to break the balance first.",
    "意大利开局": "Both bishops aim at the opponent's weakest square (f7 and f2) — the slow, manoeuvring \"Quiet Italian\".",
    "埃文斯弃兵": "White throws in the b-pawn for time: the payoff is c3+d4, a big centre and a fast, violent attack.",
    "意大利开局·经典变例": "c3 prepares d4: White wants the full pawn centre, turning the bishops' aim into real space.",
    "双马防御": "Black counterattacks e4 instead of defending e5, steering the game into sharp tactical waters.",
    "双马防御·骑士进攻": "The knight jumps at f7 — one of the oldest traps in chess; Black must hit back with ...d5 rather than scramble to save the pawn.",
    "西班牙开局·柏林防御": "Black ignores ...a6 and develops with pressure on e4; the exchanges lead to a simplified, structurally solid endgame.",
    "西班牙开局·交换变例": "White gives up the good bishop to damage Black's pawn structure, playing for the endgame.",
    "西班牙开局": "The bishop retreats to a4 to keep the pin alive while Black gets ...b5 as counterplay — the main crossroads of the Ruy Lopez.",
    "西班牙开局·封闭变例": "Both sides finish developing and castle; White prepares c3+d4 for the centre, Black waits for ...d5 or queenside expansion.",
    "斯拉夫防御": "Black props up d5 with c6 while leaving the c8 bishop a way out — a more flexible way to hold the centre than the Queen's Gambit Declined.",
    "后翼弃兵·交换变例": "The exchange produces the classic minority attack: White advances pawns on the queenside, Black looks for chances on the kingside.",
    "后翼弃兵·拒绝": "Both sides develop steadily without hurrying to exchange; White keeps the central tension, Black waits for the right moment for ...dxc4 or ...c5.",
    "半斯拉夫防御": "Black keeps both ...dxc4 and ...b5 in reserve — one of the deepest theoretical battlegrounds in chess.",
    "格林菲尔德防御": "Black lets White build the big centre, then takes it apart from the side with ...c5 and the g7 bishop — hypermodern thinking in one line.",
    "格林菲尔德防御·交换变例": "White gets the ideal pawn centre; Black's entire case rests on dismantling it.",
    "卡塔兰开局": "The bishop goes to g2 and leans down the long diagonal at d5 — a solid and flexible modern system.",
    "新印度防御": "The bishop on b7 watches e4 from afar and, with the knights, holds the key central squares.",
    "尼姆佐-印度防御": "The bishop pins the c3 knight to fight for e4 — one active bishop traded for White's bishop pair.",
    "尼姆佐-印度防御·经典变例": "Qc2 defends the pawn structure in advance, so White keeps the bishop pair without damage.",
    "尼姆佐-印度防御·鲁宾斯坦体系": "White develops in the plainest way possible, accepting a possible structural flaw for the centre and the two bishops.",
    "王翼印度防御": "Black hands over the centre, hits back with ...e5 or ...c5, and after castling throws everything at the king — as sharp as openings get.",
      // —— 1.15 ——
    "西班牙开局·封闭主变":
      "The Spanish main road. White plays c3 to prepare d4 and h3 to stop ...Bg4 before committing; Black holds e5 with ...b5 and ...d6. Neither side hurries — the real game starts in the middlegame.",
    "西班牙开局·马歇尔攻击":
      "Black gives up the e-pawn on move eight for the open e-file, a big centre and every piece pointing at White's king. A century on, White still has not shown the pawn is safe to keep.",
    "西班牙开局·交换主变":
      "White wrecks his own bishop pair to wreck Black's pawns: the doubled c-pawns mean White's four-against-three on the kingside is a clean majority in the endgame. The price is Black's two bishops.",
    "西班牙开局·柏林残局":
      "The queens come off at move eight. Black loses castling but keeps two bishops and a structure that is very hard to break. It turns the Spanish into an endgame, which is exactly why the top boards play it.",
    "意大利开局·朱奥科·皮亚诺":
      "Both sides put a bishop on its longest diagonal and prepare d4 slowly. The modern handling is d3 rather than an early d4: finish developing first, push later.",
    "意大利开局·两马防御":
      "Black gives a pawn to chase the knight home, and gets a lead in development plus the open e- and d-files. This is where most players first taste giving material for time.",
    "意大利开局·埃文斯弃兵":
      "White spends the b-pawn to gain a tempo: c3 and d4 build the big centre in one go and the bishop is back on the c4 diagonal. A nineteenth-century attacking weapon that still bites.",
    "苏格兰开局·古典变例":
      "White trades centre pawns on move three and the position opens at once. This is not about slow pressure — it is about being a tempo faster in development.",
    "彼得罗夫防御":
      "Instead of defending e5, Black takes symmetrically. The position tends towards balance and clarity — the classical choice when Black wants a quiet game.",
    "王翼弃兵·基泽利茨基":
      "The romantic era's main line: White gives the f-pawn on move two for the centre and the f-file. Not objectively best today, but everyone learning chess should play it once.",
    "维也纳开局·弃兵变例":
      "The sane version of the King's Gambit: develop the knight first, then push f4. Black's ...d5 is the one correct answer.",
    "四马防御":
      "All four knights come out and the position stays symmetrical and quiet. What it teaches is the order itself: develop, castle, then look for a plan.",
    "菲利多尔防御·古典变例":
      "Black defends e5 with a pawn rather than a knight: cramped but solid. The square to watch is f7, where White's bishop and rook are both looking.",
    "斯堪的纳维亚防御·主变":
      "Black challenges the centre on move one and pays with a tempo after Nc3. The upside is simplicity: few paths, and almost no chance of being blown away by preparation.",
    "阿廖欣防御·现代主变":
      "Black invites the knight to be chased so that White's pawns advance too far, then goes back to chew on the over-extended chain. Provocation as an opening system.",
    "皮尔茨防御·古典变例":
      "Black cedes the centre, lets White fill it, then pushes back from the side with ...c6 and ...e5. It needs patience and a tolerance for being squeezed.",
    "现代防御·奥地利攻击":
      "Even more delayed than the Pirc: Black puts the bishop on the long diagonal and expands on the queenside first, saving the knight's square until White has committed.",
    "卡罗-康防御·古典变例":
      "The whole point of the Caro-Kann is getting the light-squared bishop out before ...e6 shuts it in. The price is White's h4-h5 space, and the bishop parking on h7 for a while.",
    "卡罗-康防御·进攻变例":
      "White closes the centre for space. Black's key is getting the light-squared bishop to f5 first: once ...e6 shuts it in, the position is unplayable. With the bishop out, ...Ne7-g6 comes back at e5.",
    "卡罗-康防御·帕诺夫进攻":
      "White turns the Caro-Kann into an isolated-pawn position: d4 is isolated, and in return White gets active pieces and the e5 and c5 outposts. The standard textbook on how to play the IQP.",
    "西西里防御·纳伊道夫":
      "...a6 looks slow but it prepares ...b5 and keeps White's pieces off b5. Black accepts the hole on d5 in exchange for the whole queenside initiative.",
    "西西里防御·龙式·南斯拉夫攻击":
      "Opposite-side castling, each side pushing pawns at the other king; whoever arrives first wins. Black's g7 bishop looks all the way down to b2, and that is exactly what White is playing against.",
    "西西里防御·斯维什尼科夫":
      "Black deliberately concedes a permanent hole on d5 for space on e5, the bishop pair and the ...b5 push. Considered suicidal twenty years ago; mainstream now.",
    "西西里防御·加速龙·马洛奇束缚":
      "White's c4 and e4 lock d5 down so that neither ...d5 nor ...b5 works for a while. Breaking a bind means trading pieces, and this is where most players learn it.",
    "西西里防御·舍维宁根":
      "The small centre of d6 and e6 is low but has no weaknesses; Black waits for White's pawn storm to create a target. The most patient branch of the Sicilian.",
    "西西里防御·泰马诺夫":
      "Black leaves the d-pawn and the dark-squared bishop uncommitted, with the queen on c7 pressing the c-file and e4. Flexibility is the whole point.",
    "西西里防御·封闭变例":
      "White refuses to trade centre pawns and plays the Sicilian like a King's Indian Attack: f4-f5 at Black's king, ...b5 at White's. Almost no theory to memorise.",
    "西西里防御·阿拉平·2...Nf6":
      "White prepares d4 and a big centre on move two, sidestepping every main line of the Sicilian. The cost is one tempo of development.",
    "法兰西防御·温纳瓦尔":
      "Black trades bishop for knight to leave White with doubled c-pawns, then piles on d4. White's compensation is the bishop pair and the kingside attack.",
    "法兰西防御·古典变例":
      "White grabs space with e5, Black retreats the knight to d7 and hits the base of the chain with ...c5. The classic pawn-chain race: one side storms the kingside, the other eats the base.",
    "法兰西防御·塔拉什·开放变例":
      "Nd2 avoids the ...Bb4 pin at the cost of blocking White's own bishop. The position opens up quickly and often becomes an isolated-pawn structure.",
    "法兰西防御·进攻变例":
      "Once the centre locks, the game becomes two separate fights: White on the kingside, Black against d4 and down the c-file. Black's light-squared bishop is the hardest piece in the game to place.",
    "后翼弃兵·塔尔塔科维尔":
      "...b6 solves the problem piece — the light-squared bishop — by putting it on the long diagonal, and two pairs come off to ease the cramp. The modern standard treatment of the QGD.",
    "后翼弃兵·交换·少数派进攻":
      "White clarifies with the c-pawn trade and prepares the queenside pawn push b4-b5 against c6. The plan has a name: the minority attack.",
    "斯拉夫防御·主变":
      "...c6 keeps f5 free for the light-squared bishop before taking on c4. That is exactly why the Slav feels better than the QGD: the bishop never gets shut in by its own pawns.",
    "半斯拉夫防御·梅兰变例":
      "Black takes on c4, then ...b5 and ...c5 win two files' worth of queenside space; White answers with e4 in the centre. Both sides are fast, and a single slow move loses.",
    "后翼弃兵接受":
      "Black never intends to hold the pawn — it buys the time for ...c5 against the centre. Queens come off early because Black is heading straight for a comfortable endgame.",
    "塔拉什防御":
      "Black volunteers for the isolated pawn in exchange for completely free pieces and the e4 and c4 outposts. The whole game asks one question: does activity pay for a structural weakness?",
    "伦敦体系·主变":
      "White plays d4-Nf3-Bf4-e3-c3-Nbd2 almost regardless of what Black does. Very little to memorise; the cost is that it asks Black no hard questions.",
    "尼姆佐-印度防御·鲁宾斯坦":
      "Black pins the c3 knight on move three, intending to trade it off and leave White with doubled c-pawns. The classic case of trading bishop for knight to fix the structure.",
    "后翼印度防御":
      "With Nf3 already covering the c3 square, Black switches to ...b6 to fight for e4 from a distance. The whole opening is about that one square.",
    "国王印度防御·古典变例":
      "Once the centre locks, each side storms the other's wing: White with c4-c5, Black with ...f5-f4-g5 at White's king. Few positions in chess divide so cleanly.",
    "格林菲尔德防御·交换·古典":
      "Black lets White build the big centre, then dismantles it with the g7 bishop and ...c5. Let him build it, then take it apart — that is the whole Grünfeld idea.",
    "现代贝诺尼·主变":
      "Black accepts less space in return for the rook on the e-file, the g7 bishop and the queenside majority behind ...b5. Activity instead of comfort.",
    "贝科弃兵·接受":
      "Black gives a pawn to open the a- and b-files, and the two rooks plus the bishop lean on White's queenside for the entire game. The pawn is gone; the pressure never is.",
    "加泰罗尼亚开局·封闭变例":
      "White fianchettoes on g2 and lets Black take on c4, then spends a few moves winning the pawn back. By the time it comes back, the bishop is already in place.",
    "荷兰防御·古典变例":
      "Black fights for e4 with the f-pawn on move one, at the cost of a permanent draught on the e8-h5 diagonal. This is what you play when you want to attack the king.",
    "英国式开局·反西西里":
      "The Sicilian with colours reversed and an extra tempo for White. The fastest way to understand the English is to understand the Sicilian first.",
    "英国式开局·对称主变":
      "Both sides mirror each other, and whoever breaks the symmetry first must answer for it. These positions test judgement about when to commit, not memory.",
    "列蒂开局·主变":
      "White does not commit a centre pawn, aiming at the centre from a distance with both bishops instead, and decides between d4 and e4 only once Black has committed.",
    "王翼印度攻击·主变":
      "The King's Indian Defence with colours reversed: one set-up against almost anything Black plays, and after e4-e5 the attack goes straight at the king.",
    "西西里防御·史密斯-莫拉弃兵":
      "White gives a pawn for the open c- and d-files and a two-move lead in development. If Black slows down anywhere, the position collapses.",
    "法兰西防御·王翼印度式":
      "White declines to enter the French theory forest and sets up the King's Indian Attack instead: e4-e5 shuts the centre, then everything heads for the kingside.",
    "意大利开局·极慢变例":
      "Literally 'the very quiet game': White does not rush d4 and puts every piece on its best square first. Ideal for anyone who would rather learn placement than memorise lines.",
    "格林菲尔德防御·现代交换":
      "White lifts the rook to b1 against ...Qa5 in advance and develops quietly with Be2. Currently the most popular treatment of the Exchange.",
    "尼姆佐-印度防御·古典变例":
      "White recaptures with the queen so the pawns stay healthy — at the price of an exposed queen and two tempi of development.",
    "卡罗-康防御·古典·短易位":
      "White skips h4 and simply develops and castles short. Much quieter than the h4-h5 lines, and correspondingly easier for Black to handle.",
    "荷兰防御·列宁格勒变例":
      "Black grafts the King's Indian bishop onto the Dutch f-pawn: the g7 bishop on the long diagonal and an open f-file give the kingside attack two roads.",
    "半斯拉夫防御·反梅兰":
      "White's Qc2 eyes e4 and h7 in advance and denies Black the comfortable Meran. Slower, but sturdier.",
    "西班牙开局·柏林·反柏林":
      "White plays d3 to sidestep the Berlin endgame and keep the middlegame on the board. The common top-level choice of the last decade: keep the queens, keep playing.",
    "西西里防御·罗索利莫":
      "White trades on move three and never enters the Sicilian theory ocean. Black gets the two bishops; White gets a healthy structure and a simple plan.",
    "西西里防御·罗索利莫·保象变例":
      "Black declines the trade and just castles. White builds with d4 and e5, and the game turns into a pawn-chain fight.",
    "斯拉夫防御·交换变例":
      "Completely symmetrical pawns, White a single tempo up. It looks drawish, and that tempo is genuinely hard to cash — but it never quite goes away.",
    "特龙波夫斯基进攻·主变":
      "White develops the bishop on move two and drags Black out of every Indian-defence preparation. On move seven c4 simply offers b2: the moves Black spends collecting the pawn, White spends developing.",
    "伦敦体系·对国王印度":
      "The same London shape against the fianchetto: Bf4 takes the e5 square in advance and h3 keeps h2 free as the bishop's retreat.",
    "中心开局·比萨普变例":
      "White develops the bishop before the knight and can steer into the Italian, the Vienna or its own paths. A common way around the Petrov.",
    "苏格兰弃兵":
      "White does not recapture on d4 and develops the bishop for time instead. On move seven e5 kicks the knight and Bb5 pins the other: both sides must calculate, because one slow move here costs a piece.",
    "阿廖欣防御·四兵攻击":
      "White pushes all four centre pawns: either they roll over Black or the chain collapses under its own weight. This is exactly what the Alekhine invites.",
    "国王印度防御·菲安凯托变例":
      "White fianchettoes too, blunting Black's g7 bishop before it starts. The soundest way to meet the King's Indian.",
    "半斯拉夫防御·诺特博姆":
      "Black takes on c4 and holds it with ...b5, ending up with two connected queenside passers; White gets the centre and the bishop pair. Two kinds of advantage, head on.",
    "法兰西防御·交换·对称变例":
      "The most symmetrical French: both sides have the same shape. To win you must break the balance yourself, and that move always costs something.",
};
})(typeof window !== "undefined" ? window : globalThis);
