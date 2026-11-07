/**
 * Moves as the app prints them (v20-0-plan §5 H): figurine notation. The
 * piece letter of a SAN move (`Nf3`, `exd8=Q`) becomes the piece, drawn as
 * Merida's silhouette — the board's default set — in the text's colour, so
 * it is right in every theme; one shape per kind, as figurine notation is
 * printed (19.0's figurines.js, reused).
 *
 * The letter is still there, in the text at size 0 just before the glyph: a
 * screen reader reads "Nf3", a selection copies "Nf3", and textContent is
 * the SAN — the figure is only how it looks.
 *
 *   sanNode("Nxe5+")              → <span class="san-fig">…</span>
 *   withFigurines("走 Qxd5 之后")  → ["走 ", <span>, " 之后"]
 *   setNotation(el, text)         → el's children replaced with the above
 * @module lib/notation
 */
import { figurineSvg } from "./figurines.js";

// No look-behind: Safari 14 (macOS 11) has none. Group 1 is what precedes.
// A piece move, or a pawn move that promotes; then check or mate.
const SAN_IN_TEXT = /(^|[^A-Za-z0-9])((?:[KQRBN][a-h]?[1-8]?x?[a-h][1-8]|[a-h](?:x[a-h])?[18]=[QRBN])[+#]?)(?![A-Za-z0-9])/g;

/**
 * A piece letter as a figurine: the letter (in the text, at size 0) and the
 * glyph after it. The glyph is the only box: a wrapper box or a positioned
 * letter would break the run, and a screen reader would say "N f3".
 */
function figure(letter) {
  const f = document.createElement("span");
  f.className = "fig";
  f.dataset.piece = letter;
  const l = document.createElement("span");
  l.className = "fig-l";
  l.textContent = letter;
  f.append(l);
  f.insertAdjacentHTML("beforeend", figurineSvg(letter));
  const svg = f.lastChild;
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  return f;
}

/**
 * One SAN move as an inline element; its text is the SAN.
 * @param {string} san
 * @returns {HTMLElement}
 */
export function sanNode(san) {
  const el = document.createElement("span");
  el.className = "san-fig";
  el.dataset.san = san;
  const s = String(san);
  const lead = /^[KQRBN]/.test(s) ? s[0] : "";
  const promo = /=([QRBN])/.exec(s);
  if (lead) el.append(figure(lead));
  const rest = s.slice(lead.length);
  if (promo) {
    const i = rest.indexOf("=");
    el.append(rest.slice(0, i + 1), figure(promo[1]), rest.slice(i + 2));
  } else el.append(rest);
  return el;
}

/**
 * A sentence with the moves in it as figurines.
 * @param {string} text
 * @returns {Array<string|HTMLElement>} for append() / replaceChildren()
 */
export function withFigurines(text) {
  const s = text == null ? "" : String(text);
  const out = [];
  let at = 0;
  SAN_IN_TEXT.lastIndex = 0;
  for (let m; (m = SAN_IN_TEXT.exec(s));) {
    const start = m.index + m[1].length;
    if (start > at) out.push(s.slice(at, start));
    out.push(sanNode(m[2]));
    at = start + m[2].length;
  }
  if (at < s.length) out.push(s.slice(at));
  return out;
}

/** Replace `el`'s children with `text`, its moves as figurines. */
export function setNotation(el, text) {
  el.replaceChildren(...withFigurines(text));
  return el;
}

/** The moves found in a sentence (for tests): what withFigurines turns into figurines. */
export function sansIn(text) {
  const out = [];
  SAN_IN_TEXT.lastIndex = 0;
  for (let m; (m = SAN_IN_TEXT.exec(String(text)));) out.push(m[2]);
  return out;
}
