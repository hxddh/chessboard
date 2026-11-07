import { createRouter, parseHash } from "../../src/app/lib/router.js";
import { effect } from "../../src/app/lib/signal.js";

/** A location stand-in: push fires the listener later, like the browser's hashchange. */
function fakeEnv(initial = "") {
  let hash = initial;
  const fns = new Set();
  return {
    get hash() { return hash; },
    replace(h) { hash = h; },
    push(h) { hash = h; queueMicrotask(() => fns.forEach((f) => f())); },
    listen(fn) { fns.add(fn); return () => fns.delete(fn); },
    /** a user typing in the address bar */
    set(h) { hash = h; fns.forEach((f) => f()); },
  };
}

function fakeEl(tag) {
  const el = { tag, children: [], dataset: {}, className: "", textContent: "", parent: null,
    append(c) { c.parent = el; el.children.push(c); },
    remove() { if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1); el.parent = null; } };
  return el;
}

function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}

function pages(log) {
  const loads = {};
  const page = (name) => ({
    mount(el, ctx) {
      log.push("mount " + name);
      el.textContent = name;
      return () => log.push("unmount " + name);
    },
  });
  const routes = {};
  for (const n of ["learn", "play", "me", "settings"]) {
    loads[n] = 0;
    routes["/" + n] = () => { loads[n]++; return Promise.resolve(page(n)); };
  }
  return { routes, loads };
}

export default function (test) {
  test("parseHash", (a) => {
    a.deepEqual(parseHash("#/play/abc/2"), { path: "/play", rest: ["abc", "2"] });
    a.deepEqual(parseHash(""), { path: "/", rest: [] });
    a.deepEqual(parseHash("#/me?x=1"), { path: "/me", rest: [] });
    a.deepEqual(parseHash("#/learn/a%20b"), { path: "/learn", rest: ["a b"] });
  });

  test("an empty or unknown hash goes to the fallback", async (a) => {
    const log = [], { routes } = pages(log);
    const env = fakeEnv("#/nowhere");
    const outlet = fakeEl("main");
    const r = createRouter({ routes, outlet, env, createElement: fakeEl });
    await r.start();
    a.equal(env.hash, "#/play");
    a.deepEqual(log, ["mount play"]);
    a.equal(outlet.children.length, 1);
    a.equal(outlet.children[0].dataset.page, "play");
  });

  test("each page module is imported once, on its first visit", async (a) => {
    const log = [], { routes, loads } = pages(log);
    const env = fakeEnv("#/play");
    const outlet = fakeEl("main");
    const r = createRouter({ routes, outlet, env, createElement: fakeEl });
    await r.start();
    a.equal(loads.learn, 0, "learn not fetched before it is visited");
    a.ok(!r.isLoaded("/learn"));
    await r.go("/learn");
    await r.go("/play");
    await r.go("/learn");
    a.deepEqual(loads, { learn: 1, play: 1, me: 0, settings: 0 });
    a.deepEqual(log, ["mount play", "unmount play", "mount learn", "unmount learn", "mount play", "unmount play", "mount learn"]);
    a.equal(outlet.children.length, 1, "one page at a time");
  });

  test("the browser's late hashchange after go() does not remount", async (a) => {
    const log = [], { routes } = pages(log);
    const env = fakeEnv("#/play");
    const r = createRouter({ routes, outlet: fakeEl("main"), env, createElement: fakeEl });
    await r.start();
    await r.go("/me");
    await new Promise((res) => setTimeout(res, 0));
    a.deepEqual(log, ["mount play", "unmount play", "mount me"]);
  });

  test("hash typed by the user navigates", async (a) => {
    const log = [], { routes } = pages(log);
    const env = fakeEnv("#/play");
    const r = createRouter({ routes, outlet: fakeEl("main"), env, createElement: fakeEl });
    await r.start();
    env.set("#/settings");
    await r.settled();
    a.equal(log[log.length - 1], "mount settings");
  });

  test("params change on the same page updates route, does not remount", async (a) => {
    const log = [], { routes } = pages(log);
    const env = fakeEnv("#/play/g1");
    const r = createRouter({ routes, outlet: fakeEl("main"), env, createElement: fakeEl });
    await r.start();
    const seen = [];
    effect(() => { seen.push(r.route.value.rest.join("/")); });
    await r.go("/play/g2");
    a.deepEqual(log, ["mount play"]);
    a.deepEqual(seen, ["g1", "g2"]);
  });

  test("a slow page superseded by a later navigation never mounts", async (a) => {
    const log = [];
    const slow = deferred();
    const routes = {
      "/play": () => Promise.resolve({ mount: () => { log.push("mount play"); } }),
      "/learn": () => slow.promise,
      "/me": () => Promise.resolve({ mount: () => { log.push("mount me"); } }),
    };
    const env = fakeEnv("#/play");
    const outlet = fakeEl("main");
    const r = createRouter({ routes, outlet, env, createElement: fakeEl });
    await r.start();
    const first = r.go("/learn");
    await r.go("/me");
    slow.resolve({ mount: () => { log.push("mount learn"); } });
    await first;
    a.deepEqual(log, ["mount play", "mount me"]);
    a.equal(outlet.children.length, 1);
  });

  test("a failed import shows an error and is retried on the next visit", async (a) => {
    let n = 0;
    const routes = {
      "/play": () => Promise.resolve({ mount: () => {} }),
      "/learn": () => (++n === 1 ? Promise.reject(new Error("offline")) : Promise.resolve({ mount: (el) => { el.textContent = "ok"; } })),
    };
    const env = fakeEnv("#/learn");
    const outlet = fakeEl("main");
    const r = createRouter({ routes, outlet, env, createElement: fakeEl });
    await r.start();
    a.ok(/offline/.test(outlet.children[0].textContent));
    await r.go("/play");
    await r.go("/learn");
    a.equal(n, 2);
    a.equal(outlet.children[0].textContent, "ok");
  });

  test("pages receive the shared context", async (a) => {
    let got = null;
    const routes = { "/play": () => Promise.resolve({ mount: (el, ctx) => { got = ctx; } }) };
    const r = createRouter({ routes, outlet: fakeEl("main"), env: fakeEnv(""), createElement: fakeEl, context: { db: "DB" } });
    await r.start();
    a.equal(got.db, "DB");
    a.equal(got.router, r);
    a.equal(got.route.value.path, "/play");
  });

  test("stop unmounts", async (a) => {
    const log = [], { routes } = pages(log);
    const outlet = fakeEl("main");
    const r = createRouter({ routes, outlet, env: fakeEnv("#/me"), createElement: fakeEl });
    await r.start();
    r.stop();
    a.deepEqual(log, ["mount me", "unmount me"]);
    a.equal(outlet.children.length, 0);
  });
}
