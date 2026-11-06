/**
 * Page dictionaries (ADR 0002 文案): each page has its own, one module per
 * language (src/app/text/<page>.<lang>.js), keys semantic. Components get a
 * `t` and never see a language.
 *
 *   const t = createText(dict)
 *   t("bar.yourTurn")             → "轮到你"
 *   t("rv.card", 14, "Qa3")       → "第 14 回合，你走了 Qa3"   ({0} {1} … placeholders)
 * @module lib/text
 */
export function createText(dict, fallback = {}) {
  const t = (key, ...args) => {
    let s = dict[key];
    if (s == null) s = fallback[key];
    if (s == null) return key;
    return args.length ? s.replace(/\{(\d)\}/g, (_, i) => (args[i] == null ? "" : String(args[i]))) : s;
  };
  t.has = (key) => key in dict || key in fallback;
  return t;
}
