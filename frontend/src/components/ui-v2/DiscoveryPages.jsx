import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { trackEvent } from "./events.js";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Search, SlidersHorizontal } from "lucide-react";
import { getBooks, getBookById, getMoreBooks, resolveWork } from "../../api/books.js";
import { ManualBookLink } from "../reading/ExtendedCatalogue.jsx";
import WorkCard from "./WorkCard.jsx";
import { mergeResults, normalTitle, rankAll } from "./searchMerge.js";
import { useUserBooks } from "../../hooks/UserBooksContext.jsx";
import SaveContinuation from "./SaveContinuation.jsx";
import { useAuth } from "../../hooks/AuthContext.jsx";
import { useReader } from "./readerState.js";
import { useInstantBooks } from "./instantBooks.js";
import { bookshopAffiliateUrl } from "../../api/affiliate.js";
import { authorLabel, bookSummary, catalogueResponse, prefetchBook, errorText, firstImpressionOrder, formatYear, safeReturnTo, useRequest } from "./data.js";
import BookAbout from "./BookAbout.jsx";
import GenrePicker from "./GenrePicker.jsx";
import { useGenres } from "./useGenres.js";
import { useBookSeo } from "./bookSeo.js";
import PinToUpNext from "../reading/home/PinToUpNext.jsx";
import { ActionLink, BookCard, BookCover, BookGrid, BookSkeletons, Button, EmptyState, EnglishTitle, NativeDialog, PageHeading, SectionHeading, ShelfActions, TextLink } from "./primitives.jsx";
import { useParams } from "react-router-dom";

// Landing books are chosen by rule, not ID, so every environment's catalogue works:
// covered books with plain English-alphabet titles first, never repeating hero and row.
function landingSelection(items) {
  const ordered = firstImpressionOrder(items);
  // A very small catalogue can't fill both without repeating; then the row shows the first five.
  return { hero: ordered.slice(0, 3), row: ordered.length >= 8 ? ordered.slice(3, 8) : ordered.slice(0, 5) };
}

function GuestNoResults({ search }) {
  useEffect(() => { trackEvent("guest_search_empty"); }, [search]);
  return <div className="bv-guest-noresults"><p>Can’t find it here? With a free account you can add any book to your library yourself.</p>
    <div className="bv-form-actions"><ActionLink to={`/register?${new URLSearchParams({ src: "noresults", returnTo: `/browse?${search}` })}`}>Create free account</ActionLink>
      <ActionLink variant="secondary" to={`/login?${new URLSearchParams({ returnTo: `/browse?${search}` })}`}>Sign in</ActionLink></div></div>;
}

export function WelcomePage() {
  const auth = useAuth();
  // Personalized catalogue ordering and in-flight requests belong to one
  // session, not to every account that happens to be signed in in this SPA.
  const scope = auth.isAuthenticated ? `session:${auth.sessionGeneration}` : "public";
  const live = useRequest(async () => catalogueResponse(await getBooks({ size: 30, sort: "popular", cacheScope: scope })), `welcome:${scope}`, !auth.isLoading);
  const books = useInstantBooks({ view: "landing", eligible: true, auth, live });
  const items = books.data?.items || [];
  const { hero: heroBooks, row: rowBooks } = landingSelection(items);
  const { genres: allGenres, labelFor } = useGenres();
  const subjects = (allGenres || []).slice(0, 4).map(genre => genre.key);
  return <>
    <section className="bv-container bv-hero">
      <div>
        <p className="bv-eyebrow">A little space for your reading life</p>
        <h1>Your personal<br /><em>reading home.</em></h1>
        <p className="bv-lead bv-muted">Discover books, keep your library together, and track what you’re reading. At your own pace.</p>
        <div className="bv-hero-actions"><ActionLink to="/browse">Explore books <ArrowRight aria-hidden="true" /></ActionLink>
          <TextLink to={auth.isAuthenticated ? "/my-books" : "/register?src=landing"}>{auth.isAuthenticated ? "Return to your library" : "Create your library"}</TextLink></div>
        <p className="bv-help">{!auth.isAuthenticated ? "Free. Private. No account needed to explore." : "Your books are right where you left them."}</p>
      </div>
      <div className="bv-hero-display">
        <div className="bv-hero-covers">{books.loading ? Array.from({ length: 3 }, (_, i) => <div key={i} className="bv-skeleton bv-skeleton--cover" aria-hidden="true" />) :
          heroBooks.length ? heroBooks.map((book) => <Link key={book.id} to={`/book/${book.id}`} state={{ book: bookSummary(book) }} onPointerEnter={() => prefetchBook(book.id)} onTouchStart={() => prefetchBook(book.id)} aria-label={`Explore ${book.title}`}><BookCover book={book} hero /></Link>) :
            <div className="bv-hero-placeholder"><BookOpen aria-hidden="true" /><p>Explore the catalogue to find your next book.</p></div>}
        </div><div className="bv-shelf-rule" />
      </div>
    </section>
    <section className="bv-container bv-section"><SectionHeading title="Open a new chapter" to="/browse">A few books to spark your curiosity.</SectionHeading>
      {books.loading ? <BookSkeletons /> : books.error ? <EmptyState error icon={BookOpen} title="The books are taking a moment." action={<Button onClick={books.retry}>Try again</Button>}>We couldn’t load the catalogue. You can try again or continue to discovery.</EmptyState> : rowBooks.length ? <BookGrid books={rowBooks} preview /> : <EmptyState title="More stories are on their way." action={<ActionLink to="/browse">Explore books</ActionLink>}>Try discovery to see what’s available.</EmptyState>}
      <nav className="bv-landing-subjects" aria-label="Explore by genre">{subjects.map(subject => <TextLink key={subject} to={`/browse?tag=${subject}`}>{labelFor(subject)}</TextLink>)}</nav>
    </section>
    <section className="bv-container bv-section bv-landing-story" aria-label="Your reading life"><SectionHeading title="Make room for your reading life." />
      <div className="bv-landing-benefits"><div><h3>Keep your books together.</h3><p>The books you own, the ones you want, and the stories you’ve already spent time with.</p></div><div><h3>Pick up where you left off.</h3><p>A place for your current books, with optional progress and private notes.</p></div><div><h3>Find your next beginning.</h3><p>Finish a book, then choose what calls to you next. There’s no required rating or journal.</p></div></div>
    </section>
    <section className="bv-container"><div className="bv-library-banner"><div><h2>Your next book is waiting.</h2><p>Bookvane is free. Save what catches your eye, track what you’re reading, and keep notes only you can see.</p></div><ActionLink to={auth.isAuthenticated ? "/my-books" : "/register?src=landing"}>{auth.isAuthenticated ? "Open your library" : "Start your free library"}</ActionLink></div></section>
  </>;
}

function FilterDialog({ onClose, onApply, initial, authenticated }) {
  const { genres } = useGenres();
  const [tags, setTags] = useState(initial.tags);
  const [exclude, setExclude] = useState(initial.exclude);
  const [shelf, setShelf] = useState(initial.shelf);
  return <NativeDialog open onClose={onClose} title="Filters" className="bv-filter-dialog">
    {genres?.length > 0 && <p className="bv-muted" id="bv-filter-help">Choose genres to narrow your search. Books must match every genre you choose.</p>}
    <form onSubmit={(event) => { event.preventDefault(); onApply({ tags, exclude, shelf }); }}>
      {genres?.length > 0 && <fieldset aria-describedby="bv-filter-help"><legend>Genres</legend>
        <GenrePicker multiple value={tags} onChange={setTags} label="Genres" />
      </fieldset>}
      {authenticated && <div className="bv-discovery-extras"><label className="bv-checkbox"><input type="checkbox" checked={exclude} onChange={(event) => setExclude(event.target.checked)} /><span>Hide books I own</span></label>
        <label htmlFor="bv-shelf-filter">Search within</label><select id="bv-shelf-filter" value={shelf} onChange={(event) => setShelf(event.target.value)}><option value="">All books</option><option value="want">My Want to read books</option><option value="owned">Books I own</option></select>
      </div>}
      <div className="bv-dialog-actions"><Button variant="secondary" onClick={() => { setTags([]); setExclude(false); setShelf(""); }}>Reset filters</Button><Button type="submit">Apply filters</Button></div>
    </form>
  </NativeDialog>;
}

export function BrowsePage() {
  const auth = useAuth();
  const library = useUserBooks();
  const reader = useReader();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const queryKey = params.toString();
  const { labelFor } = useGenres();
  const book = params.get("book") || "";
  const author = params.get("author") || "";
  // A shared link can carry ?q= : one phrase that is looked for in titles and authors.
  const query = (params.get("q") || "").trim();
  const tags = [...new Set(params.getAll("tag").filter(Boolean))];
  const page = Math.max(1, parseInt(params.get("page"), 10) || 1);
  const exclude = auth.isAuthenticated && params.get("exclude_owned") === "true";
  const shelf = auth.isAuthenticated && ["want", "owned"].includes(params.get("shelf_status")) ? params.get("shelf_status") : "";
  const [searchDraft, setSearchDraft] = useState({ book, author, query, mode: author && !book ? "author" : "book", value: author && !book ? author : book || query });
  if (searchDraft.book !== book || searchDraft.author !== author || searchDraft.query !== query) {
    setSearchDraft({ book, author, query, mode: author && !book ? "author" : "book", value: author && !book ? author : book || query });
  }
  const mode = searchDraft.mode;
  const draft = searchDraft.value;
  const setMode = (value) => setSearchDraft((current) => ({ ...current, mode: value }));
  const setDraft = (value) => setSearchDraft((current) => ({ ...current, value }));
  const [filterOpen, setFilterOpen] = useState(false);
  const shelfRevision = shelf || exclude ? library.revision : 0;
  const scope = auth.isAuthenticated ? `session:${auth.sessionGeneration}:${reader.preferencesVersion}:${shelfRevision}` : "public";
  const searching = Boolean(book || author || query);
  const live = useRequest(async () => catalogueResponse(await getBooks({ book, author, q: query, ...(searching ? {} : { sort: "popular" }), tags, exclude_owned: exclude, shelf_status: shelf, page, size: 20, cacheScope: scope })), `browse:${scope}:${queryKey}:${reader.preferencesVersion}`, !auth.isLoading);
  // Only the plain first page (no search, filters or paging) may start from the snapshot or this browser's last copy.
  const request = useInstantBooks({ view: "browse", eligible: queryKey === "", auth, live });
  // Guests browsing without a search get the landing's first-impression order within each page.
  // Signed-in readers keep server order, which puts their preferred subjects first.
  const items = !auth.isAuthenticated && !searching ? firstImpressionOrder(request.data?.items || []) : request.data?.items || [];
  const total = request.data?.total || 0;
  const size = Number(request.data?.size) || 20;
  const pages = Math.max(1, Math.ceil(total / size));
  const unfilteredSearch = Boolean(book.trim() || author.trim() || query) && page === 1 && !tags.length && !exclude && !shelf;
  // One list: our books first, then the ones found beyond the catalogue, in the same grid and with no label.
  const merging = unfilteredSearch;
  const more = useRequest(() => getMoreBooks({ book, author, q: query }), `more:${queryKey}`, merging && !auth.isLoading);
  const morePending = merging && more.loading;
  // Nothing moves after the first paint. With an exact title match among our own results the list shows at once and the rest
  // is added below it. Without one, the list waits (behind "Searching…", for at most the 1.5 s the other answer is given) and
  // is then ranked once.
  const asked = book || query;
  const exact = Boolean(asked) && items.some(card => normalTitle(card.title) === normalTitle(asked));
  const ready = merging && !request.loading && !request.error;
  const hold = ready && !exact && morePending;
  const shown = !ready ? items : hold ? [] : exact ? mergeResults(items, more.data || [], asked) : rankAll(items, more.data || [], asked);
  const checkingSearch = auth.isAuthenticated && unfilteredSearch && library.loading;
  const incompleteSearch = auth.isAuthenticated && unfilteredSearch && Boolean(library.error);
  // Without the extended catalogue, a writable reader can still keep a missing book privately.
  const canAddMissing = auth.isAuthenticated && library.readingActions && !library.readOnly && Boolean(book.trim() || author.trim() || query);
  // The grid keeps room for one more row while the rest of the results are on their way, so nothing below it moves.
  const grid = useRef(null);
  useLayoutEffect(() => {
    const node = grid.current;
    if (!node) return;
    if (!morePending) { node.style.minHeight = ""; return; }
    if (!node.style.minHeight) node.style.minHeight = `${Math.ceil(node.getBoundingClientRect().height + (node.firstElementChild?.getBoundingClientRect().height || 0) + 28)}px`;
  });
  const navigate = useNavigate();
  const [opening, setOpening] = useState({ busy: new Set(), gone: new Set(), failed: {} });
  async function openWork(card) {
    if (opening.busy.has(card.work_key)) return;
    setOpening(current => ({ ...current, busy: new Set(current.busy).add(card.work_key), failed: { ...current.failed, [card.work_key]: "" } }));
    try {
      const id = await resolveWork(card.work_key);
      navigate(`/book/${id}`, { state: { browseFrom: location.pathname + location.search, book: bookSummary({ ...card, id }) } });
    } catch (error) {
      const unlistable = error.status === 422 && (error.detail?.code || error.detail) === "not_listable";
      // Too many at once, a busy server, or a signed-out refusal: all the same quiet line. A search never sends anyone to sign in.
      const later = [401, 429, 503].includes(error.status);
      setOpening(current => {
        const busy = new Set(current.busy); busy.delete(card.work_key);
        const gone = new Set(current.gone); if (unlistable) gone.add(card.work_key);
        return { busy, gone, failed: { ...current.failed, [card.work_key]: unlistable ? "" : later ? "Try again in a moment." : "Couldn’t open that book. Try again." } };
      });
      if (unlistable) reader.announce("That book isn’t available.");
    }
  }
  const visible = shown.filter(card => !card.work_key || !opening.gone.has(card.work_key));
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
    <div className="bv-page-heading"><h1 id="bv-main-title">Find your next chapter.</h1><p className="bv-muted">Search by title or author, or start with a genre you love.</p></div>
    <div className="bv-search-zone"><form className="bv-search-form" onSubmit={applySearch} role="search">
      <label className="bv-sr-only" htmlFor="bv-search-mode">Search by</label><select id="bv-search-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="book">Title</option><option value="author">Author</option></select>
      <label className="bv-sr-only" htmlFor="bv-search-query">{mode === "author" ? "Search authors" : "Search book titles"}</label><input id="bv-search-query" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === "author" ? "Find an author" : "Find a book"} />
      <Button type="submit" aria-label="Search"><Search aria-hidden="true" /><span>Search</span></Button>
    </form><Button variant="secondary" className="bv-filter-trigger" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-label={`Filters${tags.length + Number(exclude) + Number(Boolean(shelf)) ? `, ${tags.length + Number(exclude) + Number(Boolean(shelf))} active` : ""}`}><SlidersHorizontal aria-hidden="true" /><span>Filters</span></Button></div>
    <GenrePicker compact scrollRow includeAny anyLabel="All genres" label="Browse genres" className="bv-chip-row" value={tags.length === 1 ? tags[0] : ""} onChange={key => update(next => { next.delete("tag"); if (key) next.append("tag", key); })} />
    {(book || author || query || tags.length || exclude || shelf) ? <div className="bv-applied-filters" aria-label="Applied filters">
      {query && <span>Search: {query}</span>}{book && <span>Title: {book}</span>}{author && <span>Author: {author}</span>}{tags.map((slug) => labelFor(slug) && <span key={slug}>{labelFor(slug)}</span>)}
      {tags.length > 1 && <span>Match all genres</span>}{exclude && <span>Books you own hidden</span>}{shelf && <span>{shelf === "owned" ? "Owned" : "Want to read"} only</span>}
      <Button variant="quiet" onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button>
    </div> : null}
    {library.mode === "v3" && <p className="bv-sr-only">Want to read and Owned are separate. Changing one keeps the other.</p>}
    <div className="bv-results-heading"><h2 id="bv-results-heading" tabIndex={-1}>{book || author || query ? "Search results" : tags.length && tags.every(slug => labelFor(slug)) ? tags.map(labelFor).join(" + ") : "Books to explore"}</h2><span>{request.loading ? "Loading books…" : request.error || merging || checkingSearch || incompleteSearch || !(book || author || query || tags.length) ? "" : `${total.toLocaleString()} ${total === 1 ? "match" : "matches"}`}</span></div>
    {request.loading ? <BookSkeletons count={10} /> : request.error ? <EmptyState title="The books couldn’t load." error action={<Button onClick={request.retry}>Try again</Button>}>{errorText(request.error, "Please try again. Your search and filters are still here.")}</EmptyState> : visible.length ? <>
      <div ref={grid} className="bv-book-grid">{visible.map((card, index) => card.work_key
        ? <WorkCard key={`work:${card.work_key}`} book={card} priority={index < 5} busy={opening.busy.has(card.work_key)} error={opening.failed[card.work_key]} onOpen={openWork} />
        : <BookCard key={card.id} book={card} priority={index < 5} />)}</div>
      {(!merging || pages > 1) && <div className="bv-pagination">{!merging && <span>Showing {((page - 1) * size + 1).toLocaleString()}–{Math.min(page * size, total).toLocaleString()}{(book || author || tags.length) ? ` of ${total.toLocaleString()}` : ""}</span>}
        {pages > 1 && <nav aria-label="Results pages"><Button variant="secondary" disabled={page <= 1} onClick={() => movePage(page - 1)}><ArrowLeft aria-hidden="true" /><span>Previous</span></Button><span aria-current="page">Page {page} of {pages.toLocaleString()}</span><Button variant="secondary" disabled={page >= pages} onClick={() => movePage(page + 1)}><span>Next</span><ArrowRight aria-hidden="true" /></Button></nav>}
      </div>}
    </> : page > 1 && total > 0 ? <EmptyState title="You’ve reached the end of these results." action={<Button onClick={() => movePage(1)}>Back to the first page</Button>}>Your filters may have changed. Start again at page one.</EmptyState> : checkingSearch ? <p role="status" className="bv-help">Finishing your search…</p> : morePending ? <p role="status" className="bv-help">Searching…</p> : incompleteSearch ? <p role="status" className="bv-help">Additional books couldn’t be checked. Retry loading your library above or adjust your search.</p> : <EmptyState title="No books found." action={<><Button onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button><Button variant="secondary" onClick={() => setFilterOpen(true)}>Adjust filters</Button></>}>Try a shorter title, search by author, or remove a genre filter.{canAddMissing && <p>Not in the catalogue? <ManualBookLink title={book} author={author}>Add it to your library yourself</ManualBookLink></p>}{!auth.isAuthenticated && Boolean(book.trim() || author.trim()) && <GuestNoResults search={params.toString()} />}</EmptyState>}
    {merging && visible.length > 0 && canAddMissing && <p className="bv-help">Still missing your book? <ManualBookLink title={book || query} author={author}>Add a book</ManualBookLink></p>}
    {filterOpen && <FilterDialog onClose={() => setFilterOpen(false)} onApply={applyFilters} initial={{ tags, exclude, shelf }} authenticated={auth.isAuthenticated} />}
  </section>;
}

// Books the reader signed in from: their history holds the book twice around the sign-in, so Back uses the link instead.
const signedInFrom = new Set();

export function BookPage() {
  const { bookId } = useParams();
  const { labelFor } = useGenres();
  const library = useUserBooks();
  const reader = useReader();
  const location = useLocation();
  const navigate = useNavigate();
  const candidate = safeReturnTo(new URLSearchParams(location.search).get("from") || location.state?.browseFrom, "/browse");
  const browseFrom = candidate.split("?")[0] === "/browse" ? candidate : "/browse";
  const request = useRequest(() => getBookById(bookId), `book:${bookId}`);
  // Opened from a card: draw its title, cover and facts at once; the description and subjects fill in when the request returns.
  const seed = String(location.state?.book?.id) === String(bookId) ? location.state.book : null;
  const book = request.data || seed;
  useBookSeo(book);
  const loadingNode = useRef(null), errorNode = useRef(null), articleNode = useRef(null), restoreHeadingFocus = useRef(false);
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
  // The card-seeded page is an article from the first frame; if its request then fails, the error panel inherits its focus.
  const trackArticle = useCallback(node => {
    if (!node && articleNode.current?.contains(document.activeElement)) restoreHeadingFocus.current = true;
    articleNode.current = node;
  }, []);
  const trackError = useCallback(node => {
    // Safari pointer activation may focus main rather than the Retry button.
    // Preserve the explicit retry intent until the next loading mount consumes it.
    if (!node && errorNode.current?.contains(document.activeElement)) restoreHeadingFocus.current = true;
    errorNode.current = node;
    completeFocusTransition(node);
  }, [completeFocusTransition]);
  const saved = reader.libraryReady && !library.loading && !library.error && library.booksById[bookId]?.status;
  const continuingSave = ["want", "owned"].includes(new URLSearchParams(location.search).get("save"));
  const copyUrl = bookshopAffiliateUrl(book);
  const sharedVisit = new URLSearchParams(location.search).get("src") === "share" && Boolean(book);
  if (continuingSave) signedInFrom.add(String(bookId));
  useEffect(() => { if (sharedVisit) trackEvent("share_visit", { src: "share" }); }, [sharedVisit, bookId]);
  return <section className="bv-container">
    <div className="bv-breadcrumb"><TextLink to={browseFrom} onClick={event => {
      // Back means the page the reader came from. A direct link has no in-app history, so it goes to Discover.
      if (signedInFrom.delete(String(bookId)) || location.key === "default" || event.metaKey || event.ctrlKey || event.shiftKey || event.button) return;
      event.preventDefault(); navigate(-1);
    }}><ArrowLeft aria-hidden="true" />Back</TextLink></div>
    {!book && request.loading ? <div key="loading" className="bv-detail" ref={trackLoading}><div className="bv-detail-art"><div className="bv-skeleton bv-skeleton--cover bv-detail-cover-placeholder" /></div><div><PageHeading title="Loading your book…" /><div className="bv-skeleton bv-skeleton--title" /><section className="bv-description" aria-busy="true"><h2>About this book</h2><div className="bv-description-pending" aria-hidden="true"><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line bv-skeleton--short" /></div></section></div></div> : (request.error && !request.data) || !book ? <div key="error" ref={trackError}><EmptyState error title={request.error?.status === 404 ? "This book couldn’t be found." : "This book couldn’t load."} action={<><Button onClick={() => { restoreHeadingFocus.current = true; request.retry(); }}>Try again</Button><ActionLink to="/browse" variant="secondary">Discover books</ActionLink></>}>Try again or explore another title.</EmptyState></div> : <article className="bv-detail" aria-labelledby="bv-book-title" ref={trackArticle}>
      <div className="bv-detail-art"><BookCover book={book} priority size="large" /></div>
      <div className="bv-detail-body"><h1 id="bv-book-title" tabIndex={-1} ref={completeFocusTransition}>{book.title || "Untitled book"}</h1>
        <EnglishTitle book={book} />
        {book.subtitle && <p className="bv-lead bv-muted">{book.subtitle}</p>}
        <p className="bv-detail-author">{authorLabel(book)}</p>
        {/* Shelf choices come before subjects so they're on a phone's first screen. */}
        <ShelfActions book={book} hideError={continuingSave} /><PinToUpNext bookId={bookId} /><SaveContinuation />
        {copyUrl && <div className="bv-get-copy"><h2>Get a copy</h2><a href={copyUrl} target="_blank" rel="noopener noreferrer sponsored" onClick={() => trackEvent("get_copy_click", { placement: "book_page" })}>Find it at Bookshop.org</a><p className="bv-help">Bookvane may earn a small commission.</p></div>}
        {!request.data && <div className="bv-book-tags bv-book-tags--pending" aria-hidden="true" />}
        {book.tags?.some(tag => labelFor(tag.name)) && <div className="bv-book-tags">{book.tags.map((tag) => labelFor(tag.name) && <Link key={tag.id} to={`/browse?tag=${encodeURIComponent(tag.name)}`}>{labelFor(tag.name)}</Link>)}</div>}
        {(book.published_year != null || book.page_count > 0) && <dl className="bv-book-metadata">
          {book.published_year != null && <div><dt>Published</dt><dd>{formatYear(book.published_year)}</dd></div>}{book.page_count > 0 && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}
        </dl>}
        {library.readingActions && <div className="bv-form-actions"><ActionLink to={`/my-books/start/${book.id}`} variant="secondary">Open or start your reading</ActionLink></div>}
        {saved && <TextLink to="/my-books">View My Books <ArrowRight aria-hidden="true" /></TextLink>}
        {request.data ? <BookAbout key={book.id} book={book} />
          : <section className="bv-description" aria-busy="true"><h2>About this book</h2><div className="bv-description-pending" aria-hidden="true"><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line" /><div className="bv-skeleton bv-skeleton--line bv-skeleton--short" /></div></section>}
      </div>
    </article>}
  </section>;
}
