/**
 * scripts/sdk-diff.mjs, offline (v8-2-plan F2). No SDK on disk is needed:
 * the registered upstream is rebuilt from our two files and
 * docs/sdk-fork.json (each hunk's `up` text at its `at` line, the text
 * between hunks being common to both sides), and the script is run against
 * that and against copies with one change each.
 *
 *   1. the rebuilt upstream: nothing printed, exit 0 (and, when an SDK is on
 *      disk — NATIVE_SDK_PATH / SDK_PATH — the rebuild is that SDK's text);
 *   2. one line upstream added where nothing is registered: exactly that
 *      one hunk is reported, exit 1;
 *   3. a line changed inside a registered difference's upstream text: that
 *      difference is reported by its group, with the change;
 *   4. a group with no reason in docs/sdk-fork-notes.md is reported.
 *
 * A rebuild that fails means our files and the registry disagree — runner.zig
 * or build.zig was edited and the registry was not (docs/sdk-fork-notes.md
 * says how to register a change).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readLines, run } from "./sdk-diff.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
let failed = 0;
const assert = (cond, msg, detail) => {
  if (cond) console.log("ok   " + msg);
  else {
    failed++;
    console.log("FAIL " + msg + (detail ? "\n     " + String(detail).split("\n").slice(0, 30).join("\n     ") : ""));
  }
};

const registry = JSON.parse(fs.readFileSync(path.join(ROOT, "docs/sdk-fork.json"), "utf8"));

/** The upstream lines the registry describes, from our file; null when they disagree. */
function rebuild(f) {
  const O = readLines(path.join(ROOT, f.ours));
  const hunks = registry.hunks.filter((h) => h.file === f.ours).sort((a, b) => a.at - b.at);
  const U = [];
  let o = 0;
  for (const h of hunks) {
    // common text up to this hunk, then its upstream side for our side
    const common = h.at - 1 - U.length;
    if (common < 0) return { error: `hunk at ${h.at} (${h.group}) overlaps the one before it` };
    U.push(...O.slice(o, o + common));
    o += common;
    const ours = O.slice(o, o + h.ours.length);
    if (ours.join("\n") !== h.ours.join("\n")) {
      return { error: `${f.ours}:${o + 1} is not what the registry's ${h.group} hunk at upstream ${h.at} says we have` };
    }
    o += h.ours.length;
    U.push(...h.up);
  }
  U.push(...O.slice(o));
  return { lines: U };
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "sdk-diff-"));
const writeSdk = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [rel, lines] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), lines.join("\n") + "\n");
  }
  return dir;
};

try {
  const upstream = {};
  for (const f of registry.files) {
    const r = rebuild(f);
    assert(!r.error, `the registry rebuilds the upstream ${f.upstream} from ${f.ours}`, r.error);
    upstream[f.upstream] = r.lines || [];
  }
  assert(registry.groups.length > 0 && registry.hunks.length > 0, `${registry.groups.length} groups, ${registry.hunks.length} hunks registered (SDK ${registry.sdk})`);

  // when an SDK is on disk, the rebuild is its text, byte for byte
  const sdkPath = process.env.NATIVE_SDK_PATH || process.env.SDK_PATH;
  if (sdkPath && registry.files.every((f) => fs.existsSync(path.join(sdkPath, f.upstream)))) {
    for (const f of registry.files) {
      const real = readLines(path.join(sdkPath, f.upstream));
      assert(real.join("\n") === upstream[f.upstream].join("\n"), `the rebuilt ${f.upstream} is the one in ${sdkPath}`);
    }
  } else console.log("skip the rebuild against a real SDK (no NATIVE_SDK_PATH / SDK_PATH)");

  // 1. the registered upstream: silent, exit 0 — through the CLI, as CI runs it
  const clean = writeSdk("clean", upstream);
  let stdout = "";
  let code = 0;
  try {
    stdout = execFileSync(process.execPath, [path.join(ROOT, "scripts/sdk-diff.mjs"), clean], { encoding: "utf8", env: { ...process.env, NATIVE_SDK_PATH: "", SDK_PATH: "" } });
  } catch (e) {
    code = e.status;
    stdout = String(e.stdout) + String(e.stderr);
  }
  assert(code === 0 && stdout === "", "the registered upstream: sdk-diff prints nothing and exits 0", `exit ${code}\n${stdout}`);

  // 2. one upstream line nobody registered, in the longest stretch no hunk
  //    (context included) touches
  const f0 = registry.files[0];
  const U = upstream[f0.upstream];
  const touched = new Array(U.length).fill(false);
  for (const h of registry.hunks.filter((x) => x.file === f0.ours)) {
    for (let i = h.at - 1 - h.before.length; i < h.at - 1 + h.up.length + h.after.length; i++) if (i >= 0 && i < U.length) touched[i] = true;
  }
  let best = [0, 0];
  for (let i = 0; i < U.length; ) {
    if (touched[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < U.length && !touched[j]) j++;
    if (j - i > best[1] - best[0]) best = [i, j];
    i = j;
  }
  const at = (best[0] + best[1]) >> 1;
  const added = "    // an upstream change nobody registered (scripts/test-sdk-diff.mjs)";
  const one = writeSdk("one", { ...upstream, [f0.upstream]: [...U.slice(0, at), added, ...U.slice(at)] });
  try {
    execFileSync(process.execPath, [path.join(ROOT, "scripts/sdk-diff.mjs"), one], { encoding: "utf8" });
    code = 0;
    stdout = "";
  } catch (e) {
    code = e.status;
    stdout = String(e.stdout);
  }
  const heads = stdout.split("\n").filter((l) => l.startsWith("@@"));
  const minus = stdout.split("\n").filter((l) => /^-(?!-)/.test(l));
  const plus = stdout.split("\n").filter((l) => /^\+/.test(l));
  assert(code === 1, "one unregistered upstream change: exit 1", `exit ${code}`);
  assert(heads.length === 1 && minus.length === 1 && minus[0] === "-" + added && plus.length === 0,
    `…and exactly that hunk is reported (upstream line ${at + 1} of ${f0.upstream}, ${best[1] - best[0]} untouched lines around it)`, stdout);
  assert(!/registered difference/.test(stdout), "…and no registered difference is disturbed", stdout);
  assert(stdout.includes(`== ${f0.ours} vs ${f0.upstream}`) && !stdout.includes(`== ${registry.files[1].ours} vs`), "…in the file it was made in, and not the other", stdout);

  // 3. upstream changes a line we diverge from
  const big = registry.hunks.filter((h) => h.file === f0.ours && h.up.length > 2).sort((a, b) => b.up.length - a.up.length)[0];
  const k = big.at - 1 + (big.up.length >> 1);
  const changed = [...U];
  changed[k] = changed[k] + " // changed upstream";
  const r3 = run([writeSdk("changed", { ...upstream, [f0.upstream]: changed })]);
  assert(r3.code === 1 && r3.out.some((l) => l.startsWith(`registered difference ${big.group} `)),
    `upstream changes a line inside registered difference ${big.group}: reported by its group`, r3.out.join("\n"));
  assert(r3.out.some((l) => l === "+ " + changed[k]) && r3.out.some((l) => l === "- " + U[k]), "…with the old and the new upstream line", r3.out.join("\n"));

  // 4. a group the notes do not explain
  const gid = registry.groups[registry.groups.length - 1].id;
  const notes = fs.readFileSync(path.join(ROOT, "docs/sdk-fork-notes.md"), "utf8").replace(new RegExp(`\\b${gid}\\b`, "g"), "—");
  const notesFile = path.join(tmp, "notes.md");
  fs.writeFileSync(notesFile, notes);
  const r4 = run([clean, "--notes", notesFile]);
  assert(r4.code === 1 && r4.out.some((l) => l.includes(`group ${gid} `) && l.includes("no entry")), `a group without a reason in the notes (${gid}) is reported`, r4.out.join("\n"));

  // every group the registry declares is a kind the notes define
  assert(registry.groups.every((g) => ["ours", "unused", "lag"].includes(g.kind)), "every group is ours / unused / lag");
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

if (failed) {
  console.log(`\n${failed} failed`);
  process.exit(1);
}
console.log("all passed");
