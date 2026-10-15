import { useEffect, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { BookOpen } from "lucide-react";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import { getLibraryPage } from "../../api/reading.js";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { useRequest } from "../ui-v2/data.js";
import { ActionLink, BookCard, BookCover, BookSkeletons, Button, EmptyState, PageHeading } from "../ui-v2/primitives.jsx";

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
  const { rememberEntries } = library;
  const request = useRequest(async () => {
    const page = await getLibraryPage({ q, facet, ...(cursor ? { cursor } : {}) });
    if (!Array.isArray(page?.items) || !page.counts || typeof page.total !== "number") throw new Error("Unable to load your library.");
    return page;
  }, `library:${auth.sessionGeneration}:${q}:${facet}:${cursor}:${library.revision}`);
  useEffect(() => {
    if (request.data) rememberEntries(request.data.items);
  }, [request.data, rememberEntries]);
  function navigate(nextFacet, nextQuery, nextCursor = "", pagination = false) {
    setParams({ ...(nextFacet === "all" ? {} : { status: nextFacet }), ...(nextQuery ? { q: nextQuery } : {}), ...(nextCursor ? { cursor: nextCursor } : {}) },
      { state: pagination ? { libraryPagination: true } : null });
  }
  const counts = request.data?.counts;
  const facets = [["all", "All"], ["want", "Want"], ["owned", "Own"],
    ...[["reading", "Reading"], ["paused", "Paused"], ["finished", "Finished"], ["dnf", "Stopped"]].filter(([key]) => counts?.[key] || facet === key)];
  const affiliateLinks = facet === "want" && request.data?.items.some(entry => entry.book && bookshopAffiliateUrl(entry.book));
  return <section className="bv-container bv-reading-library">
    <div className="bv-library-heading"><PageHeading eyebrow="Your personal library" title="My Books">Books you own, books you want, and room for your reading history.</PageHeading><ActionLink to="/browse" variant="secondary">Find more books</ActionLink></div>
    <LibrarySearch key={q} query={q} onSearch={value => navigate(facet, value)} />
    <div className="bv-library-facets" role="group" aria-label="Filter your library">{facets.map(([key, label]) => <Button key={key} variant={facet === key ? "saved" : "quiet"} aria-pressed={facet === key} onClick={() => navigate(key, q)}>{label}<span>{counts?.[key] ?? "…"}</span></Button>)}</div>
    <p className="bv-help">Own and Want are independent. A book can belong to both.</p>
    {library.readOnly && <p className="bv-notice" role="status">Your library is available to read. Changes are temporarily paused.</p>}
    {request.loading ? <BookSkeletons /> : request.error ? <EmptyState error icon={BookOpen} title="Your library couldn’t load." action={<><Button onClick={request.retry}>Try again</Button>{cursor && <Button variant="quiet" onClick={() => navigate(facet, q)}>Return to first page</Button>}</>}>Your saved books haven’t changed.</EmptyState> : <>
      {request.data.items.length ? <>
      <p className="bv-library-caption bv-muted" role="status">{request.data.total} {request.data.total === 1 ? "book" : "books"}{q ? ` matching “${q}”` : " in this view"}. Newest saved first.</p>
      <div className="bv-book-grid">{request.data.items.map((entry, index) => entry.book ?
        <BookCard key={entry.id} book={entry.book} priority={index < 5} buyUrl={facet === "want" ? bookshopAffiliateUrl(entry.book) : null} /> :
        <article className="bv-book-card" key={entry.id}><BookCover book={{ title: entry.private_title, authors: entry.private_author ? [{ name: entry.private_author }] : [] }} /><h3>{entry.private_title}</h3><p className="bv-author">{entry.private_author || "Author not listed"}</p><p className="bv-help">Private library entry</p></article>
      )}</div>
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
  </section>;
}
