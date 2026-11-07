/**
 * 开局题：背谱时对着整棵开局树判着、对手按树上的权重应着、到叶子记下背会的线，
 * 开局书的到期卡片，以及走错时说出道理。
 *
 * The opening drills' own rules, from trainer/puzzles.js — carved out in
 * v8-2-plan F1 without a change in behaviour. The trainer seats a drill and
 * hands its moves here (opTreeMove); a verdict goes back through the
 * trainer's puzzleWrong / puzzleSolved, as it always did.
 * @module trainer/puzzle-openings
 */
import { Chess } from "../chess.js";
import { ChessDrills as Drills } from "../drills.js";
import { ChessOpeningCoach } from "../opening-coach.js";
import { ChessOpeningTree } from "../opening-tree.js";
import { CHESS_OPENING_NAMES } from "../openings.js";
import { tdot } from "../tdot.js";

/**
 * @param {object} d app.js's bag, the book (puzzle-book.js) and the trainer's verdicts
 */
export function createPuzzleOpenings(d) {
  const {
    RepUI, animateReply, avail, el, moveSound, store, sync, t, tf, ALL_PUZZLES, isOpeningCat,
    openingTreeFor, savePuzzleState, puzzleWrong, puzzleSolved,
  } = d;

  /**
   * The drill an opening puzzle in progress is actually on (7.6).
   *
   * The trainer accepts any book move and the opponent answers from the whole
   * tree, so a few plies in, the board can be on a different line from the
   * one the puzzle was opened as: 1.e4 is accepted in A01's drill, and C54's
   * can end in the Rossolimo. The title, the 「背谱完成」 toast and the credit
   * all used to name the line it started as — so finishing the Rossolimo
   * marked the Italian learnt. They follow the board now: the puzzle's own
   * line while the path is still on it, else the shortest drill the path is
   * still on, and at a leaf the line that ends there.
   */
  /** Every drill of this opening drill's book, in its chair. */
  function opPool(p) {
    const side = p.side === "b" ? "b" : undefined;
    return p.cat === "rep" ? RepUI.drills(side === "b" ? "b" : "w")
      : ALL_PUZZLES.filter((q) => q.cat === "op" && q.side === side);
  }
  function opCurrent(pz) {
    const p = pz && pz.p;
    // a due card is its own position, never a line to be credited (v8-1-plan T3)
    if (p && p.card) return p;
    if (!p || !isOpeningCat(p.cat) || !Array.isArray(pz.opPath)) return p;
    const path = pz.opPath;
    const onLine = (q) => path.length <= q.line.length && path.every((san, i) => q.line[i] === san);
    if (onLine(p)) return p;
    const side = p.side === "b" ? "b" : undefined;
    let best = null;
    for (const q of opPool(p)) if (onLine(q) && (!best || q.line.length < best.line.length)) best = q;
    if (best) return best;
    // a leaf shorter than a drill (drills.js keeps >=6 plies): name it from
    // the book's own row, but credit the drill that was opened — a leaf that
    // short is not a drill, so an id minted for it would be counted nowhere
    // (not in 背下来 N/M, not by the daily plan's opening step; Codex on #79)
    const leaf = ChessOpeningTree.nodeAt(openingTreeFor(p), path);
    const ln = leaf && !Object.keys(leaf.children).length && leaf.lines[0];
    if (!ln || p.cat !== "op") return p;
    return { id: p.id, cat: "op", side,
      nameId: ln.id, eco: ln.eco, name: ln.eco + " " + (CHESS_OPENING_NAMES[ln.id] || ln.id),
      line: ln.sans.slice(), idea: ln.idea || "" };
  }

  /**
   * An opening drill's move, judged against the tree rather than one line.
   * @returns {boolean} true when this call handled the move entirely
   */
  function opTreeMove(g, mv) {
    const pz = store.session.puzzle;
    if (pz.p.card) return cardMove(g, mv);
    const path = g.history();
    const before = path.slice(0, -1);
    const tree = openingTreeFor(pz.p);
    const kids = ChessOpeningTree.childrenAt(tree, before);
    if (!kids.length) { puzzleSolved(); return true; } // already at a leaf
    if (!kids.some((k) => k.san === mv.san)) {
      // explain against the book move the player was rehearsing when it is
      // one of the options here, else the main one
      const book = kids.some((k) => k.san === pz.p.line[before.length]) ? pz.p.line[before.length] : kids[0].san;
      const why = openingWhy(g, mv, book);
      // 7.2: in your OWN book there is nothing to withhold. The built-in drills
      // make you find the book move — that is the exercise, and 「答案」 is
      // there when you cannot. A repertoire line is a thing you decided to
      // play and are trying to remember, so being told which move that was is
      // the whole exercise, not the end of it.
      puzzleWrong(pz.p.cat === "rep" ? tdot(why, tf("pz.repBook", [book])) : why);
      return true;
    }
    pz.stage++;
    pz.opPath = path.slice();
    let after = ChessOpeningTree.childrenAt(tree, path);
    if (after.length) {
      const reply = ChessOpeningTree.weightedPick(tree, path) || after[0].san;
      const rm = g.move(reply);
      if (rm) {
        pz.last = { from: rm.from, to: rm.to };
        animateReply(rm);
        moveSound(rm, g);
        pz.stage++;
        pz.opPath = g.history();
        after = ChessOpeningTree.childrenAt(tree, pz.opPath);
      }
    }
    if (!after.length) {
      // the leaf reached is a line of its own: mark it learnt too, in the
      // chair it was played from. The one the board is on is left for
      // puzzleSolved(), which credits it with the tally and the week too.
      const leaf = ChessOpeningTree.nodeAt(tree, pz.opPath);
      const onBoard = opCurrent(pz).id;
      // only ids that are drills: a book row shorter than a drill has no
      // puzzle of its own, and a key minted for it is counted nowhere
      const drillIds = new Set(opPool(pz.p).map((q) => q.id));
      for (const ln of (leaf && leaf.lines) || []) {
        // the repertoire's rows carry their own ids (repertoire.js mints them
        // once, from the moves); the ECO book's are derived from the row
        const id = (pz.p.cat === "rep" ? ln.id : Drills.drillId(ln.eco, ln.sans.join(" ")))
          + (pz.p.side === "b" ? ":b" : "");
        if (id !== onBoard && drillIds.has(id) && !store.session.puzzleState.solved[id]) {
          store.session.puzzleState.solved[id] = true;
        }
      }
      // …and so is every shorter drill the path played through from end to
      // end — the puzzle's own line among them when it was a prefix of this
      // one. A line the path left is not: it was not played.
      const path = pz.opPath;
      for (const q of opPool(pz.p)) {
        if (q.id !== onBoard && q.line.length < path.length && q.line.every((san, i) => path[i] === san)) {
          store.session.puzzleState.solved[q.id] = true;
        }
      }
      puzzleSolved();
      return true;
    }
    sync();
    return true;
  }

  /**
   * v8-1-plan T3: a due card's one question — the move your book plays here
   * (any of them, when it plays several). The first answer is the grade;
   * a retry after a miss, or after 「答案」, does not grade it again.
   */
  function gradeCard(ok) {
    const pz = store.session.puzzle;
    if (!pz.p.card || pz.graded) return;
    pz.graded = true;
    RepUI.grade(pz.p, ok);
  }
  function cardMove(g, mv) {
    const pz = store.session.puzzle;
    if (!pz.p.answers.includes(mv.san)) {
      const why = openingWhy(g, mv, pz.p.answers[0]);
      gradeCard(false);
      puzzleWrong(tdot(why, tf("pz.repBook", [pz.p.answers.join(" / ")])));
      return true;
    }
    pz.stage++;
    pz.opPath = g.history();
    puzzleSolved();
    return true;
  }

  /**
   * Sit in a chair the repertoire actually has lines for.
   *
   * The 开局书 tab is drawn from `RepUI.total()` — both books together — while
   * the list it serves is one chair at a time. Import a Black book only, and
   * the tab appears while `opSide` still says White: the category is empty,
   * the guard below falls back to 一步杀, and the side segment never gets
   * drawn because nobody ever entered the category. The book is there and
   * there is no way in. Same rule 「开始背」 already follows.
   */
  function seatRepSide() {
    const cur = store.session.puzzleState.opSide === "b" ? "b" : "w";
    if (RepUI.drills(cur).length || !RepUI.total()) return;
    store.session.puzzleState.opSide = cur === "w" ? "b" : "w";
    savePuzzleState();
  }

  /**
   * Say why an opening move is wrong, not merely that it is.
   *
   * "这不是谱着" is a fact about a line the player has not memorised yet, which
   * is exactly what they came here to learn — it teaches nothing. The coach
   * names the principle instead. `g` already has the move on the board, so
   * everything before it is the drill so far.
   */
  function openingWhy(g, mv, bookSan) {
    const Coach = ChessOpeningCoach;
    if (!Coach || !bookSan) return t("pz.offBook");
    let r = null;
    try { r = Coach.critique(store.session.puzzle.p.fen || "", g.history().slice(0, -1), mv.san, bookSan, Chess); }
    catch (_) { r = null; }
    if (!r) return t("pz.offBook");
    // the coach knows nothing about the dictionary, so a piece comes back as
    // its key ("piece.n") and is turned into a word here
    const vals = r.vals.map((v) => (typeof v === "string" && v.startsWith("piece.") ? t(v) : v));
    return tf(r.key, vals);
  }

  /** The 执白/执黑 row exists only where there are two chairs: the op list. */
  function syncOpSideSeg(cat) {
    avail(el("row-op-side"), isOpeningCat(cat));
    const side = store.session.puzzleState.opSide === "b" ? "b" : "w";
    document.querySelectorAll("#op-side-seg button").forEach((b) => {
      b.classList.toggle("active", b.dataset.side === side);
    });
  }

  return {
    opCurrent, opTreeMove, gradeCard, seatRepSide, openingWhy, syncOpSideSeg,
  };
}
