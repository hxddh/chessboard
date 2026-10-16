/**
 * Sparring personalities and the opponents: the ladder, the personas, the
 * engine's clock and the measured strength of the rungs that ship.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { assert, root, ctx, Chess, loadModule, allAppSource, srcOf } from "./harness.mjs";

export async function run() {
  // Sparring personalities. `pick` is pure — candidates in, one of them out —
  // so the whole contract is testable without ever starting the engine.
  {
    loadModule(ctx, "src/web/js/persona.js");
    const P = ctx.ChessPersona;
    assert(P && typeof P.pick === "function", "persona module loaded");
    assert(P.IDS[0] === "off", "\"off\" is the first personality, i.e. the default");

    // A knight on f3 with a free pawn on e5 to take, or quiet developing moves.
    const fen = "rnbqkb1r/pppp1ppp/5n2/4p3/8/5N2/PPPPPPPP/RNBQKB1R w KQkq - 0 1";
    const cands = [
      { uci: "d2d4", score: 30 },     // best, quiet
      { uci: "f3e5", score: -60 },    // grabs the pawn, slightly worse
      { uci: "b1c3", score: 10 },     // develops a knight
      { uci: "f1c4", score: 5 },      // develops a bishop
      { uci: "d1e2", score: -20 },    // early queen move
    ];
    assert(P.pick(fen, cands, "greedy", Chess) === "f3e5",
      "the greedy personality takes the pawn");
    assert(["b1c3", "f1c4"].includes(P.pick(fen, cands, "principled", Chess)),
      "the by-the-book personality develops a piece");
    assert(P.pick(fen, cands, "off", Chess) === null,
      "\"off\" leaves the engine's own choice alone");

    // The safety rails, which are the whole reason a personality is playable.
    const wild = [{ uci: "d2d4", score: 30 }, { uci: "f3e5", score: -900 }];
    assert(P.pick(fen, wild, "greedy", Chess) !== "f3e5",
      "no personality follows a capture that is far outside its slack");
    const mating = [{ uci: "d2d4", score: 99999 }, { uci: "f3e5", score: 10 }];
    assert(P.pick(fen, mating, "greedy", Chess) === null,
      "a forced mate is never traded away for a capture");
    assert(P.pick(fen, [{ uci: "d2d4", score: 30 }], "greedy", Chess) === null,
      "one candidate is no choice at all");
    // v8-0-plan B4: given the rung's own choice, a style picks nothing better
    // than it — red before B4: a styled UCI_Elo rung played far above itself
    {
      const own = [{ uci: "d2d4", score: 30 }, { uci: "b1c3", score: 10 }, { uci: "f1c4", score: 5 }, { uci: "d1e2", score: -20 }];
      const got = P.pick(fen, own, "principled", Chess, -20);
      assert(got === null || got === "d1e2", "B4: a style never picks a better move than the rung's own (" + got + ")");
      assert(["b1c3", "f1c4"].includes(P.pick(fen, own, "principled", Chess, 10)), "B4: …and still has a say among moves as good as it");
    }

    // Every personality must be reachable from the panel and named in every
    // language — a style you cannot select is a style that does not exist.
    const htmlP = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
    const inMarkup = [...htmlP.matchAll(/data-persona="([a-z]+)"/g)].map((m) => m[1]);
    assert(P.IDS.every((id) => inMarkup.includes(id)) && inMarkup.length === P.IDS.length,
      "every personality has a button (" + inMarkup.join(", ") + ")");
    loadModule(ctx, "src/web/js/i18n.js");
    const dict = ctx.ChessI18n.DICT;
    for (const lang of Object.keys(dict)) {
      const missing = P.IDS.filter((id) => !("persona." + id in dict[lang]));
      assert(missing.length === 0, lang + " names every personality");
    }
  }

  // v8-0-plan B4: the opponents — the ladder, the personas, the engine's clock
  // plan, when it resigns and offers a draw, and the player's engine-game
  // rating. opponents.js and time-control.js are pure, so all of it is checked
  // here without an engine; scripts/test-ladder.mjs is the measurement.
  {
    loadModule(ctx, "src/web/js/engine.js");
    loadModule(ctx, "src/web/js/opponents.js");
    loadModule(ctx, "src/web/js/time-control.js");
    loadModule(ctx, "src/web/js/icons.js");
    const O = ctx.Opponents, TC = ctx.TimeControl, E = ctx.ChessEngine;
    assert(O && TC && E, "B4: opponents.js and time-control.js load");

    // the ladder: one list, and it is the app's
    const appIds = /const DIFF_IDS = \[([^\]]*)\]/.exec(allAppSource);
    const appList = appIds ? [...appIds[1].matchAll(/"([a-z]+)"/g)].map((m) => m[1]) : [];
    assert(JSON.stringify(appList) === JSON.stringify(O.LEVELS),
      "B4: the ladder in opponents.js is app.js's DIFF_IDS, rung for rung (" + O.LEVELS.join(",") + ")");
    assert(O.LEVELS.every((id) => E.TIERS[id]), "B4: every rung has engine settings");
    const between = O.LEVELS.slice(O.LEVELS.indexOf("casual") + 1, O.LEVELS.indexOf("easy"));
    assert(between.length >= 3 && between.length <= 5 && between.every((id) => E.TIERS[id].winT > 0 && E.TIERS[id].depth),
      "B4: 3–5 rungs between 休闲 and 初级 (v8-1-plan T1 added one), each depth-limited and sampling by win-chance loss (" + between.join(",") + ")");
    // v8-1-plan T1: from 初级 up, Stockfish's own UCI_Elo searched to the depth
    // it picks its move at (1 + its Skill level: deeper changes nothing but the
    // time), then node-limited full strength, then 不限档
    {
      const up = O.LEVELS.slice(O.LEVELS.indexOf("easy"), O.LEVELS.indexOf("extreme"));
      const lvl = (elo) => { const e = (elo - 1320) / 1870; return Math.min(19, Math.max(0, ((37.2473 * e - 40.8525) * e + 22.2944) * e - 0.311438)); };
      const elo = up.filter((id) => E.TIERS[id].elo != null), nodes = up.filter((id) => E.TIERS[id].nodes);
      // (the plan expected 8–10 between 初级 and 不限档 and 1–2 by nodes; the
      // games asked for 13, four by nodes — docs/v8-1-plan.md §9 M3)
      assert(up.length >= 8 && elo.length + nodes.length === up.length && nodes.length >= 1 &&
        up.indexOf(nodes[0]) === elo.length && nodes.every((id, i) => i === 0 || E.TIERS[id].nodes > E.TIERS[nodes[i - 1]].nodes),
        "T1: from 初级 up to 不限档, UCI_Elo rungs, then node-limited ones in growing counts (" + up.join(",") + ")");
      const off = elo.filter((id) => E.TIERS[id].depth !== 1 + Math.floor(lvl(E.TIERS[id].elo)) || !E.TIERS[id].minMs);
      assert(off.length === 0, "T1: each UCI_Elo rung searches to its pick depth, and holds its reply like a depth rung" + (off.length ? " — " + off : ""));
      assert(E.searchCmd({ depth: 3 }, Math.random) === "go depth 3" && E.searchCmd({ movetime: 700 }, Math.random) === "go movetime 700" &&
        E.searchCmd({ nodes: 10000 }, () => 0) === "go nodes 8500" && E.searchCmd({ nodes: 10000 }, () => 1) === "go nodes 11500" &&
        // (no floor: analysis's nodesFor floor of 1000 once turned a 400-node rung into a fixed 1000)
        E.searchCmd({ nodes: 400 }, () => 0.5) === "go nodes 400",
        "T1: a node rung's count is drawn ±15% a move, so the same moves do not get the same game");
    }
    assert(between.every((id) => E.TIERS[id].skill <= 5), "B4: …at a low Skill Level");
    {
      assert(O.LEVELS.every((id) => typeof O.EN_NAME[id] === "string"), "B4: every rung has a PGN name");
    }

    // the win-chance draw: the best line most often, a blunder rarely, and a
    // forced mate never thrown away
    {
      let seed = 7;
      const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
      const list = [{ uci: "a2a3", score: 20 }, { uci: "b2b3", score: 0 }, { uci: "c2c3", score: -40 }, { uci: "d2d4", score: -600 }];
      const tier = { winT: 8 };
      const tally = {};
      for (let i = 0; i < 2000; i++) { const u = E.pickCandidate(list, tier, rng); tally[u] = (tally[u] || 0) + 1; }
      assert(tally.a2a3 > tally.b2b3 && tally.b2b3 > (tally.c2c3 || 0) && (tally.d2d4 || 0) < 20,
        "B4: winT sampling favours the best, and a piece-losing move is rare (" + JSON.stringify(tally) + ")");
      assert(E.pickCandidate([{ uci: "a2a3", score: 99990 }, { uci: "b2b3", score: 0 }], tier, rng) === "a2a3",
        "B4: …and never trades a found mate away");
      // a style chooses only among moves as good as the one drawn
      const lean = [0, 0, 500, 900];
      const styled = {};
      for (let i = 0; i < 2000; i++) { const u = E.pickCandidate(list, tier, rng, lean); styled[u] = (styled[u] || 0) + 1; }
      assert((styled.d2d4 || 0) < 20,
        "B4: a style's lean does not reach a move far worse than the one drawn (" + JSON.stringify(styled) + ")");
      assert(Math.abs(E.winPct(0) - 50) < 1e-9 && E.winPct(300) > 70 && E.winPct(-300) < 30, "B4: win chance is Lichess's curve");
    }

    // personas: one per rung (v8-1-plan T1: 8–12 until the ladder was re-stepped), a style persona.js knows, an icon icons.js draws
    assert(O.PERSONAS.length === O.LEVELS.length, "B4: a persona for every rung (" + O.PERSONAS.length + ")");
    // 9.0 S2: the dialog shows eight personas, the ladder around the pick —
    // in ladder order, so a window of the list is a stretch of the ladder
    assert(O.PERSONAS.every((p, i) => i === 0 || O.LEVELS.indexOf(p.level) > O.LEVELS.indexOf(O.PERSONAS[i - 1].level)),
      "S2: the personas run in ladder order, so eight in a row are neighbours");
    assert(/const SHOWN = 8;/.test(fs.readFileSync(path.join(root, "src/web/js/opponents-ui.js"), "utf8")),
      "S2: the dialog shows eight opponent cards");
    assert(new Set(O.PERSONAS.map((p) => p.level)).size === O.PERSONAS.length && O.PERSONAS.every((p) => O.LEVELS.includes(p.level)),
      "B4: each persona is its own rung of the ladder");
    assert(O.PERSONAS.every((p) => ctx.ChessPersona.IDS.includes(p.style)), "B4: each persona's style is one persona.js plays");
    assert(new Set(O.PERSONAS.map((p) => p.icon)).size === O.PERSONAS.length &&
      O.PERSONAS.every((p) => ctx.ChessIcons.NAMES ? ctx.ChessIcons.NAMES.includes(p.icon) : /\S/.test(p.icon)),
      "B4: every persona has its own avatar icon");
    {
      const icons = fs.readFileSync(path.join(root, "src/web/js/icons.js"), "utf8");
      const missing = O.PERSONAS.filter((p) => !icons.includes('"' + p.icon + '": ['));
      assert(missing.length === 0, "B4: …drawn from icons.js's own shapes" + (missing.length ? " — missing " + missing.map((p) => p.icon) : ""));
    }
    assert(O.personaFor("easy", "off") && O.personaFor("easy", "off").level === "easy" && O.personaFor("easy", "greedy") === null,
      "B4: a (rung, style) pair is a persona or a combination of one's own");
    loadModule(ctx, "src/web/js/i18n.js");
    // the personas' words are content (opponents-lines.js, in the chunk), held
    // to what the dictionary checks hold keys to
    loadModule(ctx, "src/web/js/opponents-lines.js");
    const LINES = ctx.OP_LINES;
    assert(JSON.stringify(Object.keys(LINES).sort()) === JSON.stringify(Object.keys(ctx.ChessI18n.DICT).sort()),
      "B4: the persona lines come in every interface language (" + Object.keys(LINES) + ")");
    for (const lang of Object.keys(LINES)) {
      const T = LINES[lang];
      // the end-of-game line is the persona's own or the shared `bye`
      const gaps = O.PERSONAS.filter((p) => !T[p.id] || !T[p.id].name || !T[p.id].hello).map((p) => p.id)
        .concat(["say", "bye", "noOpening"].filter((k) => !T[k]));
      assert(gaps.length === 0, "B4: " + lang + " names every persona and gives it both lines" + (gaps.length ? " — " + gaps.slice(0, 4) : ""));
      if (lang !== "zh-CN") {
        const same = O.PERSONAS.filter((p) => p.id !== "fish" && T[p.id].hello === LINES["zh-CN"][p.id].hello);
        assert(same.length === 0, "B4: " + lang + " persona lines are translated");
      }
      if (lang === "zh-CN") {
        const half = Object.values(T).flatMap((v) => (typeof v === "string" ? [v] : [v.hello, v.bye || ""])).filter((x) => /[\u4e00-\u9fff][,;:?!]|[,;:?!][\u4e00-\u9fff]/.test(x));
        assert(half.length === 0, "B4: the Chinese persona lines use full-width punctuation" + (half.length ? " — " + half[0] : ""));
      }
      // 7.8's rule: facts, not feelings — no line judges the player or has the
      // machine feel something about the game
      const JUDGE = lang === "en" ? /\b(good|great|nice|well played|brilliant|bad|poor|terrible|happy|sad|sorry|enjoy|fun|love|hate|luck)\b/i
        : lang === "ja" ? /(すごい|素晴らし|上手|下手|残念|楽しい|嬉しい|悲しい|ごめん|頑張)/ : /(好棋|漂亮|厉害|精彩|可惜|遗憾|开心|高兴|难过|抱歉|加油|运气|真棒|太好)/;
      const judged = O.PERSONAS.flatMap((p) => [T[p.id].hello, T[p.id].bye]).concat([T.bye]).filter((s) => JUDGE.test(s || ""));
      assert(judged.length === 0, "B4: " + lang + " persona lines state facts only (7.8)" + (judged.length ? " — " + judged[0] : ""));
    }

    // --- v9-0-plan S6: the interface speaks the player's words ---------------
    // 8.4 told the player 「Stockfish 限制在 UCI_Elo 1700」, 「置换表」,
    // 「MultiPV 6」, 「（120ms/步）」, 「结论已查 Syzygy 残局库核对」, 「7.6 以前的
    // 合成音」 and 「1500?」 — engine settings, version numbers and a statistic's
    // error bar, where the player wanted to know what the thing does for them.
    // Nothing user-facing — the three dictionaries, the persona lines, the
    // fallback text and tooltips in index.html — may say these again. The
    // register is for a key in the 高级 (engine) settings group that truly needs
    // one of the words in its tooltip; it may only shrink (S6 left it empty).
    {
      const TECH = /UCI_Elo|UCI_LimitStrength|MultiPV|Syzygy|ms\/步|ms\/move|\d\s?ms\b|毫秒|ミリ秒|\bnodes?\b|节点|ノード|置换表|置換表|hash table|ハッシュ表|\d\.\d+\s?(以前|之前|より前)|before \d\.\d|实测|実測|measured:|一半重合|agree about half|一致するのは約半分|±\{\d\}/i;
      // v10-0-plan E5: the register S6 emptied is gone — none is the rule
      const leaks = [];
      for (const [lang, dict] of Object.entries(ctx.ChessI18n.DICT)) {
        for (const [k, v] of Object.entries(dict)) {
          if (!TECH.test(v)) continue;
          leaks.push(lang + " " + k + ": " + v);
        }
      }
      for (const [lang, T] of Object.entries(LINES)) {
        for (const p of O.PERSONAS) for (const line of ["hello", "bye"]) {
          if (TECH.test(T[p.id][line] || "")) leaks.push(lang + " op." + p.id + "." + line + ": " + T[p.id][line]);
        }
      }
      // index.html's own text and tooltips, outside comments and scripts
      const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8")
        .replace(/<!--[\s\S]*?-->/g, "").replace(/<script[\s\S]*?<\/script>/g, "").replace(/<style[\s\S]*?<\/style>/g, "");
      for (const m of html.matchAll(/\s(?:title|aria-label|placeholder)="([^"]*)"|>([^<>]+)</g)) {
        const s = m[1] != null ? m[1] : m[2];
        if (TECH.test(s)) leaks.push("index.html: " + s.trim());
      }
      for (const l of leaks) console.error("  implementation detail on screen — " + l);
      assert(leaks.length === 0, "S6: no engine settings, version numbers or error bars in the interface's words" + (leaks.length ? " — " + leaks.length + " leak(s)" : ""));

      // one thing, one number: a persona's lines and a rung's tooltip quote
      // the rating the card shows (opponents.js, measured), never another
      const TIP_OF = { easy: "tip.diffEasy", normal: "tip.diffNormal", hard: "tip.diffHard", casual: "tip.casual" };
      const wrong = [];
      for (const p of O.PERSONAS) {
        const want = String(O.ratingOf(p.level));
        const texts = Object.entries(LINES).flatMap(([lang, T]) => [[lang + " op." + p.id + ".hello", T[p.id].hello], [lang + " op." + p.id + ".bye", T[p.id].bye || ""]])
          .concat(Object.entries(ctx.ChessI18n.DICT).map(([lang, d]) => { const k = TIP_OF[p.level] || "tip.diff." + p.level; return [lang + " " + k, d[k] || ""]; }));
        for (const [where, s] of texts) {
          for (const m of s.replace(/(\d),(\d{3})/g, "$1$2").matchAll(/(?<![\d.])\d{3,4}(?![\d.])/g)) {
            if (m[0] !== want) wrong.push(where + " says " + m[0] + ", the card says " + want);
          }
        }
      }
      for (const w of wrong) console.error("  " + w);
      assert(wrong.length === 0, "S6: every rating a persona line or rung tooltip quotes is the one on its card" + (wrong.length ? " — " + wrong.length + " differ" : ""));

      // a provisional rating says so in words; it is not a number with a 「?」
      const provSrc = ["src/web/js/opponents-ui.js", "src/web/js/trainer/puzzle-rating.js", "src/web/js/trainer/puzzle-modes.js",
        "src/web/js/trainer/visual-modes.js", "src/web/js/trainer/puzzles.js"]
        .map((f) => [f, fs.readFileSync(path.join(root, f), "utf8")]);
      const marked = provSrc.filter(([, s]) => /(isProvisional\([^)]*\)|\.provisional|\.rd > \d+)\s*\?\s*"\?"/.test(s)).map(([f]) => f);
      assert(marked.length === 0, "S6: a provisional rating reads 定级中 / Provisional / 判定中, not 「1500?」" + (marked.length ? " — " + marked : ""));
      for (const [lang, want] of [["zh-CN", "定级中"], ["en", "Provisional"], ["ja", "判定中"]]) {
        assert(new RegExp(want, "i").test(ctx.ChessI18n.DICT[lang]["rating.prov"] || ""), "S6: " + lang + " calls a provisional rating " + want);
      }
      // the two ratings have one name each (M0): 对局等级分 and 谜题等级分
      const NAMES = { "zh-CN": ["对局等级分", "谜题等级分", /评级/], en: ["Game rating", "Puzzle rating", /(?!)/], ja: ["対局レーティング", "パズルレーティング", /パズルのレーティング|問題レーティング|エンジン戦のレーティング/] };
      for (const [lang, [game, puzzle, old]] of Object.entries(NAMES)) {
        const d = ctx.ChessI18n.DICT[lang];
        assert(d["me.gameRating"] === game && d["rec.rating"] === puzzle, "S6: " + lang + " names the ratings " + game + " / " + puzzle + " (" + d["me.gameRating"] + " / " + d["rec.rating"] + ")");
        const stale = Object.entries(d).filter(([, v]) => old.test(v)).map(([k]) => k);
        assert(stale.length === 0, "S6: " + lang + " has no other name for a rating left" + (stale.length ? " — " + stale.slice(0, 5) : ""));
      }
      // and the strongest rung has one name: its label is what the endgame
      // camp calls its engine, and what index.html's fallback text says
      for (const [lang, d] of Object.entries(ctx.ChessI18n.DICT)) {
        assert(d["eg.engine"].includes(d["diff.extreme"]), "S6: " + lang + " endgame engine is the top rung by name (" + d["eg.engine"] + " / " + d["diff.extreme"] + ")");
        // 8.4's achievement called it a fourth thing: 「极限」 / "Max level" / 「最強」
        assert(d["ach.extreme-win.d"].includes(d["diff.extreme"]), "S6: " + lang + " achievement names the top rung as the button does (" + d["ach.extreme-win.d"] + ")");
      }

    }

    // the clock: presets, a custom control in its own id, and nothing else
    assert(TC.parse("15+10").base === 900 && TC.parse("15+10").inc === 10 && TC.parse("30").base === 1800 && TC.parse("30").inc === 0,
      "B4: 15+10 and 30+0 are presets");
    assert(TC.parse("c20+5").base === 1200 && TC.parse("c20+5").inc === 5 && TC.isCustom("c20+5") && !TC.isCustom("5+3"),
      "B4: a custom control is c<minutes>+<increment>");
    assert(TC.parse("c0+5") === null && TC.parse("c181+0") === null && TC.parse("c10+61") === null && TC.parse("off") === null && TC.parse("toString") === null,
      "B4: …inside its bounds, and nothing else parses");
    assert(TC.customId(999, -3) === "c180+0" && TC.customId("7", "2") === "c7+2",
      "B4: custom ids are clamped into bounds");

    // the engine on a clock: search capped at the rung's calibrated movetime,
    // pace growing with the clock up to its own cap, never past a 20th of it
    {
      const easy = E.TIERS.extreme; // (v8-1-plan T1: the one movetime rung left)
      const blitz = O.thinkPlan(easy, 180000, 0), rapid = O.thinkPlan(easy, 1800000, 0), low = O.thinkPlan(easy, 4000, 0);
      assert(blitz.search <= easy.movetime && rapid.search === easy.movetime,
        "B4: a long control does not search past the rung's calibrated movetime (" + blitz.search + " / " + rapid.search + ")");
      assert(rapid.pace > blitz.pace && rapid.pace <= O.PACE_CAP_MS, "B4: …but its pace grows with the clock, up to the cap (" + blitz.pace + " → " + rapid.pace + ")");
      assert(low.search < easy.movetime && low.pace <= 4000 / 20, "B4: short of time it searches less and does not stall (" + low.search + " / " + low.pace + ")");
      assert(O.thinkPlan(easy, 10000, 10000).search > O.thinkPlan(easy, 10000, 0).search, "B4: the increment counts");
      const d = O.thinkPlan(E.TIERS.beginner, 600000, 0);
      assert(d.search === 0 && d.pace > 0, "B4: a depth rung is not given a movetime, only a pace");
      // M3 评审: …but a ceiling from the clock, so a deep rung on a nearly flagged 1+0 cannot outlast it
      const flag = O.thinkPlan(E.TIERS.master, 2000, 0);
      assert(flag.ceil > 0 && flag.ceil <= 2000 / 40 + 1 && flag.pace <= 2000 / 20 && O.thinkPlan(E.TIERS.extreme, 2000, 0).ceil === 0,
        "M3: a depth rung with 2 s left is bounded by the clock (" + JSON.stringify(flag) + ")");
      // v8-1-plan T1: a node rung's count is its calibrated search, in engine.js's own nodes per ms
      const nr = { nodes: 90000 };
      assert(O.NODES_PER_MS === E.NODES_PER_MS && O.thinkPlan(nr, 1800000, 0).search === 200 && O.thinkPlan(nr, 4000, 0).search < 200,
        "T1: a node rung searches its count on a long clock and fewer nodes short of time");
    }

    // resigning and offering a draw
    assert(!O.shouldResign([-1200, -1200, -1200]), "B4: no resignation in the first moves");
    const quiet = new Array(10).fill(30);
    assert(O.shouldResign(quiet.concat([-1100, -1500, -2000])), "B4: resigns after three moves at −10 or worse");
    assert(!O.shouldResign(quiet.concat([-1100, -300, -2000])), "B4: …sustained, not a single dip");
    assert(O.shouldResign(quiet.concat([-99990, -99992])), "B4: …or two moves into a mate against it");
    const level = new Array(12).fill(5);
    assert(O.shouldOfferDraw(level, 80, 12, null), "B4: offers a draw in a dead-level, quiet ending");
    assert(!O.shouldOfferDraw(level, 40, 12, null) && !O.shouldOfferDraw(level, 80, 2, null) && !O.shouldOfferDraw(level.concat([90]), 80, 12, null),
      "B4: …not in the opening, not while things still change, not when it is ahead");
    assert(!O.shouldOfferDraw(level, 80, 12, 70) && O.shouldOfferDraw(level, 100, 12, 70), "B4: …and not again straight after a decline");

    // your rating: Glicko-2 against the rungs, apart from the puzzle one
    {
      const stats = { v: 2, games: [] };
      const now = Date.UTC(2026, 8, 1);
      const recA = { id: "a", t: now, diff: "normal", result: "win" };
      const f1 = O.fileRating(stats, recA, now);
      assert(f1 && f1.before === null && f1.after.r > 1500 && stats.rating === f1.after, "B4: a first win moves a newcomer up, stored on the stats record");
      const rec = { id: "b", t: now + 1000, diff: "normal", result: "loss" };
      const f2 = O.fileRating(stats, rec, now + 1000);
      assert(f2.after.r < f1.after.r && rec.rb === Math.round(f1.after.r) && rec.ra === Math.round(f2.after.r) && Number.isFinite(rec.perf),
        "B4: each game carries rb / ra / perf (ra is what 「我的」 draws: progress-metrics.js ratingAfter)");
      const replay = O.rateHistory([recA, rec]);
      assert(Math.round(replay.r) === Math.round(f2.after.r), "B4: a profile from before B4 gets its rating by replaying its games");
      assert(recA.lad === O.LADDER && rec.lad === O.LADDER, "T1: a game filed now says which ladder it was rated against");
      // v8-1-plan T1: an 8.0 profile — records with no `lad`, on the twelve
      // 8.0 rungs — replays to the rating 8.0's own code gave it (computed on
      // 1972e19, before the ladder was re-stepped): the new ratings of the
      // same ids do not reach back into games played against the old ones
      {
        const ids80 = ["beginner", "casual", "learner", "improver", "steady", "solid", "easy", "easyplus", "normalminus", "normal", "hard", "extreme"];
        const res = ["win", "loss", "draw", "win", "loss"];
        const t0 = Date.UTC(2026, 5, 1);
        const old = [];
        for (let i = 0; i < 36; i++) old.push({ id: "g" + i, t: t0 + i * 86400000 * (i % 3 === 0 ? 3 : 1), diff: ids80[(i * 5) % 12], result: res[i % 5] });
        const r80 = O.rateHistory(old);
        assert(Math.abs(r80.r - 1228.7012797742468) < 1e-6 && Math.abs(r80.rd - 179.47270731277916) < 1e-6 &&
          Math.abs(r80.vol - 0.06009909724615745) < 1e-9 && r80.n === 36,
          "T1: an 8.0 profile's games replay to the same Glicko-2 rating as on 8.0 (" + (r80 && r80.r) + ")");
        assert(O.performance(old.slice(-10).map((g) => ({ level: g.diff, result: g.result }))) === 1309,
          "T1: …and the same performance rating over its last ten");
        assert(ids80.every((id) => O.opponentOf(id).r === O.RATING_80[id]) &&
          O.LEVELS.every((id) => O.opponentOf(id, O.LADDER).r === O.RATING[id]),
          "T1: an unmarked record is rated against 8.0's ladder, a marked one against today's");
        const replayed = O.rateHistory(old.concat([Object.assign({}, old[0], { id: "new", t: t0 + 400 * 86400000, lad: O.LADDER })]));
        assert(replayed.n === 37, "T1: old and new records replay together");
      }
      assert(O.ratingOfStats({ v: 2, games: [{ t: now, diff: "normal", result: "win" }] }).r > 1500, "B4: …when it has none stored");
      const s1700 = O.ratingOf("normal");
      assert(O.performance([{ level: "normal", result: "draw" }]) === s1700, "B4: performance of a draw is the opponent's rating");
      assert(O.performance([{ level: "normal", result: "win" }]) === s1700 + 400, "B4: …and a perfect score is capped at +400");
      const five = (r, level) => new Array(5).fill({ level, result: r });
      assert(O.advice(five("win", "normal"), "normal", { r: 1800, rd: 60 }) === "up" &&
        O.advice(five("loss", "normal"), "normal", { r: 1500, rd: 60 }) === "down" &&
        O.advice(five("win", "normal"), "normal", { r: 1400, rd: 60 }) === null &&
        O.advice(five("win", "normal").slice(1), "normal", null) === null,
        "B4: move up after 70%+ over five, down after 25% or less — when the rating agrees");
      assert(O.neighbour("normal", "up").level === O.LEVELS[O.LEVELS.indexOf("normal") + 1], "B4: …to the persona one rung over");
      // Codex #89: five wins at one rung, each separated by two games at others,
      // still earn the move-up advice — the rung's own history, not the last ten overall
      {
        const other = O.LEVELS.find((l) => l !== "normal");
        const mix = { v: 2, games: [] };
        let t = now, last = null;
        for (let k = 0; k < 5; k++) {
          for (let j = 0; j < 2 && k > 0; j++) { const g = { id: "o" + k + j, t: ++t, diff: other, result: "draw" }; O.fileRating(mix, g, t); mix.games.push(g); }
          const g = { id: "n" + k, t: ++t, diff: "normal", result: "win" };
          mix.rating = { r: 1900, rd: 60, vol: 0.06, at: t, n: 20 };
          last = O.fileRating(mix, g, t);
          mix.games.push(g);
        }
        assert(last && last.advice === "up", "B4: five wins at a rung spread among other games still earn 「升一档」 (" + (last && last.advice) + ")");
      }
      // Codex #89: two games filed before the chunk landed are both in stats.games
      // when they are rated — each is rated from what came before it, in order
      {
        const g1 = { id: "q1", t: now, diff: "normal", result: "win" }, g2 = { id: "q2", t: now + 1000, diff: "normal", result: "loss" };
        const queued = { v: 2, games: [g1, g2] };
        O.fileRating(queued, g1, g1.t);
        O.fileRating(queued, g2, g2.t);
        const seq = { v: 2, games: [] };
        O.fileRating(seq, g1, g1.t); seq.games.push(g1);
        const g2b = Object.assign({}, g2);
        O.fileRating(seq, g2b, g2.t);
        assert(queued.rating.n === 2 && Math.round(queued.rating.r) === Math.round(seq.rating.r) && g1.ra > g2.ra,
          "B4: games rated late, in order, come out as if rated on time (n " + queued.rating.n + ")");
      }
      // #89 review: a game recorded unrated (its rung changed mid-game, or a
      // position set up by hand) moves nothing, filed or replayed
      {
        const st = { v: 2, games: [] };
        const file = (g) => { const f = O.fileRating(st, g, g.t); st.games.push(g); return f; };
        file({ id: "u1", t: now, diff: "normal", result: "win" });
        const kept = st.rating;
        const u = { id: "u2", t: now + 1000, diff: "extreme", result: "win", unrated: "changed" };
        const fu = file(u);
        file({ id: "u3", t: now + 2000, diff: "normal", result: "win" });
        const replay = O.rateHistory(st.games);
        assert(fu === null && u.ra === undefined && st.rating.n === 2 && kept.n === 1 && Math.round(replay.r) === Math.round(st.rating.r) && replay.n === 2,
          "B4: an unrated game is recorded but neither filed nor replayed into the rating (" + JSON.stringify({ fu: !!fu, n: st.rating.n, replay: replay.n }) + ")");
      }
    }

    // the app's hooks — few lines, each where the thing happens
    const mt = srcOf("maybeEngineTurn");
    assert(/OppUI\.plan\(engineSide\)/.test(mt), "B4: the engine's budget is opponents.js's clock plan");
    assert(/if \(OppUI\.resigns\(mv\)\) return;[\s\S]*gameMove\(/.test(mt), "B4: the engine resigns before it would play its move");
    assert(/OppUI\.maybeOffer\(\)/.test(mt), "B4: …and offers a draw after one");
    assert(/OppUI\.file\(s, rec/.test(srcOf("recordOutcome")) && /recordOutcome\(result, ""\)/.test(srcOf("recordGameIfOver")),
      "B4: every filed engine game goes through one door, which rates it");
    {
      const ui = fs.readFileSync(path.join(root, "src/web/js/opponents-ui.js"), "utf8");
      const paintBody = /function paint\(\) \{([\s\S]*?)\n  \}/.exec(ui);
      assert(paintBody && !/replaceChildren|innerHTML|appendChild|createElement/.test(paintBody[1]),
        "B4: the persona cards are relabelled in place, never rebuilt (7.6)");
      const html = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
      assert(/id="draw-offer"[^>]*hidden[\s\S]{0,300}id="draw-accept"[\s\S]{0,200}id="draw-decline"/.test(html),
        "B4: the draw offer is static markup, shown and hidden, not built");
      for (const tc of ["15+10", "30", "custom"]) assert(html.includes('data-tc="' + tc + '"'), "B4: the clock row offers " + tc);
    }

    // the ratings are the measured ones
    const lad = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8")).ladder;
    assert(!!lad && lad.rating, "B4: docs/measured.json holds the ladder run");
    if (lad && lad.rating) {
      const off = O.LEVELS.filter((id) => O.RATING[id] !== lad.rating[id] || O.RATING_SE[id] !== lad.ratingSe[id]);
      assert(off.length === 0, "B4: opponents.js's ratings are docs/measured.json's" + (off.length ? " — " + off.join(",") : ""));
      assert(O.LEVELS.every((id, i) => i === 0 || O.RATING[id] > O.RATING[O.LEVELS[i - 1]]), "B4: the ladder is monotone");
      assert(lad.rating.easy === 1320 && lad.rating.normal === 1700, "B4: anchored at 1320 and 1700");
      // the plan's acceptance (B4 for 新手 → 扎实, v8-1-plan T1 for the whole
      // ladder): every step one the stronger side scores 60–75% on, as fitted.
      // Each step's 95% interval is recorded beside it (`fitCi`, `h2hCi`) —
      // this holds the point estimate, which is what the games say; the
      // intervals say how sure (docs/v8-1-plan.md §9 M3).
      const outside = lad.adjacent.filter((a) => !(a.fitPct >= 60 && a.fitPct <= 75));
      assert(lad.adjacent.length === O.LEVELS.length - 1 && lad.adjacent.every((a, i) => a.lower === O.LEVELS[i] && a.upper === O.LEVELS[i + 1]) &&
        outside.length === 0 && lad.adjacent.every((a) => Array.isArray(a.fitCi) && a.fitCi[0] <= a.fitPct && a.fitPct <= a.fitCi[1]),
        "T1: 新手 → 不限档, every step 60–75%, each with its interval (" + outside.map((a) => a.upper + " " + a.fitPct + "%").join(", ") + ")");
      assert(Number.isFinite(lad.engineHours) && lad.played > 0 && lad.games === lad.played + lad.carried,
        "T1: the record says how many games were played for it, how many carried, and the engine time");
      const stale = O.LEVELS.filter((id) => JSON.stringify(lad.settings[id]) !== JSON.stringify(Object.assign({}, E.TIERS[id],
        { style: (O.PERSONAS.find((p) => p.level === id) || {}).style || "off" })));
      assert(stale.length === 0, "B4: the run measured the rungs that ship (re-run scripts/test-ladder.mjs)" + (stale.length ? " — " + stale.join(",") : ""));
    }
  }
}
