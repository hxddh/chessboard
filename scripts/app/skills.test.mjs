/**
 * The skill graph and its generated positions (src/app/content): the shape
 * of the graph, 3–5 positions per skill easy → hard, every position proved
 * again here (legal, its goal met, its mini-game solvable in its par), and
 * no position needing a skill its own skill does not stand on.
 */
import { SKILLS, SKILL, GROUPS, ancestors, BY_MOTIF, STAGES } from "../../src/app/content/skills.js";
import { ITEMS, PRACTICE, DRILLS, PLACEMENT } from "../../src/app/content/practice.js";
import { LESSONS } from "../../src/app/content/lessons.js";
import { judge } from "../../src/app/learn/goals.js";
import * as MG from "../../src/app/learn/minigame.js";
import { Chess } from "../../src/app/core/chess.js";
import { LINE_MOTIF_KEYS } from "../../src/app/core/motif.js";
import zh from "../../src/app/text/learn.zh.js";

export default function (test) {
  test("skills: 60–80 nodes, known prerequisites, no cycles, groups in order", (a) => {
    a.ok(SKILLS.length >= 60 && SKILLS.length <= 80, "count " + SKILLS.length);
    a.equal(new Set(SKILLS.map((s) => s.id)).size, SKILLS.length, "ids unique");
    for (const s of SKILLS) {
      a.ok(GROUPS.includes(s.group), s.id + " group");
      for (const p of s.needs) a.ok(SKILL[p], s.id + " needs unknown " + p);
      a.ok(!ancestors(s.id).has(s.id), s.id + " is its own prerequisite");
      for (const p of s.needs) a.ok(SKILL[p].level <= s.level, s.id + " needs " + p + " of a higher level");
    }
    const firstOf = GROUPS.map((g) => SKILLS.findIndex((s) => s.group === g));
    a.deepEqual([...firstOf].sort((x, y) => x - y), firstOf, "groups appear in the curriculum's order");
    for (const k of Object.keys(BY_MOTIF)) a.ok(LINE_MOTIF_KEYS.includes(k), "motif key " + k);
    a.deepEqual(STAGES.map((s) => s.rating), [800, 1000, 1200, 1500]);
  });

  test("skills: every skill has a name and one sentence (zh)", (a) => {
    for (const s of SKILLS) {
      a.ok(zh["sk." + s.id], "sk." + s.id);
      a.ok(zh["sk." + s.id + ".why"], "sk." + s.id + ".why");
    }
    for (const s of SKILLS) for (const l of s.lessons) a.ok(LESSONS[l], "lesson text " + l);
  });

  test("skills: ≥ 3 positions each, ≤ 5, difficulty never falls", (a) => {
    let n = 0;
    for (const s of SKILLS) {
      const list = PRACTICE[s.id];
      a.ok(list && list.length >= 3 && list.length <= 5, s.id + ": " + (list && list.length) + " positions");
      const r = list.map((id) => ITEMS[id].rating);
      for (let i = 1; i < r.length; i++) a.ok(r[i] >= r[i - 1], s.id + " ratings " + r.join(","));
      n += list.length;
    }
    a.ok(n >= 3 * SKILLS.length);
  });

  test("skills: no position needs a skill beyond its own skill's prerequisites", (a) => {
    for (const s of SKILLS) {
      const ok = ancestors(s.id); ok.add(s.id);
      for (const id of [...PRACTICE[s.id], ...(DRILLS[s.id] || [])]) {
        const it = ITEMS[id];
        a.equal(it.skill, s.id, id + " skill");
        for (const need of it.needs || []) a.ok(ok.has(need), id + " (" + s.id + ") needs " + need);
      }
    }
  });

  test("skills: every position proved again", (a) => {
    for (const it of Object.values(ITEMS)) {
      if (it.kind === "stars") {
        const best = MG.solve(it.fen, it.targets, it.only);
        a.ok(best && best.par === it.par, it.id + " par " + it.par + " vs " + (best && best.par));
      } else if (it.kind === "move") {
        const r = judge(it.fen, it.answer, it);
        a.ok(r && r.ok, it.id + " answer meets " + it.goal);
      } else if (it.kind === "line") {
        const g = new Chess(it.fen);
        if (it.mode !== "opening") a.equal(g.turn(), it.side, it.id + " side");
        for (const san of it.line) a.ok(g.move(san), it.id + " " + san);
        if (it.mode === "puzzle" && it.themes && it.themes.includes("mate")) a.ok(g.in_checkmate(), it.id + " mates");
      } else if (it.kind === "drill") {
        const g = new Chess(it.fen);
        a.ok(g.moves().length > 0 && ["win", "draw", "promote"].includes(it.goal), it.id);
      } else a.ok(false, "kind " + it.kind);
    }
  });

  test("skills: every item type is in the graph", (a) => {
    const kinds = new Set(Object.values(ITEMS).map((it) => it.kind + (it.mode ? ":" + it.mode : "")));
    for (const k of ["stars", "move", "line:puzzle", "line:opening", "line:classic", "drill"]) a.ok(kinds.has(k), k);
    a.ok(SKILLS.some((s) => s.game), "a targeted game");
  });

  test("skills: the placement pool spans 600–2400", (a) => {
    const r = PLACEMENT.map((id) => ITEMS[id].rating);
    a.ok(PLACEMENT.length >= 30, "pool " + PLACEMENT.length);
    a.ok(Math.min(...r) <= 650 && Math.max(...r) >= 2350, Math.min(...r) + "–" + Math.max(...r));
  });
}
