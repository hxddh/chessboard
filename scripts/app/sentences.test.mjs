import { joinSentences } from "../../src/app/lib/sentences.js";

export default function (test) {
  test("sentences: no space after a Chinese or Japanese full stop, one between English sentences", (a) => {
    a.equal(joinSentences("漏看了 Nxa6，象没有保护住。", "更好的是 g5。"), "漏看了 Nxa6，象没有保护住。更好的是 g5。");
    a.equal(joinSentences("第 6 回合，你走了 exf5（错失良机）。", "这里有更好的一步，再想想？"), "第 6 回合，你走了 exf5（错失良机）。这里有更好的一步，再想想？");
    a.equal(joinSentences("Move 6: you played exf5 (a missed chance).", "There is a better move here — try again?"),
      "Move 6: you played exf5 (a missed chance). There is a better move here — try again?");
    a.equal(joinSentences(["", "Bxa6 を見落とした。", null, "g5 のほうが良い。"]), "Bxa6 を見落とした。g5 のほうが良い。", "empty parts are left out");
  });
}
