const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

// v8-2-plan F2: this file is the entry and the wiring — App (the state every
// handler shares and what it hands the runner), onEvent / onStop and main().
// What the handlers do lives next to it, moved verbatim with their tests:
//   bridge.zig   the chess.* command table and the builtin-bridge grants, the
//                chunked transfer, issued paths (the trust model), the
//                appdata store and the self-test commands;
//   dialogs.zig  chess.openPgn / chess.saveText and the native file dialogs;
//   menus.zig    the menu language and what a menu command becomes for the page;
//   sync.zig     the async bridge, the update check and the Lichess /
//                Chess.com fetch.
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

const APPDATA_FILE = @import("bridge.zig").APPDATA_FILE;
const APP_COMMANDS = @import("bridge.zig").APP_COMMANDS;
const BUILTIN_COMMANDS = @import("bridge.zig").BUILTIN_COMMANDS;
const IssuedPaths = @import("bridge.zig").IssuedPaths;
const LANG_FILE = @import("bridge.zig").LANG_FILE;
const PathPolicy = @import("bridge.zig").PathPolicy;
const SEP = @import("bridge.zig").SEP;
const STORE_DIR = @import("bridge.zig").STORE_DIR;
const Stages = @import("bridge.zig").Stages;
const forwardOpenFiles = @import("bridge.zig").forwardOpenFiles;
const issueDroppedPaths = @import("bridge.zig").issueDroppedPaths;
const Opened = @import("dialogs.zig").Opened;
const commandDetail = @import("menus.zig").commandDetail;
const languageTag = @import("menus.zig").languageTag;
const menuText = @import("menus.zig").menuText;
const windowTitleFor = @import("menus.zig").windowTitleFor;
const Pending = @import("sync.zig").Pending;

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

pub const App = struct {
    env_map: *std.process.Environ.Map,
    io: std.Io,
    handlers: [APP_COMMANDS.len]native_sdk.BridgeHandler = undefined,
    async_handlers: [APP_COMMANDS.len]native_sdk.bridge.AsyncHandler = undefined,
    policies: [APP_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    builtin_policies: [BUILTIN_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    /// The per-user data directory, resolved once in main() from the
    /// environment — "" when the platform gave no home (then every appdata
    /// command answers {"error":"no_appdata_dir"} and the page keeps using
    /// localStorage). Slices into appdata_dir_buf, so App must not move after
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
    /// The icon the platform shows on a notification (the update check's).
    /// v8-3-plan V2: on Windows the host loads it with LoadImageW(IMAGE_ICON)
    /// from a path joined to the current directory — "assets/icon.png" was
    /// never found there, and a PNG is no IMAGE_ICON — so notifications fell
    /// back to the system's generic icon. build-windows.yml ships icon.ico in
    /// resources\ and main() points this at it. Slices into icon_path_buf.
    icon_path_buf: [4096]u8 = undefined,
    icon_path: []const u8 = ICON_PATH,
    /// 6.1 — bumped per appdata write so each one gets its own tmp file name.
    appdata_seq: u32 = 0,
    /// Q1.2 — the paths the native side has issued to the page this process.
    issued: IssuedPaths = .{},
    /// v8-1-plan N2 — the Runtime, for the file dialogs chess.openPgn /
    /// chess.saveText open. A bridge handler is handed no Runtime, so
    /// runner.zig fills this in (RunOptions.runtime_slot) before the loop
    /// starts; null outside the runner (tests), which answers "no dialogs".
    runtime: ?*native_sdk.Runtime = null,
    /// v8-1-plan N2 — the file chess.openPgn is handing over in pieces.
    opened: Opened = .{},
    /// v8-1-plan N1 — the sync and the update check in flight, and what
    /// their threads have finished, waiting for the loop to answer it.
    pending: Pending = .{},
    /// v8-0-plan F3 — writes arriving in pieces, until their last piece.
    stages: Stages = .{},
    /// Q1.6 — localized copies of the manifest menus, when the launch
    /// language is not Chinese. Same storage shape as runner.MenuStorage.
    menu_storage: runner.MenuStorage = .{},
    menu_items: [native_sdk.platform.max_menu_items]native_sdk.MenuItem = undefined,
    menus: [native_sdk.platform.max_menus]native_sdk.Menu = undefined,

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

    pub fn bridge(self: *@This()) native_sdk.BridgeDispatcher {
        var sync_count: usize = 0;
        var async_count: usize = 0;
        for (APP_COMMANDS, 0..) |cmd, index| {
            // v8-1-plan N1: the SDK looks a command up in the async registry
            // first (runtime/flow.zig handleAsyncBridgeMessage) and checks the
            // same policy there, so both kinds share the one policy table
            if (cmd.async_fn) |invoke| {
                self.async_handlers[async_count] = .{ .name = cmd.name, .context = self, .invoke_fn = invoke };
                async_count += 1;
            } else {
                self.handlers[sync_count] = .{ .name = cmd.name, .context = self, .invoke_fn = cmd.invoke_fn.? };
                sync_count += 1;
            }
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
            .registry = .{ .handlers = self.handlers[0..sync_count] },
            .async_registry = .{ .handlers = self.async_handlers[0..async_count] },
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

    /// v8-0-plan F3: `<appdata>/store/<key>.json<suffix>` for a key of the
    /// per-key store, `<appdata>/chessboard.json<suffix>` for null. The key
    /// has passed storeKeyValid, so it cannot climb out of the directory.
    pub fn appdataFile(self: *@This(), buf: []u8, key: ?[]const u8, suffix: []const u8) ?[]const u8 {
        if (self.appdata_dir.len == 0) return null;
        if (key) |k| {
            return std.fmt.bufPrint(buf, "{s}{s}{s}{s}{s}.json{s}", .{ self.appdata_dir, SEP, STORE_DIR, SEP, k, suffix }) catch null;
        }
        return std.fmt.bufPrint(buf, "{s}{s}{s}{s}", .{ self.appdata_dir, SEP, APPDATA_FILE, suffix }) catch null;
    }

    pub fn pathPolicy(self: *@This()) PathPolicy {
        const home_var: []const u8 = if (builtin.os.tag == .windows) "USERPROFILE" else "HOME";
        return .{
            .home = self.env_map.get(home_var) orelse "",
            .appdata_dir = self.appdata_dir,
            .windows = builtin.os.tag == .windows,
        };
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
        if (std.mem.eql(u8, lang, "zh")) return null;
        const base = self.menu_storage.fromManifest();
        var item_index: usize = 0;
        for (base, 0..) |menu, menu_index| {
            const first_item = item_index;
            for (menu.items) |item| {
                var copy = item;
                copy.label = menuText(item.command, lang, item.label);
                self.menu_items[item_index] = copy;
                item_index += 1;
            }
            self.menus[menu_index] = .{
                .title = menuText(menu.title, lang, menu.title),
                .items = self.menu_items[first_item..item_index],
            };
        }
        return self.menus[0..base.len];
    }
};

fn onEvent(context: *anyopaque, runtime: *native_sdk.Runtime, event: native_sdk.Event) anyerror!void {
    const self: *App = @ptrCast(@alignCast(context));
    switch (event) {
        // v8-1-plan N1: a worker called PlatformServices.wake_fn; the SDK
        // delivers the platform's `.wake` here as `.effects_wake`, on the loop
        // thread (runtime/flow.zig dispatchPlatformEvent), which is the one
        // thread that may answer the bridge
        .effects_wake => self.pending.drain(),
        .command => |cmd| {
            var buf: [256]u8 = undefined;
            const detail = commandDetail(&buf, cmd.name, cmd.window_id) catch return;
            const wid: native_sdk.WindowId = if (cmd.window_id == 0) 1 else cmd.window_id;
            runtime.emitWindowEvent(wid, "shortcut", detail) catch {};
        },
        else => {},
    }
    forwardOpenFiles(self, runtime, event);
    issueDroppedPaths(self, event);
}

/// v8-1-plan N1: the SDK's stop hook runs once, on the loop thread, before the
/// platform goes away (runtime/flow.zig run: "Teardown ordering contract").
/// After it no worker calls wake_fn, and what they still bring is dropped.
fn onStop(context: *anyopaque, runtime: *native_sdk.Runtime) anyerror!void {
    _ = runtime;
    const self: *App = @ptrCast(@alignCast(context));
    self.pending.close();
}

pub fn main(init: std.process.Init) !void {
    var app_state = App{ .env_map = init.environ_map, .io = init.io };
    // Q1.1: the data dir, before anything can ask for it. Q1.6: the language
    // the page last chose decides the menu set and window title for this
    // launch (the Runtime builds the menu bar once, from what it is handed).
    app_state.resolveAppDataDir();
    app_state.resolveAssetRoot();
    const lang = app_state.launchLanguage();
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
    // v8-1-plan N1: a sync or update check still on the network. Returning
    // would reach std.start's Io.Threaded.deinit while its thread is inside
    // that Io, so leave here instead — the answer has nobody to go to.
    if (app_state.pending.workersOut()) std.process.exit(if (ran) |_| 0 else |_| 1);
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
