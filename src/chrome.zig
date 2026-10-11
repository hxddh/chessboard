//! 11.0 W — chess.setChrome: the page tells the shell its theme is dark or
//! light, and the shell answers whether the Mac's inset window shell is on
//! (src/native/mac_chrome.m). Everywhere but macOS it is a no-op that says
//! "not inset", so the page keeps its layout.

const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

const jsonBoolField = @import("bridge.zig").jsonBoolField;

extern fn chess_mac_chrome_set(dark: c_int) c_int;

/// The answer's "chrome" value: inset (the strip is there), full (full
/// screen: the system hid the titlebar) or none.
pub fn chromeState(code: c_int) []const u8 {
    return switch (code) {
        1 => "inset",
        2 => "full",
        else => "none",
    };
}

pub fn setChrome(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    _ = context;
    const dark = jsonBoolField(invocation.request.payload, "dark") orelse return error.InvalidRequest;
    var code: c_int = 0;
    if (comptime runner.mac_shell) code = chess_mac_chrome_set(@intFromBool(dark));
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"chrome\":\"{s}\"}}", .{chromeState(code)}) catch return error.HandlerFailed;
}

test "chess.setChrome answers none, inset or full" {
    try std.testing.expectEqualStrings("none", chromeState(0));
    try std.testing.expectEqualStrings("inset", chromeState(1));
    try std.testing.expectEqualStrings("full", chromeState(2));
    try std.testing.expectEqualStrings("none", chromeState(7));
}
