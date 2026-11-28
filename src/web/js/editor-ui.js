/**
 * 编辑局面 and 载入 FEN: the panel, the palette, the dialog (25.4).
 *
 * Both are opened a handful of times in an app's life, and their wiring sat
 * in every first paint and in app.js's line budget. They are a chunk now
 * (chunk-editor.js), fetched the first time either door is pressed —
 * about-lazy.js's rule. The FEN dialog itself opens at once from app.js
 * (its field filled, its keys guarded, before anything has arrived); what
 * its buttons do is here. The rules of what makes a position playable stay in
 * editor.js, which the importer needs at first paint anyway; app.js keeps
 * the board model (editorModel), the one way out (stopEditor) and
 * loadFenAsGame, which the analysis board uses without opening either.
 * @module editor-ui
 */

const PALETTE = [
  ["w", "k"], ["w", "q"], ["w", "r"], ["w", "b"], ["w", "n"], ["w", "p"], ["", ""],
  ["b", "k"], ["b", "q"], ["b", "r"], ["b", "b"], ["b", "n"], ["b", "p"], ["", ""],
];
const PALETTE_GLYPH = {
  wk: "♔", wq: "♕", wr: "♖", wb: "♗", wn: "♘", wp: "♙",
  bk: "♚", bq: "♛", br: "♜", bb: "♝", bn: "♞", bp: "♟",
};

/**
 * @param {object} d  { doc, store, t, toast, Chess, ChessEditor, Icons, Dlg, Host,
 *   viewGame, invalidateEngine, cancelAnim, sync, draw, stopEditor, loadFenAsGame }
 */
export function createEditorUI(d) {
  const { doc, store, t, toast, Chess, ChessEditor: Ed } = d;
  const $ = (id) => doc.getElementById(id);
  const ed = () => store.session.editor;

  function start() {
    d.invalidateEngine();
    store.session.editor = Ed.fromFen(d.viewGame().fen(), Chess);
    ed().brush = { color: "w", type: "p" };
    store.game.selection = null;
    d.cancelAnim();
    palette();
    d.sync();
    toast(t("msg.editor.hint"), "fix");
  }

  function palette() {
    const el = $("editor-palette");
    if (!el || !ed()) return;
    el.replaceChildren();
    for (const [color, type] of PALETTE) {
      const b = doc.createElement("button");
      b.type = "button";
      if (!color) {
        b.dataset.erase = "1";
        b.appendChild(d.Icons.icon("x"));
        b.title = t("ed.eraser");
        b.classList.toggle("active", ed().brush.type === "");
      } else {
        b.dataset.color = color;
        b.dataset.type = type;
        b.textContent = PALETTE_GLYPH[color + type];
        b.classList.toggle("active", ed().brush.color === color && ed().brush.type === type);
      }
      el.appendChild(b);
    }
  }

  function setSquare(sq, piece) {
    const { r, c } = Ed.indexOf(sq);
    ed().board[r][c] = piece;
    syncUI();
    d.draw();
  }
  function click(sq) {
    const { r, c } = Ed.indexOf(sq);
    const cur = ed().board[r][c], brush = ed().brush;
    // tapping the same piece again clears the square
    const same = cur && cur.color === brush.color && cur.type === brush.type;
    setSquare(sq, brush.type === "" || same ? null : { type: brush.type, color: brush.color });
  }

  function reason() { return ed() ? Ed.validate(ed(), Chess) : null; }

  function syncUI() {
    const sec = $("sec-editor");
    if (!sec) return;
    sec.hidden = !ed();
    if (!ed()) return;
    doc.querySelectorAll("#editor-turn button").forEach((b) => {
      b.classList.toggle("active", b.dataset.turn === ed().turn);
    });
    doc.querySelectorAll("#editor-castling button").forEach((b) => {
      b.classList.toggle("active", !!ed().castling[b.dataset.cr]);
    });
    const epRow = $("row-ed-ep");
    const epSeg = $("editor-ep");
    const cands = Ed.epCandidates(ed());
    if (epRow) epRow.hidden = !cands.length;
    if (epSeg && cands.length) {
      epSeg.replaceChildren();
      for (const sqName of [null, ...cands]) {
        const b = doc.createElement("button");
        b.type = "button";
        b.dataset.ep = sqName || "";
        b.textContent = sqName || t("ed.epNone");
        b.classList.toggle("active", (ed().ep || null) === sqName);
        epSeg.appendChild(b);
      }
    }
    if (!cands.length && ed().ep) ed().ep = null;
    const err = $("editor-error");
    const why = reason();
    if (err) err.textContent = why ? t(why) : "";
    const apply = $("editor-apply");
    if (apply) apply.disabled = !!why;
  }

  function apply() {
    const why = reason();
    if (why) { toast(t(why)); return; }
    const fen = Ed.toFen(ed());
    d.stopEditor();
    d.loadFenAsGame(fen, t("msg.editor.started"));
  }

  /** The FEN field's one way of saying no. The red ring is what you see, the
      sentence under it is the reason, and aria-invalid is what a screen reader
      is told; all three were set by hand at three call sites, which is three
      chances to set two of them. Pass nothing to clear all three. */
  function setFenError(msg) {
    const input = $("fen-input");
    const err = $("fen-error");
    if (err) err.textContent = msg || "";
    if (input) {
      input.classList.toggle("bad", !!msg);
      input.setAttribute("aria-invalid", msg ? "true" : "false");
    }
  }
  const closeFen = () => d.Dlg.close($("fen-modal"));

  function submitFen() {
    const input = $("fen-input");
    const raw = (input && input.value || "").trim();
    if (!raw) { setFenError(t("msg.fen.empty")); return; }
    const v = new Chess().validate_fen(raw);
    if (!v.valid) { setFenError(v.error || t("msg.fen.invalid")); return; }
    // chess.js accepts positions no game could reach (no kings, a side already
    // in check while its opponent moves) — reuse the editor's stricter rules,
    // then load the ORIGINAL fen so its en-passant square and clocks survive.
    const why = Ed.validate(Ed.fromFen(raw, Chess), Chess);
    if (why) { setFenError(t(why)); return; }
    closeFen();
    d.loadFenAsGame(new Chess(raw).fen(), t("msg.fen.loaded"));
  }

  // --- wiring ---
  const onBtn = (id, sel, fn) => {
    $(id).onclick = (ev) => {
      const b = ev.target.closest(sel);
      if (!b || !ed()) return;
      fn(b);
      syncUI();
    };
  };
  $("editor-palette").onclick = (ev) => {
    const b = ev.target.closest("button");
    if (!b || !ed()) return;
    ed().brush = b.dataset.erase ? { color: "", type: "" } : { color: b.dataset.color, type: b.dataset.type };
    palette();
  };
  onBtn("editor-turn", "button[data-turn]", (b) => { ed().turn = b.dataset.turn; });
  onBtn("editor-ep", "button[data-ep]", (b) => { ed().ep = b.dataset.ep || null; });
  onBtn("editor-castling", "button[data-cr]", (b) => { ed().castling[b.dataset.cr] = !ed().castling[b.dataset.cr]; });
  $("editor-clear").onclick = () => {
    if (!ed()) return;
    ed().board = Ed.emptyBoard();
    ed().castling = { K: false, Q: false, k: false, q: false };
    syncUI();
    d.draw();
  };
  $("editor-reset").onclick = () => {
    if (!ed()) return;
    store.session.editor = Object.assign(Ed.fromFen(new Chess().fen(), Chess), { brush: ed().brush });
    syncUI();
    d.draw();
  };
  $("editor-cancel").onclick = () => {
    d.stopEditor();
    d.sync();
    toast(t("msg.editor.cancelled"));
  };
  $("editor-apply").onclick = apply;

  async function fromClip() {
    try {
      const clip = await d.Host.readClipboard();
      const input = $("fen-input");
      if (input) input.value = (clip || "").trim();
      setFenError("");
    } catch (_) { toast(t("msg.clipboard.readFailed"), "fault"); }
  }

  return { start, palette, click, erase: (sq) => setSquare(sq, null), syncUI, reason, submitFen, fromClip };
}
