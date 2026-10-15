import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { getMyBooks, removeBookStatus, setBookStatus } from "../api/userBooks.js";
import { ensureLibraryBook, getReadingCapabilities, lookupLibraryBooks } from "../api/reading.js";
import { useAuth } from "./AuthContext.jsx";

const UserBooksContext = createContext(null);
const CACHE_LIMIT = 200;

function savedState(entry) {
  return { id: entry.entry_id ?? entry.id ?? null, book_id: entry.book_id,
    is_owned: entry.is_owned, is_wanted: entry.is_wanted, version: entry.version,
    status: entry.is_owned ? "owned" : entry.is_wanted ? "want" : null, known: true };
}

export function UserBooksProvider({ children }) {
  const auth = useAuth();
  const [booksById, setBooksById] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("loading");
  const [readOnly, setReadOnly] = useState(false);
  const [readingActions, setReadingActions] = useState(false);
  const [revision, setRevision] = useState(0);
  const [lookupErrors, setLookupErrors] = useState({});
  const [loadAttempt, setLoadAttempt] = useState(0);
  const sessionKey = `${auth.sessionGeneration}:${auth.isAuthenticated}`;
  const [loadedSession, setLoadedSession] = useState(null);
  const generation = useRef(0);
  const cache = useRef(new Map());
  const queued = useRef(new Map());
  const requests = useRef(new Set());
  const pipeline = useRef(null);

  const rememberEntries = useCallback((entries) => {
    for (const entry of entries) {
      if (!entry.book_id) continue;
      const existing = cache.current.get(entry.book_id);
      const next = savedState(entry);
      // A slower lookup/page response cannot roll back a newer mutation result.
      if (existing?.id && next.id === null) continue;
      if (existing?.id === next.id && existing?.version > next.version) continue;
      cache.current.delete(entry.book_id);
      cache.current.set(entry.book_id, next);
    }
    while (cache.current.size > CACHE_LIMIT) cache.current.delete(cache.current.keys().next().value);
    setBooksById(Object.fromEntries(cache.current));
  }, []);

  useEffect(() => {
    const token = ++generation.current;
    const controllers = requests.current;
    let active = true;
    setLoadedSession(sessionKey);
    cache.current.clear(); setBooksById({}); setLookupErrors({}); setError(""); setMode("loading");
    setReadOnly(false);
    setReadingActions(false);
    for (const controller of requests.current) controller.abort();
    for (const waiters of queued.current.values()) for (const waiter of waiters) waiter.reject(new Error("Account changed"));
    queued.current.clear(); pipeline.current = null;
    if (!auth.isAuthenticated) { setMode("legacy"); setLoading(false); return undefined; }
    setLoading(true);
    getReadingCapabilities().catch((failure) => {
      // Compatibility with an older backend only; network/500 failures remain unknown.
      if (failure.status === 404) return { enabled: false };
      throw failure;
    }).then(async (capabilities) => {
      if (!active || generation.current !== token) return;
      if (typeof capabilities?.enabled !== "boolean") throw new Error("Unable to check your library.");
      if (capabilities.enabled) {
        if (capabilities.contract_version !== 1) throw new Error("Refresh this page to use the current library.");
        setReadOnly(capabilities.writable === false);
        setReadingActions(capabilities.features?.reading_actions === true);
        setMode("v3");
      } else {
        const items = await getMyBooks();
        if (!active || generation.current !== token) return;
        if (!Array.isArray(items)) throw new Error("Unable to load your saved books.");
        setBooksById(Object.fromEntries(items.map((item) => [item.book_id, item])));
        setMode("legacy");
      }
    }).catch(failure => {
      if (active && generation.current === token) setError(failure.message || "Unable to load your library.");
    }).finally(() => { if (active && generation.current === token) setLoading(false); });
    return () => {
      active = false; generation.current += 1;
      for (const controller of controllers) controller.abort();
    };
  }, [auth.isAuthenticated, auth.sessionGeneration, sessionKey, loadAttempt]);

  const loadVisibleBooks = useCallback((bookIds, retry = false) => {
    if (mode !== "v3") return Promise.resolve();
    const ids = [...new Set(bookIds)].filter(Number.isSafeInteger).slice(0, 100);
    const pending = ids.map((id) => {
      if (retry) cache.current.delete(id);
      if (!retry && cache.current.has(id)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const waiters = queued.current.get(id) || [];
        waiters.push({ resolve, reject }); queued.current.set(id, waiters);
      });
    });
    if (pipeline.current !== generation.current) {
      const token = generation.current;
      pipeline.current = token;
      // All visible card effects join one bounded request instead of one per card.
      queueMicrotask(async () => {
        while (generation.current === token && queued.current.size) {
          const batch = [...queued.current.entries()].slice(0, 50);
          for (const [id] of batch) queued.current.delete(id);
          const known = batch.filter(([id]) => cache.current.has(id));
          for (const [, waiters] of known) for (const waiter of waiters) waiter.resolve();
          const missing = batch.filter(([id]) => !cache.current.has(id));
          if (!missing.length) continue;
          const controller = new AbortController(); requests.current.add(controller);
          try {
            const payload = await lookupLibraryBooks(missing.map(([id]) => id), controller.signal);
            if (generation.current !== token) throw new Error("Account changed");
            if (!Array.isArray(payload?.items) || payload.items.length !== missing.length || missing.some(([id]) => !payload.items.some(item =>
              item.book_id === id && typeof item.is_owned === "boolean" && typeof item.is_wanted === "boolean" &&
              (item.entry_id === null || (Number.isSafeInteger(item.entry_id) && Number.isSafeInteger(item.version)))))) {
              throw new Error("Unable to check these saved books.");
            }
            rememberEntries(payload.items);
            setLookupErrors(current => { const next = { ...current }; for (const [id] of batch) delete next[id]; return next; });
            for (const [, waiters] of missing) for (const waiter of waiters) waiter.resolve();
          } catch (failure) {
            if (generation.current === token) setLookupErrors(current => {
              const next = { ...current, ...Object.fromEntries(missing.map(([id]) => [id, "Your saved status couldn’t be checked."])) };
              return Object.fromEntries(Object.entries(next).slice(-CACHE_LIMIT));
            });
            for (const [, waiters] of missing) for (const waiter of waiters) waiter.reject(failure);
          } finally { requests.current.delete(controller); }
        }
        if (pipeline.current === token) pipeline.current = null;
      });
    }
    return Promise.all(pending);
  }, [mode, rememberEntries]);

  const setFlag = useCallback(async (bookId, status, value) => {
    if (readOnly) throw new Error("Library changes are temporarily paused.");
    const token = generation.current;
    await loadVisibleBooks([bookId]);
    if (token !== generation.current) throw new Error("Account changed");
    const current = cache.current.get(bookId);
    if (!current?.known) throw new Error("Check your saved status before making changes.");
    try {
      const result = await ensureLibraryBook(bookId, {
        [status === "owned" ? "is_owned" : "is_wanted"]: value,
        ...(current.version ? { expected_version: current.version } : {}),
      });
      if (token === generation.current) { rememberEntries([result]); setRevision(number => number + 1); }
      return result;
    } catch (failure) {
      if (token === generation.current && failure.status === 409) {
        if (failure.detail?.current) rememberEntries([failure.detail.current]);
        else { cache.current.delete(bookId); await loadVisibleBooks([bookId], true).catch(() => {}); }
        setRevision(number => number + 1);
      }
      throw failure;
    }
  }, [loadVisibleBooks, rememberEntries, readOnly]);

  const value = useMemo(() => ({
    booksById: loadedSession === sessionKey ? booksById : {},
    loading: loadedSession !== sessionKey || loading,
    error: loadedSession === sessionKey ? error : "",
    mode: loadedSession === sessionKey ? mode : "loading",
    readingActions: loadedSession === sessionKey && readingActions,
    readingChanged(entry) { if (entry) rememberEntries([entry]); setRevision(number => number + 1); },
    revision, readOnly, lookupErrors: loadedSession === sessionKey ? lookupErrors : {}, loadVisibleBooks, rememberEntries,
    retryLoad() { setLoadAttempt(attempt => attempt + 1); },
    async updateStatus(bookId, status) {
      if (mode === "v3") return setFlag(bookId, status, true);
      const token = generation.current;
      const next = await setBookStatus(bookId, status);
      if (token === generation.current) setBooksById(current => ({ ...current, [bookId]: next }));
      return next;
    },
    async clearStatus(bookId, status) {
      if (mode === "v3") return setFlag(bookId, status, false);
      const token = generation.current;
      await removeBookStatus(bookId);
      if (token !== generation.current) return;
      setBooksById(current => { const next = { ...current }; delete next[bookId]; return next; });
    },
  }), [booksById, loading, error, mode, revision, readOnly, readingActions, lookupErrors, loadedSession, sessionKey, loadVisibleBooks, rememberEntries, setFlag]);

  return <UserBooksContext.Provider value={value}>{children}</UserBooksContext.Provider>;
}

export function useUserBooks() {
  const context = useContext(UserBooksContext);
  if (!context) throw new Error("useUserBooks must be used within UserBooksProvider");
  return context;
}
