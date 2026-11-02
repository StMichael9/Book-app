import { useEffect, useMemo } from "react";
import { readBookCache, snapshotFor, writeBookCache } from "../../api/bookCache.js";

// Paints the committed snapshot, or the last live response from this browser, while the live request is pending
// (stale-while-revalidate). Live data replaces it in place. `eligible` is true only for the unfiltered first page.
export function useInstantBooks({ view, eligible, auth, live }) {
  const scope = auth.isLoading ? "unknown" : auth.isAuthenticated ? "member" : "anon";
  const hasLive = Boolean(live.data);
  const fallback = useMemo(() => {
    if (!eligible || hasLive) return null;
    const cached = scope === "unknown" ? readBookCache(view, "member") || readBookCache(view, "anon") : readBookCache(view, scope);
    return cached || snapshotFor(view);
  }, [eligible, hasLive, scope, view]);
  useEffect(() => {
    if (eligible && scope !== "unknown" && live.data) writeBookCache(view, scope, live.data);
  }, [eligible, scope, view, live.data]);
  // Cards painted from the snapshot are placeholders while the live request is pending: they must not each ask for the
  // reader's saved status, because the live results replace them moments later and would need a second lookup.
  const placeholder = !live.data && Boolean(fallback) && live.loading;
  const shown = useMemo(() => {
    if (live.data) return live.data;
    if (!placeholder || !Array.isArray(fallback?.items)) return fallback;
    return { ...fallback, items: fallback.items.map((item) => ({ ...item, lookupDeferred: true })) };
  }, [live.data, fallback, placeholder]);
  return { ...live, data: shown, loading: live.loading && !shown, error: shown ? null : live.error, stale: !live.data && Boolean(fallback) };
}
