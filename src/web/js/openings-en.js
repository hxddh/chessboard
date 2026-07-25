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
  };
})(typeof window !== "undefined" ? window : globalThis);
