//! The menu bar (20.0 E3, v20-0-plan §10): its labels in the page's three
//! languages, what a menu command becomes for the page, and the commands the
//! shell answers itself (quit, about on Windows). The menu table itself is
//! app.zon's; the Mac's own menus (the app menu, Edit, Window) are finished
//! in src/native/mac_chrome.m after each build of the bar.
//!
//! The page says its language with chess.setMenuLanguage at start and on
//! every change: the bar is rebuilt in it at once (PlatformServices
//! .configureMenus, the call the Runtime makes at start) and the choice is
//! kept in `<appdata>/lang`, so the next launch builds the bar and the
//! window title in it before the page runs.

const std = @import("std");
const builtin = @import("builtin");
const runner = @import("runner");
const native_sdk = @import("native_sdk");

const LANG_FILE = @import("bridge.zig").LANG_FILE;
const appdataUnavailable = @import("bridge.zig").appdataUnavailable;
const fsMakePath = @import("bridge.zig").fsMakePath;
const jsonStringField = @import("bridge.zig").jsonStringField;
const App = @import("main.zig").App;

/// app.zon's .version (scripts/manifest-check.mjs holds the two together):
/// what the Windows About box says.
pub const APP_VERSION = "20.0.0";

/// The "shortcut" event a menu command becomes for the page
/// (src/app/services/shell.js): the command name as both `id` and `command`,
/// window 0 (no window said) as the main window.
pub fn commandDetail(buf: []u8, name: []const u8, window_id: native_sdk.WindowId) ![]const u8 {
    return std.fmt.bufPrint(
        buf,
        "{{\"id\":\"{s}\",\"command\":\"{s}\",\"key\":\"\",\"windowId\":{d},\"modifiers\":{{\"primary\":false,\"command\":false,\"control\":false,\"option\":false,\"shift\":false}}}}",
        .{ name, name, if (window_id == 0) @as(u64, 1) else window_id },
    );
}

/// Commands the shell answers itself instead of the page.
pub const Native = enum { quit, about };

pub fn nativeCommand(name: []const u8) ?Native {
    if (std.mem.eql(u8, name, "app.quit")) return .quit;
    if (std.mem.eql(u8, name, "app.about")) return .about;
    return null;
}

// ------------------------------------------------------------- the labels

const MenuText = struct { key: []const u8, en: []const u8, ja: []const u8 };

/// Menu titles are keyed by their app.zon (Chinese) title, items by command;
/// Chinese is app.zon's own label. A test holds this to app.zon both ways.
/// The words follow the page's (text/play.*.js nav.*, act.*; learn.*.js
/// me.import).
const MENU_TEXT = [_]MenuText{
    .{ .key = "对局", .en = "Game", .ja = "対局" },
    .{ .key = "前往", .en = "Go", .ja = "移動" },
    .{ .key = "帮助", .en = "Help", .ja = "ヘルプ" },
    .{ .key = "game.new", .en = "New Game", .ja = "新しい対局" },
    .{ .key = "game.undo", .en = "Take Back", .ja = "待った" },
    .{ .key = "game.flip", .en = "Flip Board", .ja = "盤を反転" },
    .{ .key = "game.hint", .en = "Hint", .ja = "ヒント" },
    .{ .key = "file.import", .en = "Import PGN…", .ja = "PGN を読み込む…" },
    .{ .key = "app.quit", .en = "Exit", .ja = "終了" },
    .{ .key = "go.learn", .en = "Learn", .ja = "学ぶ" },
    .{ .key = "go.play", .en = "Play", .ja = "指す" },
    .{ .key = "go.me", .en = "Me", .ja = "わたし" },
    .{ .key = "view.prev", .en = "Previous Move", .ja = "前の手" },
    .{ .key = "view.next", .en = "Next Move", .ja = "次の手" },
    .{ .key = "go.settings", .en = "Settings…", .ja = "設定…" },
    .{ .key = "app.about", .en = "About Chessboard", .ja = "Chessboard について" },
};

fn menuTextLookup(key: []const u8) ?MenuText {
    for (MENU_TEXT) |t| {
        if (std.mem.eql(u8, t.key, key)) return t;
    }
    return null;
}

pub fn menuText(key: []const u8, lang: []const u8, fallback: []const u8) []const u8 {
    if (std.mem.eql(u8, lang, "zh")) return fallback;
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

/// The language as mac_chrome.m takes it: 0 zh, 1 en, 2 ja.
pub fn languageCode(lang: []const u8) c_int {
    if (std.mem.eql(u8, lang, "en")) return 1;
    if (std.mem.eql(u8, lang, "ja")) return 2;
    return 0;
}

/// The window title / app name for a launch language. Chinese is app.zon's
/// own "国际象棋"; the others use the product name.
pub fn windowTitleFor(lang: []const u8) []const u8 {
    return if (std.mem.eql(u8, lang, "zh")) "国际象棋" else "Chessboard";
}

/// The manifest menus with their labels in `lang`, built into `items` /
/// `menus` (the App's storage, which outlives the Runtime's use of it).
pub fn localize(base: []const native_sdk.Menu, lang: []const u8, items: []native_sdk.MenuItem, menus: []native_sdk.Menu) []const native_sdk.Menu {
    var item_index: usize = 0;
    for (base, 0..) |menu, menu_index| {
        const first_item = item_index;
        for (menu.items) |item| {
            var copy = item;
            copy.label = menuText(item.command, lang, item.label);
            items[item_index] = copy;
            item_index += 1;
        }
        menus[menu_index] = .{
            .title = menuText(menu.title, lang, menu.title),
            .items = items[first_item..item_index],
        };
    }
    return menus[0..base.len];
}

// ------------------------------------------------------------ the Mac's own menus

extern fn chess_mac_menus_finish(lang: c_int) void;

/// After every build of the bar: on macOS the app menu in the language, 设置…
/// moved into it, the two Windows-only items taken out, and Edit / Window
/// added (mac_chrome.m). Nothing elsewhere.
pub fn finishPlatformMenus(lang: []const u8) void {
    if (comptime runner.mac_shell) chess_mac_menus_finish(languageCode(lang));
}

/// Rebuild the bar in `lang`, now.
pub fn applyLanguage(self: *App, lang: []const u8) void {
    const rt = self.runtime orelse return;
    const menus = localize(self.menu_storage.fromManifest(), lang, &self.menu_items, &self.menus);
    rt.options.platform.services.configureMenus(menus) catch return;
    // what the automation snapshot lists, too
    rt.options.menus = menus;
    self.menu_lang = lang;
    finishPlatformMenus(lang);
}

pub fn setMenuLanguage(context: *anyopaque, invocation: native_sdk.bridge.Invocation, output: []u8) anyerror![]const u8 {
    const self: *App = @ptrCast(@alignCast(context));
    var lang_buf: [8]u8 = undefined;
    const raw = jsonStringField(invocation.request.payload, "lang", &lang_buf) orelse return error.InvalidRequest;
    const lang = languageTag(raw) orelse return error.InvalidRequest;
    const applied = self.runtime != null;
    if (!std.mem.eql(u8, lang, self.menu_lang) or !self.menus_finished) {
        applyLanguage(self, lang);
        self.menus_finished = true;
    }
    var path_buf: [1200]u8 = undefined;
    const path = self.appdataChild(&path_buf, LANG_FILE) orelse return appdataUnavailable(output);
    fsMakePath(self.io, self.appdata_dir);
    var file = std.Io.Dir.createFileAbsolute(self.io, path, .{ .truncate = true }) catch return error.HandlerFailed;
    defer file.close(self.io);
    file.writeStreamingAll(self.io, lang) catch return error.HandlerFailed;
    return std.fmt.bufPrint(output, "{{\"ok\":true,\"applied\":{s},\"lang\":\"{s}\"}}", .{ if (applied) "true" else "false", lang }) catch return error.HandlerFailed;
}

// ------------------------------------------------------------ About (Windows)

extern "user32" fn MessageBoxW(hwnd: ?*anyopaque, text: [*:0]const u16, caption: [*:0]const u16, kind: c_uint) callconv(.winapi) c_int;
const MB_ICONINFORMATION: c_uint = 0x40;

pub fn aboutText(buf: []u8, lang: []const u8) ![]const u8 {
    const tail = "\nGPLv3 · github.com/hxddh/chessboard";
    if (std.mem.eql(u8, lang, "ja")) return std.fmt.bufPrint(buf, "Chessboard {s}\n学んで、人らしい相手と指すチェス。" ++ tail, .{APP_VERSION});
    if (std.mem.eql(u8, lang, "en")) return std.fmt.bufPrint(buf, "Chessboard {s}\nLearn, and play a game that feels human." ++ tail, .{APP_VERSION});
    return std.fmt.bufPrint(buf, "国际象棋 {s}\n学一样，下一盘像人的棋。" ++ tail, .{APP_VERSION});
}

pub fn aboutTitle(lang: []const u8) []const u8 {
    if (std.mem.eql(u8, lang, "ja")) return "Chessboard について";
    if (std.mem.eql(u8, lang, "en")) return "About Chessboard";
    return "关于国际象棋";
}

/// The Windows About box (macOS has the system's About panel in the app
/// menu, and its item is taken out of 帮助 there).
pub fn showAbout(lang: []const u8) void {
    if (comptime builtin.os.tag != .windows) return;
    var text_buf: [512]u8 = undefined;
    const text = aboutText(&text_buf, lang) catch return;
    var wide_text: [512]u16 = undefined;
    var wide_title: [64]u16 = undefined;
    const n = std.unicode.utf8ToUtf16Le(wide_text[0 .. wide_text.len - 1], text) catch return;
    wide_text[n] = 0;
    const title = aboutTitle(lang);
    const m = std.unicode.utf8ToUtf16Le(wide_title[0 .. wide_title.len - 1], title) catch return;
    wide_title[m] = 0;
    _ = MessageBoxW(null, wide_text[0..n :0], wide_title[0..m :0], MB_ICONINFORMATION);
}

// ---------------------------------------------------------------- tests

test "the label table covers every menu and item app.zon declares, and nothing else" {
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
    try std.testing.expectEqualStrings("对局", menuText("对局", "zh", "对局"));
    try std.testing.expectEqualStrings("", menuText("", "en", ""));
}

test "no 19.0 command is left in the menus, and each 20.0 one has its key" {
    var storage: runner.MenuStorage = .{};
    const menus = storage.fromManifest();
    const Want = struct { cmd: []const u8, key: []const u8, shift: bool = false };
    const want = [_]Want{
        .{ .cmd = "game.new", .key = "n" },     .{ .cmd = "game.undo", .key = "z" },
        .{ .cmd = "game.flip", .key = "f" },    .{ .cmd = "game.hint", .key = "h", .shift = true },
        .{ .cmd = "file.import", .key = "o" },  .{ .cmd = "go.learn", .key = "1" },
        .{ .cmd = "go.play", .key = "2" },      .{ .cmd = "go.me", .key = "3" },
        .{ .cmd = "go.settings", .key = "," },
    };
    for (want) |w| {
        var found = false;
        for (menus) |menu| for (menu.items) |item| {
            if (!std.mem.eql(u8, item.command, w.cmd)) continue;
            found = true;
            try std.testing.expectEqualStrings(w.key, item.key);
            try std.testing.expect(item.modifiers.primary);
            try std.testing.expectEqual(w.shift, item.modifiers.shift);
        };
        try std.testing.expect(found);
    }
    for (menus) |menu| for (menu.items) |item| {
        for ([_][]const u8{ "go.home", "go.train", "view.repertoire", "view.panel", "help.keys" }) |old| {
            try std.testing.expect(!std.mem.eql(u8, item.command, old));
        }
        // ⌘H is the system's Hide: a menu item on it would be dead (1.18)
        if (std.mem.eql(u8, item.key, "h")) try std.testing.expect(item.modifiers.shift);
    };
}

test "the bar is rebuilt in a language from app.zon, labels swapped, commands and keys kept" {
    var storage: runner.MenuStorage = .{};
    const base = storage.fromManifest();
    var items: [native_sdk.platform.max_menu_items]native_sdk.MenuItem = undefined;
    var menus: [native_sdk.platform.max_menus]native_sdk.Menu = undefined;
    const en = localize(base, "en", &items, &menus);
    try std.testing.expectEqual(base.len, en.len);
    try std.testing.expectEqualStrings("Game", en[0].title);
    var saw_new = false;
    for (en, base) |m, b| {
        try std.testing.expectEqual(b.items.len, m.items.len);
        for (m.items, b.items) |it, bi| {
            try std.testing.expectEqualStrings(bi.command, it.command);
            try std.testing.expectEqualStrings(bi.key, it.key);
            try std.testing.expectEqual(bi.separator, it.separator);
            if (std.mem.eql(u8, it.command, "game.new")) {
                saw_new = true;
                try std.testing.expectEqualStrings("New Game", it.label);
            }
        }
    }
    try std.testing.expect(saw_new);
    // back to Chinese: app.zon's labels
    const zh = localize(base, "zh", &items, &menus);
    try std.testing.expectEqualStrings(base[0].title, zh[0].title);
    try std.testing.expectEqualStrings(base[0].items[0].label, zh[0].items[0].label);
}

test "a menu command reaches the page as a shortcut event naming it" {
    var buf: [256]u8 = undefined;
    const detail = try commandDetail(&buf, "game.flip", 0);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"command\":\"game.flip\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"id\":\"game.flip\"") != null);
    try std.testing.expect(std.mem.indexOf(u8, detail, "\"windowId\":1,") != null);
    const other = try commandDetail(&buf, "game.flip", 3);
    try std.testing.expect(std.mem.indexOf(u8, other, "\"windowId\":3,") != null);
    // quit and about are the shell's; everything else is the page's
    try std.testing.expectEqual(Native.quit, nativeCommand("app.quit").?);
    try std.testing.expectEqual(Native.about, nativeCommand("app.about").?);
    try std.testing.expect(nativeCommand("game.new") == null);
}

test "language tags are the page's three and nothing else" {
    try std.testing.expectEqualStrings("en", languageTag("en").?);
    try std.testing.expectEqualStrings("ja", languageTag("ja").?);
    try std.testing.expectEqualStrings("zh", languageTag("zh").?);
    try std.testing.expect(languageTag("fr") == null);
    try std.testing.expect(languageTag("") == null);
    try std.testing.expectEqual(@as(c_int, 0), languageCode("zh"));
    try std.testing.expectEqual(@as(c_int, 1), languageCode("en"));
    try std.testing.expectEqual(@as(c_int, 2), languageCode("ja"));
    try std.testing.expectEqualStrings("国际象棋", windowTitleFor("zh"));
    try std.testing.expectEqualStrings("Chessboard", windowTitleFor("en"));
}

test "the About box says the version in the language" {
    var buf: [512]u8 = undefined;
    try std.testing.expect(std.mem.startsWith(u8, try aboutText(&buf, "zh"), "国际象棋 " ++ APP_VERSION));
    try std.testing.expect(std.mem.startsWith(u8, try aboutText(&buf, "en"), "Chessboard " ++ APP_VERSION));
    try std.testing.expect(std.mem.indexOf(u8, try aboutText(&buf, "ja"), "GPLv3") != null);
    try std.testing.expectEqualStrings("关于国际象棋", aboutTitle("zh"));
}
