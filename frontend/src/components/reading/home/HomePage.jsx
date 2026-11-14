import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { getUpNext } from "../../../api/home.js";
import { homeKeys, loadHomeShelf } from "../../../api/earlyStart.js";
import { getReadingHome } from "../../../api/reading.js";
import { getStats } from "../../../api/profile.js";
import { useRequest } from "../../ui-v2/data.js";
import { useProfile } from "../../profile/profileState.js";
import { YearCard } from "../../profile/YearShelf.jsx";
import { BookCover, BookSkeletons, Button, EmptyState, TextLink } from "../../ui-v2/primitives.jsx";
import FirstRunHome from "../FirstRunHome.jsx";
import { SlowReadingNotice } from "../ReadingCards.jsx";
import HelpMeChoose from "./HelpMeChoose.jsx";
import ProgressBox from "../ProgressBox.jsx";
import UpNext from "./UpNext.jsx";
import { greetingFor, progressOf, shortDate, suggestions, useNarrow } from "./homeLogic.js";
import "../../../styles/ui-v2/home.css";

const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const entryBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

function ReadingCard({ read, onSaved, onFinished, readOnly }) {
  const { entry, attempt } = read, book = entryBook(entry), progress = progressOf(attempt);
  const percent = progress && (progress.max ? Math.min(100, Math.round(100 * progress.value / progress.max)) : null);
  const started = shortDate(attempt.started_on);
  return <article className="bv-now-card">
    <BookCover book={book} priority />
    <div className="bv-now-body">
      <h3><Link to={`/my-books/${entry.id}`} state={{ entry }}>{book.title}</Link></h3>
      <p className="bv-author">{(book.authors || []).map(author => author.name).join(", ") || "Author not listed"}</p>
      {percent != null && <progress className="bv-reading-meter" value={percent} max="100" aria-label={`Reading progress for ${book.title}`} />}
      {(progress || started) && <p className="bv-muted">{[progress?.label, started && `started ${started}`].filter(Boolean).join(" · ")}</p>}
      <ProgressBox entry={entry} attempt={attempt} title={book.title} readOnly={readOnly} onSaved={onSaved} onFinished={onFinished} />
    </div>
  </article>;
}

function YearGlance({ stats }) {
  if (!stats || !Array.isArray(stats.by_month)) return null;
  return <section className="bv-year-glance"><YearCard stats={stats} /></section>;
}

export default function ReadingHomePage() {
  const auth = useAuth(), library = useUserBooks(), { profile } = useProfile() || {};
  const key = `${auth.sessionGeneration}:${library.revision}`;
  const keys = homeKeys(key);
  const request = useRequest(getReadingHome, keys.home);
  const quiet = Boolean(request.data) && !request.data.current_reads.length && !request.data.reading_count && !request.data.paused_count;
  // One library request serves everything on Home, including the empty-library check. A failure leaves that block out instead of failing the page.
  const shelf = useRequest(() => loadHomeShelf().catch(() => null), keys.shelf, Boolean(request.data));
  const [firstRun, setFirstRun] = useState(false);
  if (!firstRun && quiet && shelf.data?.counts?.all === 0) setFirstRun(true);
  const ready = Boolean(request.data) && !firstRun;
  const stats = useRequest(() => getStats().catch(() => null), keys.stats, ready);
  const pinned = useRequest(() => getUpNext().catch(() => null), keys.pins, ready);
  const [override, setOverride] = useState({ key: "", pins: undefined, reads: {} });
  const current = override.key === key ? override : { key, pins: undefined, reads: {} };
  const [showAll, setShowAll] = useState(false);
  const narrow = useNarrow();
  if (firstRun) return <FirstRunHome />;
  if (quiet && shelf.loading) return <section className="bv-container"><BookSkeletons count={3} /></section>;

  const reads = (request.data?.current_reads || []).map(read => current.reads[read.entry.id] || read);
  const pins = current.pins !== undefined ? current.pins : pinned.data;
  const shown = narrow && !showAll ? reads.slice(0, 1) : reads;
  const readingCount = request.data?.reading_count ?? reads.length;
  // A saved box keeps its card up to date in place; a finished book leaves Reading now once the library has refreshed.
  const saved = read => result => setOverride({ ...current, reads: { ...current.reads, [read.entry.id]: { entry: result.entry || read.entry, attempt: result.attempt } } });
  const finished = result => library.readingChanged(result.entry);
  return <section className="bv-container bv-reading-home bv-home">
    <div className="bv-home-greeting"><h1>{greetingFor(profile?.display_name)}</h1>{readingCount > 0 && <p className="bv-muted">You’re reading {books(readingCount)}</p>}</div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <SlowReadingNotice loading={request.loading} />
    <section className="bv-reading-now" aria-labelledby="bv-now-title">
      <h2 id="bv-now-title">Reading now</h2>
      {request.loading ? <BookSkeletons count={2} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState>
        : reads.length ? <>
          <div className="bv-now-grid">{shown.map(read => <ReadingCard key={read.entry.id} read={read} readOnly={library.readOnly} onSaved={saved(read)} onFinished={finished} />)}</div>
          {narrow && reads.length > 1 && <p className="bv-more-reading">{showAll ? <Button variant="quiet" onClick={() => setShowAll(false)}>Show fewer</Button> : <>+ {reads.length - 1} more you’re reading · <Button variant="quiet" onClick={() => setShowAll(true)}>Show</Button></>}</p>}
          {readingCount > reads.length && <p className="bv-more-reading"><TextLink to="/my-books?status=reading">See all current reads ({readingCount})</TextLink></p>}
        </> : <div className="bv-muted">{request.data.paused_count ? <p>A book can wait for you. <TextLink to="/my-books?status=paused">Open paused books</TextLink></p> : <p>Nothing started yet. Pick something below, or <TextLink to="/browse">find a book</TextLink>.</p>}</div>}
    </section>
    {ready && <>
      <UpNext pins={pins} suggested={shelf.data ? suggestions(shelf.data.items) : []} canEdit={Array.isArray(pins)} readOnly={library.readOnly}
        onPinsChanged={result => setOverride({ ...current, pins: Array.isArray(result) ? result : [] })} />
      {!shelf.loading && <HelpMeChoose shelf={shelf.data} oldest={stats.data?.shelf?.oldest_waiting} readOnly={library.readOnly} />}
      <YearGlance stats={stats.data} />
    </>}
  </section>;
}
