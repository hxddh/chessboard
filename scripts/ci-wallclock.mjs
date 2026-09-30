/**
 * PR wall-clock, from the run itself (v8-2-plan V4).
 *
 * v8-0-plan F1 set the target — a PR's checks done in 15 minutes — and
 * measured 13′41″ once; 8.1 never measured it again, and by 8.1.0 one browser
 * job alone took 21.7 minutes. A target nobody measures is a wish, so this
 * turns a checks.yml run into two numbers and keeps them in
 * docs/measured.json `ciWallClock`:
 *
 *   - wall: first job queued → last job finished, the time a person waits
 *     for the PR to go green (queueing included: a job that waits for a
 *     runner is part of the wait);
 *   - critical: the longest single job, start to finish, and its name — the
 *     one to split next.
 *
 * The acceptance (V4) is three PRs in a row at ≤ 15 minutes; `lastThreeOk`
 * says whether the three most recent recorded runs are.
 *
 *   node scripts/ci-wallclock.mjs RUN_ID [RUN_ID…] [--label=TEXT] [--record]
 *   node scripts/ci-wallclock.mjs --from=jobs.json[,…] [--label=TEXT] [--record]
 *
 * RUN_ID reads https://api.github.com/repos/$REPO/actions/runs/RUN_ID/jobs
 * (REPO defaults to hxddh/chessboard; GH_TOKEN or GITHUB_TOKEN if set);
 * --from reads that endpoint's answer saved to a file. Without --record it
 * only prints. Re-recording a run replaces it rather than adding it twice.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { read, record, RECORDING } from "./measurements.mjs";

export const TARGET_MIN = 15;

const minutes = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 6000) / 10;

/**
 * One run's numbers from its jobs (the API's `jobs` array). Skipped jobs
 * (never started) do not count; a run with a job still going is refused —
 * its wall-clock is not known yet.
 */
export function wallClock(jobs) {
  const ran = jobs.filter((j) => j.started_at && j.conclusion !== "skipped");
  if (!ran.length) throw new Error("no job ran");
  const going = ran.filter((j) => !j.completed_at);
  if (going.length) throw new Error("still running: " + going.map((j) => j.name).join(", "));
  const first = ran.map((j) => j.created_at || j.started_at).sort()[0];
  const last = ran.map((j) => j.completed_at).sort().at(-1);
  const long = ran.map((j) => ({ name: j.name, min: minutes(j.started_at, j.completed_at) }))
    .sort((a, b) => b.min - a.min)[0];
  const bad = ran.filter((j) => j.conclusion !== "success").map((j) => j.name + ": " + j.conclusion);
  return {
    run: ran[0].run_id, sha: String(ran[0].head_sha || "").slice(0, 7),
    wall: minutes(first, last), critical: long.name, criticalMin: long.min,
    jobs: ran.length, green: bad.length === 0, ...(bad.length ? { notGreen: bad } : {}),
  };
}

/** The recorded list with `rows` merged in (same run → replaced), oldest first. */
export function merge(prev, rows) {
  const byRun = new Map((prev || []).map((r) => [r.run, r]));
  for (const r of rows) byRun.set(r.run, r);
  return [...byRun.values()].sort((a, b) => a.run - b.run);
}

/** V4's acceptance: the three most recent green runs, each within the target. */
export function lastThreeOk(runs) {
  const green = runs.filter((r) => r.green);
  return green.length >= 3 && green.slice(-3).every((r) => r.wall <= TARGET_MIN);
}

async function jobsOf(id) {
  const repo = process.env.REPO || "hxddh/chessboard";
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const res = await fetch(`https://api.github.com/repos/${repo}/actions/runs/${id}/jobs?per_page=100`,
    { headers: Object.assign({ accept: "application/vnd.github+json" }, token ? { authorization: "Bearer " + token } : {}) });
  if (!res.ok) throw new Error(`run ${id}: HTTP ${res.status}`);
  return (await res.json()).jobs;
}

async function main() {
  const arg = (n) => (process.argv.find((a) => a.startsWith("--" + n + "=")) || "").slice(n.length + 3);
  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  const lists = [];
  for (const f of arg("from").split(",").filter(Boolean)) {
    const doc = JSON.parse(fs.readFileSync(f, "utf8"));
    lists.push(Array.isArray(doc) ? doc : doc.jobs.jobs || doc.jobs);
  }
  for (const id of ids) lists.push(await jobsOf(id));
  if (!lists.length) { console.error("usage: ci-wallclock.mjs RUN_ID… | --from=FILE,…  [--label=TEXT] [--record]"); process.exit(2); }
  const label = arg("label");
  const rows = lists.map((j) => Object.assign(wallClock(j), label ? { label } : {}));
  for (const r of rows) {
    console.log(`run ${r.run} (${r.sha})：墙钟 ${r.wall} 分钟，最长 ${r.critical} ${r.criticalMin} 分钟，${r.jobs} 个作业` +
      (r.green ? "" : "，没全绿：" + r.notGreen.join("; ")));
  }
  const prev = read().ciWallClock;
  const runs = merge(prev && prev.runs, rows);
  const ok = lastThreeOk(runs);
  console.log(`最近三次全绿的 PR 运行都 ≤ ${TARGET_MIN} 分钟：${ok ? "是" : "否"}`);
  if (RECORDING) {
    record("ciWallClock", {
      what: "checks.yml 一次 PR 运行的墙钟：第一个作业排队 → 最后一个作业结束（分钟，含排队）；critical 为耗时最长的单个作业。" +
        "数据取自 GitHub API 的 jobs（started_at / completed_at），不手填",
      script: "node scripts/ci-wallclock.mjs RUN_ID… --label=… --record",
      targetMin: TARGET_MIN,
      lastThreeOk: ok,
      runs,
    });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
