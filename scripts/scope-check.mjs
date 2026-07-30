/**
 * Free-variable check: every identifier that is *read* but bound in no
 * enclosing scope and is not a known global.
 *
 * This exists because of a real one. 1.12 moved the board's colours onto CSS
 * variables and turned `const CHECK = "rgba(220,60,40,.55)"` into a `PAINT`
 * entry — but left the use site reading the bare `CHECK`. Nothing caught it:
 * the assertions in test-chess.mjs are static, and the two stress sweeps never
 * once produced a check, so `draw()` never took that branch. It shipped in
 * 1.12.0 and 1.13.0, and on every check it threw *before* the piece loop, so
 * the board rendered its 64 squares and no pieces at all.
 *
 * A linter would have found it in a second. So: here is the linter, the one
 * rule that matters, with no network and no install — acorn is vendored under
 * third_party/ next to chess.js and Stockfish.
 *
 * Usage: node scripts/scope-check.mjs   (also called from test-chess.mjs)
 */
import * as acorn from "../third_party/acorn/acorn.mjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const JS_DIR = path.join(HERE, "..", "src", "web", "js");

/** Anything the browser hands us, plus the globals our own modules attach. */
const GLOBALS = new Set(`
window globalThis document navigator localStorage sessionStorage console
Math JSON Object Array String Number Boolean Date RegExp Error TypeError
RangeError SyntaxError Map Set WeakMap WeakSet Promise Symbol Proxy Reflect
Intl BigInt Function arguments
setTimeout clearTimeout setInterval clearInterval requestAnimationFrame
cancelAnimationFrame queueMicrotask structuredClone fetch
Blob URL File FileReader FormData Headers Request Response
Image Audio AudioContext webkitAudioContext Worker MessageChannel
BroadcastChannel performance crypto btoa atob
encodeURIComponent decodeURIComponent encodeURI decodeURI
parseInt parseFloat isNaN isFinite NaN Infinity undefined
Uint8Array Uint8ClampedArray Int8Array Uint16Array Int16Array Uint32Array
Int32Array Float32Array Float64Array ArrayBuffer DataView
TextEncoder TextDecoder CustomEvent Event KeyboardEvent MouseEvent
PointerEvent DragEvent ClipboardEvent matchMedia getComputedStyle
alert confirm prompt module exports require process
ResizeObserver MutationObserver IntersectionObserver AbortController
ChessBoardView ChessEngine ChessHost ChessAudio ChessPgn ChessEditor
ChessFide ChessI18n ChessReview ChessSrs ChessOpeningCoach ChessMaterial
ChessDrills
ChessDialog ChessPersona ChessAchievements ChessApp Chess
CHESS_LESSONS CHESS_LESSONS_EN CHESS_PUZZLES CHESS_PUZZLES_EN
CHESS_OPENINGS CHESS_OPENINGS_EN CHESS_PIECE_SVGS CHESS_ACHIEVEMENTS
STOCKFISH_SRC
`.trim().split(/\s+/));

const SKIP = new Set(["engine-src.js"]);

/** Add every name a binding pattern introduces to `scope`. */
function declarePattern(node, scope) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": scope.add(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties)
        declarePattern(p.type === "RestElement" ? p.argument : p.value, scope);
      break;
    case "ArrayPattern": for (const e of node.elements) declarePattern(e, scope); break;
    case "AssignmentPattern": declarePattern(node.left, scope); break;
    case "RestElement": declarePattern(node.argument, scope); break;
    default: break;
  }
}

/** var/function/class hoisting plus block-scoped declarations at this level. */
function hoist(body, scope) {
  const visit = (n) => {
    if (!n || typeof n.type !== "string") return;
    switch (n.type) {
      case "VariableDeclaration":
        for (const d of n.declarations) declarePattern(d.id, scope);
        break;
      case "FunctionDeclaration": if (n.id) scope.add(n.id.name); return;
      case "ClassDeclaration": if (n.id) scope.add(n.id.name); return;
      case "FunctionExpression": case "ArrowFunctionExpression": return;
      default: break;
    }
    for (const k of Object.keys(n)) {
      if (k === "type" || k === "loc" || k === "start" || k === "end") continue;
      const v = n[k];
      if (Array.isArray(v)) v.forEach(visit);
      else if (v && typeof v.type === "string") visit(v);
    }
  };
  (Array.isArray(body) ? body : [body]).forEach(visit);
}

/** @returns {Array<{name: string, line: number}>} reads bound nowhere */
export function freeVariables(src) {
  const ast = acorn.parse(src, { ecmaVersion: 2022, locations: true, allowReturnOutsideFunction: true });
  const free = [];
  const walk = (node, scopes) => {
    if (!node || typeof node.type !== "string") return;
    const t = node.type;
    if (t === "FunctionDeclaration" || t === "FunctionExpression" || t === "ArrowFunctionExpression") {
      const s = new Set();
      if (node.id && t === "FunctionExpression") s.add(node.id.name);
      for (const p of node.params) declarePattern(p, s);
      if (node.body.type === "BlockStatement") hoist(node.body.body, s);
      const inner = scopes.concat([s]);
      if (node.body.type === "BlockStatement") node.body.body.forEach((c) => walk(c, inner));
      else walk(node.body, inner);
      return;
    }
    if (t === "BlockStatement" || t === "Program") {
      const s = new Set();
      hoist(node.body, s);
      const inner = scopes.concat([s]);
      node.body.forEach((c) => walk(c, inner));
      return;
    }
    if (t === "ForStatement" || t === "ForInStatement" || t === "ForOfStatement") {
      const s = new Set();
      for (const k of ["init", "left"]) {
        const d = node[k];
        if (d && d.type === "VariableDeclaration") for (const x of d.declarations) declarePattern(x.id, s);
      }
      const inner = scopes.concat([s]);
      for (const k of ["init", "test", "update", "left", "right", "body"]) if (node[k]) walk(node[k], inner);
      return;
    }
    if (t === "CatchClause") {
      const s = new Set();
      if (node.param) declarePattern(node.param, s);
      walk(node.body, scopes.concat([s]));
      return;
    }
    // `a.b` reads `a`, not `b`; `{ b: v }` reads `v`, not `b`
    if (t === "MemberExpression") {
      walk(node.object, scopes);
      if (node.computed) walk(node.property, scopes);
      return;
    }
    if (t === "Property") {
      if (node.computed) walk(node.key, scopes);
      walk(node.value, scopes);
      return;
    }
    if (t === "Identifier") {
      if (!scopes.some((s) => s.has(node.name)) && !GLOBALS.has(node.name))
        free.push({ name: node.name, line: node.loc.start.line });
      return;
    }
    if (t === "LabeledStatement" || t === "BreakStatement" || t === "ContinueStatement") return;
    for (const k of Object.keys(node)) {
      if (k === "type" || k === "loc" || k === "start" || k === "end") continue;
      const v = node[k];
      if (Array.isArray(v)) v.forEach((c) => walk(c, scopes));
      else if (v && typeof v.type === "string") walk(v, scopes);
    }
  };
  walk(ast, []);
  return free;
}

/** @returns {Array<string>} human-readable findings, empty when clean */
export function scanAll() {
  const out = [];
  for (const f of fs.readdirSync(JS_DIR).filter((x) => x.endsWith(".js") && !SKIP.has(x))) {
    const src = fs.readFileSync(path.join(JS_DIR, f), "utf8");
    let free;
    try { free = freeVariables(src); }
    catch (e) { out.push(`${f}: 解析失败 ${e.message}`); continue; }
    const seen = new Map();
    for (const r of free) {
      if (!seen.has(r.name)) seen.set(r.name, []);
      seen.get(r.name).push(r.line);
    }
    for (const [name, lines] of seen)
      out.push(`${f}:${lines[0]} 读取了未绑定的 ${name}（共 ${lines.length} 处：${lines.join(", ")}）`);
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const bad = scanAll();
  if (bad.length) { for (const b of bad) console.error("✗ " + b); process.exit(1); }
  console.log("✓ 作用域检查通过：没有读取未绑定的标识符");
}
