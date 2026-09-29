/**
 * Is anything in docs/deps-inventory.json behind its npm `latest`?
 * (v8-1-plan §1.7)
 *
 * The inventory is a snapshot: the day it was written, every pin was checked
 * by hand against upstream. It goes stale the day after. This script redoes
 * the part of that check a machine can do — the entries that carry an `npm`
 * field (the SDK, esbuild, Playwright, Stockfish.js) are compared with the
 * registry's `latest` dist-tag — and says so, one line per newer version.
 *
 * It never fails. A newer release is news, not a defect: upgrading is a
 * deliberate PR with its own acceptance (v8-1-plan F1), and a nightly that
 * goes red whenever someone else publishes would be a nightly nobody reads.
 * An unreachable registry is reported the same way, as a line.
 *
 * Whether the inventory agrees with what the repo actually pins is a
 * different question, answered offline by scripts/test-deps.mjs.
 *
 *   node scripts/deps-check.mjs     print; in Actions also append to $GITHUB_STEP_SUMMARY
 *
 * @module deps-check
 */
import fs from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const INVENTORY = path.join(root, "docs/deps-inventory.json");

/**
 * The version an inventory `current` starts with: "1.63.0（Chromium …）" →
 * "1.63.0", "@v7（…）" → "7", "24（setup-node …）" → "24".
 * @param {string} s
 * @returns {string|null}
 */
export function leadingVersion(s) {
  const m = /^@?v?(\d+(?:\.\d+)*)/.exec(String(s || "").trim());
  return m ? m[1] : null;
}

/**
 * Numeric compare of dotted versions; missing parts count as 0.
 * @returns {number} <0, 0, >0
 */
export function compareVersions(a, b) {
  const pa = String(a).split(".").map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d;
  }
  return 0;
}

/** npm's `latest` for a package, or throws. npm itself, so its proxy and registry settings apply. */
function npmLatest(pkg) {
  const out = execFileSync("npm", ["view", pkg, "dist-tags.latest"], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 60000,
    shell: process.platform === "win32",
  });
  const v = out.trim();
  if (!/^\d+\.\d+\.\d+/.test(v)) throw new Error("unexpected answer: " + JSON.stringify(v));
  return v;
}

/**
 * One line per npm-tracked entry.
 * @param {{deps: Array<{name: string, npm?: string, current: string}>}} inv
 * @param {(pkg: string) => string} latestOf
 * @returns {{lines: string[], newer: number}}
 */
export function check(inv, latestOf = npmLatest) {
  const lines = [];
  let newer = 0;
  for (const d of inv.deps || []) {
    if (!d.npm) continue;
    const cur = leadingVersion(d.current);
    let latest;
    try { latest = latestOf(d.npm); } catch (e) {
      lines.push(`? ${d.npm}: npm 查不到 latest（${String(e.message || e).split("\n")[0]}），清单里是 ${cur}`);
      continue;
    }
    if (cur && compareVersions(latest, cur) > 0) {
      newer++;
      lines.push(`↑ ${d.npm}: 有新版 ${latest}（清单 / 仓库钉的是 ${cur}）`);
    } else {
      lines.push(`= ${d.npm}: ${cur}，已是 npm latest（${latest}）`);
    }
  }
  return { lines, newer };
}

const runDirectly = !!process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (runDirectly) {
  let inv;
  try { inv = JSON.parse(fs.readFileSync(INVENTORY, "utf8")); } catch (e) {
    console.log("deps-check: 读不了 docs/deps-inventory.json：" + e.message);
    process.exit(0);
  }
  const { lines, newer } = check(inv);
  const head = newer
    ? `deps-check：${newer} 项有新版（不算失败；升级按 v8-1-plan F1 单独提交）`
    : "deps-check：npm 能查的几项都是最新";
  console.log([head, ...lines].join("\n"));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) {
    try {
      fs.appendFileSync(summary, `### ${head}\n\n` + lines.map((l) => "- `" + l + "`").join("\n") + "\n");
    } catch { /* a summary we cannot write is still not a failure */ }
  }
}
