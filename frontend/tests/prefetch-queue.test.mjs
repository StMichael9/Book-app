import test from "node:test";
import assert from "node:assert/strict";

// Native Node tests: no browser or network. Run with: node --test tests/prefetch-queue.test.mjs
const wait = ms => new Promise(done => setTimeout(done, ms));
const load = () => import(`../src/api/prefetchQueue.js?case=${crypto.randomUUID()}`);

test("at most four prefetches run at once and every card still gets fetched", async () => {
  const { prefetchWhenIdle } = await load();
  let running = 0, peak = 0, done = 0;
  for (let index = 0; index < 20; index += 1) {
    prefetchWhenIdle(`queue-a:${index}`, async () => {
      running += 1; peak = Math.max(peak, running);
      await wait(15);
      running -= 1; done += 1;
      return index;
    });
  }
  await wait(600);
  assert.equal(done, 20);
  assert.equal(peak, 4);
});

test("a key already waiting or cached is not fetched twice", async () => {
  const { prefetchWhenIdle } = await load();
  let calls = 0;
  const loader = async () => { calls += 1; return "x"; };
  prefetchWhenIdle("queue-b:1", loader);
  prefetchWhenIdle("queue-b:1", loader);
  await wait(150);
  prefetchWhenIdle("queue-b:1", loader);
  await wait(150);
  assert.equal(calls, 1);
});

test("nothing is queued when the reader asked to save data", async () => {
  const { prefetchWhenIdle } = await load();
  Object.defineProperty(globalThis.navigator, "connection", { value: { saveData: true }, configurable: true });
  try {
    let calls = 0;
    prefetchWhenIdle("queue-c:1", async () => { calls += 1; });
    await wait(150);
    assert.equal(calls, 0);
  } finally {
    delete globalThis.navigator.connection;
  }
});

test("a failed prefetch frees its slot for the next one", async () => {
  const { prefetchWhenIdle } = await load();
  let later = 0;
  for (let index = 0; index < 4; index += 1) prefetchWhenIdle(`queue-d:fail:${index}`, async () => { throw new Error("offline"); });
  prefetchWhenIdle("queue-d:ok", async () => { later += 1; });
  await wait(300);
  assert.equal(later, 1);
});
