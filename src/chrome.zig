//! 11.0 W — chess.setChrome: the page tells the shell its theme is dark or
//! light, and the shell answers whether the Mac's inset window shell is on
//! (src/native/mac_chrome.m). 12.0 N: on Windows the title bar takes the
//! theme too, with Mica on Windows 11 (src/native/win_chrome.c), and the
//! answer is still "not inset" — the page keeps its layout. Elsewhere a no-op.

const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

const jsonBoolField = @import("bridge.zig").jsonBoolField;

extern fn chess_mac_chrome_set(dark: c_int) c_int;
extern fn chess_win_chrome_set(dark: c_int) c_int;
extern fn chess_mac_haptic() c_int;

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
    var win: c_int = 0;
    if (comptime runner.mac_shell) code = chess_mac_chrome_set(@intFromBool(dark));
    if (comptime runner.win_shell) win = chess_win_chrome_set(@intFromBool(dark));
    // 12.0 N: how many Windows windows took the theme, and whether Mica did;
    // and whether this shell can tap the trackpad (chess.haptic)
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"chrome\":\"{s}\",\"titlebar\":{d},\"mica\":{s},\"haptic\":{s}}}", .{
        chromeState(code),
        win & 0xff,
        if ((win & 0x100) != 0) "true" else "false",
        if (runner.mac_shell) "true" else "false",
    }) catch return error.HandlerFailed;
}

/// 12.0 N — chess.haptic: one light tap of the trackpad, for a piece the
/// player set down by dragging (src/native/mac_chrome.m). macOS only; the
/// page asks only when setChrome said "haptic", and elsewhere this answers
/// that nothing was felt.
pub fn haptic(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    _ = context;
    _ = invocation;
    var felt: c_int = 0;
    if (comptime runner.mac_shell) felt = chess_mac_haptic();
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"felt\":{s}}}", .{if (felt != 0) "true" else "false"}) catch return error.HandlerFailed;
}

test "chess.setChrome answers none, inset or full" {
    try std.testing.expectEqualStrings("none", chromeState(0));
    try std.testing.expectEqualStrings("inset", chromeState(1));
    try std.testing.expectEqualStrings("full", chromeState(2));
    try std.testing.expectEqualStrings("none", chromeState(7));
}
