/**
 * README and docs: every number they quote, every measured figure, the
 * version heading, the release notes and version claims in comments.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import vm from "vm";
import { assert, root, ctx, loadModule, WEB_JS, webJsFiles, scriptFiles } from "./harness.mjs";

export async function run() {
  // README quotes its own numbers, and they drift. Through 1.20 it advertised
  // "57 课" in three places (the course had 67) and both "572 个界面键" and
  // "526 条" for a dictionary of 589 — and 1.20 was a release *about* the course
  // growing, which is exactly when nobody rereads the README. Each claim below
  // is checked against the thing it describes.
  {
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
    const lessons = ctx.CHESS_LESSONS.length;
    const keys = Object.keys(ctx.ChessI18n.DICT["zh-CN"]).length;
    const puzzles = ctx.CHESS_PUZZLES.length;
    const openings = new Set(ctx.CHESS_OPENINGS.map((o) => o[1])).size;
    // same filter app.js uses to decide a line is long enough to drill
    const drilledOpenings = ctx.CHESS_OPENINGS.filter((o) => o[2].split(" ").length >= 6).length;
    const minedPuzzles = (() => {
      const mctx = { console, Date, performance };
      mctx.globalThis = mctx; mctx.window = mctx;
      vm.createContext(mctx);
      loadModule(mctx, "src/web/js/puzzles-mined.js");
      return mctx.MINED_PUZZLES.length;
    })();
    const claims = [
      // v8-2-plan T1: the whole course — lessons.js plus the advanced part 3's chunk
      [/零基础 (\d+) 课/, lessons + ctx.CHESS_LESSONS_ADV_ZH.length, "the course size in the teaching row"],
      [/lessons-adv\.js\s+# 进阶课程第三部 (\d+) 课/, ctx.CHESS_LESSONS_ADV_ZH.length, "the advanced part 3 in the file map"],
      [/教学课程 (\d+) 课/, lessons, "the course size in the file map"],
      [/英文全译 (\d+) 课/, lessons, "the English course size"],
      [/(\d+) 个界面键三语齐备/, keys, "the interface-key count"],
      [/zh-CN \/ en \/ ja 各 (\d+) 条/, keys, "the dictionary size in the file map"],
      // Anchored to the file-map line. Unanchored, `/题库 (\d+) 题/` matched only
      // this line anyway — the 做题 row wrote 题库(**273 题**) with no space, so
      // the one number a reader meets first was the one number nobody checked.
      // It was also 战术 164 + 开局线路 109 added together and labelled 题, which
      // no count in the code equals. The row now states the two numbers it is
      // made of, and both are checked.
      [/js\/puzzles\.js\s+# 题库 (\d+) 题/, puzzles, "the puzzle count in the file map"],
      [/战术题库 (\d+) 题/, puzzles, "the tactics-puzzle count in the 做题 row"],
      [/开局线路 (\d+) 条/, drilledOpenings, "the drilled-opening count in the 做题 row"],
      [/开局题执白照谱背 \*\*(\d+) 条\*\*主流线路/, drilledOpenings, "the drilled-opening count in the drill sentence"],
      [/内置 \*\*(\d+) 条\*\* ECO 库/, ctx.CHESS_OPENINGS.length, "the ECO library size"],
      // 7.0: the mined set was the one content number README stated and nothing
      // checked — it still said 1023 after the depth-18 gate retired 39 of them.
      // Every other count on this page has had a guard since 6.1; this one was
      // simply missed.
      [/引擎自弈挖出 (\d+) 题/, minedPuzzles, "the mined-puzzle count in the 做题 row"],
    ];
    let stale = 0;
    for (const [re, actual, what] of claims) {
      const m = re.exec(readme);
      if (!m) { stale++; console.error("FAIL: README no longer states " + what + " (" + re + ")"); continue; }
      if (Number(m[1]) !== actual) {
        stale++;
        console.error("FAIL: README says " + m[1] + " for " + what + ", but it is " + actual);
      }
    }
    void openings;
    assert(stale === 0, "every count README quotes matches the code");

    // --- and every measured figure it quotes matches the run that produced it -
    // Defect 12: the handicap tiers' score rate lived in two places and agreed
    // in neither. README said 56% / 27% over 32 games; engine.js's comment said
    // 66% / 25% with no game count (the 24 games it names are the *previous*
    // calibration, worstBias 0.6). The script that produces the number printed
    // it and forgot. docs/measured.json is now where a run lands, and this is
    // what stops prose from drifting off it again.
    {
      const measured = JSON.parse(fs.readFileSync(path.join(root, "docs/measured.json"), "utf8"));
      // Comment prose wraps, and a `// ` at the start of the next line sits in
      // the middle of a sentence — flatten it so a phrase can be matched at all.
      //
      // `\r` goes first, and that is not defensive tidying. A Windows runner
      // checks out with CRLF, so flattening `…27% on\r\n    // \`casual\`…` leaves
      // the \r sitting mid-sentence where the break was, and every quoted phrase
      // that happens to span a line break stops matching. It cost the 2.0
      // release: ubuntu green, macOS green, Windows red on five assertions, and
      // the failure arrived after the tag had already been pushed. Read normalised
      // and the text is the same text on every platform.
      const normalise = (t) => t.replace(/\r\n/g, "\n");
      const readSrc = (rel) => normalise(fs.readFileSync(path.join(root, rel), "utf8"));
      const flattenSlashes = (t) => t.replace(/\n\s*\/\/ ?/g, " ");
      const engineSrc = readSrc("src/web/js/engine.js");
      const engineFlat = flattenSlashes(engineSrc);
      // The regression itself, reproduced on whatever platform this is running
      // on: flatten a CRLF copy of the same file and it must come out as the
      // same text. Asserting "engineFlat has no \r" would pass trivially on a
      // LF checkout — which is precisely how the bug reached a release runner
      // with ubuntu and macOS green.
      {
        // Run the real path — normalise() then the real flatten — over a CRLF
        // copy. Drop the normalisation and this differs, on any platform.
        const asCrlf = engineSrc.replace(/\n/g, "\r\n");
        assert(flattenSlashes(normalise(asCrlf)) === engineFlat,
          "the measured-figure checks read the same text on a CRLF checkout as on a LF one");
      }

      const nov = measured.noviceScore && measured.noviceScore.tiers;
      let off = 0;
      const check = (where, text, re, actual, what) => {
        const m = re.exec(text);
        if (!m) { off++; console.error("FAIL: " + where + " no longer states " + what); return; }
        if (Number(m[1]) !== actual) {
          off++;
          console.error("FAIL: " + where + " says " + m[1] + " for " + what + ", measured is " + actual);
        }
      };
      assert(!!nov && !!nov.beginner && !!nov.casual,
        "docs/measured.json holds a novice-score run for both handicap tiers");
      if (nov && nov.beginner && nov.casual) {
        // the `careful` bot is the one both texts quote — a bot that only avoids
        // dropping a piece to an immediate recapture, i.e. about what a raw
        // beginner sees
        // 7.1.1: the game count is no longer baked into this pattern. It read
        // /32 盘对新手得分率/ — so the moment the count changed, the guard
        // stopped matching and reported "README no longer states it" instead of
        // the mismatch it exists to find. A guard that hard-codes the number it
        // is checking around is a guard with an expiry date.
        check("README", readme, /盘对新手得分率 \*\*(\d+)%\*\*/, nov.beginner.careful.scorePct, "the beginner score rate");
        check("README", readme, /对休闲 \*\*(\d+)%\*\*/, nov.casual.careful.scorePct, "the casual score rate");
        check("engine.js", engineFlat, /now scores (\d+)% here/, nov.beginner.careful.scorePct, "the beginner score rate");
        check("engine.js", engineFlat, /and (\d+)% on `casual`/, nov.casual.careful.scorePct, "the casual score rate");
        // anchored past the `casual` clause: the *other* "24 games" in this
        // comment is the previous calibration's, and it is meant to stay
        check("engine.js", engineFlat, /on `casual` over (\d+) games/, nov.beginner.careful.games, "the game count");
        check("README", readme, /机器人，(\d+) 盘对新手/, nov.beginner.careful.games, "the game count");
        // the settings the run used must still be the settings that ship, or the
        // figure describes a tier that no longer exists
        for (const [tier, rec] of [["beginner", nov.beginner], ["casual", nov.casual]]) {
          const row = new RegExp("\\n\\s*" + tier + ": \\{([^}]*)\\}").exec(engineSrc);
          for (const [k, v] of Object.entries(rec.settings || {})) {
            const got = new RegExp(k + ":\\s*([\\d.]+)").exec(row ? row[1] : "");
            if (!got || Number(got[1]) !== v) {
              off++;
              console.error("FAIL: " + tier + "." + k + " is " + (got && got[1]) +
                " but the recorded run used " + v + " — re-record");
            }
          }
        }
      }
      // the ACPL side of the same rule
      const acpl = measured.tierAcpl && measured.tierAcpl.tiers;
      assert(!!acpl && !!acpl.beginner, "docs/measured.json holds an ACPL run");
      if (acpl && acpl.beginner) {
        const b = acpl.beginner;
        check("engine.js", engineFlat, /Measured: (\d+) ACPL/, b.acpl, "the beginner ACPL");
        check("engine.js", engineFlat, /mistake in (\d+)% of moves/, Math.round((b.serious / b.n) * 100), "the beginner blunder rate");
        check("engine.js", engineFlat, /median loss (\d+)/, b.median, "the beginner median loss");
      }
      assert(off === 0, "README and engine.js quote docs/measured.json, and it describes the tiers that ship");

      // P6 / 缺陷 23. The annotation cut-offs were measured against the quick
      // scan's own noise and deliberately left where they are — which only means
      // anything while the numbers that were measured are the numbers that ship.
      // Move one of them and this fails until the scan is re-run, because the
      // recorded agreement rates describe 50/100/300 and nothing else.
      {
        // 7.1 (v7-1-plan §3.1): §6.4's acceptance, and the prose that quotes it.
        // The same rule as the tier figures — a re-record has to drag the
        // documents with it, or the number in the release notes is a number
        // nobody ran.
        {
          const mc = measured.motifCoverage;
          assert(!!mc && Number.isFinite(mc.explainedPct),
            "docs/measured.json holds a motif-coverage run (§6.4 的验收)");
          if (mc) {
            assert(mc.games === 28 && mc.plies === 1320,
              "覆盖率是在那 28 局 1320 半着的语料上量的，不是别的样本 (" + mc.games + "/" + mc.plies + ")");
            assert(typeof mc.caveat === "string" && /正确性没有人工抽样核对过/.test(mc.caveat),
              "记录里带着「只量了覆盖率」那句话 —— 数字单独流传出去就是在骗人");
            for (const rel of ["README.md", ".github/release-notes/v7.1.0.md", "docs/v7-1-plan.md"]) {
              const text = fs.readFileSync(path.join(root, rel), "utf8");
              if (!/母题解释|覆盖率/.test(text)) continue;
              const nums = [...text.matchAll(/(\d+(?:\.\d+)?)%\s*的失误/g)].map((x) => Number(x[1]));
              for (const n of nums) {
                assert(n === mc.explainedPct,
                  rel + " 引的覆盖率就是量出来的那个 (" + n + " vs " + mc.explainedPct + ")");
              }
            }
          }
        }
        // 7.1.1: the novice bands must be the recorded mean ± 3σ.
        //
        // This is the guard the repo did not have, and its absence cost a
        // release. 7.0 swapped the engine; docs/measured.json's noviceScore
        // still described Stockfish 18; the bands in test-novice.mjs were
        // drawn around those stale figures; and v7.1.0 failed its release gate
        // on a tier that had not changed at all. Nothing anywhere connected
        // "the engine moved" to "this calibration is now fiction".
        //
        // Now it does: re-record noviceScore and this fails until the bands in
        // test-novice.mjs are carried along with it. Same rule as the tier
        // figures and the review cut-offs — a number that ships has to be the
        // number that was measured.
        {
          const nv = measured.noviceScore;
          assert(!!nv && nv.tiers, "docs/measured.json holds a novice-score run");
          const src = fs.readFileSync(path.join(root, "scripts/test-novice.mjs"), "utf8");
          const bandsBlock = /const BANDS = \{([\s\S]*?)\n  \};/.exec(src);
          assert(!!bandsBlock, "test-novice.mjs still declares its bands in one block");
          for (const [tier, rec] of Object.entries((nv && nv.tiers) || {})) {
            const row = new RegExp(tier + ": \\{ careful: \\[(-?\\d+), (-?\\d+)\\]").exec(bandsBlock ? bandsBlock[1] : "");
            assert(!!row, tier + " 有一条 careful 区间");
            if (!row || !rec.careful) continue;
            const mean = rec.careful.scorePct, sd = rec.careful.sdPct;
            assert(Number.isFinite(sd),
              tier + " 的记录带着实测标准差 —— 没有它，区间宽度就只能靠猜（跑 --repeat）");
            if (!Number.isFinite(sd)) continue;
            const lo = Math.max(0, Math.floor(mean - 3 * sd));
            const hi = Math.min(100, Math.ceil(mean + 3 * sd));
            assert(Number(row[1]) === lo && Number(row[2]) === hi,
              tier + " 的区间就是记录里的均值 ±3σ（" + row[1] + "–" + row[2] +
              " vs " + lo + "–" + hi + "；重测过就把区间一起改）");
          }
        }
        const scan = measured.scanNoise;
        assert(!!scan && !!scan.byMovetime, "docs/measured.json holds a scan-noise run");
        if (scan && scan.thresholds) {
          const rv = fs.readFileSync(path.join(root, "src/web/js/review.js"), "utf8");
          const got = /const INACCURACY = (\d+), MISTAKE = (\d+), BLUNDER = (\d+);/.exec(rv);
          assert(!!got, "review.js still declares the three cut-offs on one line");
          if (got) {
            const want = [scan.thresholds.inaccuracy, scan.thresholds.mistake, scan.thresholds.blunder];
            const have = [Number(got[1]), Number(got[2]), Number(got[3])];
            assert(want.join("/") === have.join("/"),
              "the cut-offs that ship are the cut-offs that were measured (" + have.join("/") +
              " vs recorded " + want.join("/") + " — re-run scripts/test-analysis.mjs --record)");
          }
          // and the sweep has to have actually been run, or "no better value
          // exists" is an opinion rather than a result
          const sweeps = Object.values(scan.byMovetime).map((r) => Object.keys(r.sweep || {}).length);
          assert(sweeps.length >= 2 && sweeps.every((n) => n >= 5),
            "…and the ?! threshold was swept, not just asserted");
          // review.js's own comment quotes this run — same rule as the tier
          // figures: a re-record has to drag the prose with it
          const flattenStars = (t) => t.replace(/\n\s*\* ?/g, " ");
          const rvRaw = readSrc("src/web/js/review.js");
          const rvSrc = flattenStars(rvRaw);
          assert(flattenStars(normalise(rvRaw.replace(/\n/g, "\r\n"))) === rvSrc,
            "…and so do review.js's");
          const q = scan.byMovetime["120"];
          check("review.js", rvSrc, /moves by a median (\d+)cp between runs/, q.jitterMedian, "the scan jitter median");
          check("review.js", rvSrc, /(\d+)cp at the ninth percentile/, q.jitterP90, "the scan jitter p90");
          check("review.js", rvSrc, /both runs called it (\d+)% of the time/, q.tags["?!"].agreePct, "the ?! agreement");
          check("review.js", rvSrc, /`\?` reaches (\d+)%/, q.tags["?"].agreePct, "the ? agreement");
          check("review.js", rvSrc, /and `\?\?` (\d+)%/, q.tags["??"].agreePct, "the ?? agreement");
          const sweepQuote = [40, 50, 60, 70, 80, 90].map((k) => q.sweep[String(k)].agreePct).join("/");
          const sweepSaid = /agreement wanders \(([\d/]+)\)/.exec(rvSrc);
          assert(!!sweepSaid && sweepSaid[1] === sweepQuote,
            "review.js quotes the recorded ?! sweep (" + (sweepSaid ? sweepSaid[1] : "—") +
            " vs measured " + sweepQuote + ")");
          assert(off === 0, "review.js's measured figures are the recorded ones");
        }
      }

      // 缺陷 32. The candidate-weighting arm was measured and rejected; the tier
      // rows must therefore not carry the knob, or the comment is describing
      // code that is not there.
      {
        const mv = measured.multipvPhase;
        assert(!!mv && !!mv.phases && !!mv.phases.endgame,
          "docs/measured.json holds a candidate-count run that reached the endgame");
        const rows = (engineSrc.match(/^\s*(?:beginner|casual): \{.*$/gm) || []).join("\n");
        assert(rows.length > 0 && !/spreadK/.test(rows),
          "the rejected weighting is not half-shipped as an unused tier option");
        assert(!!(mv && mv.weightedSamplingTried),
          "…and the runs that rejected it are on the record");
      }
    }

    // The 怎么玩 heading carries a version and nothing checked it, so it sat at
    // v1.16 through five releases. app.zon is the only place the version is real.
    const zonVersion = /\.version\s*=\s*"([^"]+)"/.exec(
      fs.readFileSync(path.join(root, "app.zon"), "utf8"));
    const headingVersion = /^## 怎么玩（v([\d.]+)）/m.exec(readme);
    assert(zonVersion && headingVersion, "README 怎么玩 heading and app.zon both state a version");
    if (zonVersion && headingVersion) {
      // Compared at major.minor. That section describes what the app does, which
      // is what a minor bump changes and a patch bump does not — pinning the
      // patch digit too would make every fix release edit a heading it did not
      // change, and a rule people edit to shut up is a rule they stop reading.
      const minor = (v) => v.split(".").slice(0, 2).join(".");
      assert(minor(headingVersion[1]) === minor(zonVersion[1]),
        "README 怎么玩 heading tracks app.zon (README v" + headingVersion[1] + " vs " + zonVersion[1] + ")");

      // "Am I being run directly?" must not be answered by string-pasting
      // `file://` onto argv[1]. On Windows argv[1] is `D:\\a\\…\\x.mjs` while
      // import.meta.url is `file:///D:/a/…/x.mjs`, so the comparison is false and
      // the main block silently does not run — no output, no error, exit 0.
      // scripts/bundle.mjs had it, and the Windows release build therefore
      // produced no bundle.js and failed three commands later on `cp`, with a
      // message that named the wrong thing. Both this and the CRLF bug above
      // shipped green on ubuntu and macOS.
      {
        const bad = [];
        for (const n of scriptFiles()) {
          const src = fs.readFileSync(path.join(root, "scripts", n), "utf8");
          if (/file:\/\/\$\{\s*process\.argv\[1\]\s*\}/.test(src)) bad.push("scripts/" + n);
        }
        assert(bad.length === 0,
          "no script decides \"run directly?\" by pasting file:// onto argv[1] (" + bad.join(", ") + ")");
      }

      // The release workflow does `test -f .github/release-notes/<tag>.md` and
      // stops if it is missing — after tagging, and only when someone runs it.
      // Every version this repo has shipped has a notes file; the check for
      // whether the current one does should not wait for release day.
      {
        const notes = path.join(root, ".github/release-notes/v" + zonVersion[1] + ".md");
        assert(fs.existsSync(notes),
          "the version in app.zon has release notes (.github/release-notes/v" + zonVersion[1] + ".md)");
        if (fs.existsSync(notes)) {
          const text = fs.readFileSync(notes, "utf8");
          // the heading names the version, so a copied file cannot ship describing another one
          const head = /^## 国际象棋 v([\d.]+)/m.exec(text);
          const minorOf = (v) => v.split(".").slice(0, 2).join(".");
          assert(!!head && minorOf(head[1]) === minorOf(zonVersion[1]),
            "…and its heading names that version (" + (head ? head[1] : "—") + " vs " + zonVersion[1] + ")");
        }
      }

      // The defect list's own tally has to match its own marks. It claims
      // "33 条缺陷已修 31 条" in the header and then marks each entry ✅ or
      // strikes it through, which is two statements of the same fact written in
      // two places — exactly the shape that goes stale (缺陷 12 was a number
      // retyped in three files). Counted rather than trusted.
      {
        const dc = fs.readFileSync(path.join(root, "docs/design-constraints.md"), "utf8");
        const fixed = (dc.match(/^\d+\. ✅ /gm) || []).length;
        const kept = (dc.match(/^\d+\. ~~/gm) || []).length;
        const said = /下面 (\d+) 条缺陷已修 (\d+) 条/.exec(dc);
        assert(!!said, "design-constraints.md states its own tally");
        if (said) {
          assert(Number(said[2]) === fixed,
            "…and the ✅ marks match it (" + fixed + " marked vs " + said[2] + " claimed)");
          assert(Number(said[1]) === fixed + kept,
            "…and every defect is either marked fixed or struck through (" +
            (fixed + kept) + " accounted for, " + said[1] + " claimed)");
        }
      }

      // …and no comment may cite a version the app has not reached. Writing
      // "until 1.19 this did X" beside the code that changed is the most useful
      // habit in this repo, and it is also the easiest way to describe a release
      // that was never cut: during the P-1→P6 work seven files came to say
      // "until 1.26" while app.zon sat at 1.25.0, and the release then went out
      // as 2.0 — so 1.26 named nothing, twice over. Same failure as the heading
      // above, one level down, and the reason a version bump now has to drag
      // every claim about it along.
      //
      // Only the phrasings the repo actually uses for a version claim are
      // matched — a bare "1.5" is a line width, not a release.
      {
        const cur = zonVersion[1].split(".").slice(0, 2).map(Number);
        const newer = (v) => {
          const [maj, min] = v.split(".").map(Number);
          return maj > cur[0] || (maj === cur[0] && min > cur[1]);
        };
        const files = [
          ...webJsFiles(WEB_JS)
            .filter((n) => !["bundle.js", "pieces.js", "chess.js"].includes(n))
            .map((n) => "src/web/js/" + n),
          ...scriptFiles().map((n) => "scripts/" + n),
          "README.md", "docs/design-constraints.md", "docs/refactor-plan.md",
        ];
        // The version may be written 1.19 or 1.19.1, and the boundary has to
        // exclude a preceding digit or dot or "1.19.1 起" matches as "19.1".
        const CLAIM = /(?:\b(?:[Uu]ntil|[Ss]ince|[Ii]n)\s+(?<![\d.])(\d+\.\d+(?:\.\d+)?)\b)|(?:(?<![\d.])(\d+\.\d+(?:\.\d+)?)\s*(?:之前|起|开始|把|改|加))/g;
        const ahead = [];
        for (const rel of files) {
          const src = fs.readFileSync(path.join(root, rel), "utf8");
          for (const m of src.matchAll(CLAIM)) {
            const v = m[1] || m[2];
            if (v && newer(v)) ahead.push(rel + " → " + v);
          }
        }
        assert(ahead.length === 0,
          "no comment claims a version newer than app.zon " + zonVersion[1] +
          " (" + [...new Set(ahead)].slice(0, 5).join(", ") + ")");
      }
    }
  }
}
