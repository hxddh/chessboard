/**
 * The facts-only explainer and the motif detectors, reused unchanged from
 * src/web/js (ADR 0002: the pure logic stays), with chess.js bound in.
 * Like core/chess.js, this is the one file that changes the day src/web goes.
 * @module core/explain
 */
import { Chess } from "./chess.js";
import { explainMistake as explain19, explainParts, explainText, explainKey, explainMotif, figurine, lineAfter, retryQuick }
  from "../../web/js/explain.js";
import { lineMotif as lineMotif19, threatOf as threatOf19 } from "../../web/js/motif.js";

export { explainParts, explainText, explainKey, explainMotif, figurine, lineAfter, retryQuick };
/** @see src/web/js/explain.js explainMistake */
export const explainMistake = (x) => explain19(x, Chess);
/** @see src/web/js/motif.js lineMotif */
export const lineMotif = (fen, sans, opts) => lineMotif19(fen, sans, Chess, opts);
/** @see src/web/js/motif.js threatOf */
export const threatOf = (fenBefore, reply, best) => threatOf19(fenBefore, reply, best, Chess);
