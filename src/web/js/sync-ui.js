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
 * a dialog most people open once. So it imports nothing — a second copy of
 * dialog.js in a chunk would be a second modal stack — and everything it uses
 * arrives in the bag net-sync.js hands it.
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
 * @returns {{key: string, arg?: string}|null}
 */
export function syncMessage(r) {
  if (r == null) return { key: "sync.noHost" };
  if (typeof r !== "object") return { key: "sync.failed", arg: "?" };
  if (r.error) {
    if (Object.prototype.hasOwnProperty.call(SAY, r.error)) return { key: SAY[r.error] };
    if (r.error === "http" && Number.isInteger(r.status)) return { key: "sync.failed", arg: "HTTP " + r.status };
    return { key: "sync.failed", arg: r.error === "parse" ? "parse" : "?" };
  }
  if (typeof r.pgn !== "string") return { key: "sync.failed", arg: "?" };
  return r.count > 0 && r.pgn ? null : { key: "sync.empty" };
}

const SITES = [{ id: "lichess", name: "Lichess" }, { id: "chesscom", name: "Chess.com" }];
const COUNTS = [20, 50];

/**
 * The stored "sync" key (net-sync.js), read defensively: off unless `on` is
 * really true, and anything else it does not recognise back to the default.
 * @returns {{on: boolean, site: "lichess"|"chesscom", user: string, n: number}}
 */
export function syncPrefs(v) {
  const s = v && typeof v === "object" ? v : {};
  return {
    on: s.on === true,
    site: s.site === "chesscom" ? "chesscom" : "lichess",
    user: typeof s.user === "string" ? s.user : "",
    n: COUNTS.includes(s.n) ? s.n : COUNTS[0],
  };
}

/**
 * @param {object} d net-sync.js's bag: doc, t, tf, Dlg, Host, store, lib
 *   (library-ui.js), stored() and save(patch) for the "sync" key, setOn(on)
 */
export function createSyncUI(d) {
  const { doc, t, tf, Dlg, Host } = d;
  let modal = null, busy = false;
  const pick = { site: "lichess", n: 20 };
  const $ = (id) => doc.getElementById(id);

  function el(tag, attrs, kids) {
    const n = doc.createElement(tag);
    for (const k of Object.keys(attrs || {})) n.setAttribute(k, attrs[k]);
    for (const c of kids || []) n.appendChild(c);
    return n;
  }
  /** A 网站 / 局数 segment: buttons that say which one is on. */
  function seg(id, label, items, onPick) {
    const row = el("div", { class: "theme-row", id, role: "group", "aria-labelledby": id + "-k" });
    for (const it of items) {
      const b = el("button", { type: "button", "data-v": String(it.v) });
      b.textContent = it.label;
      b.onclick = () => { onPick(it.v); paint(); };
      row.appendChild(b);
    }
    const k = el("span", { class: "setting-k", id: id + "-k" });
    k.dataset.key = label;
    return el("div", { class: "setting-row stack" }, [k, row]);
  }

  function build() {
    const user = el("input", { type: "text", id: "sync-user", class: "text-input", spellcheck: "false",
      autocomplete: "off", autocapitalize: "off", maxlength: "30", "aria-describedby": "sync-note" });
    user.onkeydown = (ev) => { if (ev.key === "Enter") { ev.preventDefault(); go(); } };
    const userK = el("label", { class: "setting-k", for: "sync-user" });
    userK.dataset.key = "sync.user";
    const list = el("div", { class: "setting-list" }, [
      seg("sync-site", "sync.site", SITES.map((s) => ({ v: s.id, label: s.name })), (v) => { pick.site = v; }),
      el("div", { class: "setting-row stack" }, [userK, user]),
      seg("sync-n", "sync.count", COUNTS.map((n) => ({ v: n, label: String(n) })), (v) => { pick.n = v; }),
    ]);
    const title = el("h3", { id: "sync-title" });
    title.dataset.key = "sync.title";
    const note = el("p", { class: "hint", id: "sync-note", role: "status" });
    const allow = el("button", { type: "button", class: "act-btn", id: "sync-allow" });
    allow.dataset.key = "sync.allow";
    allow.onclick = () => { d.setOn(true); paint(); user.focus(); };
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
    const p = syncPrefs(d.stored());
    const host = Host.hasZero();
    // text written only where it differs: an answer can land while a button
    // here is held down, and rewriting it then loses the click (7.6)
    const put = (n, s) => { if (n.textContent !== s) n.textContent = s; };
    for (const n of modal.querySelectorAll("[data-key]")) put(n, t(n.dataset.key));
    for (const [id, v] of [["sync-site", pick.site], ["sync-n", pick.n]]) {
      for (const b of $(id).children) {
        const on = b.dataset.v === String(v);
        b.classList.toggle("active", on);
        b.setAttribute("aria-pressed", on ? "true" : "false");
      }
    }
    $("sync-allow").hidden = p.on || !host;
    $("sync-go").disabled = busy || !p.on || !host;
    put($("sync-note"), line != null ? line : !host ? t("sync.noHost") : !p.on ? t("sync.hint") : "");
  }

  function open() {
    if (!modal) build();
    const p = syncPrefs(d.stored());
    pick.site = p.site;
    pick.n = p.n;
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

  async function go() {
    if (busy || !syncPrefs(d.stored()).on || !Host.hasZero()) return;
    const site = SITES.find((s) => s.id === pick.site) || SITES[0];
    const user = $("sync-user").value.trim();
    if (!syncNameOk(user)) { paint(t("sync.badName")); $("sync-user").focus(); return; }
    d.save({ site: site.id, user, n: pick.n });
    busy = true;
    paint(tf("sync.fetching", [site.name]));
    let r;
    try { r = await Host.fetchGames(site.id, user, pick.n); } catch (_) { r = { error: "bridge" }; }
    busy = false;
    const said = syncMessage(r);
    if (said) {
      paint(said.key === "sync.failed" ? tf(said.key, [said.arg]) : tf(said.key, [site.name, user]));
      return;
    }
    // v8-0-plan C2: the name is claimed before the import, so the games come
    // in already knowing which side was this player's — no field to fill in
    claim(user);
    Dlg.close(modal);
    // library-ui.js's one import path — the same one 导入棋谱文件 takes, so the
    // games land pending, which is the library's analysis queue
    d.lib.importPgnToLibrary(r.pgn, site.name + " · " + user);
  }

  return { open };
}
