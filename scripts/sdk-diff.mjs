#!/usr/bin/env node
/**
 * sdk-diff.mjs — what differs between our two hand-kept SDK copies and the
 * SDK's own files that nobody has registered (v8-2-plan F2).
 *
 *   src/runner.zig  is a fork of the SDK's src/app_runner/root.zig
 *   build.zig       is a hand copy of the SDK's build/app.zig
 *
 * Every SDK upgrade has to diff both against the new upstream, and 0.8.0
 * shipped a Windows build that could not link because the copy had missed a
 * source file upstream added (release.yml). Read raw, those diffs are a wall
 * of ~170 hunks, nearly all of them deliberate. So every difference we know
 * about is registered in docs/sdk-fork.json — the upstream text, our text and
 * a few lines of upstream context around it, so each one is found by content,
 * not by line number — and explained in docs/sdk-fork-notes.md under its
 * group id. This script applies the registered differences to the SDK's files
 * and diffs the result against ours. Whatever is left is new: an upstream
 * change we have not taken (or not decided to leave out), or an edit of ours
 * nobody registered. A registered difference whose upstream text is no longer
 * where it was is reported too — upstream changed a place we diverge in.
 *
 * Usage:
 *   node scripts/sdk-diff.mjs [sdk-dir] [--registry file] [--notes file] [--suggest]
 *
 *   sdk-dir     an SDK checkout or the npm package (@native-sdk/cli); default
 *               $NATIVE_SDK_PATH, then $SDK_PATH, then build.zig's
 *               default_native_sdk_path
 *   --suggest   also print each unregistered hunk as a registry entry
 *               (group "TODO") to paste into docs/sdk-fork.json once it has
 *               a group and a reason
 *
 * Prints nothing and exits 0 when everything is registered; prints what is
 * not and exits 1; exits 2 when the SDK files are not there. Offline: it reads
 * two files from disk. scripts/test-sdk-diff.mjs (test:static) holds it to
 * that without an SDK on disk.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

// ------------------------------------------------------------------ the diff

/**
 * Line diff: patience anchors (lines unique on both sides, in order), Myers
 * between them. Patience keeps hunks where a reader expects them — a moved
 * function is not stitched together from matching `}` lines — and its
 * output does not depend on what changed elsewhere in the file, which is what
 * lets a registered hunk keep matching while upstream moves around it.
 * Returns ops: ["=", i, j] | ["-", i] | ["+", j].
 */
export function diffLines(a, b) {
  const ops = [];
  const rec = (a0, a1, b0, b1) => {
    while (a0 < a1 && b0 < b1 && a[a0] === b[b0]) ops.push(["=", a0++, b0++]);
    let s = 0;
    while (a1 - s > a0 && b1 - s > b0 && a[a1 - 1 - s] === b[b1 - 1 - s]) s++;
    const tail = [];
    for (let k = s; k >= 1; k--) tail.push(["=", a1 - k, b1 - k]);
    a1 -= s;
    b1 -= s;
    if (a0 === a1) for (let j = b0; j < b1; j++) ops.push(["+", j]);
    else if (b0 === b1) for (let i = a0; i < a1; i++) ops.push(["-", i]);
    else {
      const anchors = uniqueAnchors(a, b, a0, a1, b0, b1);
      if (anchors.length === 0) myers(a, b, a0, a1, b0, b1, ops);
      else {
        let pa = a0;
        let pb = b0;
        for (const [i, j] of anchors) {
          rec(pa, i, pb, j);
          ops.push(["=", i, j]);
          pa = i + 1;
          pb = j + 1;
        }
        rec(pa, a1, pb, b1);
      }
    }
    for (const t of tail) ops.push(t);
  };
  rec(0, a.length, 0, b.length);
  return ops;
}

/** Lines that occur once in a[a0,a1) and once in b[b0,b1), longest in-order run. */
function uniqueAnchors(a, b, a0, a1, b0, b1) {
  const seen = new Map(); // line -> [countA, indexA, countB, indexB]
  for (let i = a0; i < a1; i++) {
    const e = seen.get(a[i]);
    if (e) e[0]++;
    else seen.set(a[i], [1, i, 0, -1]);
  }
  for (let j = b0; j < b1; j++) {
    const e = seen.get(b[j]);
    if (e) {
      e[2]++;
      e[3] = j;
    }
  }
  const pairs = [];
  for (const [line, e] of seen) if (e[0] === 1 && e[2] === 1 && line.trim() !== "") pairs.push([e[1], e[3]]);
  pairs.sort((p, q) => p[0] - q[0]);
  // longest increasing subsequence on j (patience sorting)
  const tops = [];
  const prev = new Array(pairs.length);
  for (let n = 0; n < pairs.length; n++) {
    let lo = 0;
    let hi = tops.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (pairs[tops[mid]][1] < pairs[n][1]) lo = mid + 1;
      else hi = mid;
    }
    prev[n] = lo > 0 ? tops[lo - 1] : -1;
    tops[lo] = n;
  }
  const out = [];
  for (let n = tops.length ? tops[tops.length - 1] : -1; n >= 0; n = prev[n]) out.push(pairs[n]);
  return out.reverse();
}

/** Myers O(ND) over a[a0,a1) × b[b0,b1); appends ops in order. */
function myers(a, b, a0, a1, b0, b1, ops) {
  const n = a1 - a0;
  const m = b1 - b0;
  const max = n + m;
  const off = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace = [];
  let found = -1;
  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(off - d - 1, off + d + 2)); // k = -d-1 .. d+1
    for (let k = -d; k <= d; k += 2) {
      let x = k === -d || (k !== d && v[off + k - 1] < v[off + k + 1]) ? v[off + k + 1] : v[off + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && a[a0 + x] === b[b0 + y]) {
        x++;
        y++;
      }
      v[off + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  const rev = [];
  let x = n;
  let y = m;
  for (let d = found; d >= 0; d--) {
    const t = trace[d];
    const at = (k) => t[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && at(k - 1) < at(k + 1)) ? k + 1 : k - 1;
    const px = d === 0 ? 0 : at(prevK);
    const py = px - prevK;
    while (x > px && y > py) rev.push(["=", a0 + --x, b0 + --y]);
    if (d > 0) {
      if (x === px) rev.push(["+", b0 + py]);
      else rev.push(["-", a0 + px]);
    }
    x = px;
    y = py;
  }
  for (let i = rev.length - 1; i >= 0; i--) ops.push(rev[i]);
}

/** Runs of changes, each with the equal lines around it: [{from, to}] over ops. */
export function hunksOf(ops) {
  const out = [];
  let i = 0;
  while (i < ops.length) {
    if (ops[i][0] === "=") {
      i++;
      continue;
    }
    const from = i;
    while (i < ops.length && ops[i][0] !== "=") i++;
    out.push({ from, to: i });
  }
  return out;
}

// --------------------------------------------------------- the registry

export function readLines(file) {
  const text = fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();
  return lines;
}

/** Every index at which `pat` occurs in `lines`. */
export function findAll(lines, pat) {
  const out = [];
  if (pat.length === 0) return out;
  outer: for (let i = 0; i + pat.length <= lines.length; i++) {
    for (let k = 0; k < pat.length; k++) if (lines[i + k] !== pat[k]) continue outer;
    out.push(i);
  }
  return out;
}

/**
 * Apply a file's registered hunks to the upstream lines. Returns the
 * result, each line's origin (its upstream index, or -1 for one of ours) and
 * the hunks that could not be placed.
 */
export function applyRegistered(up, hunks) {
  const placed = [];
  const stale = [];
  for (const h of hunks) {
    const pat = [...h.before, ...h.up, ...h.after];
    const occ = findAll(up, pat);
    const count = h.count ?? 1;
    if (occ.length !== count) {
      stale.push({ h, found: occ.length });
      continue;
    }
    const at = occ[h.nth ?? 0];
    placed.push({ h, start: at + h.before.length, end: at + h.before.length + h.up.length });
  }
  placed.sort((p, q) => p.start - q.start || p.end - q.end);
  const kept = [];
  for (const p of placed) {
    const last = kept[kept.length - 1];
    if (last && p.start < last.end) stale.push({ h: p.h, found: -1 });
    else kept.push(p);
  }
  const lines = [];
  const origin = [];
  let u = 0;
  for (const p of kept) {
    for (; u < p.start; u++) {
      lines.push(up[u]);
      origin.push(u);
    }
    for (const l of p.h.ours) {
      lines.push(l);
      origin.push(-1);
    }
    u = p.end;
  }
  for (; u < up.length; u++) {
    lines.push(up[u]);
    origin.push(u);
  }
  return { lines, origin, stale, placed: kept };
}

/**
 * A registry entry for one unregistered hunk whose upstream side is plain
 * upstream text (not one of ours already): two lines of upstream context each
 * side, more (up to CONTEXT_MAX) until the pattern occurs once, `nth`/`count`
 * when even that repeats. Context is read from upstream as it is — it may run
 * over a neighbouring registered hunk's upstream text, which is fine: only
 * the `up` lines are replaced.
 */
const CONTEXT_MAX = 40;
function suggestion(file, up, origin, O, ops, hunk) {
  const del = [];
  const ins = [];
  for (let i = hunk.from; i < hunk.to; i++) {
    if (ops[i][0] === "-") del.push(ops[i][1]);
    else ins.push(ops[i][1]);
  }
  const upIdx = del.map((r) => origin[r]);
  if (upIdx.some((u, k) => u < 0 || (k > 0 && u !== upIdx[k - 1] + 1))) return null;
  let startU;
  if (upIdx.length) startU = upIdx[0];
  else if (hunk.from > 0 && origin[ops[hunk.from - 1][1]] >= 0) startU = origin[ops[hunk.from - 1][1]] + 1;
  else if (hunk.to < ops.length && origin[ops[hunk.to][1]] >= 0) startU = origin[ops[hunk.to][1]];
  else return null;
  const endU = startU + upIdx.length;
  let nb = Math.min(2, startU);
  let na = Math.min(2, up.length - endU);
  const pattern = () => up.slice(startU - nb, endU + na);
  let occ = findAll(up, pattern());
  while (occ.length > 1 && (nb < Math.min(CONTEXT_MAX, startU) || na < Math.min(CONTEXT_MAX, up.length - endU))) {
    if (nb < Math.min(CONTEXT_MAX, startU)) nb++;
    if (na < Math.min(CONTEXT_MAX, up.length - endU)) na++;
    occ = findAll(up, pattern());
  }
  const entry = {
    group: "TODO",
    file,
    at: startU + 1,
    before: up.slice(startU - nb, startU),
    up: up.slice(startU, endU),
    ours: ins.map((j) => O[j]),
    after: up.slice(endU, endU + na),
  };
  if (occ.length > 1) {
    entry.nth = occ.indexOf(startU - nb);
    entry.count = occ.length;
  }
  return entry;
}

/**
 * Where a registered hunk's upstream text went, when it no longer matches:
 * its `before` context, then its `after` context within a bounded distance —
 * whatever upstream now has between the two. Null when either is gone.
 */
function relocate(up, h) {
  if (!h.before.length || !h.after.length) return null;
  const reach = h.up.length * 2 + 60;
  // a short context recurs; the occurrence nearest where the hunk was wins
  const near = (h.at ?? 1) - 1 - h.before.length;
  const befores = findAll(up, h.before).sort((x, y) => Math.abs(x - near) - Math.abs(y - near));
  for (const b of befores) {
    const from = b + h.before.length;
    for (const a of findAll(up, h.after)) {
      if (a >= from && a - from <= reach) return { at: from, lines: up.slice(from, a) };
    }
  }
  return null;
}

// --------------------------------------------------------------- the report

function unified(R, origin, O, ops, hunk, context = 3) {
  const from = Math.max(0, hunk.from - context);
  const to = Math.min(ops.length, hunk.to + context);
  let firstUp = "?";
  let firstOurs = "?";
  for (let i = from; i < to; i++) {
    const op = ops[i];
    if (firstUp === "?" && op[0] !== "+" && origin[op[1]] >= 0) firstUp = origin[op[1]] + 1;
    if (firstOurs === "?" && op[0] !== "-") firstOurs = (op[0] === "=" ? op[2] : op[1]) + 1;
  }
  const out = [`@@ upstream ${firstUp} / ours ${firstOurs} @@`];
  for (let i = from; i < to; i++) {
    const op = ops[i];
    if (op[0] === "=") out.push(" " + R[op[1]]);
    else if (op[0] === "-") out.push("-" + R[op[1]]);
    else out.push("+" + O[op[1]]);
  }
  return out.join("\n");
}

/**
 * The SDK's version, from the npm package's package.json (@native-sdk/cli,
 * what CI and the platform builds install). A git checkout has no version
 * file of its own (its build.zig.zon says 0.1.0), so there it is unknown and
 * not compared.
 */
function sdkVersion(sdk) {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(sdk, "package.json"), "utf8"));
    return pkg.name === "@native-sdk/cli" ? pkg.version || null : null;
  } catch {
    return null;
  }
}

export function run(argv, env = process.env) {
  const out = [];
  const say = (s) => out.push(s);
  const opt = (name) => {
    const i = argv.indexOf(name);
    return i >= 0 ? argv[i + 1] : null;
  };
  const positional = argv.filter((a, i) => !a.startsWith("--") && !["--registry", "--notes"].includes(argv[i - 1]));
  const registryFile = opt("--registry") || path.join(ROOT, "docs", "sdk-fork.json");
  const notesFile = opt("--notes") || path.join(ROOT, "docs", "sdk-fork-notes.md");
  const suggest = argv.includes("--suggest");
  const buildDefault = /const default_native_sdk_path\s*=\s*"([^"]+)"/.exec(fs.readFileSync(path.join(ROOT, "build.zig"), "utf8"));
  const sdk = positional[0] || env.NATIVE_SDK_PATH || env.SDK_PATH || (buildDefault && buildDefault[1]);

  const registry = JSON.parse(fs.readFileSync(registryFile, "utf8"));
  for (const f of registry.files) {
    if (!sdk || !fs.existsSync(path.join(sdk, f.upstream))) {
      return { code: 2, out: [`sdk-diff: no ${f.upstream} under ${sdk || "(no SDK path)"} — pass the SDK checkout, or set NATIVE_SDK_PATH`] };
    }
  }

  // the registry explains itself: every group has a reason in the notes
  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, "utf8") : "";
  const groups = new Map(registry.groups.map((g) => [g.id, g]));
  const problems = [];
  if (groups.size !== registry.groups.length) problems.push("docs/sdk-fork.json: a group id is used twice");
  for (const g of registry.groups) {
    if (!new RegExp(`\\b${g.id}\\b`).test(notes)) problems.push(`group ${g.id} (${g.title}) has no entry in ${path.relative(ROOT, notesFile)}`);
    if (!registry.hunks.some((h) => h.group === g.id)) problems.push(`group ${g.id} has no hunks`);
  }
  for (const h of registry.hunks) if (!groups.has(h.group)) problems.push(`a hunk names group ${h.group}, which is not declared`);
  if (problems.length) {
    say("== the registry");
    for (const p of problems) say("  " + p);
  }

  const suggestions = [];
  const moved = [];
  for (const f of registry.files) {
    const upFile = path.join(sdk, f.upstream);
    const up = readLines(upFile);
    const O = readLines(path.join(ROOT, f.ours));
    const hunks = registry.hunks.filter((h) => h.file === f.ours);
    const { lines: R, origin, stale, placed } = applyRegistered(up, hunks);
    for (const p of placed) if (p.h.at !== p.start + 1) moved.push([p.h, p.start + 1]);
    const ops = diffLines(R, O);
    const left = hunksOf(ops);
    if (!stale.length && !left.length) continue;
    say(`== ${f.ours} vs ${f.upstream} (SDK ${registry.sdk} when registered)`);
    for (const { h, found } of stale) {
      const g = groups.get(h.group);
      const where = found < 0 ? "overlaps another registered hunk" : `found ${found} time(s), registered ${h.count ?? 1}`;
      say(`registered difference ${h.group}${g ? ` (${g.title})` : ""} no longer matches upstream (${where}).`);
      const now = relocate(up, h);
      if (now) {
        // what upstream did to the text we diverge from: old "-", new "+"
        say(`upstream ${now.at + 1}..${now.at + now.lines.length}, the registered upstream text against what is there now:`);
        const rops = diffLines(h.up, now.lines);
        const show = new Set();
        for (const { from, to } of hunksOf(rops)) for (let i = Math.max(0, from - 3); i < Math.min(rops.length, to + 3); i++) show.add(i);
        let gap = false;
        rops.forEach((op, i) => {
          if (!show.has(i)) return void (gap = true);
          if (gap) say("  …");
          gap = false;
          say(op[0] === "=" ? "  " + h.up[op[1]] : op[0] === "-" ? "- " + h.up[op[1]] : "+ " + now.lines[op[1]]);
        });
      } else {
        say("its context is gone too; it expected upstream to read:");
        for (const l of h.before) say("  " + l);
        for (const l of h.up) say("- " + l);
        for (const l of h.after) say("  " + l);
      }
    }
    for (const hunk of left) {
      say(unified(R, origin, O, ops, hunk));
      if (suggest) {
        const s = suggestion(f.ours, up, origin, O, ops, hunk);
        if (s) suggestions.push(s);
      }
    }
  }
  if (suggest && suggestions.length) say(JSON.stringify(suggestions, null, 2));
  if (out.length) {
    say('("-" lines are upstream\'s, "+" lines ours; see docs/sdk-fork-notes.md for how to register or take a change)');
    return { code: 1, out };
  }
  // Everything is registered. `at` (the upstream line a hunk starts at) is not
  // used to find anything — it is what lets scripts/test-sdk-diff.mjs rebuild
  // the registered upstream offline — so after an upgrade it is refreshed
  // here, together with the version, once the rest is clean.
  const version = sdkVersion(sdk);
  if (moved.length || (version && version !== registry.sdk)) {
    if (!argv.includes("--refresh")) {
      say(`${path.relative(ROOT, registryFile)}: all registered, but ${moved.length} hunk(s) start on another upstream line` +
        (version && version !== registry.sdk ? ` and the SDK is ${version}, not ${registry.sdk}` : "") + " — run again with --refresh to record that");
      return { code: 1, out };
    }
    for (const [h, at] of moved) h.at = at;
    if (version) registry.sdk = version;
    fs.writeFileSync(registryFile, JSON.stringify(registry, null, 1) + "\n");
    say(`sdk-diff: ${path.relative(ROOT, registryFile)} now records SDK ${registry.sdk} (${moved.length} line number(s) updated)`);
  }
  return { code: 0, out };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { code, out } = run(process.argv.slice(2));
  if (out.length) (code === 2 ? console.error : console.log)(out.join("\n"));
  process.exit(code);
}
