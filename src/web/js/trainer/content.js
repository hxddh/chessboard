/**
 * 训练的文字：课程、题目与开局的说明文字按当前语言取出，以及一道题在教什么。
 *
 * Carved out of app.js with the rest of the trainer (v8-0-plan F4): the lesson
 * runner, the puzzle trainer and today's plan all name things through these,
 * so they are their own module rather than a corner of any one of them.
 * `MINED_ORDINAL` lives here because `puzzleName` reads it; the puzzle
 * trainer fills it when the mined chunk joins.
 *
 * Everything it needs from the app arrives in the bag handed to
 * `createTrainerContent()` (createLibraryUI's shape); nothing here reaches
 * back into app.js.
 * @module trainer/content
 */
import { Chess } from "../chess.js";
import { ChessLazy } from "../lazy-content.js";
import { motifOf, puzzleMotifKey } from "../motif.js";
import { CHESS_OPENING_NAMES } from "../openings.js";
import { HAND_MOTIF_KEY } from "../puzzles.js";

/**
 * @param {object} d everything this module borrows from app.js
 */
export function createTrainerContent(d) {
  const {
    store, t, tf,
  } = d;

  /**
   * Content tables per language. Chinese is the source and lives in
   * lessons.js / puzzles.js / openings.js; every other language gets a
   * translation file holding words only.
   *
   * Through 1.20 the lookup was `langId !== "zh-CN" ? …_EN : null` — one
   * branch, so the interface had three languages and the teaching had two,
   * and a Japanese player read a Japanese interface wrapped around English
   * lessons. Now each language names its own tables and the lookup walks a
   * chain: the active language, then English as a bridge, then the Chinese
   * original. The chain is per *field*, so a half-finished translation
   * degrades sentence by sentence instead of dropping a whole lesson.
   *
   * The tables themselves are chunks since v8-0-plan F5 (lazy-content.js),
   * on the page before the first frame for the language in use.
   */
  /** tables to consult for `kind`, best match first (empty when reading source) */
  function contentTables(kind) {
    const out = [];
    if (store.ui.langId === "zh-CN") return out;
    for (const id of [store.ui.langId, "en"]) {
      const tbl = ChessLazy.langTables(id)[kind];
      if (tbl && out.indexOf(tbl) < 0) out.push(tbl);
    }
    return out;
  }
  /** first translated `field` of entry `key`, or null to use the source */
  function contentField(kind, key, field) {
    for (const tbl of contentTables(kind)) {
      const entry = tbl[key];
      if (entry && entry[field]) return entry[field];
    }
    return null;
  }

  /**
   * Lesson prose in the active language, falling back to the authored Chinese.
   * Only text is localised — positions, goals and solutions always come from
   * lessons.js, so a translation can never change what a lesson teaches.
   */
  function lessonText(lesson) {
    return {
      part: contentField("lessons", lesson.id, "part") || lesson.part,
      title: contentField("lessons", lesson.id, "title") || lesson.title,
      text: contentField("lessons", lesson.id, "text") || lesson.text,
    };
  }
  /** localised prose for task `ti` of `lesson` (prompt / retry / tap tips) */
  function taskText(lesson, ti) {
    const task = lesson.tasks[ti];
    const taskField = (field) => {
      for (const tbl of contentTables("lessons")) {
        const entry = tbl[lesson.id];
        const tt = entry && entry.tasks && entry.tasks[ti];
        if (tt && tt[field]) return tt[field];
      }
      return null;
    };
    return {
      prompt: taskField("prompt") || task.prompt,
      retry: taskField("retry") || task.retry,
      step: (i) => {
        for (const tbl of contentTables("lessons")) {
          const entry = tbl[lesson.id];
          const tt = entry && entry.tasks && entry.tasks[ti];
          if (tt && tt.steps && tt.steps[i]) return tt.steps[i];
        }
        return task.steps && task.steps[i] && task.steps[i].tip;
      },
    };
  }

  /**
   * Localised puzzle prose. Same split as the lessons: puzzles.js owns the
   * chess (fen, solution, gain), puzzles-en.js owns only the words, so a
   * translation can never disagree with what the puzzle actually is.
   */
  function puzzleName(p) {
    // opening drills are named by the book, not by the puzzle tables; the
    // black sibling carries its chair in the name so toasts and history rows
    // never leave "which side was that" to memory
    if (p.cat === "op" && p.nameId)
      return p.eco + " " + openingName(p.nameId) + (p.side === "b" ? " · " + t("color.black") : "");
    if (p.cat === "mine") {
      const d = new Date(p.t || 0);
      const mm = String(d.getMonth() + 1).padStart(2, "0"), dd = String(d.getDate()).padStart(2, "0");
      return tf("pz.mineName", [mm + "-" + dd, Math.floor((p.ply || 0) / 2) + 1]);
    }
    // a repertoire line is named by the book it came from — the ECO name when
    // the position is a known one, and the chair, for the same reason the
    // built-in drills carry theirs
    if (p.cat === "rep") return p.name + (p.side === "b" ? " · " + t("color.black") : "");
    if (p.src === "mined") return t("pz.cat." + p.cat) + " #" + (MINED_ORDINAL.get(p.id) || "");
    // v8-0-plan B1: an imported puzzle is named by its Lichess id
    if (p.src === "lichess") return t("pz.cat." + p.cat) + " #" + p.id.slice(3);
    return contentField("puzzles", p.id, "name") || p.name;
  }
  /**
   * What this puzzle is teaching.
   *
   * Hand-written first, then derived, then the generic fallback. 21 of the 168
   * carried a motif and all of them were in `tac`, so "practise pins today"
   * could only reach those 21 while the real-game and capture sets are full of
   * unlabelled ones. motif.js works the rest out from the position — and says
   * nothing where it is not sure, because a wrong motif in a teaching app
   * teaches the wrong thing. 缺陷 28.
   */
  const MOTIF_CACHE = new Map();
  function derivedMotif(p) {
    if (MOTIF_CACHE.has(p.id)) return MOTIF_CACHE.get(p.id);
    const line = p.line || p.solution || [];
    let m = null;
    if (p.fen && line.length) { try { m = motifOf(p.fen, line[0], Chess); } catch (_) { m = null; } }
    MOTIF_CACHE.set(p.id, m);
    return m;
  }
  /** The motif KEY (fork, pin, …) of a puzzle, or null — the join key the
      motif tally, the planner and 为你出一题 share (5.2). A personal drill is
      read live: its answer can change under revision, and the cache is by id. */
  function motifKeyOf(p) {
    if (!p) return null;
    if (p.cat === "mine") {
      try { return p.fen && p.solution && p.solution[0] ? motifOf(p.fen, p.solution[0], Chess) : null; } catch (_) { return null; }
    }
    if (p.cat !== "tac" && p.cat !== "real" && p.cat !== "win") return null;
    // A written label wins, as it does on screen (puzzleMotif). 「把车引离底线」
    // is labelled 引离 and its first move, Re8+, also hits king and rook — so
    // the derivation said fork and the tally counted a fork the player was
    // never shown (7.6). A label outside the five keys counts as no motif.
    return puzzleMotifKey(p, HAND_MOTIF_KEY, () => derivedMotif(p));
  }
  function puzzleMotif(p) {
    // an imported puzzle's motif is motif.js's key (puzzle-db.js), not a label
    if (p.src === "lichess" && p.motif) return t("motif." + p.motif);
    const hand = contentField("puzzles", p.id, "motif") || p.motif;
    if (hand) return hand;
    const d = derivedMotif(p);
    return d ? t("motif." + d) : t("pz.forcing");
  }
  function puzzleIdea(p) {
    if (p.cat === "op" && p.nameId) return openingIdea(p.nameId) || p.idea || "";
    return contentField("puzzles", p.id, "idea") || p.idea || "";
  }
  /**
   * Localised opening name, looked up by the line's id.
   *
   * Up to 1.25 the lookup key was the Chinese name itself, in every table. So
   * renaming one opening in openings.js silently unkeyed both translations at
   * once and every language quietly fell back to the Chinese string — a
   * content edit with no failing test and no visible symptom until someone
   * opened the app in English. The id makes a rename a rename.
   */
  function openingName(id) {
    for (const tbl of contentTables("openings")) if (tbl[id]) return tbl[id];
    return CHESS_OPENING_NAMES[id] || id;
  }
  /** …and the sentence explaining what the line is trying to do. */
  function openingIdea(id) {
    for (const tbl of contentTables("ideas")) if (tbl[id]) return tbl[id];
    return "";
  }

  /** mined id → its number within its category; trainer/puzzles.js fills it
      when the mined chunk joins (joinMined) */
  const MINED_ORDINAL = new Map();

  return {
    contentField, lessonText, taskText, puzzleName, motifKeyOf, puzzleMotif, puzzleIdea,
    MINED_ORDINAL,
  };
}
