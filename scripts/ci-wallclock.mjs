/**
 * PR wall-clock, from the run itself (v8-2-plan V4; ADR 0005: the median PR
 * run ≤ 10 minutes).
 *
 * Turns checks.yml runs into numbers and keeps them in docs/measured.json
 * `ciWallClock`:
 *
 *   - wall: first job queued → last job finished, the time a person waits
 *     for the PR to go green (queueing included);
 *   - always: the same over the jobs every PR runs — without the path-gated
 *     ones (opponents …, native-macos / …, native-windows / …: ADR 0005 picks
 *     them by the files a PR touches), the number ADR 0005's target is about;
 *   - critical: the longest single job, start to finish, and its name;
 *   - the median of `wall` and of `always` over the runs given, against
 *     TARGET_MIN.
 *
 *   node scripts/ci-wallclock.mjs RUN_ID [RUN_ID…] [--label=TEXT] [--record]
 *   node scripts/ci-wallclock.mjs --pr=129 [--last=10] [--record]
 *   node scripts/ci-wallclock.mjs --from=jobs.json[,…] [--label=TEXT] [--record]
 *
 * RUN_ID reads https://api.github.com/repos/$REPO/actions/runs/RUN_ID and its
 * /jobs (REPO defaults to hxddh/chessboard; GH_TOKEN or GITHUB_TOKEN if set —
 * a token GitHub refuses (401) is dropped and the request made again without
 * one, as a public repository allows). --pr lists checks.yml's pull_request
 * runs for that PR and takes the last N that finished. A run a newer push
 * cancelled still counts for `always` when every always-on job had finished
 * green (alwaysGreen); the whole wall's median takes green runs only. --from reads the /jobs answer
 * saved to a file, or { run, jobs } with both (what the GitHub MCP tools
 * return, where api.github.com is not reachable). Without --record it only
 * prints. Re-recording a run replaces it rather than adding it twice.
 */
import fs from "fs";
import { fileURLToPath } from "url";
import { read, record, RECORDING } from "./measurements.mjs";

export const TARGET_MIN = 10;

/** Jobs checks.yml runs only when certain files changed (its `changed` job decides). */
export const pathGated = (name) => /^(opponents\b|native-(macos|windows)\b)/.test(String(name || ""));

const minutes = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 6000) / 10;

/**
 * A job checks.yml runs with `continue-on-error` (the screenshots): its
 * failure does not turn the PR red, so it must not make the run "not green"
 * either. The jobs API does not carry the flag; checks.yml names every such
 * job "…, not a gate)" and test-chess holds it to that.
 */
export const notAGate = (name) => /\bnot a gate\b/.test(String(name || ""));

/**
 * One run's numbers from its jobs (the API's `jobs` array). Skipped jobs
 * (never started) do not count; a run with a job still going is refused —
 * its wall-clock is not known yet. `run` (the API's run object, optional):
 * its own `conclusion` decides green when it has one — GitHub already leaves
 * continue-on-error failures out of it (v8-2-plan V4, M1 评审); without it,
 * every job but the not-a-gate ones must have succeeded.
 */
export function wallClock(jobs, run) {
  if (!Array.isArray(jobs)) throw new Error("no jobs list (got " + typeof jobs + ")");
  const ran = jobs.filter((j) => j.started_at && j.conclusion !== "skipped");
  if (!ran.length) throw new Error("no job ran");
  const going = ran.filter((j) => !j.completed_at);
  if (going.length) throw new Error("still running: " + going.map((j) => j.name).join(", "));
  const span = (js) => {
    if (!js.length) return null;
    const first = js.map((j) => j.created_at || j.started_at).sort()[0];
    return minutes(first, js.map((j) => j.completed_at).sort().at(-1));
  };
  const long = ran.map((j) => ({ name: j.name, min: minutes(j.started_at, j.completed_at) }))
    .sort((a, b) => b.min - a.min)[0];
  const failed = ran.filter((j) => j.conclusion !== "success");
  const gating = failed.filter((j) => !notAGate(j.name));
  const green = run && run.conclusion ? run.conclusion === "success" : gating.length === 0;
  const bad = (green ? failed : gating.length ? gating : failed).map((j) => j.name + ": " + j.conclusion);
  const gated = ran.filter((j) => pathGated(j.name));
  const always = ran.filter((j) => !pathGated(j.name));
  // ADR 0005's figure needs only these: a run a newer push cancelled once they were done still measured them
  const alwaysGreen = always.length > 0 && always.every((j) => j.conclusion === "success" || notAGate(j.name));
  return {
    run: ran[0].run_id, sha: String(ran[0].head_sha || "").slice(0, 7),
    wall: span(ran), always: span(always), alwaysGreen,
    critical: long.name, criticalMin: long.min,
    jobs: ran.length, pathGated: gated.length > 0, green, ...(bad.length ? { notGreen: bad } : {}),
  };
}

/** The median of a list of numbers (the lower middle for an even count: no number no run produced). */
export function median(xs) {
  const a = xs.filter((x) => typeof x === "number").sort((p, q) => p - q);
  return a.length ? a[(a.length - 1) >> 1] : null;
}

/** ADR 0005's figure over a list of rows: the median of the green runs' `always` and `wall`. */
export function summary(rows) {
  const green = rows.filter((r) => r.green), alwaysGreen = rows.filter((r) => r.alwaysGreen ?? r.green);
  const always = median(alwaysGreen.map((r) => r.always)), wall = median(green.map((r) => r.wall));
  return { runs: green.length, alwaysRuns: alwaysGreen.length, medianAlways: always, medianWall: wall, ok: always != null && always <= TARGET_MIN };
}

/** The recorded list with `rows` merged in (same run → replaced), oldest first. */
export function merge(prev, rows) {
  const byRun = new Map((prev || []).map((r) => [r.run, r]));
  for (const r of rows) byRun.set(r.run, r);
  return [...byRun.values()].sort((a, b) => a.run - b.run);
}

const REPO = () => process.env.REPO || "hxddh/chessboard";

/** GET from the repository's API; a refused token (401) is dropped and the request made again. */
export async function api(urlPath, { token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN, fetchFn = fetch } = {}) {
  const url = `https://api.github.com/repos/${REPO()}${urlPath}`;
  const headers = (t) => Object.assign({ accept: "application/vnd.github+json", "user-agent": "chessboard-ci-wallclock" },
    t ? { authorization: "Bearer " + t } : {});
  let res = await fetchFn(url, { headers: headers(token) });
  if (res.status === 401 && token) {
    console.error("(the token was refused: asking again without one)");
    res = await fetchFn(url, { headers: headers(null) });
  }
  if (!res.ok) {
    const left = res.headers && res.headers.get && res.headers.get("x-ratelimit-remaining");
    throw new Error(`${urlPath}: HTTP ${res.status}` + (left === "0" ? " (rate limit: set GH_TOKEN, or save the answers with the GitHub MCP tools and use --from)" : ""));
  }
  return res.json();
}

async function runOf(id) {
  return { jobs: (await api(`/actions/runs/${id}/jobs?per_page=100`)).jobs, run: await api(`/actions/runs/${id}`) };
}

/** The ids of the last `last` finished checks.yml runs of PR `pr`, oldest first. */
async function runsOfPr(pr, last) {
  const branch = (await api(`/pulls/${pr}`)).head.ref;
  const runs = (await api(`/actions/workflows/checks.yml/runs?event=pull_request&status=completed&per_page=${Math.min(100, last * 3)}&branch=${encodeURIComponent(branch)}`)).workflow_runs || [];
  // a cancelled run counts when its always-on jobs had finished (wallClock's alwaysGreen); one cancelled before that does not
  return runs.filter((r) => (r.pull_requests || []).some((p) => p.number === pr))
    .slice(0, last).map((r) => r.id).reverse();
}

async function main() {
  const arg = (n) => (process.argv.find((a) => a.startsWith("--" + n + "=")) || "").slice(n.length + 3);
  const ids = process.argv.slice(2).filter((a) => /^\d+$/.test(a));
  if (arg("pr")) ids.push(...await runsOfPr(Number(arg("pr")), Number(arg("last")) || 10));
  const lists = [];
  for (const f of arg("from").split(",").filter(Boolean)) {
    const doc = JSON.parse(fs.readFileSync(f, "utf8"));
    // the jobs answer alone (an array, or { jobs: [...] }), or { run, jobs } with the run's own answer beside it
    if (Array.isArray(doc)) lists.push({ jobs: doc });
    else lists.push({ jobs: Array.isArray(doc.jobs) ? doc.jobs : doc.jobs && doc.jobs.jobs, run: doc.run });
  }
  for (const id of ids) lists.push(await runOf(id));
  if (!lists.length) { console.error("usage: ci-wallclock.mjs RUN_ID… | --pr=N [--last=K] | --from=FILE,…  [--label=TEXT] [--record]"); process.exit(2); }
  const label = arg("label");
  const rows = [];
  for (const l of lists) {
    try { rows.push(Object.assign(wallClock(l.jobs, l.run), label ? { label } : {})); }
    catch (e) { console.log("run " + ((l.run && l.run.id) || "?") + ": not counted (" + e.message + ")"); }
  }
  for (const r of rows) {
    console.log(`run ${r.run} (${r.sha})：墙钟 ${r.wall} 分钟，每个 PR 都跑的作业 ${r.always} 分钟` + (r.pathGated ? "（含按路径触发的作业）" : "") +
      `，最长 ${r.critical} ${r.criticalMin} 分钟，${r.jobs} 个作业` + (r.green ? "" : "，没全绿：" + r.notGreen.join("; ") + (r.alwaysGreen ? "（每个 PR 都跑的作业全绿）" : "")));
  }
  const now = summary(rows);
  console.log(`这 ${rows.length} 次：每个 PR 都跑的作业全绿的 ${now.alwaysRuns} 次，墙钟中位 ${now.medianAlways} 分钟；整次全绿的 ${now.runs} 次，中位 ${now.medianWall} 分钟；` +
    `ADR 0005 的目标（中位 ≤ ${TARGET_MIN} 分钟）：${now.ok ? "达到" : "没达到"}`);
  if (RECORDING) {
    const prev = read().ciWallClock;
    const runs = merge(prev && prev.runs, rows);
    record("ciWallClock", {
      what: "checks.yml 一次 PR 运行的墙钟：第一个作业排队 → 最后一个作业结束（分钟，含排队）；always 只算每个 PR 都跑的作业（不含按路径触发的 opponents / native）；" +
        "critical 为耗时最长的单个作业。数据取自 GitHub API 的 jobs（started_at / completed_at），不手填",
      script: "node scripts/ci-wallclock.mjs --pr=129 --record（或 RUN_ID… / --from=…）",
      targetMin: TARGET_MIN,
      latest: Object.assign({ of: rows.map((r) => r.run) }, now),
      runs,
    });
  }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
