/**
 * 进阶课程第三部的核对（v8-2-plan T1）：每一步的「对」与「错」都问引擎。
 *
 * The 24 lessons of lessons-adv.js are move tasks only, and the runtime
 * grades a move by the task's goal (trainer/lessons.js learnMove): a "one-of"
 * task takes exactly the moves in `accept`, a "mate" task any mate. So the
 * set the app calls right is known without a browser — it is computed here
 * the same way — and the engine is asked two things about it:
 *
 *   - 对: every move the app accepts is as good as the engine's best, within
 *     TIE (50 cp, verify-puzzles.mjs's line); where the best is a forced
 *     mate, every accepted move mates as fast as the best one;
 *   - 错: the best move the app would refuse is worse than the best by more
 *     than TIE — or, against a forced mate, mates more slowly or not at all.
 *     Refusing a move the engine rates equal would teach the wrong thing, so
 *     that fails the script just like accepting a bad one.
 *
 * Where a lesson's next task is the position after this task's move and one
 * reply, the reply is checked too: the lesson shows it as the opponent's
 * answer, and it must be his best (within TIE) — the lessons never pretend
 * the other side played along.
 *
 * Same engine and search as verify-puzzles.mjs (lib/sf-node.mjs: the vendored
 * single-threaded Stockfish, a clean hash per position, MultiPV, `searchmoves`
 * for a move outside the top lines), so a run is reproducible at a depth.
 * Writes docs/lessons-verified.json; scripts/test-lessons-adv.mjs holds the
 * lessons to it (each task's position and accepted set) without an engine.
 *
 *   node scripts/verify-lessons.mjs [--depth=20] [--tie=50] [--only=cl-cands,…] [--dry]
 *
 * --dry prints the verdicts and writes nothing. Exits 1 on any failure.
 */
import fs from "fs";
import path from "path";
import { loadAppModules, ROOT } from "./lib/app-module.mjs";
import { startEngine } from "./lib/sf-node.mjs";

const arg = (name, dflt) => {
  const a = process.argv.find((x) => x.startsWith("--" + name + "="));
  return a ? a.slice(name.length + 3) : dflt;
};
const DEPTH = Number(arg("depth", 20));
const TIE = Number(arg("tie", 50));
const ONLY = arg("only", "") ? new Set(arg("only", "").split(",")) : null;
const DRY = process.argv.includes("--dry");
const OUT = path.join(ROOT, "docs/lessons-verified.json");
/** a score this high is a forced mate (sf-node.mjs scoreOf: 100000 − moves) */
const MATE = 99000;

/**
 * Where each position comes from, for the record. "lichess:ID" is the
 * position after the first move of Lichess puzzle ID (database.lichess.org,
 * CC0) — "·flipped" where the solver had Black and the board was mirrored so
 * the student plays White; none is among the puzzles shipped in
 * src/web/js/lichess. "set" is a position set up for the lesson, "Réti 1921"
 * the study. Keyed lesson → one entry per task.
 */
export const SOURCES = {
  "cl-cands": ["set", "set", "lichess:0IGyd"],
  "cl-order": ["set", "set", "set"],
  "cl-checks": ["set", "set", "set"],
  "cl-count": ["set", "set", "set"],
  "cl-quiet": ["lichess:00gyK·flipped", "lichess:09ZOa·flipped", "lichess:08EVQ"],
  "cl-replies": ["set", "set", "set"],
  "cl-threat": ["lichess:KzGn8", "lichess:6hCcU·flipped", "lichess:Wfpah·flipped"],
  "cl-end": ["lichess:0MeQL", "lichess:0MeQL", "lichess:0MeQL"],
  "cl-inter": ["lichess:0ESey", "lichess:0ESey", "lichess:0GnOR"],
  "cl-race": ["Réti 1921", "lichess:00iQD·flipped", "lichess:02TLp·flipped"],
  "cl-mate": ["set", "set", "set"],
  "cl-guard": ["lichess:0SiCg·flipped", "lichess:0SiCg·flipped", "lichess:0iOvg"],
  "po-badb": ["lichess:0dMiS", "lichess:0dMiS", "lichess:02Wga·flipped"],
  "po-trap": ["lichess:198eP", "lichess:0pwqn", "lichess:0KyXd·flipped"],
  "po-color": ["lichess:0VN8S·flipped", "lichess:0VN8S·flipped", "lichess:0zyEv", "lichess:0zyEv"],
  "po-hole": ["lichess:0JIDw", "lichess:1svGQ", "lichess:0yXaT"],
  "po-outpost": ["lichess:0pZXS", "lichess:066tp", "lichess:0RHQx"],
  "po-chain": ["lichess:7PN6u·flipped", "lichess:Bzi4H", "lichess:CI5lN·flipped"],
  "po-major": ["lichess:073Hj", "lichess:02jSd·flipped", "lichess:04jT2·flipped"],
  "po-file": ["lichess:00aG8·flipped", "lichess:01RxX", "lichess:02oHh"],
  "po-behind": ["lichess:31kKI", "lichess:3JFKd", "lichess:2JBlU"],
  "po-kpend": ["lichess:002Uy·flipped", "lichess:02Mby·flipped", "lichess:01NZA"],
  "po-trade": ["lichess:01hHF", "lichess:05PrB·flipped", "lichess:06hm4"],
  "po-prophy": ["lichess:09Mof", "lichess:0AJTV·flipped", "lichess:08uwv·flipped"],
};

/**
 * The moves the lesson runner accepts in `fen` — trainer/lessons.js
 * learnMove's goal test, for the goals the advanced lessons use.
 * @returns {string[]} SAN, in chess.js move order
 */
export function acceptedMoves(Chess, task) {
  const g = new Chess(task.fen);
  const out = [];
  for (const m of g.moves({ verbose: true })) {
    g.move(m);
    const ok = task.goal === "one-of" ? (task.accept || []).includes(m.san)
      : task.goal === "mate" ? g.in_checkmate()
      : task.goal === "check" ? g.in_check() : false;
    g.undo();
    if (ok) out.push(m.san);
  }
  return out;
}

/** The reply that turns `task` into `next`, or null when `next` does not follow. */
export function replyBetween(Chess, task, next) {
  const g = new Chess(task.fen);
  if (!g.move(task.solution[0])) return null;
  const want = next.fen.split(" ").slice(0, 4).join(" ");
  for (const r of g.moves({ verbose: true })) {
    g.move(r);
    const hit = g.fen().split(" ").slice(0, 4).join(" ") === want;
    g.undo();
    if (hit) return r.san;
  }
  return null;
}

async function main() {
  const ctx = loadAppModules(["src/web/js/chess.js", "src/web/js/lessons-adv.js"]);
  const Chess = ctx.Chess;
  const lessons = ctx.CHESS_LESSONS_ADV_ZH.filter((L) => !ONLY || ONLY.has(L.id));
  const eng = await startEngine(Chess, DEPTH);
  const t0 = Date.now();
  const rec = { depth: DEPTH, tie: TIE, engine: "third_party/stockfish/stockfish-19-lite-single (lib/sf-node.mjs)", lessons: [] };
  let bad = 0, n = 0;
  const legalCount = (fen) => new Chess(fen).moves().length;
  const scoreOf = async (fen, lines, san) => {
    const hit = lines.find((l) => l.san === san);
    return hit ? hit.score : eng.scoreOfMove(fen, san);
  };

  for (const L of lessons) {
    const out = { id: L.id, part: L.part, tasks: [] };
    for (const [ti, t] of L.tasks.entries()) {
      n++;
      const right = acceptedMoves(Chess, t);
      const legal = legalCount(t.fen);
      const lines = await eng.topLines(t.fen, Math.min(legal, right.length + 1));
      const best = lines[0];
      const scores = [];
      for (const san of right) scores.push({ san, score: await scoreOf(t.fen, lines, san) });
      const wrong = lines.find((l) => !right.includes(l.san)) || null;
      const why = [];
      if (!right.length) why.push("no move satisfies the goal");
      if (!right.includes(t.solution[0])) why.push("solution " + t.solution[0] + " is not accepted");
      if (best.score >= MATE) {
        for (const s of scores) if (s.score !== best.score) why.push("accepted " + s.san + " mates slower than " + best.san);
        if (wrong && wrong.score >= best.score) why.push("refused " + wrong.san + " mates as fast");
      } else {
        if (!right.includes(best.san)) why.push("the engine's best " + best.san + " is refused");
        for (const s of scores) if (best.score - s.score > TIE) why.push("accepted " + s.san + " is " + (best.score - s.score) + "cp worse");
        if (wrong && best.score - wrong.score <= TIE) why.push("refused " + wrong.san + " is only " + (best.score - wrong.score) + "cp worse");
      }
      const row = { fen: t.fen, src: (SOURCES[L.id] || [])[ti] || null, goal: t.goal, accept: right, best, right: scores, wrong, ok: !why.length };
      if (wrong) row.margin = best.score - wrong.score;
      // the opponent's answer the lesson shows, when the next task follows on
      const next = L.tasks[ti + 1];
      const reply = next ? replyBetween(Chess, t, next) : null;
      if (reply) {
        const g = new Chess(t.fen);
        g.move(t.solution[0]);
        const after = g.fen();
        const rl = await eng.topLines(after, 3);
        const rs = await scoreOf(after, rl, reply);
        row.reply = { san: reply, score: rs, best: rl[0] };
        if (rl[0].score - rs > TIE) { why.push("the reply shown, " + reply + ", is " + (rl[0].score - rs) + "cp below the best " + rl[0].san); row.ok = false; }
      }
      if (why.length) { bad++; row.why = why; }
      out.tasks.push(row);
      const tag = (L.id + "#" + ti).padEnd(14);
      console.log((row.ok ? "ok   " : "FAIL ") + tag + " right " + right.join(",").padEnd(12) + " best " + best.san + " " + best.score +
        (wrong ? "  refused-best " + wrong.san + " " + wrong.score : "") + (row.reply ? "  reply " + reply : "") + (why.length ? "  — " + why.join("; ") : ""));
    }
    rec.lessons.push(out);
  }
  rec.summary = { lessons: rec.lessons.length, tasks: n, failed: bad, minutes: Number(((Date.now() - t0) / 60000).toFixed(1)) };
  console.log(`${n} tasks in ${rec.lessons.length} lessons at depth ${DEPTH}: ${n - bad} ok, ${bad} failed (${rec.summary.minutes} min)`);
  if (!DRY && !ONLY) fs.writeFileSync(OUT, JSON.stringify(rec, null, 1) + "\n");
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) main();
