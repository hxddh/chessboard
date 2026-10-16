/**
 * Every suite package.json runs, CI runs too: the workflows, the shards, the
 * browser dependencies and the wall-clock report.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { build } from "../bundle.mjs";
import { assert, root, WEB_MODULES, scriptFiles } from "./harness.mjs";

export async function run() {
  // --- 7.0: every suite package.json runs, CI runs too -------------------------
  //
  // 6.1 found that `checks.yml`'s static job named three scripts by hand while
  // `npm run test:static` listed eight, so four suites had never once run in PR
  // CI. It fixed the static job — and left the same hand-written list in place
  // for the e2e job, for the release workflow's e2e loop, and for the engine
  // suite. A fix that is a one-time edit is not a fix; this is the assertion
  // that makes the next added suite fail loudly instead of silently never
  // running.
  {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    const scriptsIn = (cmd) => [...String(cmd || "").matchAll(/node (scripts\/[\w-]+\.mjs)/g)].map((m) => m[1]);
    const checksWf = fs.readFileSync(path.join(root, ".github/workflows/checks.yml"), "utf8").replace(/\r\n/g, "\n");
    const releaseWf = fs.readFileSync(path.join(root, ".github/workflows/release.yml"), "utf8").replace(/\r\n/g, "\n");
    // Only the e2e lists are spelled out: both workflows run `test:static` and
    // `test:engine` through npm, which is the shape that cannot drift. The e2e
    // loop cannot, because each browser engine needs its own env.
    for (const [group, where, text] of [
      ["test:e2e", "checks.yml", checksWf],
      ["test:e2e", "release.yml", releaseWf],
    ]) {
      const want = scriptsIn(pkg.scripts[group]);
      const missing = want.filter((f) => !text.includes(f));
      assert(missing.length === 0,
        where + " runs every suite in " + group + " (" + want.length + ")" +
        (missing.length ? " —— 漏了 " + missing.join(", ") : ""));
    }
    // 7.1 (v7-1-plan §3.2): the engine gate is tiered now, and a tier that
    // quietly stops running is exactly the failure this whole block exists to
    // prevent. Three places, one rule each.
    const nightlyWf = fs.readFileSync(path.join(root, ".github/workflows/nightly.yml"), "utf8");
    assert(/--sample=150/.test(checksWf),
      "PR CI 跑抽样的题库门禁 —— 7.0 之前 PR 上一条引擎检查都没有");
    // 7.6: release.yml runs the sampled tier as a matrix, one job per script,
    // so it no longer says `npm run test:engine:sample`. Each command of that
    // npm script must appear in it verbatim, arguments included — a matrix that
    // dropped a script, or dropped `--sample=150` and so ran the two-hour full
    // sweep, fails here just as a missing `npm run` line did.
    const sampleCmds = String(pkg.scripts["test:engine:sample"]).split("&&").map((c) => c.trim()).filter(Boolean);
    const sampleMissing = sampleCmds.filter((c) => !releaseWf.includes(c));
    const fullMined = [...releaseWf.matchAll(/scripts\/test-mined\.mjs(?! --sample=)/g)].length;
    assert((/npm run test:engine:sample/.test(releaseWf) || sampleMissing.length === 0) &&
      !/run: npm run test:engine$/m.test(releaseWf) && fullMined === 0,
      "发布跑的是抽样档，不是两个半小时的全量" +
      (sampleMissing.length ? " —— 漏了 " + sampleMissing.join(", ") : "") +
      (fullMined ? " —— test-mined 没带 --sample" : ""));
    // 7.6: the gates are parallel jobs now, and what used to make "red means
    // no release" true by construction — one job, steps in a row — no longer
    // does. The job that tags and publishes must `needs:` every other job.
    {
      const jobsAt = releaseWf.search(/^jobs:\s*$/m);
      const heads = [...releaseWf.slice(jobsAt).matchAll(/^  ([\w-]+):\s*$/gm)];
      const jobNames = heads.map((m) => m[1]);
      const body = {};
      heads.forEach((m, i) => { body[m[1]] = releaseWf.slice(jobsAt).slice(m.index, i + 1 < heads.length ? heads[i + 1].index : undefined); });
      const tagger = jobNames.filter((j) => /git push/.test(body[j]) || /--draft=false/.test(body[j]));
      const tagBody = tagger.length === 1 ? body[tagger[0]] : "";
      const needs = ((tagBody.match(/^    needs:\s*\[([^\]]*)\]/m) || [])[1] || "").split(",").map((s) => s.trim()).filter(Boolean);
      const unguarded = jobNames.filter((j) => j !== tagger[0] && !needs.includes(j));
      assert(tagger.length === 1 && jobNames.length > 1 && unguarded.length === 0,
        "release.yml 里打 tag、发布的那个 job needs 其余每一个 job —— 任何一项红了都不发" +
        (tagger.length !== 1 ? "（找到 " + tagger.length + " 个打 tag / 发布的 job）" : "") +
        (unguarded.length ? " —— 没等 " + unguarded.join(", ") : ""));
    }
    // v8-0-plan F1: PR CI is cut up to be fast, and each cut has a way to
    // quietly stop checking something. One assertion per cut.
    {
      const { parseShard, inShard } = await import("../e2e-shard.mjs");
      // the partition itself: every scenario in exactly one shard, for every n
      let partitionOk = true;
      for (let n = 1; n <= 6; n++) {
        for (let k = 0; k < 200; k++) {
          let hits = 0;
          for (let i = 1; i <= n; i++) if (inShard(k, parseShard(i + "/" + n))) hits++;
          if (hits !== 1) partitionOk = false;
        }
      }
      const bad = ["0/4", "5/4", "1/0", "a/b", "2", "1/4/2"].filter((s) => { try { parseShard(s); return true; } catch { return false; } });
      const all = parseShard(""), unset = parseShard(undefined);
      assert(partitionOk && bad.length === 0 && all.count === 1 && unset.count === 1,
        "SHARD=i/n 把每个场景恰好分进一片；不设 SHARD 就是全部；写错的 SHARD 直接报错" +
        (bad.length ? " —— 没拒绝 " + bad.join(", ") : ""));
      // the suite: every top-level block is gated, and the gate is called
      // nowhere else — an ungated block runs in every shard, and a gate called
      // inside a loop shifts every later scenario's index
      const layoutSrc = fs.readFileSync(path.join(root, "scripts/test-layout-e2e.mjs"), "utf8");
      const ungated = [...layoutSrc.matchAll(/^(?:\{|for \(|for await \(|while \(|do \{)[^\n]*/gm)].map((m) => m[0].slice(0, 40));
      const gates = (layoutSrc.match(/^if \(scenario\(\)\) (?:\{|for \()/gm) || []).length;
      const layoutCode = layoutSrc.split("\n").filter((l) => !/^\s*(\*|\/\/|\/\*)/.test(l)).join("\n");
      const calls = (layoutCode.match(/\bscenario\(\)/g) || []).length;
      assert(/makeScenarioGate\(process\.env\.SHARD\)/.test(layoutSrc) && gates >= 70 && calls === gates && ungated.length === 0,
        "test-layout-e2e 顶层每个场景都以 `if (scenario())` 开头（" + gates + " 个）" +
        (ungated.length ? " —— 没分片的：" + ungated.join(" | ") : "") +
        (calls !== gates ? " —— scenario() 在门之外还被调了 " + (calls - gates) + " 次" : ""));
      // v8-3-plan V4: a 400 ms fallback in the layout probe carries its own
      // evidence (scenario, resizes asked for and seen, rAFs, visibility) and is
      // counted in the job summary, zero included
      {
        const { PAGE_HOOK, makeFrameWatch } = await import("../lib/frame-watch.mjs");
        const lines = [];
        let now = 1000;
        const fw = makeFrameWatch({ shard: parseShard("3/4"), scenario: () => 42, log: (l) => lines.push(l), keep: 2, clock: () => now });
        const asked = [];
        const fakePage = { setViewportSize: async (s) => { asked.push(s.width + "x" + s.height); } };
        const empty = fw.summary();
        for (const w of [540, 559, 560]) { await fw.resize(fakePage, { width: w, height: 600 }); now += 100; }
        const rec = fw.miss("5b 560×600 open", { rafs: 0, vis: "visible" });
        const tmp = path.join((await import("os")).tmpdir(), "frame-watch-" + process.pid + ".md");
        fs.rmSync(tmp, { force: true });
        const wrote = fw.writeSummary(tmp) && fs.readFileSync(tmp, "utf8");
        fs.rmSync(tmp, { force: true });
        const many = makeFrameWatch({ shard: parseShard("1/5"), log: () => {} });
        for (let i = 0; i < 9; i++) many.miss("5b " + i, {});
        const capped = many.summary();
        const hook = String(PAGE_HOOK);
        const layoutHooked = /addInitScript\(PAGE_HOOK\)/.test(layoutSrc) && /frames\.miss\(/.test(layoutSrc) &&
          /frames\.resize\(page/.test(layoutSrc) && /process\.on\("exit", \(\) => frames\.writeSummary\(\)\)/.test(layoutSrc);
        assert(asked.join() === "540x600,559x600,560x600" && fw.count === 1 &&
          JSON.stringify(rec.asked) === "[[559,600,200],[560,600,100]]" && rec.scenario === 42 && rec.shard === "3/4" &&
          lines.length === 1 && lines[0].startsWith("FRAME-MISS {") && JSON.parse(lines[0].slice(11)).page.rafs === 0 &&
          /layout shard 3\/4: 0 次/.test(empty) && /layout shard 3\/4: 1 次.*#42 5b 560×600 open/.test(wrote) &&
          fw.writeSummary("") === false && /: 9 次.*5b 5，另 3 处/.test(capped) && !/5b 6/.test(capped) && (hook.match(/\braf\(/g) || []).length === 1 && layoutHooked,
          "布局分片 400 ms 兜底时记下场景、最近几次视口变化（要的与页面收到的）、rAF 数与可见性，并在作业摘要里按分片计数（v8-3-plan V4）");
      }
      // both workflows: the layout shards are exactly 1/n..n/n, and wired
      for (const [where, text] of [["checks.yml", checksWf], ["release.yml", releaseWf]]) {
        const shards = [...text.matchAll(/suites: scripts\/test-layout-e2e\.mjs\s*\n\s*shard: (\d+)\/(\d+)/g)].map((m) => [+m[1], +m[2]]);
        const n = shards.length ? shards[0][1] : 0;
        const idx = shards.map(([i]) => i).sort((a, b) => a - b).join(",");
        const whole = /suites:[^\n]*test-layout-e2e\.mjs[^\n]*\n(?!\s*shard:)/.test(text);
        assert(n >= 2 && shards.every(([, m]) => m === n) && idx === Array.from({ length: n }, (_, i) => i + 1).join(",") &&
          !whole && /SHARD: \$\{\{ matrix\.group\.shard \}\}/.test(text),
          where + " 把布局套件切成 1/n…n/n 全部的片，并把 SHARD 传进去（" + shards.map((s) => s.join("/")).join(" ") + "）");
      }
      // v8-4-plan V3: the FRAME-MISS count reaches the job summary in the
      // release rehearsal too, not only in checks.yml. The suite writes it
      // itself (asserted above), so what each workflow has to keep is the step
      // that runs the shard: the same loop in both, a plain `node` on the host
      // (no container, no override of GITHUB_STEP_SUMMARY). And the tally that
      // adds the counts up across saved job logs reads timestamped lines.
      {
        const suiteStep = (text) => {
          const at = text.indexOf("      - name: ${{ matrix.group.name }}\n");
          return at < 0 ? "" : text.slice(at).split(/\n\n|\n  [\w-]+:\s*\n/)[0];
        };
        const cs = suiteStep(checksWf), rs = suiteStep(releaseWf);
        const host = (text) => !/^\s+container:/m.test(text) && !/GITHUB_STEP_SUMMARY\s*:/.test(text);
        const { tally } = await import("../frame-miss-tally.mjs");
        const log = [
          "2026-10-08T01:02:03.4567890Z ok   5b 560×600",
          '2026-10-08T01:02:04.0000000Z FRAME-MISS {"shard":"2/5","scenario":17,"where":"5b 560×600 open","asked":[],"page":{"rafs":0}}',
          "FRAME-MISS {not json",
          "- layout shard 2/5: 2 次量取没等到两帧（明细见日志里的 FRAME-MISS 行）",
        ].join("\r\n");
        const t = tally(log);
        assert(cs.length > 0 && cs === rs && /node "\$s"/.test(cs) && /SUITES: \$\{\{ matrix\.group\.suites \}\}/.test(cs) &&
          host(checksWf) && host(releaseWf) && /FRAME-MISS/.test(checksWf) && /FRAME-MISS/.test(releaseWf) &&
          t.length === 2 && t[0].shard === "2/5" && t[0].scenario === 17 && t[1].raw === "{not json" && tally("").length === 0,
          "release.yml 与 checks.yml 的布局分片用同一个步骤跑、FRAME-MISS 计数都进作业摘要；frame-miss-tally 从带时间戳的作业日志里数（v8-4-plan V3）");
      }
      // v8-4-plan V2: no browser job runs `install --with-deps` (apt-get update
      // and ~180 packages from the mirror, 441 s on a slow day); each one takes
      // its engine's system packages through scripts/ci-browser-deps.mjs and the
      // cache, the same five steps everywhere, before the browser itself
      {
        const D = await import("../ci-browser-deps.mjs");
        const block = (pin) => [
          "      - name: install playwright", "        id: pw", "        run: |",
          "          npm install --no-save playwright@" + pin,
          "          node scripts/ci-browser-deps.mjs key ${{ matrix.engine }}",
        ].join("\n");
        const tail = [
          "      - name: restore ${{ matrix.engine }}'s system packages", "        uses: actions/cache/restore@v6", "        with:",
          "          path: ${{ steps.pw.outputs.dir }}", "          key: ${{ steps.pw.outputs.key }}",
          "      - name: system packages for ${{ matrix.engine }}", "        id: deps",
          "        run: node scripts/ci-browser-deps.mjs install ${{ matrix.engine }}",
          "      - name: cache ${{ matrix.engine }}'s system packages", "        if: steps.deps.outputs.save == 'true'",
          "        uses: actions/cache/save@v6", "        with:",
          "          path: ${{ steps.pw.outputs.dir }}", "          key: ${{ steps.pw.outputs.key }}",
          "      - name: install ${{ matrix.engine }}",
        ].join("\n");
        const bad = [];
        let installs = 0;
        for (const [where, text] of [["checks.yml", checksWf], ["release.yml", releaseWf]]) {
          const code = text.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n");
          if (/--with-deps/.test(code)) bad.push(where + " 还有 --with-deps");
          for (const m of code.matchAll(/npx --yes playwright@(\S+) install \$\{\{ matrix\.engine \}\}\s*$/gm)) {
            installs++;
            const before = code.slice(0, m.index);
            const at = before.lastIndexOf(block(m[1]));
            if (at < 0 || !before.slice(at + block(m[1]).length).replace(/^\n/, "").startsWith(tail)) bad.push(where + " 的 playwright@" + m[1] + " 前面不是那五步");
          }
        }
        const key = (v, e, iv) => D.cacheKey({ version: v, engine: e, env: { ImageOS: "ubuntu24", ImageVersion: iv }, arch: "x64" });
        let noVersion = false;
        try { D.cacheKey({ version: "", engine: "webkit" }); } catch { noVersion = true; }
        assert(installs === 3 && bad.length === 0 &&
          key("1.64.0", "webkit", "20261005.1") === "playwright-1.64.0-webkit-debs-ubuntu24-20261005.1-x64" &&
          key("1.64.0", "webkit", "20261012.1") !== key("1.64.0", "webkit", "20261005.1") &&
          key("1.65.0", "webkit", "20261005.1") !== key("1.64.0", "webkit", "20261005.1") &&
          key("1.64.0", "chromium", "20261005.1") !== key("1.64.0", "webkit", "20261005.1") && noVersion &&
          /Dir::Cache::Archives "\/var\/cache\/apt\/playwright-debs\/"/.test(D.aptConf()) &&
          D.debsIn(path.join(root, "no-such-dir")).length === 0,
          "浏览器作业的系统依赖走缓存（键是 Playwright 版本 + 引擎 + runner 镜像），不再 --with-deps 每次从 apt 镜像下（" + installs + " 处；v8-4-plan V2）" +
          (bad.length ? " —— " + bad.join("；") : ""));
      }
      // v8-2-plan V4: both workflows run the same browser groups (release.yml
      // is where a group that drifted would first matter), no suite runs in
      // two groups, and no job in checks.yml can hang for GitHub's six hours
      const groupBlock = (text) => {
        const at = text.search(/^        group:\s*$/m);
        return at < 0 ? "" : text.slice(at, text.indexOf("\n    name: browser", at) + 1);
      };
      // [name, suites, shard, timeout]; a group the pattern misses (no timeout)
      // leaves the count short of the block's `name:` lines
      const groupsOf = (text) => [...groupBlock(text).matchAll(/name: ([^\n]+)\n\s*suites: ([^\n]+)\n(?:\s*shard: ([^\n]+)\n)?\s*timeout: (\d+)\n/g)]
        .map((m) => [m[1], m[2], m[3] || "", +m[4]]);
      const groupCount = (text) => (groupBlock(text).match(/^\s*(?:- )?name: /gm) || []).length;
      const cg = groupsOf(checksWf), rg = groupsOf(releaseWf);
      const suiteUse = {};
      for (const [, suites, shard] of cg) for (const f of suites.split(/\s+/)) if (!shard) suiteUse[f] = (suiteUse[f] || 0) + 1;
      const twice = Object.keys(suiteUse).filter((f) => suiteUse[f] > 1);
      assert(cg.length >= 10 && cg.length === groupCount(checksWf) && rg.length === groupCount(releaseWf) &&
        JSON.stringify(cg) === JSON.stringify(rg) && twice.length === 0 && cg.every((g) => g[3] > 0 && g[3] <= 60),
        "checks.yml 与 release.yml 的浏览器分组逐条相同、每组有自己的超时（" + cg.map((g) => g[0] + " " + g[3]).join("，") + "）" +
        (twice.length ? " —— 跑了两遍：" + twice.join(", ") : ""));
      // v10-0-plan E2: the groups a pull request runs on Chromium only are
      // groups of the list above, whole (an exclusion has to match exactly, or
      // it silently excludes nothing), the PR's alone, and only WebKit's
      {
        const m = /exclude: \$\{\{ github\.event_name == 'pull_request' && fromJSON\('(.*)'\) \|\| fromJSON\('\[\]'\) \}\}/.exec(checksWf);
        const ex = m ? JSON.parse(m[1].replace(/''/g, "'")) : [];
        const asRow = (g) => JSON.stringify([g.name, g.suites, g.shard || "", g.timeout]);
        const rows = new Set(cg.map((g) => JSON.stringify(g)));
        const names = ex.map((e) => e.group && e.group.name).sort().join(", ");
        assert(ex.length === 7 && ex.every((e) => e.engine === "webkit" && rows.has(asRow(e.group))) &&
          names === "board + clock, lessons, panel layout 1/5, panel layout 2/5, panel layout 3/5, panel layout 4/5, panel layout 5/5" &&
          !/exclude:/.test(releaseWf.split("\n").filter((l) => !/^\s*#/.test(l)).join("\n")),
          "E2：PR 上布局五片、课程、棋盘 + 棋钟只跑 Chromium（排除项与分组逐字段相同），发布照跑两个引擎（" + names + "）");
        assert(/^  reuse:$/m.test(releaseWf) && /checks\.yml\/runs\?head_sha=\$\{SHA\}&event=push&status=success/.test(releaseWf) &&
          /^  static:\n    needs: reuse\n    if: needs\.reuse\.outputs\.green != 'true'/m.test(releaseWf) &&
          /^  browser:\n    needs: reuse\n    if: needs\.reuse\.outputs\.green != 'true'/m.test(releaseWf) &&
          /needs: \[preflight, reuse, static, engine, browser, build-macos, build-windows\]\n[\s\S]{0,200}if: \$\{\{ !cancelled\(\) && !contains\(needs\.\*\.result, 'failure'\) && !contains\(needs\.\*\.result, 'cancelled'\) \}\}/.test(releaseWf),
          "E2：同一提交在 main 上的 checks 已绿时，发布复用静态与浏览器两道门；引擎门与两个平台构建照跑；失败或取消照样不发布");
      }
      // v10-0-plan E4: every id in the page is one something uses — a script,
      // the stylesheet, the page's own aria-*/for, or a test. Twenty were
      // not (9.0 review); an id nothing reads is a name that only looks used.
      // The ids built by joining (`"result-" + side`, `id + "-cv"`) are named.
      {
        const page = fs.readFileSync(path.join(root, "src/web/index.html"), "utf8");
        const ids = [...page.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
        const rest = page.replace(/\bid="[^"]+"/g, "");
        const read = [...WEB_MODULES.values()].join("\n") + fs.readFileSync(path.join(root, "src/web/styles.css"), "utf8") +
          scriptFiles().filter((n) => !n.startsWith("_")).map((n) => fs.readFileSync(path.join(root, "scripts", n), "utf8")).join("\n");
        const JOINED = new Set(["result-w", "result-b", "today-r-game-cv", "today-r-pz-cv"]);
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\-]/g, "\\$&");
        const unread = ids.filter((id) => !JOINED.has(id) &&
          !new RegExp("(?:aria-[a-z]+|for)=\"[^\"]*\\b" + esc(id) + "\\b").test(rest) &&
          !new RegExp("[\"'`#]" + esc(id) + "(?![\\w-])").test(read));
        assert(unread.length === 0, "E4：页面里每个 id 都有人用（脚本、样式、页面自己的 aria / for，或测试）" + (unread.length ? " —— 没人用：" + unread.join(", ") : ""));
      }
      // v8-3-plan V4: any suite may be sharded now (engine flows too), not only
      // the layout one. A sharded group holds that one suite alone (SHARD would
      // cut every suite in it), its shards are exactly 1/n..n/n, it runs in no
      // unsharded group, and the suite reads SHARD through the gate
      const sharded = {};
      for (const [, suites, shard] of cg) if (shard) (sharded[suites] = sharded[suites] || []).push(shard);
      const badShards = Object.entries(sharded).filter(([suites, list]) => {
        const n = +list[0].split("/")[1];
        const idx = list.map((s) => s.split("/")).filter(([, m]) => +m === n).map(([i]) => +i).sort((a, b) => a - b).join(",");
        const suiteText = /^scripts\/[\w-]+\.mjs$/.test(suites) && fs.existsSync(path.join(root, suites)) ? fs.readFileSync(path.join(root, suites), "utf8") : "";
        return n < 2 || list.length !== n || idx !== Array.from({ length: n }, (_, i) => i + 1).join(",") ||
          suiteUse[suites] || !/makeScenarioGate\(process\.env\.SHARD\)/.test(suiteText);
      }).map(([s]) => s);
      assert(Object.keys(sharded).length >= 2 && badShards.length === 0,
        "分片的套件各自独占分组、1/n…n/n 齐全、没有另在不分片的组里跑、读的是 SHARD（" +
        Object.entries(sharded).map(([s, l]) => s.replace(/^scripts\//, "") + " ×" + l.length).join("，") + "）" +
        (badShards.length ? " —— 不对：" + badShards.join(", ") : ""));
      const cJobsAt = checksWf.search(/^jobs:\s*$/m);
      const cHeads = [...checksWf.slice(cJobsAt).matchAll(/^  ([\w-]+):\s*$/gm)];
      const noLimit = cHeads.filter((m, i) => {
        const body = checksWf.slice(cJobsAt).slice(m.index, i + 1 < cHeads.length ? cHeads[i + 1].index : undefined);
        return !/^    timeout-minutes: (\d+|\$\{\{ matrix\.group\.timeout \}\})\s*$/m.test(body);
      }).map((m) => m[1]);
      assert(cHeads.length >= 4 && noLimit.length === 0,
        "checks.yml 每个 job 都有 timeout-minutes（" + cHeads.length + " 个）" + (noLimit.length ? " —— 没有：" + noLimit.join(", ") : ""));
      // the PR wall-clock is computed from the run, not typed in
      const WC = await import("../ci-wallclock.mjs");
      const job = (name, c, s, e, concl = "success") => ({ run_id: 7, head_sha: "abcdef12", name, created_at: c, started_at: s, completed_at: e, conclusion: concl });
      const wc = WC.wallClock([job("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:13:00Z"),
        job("b", "2026-01-01T00:00:05Z", "2026-01-01T00:00:30Z", "2026-01-01T00:14:30Z"),
        { name: "skipped", conclusion: "skipped", started_at: null }]);
      let stillRunning = false;
      try { WC.wallClock([job("a", "2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", null)]); } catch { stillRunning = true; }
      const runs = WC.merge([{ run: 1, wall: 20, green: true }, { run: 2, wall: 14, green: true }], [{ run: 1, wall: 12, green: true }, { run: 3, wall: 15, green: true }]);
      assert(wc.wall === 14.5 && wc.critical === "b" && wc.criticalMin === 14 && wc.jobs === 2 && wc.green && stillRunning &&
        runs.map((r) => r.wall).join() === "12,14,15" && WC.lastThreeOk(runs) && !WC.lastThreeOk(runs.slice(1)) &&
        !WC.lastThreeOk(runs.concat({ run: 4, wall: 15.1, green: true })),
        "PR 墙钟从作业的起止时间算（第一个排队 → 最后一个结束），同一 run 重记是替换，最近三次全绿且 ≤ 15 分钟才算达标");
      // v8-2-plan V4 (M1 评审): the screenshots job is continue-on-error — its
      // failure leaves the PR green, so it leaves the run green here too
      const T = ["2026-01-01T00:00:00Z", "2026-01-01T00:01:00Z", "2026-01-01T00:05:00Z"];
      const shotsOnly = [job("unit", ...T), job("screenshots (webkit, not a gate)", ...T, "failure")];
      const realFail = [job("unit", ...T, "failure"), job("screenshots (webkit, not a gate)", ...T)];
      assert(WC.wallClock(shotsOnly).green && WC.wallClock(shotsOnly, { conclusion: "success" }).green &&
        !WC.wallClock(realFail).green && !WC.wallClock(realFail, { conclusion: "failure" }).green &&
        !WC.wallClock(shotsOnly, { conclusion: "failure" }).green && WC.wallClock(realFail).notGreen.join() === "unit: failure",
        "PR 墙钟的「全绿」看 run 自己的结论；没有 run 时不算 continue-on-error 的作业（截图）");
      const coe = cHeads.map((m, i) => checksWf.slice(cJobsAt).slice(m.index, i + 1 < cHeads.length ? cHeads[i + 1].index : undefined))
        .filter((body) => /^    continue-on-error: true\s*$/m.test(body));
      assert(coe.length >= 1 && coe.every((body) => /^    name: .*\bnot a gate\b/m.test(body) && WC.notAGate(body.match(/^    name: (.*)$/m)[1])),
        "checks.yml 里 continue-on-error 的作业名字都写着「not a gate」—— ci-wallclock 没有 run 结论时靠它认（" + coe.length + " 个）");
      // checks.yml: push only for main, stale PR runs cancelled, the sampled
      // puzzle search on ubuntu only, and Windows native compiled on every PR
      const zigAt = checksWf.search(/^  zig:\s*$/m);
      const zigJob = zigAt < 0 ? "" : checksWf.slice(zigAt).split(/\n  [\w-]+:\s*\n/)[0];
      assert(/^on:\s*\n  push:\s*\n    branches: \[main\]\s*$/m.test(checksWf),
        "checks.yml 的 push 只在 main 上跑 —— 其余分支有 PR 就够了，不再同一棵树跑两遍");
      assert(/^concurrency:\s*\n  group: checks-\$\{\{ github\.event_name == 'pull_request' && github\.ref \|\| github\.run_id \}\}\s*\n  cancel-in-progress: true\s*$/m.test(checksWf),
        "checks.yml 取消同一个 PR 上被新提交顶掉的旧运行");
      // v8-3-plan V4: in a job of its own (`mined`), no longer a step of static
      const minedAt = checksWf.search(/^  mined:\s*$/m);
      const minedJob = minedAt < 0 ? "" : checksWf.slice(minedAt).split(/\n  [\w-]+:\s*\n/)[0];
      assert(/^    runs-on: ubuntu-latest\s*$/m.test(minedJob) && /run: node scripts\/test-mined\.mjs --sample=150/.test(minedJob) &&
        /run: python3 scripts\/test-verify-endgames\.py/.test(minedJob) &&
        (checksWf.match(/scripts\/test-mined\.mjs/g) || []).length === 1,
        "150 题抽样校验只在 ubuntu 上跑一遍（自己一个作业）—— 它和平台无关");
      assert(/os: windows-latest\s*\n\s*flags: -Dplatform=windows/.test(zigJob) && /os: macos-latest/.test(zigJob) &&
        /run: zig build test \$\{\{ matrix\.flags \}\}/.test(zigJob) && /runs-on: \$\{\{ matrix\.os \}\}/.test(zigJob),
        "checks.yml 的 zig job 在 windows-latest 上编译并跑 zig build test —— PR 上也编译 Windows 原生");
    }
    assert(/run: npm run test:engine$/m.test(nightlyWf),
      "全量那一趟有人跑 —— 抽样只覆盖 15%，剩下的 85% 在 nightly");
    assert(scriptsIn(pkg.scripts["test:engine:sample"]).length === scriptsIn(pkg.scripts["test:engine"]).length,
      "抽样档少的是搜索量，不是脚本数 —— 抽样不等于少跑几个套件");
  }
}
