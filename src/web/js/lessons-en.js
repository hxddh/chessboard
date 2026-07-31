/**
 * English lesson text — the complete course, every lesson in lessons.js.
 *
 * Only prose is translated here: titles, part names, explanatory paragraphs,
 * task prompts, retry hints and tap-step tips. Positions, goals and solutions
 * stay in lessons.js, so there is exactly one source of truth for what a
 * lesson *does* and translations can never drift into different chess.
 *
 * Shape: { [lessonId]: { part, title, text[], tasks: [{ prompt, retry,
 * steps: [tip, ...] }] } }. Anything missing simply falls back to the Chinese
 * original, so a partial translation degrades lesson-by-lesson rather than
 * breaking the course. scripts/test-chess.mjs checks the shape matches
 * lessons.js entry for entry, and that every lesson is covered.
 * @module lessons-en
 */
  export const CHESS_LESSONS_EN = {
    board: {
      part: "The board", title: "Squares and coordinates",
      text: [
        "Chess is played on an 8×8 board of 64 squares, light and dark alternating.",
        "From White's side: the rows across are ranks, numbered 1–8 from near to far; the columns are files, lettered a–h from left to right. Every square is named by its file and rank, e.g. e4.",
        "When you set the board up, the near right-hand corner (h1) must be a light square.",
      ],
      tasks: [{
        prompt: "Find the named squares on the board",
        steps: [
          "Click e4 (where the e-file meets the 4th rank)",
          "Click a1 (White's bottom-left corner)",
          "Click h8 (the far corner on Black's side)",
        ],
      },
        { prompt: "Three more — no corners to guess from this time",
          steps: [
            "Click d5: count across to the d-file, then up to the 5th rank",
            "Click f2: one of White's pawn squares",
            "Click b7: one of Black's pawn squares",
          ] },
      ],
    },
    squares: {
      part: "The board", title: "Light squares and dark",
      text: [
        "Thirty-two squares are light and thirty-two dark, alternating along every rank and file — which means **every square on a given diagonal is the same colour**.",
        "That is not decoration; it decides a piece's whole life. **A bishop only moves diagonally, so it stays on one colour from first move to last.** Your two bishops cover one colour each; only together do they cover the board.",
        "It is also what makes \"the queen goes on her own colour\" easy to remember: the white queen's d1 is light, the black queen's d8 is dark.",
      ],
      tasks: [{
        prompt: "Get clear on which squares are which",
        steps: [
          "Click a1 — White's bottom-left corner, a **dark** square",
          "Click h1 — White's bottom-right corner, a **light** square (setting up, the near right corner must be light)",
          "Click whichever of White's bishops stands on a dark square (c1)",
          "Now the one on a light square (f1)",
        ],
      },
        { prompt: "Walk along one diagonal and watch the colour",
          steps: [
            "Start at a1 — click it, a dark square",
            "One step diagonally — click b2, dark again",
            "One more — click c3. The whole diagonal is one colour, which is why a bishop spends its life on one",
          ] },
      ],
    },
    setup: {
      part: "The board", title: "Setting the board up",
      text: [
        "Each side has 16 men: 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen, 1 king.",
        "On the back rank, from the corner inwards: rook, knight, bishop. The queen goes on her own colour (white queen on light d1, black queen on dark d8), the king takes the e-file, and the pawns line up in front.",
        "If the order will not stick, remember it as: **rooks in the corners, knights beside them, bishops next to the knights** — which leaves the middle two squares for queen and king. The queen picks her colour; the king takes what is left.",
      ],
      tasks: [{
        prompt: "Get to know the pieces",
        steps: [
          "Click White's queen (d1 — \"the queen takes her own colour\")",
          "Click Black's king (on the e-file)",
          "Click either white knight (right next to the corner rooks)",
          "Click either black bishop (beside the king and queen)",
        ],
      },
        { prompt: "\"The queen takes her own colour\" — check the claim",
          steps: [
            "Click the white queen on d1 — a light square, and she is the light-squared side's queen",
            "Click the black queen on d8 — a dark square. Both match",
            "The king takes what is left: click the white king on e1, one file across from his queen and one colour away",
          ] },
      ],
    },
    pieces: {
      part: "The board", title: "Six pieces, and what each is worth",
      text: [
        "The six pieces differ enormously in strength. Players estimate with a set of conventional **values**, counted in pawns:",
        "**Pawn 1 · Knight 3 · Bishop 3 · Rook 5 · Queen 9.** The king has no price — lose him and the game is over, so he is never traded.",
        "These numbers are not a rule, they are **the arithmetic of trading**: giving a knight (3) for a rook (5) is a profit; giving a rook for a knight is a loss. A whole later section, \"Captures and value\", is built on these five numbers. Learn them now.",
      ],
      tasks: [{
        prompt: "Tap White's pieces in order of value, highest first",
        steps: [
          "Start with the most valuable: White's queen (9)",
          "Now either white rook (5)",
          "Now any knight or bishop (both 3)",
          "Finally any pawn (1)",
        ],
      },
        { prompt: "Now the other way round: which piece is worth what",
          steps: [
            "Click a white piece worth 5 — a rook, in either corner",
            "Click a white piece worth 3 that is also the only piece on the board able to jump over others — a knight",
            "Click the piece with no price on it — the king. Lose him and the game is over, so there is no trading him",
          ] },
      ],
    },
    turns: {
      part: "The board", title: "Taking turns: White moves first",
      text: [
        "The two players alternate. **You move exactly one piece, and you must move** — passing is not allowed, a rule that becomes deadly serious in the endgame.",
        "**White goes first.** One white move plus one black move makes a move pair, written \"1. e4 e5\" — the number in front is the move number.",
        "The bar above the board says whose turn it is. When it is your opponent's turn your own pieces will not pick up; that is the rule working, not the app freezing.",
      ],
      tasks: [{
        prompt: "White to move — play anything and spend the first move",
        retry: "Click one of your pieces, then click a square it can go to",
      },
        { prompt: "Black has answered (1. e4 e5) — move two, and it is your turn again",
          retry: "Turn about: White one move, Black one move. This one is yours" },
      ],
    },
    howtomove: {
      part: "The board", title: "How to actually move a piece here",
      text: [
        "Either way works: **click the piece, then click the destination**, or simply **drag** it across.",
        "Once a piece is selected the board lights up every square it can reach. Picked the wrong piece? Click somewhere else to deselect — that does not count as a move.",
        "And if you really do play a mistake, you can take it back: **⌘Z / Ctrl+Z**. Inside a lesson a wrong move is undone for you with a hint, so experiment freely.",
      ],
      tasks: [{
        prompt: "Try it: select a centre pawn or a knight and develop it (e4, d4, Nf3 or Nc3 all count)",
        retry: "Click the piece first — its squares light up — then click one of them",
      },
        { prompt: "Do it once more with a different piece — take the star with a knight (it hops out between the pawns)" },
      ],
    },
    goal: {
      part: "The board", title: "Winning is checkmate, not capturing everything",
      text: [
        "**Capturing all the enemy pieces is not the goal, and it never happens.** There is one goal: **checkmate** the enemy king — he is under attack, and all three escapes (**move, block, capture**) are gone.",
        "The king is never actually captured; the game ends the moment mate arrives. That is why he has no value and can never be traded.",
        "The other ending is a **draw**: no legal move while not in check (stalemate), too little material to mate, agreement, and a few more. A draw is half a point each — and it is what the losing side is usually playing for.",
      ],
      tasks: [{
        prompt: "Queen and king, mate in one — bring the queen to g7",
        retry: "Qg7: the queen sits right against the black king with your own king behind her, so he can neither take her nor step away",
      },
        { prompt: "One more: the black king is shut in by his own three pawns — mate in one",
          retry: "Swing the rook to the 8th rank (Ra8). The king cannot run along the back rank and his own pawns block the way up — this is the back-rank mate" },
      ],
    },
    pawn: {
      part: "How the pieces move", title: "Pawn: forward to move, diagonal to take",
      text: [
        "A pawn moves one square straight forward and can never go back.",
        "On its very first move it may go two squares instead.",
        "It captures differently: one square diagonally forward — never straight ahead.",
      ],
      tasks: [
        { prompt: "With the e2 pawn: capture the black pawn on d3 diagonally, then march up to d5, clearing a star each step" },
        { prompt: "This pawn has not moved yet — use its first-move privilege to jump straight to a4" },
        { prompt: "The e4 pawn is blocked by the e5 pawn — it cannot move straight (select it and see: e5 never lights up). Capture on d5 instead" },
      ],
    },
    rook: {
      part: "How the pieces move", title: "Rook: straight lines",
      text: [
        "The rook moves any distance along a rank or file, but cannot jump over pieces.",
        "Rooks are heavy pieces, devastating in the endgame — and they also take part in castling (coming later).",
      ],
      tasks: [
        { prompt: "Use the rook's straight lines to collect all three stars" },
        { prompt: "Your own pawn on c4 blocks the direct route — rooks cannot jump, so go around: h1 → h7 → c7" },
        { prompt: "Capturing works just like moving: take the d3 pawn, sweep across to h3, then finish on h6" },
      ],
    },
    bishop: {
      part: "How the pieces move", title: "Bishop: diagonals",
      text: [
        "The bishop moves any distance along a diagonal, and cannot jump over pieces.",
        "Each bishop is stuck on one colour of square for the whole game — you start with one light-squared and one dark-squared bishop.",
      ],
      tasks: [
        { prompt: "Use the bishop's diagonals to collect both stars" },
        { prompt: "The a1–h8 diagonal is the bishop's highway: stop on d4, run to h8, then come back to c3" },
        { prompt: "A dark-squared bishop only ever takes on dark squares: win the g3 pawn, then the far-off c7 pawn — the b3 pawn sits on a light square and is forever out of reach" },
      ],
    },
    knight: {
      part: "How the pieces move", title: "Knight: the L-shape",
      text: [
        "The knight moves in an L: two squares in a straight line, then one to the side (eight directions in all).",
        "It is the only piece that jumps over others — nothing can block it.",
      ],
      tasks: [
        { prompt: "Hop the knight through all three stars" },
        { prompt: "Boxed in by your own pawns? No matter — knights jump. Collect three stars from inside the crowd" },
        { prompt: "Knights need planning: reach the star on e5 in two hops (work out the stepping stone before you move)" },
      ],
    },
    queen: {
      part: "How the pieces move", title: "Queen: rook plus bishop",
      text: [
        "The queen = rook + bishop: any distance along ranks, files or diagonals, without jumping.",
        "She is the strongest piece, which is exactly why losing her for nothing hurts most — don't bring her out too early.",
      ],
      tasks: [
        { prompt: "Take one star each with a straight, a vertical and a diagonal queen move" },
        { prompt: "Combine her powers: diagonally to b4, straight up to take the b7 pawn, then diagonally out to g2" },
        { prompt: "Harvest time: all four stars sit on black pawns — take them in the order e4 → c6 → c4 → e6" },
      ],
    },
    king: {
      part: "How the pieces move", title: "King: one square at a time",
      text: [
        "The king moves one square in any direction.",
        "He may never step onto a square the opponent attacks — you cannot move into check. Look after him: if he is checkmated, the game is over.",
      ],
      tasks: [{ prompt: "Walk the king one step at a time across all three stars" }],
    },
    kingsafe: {
      part: "How the pieces move", title: "Where the king may not go",
      text: [
        "The king can never move onto an attacked square — when you select him, those squares simply do not light up.",
        "Try it: the black rook covers a whole rank and file, so the king has to go the long way round, on the side where your own pawn blocks the rook's fire.",
      ],
      tasks: [{ prompt: "Walk the king to the star on e6 — the squares the rook covers are closed to him, so go around on the right" }],
    },
    values: {
      part: "Captures and value", title: "Piece value: don't trade at a loss",
      text: [
        "The usual counts: pawn 1 · knight/bishop 3 (the minor pieces) · rook 5 · queen 9. The king is priceless — lose him and you lose the game.",
        "Do the arithmetic before you trade: a 3-point knight for a 5-point rook is a good deal; your queen for a rook is a disaster.",
      ],
      tasks: [{
        prompt: "Get to know the pieces by their value",
        steps: [
          "The queen is the strongest, about 9 points — click the white queen (d1)",
          "A rook is about 5, second strongest — click either black rook (in the corners)",
          "Knights and bishops are both about 3, the \"minor pieces\" — click either white bishop",
          "A pawn is only worth 1, but its promotion potential is unlimited — click the e2 pawn",
        ],
      },
        { prompt: "Do the arithmetic: which trades come out ahead",
          steps: [
            "Click a white piece worth 3 (knight or bishop) — trading it for a rook nets 2",
            "Click a black piece worth 5 (a rook) — that is what the last one was trading for",
            "Click the black queen (9) — a rook for her nets 4, and the other way round is a disaster",
          ] },
      ],
    },
    protect: {
      part: "Captures and value", title: "Look for defenders before you take",
      text: [
        "Can take ≠ should take: capture a defended piece and it simply gets taken back.",
        "The rule: before capturing, count the defenders. Taking a cheap defended piece with an expensive one is almost always a losing deal.",
      ],
      tasks: [{
        prompt: "Your queen can take two pawns: b7 is defended by the rook, h5 is not — take the safe one",
        retry: "The b7 pawn is defended by the b8 rook! Taking it trades your 9-point queen for a 1-point pawn — take the undefended one instead",
      },
        { prompt: "The queen eyes both the knight on d5 and the bishop on f5 — count the defenders before you take",
          retry: "The d5 knight is held by the c6 pawn, so taking it is 9 for 3. The f5 bishop is guarded by nobody" },
      ],
    },
    defend: {
      part: "Captures and value", title: "Rescue a piece under attack",
      text: [
        "After every enemy move, ask yourself: what is it threatening? Is one of my pieces attacked?",
        "Deal with an attacked valuable piece at once: move it away, defend it, or simply capture the attacker.",
      ],
      tasks: [{
        prompt: "The black rook is attacking your queen along the 5th rank! Move the queen to safety — or just take the rook",
        retry: "That square is still covered by Black, the queen would be taken for free — think again",
      },
        { prompt: "This time it is the rook: the bishop on b8 is aiming down the long diagonal at e5 — move the rook where the bishop cannot reach",
          retry: "Work out which diagonal the bishop runs on (b8–c7–d6–e5) and take the rook off it" },
      ],
    },
    fork: {
      part: "Captures and value", title: "Fork: one piece, two targets",
      text: [
        "One piece attacking two enemy targets at once is a fork — the opponent can only save one of them.",
        "A fork with check is the deadliest: they must answer the check, and the second target is yours. The knight is the great forker — nothing can block its attack.",
      ],
      tasks: [
        { prompt: "Jump the knight to a square that attacks the black king and the e8 rook at the same time — with check!",
          retry: "Find the knight square that hits both the king on a8 and the rook on e8" },
        { prompt: "The black king has stepped out of check — collect your prize: take the rook on e8",
          retry: "Take the rook on e8, that is what the fork won you" },
      ],
    },
    skewer: {
      part: "Captures and value", title: "Skewer: force the front man aside",
      text: [
        "A skewer is a pin in reverse: attack the *valuable* piece in front on a line, force it to move, and take what stood behind it.",
        "The sharpest version puts the king in front — check! The king must step aside and whatever was behind him is yours.",
      ],
      tasks: [
        { prompt: "Move the rook to the h-file with check — the black king and the queen behind him are skewered",
          retry: "Put the rook on h1 so the h-file skewers the king and the queen" },
        { prompt: "The king has been forced aside — take the queen behind him on the h-file",
          retry: "Take the queen on h8 along the h-file; that is what the skewer wins" },
      ],
    },
    discovery: {
      part: "Captures and value", title: "Discovered attack: move one, strike with another",
      text: [
        "Move a piece out of the way so the piece *behind* it on the same line opens fire — that is a discovered attack. The piece that steps aside can grab something on its way, so one move does two jobs.",
        "The strongest form is discovered check: what you unmask is a check. The opponent has to answer it, and whatever the moving piece took stays taken.",
      ],
      tasks: [{
        prompt: "The e4 knight has the e1 rook behind it, aimed at the black king — take the queen on f6 and discover the rook's check at the same time",
        retry: "Take the queen on f6 with the knight (once it moves, the rook on the e-file gives check)",
      },
        { prompt: "Same idea, different pieces: the knight on e4 unmasks the rook on e1 the moment it moves — pick the landing square that also takes the rook on c5",
          retry: "The knight takes on c5 and, in the same move, opens the check down the e-file. Black has to answer the check, so the rook stays won" },
      ],
    },
    trade: {
      part: "Captures and value", title: "Trading: when it pays",
      text: [
        "A trade is: I take one of yours, you take one of mine back. Whether it pays is straight subtraction of the values — **a knight (3) for a rook (5) nets you 2**; the other way round loses 2.",
        "One thing to watch: **being able to take is not the same as should take.** Before you capture, look once — after I take, can anything take back? If it can, both sides of the exchange go into the sum.",
        "And a rule of thumb: **trade pieces when you are ahead, avoid trades when you are behind.** If you are a rook up, the fewer men left on the board, the more that rook decides.",
      ],
      tasks: [{
        prompt: "The knight on d3 (3) can take the rook on b4 (5), and nothing can recapture — take it",
        retry: "Nxb4: the knight hops to b4 and wins the rook, up 2. Count what defends b4 first — the answer is nothing",
      },
        { prompt: "Not a win this time but the lesson's last line: you are a knight up — trade a pair of rooks off",
          retry: "The d-file is clear: Rxd8. Black recaptures and it is an even swap — and with fewer pieces left, your extra knight counts for more" },
      ],
    },
    check: {
      part: "Rules and results", title: "Check and how to answer it",
      text: [
        "Attacking the enemy king is check. The checked side must deal with it immediately, and there are only three ways: move the king, block the line, or capture the checking piece.",
        "There is no \"ignoring\" a check — the board will only ever offer you legal replies.",
      ],
      tasks: [
        { prompt: "Play one queen move that gives check to the black king (more than one works)",
          retry: "That move does not attack the black king — try again" },
        { prompt: "Your king is in check from the black rook! Answers one and two: move the king, or block with the bishop",
          retry: "In check there are only three roads: move the king (d1/d2/f1/f2), block on the e-file with the bishop (Be3), or capture the attacker. The board will not let you play anything else" },
        { prompt: "Checked by the rook again! This time use answer three — capture the attacker with your rook on a8",
          retry: "Taking the black rook on e8 ends the check for good" },
      ],
    },
    pin: {
      part: "Rules and results", title: "Pin: the piece that cannot move",
      text: [
        "If moving a piece would expose its own king to check, the rules forbid it from moving at all — that piece is pinned.",
        "Click a fully pinned piece and no target squares light up. That is not a bug, it is the rules. To break a pin: move the king off the line, block the line, or capture the pinning piece.",
      ],
      tasks: [{
        prompt: "First click the knight on e2 — pinned by the black rook on e4, it cannot move a single square! Instead, step the king off the e-file to break the pin",
        retry: "The knight is still pinned — move the king off the e-file",
      }],
    },
    deflect: {
      part: "Tactics", title: "Deflection: send the defender away",
      text: [
        "A piece is often safe only because **something else is guarding it**. To win it you do not have to attack it head-on — get the guard to leave first.",
        "The bluntest way is a check: the opponent must answer it, the guard is dragged off its post, and the thing it was watching is suddenly nobody's job.",
      ],
      tasks: [{ prompt: "The knight on d5 is guarded by the rook on d8. Check with Re8 — Black's rook has to take it, the d-file opens, and the knight is on its own", retry: "Ask first: what is guarding d5, and how do you force it off the d-file?" },
        { prompt: "The black rook has been dragged to e8 and the d-file is empty — collect the knight",
          retry: "Who reaches d5? The bishop on g2, along g2–f3–e4–d5" },
      ],
    },
    remove: {
      part: "Tactics", title: "Removing the defender: just take the guard",
      text: [
        "There are two ways to get rid of a guard: force it to move (deflection), or **capture it outright**.",
        "Before any exchange, ask one more question: what is the piece I am taking currently guarding? Once it is gone, that thing is yours.",
      ],
      tasks: [{ prompt: "The rook on b8 is guarded by the knight on d7. Take the knight with the bishop — with check — and the rook is left standing alone", retry: "Do not grab the rook first — look at who is guarding it" },
        { prompt: "The king has recaptured the knight — the guard is gone, so take the rook",
          retry: "The b-file is clear: Rxb8" },
      ],
    },
    overload: {
      part: "Tactics", title: "Overloading: one piece cannot do two jobs",
      text: [
        "A piece guarding two things at once is **overloaded**. It looks like it covers both, but force it to attend to one and the other collapses.",
        "When an enemy piece is holding down two jobs, attack one of them — it can save that, or the other, not both.",
      ],
      tasks: [{ prompt: "The rook on c8 guards both the back rank and the knight on c5 — two jobs. Check with Re8 and make it deal with the back rank", retry: "Find the piece doing two jobs, then make it choose" },
        { prompt: "The rook went to mind the back rank — its other job, guarding the knight on c5, has collapsed. Take it",
          retry: "The bishop on a3 looks straight down a3–b4–c5 at that knight" },
      ],
    },
    decoy: {
      part: "Tactics", title: "Decoy: lure a piece to the square you want it on",
      text: [
        "Deflection drives a piece **away**. A decoy does the opposite — it lures a piece **towards** you, onto a square where standing there is fatal.",
        "The usual method is a sacrifice with check: the opponent has to take, and taking puts his king exactly where your knight forks it.",
      ],
      tasks: [{ prompt: "Give the rook up on h8 with check — the king must take. Now it stands on h8, and the knight on f7 forks king and queen at once", retry: "Work out first: which square does the king have to be lured to for your knight to fork it and the queen?" },
        { prompt: "The king has been lured to h8 — now hop the knight to the square that forks king and queen",
          retry: "The knight goes from g5 to f7, taking the pawn on the way: check, and the queen on d8 attacked at the same time" },
      ],
    },
    interfere: {
      part: "Tactics", title: "Interference: cut the line the guard is watching along",
      text: [
        "A guard watches its target along a line — a rank, a file or a diagonal. **Put a piece in the middle of that line** and the sight is broken; the target is undefended.",
        "The piece you interpose usually can be taken, so it either needs protecting, or taking it has to cost more than losing the target.",
      ],
      tasks: [{ prompt: "Black's rook on b8 guards the bishop on b5 down the b-file. Jump the knight into b6 to cut the line — the c5 pawn protects it, so taking it is a bad deal", retry: "Which line is the rook guarding along? Put something protected in the middle of it" },
        { prompt: "The knight stands on b6 and the b-file is cut — the rook can no longer see its bishop. Collect it",
          retry: "The rook on a5 steps one square right and takes the bishop on b5" },
      ],
    },
    mate: {
      part: "Rules and results", title: "Checkmate: ending the game",
      text: [
        "In check with no legal answer at all = checkmate. The game ends at once and the mating side wins.",
        "One of the most common patterns is the back-rank mate: the king is boxed in by his own pawns and a heavy piece checks along the last rank.",
        "Want more mating practice? Go to Mode → Puzzles — mate-in-one and mate-in-two sets are waiting.",
      ],
      tasks: [
        { prompt: "Mate in one: the black king is trapped on the back rank by his own pawns",
          retry: "Not mate yet — think about the back rank" },
        { prompt: "Mate in one: your king is already close by, finish with the queen",
          retry: "Not mate yet — the queen must give check *and* be defended by your king" },
      ],
    },
    stalemate: {
      part: "Rules and results", title: "Stalemate: even a won game can be drawn",
      text: [
        "Side to move, not in check, and not one legal move available = stalemate, and the game is a draw!",
        "Stalemate is easiest to blunder into when you are winning easily — always leave the enemy king one legal move until the moment you mate him.",
      ],
      tasks: [{
        prompt: "Mate the black king in one — careful! One tempting-looking move only stalemates",
        retry: "Not mate yet, try again",
      }],
    },
    castle: {
      part: "Rules and results", title: "Castling: two pieces in one move",
      text: [
        "The king steps two squares towards a rook and that rook hops to the king's other side — one move that tucks the king away and develops the rook.",
        "Conditions: neither the king nor that rook has moved; the squares between them are empty; the king is not in check, does not pass through an attacked square, and does not land on one.",
      ],
      tasks: [
        { prompt: "Short castling: click the white king, then g1", retry: "That is not castling — the king moves two squares, to g1" },
        { prompt: "Long castling: click the white king, then c1", retry: "That is not castling — the king moves two squares, to c1" },
      ],
    },
    enpassant: {
      part: "Rules and results", title: "En passant",
      text: [
        "When an enemy pawn uses its first-move double step to slip past the square your pawn attacks, you may — on your very next move — take it exactly as if it had only moved one square. That is capturing en passant.",
        "The chance lasts one move only; miss it and the right is gone for good.",
      ],
      tasks: [{
        prompt: "The black pawn just went d7–d5 — take it en passant with your e5 pawn (landing on d6)",
        retry: "Capture diagonally onto d6 — that is the en-passant capture",
      }],
    },
    promotion: {
      part: "Rules and results", title: "Promotion: a pawn becomes a queen",
      text: [
        "A pawn reaching the far rank must immediately become a queen, rook, bishop or knight. It cannot stay a pawn, and it cannot become a king.",
        "Take the queen nearly every time. Occasionally a knight gives an immediate check, or a rook/bishop avoids stalemating the opponent.",
      ],
      tasks: [{ prompt: "Push the a7 pawn to the last rank and pick a piece in the dialog — it gives check too!",
        retry: "This lesson wants the promotion itself — play a7–a8 and choose a piece in the dialog. A king move does not count" }],
    },
    draws: {
      part: "Rules and results", title: "The many ways a game is drawn",
      text: [
        "Besides stalemate: neither side has mating material (bare kings, for instance — an automatic draw); the same position occurs three times, or 50 moves pass with no capture and no pawn move (both of these must be *claimed* — click \"Claim draw\" when it lights up; at five repetitions or 75 moves the draw becomes automatic); or both players simply agree.",
        "One more thing: when a position is truly lost you can resign gracefully — the button is in the moves panel.",
      ],
      tasks: [{
        prompt: "Take Black's last rook — bare kings means insufficient material and an automatic draw",
        retry: "Try taking that rook first",
      }],
    },
    notation: {
      part: "Rules and results", title: "Reading a game: algebraic notation",
      text: [
        "Letters name the piece: K king · Q queen · R rook · B bishop · N knight. Pawns get no letter — just the destination square.",
        "Common symbols: x capture · + check · # checkmate · O-O short castling · O-O-O long castling · =Q promotion to a queen. Learn these and the move list and replay controls all make sense.",
      ],
      tasks: [{
        prompt: "Read the move, click the destination",
        steps: [
          "\"e4\" = a pawn goes to e4 (pawns show only the square) — click e4",
          "\"Nf3\" = the knight jumps to f3 (N is the knight) — click f3",
          "\"Qxd5\" = the queen captures on d5 (x means capture) — click d5",
          "\"O-O\" = short castling, so the white king lands on… — click g1",
        ],
      }],
    },
    ladder: {
      part: "Mating patterns", title: "The two-rook ladder mate",
      text: [
        "Two heavy pieces (rooks or queen) take turns cutting off a rank and checking, walking the enemy king up the board like a ladder until he is mated on the edge. It is the easiest forced mate to learn.",
        "The recipe: one piece fences off the king's escape rank, the other checks from the next rank along. The king retreats a rank, so you climb a rung.",
      ],
      tasks: [
        { prompt: "Rung one: put either rook on the 7th rank to shut the black king onto the back rank",
          retry: "Don't rush the check — fence off the 7th rank with a rook (a7 or b7)" },
        { prompt: "Rung two: the b7 rook holds the 7th rank, so run the other rook down the a-file to mate on the back rank!",
          retry: "Send the a2 rook straight to a8 — check on the 8th rank, with the 7th already sealed off" },
      ],
    },
    smother: {
      part: "Mating patterns", title: "Smothered mate: the knight's specialty",
      text: [
        "When a king is hemmed in by his own pieces, a single check is mate. The knight is the only piece that checks *through* other pieces, so smothered mate is essentially its private trick.",
        "The classic picture: the king wedged in the corner, his own men all around him, and a knight landing on f7 (or f2) to finish it.",
      ],
      tasks: [
        { prompt: "First, see why the black king has nowhere to go",
          steps: [
            "Click the black rook occupying the escape square g8",
            "Click the g7 pawn blocking the king",
            "Click the h7 pawn blocking the king",
          ] },
        { prompt: "The black king is walled in by his own pieces — jump the knight in for smothered mate!",
          retry: "Find the knight square that checks the king on h8 and cannot be captured by anything (f7)" },
      ],
    },
    qrladder: {
      part: "Mating patterns", title: "Queen and rook: mating on the edge",
      text: [
        "Queen plus rook climbs the ladder just like two rooks, and the queen seals ranks more tightly — but she also stalemates far more easily, so keep leaving the king a legal move until you mate him.",
        "The ladder is the model for driving a king to the edge. The next four lessons flip the problem: **the king is already on the edge or in the corner — how do you close the net in one move?**",
      ],
      tasks: [
        { prompt: "The queen fences the 7th rank first — put her on b7, one square away from the black king (too close invites stalemate)",
          retry: "Play the queen to b7: the whole 7th rank plus c8 come under fire and the black king can only shuffle along the back rank" },
        { prompt: "The black king can only run along the back rank — bring the rook down the h-file to finish it!",
          retry: "Rh8 gives check while the queen covers the whole 7th rank — that's the move" },
      ],
    },
    backrank: {
      part: "Mating patterns", title: "Back-rank mate: smothered by your own pawns",
      text: [
        "**The most common mate in practical play — and it usually lands while neither player is looking.** The king castles to g1/g8, the three pawns in front of him never move, and those pawns are blocking his only exit.",
        "A rook or queen drops onto the back rank with check, and the king **cannot go up** (his own pawns) and **cannot go sideways** (the rook's line). That is mate, with nothing sacrificed.",
        "Preventing it takes one move: **push a pawn in advance** — usually the h-pawn — to give the king an air hole. Strong players do it in quiet moments without thinking.",
      ],
      tasks: [
        { prompt: "The black king is on g8 and f7/g7/h7 have never moved — take the back rank",
          retry: "Ra8: check on the back rank. The king would love the 7th rank, but f7, g7 and h7 are occupied by his own pawns" },
        { prompt: "Black has a rook on a7 — can it defend the back rank? Count before you move",
          retry: "Re8: the a7 rook is on the 7th rank, cannot reach the 8th, and cannot interpose either (only f8 would block, and it cannot get there)" },
      ],
    },
    qkiss: {
      part: "Mating patterns", title: "Queen-next-to-king: get close, but bring support",
      text: [
        "The queen delivering check from **right beside** the enemy king is often called the kiss of death. From there she seals off the whole ring of squares around him at once.",
        "Everything hangs on **support**: standing next to the king puts the queen inside his reach, so **another piece must defend that square** or he simply eats her and you have thrown a queen away. Here the supporting piece is the bishop on b2, eyeing the whole a1–h8 diagonal.",
        "So the checklist has exactly two questions: **can the queen get next to him, and is that square defended?** Both yes, it is mate. Only the first, it is a blunder.",
      ],
      tasks: [
        { prompt: "The bishop on b2 covers g7 — step the queen up",
          retry: "Qg7: the queen lands beside the king, defended by the b2 bishop, and h7 and g8 are both sealed off by the queen herself" },
        { prompt: "This time Black's own h7 pawn blocks his escape — same single move",
          retry: "Qg7: the same long diagonal supports her, and h7 is taken by Black's own pawn" },
      ],
    },
    arabian: {
      part: "Mating patterns", title: "The Arabian mate: rook and knight",
      text: [
        "**Rook plus knight** is the best-matched mating pair there is, because their fields of fire do not overlap at all — the knight covers exactly what the rook cannot.",
        "The standard shape: king in the corner, **knight two squares away** (king h8, knight f6), where that one knight covers **g8** and **h7** together. The rook then arrives on h7 with check, defended by the knight.",
        "The mnemonic is simply: **knight first, sealing both escape squares; rook last, giving check.** Reverse the order and the rook just gets captured.",
      ],
      tasks: [
        { prompt: "The f6 knight already covers g8 and h7 — bring the rook up the h-file",
          retry: "Rh7: check, and h7 is defended by the knight on f6; g8 is in the knight's field too" },
        { prompt: "Other corner: black king a8, knight on c6 — same shape, where does the rook go?",
          retry: "Ra7: the c6 knight covers a7 (defending the rook) and b8 (sealing the escape) — the same picture as before" },
      ],
    },
    boden: {
      part: "Mating patterns", title: "Boden's mate: two diagonals crossing",
      text: [
        "**Two bishops** run on opposite colours, so their fire never overlaps — and once the two diagonals cross they weave a net the king cannot leave. This is the pay-off of \"Light squares and dark\" from the very first section.",
        "The classic setting is after the opponent castles **queenside**: the king on c8, his own rook on d8 and pawn on d7 already blocking half his escape. One bishop checks from a6 along a6–c8; the other, from f4, covers b8 and c7 in one stroke.",
        "The two diagonals cross, all four directions are taken, and that is Boden's mate. It is often bought with a queen sacrifice, because once the shape appears it cannot be stopped.",
      ],
      tasks: [
        { prompt: "The f4 bishop already covers b8 and c7 — bring the other bishop to the a6 diagonal",
          retry: "Ba6: check along a6–b7–c8. b8 and c7 belong to the f4 bishop, while d8 and d7 are blocked by Black's own rook and pawn" },
        { prompt: "Same position, but the bishop starts on e2 — go to the same square",
          retry: "Ba6: e2–d3–c4–b5–a6 is clear, and on arrival it is the same net" },
      ],
    },
    opening: {
      part: "Opening basics", title: "Three opening principles",
      text: [
        "One: take the centre. d4/e4/d5/e5 are the key squares — the closer to the centre a piece stands, the more it controls.",
        "Two: develop the minor pieces quickly. Knights and bishops first, don't move the same piece over and over, and don't bring the queen out early.",
        "Three: castle early. Tuck the king into the corner and activate a rook at the same time — the castling you already learned.",
      ],
      tasks: [
        { prompt: "Opening essentials",
          steps: [
            "Click any of the four central squares (d4 / e4 / d5 / e5)",
            "Minor pieces come out first — click any white knight or bishop",
          ] },
        { prompt: "Play the most classical first move of all: push the e- or d-pawn two squares into the centre",
          retry: "Try e2–e4 or d2–d4 — one move, and the centre is yours" },
      ],
    },
    "op-firstmove": {
      part: "Opening basics", title: "The first move does three things at once",
      text: [
        "A game almost always starts with **e4 or d4**. Not by convention — because that one move does three things at once: it takes the centre, it opens a diagonal for the bishop, and it opens one for the queen.",
        "Of White's 20 legal first moves, **the f1 bishop and the d1 queen have no move at all** — their own pawns box them in. Push e4 and the bishop suddenly has 5 squares and the queen 4. One move, two pieces released.",
        "An edge pawn (a4, h4) does none of the three: it does not touch the centre, it frees nobody, and it leaves a hole next to your own king.",
      ],
      tasks: [
        { prompt: "First see who is boxed in — click them",
          steps: [
            "White's king-side bishop is stuck behind the e2 pawn with nowhere to go — click f1",
            "The queen is walled in by d2 and e2 the same way — click d1",
          ] },
        { prompt: "Play the move that takes the centre and frees both the bishop and the queen",
          retry: "An edge pawn or a knight cannot free two pieces in one move. Push the e- or d-pawn two squares" },
        { prompt: "e4 is played — click the far end of the diagonal the bishop just gained",
          steps: [
            "The f1 bishop now runs along f1–a6, and a6 is as far as it goes — click a6",
          ] },
      ],
    },
    "op-knights": {
      part: "Opening basics", title: "Knights towards the centre, not the edge",
      text: [
        "\"A knight on the rim is dim\" is an old saying, and it is countable: **on an empty board a knight on f3 reaches 8 squares, one on h3 reaches 4** — exactly half.",
        "So the opening knight moves are almost always **Nf3 and Nc3** (Nf6 and Nc6 for Black). Both are near the centre and both watch centre squares.",
        "A knight on a3 or h3 covers half as much, does nothing about the centre, and usually has to move again — which costs another move.",
      ],
      tasks: [
        { prompt: "Count the central knight first — f3 reaches 8 squares; click any three of them",
          steps: [
            "Towards the centre — click e5 or d4",
            "One more — g5 or d2",
            "And h4, e1, g1, h2 are all in range too; click one",
          ] },
        { prompt: "Now the edge — click one of the squares the h3 knight can reach (there are only four)",
          steps: [
            "From h3 it only reaches f4, g5, f2 and g1 — half of what it had on f3",
          ] },
        { prompt: "e4 is played — put a knight where it belongs",
          retry: "Na3 and Nh3 sit on the rim covering half as much, and have to move again. Jump towards the centre: Nf3 or Nc3" },
      ],
    },
    "op-tempo": {
      part: "Opening basics", title: "In the opening, move each piece once",
      text: [
        "The opening is a race to **get your pieces out**. A move only pays if it brings a *new* piece into the game; shuffling one that is already out is running on the spot.",
        "The usual way to lose that race is **being chased**: a piece comes out early to a square it cannot hold, and the opponent gains time attacking it. You move it, they develop. Move it three times and they are three pieces ahead.",
        "So before a piece comes out, ask: **can it stay there?** A square it cannot hold costs you the move you spent getting there.",
      ],
      tasks: [
        { prompt: "White to play — bring out a **new** piece",
          retry: "Moving the e-pawn again, or bringing the queen out early, is not development. Put a piece that has not moved yet into the game" },
        { prompt: "White has played e4, Nf3, Bb5 — click the piece that came out **last**",
          steps: [
            "The bishop on b5 was the third to arrive. Three moves, three different pieces, nothing wasted — click b5",
          ] },
        { prompt: "Black's turn — same idea: a new piece (and one that guards e5 is better still)",
          retry: "Don't push another pawn or move the same piece twice. Bring out a new one — the knight to c6 also covers e5" },
      ],
    },
    "op-pawnmoves": {
      part: "Opening basics", title: "A pawn move can never be taken back",
      text: [
        "Of all the pieces only the pawn **cannot go backwards**. Everything else can return if it went to the wrong square; a pawn move is permanent — and the squares behind it can never be covered by it again.",
        "So spend pawn moves carefully in the opening: usually just **one or two centre pawns**, to take the centre and let the pieces out. Every extra pawn move is one more hole you cannot fill.",
        "The pawns in front of your king deserve the most care. After castling, f, g and h are the roof; push one carelessly and the roof leaks.",
      ],
      tasks: [
        { prompt: "First, which pawns are worth moving in the opening?",
          steps: [
            "These two take the centre and free your pieces — click e2 or d2",
          ] },
        { prompt: "Black has just castled king-side — click one of the pawns that should stay where it is",
          steps: [
            "g6 has already moved once to fit the bishop; f7, g7 and h7 are the roof. Pushing f7 or h7 opens it up — click f7 or h7",
          ] },
        { prompt: "Black to play — stop pushing pawns and bring a piece out",
          retry: "a6, h6, b6 and the like take no centre, free nothing, and leave permanent holes. Develop" },
      ],
    },
    "op-castle": {
      part: "Opening basics", title: "Don't put castling off — the centre will open",
      text: [
        "Centre pawns trade themselves off, and the e- and d-files open sooner or later. **Once they do, a king still on e1 or e8 is staring down the enemy rooks and queen.**",
        "So castling is the one of the three opening jobs with a deadline: **usually inside the first ten moves**. Two or three minor pieces out, and it is time.",
        "It cuts both ways — an opponent who keeps putting castling off is telling you where to attack: prise the centre open.",
      ],
      tasks: [
        { prompt: "White has three minor pieces out and the king-side is clear — there is only one thing to do",
          retry: "More development is fine in itself, but the king is still on e1 and the centre can open at any moment. Tuck it into the corner: castle king-side" },
        { prompt: "White has castled; Black to move — click the square the black king is still sitting on",
          steps: [
            "The black king is still on e8, facing an e-file that is going to open — click e8",
          ] },
        { prompt: "Black's turn — do the same",
          retry: "Black also has three minor pieces out and a clear king-side. Tuck the king into the corner" },
      ],
    },
    "op-italian": {
      part: "Opening basics", title: "Your first opening: the Italian",
      text: [
        "Play the three principles in a row and you have a real opening. The friendliest one to start with is the **Italian Game**: 1.e4 e5 2.Nf3 Nc6 3.Bc4.",
        "Three moves, three jobs, nothing wasted: **e4 takes the centre and frees bishop and queen; Nf3 develops and hits e5; Bc4 develops and eyes f7** — the one square in front of Black's king that only the king defends. Black answers in kind and the game is level.",
        "You do not have to memorise openings. Remember what each move is *for*, and you can handle whatever the opponent plays. If you do want lines, the Openings category in the puzzle trainer has 109 of them, in ECO order.",
      ],
      tasks: [
        { prompt: "The Italian, move one",
          retry: "The Italian starts with e4 — the centre, and both the bishop and the queen freed" },
        { prompt: "Black has answered e5 — move two: develop a piece and hit that pawn",
          retry: "Nf3: develops and attacks e5, two jobs in one move" },
        { prompt: "Nc6 defended the pawn — move three: put the bishop on the diagonal aiming at f7",
          retry: "Bc4 — the bishop comes out to c4 pointing at f7. That is the Italian" },
        { prompt: "The Italian is set up — click the weak square the bishop is aiming at",
          steps: [
            "f7 is the only square on Black's back rank defended by the king alone, and the c4 bishop is looking straight at it — click f7",
          ] },
      ],
    },
    firstgame: {
      part: "Opening basics", title: "Your first complete game: Scholar's Mate",
      text: [
        "Time to string the principles into a real game — and to meet the most famous opening trap of all, Scholar's Mate: four moves to checkmate an unprepared opponent.",
        "It works by aiming two pieces at f7, the square only the black king defends. But remember: against a correct reply (g6 and Nf6) the early queen just gets chased around. This is a trap to *recognise*, not to rely on.",
      ],
      tasks: [
        { prompt: "Move 1: push the king's pawn two squares — centre taken, queen and bishop unlocked", retry: "Play e2–e4" },
        { prompt: "Black replies 1…e5. Move 2: bishop to c4, staring down the diagonal at f7",
          retry: "Bring the f1 bishop to c4, aimed at Black's weakest square, f7" },
        { prompt: "Black develops with 2…Nc6. Move 3: queen to h5 — hitting the e5 pawn and f7 at once",
          retry: "Play the queen to h5 so she and the c4 bishop both aim at f7" },
        { prompt: "Black plays 3…Nf6?? and misses the threat! Move 4: end the game in one",
          retry: "Queen takes f7 — the c4 bishop defends her, so the king cannot take back" },
        { prompt: "Post-mortem: remember where both sides are weak",
          steps: [
            "Click Black's weak square, f7 — in the opening only the king defends it",
            "The same goes for White — click f2 and remember to look after your own",
          ] },
      ],
    },
    "mg-plan": {
      part: "Middlegame thinking", title: "The opening is over: three questions",
      text: [
        "You know the opening is over when the minor pieces are out, the king has castled, and nothing sits between your rooks. What follows has no slogan — only three questions.",
        "First: is the king safe? Yours, and theirs. Second: which of my pieces is doing the least? That is the one to move next. Third: what is my opponent up to — what was their last move aiming at?",
        "The middlegame is not about finding brilliancies. It is about giving your worst-placed piece somewhere better to stand. Brilliancies are what that adds up to.",
      ],
      tasks: [
        { prompt: "White has castled. Find the pieces still sitting at home",
          steps: [
            "Click the White knight that has not moved off the back rank",
            "Click the White bishop still boxed in by its own pawns",
            "Their king is still in the centre, uncastled — click the black king",
          ] },
        { prompt: "The c1 bishop is White's worst piece, and the d-pawn is what blocks it — push the pawn out of its way",
          retry: "Play d2–d3 or d2–d4 and the bishop's diagonal opens up" },
      ],
    },
    "mg-openfile": {
      part: "Middlegame thinking", title: "Open files: highways for rooks",
      text: [
        "A file with no pawns on it — from either side — is an open file. A rook on its own back rank does almost nothing; a rook on an open file reaches all the way into the enemy position.",
        "So once pawns come off, the first job is usually to move a rook onto the file they left behind. Two rooks stacked on the same open file are stronger still — that is called doubling.",
        "One sentence to keep: pawns open the road, rooks drive down it.",
      ],
      tasks: [
        { prompt: "Find the open files in this position",
          steps: [
            "Neither side has a pawn on the c-file or the d-file — click the bottom square of either one",
          ] },
        { prompt: "Move a rook onto the c-file or the d-file",
          retry: "Either rook can get there: play Rc1 or Rd1 with whichever you like" },
      ],
    },
    "mg-outpost": {
      part: "Middlegame thinking", title: "Outposts: a square they cannot chase you off",
      text: [
        "If your opponent has no pawns left on either neighbouring file, no pawn will ever be able to push you off that square. That is an outpost.",
        "A knight wants it most: knights are slow, so a square where one can settle for good pays off, and a knight is the only piece that does not mind being surrounded. Bishops and rooks are happy on outposts too.",
        "Read the pawns to find them — wherever a pawn is missing, there is a hole.",
      ],
      tasks: [
        { prompt: "Black has lost both the d-pawn and the f-pawn — find the hole that leaves",
          steps: [
            "Click e5: the d- and f-pawns that would guard it are gone, so nothing can chase a piece away from there",
          ] },
        { prompt: "Put a knight on the e5 outpost — either one reaches it, take your pick",
          retry: "The knights on d3 and f3 each reach e5 in one hop" },
      ],
    },
    "mg-pawns": {
      part: "Middlegame thinking", title: "Pawn structure: doubled, isolated, holes",
      text: [
        "Pawns are the only men that cannot go back, so every pawn move leaves a weakness that is permanent. Reading the pawn structure is reading where the game is headed.",
        "Doubled pawns: two of your own on one file. The front one blocks the back one, neither moves easily, and they cannot defend each other.",
        "An isolated pawn: no friendly pawn on either neighbouring file, so no pawn can ever defend it. A piece has to babysit it instead — and a piece tied to a pawn is a piece you no longer have.",
      ],
      tasks: [
        { prompt: "Name the two weak pawn types in this position",
          steps: [
            "White has two pawns doubled on the c-file — click either one",
            "Black's d5 pawn has no friendly pawn beside it — click that isolated pawn",
            "The square in front of an isolated pawn can never be guarded by a pawn — click d4, the square a knight wants",
          ] },
        { prompt: "Now use it — against an isolated pawn there are two roads: occupy the hole in front of it, or walk up and challenge it. Play one",
          retry: "Two roads: Nd4 parks the knight on the square no pawn can ever guard, or c3–c4 challenges the isolani head-on" },
      ],
    },
    "mg-passer": {
      part: "Middlegame thinking", title: "Passed pawns: the piece that promotes itself",
      text: [
        "A pawn with no enemy pawn ahead of it on its own file, and none on either neighbouring file able to block its path, is a passed pawn. Walk it to the end and it becomes a queen.",
        "A passed pawn is worth more the further it goes, and it forces the other side to leave someone behind to watch it — which is one fewer piece fighting everywhere else.",
        "So before you trade in the middlegame, do the arithmetic: who has a passed pawn once the trade is done? Whoever does usually wins the endgame that follows.",
      ],
      tasks: [
        { prompt: "Find the one passed pawn on the board",
          steps: [
            "Click the white pawn on c5: Black has nothing on the b-, c- or d-files, so nothing stands in its way",
          ] },
        { prompt: "Make this passed pawn stronger — push it, or walk the king over to clear its road. Both are right",
          retry: "Play c5–c6, or bring the king towards the c-pawn (Kf1)" },
      ],
    },
    "mg-trade": {
      part: "Middlegame thinking", title: "When to trade",
      text: [
        "A trade is never neutral. It always favours one side — the question is which side you are on.",
        "When you are up material, trade pieces but not pawns: the fewer men are left, the more your extra one stands out, until it is walking around alone. When you are down material the reverse holds — keep pieces on and keep the position messy.",
        "There is a third case: when your own pieces are tripping over each other, trade one or two off on purpose to give the rest room.",
      ],
      tasks: [
        { prompt: "White is a rook up. The side with more material trades — take the queens off down the d-file",
          retry: "The d-file is clear: play Qxd8" },
        { prompt: "The queens are gone; keep going — face their rook down the d-file, or check down the e-file and force the swap",
          retry: "Two roads: the rook on e1 goes to d1, or Re8+ makes the black rook take" },
      ],
    },
    "mg-attack": {
      part: "Middlegame thinking", title: "Attacking the king: gather first, charge second",
      text: [
        "An attack does not come from one piece trying hard. It comes from numbers, and the rule is plain: you need more pieces near their king than they have defending it.",
        "So a real attack starts with bringing pieces over — every move adds one more, until you have more than they do. Then you strike. Attacks launched with two pieces are the ones that get punished.",
        "Once the pawns in front of their king have moved at all (…h6, …g6), those squares are the handles to grab — and that is where the head-count matters.",
      ],
      tasks: [
        { prompt: "Count how many White pieces already point at the black king",
          steps: [
            "Click the bishop on d3: its diagonal runs all the way to h7, right at the king's doorstep",
            "Click the knight on f3: it can jump to g5 at any moment, the classic attacking square",
          ] },
        { prompt: "Two is not enough — add one more piece pointing at the black king. Rook, knight or queen, any of them",
          retry: "Add an attacker: Re1 puts the rook on the empty e-file, Ng5 is the knight square the lesson named, or Qe2 / Qe1 / Qd2 brings the queen out" },
      ],
    },
    "square": {
      part: "Endgame basics", title: "The rule of the square: can the king catch the pawn?",
      text: [
        "Count how many steps the pawn needs to reach the last rank, and draw a square of that side length from the pawn towards promotion — that is the pawn's *square*.",
        "**When it is the defender's move**, the king catches the pawn if it can step inside that square, and cannot if it can't. No counting move by move: draw the square and you know the answer.",
        "It works for the attacker too — every step the pawn takes shrinks the square, and the enemy king may be shut out of it.",
      ],
      tasks: [
        { prompt: "Draw the square first — click its three corners as prompted",
          steps: [
            "The pawn is on h4 and needs 4 steps to reach h8 — click the end of that road, h8",
            "Side length 4: count four squares to the left along the 8th rank — click d8",
            "Now back down to the pawn's rank — click d4, and the square h4–h8–d8–d4 is drawn",
          ] },
        { prompt: "The same fact from the other side: the black pawn on h5 needs 4 steps to reach h1, and your king stands on d5, the corner of its square — walk down the diagonal and count: also 4" },
        { prompt: "Now White to move — play the one move that shuts the black king out of the square for good",
          retry: "Moving the king is no help, it is far too far away — push the pawn! One step shrinks the square to the e-file and the black king is locked out" },
      ],
    },
    "opposition": {
      part: "Endgame basics", title: "Opposition: whoever gives way first, loses",
      text: [
        "Two kings on the same line with exactly one square between them, neither able to come closer — that is the *opposition*.",
        "What matters is this: **whoever is to move has to give way first**. Taking the opposition means handing the obligation to move to the other player.",
        "King-and-pawn endings often turn on this one thing. Getting the king in front of the pawn is not enough — you also need the opposition, and when you cannot take it by a king move, a pawn move can waste a tempo and hand the obligation back.",
      ],
      tasks: [
        { prompt: "Learn to recognise it",
          steps: [
            "Both kings stand on the e-file with one square between them — click that square, e6, which neither king may enter",
          ] },
        { prompt: "White to move — click the square the king should go to",
          steps: [
            "It has to be the same line as the king on e5 with exactly one square between — only e3 does that (a diagonal step is not the opposition)",
          ] },
        { prompt: "Your king is already in front of the pawn, but Black holds the opposition — leave the king alone and waste a tempo with the pawn, handing the move back to Black",
          retry: "Moving the king gives up the good square in front of the pawn — you still have a pawn to move, so use it to lose a move" },
      ],
    },
    "keysquares": {
      part: "Endgame basics", title: "Key squares: put the king right and the pawn goes through",
      text: [
        "King and pawn against a lone king is not decided by how fast the pawn runs, but by **whether your king can stand on the right square**. Those squares are called *key squares*.",
        "Once the pawn is past the 4th rank, its key squares are the three squares directly ahead of it. For a pawn on e5 they are d6, e6 and f6 — occupy any one of them and the pawn promotes, whoever is to move.",
        "So the right way to play these endings is: **king to a key square first, push the pawn last**. Push first and follow with the king, and you usually end up drawing.",
      ],
      tasks: [
        { prompt: "The key squares of the e5 pawn are the three directly ahead of it — walk the king across d6, e6 and f6: standing on any one of them promotes the pawn" },
        { prompt: "One king move reaches a key square — don't push, walk",
          retry: "Pushing only runs the pawn into the black king. Of the three key squares d6/e6/f6, exactly one is reachable right now" },
        { prompt: "The real thing: key square first, pawn afterwards — escort the e-pawn to the last rank" },
      ],
    },
    "wrongbishop": {
      part: "Endgame basics", title: "The wrong bishop: a whole piece up and still a draw",
      text: [
        "A rook's pawn (a- or h-file) plus a bishop is the most famous trap in the endgame: **if the bishop cannot control the promotion square, the defending king only has to sit in that corner and the game is drawn** — a whole extra piece wins nothing.",
        "The reason is simple: the pawn can only promote on that one file, so the colour of the promotion square is fixed. A bishop lives on one colour forever; wrong colour means it can never touch that square, and never drive the king out of the corner.",
        "So the first two things to check in this ending are: **what colour is the promotion square, and what colour is my bishop**. And from the defending side: head for that corner and stay there.",
      ],
      tasks: [
        { prompt: "White is a bishop and a pawn up and still cannot win — look at the colour of two squares",
          steps: [
            "The h-pawn can only promote here — click h8, a dark square",
            "Now the square the bishop stands on — click f1, light. A bishop never changes colour, so h8 is out of reach forever",
          ] },
        { prompt: "The black king is completely safe on either of two squares — click one of them",
          steps: [
            "h8 and g8: White can neither check it with the bishop nor drive it away (trying to means stalemate) — click h8 or g8",
          ] },
        { prompt: "Your turn to defend: Black has the wrong bishop plus an h-pawn — where does the white king have to go?",
          retry: "Running to the e-file only takes you further from the corner, and the black king will squeeze you to death. **Head for h1** — Black's bishop is dark-squared and can never touch it" },
      ],
    },
    "rookbehind": {
      part: "Endgame basics", title: "Put the rook behind the passed pawn",
      text: [
        "Rook endings have one rule that almost never lets you down: **the rook belongs behind the passed pawn** — yours or your opponent's.",
        "The reason is that every step the pawn takes leaves the rook behind it with exactly as many squares as before, while the rook blocking in front has fewer and fewer. **The side pushing gets stronger; the side blocking gets more and more cramped.**",
        "So whenever there is a passer, ask: is my rook behind it? And where is theirs? That single question often decides the ending.",
      ],
      tasks: [
        { prompt: "White has an a-pawn and the black rook is blocking in front of it — put the white rook where it belongs",
          retry: "The rook wants to be *behind* the passer — same file, below the pawn" },
        { prompt: "Both rooks are on the a-file now — click the one getting more cramped",
          steps: [
            "Every step the white pawn takes costs the a8 rook a square, while the a2 rook keeps its full range throughout — click a8",
          ] },
      ],
    },
    "pawntrade": {
      part: "Endgame basics", title: "Up material, trade pieces; down material, trade pawns",
      text: [
        "The most useful trading rule in the endgame: **when you are ahead, trade pieces; when you are behind, trade pawns**.",
        "Trading a pair of pieces while a pawn up makes the remaining ratio more lopsided — one extra pawn among a full army is nothing, but once it is king and pawns only, that pawn is the whole game. The side behind wants the opposite: with all pawns gone, the extra pawn cannot exist.",
        "So a pawn up, take every trade of pieces you can get. A pawn down, hold on to your pawns and give up the rooks and bishops instead.",
      ],
      tasks: [
        { prompt: "White is a c-pawn up — by the rule, the trade to make is right there",
          retry: "The side ahead trades *pieces*. There is a pair of rooks facing each other on the e-file" },
        { prompt: "This is the position after the trade — click the pawn that decides the game",
          steps: [
            "Three against three on the kingside, nobody makes progress; the extra queenside pawn has nobody watching it — click c4",
          ] },
      ],
    },
    "majority": {
      part: "Endgame basics", title: "A pawn majority: push the unopposed one first",
      text: [
        "More pawns than your opponent on one wing is a *majority*. Its value is not the extra pawn as such — it is that a majority can **manufacture a passed pawn**.",
        "There is a right way to push it: **start with the pawn that has no enemy pawn opposite it** (the *candidate*). Nothing blocks it, so it forces the enemy pawns to move and the rest of the majority can follow. Push a blocked pawn first and you jam yourself.",
        "The same rule applies in defence: when the candidate starts running, don't rush to block it with a pawn of your own — that is usually what they wanted.",
      ],
      tasks: [
        { prompt: "White has three queenside pawns against two — click the one to push first",
          steps: [
            "Black has pawns facing the a- and b-files; only the c-file is clear — click c2",
          ] },
        { prompt: "Push the candidate",
          retry: "The one to move first is the one with **no enemy pawn opposite** — the c-pawn. The a- and b-pawns have nowhere to go yet" },
      ],
    },
    "kingactive": {
      part: "Endgame basics", title: "In the endgame the king is a fighting piece",
      text: [
        "In the middlegame you tuck the king away; in the endgame it is the opposite. Once enough material is off, **the king is a strong piece for both attack and defence, and leaving it at home is playing a piece short**.",
        "Its endgame value is roughly a bishop and a bit. It escorts your own pawns, it blocks theirs, and it pushes the enemy king back a square at a time — nothing else on the board does those jobs.",
        "So the first thought in an endgame is usually not a pawn move but: **where should my king go**. Towards the centre, towards the wing with more pawns, and into the path of their passed pawn.",
      ],
      tasks: [
        { prompt: "Walk the lesson's first sentence: the king leaves the corner on h1 and reaches the centre on e4 in three — in an endgame that is often move one" },
        { prompt: "The black pawn promotes next move and White has exactly one move that holds — everything else is mated",
          retry: "The king has to block the promotion path. Stepping to g3, h1, h2 or h3 all abandon the f-file and the pawn goes straight through" },
        { prompt: "King and pawn against a lone king, White to move — king first or pawn first? This one move decides it",
          retry: "Pushing the pawn draws: the pawn runs ahead, the king can't keep up and the black king blocks it head-on. **King first** — walk it in front of the pawn to clear the way" },
      ],
    },
    "drill-pawn": {
      part: "Endgame technique", title: "King and pawn: escorting a promotion (vs engine)",
      text: [
        "King and pawn against a lone king is the most common endgame of all: the king walks *in front* of the pawn to clear the way, taking the key square ahead of it (opposition), and only then does the pawn get through.",
        "King first, pawn slowly; promote and you win — just don't stalemate the enemy king. Stuck? Press Hint in the top bar to see the engine's suggestion.",
      ],
      tasks: [
        { prompt: "Warm-up: who moves first? The king — step in front of the pawn to clear the way (d5, e5 or f5 all work)",
          retry: "Don't push the pawn yet! Move the king first — it has to lead the pawn to take the key squares" },
        { prompt: "The real thing: escort the e-pawn to the last rank with your king (promotion wins; stalemate or losing the pawn means starting over)" },
      ],
    },
    "drill-queen": {
      part: "Endgame technique", title: "Mating with the queen (vs engine)",
      text: [
        "King and queen against a lone king is the most basic forced win. Three steps: ① keep the queen a knight's move away from the enemy king, shrinking his box; ② walk your own king up to help; ③ once it is in place, mate on the edge.",
        "The knight's-move distance is your stalemate insurance: the queen boxes the king in without ever taking his last square away. Stuck? Press Hint in the top bar.",
      ],
      tasks: [
        { prompt: "Warm-up ①: put the queen a knight's move from the black king (f6 or g7) — boxed in, but not stalemated",
          retry: "Find the square a knight's move from the king on e8 — f6 or g7. Not too close, but don't let him out either" },
        { prompt: "Warm-up ②: your king is already in place — mate in one (which checking square does your king defend?)",
          retry: "On b8 and c8 the queen is taken or the king escapes — come up the b-file to the square your king defends" },
        { prompt: "The real thing: mate the black king with queen and king (stalemate or more than 50 moves means starting over)" },
      ],
    },
    "drill-rook": {
      part: "Endgame technique", title: "Mating with the rook (vs engine)",
      text: [
        "King and rook also wins by force, but the footwork matters more: ① the rook fences off a rank, shrinking the black king's area; ② your king walks up to face the enemy king head-on (the opposition); ③ the moment the kings face each other, a rook check is either mate or pushes him back one more rank.",
        "Finish this lesson and you own the two most important basic endgames. Go start your first game against the Beginner engine (it makes real mistakes on purpose, built for exactly this), or head to Puzzles to keep drilling mates.",
      ],
      tasks: [
        { prompt: "Warm-up ①: rook to the 7th rank as a fence, shutting the black king onto the back rank",
          retry: "Lift the a1 rook to a7 — the whole 7th rank becomes a fence the black king cannot cross" },
        { prompt: "Warm-up ②: the kings are already facing each other — mate along the back rank!",
          retry: "With the kings facing off, the black king cannot dodge a back-rank check — run the rook to the 8th rank" },
        { prompt: "The real thing: mate the black king with rook and king (more patient work than the queen — remember Hint is there)" },
      ],
    },
    "drill-bishops": {
      part: "Endgame technique", title: "Mating with two bishops (vs engine)",
      text: [
        "Two bishops control both colours and, with the king's help, drive the enemy king into a *corner* to mate him — and it must be a corner the bishops cover (one matching the colour of a bishop).",
        "The method: stand the bishops side by side on adjacent diagonals to weave a net, with your king behind them pushing the enemy king towards the corner one square at a time.",
      ],
      tasks: [
        { prompt: "Warm-up: bring a bishop to a long central diagonal and start weaving the net (either bishop, heading for the centre)",
          retry: "Move the bishop off the corner and onto a diagonal that controls the centre" },
        { prompt: "The real thing: drive the black king into a corner and mate with two bishops and the king (stalemate or more than 50 moves means starting over)" },
      ],
    },
    "drill-lucena": {
      part: "Endgame technique", title: "Lucena: building the bridge (vs engine)",
      text: [
        "The Lucena position is the key *winning* technique of rook endings: your king is stuck in front of his own pawn while the enemy rook checks endlessly from behind. The answer is to build a bridge — put your rook on the 4th rank so it can block a check — and then the king steps aside and the pawn promotes.",
        "Three steps: ① rook to the 4th rank ahead of the pawn; ② king out from in front of the pawn; ③ when the checks come, interpose the rook halfway. That block is the bridge.",
      ],
      tasks: [{ prompt: "Escort the b-pawn to promotion (promoting wins; losing the pawn or drawing means starting over)" }],
    },
    "drill-philidor": {
      part: "Endgame technique", title: "Philidor: holding the draw (vs engine)",
      text: [
        "Endgames are not only about winning — knowing how to *hold* matters just as much. The Philidor defence is the standard way to save a rook ending a pawn down: park your rook on your own 3rd rank so the enemy king cannot come forward, and the moment their pawn reaches that rank, drop the rook to the back rank and check from behind, forever.",
        "In this lesson you are White and a pawn *down*. The goal is not to win but to hold the draw — stalemate, insufficient material or 50 moves without progress all count as success.",
      ],
      tasks: [{ prompt: "Hold the draw: keep the rook on the 3rd rank and the black king out (a draw is success; being mated or letting the pawn promote means starting over)" }],
    },
    "drill-qvr": {
      part: "Endgame technique", title: "Queen against rook (advanced challenge)",
      text: [
        "King and queen against king and rook is a forced win, but one of the *hardest* basic endgames: the queen has to keep checking and forking until the rook is driven away from its king and captured, and only then comes the mate.",
        "The trick: manoeuvre so the black king and rook stand a knight's move apart or on the same line, then win the rook with a check that forks them. This one is genuinely difficult — there is no shame in using Hint.",
      ],
      tasks: [{ prompt: "The real thing: win the rook with queen and king, then mate (stalemate or more than 50 moves means starting over)" }],
    },
  };
