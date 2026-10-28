import test from "node:test";
import assert from "node:assert/strict";

// Native Node tests, no browser or network. Run with: node --test tests/observability.test.mjs
const load = () => import(`../src/observability.js?case=${crypto.randomUUID()}`);

function fakeDocument() {
  const appended = [];
  return {
    appended,
    createElement: () => ({ setAttribute(name, value) { this[name] = value; } }),
    head: { append: element => appended.push(element) },
  };
}

test("nothing is loaded or initialised without a Sentry key", async () => {
  const { startObservability } = await load();
  let loaded = 0;
  assert.equal(await startObservability({}, async () => { loaded += 1; }), false);
  assert.equal(await startObservability({ VITE_SENTRY_DSN: "   " }, async () => { loaded += 1; }), false);
  assert.equal(loaded, 0);
});

test("with a key it starts errors-only, with no replay, tracing or breadcrumbs, and scrubs every event", async () => {
  const { startObservability, scrubEvent, reportError } = await load();
  const calls = { init: null, captured: [] };
  const fakeSentry = {
    init: options => { calls.init = options; },
    captureException: (error, context) => calls.captured.push([error, context]),
  };
  const started = await startObservability({ VITE_SENTRY_DSN: "https://k@o0.ingest.example.invalid/2", MODE: "production" }, async () => fakeSentry);
  assert.equal(started, true);
  const options = calls.init;
  assert.equal(options.dsn, "https://k@o0.ingest.example.invalid/2");
  assert.equal(options.environment, "production");
  assert.equal(options.sendDefaultPii, false);
  assert.equal(options.beforeSend, scrubEvent);
  assert.ok(!("replaysSessionSampleRate" in options) && !("replaysOnErrorSampleRate" in options));
  assert.ok(!options.tracesSampleRate);
  const defaults = [{ name: "Breadcrumbs" }, { name: "GlobalHandlers" }, { name: "Dedupe" }, { name: "HttpContext" }];
  assert.deepEqual(options.integrations(defaults).map(item => item.name), ["GlobalHandlers", "Dedupe"]);
  const failure = new Error("render failed");
  reportError(failure, { componentStack: "\n at Home" });
  assert.equal(calls.captured.length, 1);
  assert.equal(calls.captured[0][0], failure);
});

test("reporting is silent when nothing was started", async () => {
  const { reportError } = await load();
  assert.doesNotThrow(() => reportError(new Error("x"), {}));
});

test("an event loses cookies, headers, bodies, queries, fragments, user details and breadcrumbs", async () => {
  const { scrubEvent } = await load();
  const event = {
    request: { url: "https://bookvane.me/reset-password?token=abc#token=secret", headers: { Referer: "https://x/?q=private", "User-Agent": "Test" },
      cookies: { a: "b" }, data: "body", query_string: "q=private" },
    user: { email: "reader@example.com" }, breadcrumbs: [{ message: "clicked a private note" }],
    exception: { values: [{ type: "TypeError", value: "x is undefined" }] }, extra: { note: "private" },
  };
  const cleaned = scrubEvent(event);
  const text = JSON.stringify(cleaned);
  for (const secret of ["abc", "secret", "private", "reader@example.com", "clicked", "body"]) assert.ok(!text.includes(secret), secret);
  assert.equal(cleaned.request.url, "https://bookvane.me/reset-password");
  assert.equal(cleaned.exception.values[0].value, "x is undefined");
  assert.deepEqual(scrubEvent({ message: "plain" }), { message: "plain" });
});

test("the visit-counting beacon is only added when a token is set, and only once", async () => {
  const { installAnalytics } = await load();
  const none = fakeDocument();
  assert.equal(installAnalytics({}, none), false);
  assert.equal(installAnalytics({ VITE_CF_ANALYTICS_TOKEN: "  " }, none), false);
  assert.deepEqual(none.appended, []);
  const doc = fakeDocument();
  assert.equal(installAnalytics({ VITE_CF_ANALYTICS_TOKEN: "abc123" }, doc), true);
  assert.equal(doc.appended.length, 1);
  const script = doc.appended[0];
  assert.equal(script.src, "https://static.cloudflareinsights.com/beacon.min.js");
  assert.equal(script.defer, true);
  assert.deepEqual(JSON.parse(script["data-cf-beacon"]), { token: "abc123" });
  assert.equal(installAnalytics({ VITE_CF_ANALYTICS_TOKEN: "abc123" }, doc), false);
  assert.equal(doc.appended.length, 1);
});
