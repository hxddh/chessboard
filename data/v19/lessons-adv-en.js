/**
 * English text of the advanced course part 3 (v8-2-plan T1) — lessons-adv.js
 * entry for entry, words only; same shape as lessons-en.js.
 * @module lessons-adv-en
 */

  export const CHESS_LESSONS_ADV_EN = {
    "cl-cands": {
      part: "Calculation", title: "Candidate moves: list three, then choose",
      text: [
        "Seeing a good move and playing it at once is the commonest habit there is. Strong players first **list the moves worth considering — the candidate moves —** and then compare them one by one.",
        "Ask in a fixed order: is there a check? A capture? A threat? Only then the quiet moves. The first move you see is often not the best one, and sometimes it loses.",
        "In all three positions of this lesson the first move that comes to mind is wrong. List the candidates, then choose.",
      ],
      tasks: [
        { prompt: "The knight can take on c7, wait, or give check — list them and compare",
          retry: "Nxc7 is taken back by the bishop on a5; Ne7+ checks and hits the queen on c8" },
        { prompt: "Is there a good pawn move in the centre? List the candidates, then choose",
          retry: "e5! The pawn hits the bishop on d6 and the knight on f6, and d4 guards it" },
        { prompt: "The rook on a2 looks free — before taking it, ask what checks Black has afterwards",
          retry: "Rxa2?? leaves the back rank, and Qe1 is mate. Check first with Qe8+, then take the rook" },
      ],
    },
    "cl-order": {
      part: "Calculation", title: "Forcing moves first: checks, captures, threats",
      text: [
        "The fewer answers the other side has, the easier a line is to calculate. A **check** must be answered, a **capture** asks to be taken back, a **threat** has to be met — these three are the **forcing moves**.",
        "So the order for your candidates is: **checks first, then captures, then threats**. Look at all three, not just the first kind: a check that gives a piece away is not a good move.",
        "The three positions below are won by a check, by a capture and by a threat, in that order.",
      ],
      tasks: [
        { prompt: "Checks first: which check also picks something up?",
          retry: "Qd4+ checks along the long diagonal and hits the rook on a7 at the same time" },
        { prompt: "Bxf7+ is a check, but it gives the bishop away. Now the captures — which black piece is unguarded?",
          retry: "Nxc5: nothing protects the bishop on c5" },
        { prompt: "No good check and no good capture — find a threat",
          retry: "Bf6! Qg7 mates next and Black cannot stop it; the bishop the queen on a5 was hitting gets out of the way too" },
      ],
    },
    "cl-checks": {
      part: "Calculation", title: "Look at every check, even the sacrifices",
      text: [
        "When you list the checks, do not stop at the safe ones. **A check that puts the queen where it can be taken has to be calculated too**: the capture is forced, and the next move is often mate.",
        "The test is simple: when the other side has only one or two ways out of check, follow each of them. If every road ends in mate, giving up the queen is a bargain.",
        "Two classic mates in this lesson: the smothered mate (queen to g8, the knight finishes) and the back-rank mate (queen to e8, the rook finishes).",
      ],
      tasks: [
        { prompt: "The black king is walled in by its own rook and pawns — find the check that gives up the queen",
          retry: "Qg8+! The king cannot take (the knight on h6 guards g8), so the rook on f8 has to" },
        { prompt: "The rook has taken the queen — mate in one",
          retry: "Nf7#: every square around the king holds its own piece — a smothered mate" },
        { prompt: "The rook on c8 guards the back rank alone — send the queen there",
          retry: "Qe8+! The rook has to take, and Rxe8 is mate" },
      ],
    },
    "cl-count": {
      part: "Calculation", title: "Count before you capture: attackers and defenders",
      text: [
        "Before you take, count how often the piece is attacked and how often it is defended: **only more attackers than defenders wins it**.",
        "Then look at the values: **capture with your cheapest piece first**. Giving a rook for a knight is a loss even if you end up with the knight.",
        "The side taking back is counting too, so keep counting until the last capture.",
      ],
      tasks: [
        { prompt: "The knight on e5: you hit it three times (knight f3, bishop d4, rook e1), Black guards it twice (knight d7, queen e7) — which piece takes first?",
          retry: "Take with the knight or the bishop (Nxe5 or Bxe5); taking with the rook first swaps a rook for a knight" },
        { prompt: "The knight on d5 is attacked three times (pawn c4, knight c3, queen d1) and defended twice (pawn e6, queen d8) — which piece takes?",
          retry: "cxd5: take with the cheapest piece; even if it is taken back, a pawn has gone for a knight" },
        { prompt: "Two white rooks hit the rook on d8, one piece defends it — work out what is left after the captures",
          retry: "Rxd8+: the queen has to block on f8, and the rook takes her too" },
      ],
    },
    "cl-quiet": {
      part: "Calculation", title: "The quiet move: no check, no capture, still winning",
      text: [
        "Checked all the forcing moves and found nothing? Look for a **quiet move**: no check, no capture, but it leaves a threat the other side cannot parry.",
        "These are the moves that get overlooked, because they seem to do nothing. The way to find one is to ask: **if I could move twice, what would the second move be?** Then see whether a first move can prepare it.",
        "Each answer below is a quiet move with a deadly threat behind it.",
      ],
      tasks: [
        { prompt: "The pawn on b7 is one step from queening, but the black rook watches b8 — find a quiet rook move",
          retry: "Rc1! It threatens Rc8+, clearing b8 for the pawn to queen" },
        { prompt: "What happens with both rooks on the seventh rank?",
          retry: "Rdd7! Rh7 mate is threatened, and Black has to give up the queen to stop it" },
        { prompt: "The rook on g7 is missing a piece behind it — put the bishop on the long diagonal",
          retry: "Be5! Any move of the rook on g7 is now a discovered check; Black has to give the queen for the bishop" },
      ],
    },
    "cl-replies": {
      part: "Calculation", title: "List every one of the other side's answers",
      text: [
        "When you calculate forcing moves, list **every legal answer** the other side has — all of them. The one you leave out is usually the only way out.",
        "This lesson is the famous Greek gift: Bxh7+ gives the bishop, Ng5+ chases the king, Qh5 brings the queen. At every step, count Black's answers first.",
        "**After a check there are usually only two or three answers**; follow each one to the end, and the sacrifice is safe.",
      ],
      tasks: [
        { prompt: "Give up the bishop on h7 — Black can take it, or decline with Kh8",
          retry: "Bxh7+: both Kxh7 and Kh8 need calculating; taking is the toughest defence" },
        { prompt: "The king took the bishop. After the knight check Black has five answers: Kg8, Kh8, Kg6, Kh6 and Qxg5",
          retry: "Ng5+: Qxg5 loses the queen to the bishop on c1, Kg6 and Kh6 walk into worse; Kg8 holds out longest" },
        { prompt: "The king is back on g8. Bring the queen, threatening Qh7 mate",
          retry: "Qh5: Qh7# is next; Black can only give the queen for the knight" },
      ],
    },
    "cl-threat": {
      part: "Calculation", title: "First ask: what does the other side want?",
      text: [
        "When the other side has just moved, do not rush into your own plans. **First ask: what does that move want to do next?**",
        "In these three positions Black wants the same thing: mate on g2. Just blocking it is not enough — **the best defence hits back at the same time**.",
        "Once the threat is clear, list the candidates: which move holds g2 and attacks something too?",
      ],
      tasks: [
        { prompt: "The black queen and the rook on g6 both aim at g2 — defend it and hit back",
          retry: "Rg4! It blocks the g-file and, with the queen on d3, attacks the rook on g6" },
        { prompt: "The black queen and the rook on e2 both aim at g2 — how do you hold it?",
          retry: "Rg3! It stands in front of the queen and attacks her" },
        { prompt: "The queen on g4 and the knight on f4 want mate on g2 — defend with the knight",
          retry: "Ne3! The knight guards g2 and attacks the queen" },
      ],
    },
    "cl-end": {
      part: "Calculation", title: "Calculate to the end, not halfway",
      text: [
        "The commonest calculating mistake is **stopping halfway**: \"He takes my queen — no good.\" Two moves further on, the verdict can be the opposite.",
        "The rule: **keep going until the position is quiet** — no checks, nothing to capture, no threat hanging — and then count the material.",
        "This lesson is one line from start to end: you put the rook on d4, and Black takes your queen. Do not stop there.",
      ],
      tasks: [
        { prompt: "The queen on d5 and the rook on d8 stand on one file — put your rook in front of the queen",
          retry: "Rd4! If the queen moves away, Rxd8+ takes the rook" },
        { prompt: "Black has taken your queen! Do not panic, keep calculating — is there a check?",
          retry: "Rxd8+: take the rook with check first, and take the queen back once the king has moved" },
        { prompt: "Now take the queen back and count the material",
          retry: "axb3: the position is quiet, and you are a rook up" },
      ],
    },
    "cl-inter": {
      part: "Calculation", title: "The in-between move: before taking back",
      text: [
        "Exchanges usually go: you take, I take back. But if, before taking back, there is a move the other side **must answer** — a check, an attack on the queen — play it first. That is an **in-between move** (zwischenzug).",
        "The habit to build: **every time you are about to recapture, look for a stronger in-between move first**. It often turns \"one for one\" into \"one for nothing\".",
        "The first two steps are one position: take a rook with check, then take the other rook back. In the last position, too, the check comes before the capture.",
      ],
      tasks: [
        { prompt: "The rooks face each other on the e-file; but if you play Rxe2 first, the bishop takes your knight on g4 — is there a better order?",
          retry: "Nxf6+! The knight takes a rook with check; once Black has answered it, play Rxe2" },
        { prompt: "The king has stepped out of check. What now?",
          retry: "Rxe2: take the rook back — one knight has cost Black both rooks" },
        { prompt: "The rook on f1 is there for the taking — but before Kxf1 there is something stronger",
          retry: "Bxe5+! Take the knight with check first, and play Kxf1 next" },
      ],
    },
    "cl-race": {
      part: "Calculation", title: "Count the moves: pawn races",
      text: [
        "Pawn races are not decided by feel but by **counting**: how many moves does your pawn need to queen? How many does his? Whose move is it?",
        "Remember the king runs too: **one king move can do two jobs** — chase the enemy pawn and escort your own.",
        "The first position is Réti's famous study: a pawn that seems out of reach can still be caught by a king walking on the diagonal. In the other two, count first, then move.",
      ],
      tasks: [
        { prompt: "The black pawn on h5 seems out of reach, and the black king is eyeing your pawn on c6 — can you draw?",
          retry: "Kg7! Walking on the diagonal, the king chases the h-pawn and heads for its own c-pawn at once" },
        { prompt: "Count: how many moves does the h-pawn need? The c-pawn? Whose move is it?",
          retry: "h5: four moves to queen, and you move first — push at once" },
        { prompt: "Both kings are off to eat pawns — count who queens first",
          retry: "Kb6: take a6 first, then the b-pawn runs for b8 a move ahead of Black" },
      ],
    },
    "cl-mate": {
      part: "Calculation", title: "Check after check: calculate all the way to mate",
      text: [
        "When the other side can only move the king, **a series of checks** is the easiest line of all to calculate: one or two answers each time, all the way to mate.",
        "The mate in this lesson is three moves long: a rook sacrifice draws the king to h8, the queen checks, and g7 is mate — the pawn on f6 guards it.",
        "**Calculate the whole line before you sacrifice**: if the king can slip out anywhere along the way, the rook was simply given away.",
      ],
      tasks: [
        { prompt: "Mate in three, and the first move gives up the rook",
          retry: "Rh8+! The king has to take: f8 and h7 are covered by the rook, g7 by the pawn on f6" },
        { prompt: "The king is on h8. Where does the queen check from?",
          retry: "Qh6+: the king can only go back to g8" },
        { prompt: "Mate in one",
          retry: "Qg7#: the pawn on f6 protects the queen" },
      ],
    },
    "cl-guard": {
      part: "Calculation", title: "Who is guarding it? Remove the guard first",
      text: [
        "The piece you want is protected? Look at **what is protecting it** — take that guard (or lure it away), and the target is left hanging.",
        "The order of work: find the target, count its guards, and see whether you can **capture a guard first**. Often it is one capture, then another.",
        "The first two steps are one position; in the last one, find the knight that guards the rook on d8.",
      ],
      tasks: [
        { prompt: "The bishop on d5 guards the knight on e4 — which do you deal with first?",
          retry: "Bxd5: take the guard; once the knight takes back, nothing protects e4" },
        { prompt: "The knight took back on d5. And now?",
          retry: "Rxe4: the guard is gone, and the knight falls" },
        { prompt: "Your queen eyes the rook on d8, but the knight on c6 guards it — what now?",
          retry: "Rxc6! Take the guard; if Black takes back, Qxd8+ wins the rook" },
      ],
    },
    "po-badb": {
      part: "Positional play", title: "The bad bishop: blocked by its own pawns",
      text: [
        "A bishop spends its life on one colour. If most of its own pawns stand **on squares of that colour**, its own side blocks it — that is a **bad bishop**.",
        "The rule against it: **trade off your opponent's good pieces and leave him the bad bishop**; then march your king and knight on the other colour, where the bishop can never reach them.",
        "In the last position the bishop's own pawns shut its way back — a bad bishop can even be trapped.",
      ],
      tasks: [
        { prompt: "Black has two bishops; the one on d5 is hemmed in by five light-squared pawns on a4, b5, c4, f5 and g6 — which one should go?",
          retry: "Bxf6: trade off Black's good, dark-squared bishop and leave him only the bad one" },
        { prompt: "Your knight against his bad bishop. Where does the king go?",
          retry: "Kd4: the king walks on dark squares the light bishop cannot touch, heading for the pawns via c5" },
        { prompt: "Behind the bishop on b6 stand Black's own pawns on a7 and c7 — how many ways back does it have?",
          retry: "c5! The bishop can only go to a5, and b4 traps it there" },
      ],
    },
    "po-trap": {
      part: "Positional play", title: "A piece with no way back gets trapped",
      text: [
        "However active a piece looks, **with no retreat** it is in danger: attack it with a single pawn and it is lost.",
        "To find a trapped piece, go through every square it could move to — cross out those a pawn covers and those its own pieces occupy. **If none is left, find a pawn to attack it with.**",
        "In all three positions below, the piece caught is a bishop.",
      ],
      tasks: [
        { prompt: "On the bishop's diagonals only g5 is left — take it with a pawn",
          retry: "g5! The bishop has no retreat: its own king is on g7, and Bxg5 is taken by the bishop on e3" },
        { prompt: "The bishop on f5: e6 holds its own rook, g6 and h7 its own men — find a pawn to trap it",
          retry: "g4! The bishop has nowhere to go and can only give itself up for a pawn" },
        { prompt: "The bishop on a2 has crept into the corner — shut its last way out",
          retry: "c4! The king covers b1 and b3, the pawn blocks the diagonal, and Ra4 collects the bishop" },
      ],
    },
    "po-color": {
      part: "Positional play", title: "Weak colour complex: when a bishop is missing",
      text: [
        "After ...g6, the dark squares f6, g7 and h6 rely on the dark-squared bishop. **Once that bishop is gone, the dark squares around the king become holes.**",
        "The way to attack them: occupy those dark squares with your queen, knight and pawns. A pawn on f6, a knight on h6, the queen on g7 — the classic mates.",
        "In both positions below Black has no dark-squared bishop, and each is mate in two.",
      ],
      tasks: [
        { prompt: "Black has no bishops at all — who guards dark squares like g7 and h8? Check with the knight first",
          retry: "Nh6+: the king can only go to f8, since the queen on c3 covers g7 and h8" },
        { prompt: "Mate in one",
          retry: "Qh8#: the queen runs down the long diagonal to h8" },
        { prompt: "Your pawn on h6 is right in front of the king, and f6 and g7 are empty dark squares — bring the queen in",
          retry: "Qf6+: the king has to go back to g8, and Qg7 is mate next" },
        { prompt: "Mate in one",
          retry: "Qg7#: the pawn on h6 protects the queen" },
      ],
    },
    "po-hole": {
      part: "Positional play", title: "Holes: squares no pawn can guard again",
      text: [
        "Pawns only move forward, so once no pawn can guard a square behind them, it can never be guarded by a pawn again. Such a square is a **hole** (a weak square).",
        "Once Black's g-pawn has gone to g6, no black pawn can ever guard f6; with your pawn on g5, a knight on f6 stands rock-solid. **Put a knight in the enemy's hole and it cannot be driven away.**",
        "All three positions share the same hole, f6. See what the knight hits once it lands there.",
      ],
      tasks: [
        { prompt: "No black pawn can guard f6 — put the knight there",
          retry: "Nf6! Rg8 mate is threatened, and Black cannot stop it without losing material" },
        { prompt: "The knight jumps into the hole on f6 — what does it threaten?",
          retry: "Nf6! It threatens Rg8 mate; Black has to give a rook for the knight, and you take the knight on d3" },
        { prompt: "f6 again — what does the knight hit when it jumps in?",
          retry: "Nf6! It attacks the rook on e8 and opens the e-file, so the rook on e1 hits the knight on e5 — Black cannot save both" },
      ],
    },
    "po-outpost": {
      part: "Positional play", title: "Outposts: the knight that cannot be moved",
      text: [
        "An **outpost** is a square the enemy pawns can never attack and your own pawn protects. Knights love outposts: from there they hit several directions at once.",
        "To tell whether a square is an outpost, look at the files on either side of it: does the enemy still have a pawn that could come up and attack it? If not, the square is yours.",
        "In all three positions the knight gains something the moment it lands on the outpost.",
      ],
      tasks: [
        { prompt: "The pawn on e5 guards d6, and Black has no c- or e-pawn to chase a knight away — jump in",
          retry: "Nd6! It forks the rooks on b5 and e8" },
        { prompt: "The pawn on d4 guards e5, and Black has no f-pawn — what does the knight threaten from there?",
          retry: "Ne5! It threatens Rd7 mate; if Rd8 guards against it, Nf7+ forks king and rook" },
        { prompt: "The pawn on f4 supports e5, and Black has no d- or f-pawn — jump in and see what it hits",
          retry: "Ne5! It attacks the queen on c6 and the rook on d3 together" },
      ],
    },
    "po-chain": {
      part: "Positional play", title: "Attack where the pawn chain points",
      text: [
        "Pawns linked on a diagonal form a **pawn chain**. Where its head points, you have more space — **so attack on the side the chain points to**, very often by throwing pawns forward.",
        "White's chains d4–e5 and e3–f4–e5 point at the kingside, where Black's king lives. Push the f-pawn into Black's pawns, open lines in front of the king, and let the queen and rooks in.",
        "All three positions point the same way: the head of the chain is on e5, and the f-pawn charges.",
      ],
      tasks: [
        { prompt: "Your chain e3–f4–e5 points at the black king — charge",
          retry: "f5! It hits the bishop on e6 and opens the f-file" },
        { prompt: "The chain d4–e5 plus the pawn on f5 — one more step and g7 falls",
          retry: "f6! It threatens fxg7, and Qxg7 mate as well" },
        { prompt: "The pawn on e5 holds the front — push the f-pawn too",
          retry: "f6! It attacks the knight on e7 and threatens Qg7 mate" },
      ],
    },
    "po-major": {
      part: "Positional play", title: "The pawn majority: make a passed pawn",
      text: [
        "Where you have more pawns than your opponent on one wing, you can make a **passed pawn** there — one that no enemy pawn in front or on either side can stop or take.",
        "The method is **pawn against pawn**: the side with more pawns advances them and forces exchanges, and the pawn left over is passed. **Push first the pawn with no opponent in front of it.**",
        "In an endgame, one distant passed pawn is often the whole game.",
      ],
      tasks: [
        { prompt: "On the queenside you have the a- and b-pawns, Black only a6 — how do you make a passed pawn?",
          retry: "a4! Then b5, and after the exchange the a-pawn is free" },
        { prompt: "White has an extra pawn on the queenside — which one goes first?",
          retry: "a4! It prepares b5 to break up a6 and b7" },
        { prompt: "The black pawn on a4 stands in the way — push the b-pawn past it first",
          retry: "b5! Then the king goes to b4 and takes a4, and the b-pawn is passed" },
      ],
    },
    "po-file": {
      part: "Positional play", title: "Take the open file, then double rooks",
      text: [
        "A file with no pawns on it at all is an **open file**. On it a rook can run all the way to the enemy's back rank or seventh rank.",
        "**Take the file, then double**: two rooks on one open file are twice as strong, and the other side can seldom stop both.",
        "Three positions, three open files — b, c and g — and doubling rooks on each.",
      ],
      tasks: [
        { prompt: "The b-file is open and a rook is already on b1 — double the other rook behind it",
          retry: "Rcb3! Rb8 next pins the black queen" },
        { prompt: "On the c-file the black knight stands in front of its own king — double your rooks",
          retry: "Rec1! The knight is pinned to the king, and Rxc6+ is next" },
        { prompt: "The g-file is empty and your pawn on h7 sits right by the black king — double up",
          retry: "Rhg1! Both rooks press down the g-file, and after Rg8+ Black cannot hold" },
      ],
    },
    "po-behind": {
      part: "Positional play", title: "Rooks behind passed pawns",
      text: [
        "When a passed pawn advances, where does the rook belong? **Behind it.** From behind, every step the pawn takes lengthens the line the rook controls.",
        "A rook in front of its pawn gets squeezed the further the pawn goes; pushing from behind, your rook keeps the pawn moving even with an enemy rook in front.",
        "This is **Tarrasch's rule**: rooks belong behind passed pawns — your own and your opponent's alike.",
      ],
      tasks: [
        { prompt: "The pawn on e6 is two steps from queening — where does your rook go?",
          retry: "Re1: behind the pawn, the rook escorts it to e7 and e8" },
        { prompt: "The a-pawn has reached a6 — put the rook behind it",
          retry: "Ra1: the rook backs it all the way to a7 and a8" },
        { prompt: "The pawn on d6 is passed, and the rook on e1 stands beside it — put it behind",
          retry: "Rd1: with the rook behind the d-pawn, d7 can go" },
      ],
    },
    "po-kpend": {
      part: "Positional play", title: "When to trade: into a winning pawn ending",
      text: [
        "**Pawn endings are the most calculable endings of all**: no pieces, just kings and pawns, and win or draw can often be counted out move by move.",
        "So before you trade, ask: is the pawn ending after it **a win I can count out**? Look at two things: whose king is further forward, and who has an **outside passed pawn** — one far away from the enemy king.",
        "Three positions: a rook trade, a queen trade and another rook trade, each into a winning pawn ending.",
      ],
      tasks: [
        { prompt: "After the rook trade only kings and pawns are left — count who wins",
          retry: "Rxc6+! After the king takes back, Kxa5, and your b-pawn walks up with its king" },
        { prompt: "Both sides have queens, and you have a distant a-pawn — force the queen trade with a check",
          retry: "Qd2+! Black has to trade queens or lose his; afterwards the a-pawn is an outside passed pawn" },
        { prompt: "The black rook stands in front of yours — trade it, then count the moves",
          retry: "Rxe5+! After the king takes back, b5, and the two pawns outrun the black king" },
      ],
    },
    "po-trade": {
      part: "Positional play", title: "When to trade: bishops off, then the king walks in",
      text: [
        "Trading minor pieces works the same way — count the pawn ending first: **after the trade, whichever king gets into the enemy pawns first wins.**",
        "Another reason to trade: the enemy bishop is guarding or escorting a dangerous pawn — trade it off, and nothing is left to look after that pawn.",
        "All three positions are a bishop trade into a winning king-and-pawn ending.",
      ],
      tasks: [
        { prompt: "Black's pawn on a3 is close to queening, and the bishop on e6 wants to help — what do you do?",
          retry: "Bxe6! Trade the bishop, bring the king back with Kxa3, and the pawn ending is yours" },
        { prompt: "After the bishop trade, can your king reach the black pawns first?",
          retry: "Bxf5! After the king takes back, Kd3 and Kc4, and Black's queenside pawns drop one by one" },
        { prompt: "The black bishop guards d6 — trade your bishop for it",
          retry: "Bxe5! After the pawn takes back, your king reaches e4 first and wins the pawn on e5" },
      ],
    },
    "po-prophy": {
      part: "Positional play", title: "Prophylaxis: stop the other side's plan first",
      text: [
        "**Prophylaxis** is a way of thinking: before making your own move, ask **what the other side most wants to do next**, and make sure he cannot.",
        "In endgames it usually means fixing the enemy pawns so they cannot advance or exchange, or taking the square the enemy king wants before it gets there.",
        "Three king-and-pawn endings, each solved by a move that says \"not so fast\".",
      ],
      tasks: [
        { prompt: "The black king wants to take the pawn on b3 — where does your king go?",
          retry: "Kc3: the king keeps guarding b3, and the black king never gets it; Kd3? allows Kxb3" },
        { prompt: "The black king wants to reach g4 — keep it out",
          retry: "Kf3! Your king covers g4, and the black king cannot get in" },
        { prompt: "Black wants to push f4 and swap off your pawn — do not let him",
          retry: "f4! It fixes the pawn on f5, and your king goes in via e5 to take pawns" },
      ],
    },
  };
