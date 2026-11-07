// The app's own AppKit glue (11.0 W; 20.0 E3, v20-0-plan §10). Nothing here
// is compiled except on macOS (build.zig).
//
//   - Files the OS hands the app: a .pgn double-clicked in Finder, dropped on
//     the Dock icon, or opened with `open -a`, arrive as the 'odoc' Apple
//     event. The SDK's AppKit host does not handle it, so the handler is
//     installed here, in applicationWillFinishLaunching — after AppKit puts
//     its own in place and before the first event is dispatched, which is
//     what makes a cold launch by double-click deliver its file too. Each
//     path goes to opened.zig (chess_open_path), which queues it for the page.
//
//   - The menu bar around app.zon's menus (menus.zig calls
//     chess_mac_menus_finish after every build of the bar): the SDK puts an
//     application menu in front of them (About / Hide / Quit, in English);
//     here its items take the page's language, 设置… (go.settings) moves
//     into it as on every Mac app, the two items only Windows needs (退出,
//     关于 — the app menu has both) are taken out, and the standard Edit
//     menu (Cut / Copy / Paste / Select All for the library's search box:
//     without it ⌘C and ⌘V do nothing in a WKWebView) and Window menu are
//     added. Undo stays off the Edit menu: ⌘Z is 悔棋, and the page turns it
//     into a text undo when a text field has the focus.
//
// Until 20.0 this file also put the content under a transparent titlebar
// with a 28 pt native drag strip over the top of the page, for a page that
// left that strip empty when chess.setChrome said so. The 20.0 page never
// asked and draws its navigation there, so the strip took its clicks: the
// strip, chess.setChrome and chess.haptic went with 20.0 E3, and the window
// has its normal titlebar.

#import <AppKit/AppKit.h>
#import <CoreServices/CoreServices.h>

extern void chess_open_path(const char *path, size_t len);

@interface ChessOpenHandler : NSObject
- (void)openDocuments:(NSAppleEventDescriptor *)event withReply:(NSAppleEventDescriptor *)reply;
@end

@implementation ChessOpenHandler
- (void)openDocuments:(NSAppleEventDescriptor *)event withReply:(NSAppleEventDescriptor *)reply {
    (void)reply;
    NSAppleEventDescriptor *direct = [event paramDescriptorForKeyword:keyDirectObject];
    if (direct == nil) return;
    NSAppleEventDescriptor *list = [direct coerceToDescriptorType:typeAEList] ?: direct;
    NSInteger count = list.numberOfItems;
    if (count == 0) count = 1; // a single item that is not a list
    for (NSInteger i = 1; i <= count; i++) {
        NSAppleEventDescriptor *item = list.numberOfItems ? [list descriptorAtIndex:i] : list;
        NSURL *url = item.fileURLValue;
        if (url == nil) {
            NSAppleEventDescriptor *asURL = [item coerceToDescriptorType:typeFileURL];
            NSString *text = asURL ? [[NSString alloc] initWithData:asURL.data encoding:NSUTF8StringEncoding] : nil;
            url = text ? [NSURL URLWithString:text] : nil;
        }
        const char *path = url.isFileURL ? url.path.fileSystemRepresentation : NULL;
        if (path) chess_open_path(path, strlen(path));
    }
}
@end

static ChessOpenHandler *ChessHandler = nil;

/// Called once from main(), before the runner starts AppKit.
void chess_mac_shell_init(void) {
    ChessHandler = [[ChessOpenHandler alloc] init];
    [[NSNotificationCenter defaultCenter] addObserverForName:NSApplicationWillFinishLaunchingNotification object:nil queue:nil usingBlock:^(NSNotification *note) {
        (void)note;
        [[NSAppleEventManager sharedAppleEventManager] setEventHandler:ChessHandler
                                                           andSelector:@selector(openDocuments:withReply:)
                                                         forEventClass:kCoreEventClass
                                                            andEventID:kAEOpenDocuments];
    }];
}

// ------------------------------------------------------------------ menus

typedef struct {
    NSString *about, *hide, *hideOthers, *showAll, *quit;
    NSString *edit, *cut, *copy, *paste, *selectAll;
    NSString *window, *minimize, *zoom, *fullScreen, *close, *front;
    NSString *name;
} ChessMenuWords;

static ChessMenuWords ChessWords(int lang) {
    if (lang == 1) {
        return (ChessMenuWords){ @"About %@", @"Hide %@", @"Hide Others", @"Show All", @"Quit %@",
            @"Edit", @"Cut", @"Copy", @"Paste", @"Select All",
            @"Window", @"Minimize", @"Zoom", @"Enter Full Screen", @"Close Window", @"Bring All to Front", @"Chessboard" };
    }
    if (lang == 2) {
        return (ChessMenuWords){ @"%@ について", @"%@ を隠す", @"ほかを隠す", @"すべてを表示", @"%@ を終了",
            @"編集", @"カット", @"コピー", @"ペースト", @"すべてを選択",
            @"ウインドウ", @"しまう", @"拡大／縮小", @"フルスクリーンにする", @"ウインドウを閉じる", @"すべてを手前に移動", @"Chessboard" };
    }
    return (ChessMenuWords){ @"关于%@", @"隐藏%@", @"隐藏其他", @"全部显示", @"退出%@",
        @"编辑", @"剪切", @"拷贝", @"粘贴", @"全选",
        @"窗口", @"最小化", @"缩放", @"进入全屏幕", @"关闭窗口", @"前置全部窗口", @"国际象棋" };
}

static NSString *ChessCommandOf(NSMenuItem *item) {
    return [item.representedObject isKindOfClass:[NSString class]] ? (NSString *)item.representedObject : nil;
}

static NSMenuItem *ChessItem(NSString *title, SEL action, NSString *key, NSEventModifierFlags mods) {
    NSMenuItem *item = [[NSMenuItem alloc] initWithTitle:title action:action keyEquivalent:key];
    item.keyEquivalentModifierMask = mods;
    return item;
}

/// No separator first, last or twice in a row.
static void ChessTidy(NSMenu *menu) {
    BOOL lastWasSeparator = YES;
    for (NSInteger i = 0; i < menu.numberOfItems; i++) {
        NSMenuItem *item = [menu itemAtIndex:i];
        if (item.isSeparatorItem && lastWasSeparator) {
            [menu removeItemAtIndex:i];
            i--;
            continue;
        }
        lastWasSeparator = item.isSeparatorItem;
    }
    while (menu.numberOfItems > 0 && [menu itemAtIndex:menu.numberOfItems - 1].isSeparatorItem) {
        [menu removeItemAtIndex:menu.numberOfItems - 1];
    }
}

/// After every build of the bar (menus.zig finishPlatformMenus): see the top
/// of this file. `lang`: 0 zh, 1 en, 2 ja.
void chess_mac_menus_finish(int lang) {
    NSMenu *main = NSApp.mainMenu;
    if (main == nil || main.numberOfItems == 0) return;
    ChessMenuWords w = ChessWords(lang);
    NSMenu *appMenu = [main itemAtIndex:0].submenu;

    // the app menu's own items, in the language
    for (NSMenuItem *item in appMenu.itemArray) {
        SEL a = item.action;
        if (a == @selector(showAboutPanel:)) item.title = [NSString stringWithFormat:w.about, w.name];
        else if (a == @selector(hide:)) item.title = [NSString stringWithFormat:w.hide, w.name];
        else if (a == @selector(hideOtherApplications:)) item.title = w.hideOthers;
        else if (a == @selector(unhideAllApplications:)) item.title = w.showAll;
        else if (a == @selector(terminate:)) item.title = [NSString stringWithFormat:w.quit, w.name];
    }

    // 设置… into the app menu; 退出 / 关于 out of app.zon's menus
    NSMenuItem *settings = nil;
    for (NSInteger m = 1; m < main.numberOfItems; m++) {
        NSMenu *menu = [main itemAtIndex:m].submenu;
        for (NSMenuItem *item in [menu.itemArray copy]) {
            NSString *command = ChessCommandOf(item);
            if ([command isEqualToString:@"go.settings"]) {
                settings = item;
                [menu removeItem:item];
            } else if ([command isEqualToString:@"app.quit"] || [command isEqualToString:@"app.about"]) {
                [menu removeItem:item];
            }
        }
        ChessTidy(menu);
    }
    if (settings != nil && appMenu != nil) {
        NSInteger at = appMenu.numberOfItems > 0 ? 1 : 0;
        [appMenu insertItem:[NSMenuItem separatorItem] atIndex:at];
        [appMenu insertItem:settings atIndex:at + 1];
        ChessTidy(appMenu);
    }
    // a menu left empty (帮助 held only 关于) goes
    for (NSInteger m = main.numberOfItems - 1; m >= 1; m--) {
        if ([main itemAtIndex:m].submenu.numberOfItems == 0) [main removeItemAtIndex:m];
    }

    // Edit, after the first of app.zon's menus; Window, before 帮助 (last)
    NSMenuItem *editTop = [[NSMenuItem alloc] initWithTitle:w.edit action:nil keyEquivalent:@""];
    NSMenu *edit = [[NSMenu alloc] initWithTitle:w.edit];
    editTop.submenu = edit;
    [edit addItem:ChessItem(w.cut, @selector(cut:), @"x", NSEventModifierFlagCommand)];
    [edit addItem:ChessItem(w.copy, @selector(copy:), @"c", NSEventModifierFlagCommand)];
    [edit addItem:ChessItem(w.paste, @selector(paste:), @"v", NSEventModifierFlagCommand)];
    [edit addItem:ChessItem(w.selectAll, @selector(selectAll:), @"a", NSEventModifierFlagCommand)];
    [main insertItem:editTop atIndex:MIN((NSInteger)2, main.numberOfItems)];

    NSMenuItem *windowTop = [[NSMenuItem alloc] initWithTitle:w.window action:nil keyEquivalent:@""];
    NSMenu *window = [[NSMenu alloc] initWithTitle:w.window];
    windowTop.submenu = window;
    [window addItem:ChessItem(w.minimize, @selector(performMiniaturize:), @"m", NSEventModifierFlagCommand)];
    [window addItem:ChessItem(w.zoom, @selector(performZoom:), @"", 0)];
    [window addItem:ChessItem(w.fullScreen, @selector(toggleFullScreen:), @"f", NSEventModifierFlagCommand | NSEventModifierFlagControl)];
    [window addItem:[NSMenuItem separatorItem]];
    [window addItem:ChessItem(w.close, @selector(performClose:), @"w", NSEventModifierFlagCommand)];
    [window addItem:[NSMenuItem separatorItem]];
    [window addItem:ChessItem(w.front, @selector(arrangeInFront:), @"", 0)];
    NSInteger last = main.numberOfItems;
    NSString *helpTitle = lang == 1 ? @"Help" : lang == 2 ? @"ヘルプ" : @"帮助";
    if (last > 3 && [[main itemAtIndex:last - 1].title isEqualToString:helpTitle]) last -= 1;
    [main insertItem:windowTop atIndex:last];
    NSApp.windowsMenu = window;
}
