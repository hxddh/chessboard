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
const BUILTIN_COMMANDS = [_][]const u8{
    "native-sdk.platform.supports",
    "native-sdk.dialog.openFile",
    "native-sdk.dialog.saveFile",
    "native-sdk.dialog.showMessage",
    "native-sdk.os.revealPath",
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
/// nothing is here the page never invokes.
const APP_COMMANDS = [_]AppCommand{
    .{ .name = "chess.writeTextFile", .invoke_fn = writeTextFile },
    .{ .name = "chess.readTextFile", .invoke_fn = readTextFile },
    .{ .name = "chess.issuePath", .invoke_fn = issuePath },
    .{ .name = "chess.appdataRead", .invoke_fn = appdataRead },
    .{ .name = "chess.appdataWrite", .invoke_fn = appdataWrite },
    .{ .name = "chess.appdataPath", .invoke_fn = appdataPath },
    .{ .name = "chess.setMenuLanguage", .invoke_fn = setMenuLanguage },
    .{ .name = "chess.checkUpdate", .invoke_fn = checkUpdate },
};

/// The platform path separator, as the strings this file builds need it.
const SEP: []const u8 = if (builtin.os.tag == .windows) "\\" else "/";

/// Q1.1 — the one user-data file, and the sidecars the atomic write leaves.
const APPDATA_FILE = "chessboard.json";
const APPDATA_TMP = "chessboard.json.tmp";
const APPDATA_BAK = "chessboard.json.bak";
/// Generous: the localStorage this replaces was capped at 5–10 MB in total.
const APPDATA_MAX_BYTES: usize = 8 * 1024 * 1024;
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

// Buffer sizes for the two file handlers, at file scope so the tests below can
// check the arithmetic between them. They used to be literals inside the
// functions, which is fine until one of them moves: base64 grows a payload by
// 4/3, so raising the read limit without raising the encode buffer turns every
// large file into error.InvalidRequest, and raising the write cap without
// raising the decode buffer does the same to every large save.
const READ_MAX_BYTES: usize = 256 * 1024;
const READ_B64_BUF: usize = 360 * 1024;
const WRITE_B64_MAX: usize = 512 * 1024;
const WRITE_DECODED_BUF: usize = 384 * 1024;

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
    const path = jsonStringField(invocation.request.payload, "path", &path_buf) orelse return error.InvalidRequest;
    // base64 needs no unescaping — its alphabet has nothing JSON would escape
    const b64 = jsonStringFieldRaw(invocation.request.payload, "b64") orelse return error.InvalidRequest;
    if (path.len == 0) return error.InvalidRequest;
    if (b64.len == 0 or b64.len > WRITE_B64_MAX) return error.InvalidRequest;
    // Q1.2: only a path the native side issued this process (see IssuedPaths)
    if (!self.issued.contains(path)) return unissuedPath(output);

    var decoded_buf: [WRITE_DECODED_BUF]u8 = undefined;
    const dec = std.base64.standard.Decoder;
    const dec_len = dec.calcSizeForSlice(b64) catch return error.InvalidRequest;
    if (dec_len > decoded_buf.len) return error.InvalidRequest;
    dec.decode(decoded_buf[0..dec_len], b64) catch return error.InvalidRequest;

    var file = std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true }) catch return error.HandlerFailed;
    defer file.close(self.io);
    file.writeStreamingAll(self.io, decoded_buf[0..dec_len]) catch return error.HandlerFailed;

    return std.fmt.bufPrint(output, "true", .{}) catch "true";
}

fn readTextFile(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var path_buf: [4096]u8 = undefined;
    const path = jsonStringField(invocation.request.payload, "path", &path_buf) orelse return error.InvalidRequest;
    if (path.len == 0) return error.InvalidRequest;
    // Q1.2: only a path the native side issued this process (see IssuedPaths)
    if (!self.issued.contains(path)) return unissuedPath(output);

    var file = std.Io.Dir.openFileAbsolute(self.io, path, .{}) catch return error.HandlerFailed;
    defer file.close(self.io);

    // One byte past the limit, on purpose. readPositionalAll stops when the
    // buffer is full and reports only how much it read, so with a buffer of
    // exactly MAX_BYTES a file that overflows it is indistinguishable from one
    // that fills it — and the handler returned the first 256 KiB as if it were
    // the whole file. For the multi-game PGN libraries this app advertises
    // that meant losing every game past the cut and handing back a syntax
    // error for the one straddling it, reported to the player as an ordinary
    // failed import. The spare byte turns "too big" into something the caller
    // can be told about.
    var raw_buf: [READ_MAX_BYTES + 1]u8 = undefined;
    const n = file.readPositionalAll(self.io, &raw_buf, 0) catch return error.HandlerFailed;
    if (n == 0) return error.InvalidRequest;
    if (n > READ_MAX_BYTES) {
        return std.fmt.bufPrint(output, "{{\"tooLarge\":true,\"limit\":{d}}}", .{READ_MAX_BYTES}) catch
            return error.HandlerFailed;
    }

    var b64_buf: [READ_B64_BUF]u8 = undefined;
    const enc = std.base64.standard.Encoder;
    const enc_len = enc.calcSize(n);
    if (enc_len > b64_buf.len) return error.InvalidRequest;
    const encoded = enc.encode(b64_buf[0..enc_len], raw_buf[0..n]);

    // JSON object, not a bare string: the result has to be able to say whether
    // it is the whole file. base64 never contains a character JSON escapes, so
    // it can be quoted as-is.
    return std.fmt.bufPrint(output, "{{\"b64\":\"{s}\"}}", .{encoded}) catch return error.HandlerFailed;
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

fn appdataTooLarge(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"tooLarge\":true,\"limit\":{d}}}", .{APPDATA_MAX_BYTES}) catch return error.HandlerFailed;
}

fn appdataPath(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    var path_buf: [1200]u8 = undefined;
    const path = self.appdataChild(&path_buf, APPDATA_FILE) orelse return appdataUnavailable(output);
    var n: usize = 0;
    if (!jsonAppend(output, &n, "{\"path\":")) return error.HandlerFailed;
    if (!jsonAppendString(output, &n, path)) return error.HandlerFailed;
    if (!jsonAppend(output, &n, "}")) return error.HandlerFailed;
    return output[0..n];
}

/// Read one appdata file into `raw`. null means "nothing usable here":
/// either no such file, or a zero-length one. A zero-length file is not a
/// fresh install — an interrupted write leaves one — so it must not be
/// reported as a missing file, and the caller falls through to the .bak.
fn appdataSlurp(io: std.Io, path: []const u8, raw: []u8) !?usize {
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch |err| switch (err) {
        error.FileNotFound => return null,
        else => return error.HandlerFailed,
    };
    defer file.close(io);
    const n = file.readPositionalAll(io, raw, 0) catch return error.HandlerFailed;
    if (n == 0) return null;
    return n;
}

fn appdataRead(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    var path_buf: [1200]u8 = undefined;
    var bak_buf: [1200]u8 = undefined;
    const path = self.appdataChild(&path_buf, APPDATA_FILE) orelse return appdataUnavailable(output);
    const bak_path = self.appdataChild(&bak_buf, APPDATA_BAK) orelse return appdataUnavailable(output);

    // Heap, not stack: 8 MiB plus its base64 is more than a handler thread
    // should carry. Same spare byte as readTextFile, same reason.
    const gpa = std.heap.page_allocator;
    const raw = gpa.alloc(u8, APPDATA_MAX_BYTES + 1) catch return error.HandlerFailed;
    defer gpa.free(raw);

    // 6.1: the .bak stopped being write-only. The main file wins whenever it
    // holds bytes; only when it holds none does the previous copy answer.
    var from_bak = false;
    const main_n = try appdataSlurp(self.io, path, raw);
    const n = main_n orelse blk: {
        const bak_n = try appdataSlurp(self.io, bak_path, raw);
        if (bak_n) |bn| {
            from_bak = true;
            break :blk bn;
        }
        // Nothing in either place. Tell the two cases apart: a main file that
        // exists but is empty is damage, not a fresh install.
        const exists = if (std.Io.Dir.openFileAbsolute(self.io, path, .{})) |f| blk2: {
            var fh = f;
            fh.close(self.io);
            break :blk2 true;
        } else |_| false;
        if (exists) return std.fmt.bufPrint(output, "{{\"empty\":true}}", .{}) catch return error.HandlerFailed;
        return std.fmt.bufPrint(output, "{{\"missing\":true}}", .{}) catch return error.HandlerFailed;
    };
    if (n > APPDATA_MAX_BYTES) return appdataTooLarge(output);

    const enc = std.base64.standard.Encoder;
    const enc_len = enc.calcSize(n);
    // The bridge's answer buffer is the SDK's; a file that does not fit it is
    // reported the same way as one over our own limit, so the page never gets
    // a truncated archive.
    if (enc_len + 32 > output.len) return appdataTooLarge(output);
    const b64 = gpa.alloc(u8, enc_len) catch return error.HandlerFailed;
    defer gpa.free(b64);
    const encoded = enc.encode(b64, raw[0..n]);
    return std.fmt.bufPrint(output, "{{\"b64\":\"{s}\",\"bak\":{s}}}", .{ encoded, if (from_bak) "true" else "false" }) catch return error.HandlerFailed;
}

fn appdataWrite(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    if (self.appdata_dir.len == 0) return appdataUnavailable(output);
    // base64 needs no unescaping — its alphabet has nothing JSON would escape
    const b64 = jsonStringFieldRaw(invocation.request.payload, "b64") orelse return error.InvalidRequest;
    if (b64.len == 0) return error.InvalidRequest;

    const dec = std.base64.standard.Decoder;
    const dec_len = dec.calcSizeForSlice(b64) catch return error.InvalidRequest;
    if (dec_len > APPDATA_MAX_BYTES) return appdataTooLarge(output);
    const gpa = std.heap.page_allocator;
    const decoded = gpa.alloc(u8, dec_len) catch return error.HandlerFailed;
    defer gpa.free(decoded);
    dec.decode(decoded, b64) catch return error.InvalidRequest;

    var main_buf: [1200]u8 = undefined;
    var tmp_buf: [1200]u8 = undefined;
    var bak_buf: [1200]u8 = undefined;
    const main_path = self.appdataChild(&main_buf, APPDATA_FILE) orelse return appdataUnavailable(output);
    // 6.1: a tmp name unique to this write. One fixed name meant two windows
    // (or one window whose next flush started before the last finished) both
    // created the same file with .truncate and interleaved their bytes, and
    // both then renamed that mixture into place.
    const seq = self.appdata_seq;
    self.appdata_seq +%= 1;
    var tmp_name_buf: [96]u8 = undefined;
    // The App's own address plus the per-write counter. Not a clock: 0.16's
    // std.time has no milliTimestamp, and reaching for a platform-specific
    // pid would put an #if in the one place this file keeps portable. Two
    // processes need the same heap address AND the same counter value at the
    // same moment to collide, which is the pre-6.1 behaviour, not worse.
    const tmp_name = std.fmt.bufPrint(&tmp_name_buf, "{s}.{x}.{d}", .{ APPDATA_TMP, @intFromPtr(self), seq }) catch return error.HandlerFailed;
    const tmp_path = self.appdataChild(&tmp_buf, tmp_name) orelse return appdataUnavailable(output);
    const bak_path = self.appdataChild(&bak_buf, APPDATA_BAK) orelse return appdataUnavailable(output);

    fsMakePath(self.io, self.appdata_dir);
    {
        var file = std.Io.Dir.createFileAbsolute(self.io, tmp_path, .{ .truncate = true }) catch return error.HandlerFailed;
        defer file.close(self.io);
        file.writeStreamingAll(self.io, decoded) catch return error.HandlerFailed;
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
    // tmp → chessboard.json: the one step that makes the new data visible
    fsRename(self.io, tmp_path, main_path) catch return error.HandlerFailed;

    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{}) catch return error.HandlerFailed;
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
    }, init);
}

test "the builtin bridge grants exactly the SDK commands the page calls" {
    // the list is what host.js reaches for; a name with a typo is a feature
    // that silently falls back to the browser path, which is the 5.0–5.2 bug
    for (BUILTIN_COMMANDS) |name| {
        try std.testing.expect(std.mem.startsWith(u8, name, "native-sdk."));
        try std.testing.expect(std.mem.indexOfScalar(u8, name[11..], '.') != null);
    }
    try std.testing.expectEqual(@as(usize, 10), BUILTIN_COMMANDS.len);
}

test "every app command has a chess. name and no two share one" {
    for (APP_COMMANDS, 0..) |cmd, i| {
        try std.testing.expect(std.mem.startsWith(u8, cmd.name, "chess."));
        for (APP_COMMANDS[i + 1 ..]) |other| {
            try std.testing.expect(!std.mem.eql(u8, cmd.name, other.name));
        }
    }
    try std.testing.expectEqual(@as(usize, 8), APP_COMMANDS.len);
}

test "the file handlers' buffers fit the limits they advertise" {
    const enc = std.base64.standard.Encoder;
    const dec = std.base64.standard.Decoder;

    // Read path: a file at exactly the limit must still encode. base64 grows a
    // payload by 4/3, so this is the pair that breaks first if the limit moves
    // — and it breaks by turning every large file into InvalidRequest, which
    // reads to the player as "this file is broken" rather than "too big".
    try std.testing.expect(enc.calcSize(READ_MAX_BYTES) <= READ_B64_BUF);
    // the spare byte that makes truncation observable at all
    try std.testing.expect(READ_MAX_BYTES + 1 > READ_MAX_BYTES);

    // Write path: the largest base64 the handler accepts must decode into the
    // buffer it decodes into.
    const max_decoded = try dec.calcSizeUpperBound(WRITE_B64_MAX);
    try std.testing.expect(max_decoded <= WRITE_DECODED_BUF);
}

test "an oversized read answers with a refusal, not a truncated file" {
    // The handler cannot be called without an SDK Invocation and an Io, but the
    // answer it writes is plain formatting and is exactly what host.js keys on.
    var out: [64]u8 = undefined;
    const refusal = try std.fmt.bufPrint(&out, "{{\"tooLarge\":true,\"limit\":{d}}}", .{READ_MAX_BYTES});
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":262144}", refusal);
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

test "production source uses frontend assets" {
    const source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" });
    try std.testing.expectEqual(native_sdk.WebViewSourceKind.assets, source.kind);
    try std.testing.expectEqualStrings("frontend/dist", source.asset_options.?.root_path);
}
