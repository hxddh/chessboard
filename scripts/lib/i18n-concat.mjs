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
 *   · M3 评审: `+` next to a parenthesised expression with an i18n call in
 *     it — `(a ? tf(x) : tf(y)) + " · "`, `n + " · " + (foe || t(x))`;
 *     `.concat(` on an i18n call or with one among its arguments; and `+`
 *     next to a name the same block declared straight from an i18n call —
 *     `const res = won ? t("w") : t("l")` … `res + " · "`.
 * An i18n call is `t(`, `tf(`, `tdot(`, `I18n.t(` / `ChessI18n.tf(`, the
 * wrappers that only ever return a translation (CALLEES below), and a
 * module's own: a function whose every `return` — or an arrow whose body —
 * starts with an i18n call (M3 评审: app.js historyLabel, visual-modes.js
 * sideW; "starts with", so a wrapper glued onto is still one).
 *   · v8-3-plan F3: that last rule follows the data flow of one scope — a
 *     later `s = t(x)` (to the end of the block declaring s), the second
 *     name of a declaration list, a parenthesised initializer, a copy to
 *     another name (`const u = s`, `c ? s : t(y)`, `s || t(y)`) — and
 *     `${s}` in a template counts like the `+`.
 * What the guard still cannot see: a translation that reaches the `+`
 * through anything else — a function's parameter (`setLabel(t(x))` …
 * `label + n` inside it), an object property or array slot (`o.msg = t(x)`,
 * `{ reason: t(x) }`, `[t(x)][0]`), a name assigned inside a nested
 * expression (`f(s = t(x))`), a destructured one, a value that merely
 * contains one (`f(t(x))`, `[t(x)].join()` handed on), and a name read from
 * another module. It does not track a name being overwritten either: once
 * assigned a translation it counts as one until its block ends, which errs
 * towards reporting (v8-2-plan §9 M3).
 *
 * It is a text check, so it errs towards reporting: a `+` next to t() that is
 * arithmetic would be flagged too — there is none, and there should not be.
 */

/** names whose call returns translated interface text */
// `w`: trainer/visual-modes.js's table of its own sentences (M3 评审)
export const CALLEES = new Set(["t", "tf", "tdot", "sideName", "otherSideName", "diffName", "themeName", "w"]);
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

/** the [start, end] token span of every i18n call in `toks`; `own`: the module's own wrappers */
function i18nCalls(toks, own) {
  const calls = [];
  for (let k = 0; k < toks.length - 1; k++) {
    const tk = toks[k];
    if (tk.k !== "id" || !(CALLEES.has(tk.v) || (own && own.has(tk.v))) || toks[k + 1].v !== "(") continue;
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

/** Is toks[j] the start of an i18n call (in `calls`) that spans exactly to `e` (or to anything, e omitted)? */
const callAt = (calls, j, e) => calls.some(([s, ce]) => s === j && (e == null || ce === e));

/**
 * The module's own wrappers (M3 评审): `function f(…) { … return t(…); }`
 * with every `return` of its own starting with an i18n call, and
 * `const f = (…) => t(…)`.
 * Found again with each one known, until no more turn up (sideW calls w).
 */
function ownCallees(toks) {
  const own = new Set();
  for (let grew = true; grew;) {
    grew = false;
    const calls = i18nCalls(toks, own);
    for (let k = 0; k < toks.length - 3; k++) {
      const tk = toks[k];
      if (tk.k !== "id" || own.has(tk.v) || CALLEES.has(tk.v)) continue;
      let body = -1;
      if (toks[k - 1] && toks[k - 1].v === "function" && toks[k + 1].v === "(") {
        const pe = closer(toks, k + 1);
        if (pe > 0 && toks[pe + 1] && toks[pe + 1].v === "{") body = pe + 1;
      } else if (toks[k - 1] && /^(const|let|var)$/.test(toks[k - 1].v) && toks[k + 1].v === "=") {
        let j = k + 2;
        if (toks[j] && toks[j].v === "(") j = closer(toks, j) + 1;
        else if (toks[j] && toks[j].k === "id") j++;
        if (!(j > k + 2 && toks[j] && toks[j].v === "=>")) continue;
        // an expression body: the call is the whole of it
        if (toks[j + 1] && toks[j + 1].v !== "{") {
          if (callAt(calls, j + 1)) { own.add(tk.v); grew = true; }
          continue;
        }
        body = j + 1;
      }
      if (body < 0) continue;
      const be = closer(toks, body);
      let returns = 0, all = true;
      for (let j = body + 1, depth = 0; j < be; j++) {
        const v = toks[j].k === "p" ? toks[j].v : "";
        if (v === "(" || v === "[" || v === "{" || v === "${") depth++;
        else if (v === ")" || v === "]" || v === "}" || v === "}$") depth--;
        // a nested function's returns are its own
        if (toks[j].v === "function" || v === "=>") { all = false; break; }
        if (toks[j].k === "id" && toks[j].v === "return") {
          returns++;
          if (!callAt(calls, j + 1)) { all = false; break; }
        }
      }
      if (returns && all) { own.add(tk.v); grew = true; }
    }
  }
  return own;
}

/** Does the span (a, b) hold an i18n call at its own top level (not inside another call's brackets)? */
function topCall(toks, calls, a, b) {
  for (let j = a, depth = 0; j < b; j++) {
    const v = toks[j].k === "p" ? toks[j].v : "";
    if (depth === 0 && callAt(calls, j)) return true;
    if (v === "(" || v === "[" || v === "{" || v === "${") depth++;
    else if (v === ")" || v === "]" || v === "}" || v === "}$") depth--;
  }
  return false;
}

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
  const calls = i18nCalls(toks, ownCallees(toks));
  const plus = (tk) => tk && tk.k === "p" && (tk.v === "+" || tk.v === "+=");
  for (const [s, e] of calls) {
    const before = toks[s - 1], after = toks[e + 1];
    if (before && before.k === "p" && (before.v === "+" || before.v === "+=")) report(toks[s].at, "+");
    else if (after && after.k === "p" && after.v === "+") report(toks[s].at, "+");
    else if (toks[s].tpl) report(toks[s].at, "${}");
  }
  // M3 评审: `(… t(…) …) + x` / `x + (… t(…) …)` — a group, not a call's
  // own parentheses — and `.concat(` with an i18n call on either side
  for (let k = 0; k < toks.length; k++) {
    const tk = toks[k];
    if (tk.k === "p" && tk.v === "(") {
      const p = toks[k - 1];
      const grouping = !p || (p.k === "p" && !/^[)\]}]$/.test(p.v) && p.v !== "}$") || (p.k === "id" && REGEX_AFTER_WORD.has(p.v));
      if (!grouping) continue;
      const e = closer(toks, k);
      if (e > 0 && (plus(p) || (toks[e + 1] && toks[e + 1].v === "+")) && topCall(toks, calls, k + 1, e)) report(tk.at, "+");
    }
    if (tk.k === "p" && tk.v === "." && toks[k + 1] && toks[k + 1].v === "concat" && toks[k + 2] && toks[k + 2].v === "(") {
      const e = closer(toks, k + 2);
      if (calls.some(([, ce]) => ce === k - 1) || (e > 0 && topCall(toks, calls, k + 3, e))) report(tk.at, "concat");
    }
  }
  // M3 评审: a name the block declared straight from an i18n call, glued:
  // `const res = won ? t("w") : t("l")` … `res + " · "`. The initializer's
  // own top level has the call (`f(t(x))` is f's business); the name is
  // followed until its block closes.
  // v8-3-plan F3 widens it to the data flow inside one scope: the name may be
  // the second of a declaration list (`let n = 0, s = t(x)`), the call may sit
  // in parentheses (`const s = (a ? t(x) : t(y))`), the value may come later
  // (`let s; … s = t(x)`, followed to the end of the block that declares s),
  // or from another such name (`const u = s`, `c ? s : t(y)`, `s || t(y)`);
  // and a `${s}` in a template is the same as a `+`
  const opens = (v) => v === "(" || v === "[" || v === "{" || v === "${";
  const shuts = (v) => v === ")" || v === "]" || v === "}" || v === "}$";
  const pv = (j) => (toks[j] && toks[j].k === "p" ? toks[j].v : "");
  const member = (j) => pv(j) === "." || pv(j) === "?.";
  // the end of the block around token j: the first bracket that closes it
  const blockEnd = (j) => {
    for (let depth = 0; j < toks.length; j++) {
      if (opens(pv(j))) depth++;
      else if (shuts(pv(j)) && --depth < 0) return j;
    }
    return toks.length;
  };
  // is toks[k] a name being declared (first or later in `const a = …, b = …`)?
  const declared = (k) => {
    if (/^(const|let|var)$/.test(toks[k - 1].v)) return true;
    if (pv(k - 1) !== ",") return false;
    for (let j = k - 2, depth = 0; j >= 0; j--) {
      const v = pv(j);
      if (shuts(v)) depth++;
      else if (opens(v)) { if (--depth < 0) return false; }
      else if (depth === 0 && v === ";") return false;
      else if (depth === 0 && toks[j].k === "id" && /^(const|let|var)$/.test(toks[j].v)) return true;
    }
    return false;
  };
  // the name itself as a value: not `o.name`, `name.length`, `name(…)`, `name[i]`
  const isUse = (j, name) => toks[j].k === "id" && toks[j].v === name && !member(j - 1) && !member(j + 1) &&
    pv(j + 1) !== "(" && pv(j + 1) !== "[";
  const tracked = new Map();   // name → [[from, to], …]: where it holds a translation
  const holds = (name, j) => (tracked.get(name) || []).some(([a, b]) => j >= a && j < b);
  // the initializer gives a translation: an i18n call at its top level, or a
  // tracked name as a value there (the whole of it, a branch of `?:`, a side
  // of `||` / `??` — not `s ? 1 : 2`, not `s.length`)
  const gives = (a, b) => {
    if (pv(a) === "(" && pv(closer(toks, a) + 1) === "=>") return false;   // an arrow function
    if (pv(a) === "(" && closer(toks, a) === b - 1) return gives(a + 1, b - 1);
    if (topCall(toks, calls, a, b)) return true;
    for (let j = a, depth = 0; j < b; j++) {
      const v = pv(j);
      if (depth === 0 && toks[j].k === "id" && holds(toks[j].v, j) && isUse(j, toks[j].v) &&
        (j === a || /^(\?|:|\|\||\?\?)$/.test(pv(j - 1))) && (j === b - 1 || /^(:|\|\||\?\?)$/.test(pv(j + 1)))) return true;
      if (opens(v)) depth++;
      else if (shuts(v)) depth--;
    }
    return false;
  };
  // where a statement may start: a later `s = …` is an assignment there, not
  // `f(s = …)` or `a == s`
  const stmt = (j) => /^[;{}]$/.test(pv(j)) || pv(j) === ")" || (toks[j] && toks[j].k === "id" && toks[j].v === "else");
  for (let grew = true; grew;) {
    grew = false;
    for (let k = 1; k < toks.length - 2; k++) {
      if (toks[k].k !== "id" || toks[k + 1].v !== "=" || member(k - 1)) continue;
      const decl = declared(k);
      if (!decl && !stmt(k - 1)) continue;
      let ie = k + 2;
      for (let depth = 0; ie < toks.length; ie++) {
        const v = pv(ie);
        if (depth === 0 && (v === ";" || v === "," || v === ")" || v === "}" || v === "]")) break;
        if (opens(v)) depth++;
        else if (shuts(v)) depth--;
      }
      const name = toks[k].v;
      if ((tracked.get(name) || []).some(([a]) => a === ie) || !gives(k + 2, ie)) continue;
      // a later assignment holds until the block that declares the name ends
      let end = blockEnd(ie);
      if (!decl) {
        for (let j = k - 1; j > 0; j--) if (toks[j].k === "id" && toks[j].v === name && declared(j)) { end = blockEnd(j + 1); break; }
      }
      tracked.set(name, (tracked.get(name) || []).concat([[ie, end]]));
      grew = true;
    }
  }
  const seen = new Set();
  for (const [name, spans] of tracked) {
    for (const [a, b] of spans) {
      for (let j = a; j < b; j++) {
        if (seen.has(j) || !isUse(j, name)) continue;
        if (plus(toks[j - 1]) || plus(toks[j + 1])) { seen.add(j); report(toks[j].at, "+"); }
        else if (pv(j - 1) === "${" && pv(j + 1) === "}$") { seen.add(j); report(toks[j].at, "${}"); }
      }
    }
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
  return i18nCalls(toks, ownCallees(toks)).map(([, e]) => toks[e].at + 1);
}
