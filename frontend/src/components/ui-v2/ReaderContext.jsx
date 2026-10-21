import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { errorText } from "./data.js";
import { ReaderContext } from "./readerState.js";

function initialTheme() {
  // The inline bootstrap applies the preference before CSS/React can paint.
  const bootstrapped = document.documentElement.getAttribute("data-theme");
  if (bootstrapped === "light" || bootstrapped === "dark") return bootstrapped;
  try {
    const stored = localStorage.getItem("bookvane-theme");
    if (stored === "light" || stored === "dark") return stored;
    const legacy = localStorage.getItem("shelfbound-theme");
    if (legacy === "light" || legacy === "dark") return legacy;
  } catch { /* The interface also works when storage is unavailable. */ }
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function ReaderProvider({ children }) {
  const auth = useAuth();
  const library = useUserBooks();
  const [theme, setTheme] = useState(initialTheme);
  const [gate, setGate] = useState(null);
  const [message, setMessage] = useState("");
  const [busyIds, setBusyIds] = useState([]);
  const busy = useRef(new Set());
  const [saveErrors, setSaveErrors] = useState({});
  const [readiness, setReadiness] = useState({ authenticated: auth.isAuthenticated, generation: auth.sessionGeneration, ready: false });
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const session = useRef(0);
  const authenticated = useRef(auth.isAuthenticated);
  const preferenceAccount = useRef(auth.sessionGeneration);
  useLayoutEffect(() => {
    preferenceAccount.current = auth.sessionGeneration;
    return () => { preferenceAccount.current = null; };
  }, [auth.sessionGeneration]);
  // Reset session-scoped UI before rendering a different authentication state.
  if (readiness.authenticated !== auth.isAuthenticated || readiness.generation !== auth.sessionGeneration) {
    setReadiness({ authenticated: auth.isAuthenticated, generation: auth.sessionGeneration, ready: false });
    setSaveErrors({});
    setGate(null);
    setMessage("");
  }
  const libraryReady = auth.isAuthenticated && readiness.authenticated === auth.isAuthenticated && readiness.generation === auth.sessionGeneration && readiness.ready;

  useLayoutEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
    try { localStorage.setItem("bookvane-theme", theme); } catch { /* Optional persistence. */ }
  }, [theme]);

  // Wait until the shared provider has started this session's library load.
  // Its previous anonymous loading=false value must never enable a write.
  useEffect(() => {
    session.current += 1;
    busy.current.clear();
    authenticated.current = auth.isAuthenticated;
    const timer = setTimeout(() => {
      setBusyIds([]);
      if (auth.isAuthenticated) setReadiness({ authenticated: true, generation: auth.sessionGeneration, ready: true });
    }, 0);
    return () => { if (timer !== null) clearTimeout(timer); };
  }, [auth.isAuthenticated, auth.sessionGeneration]);

  useEffect(() => {
    if (!message) return undefined;
    const timer = setTimeout(() => setMessage(""), 5000);
    return () => clearTimeout(timer);
  }, [message]);

  const announce = useCallback((text) => setMessage(text), []);

  async function saveBook(book, status, ensure = false) {
    if (!auth.isAuthenticated) { setGate({ book, status }); return false; }
    if (auth.isLoading || !libraryReady || library.loading || library.error || busy.current.has(book.id)) return false;
    const generation = session.current;
    busy.current.add(book.id);
    setBusyIds([...busy.current]);
    setSaveErrors((current) => ({ ...current, [book.id]: "" }));
    try {
      const state = library.booksById[book.id];
      const selected = library.mode === "v3" ? state?.[status === "owned" ? "is_owned" : "is_wanted"] : state?.status === status;
      if (ensure && selected) {
        announce(`Already on your ${status === "owned" ? "Own" : "Want"} shelf.`);
      } else if (!ensure && selected) {
        await library.clearStatus(book.id, status);
        if (generation === session.current && authenticated.current) announce(library.mode === "v3" ? `Removed from ${status === "owned" ? "Own" : "Want"}. Your other saved information is unchanged.` : "Removed from your library.");
      } else {
        await library.updateStatus(book.id, status);
        if (generation === session.current && authenticated.current) announce(`Added to your ${status === "owned" ? "Own" : "Want"} shelf.`);
      }
      return generation === session.current && authenticated.current;
    } catch (error) {
      if (generation === session.current) {
        setSaveErrors((current) => ({ ...current, [book.id]: errorText(error, "This book couldn’t be saved. Please try again.") }));
      }
      return false;
    } finally {
      if (generation === session.current) { busy.current.delete(book.id); setBusyIds([...busy.current]); }
    }
  }

  return <ReaderContext.Provider value={{
    theme, setTheme, gate, setGate, message, announce, saveBook, busyIds, saveErrors,
    libraryReady, preferencesVersion,
    // A completed write still invalidates discovery after leaving Preferences,
    // but a callback captured by a departed account cannot publish to its successor.
    preferencesSaved: () => {
      if (auth.isAuthenticated && preferenceAccount.current === auth.sessionGeneration) setPreferencesVersion(value => value + 1);
    },
  }}>{children}</ReaderContext.Provider>;
}
