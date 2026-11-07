/**
 * Full-width punctuation in src/app's Chinese and Japanese copy (19.0's
 * cjk-punct, ported: scripts/app/cjk-punct.mjs). The rule itself, then the
 * whole of src/app against it.
 */
import { fixLiteral, transform, scan } from "./cjk-punct.mjs";

export default function (test) {
  test("cjk-punct: ASCII punctuation in a CJK literal becomes full-width; move marks, times and English stay", (a) => {
    a.equal(fixLiteral("从白方看:横排(1–8),竖排;好"), "从白方看：横排（1–8），竖排；好");
    a.equal(fixLiteral("真的吗?好!"), "真的吗？好！");
    a.equal(fixLiteral("Nf3 ?! 之后 5:00"), "Nf3 ?! 之后 5:00", "a move mark after a space, a time");
    a.equal(fixLiteral("Hello, world: (yes)"), "Hello, world: (yes)", "no CJK, nothing to do");
    a.equal(fixLiteral("チェック:王手"), "チェック：王手", "Japanese too");
  });
  test("cjk-punct: only literals are read — comments, regexes and template code are not", (a) => {
    const src = [
      "// 注释:不管",
      "const re = /[,:]/g;",
      "const a = \"中文:有\";",
      "const b = `第${n}局:好`;",
      "const c = 'plain, english';",
    ].join("\n");
    const { src: out, hits } = transform(src);
    a.equal(hits.length, 2, "two literals to fix");
    a.deepEqual(hits.map((h) => h.line), [3, 4]);
    a.ok(out.includes("// 注释:不管") && out.includes("/[,:]/g") && out.includes("\"中文：有\"") && out.includes("`第${n}局：好`") && out.includes("'plain, english'"));
  });
  test("cjk-punct: every Chinese and Japanese string in src/app uses full-width punctuation", (a) => {
    const hits = scan();
    a.ok(hits.length === 0, hits.length + " to fix (node scripts/app/cjk-punct.mjs --fix):\n  " +
      hits.slice(0, 20).map((h) => h.file + ":" + h.line + " 「" + h.from.slice(0, 40) + "」").join("\n  "));
  });
}
