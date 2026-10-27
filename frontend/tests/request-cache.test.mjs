import test from "node:test";
import assert from "node:assert/strict";

// Native Node tests: no browser, network, account or storage. Run with: node --test tests/request-cache.test.mjs
const load = () => import(`../src/api/requestCache.js?case=${crypto.randomUUID()}`);

test("a stored answer is returned, and clearing empties the store", async () => {
  const cache = await load();
  assert.equal(cache.readRequestCache("book:1"), null);
  cache.writeRequestCache("book:1", { id: 1 });
  assert.deepEqual(cache.readRequestCache("book:1").data, { id: 1 });
  cache.writeRequestCache("workspace:2:7", { entry: { id: 7 } });
  cache.clearRequestCache();
  assert.equal(cache.requestCacheSize(), 0);
  assert.equal(cache.readRequestCache("book:1"), null);
});

test("the store keeps the 100 most recently used entries", async () => {
  const cache = await load();
  for (let index = 0; index < 100; index += 1) cache.writeRequestCache(`k${index}`, index);
  cache.readRequestCache("k0"); // touching k0 makes k1 the oldest
  cache.writeRequestCache("k100", 100);
  assert.equal(cache.requestCacheSize(), 100);
  assert.equal(cache.readRequestCache("k1"), null);
  assert.equal(cache.readRequestCache("k0").data, 0);
  assert.equal(cache.readRequestCache("k100").data, 100);
});

test("an entry older than ten minutes is not served", async (t) => {
  const cache = await load();
  const realNow = Date.now;
  t.after(() => { Date.now = realNow; });
  cache.writeRequestCache("old", "value");
  Date.now = () => realNow() + 11 * 60 * 1000;
  assert.equal(cache.readRequestCache("old"), null);
});

test("prefetch asks once per key, fills the store, and stays silent on failure", async () => {
  const cache = await load();
  let calls = 0;
  const load1 = async () => { calls += 1; return { id: 1 }; };
  cache.prefetchRequest("book:1", load1);
  cache.prefetchRequest("book:1", load1);
  await new Promise(done => setTimeout(done, 10));
  assert.equal(calls, 1);
  assert.deepEqual(cache.readRequestCache("book:1").data, { id: 1 });
  cache.prefetchRequest("book:1", load1);
  await new Promise(done => setTimeout(done, 10));
  assert.equal(calls, 1);
  cache.prefetchRequest("book:2", async () => { throw new Error("offline"); });
  await new Promise(done => setTimeout(done, 10));
  assert.equal(cache.readRequestCache("book:2"), null);
});

test("an answer that arrives after a clear is not stored", async () => {
  const cache = await load();
  let finish;
  cache.prefetchRequest("home:1", () => new Promise(done => { finish = done; }));
  await new Promise(done => setTimeout(done, 5));
  cache.clearRequestCache();
  finish({ private: true });
  await new Promise(done => setTimeout(done, 10));
  assert.equal(cache.readRequestCache("home:1"), null);
});

test("the store never touches web storage", async () => {
  const touched = [];
  globalThis.localStorage = new Proxy({}, { get: (_, name) => { touched.push(String(name)); return () => null; } });
  globalThis.sessionStorage = globalThis.localStorage;
  try {
    const cache = await load();
    cache.writeRequestCache("home:1", { entry: 1 });
    cache.readRequestCache("home:1");
    cache.prefetchRequest("book:3", async () => ({ id: 3 }));
    await new Promise(done => setTimeout(done, 10));
    cache.clearRequestCache();
  } finally {
    delete globalThis.localStorage;
    delete globalThis.sessionStorage;
  }
  assert.deepEqual(touched, []);
});

test("the epoch moves on every clear, so a page can tell its answer is from before it", async () => {
  const cache = await load();
  const before = cache.requestCacheEpoch();
  cache.clearRequestCache();
  assert.equal(cache.requestCacheEpoch(), before + 1);
});
