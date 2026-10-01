/**
 * The content that is not in bundle.js, and when it arrives (v8-0-plan F5).
 *
 * 7.9's bundle was 1.71 MB, and the first paint used barely a third of what
 * it parsed: the two interface languages and the translated teaching content
 * the reader was not reading in (~490 KB), the 1,002 mined puzzles (176 KB),
 * and a second piece set (34 KB). Each is a chunk now — built by
 * scripts/bundle.mjs, loaded by chunk.js — and this module is the one place
 * that knows which chunk holds what and who needs it when:
 *
 *   - the **current language** is needed by the first frame, so chunk-boot.js
 *     (bootPlan below) writes its script tag ahead of bundle.js and the bundle
 *     finds it already on the window. No frame is ever drawn in the wrong
 *     language; a switch in the settings waits for the chunk (ensureLang).
 *   - the **mined puzzles** are needed by the puzzle trainer and by the counts
 *     the badges and the plan read. A session that starts in puzzle mode gets
 *     them before the bundle, the same way; every other session fetches them
 *     right after the first paint, the way the engine is booted.
 *   - **a piece set other than the two in the bundle** is needed only by a
 *     player who chose it; board.js asks (v8-0-plan A3: Merida, and since
 *     8.0 four more — PIECE_CHUNKS).
 *
 * zh-CN, the source, stays in the bundle: it is also every other language's
 * last fallback, key by key.
 * @module lazy-content
 */
import { loadChunk, chunkReady } from "./chunk.js";
import { LANG_IDS, FALLBACK_LANG, detectLang } from "./lang-ids.js";

  /**
   * The chunks each language needs, in load order. Japanese reads English as
   * the bridge for a sentence it has not translated (app.js contentTables),
   * so it takes both — the same chain the lookup walks.
   */
  export const LANG_CHUNKS = {
    "zh-CN": [],
    en: [{ file: "chunk-lang-en.js", global: "CHESS_I18N_EN" }],
    ja: [{ file: "chunk-lang-en.js", global: "CHESS_I18N_EN" }, { file: "chunk-lang-ja.js", global: "CHESS_I18N_JA" }],
  };
  export const MINED_CHUNK = { file: "chunk-mined.js", global: "MINED_PUZZLES" };
  export const MERIDA_CHUNK = { file: "chunk-merida.js", global: "MERIDA_PIECE_SVGS" };
  /**
   * v8-0-plan A3: every piece set but the two the bundle carries (the default
   * cburnett, and pieces.js — the 7.x drawing the move list's figurines are
   * cut from) is a chunk of its own, by set id. Merida keeps its M1 file
   * name.
   */
  export const PIECE_CHUNKS = {
    merida: MERIDA_CHUNK,
    chessnut: { file: "chunk-pieces-chessnut.js", global: "CHESSNUT_PIECE_SVGS" },
    fantasy: { file: "chunk-pieces-fantasy.js", global: "FANTASY_PIECE_SVGS" },
    celtic: { file: "chunk-pieces-celtic.js", global: "CELTIC_PIECE_SVGS" },
    spatial: { file: "chunk-pieces-spatial.js", global: "SPATIAL_PIECE_SVGS" },
  };

  /**
   * v8-0-plan A4 + F5: two pieces of the review that the first paint never
   * uses — the exported picture of the report (drawn on 导出复盘图) and the
   * key-moments card (drawn once a game is analysed). Chunks, so the review
   * view's new code does not push the bundle past the F5 budget.
   */
  export const REVIEW_CHUNKS = {
    report: { file: "chunk-report.js", global: "ChessReport" },
    moments: { file: "chunk-moments.js", global: "createMoments" },
  };

  /** Where the settings live — persist.js KEYS.settings, read raw by chunk-boot.js. */
  export const SETTINGS_KEY = "chess.v1.settings";

  /**
   * The chunks the first frame needs, from the saved settings as stored.
   *
   * The same decisions app.js makes at boot, made earlier: a saved language
   * wins; no settings at all is a first run, where the system locale decides
   * (lang-ids.js detectLang, the function i18n.js uses); settings without a
   * language mean the Chinese default. Guessing wrong is never fatal — app.js
   * checks what actually arrived and fetches anything missing — it only
   * costs the frame the guess was for.
   *
   * @param {string|null} settingsRaw the stored settings JSON, or null
   * @param {object} [nav] navigator-like, for the first-run guess
   * @returns {string[]} chunk file names under js/, in load order
   */
  export function bootPlan(settingsRaw, nav) {
    let s = null;
    try { s = settingsRaw ? JSON.parse(settingsRaw) : null; } catch (_) { s = null; }
    if (!s || typeof s !== "object") s = null;
    const lang = s ? (LANG_IDS.includes(s.langId) ? s.langId : FALLBACK_LANG) : detectLang(nav);
    const out = LANG_CHUNKS[lang].map((c) => c.file);
    if (s && s.mode === "puzzle") out.push(MINED_CHUNK.file);
    if (s && Object.prototype.hasOwnProperty.call(PIECE_CHUNKS, s.pieceSet)) out.push(PIECE_CHUNKS[s.pieceSet].file);
    return out;
  }

  /** Is everything language `id` needs on the window? */
  function langReady(id) { return (LANG_CHUNKS[id] || []).every((c) => chunkReady(c.global)); }
  /** Fetch whatever language `id` still lacks. @returns {Promise<void>} */
  function ensureLang(id) {
    return Promise.all((LANG_CHUNKS[id] || []).map((c) => loadChunk(c.file, c.global))).then(() => undefined);
  }
  /**
   * Language `id`'s content tables — words only, keyed like the Chinese
   * source. A table whose chunk has not arrived is undefined, which the
   * lookup in app.js already skips.
   */
  function langTables(id) {
    const g = globalThis;
    const sfx = id.toUpperCase().replace(/-/g, "_");
    return {
      lessons: g["CHESS_LESSONS_" + sfx], puzzles: g["CHESS_PUZZLES_" + sfx],
      openings: g["CHESS_OPENINGS_" + sfx], ideas: g["CHESS_OPENING_IDEAS_" + sfx],
      classics: g["CHESS_CLASSICS_" + sfx],
      // v8-2-plan T1: the advanced lessons carry their own words (trainer/lessons-adv.js)
      lessonsAdv: g.CHESS_LESSONS_ADV && g.CHESS_LESSONS_ADV[id],
    };
  }

  /** The mined puzzles, or null until their chunk is here. */
  function mined() { return globalThis[MINED_CHUNK.global] || null; }
  /** @returns {Promise<object[]>} */
  function ensureMined() { return loadChunk(MINED_CHUNK.file, MINED_CHUNK.global); }

  export const ChessLazy = { langReady, ensureLang, langTables, mined, ensureMined };
