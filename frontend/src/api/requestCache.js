// In-memory stale-while-revalidate store for useRequest and prefetching. Memory only: nothing here is ever written to
// localStorage or sessionStorage, so private reading data cannot outlive the tab. Cleared on logout and session change.
const MAX_ENTRIES = 100;
const MAX_AGE = 10 * 60 * 1000;
// An answer fetched before the account check returned is used once, for the first read of its key, within this long.
const EARLY_MAX_AGE = 60 * 1000;
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

export function writeRequestCache(key, data, early = false) {
  entries.delete(key);
  entries.set(key, { data, at: Date.now(), early });
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

// One request per key at a time, shared by the page and by prefetching: whichever asks first starts it, and the answer
// is stored for the next visit unless the cache was cleared (logout, session change) in the meantime.
function track(key, load, early = false) {
  const startedIn = epoch;
  const pending = Promise.resolve().then(load);
  inFlight.set(key, pending);
  const settle = data => {
    if (inFlight.get(key) === pending) inFlight.delete(key);
    return data;
  };
  pending.then(data => { settle(); if (epoch === startedIn) writeRequestCache(key, data, early); }, () => { settle(); });
  return pending;
}

export function sharedRequest(key, load) {
  return inFlight.get(key) ?? track(key, load);
}

// Starts a request ahead of a click and keeps the answer for the page that needs it. Nothing when the answer is already
// cached or already being fetched; a failed prefetch is silent and the page simply asks again.
export function prefetchRequest(key, load) {
  if (entries.has(key) || inFlight.has(key)) return undefined;
  return track(key, load).then(() => {}, () => {});
}

// Returning readers: the page's requests start together with the account check (see api/earlyStart.js), before any page has
// asked for them. Same keys as the pages, so a page that mounts later finds the answer here. Silent on failure.
export function startEarlyRequest(key, load) {
  if (entries.has(key) || inFlight.has(key)) return undefined;
  return track(key, load, true).then(() => {}, () => {});
}

// The first read of an early answer: it is handed over once and then behaves like any cached answer, so the page's next visit
// revalidates as usual. Nothing for an entry that was not fetched early, or that has waited too long.
export function takeEarlyRequest(key) {
  const entry = entries.get(key);
  if (!entry?.early) return null;
  entries.set(key, { ...entry, early: false });
  return Date.now() - entry.at <= EARLY_MAX_AGE ? entry : null;
}

// What an early start has for this key: the request still under way, else its answer (handed over once). Never starts a request.
export function earlyAnswer(key) {
  const pending = inFlight.get(key);
  if (pending) return pending;
  const early = takeEarlyRequest(key);
  return early ? Promise.resolve(early.data) : undefined;
}

// For a loader that must not ask twice: the early request or answer if there is one, else a new request.
export function earlyOrRequest(key, load) {
  return earlyAnswer(key) ?? track(key, load);
}
