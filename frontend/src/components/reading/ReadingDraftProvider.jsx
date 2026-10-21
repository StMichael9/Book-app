import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { ReadingDraftContext } from "./readingDraftState.js";

// Memory only. The provider survives SPA navigation, never a document refresh.
// Authentication generation is part of the boundary even for the same user.
export default function ReadingDraftProvider({ children }) {
  const auth = useAuth();
  const sessionKey = `${auth.sessionGeneration}:${auth.isAuthenticated}`;
  const liveSession = useRef(sessionKey);
  useLayoutEffect(() => {
    liveSession.current = sessionKey;
    return () => { liveSession.current = null; };
  }, [sessionKey]);
  const [store, setStore] = useState({ sessionKey, drafts: {} });
  if (store.sessionKey !== sessionKey) setStore({ sessionKey, drafts: {} });
  const drafts = store.sessionKey === sessionKey && auth.isAuthenticated ? store.drafts : {};
  const hasDrafts = Object.keys(drafts).length > 0;
  const change = useCallback((key, value) => {
    if (!auth.isAuthenticated || liveSession.current !== sessionKey) return;
    setStore(current => {
      if (current.sessionKey !== sessionKey) return current;
      const next = { ...current.drafts };
      if (value) next[key] = value; else delete next[key];
      return { sessionKey, drafts: next };
    });
  }, [sessionKey, auth.isAuthenticated]);

  useEffect(() => {
    if (!hasDrafts) return undefined;
    // SPA navigation keeps drafts. Only leaving the document risks losing them.
    const protect = event => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", protect);
    return () => window.removeEventListener("beforeunload", protect);
  }, [hasDrafts]);

  return <ReadingDraftContext.Provider value={{ drafts, change }}>{children}</ReadingDraftContext.Provider>;
}
