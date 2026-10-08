/**
 * FRAME-MISS lines, counted across saved job logs (v8-4-plan V3).
 *
 * Each layout shard puts its own count in its job summary (lib/frame-watch.mjs);
 * the plan wants one number for every run of the version, checks.yml's and the
 * release rehearsals' alike. Summaries cannot be fetched through the API, logs
 * can (`/actions/jobs/ID/logs`, or the MCP `get_job_logs`), so this reads the
 * saved logs and adds them up.
 *
 *   node scripts/frame-miss-tally.mjs LOG [LOG…]
 *
 * Prints one line per file (its count, and the scenarios when there are any)
 * and the total. A log that is not a layout shard's simply counts 0.
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * The FRAME-MISS records in one log's text. A job log prefixes every line
 * with a timestamp, so the record is found anywhere in the line; a line whose
 * JSON does not parse still counts (as { raw }) — the count is the point.
 */
export function tally(text) {
  const out = [];
  for (const line of String(text).split(/\r?\n/)) {
    const at = line.indexOf("FRAME-MISS {");
    if (at < 0) continue;
    const json = line.slice(at + "FRAME-MISS ".length).trim();
    try { out.push(JSON.parse(json)); } catch { out.push({ raw: json }); }
  }
  return out;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const files = process.argv.slice(2);
  if (!files.length) { console.error("usage: node scripts/frame-miss-tally.mjs LOG [LOG…]"); process.exit(2); }
  let total = 0;
  for (const f of files) {
    const recs = tally(fs.readFileSync(f, "utf8"));
    total += recs.length;
    const where = recs.map((r) => (r.shard ? r.shard + " " : "") + (r.scenario !== undefined ? "#" + r.scenario + " " : "") + (r.where || "?"));
    console.log(`${f}: ${recs.length}` + (where.length ? "  (" + where.join("; ") + ")" : ""));
  }
  console.log(`FRAME-MISS total: ${total} in ${files.length} log(s)`);
}
