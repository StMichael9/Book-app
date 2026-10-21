import test from "node:test";
import assert from "node:assert/strict";

// Native Node tests with a replaced fetch: no network or account/database use.
async function setup(t, respond) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, options) => { calls.push({ url, options }); return respond(url, options); };
  t.after(() => { globalThis.fetch = original; });
  const api = await import(`../src/api/books.js?case=${crypto.randomUUID()}`);
  return { ...api, calls };
}
const book = id => Response.json({ id, title: `Book ${id}`, authors: [], tags: [] });

test("concurrent public detail consumers share one request", async t => {
  let release;
  const held = new Promise(done => { release = done; });
  const { getBookById, calls } = await setup(t, async () => { await held; return book(1); });
  const a = getBookById(1), b = getBookById(1);
  assert.equal(calls.length, 1); release();
  assert.deepEqual(await a, await b);
  await getBookById(1); assert.equal(calls.length, 1);
});

test("expired details refetch after 45 seconds", async t => {
  const originalNow = Date.now; let taskClock = originalNow();
  Date.now = () => taskClock; t.after(() => { Date.now = originalNow; });
  const { getBookById, calls } = await setup(t, () => book(1));
  await getBookById(1); taskClock += 44_999; await getBookById(1); assert.equal(calls.length, 1);
  taskClock += 1; await getBookById(1); assert.equal(calls.length, 2);
});

test("a failed shared request is never cached and retry is a real request", async t => {
  let fail = true;
  const { getBookById, calls } = await setup(t, () => fail ? Response.json({}, { status: 503 }) : book(1));
  const results = await Promise.allSettled([getBookById(1), getBookById(1)]);
  assert.ok(results.every(result => result.status === "rejected")); assert.equal(calls.length, 1);
  fail = false; assert.equal((await getBookById(1)).id, 1); assert.equal(calls.length, 2);
});

test("the detail cache is bounded to 64 successful public records", async t => {
  const { getBookById, calls } = await setup(t, url => book(Number(new URL(url).pathname.split("/").at(-1))));
  for (let id = 1; id <= 65; id++) await getBookById(id);
  await getBookById(65); assert.equal(calls.length, 65);
  await getBookById(1); assert.equal(calls.length, 66);
});

test("only BookSchema fields enter the public detail cache", async t => {
  const { getBookById, calls } = await setup(t, () => Response.json({ id: 1, title: "Public", description: "Public description",
    authors: [], note: "Private memory must not enter a public cache", entry: { user_id: "owner" }, is_wanted: true }));
  const result = await getBookById(1);
  assert.deepEqual(Object.keys(result).sort(), ["authors", "description", "id", "title"]);
  assert.deepEqual(await getBookById(1), result); assert.equal(calls.length, 1);
});

test("malformed responses do not poison a later retry", async t => {
  let malformed = true;
  const { getBookById, calls } = await setup(t, () => malformed ? Response.json({ title: "Missing identity" }) : book(1));
  await assert.rejects(getBookById(1), /Invalid catalogue/);
  malformed = false; assert.equal((await getBookById(1)).id, 1); assert.equal(calls.length, 2);
});
