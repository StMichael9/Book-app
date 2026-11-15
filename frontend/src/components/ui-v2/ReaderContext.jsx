import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { errorText } from "./data.js";
import { ReaderContext } from "./readerState.js";
import { likelySignedIn } from "../../api/bookCache.js";
import { applyTheme, readChoice, storeChoice, systemTheme } from "./theme.js";

export function ReaderProvider({ children }) {
  const auth = useAuth();
  const library = useUserBooks();
  // The reader's choice (Match device, Light or Dark) and what the device says now. A guest always matches the device: the choice
  // is a signed-in setting (Settings needs an account), and the inline bootstrap makes the same call from the sign-in hint.
  const [themeChoice, setThemeChoice] = useState(readChoice);
  const [system, setSystem] = useState(systemTheme);
  useEffect(() => {
    const query = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!query) return undefined;
    const update = () => setSystem(query.matches ? "dark" : "light");
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  const followsChoice = auth.isAuthenticated || (auth.isLoading && likelySignedIn());
  const theme = followsChoice && themeChoice !== "device" ? themeChoice : system;
  const chooseTheme = useCallback(choice => { setThemeChoice(choice); storeChoice(choice); }, []);
  // Older callers flip between Light and Dark; that is an explicit choice too.
  const setTheme = useCallback(next => chooseTheme(typeof next === "function" ? next(theme) : next), [chooseTheme, theme]);
  const [gate, setGate] = useState(null);
  const [message, setMessage] = useState("");
  const [busyIds, setBusyIds] = useState([]);
  const busy = useRef(new Set());
  // The entry the last Want / Own add returned, so a page can offer the one-time "why" prompt without another request.
  const lastSave = useRef(null);
  // While an inline prompt is open under the shelf buttons, the toast would sit on top of it; its text stays in the live region.
  const [quietToast, setQuietToast] = useState(false);
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

  // Applying the theme never writes to storage: only chooseTheme does.
  useLayoutEffect(() => { applyTheme(theme); }, [theme]);

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
        announce(`Already marked ${status === "owned" ? "Owned" : "Want to read"}.`);
      } else if (!ensure && selected) {
        await library.clearStatus(book.id, status);
        if (generation === session.current && authenticated.current) announce(library.mode === "v3" ? `Removed from ${status === "owned" ? "Owned" : "Want to read"}. Your other saved information is unchanged.` : "Removed from your library.");
      } else {
        const saved = await library.updateStatus(book.id, status);
        lastSave.current = { bookId: book.id, status, entry: saved };
        if (generation === session.current && authenticated.current) announce(`Added to ${status === "owned" ? "Owned" : "Want to read"}.`);
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
    theme, themeChoice, chooseTheme, setTheme, gate, setGate, message, announce, saveBook, lastSave, quietToast, setQuietToast, busyIds, saveErrors,
    libraryReady, preferencesVersion,
    // A completed write still invalidates discovery after leaving Preferences,
    // but a callback captured by a departed account cannot publish to its successor.
    preferencesSaved: () => {
      if (auth.isAuthenticated && preferenceAccount.current === auth.sessionGeneration) setPreferencesVersion(value => value + 1);
    },
  }}>{children}</ReaderContext.Provider>;
}
