/**
 * English opening names, keyed by the line id in openings.js.
 *
 * openings.js stays the single source of truth for the ECO code and the move
 * order; this file only renames. The key is an id rather than the ECO code
 * because several entries share a code (A00 alone covers five flank openings),
 * and rather than the Chinese name — which is what it was until 1.25 — because
 * a name is copy: editing one Chinese string there unkeyed this table and the
 * Japanese one at the same time, and the only symptom was both translations
 * quietly reverting to Chinese.
 *
 * scripts/test-chess.mjs checks every id in openings.js has an entry here and
 * that nothing here is orphaned.
 * @module openings-en
 */
  export const CHESS_OPENINGS_EN = {
    // A — flank openings
    "polish-sokolsky-opening": "Polish (Sokolsky) Opening",
    "grobs-attack": "Grob's Attack",
    "hungarian-opening": "Hungarian Opening",
    "van-t-kruijs-opening": "Van 't Kruijs Opening",
    "dunst-opening": "Dunst Opening",
    "larsens-opening": "Larsen's Opening",
    "birds-opening": "Bird's Opening",
    "reti-opening": "Réti Opening",
    "kings-indian-attack": "King's Indian Attack",
    "english-opening": "English Opening",
    "english-opening-symmetrical-variation": "English Opening: Symmetrical Variation",
    // A — queen's pawn sidelines and Indian defences
    "queens-pawn-opening": "Queen's Pawn Opening",
    "old-benoni-defense": "Old Benoni Defense",
    "indian-defense": "Indian Defense",
    "trompowsky-attack": "Trompowsky Attack",
    "london-system": "London System",
    "budapest-gambit": "Budapest Gambit",
    "old-indian-defense": "Old Indian Defense",
    "benoni-defense": "Benoni Defense",
    "benko-volga-gambit": "Benko (Volga) Gambit",
    "modern-benoni": "Modern Benoni",
    "dutch-defense": "Dutch Defense",
    // B — semi-open games
    "kings-pawn-opening": "King's Pawn Opening",
    "nimzowitsch-defense": "Nimzowitsch Defense",
    "scandinavian-defense": "Scandinavian Defense",
    "alekhines-defense": "Alekhine's Defense",
    "alekhines-defense-modern-variation": "Alekhine's Defense: Modern Variation",
    "modern-defense": "Modern Defense",
    "pirc-defense": "Pirc Defense",
    "caro-kann-defense": "Caro-Kann Defense",
    "caro-kann-defense-advance-variation": "Caro-Kann Defense: Advance Variation",
    "caro-kann-defense-exchange-variation": "Caro-Kann Defense: Exchange Variation",
    "caro-kann-defense-classical-variation": "Caro-Kann Defense: Classical Variation",
    "sicilian-defense": "Sicilian Defense",
    "smith-morra-gambit": "Smith-Morra Gambit",
    "sicilian-defense-alapin-variation": "Sicilian Defense: Alapin Variation",
    "closed-sicilian": "Closed Sicilian",
    "sicilian-defense-sveshnikov-variation": "Sicilian Defense: Sveshnikov Variation",
    "sicilian-defense-accelerated-dragon": "Sicilian Defense: Accelerated Dragon",
    "sicilian-defense-kan-variation": "Sicilian Defense: Kan Variation",
    "sicilian-defense-dragon-variation": "Sicilian Defense: Dragon Variation",
    "sicilian-defense-scheveningen-variation": "Sicilian Defense: Scheveningen Variation",
    "sicilian-defense-najdorf-variation": "Sicilian Defense: Najdorf Variation",
    // C — open games and the French
    "french-defense": "French Defense",
    "french-defense-exchange-variation": "French Defense: Exchange Variation",
    "french-defense-advance-variation": "French Defense: Advance Variation",
    "french-defense-tarrasch-variation": "French Defense: Tarrasch Variation",
    "french-defense-classical-variation": "French Defense: Classical Variation",
    "french-defense-winawer-variation": "French Defense: Winawer Variation",
    "kings-pawn-game": "King's Pawn Game",
    "center-game": "Center Game",
    "bishops-opening": "Bishop's Opening",
    "vienna-game": "Vienna Game",
    "kings-gambit": "King's Gambit",
    "kings-gambit-accepted": "King's Gambit Accepted",
    "kings-knight-opening": "King's Knight Opening",
    "philidor-defense": "Philidor Defense",
    "russian-petrov-defense": "Russian (Petrov) Defense",
    "scotch-game": "Scotch Game",
    "three-knights-game": "Three Knights Game",
    "four-knights-game": "Four Knights Game",
    "four-knights-game-spanish-variation": "Four Knights Game: Spanish Variation",
    "italian-game": "Italian Game",
    "evans-gambit": "Evans Gambit",
    "italian-game-classical-variation": "Italian Game: Classical Variation",
    "two-knights-defense": "Two Knights Defense",
    "two-knights-defense-knight-attack": "Two Knights Defense: Knight Attack",
    "ruy-lopez-spanish-opening": "Ruy Lopez (Spanish Opening)",
    "ruy-lopez-berlin-defense": "Ruy Lopez: Berlin Defense",
    "ruy-lopez-exchange-variation": "Ruy Lopez: Exchange Variation",
    "ruy-lopez": "Ruy Lopez",
    "ruy-lopez-closed-variation": "Ruy Lopez: Closed Variation",
    // D/E — closed games and Indian defences
    "queens-pawn-game": "Queen's Pawn Game",
    "richter-veresov-attack": "Richter-Veresov Attack",
    "colle-system": "Colle System",
    "queens-gambit": "Queen's Gambit",
    "chigorin-defense": "Chigorin Defense",
    "albin-countergambit": "Albin Countergambit",
    "slav-defense": "Slav Defense",
    "queens-gambit-accepted": "Queen's Gambit Accepted",
    "queens-gambit-declined": "Queen's Gambit Declined",
    "queens-gambit-declined-exchange-variation": "Queen's Gambit Declined: Exchange Variation",
    "semi-slav-defense": "Semi-Slav Defense",
    "grunfeld-defense": "Grünfeld Defense",
    "grunfeld-defense-exchange-variation": "Grünfeld Defense: Exchange Variation",
    "catalan-opening": "Catalan Opening",
    "queens-indian-defense": "Queen's Indian Defense",
    "nimzo-indian-defense": "Nimzo-Indian Defense",
    "nimzo-indian-defense-classical-variation": "Nimzo-Indian Defense: Classical Variation",
    "nimzo-indian-defense-rubinstein-system": "Nimzo-Indian Defense: Rubinstein System",
    "kings-indian-defense": "King's Indian Defense",
      // —— 1.15 ——
    "ruy-lopez-closed-main-line": "Ruy Lopez, Closed Main Line",
    "ruy-lopez-marshall-attack": "Ruy Lopez, Marshall Attack",
    "ruy-lopez-exchange-main-line": "Ruy Lopez, Exchange Main Line",
    "ruy-lopez-berlin-endgame": "Ruy Lopez, Berlin Endgame",
    "italian-game-giuoco-piano": "Italian Game, Giuoco Piano",
    "two-knights-defence": "Two Knights Defence",
    "evans-gambit-main": "Evans Gambit",
    "scotch-game-classical": "Scotch Game, Classical",
    "petrov-defence": "Petrov Defence",
    "kings-gambit-kieseritzky": "King's Gambit, Kieseritzky",
    "vienna-gambit": "Vienna Gambit",
    "four-knights-game-main": "Four Knights Game",
    "four-knights-scotch": "Four Knights, Scotch Variation",
    "vienna-game-mieses": "Vienna Game, Mieses Variation",
    "caro-kann-exchange-main": "Caro-Kann, Exchange Main Line",
    "bogo-indian-defence": "Bogo-Indian Defence",
    "philidor-defence-classical": "Philidor Defence, Classical",
    "scandinavian-defence-main-line": "Scandinavian Defence, Main Line",
    "alekhines-defence-modern-main-line": "Alekhine's Defence, Modern Main Line",
    "pirc-defence-classical": "Pirc Defence, Classical",
    "modern-defence-austrian-attack": "Modern Defence, Austrian Attack",
    "caro-kann-classical": "Caro-Kann, Classical",
    "caro-kann-advance": "Caro-Kann, Advance",
    "caro-kann-panov-attack": "Caro-Kann, Panov Attack",
    "sicilian-najdorf": "Sicilian Najdorf",
    "sicilian-dragon-yugoslav-attack": "Sicilian Dragon, Yugoslav Attack",
    "sicilian-sveshnikov": "Sicilian Sveshnikov",
    "accelerated-dragon-maroczy-bind": "Accelerated Dragon, Maroczy Bind",
    "sicilian-scheveningen": "Sicilian Scheveningen",
    "sicilian-taimanov": "Sicilian Taimanov",
    "closed-sicilian-main": "Closed Sicilian",
    "sicilian-alapin-2-nf6": "Sicilian Alapin, 2...Nf6",
    "french-winawer": "French Winawer",
    "french-classical": "French Classical",
    "french-tarrasch-open-variation": "French Tarrasch, Open Variation",
    "french-advance": "French Advance",
    "queens-gambit-declined-tartakower": "Queen's Gambit Declined, Tartakower",
    "qgd-exchange-minority-attack": "QGD Exchange, Minority Attack",
    "slav-defence-main-line": "Slav Defence, Main Line",
    "semi-slav-meran": "Semi-Slav, Meran",
    "queens-gambit-accepted-main": "Queen's Gambit Accepted",
    "tarrasch-defence": "Tarrasch Defence",
    "london-system-main-line": "London System, Main Line",
    "nimzo-indian-rubinstein": "Nimzo-Indian, Rubinstein",
    "queens-indian-defence": "Queen's Indian Defence",
    "kings-indian-defence-classical": "King's Indian Defence, Classical",
    "kings-indian-defence-samisch": "King's Indian Defence, Sämisch",
    "grunfeld-exchange-classical": "Grünfeld Exchange, Classical",
    "modern-benoni-main-line": "Modern Benoni, Main Line",
    "benko-gambit-accepted": "Benko Gambit, Accepted",
    "catalan-opening-closed": "Catalan Opening, Closed",
    "dutch-defence-classical": "Dutch Defence, Classical",
    "dutch-defence-stonewall": "Dutch Defence, Stonewall",
    "english-opening-reversed-sicilian": "English Opening, Reversed Sicilian",
    "english-symmetrical-main-line": "English Symmetrical, Main Line",
    "reti-opening-main-line": "Réti Opening, Main Line",
    "kings-indian-attack-main-line": "King's Indian Attack, Main Line",
    "smith-morra-gambit-main": "Smith-Morra Gambit",
    "french-defence-kings-indian-attack": "French Defence, King's Indian Attack",
    "italian-game-giuoco-pianissimo": "Italian Game, Giuoco Pianissimo",
    "grunfeld-defence-modern-exchange": "Grünfeld Defence, Modern Exchange",
    "nimzo-indian-classical": "Nimzo-Indian, Classical",
    "caro-kann-classical-short-castles": "Caro-Kann, Classical, Short Castles",
    "dutch-defence-leningrad": "Dutch Defence, Leningrad",
    "semi-slav-anti-meran": "Semi-Slav, Anti-Meran",
    "ruy-lopez-berlin-anti-berlin": "Ruy Lopez, Berlin, Anti-Berlin",
    "sicilian-rossolimo": "Sicilian Rossolimo",
    "sicilian-rossolimo-nd4": "Sicilian Rossolimo, ...Nd4",
    "slav-defence-exchange": "Slav Defence, Exchange",
    "trompowsky-attack-main-line": "Trompowsky Attack, Main Line",
    "london-system-vs-kings-indian": "London System vs King's Indian",
    "bishops-opening-berlin-defence": "Bishop's Opening, Berlin Defence",
    "scotch-gambit": "Scotch Gambit",
    "alekhines-defence-four-pawns-attack": "Alekhine's Defence, Four Pawns Attack",
    "kings-indian-fianchetto": "King's Indian, Fianchetto",
    "semi-slav-noteboom": "Semi-Slav, Noteboom",
    "french-exchange-symmetrical": "French Exchange, Symmetrical",
};

  /**
   * English text for the "idea" line the opening drills show under the task.
   *
   * Same key as the names above — the Chinese name in openings.js — and the
   * same rule: openings.js owns the moves, this file owns only the words. Only
   * every line long enough to be drilled carries an idea, so only those need an
   * entry; scripts/test-chess.mjs checks that set exactly.
   */
  export const CHESS_OPENING_IDEAS_EN = {
    "benko-volga-gambit": "Black gives up the b-pawn to rip open the a- and b-files, then leans on the queenside forever with two rooks and the bishop — a pawn for lasting pressure.",
    "modern-benoni": "Black accepts less space in return for the ...e6 break against White's pawn chain, with ...b5 to follow on the queenside.",
    "alekhines-defense-modern-variation": "Black invites the knight to be chased, luring White's pawns too far forward, then turns round and attacks the overextended chain.",
    "caro-kann-defense-exchange-variation": "The exchange leaves a symmetrical, clear-cut position: White plays for a small edge and fast development, Black for solidity and simplification.",
    "caro-kann-defense-classical-variation": "Black solves the problem piece first — the c8 bishop comes out before ...e6 shuts it in — and only then completes development.",
    "sicilian-defense-sveshnikov-variation": "...e5 grabs the centre and kicks the knight, at the permanent cost of the d5 square: sharp space for a weak square.",
    "sicilian-defense-accelerated-dragon": "The g7 bishop eyes the long diagonal while ...d5 comes in one go — the Dragon's idea, a tempo faster.",
    "sicilian-defense-kan-variation": "...a6 takes b5 away from the knights and prepares ...b5 on the wing with ...Bb7 behind it.",
    "sicilian-defense-dragon-variation": "The bishop goes to g7 and both sides attack on opposite wings: White throws the h-pawn at the king, Black comes down the c-file.",
    "sicilian-defense-scheveningen-variation": "Black builds the small, solid d6+e6 shell, keeps the pieces behind it, and waits for ...d5 or ...b5.",
    "sicilian-defense-najdorf-variation": "...a6 is the soul of the Najdorf: it covers b5 and prepares both ...e5 for the centre and ...b5 on the queenside.",
    "french-defense-exchange-variation": "Symmetrical pawns and castling on the same side: whoever gets the more active pieces and presses first on the e-file stands better.",
    "french-defense-classical-variation": "Black develops straight at e4; White usually pushes e5 to lock it, and the game turns on the d4/d5 pawn chains.",
    "french-defense-winawer-variation": "The bishop pins the c3 knight to hit e4 at once; White plays a3 to make it decide, taking the bishop pair and a big centre in return.",
    "scotch-game": "White opens the centre early and gets the pieces out fast — symmetry of structure traded for speed of development.",
    "four-knights-game": "Both sides bring the minor pieces out symmetrically: the most orthodox opening there is, and the one that follows the three opening rules most literally.",
    "four-knights-game-spanish-variation": "Inside the symmetry White adds Bb5 to press on c6, trying to break the balance first.",
    "italian-game": "Both bishops aim at the opponent's weakest square (f7 and f2) — the slow, manoeuvring \"Quiet Italian\".",
    "evans-gambit": "White throws in the b-pawn for time: the payoff is c3+d4, a big centre and a fast, violent attack.",
    "italian-game-classical-variation": "c3 prepares d4: White wants the full pawn centre, turning the bishops' aim into real space.",
    "two-knights-defense": "Black counterattacks e4 instead of defending e5, steering the game into sharp tactical waters.",
    "two-knights-defense-knight-attack": "The knight jumps at f7 — one of the oldest traps in chess; Black must hit back with ...d5 rather than scramble to save the pawn.",
    "ruy-lopez-berlin-defense": "Black ignores ...a6 and develops with pressure on e4; the exchanges lead to a simplified, structurally solid endgame.",
    "ruy-lopez-exchange-variation": "White gives up the good bishop to damage Black's pawn structure, playing for the endgame.",
    "ruy-lopez": "The bishop retreats to a4 to keep the pin alive while Black gets ...b5 as counterplay — the main crossroads of the Ruy Lopez.",
    "ruy-lopez-closed-variation": "Both sides finish developing and castle; White prepares c3+d4 for the centre, Black waits for ...d5 or queenside expansion.",
    "slav-defense": "Black props up d5 with c6 while leaving the c8 bishop a way out — a more flexible way to hold the centre than the Queen's Gambit Declined.",
    "queens-gambit-declined-exchange-variation": "The exchange produces the classic minority attack: White advances pawns on the queenside, Black looks for chances on the kingside.",
    "queens-gambit-declined": "Both sides develop steadily without hurrying to exchange; White keeps the central tension, Black waits for the right moment for ...dxc4 or ...c5.",
    "semi-slav-defense": "Black keeps both ...dxc4 and ...b5 in reserve — one of the deepest theoretical battlegrounds in chess.",
    "grunfeld-defense": "Black lets White build the big centre, then takes it apart from the side with ...c5 and the g7 bishop — hypermodern thinking in one line.",
    "grunfeld-defense-exchange-variation": "White gets the ideal pawn centre; Black's entire case rests on dismantling it.",
    "catalan-opening": "The bishop goes to g2 and leans down the long diagonal at d5 — a solid and flexible modern system.",
    "queens-indian-defense": "The bishop on b7 watches e4 from afar and, with the knights, holds the key central squares.",
    "nimzo-indian-defense": "The bishop pins the c3 knight to fight for e4 — one active bishop traded for White's bishop pair.",
    "nimzo-indian-defense-classical-variation": "Qc2 defends the pawn structure in advance, so White keeps the bishop pair without damage.",
    "nimzo-indian-defense-rubinstein-system": "White develops in the plainest way possible, accepting a possible structural flaw for the centre and the two bishops.",
    "kings-indian-defense": "Black hands over the centre, hits back with ...e5 or ...c5, and after castling throws everything at the king — as sharp as openings get.",
      // —— 1.15 ——
    "ruy-lopez-closed-main-line":
      "The Spanish main road. White plays c3 to prepare d4 and h3 to stop ...Bg4 before committing; Black holds e5 with ...b5 and ...d6. Neither side hurries — the real game starts in the middlegame.",
    "ruy-lopez-marshall-attack":
      "Black gives up the e-pawn on move eight for the open e-file, a big centre and every piece pointing at White's king. A century on, White still has not shown the pawn is safe to keep.",
    "ruy-lopez-exchange-main-line":
      "White wrecks his own bishop pair to wreck Black's pawns: the doubled c-pawns mean White's four-against-three on the kingside is a clean majority in the endgame. The price is Black's two bishops.",
    "ruy-lopez-berlin-endgame":
      "The queens come off at move eight. Black loses castling but keeps two bishops and a structure that is very hard to break. It turns the Spanish into an endgame, which is exactly why the top boards play it.",
    "italian-game-giuoco-piano":
      "Both sides put a bishop on its longest diagonal and prepare d4 slowly. The modern handling is d3 rather than an early d4: finish developing first, push later.",
    "two-knights-defence":
      "Black gives a pawn to chase the knight home, and gets a lead in development plus the open e- and d-files. This is where most players first taste giving material for time.",
    "evans-gambit-main":
      "White spends the b-pawn to gain a tempo: c3 and d4 build the big centre in one go and the bishop is back on the c4 diagonal. A nineteenth-century attacking weapon that still bites.",
    "scotch-game-classical":
      "White trades centre pawns on move three and the position opens at once. This is not about slow pressure — it is about being a tempo faster in development.",
    "petrov-defence":
      "Instead of defending e5, Black takes symmetrically. The position tends towards balance and clarity — the classical choice when Black wants a quiet game.",
    "kings-gambit-kieseritzky":
      "The romantic era's main line: White gives the f-pawn on move two for the centre and the f-file. Not objectively best today, but everyone learning chess should play it once.",
    "vienna-gambit":
      "The sane version of the King's Gambit: develop the knight first, then push f4. Black's ...d5 is the one correct answer.",
    "four-knights-game-main":
      "All four knights come out and the position stays symmetrical and quiet. What it teaches is the order itself: develop, castle, then look for a plan.",
    "four-knights-scotch":
      "The lowest-memory White choice in the Four Knights: d4 trades the centre open, and Black gets the d5 pawn along with its isolating tendencies. Both sides know exactly what they are playing for.",
    "vienna-game-mieses":
      "White does not fight for d5; after Black trades the knight, the g2 bishop and the half-open b-file become the long-term story. Quiet, but every move is laying middlegame groundwork.",
    "caro-kann-exchange-main":
      "The whole Exchange Variation is about b7: Bd3 plus Qb3 forces Black's queen to babysit c8 while White finishes developing first. The structure is symmetrical — the tempo is the entire asset.",
    "bogo-indian-defence":
      "Check once to lure the bishop to d2, then trade it off at leisure: Black gives up the bishop pair for an e5-d6 fortress that White finds very hard to break open.",
    "philidor-defence-classical":
      "Black defends e5 with a pawn rather than a knight: cramped but solid. The square to watch is f7, where White's bishop and rook are both looking.",
    "scandinavian-defence-main-line":
      "Black challenges the centre on move one and pays with a tempo after Nc3. The upside is simplicity: few paths, and almost no chance of being blown away by preparation.",
    "alekhines-defence-modern-main-line":
      "Black invites the knight to be chased so that White's pawns advance too far, then goes back to chew on the over-extended chain. Provocation as an opening system.",
    "pirc-defence-classical":
      "Black cedes the centre, lets White fill it, then pushes back from the side with ...c6 and ...e5. It needs patience and a tolerance for being squeezed.",
    "modern-defence-austrian-attack":
      "Even more delayed than the Pirc: Black puts the bishop on the long diagonal and expands on the queenside first, saving the knight's square until White has committed.",
    "caro-kann-classical":
      "The whole point of the Caro-Kann is getting the light-squared bishop out before ...e6 shuts it in. The price is White's h4-h5 space, and the bishop parking on h7 for a while.",
    "caro-kann-advance":
      "White closes the centre for space. Black's key is getting the light-squared bishop to f5 first: once ...e6 shuts it in, the position is unplayable. With the bishop out, ...Ne7-g6 comes back at e5.",
    "caro-kann-panov-attack":
      "White turns the Caro-Kann into an isolated-pawn position: d4 is isolated, and in return White gets active pieces and the e5 and c5 outposts. The standard textbook on how to play the IQP.",
    "sicilian-najdorf":
      "...a6 looks slow but it prepares ...b5 and keeps White's pieces off b5. Black accepts the hole on d5 in exchange for the whole queenside initiative.",
    "sicilian-dragon-yugoslav-attack":
      "Opposite-side castling, each side pushing pawns at the other king; whoever arrives first wins. Black's g7 bishop looks all the way down to b2, and that is exactly what White is playing against.",
    "sicilian-sveshnikov":
      "Black deliberately concedes a permanent hole on d5 for space on e5, the bishop pair and the ...b5 push. Considered suicidal twenty years ago; mainstream now.",
    "accelerated-dragon-maroczy-bind":
      "White's c4 and e4 lock d5 down so that neither ...d5 nor ...b5 works for a while. Breaking a bind means trading pieces, and this is where most players learn it.",
    "sicilian-scheveningen":
      "The small centre of d6 and e6 is low but has no weaknesses; Black waits for White's pawn storm to create a target. The most patient branch of the Sicilian.",
    "sicilian-taimanov":
      "Black leaves the d-pawn and the dark-squared bishop uncommitted, with the queen on c7 pressing the c-file and e4. Flexibility is the whole point.",
    "closed-sicilian-main":
      "White refuses to trade centre pawns and plays the Sicilian like a King's Indian Attack: f4-f5 at Black's king, ...b5 at White's. Almost no theory to memorise.",
    "sicilian-alapin-2-nf6":
      "White prepares d4 and a big centre on move two, sidestepping every main line of the Sicilian. The cost is one tempo of development.",
    "french-winawer":
      "Black trades bishop for knight to leave White with doubled c-pawns, then piles on d4. White's compensation is the bishop pair and the kingside attack.",
    "french-classical":
      "White grabs space with e5, Black retreats the knight to d7 and hits the base of the chain with ...c5. The classic pawn-chain race: one side storms the kingside, the other eats the base.",
    "french-tarrasch-open-variation":
      "Nd2 avoids the ...Bb4 pin at the cost of blocking White's own bishop. The position opens up quickly and often becomes an isolated-pawn structure.",
    "french-advance":
      "Once the centre locks, the game becomes two separate fights: White on the kingside, Black against d4 and down the c-file. Black's light-squared bishop is the hardest piece in the game to place.",
    "queens-gambit-declined-tartakower":
      "...b6 solves the problem piece — the light-squared bishop — by putting it on the long diagonal, and two pairs come off to ease the cramp. The modern standard treatment of the QGD.",
    "qgd-exchange-minority-attack":
      "White clarifies with the c-pawn trade and prepares the queenside pawn push b4-b5 against c6. The plan has a name: the minority attack.",
    "slav-defence-main-line":
      "...c6 keeps f5 free for the light-squared bishop before taking on c4. That is exactly why the Slav feels better than the QGD: the bishop never gets shut in by its own pawns.",
    "semi-slav-meran":
      "Black takes on c4, then ...b5 and ...c5 win two files' worth of queenside space; White answers with e4 in the centre. Both sides are fast, and a single slow move loses.",
    "queens-gambit-accepted-main":
      "Black never intends to hold the pawn — it buys the time for ...c5 against the centre. Queens come off early because Black is heading straight for a comfortable endgame.",
    "tarrasch-defence":
      "Black volunteers for the isolated pawn in exchange for completely free pieces and the e4 and c4 outposts. The whole game asks one question: does activity pay for a structural weakness?",
    "london-system-main-line":
      "White plays d4-Nf3-Bf4-e3-c3-Nbd2 almost regardless of what Black does. Very little to memorise; the cost is that it asks Black no hard questions.",
    "nimzo-indian-rubinstein":
      "Black pins the c3 knight on move three, intending to trade it off and leave White with doubled c-pawns. The classic case of trading bishop for knight to fix the structure.",
    "queens-indian-defence":
      "With Nf3 already covering the c3 square, Black switches to ...b6 to fight for e4 from a distance. The whole opening is about that one square.",
    "kings-indian-defence-classical":
      "Once the centre locks, each side storms the other's wing: White with c4-c5, Black with ...f5-f4-g5 at White's king. Few positions in chess divide so cleanly.",
    "grunfeld-exchange-classical":
      "Black lets White build the big centre, then dismantles it with the g7 bishop and ...c5. Let him build it, then take it apart — that is the whole Grünfeld idea.",
    "modern-benoni-main-line":
      "Black accepts less space in return for the rook on the e-file, the g7 bishop and the queenside majority behind ...b5. Activity instead of comfort.",
    "benko-gambit-accepted":
      "Black gives a pawn to open the a- and b-files, and the two rooks plus the bishop lean on White's queenside for the entire game. The pawn is gone; the pressure never is.",
    "catalan-opening-closed":
      "White fianchettoes on g2 and lets Black take on c4, then spends a few moves winning the pawn back. By the time it comes back, the bishop is already in place.",
    "dutch-defence-classical":
      "Black fights for e4 with the f-pawn on move one, at the cost of a permanent draught on the e8-h5 diagonal. This is what you play when you want to attack the king.",
    "dutch-defence-stonewall":
      "Black builds a wall on d5-e6-f5-c6, welds e4 shut and swings every piece at the kingside. The price is the e5 square and a light-squared bishop stuck behind its own pawns — a trade made with open eyes.",
    "kings-indian-defence-samisch":
      "White props up e4 with f3 and then pushes g4-h4 straight at the king. The bluntest line in the King's Indian: each side attacks on its own wing, and whoever is a move slow gets mated.",
    "english-opening-reversed-sicilian":
      "The Sicilian with colours reversed and an extra tempo for White. The fastest way to understand the English is to understand the Sicilian first.",
    "english-symmetrical-main-line":
      "Both sides mirror each other, and whoever breaks the symmetry first must answer for it. These positions test judgement about when to commit, not memory.",
    "reti-opening-main-line":
      "White does not commit a centre pawn, aiming at the centre from a distance with both bishops instead, and decides between d4 and e4 only once Black has committed.",
    "kings-indian-attack-main-line":
      "The King's Indian Defence with colours reversed: one set-up against almost anything Black plays, and after e4-e5 the attack goes straight at the king.",
    "smith-morra-gambit-main":
      "White gives a pawn for the open c- and d-files and a two-move lead in development. If Black slows down anywhere, the position collapses.",
    "french-defence-kings-indian-attack":
      "White declines to enter the French theory forest and sets up the King's Indian Attack instead: e4-e5 shuts the centre, then everything heads for the kingside.",
    "italian-game-giuoco-pianissimo":
      "Literally 'the very quiet game': White does not rush d4 and puts every piece on its best square first. Ideal for anyone who would rather learn placement than memorise lines.",
    "grunfeld-defence-modern-exchange":
      "White lifts the rook to b1 against ...Qa5 in advance and develops quietly with Be2. Currently the most popular treatment of the Exchange.",
    "nimzo-indian-classical":
      "White recaptures with the queen so the pawns stay healthy — at the price of an exposed queen and two tempi of development.",
    "caro-kann-classical-short-castles":
      "White skips h4 and simply develops and castles short. Much quieter than the h4-h5 lines, and correspondingly easier for Black to handle.",
    "dutch-defence-leningrad":
      "Black grafts the King's Indian bishop onto the Dutch f-pawn: the g7 bishop on the long diagonal and an open f-file give the kingside attack two roads.",
    "semi-slav-anti-meran":
      "White's Qc2 eyes e4 and h7 in advance and denies Black the comfortable Meran. Slower, but sturdier.",
    "ruy-lopez-berlin-anti-berlin":
      "White plays d3 to sidestep the Berlin endgame and keep the middlegame on the board. The common top-level choice of the last decade: keep the queens, keep playing.",
    "sicilian-rossolimo":
      "White trades on move three and never enters the Sicilian theory ocean. Black gets the two bishops; White gets a healthy structure and a simple plan.",
    "sicilian-rossolimo-nd4":
      "Black declines the trade and just castles. White builds with d4 and e5, and the game turns into a pawn-chain fight.",
    "slav-defence-exchange":
      "Completely symmetrical pawns, White a single tempo up. It looks drawish, and that tempo is genuinely hard to cash — but it never quite goes away.",
    "trompowsky-attack-main-line":
      "White develops the bishop on move two and drags Black out of every Indian-defence preparation. On move seven c4 simply offers b2: the moves Black spends collecting the pawn, White spends developing.",
    "london-system-vs-kings-indian":
      "The same London shape against the fianchetto: Bf4 takes the e5 square in advance and h3 keeps h2 free as the bishop's retreat.",
    "bishops-opening-berlin-defence":
      "White develops the bishop before the knight and can steer into the Italian, the Vienna or its own paths. A common way around the Petrov.",
    "scotch-gambit":
      "White does not recapture on d4 and develops the bishop for time instead. On move seven e5 kicks the knight and Bb5 pins the other: both sides must calculate, because one slow move here costs a piece.",
    "alekhines-defence-four-pawns-attack":
      "White pushes all four centre pawns: either they roll over Black or the chain collapses under its own weight. This is exactly what the Alekhine invites.",
    "kings-indian-fianchetto":
      "White fianchettoes too, blunting Black's g7 bishop before it starts. The soundest way to meet the King's Indian.",
    "semi-slav-noteboom":
      "Black takes on c4 and holds it with ...b5, ending up with two connected queenside passers; White gets the centre and the bishop pair. Two kinds of advantage, head on.",
    "french-exchange-symmetrical":
      "The most symmetrical French: both sides have the same shape. To win you must break the balance yourself, and that move always costs something.",
};
