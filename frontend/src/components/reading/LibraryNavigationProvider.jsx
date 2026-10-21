import { useMemo, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { LibraryNavigationContext } from "./libraryNavigationState.js";

export default function LibraryNavigationProvider({ children }) {
  const auth = useAuth();
  const sessionKey = `${auth.sessionGeneration}:${auth.isAuthenticated}`;
  const [store, setStore] = useState(() => ({ sessionKey, views: new Map() }));
  // Reset the metadata without remounting routes, forms or pending auth commands.
  if (store.sessionKey !== sessionKey) setStore({ sessionKey, views: new Map() });
  const views = store.views;
  const navigation = useMemo(() => ({
    get: key => auth.isAuthenticated ? views.get(key) : undefined,
    remember(key, view) {
      if (!auth.isAuthenticated) return;
      // Small navigation metadata only; never cache library records or notes.
      views.delete(key);
      views.set(key, view);
      if (views.size > 64) views.delete(views.keys().next().value);
    },
  }), [views, auth.isAuthenticated]);
  return <LibraryNavigationContext.Provider value={navigation}>{children}</LibraryNavigationContext.Provider>;
}
