/**
 * scripts/ci-wallclock.mjs: the numbers ADR 0005's target (median PR run
 * ≤ 10 min) is read from. A run's wall clock with and without the path-gated
 * jobs, the median over green runs, and the request: a token GitHub refuses
 * is dropped and the request made again, a rate limit says what to do.
 */
import { wallClock, median, summary, api, pathGated, TARGET_MIN } from "../ci-wallclock.mjs";

const job = (name, start, end, extra = {}) => ({ name, run_id: 7, head_sha: "abcdef0123", created_at: "2026-11-07T03:00:00Z",
  started_at: `2026-11-07T03:${start}Z`, completed_at: `2026-11-07T03:${end}Z`, conclusion: "success", ...extra });

export default (test) => {
  test("ci-wallclock: always-on jobs vs the path-gated ones", (a) => {
    const jobs = [job("static (ubuntu-26.04)", "00:10", "01:30"), job("zig (windows-2025)", "00:10", "06:10"),
      job("opponents convert (1/4)", "00:40", "08:00"), job("native-windows / Windows package", "00:40", "17:30"),
      job("browser (WebKit)", "00:10", "04:00"), { name: "native-macos / skipped", started_at: null, conclusion: "skipped" }];
    const r = wallClock(jobs, { conclusion: "success" });
    a.equal(r.wall, 17.5); a.equal(r.always, 6.2);
    a.equal(r.critical, "native-windows / Windows package"); a.equal(r.pathGated, true); a.equal(r.green, true);
    a.equal(r.jobs, 5, "a skipped job is not counted");
    a.ok(pathGated("opponents convert (verdict)") && pathGated("native-macos / scenarios") && !pathGated("browser (Chromium)") && !pathGated("what changed"));
  });
  test("ci-wallclock: refuses a run still going and a missing list", (a) => {
    a.throws(() => wallClock([job("x", "00:00", "01:00", { completed_at: null })]));
    a.throws(() => wallClock(undefined));
  });
  test("ci-wallclock: the median over green runs, against " + TARGET_MIN + " min", (a) => {
    a.equal(median([9, 3, 7]), 7); a.equal(median([4, 8]), 4); a.equal(median([]), null);
    const s = summary([{ green: true, always: 6, wall: 18 }, { green: false, always: 30, wall: 30 }, { green: true, always: 7, wall: 7 }, { green: true, always: 12, wall: 12 }]);
    a.deepEqual(s, { runs: 3, medianAlways: 7, medianWall: 12, ok: true });
  });
  test("ci-wallclock: a refused token is dropped; a rate limit says so", async (a) => {
    const seen = [];
    const fake = (answers) => async (url, { headers }) => { seen.push(!!headers.authorization); const [status, body, left] = answers.shift();
      return { ok: status === 200, status, headers: { get: () => left }, json: async () => body }; };
    const got = await api("/actions/runs/1", { token: "stale", fetchFn: fake([[401, {}], [200, { id: 1 }]]) });
    a.equal(got.id, 1); a.deepEqual(seen, [true, false]);
    let msg = "";
    try { await api("/actions/runs/1", { token: null, fetchFn: fake([[403, {}, "0"]]) }); } catch (e) { msg = e.message; }
    a.ok(/HTTP 403/.test(msg) && /rate limit/.test(msg), msg);
  });
};
