import { sansIn } from "../../src/app/lib/notation.js";

export default function (test) {
  test("notation: the moves a sentence is printed with figurines for", (a) => {
    a.deepEqual(sansIn("Qb3 之后，对方可以走 fxe5"), ["Qb3"], "a pawn move keeps its letters");
    a.deepEqual(sansIn("还不是将死 —— 黑方可走 Rf8"), ["Rf8"]);
    a.deepEqual(sansIn("1. Nf3 Nc6 2. Bb5 a6 3. Bxc6+ dxc6 4. O-O"), ["Nf3", "Nc6", "Bb5", "Bxc6+"], "castling stays letters");
    a.deepEqual(sansIn("先 Rh8+！黑王到 h8，Nxf7+ 就叉"), ["Rh8+", "Nxf7+"], "next to CJK punctuation");
    a.deepEqual(sansIn("Qxg7#, Nbd7 R1e2 Qh4xe1"), ["Qxg7#", "Nbd7", "R1e2", "Qh4xe1"], "mate, disambiguation");
    a.deepEqual(sansIn("exd8=Q+ and b1=N"), ["exd8=Q+", "b1=N"], "a promotion's piece");
    a.deepEqual(sansIn("Be4ever K2 Na Ke9 BQe4 aNf3 Nf3x"), [], "words, not moves");
    a.deepEqual(sansIn("…Kh7"), ["Kh7"]);
  });
}
