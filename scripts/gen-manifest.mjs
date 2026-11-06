/**
 * Derive a platform manifest from app.zon.
 *
 * Everything in app.zon is portable except one field. `close_policy` says what
 * the window's close affordance does, and the two desktop platforms want
 * different answers:
 *
 *   macOS    — the red button / ⌘W should hide the window and leave the app
 *              running; the Dock icon brings it back. That is the platform
 *              convention, and `"hide"` needs no capability there because the
 *              dock-reopen path always exists.
 *   Windows  — closing really should quit. `"hide"` is a *comptime error*
 *              without a declared tray, and rightly so: SW_HIDE removes the
 *              taskbar entry and Windows has no dock reopen, so a hidden
 *              window would be a running, invisible, unreachable app. A chess
 *              app has no business living in the system tray.
 *
 * `close_policy` is a per-window field and `platforms` (PlatformSettings)
 * carries no window overrides, so one manifest cannot say both. The SDK's own
 * error text points the way — "scope the .hide declaration to macos/windows
 * builds" — which is what this does: app.zon stays the portable truth with the
 * default `"quit"`, and macOS builds compile against a derived copy.
 *
 * Derived, not duplicated: it reads app.zon and injects one field, so the two
 * can never drift. Anything else that needs to differ per platform belongs
 * here too, next to a comment saying why it cannot be portable.
 *
 * Injecting a key is only half the job — something has to READ it. This script
 * shipped in 1.18 next to a runner that did not, so the whole generator was a
 * no-op for two releases and closing the window still quit the app. That is
 * what scripts/manifest-check.mjs now guards, and it checks THIS file's output,
 * not just app.zon: a key that exists only in the derived copy is exactly the
 * shape that got through.
 *
 * 20.0 (v20-0-plan A1): `--ui app` derives the manifest the 20.0 frontend
 * (src/app, `zig build -Dui=app`) is built against, for either platform:
 *
 *   spa_fallback off   a missing file must be missing (a 404), not
 *                      index.html answered with 200 — the asset reads check
 *                      what came back, but a wasm or a weights file that is
 *                      silently a web page is the bug ADR 0001 is about;
 *   "sqlite"           the SDK's RelationalStore (ADR 0003): the runner opens
 *                      the app's database and the db service writes to it.
 *
 * Kept out of app.zon while the 19.0 UI is the default: its build opens no
 * database and its page was written against the fallback. main.zig refuses
 * at comptime to build -Dui=app against a manifest without both.
 *
 *   node scripts/gen-manifest.mjs macos [--out build/app.macos.zon]
 *   node scripts/gen-manifest.mjs macos --ui app     → build/app.macos-app.zon
 *   node scripts/gen-manifest.mjs windows --ui app   → build/app.windows-app.zon
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SRC = path.join(ROOT, "app.zon");

const platform = process.argv[2];
const uiArg = process.argv.indexOf("--ui");
const ui = uiArg > 0 ? process.argv[uiArg + 1] : "web";
if (!["web", "app"].includes(ui)) {
  console.error("usage: --ui web|app");
  process.exit(2);
}
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 && process.argv[outArg + 1]
  ? path.resolve(ROOT, process.argv[outArg + 1])
  : path.join(ROOT, "build", `app.${platform}${ui === "app" ? "-app" : ""}.zon`);

// Only macOS needs a derived manifest today: Windows wants the portable
// default, so its build compiles app.zon directly rather than a copy that
// would be identical and one more thing to keep in step.
if (platform !== "macos" && !(platform === "windows" && ui === "app")) {
  console.error("usage: node scripts/gen-manifest.mjs macos [--ui app] [--out path] | windows --ui app [--out path]");
  console.error("（Windows 用 app.zon 原件:它要的就是默认的 quit）");
  process.exit(2);
}

const src = fs.readFileSync(SRC, "utf8");
// Match the source's line endings. A Windows checkout has app.zon in CRLF, and
// splicing an LF line into it produced a mixed-ending manifest — which the
// self-check caught by refusing to see the two files as differing by exactly
// one line. Zig would not have cared; a manifest with two kinds of newline in
// it is still wrong.
const EOL = src.includes("\r\n") ? "\r\n" : "\n";

/** Per-platform edits. Each one states what it changes and why it cannot be portable. */
const EDITS = {
  // Close hides the window; the Dock icon re-shows it. No capability needed —
  // the dock-reopen path always exists on macOS.
  macos: [{
    why: "关窗改为隐藏(macOS 惯例;Dock 图标点回来)",
    find: /(\{\s*\n\s*\.label = "main",)/,
    apply: (m) => `${m}${EOL}            .close_policy = "hide",`,
  }],
  windows: [],
};
/** The 20.0 UI's two (see the header): any platform. */
const UI_APP_EDITS = [{
  why: "spa_fallback 关掉(缺失的文件是 404,ADR 0001)",
  find: /\.spa_fallback = true,/,
  apply: () => ".spa_fallback = false,",
}, {
  why: "声明 sqlite 能力(SDK 的 RelationalStore,ADR 0003)",
  find: /\.capabilities = \.\{"webview"\},/,
  apply: () => '.capabilities = .{ "webview", "sqlite" },',
}];

let out = src;
const applied = [];
for (const edit of [...EDITS[platform], ...(ui === "app" ? UI_APP_EDITS : [])]) {
  const m = edit.find.exec(out);
  if (!m) {
    console.error(`FAIL: app.zon 里找不到该改的地方(${edit.why})—— 清单结构变了,这个脚本要跟着改`);
    process.exit(1);
  }
  if (edit.why.startsWith("关窗") && /\.close_policy\s*=/.test(out)) {
    console.error("FAIL: app.zon 自己已经写了 close_policy —— 那它就不该由这个脚本注入,两处会打架");
    process.exit(1);
  }
  out = out.replace(edit.find, (mm) => edit.apply(mm));
  applied.push(edit.why);
}

// A generated manifest that silently equals its source is a footgun: the build
// would look platform-aware and be nothing of the kind.
if (out === src) {
  console.error("FAIL: macOS 清单和 app.zon 一模一样,说明什么也没注入");
  process.exit(1);
}

const banner = `// 由 scripts/gen-manifest.mjs 从 app.zon 生成 —— 不要手改,改 app.zon。${EOL}` +
  `// 这一份是 ${platform}${ui === "app" ? "(20.0 界面,-Dui=app)" : ""} 专用${applied.length ? ":" + applied.join("、") : "(与 app.zon 相同)"}${EOL}`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + out);
console.log(`${path.relative(ROOT, OUT)} ← app.zon` + (applied.length ? `(${applied.join("、")})` : "(无差异)"));
