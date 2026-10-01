//! The app's bridge: the chess.* command table and the SDK commands it
//! grants, the chunked transfer every file command uses, the issued-path
//! trust model (drops and OS-opened files), the appdata store and the
//! packaged self-test. Moved verbatim out of main.zig (v8-2-plan F2).

const std = @import("std");
const builtin = @import("builtin");
const native_sdk = @import("native_sdk");

const openPgn = @import("dialogs.zig").openPgn;
const saveText = @import("dialogs.zig").saveText;
const App = @import("main.zig").App;
const setMenuLanguage = @import("menus.zig").setMenuLanguage;
const checkUpdate = @import("sync.zig").checkUpdate;
const fetchGames = @import("sync.zig").fetchGames;
const fetchProgress = @import("sync.zig").fetchProgress;

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
pub const BUILTIN_COMMANDS = [_][]const u8{
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
/// v8-1-plan N1: the SDK's asynchronous handler (bridge.AsyncHandler, SDK
/// 0.10.1 src/bridge/root.zig) — it is handed an AsyncResponder instead of an
/// output buffer, and answers whenever it likes.
const AsyncInvokeFn = @FieldType(native_sdk.bridge.AsyncHandler, "invoke_fn");

/// Exactly one of the two is set (a test below holds that).
const AppCommand = struct {
    name: []const u8,
    invoke_fn: ?InvokeFn = null,
    async_fn: ?AsyncInvokeFn = null,
};

/// The app's own bridge commands (host.js: `zero.invoke("chess.X", …)`).
///
/// One table feeds both the handler registry and the per-command origin
/// policy, so a command can never be registered without a policy (which the
/// SDK answers with permission_denied) or the other way round.
/// scripts/manifest-check.mjs (section 6) holds this list to host.js the same
/// way BUILTIN_COMMANDS is held: every `chess.X` the page invokes is here, and
/// nothing is here the page never invokes.
///
/// chess.issuePath is gone (v8-1-plan N2): it let the page ask the native side
/// to trust a path the page named — the widest door from the page to the file
/// system — and since the dialogs run here nothing needs it. It is not kept
/// "for older pages" either: the page is always the frontend bundled into
/// this same binary, so no older page can reach this shell.
///
/// v8-1-plan N1: chess.checkUpdate and chess.fetchGames are asynchronous —
/// the network runs on a thread of its own and the answer comes back through
/// the loop (see "async bridge" in sync.zig), so the page's Promise is unchanged
/// while the shell's thread stays free. chess.fetchProgress is how the sync
/// dialog reads 已取到 k 局 meanwhile.
pub const APP_COMMANDS = [_]AppCommand{
    .{ .name = "chess.writeTextFile", .invoke_fn = writeTextFile },
    .{ .name = "chess.readTextFile", .invoke_fn = readTextFile },
    .{ .name = "chess.openPgn", .invoke_fn = openPgn },
    .{ .name = "chess.saveText", .invoke_fn = saveText },
    .{ .name = "chess.appdataRead", .invoke_fn = appdataRead },
    .{ .name = "chess.appdataWrite", .invoke_fn = appdataWrite },
    .{ .name = "chess.appdataPath", .invoke_fn = appdataPath },
    .{ .name = "chess.setMenuLanguage", .invoke_fn = setMenuLanguage },
    .{ .name = "chess.checkUpdate", .async_fn = checkUpdate },
    .{ .name = "chess.fetchGames", .async_fn = fetchGames },
    .{ .name = "chess.fetchProgress", .invoke_fn = fetchProgress },
    .{ .name = "chess.selftestMode", .invoke_fn = selftestMode },
    .{ .name = "chess.selftestReport", .invoke_fn = selftestReport },
};

/// The platform path separator, as the strings this file builds need it.
pub const SEP: []const u8 = if (builtin.os.tag == .windows) "\\" else "/";

/// Q1.1 — the one-document user-data file 6.x–7.x mirrored into. Since
/// v8-0-plan F3 the page reads it only to migrate from, and mirrors into the
/// per-key store instead: `<appdata>/store/<key>.json`, one file per profile
/// key plus the page's manifest. Both kinds share the sidecars below.
pub const APPDATA_FILE = "chessboard.json";
pub const STORE_DIR = "store";
/// The sidecars the atomic write leaves next to a data file.
const TMP_SUFFIX = ".tmp";
const BAK_SUFFIX = ".bak";
/// Q1.6 — the UI language the page last chose, read once at launch to pick
/// the menu set (see setMenuLanguage for why it is a file and not a call).
pub const LANG_FILE = "lang";

// -------------------------------------------------------------- drop:files
//
// v8-0-plan F3 (§6). The SDK hands a drop to the app as Event.files_dropped
// BEFORE it emits "drop:files" to the page (runtime flow.zig: dispatchEvent,
// then emitFileDropEvent), so the paths are issued here, on the native side's
// own word, never on the page's. They get the pathAllowed rule — a drop is
// the player's choice, but no wider than a dialog's. The file dialogs run
// here too since v8-1-plan N2 (chess.openPgn / chess.saveText, with the
// Runtime runner.zig hands over), and chess.issuePath, the page's old way of
// asking for either, is gone.
//
// Probed by name at comptime like OPEN_FILE_VARIANTS: an SDK without the
// variant compiles this to nothing, and a drop is then simply not issued.
pub fn issueDroppedPaths(self: *App, event: native_sdk.Event) void {
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

pub fn forwardOpenFiles(self: *App, runtime: *native_sdk.Runtime, event: native_sdk.Event) void {
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

pub fn jsonAppend(buf: []u8, n: *usize, s: []const u8) bool {
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
pub const BRIDGE_FRAME_MAX: usize = 1024 * 1024;
pub const CHUNK_BYTES: usize = 512 * 1024;
/// base64 of one full chunk, padding included: the most a write piece carries.
pub const WRITE_B64_MAX: usize = (CHUNK_BYTES + 2) / 3 * 4;
/// The largest file a read or a write carries, and the largest appdata file.
pub const FILE_MAX_BYTES: usize = 16 * 1024 * 1024;
/// M5 review P2-3: the largest file a player picked (an issued path) may be.
/// 导出全部数据 carries every library shard: an analysed 80-ply game is
/// ~2.6 KB of JSON, 10,000 of them (library.js MAX_GAMES) ~28 MB escaped into
/// the export, which 16 MiB stopped at ~5,500. Twice that with the other keys.
/// The appdata files stay at FILE_MAX_BYTES: a shard is 1/64 of the library.
pub const USER_FILE_MAX_BYTES: usize = 64 * 1024 * 1024;

/// The most a staged write toward `target` may total: an appdata file, or a
/// file the player picked.
pub fn stageLimit(target: []const u8) usize {
    return if (std.mem.startsWith(u8, target, "appdata:")) FILE_MAX_BYTES else USER_FILE_MAX_BYTES;
}
/// Chunked writes in flight at once. Two is the realistic most (a mirror
/// flush and an export, or two windows); a new one past the last evicts the
/// oldest, which then answers stage_lost and starts over (host.js).
pub const STAGE_SLOTS: usize = 4;
/// A transfer's name, as the page makes it: [A-Za-z0-9_-], at most this long.
const TXN_MAX: usize = 32;
/// A store key, as persist.js names them ("save", "panelOpen", "meta"…).
const STORE_KEY_MAX: usize = 32;

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

    pub fn busy(self: *const Stage) bool {
        return self.txn_len > 0;
    }
    fn txn(self: *const Stage) []const u8 {
        return self.txn_buf[0..self.txn_len];
    }
    fn target(self: *const Stage) []const u8 {
        return self.target_buf[0..self.target_len];
    }
    pub fn complete(self: *const Stage) bool {
        return self.busy() and self.filled == self.data.len;
    }
};

/// Where one piece's decoded bytes go.
const Claim = struct { stage: *Stage, dest: []u8 };

pub const Stages = struct {
    slots: [STAGE_SLOTS]Stage = [_]Stage{.{}} ** STAGE_SLOTS,
    next: usize = 0,

    fn release(self: *Stages, gpa: std.mem.Allocator, stage: *Stage) void {
        _ = self;
        if (stage.data.len > 0) gpa.free(stage.data);
        stage.* = .{};
    }

    pub fn releaseAll(self: *Stages, gpa: std.mem.Allocator) void {
        for (&self.slots) |*s| self.release(gpa, s);
    }

    /// A stage's bytes, handed over: the slot is idle again, and freeing
    /// them is the caller's. Nothing this table does later — an eviction
    /// included — can touch them.
    pub fn detach(self: *Stages, stage: *Stage) []u8 {
        _ = self;
        const bytes = stage.data;
        stage.* = .{};
        return bytes;
    }

    /// Room for a piece of `len` bytes at `offset` of transfer `txn`.
    ///
    /// Offset 0 opens the transfer (again, if it had begun: a page that
    /// starts over means it). Any other offset has to continue one exactly
    /// where it stopped, into the same target at the same total — a piece
    /// that does not is refused and the transfer dropped, never patched
    /// into a file with a hole in it.
    pub fn claim(self: *Stages, gpa: std.mem.Allocator, txn: []const u8, target: []const u8, total: usize, offset: usize, len: usize) StageError!Claim {
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
pub const Incoming = struct {
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
pub fn receive(self: *App, payload: []const u8, target: []const u8, output: []u8, incoming: *Incoming, answer: *[]const u8) anyerror!Received {
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

/// finishReceive's alternative for a handler that has to wait before it
/// writes (chess.saveText's dialog): the bytes out of their stage slot, the
/// caller's to free with page_allocator.
pub fn takeReceived(self: *App, incoming: Incoming) []u8 {
    if (incoming.stage) |s| return self.stages.detach(s);
    return incoming.bytes;
}

pub fn pendingAnswer(output: []u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"pending\":true}}", .{}) catch return error.HandlerFailed;
}

fn tooLargeAnswer(output: []u8) anyerror![]const u8 {
    return tooLargeAnswerFor(output, FILE_MAX_BYTES);
}

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

// ------------------------------------------------------- issued-path tokens
//
// Q1.2, the trust model. Until 6.0 chess.readTextFile / chess.writeTextFile
// took any absolute path the page named: the page is our own code and the
// webview has no `innerHTML`, but "the page is trusted" is not a security
// default — one injected string in a PGN comment rendered the wrong way and
// the bridge would read ~/.ssh/id_ed25519 for it.
//
// Now a path is readable/writable only if the NATIVE side issued it in this
// process, and only the native side's own events issue one:
//
//   * a drop (issueDroppedPaths above, v8-0-plan F3: the SDK's files_dropped
//     event, before the page hears "drop:files");
//   * the OS's open-document event (forwardOpenFiles above), because the OS,
//     not the page, chose those paths.
//
// The file dialogs issue nothing: they run natively (chess.openPgn /
// chess.saveText, v8-1-plan N2) and their path never reaches the page. Until
// then the page wrapped the SDK's dialogs and asked chess.issuePath to trust
// what they returned; that command is gone, so no path the page names is
// ever issued.
//
// A drop is still checked rather than taken whole (pathAllowed): a path is
// accepted only if it is
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
// hundreds of files just forgets the oldest, and a new drop or open issues
// it again. Reads/writes of an unissued path answer
// {"error":"unissued_path"}, which host.js turns into UnissuedPathError.
const ISSUED_MAX: usize = 64;
const ISSUED_PATH_MAX: usize = 2048;

pub const IssuedPaths = struct {
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

/// What pathAllowed checks a dropped or OS-opened path against — plain
/// strings, so the rule is unit testable without an environment.
pub const PathPolicy = struct {
    /// $HOME (macOS) / %USERPROFILE% (Windows); "" when unknown, which leaves
    /// only removable volumes.
    home: []const u8,
    /// Our own data directory: the one place under ~/Library / AppData that
    /// is allowed.
    appdata_dir: []const u8,
    windows: bool,
};

pub fn isSep(c: u8, windows: bool) bool {
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

pub fn fsMakePath(io: std.Io, dir: []const u8) void {
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

pub fn appdataUnavailable(output: []u8) anyerror![]const u8 {
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
        // a handler of one kind or the other, never both, never neither
        try std.testing.expect((cmd.invoke_fn == null) != (cmd.async_fn == null));
    }
    try std.testing.expectEqual(@as(usize, 13), APP_COMMANDS.len);
}

test "the network commands are asynchronous and reach the SDK's async registry" {
    // v8-1-plan N1: the two that talk to another host never run on the loop
    var env = std.process.Environ.Map.init(std.testing.allocator);
    defer env.deinit();
    var app_state = App{ .env_map = &env, .io = undefined };
    const d = app_state.bridge();
    for ([_][]const u8{ "chess.fetchGames", "chess.checkUpdate" }) |name| {
        try std.testing.expect(d.async_registry.find(name) != null);
        try std.testing.expect(d.registry.find(name) == null);
    }
    try std.testing.expect(d.registry.find("chess.fetchProgress") != null);
    try std.testing.expectEqual(APP_COMMANDS.len, d.registry.handlers.len + d.async_registry.handlers.len);
    // …and every one of them, of either kind, has its origin policy
    for (APP_COMMANDS) |cmd| try std.testing.expect(d.policy.find(cmd.name) != null);
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

test "a dropped or OS-opened path is issued only when it is a user's file, not the system's" {
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
