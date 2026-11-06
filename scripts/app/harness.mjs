/**
 * A small test runner for scripts/test-app.mjs: named cases, plain asserts,
 * one summary line. Works in Node and in the browser (the db and engine
 * contract suites run in both), so it uses nothing from Node.
 * @module app/harness
 */
export function createHarness(log = console.log) {
  const cases = [];
  let passed = 0, failed = 0;
  const failures = [];

  function test(name, fn) { cases.push({ name, fn }); }

  function fmt(v) { try { return JSON.stringify(v); } catch { return String(v); } }
  function deepEqual(a, b) {
    if (Object.is(a, b)) return true;
    if (typeof a !== "object" || typeof b !== "object" || !a || !b) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => deepEqual(a[k], b[k]));
  }
  const assert = {
    ok(cond, msg) { if (!cond) throw new Error(msg || "expected truthy"); },
    equal(a, b, msg) { if (!Object.is(a, b)) throw new Error((msg ? msg + ": " : "") + fmt(a) + " !== " + fmt(b)); },
    deepEqual(a, b, msg) { if (!deepEqual(a, b)) throw new Error((msg ? msg + ": " : "") + fmt(a) + " ≠ " + fmt(b)); },
    async rejects(p, msg) {
      try { await (typeof p === "function" ? p() : p); } catch { return; }
      throw new Error(msg || "expected a rejection");
    },
    throws(fn, msg) {
      try { fn(); } catch { return; }
      throw new Error(msg || "expected a throw");
    },
  };

  async function run(prefix = "") {
    for (const c of cases) {
      try { await c.fn(assert); passed++; }
      catch (e) { failed++; failures.push(prefix + c.name); log("FAIL: " + prefix + c.name + " — " + (e && e.stack || e)); }
    }
    cases.length = 0;
    return { passed, failed, failures };
  }
  return { test, assert, run };
}
