/**
 * The first-run question — asked once, on a genuinely fresh install.
 *
 * Everything the app has for a beginner — the interactive course, the rungs
 * that make real mistakes on purpose — was reachable only by someone who
 * already knew to go looking. Until 1.7 the first screen was a 1700-rated
 * Stockfish, which is exactly the "hard to get started" complaint the whole
 * teaching side was built to answer.
 *
 * v10-0-plan T1: three answers, as Duolingo Chess asks them — never played,
 * know the moves, play often — and the latter two go through a placement:
 * six puzzles whose difficulty follows the answers (trainer/runs.js
 * 「定级」), whose estimate becomes the puzzle rating and picks the opponent.
 * The never-played answer goes to lesson 1, as before. Dismissing the dialog
 * leaves the player on the board against the default rung (休闲, not the
 * 1700 中级 it was through 9.0), so this can never trap anyone.
 *
 * Moved out of app.js with T1, which grew it past the file's line budget.
 * @module onboarding
 */

/** Where each self-assessment starts its placement (a puzzle rating). */
export const PLACE_BASE = { knows: 900, often: 1400 };

/** How far the opponent sits below the placed puzzle rating — a puzzle
    rating runs ahead of how the same player does over a whole game. */
export const OPP_BELOW = 300;

/**
 * @param {object} d what the question needs from app.js
 */
export function createOnboarding(d) {
  const {
    t, store, pickFromList, startLearn, startPlacement, setPanelOpen, panelCoversBoard,
    saveSettings, maybeEngineTurn,
  } = d;

  async function run() {
    // 5.1: the first door is marked as the one to take, and the way out says
    // where it leads (audit, work package E)
    const choice = await pickFromList(t("ob.title"), [
      { label: t("ob.newLabel"), sub: t("ob.newSub"), tag: t("ob.recommended") },
      { label: t("ob.knowLabel"), sub: t("ob.knowSub") },
      { label: t("ob.oftenLabel"), sub: t("ob.oftenSub") },
    ], { cancelLabel: t("ob.later") });
    if (choice === 0) {
      store.session.mode = "learn";
      // …and the engine they meet after the first lessons is the one built
      // for them (7.6 §3a)
      store.session.difficulty = "beginner";
      startLearn();
    } else if (choice !== 1 && choice !== 2) {
      store.session.mode = "ai";
    }
    // …but not where the panel is a full-height sheet over the board: ending
    // the onboarding by covering the thing it just set up is not a welcome
    // (7.3 §1)
    setPanelOpen(!panelCoversBoard());
    saveSettings();
    store.commit("session", "sync");
    if (choice === 1 || choice === 2) startPlacement(choice === 1 ? PLACE_BASE.knows : PLACE_BASE.often);
    else if (choice !== 0) maybeEngineTurn();
  }

  return { run };
}
