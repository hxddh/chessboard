/**
 * Small page-level wordings that read a table: 学's 「下一盘：对 X」 takes the
 * opponent's name from the opponents' own tables in every language
 * (learn/service.js nextGameLine — it once looked up a key that no longer
 * existed, so it always said "an opponent near your level"); 设置's piece-set
 * names never show a raw id (pages/settings.js optionLabel); 学's boards
 * know a move's sound from the position before it (lib/sound.js moveSoundAt).
 */
import { usePack } from "../../src/app/text/lang.js";
import { learnText } from "../../src/app/text/learn.js";
import { nextGameLine, opponentFor } from "../../src/app/learn/service.js";
import { oppText } from "../../src/app/opponents/lines.js";
import { optionLabel } from "../../src/app/pages/settings.js";
import { moveSoundAt } from "../../src/app/lib/sound.js";
import { PIECE_SET_IDS } from "../../src/app/core/pieces.js";
import uiEn from "../../src/app/text/pack.en.js";
import uiJa from "../../src/app/text/pack.ja.js";

const START = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";

export default function (test) {
  test("learn: 「下一盘：对 X」 names the opponent, in all three languages", (a) => {
    try {
      for (const [lang, p] of [["zh", null], ["en", uiEn], ["ja", uiJa]]) {
        if (p) usePack(lang, p); else usePack("zh", null);
        const t = learnText();
        for (const r of [400, 900, 1500]) {
          const o = opponentFor(r), name = oppText(o.id, "name");
          a.ok(name, lang + ": " + o.id + " has a name");
          const line = nextGameLine(t, o);
          a.ok(line.includes(name) && line !== t("learn.gameAny"), lang + ": " + line);
        }
        a.equal(nextGameLine(t, { id: "nobody" }), t("learn.gameAny"), lang + ": an opponent without a name gets the generic line");
        a.equal(nextGameLine(t, null), t("learn.gameAny"));
      }
    } finally { usePack("zh", null); }
  });
  test("settings: every option has a label, and a piece set without one is named from its id", (a) => {
    const t = learnText();
    for (const id of PIECE_SET_IDS) a.ok(optionLabel(t, "pieceSet", id) !== id || /^[A-Z]/.test(id), id + " → " + optionLabel(t, "pieceSet", id));
    a.equal(optionLabel(t, "pieceSet", "alpha"), "Alpha");
    a.equal(optionLabel(t, "pieceSet", "pixel-art"), "Pixel art");
    a.equal(optionLabel(t, "pieceSet", "merida"), t("set.merida"));
    a.equal(optionLabel(t, "lang", "ja"), "日本語");
    a.equal(optionLabel(t, "sound", "off"), t("set.off"));
  });
  test("sound: a move's sound from the position before it; a jump is silent", (a) => {
    a.deepEqual(moveSoundAt(START, "g1", "f3"), { name: "move", piece: "n", color: "w" });
    a.deepEqual(moveSoundAt("4k3/8/8/8/8/8/8/R3K3 w Q - 0 1", "e1", "c1"), { name: "castle", piece: "k", color: "w" });
    a.equal(moveSoundAt("4k3/8/8/8/8/8/3q4/4K3 w - - 0 1", "e1", "d2").name, "capture");
    a.equal(moveSoundAt("k7/4P3/8/8/8/8/8/4K3 w - - 0 1", "e7", "e8").name, "promote");
    a.equal(moveSoundAt(START, "g1", "g3"), null);
    a.equal(moveSoundAt("not a fen", "e2", "e4"), null);
  });
}
