import { useCallback, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { getBooks } from "../../api/books.js";
import { getReadingHome, getReadingWorkspace } from "../../api/reading.js";
import { defaultLibraryState, libraryKey, loadLibraryPage } from "../reading/library/libraryQuery.js";
import { homeKeys, workspaceKey } from "../../api/earlyStart.js";
import { prefetchRequest, readRequestCache } from "../../api/requestCache.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";

const WORKSPACES_AHEAD = 3;
const libraryFirstPage = () => loadLibraryPage(defaultLibraryState());

// Warms the signed-in pages a reader is about to open. The keys are the ones the pages use for their own requests
// (see ReadingHomePage and LibraryPage), so a page that opens afterwards finds its data already in the cache.
export function usePageWarmers() {
  const auth = useAuth(), library = useUserBooks(), onHome = useLocation().pathname === "/home";
  const generation = auth.sessionGeneration, revision = library.revision;
  const ready = auth.isAuthenticated && !auth.isLoading && library.readingActions && !library.loading && !library.error;
  // Best effort and never fatal: a response with an unexpected shape just warms nothing, and cannot fail the page's request.
  const warmWorkspaces = useCallback(entries => {
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(0, WORKSPACES_AHEAD)) {
      const id = entry?.id;
      if (Number.isSafeInteger(id)) prefetchRequest(workspaceKey(generation, id, revision), () => getReadingWorkspace(id));
    }
  }, [generation, revision]);
  const warmHome = useCallback(() => {
    if (!ready) return;
    const key = homeKeys(`${generation}:${revision}`).home;
    prefetchRequest(key, () => getReadingHome().then(home => { warmWorkspaces(home?.current_reads?.map(item => item?.entry)); return home; }));
    const cached = readRequestCache(key);
    if (cached) warmWorkspaces(cached.data?.current_reads?.map(item => item?.entry));
  }, [ready, generation, revision, warmWorkspaces]);
  const warmLibrary = useCallback(() => {
    if (!ready) return;
    const key = libraryKey(generation, defaultLibraryState(), revision);
    prefetchRequest(key, () => libraryFirstPage().then(page => { warmWorkspaces(page.items); return page; }));
    const cached = readRequestCache(key);
    if (cached) warmWorkspaces(cached.data?.items);
  }, [ready, generation, revision, warmWorkspaces]);
  // As soon as the session is known (and after signing in), the reader's own pages are fetched in the background.
  // Home reads the library itself (one request), so it does not also warm My Books; pointing at the link still does.
  useEffect(() => { warmHome(); if (!onHome) warmLibrary(); }, [warmHome, warmLibrary, onHome]);
  // Pointing at or focusing a navigation link warms that page too.
  return useCallback(path => {
    if (path === "/home") warmHome();
    else if (path === "/my-books") warmLibrary();
    else if (path === "/browse") getBooks({ size: 20, sort: "popular" }).catch(() => {});
  }, [warmHome, warmLibrary]);
}
