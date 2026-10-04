import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import { ArrowLeft, ArrowRight, BookOpen, Search, SlidersHorizontal } from "lucide-react";
import { getBooks, getBookById } from "../../api/books.js";
import { signUpForUpdates } from "../../api/emailSignups.js";
import { useAuth } from "../../hooks/AuthContext.jsx";
import ShareBookButton from "../ShareBookButton.jsx";
import { useReader } from "./readerState.js";
import { SUBJECTS, authorLabel, catalogueResponse, errorText, safeReturnTo, subjectLabel, useRequest } from "./data.js";
import { ActionLink, BookCover, BookGrid, BookSkeletons, Button, EmptyState, NativeDialog, PageHeading, SectionHeading, ShelfActions, TextLink } from "./primitives.jsx";
import { useParams } from "react-router-dom";

export function WelcomePage() {
  const auth = useAuth();
  const scope = auth.isAuthenticated ? "authenticated" : "public";
  const books = useRequest(async () => catalogueResponse(await getBooks({ size: 10, cacheScope: scope })), `welcome:${scope}`, !auth.isLoading);
  const items = books.data?.items || [];
  const heroBooks = [...items.filter((book) => book.cover_image_url), ...items.filter((book) => !book.cover_image_url)].slice(0, 3);
  const subjects = [["fantasy", "Beyond the familiar"], ["mystery", "Follow the clues"], ["romance", "A little heart"], ["science_fiction", "Somewhere unexpected"]];
  return <>
    <section className="bv-container bv-hero">
      <div><p className="bv-eyebrow">For the love of finding a good book</p>
        <h1>Your next book<br />is <em>waiting.</em></h1>
        <p className="bv-lead bv-muted">Follow your curiosity. Discover books, save what catches your eye, and make a library that feels like you.</p>
        <div className="bv-hero-actions"><ActionLink to="/browse">Explore books <ArrowRight aria-hidden="true" /></ActionLink>
          <TextLink to={auth.isAuthenticated ? "/my-books" : "/login"}>{auth.isAuthenticated ? "Return to your library" : "I already have an account"}</TextLink></div>
        <p className="bv-help">Start exploring. No account needed.</p>
      </div>
      <div className="bv-hero-display"><p className="bv-hero-quote">A little curiosity.<br />A whole new world.</p>
        <div className="bv-hero-covers">{books.loading ? Array.from({ length: 3 }, (_, i) => <div key={i} className="bv-skeleton bv-skeleton--cover" aria-hidden="true" />) :
          heroBooks.length ? heroBooks.map((book) => <Link key={book.id} to={`/book/${book.id}`} aria-label={`Explore ${book.title}`}><BookCover book={book} priority /></Link>) :
            <div className="bv-hero-placeholder"><BookOpen aria-hidden="true" /><p>Your next story starts with a little curiosity.</p></div>}
        </div><div className="bv-shelf-rule" /><p className="bv-help">Something familiar. Something unexpected.</p>
      </div>
    </section>
    <div className="bv-container"><div className="bv-intro-rule"><span>{books.data ? <><strong>{books.data.total.toLocaleString()} books</strong> to explore</> : "A place to discover books"}</span><span>Discover → save → make it yours</span><span>Browse first. Join when you’re ready.</span></div></div>
    <section className="bv-container bv-section"><SectionHeading title="Where will you wander?" to="/browse">Start with a subject you love.</SectionHeading>
      <div className="bv-genre-grid">{subjects.map(([slug, caption]) => <Link className="bv-genre-card" key={slug} to={`/browse?tag=${slug}`}><span>{subjectLabel(slug)}</span><span>{caption}<ArrowRight aria-hidden="true" /></span></Link>)}</div>
    </section>
    <section className="bv-container bv-section"><SectionHeading title="Open a new chapter" to="/browse">A few books to spark your curiosity.</SectionHeading>
      {books.loading ? <BookSkeletons /> : books.error ? <EmptyState error icon={BookOpen} title="The books are taking a moment." action={<Button onClick={books.retry}>Try again</Button>}>We couldn’t load the catalogue. You can try again or continue to discovery.</EmptyState> : items.length ? <BookGrid books={items.slice(0, 5)} /> : <EmptyState title="More stories are on their way." action={<ActionLink to="/browse">Explore books</ActionLink>}>Try discovery to see what’s available.</EmptyState>}
    </section>
    <section className="bv-container"><div className="bv-library-banner"><div><h2>A home for your kind of books.</h2><p>Keep the books you own beside the ones you want. Your next discovery is always a little closer.</p></div><ActionLink to={auth.isAuthenticated ? "/my-books" : "/register"}>{auth.isAuthenticated ? "Open your library" : "Create your library"}</ActionLink></div></section>
    <UpdatesSignup />
  </>;
}

function UpdatesSignup() {
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [state, setState] = useState("idle");
  const [error, setError] = useState("");
  async function submit(event) {
    event.preventDefault();
    if (!consent || state === "pending") return;
    setState("pending"); setError("");
    try { await signUpForUpdates(email); setState("done"); setEmail(""); }
    catch (requestError) { setError(errorText(requestError, "We couldn’t sign you up. Please try again.")); setState("idle"); }
  }
  return <section className="bv-container bv-updates"><div><h2>Hear from Bookvane</h2><p className="bv-muted">Occasional product updates. An account isn’t required.</p></div>
    {state === "done" ? <p role="status">Thanks for signing up for Bookvane updates.</p> : <form onSubmit={submit} className="bv-updates-form">
      <label htmlFor="bv-updates-email">Email address</label><div className="bv-inline-form"><input id="bv-updates-email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} /><Button type="submit" disabled={state === "pending"}>{state === "pending" ? "Signing up…" : "Sign up"}</Button></div>
      <label className="bv-checkbox"><input type="checkbox" required checked={consent} onChange={(event) => setConsent(event.target.checked)} /><span>I agree to receive Bookvane product updates by email.</span></label>
      {error && <p className="bv-field-error" role="alert">{error}</p>}
    </form>}
  </section>;
}

function FilterDialog({ onClose, onApply, initial, authenticated }) {
  const [tags, setTags] = useState(initial.tags);
  const [exclude, setExclude] = useState(initial.exclude);
  const [shelf, setShelf] = useState(initial.shelf);
  const [find, setFind] = useState("");
  return <NativeDialog open onClose={onClose} title="A little more specific." className="bv-filter-dialog">
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
        <label htmlFor="bv-shelf-filter">Search within</label><select id="bv-shelf-filter" value={shelf} onChange={(event) => setShelf(event.target.value)}><option value="">All books</option><option value="want">My Want shelf</option><option value="owned">My Own shelf</option></select>
      </div>}
      <div className="bv-dialog-actions"><Button variant="secondary" onClick={() => { setTags([]); setExclude(false); setShelf(""); setFind(""); }}>Reset filters</Button><Button type="submit">Apply filters</Button></div>
    </form>
  </NativeDialog>;
}

export function BrowsePage() {
  const auth = useAuth();
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
  const scope = auth.isAuthenticated ? "authenticated" : "public";
  const request = useRequest(async () => catalogueResponse(await getBooks({ book, author, tags, exclude_owned: exclude, shelf_status: shelf, page, size: 20, cacheScope: scope })), `browse:${scope}:${queryKey}:${reader.preferencesVersion}`, !auth.isLoading);
  const items = request.data?.items || [];
  const total = request.data?.total || 0;
  const size = Number(request.data?.size) || 20;
  const pages = Math.max(1, Math.ceil(total / size));
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
    <div className="bv-page-heading"><h1 id="bv-main-title">Find your next chapter.</h1><p className="bv-muted">A book you know. A subject you love. Somewhere new to start.</p></div>
    <div className="bv-search-zone"><form className="bv-search-form" onSubmit={applySearch} role="search">
      <label className="bv-sr-only" htmlFor="bv-search-mode">Search by</label><select id="bv-search-mode" value={mode} onChange={(event) => setMode(event.target.value)}><option value="book">Title</option><option value="author">Author</option></select>
      <label className="bv-sr-only" htmlFor="bv-search-query">{mode === "author" ? "Search authors" : "Search book titles"}</label><input id="bv-search-query" type="search" value={draft} onChange={(event) => setDraft(event.target.value)} placeholder={mode === "author" ? "Find an author" : "Find a book"} />
      <Button type="submit" aria-label="Search"><Search aria-hidden="true" /><span>Search</span></Button>
    </form><Button variant="secondary" className="bv-filter-trigger" onClick={() => setFilterOpen(true)} aria-haspopup="dialog" aria-label={`Filters${tags.length + Number(exclude) + Number(Boolean(shelf)) ? `, ${tags.length + Number(exclude) + Number(Boolean(shelf))} active` : ""}`}><SlidersHorizontal aria-hidden="true" /><span>Filters</span></Button></div>
    <p className="bv-help">Search by title or author. Browse subjects below.</p>
    <div className="bv-chip-row" aria-label="Browse subjects"><Button variant={!tags.length ? "primary" : "secondary"} className="bv-chip" onClick={() => update((next) => next.delete("tag"))}>All subjects</Button>
      {["fantasy", "mystery", "romance", "science_fiction", "classics", "history"].map((slug) => <Button key={slug} variant={tags.length === 1 && tags[0] === slug ? "primary" : "secondary"} className="bv-chip" onClick={() => update((next) => { next.delete("tag"); next.append("tag", slug); })}>{subjectLabel(slug)}</Button>)}
    </div>
    {(book || author || tags.length || exclude || shelf) ? <div className="bv-applied-filters" aria-label="Applied filters">
      {book && <span>Title: {book}</span>}{author && <span>Author: {author}</span>}{tags.map((slug) => <span key={slug}>{subjectLabel(slug)}</span>)}
      {tags.length > 1 && <span>Match all subjects</span>}{exclude && <span>Books you own hidden</span>}{shelf && <span>{shelf === "owned" ? "Own" : "Want"} shelf only</span>}
      <Button variant="quiet" onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button>
    </div> : null}
    <div className="bv-results-heading"><h2 id="bv-results-heading" tabIndex={-1}>{book || author ? "Search results" : tags.length ? tags.map(subjectLabel).join(" + ") : "Books to explore"}</h2><span>{request.loading ? "Loading books…" : request.error ? "" : `${total.toLocaleString()} books`}</span></div>
    {request.loading ? <BookSkeletons count={10} /> : request.error ? <EmptyState title="The books couldn’t load." error action={<Button onClick={request.retry}>Try again</Button>}>{errorText(request.error, "Please try again. Your search and filters are still here.")}</EmptyState> : items.length ? <>
      <BookGrid books={items} /><div className="bv-pagination"><span>Showing {((page - 1) * size + 1).toLocaleString()}–{Math.min(page * size, total).toLocaleString()} of {total.toLocaleString()} books</span>
        <nav aria-label="Results pages"><Button variant="secondary" disabled={page <= 1} onClick={() => movePage(page - 1)}><ArrowLeft aria-hidden="true" /><span>Previous</span></Button><span aria-current="page">Page {page} of {pages.toLocaleString()}</span><Button variant="secondary" disabled={page >= pages} onClick={() => movePage(page + 1)}><span>Next</span><ArrowRight aria-hidden="true" /></Button></nav>
      </div>
    </> : page > 1 && total > 0 ? <EmptyState title="You’ve reached the end of these results." action={<Button onClick={() => movePage(1)}>Back to the first page</Button>}>Your filters may have changed. Start again at page one.</EmptyState> : <EmptyState title="No books found." action={<><Button onClick={() => { setDraft(""); setParams({}); }}>Clear search & filters</Button><Button variant="secondary" onClick={() => setFilterOpen(true)}>Adjust filters</Button></>}>Try a shorter title, search by author, or remove a subject filter.</EmptyState>}
    {!auth.isAuthenticated && <div className="bv-mini-banner"><p><strong>Found something you love?</strong><br />Create an account to keep your Own and Want books together.</p><ActionLink to="/register">Make it your library</ActionLink></div>}
    {auth.isAuthenticated && <TextLink to="/preferences">Choose your discovery subjects <ArrowRight aria-hidden="true" /></TextLink>}
    {filterOpen && <FilterDialog onClose={() => setFilterOpen(false)} onApply={applyFilters} initial={{ tags, exclude, shelf }} authenticated={auth.isAuthenticated} />}
  </section>;
}

export function BookPage() {
  const { bookId } = useParams();
  const location = useLocation();
  const candidate = safeReturnTo(new URLSearchParams(location.search).get("from") || location.state?.browseFrom, "/browse");
  const browseFrom = candidate.split("?")[0] === "/browse" ? candidate : "/browse";
  const request = useRequest(() => getBookById(bookId), `book:${bookId}`);
  const book = request.data;
  return <section className="bv-container">
    <div className="bv-breadcrumb"><TextLink to={browseFrom}><ArrowLeft aria-hidden="true" />Back to discovery</TextLink></div>
    {request.loading ? <div className="bv-detail"><div className="bv-skeleton bv-skeleton--cover" /><div><PageHeading title="Loading your book…" /><div className="bv-skeleton bv-skeleton--title" /></div></div> : request.error || !book ? <EmptyState error title={request.error?.status === 404 ? "This book couldn’t be found." : "This book couldn’t load."} action={<><Button onClick={request.retry}>Try again</Button><ActionLink to="/browse" variant="secondary">Discover books</ActionLink></>}>Try again or explore another title.</EmptyState> : <article className="bv-detail" aria-labelledby="bv-book-title">
      <div className="bv-detail-art"><BookCover book={book} priority /></div>
      <div className="bv-detail-body"><p className="bv-eyebrow">A book worth a closer look</p><h1 id="bv-book-title">{book.title || "Untitled book"}</h1>
        {book.subtitle && <p className="bv-lead bv-muted">{book.subtitle}</p>}
        <p className="bv-detail-author">{authorLabel(book)}</p>
        {book.tags?.length > 0 && <div className="bv-book-tags">{book.tags.map((tag) => <Link key={tag.id} to={`/browse?tag=${encodeURIComponent(tag.name)}`}>{subjectLabel(tag.name)}</Link>)}</div>}
        {(book.published_year != null || book.page_count > 0 || book.isbn13) && <dl className="bv-book-metadata">
          {book.published_year != null && <div><dt>Published</dt><dd>{book.published_year}</dd></div>}{book.page_count > 0 && <div><dt>Pages</dt><dd>{book.page_count}</dd></div>}{book.isbn13 && <div><dt>ISBN</dt><dd>{book.isbn13}</dd></div>}
        </dl>}
        <ShelfActions book={book} /><TextLink to="/my-books">View My Books <ArrowRight aria-hidden="true" /></TextLink>
        <section className="bv-description"><h2>About this book</h2><p>{book.description || "A description isn’t available for this book yet. You can still save it to your library or explore its subjects."}</p></section>
        <div className="bv-share"><ShareBookButton book={book} /></div>
      </div>
    </article>}
    <div className="bv-mini-banner"><div><h2>Keep your curiosity going.</h2><p className="bv-muted">There’s another story waiting.</p></div><ActionLink to="/browse" variant="secondary">Explore more books <ArrowRight aria-hidden="true" /></ActionLink></div>
  </section>;
}
