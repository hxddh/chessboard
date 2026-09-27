/**
 * How the app looks, as data: appearance × board × frame × pieces
 * (v8-0-plan A3).
 *
 * Through 7.x one setting, `themeId`, chose four things at once — the shell's
 * colours, the squares, the frame and the coordinate ink — from four
 * pairings (木 / 夜 / 日 / 纸), two of which were one board: 日's squares
 * (#eddcc0 / #c39a6b) and 木's (#f0d9b5 / #b58863) are ΔE00 6.4 apart on
 * the dark square and 2.8 on the light one, a difference nobody chooses
 * between (docs/measured.json boardLook). And "follow the
 * system" was a second switch that overwrote the first.
 *
 * Now there are four independent answers:
 *
 *   appearance  system | light | dark — whether the interface is light or
 *               dark; "system" follows prefers-color-scheme live (the default)
 *   board       wood | green | blue | paper | marble — the squares, their
 *               marks and any texture ([data-board] in styles.css)
 *   frame       flat | frame — a flat board with rounded corners and the
 *               coordinates in the squares (the default), or the 7.x wooden
 *               frame with the coordinates printed on it
 *   pieceSet    one of PIECE_SET_IDS (board.js draws them)
 *
 * The shell palette ([data-theme]) is not a fifth choice: it is the
 * appearance, tinted to go with the board — a warm board (wood, paper,
 * marble) sits in the walnut or the cream shell, a cool one (green, blue) in
 * the teal or the blue-grey. That keeps all four 7.x shells, and it is what
 * makes the migration below exact: every old themeId lands on the shell it
 * had.
 *
 * Pure: no DOM, no storage. app.js and appearance-ui.js apply it;
 * scripts/test-persist.mjs proves the migration against every old id.
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
 * bundle with `classic` (pieces.js, the 7.x drawing); the rest are chunks
 * (lazy-content.js PIECE_CHUNKS). Every one is licence-cleared in its own
 * module's header and credited in the About panel.
 */
export const PIECE_SET_IDS = ["cburnett", "merida", "chessnut", "fantasy", "celtic", "spatial", "classic"];

/** What a first run gets (v8-0-plan §8 decision 3: the default look changes). */
export const LOOK_DEFAULT = Object.freeze({ appearance: "system", boardId: "wood", boardFrame: "flat", pieceSet: "cburnett" });

/**
 * The four 7.x themes, as the two new dimensions. Each keeps its shell
 * (shellFor below gives back the same data-theme) and the board it drew:
 * 夜's teal squares are the green board's family, 纸's blue-grey ones the
 * blue board's, and 日 was 木's board in the light shell.
 */
export const LEGACY_THEMES = {
  wood: { appearance: "dark", boardId: "wood" },
  night: { appearance: "dark", boardId: "green" },
  day: { appearance: "light", boardId: "wood" },
  notebook: { appearance: "light", boardId: "blue" },
};

const has = (list, v) => typeof v === "string" && list.includes(v);

/**
 * The look from saved settings, whatever version wrote them.
 *
 * Settings with an `appearance` were written by 8.0 and are read field by
 * field (an unknown value falls back to the default for that field alone).
 * Settings without one are 7.x: `themeId` becomes appearance + board,
 * `followSystem: true` wins over the theme's appearance (it was overriding
 * it every launch anyway), and the frame is the new flat default — the
 * look change was approved for everybody (§8), not only for new installs.
 * `pieceSet` keeps its value where the id still exists: "cburnett" was the
 * 7.x default and every 7.7+ profile has it written down, so it cannot tell a
 * choice from a default and moves to the new default drawing under the same
 * id; "merida" was always a choice and stays.
 *
 * @param {object|null} s the stored settings object
 * @returns {{appearance: string, boardId: string, boardFrame: string, pieceSet: string}}
 */
export function migrateLook(s) {
  const out = Object.assign({}, LOOK_DEFAULT);
  if (!s || typeof s !== "object") return out;
  if (has(PIECE_SET_IDS, s.pieceSet)) out.pieceSet = s.pieceSet;
  if (typeof s.appearance === "string") {
    if (has(APPEARANCES, s.appearance)) out.appearance = s.appearance;
    if (has(BOARD_IDS, s.boardId)) out.boardId = s.boardId;
    if (has(FRAMES, s.boardFrame)) out.boardFrame = s.boardFrame;
    return out;
  }
  const legacy = Object.prototype.hasOwnProperty.call(LEGACY_THEMES, s.themeId) ? LEGACY_THEMES[s.themeId] : null;
  if (legacy) { out.appearance = legacy.appearance; out.boardId = legacy.boardId; }
  if (s.followSystem === true) out.appearance = "system";
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

export const ChessLook = { APPEARANCES, BOARDS, BOARD_IDS, FRAMES, PIECE_SET_IDS, LOOK_DEFAULT, LEGACY_THEMES,
  migrateLook, resolveAppearance, shellFor, lookAttrs };
