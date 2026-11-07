/**
 * Page dictionaries (ADR 0002 文案): each page has its own, one module per
 * language (src/app/text/<page>.<lang>.js), keys semantic. Components get a
 * `t` and never see a language.
 *
 *   const t = createText(dict, fallback, { lang })
 *   t("bar.yourTurn")             → "轮到你"
 *   t("rv.card", 14, "Qa3")       → "第 14 回合，你走了 Qa3"   ({0} {1} … placeholders)
 *   t("me.importDone", 1)         → "1 game imported"         ({0:game|games}: the word for {0}'s count, English)
 *
 * In Chinese and Japanese an argument's edges decide the space beside its
 * placeholder (v20-0-plan §11 L10; W3C clreq / jlreq): none between CJK and
 * CJK — 「对艾瑞丝」, not 「对 艾瑞丝」 — and one between CJK and Latin
 * letters or digits — 「对 Hansen」, 「Hansen 在想…」. English is left as written.
 * @module lib/text
 */
/** ideographs and kana (not punctuation: 「：Hansen」 keeps no space after the full-width colon) */
const CJK = /[\u3005\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;
const LATIN = /[A-Za-z0-9]/;
const HOLE = /\{(\d)(?::([^|{}]*)\|([^{}]*))?\}/g;

/** One plural word for a count: the first form for exactly one. */
const plural = (n, one, many) => (Number(n) === 1 ? one : many);

/** Fill `s`'s holes; with `cjk`, settle the space beside each argument by what it starts and ends with. */
function fill(s, args, cjk) {
  if (!cjk) return s.replace(HOLE, (_, i, one, many) => (one != null ? plural(args[i], one, many) : args[i] == null ? "" : String(args[i])));
  let out = "", at = 0;
  for (const m of s.matchAll(HOLE)) {
    const [whole, i, one, many] = m;
    let before = s.slice(at, m.index);
    const arg = one != null ? plural(args[i], one, many) : args[i] == null ? "" : String(args[i]);
    // the text right after this hole, up to the next one
    const nextAt = m.index + whole.length;
    if (arg && one == null) {
      const first = arg[0], prev = (out + before).slice(-1), prev2 = (out + before).slice(-2, -1);
      if (prev === " " && CJK.test(prev2) && CJK.test(first)) before = before.slice(0, -1);
      else if (CJK.test(prev) && LATIN.test(first)) before += " ";
    }
    out += before + arg;
    at = nextAt;
    if (arg && one == null) {
      const last = arg[arg.length - 1], after = s.slice(at);
      if (after[0] === " " && CJK.test(after[1] || "") && CJK.test(last)) at++;
      else if (CJK.test(after[0] || "") && LATIN.test(last) && !after.startsWith("{")) out += " ";
    }
  }
  return out + s.slice(at);
}

export function createText(dict, fallback = {}, { lang = "" } = {}) {
  const cjk = lang === "zh" || lang === "ja";
  const t = (key, ...args) => {
    let s = dict[key];
    if (s == null) s = fallback[key];
    if (s == null) return key;
    return args.length ? fill(s, args, cjk) : s;
  };
  t.has = (key) => key in dict || key in fallback;
  return t;
}
