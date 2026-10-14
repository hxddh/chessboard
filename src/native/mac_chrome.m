// 11.0 W — the Mac window shell: the traffic lights inside the content.
//
// The SDK's hidden_inset titlebar drags only through its own canvas widgets;
// a page in a WKWebView that covers the titlebar has no way to say "this
// strip moves the window" (v10-1-plan §1, v11-0-plan §1). So the shell does
// it here, on its own windows, without touching the SDK:
//
//   - the content runs under a transparent titlebar (full-size content view,
//     title hidden; the traffic lights stay),
//   - a native strip covers the top 28 pt of the content view and takes the
//     mouse: a drag moves the window, a double-click does what the user's
//     "double-click a window's title bar" preference says,
//   - the strip is hidden in full screen, where the system hides the
//     titlebar, and the page is told so (data-chrome on <html>),
//   - the window's appearance follows the app's theme (light or dark
//     traffic lights, menus, sheets), set from the page through
//     chess.setChrome.
//
// The page leaves those 28 pt empty only when chess.setChrome answers
// inset:true, i.e. only when this ran: anywhere else (Windows, a browser,
// a build without this file) the layout is exactly what it was.
//
// Nothing here is compiled except on macOS (build.zig).

#import <AppKit/AppKit.h>
#import <WebKit/WebKit.h>
#import <objc/runtime.h>

static const CGFloat ChessStripHeight = 28.0;
static char ChessConfiguredKey;
static BOOL ChessAnyConfigured = NO;

@interface ChessDragStrip : NSView
@end

@implementation ChessDragStrip
- (BOOL)isOpaque { return NO; }
- (BOOL)acceptsFirstMouse:(NSEvent *)event { return YES; }
- (BOOL)mouseDownCanMoveWindow { return YES; }
- (void)mouseDown:(NSEvent *)event {
    NSWindow *window = self.window;
    if (!window) return;
    if (event.clickCount >= 2) {
        NSString *action = [[NSUserDefaults standardUserDefaults] stringForKey:@"AppleActionOnDoubleClick"];
        if (action == nil) action = @"Maximize";
        if ([action isEqualToString:@"Minimize"]) {
            [window performMiniaturize:nil];
        } else if (![action isEqualToString:@"None"]) {
            [window performZoom:nil];
        }
        return;
    }
    [window performWindowDragWithEvent:event];
}
@end

static WKWebView *ChessFindWebView(NSView *view) {
    if (view == nil) return nil;
    if ([view isKindOfClass:[WKWebView class]]) return (WKWebView *)view;
    for (NSView *sub in view.subviews) {
        WKWebView *found = ChessFindWebView(sub);
        if (found) return found;
    }
    return nil;
}

static void ChessTellPage(NSWindow *window, NSString *state) {
    WKWebView *web = ChessFindWebView(window.contentView);
    if (web == nil) return;
    NSString *js = [NSString stringWithFormat:@"document.documentElement.setAttribute('data-chrome','%@');", state];
    [web evaluateJavaScript:js completionHandler:nil];
}

static ChessDragStrip *ChessStripOf(NSWindow *window) {
    for (NSView *sub in window.contentView.subviews) {
        if ([sub isKindOfClass:[ChessDragStrip class]]) return (ChessDragStrip *)sub;
    }
    return nil;
}

/// The strip stays the topmost subview: the SDK may add or re-add its views
/// after this ran, and a view added later would sit over the strip.
static void ChessRaiseStrip(NSWindow *window) {
    ChessDragStrip *strip = ChessStripOf(window);
    NSView *content = window.contentView;
    if (strip == nil || content == nil) return;
    if (content.subviews.lastObject != strip) {
        [strip removeFromSuperview];
        [content addSubview:strip positioned:NSWindowAbove relativeTo:nil];
    }
}

static void ChessConfigure(NSWindow *window) {
    if (window == nil || objc_getAssociatedObject(window, &ChessConfiguredKey) != nil) {
        if (window) ChessRaiseStrip(window);
        return;
    }
    // only real document windows: not panels, sheets or the about box
    if ([window isKindOfClass:[NSPanel class]] || window.sheetParent != nil) return;
    if (!(window.styleMask & NSWindowStyleMaskTitled)) return;
    NSView *content = window.contentView;
    if (content == nil) return;
    // Only over a WKWebView: the page is told about full screen through it
    // (ChessTellPage), and a page that cannot be told would keep a stale
    // inset (Codex on #116 — the -Dweb-engine=chromium build hosts CEF). Not
    // there yet is not "never": nothing is marked, and the page's own
    // chess.setChrome, which can only come from a page that exists, runs
    // this again.
    if (ChessFindWebView(content) == nil) return;
    objc_setAssociatedObject(window, &ChessConfiguredKey, @YES, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

    window.styleMask |= NSWindowStyleMaskFullSizeContentView;
    window.titlebarAppearsTransparent = YES;
    window.titleVisibility = NSWindowTitleHidden;

    NSRect bounds = content.bounds;
    ChessDragStrip *strip = [[ChessDragStrip alloc] initWithFrame:NSMakeRect(0, NSMaxY(bounds) - ChessStripHeight, NSWidth(bounds), ChessStripHeight)];
    strip.autoresizingMask = NSViewWidthSizable | (content.isFlipped ? NSViewMaxYMargin : NSViewMinYMargin);
    if (content.isFlipped) strip.frame = NSMakeRect(0, 0, NSWidth(bounds), ChessStripHeight);
    [content addSubview:strip positioned:NSWindowAbove relativeTo:nil];
    ChessAnyConfigured = YES;

    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    [nc addObserverForName:NSWindowDidEnterFullScreenNotification object:window queue:nil usingBlock:^(NSNotification *note) {
        NSWindow *w = note.object;
        ChessStripOf(w).hidden = YES;
        ChessTellPage(w, @"full");
    }];
    [nc addObserverForName:NSWindowDidExitFullScreenNotification object:window queue:nil usingBlock:^(NSNotification *note) {
        NSWindow *w = note.object;
        ChessDragStrip *s = ChessStripOf(w);
        s.hidden = NO;
        ChessRaiseStrip(w);
        ChessTellPage(w, @"inset");
    }];
}

/// Called once, before the runner creates any window (main.zig): every
/// titled window that becomes key or main is configured the first time.
void chess_mac_chrome_init(void) {
    NSNotificationCenter *nc = [NSNotificationCenter defaultCenter];
    void (^configure)(NSNotification *) = ^(NSNotification *note) {
        if ([note.object isKindOfClass:[NSWindow class]]) ChessConfigure((NSWindow *)note.object);
    };
    [nc addObserverForName:NSWindowDidBecomeKeyNotification object:nil queue:nil usingBlock:configure];
    [nc addObserverForName:NSWindowDidBecomeMainNotification object:nil queue:nil usingBlock:configure];
}

/// chess.setChrome: the window's appearance from the app's theme (dark or
/// light), and whether the inset shell is on — the page leaves the strip's
/// 28 pt empty only when it is. Runs on the main thread (bridge handlers do).
int chess_mac_chrome_set(int dark) {
    NSApplication *app = [NSApplication sharedApplication];
    app.appearance = [NSAppearance appearanceNamed:(dark ? NSAppearanceNameDarkAqua : NSAppearanceNameAqua)];
    for (NSWindow *window in app.windows) ChessConfigure(window);
    if (!ChessAnyConfigured) return 0;
    // The answer is for the page that asked, not for any window that happens
    // to be full screen (Codex on #116): the page asking is in the key window
    // (a theme change is a click in it) or, at launch before anything is key,
    // the main one; failing both, the first window that carries a strip. The
    // full-screen observers tell each page about its own window afterwards.
    NSWindow *asking = app.keyWindow ?: app.mainWindow;
    if (!asking || !ChessStripOf(asking)) {
        asking = nil;
        for (NSWindow *window in app.windows) {
            if (ChessStripOf(window)) { asking = window; break; }
        }
    }
    return (asking && (asking.styleMask & NSWindowStyleMaskFullScreen)) ? 2 : 1;
}

/// 12.0 N: one light tap of a Force Touch trackpad — a piece set down by
/// dragging it. NSHapticFeedbackManager plays it only while a finger is on
/// such a trackpad, and silently does nothing anywhere else (a mouse, an
/// older trackpad), which is what a drop made with them should feel like.
int chess_mac_haptic(void) {
    [[NSHapticFeedbackManager defaultPerformer] performFeedbackPattern:NSHapticFeedbackPatternAlignment
                                                      performanceTime:NSHapticFeedbackPerformanceTimeNow];
    return 1;
}
