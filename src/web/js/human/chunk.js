/**
 * chunk-human.js (13.0 H): everything Maia needs on the page's side, loaded
 * the first time an opponent or the 「人会怎么走」 line asks for it
 * (human-lazy.js). The weights are separate scripts, one per band.
 * @module human/chunk
 */
import { createHuman } from "./worker.js";
import { createHumanLine } from "../review/human-line.js";

export const CHESS_HUMAN = { createHuman, createHumanLine };
