/**
 * Hash router: `#/learn`, `#/play/…`, `#/me`, `#/settings`.
 *
 * One page is mounted at a time. A page module is fetched with `import()` the
 * first time its route is visited and kept afterwards. A page module exports
 * `mount(el, ctx)` and may return an unmount function. Navigating while a
 * page is still loading supersedes it: only the latest navigation mounts.
 * @module router
 */
import { signal } from "./signal.js";

/** `#/play/abc/1` → { path: "/play", rest: ["abc", "1"] } */
export function parseHash(hash) {
  const raw = String(hash || "").replace(/^#/, "").split("?")[0];
  const parts = raw.split("/").filter(Boolean).map(decodeURIComponent);
  return { path: "/" + (parts[0] || ""), rest: parts.slice(1) };
}

function browserEnv() {
  return {
    get hash() { return location.hash; },
    replace(h) { history.replaceState(null, "", h); },
    push(h) { location.hash = h; },
    listen(fn) { addEventListener("hashchange", fn); return () => removeEventListener("hashchange", fn); },
  };
}

/**
 * @param {object} o
 * @param {Record<string, () => Promise<object>>} o.routes path → module loader
 * @param {HTMLElement} o.outlet where the page is mounted
 * @param {string} [o.fallback] path for an empty or unknown hash
 * @param {object} [o.context] passed to every page's mount, with `route` and `router` added
 * @param {object} [o.env] location adapter (tests)
 * @param {(tag: string) => HTMLElement} [o.createElement]
 */
export function createRouter({ routes, outlet, fallback = "/play", context = {}, env = browserEnv(),
  createElement = (t) => document.createElement(t) }) {
  const route = signal(parseHash(""));
  const modules = new Map();   // path → Promise<module>
  let mounted = null;          // { path, el, unmount }
  let token = 0;
  let unlisten = null;

  function load(path) {
    let p = modules.get(path);
    if (!p) {
      p = routes[path]();
      modules.set(path, p);
      // a failed fetch must not poison the next visit
      p.catch(() => modules.delete(path));
    }
    return p;
  }

  function unmount() {
    if (!mounted) return;
    const m = mounted;
    mounted = null;
    if (typeof m.unmount === "function") m.unmount();
    m.el.remove();
  }

  async function sync() {
    const r = parseHash(env.hash);
    if (!routes[r.path]) {
      if (!routes[fallback]) throw new Error("router: fallback " + fallback + " is not a route");
      env.replace("#" + fallback);
      seen = env.hash;
      return sync();
    }
    const same = mounted && mounted.path === r.path;
    route.value = r;
    if (same) return;
    const mine = ++token;
    let mod;
    try { mod = await load(r.path); }
    catch (e) {
      if (mine !== token) return;
      unmount();
      const el = createElement("div");
      el.className = "page-error";
      el.textContent = "页面加载失败：" + ((e && e.message) || e);
      outlet.append(el);
      mounted = { path: null, el, unmount: null };
      return;
    }
    if (mine !== token) return;
    unmount();
    const el = createElement("section");
    el.className = "page";
    el.dataset.page = r.path.slice(1);
    outlet.append(el);
    const mount = mod.mount || (mod.default && mod.default.mount) || mod.default;
    mounted = { path: r.path, el, unmount: null };
    mounted.unmount = mount(el, { ...context, route, router: api });
  }

  let pending = Promise.resolve();
  let seen = null;
  // go() syncs at once and the browser's hashchange follows later: one sync per hash
  const onChange = () => {
    if (env.hash === seen) return;
    seen = env.hash;
    pending = sync();
  };

  const api = {
    route,
    /** Navigate; resolves once the page is mounted. */
    go(path) {
      const h = "#" + (path.startsWith("/") ? path : "/" + path);
      if (env.hash !== h) env.push(h);
      onChange();
      return pending;
    },
    start() { unlisten = env.listen(onChange); onChange(); return pending; },
    stop() { if (unlisten) unlisten(); unlisten = null; seen = null; token++; unmount(); },
    /** Resolves once the latest navigation has settled (tests). */
    settled: () => pending,
    isLoaded: (path) => modules.has(path),
  };
  return api;
}
