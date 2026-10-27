// In-memory stale-while-revalidate store for useRequest and prefetching. Memory only: nothing here is ever written to
// localStorage or sessionStorage, so private reading data cannot outlive the tab. Cleared on logout and session change.
const MAX_ENTRIES = 100;
const MAX_AGE = 10 * 60 * 1000;
const entries = new Map();
const inFlight = new Map();
let epoch = 0; // bumped by every clear, so an answer to a pre-clear request is never stored

export const requestCacheEpoch = () => epoch;

export function readRequestCache(key) {
  const entry = entries.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > MAX_AGE) { entries.delete(key); return null; }
  entries.delete(key); entries.set(key, entry); // most recently used goes last
  return entry;
}

export function writeRequestCache(key, data) {
  entries.delete(key);
  entries.set(key, { data, at: Date.now() });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value);
}

export function clearRequestCache() {
  epoch += 1;
  entries.clear();
  inFlight.clear();
}

export function requestCacheSize() {
  return entries.size;
}

// Starts a request ahead of a click and keeps the answer for the page that needs it. One request per key at a time,
// and nothing when the answer is already cached; a failed prefetch is silent and the page simply asks again.
export function prefetchRequest(key, load) {
  if (entries.has(key) || inFlight.has(key)) return;
  const pending = Promise.resolve().then(load).then(data => { if (inFlight.get(key) === pending) writeRequestCache(key, data); }, () => {})
    .finally(() => { if (inFlight.get(key) === pending) inFlight.delete(key); });
  inFlight.set(key, pending);
}
