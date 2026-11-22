import { API_BASE_URL } from "../../api/client.js";

// Aggregate counters only: a name plus an optional source or placement. No cookies, IDs or account data.
// The server drops a whole event whose source or placement it does not know, so only its known values are sent.
const sources = new Set(["landing", "noresults", "saveprompt", "share", "import", "profile"]);
const placements = new Set(["book_page", "want_card"]);
// Where a visit came from: the `ref` of a shared link. The server counts anything else as no ref.
const refs = new Set(["tt", "ig", "rd", "ph", "yt", "x", "club", "share", "email", "loan"]);

export const knownSource = value => (sources.has(value) ? value : "");
export const knownRef = value => (refs.has(value) ? value : "");

export function trackEvent(name, { src, placement, ref, n } = {}) {
  try {
    if (typeof fetch !== "function") return;
    const body = { name, ...(sources.has(src) ? { src } : {}), ...(placements.has(placement) ? { placement } : {}), ...(refs.has(ref) ? { ref } : {}), ...(Number.isInteger(n) && n >= 1 && n <= 100 ? { n } : {}) };
    // credentials: "omit" keeps the reader's cookies off every event.
    fetch(`${API_BASE_URL}/events`, { method: "POST", body: JSON.stringify(body), keepalive: true, credentials: "omit", headers: { "Content-Type": "text/plain" } }).catch(() => {});
  } catch {
    // Counting is optional; it must never get in the reader's way.
  }
}
