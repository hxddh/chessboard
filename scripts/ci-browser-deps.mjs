/**
 * A browser's system packages for the CI browser jobs, without the apt
 * mirror when that can be avoided (v8-4-plan V2).
 *
 * `npx playwright install --with-deps webkit` runs `apt-get update` and
 * `apt-get install` of about 180 packages on every job. Usually 31–53 s; on
 * the day the runner's Azure mirror was slow the same step took 441 s
 * (115 MB at 275 kB/s) and made one job 13 minutes. The packages do not
 * change between two runs on the same runner image, so they are cached
 * (actions/cache, keyed on the Playwright version, the engine and the runner
 * image) and installed from the cache, and the mirror is only asked when the
 * cache does not have them.
 *
 * Why not the Playwright container image instead: it is the other answer the
 * plan names, and it changes more than the install — every test would run as
 * root, with the image's fonts instead of the runner's (the layout suite
 * measures text), a 2 GB pull per job, and /dev/shm at Docker's 64 MB. This
 * keeps the job exactly the job it was and only changes where the .debs come
 * from; at worst a cache that does not fit falls back to what ran before.
 *
 * `install` decides with Playwright's own check, `install-deps --dry-run`,
 * which simulates the install with `apt-get install -s` against the local
 * package lists — offline, no sudo — and exits non-zero when anything is
 * missing:
 *
 *   1. nothing missing (Chromium on ubuntu-latest, as a rule): done;
 *   2. the cache has .debs: `apt-get install` them as local files, check again;
 *   3. otherwise, or when 2 did not satisfy the check: `playwright
 *      install-deps` as before (the mirror), with apt keeping what it
 *      downloads in a directory of its own, copied out for the cache to save.
 *
 *   node scripts/ci-browser-deps.mjs key ENGINE       → $GITHUB_OUTPUT key=…, dir=…
 *   node scripts/ci-browser-deps.mjs install ENGINE   → $GITHUB_OUTPUT source=image|cache|apt, save=true|false
 *
 * `save` is true only when the cache came up empty and step 3 left .debs:
 * a key that was restored is never saved over (caches are immutable).
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import { createRequire } from "module";
import { fileURLToPath } from "url";

/** where the cached .debs live on the runner (the cache's `path`) */
export const DEBS_DIR = path.join(os.homedir(), ".cache", "playwright-debs");
/** apt's download directory while step 3 runs — its own, so nothing cleans it behind us */
export const APT_ARCHIVES = "/var/cache/apt/playwright-debs";
const APT_CONF = "/etc/apt/apt.conf.d/99playwright-debs";

/**
 * The cache key. The Playwright version is the one installed (the pin, read
 * back rather than retyped), the image is the runner's (ImageOS/ImageVersion):
 * a new image is a new key, so cached .debs never meet a system newer than
 * the one they were downloaded for.
 */
export function cacheKey({ version, engine, env = process.env, arch = process.arch }) {
  if (!version || !engine) throw new Error("cacheKey: version and engine are required");
  return ["playwright", version, engine, "debs", env.ImageOS || process.platform, env.ImageVersion || "local", arch].join("-");
}

/** the .deb files in `dir`, sorted; none when it does not exist */
export function debsIn(dir) {
  try { return fs.readdirSync(dir).filter((n) => n.endsWith(".deb")).sort().map((n) => path.join(dir, n)); } catch { return []; }
}

/** The APT_CONF text: downloads kept, and kept in APT_ARCHIVES. */
export const aptConf = (dir = APT_ARCHIVES) =>
  `Dir::Cache::Archives "${dir}/";\nAPT::Keep-Downloaded-Packages "true";\nBinary::apt::APT::Keep-Downloaded-Packages "true";\n`;

function output(pairs) {
  const text = Object.entries(pairs).map(([k, v]) => `${k}=${v}\n`).join("");
  process.stdout.write(text);
  if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, text);
}

const sudo = (cmd, args, opts = {}) => {
  const [c, a] = process.getuid && process.getuid() !== 0 ? ["sudo", [cmd, ...args]] : [cmd, args];
  return spawnSync(c, a, { stdio: "inherit", ...opts });
};

function playwrightCli() {
  const req = createRequire(path.join(process.cwd(), "package.json"));
  const pkg = req.resolve("playwright/package.json");
  return { version: JSON.parse(fs.readFileSync(pkg, "utf8")).version, cli: path.join(path.dirname(pkg), "cli.js") };
}

/** Playwright's own "is anything missing" (exit 0 = nothing); prints one line, not the 180-name list */
function satisfied(cli, engine) {
  const r = spawnSync(process.execPath, [cli, "install-deps", "--dry-run", engine], { encoding: "utf8" });
  const out = (r.stdout || "") + (r.stderr || "");
  console.log("  install-deps --dry-run: " + (out.split("\n").find((l) => l.trim()) || "(no output)").trim());
  return r.status === 0;
}

function install(engine) {
  const t0 = Date.now();
  const { cli } = playwrightCli();
  const cached = debsIn(DEBS_DIR);
  let source = null, save = false;
  console.log(`${engine}: checking system packages (cache: ${cached.length} .deb)`);
  if (satisfied(cli, engine)) source = "image";
  if (!source && cached.length) {
    // As local files, with no package sources: given a .deb whose version is
    // also in the lists, apt fetches the mirror's copy instead (and
    // `--no-download` refuses the local files as well). With no sources the
    // only candidates are these files and what is installed, so this either
    // installs offline or stops on an unmet dependency — never the mirror.
    const none = fs.mkdtempSync(path.join(os.tmpdir(), "no-sources-"));
    const r = sudo("apt-get", ["install", "-y", "--no-install-recommends", "-o", "DPkg::Lock::Timeout=120",
      "-o", "Dir::Etc::SourceList=/dev/null", "-o", "Dir::Etc::SourceParts=" + none, ...cached]);
    if (r.status === 0 && satisfied(cli, engine)) source = "cache";
    else console.log(`::warning::${engine}: the cached packages did not install cleanly (exit ${r.status}); falling back to apt`);
  }
  if (!source) {
    let ok = sudo("mkdir", ["-p", APT_ARCHIVES + "/partial"]).status === 0;
    ok = ok && sudo("tee", [APT_CONF], { input: aptConf(), stdio: ["pipe", "ignore", "inherit"] }).status === 0;
    if (!ok) console.log(`::warning::${engine}: could not point apt at ${APT_ARCHIVES}; nothing will be cached`);
    const r = spawnSync(process.execPath, [cli, "install-deps", engine], { stdio: "inherit" });
    sudo("rm", ["-f", APT_CONF]);
    if (r.status !== 0) { console.error(`playwright install-deps ${engine} exited ${r.status}`); process.exit(r.status || 1); }
    source = "apt";
    const got = ok ? debsIn(APT_ARCHIVES) : [];
    if (!cached.length && got.length) {
      fs.mkdirSync(DEBS_DIR, { recursive: true });
      for (const f of got) fs.copyFileSync(f, path.join(DEBS_DIR, path.basename(f)));
      save = true;
    }
    console.log(`${engine}: apt downloaded ${got.length} .deb` + (save ? `, copied to ${DEBS_DIR} for the cache` : ""));
  }
  console.log(`${engine}: system packages from ${source}, ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  output({ source, save });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [cmd, engine] = process.argv.slice(2);
  if (!["chromium", "webkit"].includes(engine) || !["key", "install"].includes(cmd)) {
    console.error("usage: node scripts/ci-browser-deps.mjs key|install chromium|webkit");
    process.exit(2);
  }
  if (cmd === "key") output({ key: cacheKey({ version: playwrightCli().version, engine }), dir: DEBS_DIR });
  else install(engine);
}
