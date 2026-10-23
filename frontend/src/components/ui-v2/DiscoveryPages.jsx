import { useCallback, useRef, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Search, SlidersHorizontal } from "lucide-react";
import { getBooks, getBookById } from "../../api/books.js";
import ExtendedCatalogue, { ManualBookLink } from "../reading/ExtendedCatalogue.jsx";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import SaveContinuation from "./SaveContinuation.jsx";
import { useAuth } from "../../hooks/AuthContext.jsx";
import ShareBookButton from "../ShareBookButton.jsx";
import { useReader } from "./readerState.js";
import { SUBJECTS, authorLabel, catalogueResponse, errorText, safeReturnTo, subjectLabel, useDocumentTitle, useRequest } from "./data.js";
import { ActionLink, BookCover, BookGrid, BookSkeletons, Button, EmptyState, NativeDialog, PageHeading, SectionHeading, ShelfActions, TextLink } from "./primitives.jsx";
import { useParams } from "react-router-dom";

export function WelcomePage() {
  const auth = useAuth();
  // Personalized catalogue ordering and in-flight requests belong to one
  // session, not to every account that happens to be signed in in this SPA.
  const scope = auth.isAuthenticated ? `session:${auth.sessionGeneration}` : "public";
  const books = useRequest(async () => catalogueResponse(await getBooks({ size: 10, cacheScope: scope })), `welcome:${scope}`, !auth.isLoading);
  const items = books.data?.items || [];
  const heroBooks = [...items.filter((book) => book.cover_image_url), ...items.filter((book) => !book.cover_image_url)].slice(0, 3);
  const subjects = ["fantasy", "mystery", "romance", "science_fiction"];
  return <>
    <section className="bv-container bv-hero">
      <div>
        <p className="bv-eyebrow">A little space for your reading life</p>
        <h1>Your personal<br /><em>reading home.</em></h1>
        <p className="bv-lead bv-muted">Discover books, keep your library together, and track what you’re reading. At your own pace.</p>
        <div className="bv-hero-actions"><ActionLink to="/browse">Explore books <ArrowRight aria-hidden="true" /></ActionLink>
          <TextLink to={auth.isAuthenticated ? "/my-books" : "/register"}>{auth.isAuthenticated ? "Return to your library" : "Create your library"}</TextLink></div>
        <p className="bv-help">{!auth.isAuthenticated ? "No account needed to explore." : "Your books are right where you left them."}</p>
      </div>
      <div className="bv-hero-display">
        <div className="bv-hero-covers">{books.loading ? Array.from({ length: 3 }, (_, i) => <div key={i} className="bv-skeleton bv-skeleton--cover" aria-hidden="true" />) :
          heroBooks.length ? heroBooks.map((book) => <Link key={book.id} to={`/book/${book.id}`} aria-label={`Explore ${book.title}`}><BookCover book={book} priority /></Link>) :
            <div className="bv-hero-placeholder"><BookOpen aria-hidden="true" /><p>Explore the catalogue to find your next book.</p></div>}
        </div><div className="bv-shelf-rule" />
      </div>
    </section>
    <section className="bv-container bv-section"><SectionHeading title="Open a new chapter" to="/browse">A few books to spark your curiosity.</SectionHeading>
      {books.loading ? <BookSkeletons /> : books.error ? <EmptyState error icon={BookOpen} title="The books are taking a moment." action={<Button onClick={books.retry}>Try again</Button>}>We couldn’t load the catalogue. You can try again or continue to discovery.</EmptyState> : items.length ? <BookGrid books={items.slice(0, 5)} preview /> : <EmptyState title="More stories are on their way." action={<ActionLink to="/browse">Explore books</ActionLink>}>Try discovery to see what’s available.</EmptyState>}
      <nav className="bv-landing-subjects" aria-label="Explore by subject">{subjects.map(subject => <TextLink key={subject} to={`/browse?tag=${subject}`}>{subjectLabel(subject)}</TextLink>)}</nav>
    </section>
    <section className="bv-container bv-section bv-landing-story" aria-label="Your reading life"><SectionHeading title="Make room for your reading life." />
      <div className="bv-landing-benefits"><div><h3>Keep your books together.</h3><p>The books you own, the ones you want, and the stories you’ve already spent time with.</p></div><div><h3>Pick up where you left off.</h3><p>A place for your current books, with optional progress and private notes.</p></div><div><h3>Find your next beginning.</h3><p>Finish a book, then choose what calls to you next. There’s no required rating or journal.</p></div></div>
    </section>
    <section className="bv-container"><div className="bv-library-banner"><div><h2>A home for your kind of books.</h2><p>Start with a book that interests you. Save it to your library, and make this space your own.</p></div><ActionLink to={auth.isAuthenticated ? "/my-books" : "/register"}>{auth.isAuthenticated ? "Open your library" : "Create your library"}</ActionLink></div></section>
  </>;
}

function FilterDialog({ onClose, onApply, initial, authenticated }) {
  const [tags, setTags] = useState(initial.tags);
  const [exclude, setExclude] = useState(initial.exclude);
  const [shelf, setShelf] = useState(initial.shelf);
  const [find, setFind] = useState("");
  return <NativeDialog open onClose={onClose} title="Filters" className="bv-filter-dialog">
    <p className="bv-muted" id="bv-filter-help">Choose subjects to narrow your search. Books must match every selected subject.</p>
    <form onSubmit={(event) => { event.preventDefault(); onApply({ tags, exclude, shelf }); }}>
      <fieldset aria-describedby="bv-filter-help"><legend>Subjects</legend><label className="bv-sr-only" htmlFor="bv-find-subject">Find a subject</label>
        <input id="bv-find-subject" type="search" value={find} onChange={(event) => setFind(event.target.value)} placeholder="Find a subject" />
        <div className="bv-preference-grid">{SUBJECTS.filter(([slug, label]) => `${slug} ${label}`.toLowerCase().includes(find.toLowerCase())).map(([slug, label]) => <label className="bv-check-tile" key={slug}>
          <input type="checkbox" checked={tags.includes(slug)} onChange={(event) => setTags((current) => event.target.checked ? [...current, slug] : current.filter((value) => value !== slug))} /><span>{label}</span>
        </label>)}</div>
        {!SUBJECTS.some(([slug, label]) => `${slug} ${label}`.toLowerCase().includes(find.toLowerCase())) && <p className="bv-help">No subjects match. Try another word.</p>}
      </fieldset>
      {authenticated && <div className="bv-discovery-extras"><label className="bv-checkbox"><input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} /><span>Hide books I own</span></label>
        <label htmlFor="bv-shelf-filter">Search within</label><select id="bv-shelf-filter" value={shelf} onChange={(event) => setShelf(event.target.value)}><option value="">All books</option><option value="want">My Want to read books</option><option value="owned">Books I own</option></select>
      </div>}
      <div className="bv-dialog-actions"><Button variant="secondary" onClick={() => { setTags([]); setExclude(false); setShelf(""); setFind(""); }}>Reset filters</Button><Button type="submit">Apply filters</Button></div>
    </form>
  </NativeDialog>;
}

export function BrowsePage() {
  const auth = useAuth();
  const library = useUserBooks();
  const reader = useReader();
  const [params, setParams] = useSearchParams();
  const queryKey = params.toString();
  const book = params.get("book") || "";
  const author = params.get("author") || "";
  const tags = [...new Set(params.getAll("tag").filter(Boolean))];
  const page = Math.max(1, parseInt(params.get("page"), 10) || 1);
  const exclude = auth.isAuthenticated && params.get("exclude_owned") === "true";
  const shelf = auth.isAuthenticated && ["want", "owned"].includes(params.get("shelf_status")) ? params.get("shelf_status") : "";
  const [searchDraft, setSearchDraft] = useState({ book, author, mode: author && !book ? "author" : "book", value: author && !book ? author : book });
  if (searchDraft.book !== book || searchDraft.author !== author) {
    setSearchDraft({ book, author, mode: author && !book ? "author" : "book", value: author && !book ? author : book });
  }
  const mode = searchDraft.mode;
  const draft = searchDraft.value;
  const setMode = (value) => setSearchDraft((current) => ({ ...current, mode: value }));
  const setDraft = (value) => setSearchDraft((current) => ({ ...current, value }));
  const [filterOpen, setFilterOpen] = useState(false);
  const shelfRevision = shelf || exclude ? library.revision : 0;
  const scope = auth.isAuthenticated ? `session:${auth.sessionGeneration}:${reader.preferencesVersion}:${shelfRevision}` : "public";
  const request = useRequest(async () => catalogueResponse(await getBooks({ book, author, tags, exclude_owned: exclude, shelf_status: shelf, page, size: 20, cacheScope: scope })), `browse:${scope}:${queryKey}:${reader.preferencesVersion}`, !auth.isLoading);
  const items = request.data?.items || [];
  const total = request.data?.total || 0;
  const size = Number(request.data?.size) || 20;
  const pages = Math.max(1, Math.ceil(total / size));
  const unfilteredSearch = Boolean(book.trim() || author.trim()) && page === 1 && !tags.length && !exclude && !shelf;
  const extendedEligible = library.extendedCatalogue && unfilteredSearch;
  const checkingSearch = auth.isAuthenticated && unfilteredSearch && library.loading;
  const incompleteSearch = auth.isAuthenticated && unfilteredSearch && Boolean(library.error);
  // Without the extended catalogue, a writable reader can still keep a missing book privately.
  const canAddMissing = auth.isAuthenticated && library.readingActions && !library.readOnly && Boolean(book.trim() || author.trim());
  function update(mutator, scroll = true) {
    const next = new URLSearchParams(params); next.delete("page"); next.delete("view"); mutator(next); setParams(next);
    if (scroll) document.getElementById("bv-main-title")?.scrollIntoView({ block: "start" });
  }
  function applySearch(event) {
    event.preventDefault(); update((next) => { next.delete("book"); next.delete("author"); if (draft.trim()) next.set(mode, draft.trim()); });
  }
  function applyFilters(nextFilters) {
    update((next) => {
      next.delete("book"); next.delete("author"); if (draft.trim()) next.set(mode, draft.trim());
      next.delete("tag"); nextFilters.tags.forEach((tag) => next.append("tag", tag));
      next.delete("exclude_owned"); if (auth.isAuthenticated && nextFilters.exclude) next.set("exclude_owned", "true");
      next.delete("shelf_status"); if (auth.isAuthenticated && nextFilters.shelf) next.set("shelf_status", nextFilters.shelf);
    }, false); setFilterOpen(false);
  }
  function movePage(number) {
    if (number < 1 || number > pages) return;
    const next = new URLSearchParams(params); next.set("page", String(number)); setParams(next);
    document.getElementById("bv-results-heading")?.focus({ preventScroll: true });
    document.getElementById("bv-results-heading")?.scrollIntoView({ block: "start" });
  }
  return <section className="bv-container">
    <div className="bv-page-heading"><h1 id="bv-main-title">Find your next chapter.</h1><p className="bv-muted">Search by title or author, or start with a subject you love.</p></div>
    <div className="bv-search-zone"><form className="bv-search-form" onSubmit={applySearch} role="search">
      <label className="bv-sr-only" htmlFor="bv-search-mode">Search by</label><select id="bv-search-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="book">Title</option><option value="author">Author</option></select>
      <label className="bv-sr-only" htmlFor="bv-search-query">{mode === "author" ? "Search authors" : "Search book titles"}</label><input id="bv-search-query" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === "author" ? "Find an author" : "Find a book"} />
      <Button type="submit" aria-label="Search"><Search aria-hidden="true" /><span>Search</span></Button>
    </form><Button variant="secondary" className="bv-filter-trigger" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-label={`Filters${tags.length + Number(exclude) + Number(Boolean(shelf)) ? `, ${tags.length + Number(exclude) + Number(Boolean(shelf))} active` : ""}`}><SlidersHorizontal aria-hidden="true" /><span>Filters</span></Button></div>
    <div className="bv-chip-row" aria-label="Browse subjects"><Button variant={!tags.length ? "saved" : "secondary"} aria-pressed={!tags.length} className="bv-chip" onClick={() => update((next) => next.delete("tag"))}>All subjects</Button>
      {["fantasy", "mystery", "romance", "science_fiction", "classics", "history"].map((slug) => <Button key={slug} variant={tags.length === 1 && tags[0] === slug ? "saved" : "secondary"} aria-pressed={tags.length === 1 && tags[0] === slug} className="bv-chip" onClick={() => update((next) => { next.delete("tag"); next.append("tag", slug); })}>{subjectLabel(slug)}</Button>)}
    </div>
    {(book || author || tags.length || exclude || shelf) ? <div className="bv-applied-filters" aria-label="Applied filters">
      {book && <span>Title: {book}</span>}{author && <span>Author: {author}</span>}{tags.map((slug) => <span key={slug}>{subjectLabel(slug)}</span>)}
      {tags.length > 1 && <span>Match all subjects</span>}{exclude && <span>Books you own hidden</span>}{shelf && <span>{shelf === "owned" ? "Owned" : "Want to read"} only</span>}
      <Button variant="quiet" onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button>
    </div> : null}
    <div className="bv-results-heading"><h2 id="bv-results-heading" tabIndex={-1}>{book || author ? "Search results" : tags.length ? tags.map(subjectLabel).join(" + ") : "Books to explore"}</h2><span>{request.loading ? "Loading books…" : request.error || extendedEligible || checkingSearch || incompleteSearch ? "" : `${total.toLocaleString()} books`}</span></div>
    {request.loading ? <BookSkeletons count={10} /> : request.error ? <EmptyState title="The books couldn’t load." error action={<Button onClick={request.retry}>Try again</Button>}>{errorText(request.error, "Please try again. Your search and filters are still here.")}</EmptyState> : items.length ? <>
      <BookGrid books={items} />{(!extendedEligible || pages > 1) && <div className="bv-pagination">{!extendedEligible && <span>Showing {((page - 1) * size + 1).toLocaleString()}–{Math.min(page * size, total).toLocaleString()} of {total.toLocaleString()} books</span>}
        {pages > 1 && <nav aria-label="Results pages"><Button variant="secondary" disabled={page <= 1} onClick={() => movePage(page - 1)}><ArrowLeft aria-hidden="true" /><span>Previous</span></Button><span aria-current="page">Page {page} of {pages.toLocaleString()}</span><Button variant="secondary" disabled={page >= pages} onClick={() => movePage(page + 1)}><span>Next</span><ArrowRight aria-hidden="true" /></Button></nav>}
      </div>}
    </> : page > 1 && total > 0 ? <EmptyState title="You’ve reached the end of these results." action={<Button onClick={() => movePage(1)}>Back to the first page</Button>}>Your filters may have changed. Start again at page one.</EmptyState> : checkingSearch ? <p role="status" className="bv-help">Finishing your search…</p> : incompleteSearch ? <p role="status" className="bv-help">Additional books couldn’t be checked. Retry loading your library above or adjust your search.</p> : !extendedEligible ? <EmptyState title="No books found." action={<><Button onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button><Button variant="secondary" onClick={() => setFilterOpen(true)}>Adjust filters</Button></>}>Try a shorter title, search by author, or remove a subject filter.{canAddMissing && <p>Not in the catalogue? <ManualBookLink title={book} author={author}>Add it to your library yourself</ManualBookLink></p>}</EmptyState> : null}
    {extendedEligible && !request.loading && !request.error && <ExtendedCatalogue key={`${auth.sessionGeneration}:${book}:${author}`} title={book} author={author} hasLocalResults={items.length > 0} />}
    {filterOpen && <FilterDialog onClose={() => setFilterOpen(false)} onApply={applyFilters} initial={{ tags, exclude, shelf }} authenticated={auth.isAuthenticated} />}
  </section>;
}

export function BookPage() {
  const { bookId } = useParams();
  const library = useUserBooks();
  const reader = useReader();
  const location = useLocation();
  const candidate = safeReturnTo(new URLSearchParams(location.search).get("from") || location.state?.browseFrom, "/browse");
  const browseFrom = candidate.split("?")[0] === "/browse" ? candidate : "/browse";
  const request = useRequest(() => getBookById(bookId), `book:${bookId}`);
  const book = request.data;
  const loadingNode = useRef(null), errorNode = useRef(null), restoreHeadingFocus = useRef(false);
  const completeFocusTransition = useCallback(node => {
    if (!node) return;
    const restore = restoreHeadingFocus.current;
    restoreHeadingFocus.current = false;
    const heading = node.matches("h1") ? node : node.querySelector("h1, h2");
    if (restore && heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }, []);
  const trackLoading = useCallback(node => {
    if (!node && loadingNode.current) restoreHeadingFocus.current = loadingNode.current.contains(document.activeElement);
    loadingNode.current = node;
    completeFocusTransition(node);
  }, [completeFocusTransition]);
  const trackError = useCallback(node => {
    // Safari pointer activation may focus main rather than the Retry button.
    // Preserve the explicit retry intent until the next loading mount consumes it.
    if (!node && errorNode.current?.contains(document.activeElement)) restoreHeadingFocus.current = true;
    errorNode.current = node;
    completeFocusTransition(node);
  }, [completeFocusTransition]);
  const saved = reader.libraryReady && !library.loading && !library.error && library.booksById[bookId]?.status;
  const continuingSave = ["want", "owned"].includes(new URLSearchParams(location.search).get("save"));
  useDocumentTitle(book?.title);
  return <section className="bv-container">
    <div className="bv-breadcrumb"><TextLink to={browseFrom}><ArrowLeft aria-hidden="true" />Back to discovery</TextLink></div>
    {request.loading ? <div key="loading" className="bv-detail" ref={trackLoading}><div className="bv-detail-art"><div className="bv-skeleton bv-skeleton--cover bv-detail-cover-placeholder" /></div><div><PageHeading title="Loading your book…" /><div className="bv-skeleton bv-skeleton--title" /></div></div> : request.error || !book ? <div key="error" ref={trackError}><EmptyState error title={request.error?.status === 404 ? "This book couldn’t be found." : "This book couldn’t load."} action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/browse" variant="secondary">Discover books</ActionLink></>}>Try again or explore another title.</EmptyState></div> : <article className="bv-detail" aria-labelledby="bv-book-title">
      <div className="bv-detail-art"><BookCover book={book} priority /></div>
      <div className="bv-detail-body"><h1 id="bv-book-title" tabIndex={-1} ref={completeFocusTransition}>{book.title || "Untitled book"}</h1>
        {book.subtitle && <p className="bv-lead bv-muted">{book.subtitle}</p>}
        <p className="bv-detail-author">{authorLabel(book)}</p>
        {book.tags?.length > 0 && <div className="bv-book-tags">{book.tags.map((tag) => <Link key={tag.id} to={`/browse?tag=${encodeURIComponent(tag.name)}`}>{subjectLabel(tag.name)}</Link>)}</div>}
        {(book.published_year != null || book.page_count > 0) && <dl className="bv-book-metadata">
          {book.published_year != null && <div><dt>Published</dt><dd>{book.published_year}</dd></div>}{book.page_count > 0 && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}
        </dl>}
        <ShelfActions book={book} hideError={continuingSave} /><SaveContinuation />
        {library.readingActions && <div className="bv-form-actions"><ActionLink to={`/my-books/start/${book.id}`} variant="secondary">Open or start your reading</ActionLink><p className="bv-help">Open an existing reading, or start your first. Starting keeps Owned and clears Want to read. A new reread is always your choice.</p></div>}
        {saved && <TextLink to="/my-books">View My Books <ArrowRight aria-hidden="true" /></TextLink>}
        <section className="bv-description"><h2>About this book</h2><p>{book.description || "A description isn’t available for this book yet. You can still save it to your library or explore its subjects."}</p></section>
        <div className="bv-share"><ShareBookButton book={book} /></div>
      </div>
    </article>}
  </section>;
}
