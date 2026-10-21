import { useMemo, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { LibraryNavigationContext } from "./libraryNavigationState.js";

export default function LibraryNavigationProvider({ children }) {
  const auth = useAuth();
  const sessionKey = `${auth.sessionGeneration}:${auth.isAuthenticated}`;
  const [store, setStore] = useState(() => ({ sessionKey, views: new Map(), manualBooks: new Map() }));
  // Reset the metadata without remounting routes, forms or pending auth commands.
  if (store.sessionKey !== sessionKey) setStore({ sessionKey, views: new Map(), manualBooks: new Map() });
  const { views, manualBooks } = store;
  const navigation = useMemo(() => ({
    get: key => auth.isAuthenticated ? views.get(key) : undefined,
    getManualBook: key => auth.isAuthenticated ? manualBooks.get(key) : undefined,
    captureManualBook(book) {
      if (!auth.isAuthenticated) return undefined;
      const key = crypto.randomUUID();
      manualBooks.set(key, book);
      if (manualBooks.size > 16) manualBooks.delete(manualBooks.keys().next().value);
      return key;
    },
    remember(key, view) {
      if (!auth.isAuthenticated) return;
      // Small navigation metadata only; never cache library records or notes.
      views.delete(key);
      views.set(key, view);
      if (views.size > 64) views.delete(views.keys().next().value);
    },
  }), [views, manualBooks, auth.isAuthenticated]);
  return <LibraryNavigationContext.Provider value={navigation}>{children}</LibraryNavigationContext.Provider>;
}
