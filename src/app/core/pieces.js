/**
 * The three piece sets, reused from src/web/js (each licence-cleared in its own
 * module's header). Loaded on demand: a player sees one set.
 * @module core/pieces
 */
export const PIECE_SETS = {
  merida: () => import("../../web/js/pieces-merida.js").then((m) => m.MERIDA_PIECE_SVGS),
  cburnett: () => import("../../web/js/pieces-cburnett.js").then((m) => m.CBURNETT_PIECE_SVGS),
  classic: () => import("../../web/js/pieces.js").then((m) => m.CHESS_PIECE_SVGS),
};
export const PIECE_SET_IDS = Object.keys(PIECE_SETS);
export const DEFAULT_PIECE_SET = "merida";
export const BOARD_THEMES = ["wood", "green", "blue"];
