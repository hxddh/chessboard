/**
 * How the app looks, as data: appearance × board × frame × pieces
 * (v8-0-plan A3).
 *
 * Four independent answers:
 *
 *   appearance  system | light | dark — whether the interface is light or
 *               dark; "system" follows prefers-color-scheme live (the default)
 *   board       wood | green | blue | paper | marble — the squares, their
 *               marks and any texture ([data-board] in styles.css)
 *   frame       flat | frame — a flat board with rounded corners and the
 *               coordinates in the squares (the default), or a wooden frame
 *               with the coordinates printed on it
 *   pieceSet    one of PIECE_SET_IDS (board.js draws them)
 *
 * The shell palette ([data-theme]) is not a fifth choice: it is the
 * appearance, tinted to go with the board — a warm board (wood, paper,
 * marble) sits in the walnut or the cream shell, a cool one (green, blue) in
 * the teal or the blue-grey.
 *
 * Pure: no DOM, no storage. app.js and appearance-ui.js apply it.
 * @module look
 */

export const APPEARANCES = ["system", "light", "dark"];

/** The boards, in picker order; `warm` picks the shell family. */
export const BOARDS = [
  { id: "wood", warm: true },
  { id: "green", warm: false },
  { id: "blue", warm: false },
  { id: "paper", warm: true },
  { id: "marble", warm: true },
];
export const BOARD_IDS = BOARDS.map((b) => b.id);

export const FRAMES = ["flat", "frame"];

/**
 * The piece sets, in picker order. `cburnett` is the default and lives in the
 * bundle with `classic` (pieces.js); the rest are chunks
 * (lazy-content.js PIECE_CHUNKS). Every one is licence-cleared in its own
 * module's header and credited in the About panel.
 */
export const PIECE_SET_IDS = ["cburnett", "merida", "chessnut", "fantasy", "celtic", "spatial", "classic"];

/** What a first run gets. */
export const LOOK_DEFAULT = Object.freeze({ appearance: "system", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" });

const has = (list, v) => typeof v === "string" && list.includes(v);

/**
 * The look from saved settings, field by field: an unknown value falls back
 * to the default for that field alone.
 * @param {object|null} s the stored settings object
 * @returns {{appearance: string, boardId: string, boardFrame: string, pieceSet: string}}
 */
export function readLook(s) {
  const out = Object.assign({}, LOOK_DEFAULT);
  if (!s || typeof s !== "object") return out;
  if (has(PIECE_SET_IDS, s.pieceSet)) out.pieceSet = s.pieceSet;
  if (has(APPEARANCES, s.appearance)) out.appearance = s.appearance;
  if (has(BOARD_IDS, s.boardId)) out.boardId = s.boardId;
  if (has(FRAMES, s.boardFrame)) out.boardFrame = s.boardFrame;
  return out;
}

/** "light" | "dark": the appearance with "system" answered. */
export function resolveAppearance(appearance, prefersDark) {
  if (appearance === "light" || appearance === "dark") return appearance;
  return prefersDark ? "dark" : "light";
}

/**
 * The shell palette ([data-theme]) for a resolved appearance on a board.
 * @param {"light"|"dark"} scheme
 * @param {string} boardId
 * @returns {"wood"|"night"|"day"|"notebook"}
 */
export function shellFor(scheme, boardId) {
  const b = BOARDS.find((x) => x.id === boardId) || BOARDS[0];
  if (scheme === "dark") return b.warm ? "wood" : "night";
  return b.warm ? "day" : "notebook";
}

/**
 * The attributes the stylesheet keys on, for one look.
 * @returns {{theme: string, board: string, frame: string}}
 */
export function lookAttrs(look, prefersDark) {
  const boardId = has(BOARD_IDS, look.boardId) ? look.boardId : LOOK_DEFAULT.boardId;
  return {
    theme: shellFor(resolveAppearance(look.appearance, prefersDark), boardId),
    board: boardId,
    frame: has(FRAMES, look.boardFrame) ? look.boardFrame : LOOK_DEFAULT.boardFrame,
  };
}

export const ChessLook = { APPEARANCES, BOARDS, BOARD_IDS, FRAMES, PIECE_SET_IDS, LOOK_DEFAULT,
  readLook, resolveAppearance, shellFor, lookAttrs };
