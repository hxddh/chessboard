const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

pub const panic = std.debug.FullPanic(native_sdk.debug.capturePanic);

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

/// The SDK's own bridge commands this page calls (host.js: `zero.dialogs.*`,
/// `zero.os.*`, `zero.clipboard.*`, `zero.platform.supports`).
///
/// Since SDK 0.8 these are refused unless the app hands the runtime an
/// explicit builtin-bridge policy: `allowsBuiltinBridgeCommand` gives the
/// dialog / os / clipboard families no implicit permission, so with the
/// default empty policy every one of them answered `permission_denied` — and
/// host.js, which reads a rejection as "this build has no dialogs", took the
/// browser path. 5.0.0 moved the pin from 0.7.1 to 0.8.1 and shipped two
/// versions in which no native file dialog, native confirm, notification,
/// recent-documents entry or clipboard write ever happened. The 2026-09-06
/// walkthrough of 5.2.0 caught it (docs/manual-check.md).
///
/// scripts/manifest-check.mjs holds this list to host.js: every `zero.X.Y`
/// the page calls has to be granted here, and nothing is granted that the
/// page does not call.
///
/// v8-1-plan N2: the file dialogs, and the reveal after a save, are no longer
/// the page's to call. chess.openPgn / chess.saveText open them here, on the
/// native side, so the path the player picked never reaches the page —
/// `native-sdk.dialog.openFile`, `.saveFile` and `native-sdk.os.revealPath`
/// are not granted any more.
const BUILTIN_COMMANDS = [_][]const u8{
    "native-sdk.platform.supports",
    "native-sdk.dialog.showMessage",
    "native-sdk.os.addRecentDocument",
    "native-sdk.os.clearRecentDocuments",
    "native-sdk.os.showNotification",
    "native-sdk.clipboard.readText",
    "native-sdk.clipboard.writeText",
};

/// The exact function-pointer type the SDK's BridgeHandler carries, so the
/// table below cannot drift from it.
const InvokeFn = @FieldType(native_sdk.BridgeHandler, "invoke_fn");

const AppCommand = struct {
    name: []const u8,
    invoke_fn: InvokeFn,
};

/// The app's own bridge commands (host.js: `zero.invoke("chess.X", …)`).
///
/// One table feeds both the handler registry and the per-command origin
/// policy, so a command can never be registered without a policy (which the
/// SDK answers with permission_denied) or the other way round.
/// scripts/manifest-check.mjs (section 6) holds this list to host.js the same
/// way BUILTIN_COMMANDS is held: every `chess.X` the page invokes is here, and
/// nothing is here the page never invokes — COMPAT_COMMANDS aside.
const APP_COMMANDS = [_]AppCommand{
    .{ .name = "chess.writeTextFile", .invoke_fn = writeTextFile },
    .{ .name = "chess.readTextFile", .invoke_fn = readTextFile },
    .{ .name = "chess.issuePath", .invoke_fn = issuePath },
    .{ .name = "chess.openPgn", .invoke_fn = openPgn },
    .{ .name = "chess.saveText", .invoke_fn = saveText },
    .{ .name = "chess.appdataRead", .invoke_fn = appdataRead },
    .{ .name = "chess.appdataWrite", .invoke_fn = appdataWrite },
    .{ .name = "chess.appdataPath", .invoke_fn = appdataPath },
    .{ .name = "chess.setMenuLanguage", .invoke_fn = setMenuLanguage },
    .{ .name = "chess.checkUpdate", .invoke_fn = checkUpdate },
    .{ .name = "chess.fetchGames", .invoke_fn = fetchGames },
    .{ .name = "chess.selftestMode", .invoke_fn = selftestMode },
    .{ .name = "chess.selftestReport", .invoke_fn = selftestReport },
};

/// v8-1-plan N2: registered for pages older than this change only. The page as
/// shipped never calls these, and scripts/manifest-check.mjs fails the build
/// if it starts to again: chess.issuePath is the widest door from the page to
/// the file system (it asks the native side to trust a path the page names),
/// and since the dialogs run here it has nothing left to do.
const COMPAT_COMMANDS = [_][]const u8{"chess.issuePath"};

/// The platform path separator, as the strings this file builds need it.
const SEP: []const u8 = if (builtin.os.tag == .windows) "\\" else "/";

/// Q1.1 — the one-document user-data file 6.x–7.x mirrored into. Since
/// v8-0-plan F3 the page reads it only to migrate from, and mirrors into the
/// per-key store instead: `<appdata>/store/<key>.json`, one file per profile
/// key plus the page's manifest. Both kinds share the sidecars below.
const APPDATA_FILE = "chessboard.json";
const STORE_DIR = "store";
/// The sidecars the atomic write leaves next to a data file.
const TMP_SUFFIX = ".tmp";
const BAK_SUFFIX = ".bak";
/// Q1.6 — the UI language the page last chose, read once at launch to pick
/// the menu set (see setMenuLanguage for why it is a file and not a call).
const LANG_FILE = "lang";

const App = struct {
    env_map: *std.process.Environ.Map,
    io: std.Io,
    handlers: [APP_COMMANDS.len]native_sdk.BridgeHandler = undefined,
    policies: [APP_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    builtin_policies: [BUILTIN_COMMANDS.len]native_sdk.BridgeCommandPolicy = undefined,
    /// The per-user data directory, resolved once in main() from the
    /// environment — "" when the platform gave no home (then every appdata
    /// command answers {"error":"no_appdata_dir"} and the page keeps using
    /// localStorage). Slices into appdata_dir_buf, so App must not move after
    /// resolveAppDataDir() ran; main() keeps it in one place.
    appdata_dir_buf: [1024]u8 = undefined,
    appdata_dir: []const u8 = "",
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
            .source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" }),
            .source_fn = source,
            .event_fn = onEvent,
        };
    }

    fn source(context: *anyopaque) anyerror!native_sdk.WebViewSource {
        const self: *@This() = @ptrCast(@alignCast(context));
        return native_sdk.frontend.sourceFromEnv(self.env_map, .{
            .dist = "frontend/dist",
            .entry = "index.html",
        });
    }

    fn bridge(self: *@This()) native_sdk.BridgeDispatcher {
        for (APP_COMMANDS, 0..) |cmd, index| {
            self.handlers[index] = .{
                .name = cmd.name,
                .context = self,
                .invoke_fn = cmd.invoke_fn,
            };
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
    fn appdataChild(self: *@This(), buf: []u8, name: []const u8) ?[]const u8 {
        if (self.appdata_dir.len == 0) return null;
        return std.fmt.bufPrint(buf, "{s}{s}{s}", .{ self.appdata_dir, SEP, name }) catch null;
    }

    /// v8-0-plan F3: `<appdata>/store/<key>.json<suffix>` for a key of the
    /// per-key store, `<appdata>/chessboard.json<suffix>` for null. The key
    /// has passed storeKeyValid, so it cannot climb out of the directory.
    fn appdataFile(self: *@This(), buf: []u8, key: ?[]const u8, suffix: []const u8) ?[]const u8 {
        if (self.appdata_dir.len == 0) return null;
        if (key) |k| {
            return std.fmt.bufPrint(buf, "{s}{s}{s}{s}{s}.json{s}", .{ self.appdata_dir, SEP, STORE_DIR, SEP, k, suffix }) catch null;
        }
        return std.fmt.bufPrint(buf, "{s}{s}{s}{s}", .{ self.appdata_dir, SEP, APPDATA_FILE, suffix }) catch null;
    }

    fn pathPolicy(self: *@This()) PathPolicy {
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
        .command => |cmd| {
            var buf: [256]u8 = undefined;
            const detail = std.fmt.bufPrint(
                &buf,
                "{{\"id\":\"{s}\",\"command\":\"{s}\",\"key\":\"\",\"windowId\":{d},\"modifiers\":{{\"primary\":false,\"command\":false,\"control\":false,\"option\":false,\"shift\":false}}}}",
                .{ cmd.name, cmd.name, if (cmd.window_id == 0) @as(u64, 1) else cmd.window_id },
            ) catch return;
            const wid: native_sdk.WindowId = if (cmd.window_id == 0) 1 else cmd.window_id;
            runtime.emitWindowEvent(wid, "shortcut", detail) catch {};
        },
        else => {},
    }
    forwardOpenFiles(self, runtime, event);
    issueDroppedPaths(self, event);
}

// -------------------------------------------------------------- drop:files
//
// v8-0-plan F3 (§6: narrow what chess.issuePath is for). The SDK hands a drop
// to the app as Event.files_dropped BEFORE it emits "drop:files" to the page
// (runtime flow.zig: dispatchEvent, then emitFileDropEvent), so the paths can
// be issued here, on the native side's own word, instead of the page
// forwarding them to chess.issuePath. They get the same pathAllowed rule the
// page's call used to get — a drop is the player's choice, but no wider than
// a dialog's. The file dialogs were the last road through chess.issuePath
// until v8-1-plan N2 moved them here (chess.openPgn / chess.saveText, with the
// Runtime runner.zig hands over); the command stays for older pages only.
//
// Probed by name at comptime like OPEN_FILE_VARIANTS: an SDK without the
// variant compiles this to nothing, and a drop is then simply not issued.
fn issueDroppedPaths(self: *App, event: native_sdk.Event) void {
    if (comptime @hasField(native_sdk.Event, "files_dropped")) {
        if (event == .files_dropped) {
            const drop = event.files_dropped;
            if (comptime @hasField(@TypeOf(drop), "paths")) {
                const policy = self.pathPolicy();
                for (drop.paths) |item| {
                    if (openFilePathOf(item)) |p| {
                        if (pathAllowed(policy, p)) self.issued.add(p);
                    }
                }
            }
        }
    }
}

// ---------------------------------------------------------------- open:files
//
// Q1.5 ".pgn association": with the document type declared (Info.plist /
// registry, see scripts/add-pgn-doctype.sh and scripts/register-pgn.reg) the
// OS hands a double-clicked .pgn to the running app as an event. The SDK's
// Event union is not on disk in this checkout, so the variant is probed BY
// NAME at comptime: when this SDK has none of the names below, everything
// here compiles to nothing and the page simply never receives "open:files".
// When it has one, its payload is walked generically (a slice of paths, or a
// struct with .paths / .files / .path). The paths are registered as issued —
// the OS chose them, not the page — and forwarded as one window event the
// page subscribes to with host.js onOpenFiles().
//
// Unverified until a Zig CI run against the pinned SDK sees it (task note in
// the 6.0 report); an event that arrives before the page subscribed is lost.
const OPEN_FILE_VARIANTS = [_][]const u8{ "open_files", "open_file", "open_urls", "open_documents" };

fn forwardOpenFiles(self: *App, runtime: *native_sdk.Runtime, event: native_sdk.Event) void {
    inline for (OPEN_FILE_VARIANTS) |variant| {
        if (comptime @hasField(native_sdk.Event, variant)) {
            if (event == @field(std.meta.Tag(native_sdk.Event), variant)) {
                emitOpenFiles(self, runtime, @field(event, variant));
            }
        }
    }
}

/// One path out of whatever element type the payload carries.
fn openFilePathOf(item: anytype) ?[]const u8 {
    const T = @TypeOf(item);
    if (comptime @typeInfo(T) == .pointer) {
        const s: []const u8 = item;
        return s;
    }
    if (comptime @typeInfo(T) == .@"struct" and @hasField(T, "path")) {
        const s: []const u8 = item.path;
        return s;
    }
    return null;
}

fn emitOpenFiles(self: *App, runtime: *native_sdk.Runtime, payload: anytype) void {
    const P = @TypeOf(payload);
    var detail_buf: [8192]u8 = undefined;
    var n: usize = 0;
    if (!jsonAppend(&detail_buf, &n, "{\"paths\":[")) return;
    var count: usize = 0;
    if (comptime @typeInfo(P) == .pointer) {
        for (payload) |item| {
            if (openFilePathOf(item)) |p| {
                if (!appendIssuedPath(self, &detail_buf, &n, &count, p)) return;
            }
        }
    } else if (comptime @typeInfo(P) == .@"struct") {
        if (comptime @hasField(P, "paths")) {
            for (payload.paths) |item| {
                if (openFilePathOf(item)) |p| {
                    if (!appendIssuedPath(self, &detail_buf, &n, &count, p)) return;
                }
            }
        } else if (comptime @hasField(P, "files")) {
            for (payload.files) |item| {
                if (openFilePathOf(item)) |p| {
                    if (!appendIssuedPath(self, &detail_buf, &n, &count, p)) return;
                }
            }
        } else if (comptime @hasField(P, "path")) {
            if (openFilePathOf(payload.path)) |p| {
                if (!appendIssuedPath(self, &detail_buf, &n, &count, p)) return;
            }
        } else return;
    } else return;
    if (count == 0) return;
    if (!jsonAppend(&detail_buf, &n, "]}")) return;
    runtime.emitWindowEvent(1, "open:files", detail_buf[0..n]) catch {};
}

fn appendIssuedPath(self: *App, buf: []u8, n: *usize, count: *usize, p: []const u8) bool {
    if (p.len == 0 or p.len > ISSUED_PATH_MAX) return true; // skip, keep the rest
    self.issued.add(p);
    if (count.* > 0 and !jsonAppend(buf, n, ",")) return false;
    if (!jsonAppendString(buf, n, p)) return false;
    count.* += 1;
    return true;
}

fn jsonAppend(buf: []u8, n: *usize, s: []const u8) bool {
    if (n.* + s.len > buf.len) return false;
    @memcpy(buf[n.*..][0..s.len], s);
    n.* += s.len;
    return true;
}

/// A JSON string literal, quotes included. Paths carry `\` on Windows and can
/// carry `"`; both have to be escaped or the page's JSON.parse throws.
fn jsonAppendString(buf: []u8, n: *usize, s: []const u8) bool {
    if (!jsonAppend(buf, n, "\"")) return false;
    for (s) |c| {
        switch (c) {
            '"' => if (!jsonAppend(buf, n, "\\\"")) return false,
            '\\' => if (!jsonAppend(buf, n, "\\\\")) return false,
            '\n' => if (!jsonAppend(buf, n, "\\n")) return false,
            '\r' => if (!jsonAppend(buf, n, "\\r")) return false,
            '\t' => if (!jsonAppend(buf, n, "\\t")) return false,
            else => {
                if (c < 0x20) return false; // other control bytes never occur in a path
                if (n.* + 1 > buf.len) return false;
                buf[n.*] = c;
                n.* += 1;
            },
        }
    }
    return jsonAppend(buf, n, "\"");
}

// ------------------------------------------------ chunked transfer (v8-0-plan F3)
//
// Sizes for the file and appdata handlers, at file scope so the tests below
// can check the arithmetic between them.
//
// Before v8-0-plan F3 a file crossed the bridge in one frame: readTextFile refused past
// 256 KiB, writeTextFile past 384 KiB, and the appdata pair was nominally 8 MiB
// — but the SDK caps one bridge frame at 1 MiB each way (0.10.1:
// bridge.max_message_bytes for the request, max_result_bytes for what a
// handler may answer; both `1024 * 1024` in the SDK's src/bridge/root.zig,
// and the test below holds BRIDGE_FRAME_MAX to them. The SDK's bridge
// documentation says 16 KiB per frame; the source is what runs, so the
// source is what this cites — v8-1-plan §1.2, §5), so anything whose base64
// passed ~1 MiB never arrived at all. That is how "export all data" fell back
// to the clipboard and "import all data" was refused once a player had a few
// hundred games.
//
// Now a transfer is cut into pieces of CHUNK_BYTES, whose base64 plus the
// envelope fits a frame with room to spare. A read names an `offset` and is
// answered {b64, more}; a write sends {txn, total, offset, b64} pieces that
// are staged on the heap (Stages below) and written — atomically, for the
// appdata files — once the last is in. One piece with none of those fields is
// the pre-F3 shape and is still taken whole. FILE_MAX_BYTES bounds the
// whole transfer either way.
const BRIDGE_FRAME_MAX: usize = 1024 * 1024;
const CHUNK_BYTES: usize = 512 * 1024;
/// base64 of one full chunk, padding included: the most a write piece carries.
const WRITE_B64_MAX: usize = (CHUNK_BYTES + 2) / 3 * 4;
/// The largest file a read or a write carries, and the largest appdata file.
const FILE_MAX_BYTES: usize = 16 * 1024 * 1024;
/// M5 review P2-3: the largest file a player picked (an issued path) may be.
/// 导出全部数据 carries every library shard: an analysed 80-ply game is
/// ~2.6 KB of JSON, 10,000 of them (library.js MAX_GAMES) ~28 MB escaped into
/// the export, which 16 MiB stopped at ~5,500. Twice that with the other keys.
/// The appdata files stay at FILE_MAX_BYTES: a shard is 1/64 of the library.
const USER_FILE_MAX_BYTES: usize = 64 * 1024 * 1024;

/// The most a staged write toward `target` may total: an appdata file, or a
/// file the player picked.
fn stageLimit(target: []const u8) usize {
    return if (std.mem.startsWith(u8, target, "appdata:")) FILE_MAX_BYTES else USER_FILE_MAX_BYTES;
}
/// Chunked writes in flight at once. Two is the realistic most (a mirror
/// flush and an export, or two windows); a new one past the last evicts the
/// oldest, which then answers stage_lost and starts over (host.js).
const STAGE_SLOTS: usize = 4;
/// A transfer's name, as the page makes it: [A-Za-z0-9_-], at most this long.
const TXN_MAX: usize = 32;
/// A store key, as persist.js names them ("save", "panelOpen", "meta"…).
const STORE_KEY_MAX: usize = 32;

fn isJsonSpace(c: u8) bool {
    return c == ' ' or c == '\t' or c == '\n' or c == '\r';
}

/// Where the value of `"key":` starts. A quoted match that is not followed by
/// a colon — a string value that happens to spell the name — is skipped.
fn jsonFieldValue(payload: []const u8, key: []const u8) ?usize {
    var key_buf: [96]u8 = undefined;
    if (key.len + 2 > key_buf.len) return null;
    const needle = std.fmt.bufPrint(&key_buf, "\"{s}\"", .{key}) catch return null;
    var from: usize = 0;
    while (std.mem.indexOfPos(u8, payload, from, needle)) |at| {
        var i = at + needle.len;
        while (i < payload.len and isJsonSpace(payload[i])) : (i += 1) {}
        if (i < payload.len and payload[i] == ':') {
            i += 1;
            while (i < payload.len and isJsonSpace(payload[i])) : (i += 1) {}
            return i;
        }
        from = at + 1;
    }
    return null;
}

/// A non-negative integer field, or null when it is absent or not one.
fn jsonUintField(payload: []const u8, key: []const u8) ?usize {
    const start = jsonFieldValue(payload, key) orelse return null;
    var i = start;
    while (i < payload.len and std.ascii.isDigit(payload[i])) : (i += 1) {}
    if (i == start or i - start > 12) return null;
    return std.fmt.parseInt(usize, payload[start..i], 10) catch null;
}

/// A boolean field, or null when it is absent or not one.
fn jsonBoolField(payload: []const u8, key: []const u8) ?bool {
    const start = jsonFieldValue(payload, key) orelse return null;
    const rest = payload[start..];
    if (std.mem.startsWith(u8, rest, "true")) return true;
    if (std.mem.startsWith(u8, rest, "false")) return false;
    return null;
}

/// 1..max characters of [A-Za-z0-9_-] — a transfer name or a store key.
fn tokenValid(s: []const u8, max: usize) bool {
    if (s.len == 0 or s.len > max) return false;
    for (s) |c| {
        if (!(std.ascii.isAlphanumeric(c) or c == '_' or c == '-')) return false;
    }
    return true;
}

/// A store key becomes a file name, so it is a plain token — no separator,
/// no dot, nothing to climb out of store/ with — and not one of the device
/// names Windows reserves whatever the extension.
fn storeKeyValid(key: []const u8) bool {
    if (!tokenValid(key, STORE_KEY_MAX)) return false;
    for ([_][]const u8{ "con", "prn", "aux", "nul" }) |dev| {
        if (std.ascii.eqlIgnoreCase(key, dev)) return false;
    }
    if (key.len == 4 and (std.ascii.startsWithIgnoreCase(key, "com") or std.ascii.startsWithIgnoreCase(key, "lpt")) and std.ascii.isDigit(key[3])) return false;
    return true;
}

const StageError = error{ TooLarge, StageLost, BadChunk, OutOfMemory };

/// One chunked write, between its first piece and its last.
const Stage = struct {
    txn_buf: [TXN_MAX]u8 = undefined,
    txn_len: usize = 0,
    /// what the bytes become: an issued path, or "appdata:<key>"
    target_buf: [ISSUED_PATH_MAX]u8 = undefined,
    target_len: usize = 0,
    /// `total` bytes, heap; filled from the front, piece by piece
    data: []u8 = &.{},
    filled: usize = 0,

    fn busy(self: *const Stage) bool {
        return self.txn_len > 0;
    }
    fn txn(self: *const Stage) []const u8 {
        return self.txn_buf[0..self.txn_len];
    }
    fn target(self: *const Stage) []const u8 {
        return self.target_buf[0..self.target_len];
    }
    fn complete(self: *const Stage) bool {
        return self.busy() and self.filled == self.data.len;
    }
};

/// Where one piece's decoded bytes go.
const Claim = struct { stage: *Stage, dest: []u8 };

const Stages = struct {
    slots: [STAGE_SLOTS]Stage = [_]Stage{.{}} ** STAGE_SLOTS,
    next: usize = 0,

    fn release(self: *Stages, gpa: std.mem.Allocator, stage: *Stage) void {
        _ = self;
        if (stage.data.len > 0) gpa.free(stage.data);
        stage.* = .{};
    }

    fn releaseAll(self: *Stages, gpa: std.mem.Allocator) void {
        for (&self.slots) |*s| self.release(gpa, s);
    }

    /// Room for a piece of `len` bytes at `offset` of transfer `txn`.
    ///
    /// Offset 0 opens the transfer (again, if it had begun: a page that
    /// starts over means it). Any other offset has to continue one exactly
    /// where it stopped, into the same target at the same total — a piece
    /// that does not is refused and the transfer dropped, never patched
    /// into a file with a hole in it.
    fn claim(self: *Stages, gpa: std.mem.Allocator, txn: []const u8, target: []const u8, total: usize, offset: usize, len: usize) StageError!Claim {
        if (total == 0 or total > stageLimit(target)) return error.TooLarge;
        if (!tokenValid(txn, TXN_MAX) or target.len == 0 or target.len > ISSUED_PATH_MAX) return error.BadChunk;
        var found: ?*Stage = null;
        for (&self.slots) |*s| {
            if (s.busy() and std.mem.eql(u8, s.txn(), txn)) {
                found = s;
                break;
            }
        }
        if (offset == 0) {
            const fresh = found orelse self.freeSlot(gpa);
            self.release(gpa, fresh);
            fresh.data = try gpa.alloc(u8, total);
            @memcpy(fresh.txn_buf[0..txn.len], txn);
            fresh.txn_len = txn.len;
            @memcpy(fresh.target_buf[0..target.len], target);
            fresh.target_len = target.len;
            found = fresh;
        }
        const st = found orelse return error.StageLost;
        if (!std.mem.eql(u8, st.target(), target) or st.data.len != total or offset != st.filled) {
            self.release(gpa, st);
            return error.StageLost;
        }
        if (len == 0 or len > total - offset) {
            self.release(gpa, st);
            return error.BadChunk;
        }
        return .{ .stage = st, .dest = st.data[offset..][0..len] };
    }

    /// An idle slot, or the one to evict: the least recently opened.
    fn freeSlot(self: *Stages, gpa: std.mem.Allocator) *Stage {
        for (&self.slots) |*slot| {
            if (!slot.busy()) return slot;
        }
        const oldest = &self.slots[self.next];
        self.next = (self.next + 1) % STAGE_SLOTS;
        self.release(gpa, oldest);
        return oldest;
    }
};

/// A write request's bytes, once they are all in.
const Incoming = struct {
    bytes: []u8,
    /// the stage that holds `bytes`, or null when one request carried them
    stage: ?*Stage,
};

const Received = enum { ready, pending, answered };

/// Decode a write request (writeTextFile / appdataWrite) toward `target`.
///
/// `.ready`: `incoming` holds the whole content — hand it to finishReceive when
/// done. `.pending`: a piece was staged and more are due. `.answered`:
/// `answer` holds the refusal the page is to get (too large, stage lost).
fn receive(self: *App, payload: []const u8, target: []const u8, output: []u8, incoming: *Incoming, answer: *[]const u8) anyerror!Received {
    const gpa = std.heap.page_allocator;
    // base64 needs no unescaping — its alphabet has nothing JSON would escape
    const b64 = jsonStringFieldRaw(payload, "b64") orelse return error.InvalidRequest;
    if (b64.len == 0 or b64.len > WRITE_B64_MAX) return error.InvalidRequest;
    const dec = std.base64.standard.Decoder;
    const len = dec.calcSizeForSlice(b64) catch return error.InvalidRequest;

    // one piece, no staging fields: the whole content, as before F3
    const total = jsonUintField(payload, "total") orelse {
        const bytes = gpa.alloc(u8, len) catch return error.HandlerFailed;
        dec.decode(bytes, b64) catch {
            gpa.free(bytes);
            return error.InvalidRequest;
        };
        incoming.* = .{ .bytes = bytes, .stage = null };
        return .ready;
    };
    const offset = jsonUintField(payload, "offset") orelse return error.InvalidRequest;
    var txn_buf: [TXN_MAX]u8 = undefined;
    const txn = jsonStringField(payload, "txn", &txn_buf) orelse return error.InvalidRequest;

    const got = self.stages.claim(gpa, txn, target, total, offset, len) catch |err| switch (err) {
        error.TooLarge => {
            answer.* = try tooLargeAnswerFor(output, stageLimit(target));
            return .answered;
        },
        error.StageLost => {
            answer.* = std.fmt.bufPrint(output, "{{\"error\":\"stage_lost\"}}", .{}) catch return error.HandlerFailed;
            return .answered;
        },
        error.BadChunk => return error.InvalidRequest,
        error.OutOfMemory => return error.HandlerFailed,
    };
    dec.decode(got.dest, b64) catch {
        self.stages.release(gpa, got.stage);
        return error.InvalidRequest;
    };
    got.stage.filled += len;
    if (!got.stage.complete()) return .pending;
    incoming.* = .{ .bytes = got.stage.data, .stage = got.stage };
    return .ready;
}

fn finishReceive(self: *App, incoming: Incoming) void {
    const gpa = std.heap.page_allocator;
    if (incoming.stage) |s| self.stages.release(gpa, s) else gpa.free(incoming.bytes);
}

fn pendingAnswer(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"pending\":true}}", .{}) catch return error.HandlerFailed;
}

fn tooLargeAnswer(output: []u8) anyerror![]const u8 {
    return tooLargeAnswerFor(output, FILE_MAX_BYTES);
}

fn tooLargeAnswerFor(output: []u8, limit: usize) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"tooLarge\":true,\"limit\":{d}}}", .{limit}) catch return error.HandlerFailed;
}

/// One piece of a file as the page gets it: {"b64":…,"more":…[,"bak":…]}.
/// The base64 is encoded straight into `output`, which is the SDK's result
/// buffer (BRIDGE_FRAME_MAX), so a piece costs no second copy.
fn chunkAnswer(output: []u8, bytes: []const u8, more: bool, bak: ?bool) anyerror![]const u8 {
    const enc = std.base64.standard.Encoder;
    const enc_len = enc.calcSize(bytes.len);
    var n: usize = 0;
    if (!jsonAppend(output, &n, "{\"b64\":\"")) return error.HandlerFailed;
    // the tail below is at most 27 bytes
    if (n + enc_len + 32 > output.len) return error.HandlerFailed;
    _ = enc.encode(output[n..][0..enc_len], bytes);
    n += enc_len;
    if (!jsonAppend(output, &n, if (more) "\",\"more\":true" else "\",\"more\":false")) return error.HandlerFailed;
    if (bak) |b| {
        if (!jsonAppend(output, &n, if (b) ",\"bak\":true" else ",\"bak\":false")) return error.HandlerFailed;
    }
    if (!jsonAppend(output, &n, "}")) return error.HandlerFailed;
    return output[0..n];
}

const ChunkRead = struct { n: usize, more: bool };

/// Up to CHUNK_BYTES of `path` from `offset`, into `buf` (CHUNK_BYTES + 1
/// long: the spare byte says whether more follows). null: no such file.
///
/// A first read (offset 0) also refuses a file over `limit` (FILE_MAX_BYTES,
/// or USER_FILE_MAX_BYTES for a picked file), by
/// reading the one byte past the limit — the same spare-byte idea the 256 KiB
/// read used, without a stat: readPositionalAll reports how much it read, so
/// a byte there means the file is too long.
fn readChunk(io: std.Io, path: []const u8, offset: usize, buf: []u8, limit: usize) error{ FileTooLarge, HandlerFailed }!?ChunkRead {
    if (offset > limit) return error.FileTooLarge;
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return error.HandlerFailed,
    };
    defer file.close(io);
    if (offset == 0) {
        var probe: [1]u8 = undefined;
        const past = file.readPositionalAll(io, &probe, limit) catch return error.HandlerFailed;
        if (past > 0) return error.FileTooLarge;
    }
    const n = file.readPositionalAll(io, buf[0 .. CHUNK_BYTES + 1], offset) catch return error.HandlerFailed;
    return .{ .n = @min(n, CHUNK_BYTES), .more = n > CHUNK_BYTES };
}

/// Raw (still-escaped) bytes of a JSON string field, without the quotes.
fn jsonStringFieldRaw(payload: []const u8, key: []const u8) ?[]const u8 {
    var key_buf: [96]u8 = undefined;
    if (key.len + 2 > key_buf.len) return null;
    const needle = std.fmt.bufPrint(&key_buf, "\"{s}\"", .{key}) catch return null;
    const at = std.mem.indexOf(u8, payload, needle) orelse return null;
    var i = at + needle.len;
    while (i < payload.len and (payload[i] == ' ' or payload[i] == '\t' or payload[i] == '\n' or payload[i] == '\r' or payload[i] == ':')) : (i += 1) {}
    if (i >= payload.len or payload[i] != '"') return null;
    i += 1;
    const start = i;
    while (i < payload.len) : (i += 1) {
        if (payload[i] == '\\') {
            i += 1;
            continue;
        }
        if (payload[i] == '"') return payload[start..i];
    }
    return null;
}

/// A JSON string field, unescaped into `out`.
///
/// The scan above already had to understand `\` in order to find the closing
/// quote, but it handed back the raw slice — so every consumer received JSON
/// source rather than the value it encodes. The only consumer is a filesystem
/// path, and on Windows that meant `C:\\Users\\...`: each separator doubled,
/// because the page's JSON.stringify had escaped it and nothing un-escaped it
/// again. Some APIs shrug off a doubled separator; that is luck, not parsing.
///
/// Unknown escapes are rejected rather than passed through, so a malformed
/// payload fails the request instead of reaching the filesystem half-decoded.
fn jsonStringField(payload: []const u8, key: []const u8, out: []u8) ?[]const u8 {
    const raw = jsonStringFieldRaw(payload, key) orelse return null;
    var n: usize = 0;
    var i: usize = 0;
    while (i < raw.len) {
        if (n >= out.len) return null;
        const c = raw[i];
        if (c != '\\') {
            out[n] = c;
            n += 1;
            i += 1;
            continue;
        }
        if (i + 1 >= raw.len) return null;
        const esc = raw[i + 1];
        i += 2;
        switch (esc) {
            '"', '\\', '/' => {
                out[n] = esc;
                n += 1;
            },
            'b' => {
                out[n] = 0x08;
                n += 1;
            },
            'f' => {
                out[n] = 0x0C;
                n += 1;
            },
            'n' => {
                out[n] = '\n';
                n += 1;
            },
            'r' => {
                out[n] = '\r';
                n += 1;
            },
            't' => {
                out[n] = '\t';
                n += 1;
            },
            'u' => {
                // \uXXXX, surrogate pairs included — JSON.stringify emits these
                // for anything outside the BMP and for control characters.
                if (i + 4 > raw.len) return null;
                var cp: u21 = std.fmt.parseInt(u16, raw[i .. i + 4], 16) catch return null;
                i += 4;
                if (cp >= 0xD800 and cp <= 0xDBFF) {
                    if (i + 6 > raw.len or raw[i] != '\\' or raw[i + 1] != 'u') return null;
                    const lo = std.fmt.parseInt(u16, raw[i + 2 .. i + 6], 16) catch return null;
                    if (lo < 0xDC00 or lo > 0xDFFF) return null;
                    i += 6;
                    cp = 0x10000 + ((cp - 0xD800) << 10) + @as(u21, lo - 0xDC00);
                } else if (cp >= 0xDC00 and cp <= 0xDFFF) {
                    return null; // lone low surrogate
                }
                const len: usize = std.unicode.utf8CodepointSequenceLength(cp) catch return null;
                if (n + len > out.len) return null;
                n += std.unicode.utf8Encode(cp, out[n..]) catch return null;
            },
            else => return null,
        }
    }
    return out[0..n];
}

// ------------------------------------------------------- issued-path tokens
//
// Q1.2, the trust model. Until 6.0 chess.readTextFile / chess.writeTextFile
// took any absolute path the page named: the page is our own code and the
// webview has no `innerHTML`, but "the page is trusted" is not a security
// default — one injected string in a PGN comment rendered the wrong way and
// the bridge would read ~/.ssh/id_ed25519 for it.
//
// Now a path is readable/writable only if the NATIVE side issued it in this
// process. Issuing happens in exactly three places:
//
//   * the SDK's file dialogs (host.js wraps zero.dialogs.openFile/saveFile and
//     calls chess.issuePath on what they returned — the dialog is an SDK
//     builtin, so the result is only visible to main.zig through that call);
//   * drop:files, wrapped the same way in host.js onDropFiles;
//   * the OS's open-document event (forwardOpenFiles above), registered
//     directly because the OS, not the page, chose those paths.
//
// Since then drops are issued natively (issueDroppedPaths, v8-0-plan F3) and
// the dialogs run natively (chess.openPgn / chess.saveText, v8-1-plan N2),
// which never issue anything: the page as shipped no longer calls
// chess.issuePath at all (COMPAT_COMMANDS).
//
// The first two go through the page, so issuePath cannot take the page's word
// that a dialog ran: it VALIDATES instead. A path is accepted only if it is
// absolute, contains no `.`/`..`/dot-prefixed component (that is ~/.ssh,
// ~/.config, ~/.zshrc and every other dotfile in one rule; `..` is refused
// rather than resolved because no dialog ever returns one), no `.app` bundle
// component on macOS, and lies under the user's home or a removable volume
// (/Volumes on macOS, a non-home drive on Windows) — but not under ~/Library
// or %APPDATA% / ~/AppData, except our own data directory. Symlinks are not
// resolved. This narrows "any absolute path" to "a user-picked file outside
// dotfiles and system directories"; it is not a sandbox, and the page still
// has to have asked for a dialog first for anything to be issued at all.
//
// The table is small and FIFO (ISSUED_MAX entries): a session that opens
// hundreds of files just forgets the oldest, and the page re-issues on the
// next dialog anyway. Reads/writes of an unissued path answer
// {"error":"unissued_path"}, which host.js turns into UnissuedPathError.
const ISSUED_MAX: usize = 64;
const ISSUED_PATH_MAX: usize = 2048;

const IssuedPaths = struct {
    paths: [ISSUED_MAX][ISSUED_PATH_MAX]u8 = undefined,
    lens: [ISSUED_MAX]usize = [_]usize{0} ** ISSUED_MAX,
    next: usize = 0,

    fn contains(self: *const IssuedPaths, path: []const u8) bool {
        if (path.len == 0 or path.len > ISSUED_PATH_MAX) return false;
        for (self.lens, 0..) |len, i| {
            if (len == path.len and std.mem.eql(u8, self.paths[i][0..len], path)) return true;
        }
        return false;
    }

    fn add(self: *IssuedPaths, path: []const u8) void {
        if (path.len == 0 or path.len > ISSUED_PATH_MAX) return;
        if (self.contains(path)) return;
        @memcpy(self.paths[self.next][0..path.len], path);
        self.lens[self.next] = path.len;
        self.next = (self.next + 1) % ISSUED_MAX;
    }
};

/// What issuePath validates against — plain strings, so the rule is unit
/// testable without an environment.
const PathPolicy = struct {
    /// $HOME (macOS) / %USERPROFILE% (Windows); "" when unknown, which leaves
    /// only removable volumes.
    home: []const u8,
    /// Our own data directory: the one place under ~/Library / AppData that
    /// is allowed.
    appdata_dir: []const u8,
    windows: bool,
};

fn isSep(c: u8, windows: bool) bool {
    return c == '/' or (windows and c == '\\');
}

/// `dir` with trailing separators removed.
fn trimSep(dir: []const u8, windows: bool) []const u8 {
    var end = dir.len;
    while (end > 0 and isSep(dir[end - 1], windows)) : (end -= 1) {}
    return dir[0..end];
}

/// Is `path` strictly inside `dir`? Case-insensitive: APFS and NTFS both are
/// by default, and a case game must not slip past a deny rule.
fn underDir(path: []const u8, dir_raw: []const u8, windows: bool) bool {
    const dir = trimSep(dir_raw, windows);
    if (dir.len == 0 or path.len <= dir.len) return false;
    if (!std.ascii.eqlIgnoreCase(path[0..dir.len], dir)) return false;
    return isSep(path[dir.len], windows);
}

/// Component names that mean "the system's tree, not the user's documents"
/// wherever they appear below a removable volume — a mounted boot volume
/// (`/Volumes/Macintosh HD/Users/…`) would otherwise bypass the ~/Library
/// rule by a second name.
const SYSTEM_COMPONENTS = [_][]const u8{ "Library", "System", "Applications", "private", "usr", "etc", "var", "bin", "sbin", "opt", "AppData", "Windows", "Program Files", "Program Files (x86)", "ProgramData" };

fn pathAllowed(policy: PathPolicy, path: []const u8) bool {
    if (path.len == 0 or path.len > ISSUED_PATH_MAX) return false;
    if (std.mem.indexOfScalar(u8, path, 0) != null) return false;

    // absolute, in the platform's own spelling
    if (policy.windows) {
        if (path.len < 3 or !std.ascii.isAlphabetic(path[0]) or path[1] != ':' or !isSep(path[2], true)) return false;
    } else {
        if (path[0] != '/') return false;
    }

    const seps: []const u8 = if (policy.windows) "/\\" else "/";

    // every component: no `.`, `..`, dotfile or (macOS) `.app` bundle
    var it = std.mem.splitAny(u8, path, seps);
    var index: usize = 0;
    while (it.next()) |comp| : (index += 1) {
        if (comp.len == 0) continue; // the leading `/`, a doubled or trailing separator
        if (policy.windows and index == 0) continue; // the drive letter, `C:`
        if (comp[0] == '.') return false;
        if (!policy.windows and std.ascii.endsWithIgnoreCase(comp, ".app")) return false;
    }

    const under_home = policy.home.len > 0 and underDir(path, policy.home, policy.windows);
    const removable = if (policy.windows)
        (policy.home.len == 0 or !std.ascii.eqlIgnoreCase(path[0..1], policy.home[0..1]))
    else
        std.mem.startsWith(u8, path, "/Volumes/");
    if (!under_home and !removable) return false;

    // our own data dir is the one system-config location that is fine
    if (policy.appdata_dir.len > 0 and underDir(path, policy.appdata_dir, policy.windows)) return true;

    if (under_home) {
        // ~/Library (macOS) and ~/AppData (Windows) are the OS's, not the user's
        const home = trimSep(policy.home, policy.windows);
        const rest = path[home.len + 1 ..];
        var rest_it = std.mem.splitAny(u8, rest, seps);
        const first = rest_it.next() orelse return false;
        const denied = if (policy.windows) "AppData" else "Library";
        if (std.ascii.eqlIgnoreCase(first, denied)) return false;
        return true;
    }

    // a removable volume: refuse the system trees a mounted boot disk carries
    var vol_it = std.mem.splitAny(u8, path, seps);
    var vol_index: usize = 0;
    while (vol_it.next()) |comp| : (vol_index += 1) {
        // skip `/Volumes/<name>` (posix: "", "Volumes", name) and `D:` (windows)
        if (comp.len == 0) continue;
        if (!policy.windows and vol_index <= 2) continue;
        if (policy.windows and vol_index == 0) continue;
        for (SYSTEM_COMPONENTS) |sys| {
            if (std.ascii.eqlIgnoreCase(comp, sys)) return false;
        }
    }
    return true;
}

fn issuePath(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var path_buf: [ISSUED_PATH_MAX]u8 = undefined;
    const path = jsonStringField(invocation.request.payload, "path", &path_buf) orelse return error.InvalidRequest;
    if (!pathAllowed(self.pathPolicy(), path)) {
        return std.fmt.bufPrint(output, "{{\"ok\":false,\"error\":\"path_refused\"}}", .{}) catch return error.HandlerFailed;
    }
    self.issued.add(path);
    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{}) catch return error.HandlerFailed;
}

fn unissuedPath(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"error\":\"unissued_path\"}}", .{}) catch return error.HandlerFailed;
}

fn writeTextFile(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var path_buf: [4096]u8 = undefined;
    const payload = invocation.request.payload;
    const path = jsonStringField(payload, "path", &path_buf) orelse return error.InvalidRequest;
    if (path.len == 0) return error.InvalidRequest;
    // Q1.2: only a path the native side issued this process (see IssuedPaths)
    if (!self.issued.contains(path)) return unissuedPath(output);

    // v8-0-plan F3: whole, or piece by piece on the heap until the last one
    var incoming: Incoming = undefined;
    var answer: []const u8 = "";
    switch (try receive(self, payload, path, output, &incoming, &answer)) {
        .answered => return answer,
        .pending => return pendingAnswer(output),
        .ready => {},
    }
    defer finishReceive(self, incoming);

    var file = std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true }) catch return error.HandlerFailed;
    defer file.close(self.io);
    file.writeStreamingAll(self.io, incoming.bytes) catch return error.HandlerFailed;

    return std.fmt.bufPrint(output, "true", .{}) catch "true";
}

fn readTextFile(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var path_buf: [4096]u8 = undefined;
    const payload = invocation.request.payload;
    const path = jsonStringField(payload, "path", &path_buf) orelse return error.InvalidRequest;
    if (path.len == 0) return error.InvalidRequest;
    // Q1.2: only a path the native side issued this process (see IssuedPaths)
    if (!self.issued.contains(path)) return unissuedPath(output);
    // v8-0-plan F3: which piece; absent is the first
    const offset = jsonUintField(payload, "offset") orelse 0;

    // Heap, not stack: the 256 KiB this used to hold in two stack buffers is
    // now a 512 KiB piece, on a handler that already sits under the SDK's own
    // 1 MiB result buffer.
    const gpa = std.heap.page_allocator;
    const buf = gpa.alloc(u8, CHUNK_BYTES + 1) catch return error.HandlerFailed;
    defer gpa.free(buf);

    // Too big is refused, never truncated: a file past the buffer once
    // came back as its first 256 KiB, and a PGN library lost every game past
    // the cut while the one straddling it read as a syntax error. readChunk's
    // probe keeps "too big" something the caller can be told about.
    const got = (readChunk(self.io, path, offset, buf, USER_FILE_MAX_BYTES) catch |err| switch (err) {
        error.FileTooLarge => return tooLargeAnswerFor(output, USER_FILE_MAX_BYTES),
        error.HandlerFailed => return error.HandlerFailed,
    }) orelse return error.HandlerFailed;
    if (offset == 0 and got.n == 0) return error.InvalidRequest;

    // JSON object, not a bare string: the result has to be able to say whether
    // it is the whole file. base64 never contains a character JSON escapes, so
    // it can be quoted as-is.
    return chunkAnswer(output, buf[0..got.n], got.more, null);
}

// ------------------------------------------- native file dialogs (v8-1-plan N2)
//
// Before this, the page opened the SDK's builtin dialogs (zero.dialogs.openFile /
// saveFile), got the path back, and asked chess.issuePath to trust it before
// reading or writing: the dialog's answer reached this side only through the
// page. SDK 0.10.1 lets the native side open them itself —
// PlatformServices.showOpenDialog / showSaveDialog (platform/types.zig), which
// Runtime.showOpenDialog / showSaveDialog validate and forward
// (runtime/system_services.zig) — so these two commands do the whole thing
// here and the path never leaves this file:
//
//   * chess.openPgn {title, max?, recent?} — the open dialog, then the file,
//     read the way chess.readTextFile reads it (pieces of CHUNK_BYTES, refused
//     whole past its limit). Answers {cancelled:true}, or {name, b64, more
//     [, token]}: `name` is the file's name for the screen, and a file past
//     one piece is continued by {token, offset}. The limit is FILE_MAX_BYTES
//     unless `max` asks for more (导入全部数据), and never past
//     USER_FILE_MAX_BYTES. `recent` puts the file on the OS's recent-documents
//     list once it was read.
//   * chess.saveText {title, name, recent?, b64…} — the bytes first, in the
//     pieces writeTextFile takes (staged, up to USER_FILE_MAX_BYTES), and only
//     when the last one is in, the save dialog with `name` suggested and its
//     extension as the filter; then the write, the folder shown with the file
//     in it, and {ok, name, revealed[, path]}. The path comes back only when
//     the folder could not be shown, so the toast can say where the file went;
//     no command takes a path from the page any more (COMPAT_COMMANDS aside).
//
// Both answer {probe:true, dialogs} to {probe:true} without opening anything —
// the packaged self-test's `nativeIo` check (v8-1-plan N3). {error:"no_dialog"}
// means this platform has none, and the page takes the browser's picker.

/// What a staged chess.saveText is filed under while it has no path yet. Not
/// "appdata:", so stageLimit gives it USER_FILE_MAX_BYTES (导出全部数据).
const SAVE_TARGET = "dialog:save";

/// The file chess.openPgn picked, for the pieces after the first. One at a
/// time: a second open replaces it, and the first then answers open_lost.
const Opened = struct {
    path_buf: [native_sdk.platform.max_dialog_path_bytes]u8 = undefined,
    path_len: usize = 0,
    limit: usize = 0,
    token: u32 = 0,
    seq: u32 = 0,

    /// Remember `path`; the token its later pieces ask by, or null when the
    /// path does not fit.
    fn remember(self: *Opened, path: []const u8, limit: usize) ?u32 {
        if (path.len == 0 or path.len > self.path_buf.len) return null;
        self.seq +%= 1;
        if (self.seq == 0) self.seq = 1;
        @memcpy(self.path_buf[0..path.len], path);
        self.path_len = path.len;
        self.limit = limit;
        self.token = self.seq;
        return self.token;
    }

    fn pathOf(self: *const Opened, token: usize) ?[]const u8 {
        if (self.path_len == 0 or token == 0 or token != self.token) return null;
        return self.path_buf[0..self.path_len];
    }

    fn forget(self: *Opened) void {
        self.path_len = 0;
        self.token = 0;
    }
};

/// The first path of an open dialog's answer (the SDK joins several with
/// '\n'), or null for Cancel — which the SDK reports as a count of 0.
fn dialogPick(count: usize, paths: []const u8) ?[]const u8 {
    if (count == 0) return null;
    const end = std.mem.indexOfScalar(u8, paths, '\n') orelse paths.len;
    if (end == 0) return null;
    return paths[0..end];
}

/// How much chess.openPgn reads: a PGN's FILE_MAX_BYTES unless the page asks
/// for more, and never past USER_FILE_MAX_BYTES.
fn openLimit(requested: ?usize) usize {
    const want = requested orelse return FILE_MAX_BYTES;
    if (want == 0) return FILE_MAX_BYTES;
    return @min(want, USER_FILE_MAX_BYTES);
}

/// The last component of `path`: what the toast and the imported game's
/// label show instead of the path.
fn baseName(path: []const u8, windows: bool) []const u8 {
    var i = path.len;
    while (i > 0 and !isSep(path[i - 1], windows)) : (i -= 1) {}
    return path[i..];
}

/// The extension of the suggested name, as the save dialog's one filter
/// ("pgn", "json", "png"), or null when there is none worth filtering by.
fn saveExt(name: []const u8) ?[]const u8 {
    const dot = std.mem.lastIndexOfScalar(u8, name, '.') orelse return null;
    const ext = name[dot + 1 ..];
    if (dot == 0 or ext.len == 0 or ext.len > 8) return null;
    for (ext) |c| {
        if (!std.ascii.isAlphanumeric(c)) return null;
    }
    return ext;
}

/// Length of the valid UTF-8 sequence `s` starts with (its first byte is 0x80
/// or above), or 0 when it is not one: a stray continuation byte, a truncated
/// or overlong sequence, a surrogate, or past U+10FFFF.
fn utf8SeqLen(s: []const u8) usize {
    const c = s[0];
    const len: usize = if (c >= 0xC2 and c <= 0xDF) 2 else if (c >= 0xE0 and c <= 0xEF) 3 else if (c >= 0xF0 and c <= 0xF4) 4 else return 0;
    if (s.len < len) return 0;
    for (s[1..len]) |b| {
        if ((b & 0xC0) != 0x80) return 0;
    }
    // the second byte's range is what rules out overlongs, surrogates and
    // anything past U+10FFFF (RFC 3629 §4)
    const b1 = s[1];
    if (c == 0xE0 and b1 < 0xA0) return 0;
    if (c == 0xED and b1 > 0x9F) return 0;
    if (c == 0xF0 and b1 < 0x90) return 0;
    if (c == 0xF4 and b1 > 0x8F) return 0;
    return len;
}

/// A JSON string literal of a file name, quotes included: every valid UTF-8
/// sequence as it is, every byte outside one as U+FFFD, control characters
/// escaped. A name is bytes on macOS and UTF-16 narrowed by the SDK on Windows
/// (lone surrogates and all); neither promises UTF-8, and one stray byte in a
/// JSON string is enough for the page's JSON.parse to throw the whole answer
/// away. jsonAppendString, which paths used, refuses control bytes instead.
fn jsonAppendName(buf: []u8, n: *usize, s: []const u8) bool {
    const hex = "0123456789abcdef";
    if (!jsonAppend(buf, n, "\"")) return false;
    var i: usize = 0;
    while (i < s.len) {
        const c = s[i];
        if (c >= 0x80) {
            const len = utf8SeqLen(s[i..]);
            if (len == 0) {
                if (!jsonAppend(buf, n, "\xEF\xBF\xBD")) return false;
                i += 1;
            } else {
                if (!jsonAppend(buf, n, s[i .. i + len])) return false;
                i += len;
            }
            continue;
        }
        const ok = if (c == '"')
            jsonAppend(buf, n, "\\\"")
        else if (c == '\\')
            jsonAppend(buf, n, "\\\\")
        else if (c < 0x20)
            jsonAppend(buf, n, &[_]u8{ '\\', 'u', '0', '0', hex[c >> 4], hex[c & 15] })
        else
            jsonAppend(buf, n, s[i .. i + 1]);
        if (!ok) return false;
        i += 1;
    }
    return jsonAppend(buf, n, "\"");
}

fn cancelledAnswer(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"cancelled\":true}}", .{}) catch return error.HandlerFailed;
}

/// {"error":code}: no_dialog, dialog_failed, read_failed, write_failed,
/// open_lost — host.js turns each into something the player can be told.
fn fileErrorAnswer(output: []u8, code: []const u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"error\":\"{s}\"}}", .{code}) catch return error.HandlerFailed;
}

/// A dialog that could not be shown: none on this platform (the SDK's
/// UnsupportedService — the page falls back to the browser), or one that
/// failed.
fn dialogErrorCode(err: anyerror) []const u8 {
    return if (err == error.UnsupportedService) "no_dialog" else "dialog_failed";
}

fn probeAnswer(output: []u8, dialogs: bool) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"probe\":true,\"dialogs\":{s}}}", .{if (dialogs) "true" else "false"}) catch return error.HandlerFailed;
}

/// Does this platform give the native side both dialogs? (the probe's answer)
fn dialogsAvailable(self: *const App) bool {
    const rt = self.runtime orelse return false;
    const services = rt.options.platform.services;
    return services.show_open_dialog_fn != null and services.show_save_dialog_fn != null;
}

/// chess.openPgn's first piece: chunkAnswer's {b64, more}, with the file's
/// name in front and, when more pieces follow, the token they ask by.
fn openAnswer(output: []u8, name: []const u8, token: ?u32, bytes: []const u8, more: bool) anyerror![]const u8 {
    const enc = std.base64.standard.Encoder;
    var n: usize = 0;
    if (!jsonAppend(output, &n, "{\"name\":")) return error.HandlerFailed;
    if (!jsonAppendName(output, &n, name)) return error.HandlerFailed;
    if (token) |t| {
        var token_buf: [32]u8 = undefined;
        const field = std.fmt.bufPrint(&token_buf, ",\"token\":{d}", .{t}) catch return error.HandlerFailed;
        if (!jsonAppend(output, &n, field)) return error.HandlerFailed;
    }
    if (!jsonAppend(output, &n, ",\"b64\":\"")) return error.HandlerFailed;
    const enc_len = enc.calcSize(bytes.len);
    if (n + enc_len + 32 > output.len) return error.HandlerFailed;
    _ = enc.encode(output[n..][0..enc_len], bytes);
    n += enc_len;
    if (!jsonAppend(output, &n, if (more) "\",\"more\":true}" else "\",\"more\":false}")) return error.HandlerFailed;
    return output[0..n];
}

/// chess.saveText's answer. `path` is for a toast to show, when the folder
/// did not open to show the file itself.
fn savedAnswer(output: []u8, name: []const u8, revealed: bool, path: ?[]const u8) anyerror![]const u8 {
    var n: usize = 0;
    if (!jsonAppend(output, &n, "{\"ok\":true,\"name\":")) return error.HandlerFailed;
    if (!jsonAppendName(output, &n, name)) return error.HandlerFailed;
    if (!jsonAppend(output, &n, if (revealed) ",\"revealed\":true" else ",\"revealed\":false")) return error.HandlerFailed;
    if (path) |p| {
        if (!jsonAppend(output, &n, ",\"path\":")) return error.HandlerFailed;
        if (!jsonAppendName(output, &n, p)) return error.HandlerFailed;
    }
    if (!jsonAppend(output, &n, "}")) return error.HandlerFailed;
    return output[0..n];
}

/// The same two std.Io calls writeTextFile makes.
fn writeWhole(io: std.Io, path: []const u8, bytes: []const u8) !void {
    var file = try std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true });
    defer file.close(io);
    try file.writeStreamingAll(io, bytes);
}

fn openPgn(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    const payload = invocation.request.payload;
    if (jsonBoolField(payload, "probe") orelse false) return probeAnswer(output, dialogsAvailable(self));

    const gpa = std.heap.page_allocator;
    const buf = gpa.alloc(u8, CHUNK_BYTES + 1) catch return error.HandlerFailed;
    defer gpa.free(buf);

    // a later piece of the file the dialog picked: asked for by its token,
    // never by a path
    if (jsonUintField(payload, "token")) |token| {
        const offset = jsonUintField(payload, "offset") orelse return error.InvalidRequest;
        const path = self.opened.pathOf(token) orelse return fileErrorAnswer(output, "open_lost");
        const got = (readChunk(self.io, path, offset, buf, self.opened.limit) catch |err| switch (err) {
            error.FileTooLarge => return tooLargeAnswerFor(output, self.opened.limit),
            error.HandlerFailed => return fileErrorAnswer(output, "read_failed"),
        }) orelse return fileErrorAnswer(output, "read_failed");
        if (!got.more) self.opened.forget();
        return chunkAnswer(output, buf[0..got.n], got.more, null);
    }

    const runtime = self.runtime orelse return fileErrorAnswer(output, "no_dialog");
    var title_buf: [512]u8 = undefined;
    const title = jsonStringField(payload, "title", &title_buf) orelse "";
    const limit = openLimit(jsonUintField(payload, "max"));
    const paths_buf = gpa.alloc(u8, native_sdk.platform.max_dialog_paths_bytes) catch return error.HandlerFailed;
    defer gpa.free(paths_buf);
    const picked = runtime.showOpenDialog(.{ .title = title }, paths_buf) catch |err| return fileErrorAnswer(output, dialogErrorCode(err));
    const path = dialogPick(picked.count, picked.paths) orelse return cancelledAnswer(output);

    // too big is refused whole, as readTextFile refuses it (readChunk's probe)
    const got = (readChunk(self.io, path, 0, buf, limit) catch |err| switch (err) {
        error.FileTooLarge => return tooLargeAnswerFor(output, limit),
        error.HandlerFailed => return fileErrorAnswer(output, "read_failed"),
    }) orelse return fileErrorAnswer(output, "read_failed");
    var token: ?u32 = null;
    if (got.more) token = self.opened.remember(path, limit) orelse return fileErrorAnswer(output, "read_failed");
    // the recent-documents list (Dock, jump list) is filled from here now:
    // the page never holds the path to hand to native-sdk.os.addRecentDocument
    if (jsonBoolField(payload, "recent") orelse false) runtime.addRecentDocument(path) catch {};
    return openAnswer(output, baseName(path, builtin.os.tag == .windows), token, buf[0..got.n], got.more);
}

fn saveText(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    const payload = invocation.request.payload;
    if (jsonBoolField(payload, "probe") orelse false) return probeAnswer(output, dialogsAvailable(self));

    // the bytes first, in the pieces writeTextFile takes; the dialog only
    // once they are all here, so a Cancel leaves nothing half-sent behind
    var incoming: Incoming = undefined;
    var answer: []const u8 = "";
    switch (try receive(self, payload, SAVE_TARGET, output, &incoming, &answer)) {
        .answered => return answer,
        .pending => return pendingAnswer(output),
        .ready => {},
    }
    defer finishReceive(self, incoming);

    const runtime = self.runtime orelse return fileErrorAnswer(output, "no_dialog");
    var title_buf: [512]u8 = undefined;
    const title = jsonStringField(payload, "title", &title_buf) orelse "";
    var name_buf: [1024]u8 = undefined;
    const name = jsonStringField(payload, "name", &name_buf) orelse "";
    const exts = [_][]const u8{saveExt(name) orelse ""};
    const one_filter = [_]native_sdk.FileFilter{.{ .name = exts[0], .extensions = exts[0..] }};
    const filters: []const native_sdk.FileFilter = if (exts[0].len > 0) one_filter[0..] else &.{};
    var path_buf: [native_sdk.platform.max_dialog_path_bytes]u8 = undefined;
    const picked = runtime.showSaveDialog(.{
        .title = title,
        .default_name = name,
        .filters = filters,
    }, &path_buf) catch |err| return fileErrorAnswer(output, dialogErrorCode(err));
    const path = picked orelse return cancelledAnswer(output);
    if (path.len == 0) return cancelledAnswer(output);

    writeWhole(self.io, path, incoming.bytes) catch return fileErrorAnswer(output, "write_failed");
    if (jsonBoolField(payload, "recent") orelse false) runtime.addRecentDocument(path) catch {};
    // the folder, with the file in it: "where did it go" answered on screen
    const revealed = if (runtime.revealPath(path)) |_| true else |_| false;
    return savedAnswer(output, baseName(path, builtin.os.tag == .windows), revealed, if (revealed) null else path);
}

// ------------------------------------------------------------ app data (Q1.1)
//
// One file, chessboard.json, in the per-user data directory. The page owns
// its contents (schema, migration from localStorage, the corrupt-file
// banner); this side only promises two things:
//
//   * a write is atomic and durable — the bytes go to a tmp file whose name
//     is unique to this write (two windows must not share one tmp and
//     interleave their bytes), that file is flushed to the disk before it is
//     renamed, the previous file is renamed to chessboard.json.bak, and the
//     tmp is renamed into place. A crash at any point leaves either the old
//     file or the new one, never a half-written one;
//   * a read that finds nothing usable in chessboard.json — no file, or a
//     zero-length one, which is what the gap between those two renames looks
//     like after a crash — falls back to chessboard.json.bak, so the last
//     good copy is reachable rather than merely written (6.1);
//   * a read says which of four things happened: {b64,bak} (the file, base64
//     so no JSON escaping is done here, and whether it came from the .bak),
//     {missing:true} (no file and no .bak — a fresh install, so the page
//     migrates), {empty:true} (a zero-length file and no usable .bak: not a
//     fresh install, something went wrong), or {tooLarge:true,limit}.
//
// The text rides as base64 in both directions (host.js does the conversion),
// for the same reason chess.readTextFile does: the bridge frame is JSON and
// base64 is the one encoding that needs no escaping on the Zig side.
//
// v8-0-plan F3: "one file" became one file per key. A request that names a
// `key` (storeKeyValid) reads or writes store/<key>.json with every promise
// above, .bak and all; one without is chessboard.json, which pages since F3 only
// read, to migrate from. Both travel in pieces past CHUNK_BYTES: a read's
// later pieces name their `offset` and whether the first came from the .bak,
// so every piece comes from the same file.
//
// The two filesystem calls this needs beyond what the file handlers above
// already use — create the directory, rename — are isolated in fsMakePath /
// fsRename so a std.Io API mismatch is a one-line fix in one place.

fn fsMakePath(io: std.Io, dir: []const u8) void {
    // std.Io.Dir.createDirPath (0.16's makePath) with an absolute sub-path;
    // an existing directory is not an error worth reporting here — the file
    // create right after it is what fails loudly.
    std.Io.Dir.cwd().createDirPath(io, dir) catch {};
}

fn fsRename(io: std.Io, from: []const u8, to: []const u8) !void {
    const cwd = std.Io.Dir.cwd();
    try std.Io.Dir.rename(cwd, from, cwd, to, io);
}

/// Flush one file's bytes to the disk. Isolated next to fsMakePath / fsRename
/// for the same reason: a std.Io API mismatch stays a one-line fix.
fn fsSync(io: std.Io, file: *std.Io.File) !void {
    try file.sync(io);
}

fn appdataUnavailable(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"error\":\"no_appdata_dir\"}}", .{}) catch return error.HandlerFailed;
}

/// The data directory, for About ("数据位置"). It used to name
/// chessboard.json; since v8-0-plan F3 the profile is the store/ folder beside
/// it, so the folder is the honest answer.
fn appdataPath(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    if (self.appdata_dir.len == 0) return appdataUnavailable(output);
    var n: usize = 0;
    if (!jsonAppend(output, &n, "{\"path\":")) return error.HandlerFailed;
    if (!jsonAppendString(output, &n, self.appdata_dir)) return error.HandlerFailed;
    if (!jsonAppend(output, &n, "}")) return error.HandlerFailed;
    return output[0..n];
}

/// The store key a request names (v8-0-plan F3), or null for chessboard.json.
/// A key that is there and not a valid one fails the request.
fn requestKey(payload: []const u8, buf: []u8) error{InvalidRequest}!?[]const u8 {
    if (jsonFieldValue(payload, "key") == null) return null;
    const key = jsonStringField(payload, "key", buf) orelse return error.InvalidRequest;
    if (!storeKeyValid(key)) return error.InvalidRequest;
    return key;
}

fn appdataRead(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    const payload = invocation.request.payload;
    var key_buf: [STORE_KEY_MAX]u8 = undefined;
    const key = try requestKey(payload, &key_buf);
    const offset = jsonUintField(payload, "offset") orelse 0;
    var path_buf: [1200]u8 = undefined;
    var bak_buf: [1200]u8 = undefined;
    const path = self.appdataFile(&path_buf, key, "") orelse return appdataUnavailable(output);
    const bak_path = self.appdataFile(&bak_buf, key, BAK_SUFFIX) orelse return appdataUnavailable(output);

    // Heap, not stack, like readTextFile: one piece and its spare byte.
    const gpa = std.heap.page_allocator;
    const buf = gpa.alloc(u8, CHUNK_BYTES + 1) catch return error.HandlerFailed;
    defer gpa.free(buf);

    // a later piece comes from the file the first one did, which the page
    // says (`bak`) — deciding again could splice the .bak onto the main file
    if (offset > 0) {
        const from_bak = jsonBoolField(payload, "bak") orelse false;
        const later = (readChunk(self.io, if (from_bak) bak_path else path, offset, buf, FILE_MAX_BYTES) catch |err| switch (err) {
            error.FileTooLarge => return tooLargeAnswer(output),
            error.HandlerFailed => return error.HandlerFailed,
        }) orelse return error.HandlerFailed;
        return chunkAnswer(output, buf[0..later.n], later.more, from_bak);
    }

    // 6.1: the .bak stopped being write-only. The main file wins whenever it
    // holds bytes; only when it holds none does the previous copy answer.
    // A zero-length file is not a fresh install — an interrupted write leaves
    // one — so it falls through to the .bak rather than reading as missing.
    const main_got = readChunk(self.io, path, 0, buf, FILE_MAX_BYTES) catch |err| switch (err) {
        error.FileTooLarge => return tooLargeAnswer(output),
        error.HandlerFailed => return error.HandlerFailed,
    };
    if (main_got) |got| {
        if (got.n > 0) return chunkAnswer(output, buf[0..got.n], got.more, false);
    }
    const bak_got = readChunk(self.io, bak_path, 0, buf, FILE_MAX_BYTES) catch |err| switch (err) {
        error.FileTooLarge => return tooLargeAnswer(output),
        error.HandlerFailed => return error.HandlerFailed,
    };
    if (bak_got) |got| {
        if (got.n > 0) return chunkAnswer(output, buf[0..got.n], got.more, true);
    }
    // Nothing in either place. Tell the two cases apart: a main file that
    // exists but is empty is damage, not a fresh install.
    if (main_got != null) return std.fmt.bufPrint(output, "{{\"empty\":true}}", .{}) catch return error.HandlerFailed;
    return std.fmt.bufPrint(output, "{{\"missing\":true}}", .{}) catch return error.HandlerFailed;
}

fn appdataWrite(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    if (self.appdata_dir.len == 0) return appdataUnavailable(output);
    const payload = invocation.request.payload;
    var key_buf: [STORE_KEY_MAX]u8 = undefined;
    const key = try requestKey(payload, &key_buf);

    // v8-0-plan F3: whole, or staged piece by piece under "appdata:<key>" —
    // a name no issued path (always absolute) can share
    var target_buf: [STORE_KEY_MAX + 16]u8 = undefined;
    const target = std.fmt.bufPrint(&target_buf, "appdata:{s}", .{key orelse ""}) catch return error.HandlerFailed;
    var incoming: Incoming = undefined;
    var answer: []const u8 = "";
    switch (try receive(self, payload, target, output, &incoming, &answer)) {
        .answered => return answer,
        .pending => return pendingAnswer(output),
        .ready => {},
    }
    defer finishReceive(self, incoming);
    try appdataCommit(self, key, incoming.bytes);
    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{}) catch return error.HandlerFailed;
}

/// The atomic, durable write the section comment promises, for one data file.
fn appdataCommit(self: *App, key: ?[]const u8, bytes: []const u8) anyerror!void {
    var main_buf: [1200]u8 = undefined;
    var tmp_buf: [1200]u8 = undefined;
    var bak_buf: [1200]u8 = undefined;
    var dir_buf: [1200]u8 = undefined;
    const main_path = self.appdataFile(&main_buf, key, "") orelse return error.HandlerFailed;
    // 6.1: a tmp name unique to this write. One fixed name meant two windows
    // (or one window whose next flush started before the last finished) both
    // created the same file with .truncate and interleaved their bytes, and
    // both then renamed that mixture into place.
    const seq = self.appdata_seq;
    self.appdata_seq +%= 1;
    var tmp_suffix_buf: [96]u8 = undefined;
    // The App's own address plus the per-write counter. Not a clock: 0.16's
    // std.time has no milliTimestamp, and reaching for a platform-specific
    // pid would put an #if in the one place this file keeps portable. Two
    // processes need the same heap address AND the same counter value at the
    // same moment to collide, which is the pre-6.1 behaviour, not worse.
    const tmp_suffix = std.fmt.bufPrint(&tmp_suffix_buf, "{s}.{x}.{d}", .{ TMP_SUFFIX, @intFromPtr(self), seq }) catch return error.HandlerFailed;
    const tmp_path = self.appdataFile(&tmp_buf, key, tmp_suffix) orelse return error.HandlerFailed;
    const bak_path = self.appdataFile(&bak_buf, key, BAK_SUFFIX) orelse return error.HandlerFailed;
    var dir: []const u8 = self.appdata_dir;
    if (key != null) {
        dir = std.fmt.bufPrint(&dir_buf, "{s}{s}{s}", .{ self.appdata_dir, SEP, STORE_DIR }) catch return error.HandlerFailed;
    }

    fsMakePath(self.io, dir);
    {
        var file = std.Io.Dir.createFileAbsolute(self.io, tmp_path, .{ .truncate = true }) catch return error.HandlerFailed;
        defer file.close(self.io);
        file.writeStreamingAll(self.io, bytes) catch return error.HandlerFailed;
        // 6.1: rename is atomic, the write behind it is not. Without this a
        // power loss could make the rename durable and the bytes not, which
        // is exactly how a zero-length chessboard.json appears.
        fsSync(self.io, &file) catch return error.HandlerFailed;
    }
    // previous file → .bak (there is none on the very first write)
    fsRename(self.io, main_path, bak_path) catch |err| switch (err) {
        error.FileNotFound => {},
        else => return error.HandlerFailed,
    };
    // tmp → the data file: the one step that makes the new data visible
    fsRename(self.io, tmp_path, main_path) catch return error.HandlerFailed;
}

// -------------------------------------------------------- menu language (Q1.6)
//
// The menu bar is comptime data from app.zon, handed to the Runtime once at
// init (runner.zig); the Runtime this fork drives exposes no menu rebuild,
// and a bridge handler holds no *Runtime anyway. So the language cannot be
// applied live. What can be done: remember it, and build the menus in that
// language at the NEXT launch — main() reads the `lang` file before
// runWithOptions and passes localizedMenus(). The page tells the player a
// restart is needed (the answer says restartRequired:true). The labels below
// mirror app.zon's items by command id; a test holds the two together.

const MenuText = struct { key: []const u8, en: []const u8, ja: []const u8 };

/// Menu titles are keyed by their app.zon (Chinese) title, items by command.
const MENU_TEXT = [_]MenuText{
    .{ .key = "对局", .en = "Game", .ja = "対局" },
    .{ .key = "视图", .en = "View", .ja = "表示" },
    .{ .key = "帮助", .en = "Help", .ja = "ヘルプ" },
    .{ .key = "game.new", .en = "New Game", .ja = "新規対局" },
    .{ .key = "game.undo", .en = "Undo Move", .ja = "待った" },
    .{ .key = "game.hint", .en = "Engine Hint", .ja = "エンジンのヒント" },
    .{ .key = "game.flip", .en = "Flip Board", .ja = "盤を反転" },
    .{ .key = "view.panel", .en = "Side Panel", .ja = "サイドパネル" },
    .{ .key = "view.prev", .en = "Previous Move", .ja = "前の手" },
    .{ .key = "view.next", .en = "Next Move", .ja = "次の手" },
    .{ .key = "help.keys", .en = "Keyboard Shortcuts", .ja = "キーボードショートカット" },
};

fn menuTextLookup(key: []const u8) ?MenuText {
    for (MENU_TEXT) |t| {
        if (std.mem.eql(u8, t.key, key)) return t;
    }
    return null;
}

fn menuText(key: []const u8, lang: []const u8, fallback: []const u8) []const u8 {
    const t = menuTextLookup(key) orelse return fallback;
    return if (std.mem.eql(u8, lang, "ja")) t.ja else t.en;
}

/// The three UI languages, as the page spells them; anything else → null.
/// Returns a literal, not the input, so callers can keep it past the buffer.
fn languageTag(raw: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, raw, "zh")) return "zh";
    if (std.mem.eql(u8, raw, "en")) return "en";
    if (std.mem.eql(u8, raw, "ja")) return "ja";
    return null;
}

/// The window title / app name for a launch language. Chinese is app.zon's
/// own "国际象棋"; the others use the product name.
fn windowTitleFor(lang: []const u8) []const u8 {
    return if (std.mem.eql(u8, lang, "zh")) "国际象棋" else "Chessboard";
}

fn setMenuLanguage(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var lang_buf: [8]u8 = undefined;
    const raw = jsonStringField(invocation.request.payload, "lang", &lang_buf) orelse return error.InvalidRequest;
    const lang = languageTag(raw) orelse return error.InvalidRequest;
    var path_buf: [1200]u8 = undefined;
    const path = self.appdataChild(&path_buf, LANG_FILE) orelse return appdataUnavailable(output);
    fsMakePath(self.io, self.appdata_dir);
    var file = std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true }) catch return error.HandlerFailed;
    defer file.close(self.io);
    file.writeStreamingAll(self.io, lang) catch return error.HandlerFailed;
    // applied:false is the honest answer — see the section comment
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"applied\":false,\"restartRequired\":true}}", .{}) catch return error.HandlerFailed;
}

// --------------------------------------------------------- update check (Q1.5)
//
// The minimum viable channel from the plan: ask GitHub for the latest release
// and hand the page its tag and URL. The PAGE compares the tag with its own
// version (app.zon's, which it already shows in About) and decides whether to
// say anything — this side does no comparison and no download, and it runs
// only when the page asks (a "check for updates" action, never at startup on
// its own). The answer is {tag,url} or {error:"network"|"http_NNN"|"parse"}.
//
// Note on the 5 s budget: std.http.Client.fetch in this Zig has no per-call
// timeout option this file can name with confidence, so none is set here;
// host.js races the call against a 5 s timer instead, which is what the page
// needs anyway (the native call may still complete in the background).
const RELEASES_LATEST_URL = "https://api.github.com/repos/hxddh/chessboard/releases/latest";

fn checkUpdate(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    const gpa = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = gpa, .io = self.io };
    defer client.deinit();
    var body: std.Io.Writer.Allocating = .init(gpa);
    defer body.deinit();
    const result = client.fetch(.{
        .location = .{ .url = RELEASES_LATEST_URL },
        .method = .GET,
        // GitHub refuses requests without a User-Agent
        .headers = .{ .user_agent = .{ .override = "chessboard (+https://github.com/hxddh/chessboard)" } },
        .extra_headers = &.{.{ .name = "accept", .value = "application/vnd.github+json" }},
        .response_writer = &body.writer,
    }) catch {
        return std.fmt.bufPrint(output, "{{\"error\":\"network\"}}", .{}) catch return error.HandlerFailed;
    };
    if (result.status != .ok) {
        return std.fmt.bufPrint(output, "{{\"error\":\"http_{d}\"}}", .{@intFromEnum(result.status)}) catch return error.HandlerFailed;
    }
    return formatLatestRelease(body.written(), output);
}

/// {tag,url} out of the releases/latest JSON, or {error:"parse"}. Kept apart
/// from the network so it can be tested on a canned body.
fn formatLatestRelease(json: []const u8, output: []u8) anyerror![]const u8 {
    const parse_error = "{\"error\":\"parse\"}";
    // Raw (still-escaped) fields are fine: a tag is [A-Za-z0-9._-] and the
    // URL is checked below, so neither can carry an escape. Anything else is
    // refused rather than re-quoted.
    const tag = jsonStringFieldRaw(json, "tag_name") orelse return std.fmt.bufPrint(output, "{s}", .{parse_error}) catch return error.HandlerFailed;
    const url = jsonStringFieldRaw(json, "html_url") orelse return std.fmt.bufPrint(output, "{s}", .{parse_error}) catch return error.HandlerFailed;
    if (tag.len == 0 or tag.len > 64 or !safeToken(tag)) return std.fmt.bufPrint(output, "{s}", .{parse_error}) catch return error.HandlerFailed;
    if (!std.mem.startsWith(u8, url, "https://github.com/") or url.len > 512 or !safeUrl(url)) return std.fmt.bufPrint(output, "{s}", .{parse_error}) catch return error.HandlerFailed;
    return std.fmt.bufPrint(output, "{{\"tag\":\"{s}\",\"url\":\"{s}\"}}", .{ tag, url }) catch return error.HandlerFailed;
}

fn safeToken(s: []const u8) bool {
    for (s) |c| {
        if (!(std.ascii.isAlphanumeric(c) or c == '.' or c == '_' or c == '-')) return false;
    }
    return true;
}

fn safeUrl(s: []const u8) bool {
    for (s) |c| {
        if (!(std.ascii.isAlphanumeric(c) or c == '.' or c == '_' or c == '-' or c == '/' or c == ':' or c == '%' or c == '~')) return false;
    }
    return true;
}

// ------------------------------------------------ online sync (v8-0-plan C2)
//
// The player's recent games from Lichess or Chess.com, fetched here because
// the page cannot: its CSP is connect-src 'self' (index.html), and it stays
// that way — scripts/test-chess.mjs holds it. The page asks only from its
// 同步 button, and only once 允许联网同步 is on (off by default); nothing in
// this file calls it on its own.
//
// Public endpoints, no account, no token. A request carries the user name in
// the URL and a User-Agent naming the app (both sites ask callers to say what
// software they are) — nothing else about the person.
//
// The answer is {"pgn":"…","count":N}: the games as one PGN text, newest
// first, whole games only, at most SYNC_ANSWER_MAX bytes. Or {"error":code},
// code being one the page words for the player — offline, rate_limited,
// not_found, bad_request, parse — or "http" with the "status".
//
// Like checkUpdate this holds the calling thread for the length of the
// requests, and host.js races it against a timer. Everything but the
// requests themselves is a function the tests below run on canned answers.

const SYNC_GAMES_DEFAULT: usize = 20;
const SYNC_GAMES_MAX: usize = 50;
/// Lichess names are 2–30 characters and Chess.com's 3–25, both of
/// [A-Za-z0-9_-] — so a name is also safe in a URL path as it stands.
const SYNC_NAME_MIN: usize = 2;
const SYNC_NAME_MAX: usize = 30;
/// A full piece's base64 is what the frame is proven to carry (see the test).
const SYNC_ANSWER_MAX: usize = WRITE_B64_MAX;
/// Chess.com files games by month: this many months back, at most, to find N.
const SYNC_MONTHS_MAX: usize = 3;
const SYNC_USER_AGENT = "chessboard (+https://github.com/hxddh/chessboard)";

const SyncSite = enum { lichess, chesscom };

const SyncRequest = struct {
    site: SyncSite,
    name_buf: [SYNC_NAME_MAX]u8 = undefined,
    name_len: usize = 0,
    max: usize = SYNC_GAMES_DEFAULT,

    fn user(self: *const SyncRequest) []const u8 {
        return self.name_buf[0..self.name_len];
    }
};

/// {site, user, max} from the page, or null when any of it is not usable.
fn syncRequest(payload: []const u8) ?SyncRequest {
    var site_buf: [16]u8 = undefined;
    const site_name = jsonStringField(payload, "site", &site_buf) orelse return null;
    const site: SyncSite = if (std.mem.eql(u8, site_name, "lichess"))
        .lichess
    else if (std.mem.eql(u8, site_name, "chesscom"))
        .chesscom
    else
        return null;
    var req: SyncRequest = .{ .site = site };
    const given = jsonStringField(payload, "user", &req.name_buf) orelse return null;
    if (given.len < SYNC_NAME_MIN or !tokenValid(given, SYNC_NAME_MAX)) return null;
    req.name_len = given.len;
    if (jsonUintField(payload, "max")) |m| req.max = std.math.clamp(m, 1, SYNC_GAMES_MAX);
    return req;
}

/// Standard chess only (the perf types are Lichess's names for its speeds;
/// a variant would not replay in the library), with the clock comments B5's
/// time-pressure figure reads, and no engine evaluations.
fn lichessUrl(buf: []u8, name: []const u8, max: usize) ?[]const u8 {
    return std.fmt.bufPrint(buf, "https://lichess.org/api/games/user/{s}?max={d}&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false", .{ name, max }) catch null;
}

/// Chess.com's paths take the name in lower case.
fn chesscomArchivesUrl(buf: []u8, name: []const u8) ?[]const u8 {
    const prefix = "https://api.chess.com/pub/player/";
    const suffix = "/games/archives";
    const len = prefix.len + name.len + suffix.len;
    if (len > buf.len) return null;
    @memcpy(buf[0..prefix.len], prefix);
    for (name, 0..) |c, i| buf[prefix.len + i] = std.ascii.toLower(c);
    @memcpy(buf[prefix.len + name.len ..][0..suffix.len], suffix);
    return buf[0..len];
}

/// What the page is told for an HTTP status (0: no answer came back at all),
/// or null for a 200. 410 is Chess.com's "never anything here".
fn syncStatusError(status: u32) ?[]const u8 {
    return switch (status) {
        0 => "offline",
        200 => null,
        404, 410 => "not_found",
        429 => "rate_limited",
        else => "http",
    };
}

fn syncErrorAnswer(output: []u8, code: []const u8, status: u32) anyerror![]const u8 {
    if (std.mem.eql(u8, code, "http")) {
        return std.fmt.bufPrint(output, "{{\"error\":\"http\",\"status\":{d}}}", .{status}) catch return error.HandlerFailed;
    }
    return std.fmt.bufPrint(output, "{{\"error\":\"{s}\"}}", .{code}) catch return error.HandlerFailed;
}

/// The length of `s` once JSON-escaped (see jsonEscapeInto).
fn jsonEscapedLen(s: []const u8) usize {
    var len: usize = 0;
    for (s) |c| {
        len += switch (c) {
            '"', '\\', '\n', '\r', '\t' => 2,
            else => if (c < 0x20) @as(usize, 6) else @as(usize, 1),
        };
    }
    return len;
}

/// `s` JSON-escaped into `buf` at `n`. The caller has made the room
/// (jsonEscapedLen). Unlike jsonAppendString, any control byte is taken —
/// as \u00XX — because a PGN from elsewhere is not ours to refuse.
fn jsonEscapeInto(buf: []u8, n: *usize, s: []const u8) void {
    const hex = "0123456789abcdef";
    for (s) |c| {
        const short: ?u8 = switch (c) {
            '"' => '"',
            '\\' => '\\',
            '\n' => 'n',
            '\r' => 'r',
            '\t' => 't',
            else => null,
        };
        if (short) |e| {
            buf[n.*] = '\\';
            buf[n.* + 1] = e;
            n.* += 2;
        } else if (c < 0x20) {
            buf[n.*] = '\\';
            buf[n.* + 1] = 'u';
            buf[n.* + 2] = '0';
            buf[n.* + 3] = '0';
            buf[n.* + 4] = hex[c >> 4];
            buf[n.* + 5] = hex[c & 0x0f];
            n.* += 6;
        } else {
            buf[n.*] = c;
            n.* += 1;
        }
    }
}

/// The answer as it is written: {"pgn":"<game>\n\n<game>…","count":N}.
/// Games arrive newest first; the first that does not fit ends it, since
/// everything after it is older still.
const SyncAnswer = struct {
    out: []u8,
    n: usize = 0,
    count: usize = 0,
    max: usize,
    full: bool = false,

    const HEAD = "{\"pgn\":\"";
    /// `","count":` and the number and `}`, with room to spare
    const TAIL_MAX: usize = 32;

    fn init(output: []u8, max: usize) SyncAnswer {
        var a: SyncAnswer = .{ .out = output[0..@min(output.len, SYNC_ANSWER_MAX)], .max = max };
        if (!jsonAppend(a.out, &a.n, HEAD)) a.full = true;
        return a;
    }

    fn done(self: *const SyncAnswer) bool {
        return self.full or self.count >= self.max;
    }

    /// One game's PGN text; skipped when blank, refused whole when too big.
    fn add(self: *SyncAnswer, game: []const u8) void {
        if (self.done()) return;
        const pgn = std.mem.trim(u8, game, " \t\r\n");
        if (pgn.len == 0) return;
        const sep: []const u8 = if (self.count > 0) "\\n\\n" else "";
        if (self.n + sep.len + jsonEscapedLen(pgn) + TAIL_MAX > self.out.len) {
            self.full = true;
            return;
        }
        @memcpy(self.out[self.n..][0..sep.len], sep);
        self.n += sep.len;
        jsonEscapeInto(self.out, &self.n, pgn);
        self.count += 1;
    }

    fn finish(self: *SyncAnswer) anyerror![]const u8 {
        const tail = std.fmt.bufPrint(self.out[self.n..], "\",\"count\":{d}}}", .{self.count}) catch return error.HandlerFailed;
        return self.out[0 .. self.n + tail.len];
    }
};

/// Where the next game starts at or after `from`: an [Event tag opening a line.
fn pgnGameStart(body: []const u8, from: usize) ?usize {
    var i = from;
    while (std.mem.indexOfPos(u8, body, i, "[Event ")) |at| {
        if (at == 0 or body[at - 1] == '\n') return at;
        i = at + 1;
    }
    return null;
}

/// Lichess answers with the games as one PGN text, newest first.
fn lichessAnswer(body: []const u8, max: usize, output: []u8) anyerror![]const u8 {
    var answer = SyncAnswer.init(output, max);
    var at = pgnGameStart(body, 0);
    while (at) |start| {
        const next = pgnGameStart(body, start + 1);
        answer.add(body[start..(next orelse body.len)]);
        if (answer.done()) break;
        at = next;
    }
    return answer.finish();
}

/// What the page gets for Lichess's answer: the status decides first. A
/// missing player is a 404 with Lichess's HTML error page as the body
/// (src/sync-fixtures/lichess-missing.body), which read as PGN would be
/// "no games" rather than "no such user".
fn lichessReply(status: u32, body: []const u8, max: usize, output: []u8) anyerror![]const u8 {
    if (syncStatusError(status)) |code| return syncErrorAnswer(output, code, status);
    return lichessAnswer(body, max, output);
}

const ChesscomArchives = struct { archives: []const []const u8 };
const ChesscomGame = struct { pgn: []const u8 = "", rules: []const u8 = "chess" };
const ChesscomMonth = struct { games: []const ChesscomGame };

/// The monthly archive URLs, oldest first as Chess.com lists them, or null
/// when the body is not that list. Every one has to be under the same API
/// path, so an answer cannot send the next request anywhere else.
fn chesscomArchives(arena: std.mem.Allocator, body: []const u8) ?[]const []const u8 {
    const parsed = std.json.parseFromSliceLeaky(ChesscomArchives, arena, body, .{ .ignore_unknown_fields = true }) catch return null;
    for (parsed.archives) |url| {
        if (!std.mem.startsWith(u8, url, "https://api.chess.com/pub/player/") or url.len > 256 or !safeUrl(url)) return null;
    }
    return parsed.archives;
}

/// The archive list's answer: the months to walk, or what the page is told
/// instead — the status first (a missing player is a 404 whose JSON body,
/// src/sync-fixtures/chesscom-missing.body, is not a list), then the body.
const ChesscomList = union(enum) {
    months: []const []const u8,
    reply: []const u8,
};

fn chesscomList(arena: std.mem.Allocator, status: u32, body: []const u8, output: []u8) anyerror!ChesscomList {
    if (syncStatusError(status)) |code| return .{ .reply = try syncErrorAnswer(output, code, status) };
    const months = chesscomArchives(arena, body) orelse return .{ .reply = try syncErrorAnswer(output, "parse", 0) };
    return .{ .months = months };
}

/// One month's games into the answer, newest first (the month lists them
/// oldest first). Other rules — Chess960, bughouse… — are skipped: the
/// library replays standard chess. false when the body is not a month.
fn chesscomMonth(arena: std.mem.Allocator, body: []const u8, answer: *SyncAnswer) bool {
    const parsed = std.json.parseFromSliceLeaky(ChesscomMonth, arena, body, .{ .ignore_unknown_fields = true }) catch return false;
    var i = parsed.games.len;
    while (i > 0 and !answer.done()) {
        i -= 1;
        if (std.mem.eql(u8, parsed.games[i].rules, "chess")) answer.add(parsed.games[i].pgn);
    }
    return true;
}

/// One GET into `body`: the HTTP status, or 0 when nothing came back.
fn syncGet(client: *std.http.Client, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating) u32 {
    const result = client.fetch(.{
        .location = .{ .url = url },
        .method = .GET,
        .headers = .{ .user_agent = .{ .override = SYNC_USER_AGENT } },
        .extra_headers = &.{.{ .name = "accept", .value = accept }},
        .response_writer = &body.writer,
    }) catch return 0;
    return @intFromEnum(result.status);
}

fn fetchGames(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    const req = syncRequest(invocation.request.payload) orelse return syncErrorAnswer(output, "bad_request", 0);
    const gpa = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = gpa, .io = self.io };
    defer client.deinit();
    var url_buf: [512]u8 = undefined;
    switch (req.site) {
        .lichess => {
            const url = lichessUrl(&url_buf, req.user(), req.max) orelse return syncErrorAnswer(output, "bad_request", 0);
            var body: std.Io.Writer.Allocating = .init(gpa);
            defer body.deinit();
            const status = syncGet(&client, url, "application/x-chess-pgn", &body);
            return lichessReply(status, body.written(), req.max, output);
        },
        .chesscom => {
            var arena_state = std.heap.ArenaAllocator.init(gpa);
            defer arena_state.deinit();
            const arena = arena_state.allocator();
            const url = chesscomArchivesUrl(&url_buf, req.user()) orelse return syncErrorAnswer(output, "bad_request", 0);
            var list_body: std.Io.Writer.Allocating = .init(gpa);
            defer list_body.deinit();
            const status = syncGet(&client, url, "application/json", &list_body);
            const months = switch (try chesscomList(arena, status, list_body.written(), output)) {
                .months => |m| m,
                .reply => |r| return r,
            };
            var answer = SyncAnswer.init(output, req.max);
            var i = months.len;
            var walked: usize = 0;
            while (i > 0 and walked < SYNC_MONTHS_MAX and !answer.done()) : (walked += 1) {
                i -= 1;
                var month_body: std.Io.Writer.Allocating = .init(gpa);
                defer month_body.deinit();
                const month_status = syncGet(&client, months[i], "application/json", &month_body);
                // games already in hand are worth more than an error about the rest
                if (syncStatusError(month_status)) |code| {
                    if (answer.count > 0) break;
                    return syncErrorAnswer(output, code, month_status);
                }
                if (!chesscomMonth(arena, month_body.written(), &answer)) {
                    if (answer.count > 0) break;
                    return syncErrorAnswer(output, "parse", 0);
                }
            }
            return answer.finish();
        },
    }
}

// ------------------------------------------------------------ self-test (7.5)
//
// 6.0 to 7.3 shipped an app whose engine never started, and every check the
// release ran was green: CI drove Chromium and WebKit, never the packaged app
// with its own WebView. CHESS_SELFTEST=1 makes the packaged app answer one
// question about itself — can the page, as shipped, start Stockfish and get a
// move — and the platform build pipelines ask it before they package.
//
// The page does the work (it is the thing under test); this side only says
// whether the mode is on and, when the page reports, writes the report to
// CHESS_SELFTEST_OUT and exits with 0 (ok) or 1. Off by default: without the
// variable, selftestMode answers {"on":false} and selftestReport refuses.

fn selftestOn(self: *const App) bool {
    const v = self.env_map.get("CHESS_SELFTEST") orelse return false;
    return std.mem.eql(u8, v, "1");
}

fn selftestMode(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    const on = selftestOn(self);
    return std.fmt.bufPrint(output, "{{\"on\":{s}}}", .{if (on) "true" else "false"}) catch return error.HandlerFailed;
}

/// The report the page sends is written as-is: it is the page's own JSON, and
/// the pipeline reads it back with a JSON parser. `"ok":true` in it decides
/// the exit code.
fn selftestOk(payload: []const u8) bool {
    return std.mem.indexOf(u8, payload, "\"ok\":true") != null;
}

fn selftestReport(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = output;
    if (!selftestOn(self)) return error.InvalidRequest;
    const payload = invocation.request.payload;
    if (self.env_map.get("CHESS_SELFTEST_OUT")) |path| {
        if (path.len > 0) {
            if (std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true })) |file| {
                var f = file;
                f.writeStreamingAll(self.io, payload) catch {};
                f.close(self.io);
            } else |_| {}
        }
    }
    std.process.exit(if (selftestOk(payload)) 0 else 1);
}

pub fn main(init: std.process.Init) !void {
    var app_state = App{ .env_map = init.environ_map, .io = init.io };
    // Q1.1: the data dir, before anything can ask for it. Q1.6: the language
    // the page last chose decides the menu set and window title for this
    // launch (the Runtime builds the menu bar once, from what it is handed).
    app_state.resolveAppDataDir();
    const lang = app_state.launchLanguage();
    try runner.runWithOptions(app_state.app(), .{
        .app_name = windowTitleFor(lang),
        .window_title = windowTitleFor(lang),
        .bundle_id = "dev.hxddh.chessboard",
        .icon_path = "assets/icon.png",
        .js_window_api = true,
        .bridge = app_state.bridge(),
        .builtin_bridge = app_state.builtinBridge(),
        .menus = app_state.localizedMenus(lang),
        .runtime_slot = &app_state.runtime,
    }, init);
}

test "the builtin bridge grants exactly the SDK commands the page calls" {
    // the list is what host.js reaches for; a name with a typo is a feature
    // that silently falls back to the browser path, which is the 5.0–5.2 bug
    for (BUILTIN_COMMANDS) |name| {
        try std.testing.expect(std.mem.startsWith(u8, name, "native-sdk."));
        try std.testing.expect(std.mem.indexOfScalar(u8, name[11..], '.') != null);
    }
    try std.testing.expectEqual(@as(usize, 7), BUILTIN_COMMANDS.len);
}

test "the self-test report decides the exit code by its ok field" {
    try std.testing.expect(selftestOk("{\"ok\":true,\"move\":\"e2e4\"}"));
    try std.testing.expect(!selftestOk("{\"ok\":false,\"err\":\"CompileError\"}"));
    try std.testing.expect(!selftestOk("{}"));
}

test "the self-test mode is off unless CHESS_SELFTEST is exactly 1" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = undefined };
    try std.testing.expect(!selftestOn(&app_state));
    try env.put("CHESS_SELFTEST", "yes");
    try std.testing.expect(!selftestOn(&app_state));
    try env.put("CHESS_SELFTEST", "1");
    try std.testing.expect(selftestOn(&app_state));
}

test "every app command has a chess. name and no two share one" {
    for (APP_COMMANDS, 0..) |cmd, i| {
        try std.testing.expect(std.mem.startsWith(u8, cmd.name, "chess."));
        for (APP_COMMANDS[i + 1 ..]) |other| {
            try std.testing.expect(!std.mem.eql(u8, cmd.name, other.name));
        }
    }
    try std.testing.expectEqual(@as(usize, 13), APP_COMMANDS.len);
}

test "one piece each way fits the SDK's bridge frame" {
    const enc = std.base64.standard.Encoder;
    const dec = std.base64.standard.Decoder;
    // v8-0-plan F3. A full chunk's base64 is exactly the most a write piece
    // may carry, and it decodes back into a chunk. base64 grows a payload by
    // 4/3, so this is the pair that breaks first if CHUNK_BYTES moves.
    try std.testing.expectEqual(enc.calcSize(CHUNK_BYTES), WRITE_B64_MAX);
    try std.testing.expect(try dec.calcSizeUpperBound(WRITE_B64_MAX) >= CHUNK_BYTES);
    // The request: that piece, plus the longest issued path at its worst
    // escaping (\u00XX, six bytes a byte) and the other fields.
    try std.testing.expect(WRITE_B64_MAX + 6 * ISSUED_PATH_MAX + 512 <= BRIDGE_FRAME_MAX);
    // The answer: a full piece inside {"b64":…,"more":…,"bak":…}, inside the
    // SDK's {"id":…,"ok":true,"result":…} with its 64-byte id.
    try std.testing.expect(enc.calcSize(CHUNK_BYTES) + 32 + 8 + 64 + 32 <= BRIDGE_FRAME_MAX);
    // BRIDGE_FRAME_MAX is the SDK's number, where this SDK names it
    if (comptime @hasDecl(native_sdk.bridge, "max_message_bytes")) {
        try std.testing.expect(BRIDGE_FRAME_MAX <= native_sdk.bridge.max_message_bytes);
    }
    if (comptime @hasDecl(native_sdk.bridge, "max_result_bytes")) {
        try std.testing.expect(BRIDGE_FRAME_MAX <= native_sdk.bridge.max_result_bytes);
    }
    // the plan's floor, in whole pieces
    try std.testing.expect(FILE_MAX_BYTES >= 16 * 1024 * 1024);
    try std.testing.expectEqual(@as(usize, 0), FILE_MAX_BYTES % CHUNK_BYTES);
}

test "an oversized file answers with a refusal naming the limit, not a truncated file" {
    // The handlers cannot be called without an SDK Invocation and an Io, but
    // the answer they write is exactly what host.js keys on.
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":16777216}", try tooLargeAnswer(&out));
}

test "a file the player picked may be 64 MiB (export all data), an appdata file stays at 16 MiB" {
    try std.testing.expectEqual(@as(usize, 0), USER_FILE_MAX_BYTES % CHUNK_BYTES);
    try std.testing.expect(USER_FILE_MAX_BYTES >= 4 * FILE_MAX_BYTES);
    try std.testing.expectEqual(FILE_MAX_BYTES, stageLimit("appdata:lib00"));
    try std.testing.expectEqual(USER_FILE_MAX_BYTES, stageLimit("/Users/me/chessboard-all.json"));
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":67108864}", try tooLargeAnswerFor(&out, USER_FILE_MAX_BYTES));
    const gpa = std.testing.allocator;
    var stages: Stages = .{};
    defer stages.releaseAll(gpa);
    // past 16 MiB: refused toward the store, taken toward a picked file
    try std.testing.expectError(error.TooLarge, stages.claim(gpa, "t", "appdata:x", FILE_MAX_BYTES + 1, 0, 1));
    const got = try stages.claim(gpa, "u", "/Users/me/all.json", FILE_MAX_BYTES + 1, 0, 1);
    try std.testing.expectEqual(FILE_MAX_BYTES + 1, got.stage.data.len);
    try std.testing.expectError(error.TooLarge, stages.claim(gpa, "v", "/Users/me/all.json", USER_FILE_MAX_BYTES + 1, 0, 1));
}

test "a 2 MB file crosses the bridge in pieces and comes back byte for byte" {
    const gpa = std.testing.allocator;
    const enc = std.base64.standard.Encoder;
    const dec = std.base64.standard.Decoder;
    // not a multiple of the chunk or of 3, so the last piece is short and
    // its base64 is padded
    const total: usize = 2 * 1024 * 1024 + 7;
    const src = try gpa.alloc(u8, total);
    defer gpa.free(src);
    for (src, 0..) |*b, i| b.* = @truncate(i *% 2654435761 >> 7);

    // Write: the page's pieces, each base64'd on its own, staged by `claim`
    // and complete exactly when the last one is in.
    var stages: Stages = .{};
    defer stages.releaseAll(gpa);
    const b64_buf = try gpa.alloc(u8, WRITE_B64_MAX);
    defer gpa.free(b64_buf);
    var offset: usize = 0;
    var pieces: usize = 0;
    var written = false;
    while (offset < total) : (pieces += 1) {
        const n = @min(CHUNK_BYTES, total - offset);
        const b64 = enc.encode(b64_buf[0..enc.calcSize(n)], src[offset..][0..n]);
        try std.testing.expect(b64.len <= WRITE_B64_MAX);
        const len = try dec.calcSizeForSlice(b64);
        const got = try stages.claim(gpa, "p1-a", "appdata:library", total, offset, len);
        try dec.decode(got.dest, b64);
        got.stage.filled += len;
        offset += n;
        try std.testing.expectEqual(offset == total, got.stage.complete());
        if (got.stage.complete()) {
            try std.testing.expectEqualSlices(u8, src, got.stage.data);
            stages.release(gpa, got.stage);
            written = true;
        }
    }
    try std.testing.expect(written);
    try std.testing.expectEqual(@as(usize, 5), pieces);

    // Read: the handler's pieces, each inside the frame, reassembled.
    const out = try gpa.alloc(u8, BRIDGE_FRAME_MAX);
    defer gpa.free(out);
    const back = try gpa.alloc(u8, total);
    defer gpa.free(back);
    var at: usize = 0;
    while (at < total) {
        const n = @min(CHUNK_BYTES, total - at);
        const more = at + n < total;
        const answer = try chunkAnswer(out, src[at..][0..n], more, false);
        try std.testing.expect(answer.len + 128 <= BRIDGE_FRAME_MAX);
        try std.testing.expectEqual(more, jsonBoolField(answer, "more").?);
        try std.testing.expectEqual(false, jsonBoolField(answer, "bak").?);
        const b64 = jsonStringFieldRaw(answer, "b64").?;
        const len = try dec.calcSizeForSlice(b64);
        try dec.decode(back[at..][0..len], b64);
        at += len;
    }
    try std.testing.expectEqualSlices(u8, src, back);
}

test "a staged write refuses what it cannot finish, and frees what it drops" {
    // std.testing.allocator fails the test on a leak: every refusal below
    // has to hand its buffer back
    const gpa = std.testing.allocator;
    var stages: Stages = .{};
    defer stages.releaseAll(gpa);

    // over the limit, or nothing at all
    try std.testing.expectError(error.TooLarge, stages.claim(gpa, "t", "appdata:x", FILE_MAX_BYTES + 1, 0, 1));
    try std.testing.expectError(error.TooLarge, stages.claim(gpa, "t", "appdata:x", 0, 0, 1));
    // a name that is not a plain token
    try std.testing.expectError(error.BadChunk, stages.claim(gpa, "a/b", "appdata:x", 10, 0, 5));
    try std.testing.expectError(error.BadChunk, stages.claim(gpa, "", "appdata:x", 10, 0, 5));
    // a later piece of a transfer nobody opened
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:x", 10, 5, 5));

    // out of order: the transfer is dropped, not patched with a hole
    _ = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:x", 10, 6, 4));
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:x", 10, 4, 4));

    // a piece aimed at another file, or claiming another size
    var got = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    got.stage.filled += 4;
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:y", 10, 4, 4));
    got = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    got.stage.filled += 4;
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:x", 11, 4, 4));
    // a piece running past the total
    got = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    got.stage.filled += 4;
    try std.testing.expectError(error.BadChunk, stages.claim(gpa, "t", "appdata:x", 10, 4, 7));

    // starting over at 0 replaces the transfer rather than adding a second
    got = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    got.stage.filled += 4;
    got = try stages.claim(gpa, "t", "appdata:x", 10, 0, 4);
    try std.testing.expectEqual(@as(usize, 0), got.stage.filled);
    var busy: usize = 0;
    for (&stages.slots) |*s| busy += @intFromBool(s.busy());
    try std.testing.expectEqual(@as(usize, 1), busy);

    // more transfers than slots: the oldest is evicted and answers StageLost
    var name_buf: [8]u8 = undefined;
    var i: usize = 0;
    while (i < STAGE_SLOTS) : (i += 1) {
        const name = try std.fmt.bufPrint(&name_buf, "n{d}", .{i});
        _ = try stages.claim(gpa, name, "appdata:x", 10, 0, 4);
    }
    try std.testing.expectError(error.StageLost, stages.claim(gpa, "t", "appdata:x", 10, 4, 4));
}

test "a piece's fields are read as numbers and flags, not as look-alike text" {
    const p = "{\"key\":\"offset\",\"path\":\"/Users/a/\\\"total\\\":9.pgn\",\"txn\":\"p1\",\"total\" : 1048576,\"offset\":524288,\"bak\":true}";
    try std.testing.expectEqual(@as(?usize, 1048576), jsonUintField(p, "total"));
    try std.testing.expectEqual(@as(?usize, 524288), jsonUintField(p, "offset"));
    try std.testing.expectEqual(@as(?bool, true), jsonBoolField(p, "bak"));
    try std.testing.expectEqual(@as(?usize, null), jsonUintField(p, "missing"));
    try std.testing.expectEqual(@as(?usize, null), jsonUintField("{\"offset\":-1}", "offset"));
    try std.testing.expectEqual(@as(?usize, null), jsonUintField("{\"offset\":\"5\"}", "offset"));
    try std.testing.expectEqual(@as(?bool, null), jsonBoolField("{\"bak\":1}", "bak"));
    // no fields at all is the pre-F3 one-piece shape
    try std.testing.expectEqual(@as(?usize, null), jsonUintField("{\"path\":\"/a\",\"b64\":\"AAAA\"}", "total"));
    // Codex on #85: a file name that spells a field is escaped inside its
    // string (every inner quote is \"), so it can never read as the field
    try std.testing.expectEqual(@as(?usize, null), jsonUintField("{\"path\":\"/tmp/\\\"offset\\\":1\"}", "offset"));
}

test "store keys are plain names that cannot leave the store" {
    for ([_][]const u8{ "save", "settings", "panelOpen", "meta", "selftest", "achievements", "a_b-c" }) |k| {
        try std.testing.expect(storeKeyValid(k));
    }
    for ([_][]const u8{ "", "../x", "a/b", "a\\b", ".bak", "save.json", "a b", "CON", "nul", "com1", "LPT9", "x" ** 33 }) |k| {
        try std.testing.expect(!storeKeyValid(k));
    }
    var buf: [STORE_KEY_MAX]u8 = undefined;
    try std.testing.expectEqualStrings("library", (try requestKey("{\"key\":\"library\",\"b64\":\"AA==\"}", &buf)).?);
    try std.testing.expect((try requestKey("{\"b64\":\"AA==\"}", &buf)) == null);
    try std.testing.expectError(error.InvalidRequest, requestKey("{\"key\":\"../chessboard\"}", &buf));
}

test "base64 survives the round trip the bridge puts it through" {
    const enc = std.base64.standard.Encoder;
    const dec = std.base64.standard.Decoder;
    // every remainder class of 3, since that is where base64 padding differs
    for ([_]usize{ 0, 1, 2, 3, 4, 5, 6, 1023, 1024, 1025 }) |n| {
        var src: [1025]u8 = undefined;
        for (src[0..n], 0..) |*b, i| b.* = @truncate(i * 31 + 7);
        var b64: [2048]u8 = undefined;
        const encoded = enc.encode(b64[0..enc.calcSize(n)], src[0..n]);
        var back: [1025]u8 = undefined;
        const dec_len = try dec.calcSizeForSlice(encoded);
        try std.testing.expectEqual(n, dec_len);
        try dec.decode(back[0..dec_len], encoded);
        try std.testing.expectEqualSlices(u8, src[0..n], back[0..dec_len]);
    }
}

test "jsonStringField unescapes what the page escaped" {
    var buf: [256]u8 = undefined;
    // a Windows path: JSON.stringify doubles every separator, and the handler
    // has to undo that before the filesystem ever sees it
    const win = "{\"path\":\"C:\\\\Users\\\\a b\\\\game.pgn\"}";
    try std.testing.expectEqualStrings(
        "C:\\Users\\a b\\game.pgn",
        jsonStringField(win, "path", &buf).?,
    );
    // a quote inside the value must not end the scan, and must come back bare
    try std.testing.expectEqualStrings(
        "he said \"hi\"",
        jsonStringField("{\"path\":\"he said \\\"hi\\\"\"}", "path", &buf).?,
    );
    // \u escapes, including the surrogate pair JSON.stringify emits for
    // anything past the BMP
    try std.testing.expectEqualStrings(
        "国际象棋",
        jsonStringField("{\"path\":\"\\u56fd\\u9645\\u8c61\\u68cb\"}", "path", &buf).?,
    );
    try std.testing.expectEqualStrings(
        "\u{1F600}",
        jsonStringField("{\"path\":\"\\ud83d\\ude00\"}", "path", &buf).?,
    );
    // malformed input fails the request rather than reaching the filesystem
    try std.testing.expect(jsonStringField("{\"path\":\"\\q\"}", "path", &buf) == null);
    try std.testing.expect(jsonStringField("{\"path\":\"\\ud83d\"}", "path", &buf) == null);
    // a value longer than the caller's buffer is refused, not truncated
    var tiny: [3]u8 = undefined;
    try std.testing.expect(jsonStringField("{\"path\":\"abcd\"}", "path", &tiny) == null);
}

test "jsonAppendString escapes what a path can carry" {
    var buf: [64]u8 = undefined;
    var n: usize = 0;
    try std.testing.expect(jsonAppendString(&buf, &n, "C:\\Users\\a \"b\"\\g.pgn"));
    try std.testing.expectEqualStrings("\"C:\\\\Users\\\\a \\\"b\\\"\\\\g.pgn\"", buf[0..n]);
    // no room → refused whole, never a cut string
    var tiny: [4]u8 = undefined;
    var m: usize = 0;
    try std.testing.expect(!jsonAppendString(&tiny, &m, "abcdef"));
}

test "the file dialogs are the native side's: the page is granted neither, nor the reveal" {
    // v8-1-plan N2 — chess.openPgn / chess.saveText open them in main.zig
    for (BUILTIN_COMMANDS) |name| {
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.dialog.openFile"));
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.dialog.saveFile"));
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.os.revealPath"));
    }
    // and every compatibility command is still registered, with its policy
    for (COMPAT_COMMANDS) |compat| {
        var found = false;
        for (APP_COMMANDS) |cmd| found = found or std.mem.eql(u8, cmd.name, compat);
        try std.testing.expect(found);
    }
}

test "a cancelled open dialog is a cancel, not an empty file" {
    // the SDK reports Cancel as a count of 0 (macOS, Windows, null platform)
    try std.testing.expect(dialogPick(0, "") == null);
    try std.testing.expect(dialogPick(0, "/Users/me/a.pgn") == null);
    try std.testing.expect(dialogPick(1, "") == null);
    try std.testing.expectEqualStrings("/Users/me/a.pgn", dialogPick(1, "/Users/me/a.pgn").?);
    // several, joined by '\n': the first (the dialog is single-choice anyway)
    try std.testing.expectEqualStrings("C:\\a.pgn", dialogPick(2, "C:\\a.pgn\nC:\\b.pgn").?);
    var out: [32]u8 = undefined;
    try std.testing.expectEqualStrings("{\"cancelled\":true}", try cancelledAnswer(&out));
}

test "an open reads to 16 MiB, to 64 MiB when 导入全部数据 asks, and never past that" {
    try std.testing.expectEqual(FILE_MAX_BYTES, openLimit(null));
    try std.testing.expectEqual(FILE_MAX_BYTES, openLimit(0));
    try std.testing.expectEqual(USER_FILE_MAX_BYTES, openLimit(USER_FILE_MAX_BYTES));
    try std.testing.expectEqual(USER_FILE_MAX_BYTES, openLimit(1 << 40));
    // too large is the same refusal readTextFile gives, naming the limit
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":16777216}", try tooLargeAnswerFor(&out, openLimit(null)));
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":67108864}", try tooLargeAnswerFor(&out, openLimit(64 * 1024 * 1024)));
    // and a save is staged to the 64 MiB a picked file may be (导出全部数据)
    try std.testing.expectEqual(USER_FILE_MAX_BYTES, stageLimit(SAVE_TARGET));
}

test "a file name that is not UTF-8 still makes a JSON string the page can parse" {
    var buf: [128]u8 = undefined;
    var n: usize = 0;
    // valid UTF-8 as it is, quotes and backslashes escaped
    try std.testing.expect(jsonAppendName(&buf, &n, "王 \"x\"\\.pgn"));
    try std.testing.expectEqualStrings("\"王 \\\"x\\\"\\\\.pgn\"", buf[0..n]);
    // a stray byte, an overlong '/', a surrogate, a truncated tail: U+FFFD each byte
    n = 0;
    try std.testing.expect(jsonAppendName(&buf, &n, "a\xffb\xc0\xafc\xed\xa0\x80d\xe7\x8e"));
    try std.testing.expectEqualStrings("\"a\xEF\xBF\xBDb\xEF\xBF\xBD\xEF\xBF\xBDc\xEF\xBF\xBD\xEF\xBF\xBD\xEF\xBF\xBDd\xEF\xBF\xBD\xEF\xBF\xBD\"", buf[0..n]);
    // control bytes escaped rather than refused
    n = 0;
    try std.testing.expect(jsonAppendName(&buf, &n, "a\x01\n"));
    try std.testing.expectEqualStrings("\"a\\u0001\\u000a\"", buf[0..n]);
    // four-byte sequences are kept; no room is refused, never cut
    n = 0;
    try std.testing.expect(jsonAppendName(&buf, &n, "\xf0\x9f\x98\x80"));
    try std.testing.expectEqualStrings("\"\xf0\x9f\x98\x80\"", buf[0..n]);
    var tiny: [4]u8 = undefined;
    var m: usize = 0;
    try std.testing.expect(!jsonAppendName(&tiny, &m, "\xff\xff"));
}

test "a picked file is shown by its name, and saved with its extension as the filter" {
    try std.testing.expectEqualStrings("a.pgn", baseName("/Users/me/games/a.pgn", false));
    try std.testing.expectEqualStrings("b.pgn", baseName("C:\\Users\\me\\b.pgn", true));
    try std.testing.expectEqualStrings("c\\d.pgn", baseName("/tmp/c\\d.pgn", false));
    try std.testing.expectEqualStrings("e.pgn", baseName("e.pgn", false));
    try std.testing.expectEqualStrings("pgn", saveExt("chess-20260929.pgn").?);
    try std.testing.expectEqualStrings("json", saveExt("chessboard-all-20260929.json").?);
    try std.testing.expect(saveExt("noext") == null);
    try std.testing.expect(saveExt(".hidden") == null);
    try std.testing.expect(saveExt("a.") == null);
    try std.testing.expect(saveExt("a.p;g") == null);
}

test "a later piece of an opened file is asked for by its token, never by a path" {
    var opened: Opened = .{};
    try std.testing.expect(opened.pathOf(0) == null);
    const t1 = opened.remember("/Users/me/big.pgn", FILE_MAX_BYTES).?;
    try std.testing.expectEqualStrings("/Users/me/big.pgn", opened.pathOf(t1).?);
    try std.testing.expectEqual(FILE_MAX_BYTES, opened.limit);
    try std.testing.expect(opened.pathOf(t1 + 1) == null);
    // a second open replaces the first, whose token then goes nowhere
    const t2 = opened.remember("/Users/me/all.json", USER_FILE_MAX_BYTES).?;
    try std.testing.expect(t2 != t1);
    try std.testing.expect(opened.pathOf(t1) == null);
    opened.forget();
    try std.testing.expect(opened.pathOf(t2) == null);
    try std.testing.expect(opened.remember("", FILE_MAX_BYTES) == null);
}

test "an open's first piece carries the name and the token, and fits the frame at worst" {
    const gpa = std.testing.allocator;
    const out = try gpa.alloc(u8, BRIDGE_FRAME_MAX);
    defer gpa.free(out);
    const piece = try gpa.alloc(u8, CHUNK_BYTES);
    defer gpa.free(piece);
    for (piece, 0..) |*b, i| b.* = @truncate(i *% 31);
    // the longest name a dialog returns, every byte escaped six-fold
    var name: [native_sdk.platform.max_dialog_path_bytes]u8 = undefined;
    @memset(&name, 0x01);
    const answer = try openAnswer(out, &name, 7, piece, true);
    // the SDK's {"id":…,"ok":true,"result":…} around it, with its 64-byte id
    try std.testing.expect(answer.len + 64 + 32 <= BRIDGE_FRAME_MAX);
    try std.testing.expectEqual(@as(usize, 7), jsonUintField(answer, "token").?);
    try std.testing.expectEqual(true, jsonBoolField(answer, "more").?);
    const b64 = jsonStringFieldRaw(answer, "b64").?;
    const dec = std.base64.standard.Decoder;
    const back = try gpa.alloc(u8, try dec.calcSizeForSlice(b64));
    defer gpa.free(back);
    try dec.decode(back, b64);
    try std.testing.expectEqualSlices(u8, piece, back);
    // a whole file in one piece: no token to continue by
    const small = try openAnswer(out, "a.pgn", null, "1. e4", false);
    try std.testing.expect(jsonUintField(small, "token") == null);
    try std.testing.expectEqualStrings("{\"name\":\"a.pgn\",\"b64\":\"MS4gZTQ=\",\"more\":false}", small);
}

test "a save answers with the name, and with the path only when the folder did not open" {
    var out: [128]u8 = undefined;
    try std.testing.expectEqualStrings("{\"ok\":true,\"name\":\"a.pgn\",\"revealed\":true}", try savedAnswer(&out, "a.pgn", true, null));
    try std.testing.expectEqualStrings("{\"ok\":true,\"name\":\"a.pgn\",\"revealed\":false,\"path\":\"C:\\\\x\\\\a.pgn\"}", try savedAnswer(&out, "a.pgn", false, "C:\\x\\a.pgn"));
}

test "the self-test probe answers without a dialog, and says whether there is one" {
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"probe\":true,\"dialogs\":true}", try probeAnswer(&out, true));
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    const app_state = App{ .env_map = &env, .io = undefined };
    // no Runtime handed over (outside the runner): no dialogs, said so
    try std.testing.expect(!dialogsAvailable(&app_state));
    try std.testing.expectEqualStrings("no_dialog", dialogErrorCode(error.UnsupportedService));
    try std.testing.expectEqualStrings("dialog_failed", dialogErrorCode(error.OutOfMemory));
    try std.testing.expectEqualStrings("{\"error\":\"no_dialog\"}", try fileErrorAnswer(&out, "no_dialog"));
}

test "the issued-path table remembers what it was given, FIFO, bounded" {
    var table: IssuedPaths = .{};
    try std.testing.expect(!table.contains("/Users/a/g.pgn"));
    table.add("/Users/a/g.pgn");
    try std.testing.expect(table.contains("/Users/a/g.pgn"));
    try std.testing.expect(!table.contains("/Users/a/g.pgn2"));
    // a duplicate does not take a slot
    table.add("/Users/a/g.pgn");
    try std.testing.expectEqual(@as(usize, 1), table.next);
    // fill it past the bound: the first entry is the one forgotten
    var name_buf: [64]u8 = undefined;
    var i: usize = 0;
    while (i < ISSUED_MAX) : (i += 1) {
        const name = try std.fmt.bufPrint(&name_buf, "/Users/a/{d}.pgn", .{i});
        table.add(name);
    }
    try std.testing.expect(!table.contains("/Users/a/g.pgn"));
    try std.testing.expect(table.contains("/Users/a/0.pgn"));
    // over-long and empty are refused at the door
    const long = [_]u8{'x'} ** (ISSUED_PATH_MAX + 1);
    table.add(&long);
    try std.testing.expect(!table.contains(&long));
    try std.testing.expect(!table.contains(""));
}

test "issuePath accepts a user-picked file and refuses the system's" {
    const mac: PathPolicy = .{ .home = "/Users/me", .appdata_dir = "/Users/me/Library/Application Support/Chessboard", .windows = false };
    // the ordinary case, spaces and CJK included
    try std.testing.expect(pathAllowed(mac, "/Users/me/Documents/我的 棋谱/game.pgn"));
    try std.testing.expect(pathAllowed(mac, "/Users/me/Desktop/a.pgn"));
    try std.testing.expect(pathAllowed(mac, "/Volumes/USB/games.pgn"));
    // our own data dir is the one thing under ~/Library that is fine
    try std.testing.expect(pathAllowed(mac, "/Users/me/Library/Application Support/Chessboard/chessboard.json"));
    // dotfiles, in any position
    try std.testing.expect(!pathAllowed(mac, "/Users/me/.ssh/id_ed25519"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/.config/x"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/.zshrc"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/Documents/.hidden/a.pgn"));
    // `..` is refused, not resolved — no dialog returns one
    try std.testing.expect(!pathAllowed(mac, "/Users/me/Documents/../.ssh/id_ed25519"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/./a.pgn"));
    // ~/Library, case games included; the app bundle; the system
    try std.testing.expect(!pathAllowed(mac, "/Users/me/Library/Keychains/login.keychain-db"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/LIBRARY/x"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/Applications/Chessboard.app/Contents/Info.plist"));
    try std.testing.expect(!pathAllowed(mac, "/Applications/Chessboard.app/Contents/Resources/index.html"));
    try std.testing.expect(!pathAllowed(mac, "/etc/passwd"));
    try std.testing.expect(!pathAllowed(mac, "/Users/other/a.pgn"));
    try std.testing.expect(!pathAllowed(mac, "/Users/me"));
    try std.testing.expect(!pathAllowed(mac, "/Users/mee/a.pgn"));
    // a mounted boot volume is not a way around the rules above
    try std.testing.expect(!pathAllowed(mac, "/Volumes/Macintosh HD/Users/me/Library/x"));
    try std.testing.expect(!pathAllowed(mac, "/Volumes/Macintosh HD/Applications/x.app/a"));
    // not absolute, not a path
    try std.testing.expect(!pathAllowed(mac, "Documents/a.pgn"));
    try std.testing.expect(!pathAllowed(mac, ""));
    try std.testing.expect(!pathAllowed(mac, "/Users/me/a\x00.pgn"));

    const win: PathPolicy = .{ .home = "C:\\Users\\me", .appdata_dir = "C:\\Users\\me\\AppData\\Roaming\\Chessboard", .windows = true };
    try std.testing.expect(pathAllowed(win, "C:\\Users\\me\\Desktop\\a.pgn"));
    try std.testing.expect(pathAllowed(win, "c:\\users\\me\\Documents\\a.pgn"));
    try std.testing.expect(pathAllowed(win, "D:\\games\\a.pgn"));
    try std.testing.expect(pathAllowed(win, "C:\\Users\\me\\AppData\\Roaming\\Chessboard\\chessboard.json"));
    try std.testing.expect(!pathAllowed(win, "C:\\Users\\me\\AppData\\Local\\x"));
    try std.testing.expect(!pathAllowed(win, "C:\\Users\\me\\appdata\\Roaming\\x"));
    try std.testing.expect(!pathAllowed(win, "C:\\Windows\\System32\\config\\SAM"));
    try std.testing.expect(!pathAllowed(win, "C:\\Program Files\\x"));
    try std.testing.expect(!pathAllowed(win, "D:\\Windows\\x"));
    try std.testing.expect(!pathAllowed(win, "C:\\Users\\me\\.ssh\\id_ed25519"));
    try std.testing.expect(!pathAllowed(win, "\\\\server\\share\\a.pgn"));
    try std.testing.expect(!pathAllowed(win, "Desktop\\a.pgn"));

    // no home known: only removable volumes remain
    const homeless: PathPolicy = .{ .home = "", .appdata_dir = "", .windows = false };
    try std.testing.expect(!pathAllowed(homeless, "/Users/me/a.pgn"));
    try std.testing.expect(pathAllowed(homeless, "/Volumes/USB/a.pgn"));
}

test "the menu table covers every menu and item app.zon declares" {
    // app.zon's menus reach the Runtime through runner.MenuStorage; a command
    // added there without a row here would ship untranslated on en/ja.
    var storage: runner.MenuStorage = .{};
    const menus = storage.fromManifest();
    try std.testing.expect(menus.len > 0);
    for (menus) |menu| {
        try std.testing.expect(menuTextLookup(menu.title) != null);
        for (menu.items) |item| {
            if (item.command.len == 0) continue; // a separator
            try std.testing.expect(menuTextLookup(item.command) != null);
        }
    }
    // and the table has nothing app.zon does not
    for (MENU_TEXT) |t| {
        var found = false;
        for (menus) |menu| {
            if (std.mem.eql(u8, menu.title, t.key)) found = true;
            for (menu.items) |item| {
                if (std.mem.eql(u8, item.command, t.key)) found = true;
            }
        }
        try std.testing.expect(found);
    }
    try std.testing.expectEqualStrings("Game", menuText("对局", "en", "对局"));
    try std.testing.expectEqualStrings("対局", menuText("对局", "ja", "对局"));
    try std.testing.expectEqualStrings("", menuText("", "en", ""));
}

test "language tags are the page's three and nothing else" {
    try std.testing.expectEqualStrings("en", languageTag("en").?);
    try std.testing.expectEqualStrings("ja", languageTag("ja").?);
    try std.testing.expectEqualStrings("zh", languageTag("zh").?);
    try std.testing.expect(languageTag("fr") == null);
    try std.testing.expect(languageTag("") == null);
    try std.testing.expectEqualStrings("国际象棋", windowTitleFor("zh"));
    try std.testing.expectEqualStrings("Chessboard", windowTitleFor("en"));
}

test "the update answer carries the tag and URL, and nothing it cannot vouch for" {
    var out: [1024]u8 = undefined;
    const body = "{\"url\":\"https://api.github.com/repos/hxddh/chessboard/releases/1\",\"html_url\":\"https://github.com/hxddh/chessboard/releases/tag/v6.0.0\",\"id\":1,\"tag_name\":\"v6.0.0\",\"name\":\"6.0.0\"}";
    try std.testing.expectEqualStrings(
        "{\"tag\":\"v6.0.0\",\"url\":\"https://github.com/hxddh/chessboard/releases/tag/v6.0.0\"}",
        try formatLatestRelease(body, &out),
    );
    try std.testing.expectEqualStrings("{\"error\":\"parse\"}", try formatLatestRelease("{\"message\":\"Not Found\"}", &out));
    // a tag or URL that would need escaping is refused rather than re-quoted
    try std.testing.expectEqualStrings("{\"error\":\"parse\"}", try formatLatestRelease("{\"html_url\":\"https://github.com/x\",\"tag_name\":\"v1\\\"\"}", &out));
    try std.testing.expectEqualStrings("{\"error\":\"parse\"}", try formatLatestRelease("{\"html_url\":\"https://evil.example/x\",\"tag_name\":\"v1\"}", &out));
}

// ---- v8-0-plan C2: the two sites' answers, as they come back ----------------

/// What /api/games/user/{name}?clocks=true answers: PGN, newest first, a
/// blank line between the tags and the moves and two between games.
const LICHESS_SAMPLE =
    \\[Event "Rated blitz game"]
    \\[Site "https://lichess.org/Ab3dEf7h"]
    \\[Date "2026.09.21"]
    \\[White "sync_tester"]
    \\[Black "Opponent-2"]
    \\[Result "1-0"]
    \\[WhiteElo "1712"]
    \\[BlackElo "1698"]
    \\[TimeControl "180+2"]
    \\[Termination "Normal"]
    \\
    \\1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:03:01] } 2... Nc6 { [%clk 0:02:59] } 3. Bc4 { [%clk 0:03:00] } 3... Nf6 { [%clk 0:02:57] } 4. Qxf7# { [%clk 0:03:00] } 1-0
    \\
    \\
    \\[Event "Casual rapid game"]
    \\[Site "https://lichess.org/Zz9yXw8v"]
    \\[Date "2026.09.20"]
    \\[White "Someone \"quoted\""]
    \\[Black "sync_tester"]
    \\[Result "1/2-1/2"]
    \\[TimeControl "600+0"]
    \\
    \\1. d4 { [%clk 0:10:00] } 1... d5 { [%clk 0:10:00] } 2. c4 { [%clk 0:09:58] } 2... c6 { [%clk 0:09:55] } 1/2-1/2
    \\
    \\
    \\[Event "Rated bullet game"]
    \\[Site "https://lichess.org/Qq1wEe2r"]
    \\[Date "2026.09.19"]
    \\[White "sync_tester"]
    \\[Black "third"]
    \\[Result "0-1"]
    \\
    \\1. f3 { [%clk 0:01:00] } 1... e5 { [%clk 0:01:00] } 2. g4 { [%clk 0:00:59] } 2... Qh4# { [%clk 0:00:59] } 0-1
    \\
    \\
;

/// /pub/player/{u}/games/archives: every month with games, oldest first.
const CHESSCOM_ARCHIVES_SAMPLE =
    \\{"archives":["https://api.chess.com/pub/player/sync_tester/games/2026/07","https://api.chess.com/pub/player/sync_tester/games/2026/08","https://api.chess.com/pub/player/sync_tester/games/2026/09"]}
;

/// One month, oldest first, with the fields a real month carries around the
/// PGN (nested objects, numbers, a field starting with @) and a Chess960
/// game in the middle.
const CHESSCOM_MONTH_SAMPLE =
    \\{"games":[
    \\{"url":"https://www.chess.com/game/live/101","pgn":"[Event \"Live Chess\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.02\"]\n[White \"sync_tester\"]\n[Black \"first_opp\"]\n[Result \"1-0\"]\n[TimeControl \"180\"]\n\n1. e4 {[%clk 0:02:59.9]} 1... e5 {[%clk 0:02:58.1]} 2. Qh5 {[%clk 0:02:57]} 2... Nc6 {[%clk 0:02:55]} 3. Bc4 {[%clk 0:02:56]} 3... Nf6 {[%clk 0:02:50]} 4. Qxf7# {[%clk 0:02:55]} 1-0\n","time_control":"180","end_time":1788300000,"rated":true,"accuracies":{"white":91.5,"black":38.25},"tcn":"mC0Kgv5Q","uuid":"a1","initial_setup":"rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1","fen":"r1bqkb1r/pppp1Qpp/2n2n2/4p3/2B1P3/8/PPPP1PPP/RNB1K1NR b KQkq - 0 4","time_class":"blitz","rules":"chess","white":{"rating":1650,"result":"win","@id":"https://api.chess.com/pub/player/sync_tester","username":"sync_tester","uuid":"w1"},"black":{"rating":1600,"result":"checkmated","@id":"https://api.chess.com/pub/player/first_opp","username":"first_opp","uuid":"b1"},"eco":"https://www.chess.com/openings/Kings-Pawn-Opening"},
    \\{"url":"https://www.chess.com/game/live/102","pgn":"[Event \"Live Chess - Chess960\"]\n[SetUp \"1\"]\n[FEN \"bbrknnqr/pppppppp/8/8/8/8/PPPPPPPP/BBRKNNQR w HChc - 0 1\"]\n[Result \"0-1\"]\n\n1. e4 e5 0-1\n","time_control":"300","end_time":1788400000,"rated":false,"rules":"chess960","white":{"rating":1500,"result":"resigned","username":"sync_tester"},"black":{"rating":1500,"result":"win","username":"x960"}},
    \\{"url":"https://www.chess.com/game/daily/103","pgn":"[Event \"Let's Play!\"]\n[Site \"Chess.com\"]\n[Date \"2026.09.20\"]\n[White \"last_opp\"]\n[Black \"sync_tester\"]\n[Result \"0-1\"]\n\n1. f3 e5 2. g4 Qh4# 0-1\n","time_control":"1/86400","end_time":1789000000,"rated":true,"rules":"chess","white":{"rating":1200,"result":"checkmated","username":"last_opp"},"black":{"rating":1210,"result":"win","username":"sync_tester"}}
    \\]}
;

/// The answer as the page reads it.
const SyncAnswerJson = struct { pgn: []const u8, count: usize };

test "a sync request is a site, a plain user name and a bounded count" {
    const a = syncRequest("{\"site\":\"lichess\",\"user\":\"sync_tester\",\"max\":20}").?;
    try std.testing.expectEqual(SyncSite.lichess, a.site);
    try std.testing.expectEqualStrings("sync_tester", a.user());
    try std.testing.expectEqual(@as(usize, 20), a.max);
    const b = syncRequest("{\"site\":\"chesscom\",\"user\":\"Hikaru\"}").?;
    try std.testing.expectEqual(SyncSite.chesscom, b.site);
    try std.testing.expectEqual(SYNC_GAMES_DEFAULT, b.max);
    // the count is clamped, never refused
    try std.testing.expectEqual(SYNC_GAMES_MAX, syncRequest("{\"site\":\"lichess\",\"user\":\"ab\",\"max\":5000}").?.max);
    try std.testing.expectEqual(@as(usize, 1), syncRequest("{\"site\":\"lichess\",\"user\":\"ab\",\"max\":0}").?.max);
    // a name is what both sites allow, and so cannot climb out of the URL path
    try std.testing.expect(syncRequest("{\"site\":\"lichess\",\"user\":\"a\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"lichess\",\"user\":\"../api\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"lichess\",\"user\":\"a b\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"lichess\",\"user\":\"x?max=1\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"lichess\",\"user\":\"abcdefghijklmnopqrstuvwxyz01234\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"lichess\"}") == null);
    try std.testing.expect(syncRequest("{\"site\":\"fics\",\"user\":\"sync_tester\"}") == null);
}

test "the sync URLs carry the name and nothing else about the person" {
    var buf: [512]u8 = undefined;
    try std.testing.expectEqualStrings(
        "https://lichess.org/api/games/user/Sync_Tester?max=20&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false",
        lichessUrl(&buf, "Sync_Tester", 20).?,
    );
    try std.testing.expectEqualStrings("https://api.chess.com/pub/player/sync_tester/games/archives", chesscomArchivesUrl(&buf, "Sync_Tester").?);
    var tiny: [16]u8 = undefined;
    try std.testing.expect(chesscomArchivesUrl(&tiny, "sync_tester") == null);
    try std.testing.expect(lichessUrl(&tiny, "sync_tester", 20) == null);
}

test "offline, rate-limited and no-such-user each have their own answer" {
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("offline", syncStatusError(0).?);
    try std.testing.expect(syncStatusError(200) == null);
    try std.testing.expectEqualStrings("not_found", syncStatusError(404).?);
    try std.testing.expectEqualStrings("not_found", syncStatusError(410).?);
    try std.testing.expectEqualStrings("rate_limited", syncStatusError(429).?);
    try std.testing.expectEqualStrings("http", syncStatusError(503).?);
    try std.testing.expectEqualStrings("{\"error\":\"offline\"}", try syncErrorAnswer(&out, "offline", 0));
    try std.testing.expectEqualStrings("{\"error\":\"rate_limited\"}", try syncErrorAnswer(&out, "rate_limited", 429));
    try std.testing.expectEqualStrings("{\"error\":\"not_found\"}", try syncErrorAnswer(&out, "not_found", 404));
    try std.testing.expectEqualStrings("{\"error\":\"http\",\"status\":503}", try syncErrorAnswer(&out, "http", 503));
}

test "Lichess: the PGN comes back as whole games, newest first, at most N" {
    // read back with an arena, the way the SDK's own feed.zig parses
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    var out: [8192]u8 = undefined;
    {
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessAnswer(LICHESS_SAMPLE, 20, &out), .{});
        try std.testing.expectEqual(@as(usize, 3), parsed.count);
        const pgn = parsed.pgn;
        try std.testing.expect(std.mem.startsWith(u8, pgn, "[Event \"Rated blitz game\"]\n"));
        try std.testing.expect(std.mem.endsWith(u8, pgn, "2... Qh4# { [%clk 0:00:59] } 0-1"));
        // games apart by a blank line, each whole, in the order they came
        const second = std.mem.indexOf(u8, pgn, "[Event \"Casual rapid game\"]").?;
        try std.testing.expect(std.mem.endsWith(u8, pgn[0..second], "Qxf7# { [%clk 0:03:00] } 1-0\n\n"));
        try std.testing.expect(second < std.mem.indexOf(u8, pgn, "[Event \"Rated bullet game\"]").?);
        // a tag's escaped quotes survive both escapings
        try std.testing.expect(std.mem.indexOf(u8, pgn, "[White \"Someone \\\"quoted\\\"\"]") != null);
    }
    {
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessAnswer(LICHESS_SAMPLE, 2, &out), .{});
        try std.testing.expectEqual(@as(usize, 2), parsed.count);
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "Rated bullet game") == null);
    }
    // a player with no games: an empty text, not an error
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer("", 20, &out));
}

test "Lichess: a game that does not fit is dropped whole, with everything older" {
    const body = "[Event \"a\"]\n\n1. e4 *\n\n\n[Event \"b\"]\n\n1. d4 *\n";
    const first = "[Event \"a\"]\n\n1. e4 *";
    var buf: [256]u8 = undefined;
    const room = SyncAnswer.HEAD.len + jsonEscapedLen(first) + SyncAnswer.TAIL_MAX;
    try std.testing.expectEqualStrings("{\"pgn\":\"[Event \\\"a\\\"]\\n\\n1. e4 *\",\"count\":1}", try lichessAnswer(body, 20, buf[0..room]));
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer(body, 20, buf[0 .. room - 1]));
}

test "Chess.com: the archive list is read, and only its own API is followed" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const months = chesscomArchives(arena, CHESSCOM_ARCHIVES_SAMPLE).?;
    try std.testing.expectEqual(@as(usize, 3), months.len);
    try std.testing.expectEqualStrings("https://api.chess.com/pub/player/sync_tester/games/2026/09", months[2]);
    try std.testing.expectEqual(@as(usize, 0), chesscomArchives(arena, "{\"archives\":[]}").?.len);
    try std.testing.expect(chesscomArchives(arena, "{\"archives\":[\"https://evil.example/pub/player/x/games/2026/09\"]}") == null);
    try std.testing.expect(chesscomArchives(arena, "{\"archives\":[\"https://api.chess.com/pub/player/x/games/2026/09?a=\\\"b\\\"\"]}") == null);
    // what a missing player's 404 carries is not a list
    try std.testing.expect(chesscomArchives(arena, "{\"code\":0,\"message\":\"User \\\"nobody\\\" not found.\"}") == null);
    try std.testing.expect(chesscomArchives(arena, "<html>") == null);
}

test "Chess.com: a month's games come back newest first, standard chess only" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    var out: [8192]u8 = undefined;
    var answer = SyncAnswer.init(&out, 20);
    try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_SAMPLE, &answer));
    try std.testing.expectEqual(@as(usize, 2), answer.count);
    const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try answer.finish(), .{});
    const pgn = parsed.pgn;
    try std.testing.expect(std.mem.startsWith(u8, pgn, "[Event \"Let's Play!\"]\n"));
    try std.testing.expect(std.mem.indexOf(u8, pgn, "Chess960") == null);
    const older = std.mem.indexOf(u8, pgn, "[Event \"Live Chess\"]").?;
    try std.testing.expect(std.mem.endsWith(u8, pgn[0..older], "2. g4 Qh4# 0-1\n\n"));
    try std.testing.expect(std.mem.endsWith(u8, pgn, "4. Qxf7# {[%clk 0:02:55]} 1-0"));
    // N stops the walk inside a month: the newest one only
    var one = SyncAnswer.init(&out, 1);
    try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_SAMPLE, &one));
    try std.testing.expectEqual(@as(usize, 1), one.count);
    try std.testing.expect(one.done());
    var other = SyncAnswer.init(&out, 20);
    try std.testing.expect(!chesscomMonth(arena, CHESSCOM_ARCHIVES_SAMPLE, &other));
}

test "a PGN's control bytes cross the bridge escaped" {
    var buf: [64]u8 = undefined;
    var n: usize = 0;
    const s = "a\"b\\c\nd\te\x01";
    jsonEscapeInto(&buf, &n, s);
    try std.testing.expectEqualStrings("a\\\"b\\\\c\\nd\\te\\u0001", buf[0..n]);
    try std.testing.expectEqual(n, jsonEscapedLen(s));
}

test "a full sync answer fits the SDK's bridge frame" {
    // the answer, inside {"id":…,"ok":true,"result":…} with its 64-byte id
    try std.testing.expect(SYNC_ANSWER_MAX + 64 + 32 <= BRIDGE_FRAME_MAX);
    // …and never past it, however big the buffer it is handed (on the heap:
    // Windows gives a test 1 MiB of stack)
    const big = try std.testing.allocator.alloc(u8, SYNC_ANSWER_MAX + 1024);
    defer std.testing.allocator.free(big);
    const a = SyncAnswer.init(big, 20);
    try std.testing.expectEqual(SYNC_ANSWER_MAX, a.out.len);
}

// ---- v8-0-plan C2: the same parsers on what the sites really sent -----------
//
// src/sync-fixtures/ (its README says where from): the answers the manual
// workflow sync-samples.yml fetched on 2026-09-29 with fetchGames's own URLs
// and User-Agent. The hand-written samples above stay — they pin cases these
// happen not to carry (escaped quotes in a tag, a game past the answer's room).

const LICHESS_REAL = @embedFile("sync-fixtures/lichess.body");
const LICHESS_MISSING_REAL = @embedFile("sync-fixtures/lichess-missing.body");
const CHESSCOM_ARCHIVES_REAL = @embedFile("sync-fixtures/chesscom-archives.body");
const CHESSCOM_MONTH_REAL = @embedFile("sync-fixtures/chesscom-month.body");
const CHESSCOM_MISSING_REAL = @embedFile("sync-fixtures/chesscom-missing.body");

/// Every one of `needles` found in `hay`, in this order.
fn inOrder(hay: []const u8, needles: []const []const u8) bool {
    var from: usize = 0;
    for (needles) |needle| {
        const at = std.mem.indexOfPos(u8, hay, from, needle) orelse return false;
        from = at + needle.len;
    }
    return true;
}

test "real Lichess answer: five whole games, newest first, as the site sent them" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    // on the heap: Windows gives a test 1 MiB of stack
    const out = try std.testing.allocator.alloc(u8, SYNC_ANSWER_MAX);
    defer std.testing.allocator.free(out);
    {
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_REAL, 20, out), .{});
        try std.testing.expectEqual(@as(usize, 5), parsed.count);
        const pgn = parsed.pgn;
        try std.testing.expectEqual(@as(usize, 5), std.mem.count(u8, pgn, "[Event "));
        // perfType kept it to standard chess
        try std.testing.expectEqual(@as(usize, 5), std.mem.count(u8, pgn, "[Variant \"Standard\"]"));
        // whole games apart by one blank line; the site's two become one
        try std.testing.expectEqual(@as(usize, 4), std.mem.count(u8, pgn, "\n\n[Event "));
        try std.testing.expectEqual(std.mem.trim(u8, LICHESS_REAL, "\n").len - 4, pgn.len);
        try std.testing.expect(std.mem.startsWith(u8, pgn, "[Event \"rated blitz game\"]\n[Site \"https://lichess.org/JNUpaHZT\"]\n"));
        try std.testing.expect(inOrder(pgn, &.{ "/JNUpaHZT\"]", "a3 { [%clk 0:01:42] } 0-1\n\n[Event ", "/uZNKbd2M\"]", "/CzvAH3q1\"]", "/drjc6AEK\"]", "/ISnAuvzx\"]" }));
        try std.testing.expect(std.mem.endsWith(u8, pgn, "h5 { [%clk 0:04:49] } 0-1"));
    }
    {
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_REAL, 2, out), .{});
        try std.testing.expectEqual(@as(usize, 2), parsed.count);
        try std.testing.expect(std.mem.endsWith(u8, parsed.pgn, "b5 { [%clk 0:05:08] } 1-0"));
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "CzvAH3q1") == null);
    }
}

test "real Lichess 404: its HTML page means no such user, not an empty list" {
    var out: [256]u8 = undefined;
    try std.testing.expect(std.mem.startsWith(u8, LICHESS_MISSING_REAL, "<!DOCTYPE html>"));
    try std.testing.expectEqualStrings("{\"error\":\"not_found\"}", try lichessReply(404, LICHESS_MISSING_REAL, 20, &out));
    // what the status going first saves the player from: the page read as PGN is "no games yet"
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer(LICHESS_MISSING_REAL, 20, &out));
}

test "real Chess.com archives: every month passes the URL checks, the last is walked first" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    var out: [64]u8 = undefined;
    const months = switch (try chesscomList(arena, 200, CHESSCOM_ARCHIVES_REAL, &out)) {
        .months => |m| m,
        .reply => return error.TestUnexpectedResult,
    };
    try std.testing.expectEqual(@as(usize, 231), months.len);
    try std.testing.expectEqualStrings("https://api.chess.com/pub/player/erik/games/2007/07", months[0]);
    const last = months[months.len - 1];
    try std.testing.expectEqualStrings("https://api.chess.com/pub/player/erik/games/2026/09", last);
    // the checks chesscomArchives holds every entry to, spelled out for the one fetched first
    try std.testing.expect(std.mem.startsWith(u8, last, "https://api.chess.com/pub/player/"));
    try std.testing.expect(last.len <= 256 and safeUrl(last));
}

test "real Chess.com 404: no such user, from the status before the body" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    var out: [64]u8 = undefined;
    switch (try chesscomList(arena, 404, CHESSCOM_MISSING_REAL, &out)) {
        .reply => |r| try std.testing.expectEqualStrings("{\"error\":\"not_found\"}", r),
        .months => return error.TestUnexpectedResult,
    }
    // the body is not a list: under a 200 it would be a parse error
    switch (try chesscomList(arena, 200, CHESSCOM_MISSING_REAL, &out)) {
        .reply => |r| try std.testing.expectEqualStrings("{\"error\":\"parse\"}", r),
        .months => return error.TestUnexpectedResult,
    }
}

test "real Chess.com month: nine standard games newest first, the four Chess960 left out" {
    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const out = try std.testing.allocator.alloc(u8, SYNC_ANSWER_MAX);
    defer std.testing.allocator.free(out);
    {
        var answer = SyncAnswer.init(out, 20);
        try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_REAL, &answer));
        try std.testing.expectEqual(@as(usize, 9), answer.count);
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try answer.finish(), .{});
        const pgn = parsed.pgn;
        try std.testing.expectEqual(@as(usize, 9), parsed.count);
        try std.testing.expectEqual(@as(usize, 9), std.mem.count(u8, pgn, "[Event "));
        try std.testing.expectEqual(@as(usize, 8), std.mem.count(u8, pgn, "\n\n[Event "));
        try std.testing.expect(std.mem.indexOf(u8, pgn, "Chess960") == null);
        try std.testing.expect(std.mem.startsWith(u8, pgn, "[Event \"Let's Play!\"]\n[Site \"Chess.com\"]\n"));
        // the month lists them oldest first (a live game among the daily ones)
        try std.testing.expect(inOrder(pgn, &.{
            "/daily/1029050366\"]", "/daily/1027848498\"]", "/live/184169696662\"]",
            "/daily/1027004758\"]", "/daily/1022858278\"]", "/daily/1022304040\"]",
            "/daily/1014147690\"]", "/daily/1014147686\"]", "/daily/1016260528\"]",
        }));
        try std.testing.expect(std.mem.endsWith(u8, pgn, "Kxa7 {[%clk 0:22:48.2]} 0-1"));
    }
    {
        // N stops inside the month: past the two newest (Chess960) to the newest standard game
        var one = SyncAnswer.init(out, 1);
        try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_REAL, &one));
        try std.testing.expectEqual(@as(usize, 1), one.count);
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try one.finish(), .{});
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "/daily/1029050366\"]") != null);
    }
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

test "production source uses frontend assets" {
    const source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" });
    try std.testing.expectEqual(native_sdk.WebViewSourceKind.assets, source.kind);
    try std.testing.expectEqualStrings("frontend/dist", source.asset_options.?.root_path);
}
