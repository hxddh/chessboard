/**
 * English lesson text — a pilot covering the first eight lessons (everything
 * up to "the king's no-go squares").
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
 * lessons.js entry for entry.
 * @module lessons-en
 */
(function (global) {
  global.CHESS_LESSONS_EN = {
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
      }],
    },
    setup: {
      part: "The board", title: "Pieces, setup and the goal",
      text: [
        "Each side has 16 men: 8 pawns, 2 rooks, 2 knights, 2 bishops, 1 queen, 1 king.",
        "On the back rank, from the corner inwards: rook, knight, bishop. The queen goes on her own colour (white queen on light d1, black queen on dark d8), the king takes the e-file, and the pawns line up in front.",
        "The goal: checkmate the enemy king — attack it so that it has no way out.",
      ],
      tasks: [{
        prompt: "Get to know the pieces",
        steps: [
          "Click White's queen (d1 — \"the queen takes her own colour\")",
          "Click Black's king (on the e-file)",
          "Click either white knight (right next to the corner rooks)",
          "Click either black bishop (beside the king and queen)",
        ],
      }],
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
  };
})(typeof window !== "undefined" ? window : globalThis);
