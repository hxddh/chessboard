/**
 * The automation build: tested, never released; the packaged app outside the
 * checkout; the WebView2 data directory; live runs refused off CI.
 *
 * Part of scripts/test-chess.mjs, which runs every module here in order.
 */
import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import { build } from "../bundle.mjs";
import { assert, root, scriptsDir } from "./harness.mjs";

export async function run() {
  // --- v8-2-plan V1: the automation build is tested, never released ------------
  //
  // -Dautomation=true compiles in the SDK's automation server: a dropbox under
  // the app's working directory through which any local process can call
  // chess.*. build-macos.yml / build-windows.yml build it as a second package of
  // the same commit to drive it (scripts/automation-scenarios.mjs). What ships
  // is the other one: the job that uploads the Chessboard-* artifacts release.yml
  // downloads must not build with automation, the automation job must upload no
  // Chessboard-* artifact and nothing to a release, and release.yml attaches
  // exactly the three files by name. Comments are dropped first: they may say
  // what they like about the other job.
  {
    const code = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
      .split("\n").filter((l) => !l.trim().startsWith("#")).join("\n");
    /** The jobs of a workflow, by name: each one's text up to the next job. */
    const jobsOf = (text) => {
      const body = text.slice(text.indexOf("\njobs:\n") + 7);
      const out = {};
      const heads = [...body.matchAll(/^  ([\w-]+):\n/gm)];
      heads.forEach((m, i) => { out[m[1]] = body.slice(m.index, i + 1 < heads.length ? heads[i + 1].index : body.length); });
      return out;
    };
    for (const rel of [".github/workflows/build-macos.yml", ".github/workflows/build-windows.yml"]) {
      const jobs = jobsOf(code(rel));
      const auto = Object.entries(jobs).filter(([, j]) => /-Dautomation=true/.test(j));
      const shipping = Object.entries(jobs).filter(([, j]) => /name: Chessboard-/.test(j) || /gh release upload/.test(j));
      assert(auto.length === 1 && auto[0][0] === "automation", rel + ": one job builds with -Dautomation=true, `automation` (" + auto.map(([n]) => n).join(", ") + ")");
      assert(shipping.length === 1 && shipping[0][0] === "build", rel + ": only `build` uploads a Chessboard-* artifact or to a release (" + shipping.map(([n]) => n).join(", ") + ")");
      assert(!/-Dautomation/.test(jobs.build || ""), rel + ": the shipped package is built without automation");
      const a = jobs.automation || "";
      assert(!/name: Chessboard-|gh release|upload-artifact[\s\S]*?path: dist\//.test(a) && /--output dist-auto\//.test(a) && !/--output dist\//.test(a),
        rel + ": the automation job packages into dist-auto/ and uploads no package (only its report)");
      assert(/timeout-minutes: 20\b/.test(a), rel + ": the automation job has its 20-minute limit");
      assert(/node scripts\/automation-smoke\.mjs/.test(a) && /node scripts\/automation-scenarios\.mjs/.test(a), rel + ": the automation job runs the smoke test and the scenarios");
      // §9 M4: a job its own limit stops ends "cancelled", which continue-on-error
      // does not cover and which skips `publish`; a step's limit ends it "failed"
      for (const step of ["automation smoke", "automation scenarios"]) {
        const lim = /^\s*timeout-minutes: (\d+)/m.exec(a.slice(a.indexOf("name: " + step)).split(/\n      - /)[0]);
        assert(lim && +lim[1] < 20, rel + ": the `" + step + "` step has its own limit under the job's 20 minutes");
      }
    }
    const rel = code(".github/workflows/release.yml");
    assert(/pattern: Chessboard-\*/.test(rel) && (rel.match(/uses: actions\/download-artifact@/g) || []).length === 1,
      "release.yml downloads only the Chessboard-* artifacts (never automation-report-*)");
    const attached = (/gh release create[\s\S]*?\n\s*(dist\/[^\n]*)\n/.exec(rel) || [])[1] || "";
    assert(attached.trim() === "dist/Chessboard-macOS-arm64.zip dist/Chessboard-macOS-arm64.dmg dist/Chessboard-Windows-x64.zip",
      "release.yml attaches exactly the three shipped packages (" + attached.trim() + ")");
    assert(!/dist-auto|-Dautomation/.test(rel), "release.yml never names the automation build");
  }

  // v8-3-plan V1 (8.2.1): the packaged app is launched outside the checkout. The
  // checkout has a frontend/dist of its own, and the Windows build read its page
  // from the current directory: started from the repository the self-test and
  // the release went green while the app, started from Explorer, had no page.
  {
    const strip = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
      .split("\n").filter((l) => !/^\s*(\/\/|\*)/.test(l)).join("\n");
    const selftest = strip("scripts/selftest-app.mjs");
    const spawnCall = (/spawn\(([\s\S]*?)\}\);/.exec(selftest) || [])[1] || "";
    assert(/\bcwd\b/.test(spawnCall) && !/cwd:\s*(process\.cwd|root|ROOT)/.test(spawnCall) && /path\.resolve\(exe\)/.test(spawnCall) &&
      /launch\(1,\s*dir\)/.test(selftest) && /launch\(2,\s*path\.dirname\(path\.resolve\(exe\)\)\)/.test(selftest),
      "selftest-app.mjs starts the packaged app by an absolute path, first in its temp folder, then in the executable's own folder (a double click), never in the checkout");
    // v8-3-plan §8 第 4 条: Windows automation is a gate like macOS
    for (const wf of [".github/workflows/build-windows.yml", ".github/workflows/build-macos.yml"]) {
      const text = fs.readFileSync(path.join(root, wf), "utf8").replace(/\r\n/g, "\n");
      const job = text.slice(text.indexOf("\n  automation:\n"));
      assert(!/^    continue-on-error:/m.test(job) && !/not a gate/.test(job.split("\n").filter((l) => !l.trim().startsWith("#")).join("\n")),
        wf + ": the automation job is a gate (no continue-on-error, not named \"not a gate\")");
    }
    const lib = strip("scripts/lib/automation.mjs");
    assert(/spawn\(path\.resolve\(exe\),\s*\[\],\s*\{\s*cwd:\s*work\b/.test(lib),
      "automation launches start the app in their work folder");
    const main = fs.readFileSync(path.join(root, "src/main.zig"), "utf8");
    assert(/fn resolveAssetRoot\(/.test(main) && /app_state\.resolveAssetRoot\(\);/.test(main) &&
      /\.dist = self\.asset_root/.test(main),
      "main.zig points the WebView at the page beside the exe (resolveAssetRoot), in both the source and source_fn");
  }

  // v8-4-plan V1: an exe directory the user cannot write to moves WebView2's
  // user data to %LOCALAPPDATA%\Chessboard\WebView2 — set in main() before the
  // runner creates the WebView2 environment — and the Windows build proves it
  // by running the packaged self-test from a copy it has denied writes to.
  {
    const code = (rel) => fs.readFileSync(path.join(root, rel), "utf8").replace(/\r\n/g, "\n")
      .split("\n").filter((l) => !/^\s*(\/\/|#)/.test(l)).join("\n");
    const main = code("src/main.zig");
    const mainFn = main.slice(main.indexOf("pub fn main("));
    const call = mainFn.indexOf("app_state.resolveWebView2UserData();");
    assert(/fn resolveWebView2UserData\(/.test(main) && call > 0 && call < mainFn.indexOf("runner.runWithOptions("),
      "main.zig calls resolveWebView2UserData() in main(), before the runner starts");
    assert(/"WEBVIEW2_USER_DATA_FOLDER"/.test(main) && /\\\\Chessboard\\\\WebView2/.test(main) && /SetEnvironmentVariableW\(/.test(main),
      "main.zig sets WEBVIEW2_USER_DATA_FOLDER to <LOCALAPPDATA>\\Chessboard\\WebView2 through SetEnvironmentVariableW");
    const wf = code(".github/workflows/build-windows.yml");
    const build = wf.slice(wf.indexOf("\n  build:\n"), wf.indexOf("\n  automation:\n"));
    const step = (name) => build.indexOf("- name: " + name + "\n");
    const ro = step("self-test the packaged app from a read-only folder");
    const roBody = ro < 0 ? "" : build.slice(ro, build.indexOf("\n      - ", ro + 1));
    assert(ro > 0 && ro < step("self-test the packaged app") && ro < step("zip package"),
      "build-windows.yml: the read-only self-test runs in the build job, before the regular self-test and the zip");
    assert(/timeout-minutes: \d+/.test(roBody) && /icacls \$ro \/deny "\*S-1-1-0:\(OI\)\(CI\)\(WD,AD\)" \/T/.test(roBody) &&
      /the deny did not take/.test(roBody) && /node scripts\/selftest-app\.mjs \$exe/.test(roBody) &&
      /'Chessboard\\WebView2'/.test(roBody) && /no WebView2 data in/.test(roBody) && /WebView2 data beside the exe/.test(roBody),
      "build-windows.yml: the read-only step denies writes with icacls, checks the deny took, runs selftest-app.mjs, and wants the data in %LOCALAPPDATA%\\Chessboard\\WebView2");
  }

  // v8-2-plan §9 M4 评审修正: a live automation run writes into the machine's real
  // WebView storage (same bundle id; WKWebView ignores $HOME), so off a CI
  // runner both drivers refuse unless told --real-profile-ok; --null never asks.
  {
    const { liveProfileRefusal } = await import("../lib/automation.mjs");
    assert(liveProfileRefusal("x", [], {}) && liveProfileRefusal("x", [], { CI: "false", GITHUB_ACTIONS: "0" }), "a live automation run off CI is refused");
    assert(liveProfileRefusal("x", [], { CI: "true" }) === null && liveProfileRefusal("x", [], { GITHUB_ACTIONS: "true" }) === null &&
      liveProfileRefusal("x", ["--real-profile-ok"], {}) === null, "a live automation run goes ahead on CI or with --real-profile-ok");
    const env = { ...process.env };
    delete env.CI;
    delete env.GITHUB_ACTIONS;
    for (const s of ["automation-smoke.mjs", "automation-scenarios.mjs"]) {
      // package.json stands in for the exe: a refusal comes before any launch
      const r = spawnSync(process.execPath, [path.join(scriptsDir, s), path.join(root, "package.json")], { cwd: root, env, encoding: "utf8", timeout: 20000 });
      assert(r.status === 1 && /^REFUSED: .*--real-profile-ok/m.test(r.stderr), s + " live mode refuses off CI without --real-profile-ok (exit " + r.status + ": " + (r.stderr || "").trim().slice(0, 120) + ")");
    }
  }
}
