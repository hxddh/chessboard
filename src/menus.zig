//! The menu bar's language (Q1.6) and what a menu command becomes for the
//! page. The menu table itself is app.zon's. Moved verbatim out of
//! main.zig (v8-2-plan F2).

const std = @import("std");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

const LANG_FILE = @import("bridge.zig").LANG_FILE;
const appdataUnavailable = @import("bridge.zig").appdataUnavailable;
const fsMakePath = @import("bridge.zig").fsMakePath;
const jsonStringField = @import("bridge.zig").jsonStringField;
const App = @import("main.zig").App;

/// The "shortcut" event a menu command becomes for the page (host.js →
/// native-commands.js run): the command name as both `id` and `command`,
/// window 0 (no window said) as the main window. Split out of onEvent so a
/// test can read what the page is handed (v8-2-plan T4).
pub fn commandDetail(buf: []u8, name: []const u8, window_id: native_sdk.WindowId) ![]const u8 {
    return std.fmt.bufPrint(
        buf,
        "{{\"id\":\"{s}\",\"command\":\"{s}\",\"key\":\"\",\"windowId\":{d},\"modifiers\":{{\"primary\":false,\"command\":false,\"control\":false,\"option\":false,\"shift\":false}}}}",
        .{ name, name, if (window_id == 0) @as(u64, 1) else window_id },
    );
}

// -------------------------------------------------------- menu language (Q1.6)
//
// The menu bar is comptime data from app.zon, handed to the Runtime once at
// init (runner.zig); the Runtime this fork drives exposes no menu rebuild,
// and a bridge handler holds no *Runtime anyway. So the language cannot be
// applied live. What can be done: remember it, and build the menus in that
// language at the NEXT launch — main() reads the `lang` file before
// runWithOptions and passes localizedMenus(). The page tells the player a
// restart is needed (the answer says restartRequired:true). The labels below
// mirror app.zon's items by command id; a test holds the two together.

const MenuText = struct { key: []const u8, en: []const u8, ja: []const u8 };

/// Menu titles are keyed by their app.zon (Chinese) title, items by command.
const MENU_TEXT = [_]MenuText{
    .{ .key = "对局", .en = "Game", .ja = "対局" },
    .{ .key = "视图", .en = "View", .ja = "表示" },
    .{ .key = "帮助", .en = "Help", .ja = "ヘルプ" },
    .{ .key = "game.new", .en = "New Game", .ja = "新規対局" },
    .{ .key = "game.undo", .en = "Undo Move", .ja = "待った" },
    .{ .key = "game.hint", .en = "Engine Hint", .ja = "エンジンのヒント" },
    .{ .key = "game.flip", .en = "Flip Board", .ja = "盤を反転" },
    .{ .key = "view.panel", .en = "Side Panel", .ja = "サイドパネル" },
    // v8-2-plan T4: the page's 我的开局书 section (rep.title in i18n-en / i18n-ja)
    .{ .key = "view.repertoire", .en = "My Repertoire", .ja = "自分の定跡書" },
    .{ .key = "view.prev", .en = "Previous Move", .ja = "前の手" },
    .{ .key = "view.next", .en = "Next Move", .ja = "次の手" },
    .{ .key = "help.keys", .en = "Keyboard Shortcuts", .ja = "キーボードショートカット" },
};

fn menuTextLookup(key: []const u8) ?MenuText {
    for (MENU_TEXT) |t| {
        if (std.mem.eql(u8, t.key, key)) return t;
    }
    return null;
}

pub fn menuText(key: []const u8, lang: []const u8, fallback: []const u8) []const u8 {
    const t = menuTextLookup(key) orelse return fallback;
    return if (std.mem.eql(u8, lang, "ja")) t.ja else t.en;
}

/// The three UI languages, as the page spells them; anything else → null.
/// Returns a literal, not the input, so callers can keep it past the buffer.
pub fn languageTag(raw: []const u8) ?[]const u8 {
    if (std.mem.eql(u8, raw, "zh")) return "zh";
    if (std.mem.eql(u8, raw, "en")) return "en";
    if (std.mem.eql(u8, raw, "ja")) return "ja";
    return null;
}

/// The window title / app name for a launch language. Chinese is app.zon's
/// own "国际象棋"; the others use the product name.
pub fn windowTitleFor(lang: []const u8) []const u8 {
    return if (std.mem.eql(u8, lang, "zh")) "国际象棋" else "Chessboard";
}

pub fn setMenuLanguage(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var lang_buf: [8]u8 = undefined;
    const raw = jsonStringField(invocation.request.payload, "lang", &lang_buf) orelse return error.InvalidRequest;
    const lang = languageTag(raw) orelse return error.InvalidRequest;
    var path_buf: [1200]u8 = undefined;
    const path = self.appdataChild(&path_buf, LANG_FILE) orelse return appdataUnavailable(output);
    fsMakePath(self.io, self.appdata_dir);
    var file = std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true }) catch return error.HandlerFailed;
    defer file.close(self.io);
    file.writeStreamingAll(self.io, lang) catch return error.HandlerFailed;
    // applied:false is the honest answer — see the section comment
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"applied\":false,\"restartRequired\":true}}", .{}) catch return error.HandlerFailed;
}

test "the menu table covers every menu and item app.zon declares" {
    // app.zon's menus reach the Runtime through runner.MenuStorage; a command
    // added there without a row here would ship untranslated on en/ja.
    var storage: runner.MenuStorage = .{};
    const menus = storage.fromManifest();
    try std.testing.expect(menus.len > 0);
    for (menus) |menu| {
        try std.testing.expect(menuTextLookup(menu.title) != null);
        for (menu.items) |item| {
            if (item.command.len == 0) continue; // a separator
            try std.testing.expect(menuTextLookup(item.command) != null);
        }
    }
    // and the table has nothing app.zon does not
    for (MENU_TEXT) |t| {
        var found = false;
        for (menus) |menu| {
            if (std.mem.eql(u8, menu.title, t.key)) found = true;
            for (menu.items) |item| {
                if (std.mem.eql(u8, item.command, t.key)) found = true;
            }
        }
        try std.testing.expect(found);
    }
    try std.testing.expectEqualStrings("Game", menuText("对局", "en", "对局"));
    try std.testing.expectEqualStrings("対局", menuText("对局", "ja", "对局"));
    try std.testing.expectEqualStrings("", menuText("", "en", ""));
}

test "开局书 is a View menu item, and its command reaches the page (v8-2-plan T4)" {
    var storage: runner.MenuStorage = .{};
    const menus = storage.fromManifest();
    var found = false;
    for (menus) |menu| {
        if (!std.mem.eql(u8, menu.title, "视图")) continue;
        for (menu.items) |item| {
            if (!std.mem.eql(u8, item.command, "view.repertoire")) continue;
            found = true;
            try std.testing.expectEqualStrings("开局书", item.label);
            try std.testing.expectEqualStrings("o", item.key);
            try std.testing.expect(item.modifiers.primary and item.modifiers.shift);
        }
    }
    try std.testing.expect(found);
    try std.testing.expectEqualStrings("My Repertoire", menuText("view.repertoire", "en", "开局书"));
    try std.testing.expectEqualStrings("自分の定跡書", menuText("view.repertoire", "ja", "开局书"));
    // what host.js hands native-commands.js run(): the command, on the main window
    var buf: [256]u8 = undefined;
    const detail = try commandDetail(&buf, "view.repertoire", 0);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"command\":\"view.repertoire\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"id\":\"view.repertoire\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"windowId\":1,") != null);
    const other = try commandDetail(&buf, "view.repertoire", 3);
    try std.testing.expect(std.mem.indexOf(u8, other, "\"windowId\":3,") != null);
}

test "language tags are the page's three and nothing else" {
    try std.testing.expectEqualStrings("en", languageTag("en").?);
    try std.testing.expectEqualStrings("ja", languageTag("ja").?);
    try std.testing.expectEqualStrings("zh", languageTag("zh").?);
    try std.testing.expect(languageTag("fr") == null);
    try std.testing.expect(languageTag("") == null);
    try std.testing.expectEqualStrings("国际象棋", windowTitleFor("zh"));
    try std.testing.expectEqualStrings("Chessboard", windowTitleFor("en"));
}
