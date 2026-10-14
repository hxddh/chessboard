/*
 * 12.0 N — the Windows window's own chrome: the title bar follows the
 * page's theme (dark for 木 and 夜, light for 日 and 纸), and on Windows 11
 * the window's backdrop is Mica, which the system draws in the title bar.
 *
 * Through 11.0 the title bar was the system's default, a white or grey band
 * over a dark board in two of the four themes. The SDK's Windows host has
 * no call for either attribute, so, like the Mac's mac_chrome.m, this is the
 * app's own native code (registered as an SDK difference, B15).
 *
 * dwmapi is loaded at run time rather than linked: both attributes are newer
 * than the oldest Windows the app starts on, and a failed call (Windows 10
 * has no system backdrop; builds before 20H1 number the dark-mode attribute
 * 19, not 20) is simply skipped.
 *
 * Called from chrome.zig (chess.setChrome) on the Windows platform only.
 */
#include <windows.h>

typedef HRESULT (WINAPI *DwmSetWindowAttributeFn)(HWND, DWORD, LPCVOID, DWORD);

enum {
    CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE_OLD = 19,
    CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE = 20,
    CHESS_DWMWA_SYSTEMBACKDROP_TYPE = 38,
    CHESS_DWMSBT_MAINWINDOW = 2, /* Mica */
};

static DwmSetWindowAttributeFn chess_dwm_set(void) {
    static DwmSetWindowAttributeFn fn = NULL;
    static int tried = 0;
    if (!tried) {
        tried = 1;
        HMODULE dwm = LoadLibraryW(L"dwmapi.dll");
        if (dwm) fn = (DwmSetWindowAttributeFn)(void *)GetProcAddress(dwm, "DwmSetWindowAttribute");
    }
    return fn;
}

typedef struct {
    DwmSetWindowAttributeFn set;
    BOOL dark;
    int windows;
    int mica;
} ChessChromeWalk;

/* Every visible top-level window of this process with a caption. */
static BOOL CALLBACK chess_chrome_each(HWND hwnd, LPARAM lp) {
    ChessChromeWalk *w = (ChessChromeWalk *)lp;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    if (pid != GetCurrentProcessId() || !IsWindowVisible(hwnd)) return TRUE;
    if ((GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_CAPTION) != WS_CAPTION) return TRUE;
    BOOL dark = w->dark;
    if (FAILED(w->set(hwnd, CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark)))
        w->set(hwnd, CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, &dark, sizeof dark);
    int backdrop = CHESS_DWMSBT_MAINWINDOW;
    if (SUCCEEDED(w->set(hwnd, CHESS_DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof backdrop))) w->mica++;
    w->windows++;
    return TRUE;
}

/*
 * Returns how many windows took the theme, with 0x100 added when Mica took
 * too — the Zig side reports both to the page's self-test, nothing else.
 */
int chess_win_chrome_set(int dark) {
    DwmSetWindowAttributeFn set = chess_dwm_set();
    if (!set) return 0;
    ChessChromeWalk w = { set, dark ? TRUE : FALSE, 0, 0 };
    EnumWindows(chess_chrome_each, (LPARAM)&w);
    return w.windows + (w.mica ? 0x100 : 0);
}
