import { API_BASE_URL } from "../../api/client.js";

// Aggregate counters only: a name plus an optional source or placement. No cookies, IDs or account data.
// The server drops a whole event whose source or placement it does not know, so only its known values are sent.
const sources = new Set(["landing", "noresults", "saveprompt", "share", "import"]);
const placements = new Set(["book_page", "want_card"]);

export function trackEvent(name, { src, placement } = {}) {
  try {
    if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
    const body = { name, ...(sources.has(src) ? { src } : {}), ...(placements.has(placement) ? { placement } : {}) };
    navigator.sendBeacon(`${API_BASE_URL}/events`, new Blob([JSON.stringify(body)], { type: "text/plain" }));
  } catch {
    // Counting is optional; it must never get in the reader's way.
  }
}
