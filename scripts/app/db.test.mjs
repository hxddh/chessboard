import { createDb, memoryBackend, cmpKey, newId, MIGRATIONS, SCHEMA_VERSION } from "../../src/app/services/db.js";
import dbContract from "./db-contract.mjs";

const stores = new Map();
const open = (name) => {
  if (!stores.has(name)) stores.set(name, {});
  return createDb(memoryBackend(stores.get(name)));
};

export default function (test) {
  dbContract(test, open, "memory: ");

  test("cmpKey follows IndexedDB order", (a) => {
    const keys = [["b", 2], "b", 10, ["a", 10], ["a", 2], "a", 2, ["a"], Infinity];
    keys.sort(cmpKey);
    a.deepEqual(keys, [2, 10, Infinity, "a", "b", ["a"], ["a", 2], ["a", 10], ["b", 2]]);
  });

  test("newId sorts by time", (a) => {
    const ids = [newId(1e12), newId(1e12 + 1), newId(2e12), newId(Date.UTC(2058, 0))];
    a.deepEqual(ids.slice().sort(), ids);
    a.equal(ids[0].length, 13);
  });

  test("schema v1 is one migration", (a) => {
    a.equal(SCHEMA_VERSION, 1);
    const made = [];
    MIGRATIONS[0]((name, key) => made.push(name));
    a.equal(made.length, 9);
  });

  test("a failed write rejects its appends and later ones still land", async (a) => {
    const back = memoryBackend({});
    let fail = true;
    const write = back.write;
    back.write = (ops) => (fail ? Promise.reject(new Error("disk full")) : write(ops));
    const db = await createDb(back);
    await a.rejects(db.append({ type: "note" }));
    fail = false;
    await db.append({ type: "note" });
    a.equal(await db.query("table.count", { table: "events" }), 1);
  });
}
