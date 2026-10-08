import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { errorText } from "./data.js";
import { ReaderContext } from "./readerState.js";
import { clearRecoveryIntent } from "./recoveryIntent.js";

function initialTheme() {
  try {
    const stored = localStorage.getItem("bookvane-theme");
    if (stored === "light" || stored === "dark") return stored;
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
  const [readiness, setReadiness] = useState({ authenticated: auth.isAuthenticated, ready: false });
  const [preferencesVersion, setPreferencesVersion] = useState(0);
  const [shelvesVersion, setShelvesVersion] = useState(0);
  const session = useRef(0);
  const authenticated = useRef(auth.isAuthenticated);
  // Reset session-scoped UI before rendering a different authentication state.
  if (readiness.authenticated !== auth.isAuthenticated) {
    setReadiness({ authenticated: auth.isAuthenticated, ready: false });
    setSaveErrors({});
    setGate(null);
    setShelvesVersion((value) => value + 1);
  }
  const libraryReady = auth.isAuthenticated && readiness.authenticated === auth.isAuthenticated && readiness.ready;

  useEffect(() => {
    document.documentElement.style.colorScheme = theme;
    document.documentElement.dataset.theme = theme;
    const background = theme === "dark" ? "#1e1d1b" : "#faf8f2";
    document.documentElement.style.backgroundColor = background;
    document.documentElement.style.setProperty("--bg", background);
    try { localStorage.setItem("bookvane-theme", theme); } catch { /* Optional persistence. */ }
  }, [theme]);

  // Wait until the shared provider has started this session's library load.
  // Its previous anonymous loading=false value must never enable a write.
  useEffect(() => {
    session.current += 1;
    authenticated.current = auth.isAuthenticated;
    const timer = auth.isAuthenticated ? setTimeout(() => setReadiness({ authenticated: true, ready: true }), 0) : null;
    return () => { if (timer !== null) clearTimeout(timer); };
  }, [auth.isAuthenticated]);

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
      const currentStatus = library.booksById[book.id]?.status;
      let changed = false;
      if (ensure && currentStatus === status) {
        announce(`Already on your ${status === "owned" ? "Own" : "Want"} shelf.`);
      } else if (!ensure && currentStatus === status) {
        await library.clearStatus(book.id);
        changed = true;
        if (generation === session.current && authenticated.current) announce("Removed from your library.");
      } else {
        await library.updateStatus(book.id, status);
        changed = true;
        if (generation === session.current && authenticated.current) announce(`Added to your ${status === "owned" ? "Own" : "Want"} shelf.`);
      }
      const current = generation === session.current && authenticated.current;
      if (current) clearRecoveryIntent(book.id);
      if (changed && current) setShelvesVersion((value) => value + 1);
      return current;
    } catch (error) {
      if (generation === session.current) {
        setSaveErrors((current) => ({ ...current, [book.id]: errorText(error, "This book couldn’t be saved. Please try again.") }));
      }
      return false;
    } finally {
      busy.current.delete(book.id);
      setBusyIds([...busy.current]);
    }
  }

  return <ReaderContext.Provider value={{
    theme, setTheme, gate, setGate, message, announce, saveBook, busyIds, saveErrors,
    libraryReady, preferencesVersion, shelvesVersion,
    preferencesSaved: () => setPreferencesVersion((value) => value + 1),
  }}>{children}</ReaderContext.Provider>;
}
