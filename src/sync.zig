//! The asynchronous bridge commands (v8-1-plan N1): the update check and
//! the Lichess / Chess.com fetch, with the HTTP they share. Moved verbatim
//! out of main.zig (v8-2-plan F2).

const std = @import("std");
const native_sdk = @import("native_sdk");

const BRIDGE_FRAME_MAX = @import("bridge.zig").BRIDGE_FRAME_MAX;
const WRITE_B64_MAX = @import("bridge.zig").WRITE_B64_MAX;
const jsonAppend = @import("bridge.zig").jsonAppend;
const jsonFieldValue = @import("bridge.zig").jsonFieldValue;
const jsonStringField = @import("bridge.zig").jsonStringField;
const jsonStringFieldRaw = @import("bridge.zig").jsonStringFieldRaw;
const jsonUintField = @import("bridge.zig").jsonUintField;
const selftestOn = @import("bridge.zig").selftestOn;
const tokenValid = @import("bridge.zig").tokenValid;
const App = @import("main.zig").App;

// ------------------------------------------------------ async bridge (N1)
//
// v8-1-plan N1. Until 8.1 chess.checkUpdate and chess.fetchGames were plain
// handlers that ran std.http on the thread the bridge dispatches on — the
// platform loop — so a sync of three Chess.com months held the window still
// for as long as the network took (v8-0-plan §9 C2: "会占住桥所在的线程").
//
// Now they are SDK AsyncHandlers (bridge.AsyncHandler, SDK 0.10.1
// src/bridge/root.zig; the runtime reserves an AsyncBridgeResponseSlot per
// request, runtime/flow.zig handleAsyncBridgeMessage):
//   1. the handler, on the loop thread, checks the request and takes this
//      kind's slot — one sync and one update check at a time; a second of a
//      kind still running is answered {"error":"busy"} at once;
//   2. it starts the job's thread, which runs the HTTP as an Io task
//      (io.concurrent) and keeps the deadline, and returns — the loop is
//      free again;
//   3. whichever finishes first (the answer, or the deadline's "timeout")
//      claims the job, puts its text on the completion queue under the lock
//      and, once the lock is released, calls PlatformServices.wake_fn — the
//      one platform service that may be called from any thread
//      (platform/types.zig: macOS dispatch_async, Win32 PostMessageW,
//      bounded and enqueue-only);
//   4. the platform delivers `.wake` on the loop thread, the runtime hands
//      it to onEvent as `.effects_wake`, and drain() answers through the
//      AsyncResponder the handler kept.
// The page's side is unchanged: zero.invoke is still one Promise.
//
// The deadline is the job thread's, not std.http's: Zig 0.16's client has no
// per-request timeout, and a stalled read would otherwise hold the answer
// forever. At the deadline the page is told "timeout" and the slot is free
// for the next try; then the HTTP task is canceled (Future.cancel), which
// Io.Threaded delivers into the blocked syscall itself — SIG.IO through
// pthread_kill on macOS, NtCancelSynchronousIoFile on Windows, tgkill on
// Linux (std/Io/Threaded.zig signalCanceledSyscall) — so the read returns
// error.Canceled, the task ends and the job is gone. 8.1 M2 review P2-1:
// before, the worker was left to finish on its own, and four stalled
// connections made every later sync and update check answer busy.
// Pending.LIVE_MAX still bounds what is out.
//
// Exit: the SDK's stop hook (onStop) closes the queue — no wake_fn after it,
// since the platform is about to be freed — and main() leaves with
// std.process.exit when a worker is still out, rather than returning into
// std.start's Io.Threaded.deinit, which would wait for it. The network never
// holds the app open.

const AsyncKind = enum(u1) { sync, update };

const AsyncResponder = native_sdk.bridge.AsyncResponder;

/// What a job's thread runs: its answer as JSON, written into `out` (or any
/// static text). Tests hand in their own.
const WorkFn = *const fn (job: *Job, out: []u8) []const u8;

const JobSpec = struct {
    work: WorkFn,
    deadline_ms: u64,
    io: std.Io,
    sync: ?SyncRequest = null,
    /// v8-2-plan V1: where a self-test's sync goes instead of the two sites
    /// (syncBase; "" — every launch but a scenario's — is the sites)
    sync_base: []const u8 = "",
    /// for the tests' work functions only
    test_ctx: ?*anyopaque = null,
};

/// A sync fetches at most 1 + SYNC_MONTHS_SINCE_MAX pages; this is generous
/// for that and still well inside sync-ui.js's own 75 s backstop.
const SYNC_DEADLINE_MS: u64 = 60_000;
/// The About panel's check: host.js gives up at 10 s.
const UPDATE_DEADLINE_MS: u64 = 8_000;
/// How often the job thread looks at the clock and at the job.
const WATCH_POLL_MS: u64 = 20;
/// Room for a sync answer (SyncAnswer caps it at SYNC_ANSWER_MAX) and more.
const JOB_OUT_BYTES: usize = SYNC_ANSWER_MAX + 1024;

const Job = struct {
    pending: *Pending,
    kind: AsyncKind,
    gen: u32,
    spec: JobSpec,
    /// the task has its answer (the job thread may stop looking)
    done: std.atomic.Value(bool) = .init(false),
    /// whoever sets this first — the task's answer or the deadline's
    /// timeout — is the one that goes on the queue
    claimed: std.atomic.Value(bool) = .init(false),

    /// Progress for chess.fetchProgress (sync only): how many games are in.
    fn report(job: *Job, count: usize) void {
        if (job.kind != .sync) return;
        job.pending.setProgress(job.gen, count);
    }

    /// The job thread, once the task has returned: nothing else holds it.
    fn release(job: *Job) void {
        const pending = job.pending;
        std.heap.page_allocator.destroy(job);
        // last: once live is back to 0 nothing of this job touches `pending`
        _ = pending.live.fetchSub(1, .acq_rel);
    }
};

/// One finished job, from its thread to the loop. `owned` is the buffer
/// `text` may point into, freed once the answer is written.
const Completion = struct {
    kind: AsyncKind,
    gen: u32,
    text: []const u8,
    owned: ?[]u8 = null,

    fn free(c: Completion) void {
        if (c.owned) |buf| std.heap.page_allocator.free(buf);
    }
};

/// The request a slot is answering: what the loop needs to answer it later.
const AsyncSlot = struct {
    busy: bool = false,
    gen: u32 = 0,
    id_buf: [native_sdk.bridge.max_id_bytes]u8 = undefined,
    id_len: usize = 0,
    responder: AsyncResponder = undefined,

    fn id(self: *const AsyncSlot) []const u8 {
        return self.id_buf[0..self.id_len];
    }
};

/// The spin lock the SDK's own effects queue uses (runtime/effects.zig
/// SpinMutex): Zig 0.16 has no blocking mutex outside Io, and every section
/// under it is a few words of copying — wake_fn runs outside it (post).
const SpinLock = struct {
    inner: std.atomic.Mutex = .unlocked,

    fn lock(self: *SpinLock) void {
        while (!self.inner.tryLock()) std.atomic.spinLoopHint();
    }

    fn unlock(self: *SpinLock) void {
        self.inner.unlock();
    }
};

const Begin = enum { started, busy, failed };

pub const Pending = struct {
    /// a timed-out job stays out until its canceled task has returned (a
    /// syscall Io cannot interrupt, such as a name lookup): this many jobs
    /// at most, counting those, so a network that never answers cannot pile
    /// threads up
    const LIVE_MAX: u32 = 4;
    /// every live job posts at most once
    const QUEUE_MAX: usize = LIVE_MAX;

    // shared with the job threads, under `lock`
    lock: SpinLock = .{},
    closed: bool = false,
    queue: [QUEUE_MAX]Completion = undefined,
    queued: usize = 0,
    wake_ctx: ?*anyopaque = null,
    wake_fn: ?*const fn (context: ?*anyopaque) anyerror!void = null,
    // shared, lock-free
    live: std.atomic.Value(u32) = .init(0),
    /// posts inside wake_fn right now — close() waits these out (bounded)
    waking: std.atomic.Value(u32) = .init(0),
    /// the running sync's generation (high half) and games so far (low half)
    progress: std.atomic.Value(u64) = .init(0),
    // the loop thread's alone
    slots: [2]AsyncSlot = .{ .{}, .{} },
    next_gen: u32 = 1,

    /// The platform's wake service, from the Runtime runner.zig published.
    fn bindWake(self: *Pending, context: ?*anyopaque, wake_fn: ?*const fn (context: ?*anyopaque) anyerror!void) void {
        self.lock.lock();
        defer self.lock.unlock();
        self.wake_ctx = context;
        self.wake_fn = wake_fn;
    }

    /// Loop thread: take `kind`'s slot and start the job, or say why not.
    fn begin(self: *Pending, kind: AsyncKind, id: []const u8, responder: AsyncResponder, spec: JobSpec) Begin {
        const slot = &self.slots[@intFromEnum(kind)];
        if (slot.busy) return .busy;
        if (id.len > slot.id_buf.len) return .failed;
        {
            self.lock.lock();
            defer self.lock.unlock();
            // nothing could ever answer it: no wake, or the app is stopping
            if (self.closed or self.wake_fn == null) return .failed;
        }
        if (self.live.load(.acquire) >= LIVE_MAX) return .busy;
        const job = std.heap.page_allocator.create(Job) catch return .failed;
        const gen = self.next_gen;
        self.next_gen +%= 1;
        if (self.next_gen == 0) self.next_gen = 1;
        job.* = .{ .pending = self, .kind = kind, .gen = gen, .spec = spec };
        if (kind == .sync) self.progress.store(@as(u64, gen) << 32, .release);
        _ = self.live.fetchAdd(1, .acq_rel);
        // the job's thread only waits (the HTTP runs in its Io task), so a
        // small stack does
        const thread = std.Thread.spawn(.{ .stack_size = 256 * 1024 }, jobMain, .{job}) catch {
            job.release();
            return .failed;
        };
        thread.detach();
        @memcpy(slot.id_buf[0..id.len], id);
        slot.id_len = id.len;
        slot.responder = responder;
        slot.gen = gen;
        slot.busy = true;
        return .started;
    }

    /// Any thread: one finished job for the loop. The wake itself runs with
    /// the lock free (8.1 M2 review P3): wake_fn is enqueue-only by contract
    /// (PlatformServices.wake_fn), but drain() takes this lock on the loop
    /// thread, and a wake that ever waited on the loop would then deadlock
    /// it — the SDK's own channel wake (runtime/effects.zig ChannelWake)
    /// makes the same call outside its lock for the same reason. `waking`
    /// is marked under the lock, before `closed` could be set, so close()
    /// can wait out every call already inside wake_fn: the platform it
    /// points into is freed right after the stop hook.
    fn post(self: *Pending, c: Completion) void {
        self.lock.lock();
        if (self.closed or self.queued == QUEUE_MAX) {
            self.lock.unlock();
            c.free();
            return;
        }
        self.queue[self.queued] = c;
        self.queued += 1;
        const wake_fn = self.wake_fn;
        const wake_ctx = self.wake_ctx;
        if (wake_fn != null) _ = self.waking.fetchAdd(1, .acq_rel);
        self.lock.unlock();
        const wake = wake_fn orelse return;
        defer _ = self.waking.fetchSub(1, .acq_rel);
        // a wake that failed leaves the answer on the queue until the next
        // one; say so rather than lose why the page waited (P3)
        wake(wake_ctx) catch |err| std.log.warn("chessboard: wake_fn failed: {s}", .{@errorName(err)});
    }

    /// Loop thread (`.effects_wake`): answer what has finished. A result for
    /// a request already answered — its deadline passed first — is dropped.
    pub fn drain(self: *Pending) void {
        var taken: [QUEUE_MAX]Completion = undefined;
        self.lock.lock();
        const n = self.queued;
        @memcpy(taken[0..n], self.queue[0..n]);
        self.queued = 0;
        self.lock.unlock();
        for (taken[0..n]) |c| {
            defer c.free();
            const slot = &self.slots[@intFromEnum(c.kind)];
            if (!slot.busy or slot.gen != c.gen) continue;
            slot.busy = false;
            respondNow(slot.responder, slot.id(), c.text, failText(c.kind));
        }
    }

    /// Loop thread (the stop hook): stop answering, forget the requests —
    /// their responders belong to a Runtime that is about to go — and drop
    /// what has arrived. Returns at once whatever the workers are doing.
    pub fn close(self: *Pending) void {
        var taken: [QUEUE_MAX]Completion = undefined;
        self.lock.lock();
        self.closed = true;
        const n = self.queued;
        @memcpy(taken[0..n], self.queue[0..n]);
        self.queued = 0;
        self.lock.unlock();
        for (taken[0..n]) |c| c.free();
        for (&self.slots) |*slot| slot.busy = false;
        // no new wake can start now; one already inside wake_fn returns in
        // microseconds (enqueue-only). Bounded all the same, as the SDK's
        // quiesceChannelWake is: a wake that never returns is abandoned
        // rather than allowed to hold the app's exit.
        var spins: u32 = 0;
        while (self.waking.load(.acquire) > 0 and spins < 1_000_000) : (spins += 1) std.atomic.spinLoopHint();
    }

    fn isClosed(self: *Pending) bool {
        self.lock.lock();
        defer self.lock.unlock();
        return self.closed;
    }

    /// Whether a worker is still out — main() then exits without waiting.
    pub fn workersOut(self: *Pending) bool {
        return self.live.load(.acquire) > 0;
    }

    fn setProgress(self: *Pending, gen: u32, count: usize) void {
        const next = (@as(u64, gen) << 32) | @min(count, std.math.maxInt(u32));
        var current = self.progress.load(.acquire);
        // only the sync the page is waiting on: a timed-out one's worker
        // may still be counting
        while (current >> 32 == gen) {
            current = self.progress.cmpxchgWeak(current, next, .acq_rel, .acquire) orelse return;
        }
    }

    /// Loop thread: games in so far for the sync in flight, or null.
    fn syncProgress(self: *Pending) ?u32 {
        const slot = &self.slots[@intFromEnum(AsyncKind.sync)];
        if (!slot.busy) return null;
        const v = self.progress.load(.acquire);
        if (v >> 32 != slot.gen) return 0;
        return @truncate(v);
    }
};

/// The answer as the bridge frames it — built on the heap, not with
/// AsyncResponder.success, which puts a 1 MiB buffer on the stack. When that
/// buffer cannot be had (or the frame will not fit it), `fallback` — a short
/// error the page words — goes instead, from a small buffer here: the slot
/// is already free, and the page must not be left waiting for its backstop
/// (8.1 M2 review P3).
fn respondNow(responder: AsyncResponder, id: []const u8, text: []const u8, fallback: []const u8) void {
    respondWith(std.heap.page_allocator, responder, id, text, fallback);
}

fn respondWith(gpa: std.mem.Allocator, responder: AsyncResponder, id: []const u8, text: []const u8, fallback: []const u8) void {
    // the id is at most 64 bytes, and JSON-escaped at most six times longer
    const room = native_sdk.bridge.max_id_bytes * 6 + 64;
    if (gpa.alloc(u8, text.len + room)) |buf| {
        defer gpa.free(buf);
        const frame = native_sdk.bridge.writeSuccessResponse(buf, id, text);
        if (frame.len > 0) {
            responder.respond(frame) catch {};
            return;
        }
    } else |_| {}
    var small: [room + 64]u8 = undefined;
    const frame = native_sdk.bridge.writeSuccessResponse(&small, id, fallback);
    if (frame.len > 0) responder.respond(frame) catch {};
}

fn failText(kind: AsyncKind) []const u8 {
    return switch (kind) {
        .sync => "{\"error\":\"offline\"}",
        .update => "{\"error\":\"network\"}",
    };
}

/// The job's work, as an Io task: its answer goes on the queue unless the
/// deadline got there first.
fn workTask(job: *Job) void {
    const gpa = std.heap.page_allocator;
    const out: ?[]u8 = gpa.alloc(u8, JOB_OUT_BYTES) catch null;
    const text = if (out) |buf| job.spec.work(job, buf) else failText(job.kind);
    job.done.store(true, .release);
    if (job.claimed.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
        job.pending.post(.{ .kind = job.kind, .gen = job.gen, .text = text, .owned = out });
    } else if (out) |buf| {
        gpa.free(buf);
    }
}

/// The job's own thread: starts the work as an Io task and keeps the
/// deadline. At the deadline the page is told "timeout" and the task is
/// canceled — the blocked read is interrupted (see "async bridge" above) —
/// and this thread waits for it to return before letting the job go, so
/// `live` counts only work that is really still running (P2-1). The same
/// when the app is stopping: nobody is left to tell, and nothing should
/// stay on the network.
fn jobMain(job: *Job) void {
    const io = job.spec.io;
    var task = io.concurrent(workTask, .{job}) catch {
        // no thread for the task: answer rather than leave the page waiting
        if (job.claimed.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
            job.pending.post(.{ .kind = job.kind, .gen = job.gen, .text = failText(job.kind) });
        }
        job.release();
        return;
    };
    var waited: u64 = 0;
    while (!job.done.load(.acquire)) {
        if (waited >= job.spec.deadline_ms) {
            if (job.claimed.cmpxchgStrong(false, true, .acq_rel, .acquire) == null) {
                job.pending.post(.{ .kind = job.kind, .gen = job.gen, .text = "{\"error\":\"timeout\"}" });
            }
            break;
        }
        if (job.pending.isClosed()) break;
        std.Io.sleep(io, std.Io.Duration.fromMilliseconds(WATCH_POLL_MS), .awake) catch {};
        waited += WATCH_POLL_MS;
    }
    if (job.done.load(.acquire)) task.await(io) else task.cancel(io);
    job.release();
}

/// A handler's answer when no job was started.
fn beginAnswer(responder: AsyncResponder, id: []const u8, kind: AsyncKind, began: Begin) void {
    switch (began) {
        .started => {},
        .busy => respondNow(responder, id, "{\"error\":\"busy\"}", failText(kind)),
        .failed => respondNow(responder, id, failText(kind), failText(kind)),
    }
}

fn bindWakeFrom(self: *App) void {
    const rt = self.runtime orelse return;
    const services = rt.options.platform.services;
    self.pending.bindWake(services.context, services.wake_fn);
}

// --------------------------------------------------------- update check (Q1.5)
//
// The minimum viable channel from the plan: ask GitHub for the latest release
// and hand the page its tag and URL. The PAGE compares the tag with its own
// version (app.zon's, which it already shows in About) and decides whether to
// say anything — this side does no comparison and no download, and it runs
// only when the page asks (a "check for updates" action, never at startup on
// its own). The answer is {tag,url} or {error:"network"|"http_NNN"|"parse"|
// "timeout"|"busy"}.
//
// v8-1-plan N1: asynchronous, with its own deadline (UPDATE_DEADLINE_MS);
// host.js still races it, now as a backstop.
const RELEASES_LATEST_URL = "https://api.github.com/repos/hxddh/chessboard/releases/latest";

pub fn checkUpdate(context: *anyopaque, invocation: native_sdk.bridge.Invocation, responder: AsyncResponder) anyerror!void {
    const self: *App = @ptrCast(@alignCast(context));
    const id = invocation.request.id;
    bindWakeFrom(self);
    beginAnswer(responder, id, .update, self.pending.begin(.update, id, responder, .{
        .work = updateWork,
        .deadline_ms = UPDATE_DEADLINE_MS,
        .io = self.io,
    }));
}

fn updateWork(job: *Job, out: []u8) []const u8 {
    const gpa = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = gpa, .io = job.spec.io };
    defer client.deinit();
    var body: std.Io.Writer.Allocating = .init(gpa);
    defer body.deinit();
    // GitHub refuses requests without a User-Agent
    const status = httpGet(&client, RELEASES_LATEST_URL, "application/vnd.github+json", &body, null);
    return updateReply(status, body.written(), out);
}

/// The page's answer for GitHub's: the status first, then the body.
fn updateReply(status: u32, body: []const u8, output: []u8) []const u8 {
    if (status == 0) return "{\"error\":\"network\"}";
    if (status != 200) return std.fmt.bufPrint(output, "{{\"error\":\"http_{d}\"}}", .{status}) catch "{\"error\":\"network\"}";
    return formatLatestRelease(body, output) catch "{\"error\":\"parse\"}";
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

// ------------------------------------------------------------- HTTP GET (N1)

/// A body larger than this is not an answer either site gives for N ≤ 100.
const HTTP_BODY_MAX: usize = 16 * 1024 * 1024;

/// Called as a body grows, with all of it so far (Lichess's game count).
const Tick = struct {
    context: *anyopaque,
    tick_fn: *const fn (context: *anyopaque, written: []const u8) void,
};

/// Where the sync's GETs go: the network, or a test's canned answers.
const Getter = struct {
    context: *anyopaque,
    get_fn: *const fn (context: *anyopaque, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32,

    fn get(self: Getter, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32 {
        return self.get_fn(self.context, url, accept, body, tick);
    }
};

/// One GET into `body`, read as it arrives: the HTTP status, or 0 when
/// nothing came back. std.http.Client.fetch's own steps (Client.zig fetch),
/// with the read in pieces so `tick` can count what is in.
fn httpGet(client: *std.http.Client, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32 {
    const uri = std.Uri.parse(url) catch return 0;
    var req = client.request(.GET, uri, .{
        .keep_alive = false,
        .headers = .{ .user_agent = .{ .override = SYNC_USER_AGENT } },
        .extra_headers = &.{.{ .name = "accept", .value = accept }},
    }) catch return 0;
    defer req.deinit();
    req.sendBodiless() catch return 0;
    var redirect_buffer: [8 * 1024]u8 = undefined;
    var response = req.receiveHead(&redirect_buffer) catch return 0;
    const status: u32 = @intFromEnum(response.head.status);
    const gpa = client.allocator;
    const decompress_buffer: []u8 = switch (response.head.content_encoding) {
        .identity => &.{},
        .zstd => gpa.alloc(u8, std.compress.zstd.default_window_len) catch return 0,
        .deflate, .gzip => gpa.alloc(u8, std.compress.flate.max_window_len) catch return 0,
        .compress => return 0,
    };
    defer if (decompress_buffer.len > 0) gpa.free(decompress_buffer);
    var transfer_buffer: [4096]u8 = undefined;
    var decompress: std.http.Decompress = undefined;
    const reader = response.readerDecompressing(&transfer_buffer, &decompress, decompress_buffer);
    while (body.written().len < HTTP_BODY_MAX) {
        _ = reader.stream(&body.writer, .limited(16 * 1024)) catch |err| switch (err) {
            error.EndOfStream => break,
            else => return 0,
        };
        if (tick) |t| t.tick_fn(t.context, body.written());
    }
    return status;
}

const NetGetter = struct {
    client: *std.http.Client,

    fn getter(self: *NetGetter) Getter {
        return .{ .context = self, .get_fn = get };
    }

    fn get(context: *anyopaque, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32 {
        const self: *NetGetter = @ptrCast(@alignCast(context));
        return httpGet(self.client, url, accept, body, tick);
    }
};

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
// The answer is {"pgn":"…","count":N,"last":ms}: the games as one PGN text,
// whole games only, at most SYNC_ANSWER_MAX bytes, and the time of the newest
// (absent with no games). A first sync's are the newest N, newest first; an
// incremental one's run oldest first (below). Or {"error":code}, code being one the
// page words for the player — offline, rate_limited, not_found, bad_request,
// parse, timeout, busy — or "http" with the "status".
//
// v8-1-plan T4, incremental: the page sends `since`, worked out from its own
// library — the newest game it already has from this site and name, less an
// overlap (sync-ui.js syncSince) — and asks for N plus the games it already
// has in that overlap, which its duplicate check skips. 8.1 M2 review
// P2-2/P2-3: the first cut kept a separate mark (the newest game fetched)
// and asked newest-first for N, which lost games three ways — a
// correspondence game created before the mark but finished after it; more
// than N new games, whose older ones were never asked for again; and games
// fetched but never imported. So an incremental sync now reads oldest first
// from `since`, and whatever cuts it short (N, the answer's size, the
// deadline) leaves no hole behind it: the next sync starts inside the part
// already in the library.
//   - Lichess: since= with sort=dateAsc and max= (the public API's
//     parameters for /api/games/user: `since` is the creation time in ms,
//     `sort` is dateAsc | dateDesc, dateDesc by default). Only games still
//     created before `since` are dropped here (UTCTime is whole seconds).
//   - Chess.com has no such parameters: its archives are months, oldest first
//     in the list. The walk starts one month before the one `since` falls in
//     (an archive's month is not certain to be UTC's — P3), goes forward, and
//     each month's games are read in the order listed; games that ended
//     before `since` are dropped.
//
// Asynchronous since v8-1-plan N1 (see "async bridge" above). Everything but
// the requests themselves is a function the tests below run on canned
// answers, the requests included — through a Getter.

const SYNC_GAMES_DEFAULT: usize = 20;
/// T4: the dialog offers 20 / 50 / 100 new games; an incremental sync also
/// asks again for the games in its overlap that the library already has, at
/// most 50 of them (sync-ui.js OVERLAP_GAMES).
const SYNC_GAMES_MAX: usize = 150;
/// Lichess names are 2–30 characters and Chess.com's 3–25, both of
/// [A-Za-z0-9_-] — so a name is also safe in a URL path as it stands.
const SYNC_NAME_MIN: usize = 2;
const SYNC_NAME_MAX: usize = 30;
/// A full piece's base64 is what the frame is proven to carry (see the test).
const SYNC_ANSWER_MAX: usize = WRITE_B64_MAX;
/// Chess.com files games by month: this many months back, at most, to find N
/// on a first sync…
const SYNC_MONTHS_MAX: usize = 3;
/// …and on a later one, the months from the one before `since`, oldest first
/// (a player back after years gets the oldest N of these 24; the next sync
/// goes on from there — not 30 requests' worth past the deadline).
const SYNC_MONTHS_SINCE_MAX: usize = 24;
const SYNC_USER_AGENT = "chessboard (+https://github.com/hxddh/chessboard)";

const SyncSite = enum { lichess, chesscom };

const SyncRequest = struct {
    site: SyncSite,
    name_buf: [SYNC_NAME_MAX]u8 = undefined,
    name_len: usize = 0,
    max: usize = SYNC_GAMES_DEFAULT,
    /// ms since the epoch; games from before it are not wanted (0: all)
    since: u64 = 0,

    fn user(self: *const SyncRequest) []const u8 {
        return self.name_buf[0..self.name_len];
    }
};

/// A millisecond timestamp field: jsonUintField stops at 12 digits, a
/// timestamp has 13.
fn jsonMsField(payload: []const u8, key: []const u8) ?u64 {
    const start = jsonFieldValue(payload, key) orelse return null;
    var i = start;
    while (i < payload.len and std.ascii.isDigit(payload[i])) : (i += 1) {}
    if (i == start or i - start > 15) return null;
    return std.fmt.parseInt(u64, payload[start..i], 10) catch null;
}

/// {site, user, max, since} from the page, or null when any of it is not usable.
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
    if (jsonMsField(payload, "since")) |s| req.since = s;
    return req;
}

/// Standard chess only (the perf types are Lichess's names for its speeds;
/// a variant would not replay in the library), with the clock comments B5's
/// time-pressure figure reads, and no engine evaluations. `since` (T4) is
/// Lichess's own parameter — games created at or after it — and with it the
/// games come oldest first (sort=dateAsc), so `max` cuts off the newest
/// rather than the ones right after `since` (review P2-3).
fn lichessUrl(buf: []u8, name: []const u8, max: usize, since: u64) ?[]const u8 {
    const base = std.fmt.bufPrint(buf, "https://lichess.org/api/games/user/{s}?max={d}&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false", .{ name, max }) catch return null;
    if (since == 0) return base;
    const tail = std.fmt.bufPrint(buf[base.len..], "&since={d}&sort=dateAsc", .{since}) catch return null;
    return buf[0 .. base.len + tail.len];
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

// ---- times (T4): a game's, and a month's --------------------------------

/// Days from 1970-01-01 to a proleptic Gregorian date (days_from_civil,
/// H. Hinnant) — std.time.epoch goes the other way only.
fn daysFromCivil(year: i64, month: u32, day: u32) i64 {
    const y = if (month <= 2) year - 1 else year;
    const era = @divFloor(y, 400);
    const yoe = y - era * 400;
    const mp: i64 = @intCast((month + 9) % 12);
    const doy = @divFloor(153 * mp + 2, 5) + @as(i64, day) - 1;
    const doe = yoe * 365 + @divFloor(yoe, 4) - @divFloor(yoe, 100) + doy;
    return era * 146097 + doe - 719468;
}

/// A tag's value from a game's header (the lines before its first blank one).
fn pgnTag(game: []const u8, comptime name: []const u8) ?[]const u8 {
    const key = "[" ++ name ++ " \"";
    const head = game[0..(std.mem.indexOf(u8, game, "\n\n") orelse game.len)];
    var from: usize = 0;
    while (std.mem.indexOfPos(u8, head, from, key)) |at| {
        if (at == 0 or head[at - 1] == '\n') {
            const start = at + key.len;
            const end = std.mem.indexOfScalarPos(u8, head, start, '"') orelse return null;
            return head[start..end];
        }
        from = at + 1;
    }
    return null;
}

fn digits(s: []const u8) ?u32 {
    return std.fmt.parseInt(u32, s, 10) catch null;
}

/// When a Lichess game started, from its UTCDate / UTCTime tags, in ms — the
/// clock Lichess's since= reads (createdAt), to the second.
fn pgnUtcMs(game: []const u8) ?u64 {
    const date = pgnTag(game, "UTCDate") orelse return null;
    const time = pgnTag(game, "UTCTime") orelse return null;
    if (date.len != 10 or date[4] != '.' or date[7] != '.') return null;
    if (time.len != 8 or time[2] != ':' or time[5] != ':') return null;
    const y = digits(date[0..4]) orelse return null;
    const mo = digits(date[5..7]) orelse return null;
    const d = digits(date[8..10]) orelse return null;
    const h = digits(time[0..2]) orelse return null;
    const mi = digits(time[3..5]) orelse return null;
    const s = digits(time[6..8]) orelse return null;
    if (y < 1970 or mo < 1 or mo > 12 or d < 1 or d > 31 or h > 23 or mi > 59 or s > 60) return null;
    const days = daysFromCivil(y, mo, d);
    const secs: u64 = @as(u64, @intCast(days)) * 86400 + @as(u64, h) * 3600 + @as(u64, mi) * 60 + s;
    return secs * 1000;
}

/// Months since year 0 — comparable across years — for a ms timestamp.
fn monthOfMs(ms: u64) u32 {
    const es: std.time.epoch.EpochSeconds = .{ .secs = ms / 1000 };
    const yd = es.getEpochDay().calculateYearDay();
    const md = yd.calculateMonthDay();
    return @as(u32, yd.year) * 12 + (@as(u32, md.month.numeric()) - 1);
}

/// The month a Chess.com archive URL is for (…/games/YYYY/MM), or null.
fn archiveMonth(url: []const u8) ?u32 {
    if (url.len < 8) return null;
    const tail = url[url.len - 8 ..];
    if (tail[0] != '/' or tail[5] != '/') return null;
    const y = digits(tail[1..5]) orelse return null;
    const m = digits(tail[6..8]) orelse return null;
    if (m < 1 or m > 12) return null;
    return y * 12 + (m - 1);
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

/// The answer as it is written: {"pgn":"<game>\n\n<game>…","count":N}, and
/// ,"last":ms when a game's time was known. The first game that does not fit
/// ends it, so what goes out is always a run of the order the games came in:
/// the newest N on a first sync, and on an incremental one (oldest first) a
/// run from `since` with no hole in it.
const SyncAnswer = struct {
    out: []u8,
    n: usize = 0,
    count: usize = 0,
    max: usize,
    full: bool = false,
    /// the newest kept game's time, ms (0: none known)
    last: u64 = 0,

    const HEAD = "{\"pgn\":\"";
    /// `","count":` and the number, `,"last":` and a timestamp, and `}`
    const TAIL_MAX: usize = 48;

    fn init(output: []u8, max: usize) SyncAnswer {
        var a: SyncAnswer = .{ .out = output[0..@min(output.len, SYNC_ANSWER_MAX)], .max = max };
        if (!jsonAppend(a.out, &a.n, HEAD)) a.full = true;
        return a;
    }

    fn done(self: *const SyncAnswer) bool {
        return self.full or self.count >= self.max;
    }

    /// One game's PGN text; skipped when blank, refused whole when too big.
    /// true when it went in.
    fn add(self: *SyncAnswer, game: []const u8) bool {
        if (self.done()) return false;
        const pgn = std.mem.trim(u8, game, " \t\r\n");
        if (pgn.len == 0) return false;
        const sep: []const u8 = if (self.count > 0) "\\n\\n" else "";
        if (self.n + sep.len + jsonEscapedLen(pgn) + TAIL_MAX > self.out.len) {
            self.full = true;
            return false;
        }
        @memcpy(self.out[self.n..][0..sep.len], sep);
        self.n += sep.len;
        jsonEscapeInto(self.out, &self.n, pgn);
        self.count += 1;
        return true;
    }

    fn noteTime(self: *SyncAnswer, ms: u64) void {
        self.last = @max(self.last, ms);
    }

    fn finish(self: *SyncAnswer) anyerror![]const u8 {
        const tail = if (self.last > 0)
            std.fmt.bufPrint(self.out[self.n..], "\",\"count\":{d},\"last\":{d}}}", .{ self.count, self.last }) catch return error.HandlerFailed
        else
            std.fmt.bufPrint(self.out[self.n..], "\",\"count\":{d}}}", .{self.count}) catch return error.HandlerFailed;
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

/// Lichess answers with the games as one PGN text — newest first, or oldest
/// first with a `since` (sort=dateAsc). A game that started before `since`
/// is not wanted (T4).
fn lichessAnswer(body: []const u8, max: usize, since: u64, output: []u8) anyerror![]const u8 {
    var answer = SyncAnswer.init(output, max);
    var at = pgnGameStart(body, 0);
    while (at) |start| {
        const next = pgnGameStart(body, start + 1);
        const game = body[start..(next orelse body.len)];
        const ms = pgnUtcMs(game);
        const known = if (ms) |t| since > 0 and t < since else false;
        if (!known and answer.add(game)) {
            if (ms) |t| answer.noteTime(t);
        }
        if (answer.done()) break;
        at = next;
    }
    return answer.finish();
}

/// What the page gets for Lichess's answer: the status decides first. A
/// missing player is a 404 with Lichess's HTML error page as the body
/// (src/sync-fixtures/lichess-missing.body), which read as PGN would be
/// "no games" rather than "no such user".
fn lichessReply(status: u32, body: []const u8, max: usize, since: u64, output: []u8) anyerror![]const u8 {
    if (syncStatusError(status)) |code| return syncErrorAnswer(output, code, status);
    return lichessAnswer(body, max, since, output);
}

/// T4 progress for Lichess: its answer is a stream of PGN, and each game
/// that has begun arriving is counted as the bytes come in.
const GameCounter = struct {
    job: ?*Job,
    max: usize,
    from: usize = 0,
    count: usize = 0,

    fn tick(self: *GameCounter) Tick {
        return .{ .context = self, .tick_fn = onBytes };
    }

    fn onBytes(context: *anyopaque, written: []const u8) void {
        const self: *GameCounter = @ptrCast(@alignCast(context));
        const before = self.count;
        while (pgnGameStart(written, self.from)) |at| {
            self.count += 1;
            self.from = at + 1;
        }
        if (self.count != before) if (self.job) |job| job.report(@min(self.count, self.max));
    }
};

const ChesscomArchives = struct { archives: []const []const u8 };
const ChesscomGame = struct { pgn: []const u8 = "", rules: []const u8 = "chess", end_time: u64 = 0 };
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

/// One month's games into the answer: newest first on a first sync (the
/// month lists them oldest first), in the listed order on an incremental one
/// (`since` > 0, review P2-3). Other rules — Chess960, bughouse… — are
/// skipped: the library replays standard chess. So is a game that ended
/// before `since` (T4). false when the body is not a month.
fn chesscomMonth(arena: std.mem.Allocator, body: []const u8, since: u64, answer: *SyncAnswer) bool {
    const parsed = std.json.parseFromSliceLeaky(ChesscomMonth, arena, body, .{ .ignore_unknown_fields = true }) catch return false;
    const n = parsed.games.len;
    var k: usize = 0;
    while (k < n and !answer.done()) : (k += 1) {
        const g = parsed.games[if (since > 0) k else n - 1 - k];
        if (!std.mem.eql(u8, g.rules, "chess")) continue;
        const ended = g.end_time *| 1000;
        if (since > 0 and ended < since) continue;
        if (answer.add(g.pgn) and g.end_time > 0) answer.noteTime(ended);
    }
    return true;
}

/// A whole sync: every request through `getter`, in the order the tests
/// below read back. `job` (null in tests) hears the progress.
fn syncFetch(gpa: std.mem.Allocator, getter: Getter, req: SyncRequest, output: []u8, job: ?*Job) anyerror![]const u8 {
    var url_buf: [640]u8 = undefined;
    switch (req.site) {
        .lichess => {
            const url = lichessUrl(&url_buf, req.user(), req.max, req.since) orelse return syncErrorAnswer(output, "bad_request", 0);
            var body: std.Io.Writer.Allocating = .init(gpa);
            defer body.deinit();
            var counter: GameCounter = .{ .job = job, .max = req.max };
            const status = getter.get(url, "application/x-chess-pgn", &body, counter.tick());
            return lichessReply(status, body.written(), req.max, req.since, output);
        },
        .chesscom => {
            var arena_state = std.heap.ArenaAllocator.init(gpa);
            defer arena_state.deinit();
            const arena = arena_state.allocator();
            const url = chesscomArchivesUrl(&url_buf, req.user()) orelse return syncErrorAnswer(output, "bad_request", 0);
            var list_body: std.Io.Writer.Allocating = .init(gpa);
            defer list_body.deinit();
            const status = getter.get(url, "application/json", &list_body, null);
            const months = switch (try chesscomList(arena, status, list_body.written(), output)) {
                .months => |m| m,
                .reply => |r| return r,
            };
            var answer = SyncAnswer.init(output, req.max);
            // a first sync walks back from the newest month; an incremental
            // one forward, from the month before `since`'s (review P2-3, P3)
            var at: usize = months.len;
            if (req.since > 0) {
                const from = monthOfMs(req.since) -| 1;
                at = 0;
                while (at < months.len) : (at += 1) {
                    if (archiveMonth(months[at])) |m| if (m >= from) break;
                }
            }
            const months_max = if (req.since > 0) SYNC_MONTHS_SINCE_MAX else SYNC_MONTHS_MAX;
            var walked: usize = 0;
            while (walked < months_max and !answer.done()) : (walked += 1) {
                const i = if (req.since > 0) at + walked else months.len -% (walked + 1);
                if (i >= months.len) break;
                var month_body: std.Io.Writer.Allocating = .init(gpa);
                defer month_body.deinit();
                const month_status = getter.get(months[i], "application/json", &month_body, null);
                // games already in hand are worth more than an error about the rest
                if (syncStatusError(month_status)) |code| {
                    if (answer.count > 0) break;
                    return syncErrorAnswer(output, code, month_status);
                }
                if (!chesscomMonth(arena, month_body.written(), req.since, &answer)) {
                    if (answer.count > 0) break;
                    return syncErrorAnswer(output, "parse", 0);
                }
                // T4 progress: Chess.com's is month by month
                if (job) |j| j.report(answer.count);
            }
            return answer.finish();
        },
    }
}

fn syncWork(job: *Job, out: []u8) []const u8 {
    const gpa = std.heap.page_allocator;
    var client: std.http.Client = .{ .allocator = gpa, .io = job.spec.io };
    defer client.deinit();
    var net: NetGetter = .{ .client = &client };
    var rebased: RebaseGetter = .{ .inner = net.getter(), .base = job.spec.sync_base };
    return syncFetch(gpa, rebased.getter(), job.spec.sync.?, out, job) catch failText(.sync);
}

// v8-2-plan V1 step 2: the automation build's scenarios sync against a fake
// server on the runner (scripts/fake-sync-server.mjs), never the two sites.
// CHESS_SYNC_BASE names it, and only a self-test launch reads the variable:
// a release build launched by a person has CHESS_SELFTEST unset, so its
// syncs go where they always went. Everything above — the URLs, the
// archive-list check that keeps Chess.com's months under its own API path —
// is unchanged; only the host of the request that goes out is swapped.

/// The sites' URL prefixes a base stands in for (lichessUrl, chesscomArchivesUrl).
const SYNC_HOSTS = [_][]const u8{ "https://lichess.org/", "https://api.chess.com/" };

/// CHESS_SYNC_BASE, when this is a self-test launch and it is a loopback
/// http:// origin ("http://127.0.0.1:<port>", no path); "" otherwise.
fn syncBaseOf(env: *const std.process.Environ.Map, selftest: bool) []const u8 {
    if (!selftest) return "";
    const v = env.get("CHESS_SYNC_BASE") orelse return "";
    const head = "http://127.0.0.1:";
    if (!std.mem.startsWith(u8, v, head) or v.len == head.len or v.len > head.len + 5) return "";
    for (v[head.len..]) |c| if (!std.ascii.isDigit(c)) return "";
    return v;
}

pub fn syncBase(self: *const App) []const u8 {
    return syncBaseOf(self.env_map, selftestOn(self));
}

/// `url` with its site's prefix replaced by `base` (the path and query kept),
/// or null when it is not one of the two sites' or does not fit.
fn rebaseUrl(buf: []u8, base: []const u8, url: []const u8) ?[]const u8 {
    for (SYNC_HOSTS) |host| {
        if (!std.mem.startsWith(u8, url, host)) continue;
        const rest = url[host.len - 1 ..];
        if (base.len + rest.len > buf.len) return null;
        @memcpy(buf[0..base.len], base);
        @memcpy(buf[base.len..][0..rest.len], rest);
        return buf[0 .. base.len + rest.len];
    }
    return null;
}

/// The getter a sync uses: `inner` as it is with no base; with one, every
/// URL rebased first, and one that cannot be is not asked at all (0, offline).
const RebaseGetter = struct {
    inner: Getter,
    base: []const u8,

    fn getter(self: *RebaseGetter) Getter {
        return if (self.base.len == 0) self.inner else .{ .context = self, .get_fn = get };
    }

    fn get(context: *anyopaque, url: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32 {
        const self: *RebaseGetter = @ptrCast(@alignCast(context));
        var buf: [768]u8 = undefined;
        const local = rebaseUrl(&buf, self.base, url) orelse return 0;
        return self.inner.get(local, accept, body, tick);
    }
};

pub fn fetchGames(context: *anyopaque, invocation: native_sdk.bridge.Invocation, responder: AsyncResponder) anyerror!void {
    const self: *App = @ptrCast(@alignCast(context));
    const id = invocation.request.id;
    const req = syncRequest(invocation.request.payload) orelse return respondNow(responder, id, "{\"error\":\"bad_request\"}", "{\"error\":\"bad_request\"}");
    bindWakeFrom(self);
    beginAnswer(responder, id, .sync, self.pending.begin(.sync, id, responder, .{
        .work = syncWork,
        .deadline_ms = SYNC_DEADLINE_MS,
        .io = self.io,
        .sync = req,
        .sync_base = syncBase(self),
    }));
}

/// T4: 已取到 k 局 — the page asks while its sync is out. {"busy":false}
/// when none is.
pub fn fetchProgress(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    _ = invocation;
    const count = self.pending.syncProgress() orelse return std.fmt.bufPrint(output, "{{\"busy\":false,\"count\":0}}", .{}) catch return error.HandlerFailed;
    return std.fmt.bufPrint(output, "{{\"busy\":true,\"count\":{d}}}", .{count}) catch return error.HandlerFailed;
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
const SyncAnswerJson = struct { pgn: []const u8, count: usize, last: u64 = 0 };

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
        lichessUrl(&buf, "Sync_Tester", 20, 0).?,
    );
    try std.testing.expectEqualStrings("https://api.chess.com/pub/player/sync_tester/games/archives", chesscomArchivesUrl(&buf, "Sync_Tester").?);
    var tiny: [16]u8 = undefined;
    try std.testing.expect(chesscomArchivesUrl(&tiny, "sync_tester") == null);
    try std.testing.expect(lichessUrl(&tiny, "sync_tester", 20, 0) == null);
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
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessAnswer(LICHESS_SAMPLE, 20, 0, &out), .{});
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
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessAnswer(LICHESS_SAMPLE, 2, 0, &out), .{});
        try std.testing.expectEqual(@as(usize, 2), parsed.count);
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "Rated bullet game") == null);
    }
    // a player with no games: an empty text, not an error
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer("", 20, 0, &out));
}

test "Lichess: a game that does not fit is dropped whole, with everything older" {
    const body = "[Event \"a\"]\n\n1. e4 *\n\n\n[Event \"b\"]\n\n1. d4 *\n";
    const first = "[Event \"a\"]\n\n1. e4 *";
    var buf: [256]u8 = undefined;
    const room = SyncAnswer.HEAD.len + jsonEscapedLen(first) + SyncAnswer.TAIL_MAX;
    try std.testing.expectEqualStrings("{\"pgn\":\"[Event \\\"a\\\"]\\n\\n1. e4 *\",\"count\":1}", try lichessAnswer(body, 20, 0, buf[0..room]));
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer(body, 20, 0, buf[0 .. room - 1]));
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
    try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_SAMPLE, 0, &answer));
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
    try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_SAMPLE, 0, &one));
    try std.testing.expectEqual(@as(usize, 1), one.count);
    try std.testing.expect(one.done());
    var other = SyncAnswer.init(&out, 20);
    try std.testing.expect(!chesscomMonth(arena, CHESSCOM_ARCHIVES_SAMPLE, 0, &other));
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
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_REAL, 20, 0, out), .{});
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
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_REAL, 2, 0, out), .{});
        try std.testing.expectEqual(@as(usize, 2), parsed.count);
        try std.testing.expect(std.mem.endsWith(u8, parsed.pgn, "b5 { [%clk 0:05:08] } 1-0"));
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "CzvAH3q1") == null);
    }
}

test "real Lichess 404: its HTML page means no such user, not an empty list" {
    var out: [256]u8 = undefined;
    try std.testing.expect(std.mem.startsWith(u8, LICHESS_MISSING_REAL, "<!DOCTYPE html>"));
    try std.testing.expectEqualStrings("{\"error\":\"not_found\"}", try lichessReply(404, LICHESS_MISSING_REAL, 20, 0, &out));
    // what the status going first saves the player from: the page read as PGN is "no games yet"
    try std.testing.expectEqualStrings("{\"pgn\":\"\",\"count\":0}", try lichessAnswer(LICHESS_MISSING_REAL, 20, 0, &out));
}

// v8-2-plan V2: an incremental sync's own request, from the 2026-09-30 run
// (max=20, since= the run's clock less 30 days, sort=dateAsc). The log does
// not print that since; the Fetch step began at 17:26:54 and the answer is
// dated 17:27:01, so it was 2026-08-31T17:26:54Z at the earliest.
const LICHESS_SINCE_REAL = @embedFile("sync-fixtures/lichess-since.body");
const LICHESS_SINCE_REAL_SENT: u64 = 1788197214000;

test "real Lichess since= answer: twenty games oldest first, none before since (sort=dateAsc holds)" {
    // what T4's incremental sync relies on (v8-1-plan M2 review P2-2): the
    // site's own order, game by game, by the UTCDate / UTCTime lichessAnswer reads
    var n: usize = 0;
    var prev: u64 = 0;
    var at = pgnGameStart(LICHESS_SINCE_REAL, 0);
    while (at) |start| {
        const next = pgnGameStart(LICHESS_SINCE_REAL, start + 1);
        const ms = pgnUtcMs(LICHESS_SINCE_REAL[start..(next orelse LICHESS_SINCE_REAL.len)]) orelse return error.TestUnexpectedResult;
        try std.testing.expect(ms > prev);
        try std.testing.expect(ms >= LICHESS_SINCE_REAL_SENT);
        prev = ms;
        n += 1;
        at = next;
    }
    try std.testing.expectEqual(@as(usize, 20), n);
    // 2026-09-12T20:30:55Z, the newest
    try std.testing.expectEqual(@as(u64, 1789245055000), prev);

    var arena_state = std.heap.ArenaAllocator.init(std.testing.allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const out = try std.testing.allocator.alloc(u8, SYNC_ANSWER_MAX);
    defer std.testing.allocator.free(out);
    {
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_SINCE_REAL, 20, LICHESS_SINCE_REAL_SENT, out), .{});
        try std.testing.expectEqual(@as(usize, 20), parsed.count);
        const pgn = parsed.pgn;
        try std.testing.expectEqual(@as(usize, 20), std.mem.count(u8, pgn, "[Event "));
        try std.testing.expectEqual(@as(usize, 19), std.mem.count(u8, pgn, "\n\n[Event "));
        try std.testing.expectEqual(std.mem.trim(u8, LICHESS_SINCE_REAL, "\n").len - 19, pgn.len);
        // kept in the order sent: oldest first
        try std.testing.expect(std.mem.startsWith(u8, pgn, "[Event \"rated blitz game\"]\n[Site \"https://lichess.org/68JlUEbt\"]\n"));
        try std.testing.expect(inOrder(pgn, &.{ "/68JlUEbt\"]", "/HD6DflBP\"]", "/U5LXU7K3\"]", "/6j7UgDOl\"]", "/z4UTxoYO\"]" }));
        try std.testing.expect(std.mem.endsWith(u8, pgn, "68. Qh8# { [%clk 0:00:03] } 1-0"));
        try std.testing.expectEqual(@as(u64, 1789245055000), parsed.last);
    }
    {
        // N cuts off the newest: the five from since, the next sync goes on from them
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_SINCE_REAL, 5, LICHESS_SINCE_REAL_SENT, out), .{});
        try std.testing.expectEqual(@as(usize, 5), parsed.count);
        try std.testing.expect(std.mem.endsWith(u8, parsed.pgn, "31. Nxe7 { [%clk 0:03:31] } 1-0"));
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "jsAg36KZ") == null);
        // 2026-09-12T14:56:12Z, HD6DflBP
        try std.testing.expectEqual(@as(u64, 1789224972000), parsed.last);
    }
    {
        // a later since (U5LXU7K3's second) leaves out the six before it
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try lichessReply(200, LICHESS_SINCE_REAL, 20, 1789229851000, out), .{});
        try std.testing.expectEqual(@as(usize, 14), parsed.count);
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "/U5LXU7K3\"]") != null);
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "/jsAg36KZ\"]") == null);
    }
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
        try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_REAL, 0, &answer));
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
        try std.testing.expect(chesscomMonth(arena, CHESSCOM_MONTH_REAL, 0, &one));
        try std.testing.expectEqual(@as(usize, 1), one.count);
        const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try one.finish(), .{});
        try std.testing.expect(std.mem.indexOf(u8, parsed.pgn, "/daily/1029050366\"]") != null);
    }
}

// ---- v8-1-plan N1: the async path, with a stand-in for the platform --------
//
// The Pending queue is driven the way the runtime drives it: begin() from the
// handler, drain() from `.effects_wake`, close() from the stop hook. The wake
// is counted instead of posted, and the job's work waits on a gate the test
// opens, so "still on the network" is a state the test can hold.

const TestWake = struct {
    count: std.atomic.Value(u32) = .init(0),

    fn wake(context: ?*anyopaque) anyerror!void {
        const self: *TestWake = @ptrCast(@alignCast(context.?));
        _ = self.count.fetchAdd(1, .acq_rel);
    }
};

/// What the SDK's AsyncResponder would have handed the page.
const TestAnswers = struct {
    frames: [8][512]u8 = undefined,
    lens: [8]usize = .{0} ** 8,
    n: usize = 0,

    fn respond(context: *anyopaque, source: native_sdk.bridge.Source, response: []const u8) anyerror!void {
        _ = source;
        const self: *TestAnswers = @ptrCast(@alignCast(context));
        const len = @min(response.len, 512);
        @memcpy(self.frames[self.n][0..len], response[0..len]);
        self.lens[self.n] = len;
        self.n += 1;
    }

    fn responder(self: *TestAnswers) AsyncResponder {
        return .{ .context = self, .source = .{}, .respond_fn = respond };
    }

    fn frame(self: *const TestAnswers, i: usize) []const u8 {
        return self.frames[i][0..self.lens[i]];
    }
};

const TestGate = struct {
    open: std.atomic.Value(bool) = .init(false),
    /// games to report before waiting (fetchProgress)
    games: usize = 0,
};

/// A job that holds until the test opens its gate.
fn gatedWork(job: *Job, out: []u8) []const u8 {
    const gate: *TestGate = @ptrCast(@alignCast(job.spec.test_ctx.?));
    if (gate.games > 0) job.report(gate.games);
    while (!gate.open.load(.acquire)) std.Io.sleep(job.spec.io, std.Io.Duration.fromMilliseconds(1), .awake) catch {};
    return std.fmt.bufPrint(out, "{{\"done\":{d}}}", .{job.gen}) catch "{}";
}

fn gatedSpec(gate: *TestGate, deadline_ms: u64) JobSpec {
    return .{ .work = gatedWork, .deadline_ms = deadline_ms, .io = std.testing.io, .test_ctx = gate };
}

/// Wait, bounded, for the job threads — they run on their own time.
fn waitUntil(comptime cond: anytype, args: anytype) !void {
    var tries: usize = 0;
    while (!@call(.auto, cond, args)) : (tries += 1) {
        if (tries > 10_000) return error.TestTimedOut;
        std.Io.sleep(std.testing.io, std.Io.Duration.fromMilliseconds(1), .awake) catch {};
    }
}

fn wokenAtLeast(w: *TestWake, n: u32) bool {
    return w.count.load(.acquire) >= n;
}

fn allBack(p: *Pending) bool {
    return !p.workersOut();
}

fn progressIs(p: *Pending, n: u32) bool {
    return (p.syncProgress() orelse return false) == n;
}

fn has(hay: []const u8, needle: []const u8) bool {
    return std.mem.indexOf(u8, hay, needle) != null;
}

test "N1: one sync and one update check at a time; a third concurrent request is refused" {
    var wake: TestWake = .{};
    var p: Pending = .{};
    p.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    var gate: TestGate = .{};
    try std.testing.expectEqual(Begin.started, p.begin(.sync, "1", answers.responder(), gatedSpec(&gate, 60_000)));
    try std.testing.expectEqual(Begin.started, p.begin(.update, "2", answers.responder(), gatedSpec(&gate, 60_000)));
    // the third, of either kind, while the two run
    try std.testing.expectEqual(Begin.busy, p.begin(.sync, "3", answers.responder(), gatedSpec(&gate, 60_000)));
    try std.testing.expectEqual(Begin.busy, p.begin(.update, "4", answers.responder(), gatedSpec(&gate, 60_000)));
    // …is answered at once, and the two running are not disturbed
    beginAnswer(answers.responder(), "3", .sync, .busy);
    try std.testing.expectEqual(@as(usize, 1), answers.n);
    try std.testing.expect(has(answers.frame(0), "{\"id\":\"3\",\"ok\":true,\"result\":{\"error\":\"busy\"}}"));
    try std.testing.expect(p.slots[0].busy and p.slots[1].busy);
    gate.open.store(true, .release);
    try waitUntil(allBack, .{&p});
    try std.testing.expectEqual(@as(u32, 2), wake.count.load(.acquire));
    p.drain();
    try std.testing.expectEqual(@as(usize, 3), answers.n);
    // each to its own id, in whichever order the two finished
    const a = answers.frame(1);
    const b = answers.frame(2);
    const id1 = "\"id\":\"1\",\"ok\":true,\"result\":{\"done\":";
    const id2 = "\"id\":\"2\",\"ok\":true,\"result\":{\"done\":";
    try std.testing.expect((has(a, id1) and has(b, id2)) or (has(a, id2) and has(b, id1)));
    // both slots free again
    try std.testing.expectEqual(Begin.started, p.begin(.sync, "5", answers.responder(), gatedSpec(&gate, 60_000)));
    try waitUntil(allBack, .{&p});
    p.drain();
    try std.testing.expectEqual(@as(usize, 4), answers.n);
}

test "N1: a worker's result is answered after its wake, on the loop — never by the worker" {
    var wake: TestWake = .{};
    var p: Pending = .{};
    p.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    var gate: TestGate = .{};
    try std.testing.expectEqual(Begin.started, p.begin(.sync, "7", answers.responder(), gatedSpec(&gate, 60_000)));
    try std.testing.expectEqual(@as(u32, 0), wake.count.load(.acquire));
    gate.open.store(true, .release);
    try waitUntil(wokenAtLeast, .{ &wake, 1 });
    try waitUntil(allBack, .{&p});
    // done and woken, and still nothing has gone to the page
    try std.testing.expectEqual(@as(usize, 0), answers.n);
    try std.testing.expect(p.slots[0].busy);
    p.drain();
    try std.testing.expectEqual(@as(usize, 1), answers.n);
    try std.testing.expect(has(answers.frame(0), "{\"id\":\"7\",\"ok\":true,\"result\":{\"done\":"));
    // answered once: another wake finds nothing
    p.drain();
    try std.testing.expectEqual(@as(usize, 1), answers.n);
    // no wake service, no job: nothing could ever answer it
    var bare: Pending = .{};
    try std.testing.expectEqual(Begin.failed, bare.begin(.sync, "8", answers.responder(), gatedSpec(&gate, 60_000)));
}

test "N1: the deadline answers timeout by itself, frees the slot, and drops the late result" {
    var wake: TestWake = .{};
    var p: Pending = .{};
    p.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    var gate: TestGate = .{};
    try std.testing.expectEqual(Begin.started, p.begin(.update, "1", answers.responder(), gatedSpec(&gate, 30)));
    try waitUntil(wokenAtLeast, .{ &wake, 1 });
    p.drain();
    try std.testing.expectEqual(@as(usize, 1), answers.n);
    try std.testing.expect(has(answers.frame(0), "{\"id\":\"1\",\"ok\":true,\"result\":{\"error\":\"timeout\"}}"));
    // its worker is still out, and a retry may start beside it
    try std.testing.expect(p.workersOut());
    try std.testing.expectEqual(Begin.started, p.begin(.update, "2", answers.responder(), gatedSpec(&gate, 60_000)));
    gate.open.store(true, .release);
    try waitUntil(allBack, .{&p});
    p.drain();
    try std.testing.expectEqual(@as(usize, 2), answers.n);
    try std.testing.expect(has(answers.frame(1), "\"id\":\"2\",\"ok\":true,\"result\":{\"done\":"));
    // the first worker's own answer never went anywhere: two wakes, not three
    try std.testing.expectEqual(@as(u32, 2), wake.count.load(.acquire));
}

test "N1: stopping with a request out neither waits for it nor wakes the platform after" {
    var wake: TestWake = .{};
    var p: Pending = .{};
    p.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    var gate: TestGate = .{};
    try std.testing.expectEqual(Begin.started, p.begin(.sync, "1", answers.responder(), gatedSpec(&gate, 60_000)));
    // the stop hook returns with the worker still held at its gate…
    p.close();
    // …and main() sees it and leaves with std.process.exit instead of
    // returning into std.start's wait for the Io's threads
    try std.testing.expect(p.workersOut());
    try std.testing.expect(!p.slots[0].busy);
    try std.testing.expectEqual(Begin.failed, p.begin(.update, "2", answers.responder(), gatedSpec(&gate, 60_000)));
    const woke = wake.count.load(.acquire);
    gate.open.store(true, .release);
    try waitUntil(allBack, .{&p});
    // it finished after the stop: no wake (the platform is gone), no answer
    try std.testing.expectEqual(woke, wake.count.load(.acquire));
    p.drain();
    try std.testing.expectEqual(@as(usize, 0), answers.n);
}

/// A server that answers every connection with a head and the first bytes of
/// a body it never finishes, and holds the connection open: a stalled read.
const StallServer = struct {
    const CONNS = Pending.LIVE_MAX + 1;
    server: std.Io.net.Server,
    held: [CONNS]?std.Io.net.Stream = .{null} ** CONNS,
    accepted: std.atomic.Value(u32) = .init(0),
    url_buf: [64]u8 = undefined,
    url_len: usize = 0,

    fn url(self: *const StallServer) []const u8 {
        return self.url_buf[0..self.url_len];
    }

    fn serve(self: *StallServer) void {
        const io = std.testing.io;
        for (&self.held) |*slot| {
            const stream = self.server.accept(io) catch return;
            slot.* = stream;
            var buf: [256]u8 = undefined;
            var w = stream.writer(io, &buf);
            w.interface.writeAll("HTTP/1.1 200 OK\r\nContent-Type: application/x-chess-pgn\r\nContent-Length: 100000\r\n\r\n[Event \"x\"]\n") catch {};
            w.interface.flush() catch {};
            _ = self.accepted.fetchAdd(1, .acq_rel);
        }
    }
};

fn stallWork(job: *Job, out: []u8) []const u8 {
    const stall: *StallServer = @ptrCast(@alignCast(job.spec.test_ctx.?));
    var client: std.http.Client = .{ .allocator = std.heap.page_allocator, .io = job.spec.io };
    defer client.deinit();
    var body: std.Io.Writer.Allocating = .init(std.heap.page_allocator);
    defer body.deinit();
    const status = httpGet(&client, stall.url(), "application/x-chess-pgn", &body, null);
    return std.fmt.bufPrint(out, "{{\"status\":{d}}}", .{status}) catch "{}";
}

fn liveIs(p: *Pending, n: u32) bool {
    return p.live.load(.acquire) == n;
}

test "N1 (review P2-1): at the deadline a stalled read is canceled, its job ends, and the next sync is not busy" {
    const io = std.testing.io;
    const addr = try std.Io.net.IpAddress.parseIp4("127.0.0.1", 0);
    var stall: StallServer = .{ .server = try addr.listen(io, .{ .reuse_address = true }) };
    defer stall.server.deinit(io);
    defer for (stall.held) |s| if (s) |stream| stream.close(io);
    stall.url_len = (try std.fmt.bufPrint(&stall.url_buf, "http://127.0.0.1:{d}/stall", .{stall.server.socket.address.getPort()})).len;
    const server_thread = try std.Thread.spawn(.{}, StallServer.serve, .{&stall});
    defer {
        // the server's last accept is still waiting: one more connection
        // lets its thread finish (the held streams are closed after)
        if (stall.server.socket.address.connect(io, .{ .mode = .stream })) |last| last.close(io) else |_| {}
        server_thread.join();
    }

    var wake: TestWake = .{};
    var p: Pending = .{};
    p.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    const spec: JobSpec = .{ .work = stallWork, .deadline_ms = 200, .io = io, .test_ctx = &stall };
    // as many stalled syncs as may ever be out at once, one after another
    var i: u32 = 0;
    while (i < Pending.LIVE_MAX) : (i += 1) {
        try std.testing.expectEqual(Begin.started, p.begin(.sync, "s", answers.responder(), spec));
        try waitUntil(wokenAtLeast, .{ &wake, i + 1 });
        p.drain();
        try std.testing.expect(has(answers.frame(i), "\"result\":{\"error\":\"timeout\"}"));
    }
    // every one of them really reached the server and stalled there
    try std.testing.expectEqual(Pending.LIVE_MAX, stall.accepted.load(.acquire));
    // the canceled reads return: nothing is left out (waitUntil gives up
    // after ~10 s; before the fix the four stayed out for good)
    try waitUntil(liveIs, .{ &p, 0 });
    // and the next sync starts rather than answering busy
    var gate: TestGate = .{ .open = .init(true) };
    try std.testing.expectEqual(Begin.started, p.begin(.sync, "n", answers.responder(), gatedSpec(&gate, 60_000)));
    try waitUntil(allBack, .{&p});
    p.drain();
    try std.testing.expect(has(answers.frame(Pending.LIVE_MAX), "{\"id\":\"n\",\"ok\":true,\"result\":{\"done\":"));
}

test "N1 (review P3): an answer whose buffer cannot be had still answers, with the short error" {
    var answers: TestAnswers = .{};
    var failing = std.testing.FailingAllocator.init(std.testing.allocator, .{ .fail_index = 0 });
    respondWith(failing.allocator(), answers.responder(), "9", "{\"pgn\":\"…\",\"count\":1}", failText(.sync));
    try std.testing.expectEqual(@as(usize, 1), answers.n);
    try std.testing.expect(has(answers.frame(0), "{\"id\":\"9\",\"ok\":true,\"result\":{\"error\":\"offline\"}}"));
    // with the buffer, the answer itself
    respondWith(std.testing.allocator, answers.responder(), "10", "{\"count\":1}", failText(.sync));
    try std.testing.expect(has(answers.frame(1), "{\"id\":\"10\",\"ok\":true,\"result\":{\"count\":1}}"));
}

test "T4: chess.fetchProgress reads the running sync's count, and nothing once it is answered" {
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = std.testing.io };
    var wake: TestWake = .{};
    app_state.pending.bindWake(&wake, TestWake.wake);
    var answers: TestAnswers = .{};
    var gate: TestGate = .{ .games = 3 };
    var out: [128]u8 = undefined;
    const ask: native_sdk.bridge.Invocation = .{ .request = .{ .id = "p", .command = "chess.fetchProgress" }, .source = .{} };
    try std.testing.expectEqualStrings("{\"busy\":false,\"count\":0}", try fetchProgress(&app_state, ask, &out));
    try std.testing.expectEqual(Begin.started, app_state.pending.begin(.sync, "1", answers.responder(), gatedSpec(&gate, 60_000)));
    try waitUntil(progressIs, .{ &app_state.pending, 3 });
    try std.testing.expectEqualStrings("{\"busy\":true,\"count\":3}", try fetchProgress(&app_state, ask, &out));
    gate.open.store(true, .release);
    try waitUntil(allBack, .{&app_state.pending});
    app_state.pending.drain();
    try std.testing.expectEqualStrings("{\"busy\":false,\"count\":0}", try fetchProgress(&app_state, ask, &out));
    // an update check is not a sync: it reports nothing
    try std.testing.expectEqual(Begin.started, app_state.pending.begin(.update, "2", answers.responder(), gatedSpec(&gate, 60_000)));
    try std.testing.expectEqualStrings("{\"busy\":false,\"count\":0}", try fetchProgress(&app_state, ask, &out));
    try waitUntil(allBack, .{&app_state.pending});
    app_state.pending.drain();
}

test "N1: the update check's answer — status first, then the body" {
    var out: [256]u8 = undefined;
    try std.testing.expectEqualStrings("{\"error\":\"network\"}", updateReply(0, "", &out));
    try std.testing.expectEqualStrings("{\"error\":\"http_403\"}", updateReply(403, "{}", &out));
    try std.testing.expectEqualStrings("{\"error\":\"parse\"}", updateReply(200, "<html>", &out));
    try std.testing.expectEqualStrings(
        "{\"tag\":\"v8.1.0\",\"url\":\"https://github.com/hxddh/chessboard/releases/tag/v8.1.0\"}",
        updateReply(200, "{\"tag_name\":\"v8.1.0\",\"html_url\":\"https://github.com/hxddh/chessboard/releases/tag/v8.1.0\"}", &out),
    );
}

// ---- v8-1-plan T4: incremental sync, with every request read back ----------

/// Canned answers by exact URL, and the URLs asked, in order. Bodies go out
/// in 1000-byte pieces, the way a stream arrives.
const StubGetter = struct {
    const Route = struct { url: []const u8, status: u32 = 200, body: []const u8 };
    routes: []const Route = &.{},
    asked_buf: [8][256]u8 = undefined,
    asked_len: [8]usize = .{0} ** 8,
    asked: usize = 0,
    /// the progress seen after each piece (a change is recorded once)
    pending: ?*Pending = null,
    seen: [16]u32 = undefined,
    seen_n: usize = 0,

    fn getter(self: *StubGetter) Getter {
        return .{ .context = self, .get_fn = get };
    }

    fn url(self: *const StubGetter, i: usize) []const u8 {
        return self.asked_buf[i][0..self.asked_len[i]];
    }

    fn get(context: *anyopaque, url_: []const u8, accept: []const u8, body: *std.Io.Writer.Allocating, tick: ?Tick) u32 {
        _ = accept;
        const self: *StubGetter = @ptrCast(@alignCast(context));
        @memcpy(self.asked_buf[self.asked][0..url_.len], url_);
        self.asked_len[self.asked] = url_.len;
        self.asked += 1;
        for (self.routes) |r| {
            if (!std.mem.eql(u8, r.url, url_)) continue;
            var at: usize = 0;
            while (at < r.body.len) {
                const end = @min(at + 1000, r.body.len);
                body.writer.writeAll(r.body[at..end]) catch return 0;
                at = end;
                if (tick) |t| t.tick_fn(t.context, body.written());
                self.note();
            }
            return r.status;
        }
        return 404;
    }

    fn note(self: *StubGetter) void {
        const p = self.pending orelse return;
        const n: u32 = @truncate(p.progress.load(.acquire));
        if (self.seen_n > 0 and self.seen[self.seen_n - 1] == n) return;
        if (self.seen_n == self.seen.len) return;
        self.seen[self.seen_n] = n;
        self.seen_n += 1;
    }
};

const LICHESS_URL_THIBAULT = "https://lichess.org/api/games/user/thibault?max=20&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false";

/// A game thibault played after the fixture was fetched.
const LICHESS_NEW_GAME =
    \\[Event "rated blitz game"]
    \\[Site "https://lichess.org/NewGame1"]
    \\[Date "2026.09.29"]
    \\[White "thibault"]
    \\[Black "newer_opp"]
    \\[Result "1-0"]
    \\[UTCDate "2026.09.29"]
    \\[UTCTime "08:00:00"]
    \\[Variant "Standard"]
    \\
    \\1. e4 { [%clk 0:03:00] } 1... e5 { [%clk 0:03:00] } 2. Qh5 { [%clk 0:03:01] } 2... Nc6 { [%clk 0:02:59] } 3. Bc4 { [%clk 0:03:00] } 3... Nf6 { [%clk 0:02:57] } 4. Qxf7# { [%clk 0:03:00] } 1-0
    \\
    \\
    \\
;

fn syncOnce(getter: Getter, payload: []const u8, out: []u8, job: ?*Job) ![]const u8 {
    return syncFetch(std.testing.allocator, getter, syncRequest(payload).?, out, job);
}

test "T4: times — a PGN's UTC tags, a month, an archive's month" {
    try std.testing.expectEqual(@as(i64, 0), daysFromCivil(1970, 1, 1));
    try std.testing.expectEqual(@as(i64, 11017), daysFromCivil(2000, 3, 1));
    try std.testing.expectEqual(@as(i64, 20724), daysFromCivil(2026, 9, 28));
    // the real fixture's newest game: 2026.09.28 17:52:38 UTC
    try std.testing.expectEqual(@as(?u64, 1790617958000), pgnUtcMs(LICHESS_REAL));
    try std.testing.expectEqual(@as(?u64, 1790668800000), pgnUtcMs(LICHESS_NEW_GAME));
    try std.testing.expect(pgnUtcMs("[Event \"x\"]\n[UTCDate \"2026.13.01\"]\n[UTCTime \"00:00:00\"]\n\n1. e4 *") == null);
    try std.testing.expect(pgnUtcMs("[Event \"x\"]\n\n1. e4 { [UTCDate \"2026.09.01\"] } *") == null);
    try std.testing.expectEqual(@as(u32, 2026 * 12 + 8), monthOfMs(1790355872000));
    try std.testing.expectEqual(@as(u32, 2026 * 12 + 0), monthOfMs(1767225600000)); // 2026-01-01T00:00:00Z
    try std.testing.expectEqual(@as(?u32, 2026 * 12 + 8), archiveMonth("https://api.chess.com/pub/player/erik/games/2026/09"));
    try std.testing.expectEqual(@as(?u32, 2007 * 12 + 6), archiveMonth("https://api.chess.com/pub/player/erik/games/2007/07"));
    try std.testing.expect(archiveMonth("https://api.chess.com/pub/player/erik/games/archives") == null);
    // the request carries the timestamp whole (13 digits), and N up to 100
    const r = syncRequest("{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":100,\"since\":1790617958001}").?;
    try std.testing.expectEqual(@as(u64, 1790617958001), r.since);
    try std.testing.expectEqual(@as(usize, 100), r.max);
    try std.testing.expectEqual(@as(u64, 0), syncRequest("{\"site\":\"lichess\",\"user\":\"thibault\"}").?.since);
}

/// A correspondence game thibault started before the fixture's games and
/// finished after them — what a mark on the newest game fetched never asked
/// for again (review P2-2).
const LICHESS_CORR_GAME =
    \\[Event "rated correspondence game"]
    \\[Site "https://lichess.org/CorrGam1"]
    \\[Date "2026.09.20"]
    \\[White "corr_opp"]
    \\[Black "thibault"]
    \\[Result "0-1"]
    \\[UTCDate "2026.09.20"]
    \\[UTCTime "09:00:00"]
    \\[Variant "Standard"]
    \\
    \\1. f3 e5 2. g4 Qh4# 0-1
    \\
    \\
    \\
;

/// The fixture's games oldest first, as Lichess sends them with sort=dateAsc.
fn oldestFirst(alloc: std.mem.Allocator, body: []const u8) ![]u8 {
    var starts: [16]usize = undefined;
    var n: usize = 0;
    var at = pgnGameStart(body, 0);
    while (at) |s| : (at = pgnGameStart(body, s + 1)) {
        starts[n] = s;
        n += 1;
    }
    var out: std.ArrayList(u8) = .empty;
    errdefer out.deinit(alloc);
    var i = n;
    while (i > 0) {
        i -= 1;
        const end = if (i + 1 < n) starts[i + 1] else body.len;
        try out.appendSlice(alloc, body[starts[i]..end]);
    }
    return out.toOwnedSlice(alloc);
}

/// The request an incremental sync sends: `since` is the newest game the
/// library has (the fixture's, 2026.09.28) at the start of its day, less
/// sync-ui.js's 14-day overlap; `max` is N plus the 5 games the library
/// already has in that overlap.
const LICHESS_SINCE = "1789344000000";
const LICHESS_URL_SINCE = "https://lichess.org/api/games/user/thibault?max=25&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false&since=" ++ LICHESS_SINCE ++ "&sort=dateAsc";

test "T4 (review P2-2/P2-3): Lichess, an incremental sync asks oldest first from the library's overlap and misses nothing" {
    const alloc = std.testing.allocator;
    const out = try alloc.alloc(u8, SYNC_ANSWER_MAX);
    defer alloc.free(out);
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    // 2026-09-28T00:00Z less 14 days, as sync-ui.js syncSince works it out
    try std.testing.expectEqual(@as(i64, 1789344000000), (daysFromCivil(2026, 9, 28) - 14) * 86_400_000);
    // the site's answer to the second request: oldest first, the known five
    // back again, a correspondence game begun before them and finished since,
    // and a newer one
    const asc = try oldestFirst(alloc, LICHESS_REAL);
    defer alloc.free(asc);
    const second_body = try std.mem.concat(alloc, u8, &.{ LICHESS_CORR_GAME, asc, LICHESS_NEW_GAME });
    defer alloc.free(second_body);
    var stub: StubGetter = .{ .routes = &.{
        .{ .url = LICHESS_URL_THIBAULT, .body = LICHESS_REAL },
        .{ .url = LICHESS_URL_SINCE, .body = second_body },
    } };
    const first = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":20}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 5), first.count);
    const second = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":25,\"since\":" ++ LICHESS_SINCE ++ "}", out, null), .{});
    // all seven, oldest first: the library's duplicate check skips the five
    try std.testing.expectEqual(@as(usize, 7), second.count);
    try std.testing.expect(inOrder(second.pgn, &.{ "CorrGam1", "ISnAuvzx", "JNUpaHZT", "NewGame1" }));
    try std.testing.expectEqual(@as(u64, 1790668800000), second.last);
    // exactly these requests, in this order
    try std.testing.expectEqual(@as(usize, 2), stub.asked);
    try std.testing.expectEqualStrings(LICHESS_URL_THIBAULT, stub.url(0));
    try std.testing.expectEqualStrings(LICHESS_URL_SINCE, stub.url(1));
    // more new games than asked for: the oldest go, the newest wait for the
    // next sync — which starts inside what this one brought, so no hole
    var stub2: StubGetter = .{ .routes = &.{.{
        .url = "https://lichess.org/api/games/user/thibault?max=2&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false&since=" ++ LICHESS_SINCE ++ "&sort=dateAsc",
        .body = second_body,
    }} };
    const cut = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub2.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":2,\"since\":" ++ LICHESS_SINCE ++ "}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 2), cut.count);
    try std.testing.expect(has(cut.pgn, "CorrGam1") and has(cut.pgn, "ISnAuvzx") and !has(cut.pgn, "NewGame1"));
    // a game still created before `since` is not passed on (the site's
    // since= reads ms, and a caller's `since` may fall inside a second)
    var stub4: StubGetter = .{ .routes = &.{.{ .url = "https://lichess.org/api/games/user/thibault?max=25&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false&since=1790617958001&sort=dateAsc", .body = second_body }} };
    const newer = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub4.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":25,\"since\":1790617958001}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 1), newer.count);
    try std.testing.expect(has(newer.pgn, "NewGame1"));
}

test "T4 (review P2-2/P2-3): Chess.com, an incremental sync walks forward from the month before `since`, oldest first" {
    const alloc = std.testing.allocator;
    const out = try alloc.alloc(u8, SYNC_ANSWER_MAX);
    defer alloc.free(out);
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    // the month as it reads a day later: one more standard game, and a newer
    // Chess960 one that must still stay out
    const close_at = std.mem.lastIndexOf(u8, CHESSCOM_MONTH_REAL, "]}").?;
    const later = try std.mem.concat(alloc, u8, &.{
        CHESSCOM_MONTH_REAL[0..close_at],
        ",{\"url\":\"https://www.chess.com/game/live/9001\",\"pgn\":\"[Event \\\"Live Chess\\\"]\\n[Site \\\"Chess.com\\\"]\\n[White \\\"erik\\\"]\\n[Black \\\"newer_opp\\\"]\\n[Result \\\"1-0\\\"]\\n\\n1. e4 e5 2. Qh5 Nc6 3. Bc4 Nf6 4. Qxf7# 1-0\\n\",\"end_time\":1790668800,\"rules\":\"chess\"}",
        ",{\"url\":\"https://www.chess.com/game/daily/9002\",\"pgn\":\"[Event \\\"Let's Play! - Chess960\\\"]\\n[Result \\\"0-1\\\"]\\n\\n1. e4 e5 0-1\\n\",\"end_time\":1790668900,\"rules\":\"chess960\"}",
        CHESSCOM_MONTH_REAL[close_at..],
    });
    defer alloc.free(later);
    const base = "https://api.chess.com/pub/player/erik/games/";
    // a game filed under August that ended 100 s into September UTC (an
    // archive's month is not certain to be UTC's): the walk starts a month
    // early. The other one ended in August and stays out.
    const august = "{\"games\":[{\"url\":\"https://www.chess.com/game/live/8001\",\"pgn\":\"[Event \\\"Live Chess\\\"]\\n[Site \\\"Chess.com\\\"]\\n[White \\\"aug_opp\\\"]\\n[Black \\\"erik\\\"]\\n[Result \\\"0-1\\\"]\\n\\n1. f3 e5 2. g4 Qh4# 0-1\\n\",\"end_time\":1788220900,\"rules\":\"chess\"},{\"url\":\"https://www.chess.com/game/live/8000\",\"pgn\":\"[Event \\\"Live Chess\\\"]\\n[White \\\"old_opp\\\"]\\n[Black \\\"erik\\\"]\\n[Result \\\"0-1\\\"]\\n\\n1. f3 e5 2. g4 Qh4# 0-1\\n\",\"end_time\":1786000000,\"rules\":\"chess\"}]}";
    var stub: StubGetter = .{ .routes = &.{
        .{ .url = base ++ "archives", .body = CHESSCOM_ARCHIVES_REAL },
        .{ .url = base ++ "2026/09", .body = CHESSCOM_MONTH_REAL },
        .{ .url = base ++ "2026/08", .body = "{\"games\":[]}" },
        .{ .url = base ++ "2026/07", .body = "{\"games\":[]}" },
    } };
    const first = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub.getter(), "{\"site\":\"chesscom\",\"user\":\"Erik\",\"max\":20}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 9), first.count);
    // the newest standard game's end (the two Chess960 games after it are not the mark)
    try std.testing.expectEqual(@as(u64, 1790355872000), first.last);
    // a first sync: the last three months, newest first
    try std.testing.expectEqual(@as(usize, 4), stub.asked);
    stub.routes = &.{
        .{ .url = base ++ "archives", .body = CHESSCOM_ARCHIVES_REAL },
        .{ .url = base ++ "2026/08", .body = august },
        .{ .url = base ++ "2026/09", .body = later },
    };
    // the library's newest game began 2026.09.15; less 14 days: 2026-09-01
    // (sync-ui.js syncSince), with the 9 it has asked for again
    const since_ms: u64 = @intCast((daysFromCivil(2026, 9, 15) - 14) * 86_400_000);
    try std.testing.expectEqual(@as(u64, 1788220800000), since_ms);
    var payload_buf: [128]u8 = undefined;
    const payload = try std.fmt.bufPrint(&payload_buf, "{{\"site\":\"chesscom\",\"user\":\"Erik\",\"max\":29,\"since\":{d}}}", .{since_ms});
    const second = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub.getter(), payload, out, null), .{});
    // the August game, the nine the library has, the new one — oldest first,
    // and still no Chess960
    try std.testing.expectEqual(@as(usize, 11), second.count);
    try std.testing.expect(inOrder(second.pgn, &.{ "aug_opp", "newer_opp" }));
    try std.testing.expect(!has(second.pgn, "old_opp") and !has(second.pgn, "Chess960"));
    try std.testing.expectEqual(@as(u64, 1790668800000), second.last);
    // every request of both syncs, in order: the second walks forward from
    // the month before `since`'s
    const want = [_][]const u8{ base ++ "archives", base ++ "2026/09", base ++ "2026/08", base ++ "2026/07", base ++ "archives", base ++ "2026/08", base ++ "2026/09" };
    try std.testing.expectEqual(want.len, stub.asked);
    for (want, 0..) |w, i| try std.testing.expectEqualStrings(w, stub.url(i));
    // more new games than asked for: the oldest go first
    var stub2: StubGetter = .{ .routes = &.{
        .{ .url = base ++ "archives", .body = CHESSCOM_ARCHIVES_REAL },
        .{ .url = base ++ "2026/08", .body = august },
        .{ .url = base ++ "2026/09", .body = later },
    } };
    const payload2 = try std.fmt.bufPrint(&payload_buf, "{{\"site\":\"chesscom\",\"user\":\"Erik\",\"max\":2,\"since\":{d}}}", .{since_ms});
    const cut = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(stub2.getter(), payload2, out, null), .{});
    try std.testing.expectEqual(@as(usize, 2), cut.count);
    try std.testing.expect(has(cut.pgn, "aug_opp") and !has(cut.pgn, "newer_opp"));
}

test "T4: progress — Lichess counts games as the stream arrives, Chess.com month by month" {
    const alloc = std.testing.allocator;
    const out = try alloc.alloc(u8, SYNC_ANSWER_MAX);
    defer alloc.free(out);
    var p: Pending = .{};
    var job: Job = .{ .pending = &p, .kind = .sync, .gen = 7, .spec = undefined };
    p.progress.store(@as(u64, 7) << 32, .release);
    var stub: StubGetter = .{ .pending = &p, .routes = &.{
        .{ .url = LICHESS_URL_THIBAULT, .body = LICHESS_REAL },
        .{ .url = "https://lichess.org/api/games/user/thibault?max=2&perfType=ultraBullet,bullet,blitz,rapid,classical,correspondence&clocks=true&evals=false&opening=false", .body = LICHESS_REAL },
    } };
    _ = try syncOnce(stub.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":20}", out, &job);
    // one step per game, while the body was still coming in
    try std.testing.expectEqualSlices(u32, &.{ 1, 2, 3, 4, 5 }, stub.seen[0..stub.seen_n]);
    // never past N
    p.progress.store(@as(u64, 7) << 32, .release);
    stub.seen_n = 0;
    _ = try syncOnce(stub.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":2}", out, &job);
    try std.testing.expectEqual(@as(u32, 2), @as(u32, @truncate(p.progress.load(.acquire))));
    // Chess.com: after each month
    const base = "https://api.chess.com/pub/player/erik/games/";
    p.progress.store(@as(u64, 7) << 32, .release);
    var cc: StubGetter = .{ .routes = &.{
        .{ .url = base ++ "archives", .body = CHESSCOM_ARCHIVES_REAL },
        .{ .url = base ++ "2026/09", .body = CHESSCOM_MONTH_REAL },
    } };
    _ = try syncOnce(cc.getter(), "{\"site\":\"chesscom\",\"user\":\"erik\",\"max\":20}", out, &job);
    try std.testing.expectEqual(@as(u32, 9), @as(u32, @truncate(p.progress.load(.acquire))));
    // a timed-out sync's worker, still counting, does not move a newer one's
    p.progress.store(@as(u64, 8) << 32, .release);
    job.report(4);
    try std.testing.expectEqual(@as(u64, 8) << 32, p.progress.load(.acquire));
}

test "V1 seams: a base replaces only the site's host; anything else is not asked" {
    var buf: [256]u8 = undefined;
    const base = "http://127.0.0.1:9";
    try std.testing.expectEqualStrings(base ++ LICHESS_URL_THIBAULT["https://lichess.org".len..], rebaseUrl(&buf, base, LICHESS_URL_THIBAULT).?);
    try std.testing.expectEqualStrings(base ++ "/pub/player/erik/games/2026/09", rebaseUrl(&buf, base, "https://api.chess.com/pub/player/erik/games/2026/09").?);
    try std.testing.expect(rebaseUrl(&buf, base, "https://example.com/api/games/user/x") == null);
    try std.testing.expect(rebaseUrl(&buf, base, "https://lichess.org.example.com/x") == null);
    var small: [24]u8 = undefined;
    try std.testing.expect(rebaseUrl(&small, base, LICHESS_URL_THIBAULT) == null);
}

test "V1 seams: a sync through a base asks the same paths there, and without one is unchanged" {
    const alloc = std.testing.allocator;
    const out = try alloc.alloc(u8, SYNC_ANSWER_MAX);
    defer alloc.free(out);
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const local = "http://127.0.0.1:9";
    const months = local ++ "/pub/player/erik/games/";
    var stub: StubGetter = .{ .routes = &.{
        .{ .url = local ++ LICHESS_URL_THIBAULT["https://lichess.org".len..], .body = LICHESS_REAL },
        .{ .url = months ++ "archives", .body = CHESSCOM_ARCHIVES_REAL },
        .{ .url = months ++ "2026/09", .body = CHESSCOM_MONTH_REAL },
    } };
    var rebased: RebaseGetter = .{ .inner = stub.getter(), .base = local };
    const li = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(rebased.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":20}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 5), li.count);
    // Chess.com's archive list still names api.chess.com (the check that
    // keeps a month under its API path is untouched); each month is rebased
    const cc = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena, try syncOnce(rebased.getter(), "{\"site\":\"chesscom\",\"user\":\"erik\",\"max\":20}", out, null), .{});
    try std.testing.expectEqual(@as(usize, 9), cc.count);
    try std.testing.expect(!has(cc.pgn, "Chess960"));
    // Lichess; then the archive list, September (9 games), August (none here: a 404 after games ends the walk)
    try std.testing.expectEqual(@as(usize, 4), stub.asked);
    for (0..stub.asked) |i| try std.testing.expect(std.mem.startsWith(u8, stub.url(i), local ++ "/"));
    // no base: the getter is the inner one itself, the sites' URLs as before
    var plain: RebaseGetter = .{ .inner = stub.getter(), .base = "" };
    try std.testing.expectEqual(stub.getter().context, plain.getter().context);
    try std.testing.expectEqual(stub.getter().get_fn, plain.getter().get_fn);
}

/// One HTTP/1.1 exchange on 127.0.0.1: the request line it was sent, and
/// `body` back with a Content-Length — the shape of the CI fake server's
/// answer (scripts/fake-sync-server.mjs), over a real socket.
const OneShotServer = struct {
    server: std.Io.net.Server,
    body: []const u8,
    line_buf: [512]u8 = undefined,
    line_len: usize = 0,

    fn serve(self: *OneShotServer) void {
        const io = std.testing.io;
        const stream = self.server.accept(io) catch return;
        defer stream.close(io);
        var rbuf: [4096]u8 = undefined;
        var r = stream.reader(io, &rbuf);
        var first = true;
        while (true) {
            const line = r.interface.takeDelimiterExclusive('\n') catch return;
            r.interface.toss(1);
            const l = std.mem.trimEnd(u8, line, "\r");
            if (first) {
                const n = @min(l.len, self.line_buf.len);
                @memcpy(self.line_buf[0..n], l[0..n]);
                self.line_len = n;
                first = false;
            }
            if (l.len == 0) break;
        }
        var wbuf: [1024]u8 = undefined;
        var w = stream.writer(io, &wbuf);
        w.interface.print("HTTP/1.1 200 OK\r\nContent-Type: application/x-chess-pgn\r\nContent-Length: {d}\r\nConnection: close\r\n\r\n", .{self.body.len}) catch return;
        w.interface.writeAll(self.body) catch return;
        w.interface.flush() catch {};
    }
};

test "V1 seams: a rebased sync goes over plain http to the loopback server and reads its games" {
    const io = std.testing.io;
    const addr = try std.Io.net.IpAddress.parseIp4("127.0.0.1", 0);
    var one: OneShotServer = .{ .server = try addr.listen(io, .{ .reuse_address = true }), .body = LICHESS_REAL };
    defer one.server.deinit(io);
    const thread = try std.Thread.spawn(.{}, OneShotServer.serve, .{&one});
    var base_buf: [32]u8 = undefined;
    const base = try std.fmt.bufPrint(&base_buf, "http://127.0.0.1:{d}", .{one.server.socket.address.getPort()});
    const alloc = std.testing.allocator;
    const out = try alloc.alloc(u8, SYNC_ANSWER_MAX);
    defer alloc.free(out);
    var client: std.http.Client = .{ .allocator = alloc, .io = io };
    defer client.deinit();
    var net: NetGetter = .{ .client = &client };
    var rebased: RebaseGetter = .{ .inner = net.getter(), .base = base };
    const answer = try syncOnce(rebased.getter(), "{\"site\":\"lichess\",\"user\":\"thibault\",\"max\":20}", out, null);
    thread.join();
    var arena_state = std.heap.ArenaAllocator.init(alloc);
    defer arena_state.deinit();
    const parsed = try std.json.parseFromSliceLeaky(SyncAnswerJson, arena_state.allocator(), answer, .{});
    try std.testing.expectEqual(@as(usize, 5), parsed.count);
    try std.testing.expectEqualStrings("GET " ++ LICHESS_URL_THIBAULT["https://lichess.org".len..] ++ " HTTP/1.1", one.line_buf[0..one.line_len]);
}
