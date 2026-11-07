const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

// v8-2-plan F2: this file is the entry and the wiring — App (the state every
// handler shares and what it hands the runner), onEvent / onStop and main().
// What the handlers do lives next to it, moved verbatim with their tests:
//   bridge.zig   the chess.* command table and the builtin-bridge grants
//                (none), the sizes and JSON helpers, the self-test commands;
//   dialogs.zig  chess.openPgn (the native open dialog) and chess.openedFile;
//   opened.zig   files the OS hands over (double-click, drop, a second
//                launch on Windows) and the one-instance handover;
//   menus.zig    the menu bar's languages, what a menu command becomes for
//                the page, quit and the Windows About box;
//   engine.zig   the native Stockfish process; db.zig the SQLite store.
// Each file names what it takes from the others in the `@import` lines at
// its top.

// The trusted origins live in app.zon (.security.navigation.allowed_origins).
// runner.manifestOrigins() reads them from there, so the bridge command
// policies below and the webview navigation policy can never disagree — this
// used to be a second hand-written copy sitting next to the manifest's.
// Called where it is used rather than bound to a container-level const: the
// runner fills a static buffer, so it is a runtime call, not a comptime one.

// The menu bar comes from app.zon (.menus) — runner.resolvedMenus() falls back
// to the manifest only when this call site leaves `.menus` null, so it is left
// unset below. It used to be `.menus = &.{}`, which reads like "no custom
// menus" but is a non-null zero-length slice: `self.menus orelse
// storage.fromManifest()` took the empty slice and the manifest's three menus
// never reached the Runtime. That is why 1.10 filling app.zon changed nothing
// visible, and why 1.18's ⌘⇧H fix landed on a wire that was never live.
// scripts/manifest-check.mjs now fails the build if this override comes back.
//
// 6.0 (Q1.6): for a non-Chinese UI language main.zig hands the runner a
// *localized copy* of the manifest menus (see localizedMenus) — a real slice
// built from app.zon, never an empty one. Chinese stays null → manifest.
// 20.0 E3: the page's language rebuilds the bar live (menus.zig).

const APP_COMMANDS = @import("bridge.zig").APP_COMMANDS;
const BUILTIN_COMMANDS = @import("bridge.zig").BUILTIN_COMMANDS;
const LANG_FILE = @import("bridge.zig").LANG_FILE;
const SEP = @import("bridge.zig").SEP;
const Opened = @import("dialogs.zig").Opened;
const menus_mod = @import("menus.zig");
const commandDetail = menus_mod.commandDetail;
const languageTag = menus_mod.languageTag;
const windowTitleFor = menus_mod.windowTitleFor;
const opened = @import("opened.zig");
const engine = @import("engine.zig");

// The app's db service needs the store (ADR 0003), and its asset reads need
// a missing file to be missing (ADR 0001) — refused here rather than found on
// a device.
comptime {
    if (!runner.manifest_sqlite) @compileError("the manifest must declare the sqlite capability (app.zon .capabilities)");
    if (runner.manifest_spa_fallback) @compileError("the manifest must set spa_fallback = false (app.zon .frontend)");
}

/// The page's directory, relative: what app.zon's .frontend.dist names and
/// what a dev run (or the macOS host, inside the .app) resolves.
const FRONTEND_DIST = "frontend/dist";

/// `<exe dir>\..\resources\frontend\dist`: where `native package --target
/// windows` puts the page relative to bin\chessboard.exe. Null when the exe
/// directory has no parent or the path does not fit.
fn packagedAssetRoot(buf: []u8, exe_dir: []const u8) ?[]const u8 {
    const base = std.fs.path.dirname(exe_dir) orelse return null;
    const sep = std.fs.path.sep;
    return std.fmt.bufPrint(buf, "{s}{c}resources{c}frontend{c}dist", .{ base, sep, sep, sep }) catch null;
}

/// The icon a dev run (and the macOS bundle) uses.
const ICON_PATH = "assets/icon.png";

/// `<exe dir>\..\resources\<name>`, beside the packaged page.
fn packagedResource(buf: []u8, exe_dir: []const u8, name: []const u8) ?[]const u8 {
    const base = std.fs.path.dirname(exe_dir) orelse return null;
    const sep = std.fs.path.sep;
    return std.fmt.bufPrint(buf, "{s}{c}resources{c}{s}", .{ base, sep, sep, name }) catch null;
}

/// v8-4-plan V1: the environment variable the WebView2 loader takes the user
/// data folder from when the caller names none — and SDK 0.10.1 names none
/// (webview2_host.cpp createChildWebView calls
/// CreateCoreWebView2EnvironmentWithOptions(nullptr, nullptr, nullptr, …)).
const WEBVIEW2_USER_DATA_ENV = "WEBVIEW2_USER_DATA_FOLDER";

/// v8-4-plan V1, the decision on its own so it can be tested off Windows: the
/// folder to put in WEBVIEW2_USER_DATA_FOLDER, or null to leave WebView2 on
/// its default (`<exe dir>\<exe name>.WebView2`). Only a non-writable exe
/// directory moves it, so no existing install — which works, so its exe
/// directory is writable — ever sees its WebView2 data change place. A value
/// someone already set is theirs; no %LOCALAPPDATA% leaves the default too.
fn webview2UserDataFallback(buf: []u8, exe_dir_writable: bool, already_set: bool, local_app_data: ?[]const u8) ?[]const u8 {
    if (exe_dir_writable or already_set) return null;
    const raw = local_app_data orelse return null;
    const base = std.mem.trimEnd(u8, raw, "\\/");
    if (base.len == 0) return null;
    return std.fmt.bufPrint(buf, "{s}\\Chessboard\\WebView2", .{base}) catch null;
}

/// v8-4-plan V1: whether a file can be created in `dir` — make one and delete
/// it. Any error counts as "no".
fn dirWritable(io: std.Io, dir: []const u8, unique: u32) bool {
    var buf: [4200]u8 = undefined;
    const probe = std.fmt.bufPrint(&buf, "{s}{c}.chessboard-write-probe-{d}", .{ dir, std.fs.path.sep, unique }) catch return false;
    var file = std.Io.Dir.createFileAbsolute(io, probe, .{}) catch return false;
    file.close(io);
    std.Io.Dir.deleteFileAbsolute(io, probe) catch {};
    return true;
}

/// The loader reads the process environment block, which std.process.Environ
/// only copies, so the variable goes in through kernel32 itself.
extern "kernel32" fn SetEnvironmentVariableW(name: [*:0]const u16, value: ?[*:0]const u16) callconv(.winapi) std.os.windows.BOOL;

pub const App = struct {
    env_map: *std.process.Environ.Map,
    io: std.Io,
    handlers: [APP_COMMANDS.len]native_sdk.BridgeHandler = undefined,
    policies: [APP_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    builtin_policies: [BUILTIN_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    /// The per-user data directory, resolved once in main() from the
    /// environment — "" when the platform gave no home (then the menu
    /// language is not kept and a second Windows launch cannot hand over).
    /// Slices into appdata_dir_buf, so App must not move after
    /// resolveAppDataDir() ran; main() keeps it in one place.
    appdata_dir_buf: [1024]u8 = undefined,
    appdata_dir: []const u8 = "",
    /// Where the WebView reads the page from. v8-3-plan V1 (8.2.1): SDK
    /// 0.10.1's WebView2 host joins a relative asset root to the process's
    /// current directory (webview2_host.cpp assetFilePath) — unlike the macOS
    /// host, which resolves it inside the .app — and `native package` puts
    /// the exe in Chessboard\bin with the page in Chessboard\resources. So a
    /// packaged Windows app started from Explorer (current directory bin\)
    /// found no page. main() points this at the packaged copy beside the exe
    /// when there is one; a dev run keeps the relative path. Slices into
    /// asset_root_buf, so App must not move after resolveAssetRoot() ran.
    asset_root_buf: [4096]u8 = undefined,
    asset_root: []const u8 = FRONTEND_DIST,
    /// The icon the window and the platform's notifications show.
    /// v8-3-plan V2: on Windows the host loads it with LoadImageW(IMAGE_ICON)
    /// from a path joined to the current directory — "assets/icon.png" was
    /// never found there, and a PNG is no IMAGE_ICON — so notifications fell
    /// back to the system's generic icon. build-windows.yml ships icon.ico in
    /// resources\ and main() points this at it. Slices into icon_path_buf.
    icon_path_buf: [4096]u8 = undefined,
    icon_path: []const u8 = ICON_PATH,
    /// v8-1-plan N2 — the Runtime, for the file dialog chess.openPgn opens,
    /// the menu bar's rebuild and the engine's wake. A bridge handler is
    /// handed no Runtime, so runner.zig fills this in (RunOptions.runtime_slot)
    /// before the loop starts; null outside the runner (tests), which answers
    /// "no dialogs".
    runtime: ?*native_sdk.Runtime = null,
    /// v8-1-plan N2 — the file chess.openPgn is handing over in pieces.
    opened: Opened = .{},
    /// 20.0 E3 — the file chess.openedFile is handing over in pieces.
    handed: Opened = .{},
    /// v20-0-plan F3 — the native Stockfish process (engine.zig).
    engine: engine.Engine = .{},
    /// Q1.6 — localized copies of the manifest menus. Same storage shape as
    /// runner.MenuStorage.
    menu_storage: runner.MenuStorage = .{},
    menu_items: [native_sdk.platform.max_menu_items]native_sdk.MenuItem = undefined,
    menus: [native_sdk.platform.max_menus]native_sdk.Menu = undefined,
    /// 20.0 E3 — the language the bar is in, and whether the platform's own
    /// menus were finished for it (menus.zig finishPlatformMenus).
    menu_lang: []const u8 = "zh",
    menus_finished: bool = false,

    fn app(self: *@This()) native_sdk.App {
        return .{
            .context = self,
            .name = "chessboard",
            .source = native_sdk.frontend.productionSource(.{ .dist = self.asset_root }),
            .source_fn = source,
            .event_fn = onEvent,
            .stop_fn = onStop,
        };
    }

    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist = self.asset_root,
            .entry = "index.html",
        });
    }

    /// v8-3-plan V1 (8.2.1): see asset_root. Windows only — the macOS host
    /// already resolves the relative root inside the bundle.
    fn resolveAssetRoot(self: *@This()) void {
        if (builtin.os.tag != .windows) return;
        var exe_buf: [4096]u8 = undefined;
        const n = std.process.executableDirPath(self.io, &exe_buf) catch return;
        const root = packagedAssetRoot(&self.asset_root_buf, exe_buf[0..n]) orelse return;
        var probe_buf: [4096]u8 = undefined;
        const probe = std.fmt.bufPrint(&probe_buf, "{s}{c}index.html", .{ root, std.fs.path.sep }) catch return;
        var file = std.Io.Dir.openFileAbsolute(self.io, probe, .{}) catch return;
        file.close(self.io);
        self.asset_root = root;
        // v8-3-plan V2: the notification icon, from the same resources folder
        const icon = packagedResource(&self.icon_path_buf, exe_buf[0..n], "icon.ico") orelse return;
        var icon_file = std.Io.Dir.openFileAbsolute(self.io, icon, .{}) catch return;
        icon_file.close(self.io);
        self.icon_path = icon;
    }

    /// v8-4-plan V1: WebView2 keeps its user data beside the exe unless told
    /// otherwise, so a copy unzipped where the user cannot write (Program
    /// Files) had nowhere to put it and the page could fail to come up. Then,
    /// and only then, point WEBVIEW2_USER_DATA_FOLDER at
    /// %LOCALAPPDATA%\Chessboard\WebView2 — before the runner starts and the
    /// SDK creates the WebView2 environment. Windows only; the app's own save
    /// file is in resolveAppDataDir's folder either way.
    fn resolveWebView2UserData(self: *@This()) void {
        if (builtin.os.tag != .windows) return;
        var exe_buf: [4096]u8 = undefined;
        const n = std.process.executableDirPath(self.io, &exe_buf) catch return;
        const writable = dirWritable(self.io, exe_buf[0..n], std.os.windows.GetCurrentProcessId());
        var folder_buf: [1100]u8 = undefined;
        const folder = webview2UserDataFallback(
            &folder_buf,
            writable,
            self.env_map.get(WEBVIEW2_USER_DATA_ENV) != null,
            self.env_map.get("LOCALAPPDATA"),
        ) orelse return;
        std.Io.Dir.cwd().createDirPath(self.io, folder) catch return;
        var wide: [1101]u16 = undefined;
        const len = std.unicode.wtf8ToWtf16Le(wide[0 .. wide.len - 1], folder) catch return;
        wide[len] = 0;
        _ = SetEnvironmentVariableW(std.unicode.wtf8ToWtf16LeStringLiteral(WEBVIEW2_USER_DATA_ENV), wide[0..len :0]);
    }

    pub fn bridge(self: *@This()) native_sdk.BridgeDispatcher {
        for (APP_COMMANDS, 0..) |cmd, index| {
            self.handlers[index] = .{ .name = cmd.name, .context = self, .invoke_fn = cmd.invoke_fn };
            self.policies[index] = .{
                .name = cmd.name,
                .origins = runner.manifestOrigins(),
            };
        }
        return .{
            .policy = .{
                .enabled = true,
                .commands = self.policies[0..],
            },
            .registry = .{ .handlers = self.handlers[0..] },
            .async_registry = .{ .handlers = &.{} },
        };
    }

    /// Same origins as the app's own commands — the manifest's, so the two
    /// policies and the navigation policy can never disagree.
    fn builtinBridge(self: *@This()) native_sdk.BridgePolicy {
        for (BUILTIN_COMMANDS, 0..) |name, index| {
            self.builtin_policies[index] = .{
                .name = name,
                .origins = runner.manifestOrigins(),
            };
        }
        return .{
            .enabled = true,
            .commands = self.builtin_policies[0..],
        };
    }

    /// Q1.1: where user data lives. The plan names the directories outright
    /// (macOS `~/Library/Application Support/Chessboard/`, Windows
    /// `%APPDATA%\Chessboard\`), so they are built from the environment here
    /// rather than borrowed from the SDK's window-state store — that one is
    /// keyed by bundle id and lives wherever the SDK decides, and the About
    /// panel has to be able to print a path a person can find.
    fn resolveAppDataDir(self: *@This()) void {
        self.appdata_dir = "";
        if (builtin.os.tag == .windows) {
            const base = self.env_map.get("APPDATA") orelse return;
            if (base.len == 0) return;
            self.appdata_dir = std.fmt.bufPrint(&self.appdata_dir_buf, "{s}\\Chessboard", .{base}) catch return;
        } else if (builtin.os.tag == .macos) {
            const home = self.env_map.get("HOME") orelse return;
            if (home.len == 0) return;
            self.appdata_dir = std.fmt.bufPrint(&self.appdata_dir_buf, "{s}/Library/Application Support/Chessboard", .{home}) catch return;
        } else {
            // Linux is not a shipped target (v6-plan §3); the XDG default keeps
            // the null/dev platform from writing into $HOME itself.
            const home = self.env_map.get("HOME") orelse return;
            if (home.len == 0) return;
            self.appdata_dir = std.fmt.bufPrint(&self.appdata_dir_buf, "{s}/.local/share/Chessboard", .{home}) catch return;
        }
    }

    /// `<appdata_dir><sep><name>`, or null when there is no data dir.
    pub fn appdataChild(self: *@This(), buf: []u8, name: []const u8) ?[]const u8 {
        if (self.appdata_dir.len == 0) return null;
        return std.fmt.bufPrint(buf, "{s}{s}{s}", .{ self.appdata_dir, SEP, name }) catch null;
    }

    /// The language the page last saved through chess.setMenuLanguage, or
    /// "zh" (app.zon's own labels). Read once, at launch: the menu bar is
    /// built before the page runs and the Runtime offers no rebuild.
    fn launchLanguage(self: *@This()) []const u8 {
        var path_buf: [1200]u8 = undefined;
        const path = self.appdataChild(&path_buf, LANG_FILE) orelse return "zh";
        var file = std.Io.Dir.openFileAbsolute(self.io, path, .{}) catch return "zh";
        defer file.close(self.io);
        var raw: [16]u8 = undefined;
        const n = file.readPositionalAll(self.io, &raw, 0) catch return "zh";
        return languageTag(std.mem.trim(u8, raw[0..n], " \t\r\n")) orelse "zh";
    }

    /// Q1.6: the manifest menus with their labels swapped for `lang`, or null
    /// for Chinese so the runner takes app.zon verbatim (null is the runner's
    /// "use the manifest" signal — see the comment at the top of this file).
    fn localizedMenus(self: *@This(), lang: []const u8) ?[]const native_sdk.Menu {
        self.menu_lang = lang;
        if (std.mem.eql(u8, lang, "zh")) return null;
        return menus_mod.localize(self.menu_storage.fromManifest(), lang, &self.menu_items, &self.menus);
    }
};

fn onEvent(context: *anyopaque, runtime: *native_sdk.Runtime, event: native_sdk.Event) anyerror!void {
    const self: *App = @ptrCast(@alignCast(context));
    // the platform built the bar before its loop ran: the Mac's own menus
    // (the app menu in the language, Edit, Window) are finished on the
    // first event (menus.zig)
    if (!self.menus_finished) {
        self.menus_finished = true;
        menus_mod.finishPlatformMenus(self.menu_lang);
    }
    switch (event) {
        // v8-1-plan N1: a worker called PlatformServices.wake_fn; the SDK
        // delivers the platform's `.wake` here as `.effects_wake`, on the loop
        // thread (runtime/flow.zig dispatchPlatformEvent), which is the one
        // thread that may answer the bridge
        .effects_wake => {
            self.engine.drain(self.io, engine.runtimeEmit(runtime));
            opened.tellPage(runtime);
        },
        .command => |cmd| {
            if (menus_mod.nativeCommand(cmd.name)) |native| switch (native) {
                .quit => runtime.options.platform.services.quitApp() catch {},
                .about => menus_mod.showAbout(self.menu_lang),
            } else {
                var buf: [256]u8 = undefined;
                const detail = commandDetail(&buf, cmd.name, cmd.window_id) catch return;
                const wid: native_sdk.WindowId = if (cmd.window_id == 0) 1 else cmd.window_id;
                runtime.emitWindowEvent(wid, "shortcut", detail) catch {};
            }
        },
        // a drop on the window: queued like a double-clicked file
        .files_dropped => opened.queueDropped(runtime, event),
        else => {},
    }
}

/// v8-1-plan N1: the SDK's stop hook runs once, on the loop thread, before the
/// platform goes away (runtime/flow.zig run: "Teardown ordering contract").
/// After it no worker calls wake_fn, and what they still bring is dropped.
fn onStop(context: *anyopaque, runtime: *native_sdk.Runtime) anyerror!void {
    _ = runtime;
    const self: *App = @ptrCast(@alignCast(context));
    opened.close();
    self.engine.close(self.io);
}

extern fn chess_mac_shell_init() void;

pub fn main(init: std.process.Init) !void {
    var app_state = App{ .env_map = init.environ_map, .io = init.io };
    // Q1.1: the data dir, before anything can ask for it. Q1.6: the language
    // the page last chose decides the menu set and window title for this
    // launch (the Runtime builds the menu bar once, from what it is handed).
    app_state.resolveAppDataDir();
    app_state.resolveAssetRoot();
    // v8-4-plan V1: before the runner, which creates the WebView2 environment
    app_state.resolveWebView2UserData();
    const lang = app_state.launchLanguage();
    // 20.0 E3: files the OS hands over (opened.zig). On Windows a launch
    // while the app runs hands its files to that one and leaves; the files
    // on the command line are queued for the page (macOS sends them as an
    // Apple event instead, which mac_chrome.m registers for)
    opened.app_ptr = &app_state;
    const args = init.minimal.args.toSlice(init.arena.allocator()) catch &.{};
    if (opened.claimInstance(&app_state, args) == .handed_over) return;
    if (comptime builtin.os.tag != .macos) _ = opened.queueArgs(args);
    // the Mac's Apple-event handler and menu finishing — set up before the
    // runner starts AppKit (src/native/mac_chrome.m; macOS builds only)
    if (comptime runner.mac_shell) chess_mac_shell_init();
    const ran = runner.runWithOptions(app_state.app(), .{
        .app_name = windowTitleFor(lang),
        .window_title = windowTitleFor(lang),
        .bundle_id = "dev.hxddh.chessboard",
        .icon_path = app_state.icon_path,
        .js_window_api = true,
        .bridge = app_state.bridge(),
        .builtin_bridge = app_state.builtinBridge(),
        .menus = app_state.localizedMenus(lang),
        .runtime_slot = &app_state.runtime,
    }, init);
    // v20-0-plan F3: the engine's reader, which ends with the engine (asked
    // to quit, its stdin closed by the stop hook), may still be inside the
    // Io: returning would reach std.start's Io.Threaded.deinit under it, so
    // leave here instead. The same for the Windows inbox listener, which
    // waits on its event for good.
    if (app_state.engine.readersOut() or opened.listenerOut()) std.process.exit(if (ran) |_| 0 else |_| 1);
    return ran;
}

// `zig build test` roots the test binary at this file, and a test build never
// analyses `main` — but `appkit_host.m` is attached to the module and compiled
// regardless. That .m calls `native_sdk_update_verify_feed` / `_archive`, whose
// Zig exports sit behind a `comptime` block in the SDK's
// src/platform/macos/root.zig, reachable only through main → runner.run(). So
// the test link failed with two undefined symbols while `zig build` was fine.
//
// Forcing `main` is also what the SDK's own build does for the app module
// ("force semantic analysis of the app module", build/app.zig) — and it is
// what makes `zig build test` actually typecheck the whole app rather than
// only the files its test blocks happen to touch.
test "the whole app is semantically analysed by the test build" {
    _ = &main;
}

test {
    _ = @import("bridge.zig");
    _ = @import("db.zig");
    _ = @import("dialogs.zig");
    _ = @import("engine.zig");
    _ = @import("menus.zig");
    _ = @import("opened.zig");
}

test "the packaged page sits in resources beside bin (v8-3-plan V1)" {
    var buf: [256]u8 = undefined;
    const sep = std.fs.path.sep_str;
    const exe_dir = "C:" ++ sep ++ "Apps" ++ sep ++ "Chessboard" ++ sep ++ "bin";
    const root = packagedAssetRoot(&buf, exe_dir).?;
    try std.testing.expectEqualStrings("C:" ++ sep ++ "Apps" ++ sep ++ "Chessboard" ++ sep ++ "resources" ++ sep ++ "frontend" ++ sep ++ "dist", root);
    var small: [8]u8 = undefined;
    try std.testing.expect(packagedAssetRoot(&small, exe_dir) == null);
    try std.testing.expect(packagedAssetRoot(&buf, "bin") == null);
    const icon = packagedResource(&buf, exe_dir, "icon.ico").?;
    try std.testing.expectEqualStrings("C:" ++ sep ++ "Apps" ++ sep ++ "Chessboard" ++ sep ++ "resources" ++ sep ++ "icon.ico", icon);
}

test "WebView2 user data: a writable exe directory keeps the default (v8-4-plan V1)" {
    var buf: [256]u8 = undefined;
    try std.testing.expect(webview2UserDataFallback(&buf, true, false, "C:\\Users\\a\\AppData\\Local") == null);
}

test "WebView2 user data: a non-writable exe directory moves to %LOCALAPPDATA% (v8-4-plan V1)" {
    var buf: [256]u8 = undefined;
    try std.testing.expectEqualStrings(
        "C:\\Users\\a\\AppData\\Local\\Chessboard\\WebView2",
        webview2UserDataFallback(&buf, false, false, "C:\\Users\\a\\AppData\\Local").?,
    );
    // a trailing separator does not double up
    try std.testing.expectEqualStrings(
        "C:\\Users\\a\\AppData\\Local\\Chessboard\\WebView2",
        webview2UserDataFallback(&buf, false, false, "C:\\Users\\a\\AppData\\Local\\").?,
    );
    var small: [8]u8 = undefined;
    try std.testing.expect(webview2UserDataFallback(&small, false, false, "C:\\Users\\a\\AppData\\Local") == null);
}

test "WebView2 user data: a variable already set is left alone (v8-4-plan V1)" {
    var buf: [256]u8 = undefined;
    try std.testing.expect(webview2UserDataFallback(&buf, false, true, "C:\\Users\\a\\AppData\\Local") == null);
    try std.testing.expect(webview2UserDataFallback(&buf, true, true, "C:\\Users\\a\\AppData\\Local") == null);
}

test "WebView2 user data: no %LOCALAPPDATA% keeps the default (v8-4-plan V1)" {
    var buf: [256]u8 = undefined;
    try std.testing.expect(webview2UserDataFallback(&buf, false, false, null) == null);
    try std.testing.expect(webview2UserDataFallback(&buf, false, false, "") == null);
    try std.testing.expect(webview2UserDataFallback(&buf, false, false, "\\") == null);
}

test "the write probe tells a writable directory from a missing one (v8-4-plan V1)" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var path_buf: [4096]u8 = undefined;
    const n = try tmp.dir.realPath(std.testing.io, &path_buf);
    const dir = path_buf[0..n];
    try std.testing.expect(dirWritable(std.testing.io, dir, 1));
    // the probe file is gone again
    var probe_buf: [4200]u8 = undefined;
    const probe = try std.fmt.bufPrint(&probe_buf, "{s}{c}.chessboard-write-probe-1", .{ dir, std.fs.path.sep });
    try std.testing.expectError(error.FileNotFound, std.Io.Dir.openFileAbsolute(std.testing.io, probe, .{}));
    var missing_buf: [4200]u8 = undefined;
    const missing = try std.fmt.bufPrint(&missing_buf, "{s}{c}no-such-dir", .{ dir, std.fs.path.sep });
    try std.testing.expect(!dirWritable(std.testing.io, missing, 1));
}

test "an App starts on the relative page directory" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = std.testing.io };
    try std.testing.expectEqualStrings(FRONTEND_DIST, app_state.asset_root);
    try std.testing.expectEqualStrings(ICON_PATH, app_state.icon_path);
    const src = try App.source(&app_state);
    try std.testing.expectEqualStrings(FRONTEND_DIST, src.asset_options.?.root_path);
}

test "production source uses frontend assets" {
    const source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" });
    try std.testing.expectEqual(native_sdk.WebViewSourceKind.assets, source.kind);
    try std.testing.expectEqualStrings("frontend/dist", source.asset_options.?.root_path);
}
