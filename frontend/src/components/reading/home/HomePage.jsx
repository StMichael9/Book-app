import { OnLoanHome } from "../../lending/OnLoan.jsx";
import { useOpenLoans } from "../../lending/useOpenLoans.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../../../hooks/AuthContext.jsx";
import { useUserBooks } from "../../../hooks/UserBooksContext.jsx";
import { getUpNext } from "../../../api/home.js";
import { homeKeys, loadHomeShelf } from "../../../api/earlyStart.js";
import { getReadingHome } from "../../../api/reading.js";
import { getStats } from "../../../api/profile.js";
import { useRequest } from "../../ui-v2/data.js";
import { useProfile } from "../../profile/profileState.js";
import { BookCover, BookSkeletons, Button, EmptyState, NativeDialog, TextLink } from "../../ui-v2/primitives.jsx";
import FirstRunHome from "../FirstRunHome.jsx";
import { SlowReadingNotice } from "../ReadingCards.jsx";
import HelpMeChoose from "./HelpMeChoose.jsx";
import ProgressBox from "../ProgressBox.jsx";
import UpNext from "./UpNext.jsx";
import WithClub, { clubWithBook, useAfterIdle, useMyClubs } from "../../clubs/WithClub.jsx";
import { greetingFor, MAX_PINS, progressOf, shortDate, suggestions, useCompact, useNarrow, UP_NEXT_SHOWN, UP_NEXT_SHOWN_COMPACT } from "./homeLogic.js";
import AuthorLinks from "../../ui-v2/AuthorLinks.jsx";
import ThumbsPrompt from "../ThumbsPrompt.jsx";
import "../../../styles/ui-v2/home.css";

const books = count => `${count} ${count === 1 ? "book" : "books"}`;
const entryBook = entry => entry.book || { title: entry.private_title, cover_image_url: entry.private_catalogue?.cover_image_url, authors: entry.private_author ? [{ name: entry.private_author }] : [] };

// "Update progress" opens this sheet with the book's progress box in it. It closes on a save, except when the save reached the last page:
// then it stays for "Finished the book?". Yes, finished closes it and the card becomes "How was it?"; Not yet closes it.
function ProgressSheet({ read, title, readOnly, onClose, onSaved, onFinished }) {
  const body = useRef(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => body.current?.querySelector("input")?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);
  return <NativeDialog open onClose={onClose} title={title} className="bv-progress-sheet"><div ref={body}>
    <ProgressBox entry={read.entry} attempt={read.attempt} title={title} readOnly={readOnly}
      onSaved={(result, info) => { onSaved(result); if (!info?.finishing) onClose(); }}
      onFinished={result => { onClose(); onFinished(result); }} onNotYet={onClose} />
  </div></NativeDialog>;
}

function ReadingCard({ read, onSaved, onFinished, readOnly, clubs }) {
  const { entry, attempt } = read, book = entryBook(entry), progress = progressOf(attempt);
  const percent = progress && (progress.max ? Math.min(100, Math.round(100 * progress.value / progress.max)) : null);
  const started = shortDate(attempt.started_on);
  const [open, setOpen] = useState(false);
  return <article className="bv-now-card">
    <BookCover book={book} priority />
    <div className="bv-now-body">
      <h3><Link to={`/my-books/${entry.id}`} state={{ entry }}>{book.title}</Link></h3>
      <p className="bv-author"><AuthorLinks authors={book.authors || []} /></p>
      <WithClub club={clubWithBook(clubs, entry.book_id ?? book.id)} />
      <progress className="bv-reading-meter" value={percent ?? 0} max="100" aria-label={`Reading progress for ${book.title}`} />
      {(progress || started) && <p className="bv-muted">{[progress?.label, started && `started ${started}`].filter(Boolean).join(" · ")}</p>}
      {!readOnly && <Button variant="quiet" className="bv-soft-action" aria-label={`Update progress for ${book.title}`} onClick={() => setOpen(true)}>Update progress</Button>}
    </div>
    {open && <ProgressSheet read={read} title={book.title} readOnly={readOnly} onClose={() => setOpen(false)} onSaved={onSaved} onFinished={onFinished} />}
  </article>;
}

// Where a book finished from Home's box stood in Reading now: the same cover and title, with "How was it?" in place of the box.
// It stays there until the prompt is answered or skipped, even after the library has refreshed and the server no longer lists the book.
function FinishedCard({ finished, readOnly, onSaved }) {
  const { entry, attempt } = finished, book = entryBook(entry);
  const [done, setDone] = useState(false), card = useRef(null);
  // Finishing a book from the sheet leaves focus here, on the "How was it?" card.
  useEffect(() => { card.current?.focus({ preventScroll: true }); }, []);
  if (done) return null;
  return <article className="bv-now-card is-finished" ref={card} tabIndex={-1}>
    <BookCover book={book} priority />
    <div className="bv-now-body">
      <h3><Link to={`/my-books/${entry.id}`} state={{ entry }}>{book.title}</Link></h3>
      <p className="bv-author"><AuthorLinks authors={book.authors || []} /></p>
    </div>
    <div className="bv-now-progress">{readOnly ? null : <ThumbsPrompt entry={entry} attempt={attempt} onSaved={onSaved} onSkipped={() => setDone(true)} />}</div>
  </article>;
}

export default function ReadingHomePage() {
  const auth = useAuth(), library = useUserBooks(), { profile } = useProfile() || {};
  const loans = useOpenLoans(library.readingActions && !library.readOnly, `${auth.sessionGeneration}:${library.revision}`);
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
  const [justFinished, setJustFinished] = useState([]), [dot, setDot] = useState(0), swipe = useRef(null);
  const narrow = useNarrow(), compact = useCompact();
  // The clubs are only for the "With {club}" line, so they are asked for once Reading now has a book and the page has had its idle moment.
  const clubs = useMyClubs(useAfterIdle(Boolean(request.data?.current_reads?.length)));
  // The books Up next is showing, which "Can't decide?" leaves out. Memoised: a list rebuilt every render would keep redoing that work.
  const pinsNow = override.key === key && override.pins !== undefined ? override.pins : pinned.data, shelfItems = shelf.data?.items;
  const upNextIds = useMemo(() => (Array.isArray(pinsNow) && pinsNow.length ? pinsNow.slice(0, MAX_PINS) : shelfItems ? suggestions(shelfItems, compact ? UP_NEXT_SHOWN_COMPACT : UP_NEXT_SHOWN) : []).map(card => card.entry_id), [pinsNow, shelfItems, compact]);
  if (firstRun) return <FirstRunHome />;
  if (quiet && shelf.loading) return <section className="bv-container"><BookSkeletons count={3} /></section>;

  const reads = (request.data?.current_reads || []).map(read => current.reads[read.entry.id] || read);
  const pins = current.pins !== undefined ? current.pins : pinned.data;
  const readingCount = request.data?.reading_count ?? reads.length;
  // The cards in Reading now, with a finished book's "How was it?" card where it stood.
  const cards = reads.map((read, index) => ({ read, index, finished: null }));
  for (const item of justFinished) {
    const standing = cards.findIndex(card => card.read.entry.id === item.entry.id);
    if (standing >= 0) cards[standing] = { ...cards[standing], finished: item };
    else cards.splice(Math.min(item.at, cards.length), 0, { read: null, index: -1, finished: item });
  }
  // A saved box keeps its card up to date in place; a finished book leaves Reading now once the library has refreshed.
  const saved = read => result => setOverride({ ...current, reads: { ...current.reads, [read.entry.id]: { entry: result.entry || read.entry, attempt: result.attempt } } });
  const finished = (read, index) => result => {
    if (!result.attempt?.reaction) setJustFinished(list => [...list.filter(item => item.entry.id !== read.entry.id), { entry: result.entry || read.entry, attempt: result.attempt, at: index }]);
    library.readingChanged(result.entry);
  };
  // Which card the phone swipe is showing, for the dots. Set only when it changes.
  const scrolled = () => {
    const box = swipe.current, first = box?.firstElementChild;
    if (!first) return;
    const index = Math.min(cards.length - 1, Math.round(box.scrollLeft / (first.getBoundingClientRect().width + 12)));
    if (index !== dot) setDot(index);
  };
  return <section className="bv-container bv-reading-home bv-home">
    <div className="bv-home-greeting"><h1>{greetingFor(profile?.display_name)}</h1>{readingCount > 0 && <p className="bv-muted">You’re reading {books(readingCount)}</p>}</div>
    {library.readOnly && <p role="status" className="bv-notice">Your library is available to read. Changes are temporarily paused.</p>}
    <SlowReadingNotice loading={request.loading} />
    <section className="bv-reading-now" aria-labelledby="bv-now-title">
      <div className="bv-section-head"><h2 id="bv-now-title">Reading now</h2>{!request.loading && !request.error && readingCount > reads.length && <TextLink to="/my-books?status=reading">See all current reads ({readingCount})</TextLink>}</div>
      {request.loading ? <BookSkeletons count={2} /> : request.error ? <EmptyState error title="Your reading couldn’t load." action={<Button onClick={request.retry}>Try again</Button>}>Your books haven’t changed.</EmptyState>
        : cards.length ? <>
          <ul className={`bv-now-grid${narrow ? " bv-now-swipe" : ""}`} ref={swipe} onScroll={narrow ? scrolled : undefined}>{cards.map(card => <li key={(card.finished || card.read).entry.id}
            onFocus={narrow ? event => event.currentTarget.scrollIntoView({ block: "nearest", inline: "nearest" }) : undefined}>{card.finished
            ? <FinishedCard finished={card.finished} readOnly={library.readOnly} onSaved={result => library.rememberEntries([result.entry])} />
            : <ReadingCard read={card.read} readOnly={library.readOnly} clubs={clubs} onSaved={saved(card.read)} onFinished={finished(card.read, card.index)} />}</li>)}</ul>
          {narrow && cards.length > 1 && <div className="bv-now-dots" aria-hidden="true">{cards.map((card, index) => <i key={(card.finished || card.read).entry.id} className={index === dot ? "on" : undefined} />)}</div>}
        </> : <div className="bv-muted">{request.data.paused_count ? <p>A book can wait for you. <TextLink to="/my-books?status=paused">Open paused books</TextLink></p> : <p>Nothing started yet. Pick something below, or <TextLink to="/browse">find a book</TextLink>.</p>}</div>}
    </section>
    {library.readingActions && !library.readOnly && <OnLoanHome loans={loans.loans} onChanged={loans.reload} />}
    {ready && <>
      <UpNext pins={pins} suggested={shelf.data ? suggestions(shelf.data.items, compact ? UP_NEXT_SHOWN_COMPACT : UP_NEXT_SHOWN) : []} canEdit={Array.isArray(pins)} readOnly={library.readOnly}
        onPinsChanged={result => setOverride({ ...current, pins: Array.isArray(result) ? result : [] })} />
      {!shelf.loading && <HelpMeChoose shelf={shelf.data} exclude={upNextIds} oldest={stats.data?.shelf?.oldest_waiting} readOnly={library.readOnly} />}
    </>}
  </section>;
}
