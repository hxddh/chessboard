/**
 * v8-2-plan F4: find interface text that is built by gluing translated pieces
 * together instead of being one sentence with placeholders.
 *
 * `t("learn.lessonPre") + n + t("learn.lessonPost")` reads fine in Chinese,
 * English and Japanese only because all three happen to put the number in
 * the same place; a fourth language that does not gets a sentence it cannot
 * translate. v8-0-plan §6 counted 25 such places and left them for later;
 * F4 turned every one into a whole-sentence key read with `tf(key, [vals])`,
 * and a label next to a label into `tdot(a, b)` (src/web/js/tdot.js), so even
 * the separator belongs to the language. This is the guard that keeps them
 * gone (test-chess.mjs runs it over every hand-written module).
 *
 * What it reports, per module, after a small lexer has set strings, template
 * text, comments and regex literals aside (so a "+" inside a message or a
 * comment cannot trip it, and CRLF sources read the same as LF):
 *   · `+` or `+=` immediately before an i18n call, or `+` right after one —
 *     "translated text concatenated";
 *   · an i18n call inside a template literal's `${…}` — the same thing
 *     spelled with backticks;
 *   · an array literal with an i18n call among its elements that is
 *     `.join(…)`ed (directly or after `.filter(…)` and the like), and an
 *     array that is `.push(…)`ed an i18n call and joined later in the block
 *     that declares it — "translated fragments joined".
 * An i18n call is `t(`, `tf(`, `tdot(`, `I18n.t(` / `ChessI18n.tf(`, and the
 * wrappers that only ever return a translation (CALLEES below).
 *
 * It is a text check, so it errs towards reporting: a `+` next to t() that is
 * arithmetic would be flagged too — there is none, and there should not be.
 */

/** names whose call returns translated interface text */
export const CALLEES = new Set(["t", "tf", "tdot", "sideName", "otherSideName", "diffName", "themeName"]);
const I18N_OBJECTS = new Set(["I18n", "ChessI18n"]);
const REGEX_AFTER_WORD = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "instanceof", "yield", "await"]);

/**
 * Tokens of `src`: { k: "id" | "str" | "num" | "p" (punctuator) | "tpl" (a
 * template's literal text), v, at, tpl (true for tokens inside a `${…}`) }.
 * Strings keep only their kind; comments and whitespace are dropped.
 */
export function lex(src) {
  src = src.replace(/\r\n/g, "\n");
  const out = [];
  // the `${` depth of each open template substitution, innermost last
  const subs = [];
  let depth = 0;
  let i = 0;
  const n = src.length;
  const prev = () => out[out.length - 1];
  const regexAllowed = () => {
    const p = prev();
    if (!p) return true;
    if (p.k === "id") return REGEX_AFTER_WORD.has(p.v);
    if (p.k === "p") return !/^[)\]}]$/.test(p.v) && p.v !== "++" && p.v !== "--";
    return false;
  };
  // read template text from i (just after ` or a closing }) to the next `${` or `
  const template = () => {
    const start = i;
    while (i < n && src[i] !== "`") {
      if (src[i] === "\\") { i += 2; continue; }
      if (src[i] === "$" && src[i + 1] === "{") {
        out.push({ k: "tpl", v: src.slice(start, i), at: start, tpl: subs.length > 0 });
        i += 2;
        subs.push(depth);
        out.push({ k: "p", v: "${", at: i - 2, tpl: true });
        return;
      }
      i++;
    }
    out.push({ k: "tpl", v: src.slice(start, i), at: start, tpl: subs.length > 0, end: true });
    i++;
  };
  while (i < n) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { const e = src.indexOf("\n", i); i = e < 0 ? n : e; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? n : e + 2; continue; }
    if (c === '"' || c === "'") {
      const start = i;
      for (i++; i < n && src[i] !== c && src[i] !== "\n"; i++) if (src[i] === "\\") i++;
      i++;
      out.push({ k: "str", v: src.slice(start, i), at: start, tpl: subs.length > 0 });
      continue;
    }
    if (c === "`") { i++; out.push({ k: "p", v: "`", at: i - 1, tpl: subs.length > 0 }); template(); continue; }
    if (c === "/" && regexAllowed()) {
      const start = i;
      i++;
      for (let cls = false; i < n && src[i] !== "\n"; i++) {
        if (src[i] === "\\") i++;
        else if (src[i] === "[") cls = true;
        else if (src[i] === "]") cls = false;
        else if (src[i] === "/" && !cls) break;
      }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      out.push({ k: "re", v: src.slice(start, i), at: start, tpl: subs.length > 0 });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      const m = /^[\w$]+/.exec(src.slice(i, i + 64));
      out.push({ k: "id", v: m[0], at: i, tpl: subs.length > 0 });
      i += m[0].length;
      continue;
    }
    if (/[0-9]/.test(c)) {
      const m = /^[0-9a-fA-FxXoObB_.eE]+/.exec(src.slice(i, i + 64));
      out.push({ k: "num", v: m[0], at: i, tpl: subs.length > 0 });
      i += m[0].length;
      continue;
    }
    if (c === "}" && subs.length && subs[subs.length - 1] === depth) {
      subs.pop();
      out.push({ k: "p", v: "}$", at: i, tpl: true });
      i++;
      template();
      continue;
    }
    const three = src.slice(i, i + 3), two = src.slice(i, i + 2);
    const p = ["...", "===", "!==", "**=", "<<=", ">>="].includes(three) ? three
      : ["++", "--", "+=", "-=", "=>", "==", "!=", "<=", ">=", "&&", "||", "??", "?.", "*=", "/=", "%=", "**"].includes(two) ? two : c;
    if (p === "{" || p === "(" || p === "[") depth++;
    else if (p === "}" || p === ")" || p === "]") depth--;
    out.push({ k: "p", v: p, at: i, tpl: subs.length > 0 });
    i += p.length;
  }
  return out;
}

/** index of the token closing the bracket opened at `open`, or -1 */
function closer(toks, open) {
  let d = 0;
  for (let j = open; j < toks.length; j++) {
    const v = toks[j].k === "p" ? toks[j].v : "";
    if (v === "(" || v === "[" || v === "{" || v === "${") d++;
    else if (v === ")" || v === "]" || v === "}" || v === "}$") { d--; if (d === 0) return j; }
  }
  return -1;
}

/** the [start, end] token span of every i18n call in `toks` */
function i18nCalls(toks) {
  const calls = [];
  for (let k = 0; k < toks.length - 1; k++) {
    const tk = toks[k];
    if (tk.k !== "id" || !CALLEES.has(tk.v) || toks[k + 1].v !== "(") continue;
    const before = toks[k - 1];
    let start = k;
    if (before && before.k === "p" && (before.v === "." || before.v === "?.")) {
      // a method: only the i18n module's own t / tf (`I18n.t(`), never `x.t(`
      const obj = toks[k - 2];
      if (!obj || obj.k !== "id" || !I18N_OBJECTS.has(obj.v) || (tk.v !== "t" && tk.v !== "tf")) continue;
      start = k - 2;
    } else if (before && before.k === "id" && before.v === "function") continue;
    const end = closer(toks, k + 1);
    if (end > 0) calls.push([start, end]);
  }
  return calls;
}

const lineOf = (src, at) => src.slice(0, at).split("\n").length;

/**
 * Every place in `src` (one module's text) where translated text is glued.
 * @returns {Array<{line:number, kind:string, text:string}>}
 */
export function findConcats(src) {
  src = src.replace(/\r\n/g, "\n");
  const toks = lex(src);
  const hits = [];
  const report = (at, kind) => {
    const line = lineOf(src, at);
    hits.push({ line, kind, text: src.split("\n")[line - 1].trim() });
  };
  const calls = i18nCalls(toks);
  for (const [s, e] of calls) {
    const before = toks[s - 1], after = toks[e + 1];
    if (before && before.k === "p" && (before.v === "+" || before.v === "+=")) report(toks[s].at, "+");
    else if (after && after.k === "p" && after.v === "+") report(toks[s].at, "+");
    else if (toks[s].tpl) report(toks[s].at, "${}");
  }
  // [ …t(…)… ].join(  and  xs.push(…t(…)…) … xs.join(  — also through a
  // chain in between: `[t("a"), x].filter(Boolean).join(" · ")`. A join
  // whose separator is itself a translation — `.join(t("rv.dot"))` — is the
  // list formatting tdot() does, not a sentence in pieces, and passes.
  const starts = new Set(calls.map(([s]) => s));
  const ends = new Map(calls);
  const joinsAt = (j) => {
    while (toks[j] && toks[j].v === "." && toks[j + 1] && toks[j + 1].k === "id" && toks[j + 2] && toks[j + 2].v === "(") {
      const e = closer(toks, j + 2);
      if (toks[j + 1].v === "join") return !(starts.has(j + 3) && ends.get(j + 3) === e - 1);
      if (e < 0) return false;
      j = e + 1;
    }
    return false;
  };
  const pushed = [];
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.k === "p" && tk.v === "[") {
      const e = closer(toks, k);
      if (e > 0 && joinsAt(e + 1)) {
        // the array's own elements: `[a, t(x)]`, not `[f(t(x))]`
        for (let j = k + 1, depth = 0; j < e; j++) {
          const v = toks[j].k === "p" ? toks[j].v : "";
          if (depth === 0 && starts.has(j)) { report(toks[j].at, "join"); break; }
          if (v === "(" || v === "[" || v === "{" || v === "${") depth++;
          else if (v === ")" || v === "]" || v === "}" || v === "}$") depth--;
        }
      }
    }
    if (tk.k === "id" && toks[k + 1] && toks[k + 1].v === "." && toks[k + 2] && toks[k + 2].v === "push" && toks[k + 3] && toks[k + 3].v === "(") {
      const e = closer(toks, k + 3);
      if (calls.some(([s]) => s > k + 3 && s < e)) pushed.push([k, tk.v]);
    }
  }
  // the join has to be of the same array: after the push, inside the block
  // that declares it (shell.js pushes lines that a different function joins)
  for (const [k, name] of pushed) {
    let decl = -1;
    for (let j = k - 1; j > 0; j--) {
      if (toks[j].k === "id" && toks[j].v === name && /^(const|let|var)$/.test(toks[j - 1].v)) { decl = j; break; }
    }
    let end = toks.length;
    if (decl >= 0) {
      for (let j = decl, depth = 0; j < toks.length; j++) {
        const v = toks[j].k === "p" ? toks[j].v : "";
        if (v === "(" || v === "[" || v === "{" || v === "${") depth++;
        else if (v === ")" || v === "]" || v === "}" || v === "}$") { if (--depth < 0) { end = j; break; } }
      }
    }
    for (let j = k + 1; j < end; j++) {
      if (toks[j].k === "id" && toks[j].v === name && toks[j - 1].v !== "." && joinsAt(j + 1)) { report(toks[k].at, "join"); break; }
    }
  }
  return hits;
}

/**
 * Where each i18n call in `src` ends (the offset just past its ")"), in the
 * LF-normalised text — for the guard's own check that a `+` put after any
 * one of them is caught.
 */
export function callEnds(src) {
  src = src.replace(/\r\n/g, "\n");
  const toks = lex(src);
  return i18nCalls(toks).map(([, e]) => toks[e].at + 1);
}
