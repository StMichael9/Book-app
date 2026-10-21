import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { getLibraryPage } from "../../api/reading.js";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { useRequest } from "../ui-v2/data.js";
import { ActionLink, BookSkeletons, Button, EmptyState, PageHeading, TextLink } from "../ui-v2/primitives.jsx";

import { LibraryEntryCard } from "./ReadingCards.jsx";

function LibrarySearch({ query, onSearch }) {
  const [draft, setDraft] = useState(query);
  return <form className="bv-library-search bv-field" role="search" aria-label="Search your library" onSubmit={event => { event.preventDefault(); onSearch(draft.trim()); }}>
    <label htmlFor="bv-library-query">Search title or author</label>
    <div className="bv-library-search-row"><input id="bv-library-query" value={draft} maxLength={200} onChange={event => setDraft(event.target.value)} placeholder="Find a saved book" /><Button type="submit" variant="secondary">Search</Button></div>
  </form>;
}

export default function LibraryPage() {
  const auth = useAuth();
  const library = useUserBooks();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const go = useNavigate();
  const q = params.get("q") || "";
  const facet = ["owned", "want", "reading", "paused", "finished", "dnf"].includes(params.get("status")) ? params.get("status") : "all";
  const cursor = params.get("cursor") || "";
  const label = params.get("label") || "";
  const { rememberEntries } = library;
  const request = useRequest(async () => {
    const page = await getLibraryPage({ q, facet, ...(cursor ? { cursor } : {}), ...(label ? { label } : {}) });
    if (!Array.isArray(page?.items) || !page.counts || typeof page.total !== "number") throw new Error("Unable to load your library.");
    return page;
  }, `library:${auth.sessionGeneration}:${q}:${facet}:${cursor}:${label}:${library.revision}`);
  useEffect(() => {
    if (request.data) rememberEntries(request.data.items);
  }, [request.data, rememberEntries]);
  function navigate(nextFacet, nextQuery, nextCursor = "", pagination = false) {
    setParams({ ...(nextFacet === "all" ? {} : { status: nextFacet }), ...(nextQuery ? { q: nextQuery } : {}), ...(nextCursor ? { cursor: nextCursor } : {}), ...(label ? { label } : {}) },
      { state: pagination ? { libraryPagination: true } : null });
  }
  const counts = request.data?.counts;
  const commonFacets = [["all", "All"], ...(library.readingActions ? [["reading", "Reading"]] : []), ["want", "Want"], ...(library.readingActions ? [["finished", "Finished"]] : [])];
  const otherFacets = [["owned", "Own"], ...(library.readingActions ? [["paused", "Paused"], ["dnf", "Stopped"]] : [])];
  const activeOther = otherFacets.find(([key]) => key === facet);
  const filterButton = ([key, label]) => <Button key={key} variant={facet === key ? "saved" : "quiet"} aria-pressed={facet === key} onClick={() => navigate(key, q)}>{label}<span>{counts?.[key] ?? "…"}</span></Button>;
  const affiliateLinks = facet === "want" && request.data?.items.some(entry => entry.book && bookshopAffiliateUrl(entry.book));

  return <section className="bv-container bv-reading-library">
    <div className="bv-library-heading"><PageHeading eyebrow="Your complete collection" title="My Books">Find, organize and revisit your books, from Want to past readings.</PageHeading>{library.libraryImport && !library.readOnly && <ActionLink to="/my-books/import" variant="secondary">Bring Your Library</ActionLink>}</div>
    <LibrarySearch key={q} query={q} onSearch={value => navigate(facet, value)} />
    {label && <p className="bv-notice">Imported label: {label} <Button variant="quiet" onClick={() => { const next = new URLSearchParams(params); next.delete("label"); next.delete("cursor"); setParams(next); }}>Clear label filter</Button></p>}
    <div className="bv-filter-groups"><div className="bv-library-facets" role="group" aria-label="Filter your library">{[...commonFacets, ...(activeOther ? [activeOther] : [])].map(filterButton)}</div>
      <details className="bv-library-more"><summary>More filters</summary><div className="bv-library-facets" role="group" aria-label="More library filters">{otherFacets.filter(([key]) => key !== facet).map(filterButton)}</div><p className="bv-help">Own and Want are separate; a book can be on both lists.</p></details>
    </div>
    {(facet === "finished" || facet === "dnf") && <p className="bv-help">Books with a {facet === "finished" ? "finished" : "stopped"} reading. Each card shows its current or latest recorded reading state.</p>}
    {library.readOnly && <p className="bv-notice" role="status">Your library is available to read. Changes are temporarily paused.</p>}
    {request.loading ? <BookSkeletons /> : request.error ? <EmptyState error icon={BookOpen} title="Your library couldn’t load." action={<><Button onClick={request.retry}>Try again</Button>{cursor && <Button variant="quiet" onClick={() => navigate(facet, q)}>Return to first page</Button>}</>}>Your saved books haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <>
      <p className="bv-library-caption bv-muted" role="status">{request.data.total} {request.data.total === 1 ? "book" : "books"}{q ? ` matching “${q}”` : " in this view"}.</p>
      <div className="bv-book-grid">{request.data.items.map((entry, index) => <LibraryEntryCard key={entry.id} entry={entry} priority={index < 5} readingActions={library.readingActions} buyUrl={facet === "want" && entry.book ? bookshopAffiliateUrl(entry.book) : null} />)}</div>
      {affiliateLinks && <p className="bv-help">Bookshop links are affiliate links. Bookvane may earn a commission if you purchase through them.</p>}
      </> : <EmptyState icon={BookOpen} title={cursor ? "No books on this page." : q || facet !== "all" ? "No saved books match this view." : "Give your books a home."} action={!cursor && <ActionLink to="/browse">Discover books</ActionLink>}>
        {cursor ? "Your library may have changed. Return to an earlier page or start again at the first page." : q || facet !== "all" ? "Try another title or author, or change the library filter." : "Save a book with Own or Want to keep it here."}
      </EmptyState>}
      {(cursor || request.data.next_cursor) && <nav className="bv-library-pagination" aria-label="Library pages">
        {cursor && location.state?.libraryPagination && <Button variant="secondary" onClick={() => go(-1)}>Previous page</Button>}
        {cursor && <Button variant="secondary" onClick={() => navigate(facet, q)}>Return to first page</Button>}
        {request.data.next_cursor && <Button variant="secondary" onClick={() => navigate(facet, q, request.data.next_cursor, true)}>Next page</Button>}
      </nav>}
    </>}
    {library.readingActions && !library.readOnly && <p className="bv-library-tools"><TextLink to="/my-books/private">Add a missing book</TextLink></p>}
  </section>;
}
