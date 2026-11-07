import { useRef, useState } from "react";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { getUpNext } from "../../../api/home.js";
import { getLibraryPage, getReadingHome } from "../../../api/reading.js";
import { getStats } from "../../../api/profile.js";
import { useRequest } from "../../ui-v2/data.js";
import { useProfile } from "../../profile/profileState.js";
import { YearInBooks } from "../../profile/YearShelf.jsx";
import { BookCover, BookSkeletons, Button, EmptyState, TextLink } from "../../ui-v2/primitives.jsx";
import FirstRunHome from "../FirstRunHome.jsx";
import { SlowReadingNotice } from "../ReadingCards.jsx";
import HelpMeChoose from "./HelpMeChoose.jsx";
import ProgressSheet from "./ProgressSheet.jsx";
import UpNext from "./UpNext.jsx";
import { greetingFor, progressOf, shortDate, suggestions, useNarrow } from "./homeLogic.js";
import "../../../styles/ui-v2/home.css";

const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const entryBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

function ReadingCard({ read, onUpdate, readOnly, buttonRef }) {
  const { entry, attempt } = read, book = entryBook(entry), progress = progressOf(attempt);
  const percent = progress && (progress.max ? Math.min(100, Math.round(100 * progress.value / progress.max)) : null);
  const started = shortDate(attempt.started_on);
  return <article className="bv-now-card">
    <BookCover book={book} priority />
    <div className="bv-now-body">
      <h3>{book.title}</h3>
      <p className="bv-author">{(book.authors || []).map(author => author.name).join(", ") || "Author not listed"}</p>
      {percent != null && <progress className="bv-reading-meter" value={percent} max="100" aria-label={`Reading progress for ${book.title}`} />}
      {(progress || started) && <p className="bv-muted">{[progress?.label, started && `started ${started}`].filter(Boolean).join(" · ")}</p>}
      <Button ref={buttonRef} disabled={readOnly} aria-label={`Update progress for ${book.title}`} onClick={() => onUpdate(read)}>Update progress</Button>
    </div>
  </article>;
}

function YearGlance({ stats, libraryImport }) {
  if (!stats || !Array.isArray(stats.by_month)) return null;
  const empty = !stats.books_finished;
  return <section className="bv-year-glance" aria-labelledby="bv-glance-title">
    <div className="bv-section-head"><h2 id="bv-glance-title">Your {stats.year} so far</h2>{!empty && <TextLink to="/reading-life">Your reading life</TextLink>}</div>
    {empty ? <p>When you finish a book, your year starts filling in here.{libraryImport && <> <TextLink to="/my-books/import">Import your history</TextLink> to see it straight away.</>}</p> : <div className="bv-glance">
      <dl className="bv-figures">
        <div><dt>books finished</dt><dd>{stats.books_finished.toLocaleString("en-US")}</dd></div>
        <div><dt>pages</dt><dd>{stats.pages_read.toLocaleString("en-US")}</dd></div>
        {stats.median_days != null && <div><dt>typical book</dt><dd>{stats.median_days} {stats.median_days === 1 ? "day" : "days"}</dd></div>}
      </dl>
      <YearInBooks stats={stats} chips={false} bare />
    </div>}
  </section>;
}

export default function ReadingHomePage() {
  const auth = useAuth(), library = useUserBooks(), { profile } = useProfile() || {};
  const key = `${auth.sessionGeneration}:${library.revision}`;
  const request = useRequest(getReadingHome, `home:${key}`);
  const quiet = Boolean(request.data) && !request.data.current_reads.length && !request.data.reading_count && !request.data.paused_count;
  const first = useRequest(() => getLibraryPage({}), `home-books:${auth.sessionGeneration}`, quiet);
  const [firstRun, setFirstRun] = useState(false);
  if (!firstRun && first.data?.counts?.all === 0) setFirstRun(true);
  const ready = Boolean(request.data) && !firstRun;
  // Everything below the current reading is best effort: a failure leaves that block out instead of failing the page.
  const shelf = useRequest(() => getLibraryPage({ facet: "all", sort: "added", limit: "100" }).catch(() => null), `home-shelf:${key}`, ready);
  const stats = useRequest(() => getStats().catch(() => null), `home-stats:${key}`, ready);
  const pinned = useRequest(() => getUpNext().catch(() => null), `home-pins:${key}`, ready);
  const [override, setOverride] = useState({ key: "", pins: undefined, reads: {} });
  const current = override.key === key ? override : { key, pins: undefined, reads: {} };
  const [sheet, setSheet] = useState(null), [showAll, setShowAll] = useState(false);
  const narrow = useNarrow(), buttons = useRef({});
  if (firstRun) return <FirstRunHome />;
  if (quiet && first.loading) return <section className="bv-container"><BookSkeletons count={3} /></section>;

  const reads = (request.data?.current_reads || []).map(read => current.reads[read.entry.id] || read);
  const pins = current.pins !== undefined ? current.pins : pinned.data;
  const shown = narrow && !showAll ? reads.slice(0, 1) : reads;
  const readingCount = request.data?.reading_count ?? reads.length;
  function saved(result) {
    const id = sheet.entry.id;
    setOverride({ ...current, reads: { ...current.reads, [id]: { entry: result.entry || sheet.entry, attempt: result.attempt } } });
    setSheet(null);
    // The sheet closes by itself; focus goes back to the button that opened it.
    queueMicrotask(() => buttons.current[id]?.focus());
  }
  return <section className="bv-container bv-reading-home bv-home">
    <div className="bv-home-greeting"><h1>{greetingFor(profile?.display_name)}</h1>{readingCount > 0 && <p className="bv-muted">You’re reading {books(readingCount)}</p>}</div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <SlowReadingNotice loading={request.loading} />
    <section className="bv-reading-now" aria-labelledby="bv-now-title">
      <h2 id="bv-now-title">Reading now</h2>
      {request.loading ? <BookSkeletons count={2} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState>
        : reads.length ? <>
          <div className="bv-now-grid">{shown.map(read => <ReadingCard key={read.entry.id} read={read} readOnly={library.readOnly} buttonRef={node => { if (node) buttons.current[read.entry.id] = node; }} onUpdate={item => setSheet({ ...item, book: entryBook(item.entry) })} />)}</div>
          {narrow && reads.length > 1 && <p className="bv-more-reading">{showAll ? <Button variant="quiet" onClick={() => setShowAll(false)}>Show fewer</Button> : <>+ {reads.length - 1} more you’re reading · <Button variant="quiet" onClick={() => setShowAll(true)}>Show</Button></>}</p>}
        </> : <div className="bv-muted">{request.data.paused_count ? <p>A book can wait for you. <TextLink to="/my-books?status=paused">Open paused books</TextLink></p> : <p>Nothing started yet. Pick something below, or <TextLink to="/browse">find a book</TextLink>.</p>}</div>}
    </section>
    {ready && <>
      <UpNext pins={pins} suggested={shelf.data ? suggestions(shelf.data.items) : []} canEdit={Array.isArray(pins)} readOnly={library.readOnly}
        onPinsChanged={result => setOverride({ ...current, pins: Array.isArray(result) ? result : [] })} />
      {shelf.data && <HelpMeChoose shelf={shelf.data} readOnly={library.readOnly} />}
      <YearGlance stats={stats.data} libraryImport={library.libraryImport && !library.readOnly} />
    </>}
    {sheet && <ProgressSheet read={sheet} onClose={() => setSheet(null)} onSaved={saved} />}
  </section>;
}
