/**
 * English text for the thirty games of classics-more.js (v8-4-plan T2).
 *
 * Only prose is translated: player names, the event, the intro and the
 * notes. Moves, years, ECO codes and results stay in classics-more.js.
 * Shape: { [gameId]: { white, black, event, intro, notes: { [ply]: text } } }.
 * scripts/test-classics.mjs asserts the note plies match the originals.
 * @module classics-more-en
 */
export const CHESS_CLASSICS_MORE_EN = {
  "labourdonnais-mcdonnell-1834": {
    white: "Louis de la Bourdonnais", black: "Alexander McDonnell", event: "London match",
    intro: "In the summer of 1834 the Frenchman La Bourdonnais and the Irishman McDonnell played more than eighty games in London — the first long match whose scores survive in full. In this one McDonnell gives up his queen for two minor pieces and a white king that never gets home.",
    notes: {
      17: "9.Kf1? The king steps to f1 and can never castle; the engine prefers 9.Kxf2, simply taking the bishop. The price of this only shows on move 13.",
      26: "13...Nxd5! McDonnell lets White take the queen: after Bxe7, Ne3+ checks first and the king takes the bishop back — queen for knight and bishop, with White's king still stuck in the middle.",
      48: "24...Nxd2 Both knights are deep in White's camp and have eaten a rook too. Count: Black has two rooks, a bishop and two knights; White a queen, a rook and a bishop.",
      72: "36...Ne3 White resigns: the king is trapped on h4, and after ...Rh6 White either loses the queen or lets the f-pawn run to the last rank.",
    },
  },
  "paulsen-morphy-1857": {
    white: "Louis Paulsen", black: "Paul Morphy", event: "New York (First American Chess Congress)",
    intro: "Twenty-year-old Morphy against Paulsen in the final of the First American Chess Congress. For sixteen moves nothing much happens except a black queen parked on d3, choking White's queenside; on move 17 Morphy gives the queen away.",
    notes: {
      24: "12...Qd3 The queen sits on d3: the d2-pawn cannot move, so neither the c1-bishop nor the a1-rook can come out. Half of White's army is locked in by one queen.",
      34: "17...Qxf3!! A queen sacrifice: after gxf3, Rg6+ and Bh3 shut the white king in the corner, and White's queen on a6 is too far away to help.",
      39: "20.Rd1? The engine prefers 20.Qd3, bringing the queen back to the king; after the rook move the bishop checks its way to the f3-pawn and White cannot hold.",
      42: "21...Bxf3+ Black is in no hurry to take material back; first the check picks up the f3-pawn too — the cover around White's king is taken apart piece by piece.",
      50: "25...Bxf1 White had to give the queen back to stop mate. Black is already ahead in material and the position is one-way traffic.",
      56: "28...Be3 White resigns: Black is two pawns up, with two rooks and a bishop facing a bare king, and ...Rxh2+ cannot be stopped.",
    },
  },
  "bird-morphy-1858": {
    white: "Henry Bird", black: "Paul Morphy", event: "London",
    intro: "A game from Morphy's 1858 visit to Europe. White has just castled long when Black throws a rook into f2 — what looks like an aimless sacrifice on the kingside is aimed at the white king on the other wing.",
    notes: {
      6: "3...f5 The sharpest way to play the Philidor: instead of holding e5, Black hits White's centre first.",
      34: "17...Rxf2!! White has just castled long and Morphy gives up a rook: Bxf2 drags the bishop off e3, the third rank opens, and the queen on h3 can reach a3 in one move.",
      36: "18...Qa3!! This is what the rook was for: the queen jumps to the king's doorstep, and bxa3 is met by Bxa3 mate.",
      43: "22.Kb2? The king walks forward straight into the coming Bxb4; the engine says retreating with 22.Kc1 still holds.",
      44: "22...Bxb4 A second piece goes, and the b-file is wide open. Black's rook and queen attack down the a- and b-files together.",
      58: "29...Qb1+ White resigns: after ...Qxh1 Black has the material back and the king is still being checked.",
    },
  },
  "zukertort-blackburne-1883": {
    white: "Johannes Zukertort", black: "Joseph Blackburne", event: "London",
    intro: "Zukertort won London 1883 three points ahead of Steinitz. Here a quiet, closed opening pushes Black's pieces to the queenside, then the kingside is blown open in one go — the queen move on move 28 is known as Zukertort's Immortal.",
    notes: {
      19: "10.Nb5 The knight goes to trade off Black's dark-squared bishop. From now on the b2-bishop has no rival on the long diagonal.",
      37: "19.e5 The centre pawn advances and drives the knight back to e8. With d4–e5 locked, Black's pieces are squeezed onto the queenside.",
      49: "25.fxg6 The kingside lines are open: the h-pawn, the f-file and the b2-bishop's diagonal all point at the black king. Black's Rc2 then hits the queen, and White simply ignores it.",
      55: "28.Qb4!! The queen steps right in front of Black's queen: Qxb4 is met by Bxe5+ and a run of checks that mates. Black can neither take nor defend.",
      65: "33.Qxe7 Black resigns: White is a whole queen up and the few checks left only delay the end.",
    },
  },
  "chigorin-steinitz-1890": {
    white: "Mikhail Chigorin", black: "Wilhelm Steinitz", event: "Cable match",
    intro: "World champion Steinitz wrote that the Evans Gambit was unsound, so Chigorin challenged him to two games by telegraph to prove otherwise. Steinitz lost both; this is the Evans Gambit.",
    notes: {
      7: "4.b4 The Evans Gambit: White gives a pawn for the two tempi of c3 and d4 in the centre.",
      14: "7...Nh6 Steinitz's own idea: the knight goes to the edge, keeps the f-pawn free and still watches f7. He believed that a pawn up, if you can hold, is a win.",
      27: "14.d6! Another pawn: after Bxd6 the d7-pawn and the c8-bishop still cannot move, the king stays in the centre, and b6 is handed to White's knight.",
      55: "28.Qxa8 Takes the rook. After Black's Qxc5 regains the bishop, White is the exchange up and Black's king still has no home.",
      75: "38.d6 Black resigns: the d-pawn is coming, the b6-rook and a5-queen bear on b7, and there is no defensive line left around the king.",
    },
  },
  "steinitz-chigorin-1892": {
    white: "Wilhelm Steinitz", black: "Mikhail Chigorin", event: "Havana (world championship, game 4)",
    intro: "Steinitz was known as the careful one, yet here he pushes the h-pawn before castling and finishes with a rook sacrifice. Piling up small advantages and striking when the moment comes were never in conflict for him.",
    notes: {
      21: "11.h4! The h-pawn goes with the king still in the centre: the centre is closed, so White's king is safe; Black has castled short, and once the h-file opens it is an attacking line.",
      25: "13.hxg6 The g6-pawn is traded and the h-file is open. The h1-rook bears on the black king without moving.",
      37: "19.O-O-O Castling long: the king goes to the queenside and the other rook joins the d-file. All of Steinitz's pieces are now in play.",
      47: "24.Rxh7+!! A rook sacrifice: after Kxh7, Qh1+ and Bh6+ drive the king from the kingside all the way into the centre.",
      55: "28.Qxd4+ Black resigns: Kf5 is met by g4 mate.",
    },
  },
  "pillsbury-lasker-1896": {
    white: "Harry Nelson Pillsbury", black: "Emanuel Lasker", event: "St Petersburg 1895/96",
    intro: "From a four-player tournament. White castles long, Black gives up two rooks on the c-file, and the white king is chased from b1 to its death on a5. Eight years later the two reached the same position at Cambridge Springs (the next game in the list).",
    notes: {
      15: "8.O-O-O White castles long, with the king right beside the c-file. Black answers at once with Qa5, eyeing c3 and a2.",
      34: "17...Rxc3! The rook for a knight, opening the c- and b-files in front of the king. White's capture of the bishop is only a moment's gain.",
      36: "18...Ra3!! Another rook: after bxa3, Qb6+ drives the king off b1, and the queenside pawns shelter nothing.",
      37: "19.exf7+ Pillsbury takes f7 first. The engine prefers 19.bxa3 at once: the check gives Black the time for Rxf7, bringing the rook back into play.",
      55: "28.Kxa3? White has taken both rooks, but the king has walked to a3. The engine says 28.Qf5+ still draws by perpetual check; after taking the rook, every move is a black check.",
      64: "32...Bxb6#. White is two rooks up and mated at the far side of the board.",
    },
  },
  "pillsbury-lasker-1904": {
    white: "Harry Nelson Pillsbury", black: "Emanuel Lasker", event: "Cambridge Springs",
    intro: "The first six moves are the same as the 1896 game before it. Pillsbury is said to have kept his seventh move ready for eight years; here he finally played it.",
    notes: {
      13: "7.Bxf6! Eight years earlier he played 7.Qh4 here. Taking the f6-knight first wrecks Black's kingside pawns.",
      26: "13...Qxb2 Black grabs a pawn and the queen ends up on b2; White uses the moves to castle and develop, and the attacking lines on the kingside are ready.",
      33: "17.Nd6+ The knight jumps in with check; the king must go to f8 and will never castle.",
      38: "19...exf4? Lasker takes the pawn and opens the f-file; the engine prefers 19...Bb5, trading off White's e2-bishop first. Pillsbury's rook and queen come in along the f-file at once.",
      51: "26.Rxf5+! The rook is offered on f5: after Qxf5, Rf1 deflects the queen, and White gets the queen for two rooks with the attack still going.",
      59: "30.Ne5 Black resigns: after Qf7+ White's queen checks and captures its way through Black's camp, and neither e7 nor h8 can be held.",
    },
  },
  "rubinstein-lasker-1909": {
    white: "Akiba Rubinstein", black: "Emanuel Lasker", event: "St Petersburg",
    intro: "Lasker and Rubinstein shared first place at St Petersburg 1909, and their own game went to Rubinstein. A run of trades leaves a rook ending — Rubinstein's rook endings are still the textbook.",
    notes: {
      33: "17.Rxc6+ The rook for the bishop, breaking up the pawns in front of the black king. Qc1 then hits the e3-rook, and White gets the material back with a pawn extra.",
      46: "23...Kxe7 Queens are off and White has an extra pawn in the rook ending. More important: White's rook is active and Black's is passive.",
      53: "27.Ra5 The rook goes round to the side of Black's pawns, hitting a7 while watching the fifth rank. A good rook attacks pawns from the side or from behind.",
      65: "33.h5! Black's kingside pawns are fixed on light squares, and the white king's road from f4 to f5 is open.",
      79: "40.a3 Lasker resigns: the white king holds f5 and the rook on the sixth rank presses h6 and the a-pawn; Black's king and rook can only shuffle while the pawns fall one by one.",
    },
  },
  "levitsky-marshall-1912": {
    white: "Stepan Levitsky", black: "Frank Marshall", event: "Breslau (the Gold Coins Game)",
    intro: "Legend has it that when Marshall made his last move the spectators showered the board with gold coins. The queen stands where three white pieces attack it, and none of them can take it.",
    notes: {
      22: "11...fxe6 Black gets a half-open f-file in return. Both black rooks will soon be on it.",
      38: "19...Nd4 The knight lands in the centre, eyeing e2, f3 and f5 — White's queen cannot leave the kingside any more.",
      39: "20.Qh5? The queen goes to h5 and leaves the defence of e2 and e4; the engine prefers 20.Qe4. Black's rooks soon swing from the f-file to the h-file.",
      44: "22...Rxh3 The rook takes the bishop and only pawns are left to shield White's king. White's rook goes to c5 to hit the queen, which is exactly what Marshall was waiting for.",
      46: "23...Qg3!! White resigns: hxg3 Ne2#; fxg3 Ne2+ Kh1 Rxf1#; Qxg3 Ne2+ Kh1 Nxg3+, and Black takes the queen back a rook ahead.",
    },
  },
  "edlasker-thomas-1912": {
    white: "Edward Lasker", black: "George Thomas", event: "London (casual game)",
    intro: "The most famous king hunt in history: drawn out by a queen sacrifice, the black king walks from g8 all the way to g1 and is mated by a move of the white king. (Edward Lasker is not the world champion Emanuel Lasker.)",
    notes: {
      20: "10...Qe7? This allows the queen sacrifice. The engine's choice is 10...Bxe5, removing the e5-knight first; Guess the move still scores against the master's move, so playing Bxe5 here costs you nothing.",
      21: "11.Qxh7+!! The queen sacrifice: after Kxh7 the two knights check in turn and the king never gets back to h8.",
      27: "14.h4+ A pawn gives check and pushes the king further forward. Every move is a check, so Black has no time for anything else.",
      33: "17.Rh2+ The black king has reached g1, on White's own back rank.",
      35: "18.Kd2#. The king steps off the first rank and the a1-rook gives mate by discovery. (18.O-O-O# mates just as well.)",
    },
  },
  "lasker-capablanca-1914": {
    white: "Emanuel Lasker", black: "José Raúl Capablanca", event: "St Petersburg (final)",
    intro: "Lasker had to win this game to catch Capablanca, yet chose the quietest line, the Exchange Variation, with queens off early. He won it with one structural decision: move 12.",
    notes: {
      7: "4.Bxc6 The Exchange Variation: White gives up the bishop pair for a better pawn structure. Needing a win, Lasker walks into what looks like the most peaceful position there is.",
      23: "12.f5! White gives up e5 but turns e6 into a permanent outpost for the knight. Black's c8-bishop is buried behind its own pawns and never comes alive.",
      31: "16.Ne6 The knight settles on e6 and no black piece can chase it away. Black's rooks can only circle around it.",
      69: "35.e5! The centre pawn is given up to open e4 for the other knight. Black's defence is suddenly pulled apart.",
      83: "42.Nc5 Capablanca resigns: the c8-bishop is pinned to the king by the a8-rook, Nb7+ and Ne6+ are both waiting, and Black's pieces are tied to the back rank.",
    },
  },
  "nimzowitsch-tarrasch-1914": {
    white: "Aron Nimzowitsch", black: "Siegbert Tarrasch", event: "St Petersburg",
    intro: "Two theorists and sworn rivals: Tarrasch preached the centre and activity, Nimzowitsch blockade and prophylaxis. Here Tarrasch's hanging pawns become a springboard, and he sacrifices both bishops.",
    notes: {
      28: "14...bxc5 Black has the hanging pawns c5 and d5 — a target, and a force that can advance at any moment.",
      36: "18...d4! The hanging pawn advances, opening the b7-bishop's long diagonal to g2, while the d6-bishop aims at h2.",
      37: "19.exd4? Taking the pawn is what makes Black's double bishop sacrifice work; the engine prefers 19.g3, shoring up the kingside first.",
      38: "19...Bxh2+! The first bishop: Kxh2 Qh4+ pulls the king out.",
      42: "21...Bxg2!! The second bishop. Kxg2 Qg4+ Kh2 Rd5, and the rook swings via d5 to the h-file; the king has nowhere to hide.",
      64: "32...Bb5#. The white king has been driven from g1 all the way to d7 and is mated in Black's camp.",
    },
  },
  "bogoljubov-alekhine-1922": {
    white: "Efim Bogoljubov", black: "Alexander Alekhine", event: "Hastings",
    intro: "One of Alekhine's most famous combinations: Black hands his queen to a white rook and one b-pawn turns into two queens. The sources differ on move 51 (Kf2 or Ke2); both reach the same position on move 52.",
    notes: {
      34: "17...e4 Black closes the centre, and White's g2-bishop runs into the e4-pawn on its long diagonal. The Dutch gives Black space on the kingside.",
      56: "28...Nd3 The knight lands on d3, blocking the d-file and watching f2 and c1. Alekhine's combination starts from this knight.",
      58: "29...b4!! The rook took a5 and attacks the queen, and Alekhine does not save it: after Rxa8, bxc3 and the c-pawn heads for the last rank.",
      66: "33...c1=Q+ The pawn queens. White has taken a queen and two rooks, yet Black has a queen on the board again and more material.",
      106: "53...d5+ White resigns: in the pawn ending Black's king is more active and the d-pawn advances with check; White cannot hold.",
    },
  },
  "saemisch-nimzowitsch-1923": {
    white: "Fritz Sämisch", black: "Aron Nimzowitsch", event: "Copenhagen (the Immortal Zugzwang)",
    intro: "The Immortal Zugzwang: with plenty of pieces still on the board, White has no move that does not lose something. Nimzowitsch's blockade and prophylaxis are nowhere clearer than here.",
    notes: {
      34: "17...b4 drives the knight back to b1. White's queenside pieces are jammed together for good; the c1-rook and b1-knight cannot get out.",
      42: "21...Rxf2 Black has given the h5-knight for two pawns and a rook on the second rank. White's queen has gone to h5, far from the action.",
      47: "24.Qe3 The queen comes back to defend, but Black's d3-bishop and two rooks on the f-file already pin White to the last two ranks.",
      50: "25...h6!! A waiting move. White resigns: with so many pieces still on the board, every white move loses material or breaks the defence, and Black only has to wait.",
    },
  },
  "reti-capablanca-1924": {
    white: "Richard Réti", black: "José Raúl Capablanca", event: "New York",
    intro: "Capablanca had not lost a game in eight years; this one ended the run. Réti does not occupy the centre but controls it from afar with two fianchettoed bishops — the hypermodern idea.",
    notes: {
      5: "3.b4 White plays neither d4 nor e4, letting the b2- and g2-bishops aim at the centre from a distance. This is the Réti Opening.",
      31: "16.d4 Only once Black's pieces are committed does White push the centre pawn, opening the b2-bishop's diagonal.",
      45: "23.Rxd6 The rook takes the pawn and owns the d-file. The d6-pawn was Capablanca's one weakness in this game, and his whole problem.",
      61: "31.R1d5 Capablanca resigns: the d5-rook hits the queen, every square it could go to is covered by a white piece, and Black loses material.",
    },
  },
  "capablanca-tartakower-1924": {
    white: "José Raúl Capablanca", black: "Savielly Tartakower", event: "New York",
    intro: "A classic rook ending: Capablanca lets two pawns go so that his king can reach Black's. Rooks must be active and the king must come forward — this game shows both rules as plainly as any.",
    notes: {
      49: "25.Qxe8+ Queens come off. White is not ahead in material, but in Black's structure c7 and d5 are weaknesses.",
      59: "30.Rh7 The rook reaches the seventh rank and attacks c7 from the side; Black's rook is reduced to passive defence.",
      69: "35.Kg3! White ignores the c3-pawn and the king heads for h4–g5–f6. Capablanca has calculated that the time Black's rook spends taking pawns is exactly what the king needs to reach the black king.",
      77: "39.Kf6 The king is on f6: g-pawn, h7-rook and king weave a net, and the black king is shut in on the eighth rank.",
      103: "52.d6 Tartakower resigns: two passed pawns are racing for the last rank and Black's rook cannot cover both.",
    },
  },
  "torre-lasker-1925": {
    white: "Carlos Torre", black: "Emanuel Lasker", event: "Moscow (the Windmill)",
    intro: "The young Mexican Torre against former world champion Lasker. On move 25 White gives up his queen for the windmill: rook and bishop check in turn while the rook sweeps through Black's seventh rank.",
    notes: {
      48: "24...Qb5? Lasker wants to force a queen trade and walks right into Bf6!!; the engine prefers 24...Qxd4, taking a pawn.",
      49: "25.Bf6!! The bishop pins g7 and lets Black take the queen on h5 for nothing: after Qxh5, Rxg7+ starts the windmill.",
      51: "26.Rxg7+ The first turn: the rook checks, steps aside, the f6-bishop checks again — the black king can only shuttle between h8 and g8.",
      57: "29.Rxb7+ The rook comes round to take the b7-bishop, picking up a piece on each turn.",
      63: "32.Rxh5 The rook takes the queen back. The f6-bishop will fall to the black king, and White is still two pawns ahead.",
      85: "43.g3 Lasker resigns: White is four pawns up and h4+ keeps chasing the king.",
    },
  },
  "reti-alekhine-1925": {
    white: "Richard Réti", black: "Alexander Alekhine", event: "Baden-Baden",
    intro: "The two standard-bearers of the hypermoderns. On move 26 Alekhine's rook walks into e3, and the combination that follows dozens of moves later is already part of the plan. Some scores add four more half-moves, 41.Rf2 Nxf3+ 42.Rxf3 Bd5; only the part every source agrees on is given here.",
    notes: {
      33: "17.Bf3 Bg4 18.Bg2 Bh3 — both sides repeat: White will not give up the long diagonal, Black will not let White's castled king rest.",
      52: "26...Re3!! The rook steps into e3: fxe3 is met by Qxg3 and the kingside falls. The rook will stand there for over a dozen moves.",
      60: "30...Nxe2+ The knight takes a pawn with check. From here Black's two knights and rook check and capture without a pause, and White never gets a breath.",
      78: "39...Nxc2 The knight takes the c2-rook.",
      80: "40...Nd4 Réti resigns: the knight attacks both the e2-rook and the f3-bishop, and White loses another piece.",
    },
  },
  "alekhine-nimzowitsch-1930": {
    white: "Alexander Alekhine", black: "Aron Nimzowitsch", event: "San Remo",
    intro: "Total paralysis: White stacks three heavy pieces on the c-file, every black piece is dragged into guarding c6, and in the end not one can move. The victim was Nimzowitsch, the apostle of the blockade.",
    notes: {
      29: "15.a5 White advances on the queenside, gaining time with space: Black's knight is driven back to c8.",
      33: "17.a6 The a-pawn lodges on a6 and b7 belongs to White; Black can never open a line on the queenside.",
      49: "25.R1c2 Two rooks and the queen are stacked on the c-file, all aimed at c6.",
      55: "28.Bxb5 The bishop takes the pawn, the c6-knight is pinned in front of the queen, and the king has to walk to d8 to guard it.",
      63: "32.g3 Nimzowitsch resigns: hardly a black piece can move, and next b5 wins the pinned knight on c6.",
    },
  },
  "sultankhan-capablanca-1930": {
    white: "Mir Sultan Khan", black: "José Raúl Capablanca", event: "Hastings 1930/31",
    intro: "Sultan Khan had learned chess under Indian rules and had been in England only two years when he beat Capablanca in this game. After giving the queen for two rooks, he squeezes for more than sixty moves.",
    notes: {
      27: "14.h4 With the king uncastled, White gains space on the kingside. The centre is closed, so the king is safe where it stands.",
      45: "23.Qxc2 The queen for two rooks. In the ending that follows, two rooks and the c-file are worth more than a queen.",
      89: "45.b5 Black's b6- and a5-pawns are fixed, and b6 becomes a target the rook will collect sooner or later.",
      121: "61.Rxb6 The rook finally takes b6 and the b-pawn is passed. Black's queen roamed the kingside for twenty moves without finding a check that mattered.",
      129: "65.Rb8 Capablanca resigns: the b-pawn is two steps from queening, escorted by the rook on the back rank.",
    },
  },
  "menchik-euwe-1931": {
    white: "Vera Menchik", black: "Max Euwe", event: "Hastings 1931/32",
    intro: "Vera Menchik, the first women's world champion, against Euwe, a future world champion. One check on move 11 keeps Black's king in the centre; Menchik seizes on it and carries the advantage all the way into the ending.",
    notes: {
      21: "11.Bb5+ Euwe answers Ke7: the king can never castle now, and it stands between the h8-rook and the rest of Black's army.",
      27: "14.e5 The centre pawn advances and drives away the f6-knight. The pawns in front of the black king will soon be shattered.",
      31: "16.exf6+ Taking the knight with check: Black's kingside is now f7, f6 and g6, and the king will never find a quiet spot.",
      88: "44...Rxd2 Euwe gives the rook for a bishop and hopes his passed pawns will win the race. Menchik's knight, bishop and rook all get back in time.",
      111: "56.Kd3 Black resigns: White is a rook up and both the a3- and d4-pawns will be stopped.",
    },
  },
  "alekhine-lasker-1934": {
    white: "Alexander Alekhine", black: "Emanuel Lasker", event: "Zurich",
    intro: "World champion Alekhine against the 65-year-old former champion Lasker. White's knight and queen harass the black king again and again, and the last move puts the queen on g6 — taking it is fatal, and so is leaving it.",
    notes: {
      27: "14.Nf5 The knight jumps to f5, eyeing the e7-queen and g7. Black's ...e5 traded off a centre pawn but gave the knight its best square.",
      35: "18.Qd6 The queen invades d6, pinning down Black's d-file and queenside; Black's rooks cannot get out.",
      43: "22.Nd6 The knight switches squares and hits f7 and b7 at once. Black's defenders are pulled away one by one.",
      48: "24...f6? It blocks the queen's line from g5, but g6 can no longer be held: after Nf5+ comes Qxg6. The engine prefers 24...Ndf6.",
      51: "26.Qxg6! Lasker resigns: hxg6 is met by Rh3#, and if the queen is left alone it is already at the king's door.",
    },
  },
  "euwe-alekhine-1935": {
    white: "Max Euwe", black: "Alexander Alekhine", event: "Zandvoort (world championship, game 26)",
    intro: "The Pearl of Zandvoort: Euwe's famous win over Alekhine in their title match. White first gives a bishop for three pawns, then the exchange, and two passed centre pawns finally crush Black.",
    notes: {
      41: "21.Nxf5! The knight takes a pawn and lets Black take the bishop with Bxc3: after Nxd6 and Nxe4, White has three pawns for the bishop and a passed centre.",
      55: "28.e6 The centre pawn reaches e6, the d7-knight is stuck, and Black's army is cut in two.",
      59: "30.Rg1! The rook for the bishop: removing Black's only active piece lets the knight jump into g5 and e6.",
      76: "38...h6? The engine says 38...Rxe6, taking the e-pawn first, still hangs on; after this move Nd8 escorts the pawn to the sixth and seventh ranks.",
      83: "42.e7 The passed pawn is on the seventh rank and a black rook must stay with it; nothing else can be covered.",
      93: "47.Ne4+ Alekhine resigns: the knight forks the king and the d2-rook.",
    },
  },
  "botvinnik-vidmar-1936": {
    white: "Mikhail Botvinnik", black: "Milan Vidmar", event: "Nottingham",
    intro: "A textbook isolated pawn: the d4-pawn is a weakness in itself, but it holds e5 and opens the way for White's pieces. The young Botvinnik breaks through on the kingside in 24 moves. The sources give moves 3 to 5 in two orders that reach the same position after move 5.",
    notes: {
      17: "9.exd4 White has an isolated d-pawn and need not fear it: e5 belongs to the knight, and the half-open c- and e-files to the rooks.",
      33: "17.f4 The f-pawn advances, preparing f5 to open the f-file. White's queen, both bishops and the knight already face the kingside.",
      39: "20.Nxf7! The knight for a pawn, tearing f7 apart: after Rxf7 and Bxf6, Black's defenders are traded off one after another.",
      43: "22.Rxd5 The material is back and White is a pawn up; Black's f7-rook is pinned to the king by the b3-bishop.",
      47: "24.Rd7 Vidmar resigns: the f7-rook is pinned and attacked by the d7-rook, and White will win more material.",
    },
  },
  "keres-alekhine-1937": {
    white: "Paul Keres", black: "Alexander Alekhine", event: "Margate",
    intro: "Twenty-one-year-old Keres beats world champion Alekhine. Black's king stays in the centre too long, and White's c5-bishop and pieces in the centre never let it castle into safety.",
    notes: {
      19: "10.Bc5 The bishop seals the f8–a3 diagonal and Black cannot castle short.",
      25: "13.e5 The centre pawn advances, taking f6 away and blocking the g7-bishop.",
      37: "19.Nxg5 The knight takes a pawn and Black's kingside pawns are scattered. The king can only castle long, where a white rook is waiting too.",
      44: "22...Qb4?? The queen leaves e7 and the d7-bishop is left unguarded: Qxd7+ follows at once. The engine prefers 22...Qf8.",
      45: "23.Qxd7+ Alekhine resigns: Rxd7 Re8+ Rd8 Rxd8# is a back-rank mate, and after Kb8, Qxd8+ leaves White a rook up.",
    },
  },
  "botvinnik-capablanca-1938": {
    white: "Mikhail Botvinnik", black: "José Raúl Capablanca", event: "AVRO (Netherlands)",
    intro: "The old guard, Capablanca, against the new generation, Botvinnik. Black goes pawn-hunting on the queenside while White rolls the centre pawns e4–e5–f4–f5 towards the king; the bishop sacrifice on move 30 is the high point.",
    notes: {
      11: "6.bxc3 White accepts doubled pawns for the bishop pair and the centre. The plan is f3 and e4, driving the centre pawns at the black king.",
      38: "19...Qxa4 Black wins the a4-pawn, but the queen has left the kingside. White pushes on with e5, f4 and f5.",
      58: "29...Qe7? The queen comes back to e7 to stop the e-pawn and lands right on the a3–f8 diagonal — next comes Ba3!!. The engine prefers 29...h6.",
      59: "30.Ba3!! The bishop is offered to the queen: after Qxa3, Nh5+ sacrifices the knight and the e-pawn runs for the last rank.",
      61: "31.Nh5+! After gxh5 come Qg5+, Qxf6+ and e7 — two pieces given up for a pawn that is about to queen.",
      81: "41.Kh5 Capablanca resigns: the queen has run out of checks, and the e-pawn queens next move.",
    },
  },
  "fine-botvinnik-1938": {
    white: "Reuben Fine", black: "Mikhail Botvinnik", event: "AVRO (Netherlands)",
    intro: "The American Fine beats Botvinnik at AVRO. In a French Defence Black gives a knight for two pawns and hopes to win it back with an attack; Fine returns the material and keeps the better position.",
    notes: {
      17: "9.b4 White forces the bishop to declare itself. Botvinnik chooses Nxb4, a knight for two pawns and time to attack.",
      25: "13.Ra4 The rook comes out along the a-file and hits the b4-bishop, with the d4-pawn behind it on the same rank. White's rook reaches the fight before Black's pawns do.",
      41: "21.Rd6 The rook invades d6, hitting c6 and e6. Each of Black's queenside pawns is weaker than the last.",
      51: "26.Rxa3 The a-pawn falls, and both white rooks are working on the third and sixth ranks.",
      61: "31.Qg3 Botvinnik resigns: White's queen, the e5-knight and the d6-rook close in together, and the c6- and e6-pawns cannot both be held.",
    },
  },
  "smyslov-kottnauer-1946": {
    white: "Vasily Smyslov", black: "Čeněk Kottnauer", event: "Groningen",
    intro: "The first big tournament after the war, and a 25-year-old Smyslov. Black's king stays in the centre and his rook spends three moves on a7–c7–b7; White turns the lost time into a winning position with a string of sacrifices.",
    notes: {
      25: "13.e5! The centre pawn is given up to open the f3-bishop's long diagonal towards b7 and a8.",
      31: "16.Nc6 The knight jumps into c6 and hits the queen. If Black takes it, White's queen arrives on c6 with check.",
      35: "18.Nc5!! Another knight: after dxc5 comes Bf4, opening the d-file so that bishop and rook bear on the queen and d7.",
      41: "21.Qxd7+ Kottnauer resigns: after Kxd7, Bxb8+ is a discovered check on the d-file that wins the queen, and White comes out a bishop ahead.",
    },
  },
  "botvinnik-keres-1948": {
    white: "Mikhail Botvinnik", black: "Paul Keres", event: "The Hague–Moscow (world championship)",
    intro: "In 1948 a five-player match tournament decided the new world champion, and Botvinnik won it. Here the bishop pair and the centre pawns push Black to the side of the board, and a rook sacrifice on move 21 ends the fight.",
    notes: {
      11: "6.bxc3 White accepts doubled pawns for the bishop pair, with f3 and e4 to follow.",
      33: "17.c5! A pawn is given to open the c-file; the rook comes to c5 and from there storms Black's kingside.",
      41: "21.Rxg7+! A rook sacrifice: after Kxg7, Nh5+ drives the king to g6 with no piece beside it.",
      45: "23.Qe3 Keres resigns: the queen is coming in via h6 or g5, and Black can only prolong things by giving up the queen.",
    },
  },
};
