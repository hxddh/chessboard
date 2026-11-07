/**
 * The rules core (ADR 0002: the pure logic stays): chess.js, vendored
 * (chessjs.js), and the FIDE draw rules on top of it (fide.js). Everything in
 * src/app imports the rules from here.
 * @module core/chess
 */
export { Chess } from "./chessjs.js";
export { ChessFide } from "./fide.js";
