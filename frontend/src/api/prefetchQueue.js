import { prefetchRequest } from "./requestCache.js";

// Cards that scroll into view are fetched ahead of a tap, but politely: a few at a time, only when the browser is idle,
// and never on a connection the reader asked to spare (Save-Data). A hover, touch or focus is a clearer signal and
// goes straight through prefetchRequest instead.
const MAX_PARALLEL = 4;
const queue = [];
const waiting = new Set();
let running = 0;
let scheduled = false;

const savingData = () => typeof navigator !== "undefined" && navigator.connection?.saveData === true;
const whenIdle = callback => (typeof requestIdleCallback === "function" ? requestIdleCallback(callback, { timeout: 1500 }) : setTimeout(callback, 60));

function pump() {
  scheduled = false;
  while (running < MAX_PARALLEL && queue.length) {
    const [key, load] = queue.shift();
    waiting.delete(key);
    const pending = prefetchRequest(key, load);
    if (pending) {
      running += 1;
      pending.finally(() => { running -= 1; schedule(); });
    }
  }
}

function schedule() {
  if (scheduled || !queue.length) return;
  scheduled = true;
  whenIdle(pump);
}

export function prefetchWhenIdle(key, load) {
  if (savingData() || waiting.has(key)) return;
  waiting.add(key);
  queue.push([key, load]);
  schedule();
}
