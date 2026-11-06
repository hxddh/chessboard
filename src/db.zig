//! The app database over the bridge (ADR 0003, v20-0-plan A2): the page's
//! `db` service (src/app/services/db-native.js) writes and reads the SDK's
//! RelationalStore — the SQLite file the runner opens when the manifest
//! declares the `sqlite` capability (schema: db_migrations.zig).
//!
//!   chess.dbExec   {"stmts":[{"sql":…,"params":[…]},…]}
//!                  → {"ok":true} | {"error":"<outcome>"}
//!                  One IMMEDIATE transaction for the whole array (the SDK's
//!                  Database.exec: every statement prepared, bound and run,
//!                  any failure rolls all of it back). The page sends one
//!                  call per batch of appends, so an autosave of a move is
//!                  one commit.
//!   chess.dbQuery  {"sql":…,"params":[…]}
//!                  → {"rows":[[…],…]} | {"error":"<outcome>"}
//!                  One read-only statement on the reader connection (WAL:
//!                  it sees every commit before it).
//!
//! Params are JSON: string → TEXT, integer → INTEGER, other number → REAL,
//! null → NULL, true/false → 1/0. Result values come back the same way
//! (BLOBs are not used by the app and answer null).
//!
//! The SQL is the page's own — the page is the bundle shipped inside this
//! binary, and only the manifest's origins may call these commands (main.zig
//! bridge()). What SQL can do is bounded by the SDK's authorizer: no ATTACH,
//! no temporary schema, no engine-owned pragmas, no transaction statements
//! (relational_store.zig, sqlite_engine.zig relationalPolicy). Without the
//! capability (the 19.0 UI's manifest) the binding is null and both
//! commands answer {"error":"no_db"}; the page then uses IndexedDB.
//!
//! Both run on the loop thread: an append batch is a few statements in WAL
//! mode with synchronous=NORMAL (no fsync per commit), measured in-app by
//! the `app-db` automation scenario.

const std = @import("std");
const native_sdk = @import("native_sdk");
const App = @import("main.zig").App;

const relational = native_sdk.relational_store;
const Binding = native_sdk.RelationalStoreBinding;

fn bindingOf(self: *App) ?Binding {
    const rt = self.runtime orelse return null;
    return rt.options.relational_store;
}

pub fn dbExec(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    return execAnswer(bindingOf(self), invocation.request.payload, output);
}

pub fn dbQuery(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    return queryAnswer(bindingOf(self), invocation.request.payload, output);
}

fn errorAnswer(output: []u8, code: []const u8) anyerror![]const u8 {
    return std.fmt.bufPrint(output, "{{\"error\":\"{s}\"}}", .{code}) catch error.HandlerFailed;
}

/// One JSON param as the store's tagged value; null when it has no SQL form.
fn paramValue(v: std.json.Value) ?relational.Value {
    return switch (v) {
        .null => .null_value,
        .bool => |b| .{ .integer = @intFromBool(b) },
        .integer => |i| .{ .integer = i },
        .float => |f| if (std.math.isFinite(f)) .{ .real = f } else null,
        .number_string => |s| if (std.fmt.parseFloat(f64, s)) |f| (if (std.math.isFinite(f)) relational.Value{ .real = f } else null) else |_| null,
        .string => |s| .{ .text = s },
        else => null,
    };
}

/// `params` of one statement object: [] when absent, null when malformed.
fn paramsOf(arena: std.mem.Allocator, stmt: std.json.ObjectMap) ?[]const relational.Value {
    const raw = stmt.get("params") orelse return &.{};
    if (raw != .array) return null;
    if (raw.array.items.len > relational.max_parameters) return null;
    const out = arena.alloc(relational.Value, raw.array.items.len) catch return null;
    for (raw.array.items, 0..) |item, i| out[i] = paramValue(item) orelse return null;
    return out;
}

fn sqlOf(stmt: std.json.ObjectMap) ?[]const u8 {
    const raw = stmt.get("sql") orelse return null;
    if (raw != .string or raw.string.len == 0) return null;
    return raw.string;
}

pub fn execAnswer(binding: ?Binding, payload: []const u8, output: []u8) anyerror![]const u8 {
    const db = binding orelse return errorAnswer(output, "no_db");
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, payload, .{}) catch return errorAnswer(output, "bad_request");
    if (parsed != .object) return errorAnswer(output, "bad_request");
    const list = parsed.object.get("stmts") orelse return errorAnswer(output, "bad_request");
    if (list != .array or list.array.items.len == 0 or list.array.items.len > relational.max_exec_statements) return errorAnswer(output, "bad_request");
    const stmts = arena.alloc(relational.Statement, list.array.items.len) catch return errorAnswer(output, "io_failed");
    for (list.array.items, 0..) |item, i| {
        if (item != .object) return errorAnswer(output, "bad_request");
        stmts[i] = .{
            .sql = sqlOf(item.object) orelse return errorAnswer(output, "bad_request"),
            .params = paramsOf(arena, item.object) orelse return errorAnswer(output, "bad_request"),
        };
    }
    const outcome = db.exec_fn(db.context, stmts);
    if (outcome != .ok) return errorAnswer(output, relational.outcomeName(outcome));
    return std.fmt.bufPrint(output, "{{\"ok\":true}}", .{}) catch error.HandlerFailed;
}

/// The rows of every page, written as JSON arrays into `w` as they arrive.
const RowSink = struct {
    w: *std.Io.Writer,
    rows: usize = 0,
    failed: bool = false,

    fn page(context: *anyopaque, bytes: []const u8) void {
        const self: *RowSink = @ptrCast(@alignCast(context));
        if (self.failed) return;
        self.writePage(bytes) catch {
            self.failed = true;
        };
    }

    fn writePage(self: *RowSink, bytes: []const u8) !void {
        var at: usize = 0;
        const columns = try readU32(bytes, &at);
        const count = try readU32(bytes, &at);
        for (0..columns) |_| _ = try readBytes(bytes, &at);
        for (0..count) |_| {
            try self.w.writeAll(if (self.rows == 0) "[" else ",[");
            self.rows += 1;
            for (0..columns) |c| {
                if (c > 0) try self.w.writeByte(',');
                if (at >= bytes.len) return error.Malformed;
                const tag = bytes[at];
                at += 1;
                switch (tag) {
                    0 => try self.w.writeAll("null"),
                    1 => try self.w.print("{d}", .{@as(i64, @bitCast(try readU64(bytes, &at)))}),
                    2 => try self.w.print("{d}", .{@as(f64, @bitCast(try readU64(bytes, &at)))}),
                    3 => try std.json.Stringify.encodeJsonString(try readBytes(bytes, &at), .{}, self.w),
                    4 => {
                        _ = try readBytes(bytes, &at);
                        try self.w.writeAll("null");
                    },
                    else => return error.Malformed,
                }
            }
            try self.w.writeByte(']');
        }
    }
};

fn readU32(bytes: []const u8, at: *usize) !usize {
    if (at.* + 4 > bytes.len) return error.Malformed;
    defer at.* += 4;
    return std.mem.readInt(u32, bytes[at.*..][0..4], .little);
}

fn readU64(bytes: []const u8, at: *usize) !u64 {
    if (at.* + 8 > bytes.len) return error.Malformed;
    defer at.* += 8;
    return std.mem.readInt(u64, bytes[at.*..][0..8], .little);
}

fn readBytes(bytes: []const u8, at: *usize) ![]const u8 {
    const len = try readU32(bytes, at);
    if (at.* + len > bytes.len) return error.Malformed;
    defer at.* += len;
    return bytes[at.*..][0..len];
}

pub fn queryAnswer(binding: ?Binding, payload: []const u8, output: []u8) anyerror![]const u8 {
    const db = binding orelse return errorAnswer(output, "no_db");
    var arena_state = std.heap.ArenaAllocator.init(std.heap.page_allocator);
    defer arena_state.deinit();
    const arena = arena_state.allocator();
    const parsed = std.json.parseFromSliceLeaky(std.json.Value, arena, payload, .{}) catch return errorAnswer(output, "bad_request");
    if (parsed != .object) return errorAnswer(output, "bad_request");
    const sql = sqlOf(parsed.object) orelse return errorAnswer(output, "bad_request");
    const params = paramsOf(arena, parsed.object) orelse return errorAnswer(output, "bad_request");
    var w: std.Io.Writer = .fixed(output);
    w.writeAll("{\"rows\":[") catch return error.HandlerFailed;
    var sink = RowSink{ .w = &w };
    const outcome = db.query_fn(db.context, sql, params, &sink, RowSink.page);
    if (outcome != .ok) return errorAnswer(output, relational.outcomeName(outcome));
    if (sink.failed) return errorAnswer(output, "too_big");
    w.writeAll("]}") catch return errorAnswer(output, "too_big");
    return w.buffered();
}

// ---------------------------------------------------------------- tests

const test_migrations = @import("runner").db_migrations;

fn testDb() !native_sdk.RelationalStore {
    const opened = try native_sdk.RelationalStore.openMemoryMigrated(std.testing.allocator, test_migrations);
    try std.testing.expectEqual(relational.OpenOutcome.ok, opened.outcome);
    return opened.database.?;
}

test "A2 db: schema v1 has the nine tables of db.js" {
    var db = try testDb();
    defer db.deinit();
    var out: [4096]u8 = undefined;
    const got = try queryAnswer(db.binding(), "{\"sql\":\"SELECT name FROM sqlite_schema WHERE type = 'table' ORDER BY name\"}", &out);
    try std.testing.expectEqualStrings("{\"rows\":[[\"analysis\"],[\"cards\"],[\"events\"],[\"games\"],[\"library\"],[\"moves\"],[\"repertoire\"],[\"settings\"],[\"skills\"]]}", got);
}

test "A2 db: a batch is one transaction; reads see it; params keep their types" {
    var db = try testDb();
    defer db.deinit();
    var out: [4096]u8 = undefined;
    try std.testing.expectEqualStrings("{\"ok\":true}", try execAnswer(db.binding(),
        \\{"stmts":[{"sql":"INSERT INTO games(k,v) VALUES (?1,?2)","params":["a","{\"x\":1}"]},
        \\ {"sql":"INSERT INTO games(k,v) VALUES (?1,?2)","params":["b","{\"y\":\"é\\n\"}"]}]}
    , &out));
    try std.testing.expectEqualStrings("{\"rows\":[[\"a\",\"{\\\"x\\\":1}\"],[\"b\",\"{\\\"y\\\":\\\"é\\\\n\\\"}\"]]}", try queryAnswer(db.binding(), "{\"sql\":\"SELECT k, v FROM games ORDER BY k\"}", &out));
    try std.testing.expectEqualStrings("{\"rows\":[[1,1.5,null,1]]}", try queryAnswer(db.binding(), "{\"sql\":\"SELECT count(*), ?1, ?2, ?3\",\"params\":[1.5,null,true]}", &out));
    // the second statement breaks the key: neither lands
    try std.testing.expectEqualStrings("{\"error\":\"constraint\"}", try execAnswer(db.binding(),
        \\{"stmts":[{"sql":"INSERT INTO games(k,v) VALUES ('c','{}')"},{"sql":"INSERT INTO games(k,v) VALUES ('a','{}')"}]}
    , &out));
    try std.testing.expectEqualStrings("{\"rows\":[[2]]}", try queryAnswer(db.binding(), "{\"sql\":\"SELECT count(*) FROM games\"}", &out));
}

test "A2 db: refusals — no store, malformed requests, writes on the read path, ATTACH" {
    var out: [512]u8 = undefined;
    try std.testing.expectEqualStrings("{\"error\":\"no_db\"}", try execAnswer(null, "{}", &out));
    try std.testing.expectEqualStrings("{\"error\":\"no_db\"}", try queryAnswer(null, "{}", &out));
    var db = try testDb();
    defer db.deinit();
    try std.testing.expectEqualStrings("{\"error\":\"bad_request\"}", try execAnswer(db.binding(), "nope", &out));
    try std.testing.expectEqualStrings("{\"error\":\"bad_request\"}", try execAnswer(db.binding(), "{\"stmts\":[]}", &out));
    try std.testing.expectEqualStrings("{\"error\":\"bad_request\"}", try execAnswer(db.binding(), "{\"stmts\":[{\"sql\":\"SELECT 1\",\"params\":[[1]]}]}", &out));
    try std.testing.expectEqualStrings("{\"error\":\"misuse\"}", try queryAnswer(db.binding(), "{\"sql\":\"DELETE FROM games\"}", &out));
    try std.testing.expect(std.mem.startsWith(u8, try execAnswer(db.binding(), "{\"stmts\":[{\"sql\":\"ATTACH DATABASE 'x.db' AS x\"}]}", &out), "{\"error\":"));
    try std.testing.expect(std.mem.startsWith(u8, try execAnswer(db.binding(), "{\"stmts\":[{\"sql\":\"BEGIN\"}]}", &out), "{\"error\":"));
}

test "A2 db: an answer too big for the frame says so" {
    var db = try testDb();
    defer db.deinit();
    var out: [4096]u8 = undefined;
    _ = try execAnswer(db.binding(), "{\"stmts\":[{\"sql\":\"INSERT INTO library(k,v) VALUES ('a', printf('%.*c', 5000, 'x'))\"}]}", &out);
    try std.testing.expectEqualStrings("{\"error\":\"too_big\"}", try queryAnswer(db.binding(), "{\"sql\":\"SELECT v FROM library\"}", &out));
}
