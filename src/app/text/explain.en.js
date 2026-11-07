/**
 * The explainer's sentences (core/explain.js) in English — same keys as
 * explain.zh.js; the 19.0 sentences are 19.0's English (i18n-en.js). {0} {1} …
 * are moves, pieces (piece.*, lower case: they sit inside a sentence),
 * squares and motifs, in the order the explainer gives them.
 * @module text/explain.en
 */
export default {
  // —— 19.0's sentences (tactics and material) ——
  "ex.mate1": "Missed mate in one: {0}", "ex.mateN": "Missed mate in {1} starting with {0}",
  "ex.allowsMate": "Allows mate in {1} starting with {0}", "ex.allowsMate1": "Allows mate in one: {0}",
  "ex.motifLoss": "Missed {0} ({1}), losing the {2}", "ex.motif": "Missed {0} ({1})", "ex.forkHits": "Missed {0} ({1}), hitting the {2} and the {3}",
  "ex.loss": "After {0} the {1} is lost", "ex.betterMotif": "Better was {0} ({1})", "ex.better": "Better was {0}",
  "ex.betterWins": "Better was {0}, winning a {1}", "ex.mate1Motif": "Missed mate in one: {0} ({1})",
  "ex.mateNMotif": "Missed mate in {1} starting with {0} ({2})", "ex.threatMate": "Ignored the threat of mate: {0}",
  "ex.allowsMate1Motif": "Allows mate in one: {0} ({1})", "ex.allowsMateMotif": "Allows mate in {1} starting with {0} ({2})",
  "ex.threatHanging": "Ignored the threat {0}: the {1} was left hanging", "ex.perpetual": "Allows perpetual check starting with {0}",
  "ex.hanging": "Missed {0}: the {1} was left hanging", "ex.betterHanging": "Better was {0}, winning the loose {1}",
  "ex.hangingCheap": "Missed {0}: a {2} takes the {1}, a losing trade", "ex.threatCheap": "Ignored the threat {0}: a {2} takes the {1}, a losing trade",
  "ex.betterCheap": "Better was {0}: a {2} takes the {1}, winning material",
  "motif.fork": "Fork", "motif.pin": "Pin", "motif.skewer": "Skewer", "motif.discovered": "Discovered check", "motif.double": "Double check",
  "motif.hanging": "Hanging piece", "motif.backRank": "Back-rank mate", "motif.mateThreat": "Mate threat", "motif.trapped": "Trapped piece",
  "motif.removeDefender": "Removing the defender", "motif.overload": "Overload", "motif.deflection": "Deflection", "motif.decoy": "Decoy",
  "motif.xray": "X-ray", "motif.zwischenzug": "Zwischenzug", "motif.desperado": "Desperado", "motif.promotion": "Promotion",
  "motif.perpetual": "Perpetual check", "motif.discoveredAttack": "Discovered attack",
  "piece.p": "pawn", "piece.n": "knight", "piece.b": "bishop", "piece.r": "rook", "piece.q": "queen", "piece.k": "king",

  // —— v2: what your move missed, what it loosened ——
  "ex.threatFree": "Ignored the threat {0}: your {1} is unprotected", "ex.threatTake": "Ignored the threat {0}: your {1} cannot be held, and the trade loses material",
  "ex.movedFree": "{0} went to an unprotected square: the {1} can be taken for free", "ex.movedTake": "After {0} your {1} cannot be held: they take it with the {2}, and you come out behind",
  "ex.unguarded": "Once your {0} moved away, the {2} on {1} was left unprotected", "ex.looseAfter": "After {0} the {2} on {1} is left unprotected",
  "ex.overloaded": "Your {0} had too much to do — guarding both the {1} and the {2} — and {3} exploits it",
  "ex.replyThreat": "After {0} they threaten to take your {1}", "ex.replyTwo": "After {0} they attack your {1} and your {2} at once",
  "ex.replyCombo": "They play {0}, and after your {1}, {2} takes your {3}", "ex.replyMate": "After {0} they threaten mate with {1}",
  "ex.reply2Threat": "They play {0} and then {1}, threatening to take your {2}", "ex.reply2Mate": "They play {0} and then {1}, threatening mate with {2}",
  "ex.betterParries": "Better was {0}, dealing with the threat {1} first", "ex.betterThreat": "Better was {0}, threatening to take their {1}",
  "ex.betterThreatMate": "Better was {0}, threatening mate with {1}", "ex.betterTakesFree": "Better was {0}, taking the unprotected {1}", "ex.betterTakes": "Better was {0}: their {1} cannot be held, and taking it wins material",
  "ex.betterCombo": "Better was {0}: after {1}, {2} takes the {3}",
  "ex.betterTwo": "Better was {0}, attacking their {1} and {2} at once",
  // —— v2: the position (only when the engine's evaluation moves as well) ——
  "ex.pos.shelter": "{0} moved a pawn in front of your king, and its shelter is weaker", "ex.pos.openFile": "{0} opened the {1} toward your king",
  "ex.pos.isolated": "After {0} the pawn on {1} is isolated", "ex.pos.doubled": "After {0} you have doubled pawns on the {1}",
  "ex.pos.backward": "After {0} the pawn on {1} is backward", "ex.pos.passed": "{0} gave them a passed pawn on {1}",
  "ex.pos.outpost": "After {0} their knight has an outpost on {1} that no pawn can chase it from", "ex.pos.bishopPair": "{0} traded a bishop for a knight and handed them the bishop pair", "ex.pos.badBishop": "{0} put a pawn on your bishop's colour, and the bishop is now hemmed in by its own pawns",
  "ex.file": "{0}-file", "ex.mateWord": "checkmate",
  // —— v2: lessons, endgames, classics, openings ——
  "ex.stalemate": "After {0} they are not in check but have no move — that is stalemate", "ex.notMate": "{0} is check, but they can play {1}",
  "ex.noCheckMate": "{0} is not check, so it cannot be mate", "ex.noCheck": "{0} is not check", "ex.noCapture": "{0} does not capture",
  "ex.lostOpposition": "You gave up the opposition: after {0} they answer {1}, facing your king, and it is only a draw",
  "ex.missedOpposition": "You gave up the opposition: after {0} it is only a draw — {1} keeps the kings an odd number of squares apart",
  "ex.pushedEarly": "{0} pushes too early: your king is not yet in front of the pawn, and now it is only a draw", "ex.lostWin": "After {0} it is only a draw",
  "ex.square": "{0} does not push: their king steps into the pawn's square, while {1} would have run through",
  "ex.left7th": "{0}: the rook left the seventh rank", "ex.leftBehindMine": "{0}: the rook left its place behind your passed pawn on {1}",
  "ex.leftBehindTheirs": "{0}: the rook no longer watches their passed pawn on {1} from behind",
  "ex.offBook": "{0} leaves your opening book; the usual move is {1}",
  "ex.natural": "Players rated {0} often play this here too (about {1}) — a very natural mistake", "ex.people": "Players rated {0} usually play {1} here", "ex.peopleToo": "Players rated {0} usually play this here too",
  "ex.masterTwo": "The master's move eyes both {0} and {1}",
  // —— v2: what this move achieved ——
  "ex.good": "{0} — {1}", "ex.capture": "{0} wins their {1} outright", "ex.captureEven": "{0} takes their {1}, but it will be taken back",
  "ex.attackTwo": "{0} attacks {1} and {2} at once", "ex.attackMate": "{0} threatens mate with {1}", "ex.attack": "{0} threatens to take their {1}",
  "ex.defends": "{0} meets their threat {1}", "ex.check": "{0} is check", "ex.castle": "{0} tucks the king away to safety",
  "ex.develop": "{0} brings out the {1}", "ex.push": "{0} advances the passed pawn", "ex.describe": "{0}",
  // —— punctuation: a full stop before the next sentence, a list separator ——
  "ex.stop": ". ", "ex.list": ", ",
};
