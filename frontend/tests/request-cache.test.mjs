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

test("a page and a prefetch for the same key share one request and one stored answer", async () => {
  const cache = await load();
  let calls = 0;
  const loader = async () => { calls += 1; await new Promise(done => setTimeout(done, 10)); return { id: 7 }; };
  cache.prefetchRequest("book:7", loader);
  const page = await cache.sharedRequest("book:7", loader);
  assert.deepEqual(page, { id: 7 });
  assert.equal(calls, 1);
  assert.deepEqual(cache.readRequestCache("book:7").data, { id: 7 });
  const first = cache.sharedRequest("home:1", loader), second = cache.sharedRequest("home:1", loader);
  assert.equal(first, second);
  await first;
  assert.equal(calls, 2);
});

test("a failed shared request is forgotten so the next ask starts again", async () => {
  const cache = await load();
  let calls = 0;
  await assert.rejects(cache.sharedRequest("book:9", async () => { calls += 1; throw new Error("offline"); }));
  await cache.sharedRequest("book:9", async () => { calls += 1; return { id: 9 }; });
  assert.equal(calls, 2);
  assert.deepEqual(cache.readRequestCache("book:9").data, { id: 9 });
});

test("an early answer is handed over once, then behaves like any cached answer", async () => {
  const cache = await load();
  await cache.startEarlyRequest("home:1:0", async () => ({ n: 1 }));
  assert.deepEqual(cache.takeEarlyRequest("home:1:0").data, { n: 1 });
  assert.equal(cache.takeEarlyRequest("home:1:0"), null); // the second read revalidates as usual
  assert.deepEqual(cache.readRequestCache("home:1:0").data, { n: 1 }); // still shown at once as the older answer
});

test("only an early start marks an answer as early", async () => {
  const cache = await load();
  await cache.prefetchRequest("a", async () => 1);
  assert.equal(cache.takeEarlyRequest("a"), null);
  await cache.sharedRequest("b", async () => 2);
  assert.equal(cache.takeEarlyRequest("b"), null);
});

test("an early answer that waited more than a minute is not handed over", async (t) => {
  const cache = await load();
  await cache.startEarlyRequest("k", async () => 1);
  const base = Date.now();
  t.mock.method(Date, "now", () => base + 1000 * 61);
  assert.equal(cache.takeEarlyRequest("k"), null);
});

test("a failed early request stores nothing and is asked for again", async () => {
  const cache = await load();
  await cache.startEarlyRequest("k", async () => { throw Object.assign(new Error("no"), { status: 401 }); });
  assert.equal(cache.readRequestCache("k"), null);
  assert.equal(cache.takeEarlyRequest("k"), null);
  assert.equal(cache.earlyAnswer("k"), undefined);
  assert.equal(await cache.earlyOrRequest("k", async () => "again"), "again");
});

test("an early start does not repeat a request that is cached or in flight", async () => {
  const cache = await load();
  let calls = 0;
  const first = cache.startEarlyRequest("k", async () => { calls += 1; return 1; });
  assert.ok(cache.earlyAnswer("k")); // the request in flight
  assert.equal(cache.startEarlyRequest("k", async () => { calls += 1; return 2; }), undefined);
  await first;
  assert.equal(cache.startEarlyRequest("k", async () => { calls += 1; return 3; }), undefined);
  assert.equal(calls, 1);
});

test("earlyOrRequest joins the request in flight, then the early answer, and never asks twice", async () => {
  const cache = await load();
  let calls = 0;
  const load1 = async () => { calls += 1; return calls; };
  const started = cache.startEarlyRequest("k", load1);
  assert.equal(await cache.earlyOrRequest("k", load1), 1); // joined while in flight
  await started;
  assert.equal(await cache.earlyOrRequest("k", load1), 1); // the early answer, once
  assert.equal(await cache.earlyOrRequest("k", load1), 2); // then a fresh request
  assert.equal(calls, 2);
});

test("clearing the cache drops an early answer, and an early request that finishes afterwards is not stored", async () => {
  const cache = await load();
  await cache.startEarlyRequest("kept", async () => 1);
  let release;
  const pending = cache.startEarlyRequest("late", () => new Promise(done => { release = done; }));
  await Promise.resolve(); // the loader has started
  cache.clearRequestCache(); // sign out, or another account signing in
  assert.equal(cache.takeEarlyRequest("kept"), null);
  assert.equal(cache.earlyAnswer("late"), undefined);
  release("account A");
  await pending;
  assert.equal(cache.readRequestCache("late"), null);
  assert.equal(cache.requestCacheSize(), 0);
});

// The early-request marker (api/client.js): an expired session met by a request started with the account check is left to
// the check, even when the loader awaits something before calling apiRequest. Outside the window, the expiry is announced.
test("an early request that awaits before asking does not announce an expired session; a normal one does", async () => {
  const events = [];
  globalThis.window = { dispatchEvent: event => { events.push(event.type); return true; }, addEventListener() {}, removeEventListener() {} };
  globalThis.fetch = async () => new Response(JSON.stringify({ detail: "Session expired" }), { status: 401, headers: { "Content-Type": "application/json" } });
  const client = await import(`../src/api/client.js?case=${crypto.randomUUID()}`);
  let finish;
  const check = new Promise(done => { finish = done; });
  client.speculativeUntil(check);
  const early = client.asSpeculative(async () => { await Promise.resolve(); await new Promise(done => setTimeout(done, 5)); return client.apiRequest("/me/profile"); });
  await assert.rejects(early);
  assert.deepEqual(events.filter(type => type === "bookvane:session-expired"), []);
  finish();
  await check; await new Promise(done => setTimeout(done, 0));
  await assert.rejects(client.apiRequest("/me/profile"));
  assert.deepEqual(events.filter(type => type === "bookvane:session-expired"), ["bookvane:session-expired"]);
  delete globalThis.window; delete globalThis.fetch;
});
