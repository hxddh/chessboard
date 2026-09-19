/**
 * PGN import/export — tokenizer, parser and serializer, no DOM.
 *
 * chess.js's `load_pgn` was the importer until now, and it drops everything a
 * study contains: variations, NAGs, `;` comments, and it fails outright on
 * shapes that real files have (`0-0` with zeros, a `;` comment containing
 * `?`, headers with no blank line before the moves — see docs/v6-plan.md
 * §1.2). chess.js stays the only judge of legality; this module owns the text.
 *
 * Text goes through one tokenizer with byte offsets, so an error can name
 * the line and column, and `splitGames` uses the same tokens instead of a
 * regex on `[Event` — a file whose games lack that tag still splits.
 *
 * Node shape (shared with game-tree.js):
 *   { san, from, to, promotion, fen, comment, nags, shapes, children }
 * `shapes` holds lichess `[%cal]` arrows and `[%csl]` circles parsed out of
 * the comment; `[%clk]` / `[%eval]` stay in the comment text verbatim.
 * @module pgn-parser
 */
import { Chess } from "./chess.js";

const START_FEN = "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1";
const RESULTS = new Set(["1-0", "0-1", "1/2-1/2", "*"]);
/** Seven Tag Roster, in the order the standard says it is written. */
const STR = ["Event", "Site", "Date", "Round", "White", "Black", "Result"];
/** move suffix annotations → NAG number (PGN standard §10) */
const SUFFIX_NAG = { "!": 1, "?": 2, "!!": 3, "??": 4, "!?": 5, "?!": 6 };

// ---------------------------------------------------------------------------
// tokenizer

/** Line/column of an offset, 1-based — computed only on the error path. */
function lineCol(text, offset) {
  let line = 1;
  let last = -1;
  for (let i = 0; i < offset; i++) {
    if (text.charCodeAt(i) === 10) { line++; last = i; }
  }
  return { line, column: offset - last };
}

function fail(text, offset, token, what) {
  const { line, column } = lineCol(text, offset);
  const err = new Error(
    "PGN parse error at line " + line + ", column " + column + ": " + what +
    (token ? " (token: " + JSON.stringify(token) + ")" : ""));
  err.line = line;
  err.column = column;
  err.token = token;
  throw err;
}

/**
 * Strip BOM and CRLF, then cut the text into tokens.
 *
 * Token kinds: tag, comment, open, close, nag, result, san, suffix. Move
 * numbers and loose dots are consumed here and never reach the parser — the
 * board decides whose turn it is, not the file, and files disagree with
 * themselves often enough (`1. ...`, missing numbers, `1 e4`) that trusting
 * them costs more than ignoring them.
 * @param {string} text
 * @returns {{text: string, tokens: object[]}}
 */
function tokenize(input) {
  const text = String(input || "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const tokens = [];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i];
    if (c === " " || c === "\t" || c === "\n") { i++; continue; }
    const start = i;
    // "%" in column 1 is an escape line for other programs (§6); skip it
    if (c === "%" && (i === 0 || text[i - 1] === "\n")) {
      while (i < n && text[i] !== "\n") i++;
      continue;
    }
    if (c === ";") {
      let j = i + 1;
      while (j < n && text[j] !== "\n") j++;
      tokens.push({ type: "comment", text: text.slice(i + 1, j), pos: start });
      i = j;
      continue;
    }
    if (c === "{") {
      const j = text.indexOf("}", i + 1);
      if (j < 0) fail(text, start, "{", "unterminated comment");
      tokens.push({ type: "comment", text: text.slice(i + 1, j), pos: start });
      i = j + 1;
      continue;
    }
    if (c === "[") {
      const m = /^\[\s*([A-Za-z0-9_]+)\s*"((?:[^"\\]|\\.)*)"\s*\]/.exec(text.slice(i, i + 4096));
      if (!m) fail(text, start, "[", "malformed tag pair");
      tokens.push({ type: "tag", name: m[1], value: m[2].replace(/\\(["\\])/g, "$1"), pos: start });
      i += m[0].length;
      continue;
    }
    if (c === "(") { tokens.push({ type: "open", pos: start }); i++; continue; }
    if (c === ")") { tokens.push({ type: "close", pos: start }); i++; continue; }
    if (c === "$") {
      const m = /^\$(\d+)/.exec(text.slice(i, i + 8));
      if (!m) fail(text, start, "$", "malformed NAG");
      tokens.push({ type: "nag", n: Number(m[1]), pos: start });
      i += m[0].length;
      continue;
    }
    const rest = text.slice(i, i + 64);
    let m;
    // results before move numbers: "1-0" also starts with a digit
    if ((m = /^(1-0|0-1|1\/2-1\/2|\*)(?![\w/-])/.exec(rest))) {
      tokens.push({ type: "result", text: m[1], pos: start });
      i += m[0].length;
      continue;
    }
    // castling with digit zeros — before move numbers, or "0" would eat it
    if ((m = /^(0-0-0|0-0)(?![\w/-])/.exec(rest))) {
      tokens.push({ type: "san", text: m[1] === "0-0" ? "O-O" : "O-O-O", pos: start });
      i += m[0].length;
      continue;
    }
    if ((m = /^\d+\.*/.exec(rest))) { i += m[0].length; continue; }
    if ((m = /^\.+/.exec(rest))) { i += m[0].length; continue; }
    if ((m = /^[!?]{1,2}/.exec(rest))) {
      // a suffix separated from its move by a space still belongs to it
      tokens.push({ type: "suffix", text: m[0], pos: start });
      i += m[0].length;
      continue;
    }
    if ((m = /^([A-Za-z][A-Za-z0-9=+#:-]*)([!?]{0,2})/.exec(rest))) {
      tokens.push({ type: "san", text: m[1], pos: start });
      if (m[2]) tokens.push({ type: "suffix", text: m[2], pos: start + m[1].length });
      i += m[0].length;
      continue;
    }
    fail(text, start, c, "unexpected character");
  }
  return { text, tokens };
}

// ---------------------------------------------------------------------------
// comments and shapes

/**
 * Pull `[%cal ...]` / `[%csl ...]` out of a comment. Everything else —
 * including `[%clk]` and `[%eval]` — stays as text, so an unknown command
 * survives a round trip untouched.
 */
function parseComment(raw, shapes) {
  const text = String(raw)
    .replace(/\[%cal\s+([^\]]*)\]/g, (_, list) => {
      for (const s of list.split(",")) {
        const m = /^\s*([A-Za-z])([a-h][1-8])([a-h][1-8])\s*$/.exec(s);
        if (m) shapes.arrows.push({ from: m[2], to: m[3], color: m[1].toUpperCase() });
      }
      return " ";
    })
    .replace(/\[%csl\s+([^\]]*)\]/g, (_, list) => {
      for (const s of list.split(",")) {
        const m = /^\s*([A-Za-z])([a-h][1-8])\s*$/.exec(s);
        if (m) shapes.circles.push({ sq: m[2], color: m[1].toUpperCase() });
      }
      return " ";
    });
  // newlines inside a comment are formatting, not content: the serializer
  // re-wraps at 80 columns, so only collapsed whitespace round-trips
  return text.replace(/\s+/g, " ").trim();
}

function emptyShapes() {
  return { arrows: [], circles: [] };
}

function hasShapes(shapes) {
  return !!shapes && ((shapes.arrows && shapes.arrows.length) || (shapes.circles && shapes.circles.length));
}

/** Comment body for export: shapes first, then the text; null when nothing. */
function formatComment(node) {
  const parts = [];
  if (hasShapes(node.shapes)) {
    if (node.shapes.circles && node.shapes.circles.length) {
      parts.push("[%csl " + node.shapes.circles.map((c) => c.color + c.sq).join(",") + "]");
    }
    if (node.shapes.arrows && node.shapes.arrows.length) {
      parts.push("[%cal " + node.shapes.arrows.map((a) => a.color + a.from + a.to).join(",") + "]");
    }
  }
  if (node.comment) parts.push(String(node.comment).replace(/\}/g, "]"));
  return parts.length ? parts.join(" ") : null;
}

// ---------------------------------------------------------------------------
// parser

function makeNode(fen) {
  return { san: null, from: null, to: null, promotion: null, fen, comment: null, nags: [], shapes: emptyShapes(), children: [] };
}

function appendComment(node, text) {
  if (!text) return;
  node.comment = node.comment ? node.comment + " " + text : text;
}

/** Start position of a game from its tags, validated. */
function startFenOf(headers, text, pos) {
  let fen = null;
  for (const [k, v] of headers) if (k === "FEN") fen = v.trim();
  if (!fen) return START_FEN;
  const chess = new Chess();
  if (!chess.load(fen)) fail(text, pos, fen, "invalid FEN tag: " + (chess.validate_fen(fen).error || "cannot load"));
  return chess.fen();
}

/**
 * Parse one game from `tokens[i]` onward. Returns the game and the index of
 * the first token that belongs to the next one.
 *
 * Variations do not nest by recursion here but by a stack of the node each
 * `(` left off at: a `(` rewinds the cursor to the parent of the move just
 * written (the variation is an *alternative* to it), `)` restores it.
 */
function parseGameAt(text, tokens, i, chess) {
  const headers = [];
  while (i < tokens.length && tokens[i].type === "tag") {
    headers.push([tokens[i].name, tokens[i].value]);
    i++;
  }
  const startFen = startFenOf(headers, text, i < tokens.length ? tokens[i].pos : 0);
  const root = makeNode(startFen);
  const parents = new Map();
  const stack = [];
  let cur = root;
  let result = null;
  let done = false;
  // a comment between "(" and the variation's first move belongs to that
  // move, which does not exist yet
  let pending = null;

  while (i < tokens.length && !done) {
    const t = tokens[i];
    switch (t.type) {
      case "tag":
        // a tag after movetext opens the next game
        done = true;
        continue;
      case "comment":
        if (i > 0 && tokens[i - 1].type === "open") pending = (pending ? pending + " " : "") + t.text;
        else appendComment(cur, parseComment(t.text, cur.shapes));
        break;
      case "nag":
        cur.nags.push(t.n);
        break;
      case "suffix":
        if (cur === root) fail(text, t.pos, t.text, "annotation before any move");
        cur.nags.push(SUFFIX_NAG[t.text]);
        break;
      case "open": {
        if (cur === root || !parents.has(cur)) fail(text, t.pos, "(", "variation before any move");
        stack.push(cur);
        cur = parents.get(cur);
        break;
      }
      case "close":
        if (!stack.length) fail(text, t.pos, ")", "unmatched ')'");
        cur = stack.pop();
        break;
      case "result":
        if (stack.length) break; // a result inside a variation is noise
        result = t.text;
        done = true;
        break;
      case "san": {
        if (!chess.load(cur.fen)) fail(text, t.pos, t.text, "cannot load position");
        const mv = chess.move(t.text, { sloppy: true });
        if (!mv) fail(text, t.pos, t.text, "illegal move " + JSON.stringify(t.text));
        // an identical move already branching here is the same node, so a
        // file that repeats the mainline move inside a RAV does not fork it
        let node = cur.children.find((c) => c.san === mv.san);
        if (!node) {
          node = makeNode(chess.fen());
          node.san = mv.san;
          node.from = mv.from;
          node.to = mv.to;
          node.promotion = mv.promotion || null;
          cur.children.push(node);
          parents.set(node, cur);
        }
        if (pending !== null) { appendComment(node, parseComment(pending, node.shapes)); pending = null; }
        cur = node;
        break;
      }
      default:
        fail(text, t.pos, "", "unexpected token");
    }
    i++;
  }
  if (stack.length) fail(text, tokens[Math.min(i, tokens.length - 1)].pos, ")", "unterminated variation");
  if (result === null) {
    const h = headers.find(([k]) => k === "Result");
    result = h && RESULTS.has(h[1]) ? h[1] : "*";
  }
  return { game: { headers, root, result }, next: i };
}

/**
 * Parse a PGN file into games. Throws on the first illegal move or
 * malformed token, naming line and column.
 * @param {string} text
 * @returns {{games: Array<{headers: Array<[string,string]>, root: object, result: string}>}}
 */
function parsePgn(input) {
  const { text, tokens } = tokenize(input);
  const games = [];
  const chess = new Chess();
  let i = 0;
  while (i < tokens.length) {
    const { game, next } = parseGameAt(text, tokens, i, chess);
    if (next === i) fail(text, tokens[i].pos, "", "no progress");
    games.push(game);
    i = next;
  }
  return { games };
}

/**
 * Cut a file into per-game text chunks, in file order.
 *
 * Boundaries come from the token stream: a tag after movetext, or a move
 * after a result. So a file whose games have no `[Event` tag still splits,
 * and a `[` inside a comment does not. Bad movetext is not a problem here —
 * legality is parsePgn's job — but an unterminated comment or a malformed
 * tag still throws.
 * @param {string} text
 * @returns {string[]}
 */
function splitGames(input) {
  const { text, tokens } = tokenize(input);
  if (!tokens.length) return text.trim() ? [text.trim()] : [];
  const starts = [tokens[0].pos];
  let inMoves = false;
  let afterResult = false;
  let depth = 0;
  for (let k = 1; k < tokens.length; k++) {
    const t = tokens[k];
    if (t.type === "open") depth++;
    else if (t.type === "close") depth = Math.max(0, depth - 1);
    const boundary = (t.type === "tag" && inMoves) || (t.type !== "tag" && afterResult);
    if (boundary) {
      // the tokenizer dropped the move number before a first move; the chunk
      // should still begin with it
      const num = /\d+\.+\s*$/.exec(text.slice(0, t.pos));
      starts.push(num ? num.index : t.pos);
      inMoves = false; afterResult = false; depth = 0;
    }
    if (t.type !== "tag") inMoves = true;
    if (t.type === "result" && depth === 0) afterResult = true;
  }
  const out = [];
  for (let k = 0; k < starts.length; k++) {
    const chunk = text.slice(starts[k], k + 1 < starts.length ? starts[k + 1] : undefined).trim();
    if (chunk) out.push(chunk);
  }
  return out;
}

// ---------------------------------------------------------------------------
// serializer

function escapeTag(v) {
  return String(v).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** "N." for white, "N..." for black, read off the position the move is played from. */
function numberPrefix(fenBefore) {
  const f = fenBefore.split(" ");
  return f[1] === "b" ? f[5] + "..." : f[5] + ".";
}

/**
 * Movetext tokens for `first` and everything after it on its line, with the
 * alternatives to each move written as `( ... )` right after the move they
 * replace. `numbered` forces a number on the first move (variation starts,
 * and any black move that follows a comment or a variation).
 */
function emitLine(out, parent, first, numbered) {
  let prev = parent;
  let node = first;
  let force = numbered;
  while (node) {
    const white = prev.fen.split(" ")[1] === "w";
    if (white || force) out.push(numberPrefix(prev.fen));
    out.push(node.san);
    for (const n of node.nags || []) out.push("$" + n);
    force = false;
    const c = formatComment(node);
    if (c) { out.push("{", ...c.split(" "), "}"); force = true; }
    // alternatives hang off the mainline move only; inside a variation the
    // first node is itself one of them and must not list its siblings again
    if (node === prev.children[0]) {
      for (const alt of prev.children.slice(1)) {
        out.push("(");
        emitLine(out, prev, alt, true);
        out.push(")");
        force = true;
      }
    }
    prev = node;
    node = node.children[0] || null;
  }
}

/** Join tokens into lines no longer than `width`, breaking only between tokens. */
function wrap(tokens, width) {
  const lines = [];
  let line = "";
  for (const t of tokens) {
    if (!line) line = t;
    else if (line.length + 1 + t.length <= width) line += " " + t;
    else { lines.push(line); line = t; }
  }
  if (line) lines.push(line);
  return lines.join("\n");
}

/**
 * Export a game as PGN text: Seven Tag Roster first, other tags in the order
 * given, movetext wrapped at `width` columns and the result token exactly
 * once at the end. `headers` may be an array of pairs or a plain object.
 * @param {{headers: Array<[string,string]>|object, root: object, result?: string}} game
 * @param {{width?: number}} [opts]
 * @returns {string}
 */
function serializePgn(game, opts) {
  const width = (opts && opts.width) || 80;
  const pairs = Array.isArray(game.headers) ? game.headers : Object.entries(game.headers || {});
  const byName = new Map(pairs.map(([k, v]) => [k, v]));
  const ordered = STR.filter((k) => byName.has(k)).map((k) => [k, byName.get(k)])
    .concat(pairs.filter(([k]) => !STR.includes(k)));
  const result = RESULTS.has(game.result) ? game.result : "*";
  const lines = ordered.map(([k, v]) => "[" + k + ' "' + escapeTag(v) + '"]');
  const out = [];
  const rootComment = formatComment(game.root);
  if (rootComment) out.push("{", ...rootComment.split(" "), "}");
  if (game.root.children.length) emitLine(out, game.root, game.root.children[0], true);
  out.push(result);
  return (lines.length ? lines.join("\n") + "\n\n" : "") + wrap(out, width) + "\n";
}

export const ChessPgnParser = {
  START_FEN, STR, SUFFIX_NAG, tokenize, parsePgn, splitGames, serializePgn, parseComment, formatComment,
};
export { START_FEN, STR, SUFFIX_NAG, tokenize, parsePgn, splitGames, serializePgn, parseComment, formatComment };
