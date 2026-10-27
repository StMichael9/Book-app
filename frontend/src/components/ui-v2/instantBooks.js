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
  const shown = live.data || fallback;
  return { ...live, data: shown, loading: live.loading && !shown, error: shown ? null : live.error, stale: !live.data && Boolean(fallback) };
}
