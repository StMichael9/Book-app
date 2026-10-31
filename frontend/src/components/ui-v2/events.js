import { API_BASE_URL } from "../../api/client.js";

// Aggregate counters only: a name plus an optional source or placement. No cookies, IDs or account data.
// The server drops a whole event whose source or placement it does not know, so only its known values are sent.
const sources = new Set(["landing", "noresults", "saveprompt", "share", "import", "profile"]);
const placements = new Set(["book_page", "want_card"]);

export const knownSource = value => (sources.has(value) ? value : "");

export function trackEvent(name, { src, placement } = {}) {
  try {
    if (typeof fetch !== "function") return;
    const body = { name, ...(sources.has(src) ? { src } : {}), ...(placements.has(placement) ? { placement } : {}) };
    // credentials: "omit" keeps the reader's cookies off every event.
    fetch(`${API_BASE_URL}/events`, { method: "POST", body: JSON.stringify(body), keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } }).catch(() => {});
  } catch {
    // Counting is optional; it must never get in the reader's way.
  }
}
