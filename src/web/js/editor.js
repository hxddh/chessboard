/**
 * Position editor model — board array in, FEN out, plus the legality checks
 * chess.js's own validate_fen does not make (it accepts positions that no
 * game could ever reach, e.g. two white kings or a side already "in check"
 * while its opponent is to move).
 *
 * Pure data: the app owns rendering and input, this module owns the rules of
 * what makes an editable position playable.
 * @module editor
 */
(function (global) {
  const FILES = "abcdefgh";

  /** empty 8x8 board, row 0 = rank 8 (same shape as chess.js .board()) */
  function emptyBoard() {
    return Array.from({ length: 8 }, () => Array(8).fill(null));
  }

  /** deep copy of a chess.js .board() result */
  function cloneBoard(board) {
    return board.map((row) => row.map((p) => (p ? { type: p.type, color: p.color } : null)));
  }

  function squareOf(r, c) { return FILES[c] + (8 - r); }
  function indexOf(sq) { return { r: 8 - Number(sq[1]), c: FILES.indexOf(sq[0]) }; }

  /**
   * Squares that could legitimately be an en-passant target: the side to move
   * must have a pawn able to capture there, and the pawn that supposedly just
   * double-stepped must be sitting past it with an empty square behind. Any
   * other ep square would describe a position no game could reach.
   * @returns {string[]} candidate squares, in board order
   */
  function epCandidates(state) {
    const b = state.board;
    const at = (r, c) => (r >= 0 && r < 8 && c >= 0 && c < 8 ? b[r][c] : null);
    const out = [];
    // white to move captures a black pawn that jumped d7→d5: target is on rank 6
    const [movedRow, targetRow, fromRow, victim, capturer] = state.turn === "w"
      ? [3, 2, 1, "b", "w"] // rows: 0 = rank 8
      : [4, 5, 6, "w", "b"];
    for (let c = 0; c < 8; c++) {
      const p = at(movedRow, c);
      if (!p || p.type !== "p" || p.color !== victim) continue;
      if (at(targetRow, c) || at(fromRow, c)) continue; // path must be clear
      const canTake = [c - 1, c + 1].some((cc) => {
        const q = at(movedRow, cc);
        return q && q.type === "p" && q.color === capturer;
      });
      if (canTake) out.push(squareOf(targetRow, c));
    }
    return out;
  }

  /**
   * Board + flags → FEN. Castling rights are filtered down to the ones the
   * placement can actually support, so a hand-built position never claims a
   * right its rooks and king do not back up; the same goes for the en-passant
   * square.
   */
  function toFen(state) {
    const b = state.board;
    const rows = [];
    for (let r = 0; r < 8; r++) {
      let row = "", empty = 0;
      for (let c = 0; c < 8; c++) {
        const p = b[r][c];
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        const ch = p.type === "n" ? "n" : p.type;
        row += p.color === "w" ? ch.toUpperCase() : ch;
      }
      if (empty) row += empty;
      rows.push(row);
    }
    const at = (sq, type, color) => {
      const { r, c } = indexOf(sq);
      const p = b[r][c];
      return !!p && p.type === type && p.color === color;
    };
    let castling = "";
    if (state.castling.K && at("e1", "k", "w") && at("h1", "r", "w")) castling += "K";
    if (state.castling.Q && at("e1", "k", "w") && at("a1", "r", "w")) castling += "Q";
    if (state.castling.k && at("e8", "k", "b") && at("h8", "r", "b")) castling += "k";
    if (state.castling.q && at("e8", "k", "b") && at("a8", "r", "b")) castling += "q";
    const ep = state.ep && epCandidates(state).includes(state.ep) ? state.ep : "-";
    return rows.join("/") + " " + state.turn + " " + (castling || "-") + " " + ep + " 0 1";
  }

  /**
   * @returns {string|null} an i18n key naming why the position cannot be
   * played, or null when it is fine. Keys (not text) keep this module free of
   * any particular language.
   */
  function validate(state, ChessCtor) {
    const b = state.board;
    let wk = 0, bk = 0;
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const p = b[r][c];
      if (!p) continue;
      if (p.type === "k") { if (p.color === "w") wk++; else bk++; }
      if (p.type === "p" && (r === 0 || r === 7)) return "edErr.pawnBackRank";
    }
    if (wk !== 1) return wk === 0 ? "edErr.noWhiteKing" : "edErr.manyWhiteKings";
    if (bk !== 1) return bk === 0 ? "edErr.noBlackKing" : "edErr.manyBlackKings";
    const fen = toFen(state);
    const v = new ChessCtor().validate_fen(fen);
    if (!v.valid) return "edErr.invalid";
    // the side NOT to move must not be in check — that position is unreachable
    const other = state.turn === "w" ? "b" : "w";
    const probe = new ChessCtor(fen.replace(" " + state.turn + " ", " " + other + " "));
    if (probe.in_check()) return "edErr.otherInCheck";
    const g = new ChessCtor(fen);
    if (!g.moves().length) return g.in_check() ? "edErr.alreadyMate" : "edErr.alreadyStalemate";
    return null;
  }

  /** fresh editor state seeded from an existing position */
  function fromFen(fen, ChessCtor) {
    const g = new ChessCtor(fen);
    const parts = fen.split(" ");
    const rights = parts[2] || "-";
    return {
      board: cloneBoard(g.board()),
      turn: parts[1] === "b" ? "b" : "w",
      castling: {
        K: rights.includes("K"), Q: rights.includes("Q"),
        k: rights.includes("k"), q: rights.includes("q"),
      },
      ep: /^[a-h][36]$/.test(parts[3] || "") ? parts[3] : null,
    };
  }

  global.ChessEditor = { emptyBoard, cloneBoard, squareOf, indexOf, toFen, validate, fromFen, epCandidates };
})(typeof window !== "undefined" ? window : globalThis);
