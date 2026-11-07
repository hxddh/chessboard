/**
 * FSRS-5 against the published examples: py-fsrs 4.1.2's own tests
 * (tests/test_fsrs.py: test_review_card, test_memo_state,
 * test_repeated_correct_reviews), which use the default weights.
 */
import { createScheduler, fsrs, W5, DAY, FACTOR, AGAIN, HARD, GOOD, EASY, REVIEW, LEARNING, RELEARNING, roundHalfEven }
  from "../../src/app/learn/fsrs.js";

const T0 = Date.UTC(2022, 10, 29, 12, 30, 0);

export default function (test) {
  test("fsrs: R(S, S) = 0.9 and I(S) = S at 90% retention", (a) => {
    for (const s of [1, 3.173, 15.7, 200]) {
      const r = (1 + (FACTOR * s) / s) ** -0.5;
      a.ok(Math.abs(r - 0.9) < 1e-12, "R(S,S) for S=" + s);
    }
    a.equal(fsrs.interval(3.173), 3);
    a.equal(fsrs.interval(15.69105), 16);
    a.equal(W5.length, 19);
  });

  test("fsrs: py-fsrs test_review_card interval history", (a) => {
    const ratings = [GOOD, GOOD, GOOD, GOOD, GOOD, GOOD, AGAIN, AGAIN, GOOD, GOOD, GOOD, GOOD, GOOD];
    let card = fsrs.newCard(T0), now = T0;
    const ivl = [];
    for (const g of ratings) {
      card = fsrs.review(card, g, now);
      ivl.push(Math.floor((card.due - card.last) / DAY));
      now = card.due;
    }
    a.deepEqual(ivl, [0, 4, 14, 44, 125, 328, 0, 0, 7, 16, 34, 71, 142]);
  });

  test("fsrs: py-fsrs test_memo_state", (a) => {
    let card = fsrs.newCard(T0), now = T0;
    const ratings = [AGAIN, GOOD, GOOD, GOOD, GOOD, GOOD];
    const gaps = [0, 0, 1, 3, 8, 21];
    ratings.forEach((g, i) => { card = fsrs.review(card, g, now); now += gaps[i] * DAY; });
    card = fsrs.review(card, GOOD, now);
    a.equal(Math.round(card.s), 49);
    a.equal(Math.round(card.d * 1e4) / 1e4, 7.0866);
  });

  test("fsrs: py-fsrs test_repeated_correct_reviews (Easy ×10 → D = 1)", (a) => {
    let card = fsrs.newCard(T0);
    for (let i = 0; i < 10; i++) card = fsrs.review(card, EASY, T0 + i);
    a.equal(card.d, 1);
  });

  test("fsrs: states, steps and lapses", (a) => {
    let c = fsrs.newCard(T0);
    a.equal(c.state, LEARNING);
    c = fsrs.review(c, GOOD, T0);
    a.equal(c.state, LEARNING); a.equal(c.due - T0, 10 * 60000, "second learning step");
    c = fsrs.review(c, GOOD, c.due);
    a.equal(c.state, REVIEW);
    c = fsrs.review(c, AGAIN, c.due);
    a.equal(c.state, RELEARNING); a.equal(c.lapses, 1);
    const h = fsrs.review(fsrs.newCard(T0), HARD, T0);
    a.equal(h.due - T0, 5.5 * 60000, "Hard on the first step: halfway between the two");
    const noSteps = createScheduler({ learningSteps: [], relearningSteps: [] });
    a.equal(noSteps.review(noSteps.newCard(T0), GOOD, T0).state, REVIEW);
    a.throws(() => fsrs.review(c, 5, T0));
  });

  test("fsrs: Python rounding", (a) => {
    a.deepEqual([0.5, 1.5, 2.5, 2.4, 2.6].map(roundHalfEven), [0, 2, 2, 2, 3]);
  });
}
