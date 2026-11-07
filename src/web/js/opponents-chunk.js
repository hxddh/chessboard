/**
 * The opponents, as an on-demand chunk (v8-0-plan B4, F5's budget).
 *
 * opponents.js, opponents-ui.js and persona.js are ~22 KB of code the first
 * frame does not need: the ladder's ratings, the persona cards, the rating
 * maths and the styles only matter once a dialog opens or the engine moves.
 * scripts/bundle.mjs builds this entry into js/chunk-opponents.js;
 * opponents-lazy.js (in the bundle) loads it at startup and forwards to it.
 * @module opponents-chunk
 */
import { Opponents } from "./opponents.js";
import { createOpponentsUI } from "./opponents-ui.js";
import { ChessPersona } from "./persona.js";

export const CHESS_OPPONENTS = { Opponents, createOpponentsUI, ChessPersona };
