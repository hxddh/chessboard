//! The native Stockfish process (ADR 0004, v20-0-plan F3): spawned from here,
//! not by the SDK — the SDK has no long-lived child process for a WebView
//! app, and `fx.spawn` writes stdin once (4 KiB). The page's engine service
//! (src/app/services/engine-native.js) talks UCI to it through three bridge
//! commands and one window event:
//!
//!   chess.engineStart  {}  → {"gen":g,"cores":n,"started":bool} | {"error":…}
//!                      Spawns `stockfish` (stockfish.exe) from the folder the
//!                      app's executable is in — Contents/MacOS in the .app,
//!                      bin\ in the Windows package — unless one generation
//!                      is already running, which is answered as it is.
//!                      Windows: CREATE_NO_WINDOW, so no console flashes up.
//!   chess.engineSend   {"gen":g,"text":"uci\n…"} → {"ok":true} | {"error":…}
//!                      Written to its stdin on the loop thread; UCI commands
//!                      are a few hundred bytes, far below a pipe's buffer.
//!   chess.engineStop   {"gen":g,"kill":bool} → {"ok":true}
//!                      `quit` and stdin closed; with kill, the process is
//!                      killed outright (a hung engine).
//!   "chess:engine"     window event {"gen":g,"lines":[…]} — its stdout, line
//!                      by line, and {"gen":g,"exit":code} once it is gone.
//!
//! Output is streamed through the N1 async bridge's wake (sync.zig): a reader
//! thread per process blocks on the pipe, appends whole lines to `out` under
//! the lock and calls PlatformServices.wake_fn — the one platform service any
//! thread may call — at most once until the loop has drained; the loop gets
//! `.effects_wake` (main.zig onEvent) and emits what has arrived, in events
//! of at most EVENT_BYTES (the hosts' window-event detail is bounded).
//!
//! Lifetime: the process is the app's. The stop hook closes its stdin after
//! `quit`, and Stockfish ends on either (it reads EOF as quit), so a crash or
//! a kill of the app ends it too — its pipe closes with the app. main()
//! leaves with std.process.exit rather than wait for a reader still out. A
//! crash of the engine is the page's to handle: it hears {"exit":…}, fails
//! the search in flight, and starts a new generation or falls back to wasm.

const std = @import("std");
const builtin = @import("builtin");
const native_sdk = @import("native_sdk");

const App = @import("main.zig").App;

pub const EVENT = "chess:engine";
/// The window-event detail the hosts carry (platform types.zig
/// max_window_event_detail_bytes is 8192), with room for the frame.
const EVENT_BYTES: usize = 7000;
/// Output held for the loop at most; past it only lines that end a request
/// (bestmove, uciok, readyok) are kept — a page that stopped listening
/// cannot grow the app without bound.
const OUT_MAX: usize = 4 * 1024 * 1024;
const LINE_MAX: usize = 4096;
const SEND_MAX: usize = 64 * 1024;

pub const EXE_NAME = if (builtin.os.tag == .windows) "stockfish.exe" else "stockfish";

const SpinLock = struct {
    inner: std.atomic.Mutex = .unlocked,
    fn lock(self: *SpinLock) void {
        while (!self.inner.tryLock()) std.atomic.spinLoopHint();
    }
    fn unlock(self: *SpinLock) void {
        self.inner.unlock();
    }
};

extern "kernel32" fn TerminateProcess(process: std.os.windows.HANDLE, exit_code: c_uint) callconv(.winapi) std.os.windows.BOOL;

/// Where the page's events go: the Runtime in the app, a list in the tests.
pub const Emit = struct {
    context: *anyopaque,
    emit_fn: *const fn (context: *anyopaque, window_id: u64, detail: []const u8) void,
};

pub const Engine = struct {
    // shared with the reader thread, under `lock`
    lock: SpinLock = .{},
    closed: bool = false,
    out: std.ArrayList(u8) = .empty,
    exit_code: ?i64 = null,
    exit_gen: u32 = 0,
    wake_ctx: ?*anyopaque = null,
    wake_fn: ?*const fn (context: ?*anyopaque) anyerror!void = null,
    wake_pending: bool = false,
    /// the running process, for a kill; null once its reader is reaping it
    pid: ?std.process.Child.Id = null,
    /// the generation `pid` belongs to: an old reader never clears a newer one's
    pid_gen: u32 = 0,
    // shared, lock-free
    live: std.atomic.Value(u32) = .init(0),
    // the loop thread's alone
    gen: u32 = 0,
    running: bool = false,
    stdin: ?std.Io.File = null,
    window_id: u64 = 1,

    pub fn bindWake(self: *Engine, context: ?*anyopaque, wake_fn: ?*const fn (context: ?*anyopaque) anyerror!void) void {
        self.lock.lock();
        defer self.lock.unlock();
        self.wake_ctx = context;
        self.wake_fn = wake_fn;
    }

    /// Loop thread: start `argv` as the next generation, or say why not.
    pub fn start(self: *Engine, io: std.Io, argv: []const []const u8, window_id: u64) !u32 {
        // running and still ours to write to: the same generation. Stopped or
        // killed but its exit not drained yet: a new one now (the old one's
        // exit event names its own generation)
        if (self.running and self.stdin != null) return self.gen;
        {
            self.lock.lock();
            defer self.lock.unlock();
            if (self.closed) return error.Closed;
            if (self.wake_fn == null) return error.NoWake;
        }
        var child = try std.process.spawn(io, .{
            .argv = argv,
            .stdin = .pipe,
            .stdout = .pipe,
            .stderr = .ignore,
            .create_no_window = true,
        });
        // the pipes leave the Child: stdin is the loop's, stdout the reader's,
        // and wait() then only reaps the process
        const stdin = child.stdin.?;
        const stdout = child.stdout.?;
        child.stdin = null;
        child.stdout = null;
        self.gen +%= 1;
        if (self.gen == 0) self.gen = 1;
        const reader = std.heap.page_allocator.create(Reader) catch {
            stdin.close(io);
            stdout.close(io);
            child.kill(io);
            return error.OutOfMemory;
        };
        reader.* = .{ .engine = self, .io = io, .child = child, .stdout = stdout, .gen = self.gen };
        {
            self.lock.lock();
            defer self.lock.unlock();
            self.pid = child.id;
            self.pid_gen = self.gen;
        }
        _ = self.live.fetchAdd(1, .acq_rel);
        const thread = std.Thread.spawn(.{ .stack_size = 1024 * 1024 }, Reader.main, .{reader}) catch {
            _ = self.live.fetchSub(1, .acq_rel);
            stdin.close(io);
            reader.stdout.close(io);
            reader.child.kill(io);
            std.heap.page_allocator.destroy(reader);
            return error.ThreadSpawn;
        };
        thread.detach();
        self.stdin = stdin;
        self.running = true;
        self.window_id = window_id;
        return self.gen;
    }

    /// Loop thread: text to the running generation's stdin.
    pub fn send(self: *Engine, io: std.Io, gen: u32, text: []const u8) !void {
        if (!self.running or gen != self.gen) return error.NotRunning;
        const stdin = self.stdin orelse return error.NotRunning;
        stdin.writeStreamingAll(io, text) catch {
            // the process is gone (EPIPE); its reader reports the exit
            self.dropStdin(io);
            return error.NotRunning;
        };
    }

    fn dropStdin(self: *Engine, io: std.Io) void {
        if (self.stdin) |f| f.close(io);
        self.stdin = null;
    }

    /// Loop thread: ask it to go (quit, EOF), or kill it.
    pub fn stop(self: *Engine, io: std.Io, gen: u32, kill: bool) void {
        if (!self.running or gen != self.gen) return;
        // a kill is a kill: no `quit` first, which a searching Stockfish
        // answers with a bestmove the page would take for its search's answer
        if (!kill) if (self.stdin) |f| f.writeStreamingAll(io, "quit\n") catch {};
        if (kill) self.killNow();
        self.dropStdin(io);
        // the exit event marks the generation over; until then a new start
        // answers this generation
    }

    fn killNow(self: *Engine) void {
        self.lock.lock();
        defer self.lock.unlock();
        const pid = self.pid orelse return;
        if (builtin.os.tag == .windows) {
            _ = TerminateProcess(pid, 1);
        } else {
            std.posix.kill(pid, .KILL) catch {};
        }
    }

    /// Loop thread (`.effects_wake`): emit what has arrived.
    pub fn drain(self: *Engine, io: std.Io, emit: Emit) void {
        var taken: std.ArrayList(u8) = .empty;
        defer taken.deinit(std.heap.page_allocator);
        var exit_code: ?i64 = null;
        var exit_gen: u32 = 0;
        {
            self.lock.lock();
            defer self.lock.unlock();
            taken = self.out;
            self.out = .empty;
            exit_code = self.exit_code;
            exit_gen = self.exit_gen;
            self.exit_code = null;
            self.wake_pending = false;
        }
        const gen = if (exit_code != null) exit_gen else self.gen;
        emitLines(emit, self.window_id, gen, taken.items);
        if (exit_code) |code| {
            if (exit_gen == self.gen) {
                self.running = false;
                self.dropStdin(io);
            }
            var buf: [96]u8 = undefined;
            const detail = std.fmt.bufPrint(&buf, "{{\"gen\":{d},\"exit\":{d}}}", .{ exit_gen, code }) catch return;
            emit.emit_fn(emit.context, self.window_id, detail);
        }
    }

    /// Loop thread (the stop hook): nothing more is emitted or woken; the
    /// engine is asked to quit and its stdin closed, which ends it.
    pub fn close(self: *Engine, io: std.Io) void {
        {
            self.lock.lock();
            defer self.lock.unlock();
            self.closed = true;
            self.out.deinit(std.heap.page_allocator);
            self.out = .empty;
        }
        if (self.stdin) |f| f.writeStreamingAll(io, "quit\n") catch {};
        self.dropStdin(io);
        self.running = false;
    }

    pub fn readersOut(self: *Engine) bool {
        return self.live.load(.acquire) > 0;
    }

    /// Reader thread: whole lines in, one wake per drain.
    fn post(self: *Engine, lines: []const u8, exit: ?struct { gen: u32, code: i64 }) void {
        self.lock.lock();
        if (self.closed) {
            self.lock.unlock();
            return;
        }
        if (self.out.items.len + lines.len <= OUT_MAX) {
            self.out.appendSlice(std.heap.page_allocator, lines) catch {};
        } else {
            var it = std.mem.splitScalar(u8, lines, '\n');
            while (it.next()) |line| {
                if (!mustKeep(line)) continue;
                self.out.appendSlice(std.heap.page_allocator, line) catch {};
                self.out.append(std.heap.page_allocator, '\n') catch {};
            }
        }
        if (exit) |e| {
            self.exit_code = e.code;
            self.exit_gen = e.gen;
            if (self.pid_gen == e.gen) self.pid = null;
        }
        const wake = if (self.wake_pending) null else self.wake_fn;
        const ctx = self.wake_ctx;
        if (wake != null) self.wake_pending = true;
        self.lock.unlock();
        if (wake) |w| w(ctx) catch |err| std.log.warn("chessboard: engine wake failed: {s}", .{@errorName(err)});
    }
};

fn mustKeep(line: []const u8) bool {
    return std.mem.startsWith(u8, line, "bestmove") or std.mem.eql(u8, line, "uciok") or std.mem.eql(u8, line, "readyok");
}

/// `lines` ("a\nb\n…") as events {"gen":g,"lines":["a","b",…]}, each within EVENT_BYTES.
fn emitLines(emit: Emit, window_id: u64, gen: u32, lines: []const u8) void {
    if (lines.len == 0) return;
    var buf: [EVENT_BYTES + 512]u8 = undefined;
    var w: std.Io.Writer = .fixed(&buf);
    var count: usize = 0;
    var it = std.mem.splitScalar(u8, lines, '\n');
    while (it.next()) |raw| {
        const line = std.mem.trimEnd(u8, raw, "\r");
        if (line.len == 0) continue;
        const piece = line[0..@min(line.len, LINE_MAX)];
        if (count > 0 and w.end + piece.len * 2 + 8 > EVENT_BYTES) {
            w.writeAll("]}") catch {};
            emit.emit_fn(emit.context, window_id, w.buffered());
            w = .fixed(&buf);
            count = 0;
        }
        if (count == 0) w.print("{{\"gen\":{d},\"lines\":[", .{gen}) catch return else w.writeByte(',') catch return;
        std.json.Stringify.encodeJsonString(piece, .{}, &w) catch {
            // one line longer than the frame (never from Stockfish): cut it
            continue;
        };
        count += 1;
    }
    if (count > 0) {
        w.writeAll("]}") catch return;
        emit.emit_fn(emit.context, window_id, w.buffered());
    }
}

const Reader = struct {
    engine: *Engine,
    io: std.Io,
    child: std.process.Child,
    stdout: std.Io.File,
    gen: u32,

    fn main(self: *Reader) void {
        const engine = self.engine;
        var buf: [16 * 1024]u8 = undefined;
        var pending: std.ArrayList(u8) = .empty;
        defer pending.deinit(std.heap.page_allocator);
        while (true) {
            const n = self.stdout.readStreaming(self.io, &.{&buf}) catch break;
            if (n == 0) break;
            pending.appendSlice(std.heap.page_allocator, buf[0..n]) catch break;
            const end = std.mem.lastIndexOfScalar(u8, pending.items, '\n') orelse {
                if (pending.items.len > LINE_MAX * 4) pending.clearRetainingCapacity();
                continue;
            };
            engine.post(pending.items[0 .. end + 1], null);
            const rest = pending.items.len - (end + 1);
            std.mem.copyForwards(u8, pending.items[0..rest], pending.items[end + 1 ..]);
            pending.shrinkRetainingCapacity(rest);
        }
        self.stdout.close(self.io);
        // the kill path may not touch the process past this point
        {
            engine.lock.lock();
            defer engine.lock.unlock();
            if (engine.pid_gen == self.gen) engine.pid = null;
        }
        const code: i64 = if (self.child.wait(self.io)) |term| switch (term) {
            .exited => |c| c,
            .signal => |s| -@as(i64, @intFromEnum(s)),
            else => -1,
        } else |_| -1;
        if (pending.items.len > 0) pending.append(std.heap.page_allocator, '\n') catch {};
        engine.post(pending.items, .{ .gen = self.gen, .code = code });
        const live = &engine.live;
        std.heap.page_allocator.destroy(self);
        _ = live.fetchSub(1, .acq_rel);
    }
};

// ------------------------------------------------------------ bridge

/// The engine beside the app's executable, or null when there is none.
pub fn enginePath(io: std.Io, buf: []u8) ?[]const u8 {
    var exe_buf: [4096]u8 = undefined;
    const n = std.process.executableDirPath(io, &exe_buf) catch return null;
    const path = std.fmt.bufPrint(buf, "{s}{c}{s}", .{ exe_buf[0..n], std.fs.path.sep, EXE_NAME }) catch return null;
    var file = std.Io.Dir.openFileAbsolute(io, path, .{}) catch return null;
    file.close(io);
    return path;
}

fn bindFrom(self: *App) void {
    const rt = self.runtime orelse return;
    const services = rt.options.platform.services;
    self.engine.bindWake(services.context, services.wake_fn);
}

pub fn engineStart(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    bindFrom(self);
    const cores = std.Thread.getCpuCount() catch 1;
    if (self.engine.running and self.engine.stdin != null) return std.fmt.bufPrint(output, "{{\"gen\":{d},\"cores\":{d},\"started\":false}}", .{ self.engine.gen, cores });
    var path_buf: [4200]u8 = undefined;
    const path = enginePath(self.io, &path_buf) orelse return std.fmt.bufPrint(output, "{{\"error\":\"missing\"}}", .{});
    const gen = self.engine.start(self.io, &.{path}, invocation.source.window_id) catch |err|
        return std.fmt.bufPrint(output, "{{\"error\":\"spawn\",\"detail\":\"{s}\"}}", .{@errorName(err)});
    return std.fmt.bufPrint(output, "{{\"gen\":{d},\"cores\":{d},\"started\":true}}", .{ gen, cores });
}

const SendRequest = struct { gen: u32 = 0, text: []const u8 = "" };
const StopRequest = struct { gen: u32 = 0, kill: bool = false };

pub fn engineSend(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const req = std.json.parseFromSliceLeaky(SendRequest, arena_state.allocator(), invocation.request.payload, .{ .ignore_unknown_fields = true }) catch
        return std.fmt.bufPrint(output, "{{\"error\":\"bad_request\"}}", .{});
    if (req.text.len == 0 or req.text.len > SEND_MAX or std.mem.indexOfScalar(u8, req.text, 0) != null)
        return std.fmt.bufPrint(output, "{{\"error\":\"bad_request\"}}", .{});
    self.engine.send(self.io, req.gen, req.text) catch return std.fmt.bufPrint(output, "{{\"error\":\"not_running\"}}", .{});
    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{});
}

pub fn engineStop(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const req = std.json.parseFromSliceLeaky(StopRequest, arena_state.allocator(), invocation.request.payload, .{ .ignore_unknown_fields = true }) catch
        return std.fmt.bufPrint(output, "{{\"error\":\"bad_request\"}}", .{});
    self.engine.stop(self.io, req.gen, req.kill);
    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{});
}

/// main.zig onEvent: the Runtime as the place events go.
pub fn runtimeEmit(runtime: *native_sdk.Runtime) Emit {
    return .{ .context = runtime, .emit_fn = struct {
        fn emit(context: *anyopaque, window_id: u64, detail: []const u8) void {
            const rt: *native_sdk.Runtime = @ptrCast(@alignCast(context));
            rt.emitWindowEvent(if (window_id == 0) 1 else window_id, EVENT, detail) catch |err|
                std.log.warn("chessboard: engine event dropped: {s}", .{@errorName(err)});
        }
    }.emit };
}

// ---------------------------------------------------------------- tests

const TestWake = struct {
    n: std.atomic.Value(u32) = .init(0),
    fn wake(context: ?*anyopaque) anyerror!void {
        const self: *TestWake = @ptrCast(@alignCast(context.?));
        _ = self.n.fetchAdd(1, .acq_rel);
    }
};

const TestEvents = struct {
    list: std.ArrayList([]u8) = .empty,
    fn emit(context: *anyopaque, window_id: u64, detail: []const u8) void {
        _ = window_id;
        const self: *TestEvents = @ptrCast(@alignCast(context));
        self.list.append(std.testing.allocator, std.testing.allocator.dupe(u8, detail) catch unreachable) catch unreachable;
    }
    fn sink(self: *TestEvents) Emit {
        return .{ .context = self, .emit_fn = emit };
    }
    fn deinit(self: *TestEvents) void {
        for (self.list.items) |e| std.testing.allocator.free(e);
        self.list.deinit(std.testing.allocator);
    }
    fn joined(self: *TestEvents) ![]u8 {
        var all: std.ArrayList(u8) = .empty;
        for (self.list.items) |e| {
            try all.appendSlice(std.testing.allocator, e);
            try all.append(std.testing.allocator, '\n');
        }
        return all.toOwnedSlice(std.testing.allocator);
    }
};

/// Close, and wait for every reader to be gone (they point at `engine`, which is on the test's stack).
fn closeAndJoin(engine: *Engine) void {
    engine.close(std.testing.io);
    var spins: usize = 0;
    while (engine.readersOut() and spins < 500) : (spins += 1) std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(10), .awake) catch {};
}

/// Drain until `want` shows up in the events (or 5 s pass).
fn drainUntil(engine: *Engine, events: *TestEvents, want: []const u8) !void {
    var i: usize = 0;
    while (i < 500) : (i += 1) {
        engine.drain(std.testing.io, events.sink());
        const all = try events.joined();
        defer std.testing.allocator.free(all);
        if (std.mem.indexOf(u8, all, want) != null) return;
        std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(10), .awake) catch {};
    }
    const all = try events.joined();
    defer std.testing.allocator.free(all);
    std.debug.print("events so far:\n{s}\n", .{all});
    return error.TestTimeout;
}

// A stand-in engine: a shell loop that answers each line, and exits 3 on quit.
const FAKE = [_][]const u8{ "/bin/sh", "-c", "echo ready; while read l; do echo \"got $l\"; [ \"$l\" = quit ] && exit 3; done; exit 4" };

test "F3 engine: lines stream back as events, a quit ends it with its code" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;
    var wake = TestWake{};
    var engine = Engine{};
    engine.bindWake(&wake, TestWake.wake);
    var events = TestEvents{};
    defer events.deinit();
    const gen = try engine.start(std.testing.io, &FAKE, 1);
    try std.testing.expectEqual(@as(u32, 1), gen);
    // a second start while it runs is the same generation
    try std.testing.expectEqual(gen, try engine.start(std.testing.io, &FAKE, 1));
    try engine.send(std.testing.io, gen, "uci\nisready\n");
    try drainUntil(&engine, &events, "got isready");
    try std.testing.expect(wake.n.load(.acquire) >= 1);
    const first = try events.joined();
    defer std.testing.allocator.free(first);
    try std.testing.expect(std.mem.indexOf(u8, first, "{\"gen\":1,\"lines\":[\"ready\"") != null or std.mem.indexOf(u8, first, "\"ready\"") != null);
    try std.testing.expectError(error.NotRunning, engine.send(std.testing.io, gen + 1, "x\n"));
    engine.stop(std.testing.io, gen, false);
    try drainUntil(&engine, &events, "\"exit\":3");
    try std.testing.expect(!engine.running);
    try std.testing.expectError(error.NotRunning, engine.send(std.testing.io, gen, "x\n"));
    // the next start is a new generation
    const g2 = try engine.start(std.testing.io, &FAKE, 1);
    try std.testing.expectEqual(@as(u32, 2), g2);
    engine.stop(std.testing.io, g2, true);
    try drainUntil(&engine, &events, "{\"gen\":2,\"exit\":-9}");
    var spins: usize = 0;
    while (engine.readersOut() and spins < 500) : (spins += 1) std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(10), .awake) catch {};
    try std.testing.expect(!engine.readersOut());
    closeAndJoin(&engine);
}

test "F3 engine: a start right after a kill is a new generation, before the old exit is drained" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;
    var wake = TestWake{};
    var engine = Engine{};
    engine.bindWake(&wake, TestWake.wake);
    var events = TestEvents{};
    defer events.deinit();
    const g1 = try engine.start(std.testing.io, &FAKE, 1);
    engine.stop(std.testing.io, g1, true);
    const g2 = try engine.start(std.testing.io, &FAKE, 1);
    try std.testing.expectEqual(g1 + 1, g2);
    try engine.send(std.testing.io, g2, "hello\n");
    try drainUntil(&engine, &events, "got hello");
    try drainUntil(&engine, &events, "{\"gen\":1,\"exit\":-9}");
    // the old exit leaves the new one running
    try std.testing.expect(engine.running);
    try engine.send(std.testing.io, g2, "again\n");
    try drainUntil(&engine, &events, "got again");
    closeAndJoin(&engine);
}

test "F3 engine: a crash is an exit event; nothing is emitted after close" {
    if (builtin.os.tag == .windows) return error.SkipZigTest;
    var wake = TestWake{};
    var engine = Engine{};
    engine.bindWake(&wake, TestWake.wake);
    var events = TestEvents{};
    defer events.deinit();
    const gen = try engine.start(std.testing.io, &.{ "/bin/sh", "-c", "echo partial-without-newline | tr -d '\\n'; kill -SEGV $$" }, 1);
    try drainUntil(&engine, &events, "\"exit\":-11");
    const all = try events.joined();
    defer std.testing.allocator.free(all);
    // a last line without its newline still arrives, before the exit
    try std.testing.expect(std.mem.indexOf(u8, all, "partial-without-newline") != null);
    _ = gen;
    // after close: no wake, no event
    const g2 = try engine.start(std.testing.io, &FAKE, 1);
    _ = g2;
    engine.close(std.testing.io);
    const before = events.list.items.len;
    std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(100), .awake) catch {};
    engine.drain(std.testing.io, events.sink());
    try std.testing.expectEqual(before, events.list.items.len);
    try std.testing.expectError(error.Closed, engine.start(std.testing.io, &FAKE, 1));
    var spins: usize = 0;
    while (engine.readersOut() and spins < 500) : (spins += 1) std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(10), .awake) catch {};
    try std.testing.expect(!engine.readersOut());
}

test "F3 engine: events stay within the window-event bound and keep every line" {
    var events = TestEvents{};
    defer events.deinit();
    var lines: std.ArrayList(u8) = .empty;
    defer lines.deinit(std.testing.allocator);
    for (0..200) |i| try lines.print(std.testing.allocator, "info depth {d} pv e2e4 \"quoted\" e7e5\n", .{i});
    emitLines(events.sink(), 1, 7, lines.items);
    try std.testing.expect(events.list.items.len > 1);
    var total: usize = 0;
    for (events.list.items) |e| {
        try std.testing.expect(e.len <= EVENT_BYTES + 64);
        const parsed = try std.json.parseFromSlice(struct { gen: u32, lines: []const []const u8 }, std.testing.allocator, e, .{});
        defer parsed.deinit();
        try std.testing.expectEqual(@as(u32, 7), parsed.value.gen);
        total += parsed.value.lines.len;
    }
    try std.testing.expectEqual(@as(usize, 200), total);
}
