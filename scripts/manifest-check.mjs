/**
 * Every key app.zon declares for a window must actually be read by the runner.
 *
 * Why this exists. src/runner.zig is a FORK of the SDK's own `app_runner`,
 * taken at 0.1.0 and never resynced. A fork that lags is not loud about it:
 * zon is a struct literal, so an unknown key parses fine and simply sits there.
 * If nothing reads it, the option silently takes the SDK struct's default and
 * the manifest becomes decoration.
 *
 * That is not hypothetical. Two live cases, both found only by hand:
 *
 *   .close_policy = "hide"   1.18 shipped a whole platform-specific manifest
 *                            generator to inject it on macOS. Nothing read it.
 *                            Closing the window quit the app for two releases.
 *   .min_width / .min_height declared since 0.1.0. Never read. The window has
 *                            always been resizable below its own layout floor.
 *
 * So: four checks, all cheap, all at build time.
 *
 *   1. app.zon → runner   every window/menu key the manifest declares appears
 *                         as a string literal in src/runner.zig. This is the
 *                         one that catches "declared but nobody reads it".
 *   2. main.zig → runner  no call-site option may hand the runner an empty
 *                         slice where null means "use the manifest". This is
 *                         the one that catches "the runner reads it, but the
 *                         caller already overrode it with nothing".
 *   3. SDK → runner       (only when the SDK is on disk) every field of the
 *                         SDK's WindowOptions is assigned in manifestWindow.
 *                         This is the one that catches the fork drifting
 *                         further behind as the SDK grows.
 *   4. version → version  app.zon and build.zig.zon agree, and no version is
 *                         hardcoded into a generated artifact name. This is
 *                         the one that catches a number nothing reads, which
 *                         is the kind that goes stale for twenty releases.
 *
 * Check 2 exists because check 1 was not enough. `.menus` passed check 1 the
 * whole time — runner.zig genuinely reads it — while src/main.zig passed
 * `.menus = &.{}` from 0.1.0 on. In Zig that is a non-null zero-length slice,
 * so `self.menus orelse storage.fromManifest()` never reached the manifest and
 * the menu bar app.zon declared in 1.10 was dead in every release that claimed
 * it. Same disease as close_policy, one link further down the chain: the
 * manifest was read, then discarded at the call site.
 *
 * The derived macOS manifest is checked too — generated fresh here, since a
 * key that only exists in the generated copy is exactly the shape of the 1.18
 * bug.
 *
 *   node scripts/manifest-check.mjs [--sdk /path/to/@native-sdk/cli]
 */
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const RUNNER = path.join(ROOT, "src", "runner.zig");

const failures = [];
const notes = [];
function check(ok, message) {
  if (!ok) failures.push(message);
}

// ---------------------------------------------------------------- zon reading

/** Drop `//` comments without touching `//` inside a string literal. */
function stripComments(src) {
  return src
    .split(/\r?\n/)
    .map((line) => {
      let out = "";
      let inStr = false;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          out += c;
          if (c === "\\") out += line[++i] ?? "";
          else if (c === '"') inStr = false;
          continue;
        }
        if (c === '"') {
          inStr = true;
          out += c;
          continue;
        }
        if (c === "/" && line[i + 1] === "/") break;
        out += c;
      }
      return out;
    })
    .join("\n");
}

/** Index of the `}` closing the `{` at `open`, string-aware. */
function matchBrace(src, open) {
  let depth = 0;
  let inStr = false;
  for (let i = open; i < src.length; i++) {
    const c = src[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Body of `.<key> = .{ ... }` at any nesting, or null. */
function blockBody(src, key) {
  const at = src.indexOf(`.${key} = .{`);
  if (at < 0) return null;
  const open = src.indexOf("{", at + key.length + 1);
  const close = matchBrace(src, open);
  if (close < 0) return null;
  return src.slice(open + 1, close);
}

/** `.name =` keys at depth 0 of `body`. */
function keysAtTopLevel(body) {
  const keys = [];
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (c === "." && depth === 0) {
      const m = /^\.([a-z_][a-z0-9_]*)\s*=/.exec(body.slice(i));
      if (m) keys.push(m[1]);
    }
  }
  return keys;
}

/** Each `.{ ... }` entry at depth 0 of `body`. */
function entriesAtTopLevel(body) {
  const entries = [];
  let depth = 0;
  let inStr = false;
  let start = -1;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") {
      if (depth === 0) start = i + 1;
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0 && start >= 0) entries.push(body.slice(start, i));
    }
  }
  return entries;
}

// -------------------------------------------------- 1. app.zon → src/runner.zig

const runnerSrc = fs.readFileSync(RUNNER, "utf8");

/** Does the runner actually LOOK the key up? A `@hasField` probe, a
 *  `windowFloat(window, "width", …)` argument — any real lookup counts.
 *  Comments do not (a key can be discussed and still unread), and neither do
 *  `@compileError` texts, which quote key names while teaching about them. */
const runnerCode = stripComments(runnerSrc)
  .split("\n")
  .filter((line) => !line.includes("@compileError"))
  .join("\n");
function runnerReads(key) {
  return runnerCode.includes(`"${key}"`);
}

// A window key the runner reads but never assigns into WindowOptions would slip
// through the literal check, so pin the assignments too.
function manifestWindowAssignments() {
  const at = runnerSrc.indexOf("fn manifestWindow(");
  if (at < 0) return null;
  const ret = runnerSrc.indexOf("return .{", at);
  if (ret < 0) return null;
  const open = runnerSrc.indexOf("{", ret);
  const close = matchBrace(runnerSrc, open);
  if (close < 0) return null;
  return keysAtTopLevel(runnerSrc.slice(open + 1, close));
}
const windowAssignments = manifestWindowAssignments();
check(windowAssignments !== null, "读不出 src/runner.zig 的 manifestWindow —— 这个自检要跟着改");
const assignedByRunner = new Set(windowAssignments ?? []);

/** Keys the runner is not expected to read: consumed by `native package` (the
 *  CLI reads app.zon itself for Info.plist/icons/bundling), not by the app. */
const PACKAGER_KEYS = new Set(["x", "y"]); // positional; folded into default_frame

function checkManifest(label, file) {
  const src = stripComments(fs.readFileSync(file, "utf8"));

  const windows = blockBody(src, "windows");
  check(windows !== null, `${label}: 找不到 .windows 块`);
  if (windows === null) return;

  const entries = entriesAtTopLevel(windows);
  check(entries.length > 0, `${label}: .windows 是空的`);

  for (const [index, entry] of entries.entries()) {
    for (const key of keysAtTopLevel(entry)) {
      if (PACKAGER_KEYS.has(key)) continue;
      check(
        runnerReads(key),
        `${label}: .windows[${index}].${key} 声明了，但 src/runner.zig 从不读它 —— ` +
          `zon 不会报错，这个键就是摆设（1.18 的 close_policy 正是这样白写了两个版本）`,
      );
    }
    notes.push(`${label}: .windows[${index}] 共 ${keysAtTopLevel(entry).length} 个键`);
  }

  const menus = blockBody(src, "menus");
  if (menus) {
    for (const menu of entriesAtTopLevel(menus)) {
      const items = blockBody(menu, "items");
      if (!items) continue;
      for (const item of entriesAtTopLevel(items)) {
        for (const key of keysAtTopLevel(item)) {
          check(runnerReads(key), `${label}: 菜单项的 .${key} 声明了，但 src/runner.zig 从不读它`);
        }
      }
    }
  }

  // The security block is the one that bites quietly: a policy nobody reads
  // still *looks* enforced, and until 1.20 `.external_links.action` was exactly
  // that — it said "deny", nothing read it, and it behaved as deny only because
  // that is the SDK's struct default.
  const security = blockBody(src, "security");
  if (security) {
    const nav = blockBody(security, "navigation");
    check(nav !== null, `${label}: .security 里没有 .navigation`);
    for (const key of keysAtTopLevel(nav || "")) {
      check(runnerReads(key), `${label}: .security.navigation.${key} 声明了，但 src/runner.zig 从不读它`);
    }
    const ext = nav && blockBody(nav, "external_links");
    for (const key of keysAtTopLevel(ext || "")) {
      check(runnerReads(key),
        `${label}: .security.navigation.external_links.${key} 声明了，但 src/runner.zig 从不读它 ——` +
        `「和 SDK 默认值恰好一致」不算被读`);
    }
  }

  // Top-level sections. Some are ours, some are the packager's — the split is
  // written down here rather than left to be rediscovered.
  // 1.20 also listed display_name / version / description here, filed under
  // "Info.plist / bundle identity". That was wrong: the SDK's own runner passes
  // all three into AppInfo for the about panel and dev runs, so exempting them
  // hid three manifest keys with no reader — the very thing this file exists to
  // find, waved through by its own allowlist. Anything that stays here has to
  // be a key the APP genuinely never sees.
  const PACKAGER_SECTIONS = new Set([
    "id", "name", // bundle identifier and the package basename, `native package` only
    "icons", "platforms", // iconset + target validation, `native package` only
    "frontend", // the dist to bundle; the app side reads it in src/main.zig
  ]);
  // The manifest itself is one `.{ … }`, so the sections sit one level in —
  // walking the raw file finds nothing and this loop quietly checked zero keys
  // while still printing ok. Which is the exact failure mode this file exists
  // to catch, so: assert it found something.
  const rootOpen = src.indexOf("{");
  const rootBody = rootOpen < 0 ? "" : src.slice(rootOpen + 1, matchBrace(src, rootOpen));
  const topKeys = keysAtTopLevel(rootBody);
  check(topKeys.length >= 5, `${label}: 只解析出 ${topKeys.length} 个顶层段,清单结构变了`);
  notes.push(`${label}: 顶层 ${topKeys.length} 段 —— ${topKeys.join(" ")}`);
  for (const key of topKeys) {
    if (PACKAGER_SECTIONS.has(key)) continue;
    check(runnerReads(key), `${label}: 顶层 .${key} 声明了，但 src/runner.zig 从不读它 —— ` +
      `如果它本来就该由 native package 消费，把它加进 PACKAGER_SECTIONS 并写明理由`);
  }
}

checkManifest("app.zon", path.join(ROOT, "app.zon"));

// The derived macOS manifest exists only to inject a key. If the runner cannot
// read that key, the whole generator is a no-op — which is precisely what 1.18
// shipped. Generate it fresh so the check never runs against a stale copy.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "manifest-check-"));
try {
  const derived = path.join(tmp, "app.macos.zon");
  execFileSync(process.execPath, [path.join(HERE, "gen-manifest.mjs"), "macos", "--out", derived], {
    cwd: ROOT,
    stdio: "pipe",
  });
  checkManifest("build/app.macos.zon（生成的）", derived);
} catch (err) {
  failures.push(`生成 macOS 清单失败: ${err.message}`);
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

// --------------------------------------------- 2. src/main.zig → src/runner.zig

// Every RunOptions field that defaults to null is one where null is the signal
// to fall back — to app.zon (.security, .commands, .menus, .shortcuts) or to
// "no such thing" (.bridge). An empty literal is never that signal, whichever
// kind it is: `.security = .{}` was the 1.19.1 bug and `.menus = &.{}` the one
// above. Derived from runner.zig rather than listed here, so a new
// manifest-backed option is covered the day it is added.
{
  const mainSrc = stripComments(fs.readFileSync(path.join(ROOT, "src", "main.zig"), "utf8"));
  const optsAt = runnerSrc.indexOf("pub const RunOptions = struct {");
  const optsOpen = runnerSrc.indexOf("{", optsAt);
  const optsBody = optsAt < 0 ? "" : runnerSrc.slice(optsOpen + 1, matchBrace(runnerSrc, optsOpen));
  const fallbackFields = [...optsBody.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:\s*\?[^=\n]*=\s*null\s*,/gm)]
    .map((m) => m[1]);

  check(fallbackFields.length > 0, "main.zig 交叉检查: 没能从 RunOptions 解析出任何「null 表示回落」的字段");
  notes.push(`main.zig 交叉检查: ${fallbackFields.length} 个字段以 null 表示回落 —— ${fallbackFields.join(" ")}`);

  for (const field of fallbackFields) {
    // `&.{}` and `.{}` both build a non-null empty value; both silently win
    // over the manifest. Passing nothing at all is the only way to defer.
    const empty = new RegExp(`\\.${field}\\s*=\\s*&?\\.\\{\\s*\\}`);
    check(
      !empty.test(mainSrc),
      `main.zig 交叉检查: runWithOptions 传了 .${field} = &.{} —— 这是非空的零长切片，` +
        `会盖掉 app.zon 里的 .${field}（\`orelse\` 只认 null）。要用清单就整个别传这个字段`,
    );
  }
}

// ------------------------------------------------------ 3. SDK → src/runner.zig

const sdkArg = process.argv.indexOf("--sdk");
const sdkPath = sdkArg > 0 ? process.argv[sdkArg + 1] : process.env.SDK_PATH;
/** field names of a `pub const <Name> = struct { … }` in an SDK source file */
function sdkStructFields(file, name) {
  const src = stripComments(fs.readFileSync(file, "utf8"));
  const at = src.indexOf(`pub const ${name} = struct {`);
  if (at < 0) return null;
  const open = src.indexOf("{", at);
  const body = src.slice(open, matchBrace(src, open) + 1);
  return [...body.matchAll(/^\s{4}([a-z_][a-z0-9_]*)\s*:/gm)].map((m) => m[1]);
}
/**
 * Every field a runner function assigns, anywhere in its body: both `.field =`
 * inside a struct literal and `info.field =` afterwards. The first version of
 * this looked only at the function's first `return .{ … }`, which for `appInfo`
 * matched a *later* function entirely and reported all eleven fields missing.
 */
function runnerAssignments(fn) {
  const at = runnerSrc.indexOf(fn + "(");
  if (at < 0) return null;
  const open = runnerSrc.indexOf("{", runnerSrc.indexOf(")", at));
  const close = matchBrace(runnerSrc, open);
  if (close < 0) return null;
  const body = runnerSrc.slice(open + 1, close);
  return [...body.matchAll(/\.([a-z_][a-z0-9_]*)\s*=[^=]/g)].map((m) => m[1]);
}

if (sdkPath && fs.existsSync(path.join(sdkPath, "src", "platform", "types.zig"))) {
  const typesFile = path.join(sdkPath, "src", "platform", "types.zig");
  // Every SDK struct this fork rebuilds by hand. 1.20 checked only
  // WindowOptions — and AppInfo had drifted to 11 fields against the runner's
  // 7, three of which app.zon declares. One struct was never the class.
  const MIRRORED = [
    { struct: "WindowOptions", file: typesFile, assigns: assignedByRunner, where: "manifestWindow" },
    { struct: "AppInfo", file: typesFile, assigns: new Set(runnerAssignments("fn appInfo") ?? []), where: "appInfo" },
  ];
  for (const m of MIRRORED) {
    const sdkFields = sdkStructFields(m.file, m.struct);
    check(sdkFields && sdkFields.length > 0, `SDK 交叉检查: 解析 ${m.struct} 失败`);
    if (!sdkFields) continue;
    for (const field of sdkFields) {
      check(
        m.assigns.has(field),
        `SDK 交叉检查: ${m.struct}.${field} 是 SDK 的字段，但 src/runner.zig 的 ${m.where} 不给它赋值 —— ` +
          `这个 fork 又落后了一格，声明了也是白声明`,
      );
    }
    notes.push(`SDK 交叉检查: ${m.struct} 共 ${sdkFields.length} 个字段，${m.where} 赋值 ${m.assigns.size} 个`);
  }
  // --- build.zig 也是一份手抄件 -----------------------------------------
  //
  // 上面查的是 src/runner.zig 落后没有。build.zig 是同一件事的另一半:它是
  // SDK 自己的 build/app.zig 的手抄件,而手抄件不会告诉你原件多了一页。
  //
  // 这不是假设。0.8.0 往 Windows 加了 src/platform/windows/gpu_surface_renderer.cpp
  // 并让 webview2_host.cpp 调它,我们的清单里没有这个文件 —— 于是链接器报
  // undefined symbol: createWindowsGpuRenderer()。当时的结论写的是「0.8.0 带
  // 进来一个 Windows 回归」,还据此把 SDK 钉回 0.7.1、写进了三个 workflow 和
  // 两份发布说明。回归是我们自己的:少抄了一页。d2d1/dwrite 两个库同理。
  //
  // 所以:SDK 编的每个平台源文件、链接的每个系统库,我们都得有。反过来不查 ——
  // 我们可以为自己的理由多编一个文件,但不能少。
  const appZig = path.join(sdkPath, "build", "app.zig");
  if (fs.existsSync(appZig)) {
    const sdkBuild = fs.readFileSync(appZig, "utf8");
    const ourBuild = fs.readFileSync(path.join(ROOT, "build.zig"), "utf8");
    const pick = (src, re) => new Set([...src.matchAll(re)].map((m) => m[1]));
    const sdkSrc = pick(sdkBuild, /dep\.path\("(src\/platform\/[^"]+)"/g);
    const ourSrc = pick(ourBuild, /nativeSdkPath\(b, native_sdk_path, "(src\/platform\/[^"]+)"/g);
    for (const f of sdkSrc) {
      check(ourSrc.has(f),
        `SDK 交叉检查: SDK 的 build/app.zig 编译 ${f},build.zig 没有 —— ` +
        `手抄的源文件清单又落后了一页(上一次这样,Windows 链接器报的是 undefined symbol)`);
    }
    const sdkLib = pick(sdkBuild, /linkSystemLibrary\("([a-z0-9+_]+)"/g);
    const ourLib = pick(ourBuild, /linkSystemLibrary\("([a-z0-9+_]+)"/g);
    for (const l of sdkLib) {
      check(ourLib.has(l),
        `SDK 交叉检查: SDK 链接系统库 ${l},build.zig 不链接 —— 同一份手抄件的另一半`);
    }
    notes.push(`SDK 交叉检查: 平台源文件 ${sdkSrc.size} 个、系统库 ${sdkLib.size} 个,build.zig 全都有`);
  } else {
    notes.push("SDK 交叉检查: 找不到 build/app.zig，源文件清单这一项跳过");
  }
} else {
  notes.push("SDK 交叉检查: 跳过（没给 --sdk / SDK_PATH，本地没有 SDK 源码）");
}

// ---------------------------------------------------- 4. 版本号只有一个真相
// build.zig.zon carried .version = "0.1.0" from the first commit to 1.21, and
// build.zig printed that same literal into the packaged artifact's filename.
// Neither is read by the app — app.zon is the manifest the runner sees — which
// is exactly why nobody noticed: a version that nothing depends on drifts for
// twenty releases and only ever misleads whoever is holding the file.
{
  const appZon = fs.readFileSync(path.join(ROOT, "app.zon"), "utf8");
  const buildZon = fs.readFileSync(path.join(ROOT, "build.zig.zon"), "utf8");
  const buildZig = fs.readFileSync(path.join(ROOT, "build.zig"), "utf8");
  const ver = (src) => (/\.version\s*=\s*"([^"]+)"/.exec(src) || [])[1] || null;
  const appVer = ver(appZon), buildVer = ver(buildZon);
  check(!!appVer, "版本检查: app.zon 没有 .version");
  check(!!buildVer, "版本检查: build.zig.zon 没有 .version");
  check(
    appVer === buildVer,
    `版本检查: build.zig.zon 写 ${buildVer}，app.zon 写 ${appVer} —— ` +
      "两个版本号谁也不校验谁，放着就会一路错下去",
  );
  // and no hand-written version may creep back into a generated artifact name
  const pkgLine = /zig-out\/package\/[^"]*/.exec(buildZig);
  check(
    !pkgLine || !/\d+\.\d+\.\d+/.test(pkgLine[0]),
    "版本检查: build.zig 又把版本号硬编码进了打包路径 —— " +
      "那串数字没有任何东西会跟着更新",
  );
  // 5.1: package.json and its lock said 1.25.0 while app.zon said 5.0.0 — the
  // one version a `git clone && npm ci` reads first was twenty releases stale
  // (audit F8). Three files, one number.
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(ROOT, "package-lock.json"), "utf8"));
  check(pkg.version === appVer, `版本检查: package.json 写 ${pkg.version}，app.zon 写 ${appVer}`);
  check(lock.version === appVer && lock.packages && lock.packages[""] && lock.packages[""].version === appVer,
    `版本检查: package-lock.json 写 ${lock.version}，app.zon 写 ${appVer}`);
  // and the lock must let every platform this app is built on install it: the
  // 5.0.0 lock carried only the linux-x64 esbuild binary, so `npm ci` on a Mac
  // or a Windows machine failed on the first command in the README
  const esb = (lock.packages["node_modules/esbuild"] || {}).optionalDependencies || {};
  const missing = Object.keys(esb).filter((k) => !lock.packages["node_modules/" + k]);
  check(missing.length === 0,
    `版本检查: package-lock.json 缺少 esbuild 的平台包 ${missing.join(", ")} —— 只有生成它的那台机器装得起来`);
  if (appVer) notes.push(`版本检查: app.zon、build.zig.zon、package.json、package-lock.json 一致（${appVer}）`);
}

// ------------------------------------------------ 5. host.js ↔ main.zig 内建桥
// SDK 0.8 起，对话框 / 系统 / 剪贴板这些内建命令没有隐含权限：不在 main.zig 的
// builtin_bridge 策略里的一律拒绝，而 host.js 把拒绝读成「这一构建没有对话框」
// 走浏览器回退。5.0.0 → 5.2.0 三个版本里没有一次原生文件对话框真的弹出来过，
// 而 CI 全绿 —— 因为没有任何检查把页面调用的命令和 zig 侧放行的命令对到一起。
// 这里对：页面用到的每个 `zero.X.Y` 必须在 main.zig 放行，放行的也必须被用到。
{
  const hostSrc = fs.readFileSync(path.join(ROOT, "src/web/js/host.js"), "utf8");
  const mainSrc = fs.readFileSync(path.join(ROOT, "src/main.zig"), "utf8");
  const NS = { dialogs: "dialog", os: "os", clipboard: "clipboard", platform: "platform" };
  const used = new Set();
  for (const m of hostSrc.matchAll(/global\.zero\.([a-zA-Z]+)\.([a-zA-Z]+)\(/g)) {
    if (m[1] === "on" || m[1] === "off") continue;
    const ns = NS[m[1]];
    if (ns) used.add("native-sdk." + ns + "." + m[2]);
  }
  const block = /const BUILTIN_COMMANDS = \[_\]\[\]const u8\{([\s\S]*?)\};/.exec(mainSrc);
  check(!!block, "内建桥: main.zig 里有 BUILTIN_COMMANDS 列表");
  const granted = new Set(block ? [...block[1].matchAll(/"([a-z.-]+)"/gi)].map((m) => m[1]) : []);
  for (const u of used) check(granted.has(u), `内建桥: host.js 调用了 ${u}，但 main.zig 没有放行 —— 原生构建里它会静默走浏览器回退`);
  for (const g of granted) check(used.has(g), `内建桥: main.zig 放行了 ${g}，但页面从不调用它`);
  check(/\.builtin_bridge = app_state\.builtinBridge\(\)/.test(mainSrc), "内建桥: 策略真的传给了 runner（.builtin_bridge）");
  notes.push(`内建桥: host.js 调用 ${used.size} 个 SDK 命令，main.zig 放行 ${granted.size} 个，一致`);
}

// ------------------------------------------------------------------------ 结果

for (const note of notes) console.log(`  ${note}`);
if (failures.length) {
  console.error("");
  for (const failure of failures) console.error(`FAIL: ${failure}`);
  process.exit(1);
}
console.log("ok: 清单里声明的每个键，runner 都真的在读");
