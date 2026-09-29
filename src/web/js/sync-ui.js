/**
 * 从 Lichess / Chess.com 同步 —— 棋谱库上的那个对话框（v8-0-plan C2）。
 *
 * The plan counts five steps between a game played online and the same game
 * in this library: export it on the site, download it, import the file, and
 * type your name so the library knows which side was yours. This is one:
 * a user name and 同步. The games come from the native layer (main.zig
 * chess.fetchGames) because the page's CSP keeps connect-src 'self'; this
 * module never sees a URL.
 *
 * Nothing here runs unless the player asks: the dialog opens from its button,
 * a request goes out only from 同步, and only once 允许联网同步 is on — the
 * switch is off by default, and turning it on is itself a click (here or in
 * the preferences window).
 *
 * An on-demand chunk (chunk-sync.js): the first-paint bundle has no room for
 * a dialog most people open once, so even the switch's turning is here —
 * prefs-ui.js only paints it and loads this. It imports nothing: a second
 * copy of dialog.js in a chunk would be a second modal stack, so everything
 * it uses arrives in the bag prefs-ui.js hands it.
 *
 * v8-1-plan T4 (sync 2.0): a sync after the first asks only for what came
 * since — the native side answers with `last`, the newest game's time, kept
 * here per site and name and sent back as `since`; the dialog offers 20 / 50
 * / 100 games at most, says 已取到 k 局 while the fetch is out (it runs off
 * the shell's loop since N1, so chess.fetchProgress is answered meanwhile),
 * and can start the library's analysis once the games are in. The words for
 * all of it are read only here, in the chunk.
 * @module sync-ui
 */

/** What main.zig's name check allows (syncRequest): both sites' names. */
export function syncNameOk(name) {
  return typeof name === "string" && /^[A-Za-z0-9_-]{2,30}$/.test(name);
}

const SAY = {
  offline: "sync.offline", timeout: "sync.offline", bridge: "sync.offline",
  rate_limited: "sync.rate", not_found: "sync.notFound", bad_request: "sync.badName",
};

/**
 * The line to show for an answer, or null when there is nothing to say
 * because games came back. `arg` is the detail 同步没有完成（…） carries —
 * a status or a code from the fixed list, never text the answer brought.
 * @param {object|null} r what ChessHost.fetchGames resolved with
 * @param {boolean} [since] the request asked only for games since the last
 *   sync — then no games means nothing new, not no games at all (T4)
 * @returns {{key: string, arg?: string}|null}
 */
export function syncMessage(r, since) {
  if (r == null) return { key: "sync.noHost" };
  if (typeof r !== "object") return { key: "sync.failed", arg: "?" };
  if (r.error) {
    if (Object.prototype.hasOwnProperty.call(SAY, r.error)) return { key: SAY[r.error] };
    if (r.error === "http" && Number.isInteger(r.status)) return { key: "sync.failed", arg: "HTTP " + r.status };
    return { key: "sync.failed", arg: r.error === "parse" ? "parse" : "?" };
  }
  if (typeof r.pgn !== "string") return { key: "sync.failed", arg: "?" };
  if (r.count > 0 && r.pgn) return null;
  return { key: since ? "sync.none" : "sync.empty" };
}

const SITES = [{ id: "lichess", name: "Lichess" }, { id: "chesscom", name: "Chess.com" }];
/**
 * How many games one sync asks for at most (v8-1-plan T4): the newest of
 * those since the last sync. 8.0 had one fixed 20 — the first-paint budget
 * had no room for the words of a choice; they live in this chunk now.
 */
export const LIMITS = [20, 50, 100];

/** Where the last sync of `user` on `site` is remembered: names are case-blind on both sites. */
export function lastKey(site, user) {
  return site + ":" + String(user).toLowerCase();
}

/**
 * The stored "sync" key (persist.js), read defensively: off unless `on` is
 * really true, and anything else it does not recognise back to the default.
 * 8.0 stored {v, on, site, user}; the rest (T4) reads as its default there.
 * @returns {{on: boolean, site: "lichess"|"chesscom", user: string,
 *   max: number, analyse: boolean, last: Object<string, number>}}
 */
export function syncPrefs(v) {
  const s = v && typeof v === "object" ? v : {};
  const last = {};
  if (s.last && typeof s.last === "object" && !Array.isArray(s.last)) {
    for (const k of Object.keys(s.last)) {
      const t = s.last[k];
      if (Number.isSafeInteger(t) && t > 0) last[k] = t;
    }
  }
  return {
    on: s.on === true,
    site: s.site === "chesscom" ? "chesscom" : "lichess",
    user: typeof s.user === "string" ? s.user : "",
    max: LIMITS.includes(s.max) ? s.max : LIMITS[0],
    analyse: s.analyse === true,
    last,
  };
}

/**
 * What goes to the native side: the site, the name, how many at most, and —
 * once this name has been synced from this site — `since`, 1 ms after the
 * newest game that sync brought (T4). Nothing else about the person.
 */
export function syncRequest(prefs, site, user, max) {
  const p = { site, user, max };
  const last = prefs.last[lastKey(site, user)];
  if (last) p.since = last + 1;
  return p;
}

/**
 * The stored value with this sync's mark moved on — never back: an answer
 * without `last` (nothing new) leaves it where it was.
 */
export function withLast(stored, site, user, last) {
  const s = Object.assign({}, stored || {});
  if (!Number.isSafeInteger(last) || last <= 0) return s;
  const marks = syncPrefs(s).last;
  const k = lastKey(site, user);
  if (!(marks[k] >= last)) marks[k] = last;
  s.last = marks;
  return s;
}

/**
 * Ask the native side, and never hang. The native side keeps its own 60 s
 * deadline since v8-1-plan N1 (main.zig SYNC_DEADLINE_MS) and answers
 * "timeout" itself; the 75 s race is the backstop for a shell that never
 * answers. A refused call is "bridge", a non-object answer "parse".
 */
function ask(Host, p) {
  const call = Host.fetchGames(p).then((r) => (r == null || typeof r === "object" ? r : { error: "parse" }), () => ({ error: "bridge" }));
  return Promise.race([call, new Promise((ok) => setTimeout(() => ok({ error: "timeout" }), 75000))]);
}

/** How often the dialog asks for 已取到 k 局 while a sync is out. */
const PROGRESS_MS = 400;

/**
 * @param {object} d prefs-ui.js's bag: doc, t, tf, toast, Dlg, Host, store,
 *   Persist, lib (library-ui.js), paint() for the preferences switch
 */
export function createSyncUI(d) {
  const { doc, t, tf, Dlg, Host, Persist } = d;
  const stored = () => Persist.read("sync").value;
  const save = (patch) => Persist.setJson("sync", Object.assign({}, stored() || {}, patch, { v: 1 }));
  function setOn(on) { save({ on }); d.paint(); }
  let modal = null, busy = false;
  const pick = { site: "lichess", max: LIMITS[0], analyse: false };
  const $ = (id) => doc.getElementById(id);

  function el(tag, attrs, kids) {
    const n = doc.createElement(tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
    for (const c of kids || []) n.appendChild(c);
    return n;
  }
  /** A segment of buttons, each carrying its value in data-v. */
  function segment(id, labelledBy, items, onPick) {
    const row = el("div", { class: "theme-row", id, role: "group", "aria-labelledby": labelledBy });
    for (const it of items) {
      const b = el("button", { type: "button", "data-v": String(it.v) });
      b.textContent = it.text;
      b.onclick = () => { onPick(it.v); paint(); };
      row.appendChild(b);
    }
    return row;
  }
  function marks(row, value) {
    for (const b of row.children) {
      const on = b.dataset.v === String(value);
      b.classList.toggle("active", on);
      b.setAttribute("aria-pressed", on ? "true" : "false");
    }
  }

  function build() {
    const user = el("input", { type: "text", id: "sync-user", class: "text-input", spellcheck: "false",
      autocomplete: "off", autocapitalize: "off", maxlength: "30", "aria-describedby": "sync-note" });
    user.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
    const userK = el("label", { class: "setting-k", for: "sync-user" });
    userK.dataset.key = "sync.user";
    // T4: how many at most, of the games since the last sync
    const maxK = el("span", { class: "setting-k", id: "sync-max-k" });
    maxK.dataset.key = "sync.limit";
    const max = segment("sync-max", "sync-max-k", LIMITS.map((n) => ({ v: n, text: String(n) })), (v) => { pick.max = v; });
    // T4: start the library's analysis once the games are in (off by default)
    const anK = el("span", { class: "setting-k", id: "sync-analyse-k" });
    anK.dataset.key = "sync.analyse";
    const an = el("button", { type: "button", class: "switch", id: "sync-analyse", "aria-pressed": "false", "aria-labelledby": "sync-analyse-k" },
      [el("span", { class: "switch-knob" })]);
    an.onclick = () => { pick.analyse = !pick.analyse; save({ analyse: pick.analyse }); paint(); };
    const list = el("div", { class: "setting-list" }, [
      el("div", { class: "setting-row stack" }, [segment("sync-site", "sync-title", SITES.map((s) => ({ v: s.id, text: s.name })), (v) => { pick.site = v; })]),
      el("div", { class: "setting-row stack" }, [userK, user]),
      el("div", { class: "setting-row stack" }, [maxK, max]),
      el("div", { class: "setting-row" }, [anK, an]),
    ]);
    const title = el("h3", { id: "sync-title" });
    title.dataset.key = "lib.sync";
    const note = el("p", { class: "hint", id: "sync-note", role: "status" });
    const allow = el("button", { type: "button", class: "act-btn", id: "sync-allow" });
    allow.dataset.key = "sync.allow";
    allow.onclick = () => { setOn(true); paint(); user.focus(); };
    const close = el("button", { type: "button", class: "tool-btn", id: "sync-close" });
    close.dataset.key = "act.close";
    close.onclick = () => Dlg.close(modal);
    const goBtn = el("button", { type: "button", class: "act-btn primary", id: "sync-go" });
    goBtn.dataset.key = "sync.go";
    goBtn.onclick = () => { go(); };
    modal = el("div", { class: "modal-bg", id: "sync-modal", role: "dialog", "aria-labelledby": "sync-title" }, [
      el("div", { class: "modal" }, [title, list, note,
        el("div", { class: "close-row split" }, [allow, el("span", { class: "btn-pair" }, [close, goBtn])])]),
    ]);
    modal.addEventListener("click", (ev) => { if (ev.target === modal) Dlg.close(modal); });
    doc.body.appendChild(modal);
  }

  /** Words, the segments' marks and what may be pressed, from the state. */
  function paint(line) {
    const p = syncPrefs(stored());
    const host = Host.hasZero();
    // text written only where it differs: an answer can land while a button
    // here is held down, and rewriting it then loses the click (7.6)
    const put = (n, s) => { if (n.textContent !== s) n.textContent = s; };
    for (const n of modal.querySelectorAll("[data-key]")) put(n, t(n.dataset.key));
    marks($("sync-site"), pick.site);
    marks($("sync-max"), pick.max);
    $("sync-analyse").setAttribute("aria-pressed", pick.analyse ? "true" : "false");
    $("sync-allow").hidden = p.on || !host;
    $("sync-go").disabled = busy || !p.on || !host;
    put($("sync-note"), line != null ? line : !host ? t("sync.noHost") : !p.on ? t("sync.hint") : "");
  }

  function open() {
    if (!modal) build();
    const p = syncPrefs(stored());
    pick.site = p.site;
    pick.max = p.max;
    pick.analyse = p.analyse;
    $("sync-user").value = p.user;
    paint();
    Dlg.open(modal, $("sync-user"));
  }

  /**
   * 你在棋谱里的名字, filled in for the player (v8-0-plan C2): the account
   * the games were fetched for is the one name that is certainly theirs.
   * Added, never replacing the names already there — someone syncing both
   * sites has two.
   */
  function claim(user) {
    const { store, lib } = d;
    const names = store.session.libNames || [];
    if (names.some((n) => n.toLowerCase() === user.toLowerCase())) return;
    store.session.libNames = names.concat([user]);
    lib.reclaimLibrary();
    lib.saveLibrary();
    const field = $("lib-names");
    if (field) field.value = store.session.libNames.join(", ");
  }

  /**
   * 已取到 k 局 while the fetch is out (T4): the native side counts Lichess's
   * stream as it arrives and Chess.com month by month; this asks every
   * PROGRESS_MS and writes the line only when the count has moved.
   */
  function watchProgress(site) {
    if (typeof Host.fetchProgress !== "function") return () => {};
    let shown = 0, asking = false;
    const timer = setInterval(() => {
      if (asking) return;
      asking = true;
      Host.fetchProgress().then((r) => {
        asking = false;
        if (!busy || !r || !r.busy || !(r.count > shown)) return;
        shown = r.count;
        paint(tf("sync.progress", [site.name, shown]));
      }, () => { asking = false; });
    }, PROGRESS_MS);
    return () => clearInterval(timer);
  }

  /**
   * T4: 同步完就开始分析 — the library's own batch pass, the one 分析剩下的 N 局
   * starts. It is the background work of the engine: whatever schedules the
   * engine (v8-1-plan F4) puts it behind the game and the live analysis.
   * Not when a pass is already running (the button would stop it).
   */
  function analyseSynced() {
    const s = d.store.session;
    if (s.libRun || s.analyzing || s.libUnreadable) return;
    d.lib.runLibraryPass();
  }

  async function go() {
    if (busy || !syncPrefs(stored()).on || !Host.hasZero()) return;
    const site = SITES.find((s) => s.id === pick.site) || SITES[0];
    const user = $("sync-user").value.trim();
    if (!syncNameOk(user)) { paint(t("sync.badName")); $("sync-user").focus(); return; }
    // M5 review P3-2: the import would refuse these games once they were
    // fetched (a pass running, the library read-only) — said here, before
    // the fetch and again after it, with the dialog left open
    const s = d.store.session;
    const refusal = () => (s.libUnreadable ? "lib.unreadable" : s.libRun || s.analyzing ? "lib.busy" : "");
    if (refusal()) { paint(t(refusal())); return; }
    save({ site: site.id, user, max: pick.max, analyse: pick.analyse });
    const req = syncRequest(syncPrefs(stored()), site.id, user, pick.max);
    busy = true;
    paint(tf("sync.fetching", [site.name]));
    const stop = watchProgress(site);
    let r;
    try { r = await ask(Host, req); } catch (_) { r = { error: "bridge" }; }
    stop();
    busy = false;
    const said = syncMessage(r, req.since != null);
    if (said) {
      paint(said.key === "sync.failed" ? tf(said.key, [said.arg]) : tf(said.key, [site.name, user]));
      return;
    }
    if (refusal()) { paint(t(refusal())); return; }
    // v8-0-plan C2: the name is claimed before the import, so the games come
    // in already knowing which side was this player's — no field to fill in
    claim(user);
    Dlg.close(modal);
    // library-ui.js's one import path — the same one 导入棋谱文件 takes, so the
    // games land pending, which is the library's analysis queue
    await d.lib.importPgnToLibrary(r.pgn, site.name + " · " + user);
    // T4: the mark moves after the import has run, not when the answer came
    // — a page closed in between asks for the same games again next time
    Persist.setJson("sync", Object.assign(withLast(stored(), site.id, user, r.last), { v: 1 }));
    if (pick.analyse) analyseSynced();
  }

  return { open, toggle: () => setOn(!syncPrefs(stored()).on) };
}
