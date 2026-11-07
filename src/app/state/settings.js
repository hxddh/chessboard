/**
 * Settings: the language, the look, the sound, the coach. Stored as
 * settings.set events; the projection gives them back at start.
 * @module state/settings
 */
import { PIECE_SET_IDS, BOARD_THEMES, DEFAULT_PIECE_SET } from "../core/pieces.js";
import { LANGS } from "../text/lang.js";

/**
 * `level`: the player's own strength, until the learner model knows it.
 * `coach`: the question before a move (v20-0-plan §3 P2) — "auto" follows
 * the level (beginners on, from 1500 off).
 * `lang`: the interface language. The default here is the source's; main.js
 * starts from the system's locale until one is chosen (text/lang.js).
 */
export const LEVELS = [600, 1000, 1500, 2000];
export const SETTINGS_DEFAULT = Object.freeze({ lang: "zh", appearance: "system", boardTheme: "wood", pieceSet: DEFAULT_PIECE_SET,
  sound: "on", coach: "auto", level: 1000 });

const VALID = {
  lang: (v) => LANGS.includes(v),
  appearance: (v) => ["system", "light", "dark"].includes(v),
  boardTheme: (v) => BOARD_THEMES.includes(v),
  pieceSet: (v) => PIECE_SET_IDS.includes(v),
  sound: (v) => ["on", "off"].includes(v),
  coach: (v) => ["auto", "on", "off"].includes(v),
  level: (v) => LEVELS.includes(v),
};

/** Is the coach's question on, for these settings? */
export const coachOn = (s) => s.coach === "on" || (s.coach === "auto" && s.level < 1500);

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
