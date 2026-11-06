/**
 * The facts-only explainer and the motif detectors, reused unchanged from
 * src/web/js (ADR 0002: the pure logic stays), with chess.js bound in.
 * Like core/chess.js, this is the one file that changes the day src/web goes.
 * @module core/explain
 */
import { Chess } from "./chess.js";
import { explainMistake as explain19, explainParts, explainKey, explainMotif, figurine, lineAfter, retryQuick }
  from "../../web/js/explain.js";
import { lineMotif as lineMotif19, threatOf as threatOf19 } from "../../web/js/motif.js";

export { explainParts, explainKey, explainMotif, figurine, lineAfter, retryQuick };
/**
 * The sentence as plain text with moves in SAN letters — the app's font has
 * no chess glyphs yet (19.0's SVG figurines come with the move-list work).
 */
export const explainText = (ex, t) => explainParts(ex, t).map((p) => (typeof p === "string" ? p : p.san)).join("");
/** A move as the app prints it, for now its SAN. */
export const sanText = (san) => san;
/** @see src/web/js/explain.js explainMistake */
export const explainMistake = (x) => explain19(x, Chess);
/** @see src/web/js/motif.js lineMotif */
export const lineMotif = (fen, sans, opts) => lineMotif19(fen, sans, Chess, opts);
/** @see src/web/js/motif.js threatOf */
export const threatOf = (fenBefore, reply, best) => threatOf19(fenBefore, reply, best, Chess);
