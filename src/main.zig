const std = @import("std");
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

const App = struct {
    env_map: *std.process.Environ.Map,
    io: std.Io,
    handlers: [2]native_sdk.BridgeHandler = undefined,
    policies: [2]native_sdk.BridgeCommandPolicy = undefined,

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
        self.handlers[0] = .{
            .name = "chess.writeTextFile",
            .context = self,
            .invoke_fn = writeTextFile,
        };
        self.handlers[1] = .{
            .name = "chess.readTextFile",
            .context = self,
            .invoke_fn = readTextFile,
        };
        self.policies[0] = .{
            .name = "chess.writeTextFile",
            .origins = runner.manifestOrigins(),
        };
        self.policies[1] = .{
            .name = "chess.readTextFile",
            .origins = runner.manifestOrigins(),
        };
        return .{
            .policy = .{
                .enabled = true,
                .commands = self.policies[0..],
            },
            .registry = .{ .handlers = self.handlers[0..] },
        };
    }
};

fn onEvent(context: *anyopaque, runtime: *native_sdk.Runtime, event: native_sdk.Event) anyerror!void {
    _ = context;
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

fn writeTextFile(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var path_buf: [4096]u8 = undefined;
    const path = jsonStringField(invocation.request.payload, "path", &path_buf) orelse return error.InvalidRequest;
    // base64 needs no unescaping — its alphabet has nothing JSON would escape
    const b64 = jsonStringFieldRaw(invocation.request.payload, "b64") orelse return error.InvalidRequest;
    if (path.len == 0) return error.InvalidRequest;
    if (b64.len == 0 or b64.len > WRITE_B64_MAX) return error.InvalidRequest;

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

pub fn main(init: std.process.Init) !void {
    var app_state = App{ .env_map = init.environ_map, .io = init.io };
    try runner.runWithOptions(app_state.app(), .{
        .app_name = "国际象棋",
        .window_title = "国际象棋",
        .bundle_id = "dev.hxddh.chessboard",
        .icon_path = "assets/icon.png",
        .js_window_api = true,
        .bridge = app_state.bridge(),
    }, init);
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

test "production source uses frontend assets" {
    const source = native_sdk.frontend.productionSource(.{ .dist = "frontend/dist" });
    try std.testing.expectEqual(native_sdk.WebViewSourceKind.assets, source.kind);
    try std.testing.expectEqualStrings("frontend/dist", source.asset_options.?.root_path);
}
