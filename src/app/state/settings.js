/**
 * Settings: the look for now. Stored as settings.set events; the projection
 * gives them back at start.
 * @module state/settings
 */
import { PIECE_SET_IDS, BOARD_THEMES, DEFAULT_PIECE_SET } from "../core/pieces.js";

export const SETTINGS_DEFAULT = Object.freeze({ appearance: "system", boardTheme: "wood", pieceSet: DEFAULT_PIECE_SET });

const VALID = {
  appearance: (v) => ["system", "light", "dark"].includes(v),
  boardTheme: (v) => BOARD_THEMES.includes(v),
  pieceSet: (v) => PIECE_SET_IDS.includes(v),
};

export const settingsActions = {
  "settings.set": (s, { key, value }) => {
    if (!VALID[key] || !VALID[key](value)) throw new Error("settings.set: bad " + key + "=" + value);
    return { ...s, settings: { ...s.settings, [key]: value } };
  },
  /** Saved values over the defaults; anything not valid is left out. */
  "settings.load": (s, saved) => {
    const next = { ...s.settings };
    for (const [k, v] of Object.entries(saved || {})) if (VALID[k] && VALID[k](v)) next[k] = v;
    return { ...s, settings: next };
  },
};

/** The shell palette for an appearance and a board: warm boards sit in warm shells. */
export function shellFor(appearance, boardTheme, prefersDark) {
  const dark = appearance === "dark" || (appearance === "system" && prefersDark);
  const warm = boardTheme === "wood";
  return dark ? (warm ? "wood" : "night") : (warm ? "day" : "notebook");
}
