/**
 * The rules core, reused unchanged from src/web/js (ADR 0002: the pure logic
 * stays). Everything in src/app imports it from here, so the day src/web goes
 * this is the one file that changes.
 * @module core/chess
 */
export { Chess } from "../../web/js/chess.js";
export { ChessFide } from "../../web/js/fide.js";
