/**
 * Why a move is not the book move.
 *
 * The opening drills used to answer every wrong move with "这不是谱着" — true,
 * and useless. Someone learning openings by rote learns nothing from being
 * told they missed a line they have not memorised yet; what they need is the
 * principle the book move is obeying and their move is not.
 *
 * So this module compares the two moves in the position they were played in
 * and returns the most concrete thing that can honestly be said, in order:
 * material actually hangs → castling rights thrown away → the queen comes out
 * before the minor pieces → the same piece moves twice → the book castles,
 * develops or takes the centre and this move does not → an edge pawn move.
 * Nothing here reveals the book move: the messages name a principle, and the
 * one that names a square names the *opponent's* refutation, which the player
 * is about to see on the board anyway.
 *
 * It is deliberately shallow — one ply of "what can they take" — because a
 * deep search would answer a different question ("is this objectively best?")
 * than the one being asked ("what habit does this break?"), and because the
 * drills run without the engine.
 * @module opening-coach
 */
  const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
  const CENTRE = { d4: 1, e4: 1, d5: 1, e5: 1 };
  const MINOR = { n: 1, b: 1 };

  /**
   * The best capture the side to move has, scored one ply deep: the victim's
   * value, less the capturer's if the square can be recaptured.
   * @returns {{gain: number, san: string, victim: string}|null}
   */
  function bestCapture(pos, Chess) {
    let best = null;
    for (const m of pos.moves({ verbose: true })) {
      if (!m.captured) continue;
      const probe = new Chess(pos.fen());
      probe.move(m.san);
      const recapture = probe.moves({ verbose: true }).some((r) => r.to === m.to && r.captured);
      const gain = VALUE[m.captured] - (recapture ? VALUE[m.piece] : 0);
      if (!best || gain > best.gain) best = { gain, san: m.san, victim: m.captured };
    }
    return best;
  }

  /** how much material the side to move can win here, 0 when nothing hangs */
  function hanging(fen, Chess) {
    const best = bestCapture(new Chess(fen), Chess);
    return best && best.gain > 0 ? best : { gain: 0, san: "", victim: "" };
  }

  /** squares this side has already moved a piece onto (for "same piece twice") */
  function movedOnto(history, color) {
    const seen = {};
    for (const m of history) if (m.color === color) seen[m.to] = m.from;
    return seen;
  }

  function developed(history, color) {
    let n = 0;
    const from = {};
    for (const m of history) {
      if (m.color !== color || !MINOR[m.piece]) continue;
      if (!from[m.from]) { from[m.from] = 1; n++; }
    }
    return n;
  }

  /** a move that brings a knight or bishop off its starting rank */
  function isDeveloping(m, color) {
    if (!m || !MINOR[m.piece]) return false;
    const back = color === "w" ? "1" : "8";
    return m.from[1] === back && m.to[1] !== back;
  }

  function isCastle(m) {
    return !!m && typeof m.flags === "string" && /[kq]/.test(m.flags);
  }

  /**
   * @param {string} startFen position the drill starts from ("" for the initial one)
   * @param {string[]} priorSans moves already played in the drill
   * @param {string} playedSan the move the student just played
   * @param {string} bookSan the move the line calls for
   * @param {Function} Chess the chess.js constructor
   * @returns {{key: string, vals: (string|number)[]}|null} an i18n key and its
   * placeholders, or null when nothing specific can be said
   */
  function critique(startFen, priorSans, playedSan, bookSan, Chess) {
    let before;
    try {
      before = startFen ? new Chess(startFen) : new Chess();
      for (const san of priorSans) if (!before.move(san)) return null;
    } catch (_) { return null; }

    const history = before.history({ verbose: true });
    const beforeFen = before.fen();
    const played = new Chess(beforeFen);
    const mv = played.move(playedSan);
    if (!mv) return null;
    const bookPos = new Chess(beforeFen);
    const bk = bookPos.move(bookSan);
    const color = mv.color;

    // 1. Material. Only what *this* move gives away: a pawn the line was
    //    always going to shed (a gambit) hangs after the book move too, and
    //    calling that a mistake would teach the wrong lesson.
    const lossNow = hanging(played.fen(), Chess);
    const lossBook = bk ? hanging(bookPos.fen(), Chess) : { gain: 0 };
    if (lossNow.gain > 0 && lossNow.gain > lossBook.gain) {
      return { key: "opc.hangs", vals: ["piece." + lossNow.victim, lossNow.san] };
    }

    // 2. A king move that is not castling burns the right to castle at all.
    if (mv.piece === "k" && !isCastle(mv)) {
      const rights = beforeFen.split(" ")[2];
      const mine = color === "w" ? /[KQ]/ : /[kq]/;
      if (mine.test(rights)) return { key: "opc.kingMove", vals: [] };
    }

    // 3. The queen in front of her own army: every developing move the
    //    opponent makes comes with tempo against her.
    if (mv.piece === "q" && developed(history, color) < 2) {
      return { key: "opc.earlyQueen", vals: [] };
    }

    // 4. Moving the same piece twice while pieces sit at home. A capture is
    //    its own reason, so it does not count.
    const already = movedOnto(history, color);
    if (!mv.captured && already[mv.from] && bk && !already[bk.from]) {
      return { key: "opc.samePiece", vals: [] };
    }

    // 5–7. What the book move does that this one does not.
    const constructive = isCastle(mv) || isDeveloping(mv, color) || (mv.piece === "p" && CENTRE[mv.to]);
    if (isCastle(bk) && !isCastle(mv)) return { key: "opc.castle", vals: [] };
    if (isDeveloping(bk, color) && !isDeveloping(mv, color)) return { key: "opc.develop", vals: [] };
    if (bk && bk.piece === "p" && CENTRE[bk.to] && !constructive) {
      return { key: "opc.centre", vals: [] };
    }

    // 8. An edge pawn neither fights for the centre nor lets a piece out.
    if (mv.piece === "p" && (mv.from[0] === "a" || mv.from[0] === "h")) {
      return { key: "opc.edgePawn", vals: [] };
    }
    // 9. Nothing is wrong with the move itself — say so rather than inventing
    //    a fault. Developing, castling and taking the centre are the whole
    //    point of the opening; this line simply goes another way.
    if (constructive) return { key: "opc.sound", vals: [] };
    return { key: "opc.generic", vals: [] };
  }

  export const ChessOpeningCoach = { critique, hanging, VALUE };
