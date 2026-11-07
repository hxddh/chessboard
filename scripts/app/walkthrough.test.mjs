/**
 * The walkthrough's low-severity defects (v20-0-plan §11 L4–L11) and the two
 * items from the native run, held without a browser (the e2e side is
 * scripts/test-walkthrough-e2e.mjs):
 *
 *   L4   no rating before any evidence: ratingKnown() is false on a new
 *        profile, the curve has no point until there is one
 *   L5   a library row's date in one form per language, a PGN's partial
 *        date to its precision
 *   L6   the board's coordinates drawn over the men, with a halo
 *   L7   设置's 「我的水平」 renamed so it is not 我's 「你的水平」
 *   L9   the stage's skills: the count and the list say the same thing
 *   L10  a name next to CJK text: no space between CJK and CJK, one between
 *        CJK and Latin; English untouched
 *   en   plurals: "1 game", never "1 games"
 *   db   a settings change is written at once, not with the next batch
 */
import { createText } from "../../src/app/lib/text.js";
import { usePack } from "../../src/app/text/lang.js";
import { learnText } from "../../src/app/text/learn.js";
import { playText } from "../../src/app/text/play.js";
import { nextGameLine, opponentFor } from "../../src/app/learn/service.js";
import { oppText } from "../../src/app/opponents/lines.js";
import { project, initialState, apply, ratingKnown, visibleRating, stageOf, nextSkills } from "../../src/app/learn/model.js";
import { STAGES, SKILL } from "../../src/app/content/skills.js";
import { dateLabel } from "../../src/app/library/list.js";
import { paint } from "../../src/app/board/render.js";
import { createStore } from "../../src/app/state/store.js";
import { playActions, initialPlay } from "../../src/app/state/play.js";
import { settingsActions, SETTINGS_DEFAULT } from "../../src/app/state/settings.js";
import { persist } from "../../src/app/state/persist.js";
import { createDb, memoryBackend } from "../../src/app/services/db.js";
import uiEn from "../../src/app/text/pack.en.js";
import uiJa from "../../src/app/text/pack.ja.js";
import learnZh from "../../src/app/text/learn.zh.js";

const LANG_PACKS = [["zh", null], ["en", uiEn], ["ja", uiJa]];
function inEach(fn) {
  try { for (const [lang, p] of LANG_PACKS) { usePack(lang, p); fn(lang, learnText(), playText()); } }
  finally { usePack("zh", null); }
}

export default function (test) {
  // --- L4 ------------------------------------------------------------------------------------
  test("L4: a new profile has no rating to show and no curve; placement or a rated answer makes one", (a) => {
    const st = initialState();
    a.equal(ratingKnown(st), false, "nothing done: not known");
    // a lesson read before the placement is not evidence of strength
    apply(st, { id: 1, at: 1000, type: "learn.answer", item: "ls:rook", skill: "rook", ok: true, kind: "lesson" });
    a.equal(ratingKnown(st), false, "a lesson read: still not known");
    a.equal(st.curve.length, 0, "and no point on the curve (" + JSON.stringify(st.curve) + ")");
    const placed = project([{ id: 1, at: 1000, type: "learn.place", rating: 600, how: "new" }]);
    a.ok(ratingKnown(placed) && placed.curve.length === 1, "the placement: known, one point");
    const answered = project([{ id: 1, at: 1000, type: "learn.answer", item: "x", skill: "rook", ok: true, tries: 1, rating: 700, kind: "line" }]);
    a.ok(ratingKnown(answered), "a rated answer: known");
  });
  test("L4: rated games alone give the number from the games, not the 400 nobody earned", (a) => {
    const ev = [], at = 1000;
    let id = 0;
    for (let i = 0; i < 2; i++) {
      ev.push({ id: ++id, at, type: "game.import", gameId: "g" + i, you: "w", opp: 1500, result: "1-0" });
    }
    const st = project(ev);
    a.ok(ratingKnown(st), "two rated games: known");
    a.ok(visibleRating(st) === Math.round(st.game.r) && visibleRating(st) > 600, "the number comes from the games (" + visibleRating(st) + ")");
    a.ok(st.curve.length && st.curve.every(([, r]) => r > 450), "and so does every point on the curve " + JSON.stringify(st.curve));
  });

  // --- L5 ------------------------------------------------------------------------------------
  test("L5: dates in one form per language, a PGN's partial date to its precision", (a) => {
    const played = { kind: "played", date: new Date(2026, 10, 7, 15, 30).getTime(), dateText: "" };
    const pgn = { kind: "imported", date: Date.UTC(2026, 9, 20), dateText: "2026.10.20" };
    const month = { kind: "imported", date: Date.UTC(2024, 2, 1), dateText: "2024.03.??" };
    const year = { kind: "imported", date: Date.UTC(1999, 0, 1), dateText: "1999.??.??" };
    const imported = { kind: "imported", date: Date.UTC(2025, 0, 5), dateText: "" };
    for (const locale of ["zh-CN", "en-GB", "ja-JP"]) {
      const a1 = dateLabel(played, locale), a2 = dateLabel(pgn, locale);
      // the same shape: the digits differ, everything else is the same
      const shape = (s) => s.replace(/\d+/g, "#").replace(/[A-Za-z]+/g, "M");
      a.equal(shape(a1), shape(a2), locale + ": played " + a1 + " and imported " + a2 + " in one form");
      a.ok(!/\d{4}\.\d/.test(a2), locale + ": not the PGN's dotted form (" + a2 + ")");
      a.ok(/2024/.test(dateLabel(month, locale)) && !/\b1\b|01/.test(dateLabel(month, locale).replace(/2024/, "")) && shape(dateLabel(month, locale)) !== shape(a2),
        locale + ": a month without a day is a month (" + dateLabel(month, locale) + ")");
      a.equal(dateLabel(year, locale).replace(/[^\d]/g, ""), "1999", locale + ": a year alone is the year (" + dateLabel(year, locale) + ")");
      a.equal(shape(dateLabel(imported, locale)), shape(a2), locale + ": an imported game without a Date tag, the day it was imported");
    }
    a.ok(/2026年10月20日/.test(dateLabel(pgn, "zh-CN")), "zh: " + dateLabel(pgn, "zh-CN"));
    a.ok(/20 Oct 2026/.test(dateLabel(pgn, "en-GB")), "en: " + dateLabel(pgn, "en-GB"));
    a.ok(/2026\/10\/20|2026年10月20日/.test(dateLabel(pgn, "ja-JP")), "ja: " + dateLabel(pgn, "ja-JP"));
    a.equal(dateLabel({ kind: "imported", date: 0, dateText: "" }, "zh-CN"), "", "no date: nothing");
  });

  // --- L6 ------------------------------------------------------------------------------------
  test("L6: the coordinates are drawn after the men, each over a halo in its square's colour", (a) => {
    const ops = [];
    const ctx = new Proxy({}, {
      get(o, k) {
        if (k in o) return o[k];
        if (["fillText", "strokeText", "drawImage", "fillRect", "arc", "ellipse", "strokeRect"].includes(k)) return (...args) => ops.push({ op: k, args, fill: o.fillStyle, stroke: o.strokeStyle });
        if (k === "createRadialGradient") return () => ({ addColorStop() {} });
        return () => {};
      },
      set(o, k, v) { o[k] = v; return true; },
    });
    const P = { light: "#eeeeee", dark: "#777777", font: "sans-serif", dot: "#000", ring: "#000", pieceShadow: "rgba(0,0,0,.1)" };
    const pieces = ["a1", "b1", "c1", "h1"].map((sq) => ({ code: "wr", sq, x: sq.charCodeAt(0) - 97, y: 0, alpha: 1, scale: 1 }));
    paint(ctx, 400, { pieces, overlays: [] }, { orientation: "white", paint: P, set: "none", coords: true });
    const isCoord = (o) => /^[a-h1-8]$/.test(o.args[0]);
    const man = ops.map((o, i) => (o.op === "fillText" && !isCoord(o) ? i : -1)).filter((i) => i >= 0);
    const coord = ops.map((o, i) => (o.op === "fillText" && isCoord(o) ? i : -1)).filter((i) => i >= 0);
    a.equal(coord.length, 16, "16 coordinates");
    a.ok(man.length === 4 && Math.min(...coord) > Math.max(...man), "every coordinate after the last man (men " + man + ", coords " + coord + ")");
    for (const i of coord) {
      const halo = ops[i - 1];
      a.ok(halo && halo.op === "strokeText" && halo.args[0] === ops[i].args[0], ops[i].args[0] + ": a halo before its ink");
      a.ok(halo.stroke !== ops[i].fill && [P.light, P.dark].includes(halo.stroke), ops[i].args[0] + ": the halo in the square's colour, the ink in the other");
    }
  });

  // --- L7 ------------------------------------------------------------------------------------
  test("L7: 设置's level is not called what 我's rating is called, in all three languages", (a) => {
    const nouns = { zh: ["水平"], en: ["level"], ja: ["強さ"] };
    inEach((lang, t) => {
      const set = t("set.level"), me = t("me.level"), auto = t("set.auto");
      for (const n of nouns[lang]) {
        a.ok(me.toLowerCase().includes(n), lang + ": 我's is the " + n + " (" + me + ")");
        a.ok(!set.toLowerCase().includes(n), lang + ": the setting is not (" + set + ")");
        a.ok(!auto.toLowerCase().includes(n), lang + ": nor the coach's 「按…」 option (" + auto + ")");
      }
    });
  });

  // --- L9 ------------------------------------------------------------------------------------
  test("L9: the stage's line says how many skills are listed and how many there are", (a) => {
    const st = initialState();
    const stage = stageOf(st, STAGES);
    const next = nextSkills(st, stage.missing);
    a.ok(stage.missing.length > 12, "a new profile misses more than 12 (" + stage.missing.length + ")");
    a.equal(next.length, 12, "the next 12 are listed");
    a.ok(next.every((id) => stage.missing.includes(id)), "from the missing ones");
    // the ones you can start on come first
    const reach = (id) => SKILL[id].needs.every((p) => !!(st.skills[p] && st.skills[p].lit));
    const firstBlocked = next.findIndex((id) => !reach(id));
    a.ok(firstBlocked === -1 || next.slice(firstBlocked).every((id) => !reach(id)), "the reachable first: " + next.join(","));
    inEach((lang, t) => {
      const line = t("me.stageMore", stage.missing.length, next.length);
      a.ok(line.includes(String(stage.missing.length)) && line.includes("12"), lang + ": both numbers (" + line + ")");
      a.ok(t("me.stageNeeds", 3).includes("3"), lang + ": the short form when all are listed");
    });
  });

  // --- L10 -----------------------------------------------------------------------------------
  test("L10: a name in CJK copy — no space beside a CJK name, one beside a Latin name; English as written", (a) => {
    inEach((lang, t) => {
      for (const r of [400, 1500]) {
        const o = opponentFor(r), name = oppText(o.id, "name");
        const line = nextGameLine(t, o);
        if (lang === "zh") a.ok(line.includes("对" + name), "zh: " + line);
        if (lang === "ja") a.ok(line.includes("：" + name + "と"), "ja: " + line);
        if (lang === "en") a.ok(line.endsWith("against " + name), "en: " + line);
      }
      const latin = t("learn.game", "Hansen");
      if (lang === "zh") a.equal(latin, "下一盘：对 Hansen");
      if (lang === "ja") a.equal(latin, "次の対局：Hansen と");
      if (lang === "en") a.equal(latin, "Next game: against Hansen");
    });
    const zh = createText({ a: "对 {0}", b: "{0}在想…", c: "走 {0}", d: "第 {0} 步" }, {}, { lang: "zh" });
    a.equal(zh("a", "艾瑞丝"), "对艾瑞丝");
    a.equal(zh("b", "Hansen"), "Hansen 在想…");
    a.equal(zh("b", "皮普"), "皮普在想…");
    a.equal(zh("c", "Nf3"), "走 Nf3");
    a.equal(zh("d", 12), "第 12 步", "a number keeps its spaces");
    const en = createText({ a: "against {0}" }, {}, { lang: "en" });
    a.equal(en("a", "艾瑞丝"), "against 艾瑞丝", "English is never re-spaced");
  });

  // --- English plurals --------------------------------------------------------------------------
  test("en: plurals — one game, two games; the syntax and every counted noun in the English copy", (a) => {
    const t = createText({ n: "{0} {0:game|games} imported", m: "{0} / {1} {1:game|games}" }, {}, { lang: "en" });
    a.equal(t("n", 1), "1 game imported");
    a.equal(t("n", 2), "2 games imported");
    a.equal(t("n", 0), "0 games imported");
    a.equal(t("m", 1, 1), "1 / 1 game");
    try {
      usePack("en", uiEn);
      const l = learnText();
      a.equal(l("me.importDone", 1), "1 game imported");
      a.equal(l("me.libCount", 1), "1 game in the library");
      a.equal(l("lib.total", 1), "1 game");
      a.equal(l("me.stageNeeds", 1), "1 skill to go");
      a.equal(l("map.positions", 1), "1 position");
      a.equal(l("lib.youName", "Ann", 1), "Ann (1 game)");
      a.ok(/1 time;/.test(l("me.weekLine", "forks", 1, 0)), l("me.weekLine", "forks", 1, 0));
      a.equal(l("learn.rightPar", 1), "Correct — 1 move, the fewest possible");
    } finally { usePack("zh", null); }
    // no "{n} games" left without its singular, in any English string
    const bad = [];
    for (const [d, dict] of Object.entries({ play: uiEn.play, learn: uiEn.learn, explain: uiEn.explain })) {
      for (const [k, v] of Object.entries(dict)) {
        if (typeof v !== "string") continue;
        for (const m of v.matchAll(/\{(\d)\} (games|moves|skills|positions|times|items|cards|days|puzzles)\b/g)) bad.push(d + "." + k + ": " + v);
      }
    }
    a.deepEqual(bad, [], "counted nouns in English take {n:one|many}");
    // the plural syntax is English's: Chinese and Japanese have none
    a.ok(!Object.values(learnZh).some((v) => typeof v === "string" && /\{\d:/.test(v)), "no plural forms in Chinese");
  });

  // --- the settings, written at once --------------------------------------------------------------
  test("db: a settings change is written at once; moves still wait for their batch", async (a) => {
    const writes = [];
    const base = memoryBackend({});
    const backend = { ...base, write: (ops) => { writes.push(ops.map((o) => o.value && o.value.type).filter(Boolean)); return base.write(ops); } };
    const queued = [];
    const db = await createDb(backend, { schedule: (fn) => queued.push(fn) });
    const st = createStore({ play: initialPlay, settings: SETTINGS_DEFAULT }, { ...playActions, ...settingsActions });
    persist(st, db);
    st.dispatch("play.new", { id: "g", mode: "pvp" });
    st.dispatch("play.move", { uci: "e2e4" });
    a.equal(writes.length, 0, "moves: batched (nothing written before the scheduled flush)");
    st.dispatch("settings.set", { key: "lang", value: "en" });
    await Promise.resolve();
    a.ok(writes.some((w) => w.includes("settings.set")), "the settings change is written without waiting (" + JSON.stringify(writes) + ")");
    for (const f of queued) f();
    await db.close();
  });
}
