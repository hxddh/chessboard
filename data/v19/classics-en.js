/**
 * English text for the annotated classics — every game in classics.js.
 *
 * Only prose is translated: player names, the event and the notes. Moves,
 * years, ECO codes and results stay in classics.js. Shape:
 * { [gameId]: { white, black, event, notes: { [ply]: text } } }.
 * scripts/test-classics.mjs asserts the note plies match the originals.
 * @module classics-en
 */
  export const CHESS_CLASSICS_EN = {
    "morphy-opera-1858": {
      white: "Paul Morphy", black: "Duke of Brunswick and Count Isouard", event: "Paris Opera",
      notes: {
        6: "3...Bg4 pins the knight early, and next move the bishop has to give itself up for it. Handing over the bishop pair in the opening is a bill that comes due in the middlegame.",
        13: "7.Qb3 attacks two things at once: f7 and b7. Black can only save one.",
        15: "8.Nc3! Morphy does not take b7. Grabbing the pawn would cost two tempi to bring the queen back; he would rather bring out another piece. The lead in development is the real capital of this game.",
        19: "10.Nxb5 gives up a knight to open the b-file and the a4–e8 diagonal. The black king is still in the centre, and every open line leads to it.",
        23: "12.O-O-O castles long with the rook landing on the d-file, pinning the d7 knight — one move, two jobs.",
        25: "13.Rxd7 gives the exchange to remove the support of the f6 knight and tighten the pin on the d-file.",
        31: "16.Qb8+! A queen sacrifice to deflect: the knight is forced from d7 to b8, and nobody guards the back rank any more.",
        33: "17.Rd8#. White spent a queen and a knight to buy the time Black's whole army never got to use — that is the entire case for developing first.",
      },
    },
    "anderssen-kieseritzky-1851": {
      white: "Adolf Anderssen", black: "Lionel Kieseritzky", event: "London (the Immortal Game)",
      notes: {
        6: "3...Qh4+ costs White the right to castle, but from now on the queen is chased by every developing move. Bringing the queen out early wins one tempo and loses several.",
        21: "11.Rg1 gives up castling on purpose and puts the rook on the g-file. Anderssen's king can stay on f1 — Black has no piece that can get near it.",
        31: "16.Nc3. Count: all four white minor pieces are out, Black has a single queen in play.",
        34: "17...Qxb2 takes a pawn while behind in development. The queen leaving the defence is the turning point of the game.",
        35: "18.Bd6!! Both rooks are offered at once. Anderssen has calculated that the two moves Black spends taking them are exactly what he needs to finish the mating net.",
        38: "19...Qxa1+ collects the second rook. Black is two rooks and a bishop up and has not one piece near his own king.",
        41: "21.Nxg7+ closes the net: knight, bishop and queen all bear on the little patch of squares around e7 and f6.",
        45: "23.Be7#. White has three minor pieces left, Black almost his whole army — but only the pieces near the king count.",
      },
    },
    "anderssen-dufresne-1852": {
      white: "Adolf Anderssen", black: "Jean Dufresne", event: "Berlin (the Evergreen Game)",
      notes: {
        7: "4.b4, the Evans Gambit: a pawn for two tempi against the bishop, then c3 and d4 to grab the centre.",
        13: "7.O-O ignores the d4 pawn and puts the king in safety first. Anderssen's arithmetic is simple: one pawn for one tempo.",
        21: "11.Ba3 puts the bishop on the a3–f8 diagonal, and the black king can never castle short again. This one move governs Black's plans for the rest of the game.",
        33: "17.Nf6+ sacrifices the knight to open the g-file and wedge a pawn on f6 in front of the black king.",
        37: "19.Rad1!! The most famous quiet move in chess: no check, no capture, just the other rook onto the d-file — both later sacrifices, Rxe7 and Qxd7, depend on it.",
        38: "19...Qxf3 looks like White has blundered a knight, but the queen has just left exactly the two squares it had to guard, e7 and d7.",
        39: "20.Rxe7+ is a decoy: the knight is dragged to e7, where it blocks its own king's escape.",
        41: "21.Qxd7+!! A queen sacrifice to decoy the king to d7, where the two bishops take turns checking it.",
        47: "24.Bxe7#. Every move of the combination used the line the rook opened when it stepped onto d1 at move 19.",
      },
    },
    "steinitz-bardeleben-1895": {
      white: "Wilhelm Steinitz", black: "Curt von Bardeleben", event: "Hastings",
      notes: {
        13: "7.Nc3 offers a pawn for development. Steinitz was the great positional player, but he knew this too: while the king has not castled, time is worth more than a pawn.",
        27: "14.Re1 pins the e7 knight and the black king is stuck in the centre — from here on Black never gets a chance to castle.",
        33: "17.d5! Open the centre before the king gets home. The rule: when the enemy king is in the middle, open lines.",
        39: "20.Qg4 threatens both Qxg7 and Qxd7 — one piece, two targets.",
        43: "22.Rxe7+!! Nobody can take this rook: after Kxe7 comes Re1+ and the hunt, and after Qxe7 comes Rxc8+ on the back rank first.",
        45: "23.Rf7+. The rook keeps stepping alongside the king and can never be taken, because the overload between the queen on d7 and the rook on c8 is still there.",
        49: "After 25.Rxh7+ von Bardeleben left the room and resigned. Steinitz showed the mate in ten on the spot: Kg8 Rg7+ Kh8 Qh4+ Kxg7 Qh7+ Kf8 Qh8+ Ke7 Qg7+ Ke8 Qg8+ Ke7 Qf7+ Kd8 Qf8+ Qe8 Nf7+ Kd7 Qd6#.",
      },
    },
    "lasker-bauer-1889": {
      white: "Emanuel Lasker", black: "Johann Bauer", event: "Amsterdam",
      notes: {
        9: "5.Bd3 — the two bishops now aim at h7 and g7. The whole mating attack is already laid out along those two diagonals.",
        19: "10.Ng3 reroutes the knight from c3 to g3 so it can jump to h5 next and trade off the f6 knight — the only guard the black king has.",
        27: "14.Nh5 removes the defender: once the f6 knight is gone, h7 and g7 are guarded by nothing but pawns.",
        29: "15.Bxh7+! The first bishop. After Kxh7, Qxh5+ drives the king back to g8.",
        33: "17.Bxg7!! The second bishop. The model double bishop sacrifice: each bishop tears open one square, and the queen and rook come in through the gap.",
        37: "19.Rf3 lifts the rook to the third rank — it joins via h3, and Black can only block with the queen.",
        43: "22.Qd7! The last link of the combination: the queen attacks both bishops, on b7 and e7, and wins back the material. Extra material plus an exposed black king decides the game.",
        75: "38.Qxd3. Every piece White gave up from move 15 onward came back through the double attack at move 22, with a pawn to spare in the endgame.",
      },
    },
    "pillsbury-tarrasch-1895": {
      white: "Harry Nelson Pillsbury", black: "Siegbert Tarrasch", event: "Hastings",
      notes: {
        22: "11...c4 grabs space on the queenside, but it releases the pressure on d4 and hands the e5 square to the white knight.",
        25: "13.Ne5 takes the outpost: a square no black pawn can ever attack.",
        27: "14.f4. Two plans start racing: White pushes the f-pawn against the king, Black pushes his queenside majority to make a passed pawn.",
        41: "21.f5 takes the e6 and g6 squares away from Black — the black king's breathing room is shrinking.",
        62: "31...c3. Black's passed pawn reaches the sixth rank with the b4 pawn beside it. Whichever plan reaches the finish first wins.",
        69: "35.g4. Pillsbury pushes too: g4–g5 to break up f6, with every white heavy piece pointing at the g-file.",
        83: "42.Nh6 jumps into the black king's doorway, and the threats on the g-file force the rook back to defend. Black's queenside pawns are still two moves short.",
        87: "44.Qg3+ drags the king out. Every move from here is a check — the two black passed pawns never get to move again.",
        103: "52.Qxh7#. The attack on the king was one move faster than the plan to make a passed pawn, and one move was enough.",
      },
    },
    "capablanca-marshall-1918": {
      white: "José Raúl Capablanca", black: "Frank Marshall", event: "New York",
      notes: {
        16: "8...d5, the Marshall Attack in its first tournament outing — Marshall is said to have kept it ready for years.",
        26: "13...Ng4 gives up the knight and starts the attack. Capablanca knew none of this in advance and had to calculate it move by move at the board.",
        29: "15.d4 does not rescue anything; it opens the diagonal for the c1 bishop. In defence the best move is often simply to develop a piece.",
        37: "19.Rxf2 gives back the exchange to remove the most dangerous attacker. A piece down with a safe king beats a piece up under check.",
        45: "23.Kd3. The white king walks out himself — once on c2, behind his own pieces, he is the safest piece on the board.",
        51: "26.Bd5. The attack is over, and Capablanca begins to use the extra minor piece and the queenside majority.",
        65: "33.b6. The passed pawn runs, and every black attacking piece is on the kingside, too far away to come back.",
        71: "36.Bxf7+ and Marshall resigned: the b-pawn cannot be stopped. The template for defence — give material back to secure the king, then win with what is left.",
      },
    },
    "reti-bogoljubov-1924": {
      white: "Richard Réti", black: "Efim Bogoljubov", event: "New York",
      notes: {
        5: "3.g3, the hypermodern opening: no rush to occupy the centre with pawns, first the two bishops watch it from the flanks.",
        23: "12.f3 undermines the e4 pawn, and once the f-file opens the f1 rook looks straight at the black king.",
        29: "15.e4. Only now does White push his centre — the timing is that Black no longer has a piece able to hit back at it.",
        31: "16.c5 deflects: the bishop is driven back to f8 and can no longer hold e5.",
        37: "19.Bh5! attacks the e8 rook and clears the f-file at the same time. Wherever the rook goes, the f-file opens.",
        43: "22.Qxf5. White has been trading off the black king's guards one by one; what remains are attackers.",
        47: "24.Bf7+ drives the king into the corner, with the f8 bishop pinned to the back rank.",
        49: "25.Be8! A quiet move to finish: the bishop blocks e8 and threatens both Qf8+ and Qxf8 — no black piece can deal with both.",
      },
    },
    "rotlewi-rubinstein-1907": {
      white: "Gersz Rotlewi", black: "Akiba Rubinstein", event: "Łódź",
      notes: {
        19: "10.Qd2? The queen stands on the d-file and will be chased twice by the black rook — in a symmetrical position every wasted tempo is booked against you.",
        25: "13.Bd3. The white bishop has now shuttled between d3 and c4 three times. Rubinstein is two full developing moves ahead.",
        36: "18...Rac8. Black's rooks face the c- and d-files, the bishops face the white king — every piece is on an attacking line.",
        41: "21.Be4 blocks the b7 bishop's diagonal, but the bishop that blocks it is the target of the next sacrifice.",
        44: "22...Rxc3!! Rubinstein's immortal combination begins here: a rook is given up while his own queen is under attack.",
        46: "23...Rd2!! The second rook goes too: whichever White takes, the two bishops and a rook meet on the h-file.",
        48: "24...Bxe4+ is a discovered check — bishop takes bishop with check, and the white queen is forced to block on g2.",
        50: "25...Rh3! and White resigned: Rxh2# and Bxg2# cannot both be stopped. Black gave up queen and rook for one quiet rook move.",
      },
    },
    "bernstein-capablanca-1914": {
      white: "Ossip Bernstein", black: "José Raúl Capablanca", event: "Moscow",
      notes: {
        19: "10.Ba6 trades off Black's light-squared bishop. Bernstein's plan is to attack the hanging pawns on c5 and d5.",
        26: "13...bxc5 leaves Black with hanging pawns on c5 and d5: targets, but also a force that can advance at any moment.",
        30: "15...c4! Capablanca pushes the hanging pawn and gets a protected passed pawn for it. The rule for hanging pawns: advance into a passed pawn, or be besieged.",
        34: "17...Bb4 pins the c3 knight — the obstacles in the passed pawn's path are cleared one at a time.",
        44: "22...c3. The passed pawn reaches the sixth rank and both white rooks are nailed to the c-file by it.",
        51: "26.Nb5? White believes that winning the c3 pawn will free him.",
        53: "27.Nxc3 takes the pawn. By 29.Rxc3 White is a pawn up — but look at his back rank: the king has no escape square and the rook has left the first rank.",
        58: "29...Qb2!! and White resigned: Qxb2 allows Rd1#; Rc2 is met by Qb1+ and the rook falls; Qe1 by Qxc3 Qxc3 Rd1+ with a back-rank mate. One quiet queen move holds the entire c-file with a back-rank weakness.",
      },
    },
  };
