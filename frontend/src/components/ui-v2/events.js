import { API_BASE_URL } from "../../api/client.js";

// Aggregate counters only: a name plus an optional source or placement. No cookies, IDs or account data.
const label = /^[a-z_]{1,24}$/;

export function trackEvent(name, { src, placement } = {}) {
  try {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const body = { name, ...(label.test(src || "") ? { src } : {}), ...(label.test(placement || "") ? { placement } : {}) };
    navigator.sendBeacon(`${API_BASE_URL}/events`, new Blob([JSON.stringify(body)], { type: "text/plain" }));
  } catch {
    // Counting is optional; it must never get in the reader's way.
  }
}
