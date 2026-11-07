//! chess.openPgn / chess.saveText: the native file dialogs and the file
//! behind them (v8-1-plan N2). Moved verbatim out of main.zig (v8-2-plan F2).

const std = @import("std");
const builtin = @import("builtin");
const native_sdk = @import("native_sdk");

const APP_COMMANDS = @import("bridge.zig").APP_COMMANDS;
const BRIDGE_FRAME_MAX = @import("bridge.zig").BRIDGE_FRAME_MAX;
const BUILTIN_COMMANDS = @import("bridge.zig").BUILTIN_COMMANDS;
const CHUNK_BYTES = @import("bridge.zig").CHUNK_BYTES;
const ChunkRead = @import("bridge.zig").ChunkRead;
const FILE_MAX_BYTES = @import("bridge.zig").FILE_MAX_BYTES;
const Incoming = @import("bridge.zig").Incoming;
const SEP = @import("bridge.zig").SEP;
const STAGE_SLOTS = @import("bridge.zig").STAGE_SLOTS;
const Stages = @import("bridge.zig").Stages;
const USER_FILE_MAX_BYTES = @import("bridge.zig").USER_FILE_MAX_BYTES;
const chunkAnswer = @import("bridge.zig").chunkAnswer;
const isSep = @import("bridge.zig").isSep;
const jsonAppend = @import("bridge.zig").jsonAppend;
const jsonBoolField = @import("bridge.zig").jsonBoolField;
const jsonStringField = @import("bridge.zig").jsonStringField;
const jsonStringFieldRaw = @import("bridge.zig").jsonStringFieldRaw;
const jsonUintField = @import("bridge.zig").jsonUintField;
const pendingAnswer = @import("bridge.zig").pendingAnswer;
const receive = @import("bridge.zig").receive;
const stageLimit = @import("bridge.zig").stageLimit;
const takeReceived = @import("bridge.zig").takeReceived;
const tooLargeAnswerFor = @import("bridge.zig").tooLargeAnswerFor;
const App = @import("main.zig").App;

// ------------------------------------------- native file dialogs (v8-1-plan N2)
//
// Before this, the page opened the SDK's builtin dialogs (zero.dialogs.openFile /
// saveFile), got the path back, and asked chess.issuePath (removed since) to
// trust it before reading or writing: the dialog's answer reached this side
// only through the page. SDK 0.10.1 lets the native side open them itself —
// PlatformServices.showOpenDialog / showSaveDialog (platform/types.zig), which
// Runtime.showOpenDialog / showSaveDialog validate and forward
// (runtime/system_services.zig) — so these two commands do the whole thing
// here and the path never leaves this file:
//
//   * chess.openPgn {title, max?, recent?} — the open dialog, then the file,
//     read the way chess.readTextFile reads it (pieces of CHUNK_BYTES, refused
//     whole past its limit), except that a later piece comes only from the
//     file the first one saw — same size, same modification time — or
//     answers open_lost. Answers {cancelled:true}, or {name, b64, more
//     [, token]}: `name` is the file's name for the screen, and a file past
//     one piece is continued by {token, offset}. The limit is FILE_MAX_BYTES
//     unless `max` asks for more (导入全部数据), and never past
//     USER_FILE_MAX_BYTES. `recent` puts the file on the OS's recent-documents
//     list once it was read.
//   * chess.saveText {title, name, recent?, b64…} — the bytes first, in the
//     pieces writeTextFile takes (staged, up to USER_FILE_MAX_BYTES), and only
//     when the last one is in, the save dialog with `name` suggested and its
//     extension as the filter (and added to a name typed without one); then
//     the write, the folder shown with the file in it, and {ok, name,
//     revealed[, path]}. The path comes back only when
//     the folder could not be shown, so the toast can say where the file went;
//     no command takes a path from the page to issue.
//
// Both answer {probe:true, dialogs} to {probe:true} without opening anything —
// the packaged self-test's `nativeIo` check (v8-1-plan N3). {error:"no_dialog"}
// means this platform has none, and the page takes the browser's picker.

/// What a staged chess.saveText is filed under while it has no path yet. Not
/// "appdata:", so stageLimit gives it USER_FILE_MAX_BYTES (导出全部数据).
const SAVE_TARGET = "dialog:save";

/// What a file looked like when chess.openPgn read its first piece. A later
/// piece is read only from the same file, unchanged: one saved over in
/// between (another size, or another modification time) would otherwise be
/// stitched onto the first piece of the old one — a PGN library cut mid-game
/// and joined to a stranger (v8-1-plan N2, review P3-4).
const FileStamp = struct {
    size: u64 = 0,
    mtime_ns: i96 = 0,

    fn eql(a: FileStamp, b: FileStamp) bool {
        return a.size == b.size and a.mtime_ns == b.mtime_ns;
    }
};

/// The file chess.openPgn picked, for the pieces after the first. One at a
/// time: a second open replaces it, and the first then answers open_lost.
pub const Opened = struct {
    path_buf: [native_sdk.platform.max_dialog_path_bytes]u8 = undefined,
    path_len: usize = 0,
    limit: usize = 0,
    /// the file as the first piece found it (readOpenedChunk)
    stamp: FileStamp = .{},
    token: u32 = 0,
    seq: u32 = 0,

    /// Remember `path`; the token its later pieces ask by, or null when the
    /// path does not fit.
    fn remember(self: *Opened, path: []const u8, limit: usize, stamp: FileStamp) ?u32 {
        if (path.len == 0 or path.len > self.path_buf.len) return null;
        self.seq +%= 1;
        if (self.seq == 0) self.seq = 1;
        @memcpy(self.path_buf[0..path.len], path);
        self.path_len = path.len;
        self.limit = limit;
        self.stamp = stamp;
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

/// `picked` with the suggested name's extension added, when the player typed
/// a name that has none; null when there is nothing to add (or no room).
///
/// The Windows save dialog is given the extension as a filter but sets no
/// default extension (SDK 0.10.1 windows host), so a player who types "game"
/// gets a file called "game" that no PGN reader offers to open. macOS adds
/// it already, and then this finds one and adds nothing. A name with any
/// extension of its own ("game.v2") is taken as the player meant it.
fn withSaveExt(picked: []const u8, suggested: []const u8, windows: bool, buf: []u8) ?[]const u8 {
    const ext = saveExt(suggested) orelse return null;
    const base = baseName(picked, windows);
    if (base.len == 0 or saveExt(base) != null) return null;
    if (picked.len + 1 + ext.len > buf.len) return null;
    @memcpy(buf[0..picked.len], picked);
    buf[picked.len] = '.';
    @memcpy(buf[picked.len + 1 ..][0..ext.len], ext);
    return buf[0 .. picked.len + 1 + ext.len];
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
///
/// It checks that the platform wired both services, not that one would open:
/// a service can still answer UnsupportedService when called. In SDK 0.10.1
/// the one such case is the Windows host on a web engine other than the
/// system one (WebView2), and build.zig refuses to make that build
/// (-Dweb-engine=chromium is macOS only; app.zon says "system"), so for every
/// build that ships the two answers agree. If that ever changes, a real call
/// still degrades cleanly: dialogErrorCode turns it into no_dialog and the
/// page takes the browser's picker.
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

/// How much of a read that got `n` bytes at `offset` to hand over, from a
/// file of `size` bytes: never past `size`, and error.Changed when the read
/// came up short of it (the file shrank under us).
fn openedPiece(size: u64, offset: usize, n: usize) error{Changed}!ChunkRead {
    if (offset > size) return error.Changed;
    const want: usize = @intCast(@min(size - offset, CHUNK_BYTES));
    if (n < want) return error.Changed;
    return .{ .n = want, .more = offset + want < size };
}

const OpenedRead = struct { n: usize, more: bool, stamp: FileStamp };

/// One piece of the file chess.openPgn picked, into `buf` (CHUNK_BYTES + 1).
///
/// The first piece (`expect` null) refuses a file over `limit` and returns
/// what the file looked like; null means there is no such file. A later
/// piece (`expect` that stamp) is error.Changed unless the file is still the
/// same size with the same modification time, and never reaches past that
/// size — so past `limit` neither. readChunk's spare-byte probe is not
/// needed here: the stat that makes the stamp says how big the file is.
fn readOpenedChunk(io: std.Io, path: []const u8, offset: usize, buf: []u8, limit: usize, expect: ?FileStamp) error{ FileTooLarge, Changed, HandlerFailed }!?OpenedRead {
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch |err| switch (err) {
        error.FileNotFound => return if (expect == null) null else error.Changed,
        else => return error.HandlerFailed,
    };
    defer file.close(io);
    const st = file.stat(io) catch return error.HandlerFailed;
    if (st.kind != .file) return error.HandlerFailed;
    const stamp: FileStamp = .{ .size = st.size, .mtime_ns = st.mtime.nanoseconds };
    if (expect) |before| {
        if (!before.eql(stamp)) return error.Changed;
    } else if (stamp.size > limit) return error.FileTooLarge;
    const n = file.readPositionalAll(io, buf[0 .. CHUNK_BYTES + 1], offset) catch return error.HandlerFailed;
    const piece = try openedPiece(stamp.size, offset, n);
    return .{ .n = piece.n, .more = piece.more, .stamp = stamp };
}

/// The same two std.Io calls writeTextFile makes. `exclusive`: only a new
/// file (error.PathAlreadyExists when there is one).
fn writeWhole(io: std.Io, path: []const u8, bytes: []const u8, exclusive: bool) !void {
    var file = try std.Io.Dir.createFileAbsolute(io, path, .{ .truncate = true, .exclusive = exclusive });
    defer file.close(io);
    try file.writeStreamingAll(io, bytes);
}

pub fn openPgn(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
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
        // the file the first piece came from, as it was then — or open_lost
        const got = (readOpenedChunk(self.io, path, offset, buf, self.opened.limit, self.opened.stamp) catch |err| switch (err) {
            error.Changed => {
                self.opened.forget();
                return fileErrorAnswer(output, "open_lost");
            },
            error.FileTooLarge => return tooLargeAnswerFor(output, self.opened.limit),
            error.HandlerFailed => return fileErrorAnswer(output, "read_failed"),
        }) orelse return fileErrorAnswer(output, "open_lost");
        if (!got.more) self.opened.forget();
        return chunkAnswer(output, buf[0..got.n], got.more, null);
    }

    const runtime = self.runtime orelse return fileErrorAnswer(output, "no_dialog");
    var title_buf: [512]u8 = undefined;
    const title = jsonStringField(payload, "title", &title_buf) orelse "";
    const limit = openLimit(jsonUintField(payload, "max"));
    // read before the dialog: its modal loop may run the bridge, and the
    // payload is the SDK's buffer, not ours
    const recent = jsonBoolField(payload, "recent") orelse false;
    const paths_buf = gpa.alloc(u8, native_sdk.platform.max_dialog_paths_bytes) catch return error.HandlerFailed;
    defer gpa.free(paths_buf);
    const picked = runtime.showOpenDialog(.{ .title = title }, paths_buf) catch |err| return fileErrorAnswer(output, dialogErrorCode(err));
    const path = dialogPick(picked.count, picked.paths) orelse return cancelledAnswer(output);

    // too big is refused whole, as readTextFile refuses it
    const got = (readOpenedChunk(self.io, path, 0, buf, limit, null) catch |err| switch (err) {
        error.FileTooLarge => return tooLargeAnswerFor(output, limit),
        error.Changed, error.HandlerFailed => return fileErrorAnswer(output, "read_failed"),
    }) orelse return fileErrorAnswer(output, "read_failed");
    var token: ?u32 = null;
    if (got.more) token = self.opened.remember(path, limit, got.stamp) orelse return fileErrorAnswer(output, "read_failed");
    // the recent-documents list (Dock, jump list) is filled from here now:
    // the page never holds the path to hand to native-sdk.os.addRecentDocument
    if (recent) runtime.addRecentDocument(path) catch {};
    return openAnswer(output, baseName(path, builtin.os.tag == .windows), token, buf[0..got.n], got.more);
}

pub fn saveText(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
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
    // Ours before the dialog (review P3-3). The dialog is modal, and a modal
    // loop may run the bridge: a write arriving meanwhile that needs a stage
    // slot evicts the oldest (Stages.freeSlot) and frees its bytes — these,
    // if they were still in their slot. Taken out, the slot is idle and the
    // bytes are this call's alone.
    const bytes = takeReceived(self, incoming);
    defer std.heap.page_allocator.free(bytes);

    const runtime = self.runtime orelse return fileErrorAnswer(output, "no_dialog");
    var title_buf: [512]u8 = undefined;
    const title = jsonStringField(payload, "title", &title_buf) orelse "";
    var name_buf: [1024]u8 = undefined;
    const name = jsonStringField(payload, "name", &name_buf) orelse "";
    // read before the dialog, for the same reason: the payload is the SDK's
    const recent = jsonBoolField(payload, "recent") orelse false;
    const exts = [_][]const u8{saveExt(name) orelse ""};
    const one_filter = [_]native_sdk.FileFilter{.{ .name = exts[0], .extensions = exts[0..] }};
    const filters: []const native_sdk.FileFilter = if (exts[0].len > 0) one_filter[0..] else &.{};
    var path_buf: [native_sdk.platform.max_dialog_path_bytes]u8 = undefined;
    const picked = runtime.showSaveDialog(.{
        .title = title,
        .default_name = name,
        .filters = filters,
    }, &path_buf) catch |err| return fileErrorAnswer(output, dialogErrorCode(err));
    const chosen = picked orelse return cancelledAnswer(output);
    if (chosen.len == 0) return cancelledAnswer(output);
    // a platform's dialog answers with an absolute path; one that does not
    // (the null platform hands back the suggested name as it is) is refused
    // here rather than written relative to wherever the process runs
    if (!std.fs.path.isAbsolute(chosen)) return fileErrorAnswer(output, "dialog_failed");

    // review P3-5: "game" typed into the Windows dialog becomes game.pgn —
    // but only as a new file: the dialog asked about replacing "game", not
    // "game.pgn", so an existing game.pgn is left alone and the name is
    // written as the player typed it
    const windows = builtin.os.tag == .windows;
    var ext_buf: [native_sdk.platform.max_dialog_path_bytes + 16]u8 = undefined;
    var path = chosen;
    if (withSaveExt(chosen, name, windows, &ext_buf)) |extended| {
        if (writeWhole(self.io, extended, bytes, true)) |_| {
            path = extended;
        } else |err| {
            if (err != error.PathAlreadyExists) return fileErrorAnswer(output, "write_failed");
            writeWhole(self.io, chosen, bytes, false) catch return fileErrorAnswer(output, "write_failed");
        }
    } else {
        writeWhole(self.io, chosen, bytes, false) catch return fileErrorAnswer(output, "write_failed");
    }
    if (recent) runtime.addRecentDocument(path) catch {};
    // the folder, with the file in it: "where did it go" answered on screen
    const revealed = if (runtime.revealPath(path)) |_| true else |_| false;
    return savedAnswer(output, baseName(path, windows), revealed, if (revealed) null else path);
}

test "the file dialogs are the native side's: the page is granted neither, nor the reveal" {
    // v8-1-plan N2 — chess.openPgn / chess.saveText open them in dialogs.zig
    for (BUILTIN_COMMANDS) |name| {
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.dialog.openFile"));
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.dialog.saveFile"));
        try std.testing.expect(!std.mem.eql(u8, name, "native-sdk.os.revealPath"));
    }
    // and no command is left that asks for a page-named path to be trusted:
    // chess.issuePath is gone, not kept for older pages (there are none — the
    // page is the one bundled into this binary)
    for (APP_COMMANDS) |cmd| {
        try std.testing.expect(!std.mem.eql(u8, cmd.name, "chess.issuePath"));
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
    const t1 = opened.remember("/Users/me/big.pgn", FILE_MAX_BYTES, .{ .size = 3 * CHUNK_BYTES, .mtime_ns = 1 }).?;
    try std.testing.expectEqualStrings("/Users/me/big.pgn", opened.pathOf(t1).?);
    try std.testing.expectEqual(FILE_MAX_BYTES, opened.limit);
    try std.testing.expectEqual(@as(u64, 3 * CHUNK_BYTES), opened.stamp.size);
    try std.testing.expect(opened.pathOf(t1 + 1) == null);
    // a second open replaces the first, whose token then goes nowhere
    const t2 = opened.remember("/Users/me/all.json", USER_FILE_MAX_BYTES, .{}).?;
    try std.testing.expect(t2 != t1);
    try std.testing.expect(opened.pathOf(t1) == null);
    opened.forget();
    try std.testing.expect(opened.pathOf(t2) == null);
    try std.testing.expect(opened.remember("", FILE_MAX_BYTES, .{}) == null);
}

test "a later piece never reaches past the size the first piece saw, and a short read is a changed file" {
    // review P3-4
    const c = CHUNK_BYTES;
    try std.testing.expectEqual(ChunkRead{ .n = c, .more = true }, try openedPiece(c + 10, 0, c + 1));
    try std.testing.expectEqual(ChunkRead{ .n = 10, .more = false }, try openedPiece(c + 10, c, 10));
    // grew since the stat, between two reads: the extra bytes stay behind
    try std.testing.expectEqual(ChunkRead{ .n = 10, .more = false }, try openedPiece(c + 10, c, c + 1));
    try std.testing.expectEqual(ChunkRead{ .n = 0, .more = false }, try openedPiece(0, 0, 0));
    // shrank: the read came up short of the size, or the offset is past it
    try std.testing.expectError(error.Changed, openedPiece(c + 10, c, 4));
    try std.testing.expectError(error.Changed, openedPiece(c + 10, 0, 7));
    try std.testing.expectError(error.Changed, openedPiece(10, c, 0));
    const a: FileStamp = .{ .size = 5, .mtime_ns = 100 };
    try std.testing.expect(a.eql(.{ .size = 5, .mtime_ns = 100 }));
    try std.testing.expect(!a.eql(.{ .size = 6, .mtime_ns = 100 }));
    try std.testing.expect(!a.eql(.{ .size = 5, .mtime_ns = 101 }));
}

test "an opened file saved over between its pieces answers open_lost, not a spliced file" {
    // review P3-4, on a real file: readOpenedChunk is what openPgn calls
    const io = std.testing.io;
    const gpa = std.testing.allocator;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    const body = try gpa.alloc(u8, CHUNK_BYTES + 10);
    defer gpa.free(body);
    @memset(body, 'a');
    try tmp.dir.writeFile(io, .{ .sub_path = "big.pgn", .data = body });
    var path_buf: [4096]u8 = undefined;
    const path = path_buf[0..try tmp.dir.realPathFile(io, "big.pgn", &path_buf)];
    const buf = try gpa.alloc(u8, CHUNK_BYTES + 1);
    defer gpa.free(buf);

    // too big for the limit: refused whole, as before
    try std.testing.expectError(error.FileTooLarge, readOpenedChunk(io, path, 0, buf, CHUNK_BYTES, null));
    try std.testing.expect((try readOpenedChunk(io, "/no/such/dir/x.pgn", 0, buf, FILE_MAX_BYTES, null)) == null);

    const first = (try readOpenedChunk(io, path, 0, buf, FILE_MAX_BYTES, null)).?;
    try std.testing.expectEqual(CHUNK_BYTES, first.n);
    try std.testing.expect(first.more);
    try std.testing.expectEqual(@as(u64, CHUNK_BYTES + 10), first.stamp.size);
    // unchanged: the rest, exactly
    const rest = (try readOpenedChunk(io, path, CHUNK_BYTES, buf, FILE_MAX_BYTES, first.stamp)).?;
    try std.testing.expectEqual(@as(usize, 10), rest.n);
    try std.testing.expect(!rest.more);

    // saved over, longer: the second piece is refused, not joined to the first
    body[0] = 'b';
    const longer = try gpa.alloc(u8, CHUNK_BYTES + 20);
    defer gpa.free(longer);
    @memset(longer, 'c');
    try tmp.dir.writeFile(io, .{ .sub_path = "big.pgn", .data = longer });
    try std.testing.expectError(error.Changed, readOpenedChunk(io, path, CHUNK_BYTES, buf, FILE_MAX_BYTES, first.stamp));
    // the same size again, but written since: the modification time says so
    try tmp.dir.writeFile(io, .{ .sub_path = "big.pgn", .data = body });
    {
        var f = try tmp.dir.openFile(io, "big.pgn", .{ .mode = .read_write });
        defer f.close(io);
        try f.setTimestamps(io, .{ .modify_timestamp = .{ .new = .{ .nanoseconds = first.stamp.mtime_ns + std.time.ns_per_s } } });
    }
    try std.testing.expectError(error.Changed, readOpenedChunk(io, path, CHUNK_BYTES, buf, FILE_MAX_BYTES, first.stamp));
    // gone: the same answer
    try tmp.dir.deleteFile(io, "big.pgn");
    try std.testing.expectError(error.Changed, readOpenedChunk(io, path, CHUNK_BYTES, buf, FILE_MAX_BYTES, first.stamp));
}

test "a save's bytes leave their stage slot before the dialog, so an eviction cannot free them" {
    // review P3-3: while the modal save dialog is up, other writes can fill
    // every slot; the oldest (this one) used to be freed under the save
    const gpa = std.testing.allocator;
    var stages: Stages = .{};
    defer stages.releaseAll(gpa);
    const got = try stages.claim(gpa, "save1", SAVE_TARGET, 5, 0, 5);
    @memcpy(got.dest, "1. e4");
    got.stage.filled += 5;
    try std.testing.expect(got.stage.complete());
    const bytes = stages.detach(got.stage);
    defer gpa.free(bytes);
    // the slot is idle again, and nothing of the save is left in the table
    for (&stages.slots) |*slot| try std.testing.expect(!slot.busy());
    // every slot taken and then some — each eviction frees only its own
    var name_buf: [16]u8 = undefined;
    var i: usize = 0;
    while (i < STAGE_SLOTS + 2) : (i += 1) {
        const name = try std.fmt.bufPrint(&name_buf, "w{d}", .{i});
        _ = try stages.claim(gpa, name, "appdata:x", 8, 0, 4);
    }
    try std.testing.expectEqualStrings("1. e4", bytes);
}

test "a name typed without an extension is saved with the suggested one" {
    // review P3-5: the Windows dialog sets no default extension
    var buf: [64]u8 = undefined;
    try std.testing.expectEqualStrings("C:\\Users\\me\\game.pgn", withSaveExt("C:\\Users\\me\\game", "chess-20260929.pgn", true, &buf).?);
    try std.testing.expectEqualStrings("/Users/me/all.json", withSaveExt("/Users/me/all", "chessboard-all.json", false, &buf).?);
    // one already there (macOS adds it), or the player's own: left alone
    try std.testing.expect(withSaveExt("C:\\x\\game.pgn", "a.pgn", true, &buf) == null);
    try std.testing.expect(withSaveExt("C:\\x\\game.v2", "a.pgn", true, &buf) == null);
    // nothing suggested, no room: nothing added
    try std.testing.expect(withSaveExt("/Users/me/game", "noext", false, &buf) == null);
    var tiny: [8]u8 = undefined;
    try std.testing.expect(withSaveExt("/Users/me/game", "a.pgn", false, &tiny) == null);
    // a dot in a folder name is not the file's extension
    try std.testing.expectEqualStrings("/Users/me.v2/game.pgn", withSaveExt("/Users/me.v2/game", "a.pgn", false, &buf).?);
}

test "a save to a path that is not absolute is refused, and a typed name never replaces a file the dialog did not ask about" {
    // review P3-5, on a real directory: the extended name is created only as
    // a new file; an existing one is left as it was
    const io = std.testing.io;
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var dir_buf: [4096]u8 = undefined;
    const dir = dir_buf[0..try tmp.dir.realPath(io, &dir_buf)];
    var p_buf: [4200]u8 = undefined;
    const game = try std.fmt.bufPrint(&p_buf, "{s}{s}game.pgn", .{ dir, SEP });
    try writeWhole(io, game, "new", true);
    try std.testing.expectError(error.PathAlreadyExists, writeWhole(io, game, "newer", true));
    var back: [16]u8 = undefined;
    try std.testing.expectEqualStrings("new", try tmp.dir.readFile(io, "game.pgn", &back));
    // what the null platform's dialog hands back is refused before any write
    try std.testing.expect(!std.fs.path.isAbsolute("chess-20260929.pgn"));
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
