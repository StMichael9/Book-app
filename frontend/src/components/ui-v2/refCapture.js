import { useEffect } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { knownRef, trackEvent } from "./events.js";

// Where a visit came from. A shared link carries ?ref=tt (and so on); only a known ref is kept, for this browser tab's session,
// so sign-up can send it. The address is cleaned right away so a copied link doesn't carry it on. Storage is optional: every access is guarded.
const REF_KEY = "bv-ref", VISIT_KEY = "bv-visit-sent";
let visitSent = false;

export function storedRef() {
  try { return knownRef(sessionStorage.getItem(REF_KEY)); } catch { return ""; }
}
export function forgetRef() {
  try { sessionStorage.removeItem(REF_KEY); } catch { /* nothing to forget */ }
}

// Mounted once, above the routes. It keeps a known ref and removes ?ref= from the address at once (the other parameters, the hash and the
// router's own history state stay), and counts the visit once per session, with the ref when there is one. The visit is counted only once
// the account check has settled as signed out: never for a signed-in reader, and never while the check is running or could not be made.
export function useRefCapture() {
  const { search } = useLocation();
  const auth = useAuth();
  const signedOut = !auth.isLoading && !auth.isAuthenticated && !auth.sessionError;
  useEffect(() => {
    const url = new URL(window.location.href), given = url.searchParams.get("ref");
    if (given !== null) {
      const ref = knownRef(given);
      if (ref) { try { sessionStorage.setItem(REF_KEY, ref); } catch { /* the ref is only a nicety */ } }
      url.searchParams.delete("ref");
      window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
    }
  }, [search]);
  useEffect(() => {
    if (!signedOut || visitSent) return;
    let first = true;
    try { first = !sessionStorage.getItem(VISIT_KEY); sessionStorage.setItem(VISIT_KEY, "1"); } catch { /* the module flag still keeps it to once */ }
    visitSent = true;
    if (first) trackEvent("landing_visit", { ref: storedRef() });
  }, [signedOut]);
}
