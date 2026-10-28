import { useCallback, useEffect } from "react";
import { getBooks } from "../../api/books.js";
import { getLibraryPage, getReadingHome, getReadingWorkspace } from "../../api/reading.js";
import { prefetchRequest, readRequestCache } from "../../api/requestCache.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";

const WORKSPACES_AHEAD = 3;
const libraryFirstPage = () => getLibraryPage({ q: "", facet: "all" }).then(page => {
  if (!Array.isArray(page?.items) || !page.counts || typeof page.total !== "number") throw new Error("Unable to load your library.");
  return page;
});

// Warms the signed-in pages a reader is about to open. The keys are the ones the pages use for their own requests
// (see ReadingHomePage and LibraryPage), so a page that opens afterwards finds its data already in the cache.
export function usePageWarmers() {
  const auth = useAuth(), library = useUserBooks();
  const generation = auth.sessionGeneration, revision = library.revision;
  const ready = auth.isAuthenticated && !auth.isLoading && library.readingActions && !library.loading && !library.error;
  const warmWorkspaces = useCallback(entries => {
    for (const { id } of entries.slice(0, WORKSPACES_AHEAD)) {
      prefetchRequest(`workspace:${generation}:${id}:${revision}`, () => getReadingWorkspace(id));
    }
  }, [generation, revision]);
  const warmHome = useCallback(() => {
    if (!ready) return;
    const key = `home:${generation}:${revision}`;
    prefetchRequest(key, () => getReadingHome().then(home => { warmWorkspaces(home.current_reads.map(item => item.entry)); return home; }));
    const cached = readRequestCache(key);
    if (cached) warmWorkspaces(cached.data.current_reads.map(item => item.entry));
  }, [ready, generation, revision, warmWorkspaces]);
  const warmLibrary = useCallback(() => {
    if (!ready) return;
    const key = `library:${generation}::all:::${revision}`;
    prefetchRequest(key, () => libraryFirstPage().then(page => { warmWorkspaces(page.items); return page; }));
    const cached = readRequestCache(key);
    if (cached) warmWorkspaces(cached.data.items);
  }, [ready, generation, revision, warmWorkspaces]);
  // As soon as the session is known (and after signing in), the reader's own pages are fetched in the background.
  useEffect(() => { warmHome(); warmLibrary(); }, [warmHome, warmLibrary]);
  // Pointing at or focusing a navigation link warms that page too.
  return useCallback(path => {
    if (path === "/home") warmHome();
    else if (path === "/my-books") warmLibrary();
    else if (path === "/browse") getBooks({ size: 20 }).catch(() => {});
  }, [warmHome, warmLibrary]);
}
