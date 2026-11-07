/**
 * Sentences put one after another: a space between them in English, none after
 * a Chinese or Japanese full stop (「…没有保护住。 更好的是 g5。」 read as a typo).
 * @module lib/sentences
 */
const CJK_END = /[。！？」』）：]$/;

export function joinSentences(...parts) {
  let out = "";
  for (const p of parts.flat()) {
    const s = String(p ?? "").trim();
    if (!s) continue;
    out += out && !CJK_END.test(out) ? " " + s : s;
  }
  return out;
}
