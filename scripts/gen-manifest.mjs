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
 *   node scripts/gen-manifest.mjs macos [--out build/app.macos.zon]
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, "..");
const SRC = path.join(ROOT, "app.zon");

const platform = process.argv[2];
const outArg = process.argv.indexOf("--out");
const OUT = outArg > 0 && process.argv[outArg + 1]
  ? path.resolve(ROOT, process.argv[outArg + 1])
  : path.join(ROOT, "build", `app.${platform}.zon`);

// Only macOS needs a derived manifest today: Windows wants the portable
// default, so its build compiles app.zon directly rather than a copy that
// would be identical and one more thing to keep in step.
if (platform !== "macos") {
  console.error("usage: node scripts/gen-manifest.mjs macos [--out path]");
  console.error("（Windows 用 app.zon 原件:它要的就是默认的 quit）");
  process.exit(2);
}

const src = fs.readFileSync(SRC, "utf8");

/** Per-platform edits. Each one states what it changes and why it cannot be portable. */
const EDITS = {
  // Close hides the window; the Dock icon re-shows it. No capability needed —
  // the dock-reopen path always exists on macOS.
  macos: [{
    why: "关窗改为隐藏(macOS 惯例;Dock 图标点回来)",
    find: /(\{\s*\n\s*\.label = "main",)/,
    apply: (m) => `${m}\n            .close_policy = "hide",`,
  }],
};

let out = src;
const applied = [];
for (const edit of EDITS[platform]) {
  const m = edit.find.exec(out);
  if (!m) {
    console.error(`FAIL: app.zon 里找不到该改的地方(${edit.why})—— 清单结构变了,这个脚本要跟着改`);
    process.exit(1);
  }
  if (/\.close_policy\s*=/.test(out)) {
    console.error("FAIL: app.zon 自己已经写了 close_policy —— 那它就不该由这个脚本注入,两处会打架");
    process.exit(1);
  }
  out = out.replace(edit.find, (mm) => edit.apply(mm));
  applied.push(edit.why);
}

// A generated manifest that silently equals its source is a footgun: the build
// would look platform-aware and be nothing of the kind.
if (platform === "macos" && out === src) {
  console.error("FAIL: macOS 清单和 app.zon 一模一样,说明什么也没注入");
  process.exit(1);
}

const banner = `// 由 scripts/gen-manifest.mjs 从 app.zon 生成 —— 不要手改,改 app.zon。\n` +
  `// 这一份是 ${platform} 专用${applied.length ? ":" + applied.join("、") : "(与 app.zon 相同)"}\n`;
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, banner + out);
console.log(`${path.relative(ROOT, OUT)} ← app.zon` + (applied.length ? `(${applied.join("、")})` : "(无差异)"));
