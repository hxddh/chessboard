//! The app's bridge: the chess.* command table (and the SDK commands it
//! grants: none), the sizes and JSON helpers the file commands share, and the
//! packaged self-test. Moved out of main.zig (v8-2-plan F2); 20.0 E3 kept
//! only what the 20.0 page calls (v20-0-plan §10).

const std = @import("std");
const builtin = @import("builtin");
const native_sdk = @import("native_sdk");

const automation_build = @import("runner").automation_build;
const openPgn = @import("dialogs.zig").openPgn;
const openedFile = @import("dialogs.zig").openedFile;
const App = @import("main.zig").App;
const setMenuLanguage = @import("menus.zig").setMenuLanguage;

/// The SDK's own bridge commands the page may call: none. Since SDK 0.8 these
/// are refused unless the app hands the runtime an explicit builtin-bridge
/// policy (`allowsBuiltinBridgeCommand` gives the dialog / os / clipboard
/// families no implicit permission). 19.0's host.js called seven of them; the
/// 20.0 page calls none — the file dialog and the recent-documents list are
/// chess.openPgn's, on this side — so nothing is granted.
/// scripts/manifest-check.mjs holds this list to src/app both ways.
pub const BUILTIN_COMMANDS = [_][]const u8{};

/// The exact function-pointer type the SDK's BridgeHandler carries, so the
/// table below cannot drift from it.
const InvokeFn = @FieldType(native_sdk.BridgeHandler, "invoke_fn");

const AppCommand = struct {
    name: []const u8,
    invoke_fn: InvokeFn,
};

/// The app's own bridge commands (`zero.invoke("chess.X", …)` in src/app).
///
/// One table feeds both the handler registry and the per-command origin
/// policy, so a command can never be registered without a policy (which the
/// SDK answers with permission_denied) or the other way round.
/// scripts/manifest-check.mjs (section 6) holds this list to src/app: every
/// `chess.X` the page invokes is here, and nothing is here the page never
/// invokes.
///
/// 20.0 E3 removed the thirteen only 19.0 called — the free-path text file
/// pair, the save dialog, the appdata store, the window chrome and the
/// haptic tap, the update check, the Lichess / Chess.com sync — and sync.zig
/// with them (v20-0-plan §10). An update check, if 20.0 grows one, starts
/// over from the SDK's signed feed (runner.zig `.updates`).
pub const APP_COMMANDS = [_]AppCommand{
    // the open dialog and the file behind it (dialogs.zig)
    .{ .name = "chess.openPgn", .invoke_fn = openPgn },
    // a file the OS handed over — double-clicked, dropped on the window or
    // the Dock icon, or passed by a second launch (opened.zig, dialogs.zig)
    .{ .name = "chess.openedFile", .invoke_fn = openedFile },
    // the menu bar in the page's language, now and at the next launch (menus.zig)
    .{ .name = "chess.setMenuLanguage", .invoke_fn = setMenuLanguage },
    // v20-0-plan A2 (ADR 0003): the 20.0 UI's db service on the SDK's SQLite
    // store (db.zig); {"error":"no_db"} without the capability
    .{ .name = "chess.dbExec", .invoke_fn = @import("db.zig").dbExec },
    .{ .name = "chess.dbQuery", .invoke_fn = @import("db.zig").dbQuery },
    // v20-0-plan F3 (ADR 0004): the native Stockfish process (engine.zig);
    // its output comes back as the "chess:engine" window event
    .{ .name = "chess.engineStart", .invoke_fn = @import("engine.zig").engineStart },
    .{ .name = "chess.engineSend", .invoke_fn = @import("engine.zig").engineSend },
    .{ .name = "chess.engineStop", .invoke_fn = @import("engine.zig").engineStop },
    .{ .name = "chess.selftestMode", .invoke_fn = selftestMode },
    .{ .name = "chess.selftestReport", .invoke_fn = selftestReport },
};

/// The platform path separator, as the strings this file builds need it.
pub const SEP: []const u8 = if (builtin.os.tag == .windows) "\\" else "/";

/// Q1.6 — the UI language the page last chose, read once at launch to build
/// the menu bar and title in it before the page runs (menus.zig).
pub const LANG_FILE = "lang";

pub fn jsonAppend(buf: []u8, n: *usize, s: []const u8) bool {
    if (n.* + s.len > buf.len) return false;
    @memcpy(buf[n.*..][0..s.len], s);
    n.* += s.len;
    return true;
}


// ------------------------------------------------ chunked transfer (v8-0-plan F3)
//
// The SDK caps one bridge frame at 1 MiB each way (0.10.1 and 0.11.0:
// bridge.max_message_bytes for the request, max_result_bytes for what a
// handler may answer; a test below holds BRIDGE_FRAME_MAX to them), so a
// file crosses in pieces of CHUNK_BYTES, whose base64 plus the envelope fits
// a frame with room to spare: the first answer is {name, b64, more[, token]}
// and each later piece is asked for by {token, offset} (dialogs.zig).
pub const BRIDGE_FRAME_MAX: usize = 1024 * 1024;
pub const CHUNK_BYTES: usize = 512 * 1024;
/// What chess.openPgn reads unless the page asks for more.
pub const FILE_MAX_BYTES: usize = 16 * 1024 * 1024;
/// The most a file the player picked or opened may be: the page's import
/// limit (library/import.js IMPORT_MAX), which 19.0's 「导出全部数据」 needs.
pub const USER_FILE_MAX_BYTES: usize = 64 * 1024 * 1024;

fn isJsonSpace(c: u8) bool {
    return c == ' ' or c == '\t' or c == '\n' or c == '\r';
}

/// Where the value of `"key":` starts. A quoted match that is not followed by
/// a colon — a string value that happens to spell the name — is skipped.
pub fn jsonFieldValue(payload: []const u8, key: []const u8) ?usize {
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
pub fn jsonUintField(payload: []const u8, key: []const u8) ?usize {
    const start = jsonFieldValue(payload, key) orelse return null;
    var i = start;
    while (i < payload.len and std.ascii.isDigit(payload[i])) : (i += 1) {}
    if (i == start or i - start > 12) return null;
    return std.fmt.parseInt(usize, payload[start..i], 10) catch null;
}

/// A boolean field, or null when it is absent or not one.
pub fn jsonBoolField(payload: []const u8, key: []const u8) ?bool {
    const start = jsonFieldValue(payload, key) orelse return null;
    const rest = payload[start..];
    if (std.mem.startsWith(u8, rest, "true")) return true;
    if (std.mem.startsWith(u8, rest, "false")) return false;
    return null;
}

/// 1..max characters of [A-Za-z0-9_-] — a transfer name or a store key.
pub fn tokenValid(s: []const u8, max: usize) bool {
    if (s.len == 0 or s.len > max) return false;
    for (s) |c| {
        if (!(std.ascii.isAlphanumeric(c) or c == '_' or c == '-')) return false;
    }
    return true;
}

/// A store key becomes a file name, so it is a plain token — no separator,
/// no dot, nothing to climb out of profile/ with — and not one of the device

pub fn tooLargeAnswerFor(output: []u8, limit: usize) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"tooLarge\":true,\"limit\":{d}}}", .{limit}) catch return error.HandlerFailed;
}

/// One piece of a file as the page gets it: {"b64":…,"more":…[,"bak":…]}.
/// The base64 is encoded straight into `output`, which is the SDK's result
/// buffer (BRIDGE_FRAME_MAX), so a piece costs no second copy.
pub fn chunkAnswer(output: []u8, bytes: []const u8, more: bool, bak: ?bool) anyerror![]const u8 {
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

pub const ChunkRead = struct { n: usize, more: bool };

/// Raw (still-escaped) bytes of a JSON string field, without the quotes.
pub fn jsonStringFieldRaw(payload: []const u8, key: []const u8) ?[]const u8 {
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
pub fn jsonStringField(payload: []const u8, key: []const u8, out: []u8) ?[]const u8 {
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

pub fn isSep(c: u8, windows: bool) bool {
    return c == '/' or (windows and c == '\\');
}

/// std.Io.Dir.createDirPath (0.16's makePath) with an absolute sub-path; an
/// existing directory is not an error worth reporting here — the file create
/// right after it is what fails loudly.
pub fn fsMakePath(io: std.Io, dir: []const u8) void {
    std.Io.Dir.cwd().createDirPath(io, dir) catch {};
}

pub fn appdataUnavailable(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"error\":\"no_appdata_dir\"}}", .{}) catch return error.HandlerFailed;
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

pub fn selftestOn(self: *const App) bool {
    const v = self.env_map.get("CHESS_SELFTEST") orelse return false;
    return std.mem.eql(u8, v, "1");
}

/// v8-2-plan §9 M4 评审修正: the automation driver's seam
/// (CHESS_SELFTEST_SCENARIO) opens only in a self-test launch of a
/// -Dautomation=true build. A release exe is built without it, so no
/// environment a person's machine has can keep it up after a report; its
/// plain self-test
/// (CHESS_SELFTEST=1 alone, the build workflows' selftest step) is unchanged.
pub fn seamsOpen(self: *const App) bool {
    if (comptime !automation_build) return false;
    return seamsOpenFor(true, selftestOn(self));
}

fn seamsOpenFor(automation: bool, selftest: bool) bool {
    return automation and selftest;
}

/// v8-2-plan V1 step 2: CHESS_SELFTEST_SCENARIO names a page-side scenario
/// (src/app/selftest.js) for the automation build's driver
/// (scripts/automation-app.mjs) — a plain token, or null. Only when
/// the seams are open (seamsOpen).
fn selftestScenario(self: *const App) ?[]const u8 {
    if (comptime !automation_build) return null;
    return selftestScenarioOf(self.env_map, seamsOpen(self));
}

fn selftestScenarioOf(env: *const std.process.Environ.Map, open: bool) ?[]const u8 {
    if (!open) return null;
    const v = env.get("CHESS_SELFTEST_SCENARIO") orelse return null;
    return if (tokenValid(v, 32)) v else null;
}

fn selftestMode(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    return selftestModeAnswer(output, selftestOn(self), selftestScenario(self));
}

/// {"on":…}, and the scenario's name when one is set (a token: no escaping).
fn selftestModeAnswer(output: []u8, on: bool, scenario: ?[]const u8) anyerror![]const u8 {
    if (scenario) |name| return std.fmt.bufPrint(output, "{{\"on\":true,\"scenario\":\"{s}\"}}", .{name}) catch return error.HandlerFailed;
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
    // v8-2-plan V1 step 2: a scenario reports more than once (each report
    // replaces the file), and the app stays up for the driver, which ends
    // the process itself once it has read what it needs
    if (selftestScenario(self) != null) return std.fmt.bufPrint(output, "{{\"written\":true}}", .{}) catch return error.HandlerFailed;
    std.process.exit(if (selftestOk(payload)) 0 else 1);
}
test "V1 seam: CHESS_SELFTEST_SCENARIO is read only in self-test mode" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = undefined };
    // as an automation build sees it (the switch itself: the next test)
    const open = struct {
        fn of(a: *const App) bool {
            return seamsOpenFor(true, selftestOn(a));
        }
    }.of;
    try env.put("CHESS_SELFTEST_SCENARIO", "app-menu");
    // a launch without CHESS_SELFTEST=1 — every release launch — does not see it
    try std.testing.expect(selftestScenario(&app_state) == null);
    try std.testing.expect(selftestScenarioOf(&env, open(&app_state)) == null);
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"on\":false}", try selftestModeAnswer(&out, selftestOn(&app_state), selftestScenarioOf(&env, open(&app_state))));
    try env.put("CHESS_SELFTEST", "1");
    try std.testing.expectEqualStrings("app-menu", selftestScenarioOf(&env, open(&app_state)).?);
    try std.testing.expectEqualStrings("{\"on\":true,\"scenario\":\"app-menu\"}", try selftestModeAnswer(&out, true, selftestScenarioOf(&env, open(&app_state))));
    try std.testing.expectEqualStrings("{\"on\":true}", try selftestModeAnswer(&out, true, null));
    // a scenario name is a plain token: it goes into JSON unescaped
    try env.put("CHESS_SELFTEST_SCENARIO", "a\"b");
    try std.testing.expect(selftestScenarioOf(&env, open(&app_state)) == null);
    try env.put("CHESS_SELFTEST_SCENARIO", "");
    try std.testing.expect(selftestScenarioOf(&env, open(&app_state)) == null);
}

test "V1 seam (M4 评审修正): a build without -Dautomation=true does not read it, even in self-test mode" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = undefined };
    try env.put("CHESS_SELFTEST", "1");
    try env.put("CHESS_SELFTEST_SCENARIO", "app-menu");
    // the plain packaged self-test is on in every build
    try std.testing.expect(selftestOn(&app_state));
    if (automation_build) {
        try std.testing.expectEqualStrings("app-menu", selftestScenario(&app_state).?);
    } else {
        try std.testing.expect(selftestScenario(&app_state) == null);
        var out: [64]u8 = undefined;
        try std.testing.expectEqualStrings("{\"on\":true}", try selftestModeAnswer(&out, selftestOn(&app_state), selftestScenario(&app_state)));
    }
    // and the switch itself, both ways, whatever this test binary was built with
    try std.testing.expect(selftestScenarioOf(&env, false) == null);
    try std.testing.expectEqualStrings("app-menu", selftestScenarioOf(&env, true).?);
    try std.testing.expect(!seamsOpenFor(false, true));
    try std.testing.expect(!seamsOpenFor(true, false));
    try std.testing.expect(seamsOpenFor(true, true));
}

test "the builtin bridge grants nothing: the 20.0 page calls no SDK command" {
    try std.testing.expectEqual(@as(usize, 0), BUILTIN_COMMANDS.len);
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

test "every app command has a chess. name, no two share one, and 19.0's are gone" {
    for (APP_COMMANDS, 0..) |cmd, i| {
        try std.testing.expect(std.mem.startsWith(u8, cmd.name, "chess."));
        for (APP_COMMANDS[i + 1 ..]) |other| {
            try std.testing.expect(!std.mem.eql(u8, cmd.name, other.name));
        }
    }
    try std.testing.expectEqual(@as(usize, 10), APP_COMMANDS.len);
    for ([_][]const u8{ "chess.writeTextFile", "chess.readTextFile", "chess.saveText", "chess.appdataRead", "chess.appdataWrite", "chess.appdataPath", "chess.setChrome", "chess.haptic", "chess.checkUpdate", "chess.fetchGames", "chess.fetchProgress", "chess.fetchedPart" }) |gone| {
        for (APP_COMMANDS) |cmd| try std.testing.expect(!std.mem.eql(u8, cmd.name, gone));
    }
}

test "every command reaches the SDK's registry with its origin policy" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = undefined };
    const d = app_state.bridge();
    try std.testing.expectEqual(APP_COMMANDS.len, d.registry.handlers.len);
    try std.testing.expectEqual(@as(usize, 0), d.async_registry.handlers.len);
    for (APP_COMMANDS) |cmd| {
        try std.testing.expect(d.registry.find(cmd.name) != null);
        try std.testing.expect(d.policy.find(cmd.name) != null);
    }
}

test "one piece fits the SDK's bridge frame" {
    const enc = std.base64.standard.Encoder;
    // The answer: a full piece inside {"name":…,"token":…,"b64":…,"more":…},
    // a name of up to 1 KiB escaped at its worst (U+FFFD, three bytes a byte),
    // inside the SDK's {"id":…,"ok":true,"result":…} with its 64-byte id.
    try std.testing.expect(enc.calcSize(CHUNK_BYTES) + 3 * 1024 + 64 + 64 + 32 <= BRIDGE_FRAME_MAX);
    // BRIDGE_FRAME_MAX is the SDK's number, where this SDK names it
    if (comptime @hasDecl(native_sdk.bridge, "max_message_bytes")) {
        try std.testing.expect(BRIDGE_FRAME_MAX <= native_sdk.bridge.max_message_bytes);
    }
    if (comptime @hasDecl(native_sdk.bridge, "max_result_bytes")) {
        try std.testing.expect(BRIDGE_FRAME_MAX <= native_sdk.bridge.max_result_bytes);
    }
    try std.testing.expectEqual(@as(usize, 0), FILE_MAX_BYTES % CHUNK_BYTES);
    try std.testing.expectEqual(@as(usize, 0), USER_FILE_MAX_BYTES % CHUNK_BYTES);
    var out: [64]u8 = undefined;
    try std.testing.expectEqualStrings("{\"tooLarge\":true,\"limit\":67108864}", try tooLargeAnswerFor(&out, USER_FILE_MAX_BYTES));
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
