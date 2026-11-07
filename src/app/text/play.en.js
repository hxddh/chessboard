/** Play — the play screen and the review on the board, in English. Same keys as play.zh.js; {0} {1} are arguments. */
export default {
  // the shell around the pages (main.js, index.html) and the board's name for screen readers
  "app.title": "Chess", "nav.aria": "Main navigation", "nav.learn": "Learn", "nav.play": "Play", "nav.me": "Me", "nav.settings": "Settings",
  "app.loadFailed": "The page could not load: {0}", "board.aria": "Chessboard",

  // opponents: names and lines are opponents/lines.en.js
  "opp.thinking": "Thinking", "new.weaker": "Weaker opponent", "new.stronger": "Stronger opponent",
  "side.you": "You", "side.w": "White", "side.b": "Black",

  // the context bar while playing
  "bar.yourTurn": "Your move", "bar.theirTurn": "{0} is thinking…", "bar.toMove": "{0} to move", "bar.check": "Check!",
  "bar.viewing": "Viewing move {0}", "bar.live": "Back to the game",
  "act.hint": "Hint", "act.draw": "Draw", "act.resign": "Resign", "act.moves": "Moves", "act.new": "New game",
  "act.cancel": "Cancel", "act.confirmResign": "Resign", "act.offerDraw": "Offer draw", "act.claimDraw": "Claim draw",
  "confirm.resign": "Resign this game?", "confirm.draw": "Offer your opponent a draw?", "confirm.claim": "You can claim a draw: {0}.",
  "claim.threefold": "the same position has appeared three times", "claim.fifty": "fifty moves without a capture or a pawn move",
  "draw.declined": "{0} declined the draw. Play on.", "draw.thinking": "{0} is considering…",
  "act.undo": "Undo", "act.flip": "Flip", "act.flipKey": "Flip the board (F)",
  "undo.unrated": "You took a move back, so this game won't count toward your rating.",

  // the coach before a move (P2)
  "coach.ask": "Wait — what is your opponent threatening?", "coach.rethink": "Think again", "coach.play": "Play it",
  "coach.checking": "…",

  // layered hints (P3)
  "hint.threat": "First, what is your opponent threatening? {0}", "hint.threatMate": "They want to play {0}, and that is mate.",
  "hint.threatPiece": "They want to play {0}, taking your {1}.", "hint.threatCheck": "You are in check — deal with it first.",
  "hint.noThreat": "Your opponent has no direct threat right now.",
  "hint.forcing": "Now look at your checks and captures: {0}", "hint.noForcing": "You have no checks or captures; which piece hasn't joined the game yet?",
  "hint.idea": "The idea here: {0}", "hint.ideaMate": "there is a mate", "hint.ideaCapture": "win material with a capture",
  "hint.ideaCheck": "give check and force a reply", "hint.ideaQuiet": "improve a piece",
  "hint.move": "Play {0}", "hint.wait": "Let me think…", "act.hintMore": "More help",

  // the end of a game
  "res.win": "You won", "res.loss": "You lost", "res.draw": "Draw", "res.white": "White wins", "res.black": "Black wins",
  "reason.checkmate": "Checkmate", "reason.stalemate": "Stalemate", "reason.insufficient": "Insufficient material", "reason.fivefold": "Fivefold repetition",
  "reason.seventy-five": "Seventy-five-move rule", "reason.resign": "Resignation", "reason.timeout": "Out of time", "reason.timeoutDraw": "Out of time, but the other side cannot mate",
  "reason.agreement": "Draw agreed", "reason.threefold": "Threefold repetition", "reason.fifty": "Fifty-move rule",

  // the new game sheet
  "new.title": "New game", "new.opponent": "Opponent", "new.color": "Play as", "new.clock": "Time", "new.coach": "Ask before I move",
  "new.start": "Start", "color.w": "White", "color.random": "Random", "color.b": "Black", "clock.none": "No clock",

  // promotion
  "promo.title": "Promote to",

  // the move list drawer and the report
  "drawer.title": "Moves", "drawer.first": "To the start", "drawer.prev": "Previous move", "drawer.next": "Next move", "drawer.last": "Last move",
  "report.title": "Full report", "report.accuracy": "Accuracy {0}", "report.copy": "Copy PGN", "toast.copied": "Copied",

  // the review on the board (P5)
  "rv.running": "Reviewing… {0}/{1}", "rv.card": "Move {0}: you played {1} ({2}).", "rv.cardOf": "{0}/{1}",
  "rv.tryAgain": "There was a better move here. Can you find it?", "rv.answer": "Show the answer", "rv.next": "Next", "rv.finish": "Finish",
  "rv.report": "Full report", "rv.same": "That is the move you played in the game.", "rv.right": "Right! {0} is the best move here.",
  "rv.alsoGood": "{0} works too. The engine's favourite is {1}.", "rv.wrong": "{0} isn't good either: {1}", "rv.wrongPlain": "{0} isn't good either. Think again.",
  "rv.checking": "Checking {0}…", "rv.ruleMate": "they mate with {0}", "rv.rulePiece": "{0} takes your {1}", "rv.better": "Better was {0}.", "rv.done": "Review complete.", "rv.clean": "Nothing in this game needs a second look.",
  "rv.noEngine": "The review could not run this time: {0}",
  "grade.blunder": "Blunder", "grade.mistake": "Mistake", "grade.miss": "Missed win", "grade.inaccuracy": "Inaccuracy",
  "grade.brilliant": "Brilliant", "grade.only": "Only move", "grade.best": "Best", "grade.excellent": "Excellent", "grade.good": "Good", "grade.book": "Book",
};
