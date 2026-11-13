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

/* Every top-level window of this process with a caption. */
static BOOL CALLBACK chess_chrome_each(HWND hwnd, LPARAM lp) {
    ChessChromeWalk *w = (ChessChromeWalk *)lp;
    DWORD pid = 0;
    GetWindowThreadProcessId(hwnd, &pid);
    /* not only the visible ones: at boot the host may not have shown its
       window yet when the page first asks */
    if (pid != GetCurrentProcessId()) return TRUE;
    if ((GetWindowLongPtrW(hwnd, GWL_STYLE) & WS_CAPTION) != WS_CAPTION) return TRUE;
    BOOL dark = w->dark;
    if (FAILED(w->set(hwnd, CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE, &dark, sizeof dark)))
        w->set(hwnd, CHESS_DWMWA_USE_IMMERSIVE_DARK_MODE_OLD, &dark, sizeof dark);
    int backdrop = CHESS_DWMSBT_MAINWINDOW;
    if (SUCCEEDED(w->set(hwnd, CHESS_DWMWA_SYSTEMBACKDROP_TYPE, &backdrop, sizeof backdrop))) w->mica++;
    /* Windows 10 does not repaint the frame for the attribute by itself */
    SetWindowPos(hwnd, NULL, 0, 0, 0, 0, SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);
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

/*
 * 22.0 F5 / 23.0: the language for a first launch that has no saved choice
 * yet: 0 Chinese, 1 English, 2 Japanese. Walks the user's preferred UI
 * languages in order, the way the page's detectLang (lang-ids.js) walks
 * navigator.languages — WebView2 derives that list from the same preference —
 * and takes the first one of ours; none of ours is English, as on the page.
 * 22.0 looked at the first language only, so ["fr", "ja"] gave an English
 * menu bar over a Japanese page (review-22.0 §3.1-1).
 *
 * GetUserPreferredUILanguages is looked up at run time like dwmapi above, so
 * the header's _WIN32_WINNT does not matter; without it, the single default
 * UI language is the answer, as in 22.0.
 */
typedef BOOL (WINAPI *ChessPreferredUiLangsFn)(DWORD, PULONG, PZZWSTR, PULONG);
#define CHESS_MUI_LANGUAGE_NAME 0x8

static int chess_lang_code_of(const WCHAR *tag) {
    /* "zh-CN", "zh-Hant-TW", "ja-JP", "en-US" … : the primary subtag decides */
    WCHAR a = tag[0] | 0x20, b = tag[1] | 0x20, c = tag[2];
    if (c != 0 && c != L'-' && c != L'_') return -1;
    if (a == L'z' && b == L'h') return 0;
    if (a == L'e' && b == L'n') return 1;
    if (a == L'j' && b == L'a') return 2;
    return -1;
}

int chess_win_ui_language(void) {
    HMODULE k32 = GetModuleHandleW(L"kernel32.dll");
    ChessPreferredUiLangsFn get = k32 ? (ChessPreferredUiLangsFn)(void *)GetProcAddress(k32, "GetUserPreferredUILanguages") : NULL;
    if (get) {
        WCHAR buf[512];
        ULONG count = 0, len = (ULONG)(sizeof buf / sizeof buf[0]);
        if (get(CHESS_MUI_LANGUAGE_NAME, &count, buf, &len)) {
            for (const WCHAR *p = buf; p < buf + len && *p; p += lstrlenW(p) + 1) {
                int code = chess_lang_code_of(p);
                if (code >= 0) return code;
            }
            return 1;
        }
    }
    switch (PRIMARYLANGID(GetUserDefaultUILanguage())) {
        case LANG_CHINESE: return 0;
        case LANG_JAPANESE: return 2;
        default: return 1;
    }
}
