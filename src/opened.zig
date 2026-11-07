//! Files the OS hands the app (20.0 E3, v20-0-plan §10): a .pgn
//! double-clicked or dropped on the Dock icon (macOS: the 'odoc' Apple event,
//! src/native/mac_shell.m), dropped on the window (the SDK's files_dropped),
//! or named on the command line (Windows: Explorer starts `chessboard.exe
//! "<file>"`). The page never sees a path: it hears "open:files" and asks
//! chess.openedFile for the next file, which answers with the file's name and
//! bytes the way chess.openPgn does (dialogs.zig). The page imports it
//! (library/import.js, the same import as 我 · 棋谱库 · 导入 PGN).
//!
//! On Windows a second launch — Explorer starting the exe again for a file
//! double-clicked while the app runs — hands its files to the running one and
//! exits: one app, one store, one window. The first launch owns a named
//! mutex; a later one writes each path into `<appdata>\inbox\` and sets a
//! named event, on which the first one's listener thread waits. The listener
//! queues the paths and wakes the loop (PlatformServices.wake_fn), which
//! tells the page and brings the window forward.

const std = @import("std");
const builtin = @import("builtin");
const native_sdk = @import("native_sdk");

const App = @import("main.zig").App;

/// The longest path queued (the SDK's own bound for a dialog's path).
pub const PATH_MAX = native_sdk.platform.max_dialog_path_bytes;
/// Files waiting for the page at once. A drop of more than this keeps the first.
pub const SLOTS = 8;

const SpinLock = struct {
    inner: std.atomic.Mutex = .unlocked,
    fn lock(self: *SpinLock) void {
        while (!self.inner.tryLock()) std.atomic.spinLoopHint();
    }
    fn unlock(self: *SpinLock) void {
        self.inner.unlock();
    }
};

/// Paths waiting for chess.openedFile, oldest first. Pushed from the loop
/// thread (a drop, the Apple event) and from the Windows listener; popped on
/// the loop thread (the bridge).
pub const Queue = struct {
    lock: SpinLock = .{},
    bufs: [SLOTS][PATH_MAX]u8 = undefined,
    lens: [SLOTS]usize = @splat(0),
    head: usize = 0,
    count: usize = 0,
    /// set by a push, taken by the loop: "tell the page"
    arrived: bool = false,

    /// Queue `path`. false: empty, too long, already waiting (macOS can say
    /// the same file twice at a launch), or no slot left.
    pub fn push(self: *Queue, path: []const u8) bool {
        if (path.len == 0 or path.len > PATH_MAX) return false;
        if (std.mem.indexOfScalar(u8, path, 0) != null) return false;
        self.lock.lock();
        defer self.lock.unlock();
        var i: usize = 0;
        while (i < self.count) : (i += 1) {
            const at = (self.head + i) % SLOTS;
            if (std.mem.eql(u8, self.bufs[at][0..self.lens[at]], path)) return false;
        }
        if (self.count == SLOTS) return false;
        const at = (self.head + self.count) % SLOTS;
        @memcpy(self.bufs[at][0..path.len], path);
        self.lens[at] = path.len;
        self.count += 1;
        self.arrived = true;
        return true;
    }

    /// The oldest waiting path, copied into `out`; null when none waits.
    pub fn pop(self: *Queue, out: []u8) ?[]const u8 {
        self.lock.lock();
        defer self.lock.unlock();
        if (self.count == 0) return null;
        const len = self.lens[self.head];
        if (len > out.len) return null;
        @memcpy(out[0..len], self.bufs[self.head][0..len]);
        self.head = (self.head + 1) % SLOTS;
        self.count -= 1;
        return out[0..len];
    }

    pub fn waiting(self: *Queue) usize {
        self.lock.lock();
        defer self.lock.unlock();
        return self.count;
    }

    /// Whether anything arrived since the last call.
    pub fn takeArrived(self: *Queue) bool {
        self.lock.lock();
        defer self.lock.unlock();
        const was = self.arrived;
        self.arrived = false;
        return was;
    }
};

/// The app's one queue (a file can arrive before the App has a Runtime, and
/// from a C callback with no App in hand).
pub var queue: Queue = .{};

/// The App, for the C callback and the listener thread (main.zig sets it).
pub var app_ptr: ?*App = null;
var closed = std.atomic.Value(bool).init(false);

/// Ask the loop to drain the queue (onEvent `.effects_wake` → tellPage).
/// Nothing once the app is stopping (the SDK's teardown contract: no
/// wake_fn after the stop hook).
fn wakeLoop() void {
    if (closed.load(.acquire)) return;
    const app = app_ptr orelse return;
    const rt = app.runtime orelse return;
    const services = rt.options.platform.services;
    const wake = services.wake_fn orelse return;
    wake(services.context) catch {};
}

/// The stop hook: no more wakes.
pub fn close() void {
    closed.store(true, .release);
}

/// macOS (src/native/mac_shell.m): the 'odoc' Apple event — a .pgn
/// double-clicked in Finder, dropped on the Dock icon, or opened with
/// `open -a` — one path at a time, on the main thread.
export fn chess_open_path(path: [*]const u8, len: usize) callconv(.c) void {
    if (queue.push(path[0..len])) wakeLoop();
}

/// The loop thread, on `.effects_wake` and after a drop: when something
/// arrived, the page hears "open:files" (it then calls chess.openedFile until
/// none is left) and the window comes forward.
pub fn tellPage(runtime: *native_sdk.Runtime) void {
    if (!queue.takeArrived()) return;
    var buf: [48]u8 = undefined;
    const detail = std.fmt.bufPrint(&buf, "{{\"waiting\":{d}}}", .{queue.waiting()}) catch return;
    runtime.showWindow(1) catch {};
    runtime.focusWindow(1) catch {};
    runtime.emitWindowEvent(1, "open:files", detail) catch {};
}

/// A drop on the window (the SDK's files_dropped, which it hands the app
/// before it emits "drop:files" to the page): each regular file is queued.
/// The page listens for "open:files" only.
pub fn queueDropped(runtime: *native_sdk.Runtime, event: native_sdk.Event) void {
    if (event != .files_dropped) return;
    for (event.files_dropped.paths) |p| _ = queue.push(p);
    tellPage(runtime);
}

/// The files named on the command line: every argument after the program
/// that is not a switch. Windows only — that is how Explorer opens a file
/// with an app; macOS sends the Apple event instead, and AppKit reads the
/// command line itself.
pub fn queueArgs(args: []const [:0]const u8) usize {
    var n: usize = 0;
    if (args.len < 2) return 0;
    for (args[1..]) |a| {
        if (!isFileArg(a)) continue;
        if (queue.push(a)) n += 1;
    }
    return n;
}

pub fn isFileArg(a: []const u8) bool {
    if (a.len == 0 or a[0] == '-') return false;
    // a Windows switch ("/u") is short and has no separator after its slash
    if (a[0] == '/' and builtin.os.tag == .windows) return false;
    return std.fs.path.isAbsolute(a) or std.mem.indexOfAny(u8, a, "/\\") != null or std.mem.indexOfScalar(u8, a, '.') != null;
}

// ------------------------------------------------------------ one instance (Windows)

const INSTANCE_NAME = "Local\\dev.hxddh.chessboard.instance";
const EVENT_NAME = "Local\\dev.hxddh.chessboard.open";
pub const INBOX_DIR = "inbox";

const win = std.os.windows;
extern "kernel32" fn CreateMutexW(attrs: ?*anyopaque, initial_owner: win.BOOL, name: [*:0]const u16) callconv(.winapi) ?win.HANDLE;
extern "kernel32" fn CreateEventW(attrs: ?*anyopaque, manual_reset: win.BOOL, initial_state: win.BOOL, name: [*:0]const u16) callconv(.winapi) ?win.HANDLE;
extern "kernel32" fn OpenEventW(access: win.DWORD, inherit: win.BOOL, name: [*:0]const u16) callconv(.winapi) ?win.HANDLE;
extern "kernel32" fn SetEvent(event: win.HANDLE) callconv(.winapi) win.BOOL;
extern "kernel32" fn WaitForSingleObject(handle: win.HANDLE, ms: win.DWORD) callconv(.winapi) win.DWORD;
extern "user32" fn AllowSetForegroundWindow(pid: win.DWORD) callconv(.winapi) win.BOOL;
const EVENT_MODIFY_STATE: win.DWORD = 0x0002;
const ASFW_ANY: win.DWORD = 0xFFFFFFFF;
const WAIT_OBJECT_0: win.DWORD = 0;
const INFINITE: win.DWORD = 0xFFFFFFFF;

pub const Claim = enum { primary, handed_over };

var listener_running = std.atomic.Value(bool).init(false);

/// Whether the inbox listener is still out (main.zig: then leave with exit,
/// not through std.start's teardown).
pub fn listenerOut() bool {
    return listener_running.load(.acquire);
}

/// `<appdata><sep>inbox`, or null without a data directory.
pub fn inboxDir(buf: []u8, appdata_dir: []const u8) ?[]const u8 {
    if (appdata_dir.len == 0) return null;
    return std.fmt.bufPrint(buf, "{s}{c}{s}", .{ appdata_dir, std.fs.path.sep, INBOX_DIR }) catch null;
}

/// Windows: become the one instance, or hand `args`' files to the one that
/// is and say so (main.zig then exits). Elsewhere always primary: macOS keeps
/// one instance itself, and the null platform has no second launch.
pub fn claimInstance(app: *App, args: []const [:0]const u8) Claim {
    if (comptime builtin.os.tag != .windows) return .primary;
    const mutex = CreateMutexW(null, .TRUE, std.unicode.utf8ToUtf16LeStringLiteral(INSTANCE_NAME));
    if (mutex == null) return .primary; // cannot tell: run
    if (win.GetLastError() != .ALREADY_EXISTS) {
        startListener(app);
        return .primary;
    }
    handOver(app, args);
    return .handed_over;
}

/// The second launch: each file into the inbox, then the event. Waits up to
/// two seconds for the first launch's event (it is made right after the
/// mutex, so only a launch racing the first one's start sees none yet).
fn handOver(app: *App, args: []const [:0]const u8) void {
    var dir_buf: [1200]u8 = undefined;
    if (inboxDir(&dir_buf, app.appdata_dir)) |dir| {
        std.Io.Dir.cwd().createDirPath(app.io, dir) catch {};
        const pid = win.GetCurrentProcessId();
        var seq: usize = 0;
        if (args.len > 1) for (args[1..]) |a| {
            if (!isFileArg(a)) continue;
            seq += 1;
            writeInboxFile(app.io, dir, pid, seq, a) catch {};
        };
    }
    // the running app may bring its window forward (it is not the
    // foreground process; this one, just started from Explorer, is)
    _ = AllowSetForegroundWindow(ASFW_ANY);
    var tries: usize = 0;
    while (tries < 40) : (tries += 1) {
        if (OpenEventW(EVENT_MODIFY_STATE, .FALSE, std.unicode.utf8ToUtf16LeStringLiteral(EVENT_NAME))) |event| {
            _ = SetEvent(event);
            win.CloseHandle(event);
            return;
        }
        std.Io.sleep(app.io, std.Io.Duration.fromMilliseconds(50), .awake) catch {};
    }
}

/// `<pid>-<seq>.path` holding the path, written whole under a temporary
/// name first so the listener never reads half of one.
fn writeInboxFile(io: std.Io, dir: []const u8, pid: u32, seq: usize, path: []const u8) !void {
    var tmp_buf: [1300]u8 = undefined;
    var final_buf: [1300]u8 = undefined;
    const tmp = try std.fmt.bufPrint(&tmp_buf, "{s}{c}{d}-{d}.tmp", .{ dir, std.fs.path.sep, pid, seq });
    const final = try std.fmt.bufPrint(&final_buf, "{s}{c}{d}-{d}.path", .{ dir, std.fs.path.sep, pid, seq });
    {
        var file = try std.Io.Dir.createFileAbsolute(io, tmp, .{ .truncate = true });
        defer file.close(io);
        try file.writeStreamingAll(io, path);
    }
    try std.Io.Dir.renameAbsolute(tmp, final, io);
}

/// The inbox's `.path` files, oldest name first is not promised (a drop of
/// several comes from one launch, numbered, and the page imports each
/// whatever the order): each read into the queue, then deleted. Leftovers of
/// a launch that died mid-handover are read too — they are files the player
/// asked to open.
pub fn drainInbox(io: std.Io, dir_path: []const u8) usize {
    var dir = std.Io.Dir.openDirAbsolute(io, dir_path, .{ .iterate = true }) catch return 0;
    defer dir.close(io);
    var n: usize = 0;
    var names: [SLOTS * 2][128]u8 = undefined;
    var name_lens: [SLOTS * 2]usize = undefined;
    var count: usize = 0;
    var it = dir.iterate();
    while (it.next(io) catch null) |entry| {
        if (entry.kind != .file or !std.mem.endsWith(u8, entry.name, ".path")) continue;
        if (entry.name.len > 128 or count == names.len) continue;
        @memcpy(names[count][0..entry.name.len], entry.name);
        name_lens[count] = entry.name.len;
        count += 1;
    }
    for (names[0..count], name_lens[0..count]) |*name_buf, len| {
        const name = name_buf[0..len];
        var path_buf: [PATH_MAX]u8 = undefined;
        if (dir.openFile(io, name, .{})) |file| {
            var f = file;
            const got = f.readPositionalAll(io, &path_buf, 0) catch 0;
            f.close(io);
            if (got > 0 and got < PATH_MAX and queue.push(path_buf[0..got])) n += 1;
        } else |_| {}
        dir.deleteFile(io, name) catch {};
    }
    return n;
}

fn startListener(app: *App) void {
    if (comptime builtin.os.tag != .windows) return;
    const event = CreateEventW(null, .FALSE, .FALSE, std.unicode.utf8ToUtf16LeStringLiteral(EVENT_NAME)) orelse return;
    listener_running.store(true, .release);
    const thread = std.Thread.spawn(.{ .stack_size = 1024 * 1024 }, listen, .{ app, event }) catch {
        listener_running.store(false, .release);
        return;
    };
    thread.detach();
}

/// The listener: one wake of the loop per signal, for files or for nothing
/// (a second launch with no file still brings the window forward).
fn listen(app: *App, event: win.HANDLE) void {
    defer listener_running.store(false, .release);
    var dir_buf: [1200]u8 = undefined;
    while (!closed.load(.acquire)) {
        if (WaitForSingleObject(event, INFINITE) != WAIT_OBJECT_0) return;
        if (closed.load(.acquire)) return;
        if (inboxDir(&dir_buf, app.appdata_dir)) |dir| _ = drainInbox(app.io, dir);
        queue.lock.lock();
        queue.arrived = true;
        queue.lock.unlock();
        wakeLoop();
    }
}

// ---------------------------------------------------------------- tests

test "the queue keeps paths in order, refuses repeats and overflow, and says when something arrived" {
    var q: Queue = .{};
    try std.testing.expect(!q.takeArrived());
    try std.testing.expect(q.push("/Users/me/a.pgn"));
    try std.testing.expect(q.push("/Users/me/b.pgn"));
    // macOS can name the same file twice at a launch: it is imported once
    try std.testing.expect(!q.push("/Users/me/a.pgn"));
    try std.testing.expect(!q.push(""));
    try std.testing.expect(!q.push("a\x00b"));
    try std.testing.expect(q.takeArrived());
    try std.testing.expect(!q.takeArrived());
    try std.testing.expectEqual(@as(usize, 2), q.waiting());
    var out: [PATH_MAX]u8 = undefined;
    try std.testing.expectEqualStrings("/Users/me/a.pgn", q.pop(&out).?);
    // once taken, the same file may come again (opened a second time)
    try std.testing.expect(q.push("/Users/me/a.pgn"));
    try std.testing.expectEqualStrings("/Users/me/b.pgn", q.pop(&out).?);
    try std.testing.expectEqualStrings("/Users/me/a.pgn", q.pop(&out).?);
    try std.testing.expect(q.pop(&out) == null);
    // bounded: the first SLOTS stay, the rest are refused
    var name_buf: [32]u8 = undefined;
    var i: usize = 0;
    while (i < SLOTS + 3) : (i += 1) {
        const name = try std.fmt.bufPrint(&name_buf, "/x/{d}.pgn", .{i});
        try std.testing.expectEqual(i < SLOTS, q.push(name));
    }
    try std.testing.expectEqualStrings("/x/0.pgn", q.pop(&out).?);
    var long: [PATH_MAX + 1]u8 = @splat('a');
    try std.testing.expect(!q.push(&long));
}

test "the command line's files are the arguments that name one, not switches" {
    try std.testing.expect(isFileArg("C:\\Users\\me\\game.pgn"));
    try std.testing.expect(isFileArg("/Users/me/game.pgn"));
    try std.testing.expect(isFileArg("game.pgn"));
    try std.testing.expect(!isFileArg("--inspect"));
    try std.testing.expect(!isFileArg("-psn_0_12345"));
    try std.testing.expect(!isFileArg(""));
    try std.testing.expect(!isFileArg("verbose"));
    const before = queue.waiting();
    const args = [_][:0]const u8{ "chessboard.exe", "--flag", "C:\\a b\\one.pgn", "two.pgn" };
    try std.testing.expectEqual(@as(usize, 2), queueArgs(&args));
    try std.testing.expectEqual(before + 2, queue.waiting());
    var out: [PATH_MAX]u8 = undefined;
    while (queue.pop(&out)) |_| {}
    _ = queue.takeArrived();
    try std.testing.expectEqual(@as(usize, 0), queueArgs(args[0..1]));
}

test "a second launch's files cross through the inbox: each read once, then gone" {
    var tmp = std.testing.tmpDir(.{});
    defer tmp.cleanup();
    var path_buf: [4096]u8 = undefined;
    const n = try tmp.dir.realPath(std.testing.io, &path_buf);
    const appdata = path_buf[0..n];
    var dir_buf: [4200]u8 = undefined;
    const dir = inboxDir(&dir_buf, appdata).?;
    try std.testing.expect(std.mem.endsWith(u8, dir, INBOX_DIR));
    try std.testing.expect(inboxDir(&dir_buf, "") == null);
    std.Io.Dir.cwd().createDirPath(std.testing.io, dir) catch {};
    try writeInboxFile(std.testing.io, dir, 42, 1, "/Users/me/一局.pgn");
    try writeInboxFile(std.testing.io, dir, 42, 2, "/Users/me/two.pgn");
    var out: [PATH_MAX]u8 = undefined;
    while (queue.pop(&out)) |_| {}
    try std.testing.expectEqual(@as(usize, 2), drainInbox(std.testing.io, dir));
    var got: [2][]const u8 = undefined;
    var copies: [2][PATH_MAX]u8 = undefined;
    for (&got, &copies) |*g, *c| g.* = queue.pop(c).?;
    const one = std.mem.eql(u8, got[0], "/Users/me/一局.pgn") or std.mem.eql(u8, got[1], "/Users/me/一局.pgn");
    const two = std.mem.eql(u8, got[0], "/Users/me/two.pgn") or std.mem.eql(u8, got[1], "/Users/me/two.pgn");
    try std.testing.expect(one and two);
    // read once: the files are gone, a second drain finds nothing
    try std.testing.expectEqual(@as(usize, 0), drainInbox(std.testing.io, dir));
    _ = queue.takeArrived();
}
