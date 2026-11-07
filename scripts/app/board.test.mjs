import { createScene } from "../../src/app/board/scene.js";
import { createInput } from "../../src/app/board/input.js";
import { cubicInOut, effectiveMs, DEFAULT_MS, MIN_MS, DRAG_THRESHOLD_PX, progress, LIFT_SCALE, CAPTURE_SCALE,
  settleMs, snapbackMs, hoverMs, SETTLE_MAX_MS, SNAPBACK_MAX_MS, HOVER_MAX_MS } from "../../src/app/board/tween.js";
import { readFen, premoveDests, toScreen, fromScreen } from "../../src/app/board/geometry.js";
import { START_FEN, applyMove, legalDests } from "../../src/app/core/rules.js";

const play = (fen, ...ucis) => ucis.reduce((f, u) => applyMove(f, u).fen, fen);
const pieceOn = (frame, sq) => frame.pieces.find((p) => p.sq === sq && !p.leaving);

/** An input machine over a real position, as board.js wires it. */
function inputOn(fen, { movable = "both", premove = true, orientation = "white" } = {}) {
  const ctx = { fen, placement: readFen(fen), dests: legalDests(fen) };
  const turn = () => (ctx.fen.split(" ")[1] === "w" ? "white" : "black");
  const input = createInput({
    canPick(sq) {
      const code = ctx.placement.get(sq);
      if (!code || movable === "none") return null;
      const side = code[0] === "w" ? "white" : "black";
      if (side === turn() && (movable === "both" || movable === side)) return "move";
      if (premove && movable === side) return "premove";
      return null;
    },
    dests: (from) => ctx.dests.get(from) || [],
    premoveDests: (from) => premoveDests(ctx.placement, from),
    orientation: () => orientation,
  });
  ctx.input = input;
  ctx.setFen = (f) => { ctx.fen = f; ctx.placement = readFen(f); ctx.dests = legalDests(f); return input.positionChanged(); };
  return ctx;
}
const click = (inp, sq) => [...inp.down(sq, 0, 0), ...inp.up(sq, 0, 0)];

export default function (test) {
  test("tween parameters: 250 ms, cubic in-out, nothing under 70 ms or with reduced motion", (a) => {
    a.equal(DEFAULT_MS, 250);
    a.equal(MIN_MS, 70);
    a.equal(DRAG_THRESHOLD_PX, 3);
    a.equal(cubicInOut(0), 0);
    a.equal(cubicInOut(1), 1);
    a.equal(cubicInOut(0.5), 0.5);
    a.ok(Math.abs(cubicInOut(0.25) - 0.0625) < 1e-9, "4t³ in the first half");
    a.ok(Math.abs(cubicInOut(0.75) - 0.9375) < 1e-9, "symmetric");
    a.ok(cubicInOut(0.1) < 0.1 && cubicInOut(0.9) > 0.9, "slow at both ends");
    a.equal(effectiveMs(250), 250);
    a.equal(effectiveMs(69), 0);
    a.equal(effectiveMs(70), 70);
    a.equal(effectiveMs(500, true), 0);
    a.equal(progress(100, 0, 50), 1, "zero duration is already there");
  });

  test("feel parameters (v20-0-plan §5 H): lift, settle, snap-back, capture, hover scale with the move", (a) => {
    a.equal(LIFT_SCALE, 1.1);
    a.equal(CAPTURE_SCALE, 0.8);
    a.equal(SETTLE_MAX_MS, 120);
    a.equal(SNAPBACK_MAX_MS, 180);
    a.equal(HOVER_MAX_MS, 90);
    a.equal(settleMs(250), 120); a.equal(settleMs(120), 60); a.equal(settleMs(0), 0);
    a.equal(snapbackMs(250), 175); a.equal(snapbackMs(500), 180); a.equal(snapbackMs(120), 84); a.equal(snapbackMs(0), 0);
    a.equal(hoverMs(250), 90); a.equal(hoverMs(70), 70); a.equal(hoverMs(0), 0);
    a.equal(snapbackMs(effectiveMs(250, true)), 0, "reduced motion: no snap-back tween either");
  });

  test("scene: a man let go off a legal square slides home from the pointer", (a) => {
    const sc = createScene();
    sc.setPieces(readFen(START_FEN), { now: 0, ms: 250 });
    a.ok(sc.release("g1", 6.4, 3.1, { now: 100, ms: 175 }));
    const p0 = pieceOn(sc.frame(100), "g1");
    a.ok(Math.abs(p0.x - 6.4) < 1e-9 && Math.abs(p0.y - 3.1) < 1e-9 && p0.scale === LIFT_SCALE, "starts at the pointer, lifted");
    const mid = pieceOn(sc.frame(187), "g1");
    a.ok(mid.x > 6 && mid.x < 6.4 && mid.y > 0 && mid.y < 3.1, "on the way");
    const p1 = pieceOn(sc.frame(275), "g1");
    a.ok(p1.x === 6 && p1.y === 0 && p1.scale === 1 && !sc.frame(275).busy, "home in 175 ms");
    a.equal(sc.release("e4", 0, 0, { now: 0, ms: 100 }), false, "nothing there, nothing to do");
    sc.release("b1", 3, 3, { now: 0, ms: 0 });
    a.equal(pieceOn(sc.frame(0), "b1").x, 1, "no duration: home at once");
  });

  test("input: snap-back for a premove drop and a cancelled drag; none for a click", (a) => {
    const c = inputOn(play(START_FEN, "e2e4"), { movable: "white" });
    c.input.down("g1", 0, 0); c.input.move("f3", 50, 50);
    a.deepEqual(c.input.up("f3", 50, 50), [{ type: "premove", from: "g1", to: "f3" }, { type: "snapback", from: "g1" }], "a premove waits at home");
    c.input.down("b1", 0, 0); c.input.move("c3", 50, 50);
    a.deepEqual(c.input.cancel(), [{ type: "snapback", from: "b1" }], "a cancelled drag goes home");
    c.input.down("b1", 0, 0);
    a.deepEqual(c.input.cancel(), [], "a press that never dragged has nothing to bring back");
    a.deepEqual(click(c.input, "b1").filter((x) => x.type === "snapback"), []);
  });

  test("input: a right-drag arrow snaps to a queen line or a knight jump", (a) => {
    const c = inputOn(START_FEN);
    const arrow = (from, to) => { c.input.down(from, 0, 0, 2); c.input.up(to, 0, 0, 2); const ar = c.input.state.shapes.arrows; return ar[ar.length - 1]; };
    a.equal(arrow("e2", "e6").to, "e6", "a file stays");
    a.equal(arrow("c1", "h6").to, "h6", "a diagonal stays");
    a.equal(arrow("g1", "f3").to, "f3", "a knight jump stays");
    a.ok(["e7", "f6"].includes(arrow("e4", "f7").to), "e4→f7 is no line: it ends a square away, on e7 or f6");
    a.equal(arrow("a1", "c6").to, "a6", "a1→c6: the nearest square on a line from a1");
  });

  test("geometry: FEN, screen mapping both ways", (a) => {
    const p = readFen(START_FEN);
    a.equal(p.size, 32);
    a.equal(p.get("e1"), "wk");
    a.equal(p.get("d8"), "bq");
    a.deepEqual(toScreen(0, 0, "white"), { col: 0, row: 7 });
    a.deepEqual(toScreen(0, 0, "black"), { col: 7, row: 0 });
    for (const o of ["white", "black"]) for (let c = 0; c < 8; c++) for (let r = 0; r < 8; r++) {
      const sq = fromScreen(c, r, o);
      const back = toScreen(sq.charCodeAt(0) - 97, Number(sq[1]) - 1, o);
      a.deepEqual(back, { col: c, row: r });
    }
  });

  test("geometry: premove destinations", (a) => {
    const p = readFen(START_FEN);
    a.deepEqual(premoveDests(p, "e2").sort(), ["d3", "e3", "e4", "f3"]);
    a.deepEqual(premoveDests(p, "g1").sort(), ["e2", "f3", "h3"]);
    a.ok(premoveDests(p, "e1").includes("g1") && premoveDests(p, "e1").includes("c1"), "castling squares");
    a.equal(premoveDests(p, "d1").length, 21, "a queen's lines on an empty board");
    a.deepEqual(premoveDests(p, "e4"), []);
  });

  test("scene: a move tweens the man from its square to the new one", (a) => {
    const sc = createScene();
    sc.setPieces(readFen(START_FEN), { now: 0, ms: 250 });
    a.equal(sc.frame(0).busy, false, "the first placement does not animate");
    const id = pieceOn(sc.frame(0), "e2").id;
    const r = sc.setPieces(readFen(play(START_FEN, "e2e4")), { now: 1000, ms: 250 });
    a.deepEqual(r.moved.map((m) => [m.from, m.to]), [["e2", "e4"]]);
    const mid = sc.frame(1125);
    const p = mid.pieces.find((x) => x.id === id);
    a.ok(mid.busy);
    a.equal(p.x, 4);
    a.ok(Math.abs(p.y - 2) < 1e-9, "halfway in time is halfway on the curve (rank 2→4 ⇒ 2)");
    a.ok(Math.abs(sc.frame(1050).pieces.find((x) => x.id === id).y - (1 + 2 * cubicInOut(0.2))) < 1e-9);
    const end = sc.frame(1250);
    a.equal(end.busy, false);
    a.equal(end.pieces.find((x) => x.id === id).y, 3);
    a.equal(end.pieces.find((x) => x.id === id).sq, "e4");
  });

  test("scene: a capture fades the taken man out where he stood", (a) => {
    const sc = createScene();
    const f0 = play(START_FEN, "e2e4", "d7d5");
    sc.setPieces(readFen(f0), { now: 0, ms: 250 });
    const r = sc.setPieces(readFen(play(f0, "e4d5")), { now: 0, ms: 250 });
    a.deepEqual(r.captured, ["d5"]);
    const mid = sc.frame(125);
    const gone = mid.pieces.find((p) => p.leaving);
    a.equal(gone.code, "bp");
    a.ok(gone.alpha > 0 && gone.alpha < 1 && gone.scale < 1);
    a.ok(mid.pieces[0].leaving, "drawn first, under the arriving man");
    a.equal(sc.frame(250).pieces.filter((p) => p.leaving).length, 0, "removed when faded");
    a.equal(sc.frame(250).pieces.length, 31);
  });

  test("scene: castling slides king and rook together", (a) => {
    const sc = createScene();
    const f0 = play(START_FEN, "e2e4", "e7e5", "g1f3", "b8c6", "f1c4", "g8f6");
    sc.setPieces(readFen(f0), { now: 0, ms: 250 });
    const r = sc.setPieces(readFen(play(f0, "e1g1")), { now: 0, ms: 250 });
    a.deepEqual(r.moved.map((m) => m.from + m.to).sort(), ["e1g1", "h1f1"]);
    a.equal(r.captured.length + r.appeared.length, 0);
  });

  test("scene: en passant removes the right pawn; promotion slides the pawn into a queen", (a) => {
    const sc = createScene();
    const f0 = play(START_FEN, "e2e4", "a7a6", "e4e5", "d7d5");
    sc.setPieces(readFen(f0), { now: 0, ms: 250 });
    const ep = sc.setPieces(readFen(play(f0, "e5d6")), { now: 0, ms: 250 });
    a.deepEqual(ep.captured, ["d5"]);
    a.deepEqual(ep.moved.map((m) => m.from + m.to), ["e5d6"]);
    const sc2 = createScene();
    const pf = "8/P6k/8/8/8/8/8/K7 w - - 0 1";
    sc2.setPieces(readFen(pf), { now: 0, ms: 250 });
    const pr = sc2.setPieces(readFen(play(pf, "a7a8q")), { now: 0, ms: 250 });
    a.deepEqual(pr.moved.map((m) => m.from + m.to), ["a7a8"]);
    a.equal(pieceOn(sc2.frame(10), "a8").code, "wq");
  });

  test("scene: a drop settles where it lands, a retarget starts from where the man is", (a) => {
    const sc = createScene();
    sc.setPieces(readFen(START_FEN), { now: 0, ms: 250 });
    sc.setPieces(readFen(play(START_FEN, "g1f3")), { now: 0, ms: 250, snap: [{ sq: "f3", x: 5.3, y: 2.2 }] });
    const f0 = pieceOn(sc.frame(0), "f3");
    a.ok(Math.abs(f0.x - 5.3) < 1e-9 && Math.abs(f0.y - 2.2) < 1e-9 && f0.scale === LIFT_SCALE, "dropped: starts where it was let go, lifted, not from g1");
    a.equal(sc.frame(settleMs(250) - 1).busy, true, "it settles");
    const f1 = pieceOn(sc.frame(settleMs(250)), "f3");
    a.ok(f1.x === 5 && f1.y === 2 && f1.scale === 1 && !sc.frame(settleMs(250)).busy, "in " + settleMs(250) + " ms, on the square at 1×");
    const sc0 = createScene();
    sc0.setPieces(readFen(START_FEN), { now: 0, ms: 0 });
    sc0.setPieces(readFen(play(START_FEN, "g1f3")), { now: 0, ms: 0, snap: [{ sq: "f3", x: 5.3, y: 2.2 }] });
    a.equal(sc0.frame(0).busy, false, "with motion off a drop lands at once");
    // move a man, then take it back halfway: it returns from mid-flight
    sc.setPieces(readFen(play(START_FEN, "g1f3", "e7e5")), { now: 0, ms: 250 });
    const f = play(START_FEN, "g1f3", "e7e5");
    sc.setPieces(readFen(play(f, "f3e5")), { now: 1000, ms: 250 });
    const mid = pieceOn(sc.frame(1125), "e5");
    sc.setPieces(readFen(f), { now: 1125, ms: 250 });
    const back = sc.frame(1125).pieces.find((p) => p.id === mid.id);
    a.ok(Math.abs(back.x - mid.x) < 1e-9 && Math.abs(back.y - mid.y) < 1e-9, "no jump on retarget");
  });

  test("scene: zero duration means no tween at all", (a) => {
    const sc = createScene();
    sc.setPieces(readFen(START_FEN), { now: 0, ms: 0 });
    sc.setPieces(readFen(play(START_FEN, "e2e4")), { now: 0, ms: effectiveMs(250, true) });
    a.equal(sc.frame(0).busy, false);
    a.equal(pieceOn(sc.frame(0), "e4").y, 3);
  });

  test("scene: overlays fade in, slide, fade out", (a) => {
    const sc = createScene();
    sc.setOverlays([{ key: "last:e2", kind: "square", color: "last", x: 4, y: 1 },
      { key: "auto:0", kind: "arrow", color: "E", x: 4, y: 1, x2: 4, y2: 3 }], { now: 0, ms: 250 });
    let f = sc.frame(125);
    a.ok(f.busy && f.overlays.every((o) => o.alpha > 0 && o.alpha < 1), "fading in");
    sc.setOverlays([{ key: "auto:0", kind: "arrow", color: "E", x: 6, y: 0, x2: 5, y2: 2 }], { now: 250, ms: 250 });
    f = sc.frame(375);
    const arrow = f.overlays.find((o) => o.key === "auto:0");
    a.ok(arrow.x > 4 && arrow.x < 6 && arrow.alpha === 1, "the engine arrow slides to its new move");
    const last = f.overlays.find((o) => o.key === "last:e2");
    a.ok(last && last.alpha < 1, "a removed highlight fades out");
    a.equal(sc.frame(500).overlays.length, 1);
    a.equal(sc.frame(500).busy, false);
    sc.setOverlays([], { now: 600, ms: 0 });
    a.equal(sc.frame(600).overlays.length, 0, "with no duration, gone at once");
  });

  test("scene: an unchanged overlay does not restart its tween", (a) => {
    const sc = createScene();
    sc.setOverlays([{ key: "k", kind: "dot", x: 1, y: 1 }], { now: 0, ms: 250 });
    sc.setOverlays([{ key: "k", kind: "dot", x: 1, y: 1 }], { now: 200, ms: 250 });
    a.equal(sc.frame(250).busy, false);
  });

  test("input: click a man, click a hint → one legal move", (a) => {
    const c = inputOn(START_FEN);
    a.deepEqual(click(c.input, "e2"), []);
    a.equal(c.input.state.selected.sq, "e2");
    a.deepEqual(c.input.targets().sort(), ["e3", "e4"]);
    a.deepEqual(click(c.input, "e5"), [], "not a hint: nothing moves");
    a.equal(c.input.state.selected, null, "and the selection goes");
    click(c.input, "e2");
    a.deepEqual(click(c.input, "e4"), [{ type: "move", from: "e2", to: "e4", drop: false }]);
    a.equal(c.input.state.selected, null);
  });

  test("input: the other side's men are not pickable, clicking twice deselects", (a) => {
    const c = inputOn(START_FEN);
    click(c.input, "e7");
    a.equal(c.input.state.selected, null);
    click(c.input, "g1");
    click(c.input, "g1");
    a.equal(c.input.state.selected, null);
    click(c.input, "g1");
    click(c.input, "b1");
    a.equal(c.input.state.selected.sq, "b1", "another own man switches the selection");
  });

  test("input: a drag starts at 3 px and drops legal moves only", (a) => {
    const c = inputOn(START_FEN);
    c.input.down("g1", 100, 100);
    a.equal(c.input.move("g1", 102, 101), false, "2.2 px is still a click");
    a.equal(c.input.move("g1", 102, 102.3), true, "3 px is a drag");
    a.ok(c.input.state.drag.active);
    a.deepEqual(c.input.up("g3", 150, 150), [{ type: "snapback", from: "g1" }], "an illegal drop goes home");
    a.equal(c.input.state.selected, null);
    a.equal(c.input.state.drag, null);
    c.input.down("g1", 100, 100);
    c.input.move("f3", 140, 60);
    a.deepEqual(c.input.up("f3", 140, 60), [{ type: "move", from: "g1", to: "f3", drop: true }]);
    c.input.down("b1", 0, 0); c.input.move("b1", 10, 0);
    a.deepEqual(c.input.up("b1", 10, 0), [{ type: "snapback", from: "b1" }], "dropped back on its square");
    a.equal(c.input.state.selected.sq, "b1", "stays selected");
  });

  test("input: premove is queued, then played if legal when the turn comes", (a) => {
    const c = inputOn(START_FEN, { movable: "white" });
    click(c.input, "e2");
    a.deepEqual(click(c.input, "e4"), [{ type: "move", from: "e2", to: "e4", drop: false }]);
    a.deepEqual(c.setFen(play(START_FEN, "e2e4")), []);
    click(c.input, "g1");
    a.equal(c.input.state.selected.mode, "premove");
    a.deepEqual(click(c.input, "f3"), [{ type: "premove", from: "g1", to: "f3" }]);
    a.deepEqual(c.input.state.premove, { from: "g1", to: "f3" });
    const after = c.setFen(play(START_FEN, "e2e4", "e7e5"));
    a.deepEqual(after, [{ type: "move", from: "g1", to: "f3", drop: false, premove: true }]);
    a.equal(c.input.state.premove, null);
  });

  test("input: an illegal premove is dropped when the turn comes", (a) => {
    const c = inputOn(play(START_FEN, "e2e4"), { movable: "white" });
    click(c.input, "e4");
    click(c.input, "e5");
    a.deepEqual(c.input.state.premove, { from: "e4", to: "e5" });
    a.deepEqual(c.setFen(play(START_FEN, "e2e4", "e7e5")), [], "e5 is blocked now");
    a.equal(c.input.state.premove, null);
  });

  test("input: right-drag toggles arrows, right-click toggles marks, left click clears", (a) => {
    const c = inputOn(START_FEN);
    c.input.down("e2", 0, 0, 2); c.input.up("e4", 0, 0, 2);
    c.input.down("d4", 0, 0, 2); c.input.up("d4", 0, 0, 2, { shiftKey: true });
    a.deepEqual(c.input.state.shapes, { arrows: [{ from: "e2", to: "e4", color: "G" }], marks: [{ sq: "d4", color: "R" }] });
    c.input.down("e2", 0, 0, 2); c.input.up("e4", 0, 0, 2);
    a.equal(c.input.state.shapes.arrows.length, 0, "the same arrow again removes it");
    c.input.down("e2", 0, 0, 2); c.input.up("e4", 0, 0, 2, { altKey: true });
    a.equal(c.input.state.shapes.arrows[0].color, "B");
    const out = c.input.down("a3", 0, 0);
    a.deepEqual(out, [{ type: "shapes" }]);
    a.deepEqual(c.input.state.shapes, { arrows: [], marks: [] });
  });

  test("input: keyboard cursor, Enter selects and moves, Escape cancels", (a) => {
    const c = inputOn(START_FEN);
    c.input.key("Enter");
    a.equal(c.input.state.cursor, "e2", "first key shows the cursor");
    c.input.key("Enter");
    a.equal(c.input.state.selected.sq, "e2");
    c.input.key("ArrowUp"); c.input.key("ArrowUp");
    a.equal(c.input.state.cursor, "e4");
    a.deepEqual(c.input.key("Enter").commands, [{ type: "move", from: "e2", to: "e4", drop: false }]);
    c.input.key("ArrowLeft");
    a.equal(c.input.state.cursor, "d4");
    for (let i = 0; i < 10; i++) c.input.key("ArrowLeft");
    a.equal(c.input.state.cursor, "a4", "stops at the edge");
    a.equal(c.input.key("x").handled, false);
  });

  test("input: keyboard directions follow the orientation", (a) => {
    const c = inputOn(START_FEN, { orientation: "black" });
    c.input.key("Enter");
    a.equal(c.input.state.cursor, "e7");
    c.input.key("ArrowUp");
    a.equal(c.input.state.cursor, "e6", "up the screen is down the ranks for Black");
    c.input.key("ArrowLeft");
    a.equal(c.input.state.cursor, "f6");
  });

  test("input: movable none picks nothing", (a) => {
    const c = inputOn(START_FEN, { movable: "none" });
    click(c.input, "e2");
    a.equal(c.input.state.selected, null);
  });

  test("input: every move a random clicker produces is legal", (a) => {
    let fen = START_FEN, s = 7;
    const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x80000000; };
    const c = inputOn(fen);
    let moves = 0;
    for (let i = 0; i < 4000 && moves < 60; i++) {
      const sq = "abcdefgh"[Math.floor(rnd() * 8)] + (1 + Math.floor(rnd() * 8));
      for (const cmd of click(c.input, sq)) {
        a.ok((legalDests(fen).get(cmd.from) || []).includes(cmd.to), "legal " + cmd.from + cmd.to);
        fen = applyMove(fen, cmd.from + cmd.to).fen;
        c.setFen(fen);
        moves++;
        if (!legalDests(fen).size) i = 1e9;
      }
    }
    a.ok(moves > 10, moves + " moves made");
  });
}
